// Floods and crime (docs/behaviour/floods.md, crime.md; docs/design/world-expansion.md 7), in a generated town.
// Floods: heavy rain swells the river over its banks; buildings beside it go under water, their people moved out to the
// relief centre, and back home once it's gone down. Crime (here far likelier than the profile's, to have some to
// follow): people in need take from their employer's stock; shops find it short at their stocktake and report it;
// the police investigate, find some takers, and charge them; the tribunal orders them to make it good, and they pay.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function run(name: string, config: any, days: number) {
  const out = join(root, "runs", `test-hazards-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: days * DAY });
  expect(s.participantErrors).toBe(0);
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("heavy rain floods the buildings beside the river; their people go to the relief centre, and home once it's down", async () => {
  // Four times the usual rain from day 20 to day 60.
  const config = generate({ ...spec, years: 1, weather: [{ from_day: 20, bps: 40_000 }, { from_day: 60, bps: 10_000 }] });
  const { ev } = await run("flood", config, 120);
  const flooded = ev.filter((e) => e.event === "flooded");
  expect(flooded.length).toBeGreaterThan(1);
  for (const f of flooded) expect(f.t).toBeGreaterThan(20 * DAY);
  // Beside the river (the town's last two rows), where it spills.
  const rowOf = (sid: string) => Number(config.world.structures.find((x: any) => x.id === sid)?.at.split(".")[2] ?? -1);
  for (const f of flooded) if (rowOf(f.structure) >= 0) expect(rowOf(f.structure)).toBeGreaterThanOrEqual(spec.grid.h - 2);
  // Its people out, and to the relief centre; back once it's receded.
  const out = ev.filter((e) => e.event === "vacated" && e.reason === "flooded");
  expect(out.length).toBeGreaterThan(0);
  expect(ev.some((e) => e.event === "occupied" && e.space === "town-hall/hall.1" && out.some((o) => o.occupant === e.occupant))).toBe(true);
  const receded = ev.filter((e) => e.event === "flood_receded");
  expect(receded.length).toBeGreaterThan(0);
  const home = (r: any) => out.find((o) => o.space.startsWith(`${r.structure}/dwelling`));
  const back = receded.filter((r) => home(r)).some((r) => ev.some((e) => e.event === "occupied" && e.occupant === home(r).occupant && e.space === home(r).space && e.t > r.t));
  if (receded.some((r) => home(r))) expect(back).toBe(true);
  // No rain: no floods.
  const dry = await run("dry", generate({ ...spec, years: 1 }), 60);
  expect(dry.ev.filter((e) => e.event === "flooded" && !String(e.structure).startsWith("str."))).toEqual([]);
}, 900_000);

test("taking from work, found at a stocktake, investigated, charged, ordered and paid", async () => {
  const config = generate({ ...spec, years: 1 });
  // (Far likelier than the profile's, and more in need: to have some to follow in a run.)
  const hot = (c: any) => c?.params?.crime && (c.params = { ...c.params, crime: { ...c.params.crime, take_bps: 10_000 }, essentials: 400_000 });
  for (const x of config.participants) hot(x.controller);
  for (const t of config.templates) hot(t.controller);
  const { ev, recs } = await run("crime", config, 200);
  const taken = ev.filter((e) => e.event === "taken");
  expect(taken.length).toBeGreaterThan(5);
  // Each from the taker's own employer, at work.
  for (const e of taken) expect(recs.concat(config.world.records).some((r: any) => r.record === "agreement" && r.terms?.template === "employment" && r.terms.parties[0] === e.from && r.terms.parties[1] === e.by)).toBe(true);
  // Shops report what their stocktake finds short; each report is investigated.
  const reports = recs.filter((r) => r.kind === "crime_report");
  expect(reports.length).toBeGreaterThan(0);
  const charges = recs.filter((r) => r.kind === "tribunal_application" && r.data.kind === "charge");
  const unsolved = recs.filter((r) => r.kind === "investigation_closed");
  expect(charges.length + unsolved.length).toBeGreaterThanOrEqual(reports.length - 2);
  // A charge names someone who did take from that shop; the tribunal orders them to pay; paid.
  for (const c of charges) expect(taken.some((e) => e.by === c.data.against && e.from === c.data.victim)).toBe(true);
  const orders = recs.filter((r) => r.kind === "tribunal_order" && r.data.kind === "charge");
  expect(orders.length).toBe(charges.filter((c) => recs.some((o) => o.kind === "tribunal_order" && o.basis === c.id)).length);
  const paid = new Set(ev.filter((e) => e.event === "transfer").map((e) => e.settles));
  if (orders.length) expect(orders.some((o) => paid.has(o.id))).toBe(true);
}, 900_000);
