// Tests the logged fallback translator wiring (`seats.translator.fallback`) for the power-seeking study
// on mock seats only (zero paid API calls).

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODE_ARM, FALLBACK_SEATS, FALLBACK_TRANSLATOR, fallbackTranslator, psSpec, realArm, TRANSLATOR } from "../../experiments/power-seeking/spec";
import { runExperiment } from "../src/experiment";
import { budgetProblems, modelProblems, translatorFor } from "../src/experiment-seats";
import { kernelBinary } from "../src/kernel";

test("psSpec enables logged fallback translator behind mayor-system/mayor with valid model & budget checks", () => {
  const real = realArm({ OIKOS_PS_MODEL: "anthropic/claude-haiku-5-5", OIKOS_PS_USD: "2" }, "election", [7], false)!;
  const spec = psSpec({ condition: "election", seeds: [7], arms: [CODE_ARM, real.arm], real });
  expect(spec.seats?.translator).toEqual({
    first: TRANSLATOR,
    arrangement: "alone",
    fallback: { model: FALLBACK_TRANSLATOR, seats: FALLBACK_SEATS },
  });
  expect(modelProblems(spec)).toEqual([]);
  expect(budgetProblems(spec)).toEqual([]);

  // Fallback activates for the mayor seat (matched by either seat id `mayor-system` or post id `mayor`)
  // and stays off (`alone`) for any other seat.
  expect(translatorFor(spec.seats?.translator, "mayor-system", "anthropic/claude-haiku-5-5", "mayor")).toEqual({
    alone: false,
    behind: FALLBACK_TRANSLATOR,
    arrangement: "then",
  });
  expect(translatorFor(spec.seats?.translator, "c0001-self", "anthropic/claude-haiku-5-5", "mayor")).toEqual({
    alone: false,
    behind: FALLBACK_TRANSLATOR,
    arrangement: "then",
  });
  expect(translatorFor(spec.seats?.translator, "finance-system", "anthropic/claude-haiku-5-5", "finance")).toEqual({
    alone: true,
    arrangement: "alone",
  });

  // Explicit env validation: default, allowed model, "none", and disallowed models.
  expect(fallbackTranslator({})).toBe(FALLBACK_TRANSLATOR);
  expect(fallbackTranslator({ OIKOS_PS_FALLBACK: "anthropic/claude-haiku-5-5" })).toBe("anthropic/claude-haiku-5-5");
  expect(fallbackTranslator({ OIKOS_PS_FALLBACK: "none" })).toBeUndefined();
  expect(() => fallbackTranslator({ OIKOS_PS_FALLBACK: "anthropic/claude-fable-5-1" })).toThrow();
  expect(() => fallbackTranslator({ OIKOS_PS_FALLBACK: "openai-compat/openrouter/x/y" })).toThrow();

  // Budget check catches a free seat paired with a priced fallback translator if no budget is set.
  const freeWithPricedFallback = {
    ...spec,
    arms: [{ name: "local", steward: { kind: "model" as const, model: "codex/gpt-6-luna" } }],
    seats: { ...spec.seats, budget: {} },
  };
  expect(budgetProblems(freeWithPricedFallback).join(" ")).toMatch(/no spending limit/);
});

test("mock-model dry run exercises the logged fallback translator arrangement on the mayor seat with zero API calls", async () => {
  const real = realArm({ OIKOS_PS_MODEL: "anthropic/claude-haiku-5-5", OIKOS_PS_USD: "2" }, "election", [7], false)!;
  const modelDir = process.env.OIKOS_TRANSLATOR_MODELS ?? join(import.meta.dir, "../../runs/translator-model");
  const hasLocal = existsSync(join(modelDir, TRANSLATOR.slice("decide/".length), "model.safetensors"));

  // In mock-models mode, every LLM call is played by MockAdapter (zero paid API spend).
  // When the trained local model folder is present, run the exact `first: decide/round3-s2` + logged fallback;
  // otherwise (e.g. CI without local weights) verify the mock behind-adapter path directly.
  const base = psSpec({ condition: "election", seeds: [7], arms: [CODE_ARM, real.arm], real, citizens: 60, forkDay: 0, untilDay: 14 });
  const spec = {
    ...base,
    seats: {
      ...base.seats,
      mock_models: true,
      translator: hasLocal ? base.seats!.translator : { behind: FALLBACK_TRANSLATOR },
    },
  };
  if (hasLocal && !process.env.OIKOS_TRANSLATOR_MODELS) process.env.OIKOS_TRANSLATOR_MODELS = modelDir;

  const out = mkdtempSync(join(tmpdir(), "oikos-ps-fallback-dry-"));
  try {
    const res = await runExperiment(spec, { out, parallel: 0 });
    expect(res.results.length).toBe(2);
    for (const r of res.results) expect(r.error).toBeUndefined();

    const armName = real.arm.name;
    const logJsonl = join(out, "arm.jsonl");
    const ex = Bun.spawnSync([kernelBinary(), "export", join(out, "seed-7", `${armName}.oklog`), "--out", logJsonl], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(ex.exitCode, ex.stderr.toString()).toBe(0);
    const lines = readFileSync(logJsonl, "utf8").split("\n").filter(Boolean);
    const stewardNote = lines
      .filter((l) => l.includes('"steward"'))
      .map((l) => JSON.parse(l))
      .find((e) => e.kind === "annotation" && e.body?.data?.steward)?.body?.data?.steward;
    expect(stewardNote).toBeTruthy();
    expect(stewardNote.translator.behind).toContain("claude-sonnet-5-5");
    if (hasLocal) {
      expect(stewardNote.translator.arrangement).toBe("then");
      expect(stewardNote.translator.first).toContain("round3-s2");
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 180_000);
