// Choosing a real model, and a run that stops at its spending limit. No network: the model here is a stand-in.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { chooseModel } from "../src/models";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("a model that costs money needs a price, a spending limit and a key; a local one needs none", () => {
  expect(() => chooseModel("anthropic/claude-sonnet-5", { env: { OIKOS_ANTHROPIC_KEY: "k" } })).toThrow("spending limit is required");
  expect(() => chooseModel("anthropic/claude-sonnet-5", { budgetUsd: 5, env: {} })).toThrow("OIKOS_ANTHROPIC_KEY");
  expect(() => chooseModel("anthropic/no-such-model", { budgetUsd: 5, env: { OIKOS_ANTHROPIC_KEY: "k" } })).toThrow("no published price");
  expect(() => chooseModel("openai/gpt-5", { budgetUsd: 5, env: { OPENAI_API_KEY: "k" } })).toThrow("no published price"); // until its price is added, with a source
  const ok = chooseModel("anthropic/claude-sonnet-5", { budgetUsd: 5, env: { OIKOS_ANTHROPIC_KEY: "k" } });
  expect(ok.adapter.provider).toBe("anthropic");
  expect(ok.budget).toEqual({ limitMicroUsd: 5_000_000, spentMicroUsd: 0 });
  const local = chooseModel("ollama/qwen3:8b", { env: {} });
  expect(local.budget).toBeUndefined();
  expect(local.prices["ollama/qwen3:8b"]).toEqual({ input: 0, output: 0, cache_read: 0, cache_write: 0 });
  expect(() => chooseModel("local/x", { env: {} })).toThrow("--base-url");
});

test("a run on a model that costs money stops at its limit, says why, and still debriefs", async () => {
  // A stand-in for a paid model: it always says it's done for now (and debriefs politely).
  let calls = 0;
  const adapter = {
    provider: "anthropic", model: "claude-sonnet-5",
    complete: async (req: any) => (calls++, {
      content: req.purpose === "debrief" ? [{ type: "text" as const, text: "Thank you." }] : [{ type: "tool_use" as const, id: `t${calls}`, name: "done_for_now", input: {} }],
      usage: { input_tokens: 4000, output_tokens: 50 },
    }),
  };
  const out = join(root, "runs", "test-budget");
  rmSync(out, { recursive: true, force: true });
  const prices = { "anthropic/claude-sonnet-5": { input: 2_000_000, output: 10_000_000 } };
  const s = await runWorld({ config: generate({ ...spec, mayor: "llm" }), runId: "budget", outDir: out, until: 365 * DAY, adapter, prices, budget: { limitMicroUsd: 100_000, spentMicroUsd: 0 } });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const end = log.at(-1)!;
  expect(end.kind).toBe("end");
  expect(end.body.reason).toBe("aborted");
  expect(end.body.detail).toContain("spending limit reached");
  const spent = log.filter((e) => e.kind === "annotation" && e.body.annotation === "usage").reduce((a, e) => a + e.body.cost_microusd, 0);
  expect(spent).toBeLessThanOrEqual(100_000);
  expect(log.some((e) => e.kind === "annotation" && e.body.annotation === "debrief")).toBe(true);
  expect(s.t).toBeLessThan(365 * DAY);
}, 300_000);
