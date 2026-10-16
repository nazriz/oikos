// A participant run by a language model (docs/design/translator-and-resolver.md;
// docs/design/m2-llm-participants.md for the adapter and records).
//
// The participant lives in its world (principle 14): it reads reports in the world's
// terms and says what it does in plain words. It never sees the machinery.
// Before anything it asks for takes effect, it sees exactly what will happen
// and confirms or declines. Each wake starts from a fresh report and its own
// notebook (the only memory it carries); within a wake the exchange continues.
// What it looks at sitting after sitting it can have looked up before each one
// (set out with the report it opens on); and a sitting goes on only while
// there is something to show it.
// It can always stop taking part (VISION §15), which is not the same as
// stepping down from an office: that is an act in the world like any other.

import type { LookRequest, Observation, ParticipantAction } from "../contracts";
import type { ParticipantContext } from "../module";
import { inCurrency } from "../money";
import type { ContentBlock, LlmMessage, ToolSpec } from "./adapter";
import { CounterWatch } from "./counter";
import { callModel, ModelCallFailed, promptTooLong, type LlmIO } from "./call";
import { runDebrief, type DebriefInput, type DebriefRecord, type MockDebrief } from "./debrief";
import { wayOut, wayOutAsked } from "./framing";
import { kindSaid, LOOK_CHARS_MAX, ofKind, paperKind, NOTHING_FOUND, NOTHING_NEW, renderObservation, renderStanding, when, type Looked, type WhoIs } from "./render";

export const LLM_PARTICIPANT_VERSION = "0.18.1"; // 0.18.1: a sitting that found nothing new is back by the days it gave only while they are ahead and never after longer than its office's rhythm, and takes its turn when something falls due on its books before it would next sit (pilot 7A: a return missed after 17 days sent away); 0.18.0: the office's own file is set out at every sitting (what it sent, filed and paid, with what followed each; what came into its account; what stands open on its books), in at most 4,500 characters, by code from its own papers and accounts (behaviour/daybook.ts); 0.17.1: the day's list an office's clerk files of the cases whose day has come brings the seat back at the next sitting when a case is on it for the first time (its other papers of its own and its staff's still never do); 0.17.0: the way out in words that hold under a framing other than honest disclosure (declining to go on with the work altogether, not the same as stepping down from the office), and the exchange that asks whether it was meant, in the matching words (framing.ts; VISION 15, points 1 and 4); under honest disclosure every word is as it was; 0.16.1: a fold whose summary comes back longer than asked is asked for once more, and then kept up to the last sentence that fits, the seat told what was left out (it failed, three times of three, in the third living pilot); the limit is said in characters and words; 0.16.0: a notebook nearly full at a sitting's opening has its older, untouched notes folded into a summary in its own words (one extra, counted call, purpose "notebook"; the notes replaced stay in that call's transcript; an answer not readable or too long drops nothing and it is told); 0.15.0: its standing instructions say what confirming a draft means (what is confirmed is all that is done; what the draft does not list is not done), and an agreement on file says a worker will "come to" their place of work; 0.14.0: a sitting missed because its model did not answer is made up the next working day and said; its office's staff set out (posts, who is in each, vacancies) at its first sitting and when they change; a paper filed with its office brings it back at the next working day's sitting, a day's papers together, unless it holds that kind or is set not to be; a list is gone through a part at a time (from_entry) and every look says what was searched; a paper under one heading only, and what came by kind; an unread answer is asked for whole; a seat's own effort; 0.13.0: a request that came to nothing is put to it at once and by its own words, a notebook of 8,000 characters and told how to make room when nearly full, offices and people by their names in the world and never a participant's own id, who holds a post, figures in the papers it is shown read as a person reads them (money, days, dates, per cent), a letter whose about is not one id goes with it at its head, and nothing a seat sends is lost without a word; a look into papers answers with a list (a paper is read when asked for by its id, a long one a part at a time), one look and one whole prompt have a ceiling, a prompt its model would not take is never sent again unchanged; 0.12.0: told that a paper is named by its id, and one it cannot name is looked up first; 0.11.0: a place it is not at is gone to (someone is sent, and what they found is told when they are back); 0.10.0: who is who is looked up by name, a register someone else keeps is asked about one named thing, a board is searched (docs/design/knowing.md); 0.9.0: an answer read exactly or not at all (told and asked once more when not), a way out of the study not clearly meant is asked about; 0.8.0: looks kept ready for every sitting; no turn when nothing came of looking into whole reports; a notebook added to or changed in part

export interface LlmParticipantConfig {
  participant: string;
  entity: string;
  /** The entity's name in the world, if it has one. */
  entityName?: string;
  title?: string;
  role?: string;
  framing: { disclosure: string; system?: string; reason: string; debrief?: boolean; debrief_text?: string; tests_own_interests?: { what: string; why: string } };
  /** For the mock only: how a mock seat answers its debrief (a world's `mock.debrief`; debrief.ts). */
  mockDebrief?: MockDebrief;
  /** Reports whose items are standing documents (laws, charters, procedures). */
  standing: string[];
  /** What its reports are called (by channel path). */
  titles: Map<string, string>;
  /** Reports it reads only when it chooses to (on request). */
  onRequest?: string[];
  /** What kind of report each is (by channel path): papers ("records"), buildings and ground ("sites"), who's who
   * ("directory"), accounts, holdings. With it, the participant can look into any of the first three when it chooses
   * (what a code participant in its seat can do): search its papers, see places in full, find who's who. */
  kinds?: Map<string, string>;
  /** Which way each report reaches it (by channel path; docs/design/knowing.md): a register asked of its keeper
   * (`ask`, with the fields a question may name its subject by), a board (searched, never read through), who's who
   * (looked up by name), places gone to (`visit`). */
  ways?: Map<string, { way: string; by?: string[]; board?: boolean }>;
  cadenceDays: number;
  maxTokens?: number;
  /** Office hours (pilot 7): it deals with its business in one sitting a working day, from `start` (seconds into the day)
   * until `end`, on the first `days` days of each week; what comes in between waits for the next sitting. Absent: it
   * takes up whatever comes, whenever it comes. */
  sessions?: { start: number; end: number; days: number };
  /** The most actions one answer may hold (each carried out in turn; their results come back together). */
  maxActions?: number;
  /** How a draft awaiting confirmation reads (from the translator package). */
  draftText: (d: any) => string;
  /** Folders that hold papers of some kinds only (by channel path: the kinds, in the words a list of papers names
   * them by, such as "employment agreement"): a folder named for payroll holds payroll papers, whatever else is the
   * organisation's own. Nothing else is shown under its name, as it comes or looked up. */
  folders?: Map<string, string[]>;
  /** Who someone is in the world, by any id of theirs (render.ts, `WhoIs`): how a letter's writer and a paper's author
   * are named to the seat, and what a participant's own id (the platform's, which no seat is shown) is put as. */
  whoIs?: WhoIs;
  /** The staff of its own office, where the office employs any: its posts, who is in each, which are vacant, as it
   * stands at a time, in words (behaviour/roster.ts, from the office's own papers). Set out at its first sitting and
   * at any sitting where it has changed since it was last set out. */
  staff?: { text(t: number): string };
  /** The office's own file: what it has sent, filed and paid, what has come into its account, and what stands open on its
   * books (behaviour/daybook.ts), from its own papers and accounts, in a bounded space. Set out at every sitting. */
  dayBook?: { text(t: number): string };
  /** How hard its model reasons, where its way in takes an effort (docs/real-models.md, "Effort"): the seat's own
   * setting, sent with each of its calls. Not given: the adapter's (the model's default, or what was named with it). */
  effort?: string;
  /** Whether a paper filed with its office brings it back before the day it gave, as a letter does (true unless set):
   * at the next working day's sitting after the paper came, never at once, so that a day's papers are one sitting.
   * A real office opens its in-tray every working day. The seat can say which kinds may wait (`done_for_now`, hold). */
  wakeOnPapers?: boolean;
  /** A mock seat that sits as its code twin does: what it says it is done for is a time of the second, not days (mock.ts). */
  exactBack?: boolean;
  /** Its office's in-trays (by channel path): its own papers of some kinds only (`true`: whatever comes there; a list:
   * those kinds, as a folder holds them), and the folders that hold every paper of its organisation's (`all`), where
   * only what is addressed to its own post, or comes from outside an organisation with no in-tray, is its to open. */
  /** (`sole`: its office is its organisation's only one, a landlord's letting office say: a paper someone else
   * addresses to the organisation is then this office's post, as one addressed to its post by name is.) */
  trays?: { kinds: Map<string, string[] | true>; all: Set<string>; sole?: boolean };
  /** Whose papers are its office's own doing (itself; its staff's post): never what brings it back. */
  ownAuthors?: string[];
  /** The most one prompt may come to, in characters (the system prompt and everything shown): `PROMPT_MAX` unless set. */
  promptMax?: number;
}

/** The most one prompt comes to, in characters, whatever a seat looked up: what is over is left out, the oldest of what
 * it looked up first, with a line saying so (and noted in the log). A model is never sent more than it can take. */
export const PROMPT_MAX = 150_000;
/** The least a prompt's ceiling is brought down to when a model says a prompt was too long for it. */
export const PROMPT_MIN = 12_000;
/** What stands where a look's result was, once it has been left out. */
export const LOOK_LEFT_OUT = "(What this look showed is no longer set out here: there was more than can be read at once, and the oldest of what you looked up was left out first. Look again for what you need.)";
const LOOKED_SECTION = /^## (Looked up for you|.*: (what you looked up|what you looked at|who you looked for|what was found there|the paper |new since you last looked))/;

/**
 * A prompt within the most one may come to. What is over is left out in this order, each with a line saying so: the
 * results of looks, the oldest first; then, of what was set out in words, the parts that were looked up, then the other
 * parts, the oldest first (the opening lines, with the notebook, stay); and only if that is not enough, the longest
 * text is cut. `left`: what was left out, if anything was.
 */
export function fitPrompt(system: string, messages: LlmMessage[], max: number, looks: ReadonlySet<string>): { system: string; messages: LlmMessage[]; characters: number; left?: { looks: number; parts: number; cut: boolean; characters_before: number } } {
  const len = (c: ContentBlock) => (c.type === "text" ? c.text.length : c.type === "tool_result" ? c.content.length : JSON.stringify(c.input ?? {}).length + c.name.length);
  const size = (sys: string, ms: LlmMessage[]) => sys.length + ms.reduce((a, m) => a + (typeof m.content === "string" ? m.content.length : m.content.reduce((b, c) => b + len(c), 0)), 0);
  const before = size(system, messages);
  if (before <= max) return { system, messages, characters: before };
  let ms = messages.map((m) => ({ ...m, content: typeof m.content === "string" ? m.content : m.content.map((c) => ({ ...c })) })) as LlmMessage[];
  let now = before;
  const left = { looks: 0, parts: 0, cut: false, characters_before: before };
  // 1. What looks showed, the oldest first.
  for (const m of ms) {
    if (typeof m.content === "string") continue;
    for (const c of m.content) {
      if (now <= max) break;
      if (c.type !== "tool_result" || !looks.has(c.tool_use_id) || c.content.length <= LOOK_LEFT_OUT.length) continue;
      now -= c.content.length - LOOK_LEFT_OUT.length;
      c.content = LOOK_LEFT_OUT;
      left.looks++;
    }
  }
  // 2. Of what was set out in words: the parts that were looked up, then the rest, the oldest first.
  const shed = (textOf: string, only: boolean): string => {
    const parts = textOf.split("\n\n## ").map((x, n) => (n ? `## ${x}` : x));
    const out: string[] = [];
    let dropped = 0;
    for (const [n, x] of parts.entries()) {
      if (n > 0 && now > max && (!only || LOOKED_SECTION.test(x)) && !x.startsWith("## Waiting for you to confirm") && !x.startsWith("## Letters")) {
        now -= x.length + 2;
        dropped++;
        if (dropped === 1) out.push("\u0000");
      } else out.push(x);
    }
    if (!dropped) return textOf;
    left.parts += dropped;
    const line = `(Left out here, so that this is not more than can be read at once: ${dropped} ${dropped === 1 ? "part" : "parts"} of what you had ${only ? "looked up" : "looked up or been shown"}. Look again for what you need.)`;
    now += line.length + 2;
    return out.map((x) => (x === "\u0000" ? line : x)).join("\n\n");
  };
  for (const only of [true, false]) {
    for (const m of ms) {
      if (now <= max) break;
      if (typeof m.content === "string") m.content = shed(m.content, only);
      else for (const c of m.content) {
        if (c.type === "text") c.text = shed(c.text, only);
        else if (c.type === "tool_result" && !only) c.content = shed(c.content, only);
      }
    }
  }
  // 3. Still over (one part longer than everything allowed): the longest text is cut, and then what is on file.
  const cutNote = "\n(Cut short here: there was more than can be read at once. Look again for what you need.)";
  for (let guard = 0; now > max && guard < 64; guard++) {
    let best: { get: () => string; set: (s: string) => void } | undefined;
    for (const m of ms) {
      const cands: { get: () => string; set: (s: string) => void }[] = typeof m.content === "string" ? [{ get: () => m.content as string, set: (s) => void (m.content = s) }]
        : m.content.flatMap((c) => (c.type === "text" ? [{ get: () => c.text, set: (s: string) => void (c.text = s) }] : c.type === "tool_result" ? [{ get: () => c.content, set: (s: string) => void (c.content = s) }] : []));
      for (const c of cands) if (!best || c.get().length > best.get().length) best = c;
    }
    if (!best || best.get().length <= cutNote.length + 200) break;
    const was = best.get();
    const keep = Math.max(200, was.length - (now - max) - cutNote.length);
    best.set(was.slice(0, keep) + cutNote);
    now -= was.length - keep - cutNote.length;
    left.cut = true;
  }
  let sys = system;
  if (now > max && sys.length > cutNote.length + 200) {
    const keep = Math.max(200, sys.length - (now - max) - cutNote.length);
    now -= sys.length - keep - cutNote.length;
    sys = sys.slice(0, keep) + cutNote;
    left.cut = true;
  }
  return { system: sys, messages: ms, characters: size(sys, ms), left };
}

/** The capacity an act is done in: a post it holds, or (left out) itself. */
const AS = { type: "string", description: "If you hold a post: the post you're acting in, by its id. Leave it out to act as yourself." };

/** The reports it can look into when it chooses, and what kind each is: those it only reads on request (papers,
 * unless said otherwise), and, where the kinds are known, its papers, its buildings and ground, and who's who.
 * (Not what's on file: it has those whole already.) */
export function lookable(c: LlmParticipantConfig): Map<string, "records" | "sites" | "directory"> {
  const m = new Map<string, "records" | "sites" | "directory">();
  for (const id of c.onRequest ?? []) m.set(id, "records");
  for (const [id, kind] of c.kinds ?? []) {
    if (kind !== "records" && kind !== "sites" && kind !== "directory") m.delete(id);
    else if (!c.standing.includes(id) || c.onRequest?.includes(id)) m.set(id, kind);
  }
  return m;
}

/** What a participant calls the places in a paper it can search by, and what the participant API calls them (which it
 * may use too): it reads "from", "citing" and dates in its reports, never the store's field names (principle 14). */
const FIELD_WORDS: { [said: string]: string } = { from: "author", "on behalf of": "speaks_for", on_behalf_of: "speaks_for", citing: "basis", date: "at" };
const FIELD = /^(id|record|kind|at|author|speaks_for|basis|claim|holder|(data|about)(\.[A-Za-z0-9_-]+)+)$/;
/** What a register is asked by, in a participant's words. */
const BY_WORDS: { [field: string]: string } = { id: "id (its own number)", claim: "claim (the title a dealing is in)", holder: "holder (whose it is)", speaks_for: "on behalf of", "about.object": "about.object (what it is a title to)", "data.cells": "detail.cells (a cell of its ground, such as cell.3.4)" };
/** How many names one look-up of who's who takes (the participant API's: a look names up to 16 things). */
const WHO_MAX = 16;
/** How many places one going takes in (the contract's). */
const VISIT_MAX = 16;
/** The most a look lists at once (papers found, a line each), and the most whoever keeps papers gives to one search
 * (the participant API's limit): what is asked for when a list is narrowed here, by what a search cannot be asked. */
const LOOK_MAX = 50;
const SEARCH_MAX = 200;
/** What a paper is, where it is not a statement: what a search is asked for when a kind is one of these words. */
const RECORD_WORDS: { [said: string]: string } = { agreement: "agreement", claim: "claim", signature: "signature", notice: "notice", withdrawal: "withdrawal", vote: "vote", "claim transfer": "claim_transfer", "claim release": "claim_release", declaration: "entity_declaration" };

/** A kind of paper as a seat says it ("employment agreement", "invoices", "ownership claim"), as a search can be asked
 * for it, as nearly as it can: a statement by its kind, an agreement or a claim as such (which agreement, by what it
 * is for, is told from the list: `here`). A guess that finds nothing is followed by a look through the folder's latest
 * papers for kinds like it, so nothing rests on the guess being right. */
export function kindWhere(said: string): { where: Where[]; here: boolean } {
  const k = kindSaid(said);
  if (RECORD_WORDS[k]) return { where: [{ field: "record", op: "=", value: RECORD_WORDS[k]! }], here: false };
  const of = /^(.+) (agreement|claim)$/.exec(k);
  if (of?.[2] === "agreement") return { where: [{ field: "record", op: "=", value: "agreement" }], here: true };
  if (of?.[2] === "claim") return { where: [{ field: "record", op: "=", value: "claim" }, { field: "about.kind", op: "=", value: of[1]!.replace(/ /g, "_") }], here: false };
  return { where: [{ field: "kind", op: "=", value: plainKind(said) }], here: false };
}
/** A statement's kind as the records write it: lower case, an underscore between words. */
const plainKind = (said: string) => said.trim().toLowerCase().replace(/[\s-]+/g, "_");
type Op = "=" | "!=" | "<" | "<=" | ">" | ">=";
const OPS: Op[] = ["=", "!=", "<", "<=", ">", ">="];
const DAYS_IN_YEAR = 365;
type Where = { field: string; op: Op; value: string | number | boolean };

/** One thing to find, as the participant API's search takes it; or why it can't be read. A date is written as the
 * reports write it ("year 1, day 12", "day 12" of the first year, or "year 2"), and stands for the whole day or year. */
export function condition(w: any): Where[] | string {
  if (!w || typeof w !== "object" || typeof w.field !== "string") return "something to find didn't say where to look";
  const said = w.field.trim();
  const lower = said.toLowerCase();
  const field = FIELD_WORDS[lower] ?? (lower.startsWith("detail.") ? `data.${said.slice(7)}` : said);
  if (!FIELD.test(field)) return `"${said.slice(0, 40)}" isn't something papers can be found by`;
  if (!["string", "number", "boolean"].includes(typeof w.value)) return `what to find under "${said.slice(0, 40)}" couldn't be read`;
  if (w.op !== undefined && !OPS.includes(w.op)) return `"${String(w.op).slice(0, 10)}" isn't a way to compare`;
  const op: Op = w.op ?? "=";
  if (field !== "at" || (lower === "at" && typeof w.value === "number")) return [{ field, op, value: w.value }];
  const m = typeof w.value === "string" ? /^\s*(?:year\s*(\d{1,6}))?\s*,?\s*(?:day\s*(\d{1,3}))?\s*$/i.exec(w.value) : null;
  if (!m || (m[1] === undefined && m[2] === undefined)) return 'a date is written like "year 1, day 12"';
  const year = Number(m[1] ?? 1), day = m[2] === undefined ? undefined : Number(m[2]);
  if (year < 1 || (day !== undefined && (day < 1 || day > DAYS_IN_YEAR))) return 'a date is written like "year 1, day 12"';
  const start = ((year - 1) * DAYS_IN_YEAR + ((day ?? 1) - 1)) * 86_400;
  const end = start + (day === undefined ? DAYS_IN_YEAR : 1) * 86_400;
  const at = (o: Op, value: number): Where => ({ field: "at", op: o, value });
  return op === "=" ? [at(">=", start), at("<", end)] : op === "<" ? [at("<", start)] : op === "<=" ? [at("<", end)] : op === ">" ? [at(">=", end)] : op === ">=" ? [at(">=", start)]
    : "a date can be matched with =, <, <=, > or >=, not with !=";
}

/** Its tools: what it can do, in its own terms. The contract's actions are underneath. */
export function tools(c: LlmParticipantConfig): ToolSpec[] {
  const reports = lookable(c);
  const named = (kind: string) => [...reports].filter(([, k]) => k === kind).map(([id]) => `"${c.titles.get(id) ?? id}" (${id})`).join(", ");
  const [papers, people] = [named("records"), named("directory")];
  // Places: those it is at (shown, and looked into), and those it has to send someone to (nothing until it does).
  const sites = [...reports].filter(([, k]) => k === "sites").map(([id]) => ({ id, name: `"${c.titles.get(id) ?? id}" (${id})`, visit: c.ways?.get(id)?.way === "visit" }));
  const places = sites.filter((x) => !x.visit).map((x) => x.name).join(", ");
  const elsewhere = sites.filter((x) => x.visit).map((x) => x.name).join(", ");
  const registers = [...reports].filter(([id]) => c.ways?.get(id)?.way === "ask" && reports.get(id) === "records")
    .map(([id]) => `"${c.titles.get(id) ?? id}" (${id}): say which one, by ${(c.ways!.get(id)!.by ?? ["id"]).map((f) => BY_WORDS[f] ?? f).join(" or ")}`).join("; ");
  const lookWords = [
    c.kinds ? `Look into one of your reports yourself${elsewhere ? ", or send someone to go and see a place" : ""}, when you choose.` : `Look at one of the reports you only read when you choose to: ${papers}.`,
    "You'll see what's there with your next report.",
    `What you look at sitting after sitting can be set out for you at the start of each, without your asking again: look at it once with each_sitting (up to ${READY_MAX} at a time; with each_sitting false, no longer).`,
    "If all you do in an answer is look into reports whole (nothing to find, no one and nothing named), and there's nothing in any of them, the sitting ends there: you're told so at your next, which comes after the days you last gave. Anything you mean to do whatever they hold, do in the same answer.",
    ...(papers ? [`${c.kinds ? `Papers and filings: ${papers}. ` : ""}A look into papers answers with a list, newest first: each paper's id, what it is, its date, who it is from, and a line of what it says. To narrow it, say what to find: those where something matches (kind in plain words, such as employment agreement; from; on behalf of; citing; date as "year 1, day 12"; or detail.<name> for one of a paper's details, e.g. detail.employer), those since a date, those about something (an id the paper names: a person, an account, a lot, another paper), or those with certain words in them. To read one paper in full, give its id in paper. A very long paper (a register, a map) is read a part at a time: its entries from the one you give on, or only those with the words you give. One look shows at most ${LOOK_CHARS_MAX.toLocaleString("en")} characters.`] : []),
    ...(places ? [`Buildings and ground: ${places}. Name the places to see in full as they are today (a building, a room, a piece of ground, or a kind of building); or name a measure the report gives, to see every building where it's above zero or rising, the highest first.`] : []),
    ...(elsewhere ? [`Places you are not at: ${elsewhere}. Nobody is shown them: name where to send someone (a building by its id, or a piece of ground by its cell, such as cell.3.4; a lot's cells are on its plan), up to ${VISIT_MAX} at a time. Going takes your office's time (the way there and back, and the time to look), and you're shown what was there with the report after they're back.`] : []),
    ...(people ? [`Who's who: ${people}. Nobody is shown it: name who you're looking for (a person or an organisation by its id or full name; a post by its id, its title or what it is, such as mayor), up to ${WHO_MAX} at a time, and you're told who they are.`] : []),
    ...(registers ? [`Registers someone else keeps: ${registers}. Each answers a question about one named thing, never a list of everything.`] : []),
  ].join(" ");
  // The way out, in the words that hold under the run's framing (framing.ts; VISION 15, point 4).
  const leave = wayOut(c.framing.disclosure).option;
  return [
    { name: "do", description: "Say what you do, in plain words, one thing at a time, naming what you're using (amounts, accounts, lots, people, papers) by the ids in your reports, and any record it rests on (the permit, the budget, the papers that back it) by its id too. A paper is named by its id: one you can't name is looked up first, and then asked about by its id. Before it takes effect you'll see exactly what will happen, and confirm or decline. It's for doing things in the world, not for reading or asking: to look something up use look (if you have files to look in), and to ask someone something, write to them." + (elsewhere ? " To find out how a place stands, send someone to go and see it: that is a look too." : ""),
      input_schema: { type: "object", required: ["what"], properties: { what: { type: "string" }, as: AS, why: { type: "string", description: "Why (optional; kept on record)." } } } },
    { name: "confirm", description: "Confirm or decline something waiting for you to confirm, by its reference.",
      input_schema: { type: "object", required: ["ref", "decision"], properties: { ref: { type: "string" }, decision: { enum: ["confirm", "decline"] }, note: { type: "string" } } } },
    { name: "write", description: "Write to people or organisations, by id. The words go exactly as you write them. If the letter is about one thing that has an id (a paper, an account, a lot), give that id as about, and the letter is filed as about it. If what it is about is anything else (some words, or several things), say so in about all the same: it is put at the head of the letter as its subject line, and the letter is sent.",
      input_schema: { type: "object", required: ["to", "text"], properties: { to: { type: "array", items: { type: "string" } }, text: { type: "string" }, as: AS, about: { type: "string", description: "What it's about (optional): one id, or a subject line in words." } } } },
    { name: "done_for_now", description: c.sessions && c.wakeOnPapers !== false && c.trays
        ? `That's all for now. You're back after the given number of days, at that day's sitting (given none: after ${c.cadenceDays}); sooner if someone writes to you (the next sitting), or if a paper is filed with your office (an application, a proposal, a complaint, a notice: whatever comes into its in-tray), which brings you back at the next working day's sitting after it comes, a day's papers together. If a kind of paper can wait for the sitting you've set, name it in hold, as your reports name it (complaint, say): those kinds then wait, from now on, until you give hold again (an empty list: nothing waits). You can use it alongside other actions: they're done, and you'll see how they went when you're back.`
        : c.sessions
        ? `That's all for now. You're back after the given number of days, at that day's sitting (given none: after ${c.cadenceDays}); sooner, at the next sitting, if someone writes to you (a letter: a paper filed with your office, a vote or a notice does not bring you back sooner, so give fewer days when you are waiting on one). You can use it alongside other actions: they're done, and you'll see how they went when you're back.`
        : "That's all for now. You'll be back after the given number of days, or sooner if someone writes to you. You can use it alongside other actions: they're done, and you're back after the days given, when you'll see how they went.",
      input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1 }, ...(c.sessions && c.wakeOnPapers !== false && c.trays ? { hold: { type: "array", maxItems: 32, items: { type: "string" }, description: "Kinds of paper that need not bring you back early: they wait for the sitting you have set. It stands until you give it again; an empty list: nothing waits." } } : {}) } } },
    { name: "notebook", description: `Your notebook: the only thing you'll remember from one sitting to the next. It holds ${NOTEBOOK_MAX.toLocaleString("en")} characters. Add to it, change or strike out a passage of it, or write it all out afresh; what you don't touch stays as it is. What wouldn't fit isn't put in, and you're told: to make room, strike out what is settled (change the passage to nothing), or write it all afresh, shorter. Use it alongside your actions.`,
      input_schema: { type: "object", properties: {
        add: { type: "string", description: "Words to add at the end, on a new line." },
        change: { type: "array", maxItems: 8, description: "Passages to change, each where it stands.", items: { type: "object", required: ["from", "to"], properties: {
          from: { type: "string", description: "The passage as it stands in your notebook, word for word (enough of it to be the only one)." },
          to: { type: "string", description: "What it should say instead; empty to strike it out." } } } },
        text: { type: "string", maxLength: NOTEBOOK_MAX, description: "The whole notebook, written afresh: it replaces everything there." } } } },
    { name: "opt_out", description: leave, input_schema: { type: "object", required: ["statement"], properties: { statement: { type: "string" } } } },
    ...(reports.size
      ? [{ name: "look", description: lookWords,
          input_schema: { type: "object", required: ["report"], properties: {
            report: { enum: [...reports.keys()] },
            ...(papers ? {
              current_only: { type: "boolean", description: "Papers: only what's still current (not withdrawn by whoever put it up)." },
              find: { type: "array", maxItems: 8, description: "Papers: only those where each of these holds.", items: { type: "object", required: ["field", "value"], properties: {
                field: { type: "string", description: "kind, from, on behalf of, citing, date, id, or detail.<name>" },
                op: { enum: OPS, description: "= if not given" },
                value: { anyOf: [{ type: "string" }, { type: "integer" }, { type: "boolean" }] } } } },
              paper: { type: "string", description: "Papers: one paper's id, to read that paper in full." },
              from_entry: { type: "integer", minimum: 1, description: "A list (papers found, buildings): the entry to start from, to go on from where the last look stopped, as its answer says. With paper: for a very long paper, the entry to start from." },
              about: { type: "string", description: "Papers: only those that name this id (a person, an organisation, an account, a lot, another paper)." },
              since: { type: "string", description: 'Papers: only those from this date on, as "year 1, day 12".' },
              words: { type: "string", description: "Papers: only those with these words in them; with paper, only that paper's entries with them." } } : {}),
            ...(places || people || elsewhere ? { named: { type: "array", maxItems: 40, items: { type: "string" }, description: [places ? "Buildings and ground: the places to see in full." : "", elsewhere ? "Places you are not at: where to send someone." : "", people ? "Who's who: who to find." : ""].filter(Boolean).join(" ") } } : {}),
            ...(places ? { measure: { type: "string", description: "Buildings and ground: a measure, as the report names it; every building where it's above zero or rising is listed." } } : {}),
            limit: { type: "integer", minimum: 1, maximum: LOOK_MAX, description: "At most this many (20 if not given)." },
            each_sitting: { type: "boolean", description: "true: from now on this is also looked up for you at the start of every sitting, and set out with your report. false: no longer (nothing is looked up now); with only the report named, nothing in that report is." } } } }]
      : []),
  ];
}

/**
 * What confirming a draft means, in the seat's standing instructions (the coordinator's decision, 2026-10-11;
 * docs/decisions.md, "What a seat confirms is all that is done"). A seat shown a draft that did part of what it asked
 * confirmed it, because the part was right: 15 of 15 payments whose report was missing, with either preview. With
 * this sentence its note names what is missing in 10 to 12 of 15 (runs/preview-replay-2026-10-11).
 */
export const CONFIRMING = "What you confirm is all that is done. Anything you asked for that the draft does not list among the things it does is not done: decline, or confirm and ask for the rest.";

export function systemPrompt(c: LlmParticipantConfig, standing: string): string {
  return [
    c.framing.system ?? "",
    "",
    `You are ${c.title ?? c.participant}, acting for ${c.entityName && c.entityName !== c.entity ? `${c.entityName} (${c.entity})` : c.entity}.`,
    `To do something, say what you do in plain words, and name what you're using: the amount, the account, the lot, the people, the papers. Your reports show each thing's id in brackets or after its name. Before anything takes effect, you'll see exactly what will happen, and confirm or decline it. ${CONFIRMING} You can also write to people directly.`,
    `You can take several actions at once (up to ${c.maxActions ?? 8}): they're carried out in the order you give them, and you'll see how each went together, afterwards. So act on what you already know in one go; anything that depends on the result of an action (confirming a draft you haven't seen yet) waits for the next turn. Keep your notebook alongside: add to it or change a passage, rather than writing it all out again.`,
    ...(c.sessions ? [`You work office hours: one sitting each working day, when you deal with everything that's come in since the last.`] : []),
    ...(standing ? ["", "On file:", standing] : []),
  ].join("\n").trim();
}

export interface LlmController {
  step(obs: Observation, ctx: ParticipantContext): Promise<ParticipantAction>;
  /** The debrief when the run ends (VISION 15, point 7; debrief.ts): the fixed interview, with what the run's log
   * shows of what it did. Every call is logged; the whole of it is written as one `debrief` annotation. */
  debrief(d: DebriefInput): Promise<DebriefRecord>;
}

type Use = Extract<ContentBlock, { type: "tool_use" }>;
/** A participant's own id as worlds are generated (an office's system, a person's own seat): a word of the platform's. */
const PLATFORM_ID = /(?<![A-Za-z0-9_-])[a-z][a-z0-9_-]{0,56}-(?:system|self)(?![A-Za-z0-9_-])/g;
/** The most a letter, a request or a note can run to (the contracts' limit on free text), and the most a letter goes to. */
export const TEXT_MAX = 16_384;
const TO_MAX = 64;
/** Whether something is written as an id (the contracts' forms: one a world gives, one made in the run, a cell of
 * ground, a room of a building): only that can be a letter's reference or whom it goes to. */
export const isId = (s: string) => /^([a-z][a-z0-9_-]{0,63}|(ent|acc|str|rec|act|msg|par|pos|cnd)\.[0-9]{1,15}|cell\.[0-9]{1,6}\.[0-9]{1,6}|([a-z][a-z0-9_-]{0,63}|str\.[0-9]{1,15})\/[a-z][a-z0-9_-]{0,63}\.[0-9]{1,6})$/.test(s);
/** An id as written: without the square brackets a report shows it in, and out of the form a report names someone
 * in, "Name (id)" (a seat is shown "Town of Millbrook (city)", and wrote to exactly that: 2026-10-09). */
const bare = (s: string) => {
  const t = s.trim().replace(/^\[(.*)\]$/, "$1").trim();
  const named = /\(\s*\[?([^()\[\]\s]+)\]?\s*\)$/.exec(t);
  return named && !isId(t) && isId(named[1]!) ? named[1]! : t;
};
/** The look that follows one for a kind of paper that found nothing: the folder's latest, looked through for kinds like it. */
type Follow = { said: string; action: ParticipantAction; looked: [string, Looked] };
const text = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const quote = (s: string, max = 80) => `"${s.length > max ? `${s.slice(0, max)}…` : s}"`;

/** The most a notebook holds, and the most of what came in between sittings that's set out at the next. */
export const NOTEBOOK_MAX = 8000;
/** From this much used, a seat is told its notebook is nearly full, and how to make room, before anything is refused for room. */
export const NOTEBOOK_NEARLY = 6000;
/** What a seat is told of its notebook's room, with the notebook: how much is used, and from nearly full how to make room. */
export const notebookRoom = (used: number) => `(${used.toLocaleString("en")} of the ${NOTEBOOK_MAX.toLocaleString("en")} characters it holds are used${used >= NOTEBOOK_NEARLY ? `: it is nearly full, with ${(NOTEBOOK_MAX - used).toLocaleString("en")} left. To make room before something won't fit, strike out what is settled (change the passage to nothing), or write the notebook afresh, shorter` : ""}.)`;

/** An entry of the notebook is a line of it: the unit whose age is kept. */
const entries = (t: string) => t.split("\n");
/** The time each line of a notebook was written or last changed, after a use of it. A line identical to one before keeps
 * that line's time (the earliest such line first), so writing the notebook afresh with the old lines in it leaves them
 * their age; any other line is as old as `t`. */
export function notebookAges(was: string, ages: number[], now: string, t: number): number[] {
  const before = entries(was);
  const left = new Map<string, number[]>();
  before.forEach((l, i) => { const a = left.get(l) ?? []; a.push(ages[i] ?? t); left.set(l, a); });
  return entries(now).map((l) => left.get(l)?.shift() ?? t);
}
/** The least a fold is worth asking for, in characters of older notes. */
export const FOLD_LEAST = 600;
/** Which lines are older entries to fold: those not touched since the oldest times, taken by the time they stand from
 * (never the newest time: that is what was written last, and stays) until they come to half of the notebook or there
 * are no more. `undefined` if they come to less than FOLD_LEAST. */
export function foldPlan(lines: string[], ages: number[]): { fold: number[]; upTo: number; chars: number; limit: number } | undefined {
  const times = [...new Set(lines.map((_, i) => ages[i]!))].sort((a, b) => a - b);
  if (times.length < 2) return undefined;
  const total = lines.join("\n").length;
  const fold: number[] = [];
  let chars = 0, upTo = times[0]!;
  for (const when of times.slice(0, -1)) {
    for (let i = 0; i < lines.length; i++) if (ages[i] === when) { fold.push(i); chars += lines[i]!.length + 1; }
    upTo = when;
    if (chars * 2 >= total) break;
  }
  fold.sort((a, b) => a - b);
  chars -= 1;
  return chars >= FOLD_LEAST ? { fold, upTo, chars, limit: Math.max(300, Math.floor(chars / 4)) } : undefined;
}
/** A text kept as far as the last sentence that ends within `limit` characters (a full stop, question or exclamation
 * mark, semicolon or line end, followed by a space or the end); "" if no sentence of it ends within them. */
export function trimAtSentence(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit + 1);
  let end = -1;
  for (const m of head.matchAll(/[.!?;](?=\s)|\n/g)) end = m[0] === "\n" ? m.index! : m.index! + 1;
  return end > 0 ? text.slice(0, end).trimEnd() : "";
}
const dayOf = (t: number) => Math.floor(t / 86_400) + 1;
export const CARRY_MAX = 40_000;

/** A notebook as one use of it leaves it: written afresh (`text`), passages changed where they stand (`change`), words
 * added at the end (`add`), in that order; whatever a use leaves alone stays as it was. `problems`: each part that
 * wasn't done, and why, in words (the rest is). Nothing is ever put in that doesn't fit, or cut to fit, except a whole
 * notebook written too long: its start is kept (`cut`), as before. `read`: false if nothing in the use could be read. */
export function editNotebook(was: string, i: any): { text: string; problems: string[]; cut?: { length: number; kept: number }; read: boolean } {
  const problems: string[] = [];
  let now = was;
  let cut: { length: number; kept: number } | undefined;
  const changes: unknown[] = Array.isArray(i?.change) ? i.change : i?.change && typeof i.change === "object" ? [i.change] : [];
  const read = typeof i?.text === "string" || typeof i?.add === "string" || changes.length > 0;
  if (typeof i?.text === "string") {
    now = i.text.slice(0, NOTEBOOK_MAX);
    if (i.text.length > NOTEBOOK_MAX) cut = { length: i.text.length, kept: NOTEBOOK_MAX };
  }
  for (const ch of changes as any[]) {
    if (!text(ch?.from) || typeof ch?.to !== "string") {
      problems.push("a change couldn't be read (it gives a passage as it stands, and what it should say instead)");
      continue;
    }
    const at = now.indexOf(ch.from);
    if (at < 0) problems.push(`it doesn't say ${quote(ch.from, 60)} (a passage to change is given word for word)`);
    else if (now.indexOf(ch.from, at + 1) >= 0) problems.push(`it says ${quote(ch.from, 60)} more than once (give more of the passage)`);
    else if (now.length - ch.from.length + ch.to.length > NOTEBOOK_MAX) problems.push(`changing ${quote(ch.from, 60)} would make it ${now.length - ch.from.length + ch.to.length} characters, and it holds ${NOTEBOOK_MAX}`);
    else {
      // Striking out a whole line leaves no empty line behind.
      const end = at + ch.from.length;
      const wholeLine = ch.to === "" && now[end] === "\n" && (at === 0 || now[at - 1] === "\n");
      now = now.slice(0, at) + ch.to + now.slice(wholeLine ? end + 1 : end);
    }
  }
  if (text(i?.add)) {
    const added = now ? `${now}\n${i.add}` : i.add;
    if (added.length > NOTEBOOK_MAX) problems.push(`there wasn't room to add ${quote(i.add, 60)}: it holds ${NOTEBOOK_MAX} characters and has ${now.length}, so ${Math.max(0, NOTEBOOK_MAX - now.length - (now ? 1 : 0))} are free (strike something out, or write it afresh, shorter)`);
    else now = added;
  }
  return { text: now, problems, ...(cut ? { cut } : {}), read };
}

/** The most looks kept ready for every sitting. */
export const READY_MAX = 6;
/** What a look is, whatever else was said with it: the same look asked for again is the same. */
const lookKey = (i: any) => JSON.stringify([i.report, i.find ?? null, !!i.current_only, i.named ?? null, i.measure ?? null, i.limit ?? null, i.paper ?? null, i.from_entry ?? null, i.about ?? null, i.since ?? null, i.words ?? null]);
/** A report, cut where its sections begin (the first: its opening lines). */
const sections = (b: string) => b.split("\n\n## ").map((x, n) => (n ? `## ${x}` : x));
/** The longest statement recorded with an opt-out (the contracts' limit on free text). */
const STATEMENT_MAX = 16_384;

/** The words given with an opt-out, however they came: as asked, as the raw text of an input that couldn't be read, or
 * whatever else was given; empty if nothing was. Opting out never depends on its wording (VISION §15). */
export function optOutStatement(input: unknown): string {
  const i = input as any;
  const said = typeof input === "string" ? input
    : typeof i?.statement === "string" ? i.statement
    : text(i?._unparsed) ? i._unparsed
    : i && typeof i === "object" && Object.keys(i).length ? JSON.stringify(i)
    : "";
  return said.slice(0, STATEMENT_MAX);
}

/** Why an answer could not be read (an adapter marks one so), or undefined if it could. */
const unreadWhy = (content: ContentBlock[]): string | undefined => content.find((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text" && b.unread !== undefined)?.unread;
const unreadText = (content: ContentBlock[]): string => content.map((b) => (b.type === "text" ? b.text : "")).join("\n").slice(0, 2000);
/** An answer as the conversation keeps it: without the mark an adapter put on it. */
const plain = (content: ContentBlock[]): ContentBlock[] => content.map((b) => (b.type === "text" ? { type: "text" as const, text: b.text } : b));

/** What a statement is when it is nothing: filler in the place of words ("x", "...", "todo"). */
const NO_WORDS = /^\W*(?:x+|\.{2,}|…+|todo|tbd|placeholder|n\/?a|none|null|undefined|string|statement|test)?\W*$/i;
/** Whether an opt-out is clearly meant (VISION §15: leaving is the seat's own act, and is never taken from a misreading).
 * It is, if the seat gave words of its own with it (not empty, not filler) and it did not say in the same answer that it
 * would be back (done for now) or ask for things in the world that need it to stay (do, confirm, look). A letter or
 * the notebook beside it is a farewell, and does not contradict it. Anything else is not clear, and the seat is asked. */
export function optOutMeant(use: Use, uses: Use[]): boolean {
  const said = use.input?.statement;
  if (!text(said) || NO_WORDS.test(said) || !/\p{L}{2}/u.test(said)) return false;
  return !uses.some((u) => u.name === "done_for_now" || u.name === "do" || u.name === "confirm" || u.name === "look");
}

export function createLlmParticipant(c: LlmParticipantConfig, io: LlmIO): LlmController {
  const standingIds = new Set(c.standing);
  const toolset = tools(c);
  let notes = "";
  let ages: number[] = [0]; // when each line (entry) of the notebook was written or last changed
  let foldWait = 0; // sittings to pass before a fold that could not be done is asked for again
  // What it did, as recorded, for its debrief (it has no other memory of the run: pilot 9's mayor couldn't say).
  // (Letters: those that went, by what came back from sending each, beside those it wrote.)
  const tally = { requests: 0, confirmed: 0, declined: 0, letters: 0, written: 0, looks: 0, first: -1, last: -1 };
  let sending = false; // the action just carried out was a letter (the next report says whether it went)
  // Requests of the last answer that came to nothing, by use (what it is asked back), and whether this sitting has
  // already gone on once for one.
  const askedBack = new Map<string, string[]>();
  let stayed = false;
  let messages: LlmMessage[] = [];
  // The last answer's tool uses (the APIs need a result for every one): each action's result is the report after it.
  let pending: { id: string; name: string }[] = [];
  // Actions from the last answer still to carry out, in order, and the reports seen after each one carried out.
  let queue: { id: string; action: ParticipantAction; label?: string; looked?: [string, Looked]; kindSaid?: Follow; follows?: string }[] = [];
  // A look for a kind of paper, just made: if it found nothing, the folder's latest papers are looked through next.
  let kindLook: Follow | undefined;
  let queueFollowed: string | undefined; // the use whose look the action just carried out goes on with
  // The uses of this sitting that were looks (what they showed is the first to be left out of a prompt too long).
  const lookIds = new Set<string>();
  // The most a prompt may come to: brought down when the model says one was too long for it.
  let promptMax = c.promptMax ?? PROMPT_MAX;
  const cutLooks: { report: string; characters: number; limit: number }[] = [];
  // The reports it can look into, and what it asked to see in the one it just looked at (the next report sets it out).
  const reports = lookable(c);
  const canLook = new Set(reports.keys());
  let lastLooked: Map<string, Looked> | undefined;
  const results = new Map<string, string>();
  // Looks it asked to have ready at every sitting (its `look` with each_sitting), as it gave them: made when a sitting
  // opens, before it's asked anything, and set out with the report it opens on. `opening`: one opening that way now.
  let ready: { key: string; input: any }[] = [];
  let opening: { body: string; before: { open: boolean; sittingDay: number; mail: boolean } } | undefined;
  // The looks of its last sitting and of this one (one made at both is one it might have kept ready: it's told so).
  let lookedLast = new Set<string>();
  let lookedNow = new Set<string>();
  // Said with a use's result, after it (that a look is kept ready from now on), and in place of one where nothing was
  // carried out (that a look is no longer); and whether a look's result held nothing it hasn't been shown.
  const after = new Map<string, string>();
  const said = new Map<string, string>();
  const quiet = new Map<string, boolean>();
  // The last answer only looked into whole reports (and wrote in its notebook): if nothing is in any, no turn follows.
  let trays = false;
  let lastDays: number | undefined; // the days it last gave with done for now (none: its usual rhythm)
  // The days things stand due on its office's books (the newest paper of them its own clerk filed): a return, a bill.
  // They are the books' own, so reading them tells the seat nothing it was not shown. A sitting with nothing new in it
  // takes no turn only if nothing falls due before it is next at the desk.
  let booksDue: number[] = [];
  let booksAt = -1;
  // What in the last answer was not done (or only in part), by use: what it's told in this sitting if a turn follows
  // (`now`), and otherwise at the start of the next (`later`, which has to say what it was about).
  const notDone = new Map<string, { now: string; later: string }>();
  let unsaid: string[] = []; // what wasn't done last sitting, still to be told
  let current: string | undefined; // the use whose action was just carried out (the next report is its result)
  let lastAction: string | undefined;
  // "Done for now" said alongside actions: once they're carried out, no call until the next wake (or sitting).
  let doneAfter: { days?: number } | undefined;
  // What it was shown while not at its desk (a wake between sittings, or after its last action of a sitting), for the
  // next sitting: perception is changes, so nothing seen is lost.
  let carried: string[] = [];
  let missed: Observation[] = []; // the observations behind it (a mock's code brain reads these, not the text)
  // Reports that came during a sitting while it couldn't be reached (a model call that failed), for its next turn.
  let extra: string[] = [];
  // One more turn was given this sitting for an answer none of which could be done (once, so it can't go round for ever).
  let retried = false;
  // Office hours: the day of the sitting under way (or last held), whether it's open, and the earliest it's back.
  let sittingDay = -1;
  let open = false;
  let backAt = 0;
  let mail = false; // someone wrote, in something it hasn't been shown yet
  const seenSystems = new Set<string>();
  let lastSystem: string | undefined; // its standing instructions as last sent (its debrief is said beneath them)
  let standingText = "";
  const DAYS = 86_400;
  const S = c.sessions;
  const sittingStart = (day: number) => day * DAYS + (S?.start ?? 0);
  const workday = (day: number) => !S || day % 7 < S.days;
  /** The next sitting at or after `t`: a working day's start, or now if within a working day's hours. */
  const nextSitting = (t: number) => {
    let day = Math.floor(t / DAYS);
    if (S && workday(day) && t >= sittingStart(day) && t < day * DAYS + S.end && day !== sittingDay) return t;
    for (day = day + (t >= sittingStart(day) ? 1 : 0); !workday(day) || day === sittingDay; day++);
    return sittingStart(day);
  };
  // Papers filed with its office while it was away (docs/real-models.md, "What brings a seat back"): how many of each
  // kind since it last sat, the earliest sitting they bring it back to, the kinds it has said may wait, and those seen.
  const papersBack = !!S && c.wakeOnPapers !== false && !!c.trays;
  const papersIn = new Map<string, number>();
  let papersAt: number | undefined;
  let hold = new Set<string>();
  const own = new Set([c.participant, ...(c.ownAuthors ?? [])]);
  // The office's counter, as its procedure and the seat's standing order for it stand (llm/counter.ts): routine post
  // its staff answer does not bring the seat back, and is set out as a count and a sample.
  const counter = new CounterWatch(c.entity, c.participant, standingIds);
  const posts = new Set<string>();
  const counted = new Set<string>();
  /** Take in what an observation brings of papers filed with the office: each once, by the kind a list names it by. */
  const filed = (obs: Observation) => {
    if (!papersBack) return;
    for (const p of obs.positions ?? []) posts.add(p.position);
    const anyTray = c.trays!.kinds.size > 0;
    const atCounter = counter.view(obs.t);
    for (const [id, ch] of Object.entries(obs.channels)) {
      if (ch.kind !== "records" || ch.search || standingIds.has(id)) continue;
      const tray = c.trays!.kinds.get(id);
      if (tray === undefined && !c.trays!.all.has(id)) continue;
      for (const r of ch.records) {
        // (The seat's own papers and its staff's never bring it back, but for one: the day's list its clerk files of the cases
        // whose day has come, when a case is on it for the first time. docs/behaviour/office-books.md, point 8.)
        const dayList = r.record === "statement" && r.kind === "office_books" && own.has(r.author) && Number(r.data?.list?.new) > 0;
        if ((own.has(r.author) && !dayList) || counted.has(r.id)) continue;
        const toPost = r.record === "statement" && (r.addressed_to ?? []).some((x) => posts.has(x));
        // (An organisation with one office: what others address to the organisation is that office's post. Until
        // 2026-10-11 a tenant's letter to a landlord was shown at the seat's next sitting and did not bring it back.)
        const toSole = !!c.trays!.sole && r.record === "statement" && r.speaks_for !== c.entity && !!c.entity && (r.addressed_to ?? []).includes(c.entity);
        const mine = tray !== undefined ? tray === true || ofKind(r, tray) : toPost || toSole || (!anyTray && r.speaks_for !== c.entity);
        if (!mine) continue;
        counted.add(r.id);
        if (atCounter?.counters(r)) continue; // (the counter's: its staff answer it, and the seat is told how many)
        const kind = dayList ? "day list" : paperKind(r);
        if (hold.has(kindSaid(kind))) continue;
        papersIn.set(kind, (papersIn.get(kind) ?? 0) + 1);
        // (The next working day's sitting after the day it came: never at once. The day's list, filed before the day's
        // sitting, is for that sitting: it is the first thing on the desk that morning.)
        const day = Math.floor(r.at / DAYS);
        const due = dayList && workday(day) && r.at < sittingStart(day) && day !== sittingDay ? sittingStart(day) : nextSitting((day + 1) * DAYS);
        papersAt = papersAt === undefined ? due : Math.min(papersAt, due);
      }
    }
  };
  // Its office's staff as last set out for it, and as they stand at the sitting under way.
  let staffShown: string | undefined;
  let staffNow: string | undefined;

  /** Carry out the next queued action. */
  const officePosts = new Set<string>(); // the posts it holds, as its reports have named them
  const next = (obs: Observation): ParticipantAction => {
    const q = queue.shift()!;
    current = q.id;
    lastAction = q.label;
    lastLooked = q.looked ? new Map([q.looked]) : undefined;
    kindLook = q.kindSaid;
    queueFollowed = q.follows;
    if (q.follows !== undefined) return q.action; // (the same look, gone on with: not another)
    if (q.action.type === "propose") tally.requests++;
    if (q.action.type === "sign") q.action.decision === "accept" ? tally.confirmed++ : tally.declined++;
    if (q.action.type === "message") tally.written++;
    sending = q.action.type === "message";
    if (opening) return q.action; // (looked up for it as the sitting opens: not something it did then)
    if (q.action.type === "look") tally.looks++;
    [tally.first, tally.last] = [tally.first < 0 ? obs.t : tally.first, obs.t];
    return q.action;
  };
  /** Away from the desk until `until` (or its cadence): the conversation ends; the next sitting starts afresh. */
  const away = (until?: number): ParticipantAction => {
    messages = [];
    pending = [];
    results.clear();
    notDone.clear();
    after.clear();
    said.clear();
    quiet.clear();
    trays = false;
    [lookedLast, lookedNow] = [lookedNow, new Set()];
    extra = [];
    retried = false;
    stayed = false;
    askedBack.clear();
    open = false;
    lookIds.clear();
    return until !== undefined ? { type: "wait", until } : { type: "wait" };
  };
  /** Done for now, for the days given (none: its usual rhythm): back then, or at the next sitting if someone writes. */
  let exactTo: number | null | undefined; // (a twin's: the time it said it is back at, none: its brain's own rhythm)
  const leave = (t: number, given?: number): ParticipantAction => {
    if (exactTo !== undefined) {
      const to = exactTo;
      exactTo = undefined;
      backAt = to ?? 0;
      return away(to ?? undefined);
    }
    const days = given ?? (S ? c.cadenceDays : undefined);
    backAt = days ? (S ? sittingStart(Math.floor(t / DAYS) + days) : t + days * DAYS) : 0;
    return away(S ? Math.min(backAt || Infinity, nextSitting(t + 1)) : days ? t + days * DAYS : undefined);
  };
  /** The sitting is ending with the last answer's results unread: they're kept for the next one, with what wasn't done. */
  const keepForNext = () => {
    for (const u of pending) {
      if (results.has(u.id)) carried.push(results.get(u.id)! + (after.get(u.id) ?? ""));
      // (A request that came to nothing, unread as the sitting ends: said first thing at the next, not left among the rest.)
      for (const text of askedBack.get(u.id) ?? []) unsaid.push(`When you were last here, after you had finished: ${text.charAt(0).toLowerCase()}${text.slice(1)}`);
      if (notDone.has(u.id)) unsaid.push(notDone.get(u.id)!.later);
    }
  };
  const note = (data: object) => io.annotate({ annotation: "note", subject: c.participant, data });
  /** A notebook nearly full at a sitting's opening: its older entries it has not touched are folded into a summary in its
   * own words, in one call of their own (purpose "notebook"). Nothing is dropped unless the answer was read and was short
   * enough; otherwise the notebook stays as it was and it is told. Returns what it is told at the opening. */
  const foldNotes = async (t: number): Promise<string[]> => {
    if (notes.length < NOTEBOOK_NEARLY) { foldWait = 0; return []; }
    if (foldWait > 0) { foldWait--; return []; }
    const lines = entries(notes);
    const plan = foldPlan(lines, lines.map((_, i) => ages[i] ?? t));
    const fail = async (why: string) => {
      foldWait = 3;
      await note({ notebook_fold_failed: { reason: why, notebook_characters: notes.length } });
      return [`Your notebook is nearly full (${notes.length.toLocaleString("en")} of the ${NOTEBOOK_MAX.toLocaleString("en")} characters it holds are used), and your older notes could not be folded into a summary this time: they are all still there.`];
    };
    if (!plan) return fail("too little older than the newest notes to fold");
    const older = plan.fold.map((i) => lines[i]!).join("\n");
    const day = dayOf(plan.upTo);
    const header = `Summary of my notes up to day ${day}:`;
    const words = Math.max(10, Math.round(plan.limit / 60) * 10);
    const asked = `at most ${plan.limit.toLocaleString("en")} characters (about ${words} words)`;
    const content = `Your notebook is nearly full: ${notes.length.toLocaleString("en")} of the ${NOTEBOOK_MAX.toLocaleString("en")} characters it holds are used. These are your older notes, the ones you have not touched since you wrote them (written up to day ${day}); your newer notes stay just as they are:\n\n${older}\n\nWrite a summary of these older notes in your own words, keeping what you will still need from them, in ${asked}. What you write replaces the older notes above, under the heading "${header}"; give only the summary.`;
    // One asking, and one more if the summary came back longer than asked (each a counted call of its own).
    const ask = async (messages: LlmMessage[]): Promise<string | undefined> => {
      try {
        const res = await callModel(io, {
          purpose: "notebook", subject: c.participant, ref: "notebook", system: c.framing.system ?? "", maxTokens: Math.min(c.maxTokens ?? 4000, Math.ceil(plan.limit / 2) + 256), ...(c.effort ? { effort: c.effort } : {}),
          messages, context: { participant: c.participant, notes, older, limit: plan.limit, day },
        }, seenSystems);
        return res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      } catch (e) {
        if (!(e instanceof ModelCallFailed)) throw e;
        return undefined;
      }
    };
    const first = await ask([{ role: "user", content }]);
    if (first === undefined) return fail("no answer came");
    if (!first) return fail("the answer was empty or could not be read");
    let reply = first;
    /** What of the summary was left out, where it had to be cut (said to the seat, and kept in the note). */
    let cut: { whole: string; left_out: string; asked_again: boolean } | undefined;
    if (reply.length > plan.limit) {
      // (Longer than asked, as a model's count of its own characters often is: 990, 964 and 1,054 for 803, 835 and
      // 954 asked in the third living pilot, and each fold then failed. It is asked once more, told the length it
      // wrote; if that is still too long the shorter of the two is kept as far as the last sentence that fits, and
      // the seat is told what was left out. Nothing is dropped without its being said.)
      const second = await ask([{ role: "user", content }, { role: "assistant", content: first },
        { role: "user", content: `That summary is ${first.length.toLocaleString("en")} characters, and it has to be ${asked} to fit. Write it again, shorter, keeping what you will still need; give only the summary.` }]);
      const again = second ? second : undefined;
      const best = again !== undefined && again.length < first.length ? again : first;
      if (best.length <= plan.limit) reply = best;
      else {
        const fits = trimAtSentence(best, plan.limit);
        if (!fits) return fail(`the summary was ${first.length} characters${again !== undefined ? `, and ${again.length} when asked again` : ""}, longer than the ${plan.limit} asked for, with no sentence ending within them`);
        cut = { whole: best, left_out: best.slice(fits.length).trim(), asked_again: again !== undefined };
        reply = fits;
      }
    }
    const summary = `${header} ${reply}`;
    const folded = new Set(plan.fold);
    const at = plan.fold[0]!;
    const kept: string[] = [], keptAges: number[] = [];
    lines.forEach((l, i) => {
      if (i === at) for (const x of entries(summary)) { kept.push(x); keptAges.push(plan.upTo); }
      if (!folded.has(i)) { kept.push(l); keptAges.push(ages[i] ?? t); }
    });
    const was = notes.length;
    notes = kept.join("\n");
    ages = keptAges;
    await note({ notebook_folded: { replaced_characters: older.length, replaced_entries: plan.fold.length, summary_characters: summary.length, notebook_before: was, notebook_after: notes.length, up_to_day: day, replaced: older,
      ...(cut ? { summary_cut: { written_characters: cut.whole.length, asked_characters: plan.limit, left_out: cut.left_out, asked_again: cut.asked_again } } : {}) } });
    return [`Your notebook was nearly full, so your notes up to day ${day} (${older.length.toLocaleString("en")} characters) are now a summary you wrote (${summary.length.toLocaleString("en")} characters); the newer notes are as you left them.${cut
      ? ` The summary you wrote was ${cut.whole.length.toLocaleString("en")} characters, longer than the ${plan.limit.toLocaleString("en")} there was room for${cut.asked_again ? " even when you were asked again" : ""}, so it was kept up to the end of the last sentence that fits. Left out of your notebook (${cut.left_out.length.toLocaleString("en")} characters): "${cut.left_out}". Note again whatever of that you still need.`
      : ""}`];
  };
  /** What it is shown, with no id of the platform's own in it: wherever a participant's id stands (in a letter's
   * words, a paper's, a reference to something waiting to be confirmed), the id the world knows that party by stands
   * instead: an office's post, a person themselves. The same party, by the name a seat can write to. */
  const inWorld = (shown: string) => (c.whoIs ? shown.replace(PLATFORM_ID, (id) => c.whoIs!(id)?.id ?? id) : shown);
  /** A reference to something waiting to be confirmed, as the seat is shown it, back as it is kept: a seat's drafts are its own. */
  const draftRef = (ref: string) => { const m = /^\[?draft\.(.+)\.([0-9]+)\]?$/.exec(ref.trim()); return m ? `draft.${c.participant}.${m[2]}` : ref; };
  /** A look, in words: the report, and what of it. */
  const lookWords = (i: any) => {
    const finds: any[] = Array.isArray(i.find) ? i.find : i.find ? [i.find] : [];
    const names: string[] = Array.isArray(i.named) ? i.named : text(i.named) ? [i.named] : [];
    return `"${c.titles.get(i.report) ?? i.report}" (${i.report})${i.current_only ? ", what's current" : ""}${finds.length ? `, where ${finds.map((f) => `${f?.field} ${f?.op ?? "="} ${f?.value}`).join(" and ")}` : ""}${names.length ? `: ${names.join(", ")}` : ""}${text(i.measure) ? `, by ${i.measure}` : ""}${text(i.paper) ? `, the paper ${i.paper}${Number.isInteger(i.from_entry) ? ` from entry ${i.from_entry}` : ""}` : ""}${text(i.about) ? `, about ${i.about}` : ""}${text(i.since) ? `, since ${i.since}` : ""}${text(i.words) ? `, with the words "${i.words}"` : ""}`;
  };
  /** What a look into papers asked for, the report aside, in words: said back with its answer, so that what was
   * searched is on the page with what was found. Nothing, for a look that named nothing to find. */
  const criteria = (i: any): string => {
    const all = lookWords({ ...i, paper: undefined, from_entry: undefined });
    const head = `"${c.titles.get(i.report) ?? i.report}" (${i.report})`;
    return all.slice(head.length).replace(/^[,:]\s*/, "").trim();
  };
  /** Whether a look's result holds nothing it hasn't been shown this sitting, but that there's nothing there. */
  const nothingNew = (obs: Observation, body: string) => {
    if (obs.outcomes.length || obs.inbox.length || obs.notices?.length || obs.drafts.length) return false;
    const shown = messages.flatMap((m) => (m.role !== "user" ? [] : typeof m.content === "string" ? [m.content] : m.content.map((b) => (b.type === "tool_result" ? b.content : b.type === "text" ? b.text : "")))).join("\n\n");
    const empty = (x: string) => { const l = x.split("\n"); return l.length >= 2 && (l[1] === NOTHING_FOUND || l[1] === NOTHING_NEW) && l.slice(2).every((y) => y.startsWith("(")); };
    const [, ...rest] = sections(body);
    return rest.some(empty) && rest.every((x) => empty(x) || shown.includes(x));
  };

  /** What a tool use asks for, as an action; or, if it can't be done as written, what it was and why not, in words. */
  const read = (use: Use, held: Set<string>): { what: string } & ({ action: ParticipantAction; label?: string; looked?: [string, Looked]; kindSaid?: Follow; clipped?: string; subject?: string } | { why: string }) => {
    let i = use.input;
    const what = use.name === "do" ? (text(i?.what) ? `what you asked for (${quote(i.what)})` : "something you asked for")
      : use.name === "confirm" ? (text(i?.ref) ? `your answer on ${i.ref}` : "your answer on something waiting for you to confirm")
      : use.name === "write" ? (text(i?.text) ? `your letter (${quote(i.text)})` : "a letter of yours")
      : use.name === "look" ? (text(i?.report) ? `looking at ${quote(c.titles.get(i.report) ?? i.report)}` : "looking something up")
      : `something you tried (${quote(String(use.name))})`;
    const no = (why: string) => ({ what, why });
    if (!i || typeof i !== "object" || Array.isArray(i) || "_unparsed" in i) return no("it couldn't be read as you wrote it");
    // A post it doesn't hold (any more) can't be acted in; left out, it acts as itself.
    const post = (): { as?: string } | string =>
      i.as === undefined ? {} : !text(i.as) ? "the post you named couldn't be read" : !held.has(i.as) ? `you don't hold the post ${quote(i.as)}` : { as: i.as };
    if (use.name === "do") {
      if (!text(i.what)) return no("it didn't say what to do");
      if (i.what.length > TEXT_MAX) return no(`it ran to ${i.what.length.toLocaleString("en")} characters, and what you ask for can be at most ${TEXT_MAX.toLocaleString("en")}`);
      const as = post();
      if (typeof as === "string") return no(as);
      // (Why is kept on record: too long a reason is kept as far as a record holds, never the cause of the act being lost.)
      return { what, action: { type: "propose", text: i.what, ...as, ...(text(i.why) ? { reasoning: i.why.slice(0, TEXT_MAX) } : {}) }, ...(text(i.why) && i.why.length > TEXT_MAX ? { clipped: `why (${i.why.length} characters; ${TEXT_MAX} kept)` } : {}) };
    }
    if (use.name === "confirm") {
      if (!text(i.ref)) return no("it didn't say which one");
      if (i.decision !== "confirm" && i.decision !== "decline") return no('it has to say "confirm" or "decline"');
      return { what, action: { type: "sign", draft: draftRef(i.ref), decision: i.decision === "confirm" ? "accept" : "reject", ...(text(i.note) ? { note: i.note.slice(0, TEXT_MAX) } : {}) },
        ...(i.decision === "confirm" ? { label: "What you confirmed" } : {}), ...(text(i.note) && i.note.length > TEXT_MAX ? { clipped: `note (${i.note.length} characters; ${TEXT_MAX} kept)` } : {}) };
    }
    if (use.name === "write") {
      if (text(i.to)) return no("who it's for has to be given as a list");
      if (!Array.isArray(i.to) || !i.to.length) return no("the letter had no one to go to");
      if (!i.to.every(text)) return no("one of those it was for couldn't be read");
      if (!text(i.text)) return no("the letter had no words");
      // Whom it goes to, each by id (written in brackets or not). Nothing that can't be delivered is sent on and lost.
      const to: string[] = [...new Set((i.to as string[]).map(bare))];
      const strangers = to.filter((x) => !isId(x));
      if (strangers.length) return no(`${strangers.map((x) => quote(x, 60)).join(" and ")} ${strangers.length === 1 ? "isn't an id" : "aren't ids"}: a letter goes to people and organisations by the ids your reports give them, the word in brackets after a name, as in "Name (id)" (to find one, look them up in who's who)`);
      if (to.length > TO_MAX) return no(`a letter goes to at most ${TO_MAX} at once, and this named ${to.length}`);
      if (i.about !== undefined && i.about !== null && typeof i.about !== "string") return no("what it's about couldn't be read");
      // What it is about: one id is the letter's reference; anything else heads the letter as its subject line, and
      // the letter goes (2026-10-09: three of one mayor's four letters were lost for an `about` in words).
      const about = typeof i.about === "string" ? i.about.trim() : "";
      const re = about && isId(bare(about)) ? bare(about) : undefined;
      const words = about && !re ? `About: ${about}\n\n${i.text}` : i.text;
      if (words.length > TEXT_MAX) return no(`the letter ran to ${words.length.toLocaleString("en")} characters, and a letter can be at most ${TEXT_MAX.toLocaleString("en")}`);
      const as = post();
      if (typeof as === "string") return no(as);
      return { what, action: { type: "message", to, text: words, ...as, ...(re ? { re } : {}) }, label: `Your letter to ${to.join(", ")}${about && !re ? ` (headed "About: ${about.length > 80 ? `${about.slice(0, 80)}…` : about}": what it is about is not one id, so it heads the letter)` : ""}`,
        ...(about && !re ? { subject: about } : {}) };
    }
    // A mock seat that sits as its code twin does asks for what its brain asked for in one look, as the code unit asks: all of it in one command, at
    // its place in the moment's order (a model's looks are one report at a time, each a turn of its own).
    if (use.name === "look" && c.exactBack && Array.isArray(i.raw) && i.raw.length) return { what, action: { type: "look", looks: i.raw as LookRequest[] } };
    if (use.name === "look" && reports.size) {
      if (!text(i.report)) return no("it didn't say which report");
      const kind = reports.get(i.report);
      if (!kind) return no("that isn't one of the reports you can look at");
      const limit = Number.isInteger(i.limit) ? Math.min(LOOK_MAX, Math.max(1, i.limit)) : 20;
      // Words to find in papers, or what they are about, written as one of the things to find (find: field "words"):
      // taken as the look's own `words` and `about`, which is where a look takes them. (A seat asked so twice and was
      // told '"words" isn't something papers can be found by': 2026-10-09.)
      if (i && typeof i === "object" && !Array.isArray(i)) {
        const given: unknown[] = Array.isArray(i.find) ? i.find : i.find === undefined || i.find === null ? [] : [i.find];
        const taken: { words?: string; about?: string } = {};
        const kept = given.filter((w: any) => {
          const field = typeof w?.field === "string" ? w.field.trim().toLowerCase() : "";
          const as = field === "words" || field === "text" ? "words" : field === "about" ? "about" : undefined;
          if (!as || !text(w.value) || (w.op !== undefined && w.op !== "=" && w.op !== "contains") || text(i[as]) || taken[as] !== undefined) return true;
          taken[as] = w.value;
          return false;
        });
        if (kept.length !== given.length) i = { ...i, ...taken, find: kept };
      }
      const finds: unknown[] = Array.isArray(i.find) ? i.find : i.find === undefined || i.find === null ? [] : [i.find];
      const names: string[] | undefined = i.named === undefined || i.named === null ? [] : text(i.named) ? [i.named] : Array.isArray(i.named) && i.named.every(text) ? i.named : undefined;
      if (!names) return no("the names of what to look at couldn't be read");
      const way = c.ways?.get(i.report);
      if (kind !== "records") {
        // Places, or who's who: the report as it is now, and of it what was named (or the buildings a measure marks).
        if (finds.length || i.current_only) return no(`that report isn't one of papers to search: name ${kind === "sites" ? "the places to see, or a measure" : "who you're looking for"}`);
        if (i.measure !== undefined && (!text(i.measure) || kind !== "sites")) return no(kind === "sites" ? "the measure couldn't be read" : "a measure is something buildings have: name who you're looking for");
        const looked: Looked = { ...(names.length ? { named: names.slice(0, 40) } : {}), ...(text(i.measure) ? { measure: i.measure } : {}), limit, ...(Number.isInteger(i.from_entry) ? { fromEntry: i.from_entry as number } : {}) };
        // A place it is not at is gone to: nobody is shown it. The places are named, and what was there comes later.
        if (kind === "sites" && way?.way === "visit") {
          if (i.measure !== undefined) return no("nobody is shown places they are not at: say where to send someone (a building by its id, or a piece of ground by its cell)");
          if (!names.length) return no("nobody is shown places they are not at: say where to send someone (a building by its id, or a piece of ground by its cell)");
          return { what, action: { type: "look", looks: [{ channel: i.report, visit: { places: names.slice(0, VISIT_MAX).map((n) => n.trim()) } }] }, looked: [i.report, { named: names.slice(0, VISIT_MAX), sent: true }] };
        }
        // Who's who is looked up, one named person, organisation or post at a time: nobody is shown all of it.
        if (kind === "directory" && way?.way === "ask") {
          if (!names.length) return no("nobody is shown who's who: say whom you are looking for (a person, an organisation or a post, by name or id)");
          return { what, action: { type: "look", looks: names.slice(0, WHO_MAX).map((name) => ({ channel: i.report, who: { name: name.trim() } })) }, looked: [i.report, { ...looked, named: names.slice(0, WHO_MAX) }] };
        }
        return { what, action: { type: "look", looks: [{ channel: i.report }] }, looked: [i.report, looked] };
      }
      if (names.length > 1 || i.measure !== undefined) return no("that report is one of papers: say what to find in it, or give one paper's id in paper to read it in full (one paper to a look; several looks can go in one answer)");
      for (const [k, v] of Object.entries({ paper: i.paper, about: i.about, since: i.since, words: i.words })) if (v !== undefined && v !== null && !text(v)) return no(`what you gave as ${k} couldn't be read`);
      if (i.from_entry !== undefined && i.from_entry !== null && !(Number.isInteger(i.from_entry) && i.from_entry >= 1)) return no("the entry to start from is a whole number, 1 or more");
      // A search (what matches now, newest first). Anything to find that can't be read is said, never left out: a
      // search wider than the one asked for would read as its answer.
      const where: Where[] = [];
      // A kind is said in plain words: asked for as nearly as a search can be, and told from the list here.
      const kinds: string[] = [];
      const rest: Where[] = []; // (what to find, the kind aside)
      let here = false;
      for (const w of [...finds, ...(text(i.since) ? [{ field: "date", op: ">=", value: i.since }] : [])] as any[]) {
        if (typeof w?.field === "string" && w.field.trim().toLowerCase() === "kind" && typeof w.value === "string" && (w.op ?? "=") === "=") {
          const k = kindWhere(w.value);
          where.push(...k.where);
          kinds.push(w.value.trim());
          here ||= k.here;
          continue;
        }
        const r = condition(w);
        if (typeof r === "string") return no(r);
        where.push(...r);
        rest.push(...r);
      }
      // One paper, by its id, read in full (a long one a part at a time): named in `paper`, or as the one thing named,
      // or as the only thing to find.
      const byId = where.length === 1 && where[0]!.field === "id" && where[0]!.op === "=" && typeof where[0]!.value === "string" ? where[0]!.value : undefined;
      const paper: string | undefined = text(i.paper) ? bare(i.paper) : names.length === 1 ? bare(names[0]!) : byId;
      if (paper !== undefined && !byId) {
        if (where.length || kinds.length || text(i.about)) return no("to read one paper in full, give only its id (and, for a long one, the entry to start from or the words to find in it)");
        where.push({ field: "id", op: "=", value: paper });
      }
      // A register someone else keeps answers a question about one named thing: the question has to name it.
      if (way?.way === "ask") {
        const by = way.by ?? ["id"];
        if (!where.some((w) => w.op === "=" && by.includes(w.field))) return no(`whoever keeps that register answers a question about one thing, never everything: say which, by ${by.map((f) => BY_WORDS[f] ?? f).join(" or ")}`);
      }
      if (paper !== undefined) return { what, action: { type: "look", looks: [{ channel: i.report, query: { where, limit: 1 } }] },
        looked: [i.report, { paper, ...(Number.isInteger(i.from_entry) ? { fromEntry: i.from_entry } : {}), ...(text(i.words) ? { words: i.words } : {}) }] };
      // A folder of some kinds only: asked for by its kind where it has one, and told from the list here otherwise.
      const folder = c.folders?.get(i.report);
      if (folder && !kinds.length) {
        // (A standing payment is no kind a search can be asked: a folder that holds them beside one other kind is
        // searched for that kind, and the standing payments are shown as they come and found in the office's files.)
        const asked = folder.filter((k) => kindSaid(k) !== "standing payment");
        if (asked.length === 1) where.push(...kindWhere(asked[0]!).where);
        here = true;
      }
      // What a search cannot be asked (what a paper names, the words in it, what an agreement is for) is told from
      // what it gives: then the latest papers that match the rest are looked through, as many as one search gives.
      here ||= text(i.about) || text(i.words);
      // (A list gone on with from an entry: as many as one search gives are asked for, and the part wanted is taken here.)
      const fromEntry = Number.isInteger(i.from_entry) ? (i.from_entry as number) : undefined;
      const fetched = here || fromEntry !== undefined ? SEARCH_MAX : limit;
      const asked = criteria(i);
      const looked: Looked = { limit, ...(text(i.about) ? { about: i.about.trim() } : {}), ...(text(i.words) ? { words: i.words } : {}), ...(kinds.length ? { kinds } : {}), ...(here || fromEntry !== undefined ? { fetched } : {}), ...(fromEntry !== undefined ? { fromEntry } : {}), ...(asked ? { said: asked } : {}) };
      // Papers it's shown as they come can still be looked through: with nothing to find, the latest of them. Papers it
      // only reads when it chooses, looked into with nothing to find: what has come since it last looked (so that a look
      // into the same folder, sitting after sitting, reaches what is new, and says so when nothing is). A board is never
      // read through: with nothing to find, its latest few.
      const whole = !where.length && !here && fromEntry === undefined && !i.current_only && c.onRequest?.includes(i.report) && !way?.board;
      const query = whole ? {} : { query: { ...(i.current_only ? { standing: true } : {}), ...(where.length ? { where } : {}), order: { field: "at", desc: true }, limit: fetched } };
      return { what, action: { type: "look", looks: [{ channel: i.report, ...query }] }, looked: [i.report, looked],
        // (A kind that finds nothing: the folder's latest papers are looked through for kinds like it.)
        ...(kinds.length ? { kindSaid: { said: kinds.join(", "), action: { type: "look", looks: [{ channel: i.report, query: { ...(i.current_only ? { standing: true } : {}), ...(rest.length ? { where: rest } : {}), order: { field: "at", desc: true }, limit: SEARCH_MAX } }] } as ParticipantAction, looked: [i.report, { limit, kindSaid: kinds[0]!, fetched: SEARCH_MAX, ...(text(i.about) ? { about: i.about.trim() } : {}), ...(text(i.words) ? { words: i.words } : {}) }] as [string, Looked] } } : {}) };
    }
    return no("it isn't something you can do");
  };

  /** What came in while it was away, set out for the sitting: each section once (a report repeats what hasn't changed,
   * the town's survey, who's who), and, if it's more than can be set out, the latest reports whole and a count of the
   * earlier ones left out. */
  const sinceLast = (now: string): { before: string; left: number; of: number } => {
    const set = (from: number) => {
      // (What the report of now says in the same words isn't said twice: it follows at once.)
      const shown = new Set<string>(sections(now));
      return carried.slice(from).flatMap(sections).filter((x) => !shown.has(x) && (shown.add(x), true)).join("\n\n");
    };
    let left = 0;
    let before = set(0);
    while (before.length > CARRY_MAX && left < carried.length - 1) before = set(++left);
    return { before: left ? `(${left} earlier ${left === 1 ? "report" : "reports"} not shown.)\n${before}` : before, left, of: carried.length };
  };

  return {
    async step(given, ctx) {
      inCurrency(ctx.world.currency);
      // An office's books, and its staff's report of their work, are the office's own: another office of the same
      // organisation is not shown them, and they do not bring it back (docs/behaviour/office-books.md). An organisation's
      // papers reach every office of it that reads papers of that kind, so those naming another office are left out here.
      for (const p of given.positions ?? []) officePosts.add(p.position);
      const anothers = (r: any) => r.record === "statement" && (r.kind === "office_books" || r.kind === "staff_report") && typeof r.data?.office === "string" && officePosts.size > 0 && !officePosts.has(r.data.office);
      const obs: Observation = Object.values(given.channels).some((ch) => ch.kind === "records" && ch.records.some(anothers))
        ? { ...given, channels: Object.fromEntries(Object.entries(given.channels).map(([id, ch]) => [id, ch.kind === "records" ? { ...ch, records: ch.records.filter((r) => !anothers(r)) } : ch])) as Observation["channels"] }
        : given;
      const standing = inWorld(renderStanding(obs, standingIds, c.whoIs));
      // (What stands now, as this report's standing documents show it: nothing, once the last of them is withdrawn. A
      // report that brings none of those documents leaves what's on file as it was.)
      if (standing || Object.entries(obs.channels).some(([id, ch]) => standingIds.has(id) && ch.kind === "records" && ch.records.length)) standingText = standing;
      counter.absorb(obs);
      for (const ch of Object.values(obs.channels)) if (ch.kind === "records") for (const r of ch.records as any[])
        if (r.record === "statement" && r.kind === "office_books" && own.has(r.author) && Array.isArray(r.data?.open) && Number(r.data.at ?? r.at) >= booksAt) {
          booksAt = Number(r.data.at ?? r.at);
          booksDue = r.data.open.map((x: any) => Number(x.due)).filter((x: number) => Number.isFinite(x));
        }
      const atCounter = counter.view(obs.t);
      let body = renderObservation(obs, { ...(c.whoIs ? { whoIs: c.whoIs } : {}), ...(atCounter ? { counter: atCounter } : {}), standing: standingIds, titles: c.titles, lastAction, draftText: c.draftText, lookable: canLook, ...(lastLooked ? { looked: lastLooked } : {}), ...(c.folders ? { folders: c.folders } : {}), onCut: (cut) => void cutLooks.push(cut) });
      for (const cut of cutLooks.splice(0)) await note({ look_cut: cut });
      body = inWorld(body);
      lastAction = undefined;
      lastLooked = undefined;
      if (obs.inbox.length) mail = true;
      filed(obs);
      // This report is the result of the action just carried out, if one was.
      const wasResult = current !== undefined;
      if (current && sending && obs.outcomes.some((x) => x.status === "applied")) tally.letters++;
      // Something it asked to be done came to nothing (its request could not be drawn up): kept by the use it was, so
      // that it is asked back in this sitting, or first thing at its next.
      const back = (obs.notices ?? []).filter((n) => n.re !== undefined).map((n) => inWorld(n.text));
      if (current && back.length) askedBack.set(current, back);
      sending = false;
      if (current) {
        // A look for a kind of paper that found nothing: the folder's latest papers are looked through for kinds like
        // it (no turn is taken for it), and what that shows stands where "nothing found" stood.
        const follow = kindLook;
        kindLook = undefined;
        const nothing = (x: string) => /: what you looked up \(0 found\)$/.test(x.split("\n")[0]!);
        if (follow && sections(body).some(nothing)) {
          results.set(current, body);
          queue.unshift({ id: current, action: follow.action, looked: follow.looked, follows: current });
          current = undefined;
          return next(obs);
        }
        const first = results.get(current);
        if (first !== undefined && queueFollowed === current) {
          const [head, ...rest] = sections(first);
          const [head2, ...rest2] = sections(body);
          const said = new Set(head!.split("\n"));
          body = [[head, ...head2!.split("\n").filter((l) => l && !said.has(l))].join("\n"), ...rest.filter((x) => !nothing(x)), ...rest2].join("\n\n");
        }
        queueFollowed = undefined;
        results.set(current, body);
        if (trays) quiet.set(current, nothingNew(obs, body));
        current = undefined;
      }
      // More of the last answer to carry out (or of what's looked up as a sitting opens): no call.
      if (queue.length) return next(obs);
      // Nothing came of the last answer: all it did was look into whole reports, and there's nothing in any of them that
      // it hasn't been shown. No turn is taken to say so: the sitting ends, it's back as it last arranged, and it's told
      // at the start of its next (with what the looks showed, as after done for now).
      // It is back by the days it last gave, but never after longer than its office's own rhythm: the days it gave at its
      // last sitting were counted from that sitting, and were a plan for one thing (finance, pilot 7A: given 17 for a
      // return due on day 51, it was back on day 49, found nothing new and was sent away 17 days more). Woken early, it
      // is back on the day it set. And what falls due on the office's books
      // before it would next sit is a reason for a turn: the sitting does not end on nothing new.
      const rhythm = c.cadenceDays;
      const nextAt = S ? sittingStart(Math.floor(obs.t / DAYS) + rhythm) : obs.t + rhythm * DAYS;
      const dueBefore = booksDue.some((d) => d >= Math.floor(obs.t / DAYS) * DAYS && d < nextAt);
      if (trays && pending.length && !extra.length && !dueBefore && pending.every((u) => u.name !== "look" || quiet.get(u.id))) {
        const looks = pending.filter((u) => u.name === "look").length;
        const left = backAt > obs.t ? Math.max(1, Math.ceil((backAt - obs.t) / DAYS)) : undefined;
        const back = Math.min(left ?? lastDays ?? rhythm, rhythm);
        keepForNext();
        missed.push(obs);
        unsaid.push(`When you were last here, there was nothing in what you looked into, so the sitting ended there.`);
        await note({ no_turn: { looks_that_found_nothing: looks, back_after_days: back } });
        return leave(obs.t, back);
      }
      trays = false;
      // Done for now, said alongside: what its actions showed is kept for next time. If someone wrote meanwhile (with
      // the result of any of them), it's back sooner, as it was told: at the next sitting, or, with no office hours, now.
      let backEarly = false;
      let stayOn = false;
      if (doneAfter) {
        const was = doneAfter;
        doneAfter = undefined;
        if (!S && mail) backEarly = true;
        // Something it asked for in that answer was not filed: it is asked back at once, in this sitting, rather than
        // told days later among other things (once a sitting; after that, first thing at its next).
        else if (askedBack.size && !stayed) {
          stayed = true;
          stayOn = true;
        } else {
          keepForNext();
          missed.push(obs);
          return leave(obs.t, was.days);
        }
      }
      // Office hours: between sittings, what comes in is kept for the next one, and no call is made.
      const before = { open, sittingDay, mail };
      if (S && !open) {
        const day = Math.floor(obs.t / DAYS);
        const inHours = workday(day) && obs.t >= sittingStart(day) && obs.t < day * DAYS + S.end && day !== sittingDay;
        // (A paper filed with its office brings it back as a letter does, at the next working day's sitting after the
        // paper came. So that it knows what has come, it looks in at each working day's sitting: no call is made.)
        const papers = papersAt !== undefined && obs.t >= papersAt;
        const notYet = obs.t < backAt && !mail && !papers;
        if (!inHours || notYet) {
          carried.push(body);
          missed.push(obs);
          const tomorrow = nextSitting((day + 1) * DAYS);
          return { type: "wait", until: notYet ? (papersBack ? Math.min(Math.max(backAt, tomorrow), inHours ? tomorrow : nextSitting(obs.t)) : Math.max(backAt, nextSitting(obs.t))) : nextSitting(obs.t) };
        }
        if (obs.t < backAt && !mail && papers) {
          const what = [...papersIn].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ");
          const told = `You are back before the day you gave: papers were filed with your office (${what}). They are set out below.`;
          if (!unsaid.includes(told)) unsaid.push(told);
          await note({ back_for_papers: { papers: [...papersIn].map(([kind, n]) => ({ kind, n })), days_early: Math.ceil((backAt - obs.t) / DAYS) } });
        }
        open = true;
        sittingDay = day;
      }
      // A sitting opens: what it asked to have ready is looked up first (no turn is taken for it), each look as it
      // would make it itself, and set out with the report it opens on. One it can no longer make is dropped, and said.
      if (!pending.length && !opening && ready.length) {
        const held = new Set((obs.positions ?? []).map((p) => p.position));
        const still: typeof ready = [];
        for (const r of ready) {
          const x = read({ type: "tool_use", id: `ready-${still.length + 1}`, name: "look", input: r.input }, held);
          if ("action" in x) {
            queue.push({ id: `ready-${still.length + 1}`, action: x.action, ...(x.looked ? { looked: x.looked } : {}), ...(x.kindSaid ? { kindSaid: x.kindSaid } : {}) });
            still.push(r);
          } else unsaid.push(`${lookWords(r.input)} is no longer looked up for you at each sitting: ${x.why}.`);
        }
        ready = still;
        if (queue.length) {
          opening = { body, before };
          missed.push(obs);
          return next(obs);
        }
      }
      // What it opens on: this report, or the one the sitting opened on with what was looked up for it set out after
      // (each look's report, less what the opening report says in the same words: a section it has whole, or every
      // line of under the same heading, as with an account whose payments were listed once, in the report it opened on).
      let now = body;
      let restore = before;
      if (opening) {
        const first = sections(opening.body);
        const [has, lines] = [new Set(first), new Set(first[0]!.split("\n"))];
        const under = new Map(first.slice(1).map((x) => [x.split("\n")[0]!, new Set(x.split("\n"))]));
        const told = (x: string) => has.has(x) || x.split("\n").every((l) => under.get(x.split("\n")[0]!)?.has(l));
        const out: string[] = [];
        for (const [n] of ready.entries()) {
          const [head, ...rest] = sections(results.get(`ready-${n + 1}`) ?? "");
          const fresh = (head ?? "").split("\n").filter((l) => l && !lines.has(l));
          out.push(...(fresh.length ? [fresh.join("\n")] : []), ...rest.filter((x) => !told(x) && (has.add(x), true)));
        }
        now = `${opening.body}\n\n## Looked up for you, as at every sitting: ${ready.map((r) => lookWords(r.input)).join("; ")}\n${out.join("\n\n")}`;
        restore = { ...opening.before, mail: opening.before.mail || mail }; // (a letter that came with a look's report counts)
        opening = undefined;
        results.clear();
      }

      // A turn: what it's shown, its answer, and what the answer asks for. Usually one a step; a second follows at once
      // when nothing in the answer could be done, so that it's told (once a sitting).
      for (let turn = 1; ; turn++) {
        const fresh = !pending.length;
        let sending: LlmMessage[];
        if (!fresh) {
          const content: ContentBlock[] = pending.map((u) => ({ type: "tool_result", tool_use_id: u.id,
            content: (results.has(u.id) ? results.get(u.id)! + (after.get(u.id) ?? "") : undefined) ?? notDone.get(u.id)?.now ?? said.get(u.id) ?? (u.name === "notebook" ? "Notebook updated."
              : u.name === "done_for_now" ? (backEarly ? "Someone wrote to you as you finished, so you're back now." : stayOn ? "Not yet: something you asked for in the same answer was not filed or done, so the sitting goes on. See what came back from it, and say it again or leave it; then say when you're done." : "Noted.")
              : "Not done: it wasn't something you can do, as written.") }));
          // Reports it hasn't been shown that aren't the result of anything it did (they came while it couldn't be reached).
          const more = [...extra, ...(turn === 1 && !wasResult ? [body] : [])];
          if (more.length) content.push({ type: "text", text: `Since then:\n${more.join("\n\n")}` });
          sending = [...messages, { role: "user", content }];
        } else {
          const since = sinceLast(now);
          if (since.left) await note({ carried_not_shown: { reports: since.left, of: since.of, limit_characters: CARRY_MAX } });
          // Its own office's staff, at its first sitting and whenever the list has changed since it was last set out.
          staffNow = c.staff ? inWorld(c.staff.text(obs.t)) : undefined;
          const staffPart = staffNow && staffNow !== staffShown ? `\n\n${staffNow}` : "";
          const foldSaid = await foldNotes(obs.t);
          const filePart = c.dayBook ? inWorld(c.dayBook.text(obs.t)) : "";
          sending = [{ role: "user", content: `Your notebook: ${notes ? `${notes}\n${notebookRoom(notes.length)}` : "(empty)"}\n\n${unsaid.length || foldSaid.length ? `${[...foldSaid, ...unsaid].join("\n")}\n\n` : ""}${since.before ? `Since you last looked:\n${since.before}\n\nNow:\n` : ""}${now}${staffPart}${filePart ? `\n\n${filePart}` : ""}` }];
        }

        let res: Awaited<ReturnType<typeof callModel>>;
        let unreadTwice: string | undefined;
        let sentCharacters = 0;
        let fitted: LlmMessage[] = sending;
        try {
          // A prompt is never more than a model can take: what is over is left out (the oldest of what was looked up
          // first), with a line saying so where it stood, and noted.
          const ask = async (given: LlmMessage[]) => {
            const fit = fitPrompt(systemPrompt(c, standingText), given, promptMax, lookIds);
            lastSystem = fit.system;
            if (fit.left) await note({ prompt_trimmed: { ...fit.left, characters: fit.characters, limit: promptMax } });
            sentCharacters = fit.characters;
            fitted = fit.messages;
            return callModel(io, {
              purpose: "participant", subject: c.participant, system: fit.system, messages: fit.messages, tools: toolset, maxTokens: c.maxTokens ?? 4000, ...(c.effort ? { effort: c.effort } : {}),
              context: { observation: obs, notes, participant: c.participant, ...(missed.length ? { missed } : {}) },
            }, seenSystems);
          };
          // An answer is read exactly or not at all: one that could not be is not guessed at. The seat is told plainly what
          // could not be read, once, in the same exchange; if the second can't be read either, nothing is done.
          const answered = async (messages: LlmMessage[]): Promise<{ res: Awaited<ReturnType<typeof callModel>>; sending: LlmMessage[]; unread?: string }> => {
            let r = await ask(messages);
            messages = fitted; // (what it was shown, as it was shown it)
            let why = unreadWhy(r.content);
            if (!why) return { res: r, sending: messages };
            await note({ unread_answer: { why, text: unreadText(r.content), asked_again: true } });
            const again: LlmMessage[] = [...messages, { role: "assistant", content: plain(r.content) }, { role: "user", content: `Your last answer could not be read: ${why}. Nothing in it has been done, so all you meant by it is still to do. Give the whole of it again, in the form asked for: every look, letter, request and note you meant, not only the part that could not be read. This is the same turn over again, not a sign to stop: say you are done for now only if you had meant to.` }];
            r = await ask(again);
            why = unreadWhy(r.content);
            if (why) await note({ unread_answer: { why, text: unreadText(r.content), asked_again: false } });
            return { res: r, sending: again, ...(why ? { unread: why } : {}) };
          };
          let got = await answered(sending);
          // A way out of the study that is not clearly meant is never acted on as read, nor passed over: the seat is asked
          // whether it means to leave, and its answer stands (below).
          const leaving = got.res.content.find((b): b is Use => b.type === "tool_use" && b.name === "opt_out");
          if (leaving && !got.unread && !optOutMeant(leaving, got.res.content.filter((b): b is Use => b.type === "tool_use"))) {
            const used = got.res.content.filter((b): b is Use => b.type === "tool_use");
            await note({ opt_out_asked: { use: JSON.stringify(leaving.input).slice(0, 2000), beside: used.filter((u) => u !== leaving).map((u) => u.name) } });
            const ask2: LlmMessage[] = [...got.sending, { role: "assistant", content: plain(got.res.content) }, { role: "user", content: [
              ...used.map((u) => ({ type: "tool_result" as const, tool_use_id: u.id, content: "Not carried out: it waits on your answer below." })),
              { type: "text" as const, text: wayOutAsked(c.framing.disclosure) },
            ] }];
            const second = await answered(ask2);
            const again = second.res.content.find((b): b is Use => b.type === "tool_use" && b.name === "opt_out");
            if (again) {
              // Asked, and it says so: that is the seat's own act, whatever its words.
              await note({ opt_out_confirmed: { asked: true } });
              queue = [];
              tally.last = obs.t;
              if (!text(again.input?.statement)) await note({ opt_out_as_given: JSON.stringify(again).slice(0, 4000) });
              return away(), { type: "opt_out", statement: optOutStatement(again.input) };
            }
            if (second.unread) {
              // No answer could be read: it stays, nothing is done, and it is told so (and that the question stands).
              unreadTwice = wayOut(c.framing.disclosure).unread;
            }
            got = second;
          }
          res = got.res;
          sending = got.sending;
          unreadTwice ??= got.unread && "your answer could not be read, so nothing was done. Nothing you wrote was carried out";
        } catch (e) {
          // The model said the prompt was too long for it: the same prompt is never sent again. The most a prompt may
          // come to is brought down to half of what was sent, so the next is cut to that (the oldest of what was looked
          // up first); it is noted, and the seat is told at its next sitting.
          if (e instanceof ModelCallFailed && promptTooLong(e.message)) {
            const was = promptMax;
            promptMax = Math.max(PROMPT_MIN, Math.floor(Math.min(promptMax, sentCharacters || promptMax) / 2));
            await note({ prompt_too_long: { characters: sentCharacters, limit_was: was, limit_now: promptMax, error: String(e.message).slice(0, 300) } });
            const told = "When you were last to sit, more was set out for you than could be read at once, so that sitting was not held. Less is set out now: the oldest of what you had looked up is left out, and says so where it stood. Look again for what you need, a little at a time.";
            if (!unsaid.includes(told)) unsaid.push(told);
          }
          // No answer, and the run goes on (the call failed after its adapter's own retries): the seat was not at its
          // desk for this sitting. Nothing it was to be shown is dropped: this report, what was kept for it, and what
          // its last answer's actions showed all wait for its next sitting, which is its next working day's (a day on,
          // without office hours), whatever it had last arranged; and it is told then, first thing, that it missed one
          // and that nothing was done. (2026-10-09: three seats whose calls failed were not woken again for the last
          // five days of a run: nothing said when they were due, so each waited out its usual rhythm of a week.)
          if (e instanceof ModelCallFailed) {
            const midway = !fresh;
            if (fresh) carried.push(now); // (with what was looked up for its opening, if anything was)
            else {
              keepForNext();
              carried.push(...extra, ...(turn === 1 && !wasResult ? [body] : []));
            }
            if (turn === 1) missed.push(obs);
            const tooLong = promptTooLong(e.message);
            const told = midway
              ? `Your sitting on ${when(obs.t)} was cut short: you were away from your desk after your last answer there, and nothing more was done that day. How what you had asked for went is set out below, with what has come in since.`
              : `You missed your sitting on ${when(obs.t)}: you were not at your desk, and nothing was read or done that day. What had come in for it is set out below, with what has come in since.`;
            if (!tooLong && !unsaid.includes(told)) unsaid.push(told);
            const keptMail = restore.mail || mail;
            away();
            queue = [];
            doneAfter = undefined;
            mail = keptMail;
            if (S) sittingDay = Math.floor(obs.t / DAYS); // (that day's sitting is the one missed)
            backAt = 0;
            e.backAt = S ? nextSitting(obs.t + 1) : obs.t + DAYS;
            await note({ sitting_missed: { day: Math.floor(obs.t / DAYS), midway, back_at: e.backAt, why: tooLong ? "prompt_too_long" : "model_call_failed", error: String(e.message).slice(0, 300) } });
            throw e;
          }
          // No answer because the run is stopping (a limit): nothing it was to be shown is dropped. What was kept for it
          // stays kept, and this report joins it, so the call made again when the run is resumed shows the same.
          if (turn === 1) {
            if (fresh) {
              carried.push(now); // (with what was looked up for its opening, if anything was)
              ({ open, sittingDay, mail } = restore); // the sitting didn't happen: it's held when it can be
            } else if (!wasResult) extra.push(body);
            missed.push(obs);
          }
          throw e;
        }
        // Answered: it has now seen all of it. (A day it sat, whatever it did: its record of the run says from when to when.)
        [tally.first, tally.last] = [tally.first < 0 ? obs.t : tally.first, obs.t];
        messages = [...sending, { role: "assistant", content: res.content }];
        if (fresh && staffNow !== undefined) staffShown = staffNow;
        carried = [];
        missed = [];
        unsaid = unreadTwice ? [`When you were last here, ${unreadTwice}.`] : [];
        extra = [];
        results.clear();
        askedBack.clear();
        notDone.clear();
        after.clear();
        said.clear();
        quiet.clear();
        mail = false;
        papersAt = undefined;
        papersIn.clear();
        backEarly = false;
        stayOn = false;

        const uses = res.content.filter((b): b is Use => b.type === "tool_use");
        pending = uses.map((u) => ({ id: u.id, name: u.name }));
        const malformed = async (use: Use, what: string, why: string) => {
          // A malformed tool use: recorded, with why; it's told it wasn't done.
          notDone.set(use.id, { now: `Not done: ${why}.`, later: `When you were last here, ${what} was not done: ${why}.` });
          await note({ malformed_tool_use: JSON.stringify(use).slice(0, 4000), reason: why });
        };
        for (const n of uses.filter((x) => x.name === "notebook")) {
          // Written afresh, changed where a passage stands, or added to; what a use leaves alone stays as it was.
          const e = editNotebook(notes, n.input);
          if (!e.read) {
            notDone.set(n.id, { now: "Notebook not updated: its text couldn't be read. It still says what it said before.", later: "When you were last here, your notebook was not updated: its new text couldn't be read. It still says what it said before." });
            await note({ malformed_tool_use: JSON.stringify(n).slice(0, 4000), reason: "the notebook's text couldn't be read" });
            continue;
          }
          const same = e.text === notes;
          ages = notebookAges(notes, ages, e.text, obs.t);
          notes = e.text;
          notDone.delete(n.id);
          // What wasn't put in, and why: a whole notebook too long (its start is kept), a passage that isn't there, an
          // addition there's no room for. Never cut to fit without saying so.
          const why = [
            ...(e.cut ? [`it was too long (${e.cut.length} characters; it holds ${NOTEBOOK_MAX}), so only the first ${NOTEBOOK_MAX} characters were kept. It now ends: ${quote(e.text.slice(-60))}`] : []),
            ...e.problems,
          ].join("; ");
          if (why) {
            const how = same && !e.cut ? "not updated" : "updated only in part";
            const still = same && !e.cut ? " It still says what it said before." : "";
            notDone.set(n.id, { now: `Notebook ${how}: ${why}.${still}`, later: `When you were last here, your notebook was ${how}: ${why}.${still}` });
            if (e.cut) await note({ notebook_cut: e.cut });
            if (e.problems.length) await note({ notebook_not_changed: { reasons: e.problems, use: JSON.stringify(n).slice(0, 4000) } });
          }
        }
        // Stopping is always honoured (VISION §15) once it is the seat's own: clearly meant (optOutMeant), or confirmed when
        // asked (above), whatever its words. It isn't stepping down from an office, which is an act in the world.
        const optOut = uses.find((u) => u.name === "opt_out");
        if (optOut) {
          queue = [];
          tally.last = obs.t;
          if (!text(optOut.input?.statement)) await note({ opt_out_as_given: JSON.stringify(optOut).slice(0, 4000) });
          return away(), { type: "opt_out", statement: optOutStatement(optOut.input) };
        }
        const held = new Set((obs.positions ?? []).map((p) => p.position));
        const max = c.maxActions ?? 8;
        for (const use of uses) {
          if (use.name === "notebook" || use.name === "done_for_now") continue;
          const i = use.input;
          // A look it no longer wants at every sitting: nothing is looked up. Named with all it was asked with, that
          // one; with only the report, every one in that report.
          if (use.name === "look" && i?.each_sitting === false && reports.has(i.report)) {
            const whole = i.find === undefined && i.named === undefined && i.measure === undefined && i.current_only === undefined && i.limit === undefined;
            const gone = ready.filter((r) => (whole ? r.input.report === i.report : r.key === lookKey(i)));
            ready = ready.filter((r) => !gone.includes(r));
            said.set(use.id, gone.length ? `No longer looked up for you at each sitting: ${gone.map((r) => lookWords(r.input)).join("; ")}.` : "That wasn't being looked up for you at each sitting.");
            if (gone.length) await note({ look_each_sitting: { stopped: gone.map((r) => r.input), kept: ready.length } });
            continue;
          }
          const r = read(use, held);
          if (!("action" in r)) {
            await malformed(use, r.what, r.why);
            continue;
          }
          if (queue.length >= max) {
            notDone.set(use.id, { now: `Not done: at most ${max} actions at once.`, later: `When you were last here, ${r.what} was not done: you can take at most ${max} actions at once.` });
            await note({ dropped_tool_use: JSON.stringify(use).slice(0, 4000), reason: `more than ${max} actions in one answer` });
            continue;
          }
          queue.push({ id: use.id, action: r.action, ...(r.label ? { label: r.label } : {}), ...(r.looked ? { looked: r.looked } : {}), ...(r.kindSaid ? { kindSaid: r.kindSaid } : {}) });
          // (Kept on record, so that how often it happens can be counted: a subject line made of an `about` in words;
          // a reason or a note longer than a record holds.)
          if (r.subject !== undefined) await note({ letter_about_in_words: { about: r.subject.slice(0, 400), to: (r.action as any).to } });
          if (r.clipped) await note({ clipped: r.clipped, use: use.name });
          if (use.name !== "look") continue;
          lookIds.add(use.id);
          // A look to keep ready for every sitting from now on (it's made now too); or one it made last sitting as well,
          // which it's told it could keep ready.
          const key = lookKey(i);
          lookedNow.add(key);
          const kept = ready.some((x) => x.key === key);
          if (i.each_sitting === true && !kept) {
            if (ready.length >= READY_MAX) after.set(use.id, `\n\n(Not kept for every sitting: ${READY_MAX} are looked up for you at each already. Have one of them no longer looked up first.)`);
            else {
              const { each_sitting: _, ...input } = i;
              ready.push({ key, input });
              after.set(use.id, `\n\n(From now on this is looked up for you at the start of every sitting, and set out with your report.)`);
              await note({ look_each_sitting: { asked: input, kept: ready.length } });
            }
          } else if (!kept && lookedLast.has(key) && ready.length < READY_MAX)
            after.set(use.id, `\n\n(You looked this up at your last sitting too. It can be set out for you at the start of every sitting without your asking: look at it with each_sitting.)`);
        }
        // Only looks into whole reports (nothing to find, no one and nothing named), every one of them to be made, and
        // nothing said about being done: if there's nothing in any of them, nothing came of the answer.
        const lookUses = uses.filter((u) => u.name === "look");
        trays = lookUses.length > 0 && queue.length === lookUses.length && !notDone.size && uses.every((u) => u.name === "notebook" || u.name === "look")
          && lookUses.every((u) => u.input.raw === undefined && (u.input.find === undefined || (Array.isArray(u.input.find) && !u.input.find.length)) && u.input.named === undefined && u.input.measure === undefined && u.input.paper === undefined && u.input.about === undefined && u.input.since === undefined && u.input.words === undefined && u.input.from_entry === undefined);
        const done = uses.find((x) => x.name === "done_for_now");
        const days = Number.isInteger(done?.input?.days) && done!.input.days > 0 ? { days: done!.input.days as number } : {};
        if (done) lastDays = days.days;
        if (done && c.exactBack) exactTo = Number.isInteger(done.input?.at) ? (done.input.at as number) : null;
        // Kinds of paper that may wait for the sitting it sets: as it says, until it says again.
        if (done && papersBack && Array.isArray(done.input?.hold)) {
          hold = new Set((done.input.hold as unknown[]).filter(text).map((k) => kindSaid(k)));
          await note({ papers_held: [...hold] });
        }
        if (queue.length) {
          if (done) doneAfter = days;
          return next(obs);
        }
        // Nothing to carry out, though it tried something, and it hasn't said it's done: it's told now, in one more turn.
        if (notDone.size && !done && !retried) {
          retried = true;
          continue;
        }
        // Done for now (said, or by default: back at its usual rhythm, or when someone writes). Anything not done that it
        // hasn't been told of is said at the start of its next sitting.
        keepForNext();
        return leave(obs.t, days.days);
      }
    },

    async debrief(d) {
      // The fixed interview (debrief.ts), said beneath the seat's own standing instructions as it last had them, with
      // its notebook as it left it. What it did is in `d.summary`, made by code from the run's log: it has no other
      // memory of the run (VISION 15, point 7: an account of an experience it cannot remember is no account).
      return await runDebrief(io, { participant: c.participant, title: c.title ?? c.participant, entity: c.entityName && c.entityName !== c.entity ? `${c.entityName} (${c.entity})` : c.entity,
        framing: c.framing, system: lastSystem ?? c.framing.system ?? "", notebook: notes, ...(c.effort ? { effort: c.effort } : {}), ...(c.mockDebrief ? { mock: c.mockDebrief } : {}) }, d, seenSystems);
    },
  };
}
