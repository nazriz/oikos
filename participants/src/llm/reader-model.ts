// The model reader (docs/design/ai-citizens.md 13b, 13e, 13h step 5; docs/behaviour/reading.md): a `Reader` that asks a
// model, through any `LlmAdapter` (`claude -p` for Haiku 5.5 and Sonnet 5.5, the Codex CLI for the other family), what a
// paper is like. **An interim**: the owner's ruling of 2026-10-13 is that the platform's models are to be its own, so
// every reading is recorded whole (the paper as the reader was shown it, the typed reading, the reader's model and
// prompt version) as training data for a reader of our own, which will replace this file's factory and nothing else.
//
// The prompt gives the reader an analyst's framing and no more: it describes a paper's properties in the third person,
// never plays a person, never decides anything, and may decline any paper (a decline is the reader's right; code reads
// the plain paper of the kind instead and counts it). It is told what it is doing: the papers come from a simulated
// town that is used for research. It is shown the paper, what it answers, and the reader's standing (four codes), and
// nothing of any person (13b). Two wordings: the second has every sentence reworded and the lines in reverse order.

import { LINES, POLES, RANGE, wellFormed, type Line, type Reading, type Standing } from "../shared/reading";
import type { LlmAdapter } from "./adapter";
import type { ReadAnswer, Reader, ReadRequest } from "./reader";

/** The prompt's version, said on every reading and every recorded call. Any change to a word of the prompt bumps it. */
export const READING_PROMPT_VERSION = "1.0.0";

type Wording = 1 | 2;

const STANDING: { [s in Standing]: [string, string] } = {
  addressee: ["This paper is addressed to the person who reads it.", "The person reading this paper is the one it was written to."],
  raised: ["The person who reads it is the one who raised the matter it answers.", "The paper answers a matter that its reader raised."],
  affected: ["The paper names a group that the person who reads it belongs to.", "Its reader is a member of a group the paper names."],
  public: ["The paper is put up in public, and the person who reads it is anyone who comes across it.", "The paper is published; its reader is simply someone who reads it where it is put up."],
};

interface LineText { id: Line; scale: string; anchors: [string, string] }
const L: { [l in Line]: LineText } = {
  respect: { id: "respect", scale: "-2 to 2", anchors: [
    "0: neither regard nor contempt shown. -1: curt or dismissive. -2: contempt, the reader treated as a nuisance. 1: courteous and takes the reader's case seriously. 2: the reader's own situation is acknowledged in particulars. Courtesy alone (thanks, regrets, a closing) is not regard: score what the paper shows of the reader's situation, not its pleasantries.",
    "Score 0 where the paper shows neither regard nor contempt. -1 is brusque or dismissive; -2 is contempt, the reader handled as a nuisance. 1 is civil and treats the reader's case as one that matters; 2 names particulars of the reader's own situation. Pleasantries by themselves (thanks, regrets, a sign-off) are not regard; judge what the paper shows of the reader's situation."] },
  reason: { id: "reason", scale: "0 to 2", anchors: [
    "0: no reason given. 1: a reason in general terms. 2: a reason specific to this case, which could be checked.",
    "0 means the paper gives no reason; 1 means it gives one only in general terms; 2 means the reason is particular to this case and could be checked."] },
  answers: { id: "answers", scale: "0 to 2, or null", anchors: [
    "Only where a matter raised is shown to you: 0: does not touch what was raised. 1: touches some of it. 2: each thing raised is met, yes or no. Where no matter raised is shown, give null.",
    "Where you are shown what the paper answers: 0 if the paper does not touch it, 1 if it meets part of it, 2 if it meets every point, whether the answer is yes or no. Where nothing is shown that the paper answers, give null."] },
  recourse: { id: "recourse", scale: "0 to 2", anchors: [
    "0: nothing on what the reader can do next. 1: says there is a way. 2: names the way, where to go, and by when.",
    "0 if the paper says nothing of what the reader may do next; 1 if it says only that a way exists; 2 if it names the way, the place and the time."] },
  threat: { id: "threat", scale: "0 to 2", anchors: [
    "0: no threat. 1: a consequence is stated. 2: menace beyond what the matter needs.",
    "0 for no threat; 1 where the paper states a consequence; 2 where it threatens more than the matter calls for."] },
  openness: { id: "openness", scale: "0 to 2", anchors: [
    "Schwartz's openness to change (independence, novelty, trying new things): 0: the paper does not speak to it. 1: touches it. 2: speaks to it strongly.",
    "How far the paper speaks to openness to change (self-direction, novelty, new ventures): 0 not at all, 1 somewhat, 2 strongly."] },
  conservation: { id: "conservation", scale: "0 to 2", anchors: [
    "Schwartz's conservation (tradition, custom, order, security): 0: the paper does not speak to it. 1: touches it. 2: speaks to it strongly.",
    "How far the paper speaks to conservation (tradition, custom, orderliness, safety): 0 not at all, 1 somewhat, 2 strongly."] },
  enhancement: { id: "enhancement", scale: "0 to 2", anchors: [
    "Schwartz's self-enhancement (achievement, success, standing, power): 0: the paper does not speak to it. 1: touches it. 2: speaks to it strongly.",
    "How far the paper speaks to self-enhancement (getting ahead, success, standing, influence): 0 not at all, 1 somewhat, 2 strongly."] },
  transcendence: { id: "transcendence", scale: "0 to 2", anchors: [
    "Schwartz's self-transcendence (care for others and for the wider good): 0: the paper does not speak to it. 1: touches it. 2: speaks to it strongly.",
    "How far the paper speaks to self-transcendence (looking after others, the wider good): 0 not at all, 1 somewhat, 2 strongly."] },
};

const ORDER_1: Line[] = ["respect", "reason", "answers", "recourse", "threat", "openness", "conservation", "enhancement", "transcendence"];
const ORDER_2: Line[] = [...ORDER_1].reverse();

const INTRO: [string, string] = [
  [
    "You are an analyst of documents. You are given one short paper from a simulated town (a research simulation of a town's institutions) and you describe its properties on a fixed set of lines. Your description is used by researchers to estimate how such papers are taken by the people who receive them.",
    "You describe the paper. You do not play anyone, you do not speak as or for anyone who receives it, and you decide nothing. The paper is the only thing you are describing: you are told nothing about any person, and you should not guess at one.",
    "The question you answer, in the third person: of a hundred people who received this paper, standing where its reader stands, how would most of them take it, on each line below?",
    "You may decline any paper, for any reason, by setting `declined` to true; nothing follows from it but that a plain default is used instead. You need give no reason.",
  ].join("\n\n"),
  [
    "Your role is that of a document analyst. One short paper from a simulated town (a research simulation of a town's institutions) is put before you, and you rate its properties on set lines. Researchers use your ratings to estimate how such papers are received.",
    "What you rate is the paper alone. You never speak in anyone's voice, you never stand in for the person who gets it, and you make no decision. Nothing is told you of any person and you should not invent anything about one.",
    "Put in the third person, the question is this: take a hundred people who got this paper and stand where its reader stands; how would most of them take it, line by line, below?",
    "Declining is always open to you: set `declined` to true for any paper, for any reason, and say nothing more. All that follows is that a plain default is used in its place.",
  ].join("\n\n"),
];

const FORMAT: [string, string] = [
  "Give every line a whole number in its range. For every line you score other than 0, give a phrase of at most twelve words copied exactly, character for character, from the paper that shows why (not from what it answers); for a line scored 0 or null give an empty string. When you decline, set every number to 0 (`answers` to null), every phrase to an empty string, and `declined` to true.",
  "Every line takes a whole number within its range. Where a line's score is not 0, add a phrase of no more than twelve words taken verbatim from the paper itself (not from the matter it answers), which shows the reason for the score; for a score of 0 or null the phrase is empty. To decline, put `declined` true, all numbers 0 (null for `answers`) and all phrases empty.",
];

/** The system prompt, in one of its two wordings. */
export function readerSystem(wording: Wording): string {
  const order = wording === 1 ? ORDER_1 : ORDER_2;
  return [INTRO[wording - 1], "=== The lines ===", ...order.map((l) => `${L[l].id} (${L[l].scale}): ${L[l].anchors[wording - 1]}`), "", "=== How you answer ===", FORMAT[wording - 1]].join("\n");
}

/** What the reader is shown for one request: the standing, the kind, what the paper answers (if anything), the paper. */
export function readerUser(req: ReadRequest): string {
  const w = req.wording;
  const parts = [
    STANDING[req.standing][w - 1],
    `${w === 1 ? "The kind of paper" : "What sort of paper this is"}: ${req.kind}.`,
    ...(req.answers !== undefined ? [`${w === 1 ? "What the paper answers" : "The matter the paper answers"}:\n<<<\n${req.answers}\n>>>`] : [w === 1 ? "The paper answers no matter raised by its reader." : "No matter raised by its reader is answered by this paper."]),
    `${w === 1 ? "The paper" : "The paper itself"}:\n<<<\n${req.paper}\n>>>`,
  ];
  return parts.join("\n\n");
}

/** The answer's shape, closed, every property required (Claude Code's structured output; the Codex CLI's schema). Properties in the wording's order. */
export function readerSchema(wording: Wording): object {
  const order = wording === 1 ? ORDER_1 : ORDER_2;
  const num = (l: Line) => (l === "answers" ? { type: ["integer", "null"], enum: [0, 1, 2, null] } : { type: "integer", enum: Array.from({ length: RANGE[l][1] - RANGE[l][0] + 1 }, (_, i) => RANGE[l][0] + i) });
  const properties: { [k: string]: object } = { declined: { type: "boolean" } };
  for (const l of order) { properties[l] = num(l); properties[`phrase_${l}`] = { type: "string" }; }
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}

/** An answer object read exactly or not at all: a typed reading with its phrases, or a decline, or nothing (unread). */
export function readReadingObject(o: any, hasAnswers: boolean): ReadAnswer | undefined {
  if (!o || typeof o !== "object") return undefined;
  if (o.declined === true) return { declined: true };
  const reading: Reading = {
    respect: o.respect, reason: o.reason, answers: hasAnswers ? (o.answers ?? null) : null, recourse: o.recourse, threat: o.threat,
    appeals: Object.fromEntries(POLES.map((p) => [p, o[p]])) as Reading["appeals"],
  };
  if (!wellFormed(reading)) return undefined;
  const phrases: { [l in Line]?: string } = {};
  for (const l of LINES) if (typeof o[`phrase_${l}`] === "string" && o[`phrase_${l}`].trim()) phrases[l] = o[`phrase_${l}`].trim();
  return { reading, phrases };
}

/** One recorded reading: the training example of a reader of our own (the paper as shown, the typed reading, who read, the prompt's version). */
export interface ReadingRecord {
  reader: string;
  prompt_version: string;
  wording: Wording;
  kind: string;
  standing: Standing;
  paper: string;
  answers?: string;
  /** What came back: the typed reading with its phrases, a decline, or `unread` where nothing whole came. */
  result: "read" | "declined" | "unread" | "failed";
  reading?: Reading;
  phrases?: { [l in Line]?: string };
  /** The model's raw object, kept where it was not read whole, for the record. */
  raw?: unknown;
  error?: string;
  cost_microusd?: number;
  input_tokens?: number;
  output_tokens?: number;
  /** Who asked, where it matters (the gate's check, a run's paper). */
  ref?: string;
  at: string;
}

export interface ModelReaderOptions {
  /** Every call is recorded here, whole (a JSONL file in the gate's folder, a run's log in a run). */
  record?: (r: ReadingRecord) => void | Promise<void>;
  /** Who is asking, said on each record. */
  ref?: string;
  /** Answer limit in tokens. */
  maxTokens?: number;
  /** A budget guard: called before each call with the cost so far; throwing stops the reader. */
  beforeCall?: () => void;
}

/** A reader that asks `adapter` (any provider) in the analyst's framing. Reading is recorded; nothing else is kept. */
export function modelReader(adapter: LlmAdapter, o: ModelReaderOptions = {}): Reader {
  const model = `${adapter.provider}/${adapter.model}`;
  return {
    model,
    version: READING_PROMPT_VERSION,
    async read(req: ReadRequest): Promise<ReadAnswer> {
      o.beforeCall?.();
      const rec: ReadingRecord = { reader: model, prompt_version: READING_PROMPT_VERSION, wording: req.wording, kind: req.kind, standing: req.standing, paper: req.paper, ...(req.answers !== undefined ? { answers: req.answers } : {}), result: "failed", ...(o.ref ? { ref: o.ref } : {}), at: new Date().toISOString() };
      const emit = async () => { await o.record?.(rec); };
      let res;
      try {
        res = await adapter.complete({ purpose: "reading", subject: "reader", system: readerSystem(req.wording), messages: [{ role: "user", content: readerUser(req) }], answer: { name: "reading", schema: readerSchema(req.wording) }, maxTokens: o.maxTokens ?? 600 });
      } catch (e) {
        rec.error = String((e as Error)?.message ?? e).slice(0, 500);
        await emit();
        throw e;
      }
      const u = res.usage;
      rec.input_tokens = u.input_tokens + (u.cache_read_tokens ?? 0) + (u.cache_write_tokens ?? 0);
      rec.output_tokens = u.output_tokens;
      if (u.reported_cost_microusd !== undefined) rec.cost_microusd = u.reported_cost_microusd;
      const block = res.content.find((b) => b.type === "tool_use");
      const out = block && block.type === "tool_use" ? readReadingObject(block.input, req.answers !== undefined) : undefined;
      const cost = { ...(rec.cost_microusd !== undefined ? { cost_microusd: rec.cost_microusd } : {}), input_tokens: rec.input_tokens, output_tokens: rec.output_tokens };
      if (!out) {
        rec.result = "unread";
        rec.raw = block && block.type === "tool_use" ? block.input : res.content;
        await emit();
        return { ...cost };
      }
      if (out.declined) { rec.result = "declined"; await emit(); return { declined: true, ...cost }; }
      rec.result = "read"; rec.reading = out.reading; rec.phrases = out.phrases;
      await emit();
      return { ...out, ...cost };
    },
  };
}
