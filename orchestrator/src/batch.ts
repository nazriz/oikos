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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { exportLogs, MEASURE_VERSION } from "@terrarium/measure";
import { costReport } from "./cost";
import { chooseModel } from "./models";
import { KernelDied } from "./kernel";
import { recordedCalls, prepareResume, Serving } from "./resume";
import { ORCHESTRATOR_VERSION, runWorld, RunStuck, type RunOptions, type RunSummary } from "./run";
import type { LlmAdapter } from "@terrarium/participants/llm";
import { stallMs, Watchdog } from "./watchdog";

/** A world file (JSON or YAML), with `--set path=value` overrides applied, generated if it's a spec. */
export async function loadWorld(path: string, sets: string[] = []): Promise<{ config: any; spec?: any; generator?: string }> {
  const text = await Bun.file(path).text();
  const v = path.endsWith(".yaml") || path.endsWith(".yml") ? Bun.YAML.parse(text) : JSON.parse(text);
  for (const s of sets) setPath(v, s);
  if (v?.generate) {
    const { generate, GENERATOR_VERSION } = await import("@terrarium/worlds/generator/generate");
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
export async function runOne(o: { world?: string; seed?: number; out?: string; resume?: string; until?: number; sets?: string[]; modules?: string; model?: string; translatorModel?: string; budgetUsd?: number; baseUrl?: string }): Promise<RunRecord> {
  let config: any, runId: string, out: string, serving: Serving | undefined, stoppedLog: string | undefined;
  if (o.resume) {
    const r = prepareResume(o.resume);
    ({ config, runId, outDir: out, stoppedLog } = r);
    serving = new Serving(recordedCalls(r.stoppedLog));
  } else {
    config = { ...(await loadWorld(o.world!, o.sets)).config, seed: o.seed };
    runId = runIdFor(o.world!, o.seed!);
    out = o.out ?? "runs";
    for (const f of [`${runId}.jsonl`, `${runId}.anchors.jsonl`, `${runId}.summary.json`, `${runId}.failure.json`]) rmSync(join(out, f), { force: true });
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
    s = await runWorld({ config, runId, outDir: out, until: o.until, watchdog, ...(modules ? { modules } : {}),
      ...(real ? { adapter: serve(real.adapter), prices: { ...real.prices, ...(tr?.prices ?? {}) }, ...(real.budget ? { budget: real.budget } : {}) } : {}),
      ...(tr ? { translatorAdapter: serve(tr.adapter) } : {}),
      ...(serving ? { resumedFrom: { log: basename(stoppedLog!), serving } } : {}) });
  } catch (e) {
    const err = e as Error;
    const reason = e instanceof KernelDied ? "kernel died" : e instanceof RunStuck ? "stuck" : "error";
    writeFileSync(diagnosisPath, JSON.stringify({ run_id: runId, reason, error: err.message, doing: watchdog.last, at: new Date().toISOString(),
      what_next: "Fix the cause, then resume the run: `terrarium resume <log>` re-runs it with every model response served from this log." }, null, 2));
    throw e;
  } finally {
    watchdog.stop();
  }
  const rec: RunRecord = { ...s, seed: Number(config.seed), wallMs: Math.round(performance.now() - t0) };
  writeFileSync(join(out, `${runId}.summary.json`), JSON.stringify(rec, null, 2));
  return rec;
}

export interface BatchOptions {
  world: string;
  seeds: number;
  out?: string;
  parallel?: number;
  until?: number;
  sets?: string[];
  translatorModel?: string;
  /** A real model for every language-model participant and the translator ("provider/model"); default: the mock. */
  model?: string;
  /** Spending limit per run, in dollars (required with a model that costs money). */
  budgetUsd?: number;
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
  measureDir?: string;
  costText?: string;
}

const CLI = join(import.meta.dir, "cli.ts");

export async function runBatch(o: BatchOptions): Promise<BatchResult> {
  const log = o.log ?? (() => {});
  const sets = o.sets ?? [];
  const { config, spec, generator } = await loadWorld(o.world, sets);
  if (o.model) chooseModel(o.model, { budgetUsd: o.budgetUsd, baseUrl: o.baseUrl }); // fail early: a price, a limit and a key
  if (o.model && o.translatorModel) chooseModel(o.translatorModel, { budgetUsd: o.budgetUsd, baseUrl: o.baseUrl });
  const out = resolve(o.out ?? join("runs", basename(o.world).replace(/\.(json|ya?ml)$/, "")));
  mkdirSync(out, { recursive: true });
  const seeds = Array.from({ length: o.seeds }, (_, i) => Number(config.seed) + i);
  const parallel = Math.max(1, Math.min(seeds.length, o.parallel ?? Math.floor(availableParallelism() / 2)));
  const started = new Date();
  log(`${seeds.length} run${seeds.length === 1 ? "" : "s"} of ${o.world}${sets.length ? ` (${sets.join(", ")})` : ""}, ${parallel} at a time, into ${out}`);

  // Each seed in its own process: the kernel and the participants of one run never share a process with another's.
  const runs: RunRecord[] = [];
  const failed: BatchResult["failed"] = [];
  const queue = [...seeds];
  const worker = async () => {
    for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) {
      const args = [process.execPath, CLI, "run-one", o.world, "--seed", String(seed), "--out", out, ...(o.until !== undefined ? ["--until", String(o.until)] : []), ...sets.flatMap((s) => ["--set", s]),
        ...(o.model ? ["--model", o.model] : []), ...(o.model && o.translatorModel ? ["--translator-model", o.translatorModel] : []), ...(o.budgetUsd !== undefined ? ["--budget", String(o.budgetUsd)] : []), ...(o.baseUrl ? ["--base-url", o.baseUrl] : []),
        ...(o.modules ? ["--modules", resolve(o.modules)] : [])];
      const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
      const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
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
      log(`  seed ${seed}: ${(rec.t / (365 * 86_400)).toFixed(2)} years, ${rec.commands.toLocaleString("en-US")} commands, ${rec.refused} refused, ${(rec.wallMs / 1000).toFixed(0)} s; final state ${rec.stateHash.slice(0, 16)}`);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  runs.sort((a, b) => a.seed - b.seed);

  failed.sort((a, b) => a.seed - b.seed);
  const result: BatchResult = { out, runs, failed };
  if (o.measure !== false && runs.length) {
    const measureDir = join(out, "measure");
    rmSync(measureDir, { recursive: true, force: true });
    await exportLogs(runs.map((r) => r.logPath), measureDir);
    const cost = await costReport(measureDir, { translatorModel: o.translatorModel });
    writeFileSync(join(out, "cost.txt"), `${cost.text}\n`);
    writeFileSync(join(out, "cost.json"), JSON.stringify({ ...cost, text: undefined }, null, 2));
    result.measureDir = measureDir;
    result.costText = cost.text;
  }
  const finished = new Date();
  writeFileSync(join(out, "batch.json"), JSON.stringify({
    world: o.world, sets, ...(spec ? { spec, generator } : {}), config_seed: config.seed, seeds, parallel, until: o.until ?? null,
    orchestrator: ORCHESTRATOR_VERSION, measure: o.measure !== false ? MEASURE_VERSION : null,
    started: started.toISOString(), finished: finished.toISOString(), wall_ms: finished.getTime() - started.getTime(),
    runs: runs.map((r) => ({ run_id: r.runId, seed: r.seed, log: r.logPath, anchors: r.anchorsPath, state_hash: r.stateHash, t: r.t, commands: r.commands, refused: r.refused, wakes: r.wakes, wall_ms: r.wallMs })),
    failed,
  }, null, 2));
  return result;
}
