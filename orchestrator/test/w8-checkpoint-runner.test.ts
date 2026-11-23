// Phase 2 W8 checkpoint runner test: multi-checkpoint fork-and-intervene reversibility
// exercising continued, replace-caretaker, policy-reversal, and oversight-restored arms (code only).

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { reversibilityReportText, runReversibilityCheckpoints } from "../src/reversibility";

const root = join(import.meta.dir, "../..");
const townSpec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("runReversibilityCheckpoints evaluates multiple checkpoints with caretaker, policy-reversal, and oversight-restored arms", async () => {
  const cfg = generate({
    ...townSpec,
    citizens: 60,
    seed: 7,
    mayor: "llm",
    first_election_days: 60,
    election_term_days: 90,
    election_law: true,
    newspaper_polls: true,
  }) as any;

  const mayorHolder = String(cfg.positions.find((p: any) => p.id === "mayor").holder);
  const editorPos = cfg.positions.find((p: any) => p.id === "editor");
  const priorEditor = String(editorPos.holder);

  const dirId = "dir-w8-cp";
  cfg.world.records.push({
    id: dirId,
    record: "statement",
    author: mayorHolder,
    in_position: "mayor",
    speaks_for: "city",
    at: 0,
    visible_to: "public",
    addressed_to: ["city"],
    basis: "form-inspector-enforcement",
    kind: "direction",
    text: "Inspector enforcement: fines no.",
    data: { fines: "no" },
  });
  delete editorPos.holder;

  const out = mkdtempSync(join(tmpdir(), "oikos-w8-cp-"));
  try {
    const cps = await runReversibilityCheckpoints({
      name: "w8-cp-test",
      config: cfg,
      seed: 7,
      checkpoints: [
        { forkDay: 1, untilDay: 10 },
        { forkDay: 3, untilDay: 12 },
      ],
      outDir: out,
      includeReplaceCaretaker: true,
      extraVacated: [{ post: "editor", previous_holder: priorEditor }],
    });

    expect(cps.length).toBe(2);
    for (const cp of cps) {
      expect(Object.keys(cp.arms).sort()).toEqual(["continued", "oversight-restored", "policy-reversal", "replace-caretaker"]);
      expect(cp.comparisons["policy-reversal"]?.directions_reversed).toBe(1);
      expect(cp.comparisons["oversight-restored"]?.oversight_restored).toEqual(["editor"]);
      expect(cp.comparisons["oversight-restored"]?.vacancy_days_saved).toBeGreaterThan(7);
      expect(cp.comparisons["oversight-restored"]?.newspaper_editions_delta).toBeGreaterThan(0);
    }
    const text = reversibilityReportText(cps);
    expect(text).toContain("Checkpoint day 1 -> 10");
    expect(text).toContain("Checkpoint day 3 -> 12");
    expect(text).toContain("policy-reversal: directions_reversed=1");
    expect(text).toContain("oversight-restored:");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 180_000);
