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

// (In the town drawn from this seed the builder republishes its prices in the moment the landlord commissions the
// house, the offer is at the list just before, and the builder declines it in writing, naming its price. Until
// 2026-10-08 the landlord never read that reply and never built: docs/decisions.md, "A landlord whose offer is
// declined". It reads it with the week's post and offers again, which the first lines below hold it to wherever a
// town has such a moment; participants/test/landlord.test.ts holds the rule itself, whatever town is drawn.)
test("a refused permit, a landlord who builds anyway, and an inspector who notices", async () => {
  const { riverSite, riverCells, ev, recs } = await run(0, "defiant");
  // An offer that crossed a change of prices and was declined: offered again once, at the price named, a week on.
  const no = recs.find((r) => r.kind === "offer_declined" && (r.addressed_to ?? []).includes("landlord-1"));
  if (no) {
    const offers = recs.filter((r) => r.record === "agreement" && r.terms?.template === "construction" && r.terms.parties[0] === "landlord-1" && r.terms.commitments[0].does.outcome.structure?.on === riverSite);
    const first = offers.find((o) => o.id === no.data.agreement);
    expect(first).toBeDefined();
    const again = offers.filter((o) => o.at > no.at);
    expect(again).toHaveLength(1);
    expect(again[0].terms.commitments[1].does.outcome.money.amount).toBe(no.data.price);
    // (At its first plan a week or more after it offered: not in the moment the answer came, and no later than the
    // week after that, since it plans at least weekly.)
    expect(again[0].at - first.at).toBeGreaterThanOrEqual(7 * DAY);
    expect(again[0].at - first.at).toBeLessThanOrEqual(14 * DAY + 3600);
  }
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
