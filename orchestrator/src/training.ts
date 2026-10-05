// `oikos translator-data`: training data for the local translation model, from runs' logs (translator/train/data.ts
// has the method; docs/design/translator-and-resolver.md §16.4 the plan).
//
//   gold programs from the calls code participants wrote in the logs given (and from the seen test cases), with
//   generated ones (translator/train/synthetic.ts) so that every function of the call language has its floor;
//   requests for them written by the models given (`--model`, more than one: no single writer's voice);
//   each kept only if it carries its program's literals exactly and reads as a person's request, and, with
//   `--back-model` (one or more), if a model that didn't write it translates it back to a program that means the same,
//   through the translator as runs use it.
//
// The examples are also written split into training and validation, by gold program and by form.
// Every model call's tokens are counted in the manifest written with the data. The held-out test cases are never
// read for this; if this machine has them, the finished data is checked against them and refused on any shared wording.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { callModel, PRICES, type Budget, type LlmAdapter, type LlmIO, type Price, type Usage } from "@oikos/participants/llm";
import { createTranslator, Knowledge } from "@oikos/translator";
import { loadHeldOut, TEST_CURRENCY } from "@oikos/translator/eval";
import { CASES } from "../../translator/eval/cases";
import { blindRequests, checkAnswers, type BlindAnswer, type BlindReport } from "../../translator/train/blind";
import { functionOf, generate, goldFromCases, goldFromLog, knowing, sampler, shuffled, split, surfaceVariant, type Back, type Example, type Gold } from "../../translator/train/data";
import { piled, synthetic } from "../../translator/train/synthetic";
import { logsIn } from "./corpus";
import { logLines, runOf } from "./logs";

/** A model to use, with its price and spending limit (models.ts, chooseModel). */
export interface Model { adapter: LlmAdapter; prices?: Record<string, Price>; budget?: Budget }

export interface TrainingDataOptions {
  /** Logs, or folders of them. */
  sources: string[];
  writers: Model[];
  /** The models that translate requests back (the check). A request is checked by the first of them that isn't the
   * model that wrote it: a model checking its own writing keeps what it parrots and rejects what another would say
   * naturally. So with a checker among the writers, give a second one for that model's requests. (`back`: one, as before.) */
  backs?: Model[];
  back?: Model;
  out: string;
  perShape?: number;
  perGold?: number;
  refusalsPerLabel?: number;
  /** Write requests for at most this many gold programs (a seeded sample, taken function by function in turn, so a
   * trial run touches every function): for a trial run. */
  limit?: number;
  /** At least so many gold programs of every function, made up from generated ones where the logs fall short
   * (`balancedGold`; default 300). 0: the logs' and the seen cases' programs only, as before 2026-10-06. */
  floor?: number;
  /** At least so many generated programs of every function, however many the logs hold (default 100). */
  generated?: number;
  /** At most so many programs of a function from logs (a seeded sample of them); absent: all. */
  ceiling?: number;
  /** At least so many refusals of every label (generate's `refusalFloor`); absent: no floor. */
  refusalFloor?: number;
  /** The share of gold programs whose examples are set aside for validation (default 0.15; 0: no split written). */
  validation?: number;
  seed?: number;
  /** Requests written and checked at a time (4 if absent: a model call is nearly all waiting). */
  concurrency?: number;
  log?: (s: string) => void;
}

/** The gold programs of the logs given, with the seen cases', each also on another surface (data.ts, surfaceVariant). */
export async function goldOf(sources: string[], o: { perShape?: number; seed?: number } = {}): Promise<Gold[]> {
  const rand = sampler((o.seed ?? 1) + 1);
  const gold: Gold[] = [];
  const seen = new Set<string>();
  const add = (g: Gold) => void (seen.has(g.program) || (seen.add(g.program), gold.push(g)));
  for (const src of sources) for (const log of logsIn(src)) {
    for (const g of await goldFromLog(logLines(log), { ...o, source: runOf(log), currency: TEST_CURRENCY })) {
      add(g);
      add(surfaceVariant(g, rand));
    }
  }
  for (const g of goldFromCases(CASES)) add(g);
  return gold;
}

/** What a gold set is made of. */
export interface GoldReport {
  gold: number;
  /** Per function (a program of several lines counts under its first): how many from logs, from the seen cases and
   * generated, and the total. */
  by_function: { [fn: string]: { log: number; case: number; synthetic: number; total: number } };
  /** Per source: each run by name, `cases`, `synthetic`. */
  by_source: { [source: string]: number };
  by_shape: { [shape: string]: number };
  /** Acts in the logs whose call is no gold program, by reason (structured data out of the first model's scope, by
   * function and argument; a keeper's bookkeeping; too long to ask for in a sentence or two). */
  excluded: { [reason: string]: number };
  /** Functions whose log programs were sampled down to the ceiling, with how many there were. */
  capped: { [fn: string]: number };
  /** Generated programs drawn and dropped as no plausible thing to ask for, by reason (data.ts `implausible`); a
   * log's own are in `excluded`, as "implausible: …". */
  implausible: { [reason: string]: number };
  floor: number;
  refusal_floor?: number;
}

/**
 * A gold set with a floor under every function: the logs' programs (each also on another surface) and the seen
 * cases', as `goldOf`, then generated programs (translator/train/synthetic.ts) for every function: as many as bring
 * it up to `floor`, and at least `generated` whatever the logs hold (a town's logs are one world's ids, names and
 * money; the generated ones are many worlds'). `ceiling` samples a function's log programs down. Each program says
 * where it came from (`origin`, `source`), and the report counts them per function, per source and per shape.
 * The floor under each refusal label (`refusalFloor`) is kept when requests are written (generate): refusals aren't
 * programs, so it's only carried in the report here.
 */
export async function balancedGold(sources: string[], o: { perShape?: number; seed?: number; floor?: number; generated?: number; ceiling?: number; refusalFloor?: number } = {}): Promise<{ gold: Gold[]; report: GoldReport }> {
  const seed = o.seed ?? 1;
  const floor = o.floor ?? 300;
  const rand = sampler(seed + 1);
  const excluded: { [reason: string]: number } = {};
  const dropped: { [reason: string]: number } = {};
  const seen = new Set<string>();
  let gold: Gold[] = [];
  const add = (g: Gold) => void (seen.has(g.program) || (seen.add(g.program), gold.push(g)));
  for (const src of sources) for (const log of logsIn(src)) {
    for (const g of await goldFromLog(logLines(log), { ...(o.perShape ? { perShape: o.perShape } : {}), seed, source: runOf(log), currency: TEST_CURRENCY, excluded })) {
      add(g);
      add(surfaceVariant(g, rand));
    }
  }
  // A function with more log programs than the ceiling keeps a seeded sample of them (whole families: a program and
  // its other surface stay or go together).
  const capped: { [fn: string]: number } = {};
  if (o.ceiling !== undefined) {
    const families = new Map<string, Map<string, Gold[]>>();
    for (const g of gold) {
      const f = families.get(functionOf(g)) ?? families.set(functionOf(g), new Map()).get(functionOf(g))!;
      (f.get(g.family ?? g.program) ?? f.set(g.family ?? g.program, []).get(g.family ?? g.program)!).push(g);
    }
    const keep = new Set<Gold>();
    for (const fn of [...families.keys()].sort()) {
      const all = [...families.get(fn)!.values()];
      const n = all.reduce((a, x) => a + x.length, 0);
      if (n > o.ceiling) capped[fn] = n;
      let have = 0;
      for (const fam of n > o.ceiling ? shuffled(all, rand) : all) if (have < o.ceiling) (fam.forEach((g) => keep.add(g)), (have += fam.length));
    }
    gold = gold.filter((g) => keep.has(g));
  }
  for (const g of goldFromCases(CASES)) add(g);
  const have: { [fn: string]: number } = {};
  for (const g of gold) have[functionOf(g)] = (have[functionOf(g)] ?? 0) + 1;
  for (const fn of Object.keys(calls.ARGS)) {
    const need = Math.max(floor - (have[fn] ?? 0), o.generated ?? 100, 0);
    if (floor > 0 && need > 0) for (const g of synthetic({ only: [fn], perFunction: need, seed, dropped })) add(g);
  }
  const report: GoldReport = { gold: gold.length, by_function: {}, by_source: {}, by_shape: {}, excluded: Object.fromEntries(Object.entries(excluded).sort()), capped, implausible: Object.fromEntries(Object.entries(dropped).sort()), floor, ...(o.refusalFloor ? { refusal_floor: o.refusalFloor } : {}) };
  for (const g of gold) {
    const f = (report.by_function[functionOf(g)] ??= { log: 0, case: 0, synthetic: 0, total: 0 });
    f[g.origin ?? "log"]++;
    f.total++;
    const source = g.origin === "case" ? "cases" : g.origin === "synthetic" ? "synthetic" : g.source;
    report.by_source[source] = (report.by_source[source] ?? 0) + 1;
    report.by_shape[g.shape] = (report.by_shape[g.shape] ?? 0) + 1;
  }
  report.by_function = Object.fromEntries(Object.entries(report.by_function).sort());
  report.by_shape = Object.fromEntries(Object.entries(report.by_shape).sort());
  return { gold, report };
}

const jsonl = <T>(file: string): T[] => readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

/**
 * The requests of a data folder for a blind reader, written beside its examples as `blind.jsonl`: each a line of
 * `{id, request, forms}`, in a seeded shuffled order (translator/train/blind.ts), so that where a request stands says
 * nothing of what it is. (Writing the data writes it too; this is for a folder made before, or another order.)
 */
export function writeBlind(dir: string, seed = 1): { requests: number; out: string } {
  const requests = blindRequests(jsonl<Example>(join(dir, "examples.jsonl")), seed);
  const out = join(dir, "blind.jsonl");
  writeFileSync(out, requests.map((e) => JSON.stringify(e)).join("\n") + (requests.length ? "\n" : ""));
  return { requests: requests.length, out };
}

/**
 * `oikos translator-data-check <DIR> --answers FILE [--reader NAME]`: a blind reader's answers against a data folder's
 * examples. `answers`: a file of `{id, program}`, a line each (or one JSON list), written by a reader who saw only the
 * requests and the forms (`blind.jsonl`). Compared by meaning; written beside the examples:
 *   checked.jsonl     the examples the reader agreed on, each marked `verified_by` the reader;
 *   disagreed.jsonl   the ones it answered otherwise, each with both programs (`program`, and the reader's `answer`);
 * and the manifest gains `blind_check`: the reader, the counts, and the counts per function. The examples themselves
 * are left as they were: what is trained on is for whoever reads the disagreements to decide.
 */
export function checkBlind(dir: string, answersFile: string, reader = "blind reader"): BlindReport {
  const examples = jsonl<Example>(join(dir, "examples.jsonl"));
  const text = readFileSync(answersFile, "utf8");
  const answers: BlindAnswer[] = text.trimStart().startsWith("[") ? (JSON.parse(text) as BlindAnswer[]) : jsonl<BlindAnswer>(answersFile);
  const r = checkAnswers(examples, answers, reader);
  const lines = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : "");
  writeFileSync(join(dir, "checked.jsonl"), lines(r.checked));
  writeFileSync(join(dir, "disagreed.jsonl"), lines(r.disagreed));
  const file = join(dir, "manifest.json");
  const manifest = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { [k: string]: unknown }) : {};
  writeFileSync(file, JSON.stringify({ ...manifest, blind_check: r.report }, null, 2) + "\n");
  return r.report;
}

export async function trainingData(o: TrainingDataOptions): Promise<{ examples: number; out: string; stopped?: string }> {
  const log = o.log ?? (() => {});
  // (A model with no recorded price is refused before anything is asked of any of them.)
  const checkers = [...(o.backs ?? []), ...(o.back ? [o.back] : [])];
  for (const m of [...o.writers, ...checkers]) {
    const key = `${m.adapter.provider}/${m.adapter.model}`;
    if (!(m.prices ?? PRICES)[key]) throw new Error(`no price recorded for ${key}: add it to the price table before using this model`);
  }
  const balanced = (o.floor ?? 300) > 0 ? await balancedGold(o.sources, o) : undefined;
  let gold = balanced?.gold ?? (await goldOf(o.sources, o));
  log(`${gold.length} gold programs of ${new Set(gold.map((g) => g.shape)).size} shapes`);
  if (o.limit && gold.length > o.limit) {
    // A sample that touches every function: one of each in turn (each function's in a seeded order), until there are enough.
    const rand = sampler(o.seed ?? 1);
    const by = new Map<string, Gold[]>();
    for (const g of gold) (by.get(functionOf(g)) ?? by.set(functionOf(g), []).get(functionOf(g))!).push(g);
    const queues = [...by.keys()].sort().map((fn) => shuffled(by.get(fn)!, rand));
    const taken: Gold[] = [];
    for (let i = 0; taken.length < o.limit; i++) {
      const q = queues[i % queues.length]!;
      if (q.length) taken.push(q.shift()!);
    }
    gold = taken;
    log(`writing requests for ${gold.length} of them`);
  }
  // Translating back: the translator as runs use it (its prompt, its tool, its parser), on the second model, one
  // attempt (a second attempt is for a seat's sake; here a miss is a miss), knowing nothing of any world but how its
  // money is written (the test town's: the gold programs' amounts are in it).
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
  const backs = checkers.map((m) => {
    const usage: Usage = { input_tokens: 0, output_tokens: 0 };
    const t = createTranslator(io(m, usage), async () => ({ ok: true }), () => undefined, "translator-data", 1);
    let n = 0;
    const back: Back = {
      model: `${m.adapter.provider}/${m.adapter.model}`,
      // (The translator is shown the forms the program's asker knows of, in a world that writes money as theirs does.)
      translate: async (request: string, _forms: string[], g?: Gold) => {
        const r = await t.translate({ draftId: `data.${m.adapter.model}.${++n}`, participant: "someone", proposal: request, knowledge: g?.forms?.length || g?.currency ? knowing(g.forms ?? [], g.currency ?? TEST_CURRENCY) : new Knowledge(TEST_CURRENCY) });
        return r.ok ? r.draft.call : r.call;
      },
    };
    return { back, usage };
  });
  const heldOut = loadHeldOut();
  const { examples, manifest, rejects } = await generate(gold, {
    concurrency: o.concurrency ?? 4,
    writers: o.writers.map(guarded), ...(o.perGold ? { perGold: o.perGold } : {}), ...(o.refusalsPerLabel ? { refusalsPerLabel: o.refusalsPerLabel } : {}),
    // (With a floor under the refusals: related acts for a writer to pile into one message, which is `too_much` as
    // people make it; a third as many as the floor, beside the built ones.)
    ...(o.refusalFloor ? { refusalFloor: o.refusalFloor, piled: piled({ groups: Math.ceil(o.refusalFloor / 3), seed: o.seed ?? 1 }) } : {}),
    backs: backs.map((b) => b.back), ...(heldOut ? { heldOut } : {}), seed: o.seed ?? 1, log,
  });
  for (const b of backs) manifest.usage[`${b.back.model} (translating back)`] = b.usage;
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, "examples.jsonl"), examples.map((e) => JSON.stringify(e)).join("\n") + (examples.length ? "\n" : ""));
  writeFileSync(join(o.out, "rejects.jsonl"), rejects.map((e) => JSON.stringify(e)).join("\n") + (rejects.length ? "\n" : ""));
  // Training and validation, split by gold program (and by form): written beside the whole, with what went where.
  const parts = (o.validation ?? 0.15) > 0 ? split(examples, { validation: o.validation ?? 0.15, seed: o.seed ?? 1 }) : undefined;
  if (parts) for (const side of ["train", "validation"] as const) writeFileSync(join(o.out, `${side}.jsonl`), parts[side].map((e) => JSON.stringify(e)).join("\n") + (parts[side].length ? "\n" : ""));
  // The requests alone, shuffled, for a reader who is to see nothing else (`translator-data-check`).
  writeFileSync(join(o.out, "blind.jsonl"), blindRequests(examples, o.seed ?? 1).map((e) => JSON.stringify(e)).join("\n") + (examples.length ? "\n" : ""));
  writeFileSync(join(o.out, "manifest.json"), JSON.stringify({ ...manifest, sources: o.sources, gold_programs: gold.length, ...(balanced ? { gold: balanced.report } : {}), ...(parts ? { split: { validation_share: o.validation ?? 0.15, train: parts.train.length, validation: parts.validation.length, by_function: parts.report } } : {}), seed: o.seed ?? 1, checked_against_held_out: !!heldOut, cost_microusd: costMicroUsd }, null, 2) + "\n");
  return { examples: examples.length, out: o.out, ...(manifest.stopped ? { stopped: manifest.stopped } : {}) };
}
