// Whether two programs mean the same, compared by value and not by spelling.
//
// A request translated back is right if the program that comes back does what the gold program does, however it is
// written. Comparing texts lost good examples (the audit of 2026-10-06: of 47 rejected, 21 were good requests, five of
// them over nothing but spelling): `every="every 28 days"` is `every="28 days"`, `leave=true` is `leave=yes`,
// `by=c0013` is `by=["c0013"]`. Each equivalence here is one the resolver itself makes (translator/src/resolver.ts,
// and the kernel's, which reads the same): nothing is called equal that would resolve differently.
//
//   amounts     by `parseAmount`, in the world's money (given); with no currency given, as written
//   durations   by `parseDuration` ("monthly" is "30 days")
//   counts      by `parseCount` ("six" is "6")
//   flags       yes or true is yes; no or false is the flag left out (FLAGS)
//   labels      a kind, role or template written in words is the label the resolver makes of it (LABELS)
//   lists       a list of one is the one; a list of names is a set, in any order
//   a purpose   on a payment: without its article, its case or its closing full stop
//   a form      named by its name, in ordinary words or by its record's id; its office left out is the office it
//               goes to, where the forms known say there is one; its fields read as their types say
//   one each    a call repeated once for each of several recipients is the call made once to all of them, where the
//               call language makes those the same act (ONE_EACH: a letter). Work is not such a call: `units` is
//               the whole job, so four people doing 12 units is not four jobs of 12.
//   names       what a line calls the thing it makes is the writer's choice; one that nothing uses is no part of it
//
// This file depends on the call language and the resolver's label rule only, so the translator's test set can use it
// too (translator/eval/run.ts compares in canonical form today).

import { calls, type Currency } from "@oikos/participants";
import { asLabel } from "../src/resolver";

/** What a comparison may know of the world the programs are from: how it writes money, and the forms known there. */
export interface MeaningContext {
  currency?: Currency;
  forms?: { form: string; to: string; id?: string; fields: { [name: string]: { type: string } } }[];
}

const AMOUNT_ARGS = new Set(["amount", "price", "carrying"]);
const DURATION_ARGS = new Set(["every", "term", "our_notice", "their_notice", "first", "age"]);
const COUNT_ARGS = new Set(["quantity", "units"]);
/** The yes-or-no arguments, per function (the resolver's `yes`), and the one spelling gold programs use. */
export const FLAGS: { [fn: string]: string[] } = { occupancy: ["leave"], presence: ["leave"] };
export const FLAG_YES = "yes";
/** Arguments the resolver reads as a label (`asLabel`): "price list" is `price_list`. */
const LABELS: { [fn: string]: string[] } = { entity: ["kind"], position: ["role"], agreement: ["template"], statement: ["kind"] };
/** Calls that mean the same made once to several or once to each: the function, and the argument listing them. */
export const ONE_EACH: { [fn: string]: string } = { message: "to" };

type Norm = string | Norm[] | { [k: string]: Norm };

const attempt = <T>(f: () => T): T | undefined => {
  try {
    return f();
  } catch {
    return undefined;
  }
};
const squeezed = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** A form's name as the resolver reads it: lower case, no article, spaces as underscores. */
const formName = (s: string) => s.trim().toLowerCase().replace(/^the\s+/, "").replace(/[\s-]+/g, "_");
const sorted = (o: { [k: string]: Norm }): { [k: string]: Norm } => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]!]));
const json = (v: unknown): Norm => (Array.isArray(v) ? v.map(json) : v && typeof v === "object" ? sorted(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, json(x)]))) : String(v));

/** A simple value (an id or a text) as what it comes to, by what kind of argument it is. */
function scalar(kind: string | undefined, s: string, ctx: MeaningContext): Norm | undefined {
  switch (kind) {
    case "amount": {
      const n = ctx.currency ? attempt(() => calls.parseAmount(s, ctx.currency!)) : undefined;
      return n !== undefined ? { amount: n } : squeezed(s);
    }
    case "duration": {
      const n = attempt(() => calls.parseDuration(s));
      return n !== undefined ? { seconds: String(n) } : squeezed(s);
    }
    case "count": {
      const n = attempt(() => calls.parseCount(s));
      return n !== undefined ? { count: String(n) } : squeezed(s);
    }
    case "flag": return /^(yes|true)$/i.test(s.trim()) ? FLAG_YES : /^(no|false)$/i.test(s.trim()) ? undefined : s;
    case "label": return asLabel(s) || s;
    case "purpose": return squeezed(s).replace(/^(the|a|an) /, "").replace(/[.!\s]+$/, "");
    default: return s;
  }
}

/** What kind of value an argument of a function takes (a form's fields: by the form's own types). */
function kindOf(fn: string, key: string, fields: { [name: string]: { type: string } } | undefined): string | undefined {
  if (fn === "form") {
    const t = fields?.[key]?.type;
    return t === "amount" || t === "duration" || t === "count" ? t : undefined;
  }
  if (AMOUNT_ARGS.has(key)) return "amount";
  if (DURATION_ARGS.has(key)) return "duration";
  if (COUNT_ARGS.has(key)) return "count";
  if (FLAGS[fn]?.includes(key)) return "flag";
  if (LABELS[fn]?.includes(key)) return "label";
  if (fn === "money" && key === "for") return "purpose";
  return undefined;
}

function call(c: calls.Call, ctx: MeaningContext, names: Map<string, string>): { [k: string]: Norm } {
  // The form filled in, as the forms known name it (by its name, in words, or by its record's id), and where it goes.
  let fields: { [name: string]: { type: string } } | undefined;
  let form: string | undefined;
  let office: string | undefined;
  if (c.fn === "form") {
    const f = c.args.form;
    const written = f && ("id" in f ? f.id : "text" in f ? f.text : undefined);
    if (written !== undefined) {
      const plain = formName(written);
      const spellings = [written, plain, plain.replace(/_form$/, "")];
      const known = (ctx.forms ?? []).filter((x) => spellings.includes(x.form) || x.id === written);
      form = known[0]?.form ?? plain;
      const to = c.args.to;
      const said = to && ("id" in to ? to.id : "text" in to ? to.text : undefined);
      const goes = [...new Set(known.map((x) => x.to))];
      office = said ?? (goes.length === 1 ? goes[0] : undefined);
      fields = (known.find((x) => x.to === office) ?? known[0])?.fields;
    }
  }
  const out: { [k: string]: Norm } = {};
  for (const [key, v] of Object.entries(c.args)) {
    const kind = kindOf(c.fn, key, fields);
    let n: Norm | undefined;
    if (c.fn === "form" && key === "form" && form !== undefined) n = form;
    else if ("call" in v) n = call(v.call, ctx, names);
    else if ("var" in v) n = { made: names.get(v.var) ?? v.var };
    else if ("id" in v) n = names.has(v.id) ? { made: names.get(v.id)! } : scalar(kind, v.id, ctx);
    else if ("text" in v) n = scalar(kind, v.text, ctx);
    else if (Array.isArray(v.json) && v.json.every((x) => typeof x === "string")) {
      // A list of names or ids: a set; one of them alone is that one.
      const xs = [...new Set((v.json as string[]).map((x) => scalar(kind, x, ctx)).filter((x): x is Norm => x !== undefined).map((x) => JSON.stringify(x)))].sort().map((x) => JSON.parse(x) as Norm);
      n = xs.length === 1 ? xs[0] : xs;
    } else n = json(v.json);
    if (n !== undefined) out[key] = n;
  }
  if (c.fn === "form" && office !== undefined) out.to = office;
  return { fn: c.fn, ...sorted(out) };
}

/**
 * What a program comes to, as a text two programs share exactly when they mean the same (see the top of this file);
 * undefined if it isn't a program.
 */
export function meaningOf(program: string | calls.Program, ctx: MeaningContext = {}): string | undefined {
  const p = typeof program === "string" ? attempt(() => calls.parseProgram(program)) : program;
  if (!p) return undefined;
  if ("none" in p) return `none(${p.none})`;
  // The names lines bind, in order, for the ones a later line uses.
  const mentions = (v: calls.Value, name: string): boolean => ("var" in v ? v.var === name : "id" in v ? v.id === name : "call" in v ? Object.values(v.call.args).some((x) => mentions(x, name)) : false);
  const names = new Map<string, string>();
  const lines: { bind?: string; call: { [k: string]: Norm } }[] = [];
  p.lines.forEach((l, i) => {
    const c = call(l.call, ctx, names); // (a line can't refer to the name it binds itself)
    const used = l.bind !== undefined && p.lines.slice(i + 1).some((x) => Object.values(x.call.args).some((v) => mentions(v, l.bind!)));
    if (used) names.set(l.bind!, `#${names.size + 1}`);
    lines.push(used ? { bind: names.get(l.bind!)!, call: c } : { call: c });
  });
  // One call to several, or one to each: the same.
  const merged: typeof lines = [];
  const groups = new Map<string, { [k: string]: Norm }>();
  for (const l of lines) {
    const arg = ONE_EACH[String(l.call.fn)];
    if (!arg || l.bind || l.call[arg] === undefined) {
      merged.push(l);
      continue;
    }
    const { [arg]: to, ...rest } = l.call;
    const key = JSON.stringify(rest);
    const all = Array.isArray(to) ? to : [to!];
    const g = groups.get(key);
    if (g) (g[arg] as Norm[]).push(...all);
    else {
      const c = { ...rest, [arg]: [...all] };
      groups.set(key, c);
      merged.push({ call: c });
    }
  }
  for (const c of groups.values()) {
    const arg = ONE_EACH[String(c.fn)]!;
    const xs = [...new Set((c[arg] as Norm[]).map((x) => JSON.stringify(x)))].sort().map((x) => JSON.parse(x) as Norm);
    c[arg] = xs.length === 1 ? xs[0]! : xs;
  }
  return JSON.stringify(merged.map((l) => (l.bind ? { bind: l.bind, call: sorted(l.call) } : { call: sorted(l.call) })));
}

/** Whether two programs mean the same (see the top of this file). Two texts that aren't programs are the same only if identical. */
export function sameMeaning(a: string, b: string, ctx: MeaningContext = {}): boolean {
  const x = meaningOf(a, ctx), y = meaningOf(b, ctx);
  return x === undefined || y === undefined ? a.trim() === b.trim() : x === y;
}
