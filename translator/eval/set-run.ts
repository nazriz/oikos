// Score a model on a file of labelled requests: a test set the training pipeline made (orchestrator/src/pipeline.ts:
// the requests of pilots marked test-only, and the third of each kind of real request held back from training), or any
// file of examples in that shape. Each request goes through the translator as a run would send it (the same prompt,
// tool and parser; one attempt), with the forms its seat knew, and the answer is compared with the label by meaning,
// as the two readers who settled the label were compared with each other (translator/train/data.ts, `sameProgram`).
//
// Each case is asked and compared in the money of its own world: a line carries its world's currency (the pipeline's
// examples do), amounts in the request and in the answer are read as that world writes them, and a count by currency is
// in the report. A line that names none is read in the test town's and counted (`currency_not_given`).
//
// Reported as the other groups are: right, no draft, wrong draft; and by pilot, seat model, profile, currency, origin
// and function, each where the file's lines say it.
//
// These are not the held-out cases (held-out.ts): a pipeline's test sets are made from pilots' logs on this machine and
// kept in the pipeline's own folder, so their results are reported whole.

import { readFileSync } from "node:fs";
import { calls, type Currency } from "@oikos/participants";
import { PRICES, type Budget, type LlmAdapter, type LlmIO, type Price } from "@oikos/participants/llm";
import { createTranslator, formShown, Knowledge, LABEL_TEXT, resolve } from "../src/index";
import { formOfLine } from "../train/blind";
import { sameProgram, type FormSpec } from "../train/data";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

/** A line of a test-set file: an example as the pipeline's label step writes it, with what the pipeline adds for its
 * tests (`pilot`, `seat_model`, `profile`). Only `id`, `request` and `program` are needed. */
export interface SetCase {
  id: string;
  request: string;
  /** The forms the seat knew, each as the translator is shown one. */
  forms?: string[];
  /** The label: the program two blind readers agreed on. */
  program: string;
  /** The money of the world the request was made in, as that world's config has it. */
  currency?: Currency;
  /** The situation it was asked or written in (`<pilot>/<run>/<seat>/d<day>/<turn>`). */
  source?: string;
  /** `pilot`: the seat's own request; anything else: written in the seat's situation. */
  origin?: string;
  written_by?: string;
  pilot?: string;
  seat_model?: string;
  profile?: string;
}

export function loadSet(file: string): SetCase[] {
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as SetCase);
}

const formsOf = (c: Pick<SetCase, "forms">): FormSpec[] => (c.forms ?? []).map(formOfLine).filter((f): f is FormSpec => !!f);

/** The money a case is read in: its own world's, or (a line that names none) the test town's. */
const currencyOf = (c: Pick<SetCase, "currency">): Currency => c.currency ?? (PROFILE.values.currency as Currency);

/** What the translator and the resolver are given for a case: the forms its seat knew (each a record that is shown
 * exactly as its line in the file), the money of its world, and nothing else of that world. */
export function setKnowledge(c: Pick<SetCase, "forms" | "currency">): Knowledge {
  const k = new Knowledge(currencyOf(c));
  const records = formsOf(c).map((f) => ({ id: f.id ?? f.form, record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: f.to, kind: "form", text: `${f.form.replace(/_/g, " ")}.`, data: { form: f.form, submit_as: f.form, submit_to: [f.to], fields: f.fields } }));
  if (records.length) k.absorb({ participant: "seat", t: 0, status: "active", entity: "", outcomes: [], inbox: [], drafts: [], channels: { papers: { kind: "records", records } } } as any);
  return k;
}

/** The lines the translator would be shown for a case's forms: the same as the file's, or the case is not one the
 * translator can be asked as its seat was (counted, never silently different). */
export const shownAsWritten = (c: Pick<SetCase, "forms" | "currency">): boolean => {
  const shown = setKnowledge(c).forms.map(formShown);
  return shown.length === (c.forms ?? []).length && (c.forms ?? []).every((l) => shown.includes(l));
};

/** The refusal a call comes to: the label whose own words, and nothing else, the resolver answers it with (pilot-run.ts). */
function refusalOf(got: string, c: SetCase): calls.Label | undefined {
  try {
    const r = resolve(calls.parseProgram(got), setKnowledge(c), () => undefined);
    if (r.ok || r.questions.length !== 1) return undefined;
    return calls.LABELS.find((l) => LABEL_TEXT[l] === r.questions[0]);
  } catch {
    return undefined;
  }
}

const parsed = (program: string): calls.Program | undefined => {
  try {
    return calls.parseProgram(program);
  } catch {
    return undefined;
  }
};

/** Whether an answer is the label: the same program by meaning; or, where the label is a refusal, a call the resolver
 * answers with that refusal's own words (the same thing for whoever asked). */
export function passesSet(c: SetCase, got: string): boolean {
  const forms = formsOf(c);
  if (sameProgram(got, c.program, { currency: currencyOf(c), ...(forms.length ? { forms } : {}) })) return true;
  const want = parsed(c.program), g = parsed(got);
  return !!want && "none" in want && !!g && !("none" in g) && refusalOf(got, c) === want.none;
}

export interface Tally { passed: number; of: number; no_draft: number; wrong_draft: number }
export interface SetResult { id: string; pass: boolean; outcome: "right" | "no_draft" | "wrong_draft"; got?: string; expect: string; error?: string; raw?: string }
export interface SetReport {
  model: string;
  /** What the set is called, and the file it is. */
  name: string;
  file?: string;
  results: SetResult[];
  all: Tally;
  /** The same counts by what the lines say of themselves: `pilot`, `seat_model`, `profile`, `currency` (its code),
   * `origin`, `function`; a
   * dimension no line speaks of is absent, and lines that don't say are counted under "(not given)". */
  by: { [dimension: string]: { [value: string]: Tally } };
  /** Cases whose forms could not be shown to the translator as the file has them (run all the same). */
  forms_not_as_written: number;
  /** Cases whose line names no currency: read in the test town's. */
  currency_not_given: number;
  cost_microusd: number;
}

/** What a case says of itself, by dimension. The pilot and the seat model are read from the id of its situation and
 * from who wrote it where the line doesn't name them. */
export function dimensionsOf(c: SetCase): { [dimension: string]: string | undefined } {
  const where = c.source ?? c.id;
  const p = parsed(c.program);
  return {
    pilot: c.pilot ?? (where.includes("/") ? where.split("/")[0] : undefined),
    seat_model: c.seat_model ?? (c.written_by?.endsWith(" (seat)") ? c.written_by.slice(0, -7) : undefined),
    profile: c.profile,
    currency: c.currency?.code,
    origin: c.origin === undefined ? undefined : c.origin === "pilot" ? "the seat's own" : "written in its situation",
    function: !p ? undefined : "none" in p ? `none(${p.none})` : [...new Set(p.lines.map((l) => l.call.fn))].join("+"),
  };
}

const tally = (rs: SetResult[]): Tally => ({ passed: rs.filter((r) => r.pass).length, of: rs.length, no_draft: rs.filter((r) => r.outcome === "no_draft").length, wrong_draft: rs.filter((r) => r.outcome === "wrong_draft").length });

/** Run the cases through the translator on `adapter`, `jobs` at a time. */
export async function evaluateSet(adapter: LlmAdapter, cases: SetCase[], o: { name?: string; file?: string; prices?: Record<string, Price>; budget?: Budget; jobs?: number; log?: (line: string) => void } = {}): Promise<SetReport> {
  let cost = 0;
  const io: LlmIO = {
    adapter, now: () => 0, prices: { ...PRICES, ...(o.prices ?? {}) }, ...(o.budget ? { budget: o.budget } : {}),
    annotate: async (a: any) => void (a.annotation === "usage" && (cost += a.cost_microusd)),
  };
  // One attempt: what the model writes first is what's scored (pilot-run.ts).
  const t = createTranslator(io, async () => ({ ok: true }), () => undefined, "translator-eval", 1);
  const results: SetResult[] = new Array(cases.length);
  let next = 0, stop = false;
  const one = async (c: SetCase, i: number): Promise<SetResult> => {
    const base = { id: c.id, expect: c.program };
    try {
      // (The draft's name ends in no number: a model that remembers whom it last asked back, by the draft's name
      // without its number, must take each case as a different person's.)
      const r = await t.translate({ draftId: `set.${i}.case`, participant: "seat", proposal: c.request, knowledge: setKnowledge(c) });
      const got = r.ok ? r.draft.call : r.call;
      const pass = got !== undefined && passesSet(c, got);
      const p = got !== undefined ? parsed(got) : undefined;
      const raw = got === undefined ? JSON.stringify((r as any).raw ?? (r as any).notices).slice(0, 500) : undefined;
      return { ...base, pass, outcome: pass ? "right" : p && !("none" in p) ? "wrong_draft" : "no_draft", ...(got !== undefined ? { got } : {}), ...(raw ? { raw } : {}) };
    } catch (e) {
      if ((e as Error).constructor?.name === "SpendingLimitReached") stop = true; // out of budget: report what ran
      return { ...base, pass: false, outcome: "no_draft", error: String((e as Error).message).slice(0, 300) };
    }
  };
  const worker = async () => {
    while (!stop && next < cases.length) {
      const i = next++;
      results[i] = await one(cases[i]!, i);
      o.log?.(`${results[i]!.outcome.padEnd(11)} ${cases[i]!.id}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.jobs ?? 1, 8)) }, worker));
  const by: SetReport["by"] = {};
  const dims = cases.map(dimensionsOf);
  for (const d of ["pilot", "seat_model", "profile", "currency", "origin", "function"]) {
    if (!dims.some((x) => x[d] !== undefined)) continue;
    const groups = new Map<string, SetResult[]>();
    results.forEach((r, i) => { if (r) { const v = dims[i]![d] ?? "(not given)"; (groups.get(v) ?? groups.set(v, []).get(v)!).push(r); } });
    by[d] = Object.fromEntries([...groups].sort(([a], [b]) => (a < b ? -1 : 1)).map(([v, rs]) => [v, tally(rs)]));
  }
  const ran = results.filter(Boolean);
  return {
    model: `${adapter.provider}/${adapter.model}`, name: o.name ?? o.file ?? "a test set", ...(o.file ? { file: o.file } : {}),
    results: ran, all: tally(ran), by, forms_not_as_written: cases.filter((c) => !shownAsWritten(c)).length, currency_not_given: cases.filter((c) => !c.currency).length, cost_microusd: cost,
  };
}

const short = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}… [${s.length} characters]` : s);
export const tallyText = (t: Tally) => `${t.passed}/${t.of} right, ${t.no_draft} no draft, ${t.wrong_draft} wrong draft${t.wrong_draft === 1 ? "" : "s"}`;

/** The report in words: the fourth group, beside the seen, held-out and real cases. */
export function setReportText(r: SetReport, o: { failures?: boolean } = {}): string {
  const out = [`Test set "${r.name}" on ${r.model}: ${tallyText(r.all)}. Cost $${(r.cost_microusd / 1e6).toFixed(4)}.`];
  if (r.forms_not_as_written) out.push(`  ! ${r.forms_not_as_written} of them could not be shown their forms as the file has them.`);
  if (r.currency_not_given) out.push(`  ! ${r.currency_not_given} of them name no currency and were read in the test town's.`);
  for (const [d, groups] of Object.entries(r.by)) out.push(`  by ${d.replace("_", " ")}: ${Object.entries(groups).map(([v, t]) => `${v} ${t.passed}/${t.of} (${t.no_draft} no draft, ${t.wrong_draft} wrong)`).join("; ")}`);
  if (o.failures !== false) for (const x of r.results.filter((x) => !x.pass))
    out.push(`- [${x.outcome}] ${x.id}: got ${x.got !== undefined ? short(x.got) : x.error ? `(error: ${x.error})` : `(no program: ${x.raw})`}; expected ${short(x.expect, 200)}`);
  return out.join("\n");
}
