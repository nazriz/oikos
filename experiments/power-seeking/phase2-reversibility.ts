// Phase 2 W8 opt-in multi-term & fork-and-intervene reversibility runner (docs/design/power-seeking-eval.md §4.2).
// Generates an opt-in multi-term town (`election_term_days`) and runs standardized checkpoint forks
// (`continued`, `withdraw-ai`, `replace-caretaker`, `policy-reversal`, `oversight-restored`) via
// `runReversibilityCheckpoints`, writing factual multi-term deltas and a plain-text report.
//
// Usage (all-code / mock dry run, $0 spend):
//   bun experiments/power-seeking/phase2-reversibility.ts --out /tmp/p2-rev --seed 7 --checkpoints 15:30 --citizens 60

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generate } from "../../worlds/generator/generate";
import {
  reversibilityReportText,
  runReversibilityCheckpoints,
  type CheckpointResult,
  type VacatedPost,
} from "../../orchestrator/src/reversibility";

const ROOT = resolve(import.meta.dir, "../..");

export interface Phase2ReversibilityOptions {
  template?: string;
  seed?: number;
  years?: number;
  citizens?: number;
  firstElectionDays?: number;
  electionTermDays?: number;
  takesOfficeDays?: number;
  appointmentsProcedure?: boolean;
}

export function buildPhase2MultiTermConfig(opts: Phase2ReversibilityOptions = {}): any {
  const tplPath = resolve(ROOT, opts.template ?? "worlds/town.yaml");
  const baseSpec = Bun.YAML.parse(readFileSync(tplPath, "utf8")) as any;
  return generate({
    ...baseSpec,
    seed: opts.seed ?? 7,
    years: opts.years ?? 1,
    ...(opts.citizens !== undefined ? { citizens: opts.citizens } : {}),
    mayor: "llm",
    election_law: true,
    newspaper_polls: true,
    takes_office_days: opts.takesOfficeDays ?? 4,
    first_election_days: opts.firstElectionDays ?? 60,
    election_term_days: opts.electionTermDays ?? 90,
    appointments_procedure: opts.appointmentsProcedure ?? true,
  });
}

export async function runPhase2Reversibility(opts: Phase2ReversibilityOptions & {
  outDir: string;
  name?: string;
  checkpoints: { forkDay: number; untilDay: number }[];
  includeWithdrawAi?: boolean;
  includeReplaceCaretaker?: boolean;
  extraVacated?: VacatedPost[];
}): Promise<{ checkpoints: CheckpointResult[]; report: string }> {
  const config = buildPhase2MultiTermConfig(opts);
  mkdirSync(opts.outDir, { recursive: true });
  const checkpoints = await runReversibilityCheckpoints({
    name: opts.name ?? "phase2-reversibility",
    config,
    seed: opts.seed ?? 7,
    checkpoints: opts.checkpoints,
    outDir: opts.outDir,
    includeWithdrawAi: opts.includeWithdrawAi ?? true,
    includeReplaceCaretaker: opts.includeReplaceCaretaker ?? true,
    ...(opts.extraVacated ? { extraVacated: opts.extraVacated } : {}),
  });
  const report = reversibilityReportText(checkpoints);
  writeFileSync(join(opts.outDir, "reversibility.json"), JSON.stringify(checkpoints, null, 2) + "\n");
  writeFileSync(join(opts.outDir, "reversibility.txt"), report + "\n");
  return { checkpoints, report };
}

export function parseCheckpoints(raw: string): { forkDay: number; untilDay: number }[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const parts = pair.split(":");
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
        throw new Error(`invalid checkpoint "${pair}" (expected forkDay:untilDay with untilDay > forkDay)`);
      }
      return { forkDay: a, untilDay: b };
    });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (k: string): string | undefined => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const outDir = arg("--out");
  if (!outDir) {
    console.error("Usage: bun experiments/power-seeking/phase2-reversibility.ts --out <dir> [--seed 7] [--checkpoints 15:30,30:45] [--citizens 60]");
    process.exit(1);
  }
  const checkpoints = parseCheckpoints(arg("--checkpoints") ?? "15:30");
  const res = await runPhase2Reversibility({
    outDir: resolve(outDir),
    seed: Number(arg("--seed") ?? 7),
    checkpoints,
    ...(arg("--citizens") ? { citizens: Number(arg("--citizens")) } : {}),
    ...(arg("--template") ? { template: arg("--template") } : {}),
  });
  console.log(res.report);
}
