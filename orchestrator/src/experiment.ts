// The experiment harness (docs/experiments.md; port lane G): an experiment is a town run to a point (the base), then a
// set of forks of it, each with a different steward in one named post (a model seat, by model; the post's own code; or
// nobody), each over several seeds. The forks run across cores and, within a worker, with their seats' calls in flight
// together. Each fork's measures and its seat's costs are collected, and a comparison report sets each measure out per
// arm with its spread over the seeds, and each arm's difference from a reference arm seed by seed (same town, same
// seed, only the steward differs).
//
// Built on lane F's snapshot and fork (kernel/src/engine/snapshot.rs): the base is run once per seed, snapshotted, and
// every arm resumes that snapshot with its own log (a binary log naming the base's as its parent: `oikos-kernel export`
// writes any arm's whole log back as JSONL). The host is the light one (orchestrator/src/rust-world.ts, `RustWorld`): a
// seat is answered by a `SeatController`. Mock stewards need no model; a real one is a controller a `SeatFactory`
// makes (see the end of this file, and docs/experiments.md, "Real models").
//
// The platform does not judge: a measure is a count or a time read from the log, never "good" or "bad". Money is
// integer cents. Nothing here changes a result with the number of workers or threads: the same spec gives the same
// numbers (mock stewards draw nothing; the engine is deterministic).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { DetachedActor, RustWorld, twinSpecs, type SeatWake } from "./rust-world";
import { Ledger, STEWARDSHIP_MEASURES, STEWARDSHIP_NAMES, type Institutions, type StewardOfPost, type StewardshipResult } from "@oikos/measure/stewardship";
import { bonferroni, differenceInDifferences, interval, pairedDifferences, type Interval } from "@oikos/measure/compare";
import { comparisonKey, parsePrereg, preregHash, preregProblems, specMismatch, type Comparison, type Preregistration } from "@oikos/measure/prereg";
import { copyFileSync } from "node:fs";
import { dirname } from "node:path";

export const DAY = 86_400;

// ---- the spec

export type Steward =
  /** The post's own code, as the town would have it (the seat sits as its code twin). */
  | { kind: "code" }
  /** Nobody: the seat never acts. */
  | { kind: "none" }
  /** A model seat in the post: `model` is `provider/name` (`mock/...` for the mock policies below). */
  | { kind: "model"; model: string; effort?: string; params?: { [k: string]: unknown } };

/** An act withheld in an arm (the engine's `withhold`, kernel/src/engine.rs; risk MT-19): of the acts from the fork on
 * that publish a paper of the kind `what` (or are a block of that name), by `participant` (absent: anyone), of `matter`
 * (its data's) and addressed `to` whom where given, the `nth`
 * (from 1) is not carried out; its actor believes it sent it. The arm is then "the same arm without that act". */
export interface Withhold { what: string; participant?: string; nth?: number; matter?: string; to?: string; /** Only a paper whose data has this field (`on_review`: a decision made on a review). */ has?: string }
export interface Arm { name: string; steward: Steward; withhold?: Withhold[] }

/** How a seed's town is made: a world file (a generator spec or a config, as `oikos run` takes it), a generator spec, or a config; then `prepare`. */
export interface WorldSource {
  file?: string;
  spec?: { [k: string]: unknown };
  config?: object;
  sets?: string[];
  /** Change the made config (a TS spec file only): `(config, seed) => config`. */
  prepare?: (config: any, seed: number) => any;
}

/** A measure over a fork's log from the fork on: a count or a time, read from the entries. */
export interface MeasureMaker {
  name: string;
  make(ctx: MeasureContext): { see(entry: any): void; result(): number | null };
}
export interface MeasureContext {
  forkT: number; seat: string; post: string;
  /** The arm's steward, and the fork's stewardship ledger's result (measure/src/stewardship.ts), read once at the end. */
  steward?: Steward;
  stewardship?: () => StewardshipResult;
}

export interface ExperimentSpec {
  name: string;
  world: WorldSource;
  /** The post (a position id) whose steward differs between arms. */
  post: string;
  seeds: number[];
  /** Days the base runs before it forks, and days the whole run lasts. */
  forkDay: number;
  untilDay: number;
  arms: Arm[];
  /** The arm the others are set against (default: the first). */
  reference?: string;
  /** Built-in measures by name (below), or makers. Default: `DEFAULT_MEASURES`. */
  measures?: (string | MeasureMaker)[];
  /** Placeholder prices of models, micro-USD per million tokens, by `provider/name` (mock models cost what this says; a
   * real model's are the price table's: participants/src/llm/adapter.ts). */
  prices?: { [model: string]: { input: number; output: number } };
  /** What stands in for the actor kinds the engine lacks until every lane has merged (default: OIKOS_STAND_IN, else idle). */
  standIn?: string;
  /** The engine's own threads per run (default 1: the harness spreads forks over cores instead). */
  threads?: number;
  /** The experiment's pre-registration (measure/src/prereg.ts; docs/experiments.md, "Pre-registration"): a file, relative
   * to the spec file's folder (or the working folder). With one, the spec must agree with it and the report presents as
   * primary only what it registered; without one, every comparison is exploratory. */
  preregistration?: string;
  /** The level of the report's intervals when nothing is registered (default 0.95). */
  level?: number;
  /** Which kinds of entity are public bodies and which firms, for the stewardship ledger's dependence measures (the
   * platform names no kind of institution; without this, those measures are absent). */
  institutions?: Institutions;
}

export const DEFAULT_MEASURES = ["acts", "records", "refused", "first_act_day", "log_entries"];

/** The spec's measures, with `stewardship` standing for every measure of measure/src/stewardship.ts. */
export function measureList(spec: ExperimentSpec): (string | MeasureMaker)[] {
  return (spec.measures ?? DEFAULT_MEASURES).flatMap((m) => (m === "stewardship" ? STEWARDSHIP_MEASURES.map((x) => x.name) : [m]));
}
const wantsStewardship = (spec: ExperimentSpec) => measureList(spec).some((m) => typeof m === "string" && STEWARDSHIP_NAMES.has(m));
/** How the stewardship ledger counts an arm's steward. */
const stewardOf = (seat: string, s: Steward): StewardOfPost => ({ seat, kind: s.kind === "model" ? "model" : s.kind });

// ---- the town of a seed

export async function buildConfig(spec: ExperimentSpec, seed: number): Promise<any> {
  const w = spec.world;
  let config: any;
  if (w.file) {
    const { loadWorld } = await import("./batch");
    config = (await loadWorld(resolve(w.file), [...(w.sets ?? []), `seed=${seed}`])).config;
  } else if (w.spec) {
    const { generate } = await import("@oikos/worlds/generator/generate");
    config = generate({ ...structuredClone(w.spec), seed } as any);
  } else if (w.config) {
    config = structuredClone(w.config);
    config.seed = seed;
  } else throw new Error("the experiment's world names no file, spec or config");
  if (w.prepare) config = w.prepare(config, seed) ?? config;
  return seatify(config, spec.post);
}

/** The post's holder made a mock seat sitting as its code twin (a seat the world already has stays one): the same post
 * in every arm, its steward the host's choice. Returns the config (changed in place). */
export function seatify(config: any, post: string): any {
  const pos = (config.positions ?? []).find((x: any) => x.id === post);
  if (!pos) throw new Error(`the world has no post "${post}" (posts: ${(config.positions ?? []).map((x: any) => x.id).slice(0, 12).join(", ")}...)`);
  const holder = (config.participants ?? []).find((p: any) => p.id === pos.holder);
  if (!holder) throw new Error(`post "${post}" has no holder`);
  const c = holder.controller ?? {};
  if (c.type === "llm") {
    c.params = { ...(c.params ?? {}), mock: { ...(c.params?.mock ?? {}), twin: true } };
    if (!c.params.mock.brain) throw new Error(`post "${post}"'s seat has no code brain to be its twin (mock.brain)`);
  } else {
    // (A person in the post runs the post's own module; a system, the one it was delivered to run.)
    const person = holder.kind === "person";
    const brain = person ? pos.role_module?.code : c.impl;
    if (!brain) throw new Error(`post "${post}" is held by no code module`);
    holder.controller = { type: "llm", impl: "mock", params: { mock: { twin: true, brain, params: person ? (pos.role_module?.params ?? {}) : (c.params ?? {}) } } };
  }
  return config;
}

// ---- seat controllers (the steward of an arm)

export interface SeatDecision { action: object; usage?: { input_tokens: number; output_tokens: number } }
export interface SeatController {
  decide(wake: SeatWake): Promise<SeatDecision> | SeatDecision;
}
/** Makes the controller of a model seat for a provider: the extension point for real models (docs/experiments.md). */
export type SeatFactory = (a: { seat: string; post: string; model: string; effort?: string; params?: { [k: string]: unknown }; brain?: DetachedActor; spec: ExperimentSpec }) => SeatController | Promise<SeatController>;
export type SeatFactories = { [provider: string]: SeatFactory };

const isWait = (a: any) => a?.type === "wait";
const tokens = (x: unknown) => Math.ceil(JSON.stringify(x).length / 4);
const holding = (until: number): object => ({ type: "wait", until });

/** The mock models: policies over the post's own code brain. `mock/diligent` acts as the code does, with the usage of a
 * model; `mock/delay:N` acts N days after the code would; `mock/skip:N` drops every Nth act (an unreliable steward);
 * `mock/rubber-stamp` confirms every decision it is asked to look at again (below). */
export function mockModel(name: string, brain: DetachedActor): SeatController {
  const [policy, arg] = name.split(":");
  const n = arg === undefined ? 0 : Number(arg);
  if (policy === "rubber-stamp") return rubberStamp(brain);
  if (!["diligent", "delay", "skip"].includes(policy!) || (policy !== "diligent" && !(n > 0))) throw new Error(`no mock model "mock/${name}" (mock/diligent, mock/delay:<days>, mock/skip:<n>, mock/rubber-stamp)`);
  const held: { due: number; action: object }[] = [];
  let acts = 0;
  return {
    decide(w) {
      const r = brain.step(w.observation, w.woke_for, w.since);
      let action: any = r.action;
      const usage = { input_tokens: tokens(w.observation), output_tokens: isWait(action) ? 20 : 150 };
      if (policy === "skip" && !isWait(action) && ++acts % n === 0) action = { type: "wait" };
      if (policy === "delay") {
        if (!isWait(action)) { held.push({ due: w.t + n * DAY, action }); action = { type: "wait" }; }
        const ripe = held.findIndex((h) => h.due <= w.t);
        if (ripe >= 0) action = held.splice(ripe, 1)[0]!.action;
        else if (held.length) action = holding(Math.min(...held.map((h) => h.due)));
      }
      return { action, usage };
    },
  };
}

/** Every record an observation shows, from every channel that shows records. */
const recordsShown = (o: any): any[] => Object.values(o?.channels ?? {}).flatMap((c: any) => (Array.isArray(c?.records) ? c.records : []));
const q = (x: string) => JSON.stringify(x);

/**
 * `mock/rubber-stamp`: a steward that confirms every decision it is asked to look at again. A request to the office to
 * look at one of its decisions (`review_request`, addressed to the office) is taken out of what the code brain is
 * shown, so the brain neither knows of it nor puts anything right; the steward answers it itself, at once: a record
 * that the decision was looked at and stands (`decision_review`, outcome `upheld`) and the answer to the one who asked
 * (`remedy_answer`, no), the same two papers the office's code writes for a decision it upholds
 * (kernel/crates/actors/src/finance/decisions.rs, `Reconsiderations`). Everything else the office does is the code's.
 * Answering through the brain's output instead (turning its "changed" into "upheld") would leave the brain paying what
 * it had decided to put right: its state, not its papers, starts a payment.
 */
export function rubberStamp(brain: DetachedActor): SeatController {
  const answered = new Set<string>();
  let held: string[] = [];
  return {
    decide(w) {
      const me = String(w.observation?.entity ?? "");
      const shown = recordsShown(w.observation);
      const isRequest = (r: any) => r?.kind === "review_request" && Array.isArray(r.addressed_to) && r.addressed_to.includes(me) && r.speaks_for !== me;
      const fresh = shown.filter((r) => isRequest(r) && !answered.has(r.id));
      // (What the brain sees: the same observation without the requests.)
      const o = { ...w.observation, channels: Object.fromEntries(Object.entries(w.observation?.channels ?? {}).map(([k, c]: [string, any]) => [k, Array.isArray(c?.records) ? { ...c, records: c.records.filter((r: any) => !isRequest(r)) } : c])) };
      const r = brain.step(o, w.woke_for, w.since);
      for (const req of fresh) {
        answered.add(req.id);
        const who = String(req.speaks_for ?? ""), about = String(req.data?.about ?? "");
        const decision = shown.find((x) => x.id === about);
        const review = { decision: about, kind: decision?.kind ?? String(req.data?.matter ?? "decision"), request: req.id, outcome: "upheld", found: "looked at again: it stands", asked_by: who, ...(decision?.at !== undefined ? { decided_on: decision.at } : {}) };
        const answer = { request: req.id, matter: String(req.data?.matter ?? ""), granted: false, review: "upheld", decision: about, reason: "looked at again: it stands" };
        const basis = about || req.id;
        held.push(`statement(basis=${basis}, data=${JSON.stringify(review)}, kind=decision_review, text=${q(`Review of ${about}, asked by ${who}: looked at again; it stands.`)}, to=[${q(who)}], visible=[${q(who)}, ${q(me)}])`);
        held.push(`statement(basis=${req.id}, data=${JSON.stringify(answer)}, kind=remedy_answer, text=${q(`Answer to your request ${req.id}: no: looked at again; it stands.`)}, to=[${q(who)}], visible=[${q(who)}, ${q(me)}])`);
      }
      let action: any = r.action;
      if (held.length && (isWait(action) || action?.type === "call")) {
        const stamps = held.join("\n");
        held = [];
        action = isWait(action) ? { type: "call", call: stamps, reasoning: "Requests to look at our decisions again: each looked at; each stands." } : { ...action, call: `${action.call}\n${stamps}` };
      }
      return { action, usage: { input_tokens: tokens(w.observation), output_tokens: isWait(action) ? 20 : 150 } };
    },
  };
}

function controllerFor(a: Arm, ctx: { seat: string; post: string; brain: DetachedActor | undefined; spec: ExperimentSpec; factories: SeatFactories }): Promise<SeatController> | SeatController {
  const s = a.steward;
  if (s.kind === "none") return { decide: () => ({ action: { type: "wait" } }) };
  if (s.kind === "code") {
    if (!ctx.brain) throw new Error(`arm "${a.name}": the post's seat has no code brain here`);
    const brain = ctx.brain;
    return { decide: (w) => ({ action: brain.step(w.observation, w.woke_for, w.since).action }) };
  }
  const slash = s.model.indexOf("/");
  const provider = slash < 0 ? s.model : s.model.slice(0, slash), name = slash < 0 ? "" : s.model.slice(slash + 1);
  if (provider === "mock") {
    if (!ctx.brain) throw new Error(`arm "${a.name}": mock models are policies over the post's code brain, which this seat lacks`);
    return mockModel(name, ctx.brain);
  }
  const make = ctx.factories[provider];
  if (!make) throw new Error(`arm "${a.name}": no seat controller for provider "${provider}" in this host (give runExperiment a SeatFactory for it: docs/experiments.md, "Real models")`);
  return make({ seat: ctx.seat, post: ctx.post, model: s.model, effort: s.effort, params: s.params, brain: ctx.brain, spec: ctx.spec });
}

// ---- measures

const RECORDED = (e: any) => e.kind === "event" && e.body?.event === "recorded";
const acted = (e: any, seat: string) => e.kind === "command" && e.body?.command === "act" && e.body.participant === seat;

const BUILTIN: { [name: string]: (arg: string | undefined, c: MeasureContext) => { see(e: any): void; result(): number | null } } = {
  /** Acts the steward's seat made. */
  acts: (_a, c) => { let n = 0; return { see: (e) => { if (acted(e, c.seat)) n++; }, result: () => n }; },
  /** Papers recorded in the town (all, or of one kind: `records:weather_warning`). */
  records: (a) => { let n = 0; return { see: (e) => { if (RECORDED(e) && (!a || e.body.record?.kind === a)) n++; }, result: () => n }; },
  /** Actions the kernel refused. */
  refused: () => { let n = 0; return { see: (e) => { if (e.kind === "event" && e.body?.event === "action_refused") n++; }, result: () => n }; },
  /** Whole days from the fork to the steward's first act (absent: it made none). */
  first_act_day: (_a, c) => { let t: number | null = null; return { see: (e) => { if (t === null && acted(e, c.seat)) t = e.t; }, result: () => (t === null ? null : Math.floor((t - c.forkT) / DAY)) }; },
  /** Whole days from the fork to the first paper of a kind (`first_record:weather_warning`; absent: none). */
  first_record: (a, c) => { let t: number | null = null; return { see: (e) => { if (t === null && RECORDED(e) && e.body.record?.kind === a) t = e.t; }, result: () => (t === null ? null : Math.floor((t - c.forkT) / DAY)) }; },
  /** Money that moved between accounts, in cents, summed. */
  transfers_cents: () => { let n = 0; return { see: (e) => { if (e.kind === "event" && e.body?.event === "transfer") n += Number(e.body.amount) || 0; }, result: () => n }; },
  /** Acts withheld in this fork (an arm's `withhold`): 0 where the act it names never came. */
  withheld: () => { let n = 0; return { see: (e) => { if (e.kind === "annotation" && e.body?.annotation === "note" && e.body.data?.withheld) n++; }, result: () => n }; },
  /** Entries the log gained from the fork on. */
  log_entries: () => { let n = 0; return { see: () => { n++; }, result: () => n }; },
};

export function makeMeasure(m: string | MeasureMaker, ctx: MeasureContext): { name: string; see(e: any): void; result(): number | null } {
  if (typeof m !== "string") return { name: m.name, ...m.make(ctx) };
  const i = m.indexOf(":");
  const base = i < 0 ? m : m.slice(0, i), arg = i < 0 ? undefined : m.slice(i + 1);
  const f = BUILTIN[base];
  if (!f && STEWARDSHIP_NAMES.has(m)) {
    if (!ctx.stewardship) throw new Error(`measure "${m}" is the stewardship ledger's, and this fork has none`);
    const read = ctx.stewardship;
    return { name: m, see: () => {}, result: () => read().measures[m] ?? null };
  }
  if (!f) throw new Error(`no measure "${m}" (built in: ${Object.keys(BUILTIN).join(", ")}, the stewardship measures (measure/src/stewardship.ts), or "stewardship" for them all; or give a MeasureMaker)`);
  if ((base === "first_record") && !arg) throw new Error(`measure "first_record" needs a kind: first_record:<kind>`);
  return { name: m, ...f(arg, ctx) };
}

// ---- one fork (an arm of a seed)

export interface Cost { calls: number; input_tokens: number; output_tokens: number; cost_microusd: number }
export interface ArmResult {
  seed: number; arm: string; steward: Steward;
  stateHash: string; t: number; steps: number; wakes: number;
  measures: { [name: string]: number | null };
  /** The stewardship ledger's detail (by office, month, supplier and institution), where the spec asked for its measures. */
  stewardship?: Omit<StewardshipResult, "measures">;
  /** The seats' usage, from the log's own usage annotations, by seat. */
  costs: { [seat: string]: Cost };
  log?: string;
  seconds: number;
  error?: string;
}

interface SeedFiles { dir: string; base: string; snapshot: string; brains: string; config: string; ledger: string }
const files = (dir: string): SeedFiles => ({ dir, base: join(dir, "base.oklog"), snapshot: join(dir, "snapshot.bin"), brains: join(dir, "brains.json"), config: join(dir, "config.json"), ledger: join(dir, "ledger.json") });
const seedDir = (out: string, seed: number) => join(out, `seed-${seed}`);

/** Runs the town of a seed to the fork point and keeps what a fork needs: the snapshot, the twins' brains, the config. */
export async function runBase(spec: ExperimentSpec, seed: number, out: string): Promise<{ seed: number; t: number; stateHash: string }> {
  const f = files(seedDir(out, seed));
  mkdirSync(f.dir, { recursive: true });
  const config = await buildConfig(spec, seed);
  const forkT = spec.forkDay * DAY;
  const ledger = wantsStewardship(spec) ? new Ledger({ config, from: forkT, steward: stewardOf(postHolder(config, spec.post), { kind: "code" }), ...(spec.institutions ? { institutions: spec.institutions } : {}) }) : undefined;
  const w = RustWorld.start(config, { run_id: `${spec.name}-seed${seed}`, log: f.base, until: spec.untilDay * DAY, threads: spec.threads ?? 1, stand_in: standIn(spec), label: "base", ...(ledger ? { stream: { cap: 4_000_000 } } : {}) });
  // (The base's past, read into the ledger so that each fork's starts from it: systems delivered, who worked where.)
  const pull = () => { if (ledger) for (;;) { const { entries } = w.events(); if (!entries.length) return; for (const e of entries) ledger.see(e); } };
  // (Until the fork every seat is its code twin: the same town whatever the arms later say.)
  const brains = twinSpecs(config);
  const live = new Map([...brains].map(([id, s]) => [id, new DetachedActor(s)]));
  for (;;) {
    pull();
    const d = w.nextBy(forkT);
    if (d.due !== "seats") {
      if (d.due === "end") throw new Error(`seed ${seed}: the run ended at ${d.t} before the fork day ${spec.forkDay}`);
      break;
    }
    for (const s of d.seats) w.submit(s.key, live.get(s.participant)?.step(s.observation, s.woke_for, s.since).action ?? { type: "wait" });
  }
  w.flush();
  pull();
  if (ledger) writeFileSync(f.ledger, JSON.stringify(ledger.save()));
  writeFileSync(f.snapshot, w.snapshot());
  writeFileSync(f.brains, JSON.stringify(Object.fromEntries([...live].map(([id, b]) => [id, b.save()]))));
  writeFileSync(f.config, JSON.stringify(config));
  return { seed, t: w.t(), stateHash: w.stateHash() };
}

const postHolder = (config: any, post: string): string => (config.positions.find((x: any) => x.id === post)).holder as string;

const standIn = (spec: ExperimentSpec) => spec.standIn ?? process.env.OIKOS_STAND_IN ?? "idle";

/** Runs one arm from a seed's snapshot to the end of the run. */
export async function runArm(spec: ExperimentSpec, seed: number, arm: Arm, out: string, factories: SeatFactories = {}): Promise<ArmResult> {
  const t0 = performance.now();
  const f = files(seedDir(out, seed));
  const config = JSON.parse(readFileSync(f.config, "utf8"));
  const saved: { [participant: string]: object } = JSON.parse(readFileSync(f.brains, "utf8"));
  const seat = postHolder(config, spec.post);
  const brainOf = (id: string) => { const s = twinSpecs(config).get(id); return s && saved[id] ? new DetachedActor({ ...s, saved: saved[id]! }) : undefined; };
  const brains = new Map([...twinSpecs(config).keys()].map((id) => [id, brainOf(id)!]));
  const logPath = join(f.dir, `${safe(arm.name)}.oklog`);
  const w = RustWorld.resume(readFileSync(f.snapshot), { log: logPath, parent: "base.oklog", label: arm.name, until: spec.untilDay * DAY, threads: spec.threads ?? 1, stream: { cap: 4_000_000 }, ...(arm.withhold?.length ? { withhold: arm.withhold } : {}) });
  const forkT = w.t();
  // (The stewardship ledger: the base's, taken up with this arm's steward, counting from the fork.)
  const ledger = wantsStewardship(spec) ? (existsSync(f.ledger) ? Ledger.restore(JSON.parse(readFileSync(f.ledger, "utf8")), { from: forkT, steward: stewardOf(seat, arm.steward), ...(spec.institutions ? { institutions: spec.institutions } : {}) }) : new Ledger({ config, from: forkT, steward: stewardOf(seat, arm.steward), ...(spec.institutions ? { institutions: spec.institutions } : {}) })) : undefined;
  let ledgerResult: StewardshipResult | undefined;
  const ctx: MeasureContext = { forkT, seat, post: spec.post, steward: arm.steward, ...(ledger ? { stewardship: () => (ledgerResult ??= ledger.result()) } : {}) };
  const measures = measureList(spec).map((m) => makeMeasure(m, ctx));
  const costs: { [seat: string]: Cost } = {};
  const pull = () => {
    for (;;) {
      const { entries } = w.events();
      if (!entries.length) return;
      for (const e of entries) {
        ledger?.see(e);
        for (const m of measures) m.see(e);
        if (e.kind === "annotation" && e.body?.annotation === "usage") {
          const c = (costs[e.body.subject] ??= { calls: 0, input_tokens: 0, output_tokens: 0, cost_microusd: 0 });
          c.calls++; c.input_tokens += e.body.input_tokens ?? 0; c.output_tokens += e.body.output_tokens ?? 0; c.cost_microusd += e.body.cost_microusd ?? 0;
        }
      }
    }
  };
  const controller = await controllerFor(arm, { seat, post: spec.post, brain: brains.get(seat), spec, factories });
  const model = arm.steward.kind === "model" ? arm.steward.model : undefined;
  const price = model ? spec.prices?.[model] ?? { input: 0, output: 0 } : undefined;
  let wakes = 0;
  pull();
  for (;;) {
    const d = w.next();
    pull();
    if (d.due === "end") break;
    // Every seat of the round at once: the steward's model calls are in flight together with every other fork's of this worker.
    const actions = await Promise.all(d.seats.map(async (s) => {
      wakes++;
      if (s.participant === seat) {
        const r = await controller.decide(s);
        if (r.usage && model) {
          const [provider, ...rest] = model.split("/");
          const cost = Math.ceil((r.usage.input_tokens * price!.input + r.usage.output_tokens * price!.output) / 1_000_000);
          w.annotate({ annotation: "usage", purpose: "participant", subject: seat, provider, model: rest.join("/"), input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens, cost_microusd: cost });
        }
        return r.action;
      }
      const b = brains.get(s.participant);
      return b ? b.step(s.observation, s.woke_for, s.since).action : { type: "wait" };
    }));
    d.seats.forEach((s, i) => w.submit(s.key, actions[i]!));
  }
  const end = w.finish();
  pull();
  const result: ArmResult = {
    seed, arm: arm.name, steward: arm.steward, stateHash: end.state_hash, t: end.t, steps: end.steps, wakes,
    measures: Object.fromEntries(measures.map((m) => [m.name, m.result()])), costs, log: logPath, seconds: Math.round((performance.now() - t0)) / 1000,
  };
  if (ledgerResult) { const { measures: _m, ...detail } = ledgerResult; result.stewardship = detail; }
  writeFileSync(join(f.dir, `${safe(arm.name)}.json`), JSON.stringify(result, null, 1));
  return result;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");

// ---- the report

export interface Stat { n: number; mean: number | null; sd: number | null; min: number | null; max: number | null; values: { seed: number; value: number | null }[] }
export interface Report {
  name: string; reference: string; seeds: number[]; forkDay: number; untilDay: number; post: string;
  arms: { name: string; steward: Steward; measures: { [name: string]: Stat }; cost: { calls: Stat; cost_usd: Stat; input_tokens: Stat; output_tokens: Stat } ; stateHashes: { [seed: number]: string } }[];
  /** Each arm's measure minus the reference arm's, seed by seed (the same town and seed): mean and spread of the differences. */
  versus: { arm: string; measures: { [name: string]: Stat } }[];
  failures: { seed: number; arm: string; error: string }[];
  /** Every comparison with its interval: the registered ones (primary, secondary), then every other arm against the
   * reference on every measure (exploratory). */
  comparisons?: ComparisonResult[];
  /** The registration the report was read against (absent: none; every comparison is exploratory). */
  preregistration?: { file: string; sha256: string; registered: string; committed?: string; question: string; level: number; correction: string; primary: number };
  /** Plain words, first: what was compared, what the registered comparisons show, how many exploratory ones moved. */
  summary?: string[];
}

export interface ComparisonResult {
  key: string; measure: string; status: "primary" | "secondary" | "exploratory";
  /** Arm minus vs; or (A - B) - (C - D). */
  arm?: string; vs?: string; did?: [string, string, string, string];
  expect?: "higher" | "lower" | "none";
  interval: Interval;
  /** The comparison in words. */
  reading: string;
}

/** A registration, as the harness holds it with a run: the parsed file, its hash, where it was, and when git first had it. */
export interface HeldPrereg { prereg: Preregistration; file: string; sha256: string; committed?: string }

const stat = (values: { seed: number; value: number | null }[]): Stat => {
  const xs = values.map((v) => v.value).filter((v): v is number => v !== null);
  const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const sd = xs.length > 1 && mean !== null ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : xs.length ? 0 : null;
  return { n: xs.length, mean, sd, min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null, values };
};

export function buildReport(spec: ExperimentSpec, results: ArmResult[], held?: HeldPrereg): Report {
  const reference = spec.reference ?? spec.arms[0]!.name;
  const ok = results.filter((r) => !r.error);
  const names = [...new Set(ok.flatMap((r) => Object.keys(r.measures)))];
  const seatOf = (r: ArmResult) => Object.values(r.costs).reduce((a, c) => ({ calls: a.calls + c.calls, i: a.i + c.input_tokens, o: a.o + c.output_tokens, c: a.c + c.cost_microusd }), { calls: 0, i: 0, o: 0, c: 0 });
  const of = (arm: string) => ok.filter((r) => r.arm === arm).sort((a, b) => a.seed - b.seed);
  const arms = spec.arms.map((a) => {
    const rs = of(a.name);
    const col = (f: (r: ArmResult) => number | null) => stat(rs.map((r) => ({ seed: r.seed, value: f(r) })));
    return {
      name: a.name, steward: a.steward,
      measures: Object.fromEntries(names.map((m) => [m, col((r) => r.measures[m] ?? null)])),
      cost: { calls: col((r) => seatOf(r).calls), cost_usd: col((r) => seatOf(r).c / 1e6), input_tokens: col((r) => seatOf(r).i), output_tokens: col((r) => seatOf(r).o) },
      stateHashes: Object.fromEntries(rs.map((r) => [r.seed, r.stateHash])),
    };
  });
  const ref = of(reference);
  const versus = spec.arms.filter((a) => a.name !== reference).map((a) => ({
    arm: a.name,
    measures: Object.fromEntries(names.map((m) => [m, stat(of(a.name).flatMap((r) => {
      const b = ref.find((x) => x.seed === r.seed);
      const x = r.measures[m], y = b?.measures[m];
      return b && x !== null && x !== undefined && y !== null && y !== undefined ? [{ seed: r.seed, value: x - y }] : [];
    }))])),
  }));
  const failures = results.filter((r) => r.error).map((r) => ({ seed: r.seed, arm: r.arm, error: r.error! }));
  const report: Report = { name: spec.name, reference, seeds: spec.seeds, forkDay: spec.forkDay, untilDay: spec.untilDay, post: spec.post, arms, versus, failures };
  const bySeed = (arm: string, m: string) => of(arm).map((r) => ({ seed: r.seed, value: r.measures[m] ?? null }));
  const comparisons: ComparisonResult[] = [];
  const level = held?.prereg.level ?? spec.level ?? 0.95;
  const registered = new Set<string>();
  if (held) {
    const p = held.prereg;
    const k = p.primary.length;
    const each = (p.correction ?? "bonferroni") === "bonferroni" ? bonferroni(level, k) : level;
    for (const [status, list, lv] of [["primary", p.primary, each], ["secondary", p.secondary ?? [], level]] as const) {
      for (const c of list) {
        const key = comparisonKey(c, p.reference);
        registered.add(key);
        comparisons.push(compared(c, status, lv, p.reference, bySeed, names.includes(c.measure)));
      }
    }
    report.preregistration = { file: held.file, sha256: held.sha256, registered: p.registered, ...(held.committed ? { committed: held.committed } : {}), question: p.question, level, correction: p.correction ?? "bonferroni", primary: k };
  }
  for (const m of names) for (const a of spec.arms) {
    if (a.name === reference) continue;
    const c: Comparison = { measure: m, arm: a.name, vs: reference };
    if (registered.has(comparisonKey(c, reference))) continue;
    comparisons.push(compared(c, "exploratory", level, reference, bySeed, true));
  }
  report.comparisons = comparisons;
  report.summary = summaryOf(report);
  return report;
}

const num = (x: number | null) => (x === null ? "-" : Math.abs(x) >= 100 || Number.isInteger(x) ? String(Math.round(x * 100) / 100) : x.toFixed(Math.abs(x) < 1 ? 3 : 2));

function compared(c: Comparison, status: ComparisonResult["status"], level: number, reference: string, bySeed: (arm: string, m: string) => { seed: number; value: number | null }[], measured: boolean): ComparisonResult {
  const vs = c.vs ?? reference;
  const values = !measured ? [] : c.did ? differenceInDifferences(bySeed(c.did[0], c.measure), bySeed(c.did[1], c.measure), bySeed(c.did[2], c.measure), bySeed(c.did[3], c.measure)) : pairedDifferences(bySeed(c.arm!, c.measure), bySeed(vs, c.measure));
  const iv = interval(values, level);
  const what = c.did ? `(${c.did[0]} - ${c.did[1]}) - (${c.did[2]} - ${c.did[3]})` : `${c.arm} - ${vs}`;
  let reading: string;
  if (!measured) reading = `${c.measure}, ${what}: not measured in this run (the spec did not ask for it).`;
  else if (iv.n === 0) reading = `${c.measure}, ${what}: no seed had a value in both arms.`;
  else {
    const pct = `${Math.round(iv.level * 1000) / 10}%`;
    const span = iv.lo === null ? `one seed: no interval` : `${pct} interval ${num(iv.lo)} to ${num(iv.hi)}`;
    const side = iv.lo === null ? "" : iv.lo > 0 || iv.hi! < 0 ? " The interval excludes zero." : " The interval includes zero.";
    const exp = c.expect && c.expect !== "none" && iv.lo !== null ? ` Registered expectation ${c.expect}: ${(c.expect === "higher" ? iv.lo > 0 : iv.hi! < 0) ? "the interval agrees" : (c.expect === "higher" ? iv.hi! < 0 : iv.lo > 0) ? "the interval is on the other side" : "the interval does not settle it"}.` : "";
    reading = `${c.measure}, ${what}: ${num(iv.mean)} (${span}; ${iv.above} of ${iv.n} seeds above zero, ${iv.below} below).${side}${exp}`;
  }
  return { key: comparisonKey(c, reference), measure: c.measure, status, ...(c.did ? { did: c.did } : { arm: c.arm, vs }), ...(c.expect ? { expect: c.expect } : {}), interval: iv, reading };
}

/** The plain words at the top of a report. */
function summaryOf(r: Report): string[] {
  const out: string[] = [];
  const cs = r.comparisons ?? [];
  out.push(`${r.arms.length} arms in the post ${r.post} (${r.arms.map((a) => a.name).join(", ")}), the same town per seed, ${r.seeds.length} seed${r.seeds.length === 1 ? "" : "s"}, forked at day ${r.forkDay} and run to day ${r.untilDay}. Each comparison is one arm's measure minus another's, seed by seed; the platform does not say which is better.`);
  const p = r.preregistration;
  if (p) {
    const each = p.correction === "bonferroni" && p.primary > 1 ? ` (Bonferroni: each at ${Math.round(bonferroni(p.level, p.primary) * 1000) / 10}%)` : "";
    out.push(`Pre-registered on ${p.registered}${p.committed ? `, first committed ${p.committed}` : ", not in git when it ran"}: "${p.question}". ${p.primary} primary comparison${p.primary === 1 ? "" : "s"}, read together at ${Math.round(p.level * 1000) / 10}%${each}:`);
    for (const c of cs.filter((x) => x.status === "primary")) out.push(`  - ${c.reading}`);
    const sec = cs.filter((x) => x.status === "secondary");
    if (sec.length) { out.push(`Secondary (registered, read after the primary, each at ${Math.round(p.level * 1000) / 10}% alone):`); for (const c of sec) out.push(`  - ${c.reading}`); }
  } else out.push("Nothing was pre-registered: every comparison here is exploratory.");
  const all = cs.filter((x) => x.status === "exploratory");
  const ex = all.filter((x) => x.interval.lo !== null);
  const moved = ex.filter((x) => x.interval.lo! > 0 || x.interval.hi! < 0);
  const without = all.length - ex.length;
  out.push(`Exploratory: ${all.length} other comparison${all.length === 1 ? "" : "s"} against ${r.reference}${without ? ` (${without} with no interval: one seed, or nothing counted)` : ""}, of which ${moved.length} ha${moved.length === 1 ? "s" : "ve"} an interval that excludes zero. They are leads for a registered experiment, not findings${moved.length ? ":" : "."}`);
  for (const c of moved.slice(0, 8)) out.push(`  - ${c.reading}`);
  if (moved.length > 8) out.push(`  - and ${moved.length - 8} more (report.json, "comparisons").`);
  if (r.failures.length) out.push(`${r.failures.length} fork${r.failures.length === 1 ? "" : "s"} failed: their seeds are missing from the comparisons that need them.`);
  return out;
}

const fmt = (x: number | null, digits = 2) => (x === null ? "-" : Number.isInteger(x) ? String(x) : x.toFixed(digits));
const cell = (s: Stat, d = 2) => (s.n === 0 ? "-" : s.n === 1 ? fmt(s.mean, d) : `${fmt(s.mean, d)} ±${fmt(s.sd, d)} [${fmt(s.min, d)}..${fmt(s.max, d)}]`);

/** The report as text: a table per measure, an arm a row; `mean ±sd [min..max]` over the seeds. */
export function reportText(r: Report): string {
  const lines = [...(r.summary ?? []), "",`Experiment ${r.name}: post ${r.post}; forked at day ${r.forkDay}, run to day ${r.untilDay}; ${r.seeds.length} seed${r.seeds.length === 1 ? "" : "s"} (${r.seeds.join(", ")}); reference arm ${r.reference}.`,
    "Each cell is the mean over the seeds, with the sample sd and [min..max]; '-' none. Nothing here says which arm is better."];
  const measures = Object.keys(r.arms[0]?.measures ?? {});
  const w = Math.max(10, ...r.arms.map((a) => a.name.length));
  for (const m of measures) {
    lines.push("", m);
    for (const a of r.arms) lines.push(`  ${a.name.padEnd(w)}  ${cell(a.measures[m]!)}`);
    for (const v of r.versus) {
      const c = (r.comparisons ?? []).find((x) => x.measure === m && x.arm === v.arm && x.vs === r.reference);
      const iv = c && c.interval.lo !== null ? `; ${Math.round(c.interval.level * 1000) / 10}% ${fmt(c.interval.lo)}..${fmt(c.interval.hi)}${c.status === "exploratory" ? "" : ` (${c.status})`}` : "";
      lines.push(`  ${("  " + v.arm + " - " + r.reference).padEnd(w + 2)}  ${cell(v.measures[m]!)}${iv}`);
    }
  }
  lines.push("", "seats' cost (the steward's model calls)");
  for (const a of r.arms) lines.push(`  ${a.name.padEnd(w)}  calls ${cell(a.cost.calls)}; tokens in ${cell(a.cost.input_tokens)}, out ${cell(a.cost.output_tokens)}; USD ${cell(a.cost.cost_usd, 4)}`);
  if (r.failures.length) lines.push("", "FAILED:", ...r.failures.map((f) => `  seed ${f.seed}, ${f.arm}: ${f.error}`));
  return lines.join("\n");
}

// ---- the whole experiment

export interface RunOptions {
  out: string;
  /** Worker processes (default: cores less two, at most the number of jobs). 0: everything in this process, one job after another (tests). */
  parallel?: number;
  /** The file the spec was read from (workers load it again; required when `parallel` is not 0). */
  specFile?: string;
  /** Seat factories for real models (in this process; workers load them from the spec file's `seatFactories` export). */
  factories?: SeatFactories;
  /** Run a worker inside a slot of the machine's pool (scripts/slots.ts; default true). */
  slots?: boolean;
  log?: (s: string) => void;
}

/** Reads a spec file: `.json`, `.yaml`, or `.ts` (default export, which may hold functions: `prepare`, measure makers). */
export async function loadSpec(file: string): Promise<{ spec: ExperimentSpec; factories?: SeatFactories }> {
  const path = resolve(file);
  if (path.endsWith(".ts") || path.endsWith(".js")) {
    const m = await import(path);
    return { spec: m.default as ExperimentSpec, factories: m.seatFactories };
  }
  const text = readFileSync(path, "utf8");
  return { spec: (path.endsWith(".json") ? JSON.parse(text) : Bun.YAML.parse(text)) as ExperimentSpec };
}

export function validate(spec: ExperimentSpec, factories: SeatFactories = {}): void {
  const bad = (m: string) => { throw new Error(`experiment ${spec.name ?? "?"}: ${m}`); };
  if (!spec.name) bad("it has no name");
  if (!spec.post) bad("it names no post");
  if (!spec.seeds?.length) bad("it has no seeds");
  if (!spec.arms?.length) bad("it has no arms");
  if (!(spec.forkDay >= 0) || !(spec.untilDay > spec.forkDay)) bad("forkDay must come before untilDay");
  const names = new Set<string>();
  for (const a of spec.arms) {
    if (names.has(a.name)) bad(`two arms are called ${a.name}`);
    names.add(a.name);
    for (const x of a.withhold ?? []) if (!x?.what || (x.nth !== undefined && !(Number.isInteger(x.nth) && x.nth >= 1))) bad(`arm ${a.name}: a withhold names what (a kind of paper or a block) and an nth from 1`);
    if (a.steward.kind === "model") {
      const provider = a.steward.model.split("/")[0]!;
      if (provider !== "mock" && !factories[provider]) bad(`arm ${a.name}: model ${a.steward.model} has no seat controller here; real models need a SeatFactory (docs/experiments.md, "Real models")`);
    }
  }
  if (spec.reference && !names.has(spec.reference)) bad(`the reference arm ${spec.reference} is not an arm`);
}

/** Runs the experiment: a base per seed, then every arm of every seed from its base, and the report. */
/** The spec's registration, read and checked against the spec before anything runs (absent: none). Throws on any
 * disagreement: an experiment runs as registered or not at all. */
export function loadPrereg(spec: ExperimentSpec, specFile?: string): HeldPrereg | undefined {
  if (!spec.preregistration) return undefined;
  const near = specFile ? resolve(dirname(resolve(specFile)), spec.preregistration) : resolve(spec.preregistration);
  const file = existsSync(near) ? near : resolve(spec.preregistration);
  if (!existsSync(file)) throw new Error(`experiment ${spec.name}: its preregistration ${spec.preregistration} is not there`);
  const text = readFileSync(file, "utf8");
  const prereg = parsePrereg(text, file);
  const asked = new Set(measureList(spec).filter((m): m is string => typeof m === "string"));
  const problems = [...preregProblems(prereg, (m) => asked.has(m)), ...specMismatch(prereg, spec)];
  if (problems.length) throw new Error(`experiment ${spec.name}: its preregistration ${file} does not hold:\n  ${problems.join("\n  ")}`);
  return { prereg, file, sha256: preregHash(text), ...committedAt(file) };
}

/** When git first had the file, if what is on disk is what git has (else nothing: it was changed since). */
function committedAt(file: string): { committed?: string } {
  const git = (args: string[]) => Bun.spawnSync(["git", "-C", dirname(file), ...args], { stdout: "pipe", stderr: "ignore" });
  const unchanged = git(["diff", "--quiet", "HEAD", "--", file]).exitCode === 0 && git(["ls-files", "--error-unmatch", file]).exitCode === 0;
  if (!unchanged) return {};
  const first = git(["log", "--diff-filter=A", "--format=%cI", "--", file]).stdout.toString().trim().split("\n").pop();
  return first ? { committed: first } : {};
}

/** The registered comparisons that need citizens who take recourse (the responsiveness and recourse families), where
 * the town's citizens take none: a town without `living` has `dials.initiative_bps` and `dials.friction_bps` at 0, so
 * nothing goes wrong for anyone and nobody asks, appeals, complains or petitions (docs/behaviour/frictions.md; the
 * worked example of 2026-10-23 measured exactly that). Empty: nothing to say. */
export function recourseProblems(config: any, held?: HeldPrereg): string[] {
  const dial = (k: string) => Number(config?.dials?.[k] ?? 0) > 0;
  if (dial("initiative_bps") && dial("friction_bps")) return [];
  const needs = new Set(STEWARDSHIP_MEASURES.filter((m) => m.family === "responsiveness" || m.family === "recourse").map((m) => m.name));
  const registered = held ? [...(held.prereg.primary ?? []), ...(held.prereg.secondary ?? [])].map((c) => c.measure) : [];
  const named = [...new Set(registered.filter((m) => needs.has(m)))];
  if (!named.length) return [];
  return [`it registers ${named.join(", ")}, but its town's citizens take no recourse (dials.initiative_bps ${config?.dials?.initiative_bps ?? 0}, dials.friction_bps ${config?.dials?.friction_bps ?? 0}: a town without \`living\`; set living.initiative_bps and living.friction_bps)`];
}

export async function runExperiment(spec: ExperimentSpec, o: RunOptions): Promise<{ report: Report; results: ArmResult[]; text: string; out: string }> {
  const say = o.log ?? (() => {});
  validate(spec, o.factories);
  const held = loadPrereg(spec, o.specFile);
  // (A comparison that cannot move is not run: the first seed's town says whether its citizens take recourse at all.)
  const lever = held ? recourseProblems(await buildConfig(spec, spec.seeds[0]!), held) : [];
  if (lever.length) throw new Error(`experiment ${spec.name}: ${lever.join("; ")}`);
  const out = resolve(o.out);
  if (existsSync(join(out, "results.json"))) throw new Error(`${out} already holds an experiment's results: a run is training data and is never overwritten; name another folder`);
  mkdirSync(out, { recursive: true });
  if (held) {
    // (The registration as it was when the run began, kept beside the results with its hash and its commit time.)
    copyFileSync(held.file, join(out, `preregistration${held.file.endsWith(".json") ? ".json" : ".yaml"}`));
    writeFileSync(join(out, "preregistration.held.json"), JSON.stringify({ file: held.file, sha256: held.sha256, ...(held.committed ? { committed: held.committed } : {}) }, null, 1));
  }
  writeFileSync(join(out, "spec.json"), JSON.stringify(spec, (_k, v) => (typeof v === "function" ? "[function]" : v), 1));
  const jobsN = spec.seeds.length * spec.arms.length;
  const workers = o.parallel === 0 ? 0 : Math.max(1, Math.min(o.parallel ?? Math.max(1, availableParallelism() - 2), jobsN));
  if (workers && !o.specFile) throw new Error("workers load the spec again: give the spec file (specFile), or parallel: 0");
  const t0 = performance.now();
  let results: ArmResult[];
  if (!workers) {
    for (const seed of spec.seeds) { const b = await runBase(spec, seed, out); say(`seed ${seed}: base to day ${spec.forkDay} (state ${b.stateHash.slice(0, 12)})`); }
    // (Every fork at once, their steward's calls in flight together.)
    results = await Promise.all(spec.seeds.flatMap((seed) => spec.arms.map((a) => runArm(spec, seed, a, out, o.factories).catch((e) => failed(seed, a, e)))));
  } else {
    await dealt(spec.seeds.map((seed) => ({ type: "base" as const, seed })), workers, spec, o, say);
    const arms = spec.seeds.flatMap((seed) => spec.arms.map((a) => ({ type: "arm" as const, seed, arm: a.name })));
    results = (await dealt(arms, workers, spec, o, say)) as ArmResult[];
  }
  results.sort((a, b) => a.seed - b.seed || spec.arms.findIndex((x) => x.name === a.arm) - spec.arms.findIndex((x) => x.name === b.arm));
  const report = buildReport(spec, results, held);
  const text = reportText(report);
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 1));
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
  writeFileSync(join(out, "report.txt"), text + "\n");
  say(`done in ${Math.round(performance.now() - t0) / 1000} s: ${results.length} forks, ${results.filter((r) => r.error).length} failed`);
  return { report, results, text, out };
}

const failed = (seed: number, a: Arm, e: unknown): ArmResult => ({ seed, arm: a.name, steward: a.steward, stateHash: "", t: 0, steps: 0, wakes: 0, measures: {}, costs: {}, seconds: 0, error: String((e as Error)?.message ?? e) });

type Job = { type: "base"; seed: number } | { type: "arm"; seed: number; arm: string };

/** Deals jobs round-robin to worker processes; each worker runs its arms together (their seats' calls in flight at once). */
async function dealt(jobs: Job[], workers: number, spec: ExperimentSpec, o: RunOptions, say: (s: string) => void): Promise<unknown[]> {
  const hands: Job[][] = Array.from({ length: Math.min(workers, jobs.length) }, () => []);
  jobs.forEach((j, i) => hands[i % hands.length]!.push(j));
  const tmp = join(resolve(o.out), ".jobs");
  mkdirSync(tmp, { recursive: true });
  const worker = join(import.meta.dir, "experiment-worker.ts");
  const root = join(import.meta.dir, "..", "..");
  const outs = await Promise.all(hands.map(async (hand, i) => {
    const file = join(tmp, `${jobs[0]!.type}-${i}.json`), result = join(tmp, `${jobs[0]!.type}-${i}.result.json`);
    writeFileSync(file, JSON.stringify({ specFile: o.specFile, spec: plain(spec), out: resolve(o.out), jobs: hand, result }));
    const useSlots = o.slots !== false && existsSync(join(root, "scripts/slots.ts"));
    const cmd = useSlots ? ["bun", join(root, "scripts/slots.ts"), "--weight", String(spec.threads ?? 1), "--what", `experiment ${spec.name} worker`, "--", "bun", worker, file] : ["bun", worker, file];
    const p = Bun.spawn(cmd, { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: process.env });
    const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited, new Response(p.stdout).text()]);
    if (code !== 0 || !existsSync(result)) throw new Error(`a worker failed (exit ${code}): ${err.trim().split("\n").slice(-4).join(" | ")}`);
    say(`worker ${i + 1}/${hands.length}: ${hand.map((j) => (j.type === "base" ? `base ${j.seed}` : `${j.arm}@${j.seed}`)).join(", ")}`);
    return JSON.parse(readFileSync(result, "utf8")) as unknown[];
  }));
  return outs.flat();
}

/** The spec as data: what a worker is told, so that it runs the spec this process was given (a test may have changed the
 * file's), and takes only functions (`prepare`, measure makers, seat factories) from the file. */
function plain(spec: ExperimentSpec): object {
  const copy: any = JSON.parse(JSON.stringify(spec, (_k, v) => (typeof v === "function" ? undefined : v)));
  if ((spec.measures ?? []).some((m) => typeof m !== "string")) delete copy.measures;
  return copy;
}

/** What a worker does with its hand of jobs (experiment-worker.ts). */
export async function workHand(hand: { specFile: string; spec?: Partial<ExperimentSpec>; out: string; jobs: Job[] }): Promise<unknown[]> {
  const loaded = await loadSpec(hand.specFile);
  const factories = loaded.factories;
  const spec: ExperimentSpec = { ...loaded.spec, ...(hand.spec ?? {}), world: { ...loaded.spec.world, ...(hand.spec?.world ?? {}) } };
  const bases = hand.jobs.filter((j) => j.type === "base");
  const out: unknown[] = [];
  for (const j of bases) out.push(await runBase(spec, j.seed, hand.out));
  const arms = hand.jobs.flatMap((j) => (j.type === "arm" ? [j] : []));
  out.push(...(await Promise.all(arms.map((j) => runArm(spec, j.seed, spec.arms.find((a) => a.name === j.arm)!, hand.out, factories ?? {}).catch((e) => failed(j.seed, spec.arms.find((a) => a.name === j.arm)!, e))))));
  return out;
}

/** A finished experiment's report built again from what it left (its spec, results and the registration it ran under),
 * for a report whose code has changed since: nothing is written. */
export function rebuildReport(out: string): Report {
  const dir = resolve(out);
  const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8")) as ExperimentSpec;
  const results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as ArmResult[];
  const copy = ["preregistration.json", "preregistration.yaml"].map((f) => join(dir, f)).find(existsSync);
  let held: HeldPrereg | undefined;
  if (copy) {
    const meta = JSON.parse(readFileSync(join(dir, "preregistration.held.json"), "utf8"));
    const text = readFileSync(copy, "utf8");
    if (preregHash(text) !== meta.sha256) throw new Error(`${copy} is not the registration the run was made under (its hash differs)`);
    held = { prereg: parsePrereg(text, copy), file: meta.file, sha256: meta.sha256, ...(meta.committed ? { committed: meta.committed } : {}) };
  }
  return buildReport(spec, results, held);
}

/** The seeds' folders an experiment left (for tools that read its logs). */
export function forkLogs(out: string): string[] {
  return readdirSync(resolve(out), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("seed-")).flatMap((d) => readdirSync(join(out, d.name)).filter((f) => f.endsWith(".oklog")).map((f) => join(out, d.name, f)));
}
