#!/usr/bin/env bun
// Worktrees under <repo>/.claude/worktrees/ that are no longer needed: `bun scripts/worktree-clean.ts [--dry-run]
// [--days N] [--targets] [--waves] [--repo DIR]`. Lists each with its size and state; removes only those whose HEAD is an ancestor of
// origin/main (merged), that are clean (no change, no untracked file), unlocked, not the one this runs in, with no
// process working in them, and not a wave's pinned copy (wave-*; --waves lets one go when none of its queues is running).
// Their branch goes with them when the branch itself is an ancestor of origin/main (safe even if local main is behind).
// Unmerged or dirty ones are only reported, with how old they are (older than N days, 7 by default, is flagged).
// --targets deletes just kernel/target (most of the size) of the worktrees that stay, when nothing is working in them.
// Nothing under the runs folder is ever touched: model runs are never deleted. --dry-run lists and deletes nothing.
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const run = (cmd: string[], cwd: string) => { const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" }); return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() }; };

export interface Tree { holdsRuns: boolean; path: string; name: string; head: string; branch?: string; locked: boolean; self: boolean; kb: number; targetKb: number; merged: boolean; branchMerged: boolean; dirty: boolean; inUse: string | undefined; wave: boolean; ageDays: number; verdict: "remove" | "keep" }

/** Directories some process is working in (its cwd), from lsof; empty where lsof isn't there. */
function workingDirs(): string[] {
  const p = run(["lsof", "-d", "cwd", "-Fn"], "/");
  return p.out.split("\n").filter((l) => l.startsWith("n/")).map((l) => l.slice(1));
}

/** Queues of a wave still running: pid files in <runs>/pilot-queues/<wave>.*.pid whose process is alive. */
function runningQueues(runs: string, wave: string): number[] {
  const dir = join(runs, "pilot-queues");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(`${wave}.`) && f.endsWith(".pid")).map((f) => Number(readFileSync(join(dir, f), "utf8").trim())).filter((pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  });
}

export function scan(here: string, o: { days?: number; waves?: boolean; runs?: string } = {}): { repo: string; trees: Tree[]; base?: string } {
  const common = run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], here);
  if (!common.ok) throw new Error(`${here} is not in a git repository: ${common.err}`);
  const repo = dirname(common.out);
  const runs = o.runs ?? process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs");
  const root = join(repo, ".claude/worktrees") + "/";
  const hasBase = run(["git", "rev-parse", "--verify", "-q", "origin/main"], repo).ok;
  const cwds = workingDirs();
  const self = run(["git", "rev-parse", "--show-toplevel"], here).out;
  const trees: Tree[] = [];
  let cur: Record<string, string> = {};
  const flush = () => {
    if (!cur.worktree || !cur.worktree.startsWith(root)) return;
    const path = cur.worktree, name = basename(path);
    const branch = cur.branch?.replace(/^refs\/heads\//, "");
    const kb = Number(run(["du", "-sk", path], repo).out.split(/\s/)[0]) || 0;
    const targetKb = existsSync(join(path, "kernel/target")) ? Number(run(["du", "-sk", join(path, "kernel/target")], repo).out.split(/\s/)[0]) || 0 : 0;
    const merged = hasBase && run(["git", "merge-base", "--is-ancestor", cur.HEAD!, "origin/main"], repo).ok;
    const branchMerged = !branch || (hasBase && run(["git", "merge-base", "--is-ancestor", `refs/heads/${branch}`, "origin/main"], repo).ok);
    const dirty = run(["git", "status", "--porcelain"], path).out !== "";
    const wave = name.startsWith("wave-");
    const busy = cwds.find((d) => d === path || d.startsWith(path + "/"));
    const queues = wave ? runningQueues(runs, name.slice("wave-".length)) : [];
    const inUse = busy ? `a process is working in it (${busy})` : queues.length ? `queue running (pid ${queues.join(", ")})` : undefined;
    const age = Number(run(["git", "log", "-1", "--format=%ct", cur.HEAD!], repo).out) || 0;
    const locked = "locked" in cur;
    const isSelf = path === self;
    // (A worktree's own runs/ folder is the tests' scratch space; anything else in it is a run, and runs are never deleted.)
    const rd = join(path, "runs");
    const holdsRuns = existsSync(rd) && (lstatSync(rd).isSymbolicLink() || readdirSync(rd).some((f) => !f.startsWith("test-")));
    const removable = !holdsRuns && merged && branchMerged && !dirty && !locked && !inUse && !isSelf && (!wave || !!o.waves);
    trees.push({ holdsRuns, path, name, head: cur.HEAD!.slice(0, 10), ...(branch ? { branch } : {}), locked, self: isSelf, kb, targetKb, merged, branchMerged, dirty, inUse, wave, ageDays: Math.round((Date.now() / 1000 - age) / 86400), verdict: removable ? "remove" : "keep" });
  };
  for (const line of run(["git", "worktree", "list", "--porcelain"], repo).out.split("\n")) {
    if (line === "") { flush(); cur = {}; continue; }
    const [k, ...v] = line.split(" ");
    cur[k!] = v.join(" ");
  }
  flush();
  return { repo, trees, ...(hasBase ? { base: "origin/main" } : {}) };
}

const mb = (kb: number) => `${(kb / 1024).toFixed(0)} MB`;

/** The listing as lines, and what removing would free (worktrees to remove; kernel/target of those that stay). */
export function describe(r: ReturnType<typeof scan>, days = 7): { lines: string[]; removeKb: number; targetsKb: number } {
  const lines: string[] = [];
  let removeKb = 0, targetsKb = 0;
  for (const t of r.trees) {
    const why = [t.self ? "this one" : "", t.locked ? "locked" : "", t.dirty ? "dirty" : "", t.holdsRuns ? "runs/ holds runs" : "", t.merged ? "merged" : "not merged", t.wave ? "wave copy" : "", t.inUse ?? ""].filter(Boolean);
    lines.push(`${t.verdict === "remove" ? "REMOVE" : "keep  "} ${t.name.padEnd(34)} ${mb(t.kb).padStart(8)} (kernel/target ${mb(t.targetKb)}) ${t.head} ${t.branch ?? "(detached)"}; ${why.join(", ")}${!t.merged && t.ageDays > days ? `; ${t.ageDays} days old` : ""}`);
    if (t.verdict === "remove") removeKb += t.kb;
    else if (!t.inUse && !t.self) targetsKb += t.targetKb;
  }
  return { lines, removeKb, targetsKb };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run"), targets = args.includes("--targets"), waves = args.includes("--waves");
  const days = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : 7;
  const r = scan(args.includes("--repo") ? resolve(args[args.indexOf("--repo") + 1]!) : resolve(import.meta.dir, ".."), { days, waves });
  if (!r.base) console.log("origin/main is not known here (git fetch origin main): nothing counts as merged, so nothing is removed.");
  const d = describe(r, days);
  console.log(d.lines.join("\n"));
  console.log(`\nwould free ${mb(d.removeKb)} by removing merged worktrees, and ${mb(d.targetsKb)} more by deleting kernel/target of those that stay (--targets).`);
  if (!dry) {
    for (const t of r.trees) {
      if (t.verdict === "remove") {
        const w = run(["git", "worktree", "remove", t.path], r.repo);
        if (!w.ok) { console.log(`${t.name}: not removed: ${w.err}`); continue; }
        console.log(`removed ${t.name}`);
        // (The branch is an ancestor of origin/main: nothing on it is lost, whatever local main says.)
        if (t.branch && run(["git", "branch", "-D", t.branch], r.repo).ok) console.log(`  deleted branch ${t.branch}`);
      } else if (targets && !t.inUse && !t.self && t.targetKb) {
        rmSync(join(t.path, "kernel/target"), { recursive: true, force: true });
        console.log(`deleted ${t.name}/kernel/target (${mb(t.targetKb)})`);
      }
    }
  }
}
