// Run the translator's test set (cases.ts) against a model: each request goes through the real translator path
// (the same prompt, tool and parser), and the call it produces is compared, in canonical form, with the accepted
// answers. Reported separately for seen and held-out cases, with what it cost.

import { calls, canonical as canonicalJson } from "@terrarium/participants";
import { PRICES, type Budget, type LlmAdapter, type LlmIO, type Price } from "@terrarium/participants/llm";
import { createTranslator, Knowledge, resolve } from "../src/index";
import { CASES, type Case } from "./cases";

/** What the mayor of the test town knows (the forms and names the translator is shown). */
export function fixture(): Knowledge {
  const k = new Knowledge();
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
export interface EvalReport { model: string; results: CaseResult[]; seen: Tally; held_out: Tally; cost_microusd: number }

/** A program in canonical form, for comparing: a simple value means the same quoted or bare (`task="make"` is
 * `task=make`; `quantity="40"` is `quantity=40`), so neither spelling counts against a translation (added 2026-10-02,
 * applied to every model alike; amounts and durations, with their `$` and spaces, are unaffected). */
export const canonical = (program: string) => {
  let text: string;
  try {
    text = calls.programText(calls.parseProgram(program));
  } catch {
    text = program;
  }
  return text.replace(/="([a-z0-9][a-z0-9._\/-]*)"/g, "=$1");
};

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
  return c.expect.map(canonical).includes(canonical(got)) || (acts !== undefined && c.expect.some((e) => actsOf(e) === acts));
}

/**
 * Run every case (or those given) through the translator on `adapter`. An answer passes if it's one of the accepted
 * programs, or comes to the same acts as one (`choice="yes"` and `choice=yes`; a form sent to the office or to the
 * town it belongs to): the test is whether the translation does what was asked, not how it's spelled.
 */
export async function evaluate(adapter: LlmAdapter, o: { prices?: Record<string, Price>; budget?: Budget; cases?: Case[] } = {}): Promise<EvalReport> {
  let cost = 0;
  const io: LlmIO = {
    adapter, now: () => 0, prices: { ...PRICES, ...(o.prices ?? {}) }, ...(o.budget ? { budget: o.budget } : {}),
    annotate: async (a: any) => void (a.annotation === "usage" && (cost += a.cost_microusd)),
  };
  const t = createTranslator(io, async () => ({ ok: true }), () => undefined, "translator-eval");
  const results: CaseResult[] = [];
  for (const c of o.cases ?? CASES) {
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
  return { model: `${adapter.provider}/${adapter.model}`, results, seen: tally(false), held_out: tally(true), cost_microusd: cost };
}

export function reportText(r: EvalReport): string {
  const part = (t: Tally) => `${t.passed}/${t.of} right, ${t.no_draft} no draft, ${t.wrong_draft} wrong draft${t.wrong_draft === 1 ? "" : "s"}`;
  const lines = [`Translator test set on ${r.model}: seen ${part(r.seen)}; held out ${part(r.held_out)}. Cost $${(r.cost_microusd / 1e6).toFixed(4)}.`];
  for (const x of r.results.filter((x) => !x.pass)) lines.push(`- [${x.outcome}] ${x.id}${x.held_out ? " (held out)" : ""}: got ${x.got ?? (x.error ? `(error: ${x.error})` : `(no program: ${x.raw})`)}; expected ${x.expect.join(" | ")}`);
  return lines.join("\n");
}
