// scripts/pilot-wave.ts: a wave's own worktree, pinned to one commit, and its queues started from it. Tried on a
// throwaway repository (outside this one: nothing here acts on the real worktrees), with the build and the start of the
// queue processes left out (--no-build, --no-start); and a dry run on this repository, which changes nothing.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../../scripts/pilot-wave.ts");
const base = realpathSync(mkdtempSync(join(tmpdir(), "oikos-pilot-wave-test-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
};
const wave = (cwd: string, runs: string, ...a: string[]) => {
  const p = Bun.spawnSync(["bun", script, ...a], { cwd, env: { ...process.env, OIKOS_RUNS: runs }, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

test("a wave makes its worktree at the commit, records it, and never moves to another", () => {
  const repo = join(base, "repo"), runs = join(base, "runs");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "one");
  const one = git(repo, "rev-parse", "HEAD");
  git(repo, "tag", "wave-one");
  const queue = join(base, "q.json");
  writeFileSync(queue, "[]");

  const dry = wave(repo, runs, "w1", "wave-one", queue, "--dry-run", "--repo", repo);
  expect(dry.code).toBe(0);
  expect(dry.out).toContain(`[dry run] make the worktree ${join(repo, ".claude/worktrees/wave-w1")} at wave-one (${one})`);
  expect(dry.out).toContain("bun install");
  expect(dry.out).toContain("bun run kernel");
  expect(dry.out).toMatch(/nohup bun scripts\/pilot-queue\.ts .*q\.json/);
  expect(existsSync(join(repo, ".claude/worktrees/wave-w1"))).toBe(false); // (a dry run does nothing)
  expect(existsSync(runs)).toBe(false);

  const real = wave(repo, runs, "w1", "wave-one", queue, "--no-build", "--no-start", "--repo", repo);
  expect(real.code).toBe(0);
  const dir = join(repo, ".claude/worktrees/wave-w1");
  expect(git(dir, "rev-parse", "HEAD")).toBe(one);
  expect(readFileSync(join(runs, "pilot-queues/w1.commit"), "utf8").split("\n")[0]).toBe(one);

  // Development goes on; the wave stays where it was, and asking for it again at the same commit reuses it.
  writeFileSync(join(repo, "a.txt"), "two\n");
  git(repo, "commit", "-q", "-am", "two");
  expect(wave(repo, runs, "w1", "wave-one", queue, "--no-build", "--no-start", "--repo", repo).out).toContain(`reuse the worktree ${dir}`);
  const moved = wave(repo, runs, "w1", "main", queue, "--no-build", "--no-start", "--repo", repo);
  expect(moved.code).not.toBe(0);
  expect(moved.err).toContain("a wave stays on the commit it started on");
  expect(git(dir, "rev-parse", "HEAD")).toBe(one);
  expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\n");

  // A ref that isn't a commit, and a queue file that isn't there, are refused before anything is made.
  expect(wave(repo, runs, "w2", "no-such-ref", queue, "--repo", repo).code).not.toBe(0);
  expect(wave(repo, runs, "w2", "main", join(base, "missing.json"), "--repo", repo).code).not.toBe(0);
  expect(existsSync(join(repo, ".claude/worktrees/wave-w2"))).toBe(false);
});

test("run from a worktree of this repository, a dry run names the main checkout's worktrees folder and starts nothing", () => {
  const runs = join(base, "runs-dry");
  const queue = join(base, "q2.json");
  writeFileSync(queue, "[]");
  const r = wave(join(import.meta.dir, "../.."), runs, "dry-test-wave", "HEAD", queue, "--dry-run");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/\.claude\/worktrees\/wave-dry-test-wave /);
  expect(r.out).not.toMatch(/\.claude\/worktrees\/[^ ]*\.claude\/worktrees/); // (not nested inside a worktree)
  expect(existsSync(runs)).toBe(false);
});

test("the queue is started detached, from the wave's worktree, once", async () => {
  const repo = join(base, "repo3"), runs = join(base, "runs3");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  // (A stand-in queue: it says where it ran from and which queue it was given, and stays a moment.)
  writeFileSync(join(repo, "scripts/pilot-queue.ts"), `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.OIKOS_RUNS + "/ran", process.cwd() + "\\n" + process.argv.slice(2).join(" "));\nawait Bun.sleep(5000);\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "queue");
  const queue = join(base, "q3.json");
  writeFileSync(queue, "[]");
  mkdirSync(runs);
  const first = wave(repo, runs, "w3", "main", queue, "--no-build", "--repo", repo, "--wait", "7");
  expect(first.code).toBe(0);
  const pid = Number(readFileSync(join(runs, "pilot-queues/w3.q3.pid"), "utf8"));
  try {
    for (let i = 0; i < 100 && !existsSync(join(runs, "ran")); i++) await Bun.sleep(50);
    expect(readFileSync(join(runs, "ran"), "utf8")).toBe(`${join(repo, ".claude/worktrees/wave-w3")}\n${queue} --wait 7`);
    expect(wave(repo, runs, "w3", "main", queue, "--no-build", "--repo", repo).out).toContain(`already running (pid ${pid})`);
  } finally {
    try { process.kill(pid, "SIGKILL"); } catch { /* (already gone) */ }
  }
});
