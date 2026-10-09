// Generated parts of the translator's training data, written and blind-checked through the repo's own adapters
// (`oikos translator-data-batch <config.json> <PART>...`), and the cases banked for a later translator
// (`oikos translator-v2-data`, translator/train/v2.ts).
//
// A generated part was, until now, written by file: `translator-data --briefs` makes the plan and the briefs, writers
// working on files hand back requests, `translator-data-write` checks them, a blind reader's answers go through
// `translator-data-check`. The writers and the reader were subagents started by hand. Here the same steps call the
// adapters (`claude-code/…`, `codex/…`), as the pipeline does for requests written in situ (pipeline.ts), so that a
// part of ten thousand requests is one command that can be stopped and resumed:
//
//   write   each writer's briefs (`briefs-<name>.jsonl`) go to its model, a batch at a call, under the instructions a
//           writer by file is given (`writerInstructions`); the answers are `{id, request}`. A brief left unanswered is
//           asked for once more. Each batch leaves a file with a fingerprint of what was asked; one that is whole and
//           the same is skipped.
//   take in `writtenData`: every mechanical check a model's request gets, the examples, the built refusals.
//   read    every example's request goes, blind (the request and the forms, shuffled), to a reader that is NOT the
//           model that wrote it (`readers`: a reader for each writer's model), under the translator's own prompt and
//           the pipeline's reader task. A batch of implausibly uniform answers is set aside and the run stops.
//   check   the reader's programs against the gold ones by meaning (blind.ts): what agrees is `checked.jsonl`, the rest
//           is `disagreed.jsonl` and is never training data. Agreement is counted by function, style, asker, writer
//           and currency. Then the leak check (eval/held-out.ts): anything checked that shares five words running
//           with a held-out case is taken out (`leaked.jsonl`) and counted, by case id only.
//
// Every call is in the run's ledger (`calls.jsonl`: usage, cost as reported, the prompt and the answer), and the
// spending limit is the run's. Nothing is deleted: a stale file is renamed. A usage limit is waited out as the
// pipeline's is, and then the run stops, to be resumed with the same command.
//
// The banked part: `v2Cases` reads what real seats did in pilots' logs (never a test-only pilot's, never a situation
// marked as a test's, never a `do`: a seat's request is the first translator's data and may be a held-back test) and
// adds generated cases; `v2Batch` has them written, checked mechanically, read blind and compared (v2.ts).

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { TRANSLATOR_VERSION, translatorSystem } from "@oikos/translator";
import { loadHeldOut } from "@oikos/translator/eval";
import { leaks, sharesWording } from "../../translator/eval/held-out";
import { blindRequests, checkAnswers, type BlindAnswer } from "../../translator/train/blind";
import { DATA_VERSION, functionOf, type Example } from "../../translator/train/data";
import { carriedLength, kindOf, notCarried, readerUses, sameUses, useOf, v2Generated, v2Plan, v2ReaderSystem, v2WriterSystem, V2_VERSION, type Knows, type Use, type V2Case, type V2Example, type V2PlanItem } from "../../translator/train/v2";
import { logsIn } from "./corpus";
import { situationsOf } from "./in-situ";
import { askReader, Caller, implausiblyUniform, objectsIn, pilotMeta, Stopped, type Hooks, type Used } from "./pipeline";
import { writerInstructions, writtenData, type Plan } from "./training";

const READER_TASK = join(import.meta.dir, "../../translator/train/in-situ/reader-call.txt");
const NEVER = /astra/i;
/** Said to a reader of generated parts after the pipeline's task (2026-10-09: in the first part read, one reader gave
 * every standing routine said to hold "from now on" a `first` of no days, on the task's sentence about things that
 * start at once; the translator's own worked example of such a routine has none). */
const READER_NOTE = "That last sentence is for something the request says, in so many words, starts now, at once or today. A standing routine said to hold \"from now on\" has no first= for that, as your instructions' own example of one shows.";

export interface BroadConfig {
  /** The run's folder: the ledger (`calls.jsonl`) and the log are here; the parts are folders given to the command. */
  out: string;
  /** The model for each writer's name, as the parts' briefs files name them (`briefs-<name>.jsonl`): `provider/model`. */
  writers: { [name: string]: string };
  /** Who reads a writer's requests blind, by the writer's model (`provider/model`): never the same model. `*`: whoever
   * reads what no model wrote (the built refusals) and any writer not named. */
  readers: { [writer: string]: string };
  /** The spending limit in USD for every call the run makes, as the adapters reckon cost (required). */
  budget: number;
  /** Briefs to a writer's call (16) and the most characters of them (60,000); requests to a reader's call (30). */
  writeBatch?: number;
  writeBatchChars?: number;
  readBatch?: number;
  /** Calls under way at once (4). */
  jobs?: number;
  waitMinutes?: number;
  maxWaitHours?: number;
  callMinutes?: number;
  seed?: number;
}

export function checkBroadConfig(c: BroadConfig): BroadConfig {
  const bad = (m: string): never => { throw new Error(`translator-data-batch config: ${m}`); };
  if (!c.out) bad("`out` (the run's folder) is required");
  if (!c.writers || !Object.keys(c.writers).length) bad("`writers` (a model for each writer's name) is required");
  if (!c.readers || !c.readers["*"]) bad("`readers` needs a reader for each writer's model, and `*` for the rest");
  if (!(c.budget > 0)) bad("`budget` (a spending limit in USD) is required");
  const family = (m: string) => m.split("@")[0]!;
  for (const m of [...Object.values(c.writers), ...Object.values(c.readers)]) {
    if (!/^[^/]+\/.+/.test(m)) bad(`"${m}" is not provider/model`);
    if (NEVER.test(m)) bad(`${m} is never used`);
  }
  for (const w of new Set(Object.values(c.writers))) {
    const r = c.readers[w] ?? c.readers["*"]!;
    if (family(r) === family(w)) bad(`${w} would read its own writing: name another reader for it`);
  }
  return c;
}

// ------------------------------------------------------------------------------------------------------ files

const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const fp = (...parts: unknown[]) => sha(JSON.stringify(parts)).slice(0, 16);
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
const jsonl = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : []);
const lines = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : "");
const read = <T>(file: string): T | undefined => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return undefined; } };
function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
const putJson = (path: string, x: unknown) => put(path, `${JSON.stringify(x, null, 1)}\n`);
function setAside(path: string, why: string): void {
  if (!existsSync(path)) return;
  let n = 1;
  while (existsSync(`${path}.${why}-${n}`)) n++;
  renameSync(path, `${path}.${why}-${n}`);
}
const pad = (n: number) => String(n).padStart(4, "0");

/** So many things done at once, each in turn; the first failure stops the taking of new ones and is thrown when those under way are back. */
async function pool<T>(items: T[], jobs: number, each: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, items.length)) }, async () => {
    while (next < items.length && failed === undefined) {
      const i = next++;
      try { await each(items[i]!, i); } catch (e) { failed ??= e; }
    }
  }));
  if (failed !== undefined) throw failed;
}

/** Items cut into batches of at most `n`, and of at most `chars` characters by `size` (a batch always has one). */
export function batches<T>(items: T[], n: number, chars = Infinity, size: (x: T) => number = () => 0): T[][] {
  const out: T[][] = [];
  let cur: T[] = [], used = 0;
  for (const x of items) {
    if (cur.length && (cur.length >= n || used + size(x) > chars)) { out.push(cur); cur = []; used = 0; }
    cur.push(x);
    used += size(x);
  }
  if (cur.length) out.push(cur);
  return out;
}

// ------------------------------------------------------------------------------------------------------ writing

/** What a writer is told in a call, before its instructions: the task a writer by file was given, worded for a call. */
export const WRITER_CALL = [
  "You are a writer of plain-language requests. The system message is your instructions. Below is BRIEFS: lines of {id, kind, brief}.",
  "For EACH brief write one request, from that brief alone, as your instructions say (kind \"request\": the instructions for requests; kind \"refusal\": the instructions for refusals), as if it were the only one you had been given. Write every request yourself, one at a time, in your own words: do not generate them with a script or a template, and vary how they open and how they are put. Follow each brief's Style paragraph closely: where it says how many sentences, how long each is, how long the whole is, or what kind of writer this is (talking round the point, flat and simple, typing with slips), keep to it, and where a brief says who is asking, write as that person. Sentences shown in brackets in a brief show the kind and the length wanted, never the words to use: do not reuse them. Where a brief asks you to mark words with ⟦ and ⟧, do so exactly as it says, once, and use those marks nowhere else. Add no id, amount, record or person the brief doesn't give. The commonest failure is an id, amount or quoted text that is not copied character for character: check each one.",
  "There is no file to write: hand the answers in as your answer, in the form asked for (`hand_in`): `answers`, a list with an object for each brief, {\"id\": \"<the brief's id, copied exactly>\", \"request\": \"<your request>\"}, in the same order as the briefs. Each request is a plain string, written as it is.",
].join("\n");

/** The same for the turns of the banked part (v2.ts). */
export const V2_WRITER_CALL = [
  "The system message is your instructions. Below is BRIEFS: lines of {id, brief}.",
  "For EACH brief write one turn, from that brief alone, as your instructions say, as if it were the only one you had been given. Write every turn yourself, one at a time, in your own words: do not generate them with a script or a template, and vary how they open and how they are put. Follow each brief's Style paragraph and write as whoever it says is asking. The commonest failure is an id, a number or words to be given as written that are not copied character for character: check each one.",
  "There is no file to write: hand the answers in as your answer, in the form asked for (`hand_in`): `answers`, a list with an object for each brief, {\"id\": \"<the brief's id, copied exactly>\", \"request\": \"<the turn you wrote>\"}, in the same order as the briefs. Each is a plain string, written as it is.",
].join("\n");

export const V2_READER_CALL = [
  "The system message is your instructions. Below is TURNS: lines of {\"id\": \"...\", \"turn\": \"...\", \"reports\": [...], \"awaiting\": [...]}, in no particular order. `reports` are the reports this participant can look into, each by its id with its title; `awaiting` are the references of what is waiting for its yes or no.",
  "Read each turn yourself and work it out on its own merits: do not sort or answer them with a script, keyword rules or a pattern, and do not assume what kinds of turn the file holds (it is a mixture).",
  "There is no file to write: hand the answers in as your answer, in the form asked for (`hand_in`): `answers`, a list with an object for each turn, {\"id\": \"<the same id, copied exactly>\", \"uses\": [ … ]}, in the same order as the input; each use has `tool` and the parts of its input that the turn gives, each a plain string (a number in digits; true or false for a yes-or-no part), a list of strings, or a list of small objects, and no part the turn doesn't give.",
].join("\n");

interface Brief { id: string; kind?: string; brief: string }
interface Unit<T> { fp: string; model: string; ids: string[]; answers: T[]; missing: string[]; used: Used; ms: number }

/**
 * A writer's briefs written, a batch at a call: `dir/written/<name>/NNNN.json` each. Returns every `{id, request}` it
 * has. A brief the call left unanswered is asked for once more, by itself with the others so left.
 */
async function writeBriefs(caller: Caller, cfg: BroadConfig, dir: string, name: string, model: string, briefs: Brief[], o: { system: string; task: string; subject: string; say: (s: string) => void; part: string }): Promise<{ id: string; request: string }[]> {
  const cut = batches(briefs, cfg.writeBatch ?? 16, cfg.writeBatchChars ?? 60_000, (b) => b.brief.length);
  const out: { id: string; request: string }[][] = new Array(cut.length);
  let done = 0;
  await pool(cut, cfg.jobs ?? 4, async (batch, k) => {
    const file = join(dir, "written", safe(name), `${pad(k)}.json`);
    const user = (bs: Brief[]) => `${o.task}\n\n=== BRIEFS ===\n${bs.map((b) => JSON.stringify(b)).join("\n")}\n`;
    const mark = fp(model, o.system, user(batch));
    const had = read<Unit<{ id: string; request: string }>>(file);
    if (had?.fp === mark) return void (out[k] = had.answers);
    if (had) setAside(file, "stale");
    const ids = new Set(batch.map((b) => b.id));
    const take = (text: string, into: Map<string, string>) => { for (const a of objectsIn(text)) if (typeof a.id === "string" && ids.has(a.id) && typeof a.request === "string" && a.request.trim() && !into.has(a.id)) into.set(a.id, a.request); };
    const got = new Map<string, string>();
    const maxTokens = (n: number) => Math.min(30_000, 2_000 + 600 * n);
    const r = await caller.ask(model, { step: `${o.part}/write/${name}`, unit: pad(k) }, { system: o.system, user: user(batch), maxTokens: maxTokens(batch.length), subject: o.subject, form: "request" });
    take(r.text, got);
    let used = r.used, ms = r.ms;
    const left = batch.filter((b) => !got.has(b.id));
    if (left.length) {
      const again = await caller.ask(model, { step: `${o.part}/write/${name}`, unit: `${pad(k)}-again` }, { system: o.system, user: user(left), maxTokens: maxTokens(left.length), subject: o.subject, form: "request" });
      take(again.text, got);
      used = { input_tokens: used.input_tokens + again.used.input_tokens, output_tokens: used.output_tokens + again.used.output_tokens, cache_read_tokens: used.cache_read_tokens + again.used.cache_read_tokens, cache_write_tokens: used.cache_write_tokens + again.used.cache_write_tokens, cost_microusd: used.cost_microusd + again.used.cost_microusd, calls: used.calls + again.used.calls };
      ms += again.ms;
    }
    const answers = batch.filter((b) => got.has(b.id)).map((b) => ({ id: b.id, request: got.get(b.id)! }));
    putJson(file, { fp: mark, model, ids: batch.map((b) => b.id), answers, missing: batch.filter((b) => !got.has(b.id)).map((b) => b.id), used, ms } satisfies Unit<{ id: string; request: string }>);
    out[k] = answers;
    if (++done % 5 === 0 || done === cut.length) o.say(`${o.part}: ${name} (${model}) ${done} of ${cut.length} batches written this sitting`);
  });
  return out.flat();
}

// ------------------------------------------------------------------------------------------------------ one part

export interface PartReport {
  part: string; briefs: number; written: { [writer: string]: number }; examples: number; rejects: number; no_request: number;
  read: number; agreed: number; disagreed: number; unanswered: number; leaked: number; kept: number;
  agreement: { [by: string]: { [key: string]: { agreed: number; disagreed: number; unanswered: number } } };
}

/** How a world writes money, in a few words: for counting agreement by the shape of the currency, not by its code. */
export function currencyShape(c: Example["currency"]): string {
  if (!c) return "none";
  const x = c as any;
  return [x.symbol ? (x.symbol_after ? "sign after" : x.symbol_spaced ? "sign spaced" : /^[A-Za-z$]{2,}/.test(x.symbol) ? "sign of letters" : "sign before") : "code only", `${c.minor_units} decimals`, ...(x.decimal_mark === "," ? ["decimal comma"] : []), ...(Array.isArray(x.grouping) ? ["groups of two"] : []), ...(x.number_words ? ["number words"] : []), ...(x.country_sign ? ["country sign"] : [])].join(", ");
}

/**
 * One part folder (a plan and its briefs, from `translator-data --briefs --writers …`) taken from briefs to checked
 * examples. `only`: stop after a step ("write": the requests are written and taken in; nothing is read).
 */
export async function runPart(cfg: BroadConfig, dir: string, caller: Caller, say: (s: string) => void, o: { only?: "write"; heldOut?: Hooks["heldOut"] } = {}): Promise<PartReport> {
  const part = dir.split("/").filter(Boolean).pop()!;
  const plan = read<Plan>(join(dir, "plan.json"));
  if (!plan) throw new Error(`${dir}: no plan.json (make the part with translator-data --briefs --writers …)`);
  const seed = cfg.seed ?? plan.seed;
  const system = writerInstructions();
  // ---- write
  const files: { file: string; writer: string }[] = [];
  const written: { [writer: string]: number } = {};
  let briefsN = 0;
  // (The writers one after another, each with its calls several at once: a part's writers are different models, with
  // limits of their own, and a limit reached on one says nothing of the next.)
  for (const name of plan.writers) {
    const model = cfg.writers[name];
    if (!model) throw new Error(`${part}: its plan names the writer "${name}", and the config has no model for it`);
    const briefs = jsonl<Brief & { spare?: boolean }>(join(dir, `briefs-${safe(name)}.jsonl`)).map(({ id, kind, brief }) => ({ id, kind, brief }));
    briefsN += briefs.length;
    const answers = await writeBriefs(caller, cfg, dir, name, model, briefs, { system, task: WRITER_CALL, subject: "translator-data-batch/writer", say, part });
    const file = join(dir, `requests-${safe(name)}.jsonl`);
    put(file, lines(answers));
    files.push({ file, writer: model });
    written[model] = (written[model] ?? 0) + answers.length;
  }
  // ---- take in
  const taken = await writtenData(dir, files);
  say(`${part}: ${taken.examples} examples of ${briefsN} briefs (${taken.rejects} requests rejected by the mechanical checks, ${taken.no_request} with no request)`);
  const report: PartReport = { part, briefs: briefsN, written, examples: taken.examples, rejects: taken.rejects, no_request: taken.no_request, read: 0, agreed: 0, disagreed: 0, unanswered: 0, leaked: 0, kept: 0, agreement: {} };
  if (o.only === "write") return report;
  // ---- read, blind, each request by a model that did not write it
  const examples = jsonl<Example>(join(dir, "examples.jsonl"));
  const readerOf = (e: Example) => (e.written_by ? cfg.readers[e.written_by] : undefined) ?? cfg.readers["*"]!;
  const byReader = new Map<string, Example[]>();
  for (const e of examples) (byReader.get(readerOf(e)) ?? byReader.set(readerOf(e), []).get(readerOf(e))!).push(e);
  const task = `${readFileSync(READER_TASK, "utf8").trim()}\n${READER_NOTE}`;
  const promptText = translatorSystem();
  const answersOf = new Map<string, BlindAnswer[]>();
  for (const [reader, own] of byReader) {
    const blind = blindRequests(own, seed);
    const cut = batches(blind, cfg.readBatch ?? 30);
    const got: BlindAnswer[][] = new Array(cut.length);
    let done = 0;
    await pool(cut, cfg.jobs ?? 4, async (batch, k) => {
      const file = join(dir, "read", safe(reader), `${pad(k)}.json`);
      const mark = fp(reader, promptText, task, batch);
      const had = read<Unit<BlindAnswer>>(file);
      if (had?.fp === mark) return void (got[k] = had.answers);
      if (had) setAside(file, "stale");
      const r = await askReader(caller, reader, { step: `${part}/read/${reader}`, unit: pad(k) }, promptText, task, batch);
      let answers = r.answers, used = r.used, ms = r.ms;
      const left = batch.filter((b) => !answers.some((a) => a.id === b.id));
      if (left.length) {
        const again = await askReader(caller, reader, { step: `${part}/read/${reader}`, unit: `${pad(k)}-again` }, promptText, task, left);
        answers = [...answers, ...again.answers];
        used = { ...used, cost_microusd: used.cost_microusd + again.used.cost_microusd, input_tokens: used.input_tokens + again.used.input_tokens, output_tokens: used.output_tokens + again.used.output_tokens, calls: used.calls + again.used.calls };
        ms += again.ms;
      }
      // (A reader's answers are never made by a rule: a batch that looks as if it was is set aside and the run stops.)
      const uniform = implausiblyUniform(answers, false);
      if (uniform) {
        putJson(`${file}.uniform`, { fp: mark, model: reader, answers, why: uniform });
        throw new Stopped("reader", `${part}: ${reader}'s batch ${pad(k)} is implausibly uniform (${uniform}): set aside as ${file}.uniform`);
      }
      putJson(file, { fp: mark, model: reader, ids: batch.map((b) => b.id), answers, missing: batch.filter((b) => !answers.some((a) => a.id === b.id)).map((b) => b.id), used, ms } satisfies Unit<BlindAnswer>);
      got[k] = answers;
      if (++done % 5 === 0 || done === cut.length) say(`${part}: ${reader} ${done} of ${cut.length} batches read this sitting`);
    });
    answersOf.set(reader, got.flat());
  }
  // ---- check: each reader's answers against the gold programs of what it read
  const checked: Example[] = [], disagreed: unknown[] = [], unanswered: Example[] = [];
  const readers: { [reader: string]: unknown } = {};
  const by: PartReport["agreement"] = { function: {}, style: {}, asker: {}, writer: {}, reader: {}, currency: {}, tag: {} };
  const count = (kind: string, key: string | undefined, what: "agreed" | "disagreed" | "unanswered") => { const k = key ?? "(none)"; ((by[kind] ??= {})[k] ??= { agreed: 0, disagreed: 0, unanswered: 0 })[what]++; };
  const tagOf = new Map(plan.items.flatMap((t) => (t.kind === "request" && t.gold.tag ? [[t.gold.family ?? t.gold.program, t.gold.tag] as [string, string]] : [])));
  const tally = (e: Example, what: "agreed" | "disagreed" | "unanswered", reader: string) => {
    count("function", functionOf(e), what); count("style", e.style ?? "(built)", what); count("asker", e.asker, what); count("writer", e.written_by ?? "(built)", what); count("reader", reader, what);
    if (e.kind === "positive") { count("currency", currencyShape(e.currency), what); count("tag", (e.gold && tagOf.get(e.gold)) || "(none)", what); }
  };
  for (const [reader, own] of byReader) {
    const r = checkAnswers(own, answersOf.get(reader) ?? [], reader);
    readers[reader] = r.report;
    checked.push(...r.checked); disagreed.push(...r.disagreed); unanswered.push(...r.unanswered);
    r.checked.forEach((e) => tally(e, "agreed", reader)); r.disagreed.forEach((e) => tally(e, "disagreed", reader)); r.unanswered.forEach((e) => tally(e, "unanswered", reader));
  }
  // ---- the leak check: nothing checked shares wording with a held-out case (by case id and count only)
  const heldOut = o.heldOut === false ? undefined : (o.heldOut as ReturnType<typeof loadHeldOut>) ?? loadHeldOut();
  const shares = heldOut?.length ? sharesWording(heldOut) : () => false;
  const leaked = checked.filter((e) => shares(e.request));
  const clean = checked.filter((e) => !shares(e.request));
  const named = heldOut?.length ? leaks(heldOut, [{ name: part, text: checked.map((e) => e.request).join("\n\n") }]).map((l) => l.id) : [];
  const after = heldOut?.length ? leaks(heldOut, [{ name: part, text: clean.map((e) => e.request).join("\n\n") }]).length : 0;
  put(join(dir, "checked.jsonl"), lines(clean));
  put(join(dir, "disagreed.jsonl"), lines(disagreed));
  put(join(dir, "unanswered.jsonl"), lines(unanswered));
  if (leaked.length) put(join(dir, "leaked.jsonl"), lines(leaked));
  Object.assign(report, { read: examples.length, agreed: checked.length, disagreed: disagreed.length, unanswered: unanswered.length, leaked: leaked.length, kept: clean.length, agreement: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort())])) });
  const manifestFile = join(dir, "manifest.json");
  const manifest = read<{ [k: string]: unknown }>(manifestFile) ?? {};
  putJson(manifestFile, { ...manifest, written_through: "adapters (orchestrator/src/broad.ts)", writers_models: cfg.writers, translator_prompt: TRANSLATOR_VERSION,
    blind_check: { readers, read: examples.length, agreed: checked.length, disagreed: disagreed.length, unanswered: unanswered.length, by: report.agreement },
    leak_check: { held_out_cases_here: heldOut?.length ?? 0, cases_named: [...new Set(named)].sort(), examples_taken_out: leaked.length, cases_named_after: after }, kept: clean.length });
  say(`${part}: read ${examples.length}, agreed ${checked.length}, disagreed ${disagreed.length}, unanswered ${unanswered.length}; leak check took out ${leaked.length}; kept ${clean.length}`);
  return report;
}

/** `oikos translator-data-batch <config.json> <PART>...`: each part from briefs to checked examples, in turn. */
export async function runBroad(cfg: BroadConfig, parts: string[], hooks: Hooks = {}, o: { only?: "write" } = {}): Promise<{ status: string; parts: PartReport[]; usage: { [model: string]: Used } }> {
  checkBroadConfig(cfg);
  const out = resolve(cfg.out);
  mkdirSync(out, { recursive: true });
  const logFile = join(out, "batch.log");
  const say = (line: string) => { const l = `${new Date().toISOString().slice(0, 16).replace("T", " ")} ${line}`; (hooks.log ?? console.log)(l); appendFileSync(logFile, `${l}\n`); };
  const ledger = join(out, "calls.jsonl");
  const caller = new Caller(cfg, ledger, hooks, say);
  const reports: PartReport[] = [];
  let status = "complete";
  try {
    for (const p of parts) {
      const dir = resolve(p);
      const r = existsSync(join(dir, "v2-plan.json")) ? await runV2(cfg, dir, caller, say, { ...(hooks.heldOut !== undefined ? { heldOut: hooks.heldOut } : {}) }) : await runPart(cfg, dir, caller, say, { ...o, ...(hooks.heldOut !== undefined ? { heldOut: hooks.heldOut } : {}) });
      reports.push(r);
      putJson(join(out, `report-${r.part}.json`), r);
    }
  } catch (e) {
    if (!(e instanceof Stopped)) throw e;
    status = `stopped (${e.reason}): ${e.message.slice(0, 300)}`;
    say(status);
  }
  return { status, parts: reports, usage: usageOf(ledger) };
}

/** What a run used, by model, read from its ledger (so a resumed run's total is the whole run's). */
export function usageOf(ledger: string): { [model: string]: Used } {
  const by: { [model: string]: Used } = {};
  for (const e of jsonl<any>(ledger)) if (e.annotation === "usage") {
    const u = (by[`${e.provider}/${e.model}`] ??= { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_microusd: 0, calls: 0 });
    u.input_tokens += e.input_tokens ?? 0; u.output_tokens += e.output_tokens ?? 0; u.cache_read_tokens += e.cache_read_tokens ?? 0; u.cache_write_tokens += e.cache_write_tokens ?? 0; u.cost_microusd += e.cost_microusd ?? 0; u.calls++;
  }
  return by;
}

// ------------------------------------------------------------------------------------------------------ the banked part

export interface V2Options {
  out: string;
  /** Pilots' folders to read what seats did from. A test-only pilot is refused, not skipped silently. */
  pilots?: string[];
  /** The most cases from pilots (all of them, if absent), and how many generated. */
  fromPilots?: number;
  generated?: number;
  /** The most characters of words to be carried as written in one case (700): a longer letter or note is no brief. */
  maxCarried?: number;
  writers: string[];
  seed?: number;
}

/** What a situation shows that the seat could name: the reports with a title and an id beside it, and the drafts waiting. */
function knowsOf(text: string, uses: Use[]): Knows {
  const reports = new Map<string, string | undefined>();
  for (const m of text.matchAll(/"([^"\n]{3,80})" \(([a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)\)/g)) if (!reports.has(m[2]!)) reports.set(m[2]!, m[1]!);
  for (const u of uses) if (u.tool === "look" && typeof u.input.report === "string" && !reports.has(u.input.report)) reports.set(u.input.report, undefined);
  const used = new Set(uses.flatMap((u) => (u.tool === "look" ? [u.input.report] : [])));
  const all = [...reports].map(([id, title]) => ({ id, ...(title ? { title } : {}) }));
  const awaiting = [...new Set([...(text.match(/\bdraft\.[a-z0-9-]+\.[0-9]+\b/g) ?? []), ...uses.flatMap((u) => (u.tool === "confirm" && typeof u.input.ref === "string" ? [u.input.ref] : []))])].slice(-8);
  return { reports: [...all.filter((r) => used.has(r.id)), ...all.filter((r) => !used.has(r.id)).slice(0, 10)], ...(awaiting.length ? { awaiting } : {}) };
}

/**
 * Cases from what real seats did: every use of a tool other than `do`, one case each, and turns of two or three such
 * uses as whole cases; spread over the kinds of case in turn, so a pilot's many notes do not crowd out its few looks
 * by date. Counts say what was left out and why.
 */
export async function v2FromPilots(pilots: string[], o: { max?: number; maxCarried?: number; seed?: number } = {}): Promise<{ cases: V2Case[]; counts: { [k: string]: number } }> {
  const counts: { [k: string]: number } = { situations: 0, test_situations: 0, uses: 0, do: 0, too_long: 0, said_before: 0, kept: 0 };
  const byKind = new Map<string, V2Case[]>();
  const seen = new Set<string>();
  const cap = o.maxCarried ?? 700;
  for (const p of pilots) {
    const dir = resolve(p);
    if (pilotMeta(dir).test) throw new Error(`${dir} is marked test-only: its seats' turns are never a source`);
    for (const log of logsIn(dir)) {
      const { situations } = await situationsOf(log);
      for (const x of situations) {
        counts.situations!++;
        // (A situation where a real test case was asked, or which quotes one, is left out whole.)
        if (x.test) { counts.test_situations!++; continue; }
        const all = (x.uses ?? []).map((u) => useOf(u.name, u.input)).filter((u): u is Use => !!u);
        counts.uses! += all.length;
        counts.do! += all.filter((u) => u.tool === "do").length;
        const others = all.filter((u) => u.tool !== "do");
        const add = (uses: Use[], n: string) => {
          if (carriedLength(uses) > cap) return void counts.too_long!++;
          const key = JSON.stringify(uses);
          if (seen.has(key)) return void counts.said_before!++;
          seen.add(key);
          const c: V2Case = { id: `p-${sha(`${x.id}/${n}/${key}`).slice(0, 12)}`, source: "pilot", from: `${x.id}/${n}`, kind: kindOf(uses), uses, knows: knowsOf(`${x.system}\n${x.shown}`, uses) };
          (byKind.get(c.kind) ?? byKind.set(c.kind, []).get(c.kind)!).push(c);
        };
        others.forEach((u, i) => add([u], `use-${i + 1}`));
        // (A whole turn, where it is two or three things and none of them an act: the order said is the order done.)
        if (others.length === all.length && all.length >= 2 && all.length <= 3) add(all, "turn");
      }
    }
  }
  // In turn by kind, each kind's in a seeded order, until there are enough.
  const { sampler, shuffled } = await import("../../translator/train/data");
  const rand = sampler((o.seed ?? 1) + 61);
  const queues = [...byKind.keys()].sort().map((k) => shuffled(byKind.get(k)!, rand));
  const cases: V2Case[] = [];
  const max = o.max ?? Infinity;
  for (let i = 0, empty = 0; cases.length < max && empty < queues.length; i++) {
    const q = queues[i % queues.length]!;
    if (q.length) { cases.push(q.shift()!); empty = 0; } else empty++;
  }
  counts.kept = cases.length;
  return { cases, counts };
}

export interface V2Plan { version: string; seed: number; writers: string[]; pilots: string[]; counts: { [k: string]: number }; by_kind: { [k: string]: number }; items: V2PlanItem[] }

/** `oikos translator-v2-data`: the plan of the banked part (`v2-plan.json`), with no model called. */
export async function v2Cases(o: V2Options): Promise<V2Plan> {
  const seed = o.seed ?? 1;
  const real = o.pilots?.length ? await v2FromPilots(o.pilots, { ...(o.fromPilots !== undefined ? { max: o.fromPilots } : {}), ...(o.maxCarried ? { maxCarried: o.maxCarried } : {}), seed }) : { cases: [], counts: {} };
  const made = o.generated ? v2Generated({ n: o.generated, seed }) : [];
  // (Dealt alternately while both last, so every writer and every style meets both kinds.)
  const cases: { case: V2Case; asker?: string }[] = [];
  for (let i = 0; i < Math.max(real.cases.length, made.length); i++) {
    if (i < real.cases.length) cases.push({ case: real.cases[i]! });
    if (i < made.length) cases.push(made[i]!);
  }
  const items = v2Plan(cases, { writers: o.writers, seed });
  const by_kind: { [k: string]: number } = {};
  for (const t of items) by_kind[`${t.case.source} ${t.case.kind}`] = (by_kind[`${t.case.source} ${t.case.kind}`] ?? 0) + 1;
  const plan: V2Plan = { version: V2_VERSION, seed, writers: o.writers, pilots: (o.pilots ?? []).map((p) => resolve(p)), counts: { ...real.counts, generated: made.length }, by_kind: Object.fromEntries(Object.entries(by_kind).sort()), items };
  mkdirSync(o.out, { recursive: true });
  putJson(join(o.out, "v2-plan.json"), plan);
  put(join(o.out, "v2-writer-instructions.txt"), `${v2WriterSystem()}\n`);
  put(join(o.out, "v2-reader-instructions.txt"), `${v2ReaderSystem()}\n`);
  return plan;
}

/** The banked part from its plan to checked cases: written, checked mechanically, read blind by a model that did not
 * write, compared; the leak check on what is kept. */
export async function runV2(cfg: BroadConfig, dir: string, caller: Caller, say: (s: string) => void, o: { heldOut?: Hooks["heldOut"] } = {}): Promise<PartReport> {
  const part = dir.split("/").filter(Boolean).pop()!;
  const plan = read<V2Plan>(join(dir, "v2-plan.json"))!;
  const system = v2WriterSystem();
  const texts = new Map<string, { text: string; by: string }>();
  const written: { [writer: string]: number } = {};
  for (const name of plan.writers) {
    const model = cfg.writers[name];
    if (!model) throw new Error(`${part}: its plan names the writer "${name}", and the config has no model for it`);
    const briefs = plan.items.filter((t) => t.writer === name).map((t) => ({ id: t.id, brief: t.brief }));
    const answers = await writeBriefs(caller, cfg, dir, name, model, briefs, { system, task: V2_WRITER_CALL, subject: "translator-v2-data/writer", say, part });
    for (const a of answers) if (!texts.has(a.id)) texts.set(a.id, { text: a.request.trim(), by: model });
    written[model] = (written[model] ?? 0) + answers.length;
  }
  // ---- take in: what a turn must carry, said once only
  const heldOut = o.heldOut === false ? undefined : (o.heldOut as ReturnType<typeof loadHeldOut>) ?? loadHeldOut();
  const shares = heldOut?.length ? sharesWording(heldOut) : () => false;
  const examples: V2Example[] = [], rejects: unknown[] = [];
  const seen = new Set<string>();
  let noText = 0, leaked = 0;
  for (const t of plan.items) {
    const w = texts.get(t.id);
    if (!w) { noText++; continue; }
    const why = notCarried(w.text, t.case.uses, t.case.knows) ?? (seen.has(w.text.toLowerCase()) ? "said before" : undefined);
    if (why) { rejects.push({ id: t.id, text: w.text, uses: t.case.uses, why, written_by: w.by, style: t.style }); continue; }
    if (shares(w.text)) { leaked++; continue; }
    seen.add(w.text.toLowerCase());
    examples.push({ id: t.id, text: w.text, uses: t.case.uses, knows: t.case.knows, kind: t.case.kind, style: t.style, asker: t.asker, written_by: w.by, source: t.case.source, ...(t.case.from ? { from: t.case.from } : {}) });
  }
  put(join(dir, "v2-examples.jsonl"), lines(examples));
  put(join(dir, "v2-rejects.jsonl"), lines(rejects));
  say(`${part}: ${examples.length} turns of ${plan.items.length} briefs (${rejects.length} rejected by the mechanical checks, ${noText} with no turn, ${leaked} sharing wording with a held-out case)`);
  // ---- read blind
  const readerOf = (e: V2Example) => cfg.readers[e.written_by] ?? cfg.readers["*"]!;
  const byReader = new Map<string, V2Example[]>();
  for (const e of examples) (byReader.get(readerOf(e)) ?? byReader.set(readerOf(e), []).get(readerOf(e))!).push(e);
  const readerSystem = v2ReaderSystem();
  const { sampler, shuffled } = await import("../../translator/train/data");
  const got = new Map<string, Use[]>();
  for (const [reader, own] of byReader) {
    const blind = shuffled([...own].sort((a, b) => (a.id < b.id ? -1 : 1)), sampler((cfg.seed ?? plan.seed) + 4099)).map((e) => ({ id: e.id, turn: e.text, reports: e.knows.reports.map((r) => (r.title ? `${r.id} "${r.title}"` : r.id)), awaiting: e.knows.awaiting ?? [] }));
    const cut = batches(blind, cfg.readBatch ?? 30, 60_000, (b) => b.turn.length + 200);
    let done = 0;
    await pool(cut, cfg.jobs ?? 4, async (batch, k) => {
      const file = join(dir, "read", safe(reader), `${pad(k)}.json`);
      const user = (bs: typeof batch) => `${V2_READER_CALL}\n\n=== TURNS ===\n${bs.map((b) => JSON.stringify(b)).join("\n")}\n`;
      const mark = fp(reader, readerSystem, user(batch));
      let unit = read<Unit<{ id: string; uses: unknown[] }>>(file);
      if (unit?.fp !== mark) {
        if (unit) setAside(file, "stale");
        const ids = new Set(batch.map((b) => b.id));
        const r = await caller.ask(reader, { step: `${part}/read/${reader}`, unit: pad(k) }, { system: readerSystem, user: user(batch), maxTokens: Math.min(30_000, 2_000 + 500 * batch.length), subject: "translator-v2-data/reader", form: "turns" });
        const answers = objectsIn(r.text).filter((a) => typeof a.id === "string" && ids.has(a.id) && Array.isArray(a.uses));
        unit = { fp: mark, model: reader, ids: batch.map((b) => b.id), answers, missing: batch.filter((b) => !answers.some((a) => a.id === b.id)).map((b) => b.id), used: r.used, ms: r.ms };
        putJson(file, unit);
      }
      for (const a of unit.answers) got.set(a.id, readerUses(a));
      if (++done % 5 === 0 || done === cut.length) say(`${part}: ${reader} ${done} of ${cut.length} batches read this sitting`);
    });
  }
  // ---- compare
  const checked: V2Example[] = [], disagreed: unknown[] = [], unanswered: V2Example[] = [];
  const by: PartReport["agreement"] = { kind: {}, tool: {}, style: {}, asker: {}, writer: {}, reader: {}, source: {} };
  const count = (kind: string, key: string, what: "agreed" | "disagreed" | "unanswered") => void ((by[kind]![key] ??= { agreed: 0, disagreed: 0, unanswered: 0 })[what]++);
  for (const e of examples) {
    const answer = got.get(e.id);
    const what = answer === undefined ? "unanswered" : sameUses(e.uses, answer) ? "agreed" : "disagreed";
    count("kind", e.kind, what); count("tool", e.uses.length === 1 ? e.uses[0]!.tool : "(several)", what); count("style", e.style, what); count("asker", e.asker, what); count("writer", e.written_by, what); count("reader", readerOf(e), what); count("source", e.source, what);
    if (what === "agreed") checked.push({ ...e, verified_by: readerOf(e) });
    else if (what === "disagreed") disagreed.push({ ...e, answer, reader: readerOf(e) });
    else unanswered.push(e);
  }
  put(join(dir, "v2-checked.jsonl"), lines(checked));
  put(join(dir, "v2-disagreed.jsonl"), lines(disagreed));
  put(join(dir, "v2-unanswered.jsonl"), lines(unanswered));
  const named = heldOut?.length ? leaks(heldOut, [{ name: part, text: checked.map((e) => e.text).join("\n\n") }]).length : 0;
  const agreement = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort())]));
  const report: PartReport = { part, briefs: plan.items.length, written, examples: examples.length, rejects: rejects.length, no_request: noText, read: examples.length, agreed: checked.length, disagreed: disagreed.length, unanswered: unanswered.length, leaked, kept: checked.length, agreement };
  putJson(join(dir, "v2-manifest.json"), { version: V2_VERSION, data_version: DATA_VERSION, seed: plan.seed, pilots: plan.pilots, counts: plan.counts, planned_by_kind: plan.by_kind, writers_models: cfg.writers, readers: cfg.readers, ...report,
    leak_check: { held_out_cases_here: heldOut?.length ?? 0, turns_taken_out: leaked, cases_named_after: named }, sha256: sha(checked.map((e) => JSON.stringify(e)).join("\n")) });
  say(`${part}: read ${examples.length}, agreed ${checked.length}, disagreed ${disagreed.length}, unanswered ${unanswered.length}; kept ${checked.length}`);
  return report;
}
