// A form that writes a paper (contracts/outcomes.schema.json, FormData `writes`; docs/behaviour/office-papers.md).
//
// An office's own stationery: the papers it issues, each as a form. Filled in, a form with `writes` becomes the typed
// statement the rest of the world already reads (a death registration, a job advertisement, a permit decision): the
// form says how its fields are written into the statement's words, its content, whom it is addressed to and what it
// cites. This file is the one reading of that, for the repository's resolver and for whoever turns a paper back into
// the form that writes it (a mock seat's brain); the engine's resolver has the same, step for step
// (kernel/crates/resolver/src/forms.rs), and both are held to contracts/test/forms.json.
//
// A template is JSON. A string in it that begins with one of these marks stands for a field of the form:
//   "=name"   the field as the form reads it: an amount as a decimal string in the smallest unit, a length of time
//             or a date in seconds, a count as a number, a list as its ids, anything else as written
//   "#name"   the field as a whole number (an amount in the smallest unit, a count, digits written as a choice)
//   "?name"   a yes-or-no choice as true or false
//   "+name"   a length of time counted from now: the moment it ends
//   "=self"   whoever the paper is made for
// A field not given leaves out the key it would have filled (or its place in a list); a list given where a list's
// item stands is set out in its place. Anything else is as written. In `text`, `{name}` is the field in words.

const DAY = 86_400;
const YEAR = 365 * DAY;

export interface FormFieldSpec { type: string; required?: boolean; options?: string[]; description?: string }
export interface FormWrites {
  kind: string;
  text: string;
  data?: unknown;
  to?: unknown[];
  visible?: "public" | unknown[];
  basis?: string;
  offer?: unknown;
  assertion?: unknown;
  /** Whom the form itself sends every paper to, whatever its fields say, and why, in the form's own words. */
  sends?: { to: string[]; why: string }[];
  /** A claim recorded beside the paper (the permission a decision grants): contracts, FormWrites `claim`. */
  claim?: FormClaim;
}
/** A claim a form records beside its paper: where `when` holds (each field named has that value; absent: always),
 * the holder has `position` about `about`, citing `basis`. `holder` and `basis` name fields ("=applicant"; "=self"
 * for whoever the paper is made for); `about` is a template like the paper's data. Every field they name is then
 * needed: a permission that does not say what it permits is not recorded. */
export interface FormClaim { when?: { [field: string]: string }; position: "right" | "liberty" | "power" | "immunity"; holder: string; about: unknown; basis?: string }
/** The claim a form records, as the act that records it has it. */
export interface WrittenClaim { position: FormClaim["position"]; holder: string; about: unknown; basis?: string }
export interface FormData { form: string; office?: string; submit_as: string; submit_to: string[]; fields: { [name: string]: FormFieldSpec }; writes?: FormWrites }

/** A field as the form reads it: an amount (a decimal string), a length of time, a date or a count (a number), a
 * list (its ids), or words. */
export type FieldValue = string | number | string[];
export interface Filled { [field: string]: FieldValue }

/** What a form with `writes` makes of its fields: a statement, as the act that publishes it has it. */
export interface Paper { kind: string; text: string; data?: unknown; addressed_to?: string[]; visible_to?: "public" | string[]; basis?: string; offer?: unknown; assertion?: unknown }

import { calendarNow, calendarWords, readCalendarDate } from "./calendar";

export class FormError extends Error {}

/** A length of time in words, as people say one: whole days where it is whole days ("14 days", "1 day"); else whole
 * hours ("8 hours"); else hours and minutes ("1 hour 30 minutes", "45 minutes"); seconds only where nothing rounder
 * fits. (The kernel's resolver writes the same: `duration_words`.) */
export function durationWords(seconds: number): string {
  const n = (x: number, word: string) => `${x} ${word}${x === 1 ? "" : "s"}`;
  if (seconds % DAY === 0) return n(seconds / DAY, "day");
  if (seconds < 0) return n(seconds, "second");
  if (seconds % 3_600 === 0) return n(seconds / 3_600, "hour");
  if (seconds % 60 === 0) return seconds > 3_600 ? `${n(Math.floor(seconds / 3_600), "hour")} ${n((seconds % 3_600) / 60, "minute")}` : n(seconds / 60, "minute");
  return n(seconds, "second");
}

/** A date in words, as a report gives one. With a calendar (the world now being stepped: `inCalendar`) the place's way,
 * "12 March 2026" (docs/design/names-and-dates.md); without, "year 1, day 12", a year of 365 days. */
export function dateWords(t: number, long = false): string {
  const cal = calendarNow();
  if (cal) return calendarWords(cal, t, long);
  return `year ${Math.floor(t / YEAR) + 1}, day ${Math.floor((t % YEAR) / DAY) + 1}`;
}

/** A date as written ("year 2, day 40", or "day 40" of the first year; with a calendar also the place's: "12 March 2026"):
 * the moment that day begins. `now` is the moment it is read at (a date with no year is this year's). */
export function parseDate(s: string, now = 0): number {
  // (A moment as a record has it, in seconds: bare digits.)
  if (/^\s*[0-9]{1,15}\s*$/.test(s)) return Number(s.trim());
  const cal = calendarNow();
  const civil = cal ? readCalendarDate(cal, s, now) : undefined;
  if (civil !== undefined) return civil;
  // (A day may be followed by a time of day, as the town's own papers write a moment: "year 1, day 289, 13:00". A
  // registrar copying a birth notification's "born at" wrote it so, with and without the commas, and was told it was
  // not a date: wave 2c's review, fault 10.)
  const m = /^\s*(?:year\s*([0-9]{1,6}))?\s*,?\s*(?:day\s*([0-9]{1,3})(?:\s*,?\s*([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?)?)?\s*$/i.exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined)) throw new FormError(`not a date: ${s}. A date is written like "${cal ? calendarWords(cal, now) : "year 1, day 12"}".`);
  const year = Number(m[1] ?? 1), day = Number(m[2] ?? 1);
  const hour = Number(m[3] ?? 0), minute = Number(m[4] ?? 0), second = Number(m[5] ?? 0);
  if (year < 1 || day < 1 || day > 365 || hour > 23 || minute > 59 || second > 59) throw new FormError(`not a date: ${s}. A date is written like "${cal ? calendarWords(cal, now) : "year 1, day 12"}".`);
  return ((year - 1) * 365 + (day - 1)) * DAY + hour * 3_600 + minute * 60 + second;
}

const MARKS = ["=", "#", "?", "+"];
const NAME = /^[a-z_][a-z0-9_]{0,31}$/;
/** The field a template's string stands for, and how; undefined: the string is as written. */
function placeholder(t: unknown): { mark: string; name: string } | undefined {
  if (typeof t !== "string" || t.length < 2 || !MARKS.includes(t[0]!) || !NAME.test(t.slice(1))) return undefined;
  return { mark: t[0]!, name: t.slice(1) };
}

interface Env { fields: Filled; self: string; now: number }
const ABSENT = Symbol("absent");

function wholeNumber(name: string, v: FieldValue): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?[0-9]{1,16}$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n)) throw new FormError(`${name} can't be written as a whole number.`);
  return n;
}

function fill(t: unknown, env: Env): unknown {
  const p = placeholder(t);
  if (p) {
    if (p.mark === "=" && p.name === "self") return env.self;
    const v = env.fields[p.name];
    if (v === undefined) return ABSENT;
    if (p.mark === "=") return v;
    if (p.mark === "#") return wholeNumber(p.name, v);
    if (p.mark === "?") return v === "yes";
    return env.now + wholeNumber(p.name, v);
  }
  if (Array.isArray(t)) {
    const out: unknown[] = [];
    for (const x of t) {
      const v = fill(x, env);
      if (v === ABSENT) continue;
      // (A list given where one item stands is set out in its place.)
      if (Array.isArray(v) && placeholder(x)) out.push(...v);
      else out.push(v);
    }
    return out;
  }
  if (t && typeof t === "object") {
    const out: { [k: string]: unknown } = {};
    for (const [k, x] of Object.entries(t)) {
      const v = fill(x, env);
      if (v !== ABSENT) out[k] = v;
    }
    return out;
  }
  return t;
}

const unique = (xs: unknown[]): string[] => [...new Set(xs.filter((x): x is string => typeof x === "string"))];

/** A field in words, for a paper's text. `money`: an amount as the world writes its money. */
function words(v: FieldValue | undefined, type: string | undefined, money: (amount: string) => string): string {
  if (v === undefined) return "none";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (type === "amount" && typeof v === "string") return money(v);
  if (type === "duration" && typeof v === "number") return durationWords(v);
  if (type === "date" && typeof v === "number") return dateWords(v);
  return String(v);
}

/**
 * The paper a form writes from its fields, for `self`, at `now`. `fields`: each field given, as the form reads it
 * (`FieldValue`). `text`: the paper's own words, where whoever fills it in gives them in place of the form's.
 */
export function writePaper(spec: FormData, fields: Filled, o: { self: string; now: number; money: (amount: string) => string; text?: string }): Paper {
  const w = spec.writes;
  if (!w) throw new FormError("this form writes no paper of its own");
  const env: Env = { fields, self: o.self, now: o.now };
  const text = o.text ?? w.text.replace(/\{([a-z_][a-z0-9_]{0,31})\}/g, (_, name: string) => (name === "self" ? o.self : words(fields[name], spec.fields[name]?.type, o.money)));
  const data = w.data === undefined ? undefined : fill(w.data, env);
  const to = w.to === undefined ? [] : unique(fill(w.to, env) as unknown[]);
  const visible = w.visible === undefined ? undefined : w.visible === "public" ? "public" : unique(fill(w.visible, env) as unknown[]);
  const basis = w.basis === undefined ? ABSENT : fill(w.basis, env);
  const offer = w.offer === undefined ? undefined : fill(w.offer, env);
  const assertion = w.assertion === undefined ? undefined : fill(w.assertion, env);
  return {
    kind: w.kind, text,
    ...(to.length ? { addressed_to: to } : {}),
    ...(data !== undefined && data !== ABSENT ? { data } : {}),
    ...(visible !== undefined ? { visible_to: visible } : {}),
    ...(typeof basis === "string" ? { basis } : {}),
    ...(offer !== undefined && offer !== ABSENT ? { offer } : {}),
    ...(assertion !== undefined && assertion !== ABSENT ? { assertion } : {}),
  };
}

/** The fields a template names, each once, in the order met ("=self" aside). */
function named(t: unknown, into: string[] = []): string[] {
  const p = placeholder(t);
  if (p) { if (p.name !== "self" && !into.includes(p.name)) into.push(p.name); }
  else if (Array.isArray(t)) for (const x of t) named(x, into);
  else if (t && typeof t === "object") for (const x of Object.values(t)) named(x, into);
  return into;
}
/** The fields a form's claim is written from (none: the form records no claim). */
export function claimFields(spec: FormData): string[] {
  const c = spec.writes?.claim;
  return c ? named([c.holder, c.about, c.basis]) : [];
}
const CLAIM_WORD: { [position: string]: string } = { liberty: "permission", right: "right", power: "power", immunity: "immunity" };
/** Whether a form's claim is to be written for these fields: it has one, and its `when` holds. */
function claimDue(spec: FormData, fields: Filled): boolean {
  const c = spec.writes?.claim;
  return !!c && Object.entries(c.when ?? {}).every(([k, v]) => fields[k] === v);
}

/**
 * The claim a form records beside its paper, for these fields: undefined where the form records none, or its `when`
 * does not hold (a permit refused grants nothing). Where it is due, every field it is written from is needed, and one
 * not given is asked for: a decision that grants and does not say what is granted records no permission, which is
 * what a planning seat's permits did until 2026-10-11 (a park granted on the decision form was fined as unpermitted).
 */
export function writeClaim(spec: FormData, fields: Filled, o: { self: string; now: number }): WrittenClaim | undefined {
  const c = spec.writes?.claim;
  if (!c || !claimDue(spec, fields)) return undefined;
  const missing = claimFields(spec).filter((n) => fields[n] === undefined).sort();
  const when = Object.entries(c.when ?? {}).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" and ");
  if (missing.length) throw new FormError(`The ${spec.form.replace(/_/g, " ")}${when ? `, with ${when},` : ""} needs: ${missing.join(", ")}. They say what the ${CLAIM_WORD[c.position] ?? c.position} it records is.`);
  const env: Env = { fields, self: o.self, now: o.now };
  const holder = fill(c.holder, env);
  if (typeof holder !== "string") throw new FormError(`The ${spec.form.replace(/_/g, " ")} can't say who holds the ${CLAIM_WORD[c.position] ?? c.position} it records.`);
  const basis = c.basis === undefined ? ABSENT : fill(c.basis, env);
  return { position: c.position, holder, about: fill(c.about, env), ...(typeof basis === "string" ? { basis } : {}) };
}

/**
 * The fields a form's claim would have to be written from to be exactly this claim, added to those the paper gave
 * (`fields`); undefined if the form records no such claim for them. Checked by writing it again.
 */
export function claimFieldsFor(spec: FormData, claim: WrittenClaim, fields: Filled, o: { self: string; now: number }): Filled | undefined {
  const c = spec.writes?.claim;
  if (!c || c.position !== claim.position || !claimDue(spec, fields)) return undefined;
  const env: Filled = { ...fields };
  if (!unify(c.holder, claim.holder, env, spec, o.self, o.now) || !unify(c.about, claim.about, env, spec, o.self, o.now)) return undefined;
  if (c.basis !== undefined ? !unify(c.basis, claim.basis, env, spec, o.self, o.now) : claim.basis !== undefined) return undefined;
  try {
    const again = writeClaim(spec, env, o);
    return again && same(again, claim) ? env : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- a paper, back to the form that writes it

const same = (a: unknown, b: unknown): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as { [k: string]: unknown })[k])]));
  return v;
}

/** A value taken for a field, as the form reads that field; false: it can't be that field's. */
function bind(env: { [name: string]: FieldValue }, spec: FormData, p: { mark: string; name: string }, v: unknown, now: number): boolean {
  const type = spec.fields[p.name]?.type;
  if (type === undefined) return false;
  let got: FieldValue;
  if (p.mark === "?") {
    if (typeof v !== "boolean") return false;
    got = v ? "yes" : "no";
  } else if (p.mark === "+") {
    if (typeof v !== "number" || v <= now) return false;
    got = v - now;
  } else if (p.mark === "#") {
    if (typeof v !== "number" || !Number.isSafeInteger(v)) return false;
    got = type === "amount" || type === "choice" || type === "text" ? String(v) : v;
  } else if (type === "list") {
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return false;
    got = v as string[];
  } else if (type === "amount") {
    if (typeof v !== "string" || !/^[0-9]+$/.test(v)) return false;
    got = v;
  } else if (type === "duration" || type === "count" || type === "date") {
    if (typeof v !== "number") return false;
    got = v;
  } else {
    if (typeof v !== "string") return false;
    got = v;
  }
  if (p.name in env) return same(env[p.name], got);
  env[p.name] = got;
  return true;
}

/** Take a template against a value: the fields it would have been filled from. False: it could not have made it. */
function unify(t: unknown, v: unknown, env: { [name: string]: FieldValue }, spec: FormData, self: string, now: number): boolean {
  const p = placeholder(t);
  if (p) {
    if (p.mark === "=" && p.name === "self") return v === self;
    return v === undefined ? true : bind(env, spec, p, v, now);
  }
  if (v === undefined) return false;
  if (Array.isArray(t)) {
    if (!Array.isArray(v)) return false;
    // Items one for one, but for a list's place, which takes as many as the items after it leave (the fewest that
    // lets the rest be taken: the first list named takes what is its own, and a later one the remainder). An item
    // whose field was not given is not there: tried present, then absent.
    const isList = (x: unknown) => { const q = placeholder(x); return !!q && q.mark === "=" && spec.fields[q.name]?.type === "list"; };
    const walk = (ti: number, vi: number, e: { [name: string]: FieldValue }): { [name: string]: FieldValue } | undefined => {
      if (ti === t.length) return vi === v.length ? e : undefined;
      if (isList(t[ti])) {
        const q = placeholder(t[ti])!;
        // (A list already taken elsewhere in the paper is that list here.)
        const known = e[q.name];
        const sizes = Array.isArray(known) ? [known.length] : Array.from({ length: v.length - vi + 1 }, (_, n) => n);
        for (const take of sizes) {
          if (vi + take > v.length) continue;
          const e2 = { ...e };
          if (take > 0 && !bind(e2, spec, q, v.slice(vi, vi + take), now)) continue;
          const done = walk(ti + 1, vi + take, e2);
          if (done) return done;
        }
        return undefined;
      }
      if (vi < v.length) {
        const e2 = { ...e };
        if (unify(t[ti], v[vi], e2, spec, self, now)) {
          const done = walk(ti + 1, vi + 1, e2);
          if (done) return done;
        }
      }
      // (A field not given leaves its place out.)
      const q = placeholder(t[ti]);
      return q && !(q.mark === "=" && q.name === "self") && !(q.name in e) ? walk(ti + 1, vi, e) : undefined;
    };
    const done = walk(0, 0, env);
    if (!done) return false;
    Object.assign(env, done);
    return true;
  }
  if (t && typeof t === "object") {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const tv = t as { [k: string]: unknown }, vv = v as { [k: string]: unknown };
    for (const k of Object.keys(vv)) if (!(k in tv)) return false;
    for (const [k, x] of Object.entries(tv)) if (!unify(x, vv[k], env, spec, self, now)) return false;
    return true;
  }
  return same(t, v);
}

/**
 * The fields a form would have to be given to write exactly this paper, or undefined if it could not have written
 * it. Checked by writing it again: what comes back is the paper, to the letter (its words given as they stand where
 * the form's own would differ: `text` in the answer).
 */
export function fieldsFor(spec: FormData, paper: Paper, o: { self: string; now: number; money: (amount: string) => string }): { fields: Filled; text?: string } | undefined {
  const w = spec.writes;
  if (!w || w.kind !== paper.kind) return undefined;
  const env: Filled = {};
  const part = (t: unknown, v: unknown) => (t === undefined ? v === undefined : unify(t, v, env, spec, o.self, o.now));
  if (!part(w.data, paper.data) || !part(w.offer, paper.offer) || !part(w.assertion, paper.assertion)) return undefined;
  if (w.to !== undefined ? !unify(w.to, paper.addressed_to ?? [], env, spec, o.self, o.now) : (paper.addressed_to ?? []).length > 0) return undefined;
  if (w.visible === "public" ? paper.visible_to !== "public" : w.visible !== undefined ? !Array.isArray(paper.visible_to) || !unify(w.visible, paper.visible_to, env, spec, o.self, o.now) : paper.visible_to !== undefined) return undefined;
  if (w.basis !== undefined ? !unify(w.basis, paper.basis, env, spec, o.self, o.now) : paper.basis !== undefined) return undefined;
  for (const [name, f] of Object.entries(spec.fields)) if (f.required && !(name in env)) return undefined;
  let again: Paper;
  try {
    again = writePaper(spec, env, o);
  } catch {
    return undefined;
  }
  const text = again.text === paper.text ? undefined : paper.text;
  if (text !== undefined && "text" in spec.fields) return undefined;
  return same({ ...again, text: paper.text }, paper) ? { fields: env, ...(text !== undefined ? { text } : {}) } : undefined;
}
