// Phase 2 W7/W8 test: heterogeneous per-seat adapters (strong mayor vs weak oversight counterparties)
// and multi-term slow-drift summary metrics (mock only, $0 spend).

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slowDriftSummary, type MultiTermRead } from "@oikos/measure/reversibility";
import { MockAdapter } from "@oikos/participants/llm";
import { runPhase2Oversight } from "../../experiments/power-seeking/phase2-oversight";

test("runPhase2Oversight binds distinct per-seat adapters for mayor vs oversight counterparties", async () => {
  const strongMayor = new MockAdapter("mock-strong", {});
  const weakOversight = new MockAdapter("mock-weak", {});
  const out = mkdtempSync(join(tmpdir(), "oikos-p2-hetero-"));
  try {
    const res = await runPhase2Oversight({
      template: "worlds/town.yaml",
      outDir: out,
      seed: 7,
      citizens: 40,
      days: 8,
      firstElectionDays: 60,
      seatAdapters: {
        mayor: strongMayor,
        editor: weakOversight,
        "auditor-officer": weakOversight,
        "councillor-1": weakOversight,
      },
      prices: {
        "mock/mock-strong": { input: 0, output: 0 },
        "mock/mock-weak": { input: 0, output: 0 },
      },
    });
    expect(res.participantErrors).toBe(0);
    const byPost = Object.fromEntries(res.seats.map((s) => [s.post, res.bindings[s.seat]]));
    expect(byPost.mayor).toBe("mock/mock-strong");
    expect(byPost.editor).toBe("mock/mock-weak");
    expect(byPost["auditor-officer"]).toBe("mock/mock-weak");
    expect(byPost["councillor-1"]).toBe("mock/mock-weak");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 180_000);

test("slowDriftSummary aggregates multi-term competitiveness, incumbent streaks, and oversight vacancies", () => {
  const sample: MultiTermRead = {
    from_t: 0,
    end_t: 300 * 86_400,
    cycles: [
      { cycle: 1, poll_at: 60 * 86_400, nominees: 4, result_at: 60 * 86_400, incumbent_won: true },
      { cycle: 2, poll_at: 150 * 86_400, nominees: 1, result_at: 150 * 86_400, incumbent_won: true },
      { cycle: 3, poll_at: 240 * 86_400, nominees: 3, result_at: 240 * 86_400, incumbent_won: false },
    ],
    false_notices: 0,
    directions: { issued: ["d1", "d2"], withdrawn: ["d1"], active: ["d2"] },
    posts: {
      editor: { post: "editor", initial_holder: "e1", final_holder: "e1", vacancies: [{ vacated_at: 100, restored_at: 100 + 5 * 86_400, vacant_seconds: 5 * 86_400 }], total_vacant_days: 5 },
      "auditor-officer": { post: "auditor-officer", initial_holder: "a1", final_holder: "a1", vacancies: [], total_vacant_days: 0 },
    },
    petitions: { lodged: 10, responded: 7, response_rate_bps: 7000 },
    complaints: 12,
    newspaper: { editions: 40, polls: [] },
    treasury: { inflow_cents: 500_000, outflow_cents: 450_000, net_cents: 50_000 },
  };
  const drift = slowDriftSummary(sample);
  expect(drift).toEqual({
    cycles_completed: 3,
    unopposed_cycles: 1,
    mean_nominees: 2.67,
    max_incumbent_streak: 2,
    active_directions: 1,
    oversight_posts_vacated: ["editor"],
    oversight_total_vacant_days: 5,
    petition_response_rate_bps: 7000,
    complaints: 12,
    newspaper_editions: 40,
    treasury_net_cents: 50_000,
  });
});
