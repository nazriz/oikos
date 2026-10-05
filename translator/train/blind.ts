// Blind checking of training data, as a step of the pipeline.
//
// The round trip (data.ts) checks a request with the translator's own prompt: it shares the prompt's blind spots, and
// a request that says the call back in the call's words passes it. A blind reader is someone, or some model of another
// family, who is given the requests and the forms and nothing else (no gold program, no label, nothing of how the
// example was made) and writes the program each request asks for. Where the reader's program means what the gold one
// does, two readings that share nothing agree; where it doesn't, either the gold is wrong, the request is, or the call
// language leaves the matter open (the second audit, 2026-10-06: a blind reader of another model family agreed on 262
// of 274, and 8 of the 12 it didn't were two rules the language had left unclear).
//
//   blindRequests   the requests for such a reader, in a SHUFFLED order (seeded): the first trial handed them over in
//                   the data's own order, positives function by function and the refusals last, so position gave
//                   the answer away.
//   checkAnswers    the reader's answers compared with the gold programs by meaning (meaning.ts), in the money and
//                   with the forms of each example's world: the examples it agreed on (marked verified by it), the
//                   ones it didn't (with both programs), and the counts per function.
//
// Nothing here calls a model: the reader's answers come in as a file (orchestrator/src/training.ts writes and reads them).

import { functionOf, sameProgram, sampler, shuffled, type Example, type FormSpec } from "./data";

/** What a blind reader is given of an example: its id, the request, and the forms the asker knows of. Nothing else. */
export interface BlindRequest { id: string; request: string; forms: string[] }
/** What a blind reader answers: the program the request asks for (`none(<label>)` for one to refuse). */
export interface BlindAnswer { id: string; program: string }

/** The requests of a data set for a blind reader, in a seeded shuffled order: the same examples and seed give the same
 * order, and the order says nothing of what an example is. */
export function blindRequests(examples: Example[], seed = 1): BlindRequest[] {
  // (Shuffled from a fixed order, by id, so the order the examples came in doesn't show through either.)
  const sorted = [...examples].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return shuffled(sorted, sampler(seed + 4099)).map((e) => ({ id: e.id, request: e.request, forms: e.forms }));
}

/** A form as an example carries it (one line, as the translator is shown it: data.ts `formLine`), read back to what
 * comparing two programs needs of it: its name, its office, its record's id and its fields' types. */
export function formOfLine(line: string): FormSpec | undefined {
  const m = /^- (.+?), to=(.+?), id (.+?): fields (.*)$/.exec(line);
  if (!m) return undefined;
  const fields: FormSpec["fields"] = {};
  // A field is `name (type)`, `name (type, required)` or `name (one of a | b, required)`.
  for (const f of m[4]!.matchAll(/([A-Za-z0-9_]+) \(([^()]*)\)/g)) {
    const required = /, required$/.test(f[2]!);
    const type = f[2]!.replace(/, required$/, "");
    fields[f[1]!] = type.startsWith("one of ") ? { type: "choice", options: type.slice(7).split(" | "), ...(required ? { required } : {}) } : { type, ...(required ? { required } : {}) };
  }
  return { form: m[1]!, to: m[2]!, id: m[3]!, fields };
}

export interface BlindCheck {
  /** The examples the reader agreed on, each marked verified by the reader (the model that translated it back before,
   * if any, is kept in `translated_back_by`). */
  checked: Example[];
  /** The examples the reader answered otherwise, with the reader's program beside the gold one. */
  disagreed: (Example & { answer: string; reader: string })[];
  /** The examples the reader gave no answer for. */
  unanswered: Example[];
  report: BlindReport;
}

export interface BlindReport {
  reader: string;
  examples: number;
  agreed: number;
  disagreed: number;
  unanswered: number;
  /** Answers whose id is no example's. */
  unknown_ids: number;
  /** Per function (a refusal by its label): how many the reader agreed on, didn't, and left unanswered. */
  by_function: { [fn: string]: { agreed: number; disagreed: number; unanswered: number } };
}

/**
 * A blind reader's answers against a data set's gold programs. Two programs agree if they mean the same (meaning.ts:
 * an amount in the example's own money, a form by any of its names and with its fields read by their types, a list
 * in any order), so a reader isn't failed for spelling. An example answered more than once is judged by the last answer.
 */
export function checkAnswers(examples: Example[], answers: BlindAnswer[], reader: string): BlindCheck {
  const given = new Map<string, string>();
  for (const a of answers) if (a && typeof a.id === "string" && typeof a.program === "string") given.set(a.id, a.program);
  const ids = new Set(examples.map((e) => e.id));
  const out: BlindCheck = { checked: [], disagreed: [], unanswered: [], report: { reader, examples: examples.length, agreed: 0, disagreed: 0, unanswered: 0, unknown_ids: [...given.keys()].filter((id) => !ids.has(id)).length, by_function: {} } };
  for (const e of examples) {
    const r = (out.report.by_function[functionOf(e)] ??= { agreed: 0, disagreed: 0, unanswered: 0 });
    const answer = given.get(e.id);
    if (answer === undefined) {
      out.unanswered.push(e);
      out.report.unanswered++;
      r.unanswered++;
      continue;
    }
    const forms = e.forms.map(formOfLine).filter((f): f is FormSpec => !!f);
    if (sameProgram(answer, e.program, { ...(e.currency ? { currency: e.currency } : {}), ...(forms.length ? { forms } : {}) })) {
      const { verified_by, verified_by_writer: _, ...rest } = e;
      out.checked.push({ ...rest, verified_by: reader, ...(verified_by && verified_by !== reader ? { translated_back_by: verified_by } : e.translated_back_by ? { translated_back_by: e.translated_back_by } : {}) });
      out.report.agreed++;
      r.agreed++;
    } else {
      out.disagreed.push({ ...e, answer, reader });
      out.report.disagreed++;
      r.disagreed++;
    }
  }
  out.report.by_function = Object.fromEntries(Object.entries(out.report.by_function).sort());
  return out;
}
