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

import { calls, canonical, DOMAIN_DRAFT, evaluate, hashWithDomain, standingClaims, type Block } from "@oikos/participants";
import { callModel, refusalText, type LlmIO, type LlmMessage, type ToolSpec } from "@oikos/participants/llm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Knowledge } from "./knowledge";
import { Preview } from "./preview";
import { LABEL_TEXT, RESOLVER, resolve, type Resolution, type StructureTypeInfo } from "./resolver";

export const TRANSLATOR_VERSION = "0.6.0";

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
  claim: "a right, liberty (a permission to do something), power or immunity is on record (or passed on, or released); position is one of right, liberty, power, immunity",
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
  take: "things someone else holds are taken from where they are, without their agreement",
};

/** What the translator is told of amounts, in place of the contract's line (which shows how three currencies are
 * written): true to what the parser accepts in any world, and naming no world's money. */
const AMOUNTS = "  - amounts: whatever the request wrote as one, copied whole: the digits (with their commas and decimals, and a multiplier such as k or m, or thousand to trillion, if written) together with the sign or code before them or the word or code after them, if any. The parser reads it in the world's own money, to an integer in its smallest unit; digits written with no sign or word are whole units.";

/** The translator's instructions: the call language itself, generated from the contract (P12), and nothing about any world. */
export function translatorSystem(): string {
  // The contract's syntax, with its line on amounts said for any world: the contract lists how three example
  // currencies are written, and the translator is to learn none of them (it copies; the parser, which has the world's
  // currency, reads). The contract's examples likewise lose their sign: bare digits are an amount in any world.
  const syntax = CALLS_MD.slice(CALLS_MD.indexOf("## Syntax"), CALLS_MD.indexOf("## Functions")).trim()
    .split("\n").map((line) => (line.startsWith("  - amounts") ? AMOUNTS : line)).join("\n");
  const unsigned = (text: string) => text.replace(/(amount|price|carrying)="[^0-9"]*([0-9][^"]*)"/g, (_, arg, digits) => `${arg}="${digits}"`);
  const fns = Object.entries(calls.ARGS).map(([fn, a]) => `- ${fn}(${a.allowed ? [...a.allowed].map((x) => (a.required.includes(x) ? `${x}*` : x)).join(", ") : [...a.required.map((x) => `${x}*`), "…the form's own fields"].join(", ")}): ${GLOSS[fn] ?? ""}`);
  const examples = unsigned(CALLS_MD.slice(CALLS_MD.indexOf("## Examples")).trim());
  return [
    "You translate one plain-language request into the call language below. You don't judge it, improve it or complete it: write exactly what was asked, with exactly the inputs given.",
    "- Copy ids exactly as written (lot-00-00, apts-3/dwelling.2, acc-city, rec.412). Copy names, amounts and durations as quoted text, exactly as written; never calculate anything.",
    "- An amount is copied exactly as written, with whatever sign or word of money the request used: its digits, its commas and decimals, and the sign, code or word before or after them. Don't add one the request didn't write, drop one it did, or put one in another's place.",
    "- If something the request needs isn't there, leave that argument out: whoever resolves the call will ask. A request that's plain but leaves a detail out is not unclear.",
    "- Never make up an id. Someone or something named or described without its id is written as the request put it, in quotes (to=\"Millbrook Builders\", by=\"the builder\", to=\"the works manager\"): whoever resolves the call knows who that is, or asks. Only an account that's described and not named (\"the town account\") is left out.",
    "- A kind of thing is the request's own word for it: \"40 goods\" is kind=goods, \"a park\" is type=park. Something published with no kind said is kind=notice.",
    "- Don't add what the request doesn't say: no purpose (for=) unless one is stated, no recipient it didn't name.",
    "- Telling, asking, directing or instructing someone to see to something is a message to them: message(to=<them>, text=\"<what's asked, in the request's words>\"). work(...) is for when the request itself gives the task, how much of it and where (\"have c0042 do 3 units of make at str.7\"): then it's work(task=make, units=\"3\", at=str.7, by=c0042), whoever is to do it.",
    "- Seen by everyone is visible=public.",
    "- Having someone build something for you is structure(type=..., on=..., by=<them>, price=..., from=...), on its own line: never wrapped in an agreement. Having something demolished is structure(remove=<the building>, by=...).",
    "- Ending an agreement by notice is agreement(notice=<the agreement>); accepting one offered to you is agreement(sign=<the agreement>).",
    "- Refuse, with none(<label>), a request that can't honestly be written as one call:",
    "  - needs_calculation: the amount isn't stated but must be worked out (a share, a percentage, \"whatever's left\", \"a fifth each\"). Never write money(...) without the amount.",
    "  - not_yours: it wants an outcome that's someone else's to decide (\"make the council pass it\", \"make them lower their prices\"). (Asking or telling them is different: that's a message.)",
    "  - too_much: several separate things in one request, each of which would be a request of its own (pay this, and hire them, and build that). One thing done to or for several (a letter to two people, the same payment to three accounts) is one thing; so are lines that depend on each other (set up a trust, then publish its charter).",
    "  - unknown_form: it names a form that isn't listed below the request. Don't use another form in its place.",
    "  - not_an_act: it asks to see, read, check, review, inspect or be shown something (a ledger, a record, who holds a post, the state of a place) and to bring nothing about. Looking is the person's own to do. (Asking someone else for it is different: that's a message to them. And if it asks to look and then to do something, it's the doing that's written.)",
    "  - unclear: it doesn't say what should happen (\"sort out the housing thing\").",
    "- To fill in a form, use form(...) with the form's own field names, listed below the request.",
    "",
    "A few more examples:",
    "  Have Acme build a shed on lot-07 for 9,000 from acc-1, under permit rec.30.  ->  structure(type=shed, on=lot-07, by=acme, price=\"9,000\", from=acc-1, basis=rec.30)",
    "  Get Acme to pull down str.4, paying 2k from acc-1.  ->  structure(remove=str.4, by=acme, price=\"2k\", from=acc-1)",
    "  Direct the clerk [clerk] to send me the minutes by Friday.  ->  message(to=clerk, text=\"Please send me the minutes by Friday.\")",
    "  Give notice on our agreement rec.9.  ->  agreement(notice=rec.9)",
    "  Pay Acme half of what we hold.  ->  none(needs_calculation)",
    "  Make the board approve the plan.  ->  none(not_yours)",
    "  Show me last month's payments out of acc-1.  ->  none(not_an_act)",
    "  Ask the registrar to send me last month's payments out of acc-1.  ->  message(to=\"the registrar\", text=\"Please send me last month's payments out of acc-1.\")",
    "",
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
/** The resolver the translator uses: the engine's, when the host gives one (its seat's knowledge is the engine's), or
 * this package's, from the request's knowledge. */
export type ResolveFn = (req: TranslateRequest, program: calls.Program) => Promise<Resolution>;

/**
 * What the participant is told when its words couldn't be turned into acts and the fault isn't in the words: no call
 * came back, the call wasn't in the call language, or it was put together wrongly. Until 2026-10-05 all of these, and
 * a failed dry run, read "It isn't clear what should happen. Could you say it more plainly?": the participant was
 * blamed for its wording, and the log couldn't tell them apart. What went wrong is in the failure's `invalid`.
 */
export const NOT_PUT = "That couldn't be put into effect as it was said, and nothing was done. You could say it again, or another way.";
/** The acts were worked out, and checking them failed (not a refusal: the check itself). */
export const NOT_CHECKED = "That couldn't be put into effect, and nothing was done. Saying it another way may not help.";

/** Resolver answers that are about how the call was put together (an argument of the wrong shape), not about anything
 * the participant said or knows: the call is at fault, so it's tried again, and the participant never reads these. */
const MALFORMED = /should name something, not (data|a call)\.$|should be written out\.$|should be data or text\.$|should be a list of names or ids\.$|^A commitment can be money, goods|\(then=periodic\)/;

/** Resolver questions another attempt at the call could fix (a name it didn't recognise, a refusal's own text). */
const RETRYABLE = /^You don't know of anyone or anything called|^It isn't clear what should happen|^That's for someone else to decide|^Please state the amount itself|^Please take this one step at a time|^You haven't seen a form by that name|^That's something to look up or read/;

export function createTranslator(io: LlmIO, check: KernelCheck, typeOf: (type: string) => StructureTypeInfo | undefined, id = "translator", attempts = 2, resolver?: ResolveFn) {
  const tid: TranslatorId = { id, version: TRANSLATOR_VERSION, model: `${io.adapter.provider}/${io.adapter.model}` };
  const seen = new Set<string>();
  type Failure = Extract<Translation, { ok: false }>;
  /** One answer, resolved and checked. `final`: a failure that another attempt can't help (the world, not the call). */
  async function attempt(req: TranslateRequest, out: { input?: any } | undefined, raw: unknown): Promise<{ ok: true; draft: Draft; hash: string } | (Failure & { final?: boolean })> {
    const text = typeof out?.input?.program === "string" ? out.input.program : undefined;
    if (!text) return { ok: false, notices: [NOT_PUT], raw, invalid: ["no call came back"] };
    let program: calls.Program;
    try {
      program = calls.parseProgram(text);
    } catch (e) {
      return { ok: false, notices: [NOT_PUT], call: text, invalid: [`not in the call language: ${String((e as Error).message).slice(0, 300)}`] };
    }
    const call = calls.programText(program);
    const r = resolver ? await resolver(req, program) : resolve(program, req.knowledge, typeOf, req.as);
    if (!r.ok && r.questions.some((q) => MALFORMED.test(q))) return { ok: false, notices: [NOT_PUT], call, invalid: [...(r.invalid ?? []), ...r.questions] };
    // A question another attempt can't answer (which account? which cell?) goes to the participant as it is: the call
    // was right, and something isn't known. Another attempt helps only where the call itself is the trouble: it's
    // invalid, a refusal, or names something by a name nobody has (2026-10-03: asked again after "which account?",
    // models gave up a correct call for none(unclear)).
    const retryable = !!r.ok || !!(r as any).invalid || "none" in program || (r as any).questions.some((q: string) => RETRYABLE.test(q));
    if (!r.ok) return { ok: false, notices: r.questions, call, ...(r.invalid ? { invalid: r.invalid } : {}), ...(retryable ? {} : { final: true }) };
    const k = await check(req.participant, req.as, r.blocks);
    if (k.error) return { ok: false, notices: [NOT_CHECKED], call, invalid: [`the check failed: ${String(k.error).slice(0, 500)}`], final: true };
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
          purpose: "translator", subject: id, ref: req.draftId, system: translatorSystem(), maxTokens: 2000, tools: TOOLS, messages,
          context: { proposal: req.proposal, participant: req.participant, attempt: n },
        }, seen);
        const out = res.content.find((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use" && b.name === "call");
        const r = await attempt(req, out, res.content);
        if (r.ok || n >= attempts || r.final) {
          const { final: _, ...t } = r as Failure & { final?: boolean };
          return { ...(r.ok ? r : t), ...(retries.length ? { retries } : {}) };
        }
        // What went wrong, for the record and for the next attempt: the call's own fault where there is one.
        const reason = (r.invalid?.length ? r.invalid : r.notices).join(" ");
        retries.push({ ...(r.call ? { call: r.call } : {}), reason });
        // Feedback in the same exchange: the answer, then what went wrong with it.
        const feedback = `That didn't work: ${reason}${r.call ? ` (your call: ${r.call})` : ""}. Read the request again, and write it as a call if any call can say it: a name exactly as the request wrote it, in quotes; an argument left out if it isn't given. Answer none(...) only if no call can.`;
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
