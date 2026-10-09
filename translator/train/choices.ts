// Turns that are a choice among what was put to someone, banked for a later translator (docs/design/translator-v2.md):
// a citizen's choice among the options its mind weighed, and a plain yes or no to a draft's preview. Like v2.ts, it is
// in its own files and in no v1 training set.
//
// Both have the shape the later translator is to keep: the reading of a turn is ONE of a closed set of values given
// with it, never free text. A case is a situation in plain words, the values it can be read as (`options`), and the
// right one (`label`):
//
//   citizen   a decision a code citizen made in a pilot (the log's `decision` annotation: the options it saw with
//             their facts, its circumstances, its choice), told as that citizen would be told it (`citizenSituation`:
//             its money, what it knows of each shop, job or gathering, in the world's own money and in plain words:
//             no score, no weight, nothing of the mind's workings). The label is the option the code citizen chose.
//             The case keeps the decision's `seq`, `subject` and `n`, so it joins back to the outcome records.
//   reply     a draft's preview as a seat was really shown it, and a reply in plain words. `confirm` and `decline`
//             where a real seat confirmed or declined that draft; and two kinds made on real previews, the label fixed
//             by how the brief is built: `decline_and_ask` (yes, but with a change: which is a no, and a new request)
//             and `unclear` (a question back, which is neither).
//
// A writer says the turn; a reader of another model, shown the situation, the options and the turn, picks one; the
// case is kept where the reader picks the label. Nothing here reads a test case (orchestrator/src/broad.ts).

import { formatMoney, type Currency } from "@oikos/participants";
import { askerLine } from "./data";
import { V2_STYLES } from "./v2";

export const CHOICES_VERSION = "0.1.0";

export interface ChoiceCase {
  id: string; kind: "citizen" | "reply";
  /** What the speaker is told, in plain words. */
  situation: string;
  /** The values the turn can be read as, each with a few words on what it is. */
  options: { key: string; is: string }[];
  label: string;
  /** What else the writer is told about what to say (a reply's change or question is the writer's to invent, of this kind). */
  say?: string;
  /** Where it is from: a pilot's run; a decision's `seq`, `subject`, `n`, `domain`; a draft's reference. */
  from: { run: string; seq?: number; subject?: string; n?: number; domain?: string; t?: number; draft?: string; real?: boolean };
}
export interface ChoicePlanItem { id: string; writer: string; style: string; brief: string; case: ChoiceCase }
export interface ChoiceExample { id: string; kind: ChoiceCase["kind"]; text: string; situation: string; options: ChoiceCase["options"]; label: string; style: string; written_by: string; verified_by?: string; from: ChoiceCase["from"] }

const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

// ---------------------------------------------------------------- a citizen's decision, as it would be told it

/** A decision as the log records it (participants: the `decision` annotation's data). */
export interface DecisionRecord {
  domain: string; choice: string; n?: number; current?: string; t?: number;
  options: { key: string; facts?: { [k: string]: number | string | boolean } }[];
  circumstances?: { savings?: number; monthly_income?: number; essentials?: number; homeless?: boolean };
  state?: { emotion?: { about?: string; kind?: string } };
}

/** What a decision of each area is about, and what its options that are not a place are. */
const ABOUT: { [domain: string]: { asks: string; words: { [key: string]: string } } } = {
  shop: { asks: "where to do your shopping", words: {} },
  job: { asks: "which work to take", words: { none: "take none of them" } },
  practice: { asks: "whether to go to a gathering this week", words: { stay: "stay in" } },
  petition: { asks: "whether to start a petition", words: { start: "start one", not: "not start one" } },
  membership: { asks: "whether to join the union at your work", words: { join: "join", not: "not join" } },
  home: { asks: "which home to take", words: { stay: "stay where you are" } },
  goal: { asks: "how to go about something you need (each choice is a way of going about it)", words: {} },
};

/** One fact of an option in plain words: money in the world's own writing, the rest as what it counts. */
function factSaid(k: string, v: number | string | boolean, cur: Currency): string | undefined {
  if (typeof v !== "number") return typeof v === "boolean" ? (v ? k.replace(/_/g, " ") : undefined) : `${k.replace(/_/g, " ")}: ${v}`;
  if (k === "money_per_month") return v === 0 ? "costs nothing" : v < 0 ? `costs you about ${formatMoney(-v, cur)} a month` : `brings in about ${formatMoney(v, cur)} a month`;
  if (k === "goods_per_month") return v === 0 ? "you have bought nothing there yet" : `about ${v} things bought there a month`;
  if (k === "time_hours_per_month") return `takes about ${v} hours a month`;
  if (k === "work_hours_per_month") return `about ${v} hours of work a month`;
  if (k === "company") return v === 0 ? "nobody you know goes" : `${v} of the people you know go`;
  return `${k.replace(/_/g, " ")}: ${v}`;
}

/** A decision told to the citizen who makes it: its money, what it is choosing, and what it knows of each option.
 * Nothing of the mind's own workings (scores, what it has learned as a number, its values) is told: a citizen is
 * told what it could know, not how it weighs it. */
export function citizenSituation(d: DecisionRecord, cur: Currency): { situation: string; options: ChoiceCase["options"] } {
  const about = ABOUT[d.domain] ?? { asks: `something about ${d.domain}`, words: {} };
  const c = d.circumstances ?? {};
  const money = [
    c.savings !== undefined ? `You have about ${formatMoney(c.savings, cur)} put by.` : "", c.monthly_income !== undefined ? `About ${formatMoney(c.monthly_income, cur)} comes in a month.` : "",
    c.essentials !== undefined ? `The essentials cost you about ${formatMoney(c.essentials, cur)} a month.` : "", c.homeless ? "You have no home at present." : "",
  ].filter(Boolean).join(" ");
  const feeling = d.state?.emotion?.kind ? ` You feel ${d.state.emotion.kind}${d.state.emotion.about ? ` about ${d.state.emotion.about}` : ""}.` : "";
  const options = d.options.map((o) => {
    const facts = Object.entries(o.facts ?? {}).map(([k, v]) => factSaid(k, v, cur)).filter(Boolean).join("; ");
    const word = about.words[o.key];
    return { key: o.key, is: word ? `${word}${facts && o.key !== "stay" ? ` (${facts})` : ""}` : facts || "nothing more is known of it" };
  });
  const now = d.current !== undefined ? ` At present: ${about.words[d.current] ?? d.current}.` : "";
  return {
    situation: [`You live in a town. ${money}${feeling}`.trim(), `You are deciding ${about.asks}.${now}`, `What you know of each:\n${options.map((o) => `- ${o.key}: ${o.is}`).join("\n")}`].join("\n"),
    options,
  };
}

/** A decision as a case: undefined where there is nothing to choose between (one option), or the choice is none of them. */
export function citizenCase(d: DecisionRecord, cur: Currency, from: ChoiceCase["from"]): ChoiceCase | undefined {
  if (!Array.isArray(d.options) || d.options.length < 2 || !d.options.some((o) => o.key === d.choice)) return undefined;
  const { situation, options } = citizenSituation(d, cur);
  return { id: `c-${sha(`${from.run}/${from.seq}`).slice(0, 12)}`, kind: "citizen", situation, options, label: d.choice, from: { ...from, domain: d.domain, ...(d.n !== undefined ? { n: d.n } : {}), ...(d.t !== undefined ? { t: d.t } : {}) } };
}

// ---------------------------------------------------------------- a reply to a draft's preview

export const REPLY_OPTIONS: ChoiceCase["options"] = [
  { key: "confirm", is: "a plain yes: it is to go ahead as shown" },
  { key: "decline", is: "a plain no: it is not to go ahead (with or without a reason), and nothing else is asked" },
  { key: "decline_and_ask", is: "not as shown: it is to be done with a change, which is a no to this draft and a new request" },
  { key: "unclear", is: "neither a yes nor a no: a question back, or words that do not settle it" },
];

/** The previews a seat was shown in a sitting: each draft's reference and what it was told would happen. */
export function previewsIn(shown: string): { draft: string; preview: string }[] {
  const out = new Map<string, string>();
  for (const m of shown.matchAll(/Before this goes ahead \((draft\.[^)\s]+)\), here is exactly what will happen:\n([\s\S]*?)\nConfirm it, or decline it\./g)) out.set(m[1]!, m[2]!.trim());
  return [...out].map(([draft, preview]) => ({ draft, preview }));
}

/** What a writer is told to say for each kind of reply. */
const SAYS: { [label: string]: string[] } = {
  confirm: ["Say yes to it, plainly, in a few words or a sentence.", "Say that it is to go ahead as shown.", "Agree to it, as a person does when it is what they asked for."],
  decline: ["Say no to it, plainly, with no reason.", "Say no to it, and why in a few words: a reason of your own that fits what is shown. Ask for nothing else.", "Say that it is not to go ahead after all. Ask for nothing in its place."],
  decline_and_ask: ["Say that it is nearly right but one thing is to be different (an amount, who it goes to, when, how often: choose one that fits what is shown, and say what it should be instead).", "Say yes, but with a change of your own to one particular of what is shown, said in full, so that it would have to be drawn up again."],
  unclear: ["Ask a question back about what is shown (what one of its particulars means, where the money comes from, who will see it), and say neither yes nor no.", "Say something that does not settle it: that you will think about it, or that you are not sure it is what you meant, with no yes and no no."],
};

/** A preview as a case for each reply wanted of it. `real`: what the seat really did with it (confirm or decline). */
export function replyCases(run: string, draft: string, preview: string, real: "confirm" | "decline" | undefined, pick: (n: number) => number): ChoiceCase[] {
  const situation = `You asked for something to be done, and before it goes ahead you are shown exactly what will happen:\n${preview}\nYou may confirm it or decline it.`;
  const made = (label: string, isReal: boolean): ChoiceCase => ({ id: `r-${sha(`${run}/${draft}/${label}`).slice(0, 12)}`, kind: "reply", situation, options: REPLY_OPTIONS, label, say: SAYS[label]![pick(SAYS[label]!.length)]!, from: { run, draft, real: isReal } });
  const other = pick(2) === 0 ? "decline_and_ask" : "unclear";
  return [...(real ? [made(real, true)] : []), made(other, false), ...(real === "confirm" && pick(3) === 0 ? [made("decline", false)] : [])];
}

// ---------------------------------------------------------------- what a writer and a reader are given

export function choiceWriterSystem(): string {
  return [
    "You write what a person in a town says, in plain text, when something is put to them. The person has no tools: they read plain text and write plain text, and someone else works out from their words what they meant.",
    "You are given what the person is told, what they choose or answer, and a style. Write what they say: their choice or their answer, as they would say it to whoever carries things out for them.",
    "- It must be plain which it is: someone who reads what the person was told and then your words must be able to pick it out, and no other.",
    "- Name what is chosen as it is named to the person, or by what sets it apart from the others in what they know. A reason may be given from what the person knows, and nothing they don't know.",
    "- Never say it as a label or a code word (not \"confirm\", \"decline_and_ask\", \"option 2\", \"unclear\"): say it as a person does.",
    "- Add no id, amount or person that what they were told doesn't have, unless you are told to say a change of your own.",
    "Answer with what the person says, and nothing else.",
  ].join("\n");
}

export function choiceBrief(c: ChoiceCase, style: string): string {
  const what = c.kind === "citizen" ? `What you choose: ${c.label}${c.options.find((o) => o.key === c.label)?.is ? ` (${c.options.find((o) => o.key === c.label)!.is})` : ""}. Say your choice as a resident would, in a sentence or two, as you would tell a neighbour or whoever sees to things for you.` : `What you answer: ${c.say}`;
  return [`What the person is told:\n${c.situation}`, what, `Style: ${V2_STYLES[style] ?? style}`, ...(c.kind === "citizen" ? [askerLine("citizen")] : [])].join("\n\n");
}

export const CHOICE_DEAL = ["terse", "flat", "chatty", "slips", "rambling", "polite", "terse", "flat", "reasoned", "slips"];

export function choicePlan(cases: ChoiceCase[], o: { writers: string[]; styles?: string[]; seed?: number }): ChoicePlanItem[] {
  const styles = o.styles ?? CHOICE_DEAL;
  return cases.map((c, n) => {
    const style = styles[n % styles.length]!;
    const brief = choiceBrief(c, style);
    return { id: `${c.id}-${sha(JSON.stringify([o.seed ?? 1, n, brief])).slice(0, 8)}`, writer: o.writers[n % o.writers.length]!, style, brief, case: c };
  });
}

export function choiceReaderSystem(): string {
  return [
    "A person in a town was told something and has answered in plain text. You are given what they were told, the values their answer can be read as (each with a few words on what it is), and their answer. Pick the one value their answer is.",
    "- You don't judge whether it is wise. You read what was said.",
    "- Pick `unclear` (where it is among the values) or answer \"unclear\" only where the words do not settle on one value.",
    "- A yes that asks for something to be different from what was shown is not a yes to what was shown.",
    "Answer with the value's key, copied exactly.",
  ].join("\n");
}

/** What a reader hands in: for each turn, the key it picked. */
export const CHOICE_ANSWER = { type: "object", additionalProperties: false, required: ["answers"], properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "choice"], properties: { id: { type: "string", description: "the turn's id, copied exactly" }, choice: { type: "string", description: "the key of the value picked, copied exactly" } } } } } };
