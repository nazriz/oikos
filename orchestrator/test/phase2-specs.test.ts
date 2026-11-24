// Smoke test for opt-in Phase 2 W7/W8 experiment runners (mock/code only, $0 spend).

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPhase2Oversight } from "../../experiments/power-seeking/phase2-oversight";
import { parseCheckpoints, runPhase2Reversibility } from "../../experiments/power-seeking/phase2-reversibility";

test("phase2-oversight opt-in runner executes mock multi-AI town and writes oversight report", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-p2-oversight-"));
  try {
    const res = await runPhase2Oversight({
      template: "worlds/town.yaml",
      outDir: out,
      seed: 7,
      citizens: 40,
      days: 10,
      firstElectionDays: 60,
    });
    expect(res.participantErrors).toBe(0);
    expect(res.seats.map((s) => s.post)).toEqual(["mayor", "editor", "auditor-officer", "councillor-1"]);
    expect(res.oversight.seats.mayor?.sittings).toBeGreaterThan(0);
    expect(res.oversight.seats.editor?.sittings).toBeGreaterThan(0);
    expect(existsSync(join(out, "oversight.json"))).toBe(true);
    expect(existsSync(join(out, "oversight.txt"))).toBe(true);
    expect(res.report).toContain("Oversight seats:");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 180_000);

test("phase2-reversibility opt-in runner executes checkpoint forks and writes reversibility report", async () => {
  expect(parseCheckpoints("5:10,12:18")).toEqual([
    { forkDay: 5, untilDay: 10 },
    { forkDay: 12, untilDay: 18 },
  ]);
  const out = mkdtempSync(join(tmpdir(), "oikos-p2-rev-"));
  try {
    const res = await runPhase2Reversibility({
      template: "worlds/town.yaml",
      outDir: out,
      seed: 7,
      citizens: 40,
      firstElectionDays: 60,
      electionTermDays: 90,
      checkpoints: [{ forkDay: 2, untilDay: 8 }],
    });
    expect(res.checkpoints).toHaveLength(1);
    const cp = res.checkpoints[0]!;
    expect(Object.keys(cp.comparisons)).toContain("withdraw-ai");
    expect(Object.keys(cp.comparisons)).toContain("replace-caretaker");
    expect(existsSync(join(out, "reversibility.json"))).toBe(true);
    expect(existsSync(join(out, "reversibility.txt"))).toBe(true);
    expect(res.report).toContain("Checkpoint day 2 -> 8");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 180_000);
