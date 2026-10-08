// What a language-model participant reads (principle 14: the platform is
// invisible to participants). An Observation becomes the reports a person in that role would
// read, in the world's own terms: accounts, letters, filings, titles,
// agreements, a survey of the town. No blocks, records, channels or refusal
// codes. Deterministic: the same observation always reads the same.

import { cents, moneyNow } from "../money";
import type { Body, Observation, Outcome, Reading, Record, SiteCell, SiteStructure, Transaction, VariableView } from "../contracts";
import { channels, citedWords } from "../contracts";
import { refusalText } from "./words";

const DAY = 86_400;
const YEAR = 365 * DAY;

/** Money as people write it (money.ts). */
export const money = moneyNow;

export function when(t: number): string {
  return `year ${Math.floor(t / YEAR) + 1}, day ${Math.floor((t % YEAR) / DAY) + 1}`;
}

export function duration(s: number): string {
  if (s % YEAR === 0) return `${s / YEAR} year${s === YEAR ? "" : "s"}`;
  if (s % DAY === 0) return `${s / DAY} day${s === DAY ? "" : "s"}`;
  return `${s} seconds`;
}

/** Long text is cut short, with a mark, except in what the participant looked up (`whole`); `cuts` counts what a
 * report cut, so that it can say so. (Rendering is synchronous: both are set and read within one report.) */
let whole = false;
let cuts = 0;
const clip = (s: string, max = 400) => (whole || s.length <= max ? s : (cuts++, s.slice(0, max) + "…"));
const words = (label: string) => label.replace(/_/g, " ");
const cap = (x: string) => words(x).replace(/^./, (c) => c.toUpperCase());
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** A name as someone might write it, for matching: case, underscores and hyphens don't matter. */
const plain = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ").trim();
const details = (x: unknown, max = 400) => {
  if (x === null || x === undefined || typeof x !== "object") return "";
  const entries = Object.entries(x as object);
  const flat = entries.every(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
  return clip(flat ? entries.map(([k, v]) => `${words(k)}: ${v}`).join("; ") : JSON.stringify(x), max);
};
/** A statement's details. A form's are always whole: its fields are what it's filled in from, and whoever reads the
 * request made on it sees every one (a long form cut short reads as a form without its last fields). */
const dataWords = (r: { kind: string; data?: unknown }) => details(r.data, r.kind === "form" ? Infinity : 400);

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
  if (o.seen) out.push("  As those who did the work left it:", ...describeBuildings([o.seen as SiteStructure], "", now).map((l) => l.split("\n").map((x) => `  ${x}`).join("\n")));
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
export function outcomeWords(o: any, every?: number): string {
  const rep = every ? ` every ${duration(every)}` : "";
  if (o?.goods) return `deliver ${o.goods.quantity} ${o.goods.kind} to ${o.goods.to} at ${o.goods.at}${rep}`;
  if (o?.money) return `pay ${money(o.money.amount)}${o.money.from ? ` from ${o.money.from}` : ""} to ${o.money.to}${rep}${o.money.for ? ` (${o.money.for})` : ""}`;
  if (o?.structure) return o.structure.remove ? `demolish ${o.structure.remove}` : `build a ${o.structure.type} on ${o.structure.on}`;
  if (o?.occupancy) return o.occupancy.leave ? `have ${o.occupancy.who} leave ${o.occupancy.in}` : `let ${o.occupancy.who} live or be in ${o.occupancy.in}`;
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
  const who = r.speaks_for ?? r.author;
  switch (r.record) {
    case "statement": {
      if (r.kind === "request" && r.data?.outcome) return `[${r.id}] ${who} asked ${(r.addressed_to ?? []).join(", ")} to ${outcomeWords(r.data.outcome, r.data.every)}${from}`;
      const d = dataWords(r);
      const rule = ruleWords(r);
      return `[${r.id}] ${words(r.kind)} from ${who}${r.place ? `, put up on ${r.place}` : ""}${r.addressed_to ? `, to ${r.addressed_to.join(", ")}` : ""}${from}: "${clip(r.text, 1000)}"${d ? ` (${d})` : ""}${r.basis ? `, citing ${citedWords(r)}` : ""}${rule ? `. ${rule}` : ""}`;
    }
    case "claim":
      return `[${r.id}] ${r.holder} ${POSITION[r.position] ?? r.position}${r.counterparty ? ` against ${r.counterparty}` : ""}: ${details(r.about) || "(no details)"}${r.basis ? `, citing ${citedWords(r)}` : ""}${from}`;
    case "agreement": {
      const c = r.terms.commitments.map((x) => `${x.who} will ${x.does?.outcome ? outcomeWords(x.does.outcome, x.every) : clip(JSON.stringify(x.does), 200)}`).join("; ");
      return `[${r.id}] ${r.terms.template ? `${words(r.terms.template)} agreement` : "agreement"} between ${r.terms.parties.join(" and ")}${r.terms.term ? `, for ${duration(r.terms.term)}` : ""}: ${c || "no commitments"}${r.terms.text ? `. "${clip(r.terms.text)}"` : ""}${from}${readingWords(readings?.[r.id])}`;
    }
    case "signature":
      return `[${r.id}] ${r.as} signed ${r.agreement}${from}`;
    case "notice":
      return `[${r.id}] ${r.as} gave notice on ${r.agreement}${r.text ? `: "${clip(r.text)}"` : ""}${from}`;
    case "withdrawal":
      return `[${r.id}] ${who} withdrew ${r.withdraws}${r.text ? `: "${clip(r.text)}"` : ""}${from}`;
    case "vote":
      return `[${r.id}] ${who} voted "${r.choice}" on ${r.ballot}${from}`;
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
    return `${v.length} vote${v.length === 1 ? "" : "s"} on ${v[0]!.ballot}: ${[...counts].sort().map(([c, n]) => `${c} ${n}`).join(", ")}`;
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
          return `  - ${x.space}, a ${words(x.kind)}${attrWords(x.attrs)}: ${x.count} ${x.count === 1 ? "person" : "people"} (room for ${x.capacity})${who.length ? `: ${who.join(", ")}` : ""}${gone.length ? `; gone from it: ${gone.join(", ")}` : ""}`;
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

/** What a participant asked to see when it looked at a report: places or people by name, the buildings a measure is
 * above zero or rising at, and how many at most. */
export interface Looked { named?: string[]; measure?: string; limit?: number }

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
  const shown = asked.measure && out[0]?.startsWith("Nothing is kept") ? [] : picked.slice(0, limit);
  out.push(...describeBuildings(shown, me, t, true));
  const room = Math.max(0, limit - shown.length);
  for (const c of open.slice(0, room)) out.push(`- open ground ${c.cell}${c.terrain ? `, ${words(c.terrain)}` : ""}${c.seen?.length ? `; seen living there: ${c.seen.map(words).join(", ")}` : ""}`);
  const left = picked.length - shown.length + Math.max(0, open.length - room);
  if (shown.length && left > 0) out.push(`(${num(left)} more not listed: ask for more at once, or name the ones you want.)`);
  out.push(...scales(shown));
  if (unknown.length) out.push(`Nothing is known here by ${unknown.length === 1 ? "this name" : "these names"}: ${(asked.named ?? []).filter((n) => unknown.includes(plain(n))).join(", ")}.`);
  if (!out.length) out.push("Nothing to be seen there.");
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
}

/** What a look that finds nothing says: of papers looked up, and of a report with nothing new in it. */
export const NOTHING_FOUND = "Nothing found.";
export const NOTHING_NEW = "Nothing new there since you last looked.";

/** What's new since the participant last looked. */
export function renderObservation(obs: Observation, o: RenderOptions = {}): string {
  whole = false;
  const max = o.maxRecords ?? 40;
  const postTitle = new Map((obs.positions ?? []).map((p) => [p.position, p.title ?? words(p.role ?? p.position)]));
  // A post's reports are named after the post (`mayor/budget` reads "Mayor: Budget").
  const title = (id: string) => o.titles?.get(id) ?? (id.includes("/") ? `${cap(postTitle.get(id.split("/")[0]!) ?? id.split("/")[0]!)}: ${cap(id.split("/").slice(1).join("/"))}` : cap(id));
  /** How to see more of a report, for one that can be looked into; nothing otherwise. */
  const look = (id: string, how: string) => (o.lookable?.has(id) ? [`(${how}: look at "${title(id)}" (${id}).)`] : []);
  const out: string[] = [`It is ${when(obs.t)}.`];
  if (obs.body) out.push(...describeBody(obs.body, obs.t));
  if (obs.positions?.length) out.push(`You hold ${obs.positions.length === 1 ? "a post" : "these posts"}: ${obs.positions.map((p) => `${p.title ?? words(p.role ?? p.position)} (${p.position}), for ${p.entity}`).join("; ")}.`);
  for (const x of obs.outcomes) out.push(...outcomeLines(x, o.lastAction ?? "What you did", obs.t));
  for (const n of obs.notices ?? []) out.push(`A note on your request: ${n.text}`);
  if (obs.inbox.length) {
    out.push("", "## Letters");
    for (const m of obs.inbox) out.push(`- From ${m.from} (${when(m.t)})${m.re ? `, about ${m.re}` : ""}: "${m.text}"`);
  }
  // Anything on file (standing documents) isn't repeated in other reports.
  const onFile = new Set(Object.entries(obs.channels).flatMap(([id, ch]) => (o.standing?.has(id) && ch.kind === "records" ? ch.records.map((r) => r.id) : [])));
  for (const [id, ch] of Object.entries(obs.channels)) {
    const asked = o.looked?.get(id);
    if (ch.kind === "records" && ch.search) {
      // What it looked up: each thing found, one by one and whole (it asked for them); and that nothing was, if so.
      whole = true;
      let lines: string[];
      try {
        lines = recordLines(ch.records, obs.readings, true);
      } finally {
        whole = false;
      }
      const limit = asked?.limit ?? 20;
      out.push("", `## ${title(id)}: what you looked up (${lines.length} found)`, ...(lines.length ? lines.map((l) => `- ${l}`) : [NOTHING_FOUND]));
      if (lines.length >= limit) out.push(`(There may be more: at most ${limit} were asked for. Ask for more at once, or say more closely what to find.)`);
      continue;
    }
    if (o.standing?.has(id)) continue;
    // Having looked at one thing, it isn't shown the standing picture of the others again (the town's survey, who's
    // who: it has just read them, and they come again with its next report). What's new always is: letters, papers,
    // money in and out.
    if (o.looked?.size && !asked && (ch.kind === "sites" || ch.kind === "directory")) continue;
    if (ch.kind === "accounts") {
      out.push("", `## ${title(id)}`);
      for (const a of ch.accounts) out.push(`- ${a.account}${a.holder === obs.entity ? "" : ` (${a.holder}'s)`}, kept by ${a.custodian === obs.entity ? "you" : a.custodian}: ${money(a.balance)}`);
      out.push(...describeTransactions(ch.transactions, new Set(ch.accounts.map((a) => a.account))).map((l) => `  ${l}`));
    } else if (ch.kind === "holdings") {
      out.push("", `## ${title(id)}`);
      if (!ch.holdings.length) out.push("- (nothing)");
      for (const h of ch.holdings) out.push(`- ${h.quantity.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${h.kind} at ${h.at}`);
    } else if (ch.kind === "records") {
      const fresh = ch.records.filter((r) => !onFile.has(r.id));
      if (fresh.length === 0) {
        // It looked, and there was nothing: said, not left for it to work out from a report that isn't there.
        if (asked) out.push("", `## ${title(id)}`, NOTHING_NEW);
        continue;
      }
      const before = cuts;
      const lines = recordLines(fresh, obs.readings);
      out.push("", `## ${title(id)} (${lines.length} new)`);
      if (lines.length > max) out.push(`(${lines.length - max} earlier ${lines.length - max === 1 ? "item" : "items"} not listed.)`);
      for (const l of lines.slice(-max)) out.push(`- ${l}`);
      if (lines.length > max || cuts > before) out.push(...look(id, "Not everything here is set out in full. To see the rest, say what to find"));
    } else if (ch.kind === "sites") {
      const structures = channels.structures({ ...obs, channels: { [id]: ch } });
      // What it asked to see there, in full.
      if (asked && (asked.named?.length || asked.measure)) {
        out.push("", `## ${title(id)}: what you looked at`, ...lookedPlaces(ch.cells, structures, asked, obs.entity, obs.t));
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
      const nameOf = new Map(ch.entities.filter((e) => e.participant).map((e) => [e.participant!, `${e.name} (${e.entity})`]));
      const office = (p: (typeof ch.positions)[number]) => `${p.title ?? words(p.role ?? p.position)} (${p.position}), for ${p.entity}: ${p.holder ? (nameOf.get(p.holder) ?? p.held_by ?? "filled") : "vacant"}`;
      if (asked?.named?.length) {
        // Who it asked after: the people, organisations and posts its look-ups found, one by one.
        const names = asked.named.map(plain).filter(Boolean);
        const limit = asked.limit ?? 20;
        const entities = ch.entities.filter((e) => names.some((n) => plain(e.entity) === n || plain(e.name).includes(n) || plain(e.kind) === n));
        const found = new Set(entities.map((e) => e.entity));
        const posts = ch.positions.filter((p) => names.some((n) => plain(p.position) === n || plain(p.title ?? "").includes(n) || plain(p.role ?? "") === n || plain(p.entity) === n) || (p.holder !== undefined && [...found].some((e) => nameOf.get(p.holder!)?.endsWith(`(${e})`))));
        const lines = [...entities.map((e) => `- ${e.name} (${e.entity}), ${e.kind === "person" ? "a person" : words(e.kind)}`), ...posts.map((p) => `- post: ${office(p)}`)];
        out.push("", `## ${title(id)}: who you looked for`, ...(lines.length ? lines.slice(0, limit) : ["No one and nothing found by that name."]));
        if (lines.length > limit) out.push(`(${lines.length - limit} more not listed: ask for more at once, or name them more closely.)`);
        continue;
      }
      // Nobody is shown who's who: what stands here is its own address book, those it has looked up so far.
      const orgs = ch.entities.filter((e) => e.kind !== "person").map((e) => `${e.name} (${e.entity})`);
      const people = ch.entities.filter((e) => e.kind === "person").map((e) => `${e.name} (${e.entity})`);
      const offices = ch.positions.map(office);
      const few = (xs: string[], most: number) => `${xs.slice(0, most).join("; ")}${xs.length > most ? `; and ${xs.length - most} more` : ""}`;
      out.push("", `## ${title(id)}`, ...(orgs.length + people.length + offices.length ? ["Those you have looked up so far:",
        ...(orgs.length ? [`Organisations: ${few(orgs, 40)}.`] : []), ...(offices.length ? [`Posts: ${few(offices, 60)}.`] : []), ...(people.length ? [`People: ${few(people, 40)}.`] : [])] : ["You have looked nobody up yet."]),
        ...look(id, "To find out who someone is, name them (a person or an organisation by its id or full name; a post by its id, its title or what it is, such as mayor)"));
    }
  }
  // Somewhere it looked that isn't there to be seen (a report it no longer has): said.
  for (const id of o.looked?.keys() ?? []) if (!(id in obs.channels)) out.push("", `## ${title(id)}`, "Nothing could be seen there.");
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
export function renderStanding(obs: Observation, standing: Set<string>): string {
  const out: string[] = [];
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
    for (const r of ch.records) if (r.record === "statement" && !down.has(r.id)) out.push(`- [${r.id}] ${words(r.kind)}${r.speaks_for ? ` of ${r.speaks_for}` : ""}: "${r.text}"${r.data ? ` (${dataWords(r)})` : ""}${ruleWords(r) ? ` ${ruleWords(r)}` : ""}`);
  }
  return out.join("\n");
}
