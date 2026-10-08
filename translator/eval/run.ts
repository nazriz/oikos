// Run the translator's test set (cases.ts) against a model: each request goes through the real translator path
// (the same prompt, tool and parser), and the call it produces is compared, in canonical form, with the accepted
// answers. Reported separately for seen and held-out cases, with what it cost. The held-out cases come from outside
// the repository (held-out.ts); what's reported of them never includes their wording.

import { calls, canonical as canonicalJson, type Currency } from "@oikos/participants";
import { PRICES, type Budget, type LlmAdapter, type LlmIO, type Price } from "@oikos/participants/llm";
import { createTranslator, Knowledge, LABEL_TEXT, resolve } from "../src/index";
import { translatorSystem } from "../src/index";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { CASES, type Case } from "./cases";
import { leaks } from "./held-out";

export { heldOutPath, leaks, loadHeldOut } from "./held-out";
// The real requests (the pilots' seats, word for word), run and scored by shape: the third group.
export { evaluateReal, passesReal, realKnowledge, realReportText, shapeOf, PILOT_CASES, GAPS, type RealCase, type RealReport, type RealResult } from "./pilot-run";

/** The test town's money: its profile's (the cases' amounts are written in it). */
export const TEST_CURRENCY: Currency = PROFILE.values.currency;

/** What the mayor of the test town knows (the forms and names the translator is shown). */
export function fixture(): Knowledge {
  const k = new Knowledge(TEST_CURRENCY);
  const rec = (r: any) => ({ author: "genesis", at: 0, visible_to: "public", ...r });
  k.absorb({
    participant: "mayor-system", as: "mayor", t: 30 * 86_400, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [],
    channels: {
      // (Its own account, and the accounts it has paid before: a town knows where its builder and its staff are paid.
      // Without them every payment came back "which account?", which the test read as a failed translation.)
      treasury: { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: 10_000_000 },
        { account: "acc-builder", holder: "builder", custodian: "bank", balance: 0 }, { account: "acc-greenco", holder: "greenco", custodian: "bank", balance: 0 }, { account: "acc-c0042", holder: "c0042", custodian: "bank", balance: 0 }] },
      who: { kind: "directory", entities: [{ entity: "city", kind: "town", name: "Millbrook" }, { entity: "bank", kind: "bank", name: "Millbrook Bank" }, { entity: "builder", kind: "firm", name: "Millbrook Builders" }, { entity: "greenco", kind: "firm", name: "GreenCo" }, { entity: "c0042", kind: "person", name: "Dana Reyes", participant: "c0042-self" }],
        positions: [{ position: "planning", entity: "city", role: "planning_officer", holder: "planning-system" }, { position: "works", entity: "city", role: "works_manager", holder: "works-system" }, { position: "mayor", entity: "city", role: "mayor", holder: "mayor-system" }] },
      mine: { kind: "records", records: [
        rec({ id: "form-permit", record: "statement", author: "planning-system", in_position: "planning", speaks_for: "city", kind: "form", text: "Permit application.",
          data: { form: "permit_application", submit_as: "permit_application", submit_to: ["city"], fields: { lot: { type: "lot", required: true }, structure_type: { type: "structure_type", required: true }, notes: { type: "text" } } } }),
        // (The town's own standing payments, as it asked the bank for them: what a hold on one is addressed to.)
        ...["rec.90", "rec.91", "rec.92"].map((id, i) => rec({ id, record: "statement", author: "mayor-system", in_position: "mayor", speaks_for: "city", kind: "request", text: "A standing payment.", addressed_to: ["bank"], visible_to: ["city", "bank"],
          data: { outcome: { money: { from: "acc-city", to: ["acc-builder", "acc-greenco", "acc-c0042"][i], amount: "85000" } }, every: 30 * 86_400 } })),
      ] },
    },
  } as any);
  return k;
}

/** `outcome`: right (the call asked for, or the refusal); no_draft (nothing went ahead: a refusal or a question came back
 * in its place, which costs the participant a rewording and no more); wrong_draft (a draft that isn't what was asked:
 * the one that matters, since only the participant's reading of the preview stands between it and the world). */
export interface CaseResult { id: string; held_out: boolean; pass: boolean; outcome: "right" | "no_draft" | "wrong_draft"; got?: string; expect: string[]; error?: string; raw?: string }
type Tally = { passed: number; of: number; no_draft: number; wrong_draft: number };
/** `held_out_leaks`: held-out cases that share wording with the prompt or a seen case (by id): with any, the held-out
 * figures aren't a held-out result, and the report says so. */
export interface EvalReport { model: string; results: CaseResult[]; seen: Tally; held_out: Tally; cost_microusd: number; held_out_leaks?: { id: string; source: string }[] }

/** What a program is, without what it says: its functions, or its refusal ("money", "statement+message", "none(unclear)"). */
export const shape = (program: string | undefined): string => {
  if (program === undefined) return "(no program)";
  try {
    const p = calls.parseProgram(program) as any;
    return "none" in p ? `none(${p.none})` : p.lines.map((l: any) => l.call.fn).join("+");
  } catch {
    return "(not a program)";
  }
};

/**
 * A report fit to keep in the repository's folders, print or quote: each held-out result by its id, its outcome and
 * the shape of what was wanted and what came back, never the request or the programs (held-out.ts). The full report
 * goes beside the held-out file, for whoever keeps the set.
 */
export function publicReport(r: EvalReport): EvalReport {
  return { ...r, results: r.results.map((x) => (x.held_out ? { id: x.id, held_out: true, pass: x.pass, outcome: x.outcome, got: shape(x.got), expect: [...new Set(x.expect.map(shape))], ...(x.error ? { error: "(an error)" } : {}) } : x)) };
}

/** A program in canonical form, for comparing: a simple value means the same quoted or bare (`task="make"` is
 * `task=make`; `quantity="40"` is `quantity=40`), so neither spelling counts against a translation (added 2026-10-02,
 * applied to every model alike; amounts and durations, with their `$` and spaces, are unaffected). */
export const canonical = (program: string) => {
  let text: string;
  try {
    text = calls.programText(renamed(calls.parseProgram(program)));
  } catch {
    text = program;
  }
  return text.replace(/="([a-z0-9][a-z0-9._\/-]*)"/g, "=$1");
};

/** A program with the names it binds renamed in order (v1, v2, …): what a line calls the thing it makes, for its own
 * later lines, is the writer's choice and no part of the answer (`t = entity(…)` is `trust = entity(…)`). */
function renamed(p: calls.Program): calls.Program {
  if ("none" in p) return p;
  const names = new Map<string, string>();
  const value = (v: calls.Value): calls.Value =>
    "var" in v ? { var: names.get(v.var) ?? v.var } : "id" in v && names.has(v.id) ? { id: names.get(v.id)! } : "call" in v ? { call: call(v.call) } : v;
  const call = (c: calls.Call): calls.Call => ({ fn: c.fn, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, value(v)])) });
  // A name no later line uses is no part of the answer either (`park = structure(…)` alone is `structure(…)`).
  const mentions = (v: calls.Value, name: string): boolean => ("var" in v ? v.var === name : "id" in v ? v.id === name : "call" in v ? Object.values(v.call.args).some((x) => mentions(x, name)) : false);
  const usedLater = (name: string, after: number) => p.lines.slice(after + 1).some((l) => Object.values(l.call.args).some((x) => mentions(x, name)));
  return { lines: p.lines.map((l, i) => {
    const c = call(l.call); // (a line can't refer to the name it binds itself)
    if (l.bind && usedLater(l.bind, i)) names.set(l.bind, `v${names.size + 1}`);
    return l.bind && names.has(l.bind) ? { bind: names.get(l.bind)!, call: c } : { call: c };
  }) };
}

/** A program as its writer might equally have written it: names bound in order, none bound that nothing uses. */
export const tidy = (p: calls.Program): calls.Program => renamed(p);

/** What a program comes to: the acts it resolves to for the test mayor (or undefined if it doesn't resolve). */
const actsOf = (program: string): string | undefined => {
  try {
    const r = resolve(calls.parseProgram(program), fixture(), () => undefined, "mayor");
    return r.ok ? canonicalJson(r.blocks) : undefined;
  } catch {
    return undefined;
  }
};

/** Whether an answer passes a case: one of the accepted programs, or the same acts as one. */
export function passes(c: Case, got: string): boolean {
  if (c.ignore?.length) {
    const strip = (p: string) => c.ignore!.reduce((x, k) => x.replace(new RegExp(`(, )?\\b${k}=("(?:[^"\\\\]|\\\\.)*"|[^,)]*)`, "g"), ""), canonical(p)).replace(/\(, /g, "(");
    return c.expect.map(strip).includes(strip(got));
  }
  const acts = actsOf(got);
  return c.expect.map(canonical).includes(canonical(got)) || (acts !== undefined && c.expect.some((e) => actsOf(e) === acts)) || sameRefusal(c, got);
}

/** Where a refusal is wanted: a call that the resolver answers with that same refusal's words comes to the same thing
 * for the participant (a form it doesn't know, written as `form(…)`, comes back "You haven't seen a form by that
 * name" either way). Only the refusal's own words count: any other question isn't the refusal. */
function sameRefusal(c: Case, got: string): boolean {
  try {
    const r = resolve(calls.parseProgram(got), fixture(), () => undefined, "mayor");
    return !r.ok && r.questions.length === 1 && c.expect.some((e) => {
      const p = calls.parseProgram(e);
      return "none" in p && r.questions[0] === LABEL_TEXT[p.none];
    });
  } catch {
    return false;
  }
}

/**
 * Run every case (or those given) through the translator on `adapter`. An answer passes if it's one of the accepted
 * programs, or comes to the same acts as one (`choice="yes"` and `choice=yes`; a form sent to the office or to the
 * town it belongs to): the test is whether the translation does what was asked, not how it's spelled.
 */
export async function evaluate(adapter: LlmAdapter, o: { prices?: Record<string, Price>; budget?: Budget; cases?: Case[]; heldOut?: Case[] } = {}): Promise<EvalReport> {
  let cost = 0;
  const io: LlmIO = {
    adapter, now: () => 0, prices: { ...PRICES, ...(o.prices ?? {}) }, ...(o.budget ? { budget: o.budget } : {}),
    annotate: async (a: any) => void (a.annotation === "usage" && (cost += a.cost_microusd)),
  };
  const t = createTranslator(io, async () => ({ ok: true }), () => undefined, "translator-eval");
  const results: CaseResult[] = [];
  const seenCases = o.cases ?? CASES;
  const heldOut = (o.heldOut ?? []).map((c) => ({ ...c, held_out: true }));
  // The held-out cases against what a prompt's author has in front of them: the prompt itself, and every seen case.
  const leaked = heldOut.length ? leaks(heldOut, [{ name: "the translator's prompt", text: translatorSystem() }, { name: "the seen cases", text: seenCases.map((c) => c.request).join("\n") }]) : [];
  for (const c of [...seenCases, ...heldOut]) {
    const expect = c.expect.map(canonical);
    try {
      const r = await t.translate({ draftId: `eval.${c.id}`, participant: "mayor-system", as: "mayor", proposal: c.request, knowledge: fixture() });
      const got = r.ok ? r.draft.call : r.call;
      const pass = got !== undefined && passes(c, got);
      // No program at all: keep what came back instead, to see why.
      const raw = !r.ok && got === undefined ? JSON.stringify(r.raw ?? r.notices).slice(0, 500) : undefined;
      results.push({ id: c.id, held_out: !!c.held_out, pass, outcome: pass ? "right" : r.ok ? "wrong_draft" : "no_draft", ...(got !== undefined ? { got } : {}), expect, ...(raw ? { raw } : {}) });
    } catch (e) {
      results.push({ id: c.id, held_out: !!c.held_out, pass: false, outcome: "no_draft", expect, error: String((e as Error).message).slice(0, 300) });
      if ((e as Error).constructor?.name === "SpendingLimitReached") break; // out of budget: report what ran
    }
  }
  const tally = (h: boolean): Tally => {
    const rs = results.filter((r) => r.held_out === h);
    return { passed: rs.filter((r) => r.pass).length, of: rs.length, no_draft: rs.filter((r) => r.outcome === "no_draft").length, wrong_draft: rs.filter((r) => r.outcome === "wrong_draft").length };
  };
  return { model: `${adapter.provider}/${adapter.model}`, results, seen: tally(false), held_out: tally(true), cost_microusd: cost, ...(leaked.length ? { held_out_leaks: leaked } : {}) };
}

/** The report in words. Held-out failures are listed by id, outcome and shape only (publicReport). */
export function reportText(full: EvalReport): string {
  const r = publicReport(full);
  const part = (t: Tally) => `${t.passed}/${t.of} right, ${t.no_draft} no draft, ${t.wrong_draft} wrong draft${t.wrong_draft === 1 ? "" : "s"}`;
  const lines = [`Translator test set on ${r.model}: seen ${part(r.seen)}; held out ${r.held_out.of ? part(r.held_out) : "not run (this machine doesn't have the held-out cases: translator/eval/held-out.ts)"}. Cost $${(r.cost_microusd / 1e6).toFixed(4)}.`];
  if (r.held_out_leaks?.length) lines.push(`! NOT A HELD-OUT RESULT: ${new Set(r.held_out_leaks.map((l) => l.id)).size} held-out case(s) share wording with ${[...new Set(r.held_out_leaks.map((l) => l.source))].join(" and ")} (${[...new Set(r.held_out_leaks.map((l) => l.id))].join(", ")}). Remove the wording from the prompt, or retire those cases.`);
  for (const x of r.results.filter((x) => !x.pass)) lines.push(x.held_out
    ? `- [${x.outcome}] ${x.id} (held out): got ${x.got}; wanted ${x.expect.join(" | ")}`
    : `- [${x.outcome}] ${x.id}: got ${x.got ?? (x.error ? `(error: ${x.error})` : `(no program: ${x.raw})`)}; expected ${x.expect.join(" | ")}`);
  return lines.join("\n");
}
