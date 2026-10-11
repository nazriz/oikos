// A pilot's record is whole after it was stopped and resumed (live check 2 of 2026-10-09, finding 14): a debrief the
// model could not give is asked again by the resumed run, not skipped in a run marked done; the folder's cost report is
// the whole run's and the finished log is compressed; a queue waits until the time a limit's own message gives; and the
// pilot report gives the whole run's recorded cost and says when a debrief was never given.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stepsOf, MockAdapter, UsageLimitReached, type LlmAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { afterResume, runOne } from "../src/batch";
import { readLog } from "../src/logs";
import { pilotReport, renderReport } from "../src/pilot-report";
import { limitLifts, limitWaitMs, runState } from "../src/pilot-state";
import { prepareResume, recordedCalls, Serving } from "../src/resume";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const notes = (path: string) => readLog(path).trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "annotation").map((e) => e.body);
const dir = (name: string) => {
  const d = join(root, "runs", `test-housekeeping-${name}`);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
};
/** A model mayor (done for three days at a time) whose debrief fails as `how` says while `down.is`. */
function mayor(down: { is: boolean }, how: () => Error) {
  const inner = new MockAdapter("mock", { participant: () => [{ type: "tool_use" as const, id: "d", name: "done_for_now", input: { days: 3 } }], translator: () => [], debrief: () => [{ type: "text", text: "It went well enough." }] });
  const a = { calls: 0, provider: inner.provider, model: inner.model, complete: async (req: LlmRequest) => {
    a.calls++;
    if (req.purpose === "debrief" && down.is) throw how();
    return inner.complete(req);
  } } as LlmAdapter & { calls: number };
  return a;
}

for (const [name, how, by, stop] of [
  ["a provider's limit", () => new UsageLimitReached("the plan's limit was reached (You've hit your limit; try again at 6:58 AM): the run stops here"), "UsageLimitReached", "usage_limit"],
  ["no answer after its retries", () => new Error("no answer within 180 s"), "ModelUnreachable", "unreachable"],
] as const) {
  test(`a debrief lost to ${name} is not skipped: the run stops at its end to be resumed, and the resumed run asks it again`, async () => {
    const config = generate({ ...spec, citizens: 40, nature: false, mayor: "llm" });
    const d = dir(`debrief-${stop}`);
    const down = { is: true };
    const s = await runWorld({ config, runId: "town.seed1", outDir: d, until: 8 * DAY, adapter: mayor(down, how) });
    // It ran its days, and is not finished: it stopped there with the debrief still to give.
    expect(s.t).toBe(8 * DAY);
    expect(s.stopped?.by).toBe(by);
    expect(s.stopped?.why).toContain("a debrief could not be asked (mayor-system: ");
    const first = notes(s.logPath);
    expect(first.some((a) => a.data?.debrief_skipped !== undefined)).toBe(false);
    expect(first.some((a) => a.annotation === "debrief")).toBe(false);
    // The queue does not take it for done: it waits, and resumes.
    expect((await runState(d, 8 * DAY)).stop).toBe(stop);
    // Resumed, with the model answering: everything before is served from the log, and the debrief is asked and given.
    down.is = false;
    const r0 = prepareResume(join(d, "town.seed1.jsonl"));
    const serving = new Serving(recordedCalls(r0.stoppedLog));
    const live = mayor(down, how);
    const r = await runWorld({ config: r0.config, runId: r0.runId, outDir: d, until: 8 * DAY, adapter: serving.wrap(live), resumedFrom: { log: "town.seed1.stopped-1.jsonl", serving } });
    expect(r.stopped).toBeUndefined();
    expect(serving.diverged).toBeUndefined();
    // (The debrief, and nothing else: its questions, each a call. This stand-in answers in plain words, so each
    // answer is kept as given.)
    expect(live.calls).toBe(stepsOf("full", 0).length);
    const again = notes(r.logPath);
    expect(again.filter((a) => a.annotation === "debrief").map((a) => a.subject)).toEqual(["mayor-system"]);
    expect(again.find((a) => a.annotation === "debrief")!.data.steps[1]).toMatchObject({ id: "like", status: "unread" });
    expect(readFileSync(r.logPath.replace(/\.jsonl$/, ".debriefs.jsonl"), "utf8")).toContain("It went well enough.");
    expect(r.stateHash).toBe(s.stateHash);
    // The pilot report: whole, with the debrief given.
    writeFileSync(join(d, "PILOT.txt"), `a test\n\n${JSON.stringify({ name: "x", until: 8 * DAY })}\n`);
    const rep = await pilotReport(d, false);
    expect(rep.not_whole).toBeUndefined();
    expect(rep.debriefs).toEqual({ given: ["mayor-system"], not_given: [] });
  }, 300_000);
}

test("a resumed run's folder has the whole run's cost report, and its finished log is compressed; one stopped again stays plain", async () => {
  const d = dir("after-resume");
  const world = join(root, "worlds/town.yaml");
  const rec = await runOne({ world, seed: 1, out: d, until: 3 * DAY, sets: ["citizens=40", "nature=false", "mayor=llm"] });
  // (As a folder is left by a first stop: a cost report from before, and a plain log.)
  writeFileSync(join(d, "cost.txt"), "No model calls: every participant was run by code. Recorded: 0.00.\n");
  const done = await afterResume(rec, {});
  expect(done.problems).toEqual([]);
  expect(done.logPath).toBe(`${rec.logPath}.zst`);
  expect(existsSync(rec.logPath)).toBe(false);
  expect(existsSync(done.logPath)).toBe(true);
  const cost = readFileSync(join(d, "cost.txt"), "utf8");
  expect(cost).toContain("Cost report: 1 run");
  expect(cost).not.toContain("No model calls");
  expect(JSON.parse(readFileSync(join(d, "cost.json"), "utf8")).rows.length).toBeGreaterThan(0);
  // A run that stopped again is measured as far as it got, and left plain for its resume command.
  const d2 = dir("after-resume-stopped");
  const rec2 = await runOne({ world, seed: 1, out: d2, until: 2 * DAY, sets: ["citizens=40", "nature=false", "mayor=llm"] });
  const stopped = await afterResume({ ...rec2, stopped: { why: "a limit", by: "UsageLimitReached" } }, {});
  expect(stopped.logPath).toBe(rec2.logPath);
  expect(existsSync(rec2.logPath)).toBe(true);
  expect(existsSync(join(d2, "cost.txt"))).toBe(true);
}, 300_000);

test("a queue waits until the time a limit's own message gives, and the usual wait where it gives none", () => {
  const now = new Date(2026, 9, 9, 4, 43, 0);
  const codex = 'the Codex subscription\'s usage limit was reached ({"type":"error","message":"You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 6:58 AM."}): the run stops here; resume it once the limit resets (oikos resume <log>)';
  expect(limitLifts(codex, now)).toEqual(new Date(2026, 9, 9, 6, 58, 0));
  // Two hours and sixteen minutes, not seven tries twenty minutes apart.
  expect(limitWaitMs(codex, 20 * 60_000, now)).toEqual({ ms: (2 * 60 + 16) * 60_000, until: new Date(2026, 9, 9, 6, 59, 0) });
  expect(limitLifts("Claude usage limit reached. Your limit will reset at 3pm.", now)).toEqual(new Date(2026, 9, 9, 15, 0, 0));
  expect(limitLifts("You've hit your usage limit; resets at 5pm", new Date(2026, 9, 9, 18, 0, 0))).toEqual(new Date(2026, 9, 10, 17, 0, 0)); // (tomorrow's)
  expect(limitLifts("ERROR: You've hit your usage limit. Try again in 2 hours.", now)).toEqual(new Date(2026, 9, 9, 6, 43, 0));
  expect(limitLifts("Rate limit reached for the model. Please try again in 20s.", now)).toEqual(new Date(2026, 9, 9, 4, 43, 20));
  expect(limitLifts("try again at 12:05 AM", now)).toEqual(new Date(2026, 9, 10, 0, 5, 0));
  // Nothing readable: the usual wait. A time more than a day off, or no time at all, is not guessed at.
  expect(limitLifts("the subscription's usage limit was reached: the run stops here", now)).toBeUndefined();
  expect(limitLifts("codex exec failed after 3 attempts (no answer within 180 s)", now)).toBeUndefined();
  expect(limitWaitMs("the usage limit was reached", 20 * 60_000, now)).toEqual({ ms: 20 * 60_000 });
  // Never less than a minute, never more than twelve hours.
  expect(limitWaitMs("try again in 5s", 20 * 60_000, now).ms).toBe(65_000);
  expect(limitWaitMs("try again in 20 hours", 20 * 60_000, now).ms).toBe(12 * 3_600_000);
});

test("the pilot report gives the whole run's recorded cost, and says first when a debrief was never given", async () => {
  const d = dir("report");
  const line = (e: object) => JSON.stringify(e) + "\n";
  const usage = (t: number, subject: string, purpose: string, cost: number) => line({ kind: "annotation", t, body: { annotation: "usage", subject, purpose, provider: "claude-code", model: "x", input_tokens: 10, output_tokens: 5, cost_microusd: cost } });
  writeFileSync(join(d, "town.seed1.jsonl"), line({ kind: "header", t: 0, body: { run_id: "town.seed1" } })
    + usage(100, "mayor-system", "participant", 9_000_000) + usage(200, "translator", "translator", 540_000) + usage(5 * DAY, "mayor-system", "participant", 9_000_000)
    + line({ kind: "annotation", t: 10 * DAY, body: { annotation: "debrief", subject: "mayor-system", data: { prompt: "p", response: "r" } } })
    + line({ kind: "annotation", t: 10 * DAY, body: { annotation: "note", subject: "planning-system", data: { debrief_skipped: "the Claude plan's limit for claude -p was reached" } } })
    + line({ kind: "end", t: 10 * DAY, body: { reason: "aborted", detail: `stopped at ${10 * DAY}` } }));
  writeFileSync(join(d, "PILOT.txt"), `a test\n\n${JSON.stringify({ name: "report", until: 10 * DAY })}\n`);
  const r = await pilotReport(d, false);
  expect(r.cost).toEqual({ recorded_microusd: 18_540_000, recorded_usd: "18.54", model_calls: 3 });
  expect(r.debriefs).toEqual({ given: ["mayor-system"], not_given: [{ seat: "planning-system", why: "the Claude plan's limit for claude -p was reached" }] });
  const text = renderReport(r).split("\n");
  expect(text[0]).toBe("NOT A FINISHED PILOT: a debrief was not given: planning-system");
  expect(text).toContain("recorded cost of the whole run: 18.54 over 3 model calls (as the log records it, in the money the models are priced in); debriefs given: 1, NOT given: planning-system");
});
