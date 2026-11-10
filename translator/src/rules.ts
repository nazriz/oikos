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
