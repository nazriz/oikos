// A trained model that decides and copies, behind the adapter every translator model sits behind: the evaluation and
// a run call it as they call any other (`--model decide/<name>`: the model in $OIKOS_TRANSLATOR_MODELS/<name>, by
// default runs/translator-model/<name>). It reads the request and the forms out of what the translator would send a
// language model, and answers with a program. Below `threshold` of sureness it asks back: none(unclear).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LlmAdapter, LlmRequest, LlmResponse } from "@oikos/participants/llm";
import { calls } from "@oikos/participants";
import { inputOf, programFrom, type Decoding } from "./encode";
import { pieces } from "./export";

const HERE = import.meta.dir;

/** The request and the forms, from the translator's words to a model (translatorContext, translator/src/index.ts). */
export function shown(text: string): { request: string; forms: string[] } {
  const marker = "\n\nForms this person knows of:\n";
  const at = text.indexOf(marker);
  const head = at < 0 ? text : text.slice(0, at);
  const request = head.startsWith("Request: ") ? head.slice(9) : head;
  return { request, forms: at < 0 ? [] : text.slice(at + marker.length).split("\n").filter((l) => l.startsWith("- ")) };
}

/** The program a model's steps come to (a span as its first and last piece), or to ask back where no program is
 * made of them: steps that don't parse, a span of no piece (a reader with tokens of its own can point at a mark
 * that is none of the input), or a program that is not in the call language as it stands (a model trained on another
 * version of the language may hold a label or an argument this one doesn't have: its closed set is its own, kept with
 * it in config.json). The steps are read in the decoding the model was trained in (`decodingOf` its folder): slot by
 * slot, decisions that break the slots' rule (a required slot left out, too few or too many) are no program either. */
export function programOf(input: string, ps: { at: [number, number] }[], steps: (string | [string, number, number])[], decoding: Decoding = "steps"): string {
  try {
    const program = programFrom(input, steps.map((s) => {
      if (typeof s === "string") return s;
      const a = ps[s[1]], z = ps[s[2]];
      if (!a || !z || z.at[1] <= a.at[0]) throw new Error("a span of no piece");
      return [s[0] as "id", a.at[0], z.at[1]];
    }), decoding);
    // (A function or an argument the language doesn't have. An argument left out is not that: whoever resolves the
    // call asks for it.)
    if (calls.contractErrors(calls.parseProgram(program)).some((e) => !/ needs [a-z_]+$/.test(e))) throw new Error("not in the call language");
    return program;
  } catch {
    return "none(unclear)";
  }
}

/**
 * Choices added to the call language after models had been trained without them, each with what it says. A model's
 * closed set of choices is its own (config.json's `vocabulary`, made from the data it was trained on: export.ts), so
 * a model trained before one of these loads and answers as it always did, and can never answer with it: a request
 * that needs one gets the nearest thing the model was taught (before 2026-10-08 a request to hold something was
 * taught as none(no_such_act), as was a record named only by describing it). Nothing here changes an answer; it is
 * said so that whoever runs or scores such a model knows. Retraining on data made with the pipeline at 0.11.0 or
 * later (translator/train/data.ts) gives a model all of them.
 */
export const ADDED: [choice: string, what: string][] = [
  ["arg:hold", "a hold on something standing: statement(hold=...) (2026-10-08)"],
  ["const:own", "an entry on one's own file: statement(kind=entry, visible=own, ...) (2026-10-08)"],
  ["none:look_first", "the refusal for what needs something found out first: none(look_first) (2026-10-08)"],
  // (A standing work order, a direction on an office's form and a paper on an office's own form are made of choices
  // an older model already has, but for this one: it can spell them and was never taught when to.)
  ["arg:until", "a standing work order that ends: work(..., every=..., until=...) (2026-10-09); and it was not taught standing work orders (work with every=), directions on an office's form or papers on an office's own form at all"],
];

/** What of `ADDED` a model with this closed set cannot say. */
export const cannotSay = (vocabulary: readonly string[]): [choice: string, what: string][] => ADDED.filter(([choice]) => !vocabulary.includes(choice));

/** A trained model's own closed set, from its folder (undefined where it can't be read: nothing is then known of it).
 * A model that writes slot by slot names no argument by a choice: the arguments it can write are its slots, and
 * they are given here as the choices a model of the other decoding would have for them (`arg:…`). */
export function vocabularyOf(dir: string): string[] | undefined {
  try {
    const file = join(dir, "config.json");
    const c = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    const v = c?.vocabulary;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return undefined;
    return c.decoding === "slots" && Array.isArray(c.slots) ? [...v, ...c.slots.filter((x: unknown) => typeof x === "string" && x.startsWith("arg:"))] : v;
  } catch {
    return undefined;
  }
}

/** The decoding a trained model was trained in, as its folder says (config.json `decoding`): `steps` where it says
 * nothing (every model before 2026-10-10) or can't be read. */
export function decodingOf(dir: string): Decoding {
  try {
    const file = join(dir, "config.json");
    return existsSync(file) && JSON.parse(readFileSync(file, "utf8")).decoding === "slots" ? "slots" : "steps";
  } catch {
    return "steps";
  }
}

/** A form as it is shown (`- name, to=office, id record: fields a (text, required), b (one of x | y), …`): its
 * fields, which must be filled in, and which take one of a few values. */
export function formsShown(forms: string[]): Map<string, { fields: Set<string>; required: string[]; oneOf: Map<string, string[]> }> {
  const out = new Map<string, { fields: Set<string>; required: string[]; oneOf: Map<string, string[]> }>();
  for (const line of forms) {
    const m = /^- ([^,]+), .*?: fields (.*)$/.exec(line);
    if (!m) continue;
    const f = { fields: new Set<string>(), required: [] as string[], oneOf: new Map<string, string[]>() };
    for (const x of m[2]!.matchAll(/([^\s,()]+) \(([^)]*)\)/g)) {
      f.fields.add(x[1]!);
      if (/(^|, )required$/.test(x[2]!)) f.required.push(x[1]!);
      const one = /^one of (.*?)(, required)?$/.exec(x[2]!);
      if (one) f.oneOf.set(x[1]!, one[1]!.split(" | "));
    }
    out.set(m[1]!, f);
  }
  return out;
}

/** What is wrong with a program's forms as against the forms shown, if anything: `unknown_form` where one is none of
 * them by name (the refusal the call language has for that); `unclear` where one fills in a field that isn't its own,
 * leaves a required field out, or gives a field that takes one of a few values something else, with which of those it
 * is (`unsure`, for the participant to be told: translator/src/index.ts `unsureText`). Only what the forms' own lines
 * say: a draft that fails could not be handed in, so nothing is lost by not offering it. (A program with no form, or
 * with no forms shown to check against, has nothing wrong.) */
export type Misfit = { label: "unknown_form" } | { label: "unclear"; unsure?: { kind: "form_field" | "form_needs"; form: string; fields: string[] } | { kind: "form_option"; form: string; field: string } };
export function formsMisfit(program: string, forms: string[]): Misfit | undefined {
  if (!program.includes("form(")) return undefined;
  const shownForms = formsShown(forms);
  if (!shownForms.size) return undefined;
  let p: calls.Program;
  try {
    p = calls.parseProgram(program);
  } catch {
    return { label: "unclear" };
  }
  if ("none" in p) return undefined;
  const said = (v: calls.Value | undefined) => (v && "id" in v ? v.id : v && "text" in v ? v.text : undefined);
  const wrong = (c: calls.Call): Misfit | undefined => {
    for (const v of Object.values(c.args)) {
      const inner = "call" in v ? wrong(v.call) : undefined;
      if (inner) return inner;
    }
    if (c.fn !== "form") return undefined;
    const form = said(c.args.form) ?? "";
    const f = shownForms.get(form);
    if (!f) return { label: "unknown_form" };
    const given = Object.keys(c.args).filter((k) => k !== "form" && k !== "to");
    const strange = given.filter((k) => !f.fields.has(k));
    if (strange.length) return { label: "unclear", unsure: { kind: "form_field", form, fields: strange } };
    for (const k of given) {
      const one = f.oneOf.get(k);
      if (one && !one.includes(said(c.args[k]) ?? "")) return { label: "unclear", unsure: { kind: "form_option", form, field: k } };
    }
    const missing = f.required.filter((k) => !(k in c.args));
    return missing.length ? { label: "unclear", unsure: { kind: "form_needs", form, fields: missing } } : undefined;
  };
  for (const l of p.lines) {
    const w = wrong(l.call);
    if (w) return w;
  }
  return undefined;
}

/** Under this sureness of its whole answer the model asks back (unless told another with OIKOS_DECIDE_THRESHOLD).
 * Low on purpose: a long right answer is many decisions and its sureness their product (pilot 11: a budget form of
 * five amounts, right, at 0.15 to 0.22), and a draft is only an offer. On the real test at 0.1: 144 right, 15 wrong
 * drafts, 21 asked back; at 0.5: 131, 7, 42 (docs/decisions.md, 2026-10-08). */
export const CUT_OFF = 0.1;

export class DecideAdapter implements LlmAdapter {
  provider = "decide";
  private proc?: ChildProcess;
  private waiting: ((line: string) => void)[] = [];
  private buffer = "";
  private queue: Promise<unknown> = Promise.resolve();
  /** Each answer's sureness and time, in the order asked (for whoever measures). */
  answers: { sure: number; ms: number; program: string; steps?: number; parts?: { choices: number; places: number; texts: number; least: number }; unsure?: object }[] = [];
  /** Who was last asked back because the model was unsure (by the participant a draft is for): their next request is
   * drafted however unsure it is. */
  private askedBack = new Set<string>();
  /** What of the call language this model was trained without, and so can never answer with (`ADDED`). */
  readonly cannot: [choice: string, what: string][];
  /** The decoding the model answers in (its folder says). */
  readonly decoding: Decoding;
  constructor(public model: string, private o: { dir?: string; threshold?: number; unchecked?: boolean; quiet?: boolean } = {}) {
    const vocabulary = vocabularyOf(this.dir());
    this.decoding = decodingOf(this.dir());
    this.cannot = vocabulary ? cannotSay(vocabulary) : [];
    if (this.cannot.length && !o.quiet) console.error(`decide/${model} was trained before these were in the call language and cannot answer with them: ${this.cannot.map(([, what]) => what).join("; ")}. A request for one gets what the model was taught then. Retrain to add them.`);
  }

  private dir(): string {
    return this.o.dir ?? join(process.env.OIKOS_TRANSLATOR_MODELS ?? resolve(HERE, "../../runs/translator-model"), this.model);
  }

  private start(): void {
    const dir = this.dir();
    const proc = (this.proc = spawn("uv", ["run", "--project", join(HERE, "py"), "python", join(HERE, "py/predict.py"), dir], { stdio: ["pipe", "pipe", "inherit"] }));
    proc.stdout!.on("data", (d: Buffer) => {
      this.buffer += d.toString();
      for (let nl = this.buffer.indexOf("\n"); nl >= 0; nl = this.buffer.indexOf("\n")) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        this.waiting.shift()?.(line);
        if (!this.waiting.length) this.hold(false);
      }
    });
    this.waiting.push(() => {}); // the line that says it is ready
  }

  /** While an answer is awaited the model’s process keeps this one alive; between answers it doesn’t, so whoever
   * has finished asking can end with the model still loaded. */
  private hold(on: boolean): void {
    for (const x of [this.proc, this.proc?.stdout, this.proc?.stdin] as any[]) (on ? x?.ref : x?.unref)?.call(x);
  }

  private ask(o: object): Promise<any> {
    const next = this.queue.then(() => new Promise<any>((done) => {
      if (!this.proc) this.start();
      this.waiting.push((line) => done(JSON.parse(line)));
      this.hold(true);
      this.proc!.stdin!.write(JSON.stringify(o) + "\n");
    }));
    this.queue = next.catch(() => {});
    return next;
  }

  /** The program for a request and the forms known, and how sure the model is. */
  async translate(request: string, forms: string[], o: { draft?: boolean } = {}): Promise<{ program: string; sure: number; ms: number; unsure?: object; asked?: boolean }> {
    const input = inputOf(request, forms);
    const ps = pieces(input);
    const breaks: number[] = [];
    for (let at = input.indexOf("\n"); at >= 0; at = input.indexOf("\n", at + 1)) breaks.push(ps.findIndex((p) => p.at[0] > at));
    // Where each piece stands goes too: a model whose reader has tokens of its own reads the input by them, and
    // answers in pieces as every model does.
    const a = await this.ask({ pieces: ps.map((p) => p.text), breaks, at: ps.map((p) => p.at) });
    let program = programOf(input, ps, a.steps, this.decoding);
    // What was unclear, where it asks back: the part of its answer it was least sure of (what to do, which thing is
    // meant, or which words are to be copied), or what about a form doesn't fit the form as shown.
    let unsure: object | undefined;
    let asked = false;
    if (!o.draft && a.sure < (this.o.threshold ?? CUT_OFF)) {
      asked = true;
      const least = a.parts ? (["choices", "places", "texts"] as const).reduce((x, y) => (a.parts[y] < a.parts[x] ? y : x)) : "choices";
      program = "none(unclear)";
      unsure = { kind: least === "places" ? "which" : least === "texts" ? "words" : "act" };
    }
    // (A form that can't be one of the forms shown is not offered, however sure the model is.)
    const misfit = this.o.unchecked ? undefined : formsMisfit(program, forms);
    if (misfit) {
      program = `none(${misfit.label})`;
      unsure = misfit.label === "unclear" ? misfit.unsure : undefined;
    }
    this.answers.push({ sure: a.sure, ms: a.ms, program, steps: a.steps.length, ...(a.parts ? { parts: a.parts } : {}), ...(unsure ? { unsure } : {}) });
    return { program, sure: a.sure, ms: a.ms, ...(unsure ? { unsure } : {}), ...(asked ? { asked } : {}) };
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const first = req.messages.find((m) => m.role === "user");
    const text = typeof first?.content === "string" ? first.content : (first?.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
    const { request, forms } = shown(text);
    // A translator offers; the participant sees the draft and decides (Naz, 2026-10-08). So the model asks back only
    // where it is very unsure, and never twice running: whoever was just asked back for that is given the model's
    // best draft the next time they ask, to confirm or decline. (Who is asking: the draft's id without its number.)
    const who = req.ref?.replace(/\.\d+$/, "");
    const { program, unsure, asked } = await this.translate(request, forms, { draft: !!who && this.askedBack.has(who) });
    if (who) asked ? this.askedBack.add(who) : this.askedBack.delete(who);
    return { content: [{ type: "tool_use", id: "decide", name: req.tools?.[0]?.name ?? "call", input: { program, ...(unsure ? { unsure } : {}) } }], usage: { input_tokens: 0, output_tokens: 0 }, estimated: true };
  }

  close(): void {
    this.proc?.stdin?.end();
  }
}
