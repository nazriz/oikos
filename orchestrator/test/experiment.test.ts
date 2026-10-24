// The experiment harness (orchestrator/src/experiment.ts): stewards by arm, the mock models, the measures, the report
// (pure); then a whole experiment on the Rust engine with mock seats and no model: one town per seed run to a fork point,
// forks with the post's code, nobody and mock models as steward, the same numbers in this process and across workers,
// and a fork's log that exports and verifies.

import { engineModule, kernelBinary } from "../src/kernel";
import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildReport, DAY, loadPrereg, loadSpec, makeMeasure, measureList, mockModel, recourseProblems, reportText, runExperiment, seatify, validate, type ArmResult, type ExperimentSpec } from "../src/experiment";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { DetachedActor, SeatWake } from "../src/rust-world";

const root = join(import.meta.dir, "../..");

// ---- pure

const wake = (t: number): SeatWake => ({ key: "k", participant: "p", t, woke_for: "cadence", since: 0, observation: { t } });
const act = { type: "act", blocks: [] };
/** A brain that acts at every wake after the first. */
const brain = (): DetachedActor => { let n = 0; return { step: () => ({ action: n++ ? act : { type: "wait" } }) } as unknown as DetachedActor; };

test("mock models are policies over the post's code brain, and say what they cost in tokens", () => {
  const diligent = mockModel("diligent", brain());
  expect(diligent.decide(wake(0))).toMatchObject({ action: { type: "wait" } });
  expect(diligent.decide(wake(1))).toMatchObject({ action: act, usage: { output_tokens: 150 } });
  // delay:2 holds the act two days and says when it will be back
  const late = mockModel("delay:2", brain());
  late.decide(wake(0));
  expect((late.decide(wake(DAY)) as any).action).toEqual({ type: "wait", until: 3 * DAY });
  expect((late.decide(wake(3 * DAY)) as any).action).toEqual(act);
  // skip:2 drops every second act
  const flaky = mockModel("skip:2", (() => { return { step: () => ({ action: act }) } as unknown as DetachedActor; })());
  expect([1, 2, 3, 4].map((i) => (flaky.decide(wake(i)) as any).action.type)).toEqual(["act", "wait", "act", "wait"]);
  expect(() => mockModel("delay", brain())).toThrow(/no mock model/);
  expect(() => mockModel("clever", brain())).toThrow(/no mock model/);
});

test("measures count and time what the log says from the fork on", () => {
  const ctx = { forkT: 10 * DAY, seat: "seat-1", post: "post" };
  const ms = ["acts", "records:notice", "first_record:notice", "first_act_day", "transfers_cents", "refused", "log_entries"].map((m) => makeMeasure(m, ctx));
  const entries = [
    { kind: "command", t: 11 * DAY, body: { command: "act", participant: "seat-1" } },
    { kind: "command", t: 11 * DAY, body: { command: "act", participant: "someone" } },
    { kind: "event", t: 13 * DAY, body: { event: "recorded", record: { kind: "notice" } } },
    { kind: "event", t: 14 * DAY, body: { event: "recorded", record: { kind: "other" } } },
    { kind: "event", t: 14 * DAY, body: { event: "transfer", amount: "250" } },
    { kind: "event", t: 15 * DAY, body: { event: "action_refused" } },
  ];
  for (const e of entries) for (const m of ms) m.see(e);
  expect(Object.fromEntries(ms.map((m) => [m.name, m.result()]))).toEqual({ acts: 1, "records:notice": 1, "first_record:notice": 3, first_act_day: 1, transfers_cents: 250, refused: 1, log_entries: 6 });
  expect(() => makeMeasure("first_record", ctx)).toThrow(/needs a kind/);
  expect(() => makeMeasure("goodness", ctx)).toThrow(/no measure/);
});

const base = (over: Partial<ExperimentSpec> = {}): ExperimentSpec => ({ name: "t", world: { config: {} }, post: "p", seeds: [1, 2, 3], forkDay: 1, untilDay: 5, arms: [{ name: "a", steward: { kind: "code" } }, { name: "b", steward: { kind: "none" } }], ...over });

test("a spec is checked before anything runs; a real model needs a seat factory", () => {
  expect(() => validate(base({ arms: [] }))).toThrow(/no arms/);
  expect(() => validate(base({ forkDay: 5 }))).toThrow(/before untilDay/);
  expect(() => validate(base({ reference: "z" }))).toThrow(/not an arm/);
  expect(() => validate(base({ arms: [{ name: "a", steward: { kind: "code" } }, { name: "a", steward: { kind: "none" } }] }))).toThrow(/two arms/);
  const real = base({ arms: [{ name: "m", steward: { kind: "model", model: "anthropic/claude-sonnet-5" } }] });
  expect(() => validate(real)).toThrow(/SeatFactory/);
  expect(() => validate(real, { anthropic: () => ({ decide: () => ({ action: { type: "wait" } }) }) })).not.toThrow();
  expect(() => validate(base({ arms: [{ name: "m", steward: { kind: "model", model: "mock/diligent" } }] }))).not.toThrow();
});

test("seatify makes the post's holder a mock seat sitting as its code twin, whoever held it", () => {
  const config = () => ({ positions: [{ id: "bureau", holder: "sys", role_module: { code: "x.y", params: { a: 1 } } }, { id: "clerk", holder: "per", role_module: { code: "x.clerk", params: { b: 2 } } }],
    participants: [{ id: "sys", kind: "system", controller: { type: "code", impl: "world.weather", params: { events: [] } } }, { id: "per", kind: "person", controller: { type: "code", impl: "citizen.default" } }] });
  expect(seatify(config(), "bureau").participants[0].controller).toEqual({ type: "llm", impl: "mock", params: { mock: { twin: true, brain: "world.weather", params: { events: [] } } } });
  expect(seatify(config(), "clerk").participants[1].controller.params.mock).toEqual({ twin: true, brain: "x.clerk", params: { b: 2 } });
  expect(() => seatify(config(), "nowhere")).toThrow(/no post/);
});

test("the report sets each arm's measure with its spread over the seeds, and its difference from the reference seed by seed", () => {
  const spec = base();
  const r = (seed: number, arm: string, acts: number, cost = 0): ArmResult => ({ seed, arm, steward: { kind: "code" }, stateHash: `h${seed}${arm}`, t: 1, steps: 1, wakes: 1, measures: { acts, first: acts ? 2 : null }, costs: cost ? { s: { calls: 2, input_tokens: 100, output_tokens: 10, cost_microusd: cost } } : {}, seconds: 0 });
  const report = buildReport(spec, [r(1, "a", 4), r(2, "a", 6), r(3, "a", 5), r(1, "b", 0), r(2, "b", 1), r(3, "b", 2, 500_000)]);
  const a = report.arms[0]!.measures.acts!, b = report.arms[1]!;
  expect(a).toMatchObject({ n: 3, mean: 5, sd: 1, min: 4, max: 6 });
  expect(b.measures.first!.n).toBe(2);
  expect(report.versus[0]!.arm).toBe("b");
  expect(report.versus[0]!.measures.acts).toMatchObject({ n: 3, mean: -4, min: -5, max: -3 });
  expect(b.cost.cost_usd.mean).toBeCloseTo(0.5 / 3);
  const text = reportText(report);
  expect(text).toContain("acts");
  expect(text).toContain("b - a");
  expect(text).toContain("Nothing here says which arm is better");
});

test("the rubber stamp answers every request to look at a decision again with 'it stands', and the code never sees one", () => {
  const seen: any[] = [];
  let next: any = { type: "wait" };
  const fake = { step: (o: any) => { seen.push(o); return { action: next }; } } as unknown as DetachedActor;
  const stamp = mockModel("rubber-stamp", fake);
  const decision = { id: "rec.3", kind: "benefit_decision", at: 100, speaks_for: "outside", addressed_to: ["p2"], data: { granted: false } };
  const request = { id: "rec.6", kind: "review_request", speaks_for: "p2", addressed_to: ["outside"], data: { about: "rec.3", matter: "claim_refused" } };
  const obs = { entity: "outside", channels: { "office/claims": { kind: "records", records: [decision, request] }, "office/ledger": { kind: "accounts", accounts: [] } } };
  const w: SeatWake = { key: "k", participant: "sys", t: 200, woke_for: "news", since: 0, observation: obs };
  const first = stamp.decide(w) as any;
  // The brain was shown the decision and not the request.
  expect(seen[0].channels["office/claims"].records.map((r: any) => r.id)).toEqual(["rec.3"]);
  expect(seen[0].channels["office/ledger"]).toEqual(obs.channels["office/ledger"]);
  expect(first.action.type).toBe("call");
  const calls = first.action.call.split("\n");
  expect(calls).toHaveLength(2);
  expect(calls[0]).toContain("kind=decision_review");
  expect(calls[0]).toContain('"outcome":"upheld"');
  expect(calls[0]).toContain('"decided_on":100');
  expect(calls[0]).toContain("basis=rec.3");
  expect(calls[1]).toContain("kind=remedy_answer");
  expect(calls[1]).toContain('"granted":false');
  expect(calls[1]).toContain('to=["p2"]');
  expect(first.usage.output_tokens).toBe(150);
  // The same request again is not answered twice; the brain's own act goes out, and a new request rides with it.
  next = { type: "call", call: "money(amount=\"$1\", from=a, to=b)" };
  expect((stamp.decide(w) as any).action).toEqual(next);
  const again = stamp.decide({ ...w, observation: { ...obs, channels: { c: { kind: "records", records: [{ ...request, id: "rec.7" }] } } } }) as any;
  expect(again.action.call.split("\n")).toHaveLength(3);
  expect(again.action.call.startsWith("money(")).toBe(true);
});

test("'stewardship' in a spec's measures stands for every stewardship measure, read from the fork's ledger", () => {
  const names = measureList(base({ measures: ["acts", "stewardship"] }));
  expect(names[0]).toBe("acts");
  expect(names).toContain("human_in_decision_share");
  expect(names).toContain("review_changed_share");
  const m = makeMeasure("human_in_decision_share", { forkT: 0, seat: "s", post: "p", stewardship: () => ({ measures: { human_in_decision_share: 0.25 } }) as any });
  expect(m.result()).toBe(0.25);
  expect(() => makeMeasure("human_in_decision_share", { forkT: 0, seat: "s", post: "p" })).toThrow(/no(ne)?/);
});

test("a registered report presents as primary only what was registered; everything else is exploratory", () => {
  const spec = base({ name: "e", post: "p", arms: [{ name: "code", steward: { kind: "code" } }, { name: "a", steward: { kind: "none" } }, { name: "b", steward: { kind: "none" } }], reference: "code", forkDay: 1, untilDay: 5 });
  const r = (seed: number, arm: string, m1: number, m2: number): ArmResult => ({ seed, arm, steward: { kind: "code" }, stateHash: "", t: 1, steps: 1, wakes: 1, measures: { m1, m2 }, costs: {}, seconds: 0 });
  const results = [1, 2, 3].flatMap((s) => [r(s, "code", 10, 5), r(s, "a", 4 + s * 0.1, 7 + s * 0.1), r(s, "b", 10, 5)]);
  const held = { file: "x.yaml", sha256: "h", committed: "2026-10-23T10:00:00+01:00", prereg: { preregistration: 1 as const, experiment: "e", registered: "2026-10-23", question: "Does a lower m1?", post: "p", arms: ["code", "a", "b"], reference: "code", seeds: [1, 2, 3], forkDay: 1, untilDay: 5, primary: [{ measure: "m1", arm: "a", vs: "code", expect: "lower" as const }, { measure: "m1", arm: "b", vs: "code" }] } };
  const report = buildReport(spec, results, held);
  const c = report.comparisons!;
  expect(c.filter((x) => x.status === "primary").map((x) => x.key)).toEqual(["m1: a - code", "m1: b - code"]);
  // two primary comparisons at 95% together: each at 97.5%
  expect(c[0]!.interval.level).toBeCloseTo(0.975, 10);
  expect(c[0]!.interval.hi!).toBeLessThan(0);
  expect(c[0]!.reading).toContain("Registered expectation lower: the interval agrees");
  expect(c.filter((x) => x.status === "exploratory").map((x) => x.key).sort()).toEqual(["m2: a - code", "m2: b - code"]);
  expect(c.find((x) => x.key === "m2: a - code")!.interval.level).toBe(0.95);
  const text = reportText(report);
  expect(text.split("\n")[0]).toContain("3 arms in the post p");
  expect(text).toContain('Pre-registered on 2026-10-23, first committed 2026-10-23T10:00:00+01:00: "Does a lower m1?"');
  expect(text).toContain("Exploratory: 2 other comparisons against code, of which 1 has an interval that excludes zero");
  expect(text).not.toMatch(/\b(better|worse) (than|off)\b/i);
  // Without a registration, everything is exploratory.
  expect(buildReport(spec, results).summary).toContain("Nothing was pre-registered: every comparison here is exploratory.");
});

test("an experiment whose spec differs from its registration does not run", () => {
  const dir = mkdtempSync(join(tmpdir(), "prereg-"));
  const file = join(dir, "e.prereg.yaml");
  writeFileSync(file, "preregistration: 1\nexperiment: e\nregistered: '2026-10-23'\nquestion: q\npost: p\narms: [a, b]\nreference: a\nseeds: [1, 2, 3]\nforkDay: 1\nuntilDay: 5\nprimary:\n  - { measure: acts, arm: b }\n");
  const spec = base({ name: "e", preregistration: "e.prereg.yaml" });
  expect(loadPrereg(spec, join(dir, "spec.json"))!.prereg.primary[0]!.measure).toBe("acts");
  expect(() => loadPrereg({ ...spec, untilDay: 9 }, join(dir, "spec.json"))).toThrow(/days: registered 1 to 5, spec 1 to 9/);
  expect(() => loadPrereg({ ...spec, measures: ["refused"] }, join(dir, "spec.json"))).toThrow(/no measure "acts"/);
  expect(() => loadPrereg({ ...spec, preregistration: "nowhere.yaml" }, join(dir, "spec.json"))).toThrow(/not there/);
  rmSync(dir, { recursive: true, force: true });
});

test("an arm's withholding is checked, and a registered comparison that needs citizens' recourse is refused in a town where they take none", () => {
  expect(() => validate(base({ arms: [{ name: "a", steward: { kind: "code" }, withhold: [{ what: "" }] }] }))).toThrow(/withhold names what/);
  expect(() => validate(base({ arms: [{ name: "a", steward: { kind: "code" }, withhold: [{ what: "review_request", nth: 0 }] }] }))).toThrow(/nth from 1/);
  validate(base({ arms: [{ name: "a", steward: { kind: "code" }, withhold: [{ what: "review_request", matter: "claim_refused", to: "outside" }] }] }));
  const held = (measure: string) => ({ file: "x.yaml", sha256: "h", prereg: { preregistration: 1 as const, experiment: "t", registered: "2026-10-24", question: "q", post: "p", arms: ["a", "b"], reference: "a", seeds: [1, 2, 3], forkDay: 1, untilDay: 5, primary: [{ measure, arm: "b" }] } });
  const plain = { dials: { initiative_bps: 0, friction_bps: 0 } }, living = { dials: { initiative_bps: 10_000, friction_bps: 10_000 } };
  // (The worked example of 2026-10-23: a town without `living`, so nothing went wrong for anyone and nobody asked.)
  expect(recourseProblems(plain, held("appeals_made")).join()).toMatch(/registers appeals_made, but its town's citizens take no recourse/);
  expect(recourseProblems({}, held("review_changed_share")).join()).toMatch(/living\.friction_bps/);
  expect(recourseProblems(plain, held("decided_by_seat_share"))).toEqual([]);
  expect(recourseProblems(living, held("appeals_made"))).toEqual([]);
  expect(recourseProblems(plain)).toEqual([]);
});

// ---- a whole experiment on the engine

// (The kernel the host would use: OIKOS_KERNEL and OIKOS_ENGINE_MODULE are honoured, as the merge gate sets them for its build.)
const kernel = (() => { try { return kernelBinary(); } catch { return ""; } })();
const have = !!kernel && existsSync(kernel) && !!engineModule();

const specFile = join(root, "experiments/weather-stewards.ts");
const smaller = (spec: ExperimentSpec): ExperimentSpec => ({ ...spec, seeds: [1, 2], untilDay: 40, arms: spec.arms.filter((a) => ["code", "nobody", "diligent", "three-days-late"].includes(a.name)) });

test.skipIf(!have)("a whole experiment: the weather bureau's steward, four arms, two seeds, mock seats only", async () => {
  const { spec, factories } = await loadSpec(specFile);
  const small = smaller(spec);
  const out = join(root, "runs", "test-experiment");
  rmSync(out, { recursive: true, force: true });
  const r = await runExperiment(small, { out, parallel: 0, factories });
  expect(r.results.filter((x) => x.error)).toEqual([]);
  expect(r.results).toHaveLength(8);
  const get = (seed: number, arm: string) => r.results.find((x) => x.seed === seed && x.arm === arm)!;
  for (const seed of small.seeds) {
    const code = get(seed, "code"), nobody = get(seed, "nobody"), diligent = get(seed, "diligent"), late = get(seed, "three-days-late");
    // The code twin warns of the spells ahead (they begin on day 20 and day 33 or later); nobody does not.
    expect(code.measures["records:weather_warning"]).toBe(2);
    expect(nobody.measures["records:weather_warning"]).toBe(0);
    expect(nobody.measures["first_record:weather_warning"]).toBeNull();
    // A diligent model does what the code does: the same world to the hash. Its cost is in the log; the code's is nothing.
    expect(diligent.stateHash).toBe(code.stateHash);
    expect(diligent.measures["records:weather_warning"]).toBe(2);
    expect(Object.keys(code.costs)).toEqual([]);
    const cost = Object.values(diligent.costs)[0]!;
    expect(cost.calls).toBeGreaterThan(0);
    expect(cost.cost_microusd).toBeGreaterThan(0);
    // Three days late, the first warning is no earlier than the code's, and the world differs from the code's.
    expect(late.measures["first_record:weather_warning"]!).toBeGreaterThanOrEqual(code.measures["first_record:weather_warning"]!);
    expect(late.stateHash).not.toBe(code.stateHash);
  }
  // The report has every arm and a difference against the reference.
  expect(r.report.arms.map((a) => a.name)).toEqual(small.arms.map((a) => a.name));
  expect(r.report.versus.map((v) => v.arm)).toEqual(["nobody", "diligent", "three-days-late"]);
  expect(r.report.versus[0]!.measures["records:weather_warning"]).toMatchObject({ n: 2, mean: -2 });
  expect(readFileSync(join(out, "report.txt"), "utf8")).toContain("three-days-late");
  // Refuses to overwrite a finished experiment.
  await expect(runExperiment(small, { out, parallel: 0 })).rejects.toThrow(/never overwritten/);

  // A fork's log is binary and names its parent; exported it is the whole run's JSONL, and it verifies.
  const log = join(out, "seed-1", "diligent.oklog");
  const jsonl = join(out, "seed-1", "diligent.jsonl");
  expect(Bun.spawnSync([kernel, "export", log, "--out", jsonl]).exitCode).toBe(0);
  const lines = readFileSync(jsonl, "utf8").trim().split("\n");
  expect(JSON.parse(lines[0]!).kind).toBe("header");
  expect(lines.some((l) => l.includes('"annotation":"usage"'))).toBe(true);
  const v = Bun.spawnSync([kernel, "verify", jsonl]);
  expect(v.exitCode).toBe(0);
  rmSync(out, { recursive: true, force: true });
}, 600_000);

test.skipIf(!have)("an arm that withholds one named act is its parent's fork without it: the act never comes, the log says so, and one never made changes nothing", async () => {
  const { spec, factories } = await loadSpec(specFile);
  const one: ExperimentSpec = { ...spec, name: "withhold", seeds: [1], untilDay: 40, measures: ["records:weather_warning", "withheld"], arms: [
    { name: "code", steward: { kind: "code" } },
    { name: "code-without-the-first", steward: { kind: "code" }, withhold: [{ what: "weather_warning" }] },
    { name: "code-without-a-ninth", steward: { kind: "code" }, withhold: [{ what: "weather_warning", nth: 9 }] },
    { name: "diligent-without-the-first", steward: { kind: "model", model: "mock/diligent" }, withhold: [{ what: "weather_warning", nth: 1 }] },
  ] };
  delete (one as any).preregistration;
  const out = join(root, "runs", "test-experiment-withhold");
  rmSync(out, { recursive: true, force: true });
  const r = await runExperiment(one, { out, parallel: 0, factories });
  expect(r.results.filter((x) => x.error)).toEqual([]);
  const get = (arm: string) => r.results.find((x) => x.arm === arm)!;
  expect(get("code").measures).toEqual({ "records:weather_warning": 2, withheld: 0 });
  expect(get("code-without-the-first").measures).toEqual({ "records:weather_warning": 1, withheld: 1 });
  expect(get("code-without-the-first").stateHash).not.toBe(get("code").stateHash);
  expect(get("code-without-a-ninth")).toMatchObject({ stateHash: get("code").stateHash, measures: { withheld: 0 } });
  // (The bureau is the seat's in a model arm: the withholding is of the act, whoever decided it.)
  expect(get("diligent-without-the-first").measures).toEqual({ "records:weather_warning": 1, withheld: 1 });
  rmSync(out, { recursive: true, force: true });
}, 600_000);

test.skipIf(!have)("the same experiment across worker processes gives the same numbers", async () => {
  const { spec, factories } = await loadSpec(specFile);
  const small = { ...smaller(spec), seeds: [1, 2], arms: smaller(spec).arms.slice(0, 3) };
  const a = join(root, "runs", "test-experiment-here"), b = join(root, "runs", "test-experiment-workers");
  for (const d of [a, b]) rmSync(d, { recursive: true, force: true });
  const here = await runExperiment(small, { out: a, parallel: 0, factories });
  const away = await runExperiment(small, { out: b, parallel: 2, specFile, slots: false });
  const pick = (rs: ArmResult[]) => rs.map((x) => ({ seed: x.seed, arm: x.arm, hash: x.stateHash, m: x.measures, costs: x.costs }));
  expect(pick(away.results)).toEqual(pick(here.results));
  expect(away.report.arms.map((x) => x.measures)).toEqual(here.report.arms.map((x) => x.measures));
  for (const d of [a, b]) rmSync(d, { recursive: true, force: true });
}, 900_000);
