// scripts/mini, the run server's remote control, tried on this machine (OIKOS_MINI_LOCAL: a folder stands in for the
// server, no SSH) with stand-in processes: a pretend `cli.ts` whose "run" starts a "run-one" that starts a `sleep` (its
// model call). Stopping a run touches that run's own processes and no others; a sync won't rebuild the engine under a
// run; a resume takes the run's log, never what a resume left behind.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mini = join(import.meta.dir, "../../scripts/mini");
// (Outside the repository: nothing here may ever act on it.)
const server = realpathSync(mkdtempSync(join(tmpdir(), "oikos-mini-test-")));
const started: number[] = [];
// (A zombie has ended: it waits only for a parent to read its status. Where the first process does not reap orphans, as
// in some Linux containers, a model call ended after its seed is one, and `kill -0` still finds it.)
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return !Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]).stdout.toString().trim().startsWith("Z");
};
afterAll(() => {
  for (const pid of started) if (alive(pid)) process.kill(pid, "SIGKILL"); // (only what this test started)
  rmSync(server, { recursive: true, force: true });
});

mkdirSync(join(server, "orchestrator/src"), { recursive: true });
writeFileSync(join(server, "orchestrator/src/cli.ts"), `
import { appendFileSync, writeFileSync } from "node:fs";
const [cmd, ...rest] = process.argv.slice(2);
const out = rest[rest.indexOf("--out") + 1] ?? ".";
const say = (what: string) => appendFileSync(out + "/events", what + "\\n");
if (cmd === "run") {
  // (As a batch does: each seed in its own process, started by the command's full path.)
  const seed = Bun.spawn([process.execPath, import.meta.path, "run-one", "--out", out]);
  writeFileSync(out + "/seed.pid", String(seed.pid));
  process.on("SIGTERM", () => say("the batch was asked to stop"));
  await seed.exited;
  say("the batch ended");
} else if (cmd === "run-one") {
  const call = Bun.spawn(["sleep", "600"]); // (a model call that's still out)
  writeFileSync(out + "/call.pid", String(call.pid));
  process.on("SIGTERM", () => { say("the seed closed its log"); process.exit(0); });
  setInterval(() => {}, 1000);
} else if (cmd === "resume") {
  writeFileSync("resumed.txt", rest.join(" "));
}
`);

const run = (...args: string[]) => {
  const p = Bun.spawnSync(["bash", mini, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, OIKOS_MINI_LOCAL: server, OIKOS_MINI_SETTLE: "1", OIKOS_MINI_STOP_WAIT: "15" } });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
};
const pidOf = (name: string, file = "pid") => Number(readFileSync(join(server, "runs", name, file), "utf8"));

test("stop ends a run's own processes, asked so that each closes its log, and nothing else: not a run whose name starts the same, not another's model call", async () => {
  // Two runs whose names share a start, and a process of someone else's that looks like a model call.
  for (const name of ["pilot1", "pilot10"]) {
    const r = run("run", name, "world.yaml", "--seeds", "1");
    expect(r.out).toContain(`started runs/${name}`);
  }
  const decoy = Bun.spawn(["bash", "-c", 'exec -a "codex exec decoy" sleep 601']);
  started.push(decoy.pid);
  for (let i = 0; i < 100 && !["pilot1", "pilot10"].every((n) => existsSync(join(server, "runs", n, "call.pid"))); i++) await Bun.sleep(100);
  const mine = { batch: pidOf("pilot1"), seed: pidOf("pilot1", "seed.pid"), call: pidOf("pilot1", "call.pid") };
  const other = { batch: pidOf("pilot10"), seed: pidOf("pilot10", "seed.pid"), call: pidOf("pilot10", "call.pid") };
  started.push(...Object.values(mine), ...Object.values(other));
  expect([...Object.values(mine), ...Object.values(other), decoy.pid].every(alive)).toBe(true);

  // While a run is in progress: no rebuilding the engine under it, and no resuming what's still running.
  const sync = run("sync");
  expect(sync.code).toBe(1);
  expect(sync.out).toContain("a run is in progress here");
  expect(sync.out).toContain("scripts/mini sync --force");
  const early = run("resume", "pilot1");
  expect(early.code).toBe(1);
  expect(early.out).toContain("runs/pilot1 is still running");

  const stop = run("stop", "pilot1");
  expect(stop.out).toContain("asked to stop: runs/pilot1");
  expect(stop.out).toContain(`ended what it left: pid ${mine.call}`);
  expect(stop.out).toContain("stopped runs/pilot1; resume it with: scripts/mini resume pilot1");
  await Bun.sleep(300);
  // Its own processes are gone, each asked first (the seed closed its log; the batch heard, and ended when its seed did).
  expect(Object.values(mine).map(alive)).toEqual([false, false, false]);
  const events = readFileSync(join(server, "runs/pilot1/events"), "utf8");
  expect(events).toContain("the seed closed its log");
  expect(events).toContain("the batch was asked to stop");
  expect(events).toContain("the batch ended");
  // Everyone else's are untouched.
  expect([...Object.values(other), decoy.pid].map(alive)).toEqual([true, true, true, true]);
  expect(existsSync(join(server, "runs/pilot10/events"))).toBe(false);

  // Again: nothing to stop. A pid that some other process has since been given isn't taken for the run.
  expect(run("stop", "pilot1").out).toContain("not running");
  writeFileSync(join(server, "runs/pilot1/pid"), String(decoy.pid));
  expect(run("stop", "pilot1").out).toContain("not running");
  expect(alive(decoy.pid)).toBe(true);
  // A run mini didn't start, and a name that isn't one.
  mkdirSync(join(server, "runs/by-hand"));
  expect(run("stop", "by-hand")).toMatchObject({ code: 1 });
  expect(run("stop", "../pilot10")).toMatchObject({ code: 2 });
  expect(run("stop", "pilot10; echo x")).toMatchObject({ code: 2 });
  expect(Object.values(other).every(alive)).toBe(true);

  expect(run("stop", "pilot10").out).toContain("stopped runs/pilot10");
  expect(Object.values(other).map(alive)).toEqual([false, false, false]);
  expect(alive(decoy.pid)).toBe(true);
  decoy.kill();
}, 120_000);

test("resume takes the run's own log: the one named (plain, or compressed if that's all there is), or the folder for the command to find it in; never what a resume left behind", async () => {
  const d = join(server, "runs/pilot2");
  mkdirSync(d, { recursive: true });
  for (const f of ["town.seed1.jsonl", "town.seed1.jsonl.zst", "town.seed1.stopped-1.jsonl", "town.seed1.anchors.jsonl", "town.seed2.jsonl.zst"]) writeFileSync(join(d, f), "");
  const resumed = () => readFileSync(join(server, "resumed.txt"), "utf8");
  expect(run("resume", "pilot2").out).toContain("resumed runs/pilot2");
  expect(resumed()).toBe("runs/pilot2");
  run("resume", "pilot2", "town.seed1", "--model", "codex/gpt-6.1-sol", "--budget", "5");
  expect(resumed()).toBe("runs/pilot2/town.seed1.jsonl --model codex/gpt-6.1-sol --budget 5");
  run("resume", "pilot2", "town.seed2");
  expect(resumed()).toBe("runs/pilot2/town.seed2.jsonl.zst");
  run("resume", "pilot2", "--until", "86400");
  expect(resumed()).toBe("runs/pilot2 --until 86400");
  const left = run("resume", "pilot2", "town.seed1.stopped-1");
  expect(left.code).toBe(1);
  expect(left.out).toContain("what a resume left behind");
  expect(run("resume", "pilot2", "town.seed9")).toMatchObject({ code: 1 });
  expect(run("resume", "nothing-here")).toMatchObject({ code: 1 });
  expect(readFileSync(join(d, "console.txt"), "utf8")).toBe(""); // (appended to, as the run's console)
}, 180_000);
