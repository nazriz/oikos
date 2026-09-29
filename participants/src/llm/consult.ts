// The sparse mind (docs/design/ai-citizens.md 4): a code participant, deliberating about something whose meaning its
// facts can't settle, asks a model how much each option would matter to someone like it, and the answer is remembered
// for that kind of person and thing. Everyone similar after decides from the remembered answer, sampling from its
// spread, without a call.
//
// - What the model is told: the thing, in its own words, and the person's values, needs and means, in words. Never a
//   demographic persona (models asked to play one collapse toward an average, or caricature).
// - What it answers: three independent judgements, 0 to 10 for each option, and why.
// - Every call goes through callModel, so it's logged in full (usage and transcript) and a resumed run serves it from
//   the log. It's a participant's own call (purpose "participant"), marked by its ref ("consult/<kind>").
// - Remembered for the run only: a run's answers never leak into another's.

import type { Consult, ConsultAnswer, ConsultQuestion } from "../module";
import { callModel, type LlmIO } from "./call";
import type { ContentBlock } from "./adapter";

export const CONSULT_VERSION = "0.1.0";

const WORDS: { [value: string]: string } = {
  self_direction: "thinking and choosing for themselves", stimulation: "novelty and challenge", hedonism: "pleasure and enjoying life",
  achievement: "success by their own efforts", power: "status and control over resources", security: "safety and stability",
  conformity: "fitting in and not upsetting others", tradition: "custom and faith", benevolence: "caring for those close to them",
  universalism: "fairness and caring for everyone and nature",
};
const NEED_WORDS: { [need: string]: string } = { subsistence: "food and everyday goods", shelter: "a place to live", security: "money to fall back on", social: "company", status: "standing and something to do" };

const sorted = (o: { [k: string]: number }) => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

/** The kind of person, coarsely: what they value most, what they lack most, whether they earn, how long their savings
 * would last, whether they live alone. Relative bins: no place's figures. */
export function kindOf(q: ConsultQuestion): string {
  const top = sorted(q.person.values)[0]?.[0] ?? "-";
  const lack = sorted(q.person.needs).at(-1)?.[0] ?? "-";
  const months = q.person.monthly_income > 0 ? q.person.savings / q.person.monthly_income : Infinity;
  const saved = q.person.savings <= 0 ? "none saved" : months < 1 ? "under a month saved" : months < 6 ? "months saved" : "half a year or more saved";
  return [q.about, top, lack, q.person.monthly_income > 0 ? "earning" : "no income", saved, q.person.household > 1 ? "with others" : "alone"].join("|");
}

/**
 * How a question is put to the model. The base wording is what runs use; the others exist for the robustness audit
 * (consult-audit): the same question reworded, its options in the other order, and the needs' bins shifted. Answers
 * that swing between them are reported, and a run can be told not to use them.
 */
export interface Wording { name: string; system: string; needBins: [number, number]; reverseOptions?: boolean }

const SYSTEM = [
  "You judge how much each of a few options would matter to a person, given what they value, what they lack and their means.",
  "Don't imagine who they are beyond what you're told, and don't play them. Judge as someone who knows people well.",
  "Give three independent judgements (as three different careful observers might), each scoring every option from 0",
  "(wouldn't matter to them at all, or would go against what they care about) to 10 (would matter a great deal).",
  'Answer with JSON only: {"judgements": [{"<option>": <score>, ...}, {...}, {...}], "why": "<one sentence>"}.',
].join(" ");

const SYSTEM_REWORDED = [
  "Someone is weighing a few options. From what they care about most, what they're short of and what they have, say how",
  "important each option would be for them. Don't invent a character or speak as them; reason as an experienced observer.",
  "Give three separate assessments, as three careful people might, each rating every option from 0 (of no importance to",
  "them, or against what they hold dear) to 10 (of great importance).",
  'Reply only with JSON: {"judgements": [{"<option>": <score>, ...}, {...}, {...}], "why": "<one sentence>"}.',
].join(" ");

export const WORDINGS: { [name: string]: Wording } = {
  base: { name: "base", system: SYSTEM, needBins: [7_000, 4_000] },
  reworded: { name: "reworded", system: SYSTEM_REWORDED, needBins: [7_000, 4_000] },
  options_reversed: { name: "options_reversed", system: SYSTEM, needBins: [7_000, 4_000], reverseOptions: true },
  bins_shifted: { name: "bins_shifted", system: SYSTEM, needBins: [6_000, 3_000] },
};

function prompt(q: ConsultQuestion, w: Wording = WORDINGS.base!): string {
  const values = sorted(q.person.values).map(([v]) => WORDS[v] ?? v);
  const needs = sorted(q.person.needs);
  const met = (bps: number) => (bps >= w.needBins[0] ? "well met" : bps >= w.needBins[1] ? "partly met" : "poorly met");
  const options = w.reverseOptions ? [...q.options].reverse() : q.options;
  const months = q.person.monthly_income > 0 ? q.person.savings / q.person.monthly_income : Infinity;
  return [
    `The thing: ${q.thing}`,
    `The options: ${options.map((o) => `"${o.key}" (${o.words})`).join("; ")}.`,
    `What matters to them, most first: ${values.join("; ")}.`,
    `How their needs stand: ${needs.map(([n, b]) => `${NEED_WORDS[n] ?? n}, ${met(b)}`).join("; ")}.`,
    `Their means: ${q.person.monthly_income > 0 ? "an income" : "no income"}; ${q.person.savings <= 0 ? "no savings" : months < 1 ? "savings of under a month's income" : months < 6 ? "a few months' income saved" : "half a year's income or more saved"}; ${q.person.household > 1 ? `living with ${q.person.household - 1} other${q.person.household > 2 ? "s" : ""}` : "living alone"}.`,
  ].join("\n");
}

/** The judgements in a model's answer, as basis points per option (0-10 scaled by 1,000), or undefined if unreadable. */
export function readJudgements(content: ContentBlock[], keys: string[]): { [key: string]: number[] } | undefined {
  const text = content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return undefined;
  let j: any;
  try {
    j = JSON.parse(text.slice(a, b + 1));
  } catch {
    return undefined;
  }
  const out: { [key: string]: number[] } = {};
  for (const k of keys) out[k] = [];
  for (const x of Array.isArray(j?.judgements) ? j.judgements : []) for (const k of keys) {
    const v = Number(x?.[k]);
    if (Number.isFinite(v)) out[k]!.push(Math.round(Math.max(0, Math.min(10, v)) * 1_000));
  }
  return keys.every((k) => out[k]!.length) ? out : undefined;
}

/** One question to the model, in a wording: each option's mean and spread (basis points), or undefined if unreadable. */
export async function askOnce(io: LlmIO, q: ConsultQuestion, subject: string, seenSystems: Set<string>, w: Wording = WORDINGS.base!, ref = `consult/${kindOf(q)}`): Promise<ConsultAnswer["scores"] | undefined> {
  const keys = q.options.map((o) => o.key);
  const res = await callModel(io, {
    purpose: "participant", subject, ref, system: w.system, maxTokens: 400,
    messages: [{ role: "user", content: prompt(q, w) }], context: { consult: { kind: kindOf(q), keys: w.reverseOptions ? [...keys].reverse() : keys } },
  }, seenSystems);
  const j = readJudgements(res.content, keys);
  if (!j) return undefined;
  const scores: ConsultAnswer["scores"] = {};
  for (const k of keys) {
    const xs = j[k]!;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    scores[k] = { mean: Math.round(mean), sd: Math.round(Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)) };
  }
  return scores;
}

/** The sparse mind for one run: asks through the run's model I/O, and remembers by kind. `avoid`: kinds (or kinds of
 * thing, the part before the first "|") an audit found unstable: not asked, so decided on the facts. */
export function createConsult(io: LlmIO, o: { avoid?: Iterable<string> } = {}): Consult {
  const avoid = new Set(o.avoid ?? []);
  const remembered = new Map<string, ConsultAnswer["scores"]>();
  const pending = new Map<string, Promise<ConsultAnswer["scores"] | undefined>>();
  const seenSystems = new Set<string>();
  return async (q: ConsultQuestion, subject: string): Promise<ConsultAnswer | undefined> => {
    const kind = kindOf(q);
    if (avoid.has(kind) || avoid.has(q.about)) return undefined;
    const known = remembered.get(kind);
    if (known) return { scores: known, asked: false, kind };
    // Someone of the same kind already asking at this moment: their answer serves us too.
    const already = pending.get(kind);
    if (already) {
      const s = await already;
      return s ? { scores: s, asked: false, kind } : undefined;
    }
    const asking = (async () => {
      const scores = await askOnce(io, q, subject, seenSystems);
      if (scores) remembered.set(kind, scores);
      return scores;
    })();
    pending.set(kind, asking);
    try {
      const s = await asking;
      return s ? { scores: s, asked: true, kind } : undefined;
    } finally {
      pending.delete(kind);
    }
  };
}
