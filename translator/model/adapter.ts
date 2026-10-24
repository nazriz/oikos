// A trained model that decides and copies, behind the adapter every translator model sits behind: the evaluation and
// a run call it as they call any other (`--model decide/<name>`: the model in $OIKOS_TRANSLATOR_MODELS/<name>, by
// default runs/translator-model/<name>). It reads the request and the forms out of what the translator would send a
// language model, and answers with a program. Below `threshold` of sureness it asks back: none(unclear).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LlmAdapter, LlmRequest, LlmResponse } from "@oikos/participants/llm";
import { calls } from "@oikos/participants";
import { formsIn, inputOf, lineOf, programFrom, type Decoding, type Grammar } from "./encode";
import { pieces } from "./export";
import { namedAmong, partsOf, ranked, taken, type FormFacts } from "./subset";

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
 * slot, decisions that break the slots' rule (an argument the contract requires left out, too few or too many) are no
 * program either. (A form's required field left out is a program; `formsMisfit` then says which field it lacks.) */
export function programOf(input: string, ps: { at: [number, number] }[], steps: (string | [string, number, number])[], decoding: Decoding = "steps", grammar?: Grammar): string {
  try {
    const program = programFrom(input, steps.map((s) => {
      if (typeof s === "string") return s;
      const a = ps[s[1]], z = ps[s[2]];
      if (!a || !z || z.at[1] <= a.at[0]) throw new Error("a span of no piece");
      return [s[0] as "id", a.at[0], z.at[1]];
    }), decoding, grammar);
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

/** The slots a slot-by-slot model was trained with, as its folder says (config.json `grammar`): each function's arguments
 * in order and which are required. None for a model that does not write slot by slot, or whose folder says nothing: its
 * decisions are then read against the contract as it stands. */
export function grammarOf(dir: string): Grammar | undefined {
  try {
    const file = join(dir, "config.json");
    const g = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).grammar : undefined;
    return g && typeof g === "object" && Object.values(g).every((x: any) => Array.isArray(x?.args) && Array.isArray(x?.required)) ? (g as Grammar) : undefined;
  } catch {
    return undefined;
  }
}

/** The decoding a trained model was trained in, as its folder says (config.json `decoding`): `steps` where it says
 * nothing (every model before 2026-10-10) or can't be read. */
export function decodingOf(dir: string): Decoding {
  try {
    const file = join(dir, "config.json");
    const d = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).decoding : undefined;
    return d === "slots" || d === "cards" ? d : "steps";
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
  const lines = formsIn(["", ...forms].join("\n"));
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
    // (Two offices may each have a form of one name, with fields of their own: the call fills the one that goes to
    // the office it names, the same line the slots are read off, encode.ts `lineOf`.)
    const mine = lineOf(lines, form, said(c.args.to));
    const f = (mine && mine.line.startsWith(`- ${form},`) ? [...formsShown([mine.line]).values()][0] : undefined) ?? shownForms.get(form);
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

/** Why this adapter offers no draft where the model's own answer was not a refusal it is sure of: its sureness is under
 * the cut-off; the form it filled in is not one of the forms shown as shown; or its steps make no program of the call
 * language; or the request with its forms is longer than the model reads. */
export type Withheld = "cut_off" | "form_check" | "no_program" | "too_long" | "form_not_shown" | "forms_subset" | "form_unseen" | "type_unreleased" | "probation";

/** A field's kind of value as a form's line shows it: `choice` for one of a few options, else the type it names. */
export function fieldTypes(line: string): string[] {
  const f = line.indexOf(": fields ");
  if (f < 0) return [];
  return [...line.slice(f + 9).matchAll(/([^\s,()]+) \(([^)]*)\)/g)].map((m) => (m[2]!.startsWith("one of ") ? "choice" : m[2]!.replace(/, required$/, "").trim()));
}

/** What a model that reads forms by name (decoding `cards`) is released for, from types-released.json beside it
 * (translator/model/release.ts): the kinds of field it passes the mark on, on forms it was never taught, and the call
 * language's functions it passes on, on requests kept out of its training. None where the file is missing or malformed:
 * nothing of a `cards` model's is then offered (every draft goes behind, `type_unreleased`). */
export function typesReleasedOf(dir: string): { types: string[]; functions: string[] } | undefined {
  try {
    const x = JSON.parse(readFileSync(join(dir, "types-released.json"), "utf8"));
    const ok = (y: unknown) => Array.isArray(y) && y.every((z) => typeof z === "string");
    return ok(x.types_released) && ok(x.functions_released) ? { types: x.types_released, functions: x.functions_released } : undefined;
  } catch {
    return undefined;
  }
}

/** A form's trial (the owner's ruling, 2026-10-23): a form a `cards` model was not taught is drafted by the translator
 * behind until five requests on it that the seat confirmed agree in meaning with what ours wrote, none disagreeing since;
 * then ours is offered. The ledger is probation.jsonl beside the model, a line an outcome ({"form", "agree": true |
 * false, "run", "draft"}), added to after a run (translator/model/probation.ts) and read once when the adapter starts.
 * Within a run, outcomes are counted as they come (`DecideAdapter.probationOutcome`), so a form can pass its trial
 * during the run; every route says where a request stood. */
export const TRIAL = 5;

/** Whether a `cards` model's draft is offered, by kind (the owner's ruling, 2026-10-23): not if a function it uses is not
 * released, or a form it fills has a field of a kind not released (`type_unreleased`); not if a form it fills was not
 * taught and is not past its trial (`probation`, with those forms by name in `trial`). */
export function byKind(program: string, forms: string[], released: { types: string[]; functions: string[] } | undefined, passed: (form: string) => boolean): { withheld?: "type_unreleased" | "probation"; trial: string[] } {
  const filled = [...program.matchAll(/\bform=([\w.-]+)/g)].map((m) => m[1]!);
  const fns = [...program.matchAll(/(?:^|[\s(=,;\[])([a-z_]+)\(/g)].map((m) => m[1]!);
  const lineFor = (f: string) => forms.find((l) => l.startsWith(`- ${f},`) || partsOf(l).id === f);
  const names = filled.map((f) => (lineFor(f) ? partsOf(lineFor(f)!).name || f : f));
  const trial = names.filter((f) => !passed(f));
  const unreleased = !released || fns.some((fn) => !released.functions.includes(fn)) || filled.some((f) => !lineFor(f) || fieldTypes(lineFor(f)!).some((t) => !released.types.includes(t)));
  return { ...(unreleased ? { withheld: "type_unreleased" as const } : trial.length ? { withheld: "probation" as const } : {}), trial };
}
export function probationOf(dir: string): Map<string, number> {
  const run = new Map<string, number>();
  try {
    for (const l of readFileSync(join(dir, "probation.jsonl"), "utf8").split("\n")) {
      if (!l.trim()) continue;
      const x = JSON.parse(l);
      if (typeof x.form !== "string") continue;
      run.set(x.form, x.agree === true ? (run.get(x.form) ?? 0) + 1 : 0);
    }
  } catch {}
  return run;
}

/** The list of forms a model was taught, from forms-trained.json beside its config.json; none if missing or malformed. */
function sidecarList(dir: string): string[] | undefined {
  try {
    const x = JSON.parse(readFileSync(join(dir, "forms-trained.json"), "utf8")).forms_trained;
    return Array.isArray(x) && x.every((y: unknown) => typeof y === "string") ? (x as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/** The forms whose drafts the model may offer, from forms-released.json beside its config.json
 * (scripts/forms-released.ts: a form is on it once it passes its own per-form mark); none if there is no such file or it
 * is malformed. A folder with no list is read as before: the forms the model was taught. */
function releasedList(dir: string): string[] | undefined {
  try {
    const x = JSON.parse(readFileSync(join(dir, "forms-released.json"), "utf8")).forms_released;
    return Array.isArray(x) && x.every((y: unknown) => typeof y === "string") ? (x as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/** What a trained model's reader takes, as its folder says (config.json): the most it reads (`max_tokens` of its
 * encoder's tokens, or `max_pieces` where it reads pieces), and the most forms it was shown in training where the
 * folder says that (`max_forms`: no model's does yet, and the reader's length is then the only limit). `released`: the
 * forms its drafts are offered for (forms-released.json), where its folder carries the list. */
export function readerOf(dir: string): { most?: number; forms?: number; trained?: string[]; released?: string[] } {
  try {
    const c = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    const n = (x: unknown) => (typeof x === "number" && x > 0 ? x : undefined);
    // (`forms_trained`: the names of the forms in the model's training export, where its folder carries the list: in
    // config.json, which wins, or in forms-trained.json beside it (scripts/forms-trained.ts; the Python loader takes
    // config.json's keys as they are, so the list is kept apart).)
    const names = (x: unknown) => (Array.isArray(x) && x.every((y: unknown) => typeof y === "string") ? (x as string[]) : undefined);
    const trained = names(c.forms_trained) ?? sidecarList(dir);
    const released = releasedList(dir);
    return { most: n(c.encoder ? c.max_tokens : c.max_pieces), forms: n(c.max_forms), ...(trained ? { trained } : {}), ...(released ? { released } : {}) };
  } catch {
    return {};
  }
}

export class DecideAdapter implements LlmAdapter {
  provider = "decide";
  private proc?: ChildProcess;
  private waiting: ((line: string) => void)[] = [];
  private buffer = "";
  private queue: Promise<unknown> = Promise.resolve();
  /** Each answer's sureness and time, in the order asked (for whoever measures). */
  answers: { sure: number; ms: number; program: string; steps?: number; parts?: { choices: number; places: number; texts: number; least: number }; unsure?: object; shown?: { forms: string[]; of: number } }[] = [];
  private reader?: { most?: number; forms?: number; trained?: string[]; released?: string[] };
  /** Whose forms were once more than the reader takes (by who asked): absent a list of the forms the model was
   * trained on, any form such an asker's draft fills is taken as one the model never saw. */
  private subsetFor = new Set<string>();
  /** Who was last asked back because the model was unsure (by the participant a draft is for): their next request is
   * drafted however unsure it is. */
  private askedBack = new Set<string>();
  /** What of the call language this model was trained without, and so can never answer with (`ADDED`). */
  readonly cannot: [choice: string, what: string][];
  /** The decoding the model answers in (its folder says). */
  readonly decoding: Decoding;
  /** The slots the model was taught (`grammarOf`). */
  private readonly grammar?: Grammar;
  /** A `cards` model's: what it is released for (`typesReleasedOf`), and each untaught form's run of agreements in its trial. */
  private readonly released?: { types: string[]; functions: string[] };
  private trial = new Map<string, number>();
  /** A seat-confirmed request on a form in its trial: whether what ours wrote for it agreed with the draft confirmed
   * (arrangement.ts, `signed`). Five in a row and the form is ours from then on; a disagreement starts it again. */
  probationOutcome(form: string, agree: boolean): void {
    this.trial.set(form, agree ? (this.trial.get(form) ?? 0) + 1 : 0);
  }
  /** Whether a form is past its trial (or was taught, and has none). */
  private passed(form: string, trained?: string[]): boolean {
    return !!trained?.includes(form) || (this.trial.get(form) ?? 0) >= TRIAL;
  }
  /** `first`: this model answers first with another translator behind it (translator/src/arrangement.ts), so whoever
   * it is unsure for is never told so by it: the request goes behind. Then nobody is "given its best draft the next
   * time", and the cut-off holds for every request. */
  constructor(public model: string, private o: { dir?: string; threshold?: number; unchecked?: boolean; quiet?: boolean; first?: boolean; /** A `cards` model measured before anything is released for it (release.ts): its drafts as they are, with no release by kind and no trial. */ unreleased?: boolean } = {}) {
    const vocabulary = vocabularyOf(this.dir());
    this.decoding = decodingOf(this.dir());
    this.grammar = this.decoding !== "steps" ? grammarOf(this.dir()) : undefined;
    if (this.decoding === "cards") {
      this.released = typesReleasedOf(this.dir());
      this.trial = probationOf(this.dir());
    }
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
    // A process that ends (the model's folder is not a model, Python is missing, it was killed) answers nothing more:
    // whoever is waiting is told, never left waiting, and the next request starts it again.
    const gone = (why: string) => {
      if (this.proc !== proc) return;
      this.proc = undefined;
      this.buffer = "";
      const left = this.waiting.splice(0);
      this.failed = why;
      for (const w of left) w("");
    };
    proc.on("error", (e) => gone(String(e.message)));
    proc.on("exit", (code, signal) => gone(`the model's process ended (${signal ?? `exit ${code}`})`));
  }

  /** Why the model's process last ended while something waited on it. */
  private failed = "";

  /** The model loaded and answering: one request of nothing, awaited. A run asks this once at its start, so that a
   * model that cannot load stops the run there, and no request pays for the load. */
  async ready(): Promise<void> {
    this.check();
    await this.ask({ pieces: [], breaks: [], at: [] });
  }

  /** That the model's folder holds a model (said before anything is started on it). */
  check(): void {
    for (const f of ["config.json", "model.safetensors"]) if (!existsSync(join(this.dir(), f))) throw new Error(`decide/${this.model}: ${join(this.dir(), f)} is not there (the models' folder is OIKOS_TRANSLATOR_MODELS, by default runs/translator-model)`);
  }

  /** While an answer is awaited the model’s process keeps this one alive; between answers it doesn’t, so whoever
   * has finished asking can end with the model still loaded. */
  private hold(on: boolean): void {
    for (const x of [this.proc, this.proc?.stdout, this.proc?.stdin] as any[]) (on ? x?.ref : x?.unref)?.call(x);
  }

  private ask(o: object): Promise<any> {
    const next = this.queue.then(() => new Promise<any>((done, fail) => {
      if (!this.proc) this.start();
      this.waiting.push((line) => { try { done(JSON.parse(line)); } catch { fail(new Error(`decide/${this.model} did not answer: ${this.failed || "its answer could not be read"}`)); } });
      this.hold(true);
      this.proc!.stdin!.write(JSON.stringify(o) + "\n");
    }));
    this.queue = next.catch(() => {});
    return next;
  }

  /** The program for a request and the forms known, and how sure the model is. */
  async translate(request: string, all: string[], o: { draft?: boolean; facts?: Omit<FormFacts, "line">[]; who?: string } = {}): Promise<{ program: string; sure: number; ms: number; unsure?: object; asked?: boolean; withheld?: Withheld; wrote?: string; shown?: { forms: string[]; of: number }; trial?: string[] }> {
    // More forms than the reader takes (subset.ts): the request goes with as many of them as fit, the asker's own
    // office's first, then those whose words the request shares. The request itself is never cut or changed; one
    // that is too long with no form at all is asked back as before.
    const reader = (this.reader ??= readerOf(this.dir()));
    const facts: FormFacts[] = all.map((line, i) => ({ line, ...(o.facts?.[i] ?? {}) }));
    const order = ranked(request, facts);
    let n = Math.min(all.length, reader.forms ?? all.length);
    let at_: number[], forms: string[], input: string, ps: ReturnType<typeof pieces>, a: any;
    for (;;) {
      at_ = taken(order, n);
      forms = at_.map((i) => all[i]!);
      input = inputOf(request, forms);
      ps = pieces(input);
      const breaks: number[] = [];
      for (let at = input.indexOf("\n"); at >= 0; at = input.indexOf("\n", at + 1)) breaks.push(ps.findIndex((p) => p.at[0] > at));
      // Where each piece stands goes too: a model whose reader has tokens of its own reads the input by them, and
      // answers in pieces as every model does.
      a = await this.ask({ pieces: ps.map((p) => p.text), breaks, at: ps.map((p) => p.at), head: request.length });
      // (Too long for the reader, with forms still shown: one fewer, the last by the rule. An answer of more
      // decisions than the model has places for is also "too long", and showing fewer forms does not help it.)
      if (!(a.too_long && n > 0 && reader.most !== undefined && a.read > reader.most)) break;
      n--;
    }
    const shown = n < all.length ? { forms: at_.map((i) => partsOf(all[i]!).id || partsOf(all[i]!).name), of: all.length } : undefined;
    let program = programOf(input, ps, a.steps, this.decoding, this.grammar);
    // Why no draft is offered, where the reason is this adapter's and not the model's own refusal, and what the model
    // had written (for the record: it is never offered).
    let withheld: Withheld | undefined;
    const wrote = program;
    // (A form the request names that the reader was not shown: this model cannot have filled it in.)
    const unshown = shown ? namedAmong(request, facts, order.slice(n)) : [];
    if (a.too_long) withheld = "too_long";
    else if (unshown.length) { withheld = "form_not_shown"; program = "none(unclear)"; }
    else if (program === "none(unclear)" && !(a.steps.length && a.steps[0] === "none:unclear")) withheld = "no_program";
    // What was unclear, where it asks back: the part of its answer it was least sure of (what to do, which thing is
    // meant, or which words are to be copied), or what about a form doesn't fit the form as shown.
    let unsure: object | undefined;
    let asked = false;
    if (!withheld && !o.draft && a.sure < (this.o.threshold ?? CUT_OFF)) {
      asked = true;
      withheld = "cut_off";
      const least = a.parts ? (["choices", "places", "texts"] as const).reduce((x, y) => (a.parts[y] < a.parts[x] ? y : x)) : "choices";
      program = "none(unclear)";
      unsure = { kind: least === "places" ? "which" : least === "texts" ? "words" : "act" };
    }
    // (A form that can't be one of the forms shown is not offered, however sure the model is.)
    const misfit = this.o.unchecked || withheld === "form_not_shown" ? undefined : formsMisfit(program, forms);
    if (misfit) {
      withheld = "form_check";
      program = `none(${misfit.label})`;
      unsure = misfit.label === "unclear" ? misfit.unsure : undefined;
    }
    // A draft made on fewer forms than the asker knows of, or that fills a form the model was never trained on, is
    // recorded and not offered (the owner's coordinator, 2026-10-12: measured on the fourth living pilot's own
    // requests, 10 of 22 such drafts for a letting office differed from what its seat confirmed, and 2 of 9 on forms
    // the model had never seen were right; a seat confirms nearly everything). The translator behind drafts for the
    // world, and the two are compared on the route. Which forms are outside its training: those not in the list its
    // folder carries (`forms_trained`, in config.json or forms-trained.json); absent the list, any form of an asker whose forms were ever a subset.
    // Where the folder also carries forms-released.json (the owner, 2026-10-14: a form is handed to our model as soon as
    // it passes its own per-form mark, whatever the model as a whole scores), that list is the one: a form taught and not
    // yet released is recorded as one never taught is (`form_unseen`), and the translator behind drafts for the world.
    if (shown && o.who) this.subsetFor.add(o.who);
    // A model that reads forms by name (`cards`) is released by kind, not form by form (the owner's ruling,
    // 2026-10-23): a draft is offered if each of its functions is released, every field of each form it fills is of a
    // released kind, and each form it fills was taught or is past its trial. Otherwise it is recorded and the
    // translator behind drafts. (Fewer forms shown than the asker knows of still goes behind, as for any model.)
    let trial: string[] | undefined;
    if (this.decoding === "cards" && !(this.o.unreleased ?? !!process.env.OIKOS_DECIDE_UNRELEASED) && !withheld && !/^none\(\w+\)$/.test(program)) {
      const k = byKind(program, forms, this.released, (f) => this.passed(f, reader.trained));
      trial = k.trial;
      if (shown) withheld = "forms_subset";
      else if (k.withheld) withheld = k.withheld;
      if (withheld) program = "none(unclear)";
    }
    if (this.decoding !== "cards" && !withheld && !/^none\(\w+\)$/.test(program)) {
      const filled = [...program.matchAll(/\bform=([\w.-]+)/g)].map((m) => m[1]!);
      // (The forms the folder says are released, where it says; else those it was taught; else, for an asker whose forms
      // were once a subset, any.)
      const known = reader.released ?? reader.trained;
      const unseen = known ? filled.some((f) => !known.includes(f) && !known.includes(partsOf(forms.find((l) => partsOf(l).id === f) ?? "").name)) : filled.length > 0 && !!o.who && this.subsetFor.has(o.who);
      if (shown) withheld = "forms_subset";
      else if (unseen) withheld = "form_unseen";
      if (withheld) program = "none(unclear)";
    }
    this.answers.push({ sure: a.sure, ms: a.ms, program, steps: a.steps.length, ...(a.parts ? { parts: a.parts } : {}), ...(unsure ? { unsure } : {}), ...(shown ? { shown } : {}) });
    return { program, sure: a.sure, ms: a.ms, ...(unsure ? { unsure } : {}), ...(asked ? { asked } : {}), ...(withheld ? { withheld, ...(wrote !== program ? { wrote } : {}) } : {}), ...(shown ? { shown } : {}), ...(withheld === "probation" && trial?.length ? { trial } : {}) };
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const first = req.messages.find((m) => m.role === "user");
    const text = typeof first?.content === "string" ? first.content : (first?.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
    const { request, forms } = shown(text);
    // A translator offers; the participant sees the draft and decides (Naz, 2026-10-08). So the model asks back only
    // where it is very unsure, and never twice running: whoever was just asked back for that is given the model's
    // best draft the next time they ask, to confirm or decline. (Who is asking: the draft's id without its number.)
    const who = req.ref?.replace(/\.\d+$/, "");
    // (What whoever asks says of each form, beside its line: whether it is the asker's own office's, and what it is
    // for. Facts behind the prompt, in the order of its forms; without them every form is anyone's.)
    const said = Array.isArray(req.context?.forms) && req.context.forms.length === forms.length ? (req.context.forms as Omit<FormFacts, "line">[]) : undefined;
    const { program, unsure, asked, sure, ms, withheld, wrote, shown: sub, trial } = await this.translate(request, forms, { draft: !this.o.first && !!who && this.askedBack.has(who), ...(said ? { facts: said } : {}), ...(who ? { who } : {}) });
    if (who) asked ? this.askedBack.add(who) : this.askedBack.delete(who);
    // (With another translator behind it, its answer says how sure it was, how long it took and why it offers no
    // draft where it offers none: the arrangement routes on that, and the transcript keeps it. Whole numbers, as
    // everything in a log is: sureness in parts per million, time in milliseconds.)
    const more = this.o.first ? { sure_ppm: Math.round(sure * 1e6), ms: Math.round(ms), ...(withheld ? { withheld } : {}), ...(wrote !== undefined ? { wrote } : {}), ...(sub ? { forms_shown: sub.forms, forms_of: sub.of } : {}), ...(trial ? { trial } : {}) } : {};
    return { content: [{ type: "tool_use", id: "decide", name: req.tools?.[0]?.name ?? "call", input: { program, ...(unsure ? { unsure } : {}), ...more } }], usage: { input_tokens: 0, output_tokens: 0 }, estimated: true };
  }

  close(): void {
    this.proc?.stdin?.end();
  }
}
