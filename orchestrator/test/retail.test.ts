// Shops and households (phase B, stage B4; firm.retailer, citizen.default's shopping): households order goods from a
// shop and pay with the order; the shop's staff serve them (each item takes their hours), deliver home or keep them at
// the shop, and refund what they couldn't; shops restock from the cheapest supplier; households use their goods up.
// The money-only stand-ins (shopping as a payment to a shop, owners spending at a shop) are gone from the town.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { skillClock } from "./skill";
import { officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function run(name: string, config: any, until: number) {
  const out = join(root, "runs", `test-retail-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  // Nothing refused but same-moment races (D58): someone who'd just left, named for work; and, where workers differ in
  // skill, a crew's first day short of time (a shop learns how long a crew takes from being told: Pace). Once per crew,
  // or near it: not the same plan again and again.
  expect(ev.filter((e) => e.event === "action_refused" && !["not_present", "not_at_work", "capacity_exceeded", "no_time_left", "insufficient_quantity", "dead"].includes(e.code))).toEqual([]);
  const short = ev.filter((e) => e.event === "action_refused" && e.code === "no_time_left");
  const acts = ev.filter((e) => e.event === "action_applied").length;
  expect(short.length * 50).toBeLessThan(acts);
  return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("households buy from shops and use their goods up; shops serve with their staff's hours and restock from the cheapest", async () => {
  const config = generate(base);
  const serve = config.catalogue.tasks.find((t: any) => t.id === "serve");
  const { ev, recs } = await run("town", config, 90 * DAY);
  const employees = new Map<string, Set<string>>();
  for (const a of [...config.world.records, ...recs].filter((r: any) => r.record === "agreement" && r.terms.template === "employment")) {
    const [firm, worker] = a.terms.parties;
    employees.set(firm, (employees.get(firm) ?? new Set()).add(worker));
  }
  // Serving: at the shop, by its own staff, an item's hours each.
  const served = ev.filter((e) => e.event === "worked" && e.task === "serve");
  expect(served.length).toBeGreaterThan(100);
  const labourOf = skillClock(config, ev);
  for (const w of served) {
    expect(w.performers.every((p: string) => employees.get(w.at.replace("-premises", ""))?.has(p))).toBe(true);
    const want = labourOf(w, serve);
    if (want !== undefined) expect(w.labour).toBe(want);
  }
  // Every household order is answered: what came, and a refund of the rest at the price paid.
  const orders = new Map(recs.filter((r) => r.kind === "order" && /^c\d+$/.test(r.speaks_for)).map((r) => [r.id, r]));
  expect(orders.size).toBeGreaterThan(100);
  const notes = recs.filter((r) => r.kind === "delivery_note" && orders.has(r.data.order));
  expect(notes.length).toBeGreaterThan(orders.size * 0.8); // the last few days' may still be waiting (0.9 until F1, 2026-10-15: a shop serves in its crew's hours now, so more of the last days' are still in the queue)
  for (const n of notes) {
    const o = orders.get(n.data.order)!;
    expect(n.data.ordered).toBe(o.data.quantity);
    // (An order its buyer's bank never paid is declined: nothing to refund.)
    expect(n.data.refund).toBe(n.data.declined === "unpaid" ? 0 : (o.data.quantity - n.data.delivered) * o.data.unit_price);
  }
  // Goods go where the order says: home, or kept at the shop.
  const shopPlaces = new Set(config.world.structures.filter((s: any) => s.type === "shop").map((s: any) => s.id));
  const homes = new Set(config.world.structures.filter((s: any) => s.type.includes("house") || s.type === "apartments").map((s: any) => s.id));
  const toHouseholds = ev.filter((e) => e.event === "goods_moved" && /^c\d+$/.test(e.to) && e.from.startsWith("shop-"));
  expect(toHouseholds.length).toBeGreaterThan(100);
  for (const g of toHouseholds) expect(homes.has(g.to_at) || shopPlaces.has(g.to_at)).toBe(true);
  // Households use up what they had, a week's worth at a time: never more than came.
  const got = toHouseholds.reduce((x, g) => x + Number(g.quantity), 0);
  const used = ev.filter((e) => e.event === "worked" && e.task === "consume").reduce((x, w) => x + w.units, 0);
  expect(used).toBeGreaterThan(got / 3);
  expect(used).toBeLessThanOrEqual(got);
  // Shops buy mostly from the local factories: cheaper than imports.
  const restock = recs.filter((r) => r.kind === "order" && r.speaks_for.startsWith("shop-"));
  const local = restock.filter((r) => r.addressed_to[0].startsWith("factory-")).reduce((x, r) => x + r.data.quantity, 0);
  const imported = restock.filter((r) => r.addressed_to[0] === "outside").reduce((x, r) => x + r.data.quantity, 0);
  expect(local).toBeGreaterThan(imported);
  // No money-only stand-ins: nobody pays a shop "for shopping", and landlords' owners take their draw as dividends.
  expect(recs.filter((r) => r.kind === "request" && ["Shopping.", "Owners' spending."].includes(r.data?.outcome?.money?.for)).length).toBe(0);
  expect(recs.filter((r) => r.kind === "request" && r.speaks_for?.startsWith("landlord-") && r.data?.payments?.[0]?.for === "Dividend.").length).toBeGreaterThan(0);
}, 300_000);

test("a shop with no staff serves nobody: what it can't serve within three days is refunded", async () => {
  const config = generate(base);
  // Shop 1 starts with nobody: its staff's jobs and places are gone.
  const staff = new Set(config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === "shop-1").map((r: any) => r.terms.parties[1]));
  config.world.records = config.world.records.filter((r: any) => !(r.id.startsWith("job-") && staff.has(r.id.replace(/^job-/, "").replace(/-(sig-.*|wages)$/, ""))));
  config.world.occupancy = config.world.occupancy.filter((o: any) => !(staff.has(o.occupant) && o.space.startsWith("shop-1-")));
  // ... and doesn't hire before the month's end (people in work look for better jobs, so it could otherwise).
  officeAt(config, "shop-1-manager").params.min_staff = 0;
  const { ev, recs } = await run("unstaffed", config, 20 * DAY);
  expect(ev.some((e) => e.event === "worked" && e.task === "serve" && e.at === "shop-1-premises")).toBe(false);
  const notes = recs.filter((r) => r.kind === "delivery_note" && r.speaks_for === "shop-1");
  expect(notes.length).toBeGreaterThan(0);
  for (const n of notes) {
    expect(n.data.delivered).toBe(0);
    expect(n.data.refund).toBeGreaterThan(0);
  }
}, 300_000);

test("shops at one wholesale price don't all order from the same factory: each has its own order among them", async () => {
  // (By name, every shop of a town ordered from its first factory, which could fill a few of the orders and refunded
  // the rest a week on, while the other factories' goods stood unsold and households went without: found 2026-10-08.)
  const config = generate({ ...base, citizens: 300, shops: 9, factories: 3, apartment_blocks: 5, houses: 54, landlords: 6, grid: { w: 24, h: 15 } });
  const { recs } = await run("suppliers", config, 45 * DAY); // (45 days where it was 21: the shops' first orders, at the first hour, go to the world market, before the factories' price lists are out (a person takes a quarter of an hour to post one: foundations F5), and they restock from the factories later)
  const toFactories = recs.filter((r) => r.kind === "order" && /^shop-/.test(r.speaks_for) && (r.addressed_to ?? []).some((x: string) => /^factory-/.test(x)));
  // (After the first day, when not every factory's price list is out yet: each shop's first order once all are.)
  const first = new Map<string, string>();
  for (const o of toFactories) if (o.at >= DAY && !first.has(o.speaks_for)) first.set(o.speaks_for, o.addressed_to.find((x: string) => /^factory-/.test(x)));
  expect(first.size).toBeGreaterThan(3);
  expect(new Set(first.values()).size).toBeGreaterThan(1);
  // And more than one factory's goods reached the shops in those weeks.
  const ids = new Set(toFactories.map((o) => o.id));
  const came = recs.filter((r) => r.kind === "delivery_note" && ids.has(r.data?.order) && r.data.delivered > 0);
  expect(new Set(came.map((n) => n.speaks_for)).size).toBeGreaterThan(1);
}, 600_000);
