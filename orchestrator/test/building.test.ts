// Building and trade with the outside (phase B, stage B4): the builder buys its materials from the world market,
// its crew's hours build and demolish, and a building is finished only when its hours are done; the world market
// sells against paid orders and buys exports against invoices, once the goods have come, up to the month's demand.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { workStarts } from "./lib/work-starts";
import { modules } from "./fixtures/trade-modules";
import { officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
// Tight housing and rich landlords, so they build.
// (Every home let: these are landlords' buildings. Owner-occupiers would take some of their houses.)
const tight = { ...base, ownership: false, citizens: 120, apartment_blocks: 2, houses: 16, landlord_capital: 300_000_000, landlord_compliance_bps: 10_000 };

/** Refusals from same-moment races (D58): someone who'd just left, named for work by a firm acting on what it saw. */
const RACES = ["not_present", "not_at_work", "capacity_exceeded", "no_time_left", "insufficient_quantity", "dead", "too_far", "not_in_position"]; // (not_in_position, 2026-10-17: a person who leaves town no longer keeps their posts, so an act on its way when they go is refused as one by the dead is; too_far: a birth takes hours and the other parent went to work meanwhile, as in households and migration; F6, 2026-10-16. insufficient_quantity and dead: work takes the crew's hours, so it takes effect hours after it was ordered, and meanwhile the goods go to an earlier order or a performer dies; F1, 2026-10-15) and moving into a home still being left; a new job's first day after a full one at the old

async function run(name: string, config: any, until: number) {
  const out = join(root, "runs", `test-building-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until, modules });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // Every call the modules wrote was one they could make.
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  // Why an act was sent: the reasoning on the command that began it.
  const reasoning = new Map<number, string>(log.filter((e) => e.kind === "command" && e.body.command === "act").map((e) => [e.seq, e.body.reasoning ?? ""]));
  const began = new Map<string, number>(ev.filter((e) => e.event === "action_started").map((e) => [e.action, e.cause]));
  return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record), why: (action: string) => reasoning.get(began.get(action) ?? -1) ?? "" };
}

test("the builder buys materials from outside, and its crew's hours finish each building", async () => {
  const config = generate(tight);
  const types = new Map<string, any>(config.catalogue.structure_types.map((t: any) => [t.id, t]));
  const price = 125; // the world price of materials, cents a kg
  const { ev, recs } = await run("builds", config, 300 * DAY);
  // (And one more race, seen once the run's course changed on 2026-10-08: a child on its way home from school, brought
  // there by a parent moving the household into a new home while it walked. Its own arrival finds it already there.)
  const broughtMeanwhile = (e: any) => { const m = e.code === "already_present" ? /^(\S+) is already in (\S+)$/.exec(e.detail ?? "") : null; return !!m && ev.some((x) => x.event === "occupied" && x.occupant === m[1] && x.space === m[2] && x.t <= e.t && x.t >= e.t - 3600); };
  expect(ev.filter((e) => e.event === "action_refused" && !RACES.includes(e.code) && !broughtMeanwhile(e))).toEqual([]);
  // Materials come from outside, to the yard, paid for at the world price with the order.
  const bought = ev.filter((e) => e.event === "goods_moved" && e.from === "outside" && e.to === "builder");
  expect(bought.length).toBeGreaterThan(0);
  for (const g of bought) expect(g).toMatchObject({ kind: "materials", to_at: "builder-yard" });
  // Each order at the price the world market lists when it's made (world prices move), paid with the order.
  const lists = recs.filter((r) => r.kind === "price_list" && r.speaks_for === "outside");
  for (const o of recs.filter((r) => r.kind === "order" && r.speaks_for === "builder")) {
    expect(lists.filter((l) => l.at <= o.at).slice(-2).map((l) => l.data.goods.materials)).toContain(o.data.unit_price); // or the one just before (D58)
    expect(ev.some((e) => e.event === "transfer" && e.from === "acc-builder" && e.to === "acc-outside" && e.amount === String(o.data.quantity * o.data.unit_price) && e.t >= o.at)).toBe(true);
  }
  void price;
  // (A note that delivers nothing and refunds the order moves no goods: the world market had none to send that day, as in the town 2026-10-12, "Returns on the law's days", where the first order was refunded and bought again.)
  expect(recs.filter((r) => r.kind === "delivery_note" && r.speaks_for === "outside" && r.addressed_to.includes("builder") && r.data.delivered > 0).length).toBe(bought.length);
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
  // (A working day is counted on each day the work is done on: it takes the crew's hours, so it takes effect hours later (F1), and work that begins
  // before midnight and runs past it counts on both days, as the kernel counts it (the review of foundations, finding 9; before it, on the day it began).)
  const startOf = workStarts(ev);
  for (const w of ev.filter((e) => e.event === "worked")) for (const p of w.performers) {
    if (/^par\./.test(p)) continue; // (a system has no working day: only a person's hours are counted)
    let at = startOf.get(w)!, left = Math.ceil(w.labour / w.performers.length);
    while (left > 0) {
      const day = Math.floor(at / DAY), take = Math.min(left, (day + 1) * DAY - at);
      const k = `${p}|${day}`;
      perDay.set(k, (perDay.get(k) ?? 0) + take);
      at += take;
      left -= take;
    }
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
  const { ev, recs, why } = await run("demolition", config, 60 * DAY);
  // Its household, put out when it began to come down, try going home: they couldn't see it from where they were. Who
  // lives there is the town's draw (people out at work, or a retired couple at home), so what is held is the rule, not
  // a count: only that household is turned away, and nobody tries the same way twice. There are two ways home: one's
  // own daily round ("a place pulled down, or coming down: not again"), and, for the others of a household, the
  // leaseholder's word that the home is theirs, which the round then tries once more (docs/behaviour/households.md).
  // (Until 2026-10-08 this was "once each", true of the one town it was written against, whose tenants were all at
  // work and none of whom was told to come by a leaseholder.)
  const gone = ev.filter((e) => e.event === "action_refused" && ["coming_down", "unknown_structure"].includes(e.code));
  const livedThere = new Set<string>(config.world.occupancy.filter((o: any) => o.space.startsWith(`${house.id}/`)).map((o: any) => `${o.occupant}-self`));
  for (const e of gone) expect(livedThere.has(e.participant)).toBe(true);
  // (A way home is known by why the act was sent: the same words are the same way.)
  const tries = gone.map((e) => `${e.participant}: ${why(e.action)}`);
  expect(tries.every((x) => !x.endsWith(": "))).toBe(true);
  expect(new Set(tries).size).toBe(tries.length);
  expect(ev.filter((e) => e.event === "action_refused" && !RACES.includes(e.code) && !["coming_down", "unknown_structure"].includes(e.code))).toEqual([]);
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
  const trader = officeAt(config, "outside-trade");
  trader.params.buys = { goods: { unit_price: 1000, per_month: 300 } };
  officeAt(config, "factory-1-manager").run("test.exporter", { account: "acc-factory-1", from_at: "factory-1-works", price: 1000,
    script: [{ day: 2, ship: 100, invoice: 100 }, { day: 3, ship: 100, invoice: 100 }, { day: 4, ship: 200, invoice: 200 }, { day: 5, ship: 0, invoice: 50 }] });
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

test("a construction contract is known by its terms, not its name; one offered below the builder's price is declined in writing", async () => {
  // Pilot 9: the mayor's contract, drafted from plain words, had no template, and the builder ignored it all year.
  const config = generate({ ...base, citizens: 60 });
  const deal = (id: string, cents: string, on: string) => [
    { id, record: "agreement", author: "genesis", at: 0, visible_to: ["city", "builder"], terms: { parties: ["city", "builder"], commitments: [
      { who: "city", does: { outcome: { money: { amount: cents, from: "acc-city", to: "builder" } } } },
      { who: "builder", does: { outcome: { structure: { on, type: "park" } } } }] } },
    { id: `${id}-sig-city`, record: "signature", author: "genesis", at: 0, visible_to: ["city", "builder"], speaks_for: "city", agreement: id, as: "city" }];
  // Two of the town's lots with nothing on them (the generator's layout decides which).
  const built = new Set(config.world.structures.map((x: any) => x.at));
  const [fair, cheap] = config.world.records.filter((r: any) => r.record === "claim" && r.about?.kind === "ownership" && r.holder === "city" && !built.has(`cell.${Number(r.about.object.slice(4, 6))}.${Number(r.about.object.slice(7, 9))}`) && /^lot-\d\d-\d\d$/.test(r.about.object)).map((r: any) => r.about.object).sort();
  config.world.records.push(...deal("town-park-fair", "90000000", fair), ...deal("town-park-cheap", "100", cheap));
  const { recs } = await run("by-terms", config, 30 * DAY);
  expect(recs.some((r) => r.record === "signature" && r.agreement === "town-park-fair" && r.as === "builder")).toBe(true);
  expect(recs.some((r) => r.record === "signature" && r.agreement === "town-park-cheap" && r.as === "builder")).toBe(false);
  const no = recs.find((r) => r.kind === "offer_declined" && r.data?.agreement === "town-park-cheap");
  expect(no?.addressed_to).toEqual(["city"]);
  expect(no.text).toMatch(/our price is \$[\d,]+\.\d\d/);
  // Never two building jobs taken on for one lot: one for a lot already built on is declined, saying so (the town's own
  // mayor commissions a park here too, not knowing of this one).
  const signed = new Set(recs.filter((r) => r.record === "signature" && r.as === "builder").map((r) => r.agreement));
  const lots = recs.filter((r) => r.record === "agreement" && signed.has(r.id)).flatMap((r) => r.terms.commitments.filter((c: any) => c.who === "builder" && c.does?.outcome?.structure?.type).map((c: any) => c.does.outcome.structure.on));
  expect(new Set(lots).size).toBe(lots.length);
}, 300_000);
