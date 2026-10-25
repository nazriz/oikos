// Water and energy (docs/behaviour/utilities.md; docs/design/world-expansion.md 6.1), in a generated town: the water
// corporation draws what the town uses from the river each day and bills owners quarterly; the energy retailer buys from
// the grid, supplies its customers (each kWh emitting the grid's greenhouse gas into the world's counter, censused
// monthly) and bills them; households pay. With no water coming down the river, it runs dry: restrictions.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
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

test("water is drawn from the river and energy bought from the grid, as the town's connections take them; bills from meters are paid; emissions counted", async () => {
  const config = generate({ ...spec, years: 1 });
  const { ev, recs } = await run("town", config, 120);
  const units = (task: string) => ev.filter((e) => e.event === "worked" && e.task === task).reduce((a, e) => a + e.units, 0);
  // Water (foundations-2 C4): what keeps the works' store full, which is what the homes' connections took, about the
  // town's people at 160 litres a day each (the households' own use).
  const people = config.world.entities.filter((e: any) => e.kind === "person").length;
  expect(units("draw_water")).toBeGreaterThan((people * 160 * 90) / 1000);
  expect(units("draw_water")).toBeLessThan((people * 160 * 125) / 1000);
  // What the sewer brought back was treated.
  expect(units("treat_wastewater")).toBeGreaterThan((people * 160 * 80) / 1000);
  // Energy: each home on the feeders from the start, at 11 kWh a day; each kWh used emits the grid's 780 g.
  const customers = config.world.connections.filter((c: any) => c.kind === "energy").length;
  expect(customers).toBeGreaterThan(50);
  const census = ev.filter((e) => e.event === "counter_census").map((e) => e.counters.greenhouse_gas);
  expect(census.length).toBe(4);
  expect([...census].sort((a, b) => a - b)).toEqual(census);
  expect(census.at(-1)).toBeGreaterThan(customers * 11 * 100 * 780);
  // Bought from the grid a month's worth at a time, not again until it's come (pilot 7d's retailer ordered 1,400 times in
  // a day, each paid up front, the energy not yet delivered).
  const gridOrders = recs.filter((r) => r.kind === "order" && r.speaks_for === "energy-co");
  expect(gridOrders.length).toBeGreaterThan(0);
  expect(gridOrders.length).toBeLessThanOrEqual(Math.ceil(120 / 14));
  // Bills from meters: energy monthly to each connection's user, water quarterly to owners; all paid.
  const bills = recs.filter((r) => r.kind === "invoice" && r.data?.service);
  expect(bills.some((b) => b.data.service === "water" && b.data.kl > 0)).toBe(true);
  expect(bills.filter((b) => b.data.service === "energy" && b.data.units > 0).length).toBeGreaterThan(customers * 2);
  const paid = new Set(ev.filter((e) => e.event === "transfer" && e.settles).map((e) => e.settles));
  const due = bills.filter((b) => b.at < 110 * DAY);
  expect(due.filter((b) => paid.has(b.id)).length).toBeGreaterThan(due.length * 0.9);
  expect(recs.some((r) => r.kind === "water_restrictions")).toBe(false);
  // Nothing tripped: the network is sized for the town.
  expect(ev.filter((e) => e.event === "link_changed" && e.op === "tripped").length).toBe(0);
}, 2_400_000);

test("with no water coming down the river, it runs dry and the corporation announces restrictions", async () => {
  const config = generate({ ...spec, years: 1 });
  const water = config.catalogue.fields.find((f: any) => f.id === "water");
  for (const k of Object.keys(water.from_covers)) water.from_covers[k] = 0;
  const { ev, recs } = await run("drought", config, 30);
  expect(recs.some((r) => r.kind === "water_restrictions" && r.data?.since !== undefined)).toBe(true);
  expect(ev.some((e) => e.event === "action_refused" && e.code === "field_exhausted")).toBe(true);
}, 2_400_000);
