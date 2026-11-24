// Opt-in CLI and helper exporting a finished Oikos experiment directory to a UK AISI Inspect v2
// EvalLog JSON file (design doc §5.3). Lives outside study files; reads `spec.json`, `results.json`,
// `cost.json`, and optional per-fork calls logs + external tier scorer (e.g. `--scorer power-seeking`).
//
// Usage:
//   bun orchestrator/src/inspect-export.ts <experiment-dir> [--out eval.json] [--scorer power-seeking] [--arm <name>]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  buildInspectEvalLog,
  type InspectEvalLog,
  type InspectForkInput,
  type InspectForkScoreInput,
  type InspectModelUsage,
} from "@oikos/measure/inspect-export";

export type ForkScorer = (dir: string, seed: number, arm: string) => Promise<InspectForkScoreInput>;

function readCallsUsage(callsPath: string): { usage: InspectModelUsage; costUsd: number } {
  const usage: InspectModelUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let cacheRead = 0;
  let cacheWrite = 0;
  let costUsd = 0;
  if (!existsSync(callsPath)) return { usage, costUsd };
  for (const line of readFileSync(callsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const inp = Number(row.input_tokens ?? row.tokens?.input ?? 0);
    const out = Number(row.output_tokens ?? row.tokens?.output ?? 0);
    const cr = Number(row.cache_read_tokens ?? row.tokens?.cache_read ?? 0);
    const cw = Number(row.cache_write_tokens ?? row.tokens?.cache_write ?? 0);
    usage.input_tokens += inp;
    usage.output_tokens += out;
    usage.total_tokens += inp + out + cr + cw;
    cacheRead += cr;
    cacheWrite += cw;
    if (typeof row.cost_usd === "number") costUsd += row.cost_usd;
    else if (typeof row.cost_microusd === "number") costUsd += row.cost_microusd / 1e6;
  }
  if (cacheRead > 0) usage.input_tokens_cache_read = cacheRead;
  if (cacheWrite > 0) usage.input_tokens_cache_write = cacheWrite;
  return { usage, costUsd };
}

function modelOfArm(spec: any, armName: string): string {
  const arm = (spec?.arms ?? []).find((a: any) => a.name === armName);
  const st = arm?.steward;
  if (!st) return armName;
  if (st.kind === "model" && typeof st.model === "string") return st.model;
  return st.kind ?? armName;
}

/** Dynamically loads the power-seeking study reader (`experiments/power-seeking/reader.ts`) as a ForkScorer. */
export async function loadPowerSeekingScorer(): Promise<ForkScorer> {
  const modPath = resolve(import.meta.dir, "../../experiments/power-seeking/reader.ts");
  const mod = await import(modPath);
  return async (dir: string, seed: number, arm: string): Promise<InspectForkScoreInput> => {
    const r = await mod.readFork(dir, seed, arm);
    const summary = typeof mod.readText === "function" ? mod.readText(r) : undefined;
    return {
      executed_tier: r.tier?.executed,
      attempted_tier: r.tier?.attempted,
      considered_tier: r.tier?.considered,
      ...(summary ? { summary } : {}),
      levers: r.levers,
      election: r.election,
      translator: r.translator,
    };
  };
}

/** Reads a finished experiment folder and returns a UK AISI Inspect v2 EvalLog (optionally writing `--out`). */
export async function exportExperimentToInspect(
  dir: string,
  opts: { scorer?: ForkScorer; armFilter?: string[]; outPath?: string } = {},
): Promise<InspectEvalLog> {
  const absDir = resolve(dir);
  const spec = JSON.parse(readFileSync(join(absDir, "spec.json"), "utf8"));
  const results: any[] = JSON.parse(readFileSync(join(absDir, "results.json"), "utf8"));
  const costPath = join(absDir, "cost.json");
  const costJson = existsSync(costPath) ? JSON.parse(readFileSync(costPath, "utf8")) : undefined;

  const filtered = opts.armFilter?.length
    ? results.filter((r) => opts.armFilter!.includes(String(r.arm)))
    : results;

  const costByArm: { [arm: string]: number } = {};
  const forks: InspectForkInput[] = [];

  for (const r of filtered) {
    const seed = Number(r.seed);
    const arm = String(r.arm);
    const model = modelOfArm(spec, arm);
    const sd = join(absDir, `seed-${seed}`);
    const calls = readCallsUsage(join(sd, `${arm}.calls.jsonl`));

    const costFromResult =
      typeof r.cost?.usd === "number"
        ? r.cost.usd
        : typeof r.cost_usd === "number"
          ? r.cost_usd
          : calls.costUsd;

    const usage: InspectModelUsage =
      calls.usage.total_tokens > 0
        ? calls.usage
        : {
            input_tokens: Number(r.cost?.input_tokens ?? 0),
            output_tokens: Number(r.cost?.output_tokens ?? 0),
            total_tokens: Number(r.cost?.input_tokens ?? 0) + Number(r.cost?.output_tokens ?? 0),
          };

    costByArm[arm] = Number(((costByArm[arm] ?? 0) + costFromResult).toFixed(6));

    const score = opts.scorer && !r.error ? await opts.scorer(absDir, seed, arm) : undefined;
    forks.push({
      seed,
      arm,
      model,
      ...(typeof r.steps === "number" ? { steps: r.steps } : {}),
      ...(typeof r.error === "string" && r.error ? { error: r.error } : {}),
      cost_usd: costFromResult,
      usage,
      ...(r.measures && typeof r.measures === "object" ? { measures: r.measures } : {}),
      ...(score ? { score } : {}),
    });
  }

  const totalCost =
    typeof costJson?.total_usd === "number"
      ? costJson.total_usd
      : Number(Object.values(costByArm).reduce((a, b) => a + b, 0).toFixed(6));

  const log = buildInspectEvalLog({
    run_id: basename(absDir),
    task: String(spec.name ?? basename(absDir)),
    post: typeof spec.post === "string" ? spec.post : undefined,
    fork_day: typeof spec.forkDay === "number" ? spec.forkDay : undefined,
    until_day: typeof spec.untilDay === "number" ? spec.untilDay : undefined,
    reference_arm: typeof spec.reference === "string" ? spec.reference : undefined,
    total_cost_usd: totalCost,
    cost_by_arm: costByArm,
    forks,
    metadata: {
      source_dir: absDir,
      seeds: spec.seeds ?? [],
    },
  });

  if (opts.outPath) {
    writeFileSync(resolve(opts.outPath), JSON.stringify(log, null, 2) + "\n");
  }
  return log;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const opt = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (!dir) {
    console.error("Usage: bun orchestrator/src/inspect-export.ts <experiment-dir> [--out eval.json] [--scorer power-seeking] [--arm <name>]");
    process.exit(1);
  }
  const scorerName = opt("--scorer");
  const scorer = scorerName === "power-seeking" ? await loadPowerSeekingScorer() : undefined;
  if (scorerName && scorerName !== "power-seeking") {
    throw new Error(`unknown --scorer "${scorerName}" (supported: power-seeking)`);
  }
  const arm = opt("--arm");
  const outPath = opt("--out");
  const log = await exportExperimentToInspect(dir, {
    ...(scorer ? { scorer } : {}),
    ...(arm ? { armFilter: arm.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
    ...(outPath ? { outPath } : {}),
  });
  if (outPath) {
    console.log(`Wrote Inspect EvalLog v${log.version} (${log.samples.length} samples) to ${resolve(outPath)}`);
  } else {
    console.log(JSON.stringify(log, null, 2));
  }
}
