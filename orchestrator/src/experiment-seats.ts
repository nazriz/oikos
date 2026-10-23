// Model stewards in an experiment (docs/experiments.md, "Real models"): the seat factory, the models it may seat, the
// translator arrangement, the framing, and the spending limits per fork, per arm and per experiment.
//
// - **Which models.** A seat is called through a plan the owner already has: `claude-code/<model>` (Claude Code on his
//   Claude plan) or `codex/<model>` (the Codex CLI on his ChatGPT subscription). Never the largest Claude model, never
//   Fable, never gpt-6-astra (refused by name); no paid API key (`anthropic/`, `openai/`) without `allow_paid_api`, which
//   only the owner's go-ahead sets.
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
// - **A dry run.** `mock_models` (or OIKOS_EXPERIMENT_MOCK_MODELS=1): every model is played by the mock (the post's
//   code brain says what to do; participants/src/llm/mock.ts) through the whole loop, priced at the named model's
//   published price so that the limits are exercised. No model is called. The log says the mock answered.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MockAdapter, mockPolicies, PRICES, type FramingSpec, type LlmAdapter, type Price } from "@oikos/participants/llm";
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
  /** A paid API key may be used (`anthropic/`, `openai/`): only with the owner's go-ahead. */
  allow_paid_api?: boolean;
  /** The most calls of one provider in flight at once in a worker process (default 4): a plan's rate, and the machine's
   * memory (each `claude -p` is a process). Only when a fork's calls are made changes; never what the world does. */
  calls_at_once?: number;
}

/** Models that are never seated or used as a translator here, by the owner's word. */
export const NEVER = /astra|fable|opus/i;
/** Providers through a plan the owner has (no key, no bill beyond the plan): the default allowed. */
export const PLAN_PROVIDERS = new Set(["claude-code", "codex"]);
const PAID = new Set(["anthropic", "openai"]);

export const mockModels = (spec: ExperimentSpec) => !!spec.seats?.mock_models || process.env.OIKOS_EXPERIMENT_MOCK_MODELS === "1";

/** The models a spec names (seats and translators) that it may not use: why, for each. */
export function modelProblems(spec: ExperimentSpec): string[] {
  const out: string[] = [];
  const check = (what: string, m: string | undefined, translator = false) => {
    if (!m) return;
    const provider = m.split("/")[0]!;
    if (NEVER.test(m)) out.push(`${what}: ${m} is never used here (the largest Claude model, Fable and gpt-6-astra are not)`);
    if (PAID.has(provider) && !spec.seats?.allow_paid_api) out.push(`${what}: ${m} is a paid API; seats go through a plan (claude-code/, codex/) unless the owner's go-ahead sets seats.allow_paid_api`);
    if (!PLAN_PROVIDERS.has(provider) && !PAID.has(provider) && provider !== "mock" && !(translator && provider === "decide")) out.push(`${what}: provider ${provider} is not one an experiment seats (claude-code, codex${translator ? ", decide for our own translator" : ""})`);
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
    const limit = forkLimits(spec)[arm.name];
    const prices: Record<string, Price> = { ...PRICES, ...priceTable() };
    // (In a dry run the mock plays every model, priced as the model it plays, so the limits bite as they would.)
    const atOnce = spec.seats?.calls_at_once ?? 4;
    const seatAdapter = dry ? mockFor(a.model) : wait(adapterFor(a.model, false, atOnce));
    prices[`${seatAdapter.provider}/${seatAdapter.model}`] = priceOf(a.model);
    const t = spec.seats?.translator;
    const behindName = t?.behind ?? a.model;
    const behind = dry ? mockFor(behindName) : wait(adapterFor(behindName, false, atOnce));
    prices[`${behind.provider}/${behind.model}`] = priceOf(behindName);
    let first: LlmAdapter | undefined;
    if (t?.first) {
      // (Our own translator answers in the dry run too: it calls no model, and a dry run is the arrangement as it will run.)
      first = adapterFor(t.first, true);
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
      ...(a.brain ? { brain: a.brain } : {}), debriefsFile, untilT: spec.untilDay * 86_400,
    });
    seat.start();
    return seat;
  };
  const wait = (x: LlmAdapter) => waitingAdapter(x, { waitMs: 15 * 60_000, maxWaitMs: (spec.seats?.wait_for_window_hours ?? 12) * 3_600_000 });
  return { "claude-code": make, codex: make, ...(spec.seats?.allow_paid_api ? { anthropic: make, openai: make } : {}) };
}

/** The mock in a model's place: named for the model it plays, so the log and the costs say which arm it was. */
function mockFor(model: string): LlmAdapter {
  return new MockAdapter(model.replace(/\//g, "-"), mockPolicies(new Map()));
}
