// Water and energy (docs/behaviour/utilities.md; docs/design/world-expansion.md 6.1), in a generated town: the water
// corporation draws what the town uses from the river each day and bills owners quarterly; the energy retailer buys from
// the grid, supplies its customers (each kWh emitting the grid's greenhouse gas into the world's counter, censused
// monthly) and bills them; households pay. With no water coming down the river, it runs dry: restrictions.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function run(name: string, config: any, days: number) {
  const out = join(root, "runs", `test-utilities-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: days * DAY });
  expect(s.participantErrors).toBe(0);
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("water is drawn from the river and energy bought from the grid, as the town uses them; bills are paid; emissions counted", async () => {
  const config = generate({ ...spec, years: 1 });
  const { ev, recs } = await run("town", config, 120);
  const units = (task: string) => ev.filter((e) => e.event === "worked" && e.task === task).reduce((a, e) => a + e.units, 0);
  // Water: about the town's people at 160 litres a day each.
  const people = config.world.entities.filter((e: any) => e.kind === "person").length;
  expect(units("draw_water")).toBeGreaterThan((people * 160 * 100) / 1000);
  expect(units("draw_water")).toBeLessThan((people * 160 * 125) / 1000);
  // Energy: households signed up when they had a home, supplied at 11 kWh a day; each kWh's 780 g counted.
  const customers = recs.filter((r) => r.kind === "supply_request").length;
  expect(customers).toBeGreaterThan(50);
  const supplied = units("supply_energy");
  expect(supplied).toBeGreaterThan(customers * 11 * 90);
  const census = ev.filter((e) => e.event === "counter_census").map((e) => e.counters.greenhouse_gas);
  expect(census.length).toBe(4);
  expect([...census].sort((a, b) => a - b)).toEqual(census);
  const supplyBefore = ev.filter((e) => e.event === "worked" && e.task === "supply_energy" && e.t <= ev.find((x) => x.event === "counter_census")!.t).reduce((a, e) => a + e.units, 0);
  expect(census[0]).toBe(supplyBefore * 780);
  // Bills: energy monthly to customers, water quarterly to owners; all paid.
  const bills = recs.filter((r) => r.kind === "invoice" && r.data?.service);
  expect(bills.some((b) => b.data.service === "water")).toBe(true);
  expect(bills.filter((b) => b.data.service === "energy").length).toBeGreaterThan(customers * 2);
  const paid = new Set(ev.filter((e) => e.event === "transfer" && e.settles).map((e) => e.settles));
  expect(bills.filter((b) => b.at < 110 * DAY).every((b) => paid.has(b.id))).toBe(true);
  expect(recs.some((r) => r.kind === "water_restrictions")).toBe(false);
}, 900_000);

test("with no water coming down the river, it runs dry and the corporation announces restrictions", async () => {
  const config = generate({ ...spec, years: 1 });
  const water = config.catalogue.fields.find((f: any) => f.id === "water");
  for (const k of Object.keys(water.from_covers)) water.from_covers[k] = 0;
  const { ev, recs } = await run("drought", config, 30);
  expect(recs.some((r) => r.kind === "water_restrictions" && r.data?.since !== undefined)).toBe(true);
  expect(ev.some((e) => e.event === "action_refused" && e.code === "field_exhausted")).toBe(true);
}, 900_000);
