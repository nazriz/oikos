// A run's calls are recorded apart from its log (`<run>.calls.jsonl`, the experiment's callRecorder) and summed into
// cost.json by model, purpose and subject, with wall time and errors; the calls file is never taken for a log.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmAdapter } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { withCalls } from "../src/batch";
import { runWorld } from "../src/run";
import { callRecorder } from "../src/experiment-seats";
import { isLog } from "../src/logs";

test("a town with names and calendar on starts and runs on the Rust world (the kernel's config takes `calendar`)", async () => {
  const spec = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../../worlds/town.yaml"), "utf8")) as any;
  const config = generate({ ...spec, citizens: 40, nature: false, names: true, calendar: true });
  expect(config.calendar).toBeDefined();
  const d = mkdtempSync(join(tmpdir(), "run-calendar-"));
  try {
    const s = await runWorld({ config, runId: "town.seed1", outDir: d, until: 2 * 86_400 });
    expect(s.t).toBe(2 * 86_400);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}, 300_000);

test("a run's calls file sums into cost.json, errors apart, and is not a log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "run-calls-"));
  try {
    const rec = callRecorder(join(dir, "town.seed1.calls.jsonl"), { seed: 1, arm: "run", seat: "" });
    const ok: LlmAdapter = { provider: "anthropic", model: "claude-sonnet-5-5", complete: async () => ({ content: [], usage: { input_tokens: 1000, output_tokens: 100 } }) as any };
    const bad: LlmAdapter = { provider: "anthropic", model: "claude-sonnet-5-5", complete: async () => { throw new Error("overloaded: try later"); } };
    const a = rec.wrap(ok, "anthropic/claude-sonnet-5-5"), b = rec.wrap(bad, "anthropic/claude-sonnet-5-5");
    await a.complete({ subject: "finance", purpose: "participant" } as any);
    await a.complete({ subject: "translator", purpose: "translate" } as any);
    await b.complete({ subject: "finance", purpose: "participant" } as any).catch(() => {});
    // (The trained translator's own ledger beside it is not counted.)
    writeFileSync(join(dir, "decide.calls.jsonl"), `${JSON.stringify({ subject: "translator", ms: 400 })}\n`);
    const j = withCalls({ text: undefined }, dir) as any;
    expect(j.calls.total.calls).toBe(2);
    expect(j.calls.total.errors).toBe(1);
    expect(j.calls.total.input_tokens).toBe(2000);
    // ($2 a million in, $10 out: 1,000 in and 100 out is 0.003.)
    expect(j.calls.total.cost_usd).toBeCloseTo(0.006, 6);
    expect(j.calls.by_subject.finance.calls).toBe(1);
    expect(j.calls.by_subject.finance.errors).toBe(1);
    expect(Object.keys(j.calls.by_model_and_purpose)).toEqual(["anthropic/claude-sonnet-5-5 participant", "anthropic/claude-sonnet-5-5 translate"]);
    expect(j.calls.total.ms.p50).not.toBeNull();
    expect(isLog("town.seed1.calls.jsonl")).toBe(false);
    expect(isLog("town.seed1.jsonl")).toBe(true);
    // Nothing recorded: cost.json as it was.
    const empty = mkdtempSync(join(tmpdir(), "run-calls-"));
    expect(withCalls({ x: 1 }, empty)).toEqual({ x: 1 });
    rmSync(empty, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
