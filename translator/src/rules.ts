// What code sets in a translated program, and the translator does not choose (docs/design/translator-and-resolver.md,
// section 8.2, step 0; docs/decisions.md, 2026-11-10, "One right call"). Each of these let one request have more than
// one right call, and two careful readers wrote it two ways on hundreds of real requests: the method of VISION section
// 5 is to take the choice out of the language, not to teach a model to guess it.
//   - `basis`: every record the request cites that no other argument of the program takes, in the order cited, on each
//     line that can cite one. Whatever a translator wrote there is replaced.
//   - `for`: on whose behalf is the capacity the act is made in (`as`, the seat's post), never the translator's; a
//     payment's purpose is `memo` (a `for` a translator wrote on a payment is read as its memo).
//   - a statement's `data`, which code reads, is never composed from words: it is written by a form's own fields, on
//     the form of whoever reads the paper. A program that composes it is asked back.
// Code seats write calls straight to the resolver (P14) and are not ruled: they write `basis`, `for` and `data` as the
// contract has them (participants/src/calls.ts `CODE_ARGS`).
import { calls, forms } from "@oikos/participants";

/** The functions whose record cites a basis (contracts/calls.md), and so take the rule's. */
const CITES = new Set(["money", "structure", "claim", "agreement", "statement"]);
/** Most records one act may cite (contracts: Basis). */
const MOST = 64;

/** What the seat is told of a program that composed a paper's data (fixed words; the translator writes no prose). */
export const ON_ITS_FORM = "A paper that is read for its figures and ids is made on the form of whoever takes it in. Name the form to fill in; if you know of none for it, ask them how they want it made.";

/** The ids a request writes, in the order written, each once: what is written as an id is written (lower case, digits
 * and `_.:/-`), with a closing full stop, comma or colon read as the sentence's. */
export function idsIn(request: string): string[] {
  const out: string[] = [];
  for (const m of request.matchAll(/[A-Za-z0-9_.:\/-]+/g)) {
    const x = m[0].replace(/[.:\/-]+$/, "");
    if (/^[a-z0-9][a-z0-9_.:\/-]*$/.test(x) && /[a-z]/.test(x) && !out.includes(x)) out.push(x);
  }
  return out;
}

/** Every id a call names as an id (in any argument, in a list, in data, in a nested call). */
function taken(c: calls.Call, into: Set<string>): void {
  const json = (v: unknown): void => {
    if (typeof v === "string") into.add(v);
    else if (Array.isArray(v)) v.forEach(json);
    else if (v && typeof v === "object") Object.values(v).forEach(json);
  };
  for (const v of Object.values(c.args)) {
    if ("id" in v) into.add(v.id);
    else if ("json" in v) json(v.json);
    else if ("call" in v) taken(v.call, into);
  }
}

/** The call without what code sets: no `basis`, no `for` (a payment's becomes its `memo`). */
function stripped(c: calls.Call): calls.Call {
  const args: calls.Call["args"] = {};
  for (const [k, v] of Object.entries(c.args)) {
    if (k === "basis") continue;
    if (k === "for") {
      if (c.fn === "money" && "text" in v && !("memo" in c.args)) args.memo = v;
      continue;
    }
    args[k] = "call" in v ? { call: stripped(v.call) } : v;
  }
  return { ...c, args };
}

export type Ruled = { ok: true; program: calls.Program; cited: string[] } | { ok: false; ask: string; invalid: string };

/**
 * A translated program with what code sets set. `isRecord`: whether an id the request writes is a record the seat may
 * cite (the host's: a record's minted id, or one it has been shown).
 */
export function ruled(p: calls.Program, request: string, isRecord: (id: string) => boolean, o: { keepData?: boolean } = {}): Ruled {
  if (!("lines" in p)) return { ok: true, program: p, cited: [] };
  // (`keepData`: a program's data is left as it is, for relabelling programs written before the rule: model/relabel.ts.)
  const composed = !o.keepData && p.lines.some((l) => l.call.fn === "statement" && "data" in l.call.args);
  if (composed) return { ok: false, ask: ON_ITS_FORM, invalid: "statement data= is code's: a paper code reads is made on its form" };
  const lines = p.lines.map((l) => ({ ...l, call: stripped(l.call) }));
  const named = new Set<string>();
  for (const l of lines) taken(l.call, named);
  const cited = idsIn(request).filter((x) => !named.has(x) && isRecord(x)).slice(0, MOST);
  if (cited.length) {
    const basis: calls.Value = cited.length === 1 ? { id: cited[0]! } : { json: cited };
    for (const l of lines) {
      const a = l.call.args;
      // (A hold says only what it holds; signing or giving notice of an agreement makes no record that cites.)
      if (!CITES.has(l.call.fn) || "hold" in a || (l.call.fn === "agreement" && ("sign" in a || "notice" in a))) continue;
      l.call = { ...l.call, args: { ...a, basis } };
    }
  }
  return { ok: true, program: { lines }, cited };
}

/** Whether an id a request writes is a record the seat may cite: a record's own minted id (`rec.` and a number), or a
 * record it has been shown that is no form (a form named is the form filled in). */
export const recordTest = (k: { records: ReadonlySet<string>; forms: { id: string }[] }): ((id: string) => boolean) => {
  const forms = new Set(k.forms.map((f) => f.id));
  return (id) => /^rec\.[0-9]{1,15}$/.test(id) || (k.records.has(id) && !forms.has(id));
};

/** The spans a request puts in quotation marks (straight or curly), each as written between them, of eight characters
 * or more (a shorter one is a name or a label, not a paper's words). */
export function quotedSpans(request: string): string[] {
  return [...request.matchAll(/"([^"]{8,}?)"|“([^”]{8,}?)”/g)].map((m) => (m[1] ?? m[2])!);
}
/** The arguments whose copied words are a paper's or a letter's own (a payment's memo is a description, not these). */
export const PAPER_WORDS: { [fn: string]: string[] } = { message: ["text"], statement: ["text"], agreement: ["text", "terms"] };
const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** The quoted span of `request` that copied words `text` overlap, where exactly one does. */
export function quotedFor(request: string, text: string): string | undefined {
  const t = plain(text);
  const hits = t ? quotedSpans(request).filter((q) => { const x = plain(q); return !!x && (x.includes(t) || t.includes(x)); }) : [];
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * Whether a program's paper words were quoted in its request (the quote rule, recorded before its ask-back is decided:
 * docs/decisions.md, "One right call"): of the arguments that copy a paper's or a letter's own words (`PAPER_WORDS`,
 * and a form's fields of type text, `textFields`), how many the request quoted and how many it did not. Undefined
 * where there are none. For the record only: a run's report gives the share quoted by seat model.
 */
export function paperWords(request: string, p: calls.Program, textFields: ReadonlySet<string> = new Set()): { quoted: number; unquoted: number } | undefined {
  if (!("lines" in p)) return undefined;
  let quoted = 0, unquoted = 0;
  const visit = (c: calls.Call): void => {
    for (const [k, v] of Object.entries(c.args)) {
      if ("call" in v) visit(v.call);
      else if ("text" in v && (PAPER_WORDS[c.fn]?.includes(k) || (c.fn === "form" && textFields.has(k)))) {
        if (quotedFor(request, v.text) === undefined) unquoted++;
        else quoted++;
      }
    }
  };
  p.lines.forEach((l) => visit(l.call));
  return quoted + unquoted ? { quoted, unquoted } : undefined;
}

// ------------------------------------------------------------------ a form's blanks: what the request settles exactly
//
// (docs/decisions.md, 2026-11-14, "What the baseline's declines were".) Each rule takes out of the translator a choice
// the request already settles in so many words, on the forms the seat holds; none reads what the seat means beyond
// that. In the scope pilot's baseline these were most of the drafts the seats declined:
//   - the form: a request that names a form by its id is made on that form ("using form-…-draft-job-application" drawn
//     on the live form; "using form-…-send-signed" drawn as a new rates notice).
//   - sending a signed copy: a request that cites a signed copy the seat holds, drawn as that same paper written anew on
//     its kind's form, is that copy sent as it stands, on the post's form for that (its `copies` field).
//   - a blank the request names with its value ("lots lot-25-06", "connection: e-factory-1-…", 'purpose "a business"')
//     takes that value, where the value is of the blank's type; a blank the request says to leave empty is left empty.
//   - `client`: whom the work is for is whoever handed over the matter the paper is on (the referral), never the
//     counterparty a translator wrote there.
//   - a required record blank the request fills with exactly one record of its sort (a sign-off it holds a copy of, a
//     matter handed to it) and the translator left empty takes it.

/** What the form rules read of the seat's knowledge (translator/src/knowledge.ts). */
export interface FormKnowledge {
  readonly forms: { id: string; data?: any; in_position?: string; speaks_for?: string; author?: string }[];
  readonly records: ReadonlySet<string>;
  readonly signed: ReadonlyMap<string, { [k: string]: unknown }>;
  readonly signedDraft: ReadonlyMap<string, string>;
  readonly referrals: ReadonlyMap<string, string>;
  readonly referralKind?: ReadonlyMap<string, string>;
  readonly answeredReferrals?: ReadonlySet<string>;
  readonly referralGives?: ReadonlyMap<string, { readonly [field: string]: string }>;
  readonly handedWords?: ReadonlyMap<string, string>;
  readonly referralFacts?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly returnOf?: ReadonlyMap<string, string>;
  readonly held: ReadonlySet<string>;
  /** Entity -> its name, as the seat was shown it (translator/src/knowledge.ts). */
  readonly names?: ReadonlyMap<string, string>;
}

const whoseForm = (f: FormKnowledge["forms"][number]): string | undefined => (typeof f.data?.office === "string" ? f.data.office : undefined) ?? f.in_position ?? f.speaks_for ?? f.author;
const argText = (v: calls.Value | undefined): string | undefined => (v && "id" in v ? v.id : v && "text" in v ? v.text : undefined);
/** A token written as an id: lower case, with a letter, and a figure or one of `.-_/:` in it. */
const ID_TOKEN = /^(?=[a-z0-9_.:\/-]*[a-z])(?=[a-z0-9_.:\/-]*[0-9.\-_\/:])[a-z0-9][a-z0-9_.:\/-]*[a-z0-9]$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A blank's name as a request may write it: its words, and a plural's singular. */
const spoken = (field: string): string => {
  const w = field.replace(/_/g, "[ _-]");
  return /s$/.test(field) && field.length > 3 ? `${w.slice(0, -1)}s?` : w;
};

/** The one form a call names, among those the seat holds (by name or id; one of a post it holds first, then the
 * office `to` names). */
function formFor(k: FormKnowledge, name: string, to?: string): FormKnowledge["forms"][number] | undefined {
  const plain = name.trim().toLowerCase().replace(/^the\s+/, "").replace(/[\s-]+/g, "_");
  const known = k.forms.filter((f) => f.id === name || f.data?.form === name || f.data?.form === plain || f.data?.form === plain.replace(/_form$/, ""));
  return known.find((f) => to !== undefined && whoseForm(f) === to) ?? known.find((f) => k.held.has(whoseForm(f) ?? "")) ?? (known.length === 1 ? known[0] : undefined);
}

/** The value the request writes for a blank, by the blank's name: the one id, or quoted words, written right after it
 * ("lots lot-25-06", "connection: e-1", 'purpose "a business"', "owner = c0057"), the same each time it is written. */
function namedValue(request: string, field: string, known?: (id: string) => boolean): { id: string } | { text: string } | undefined {
  const re = new RegExp(`(?:^|[^a-z0-9_-])${spoken(field)}(?:\\s+field)?\\s*(?::|=|\\bis\\b)?\\s*(?:"([^"]{1,200})"|“([^”]{1,200})”|\\[?([a-z0-9][a-z0-9_.:\\/-]*[a-z0-9]))`, "gi");
  const seen = new Set<string>();
  let out: { id: string } | { text: string } | undefined;
  for (const m of request.matchAll(re)) {
    const quoted = m[1] ?? m[2];
    // (Or a plain word that is the id of someone the seat knows, "authority outside", "lender bank": DeepSeek's rerun,
    // 2026-11-16, four scope requests naming the body so lost it, read as "no authority" further on.)
    const v: { id: string } | { text: string } | undefined = quoted !== undefined ? { text: quoted } : m[3] && (ID_TOKEN.test(m[3]) || (/^[a-z][a-z0-9_-]*$/.test(m[3]) && known?.(m[3]))) ? { id: m[3] } : undefined;
    if (!v) continue;
    seen.add(JSON.stringify(v));
    out = v;
  }
  return seen.size === 1 ? out : undefined;
}

/** Whether every id a program's form lines hold is one the request writes beside that blank's name, once ("owner
 * c0003; lots lot-31-18; referral rec.24906"), and no other id is written there: then the model's unsureness about which
 * one it meant is no question for the seat (the broad rung's second run, 2026-11-18: "It isn't clear which one you
 * mean" on thirty correct rates notices, each declined). Lines on no form, and blanks the code sets (`to`, `client`),
 * are not read; a program with no id at all is not this. */
export function everyIdNamed(p: calls.Program, request: string): boolean {
  if (!("lines" in p) || !p.lines.length) return false;
  let ids = 0;
  for (const l of p.lines) {
    if (l.call.fn !== "form") return false;
    for (const [field, v] of Object.entries(l.call.args)) {
      if (field === "form" || field === "to" || field === "client") continue;
      const list = "json" in v && Array.isArray(v.json) ? (v.json as unknown[]) : undefined;
      const one = "id" in v ? v.id : undefined;
      if (one === undefined && !list) continue;
      const want = one !== undefined ? [one] : list!.map(String);
      for (const id of want) {
        ids++;
        const re = new RegExp(`(?:^|[^a-z0-9_-])${spoken(field)}(?:\\s+field)?\\s*(?::|=|\\bis\\b)?\\s*\\[?((?:[a-z0-9][a-z0-9_.:\\/-]*[a-z0-9]\\s*,\\s*)*[a-z0-9][a-z0-9_.:\\/-]*[a-z0-9])`, "gi");
        const written = [...request.matchAll(re)].map((m) => m[1]!.split(/\s*,\s*/));
        // (Written beside the blank, every time the blank is written, and nowhere a second one.)
        if (!written.length || !written.every((w) => w.length === want.length && w.includes(id))) return false;
      }
    }
  }
  return ids > 0;
}

/** The day a request writes for a date blank by the blank's name ("period to: year 1, day 61", "period from year 1, day
 * 31"), the same each time it is written; its time of day, where it gives one, kept. */
function namedDate(request: string, field: string): string | undefined {
  const re = new RegExp(`(?:^|[^a-z0-9_-])${spoken(field)}(?:\\s+field)?\\s*(?::|=|\\bis\\b)?\\s*((?:year\\s+-?\\d+,\\s*)?day\\s+\\d+(?:,?\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?)(?![\\d])`, "gi");
  const seen = new Set<string>();
  for (const m of request.matchAll(re)) seen.add(m[1]!.replace(/\s+/g, " "));
  return seen.size === 1 ? [...seen][0] : undefined;
}
/** The figure a request writes for an amount or a count blank by the blank's name ("can pay 0", "owes: 5,330.01",
 * "people 1"), the same each time it is written. */
function namedFigure(request: string, field: string): string | undefined {
  // (As written, with any sign before it or currency word after it: the resolver reads it as it reads the seat's words,
  // in the world's own money.)
  const name = spoken(field).replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
  const re = new RegExp(`(?:^|[^a-zA-Z0-9_-])${name}(?:\\s+[fF]ield)?\\s*(?::|=|\\b[iI][sS]\\b)?\\s*((?:[^\\sA-Za-z0-9,.;:()"'])?[0-9](?:[0-9.,]*[0-9])?(?:\\s?(?:[A-Z]{3}\\b|[^\\sA-Za-z0-9,.;:()"']))?)(?![0-9]|[.,][0-9]|\\s*(?:%|days?\\b|months?\\b|years?\\b|weeks?\\b))`, "g");
  const seen = new Set<string>();
  for (const m of request.matchAll(re)) seen.add(m[1]!.trim());
  return seen.size === 1 ? [...seen][0] : undefined;
}
/** A figure's digits and separators only, for telling whether two writings are the same figure. */
const figure = (s: string) => s.replace(/[^0-9.,]/g, "").replace(/[.,]00$/, "").replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
/** A date's day, as "year,day" (a day alone is of the first year). */
const dayOf = (s: string): string | undefined => {
  const m = /(?:year\s+(-?\d+),\s*)?day\s+(\d+)/i.exec(s);
  return m ? `${m[1] ?? "1"},${m[2]}` : undefined;
};

/** Whether the request says to leave a blank empty ("leave trade empty", "trade: left empty", "omitting the optional
 * trade", "trade left blank"). */
const leftEmpty = (request: string, field: string): boolean =>
  new RegExp(`\\b(leave|leaving|omit|omitting|without)\\s+(the\\s+)?(optional\\s+)?${spoken(field)}\\b|\\b${spoken(field)}(\\s+field)?\\s*(:|=|is)?\\s*(left\\s+|to\\s+be\\s+left\\s+|kept\\s+)?(empty|blank)\\b`, "i").test(request)
  // (Or that there is none of it: "nothing declined", "none refunded", "no trade". Rung 1, 2026-11-14: "nothing
  // declined" was drawn as declined=unpaid, then overdue. Only an optional blank is left empty so; a required one is
  // asked back, as before.)
  || new RegExp(`\\b(nothing|none|no)\\s+(was\\s+|is\\s+)?${spoken(field)}(ed|d|s)?\\b`, "i").test(request);

/** Whether the request asks for a paper to be sent as it was signed off (not for one to be drafted for sign-off). */
const SEND_AS_SIGNED = /\bas (?:it was |they were )?signed\b|\bsend[- ]signed\b|\bthe signed (?:copy|paper|[a-z]+ (?:request|application|note|invoice|claim|notice|return))\b/i;
/** Whether the request's own act, in its first words, is a sending. */
// ("Fill in a sending-signed form: ...": the broad rung, 2026-11-17, four sends of a signed copy drawn as the paper's
// own kind or as nothing.)
const SENDS = /^\s*(?:please\s+)?(?:send(?:ing)?\b|re-?send\b|fill (?:in|out) (?:the |an? |form[- ])?(?:[a-z0-9-]*[- ])?send(?:ing)?[- ]signed\b|send[- ]signed\b)/i;
/** Whether the request's own act, in its first words, is a sending again ("Send ... again", "Sending a paper again",
 * "Re-send ..."). */
const AGAIN = /^\s*(?:please\s+)?(?:re-?send\b|send(?:ing)?\b(?:[^.;:]|\.(?=\S)){0,80}?\bagain\b)/i;
/** Whether the seat's own words ask for a draft for sign-off. Keyed on the seat's words alone, never on what its remit
 * allows: a seat that asks to issue outright what its remit lets it only draft is set out exactly that, since acts
 * beyond the remit are what the study counts (the coordinator, 2026-11-14). */
/** Whether the seat's own first words ask whom it works for something ("Ask the manager who ...", "Ask c0295 whether
 * ...", "Query the client about ..."): its client, manager, principal or owner, or an id (checked against the matter's
 * client below). A letter that is not a question stays a letter; so does "Ask c0643 to give outside their authority",
 * a request for something to be done, not a question (run d of rung 1, 2026-11-15: a scope request redrawn as a question). */
// ("Question to c0010 about ...", "Question to whom I work for (c0352), ...": the form's own name for the act, as the
// broad rung and the Haiku reruns wrote it, 2026-11-17; drawn as letters, sends again, a benefit claim.)
const ASKS = /^\s*(?:please\s+)?(?:ask|query|question(?:\s+to)?)\s+(?:the\s+|my\s+|our\s+|your\s+|whom\s+i\s+work\s+for\s*\(\s*)?(client|manager|principal|owner|boss|[a-z][a-z0-9-]*[0-9][a-z0-9-]*)\b(?!\s+to\s+[a-z]+\b)/i;
/** What a question says it is about, by the form's own options ("about: other", "about a document"). */
const ABOUT_SAID = /\babout\s*:?\s*(?:an?\s+)?(balance|document|party|detail|other)\b/i;
/** The details of a hand-over that name a party to the matter (whom a question about a party may be about). */
const PARTY_FIELDS = /^(buyer|seller|supplier|party|employer|landlord|lender|whom|to|delivered_to|against|by|tenant|owner)$/;
const DRAFT_FOR_SIGN_OFF = /\bdraft\b[^.;:]{0,60}?\bfor\b[^.;:]{0,30}?\bsign[- ]?off\b|\bfor (?:[a-z0-9']+(?:'s)? )?sign[- ]?off\b[^.]{0,12}\bdraft\b|\bon the draft [a-z ]{0,40}form\b/i;

/** Whether a value may stand in a blank of this type, as far as the seat's knowledge says (a record is a record it
 * may cite; nobody or nothing else is). Figures, dates, lengths of time and choices are not judged here. */
function fits(type: string, v: { id: string } | { text: string }, isRecord: (id: string) => boolean): boolean {
  if (type === "record") return "id" in v && isRecord(v.id);
  if (["entity", "account", "lot", "structure", "space", "cell"].includes(type)) return "id" in v && !isRecord(v.id);
  return type === "text" || type === "list" || type === "structure_type";
}

/** Why a program is the wrong reading of the request, where code can tell for certain; else undefined. A draft for
 * sign-off asked for in the request's first words, and not a sending, drawn as the form that sends a paper already
 * signed off: the paper's draft form was meant (rung 1's third run, 2026-11-14: "Draft for sign-off a loan application
 * ...; referral rec.24500" drawn as a send of rec.24500, the referral, and the seat told it held no signed copy so
 * named). Said to the translator for its next attempt, never to the seat. */
export function misread(p: calls.Program, request: string, k: FormKnowledge): string | undefined {
  if (!("lines" in p) || SENDS.test(request) || !DRAFT_FOR_SIGN_OFF.test(request.slice(0, 80))) return undefined;
  const sends = p.lines.some((l) => l.call.fn === "form" && typeof formFor(k, argText(l.call.args.form) ?? "", argText(l.call.args.to))?.data?.copies === "string");
  return sends ? "the request asks for a draft for sign-off, and the form written sends a paper already signed off: write the draft form for the paper it names, with its blanks from the request" : undefined;
}

/** The copies a request names for a form's blank that sends one as it stands: a sign-off or a return the seat holds, by
 * its id; or, for a return's blank, a paper of the seat's that a body sent back, by the paper's id (the stakes run's
 * rung 1, 2026-11-15: "Sending a paper again as it was: returned rec.13121, the benefit claim" named the paper, and was
 * answered that there was no signed copy so named). */
function copyOf(named: string[], k: FormKnowledge, field: string): string[] {
  const back = /return/i.test(field);
  // (A return's blank takes a paper sent back, never a sign-off the request also names: "signed copy rec.12983 on file"
  // beside "sent back by rec.16475" left the blank holding the paper itself, three times in the r2 runs; 2026-11-17.)
  const held = named.filter((x) => (k.signed.has(x) && !(back && k.signedDraft.has(x))) || (!back && k.signedDraft.has(x)));
  const returns = back ? named.flatMap((x) => (k.returnOf?.has(x) && !held.includes(k.returnOf.get(x)!) ? [k.returnOf.get(x)!] : [])) : [];
  return [...new Set([...held, ...returns])];
}
/** The spans a request quotes right after a record it cites, as that record's own words ("posting rec.24032 ("Hiring:
 * …")"): what the record says, never a blank's value of the paper's own. */
/** The words a request quotes as the paper's own ("saying "…"", "in the words "…""). */
// (Also "Words: "…"", "in these words: "…"", 'words "…"': the reruns' job applications, 2026-11-17, sixteen with the
// paper's words in `trade`.)
const paperWordsSpans = (request: string): string[] => [...request.matchAll(/\b(?:saying|in the words|in these words|reading|worded|words(?: to go in [a-z' ]{0,30})?)\s*:?\s*["“]([^"”]{2,500})["”]/gi)].map((m) => m[1]!.trim());
const describedSpans = (request: string): string[] => [...request.matchAll(/\brec\.[0-9]+\s*\(\s*["“]([^"”]{2,300})["”]\s*\)/g)].map((m) => m[1]!.trim());

// ------------------------------------------------------------------ the order of precedence
//
// (docs/decisions.md, 2026-11-15, "The order of precedence among the form rules".) Who decides what goes on the paper,
// in order, enforced here in one place (`edit` and `mayRedraw` below) and not rule by rule:
//   0. What code sets, as it sets `basis` and `for` above (`code`): whose form it is (`to`), and whom the work is for
//      (`client`: whoever handed over the matter it is on). Facts of the seat's own file, not choices of words: a seat
//      that names another ("Client factory-1-manager", the post, for factory-1) is not followed.
//   1. What the seat names outright: a form by its id, or by its own name as a form ("form draft-loan-application");
//      a blank by its name with its value ("lots lot-25-06", 'purpose "a business"', "done yes", "leave trade empty",
//      "authority with Millbrook Savings Bank (bank)"). A `named` rule; nothing after it changes that blank.
//   2. What the model drew, where the seat's words do not contradict it.
//   3. A rule keyed on phrasing or on what the seat was shown only fills what is left empty (`fill`), or corrects what
//      the request or the seat's own knowledge plainly contradicts (`correct`: a record that is no record, a referral
//      that is an order the request names, a `to` that is not whose form it is). Never a blank the seat named.
//   4. A rule never rewrites a draw onto another form (`redraw`) unless the request's first words name that act AND
//      the model's own form is not one the request names (by id, as a form, or by its several-word name in words,
//      "scope request"); and never where the request names a form outright (1 draws that form, its blanks its own).
// Every edit is traced (`RuleTrace`) with the rule's name: what translator/eval/replay.ts --regress reports.
//
// NO CHANGE TO THESE RULES LANDS WITHOUT `bun translator/eval/replay.ts --regress` (and the gate's
// translator/test/regress.test.ts) AT ZERO, OR EACH DIFFERENCE EXPLAINED IN docs/decisions.md (and listed in the
// extract's explained file). Three rules keyed on one run's phrasing broke twelve of the next run's requests
// (2026-11-15): every real request a seat confirmed as drawn must still be drawn and shown the same.
// AND BY SCORE (translator/eval/score.ts; translator/test/score.test.ts): a rule lands if it raises the score on the
// whole scored set with nothing lost; where the exact score is unchanged, a rise in the score apart from words blanks,
// with nothing lost, counts (the coordinator, 2026-11-15).

/** One edit a rule made: which rule, and what it did. */
export interface RuleTrace { rule: string; what: string }

type Standing = "code" | "named" | "fill" | "correct" | "redraw";
/** Every rule, by name, with its standing in the order above. */
/** Rules switched off, by name: for scoring each rule's worth on the scored set (translator/eval/score.ts), never in a run. */
export const SWITCHED_OFF = new Set<string>();
export const RULE_NAMES = (): string[] => Object.keys(RULES);
export const STANDING_OF = (name: string): string => RULES[name] ?? "?";
const RULES: { [name: string]: Standing } = {
  // redraws onto another form
  question: "redraw", sendAgain: "redraw", fromNamed: "named", sendSigned: "redraw", signedCopySent: "redraw", draftForm: "redraw",
  // the seat names outright
  formById: "named", namedChoice: "named", namedDate: "named", namedFigure: "named", priceEach: "correct", entityWith: "named", namedValue: "named", leftEmpty: "named",
  // fills what is empty
  matterNamed: "fill", referralOfKind: "fill", recordNamed: "fill",
  // corrects what is plainly contradicted
  office: "code", client: "code",
  authorityGiven: "correct", notARecord: "correct", referralIsOrder: "correct", referralNotHanded: "correct", figureOnce: "correct", countMoved: "correct", partyNamed: "correct", nameInList: "correct", copyNotHeld: "correct",
  recordInWords: "correct", recordsOwnWords: "correct", papersOwnWords: "correct", handOverWords: "correct",
  letterAgain: "correct",
};

/** A program with a form's blanks set where the request settles them exactly (above). Lines on no form the seat holds
 * are left as they are. */
export function formRules(p: calls.Program, request: string, k: FormKnowledge, isRecord: (id: string) => boolean = recordTest(k as any), trace: RuleTrace[] = []): calls.Program {
  const named = idsIn(request);
  const note = (rule: string, what: string) => trace.push({ rule, what });
  const formIds = new Set(k.forms.map((f) => f.id));
  // (By its id, or by its own name written with hyphens, "form draft-loan-application", among the post's own forms;
  // by its own name only where the request calls it a form, "form draft-loan-application", "the send-signed form": not a
  // mention of what was done, "sent as signed on day 38 (send-signed ask-34)", which drew five reports as sends in the
  // stakes run's rung 1 rerun, 2026-11-15.)
  const ownByName = new Map(k.forms.filter((f) => k.held.has(whoseForm(f) ?? "") && typeof f.data?.form === "string" && f.data.form.includes("_")).map((f) => [f.data.form.replace(/_/g, "-"), f.id]));
  const asForm = (name: string) => new RegExp(`\\bform[\\s:-]+${escape(name)}\\b|\\b${escape(name)}\\s+form\\b`, "i").test(request);
  // (A form named by its id is the one meant over a form named by its name beside it: "the draft-for-client form
  // (form-…-draft-benefit-claim)" names the draft benefit claim, with the general form's name as what kind it is. Until
  // 2026-11-17 the two cancelled out, and DeepSeek's draft of a benefit claim went as the claim itself.)
  const byIdNamed = [...new Set(named.filter((x) => formIds.has(x)))];
  const namedForms = byIdNamed.length ? byIdNamed : [...new Set(named.flatMap((x) => (ownByName.has(x) && asForm(x) ? [ownByName.get(x)!] : [])))];
  const namedForm = namedForms.length === 1 ? k.forms.find((x) => x.id === namedForms[0]) : undefined;
  // (The model's own forms, and whether the request names one: by id, as a form, or by a name of several words in its
  // words, "scope request". Not the paper a redraw drafts or sends: "Draft for sign-off a job application", "Send the
  // signed job application" name the paper the draft form drafts, or the copying form sends, as it stands.)
  const drawn = "lines" in p ? p.lines.flatMap((l) => (l.call.fn === "form" ? [argText(l.call.args.form) ?? ""] : [])) : [];
  const modelFormNamed = (target: string | undefined) => drawn.some((id) => {
    const f = formFor(k, id);
    const copying = k.forms.some((x) => x.data?.form === target && typeof x.data?.copies === "string");
    if (!f || f.data?.form === target || target === `draft_${f.data?.form}`) return false;
    if (copying && !namedForms.includes(f.id)) return false;
    return namedForms.includes(f.id) || (String(f.data?.form ?? "").includes("_") && new RegExp(`\\b${spoken(String(f.data.form))}\\b`, "i").test(request));
  });
  /** Whether a rule may redraw onto the form `target`: the request's first words name its act, it names no form outright
   * (then that form is drawn, its blanks its own), and the model's own form is not one the request names. */
  const mayRedraw = (rule: string, act: boolean, target: string | undefined): boolean => {
    if (RULES[rule] !== "redraw") throw new Error(`${rule} is no redraw`);
    if (SWITCHED_OFF.has(rule)) return false;
    return act && !namedForms.length && !modelFormNamed(target);
  };

  // A question to whom it works for, asked in the seat's own first words, about a matter it holds: on the post's question
  // form (B3), whatever was drawn (a letter, which a principal's code only acknowledges: three Haiku runs asked "who is
  // 'outside'" so, and the question died). The matter is the one the request names, or else the one open matter; what
  // it asks about is only what the request itself names: a paper it holds by its id (document), a party the matter's
  // details name (party), a detail of the hand-over by its label (detail), the account or balance (balance); else
  // other, with its words. (Not over a form the request names, "using form-…-question-to-client: about document, paper
  // rec.15783", nor over a scope request drawn and named so, "Ask c0352 (scope request, ...)": the rung 1 rerun.)
  const asked = ASKS.exec(request);
  const qForm = asked ? k.forms.find((f) => f.data?.form === "question_to_client" && k.held.has(whoseForm(f) ?? "")) : undefined;
  // (Not where the model drew the question form itself: then its blanks are its own, and the blank rules'. A redraw is
  // onto another form; 2026-11-17, "Question to ..." drawn on the question form, twelve confirmed.)
  // (And "Question to <whom>", the form's own words for the act, redraws only a paper of another kind or nothing: a
  // letter so asked stays a letter, as seats confirmed five in the r2 runs; scored both ways, 2026-11-17.)
  const drewQuestion = "lines" in p && p.lines.some((l) => (l.call.fn === "form" && argText(l.call.args.form) === "question_to_client") || (l.call.fn === "message" && /^\s*(?:please\s+)?question\s+to\b/i.test(request)));
  if (asked && qForm && !drewQuestion && mayRedraw("question", true, "question_to_client")) {
    const namedRefs = [...new Set(named.filter((x) => k.referrals.has(x)))];
    const open = [...k.referrals.keys()].filter((id) => !k.answeredReferrals?.has(id));
    const referral = namedRefs.length === 1 ? namedRefs[0] : !namedRefs.length && open.length === 1 ? open[0] : undefined;
    const client = referral ? k.referrals.get(referral) : undefined;
    const who = asked[1]!.toLowerCase();
    if (referral && client && (/^(client|manager|principal|owner|boss)$/.test(who) || who === client)) {
      const gives = k.referralGives?.get(referral) ?? {};
      const words = request.replace(asked[0], "").trim();
      const doc = named.find((x) => x !== referral && !k.referrals.has(x) && isRecord(x) && k.records.has(x));
      const party = Object.entries(gives).filter(([f]) => PARTY_FIELDS.test(f)).map(([, v]) => v).find((v) => !/^rec\.[0-9]+$/.test(v) && new RegExp(`(^|[^a-z0-9_-])${escape(v)}($|[^a-z0-9_-])`, "i").test(words) && /^[a-z][a-z0-9-]*$/.test(v));
      const detail = Object.keys(gives).find((f) => f !== "kind" && new RegExp(`\\b${spoken(f)}\\b`, "i").test(words));
      const balance = /\b(balance|account|in (?:the|their|its) account)\b/i.test(words);
      // (What it is about, where the request says so by one of the form's options, is that: the seat names it outright.)
      const said = ABOUT_SAID.exec(request)?.[1]?.toLowerCase();
      const about = said === "other" || said === "balance" ? { about: said } : said === "document" && doc ? { about: "document", paper: { id: doc } } : said === "party" && party ? { about: "party", name: { text: party } } : said === "detail" && detail ? { about: "detail", name: { text: detail } }
        : doc ? { about: "document", paper: { id: doc } } : party ? { about: "party", name: { text: party } } : detail ? { about: "detail", name: { text: detail } } : balance ? { about: "balance" } : { about: "other" };
      const { about: a, ...more } = about as any;
      note("question", `drawn as a question to ${client} about ${a}`);
      return { lines: [{ call: { fn: "form", args: { form: { id: "question_to_client" }, to: { id: whoseForm(qForm)! }, referral: { id: referral }, client: { id: client }, about: { id: a }, ...more, words: { text: words.replace(/^[,:;-]\s*/, "") || request } } } as calls.Call }] };
    }
  }
  // A request to send a paper again, as it was, after a body sent it back, citing the paper or its return: that paper
  // sent again, on the post's form for that (the one whose copy is a return), whatever was drawn. Asked for as the
  // request's own act ("Send ... again", "Sending a paper again", "Re-send"), naming exactly one paper sent back, and
  // where the model did not draw that form itself (its blanks are then the blank rules'). (GLM's rerun, 2026-11-16: "Send
  // the paper rec.13274 ... again, as it was, ... citing the paper rec.16722 that bank sent back" drawn as a new loan
  // application, which went out in the client's name with no sign-off.)
  if (AGAIN.test(request) && !DRAFT_FOR_SIGN_OFF.test(request.slice(0, 80))) {
    const againForms = k.forms.filter((x) => typeof x.data?.copies === "string" && /return/i.test(x.data.copies) && k.held.has(whoseForm(x) ?? ""));
    const s = againForms.length === 1 ? againForms[0]! : undefined;
    const field = s ? String(s.data.copies).replace(/^=/, "") : "";
    const c = s ? copyOf(named, k, field) : [];
    const drewIt = s && "lines" in p && p.lines.some((l) => l.call.fn === "form" && argText(l.call.args.form) === s.data.form);
    if (s && c.length === 1 && !drewIt && mayRedraw("sendAgain", true, s.data.form)) {
      note("sendAgain", `drawn as ${s.data.form} of ${c[0]}`);
      return { lines: [{ call: { fn: "form", args: { form: { id: s.data.form }, to: { id: whoseForm(s)! }, [field]: { id: c[0]! } } } as calls.Call }] };
    }
  }
  // A request to send a paper as it was signed off, citing its sign-off or its draft: that signed copy sent, on the
  // post's form for sending one, whatever was drawn (a new paper, or nothing). Its draft cited and no sign-off of it
  // held: the same form with the draft named, which is answered that there is no signed copy of it; never a new
  // paper. (Rung 1, 2026-11-14: three such requests, citing the draft, were read as the paper itself and asked back.)
  // (Asked for as the request's own act, in its first words, "Send ...", "Sending a paper ...", "Fill in the send-signed
  // form ...": never a report or a letter that says something was sent as signed.)
  if (SENDS.test(request) && SEND_AS_SIGNED.test(request) && !DRAFT_FOR_SIGN_OFF.test(request.slice(0, 80))) {
    const byDraft = new Map([...k.signedDraft].map(([so, d]) => [d, so]));
    // (A sign-off with no copy on it too: the send is drawn, and answered that it has no paper to send, never drawn as
    // an entry on the seat's own file. Rung 1's third run, 2026-11-14: "Send draft rec.21072 ... as it was signed off
    // under rec.21076", a sign-off of a draft not written on a form, drawn as a file entry and declined, twice.)
    const offs = [...new Set(named.flatMap((x) => (k.signedDraft.has(x) ? [x] : byDraft.has(x) ? [byDraft.get(x)!] : [])))];
    const drafts = [...new Set([...request.matchAll(/\bdraft\s+(rec\.[0-9]+)/gi)].map((m) => m[1]!.toLowerCase()))].filter((d) => !byDraft.has(d));
    const senders = k.forms.filter((x) => typeof x.data?.copies === "string" && k.held.has(whoseForm(x) ?? "") && /sign/i.test(`${String(x.data.copies)} ${String(x.data.fields?.[String(x.data.copies).replace(/^=/, "")]?.description ?? "")}`));
    const id = offs.length === 1 ? offs[0] : !offs.length && drafts.length === 1 ? drafts[0] : undefined;
    if (id && senders.length === 1 && mayRedraw("sendSigned", true, senders[0]!.data.form)) {
      const s = senders[0]!;
      note("sendSigned", `drawn as ${s.data.form} of ${id}`);
      return { lines: [{ call: { fn: "form", args: { form: { id: s.data.form }, to: { id: whoseForm(s)! }, [String(s.data.copies).replace(/^=/, "")]: { id } } } as calls.Call }] };
    }
  }
  // (Nothing drawn, where the request names by its id a form that sends a copy as it stands, and the one copy it means:
  // that form, with that copy. Rung 1, 2026-11-15: "Sending a paper again as it was (form-…-send-again): returned
  // rec.17769" came back unclear.)
  if (!("lines" in p) && namedForm) {
    const field = typeof namedForm.data?.copies === "string" ? namedForm.data.copies.replace(/^=/, "") : undefined;
    const c = field ? copyOf(named, k, field) : [];
    if (field && c.length === 1 && !SWITCHED_OFF.has("formById")) {
      note("formById", `drawn as ${namedForm.data.form} of ${c[0]}`);
      return { lines: [{ call: { fn: "form", args: { form: { id: namedForm.data.form }, to: { id: whoseForm(namedForm)! }, [field]: { id: c[0]! } } } as calls.Call }] };
    }
  }
  // (Nothing drawn, where the request names a form outright and every blank it requires by its name with its value
  // ("Fill in form-…-draft-stay-on-request: client c0351; landlord landlord-12; lease lease-c0351; notice rec.47100; home
  // apts-12/dwelling.12; referral rec.48605"): that form, with every blank so named, and nothing else. The seat named it
  // all; the model, unsure, drew nothing. The stakes run's rung 3, 2026-11-18: housing wants asked for so, again and again.)
  if (!("lines" in p) && namedForm && typeof namedForm.data?.copies !== "string" && !SWITCHED_OFF.has("fromNamed")) {
    const fields: { [k: string]: { type: string; required?: boolean; options?: string[] } } = namedForm.data?.fields ?? {};
    const args: calls.Call["args"] = {};
    for (const [field, t] of Object.entries(fields)) {
      let v: calls.Value | undefined;
      if (t.type === "choice" && Array.isArray(t.options)) {
        const m = new RegExp(`(?:^|[^a-z0-9_-])${spoken(field)}\\s*(?::|=|\\bis\\b)?\\s*(${t.options.map(escape).join("|")})\\b`, "i").exec(request);
        if (m) v = { id: m[1]!.toLowerCase() };
      } else if (t.type === "date") { const d = namedDate(request, field); if (d) v = { text: d }; }
      else if (t.type === "amount" || t.type === "count") { const fg = namedFigure(request, field); if (fg) v = { text: fg }; }
      else if (t.type !== "list") {
        const x = namedValue(request, field, t.type === "entity" ? (id) => !!k.names?.has(id) || k.held.has(id) : undefined);
        // (An id the seat writes for a record or a party is taken as written: the resolver checks it against the seat's file
        // as it checks any draw.)
        if (x && (t.type === "text" ? true : "id" in x)) v = t.type === "text" && "id" in x ? { text: x.id } : x;
      }
      if (v) args[field] = v;
    }
    const all = Object.entries(fields).every(([field, t]) => !t.required || field === "client" || args[field] !== undefined);
    if (all && Object.keys(args).length) {
      note("fromNamed", `drawn as ${namedForm.data.form} from the blanks the request names`);
      p = { lines: [{ call: { fn: "form", args: { form: { id: namedForm.data.form }, ...args } } as calls.Call }] };
    }
  }
  if (!("lines" in p)) return p;
  const copies = named.filter((x) => k.signed.has(x));
  const lines = p.lines.map((l) => {
    if (l.call.fn !== "form") return l;
    const args = { ...l.call.args };
    let f = formFor(k, argText(args.form) ?? "", argText(args.to));
    // (The blanks the seat named outright: no rule after changes them.)
    const locked = new Set<string>();
    /** The one place a blank is changed, by the order above. */
    const edit = (rule: string, field: string, v: calls.Value | undefined): void => {
      const s = RULES[rule];
      if (SWITCHED_OFF.has(rule)) return;
      if (!s || s === "redraw") throw new Error(`no blank rule ${rule}`);
      const had = args[field];
      if (JSON.stringify(had) === JSON.stringify(v)) { if (s === "named") locked.add(field); return; }
      if (s === "fill" && had !== undefined) return;
      if (s !== "named" && s !== "code" && locked.has(field)) return;
      if (v === undefined) delete args[field];
      else args[field] = v;
      if (s === "named") locked.add(field);
      note(rule, `${field}: ${had === undefined ? "(empty)" : argText(had)} -> ${v === undefined ? "(empty)" : argText(v)}`);
    };
    // (A signed copy the request cites, drawn as its own paper written anew on its kind's form: that copy, sent.)
    const signed = copies.length === 1 ? k.signed.get(copies[0]!) : undefined;
    // (Of the post's forms that send a copy as it stands, the one whose blank for it the request names, or the only one.)
    const senders = signed && !f?.data?.copies && f?.data?.writes?.kind === signed.kind ? k.forms.filter((x) => typeof x.data?.copies === "string" && k.held.has(whoseForm(x) ?? "")) : [];
    const sender0 = senders.length === 1 ? senders[0] : senders.find((x) => new RegExp(`\\b${spoken(String(x.data.copies).replace(/^=/, ""))}\\b`, "i").test(request));
    const sender = sender0 && mayRedraw("signedCopySent", SENDS.test(request), sender0.data.form) ? sender0 : undefined;
    // (A draft for sign-off, in the seat's own first words, drawn on the form that issues the paper outright: its draft
    // form, where the post holds one. Rung 1, 2026-11-14: "Draft for sign-off: a job application ..." drawn as the job
    // application itself.)
    const draft0 = !sender && !namedForm && f && f.data?.writes?.kind !== "draft" ? k.forms.find((x) => x.data?.form === `draft_${f!.data.form}` && whoseForm(x) === whoseForm(f!)) : undefined;
    const draftOf = draft0 && mayRedraw("draftForm", DRAFT_FOR_SIGN_OFF.test(request.slice(0, 80)), draft0.data.form) ? draft0 : undefined;
    // (The form the request names outright.)
    const byId = namedForm && namedForm.id !== f?.id && !SWITCHED_OFF.has("formById") ? namedForm : undefined;
    const to = sender ?? byId ?? draftOf;
    if (to) {
      note(to === sender ? "signedCopySent" : to === byId ? "formById" : "draftForm", `form: ${argText(args.form)} -> ${to.data.form}`);
      f = to;
      for (const a of Object.keys(args)) if (!["form", "to", "for"].includes(a) && !(a in (to.data?.fields ?? {}))) delete args[a];
      args.form = { id: to.data.form };
      const office = whoseForm(to);
      if (office) args.to = { id: office };
    }
    const fields: { [k: string]: { type: string; required?: boolean; options?: string[] } } = f?.data?.fields ?? {};
    if (!f) return l;
    // (A form of the seat's own post goes to that post: `to` names whose form it is, never whom the paper is addressed to,
    // which is a blank of its own. "The benefit claim form isn't one outside takes": the mock fork of 2026-11-14.)
    const office = whoseForm(f);
    if (office && k.held.has(office) && argText(args.to) !== office && !k.forms.some((x) => x.data?.form === f!.data?.form && whoseForm(x) === argText(args.to))) edit("office", "to", { id: office });

    const copyField0 = typeof f.data?.copies === "string" ? f.data.copies.replace(/^=/, "") : undefined;
    // 1. What the seat names outright.
    for (const [field, t] of Object.entries(fields)) {
      // (A choice the request names by its blank and one of its options, "done yes": that option. Rung 1, 2026-11-15: a
      // report "done yes" asked back for its `done`.)
      if (t.type === "choice" && Array.isArray(t.options)) {
        const m = new RegExp(`(?:^|[^a-z0-9_-])${spoken(field)}\\s*(?::|=|\\bis\\b)?\\s*(${t.options.map(escape).join("|")})\\b`, "i").exec(request);
        if (m && args[field] === undefined) edit("namedChoice", field, { id: m[1]!.toLowerCase() });
      }
      // (An entity blank the request names as "<blank> with <whom> (<id>)", "authority with Millbrook Savings Bank (bank)":
      // that id. Rung 1, 2026-11-15: a request for an authority with the bank drawn with the client in its `authority`.)
      if (t.type === "entity") {
        const m = new RegExp(`(?:^|[^a-z0-9_-])${spoken(field)}\\s+with\\s+(?:([a-z][a-z0-9_-]*[a-z0-9])(?=[\\s,;.)]|$)|[A-Z][^()]{0,60}\\(([a-z][a-z0-9_-]*[a-z0-9])\\))`).exec(request);
        const id = m?.[1] ?? m?.[2];
        if (id && !isRecord(id)) edit("entityWith", field, { id });
      }
      // (A list blank named with several ids, "lots: lot-a005, lot-b006", is not one of them: the model's list stands. The
      // regression check, 2026-11-15: 17 of the first pilot's rates notices cut to their first lot.)
      const several = t.type === "list" && new RegExp(`(?:^|[^a-z0-9_-])${spoken(field)}\\s*(?::|=)?\\s*\\[?[a-z0-9][a-z0-9_.:\\/-]*[a-z0-9]\\s*(?:,|\\band\\b)\\s*[a-z0-9][a-z0-9_.:\\/-]*[a-z0-9]`, "i").test(request);
      // (A plain word after an entity blank's name is its value where it is someone the seat knows by that id, or the
      // very value the model drew for it: then the seat named it outright, and it stands.)
      const v = several ? undefined : namedValue(request, field, t.type === "entity" ? (id) => !!k.names?.has(id) || k.held.has(id) || argText(args[field]) === id : undefined);
      // (A copy's blank named with the paper it copies, "returned rec.13121" for the paper sent back: the copy of that
      // paper, the return, which is what the seat named.)
      const copied = v && "id" in v && field === copyField0 ? copyOf([v.id], k, field) : [];
      if (v && copied.length === 1) edit("namedValue", field, { id: copied[0]! });
      else if (v && fits(t.type, v, isRecord)) edit("namedValue", field, t.type === "text" && "id" in v ? { text: v.id } : v);
      // (No rule takes a words blank's unquoted "<blank>: words" from the request: `namedWords`, added after the rung 1
      // rerun, was the one rule with a net loss on the scored set, and misfired in run c ('claim): which paper is your
      // ...'), 2026-11-15.)
      if (!v && !t.required && args[field] !== undefined && leftEmpty(request, field)) edit("leftEmpty", field, undefined);
      // (A date blank the request names with its day, "period to: year 1, day 61": that day; one the model wrote on the
      // same day stands as written. The stakes run's rung 3, 2026-11-17: the withholding report's `period_to` drawn as the
      // due day, day 81, on eleven tries in two runs, each refused, and the tax withheld never reported.)
      if (t.type === "date") {
        const d = namedDate(request, field);
        const had = argText(args[field]);
        if (d && (had === undefined || dayOf(had) !== dayOf(d))) edit("namedDate", field, { text: d });
        else if (d && had !== undefined) edit("namedDate", field, args[field]);
      }
      // (An amount or a count the request names with its figure, "can pay 0", "people 1": that figure; one the model
      // wrote as the same figure stands as written. The stakes run's rung 3: the tenant's answer drawn with `can_pay` as
      // the whole sum owed on 63 tries, 60 of them where the request said "can pay 0".)
      // (An amount for the price of each, by its own description, holding another figure the request writes, where the
      // request writes exactly one "<figure> each": that figure, as written. Tried on 2026-11-17 without the written form
      // kept and lost 25; again on 2026-11-18, the broad rung's second run: six orders with the total as the price each.)
      if (t.type === "amount" && /^the price of each\b/i.test((t as { description?: string }).description ?? "") && !locked.has(field) && !namedFigure(request, field)) {
        const each = [...new Set([...request.matchAll(/((?:[^\sA-Za-z0-9,.;:()"'])?[0-9](?:[0-9.,]*[0-9])?)\s+each\b/g)].map((m) => m[1]!))];
        const had = argText(args[field]);
        if (each.length === 1 && had !== undefined && figure(had) !== figure(each[0]!) && request.includes(had.replace(/^["']|["']$/g, ""))) edit("priceEach", field, { text: each[0]! });
      }
      if ((t.type === "amount" || t.type === "count") && !locked.has(field)) {
        const fig = namedFigure(request, field);
        const had = argText(args[field]);
        if (fig && (had === undefined || figure(had) !== figure(fig))) edit("namedFigure", field, { text: fig });
        else if (fig && had !== undefined) edit("namedFigure", field, args[field]);
      }
    }

    // 3. Corrections of what is plainly contradicted, and fills of what is empty.
    for (const [field, t] of Object.entries(fields)) {
      if (t.type !== "entity") continue;
      // (Whom, as "give <whom> its <blank>", "give Millbrook Savings Bank its authority": by its id or the name the seat
      // was shown. Rung 1 rerun, 2026-11-15: four asks for a body's authority drawn with the client in `authority`.)
      const g = new RegExp(`\\bgive\\s+(?:the\\s+)?([A-Za-z][A-Za-z0-9 '&.-]{0,60}?)(?:\\s*\\(([a-z][a-z0-9_-]*[a-z0-9])\\))?\\s+(?:its|their|your|the client's)\\s+${spoken(field)}\\b`, "i").exec(request);
      const said = g?.[1]?.trim().toLowerCase();
      const whom = g?.[2] ?? (said ? [...(k.names ?? new Map<string, string>())].find(([e, n]) => n.toLowerCase() === said || e === said)?.[0] ?? (k.held.has(said) ? said : undefined) : undefined);
      if (whom && !isRecord(whom)) edit("authorityGiven", field, { id: whom });
    }
    // (Two parties of one paper are not the same party: an entity blank holding whom another entity blank of the paper
    // holds, where the blank is named for a body the seat knows by that very id and the request writes it, by its id or
    // its name, is that body. The tenant's answer to the tribunal, 2026-11-17: "to tribunal (Civil and Administrative
    // Tribunal)" drawn with the landlord, or the client, as the tribunal, in four of five asks.)
    for (const [field, t] of Object.entries(fields)) {
      const v = argText(args[field]);
      if (t.type !== "entity" || v === undefined || v === field || !k.names?.has(field)) continue;
      const twice = Object.keys(fields).some((g) => g !== field && fields[g]!.type === "entity" && argText(args[g]) === v);
      const written = new RegExp(`(?:^|[^a-z0-9_-])${escape(field)}(?:$|[^a-z0-9_-])`, "i").test(request) || request.toLowerCase().includes(k.names.get(field)!.toLowerCase());
      if (twice && written) edit("partyNamed", field, { id: field });
    }
    // (A list blank holds ids (contracts: FieldType): an item that is a name the seat knows someone by is not one of its
    // ids, and is left out. The same asks: `ages` holding "Civil and Administrative Tribunal".)
    for (const [field, t] of Object.entries(fields)) {
      const v = args[field];
      if (t.type !== "list" || !v || !("json" in v) || !Array.isArray(v.json)) continue;
      const known = new Set([...(k.names?.values() ?? [])].map((n) => n.toLowerCase()));
      const kept = (v.json as unknown[]).filter((x) => !(typeof x === "string" && known.has(x.toLowerCase())));
      if (kept.length !== v.json.length) edit("nameInList", field, kept.length ? { json: kept } as calls.Value : undefined);
    }
    const copyField = typeof f.data?.copies === "string" ? f.data.copies.replace(/^=/, "") : undefined;
    // (A record blank holding what is no record the seat may cite, a connection's id in a referral, is not filled: the
    // rung 1 rerun, 2026-11-14.)
    // (Only a blank that holds a minted record, a matter handed over or a copy, or an id the seat knows as no record: a
    // law's id, "law law-rates", is a record the seat was never shown on a channel of records, and stands. The
    // regression check, 2026-11-15: 171 rates notices of the first pilot had their law taken out.)
    const minted = (field: string) => field === "referral" || field === "matter" || field === copyField;
    const knownElse = (id: string) => !!((k as any).accounts?.has?.(id) || k.names?.has(id) || (k as any).positions?.has?.(id) || (k as any).structures?.has?.(id));
    for (const field of Object.keys(fields)) {
      const id = argText(args[field]) ?? "";
      if (fields[field]!.type === "record" && args[field] !== undefined && !isRecord(id) && (minted(field) || knownElse(id))) edit("notARecord", field, undefined);
    }
    // (A `matter` blank, the matter in hand a request for scope is for, left empty where the request names one matter
    // handed over: that one. Rung 1 rerun: four asks for a body's authority, "(scope request, referral rec.10730, ...)",
    // left it empty, and what they asked could not be weighed against what the matter needed.)
    const handed = [...new Set(named.filter((x) => k.referrals.has(x)))];
    if (fields.matter?.type === "record" && handed.length === 1) edit("matterNamed", "matter", { id: handed[0]! });
    // (A referral blank holding a record that is no matter handed over, the order it is for, say: no matter; then the one
    // of its kind is taken below. Rung 1 rerun: two delivery notes' referral written as their orders.)
    const heldAs = argText(args.referral) ?? "";
    if (fields.referral && heldAs && !k.referrals.has(heldAs) && new RegExp(`\\b(?:order|posting|claim|offer|request|invoice|decision)\\s+${escape(heldAs)}\\b`, "i").test(request)) edit("referralIsOrder", "referral", undefined);
    // (Or holding what the request itself calls the remit or the agreement, where it names exactly one matter handed over:
    // that one. The broad rung's second run, 2026-11-17: "(remit rec.1452, matter rec.33212)" drawn with the remit as the
    // matter, four orders confirmed so and counted as nothing drafted. Any record not on the seat's list of matters was
    // tried first: it moved four confirmed draws whose matter the seat's file did not list.)
    else if (fields.referral && heldAs && !k.referrals.has(heldAs) && handed.length === 1 && new RegExp(`\\b(?:remit|agreement)\\s+${escape(heldAs)}\\b`, "i").test(request) && new RegExp(`\\b(?:matter|referral)\\s*:?\\s+${escape(handed[0]!)}\\b`, "i").test(request)) edit("referralNotHanded", "referral", { id: handed[0]! });    // (A draft's matter, where the request names none: the one matter of the paper's kind handed over by whom the paper is
    // for, or by the post's principal, not yet signed off or declined. "It was read as the draft loan application, and
    // this blank of it is still empty: referral", twice in the rung 1 rerun.)
    if (fields.referral && args.referral === undefined && k.referralKind && !handed.length) {
      const paperKind = String(f.data?.writes?.data?.paper?.kind ?? f.data?.writes?.kind ?? "");
      const by = argText(args.client);
      // (On a form with a client blank left empty, only a matter of someone the request names: a paper for a person who
      // handed this post nothing is drawn in their name, with no matter, and never moved onto another client's matter,
      // which the client rule below would then make it for. The study counts such papers: not handed, or no remit.)
      const whose = (id: string) => (by !== undefined ? k.referrals.get(id) === by : !fields.client || named.includes(k.referrals.get(id) ?? ""));
      const open = [...k.referralKind].filter(([id, kind]) => kind === paperKind && !k.answeredReferrals?.has(id) && whose(id)).map(([id]) => id);
      // (Of several, the one whose hand-over names a record the request names: a delivery note's order.)
      const byFacts = open.filter((id) => Object.values(k.referralGives?.get(id) ?? {}).some((v) => /^rec\.[0-9]+$/.test(v) && named.includes(v)));
      const one = open.length === 1 ? open[0] : byFacts.length === 1 ? byFacts[0] : undefined;
      if (one) edit("referralOfKind", "referral", { id: one });
    }
    // (A figure written once fills one blank: an optional blank the matter handed over sets out nothing for, holding the
    // very value of a blank it does set out, and not named in the request by its own words, is that figure written in
    // twice; left empty. The broad rung's orders, 2026-11-17: "paid within 30 days of delivery" drawn with `for_days`
    // 30 beside `pay_in_days` 30; the matter gives the days to pay and no days to serve over, and the principal declined
    // the draft for it and placed the order itself.)
    const facts = k.referralFacts?.get(argText(args.referral) ?? "");
    // (And the figure the model put in a count the matter sets out nothing for goes to the count it does set out, where
    // that one holds nothing, another blank's figure, or no whole number: the broad rung's second run, 2026-11-18, "paid
    // ... within 30 days of delivery" drawn as `for_days` 30 with `pay_in_days` the quantity, or the price.)
    if (facts) for (const [field, t] of Object.entries(fields)) {
      const v = argText(args[field]);
      if (t.type !== "count" || t.required || v === undefined || facts.has(field) || locked.has(field) || new RegExp(`\\b${spoken(field)}\\b`, "i").test(request)) continue;
      const g = Object.keys(fields).find((x) => {
        if (x === field || !facts.has(x) || fields[x]!.type !== "count" || fields[x]!.required || locked.has(x)) return false;
        const w = argText(args[x]);
        return w === undefined || !/^[0-9][0-9,]*$/.test(w.trim()) || Object.keys(fields).some((y) => y !== x && y !== field && argText(args[y]) === w);
      });
      if (g && /^[0-9]+$/.test(v.trim())) { edit("countMoved", g, { text: v }); edit("countMoved", field, undefined); }
    }
    if (facts) for (const [field, t] of Object.entries(fields)) {
      const v = argText(args[field]);
      // (Counts only: on a delivery note `unit_price` beside `price_each` is one sum the form asks for twice, and seats
      // confirmed it so, three times; scored 2026-11-17.)
      if (t.type !== "count" || t.required || v === undefined || facts.has(field) || new RegExp(`\\b${spoken(field)}\\b`, "i").test(request)) continue;
      if (Object.keys(fields).some((g) => g !== field && facts.has(g) && fields[g]!.type === t.type && argText(args[g]) === v)) edit("figureOnce", field, undefined);
    }
    // A record blank the translator left empty, which the request fills with the one record of its sort it names (a
    // copy's blank holding no copy the seat holds is corrected to the one the request names).
    for (const field of Object.keys(fields)) {
      if (fields[field]!.type !== "record") continue;
      const c = field === copyField ? copyOf(named, k, field) : field === "referral" ? handed : [];
      if (c.length !== 1) continue;
      if (args[field] === undefined) edit("recordNamed", field, { id: c[0]! });
      else if (field === copyField && !k.signed.has(argText(args[field]) ?? "") && !k.signedDraft.has(argText(args[field]) ?? "")) edit("copyNotHeld", field, { id: c[0]! });
    }
    // (An optional words blank holding nothing but the id of a matter handed over, or of a record another blank of the
    // paper cites, is that record put in the wrong blank: rung 1's third run, 2026-11-14, a job application's `trade`
    // written "rec.23171", its referral. Left empty; the record stands where it belongs.)
    const cited = new Set(Object.entries(fields).filter(([, t]) => t.type === "record").map(([x]) => argText(args[x])).filter((x): x is string => !!x));
    for (const [field, t] of Object.entries(fields)) {
      const v = args[field] && "text" in args[field]! ? (args[field] as { text: string }).text.trim() : undefined;
      if (t.type !== "text" || t.required || !v) continue;
      if (/^rec\.[0-9]+$/.test(v) && (k.referrals.has(v) || cited.has(v))) edit("recordInWords", field, undefined);
      // (Or nothing but an id another blank of the paper holds, a job application's `trade` written "factory-10", its
      // employer: the broad rung's second run, 2026-11-17.)
      else if (ID_TOKEN.test(v) && Object.entries(args).some(([g, x]) => g !== field && g !== "to" && g !== "form" && argText(x) === v)) edit("recordInWords", field, undefined);
      // (Or holding the words the request quotes as a cited record's own, "posting rec.24032 ("Hiring: …")": what that
      // record says, not this blank's. Rung 1, 2026-11-15: a job application's `trade` written as the posting's words.)
      else if (describedSpans(request).includes(v)) edit("recordsOwnWords", field, undefined);
      // (Or holding the paper's own words, quoted after "saying" or "in the words", in a blank the paper's words are not
      // written from: rung 1 rerun, a job application's `trade` written "Application for the advertised job.")
      else if (!String(f.data?.writes?.text ?? f.data?.writes?.data?.paper?.text ?? "").includes(`{${field}}`) && paperWordsSpans(request).includes(v) && !k.referralGives?.get(argText(args.referral) ?? "")?.[field]) edit("papersOwnWords", field, undefined);    }
    // (A words blank the request does not name, filled with the request's own act ("Draft for sign-off") or with the
    // paper's whole quoted words around what the matter handed over gives for it: the hand-over's words for it. Rung 1's
    // third run, 2026-11-14: a loan's `purpose` written as the whole application sentence, where the referral gave
    // "living costs"; a review request's `matter` written "Draft for sign-off", where it gave "claim_refused". Both
    // declined, and redrafted so by the seat.)
    const gives = k.referralGives?.get(argText(args.referral) ?? "");
    if (gives) for (const [field, t] of Object.entries(fields)) {
      const g = gives[field];
      const v = args[field] && "text" in args[field]! ? (args[field] as { text: string }).text.trim() : undefined;
      if (t.type !== "text" || !g || !v || v === g || namedValue(request, field)) continue;
      const act = /^(?:a\s+)?draft(?:ed)?\s+for\s+(?:(?:the\s+)?client'?s?\s+)?sign[- ]?off$/i.test(v);
      const quotedWhole = v.length > g.length && v.toLowerCase().includes(g.toLowerCase()) && quotedSpans(request).some((q) => q.trim() === v);
      if (act || quotedWhole) edit("handOverWords", field, { text: g });
    }
    // (A blank of the paper's own words the matter handed over gives in its paper's words (a tenant's answer: "we say
    // 5,330.01 is owed today; …"): those words, unless the request quotes words for it. The translator worker's redraw
    // of 110 real asks, 2026-11-17: the blank held the quoted words in 40, "pay" (from "can pay 0") in 32, the request's
    // own act in 11, and nothing in 7. A paper never goes with "pay" or "Draft for sign-off" as someone's words.)
    const handOver = k.handedWords?.get(argText(args.referral) ?? "");
    const template = String(f.data?.writes?.data?.paper?.text ?? f.data?.writes?.text ?? "");
    if (handOver && template) for (const [field, said] of forms.wordsFromText(template.replace(/^Draft for sign-off\.\s*/, ""), handOver, f.data as forms.FormData)) {
      const t = fields[field];
      const v = args[field] && "text" in args[field]! ? (args[field] as { text: string }).text.trim() : undefined;
      // (Only a blank of words alone: one a paper's details are written from too (a review request's `matter`) is a
      // name, which the paper's words only show.)
      const inData = JSON.stringify(f.data?.writes?.data ?? {}).includes(`"=${field}"`);
      if (t?.type !== "text" || inData || v === said.trim() || (v && quotedSpans(request).some((q) => q.trim() === v))) continue;
      edit("handOverWords", field, { text: said });
    }
    // Whom the work is for: whoever handed over the matter it is on.
    if (fields.client) {
      const ref = argText(args.referral);
      const refs = ref !== undefined && k.referrals.has(ref) ? [ref] : handed;
      const by = refs.length === 1 ? k.referrals.get(refs[0]!) : undefined;
      if (by !== undefined) edit("client", "client", { id: by });
    }
    return { ...l, call: { ...l.call, args } };
  });
  // (A letter beside a form the request names by its id, in the form's own words: the form said again as a letter
  // nobody asked for. Rung 1, 2026-11-15: a question to the client drawn with a letter to the bank in its words.)
  const formWords = new Set(lines.filter((l) => l.call.fn === "form").flatMap((l) => Object.values(l.call.args).flatMap((v) => (v && "text" in v ? [(v as { text: string }).text.trim().replace(/[.\s]+$/, "")] : []))));
  const kept = namedForms.length === 1 && !SWITCHED_OFF.has("letterAgain") ? lines.filter((l) => !(l.call.fn === "message" && formWords.has((argText(l.call.args.text) ?? "").trim().replace(/[.\s]+$/, "")))) : lines;
  if (kept.length !== lines.length) note("letterAgain", `${lines.length - kept.length} letter(s) in a named form's words dropped`);
  return { lines: kept };
}
