// The river scenario (VISION §12, design §6) on a generated town: a landlord
// with a river site applies for a permit; the planning office refuses it
// under law-river; what happens next depends on the landlord's compliance,
// and on whether the inspector notices. None of it is kernel mechanics.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
// Tight housing and rich landlords, so everyone wants to build.
const tight = { ...base, citizens: 120, apartment_blocks: 2, houses: 16, landlord_capital: 300_000_000 }; // about 48 households for 40 homes

async function run(compliance: number, name: string) {
  const out = join(root, "runs", `test-river-${name}`);
  rmSync(out, { recursive: true, force: true });
  // (Every home let: this is about landlords building.)
  const config = generate({ ...tight, ownership: false, landlord_compliance_bps: compliance });
  // A lot of landlord-1's with nothing on it (lots are registry records over cells).
  const cellsOf = (lot: string): string[] => config.world.records.find((r: any) => r.id === lot)?.data?.cells ?? [];
  const riverSite = config.world.records.find((r: any) => r.record === "claim" && r.holder === "landlord-1" && !config.world.structures.some((s: any) => cellsOf(r.about.object).includes(s.at))).about.object;
  const s = await runWorld({ config, runId: name, outDir: out, until: 240 * DAY });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  return { riverSite, riverCells: cellsOf(riverSite), ev, recs };
}

// EXPECTED TO FAIL, for a fault found on 2026-10-08 and left for a decision (docs/decisions.md, "The ages fixes
// landed"): a landlord whose offer the builder declines never offers again, nor builds anything else. Here the
// builder republishes its prices in the moment the landlord commissions the house (its costs changed that morning), the
// offer is at the list just before, the builder declines it in writing ("our price is ..."), and the landlord, which
// never reads that reply, stays "contracted" for good: no house on the river site, so nothing for the inspector to
// find. Before the ages fixes the town drawn from this seed had no such moment, and the test passed by that accident.
// Nothing below is changed: it is what should happen, and `test.failing` turns red the day it does (then make it
// `test` again).
test.failing("a refused permit, a landlord who builds anyway, and an inspector who notices", async () => {
  const { riverSite, riverCells, ev, recs } = await run(0, "defiant");
  const app = recs.find((r) => r.kind === "permit_application" && r.data.lot === riverSite);
  expect(app).toBeDefined();
  const decision = recs.find((r) => r.kind === "permit_decision" && r.data.application === app.id);
  expect(decision.data).toMatchObject({ decision: "refused", law: "law-river" });
  // Physics doesn't care about the refusal: the house goes up.
  const built = ev.find((e) => e.event === "structure_started" && riverCells.includes(e.on));
  expect(built).toBeDefined();
  // The inspector's patrol (every 14 days) sees it and acts under law-planning.
  const fine = recs.find((r) => r.record === "claim" && r.about?.kind === "fine" && r.counterparty === "landlord-1");
  const order = recs.find((r) => r.kind === "demolition_order" && r.data.lot === riverSite);
  expect(fine?.basis).toBe("law-planning");
  expect(order).toBeDefined();
  expect(order.at - built.t).toBeLessThanOrEqual(21 * DAY);
  // A defiant landlord ignores the order: the house still stands at the end.
  expect(ev.some((e) => e.event === "structure_demolished" && e.structure === built.structure)).toBe(false);
}, 300_000);

test("a compliant landlord abandons the river site after the refusal", async () => {
  const { riverCells, ev, recs } = await run(10_000, "compliant");
  expect(recs.some((r) => r.kind === "permit_decision" && r.data.decision === "refused")).toBe(true);
  expect(ev.some((e) => e.event === "structure_started" && riverCells.includes(e.on))).toBe(false);
  // Elsewhere, permits are granted and building happens lawfully, unfined.
  expect(ev.some((e) => e.event === "structure_started")).toBe(true);
  expect(recs.some((r) => r.record === "claim" && r.about?.kind === "fine")).toBe(false);
}, 300_000);
