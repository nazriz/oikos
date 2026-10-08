// The translator's training pipeline: pilots' logs in, a trained model and its scores out, in one unattended command
// (`oikos translator-pipeline <config.json>`; docs/translator-pipeline.md). Every step was run by hand, a shell command
// at a time, with Claude subagents writing and reading; here the same steps, with the same instructions
// (translator/train/in-situ/), call the repo's own adapters.
//
//   situations   `inSitu` over a lane's pilot folders: every time a model seat was asked what to do, and the seats' own requests.
//   select       which situations each writer is given (one seat-day in `every`, one turn of it), at most `situations`.
//   write        writers (a model of the seat's family) say what they would ask through `do`, up to eight requests a situation.
//   take in      their requests, and the seats' real ones, as requests for readers (blind file).
//   read         two readers of different models translate each request with the translator's prompt, blind.
//   label        where the readers differ in `basis` alone, the basis is every record either gave (request order); then
//                `label`: what they agree on becomes examples (with spans), the rest rejects with why.
//   tests        a pilot marked test-only (PILOT.txt or pilot-report.json: test true) is a lane of its own: its requests and
//                situations are labelled the same way and kept as test sets, and never join training; a third of each kind
//                of the training pilots' real requests is held back as a test, whole seat-days one in ten as validation.
//   join, export the new examples (four times each) with the standing set; steps for the model (translator/model/export.ts).
//   train        on a rented GPU (translator/model/pod/pod.sh), brought home and scored here, where the tests never leave.
//
// Each unit of work (a call, a batch, a step) leaves a file with a fingerprint of its inputs and is skipped when that file
// is whole and the fingerprint is the same; a stale one is set aside, never deleted. A usage limit is waited out and the
// call made again; the spending limit is the run's, kept across resumes (the ledger is calls.jsonl). Every call's usage and
// cost is in that ledger, with its prompt and its answer. Readers' answers are never made by rules: a reader whose answers
// are implausibly uniform is rejected. Nothing here opens the held-out test; the real test cases are never given out
// (in-situ.ts marks them).

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";
import { calls } from "@oikos/participants";
import { callModel, ModelCallFailed, ModelUnreachable, SpendingLimitReached, UsageLimitReached, type Budget, type LlmAdapter, type LlmIO, type Price } from "@oikos/participants/llm";
import { TRANSLATOR_VERSION, translatorSystem } from "@oikos/translator";
import { formOfLine, type BlindAnswer } from "../../translator/train/blind";
import { functionOf, sameProgram, type Example, type FormSpec } from "../../translator/train/data";
import { withListsQuoted, type LabelManifest, type Unlabelled } from "../../translator/train/readers";
import { evaluateSet, loadSet, type SetReport } from "@oikos/translator/eval";
import { DecideAdapter } from "../../translator/model/adapter";
import { chooseModel } from "./models";
import { blindFile, briefOf, chunksFor, inSitu, inSituInstructions, label, runName, takeInFiles, type Situation } from "./in-situ";
import { logsIn } from "./corpus";

const INSTRUCTIONS = join(import.meta.dir, "../../translator/train/in-situ");
const REPO = resolve(import.meta.dir, "../..");

// ------------------------------------------------------------------------------------------------------ config

export interface PipelineConfig {
  /** The run's folder: everything is written under it (a new folder; an existing one is resumed). */
  out: string;
  /** The pilots that are sources: a folder of logs each. `test: true` here, or in the pilot's PILOT.txt or pilot-report.json, makes it test-only. */
  pilots: { path: string; test?: boolean }[];
  /** The writer for each seat model family: the seat's provider ("claude-code") or its whole model name; the writer is a `provider/model`. */
  writers: { [family: string]: string };
  /** The two readers: different `provider/model`s. */
  readers: [string, string];
  /** How many situations writers are given in the training lane, and in the test lane (default: as many). */
  situations: number;
  testSituations?: number;
  /** The most requests kept from a situation's writer (8: what the instructions ask for). */
  requestsPerSituation?: number;
  /** The most of the seats' own requests, and of the writers', taken to the readers in a lane (all if absent). */
  realRequests?: number;
  writtenRequests?: number;
  /** One seat-day in `every` goes to writers (3), seed for every choice made here (1). */
  every?: number;
  seed?: number;
  /** Texts added to the writers' instructions, after the addendum, each taking precedence over those before it
   * (names of files in translator/train/in-situ/, or paths): "writer-round2.txt" for a round weighted toward things done. */
  extraInstructions?: string[];
  /** The standing set to join with: a folder with train.jsonl, validation.jsonl and (optionally) validation-real.jsonl. */
  standing?: string;
  /** Times each new example is repeated in training (4), and the share of seat-days kept out of training as validation-real (one in 10). */
  repeat?: number;
  validationDays?: number;
  /** Add the test lane's examples to validation-real too (false: they are test sets and nothing else). */
  testsInValidationReal?: boolean;
  /** The pipeline's spending limit in USD for every model call it makes (Codex calls cost nothing per call). Required. */
  budget: number;
  /** Minutes to wait when a usage limit stops a call, and at most how many hours in all before stopping (20, 12). */
  waitMinutes?: number;
  maxWaitHours?: number;
  /** A call packs situations (characters) and requests (a batch) as the model's context allows. */
  writerCallChars?: number;
  readerBatch?: number;
  readerBatchChars?: number;
  /** Whether to train, on which reader, with which seeds (the model runs are named <name>-s<seed>). False: stop after the export. */
  train: boolean;
  encoder?: string;
  seeds?: number[];
  trainExtra?: string[];
  deadlineHours?: number;
  /** Minutes one call to a writer or reader may take before it is given up and made again (15). */
  callMinutes?: number;
  /** A name for the data and the runs (the folder's name). */
  name?: string;
}

const NEVER = /astra/i;

/** A config as read from a file, checked: the things that must hold before any model is called. */
export function checkConfig(c: PipelineConfig): PipelineConfig {
  const bad = (m: string): never => { throw new Error(`translator-pipeline config: ${m}`); };
  if (!c.out) bad("`out` (the run's folder) is required");
  if (!Array.isArray(c.pilots) || !c.pilots.length) bad("`pilots` needs at least one pilot folder");
  const paths = c.pilots.map((p) => resolve(p.path));
  if (new Set(paths).size !== paths.length) bad("a pilot is listed twice");
  if (!c.writers || !Object.keys(c.writers).length) bad("`writers` (a model for each seat model family) is required");
  if (!Array.isArray(c.readers) || c.readers.length !== 2) bad("`readers` is two models");
  const family = (m: string) => m.split("@")[0]!;
  if (family(c.readers[0]) === family(c.readers[1])) bad(`the two readers must be different models (both are ${c.readers[0]})`);
  for (const m of [...Object.values(c.writers), ...c.readers]) {
    if (!/^[^/]+\/.+/.test(m)) bad(`"${m}" is not provider/model`);
    if (NEVER.test(m)) bad(`${m} is never used`);
  }
  if (!(c.situations >= 0)) bad("`situations` is a number");
  if (!(c.budget > 0)) bad("`budget` (a spending limit in USD) is required");
  if (c.train && !c.encoder) bad('"train": true needs `encoder` (e.g. microsoft/deberta-v3-small)');
  return c;
}

const home = (p: string) => (p.startsWith("~/") ? join(process.env.HOME ?? "", p.slice(2)) : p);

export function loadConfig(path: string): PipelineConfig {
  const c = JSON.parse(readFileSync(path, "utf8")) as PipelineConfig;
  c.out = resolve(home(c.out));
  c.pilots = (c.pilots ?? []).map((p) => ({ ...p, path: resolve(home(p.path)) }));
  if (c.standing) c.standing = resolve(home(c.standing));
  return checkConfig(c);
}

// ------------------------------------------------------------------------------------------------------ files

const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const fp = (...parts: unknown[]) => sha(JSON.stringify(parts)).slice(0, 16);
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
const jsonl = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : []);
const lines = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : "");
const read = <T>(file: string): T | undefined => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return undefined; } };

/** A file written whole or not at all. */
function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
const putJson = (path: string, x: unknown) => put(path, `${JSON.stringify(x, null, 1)}\n`);

/** A file set aside (never deleted) under a name that says why. */
function setAside(path: string, why: string): void {
  if (!existsSync(path)) return;
  let n = 1;
  while (existsSync(`${path}.${why}-${n}`)) n++;
  renameSync(path, `${path}.${why}-${n}`);
}

async function* each<T>(file: string): AsyncGenerator<T> {
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) if (line.trim()) yield JSON.parse(line) as T;
}

// ------------------------------------------------------------------------------------------------------ calls

/** The pipeline stopped for a reason that is not a fault: it can be resumed (the same command). */
export class Stopped extends Error {
  override name = "Stopped";
  constructor(readonly reason: string, message: string) { super(message); }
}

export interface Hooks {
  /** An adapter and its prices for a `provider/model` (tests: the mock). */
  adapter?: (model: string) => { adapter: LlmAdapter; prices: { [key: string]: Price } };
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** In place of the rented GPU (tests): given the data folder, the runs and where they come home, leaves each run's
   * folder as the pod script does, and answers with that script's exit code. */
  pod?: (o: { data: string; runs: { name: string; encoder: string; seed: number }[]; models: string; state: string }) => number;
}

export interface Used { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_microusd: number; calls: number }
const noUse = (): Used => ({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_microusd: 0, calls: 0 });
const addUse = (a: Used, b: Used): Used => ({ input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens, cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens, cost_microusd: a.cost_microusd + b.cost_microusd, calls: a.calls + b.calls });

/**
 * How a writer or a reader hands its file in: as one object of a given shape, `answers` a list with an object for each
 * line of the file, every field a plain string (or a list of them). A model called through Claude Code or the Codex CLI
 * is asked for exactly that shape as its answer (`answer`: no string of JSON inside it for the model to escape by hand,
 * which a reader once did to 25 of 34 programs); any other adapter is given the same shape as the input of a tool.
 */
const handIn = (item: { [field: string]: object }) => {
  const schema = { type: "object", additionalProperties: false, required: ["answers"], properties: { answers: { type: "array", description: "the answer file, a line to an item, in order", items: { type: "object", additionalProperties: false, required: Object.keys(item), properties: item } } } };
  return { answer: { name: "hand_in", schema }, tools: [{ name: "hand_in", description: "Hand in the answer file: `answers` is the file's lines, in order, one object for each line, exactly as the task describes them.", input_schema: schema }] };
};
export const HAND_IN = {
  reader: handIn({ id: { type: "string", description: "the request's id, copied exactly" }, program: { type: "string", description: "the program, as it is written" } }),
  writer: handIn({ id: { type: "string", description: "the situation's id, copied exactly" }, requests: { type: "array", items: { type: "string" }, description: "the requests, each as it is said" } }),
};

export class Caller {
  readonly budget: Budget;
  private readonly seen = new Set<string>();
  private readonly adapters = new Map<string, { adapter: LlmAdapter; prices: { [key: string]: Price } }>();
  private waitedMs = 0;
  constructor(private readonly cfg: Pick<PipelineConfig, "budget" | "waitMinutes" | "maxWaitHours" | "callMinutes">, private readonly ledger: string, private readonly hooks: Hooks, private readonly say: (s: string) => void) {
    // The spending limit is the run's: what earlier sittings of this run spent counts (the ledger holds it).
    let spent = 0;
    for (const e of jsonl<any>(ledger)) if (e.annotation === "usage") spent += e.cost_microusd ?? 0;
    this.budget = { limitMicroUsd: Math.round(cfg.budget * 1e6), spentMicroUsd: spent };
    for (const e of jsonl<any>(ledger)) if (e.annotation === "transcript" && e.data?.system_sha256) this.seen.add(e.data.system_sha256);
  }

  private model(name: string) {
    let m = this.adapters.get(name);
    if (!m) {
      // (A batch of thirty requests, or a call of several situations, can take a model longer than a seat's answer does.)
      m = this.hooks.adapter ? this.hooks.adapter(name) : (({ adapter, prices }) => ({ adapter, prices }))(chooseModel(name, { budgetUsd: this.cfg.budget, timeoutMs: (this.cfg.callMinutes ?? 15) * 60_000 }));
      this.adapters.set(name, m);
    }
    return m;
  }

  /** One model call: the text it answered and what it used. A usage limit is waited out; the spending limit stops the run. */
  async ask(model: string, where: { step: string; unit: string }, req: { system: string; user: string; maxTokens: number; subject: string; form: keyof typeof HAND_IN }): Promise<{ text: string; used: Used; ms: number }> {
    const m = this.model(model);
    let used = noUse();
    const io: LlmIO = {
      adapter: m.adapter, prices: m.prices, budget: this.budget, now: () => Math.floor(Date.now() / 1000),
      annotate: async (a: any) => {
        appendFileSync(this.ledger, `${JSON.stringify({ at: new Date().toISOString(), step: where.step, unit: where.unit, ...a })}\n`);
        if (a.annotation === "usage") used = addUse(used, { input_tokens: a.input_tokens, output_tokens: a.output_tokens, cache_read_tokens: a.cache_read_tokens ?? 0, cache_write_tokens: a.cache_write_tokens ?? 0, cost_microusd: a.cost_microusd, calls: 1 });
      },
    };
    const sleep = this.hooks.sleep ?? ((ms: number) => Bun.sleep(ms));
    const started = Date.now();
    for (let attempt = 1; ; attempt++) {
      try {
        // (The file is handed in as an object of a given shape, a list: a reply of plain words is cut at 4,000 characters by the
        // Claude Code adapter, a third of a batch of answers. A reply of words is still read, if the model gives one.)
        const res = await callModel(io, { purpose: "consult", subject: req.subject, system: req.system, messages: [{ role: "user", content: req.user }], maxTokens: req.maxTokens, ...HAND_IN[req.form] }, this.seen);
        const handed = res.content.flatMap((b) => (b.type === "tool_use" && Array.isArray(b.input?.answers) ? (b.input.answers as unknown[]) : []));
        return { text: handed.length ? handed.map((o) => JSON.stringify(o)).join("\n") : res.content.map((b) => (b.type === "text" ? b.text : "")).join(""), used, ms: Date.now() - started };
      } catch (e) {
        if (e instanceof UsageLimitReached || e instanceof ModelUnreachable) {
          const ms = (this.cfg.waitMinutes ?? 20) * 60_000;
          this.waitedMs += ms;
          if (this.waitedMs > (this.cfg.maxWaitHours ?? 12) * 3_600_000) throw new Stopped("usage limit", `${model}: still limited after ${this.cfg.maxWaitHours ?? 12} hours of waiting: ${e.message.slice(0, 200)}`);
          this.say(`${model}: ${e.message.slice(0, 160)}; asking again in ${this.cfg.waitMinutes ?? 20} minutes`);
          await sleep(ms);
        } else if (e instanceof SpendingLimitReached) {
          throw new Stopped("spending limit", e.message);
        } else if (e instanceof ModelCallFailed && attempt < 3) {
          this.say(`${model}: a call failed (${e.message.slice(0, 120)}); once more`);
          await sleep(30_000);
        } else throw e;
      }
    }
  }
}

/** A program whose every quotation mark has a backslash before it: what a model writes when it escapes by hand what the tool
 * already carries as JSON (a quoted text as \"x\"). The program it meant; any other program is left as it is. */
export function undoubled(program: string): string {
  return program.includes('\\"') && !/(^|[^\\])"/.test(program) ? program.replaceAll('\\"', '"').replaceAll("\\n", "\n") : program;
}

/**
 * One batch of blind requests read by one reader: the translator's prompt as the system message, the reader's task and
 * the batch's lines as the message. `whole`: answers that are a program for a request of the batch; `repaired`: how
 * many of them came with every quotation mark escaped by hand and were read as meant (`undoubled`).
 */
export async function askReader(caller: Caller, reader: string, where: { step: string; unit: string }, system: string, task: string, batch: { id: string; request: string; forms: string[] }[]): Promise<{ answers: BlindAnswer[]; repaired: number; used: Used; ms: number }> {
  const r = await caller.ask(reader, where, { system, user: `${task}\n\n=== BLIND ===\n${batch.map((b) => JSON.stringify(b)).join("\n")}\n`, maxTokens: Math.min(24_000, 800 + 400 * batch.length), subject: "translator-pipeline/reader", form: "reader" });
  const ids = new Set(batch.map((b) => b.id));
  let repaired = 0;
  const seen = new Set<string>();
  const answers = objectsIn(r.text).filter((o) => typeof o.id === "string" && ids.has(o.id) && typeof o.program === "string" && !seen.has(o.id) && !!seen.add(o.id)).map((o) => {
    const program = undoubled(o.program as string);
    if (program !== o.program) repaired++;
    return { id: o.id as string, program };
  });
  return { answers, repaired, used: r.used, ms: r.ms };
}

/** The JSON objects in a model's reply, a line each (a code fence, or the whole reply as one list, is let pass). */
export function objectsIn(text: string): any[] {
  const body = text.trim().replace(/^```(?:json|jsonl)?\s*/i, "").replace(/\s*```\s*$/, "");
  if (body.startsWith("[")) {
    try { const xs = JSON.parse(body); if (Array.isArray(xs)) return xs.filter((x) => x && typeof x === "object"); } catch { /* fall through */ }
  }
  const out: any[] = [];
  for (const l of body.split("\n")) {
    const t = l.trim();
    if (!t.startsWith("{")) continue;
    try { const o = JSON.parse(t); if (o && typeof o === "object") out.push(o); } catch { /* not a line of the file */ }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------ the checks on readers

export interface UniformityLimits { minAnswers: number; topShare: number; distinct: number; refusalShare: number; functionShare: number }
export const UNIFORMITY: UniformityLimits = { minAnswers: 10, topShare: 0.4, distinct: 0.3, refusalShare: 0.9, functionShare: 0.95 };

/**
 * Why a reader's answers are implausibly uniform, if they are: the same program for a large share of a mixture of
 * requests, few different programs, nearly all refusals, or nearly all one function. (A shortcut reader once answered
 * with a rule: the decisions log, "the readers' answers are never produced by keyword rules or scripts".) `whole`: a
 * reader's whole file, which is also held to the shares of refusals and of one function; a batch is held to the first two.
 */
export function implausiblyUniform(answers: BlindAnswer[], whole: boolean, o: UniformityLimits = UNIFORMITY): string | undefined {
  const n = answers.length;
  if (n < o.minAnswers) return undefined;
  const programs = answers.map((a) => a.program.trim().replace(/\s+/g, " "));
  const counts = new Map<string, number>();
  for (const p of programs) counts.set(p, (counts.get(p) ?? 0) + 1);
  const [top, topN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  if (topN / n > o.topShare) return `${topN} of ${n} answers are the same program (${top.slice(0, 80)})`;
  if (counts.size / n < o.distinct) return `only ${counts.size} different programs in ${n} answers`;
  if (!whole) return undefined;
  const refusals = programs.filter((p) => p.startsWith("none(")).length;
  if (refusals / n > o.refusalShare) return `${refusals} of ${n} answers are refusals`;
  const fns = new Map<string, number>();
  for (const p of programs) if (!p.startsWith("none(")) fns.set(p.split("(")[0]!, (fns.get(p.split("(")[0]!) ?? 0) + 1);
  const [fn, fnN] = [...fns.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (n >= 2 * o.minAnswers && fnN / n > o.functionShare) return `${fnN} of ${n} answers are calls of ${fn}`;
  return undefined;
}

// ------------------------------------------------------------------------------------------------------ the basis union

/** The records a basis value names, or undefined where it names something else (a name bound on an earlier line). */
function basisIds(v: calls.Value | undefined): string[] | undefined {
  if (!v) return [];
  if ("id" in v) return [v.id];
  if ("json" in v && Array.isArray(v.json) && v.json.every((x) => typeof x === "string")) return v.json as string[];
  return undefined;
}

/**
 * Two readers' answers to one request that differ in `basis` alone: both with the basis every record either gave (ids
 * only), in the order the request gives them (one it doesn't give last). Undefined where they do not differ in basis
 * alone, or are already the same.
 */
export function unionBasis(request: string, a: string, b: string, ctx: Parameters<typeof sameProgram>[2]): [string, string] | undefined {
  let pa: calls.Program, pb: calls.Program;
  try {
    pa = calls.parseProgram(withListsQuoted(a));
    pb = calls.parseProgram(withListsQuoted(b));
  } catch { return undefined; }
  if ("none" in pa || "none" in pb || pa.lines.length !== pb.lines.length) return undefined;
  if (sameProgram(calls.programText(pa), calls.programText(pb), ctx)) return undefined;
  const without = (p: { lines: calls.Line[] }) => ({ lines: p.lines.map((l) => { const { basis: _, ...args } = l.call.args; return { ...l, call: { fn: l.call.fn, args } }; }) });
  if (!sameProgram(calls.programText(without(pa)), calls.programText(without(pb)), ctx)) return undefined;
  const lines = pa.lines.map((la, i) => {
    const lb = pb.lines[i]!;
    const x = basisIds(la.call.args.basis), y = basisIds(lb.call.args.basis);
    if (!x || !y) return undefined;
    const all = [...new Set([...x, ...y])];
    const at = (id: string) => { const i = request.indexOf(id); return i < 0 ? Infinity : i; };
    const ordered = all.map((id, k) => ({ id, k })).sort((p, q) => (at(p.id) === at(q.id) ? p.k - q.k : at(p.id) < at(q.id) ? -1 : 1)).map((p) => p.id);
    return ordered;
  });
  if (lines.some((l) => !l)) return undefined;
  const set = (p: { lines: calls.Line[] }) => ({
    lines: p.lines.map((l, i) => {
      const ids = lines[i]!;
      if (!ids.length) return l;
      return { ...l, call: { fn: l.call.fn, args: { ...l.call.args, basis: ids.length === 1 ? ({ id: ids[0]! } as calls.Value) : ({ json: ids } as calls.Value) } } };
    }),
  });
  return [calls.programText(set(pa)), calls.programText(set(pb))];
}

// ------------------------------------------------------------------------------------------------------ the run

export interface Manifest {
  version: string;
  config: PipelineConfig;
  started: string;
  updated: string;
  status: string;
  commits: { repo: string; dirty: boolean; pilots: { [path: string]: string | undefined } };
  translator_prompt: string;
  models: { writers: PipelineConfig["writers"]; readers: string[]; reader_for_training?: string };
  sources: { path: string; test: boolean; why?: string; logs: string[]; seat_models: { [m: string]: number } }[];
  steps: { [name: string]: any };
  usage: { total: Used; by_model: { [model: string]: Used } };
  agreement: { [lane: string]: { [fn: string]: { requests: number; agreed: number; disagreed: number; other: number } } };
  tests: { [name: string]: { file: string; examples: number; by_function: { [fn: string]: number } } };
  /** Each trained run on each test set made here: right, no draft, wrong draft; and the same by pilot, seat model,
   * profile, origin and function (translator/eval/set-run.ts). The answers themselves are in the run's `eval-sets.json`. */
  test_scores?: { [run: string]: { [test: string]: Pick<SetReport, "all" | "by" | "forms_not_as_written"> } };
  data?: { joined: string; data: string; counts: any };
  runs: { [name: string]: any };
}

function git(args: string[]): string {
  return Bun.spawnSync(["git", ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
}

/** Whether a pilot is test-only, and why: its PILOT.txt (a note, then the queue entry as JSON) or pilot-report.json. */
export function pilotMeta(dir: string): { test: boolean; why?: string; commit?: string } {
  let test = false, why: string | undefined;
  const report = read<any>(join(dir, "pilot-report.json"));
  if (report?.test === true) { test = true; why = "pilot-report.json"; }
  try {
    const text = readFileSync(join(dir, "PILOT.txt"), "utf8");
    const at = text.search(/^\{/m);
    if (at >= 0 && JSON.parse(text.slice(at)).test === true) { test = true; why ??= "PILOT.txt"; }
  } catch { /* none, or not JSON after the note */ }
  const commit = existsSync(join(dir, "commit.txt")) ? readFileSync(join(dir, "commit.txt"), "utf8").trim().split("\n")[0] : undefined;
  return { test, ...(why ? { why } : {}), ...(commit ? { commit } : {}) };
}

/** The day a request was said, as a key for holding whole seat-days out: its situation without the turn. */
const seatDay = (e: { source?: string; id: string }): string => { const s = e.source ?? e.id; return s.replace(/\/[^/]*$/, ""); };
/** A pilot's folder as its examples' ids begin: its path from the runs folder on, without `runs/`. */
const inRuns = (log: string): string => runName(log).replace(/^runs\//, "");
/** A stable number for a text, 0 to 999. */
const bucket = (s: string, seed: number): number => parseInt(sha(`${seed}:${s}`).slice(0, 8), 16) % 1000;

interface Lane { name: "train" | "test"; pilots: string[]; situations: number }

export async function runPipeline(cfg: PipelineConfig, hooks: Hooks = {}): Promise<Manifest> {
  checkConfig(cfg);
  const out = resolve(cfg.out);
  mkdirSync(out, { recursive: true });
  const logFile = join(out, "pipeline.log");
  const say = (line: string) => { const l = `${new Date().toISOString().slice(0, 16).replace("T", " ")} ${line}`; (hooks.log ?? console.log)(l); appendFileSync(logFile, `${l}\n`); };
  const seed = cfg.seed ?? 1, every = cfg.every ?? 3;
  const manifestPath = join(out, "manifest.json");
  const before = read<Manifest>(manifestPath);
  const m: Manifest = {
    version: "1", config: cfg, started: before?.started ?? new Date().toISOString(), updated: "", status: "running",
    commits: { repo: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain"]) !== "", pilots: {} },
    translator_prompt: TRANSLATOR_VERSION,
    models: { writers: cfg.writers, readers: [...cfg.readers], ...(cfg.train ? { reader_for_training: cfg.encoder } : {}) },
    sources: [], steps: {}, usage: { total: noUse(), by_model: {} }, agreement: {}, tests: {}, runs: {},
  };
  const ledger = join(out, "calls.jsonl");
  // (What was used is read from the ledger, so a resumed run's total is the whole run's.)
  const save = () => {
    m.usage = { total: noUse(), by_model: {} };
    for (const e of jsonl<any>(ledger)) if (e.annotation === "usage") {
      const u: Used = { input_tokens: e.input_tokens, output_tokens: e.output_tokens, cache_read_tokens: e.cache_read_tokens ?? 0, cache_write_tokens: e.cache_write_tokens ?? 0, cost_microusd: e.cost_microusd, calls: 1 };
      const k = `${e.provider}/${e.model}`;
      m.usage.by_model[k] = addUse(m.usage.by_model[k] ?? noUse(), u);
      m.usage.total = addUse(m.usage.total, u);
    }
    m.updated = new Date().toISOString();
    putJson(manifestPath, m);
  };
  putJson(join(out, "config.json"), cfg);
  const caller = new Caller(cfg, ledger, hooks, say);

  // ---- sources and lanes
  const lanes: Lane[] = [];
  const trainPilots: string[] = [], testPilots: string[] = [];
  for (const p of cfg.pilots) {
    const dir = resolve(p.path);
    if (!existsSync(dir)) throw new Error(`pilot folder ${dir} does not exist`);
    const meta = pilotMeta(dir);
    if (p.test === false && meta.test) throw new Error(`${dir} is marked test-only (${meta.why}) and the config says it is not: remove the mark there if that is meant`);
    const test = p.test === true || meta.test;
    (test ? testPilots : trainPilots).push(dir);
    m.commits.pilots[dir] = meta.commit;
    m.sources.push({ path: dir, test, ...(meta.test ? { why: meta.why } : p.test ? { why: "config" } : {}), logs: logsIn(dir), seat_models: {} });
  }
  if (trainPilots.length) lanes.push({ name: "train", pilots: trainPilots, situations: cfg.situations });
  if (testPilots.length) lanes.push({ name: "test", pilots: testPilots, situations: cfg.testSituations ?? cfg.situations });
  say(`${cfg.pilots.length} pilots: ${trainPilots.length} for training, ${testPilots.length} test-only; writers ${Object.values(cfg.writers).join(", ")}; readers ${cfg.readers.join(" and ")}; spending limit ${cfg.budget} USD (spent so far ${(caller.budget.spentMicroUsd / 1e6).toFixed(4)})`);
  save();

  const results: { [lane: string]: { examples: Example[]; rejects: any[]; labelManifest: LabelManifest; seatModel: Map<string, string> } } = {};
  try {
    for (const lane of lanes) results[lane.name] = await laneSteps(lane);
    await tail();
    m.status = "complete";
  } catch (e) {
    if (e instanceof Stopped) {
      m.status = `stopped (${e.reason}): ${e.message.slice(0, 300)}`;
      say(`stopped: ${e.reason}: ${e.message.slice(0, 300)}`);
    } else {
      m.status = `failed: ${(e as Error).message.slice(0, 300)}`;
      save();
      throw e;
    }
  }
  save();
  return m;

  // ------------------------------------------------------------------------------------------------ one lane
  async function laneSteps(lane: Lane) {
    const dir = join(out, "lanes", lane.name);
    const key = (s: string) => `${lane.name}/${s}`;
    const sources = lane.pilots.map((p) => ({ p, logs: logsIn(p).map((l) => [l, statSync(l).size, Math.round(statSync(l).mtimeMs)]) }));

    // 1. situations
    const situDir = join(dir, "situ");
    const situFp = fp(sources, seed, every);
    const stampOf = (name: string) => read<{ fp: string }>(join(dir, `${name}.done.json`));
    const stamp = (name: string, x: object) => putJson(join(dir, `${name}.done.json`), x);
    if (stampOf("situ")?.fp !== situFp || !existsSync(join(situDir, "report.json"))) {
      say(`${lane.name}: reading the pilots' logs for situations`);
      const r = await inSitu({ sources: lane.pilots, out: situDir, writers: [], every, seed, maxChars: cfg.writerCallChars ?? 120_000 });
      stamp("situ", { fp: situFp, totals: r.totals, real_requests: r.real_requests });
    } else say(`${lane.name}: situations are made (skipped)`);
    const situ = read<any>(join(situDir, "report.json"))!;
    m.steps[key("situations")] = { totals: situ.totals, real_requests: situ.real_requests, tests: situ.tests };
    save();

    // 2. which situations each writer is given
    const writerFor = (model: string): string | undefined => {
      const name = model.split("@")[0]!;
      const hits = Object.keys(cfg.writers).filter((f) => name === f || name.startsWith(`${f}/`) || model === f).sort((a, b) => b.length - a.length);
      return hits[0];
    };
    const briefs: ReturnType<typeof briefOf>[] = [];
    const modelOf = new Map<string, string>();
    for await (const x of each<Situation>(join(situDir, "situations.jsonl"))) {
      briefs.push(briefOf(x));
      modelOf.set(x.id, x.model);
    }
    const families = new Map<string, ReturnType<typeof briefOf>[]>();
    const noWriter = new Map<string, number>();
    for (const b of briefs) {
      const model = modelOf.get(b.id)!;
      const f = writerFor(model);
      if (!f) { noWriter.set(model, (noWriter.get(model) ?? 0) + 1); continue; }
      (families.get(f) ?? families.set(f, []).get(f)!).push(b);
    }
    const perFamily = [...families.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([f, bs]) => ({ f, ids: chunksFor(bs, [f], { maxChars: cfg.writerCallChars ?? 120_000, every, seed }).chunks[f]!.flat() }));
    const selected: { [family: string]: string[] } = {};
    for (let round = 0, taken = 0; taken < lane.situations && perFamily.some((p) => round < p.ids.length); round++) {
      for (const p of perFamily) if (round < p.ids.length && taken < lane.situations) { (selected[p.f] ??= []).push(p.ids[round]!); taken++; }
    }
    putJson(join(dir, "selected.json"), selected);
    m.steps[key("select")] = { situations: Object.fromEntries(Object.entries(selected).map(([f, ids]) => [f, ids.length])), available: Object.fromEntries(perFamily.map((p) => [p.f, p.ids.length])), seats_without_a_writer: Object.fromEntries(noWriter) };
    for (const s of m.sources.filter((s) => lane.pilots.includes(s.path))) s.seat_models = Object.fromEntries([...modelOf.values()].reduce((acc, v) => acc.set(v, (acc.get(v) ?? 0) + 1), new Map<string, number>()));

    // 3. writers
    const wanted = new Map<string, string>();
    for (const [f, ids] of Object.entries(selected)) for (const id of ids) wanted.set(id, f);
    const have = new Map<string, Situation>();
    if (wanted.size) for await (const x of each<Situation>(join(situDir, "situations.jsonl"))) if (wanted.has(x.id)) {
      if (x.test) throw new Error(`${x.id} is marked test and was about to be given to a writer`);
      have.set(x.id, x);
    }
    const extras = (cfg.extraInstructions ?? []).map((f) => readFileSync(existsSync(f) ? f : join(INSTRUCTIONS, f), "utf8"));
    const writerSystem = [inSituInstructions(), readFileSync(join(INSTRUCTIONS, "writer-addendum.txt"), "utf8"), ...extras].map((t) => t.trimEnd()).join("\n\n");
    const writerCall = readFileSync(join(INSTRUCTIONS, "writer-call.txt"), "utf8").trimEnd();
    const writtenBy: { [model: string]: { id: string; requests: string[] }[] } = {};
    let writeUse = noUse(), unanswered = 0, answered = 0;
    for (const [f, ids] of Object.entries(selected)) {
      const model = cfg.writers[f]!;
      const callChars = cfg.writerCallChars ?? 120_000;
      const groups: string[][] = [];
      let size = 0;
      for (const id of ids) {
        const s = have.get(id)!;
        const n = s.system.length + s.shown.length;
        if (!groups.length || size + n > callChars) { groups.push([]); size = 0; }
        groups.at(-1)!.push(id);
        size += n;
      }
      for (const [gi, group] of groups.entries()) {
        const file = join(dir, "written", `${safe(model)}-${String(gi + 1).padStart(3, "0")}.json`);
        const unitFp = fp(group, model, sha(writerSystem), sha(writerCall));
        let u = read<{ fp: string; answers: any[]; used: Used; reply_chars: number }>(file);
        if (u?.fp !== unitFp) {
          if (u) setAside(file, "stale");
          const user = `${writerCall}\n\n=== CHUNK ===\n${group.map((id) => JSON.stringify({ id, system: have.get(id)!.system, shown: have.get(id)!.shown })).join("\n")}\n`;
          let used = noUse(), answers: any[] = [];
          let reply = "";
          for (let attempt = 1; attempt <= 3 && !answers.length; attempt++) {
            const r = await caller.ask(model, { step: key("write"), unit: basename(file) }, { system: writerSystem, user, maxTokens: Math.min(24_000, 1_500 + 1_800 * group.length), subject: "translator-pipeline/writer", form: "writer" });
            used = addUse(used, r.used);
            reply = r.text;
            answers = objectsIn(r.text).filter((o) => typeof o.id === "string" && group.includes(o.id) && Array.isArray(o.requests));
            if (!answers.length) say(`${key("write")}: ${basename(file)}: no usable line in the reply (attempt ${attempt})`);
          }
          if (!answers.length) throw new Stopped("writer gave nothing", `${model} answered no situation of ${basename(file)} in three tries (its reply is in calls.jsonl)`);
          u = { fp: unitFp, answers, used, reply_chars: reply.length };
          putJson(file, u);
          say(`${key("write")}: ${basename(file)}: ${answers.length} of ${group.length} situations answered, ${answers.reduce((a, o) => a + o.requests.length, 0)} requests (${(used.cost_microusd / 1e6).toFixed(4)} USD)`);
        }
        answered += u.answers.length;
        unanswered += group.length - u.answers.length;
        writeUse = addUse(writeUse, u.used);
        (writtenBy[model] ??= []).push(...u.answers.map((o) => ({ id: o.id as string, requests: (o.requests as unknown[]).filter((r): r is string => typeof r === "string").slice(0, cfg.requestsPerSituation ?? 8) })));
      }
    }
    m.steps[key("write")] = { situations_answered: answered, situations_left_unanswered: unanswered, requests_written: Object.values(writtenBy).flat().reduce((a, o) => a + o.requests.length, 0), used: writeUse };
    save();

    // 4. take in: writers' requests, and the seats' own, as requests for readers
    const files: { file: string; writer: string }[] = [];
    for (const [model, answers] of Object.entries(writtenBy)) {
      const file = join(dir, "written", `${safe(model)}.jsonl`);
      put(file, lines(answers));
      files.push({ file, writer: model });
    }
    const pool = join(dir, "requests", "unlabelled.jsonl");
    const takeFp = fp(files.map((f) => sha(readFileSync(f.file, "utf8"))), situFp, cfg.realRequests, cfg.writtenRequests, seed);
    let taken = read<any>(join(dir, "requests", "taken.json"));
    if (taken?.fp !== takeFp || !existsSync(pool)) {
      const writtenFile = join(dir, "requests", "written-unlabelled.jsonl");
      mkdirSync(dirname(writtenFile), { recursive: true });
      const counts = files.length ? await takeInFiles(situDir, files, { out: writtenFile, seed }) : (put(writtenFile, ""), { kept: 0 } as any);
      const written = jsonl<Unlabelled>(writtenFile);
      const real = jsonl<Unlabelled>(join(situDir, "real-unlabelled.jsonl"));
      // (The caps cut a seeded order, not the first in the logs' order.)
      const order = (xs: Unlabelled[]) => [...xs].sort((a, b) => bucket(a.id, seed) - bucket(b.id, seed) || (a.id < b.id ? -1 : 1));
      const some = [...order(real).slice(0, cfg.realRequests ?? Infinity), ...order(written).slice(0, cfg.writtenRequests ?? Infinity)];
      put(pool, lines(some));
      blindFile(pool, { seed, out: join(dir, "requests", "blind.jsonl") });
      taken = { fp: takeFp, take_in: counts, real_available: real.length, written_available: written.length, real: Math.min(real.length, cfg.realRequests ?? Infinity), written: Math.min(written.length, cfg.writtenRequests ?? Infinity) };
      putJson(join(dir, "requests", "taken.json"), taken);
    }
    m.steps[key("requests")] = taken;
    const requests = jsonl<Unlabelled>(pool);
    const blind = jsonl<{ id: string; request: string; forms: string[] }>(join(dir, "requests", "blind.jsonl"));
    save();

    // 5. readers, blind: the translator's prompt, and the request with its forms
    const system = translatorSystem();
    const task = readFileSync(join(INSTRUCTIONS, "reader-call.txt"), "utf8").trimEnd();
    const answers: { [reader: string]: Map<string, string> } = {};
    for (const reader of cfg.readers) {
      const rdir = join(dir, "read", safe(reader));
      const got = new Map<string, string>();
      let readUse = noUse(), repaired = 0;
      const batchSize = cfg.readerBatch ?? 30, batchChars = cfg.readerBatchChars ?? 60_000;
      for (let pass = 0; pass < 2; pass++) {
        const left = blind.filter((b) => !got.has(b.id));
        if (!left.length) break;
        const batches: typeof blind[] = [];
        let size = 0;
        for (const b of left) {
          const n = JSON.stringify(b).length;
          if (!batches.length || batches.at(-1)!.length >= batchSize || size + n > batchChars) { batches.push([]); size = 0; }
          batches.at(-1)!.push(b);
          size += n;
        }
        for (const [bi, batch] of batches.entries()) {
          const file = join(rdir, `pass${pass}-${String(bi + 1).padStart(3, "0")}.json`);
          const unitFp = fp(batch.map((b) => b.id), reader, sha(system), sha(task));
          let u = read<{ fp: string; answers: BlindAnswer[]; used: Used; repaired?: number }>(file);
          if (u?.fp !== unitFp) {
            if (u) setAside(file, "stale");
            const r = await askReader(caller, reader, { step: key("read"), unit: `${safe(reader)}/${basename(file)}` }, system, task, batch);
            const mine = r.answers;
            const odd = implausiblyUniform(mine, false);
            if (odd) {
              putJson(`${file}.rejected-1`, { fp: unitFp, why: odd, answers: mine, used: r.used });
              throw new Stopped("reader uniform", `${reader}'s answers to ${basename(file)} are implausibly uniform (${odd}); they are set aside as ${basename(file)}.rejected-1 and the run stopped. A reader that answers by a rule is not a reader`);
            }
            u = { fp: unitFp, answers: mine, used: r.used, repaired: r.repaired };
            putJson(file, u);
            say(`${key("read")}: ${reader} ${basename(file)}: ${mine.length} of ${batch.length} answered${r.repaired ? `, ${r.repaired} with quotation marks escaped by hand, read as meant` : ""} (${(r.used.cost_microusd / 1e6).toFixed(4)} USD)`);
          }
          readUse = addUse(readUse, u.used);
          repaired += u.repaired ?? 0;
          for (const a of u.answers) if (!got.has(a.id)) got.set(a.id, a.program);
        }
      }
      const whole = [...got].map(([id, program]) => ({ id, program }));
      const odd = implausiblyUniform(whole, true);
      if (odd) {
        setAside(rdir, "rejected");
        throw new Stopped("reader uniform", `${reader}'s answers are implausibly uniform (${odd}); its answers are set aside (${basename(rdir)}.rejected-1) and the run stopped. A reader that answers by a rule is not a reader`);
      }
      answers[reader] = got;
      m.steps[key(`read ${reader}`)] = { requests: blind.length, answered: got.size, unanswered: blind.length - got.size, escaped_by_hand_and_repaired: repaired, used: readUse };
      save();
    }

    // 6. the basis union, then label
    const [ra, rb] = cfg.readers;
    const unioned: string[] = [];
    const finalA = new Map(answers[ra]!), finalB = new Map(answers[rb]!);
    for (const u of requests) {
      const a = finalA.get(u.id), b = finalB.get(u.id);
      if (a === undefined || b === undefined) continue;
      const forms = u.forms.map(formOfLine).filter((f): f is FormSpec => !!f);
      const both = unionBasis(u.request, a, b, { ...(u.currency ? { currency: u.currency } : {}), ...(forms.length ? { forms } : {}) });
      if (both) { finalA.set(u.id, both[0]); finalB.set(u.id, both[1]); unioned.push(u.id); }
    }
    const aFile = join(dir, "read", `answers-${safe(ra)}.union.jsonl`), bFile = join(dir, "read", `answers-${safe(rb)}.union.jsonl`);
    put(aFile, lines([...finalA].map(([id, program]) => ({ id, program }))));
    put(bFile, lines([...finalB].map(([id, program]) => ({ id, program }))));
    const labelDir = join(dir, "label");
    const lm = label(pool, [{ file: aFile, reader: ra }, { file: bFile, reader: rb }], labelDir);
    const examples = jsonl<Example>(join(labelDir, "examples.jsonl"));
    const rejects = jsonl<any>(join(labelDir, "rejects.jsonl"));
    // Agreement by function (by the first reader's answer): of the requests both answered, how many became examples.
    const kept = new Set(examples.map((e) => e.id));
    const why = new Map(rejects.map((r) => [r.id, r.why as string]));
    const table: Manifest["agreement"][string] = {};
    for (const u of requests) {
      const a = finalA.get(u.id);
      if (a === undefined || finalB.get(u.id) === undefined) continue;
      const fn = a.trim().startsWith("none(") ? a.trim().replace(/\s+/g, "") : a.trim().split("(")[0]!.replace(/^[a-z_0-9]+=/, "");
      const row = (table[fn] ??= { requests: 0, agreed: 0, disagreed: 0, other: 0 });
      row.requests++;
      if (kept.has(u.id)) row.agreed++;
      else if (why.get(u.id) === "disagreed") row.disagreed++;
      else row.other++;
    }
    m.agreement[lane.name] = Object.fromEntries(Object.entries(table).sort());
    m.steps[key("label")] = { requests: lm.requests, examples: lm.examples, dropped: lm.by_reason, basis_unioned: unioned.length, by_function: lm.by_function, kept_from: lm.kept_from, writers: lm.writers };
    say(`${key("label")}: ${lm.examples} examples of ${lm.requests} requests (${Object.entries(lm.by_reason).filter(([, n]) => n).map(([w, n]) => `${w} ${n}`).join(", ") || "none dropped"}; ${unioned.length} with the basis joined)`);
    save();
    return { examples, rejects, labelManifest: lm, seatModel: modelOf };
  }

  // ------------------------------------------------------------------------------------------------ the tests, the join, the export, the models
  async function tail() {
    const train = results["train"], test = results["test"];
    const testsDir = join(out, "tests");
    mkdirSync(testsDir, { recursive: true });
    const requestsOf = new Set<string>();
    // A test's line says where it is from, for a score by pilot, seat model and profile: the pilot's folder, the model
    // its seat ran on, and the profile its town was generated from (the pilot's batch.json, where it says).
    const logRuns = m.sources.filter((s) => s.logs.length).map((s) => ({ run: inRuns(s.logs[0]!), pilot: basename(s.path), profile: read<any>(join(s.path, "batch.json"))?.spec?.profile as unknown }));
    const seatModels = new Map<string, string>([...(results["train"]?.seatModel ?? []), ...(results["test"]?.seatModel ?? [])]);
    const placed = (e: Example) => {
      const run = logRuns.filter((r) => (e.source ?? e.id).startsWith(`${r.run}/`)).sort((a, b) => b.run.length - a.run.length)[0];
      const model = seatModels.get(e.source) ?? (e.written_by?.endsWith(" (seat)") ? e.written_by.slice(0, -7) : undefined);
      return { ...e, ...(run ? { pilot: run.pilot } : {}), ...(model ? { seat_model: model } : {}), ...(typeof run?.profile === "string" ? { profile: run.profile } : {}) };
    };
    const note = (name: string, file: string, xs: Example[]) => {
      put(join(testsDir, file), lines(xs.map(placed)));
      m.tests[name] = { file: join(testsDir, file), examples: xs.length, by_function: count(xs.map(functionOf)) };
      for (const e of xs) requestsOf.add(e.request.trim());
    };
    const count = (ks: string[]) => Object.fromEntries(Object.entries(ks.reduce((o: { [k: string]: number }, k) => ((o[k] = (o[k] ?? 0) + 1), o), {})).sort());
    // The test-only pilots' examples: tests, whatever their origin.
    if (test) {
      note("test pilots, their seats' real requests", "test-pilots-real.jsonl", test.examples.filter((e) => e.origin === "pilot"));
      note("test pilots, requests written in their situations", "test-pilots-written.jsonl", test.examples.filter((e) => e.origin !== "pilot"));
    }
    // A third of each kind of the training pilots' real requests is held back as a test; the rest, and the written, can train.
    let candidates: Example[] = [];
    if (train) {
      const real = train.examples.filter((e) => e.origin === "pilot");
      const byFn = new Map<string, Example[]>();
      for (const e of real) (byFn.get(functionOf(e)) ?? byFn.set(functionOf(e), []).get(functionOf(e))!).push(e);
      const held = new Set<string>();
      for (const es of byFn.values()) {
        const order = [...es].sort((a, b) => bucket(a.id, seed) - bucket(b.id, seed) || (a.id < b.id ? -1 : 1));
        for (const e of order.slice(0, Math.round(es.length / 3))) held.add(e.id);
      }
      note("held back, the training pilots' real requests (a third of each kind)", "held-back-real.jsonl", real.filter((e) => held.has(e.id)));
      candidates = train.examples.filter((e) => !held.has(e.id));
    }
    // Whole seat-days kept out of training: validation-real.
    const dayOne = cfg.validationDays ?? 10;
    const heldDays = candidates.filter((e) => bucket(seatDay(e), seed) % dayOne === 0);
    const heldIds = new Set(heldDays.map((e) => e.id));
    // Nothing that is in a test's words trains.
    const sameAsTest = candidates.filter((e) => requestsOf.has(e.request.trim()) && !heldIds.has(e.id));
    const dropIds = new Set(sameAsTest.map((e) => e.id));
    const newTrain = candidates.filter((e) => !heldIds.has(e.id) && !dropIds.has(e.id));

    // The standing set, less anything of a test-only pilot (its examples, by run) or in a test's words.
    // (An example names its run from the runs folder on, with `runs/` before it or, as the pilots' own requests do, without.)
    const testRuns = m.sources.filter((s) => s.test && s.logs.length).map((s) => inRuns(s.logs[0]!));
    const ofTestRun = (e: { id: string; source?: string }) => testRuns.some((r) => [e.source ?? "", e.id].some((x) => x.startsWith(`${r}/`) || x.startsWith(`runs/${r}/`)));
    const stand = (name: string): any[] => (cfg.standing && existsSync(join(cfg.standing, name)) ? jsonl<any>(join(cfg.standing, name)) : []);
    const standing = { train: stand("train.jsonl"), validation: stand("validation.jsonl"), real: stand("validation-real.jsonl") };
    let droppedRun = 0, droppedWords = 0;
    const clean = (rows: any[]) => rows.filter((e) => (ofTestRun(e) ? (droppedRun++, false) : requestsOf.has(String(e.request).trim()) ? (droppedWords++, false) : true));
    const joined = join(out, "joined");
    const repeat = cfg.repeat ?? 4;
    const trainRows = [...clean(standing.train), ...Array.from({ length: repeat }, () => newTrain).flat()];
    const valRows = clean(standing.validation);
    const realRows = [...clean(standing.real), ...heldDays, ...(cfg.testsInValidationReal && test ? test.examples : [])];
    const counts = {
      standing: { train: standing.train.length, validation: standing.validation.length, validation_real: standing.real.length },
      new_examples: train?.examples.length ?? 0, held_back_as_tests: (train?.examples.length ?? 0) - candidates.length,
      new_in_training: newTrain.length, repeated: repeat, new_validation_real: heldDays.length, test_examples_in_validation_real: cfg.testsInValidationReal && test ? test.examples.length : 0,
      dropped_new_same_as_a_test: sameAsTest.length, dropped_standing_same_as_a_test: droppedWords, dropped_standing_from_test_runs: droppedRun,
    };
    put(join(joined, "train.jsonl"), lines(trainRows));
    put(join(joined, "validation.jsonl"), lines(valRows));
    put(join(joined, "validation-real.jsonl"), lines(realRows));
    put(join(joined, "NOTE"), `The standing set${cfg.standing ? ` (${cfg.standing})` : " (none)"} plus, ${repeat} times each, the pipeline's new examples (${newTrain.length}); ${heldDays.length} new examples of whole seat-days (one in ${dayOne}) are in validation-real, kept out of training. Tests are in ../tests and never join.\n`);
    m.steps["join"] = counts;
    say(`join: ${trainRows.length} training lines (${newTrain.length} new, ${repeat} times each), ${valRows.length} validation, ${realRows.length} validation-real; ${counts.dropped_new_same_as_a_test + counts.dropped_standing_same_as_a_test} left out for being in a test's words`);
    save();

    // Steps for the model.
    const data = join(out, "data");
    const exportFp = fp(sha(readFileSync(join(joined, "train.jsonl"), "utf8")), sha(readFileSync(join(joined, "validation.jsonl"), "utf8")), sha(readFileSync(join(joined, "validation-real.jsonl"), "utf8")));
    const stamped = read<{ fp: string }>(join(out, "export.done.json"));
    if (stamped?.fp !== exportFp || !existsSync(join(data, "export.json"))) {
      say("export: steps for the model");
      const r = Bun.spawnSync(["bun", "translator/model/export.ts", joined, data], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(`export failed: ${r.stderr.toString().slice(-600)}`);
      putJson(join(out, "export.done.json"), { fp: exportFp });
    } else say("export: done (skipped)");
    m.data = { joined, data, counts: read<any>(join(data, "export.json")) };
    save();
    if (!cfg.train) { say('"train": false: stopped after the export'); return; }

    // The models, on a rented GPU.
    const seeds = cfg.seeds?.length ? cfg.seeds : [1];
    const name = safe(cfg.name ?? basename(out));
    const runs = seeds.map((s) => ({ name: `${name}-s${s}`, encoder: cfg.encoder!, seed: s }));
    const models = join(out, "models");
    const missing = runs.filter((r) => !existsSync(join(models, r.name, "report.json")) || !existsSync(join(models, r.name, "eval.json")));
    if (missing.length) {
      say(`train: ${missing.map((r) => r.name).join(", ")} on a rented GPU`);
      const env = { ...process.env, OIKOS_POD_STATE: join(out, "pod"), OIKOS_POD_MODELS: models, OIKOS_REPO: REPO, ...(cfg.deadlineHours ? { SECONDS_LIMIT: String(Math.round(cfg.deadlineHours * 3600)) } : {}) };
      const code = hooks.pod
        ? hooks.pod({ data, runs: missing, models, state: join(out, "pod") })
        : Bun.spawnSync(["zsh", join(REPO, "translator/model/pod/pod.sh"), "run", data, ...missing.map((r) => `${r.name}:${r.encoder}:${r.seed}${cfg.trainExtra?.length ? `:${cfg.trainExtra.join(" ")}` : ""}`)], { cwd: REPO, env, stdout: "inherit", stderr: "inherit" }).exitCode;
      // (The pod script ends its pod on every way out, and says in <out>/pod/pod.log what the provider then lists.)
      if (code !== 0) throw new Stopped("training", `pod.sh run ended with ${code}${code === 5 ? " (THE POD COULD NOT BE CONFIRMED ENDED: look at once)" : ""}; the runs already home are kept, and the same command goes on`);
    }
    // Each run on the test sets made here (the test-only pilots' requests, and the real requests held back), scored on
    // this machine: `oikos translator-eval --model decide/NAME --only-sets --set FILE` does the same by hand.
    const sets = Object.entries(m.tests).filter(([, t]) => t.examples > 0);
    for (const r of sets.length ? runs : []) {
      if (!existsSync(join(models, r.name, "report.json"))) continue;
      const file = join(models, r.name, "eval-sets.json");
      const setsFp = fp(sets.map(([name, t]) => [name, sha(readFileSync(t.file, "utf8"))]), TRANSLATOR_VERSION);
      let scored = read<{ fp: string; sets: { [name: string]: SetReport } }>(file);
      if (scored?.fp !== setsFp) {
        if (scored) setAside(file, "stale");
        const a = hooks.adapter ? hooks.adapter(`decide/${r.name}`) : { adapter: new DecideAdapter(r.name, { dir: join(models, r.name) }), prices: { [`decide/${r.name}`]: { input: 0, output: 0, cache_read: 0, cache_write: 0 } } };
        scored = { fp: setsFp, sets: {} };
        try {
          for (const [name, t] of sets) scored.sets[name] = await evaluateSet(a.adapter, loadSet(t.file), { name, file: t.file, prices: a.prices });
        } finally {
          (a.adapter as { close?: () => void }).close?.();
        }
        putJson(file, scored);
      }
      (m.test_scores ??= {})[r.name] = Object.fromEntries(Object.entries(scored.sets).map(([name, s]) => [name, { all: s.all, by: s.by, forms_not_as_written: s.forms_not_as_written }]));
      for (const [name, s] of Object.entries(scored.sets)) say(`${r.name} on "${name}": ${s.all.passed}/${s.all.of} right, ${s.all.no_draft} no draft, ${s.all.wrong_draft} wrong drafts`);
      save();
    }
    for (const r of runs) {
      const report = read<any>(join(models, r.name, "report.json"));
      const last = report?.epochs?.at(-1);
      const log = existsSync(join(models, r.name, "eval.log")) ? readFileSync(join(models, r.name, "eval.log"), "utf8") : "";
      m.runs[r.name] = {
        encoder: r.encoder, seed: r.seed, folder: join(models, r.name),
        ...(last ? { validation: [last.validation_right, last.of], validation_real: [last.real_right, last.real_of] } : {}),
        translator_test: /^Translator test.*$/m.exec(log)?.[0], real_requests: /^Real requests.*$/m.exec(log)?.[0],
      };
    }
    save();
  }
}

/** A short plain report of a run. */
export function plainReport(m: Manifest): string {
  const L: string[] = [];
  const usd = (u: Used) => `${(u.cost_microusd / 1e6).toFixed(4)} USD`;
  L.push(`Translator pipeline: ${m.status}`);
  L.push(`Sources: ${m.sources.map((s) => `${basename(s.path)}${s.test ? " (test-only)" : ""}`).join(", ")}`);
  for (const [k, v] of Object.entries(m.steps)) {
    if (k.endsWith("/situations")) L.push(`  ${k}: ${v.totals.situations} situations, ${v.totals.usable} usable, ${v.real_requests.kept} of the seats' own requests kept`);
    else if (k.endsWith("/select")) L.push(`  ${k}: given to writers ${Object.entries(v.situations).map(([f, n]) => `${f} ${n}`).join(", ") || "none"}`);
    else if (k.endsWith("/write")) L.push(`  ${k}: ${v.situations_answered} situations answered, ${v.requests_written} requests (${usd(v.used)})`);
    else if (k.endsWith("/requests")) L.push(`  ${k}: ${v.real} real and ${v.written} written requests to the readers`);
    else if (k.includes("/read ")) L.push(`  ${k}: ${v.answered} of ${v.requests} answered (${usd(v.used)})`);
    else if (k.endsWith("/label")) L.push(`  ${k}: ${v.examples} examples of ${v.requests}; dropped ${Object.entries(v.dropped).filter(([, n]) => n).map(([w, n]) => `${w} ${n}`).join(", ") || "none"}; basis joined in ${v.basis_unioned}`);
    else if (k === "join") L.push(`  join: ${v.new_in_training} new examples in training (x${v.repeated}), ${v.new_validation_real} to validation-real, ${v.held_back_as_tests} held back as tests, ${v.dropped_new_same_as_a_test + v.dropped_standing_same_as_a_test} dropped as in a test's words`);
  }
  for (const [lane, t] of Object.entries(m.agreement)) {
    const rows = Object.entries(t).map(([fn, r]) => `${fn} ${r.agreed}/${r.requests}`);
    if (rows.length) L.push(`  agreement (${lane}): ${rows.join(", ")}`);
  }
  for (const [n, t] of Object.entries(m.tests)) L.push(`  test set "${n}": ${t.examples} examples (${t.file})`);
  if (m.data) L.push(`  data: ${m.data.data}`);
  for (const [n, r] of Object.entries(m.runs)) L.push(`  run ${n}: ${r.validation ? `validation ${r.validation[0]}/${r.validation[1]}` : "no report yet"}${r.real_requests ? `; ${r.real_requests.replace(/ on decide[^:]*:/, ":").replace(/Cost.*/, "").trim()}` : ""}`);
  for (const [run, by] of Object.entries(m.test_scores ?? {})) for (const [name, s] of Object.entries(by)) {
    L.push(`  run ${run} on "${name}": ${s.all.passed}/${s.all.of} right, ${s.all.no_draft} no draft, ${s.all.wrong_draft} wrong drafts`);
    for (const d of ["pilot", "seat_model", "profile"]) if (s.by[d] && Object.keys(s.by[d]!).length > 1) L.push(`    by ${d.replace("_", " ")}: ${Object.entries(s.by[d]!).map(([v, t]) => `${v} ${t.passed}/${t.of}`).join(", ")}`);
  }
  L.push(`Cost: ${usd(m.usage.total)} in ${m.usage.total.calls} calls (${m.usage.total.input_tokens} input tokens, ${m.usage.total.output_tokens} output)${Object.keys(m.usage.by_model).length > 1 ? `; ${Object.entries(m.usage.by_model).map(([k, u]) => `${k} ${usd(u)}`).join(", ")}` : ""}`);
  return L.join("\n");
}
