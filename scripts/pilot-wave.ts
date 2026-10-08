#!/usr/bin/env bun
// A wave of pilots on code that doesn't change under them: `bun scripts/pilot-wave.ts <wave> <git-ref> <queue.json>...
// [--dry-run] [--wait MINUTES] [--no-build] [--no-start] [--repo DIR]`. A resumed run replays its log and can only be
// resumed on the code it started on, while development goes on in other worktrees, so a wave has a worktree of its own,
// pinned to one commit: <repo>/.claude/worktrees/wave-<wave>, made at <git-ref> (or reused, if it is at that commit; a
// wave never moves to another one: name a new wave). There it installs and builds (`bun install`, `bun run kernel`),
// records the commit in <runs>/pilot-queues/<wave>.commit, and starts scripts/pilot-queue.ts from THAT worktree for each
// queue file, detached (nohup, and caffeinate on macOS), one process each; a queue already running isn't started twice.
// --dry-run says what it would do and does nothing. --no-build and --no-start are for trying the worktree part alone.
// --mock [--mock-days N] runs every pilot of the queue files on the mock instead (scripts/pilot-mock.ts), from the wave's
// worktree, into <runs>/pilot-queues/<wave>.mock/, and starts nothing. `bun scripts/pilot-wave.ts status <wave>` says,
// per queue and pilot, where it stands, and the last alerts (<runs>/pilot-queues/<wave>.alerts.log). Starting a wave
// also lists the worktrees that scripts/worktree-clean.ts could free (it never deletes by itself).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { lastAlerts } from "../orchestrator/src/pilot-alerts";
import { runState, scanOptOuts } from "../orchestrator/src/pilot-state";
import { describe, scan } from "./worktree-clean";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const has = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && (args.splice(i, 1), true); };
const dry = has("dry-run"), noBuild = has("no-build"), noStart = has("no-start");
const wait = flag("wait");
const repoFlag = flag("repo");
const mock = has("mock"), noList = has("no-list");
const mockDays = flag("mock-days") ?? "30";
if (args[0] === "status") {
  const w = args[1];
  if (!w) throw new Error("usage: bun scripts/pilot-wave.ts status <wave>");
  const runs = process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs");
  const record = join(runs, "pilot-queues", `${w}.commit`);
  if (!existsSync(record)) throw new Error(`${record}: no such wave (it records its commit when it starts)`);
  const text = readFileSync(record, "utf8").split("\n");
  console.log(`wave ${w} at ${text[0]} (${text[1]})`);
  for (const file of (text.find((l) => l.startsWith("queues: ")) ?? "queues: ").slice(8).split(" ").filter(Boolean)) {
    const pidFile = join(runs, "pilot-queues", `${w}.${basename(file).replace(/\.json$/, "")}.pid`);
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : 0;
    console.log(`queue ${basename(file)}: ${pid && (() => { try { process.kill(pid, 0); return true; } catch { return false; } })() ? `running (pid ${pid})` : "not running"}`);
    for (const p of JSON.parse(readFileSync(file, "utf8")) as any[]) {
      const d = join(runs, p.name);
      const st = await runState(d, p.until);
      const day = (t?: number) => Math.round((t ?? 0) / 86_400);
      let more = "";
      if (st.log) {
        const opt = (await scanOptOuts(st.log).catch(() => ({ optOuts: [] as any[] }))).optOuts;
        if (opt.length) more += `; opted out: ${opt.map((o) => `${o.participant} day ${o.day}`).join(", ")}`;
      }
      const rep = join(d, "pilot-report.json");
      if (existsSync(rep)) { try { const t = JSON.parse(readFileSync(rep, "utf8")).translator_report; if (t) more += `; ${t.requests} requests, ${t.matters_through_within_two_tries} of ${t.matters} matters through within two tries`; } catch { /* (a report half written) */ } }
      const where = { none: "not started", done: "done", usage_limit: "waiting at a usage limit", spending_limit: "stopped at its spending limit", signal: "asked to stop", failed: "stopped (failed or running)" }[st.stop];
      console.log(`  ${p.name}${p.test ? " [test]" : ""}: ${where}${st.t !== undefined ? `, day ${day(st.t)} of ${day(p.until)}` : ""}${st.detail && st.stop !== "done" ? ` (${String(st.detail).slice(0, 100)})` : ""}${more}`);
    }
  }
  const a = lastAlerts(runs, w, 5);
  console.log(a.length ? `last alerts:\n${a.map((l) => "  " + l).join("\n")}` : "no alerts");
  process.exit(0);
}
const [wave, ref, ...queues] = args;
if (!wave || !ref || !queues.length || !/^[\w.-]+$/.test(wave)) throw new Error("usage: bun scripts/pilot-wave.ts <wave> <git-ref> <queue.json>... [--dry-run] [--wait MINUTES] [--no-build] [--no-start] [--mock [--mock-days N]] [--no-list] [--repo DIR] | status <wave>");

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

// 2b. A dry run on the mock instead of the real thing: nothing is recorded or started.
if (mock) {
  const outRoot = join(queueDir, `${wave}.mock`);
  const cmd = ["bun", "scripts/pilot-mock.ts", wave, ...queues.map((f) => resolve(f)), "--days", mockDays];
  say(`in ${dir}: ${cmd.join(" ")} (into ${outRoot})`);
  if (dry) process.exit(0);
  process.exit(Bun.spawnSync(cmd, { cwd: dir, env: { ...process.env, OIKOS_RUNS: runs }, stdout: "inherit", stderr: "inherit" }).exitCode ?? 1);
}

// 2c. What could be cleaned up: a listing only (scripts/worktree-clean.ts removes, when asked).
try {
  if (noList) throw new Error("left out (--no-list)");
  const listing = describe(scan(here, {}));
  say(`worktrees: ${(listing.removeKb / 1024).toFixed(0)} MB in merged ones that scripts/worktree-clean.ts would remove, ${(listing.targetsKb / 1024).toFixed(0)} MB more in kernel/target (--targets); nothing is deleted here`);
} catch (e) {
  say(`worktrees: could not be listed (${String((e as Error).message).slice(0, 100)})`);
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
  const run = `(cd ${q(dir)} && OIKOS_RUNS=${q(runs)} OIKOS_WAVE=${q(wave)} exec nohup bun scripts/pilot-queue.ts ${q(file)}${wait ? ` --wait ${q(wait)}` : ""}) >> ${q(out)} 2>&1 < /dev/null & echo $!`;
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
