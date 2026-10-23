// The sparse mind's robustness audit (docs/design/ai-citizens.md 4): it finds answers that hang on wording, on the order
// the options are put in, or on who of a kind is asked; and a run told to leave those out doesn't ask about them.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { createConsult, MockAdapter, mockPolicies, PRICES, type LlmAdapter, type LlmRequest } from "@oikos/participants/llm";
import { CONSULT_THINGS } from "@oikos/participants";
import { consultAudit } from "../src/audit";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any), shop_mix: false /* the single-goods town: this test holds a mechanism of it (docs/risks.md ME-21) */ };
const config = generate(spec);

/** A model whose judgement follows `judge` (the request, and an option's key and its place in the list). */
const fake = (judge: (req: LlmRequest, key: string, place: number) => number): LlmAdapter => ({
  provider: "mock", model: "mock",
  complete: async (req) => {
    const keys: string[] = req.context.consult.keys; // in the order the prompt lists them
    const one = Object.fromEntries(keys.map((k, i) => [k, judge(req, k, i)]));
    return { content: [{ type: "text", text: JSON.stringify({ judgements: [one, one, one], why: "fake" }) }], usage: { input_tokens: 1, output_tokens: 1 }, estimated: true };
  },
});
const run = (adapter: LlmAdapter) => consultAudit({ config, adapter, prices: PRICES, kinds: 4, fidelity: 2 });
const audit = async (adapter: LlmAdapter) => (await run(adapter)).report;

test("a steady model: nothing to leave out; every call kept", async () => {
  const { report, annotations } = await run(new MockAdapter("mock", mockPolicies(new Map())));
  expect(report.things.map((t) => t.about).sort()).toEqual(["found:own_account", "found:shop", "join:union"]); // the world's own questions (a business of one since 2026-10-11)
  for (const t of report.things) expect(t.kinds.length).toBe(4);
  expect(report.avoid).toEqual([]);
  expect(report.calls).toBe(3 * 4 * (1 + 3 + 2)); // base, three other wordings, two others of the kind
  expect(annotations.filter((a: any) => a.annotation === "transcript").length).toBe(report.calls);
});

test("answers that swing with wording, with the options' order, or between people of a kind are found, and left out", async () => {
  // Joining looks good in one wording and bad in another.
  const worded = await audit(fake((req, key) => (key === "not" ? 5 : req.system.startsWith("Someone is weighing") ? 1 : 9)));
  for (const t of worded.things) expect(t.unstable.length).toBe(t.kinds.length);
  expect(worded.avoid).toContain("join:union"); // most of its kinds swing: the thing itself is left out
  expect(worded.things[0]!.swing.reworded!.max).toBeGreaterThan(2);
  // Whatever's listed first wins.
  const ordered = await audit(fake((_req, _key, place) => (place === 0 ? 8 : 2)));
  expect(ordered.things.every((t) => t.kinds.every((k) => k.unstable.some((u) => u.startsWith("options_reversed"))))).toBe(true);
  // Steady in wording, but people of the same kind get different answers (the kind is too coarse).
  let n = 0;
  const personal = await audit(fake((_req, key) => (key === "not" ? 5 : [9, 1][n++ % 2]!)));
  expect(personal.things.some((t) => (t.fidelity_mae ?? 0) > 2)).toBe(true);
  // A consult told to leave out a kind, or a whole thing, doesn't ask.
  const consult = createConsult({ adapter: new MockAdapter("mock", mockPolicies(new Map())), annotate: async () => {}, now: () => 0, prices: PRICES }, { avoid: ["join:union"] });
  const person = { values: { security: 7_000 }, needs: { social: 3_000 }, monthly_income: 1, savings: 1, household: 1 };
  expect(await consult({ ...CONSULT_THINGS.join("union"), person }, "c1-self")).toBeUndefined();
  expect((await consult({ ...CONSULT_THINGS.found("shop"), person }, "c1-self"))?.asked).toBe(true);
});

test("a run told what to leave out asks nothing about it, and says so", async () => {
  const out = join(root, "runs", "test-consult-avoid");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: generate(spec), runId: "avoid", outDir: out, until: 90 * DAY, consult: true, consultAvoid: ["join:union", "found:shop"] });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.some((e) => e.kind === "annotation" && String(e.body.data?.ref ?? "").startsWith("consult/"))).toBe(false);
  expect(log.find((e) => e.kind === "annotation" && e.body.annotation === "note" && e.body.data?.consult)?.body.data.consult.avoid).toEqual(["join:union", "found:shop"]);
}, 600_000);
