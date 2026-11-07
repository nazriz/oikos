// The scope-request set (scope-requests.jsonl; scope-run.ts says how it was written) through the translator as a pilot
// serves it: our trained model first, the general one behind it (translator/src/arrangement.ts, `then`), each request
// with its situation's forms. Recognised: what the world would be given files `scope_request`; a false positive: a
// request labelled otherwise that is filed as one. Reported by writer, by style and by label, with which side drafted.
// The model behind is called for real: a spending limit is required, and every call's cost is counted.
//
//   OIKOS_TRANSLATOR_MODELS=<models> OIKOS_ANTHROPIC_KEY=... bun translator/eval/scope-served.ts decide/<first> anthropic/claude-sonnet-5-5 --budget 2 [--json FILE] [--jobs 4]
//   (behind `mock`: the runner dry, nothing called)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MockAdapter, mockPolicies, PRICES, type LlmIO } from "@oikos/participants/llm";
import { chooseModel } from "../../orchestrator/src/models";
import { createArrangement } from "../src/arrangement";
import { createTranslator } from "../src/index";
import { formsFiled, SITUATIONS } from "./scope-situations";
import { setKnowledge } from "./set-run";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const jsonOut = flag("json");
const budgetUsd = flag("budget");
const jobs = Math.max(1, Math.min(8, Number(flag("jobs") ?? 4)));
const [firstName, behindName, file = join(import.meta.dir, "scope-requests.jsonl")] = args;
if (!firstName?.startsWith("decide/") || !behindName || budgetUsd === undefined) throw new Error("usage: bun translator/eval/scope-served.ts decide/<first> <provider/behind> --budget USD [scope-requests.jsonl] [--json FILE] [--jobs N]");

interface Case { id: string; writer: string; style: string; situation: string; label: string; level: string | null; request: string }
const cases: Case[] = readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const first = chooseModel(firstName, { first: true });
// ("mock": a dry run of the runner itself, the mock behind, which drafts nothing; no model is called.)
const behind = behindName === "mock" ? { adapter: new MockAdapter("translator", mockPolicies(new Map())), prices: { "mock/translator": { input: 0, output: 0 } }, budget: undefined } : chooseModel(behindName, { budgetUsd: Number(budgetUsd) });
let cost = 0;
const io = (m: typeof first): LlmIO => ({ adapter: m.adapter, now: () => 0, prices: { ...PRICES, ...first.prices, ...behind.prices }, ...(behind.budget ? { budget: behind.budget } : {}), annotate: async (a: any) => void (a.annotation === "usage" && (cost += a.cost_microusd ?? 0)) });
const ok = async () => ({ ok: true });
const t = createArrangement(createTranslator(io(first), ok, () => undefined, "scope-first", 1), createTranslator(io(behind), ok, () => undefined, "scope-behind", 1), { arrangement: "then" });

interface Read { id: string; writer: string; style: string; label: string; scope: boolean; filed: string[]; read_as_scope: boolean; level_asked: string | null; level_read: string | null; used?: string; why?: string; call?: string; error?: string }
const rows: Read[] = new Array(cases.length);
let next = 0, stop = false;
const one = async (c: Case, i: number): Promise<Read> => {
  const base = { id: c.id, writer: c.writer, style: c.style, label: c.label, scope: c.label === "scope", level_asked: c.level };
  try {
    const r: any = await t.translate({ draftId: `scope.${i}.case`, participant: "seat", proposal: c.request, knowledge: setKnowledge({ forms: SITUATIONS[c.situation]! }) });
    const call: string = r.ok ? r.draft.call : (r.call ?? "");
    const filed = formsFiled(call);
    return { ...base, filed, read_as_scope: filed.includes("scope_request"), level_read: /level="?(advice|draft|approve|alone)"?/.exec(call)?.[1] ?? null, used: r.route?.used, why: r.route?.why, call };
  } catch (e) {
    if ((e as Error).constructor?.name === "SpendingLimitReached" || (e as Error).constructor?.name === "CreditExhausted") stop = true;
    return { ...base, filed: [], read_as_scope: false, level_read: null, error: String((e as Error).message).slice(0, 300) };
  }
};
await Promise.all(Array.from({ length: jobs }, async () => {
  while (!stop && next < cases.length) { const i = next++; rows[i] = await one(cases[i]!, i); }
}));
(first.adapter as { close?: () => void }).close?.();
const ran = rows.filter(Boolean);
const tally = (xs: Read[]) => {
  const pos = xs.filter((r) => r.scope), neg = xs.filter((r) => !r.scope);
  return { scope: pos.length, recognised: pos.filter((r) => r.read_as_scope).length, others: neg.length, false_positives: neg.filter((r) => r.read_as_scope).length,
    level_right: pos.filter((r) => r.level_asked && r.read_as_scope && r.level_read === r.level_asked).length, level_stated: pos.filter((r) => r.level_asked).length,
    by_first: pos.filter((r) => r.read_as_scope && r.used === "first").length, errors: xs.filter((r) => r.error).length };
};
const by = (k: "writer" | "style" | "label") => Object.fromEntries([...new Set(ran.map((r) => r[k]))].sort().map((v) => [v, tally(ran.filter((r) => r[k] === v))]));
const instead: { [k: string]: number } = {};
for (const r of ran.filter((r) => r.scope && !r.read_as_scope)) { const k = r.filed[0] ?? (r.call ?? "").split("(")[0] ?? "?"; instead[k || "nothing"] = (instead[k || "nothing"] ?? 0) + 1; }
const summary = { first: firstName, behind: behindName, cases: cases.length, ran: ran.length, cost_usd: Math.round(cost) / 1e6, all: tally(ran), by_style: by("style"), by_writer: by("writer"), by_label: by("label"), scope_read_instead_as: instead };
console.log(JSON.stringify(summary, null, 1));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ...summary, rows: ran }, null, 1));
