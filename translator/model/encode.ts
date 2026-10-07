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
/** A choice from the closed set (`vocabulary`), or a span. */
export type Step = string | Pointer;

export interface Encoded { input: string; steps: Step[] }
export interface Span { arg: string; value: string; how: "copy" | "choice" | "implied"; at?: [number, number]; line?: number }

/** What the model is shown: the request, then each form the person knows of on a line of its own. */
export const inputOf = (request: string, forms: string[]): string => [request, ...forms].join("\n");

/** A span's words as one word: what a `word` pointer comes to. */
export const asWord = (s: string): string => s.trim().toLowerCase().replace(/^the\s+/, "").replace(/[\s-]+/g, "_");

export class NotEncodable extends Error {}

/** The order a call's arguments are written in: as the request says them (`said`), or by name (`name`: how the
 * models before data-11 were trained; a model answers either way, the steps say which argument each is). */
export const ORDER: "said" | "name" = process.env.OIKOS_ENCODE_ORDER === "name" ? "name" : "said";

/** The arguments a function has by name. A form’s are its two own (which form, and to whom): every other is a field
 * of the form being filled in, known only from the form as shown, so it is pointed at, never chosen from a list. */
const FORM_ARGS = new Set(["form", "to"]);
const fixedArgs = (fn: string): Set<string> | undefined => (fn === "form" ? FORM_ARGS : calls.ARGS[fn]?.allowed);

/** The steps of an example's program. Throws NotEncodable where a value is neither a span nor marked implied. */
export function encode(e: { request: string; forms: string[]; program: string; spans?: Span[] }): Encoded {
  const input = inputOf(e.request, e.forms);
  const p = calls.parseProgram(e.program);
  if ("none" in p) return { input, steps: [`none:${p.none}`, "eos"] };
  const steps: Step[] = [];
  const several = p.lines.length > 1;
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
    const scalar = (path: string, value: string, quoted: boolean) => {
      const s = take(path, value);
      if (s.how === "implied") return void steps.push(`const:${quoted ? JSON.stringify(value) : value}`);
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
    const value = (path: string, v: calls.Value) => {
      if ("var" in v) steps.push(`var:${v.var}`);
      else if ("id" in v) scalar(path, v.id, false);
      else if ("text" in v) scalar(path, v.text, true);
      else if ("call" in v) call(v.call, `${path}.`);
      else data(path, v.json);
    };
    const call = (c: calls.Call, prefix: string) => {
      steps.push(`fn:${c.fn}`);
      const fixed = fixedArgs(c.fn);
      // Each argument's steps, then the arguments in the order the request says them (ORDER): what the request
      // doesn't spell first, by name; then each by where its value first stands. The writer then goes through the
      // request once, and closing the call is what follows the last thing said, not a count kept by name.
      const parts: { name: string; from: number; steps: Step[] }[] = [];
      for (const k of Object.keys(c.args).sort()) {
        const before = steps.length;
        if (!fixed || fixed.has(k)) steps.push(`arg:${k}`);
        else {
          // A form's own field: its name is a span of the form as shown, in the line of the form being filled.
          const at = fieldAt(input, e.request.length, c, k);
          if (!at) throw new NotEncodable(`the field ${k} is in no form shown`);
          steps.push(["field", at[0], at[1]]);
        }
        value(prefix + k, c.args[k]!);
        const mine = steps.splice(before);
        const said = mine.filter((x): x is Pointer => typeof x !== "string" && x[0] !== "field").map((x) => x[1]);
        parts.push({ name: k, from: said.length ? Math.min(...said) : -1, steps: mine });
      }
      if (ORDER === "said") parts.sort((a, b) => a.from - b.from || (a.name < b.name ? -1 : 1));
      for (const part of parts) steps.push(...part.steps);
      steps.push(")");
    };
    if (line.bind) steps.push(`bind:${line.bind}`);
    call(line.call, "");
  });
  steps.push("eos");
  return { input, steps };
}

/** Where a form's field is named in the forms shown: in the line of the form the call fills, if it can be told. */
function fieldAt(input: string, from: number, c: calls.Call, field: string): [number, number] | undefined {
  const named = c.args.form && ("id" in c.args.form ? c.args.form.id : "text" in c.args.form ? c.args.form.text : undefined);
  const lines: [number, string][] = [];
  for (let at = from + 1; at <= input.length; ) {
    const end = input.indexOf("\n", at) < 0 ? input.length : input.indexOf("\n", at);
    lines.push([at, input.slice(at, end)]);
    at = end + 1;
  }
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
