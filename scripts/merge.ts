// Merge a branch into main the way the maintainer does by hand: `bun scripts/merge.ts <branch> [--message "..."] [--no-push]`.
// It works in its own clean worktree (.claude/worktrees/merge-bot, made if missing; never merge-main): fetch, reset to
// origin/main, `git merge --no-ff <branch>`. Conflicts in docs/decisions.md and docs/research/references.md are resolved by
// keeping both sides; any other conflict stops it. Then the kernel build, typecheck, cargo test and the whole suite (log in
// the merge worktree's merge-test.log). One failing test file that is a known timing flake under load is rerun alone and
// accepted only if it then passes; anything else stops it. Pushes to origin main only if all passed (`--no-push` to not).
// The pure parts (keep-both, marker check, failure reading) are exported and tested in merge.test.ts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const KEEP_BOTH_FILES = ["docs/decisions.md", "docs/research/references.md"];
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

// ---------------------------------------------------------------------------------------------------------------
if (import.meta.main) await main();

async function main() {
  const args = process.argv.slice(2);
  const noPush = args.includes("--no-push");
  const mi = args.indexOf("--message");
  const message = mi >= 0 ? args[mi + 1] : undefined;
  const branch = args.find((a, i) => !a.startsWith("--") && (mi < 0 || i !== mi + 1));
  if (!branch) { console.error('usage: bun scripts/merge.ts <branch> [--message "..."] [--no-push]'); process.exit(64); }

  const main = join(import.meta.dir, "..");
  const t0 = Date.now();
  const run = (cwd: string, cmd: string[], quiet = false) => {
    const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const out = p.stdout.toString() + p.stderr.toString();
    if (!quiet && p.exitCode !== 0) console.error(out.trim().split("\n").slice(-20).join("\n"));
    return { ok: p.exitCode === 0, out };
  };
  const stop = (why: string): never => { console.error(`STOPPED: ${why}`); process.exit(1); };
  const stream = async (cwd: string, cmd: string[], logPath?: string) => {
    const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
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
  if (!g("fetch", "origin", "main").ok) stop("fetch failed");
  const dirty = g("status", "--porcelain").out.trim();
  if (dirty) run(wt, ["git", "merge", "--abort"], true);
  if (!g("reset", "--hard", "origin/main").ok) stop("reset failed");
  g("clean", "-fd", "-e", "node_modules", "-e", "kernel/target");
  const ref = run(wt, ["git", "rev-parse", "--verify", "--quiet", branch]).ok ? branch : `origin/${branch}`;
  if (!run(wt, ["git", "rev-parse", "--verify", "--quiet", ref]).ok) stop(`no such branch: ${branch}`);

  const msg = `${message ?? `Merge ${branch}`}\n\n${TRAILER}`;
  const m = run(wt, ["git", "merge", "--no-ff", "-m", msg, ref], true);
  if (!m.ok) {
    const conflicted = g("diff", "--name-only", "--diff-filter=U").out.trim().split("\n").filter(Boolean);
    if (!conflicted.length) { g("merge", "--abort"); stop(`merge failed:\n${m.out}`); }
    const others = conflicted.filter((f) => !KEEP_BOTH_FILES.includes(f));
    if (others.length) { g("merge", "--abort"); stop(`conflicts in files this script does not resolve: ${others.join(", ")}`); }
    for (const f of conflicted) {
      writeFileSync(join(wt, f), keepBoth(readFileSync(join(wt, f), "utf8")));
      g("add", f);
    }
    const left = run(wt, ["git", "grep", "-nE", "^(<{7}( |$)|={7}$|>{7}( |$))", "--", "."], true);
    if (left.ok && left.out.trim()) { g("merge", "--abort"); stop(`conflict markers remain:\n${left.out.slice(0, 600)}`); }
    if (!g("commit", "--no-edit", "-m", msg).ok) stop("commit of the resolved merge failed");
    console.log(`resolved by keeping both sides: ${conflicted.join(", ")}`);
  }

  const log = join(wt, "merge-test.log");
  for (const [name, cmd] of [
    ["warm worktree (installs, cel-check, kernel build)", ["bun", join(main, "scripts", "worktree-warm.ts"), wt]],
    ["typecheck", ["bun", "run", "typecheck"]],
    ["cargo test", ["bun", "scripts/slots.ts", "--weight", "half", "--what", "merge cargo test", "--", "cargo", "test", "--release", "--manifest-path", "kernel/Cargo.toml", "--workspace", "-q"]],
  ] as [string, string[]][]) {
    const r = await stream(wt, cmd);
    if (r.code !== 0) { console.error(r.text.split("\n").slice(-30).join("\n")); stop(`${name} failed`); }
    console.log(`ok ${name}`);
  }

  const suite = await stream(wt, ["bun", "run", "test:all"], log);
  const lines = suite.text.trim().split("\n");
  const tail = [...lines].reverse().find((l) => /\d+ pass, \d+ fail/.test(l)) ?? lines.pop() ?? "";
  let summary = tail;
  if (suite.code !== 0) {
    const f = readFailures(suite.text);
    const flake = flakeCandidate(f);
    if (!flake) stop(`tests failed (${[...f.files, ...f.other].join(", ") || "see log"}); log: ${log}\n${tail}`);
    const again = await stream(wt, ["bun", "scripts/test.ts", "--no-build", flake!]);
    if (again.code !== 0) stop(`${flake} failed, and failed again alone; log: ${log}`);
    summary += ` (accepted after rerun alone: ${flake})`;
  }
  g("checkout", "--", "scripts/test-times.json", "bun.lock");

  const sha = g("rev-parse", "HEAD").out.trim();
  if (noPush) { console.log(`NOT PUSHED (--no-push). ${summary}\nmerge ${sha.slice(0, 8)} in ${wt}, ${Math.round((Date.now() - t0) / 1000)}s`); return; }
  if (!g("push", "origin", "HEAD:main").ok) stop("push failed (origin main moved? run again)");
  console.log(`PUSHED ${sha}. ${summary}\n${Math.round((Date.now() - t0) / 1000)}s`);
}
