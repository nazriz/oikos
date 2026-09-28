// Plain language → call → the participant's own acts → a draft to confirm
// (docs/design/translator-and-resolver.md).
//
//   translator: language → a program in the call language (contracts/calls.md).
//     General, world-agnostic, zero arithmetic. Its only context is the forms
//     the participant knows (a form's fields are the shape its answer must take).
//   resolver:   the call → the participant's own blocks, from what the participant knows.
//   preview:    the blocks → exactly what will happen, in world words, generated
//     mechanically (never by the translator).
// A draft carries the call, the blocks, the preview, the kernel's dry run and
// law warnings; its hash is what the participant confirms, and it goes into the act.
//
// The model is anything behind an LlmAdapter: the mock during development.

import { calls, canonical, DOMAIN_DRAFT, evaluate, hashWithDomain, standingClaims, type Block } from "@terrarium/participants";
import { callModel, refusalText, type LlmIO, type LlmMessage, type ToolSpec } from "@terrarium/participants/llm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Knowledge } from "./knowledge";
import { Preview } from "./preview";
import { LABEL_TEXT, RESOLVER, resolve, type StructureTypeInfo } from "./resolver";

export const TRANSLATOR_VERSION = "0.4.0";

export interface TranslatorId {
  id: string;
  version: string;
  model: string;
}

export interface Draft {
  id: string;
  participant: string;
  /** The position the acts are made in (absent: as itself). */
  as?: string;
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
  participant: string;
  /** The position it acts in (absent: as itself). */
  as?: string;
  proposal: string;
  /** What the participant knows (the resolver and the preview use it; the translator sees only its forms). */
  knowledge: Knowledge;
}

export type Translation = { ok: true; draft: Draft; hash: string } | { ok: false; notices: string[]; call?: string; raw?: unknown; invalid?: string[] };

export type KernelCheck = (participant: string, position: string | undefined, blocks: Block[]) => Promise<{ ok: boolean; refusal?: any; error?: string }>;

const CALLS_MD = readFileSync(join(import.meta.dir, "../../contracts/calls.md"), "utf8");

export const TOOLS: ToolSpec[] = [
  { name: "call", description: "The request, written in the call language.", input_schema: { type: "object", required: ["program"], properties: { program: { type: "string" } } } },
];

/** What each function brings about: the language's own glosses (no world, no platform). */
const GLOSS: { [fn: string]: string } = {
  money: "money moves to someone (once, or every so often)",
  goods: "things you hold (a quantity of a kind) move from where they are to someone, yourself included, at a place; as a commitment, goods delivered (once, or every so often)",
  work: "people at a place do some units of a kind of work there (by: who; on: what it's done to, like a building being built)",
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
  presence: "someone comes into the world from outside, or leaves it",
  birth: "a child is conceived",
  harm: "someone is physically harmed",
  position: "a post in an organisation is created, filled or left empty",
  system: "a system (software, an AI system) is put to work for an organisation, or switched off",
};

/** The translator's instructions: the call language itself, generated from the contract (P12), and nothing about any world. */
export function translatorSystem(): string {
  const syntax = CALLS_MD.slice(CALLS_MD.indexOf("## Syntax"), CALLS_MD.indexOf("## Functions")).trim();
  const fns = Object.entries(calls.ARGS).map(([fn, a]) => `- ${fn}(${a.allowed ? [...a.allowed].map((x) => (a.required.includes(x) ? `${x}*` : x)).join(", ") : [...a.required.map((x) => `${x}*`), "…the form's own fields"].join(", ")}): ${GLOSS[fn] ?? ""}`);
  const examples = CALLS_MD.slice(CALLS_MD.indexOf("## Examples")).trim();
  return [
    "You translate one plain-language request into the call language below. You don't judge it, improve it or complete it: write exactly what was asked, with exactly the inputs given.",
    "- Copy ids exactly as written (lot-00-00, apts-3/dwelling.2, acc-city, rec.412). Copy names, amounts and durations as quoted text, exactly as written; never calculate anything.",
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

/** What the translator is given: the request, and the forms this person knows of (where each goes, and its fields). */
export function translatorContext(req: TranslateRequest): string {
  // Where it goes (the `to` to write): the office it was made in, or its author's organisation. A choice field lists its options.
  const field = ([k, v]: [string, any]) => `${k} (${v.type === "choice" && v.options?.length ? `one of ${v.options.join(" | ")}` : v.type}${v.required ? ", required" : ""})`;
  const forms = req.knowledge.forms.map((f) => `- ${f.data?.form}, to=${f.in_position ?? f.speaks_for ?? f.author}: fields ${Object.entries(f.data?.fields ?? {}).map(field).join(", ")}`);
  return [`Request: ${req.proposal}`, ...(forms.length ? ["", "Forms this person knows of:", ...forms] : [])].join("\n");
}

/**
 * Laws the participant knows of, with a formal "must not" condition, that the blocks appear to breach. Informational (D19).
 * A construct is seen with its footprint (`block.cells`, the cells known to it) and the lot its corner is in (`block.lot`,
 * by the registry as the participant has seen it), since laws speak of lots and cells.
 */
export function lawWarnings(blocks: Block[], k: Knowledge, typeOf: (type: string) => StructureTypeInfo | undefined = () => undefined, as?: string): string[] {
  const claims = standingClaims(k.claims);
  const out: string[] = [];
  for (const law of k.laws.values()) {
    if (k.withdrawn.has(law.id) || law.adico?.deontic !== "must_not") continue;
    blocks.forEach((b, i) => {
      const v = evaluate(law.formal!.condition, { block: lawView(b, k, typeOf), actor: k.actingFor(as), now: k.t }, claims);
      if ("value" in v && v.value) out.push(`${blocks.length > 1 ? `Item ${i + 1}` : "This"} appears to go against ${law.id}: "${law.text.slice(0, 300)}"`);
    });
  }
  return out.slice(0, 32);
}

function lawView(b: Block, k: Knowledge, typeOf: (type: string) => StructureTypeInfo | undefined): Block {
  if (b.block !== "construct" || typeof b.at !== "string") return b;
  const c0 = k.cells.get(b.at);
  const { w, h } = typeOf(b.structure_type)?.footprint ?? { w: 1, h: 1 };
  const cells = c0 ? [...k.cells].filter(([, c]) => c.x >= c0.x && c.x < c0.x + w && c.y >= c0.y && c.y < c0.y + h).map(([id]) => id).sort() : [b.at];
  const lot = [...k.lots].find(([, cs]) => cs.includes(b.at))?.[0];
  return { ...b, cells, ...(lot ? { lot } : {}) };
}

export function draftHash(d: Draft): string {
  return hashWithDomain(DOMAIN_DRAFT, canonical(d));
}

/**
 * The translator. A request it can't turn into a working call (it answers none(...), the call doesn't parse, or the
 * resolver has a question) is tried again, up to `attempts` in all, with what went wrong as feedback in the same
 * exchange; it may still answer none(...) if that's right. Each earlier attempt comes back in `retries` (the run logs
 * them), so what the participant sees is the last attempt's.
 */
export function createTranslator(io: LlmIO, check: KernelCheck, typeOf: (type: string) => StructureTypeInfo | undefined, id = "translator", attempts = 2) {
  const tid: TranslatorId = { id, version: TRANSLATOR_VERSION, model: `${io.adapter.provider}/${io.adapter.model}` };
  const seen = new Set<string>();
  type Failure = Extract<Translation, { ok: false }>;
  /** One answer, resolved and checked. `final`: a failure that another attempt can't help (the world, not the call). */
  async function attempt(req: TranslateRequest, out: { input?: any } | undefined, raw: unknown): Promise<{ ok: true; draft: Draft; hash: string } | (Failure & { final?: boolean })> {
    const text = typeof out?.input?.program === "string" ? out.input.program : undefined;
    if (!text) return { ok: false, notices: [LABEL_TEXT.unclear], raw };
    let program: calls.Program;
    try {
      program = calls.parseProgram(text);
    } catch {
      return { ok: false, notices: [LABEL_TEXT.unclear], call: text };
    }
    const call = calls.programText(program);
    const r = resolve(program, req.knowledge, typeOf, req.as);
    if (!r.ok) return { ok: false, notices: r.questions, call, ...(r.invalid ? { invalid: r.invalid } : {}) };
    const k = await check(req.participant, req.as, r.blocks);
    if (k.error) return { ok: false, notices: [LABEL_TEXT.unclear], call, final: true };
    const warnings = lawWarnings(r.blocks, req.knowledge, typeOf, req.as);
    const draft: Draft = {
      id: req.draftId, participant: req.participant, ...(req.as ? { as: req.as } : {}), proposal: req.proposal.slice(0, 16384), call, resolver: RESOLVER,
      blocks: r.blocks, summary: new Preview(req.knowledge, req.knowledge.actingFor(req.as)).of(r.blocks).slice(0, 16384),
      check: { ok: k.ok, ...(k.refusal ? { refusal: k.refusal } : {}), ...(warnings.length ? { warnings } : {}) },
      translator: tid,
    };
    return { ok: true, draft, hash: draftHash(draft) };
  }
  return {
    id: tid,
    async translate(req: TranslateRequest): Promise<Translation & { retries?: { call?: string; reason: string }[] }> {
      const messages: LlmMessage[] = [{ role: "user", content: translatorContext(req) }];
      const retries: { call?: string; reason: string }[] = [];
      for (let n = 1; ; n++) {
        const res = await callModel(io, {
          purpose: "translator", subject: id, ref: req.draftId, system: translatorSystem(), maxTokens: 1000, tools: TOOLS, messages,
          context: { proposal: req.proposal, participant: req.participant, attempt: n },
        }, seen);
        const out = res.content.find((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use" && b.name === "call");
        const r = await attempt(req, out, res.content);
        if (r.ok || n >= attempts || r.final) {
          const { final: _, ...t } = r as Failure & { final?: boolean };
          return { ...(r.ok ? r : t), ...(retries.length ? { retries } : {}) };
        }
        retries.push({ ...(r.call ? { call: r.call } : {}), reason: r.notices.join(" ") });
        // Feedback in the same exchange: the answer, then what went wrong with it.
        const feedback = `That didn't work: ${r.notices.join(" ")}${r.call ? ` (your call: ${r.call})` : ""}. Read the request again. If it can be written as a call with what's known, write it; if it really can't, answer none(...) again.`;
        messages.push({ role: "assistant", content: res.content });
        messages.push(out ? { role: "user", content: [{ type: "tool_result", tool_use_id: out.id, content: feedback }] } : { role: "user", content: feedback });
      }
    },
  };
}

/** How a draft reads to the participant confirming it. */
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
