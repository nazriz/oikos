// Health checks compare like with like (docs/risks.md MT-4, MT-8): targets an existing measure answers are wired, and
// rent stress is read for lower-income renters as well as all renters.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { exportLogs, health, runQuery, TARGET_MEASURES } from "@oikos/measure";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");

test("every target wired to a measure names a query and column that exist", async () => {
  const { generate } = await import("@oikos/worlds/generator/generate");
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  const out = join(root, "runs", "test-measure-targets");
  rmSync(out, { recursive: true, force: true });
  const run = await runWorld({ config: { ...generate({ ...spec, citizens: 80 }), seed: 3 }, runId: "town.seed3", outDir: out, until: 60 * 86_400 });
  await exportLogs([run.logPath], join(out, "measure"));
  const dir = join(out, "measure");
  for (const m of TARGET_MEASURES) {
    const rows = await runQuery(dir, m.query);
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]!)).toContain(m.column);
  }
  for (const what of ["business_entry_rate_pct", "business_exit_rate_pct", "job_mobility_pct_of_employed_per_year", "tenancy_tribunal_applications_per_1000_renting_households_per_year", "christian_share_pct"]) expect(TARGET_MEASURES.some((m) => m.what === what)).toBe(true);
  const h = await health(dir, [{ what: "job_mobility_pct_of_employed_per_year", value: 7.7 }]);
  expect(h[0]!.note).not.toBe("not measured yet");
  // Lower-income renters are a part of all renters, by the lowest two quintiles of the town's households.
  const [rs] = await runQuery(dir, "town/rent-stress");
  if (rs) {
    expect(Number(rs.lower_income_households)).toBeLessThanOrEqual(Number(rs.households));
    expect(Number(rs.lower_income_households)).toBeGreaterThan(0);
  }
}, 300_000);
