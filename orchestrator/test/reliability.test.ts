// Reliability (D59): every way a run can go wrong ends in its documented way. Timing failures (a stall, a dead
// kernel) stop the run cleanly with a diagnosis; deterministic ones (a module that throws, a model call that fails
// after its retries) are recovered in place; a stopped run resumes, reproducing itself exactly without new model calls.

import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MockAdapter, OpenAICompatibleAdapter, type LlmAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { Kernel, KernelDied, KernelError, KernelLogFailed, kernelBinary } from "../src/kernel";
import { prepareResume, recordedCalls, Serving } from "../src/resume";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n");
const dir = (name: string) => {
  const d = join(root, "runs", `test-reliability-${name}`);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
};
/** A small town with one citizen's controller swapped for a faulty module. */
function faulty(impl: string, params: object, over: object = {}) {
  // (No nature: these test a module's faults, and a 2-second stall limit, not the world's load.)
  const c = generate({ ...spec, citizens: 40, nature: false, ...over });
  const p = c.participants.find((x: any) => x.kind === "person");
  p.controller = { type: "code", impl, params };
  return { config: c, unit: `${p.id}|self` };
}
const { modules } = await import("./fixtures/faulty-modules");

test("a run stuck in a module is stopped by its watchdog, with a diagnosis of who and when; the batch reports it", async () => {
  const d = dir("stall");
  const { config, unit } = faulty("test.hang", { hang_at: 5 * DAY });
  const world = join(d, "world.json");
  writeFileSync(world, JSON.stringify(config));
  const t0 = Date.now();
  const p = Bun.spawn([process.execPath, join(root, "orchestrator/src/cli.ts"), "run", world, "--seeds", "1", "--out", d, "--no-measure", "--modules", join(import.meta.dir, "fixtures/faulty-modules.ts")],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, OIKOS_STALL_SECONDS: "2" } });
  const [code, out] = await Promise.all([p.exited, new Response(p.stdout).text()]);
  expect(Date.now() - t0).toBeLessThan(60_000);
  expect(code).toBe(1);
  expect(out).toContain("didn't finish");
  const diagnosis = JSON.parse(readFileSync(join(d, "world.seed1.failure.json"), "utf8"));
  expect(diagnosis.reason).toBe("stalled");
  {
    // (The engine decides for its code actors inside one call, which the host's breadcrumbs cannot see into: the host
    // was waiting on the engine's `next` at the moment the run was in, and the engine's own note, read by the watchdog's
    // thread, says whom it was deciding for.)
    expect(diagnosis.doing).toMatchObject({ doing: "kernel request", request: "next" });
    expect(diagnosis.deciding).toContain(unit);
  }
  expect(diagnosis.doing.t).toBeGreaterThanOrEqual(5 * DAY);
}, 120_000);

test("a module that throws is recovered in place, recorded, retired after three in a row, and the run is the same every time", async () => {
  const { config, unit } = faulty("test.throw", { throw_at: 10 * DAY });
  const a = await runWorld({ config, runId: "throws", outDir: dir("throw-a"), until: 30 * DAY, modules });
  const b = await runWorld({ config, runId: "throws", outDir: dir("throw-b"), until: 30 * DAY, modules });
  const log = lines(a.logPath).map((l) => JSON.parse(l));
  const notes = log.filter((e) => e.kind === "annotation" && e.body.data?.participant_error);
  // (Three in a row, from day 10 on; the moment of each is its own wake's.)
  expect(notes.map((n) => n.body.data.participant_error.in_a_row)).toEqual([1, 2, 3]);
  for (const n of notes) {
    expect(n.body.data.participant_error.unit).toBe(unit);
    expect(n.body.data.participant_error.error).toMatch(/^Error: a bug at t=\d+$/);
    expect(n.t).toBeGreaterThanOrEqual(10 * DAY);
  }
  expect(a.participantErrors).toBe(3);
  // The third in a row retires it (no stand-in named): it acts no more.
  const retired = log.find((e) => e.kind === "annotation" && e.body.data?.participant_retired);
  expect(retired.body.data.participant_retired).toEqual({ unit, after_failures: 3 });
  const who = unit.split("|")[0];
  expect(log.some((e) => e.kind === "command" && e.body.participant === who && e.t > retired.t)).toBe(false);
  // Deterministic: recovering changes nothing about reproducibility.
  expect(readFileSync(b.logPath, "utf8")).toBe(readFileSync(a.logPath, "utf8"));
  expect(a.t).toBe(30 * DAY);
}, 120_000);

test("a kernel that dies ends the run at once, as a dead kernel, not an off-contract request", async () => {
  const kernel = new Kernel();
  let looks = 0;
  const run = runWorld({ config: generate({ ...spec, citizens: 40 }), runId: "dies", outDir: dir("dies"), kernel,
    inspect: async () => {
      if (++looks === 50) kernel.kill();
    } });
  const t0 = Date.now();
  await expect(run).rejects.toBeInstanceOf(KernelDied);
  expect(Date.now() - t0).toBeLessThan(10_000);
}, 180_000);

test("a model that never answers times out and is retried; its participant waits; unanswered three times running, the run stops to be resumed, and nobody is retired", async () => {
  // A fetch that never answers (only the adapter's own time limit ends it).
  const never = ((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
  const adapter = new OpenAICompatibleAdapter("openai", "never", { fetch: never, timeoutMs: 50, retries: 1, backoffMs: 1 });
  const s = await runWorld({ config: generate({ ...spec, citizens: 40, mayor: "llm" }), runId: "silent", outDir: dir("silent"), until: 30 * DAY, adapter,
    prices: { "openai/never": { input: 0, output: 0, cache_read: 0, cache_write: 0 } } });
  const log = lines(s.logPath).map((l) => JSON.parse(l));
  const errors = log.filter((e) => e.kind === "annotation" && e.body.data?.participant_error);
  // The first time, its participant waits and the run goes on (the mayor's next sitting is a later day).
  expect(errors.length).toBe(3);
  expect(errors[0].body.data.participant_error.error).toMatch(/^ModelCallFailed: openai\/never \(participant, for mayor-system\): .*no answer within 0 s \(after 2 attempts\)/);
  expect(errors[2].t).toBeGreaterThan(errors[0].t);
  // The third in a row: the model's out of reach. The run stops there, saying so; the mayor is still the mayor (pilot 8:
  // an outage retired every model seat, and the town ran ten months without them).
  expect(s.t).toBeLessThan(30 * DAY);
  expect(log.some((e) => e.kind === "annotation" && /can't be reached/.test(e.body.data?.stopped ?? ""))).toBe(true);
  expect(log.some((e) => e.kind === "annotation" && e.body.data?.participant_retired)).toBe(false);
  expect(log.at(-1).body.reason).toBe("aborted");
}, 180_000);

test("a stopped run resumes: model responses served from its log reproduce it exactly, and only the rest is asked anew", async () => {
  // A model-run mayor with a simple, fixed policy, counting the calls actually made.
  const policy = (req: LlmRequest) => {
    const n = req.messages.length;
    return n === 1
      ? [{ type: "tool_use" as const, id: `w${n}`, name: "write", input: { to: ["finance"], text: "Please send me the figures.", as: "mayor" } }]
      : [{ type: "tool_use" as const, id: `d${n}`, name: "done_for_now", input: { days: 3 } }];
  };
  const counting = () => {
    const inner = new MockAdapter("mock", { participant: policy, translator: () => [], debrief: () => [{ type: "text", text: "Thanks." }] });
    const a = { calls: 0, provider: inner.provider, model: inner.model, complete: (req: LlmRequest) => (a.calls++, inner.complete(req)) } as LlmAdapter & { calls: number };
    return a;
  };
  const config = generate({ ...spec, citizens: 40, mayor: "llm" });
  // (No debrief: a run stopped by a failure has none, and this one stands for such a run. A debrief carries the run's
  // own record, so one taken at day 20 isn't one taken at day 40.)
  for (const p of [...config.participants, ...config.positions]) if (p.framing?.debrief) p.framing = { ...p.framing, debrief: false };
  // The whole run, uninterrupted.
  const whole = counting();
  const u = await runWorld({ config, runId: "town.seed1", outDir: dir("resume-whole"), until: 40 * DAY, adapter: whole });
  // The same run, stopped at day 20 ...
  const d = dir("resume-cut");
  const first = counting();
  await runWorld({ config, runId: "town.seed1", outDir: d, until: 20 * DAY, adapter: first });
  // ... and resumed to day 40, serving what it recorded.
  const r0 = prepareResume(join(d, "town.seed1.jsonl"));
  const serving = new Serving(recordedCalls(r0.stoppedLog));
  const live = counting();
  const r = await runWorld({ config: r0.config, runId: r0.runId, outDir: d, until: 40 * DAY, adapter: serving.wrap(live), resumedFrom: { log: "town.seed1.stopped-1.jsonl", serving } });
  expect(serving.served).toBe(first.calls);
  expect(serving.diverged).toBeUndefined();
  expect(live.calls).toBe(whole.calls - first.calls);
  // The same world at the end, and the same log up to the end (the resumed one then notes that it was resumed).
  expect(r.stateHash).toBe(u.stateHash);
  const [lu, lr] = [lines(u.logPath), lines(r.logPath)];
  expect(lr.slice(0, lu.length - 1)).toEqual(lu.slice(0, -1));
  expect(JSON.parse(lr.at(-2)!).body.data.resumed_from).toEqual({ log: "town.seed1.stopped-1.jsonl", model_calls_served: first.calls });
}, 180_000);

test("a run whose log was cut off mid-line (the process killed as it wrote) still resumes exactly", async () => {
  const policy = (req: LlmRequest) => req.messages.length === 1
    ? [{ type: "tool_use" as const, id: "w", name: "write", input: { to: ["finance"], text: "Please send me the figures.", as: "mayor" } }]
    : [{ type: "tool_use" as const, id: "d", name: "done_for_now", input: { days: 2 } }];
  const mock = () => new MockAdapter("mock", { participant: policy, translator: () => [], debrief: () => [{ type: "text", text: "Thanks." }] });
  const config = generate({ ...spec, citizens: 40, mayor: "llm" });
  const u = await runWorld({ config, runId: "town.seed1", outDir: dir("cut-whole"), until: 30 * DAY, adapter: mock() });
  const d = dir("cut");
  await runWorld({ config, runId: "town.seed1", outDir: d, until: 30 * DAY, adapter: mock() });
  // Cut the log two-thirds of the way through, in the middle of a line.
  const path = join(d, "town.seed1.jsonl");
  const text = readFileSync(path, "utf8");
  let at = Math.floor(text.length * 2 / 3);
  while (text[at] === "\n") at++;
  writeFileSync(path, text.slice(0, at + 7));
  const r0 = prepareResume(path);
  const serving = new Serving(recordedCalls(r0.stoppedLog));
  const r = await runWorld({ config: r0.config, runId: r0.runId, outDir: d, until: 30 * DAY, adapter: serving.wrap(mock()), resumedFrom: { log: "town.seed1.stopped-1.jsonl", serving } });
  expect(serving.served).toBeGreaterThan(0);
  expect(serving.diverged).toBeUndefined();
  expect(r.stateHash).toBe(u.stateHash);
  expect(lines(r.logPath).slice(0, lines(u.logPath).length - 1)).toEqual(lines(u.logPath).slice(0, -1));
}, 180_000);

test("a slow but healthy model call keeps the run's breadcrumbs moving; the watchdog doesn't take it for a stall", async () => {
  const { Watchdog } = await import("../src/watchdog");
  const marks: object[] = [];
  const dog = new Watchdog({ stallMs: 60_000, diagnosisPath: join(dir("beat"), "x.failure.json"), runId: "beat" });
  const mark = dog.mark.bind(dog);
  dog.mark = (d: object) => (marks.push(d), mark(d));
  // A call that takes 25 s (a model thinking, or retrying): its breadcrumbs keep coming while it runs.
  const slow = new MockAdapter("mock", { participant: async () => (await Bun.sleep(25_000), [{ type: "tool_use" as const, id: "d", name: "done_for_now", input: { days: 5 } }]), translator: () => [], debrief: () => [] });
  await runWorld({ config: generate({ ...spec, citizens: 40, mayor: "llm" }), runId: "beat", outDir: dir("beat-run"), until: 1 * DAY, adapter: slow, watchdog: dog });
  dog.stop();
  const beats = marks.filter((m: any) => m.doing === "model call");
  expect(beats.length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...beats.map((m: any) => m.for_s))).toBeGreaterThanOrEqual(20);
}, 120_000);

test("over stdio the kernel answers many requests made at once, each caller getting its own reply", async () => {
  // (A kernel given its binary runs as a subprocess over stdio: the transport of a machine without the native module.)
  const d = dir("stdio-queue");
  const k = new Kernel(kernelBinary());
  expect(k.transport).toBe("stdio");
  const log = join(d, "q.jsonl");
  await k.request({ op: "start", config: generate({ ...spec, citizens: 40, nature: false }), run_id: "q", log_path: log });
  // Three kinds of request, told apart by their replies, all asked before any is answered (as several model seats'
  // translations do in one round): notes (each reply its log seq), the state, a refused request, and a batch.
  const note = (i: number) => ({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { i } } });
  const asked: Promise<{ i: number; kind: string; reply: any }>[] = [];
  for (let i = 0; i < 300; i++) {
    if (i % 4 === 0) asked.push(k.request(note(i)).then((reply) => ({ i, kind: "note", reply })));
    else if (i % 4 === 1) asked.push(k.request({ op: "state" }).then((reply) => ({ i, kind: "state", reply })));
    else if (i % 4 === 2) asked.push(k.request({ op: `nothing-${i}` }).then(() => ({ i, kind: "refused", reply: "answered" }), (e) => ({ i, kind: "refused", reply: e })));
    else asked.push(k.tryRequestMany([note(i), { op: `nothing-${i}` }, note(i + 1000)]).then((reply) => ({ i, kind: "many", reply })));
  }
  const answers = await Promise.all(asked);
  await k.request({ op: "finish", reason: "completed" });
  await k.close();
  const noted = new Map(lines(log).map((l) => JSON.parse(l)).filter((e) => e.kind === "annotation").map((e) => [e.seq, e.body.data.i]));
  let last = -1;
  for (const { i, kind, reply } of answers) {
    if (kind === "note") {
      expect(noted.get(reply.seq)).toBe(i);
      expect(reply.seq).toBeGreaterThan(last); // in the order asked
      last = reply.seq;
    } else if (kind === "state") expect(typeof reply.state_hash).toBe("string");
    else if (kind === "refused") {
      expect(reply).toBeInstanceOf(KernelError);
      expect(reply.message).toBe(`unknown op nothing-${i}`);
    } else {
      expect(reply.length).toBe(3);
      expect(noted.get(reply[0].seq)).toBe(i);
      expect(reply[1]).toBeNull();
      expect(noted.get(reply[2].seq)).toBe(i + 1000);
      expect(reply[0].seq).toBeGreaterThan(last);
      last = reply[2].seq;
    }
  }
}, 180_000);

/** A log nobody reads any more (a named pipe whose reader has gone): every write to it fails, as on a full disk. */
function brokenLog(path: string) {
  rmSync(path, { force: true });
  expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0);
  const reader = Bun.spawn(["cat", path], { stdout: "ignore", stderr: "ignore" });
  return { break: async () => (reader.kill(), void (await reader.exited)) };
}

test("a log the kernel can't write is fatal, and never taken for a refused request", async () => {
  const d = dir("log-fails");
  const k = new Kernel(kernelBinary());
  const log = join(d, "f.jsonl");
  const pipe = brokenLog(log);
  await k.request({ op: "start", config: generate({ ...spec, citizens: 40, nature: false }), run_id: "f", log_path: log });
  await pipe.break();
  // (Notes larger than the kernel's write buffer, so each is written through at once.)
  const big = { op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { filler: "x".repeat(40_000) } } };
  const failed = await k.request(big).catch((e) => e);
  expect(failed).toBeInstanceOf(KernelLogFailed);
  expect(failed.message).toMatch(/couldn't write the run's log \(log write failed: /);
  // Neither does a batch turn it into "refused", nor the forgiving form into null; a refused request is still one.
  await expect(k.tryRequestMany([big, big])).rejects.toBeInstanceOf(KernelLogFailed);
  await expect(k.tryRequest(big)).rejects.toBeInstanceOf(KernelLogFailed);
  expect(await k.tryRequest({ op: "nothing" })).toBeNull();
  k.kill();
}, 180_000);

test("a run whose log can no longer be written stops there, saying so", async () => {
  const d = dir("log-fails-run");
  const pipe = brokenLog(join(d, "full.jsonl"));
  let looks = 0;
  const run = runWorld({ config: generate({ ...spec, citizens: 40, nature: false }), runId: "full", outDir: d, until: 30 * DAY, kernel: new Kernel(kernelBinary()),
    inspect: async () => {
      // (The TS world looks at every wake of every code actor; the Rust world's inspector is called once a day.)
      if (++looks === 10) await pipe.break();
    } });
  const failed = await run.catch((e) => e);
  expect(failed).toBeInstanceOf(KernelLogFailed);
  expect(failed.message).toContain("couldn't write the run's log");
}, 180_000);
