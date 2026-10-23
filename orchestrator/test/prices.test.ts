// Prices that bite, and shocks (phase C, stage C1): landlords review rents to what they'd ask now, within the world's
// tenancy law, and tenants pay it or leave; world prices move, and scripted shocks change a price or the demand for
// the town's goods.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate, rentIncreaseLaw } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { officesBy } from "./lib/offices";
import { publishRentsBoard } from "./lib/rents-board";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const MONTH = 30 * DAY;
const base = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any), shop_mix: false /* the single-goods town: this test holds a mechanism of it (docs/risks.md ME-19) */ };

async function run(name: string, config: any, until: number) {
  const out = join(root, "runs", `test-prices-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const cmds = log.filter((e) => e.kind === "command").map((e) => ({ t: e.t, ...e.body }));
  return { ev, cmds, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("rents are reviewed as landlords practise, within the law as a record says it, never down, and tenants pay or leave", async () => {
  const config = generate(base);
  // Landlords review every 6 months; the law (a record, as a lawmaker would write it) allows an increase only 9 months
  // after the last change, with 75 days' notice. They read the law as any participant does: its formal condition.
  for (const p of officesBy(config, "firm.landlord")) Object.assign(p.params, { rent_review_months: 6, rent_increase_notice_days: 60 });
  const i = config.world.records.findIndex((r: any) => r.id === "law-rent-increases");
  config.world.records[i] = rentIncreaseLaw(9, 75);
  publishRentsBoard(config, 1_000); // (the market has moved: the Rust landlord raises a rent only to what homes like it let for)
  const law = { months: 9, notice: 75 };
  const { ev, recs, cmds } = await run("rents", config, 15 * MONTH);
  // (A month in which the bank wrote that the rent could not be paid for want of money is not a month the tenant let
  // slip: it is one they could not pay, told so, and made up when money came. In the town as drawn since 2026-10-09
  // one tenant, whose account is filled each month with exactly the rent, is an energy bill short for three months.)
  const failed = cmds.filter((c) => c.command === "act" && c.participant === "bank-payments-system").map((c) => ({ t: c.t, text: JSON.stringify(c.blocks) })).filter((c) => c.text.includes("failed: insufficient funds"));
  const short = (order: string, from: number, to: number) => failed.some((c) => c.t >= from && c.t < to && c.text.includes(`(request ${order}) failed: insufficient funds`));
  const increases = recs.filter((r) => r.kind === "rent_increase");
  expect(increases.length).toBeGreaterThan(5);
  const byLease = new Map<string, any[]>();
  for (const r of increases) byLease.set(r.data.lease, [...(byLease.get(r.data.lease) ?? []), r]);
  // Reviews as practised (6 months apart), and every increase within the law: 9 months after the last change.
  // (To the minute: a notice is on the record a second or so after the landlord decides, by how much else it did in
  // that wake, and it reviews by when it decided. With a notice to vacate given in the same wake as an earlier
  // review, two notices of one lease came 6 months less a second apart, 2026-10-11.)
  for (const [, rs] of byLease) for (let i = 1; i < rs.length; i++) expect(rs[i].at - rs[i - 1].at).toBeGreaterThanOrEqual(6 * MONTH - 60);
  for (const r of increases) expect(r.data.from - r.data.last_from).toBeGreaterThanOrEqual(law.months * MONTH);
  // (The law held some back: an increase noticed at 6 months starts at 9, not after 60 days.)
  expect(increases.some((r) => r.data.from - r.at > 60 * DAY)).toBe(true);
  for (const r of increases) {
    expect(r.data.from - r.at).toBeGreaterThanOrEqual(law.notice * DAY);
    expect(Number(r.data.rent)).toBeGreaterThan(Number(r.data.was));
    // The tenant answers (given a week to): a standing order for the new rent, or notice on the lease.
    if (r.at > 15 * MONTH - 7 * DAY) continue;
    const tenant = r.addressed_to[0];
    // (A tenant who has died answers nothing. A landlord is told of a tenant's death only when it reported it or the
    // family member reporting held the lease (docs/behaviour/deaths.md, "Who is told"); here, in the town as drawn
    // since 2026-10-09, a leaseholder's partner reported it, and the landlord reviewed the dead tenant's rent a
    // fortnight on.)
    if (ev.some((e) => e.event === "person_died" && e.person === tenant && e.t <= r.at + 7 * DAY)) continue;
    const order = recs.find((x) => x.kind === "request" && x.speaks_for === tenant && x.basis === r.data.lease && x.data?.outcome?.money?.amount === String(r.data.rent) && x.at >= r.at);
    const pays = !!order;
    const leaves = recs.some((x) => x.record === "notice" && x.agreement === r.data.lease && x.as === tenant && x.at >= r.at);
    expect(pays || leaves).toBe(true);
    // And pays it from when it starts, having paid the old rent until then, no month missed (if the tenancy's still
    // going: no notice on it, the new rent's order not stopped, as at a tenancy's end, and the tenant alive).
    const before = r.data.from + 35 * DAY;
    const ended = recs.some((x) => x.record === "notice" && x.agreement === r.data.lease && x.at < before) || recs.some((x) => x.record === "withdrawal" && x.withdraws === order?.id && x.at < before)
      || ev.some((e) => e.event === "person_died" && e.person === tenant && e.t < before);
    if (pays && !ended && r.data.from < 15 * MONTH - 35 * DAY) {
      const landlordAccount = `acc-${r.speaks_for}`;
      const from = order!.data.outcome.money.from; // (the tenant's account: a newcomer's isn't named for them)
      const paid = ev.filter((e) => e.event === "transfer" && e.to === landlordAccount && e.from === from);
      expect(paid.some((e) => e.amount === String(r.data.rent) && e.t >= r.data.from)).toBe(true);
      for (let at = r.at; at + 31 * DAY <= r.data.from + 31 * DAY; at += 30 * DAY) {
        if (short(order!.id, at, at + 31 * DAY)) expect(paid.some((e) => e.t >= at && e.t < at + 62 * DAY)).toBe(true); // made up within the month after
        else expect(paid.some((e) => e.t >= at && e.t < at + 31 * DAY)).toBe(true);
      }
    }
  }
}, 600_000);

test("world prices move month to month, and scripted shocks change a price and the demand for the town's goods", async () => {
  const config = generate({ ...base, citizens: 80, shocks: [
    { from_day: 90, kind: "inputs", what: "price", factor_bps: 15_000 },
    { from_day: 60, kind: "goods", what: "demand", factor_bps: 5_000 },
  ] });
  const { recs } = await run("shocks", config, 5 * MONTH);
  const lists = recs.filter((r) => r.kind === "price_list" && r.speaks_for === "outside").map((r) => ({ t: r.at, goods: r.data.goods }));
  expect(lists.length).toBeGreaterThanOrEqual(4); // republished as prices move
  const start = lists[0]!.goods;
  // Before the price shock, inputs stay near their start; after it, about half as much again.
  const before = lists.filter((l) => l.t < 90 * DAY).at(-1)!.goods.inputs;
  const after = lists.filter((l) => l.t >= 90 * DAY)[0]!.goods.inputs;
  expect(Math.abs(before - start.inputs) / start.inputs).toBeLessThan(0.2);
  expect(after / before).toBeGreaterThan(1.3);
  // The buying offers: from the demand shock's month on, the factories' shares are halved (give or take the rounding).
  const offers = recs.filter((r) => r.kind === "buying_offer");
  const first = offers.find((o) => o.at < 60 * DAY)!;
  const later = offers.find((o) => o.at >= 60 * DAY)!;
  for (const [f, q] of Object.entries(first.data.quantities as { [f: string]: number })) expect(Math.abs(later.data.quantities[f] - Math.floor(q / 2))).toBeLessThanOrEqual(1);
  // Factories buy their inputs at the price the world market asks now: the list in force when the order was placed, or
  // the one just before it (an order decided just before a new list landed was rightly at the old price; acts take
  // time). Prices move month to month, so not against the first list after the shock.
  const inputOrders = recs.filter((r) => r.kind === "order" && r.speaks_for.startsWith("factory-") && r.data.kind === "inputs" && r.at >= 90 * DAY);
  expect(inputOrders.length).toBeGreaterThan(0);
  for (const o of inputOrders) expect(o.data.unit_price).toBeGreaterThanOrEqual(Math.min(...lists.filter((l) => l.t <= o.at && l.t >= o.at - 31 * DAY).map((l) => l.goods.inputs)));
}, 600_000);
