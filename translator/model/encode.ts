// A program as the decisions a model that decides and copies makes (docs/design/translator-and-resolver.md §16.10):
// every step is a choice from a closed set (a function, an argument, a refusal label, a value nothing in the request
// spells) or a span of what the model was shown (the request, then the forms the person knows of). Nothing is ever
// written freely, so a model trained on these steps can't invent an id or reword a letter.
//
// `encode` turns an example (its program and its spans, translator/train/data.ts) into steps; `decode` turns steps
// back into a program. `decode(encode(e))` is the example's program, exactly: the test of whether deciding and
// copying is enough for the call language.
import { calls } from "@oikos/participants";

/** A span of the input: `id` and `text` are its characters as they stand (bare, or quoted), `word` its words as one
 * lower-case word (a kind, a task, a form's name: "footpath declaration" for footpath_declaration), `field` a form's
 * field named as an argument (a span of the forms shown, never of the request). */
export type Pointer = ["id" | "text" | "word" | "field", number, number];
/** How a program is written as decisions. `steps` (every model before 2026-10-10): the model names each argument it
 * writes, closes each call (`)`) and ends the program (`eos`) by decisions of its own. `slots`: code lists what there
 * is to decide and the model decides each once (below, "Slot by slot"). A model answers in the decoding it was trained
 * in; its folder says which (config.json `decoding`; absent: `steps`). */
export type Decoding = "steps" | "slots" | "cards";
/** A choice from the closed set (`vocabulary`), or a span. */
export type Step = string | Pointer;

export interface Encoded { input: string; steps: Step[] }
export interface Span { arg: string; value: string; how: "copy" | "choice" | "implied"; at?: [number, number]; line?: number }

/** What the model is shown: the request, then each form the person knows of on a line of its own. */
export const inputOf = (request: string, forms: string[]): string => [request, ...forms].join("\n");

/** A span's words as one word: what a `word` pointer comes to. */
export const asWord = (s: string): string => s.trim().toLowerCase().replace(/^the\s+/, "").replace(/[\s-]+/g, "_");

export class NotEncodable extends Error {}

/** The order a call's arguments are written in: by name (`name`, the default: of the three it is the one whose models
 * do best on what seats really write, docs/decisions.md 2026-10-08), as the request says them (`said`), or by name
 * with long copied texts last (`text_last`). A model answers in the order it was trained in; decoding takes any. */
export type Order = "name" | "said" | "text_last";
export const ORDER: Order = process.env.OIKOS_ENCODE_ORDER === "said" ? "said" : process.env.OIKOS_ENCODE_ORDER === "text_last" ? "text_last" : "name";
/** A copied text this long or longer is a long one (`text_last`: by name, the long texts after everything else, so
 * that no argument waits behind a copy of several hundred characters, and which argument comes next is still known
 * by its name). */
const LONG = 80;

/** The arguments a function has by name. A form’s are its two own (which form, and to whom): every other is a field
 * of the form being filled in, known only from the form as shown, so it is pointed at, never chosen from a list. */
const FORM_ARGS = new Set(["form", "to"]);
const fixedArgs = (fn: string): Set<string> | undefined => (fn === "form" ? FORM_ARGS : calls.ARGS[fn]?.allowed);

/** The steps of an example's program. Throws NotEncodable where a value is neither a span nor marked implied. */
export function encode(e: { request: string; forms: string[]; program: string; spans?: Span[] }, order: Order = ORDER, decoding: Decoding = "steps"): Encoded {
  const input = inputOf(e.request, e.forms);
  const p = calls.parseProgram(e.program);
  // (`cards` is slot by slot over the same input, with one difference: a form's field whose value the request implies
  // and that is one of the field's options as the form's line lists them is pointed at there, never chosen from the
  // closed set, so that a form no example had can still be filled in. `splitCards` then reads it as two passes.)
  const cards = decoding === "cards";
  const slots = decoding === "slots" || cards;
  if ("none" in p) return { input, steps: slots ? [`none:${p.none}`] : [`none:${p.none}`, "eos"] };
  const steps: Step[] = [];
  const several = p.lines.length > 1;
  const shownForms = slots ? formsIn(input) : [];
  if (slots) steps.push(PROGRAM, `lines:${p.lines.length}`);
  p.lines.forEach((line, i) => {
    // This line's spans, by the path of the argument they fill, in the order the pipeline found them.
    const queue = new Map<string, Span[]>();
    for (const s of e.spans ?? []) if (!several || (s.line ?? 0) === i) (queue.get(s.arg) ?? queue.set(s.arg, []).get(s.arg)!).push(s);
    const take = (path: string, value: string): Span => {
      const q = queue.get(path) ?? [];
      const at = q.findIndex((s) => s.value === value);
      if (at < 0) throw new NotEncodable(`no span for ${path}=${value}`);
      return q.splice(at, 1)[0]!;
    };
    const scalar = (path: string, value: string, quoted: boolean, shown?: [number, number]) => {
      const s = take(path, value);
      // What the request implies and never says is a choice from the closed set, unless it stands in the forms shown
      // (an office's own form named by what it is for, and the office it goes to): that is pointed at where it is
      // shown, like a form's field, so that a form or an office no example had can still be written.
      if (s.how === "implied") return void steps.push(shown ? [quoted ? "text" : "id", shown[0], shown[1]] : `const:${quoted ? JSON.stringify(value) : value}`);
      if (!s.at) throw new NotEncodable(`no place for ${path}=${value}`);
      const said = e.request.slice(s.at[0], s.at[1]);
      if (said === value) steps.push([quoted ? "text" : "id", s.at[0], s.at[1]]);
      else if (asWord(said) === value && !quoted) steps.push(["word", s.at[0], s.at[1]]);
      else throw new NotEncodable(`${path}=${value} is not what the request says there (${said})`);
    };
    const data = (path: string, v: unknown) => {
      if (Array.isArray(v)) {
        steps.push("[");
        for (const x of v) data(path, x);
        steps.push("]");
      } else if (v && typeof v === "object") {
        steps.push("{");
        for (const [k, x] of Object.entries(v)) {
          steps.push(`key:${k}`);
          data(`${path}.${k}`, x);
        }
        steps.push("}");
      } else scalar(path, String(v), true);
    };
    const value = (path: string, v: calls.Value, shown?: (value: string) => [number, number] | undefined) => {
      if ("var" in v) steps.push(`var:${v.var}`);
      else if ("id" in v) scalar(path, v.id, false, shown?.(v.id));
      else if ("text" in v) scalar(path, v.text, true, shown?.(v.text));
      else if ("call" in v) call(v.call, `${path}.`);
      else data(path, v.json);
    };
    const call = (c: calls.Call, prefix: string) => {
      steps.push(`fn:${c.fn}`);
      if (slots) {
        // Slot by slot: each slot of the call in its stated order, its value or that it is left out. No argument is
        // named and nothing closes the call: which slot a decision is for is known by counting.
        const mine = slotsOf(c.fn, shownForms, said(c.args.form), said(c.args.to));
        for (const k of Object.keys(c.args)) if (!mine.some((s) => s.name === k)) throw new NotEncodable(c.fn === "form" ? `the field ${k} is not one of the form as shown` : `${c.fn} has no slot ${k}`);
        for (const s of mine) {
          if (!(s.name in c.args)) steps.push(LEFT_OUT);
          else value(prefix + s.name, c.args[s.name]!, c.fn === "form" && FORM_ARGS.has(s.name) ? (v) => shownAt(input, e.request.length, c, s.name as "form" | "to", v) : cards && c.fn === "form" ? (v) => optionAt(input, lineOf(shownForms, said(c.args.form), said(c.args.to)), s.name, v) : undefined);
        }
        return;
      }
      const fixed = fixedArgs(c.fn);
      // Each argument's steps, then the arguments in the order asked for. By name unless told otherwise; `said`:
      // what the request doesn't spell first, by name, then each by where its value first stands.
      const parts: { name: string; from: number; long: boolean; steps: Step[] }[] = [];
      for (const k of Object.keys(c.args).sort()) {
        const before = steps.length;
        if (!fixed || fixed.has(k)) steps.push(`arg:${k}`);
        else {
          // A form's own field: its name is a span of the form as shown, in the line of the form being filled.
          const at = fieldAt(input, e.request.length, c, k);
          if (!at) throw new NotEncodable(`the field ${k} is in no form shown`);
          steps.push(["field", at[0], at[1]]);
        }
        value(prefix + k, c.args[k]!, c.fn === "form" && FORM_ARGS.has(k) ? (v) => shownAt(input, e.request.length, c, k as "form" | "to", v) : undefined);
        const mine = steps.splice(before);
        // (Where the request says a value: a place in the forms shown is not one.)
        const said = mine.filter((x): x is Pointer => typeof x !== "string" && x[0] !== "field" && x[1] < e.request.length).map((x) => x[1]);
        const long = mine.some((x) => typeof x !== "string" && x[0] === "text" && x[2] - x[1] >= LONG);
        parts.push({ name: k, from: said.length ? Math.min(...said) : -1, long, steps: mine });
      }
      if (order === "said") parts.sort((a, b) => a.from - b.from || (a.name < b.name ? -1 : 1));
      if (order === "text_last") parts.sort((a, b) => Number(a.long) - Number(b.long) || (a.name < b.name ? -1 : 1));
      for (const part of parts) steps.push(...part.steps);
      steps.push(")");
    };
    if (slots) {
      // Whether the line's result is named for a later line to use: a decision of every line but the last.
      if (i < p.lines.length - 1) steps.push(line.bind ? `bind:${line.bind}` : LEFT_OUT);
      else if (line.bind) throw new NotEncodable("the last line's result is named, and nothing can use it");
    } else if (line.bind) steps.push(`bind:${line.bind}`);
    call(line.call, "");
  });
  if (!slots) steps.push("eos");
  return { input, steps };
}

// ---------------------------------------------------------------- Slot by slot (`slots`, 2026-10-10)
//
// The decisions of a program, in order, and what each may be:
//   1. the kind of answer: a refusal (`none:<label>`, and that is the whole answer) or `program`;
//   2. how many lines it has: `lines:N`, N from 1 to the most any training example has;
//   then for each line:
//   3. unless it is the last, whether its result is named for a later line: `bind:<name>` or `-`;
//   4. its function: `fn:<name>`;
//   5. each slot of the function, once, in this order: for a form, `form`, `to`, then every field of that form in the
//      order its line as shown lists them (the line whose name, or record id, is the value just given to `form`: of
//      several, the one that goes to the office just given to `to`); for any other function, every argument the
//      contract allows it, in the contract's own order (contracts/calls.schema.json). A slot is left out (`-`), or
//      takes a value: a choice from the closed set (`const:…`, a name bound on an earlier line `var:…`), a copied span
//      (`id`, `text`, `word`), a call of its own (`fn:…`, then that function's slots), or a list or data (`[` … `]`,
//      `{` `key:…` … `}`: of copied texts and closed-set values, closed by a decision as before).
// A call has ended when its slots are decided, and a program when its lines are: nothing closes a call or ends a
// program, so neither can be closed early. A slot the contract requires (a function's required arguments; which form
// a form is) cannot be left out. A form's own required field can: a request may not give it, the label then leaves it
// out, and so may an answer, which is then not offered as a draft but told back with which fields the form still
// lacks (adapter.ts `formsMisfit`); a value is never made up to fill one. A field the form's line does not list has
// no slot, so it cannot be written. The rule is the same in training and in answering. `decodeSlots` holds an answer to that rule; the model's own decoder (py/slots.py) is the same
// rule in the other language, and the trainer follows every example's label with it before it trains (an example
// the two would read differently is counted, `misfit`, and there must be none).

/** A slot left out. */
export const LEFT_OUT = "-";
/** The answer is a program (the other kinds of answer are the refusals). */
export const PROGRAM = "program";

/** A form as its line shows it: where the line begins in the input, its name, what stands before its fields, and each
 * field with whether it must be filled in and where its name stands. */
export interface FormLine { line: string; head: string; fields: { name: string; required: boolean; at: [number, number] }[] }
/** The forms shown in an input: every line after the first that begins `- ` (the request is the first line). */
export function formsIn(input: string): FormLine[] {
  const out: FormLine[] = [];
  for (let nl = input.indexOf("\n"); nl >= 0; ) {
    const next = input.indexOf("\n", nl + 1), end = next < 0 ? input.length : next;
    let at = nl + 1;
    while (at < end && /\s/.test(input[at]!)) at++;
    const line = input.slice(at, end);
    if (line.startsWith("- ")) {
      const f = line.indexOf(": fields ");
      const fields: FormLine["fields"] = [];
      if (f >= 0) for (const m of line.slice(f + 9).matchAll(/([^\s,()]+) \(([^)]*)\)/g)) fields.push({ name: m[1]!, required: /(^|, )required$/.test(m[2]!), at: [at + f + 9 + m.index!, at + f + 9 + m.index! + m[1]!.length] });
      // (A field named twice on a line is one slot: the first.)
      out.push({ line, head: f < 0 ? line : line.slice(0, f), fields: fields.filter((x, i) => fields.findIndex((y) => y.name === x.name) === i) });
    }
    nl = next;
  }
  return out;
}
/** The line of the form a call fills: the first whose name or record id is `form`; of several, the first that goes to `to`. */
export function lineOf(forms: FormLine[], form: string | undefined, to: string | undefined): FormLine | undefined {
  if (form === undefined) return undefined;
  const mine = forms.filter((f) => f.line.startsWith(`- ${form},`) || f.line.includes(`id ${form}:`));
  return (to === undefined ? undefined : mine.find((f) => f.head.includes(`, to=${to},`) || f.head.endsWith(`, to=${to}`))) ?? mine[0];
}
const said = (v: calls.Value | undefined): string | undefined => (v && "id" in v ? v.id : v && "text" in v ? v.text : undefined);

/** `required`: the contract requires it, and it cannot be left out. `wanted`: a form's field its line marks required. */
export interface Slot { name: string; required: boolean; wanted?: boolean; field?: [number, number] }
/** A call's slots, in order. A form's are known once `form` and `to` are (pass them; without them, its own two). */
export function slotsOf(fn: string, forms: FormLine[], form?: string, to?: string, own?: Grammar): Slot[] {
  const a = calls.ARGS[fn];
  if (!a) throw new NotEncodable(`${fn} is no function`);
  // (A model decides the slots it was taught, in the order it was taught them: its own `grammar` (config.json) where
  // it is given, as the contract had them when it was trained. An argument the contract gained since is a slot the
  // model does not have: 2026-10-14, `money.line`.)
  if (fn !== "form") return (own?.[fn]?.args ?? [...(a.allowed ?? [])]).map((name) => ({ name, required: (own?.[fn]?.required ?? a.required).includes(name) }));
  return [{ name: "form", required: true }, { name: "to", required: false }, ...(lineOf(forms, form, to)?.fields ?? []).filter((f) => !FORM_ARGS.has(f.name)).map((f) => ({ name: f.name, required: false, wanted: f.required, field: f.at }))];
}

/** What the contract gives a model's decoder: each function's slots in order and which must be filled (a form's own
 * two; its fields come from its line). Kept with the export and with the model (config.json `grammar`). */
export type Grammar = { [fn: string]: { args: string[]; required: string[] } };
export const grammar = (): Grammar =>
  Object.fromEntries(Object.entries(calls.ARGS).map(([fn, a]) => [fn, fn === "form" ? { args: ["form", "to"], required: ["form"] } : { args: [...(a.allowed ?? [])], required: a.required.filter((k) => a.allowed?.has(k)) }]));

/** The program a run of slot decisions comes to. Throws on decisions no program is made of: too few or too many, one
 * that is not allowed where it stands (an argument the contract requires left out, a name used before it is bound, a
 * pointer where a choice is wanted). `lacks`: given a list, every required field of a form that was left out is added
 * to it (104 training labels leave one out, because the request does not give it). */
export function decodeSlots(input: string, steps: Step[], o: { lacks?: { form: string; field: string }[]; /** The slots of the model that answered (its config.json `grammar`); the contract's now where absent. */ grammar?: Grammar } = {}): string {
  let at = 0;
  const next = (): Step => {
    if (at >= steps.length) throw new NotEncodable("the decisions end early");
    return steps[at++]!;
  };
  const choice = (what: string, prefix: string): string => {
    const s = next();
    if (typeof s !== "string" || !s.startsWith(prefix)) throw new NotEncodable(`${what} was expected`);
    return s.slice(prefix.length);
  };
  const first = next();
  if (typeof first === "string" && first.startsWith("none:")) {
    if (at < steps.length) throw new NotEncodable("decisions after a refusal");
    return `none(${first.slice(5)})`;
  }
  if (first !== PROGRAM) throw new NotEncodable("the kind of answer was expected");
  const n = Number(choice("the number of lines", "lines:"));
  if (!Number.isInteger(n) || n < 1) throw new NotEncodable("the number of lines is no number");
  const forms = formsIn(input);
  const bound = new Set<string>();
  const data = (s: Step): unknown => {
    if (s === "[") {
      const xs: unknown[] = [];
      for (let x = next(); x !== "]"; x = next()) xs.push(data(x));
      return xs;
    }
    if (s === "{") {
      const obj: { [k: string]: unknown } = {};
      for (let k = next(); k !== "}"; k = next()) {
        if (typeof k !== "string" || !k.startsWith("key:")) throw new NotEncodable("a key was expected");
        obj[k.slice(4)] = data(next());
      }
      return obj;
    }
    if (typeof s === "string") {
      if (s.startsWith("const:")) return s[6] === "\"" ? JSON.parse(s.slice(6)) : s.slice(6);
      throw new NotEncodable(`${s} is no value`);
    }
    if (s[0] !== "text") throw new NotEncodable("in a list or data a copy is a text");
    return input.slice(s[1], s[2]);
  };
  const value = (s: Step): calls.Value => {
    if (typeof s !== "string") {
      if (s[0] === "field") throw new NotEncodable("a field's name is no value");
      const text = input.slice(s[1], s[2]);
      return s[0] === "text" ? { text } : { id: s[0] === "word" ? asWord(text) : text };
    }
    if (s.startsWith("var:")) {
      if (!bound.has(s.slice(4))) throw new NotEncodable(`${s.slice(4)} is used before it is bound`);
      return { var: s.slice(4) };
    }
    if (s.startsWith("const:")) return s[6] === "\"" ? { text: JSON.parse(s.slice(6)) as string } : { id: s.slice(6) };
    if (s.startsWith("fn:")) return { call: call(s.slice(3)) };
    if (s === "[" || s === "{") return { json: data(s) };
    throw new NotEncodable(`${s} is no value`);
  };
  const call = (fn: string): calls.Call => {
    const args: { [k: string]: calls.Value } = {};
    const fill = (slot: Slot) => {
      const s = next();
      if (s !== LEFT_OUT) args[slot.name] = value(s);
      else if (slot.required) throw new NotEncodable(`${fn} needs ${slot.name}: it cannot be left out`);
      else if (slot.wanted) o.lacks?.push({ form: said(args.form) ?? "", field: slot.name });
    };
    if (fn === "form") {
      const own = slotsOf(fn, forms);
      own.forEach(fill);
      slotsOf(fn, forms, said(args.form), said(args.to)).slice(own.length).forEach(fill);
    } else slotsOf(fn, forms, undefined, undefined, o.grammar).forEach(fill);
    return { fn: fn as calls.Fn, args };
  };
  const lines: calls.Line[] = [];
  for (let i = 0; i < n; i++) {
    let bind: string | undefined;
    if (i < n - 1) {
      const b = next();
      if (b !== LEFT_OUT) {
        if (typeof b !== "string" || !b.startsWith("bind:") || bound.has(b.slice(5))) throw new NotEncodable("a name for the line's result, or none, was expected");
        bind = b.slice(5);
      }
    }
    const c = call(choice("a function", "fn:"));
    if (bind) bound.add(bind);
    lines.push(bind ? { bind, call: c } : { call: c });
  }
  if (at < steps.length) throw new NotEncodable("decisions after the last line");
  return calls.programText({ lines });
}

/** The program a model's decisions come to, in the decoding it was trained in. */
export const programFrom = (input: string, steps: Step[], decoding: Decoding = "steps", grammar?: Grammar): string => (decoding === "slots" || decoding === "cards" ? decodeSlots(input, steps, { grammar }) : decode(input, steps));

// ---------------------------------------------------------------- Read twice (`cards`, translator v3, 2026-10-25)
//
// The same decisions as slot by slot, made in two passes of one model over two shorter inputs
// (docs/design/translator-v3.md, section 1):
//   1. choose: the request, then each form the person knows of as its head and its fields' names only
//      (`- name, to=office, id record: has a, b, c`). Every decision of slot by slot except a form's fields: which
//      form is pointed at among the heads, and the office it goes to; the fields wait.
//   2. fill, once for each form the choose pass wrote, in the order it wrote them: the request, then that form's line
//      in full (types, options, which are required), then, where earlier lines named their results, `Named before: a,
//      b`. The decisions are that form's fields, in its line's order, as slot by slot has them.
// The two passes' decisions put together (`joinCards`) are slot by slot's over the whole input (request and full lines),
// so the program is read from them exactly as before (`decodeSlots`), and so is every check of a draft against its
// form. A form is never a choice of the closed set: it is pointed at, so a form no example had can be chosen, and
// filled from what its line says. The model's decoder (py/slots.py, `Machine` with a mode; py/predict.py) is the same
// rule in Python.

/** What the choose pass is shown of a form: its head, then its fields' names. */
export function chooseLine(line: string): string {
  const f = line.indexOf(": fields ");
  if (f < 0) return line;
  const names = [...line.slice(f + 9).matchAll(/([^\s,()]+) \(([^)]*)\)/g)].map((m) => m[1]!);
  return `${line.slice(0, f)}: has ${[...new Set(names)].join(", ")}`;
}
export const NAMED_BEFORE = "Named before: ";
/** The choose pass's input. */
export const chooseInput = (request: string, forms: string[]): string => inputOf(request, forms.map(chooseLine));
/** The fill pass's input for one form: the request, the form's line in full, the names earlier lines gave their results. */
export const fillInput = (request: string, line: string, bound: string[]): string => [request, line, ...(bound.length ? [NAMED_BEFORE + bound.join(", ")] : [])].join("\n");

/** Where an option of a form's field stands in its line as shown (`b (one of x | y, required)`): of `value`, exactly. */
function optionAt(input: string, line: FormLine | undefined, field: string, value: string): [number, number] | undefined {
  const f = line?.fields.find((x) => x.name === field);
  if (!f || input.slice(f.at[1], f.at[1] + 2) !== " (") return undefined;
  const open = f.at[1] + 2, close = input.indexOf(")", open);
  const inner = input.slice(open, close);
  if (!inner.startsWith("one of ")) return undefined;
  let at = open + 7;
  for (const opt of inner.slice(7).replace(/, required$/, "").split(" | ")) {
    if (opt === value) return [at, at + opt.length];
    at += opt.length + 3;
  }
  return undefined;
}

/** Each decision of a run of slot decisions, tagged with the form call whose fields it is part of (-1: none), and each
 * form call met, in order: its form and office, the names bound by the lines before its own, and the index just after
 * its `to` decision (where its fields begin). `mode`: `full` (slot by slot over the whole input), `choose` (a form's
 * fields are not decided), `fill` (the decisions are the fields of the one form shown, with what earlier lines named). */
export function walkSlots(input: string, steps: Step[], mode: "full" | "choose" | "fill", grammar?: Grammar): { tags: number[]; forms: { form?: string; to?: string; bound: string[]; after: number }[] } {
  let at = 0;
  const tags: number[] = [];
  const forms: { form?: string; to?: string; bound: string[]; after: number }[] = [];
  let owner = -1;
  const next = (): Step => {
    if (at >= steps.length) throw new NotEncodable("the decisions end early");
    tags.push(owner);
    return steps[at++]!;
  };
  const shown = formsIn(input);
  const bound: string[] = [];
  const text = (s: Step): string | undefined => (typeof s === "string" ? (s.startsWith("const:") ? (s[6] === "\"" ? JSON.parse(s.slice(6)) : s.slice(6)) : undefined) : s[0] === "word" ? asWord(input.slice(s[1], s[2])) : input.slice(s[1], s[2]));
  const data = (s: Step): void => {
    if (s === "[") { for (let x = next(); x !== "]"; x = next()) data(x); }
    else if (s === "{") { for (let k = next(); k !== "}"; k = next()) data(next()); }
  };
  const value = (s: Step): string | undefined => {
    if (typeof s === "string") {
      if (s.startsWith("fn:")) call(s.slice(3));
      else if (s === "[" || s === "{") data(s);
      else if (s.startsWith("const:")) return text(s);
      return undefined;
    }
    return text(s);
  };
  const fields = (line: FormLine | undefined) => {
    for (const f of line?.fields ?? []) if (!FORM_ARGS.has(f.name)) { const s = next(); if (s !== LEFT_OUT) value(s); }
  };
  const call = (fn: string) => {
    if (fn === "form") {
      const fs = next();
      const form = fs === LEFT_OUT ? undefined : value(fs);
      const ts = next();
      const to = ts === LEFT_OUT ? undefined : value(ts);
      const k = forms.push({ form, to, bound: [...bound], after: at }) - 1;
      if (mode === "fill" || owner >= 0) throw new NotEncodable("a form within a form's field");
      if (mode === "full") {
        owner = k;
        fields(lineOf(shown, form, to));
        owner = -1;
      }
      return;
    }
    for (const _ of slotsOf(fn, shown, undefined, undefined, grammar)) { const s = next(); if (s !== LEFT_OUT) value(s); }
  };
  if (mode === "fill") {
    // (Which names earlier lines gave their results: the fill input's last line, where there is one.)
    fields(shown[0]);
    if (at < steps.length) throw new NotEncodable("decisions after the form's last field");
    return { tags, forms };
  }
  const first = next();
  if (typeof first === "string" && first.startsWith("none:")) return { tags, forms };
  if (first !== PROGRAM) throw new NotEncodable("the kind of answer was expected");
  const lines = next();
  const n = typeof lines === "string" && lines.startsWith("lines:") ? Number(lines.slice(6)) : NaN;
  if (!Number.isInteger(n) || n < 1) throw new NotEncodable("the number of lines is no number");
  for (let i = 0; i < n; i++) {
    let name: string | undefined;
    if (i < n - 1) { const b = next(); if (typeof b === "string" && b.startsWith("bind:")) name = b.slice(5); }
    const f = next();
    if (typeof f !== "string" || !f.startsWith("fn:")) throw new NotEncodable("a function was expected");
    call(f.slice(3));
    if (name) bound.push(name);
  }
  if (at < steps.length) throw new NotEncodable("decisions after the last line");
  return { tags, forms };
}

/** Where each line of an input begins, in characters (the request's first). */
const lineStarts = (input: string): number[] => {
  const out = [0];
  for (let at = input.indexOf("\n"); at >= 0; at = input.indexOf("\n", at + 1)) out.push(at + 1);
  return out;
};

/** Moves a pointer from one input to another: a place in the request stays where it is (both begin with it); a place in
 * line `from` (of the forms) moves to line `to` of the other, at the same distance from its start, if it stays within
 * `room` characters of that line. Else undefined. */
function moved(p: Pointer, request: number, a: number[], b: number[], line: (start: number) => number | undefined, room: (i: number) => number): Pointer | undefined {
  if (p[2] <= request) return p;
  const i = a.findIndex((s, k) => k > 0 && p[1] >= s && (k + 1 >= a.length || p[2] < a[k + 1]!));
  if (i < 1) return undefined;
  const j = line(i);
  if (j === undefined || p[2] - a[i]! > room(i)) return undefined;
  return [p[0], p[1] - a[i]! + b[j]!, p[2] - a[i]! + b[j]!];
}

export interface Fill extends Encoded { /** which form line of the whole input it fills (0: the first form) */ form: number; bound: string[] }
/** Slot by slot's decisions over the whole input, as the choose pass's and each fill pass's (`cards`). Throws
 * NotEncodable where a decision cannot be made in its pass (a form's field pointing into another form's line, a choice
 * pointing into a form's fields, a form inside a form's field). */
export function splitCards(request: string, forms: string[], steps: Step[], grammar?: Grammar): { choose: Encoded; fills: Fill[] } {
  const whole = inputOf(request, forms);
  const { tags, forms: met } = walkSlots(whole, steps, "full", grammar);
  const shown = formsIn(whole);
  const wa = lineStarts(whole);
  const choose = chooseInput(request, forms);
  const ca = lineStarts(choose);
  const heads = forms.map((l) => (l.indexOf(": fields ") < 0 ? l.length : l.indexOf(": fields ")));
  const chooseSteps: Step[] = [];
  steps.forEach((s, i) => {
    if (tags[i]! >= 0) return;
    if (typeof s === "string") return void chooseSteps.push(s);
    const m = moved(s, request.length, wa, ca, (k) => k, (k) => heads[k - 1]!);
    if (!m) throw new NotEncodable("a choice points into a form's fields");
    chooseSteps.push(m);
  });
  const fills: Fill[] = met.map((f, k) => {
    const mine = lineOf(shown, f.form, f.to);
    const index = mine ? shown.indexOf(mine) : -1;
    if (index < 0) throw new NotEncodable(`the form ${f.form} is not one shown`);
    const input = fillInput(request, forms[index]!, f.bound);
    const fa = lineStarts(input);
    const own: Step[] = [];
    steps.forEach((s, i) => {
      if (tags[i] !== k) return;
      if (typeof s === "string") return void own.push(s);
      const m = moved(s, request.length, wa, fa, (line) => (line === index + 1 ? 1 : undefined), () => forms[index]!.length);
      if (!m) throw new NotEncodable("a field points into another form's line");
      own.push(m);
    });
    return { input, steps: own, form: index, bound: f.bound };
  });
  return { choose: { input: choose, steps: chooseSteps }, fills };
}

/** The two passes' decisions as slot by slot's over the whole input: each fill pass's after its form's `to` decision,
 * every pointer moved back to where it stands in the whole input. */
export function joinCards(request: string, forms: string[], choose: Step[], fills: Step[][], grammar?: Grammar): Step[] {
  const whole = inputOf(request, forms);
  const wa = lineStarts(whole);
  const ci = chooseInput(request, forms);
  const ca = lineStarts(ci);
  const heads = forms.map((l) => (l.indexOf(": fields ") < 0 ? l.length : l.indexOf(": fields ")));
  const met = walkSlots(ci, choose, "choose", grammar).forms;
  if (met.length !== fills.length) throw new NotEncodable("a fill for each form chosen was expected");
  const shown = formsIn(whole);
  const back = (s: Step, from: number[], line: (k: number) => number | undefined, room: (k: number) => number): Step => {
    if (typeof s === "string") return s;
    const m = moved(s, request.length, from, wa, line, room);
    if (!m) throw new NotEncodable("a place in no line");
    return m;
  };
  const out: Step[] = [];
  let k = 0;
  choose.forEach((s, i) => {
    out.push(back(s, ca, (x) => x, (x) => heads[x - 1]!));
    while (k < met.length && met[k]!.after === i + 1) {
      const mine = lineOf(shown, met[k]!.form, met[k]!.to);
      const index = mine ? shown.indexOf(mine) : -1;
      const fa = lineStarts(fillInput(request, index < 0 ? "" : forms[index]!, met[k]!.bound));
      for (const f of fills[k]!) out.push(back(f, fa, (line) => (line === 1 && index >= 0 ? index + 1 : undefined), () => (index < 0 ? 0 : forms[index]!.length)));
      k++;
    }
  });
  return out;
}

/** The lines of the forms shown, each with where it begins in the input. */
function formLines(input: string, from: number): [number, string][] {
  const lines: [number, string][] = [];
  for (let at = from + 1; at <= input.length; ) {
    const end = input.indexOf("\n", at) < 0 ? input.length : input.indexOf("\n", at);
    lines.push([at, input.slice(at, end)]);
    at = end + 1;
  }
  return lines;
}

/** Where a form's own name, or the office it goes to, stands in the forms shown (`- name, to=office, id record: fields
 * ...`): the name at the head of its line; the office after `to=` in the line of the form the call fills. */
function shownAt(input: string, from: number, c: calls.Call, arg: "form" | "to", value: string): [number, number] | undefined {
  const lines = formLines(input, from);
  if (arg === "form") {
    const mine = lines.find(([, l]) => l.startsWith(`- ${value},`));
    return mine ? [mine[0] + 2, mine[0] + 2 + value.length] : undefined;
  }
  const named = c.args.form && ("id" in c.args.form ? c.args.form.id : "text" in c.args.form ? c.args.form.text : undefined);
  for (const [at, l] of [...lines.filter(([, l]) => named !== undefined && l.startsWith(`- ${named},`)), ...lines]) {
    const head = l.indexOf(": fields ") < 0 ? l : l.slice(0, l.indexOf(": fields "));
    const i = head.indexOf(`, to=${value},`);
    if (i >= 0) return [at + i + 5, at + i + 5 + value.length];
  }
  return undefined;
}

/** Where a form's field is named in the forms shown: in the line of the form the call fills, if it can be told. */
function fieldAt(input: string, from: number, c: calls.Call, field: string): [number, number] | undefined {
  const named = c.args.form && ("id" in c.args.form ? c.args.form.id : "text" in c.args.form ? c.args.form.text : undefined);
  const lines = formLines(input, from);
  const mine = lines.filter(([, l]) => named !== undefined && (l.startsWith(`- ${named},`) || l.includes(`id ${named}:`)));
  for (const [at, l] of [...mine, ...lines]) {
    const fields = l.indexOf(": fields ");
    if (fields < 0) continue;
    const m = new RegExp(`(?:fields |, )(${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}) \\(`).exec(l.slice(fields + 2));
    if (m) return [at + fields + 2 + m.index + m[0].indexOf(m[1]!), at + fields + 2 + m.index + m[0].indexOf(m[1]!) + field.length];
  }
  return undefined;
}

/** The program a run of steps comes to, over the input they point into. Throws on steps no program is made of. */
export function decode(input: string, steps: Step[]): string {
  let at = 0;
  const next = (): Step => {
    if (at >= steps.length) throw new NotEncodable("the steps end early");
    return steps[at++]!;
  };
  const first = next();
  if (typeof first === "string" && first.startsWith("none:")) return `none(${first.slice(5)})`;
  at = 0;
  const pointed = (s: Pointer): calls.Value => {
    const said = input.slice(s[1], s[2]);
    return s[0] === "text" ? { text: said } : { id: s[0] === "word" ? asWord(said) : said };
  };
  const data = (s: Step): unknown => {
    if (s === "[") {
      const xs: unknown[] = [];
      for (let x = next(); x !== "]"; x = next()) xs.push(data(x));
      return xs;
    }
    if (s === "{") {
      const o: { [k: string]: unknown } = {};
      for (let k = next(); k !== "}"; k = next()) {
        if (typeof k !== "string" || !k.startsWith("key:")) throw new NotEncodable("a key was expected");
        o[k.slice(4)] = data(next());
      }
      return o;
    }
    if (typeof s === "string") {
      if (s.startsWith("const:")) return s[6] === "\"" ? JSON.parse(s.slice(6)) : s.slice(6);
      throw new NotEncodable(`${s} is no value`);
    }
    return input.slice(s[1], s[2]);
  };
  const value = (s: Step): calls.Value => {
    if (typeof s !== "string") return pointed(s);
    if (s.startsWith("var:")) return { var: s.slice(4) };
    if (s.startsWith("const:")) return s[6] === "\"" ? { text: JSON.parse(s.slice(6)) as string } : { id: s.slice(6) };
    if (s.startsWith("fn:")) return { call: call(s) };
    if (s === "[" || s === "{") return { json: data(s) };
    throw new NotEncodable(`${s} is no value`);
  };
  const call = (s: Step): calls.Call => {
    if (typeof s !== "string" || !s.startsWith("fn:")) throw new NotEncodable("a function was expected");
    const args: { [k: string]: calls.Value } = {};
    for (let k = next(); k !== ")"; k = next()) {
      const name = typeof k === "string" ? (k.startsWith("arg:") ? k.slice(4) : undefined) : k[0] === "field" ? input.slice(k[1], k[2]) : undefined;
      if (name === undefined) throw new NotEncodable("an argument was expected");
      args[name] = value(next());
    }
    return { fn: s.slice(3) as calls.Fn, args };
  };
  const lines: calls.Line[] = [];
  for (let s = next(); s !== "eos"; s = next()) {
    if (typeof s === "string" && s.startsWith("bind:")) lines.push({ bind: s.slice(5), call: call(next()) });
    else lines.push({ call: call(s) });
  }
  return calls.programText({ lines });
}

/** Every choice the steps of these examples make: the closed set a model chooses from, in a fixed order. */
export function vocabulary(all: Encoded[]): string[] {
  const seen = new Set<string>();
  for (const e of all) for (const s of e.steps) if (typeof s === "string") seen.add(s);
  return [...seen].sort();
}
