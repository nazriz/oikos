// Batch runs: one world, several seeds, each run in its own process (with its
// own kernel) so they run in parallel. A run's result never depends on how it
// was scheduled: each is the same as running that seed alone.
//
// Seeds vary a run's randomness, not the world: a generated world is built
// once from its spec (set `seed` in the spec for a different town), and each
// run gets the config with its own seed.
//
// A batch folder holds each run's log, anchors and summary; batch.json (what
// ran, with which versions, and how long it took); the measurement tables
// (measure/, DuckDB over Parquet); and the cost report (cost.txt, cost.json).

import { availableParallelism } from "node:os";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { exportLogs, MEASURE_VERSION } from "@oikos/measure";
import { costReport } from "./cost";
import { chooseModel } from "./models";
import { KernelDied, KernelLogFailed, kernelBinary } from "./kernel";
import { clearForFreshRun, compressLog, isLog, isStoppedLog, logsOf, realModelIn } from "./logs";
import { logToResume, recordedCalls, prepareResume, Serving } from "./resume";
import { ORCHESTRATOR_VERSION, runWorld, RunStuck, type RunOptions, type RunSummary } from "./run";
import type { LlmAdapter } from "@oikos/participants/llm";
import { stallMs, Watchdog } from "./watchdog";

/** A world file (JSON or YAML), with `--set path=value` overrides applied, generated if it's a spec. */
export async function loadWorld(path: string, sets: string[] = []): Promise<{ config: any; spec?: any; generator?: string }> {
  const text = await Bun.file(path).text();
  const v = path.endsWith(".yaml") || path.endsWith(".yml") ? Bun.YAML.parse(text) : JSON.parse(text);
  for (const s of sets) setPath(v, s);
  if (v?.generate) {
    const { generate, GENERATOR_VERSION } = await import("@oikos/worlds/generator/generate");
    return { config: generate(v), spec: v, generator: GENERATOR_VERSION };
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
  seed: number;
  wallMs: number;
}

export const runIdFor = (world: string, seed: number) => `${basename(world).replace(/\.(json|ya?ml)$/, "")}.seed${seed}`;

/** Behaviour modules from a researcher's own file (`--modules`): its export `modules`, keyed by the names worlds use. */
export async function loadModules(file?: string): Promise<RunOptions["modules"]> {
  if (!file) return undefined;
  const m = await import(resolve(file));
  if (!m.modules || typeof m.modules !== "object") throw new Error(`${file} should export \`modules\`: { [name]: BehaviourModule }`);
  return m.modules;
}

/** Run one seed in this process and write its summary next to its log. Or resume a run that stopped (`resume`: its
 * log): run again from its own config, with every model response served from that log (resume.ts, D59). */
export async function runOne(o: { world?: string; seed?: number; out?: string; resume?: string; overwrite?: boolean; stop?: StopSignal; until?: number; sets?: string[]; modules?: string; model?: string; translatorModel?: string; budgetUsd?: number; baseUrl?: string; recordObservations?: string; logDetail?: string; consult?: boolean; consultAvoid?: string }): Promise<RunRecord> {
  let config: any, runId: string, out: string, serving: Serving | undefined, stoppedLog: string | undefined;
  let consult = !!o.consult;
  // What an audit found unstable (its report's avoid list), left out of the sparse mind.
  let consultAvoid: string[] | undefined = o.consultAvoid ? (JSON.parse(await Bun.file(o.consultAvoid).text()).avoid as string[]) : undefined;
  if (o.resume) {
    // (A compressed log is written out plain first, and kept; a folder names its one run that stopped short.)
    const r = prepareResume(await logToResume(o.resume));
    ({ config, runId, outDir: out, stoppedLog } = r);
    consult = r.consult;
    consultAvoid = r.consultAvoid;
    serving = new Serving(recordedCalls(r.stoppedLog));
  } else {
    config = { ...(await loadWorld(o.world!, o.sets)).config, seed: o.seed };
    // How much the log keeps (docs/reliability.md): lean for quick test runs, full (the default) when the data matters.
    if (o.logDetail) config.log = { ...config.log, detail: o.logDetail };
    runId = runIdFor(o.world!, o.seed!);
    out = o.out ?? "runs";
    // Runs are never overwritten: a folder that already holds this run's log refuses a fresh one (logs.ts).
    await clearForFreshRun(out, runId, o.overwrite);
  }
  // A real model (or the mock, by default): its adapter, price and the run's spending limit.
  const real = o.model ? chooseModel(o.model, { budgetUsd: o.budgetUsd, baseUrl: o.baseUrl }) : undefined;
  // The translator on its own model, if one is named (sharing the run's spending limit).
  const tr = real && o.translatorModel ? chooseModel(o.translatorModel, { budgetUsd: o.budgetUsd, baseUrl: o.baseUrl }) : undefined;
  const serve = (a: LlmAdapter) => (serving ? serving.wrap(a) : a);
  const modules = await loadModules(o.modules);
  mkdirSync(out, { recursive: true });
  const t0 = performance.now();
  // D59: a run that stalls is stopped by its watchdog (with a diagnosis); one that fails says what it was doing.
  const diagnosisPath = join(out, `${runId}.failure.json`);
  const watchdog = new Watchdog({ stallMs: stallMs(), diagnosisPath, runId });
  let s: RunSummary;
  try {
    s = await runWorld({ config, runId, outDir: out, until: o.until, watchdog, ...(o.stop ? { stop: o.stop } : {}), ...(modules ? { modules } : {}), ...(consult ? { consult, ...(consultAvoid ? { consultAvoid } : {}) } : {}), ...(o.recordObservations ? { recordObservations: recordWho(o.recordObservations) } : {}),
      ...(real ? { adapter: serve(real.adapter), prices: { ...real.prices, ...(tr?.prices ?? {}) }, ...(real.budget ? { budget: real.budget } : {}) } : {}),
      ...(tr ? { translatorAdapter: serve(tr.adapter) } : {}),
      ...(serving ? { resumedFrom: { log: basename(stoppedLog!), serving } } : {}) });
  } catch (e) {
    const err = e as Error;
    const reason = e instanceof KernelDied ? "kernel died" : e instanceof KernelLogFailed ? "log not written" : e instanceof RunStuck ? "stuck" : "error";
    writeFileSync(diagnosisPath, JSON.stringify({ run_id: runId, reason, error: err.message, doing: watchdog.last, at: new Date().toISOString(),
      what_next: "Fix the cause, then resume the run: `oikos resume <log>` re-runs it with every model response served from this log." }, null, 2));
    throw e;
  } finally {
    watchdog.stop();
  }
  const rec: RunRecord = { ...s, seed: Number(config.seed), wallMs: Math.round(performance.now() - t0) };
  writeFileSync(join(out, `${runId}.summary.json`), JSON.stringify(rec, null, 2));
  return rec;
}

/** A request to stop from outside (a TERM signal: cli.ts). A run stops before its next moment, its log closed, to be
 * resumed; a batch starts no more seeds, and passes the request on to those under way. */
export interface StopSignal {
  requested?: string;
  /** Set by whatever is running, to be told at once. */
  onRequest?: () => void;
}

/** The command that resumes a run that stopped, with the models and limit it ran with. */
export function resumeCommand(logPath: string, o: { model?: string; translatorModel?: string; budgetUsd?: number; baseUrl?: string; modules?: string } = {}): string {
  return ["oikos", "resume", logPath, ...(o.model ? ["--model", o.model] : []), ...(o.model && o.translatorModel ? ["--translator-model", o.translatorModel] : []), ...(o.budgetUsd !== undefined ? ["--budget", String(o.budgetUsd)] : []),
    ...(o.baseUrl ? ["--base-url", o.baseUrl] : []), ...(o.modules ? ["--modules", resolve(o.modules)] : [])].join(" ");
}

export interface BatchOptions {
  world: string;
  seeds: number;
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
  /** How much the log keeps: "full" (the default) or "lean" (docs/reliability.md). */
  logDetail?: string;
  /** The sparse mind on (docs/design/ai-citizens.md 4), leaving out what an audit report found unstable. */
  consult?: boolean;
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
  /** Seeds that didn't finish (D59), with what went wrong: the others are measured and reported as usual. */
  failed: { seed: number; reason: string; diagnosis?: object }[];
  /** Runs (among `runs`) that stopped before they were meant to, to be resumed: why, and the command that resumes each. */
  stopped: { seed: number; runId: string; t: number; why: string; by: string; resume: string }[];
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
  // The batch's spending: what finished runs spent, and the limits held for runs under way (micro-USD).
  const batchLimit = o.batchBudgetUsd !== undefined ? Math.round(o.batchBudgetUsd * 1e6) : undefined;
  let batchSpent = 0;
  let batchHeld = 0;
  const out = resolve(o.out ?? join("runs", basename(o.world).replace(/\.(json|ya?ml)$/, "")));
  mkdirSync(out, { recursive: true });
  const seeds = Array.from({ length: o.seeds }, (_, i) => Number(config.seed) + i);
  // Runs are never overwritten: a folder that already holds any of these runs, or a batch's measures, refuses another
  // (before anything is started, so that no seed runs while another is refused). `overwrite` is the deliberate
  // exception, and even then nothing in the folder that holds a real model's answers may be replaced.
  const measureDir = join(out, "measure");
  if (!o.overwrite) {
    const there = seeds.flatMap((seed) => logsOf(out, runIdFor(o.world, seed)));
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

  // Each seed in its own process: the kernel and the participants of one run never share a process with another's.
  const runs: RunRecord[] = [];
  const failed: BatchResult["failed"] = [];
  const stopped: BatchResult["stopped"] = [];
  const queue = [...seeds];
  // Asked to stop (a TERM signal): no more seeds are started, and those under way are asked to stop in their turn (each
  // closes its log, and is reported below with the command that resumes it).
  const children = new Set<{ kill(signal?: NodeJS.Signals | number): void }>();
  if (o.stop) o.stop.onRequest = () => {
    for (const seed of queue.splice(0)) failed.push({ seed, reason: `not started: the batch was asked to stop (${o.stop!.requested ?? "a signal"})` });
    for (const c of children) c.kill("SIGTERM");
  };
  const worker = async () => {
    for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) {
      // This run's spending limit: the per-run limit, or what's left of the batch's, whichever is less.
      let limitUsd = o.budgetUsd;
      let held = 0;
      if (batchLimit !== undefined) {
        const left = batchLimit - batchSpent - batchHeld;
        held = Math.min(o.budgetUsd !== undefined ? Math.round(o.budgetUsd * 1e6) : left, left);
        if (held <= 0) {
          failed.push({ seed, reason: `not started: the batch's spending limit ($${o.batchBudgetUsd}) is spent or held by runs under way` });
          log(`  seed ${seed}: not started, the batch's spending limit is reached`);
          continue;
        }
        batchHeld += held;
        limitUsd = held / 1e6;
      }
      const args = [process.execPath, CLI, "run-one", o.world, "--seed", String(seed), "--out", out, ...(o.until !== undefined ? ["--until", String(o.until)] : []), ...sets.flatMap((s) => ["--set", s]),
        ...(o.recordObservations ? ["--record-observations", o.recordObservations] : []), ...(o.logDetail ? ["--log", o.logDetail] : []), ...(o.consult ? ["--consult"] : []), ...(o.consultAvoid ? ["--consult-avoid", o.consultAvoid] : []), ...(o.model ? ["--model", o.model] : []), ...(o.model && o.translatorModel ? ["--translator-model", o.translatorModel] : []), ...(limitUsd !== undefined ? ["--budget", String(limitUsd)] : []), ...(o.baseUrl ? ["--base-url", o.baseUrl] : []),
        ...(o.modules ? ["--modules", resolve(o.modules)] : []), ...(o.overwrite ? ["--overwrite"] : [])];
      const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: { ...process.env } }); // (the environment as it is now)
      children.add(p);
      const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
      children.delete(p);
      // Freed: the limit held for it; counted: what it spent (a run that failed may have spent up to its limit).
      if (batchLimit !== undefined) {
        batchHeld -= held;
        let spent = held;
        try {
          spent = JSON.parse(readFileSync(join(out, `${runIdFor(o.world, seed)}.summary.json`), "utf8")).spentMicroUsd ?? held;
        } catch {
          // no summary: count all of it
        }
        batchSpent += code === 0 ? spent : held;
      }
      if (code !== 0) {
        // One seed failing doesn't sink the batch: it's reported with its diagnosis, and can be resumed on its own.
        let diagnosis: any;
        try {
          diagnosis = JSON.parse(readFileSync(join(out, `${runIdFor(o.world, seed)}.failure.json`), "utf8"));
        } catch {
          // no diagnosis written (killed from outside, or before it could)
        }
        const reason = diagnosis ? `${diagnosis.reason}: ${diagnosis.error ?? JSON.stringify(diagnosis.doing)}` : `exit ${code}${p.signalCode ? ` (${p.signalCode})` : ""}: ${err.trim().split("\n").at(-1) ?? ""}`;
        failed.push({ seed, reason, ...(diagnosis ? { diagnosis } : {}) });
        log(`  seed ${seed}: FAILED, ${reason}`);
        continue;
      }
      const rec = JSON.parse(readFileSync(join(out, `${runIdFor(o.world, seed)}.summary.json`), "utf8")) as RunRecord;
      runs.push(rec);
      if (rec.stopped) {
        // It didn't get to its end: said plainly, with why and how to go on. (It's measured with the rest, as far as it got.)
        const resume = resumeCommand(rec.logPath, { ...o, budgetUsd: limitUsd });
        stopped.push({ seed, runId: rec.runId, t: rec.t, why: rec.stopped.why, by: rec.stopped.by, resume });
        log(`  seed ${seed}: STOPPED at ${(rec.t / (365 * 86_400)).toFixed(2)} years (day ${Math.floor(rec.t / 86_400)}), not finished: ${rec.stopped.why}`);
        log(`    resume it with: ${resume}${rec.stopped.by === "SpendingLimitReached" ? "  (with a higher --budget: it stopped at this one)" : ""}`);
      } else log(`  seed ${seed}: ${(rec.t / (365 * 86_400)).toFixed(2)} years, ${rec.commands.toLocaleString("en-US")} commands, ${rec.refused} refused, ${(rec.wallMs / 1000).toFixed(0)} s; final state ${rec.stateHash.slice(0, 16)}`);
      for (const w of healthWarnings(rec)) log(`    ! ${w}`);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  runs.sort((a, b) => a.seed - b.seed);

  failed.sort((a, b) => a.seed - b.seed);
  stopped.sort((a, b) => a.seed - b.seed);
  const problems: string[] = [];
  const result: BatchResult = { out, runs, failed, stopped, problems };
  // What ran is written down before anything else is done with it, and again at the end: if measuring or compressing
  // fails, the batch's runs still have their manifest, and it says what went wrong.
  const recipes = new Map<string, string>();
  const manifest = () => writeFileSync(join(out, "batch.json"), JSON.stringify({
    world: o.world, sets, ...(spec ? { spec, generator } : {}), config_seed: config.seed, seeds, parallel, until: o.until ?? null,
    ...(batchLimit !== undefined ? { spending: { limit_microusd: batchLimit, spent_microusd: batchSpent } } : {}),
    orchestrator: ORCHESTRATOR_VERSION, measure: o.measure !== false ? MEASURE_VERSION : null,
    started: started.toISOString(), finished: new Date().toISOString(), wall_ms: Date.now() - started.getTime(),
    runs: runs.map((r) => ({ run_id: r.runId, seed: r.seed, log: r.logPath || null, anchors: r.logPath ? r.anchorsPath : null, ...(recipes.has(r.runId) ? { recipe: recipes.get(r.runId) } : {}), state_hash: r.stateHash, t: r.t,
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
      log(`  ! ${what} failed: ${(e as Error).message}`);
    }
  };
  if (o.measure !== false && runs.length) await step("measuring the runs", async () => {
    // (Only ever a folder this batch may replace: checked before any run started.)
    rmSync(measureDir, { recursive: true, force: true });
    await exportLogs(runs.map((r) => r.logPath), measureDir);
    const cost = await costReport(measureDir, { translatorModel: o.translatorModel });
    writeFileSync(join(out, "cost.txt"), `${cost.text}\n`);
    writeFileSync(join(out, "cost.json"), JSON.stringify({ ...cost, text: undefined }, null, 2));
    result.measureDir = measureDir;
    result.costText = cost.text;
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
        command: ["oikos", "run-one", ...recipeArgs(o, r.seed)],
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
export const recipeArgs = (o: BatchOptions, seed: number) => [o.world, "--seed", String(seed), ...(o.until !== undefined ? ["--until", String(o.until)] : []), ...(o.sets ?? []).flatMap((s) => ["--set", s]),
  ...(o.recordObservations ? ["--record-observations", o.recordObservations] : []), ...(o.logDetail ? ["--log", o.logDetail] : []), ...(o.consult ? ["--consult"] : []), ...(o.consultAvoid ? ["--consult-avoid", o.consultAvoid] : [])];

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
  if (r.participantErrors) out.push(`${r.participantErrors} participant error${r.participantErrors === 1 ? "" : "s"} (recovered in place: see the log's participant_error notes)`);
  return out;
}
