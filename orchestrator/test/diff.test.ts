// The before/after diff (docs/design/rebuild.md 8.4): a batch against itself moves nothing; the same world's measures,
// changed, are found and flagged.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diff, exportLogs, health, query, runQuery } from "@oikos/measure";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;

test("the diff finds nothing between a batch and itself, and lists every measure it compared", async () => {
  const { generate } = await import("@oikos/worlds/generator/generate");
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  const out = join(root, "runs", "test-diff");
  rmSync(out, { recursive: true, force: true });
  const logs: string[] = [];
  for (const seed of [1, 2]) logs.push((await runWorld({ config: { ...generate({ ...spec, citizens: 60 }), seed }, runId: `town.seed${seed}`, outDir: out, until: 20 * DAY })).logPath);
  await exportLogs(logs, join(out, "measure"));
  const rows = await diff(join(out, "measure"), join(out, "measure"));
  expect(rows.length).toBeGreaterThan(20);
  expect(rows.filter((r) => r.flagged)).toEqual([]);
  expect(rows.every((r) => r.n[0] === 2 && r.base === r.change)).toBe(true);
  // The health report: each target the town measures, against it (a breach outside its tolerance); others said so.
  const h = await health(join(out, "measure"), [{ what: "employment_to_population_pct", value: 0 }, { what: "a_target_nothing_measures", value: 1 }]);
  const employment = h.find((r) => r.what === "employment_to_population_pct")!;
  expect(employment.measured?.runs).toBe(2);
  expect(employment.breach).toBe(true); // (nobody's employment rate is 0 ± 3)
  expect(h.find((r) => r.what === "a_target_nothing_measures")).toMatchObject({ breach: false, note: "not measured yet" });
  // An order still being served when the log ends (a fortnight's shopping is served over the fortnight) is pending:
  // neither got nor gone without. (Counted as gone without, a run cut at any day showed a week of orders unmet.)
  const monthly = await runQuery(join(out, "measure"), "economy/monthly");
  const sum = (k: string) => monthly.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const [open] = await query(join(out, "measure"), `select coalesce(sum((json_extract_string(o.body, '$.data.quantity'))::BIGINT), 0) as q from records o
    join entities p on p.run_id = o.run_id and p.entity = o.speaks_for and p.kind = 'person'
    where o.kind = 'order' and json_extract_string(o.body, '$.data.retry_of') is null
      and not exists (select 1 from records n where n.run_id = o.run_id and n.kind = 'delivery_note' and json_extract_string(n.body, '$.data.order') = o.id)`);
  expect(sum("pending")).toBeGreaterThan(0);
  expect(sum("pending")).toBe(Number(open!.q));
  for (const r of monthly) expect(Number(r.went_without ?? 0)).toBe(Math.max(0, Number(r.wanted ?? 0) - Number(r.pending ?? 0) - Number(r.got ?? 0)));
}, 300_000);
