// Merge branches into main the way the maintainer does by hand: `bun scripts/merge.ts <branch>... [--message "..."] [--no-push] [--full] [--fix-main]`.
// Several branches are merged in sequence into one merge worktree and tested once, pushed all or none; if that fails, the
// branch at fault is found by bisecting (settle, below) and the others are pushed. The test run is `--affected` (what the
// change can reach, the fast tier, the invariants and backstops; a kernel change selects everything): the whole suite runs
// on every push in CI and nightly, and a red main (scripts/main-status.ts) stops this script until it is green (--fix-main
// for the merge that repairs it). `--full` runs the whole suite here. Jobs run with slot priority: ahead of the queue.
// The kernel is rebuilt only when kernel/ differs from the last build in the merge worktree.
// It works in its own clean worktree (.claude/worktrees/merge-bot, made if missing; never merge-main): fetch, reset to
// origin/main, `git merge --no-ff <branch>`. Conflicts in docs/decisions.md and docs/research/references.md are resolved by
// keeping both sides; any other conflict stops it. Then the build, typecheck and the selected tests (log in
// the merge worktree's merge-test.log). One failing test file that is a known timing flake under load is rerun alone and
// accepted only if it then passes; anything else stops it. Pushes to origin main only if all passed (`--no-push` to not).
// The pure parts (keep-both, marker check, failure reading) are exported and tested in merge.test.ts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blocker, fromRuns, readStatus } from "./main-status";
import { acquire, installHook } from "./merge-lock";

export const KEEP_BOTH_FILES = ["docs/decisions.md", "docs/research/references.md"];
/** Conflicts resolved by keeping main's side: the suite's timings, a cache any run writes again. */
export const KEEP_OURS_FILES = ["scripts/test-times.json"];
export const KNOWN_FLAKES = ["scripts/slots.test.ts", "orchestrator/test/pilot-wave.test.ts"];
export const TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";

/** Resolve conflict markers by keeping both sides (ours, then theirs). Handles diff3 `|||||||` base sections too. */
export function keepBoth(text: string): string {
  const out: string[] = [];
  let state: "text" | "ours" | "base" | "theirs" = "text";
  for (const line of text.split("\n")) {
    if (state === "text" && /^<{7}( |$)/.test(line)) { state = "ours"; continue; }
    if (state === "ours" && /^\|{7}( |$)/.test(line)) { state = "base"; continue; }
    if ((state === "ours" || state === "base") && /^={7}$/.test(line)) { state = "theirs"; continue; }
    if (state === "theirs" && /^>{7}( |$)/.test(line)) { state = "text"; continue; }
    if (state !== "base") out.push(line);
  }
  if (state !== "text") throw new Error("unterminated conflict block");
  return out.join("\n");
}

export const hasMarkers = (text: string) => /^(<{7}( |$)|={7}$|>{7}( |$))/m.test(text);

/** What the suite's output says failed: test files (by the `FAIL <file>` lines of scripts/test.ts) and anything else. */
export function readFailures(log: string): { files: string[]; other: string[] } {
  const files = new Set<string>(), other = new Set<string>();
  for (const line of log.split("\n")) {
    const m = /^FAIL (\S+)/.exec(line);
    if (!m) continue;
    if (/\.test\.ts$/.test(m[1]!)) files.add(m[1]!); else other.add(m[1]!);
  }
  return { files: [...files], other: [...other] };
}

/** Accept a failed suite only when exactly one test file failed and it is a known flake (to be rerun alone). */
export function flakeCandidate(f: { files: string[]; other: string[] }, flakes = KNOWN_FLAKES): string | null {
  if (f.other.length || f.files.length !== 1) return null;
  return flakes.includes(f.files[0]!) ? f.files[0]! : null;
}


/**
 * Which branches can go in together. `passes(set)` says whether the merge of that ordered set passes its tests (false
 * also for a set that does not merge). If all pass: all accepted. Otherwise bisect on prefixes: the shortest prefix that
 * fails ends in the branch at fault; it is rejected, the prefix before it is known good, and the rest is tried again.
 * Assumes a branch that breaks a prefix breaks every longer set (a branch at fault stays at fault).
 */
export async function settle(items: string[], passes: (set: string[]) => Promise<boolean>): Promise<{ accepted: string[]; rejected: string[]; runs: number }> {
  let good: string[] = [], rest = [...items];
  const rejected: string[] = [];
  let runs = 0;
  const test = async (set: string[]) => { runs++; return passes(set); };
  while (rest.length) {
    if (await test([...good, ...rest])) { good = [...good, ...rest]; rest = []; break; }
    let lo = 0, hi = rest.length; // rest[:lo] passes with good (lo = 0: good alone passed or is empty), rest[:hi] fails
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (await test([...good, ...rest.slice(0, mid)])) lo = mid; else hi = mid;
    }
    rejected.push(rest[hi - 1]!);
    good = [...good, ...rest.slice(0, hi - 1)];
    rest = rest.slice(hi);
  }
  return { accepted: good, rejected, runs };
}

/** Whether the kernel needs building: no stamp for this tree of kernel/, or the binaries are missing. */
export const kernelStale = (stamp: string | undefined, tree: string, binariesThere: boolean) => !binariesThere || stamp !== tree;

// ---------------------------------------------------------------------------------------------------------------
if (import.meta.main) await main();

async function main() {
  const args = process.argv.slice(2);
  const noPush = args.includes("--no-push"), full = args.includes("--full"), fixMain = args.includes("--fix-main");
  const mi = args.indexOf("--message");
  const message = mi >= 0 ? args[mi + 1] : undefined;
  const branches = args.filter((a, i) => !a.startsWith("--") && (mi < 0 || i !== mi + 1));
  if (!branches.length) { console.error('usage: bun scripts/merge.ts <branch>... [--message "..."] [--no-push] [--full] [--fix-main]'); process.exit(64); }

  const main = join(import.meta.dir, "..");
  const t0 = Date.now();
  const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;
  const run = (cwd: string, cmd: string[], quiet = false) => {
    const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const out = p.stdout.toString() + p.stderr.toString();
    if (!quiet && p.exitCode !== 0) console.error(out.trim().split("\n").slice(-20).join("\n"));
    return { ok: p.exitCode === 0, out };
  };
  const stop = (why: string): never => { console.error(`STOPPED: ${why}`); process.exit(1); };
  // Everything the merge starts is high priority in the slots (inherited by the children).
  const env = { ...process.env, OIKOS_SLOT_PRIORITY: "high" };
  const stream = async (cwd: string, cmd: string[], logPath?: string) => {
    const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env });
    const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    await p.exited;
    const text = o + e;
    if (logPath) writeFileSync(logPath, text);
    return { code: p.exitCode ?? 1, text };
  };

  // The merge worktree: the main checkout's common git dir tells where worktrees live.
  const top = run(main, ["git", "rev-parse", "--show-toplevel"]).out.trim();
  const common = run(main, ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]).out.trim();
  const base = common.replace(/\/\.git\/?$/, "") || top;
  const wt = join(base, ".claude", "worktrees", "merge-bot");
  if (!existsSync(wt)) {
    if (!run(base, ["git", "worktree", "add", "--detach", wt, "HEAD"]).ok) stop("could not create the merge worktree");
  }
  const g = (...a: string[]) => run(wt, ["git", ...a]);
  // One merge at a time, machine-wide (scripts/merge-lock.ts): a second waits in line. And only a merge pushes to main:
  // the pre-push hook (scripts/hooks/pre-push) is put in the repository's hooks folder, shared by every worktree.
  if (installHook(common)) console.log(`installed the pre-push hook in ${join(common, "hooks")}`);
  await acquire(branches);
  if (!g("fetch", "origin", "main").ok) stop("fetch failed");

  // A red main stops every merge but the one that repairs it.
  if (!fixMain) {
    const gh = Bun.spawnSync(["gh", "run", "list", "--workflow", "ci", "--branch", "main", "--limit", "10", "--json", "conclusion,headSha"], { cwd: wt, stdout: "pipe", stderr: "pipe" });
    let st = readStatus();
    if (gh.exitCode === 0) { try { st = fromRuns(JSON.parse(gh.stdout.toString())) ?? st; } catch { /* the marker */ } }
    const why = blocker(st, (sha) => run(wt, ["git", "merge-base", "--is-ancestor", sha, "origin/main"], true).ok);
    if (why) stop(why);
  }

  const dirty = g("status", "--porcelain").out.trim();
  if (dirty) run(wt, ["git", "merge", "--abort"], true);
  const refs = branches.map((b) => {
    if (run(wt, ["git", "rev-parse", "--verify", "--quiet", b]).ok) return b;
    if (run(wt, ["git", "rev-parse", "--verify", "--quiet", `origin/${b}`]).ok) return `origin/${b}`;
    return stop(`no such branch: ${b}`);
  });
  const log = join(wt, "merge-test.log");

  /** The merge worktree at origin/main with these branches merged in order; false (with the reason said) if one does not merge. */
  const assemble = (set: string[]): boolean => {
    if (!g("reset", "--hard", "origin/main").ok) stop("reset failed");
    g("clean", "-fd", "-e", "node_modules", "-e", "kernel/target", "-e", "merge-test*.log"); // (the last run's log stays, to be read)
    for (const b of set) {
      const ref = refs[branches.indexOf(b)]!;
      const msg = `${branches.length === 1 && message ? message : `Merge ${b}`}\n\n${TRAILER}`;
      const m = run(wt, ["git", "merge", "--no-ff", "-m", msg, ref], true);
      if (m.ok) continue;
      const conflicted = g("diff", "--name-only", "--diff-filter=U").out.trim().split("\n").filter(Boolean);
      const others = conflicted.filter((f) => !KEEP_BOTH_FILES.includes(f) && !KEEP_OURS_FILES.includes(f));
      if (!conflicted.length || others.length) { g("merge", "--abort"); console.error(`${b}: ${conflicted.length ? `conflicts in files this script does not resolve: ${others.join(", ")}` : `merge failed:\n${m.out}`}`); return false; }
      for (const f of conflicted) {
        if (KEEP_OURS_FILES.includes(f)) g("checkout", "--ours", "--", f);
        else writeFileSync(join(wt, f), keepBoth(readFileSync(join(wt, f), "utf8")));
        g("add", f);
      }
      const left = run(wt, ["git", "grep", "-nE", "^(<{7}( |$)|={7}$|>{7}( |$))", "--", "."], true);
      if (left.ok && left.out.trim()) { g("merge", "--abort"); console.error(`${b}: conflict markers remain:\n${left.out.slice(0, 600)}`); return false; }
      if (!g("commit", "--no-edit", "-m", msg).ok) { g("merge", "--abort"); console.error(`${b}: commit of the resolved merge failed`); return false; }
      console.log(`${b}: resolved by keeping both sides: ${conflicted.join(", ")}`);
    }
    return true;
  };

  let summary = "";
  let runNo = 1, tested: string[] = [];
  /** Builds and tests the worktree as it stands: true if it passes. */
  const check = async (): Promise<boolean> => {
    // Installs (cloned when missing), then the kernel only if kernel/ changed since the last build here.
    const w = await stream(wt, ["bun", join(main, "scripts", "worktree-warm.ts"), wt, "--no-build"]);
    if (w.code !== 0) { console.error(w.text.split("\n").slice(-20).join("\n")); return false; }
    for (const cwd of [wt, join(wt, "docs/research/cel-check")]) if (existsSync(cwd)) await stream(cwd, ["bun", "install"]);
    // The release kernel only for --full (and when kernel/ changed since the last build here). The gate builds what it
    // needs itself: the release build when it is current, else the fast `gate` profile (scripts/test.ts, gateBuild).
    if (full) {
      const tree = g("rev-parse", "HEAD:kernel").out.trim();
      const stampFile = join(wt, "kernel/target/.merge-kernel-tree");
      const there = existsSync(join(wt, "kernel/target/release/oikos-kernel")) && existsSync(join(wt, "kernel/target/wasm32-unknown-unknown/release/oikos_law.wasm"));
      let stamp: string | undefined;
      try { stamp = readFileSync(stampFile, "utf8").trim(); } catch { /* none */ }
      if (kernelStale(stamp, tree, there)) {
        const k = await stream(wt, ["bun", "run", "kernel"]);
        if (k.code !== 0) { console.error(k.text.split("\n").slice(-30).join("\n")); console.error("kernel build failed"); return false; }
        console.log("kernel built");
      } else console.log("kernel build reused (kernel/ unchanged since the last build here)");
      writeFileSync(stampFile, tree);
      writeFileSync(join(wt, "kernel/target/.oikos-built"), ""); // (the runner's own check: built since the sources)
    }
    // Typecheck alongside the tests; the selection (the kernel's cargo tests are in it when kernel/ changed).
    const tc = stream(wt, ["bun", "run", "typecheck"]);
    const t1 = Date.now();
    const suite = await stream(wt, ["bun", "scripts/test.ts", ...(full ? ["--no-build"] : ["--gate"])], log);
    // (Each test run's log is kept beside the last, by the set tested: a batch's bisection reads them after.)
    writeFileSync(join(wt, `merge-test-${runNo++}.log`), `${tested.join(" + ")}\n${suite.text}`);
    console.log(`  ${full ? "whole suite" : "gate"}: ${Math.round((Date.now() - t1) / 1000)}s`);
    const tcr = await tc;
    if (tcr.code !== 0) { console.error(tcr.text.split("\n").slice(-30).join("\n")); console.error("typecheck failed"); return false; }
    const lines = suite.text.trim().split("\n");
    summary = [...lines].reverse().find((l) => /\d+ pass, \d+ fail/.test(l)) ?? lines.pop() ?? "";
    if (suite.code !== 0) {
      const f = readFailures(suite.text);
      const flake = flakeCandidate(f);
      if (!flake) { console.error(`tests failed (${[...f.files, ...f.other].join(", ") || "see log"}); log: ${log}\n${summary}`); return false; }
      const again = await stream(wt, ["bun", "scripts/test.ts", "--gate", flake]);
      if (again.code !== 0) { console.error(`${flake} failed, and failed again alone; log: ${log}`); return false; }
      summary += ` (accepted after rerun alone: ${flake})`;
    }
    g("checkout", "--", "scripts/test-times.json", "bun.lock");
    return true;
  };

  const passes = async (set: string[]) => {
    console.log(`testing ${set.length ? set.join(" + ") : "(nothing)"} ...`);
    tested = set;
    const ok = assemble(set) && await check();
    console.log(`  ${ok ? "pass" : "FAIL"} at ${secs()}`);
    return ok;
  };

  const { accepted, rejected, runs } = await settle(branches, passes);
  if (rejected.length) console.error(`NOT MERGED (failed or conflicted): ${rejected.join(", ")}`);
  if (!accepted.length) stop(`nothing to push (${runs} test run${runs === 1 ? "" : "s"}), ${secs()}`);
  // The last run may have been of a different set (a bisection step): put the accepted set back, tested already as a prefix or whole.
  if (runs > 1 || rejected.length) { if (!assemble(accepted)) stop("could not reassemble the accepted set"); }
  const sha = g("rev-parse", "HEAD").out.trim();
  if (noPush) { console.log(`NOT PUSHED (--no-push). ${summary}\nmerge ${sha.slice(0, 8)} (${accepted.join(", ")}) in ${wt}, ${secs()}`); process.exit(rejected.length ? 1 : 0); }
  const push = Bun.spawnSync(["git", "push", "origin", "HEAD:main"], { cwd: wt, stdout: "pipe", stderr: "pipe", env: { ...process.env, OIKOS_MERGE_LOCK: String(process.pid) } });
  if (push.exitCode !== 0) { console.error(push.stderr.toString().trim()); stop("push failed (origin main moved? run again)"); }
  console.log(`PUSHED ${sha} (${accepted.join(", ")}; ${runs} test run${runs === 1 ? "" : "s"}). ${summary}\n${secs()}`);
  process.exit(rejected.length ? 1 : 0);
}
