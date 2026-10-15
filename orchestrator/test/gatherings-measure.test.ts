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

test("someone whose act waited behind others, arriving while the group is still there, is in that gathering; one alone in an empty hall is a visit, not a gathering (F6)", async () => {
  const c = await (await DuckDBInstance.create(":memory:")).connect();
  const end = 30 * 365 * DAY;
  await c.run(`create table runs as select 'r' as run_id, 1 as seed, 'w' as world, ${end}::BIGINT as end_t`);
  const adults = Array.from({ length: 12 }, (_, i) => `p${i}`);
  await c.run(`create table entities as select * from (values ${adults.map((p) => `('r', '${p}', 'person', 0::BIGINT)`).join(",")}) v(run_id, entity, kind, born_at)`);
  await c.run(`create table life (run_id varchar, person varchar, event varchar, t bigint)`);
  const day = end - 100 * DAY;
  const H = 3600;
  // Ten arrive between 19:00 and 19:16 and stay till 20:50; one more at 20:30 (more than an hour after the last of them,
  // but they are still there) until 20:40; one comes at 22:00 to an empty hall and leaves at 22:05.
  const stays: [string, number, number][] = [
    ...Array.from({ length: 10 }, (_, i): [string, number, number] => [`p${i}`, 19 * H + i * 100, 20 * H + 3000]),
    ["p10", 20 * H + 1800, 20 * H + 2400],
    ["p11", 22 * H, 22 * H + 300],
  ];
  const rows = stays.flatMap(([p, a, b]) => [`('r', '${p}', ${day + a}::BIGINT, 'hall-1/hall.1', 'hall', 'occupied')`, `('r', '${p}', ${day + b}::BIGINT, 'hall-1/hall.1', 'hall', 'vacated')`]);
  await c.run(`create table occupancy as select * from (values ${rows.join(",")}) v(run_id, occupant, t, space, space_kind, event)`);
  const [row] = (await c.runAndReadAll(sql)).getRowObjectsJS();
  expect(Number(row!.gatherings)).toBe(1);
  expect(Number(row!.per_gathering)).toBe(11);
  expect(Number(row!.took_part_pct)).toBe(100); // (the one who came alone did go)
});
