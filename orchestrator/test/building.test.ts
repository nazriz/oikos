// Building and trade with the outside (phase B, stage B4): the builder buys its materials from the world market,
// its crew's hours build and demolish, and a building is finished only when its hours are done; the world market
// sells against paid orders and buys exports against invoices, once the goods have come, up to the month's demand.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";
import { modules } from "./fixtures/trade-modules";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
// Tight housing and rich landlords, so they build.
const tight = { ...base, citizens: 120, apartment_blocks: 2, houses: 16, landlord_capital: 300_000_000, landlord_compliance_bps: 10_000 };

/** Refusals from same-moment races (D58): someone who'd just left, named for work by a firm acting on what it saw. */
const RACES = ["not_present", "not_at_work"];

async function run(name: string, config: any, until: number) {
  const out = join(root, "runs", `test-building-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until, modules });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // Every call the modules wrote was one they could make.
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("the builder buys materials from outside, and its crew's hours finish each building", async () => {
  const config = generate(tight);
  const types = new Map<string, any>(config.catalogue.structure_types.map((t: any) => [t.id, t]));
  const price = 125; // the world price of materials, cents a kg
  const { ev, recs } = await run("builds", config, 300 * DAY);
  expect(ev.filter((e) => e.event === "action_refused" && !RACES.includes(e.code))).toEqual([]);
  // Materials come from outside, to the yard, paid for at the world price with the order.
  const bought = ev.filter((e) => e.event === "goods_moved" && e.from === "outside" && e.to === "builder");
  expect(bought.length).toBeGreaterThan(0);
  for (const g of bought) {
    expect(g).toMatchObject({ kind: "materials", to_at: "builder-yard" });
    expect(ev.some((e) => e.event === "transfer" && e.from === "acc-builder" && e.to === "acc-outside" && e.amount === String(Number(g.quantity) * price) && e.t <= g.t)).toBe(true);
  }
  expect(recs.filter((r) => r.kind === "delivery_note" && r.speaks_for === "outside" && r.addressed_to.includes("builder")).length).toBe(bought.length);
  // Every building finished took exactly its hours of the crew's work (and no more), from the yard.
  const started = new Map(ev.filter((e) => e.event === "structure_started").map((e) => [e.structure, e]));
  const done = ev.filter((e) => e.event === "structure_completed" && started.has(e.structure));
  expect(done.length).toBeGreaterThan(0);
  for (const d of done) {
    const s = started.get(d.structure)!;
    const work = ev.filter((e) => e.event === "worked" && e.task === "build" && e.on === d.structure);
    expect(work.every((w) => w.at === "builder-yard")).toBe(true);
    expect(work.reduce((a, w) => a + w.units, 0)).toBe(types.get(s.structure_type).build_labour);
    expect(d.t - s.t).toBeGreaterThanOrEqual(types.get(s.structure_type).build_time);
  }
  // No one works more than a working day in a day.
  const perDay = new Map<string, number>();
  for (const w of ev.filter((e) => e.event === "worked")) for (const p of w.performers) {
    const k = `${p}|${Math.floor(w.t / DAY)}`;
    perDay.set(k, (perDay.get(k) ?? 0) + Math.ceil(w.labour / w.performers.length));
  }
  expect(Math.max(...perDay.values())).toBeLessThanOrEqual(config.catalogue.working_day);
  // Each job is invoiced, and the client pays.
  for (const inv of recs.filter((r) => r.kind === "invoice" && r.speaks_for === "builder")) {
    expect(ev.some((e) => e.event === "transfer" && e.to === "acc-builder" && e.amount === inv.data.outcome.money.amount && e.t >= inv.at)).toBe(true);
  }
}, 300_000);

test("a demolition order is carried out by the builder's crew, commissioned by the owner", async () => {
  const config = generate({ ...tight, landlord_capital: 60_000_000 });
  // An order from the inspector at the start, for one of landlord-1's houses.
  const lotOf = (at: string) => config.world.records.find((r: any) => r.kind === "lot" && r.data.cells.includes(at))?.id;
  const house = config.world.structures.find((s: any) => s.type.includes("house") && config.world.records.some((r: any) => r.id === `title-${lotOf(s.at)}` && r.holder === "landlord-1"));
  config.world.records.push({ id: "order-1", record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "city", kind: "demolition_order", addressed_to: ["landlord-1"],
    text: `Order: demolish ${house.id}.`, data: { structure: house.id, lot: lotOf(house.at) } });
  const { ev, recs } = await run("demolition", config, 60 * DAY);
  expect(ev.filter((e) => e.event === "action_refused" && !RACES.includes(e.code))).toEqual([]);
  // The landlord commissions the builder at its published demolition price; the builder starts, and invoices.
  const contract = recs.find((r) => r.record === "agreement" && r.terms.template === "construction" && r.basis === "order-1");
  expect(contract.terms.commitments[0].does.outcome.structure).toEqual({ remove: house.id });
  const started = ev.find((e) => e.event === "demolition_started" && e.structure === house.id);
  expect(started).toBeDefined();
  // Its occupants leave at once; the crew's hours bring it down.
  const down = ev.find((e) => e.event === "structure_demolished" && e.structure === house.id);
  expect(down).toBeDefined();
  const work = ev.filter((e) => e.event === "worked" && e.task === "demolish" && e.on === house.id);
  expect(work.reduce((a, w) => a + w.units, 0)).toBe(config.catalogue.structure_types.find((t: any) => t.id === house.type).demolition_labour);
  expect(recs.some((r) => r.kind === "invoice" && r.speaks_for === "builder" && r.basis === contract.id)).toBe(true);
}, 300_000);

test("the world market buys exports it has received, up to the month's demand, and sends back the rest", async () => {
  const config = generate({ ...base, citizens: 60 });
  const trader = config.participants.find((p: any) => p.id === "outside-trade-system");
  trader.controller.params.buys = { goods: { unit_price: 1000, per_month: 300 } };
  const manager = config.participants.find((p: any) => p.id === "factory-1-manager-system");
  manager.controller = { type: "code", impl: "test.exporter", params: { account: "acc-factory-1", from_at: "factory-1-works", price: 1000,
    script: [{ day: 2, ship: 100, invoice: 100 }, { day: 3, ship: 100, invoice: 100 }, { day: 4, ship: 200, invoice: 200 }, { day: 5, ship: 0, invoice: 50 }] } };
  config.world.holdings = config.world.holdings.filter((h: any) => !(h.holder === "factory-1" && h.kind === "goods"));
  config.world.holdings.push({ kind: "goods", holder: "factory-1", at: "factory-1-works", quantity: "1000" });
  const { ev, recs } = await run("exports", config, 25 * DAY);
  expect(ev.filter((e) => e.event === "action_refused" && !RACES.includes(e.code))).toEqual([]);
  const offer = recs.find((r) => r.kind === "buying_offer");
  expect(offer.data).toMatchObject({ kind: "goods", unit_price: 1000, quantity: 300 });
  // Paid: 100, 100, then 100 of the 200 (the month's 300); the other 100 sent back; the invoice with no goods declined.
  const paid = ev.filter((e) => e.event === "transfer" && e.from === "acc-outside" && e.to === "acc-factory-1").map((e) => Number(e.amount));
  expect(paid).toEqual([100_000, 100_000, 100_000]);
  const back = ev.filter((e) => e.event === "goods_moved" && e.from === "outside" && e.to === "factory-1");
  expect(back.map((g) => [g.quantity, g.to_at])).toEqual([["100", "factory-1-works"]]);
  const declined = recs.filter((r) => r.kind === "invoice_declined");
  expect(declined.map((r) => r.data.returned ?? "no goods")).toEqual([100, "no goods"]);
}, 300_000);
