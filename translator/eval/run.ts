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
      treasury: { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: 10_000_000 }] },
      who: { kind: "directory", entities: [{ entity: "city", kind: "town", name: "Millbrook" }, { entity: "bank", kind: "bank", name: "Millbrook Bank" }, { entity: "builder", kind: "firm", name: "Millbrook Builders" }, { entity: "greenco", kind: "firm", name: "GreenCo" }, { entity: "c0042", kind: "person", name: "Dana Reyes", participant: "c0042-self" }],
        positions: [{ position: "planning", entity: "city", role: "planning_officer", holder: "planning-system" }, { position: "mayor", entity: "city", role: "mayor", holder: "mayor-system" }] },
      mine: { kind: "records", records: [
        rec({ id: "form-permit", record: "statement", author: "planning-system", in_position: "planning", speaks_for: "city", kind: "form", text: "Permit application.",
          data: { form: "permit_application", submit_as: "permit_application", submit_to: ["city"], fields: { lot: { type: "lot", required: true }, structure_type: { type: "structure_type", required: true }, notes: { type: "text" } } } }),
      ] },
    },
  } as any);
  return k;
}

export interface CaseResult { id: string; held_out: boolean; pass: boolean; got?: string; expect: string[]; error?: string }
export interface EvalReport { model: string; results: CaseResult[]; seen: { passed: number; of: number }; held_out: { passed: number; of: number }; cost_microusd: number }

const canonical = (program: string) => {
  try {
    return calls.programText(calls.parseProgram(program));
  } catch {
    return program;
  }
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
      const acts = got !== undefined ? actsOf(got) : undefined;
      const pass = got !== undefined && (expect.includes(canonical(got)) || (acts !== undefined && c.expect.some((e) => actsOf(e) === acts)));
      results.push({ id: c.id, held_out: !!c.held_out, pass, ...(got !== undefined ? { got } : {}), expect });
    } catch (e) {
      results.push({ id: c.id, held_out: !!c.held_out, pass: false, expect, error: String((e as Error).message).slice(0, 300) });
      if ((e as Error).constructor?.name === "SpendingLimitReached") break; // out of budget: report what ran
    }
  }
  const tally = (h: boolean) => ({ passed: results.filter((r) => r.held_out === h && r.pass).length, of: results.filter((r) => r.held_out === h).length });
  return { model: `${adapter.provider}/${adapter.model}`, results, seen: tally(false), held_out: tally(true), cost_microusd: cost };
}

export function reportText(r: EvalReport): string {
  const lines = [`Translator test set on ${r.model}: seen ${r.seen.passed}/${r.seen.of}, held out ${r.held_out.passed}/${r.held_out.of}. Cost $${(r.cost_microusd / 1e6).toFixed(4)}.`];
  for (const x of r.results.filter((x) => !x.pass)) lines.push(`- ${x.id}${x.held_out ? " (held out)" : ""}: got ${x.got ?? `(error: ${x.error})`}; expected ${x.expect.join(" | ")}`);
  return lines.join("\n");
}
