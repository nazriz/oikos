// The call language (contracts/calls.md): parsing, canonical serialisation,
// typed builders for code seats, and the parser's unit tables (amounts and
// durations). Zero arithmetic happens in the translator: it copies text, and
// these tables convert it, deterministically.

import { canonical } from "./canon";
import CALLS_SCHEMA from "../../contracts/calls.schema.json";

export const FUNCTIONS = ["money", "account", "structure", "occupancy", "entity", "claim", "agreement", "statement", "vote", "message", "form"] as const;
export type Fn = (typeof FUNCTIONS)[number];
export const LABELS = ["not_yours", "needs_calculation", "too_much", "unclear", "unknown_form"] as const;
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

const ID = /^[A-Za-z0-9_.:-]+/;
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

/** Per function: the arguments it takes (undefined: any, as with a form's fields) and the ones it needs. Read from contracts/calls.schema.json, so it can't drift from the contract. */
export const ARGS: { [fn: string]: { allowed?: Set<string>; required: string[] } } = Object.fromEntries(
  (CALLS_SCHEMA as any).$defs.Call.allOf.map((rule: any) => {
    const args = rule.then.properties.args;
    return [rule.if.properties.fn.const, { allowed: args.propertyNames ? new Set<string>(args.propertyNames.enum) : undefined, required: args.required ?? [] }];
  }),
);

/** What's wrong with a program against the contract (unknown or missing arguments, in any nested call); empty if nothing. */
export function contractErrors(p: Program): string[] {
  if ("none" in p) return [];
  const out: string[] = [];
  const check = (c: Call, where: string) => {
    const a = ARGS[c.fn];
    if (!a) return void out.push(`${where}: unknown function ${c.fn}`);
    for (const k of Object.keys(c.args)) if (a.allowed && !a.allowed.has(k)) out.push(`${where}: ${c.fn} takes no argument ${k}`);
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

// ---------------------------------------------------------------- builders (for code seats)

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
export const json = (v: unknown) => ({ json: v });
export const v = (name: string) => ({ var: name });
/** Cents as a canonical amount text the parser reads back exactly: 123456 → "$1,234.56". */
export const dollars = (cents: number) => text(`$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
/** Seconds as a duration text: whole days where possible. */
export const secs = (s: number) => text(s % 86_400 === 0 ? `${s / 86_400} days` : `${s} seconds`);

export function program(...lines: (Call | [string, Call])[]): string {
  return programText({ lines: lines.map((l) => (Array.isArray(l) ? { bind: l[0], call: l[1] } : { call: l })) });
}

// ---------------------------------------------------------------- unit tables

export class UnitError extends Error {}

/** "$500", "$1,234.56", "60k", "$1.5k", "$2m", "500 dollars", "250 cents" → integer cents. No arithmetic on anything but the digits written. */
export function parseAmount(s: string): number {
  const t = s.trim().toLowerCase().replace(/\s+/g, " ");
  const m = /^\$?\s?([0-9][0-9,]*)(?:\.([0-9]{1,3}))?\s?(k|m|b|thousand|million|billion)?\s?(dollars?|bucks|cents?)?$/.exec(t);
  if (!m) throw new UnitError(`not an amount: ${s}`);
  const whole = m[1]!;
  if (whole.includes(",") && !/^[0-9]{1,3}(,[0-9]{3})*$/.test(whole)) throw new UnitError(`badly grouped digits: ${s}`);
  const mult = ({ k: 1_000n, thousand: 1_000n, m: 1_000_000n, million: 1_000_000n, b: 1_000_000_000n, billion: 1_000_000_000n } as Record<string, bigint>)[m[3] ?? ""] ?? 1n;
  const cents = m[4]?.startsWith("cent");
  if (cents && (m[2] || m[3])) throw new UnitError(`not an amount: ${s}`);
  const frac = m[2] ?? "";
  if (frac.length === 3 && mult === 1n) throw new UnitError(`more than two decimals: ${s}`);
  const unitsPerDollar = cents ? 1n : 100n;
  const scaled = (BigInt(whole.replace(/,/g, "")) * 1000n + BigInt((frac + "000").slice(0, 3))) * mult * unitsPerDollar;
  if (scaled % 1000n !== 0n) throw new UnitError(`fraction of a cent: ${s}`);
  const n = scaled / 1000n;
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new UnitError(`too large: ${s}`);
  return Number(n);
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
  const t = s.trim().toLowerCase().replace(/\s+/g, " ").replace(/^every /, "").replace(/^per /, "");
  if (t in ADVERB) return ADVERB[t]!;
  const m = /^([0-9]+|[a-z]+)? ?(second|minute|hour|day|week|fortnight|month|quarter|year)s?$/.exec(t);
  if (!m) throw new UnitError(`not a duration: ${s}`);
  const n = m[1] === undefined ? 1 : /^[0-9]+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1]];
  if (n === undefined) throw new UnitError(`not a duration: ${s}`);
  return n * UNIT[m[2]!]!;
}

/** "1", "one", "3" → a count. */
export function parseCount(s: string): number {
  const t = s.trim().toLowerCase();
  const n = /^[0-9]+$/.test(t) ? Number(t) : WORDS[t];
  if (!n || !Number.isSafeInteger(n)) throw new UnitError(`not a count: ${s}`);
  return n;
}
