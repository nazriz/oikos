// Public finance (phase C, stage C4a): employers withhold income tax from wages under the published law and pay it
// over monthly; a valuer values every private property yearly; the town's rates officer levies rates on those values
// under its rating law, and owners pay them; a higher government pays the town a grant per resident each quarter.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { annualTax, taxLawOf, withholding } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any), shop_mix: false /* the single-goods town: this test holds a mechanism of it (docs/risks.md ME-21) */ };

test("income tax: marginal rates on a year's income, a levy from its threshold, withheld per pay", () => {
  const law = taxLawOf("l", { brackets: [{ from: 0, rate_bps: 0 }, { from: 1_000_000, rate_bps: 2000 }, { from: 5_000_000, rate_bps: 4000 }], levy_bps: 100, levy_from: 2_000_000, collector: "o", account: "a" })!;
  expect(annualTax(law, 500_000)).toBe(0); // below the threshold, and the levy's
  expect(annualTax(law, 3_000_000)).toBe(400_000 + 30_000); // 20% of $20,000, and 1% of $30,000
  expect(annualTax(law, 6_000_000)).toBe(800_000 + 400_000 + 60_000);
  expect(withholding(law, 0, 14 * DAY)).toBe(0);
  expect(withholding(undefined, 100_000, 14 * DAY)).toBe(0); // no law, nothing withheld
  // A fortnight's pay of $1,000 is $26,071 a year: 20% of $16,071 plus 1% of it all, over the year, for a fortnight.
  expect(withholding(law, 100_000, 14 * DAY)).toBe(Math.floor(((321_428 + 26_071) * 14) / 365));
});

test("wages are paid net of the tax withheld, which is paid over; rates are levied on valuations and paid; grants arrive", async () => {
  const config = generate({ ...base, citizens: 80 });
  const out = join(root, "runs", "test-public-finance");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "public-finance", outDir: out, until: 100 * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const taxLaw = config.world.records.find((r: any) => r.id === "law-income-tax");
  const law = taxLawOf(taxLaw.id, taxLaw.data, taxLaw.speaks_for)!;
  // Wages: every standing order for wages pays the agreed wage less what the law withholds.
  const jobs = new Map([...config.world.records, ...recs].filter((r: any) => r.record === "agreement" && r.terms.template === "employment").map((a: any) => [a.id, a]));
  const wageOrders = [...config.world.records, ...recs].filter((r: any) => r.record === "statement" && r.kind === "request" && jobs.has(r.basis) && r.data?.every);
  expect(wageOrders.length).toBeGreaterThan(10);
  // (The wage agreed, raised by any enterprise agreement at that employer before the order: docs/behaviour/unions.md.)
  const eas = recs.filter((r) => r.kind === "enterprise_agreement");
  for (const o of wageOrders) {
    const a: any = jobs.get(o.basis);
    const m = a.terms.commitments.find((c: any) => c.who === a.terms.parties[0]).does.outcome.money;
    const every = a.terms.commitments.find((c: any) => c.who === a.terms.parties[0]).every;
    let gross = Number(m.amount);
    // (A rise is for the staff there are when it is agreed: someone who signs afterwards, on a posting made before
    // it, is paid what the posting said. So a job counts from the day its worker signed, not the day it was posted:
    // found on 2026-10-12, when the town as now drawn first had such a hire; the employer's order was right.)
    const signed = [...config.world.records, ...recs].filter((r: any) => r.record === "signature" && r.agreement === a.id && r.as === a.terms.parties[1]).map((r: any) => r.at as number).sort((x, y) => x - y)[0] ?? a.at;
    for (const ea of eas.filter((x) => x.data.employer === a.terms.parties[0] && x.at <= o.at && x.at >= signed)) gross = Math.floor((gross * (10_000 + ea.data.rise_bps)) / 10_000);
    // (Or, for someone whose hours were cut or restored by their employer's paper, the wage that paper names, from its day, once agreed
    // where it asks for agreement: docs/behaviour/firms.md, "Hours before heads".)
    const agreed = (n: any) => !n.data.consent || recs.some((x) => x.kind === "hours_reply" && x.data.agreement === a.id && x.data.agree === true && x.at >= n.at);
    const paper = recs.filter((x) => (x.kind === "hours_notice" || x.kind === "hours_restored") && x.data.agreement === a.id && x.data.from <= o.at && agreed(x)).sort((x, y) => y.data.from - x.data.from)[0];
    if (paper) gross = paper.data.wage;
    expect(Number(o.data.outcome.money.amount)).toBe(gross - withholding(law, gross, every));
  }
  // What's withheld is paid over monthly, with a report (a firm short of money pays what it has, and owes the rest).
  const reports = recs.filter((r) => r.kind === "withholding_report");
  expect(reports.length).toBeGreaterThan(3);
  for (const r of reports) {
    expect(r.data.paid).toBeLessThanOrEqual(r.data.withheld);
    if (r.data.paid > 0) expect(ev.some((e) => e.event === "transfer" && e.to === "acc-outside" && e.amount === String(r.data.paid) && e.from === r.data.account)).toBe(true);
  }
  expect(reports.filter((r) => r.data.paid === r.data.withheld).length).toBeGreaterThan(reports.length / 2);
  // Valuations: each private property, at land plus the builder's price for what's on it; none of the town's own.
  const valuations = recs.filter((r) => r.kind === "valuation");
  expect(valuations.length).toBeGreaterThan(10);
  expect(valuations.every((v) => v.data.owner !== "city" && v.data.value === v.data.land + v.data.buildings.reduce((x: number, b: any) => x + b.value, 0))).toBe(true);
  // Rates: notices at the law's rate, a claim each, and owners pay them (a payment naming the claim).
  const rate = config.world.records.find((r: any) => r.id === "law-rates").data;
  const notices = recs.filter((r) => r.kind === "rates_notice");
  expect(notices.length).toBeGreaterThan(5);
  const latest = new Map(valuations.map((v) => [v.data.lot, v]));
  for (const n of notices) {
    const expected = n.data.lots.reduce((x: number, l: string) => x + Math.floor((latest.get(l)!.data.value * rate.rate_ppm) / 1_000_000 / rate.instalments), 0);
    expect(n.data.amount).toBe(expected);
  }
  const claims = recs.filter((r) => r.record === "claim" && r.about?.kind === "rates");
  expect(claims.length).toBe(notices.length);
  const paid = claims.filter((c) => ev.some((e) => e.event === "transfer" && e.settles === c.id && e.to === "acc-city"));
  expect(paid.length).toBeGreaterThan(claims.length / 2);
  // Grants: from outside, to the town, at the rate per resident for a quarter.
  // (The town's: the clinic and the school have their own funders' grants.)
  const grants = recs.filter((r) => r.kind === "grant_payment" && (r.addressed_to ?? []).includes("city"));
  expect(grants.length).toBeGreaterThanOrEqual(1);
  for (const g of grants) {
    expect(g.data.residents).toBeGreaterThan(40);
    expect(ev.some((e) => e.event === "transfer" && e.from === "acc-outside" && e.to === "acc-city" && e.amount === String(g.data.amount))).toBe(true);
  }
  // The rent tax is gone.
  expect(recs.some((r) => r.kind === "tax_report")).toBe(false);
}, 600_000);
