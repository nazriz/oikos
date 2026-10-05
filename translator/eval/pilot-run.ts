// Run the real requests (pilot-cases.ts) through the translator, exactly as a run would (the same prompt, tool and
// parser; one attempt), and score each answer by its shape.
//
// Why by shape: a real request names ids from the town it was made in, so its answer can't be resolved against the
// test town to see whether it comes to the same acts (run.ts, `passes`). What can be checked without that town:
//   - the answer has the same calls: the same functions with the same argument names, in any order;
//   - every value that names something or states an amount or a duration is the same (an id in quotes or brackets is
//     that id; "$500" is "$500.00" is "50000 cents"; "14 days" is "a fortnight");
//   - free text isn't compared: "…" in the accepted answer is any text, and the case's `ignore` lists arguments that
//     may be there or not;
//   - a refusal is that label, or a call the resolver answers with that label's own words; "none(*)" is any refusal.
// The translator is shown the forms the seat knew, as it was in the run, and nothing else of that town.

import { calls, canonical as canonicalJson, type Currency } from "@oikos/participants";
import { PRICES, type Budget, type LlmAdapter, type LlmIO, type Price } from "@oikos/participants/llm";
import { createTranslator, Knowledge, LABEL_TEXT, resolve } from "../src/index";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { FORMS, PILOT_CASES, type RealCase } from "./pilot-cases";

export { FORMS, GAPS, PILOT_CASES, type RealCase } from "./pilot-cases";

/** The pilots' town's money (the requests' amounts are written in it). */
const CURRENCY: Currency = PROFILE.values.currency;

type Shown = Pick<RealCase, "forms">;
type Compared = Pick<RealCase, "forms" | "ignore">;

/** What the translator and the resolver are given for a real request: the forms its seat knew, and nothing else. */
export function realKnowledge(c: Shown): Knowledge {
  const k = new Knowledge(CURRENCY);
  if (c.forms) k.absorb({ participant: "seat", t: 0, status: "active", entity: "", outcomes: [], inbox: [], drafts: [], channels: { papers: { kind: "records", records: FORMS[c.forms] } } } as any);
  return k;
}

const WILD = "…";
/** A call as it's compared: its function, and each argument's value as what it names or states (or a call in turn). */
interface Sig { fn: string; args: { [key: string]: string | Sig } }

/** An id as the seats write them, in brackets ("[works]"), is that id. */
const unbracketed = (s: string) => s.trim().replace(/^\[([^\[\]]+)\]$/, "$1").trim();
const plain = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/^the /, "").trim();
const lowered = (j: unknown): unknown =>
  typeof j === "string" ? plain(unbracketed(j)) : Array.isArray(j) ? j.map(lowered) : j && typeof j === "object" ? Object.fromEntries(Object.entries(j).map(([k, x]) => [k, lowered(x)])) : j;
const written = (v: Exclude<calls.Value, { call: calls.Call } | { json: unknown }>) => ("id" in v ? v.id : "var" in v ? v.var : v.text);

/** A value as it's compared: what it names or states, not how it's spelled. */
function valueSig(fn: string, key: string, v: calls.Value, c: Compared): string | Sig {
  if ("call" in v) return callSig(v.call, c);
  if ("json" in v) return `json:${canonicalJson(lowered(v.json))}`;
  if (written(v).trim() === WILD) return WILD;
  const s = unbracketed(written(v));
  if (fn === "form" && key === "form") return `form:${formName(s, c)}`;
  try {
    return `amount:${calls.parseAmount(s, CURRENCY)}`;
  } catch {}
  try {
    return `duration:${calls.parseDuration(s)}`;
  } catch {}
  return `text:${plain(s)}`;
}

const known = (c: Shown) => (c.forms ? FORMS[c.forms] : []);

/** A form by its name, however it was named: its own name, its record's id, or the name in ordinary words (as the
 * resolver reads it). One the seat doesn't know stays as written. */
function formName(name: string, c: Shown): string {
  const words = plain(name).replace(/\s+/g, "_");
  const spellings = [name, words, words.replace(/_form$/, "")];
  const f = known(c).find((x) => x.id === name || spellings.includes(x.data?.form));
  return f ? f.data!.form : words;
}

/** Where a form goes when nothing says: with `to` left out the resolver fills it in, so naming it changes nothing. */
function formGoesTo(call: calls.Call, c: Shown): string | undefined {
  const v = call.args.form;
  if (!v || "call" in v || "json" in v) return undefined;
  const name = formName(unbracketed(written(v)), c);
  const f = known(c).find((x) => x.data?.form === name) as any;
  return f ? f.in_position ?? f.speaks_for ?? f.author : undefined;
}

function callSig(call: calls.Call, c: Compared): Sig {
  const goes = call.fn === "form" ? formGoesTo(call, c) : undefined;
  const args = Object.entries(call.args)
    .filter(([k]) => !c.ignore?.includes(k))
    .map(([k, v]) => [k, valueSig(call.fn, k, v, c)] as const)
    .filter(([k, s]) => !(call.fn === "form" && k === "to" && goes !== undefined && s === `text:${plain(goes)}`));
  return { fn: call.fn, args: Object.fromEntries(args) };
}

/** A letter to several is as many letters (`to=["a","b"]` is one to a and one to b): the calls, one per recipient. */
function callsOf(p: { lines: calls.Line[] }): calls.Call[] {
  return p.lines.flatMap((l) => {
    const to = l.call.args.to;
    if (l.call.fn === "message" && to && "json" in to && Array.isArray(to.json) && to.json.every((x) => typeof x === "string"))
      return (to.json as string[]).map((x) => ({ fn: l.call.fn, args: { ...l.call.args, to: { text: x } } }));
    return [l.call];
  });
}

/** Whether an answer's call is the accepted one: the same function and argument names, and each value the same, or
 * any value at all where the accepted answer has "…". */
function agree(want: Sig, got: Sig): boolean {
  const keys = Object.keys(want.args);
  if (want.fn !== got.fn || keys.length !== Object.keys(got.args).length) return false;
  return keys.every((k) => {
    const w = want.args[k]!;
    const g = got.args[k];
    if (g === undefined) return false;
    if (w === WILD) return true;
    return typeof w === "string" || typeof g === "string" ? w === g : agree(w, g);
  });
}

/** The shape of a program: its calls as they're compared, or its refusal; undefined if it isn't a program. */
export function shapeOf(program: string, c: Compared = {}): Sig[] | { none: calls.Label } | undefined {
  let p: calls.Program;
  try {
    p = calls.parseProgram(program);
  } catch {
    return undefined;
  }
  if ("none" in p) return { none: p.none };
  return callsOf(p).map((x) => callSig(x, c));
}

/** Whether an answer to a real request is right (see the top of this file). */
export function passesReal(c: Pick<RealCase, "expect" | "forms" | "ignore">, got: string): boolean {
  const g = shapeOf(got, c);
  if (g === undefined) return false;
  return c.expect.some((e) => {
    if (e === "none(*)") return !Array.isArray(g) || refusalOf(got, c) !== undefined;
    const w = shapeOf(e, c);
    if (w === undefined) return false;
    if (!Array.isArray(w)) return Array.isArray(g) ? refusalOf(got, c) === w.none : g.none === w.none;
    if (!Array.isArray(g) || g.length !== w.length) return false;
    // Each accepted call matched by a different call of the answer, in any order.
    const used = new Set<number>();
    const match = (i: number): boolean => i === w.length || g.some((x, j) => !used.has(j) && agree(w[i]!, x) && (used.add(j), match(i + 1) || (used.delete(j), false)));
    return match(0);
  });
}

/** The refusal a call comes to: the label whose own words, and nothing else, the resolver answers it with (a form the
 * seat doesn't know, written as form(…), comes back "You haven't seen a form by that name" either way). */
function refusalOf(got: string, c: Shown): calls.Label | undefined {
  try {
    const r = resolve(calls.parseProgram(got), realKnowledge(c), () => undefined);
    if (r.ok || r.questions.length !== 1) return undefined;
    return calls.LABELS.find((l) => LABEL_TEXT[l] === r.questions[0]);
  } catch {
    return undefined;
  }
}

/** `outcome`, as run.ts: right; no_draft (a refusal, or nothing usable, came back: the seat is asked to say it again);
 * wrong_draft (a program that isn't what was asked: in a run, a draft the seat would have to catch in the preview). */
export interface RealResult { id: string; pass: boolean; outcome: "right" | "no_draft" | "wrong_draft"; got?: string; expect: string[]; gap?: string; error?: string; raw?: string }
export interface RealReport { model: string; results: RealResult[]; real: { passed: number; of: number; no_draft: number; wrong_draft: number }; cost_microusd: number }

/** Run the real requests (or those given) through the translator on `adapter`, `jobs` at a time. */
export async function evaluateReal(adapter: LlmAdapter, o: { prices?: Record<string, Price>; budget?: Budget; cases?: RealCase[]; jobs?: number; log?: (line: string) => void } = {}): Promise<RealReport> {
  let cost = 0;
  const io: LlmIO = {
    adapter, now: () => 0, prices: { ...PRICES, ...(o.prices ?? {}) }, ...(o.budget ? { budget: o.budget } : {}),
    annotate: async (a: any) => void (a.annotation === "usage" && (cost += a.cost_microusd)),
  };
  // One attempt: what the model writes first is what's scored (a run's second attempt is fed its own town's answers).
  const t = createTranslator(io, async () => ({ ok: true }), () => undefined, "translator-eval", 1);
  const cases = o.cases ?? PILOT_CASES;
  const results: RealResult[] = new Array(cases.length);
  let next = 0;
  let stop = false;
  const one = async (c: RealCase): Promise<RealResult> => {
    const base = { id: c.id, expect: c.expect, ...(c.gap ? { gap: c.gap } : {}) };
    try {
      const r = await t.translate({ draftId: `real.${c.id}`, participant: "seat", proposal: c.request, knowledge: realKnowledge(c) });
      const got = r.ok ? r.draft.call : r.call;
      const pass = got !== undefined && passesReal(c, got);
      const isProgram = got !== undefined && Array.isArray(shapeOf(got, c));
      const raw = got === undefined ? JSON.stringify((r as any).raw ?? (r as any).notices).slice(0, 500) : undefined;
      return { ...base, pass, outcome: pass ? "right" : isProgram ? "wrong_draft" : "no_draft", ...(got !== undefined ? { got } : {}), ...(raw ? { raw } : {}) };
    } catch (e) {
      if ((e as Error).constructor?.name === "SpendingLimitReached") stop = true; // out of budget: report what ran
      return { ...base, pass: false, outcome: "no_draft", error: String((e as Error).message).slice(0, 300) };
    }
  };
  const worker = async () => {
    while (!stop && next < cases.length) {
      const i = next++;
      results[i] = await one(cases[i]!);
      o.log?.(`${results[i]!.outcome.padEnd(11)} ${cases[i]!.id}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.jobs ?? 1, 8)) }, worker));
  const ran = results.filter(Boolean);
  return {
    model: `${adapter.provider}/${adapter.model}`, results: ran, cost_microusd: cost,
    real: { passed: ran.filter((r) => r.pass).length, of: ran.length, no_draft: ran.filter((r) => r.outcome === "no_draft").length, wrong_draft: ran.filter((r) => r.outcome === "wrong_draft").length },
  };
}

const short = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}… [${s.length} characters]` : s);

/** The report in words: the third group, beside the seen and held-out cases. */
export function realReportText(r: RealReport): string {
  const t = r.real;
  const out = [`Real requests (the pilots' seats, word for word) on ${r.model}: ${t.passed}/${t.of} right, ${t.no_draft} no draft, ${t.wrong_draft} wrong draft${t.wrong_draft === 1 ? "" : "s"}. Cost $${(r.cost_microusd / 1e6).toFixed(4)}.`];
  const gaps = r.results.filter((x) => x.gap);
  if (gaps.length) out.push(`  ${gaps.length} of them ask for something the call language can't say (${[...new Set(gaps.map((x) => x.gap!))].map((g) => `${g}: ${gaps.filter((x) => x.gap === g).length}`).join(", ")}; pilot-cases.ts, GAPS).`);
  for (const x of r.results.filter((x) => !x.pass))
    out.push(`- [${x.outcome}] ${x.id}${x.gap ? ` (gap: ${x.gap})` : ""}: got ${x.got !== undefined ? short(x.got) : x.error ? `(error: ${x.error})` : `(no program: ${x.raw})`}; expected ${x.expect.map((e) => short(e, 200)).join(" | ")}`);
  return out.join("\n");
}
