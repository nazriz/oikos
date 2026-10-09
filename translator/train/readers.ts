// Requests with no program yet, labelled by two readers.
//
// A generated example begins with its program: a request is written for it, and a blind reader's agreement is the check
// (blind.ts). A request written in situ (a model in a seat's position, saying what it does: orchestrator/src/
// in-situ.ts), or one a seat really made, has no program to begin with. Two readers who see only the request and the
// forms (the same blind file a reader of generated data gets) each write the program; the request becomes an example
// only where
//   1. both answers are programs in the call language that the contract allows;
//   2. they mean the same (meaning.ts), with two leniencies the checks by hand had been granting: a list written with
//      bare items (`to=[works, rates]`) is that list, and copied text that names an id in square brackets is the same
//      text with or without the brackets;
//   3. every value of the program is in the request as the pipeline requires of any example (data.ts `needed`,
//      `spansIn`), so the example has its spans, and the steps a model is trained on rebuild the program exactly
//      (model/encode.ts, and the pieces of model/export.ts). A letter's text is the request's own words, copied: a
//      reader who reworded it fails here, and that is counted by itself (`reworded_text`).
// The program kept is the first reader's if it passes 3, else the second's: where one reader copied a letter with the
// request's brackets and the other left them out, the copy is the one kept. It is kept in the one spelling gold
// programs have (`goldText`). A form's office that the request doesn't name is left out where the forms known send it
// to one office only (the resolver fills it in, and meaning.ts already reads the two as the same).
//
// Nothing here calls a model: the readers' answers come in as files (orchestrator/src/in-situ.ts reads them).

import { calls, type Currency } from "@oikos/participants";
import { canonical } from "../eval/run";
import { decode, encode } from "../model/encode";
import { row, stepsOf } from "../model/export";
import { formOfLine, type BlindAnswer } from "./blind";
import { sameButForFreeText } from "./meaning";
import { DATA_VERSION, formOf, functionOf, goldText, needed, sameProgram, shapeOf, spanOf, spansIn, type Example, type FormSpec, type Needed } from "./data";

/** A request waiting for its program: what a reader is given of it (`id`, `request`, `forms`), and where it came from. */
export interface Unlabelled {
  id: string;
  request: string;
  /** The forms the asker knew of, each as the translator is shown it (one line). */
  forms: string[];
  /** The situation it was said in, who said it (a writer's name, or the model a seat ran on), and, for one a seat
   * really made, its draft in that run's log. */
  from?: { situation?: string; writer?: string; draft?: string };
  /** How the world it is from writes money (amounts are compared in it). */
  currency?: Currency;
}

/** Why a request was not kept. */
export type NotKept = "unanswered" | "not_a_program" | "contract" | "disagreed" | "reworded_text" | "not_copied" | "not_encodable";
export const NOT_KEPT: NotKept[] = ["unanswered", "not_a_program", "contract", "disagreed", "reworded_text", "not_copied", "not_encodable"];

export interface LabelReject {
  id: string; request: string; why: NotKept;
  /** What each reader answered, by the reader's name (absent: no answer). */
  answers: { [reader: string]: string };
  /** What was wrong, in words (a parse error, the contract's complaint, the value that isn't in the request). */
  detail?: string;
  from?: Unlabelled["from"];
}

export interface LabelManifest {
  version: string;
  /** How the examples were made: requests with no program, labelled by two readers who agreed. */
  labelled_by: "two readers";
  readers: [string, string];
  requests: number;
  examples: number;
  rejected: number;
  /** Requests dropped, by reason (every reason, also those nothing was dropped for). */
  by_reason: { [why in NotKept]: number };
  by_kind: { [kind: string]: number };
  /** Examples by the first function of their program (a refusal by its label), and the refusals alone by label. */
  by_function: { [fn: string]: number };
  by_refusal_label: { [label: string]: number };
  /** Examples by who wrote the request. */
  writers: { [writer: string]: number };
  /** Whose program was kept: the first reader's, or the second's where the first's didn't copy the request. */
  kept_from: { [reader: string]: number };
  /** Examples whose form's office the readers wrote and the request doesn't name: left out of the program. */
  office_left_out: number;
  spans: { copy: number; choice: number; implied: number };
  ambiguous_spans: number;
  /** Answers whose id is no request's, by reader. */
  unknown_ids: { [reader: string]: number };
  sha256: string;
}

const ID = /^[A-Za-z0-9_.:\/-]+$/;

/**
 * A program with the bare items of its lists quoted (`to=[works, rates]` as `to=["works","rates"]`): the call language
 * writes a list as JSON, and a reader who writes its ids bare has said the same list. Anything else is left as it is
 * (text in quotes is never looked into; a list that holds more than names is not touched).
 */
export function withListsQuoted(program: string): string {
  let out = "";
  for (let i = 0; i < program.length; i++) {
    const c = program[i]!;
    if (c === '"') {
      // Quoted text, whole.
      let j = i + 1;
      while (j < program.length && program[j] !== '"') j += program[j] === "\\" ? 2 : 1;
      out += program.slice(i, j + 1);
      i = j;
    } else if (c === "[") {
      const end = closing(program, i);
      const items = end < 0 ? undefined : listItems(program.slice(i + 1, end));
      if (!items) out += c;
      else {
        out += `[${items.join(", ")}]`;
        i = end;
      }
    } else out += c;
  }
  return out;
}

/** Where the list opened at `from` closes, or -1 if it holds another list or an object (not a list of names). */
function closing(s: string, from: number): number {
  for (let i = from + 1; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') i += s[i] === "\\" ? 2 : 1;
    } else if (c === "[" || c === "{") return -1;
    else if (c === "]") return i;
  }
  return -1;
}

/** The items of a list's inside, each as JSON, with the bare names among them quoted; undefined if an item is neither. */
function listItems(inside: string): string[] | undefined {
  if (!inside.trim()) return [];
  const items: string[] = [];
  let at = 0;
  let quoted = false;
  for (let i = 0; i <= inside.length; i++) {
    const c = inside[i];
    if (c === '"') quoted = !quoted;
    else if (c === "\\" && quoted) i++;
    else if ((c === "," && !quoted) || c === undefined) {
      items.push(inside.slice(at, i).trim());
      at = i + 1;
    }
  }
  const out: string[] = [];
  for (const x of items) {
    let json = true;
    try {
      JSON.parse(x);
    } catch {
      json = false;
    }
    if (json) out.push(x);
    else if (ID.test(x)) out.push(JSON.stringify(x));
    else return undefined;
  }
  return out;
}

/** A program with the square brackets taken off any id its copied texts name ("collect at [house-165]" as "collect at
 * house-165"): for comparing two readers' texts, never for what is kept. */
export function withoutBrackets(p: calls.Program): calls.Program {
  if ("none" in p) return p;
  const bare = (s: string) => s.replace(/\[([A-Za-z0-9_.:\/-]+)\]/g, "$1");
  const value = (v: calls.Value): calls.Value => ("text" in v ? { text: bare(v.text) } : "call" in v ? { call: call(v.call) } : v);
  const call = (c: calls.Call): calls.Call => ({ fn: c.fn, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, value(v)])) });
  return { lines: p.lines.map((l) => ({ ...l, call: call(l.call) })) };
}

/** A program with a form's office left out where the request doesn't name it and the forms known send that form to
 * that office and no other; and whether anything was left out. */
function officeLeftOut(p: calls.Program, request: string, forms: FormSpec[]): { program: calls.Program; left: boolean } {
  if ("none" in p) return { program: p, left: false };
  let left = false;
  const lines = p.lines.map((l) => {
    const to = l.call.args.to;
    const said = to && ("id" in to ? to.id : "text" in to ? to.text : undefined);
    if (l.call.fn !== "form" || said === undefined) return l;
    const name = formOf(calls.callText(l.call))?.form;
    const goes = [...new Set(forms.filter((f) => f.form === name || f.id === name).map((f) => f.to))];
    const idLike = /[0-9.\/-]/.test(said);
    if (goes.length !== 1 || goes[0] !== said || spanOf(request, { value: said, arg: "to", exact: idLike || "text" in to!, how: "copy" })) return l;
    left = true;
    const { to: _, ...args } = l.call.args;
    return { ...l, call: { fn: l.call.fn, args } };
  });
  return { program: { lines }, left };
}

/** Whether a value that isn't in the request is a passage of text (a letter's words, a form's text): reworded, not
 * merely missing. */
const passage = (n: Needed): boolean => /(^|\.)text$/.test(n.arg) || n.value.trim().split(/\s+/).length >= 4;

type Tried = { example: Example; left: boolean } | { why: NotKept; detail: string };

/** A reader's program as an example of the request, if everything it takes from the request is there and the steps a
 * model is trained on rebuild it. */
function asExample(u: Unlabelled, parsed: calls.Program, forms: FormSpec[], by: { written_by: string; verified_by: string; origin: string }): Tried {
  const base = { id: u.id, request: u.request, forms: u.forms };
  const rest = { written_by: by.written_by, verified_by: by.verified_by, source: u.from?.situation ?? u.id, origin: by.origin, ...(u.currency ? { currency: u.currency } : {}) };
  if ("none" in parsed) {
    const program = calls.programText(parsed);
    return { left: false, example: { ...base, program, kind: "refusal", shape: program, ...rest, gold: program } };
  }
  const { program: p, left } = officeLeftOut(parsed, u.request, forms);
  const program = goldText(p);
  const gold = calls.parseProgram(program);
  const missing = needed(gold, forms).filter((n) => !spanOf(u.request, n));
  if (missing.length) return { why: missing.some(passage) ? "reworded_text" : "not_copied", detail: missing.map((n) => `${n.arg}=${n.value.length > 120 ? `${n.value.slice(0, 120)}…` : n.value}`).join("; ") };
  const example: Example = { ...base, program, kind: "positive", shape: shapeOf(gold), spans: spansIn(u.request, program, forms), ...rest, gold: program };
  try {
    const enc = encode(example);
    const r = row(example.id, example.kind, enc);
    if (!r) return { why: "not_encodable", detail: "a span cuts a piece of the input" };
    const back = decode(enc.input, stepsOf(r, r.steps));
    if (canonical(back) !== canonical(program)) return { why: "not_encodable", detail: `the steps give ${back}` };
  } catch (e) {
    return { why: "not_encodable", detail: String((e as Error).message).slice(0, 300) };
  }
  return { example, left };
}

/**
 * Requests labelled by two readers (see the top of this file). `answers`: each reader's name and what it answered
 * (`{id, program}`; a request answered twice by one reader is judged by its last answer). Returns the examples kept,
 * in the requests' order, the requests dropped with why, and the counts.
 */
export function labelled(requests: Unlabelled[], answers: [{ reader: string; answers: BlindAnswer[] }, { reader: string; answers: BlindAnswer[] }]): { examples: Example[]; rejects: LabelReject[]; manifest: LabelManifest } {
  const readers = answers.map((a) => a.reader) as [string, string];
  if (readers[0] === readers[1]) throw new Error(`two readers are needed, and both files are ${readers[0]}'s`);
  const ids = new Set(requests.map((u) => u.id));
  const given = answers.map((a) => {
    const m = new Map<string, string>();
    for (const x of a.answers) if (x && typeof x.id === "string" && typeof x.program === "string") m.set(x.id, x.program);
    return m;
  });
  const examples: Example[] = [];
  const rejects: LabelReject[] = [];
  const manifest: LabelManifest = {
    version: DATA_VERSION, labelled_by: "two readers", readers, requests: requests.length, examples: 0, rejected: 0,
    by_reason: Object.fromEntries(NOT_KEPT.map((w) => [w, 0])) as LabelManifest["by_reason"], by_kind: {}, by_function: {}, by_refusal_label: {}, writers: {},
    kept_from: { [readers[0]]: 0, [readers[1]]: 0 }, office_left_out: 0, spans: { copy: 0, choice: 0, implied: 0 }, ambiguous_spans: 0,
    unknown_ids: Object.fromEntries(readers.map((r, i) => [r, [...given[i]!.keys()].filter((id) => !ids.has(id)).length])), sha256: "",
  };
  const count = (o: { [k: string]: number }, k: string) => void (o[k] = (o[k] ?? 0) + 1);
  for (const u of requests) {
    const said = given.map((m) => m.get(u.id));
    const told = Object.fromEntries(readers.flatMap((r, i) => (said[i] === undefined ? [] : [[r, said[i]!]])));
    const drop = (why: NotKept, detail?: string) => {
      rejects.push({ id: u.id, request: u.request, why, answers: told, ...(detail ? { detail } : {}), ...(u.from ? { from: u.from } : {}) });
      manifest.by_reason[why]++;
    };
    if (said[0] === undefined || said[1] === undefined) {
      drop("unanswered", `no answer from ${readers.filter((_, i) => said[i] === undefined).join(" or ")}`);
      continue;
    }
    // 1. Both are programs the contract allows.
    const parsed: calls.Program[] = [];
    let bad: [NotKept, string] | undefined;
    for (const [i, text] of (said as string[]).entries()) {
      try {
        const p = calls.parseProgram(withListsQuoted(text));
        const errors = calls.contractErrors(p);
        if (errors.length) bad ??= ["contract", `${readers[i]}: ${errors.join("; ")}`];
        parsed.push(p);
      } catch (e) {
        bad = ["not_a_program", `${readers[i]}: ${String((e as Error).message).slice(0, 300)}`];
        break;
      }
    }
    if (bad) {
      drop(...bad);
      continue;
    }
    // 2. They mean the same act: copied free text is not compared (ruling A, 2026-10-10: meaning.ts), and what is kept
    // below is still one reader's own program, every word of it found in the request.
    const forms = u.forms.map(formOfLine).filter((f): f is FormSpec => !!f);
    const ctx = { ...(u.currency ? { currency: u.currency } : {}), ...(forms.length ? { forms } : {}) };
    const compared = parsed.map((p) => calls.programText(withoutBrackets(p)));
    if (!sameProgram(compared[0]!, compared[1]!, ctx) && !sameButForFreeText(compared[0]!, compared[1]!, ctx)) {
      drop("disagreed");
      continue;
    }
    // 3. Everything the program takes from the request is in it: the first reader's program, else the second's.
    const by = { written_by: u.from?.writer ?? "unknown", verified_by: readers.join(" + "), origin: u.from?.draft ? "pilot" : "in_situ" };
    const tried = parsed.map((p) => asExample(u, p, forms, by));
    const kept = tried.findIndex((t) => "example" in t);
    if (kept < 0) {
      const failed = tried as { why: NotKept; detail: string }[];
      const worst = failed.find((t) => t.why === "reworded_text") ?? failed.find((t) => t.why === "not_encodable") ?? failed[0]!;
      drop(worst.why, worst.detail);
      continue;
    }
    const { example, left } = tried[kept] as { example: Example; left: boolean };
    examples.push(example);
    manifest.kept_from[readers[kept]!]!++;
    if (left) manifest.office_left_out++;
    count(manifest.by_kind, example.kind);
    count(manifest.by_function, functionOf(example));
    if (example.kind === "refusal") count(manifest.by_refusal_label, example.program.slice(5, -1));
    count(manifest.writers, example.written_by!);
    for (const s of example.spans ?? []) {
      manifest.spans[s.how]++;
      if (s.ambiguous) manifest.ambiguous_spans++;
    }
  }
  manifest.examples = examples.length;
  manifest.rejected = rejects.length;
  const sorted = (o: { [k: string]: number }) => Object.fromEntries(Object.entries(o).sort());
  Object.assign(manifest, { by_function: sorted(manifest.by_function), by_refusal_label: sorted(manifest.by_refusal_label), writers: sorted(manifest.writers) });
  manifest.sha256 = new Bun.CryptoHasher("sha256").update(examples.map((e) => JSON.stringify(e)).join("\n") + (examples.length ? "\n" : "")).digest("hex");
  return { examples, rejects, manifest };
}
