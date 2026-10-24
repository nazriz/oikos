// What a language-model participant reads (principle 14: the platform is
// invisible to participants). An Observation becomes the reports a person in that role would
// read, in the world's own terms: accounts, letters, filings, titles,
// agreements, a survey of the town. No blocks, records, channels or refusal
// codes. Deterministic: the same observation always reads the same.

import { cents, moneyNow } from "../money";
import type { Body, Observation, Outcome, Reading, Record, SiteCell, SiteStructure, Transaction, VariableView } from "../contracts";
import { channels, citedWords, firstDue } from "../contracts";
import { refusalText } from "./words";

const DAY = 86_400;
const YEAR = 365 * DAY;

/** Money as people write it (money.ts). */
export const money = moneyNow;

export function when(t: number): string {
  return `year ${Math.floor(t / YEAR) + 1}, day ${Math.floor((t % YEAR) / DAY) + 1}`;
}

/** A length of time as people say one: whole years, else whole days, else hours and minutes; seconds only where it
 * comes to nothing rounder. */
export function duration(s: number): string {
  const n = (x: number, word: string) => `${num(x)} ${word}${x === 1 ? "" : "s"}`;
  if (s !== 0 && s % YEAR === 0) return n(s / YEAR, "year");
  if (s !== 0 && s % DAY === 0) return n(s / DAY, "day");
  if (s !== 0 && s % 3_600 === 0) return n(s / 3_600, "hour");
  if (s !== 0 && s % 60 === 0) return s > 3_600 ? `${n(Math.floor(s / 3_600), "hour")} ${n((s % 3_600) / 60, "minute")}` : n(s / 60, "minute");
  return n(s, "second");
}

// How a paper's details are read: its figures as a person reads them, not as a record holds them. A record holds
// money in its currency's smallest unit, lengths of time in seconds, moments in seconds since the start and rates in
// hundredths of a per cent; a detail is known for one of those by the name the world's papers give it (the lists
// below: names, never a place's figures), by the unit written beside it ({unit, value}), or, on a form, by what the
// form says the field is. Anything else stands as it is.
const MONEY_DETAILS = new Set(["amount", "unit_price", "price", "refund", "wage", "rent", "land", "levy_from", "balance", "cost", "fee", "fine", "deposit", "bond", "principal", "payment", "carrying"]);
const MONEY_LISTS = new Set(["prices", "demolition", "goods", "lines", "amounts"]);
const TIME_SPANS = new Set(["every", "period", "notice", "term"]);
// (Dates by the names the world's office papers give them: a payroll notice's first pay day read "first pay: 6652800"
// to the seats of 2026-10-09.)
const MOMENTS = new Set(["at", "since", "until", "first", "closes", "opens", "due", "first_due", "first_pay", "last_day", "last_from", "period_end"]);
const whole = (v: unknown): v is number | string => (typeof v === "number" && Number.isSafeInteger(v)) || (typeof v === "string" && /^-?(0|[1-9][0-9]{0,37})$/.test(v));
const percent = (v: number, per: number) => `${String(Number(((v * 100) / per).toFixed(6)))}%`;
/** A moment as a date, with the time of day where it is not the day's start (so that two moments never read alike). */
export function moment(t: number): string {
  const s = ((t % DAY) + DAY) % DAY;
  const two = (x: number) => String(x).padStart(2, "0");
  const day = t < 0 ? `${duration(Math.ceil(-t / DAY) * DAY)} before the start` : when(t);
  return s === 0 ? day : `${day}, ${two(Math.floor(s / 3_600))}:${two(Math.floor((s % 3_600) / 60))}${s % 60 ? `:${two(s % 60)}` : ""}`;
}
/** What a form says each of its fields is (`amount`, `duration`, `date`...), for a paper filled in on it. */
export type FieldKinds = { [field: string]: { type?: string } | undefined };

/** A paper's details with each figure as a person reads it (see above). The shape is kept; a rate's name loses the
 * unit it carried ("rate_bps": 1600 reads "rate": "16%"). `fields`: the form the details were filled in on. */
export function readable(x: unknown, how: { fields?: FieldKinds; money?: (a: string | number) => string } = {}, under?: string): unknown {
  const fields = how.fields;
  const sum = how.money ?? money;
  const deeper = { ...(how.money ? { money: how.money } : {}) };
  if (Array.isArray(x)) return x.map((v) => readable(v, deeper, under));
  if (x === null || typeof x !== "object") return x;
  const o = x as { [k: string]: unknown };
  // A figure with its unit beside it.
  if (whole(o.value) && typeof o.unit === "string" && Object.keys(o).every((k) => ["unit", "value", "label", "description", "type"].includes(k))) {
    const v = Number(o.value);
    const said = o.unit === "seconds" ? duration(v) : o.unit === "bps" || o.unit === "basis points" ? percent(v, 10_000) : o.unit === "ppm" ? percent(v, 1_000_000) : `${num(v)} ${o.unit}`;
    return Object.keys(o).length === 2 ? said : { ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== "unit" && k !== "value")), value: said };
  }
  const out: { [k: string]: unknown } = {};
  for (const [k, v] of Object.entries(o)) {
    const type = fields?.[k]?.type;
    if (!whole(v) || typeof v === "boolean") {
      // (A list of prices, a budget's lines: every one of them a sum. Not anything else that happens to have the name.)
      const sums = MONEY_LISTS.has(k) && v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v).length > 0 && Object.values(v).every(whole);
      out[k] = sums ? Object.fromEntries(Object.entries(v as object).map(([n, a]) => [n, sum(a as string)])) : readable(v, deeper, k);
      continue;
    }
    if (type) out[k] = type === "amount" ? sum(v) : type === "duration" ? duration(Number(v)) : type === "date" ? moment(Number(v)) : v;
    // (Of a standing instruction or a standing work order, `first` is how long after the paper was lodged its first
    // time falls, not a date: read as a date it was a day counted from the world's start, and a seat declined four
    // right drafts and confirmed a wrong one by it, 2026-10-09.)
    else if (k === "first" && (o.outcome !== undefined || o.work !== undefined)) out[k] = Number(v) === 0 ? "when it is lodged" : `${duration(Number(v))} after it is lodged`;
    else if (k.endsWith("_bps")) out[k.slice(0, -4)] = percent(Number(v), 10_000);
    else if (k.endsWith("_ppm")) out[k.slice(0, -4)] = percent(Number(v), 1_000_000);
    else if (MONEY_DETAILS.has(k) || (k === "from" && under === "brackets")) out[k] = sum(v);
    else if (TIME_SPANS.has(k) || k.endsWith("_seconds")) out[k.endsWith("_seconds") ? k.slice(0, -8) : k] = duration(Number(v));
    // (A notice of a new rent: the day it starts, beside the day the rent now paid started.)
    else if (MOMENTS.has(k) || k.endsWith("_at") || (k === "from" && whole(o.last_from))) out[k] = moment(Number(v));
    else out[k] = v;
  }
  return out;
}

/** Long text is cut short, with a mark, except in what the participant looked up (`whole`); `cuts` counts what a
 * report cut, so that it can say so. (Rendering is synchronous: both are set and read within one report.) */
/** Who someone is in the world, by any id of theirs: the id a seat names them by, what they are called, and whose post
 * it is. A participant has an id of the platform's own, which no seat is shown: an office is known by its post, a
 * person by themselves (principle 14). Set for the report being written. */
export type WhoIs = (id: string) => { id: string; name?: string; of?: string } | undefined;
let whoIs: WhoIs | undefined;
/** Whoever wrote a paper, as the world knows them. */
const writer = (id: string) => whoIs?.(id)?.id ?? id;
/** Someone by name and id, and the organisation whose post it is: how a letter is signed. */
function signed(id: string): string {
  const w = whoIs?.(id);
  const me = w?.id ?? id;
  const org = w?.of ? whoIs?.(w.of) : undefined;
  return `${w?.name && w.name !== me ? `${w.name} (${me})` : me}${w?.of ? `, ${org?.name && org.name !== w.of ? `${org.name} (${w.of})` : w.of}` : ""}`;
}
let inFull = false;
/** The books papers (an office's clerk's) set out in full among a list: the newest of each office's, whose words are the
 * day's list of cases to decide. Earlier ones are a line each, as they were. */
let booksWhole = new Set<string>();
/** The most of an office's books paper (its words) that is set out: a day's list of cases is not cut at a line or two. */
const BOOKS_WORDS_MAX = 60_000;
let cuts = 0;
const clip = (s: string, max = 400) => (inFull || s.length <= max ? s : (cuts++, s.slice(0, max) + "…"));
const words = (label: string) => label.replace(/_/g, " ");
const cap = (x: string) => words(x).replace(/^./, (c) => c.toUpperCase());
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** A name as someone might write it, for matching: case, underscores and hyphens don't matter. */
const plain = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ").trim();
const details = (raw: unknown, max = 400) => {
  if (raw === null || raw === undefined || typeof raw !== "object") return "";
  const x = readable(raw);
  const entries = Object.entries(x as object);
  const flat = entries.every(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
  return clip(flat ? entries.map(([k, v]) => `${words(k)}: ${v}`).join("; ") : JSON.stringify(x), max);
};
/** A statement's details. A form's are always whole: its fields are what it's filled in from, and whoever reads the
 * request made on it sees every one (a long form cut short reads as a form without its last fields). */
const dataWords = (r: { kind: string; data?: unknown }) => details(r.kind === "form" ? formAsShown(r.data) : r.data, r.kind === "form" ? Infinity : 400);
/** A form's details as whoever fills it in needs them: of a paper of the office's own, its name, whose it is and its
 * fields (how the paper is put together from them is the form's business, and is shown when it is filled in). */
function formAsShown(data: unknown): unknown {
  const d = data as { writes?: { kind?: string }; form?: unknown; office?: unknown; fields?: unknown } | undefined;
  return d?.writes ? { form: d.form, office: d.office, issues: d.writes.kind, fields: d.fields } : data;
}

/**
 * What came back from something the participant did, every part of it: what it made, what a survey estimated, what
 * an investigation found, and anything else it carries, by name, so that nothing that comes back is dropped for want
 * of words here (VISION 15: what comes back to a code participant comes back to a model in the same seat). Left out
 * on purpose: the act's own number and the engine's wording of why not, which are the platform's (principle 14);
 * why not is said in the world's words.
 */
export function outcomeLines(x: Outcome, what: string, now: number): string[] {
  const o = x as Outcome & { [k: string]: any };
  const value = (v: unknown): string => (v !== null && typeof v === "object" ? details(v, Infinity) : String(v));
  const more = (from: object, said: string[]) => Object.entries(from).filter(([k]) => !said.includes(k)).map(([k, v]) => ` ${cap(k)}: ${value(v)}.`).join("");
  const rest = Object.entries(o).filter(([k]) => !["action", "t", "status", "created", "refusal", "surveyed", "investigated", "seen"].includes(k)).map(([k, v]) => `  ${cap(k)}: ${value(v)}.`);
  const at = o.t !== undefined && Math.floor(o.t / DAY) !== Math.floor(now / DAY) ? ` (${when(o.t)})` : "";
  if (o.status !== "applied") {
    const part = o.refusal?.block;
    const why = Number.isInteger(part) && part! > 0 ? refusalText(o.refusal?.code, part, 2) : refusalText(o.refusal?.code);
    return [`${what} couldn't be done${at}: ${why}.${more(o.refusal ?? {}, ["code", "block", "detail"])}`, ...rest];
  }
  const out = [`Done${at}: ${what.charAt(0).toLowerCase()}${what.slice(1)}.`];
  const made = Object.entries(o.created ?? {});
  if (made.length) out.push(`  It made: ${made.map(([name, id]) => `${id} (${words(name)})`).join(", ")}.`);
  if (o.surveyed) {
    const cells = Object.entries(o.surveyed.cells ?? {}) as [string, number][];
    const total = cells.reduce((a, [, n]) => a + n, 0);
    out.push(`  What the survey of ${words(String(o.surveyed.of))} found, place by place (estimates): ${cells.map(([c, n]) => `${c}: ${num(n)}`).join("; ") || "nothing"}${cells.length > 1 ? `. In all: ${num(total)}` : ""}.${more(o.surveyed, ["of", "cells"])}`);
  }
  if (o.investigated) {
    const i = o.investigated as { [k: string]: any };
    const into = `${i.kind !== undefined ? words(String(i.kind)) : "what was"} taken from ${i.from ?? "(not said)"}${i.at !== undefined ? ` at ${i.at}` : ""}`;
    const found = !i.taken ? "nothing of the kind was found to have been taken there" : i.taker ? `it was taken, by ${i.taker}` : "it was taken, but who took it wasn't found";
    out.push(`  What the investigation into ${into} found: ${found}.${more(i, ["from", "at", "kind", "taken", "taker"])}`);
  }
  // Work on a building: those who did it were there, and this is how they left it.
  if (o.seen?.length) out.push("  As those who did the work left it:", ...describeBuildings(o.seen as SiteStructure[], "", now).map((l) => l.split("\n").map((x) => `  ${x}`).join("\n")));
  return [...out, ...rest];
}

/**
 * A statement's rule, where it has one on record: its Institutional Grammar breakdown (who may, must or must not do
 * what, when, or else what), and whether there is a condition acts are checked against. This is what gives a law its
 * force for every office, landlord and firm that checks what it's about to do: someone reading a law sees whether it
 * has one (VISION 15: nothing that binds is in a field only code reads). Empty for a statement in words only.
 *
 * The condition itself is written in the platform's own notation (`block.kind == …`), which a participant reading its
 * reports never sees (principle 14): there it's said that acts are checked against the rule. `asWritten` gives the
 * condition word for word, for the one place it has to be seen: the preview of an act that would publish it, where
 * whoever confirms must see everything the act carries.
 */
export function ruleWords(r: { adico?: any; formal?: any }, o: { asWritten?: boolean } = {}): string {
  const a = r.adico;
  const more = (x: any, said: string[]) => Object.entries(x).filter(([k]) => !said.includes(k)).map(([k, v]) => `; ${words(k)}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("");
  const deontic = ({ may: "may", must: "must", must_not: "must not" } as { [k: string]: string })[a?.deontic] ?? a?.deontic;
  const rule = a ? `Its rule, as recorded: ${[a.attribute ?? "(nobody named)", deontic ?? "(may, must or must not isn't said)", a.aim ?? "(no action named)"].join(" ")}${a.condition ? `, ${a.condition}` : ""}${a.or_else ? `; or else: ${a.or_else}` : ""}${more(a, ["attribute", "deontic", "aim", "condition", "or_else"])}.` : "";
  const f = r.formal;
  const formal = !f ? "" : o.asWritten ? `The condition acts are checked against, as written${f.language === "cel" ? "" : ` (in ${f.language})`}: ${f.condition}${more(f, ["language", "condition"])}.`
    : a ? "Offices and others check what they do against it." : "Offices and others check what they do against a condition recorded with it.";
  return [rule, formal].filter(Boolean).join(" ");
}

/** An outcome someone commits to or is asked for (§9), in words. */
export function outcomeWords(o: any, every?: number, by?: string): string {
  const rep = every ? ` every ${duration(every)}` : "";
  if (o?.goods) return `deliver ${o.goods.quantity} ${o.goods.kind} to ${o.goods.to} at ${o.goods.at}${rep}`;
  if (o?.money) return `pay ${money(o.money.amount)}${o.money.from ? ` from ${o.money.from}` : ""} to ${o.money.to}${rep}${o.money.for ? ` (${o.money.for})` : ""}`;
  if (o?.structure) return o.structure.remove ? `demolish ${o.structure.remove}` : `build a ${o.structure.type} on ${o.structure.on}`;
  // (Whoever commits to be in a place themselves comes there: a worker and their place of work read "c0009 will let
  // c0009 live or be in town-hall/workplace.1" until 2026-10-11, and a finance seat held a wage over the "garbled" terms.)
  if (o?.occupancy) return by !== undefined && o.occupancy.who === by ? (o.occupancy.leave ? `leave ${o.occupancy.in}` : `come to ${o.occupancy.in}`) : o.occupancy.leave ? `have ${o.occupancy.who} leave ${o.occupancy.in}` : `let ${o.occupancy.who} live or be in ${o.occupancy.in}`;
  if (o?.account) return o.account.close ? `close account ${o.account.close}` : `open an account for ${o.account.holder}`;
  return "do what the terms say";
}

const POSITION: { [p: string]: string } = { right: "has a right", liberty: "is permitted", power: "has the power", immunity: "is immune" };

/** How an agreement stands by its own terms: whether it's in force, when it ends, what's due and owing. */
function readingWords(x: Reading | undefined): string {
  if (!x) return "";
  const named = (m: { [k: string]: string }, k: string) => m[k] ?? words(k);
  const status = x.status ? named({ offered: "offered, not yet in force", in_force: "in force", ending: "ending", ended: "ended" }, x.status) : "";
  const end = x.ends_at !== undefined ? `${x.status === "ended" ? "ended" : "ends"} ${when(x.ends_at)}${x.ended_by ? ` (${named({ term: "its term ran out", notice: "by notice", parties: "by the parties" }, x.ended_by)})` : ""}` : "";
  const due = (x.obligations ?? []).filter((b) => b.next_due !== undefined || (b.arrears !== undefined && b.arrears !== "0"))
    .map((b) => `commitment ${b.commitment + 1}${b.next_due !== undefined ? ` next due ${when(b.next_due)}` : ""}${b.arrears !== undefined && b.arrears !== "0" ? `, ${money(cents(b.arrears))} owing` : ""}`);
  const all = [status, end, ...due].filter(Boolean);
  return all.length ? `. As it stands: ${all.join("; ")}` : "";
}

function describe(r: Record, readings?: { [id: string]: Reading }): string {
  const from = r.author === "genesis" ? "" : ` (${when(r.at)})`;
  const who = r.speaks_for ?? writer(r.author);
  switch (r.record) {
    case "statement": {
      // (A standing instruction says when it first falls due, as whoever acts on it counts.)
      if (r.kind === "request" && r.data?.outcome) return `[${r.id}] ${who} asked ${(r.addressed_to ?? []).join(", ")} to ${outcomeWords(r.data.outcome, r.data.every)}${whole(r.data.every) && Number(r.data.every) > 0 ? `, the first due ${moment(firstDue(r, Number(r.data.every)))}` : ""}${from}`;
      // A ballot that is closed is said to be closed, with where its result is, and never as closing on a day gone
      // by; a result says who voted which way where the paper says (a council's votes are public record: an
      // election's result carries no names, and none are shown).
      const closed = r.kind === "ballot" && r.data?.closed === true;
      const named = r.kind === "ballot_result" && (Array.isArray(r.data?.voted_for) || Array.isArray(r.data?.voted_against));
      const shownData = closed ? Object.fromEntries(Object.entries(r.data as object).filter(([k]) => !["closes_at", "closed", "result"].includes(k)))
        : named ? Object.fromEntries(Object.entries(r.data as object).filter(([k]) => k !== "voted_for" && k !== "voted_against"))
        // (A standing work order: when it first falls due, as its staff count, in place of how that was written.)
        // (The office's books: the line says what has changed; the list of everything that stands open is read by opening the paper.)
        : r.kind === "office_books" && Array.isArray(r.data?.open) && !inFull ? { stands_open: r.data.open.length, the_list: `in this paper (${r.id}), read by its id` }
        : r.kind === "work_order" && r.data?.work && whole(r.data?.every) ? { ...Object.fromEntries(Object.entries(r.data as object).filter(([k]) => k !== "first" && k !== "first_at")), first_due: firstDue(r, 0) } : r.data;
      const voters = (list: unknown) => (Array.isArray(list) && list.length ? list.map((p) => writer(String(p))).join(", ") : "nobody");
      const d = [closed ? `closed: no more votes are taken${typeof r.data.result === "string" ? `; its result is ${r.data.result}` : ""}` : "", dataWords({ kind: r.kind, data: shownData }),
        named ? `voted for: ${voters(r.data.voted_for)}; voted against: ${voters(r.data.voted_against)}` : ""].filter(Boolean).join("; ");
      const rule = ruleWords(r);
      return `[${r.id}] ${words(r.kind)} from ${who}${r.place ? `, put up on ${r.place}` : ""}${r.addressed_to ? `, to ${r.addressed_to.join(", ")}` : ""}${from}: "${clip(r.text, booksWhole.has(r.id) ? BOOKS_WORDS_MAX : 1000)}"${d ? ` (${d})` : ""}${r.basis ? `, citing ${citedWords(r)}` : ""}${rule ? `. ${rule}` : ""}`;
    }
    case "claim":
      return `[${r.id}] ${r.holder} ${POSITION[r.position] ?? r.position}${r.counterparty ? ` against ${r.counterparty}` : ""}: ${details(r.about) || "(no details)"}${r.basis ? `, citing ${citedWords(r)}` : ""}${from}`;
    case "agreement": {
      const c = r.terms.commitments.map((x) => `${x.who} will ${x.does?.outcome ? outcomeWords(x.does.outcome, x.every, x.who) : clip(JSON.stringify(x.does), 200)}`).join("; ");
      return `[${r.id}] ${r.terms.template ? `${words(r.terms.template)} agreement` : "agreement"} between ${r.terms.parties.join(" and ")}${r.terms.term ? `, for ${duration(r.terms.term)}` : ""}: ${c || "no commitments"}${r.terms.text ? `. "${clip(r.terms.text)}"` : ""}${from}${readingWords(readings?.[r.id])}`;
    }
    case "signature":
      return `[${r.id}] ${r.as} signed ${r.agreement}${from}`;
    case "notice":
      return `[${r.id}] ${r.as} gave notice on ${r.agreement}${r.text ? `: "${clip(r.text)}"` : ""}${from}`;
    case "withdrawal":
      return `[${r.id}] ${who} withdrew ${r.withdraws}${r.text ? `: "${clip(r.text)}"` : ""}${from}`;
    case "vote":
      // (A vote is whoever cast it's: the post it was cast in, where it was cast in one, not the organisation the post is of.)
      return `[${r.id}] ${r.in_position ? writer(r.in_position) : who} voted "${r.choice}" on ${r.ballot}${from}`;
    case "claim_transfer":
      return `[${r.id}] ${r.claim} now belongs to ${r.to}${from}`;
    case "claim_release":
      return `[${r.id}] ${r.claim} was released${from}`;
    case "entity_declaration":
      return `[${r.id}] ${who} set up a ${r.kind}, "${r.name}" (${r.entity})${from}`;
  }
}

/**
 * Records as report lines. Runs of similar claims are totalled (a registry
 * extract, not 200 titles) and votes are tallied per ballot, as a person would
 * be told them; everything else is listed one by one, in order.
 */
function recordLines(records: Record[], readings?: { [id: string]: Reading }, oneByOne = false): string[] {
  // (An office's books: the newest paper of each clerk is set out whole, since it is the day's list; the earlier ones
  // in the same list say what changed then, in a line each, as before.)
  const newest = new Map<string, string>();
  for (const r of records) if (r.record === "statement" && r.kind === "office_books") newest.set(String(r.speaks_for ?? r.author), r.id);
  booksWhole = oneByOne ? new Set(records.filter((r) => r.record === "statement" && r.kind === "office_books").map((r) => r.id)) : new Set(newest.values());
  try { return recordLinesOf(records, readings, oneByOne); } finally { booksWhole = new Set(); }
}
function recordLinesOf(records: Record[], readings?: { [id: string]: Reading }, oneByOne = false): string[] {
  const describeRecord = (r: Record) => describe(r, readings);
  // What was looked up is listed one by one: it was asked for.
  if (oneByOne) return records.map(describeRecord);
  const groups = new Map<string, Extract<Record, { record: "claim" }>[]>();
  const tallies = new Map<string, Extract<Record, { record: "vote" }>[]>();
  const order: (Record | string)[] = [];
  for (const r of records) {
    if (r.record === "claim") {
      const key = `claim|${r.holder}|${r.position}|${r.counterparty ?? ""}|${r.about?.kind ?? ""}`;
      if (!groups.has(key)) order.push(key);
      groups.set(key, [...(groups.get(key) ?? []), r]);
    } else if (r.record === "vote") {
      const key = `vote|${r.ballot}`;
      if (!tallies.has(key)) order.push(key);
      tallies.set(key, [...(tallies.get(key) ?? []), r]);
    } else order.push(r);
  }
  return order.map((x) => {
    if (typeof x !== "string") return describeRecord(x);
    const g = groups.get(x);
    if (g) {
      if (g.length < 4) return g.map(describeRecord).join("\n- ");
      const c = g[0]!;
      const objects = g.map((r) => r.about?.object ?? r.id);
      const total = g.reduce((a, r) => a + (Number.isInteger(r.about?.amount) ? r.about.amount : 0), 0);
      // Grouped by what the claims say, in the world's own words (its `about.kind`), with no special cases.
      const what = `${g.length} ${c.about?.kind ? `${words(c.about.kind)} ` : ""}claims: ${c.holder} ${POSITION[c.position] ?? c.position}${c.counterparty ? ` against ${c.counterparty}` : ""}`;
      return `${what}${total ? `, totalling ${money(total)}` : ""}: ${objects.slice(0, 12).join(", ")}${objects.length > 12 ? (cuts++, `, and ${objects.length - 12} more`) : ""}`;
    }
    const v = tallies.get(x)!;
    const counts = new Map<string, number>();
    for (const r of v) counts.set(r.choice, (counts.get(r.choice) ?? 0) + 1);
    // (Votes cast in a post are public record, and say whose they are; a vote cast in no post, an elector's, is counted and no more.)
    const by = (choice: string) => v.filter((r) => r.choice === choice && r.in_position).map((r) => writer(r.in_position!));
    return `${v.length} vote${v.length === 1 ? "" : "s"} on ${v[0]!.ballot}: ${[...counts].sort().map(([c, n]) => `${c} ${n}${by(c).length ? ` (${by(c).join(", ")})` : ""}`).join(", ")}`;
  });
}

const attrWords = (a: unknown) => (a && typeof a === "object" && Object.keys(a).length ? ` (${details(a, 120)})` : "");

/** What a building's state comes to today: its value when last seen, carried on by its daily change, within its bounds. */
const today = (v: VariableView, t: number) => Math.min(v.max, Math.max(v.min, v.value + v.per_day * Math.max(0, Math.floor(t / DAY) - v.as_of_day)));
/** Which way it's going, in words. */
function trend(v: VariableView, now: number): string {
  if (v.per_day > 0) return now >= v.max ? "as high as it goes" : `rising ${num(v.per_day)} a day`;
  if (v.per_day < 0) return now <= v.min ? "as low as it goes" : `falling ${num(-v.per_day)} a day`;
  return "steady";
}
const sorted = <T>(m: { [name: string]: T } | undefined) => Object.entries(m ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
/** A building's state: each measure kept of it, by the name the world gives it, how much today and which way it's
 * going. Whatever the world keeps is said; no measure is known here by name. */
const stateWords = (s: SiteStructure, t: number) => sorted(s.variables).map(([name, v]) => `${words(name)} ${num(today(v, t))}, ${trend(v, today(v, t))}`).join("; ");
/** How far each measure runs, said once for the buildings listed. */
function scales(structures: SiteStructure[]): string[] {
  const m = new Map<string, [number, number]>();
  for (const s of structures) for (const [name, v] of sorted(s.variables)) m.set(name, [Math.min(v.min, m.get(name)?.[0] ?? v.min), Math.max(v.max, m.get(name)?.[1] ?? v.max)]);
  return m.size ? [`(How far each runs: ${[...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, [lo, hi]]) => `${words(name)} from ${num(lo)} to ${num(hi)}`).join("; ")}.)`] : [];
}
/** What lives on the ground, where anyone there would notice it: which kinds, on how many cells. */
function seenWords(cells: SiteCell[]): string[] {
  const m = new Map<string, number>();
  for (const c of cells) for (const kind of c.seen ?? []) m.set(kind, (m.get(kind) ?? 0) + 1);
  return m.size ? [`Seen living there: ${[...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([kind, n]) => `${words(kind)} (on ${num(n)} cell${n === 1 ? "" : "s"})`).join(", ")}.`] : [];
}

const GONE: { [reason: string]: string } = { left: "left", removed: "was removed", demolition: "the building came down", departed: "left town", died: "died", flooded: "was flooded out" };

/** Buildings one by one: their state, their spaces, how full each is, and who's there where the participant can tell.
 * `full` (what it asked to see): every space, however many, with who has gone from it, and who built it. */
function describeBuildings(structures: SiteStructure[], me: string, t: number, full = false): string[] {
  return structures.map((s) => {
    const state = stateWords(s, t);
    const head = `- ${words(s.type)} ${s.structure}, at ${s.at}${s.w * s.h > 1 ? ` (${s.w} by ${s.h} cells)` : ""}${s.complete ? "" : `, being built${s.completes_at ? ` until ${when(s.completes_at)}` : ""}`}${s.coming_down ? ", being demolished" : ""}${full && s.built_by ? `, built by ${s.built_by}` : ""}${state ? `: ${state}` : ""}`;
    if (!s.complete) return head;
    const lines = full || s.spaces.length <= 8
      ? s.spaces.map((x) => {
          const who = (x.occupants ?? []).map((o) => (o === me ? "you" : o));
          const gone = full ? (x.left ?? []).map((d) => `${d.occupant === me ? "you" : d.occupant} (${GONE[d.reason] ?? words(d.reason)}, ${when(d.at)})`) : [];
          // (From outside: when anyone was last seen going in or coming out, never who.)
          const stir = full && x.occupants === undefined ? [x.seen_entering !== undefined ? `someone last seen going in ${when(x.seen_entering)}` : "", x.seen_leaving !== undefined ? `someone last seen leaving ${when(x.seen_leaving)}` : ""].filter(Boolean) : [];
          return `  - ${x.space}, a ${words(x.kind)}${attrWords(x.attrs)}: ${x.count} ${x.count === 1 ? "person" : "people"} (room for ${x.capacity})${who.length ? `: ${who.join(", ")}` : ""}${gone.length ? `; gone from it: ${gone.join(", ")}` : ""}${stir.length ? `; ${stir.join(", ")}` : ""}`;
        })
      : [...groupSpaces(s.spaces).values()].map((g) => `  - ${g.n} ${words(g.kind)}s${g.attrs}: ${g.used} in use, ${g.people} people${g.mine.length ? `; yours: ${g.mine.join(", ")}` : ""}`);
    return [head, ...lines].join("\n");
  });

  function groupSpaces(spaces: SiteStructure["spaces"]) {
    const m = new Map<string, { kind: string; n: number; used: number; people: number; attrs: string; mine: string[] }>();
    for (const x of spaces) {
      const key = `${x.kind}${attrWords(x.attrs)}`;
      const g = m.get(key) ?? { kind: x.kind, n: 0, used: 0, people: 0, attrs: attrWords(x.attrs), mine: [] };
      g.n++;
      if (x.count) g.used++;
      g.people += x.count;
      if ((x.occupants ?? []).includes(me)) g.mine.push(x.space);
      m.set(key, g);
    }
    return m;
  }
}

/** How many of the worst are named, of the buildings a measure is above zero at, when a town is surveyed. */
const WORST = 5;

/** A town survey: counts, not raw cells; and, of each measure kept of its buildings, how many it's above zero at or
 * rising at, and the worst few by name (with how many more), so that "which ones" has an answer. */
function describeSurvey(cells: number, open: number, structures: SiteStructure[], asOf: number, t: number): string[] {
  const byType = new Map<string, { done: number; building: number }>();
  const spaces = new Map<string, { kind: string; attrs: string; used: number; total: number; people: number }>();
  const measures = new Map<string, { s: SiteStructure; v: VariableView; now: number }[]>();
  for (const s of structures) {
    const c = byType.get(s.type) ?? { done: 0, building: 0 };
    s.complete ? c.done++ : c.building++;
    byType.set(s.type, c);
    for (const [name, v] of sorted(s.variables)) {
      if (!measures.has(name)) measures.set(name, []);
      measures.get(name)!.push({ s, v, now: today(v, t) });
    }
    if (!s.complete) continue;
    for (const x of s.spaces) {
      const key = `${x.kind}${attrWords(x.attrs)}`;
      const u = spaces.get(key) ?? { kind: x.kind, attrs: attrWords(x.attrs), used: 0, total: 0, people: 0 };
      u.total++;
      if (x.count) u.used++;
      u.people += x.count;
      spaces.set(key, u);
    }
  }
  const types = [...byType].sort().map(([ty, c]) => `${c.done} ${words(ty)}${c.building ? ` (and ${c.building} being built)` : ""}`).join(", ");
  const use = [...spaces].sort().map(([, u]) => `${u.used} of ${u.total} ${words(u.kind)}s${u.attrs} in use, ${u.people} people`).join("; ");
  const state = [...measures].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, all]) => {
    const up = all.filter((x) => x.now > 0).sort((a, b) => b.now - a.now || (a.s.structure < b.s.structure ? -1 : 1));
    const rising = all.filter((x) => x.v.per_day > 0 && x.now < x.v.max).length;
    const worst = up.slice(0, WORST).map((x) => `${words(x.s.type)} ${x.s.structure} ${num(x.now)} (${trend(x.v, x.now)})`);
    return `${cap(name)}: above zero at ${up.length} of ${all.length} buildings, rising at ${rising}.${worst.length ? ` Highest: ${worst.join("; ")}${up.length > WORST ? `; and ${up.length - WORST} more above zero` : ""}.` : ""}`;
  });
  return [`As of ${when(asOf)}: ${cells} cells of ground, ${open} of them open. Buildings: ${types || "none"}. ${use ? `${use}.` : ""}`.trim(), ...state, ...scales(structures)];
}

/** What a seat is told when it has sent someone to look at a place it is not at. */
const WAITING_ON_KEEPER = "Your question is still with the one who keeps this. The answer comes when they have done it; until then nothing is known either way.";
const SET_OUT = "Someone has set out. What they find comes with the report after they are back.";

/** What a participant asked to see when it looked at a report: places or people by name, the buildings a measure is
 * above zero or rising at, and how many at most. Of papers: what the list is narrowed by beyond what whoever keeps them
 * can be asked (`about`, `words`, the kinds in plain words), one paper to read in full (`paper`, a long one from
 * `fromEntry` on), and a kind asked for that nothing was found under (`kindSaid`: this is the folder's latest
 * papers, looked through for kinds like it). */
export interface Looked {
  named?: string[]; measure?: string; limit?: number; /** Someone was sent to the places named: what they find comes later. */ sent?: true;
  paper?: string; fromEntry?: number; about?: string; words?: string; kinds?: string[]; kindSaid?: string;
  /** What was asked for, in words (what to find, about what, since when), as the answer says back what was searched. */
  said?: string;
  /** How many papers at most were asked of whoever keeps them (more than `limit` where the list is narrowed here). */
  fetched?: number;
}

/** The most one look adds to what a seat is shown, in characters: a list, a paper, places, people. What is over is cut
 * at the end of a line, and said. (A paper longer than `PAPER_MAX` is read a part at a time.) */
export const LOOK_CHARS_MAX = 12_000;
export const PAPER_MAX = 6_000;
/** The most one line of a list of papers says of the paper. */
const GIST_MAX = 160;

/** What a paper is, in a person's words: a statement by its kind, an agreement by what it is an agreement for, a claim
 * by what it is a claim to; the rest by what they are. What a seat names a kind by, and what a list says. */
export function paperKind(r: Record): string {
  switch (r.record) {
    case "statement": return words(r.kind);
    case "agreement": return r.terms.template ? `${words(r.terms.template)} agreement` : "agreement";
    case "claim": return r.about?.kind ? `${words(String(r.about.kind))} claim` : "claim";
    case "claim_transfer": return "claim transfer";
    case "claim_release": return "claim release";
    case "entity_declaration": return "declaration";
    default: return words(r.record);
  }
}
/** A kind as someone might say it, for matching: case, underscores, hyphens and a plural "s" don't matter. */
export const kindSaid = (s: string) => plain(s).replace(/\s+/g, " ").replace(/(?<=[a-z]{3})s$/, "");
/** Whether a paper is of one of the kinds said (a folder's, or what a look asked for). */
export const ofKind = (r: Record, kinds: string[]) => kinds.some((k) => kindSaid(paperKind(r)) === kindSaid(k) || (kindSaid(k) === "standing payment" && standingPayment(r)));
/** A standing payment: a request to pay, again and again (what a payroll folder holds beside the agreements it pays). */
const standingPayment = (r: Record) => r.record === "statement" && r.kind === "request" && Number.isSafeInteger(r.data?.every) && r.data.every > 0 && !!r.data?.outcome?.money;
/** Whether a paper names an id anywhere in it (its parties, whom it is to, what it cites, its details). */
const namesId = (r: Record, id: string) => JSON.stringify(r).includes(JSON.stringify(id));
/** Whether every word asked for is somewhere in a paper (capitals aside). */
const says = (x: unknown, asked: string) => {
  const all = JSON.stringify(x).toLowerCase();
  return asked.toLowerCase().split(/\s+/).filter(Boolean).every((w) => all.includes(w));
};

/** One paper as a line of a list: its id, what it is, its date, from whom, and a line of what it says. */
function listLine(r: Record, readings?: { [id: string]: Reading }): string {
  const who = r.record === "vote" && r.in_position ? writer(r.in_position) : r.speaks_for ?? (r.author === "genesis" ? undefined : writer(r.author));
  const date = r.author === "genesis" && r.at === 0 ? "from the start" : when(r.at);
  const cut = (x: string) => (x.length > GIST_MAX ? `${x.slice(0, GIST_MAX)}…` : x);
  let gist: string;
  switch (r.record) {
    case "statement": gist = r.kind === "request" && r.data?.outcome ? `asks ${(r.addressed_to ?? []).join(", ") || "someone"} to ${outcomeWords(r.data.outcome, r.data.every)}` : `${r.addressed_to?.length ? `to ${r.addressed_to.join(", ")}: ` : ""}"${cut(r.text)}"`; break;
    case "agreement": gist = `between ${r.terms.parties.join(" and ")}: ${cut(r.terms.commitments.map((x) => `${x.who} will ${x.does?.outcome ? outcomeWords(x.does.outcome, x.every, x.who) : "do what its terms say"}`).join("; ") || "no commitments")}${readingWords(readings?.[r.id])}`; break;
    case "claim": gist = `${r.holder} ${POSITION[r.position] ?? r.position}${r.counterparty ? ` against ${r.counterparty}` : ""}${r.about?.object ? `: ${r.about.object}` : ""}`; break;
    case "signature": gist = `${r.as} signed ${r.agreement}`; break;
    case "notice": gist = `${r.as} gave notice on ${r.agreement}`; break;
    case "withdrawal": gist = `withdraws ${r.withdraws}`; break;
    case "vote": gist = `"${r.choice}" on ${r.ballot}`; break;
    case "claim_transfer": gist = `${r.claim} now belongs to ${r.to}`; break;
    case "claim_release": gist = `${r.claim} was released`; break;
    case "entity_declaration": gist = `a ${r.kind}, "${r.name}" (${r.entity})`; break;
  }
  return `[${r.id}] ${paperKind(r)}, ${date}${who ? `, from ${who}` : ""}: ${gist}`;
}

/** A list of papers, at most `limit` lines of it: a line to a paper, but a run of claims alike (a registry's titles
 * to lot after lot, one holder's, of one day) in one line, as a person would be told them. `left`: papers not reached. */
function listLines(records: Record[], limit: number, readings?: { [id: string]: Reading }): { lines: string[]; left: number } {
  const lines: string[] = [];
  let i = 0;
  while (i < records.length && lines.length < limit) {
    const r = records[i]!;
    let j = i + 1;
    if (r.record === "claim") while (j < records.length && alike(r, records[j]!)) j++;
    if (j - i >= 4) {
      const run = records.slice(i, j) as Extract<Record, { record: "claim" }>[];
      const who = r.speaks_for ?? (r.author === "genesis" ? undefined : writer(r.author));
      lines.push(`${num(run.length)} ${paperKind(r)}s, ${r.author === "genesis" && r.at === 0 ? "from the start" : when(r.at)}${who ? `, from ${who}` : ""}: ${run[0]!.holder} ${POSITION[run[0]!.position] ?? run[0]!.position}: ${run.slice(0, 6).map((x) => `${x.about?.object ?? x.id} [${x.id}]`).join(", ")}${run.length > 6 ? `, and ${num(run.length - 6)} more (to find one, say what it is about)` : ""}`);
      i = j;
    } else lines.push(listLine(records[i++]!, readings));
  }
  return { lines, left: records.length - i };
}
const alike = (a: Record, b: Record) => a.record === "claim" && b.record === "claim" && a.at === b.at && a.holder === b.holder && a.position === b.position && a.counterparty === b.counterparty && a.about?.kind === b.about?.kind && a.speaks_for === b.speaks_for;

/** One entry of a list in a paper (a lot of a register, an area of a map), in a line: each thing it says by name. */
function entryWords(raw: unknown): string {
  const e = readable(raw);
  if (e === null || typeof e !== "object" || Array.isArray(e)) return clipTo(typeof e === "object" ? JSON.stringify(e) : String(e), 600);
  const value = (v: unknown): string => (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object") ? v.join(", ") : v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));
  return clipTo(Object.entries(e).map(([k, v]) => `${words(k)}: ${value(v)}`).join("; "), 600);
}
const clipTo = (x: string, max: number) => (x.length > max ? `${x.slice(0, max)}…` : x);

/** One paper in full. A long one (a register, a map) is read a part at a time: its words, then of each list among its
 * details the entries asked for (from `fromEntry` on, or those that include `words`), as many as fit, with how many
 * there are and how to ask for more. Never whole. */
function paperInFull(r: Record, asked: Looked, readings?: { [id: string]: Reading }): string[] {
  inFull = true;
  let all: string;
  try {
    all = describe(r, readings);
  } finally {
    inFull = false;
  }
  const narrowed = asked.words !== undefined || (asked.fromEntry ?? 1) > 1;
  const lists: [string, unknown[]][] = r.record === "statement" && r.data !== null && typeof r.data === "object" ? Object.entries(r.data as object).filter((e): e is [string, unknown[]] => Array.isArray(e[1]) && e[1].length > 1) : [];
  if (all.length <= PAPER_MAX && !(narrowed && lists.length)) return [`- ${all}`];
  if (r.record !== "statement" || !lists.length) return [`- ${all.slice(0, PAPER_MAX)}…`, `(Cut short at ${num(PAPER_MAX)} of its ${num(all.length)} characters.)`];
  // (An office's books paper: its words are the day's list of cases, set out whole; the list below takes its own room.)
  const books = r.record === "statement" && r.kind === "office_books";
  const wordsMax = books ? BOOKS_WORDS_MAX : 2000;
  const out = [`- [${r.id}] ${paperKind(r)} from ${r.speaks_for ?? writer(r.author)}${r.author === "genesis" ? "" : ` (${when(r.at)})`}: "${r.text.length > wordsMax ? `${r.text.slice(0, wordsMax)}…` : r.text}"`];
  let room = books ? PAPER_MAX : PAPER_MAX - out[0]!.length;
  for (const [k, v] of Object.entries(r.data as object)) {
    if (lists.some(([name]) => name === k)) continue;
    const said = `  ${cap(k)}: ${v !== null && typeof v === "object" ? details(v, 1500) : String(v)}`;
    out.push(said.length > 1600 ? `${said.slice(0, 1600)}…` : said);
    room -= out.at(-1)!.length + 1;
  }
  for (const [k, entries] of lists) {
    const picked = entries.map((e, i) => [i + 1, e] as const).filter(([, e]) => asked.words === undefined || says(e, asked.words));
    const from = Math.max(1, asked.fromEntry ?? 1);
    const rest = picked.filter(([n]) => n >= from);
    out.push(`  ${cap(k)}: ${num(entries.length)} entries${asked.words !== undefined ? `, ${num(picked.length)} of them with "${asked.words}"` : ""}.`);
    let last = 0, shown = 0;
    for (const [n, e] of rest) {
      // (An entry of the books whose line the paper's words have set out whole is not set out twice.)
      const said = books && e !== null && typeof e === "object" && typeof (e as any).says === "string" && (e as any).says.length > 40 && r.text.includes((e as any).says);
      const line = said ? `  ${n}. ${(e as any).about}: set out above, in the day's list` : `  ${n}. ${entryWords(e)}`;
      if (line.length + 1 > room && shown > 0) break;
      out.push(line);
      room -= line.length + 1;
      [last, shown] = [n, shown + 1];
      if (room <= 0) break;
    }
    const more = rest.length - shown;
    if (!rest.length) out.push(picked.length ? `  (None from entry ${num(from)} on.)` : "  (None.)");
    else if (more > 0) out.push(`  (${num(shown)} shown, to entry ${num(last)}; ${num(more)} more. For the next: look at this paper again with from_entry: ${last + 1}${asked.words !== undefined ? " and the same words" : "; or give words, for only the entries that include them (a lot's id, say)"}.)`);
  }
  return out;
}

/** What a look into papers found: a list, newest first (each paper's id, what it is, its date, from whom, a line of
 * what it says), narrowed by what was asked; or the one paper asked for by its id, in full. */
function lookedPapers(head: string, id: string, records: Record[], asked: Looked | undefined, readings: { [id: string]: Reading } | undefined, folder: string[] | undefined): string[] {
  const a = asked ?? {};
  if (a.paper !== undefined) {
    const r = records.find((x) => x.id === a.paper && (!folder || ofKind(x, folder)));
    return [`## ${head}: the paper ${a.paper}`, ...(r ? paperInFull(r, a, readings) : ["There is no paper with that id there."])];
  }
  const limit = a.limit ?? 20;
  const narrowed = (r: Record) => (!folder || ofKind(r, folder)) && (a.about === undefined || namesId(r, a.about)) && (a.words === undefined || says(r, a.words));
  const through = a.fetched !== undefined && records.length >= a.fetched ? `Only the latest ${num(a.fetched)} papers there were looked through: say more closely what to find, to reach earlier ones.` : "";
  const how = `(To read one in full: look at this report (${id}) with paper: its id.)`;
  if (a.kindSaid !== undefined) {
    // Nothing was of the kind asked for, word for word: those of kinds like it, or else which kinds are there.
    const said = kindSaid(a.kindSaid);
    const pool = records.filter(narrowed);
    const like = pool.filter((r) => { const k = kindSaid(paperKind(r)); return k.includes(said) || said.includes(k); });
    const exact = pool.filter((r) => kindSaid(paperKind(r)) === said);
    if (exact.length || like.length) {
      const l = listLines(exact.length ? exact : like, limit, readings);
      return [`## ${head}: what you looked up (${(exact.length || like.length) - l.left} found)`, ...(exact.length ? [] : [`No paper there is of the kind "${a.kindSaid}", word for word. These are of kinds like it:`]), ...l.lines.map((x) => `- ${x}`),
        ...(l.left ? [`(${num(l.left)} more: ask for more at once, or say more closely what to find.)`] : []), how];
    }
    const kinds = new Map<string, number>();
    for (const r of pool) kinds.set(paperKind(r), (kinds.get(paperKind(r)) ?? 0) + 1);
    return [`## ${head}: what you looked up (0 found)`, NOTHING_FOUND, kinds.size ? `(No paper there is of the kind "${a.kindSaid}". The kinds of paper there${through ? `, among the latest ${num(records.length)}` : ""}: ${[...kinds].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, n]) => `${k} (${num(n)})`).join(", ")}.)` : "(There are no papers there at all.)"];
  }
  // (Newest first, as whoever keeps them was asked; said again here, so that a list never depends on it.)
  const found = records.filter((r) => narrowed(r) && (!a.kinds || ofKind(r, a.kinds))).map((r, n) => [r, n] as const).sort(([x, i], [y, j]) => y.at - x.at || i - j).map(([r]) => r);
  // A list is gone through a part at a time: from the entry asked for (the first, if none), and it says how to go on.
  const from = Math.max(1, a.fromEntry ?? 1);
  const shown = listLines(found.slice(from - 1), limit, readings);
  const last = found.length - shown.left;
  const full = records.length >= (a.fetched ?? limit);
  const more = shown.left ? `(Entries ${num(from)} to ${num(last)} of ${num(found.length)}${through ? " found among those" : ""}. For the next: look again the same way with from_entry: ${last + 1}.)`
    : from > 1 && found.length < from ? `(Nothing from entry ${num(from)} on: ${found.length ? `there are ${num(found.length)}` : "nothing was found"}.)`
    : full && !through ? `(There may be more: at most ${num(a.fetched ?? limit)} were asked for. For the next: look again the same way with from_entry: ${last + 1}.)` : "";
  // What was searched, said with every answer, so that "nothing found" is never mistaken for "nothing looked at": the
  // folder, how much of it, over what span; and, where only its latest papers were read through, that earlier ones were not.
  const span = records.length ? ` (${when(Math.min(...records.map((r) => r.at)))} to ${when(Math.max(...records.map((r) => r.at)))})` : "";
  const narrowedHere = a.fetched !== undefined;
  const where = `(Looked in "${head}" (${id})${a.said ? `, for: ${a.said}` : ""}. ${narrowedHere
    ? `${records.length ? `The latest ${num(records.length)} paper${records.length === 1 ? "" : "s"} there that could match${span} ${records.length === 1 ? "was" : "were"} read through` : "There was no paper there that could match"}${full ? "; there are earlier ones that were not, so this is not everything there" : ": that is all of them"}.`
    : `Everything kept there was searched${full ? `, and the ${num(records.length)} newest that match are what came back` : `: ${records.length ? `${num(records.length)} ${records.length === 1 ? "paper matches" : "papers match"}` : "nothing there matches"}`}.`})`;
  const none = found.length ? [] : [NOTHING_FOUND, ...(narrowedHere && full ? ["(Not found among those read through, which is not the same as not there: say more closely what to find (a kind, a date, who from), to reach earlier papers.)"] : [])];
  return [`## ${head}: what you looked up (${Math.max(0, last - (from - 1))} found)`, ...(found.length ? shown.lines.map((l) => `- ${l}`) : none), ...(more ? [more] : []), where, ...(found.length ? [how] : [])];
}

/** The places a participant asked to see, in full as they are today: buildings by id, by kind, by a room in them or
 * the ground they stand on; open ground by its cell; or every building a measure is above zero or rising at, worst
 * first. What it named that isn't there is said. */
function lookedPlaces(cells: SiteCell[], structures: SiteStructure[], asked: Looked, me: string, t: number): string[] {
  const limit = asked.limit ?? 20;
  const names = [...new Set((asked.named ?? []).map(plain).filter(Boolean))];
  const ground = new Map<string, string[]>();
  for (const c of cells) if (c.structure) ground.set(c.structure.structure, [...(ground.get(c.structure.structure) ?? []), plain(c.cell)]);
  const is = (s: SiteStructure, n: string) => plain(s.structure) === n || plain(s.type) === n || `${plain(s.type)}s` === n || s.spaces.some((x) => plain(x.space) === n) || (ground.get(s.structure) ?? []).includes(n);
  const bare = (c: SiteCell, n: string) => !c.structure && (plain(c.cell) === n || (c.terrain !== undefined && plain(c.terrain) === n));
  const unknown = names.filter((n) => !structures.some((s) => is(s, n)) && !cells.some((c) => bare(c, n)));
  let picked = names.length ? structures.filter((s) => names.some((n) => is(s, n))) : structures;
  const open = names.length ? cells.filter((c) => names.some((n) => bare(c, n))) : [];
  const out: string[] = [];
  if (asked.measure) {
    const m = plain(asked.measure);
    const of = (s: SiteStructure) => sorted(s.variables).find(([name]) => plain(name) === m)?.[1];
    if (!structures.some(of)) out.push(`Nothing is kept of the buildings here under "${asked.measure}".`);
    else {
      picked = picked.filter((s) => { const v = of(s); return v !== undefined && (today(v, t) > 0 || v.per_day > 0); })
        .sort((a, b) => today(of(b)!, t) - today(of(a)!, t) || (a.structure < b.structure ? -1 : 1));
      out.push(picked.length ? `${cap(asked.measure)} is above zero or rising at ${picked.length} ${picked.length === 1 ? "building" : "buildings"}${names.length ? " of those you named" : ""}, the highest first:` : `${cap(asked.measure)} is above zero or rising at none of ${names.length ? "the buildings you named" : "the buildings here"}.`);
    }
  }
  // (A long list is gone through a part at a time: from the entry asked for, and it says how to go on.)
  const from = Math.max(1, asked.fromEntry ?? 1);
  const shown = asked.measure && out[0]?.startsWith("Nothing is kept") ? [] : picked.slice(from - 1, from - 1 + limit);
  out.push(...describeBuildings(shown, me, t, true));
  const room = Math.max(0, limit - shown.length);
  for (const c of open.slice(0, room)) out.push(`- open ground ${c.cell}${c.terrain ? `, ${words(c.terrain)}` : ""}${c.seen?.length ? `; seen living there: ${c.seen.map(words).join(", ")}` : ""}`);
  const left = Math.max(0, picked.length - (from - 1) - shown.length) + Math.max(0, open.length - room);
  if (shown.length && left > 0) out.push(`(Entries ${num(from)} to ${num(from - 1 + shown.length)} of ${num(picked.length)}${open.length > room ? `, and ${num(open.length - room)} of open ground not listed` : ""}. For the next: look again the same way with from_entry: ${from + shown.length}; or name the ones you want.)`);
  else if (from > 1 && !shown.length) out.push(`(Nothing from entry ${num(from)} on: there are ${num(picked.length)}.)`);
  out.push(...scales(shown));
  if (unknown.length) out.push(`Nothing is known here by ${unknown.length === 1 ? "this name" : "these names"}: ${(asked.named ?? []).filter((n) => unknown.includes(plain(n))).join(", ")}.`);
  if (!out.length) out.push("Nothing to be seen there.");
  // (What was looked at, said with the answer: how much is there to be seen from where the seat is.)
  out.push(`(Looked at what is here: ${num(structures.length)} ${structures.length === 1 ? "building" : "buildings"} and ${num(cells.filter((c) => !c.structure).length)} ${cells.filter((c) => !c.structure).length === 1 ? "cell" : "cells"} of open ground.)`);
  return out;
}

/** The participant's own body, in plain words: its age, where it is, how it is, and its family as it knows them. */
function describeBody(b: Body, t: number): string[] {
  const years = (born: number) => Math.floor((t - born) / YEAR);
  const age = years(b.born_at);
  const out = [`You are ${age} year${age === 1 ? "" : "s"} old${b.present ? "" : ", and away from here"}${b.in ? `. You are in ${b.in}` : ""}.`];
  for (const c of b.conditions ?? []) out.push(`You have ${c.severity === "mild" ? "a mild" : `a ${words(c.severity)}`} ${c.kind === "injury" ? "injury" : "illness"}, since ${when(c.since)}; it should pass by ${when(c.until)}${c.treated ? " (it has been treated)" : ""}.`);
  const about = sorted(b.variables).map(([name, v]) => `${words(name)} ${num(v)}`);
  if (about.length) out.push(`About you: ${about.join("; ")}.`);
  if (b.parents?.length) out.push(`Your parents: ${b.parents.join(", ")}.`);
  if (b.children?.length) out.push(`Your children: ${b.children.map((c) => `${c.person} (${c.alive ? `${years(c.born_at)} year${years(c.born_at) === 1 ? "" : "s"} old` : "died"})`).join(", ")}.`);
  return out;
}

function describeTransactions(txs: Transaction[], mine: Set<string>): string[] {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const x of txs) {
    if (mine.has(x.to) && !mine.has(x.from)) inflow.set(x.from, (inflow.get(x.from) ?? 0) + cents(x.amount));
    if (mine.has(x.from) && !mine.has(x.to)) outflow.set(x.to, (outflow.get(x.to) ?? 0) + cents(x.amount));
  }
  const line = (label: string, m: Map<string, number>) => {
    if (m.size === 0) return [];
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const t = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const others = t.slice(8).reduce((a, [, v]) => a + v, 0);
    return [`${label} ${money(total)} since you last looked: ${t.slice(0, 8).map(([a, v]) => `${a} ${money(v)}`).join(", ")}${t.length > 8 ? `, and ${t.length - 8} more (${money(others)} between them)` : ""}.`];
  };
  return [...line("Received", inflow), ...line("Paid out", outflow)];
}

export interface RenderOptions {
  /** Items shown per report before earlier ones are only counted. */
  maxRecords?: number;
  /** Reports whose items are standing documents (shown separately, in full). */
  standing?: Set<string>;
  /** What the participant's reports are called (Channel.title). */
  titles?: Map<string, string>;
  /** What the participant's last action was, in words ("What you confirmed", "Your letter to …"). */
  lastAction?: string;
  /** How a draft awaiting confirmation reads. */
  draftText?: (d: any) => string;
  /** Reports the participant can look into when it chooses (its `look`): where one is cut short or only counted, it's
   * told that it can, and how. */
  lookable?: Set<string>;
  /** What it just looked at, by report: the places or people it named, a measure to list buildings by, how many at most. */
  looked?: Map<string, Looked>;
  /** Folders that hold papers of some kinds only (by report: the kinds, as a list of papers names them): nothing else
   * is shown under their name, as it comes or looked up. */
  folders?: Map<string, string[]>;
  /** Who someone is in the world, by any id of theirs (a letter's writer, a paper's author). */
  whoIs?: WhoIs;
  /** The office's counter (llm/counter.ts): papers that are its staff's to answer are set out as a count and a sample. */
  counter?: { counters(r: Record): boolean };
  /** Told of each look cut short at the most one look shows (`LOOK_CHARS_MAX`). */
  onCut?: (cut: { report: string; characters: number; limit: number }) => void;
}

/** What a look that finds nothing says: of papers looked up, and of a report with nothing new in it. */
export const NOTHING_FOUND = "Nothing found.";
export const NOTHING_NEW = "Nothing new there since you last looked.";

/** What's new since the participant last looked. */
export function renderObservation(obs: Observation, o: RenderOptions = {}): string {
  inFull = false;
  whoIs = o.whoIs;
  const max = o.maxRecords ?? 40;
  const postTitle = new Map((obs.positions ?? []).map((p) => [p.position, p.title ?? words(p.role ?? p.position)]));
  // A post's reports are named after the post (`mayor/budget` reads "Mayor: Budget").
  const title = (id: string) => o.titles?.get(id) ?? (id.includes("/") ? `${cap(postTitle.get(id.split("/")[0]!) ?? id.split("/")[0]!)}: ${cap(id.split("/").slice(1).join("/"))}` : cap(id));
  /** How to see more of a report, for one that can be looked into; nothing otherwise. */
  const look = (id: string, how: string) => (o.lookable?.has(id) ? [`(${how}: look at "${title(id)}" (${id}).)`] : []);
  const out: string[] = [`It is ${when(obs.t)}.`];
  /** What one look found, within the most one look shows: cut at the end of a line, and said. */
  const within = (id: string, lines: string[]): string[] => {
    const all = lines.join("\n");
    if (all.length <= LOOK_CHARS_MAX) return lines;
    o.onCut?.({ report: id, characters: all.length, limit: LOOK_CHARS_MAX });
    const kept = all.slice(0, LOOK_CHARS_MAX);
    const at = kept.lastIndexOf("\n");
    return [...(at > 0 ? kept.slice(0, at) : kept).split("\n"), `(Cut short here: one look shows at most ${num(LOOK_CHARS_MAX)} characters, and this came to ${num(all.length)}. Say more closely what you want to see, or ask for less at once.)`];
  };
  if (obs.body) out.push(...describeBody(obs.body, obs.t));
  if (obs.positions?.length) out.push(`You hold ${obs.positions.length === 1 ? "a post" : "these posts"}: ${obs.positions.map((p) => `${p.title ?? words(p.role ?? p.position)} (${p.position}), for ${p.entity}`).join("; ")}.`);
  for (const x of obs.outcomes) out.push(...outcomeLines(x, o.lastAction ?? "What you did", obs.t));
  // (What it is told stands as it is said: a note about something it asked to be done says which, in its own words.)
  for (const n of obs.notices ?? []) out.push(n.text);
  if (obs.inbox.length) {
    out.push("", "## Letters");
    // A letter is signed: by the post it was written in and whose post that is, or by the person or organisation.
    for (const m of obs.inbox) out.push(`- From ${signed(m.as ?? (whoIs?.(m.from) ? m.from : m.from_entity ?? m.from))} (${when(m.t)})${m.re ? `, about ${m.re}` : ""}: "${m.text}"`);
  }
  // Anything on file (standing documents) isn't repeated in other reports.
  const onFile = new Set(Object.entries(obs.channels).flatMap(([id, ch]) => (o.standing?.has(id) && ch.kind === "records" ? ch.records.map((r) => r.id) : [])));
  // Under which heading each new paper is set out, where it reaches the seat under more than one: the one with the
  // fewest new papers (the narrower folder), the first of equals.
  const under = new Map<string, string>();
  {
    const lists = Object.entries(obs.channels).flatMap(([id, ch]) => (ch.kind === "records" && !ch.search && !o.standing?.has(id) && !o.looked?.has(id)
      ? [[id, ch.records.filter((r) => !onFile.has(r.id) && (!o.folders?.get(id) || ofKind(r, o.folders.get(id)!)))] as const] : []));
    for (const [id, list] of [...lists].sort((x, y) => x[1].length - y[1].length)) for (const r of list) if (!under.has(r.id)) under.set(r.id, id);
  }
  for (const [id, ch] of Object.entries(obs.channels)) {
    const asked = o.looked?.get(id);
    if (ch.kind === "records" && ch.search) {
      // What it looked up: a list of what was found, newest first, a line to a paper (a person reads what they ask
      // for: a paper's full text comes when that paper is asked for by its id); and that nothing was, if so.
      out.push("", ...within(id, lookedPapers(title(id), id, ch.records, asked, obs.readings, o.folders?.get(id))));
      continue;
    }
    if (o.standing?.has(id)) continue;
    // Having looked at one thing, it isn't shown the standing picture of the others again (the town's survey, who's
    // who: it has just read them, and they come again with its next report). What's new always is: letters, papers,
    // money in and out.
    // (What someone sent has just come back with is always told: it comes once.)
    const back = ch.kind === "sites" && ch.visited && (ch.fresh?.length ?? 0) > 0;
    if (o.looked?.size && !asked && !back && (ch.kind === "sites" || ch.kind === "directory")) continue;
    if (ch.kind === "accounts") {
      // (Nor, having looked at something else, every account it keeps for others again: a bank's ledger is every
      // customer's account, and set out with each look it buried what the look found (pilots lv-08 and lv-09,
      // 2026-10-24: 127,000 characters with every look, and the look's own result was what the prompt's ceiling left
      // out). Its own accounts, and money in and out, are still told; a short list of accounts is set out as ever.)
      const others = o.looked?.size && !asked && ch.accounts.length > max ? ch.accounts.filter((a) => a.holder !== obs.entity).length : 0;
      const shownAccounts = others ? ch.accounts.filter((a) => a.holder === obs.entity) : ch.accounts;
      out.push("", `## ${title(id)}`);
      if (others) out.push(`(The ${num(others)} ${others === 1 ? "account" : "accounts"} you keep for others, as at your last report: set out again with your next.)`);
      for (const a of shownAccounts) out.push(`- ${a.account}${a.holder === obs.entity ? "" : ` (${a.holder}'s)`}, kept by ${a.custodian === obs.entity ? "you" : a.custodian}: ${money(a.balance)}`);
      out.push(...describeTransactions(ch.transactions, new Set(ch.accounts.map((a) => a.account))).map((l) => `  ${l}`));
    } else if (ch.kind === "holdings") {
      out.push("", `## ${title(id)}`);
      if (!ch.holdings.length) out.push("- (nothing)");
      for (const h of ch.holdings) out.push(`- ${h.quantity.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${h.kind} at ${h.at}`);
    } else if (ch.kind === "records") {
      const kinds = o.folders?.get(id);
      const fresh = ch.records.filter((r) => !onFile.has(r.id) && (!kinds || ofKind(r, kinds)));
      if (fresh.length === 0) {
        // It looked, and there was nothing: said, not left for it to work out from a report that isn't there.
        if (asked) out.push("", `## ${title(id)}`, NOTHING_NEW, `(Looked in "${title(id)}" (${id}) for what has come into it since you last looked there: nothing has. What was there before is still there: to go through it, say what to find, or give from_entry: 1.)`);
        continue;
      }
      if (asked) {
        // It looked into a folder with nothing to find: what has come since it last looked, as a list, newest first.
        const limit = asked.limit ?? 20;
        const latest = listLines([...fresh].reverse(), limit, obs.readings);
        out.push("", ...within(id, [`## ${title(id)}: new since you last looked (${num(fresh.length)})`, ...latest.lines.map((l) => `- ${l}`),
          ...(latest.left ? [`(${num(latest.left)} earlier ones not listed: say what to find (a kind, who from, since when, what about), or, for the next, look again with from_entry: ${fresh.length - latest.left + 1}.)`] : []),
          `(Looked in "${title(id)}" (${id}) for what has come into it since you last looked there.)`,
          `(To read one in full: look at this report (${id}) with paper: its id.)`]));
        continue;
      }
      // (A paper that reaches it under two of its headings is set out once, under the narrower: a complaint in the
      // folder for complaints, not again among everything of the organisation's.)
      const hereAll = fresh.filter((r) => (under.get(r.id) ?? id) === id);
      if (!hereAll.length) continue;
      // The counter's papers (answered by the office's staff under its standing order) are told as a count and a
      // sample, not line by line; what reaches the office-holder is listed as it always was.
      const atCounter = o.counter ? hereAll.filter((r) => o.counter!.counters(r)) : [];
      const here = atCounter.length ? hereAll.filter((r) => !o.counter!.counters(r)) : hereAll;
      const before = cuts;
      const lines = recordLines(here, obs.readings);
      out.push("", `## ${title(id)} (${lines.length + atCounter.length} new)`);
      if (atCounter.length) {
        const byKind = new Map<string, number>();
        for (const r of atCounter) byKind.set(paperKind(r), (byKind.get(paperKind(r)) ?? 0) + 1);
        out.push(`Answered at your counter under your standing order (${num(atCounter.length)}): ${[...byKind].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, n]) => `${num(n)} ${k}${n === 1 ? "" : "s"}`).join(", ")}. A sample:`,
          ...recordLines(atCounter.slice(-3), obs.readings, true).map((l) => `- ${l}`));
        if (here.length) out.push(`For you (${num(here.length)}):`);
      }
      // What has come, by kind, where there is more than a line or two: a heading names a folder, not what is in it.
      const by = new Map<string, number>();
      for (const r of here) by.set(paperKind(r), (by.get(paperKind(r)) ?? 0) + 1);
      if (here.length > 2) out.push(`(What came: ${[...by].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, n]) => `${num(n)} ${k}${n === 1 ? "" : "s"}`).join(", ")}.)`);
      if (lines.length > max) out.push(`(${lines.length - max} earlier ${lines.length - max === 1 ? "item" : "items"} not listed.)`);
      for (const l of lines.slice(-max)) out.push(`- ${l}`);
      if (lines.length > max || cuts > before) out.push(...look(id, `Not everything here is set out in full. To see the rest, say what to find, or go through it a part at a time (from_entry: 1, then as each answer says)`));
    } else if (ch.kind === "sites" && ch.visited) {
      // Places gone to (nobody is shown where they are not): what the latest going found, as it was then, in full,
      // said once, with the report that brings it; someone just sent is said to be on the way. What earlier goings
      // found is the seat's to remember (its notebook): it is not said again.
      const back = new Set(ch.fresh ?? []);
      const found = ch.cells.filter((c) => back.has(c.cell));
      if (found.length) {
        const seen = [...new Map(found.filter((c) => c.structure).map((c) => [c.structure!.structure, c.structure!])).values()];
        const open = found.filter((c) => !c.structure);
        out.push("", ...within(id, [`## ${title(id)}: what was found there (${when(ch.as_of)})`, ...describeBuildings(seen, obs.entity, ch.as_of, true),
          ...open.map((c) => `- open ground ${c.cell}${c.terrain ? `, ${words(c.terrain)}` : ""}${c.seen?.length ? `; seen living there: ${c.seen.map(words).join(", ")}` : ""}`), ...scales(seen)]));
      } else if (asked) out.push("", `## ${title(id)}`, SET_OUT);
      continue;
    } else if (ch.kind === "sites") {
      const structures = channels.structures({ ...obs, channels: { [id]: ch } });
      // What it asked to see there, in full.
      if (asked && (asked.named?.length || asked.measure)) {
        out.push("", ...within(id, [`## ${title(id)}: what you looked at`, ...lookedPlaces(ch.cells, structures, asked, obs.entity, obs.t)]));
        continue;
      }
      // A few buildings (the participant's surroundings) one by one; a whole town as a survey.
      const bare = ch.cells.filter((c) => !c.structure);
      const open = bare.length;
      if (structures.length <= 30) {
        out.push("", `## ${title(id)}`, ...(structures.length ? describeBuildings(structures, obs.entity, obs.t) : ["No buildings here."]), ...scales(structures));
        if (open) out.push(`Open ground: ${open} cell${open === 1 ? "" : "s"}${open <= 12 ? ` (${bare.map((c) => `${c.cell}${c.terrain ? `, ${words(c.terrain)}` : ""}`).join("; ")})` : ""}.`);
        out.push(...seenWords(ch.cells));
        if (structures.some((s) => s.complete && s.spaces.length > 8)) out.push(...look(id, "To see every room of a building, name it"));
      } else {
        out.push("", `## ${title(id)}`, ...describeSurvey(ch.cells.length, open, structures, ch.as_of, obs.t), ...seenWords(ch.cells),
          ...look(id, `To see any building, room or piece of ground in full, name it (or a kind of building)${structures.some((s) => s.variables) ? "; to see every building where one of these is above zero or rising, name the measure" : ""}`));
      }
    } else if (ch.kind === "directory") {
      // (Someone whose name is only their id is said once: "c0297, a person", not "c0297 (c0297)".)
      const called = (e: (typeof ch.entities)[number]) => (e.name && e.name !== e.entity ? `${e.name} (${e.entity})` : e.entity);
      const nameOf = new Map(ch.entities.filter((e) => e.participant).map((e) => [e.participant!, called(e)]));
      // Who holds a post, as a town publishes it: a person by name; an office that runs itself (held by a system of the
      // organisation's own, which has the post's title and no name of its own) said to be so, with how to reach it.
      const office = (p: (typeof ch.positions)[number]) => {
        const title = p.title ?? words(p.role ?? p.position);
        const holder = !p.holder ? "vacant: nobody holds it"
          : nameOf.has(p.holder) ? `held by ${nameOf.get(p.holder)}`
          : p.held_by && plain(p.held_by) !== plain(title) ? `held by ${p.held_by}`
          : `filled: the office answers for itself, with no person named to it (write to the post, by its id: ${p.position})`;
        return `${title} (${p.position}), for ${p.entity}: ${holder}`;
      };
      if (asked?.named?.length) {
        // Who it asked after: the people, organisations and posts its look-ups found, one by one.
        const names = asked.named.map(plain).filter(Boolean);
        const limit = asked.limit ?? 20;
        const entities = ch.entities.filter((e) => names.some((n) => plain(e.entity) === n || plain(e.name).includes(n) || plain(e.kind) === n));
        const found = new Set(entities.map((e) => e.entity));
        const posts = ch.positions.filter((p) => names.some((n) => plain(p.position) === n || plain(p.title ?? "").includes(n) || plain(p.role ?? "") === n || plain(p.entity) === n) || (p.holder !== undefined && [...found].some((e) => nameOf.get(p.holder!)?.endsWith(`(${e})`))));
        const lines = [...entities.map((e) => `- ${called(e)}, ${e.kind === "person" ? "a person" : words(e.kind)}`), ...posts.map((p) => `- post: ${office(p)}`)];
        // Each name that found nothing is said (who's who is open to anyone: that it has no entry under a name tells
        // nothing that was not there to be looked up).
        const missed = asked.named.filter((said) => { const n = plain(said); return n && !ch.entities.some((e) => plain(e.entity) === n || plain(e.name).includes(n) || plain(e.kind) === n) && !ch.positions.some((p) => plain(p.position) === n || plain(p.title ?? "").includes(n) || plain(p.role ?? "") === n || plain(p.entity) === n); });
        out.push("", `## ${title(id)}: who you looked for`, ...(lines.length ? lines.slice(0, limit) : ["No one and nothing found by that name.", `(Looked up in "${title(id)}" (${id}), which enters the town's people, organisations and posts: nothing is entered under ${asked.named.join(", ")}. A name is matched whole: a person or an organisation by its full name or its id; a post by its title, its id or what it is, such as mayor.)`]));
        if (lines.length > limit) out.push(`(${lines.length - limit} more not listed: ask for more at once, or name them more closely.)`);
        if (missed.length && lines.length) out.push(`Nothing is entered under: ${missed.join(", ")}. (A name is matched whole: a person or an organisation by its full name or its id; a post by its title, its id or what it is, such as mayor.)`);
        continue;
      }
      // Nobody is shown who's who: what stands here is its own address book, those it has looked up so far.
      const orgs = ch.entities.filter((e) => e.kind !== "person").map(called);
      const people = ch.entities.filter((e) => e.kind === "person").map(called);
      const offices = ch.positions.map(office);
      const few = (xs: string[], most: number) => `${xs.slice(0, most).join("; ")}${xs.length > most ? `; and ${xs.length - most} more` : ""}`;
      out.push("", `## ${title(id)}`, ...(orgs.length + people.length + offices.length ? ["Those you have looked up so far:",
        ...(orgs.length ? [`Organisations: ${few(orgs, 40)}.`] : []), ...(offices.length ? [`Posts: ${few(offices, 60)}.`] : []), ...(people.length ? [`People: ${few(people, 40)}.`] : [])] : ["You have looked nobody up yet."]),
        ...look(id, "To find out who someone is, name them (a person or an organisation by its id or full name; a post by its id, its title or what it is, such as mayor)"));
    }
  }
  // Somewhere it looked that isn't there to be seen (a report it no longer has): said.
  for (const [id, asked] of o.looked ?? []) if (!(id in obs.channels)) out.push("", `## ${title(id)}`, asked.sent ? SET_OUT : (obs.asking ?? []).some((a) => a === id || a.endsWith(`/${id}`)) ? WAITING_ON_KEEPER : "Nothing could be seen there.");
  if (obs.drafts.length) {
    out.push("", "## Waiting for you to confirm");
    for (const d of obs.drafts) out.push(o.draftText ? o.draftText(d) : `(${d.id}) ${d.summary}`);
  }
  return out.join("\n");
}

/**
 * Standing documents (laws, charters, procedures) from the given reports, in full: those that stand. One that has been
 * withdrawn (by its own author, or whoever it speaks for) isn't on file any more; nor is one that a later document of
 * the same kind, from whoever it speaks for, says it replaces (an amended law names the law it replaces), whether or
 * not the withdrawal is among what's shown. The same reading as a code participant's book (`Book`, behaviour/common.ts).
 */
export function renderStanding(obs: Observation, standing: Set<string>, who?: WhoIs): string {
  whoIs = who;
  const out: string[] = [];
  // An office's own stationery (a form that writes a paper of that office's) is on file for whoever holds the
  // office: another office of the same organisation is not shown it.
  const held = new Set((obs.positions ?? []).map((p) => p.position));
  const othersStationery = (r: { kind?: string; data?: any }) => r.kind === "form" && !!r.data?.writes && typeof r.data?.office === "string" && !held.has(r.data.office);
  const shown = Object.entries(obs.channels).flatMap(([id, ch]) => (standing.has(id) && ch.kind === "records" ? ch.records : []));
  const byId = new Map(shown.map((r) => [r.id, r]));
  const down = new Set<string>();
  for (const r of shown) {
    const old = byId.get(r.record === "withdrawal" ? r.withdraws : r.record === "statement" && typeof r.data?.replaces === "string" ? r.data.replaces : "");
    if (old?.record !== "statement") continue;
    const sameVoice = !!old.speaks_for && old.speaks_for === r.speaks_for;
    if (r.record === "withdrawal" ? sameVoice || old.author === r.author : sameVoice && r.record === "statement" && old.kind === r.kind) down.add(old.id);
  }
  for (const [id, ch] of Object.entries(obs.channels)) {
    if (!standing.has(id) || ch.kind !== "records") continue;
    for (const r of ch.records) if (r.record === "statement" && !down.has(r.id) && !othersStationery(r)) out.push(`- [${r.id}] ${words(r.kind)}${r.speaks_for ? ` of ${r.speaks_for}` : ""}: "${r.text}"${r.data ? ` (${dataWords(r)})` : ""}${ruleWords(r) ? ` ${ruleWords(r)}` : ""}`);
  }
  return out.join("\n");
}
