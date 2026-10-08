#!/usr/bin/env bun
// A wave of pilots on code that doesn't change under them: `bun scripts/pilot-wave.ts <wave> <git-ref> <queue.json>...
// [--dry-run] [--wait MINUTES] [--no-build] [--no-start] [--repo DIR]`. A resumed run replays its log and can only be
// resumed on the code it started on, while development goes on in other worktrees, so a wave has a worktree of its own,
// pinned to one commit: <repo>/.claude/worktrees/wave-<wave>, made at <git-ref> (or reused, if it is at that commit; a
// wave never moves to another one: name a new wave). There it installs and builds (`bun install`, `bun run kernel`),
// records the commit in <runs>/pilot-queues/<wave>.commit, and starts scripts/pilot-queue.ts from THAT worktree for each
// queue file, detached (nohup, and caffeinate on macOS), one process each; a queue already running isn't started twice.
// --dry-run says what it would do and does nothing. --no-build and --no-start are for trying the worktree part alone.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const has = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && (args.splice(i, 1), true); };
const dry = has("dry-run"), noBuild = has("no-build"), noStart = has("no-start");
const wait = flag("wait");
const repoFlag = flag("repo");
const [wave, ref, ...queues] = args;
if (!wave || !ref || !queues.length || !/^[\w.-]+$/.test(wave)) throw new Error("usage: bun scripts/pilot-wave.ts <wave> <git-ref> <queue.json>... [--dry-run] [--wait MINUTES] [--no-build] [--no-start] [--repo DIR]");

const sh = (cmd: string[], cwd: string) => { const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" }); return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() }; };
const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
const say = (line: string) => console.log(`${dry ? "[dry run] " : ""}${line}`);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// The repo is the main checkout (this script may be run from any worktree of it): the folder the git directory is in.
const here = repoFlag ? resolve(repoFlag) : resolve(import.meta.dir, "..");
const common = sh(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], here);
if (!common.ok) throw new Error(`${here} is not in a git repository: ${common.err}`);
const repo = dirname(common.out);
const runs = process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs");
const dir = join(repo, ".claude/worktrees", `wave-${wave}`);
const queueDir = join(runs, "pilot-queues");

const commit = sh(["git", "rev-parse", "--verify", `${ref}^{commit}`], repo);
if (!commit.ok) throw new Error(`${ref}: not a commit in ${repo} (fetch it first?): ${commit.err}`);
const sha = commit.out;
for (const f of queues) if (!existsSync(f)) throw new Error(`${f}: no such queue file`);

// 1. The worktree: made at the commit, or reused if it is already there at that commit.
if (existsSync(dir)) {
  const at = sh(["git", "rev-parse", "HEAD"], dir);
  if (!at.ok || at.out !== sha) throw new Error(`${dir} exists, at ${at.out || "?"}, not at ${ref} (${sha}): a wave stays on the commit it started on. Name another wave, or remove that worktree if no run in it is to be resumed.`);
  say(`reuse the worktree ${dir} (at ${sha})`);
} else {
  say(`make the worktree ${dir} at ${ref} (${sha}): git worktree add --detach`);
  if (!dry) {
    mkdirSync(dirname(dir), { recursive: true });
    const w = sh(["git", "worktree", "add", "--detach", dir, sha], repo);
    if (!w.ok) throw new Error(`git worktree add failed: ${w.err}`);
  }
}

// 2. Installed and built there (the engine is a build of the commit's own kernel).
for (const cmd of [["bun", "install"], ["bun", "run", "kernel"]]) {
  if (noBuild) continue;
  say(`in ${dir}: ${cmd.join(" ")}`);
  if (dry) continue;
  const b = Bun.spawnSync(cmd, { cwd: dir, stdout: "inherit", stderr: "inherit" });
  if (b.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed in ${dir}`);
}

// 3. The commit, recorded beside the queues.
const record = `${sha}\nwave ${wave}, ref ${ref}, worktree ${dir}\nqueues: ${queues.map((f) => resolve(f)).join(" ")}\nstarted ${new Date().toISOString()}\n`;
say(`record the commit in ${join(queueDir, `${wave}.commit`)}`);
if (!dry) {
  mkdirSync(queueDir, { recursive: true });
  writeFileSync(join(queueDir, `${wave}.commit`), record);
}

// 4. One detached queue process per queue file, run from the wave's worktree, kept awake on macOS.
for (const f of queues) {
  const file = resolve(f);
  const tag = `${wave}.${basename(file).replace(/\.json$/, "")}`;
  const pidFile = join(queueDir, `${tag}.pid`);
  const out = join(queueDir, `${tag}.out`);
  const running = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : 0;
  if (running && alive(running)) { say(`${file}: already running (pid ${running}); not started again`); continue; }
  // (The subshell is redirected as a whole, so that nothing of it holds this script's pipes; `exec` makes $! the queue's own pid.)
  const run = `(cd ${q(dir)} && OIKOS_RUNS=${q(runs)} exec nohup bun scripts/pilot-queue.ts ${q(file)}${wait ? ` --wait ${q(wait)}` : ""}) >> ${q(out)} 2>&1 < /dev/null & echo $!`;
  say(`start ${file}: ${run}`);
  const caff = platform() === "darwin";
  if (caff) say(`  and keep it awake: caffeinate -i -w <pid>`);
  say(`  its output: ${out}; its pid: ${pidFile}; its status log: ${file.replace(/\.json$/, "")}.status.log`);
  if (dry || noStart) continue;
  const pid = Number(sh(["sh", "-c", run], dir).out);
  if (!pid) throw new Error(`${file}: the queue didn't start`);
  writeFileSync(pidFile, pid + "\n");
  if (caff) sh(["sh", "-c", `nohup caffeinate -i -w ${pid} > /dev/null 2>&1 < /dev/null &`], dir);
  say(`  started, pid ${pid}`);
}
