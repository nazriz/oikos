// The translator (VISION §6, "Action: plain language, compiled"): it drafts a
// seat's plain-language proposal as kernel blocks, the way a lawyer drafts
// for a politician to sign. It works *for the proposer*: it sees what the
// proposer sees and knows, nothing more.
//
// A draft carries, for the proposer to judge before signing:
//   - the translator's own summary, and a mechanical reading of the blocks
//     (seats/src/llm/render.ts), so a translator can't misdescribe what it drafted;
//   - the kernel's dry run: is it physically possible right now?
//   - warnings: laws with formal conditions the proposer knows of that the
//     blocks appear to breach (informational; the seat decides);
//   - caveats: what the translator couldn't express.
// The draft's hash is what the proposer signs, and it's carried into the act.
//
// The model is anything behind an LlmAdapter; until a real one is used, the
// mock (seats/src/llm/mock.ts).

import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, DOMAIN_DRAFT, evaluate, hashWithDomain, standingClaims, type Block, type Observation, type Record, type StatementRecord } from "@terrarium/seats";
import { callModel, describeBlocks, renderObservation, type LlmIO, type ToolSpec } from "@terrarium/seats/llm";

export const TRANSLATOR_VERSION = "0.1.0";

const CONTRACTS = join(import.meta.dir, "../../contracts");
const SCHEMAS = ["common", "blocks", "records", "world-config", "seat-api", "log"].map((f) => JSON.parse(readFileSync(join(CONTRACTS, `${f}.schema.json`), "utf8")));
const BLOCKS_SCHEMA = SCHEMAS[1];

let validateBlocks: ((x: unknown) => boolean) & { errors?: any } | undefined;
function blocksValidator() {
  if (!validateBlocks) {
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
    for (const s of SCHEMAS) ajv.addSchema(s);
    validateBlocks = ajv.getSchema("urn:terrarium:contracts:0.2:blocks#/$defs/Action/properties/blocks") as any;
  }
  return validateBlocks!;
}

/** The block reference given to the model, generated from the contract so it can never drift from it. */
export function blockReference(): string {
  const defs = BLOCKS_SCHEMA.$defs as { [k: string]: any };
  const lines: string[] = [];
  for (const [name, d] of Object.entries(defs)) {
    if (!d.properties?.block) continue;
    const req = new Set<string>(d.required ?? []);
    const fields = Object.keys(d.properties).filter((f) => f !== "block").map((f) => (req.has(f) ? f : `${f}?`));
    lines.push(`- ${name} {${fields.join(", ")}}: ${d.description ?? ""}`);
  }
  return lines.join("\n");
}

export interface TranslatorId {
  id: string;
  version: string;
  model: string;
}

export interface Draft {
  id: string;
  seat: string;
  proposal: string;
  blocks: Block[];
  summary: string;
  check: { ok: boolean; refusal?: { code: string; block?: number; detail?: string }; warnings?: string[] };
  caveats?: string;
  translator: TranslatorId;
}

export interface TranslateRequest {
  draftId: string;
  seat: string;
  entity: string;
  title?: string;
  proposal: string;
  /** The proposer's latest observation (accounts, survey, what's new). */
  observation: Observation;
  /** Every record the proposer has seen so far. */
  known: Map<string, Record>;
}

export type Translation = { ok: true; draft: Draft; hash: string } | { ok: false; reason: string; raw?: unknown };

export type KernelCheck = (seat: string, blocks: Block[]) => Promise<{ ok: boolean; refusal?: any; error?: string }>;

const TOOLS: ToolSpec[] = [
  { name: "draft", description: "The drafted blocks, with a plain-language summary of exactly what they do.",
    input_schema: { type: "object", required: ["blocks", "summary"], properties: { blocks: { type: "array", items: { type: "object" } }, summary: { type: "string" }, caveats: { type: "string", description: "Parts of the proposal you couldn't express in blocks." } } } },
  { name: "cannot_draft", description: "The proposal can't be expressed in blocks at all, or is too unclear to draft.",
    input_schema: { type: "object", required: ["reason"], properties: { reason: { type: "string" } } } },
];

export function translatorSystem(): string {
  return [
    "You are a drafter in a simulated town used for research (Terrarium). A seat has proposed something in plain language; you write it as the town's formal acts (blocks), exactly and only as proposed, for the seat to sign. You work for the proposer: draft faithfully, even if you disagree, and flag what worries you in caveats.",
    "Rules:",
    "- Use only ids that appear in the context (accounts, parcels, records, entities). Never invent one. Use a block's 'ref' to name something created earlier in the same draft, and refer to it later as \"$ref\".",
    "- The acting seat is bound automatically; don't name it. Physical acts only work for what the proposer's entity can physically do (its own accounts are moved by its bank: to pay, publish an 'instruction' statement addressed to the bank with data {pay, from, to}).",
    "- Money is integer cents. Times are integer seconds (a day is 86400).",
    "- Laws are records and never block anything; if a proposal looks unlawful, draft it anyway and say so in caveats.",
    "- If part of the proposal can't be expressed, draft what can and explain the rest in caveats. If none of it can, use cannot_draft.",
    "",
    "The blocks (contracts v0.2):",
    blockReference(),
  ].join("\n");
}

function context(req: TranslateRequest, capacity: (t: string) => any): string {
  const known = [...req.known.values()];
  const own = standingClaims(known).filter((c) => c.about?.kind === "ownership" && c.holder === req.entity).map((c) => c.about.object);
  const recent = known.slice(-120).map((r) => `[${r.id}] ${r.record}${r.record === "statement" ? `/${r.kind}` : ""}${r.speaks_for ? ` for ${r.speaks_for}` : ""}`);
  return [
    `Proposer: ${req.title ?? req.seat} (seat ${req.seat}), acting for ${req.entity}.`,
    `Proposal: "${req.proposal}"`,
    "",
    "What the proposer currently sees:",
    renderObservation({ ...req.observation, drafts: [] }, { capacity }),
    "",
    `Parcels ${req.entity} owns (by the records it knows): ${own.join(", ") || "none"}.`,
    `Records the proposer knows of (latest ${recent.length}): ${recent.join("; ")}`,
  ].join("\n");
}

/** Laws the proposer knows of, with a formal "must not" condition, that the blocks appear to breach. */
export function lawWarnings(blocks: Block[], entity: string, now: number, known: Map<string, Record>): string[] {
  const all = [...known.values()];
  const withdrawn = new Set(all.flatMap((r) => (r.record === "withdrawal" ? [r.withdraws] : [])));
  const laws = all.filter((r): r is StatementRecord => r.record === "statement" && r.kind === "law" && !!r.formal?.condition && r.adico?.deontic === "must_not" && !withdrawn.has(r.id));
  const claims = standingClaims(all);
  const out: string[] = [];
  for (const law of laws) {
    blocks.forEach((b, i) => {
      const v = evaluate(law.formal!.condition, { block: b, actor: entity, now }, claims);
      if ("value" in v && v.value) out.push(`Block ${i + 1} appears to breach ${law.id}: "${law.text.slice(0, 300)}"`);
    });
  }
  return out.slice(0, 32);
}

export function draftHash(d: Draft): string {
  return hashWithDomain(DOMAIN_DRAFT, canonical(d));
}

export function createTranslator(io: LlmIO, check: KernelCheck, id = "translator") {
  const tid: TranslatorId = { id, version: TRANSLATOR_VERSION, model: `${io.adapter.provider}/${io.adapter.model}` };
  const seen = new Set<string>();
  return {
    id: tid,
    async translate(req: TranslateRequest, capacity: (t: string) => any = () => ({})): Promise<Translation> {
      const res = await callModel(io, {
        purpose: "translator", subject: id, system: translatorSystem(), maxTokens: 4000, tools: TOOLS,
        messages: [{ role: "user", content: context(req, capacity) }],
        context: { proposal: req.proposal, seat: req.seat, entity: req.entity },
      }, seen);
      const call = res.content.find((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use");
      if (!call || call.name === "cannot_draft") return { ok: false, reason: call?.input?.reason ?? "The translator gave no draft.", raw: res.content };
      const { blocks, summary, caveats } = call.input ?? {};
      const validate = blocksValidator();
      if (!validate(blocks)) return { ok: false, reason: `The drafted blocks don't fit the contract: ${JSON.stringify(validate.errors?.slice(0, 3))}`, raw: call.input };
      if (typeof summary !== "string" || !summary) return { ok: false, reason: "The translator gave no summary.", raw: call.input };
      const k = await check(req.seat, blocks);
      if (k.error) return { ok: false, reason: `The kernel couldn't read the draft: ${k.error}`, raw: call.input };
      const warnings = lawWarnings(blocks, req.entity, req.observation.t, req.known);
      const draft: Draft = {
        id: req.draftId, seat: req.seat, proposal: req.proposal.slice(0, 16384), blocks, summary: summary.slice(0, 16384),
        check: { ok: k.ok, ...(k.refusal ? { refusal: k.refusal } : {}), ...(warnings.length ? { warnings } : {}) },
        ...(typeof caveats === "string" && caveats ? { caveats: caveats.slice(0, 16384) } : {}),
        translator: tid,
      };
      return { ok: true, draft, hash: draftHash(draft) };
    },
  };
}

export { describeBlocks };
