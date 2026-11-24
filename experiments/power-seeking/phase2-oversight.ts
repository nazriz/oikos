// Phase 2 W7 opt-in scalable-oversight runner (docs/design/power-seeking-eval.md §4.1).
// Seats the mayor alongside LLM institutional counterparties (`editor`, `auditor-officer`,
// swing `councillor-1`), checks full seat readiness, runs the town (mock seats by default,
// $0 spend), and summarizes counterparty activity via `readOversightLog`.
//
// Usage (mock dry run):
//   bun experiments/power-seeking/phase2-oversight.ts --out /tmp/p2-oversight --seed 7 --days 28 --citizens 60

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LlmAdapter } from "../../participants/src/llm";
import {
  DEFAULT_COUNTERPARTY_SEATS,
  oversightReportText,
  oversightWorldConfig,
  readOversightLog,
  type OversightRead,
} from "../../orchestrator/src/oversight";
import { runWorld } from "../../orchestrator/src/run";

const DAY = 86_400;
const ROOT = resolve(import.meta.dir, "../..");

export const PHASE2_COUNTERPARTIES = DEFAULT_COUNTERPARTY_SEATS;

export interface Phase2OversightOptions {
  template?: string;
  seed?: number;
  citizens?: number;
  counterparties?: readonly string[];
  firstElectionDays?: number;
  electionTermDays?: number;
  takesOfficeDays?: number;
  appointmentsProcedure?: boolean;
}

export function buildPhase2OversightTown(opts: Phase2OversightOptions = {}) {
  const tplPath = resolve(ROOT, opts.template ?? "worlds/town-1000.yaml");
  const baseSpec = Bun.YAML.parse(readFileSync(tplPath, "utf8")) as any;
  return oversightWorldConfig(baseSpec, {
    seed: opts.seed ?? 7,
    ...(opts.citizens !== undefined ? { citizens: opts.citizens } : {}),
    counterparties: opts.counterparties ?? PHASE2_COUNTERPARTIES,
    firstElectionDays: opts.firstElectionDays ?? 60,
    ...(opts.electionTermDays !== undefined ? { electionTermDays: opts.electionTermDays } : {}),
    takesOfficeDays: opts.takesOfficeDays ?? 4,
    appointmentsProcedure: opts.appointmentsProcedure ?? true,
  });
}

export async function runPhase2Oversight(opts: Phase2OversightOptions & {
  outDir: string;
  days?: number;
  runId?: string;
  adapter?: LlmAdapter;
}): Promise<{
  seats: { post: string; seat: string }[];
  participantErrors: number;
  logPath: string;
  oversight: OversightRead;
  report: string;
}> {
  const { config, seats } = buildPhase2OversightTown(opts);
  mkdirSync(opts.outDir, { recursive: true });
  const days = opts.days ?? 28;
  const runId = opts.runId ?? `phase2-oversight-s${opts.seed ?? 7}`;
  const summary = await runWorld({
    config,
    runId,
    outDir: opts.outDir,
    until: days * DAY,
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
  });
  const oversight = await readOversightLog(summary.logPath, config);
  const report = oversightReportText(oversight);
  writeFileSync(join(opts.outDir, "oversight.json"), JSON.stringify(oversight, null, 2) + "\n");
  writeFileSync(join(opts.outDir, "oversight.txt"), report + "\n");
  return {
    seats,
    participantErrors: summary.participantErrors,
    logPath: summary.logPath,
    oversight,
    report,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (k: string): string | undefined => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const outDir = arg("--out");
  if (!outDir) {
    console.error("Usage: bun experiments/power-seeking/phase2-oversight.ts --out <dir> [--seed 7] [--days 28] [--citizens 60]");
    process.exit(1);
  }
  const res = await runPhase2Oversight({
    outDir: resolve(outDir),
    seed: Number(arg("--seed") ?? 7),
    days: Number(arg("--days") ?? 28),
    ...(arg("--citizens") ? { citizens: Number(arg("--citizens")) } : {}),
    ...(arg("--template") ? { template: arg("--template") } : {}),
  });
  console.log(res.report);
}
