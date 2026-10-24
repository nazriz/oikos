// `oikos translator-data`: training data for the local translation model, from runs' logs (translator/train/data.ts
// has the method; docs/design/translator-and-resolver.md §16.4 the plan).
//
//   gold programs from the calls code participants wrote in the logs given (and from the seen test cases), with
//   generated ones (translator/train/synthetic.ts) so that every function of the call language has its floor;
//   requests for them written by the models given (`--model`, more than one: no single writer's voice), half of them
//   in the voices the pilots' model seats wrote in, and half of the letters asked for indirectly, as seats ask
//   ("Direct them to …": data.ts `DEAL`, `marked`);
//   a part can be weighted toward what seats really ask (pilot-style.md: reading a third, a direction to another
//   office a sixth, …): requests for some functions only (`only`), more of the letters indirect (`indirect`), the
//   refusals of some labels only (`refusalLabels`). A gold set left to itself has one function in twenty a letter;
//   each kept only if it carries its program's literals exactly and reads as a person's request, and, with
//   `--back-model` (one or more), if a model that didn't write it translates it back to a program that means the same,
//   through the translator as runs use it.
//
// Where no model can be reached through an adapter, the requests are written by file: `briefsOnly` writes the plan and
// its briefs (what a model would have been sent, item by item), a writer hands back a file of requests, and
// `writtenData` checks them and builds the same examples (data.ts `planOf`, `fromWritten`).
//
// The examples are also written split into training and validation, by gold program and by form.
// Every model call's tokens are counted in the manifest written with the data. The held-out test cases are never
// read for this; if this machine has them, the finished data is checked against them and refused on any shared wording.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls, type Currency } from "@oikos/participants";
import { callModel, PRICES, type Budget, type LlmAdapter, type LlmIO, type Price, type Usage } from "@oikos/participants/llm";
import { createTranslator, Knowledge } from "@oikos/translator";
import { loadHeldOut, TEST_CURRENCY } from "@oikos/translator/eval";
import { CASES } from "../../translator/eval/cases";
import { blindRequests, checkAnswers, type BlindAnswer, type BlindReport } from "../../translator/train/blind";
import { ASKERS, BROAD_DEAL, PAPER_ASKERS, CLOSE, DATA_VERSION, OPEN, inOnly, fromWritten, functionOf, generate, goldFromCases, goldFromLog, knowing, planOf, refusalWriterSystem, sampler, shuffled, split, surfaceVariant, writerSystem, type Back, type Example, type Gold, type Manifest, type PlanItem, type Reject, type WrittenRequest } from "../../translator/train/data";
import { amountForms, everyCurrency, LATE_TAGS, lateKinds, payments, piled, synthetic, worldForms, type LateKind } from "../../translator/train/synthetic";
import { logsIn } from "./corpus";
import { logLines, runOf } from "./logs";

/**
 * The kinds of program a part can be made of by name beside a function (`only`; data.ts `Gold.tag`, synthetic.ts), each
 * with the function whose generated programs it is drawn among: so `only: ["hold", "entry"]` with `generated: 3000`
 * draws 3,000 statements and writes requests for the holds and the entries among them (about one in ten each).
 */
/** Kinds of program by name that are added to the gold set by an option of their own (`bankPayments`,
 * `financePayments`), as the forms of several amounts are: `only` takes them. */
const ADDED = ["per_request", "finance_payment", ...Object.values(LATE_TAGS)];

export const TAGS: { [tag: string]: string } = {
  hold: "statement", entry: "statement", standing_work_hold: "statement", standing_work_withdraw: "statement",
  standing_work: "work", direction: "form", paper: "form", direction_unlisted: "message", world_form: "form",
};

/** A model to use, with its price and spending limit (models.ts, chooseModel). */
export interface Model { adapter: LlmAdapter; prices?: Record<string, Price>; budget?: Budget }

export interface TrainingDataOptions {
  /** Logs, or folders of them. */
  sources: string[];
  /** The models that write the requests (none needed with `briefsOnly`). */
  writers?: Model[];
  /** No model: write the plan (`plan.json`), its briefs (`briefs.jsonl`) and the writers' instructions into `out`,
   * for writers who work on files; their requests are taken in by `writtenData`. The plan is the one a run with
   * models would follow for the same options and as many writers. */
  briefsOnly?: boolean;
  /** With `briefsOnly`: who is to write, by name, the plan's items dealt to them in turn (`briefs-<name>.jsonl` each). */
  briefsFor?: string[];
  /** With `briefsOnly`: leave the spare refusals (the later rounds', used only where a label comes out short of its
   * floor) out of the briefs files. They stay in the plan, and one that is wanted and wasn't written is counted. */
  noSpares?: boolean;
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
  /** Only this part of the gold set (0-based `index` of `of` parts, the same cut every time): for doing a long job in
   * parts, each written out as it finishes. */
  shard?: { index: number; of: number };
  /** At least so many gold programs of every function, made up from generated ones where the logs fall short
   * (`balancedGold`; default 300). 0: the logs' and the seen cases' programs only, as before 2026-10-06. */
  floor?: number;
  /** At least so many generated programs of every function, however many the logs hold (default 100). */
  generated?: number;
  /** At most so many programs of a function from logs (a seeded sample of them); absent: all. */
  ceiling?: number;
  /** At least so many refusals of every label (generate's `refusalFloor`); absent: no floor. */
  refusalFloor?: number;
  /** The share of the letters asked for indirectly, the writer inventing and marking what is asked of whoever they
   * go to (data.ts `planOf`; a half if absent, 0 for none). */
  indirect?: number;
  /** Requests are written only for the gold programs whose first call is one of these functions (`none`: for no
   * program at all, so only refusal briefs are planned). The refusal briefs are still made from the whole gold set
   * (or part). With it, `generated` and `limit` count these functions' programs only: `only: ["message"]` with
   * `generated: 1500` is a gold set as ever with 1,500 generated letters in it. */
  only?: string[];
  /** Refusal briefs are planned for these labels only, and only they are built and held to the floor. */
  refusalLabels?: string[];
  /** So many forms of several amounts are invented and added to the gold set, each filled in four ways
   * (synthetic.ts `amountForms`; none if absent). `only: ["amount_form"]` writes requests for them alone. */
  amountForms?: number;
  /** The share of forms filled in and of withdrawals asked for with a second act in the same request (a direction to
   * someone about it, or a second withdrawal: data.ts `pairOf`; none if absent), and whether requests are written
   * for those alone. */
  pairs?: number;
  pairsOnly?: boolean;
  /** A wide part (data.ts `PlanOptions.broad`, `BROAD_DEAL`): the registers dealt beside the styles, who is asking
   * said in every brief, and the wide kinds of refusal brief. */
  broad?: boolean;
  /** The styles dealt, in turn, in place of the deal (data.ts `STYLES`, `REGISTERS`, `OWN`): `["own"]` for a part
   * written by simple writers in no style at all. */
  styles?: string[];
  /** Every paper the worlds' own offices issue is added to the gold set, each filled in so many ways, every field of
   * it in the first two (synthetic.ts `worldForms`; none if absent). `only: ["world_form"]` writes requests for them alone. */
  worldForms?: number;
  /** Only these papers (by form name), and how many ways for some of them (`name=N`): the others are left out of the gold set (still shown beside). */
  worldFormsOnly?: string[];
  worldFormsMore?: { [form: string]: number };
  /** So many payments that carry out a request to pay (a bank's, out of an account it keeps: `per_request`), and so
   * many of a finance office's kinds (a net wage with the gross and what was withheld said, what was withheld
   * remitted, a payment resting on several records, a standing payment with its first day), are added to the gold
   * set (synthetic.ts `payments`; none if absent). `only: ["per_request"]`, `only: ["finance_payment"]` write
   * requests for them alone. */
  bankPayments?: number;
  financePayments?: number;
  /** So many programs of each kind the call language gained after the data was first made (synthetic.ts `lateKinds`,
   * prompt 0.9.5; none if absent): payments drawn on a line of the budget (`line_payment`), payments with a report
   * naming several amounts (`report_amounts`), one sum paid to several accounts (`split_payment`: the refusals that
   * state no share are made from these, data.ts `refusalBriefs`), offers of employment with and without hours
   * (`hours_term`), a notice of a practice (`practice_notice`) and an offer anyone may take up (`offer_notice`).
   * `only` takes them by those names. */
  late?: { [kind in LateKind]?: number };
  /** A wide part weighted toward some askers: the share of its requests each makes (data.ts `PlanOptions.askers`). */
  askers?: { [asker: string]: number };
  /** A part weighted toward some worlds' money: how many times over each of these currencies, by its code, stands
   * among those the generated programs' money is drawn from (1 if not named; synthetic.ts `everyCurrency`). */
  money?: { [code: string]: number };
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
export async function balancedGold(sources: string[], o: { perShape?: number; seed?: number; floor?: number; generated?: number; ceiling?: number; refusalFloor?: number; /** `generated` is for these functions only (the others get what they get without it). */ only?: string[]; /** A wide part's draws (synthetic.ts `wide`). */ broad?: boolean; /** The money generated programs are drawn in (all the worlds', if absent). */ currencies?: Currency[] } = {}): Promise<{ gold: Gold[]; report: GoldReport }> {
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
    const need = Math.max(floor - (have[fn] ?? 0), (!o.only || o.only.includes(fn) || o.only.some((k) => TAGS[k] === fn) ? o.generated : undefined) ?? 100, 0);
    if (floor > 0 && need > 0) for (const g of synthetic({ only: [fn], perFunction: need, seed, dropped, ...(o.broad ? { wide: true } : {}), ...(o.currencies ? { currencies: o.currencies } : {}) })) add(g);
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

export async function trainingData(o: TrainingDataOptions): Promise<{ examples: number; out: string; stopped?: string; /** With `briefsOnly`: how many briefs were written. */ briefs?: number }> {
  const log = o.log ?? (() => {});
  const writers = o.writers ?? [];
  if (!o.briefsOnly && !writers.length) throw new Error("no model to write the requests: give one, or ask for the briefs only");
  // (A model with no recorded price is refused before anything is asked of any of them.)
  const checkers = [...(o.backs ?? []), ...(o.back ? [o.back] : [])];
  for (const m of o.briefsOnly ? [] : [...writers, ...checkers]) {
    const key = `${m.adapter.provider}/${m.adapter.model}`;
    if (!(m.prices ?? PRICES)[key]) throw new Error(`no price recorded for ${key}: add it to the price table before using this model`);
  }
  for (const fn of o.only ?? []) if (fn !== "none" && fn !== "amount_form" && fn !== "world_form" && !ADDED.includes(fn) && !TAGS[fn] && !calls.ARGS[fn as calls.Fn]) throw new Error(`only: no function ${fn} in the call language (or "none", for refusals alone; "amount_form", for the forms of several amounts; or a kind of program by name: ${[...Object.keys(TAGS), ...ADDED].join(", ")})`);
  for (const [asker, share] of Object.entries(o.askers ?? {})) if (!ASKERS[asker] || !(share > 0 && share <= 1)) throw new Error(`askers: ${asker}=${share} is not an asker (${Object.keys(ASKERS).join(", ")}) with a share above 0 and at most 1`);
  if (Object.values(o.askers ?? {}).reduce((a, b) => a + b, 0) > 1) throw new Error("askers: the shares come to more than 1");
  if (o.askers && !o.broad) throw new Error("askers: only a wide part says who is asking (broad)");
  // (Money weighted by code: a currency named N times over is drawn N times as often; one not named, as ever.)
  for (const [code, times] of Object.entries(o.money ?? {})) if (!everyCurrency().some((c) => c.code === code) || !(Number.isInteger(times) && times >= 1)) throw new Error(`money: ${code}=${times} is not the code of a currency the generated programs are drawn in (${[...new Set(everyCurrency().map((c) => c.code))].join(", ")}) with a whole number of times`);
  const currencies = o.money ? everyCurrency().flatMap((c) => Array.from({ length: o.money![c.code] ?? 1 }, () => c)) : undefined;
  const drawn = currencies ? { currencies } : {};
  if (o.pairs !== undefined && !(o.pairs >= 0 && o.pairs <= 1)) throw new Error(`pairs: a share from 0 to 1, got ${o.pairs}`);
  for (const l of o.refusalLabels ?? []) if (!(calls.TRANSLATOR_LABELS as readonly string[]).includes(l)) throw new Error(`refusal labels: no label ${l} (they are: ${calls.TRANSLATOR_LABELS.join(", ")})`);
  if (o.indirect !== undefined && !(o.indirect >= 0 && o.indirect <= 1)) throw new Error(`indirect: a share from 0 to 1, got ${o.indirect}`);
  const wanted = (g: Gold) => inOnly(g, o.only);
  const balanced = (o.floor ?? 300) > 0 ? await balancedGold(o.sources, { ...o, ...drawn }) : undefined;
  let gold = balanced?.gold ?? (await goldOf(o.sources, o));
  // Forms of several amounts, where asked for: beside the gold set's own forms (they are forms like any other to a
  // part of the set, a split and a refusal built from one).
  if (o.amountForms) gold = [...gold, ...amountForms({ forms: o.amountForms, seed: o.seed ?? 1, ...drawn })];
  if (o.worldForms) gold = [...gold, ...worldForms({ perForm: o.worldForms, seed: o.seed ?? 1, askers: PAPER_ASKERS, ...(o.worldFormsOnly ? { only: o.worldFormsOnly } : {}), ...(o.worldFormsMore ? { perFormOf: o.worldFormsMore } : {}), ...drawn })];
  if (o.bankPayments) gold = [...gold, ...payments({ kind: "per_request", n: o.bankPayments, seed: o.seed ?? 1, ...drawn })];
  if (o.financePayments) gold = [...gold, ...payments({ kind: "finance", n: o.financePayments, seed: o.seed ?? 1, ...drawn })];
  for (const kind of Object.keys(LATE_TAGS) as LateKind[]) if (o.late?.[kind]) gold = [...gold, ...lateKinds({ kind, n: o.late[kind]!, seed: o.seed ?? 1, ...drawn })];
  log(`${gold.length} gold programs of ${new Set(gold.map((g) => g.shape)).size} shapes`);
  if (o.shard) {
    // One part of several: the same gold set is cut the same way every time (every `of`-th program, counted function
    // by function so each part has every function), so a long job is done part by part, each kept as it finishes,
    // and a part that fails is done again without the others.
    const { index, of } = o.shard;
    if (!(Number.isInteger(index) && Number.isInteger(of) && of > 0 && index >= 0 && index < of)) throw new Error(`shard: expected index 0..of-1, got ${index} of ${of}`);
    const seenOf = new Map<string, number>();
    gold = gold.filter((g) => {
      const n = seenOf.get(functionOf(g)) ?? 0;
      seenOf.set(functionOf(g), n + 1);
      return n % of === index;
    });
    log(`part ${index + 1} of ${of}: ${gold.length} programs`);
  }
  if (o.only) log(`requests for ${gold.filter(wanted).length} of them (${o.only.join(", ")})`);
  if (o.limit && gold.filter(wanted).length > o.limit) {
    // A sample that touches every function: one of each in turn (each function's in a seeded order), until there are enough.
    // (Of the functions requests are written for; the other programs stay, for the refusal briefs to be made from.)
    const rand = sampler(o.seed ?? 1);
    const by = new Map<string, Gold[]>();
    for (const g of gold.filter(wanted)) (by.get(functionOf(g)) ?? by.set(functionOf(g), []).get(functionOf(g))!).push(g);
    const queues = [...by.keys()].sort().map((fn) => shuffled(by.get(fn)!, rand));
    const taken: Gold[] = [];
    for (let i = 0; taken.length < o.limit; i++) {
      const q = queues[i % queues.length]!;
      if (q.length) taken.push(q.shift()!);
    }
    gold = [...taken, ...gold.filter((g) => !wanted(g))];
    log(`writing requests for ${gold.length} of them`);
  }
  // What is asked for of the gold set, whoever writes: the same for a run with models and for the briefs alone.
  // (With a floor under the refusals: related acts for a writer to pile into one message, which is `too_much` as
  // people make it; a third as many as the floor, beside the built ones. Where that label is asked for by name, as
  // many as the floor: a part of several acts in the seats' voice is written, there being no positives to build from.)
  const asked = {
    ...(o.perGold ? { perGold: o.perGold } : {}), ...(o.refusalsPerLabel ? { refusalsPerLabel: o.refusalsPerLabel } : {}),
    ...(o.refusalFloor ? { refusalFloor: o.refusalFloor, piled: piled({ groups: o.refusalLabels?.includes("too_much") ? o.refusalFloor : Math.ceil(o.refusalFloor / 3), seed: o.seed ?? 1 }) } : {}),
    indirect: o.indirect ?? 0.5, ...(o.only ? { only: o.only } : {}), ...(o.refusalLabels ? { refusalLabels: o.refusalLabels } : {}), ...(o.pairs ? { pairs: o.pairs, ...(o.pairsOnly ? { pairsOnly: true } : {}) } : {}), ...(o.broad ? { broad: true, styles: BROAD_DEAL } : {}), ...(o.styles?.length ? { styles: o.styles } : {}), ...(o.askers ? { askers: o.askers } : {}), seed: o.seed ?? 1,
  };
  // What a part was weighted toward, for whoever reads its manifest.
  const weighted = { indirect_share: asked.indirect, ...(o.broad ? { broad: true } : {}), ...(o.worldForms ? { world_forms: o.worldForms } : {}), ...(o.only ? { only: o.only } : {}), ...(o.refusalLabels ? { refusal_labels: o.refusalLabels } : {}), ...(o.amountForms ? { amount_forms: o.amountForms } : {}), ...(o.pairs ? { pairs_share: o.pairs, ...(o.pairsOnly ? { pairs_only: true } : {}) } : {}) };
  if (o.briefsOnly) {
    const names = o.briefsFor?.length ? o.briefsFor : ["writer"];
    if (new Set(names.map(fileName)).size !== names.length) throw new Error(`writers' names must differ: ${names.join(", ")}`);
    const items = planOf(gold, { ...asked, writers: names });
    const plan: Plan = {
      version: DATA_VERSION, seed: o.seed ?? 1, sources: o.sources, ...(o.shard ? { shard: o.shard } : {}),
      options: { ...(o.perShape ? { perShape: o.perShape } : {}), ...(o.perGold ? { perGold: o.perGold } : {}), ...(o.refusalsPerLabel ? { refusalsPerLabel: o.refusalsPerLabel } : {}), ...(o.refusalFloor ? { refusalFloor: o.refusalFloor } : {}), ...(o.limit ? { limit: o.limit } : {}), floor: o.floor ?? 300, ...(o.generated !== undefined ? { generated: o.generated } : {}), ...(o.ceiling !== undefined ? { ceiling: o.ceiling } : {}), indirect: asked.indirect, ...(o.only ? { only: o.only } : {}), ...(o.refusalLabels ? { refusalLabels: o.refusalLabels } : {}), ...(o.amountForms ? { amountForms: o.amountForms } : {}), ...(o.pairs ? { pairs: o.pairs, ...(o.pairsOnly ? { pairsOnly: true } : {}) } : {}), ...(o.broad ? { broad: true } : {}), ...(o.styles?.length ? { styles: o.styles } : {}), ...(o.worldForms ? { worldForms: o.worldForms } : {}), ...(o.bankPayments ? { bankPayments: o.bankPayments } : {}), ...(o.financePayments ? { financePayments: o.financePayments } : {}), ...(o.askers ? { askers: o.askers } : {}), ...(o.money ? { money: o.money } : {}), validation: o.validation ?? 0.15 },
      writers: names, gold_programs: gold.length, ...(balanced ? { gold: balanced.report } : {}), items,
    };
    mkdirSync(o.out, { recursive: true });
    writeFileSync(join(o.out, "plan.json"), JSON.stringify(plan, null, 1) + "\n");
    const line = (t: PlanItem) => JSON.stringify({ id: t.id, kind: t.kind, ...(t.kind === "refusal" && t.round > 0 ? { spare: true } : {}), brief: t.brief });
    const handed = o.noSpares ? items.filter((t) => !(t.kind === "refusal" && t.round > 0)) : items;
    const briefs = (file: string, of: PlanItem[]) => writeFileSync(join(o.out, file), of.map(line).join("\n") + (of.length ? "\n" : ""));
    briefs("briefs.jsonl", handed);
    if (o.briefsFor?.length) for (const name of names) briefs(`briefs-${fileName(name)}.jsonl`, handed.filter((t) => t.writer === name));
    writeFileSync(join(o.out, "writer-instructions.txt"), writerInstructions());
    log(`${handed.length} briefs for ${names.length} writer${names.length === 1 ? "" : "s"}${o.noSpares ? ` (${items.length - handed.length} spare ones left out)` : ""}`);
    return { examples: 0, out: o.out, briefs: handed.length };
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
    writers: writers.map(guarded), ...asked,
    backs: backs.map((b) => b.back), ...(heldOut ? { heldOut } : {}), log,
  });
  for (const b of backs) manifest.usage[`${b.back.model} (translating back)`] = b.usage;
  writeData(o.out, { examples, rejects, manifest }, { validation: o.validation ?? 0.15, seed: o.seed ?? 1 }, { sources: o.sources, gold_programs: gold.length, ...weighted, ...(balanced ? { gold: balanced.report } : {}) }, { checked_against_held_out: !!heldOut, cost_microusd: costMicroUsd });
  return { examples: examples.length, out: o.out, ...(manifest.stopped ? { stopped: manifest.stopped } : {}) };
}

/** A data folder written out: the examples, the rejects, the split, the requests for a blind reader, and the manifest
 * (`before` and `after`: what it says beside the examples' own counts, before and after the split's). */
function writeData(out: string, d: { examples: Example[]; rejects: Reject[]; manifest: Manifest }, o: { validation: number; seed: number }, before: object, after: object): void {
  const lines = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : "");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "examples.jsonl"), lines(d.examples));
  writeFileSync(join(out, "rejects.jsonl"), lines(d.rejects));
  // Training and validation, split by gold program (and by form): written beside the whole, with what went where.
  const parts = o.validation > 0 ? split(d.examples, { validation: o.validation, seed: o.seed }) : undefined;
  if (parts) for (const side of ["train", "validation"] as const) writeFileSync(join(out, `${side}.jsonl`), lines(parts[side]));
  // The requests alone, shuffled, for a reader who is to see nothing else (`translator-data-check`).
  writeFileSync(join(out, "blind.jsonl"), lines(blindRequests(d.examples, o.seed)));
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ ...d.manifest, ...before, ...(parts ? { split: { validation_share: o.validation, train: parts.train.length, validation: parts.validation.length, by_function: parts.report } } : {}), seed: o.seed, ...after }, null, 2) + "\n");
}

/** A writer's name as part of a file's name. */
const fileName = (writer: string): string => writer.replace(/[^A-Za-z0-9._-]+/g, "-");

/**
 * What `briefsOnly` writes as `plan.json`: everything needed to make the examples once the requests are in, with
 * nothing computed again. `items`: who was asked for what, in the plan's order (data.ts `PlanItem`: a request's gold
 * program with its world's money and forms, its style, riders and the way of saying it chosen; a refusal's label and
 * what it must carry).
 */
export interface Plan {
  /** The pipeline's version when the plan was made (data.ts DATA_VERSION). */
  version: string;
  seed: number;
  sources: string[];
  shard?: { index: number; of: number };
  options: { perShape?: number; perGold?: number; refusalsPerLabel?: number; refusalFloor?: number; limit?: number; floor: number; generated?: number; ceiling?: number; /** The share of the letters asked for indirectly (which ones is in the items). */ indirect?: number; /** The functions requests were planned for, and the refusal labels (all, where absent). */ only?: string[]; refusalLabels?: string[]; /** Forms of several amounts added to the gold set; the share of requests with a second act, and whether those alone. */ amountForms?: number; pairs?: number; pairsOnly?: boolean; /** A wide part; the worlds' own papers added, each filled so many ways. */ broad?: boolean; styles?: string[]; worldForms?: number; /** Payments of a bank's and a finance office's kinds added; askers and money the part was weighted toward. */ bankPayments?: number; financePayments?: number; askers?: { [asker: string]: number }; money?: { [code: string]: number }; validation: number };
  /** Who was asked, in the order the items were dealt (item k to writer k mod n). */
  writers: string[];
  gold_programs: number;
  gold?: GoldReport;
  items: PlanItem[];
}

/** What a writer who works on files is told (`writer-instructions.txt`): which instructions go with which briefs, what
 * to hand back, and the two sets of instructions, word for word what a model is given as its system prompt. */
export function writerInstructions(): string {
  return [
    'Each line of a briefs file is {id, kind, brief}: the brief is what you are given, and you answer it with one request. For a brief of kind "request" follow INSTRUCTIONS FOR REQUESTS below; for a brief of kind "refusal" follow INSTRUCTIONS FOR REFUSALS.',
    'Hand back a file requests.jsonl: one line for each brief, {"id": "<the brief\'s id>", "request": "<your request>"}, each line valid JSON by itself (quotation marks and line breaks inside a request escaped), and nothing else in the file. Write each request from its own brief alone, as if it were the only one you had been given. A brief marked "spare": true is used only if earlier ones of its kind fail a check: write it like any other.',
    `A brief that says its request is "Asked indirectly" has you mark some words of your request with ${OPEN} and ${CLOSE}: hand the request back with the marks in it. No other request has them.`,
    "",
    '=== INSTRUCTIONS FOR REQUESTS (kind: "request") ===',
    writerSystem(),
    "",
    '=== INSTRUCTIONS FOR REFUSALS (kind: "refusal") ===',
    refusalWriterSystem(),
    "",
  ].join("\n");
}

/**
 * `oikos translator-data-write <DIR> --requests FILE --writer NAME [--requests FILE --writer NAME ...]`: the requests
 * writers handed in for a folder's plan (`plan.json`, from a briefs-only run), made into the folder's data. Each file
 * is lines of `{id, request}` (or one JSON list), and may cover any part of the plan; an id written twice keeps the
 * first. Every request gets the mechanical checks a model's gets (data.ts `fromWritten`), and the folder gets what a
 * run with models writes: examples.jsonl (`written_by`: the writer's name), rejects.jsonl, the split if the plan asked
 * for one, blind.jsonl and manifest.json, which also says how many planned items had no request. Nothing is
 * translated back: the blind check (`checkBlind`) is the check of meaning, and it reads this folder as it is.
 */
export async function writtenData(dir: string, files: { file: string; writer: string }[]): Promise<{ examples: number; rejects: number; no_request: number; duplicate_ids: number; unknown_ids: number; out: string }> {
  const plan = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")) as Plan;
  const read = (file: string): WrittenRequest[] => {
    const text = readFileSync(file, "utf8");
    return text.trimStart().startsWith("[") ? (JSON.parse(text) as WrittenRequest[]) : jsonl<WrittenRequest>(file);
  };
  const heldOut = loadHeldOut();
  const r = await fromWritten(plan.items, files.map((f) => ({ writer: f.writer, requests: read(f.file) })), {
    ...(plan.options.refusalsPerLabel ? { refusalsPerLabel: plan.options.refusalsPerLabel } : {}), ...(plan.options.refusalFloor ? { refusalFloor: plan.options.refusalFloor } : {}),
    ...(plan.options.refusalLabels ? { refusalLabels: plan.options.refusalLabels } : {}),
    ...(heldOut ? { heldOut } : {}), seed: plan.seed,
  });
  const weighted = { ...(plan.options.indirect !== undefined ? { indirect_share: plan.options.indirect } : {}), ...(plan.options.broad ? { broad: true } : {}), ...(plan.options.worldForms ? { world_forms: plan.options.worldForms } : {}), ...(plan.options.only ? { only: plan.options.only } : {}), ...(plan.options.refusalLabels ? { refusal_labels: plan.options.refusalLabels } : {}), ...(plan.options.amountForms ? { amount_forms: plan.options.amountForms } : {}), ...(plan.options.pairs ? { pairs_share: plan.options.pairs, ...(plan.options.pairsOnly ? { pairs_only: true } : {}) } : {}) };
  writeData(dir, r, { validation: plan.options.validation, seed: plan.seed }, { sources: plan.sources, gold_programs: plan.gold_programs, ...weighted, ...(plan.gold ? { gold: plan.gold } : {}) },
    { ...(plan.shard ? { shard: plan.shard } : {}), plan_version: plan.version, requests_from: files.map((f) => ({ writer: f.writer, file: f.file })), checked_against_held_out: !!heldOut, cost_microusd: 0 });
  const from = r.manifest.from_files!;
  return { examples: r.examples.length, rejects: r.rejects.length, no_request: from.no_request, duplicate_ids: from.duplicate_ids, unknown_ids: from.unknown_ids, out: dir };
}
