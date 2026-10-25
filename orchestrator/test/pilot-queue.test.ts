// The pilot queue's reading of a pilot's folder (orchestrator/src/pilot-state.ts, used by scripts/pilot-queue.ts): a
// finished pilot's log is compressed, with a summary beside it, and is done (pilot-12 was started again for want of
// this, 2026-10-08); and why a stopped one stopped decides what the queue does next. Small fixture folders, no run.

import { afterAll, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressLog } from "../src/logs";
import { lastAlerts } from "../src/pilot-alerts";
import { framingSets, limitedProviders, localStamp, measureFailure, nextPilot, noteOf, parkedPath, providersOf, readWorldFile, runState, scanOptOuts, STEWARD_FRAMING } from "../src/pilot-state";

const UNTIL = 5_184_000;
const base = realpathSync(mkdtempSync(join(tmpdir(), "oikos-pilot-queue-test-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** A folder with a run's log (a few entries, the last an end entry or not), its summary, and what else is asked for. */
async function folder(name: string, o: { t: number; end?: { reason: string; detail: string }; stoppedBy?: string; compress?: boolean; summary?: boolean; staleSummary?: number }): Promise<string> {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "town-1000.seed4.jsonl");
  const entries = [{ kind: "header", seq: 0, t: 0, body: {} }, { kind: "event", seq: 1, t: Math.floor(o.t / 2), body: {} }, ...(o.end ? [{ kind: "end", seq: 2, t: o.t, body: o.end }] : [{ kind: "event", seq: 2, t: o.t, body: {} }])];
  writeFileSync(log, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  if (o.summary !== false) writeFileSync(join(dir, "town-1000.seed4.summary.json"), JSON.stringify({ runId: "town-1000.seed4", t: o.staleSummary ?? o.t, ...(o.end ? { end: o.end } : {}), ...(o.stoppedBy ? { stopped: { why: o.end?.detail, by: o.stoppedBy } } : {}) }));
  if (o.compress) await compressLog(log);
  return dir;
}

test("a finished pilot, its log compressed with a summary beside it, is done", async () => {
  const dir = await folder("finished", { t: UNTIL, end: { reason: "aborted", detail: `stopped at ${UNTIL}` }, compress: true });
  expect(existsSync(join(dir, "town-1000.seed4.jsonl"))).toBe(false);
  const s = await runState(dir, UNTIL);
  expect(s).toMatchObject({ stop: "done", t: UNTIL });
  expect(s.log).toBe(join(dir, "town-1000.seed4.jsonl.zst"));
}, 60_000);

test("a compressed log with no summary is read through to its last entry", async () => {
  const done = await runState(await folder("finished-bare", { t: UNTIL, end: { reason: "aborted", detail: `stopped at ${UNTIL}` }, compress: true, summary: false }), UNTIL);
  expect(done).toMatchObject({ stop: "done", t: UNTIL });
  const short = await runState(await folder("short-bare", { t: 86_400 * 10, end: { reason: "aborted", detail: "stopped at 864000" }, compress: true, summary: false }), UNTIL);
  expect(short).toMatchObject({ stop: "failed", t: 864_000 });
}, 60_000);

test("a plain log asks for the same: done, stopped at a usage limit, at its spending limit, by a signal", async () => {
  const usage = await runState(await folder("usage", { t: 864_000, end: { reason: "aborted", detail: "claude-code/x (participant, for mayor-system): You've hit your usage limit; resets at 5pm" } }), UNTIL);
  expect(usage).toMatchObject({ stop: "usage_limit", t: 864_000 });
  // (Its words hold "limit" too: it must not be waited for like the plan's.)
  const spending = await runState(await folder("spending", { t: 1_728_000, end: { reason: "aborted", detail: "spending limit reached: 24.9 spent of 25.00; the next call could cost up to 0.3" } }), UNTIL);
  expect(spending).toMatchObject({ stop: "spending_limit", t: 1_728_000 });
  const signal = await runState(await folder("signal", { t: 4_352_400, end: { reason: "aborted", detail: "the run was asked to stop (a TERM signal): it stops here; resume it with oikos resume <log>" }, stoppedBy: "StopRequested" }), UNTIL);
  expect(signal).toMatchObject({ stop: "signal", t: 4_352_400, by: "StopRequested" });
  const crash = await runState(await folder("crash", { t: 432_000, end: { reason: "aborted", detail: "participant mayor-system: something broke" } }), UNTIL);
  expect(crash).toMatchObject({ stop: "failed" });
  const noEnd = await runState(await folder("no-end", { t: 432_000, summary: false }), UNTIL);
  expect(noEnd).toMatchObject({ stop: "failed", t: 432_000 });
  const plainDone = await runState(await folder("plain-done", { t: UNTIL, end: { reason: "aborted", detail: `stopped at ${UNTIL}` } }), UNTIL);
  expect(plainDone.stop).toBe("done");
}, 60_000);

test("a plain log's own last entry outranks a summary left by an earlier stop", async () => {
  const s = await runState(await folder("stale", { t: UNTIL, end: { reason: "aborted", detail: `stopped at ${UNTIL}` }, staleSummary: 864_000 }), UNTIL);
  expect(s).toMatchObject({ stop: "done", t: UNTIL });
}, 60_000);

test("a pilot never started has no state, whether its folder is there or not", async () => {
  mkdirSync(join(base, "empty"));
  expect(await runState(join(base, "empty"), UNTIL)).toEqual({ stop: "none" });
  expect(await runState(join(base, "not-there"), UNTIL)).toEqual({ stop: "none" });
  // A folder holding only the model calls' own logs, and a log a resume left behind, has no run in it either.
  writeFileSync(join(base, "empty", "claude-code.calls.jsonl"), "{}\n");
  writeFileSync(join(base, "empty", "town-1000.seed4.stopped-1.jsonl"), "{}\n");
  expect(await runState(join(base, "empty"), UNTIL)).toEqual({ stop: "none" });
}, 60_000);

test("the status log's times are local, with the offset from UTC", () => {
  expect(localStamp(new Date(2026, 9, 8, 14, 5))).toMatch(/^2026-10-08 14:05[+-]\d\d:\d\d$/);
  const d = new Date(2026, 9, 8, 14, 5);
  const off = -d.getTimezoneOffset();
  expect(localStamp(d).slice(-6)).toBe(`${off < 0 ? "-" : "+"}${String(Math.trunc(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`);
}, 60_000);

test("the queue skips a finished, compressed pilot, writes PILOT.txt with its test flag, and reports on it", async () => {
  const runs = join(base, "runs");
  const dir = await folder("runs/pilot-x", { t: UNTIL, end: { reason: "aborted", detail: `stopped at ${UNTIL}` }, compress: true });
  expect(dir).toBe(join(runs, "pilot-x"));
  const queue = join(base, "queue.json");
  writeFileSync(queue, JSON.stringify([{ name: "pilot-x", world: "worlds/town-1000.yaml", model: "mock/mock", until: UNTIL, budget: 1, test: true, note: "a held-out test" }]));
  const p = Bun.spawnSync(["bun", join(import.meta.dir, "../../scripts/pilot-queue.ts"), queue], { env: { ...process.env, OIKOS_RUNS: runs, OIKOS_WAVE: "wv", OIKOS_NO_NOTIFY: "1", OIKOS_ALERT_CMD: `cat >> ${join(base, "hook.txt")}` }, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString();
  expect(p.exitCode).toBe(0);
  expect(out).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d[+-]\d\d:\d\d pilot-x: done \(day 60\)/m);
  expect(out).not.toMatch(/starting|resuming/);
  const text = readFileSync(join(dir, "PILOT.txt"), "utf8");
  expect(text).toContain("TEST PILOT");
  expect(JSON.parse(text.slice(text.indexOf("\n{") + 1))).toMatchObject({ name: "pilot-x", test: true });
  const rep = JSON.parse(readFileSync(join(dir, "pilot-report.json"), "utf8"));
  expect(rep).toMatchObject({ pilot: "pilot-x", test: true, note: expect.stringContaining("a held-out test") });
  expect(readFileSync(queue.replace(/\.json$/, ".status.log"), "utf8")).toContain("queue finished");
  // The alerts: a local-time line each in the wave's alerts log, and the same lines given to the hook.
  const alerts = readFileSync(join(runs, "pilot-queues/wv.alerts.log"), "utf8").trim().split("\n");
  expect(alerts.length).toBe(2);
  expect(alerts[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d[+-]\d\d:\d\d \[queue\] done: pilot-x \(day 60\)$/);
  expect(alerts[1]).toContain("queue finished");
  expect(readFileSync(join(base, "hook.txt"), "utf8").trim().split("\n")).toEqual(alerts);
  expect(lastAlerts(runs, "wv", 1)).toEqual([alerts[1]!]);
}, 60_000);

test("a pilot that is done but whose measures failed is said so: in the status log, the alerts and the report; one measured is just done", async () => {
  const runs = join(base, "runs-measures");
  const bad = await folder("runs-measures/pilot-bad", { t: UNTIL, end: { reason: "aborted", detail: `stopped at ${UNTIL}` }, compress: true });
  // (The run's own note, as a batch or a resume leaves it when its measuring throws.)
  writeFileSync(join(bad, "measure-failed.txt"), "Invalid Input Error: maximum_object_size of 16777216 bytes exceeded\n");
  // (A batch that measured with nothing to show for it: no tables.)
  const none = await folder("runs-measures/pilot-none", { t: UNTIL, end: { reason: "aborted", detail: `stopped at ${UNTIL}` }, compress: true });
  writeFileSync(join(none, "batch.json"), JSON.stringify({ measure: "0.6.0", runs: [] }));
  const good = await folder("runs-measures/pilot-good", { t: UNTIL, end: { reason: "aborted", detail: `stopped at ${UNTIL}` }, compress: true });
  writeFileSync(join(good, "batch.json"), JSON.stringify({ measure: "0.6.0", runs: [] }));
  mkdirSync(join(good, "measure/runs"), { recursive: true });
  writeFileSync(join(good, "measure/runs/town.seed4.parquet"), "x");
  expect(measureFailure(bad)).toContain("maximum_object_size");
  expect(measureFailure(none)).toContain("no measurement tables");
  expect(measureFailure(good)).toBeUndefined();
  const queue = join(base, "queue-measures.json");
  writeFileSync(queue, JSON.stringify(["pilot-bad", "pilot-none", "pilot-good"].map((name) => ({ name, world: "worlds/town-1000.yaml", model: "mock/mock", until: UNTIL, budget: 1 }))));
  const p = Bun.spawnSync(["bun", join(import.meta.dir, "../../scripts/pilot-queue.ts"), queue], { env: { ...process.env, OIKOS_RUNS: runs, OIKOS_WAVE: "wm", OIKOS_NO_NOTIFY: "1", OIKOS_ALERT_CMD: "" }, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString();
  expect(p.exitCode).toBe(0);
  expect(out).toMatch(/pilot-bad: done \(day 60\) BUT ITS MEASURES FAILED: .*maximum_object_size/);
  expect(out).toMatch(/pilot-none: done \(day 60\) BUT ITS MEASURES FAILED: no measurement tables/);
  expect(out).toMatch(/pilot-good: done \(day 60\)\s*$/m);
  const alerts = readFileSync(join(runs, "pilot-queues/wm.alerts.log"), "utf8");
  expect(alerts).toMatch(/MEASURES FAILED pilot-bad: the run is done \(day 60\) but nothing was measured: .*maximum_object_size/);
  expect(alerts).toContain("MEASURES FAILED pilot-none");
  expect(alerts).toContain("done: pilot-good (day 60)");
  expect(alerts).not.toContain("MEASURES FAILED pilot-good");
  expect(JSON.parse(readFileSync(join(bad, "pilot-report.json"), "utf8")).measures_failed).toContain("maximum_object_size");
  expect(JSON.parse(readFileSync(join(good, "pilot-report.json"), "utf8")).measures_failed).toBeUndefined();
  // And the wave's status line for it.
  mkdirSync(join(runs, "pilot-queues"), { recursive: true });
  writeFileSync(join(runs, "pilot-queues/wm.commit"), `abc123\nwave wm, ref main, worktree /x\nqueues: ${queue}\nstarted now\n`);
  const st = Bun.spawnSync(["bun", join(import.meta.dir, "../../scripts/pilot-wave.ts"), "status", "wm"], { env: { ...process.env, OIKOS_RUNS: runs }, stdout: "pipe", stderr: "pipe" }).stdout.toString();
  expect(st).toMatch(/pilot-bad: done.*MEASURES FAILED: .*maximum_object_size/);
  expect(st).not.toMatch(/pilot-good: .*MEASURES FAILED/);
}, 120_000);

test("an opt-out is found in a log as it grows, once, from where the last look ended; also in a compressed one", async () => {
  const log = join(base, "optout.seed1.jsonl");
  const line = (e: object) => JSON.stringify(e) + "\n";
  writeFileSync(log, line({ kind: "event", t: 1, body: {} }) + line({ kind: "command", t: 2_800_000, body: { command: "opt_out", participant: "finance-system", statement: "x \u00e9" } }));
  const a = await scanOptOuts(log, 0);
  expect(a.optOuts).toEqual([{ participant: "finance-system", t: 2_800_000, day: 32, statement: "x \u00e9" }]);
  expect(await scanOptOuts(log, a.offset)).toEqual({ offset: a.offset, optOuts: [], faults: [] });
  // (A line half written is left for the next look.)
  const more = line({ kind: "command", t: 3_000_000, body: { command: "opt_out", participant: "mayor-system", statement: "" } });
  appendFileSync(log, more.slice(0, 30));
  const half = await scanOptOuts(log, a.offset);
  expect(half.optOuts).toEqual([]);
  appendFileSync(log, more.slice(30));
  expect((await scanOptOuts(log, half.offset)).optOuts.map((o) => o.participant)).toEqual(["mayor-system"]);
  await compressLog(log);
  expect((await scanOptOuts(log + ".zst")).optOuts.map((o) => o.participant)).toEqual(["finance-system", "mayor-system"]);
}, 60_000);

test("a prompt too long for a seat's model, and something a seat sent that was not sent, are found in a growing log for the alerts", async () => {
  const log = join(base, "faults.seed1.jsonl");
  const line = (e: object) => JSON.stringify(e) + "\n";
  const note = (t: number, subject: string, data: object) => line({ kind: "annotation", t, body: { annotation: "note", subject, data } });
  writeFileSync(log, note(9 * 3600, "finance-seat", { prompt_too_long: { characters: 602_000, limit_was: 150_000, limit_now: 75_000 } }) + note(2 * 86_400, "mayor-seat", { not_sent: { what: "letter", why: "the letter named nobody it could go to" } }) + note(5, "mayor-seat", { no_turn: {} }));
  const a = await scanOptOuts(log, 0);
  expect(a.optOuts).toEqual([]);
  expect(a.faults).toEqual([
    { participant: "finance-seat", t: 9 * 3600, day: 0, kind: "prompt_too_long", detail: "602000 characters; cut to 75000 from now on" },
    { participant: "mayor-seat", t: 2 * 86_400, day: 2, kind: "not_sent", detail: "the letter named nobody it could go to" },
  ]);
  expect((await scanOptOuts(log, a.offset)).faults).toEqual([]);
});

test("a sitting a seat missed is heard of while the pilot runs; a run stopped with its model not answering is waited for, not left as a failure", async () => {
  const log = join(base, "missed.seed1.jsonl");
  const note = (t: number, subject: string, data: object) => JSON.stringify({ kind: "annotation", t, body: { annotation: "note", subject, data } }) + "\n";
  writeFileSync(log, note(24 * 86_400 + 32_400, "mayor-seat", { sitting_missed: { day: 24, midway: false, back_at: 25 * 86_400 + 32_400, why: "model_call_failed", error: "codex exec failed after 3 attempts (no answer within 180 s)" } })
    + note(3 * 86_400, "finance-seat", { sitting_missed: { day: 3, back_at: 4 * 86_400, why: "prompt_too_long" } }));
  // (A prompt too long is told by its own note: not twice.)
  expect((await scanOptOuts(log, 0)).faults).toEqual([{ participant: "mayor-seat", t: 24 * 86_400 + 32_400, day: 24, kind: "sitting_missed", detail: "it sits again on day 25 (codex exec failed after 3 attempts (no answer within 180 s))" }]);
  const down = "the model can't be reached (3 calls in a row failed; the last: codex/x (participant, for mayor-seat): codex exec failed after 3 attempts (no answer within 180 s)): the run stops here; resume it once it can be (oikos resume <log>)";
  expect(await runState(await folder("unreachable", { t: 864_000, end: { reason: "aborted", detail: down }, stoppedBy: "ModelUnreachable" }), UNTIL)).toMatchObject({ stop: "unreachable", t: 864_000 });
  expect(await runState(await folder("unreachable-bare", { t: 864_000, end: { reason: "aborted", detail: down }, summary: false }), UNTIL)).toMatchObject({ stop: "unreachable" });
}, 60_000);

// ---- A pilot stopped at a usage limit is parked, and the queue goes on (2026-10-09).

test("a limit is a sign-in's: which ones an entry needs, and whose limit a stop names", () => {
  expect(providersOf({ model: "codex/a", translator: "claude-code/b" })).toEqual(["codex", "claude-code"]);
  expect(providersOf({ model: "claude-code/a", translator: "claude-code/b" })).toEqual(["claude-code"]);
  expect(providersOf({ model: "claude-code/a" })).toEqual(["claude-code"]);
  const both = ["codex", "claude-code"];
  expect(limitedProviders("the Codex subscription's usage limit was reached (You've hit your usage limit): the run stops here", both)).toEqual(["codex"]);
  expect(limitedProviders("the Claude plan's limit for claude -p was reached (You've hit your session limit): the run stops here", both)).toEqual(["claude-code"]);
  expect(limitedProviders("codex/x (translator, for mayor-system): too many requests", both)).toEqual(["codex"]);
  // (Words that name neither: nothing the entry uses is tried until the wait is over.)
  expect(limitedProviders("429", both)).toEqual(both);
});

test("the next entry is the first not settled whose sign-ins are not at a limit; a parked one comes first again when its wait is over", () => {
  const q = [{ name: "a", model: "codex/x", translator: "claude-code/s" }, { name: "b", model: "claude-code/s", translator: "claude-code/s" }, { name: "c", model: "codex/x", translator: "decide/t" }, { name: "d", model: "claude-code/h", translator: "decide/t" }];
  const none = new Map<string, number>();
  expect(nextPilot(q, new Set(), none, 100).pick?.name).toBe("a");
  const codex = new Map([["codex", 500]]);
  expect(nextPilot(q, new Set(), codex, 100).pick?.name).toBe("b");
  expect(nextPilot(q, new Set(["b"]), codex, 100).pick?.name).toBe("d");
  // Only parked ones left: wait for the time the limit is tried again; then the first of them, in the queue's order.
  expect(nextPilot(q, new Set(["b", "d"]), codex, 100)).toEqual({ waitUntil: 500 });
  expect(nextPilot(q, new Set(["b", "d"]), codex, 500).pick?.name).toBe("a");
  // A wait that ends while later entries are still to run: the parked pilot is taken up before them.
  expect(nextPilot(q, new Set(["b"]), codex, 500).pick?.name).toBe("a");
  // Both sign-ins at a limit: the earlier of the two times, for whichever entry it frees.
  expect(nextPilot(q, new Set(), new Map([["codex", 500], ["claude-code", 300]]), 100)).toEqual({ waitUntil: 300 });
  expect(nextPilot(q, new Set(["a", "b", "c", "d"]), codex, 100)).toEqual({});
});

/** A stand-in for the CLI the queue runs: a run on a Codex model stops at a usage limit until the third time one is
 * tried (counted in a file), and any other run goes to its end. It writes the log a real run would leave. */
function standIn(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const script = join(dir, "cli.ts");
  writeFileSync(script, `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const a = process.argv.slice(2);
if (a[0] === "pilot-report") process.exit(0);
const get = (n: string) => a[a.indexOf(n) + 1]!;
const until = Number(get("--until")), model = get("--model");
const log = a[0] === "resume" ? a[1]! : join(get("--out"), "town.seed1.jsonl");
const count = ${JSON.stringify(join(dir, "codex-tries"))};
let open = true;
if (model.startsWith("codex/")) {
  const n = (existsSync(count) ? Number(readFileSync(count, "utf8")) : 0) + 1;
  writeFileSync(count, String(n));
  open = n >= 3;
}
appendFileSync(${JSON.stringify(join(dir, "ran.txt"))}, a[0] + " " + log.split("/").at(-2) + (open ? " to the end" : " limit") + "\\n");
const end = open ? { kind: "end", t: until, body: { reason: "aborted", detail: "stopped at " + until } }
  : { kind: "end", t: 16 * 86400, body: { reason: "aborted", detail: "the Codex subscription's usage limit was reached (You've hit your usage limit. Upgrade to Pro): the run stops here; resume it once the limit resets" } };
writeFileSync(log, [{ kind: "header", t: 0, body: {} }, { kind: "event", t: 5, body: {} }, end].map((e) => JSON.stringify(e)).join("\\n") + "\\n");
process.exit(open ? 0 : 1);
`);
  return script;
}
const QUEUE = join(import.meta.dir, "../../scripts/pilot-queue.ts");
const entry = (name: string, model: string) => ({ name, world: "worlds/town-1000.yaml", model, translator: "claude-code/s", framing: "unstated", until: 30 * 86_400, budget: 1 });
const queueEnv = (runs: string, cli: string) => ({ ...process.env, OIKOS_RUNS: runs, OIKOS_WAVE: "pk", OIKOS_NO_NOTIFY: "1", OIKOS_ALERT_CMD: "", OIKOS_POLL_SECONDS: "0.2", OIKOS_QUEUE_CLI: cli });

test("a pilot at a usage limit is parked and the queue goes on to what needs another sign-in; it is come back to, and nothing is lost", async () => {
  const here = join(base, "parking"), runs = join(here, "runs");
  const cli = standIn(here);
  const queue = join(here, "lane.json");
  writeFileSync(queue, JSON.stringify([entry("codex-a", "codex/x"), entry("claude-b", "claude-code/s"), entry("codex-c", "codex/x"), entry("claude-d", "claude-code/h")]));
  const p = Bun.spawn(["bun", QUEUE, queue, "--wait", "0.02"], { env: queueEnv(runs, cli), stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  expect(code).toBe(0);
  const at = (re: RegExp) => { const m = re.exec(out); expect(m, String(re)).not.toBeNull(); return m!.index; };
  // Parked, by the sign-in that said so, on the day it stopped; and the queue went on to the Claude pilot at once.
  expect(out).toMatch(/codex-a: parked at a usage limit on day 16 \(codex: the Codex subscription's usage limit/);
  expect(at(/claude-b: starting/)).toBeGreaterThan(at(/codex-a: parked/));
  expect(at(/claude-b: done \(day 30\)/)).toBeLessThan(at(/codex-a: done \(day 30\)/));
  // The other Codex pilot was not started while that sign-in was at its limit: only after the parked one got through.
  expect(at(/codex-c: starting/)).toBeGreaterThan(at(/codex-a: done/));
  expect(out).toMatch(/codex-a: resuming from day 16/);
  for (const n of ["codex-a", "claude-b", "codex-c", "claude-d"]) expect(out).toMatch(new RegExp(`${n}: done \\(day 30\\)`));
  // The stand-in was run for codex-a three times (two limits, then through), and once for each other: nothing was skipped or run twice.
  const ran = readFileSync(join(here, "ran.txt"), "utf8").trim().split("\n");
  expect(ran.filter((l) => l.includes("codex-a"))).toEqual(["run codex-a limit", "resume codex-a limit", "resume codex-a to the end"]);
  expect(ran.filter((l) => !l.includes("codex-a")).sort()).toEqual(["run claude-b to the end", "run claude-d to the end", "run codex-c to the end"]);
  // The alerts name what was parked and for whom; nothing is parked at the end.
  const alerts = readFileSync(join(runs, "pilot-queues/pk.alerts.log"), "utf8");
  expect(alerts).toMatch(/\[lane\] PARKED codex-a: at a usage limit \(codex\) on day 16; the queue goes on to what does not need codex/);
  expect(alerts).toContain("usage-limit wait over for codex-a: trying again");
  expect(JSON.parse(readFileSync(parkedPath(queue), "utf8"))).toEqual([]);
  expect(out.trim().split("\n").at(-1)).toContain("queue finished");
}, 120_000);

test("with only a parked pilot left the queue waits and says so, and its note names it; --no-park waits on the pilot itself, as before", async () => {
  const here = join(base, "no-park"), runs = join(here, "runs");
  const cli = standIn(here);
  const queue = join(here, "lane.json");
  writeFileSync(queue, JSON.stringify([entry("codex-a", "codex/x"), entry("claude-b", "claude-code/s")]));
  const p = Bun.spawn(["bun", QUEUE, queue, "--wait", "0.02", "--no-park"], { env: queueEnv(runs, cli), stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  expect(code).toBe(0);
  expect(out).toMatch(/codex-a: stopped at a usage limit on day 16 .*asking again in 0\.02 minutes/);
  expect(out).not.toContain("parked");
  expect(out.indexOf("claude-b: starting")).toBeGreaterThan(out.indexOf("codex-a: done (day 30)"));
  // A queue whose only entry stays at its limit: its note says what is parked, for whom, and when it is next tried.
  const stuck = join(base, "stuck"), q2 = join(stuck, "lane.json");
  const cli2 = standIn(stuck);
  writeFileSync(q2, JSON.stringify([entry("codex-a", "codex/x")]));
  const p2 = Bun.spawn(["bun", QUEUE, q2, "--wait", "30"], { env: queueEnv(join(stuck, "runs"), cli2), stdout: "ignore", stderr: "ignore" });
  try {
    let note: any[] = [];
    for (let i = 0; i < 600 && !note.length; i++) { await Bun.sleep(100); try { note = JSON.parse(readFileSync(parkedPath(q2), "utf8")); } catch { /* (not written yet) */ } }
    expect(note).toEqual([{ name: "codex-a", day: 16, providers: ["codex"], since: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d/), next_try: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d/) }]);
    let said = "";
    for (let i = 0; i < 100 && !said.includes("nothing else can run"); i++) { await Bun.sleep(100); said = readFileSync(q2.replace(/\.json$/, ".status.log"), "utf8"); }
    expect(said).toMatch(/nothing else can run: waiting for codex-a \(parked at a usage limit; the next try at \d{4}/);
  } finally {
    p2.kill();
  }
}, 120_000);

test("an entry's first translator and its arrangement are passed to the run, and to its resume", async () => {
  const here = join(base, "first"), runs = join(here, "runs");
  mkdirSync(here, { recursive: true });
  // (A stand-in for the CLI that keeps what it was asked: stopped by a signal's word the first time, through the second.)
  const cli = join(here, "cli.ts");
  writeFileSync(cli, `
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const a = process.argv.slice(2);
if (a[0] === "pilot-report") process.exit(0);
const get = (n: string) => a[a.indexOf(n) + 1]!;
const log = a[0] === "resume" ? a[1]! : join(get("--out"), "town.seed1.jsonl");
const asked = ${JSON.stringify(join(here, "asked.txt"))};
const again = existsSync(asked);
appendFileSync(asked, a.filter((x) => !x.includes("/runs/")).join(" ") + "\\n");
const until = Number(get("--until"));
const end = again ? { kind: "end", t: until, body: { reason: "aborted", detail: "stopped at " + until } } : { kind: "end", t: 86400, body: { reason: "aborted", detail: "the Claude plan's limit for claude -p was reached (You have hit your limit): the run stops here" } };
writeFileSync(log, [{ kind: "header", t: 0, body: {} }, end].map((e) => JSON.stringify(e)).join("\\n") + "\\n");
process.exit(again ? 0 : 1);
`);
  const queue = join(here, "lane.json");
  writeFileSync(queue, JSON.stringify([{ ...entry("ours-first", "claude-code/s"), translator_first: "decide/pod-small-r2-s1", translator_arrangement: "then" }]));
  const p = Bun.spawn(["bun", QUEUE, queue, "--wait", "0.02"], { env: queueEnv(runs, cli), stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  expect(code).toBe(0);
  expect(out).toContain("ours-first: starting (framing unstated; claude-code/s, translator claude-code/s, decide/pod-small-r2-s1 first (then))");
  // The one behind at its usage limit: the pilot is parked for that sign-in, as any is, and taken up again.
  expect(out).toMatch(/ours-first: parked at a usage limit on day 1 \(claude-code: /);
  expect(out).toContain("ours-first: done (day 30)");
  const asked = readFileSync(join(here, "asked.txt"), "utf8").trim().split("\n");
  expect(asked.length).toBe(2);
  expect(asked[0]).toStartWith("run worlds/town-1000.yaml --seeds 1 --out");
  // What its seats are told the town is goes to the run it starts, and not to its resume (the log's header has it).
  expect(asked[0]).toContain("--set framing=unstated --model");
  expect(asked[1]).not.toContain("framing");
  for (const line of asked) expect(line).toEndWith("--model claude-code/s --translator-model claude-code/s --translator-first decide/pod-small-r2-s1 --translator-arrangement then --budget 1");
  expect(asked[1]).toStartWith("resume ");
}, 60_000);

test("a pilot's framing: the entry's own, else its world file's own, and never a default (a run with a model is then refused); honest disclosure by name", () => {
  const generated = { generate: "town", name: "Millbrook" };
  expect(STEWARD_FRAMING).toBe("unstated");
  expect(framingSets({}, generated)).toEqual({ sets: [], said: 'NO FRAMING CHOSEN: a run with a model is refused (write "framing": "unstated" or "simulation", or per seat)' });
  expect(framingSets({}).sets).toEqual([]);
  expect(framingSets({ framing: "simulation" }, generated)).toEqual({ sets: ["framing=simulation"], said: "framing simulation" });
  expect(framingSets({ framing: { disclosure: "simulation", reason: "The arm under honest disclosure." } }, generated)).toEqual({ sets: ['framing={"disclosure":"simulation","reason":"The arm under honest disclosure."}'], said: "framing simulation" });
  // A world file that says its own is left to say it; a world that is not generated carries its participants' framing in itself.
  expect(framingSets({}, { ...generated, framing: "simulation" })).toEqual({ sets: [], said: "framing simulation (its world's own)" });
  expect(framingSets({}, { participants: [] })).toEqual({ sets: [], said: "framing as its world's participants have it" });
  expect(readWorldFile(join(import.meta.dir, "../../worlds/town-300.yaml"))).toMatchObject({ generate: "town", citizens: 300 });
  expect(readWorldFile(join(base, "no-such-world.yaml"))).toBeUndefined();
});

test("a note that names the caseload dial is followed by what the dial reaches: the other offices, not the landlords or the tribunal", () => {
  const said = noteOf("opening_caseload with opening_caseload_scale_bps a PILOT'S DIAL for the tribunal's caseload");
  expect(said).toContain("PILOT'S DIAL for the tribunal's caseload"); // (the note itself is not edited)
  expect(said).toMatch(/OTHER offices \(support, desks, planning, bank, finance\)\. It does not reach the landlords' or the tribunal's/);
  expect(noteOf("a held-out test")).toBe("a held-out test");
  expect(noteOf(undefined)).toBe("");
});

