// The call language (contracts/calls.md): parsing, canonical serialisation,
// typed builders for code participants, and the parser's unit tables (amounts and
// durations). Zero arithmetic happens in the translator: it copies text, and
// these tables convert it, deterministically.

import { canonical } from "./canon";
import { currencyNow, marksOf, type Currency } from "./money";
import CALLS_SCHEMA from "../../contracts/calls.schema.json";

export const FUNCTIONS = ["money", "goods", "work", "account", "structure", "occupancy", "entity", "claim", "agreement", "statement", "vote", "message", "form", "presence", "birth", "harm", "position", "system", "take"] as const;
export type Fn = (typeof FUNCTIONS)[number];
export const LABELS = ["not_yours", "needs_calculation", "too_much", "unclear", "unknown_form", "not_an_act", "no_such_act", "look_first"] as const;
export type Label = (typeof LABELS)[number];

export type Value = { id: string } | { var: string } | { text: string } | { json: unknown } | { call: Call };
export interface Call {
  fn: Fn;
  args: { [k: string]: Value };
}
export interface Line {
  bind?: string;
  call: Call;
}
export type Program = { lines: Line[] } | { none: Label };

export class CallSyntaxError extends Error {}

// ---------------------------------------------------------------- parsing

const ID = /^[A-Za-z0-9_.:\/-]+/;
const NAME = /^[a-z][a-z0-9_]{0,31}$/;

class Reader {
  i = 0;
  constructor(readonly s: string) {}
  ws() {
    while (this.i < this.s.length && /[ \t\r\n]/.test(this.s[this.i]!)) this.i++;
  }
  peek() {
    this.ws();
    return this.s[this.i];
  }
  eat(c: string) {
    this.ws();
    if (this.s[this.i] !== c) throw new CallSyntaxError(`expected "${c}" at ${this.i}`);
    this.i++;
  }
  token(): string {
    this.ws();
    const m = ID.exec(this.s.slice(this.i));
    if (!m) throw new CallSyntaxError(`expected a name or id at ${this.i}`);
    this.i += m[0].length;
    return m[0];
  }
  string(): string {
    this.eat('"');
    let out = "";
    for (;;) {
      const c = this.s[this.i++];
      if (c === undefined) throw new CallSyntaxError("unterminated string");
      if (c === '"') return out;
      if (c === "\\") {
        const e = this.s[this.i++];
        if (e !== '"' && e !== "\\") throw new CallSyntaxError(`bad escape \\${e}`);
        out += e;
      } else out += c;
    }
  }
  json(): unknown {
    this.ws();
    const start = this.i;
    let depth = 0;
    let inStr = false;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i]!;
      if (inStr) {
        if (c === "\\") this.i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          this.i++;
          const v = JSON.parse(this.s.slice(start, this.i));
          canonical(v); // integers only, like everything else in the contracts
          return v;
        }
      }
    }
    throw new CallSyntaxError("unterminated JSON value");
  }
}

function parseCall(r: Reader, fn: string, vars: Set<string>): Call {
  if (!(FUNCTIONS as readonly string[]).includes(fn)) throw new CallSyntaxError(`unknown function ${fn}`);
  r.eat("(");
  const args: { [k: string]: Value } = {};
  if (r.peek() !== ")") {
    for (;;) {
      const key = r.token();
      if (!NAME.test(key)) throw new CallSyntaxError(`bad argument name ${key}`);
      if (key in args) throw new CallSyntaxError(`argument ${key} given twice`);
      r.eat("=");
      args[key] = parseValue(r, vars);
      if (r.peek() === ",") {
        r.eat(",");
        continue;
      }
      break;
    }
  }
  r.eat(")");
  return { fn: fn as Fn, args };
}

function parseValue(r: Reader, vars: Set<string>): Value {
  const c = r.peek();
  if (c === '"') return { text: r.string() };
  if (c === "{" || c === "[") return { json: r.json() };
  const tok = r.token();
  if (r.peek() === "(" && (FUNCTIONS as readonly string[]).includes(tok)) return { call: parseCall(r, tok, vars) };
  return vars.has(tok) ? { var: tok } : { id: tok };
}

/** Parse a program in the call language. Throws CallSyntaxError. */
export function parseProgram(text: string): Program {
  const src = text.trim();
  const none = /^none\(\s*([a-z_]+)\s*\)$/.exec(src);
  if (none) {
    if (!(LABELS as readonly string[]).includes(none[1]!)) throw new CallSyntaxError(`unknown label ${none[1]}`);
    return { none: none[1] as Label };
  }
  const r = new Reader(src);
  const vars = new Set<string>();
  const lines: Line[] = [];
  while (r.peek() !== undefined) {
    const first = r.token();
    let bind: string | undefined;
    let fn = first;
    if (r.peek() === "=") {
      if (!NAME.test(first)) throw new CallSyntaxError(`bad variable name ${first}`);
      r.eat("=");
      bind = first;
      fn = r.token();
    }
    const call = parseCall(r, fn, vars);
    if (bind) {
      if (vars.has(bind)) throw new CallSyntaxError(`variable ${bind} bound twice`);
      vars.add(bind);
    }
    lines.push(bind ? { bind, call } : { call });
    if (lines.length > 32) throw new CallSyntaxError("more than 32 lines");
  }
  if (lines.length === 0) throw new CallSyntaxError("empty program");
  return { lines };
}

// ---------------------------------------------------------------- the contract's argument table (P12)

/**
 * Arguments the contract allows that only code writes, and that no one asking in words or a model writing a program is
 * offered. None now: `money(..., line=parks)`, which names the line of a body's adopted budget a payment is drawn on
 * (contracts/calls.md; docs/behaviour/government.md, "Payments carry their budget line"), was one until 2026-10-14,
 * when it was taught to the translator (prompt 0.9.5; docs/decisions.md, the third round's step 0): a request that
 * names the line it is charged to carries it. It is in `ARGS` now, so a translator is taught and shown it. The
 * mechanism stays for an argument that must again be code's alone.
 */
export const CODE_ARGS: { [fn: string]: Set<string> } = {
  // (The client a vendor delivers a system to: only the vendor's code does that, as the supplier, and no request in words does: docs/behaviour/automation.md.)
  system: new Set(["to"]),
};

/** Per function: the arguments it takes (undefined: any, as with a form's fields) and the ones it needs. Read from contracts/calls.schema.json, so it can't drift from the contract. Not the arguments only code writes (`CODE_ARGS`). */
export const ARGS: { [fn: string]: { allowed?: Set<string>; required: string[] } } = Object.fromEntries(
  (CALLS_SCHEMA as any).$defs.Call.allOf.map((rule: any) => {
    const args = rule.then.properties.args;
    const fn = rule.if.properties.fn.const;
    return [fn, { allowed: args.propertyNames ? new Set<string>((args.propertyNames.enum as string[]).filter((k) => !CODE_ARGS[fn]?.has(k))) : undefined, required: args.required ?? [] }];
  }),
);

/** What's wrong with a program against the contract (unknown or missing arguments, in any nested call); empty if nothing. */
export function contractErrors(p: Program): string[] {
  if ("none" in p) return [];
  const out: string[] = [];
  const check = (c: Call, where: string) => {
    const a = ARGS[c.fn];
    if (!a) return void out.push(`${where}: unknown function ${c.fn}`);
    for (const k of Object.keys(c.args)) if (a.allowed && !a.allowed.has(k) && !CODE_ARGS[c.fn]?.has(k)) out.push(`${where}: ${c.fn} takes no argument ${k}`);
    for (const k of a.required) if (!(k in c.args)) out.push(`${where}: ${c.fn} needs ${k}`);
    for (const [k, v] of Object.entries(c.args)) if ("call" in v) check(v.call, `${where}.${k}`);
  };
  p.lines.forEach((l, i) => check(l.call, `line ${i + 1}`));
  return out;
}

// ---------------------------------------------------------------- serialising

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function valueText(v: Value): string {
  if ("id" in v) return v.id;
  if ("var" in v) return v.var;
  if ("text" in v) return quote(v.text);
  if ("json" in v) return canonical(v.json);
  return callText(v.call);
}

/** Canonical text of a call: arguments in key order. */
export function callText(c: Call): string {
  return `${c.fn}(${Object.keys(c.args).sort().map((k) => `${k}=${valueText(c.args[k]!)}`).join(", ")})`;
}

export function programText(p: Program): string {
  if ("none" in p) return `none(${p.none})`;
  return p.lines.map((l) => (l.bind ? `${l.bind} = ${callText(l.call)}` : callText(l.call))).join("\n");
}

// ---------------------------------------------------------------- builders (for code participants)

type Arg = string | number | { text: string } | { json: unknown } | { var: string } | Call | undefined;

/** Ids are bare; strings that aren't ids, and all amounts and durations, are quoted text. */
function toValue(a: Exclude<Arg, undefined>): Value {
  if (typeof a === "number") return { text: String(a) };
  if (typeof a === "string") return ID.test(a) && ID.exec(a)![0] === a ? { id: a } : { text: a };
  if ("fn" in a) return { call: a };
  return a as Value;
}

export function call(fn: Fn, args: { [k: string]: Arg }): Call {
  const out: { [k: string]: Value } = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined) out[k] = toValue(v);
  return { fn, args: out };
}

export const text = (s: string) => ({ text: s });
/** A JSON value, as its text will read back: what JSON can't hold (an undefined field, say) is dropped now, so the
 * program written and the program read from its text are the same. */
export const json = (v: unknown) => ({ json: v === undefined ? v : JSON.parse(JSON.stringify(v)) });
export const v = (name: string) => ({ var: name });
/** An amount (in the smallest unit) as a canonical text the parser reads back exactly, in the money of the world now
 * being stepped (money.ts): its sign or code, the whole units ungrouped, and its decimals. */
export const amountText = (n: number) => {
  const cur = currencyNow();
  const per = 10 ** cur.minor_units;
  return text(`${cur.symbol ?? `${cur.code} `}${Math.floor(n / per)}${cur.minor_units > 0 ? `.${String(n % per).padStart(cur.minor_units, "0")}` : ""}`);
};
/** Seconds as a duration text: whole days where possible. */
export const secs = (s: number) => text(s % 86_400 === 0 ? `${s / 86_400} days` : `${s} seconds`);

export function program(...lines: (Call | [string, Call])[]): string {
  return programText(programOf(...lines));
}

/** A program as its structure: what `program` writes out, with each call's arguments in the order its text has them. */
export function programOf(...lines: (Call | [string, Call])[]): Program {
  const sorted = (c: Call): Call => ({ fn: c.fn, args: Object.fromEntries(Object.keys(c.args).sort().map((k) => { const v = c.args[k]!; return [k, "call" in v ? { call: sorted(v.call) } : v]; })) });
  return { lines: lines.map((l) => (Array.isArray(l) ? { bind: l[0], call: sorted(l[1]) } : { call: sorted(l) })) };
}

/**
 * A call action's program as the structure it was written from (an in-process code participant's): the orchestrator
 * uses it rather than reading its text back, which it would read as exactly this. Not part of the action (a symbol:
 * never serialised); the text is what the participant said.
 */
export const PARSED = Symbol.for("oikos.call-program");

// ---------------------------------------------------------------- unit tables

export class UnitError extends Error {}

/** The words and letters that multiply the digits before them. (Words for numbers, as people who count in them
 * write them: no currency's.) */
const MULTIPLIERS: [string, bigint][] = [["thousand", 1_000n], ["million", 1_000_000n], ["billion", 1_000_000_000n], ["trillion", 1_000_000_000_000n], ["k", 1_000n], ["m", 1_000_000n], ["b", 1_000_000_000n], ["t", 1_000_000_000_000n]];
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isPlainLetter = (c: string | undefined) => c !== undefined && c >= "a" && c <= "z";

const normalGroup = (g: string): string => (g === "’" ? "'" : /\s/.test(g) ? " " : g);

/** What the config settles about the two marks: the decimal mark and the mark between groups, each only where the
 * config says it (directly, or by saying the other). A space or an apostrophe is the same however it is written. */
function statedMarks(cur: Currency): { decimal: string | undefined; group: string | undefined } {
  const other = (c: string) => (c === "," ? "." : ",");
  const g = cur.group_mark;
  const decimal = cur.decimal_mark ?? (g === "," || g === "." ? other(g) : undefined);
  const group = g === undefined ? (cur.decimal_mark === undefined ? undefined : other(cur.decimal_mark)) : g === "\u2019" ? "'" : /\s/.test(g) ? " " : g;
  return { decimal, group };
}

/**
 * An amount as written, in the currency's smallest unit, exact, as the contracts write it (a decimal string, D58).
 *
 * What is read, in this order:
 *  - a marker of this world's money, before the digits or after them, with a space or without: the currency's sign,
 *    its code, a word for its unit, or its sign with the first two letters of its code before it (how a sign that
 *    several currencies share is told apart). A marker that ends in a letter may have a full stop and a space after it;
 *  - the digits, with their separators. A comma and a point together: the one written last is the decimal mark and
 *    the other groups the digits. Either of them written more than once groups the digits. A point written once is
 *    a decimal point. A comma written once groups the digits if three follow it, and is a decimal comma if one or two
 *    do. Digits are grouped in threes, or (with commas, or where the currency's `grouping` is [3, 2]) the last
 *    three and then twos. Where the currency says its marks (`decimal_mark`, `group_mark`) a mark written once is
 *    what it says: its decimal mark is the decimals, its group mark groups the digits if exactly three follow it and
 *    a whole of one to three digits (not starting with a zero) comes before it; a space or an apostrophe between
 *    groups of digits is read only where the currency's group mark is one;
 *  - a multiplier (k, m, b, t; thousand, million, billion, trillion; and the currency's own `number_words`), only
 *    where a marker or the end follows it;
 *  - then a marker again, or a word for the smallest unit (then whole digits and no multiplier).
 * Bare digits are whole units. Nothing finer than the smallest unit, and no arithmetic on anything but the digits
 * written.
 *
 * What is not read, because it could be two numbers and a currency's config doesn't say which: a point written once
 * with three digits after it, in a currency of fewer than three decimals, whose config says neither its decimal mark
 * nor that a point groups digits (a decimal point with a decimal too many, or thousands grouped by a point). Another currency's sign, code
 * or words are not this world's money, and are not read; nor is a number written out in words.
 * (The kernel's resolver reads the same, step for step: `parse_amount`. contracts/test/amounts.json holds what both
 * must read and what both must refuse.)
 */
export function parseAmount(s: string, cur: Currency): string {
  const err = () => new UnitError(`not an amount: ${s}`);
  const grouping = () => new UnitError(`badly grouped digits: ${s}`);
  const { decimal: statedDec, group: statedGrp } = statedMarks(cur);
  const spacedGroups = statedGrp === " ";
  const apostropheGroups = statedGrp === "'";
  let t = s.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  if (apostropheGroups) t = t.replaceAll("\u2019", "'");
  const code = cur.code.toLowerCase();
  const symbol = cur.symbol?.toLowerCase();
  const minor = cur.minor_units;
  const minors = (cur.minor_words ?? []).map((u) => u.toLowerCase());
  // What marks an amount as this world's money. (Tried longest first: a sign may be how its code or a word begins.)
  const markers = [code, ...(cur.unit_words ?? []).map((u) => u.toLowerCase())];
  if (symbol !== undefined) markers.push(symbol);
  if (symbol !== undefined && ![...symbol].some((c) => isPlainLetter(c) || isDigit(c))) markers.push(code.slice(0, 2) + symbol);
  markers.sort((a, b) => b.length - a.length);
  const after = (x: string, prefix: string) => (prefix !== "" && x.startsWith(prefix) ? x.slice(prefix.length) : undefined);
  const space = (x: string) => after(x, " ") ?? x;
  const isUnit = (w: string) => w !== "" && markers.includes(w);
  const isMinor = (w: string) => minors.includes(w);
  let rest = t;
  if (!isDigit(rest[0])) {
    // A marker first: one that has the digits straight after it.
    let found: string | undefined;
    for (const m of markers) {
      let r = after(rest, m);
      if (r === undefined) continue;
      if (isPlainLetter(m[m.length - 1]) && r.startsWith(". ")) r = r.slice(1);
      r = space(r);
      if (isDigit(r[0])) {
        found = r;
        break;
      }
    }
    if (found === undefined) throw err();
    rest = found;
  }
  // The digits and their separators (a separator is one only between two digits).
  let end = 0;
  const threeThenNot = (at: number) => isDigit(rest[at + 1]) && isDigit(rest[at + 2]) && isDigit(rest[at + 3]) && !isDigit(rest[at + 4]);
  while (end < rest.length && (isDigit(rest[end]) || ((rest[end] === "," || rest[end] === "." || (apostropheGroups && rest[end] === "'")) && isDigit(rest[end + 1])) || (spacedGroups && rest[end] === " " && threeThenNot(end)))) end++;
  const number = rest.slice(0, end);
  rest = space(rest.slice(end));
  // Which separator is the decimal mark, if either is.
  const commas = number.split(",").length - 1;
  const points = number.split(".").length - 1;
  let mark = "";
  if (commas > 0 && points > 0) mark = number.lastIndexOf(",") > number.lastIndexOf(".") ? "," : ".";
  else if (commas + points === 1) {
    // A mark written once. What the currency says settles it; else a point is the decimals, and a comma is the
    // decimals if one or two digits follow it.
    const sep = points === 1 ? "." : ",";
    const at = number.indexOf(sep);
    const head = number.slice(0, at);
    const afterLen = number.length - at - 1;
    if (statedDec === sep) mark = sep;
    else if (statedGrp === sep && afterLen === 3 && !head.startsWith("0")) mark = "";
    else if (sep === ".") mark = ".";
    else if (afterLen < 3) mark = ",";
  }
  const group = [" ", "'"].find((g) => number.includes(g)) ?? (mark === "," || (mark === "" && points > 0) ? "." : ",");
  const cut = mark === "" ? number.length : number.lastIndexOf(mark);
  const whole = number.slice(0, cut);
  const frac = number.slice(cut + 1);
  if (mark !== "" && whole.includes(mark)) throw grouping();
  if (frac.length > Math.max(minor, 3)) throw err();
  let mult = 1n;
  let hasMult = false;
  // (The place's own words first, the longest first: one that begins another is tried before it.)
  const own: [string, bigint][] = Object.entries(cur.number_words ?? {}).map(([w, v]): [string, bigint] => [w.toLowerCase(), BigInt(v)]).filter(([w]) => w !== "").sort((a, b) => b[0].length - a[0].length);
  for (const [w, m] of [...own, ...MULTIPLIERS]) {
    const r = after(rest, w);
    if (r === undefined) continue;
    // (A multiplier only when a marker, a word for the smallest unit, or the end follows.)
    const r2 = space(r);
    if (r2 === "" || isUnit(r2) || isMinor(r2)) {
      mult = m;
      hasMult = true;
      rest = r;
      break;
    }
  }
  rest = space(rest);
  let inMinor = false;
  if (rest !== "" && !isUnit(rest)) {
    if (!isMinor(rest)) throw err();
    inMinor = true;
  }
  const groups = whole.split(group);
  if (groups.length > 1) {
    const first = groups[0]!.length;
    const threes = first <= 3 && groups.slice(1).every((g) => g.length === 3);
    const twosRead = cur.grouping ? cur.grouping.length > 1 && group === normalGroup(marksOf(cur).group) : group === ",";
    const twos = twosRead && groups.length > 2 && first <= 2 && groups.slice(1, -1).every((g) => g.length === 2) && groups[groups.length - 1]!.length === 3;
    if (!threes && !twos) throw grouping();
  }
  if (inMinor && (frac !== "" || hasMult)) throw err();
  // (The one that could be two numbers is said to be so: one to three digits, a point, three digits.)
  if (frac.length > minor && mult === 1n && mark === "." && statedDec === undefined && frac.length === 3 && commas === 0 && whole.length <= 3 && whole[0] !== "0") throw new UnitError(`a point with three digits after it can be read two ways: ${s}`);
  if (frac.length > minor && mult === 1n) throw new UnitError(minor === 0 ? `this money has no decimals: ${s}` : `more than ${NUMBER_WORDS[minor] ?? "that many"} decimals: ${s}`);
  const perUnit = inMinor ? 1n : 10n ** BigInt(minor);
  // The decimals, carried exactly: what's written, times the multiplier, must come to whole smallest units.
  const fracScaled = BigInt(frac || "0") * mult * perUnit;
  const fracDiv = 10n ** BigInt(frac.length);
  if (fracScaled % fracDiv !== 0n) throw new UnitError(cur.minor_words?.length ? `fraction of a ${cur.minor_words[0]}: ${s}` : `fraction of the smallest unit: ${s}`);
  const n = BigInt(groups.join("")) * mult * perUnit + fracScaled / fracDiv;
  if (n.toString().length > 38) throw new UnitError(`too large: ${s}`);
  return n.toString();
}


const DAY = 86_400;
const UNIT: Record<string, number> = {
  second: 1, minute: 60, hour: 3600, day: DAY, week: 7 * DAY, fortnight: 14 * DAY, month: 30 * DAY, quarter: 90 * DAY, year: 365 * DAY,
};
const ADVERB: Record<string, number> = {
  hourly: 3600, daily: DAY, weekly: 7 * DAY, fortnightly: 14 * DAY, monthly: 30 * DAY, quarterly: 90 * DAY, yearly: 365 * DAY, annually: 365 * DAY,
};
const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

/** "30 days", "2 weeks", "monthly", "every 3 months", "a year" → seconds. The world has no calendar: a month is 30 days, a year 365. */
export function parseDuration(s: string): number {
  // "12-month" (as in "a 12-month lease") reads as "12 month".
  const t = s.trim().toLowerCase().replace(/\s+/g, " ").replace(/^once /, "").replace(/^(every|each) /, "").replace(/^per /, "").replace(/^([0-9]+|[a-z]+)-(?=[a-z])/, "$1 ")
    // ("each working day", "every school day": a day, of the days those whose work it is are at work.)
    .replace(/(^| )(working|school|business|week) ?day(s?)$/, (_all: string, lead: string, _which: string, plural: string) => `${lead}day${plural}`);
  if (t in ADVERB) return ADVERB[t]!;
  const m = /^([0-9]+|[a-z]+)? ?(second|minute|hour|day|week|fortnight|month|quarter|year)s?$/.exec(t);
  if (!m) throw new UnitError(`not a duration: ${s}`);
  const n = m[1] === undefined ? 1 : /^[0-9]+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1]];
  if (n === undefined) throw new UnitError(`not a duration: ${s}`);
  return n * UNIT[m[2]!]!;
}

/** When something is to happen, as written: a date (`at`: the moment that day begins) or a length of time from when
 * the paper is lodged (`in`: seconds). */
export type When = { at: number } | { in: number };

/**
 * A "when" as written (`first`, `until`): a date as the world's papers write one ("year 1, day 22", "year 1 day 22",
 * "day 22" of the year it now is, "year 2"; "tomorrow"), or a length of time ("14 days", "a fortnight", "today" and
 * "now": none at all). The words people put round either are read past: "from year 1, day 22", "on day 22",
 * "starting today", "until day 90", "in 14 days", "after 21 days", "14 days from now". Bare digits are neither, and are refused.
 * `now` is the moment it is read at (for "tomorrow" and for a day with no year). (The kernel's resolver reads the
 * same, step for step: `parse_when`. contracts/test/when.json holds what both must read and what both must refuse.)
 */
export function parseWhen(s: string, now: number): When {
  const YEAR = 365 * DAY;
  const err = () => new UnitError(`not a date or a duration: ${s}`);
  let t = s.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  if (t === "at once") return { in: 0 };
  for (const lead of [["starting ", "beginning ", "commencing ", "effective "], ["from ", "on ", "in ", "after ", "at ", "until ", "till "], ["the "]]) {
    const p = lead.find((x) => t.startsWith(x));
    if (p) t = t.slice(p.length);
  }
  for (const tail of [" from now", " from today", "'s time", " in time", " later", " hence"]) {
    if (t.endsWith(tail)) {
      t = t.slice(0, -tail.length);
      break;
    }
  }
  if (["today", "now", "immediately", "at once", "straight away"].includes(t)) return { in: 0 };
  if (t === "tomorrow") return { at: (Math.floor(now / DAY) + 1) * DAY };
  const m = /^(?:year ?([0-9]{1,6}))? ?,? ?(?:day ?([0-9]{1,3}))?$/.exec(t);
  if (m && (m[1] !== undefined || m[2] !== undefined)) {
    const year = m[1] === undefined ? Math.floor(now / YEAR) + 1 : Number(m[1]);
    const day = Number(m[2] ?? 1);
    if (year < 1 || day < 1 || day > 365) throw err();
    return { at: ((year - 1) * 365 + (day - 1)) * DAY };
  }
  try {
    return { in: parseDuration(t) };
  } catch {
    throw err();
  }
}

/**
 * "1", "one", "3" → a count. With the world's currency, digits grouped as the place groups them are read exactly as
 * an amount's are (parseAmount: "60,000", or "60.000" where a point groups digits, or "1,50,000" where the place
 * groups in twos), and so is a multiplier ("60k", "2 thousand"); what an amount's digits could not be (a decimal, a
 * mark that could be read two ways) is not a count. Never nought, unless `zero` says it may be.
 */
export function parseCount(s: string, cur?: Currency, zero = false): number {
  const t = s.trim().toLowerCase();
  const err = () => new UnitError(`not a count: ${s}`);
  let n: number | undefined = /^[0-9]{1,15}$/.test(t) ? Number(t) : WORDS[t];
  if (n === undefined && cur && isDigit(t[0])) {
    // (The place's way of writing numbers, and nothing of its money: no sign, code or word, and no decimals.)
    const plain: Currency = { code: "", minor_units: 0, ...(cur.decimal_mark !== undefined ? { decimal_mark: cur.decimal_mark } : {}), ...(cur.group_mark !== undefined ? { group_mark: cur.group_mark } : {}), ...(cur.grouping ? { grouping: cur.grouping } : {}), ...(cur.number_words ? { number_words: cur.number_words } : {}) };
    let read: string;
    try {
      read = parseAmount(t, plain);
    } catch {
      throw err();
    }
    if (read.length > 15) throw err();
    n = Number(read);
  }
  if (n === undefined || !Number.isSafeInteger(n) || n < 0 || (n === 0 && !zero)) throw err();
  return n;
}
