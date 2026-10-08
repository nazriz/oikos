// scripts/worktree-clean.ts on a throwaway repository with an origin: only worktrees that are merged, clean, unlocked and
// not in use are removed (with their branch); a wave's pinned copy, a dirty one and an unmerged one stay; --targets
// deletes only kernel/target; a worktree whose runs/ holds a run is never removed.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../../scripts/worktree-clean.ts");
const base = realpathSync(mkdtempSync(join(tmpdir(), "oikos-worktree-clean-test-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const git = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
};
const clean = (repo: string, runs: string, ...a: string[]) => {
  const p = Bun.spawnSync(["bun", script, "--repo", repo, ...a], { env: { ...process.env, OIKOS_RUNS: runs }, stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString();
};

test("only merged, clean, unlocked, unused worktrees go, with their branch", () => {
  const origin = join(base, "origin.git"), repo = join(base, "repo"), runs = join(base, "runs");
  mkdirSync(origin);
  git(origin, "init", "-q", "--bare", "-b", "main");
  git(base, "clone", "-q", origin, repo);
  writeFileSync(join(repo, "a.txt"), "1\n");
  writeFileSync(join(repo, ".gitignore"), "kernel/target\nruns\n"); // (as the real repository ignores them)
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "one");
  git(repo, "push", "-q", "origin", "HEAD:main");
  git(repo, "fetch", "-q", "origin");
  const wt = (name: string, branch: string) => { git(repo, "worktree", "add", "-q", "-b", branch, join(repo, ".claude/worktrees", name), "HEAD"); return join(repo, ".claude/worktrees", name); };
  const merged = wt("merged", "b-merged"), dirty = wt("dirty", "b-dirty"), ahead = wt("ahead", "b-ahead"), wave = wt("wave-w", "b-wave"), withRuns = wt("with-runs", "b-runs"), locked = wt("locked", "b-locked");
  writeFileSync(join(dirty, "new.txt"), "x");
  writeFileSync(join(ahead, "a.txt"), "2\n");
  git(ahead, "commit", "-q", "-am", "ahead");
  mkdirSync(join(withRuns, "runs/pilot-1"), { recursive: true });
  for (const d of [merged, ahead]) { mkdirSync(join(d, "kernel/target"), { recursive: true }); writeFileSync(join(d, "kernel/target/big"), "x".repeat(2048)); }
  git(repo, "worktree", "lock", locked);
  // A queue of the wave is "running": a pid file with a live process (this test's own).
  mkdirSync(join(runs, "pilot-queues"), { recursive: true });
  writeFileSync(join(runs, "pilot-queues/w.q.pid"), `${process.pid}\n`);

  const dry = clean(repo, runs, "--dry-run");
  const verdict = (out: string, name: string) => out.split("\n").find((l) => new RegExp(`^(REMOVE|keep)\\s+${name}\\s`).test(l))!.slice(0, 6).trim();
  expect(["merged", "dirty", "ahead", "wave-w", "with-runs", "locked"].map((n) => verdict(dry, n))).toEqual(["REMOVE", "keep", "keep", "keep", "keep", "keep"]);
  expect(dry).toContain("queue running");
  expect(dry).toContain("runs/ holds runs");
  expect(existsSync(merged)).toBe(true); // (a dry run removes nothing)

  const out = clean(repo, runs, "--targets");
  expect(out).toContain("removed merged");
  expect(out).toContain("deleted branch b-merged");
  expect(existsSync(merged)).toBe(false);
  expect(git(repo, "branch", "--list", "b-merged")).toBe("");
  for (const d of [dirty, ahead, wave, withRuns, locked]) expect(existsSync(d)).toBe(true);
  expect(git(repo, "branch", "--list", "b-ahead")).toContain("b-ahead");
  // --targets took kernel/target of the one that stays and had one; nothing else of it.
  expect(existsSync(join(ahead, "kernel/target"))).toBe(false);
  expect(existsSync(join(ahead, "a.txt"))).toBe(true);
  expect(existsSync(join(withRuns, "runs/pilot-1"))).toBe(true);
}, 60_000);
