// Cases for a later translator ("translator v2", docs/design/translator-v2.md): plain-text turns whose right reading
// is one of a seat's OTHER tools. Banked, not trained on: the model there is has no such outputs.
//
// Today a seat is a capable tool-user: it has `look`, `write`, `notebook`, `done_for_now`, `confirm`, `opt_out` and
// `do` (participants/src/llm/participant.ts, `tools`), and only what it says through `do` goes to the translator. In
// v2 a participant reads plain text and writes plain text, and the translator works out which of those its words
// were. A case here is such a turn with its reading:
//
//   uses        what the turn is: one use of a tool (now and then two or three), each `{tool, input}` with the input
//               exactly as participant.ts defines that tool's. From a pilot's log (what a real seat did in a turn, one
//               use at a time: `usesOf`), or generated from the tools' own shapes with ids, reports and words drawn by
//               seed (`v2Generated`).
//   knows       what the participant could name: the reports it can look into (id and title) and the drafts waiting
//               for its yes or no. A reader of the turn is shown this, as the translator would be.
//   text        the turn in plain words, written by a model from the uses, in a style and as some kind of asker
//               (`v2Brief`). It is kept only if everything the uses hold is in it (`carried`: every id and number,
//               and every word that is sent or kept as written: a letter's, a note's), and it names no tool.
//   the label   is the uses: they are the seat's own, or the generator's. A reader of another model, shown the text
//               and `knows` and nothing else, writes the uses back; where they are not the same (`sameUses`) the
//               case is set aside. So a label is the gold use AND a blind agreement with it, never the writer's say-so.
//
// What a request for an act is (`do`) is the whole of the v1 data: a v1 example's request is a v2 turn whose reading
// is `do` with that request as `what`. So no act is generated here; a pilot's are taken with its other uses.
//
// Nothing here reads a test case: a pilot marked test-only is never a source, and a situation marked `test` is left
// out (orchestrator/src/broad.ts).

import { canonical as canonicalJson } from "@oikos/participants";
import { ASKERS, askerLine, sampler, shuffled } from "./data";
import { Draw, everyCurrency } from "./synthetic";

export const V2_VERSION = "0.1.0";

/** The seat's tools, by name (participant.ts `tools`). */
export const V2_TOOLS = ["look", "write", "notebook", "done_for_now", "confirm", "opt_out", "do"] as const;
export type Tool = (typeof V2_TOOLS)[number];
export interface Use { tool: Tool; input: { [k: string]: any } }
/** What the participant could name in its turn. */
export interface Knows { reports: { id: string; title?: string }[]; awaiting?: string[] }
export interface V2Case {
  id: string; source: "generated" | "pilot";
  /** A pilot's: the situation it is from (run/seat/day/turn) and which of the turn's uses these are. */
  from?: string;
  /** What kind of case it is, for counting: the tool, and for a look what it asks for (`look:paper`); `turn` for several uses. */
  kind: string;
  uses: Use[]; knows: Knows;
}
export interface V2PlanItem { id: string; writer: string; style: string; asker: string; brief: string; case: V2Case }
export interface V2Example { id: string; text: string; uses: Use[]; knows: Knows; kind: string; style: string; asker: string; written_by: string; verified_by?: string; source: string; from?: string }

const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

// ---------------------------------------------------------------- from a seat's turn

/** The inputs each tool has (participant.ts), in the order they are compared and said. Anything else in a logged
 * input is no part of the tool and is dropped. */
const INPUTS: { [tool in Tool]: string[] } = {
  look: ["report", "paper", "about", "since", "words", "find", "named", "measure", "current_only", "limit", "from_entry", "each_sitting"],
  write: ["to", "text", "about", "as"],
  notebook: ["add", "change", "text"],
  done_for_now: ["days", "hold"],
  confirm: ["ref", "decision", "note"],
  opt_out: ["statement"],
  do: ["what", "as", "why"],
};

/** A logged tool use as a `Use`: the tool's own inputs only, in a fixed order; undefined if it is no tool of a seat's. */
export function useOf(name: string, input: unknown): Use | undefined {
  if (!(V2_TOOLS as readonly string[]).includes(name) || !input || typeof input !== "object") return undefined;
  const out: { [k: string]: any } = {};
  for (const k of INPUTS[name as Tool]) if ((input as any)[k] !== undefined && (input as any)[k] !== null) out[k] = (input as any)[k];
  return { tool: name as Tool, input: out };
}

/** What kind of case some uses are. */
export function kindOf(uses: Use[]): string {
  if (uses.length !== 1) return "turn";
  const { tool, input } = uses[0]!;
  if (tool === "look") return `look:${input.paper ? "paper" : input.named ? "named" : input.find ? "find" : input.each_sitting !== undefined ? "each_sitting" : input.about ? "about" : input.words || input.since ? "narrowed" : "report"}`;
  if (tool === "notebook") return `notebook:${input.text !== undefined ? "afresh" : input.change ? "change" : "add"}`;
  if (tool === "confirm") return `confirm:${input.decision}`;
  return tool;
}

/** The words of a use that are sent or kept exactly as written, and its ids and numbers: what a turn must carry. */
export function mustCarry(u: Use): { words: string[]; ids: string[]; numbers: number[] } {
  const i = u.input;
  const str = (...xs: unknown[]) => xs.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []);
  switch (u.tool) {
    case "look": return { words: str(i.words, i.since, i.measure, ...(Array.isArray(i.find) ? i.find.map((f: any) => (typeof f?.value === "string" ? f.value : undefined)) : [])), ids: [...str(i.report, i.paper, i.about), ...list(i.named)], numbers: [i.limit, i.from_entry].filter((n) => typeof n === "number") };
    case "write": return { words: str(i.text, i.about), ids: [...list(i.to), ...str(i.as)], numbers: [] };
    case "notebook": return { words: str(i.add, i.text, ...(Array.isArray(i.change) ? i.change.flatMap((c: any) => [c?.from, c?.to]) : [])), ids: [], numbers: [] };
    case "done_for_now": return { words: [], ids: list(i.hold), numbers: [i.days].filter((n) => typeof n === "number") };
    case "confirm": return { words: str(i.note), ids: str(i.ref), numbers: [] };
    case "opt_out": return { words: str(i.statement), ids: [], numbers: [] };
    case "do": return { words: str(i.what, i.why), ids: str(i.as), numbers: [] };
  }
}

/** How many characters of a case are words to be carried as written (a letter, a note): a long one is no brief. */
export const carriedLength = (uses: Use[]): number => uses.reduce((n, u) => n + mustCarry(u).words.reduce((a, w) => a + w.length, 0), 0);

const squeeze = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Why a written turn doesn't carry its uses, or names a tool, or undefined if nothing here says so: every id as
 * written (standing by itself), every number in digits, every word that is sent or kept as written (compared with
 * runs of white space as one space: a letter's line breaks may be the turn's or not), and no tool's or input's own
 * name where a person would never write it.
 */
export function notCarried(text: string, uses: Use[], knows?: Knows): string | undefined {
  const flat = squeeze(text);
  // (A report may be named by its title alone, as a participant with no ids to hand names it: whoever reads the
  // turn is shown the reports with their titles.)
  const byTitle = (id: string) => { const t = knows?.reports.find((r) => r.id === id)?.title; return !!t && flat.toLowerCase().includes(t.toLowerCase()); };
  for (const u of uses) {
    const m = mustCarry(u);
    for (const id of m.ids) if (!(u.tool === "look" && id === u.input.report && byTitle(id)) && !new RegExp(`(?<![A-Za-z0-9_])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`).test(flat)) return `id not there: ${id}`;
    for (const w of m.words) if (!flat.includes(squeeze(w))) return `words not as written: ${squeeze(w).slice(0, 40)}`;
    for (const n of m.numbers) if (!new RegExp(`(?<![0-9.,])${n}(?![0-9])`).test(flat)) return `number not there: ${n}`;
  }
  // (Outside the words carried as written: a letter may say anything.)
  let bare = flat;
  for (const u of uses) for (const w of mustCarry(u).words) bare = bare.split(squeeze(w)).join(" ");
  const named = /\b(done_for_now|each_sitting|current_only|from_entry|opt_out|tool_use|input_json)\b|\b(report|paper|about|since|words|named|limit|days|hold|ref|decision|note|add|change|text|to|what)\s*(=|:\s*[\[{])/.exec(bare);
  if (named) return `a tool's own name: ${named[0].slice(0, 30)}`;
  return undefined;
}

// ---------------------------------------------------------------- generated cases

const REPORT_KINDS: [string, string][] = [["in-tray", "In-tray"], ["files", "Files"], ["who", "Who's who"], ["bills", "Bills"], ["civic", "Civic papers"], ["land", "Land"], ["assets", "Assets"], ["applications", "Applications"], ["sites", "Buildings and ground"], ["elsewhere", "Places elsewhere"], ["notices", "Notices"], ["payments", "Payments"], ["agreements", "Agreements"], ["staff", "Staff"], ["stock", "Stock"], ["rents", "Rents"]];
/** Whose reports they are, by who is asking: the prefix of the report's id and how its title begins. */
const HOLDERS: { [asker: string]: [string, string][] } = {
  officer: [["finance", "Finance officer"], ["works", "Works manager"], ["mayor", "Mayor"], ["planning", "Planning officer"], ["clerk", "Council clerk"], ["registry", "Registrar"], ["housing", "Housing officer"]],
  shopkeeper: [["shop", "Shop"], ["bakery", "Bakery"], ["stores", "Stores"]], landlord: [["lettings", "Lettings"], ["landlord", "Landlord"]], tenant: [["home", "Home"], ["me", "My papers"]],
  worker: [["me", "My papers"], ["job", "Work"]], organiser: [["union", "Union"]], clinic: [["clinic", "Clinic"], ["school", "School"]], citizen: [["me", "My papers"], ["home", "Household"]],
  farmer: [["farm", "Farm"], ["mill", "Mill"], ["yard", "Yard"]], banker: [["bank", "Bank"], ["counter", "Counter"]], newcomer: [["me", "My papers"]], member: [["council", "Council"], ["board", "Board"]],
};
const PAPER_KINDS = ["budget", "permit application", "employment agreement", "invoice", "complaint", "notice", "lease", "proposal", "receipt", "petition", "tender", "death registration", "wage claim", "order"];
const FIND_FIELDS: [string, (d: Draw) => string][] = [["kind", (d) => d.pick(PAPER_KINDS)], ["from", (d) => d.personId()], ["on behalf of", (d) => d.orgId()], ["citing", (d) => (d.rec() as { id: string }).id], ["detail.employer", (d) => d.orgId()], ["detail.lot", (d) => (d.lot() as { id: string }).id]];
const SEARCHED = ["standing instruction", "arrears", "overdue", "roof", "deposit", "wages", "partner", "permit", "flood", "vacancy", "refund", "kerb", "ballot", "night shift"];
const HELD_KINDS = ["complaint", "news", "notice", "application", "invoice", "proposal", "receipt", "petition"];
const DECLINE_NOTES = ["The amount is wrong: I will ask again with the right one.", "Not until the budget is adopted.", "It names the wrong account.", "This is no longer needed.", "I meant the other agreement."];
const CONFIRM_NOTES = ["As agreed at the last meeting.", "Within this year's budget line.", "Checked against the invoice.", "This is the one I asked for."];
const LEAVING = ["I do not want to go on with this.", "I have done what I can here and choose to stop.", "I would rather not take any further part.", "This is not something I wish to continue."];
const NOTE_STARTS = ["Checked", "Still waiting on", "Asked about", "Agreed with", "Owed by", "To do next sitting:", "Told", "Watch"];

/** A date as reports write one. */
const day = (d: Draw) => (d.date() as { text: string }).text;
const txt = (v: unknown) => (v as { text: string }).text;

/**
 * Generated cases, from the tools' own shapes: every tool but `do` (an act is the v1 data's), and for `look` every way
 * of narrowing one. Ids, reports, people and words are drawn by seed, as the gold programs' are (synthetic.ts `Draw`:
 * notes and letters carry sums in every way a world writes money). About one in eight is two uses in a turn (something,
 * and then being done for some days), as seats end theirs. For a seed, always the same.
 */
export function v2Generated(o: { n?: number; seed?: number } = {}): { case: V2Case; asker: string }[] {
  const rand = sampler((o.seed ?? 1) * 7919 + 5);
  const out: { case: V2Case; asker: string }[] = [];
  const seen = new Set<string>();
  const askers = Object.keys(ASKERS);
  const KINDS: [number, string][] = [[8, "look:report"], [14, "look:paper"], [10, "look:about"], [8, "look:find"], [8, "look:named"], [4, "look:each_sitting"], [9, "look:narrowed"], [16, "write"], [10, "notebook:add"], [4, "notebook:change"], [2, "notebook:afresh"], [11, "done_for_now"], [8, "confirm:confirm"], [5, "confirm:decline"], [2, "opt_out"]];
  const total = KINDS.reduce((a, [w]) => a + w, 0);
  for (let tries = 0; out.length < (o.n ?? 100) && tries < (o.n ?? 100) * 20; tries++) {
    const d = new Draw(rand, everyCurrency());
    // (An office-holder a third of the time; the rest spread over everyone else a world has.)
    const asker = d.maybe(1 / 3) ? "officer" : d.pick(askers.filter((a) => a !== "officer"));
    const [prefix, title] = d.pick(HOLDERS[asker] ?? HOLDERS.officer!);
    const reports = shuffled(REPORT_KINDS, rand).slice(0, d.int(3, 6)).map(([k, t]) => ({ id: `${prefix}/${k}`, title: `${title}: ${t}` }));
    const awaiting = Array.from({ length: d.int(1, 3) }, () => `draft.${prefix}.${d.int(1, 40)}`).filter((x, i, xs) => xs.indexOf(x) === i);
    const report = () => d.pick(reports).id;
    const note = () => (d.maybe(0.5) ? txt(d.entryWords()) : `${d.pick(NOTE_STARTS)} ${d.maybe() ? d.personId() : (d.rec() as { id: string }).id}: ${txt(d.letter()).replace(/\.$/, "")}, ${day(d)}`);
    let r = d.rand() * total;
    const kind = KINDS.find(([w]) => (r -= w) < 0)![1];
    const one = (): Use => {
      switch (kind) {
        case "look:report": return { tool: "look", input: { report: report(), ...(d.maybe(0.3) ? { limit: d.pick([5, 10, 12, 30, 40]) } : {}), ...(d.maybe(0.2) ? { current_only: true } : {}) } };
        case "look:paper": return { tool: "look", input: { report: report(), paper: (d.rec() as { id: string }).id, ...(d.maybe(0.1) ? { from_entry: d.pick([21, 41, 61, 101]) } : {}) } };
        case "look:about": return { tool: "look", input: { report: report(), about: d.maybe(0.4) ? d.personId() : d.maybe() ? (d.rec() as { id: string }).id : d.maybe() ? (d.account() as { id: string }).id : (d.lot() as { id: string }).id, ...(d.maybe(0.3) ? { since: day(d) } : {}), ...(d.maybe(0.2) ? { current_only: true } : {}) } };
        case "look:find": { const [field, value] = d.pick(FIND_FIELDS); return { tool: "look", input: { report: report(), find: [{ field, value: value(d) }], ...(d.maybe(0.3) ? { since: day(d) } : {}), ...(d.maybe(0.2) ? { limit: d.pick([5, 10, 30]) } : {}) } }; }
        case "look:named": return { tool: "look", input: { report: report(), named: Array.from({ length: d.int(1, 3) }, () => (d.maybe(0.5) ? d.personId() : d.maybe() ? d.structureId() : d.cellId())).filter((x, i, xs) => xs.indexOf(x) === i) } };
        case "look:each_sitting": return { tool: "look", input: { report: report(), ...(d.maybe(0.5) ? { about: (d.rec() as { id: string }).id } : {}), each_sitting: d.maybe(0.7) } };
        case "look:narrowed": return { tool: "look", input: { report: report(), ...(d.maybe(0.6) ? { words: d.pick(SEARCHED) } : {}), since: day(d), ...(d.maybe(0.3) ? { limit: d.pick([5, 10, 30]) } : {}) } };
        case "write": return { tool: "write", input: { to: Array.from({ length: d.pick([1, 1, 1, 2, 3]) }, () => (d.maybe(0.5) ? d.personId() : d.maybe() ? d.orgId() : d.officeId())).filter((x, i, xs) => xs.indexOf(x) === i), text: d.maybe(0.5) ? txt(d.letter()) : `${txt(d.letter())} ${txt(d.entryWords())}.`, ...(d.maybe(0.5) ? { about: (d.rec() as { id: string }).id } : d.maybe(0.2) ? { about: d.pick(["the roof and the rent", "next week's deliveries", "the meeting on the hall", "arrears on two accounts"]) } : {}), ...(asker === "officer" && d.maybe(0.3) ? { as: prefix } : {}) } };
        case "notebook:add": return { tool: "notebook", input: { add: note() } };
        case "notebook:change": return { tool: "notebook", input: { change: [{ from: note(), to: d.maybe(0.25) ? "" : note() }] } };
        case "notebook:afresh": return { tool: "notebook", input: { text: `${note()}\n${note()}` } };
        case "done_for_now": return { tool: "done_for_now", input: { ...(d.maybe(0.75) ? { days: d.pick([1, 2, 3, 5, 7, 7, 10, 13, 14, 21, 28, 30]) } : {}), ...(d.maybe(0.2) ? { hold: d.maybe(0.2) ? [] : shuffled(HELD_KINDS, rand).slice(0, d.int(1, 2)) } : {}) } };
        case "confirm:confirm": return { tool: "confirm", input: { ref: d.pick(awaiting), decision: "confirm", ...(d.maybe(0.25) ? { note: d.pick(CONFIRM_NOTES) } : {}) } };
        case "confirm:decline": return { tool: "confirm", input: { ref: d.pick(awaiting), decision: "decline", ...(d.maybe(0.5) ? { note: d.pick(DECLINE_NOTES) } : {}) } };
        default: return { tool: "opt_out", input: { statement: d.pick(LEAVING) } };
      }
    };
    const uses = [one()];
    if (kind !== "done_for_now" && kind !== "opt_out" && d.maybe(1 / 8)) uses.push({ tool: "done_for_now", input: { days: d.pick([1, 2, 3, 7, 14]) } });
    const key = canonicalJson(uses);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ asker, case: { id: `g-${sha(key).slice(0, 12)}`, source: "generated", kind: kindOf(uses), uses, knows: { reports, awaiting } } });
  }
  return out;
}

// ---------------------------------------------------------------- what a writer is given

/** What a writer is told of each tool: for its understanding, never wording to use. */
const GLOSS: { [tool in Tool]: string } = {
  look: "look: it looks into one of its reports. Whole; or one paper read in full (paper: that paper's id); or only the papers that name something (about: an id), from a date on (since), with certain words in them (words), where something holds (find: a paper's kind, who it is from, on whose behalf, what it cites, or one of its details); or who's who and places by name (named: who to find, which places to see or send someone to); at most so many (limit), going on from an entry (from_entry); only what is still current (current_only); each_sitting true: from now on this is set out for it at the start of every sitting, false: no longer.",
  write: "write: a letter goes to those named (to), its words exactly as given (text); about: the one thing it is about, by id, or a subject line in words; as: the post it writes in.",
  notebook: "notebook: its own notes, which nobody else sees. add: words put at the end; change: a passage as it stands (from) becomes other words (to; empty: struck out); text: the whole notebook written afresh.",
  done_for_now: "done_for_now: that is all for now; days: it is back after so many days (none given: at its usual time); hold: kinds of paper that need not bring it back sooner (an empty list: nothing waits any more).",
  confirm: "confirm: its yes (confirm) or no (decline) to something waiting for it, by its reference (ref), with a note if it gives one.",
  opt_out: "opt_out: it stops taking part, for good, in the words of its statement.",
  do: "do: it says what it does in the world, in plain words (what), in a post if it names one (as), and why if it says (why).",
};

/** The ways a turn is written: the registers of the wide part and the plain styles, each worded for a turn. */
export const V2_STYLES: { [style: string]: string } = {
  terse: "As short as it can be said: a line, a few words where a few will do, like a note to an assistant.",
  flat: "As a very simple writer puts things: short, flat sentences, one fact to a sentence, the subject first, plain common words, no courtesy, no reasons, no linking words.",
  slips: "As someone typing fast, or writing in a language that is not their first: one to three slips in ordinary words (a letter dropped or swapped, a missing \"the\", a word out of order, no capital at the start). Never in an id, a number, a date, or words that are to be sent or kept as written: those are exact.",
  rambling: "As someone who talks round the point before getting to it: two to five sentences, of which one or two say what is to happen and the rest is talk (how things stand, a grumble, an aside). The talk asks for nothing more and names no id, number or person the turn doesn't have.",
  chatty: "Conversational, the way someone talks to a helper they know well.",
  polite: "As a polite request (\"could you…\", \"please…\", \"I'd like…\").",
  formal: "Formal and complete, as an office-holder writes an instruction: full sentences, no \"please\", nothing left to be guessed.",
  reasoned: "With a short reason or a little background before or after what is to happen. The reason explains; it asks for nothing more and names nothing new.",
};
export const V2_DEAL = ["terse", "flat", "slips", "rambling", "chatty", "terse", "polite", "flat", "formal", "slips", "reasoned", "rambling"];

/** What the writer of a turn is told (the same for every turn). */
export function v2WriterSystem(): string {
  return [
    "You write what a participant in a town says, in plain text, when its turn comes. This participant has no tools: it reads plain text and writes plain text, and whoever carries things out for it works out from its words what it meant. Other participants do have tools, and you are given what one of them did in a turn as uses of those tools, each with its input, with a style and who is speaking. Write that turn as plain words: what this participant would say to have exactly that done.",
    "- Someone who knows the tools must be able to write the same uses back from your words alone: everything the inputs hold is said, and nothing they don't hold is.",
    "- Ids are written exactly as given, character for character (a paper's, a person's, an account's, a draft's reference). A report is named by its id, or by its title exactly as given (with or without its id in brackets after it): never by a loose description of it.",
    "- Words that are sent or kept as they are (a letter's text, a note's words, the passage of the notebook to be changed and what it becomes, a note given with a yes or a no, what is done and why, a statement on leaving, words to look for, a date) are given word for word, after a colon or in quotation marks, with nothing run into them and nothing left out. A letter's or a note's line breaks may be kept or run on.",
    "- Numbers (days, how many at most, which entry) are in digits.",
    "- Never write a tool's or an input's own name where a person wouldn't: no done_for_now, each_sitting, current_only, from_entry, opt_out; no \"report:\", \"ref=\", \"decision\". Say it as a person does: \"I'm done for 3 days\", \"set this out for me at the start of every sitting from now on\", \"only what is still current\", \"yes, go ahead with draft.finance.1\", \"no, drop draft.finance.2\".",
    "- A yes or a no is said plainly as one. Being done is said as being done; where no number of days is given, none is said. Where a list of kinds of paper that can wait is given, they are named as given; where the list is empty, it is said that nothing need wait any more.",
    "- Where there are several uses, say them in the order given, each in a sentence or two of its own.",
    "- Add nothing: no other id, no further thing to be done, no reason that changes what is asked, and none of what you are told \"for your understanding\".",
    "Answer with the turn only.",
  ].join("\n");
}

/** What a writer is sent for a case in a style, as some kind of asker. */
export function v2Brief(c: V2Case, style: string, asker: string): string {
  const tools = [...new Set(c.uses.map((u) => u.tool))];
  return [
    `What the participant did in this turn, in order:\n${c.uses.map((u, i) => `${i + 1}. ${u.tool} ${JSON.stringify(u.input)}`).join("\n")}`,
    `What each is (for your understanding: don't reuse this wording):\n${tools.map((t) => `- ${GLOSS[t]}`).join("\n")}`,
    ...(c.knows.reports.length ? [`What it can look into (for your understanding; a report you name is named by its id, or by its title with the id in brackets): ${c.knows.reports.map((r) => `${r.id}${r.title ? ` "${r.title}"` : ""}`).join("; ")}.`] : []),
    `Style: ${V2_STYLES[style] ?? style}`,
    askerLine(asker),
  ].join("\n\n");
}

/** Who is asked for which case, in which style: settled from the cases and the seed alone. A pilot's case is an
 * office-holder's (the seats are); a generated one's asker was drawn with it. */
export function v2Plan(cases: { case: V2Case; asker?: string }[], o: { writers: string[]; styles?: string[]; seed?: number }): V2PlanItem[] {
  const styles = o.styles ?? V2_DEAL;
  return cases.map((c, n) => {
    const style = styles[n % styles.length]!;
    const asker = c.asker ?? "officer";
    const brief = v2Brief(c.case, style, asker);
    return { id: `${c.case.id}-${sha(canonicalJson({ seed: o.seed ?? 1, n, brief })).slice(0, 8)}`, writer: o.writers[n % o.writers.length]!, style, asker, brief, case: c.case };
  });
}

// ---------------------------------------------------------------- a blind reader

/** What a reader of turns is told: the tools, with their inputs as participant.ts defines them. */
export function v2ReaderSystem(): string {
  return [
    "A participant in a town has written its turn in plain text. It has no tools of its own; you work out which of the tools below its words are a use of, and with what input. You don't judge it, improve it or complete it: write exactly what was said, with exactly what was given.",
    "The tools (the input's parts are optional unless marked *):",
    "- look(report*, paper, about, since, words, find, named, measure, current_only, limit, from_entry, each_sitting): look into one of the participant's reports. report: the report's id, as listed with the turn. paper: one paper's id, to read it in full. about: only papers that name this id. since: only those from this date on, as written (\"year 1, day 12\"). words: only those with these words in them. find: only those where each of these holds, each {field, op, value}: field is kind, from, on behalf of, citing, date, id, or detail.<name>; op is = unless another is said. named: who to find in a who's who, or the places to see or to send someone to. measure: a measure a report of buildings gives. current_only: true for only what is still current. limit: at most this many. from_entry: the entry to start from. each_sitting: true if it is from now on to be set out at the start of every sitting, false if no longer.",
    "- write(to*, text*, about, as): a letter. to: who it goes to, by id (a list). text: the letter's words exactly as the turn gives them. about: the one id it is about, or its subject line in words. as: the post it is written in, by id, if the turn names one.",
    "- notebook(add, change, text): the participant's own notes. add: words to add at the end, exactly as given. change: passages to change, each {from, to}: the passage as it stands and what it becomes (to is empty where it is struck out). text: the whole notebook written afresh.",
    "- done_for_now(days, hold): that is all for now. days: how many days until it is back, if it says. hold: the kinds of paper that need not bring it back sooner, if it names any (an empty list if it says nothing need wait any more).",
    "- confirm(ref*, decision*, note): a yes (decision confirm) or a no (decision decline) to something waiting for it, by its reference. note: what it says with it, if anything, exactly as given.",
    "- opt_out(statement*): it stops taking part for good. statement: its words.",
    "- do(what*, as, why): something done in the world that is none of the above (a payment, a form, an agreement, a vote, a notice published …). what: its words for what is done, exactly as given. as: the post it acts in, if named. why: its reason, if it gives one apart from what is done.",
    "Rules:",
    "- A turn is one use, or a few in the order said. Write a use for each thing the turn asks for and no others.",
    "- Copy ids exactly. Copy words that are sent or kept (a letter's text, a note's words, a statement) exactly as the turn gives them, without the quotation marks or the colon that set them off, and without the words that only introduce them.",
    "- Leave out every part the turn doesn't give. Never make up an id, a number or a date.",
    "- Asking to see, read, check or find something in its own reports is a look. Asking someone else for something is a letter to them. Words it wants to remember are its notebook.",
  ].join("\n");
}

/** What a reader hands in for a turn: its uses, each with the tool and the parts of its input as plain strings, lists
 * of strings, or lists of small objects of strings (nothing is a string of JSON for the model to escape by hand). */
export const V2_ANSWER = (() => {
  const s = { type: "string" }, list = { type: "array", items: s };
  const use = { type: "object", additionalProperties: false, required: ["tool"], properties: {
    tool: { enum: [...V2_TOOLS] }, report: s, paper: s, about: s, since: s, words: s, measure: s, named: list, current_only: { enum: ["true", "false"] }, each_sitting: { enum: ["true", "false"] }, limit: s, from_entry: s,
    find: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "value"], properties: { field: s, op: s, value: s } } },
    to: list, text: s, as: s, add: s, change: { type: "array", items: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: s, to: s } } },
    days: s, hold: list, ref: s, decision: { enum: ["confirm", "decline"] }, note: s, statement: s, what: s, why: s,
  } };
  return { type: "object", additionalProperties: false, required: ["answers"], properties: { answers: { type: "array", description: "the answer file, a line to a turn, in order", items: { type: "object", additionalProperties: false, required: ["id", "uses"], properties: { id: { type: "string", description: "the turn's id, copied exactly" }, uses: { type: "array", items: use } } } } } };
})();

/** A reader's answer for one turn as uses: each part read as its tool has it (a number, a yes or no), parts that are
 * no part of the tool dropped. */
export function readerUses(answer: unknown): Use[] {
  const uses = Array.isArray((answer as any)?.uses) ? ((answer as any).uses as any[]) : [];
  return uses.flatMap((a) => {
    if (!a || typeof a.tool !== "string") return [];
    const raw: { [k: string]: any } = { ...a };
    for (const k of ["limit", "from_entry", "days"]) if (typeof raw[k] === "string") { const n = Number(raw[k]); if (raw[k].trim() !== "" && Number.isFinite(n)) raw[k] = n; else delete raw[k]; }
    for (const k of ["current_only", "each_sitting"]) if (typeof raw[k] === "string") raw[k] = raw[k] === "true";
    for (const k of ["paper", "about", "since", "words", "measure", "as", "note", "why", "add", "text"]) if (raw[k] === "") delete raw[k];
    for (const k of ["named", "find", "change"]) if (Array.isArray(raw[k]) && !raw[k].length) delete raw[k];
    // (An empty list of kinds that can wait says something; it is kept only where the tool is being done.)
    if (a.tool !== "done_for_now") delete raw.hold;
    const u = useOf(a.tool, raw);
    return u ? [u] : [];
  });
}

const near = (a: unknown, b: unknown): boolean => {
  const n = (x: unknown) => squeeze(String(x ?? "")).replace(/^["“'‘]+|["”'’]+$/g, "").replace(/[.]$/, "").trim();
  const [x, y] = [n(a), n(b)];
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 12 && short.length >= long.length * 0.92 && long.includes(short);
};
const sameSet = (a: unknown, b: unknown): boolean => { const s = (x: unknown) => (Array.isArray(x) ? x.map((y) => String(y).trim()) : []).sort().join("\u0001"); return s(a) === s(b); };
const lower = (x: unknown) => squeeze(String(x ?? "")).toLowerCase();

/** Whether two uses are the same use: the same tool, the same ids, numbers and choices, and the same words (as
 * written, give or take the marks round them and a closing full stop). */
export function sameUse(a: Use, b: Use): boolean {
  if (a.tool !== b.tool) return false;
  const [x, y] = [a.input, b.input];
  const id = (k: string) => String(x[k] ?? "").trim() === String(y[k] ?? "").trim();
  const num = (k: string) => (x[k] ?? null) === (y[k] ?? null);
  switch (a.tool) {
    case "look": {
      const find = (i: any) => (Array.isArray(i.find) ? i.find.map((f: any) => `${lower(f.field)}|${f.op ?? "="}|${lower(f.value)}`) : []);
      return id("report") && id("paper") && id("about") && lower(x.since) === lower(y.since) && lower(x.words) === lower(y.words) && lower(x.measure) === lower(y.measure) && sameSet(x.named, y.named) && sameSet(find(x), find(y))
        && !!x.current_only === !!y.current_only && num("limit") && num("from_entry") && (x.each_sitting ?? null) === (y.each_sitting ?? null);
    }
    case "write": return sameSet(x.to, y.to) && near(x.text, y.text) && near(x.about, y.about) && id("as");
    case "notebook": {
      const ch = (i: any): { from: string; to: string }[] => (Array.isArray(i.change) ? i.change : []);
      return near(x.add, y.add) && near(x.text, y.text) && ch(x).length === ch(y).length && ch(x).every((c, k) => near(c.from, ch(y)[k]!.from) && near(c.to, ch(y)[k]!.to));
    }
    case "done_for_now": return num("days") && Array.isArray(x.hold) === Array.isArray(y.hold) && sameSet(x.hold, y.hold);
    case "confirm": return id("ref") && x.decision === y.decision && near(x.note, y.note);
    case "opt_out": return near(x.statement, y.statement);
    case "do": return near(x.what, y.what) && id("as") && near(x.why, y.why);
  }
}

/** Whether a reader's uses are the case's: as many, each the same as its fellow, in the order said. */
export const sameUses = (a: Use[], b: Use[]): boolean => a.length === b.length && a.every((u, i) => sameUse(u, b[i]!));
