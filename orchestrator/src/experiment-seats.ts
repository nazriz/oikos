// Model stewards in an experiment (docs/experiments.md, "Real models"): the seat factory, the models it may seat, the
// translator arrangement, the framing, and the spending limits per fork, per arm and per experiment.
//
// - **Which models.** A seat is called through what the owner already has: `anthropic/<model>` (the API, on the prepaid
//   credit his plan includes: the key is OIKOS_ANTHROPIC_KEY, never ANTHROPIC_API_KEY; at a spent credit the fork stops,
//   `CreditExhausted`, and nothing is bought), `claude-code/<model>` (Claude Code on his Claude plan) or `codex/<model>`
//   (the Codex CLI on his ChatGPT subscription). Never the largest Claude model, never Fable, never gpt-6-astra (refused
//   by name); a key that bills (`openai/`) only with `allow_paid_api`, which only the owner's go-ahead sets.
// - **The translator.** Ours first where named (`decide/<model>`), the general one behind it (the owner's arrangement of
//   2026-10-11: translator/src/arrangement.ts), one adapter of each per process (the trained one is a Python process).
// - **Framing.** The arm's, else the spec's `seats.framing`, else `unstated` (VISION 15, point 1, as amended 2026-10-12).
// - **Spending limits.** Each model fork has a limit of its own, fixed before anything runs, so that no fork can spend
//   another's and the experiment's total can never be passed however the forks are dealt to workers: a fork's limit is
//   the least of `fork_usd`, its arm's `arm_usd` shared over the arm's seeds, and `experiment_usd` shared over every
//   model fork. A fork that reaches it stops cleanly (callModel's `SpendingLimitReached`): its seat is debriefed out of
//   what the limit kept back, and the fork is reported as stopped, never compared as if it had run its course.
// - **A subscription's window.** A model whose provider says its usage limit is reached waits inside its own fork (the
//   world of that fork stands still; nothing else waits on it) and asks again, for at most `wait_for_window_hours`;
//   then the fork stops, as at a spending limit.
// - **Every call recorded, apart from the log.** Each model fork keeps `<arm>.calls.jsonl` beside its log: per call its
//   purpose, model, tokens (input, cache read, cache write, output), cost, wall time and error, and the attempt it was
//   (a fork taken up again after an interruption is a new attempt). The fork's result carries the summary; the run's
//   `cost.json` adds them up by fork, arm, model and purpose. Wall time is kept out of the log: the log is what the world
//   did, the same on every run; this file is how the calls went.
// - **A dry run.** `mock_models` (or OIKOS_EXPERIMENT_MOCK_MODELS=1): every model is played by the mock (the post's
//   code brain says what to do; participants/src/llm/mock.ts) through the whole loop, priced at the named model's
//   published price so that the limits are exercised. No model is called. The log says the mock answered.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { costMicroUsd, MockAdapter, mockPolicies, PRICES, type FramingSpec, type LlmAdapter, type Price } from "@oikos/participants/llm";
import { chooseModel, priceTable } from "./models";
import { ModelSeat, waitingAdapter } from "./seat-host";
import type { ExperimentSpec, SeatFactories, SeatFactory } from "./experiment";

export interface SeatsSpec {
  /** The translator: ours first (`decide/<model>`), the general one behind (a seat model's name). Absent: the arm's model alone. */
  translator?: { first?: string; behind?: string; arrangement?: "then" | "beside" };
  /** What the seats are told of what the town is (default `unstated`); an arm may name its own. */
  framing?: FramingSpec;
  budget?: {
    /** The whole experiment's model spending, USD (at the providers' published prices, as Claude Code reports a call). */
    experiment_usd?: number;
    /** An arm's, over its seeds: one figure for every model arm, or by arm. */
    arm_usd?: number | { [arm: string]: number };
    /** One fork's. */
    fork_usd?: number;
  };
  /** How long a fork waits for a subscription's window to open again before it stops (default 12 hours). */
  wait_for_window_hours?: number;
  /** Every model played by the mock: a dry run of the whole pipeline (no model is called). */
  mock_models?: boolean;
  /** A key that bills a card may be used (`openai/`): only with the owner's go-ahead. (`anthropic/` is the prepaid
   * credit, allowed: OIKOS_ANTHROPIC_KEY.) */
  allow_paid_api?: boolean;
  /** The most calls of one provider in flight at once in a worker process (default 4): a plan's rate, and the machine's
   * memory (each `claude -p` is a process). Only when a fork's calls are made changes; never what the world does. */
  calls_at_once?: number;
}

/** Models that are never seated or used as a translator here, by the owner's word. */
export const NEVER = /astra|fable|opus/i;
/** Providers through what the owner already has (a plan, a subscription, the API credit his plan includes; nothing
 * billed beyond it): the default allowed. */
export const PLAN_PROVIDERS = new Set(["anthropic", "claude-code", "codex"]);
const PAID = new Set(["openai"]);

export const mockModels = (spec: ExperimentSpec) => !!spec.seats?.mock_models || process.env.OIKOS_EXPERIMENT_MOCK_MODELS === "1";

/** The models a spec names (seats and translators) that it may not use: why, for each. */
export function modelProblems(spec: ExperimentSpec): string[] {
  const out: string[] = [];
  const check = (what: string, m: string | undefined, translator = false) => {
    if (!m) return;
    const provider = m.split("/")[0]!;
    if (NEVER.test(m)) out.push(`${what}: ${m} is never used here (the largest Claude model, Fable and gpt-6-astra are not)`);
    if (PAID.has(provider) && !spec.seats?.allow_paid_api) out.push(`${what}: ${m} is a paid API; seats go through what the owner has (anthropic/, claude-code/, codex/) unless the owner's go-ahead sets seats.allow_paid_api`);
    if (!PLAN_PROVIDERS.has(provider) && !PAID.has(provider) && provider !== "mock" && !(translator && provider === "decide")) out.push(`${what}: provider ${provider} is not one an experiment seats (anthropic, claude-code, codex${translator ? ", decide for our own translator" : ""})`);
  };
  for (const a of spec.arms) if (a.steward.kind === "model") check(`arm ${a.name}`, a.steward.model);
  check("seats.translator.first", spec.seats?.translator?.first, true);
  check("seats.translator.behind", spec.seats?.translator?.behind);
  if (spec.seats?.translator?.first && !spec.seats.translator.first.startsWith("decide/")) out.push(`seats.translator.first is our own trained translator (decide/<model>), not ${spec.seats.translator.first}`);
  return out;
}

const isReal = (model: string) => !model.startsWith("mock/");
/** The arms whose steward is a model that is not one of the harness's mock policies. */
export const modelArms = (spec: ExperimentSpec) => spec.arms.filter((a) => a.steward.kind === "model" && isReal(a.steward.model));

/**
 * Each model arm's limit per fork, USD (absent: no limit set for it). A fork's own is the lesser of `fork_usd` and its
 * arm's `arm_usd` shared over the arm's seeds; an arm with neither shares what `experiment_usd` leaves; and where the
 * forks' limits together would pass `experiment_usd`, every one is brought down in proportion, so that the experiment's
 * total can never be passed, however the forks are dealt to workers.
 */
export function forkLimits(spec: ExperimentSpec): { [arm: string]: number } {
  const b = spec.seats?.budget ?? {};
  const arms = modelArms(spec);
  const n = spec.seeds.length;
  const own = new Map<string, number | undefined>();
  for (const a of arms) {
    const armUsd = typeof b.arm_usd === "number" ? b.arm_usd : b.arm_usd?.[a.name];
    const each = [b.fork_usd, armUsd !== undefined ? armUsd / n : undefined].filter((x): x is number => x !== undefined);
    own.set(a.name, each.length ? Math.min(...each) : undefined);
  }
  if (b.experiment_usd !== undefined && n) {
    const set = [...own.values()].filter((x): x is number => x !== undefined).reduce((x, y) => x + y * n, 0);
    const open = [...own].filter(([, x]) => x === undefined).map(([k]) => k);
    if (open.length) for (const k of open) own.set(k, Math.max(0, b.experiment_usd - set) / (n * open.length));
    const total = [...own.values()].reduce((x: number, y) => x + (y ?? 0) * n, 0);
    if (total > b.experiment_usd) for (const [k, x] of own) own.set(k, (x ?? 0) * b.experiment_usd / total);
  }
  const out: { [arm: string]: number } = {};
  for (const [k, x] of own) if (x !== undefined) out[k] = Math.floor(x * 1e6) / 1e6;
  return out;
}

/** What a spec's spending limits leave unsaid: a priced model arm with no limit. */
export function budgetProblems(spec: ExperimentSpec): string[] {
  const limits = forkLimits(spec);
  const prices = priceTable();
  const out: string[] = [];
  for (const a of modelArms(spec)) {
    const m = (a.steward as { model: string }).model;
    const provider = m.split("/")[0]!;
    const priced = provider === "claude-code" ? prices[`anthropic/${m.split("/").slice(1).join("/").split("@")[0]}`] : prices[m];
    // (A flat-rate subscription's seat costs nothing a call, unless a priced translator drafts its requests.)
    const behind = spec.seats?.translator?.behind;
    const free = provider === "codex" && (!behind || behind.startsWith("codex/") || behind.startsWith("decide/"));
    if (provider !== "codex" && !priced) out.push(`arm ${a.name}: no published price for ${m} (orchestrator/prices.json)`);
    if (!free && limits[a.name] === undefined) out.push(`arm ${a.name}: ${m} costs money and has no spending limit (seats.budget: fork_usd, arm_usd or experiment_usd)`);
  }
  return out;
}

/** The price of a model as the harness prices its calls (Claude Code's at the model's API price; Codex at 0, a flat-rate subscription). */
export function priceOf(model: string): Price {
  const table = { ...PRICES, ...priceTable() };
  const [provider, ...rest] = model.split("/");
  const name = rest.join("/");
  if (provider === "codex" || provider === "decide") return { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  if (provider === "claude-code") return table[`anthropic/${name.split("@")[0]}`] ?? table[model]!;
  return table[model] ?? { input: 0, output: 0 };
}

// (One adapter of a model per process: our trained translator is a Python process, and a CLI's adapter keeps nothing.)
const adapters = new Map<string, LlmAdapter>();
function adapterFor(model: string, first = false, atOnce = 4): LlmAdapter {
  const key = `${model}${first ? "#first" : ""}`;
  let a = adapters.get(key);
  if (!a) {
    // (No limit is given here: each fork's own is held by its seat's calls, below. A price is all chooseModel needs.)
    const made = chooseModel(model, { budgetUsd: 0, first }).adapter;
    a = first ? made : atMost(made, gate(model.split("/")[0]!, atOnce));
    adapters.set(key, a);
  }
  return a;
}

/** One gate a provider, per process: at most `n` of its calls in flight, the rest queued in the order they came. */
const gates = new Map<string, { n: number; busy: number; queue: (() => void)[] }>();
const gate = (provider: string, n: number) => {
  let g = gates.get(provider);
  if (!g) gates.set(provider, (g = { n: Math.max(1, n), busy: 0, queue: [] }));
  return g;
};
export function atMost(a: LlmAdapter, g: { n: number; busy: number; queue: (() => void)[] }): LlmAdapter {
  return {
    provider: a.provider, model: a.model,
    complete: async (req) => {
      // (A slot freed is handed straight to the first waiting, so the count never passes n.)
      if (g.busy >= g.n) await new Promise<void>((go) => g.queue.push(go));
      else g.busy++;
      try {
        return await a.complete(req);
      } finally {
        const next = g.queue.shift();
        if (next) next();
        else g.busy--;
      }
    },
  };
}
/** The processes this one started for its adapters (our trained translator's), stopped at the end of a worker. */
export function closeAdapters(): void {
  for (const a of adapters.values()) (a as { close?: () => void }).close?.();
  adapters.clear();
}

/**
 * The seat factory for the providers an experiment seats: a `ModelSeat` (seat-host.ts) in the post, the translator
 * arrangement, the arm's framing, the fork's spending limit, and in a dry run the mock in each model's place.
 */
export function modelSeatFactories(spec: ExperimentSpec): SeatFactories {
  const make: SeatFactory = (a) => {
    if (!a.world || !a.config || a.seed === undefined || !a.dir) throw new Error("a model seat needs its fork (the harness passes world, config, seed and dir)");
    const dry = mockModels(spec);
    const arm = spec.arms.find((x) => x.steward.kind === "model" && x.steward.model === a.model && (!a.arm || x.name === a.arm))!;
    const steward = arm.steward as Extract<typeof arm.steward, { kind: "model" }>;
    const rec = callRecorder(join(a.dir, `${a.arm ?? "arm"}.calls.jsonl`), { seed: a.seed, arm: arm.name, seat: a.seat });
    // (A fork taken up again after an interruption: what its earlier attempts spent comes off its limit, so the
    // experiment's total still holds.)
    const allotted = forkLimits(spec)[arm.name];
    const limit = allotted === undefined ? undefined : Math.max(0, allotted - rec.earlierMicroUsd / 1e6);
    const prices: Record<string, Price> = { ...PRICES, ...priceTable() };
    // (In a dry run the mock plays every model, priced as the model it plays, so the limits bite as they would. Each
    // attempt at a call is recorded, inside the wait for a shut window: a wait is a refused call, then another.)
    const atOnce = spec.seats?.calls_at_once ?? 4;
    const seatAdapter = dry ? mockFor(a.model) : wait(rec.wrap(adapterFor(a.model, false, atOnce), a.model));
    prices[`${seatAdapter.provider}/${seatAdapter.model}`] = priceOf(a.model);
    const t = spec.seats?.translator;
    const behindName = t?.behind ?? a.model;
    const behind = dry ? rec.wrap(mockFor(behindName), behindName) : wait(rec.wrap(adapterFor(behindName, false, atOnce), behindName));
    prices[`${behind.provider}/${behind.model}`] = priceOf(behindName);
    let first: LlmAdapter | undefined;
    if (t?.first) {
      // (Our own translator answers in the dry run too: it calls no model, and a dry run is the arrangement as it will run.)
      first = rec.wrap(adapterFor(t.first, true), t.first);
      prices[`${first.provider}/${first.model}`] = priceOf(t.first);
    }
    if (dry && t?.first && !process.env.OIKOS_TRANSLATOR_MODELS) throw new Error(`seats.translator.first ${t.first}: set OIKOS_TRANSLATOR_MODELS to the folder of trained models`);
    const debriefsFile = join(a.dir, `${a.arm ?? "arm"}.debriefs.jsonl`);
    if (!existsSync(a.dir)) mkdirSync(a.dir, { recursive: true });
    const seat = new ModelSeat({
      world: a.world, config: a.config, seat: a.seat, post: a.post, seed: a.seed, model: a.model, adapter: seatAdapter,
      translator: { behind, ...(first ? { first, arrangement: t?.arrangement ?? "then" } : {}) }, prices,
      ...(limit !== undefined ? { budget: { limitMicroUsd: Math.round(limit * 1e6), spentMicroUsd: 0 } } : {}),
      framing: steward.framing ?? spec.seats?.framing ?? "unstated", ...(a.effort ? { effort: a.effort } : {}),
      ...(a.brain ? { brain: a.brain } : {}), ...(dry ? { record: (x: LlmAdapter) => rec.wrap(x, a.model) } : {}), debriefsFile, untilT: spec.untilDay * 86_400, ...(a.cast ? { cast: a.cast } : {}),
    });
    seat.start();
    return Object.assign(seat, { calls: () => rec.summary() });
  };
  const wait = (x: LlmAdapter) => waitingAdapter(x, { waitMs: 15 * 60_000, maxWaitMs: (spec.seats?.wait_for_window_hours ?? 12) * 3_600_000 });
  return { anthropic: make, "claude-code": make, codex: make, ...(spec.seats?.allow_paid_api ? { openai: make } : {}) };
}

/** The mock in a model's place: named for the model it plays, so the log and the costs say which arm it was. */
function mockFor(model: string): LlmAdapter {
  return new MockAdapter(model.replace(/\//g, "-"), mockPolicies(new Map()));
}

// ---- every call, recorded apart from the log

/** One fork's calls, summed: by purpose and model, with wall time and errors. */
export interface CallStats {
  /** This attempt's calls (a fork taken up again after an interruption starts a new attempt). */
  attempt: number;
  calls: number; errors: number;
  input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number;
  cost_microusd: number;
  /** What earlier attempts of the fork spent (counted against its limit). */
  earlier_microusd: number;
  ms: { total: number; p50: number | null; p95: number | null; max: number | null };
  by: { [purposeAndModel: string]: { calls: number; errors: number; input_tokens: number; cache_read_tokens: number; output_tokens: number; cost_microusd: number; ms: number } };
  /** Errors by kind (the provider's error class or the first words of its message). */
  error_kinds: { [kind: string]: number };
}

const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]! : null);

/** The recorder of one fork's calls: wraps each adapter the fork's seat uses, appends a line a call to `file`. */
export function callRecorder(file: string, who: { seed: number; arm: string; seat: string }) {
  const earlier = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return undefined; } }).filter(Boolean) : [];
  const attempt = 1 + Math.max(0, ...earlier.map((x: any) => Number(x.attempt) || 0));
  const earlierMicroUsd = earlier.reduce((a: number, x: any) => a + (Number(x.cost_microusd) || 0), 0);
  const st: CallStats = { attempt, calls: 0, errors: 0, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, cost_microusd: 0, earlier_microusd: earlierMicroUsd, ms: { total: 0, p50: null, p95: null, max: null }, by: {}, error_kinds: {} };
  const times: number[] = [];
  const wrap = (a: LlmAdapter, named: string): LlmAdapter => ({
    provider: a.provider, model: a.model,
    complete: async (req) => {
      const t0 = performance.now();
      const line: any = { attempt, seed: who.seed, arm: who.arm, seat: who.seat, subject: req.subject, purpose: req.purpose, model: named, at: new Date().toISOString() };
      const k = `${req.purpose} ${named}`;
      const b = (st.by[k] ??= { calls: 0, errors: 0, input_tokens: 0, cache_read_tokens: 0, output_tokens: 0, cost_microusd: 0, ms: 0 });
      try {
        const r = await a.complete(req);
        const ms = Math.round(performance.now() - t0);
        const u = r.usage;
        const cost = Math.max(costMicroUsd(priceOf(named), u) ?? 0, Math.ceil(u.reported_cost_microusd ?? 0));
        Object.assign(line, { input_tokens: u.input_tokens, cache_read_tokens: u.cache_read_tokens ?? 0, cache_write_tokens: u.cache_write_tokens ?? 0, output_tokens: u.output_tokens, cost_microusd: cost, ms, ...(r.estimated ? { estimated: true } : {}) });
        st.calls++; b.calls++; times.push(ms); st.ms.total += ms; b.ms += ms;
        st.input_tokens += u.input_tokens; st.cache_read_tokens += u.cache_read_tokens ?? 0; st.cache_write_tokens += u.cache_write_tokens ?? 0; st.output_tokens += u.output_tokens; st.cost_microusd += cost;
        b.input_tokens += u.input_tokens; b.cache_read_tokens += u.cache_read_tokens ?? 0; b.output_tokens += u.output_tokens; b.cost_microusd += cost;
        return r;
      } catch (e) {
        const ms = Math.round(performance.now() - t0);
        const kind = (e as Error)?.name && (e as Error).name !== "Error" ? (e as Error).name : String((e as Error)?.message ?? e).split(/[:(]/)[0]!.slice(0, 60);
        Object.assign(line, { ms, error: String((e as Error)?.message ?? e).slice(0, 500), error_kind: kind, cost_microusd: 0 });
        st.errors++; b.errors++; st.error_kinds[kind] = (st.error_kinds[kind] ?? 0) + 1; st.ms.total += ms;
        throw e;
      } finally {
        try { appendFileSync(file, JSON.stringify(line) + "\n"); } catch { /* the record is not the run */ }
      }
    },
  });
  const summary = (): CallStats => ({ ...st, ms: { total: st.ms.total, p50: quantile(times, 0.5), p95: quantile(times, 0.95), max: times.length ? Math.max(...times) : null } });
  return { wrap, summary, attempt, earlierMicroUsd };
}
