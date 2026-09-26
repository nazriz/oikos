// Plain language → call → the seat's own acts → a draft to confirm
// (docs/design/translator-and-resolver.md).
//
//   translator: language → a program in the call language (contracts/calls.md).
//     General, world-agnostic, zero arithmetic. Its only context is the forms
//     the seat knows (a form's fields are the shape its answer must take).
//   resolver:   the call → the seat's own blocks, from what the seat knows.
//   preview:    the blocks → exactly what will happen, in world words, generated
//     mechanically (never by the translator).
// A draft carries the call, the blocks, the preview, the kernel's dry run and
// law warnings; its hash is what the seat confirms, and it goes into the act.
//
// The model is anything behind an LlmAdapter: the mock during development.

import { calls, canonical, DOMAIN_DRAFT, evaluate, hashWithDomain, standingClaims, type Block } from "@terrarium/seats";
import { callModel, refusalText, type LlmIO, type ToolSpec } from "@terrarium/seats/llm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Knowledge } from "./knowledge";
import { Preview } from "./preview";
import { LABEL_TEXT, RESOLVER, resolve } from "./resolver";

export const TRANSLATOR_VERSION = "0.3.1";

export interface TranslatorId {
  id: string;
  version: string;
  model: string;
}

export interface Draft {
  id: string;
  seat: string;
  proposal: string;
  call: string;
  resolver: { id: string; version: string };
  blocks: Block[];
  summary: string;
  check: { ok: boolean; refusal?: { code: string; block?: number; detail?: string }; warnings?: string[] };
  caveats?: string;
  translator: TranslatorId;
}

export interface TranslateRequest {
  draftId: string;
  seat: string;
  proposal: string;
  /** What the seat knows (the resolver and the preview use it; the translator sees only its forms). */
  knowledge: Knowledge;
}

export type Translation = { ok: true; draft: Draft; hash: string } | { ok: false; notices: string[]; call?: string; raw?: unknown; invalid?: string[] };

export type KernelCheck = (seat: string, blocks: Block[]) => Promise<{ ok: boolean; refusal?: any; error?: string }>;

const CALLS_MD = readFileSync(join(import.meta.dir, "../../contracts/calls.md"), "utf8");

const TOOLS: ToolSpec[] = [
  { name: "call", description: "The request, written in the call language.", input_schema: { type: "object", required: ["program"], properties: { program: { type: "string" } } } },
];

/** What each function brings about: the language's own glosses (no world, no platform). */
const GLOSS: { [fn: string]: string } = {
  money: "money moves to someone (once, or every so often)",
  account: "an account is opened or closed",
  structure: "a building goes up, or comes down (and who does it)",
  occupancy: "someone moves into or out of a building",
  entity: "a new organisation exists",
  claim: "a right, permission, power or immunity is on record (or passed on, or released)",
  agreement: "an agreement is offered (with what each side commits to), signed, or given notice on",
  statement: "something is published (a notice, a law, a report, …), or withdrawn",
  vote: "a choice is cast on a ballot",
  message: "someone is told something",
  form: "a published form is filled in and handed in",
};

/** The translator's instructions: the call language itself, generated from the contract (P12), and nothing about any world. */
export function translatorSystem(): string {
  const syntax = CALLS_MD.slice(CALLS_MD.indexOf("## Syntax"), CALLS_MD.indexOf("## Functions")).trim();
  const fns = Object.entries(calls.ARGS).map(([fn, a]) => `- ${fn}(${a.allowed ? [...a.allowed].map((x) => (a.required.includes(x) ? `${x}*` : x)).join(", ") : [...a.required.map((x) => `${x}*`), "…the form's own fields"].join(", ")}): ${GLOSS[fn] ?? ""}`);
  const examples = CALLS_MD.slice(CALLS_MD.indexOf("## Examples")).trim();
  return [
    "You translate one plain-language request into the call language below. You don't judge it, improve it or complete it: write exactly what was asked, with exactly the inputs given.",
    "- Copy ids exactly as written (p00-00, acc-city, rec.412). Copy names, amounts and durations as quoted text, exactly as written; never calculate anything.",
    "- If something the request needs isn't there, leave that argument out: whoever resolves the call will ask.",
    "- If the request is someone else's decision, needs a calculation, does too much at once, or isn't clear, answer none(<label>) with the matching label.",
    "- To fill in a form, use form(...) with the form's own field names, listed below the request.",
    "Answer with the call tool, whose program is your answer.",
    "",
    syntax,
    "",
    "## Functions (* = required)",
    ...fns,
    "",
    examples,
  ].join("\n");
}

function context(req: TranslateRequest): string {
  const forms = req.knowledge.forms.map((f) => `- ${f.data?.form} (published by ${f.speaks_for ?? f.author}): fields ${Object.entries(f.data?.fields ?? {}).map(([k, v]: [string, any]) => `${k} (${v.type}${v.required ? ", required" : ""})`).join(", ")}`);
  return [`Request: ${req.proposal}`, ...(forms.length ? ["", "Forms this person knows of:", ...forms] : [])].join("\n");
}

/** Laws the seat knows of, with a formal "must not" condition, that the blocks appear to breach. Informational (D19). */
export function lawWarnings(blocks: Block[], k: Knowledge): string[] {
  const claims = standingClaims(k.claims);
  const out: string[] = [];
  for (const law of k.laws.values()) {
    if (k.withdrawn.has(law.id) || law.adico?.deontic !== "must_not") continue;
    blocks.forEach((b, i) => {
      const v = evaluate(law.formal!.condition, { block: b, actor: k.entity, now: k.t }, claims);
      if ("value" in v && v.value) out.push(`${blocks.length > 1 ? `Item ${i + 1}` : "This"} appears to go against ${law.id}: "${law.text.slice(0, 300)}"`);
    });
  }
  return out.slice(0, 32);
}

export function draftHash(d: Draft): string {
  return hashWithDomain(DOMAIN_DRAFT, canonical(d));
}

export function createTranslator(io: LlmIO, check: KernelCheck, capacity: (type: string) => { [slot: string]: number }, id = "translator") {
  const tid: TranslatorId = { id, version: TRANSLATOR_VERSION, model: `${io.adapter.provider}/${io.adapter.model}` };
  const seen = new Set<string>();
  return {
    id: tid,
    async translate(req: TranslateRequest): Promise<Translation> {
      const res = await callModel(io, {
        purpose: "translator", subject: id, system: translatorSystem(), maxTokens: 1000, tools: TOOLS,
        messages: [{ role: "user", content: context(req) }],
        context: { proposal: req.proposal, seat: req.seat },
      }, seen);
      const out = res.content.find((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use" && b.name === "call");
      const text = typeof out?.input?.program === "string" ? out.input.program : undefined;
      if (!text) return { ok: false, notices: [LABEL_TEXT.unclear], raw: res.content };
      let program: calls.Program;
      try {
        program = calls.parseProgram(text);
      } catch {
        return { ok: false, notices: [LABEL_TEXT.unclear], call: text };
      }
      const call = calls.programText(program);
      const r = resolve(program, req.knowledge, capacity);
      if (!r.ok) return { ok: false, notices: r.questions, call, ...(r.invalid ? { invalid: r.invalid } : {}) };
      const k = await check(req.seat, r.blocks);
      if (k.error) return { ok: false, notices: [LABEL_TEXT.unclear], call };
      const warnings = lawWarnings(r.blocks, req.knowledge);
      const draft: Draft = {
        id: req.draftId, seat: req.seat, proposal: req.proposal.slice(0, 16384), call, resolver: RESOLVER,
        blocks: r.blocks, summary: new Preview(req.knowledge).of(r.blocks).slice(0, 16384),
        check: { ok: k.ok, ...(k.refusal ? { refusal: k.refusal } : {}), ...(warnings.length ? { warnings } : {}) },
        translator: tid,
      };
      return { ok: true, draft, hash: draftHash(draft) };
    },
  };
}

/** How a draft reads to the seat confirming it. */
export function draftText(d: Draft): string {
  return [
    `Before this goes ahead (${d.id}), here is exactly what will happen:`,
    d.summary,
    d.check.ok ? "Nothing stands in the way right now." : `This can't be done right now: ${refusalText(d.check.refusal?.code)}.`,
    ...(d.check.warnings?.length ? [`Legal note: ${d.check.warnings.join(" ")}`] : []),
    "Confirm it, or decline it.",
  ].join("\n");
}

export { Knowledge } from "./knowledge";
export { Preview } from "./preview";
export { LABEL_TEXT, RESOLVER, resolve, type Resolution } from "./resolver";
