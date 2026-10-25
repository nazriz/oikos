// A town's first homes are dealt by income (docs/behaviour/generator.md, "Homes by income"): what a household has
// coming in is counted as its people count it (pay, a business of their own, payments in force), nobody holds a lease
// on a home that everything they had coming in could not pay for unless their savings carry it, people with nothing
// coming in live with kin as far as the profile's share of such households goes, and the payments the support law
// already owes are in payment from the first day. Checked on the generated config of every profile; then a month of
// one town, where the office pays from its file and nobody claims twice.

import { expect, test } from "bun:test";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400, MONTH = 30 * DAY, YEAR = 365 * DAY;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town-1000.yaml"), "utf8")) as any;
const profiles = readdirSync(join(root, "worlds/profiles")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

/** What a generated town opens with, read from its config alone. */
function opening(config: any) {
  const recs: any[] = config.world.records;
  const born = new Map<string, number>(config.world.entities.filter((e: any) => e.kind === "person").map((e: any) => [e.id, e.born_at]));
  const balance = new Map<string, number>(config.world.accounts.map((a: any) => [a.id, Number(a.balance)]));
  const pay = new Map<string, number>();
  for (const r of recs) if (r.record === "agreement" && r.terms?.template === "employment") {
    const c = r.terms.commitments[0];
    pay.set(r.terms.parties[1], c.every === DAY ? (Number(c.does.outcome.money.amount) * 30 * 5) / 7 : (Number(c.does.outcome.money.amount) * MONTH) / c.every);
  }
  for (const p of config.participants) { const m = /"own_work":\{[^}]*"expect_per_month":(\d+)/.exec(JSON.stringify(p)); if (m && p.person) pay.set(p.person, Number(m[1])); }
  const paid = new Map<string, number>();
  const grants = recs.filter((r) => r.kind === "benefit_decision" && r.data?.brought_forward);
  for (const r of grants) paid.set(r.addressed_to[0], (paid.get(r.addressed_to[0]) ?? 0) + (Number(r.data.amount) * MONTH) / Number(r.data.every));
  const households = recs.filter((r) => r.kind === "household").map((r) => r.data);
  const leases = new Map<string, number>(recs.filter((r) => r.record === "agreement" && r.terms?.template === "lease").map((r) => [r.terms.parties[1], Number(r.terms.commitments[1].does.outcome.money.amount)]));
  const renting = households.filter((h: any) => leases.has(h.leaseholder)).map((h: any) => {
    const people: string[] = h.members.map((m: any) => m.person);
    return { h, rent: leases.get(h.leaseholder)!, wages: people.reduce((x, m) => x + (pay.get(m) ?? 0), 0), payments: people.reduce((x, m) => x + (paid.get(m) ?? 0), 0), saved: balance.get(`acc-${h.leaseholder}`) ?? 0 };
  });
  return { recs, born, households, renting, grants, note: String(config.meta.description) };
}

test("every profile states how its renters' rents stand to their incomes, what is in payment at the start and who may hold kin, each with a source", () => {
  for (const id of profiles) {
    const P = loadProfile(id) as any;
    const rs = P.values.tenancy.rent_share_of_income;
    expect(rs, id).toBeDefined();
    expect(rs.bands.reduce((x: number, b: any) => x + b.bps, 0), id).toBe(10_000);
    expect(rs.bands.at(-1).under_bps, id).toBeUndefined();
    expect(["gross", "net", "expenditure"], id).toContain(rs.of);
    expect(P.sources["tenancy.rent_share_of_income"], id).toBeTruthy();
    // (A placeholder says so in both places.)
    expect(/^PLACEHOLDER/.test(P.sources["tenancy.rent_share_of_income"]), id).toBe(!!rs.placeholder);
    expect(P.values.support.take_up_bps, id).toBeDefined();
    for (const k of Object.keys(P.values.support.take_up_bps)) expect(P.values.support.payments.some((r: any) => r.id === k), `${id}: take-up of ${k}`).toBe(true);
    expect(P.sources["support.take_up_bps"], id).toBeTruthy();
    expect(P.values.households.extended_bps ?? P.values.households.kin_households_most_bps, `${id}: a share of households that hold kin`).toBeGreaterThan(0);
  }
});

test("in every profile's town nobody holds a lease that what they had coming in could not pay, unless their savings carry it; the unhoused are counted", () => {
  for (const id of profiles) {
    const config = generate({ ...spec, profile: id });
    const o = opening(config);
    const law = o.recs.find((r) => r.id === "law-support")?.data?.payments ?? [];
    const again = generate({ ...spec, profile: id });
    expect(JSON.stringify(again.world.records) === JSON.stringify(config.world.records), `${id}: the same town twice`).toBe(true);
    // In work now, or out of work and looking (who took the home in work): something came in. Otherwise the savings rule.
    const looking = new Set(config.participants.filter((p: any) => p.person && p.controller?.params?.in_labour_force !== false).map((p: any) => p.person));
    let bare = 0;
    for (const r of o.renting) {
      if (r.wages + r.payments >= r.rent || r.saved >= 6 * r.rent) continue;
      const adults = r.h.members.filter((m: any) => -m.born_at >= 18 * YEAR).map((m: any) => m.person);
      // (Someone of working age in the labour force and without work: placed at the town's usual pay.)
      if (adults.some((m: string) => looking.has(m))) continue;
      bare++;
    }
    expect(bare, `${id}: leases nobody could ever have paid for`).toBe(0);
    const said = /As the year begins: (\d+) payments in force; (\d+) households with nothing coming in live with kin, (\d+) rent on their savings, (\d+) households are without a home\./.exec(o.note);
    expect(said, id).not.toBeNull();
    expect(Number(said![1]), id).toBe(o.grants.length);
    // Everyone in payment is someone the law's rule entitles, and no pensioner is paid two pensions that exclude each other.
    for (const g of o.grants) {
      const rule = law.find((x: any) => x.id === g.data.payment);
      const age = Math.floor(-o.born.get(g.addressed_to[0])! / YEAR);
      expect(rule && age >= (rule.who?.from_age ?? 0) && age <= (rule.who?.to_age ?? Infinity) && rule.amount.flat === g.data.amount, `${id}: ${g.id}`).toBe(true);
      expect(g.data.next).toBeGreaterThan(0);
      expect(g.data.next).toBeLessThanOrEqual(rule.every_days * DAY);
    }
    // Households that hold kin are within the profile's share (drawn extended households and those that took someone in).
    const H = (loadProfile(id) as any).values.households;
    const taken = Number(said![2]);
    expect(taken, id).toBeLessThanOrEqual(Math.ceil(((H.extended_bps ?? H.kin_households_most_bps) * (o.households.length + taken)) / 10_000));
  }
}, 600_000);

test("the richer households rent the dearer homes, and the profile's distribution is what each household's share is drawn from", () => {
  const config = generate({ ...spec, profile: "us-oh-2026" });
  const o = opening(config);
  const withPay = o.renting.filter((r) => r.wages + r.payments > 0).sort((a, b) => a.wages + a.payments - (b.wages + b.payments));
  const third = Math.floor(withPay.length / 3);
  const mean = (xs: typeof withPay) => xs.reduce((x, r) => x + r.rent, 0) / xs.length;
  expect(mean(withPay.slice(-third))).toBeGreaterThan(mean(withPay.slice(0, third)));
  // (By size alone, a third of leases had no wage earner; by income, those with nothing at all coming in are few.)
  expect(o.renting.filter((r) => r.wages + r.payments === 0).length / o.renting.length).toBeLessThan(0.1);
});

test("a profile that states none of it is dealt its homes by size, with nothing in payment, as before", () => {
  const P = structuredClone(loadProfile("au-vic-2026")) as any;
  delete P.values.tenancy.rent_share_of_income;
  delete P.values.support.take_up_bps;
  const { generateFrom } = require("@oikos/worlds/generator/generate");
  const config = generateFrom({ ...spec }, P);
  expect(config.world.records.some((r: any) => r.data?.brought_forward)).toBe(false);
  expect(/As the year begins/.test(config.meta.description)).toBe(false);
  // (The count the fault was recorded with: docs/design/ai-citizens.md, "Progress", the firm-side fixes; 241 since
  // 2026-10-24, when who works and what they have saved came to be drawn together (ME-17): a different town.)
  const o = opening(config);
  expect(o.renting.length).toBe(241);
  expect(o.renting.filter((r) => r.wages === 0).length).toBe(74);
});

test("payments in force are paid from the first period by the office's file, and their holders do not claim again", async () => {
  const out = join(root, "runs", "test-homes-by-income");
  rmSync(out, { recursive: true, force: true });
  const config = generate({ ...Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any, years: 1 });
  const o = opening(config);
  expect(o.grants.length).toBeGreaterThan(10);
  const s = await runWorld({ config, runId: "homes-by-income", outDir: out, until: 31 * DAY });
  const lines = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const made = lines.filter((e) => e.kind === "command").flatMap((e) => (e.body?.blocks ?? []).filter((b: any) => b.block === "publish" && b.kind === "benefit_claim"));
  const holders = new Set(o.grants.map((g) => `${g.addressed_to[0]}|${g.data.payment}`));
  // Nobody with a payment in force claims that payment again.
  expect(made.filter((c: any) => holders.has(`${c.speaks_for}|${c.data?.payment}`)).length).toBe(0);
  // Each is paid on the day its grant names, and then every period.
  const paidTo = new Map<string, number[]>();
  for (const e of lines) if (e.kind === "event" && e.body?.event === "transfer" && /support\.$/.test(String(e.body.memo ?? ""))) paidTo.set(e.body.to, [...(paidTo.get(e.body.to) ?? []), e.t]);
  // (A payment its holder asked to stop, having found work, is no longer in force: since 2026-10-24 an unemployed holder
  // taken on on the first day, who in the earlier town was not, stops theirs. Hiring by fit, ME-2.)
  const stopped = new Set(lines.filter((e) => e.kind === "event" && e.body?.event === "recorded" && e.body.record?.kind === "benefit_change" && e.body.record.data?.stop).map((e) => e.body.record.data.claim));
  for (const g of o.grants.filter((g) => !stopped.has(g.data.claim ?? g.basis ?? "") && !stopped.has(g.id.replace(/^grant-/, "claim-")))) {
    const got = paidTo.get(`acc-${g.addressed_to[0]}`) ?? [];
    expect(got.length, g.id).toBeGreaterThanOrEqual(Math.floor((29 * DAY - g.data.next) / g.data.every) + 1); // (the office pays when it next looks: a day of slack at the end)
    expect(got[0]! - g.data.next, g.id).toBeLessThan(2 * DAY);
  }
  rmSync(out, { recursive: true, force: true });
}, 600_000);
