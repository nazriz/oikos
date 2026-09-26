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
import { ORCHESTRATOR_VERSION, runWorld, type RunSummary } from "./run";

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

/** Run one seed in this process and write its summary next to its log. */
export async function runOne(o: { world: string; seed: number; out: string; until?: number; sets?: string[] }): Promise<RunRecord> {
  const { config } = await loadWorld(o.world, o.sets);
  const runId = runIdFor(o.world, o.seed);
  for (const f of [`${runId}.jsonl`, `${runId}.anchors.jsonl`, `${runId}.summary.json`]) rmSync(join(o.out, f), { force: true });
  const t0 = performance.now();
  const s = await runWorld({ config: { ...config, seed: o.seed }, runId, outDir: o.out, until: o.until });
  const rec: RunRecord = { ...s, seed: o.seed, wallMs: Math.round(performance.now() - t0) };
  writeFileSync(join(o.out, `${runId}.summary.json`), JSON.stringify(rec, null, 2));
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
  measure?: boolean;
  log?: (msg: string) => void;
}

export interface BatchResult {
  out: string;
  runs: RunRecord[];
  measureDir?: string;
  costText?: string;
}

const CLI = join(import.meta.dir, "cli.ts");

export async function runBatch(o: BatchOptions): Promise<BatchResult> {
  const log = o.log ?? (() => {});
  const sets = o.sets ?? [];
  const { config, spec, generator } = await loadWorld(o.world, sets);
  const out = resolve(o.out ?? join("runs", basename(o.world).replace(/\.(json|ya?ml)$/, "")));
  mkdirSync(out, { recursive: true });
  const seeds = Array.from({ length: o.seeds }, (_, i) => Number(config.seed) + i);
  const parallel = Math.max(1, Math.min(seeds.length, o.parallel ?? Math.floor(availableParallelism() / 2)));
  const started = new Date();
  log(`${seeds.length} run${seeds.length === 1 ? "" : "s"} of ${o.world}${sets.length ? ` (${sets.join(", ")})` : ""}, ${parallel} at a time, into ${out}`);

  // Each seed in its own process: the kernel and the seats of one run never share a process with another's.
  const runs: RunRecord[] = [];
  const queue = [...seeds];
  const worker = async () => {
    for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) {
      const args = [process.execPath, CLI, "run-one", o.world, "--seed", String(seed), "--out", out, ...(o.until !== undefined ? ["--until", String(o.until)] : []), ...sets.flatMap((s) => ["--set", s])];
      const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
      const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
      if (code !== 0) throw new Error(`seed ${seed} failed (exit ${code}):\n${err.trim()}`);
      const rec = JSON.parse(readFileSync(join(out, `${runIdFor(o.world, seed)}.summary.json`), "utf8")) as RunRecord;
      runs.push(rec);
      log(`  seed ${seed}: ${(rec.t / (365 * 86_400)).toFixed(2)} years, ${rec.commands.toLocaleString("en-US")} commands, ${rec.refused} refused, ${(rec.wallMs / 1000).toFixed(0)} s; final state ${rec.stateHash.slice(0, 16)}`);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  runs.sort((a, b) => a.seed - b.seed);

  const result: BatchResult = { out, runs };
  if (o.measure !== false) {
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
  }, null, 2));
  return result;
}
