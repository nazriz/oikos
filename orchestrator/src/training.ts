// `oikos translator-data`: training data for the local translation model, from runs' logs (translator/train/data.ts
// has the method; docs/design/translator-and-resolver.md §16.4 the plan).
//
//   gold programs from the calls code participants wrote in the logs given (and from the seen test cases);
//   requests for them written by the models given (`--model`, more than one: no single writer's voice);
//   each kept only if it carries its program's literals exactly, and, with `--back-model`, if that model translates
//   it back to the same program through the translator as runs use it.
//
// Every model call's tokens are counted in the manifest written with the data. The held-out test cases are never
// read for this; if this machine has them, the finished data is checked against them and refused on any shared wording.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callModel, PRICES, type Budget, type LlmAdapter, type LlmIO, type Price, type Usage } from "@oikos/participants/llm";
import { createTranslator, Knowledge } from "@oikos/translator";
import { loadHeldOut } from "@oikos/translator/eval";
import { CASES } from "../../translator/eval/cases";
import { generate, goldFromCases, goldFromLog, sampler, surfaceVariant, type Gold } from "../../translator/train/data";
import { logsIn } from "./corpus";
import { logLines, runOf } from "./logs";

/** A model to use, with its price and spending limit (models.ts, chooseModel). */
export interface Model { adapter: LlmAdapter; prices?: Record<string, Price>; budget?: Budget }

export interface TrainingDataOptions {
  /** Logs, or folders of them. */
  sources: string[];
  writers: Model[];
  back?: Model;
  out: string;
  perShape?: number;
  perGold?: number;
  refusalsPerLabel?: number;
  /** Write requests for at most this many gold programs (a seeded sample across shapes): for a trial run. */
  limit?: number;
  seed?: number;
  log?: (s: string) => void;
}

/** The gold programs of the logs given, with the seen cases', each also on another surface (data.ts, surfaceVariant). */
export async function goldOf(sources: string[], o: { perShape?: number; seed?: number } = {}): Promise<Gold[]> {
  const rand = sampler((o.seed ?? 1) + 1);
  const gold: Gold[] = [];
  const seen = new Set<string>();
  const add = (g: Gold) => void (seen.has(g.program) || (seen.add(g.program), gold.push(g)));
  for (const src of sources) for (const log of logsIn(src)) {
    for (const g of await goldFromLog(logLines(log), { ...o, source: runOf(log) })) {
      add(g);
      add(surfaceVariant(g, rand));
    }
  }
  for (const g of goldFromCases(CASES)) add(g);
  return gold;
}

export async function trainingData(o: TrainingDataOptions): Promise<{ examples: number; out: string; stopped?: string }> {
  const log = o.log ?? (() => {});
  // (A model with no recorded price is refused before anything is asked of any of them.)
  for (const m of [...o.writers, ...(o.back ? [o.back] : [])]) {
    const key = `${m.adapter.provider}/${m.adapter.model}`;
    if (!(m.prices ?? PRICES)[key]) throw new Error(`no price recorded for ${key}: add it to the price table before using this model`);
  }
  let gold = await goldOf(o.sources, o);
  log(`${gold.length} gold programs of ${new Set(gold.map((g) => g.shape)).size} shapes`);
  if (o.limit && gold.length > o.limit) {
    // A sample spread across shapes: every k-th in shape order, from a seeded start.
    const step = gold.length / o.limit;
    const start = sampler(o.seed ?? 1)() * step;
    gold = Array.from({ length: o.limit }, (_, i) => gold[Math.floor(start + i * step)]!);
    log(`writing requests for ${gold.length} of them`);
  }
  // Translating back: the translator as runs use it (its prompt, its tool, its parser), on the second model, one
  // attempt (a second attempt is for a seat's sake; here a miss is a miss), knowing nothing of any world.
  // Every call, a writer's included, goes through the same door as a run's (callModel): a model without a recorded
  // price isn't used, a spending limit is kept to, and what was spent is counted.
  let costMicroUsd = 0;
  const io = (m: Model, usage?: Usage): LlmIO => ({
    adapter: m.adapter, now: () => 0, ...(m.prices ? { prices: m.prices } : {}), ...(m.budget ? { budget: m.budget } : {}),
    annotate: async (a: any) => {
      if (a.annotation !== "usage") return;
      costMicroUsd += a.cost_microusd ?? 0;
      if (usage) (usage.input_tokens += a.input_tokens + (a.cache_read_tokens ?? 0)), (usage.output_tokens += a.output_tokens);
    },
  });
  const seenSystems = new Set<string>();
  const guarded = (m: Model): LlmAdapter => ({ provider: m.adapter.provider, model: m.adapter.model, complete: (req) => callModel(io(m), req, seenSystems) });
  const backUsage: Usage = { input_tokens: 0, output_tokens: 0 };
  const back = o.back && (() => {
    const t = createTranslator(io(o.back!, backUsage), async () => ({ ok: true }), () => undefined, "translator-data", 1);
    let n = 0;
    return {
      model: `${o.back!.adapter.provider}/${o.back!.adapter.model}`,
      translate: async (request: string) => {
        const r = await t.translate({ draftId: `data.${++n}`, participant: "someone", proposal: request, knowledge: new Knowledge() });
        return r.ok ? r.draft.call : r.call;
      },
    };
  })();
  const heldOut = loadHeldOut();
  const { examples, manifest } = await generate(gold, {
    writers: o.writers.map(guarded), ...(o.perGold ? { perGold: o.perGold } : {}), ...(o.refusalsPerLabel ? { refusalsPerLabel: o.refusalsPerLabel } : {}),
    ...(back ? { back } : {}), ...(heldOut ? { heldOut } : {}), seed: o.seed ?? 1, log,
  });
  if (back) manifest.usage[`${back.model} (translating back)`] = backUsage;
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, "examples.jsonl"), examples.map((e) => JSON.stringify(e)).join("\n") + (examples.length ? "\n" : ""));
  writeFileSync(join(o.out, "manifest.json"), JSON.stringify({ ...manifest, sources: o.sources, gold_programs: gold.length, seed: o.seed ?? 1, checked_against_held_out: !!heldOut, cost_microusd: costMicroUsd }, null, 2) + "\n");
  return { examples: examples.length, out: o.out, ...(manifest.stopped ? { stopped: manifest.stopped } : {}) };
}
