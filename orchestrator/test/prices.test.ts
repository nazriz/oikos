// Prices that bite, and shocks (phase C, stage C1): landlords review rents to what they'd ask now, within the world's
// tenancy law, and tenants pay it or leave; world prices move, and scripted shocks change a price or the demand for
// the town's goods.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const MONTH = 30 * DAY;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

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

test("rents are reviewed within the tenancy law, never down, and tenants pay the new rent or leave", async () => {
  const config = generate(base);
  // The world's law, not the profile's: reviews every 6 months, with 45 days' notice. Landlords read the law.
  const record = config.world.records.find((r: any) => r.kind === "law" && r.data?.law === "rent_increases");
  Object.assign(record.data, { review_months: 6, notice_days: 45 });
  const law = { months: 6, notice: 45 };
  const { ev, recs } = await run("rents", config, 15 * MONTH);
  const increases = recs.filter((r) => r.kind === "rent_increase");
  expect(increases.length).toBeGreaterThan(5);
  const byLease = new Map<string, any[]>();
  for (const r of increases) byLease.set(r.data.lease, [...(byLease.get(r.data.lease) ?? []), r]);
  for (const [, rs] of byLease) for (let i = 1; i < rs.length; i++) expect(rs[i].at - rs[i - 1].at).toBeGreaterThanOrEqual(law.months * MONTH);
  // (As often as the law allows: some tenancies reviewed twice in 15 months.)
  expect([...byLease.values()].some((rs) => rs.length >= 2)).toBe(true);
  for (const r of increases) {
    expect(r.data.from - r.at).toBeGreaterThanOrEqual(law.notice * DAY);
    expect(Number(r.data.rent)).toBeGreaterThan(Number(r.data.was));
    // The tenant answers (given a week to): a standing order for the new rent, or notice on the lease.
    if (r.at > 15 * MONTH - 7 * DAY) continue;
    const tenant = r.addressed_to[0];
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
      const paid = ev.filter((e) => e.event === "transfer" && e.to === landlordAccount && e.from === `acc-${tenant}`);
      expect(paid.some((e) => e.amount === String(r.data.rent) && e.t >= r.data.from)).toBe(true);
      for (let at = r.at; at + 31 * DAY <= r.data.from + 31 * DAY; at += 30 * DAY) expect(paid.some((e) => e.t >= at && e.t < at + 31 * DAY)).toBe(true);
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
  // Factories buy their inputs at the price the world market asks now.
  const inputOrders = recs.filter((r) => r.kind === "order" && r.speaks_for.startsWith("factory-") && r.data.kind === "inputs" && r.at >= 90 * DAY);
  for (const o of inputOrders) expect(o.data.unit_price).toBeGreaterThanOrEqual(after);
}, 600_000);
