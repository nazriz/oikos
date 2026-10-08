// The pilot queue's reading of a pilot's folder (orchestrator/src/pilot-state.ts, used by scripts/pilot-queue.ts): a
// finished pilot's log is compressed, with a summary beside it, and is done (pilot-12 was started again for want of
// this, 2026-10-08); and why a stopped one stopped decides what the queue does next. Small fixture folders, no run.

import { afterAll, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressLog } from "../src/logs";
import { lastAlerts } from "../src/pilot-alerts";
import { localStamp, runState, scanOptOuts } from "../src/pilot-state";

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
