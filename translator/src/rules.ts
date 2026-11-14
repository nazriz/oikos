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
import { calls } from "@oikos/participants";

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
  readonly held: ReadonlySet<string>;
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
function namedValue(request: string, field: string): { id: string } | { text: string } | undefined {
  const re = new RegExp(`(?:^|[^a-z0-9_-])${spoken(field)}(?:\\s+field)?\\s*(?::|=|\\bis\\b)?\\s*(?:"([^"]{1,200})"|“([^”]{1,200})”|\\[?([a-z0-9][a-z0-9_.:\\/-]*[a-z0-9]))`, "gi");
  const seen = new Set<string>();
  let out: { id: string } | { text: string } | undefined;
  for (const m of request.matchAll(re)) {
    const quoted = m[1] ?? m[2];
    const v: { id: string } | { text: string } | undefined = quoted !== undefined ? { text: quoted } : m[3] && ID_TOKEN.test(m[3]) ? { id: m[3] } : undefined;
    if (!v) continue;
    seen.add(JSON.stringify(v));
    out = v;
  }
  return seen.size === 1 ? out : undefined;
}

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
const SENDS = /^\s*(?:please\s+)?(?:send(?:ing)?\b|re-?send\b|fill (?:in|out) (?:the |form[- ])?(?:[a-z0-9-]*[- ])?send[- ]signed\b|send[- ]signed\b)/i;
/** Whether the seat's own words ask for a draft for sign-off. Keyed on the seat's words alone, never on what its remit
 * allows: a seat that asks to issue outright what its remit lets it only draft is set out exactly that, since acts
 * beyond the remit are what the study counts (the coordinator, 2026-11-14). */
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

/** A program with a form's blanks set where the request settles them exactly (above). Lines on no form the seat holds
 * are left as they are. */
export function formRules(p: calls.Program, request: string, k: FormKnowledge, isRecord: (id: string) => boolean = recordTest(k as any)): calls.Program {
  const named = idsIn(request);
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
    if (id && senders.length === 1) {
      const s = senders[0]!;
      return { lines: [{ call: { fn: "form", args: { form: { id: s.data.form }, to: { id: whoseForm(s)! }, [String(s.data.copies).replace(/^=/, "")]: { id } } } as calls.Call }] };
    }
  }
  if (!("lines" in p)) return p;
  const formIds = new Set(k.forms.map((f) => f.id));
  // (By its id, or by its own name written with hyphens, "form draft-loan-application", among the post's own forms.)
  const ownByName = new Map(k.forms.filter((f) => k.held.has(whoseForm(f) ?? "") && typeof f.data?.form === "string" && f.data.form.includes("_")).map((f) => [f.data.form.replace(/_/g, "-"), f.id]));
  const namedForms = [...new Set(named.flatMap((x) => (formIds.has(x) ? [x] : ownByName.has(x) ? [ownByName.get(x)!] : [])))];
  const copies = named.filter((x) => k.signed.has(x));
  const lines = p.lines.map((l) => {
    if (l.call.fn !== "form") return l;
    const args = { ...l.call.args };
    let f = formFor(k, argText(args.form) ?? "", argText(args.to));
    // The form the request names by its id.
    const byId = namedForms.length === 1 ? k.forms.find((x) => x.id === namedForms[0]) : undefined;
    // (A signed copy the request cites, drawn as its own paper written anew on its kind's form: that copy, sent.)
    const signed = copies.length === 1 ? k.signed.get(copies[0]!) : undefined;
    // (Of the post's forms that send a copy as it stands, the one whose blank for it the request names, or the only one.)
    const senders = signed && !f?.data?.copies && f?.data?.writes?.kind === signed.kind ? k.forms.filter((x) => typeof x.data?.copies === "string" && k.held.has(whoseForm(x) ?? "")) : [];
    const sender = senders.length === 1 ? senders[0] : senders.find((x) => new RegExp(`\\b${spoken(String(x.data.copies).replace(/^=/, ""))}\\b`, "i").test(request));
    // (A draft for sign-off, in the seat's own words, drawn on the form that issues the paper outright: its draft form,
    // where the post holds one. Rung 1, 2026-11-14: "Draft for sign-off: a job application ..." drawn as the job
    // application itself.)
    const draftOf = !sender && !byId && f && f.data?.writes?.kind !== "draft" && DRAFT_FOR_SIGN_OFF.test(request)
      ? k.forms.find((x) => x.data?.form === `draft_${f!.data.form}` && whoseForm(x) === whoseForm(f!)) : undefined;
    const to = sender ?? (byId && byId.id !== f?.id ? byId : undefined) ?? draftOf;
    if (to) {
      f = to;
      for (const a of Object.keys(args)) if (!["form", "to", "for"].includes(a) && !(a in (to.data?.fields ?? {}))) delete args[a];
      args.form = { id: to.data.form };
      const office = whoseForm(to);
      if (office) args.to = { id: office };
    }
    const fields: { [k: string]: { type: string; required?: boolean } } = f?.data?.fields ?? {};
    if (!f) return l;
    // (A form of the seat's own post goes to that post: `to` names whose form it is, never whom the paper is addressed to,
    // which is a blank of its own. "The benefit claim form isn't one outside takes": the mock fork of 2026-11-14.)
    const office = whoseForm(f);
    if (office && k.held.has(office) && argText(args.to) !== office && !k.forms.some((x) => x.data?.form === f!.data?.form && whoseForm(x) === argText(args.to))) args.to = { id: office };
    for (const [field, t] of Object.entries(fields)) {
      const v = namedValue(request, field);
      if (v && fits(t.type, v, isRecord) && JSON.stringify(args[field]) !== JSON.stringify(t.type === "text" && "id" in v ? { text: v.id } : v)) args[field] = t.type === "text" && "id" in v ? { text: v.id } : v;
      else if (!t.required && args[field] !== undefined && leftEmpty(request, field)) delete args[field];
    }
    // A record blank the translator left empty, which the request fills with the one record of its sort it names.
    const copyField = typeof f.data?.copies === "string" ? f.data.copies.replace(/^=/, "") : undefined;
    const candidates = (field: string): string[] => {
      if (field === copyField) return [...new Set(named.filter((x) => k.signed.has(x) || k.signedDraft.has(x)))];
      if (field === "referral") return [...new Set(named.filter((x) => k.referrals.has(x)))];
      return [];
    };
    // (A record blank holding what is no record the seat may cite, a connection's id in a referral, is not filled: the
    // rung 1 rerun, 2026-11-14.)
    for (const field of Object.keys(fields)) if (fields[field]!.type === "record" && args[field] !== undefined && !isRecord(argText(args[field]) ?? "")) delete args[field];
    // (A draft's matter, where the request names none: the one matter of the paper's kind handed over by whom the paper is
    // for, or by the post's principal, not yet signed off or declined. "It was read as the draft loan application, and
    // this blank of it is still empty: referral", twice in the rung 1 rerun.)
    if (fields.referral && args.referral === undefined && k.referralKind) {
      const paperKind = String(f.data?.writes?.data?.paper?.kind ?? f.data?.writes?.kind ?? "");
      const by = argText(args.client);
      const open = [...k.referralKind].filter(([id, kind]) => kind === paperKind && !k.answeredReferrals?.has(id) && (by === undefined || k.referrals.get(id) === by)).map(([id]) => id);
      if (open.length === 1 && !named.some((x) => k.referrals.has(x))) args.referral = { id: open[0]! };
    }
    for (const field of Object.keys(fields)) {
      if (fields[field]!.type !== "record") continue;
      const c = candidates(field);
      if (c.length === 1 && (args[field] === undefined || (field === copyField && !k.signed.has(argText(args[field]) ?? "") && !k.signedDraft.has(argText(args[field]) ?? "")))) args[field] = { id: c[0]! };
    }
    // (An optional words blank holding nothing but the id of a matter handed over, or of a record another blank of the
    // paper cites, is that record put in the wrong blank: rung 1's third run, 2026-11-14, a job application's `trade`
    // written "rec.23171", its referral. Left empty; the record stands where it belongs.)
    const cited = new Set(Object.entries(fields).filter(([, t]) => t.type === "record").map(([x]) => argText(args[x])).filter((x): x is string => !!x));
    for (const [field, t] of Object.entries(fields)) {
      const v = args[field] && "text" in args[field]! ? (args[field] as { text: string }).text.trim() : undefined;
      if (t.type === "text" && !t.required && v && /^rec\.[0-9]+$/.test(v) && (k.referrals.has(v) || cited.has(v))) delete args[field];
    }
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
      if (act || quotedWhole) args[field] = { text: g };
    }
    // Whom the work is for: whoever handed over the matter it is on.
    if (fields.client) {
      const ref = argText(args.referral);
      const refs = ref !== undefined && k.referrals.has(ref) ? [ref] : [...new Set(named.filter((x) => k.referrals.has(x)))];
      const by = refs.length === 1 ? k.referrals.get(refs[0]!) : undefined;
      if (by !== undefined) args.client = { id: by };
    }
    return { ...l, call: { ...l.call, args } };
  });
  return { lines };
}
