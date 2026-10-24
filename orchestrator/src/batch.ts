// Batch runs: one world, several runs, each in its own process (with its
// own kernel) so they run in parallel. A run's result never depends on how it
// was scheduled: each is the same as running it alone.
//
// Two seeds, and they are different things:
// - the **town's seed** is the spec's `seed`: what the generator draws the town from (who lives there, how old, in
//   which homes, which firms). One spec seed, one town.
// - the **run's seed** is the config's `seed`, which the kernel's randomness starts from: what happens in a town
//   once it is drawn.
// `seeds: N` runs ONE town N times: the town is generated once, from the spec's seed, and the runs' seeds are that seed
// and the N - 1 after it. It varies what happens, never who is there. `towns: T` generates T towns, from the spec's
// seed and the T - 1 after it, and runs each `seeds` times (a town's runs are seeded from its own seed, as they would
// be with the spec's seed set to it: town 2 of `towns: 3` is the run `--set seed=2` makes).
//
// A batch folder holds each run's log, anchors and summary; batch.json (what
// ran, with which versions, and how long it took); the measurement tables
// (measure/, DuckDB over Parquet); and the cost report (cost.txt, cost.json).

import { availableParallelism } from "node:os";
import { insideSlot, take } from "../../scripts/slots";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { exportLogs, MEASURE_VERSION } from "@oikos/measure";
import { costReport } from "./cost";
import { chooseModel } from "./models";
import { KernelDied, KernelLogFailed, kernelBinary } from "./kernel";
import { MEASURE_FAILED_FILE } from "./pilot-state";
import { clearForFreshRun, compressLog, currentLogs, isLog, isStoppedLog, logsOf, realModelIn } from "./logs";
import { logToResume, recordedCalls, prepareResume, Serving } from "./resume";
import { ORCHESTRATOR_VERSION, runWorld, RunStuck, type RunOptions, type RunSummary } from "./run";
import type { LlmAdapter } from "@oikos/participants/llm";
import { stallMs, Watchdog } from "./watchdog";
import { callRecorder } from "./experiment-seats";

/** A world file (JSON or YAML), with `--set path=value` overrides applied, generated if it's a spec. */
export async function loadWorld(path: string, sets: string[] = []): Promise<{ config: any; spec?: any; generator?: string }> {
  const text = await Bun.file(path).text();
  const v = path.endsWith(".yaml") || path.endsWith(".yml") ? Bun.YAML.parse(text) : JSON.parse(text);
  for (const s of sets) setPath(v, s);
  if (v?.generate) {
    const { generate, GENERATOR_VERSION } = await import("@oikos/worlds/generator/generate");
    // What its model seats are told about what the town is (VISION 15, point 1): the spec's `framing`, a disclosure by
    // name or { disclosure, reason }. It is the run's, not the town's: the generator is not shown it, and the town
    // made is the same under any; the seats' framing in the config, and so in the log's header, records the
    // disclosure and its reason (participants/src/llm/framing.ts). Absent: as the generator writes it, honest disclosure.
    const { framing, ...town } = v;
    const config = generate(town);
    if (framing !== undefined) { const { applyFraming } = await import("@oikos/participants/llm"); applyFraming(config, framing); }
    return { config, spec: v, generator: GENERATOR_VERSION };
  }
  return { config: v };
}

/** `a.b.c=value`: value is read as JSON if it can be (numbers, true, [..]), otherwise as text. */
export function setPath(obj: any, assignment: string): void {
  const i = assignment.indexOf("=");
  if (i <= 0) throw new Error(`--set expects path=value, got "${assignment}"`);
  const path = assignment.slice(0, i).split(".");
  const raw = assignment.slice(i + 1);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  let o = obj;
  for (const k of path.slice(0, -1)) {
    if (typeof o[k] !== "object" || o[k] === null) o[k] = {};
    o = o[k];
  }
  o[path.at(-1)!] = value;
}

export interface RunRecord extends RunSummary {
  /** The run's seed (the kernel's randomness). */
  seed: number;
  /** The town's seed (the generator's), where the batch named its towns (`towns`); else the spec's own, unsaid. */
  town?: number;
  wallMs: number;
}

/** A run's id: the world and the run's seed; in a batch of several towns, the town's seed too. */
export const runIdFor = (world: string, seed: number, town?: number) => `${basename(world).replace(/\.(json|ya?ml)$/, "")}${town === undefined ? "" : `.town${town}`}.seed${seed}`;

/** One run of a batch: the run's seed, and the town's where the batch names its towns. */
export interface Planned { seed: number; town?: number }

/**
 * The runs of a batch (see the top of this file). Without `towns`: one town, the spec's, run `seeds` times from the
 * config's seed up, as it always was. With `towns`: that many towns, generated from the spec's seed up, each run
 * `seeds` times from its own seed up.
 */
export function planRuns(configSeed: number, seeds: number, towns?: number, specSeed?: number): Planned[] {
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error(`--seeds is a whole number of runs, 1 or more, not ${seeds}`);
  if (towns === undefined) return Array.from({ length: seeds }, (_, i) => ({ seed: configSeed + i }));
  if (!Number.isInteger(towns) || towns < 1) throw new Error(`--towns is a whole number of towns, 1 or more, not ${towns}`);
  if (specSeed === undefined || !Number.isInteger(specSeed)) throw new Error("--towns needs a world generated from a spec with a seed: a world given whole is one town");
  return Array.from({ length: towns }, (_, k) => Array.from({ length: seeds }, (_, i) => ({ town: specSeed + k, seed: specSeed + k + i }))).flat();
}

/** How a run is named to a reader: its seed, and its town's where the batch names its towns. */
export const runName = (r: Planned) => (r.town === undefined ? `seed ${r.seed}` : `town ${r.town}, seed ${r.seed}`);

/** What a batch ran, in words: how many towns, and how many runs of each (so "N seeds" is never read as N towns). */
export function batchShape(runs: Planned[], generated: boolean, specSeed?: number): string {
  const towns = [...new Set(runs.map((r) => r.town))];
  const range = (xs: number[]) => (xs.length === 1 ? `${xs[0]}` : xs.every((x, i) => i === 0 || x === xs[i - 1]! + 1) ? `${xs[0]} to ${xs.at(-1)}` : xs.join(", "));
  if (towns[0] === undefined) {
    const seeds = runs.map((r) => r.seed);
    const town = generated ? `1 town (generated from seed ${specSeed})` : "1 town (the world as given)";
    return `${town}, ${seeds.length} run${seeds.length === 1 ? "" : "s"} of it (run seed${seeds.length === 1 ? "" : "s"} ${range(seeds)})`;
  }
  const per = runs.length / towns.length;
  return `${towns.length} town${towns.length === 1 ? "" : "s"} (generated from seed${towns.length === 1 ? "" : "s"} ${range(towns as number[])}), ${per} run${per === 1 ? "" : "s"} of each (run seeds from each town's own seed)`;
}

/** Behaviour modules from a researcher's own file (`--modules`): its export `modules`, keyed by the names worlds use. */
export async function loadModules(file?: string): Promise<RunOptions["modules"]> {
  if (!file) return undefined;
  const m = await import(resolve(file));
  if (!m.modules || typeof m.modules !== "object") throw new Error(`${file} should export \`modules\`: { [name]: BehaviourModule }`);
  return m.modules;
}

/** How a run's two translators are arranged, from what was asked: `then` unless it says `beside`; and nothing may be
 * said of an arrangement where no first translator is named. */
export function translatorArrangement(o: { translatorFirst?: string; translatorArrangement?: string }): "then" | "beside" {
  const a = o.translatorArrangement;
  if (a !== undefined && a !== "then" && a !== "beside") throw new Error(`--translator-arrangement is then or beside, not "${a}"`);
  if (a !== undefined && !o.translatorFirst) throw new Error("--translator-arrangement needs --translator-first: the translator that answers first");
  return a ?? "then";
}

/** Run one seed in this process and write its summary next to its log. Or resume a run that stopped (`resume`: its
 * log): run again from its own config, with every model response served from that log (resume.ts, D59). `town`: the
 * town's seed (the spec's `seed` set to it, after any `sets`), named in the run's id; absent, the spec's own. */
export async function runOne(o: { debriefWording?: string; world?: string; seed?: number; town?: number; out?: string; resume?: string; overwrite?: boolean; stop?: StopSignal; until?: number; sets?: string[]; modules?: string; model?: string; translatorModel?: string; translatorFirst?: string; translatorArrangement?: string; budgetUsd?: number; baseUrl?: string; recordObservations?: string; recordDecisions?: string; logDetail?: string; consult?: boolean; consultAvoid?: string; composer?: boolean; captureCitizens?: string }): Promise<RunRecord> {
  let config: any, runId: string, out: string, serving: Serving | undefined, stoppedLog: string | undefined;
  let consult = !!o.consult;
  let composerReal = !!o.composer;
  // (Which wording of the debrief's questions: "a" unless a rewording check asks for "b".)
  if (o.debriefWording !== undefined && o.debriefWording !== "a" && o.debriefWording !== "b") throw new Error(`--debrief-wording is a or b, not "${o.debriefWording}"`);
  let debriefWording = o.debriefWording as "a" | "b" | undefined;
  let recordObservations = o.recordObservations;
  let recordDecisions = o.recordDecisions;
  if (o.captureCitizens !== undefined && o.captureCitizens !== "on" && o.captureCitizens !== "off") throw new Error(`--capture-citizens is on or off, not "${o.captureCitizens}"`);
  if (recordDecisions !== undefined && !/^[a-z_]+(,[a-z_]+)*$/.test(recordDecisions)) throw new Error(`--record-decisions is full, none or a list of areas (want,found), not "${recordDecisions}"`);
  // What an audit found unstable (its report's avoid list), left out of the sparse mind.
  let consultAvoid: string[] | undefined = o.consultAvoid ? (JSON.parse(await Bun.file(o.consultAvoid).text()).avoid as string[]) : undefined;
  if (o.resume) {
    // (A compressed log is written out plain first, and kept; a folder names its one run that stopped short.)
    const r = prepareResume(await logToResume(o.resume));
    ({ config, runId, outDir: out, stoppedLog } = r);
    consult = r.consult;
    composerReal = r.composer;
    if (r.debriefWording) debriefWording = r.debriefWording;
    // (What the run was recording, it goes on recording: its replayed part is written again, the same.)
    recordObservations = r.recording?.observations;
    recordDecisions = r.recording?.decisions;
    consultAvoid = r.consultAvoid;
    serving = new Serving(recordedCalls(r.stoppedLog));
  } else {
    config = { ...(await loadWorld(o.world!, townSets(o.sets, o.town))).config, seed: o.seed };
    // How much the log keeps (docs/reliability.md): lean for quick test runs, full (the default) when the data matters.
    if (o.logDetail) config.log = { ...config.log, detail: o.logDetail };
    runId = runIdFor(o.world!, o.seed!, o.town);
    out = o.out ?? "runs";
    // Runs are never overwritten: a folder that already holds this run's log refuses a fresh one (logs.ts).
    await clearForFreshRun(out, runId, o.overwrite);
  }
  // A real model (or the mock, by default): its adapter, price and the run's spending limit.
  const real = o.model ? chooseModel(o.model, { budgetUsd: o.budgetUsd, baseUrl: o.baseUrl }) : undefined;
  // The translator on its own model, if one is named (sharing the run's spending limit).
  const tr = real && o.translatorModel ? chooseModel(o.translatorModel, { budgetUsd: o.budgetUsd, baseUrl: o.baseUrl }) : undefined;
  // A translator that answers first, if one is named (our own trained model: translator/src/arrangement.ts), with the
  // translator above behind it; without --model the one behind is the mock. It is loaded here, once, before the run:
  // a model that cannot load stops the run now, and no request pays for the load.
  const arrangement = translatorArrangement(o);
  const first = o.translatorFirst ? chooseModel(o.translatorFirst, { budgetUsd: o.budgetUsd, baseUrl: o.baseUrl, first: true }) : undefined;
  await (first?.adapter as { ready?: () => Promise<void> } | undefined)?.ready?.();
  // Every call a model is actually asked (not one served again from a resumed run's log) is recorded apart from the log,
  // as an experiment's forks are (experiment-seats.ts callRecorder): `<runId>.calls.jsonl` beside it, per call its
  // subject, purpose, model, tokens, cost, wall time and error; cost.json sums them (`calls`). Wall time is kept out of
  // the log, which is what the world did; this is how the calls went. A run with no model (the mock) records nothing.
  const calls = callRecorder(join(out, `${runId}.calls.jsonl`), { seed: Number(config.seed), arm: "run", seat: "" });
  const named = (m: { adapter: LlmAdapter }, name: string) => calls.wrap(m.adapter, name);
  const serve = (a: LlmAdapter) => (serving ? serving.wrap(a) : a);
  // The composing models, for real, where the run asks and the world has a mix (docs/behaviour/founding.md): each
  // under the run's one spending limit. (A model reached through a command-line tool is given two minutes an
  // attempt here: a model that does not answer must not hold a piece up.)
  const mix = composerReal ? ((config.dials?.composer?.mix ?? []) as { model: string }[]) : [];
  if (composerReal && !mix.length) throw new Error("--composer: this world has no composer (set living.composer)");
  const composers = mix.map((m) => ({ name: m.model, ...chooseModel(m.model, { budgetUsd: o.budgetUsd, baseUrl: o.baseUrl, timeoutMs: 120_000 }) }));
  const oneBudget = real?.budget ?? composers.find((c) => c.budget)?.budget;
  const modules = await loadModules(o.modules);
  mkdirSync(out, { recursive: true });
  const t0 = performance.now();
  // D59: a run that stalls is stopped by its watchdog (with a diagnosis); one that fails says what it was doing.
  const diagnosisPath = join(out, `${runId}.failure.json`);
  const watchdog = new Watchdog({ stallMs: stallMs(), diagnosisPath, runId });
  let s: RunSummary;
  try {
    s = await runWorld({ config, runId, outDir: out, until: o.until, watchdog, ...(o.captureCitizens !== undefined ? { captureCitizens: o.captureCitizens === "on" } : {}), ...(o.resume ? { resumed: true } : {}), ...(debriefWording ? { debriefWording } : {}), ...(o.stop ? { stop: o.stop } : {}), ...(modules ? { modules } : {}), ...(consult ? { consult, ...(consultAvoid ? { consultAvoid } : {}) } : {}), ...(recordObservations ? { recordObservations: recordWho(recordObservations) } : {}), ...(recordDecisions !== undefined && recordDecisions !== "full" ? { recordDecisions } : {}),
      ...(real ? { adapter: serve(named(real, o.model!)), prices: { ...real.prices, ...(tr?.prices ?? {}), ...(first?.prices ?? {}) }, ...(real.budget ? { budget: real.budget } : {}) } : first ? { prices: first.prices } : {}),
      ...(tr ? { translatorAdapter: serve(named(tr, o.translatorModel!)) } : {}),
      ...(first ? { translatorFirst: serve(named(first, o.translatorFirst!)), translatorArrangement: arrangement } : {}),
      ...(composers.length ? { composerAdapters: new Map(composers.map((c) => [c.name, serve(named(c, c.name))])), prices: { ...(real?.prices ?? {}), ...(tr?.prices ?? {}), ...(first?.prices ?? {}), ...Object.assign({}, ...composers.map((c) => c.prices)) }, ...(oneBudget ? { budget: oneBudget } : {}) } : {}),
      ...(serving ? { resumedFrom: { log: basename(stoppedLog!), serving } } : {}) });
  } catch (e) {
    const err = e as Error;
    const reason = e instanceof KernelDied ? "kernel died" : e instanceof KernelLogFailed ? "log not written" : e instanceof RunStuck ? "stuck" : "error";
    writeFileSync(diagnosisPath, JSON.stringify({ run_id: runId, reason, error: err.message, doing: watchdog.last, at: new Date().toISOString(),
      what_next: "Fix the cause, then resume the run: `oikos resume <log>` re-runs it with every model response served from this log." }, null, 2));
    throw e;
  } finally {
    watchdog.stop();
    // A model that runs as a process of ours (the trained translator) is ended with the run: left up, it kept a
    // stopped run's process from exiting (pilot 11).
    for (const m of [real, tr, first, ...composers]) (m?.adapter as { close?: () => void } | undefined)?.close?.();
  }
  const rec: RunRecord = { ...s, seed: Number(config.seed), ...(o.town !== undefined && !o.resume ? { town: o.town } : {}), wallMs: Math.round(performance.now() - t0) };
  writeFileSync(join(out, `${runId}.summary.json`), JSON.stringify(rec, null, 2));
  return rec;
}

/** Leave a note in a run's folder that its measures failed, for whatever looks at the folder later (the pilot queue's status, alerts and report). */
function noteMeasureFailed(out: string, why: string): void {
  try { writeFileSync(join(out, MEASURE_FAILED_FILE), `${why}\n`); } catch { /* (the folder is out of reach: the failure is still in problems) */ }
}

/**
 * cost.json with how the calls went: the `<run>.calls.jsonl` files in the folder (every call a model was actually asked,
 * across every attempt of a resumed run) summed by model, by model and purpose, and by subject, with wall time (p50,
 * p95, max, total) and errors. Unchanged when no call was recorded (a mock run, or a run from before 2026-10-24).
 */
export function withCalls<T extends object>(json: T, out: string): T & { calls?: unknown } {
  const files = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith(".calls.jsonl")).sort() : [];
  const lines: any[] = files.flatMap((f) => readFileSync(join(out, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return undefined; } }).filter(Boolean));
  if (!lines.length) return json;
  const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : null);
  const group = (key: (x: any) => string) => {
    const by: { [k: string]: any[] } = {};
    for (const x of lines) (by[key(x)] ??= []).push(x);
    return Object.fromEntries(Object.entries(by).sort(([a], [b]) => a.localeCompare(b)).map(([k, xs]) => {
      const ok = xs.filter((x) => !x.error), ms = ok.map((x) => Number(x.ms) || 0);
      const sum = (f: string) => xs.reduce((a, x) => a + (Number(x[f]) || 0), 0);
      return [k, { calls: ok.length, errors: xs.length - ok.length, input_tokens: sum("input_tokens"), cache_read_tokens: sum("cache_read_tokens"), cache_write_tokens: sum("cache_write_tokens"), output_tokens: sum("output_tokens"), cost_usd: sum("cost_microusd") / 1e6, ms: { p50: q(ms, 0.5), p95: q(ms, 0.95), max: ms.length ? Math.max(...ms) : null, total: ms.reduce((a, b) => a + b, 0) } }];
    }));
  };
  return { ...json, calls: { files, total: group(() => "all").all, by_model: group((x) => String(x.model)), by_model_and_purpose: group((x) => `${x.model} ${x.purpose}`), by_subject: group((x) => String(x.subject)) } };
}

/**
 * The cost report with the platform's overrun of the limit in it, where the end of a run (its debriefs and exit accounts,
 * never cut off by the limit) spent beyond it: how much, and for which seats. A line in cost.txt and a field of cost.json.
 * It is not the run reaching its limit (that is its `stopped`) and not any seat's own spending.
 */
export function withPlatformOverrun<T extends { text: string }>(cost: T, runs: { runId: string; platformOverrun?: { microusd: number; by_subject: { [subject: string]: number } } }[]): { text: string; json: Omit<T, "text"> & { text: undefined; platform_overrun_of_limit?: { microusd: number; by_subject: { [subject: string]: number }; runs: { [runId: string]: number } } } } {
  const over = runs.filter((r) => r.platformOverrun?.microusd);
  const { text } = cost;
  if (!over.length) return { text, json: { ...cost, text: undefined } };
  const by: { [subject: string]: number } = {};
  for (const r of over) for (const [k, v] of Object.entries(r.platformOverrun!.by_subject)) by[k] = (by[k] ?? 0) + v;
  const microusd = over.reduce((a, r) => a + r.platformOverrun!.microusd, 0);
  const line = `Platform overrun of the spending limit: ${(microusd / 1e6).toFixed(3)} USD, spent by the run's end (debriefs, exit accounts) beyond the limit, for ${Object.entries(by).map(([k, v]) => `${k} ${(v / 1e6).toFixed(3)}`).join(", ")}. The platform's, not the pilot reaching its limit and not any seat's own spending.`;
  return { text: `${text}\n\n${line}`, json: { ...cost, text: undefined, platform_overrun_of_limit: { microusd, by_subject: by, runs: Object.fromEntries(over.map((r) => [r.runId, r.platformOverrun!.microusd])) } } };
}

/**
 * What a batch does once its runs are over, done again for a folder whose run was resumed: the folder's measures and
 * its cost report (cost.txt, cost.json) are made anew from its runs' current logs, so that they are the whole run's and
 * not what it had cost at its first stop; and a run that got to its end has its log compressed, as a finished run's is.
 * A run that stopped again is measured as far as it got and left plain (its resume command names that file). What
 * fails here is said and never undoes the run. (2026-10-09: a resumed pilot's cost.txt said no model had been called,
 * against 18.54 recorded in its log, and its log stayed 175 MB plain.)
 */
export async function afterResume(rec: RunRecord, o: { translatorModel?: string; measure?: boolean; compress?: boolean; log?: (line: string) => void } = {}): Promise<{ logPath: string; costText?: string; problems: string[] }> {
  const out = resolve(rec.logPath, "..");
  const problems: string[] = [];
  let costText: string | undefined;
  if (o.measure !== false) {
    try {
      const measureDir = join(out, "measure");
      const logs = currentLogs(out).filter((f) => /\.seed\d+\.jsonl(\.zst)?$/.test(f));
      rmSync(measureDir, { recursive: true, force: true });
      await exportLogs(logs, measureDir);
      const cost = await costReport(measureDir, { translatorModel: o.translatorModel });
      const shown = withPlatformOverrun(cost, [rec]);
      writeFileSync(join(out, "cost.txt"), `${shown.text}\n`);
      writeFileSync(join(out, "cost.json"), JSON.stringify(withCalls(shown.json, out), null, 2));
      costText = shown.text;
      rmSync(join(out, MEASURE_FAILED_FILE), { force: true });
    } catch (e) {
      problems.push(`measuring the resumed run: ${(e as Error).message}`);
      noteMeasureFailed(out, (e as Error).message);
    }
  }
  let logPath = rec.logPath;
  if (o.compress !== false && !rec.stopped && logPath.endsWith(".jsonl")) {
    try {
      logPath = await compressLog(logPath);
    } catch (e) {
      problems.push(`compressing ${logPath}: ${(e as Error).message}`);
    }
  }
  for (const p of problems) o.log?.(`  ! ${p}`);
  return { logPath, ...(costText !== undefined ? { costText } : {}), problems };
}

/** The `--set`s that make a town's world: the batch's own, then the spec's seed set to the town's. */
export const townSets = (sets: string[] = [], town?: number) => (town === undefined ? sets : [...sets, `seed=${town}`]);

/** A request to stop from outside (a TERM signal: cli.ts). A run stops before its next moment, its log closed, to be
 * resumed; a batch starts no more seeds, and passes the request on to those under way. */
export interface StopSignal {
  requested?: string;
  /** Set by whatever is running, to be told at once. */
  onRequest?: () => void;
}

/** The flags that name a first translator and its arrangement, as a command takes them. */
const firstFlags = (o: { translatorFirst?: string; translatorArrangement?: string }): string[] => (o.translatorFirst ? ["--translator-first", o.translatorFirst, ...(o.translatorArrangement ? ["--translator-arrangement", o.translatorArrangement] : [])] : []);

/** The command that resumes a run that stopped, with the models and limit it ran with. */
export function resumeCommand(logPath: string, o: { model?: string; translatorModel?: string; translatorFirst?: string; translatorArrangement?: string; budgetUsd?: number; baseUrl?: string; modules?: string } = {}): string {
  return ["oikos", "resume", logPath, ...(o.model ? ["--model", o.model] : []), ...(o.model && o.translatorModel ? ["--translator-model", o.translatorModel] : []), ...firstFlags(o), ...(o.budgetUsd !== undefined ? ["--budget", String(o.budgetUsd)] : []),
    ...(o.baseUrl ? ["--base-url", o.baseUrl] : []), ...(o.modules ? ["--modules", resolve(o.modules)] : [])].join(" ");
}

export interface BatchOptions {
  world: string;
  /** How many times each town is run (the runs' seeds differ; the town does not). */
  seeds: number;
  /** How many towns: generated from the spec's seed and those after it, each run `seeds` times. Absent: one town, the
   * spec's (what a batch always was). Only for a world generated from a spec. */
  towns?: number;
  out?: string;
  /**
   * Run again into a folder that already holds these runs, replacing them. Never the default: runs are never
   * overwritten, and a batch into a folder that holds its runs' logs (or a batch's measures) refuses to start. For
   * tests, which run again into their own folders. Even so, nothing replaces a log that holds a real model's answers.
   */
  overwrite?: boolean;
  /** A request to stop from outside (cli.ts sets it on a TERM signal). */
  stop?: StopSignal;
  parallel?: number;
  until?: number;
  sets?: string[];
  /** Whose observations to record in full (docs/design/run-datasets.md): "models", "code", "all", or ids, comma-separated. */
  recordObservations?: string;
  /** Code citizens' decisions (docs/design/ai-citizens.md 7): "full" (the default) or "none". */
  recordDecisions?: string;
  /** How much the log keeps: "full" (the default) or "lean" (docs/reliability.md). */
  logDetail?: string;
  /** Capture the citizens' decisions for training (docs/citizen-data.md): "on" or "off"; default on with a real model. */
  captureCitizens?: string;
  /** The sparse mind on (docs/design/ai-citizens.md 4), leaving out what an audit report found unstable. */
  consult?: boolean;
  /** Call the world's composing models for real (docs/behaviour/founding.md): without it the mock plays the composer. */
  composer?: boolean;
  /** Which wording of the debrief's questions the runs use ("a" unless a rewording check asks for "b"). */
  debriefWording?: string;
  consultAvoid?: string;
  /** Compress each log once the batch is measured (`.jsonl.zst`). */
  compress?: boolean;
  /**
   * What to keep of each run once measured (docs/reliability.md): "log" (the default), or "measures": the measurement
   * tables, the summary and a recipe that regenerates the log exactly (the command, the commit, the final state hash),
   * not the log. Only for runs that can be regenerated: no language-model participant (a model's answers aren't
   * reproducible, and they're training data), no uncommitted changes, no modules from outside the repository.
   * Otherwise the log is kept, and it says why.
   */
  keep?: "log" | "measures";
  translatorModel?: string;
  /** A translator that answers first ("decide/<name>", our own trained model), the translator behind it; and how the
   * two are arranged: "then" (the default) or "beside" (translator/src/arrangement.ts). */
  translatorFirst?: string;
  translatorArrangement?: string;
  /** A real model for every language-model participant and the translator ("provider/model"); default: the mock. */
  model?: string;
  /** Spending limit per run, in dollars (required with a model that costs money, unless `batchBudgetUsd` is given). */
  budgetUsd?: number;
  /**
   * The most the whole batch may spend, in dollars. Each run's limit is `budgetUsd` or what's left of this, whichever is
   * less, held for it while it runs; what it didn't spend is freed when it ends. A seed that can't be given anything
   * isn't started, and is reported.
   */
  batchBudgetUsd?: number;
  baseUrl?: string;
  measure?: boolean;
  /** A file of the researcher's own behaviour modules (`export const modules = {...}`), for every run. */
  modules?: string;
  log?: (msg: string) => void;
}

export interface BatchResult {
  out: string;
  runs: RunRecord[];
  /** Runs that didn't finish (D59), with what went wrong: the others are measured and reported as usual. */
  failed: { seed: number; town?: number; reason: string; diagnosis?: object }[];
  /** Runs (among `runs`) that stopped before they were meant to, to be resumed: why, and the command that resumes each. */
  stopped: { seed: number; town?: number; runId: string; t: number; why: string; by: string; resume: string }[];
  /** What ran, in words: how many towns, and how many runs of each. */
  shape: string;
  /** What went wrong after the runs, measuring or compressing them (the runs themselves, and batch.json, are there). */
  problems: string[];
  measureDir?: string;
  costText?: string;
}

const CLI = join(import.meta.dir, "cli.ts");

export async function runBatch(o: BatchOptions): Promise<BatchResult> {
  const log = o.log ?? (() => {});
  const sets = o.sets ?? [];
  const { config, spec, generator } = await loadWorld(o.world, sets);
  const perRunUsd = o.budgetUsd ?? o.batchBudgetUsd;
  if (o.model) chooseModel(o.model, { budgetUsd: perRunUsd, baseUrl: o.baseUrl }); // fail early: a price, a limit and a key
  if (o.model && o.translatorModel) chooseModel(o.translatorModel, { budgetUsd: perRunUsd, baseUrl: o.baseUrl });
  translatorArrangement(o);
  if (o.translatorFirst) (chooseModel(o.translatorFirst, { budgetUsd: perRunUsd, baseUrl: o.baseUrl, first: true }).adapter as { check?: () => void }).check?.();
  // The batch's spending: what finished runs spent, and the limits held for runs under way (micro-USD).
  const batchLimit = o.batchBudgetUsd !== undefined ? Math.round(o.batchBudgetUsd * 1e6) : undefined;
  let batchSpent = 0;
  let batchHeld = 0;
  const out = resolve(o.out ?? join("runs", basename(o.world).replace(/\.(json|ya?ml)$/, "")));
  mkdirSync(out, { recursive: true });
  // What runs: one town `seeds` times, or `towns` towns each `seeds` times (the top of this file).
  const plan = planRuns(Number(config.seed), o.seeds, o.towns, spec ? Number(spec.seed) : undefined);
  const seeds = plan.map((r) => r.seed);
  const idOf = (r: Planned) => runIdFor(o.world, r.seed, r.town);
  const shape = batchShape(plan, !!spec, spec ? Number(spec.seed) : undefined);
  const order = (a: Planned, b: Planned) => (a.town ?? 0) - (b.town ?? 0) || a.seed - b.seed;
  // Runs are never overwritten: a folder that already holds any of these runs, or a batch's measures, refuses another
  // (before anything is started, so that no seed runs while another is refused). `overwrite` is the deliberate
  // exception, and even then nothing in the folder that holds a real model's answers may be replaced.
  const measureDir = join(out, "measure");
  if (!o.overwrite) {
    const there = plan.flatMap((r) => logsOf(out, idOf(r)));
    if (there.length) throw new Error(`${there[0]} exists${there.length > 1 ? ` (and ${there.length - 1} more of this batch's logs)` : ""}: these runs are already in ${out}, and runs are never overwritten. Choose another --out, or resume a run that stopped (oikos resume ${there.find((l) => !isStoppedLog(l)) ?? there[0]}).`);
    if (o.measure !== false && existsSync(measureDir)) throw new Error(`${measureDir} exists: ${out} already holds a batch's measures, which this batch would replace. Choose another --out.`);
  } else {
    for (const f of readdirSync(out).filter((f) => isLog(f) || isStoppedLog(f))) {
      const real = await realModelIn(join(out, f));
      if (real) throw new Error(`${join(out, f)} holds a real model's answers (${real}): nothing in its folder is overwritten, whatever was asked. Choose another --out.`);
    }
  }
  const parallel = Math.max(1, Math.min(seeds.length, o.parallel ?? Math.floor(availableParallelism() / 2)));
  const started = new Date();
  log(`${seeds.length} run${seeds.length === 1 ? "" : "s"} of ${o.world}${sets.length ? ` (${sets.join(", ")})` : ""}, ${parallel} at a time, into ${out}`);
  log(`  ${shape}`);

  // Each seed in its own process: the kernel and the participants of one run never share a process with another's.
  const runs: RunRecord[] = [];
  const failed: BatchResult["failed"] = [];
  const stopped: BatchResult["stopped"] = [];
  const queue = [...plan];
  // Asked to stop (a TERM signal): no more seeds are started, and those under way are asked to stop in their turn (each
  // closes its log, and is reported below with the command that resumes it).
  const children = new Set<{ kill(signal?: NodeJS.Signals | number): void }>();
  if (o.stop) o.stop.onRequest = () => {
    for (const r of queue.splice(0)) failed.push({ ...r, reason: `not started: the batch was asked to stop (${o.stop!.requested ?? "a signal"})` });
    for (const c of children) c.kill("SIGTERM");
  };
  // A run that asks a model spends its time waiting for answers, not on a core: it takes no slot.
  const slotted = !o.model;
  const worker = async () => {
    while (queue.length) {
      // One of the machine's slots for each run under way (scripts/slots.ts): a batch starts with as many of its P as
      // are free and adds the rest as they free. Waiting changes when a run starts, and nothing in it.
      const slot = slotted ? await take(1, `oikos run ${o.world} (${seeds.length} run${seeds.length === 1 ? "" : "s"}) into ${out}`, { cancel: () => !queue.length, say: log }) : undefined;
      const next = queue.shift();
      if (next === undefined) { slot?.release(); break; }
      const { seed, town } = next;
      const runId = idOf(next), name = runName(next);
      try {
      // This run's spending limit: the per-run limit, or what's left of the batch's, whichever is less.
      let limitUsd = o.budgetUsd;
      let held = 0;
      if (batchLimit !== undefined) {
        const left = batchLimit - batchSpent - batchHeld;
        held = Math.min(o.budgetUsd !== undefined ? Math.round(o.budgetUsd * 1e6) : left, left);
        if (held <= 0) {
          failed.push({ ...next, reason: `not started: the batch's spending limit ($${o.batchBudgetUsd}) is spent or held by runs under way` });
          log(`  ${name}: not started, the batch's spending limit is reached`);
          continue;
        }
        batchHeld += held;
        limitUsd = held / 1e6;
      }
      const args = [process.execPath, CLI, "run-one", o.world, "--seed", String(seed), ...(town !== undefined ? ["--town", String(town)] : []), "--out", out, ...(o.until !== undefined ? ["--until", String(o.until)] : []), ...sets.flatMap((s) => ["--set", s]),
        ...(o.recordObservations ? ["--record-observations", o.recordObservations] : []), ...(o.recordDecisions ? ["--record-decisions", o.recordDecisions] : []), ...(o.logDetail ? ["--log", o.logDetail] : []), ...(o.captureCitizens ? ["--capture-citizens", o.captureCitizens] : []), ...(o.consult ? ["--consult"] : []), ...(o.composer ? ["--composer"] : []), ...(o.debriefWording ? ["--debrief-wording", o.debriefWording] : []), ...(o.consultAvoid ? ["--consult-avoid", o.consultAvoid] : []), ...(o.model ? ["--model", o.model] : []), ...(o.model && o.translatorModel ? ["--translator-model", o.translatorModel] : []), ...firstFlags(o), ...(limitUsd !== undefined ? ["--budget", String(limitUsd)] : []), ...(o.baseUrl ? ["--base-url", o.baseUrl] : []),
        ...(o.modules ? ["--modules", resolve(o.modules)] : []), ...(o.overwrite ? ["--overwrite"] : [])];
      const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: slotted ? insideSlot(1, { ...process.env }) : { ...process.env } }); // (the environment as it is now)
      children.add(p);
      const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
      children.delete(p);
      // Freed: the limit held for it; counted: what it spent (a run that failed may have spent up to its limit).
      if (batchLimit !== undefined) {
        batchHeld -= held;
        let spent = held;
        try {
          spent = JSON.parse(readFileSync(join(out, `${runId}.summary.json`), "utf8")).spentMicroUsd ?? held;
        } catch {
          // no summary: count all of it
        }
        batchSpent += code === 0 ? spent : held;
      }
      if (code !== 0) {
        // One seed failing doesn't sink the batch: it's reported with its diagnosis, and can be resumed on its own.
        let diagnosis: any;
        try {
          diagnosis = JSON.parse(readFileSync(join(out, `${runId}.failure.json`), "utf8"));
        } catch {
          // no diagnosis written (killed from outside, or before it could)
        }
        const reason = diagnosis ? `${diagnosis.reason}: ${diagnosis.error ?? JSON.stringify(diagnosis.doing)}` : `exit ${code}${p.signalCode ? ` (${p.signalCode})` : ""}: ${err.trim().split("\n").at(-1) ?? ""}`;
        failed.push({ ...next, reason, ...(diagnosis ? { diagnosis } : {}) });
        log(`  ${name}: FAILED, ${reason}`);
        continue;
      }
      const rec = JSON.parse(readFileSync(join(out, `${runId}.summary.json`), "utf8")) as RunRecord;
      runs.push(rec);
      if (rec.stopped) {
        // It didn't get to its end: said plainly, with why and how to go on. (It's measured with the rest, as far as it got.)
        const resume = resumeCommand(rec.logPath, { ...o, budgetUsd: limitUsd });
        stopped.push({ ...next, runId: rec.runId, t: rec.t, why: rec.stopped.why, by: rec.stopped.by, resume });
        log(`  ${name}: STOPPED at ${(rec.t / (365 * 86_400)).toFixed(2)} years (day ${Math.floor(rec.t / 86_400)}), not finished: ${rec.stopped.why}`);
        log(`    resume it with: ${resume}${rec.stopped.by === "SpendingLimitReached" ? "  (with a higher --budget: it stopped at this one)" : ""}`);
      } else log(`  ${name}: ${(rec.t / (365 * 86_400)).toFixed(2)} years, ${rec.commands.toLocaleString("en-US")} commands, ${rec.refused} refused, ${(rec.wallMs / 1000).toFixed(0)} s; final state ${rec.stateHash.slice(0, 16)}`);
      for (const w of healthWarnings(rec)) log(`    ! ${w}`);
      } finally { slot?.release(); }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  runs.sort(order);

  failed.sort(order);
  stopped.sort(order);
  const problems: string[] = [];
  const result: BatchResult = { out, runs, failed, stopped, problems, shape };
  // What ran is written down before anything else is done with it, and again at the end: if measuring or compressing
  // fails, the batch's runs still have their manifest, and it says what went wrong.
  const recipes = new Map<string, string>();
  const manifest = () => writeFileSync(join(out, "batch.json"), JSON.stringify({
    world: o.world, sets, ...(spec ? { spec, generator } : {}), config_seed: config.seed, seeds,
    // The towns run, by the seed each was generated from (a world given whole: one town, no seed), and how many runs of
    // each. `seeds` above are the runs' seeds, in the runs' order: of one town, unless `towns` says otherwise.
    towns: o.towns !== undefined ? [...new Set(plan.map((r) => r.town!))] : spec ? [Number(spec.seed)] : [null], runs_per_town: o.seeds, shape,
    parallel, until: o.until ?? null,
    ...(batchLimit !== undefined ? { spending: { limit_microusd: batchLimit, spent_microusd: batchSpent } } : {}),
    orchestrator: ORCHESTRATOR_VERSION, measure: o.measure !== false ? MEASURE_VERSION : null,
    started: started.toISOString(), finished: new Date().toISOString(), wall_ms: Date.now() - started.getTime(),
    runs: runs.map((r) => ({ run_id: r.runId, seed: r.seed, ...(r.town !== undefined ? { town: r.town } : {}), log: r.logPath || null, anchors: r.logPath ? r.anchorsPath : null, ...(recipes.has(r.runId) ? { recipe: recipes.get(r.runId) } : {}), state_hash: r.stateHash, t: r.t,
      end: r.end, ...(r.stopped ? { stopped: { ...r.stopped, resume: stopped.find((x) => x.runId === r.runId)?.resume } } : {}),
      commands: r.commands, refused: r.refused, wakes: r.wakes, wall_ms: r.wallMs, health: r.health, warnings: healthWarnings(r) })),
    failed,
    ...(problems.length ? { problems } : {}),
  }, null, 2));
  manifest();
  const step = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      problems.push(`${what}: ${(e as Error).message}`);
      if (what === "measuring the runs") noteMeasureFailed(out, (e as Error).message);
      log(`  ! ${what} failed: ${(e as Error).message}`);
    }
  };
  if (o.measure !== false && runs.length) await step("measuring the runs", async () => {
    // (Only ever a folder this batch may replace: checked before any run started.)
    rmSync(measureDir, { recursive: true, force: true });
    await exportLogs(runs.map((r) => r.logPath), measureDir);
    const cost = await costReport(measureDir, { translatorModel: o.translatorModel });
    const shown = withPlatformOverrun(cost, runs);
    writeFileSync(join(out, "cost.txt"), `${shown.text}\n`);
    writeFileSync(join(out, "cost.json"), JSON.stringify(withCalls(shown.json, out), null, 2));
    result.measureDir = measureDir;
    result.costText = shown.text;
    rmSync(join(out, MEASURE_FAILED_FILE), { force: true });
  });
  // Only the measures kept, if asked and the runs can be regenerated; else compressed once measured, if asked (about a
  // seventh the size; everything that reads logs reads these too).
  if (o.keep === "measures") {
    const why = !result.measureDir ? "they weren't measured" : cannotRegenerate(config, o);
    if (why) log(`  ! keeping the logs: ${why}`);
    else for (const r of runs) {
      const recipe = join(out, `${r.runId}.recipe.json`);
      writeFileSync(recipe, JSON.stringify({
        about: "This run's log wasn't kept (--keep measures). Running the command at the commit regenerates it exactly: the final state hash says so.",
        command: ["oikos", "run-one", ...recipeArgs(o, r.seed, r.town)],
        commit: gitCommit(), kernel: kernelVersion(), orchestrator: ORCHESTRATOR_VERSION, state_hash: r.stateHash, commands: r.commands, t: r.t,
      }, null, 2));
      for (const f of [r.logPath, r.anchorsPath]) rmSync(f, { force: true });
      recipes.set(r.runId, recipe);
      r.logPath = "";
    }
  }
  // (A run that stopped to be resumed stays as it is, plain: it isn't finished, and its resume command names this file.)
  // (Side by side, as many at a time as the runs were: compressing a log takes about a core. What went wrong is said in
  // the runs' order, whichever finished first.)
  if (o.compress) {
    const todo = runs.filter((r) => r.logPath && !r.stopped);
    const wrong: (string | undefined)[] = [];
    let at = 0;
    await Promise.all(Array.from({ length: Math.min(parallel, todo.length) }, async () => {
      for (let i = at++; i < todo.length; i = at++) {
        try {
          todo[i]!.logPath = await compressLog(todo[i]!.logPath);
        } catch (e) {
          wrong[i] = (e as Error).message;
        }
      }
    }));
    for (const [i, r] of todo.entries()) if (wrong[i] !== undefined) await step(`compressing ${r.logPath}`, async () => { throw new Error(wrong[i]); });
  }
  manifest();
  return result;
}

/** The arguments to `oikos run-one` that regenerate a batch's run of a seed (with `--out` for where). */
export const recipeArgs = (o: BatchOptions, seed: number, town?: number) => [o.world, "--seed", String(seed), ...(town !== undefined ? ["--town", String(town)] : []), ...(o.until !== undefined ? ["--until", String(o.until)] : []), ...(o.sets ?? []).flatMap((s) => ["--set", s]),
  ...(o.recordObservations ? ["--record-observations", o.recordObservations] : []), ...(o.recordDecisions ? ["--record-decisions", o.recordDecisions] : []), ...(o.logDetail ? ["--log", o.logDetail] : []), ...(o.consult ? ["--consult"] : []), ...(o.composer ? ["--composer"] : []), ...(o.debriefWording ? ["--debrief-wording", o.debriefWording] : []), ...(o.consultAvoid ? ["--consult-avoid", o.consultAvoid] : [])];

/** Why a batch's runs couldn't be regenerated from a recipe (so their logs must be kept), or null if they can. */
function cannotRegenerate(config: any, o: BatchOptions): string | null {
  const models = [...(config.participants ?? []), ...(config.templates ?? [])].filter((p: any) => p.controller?.type === "llm");
  if (models.length) return `language-model participants (${models.map((p: any) => p.id).slice(0, 3).join(", ")}${models.length > 3 ? "..." : ""}): their runs are kept whole`;
  if (o.model) return "a model was given";
  if (o.modules && !resolve(o.modules).startsWith(join(import.meta.dir, "../.."))) return "modules from outside the repository";
  const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=no"], { cwd: join(import.meta.dir, "../..") });
  if (status.exitCode !== 0) return "not in a git checkout";
  if (status.stdout.toString().trim()) return "uncommitted changes (the commit wouldn't regenerate them)";
  return null;
}

const gitCommit = () => Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: join(import.meta.dir, "../..") }).stdout.toString().trim();
const kernelVersion = () => Bun.spawnSync([kernelBinary(), "--version"]).stdout.toString().trim();

/** `--record-observations` as the run takes it: "models" (the default), "code", "all", "none", or participant ids,
 * comma-separated. */
export function recordWho(s: string): string[] | "models" | "code" | "all" | "none" {
  return s === "models" || s === "code" || s === "all" || s === "none" ? s : s.split(",").map((x) => x.trim()).filter(Boolean);
}

/** Refusals that are the world working as it should: same-moment races (D58), moving in where the last tenants are
 * still leaving, and a new employer naming, on their first day, someone who has worked a full day at the job they just
 * left (acts take time). Anything else is worth a look. */
const EXPECTED_REFUSALS = new Set(["not_present", "not_at_work", "capacity_exceeded", "no_time_left"]);

/** The same act by the same unit more often than this in a day (hourly): a retry paced by wakes rather than time. */
export const REPEAT_WARNING = 24;

/** An act waiting longer than this for its actor to be free: someone is falling behind. */
export const BACKLOG_WARNING_SECONDS = 86_400;

/**
 * What in a run's summary is worth a look, in words (docs/reliability.md): a module whose acts waited more than a day
 * for their actor to be free (it's falling behind: acting costs time, docs/design/rebuild.md 6.3), refusals other
 * than the expected races, and participants' errors. The run finished; these say it may not have gone as it should.
 */
export function healthWarnings(r: { health?: RunSummary["health"]; profile?: RunSummary["profile"]; participantErrors?: number }): string[] {
  const out: string[] = [];
  const days = (s: number) => `${(s / 86_400).toLocaleString("en-US", { maximumFractionDigits: 1 })} days`;
  for (const [m, h] of Object.entries(r.health?.backlog ?? {}))
    if (h.longest > BACKLOG_WARNING_SECONDS) out.push(`${m}: an act waited ${days(h.longest)} for its actor to be free (${h.acts.toLocaleString("en-US")} acts, ${days(h.waited / Math.max(1, h.acts))} on average): falling behind?`);
  for (const [m, h] of Object.entries(r.health?.repeats ?? {}))
    if (h.times > REPEAT_WARNING) out.push(`${m}: ${h.unit} did the same thing ${h.times.toLocaleString("en-US")} times in one day (${h.act.slice(0, 80)}): a retry loop?`);
  const odd = Object.entries(r.health?.refused ?? {}).filter(([code]) => !EXPECTED_REFUSALS.has(code));
  if (odd.length) out.push(`refusals other than same-moment races: ${odd.map(([c, n]) => `${c} ${n}`).join(", ")}`);
  if (r.participantErrors) out.push(`${r.participantErrors} participant error${r.participantErrors === 1 ? "" : "s"} (each waited that wake, with nothing done: see the log's participant_error notes)`);
  return out;
}
