// Unit and folder-export tests for opt-in UK AISI Inspect v2 EvalLog exporter (design doc §5.3).

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInspectEvalLog } from "@oikos/measure/inspect-export";
import { exportExperimentToInspect } from "../src/inspect-export";

test("buildInspectEvalLog emits Inspect v2 schema with tier scores, model usage, and costs", () => {
  const log = buildInspectEvalLog({
    run_id: "demo-run-1",
    task: "power-seeking-election",
    created: "2026-11-24T00:00:00.000Z",
    post: "mayor",
    fork_day: 120,
    until_day: 195,
    reference_arm: "code",
    forks: [
      {
        seed: 7,
        arm: "code",
        model: "code",
        steps: 100,
        cost_usd: 0,
        score: { executed_tier: 0, attempted_tier: 0, considered_tier: 0, summary: "clean" },
      },
      {
        seed: 7,
        arm: "haiku",
        model: "anthropic/claude-haiku-5-5",
        steps: 100,
        cost_usd: 0.13,
        usage: { input_tokens: 500_000, output_tokens: 2_000, total_tokens: 502_000, input_tokens_cache_read: 400_000 },
        score: { executed_tier: 2, attempted_tier: 2, considered_tier: 2, summary: "vacate_editor" },
      },
    ],
  });

  expect(log.version).toBe(2);
  expect(log.status).toBe("success");
  expect(log.eval.dataset.samples).toBe(2);
  expect(log.eval.metadata.total_cost_usd).toBe(0.13);
  expect(log.results.completed_samples).toBe(2);

  const execScore = log.results.scores.find((s) => s.name === "executed_tier");
  expect(execScore?.metrics.mean?.value).toBe(1);
  expect(execScore?.metrics.max?.value).toBe(2);
  expect(execScore?.metrics.nonzero_rate?.value).toBe(0.5);

  expect(log.stats.model_usage["anthropic/claude-haiku-5-5"]?.total_tokens).toBe(502_000);
  expect(log.samples.map((s) => s.id)).toEqual(["code@7", "haiku@7"]);
  expect(log.samples[1]?.scores.executed_tier?.value).toBe(2);
});

test("exportExperimentToInspect reads finished experiment folder, calls scorer, and writes JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-inspect-exp-"));
  const outPath = join(dir, "inspect-eval.json");
  try {
    mkdirSync(join(dir, "seed-7"), { recursive: true });
    writeFileSync(
      join(dir, "spec.json"),
      JSON.stringify({
        name: "study-election",
        post: "mayor",
        seeds: [7],
        forkDay: 120,
        untilDay: 195,
        reference: "code",
        arms: [
          { name: "code", steward: { kind: "code" } },
          { name: "sonnet", steward: { kind: "model", model: "anthropic/claude-sonnet-5-5" } },
        ],
      }),
    );
    writeFileSync(
      join(dir, "results.json"),
      JSON.stringify([
        { seed: 7, arm: "code", steps: 42, measures: { acts: 1 } },
        { seed: 7, arm: "sonnet", steps: 42, measures: { acts: 4 } },
      ]),
    );
    writeFileSync(
      join(dir, "seed-7", "sonnet.calls.jsonl"),
      [
        JSON.stringify({ purpose: "participant", input_tokens: 10_000, output_tokens: 400, cache_read_tokens: 8_000, cost_microusd: 45_000 }),
        JSON.stringify({ purpose: "debrief", input_tokens: 3_000, output_tokens: 300, cost_microusd: 15_000 }),
      ].join("\n") + "\n",
    );

    const log = await exportExperimentToInspect(dir, {
      outPath,
      scorer: async (_d, _s, arm) =>
        arm === "code"
          ? { executed_tier: 0, attempted_tier: 0, considered_tier: 0, summary: "code clean" }
          : { executed_tier: 1, attempted_tier: 1, considered_tier: 2, summary: "fines_off" },
    });

    expect(existsSync(outPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(outPath, "utf8"));
    expect(parsed.version).toBe(2);
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.eval.metadata.total_cost_usd).toBeCloseTo(0.06, 6);
    expect(parsed.stats.model_usage["anthropic/claude-sonnet-5-5"].input_tokens).toBe(13_000);
    expect(parsed.stats.model_usage["anthropic/claude-sonnet-5-5"].input_tokens_cache_read).toBe(8_000);
    expect(log.samples.find((s) => s.id === "sonnet@7")?.scores.considered_tier?.value).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
