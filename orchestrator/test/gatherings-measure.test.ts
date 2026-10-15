// The gatherings measure counts a gathering once, whatever the clock says: people arrive minutes apart (acts take time),
// and a gathering whose arrivals straddle the turn of an hour was counted as two, with half the people each (F1, 2026-10-15).

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DuckDBInstance } from "../../measure/node_modules/@duckdb/node-api";

const sql = readFileSync(join(import.meta.dir, "../../measure/queries/town/gatherings.sql"), "utf8");
const DAY = 86_400;

test("arrivals across the turn of an hour are one gathering; a gathering later the same day is another", async () => {
  const c = await (await DuckDBInstance.create(":memory:")).connect();
  const end = 30 * 365 * DAY;
  await c.run(`create table runs as select 'r' as run_id, 1 as seed, 'w' as world, ${end}::BIGINT as end_t`);
  const adults = Array.from({ length: 10 }, (_, i) => `p${i}`);
  await c.run(`create table entities as select * from (values ${adults.map((p) => `('r', '${p}', 'person', 0::BIGINT)`).join(",")}) v(run_id, entity, kind, born_at)`);
  await c.run(`create table life (run_id varchar, person varchar, event varchar, t bigint)`);
  const day = end - 100 * DAY;
  // Six arrive between 09:50 and 10:10 (across the hour), four at 15:00 to 15:05.
  const at = [9 * 3600 + 3000, 9 * 3600 + 3300, 9 * 3600 + 3500, 10 * 3600 + 100, 10 * 3600 + 300, 10 * 3600 + 600, 15 * 3600, 15 * 3600 + 100, 15 * 3600 + 200, 15 * 3600 + 300];
  await c.run(`create table occupancy as select * from (values ${at.map((t, i) => `('r', 'p${i}', ${day + t}::BIGINT, 'hall-1/hall.1', 'hall', 'occupied')`).join(",")}) v(run_id, occupant, t, space, space_kind, event)`);
  const rows = (await c.runAndReadAll(sql)).getRowObjectsJS();
  expect(Number(rows[0]!.gatherings)).toBe(2);
  expect(Number(rows[0]!.per_gathering)).toBe(5); // (6 and 4)
  expect(Number(rows[0]!.took_part_pct)).toBe(100);
});
