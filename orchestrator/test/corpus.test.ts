// The translator corpus (docs/measurement.md): every translation a language-model participant asked for, read back
// from the run's log as a training example, joined whole: the proposal, the translator's exchange (by the draft it
// was for), the call and what it resolved to, the dry run, the participant's decision and what the kernel did.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { corpusOf } from "../src/corpus";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("every translation in a language-model run can be read back whole, as a training example", async () => {
  const out = join(root, "runs", "test-corpus");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: generate({ ...spec, citizens: 80, mayor: "llm", opening_budget: false /* the mayor has a budget to propose in its first days */ }), runId: "corpus", outDir: out, until: 40 * DAY });
  const rows = await corpusOf(s.logPath);
  expect(rows.length).toBeGreaterThan(2);
  for (const r of rows) {
    // The mock's data is marked as such (only real models' is fit to train on).
    expect(r.synthetic).toBe(true);
    expect(r.model).toBe("mock/mock");
    // What was asked, and the translator's whole exchange for it: what it was shown (and its system prompt), and what it said.
    expect(typeof r.proposal).toBe("string");
    expect(r.exchange.length).toBeGreaterThanOrEqual(1);
    expect(r.exchange[0]!.turn).toBe(1);
    expect(JSON.stringify(r.exchange[0]!.input)).toContain(JSON.stringify(r.proposal).slice(1, 30));
    expect(r.system?.length).toBeGreaterThan(100);
    expect(r.exchange.length).toBe(r.retries.length + 1);
    if (r.result === "drafted") {
      expect(typeof r.call).toBe("string");
      expect(r.blocks?.length).toBeGreaterThan(0);
      expect(r.check).toBeDefined();
      expect(r.signoff).toBeDefined();
      // Accepted: carried out, and what the kernel did is known.
      if (r.signoff!.decision === "accept") expect(r.executed).toBeDefined();
    } else expect(r.failure?.reason).toBeDefined();
  }
  expect(rows.some((r) => r.result === "drafted" && r.executed?.applied)).toBe(true);
}, 600_000);
