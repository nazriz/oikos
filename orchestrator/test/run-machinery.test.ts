// The run machinery's promises about logs (docs/reliability.md): a run's log is never overwritten; a run that stops
// says so, plainly, and can be resumed (from a compressed log too); a resumed run takes the path the stopped one took,
// failed model calls included; what a resume leaves behind is history, not another run; and a batch whose measuring
// fails still has its manifest.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MockAdapter, UsageLimitReached, type LlmAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { runBatch, runOne } from "../src/batch";
import { logsIn } from "../src/corpus";
import { exportDataset } from "../src/dataset";
import { compressLog, currentLogs, decompressLog, isLog, readLog } from "../src/logs";
import { logToResume, prepareResume, recordedCalls, Serving } from "../src/resume";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const world = join(root, "worlds/town.yaml");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(world, "utf8")) as any;
const entries = (path: string) => readLog(path).trim().split("\n").map((l) => JSON.parse(l));
const notes = (path: string) => entries(path).filter((e) => e.kind === "annotation").map((e) => e.body);
/** A folder of this file's own, emptied (test output: made here, and made again each time). */
const dir = (name: string) => {
  const d = join(root, "runs", `test-machinery-${name}`);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
};
const small = ["citizens=40", "nature=false"];

/** A model-run mayor with a fixed policy (a letter, then done for three days), counting the calls made of it, and
 * failing those whose number `fails` says to (as a provider's error would). */
function mayor(fails: (n: number) => boolean = () => false) {
  const policy = (req: LlmRequest) => req.messages.length === 1
    ? [{ type: "tool_use" as const, id: "w", name: "write", input: { to: ["finance"], text: "Please send me the figures.", as: "mayor" } }]
    : [{ type: "tool_use" as const, id: "d", name: "done_for_now", input: { days: 3 } }];
  const inner = new MockAdapter("mock", { participant: policy, translator: () => [], debrief: () => [{ type: "text", text: "Thanks." }] });
  const a = { calls: 0, provider: inner.provider, model: inner.model, complete: async (req: LlmRequest) => {
    if (fails(++a.calls)) throw new Error("the provider answered 503");
    return inner.complete(req);
  } } as LlmAdapter & { calls: number };
  return a;
}
/** The town with a model in the mayor's office, and no debrief (a debrief carries the run's own record, so one taken
 * when a run stops isn't the one taken at its end: reliability.test.ts). */
function town() {
  const config = generate({ ...spec, citizens: 40, mayor: "llm" });
  for (const p of [...config.participants, ...config.positions]) if (p.framing?.debrief) p.framing = { ...p.framing, debrief: false };
  return config;
}

test("a fresh run never overwrites a run's log: it refuses, naming the log, whether plain, compressed or left by a resume; overwriting is asked for, and never replaces a real model's answers", async () => {
  const out = dir("fresh");
  const o = { world, seed: 1, out, until: 3 * DAY, sets: small };
  const first = await runOne(o);
  const text = readFileSync(first.logPath, "utf8");
  // Again into the same folder: refused, and the log is as it was.
  await expect(runOne(o)).rejects.toThrow(/town\.seed1\.jsonl exists.*never overwritten.*another --out.*oikos resume/s);
  expect(readFileSync(first.logPath, "utf8")).toBe(text);
  // Compressed: the same.
  const zst = await compressLog(first.logPath);
  await expect(runOne(o)).rejects.toThrow(/town\.seed1\.jsonl\.zst exists/);
  expect(existsSync(zst)).toBe(true);
  // Only what a resume left behind: the same.
  const stoppedLog = join(out, "town.seed1.stopped-1.jsonl");
  writeFileSync(stoppedLog, readLog(zst));
  rmSync(zst);
  await expect(runOne(o)).rejects.toThrow(/town\.seed1\.stopped-1\.jsonl exists/);
  // From the command line too (as a batch starts each seed), and it says what to do.
  const cli = (...more: string[]) => Bun.spawnSync([process.execPath, join(root, "orchestrator/src/cli.ts"), "run-one", world, "--seed", "1", "--out", out, "--until", String(3 * DAY), "--set", small[0]!, "--set", small[1]!, ...more], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const refused = cli();
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr.toString()).toContain("runs are never overwritten. Choose another --out");
  expect(existsSync(stoppedLog)).toBe(true);
  // Asked to overwrite (as a test would, of its own folder): the mock's run is replaced.
  expect(cli("--overwrite").exitCode).toBe(0);
  expect(existsSync(stoppedLog)).toBe(false);
  expect(readFileSync(join(out, "town.seed1.jsonl"), "utf8").split("\n").slice(1).join("\n")).toBe(text.split("\n").slice(1).join("\n"));
  // A batch refuses before it starts anything, for any of its seeds; and a folder with a batch's measures refuses another.
  await expect(runBatch({ world, seeds: 2, out, until: 3 * DAY, sets: small })).rejects.toThrow(/town\.seed1\.jsonl exists.*never overwritten/s);
  expect(existsSync(join(out, "town.seed2.jsonl"))).toBe(false);
  const measured = dir("fresh-measured");
  mkdirSync(join(measured, "measure"));
  await expect(runBatch({ world, seeds: 1, out: measured, until: 3 * DAY, sets: small })).rejects.toThrow(/measure exists.*already holds a batch's measures/s);

  // A log with a real model's answers is never overwritten, even when asked: by a run, or by a batch into its folder.
  const real = dir("fresh-real");
  const realLog = join(real, "town.seed1.stopped-2.jsonl.zst");
  writeFileSync(join(real, "town.seed1.jsonl"), `${text.split("\n")[0]}\n${JSON.stringify({ seq: 1, t: 0, kind: "annotation", body: { annotation: "usage", purpose: "participant", subject: "mayor-system", provider: "codex", model: "gpt-6.1-sol", input_tokens: 10, output_tokens: 2, cost_microusd: 0 } })}\n`);
  await compressLog(join(real, "town.seed1.jsonl"));
  Bun.spawnSync(["mv", join(real, "town.seed1.jsonl.zst"), realLog]);
  for (const attempt of [() => runOne({ ...o, out: real, overwrite: true }), () => runBatch({ world, seeds: 1, out: real, until: 3 * DAY, sets: small, overwrite: true })])
    await expect(attempt()).rejects.toThrow(/holds a real model's answers \(codex\/gpt-6\.1-sol\).*whatever was asked/s);
  expect(readdirSync(real)).toEqual(["town.seed1.stopped-2.jsonl.zst"]);
}, 300_000);

test("a run that stops is reported as stopped, with why and the command that resumes it; it isn't compressed, and its summary and the batch's manifest say how it ended", async () => {
  // A stand-in for a paid provider (no network), and a spending limit the run reaches (as in batch.test.ts).
  const server = Bun.serve({ port: 0, fetch: async (req) => Response.json({ content: [{ type: "tool_use", id: "x", name: "done_for_now", input: { days: 3 } }], usage: { input_tokens: Math.ceil((await req.text()).length / 4), output_tokens: 10 } }) });
  const out = dir("stopped");
  const env = process.env.OIKOS_ANTHROPIC_KEY;
  process.env.OIKOS_ANTHROPIC_KEY = "test-key";
  const said: string[] = [];
  try {
    const o = { world, seeds: 1, out, until: 60 * DAY, sets: ["citizens=40", "mayor=llm", "framing=simulation"], model: "anthropic/claude-haiku-4-5", baseUrl: `http://localhost:${server.port}`, budgetUsd: 0.005, compress: true, log: (m: string) => said.push(m) };
    const r = await runBatch(o);
    const run = r.runs[0]!;
    expect(run.t).toBeLessThan(60 * DAY);
    expect(run.end.reason).toBe("aborted");
    expect(run.end.detail).toContain("spending limit reached");
    expect(run.stopped).toMatchObject({ by: "SpendingLimitReached" });
    const resume = `oikos resume ${join(out, "town.seed1.jsonl")} --model anthropic/claude-haiku-4-5 --budget 0.005 --base-url http://localhost:${server.port}`;
    expect(r.stopped).toEqual([{ seed: 1, runId: "town.seed1", t: run.t, why: run.stopped!.why, by: "SpendingLimitReached", resume }]);
    // The console: not a finished seed with fewer years.
    const line = said.find((m) => m.includes("seed 1:"))!;
    expect(line).toMatch(/seed 1: STOPPED at \d\.\d\d years \(day \d+\), not finished: spending limit reached/);
    expect(said.some((m) => m.includes(`resume it with: ${resume}`))).toBe(true);
    // Not compressed (it isn't finished, and that's the file its resume command names), though the batch compresses.
    expect(run.logPath).toBe(join(out, "town.seed1.jsonl"));
    expect(existsSync(run.logPath)).toBe(true);
    expect(existsSync(`${run.logPath}.zst`)).toBe(false);
    const manifest = JSON.parse(readFileSync(join(out, "batch.json"), "utf8"));
    expect(manifest.runs[0].end).toEqual(run.end);
    expect(manifest.runs[0].stopped).toEqual({ ...run.stopped, resume });
    expect(JSON.parse(readFileSync(join(out, "town.seed1.summary.json"), "utf8")).stopped).toEqual(run.stopped);
    // A run that reaches the end it was asked for isn't "stopped", and is compressed as before.
    const done = await runBatch({ world, seeds: 1, out: dir("stopped-not"), until: 3 * DAY, sets: small, compress: true, measure: false });
    expect(done.stopped).toEqual([]);
    expect(done.runs[0]!.stopped).toBeUndefined();
    expect(done.runs[0]!.end).toEqual({ reason: "aborted", detail: `stopped at ${3 * DAY}` });
    expect(done.runs[0]!.logPath.endsWith(".jsonl.zst")).toBe(true);
  } finally {
    if (env === undefined) delete process.env.OIKOS_ANTHROPIC_KEY;
    else process.env.OIKOS_ANTHROPIC_KEY = env;
    server.stop(true);
  }
}, 300_000);

test("a run asked to stop (a TERM signal) stops before its next moment, closes its log and says how to resume; a compressed log resumes, and is kept; a folder resumes its one stopped run", async () => {
  const out = dir("signal");
  const p = Bun.spawn([process.execPath, join(root, "orchestrator/src/cli.ts"), "run-one", world, "--seed", "1", "--out", out, "--set", "citizens=40", "--set", "mayor=llm"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const log = join(out, "town.seed1.jsonl");
  for (let i = 0; i < 600 && !(existsSync(log) && readFileSync(log, "utf8").split("\n").length > 2000); i++) await Bun.sleep(100);
  p.kill("SIGTERM");
  expect(await p.exited).toBe(0);
  const summary = JSON.parse(readFileSync(join(out, "town.seed1.summary.json"), "utf8"));
  expect(summary.stopped.by).toBe("StopRequested");
  expect(summary.stopped.why).toContain("asked to stop (a TERM signal)");
  const stoppedEntries = entries(log);
  expect(stoppedEntries.at(-1)).toMatchObject({ kind: "end", body: { reason: "aborted" } });
  // (Stopped to be resumed: nobody is debriefed as if their run had ended.)
  expect(stoppedEntries.some((e) => e.kind === "annotation" && e.body.annotation === "debrief")).toBe(false);
  expect(stoppedEntries.some((e) => e.kind === "annotation" && e.body.data?.debriefs_deferred)).toBe(true);

  // Compressed (as a batch would have left a log, before): resume takes it, from the folder's name alone.
  const text = readFileSync(log, "utf8");
  const zst = await compressLog(log);
  expect(existsSync(log)).toBe(false);
  expect(await logToResume(out)).toBe(log); // (written out plain; the compressed one is still there)
  expect(existsSync(zst)).toBe(true);
  rmSync(log);
  const until = summary.t + 5 * DAY;
  const r = await runOne({ resume: zst, until });
  expect(r.t).toBe(until);
  expect(r.stopped).toBeUndefined();
  // The stopped run is kept, both as it was (compressed) and plain; the resumed log starts as the stopped one did.
  expect(readLog(join(out, "town.seed1.stopped-1.jsonl.zst"))).toBe(text);
  expect(readFileSync(join(out, "town.seed1.stopped-1.jsonl"), "utf8")).toBe(text);
  // (The mock decides again by itself, the same: nothing is served to it. Served answers: the tests below.)
  expect(notes(r.logPath).find((a) => a.data?.resumed_from)!.data.resumed_from.log).toBe("town.seed1.stopped-1.jsonl");
  const [a, b] = [text.trim().split("\n"), readFileSync(r.logPath, "utf8").trim().split("\n")];
  const stopAt = a.findIndex((l) => l.includes('"stopped":'));
  expect(b.slice(1, stopAt)).toEqual(a.slice(1, stopAt));
  // Nothing left to resume in the folder now; and a second resume numbers what it leaves after both.
  await expect(logToResume(out)).rejects.toThrow("no run here stopped short");
  const again = prepareResume(r.logPath);
  expect(again.stoppedLog).toBe(join(out, "town.seed1.stopped-2.jsonl"));
}, 300_000);

test("a model call that failed is in the log, and a resumed run is served it as the same failure: the same path, the same final state, and no call made again", async () => {
  const config = town();
  // The whole run: the mayor's third call fails (its provider's error), and the run goes on.
  const whole = mayor((n) => n === 3);
  const u = await runWorld({ config, runId: "town.seed1", outDir: dir("failed-whole"), until: 40 * DAY, adapter: whole });
  expect(u.participantErrors).toBe(1);
  const failure = notes(u.logPath).filter((a) => a.annotation === "model_call_failed");
  expect(failure.length).toBe(1);
  expect(failure[0]).toMatchObject({ subject: "mayor-system", data: { purpose: "participant", provider: "mock", model: "mock", error: "mock/mock (participant, for mayor-system): the provider answered 503" } });
  expect(failure[0]!.data.system_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(failure[0]!.data.input).toBeTruthy();
  // The seat is not left empty: it sits again at its next working day's sitting (not after its usual rhythm of a week,
  // nor the three days it had last given), and is told there, in the world's terms, that it missed one (2026-10-09:
  // three seats whose calls failed did not sit again for the last five days of a run).
  const failedAt = failure[0]!.data.t as number;
  const missed = notes(u.logPath).find((a) => a.data?.participant_error)!.data.participant_error;
  const sat = notes(u.logPath).filter((a) => a.annotation === "transcript" && a.subject === "mayor-system" && a.data.purpose === "participant").find((a) => a.data.t > failedAt)!;
  const daysOn = Math.floor(sat.data.t / DAY) - Math.floor(failedAt / DAY);
  expect(daysOn).toBeGreaterThanOrEqual(1);
  expect(daysOn).toBeLessThanOrEqual(3); // (the next day, or the Monday after a Friday)
  expect(missed.back_at).toBe(sat.data.t);
  expect(JSON.stringify(sat.data.input)).toContain(`You missed your sitting on year 1, day ${Math.floor(failedAt / DAY) + 1}: you were not at your desk, and nothing was read or done that day.`);
  expect(notes(u.logPath).find((a) => a.data?.sitting_missed)!.data.sitting_missed).toMatchObject({ day: Math.floor(failedAt / DAY), back_at: sat.data.t });
  // The same run, stopped at day 20 (after the failure) ...
  const d = dir("failed-cut");
  const first = mayor((n) => n === 3);
  await runWorld({ config, runId: "town.seed1", outDir: d, until: 20 * DAY, adapter: first });
  expect(first.calls).toBeGreaterThan(3);
  // ... and resumed to day 40 with a model that's well: everything it was asked before is served, the failure as a failure.
  const r0 = prepareResume(join(d, "town.seed1.jsonl"));
  const serving = new Serving(recordedCalls(r0.stoppedLog));
  const live = mayor();
  const r = await runWorld({ config: r0.config, runId: r0.runId, outDir: d, until: 40 * DAY, adapter: serving.wrap(live), resumedFrom: { log: "town.seed1.stopped-1.jsonl", serving } });
  expect(serving.diverged).toBeUndefined();
  expect(serving.served).toBe(first.calls);
  expect(serving.servedFailures).toBe(1);
  expect(live.calls).toBe(whole.calls - first.calls);
  expect(r.stateHash).toBe(u.stateHash);
  const [lu, lr] = [readFileSync(u.logPath, "utf8").trim().split("\n"), readFileSync(r.logPath, "utf8").trim().split("\n")];
  expect(lr.slice(0, lu.length - 1)).toEqual(lu.slice(0, -1));
}, 300_000);

test("a run stopped because the model couldn't be reached resumes and goes on: the failures it had recovered from are served, the ones it stopped on are asked again", async () => {
  const config = town();
  const d = dir("unreachable");
  // The mayor's third call fails and the run goes on; then every call from the sixth: three in a row, and it stops.
  const first = mayor((n) => n === 3 || n >= 6);
  const s = await runWorld({ config, runId: "town.seed1", outDir: d, until: 60 * DAY, adapter: first });
  expect(s.stopped?.by).toBe("ModelUnreachable");
  expect(s.t).toBeLessThan(60 * DAY);
  const stop = notes(s.logPath).find((a) => a.data?.stopped)!;
  expect(stop.data).toMatchObject({ by: "ModelUnreachable", failed_calls_to_ask_again: 1 });
  expect(notes(s.logPath).filter((a) => a.annotation === "model_call_failed").length).toBe(4);
  const r0 = prepareResume(join(d, "town.seed1.jsonl"));
  const serving = new Serving(recordedCalls(r0.stoppedLog));
  const live = mayor();
  const r = await runWorld({ config: r0.config, runId: r0.runId, outDir: d, until: 60 * DAY, adapter: serving.wrap(live), resumedFrom: { log: "town.seed1.stopped-1.jsonl", serving } });
  // It gets to the end this time. The three failures it had lived through are part of its history; the last is asked again.
  expect(r.stopped).toBeUndefined();
  expect(r.t).toBe(60 * DAY);
  expect(serving.diverged).toBeUndefined();
  expect(serving.servedFailures).toBe(3);
  expect(serving.served).toBe(first.calls - 1);
  expect(live.calls).toBeGreaterThan(0);
  expect(notes(r.logPath).filter((a) => a.annotation === "model_call_failed").length).toBe(3);
}, 300_000);

test("what a translation had been answered before the run stopped on it is in the log, and a run stopped at a usage limit debriefs no one", async () => {
  // The mayor asks for something; the translator's first answer is unclear, and its second attempt meets the usage limit.
  let translations = 0;
  const adapter = new MockAdapter("mock", {
    participant: () => [{ type: "tool_use", id: "p", name: "do", input: { what: "Publish a notice: the town hall opens at nine." } }],
    translator: () => {
      if (++translations > 1) throw new UsageLimitReached("the subscription's usage limit was reached: the run stops here");
      return [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }];
    },
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  const s = await runWorld({ config: generate({ ...spec, citizens: 40, mayor: "llm" }), runId: "limit", outDir: dir("limit"), until: 30 * DAY, adapter });
  expect(s.stopped).toEqual({ by: "UsageLimitReached", why: "the subscription's usage limit was reached: the run stops here" });
  const log = notes(s.logPath);
  const stopAt = log.findIndex((a) => a.data?.stopped);
  // The first attempt was answered, and paid for: its usage and its transcript are there, before the stop.
  const usage = log.findIndex((a) => a.annotation === "usage" && a.purpose === "translator");
  const transcript = log.findIndex((a) => a.annotation === "transcript" && a.data.purpose === "translator");
  expect(usage).toBeGreaterThan(-1);
  expect(transcript).toBeGreaterThan(usage);
  expect(stopAt).toBeGreaterThan(transcript);
  expect(log[transcript]!.data.output).toEqual([{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }]);
  // And a resume would be served it.
  expect([...recordedCalls(s.logPath).keys()].some((k) => k.includes("|translator|"))).toBe(true);
  // Stopped to be resumed: no debrief (the model isn't asked while it can't answer, and the run isn't over for the mayor).
  expect(log.some((a) => a.annotation === "debrief")).toBe(false);
  expect(log.some((a) => a.data?.debrief_skipped)).toBe(false);
  expect(log.some((a) => a.data?.debriefs_deferred)).toBe(true);
}, 300_000);

test("what a resume leaves behind is history, not another run: a folder's readers take each run once, and a dataset says how its log really ended", async () => {
  const out = dir("once");
  const config = generate({ ...spec, citizens: 40, mayor: "llm" });
  await runWorld({ config, runId: "town.seed1", outDir: out, until: 10 * DAY });
  const r0 = prepareResume(join(out, "town.seed1.jsonl"));
  const serving = new Serving(recordedCalls(r0.stoppedLog));
  const r = await runWorld({ config: r0.config, runId: r0.runId, outDir: out, until: 20 * DAY, adapter: serving.wrap(new MockAdapter("mock", {})), resumedFrom: { log: "town.seed1.stopped-1.jsonl", serving } });
  expect(readdirSync(out).filter((f) => f.endsWith(".jsonl") && !f.includes("anchors")).sort()).toEqual(["town.seed1.debriefs.jsonl", "town.seed1.jsonl", "town.seed1.stopped-1.debriefs.jsonl", "town.seed1.stopped-1.jsonl"]); // (each with what its seats said in their debriefs beside it, which is no log)
  // The folder is one run: for the corpus and datasets, and for measurement.
  expect(isLog("town.seed1.stopped-1.jsonl")).toBe(false);
  expect(isLog("town.seed1.stopped-12.jsonl.zst")).toBe(false);
  expect(logsIn(out)).toEqual([r.logPath]);
  expect(currentLogs(out)).toEqual([r.logPath]);
  const measured = Bun.spawnSync([process.execPath, join(root, "orchestrator/src/cli.ts"), "measure", out, "--sql", "select count(*) as runs, max(entries) as entries from runs"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(measured.stderr.toString()).toBe("");
  expect(measured.stdout.toString()).toMatch(new RegExp(`\\b1\\b.*\\b${entries(r.logPath).length}\\b`, "s")); // one run: the resumed one, whole
  // A stopped log is still read when it's named.
  expect(logsIn(r0.stoppedLog)).toEqual([r0.stoppedLog]);
  // A run with both a plain and a compressed log (a resume from a compressed one, part-way) is still one run: the plain one.
  writeFileSync(join(out, "town.seed1.jsonl.zst"), "");
  expect(currentLogs(out)).toEqual([r.logPath]);
  rmSync(join(out, "town.seed1.jsonl.zst"));

  // A dataset's manifest: how the log itself ended (cut short at day 20, not "completed"); none, for a log cut off.
  const m = await exportDataset(r.logPath, join(out, "set"));
  expect(m.end).toEqual({ t: 20 * DAY, reason: `aborted: stopped at ${20 * DAY}` });
  const cut = join(out, "cut", "town.seed1.jsonl");
  mkdirSync(join(out, "cut"));
  writeFileSync(cut, `${readFileSync(r.logPath, "utf8").trim().split("\n").slice(0, -1).join("\n")}\n`);
  expect((await exportDataset(cut, join(out, "cut", "set"))).end.reason).toBe("unfinished: the log has no end entry");
}, 300_000);

test("a batch whose measuring fails still has its manifest, which says what failed; a compressed log is checked by its content before the plain one goes", async () => {
  const out = dir("guard");
  mkdirSync(join(out, "cost.txt")); // (so that writing the cost report fails)
  const said: string[] = [];
  const r = await runBatch({ world, seeds: 1, out, until: 3 * DAY, sets: small, compress: true, log: (m) => said.push(m) });
  expect(r.problems.length).toBe(1);
  expect(r.problems[0]).toMatch(/^measuring the runs: /);
  expect(said.some((m) => m.includes("measuring the runs failed"))).toBe(true);
  const manifest = JSON.parse(readFileSync(join(out, "batch.json"), "utf8"));
  expect(manifest.problems).toEqual(r.problems);
  expect(manifest.runs.map((x: any) => x.state_hash)).toEqual([r.runs[0]!.stateHash]);
  // (The rest went on: the log was compressed, and the manifest names it as it is now.)
  expect(manifest.runs[0].log).toBe(join(out, "town.seed1.jsonl.zst"));
  expect(existsSync(manifest.runs[0].log)).toBe(true);

  // Compressing: the same bytes back, and written out plain again, the same.
  const plain = join(out, "copy.jsonl");
  const text = readLog(manifest.runs[0].log);
  writeFileSync(plain, text);
  const zst = await compressLog(plain);
  expect(existsSync(plain)).toBe(false);
  expect(readLog(zst)).toBe(text);
  expect(await decompressLog(zst)).toBe(plain);
  expect(readFileSync(plain, "utf8")).toBe(text);
  expect(existsSync(zst)).toBe(true);
  await expect(decompressLog(zst)).rejects.toThrow("exists beside");
}, 300_000);
