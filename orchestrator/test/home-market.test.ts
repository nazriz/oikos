// Buying and selling homes (docs/behaviour/ownership.md), in a generated town: an owner out of work and broke, who'd
// leave, lists the house at its valuation instead of walking away; a renting household that can afford it applies for a
// mortgage (purpose "a home", within the bank's loan-to-value rule), buys it, and is passed the title; the seller pays
// the mortgage off at the bank's payout figure and leaves; the buyer gives notice on the lease and moves in.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { officeBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

// (The first asking price here divides evenly by five; a price after a cut does not, and by the time the buyer has the
// three months of income the bank wants, the house has been cut. Until 2026-10-08 the buyer rounded its deposit down,
// so the loan it asked was a unit over the bank's 80% and was refused, on day 91 and again on day 183:
// docs/decisions.md, "A home loan asked a fraction over the limit".)
test("an owner who'd leave sells; a renter buys on a mortgage, gets the title and moves in", async () => {
  const config = generate({ ...spec, years: 1 }) as any;
  const recs = config.world.records as any[];
  const params = (id: string) => config.participants.find((x: any) => x.id === `${id}-self`).controller.params;
  const account = (id: string) => config.world.accounts.find((a: any) => a.holder === id);
  const occupants = (space: string) => config.world.occupancy.filter((o: any) => o.space === space).map((o: any) => o.occupant);
  const mortgages = recs.filter((r) => r.terms?.template === "loan");
  // The seller: an owner with a mortgage. Everyone in the household out of work and not looking, the money gone, and
  // little patience.
  const loan = mortgages[0];
  const seller = loan.terms.parties[1];
  const title = recs.find((r) => r.record === "claim" && r.about?.kind === "ownership" && r.holder === seller);
  const home = String(loan.terms.text).match(/their home, ([^,;]+)/)![1]!;
  const household = occupants(home);
  const jobs = new Set(recs.filter((r) => r.terms?.template === "employment" && household.some((h: string) => r.terms.parties.includes(h))).map((r) => r.id));
  config.world.records = recs.filter((r) => ![r.id, r.basis, r.agreement, r.statement].some((x) => jobs.has(x)) && ![...jobs].some((j) => String(r.id).startsWith(`${j}-`)));
  for (const h of household) {
    const a = account(h);
    if (a) a.balance = "0";
    const p = config.participants.find((x: any) => x.id === `${h}-self`)?.controller.params;
    if (p) Object.assign(p, { leave_after_jobless_days: 10, in_labour_force: false }); // (not looking for work: else they'd find some)
  }
  // The buyer: a renting leaseholder in work, with savings enough, who looks every month. (A lenient bank: what they
  // can repay is the test's to set, not what's under test.)
  const lease = recs.find((r) => r.terms?.template === "lease" && r.terms.parties[0] !== r.terms.parties[1] && recs.some((j) => j.terms?.template === "employment" && j.terms.parties.includes(r.terms.parties[1])));
  const buyer = lease.terms.parties[1];
  account(buyer).balance = "200000000";
  params(buyer).market = { ...params(buyer).market, buy_bps: 10_000 };
  // Only they take part in the market (others who'd leave would list too, and the buyer take the cheapest).
  for (const x of config.participants) if (x.controller?.impl === "citizen.default" && x.controller.params?.market && ![...household, buyer].some((h: string) => x.id === `${h}-self`)) delete x.controller.params.market;
  const lending = officeBy(config, "bank.lending");
  lending.params.max_share_bps = { ...lending.params.max_share_bps, person: 10_000 };

  const out = join(root, "runs", "test-home-market");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "home-market", outDir: out, until: 240 * DAY });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const said = ev.filter((e) => e.event === "recorded").map((e) => e.record);

  // Listed at the valuation.
  const listing = said.find((r) => r.kind === "property_for_sale" && r.speaks_for === seller);
  expect(listing).toBeDefined();
  const valuation = said.filter((r) => r.kind === "valuation" && r.data.lot === title.about.object && r.at <= listing.at).at(-1);
  expect(listing.data.price).toBe(valuation.data.value);
  // The buyer's mortgage: for a home, 80% of the price.
  // (The bank wants three months of income coming in first: an early application is declined, and tried again later.)
  const apps = said.filter((r) => r.kind === "loan_application" && r.speaks_for === buyer && r.data.purpose === "a home");
  // (Unsold for a month, it's relisted 5% cheaper; the buyer applies for what it costs then.)
  const listings = said.filter((r) => r.kind === "property_for_sale" && r.speaks_for === seller);
  for (const app of apps) {
    expect(listings.map((l) => l.data.price)).toContain(app.data.price);
    // (The deposit, a fifth, rounded up to a whole unit: the loan is the rest, and never over four fifths.)
    const fifth = (app.data.price - (app.data.price % 5)) / 5 + (app.data.price % 5 ? 1 : 0);
    expect(app.data.amount).toBe(app.data.price - fifth);
    expect(app.data.amount * 5).toBeLessThanOrEqual(app.data.price * 4);
  }
  for (const l of listings) expect(l.data.price).toBeGreaterThanOrEqual(Math.floor(listing.data.price * 0.8));
  const decisions = said.filter((r) => r.kind === "loan_decision" && apps.some((a) => a.id === r.basis));
  // (Refused for want of three months' income, perhaps; never for the size of the loan against the price.)
  for (const d of decisions) expect(String(d.data.reason ?? "")).not.toContain("of the home's price");
  const approved = decisions.find((r) => r.data.approved);
  expect(approved).toBeDefined();
  // Bought: paid in full, the title passed by its holder.
  const buy = said.find((r) => r.kind === "property_purchase" && r.speaks_for === buyer);
  const bought = listings.find((l) => l.id === buy.basis);
  expect(bought).toBeDefined();
  const passed = said.find((r) => r.record === "claim_transfer" && r.claim === title.id);
  expect(passed?.to).toBe(buyer);
  expect(passed?.speaks_for).toBe(seller);
  // The seller's mortgage paid off, at the bank's figure, and its repayments stopped; then they left.
  const payout = said.find((r) => r.kind === "loan_payout" && r.data.loan === loan.id);
  expect(payout).toBeDefined();
  const settled = ev.find((e) => e.event === "transfer" && e.settles === loan.id);
  expect(settled?.amount).toBeDefined();
  expect(said.some((r) => r.record === "withdrawal" && r.speaks_for === seller && r.withdraws === `${loan.id}-repay`)).toBe(true);
  const left = ev.find((e) => e.event === "person_left" && e.person === seller);
  expect(left?.t).toBeGreaterThan(settled.t);
  // What was left after the mortgage went with them.
  const took = ev.find((e) => e.event === "transfer" && e.from === account(seller).id && e.to === "acc-outside");
  expect(Number(took?.amount)).toBeGreaterThan(Number(bought.data.price) - Number(settled.amount) - 5_000_000);
  // The buyer: notice on the lease, and in the house.
  expect(said.some((r) => r.record === "notice" && r.agreement === lease.id && r.speaks_for === buyer)).toBe(true);
  expect(ev.some((e) => e.event === "occupied" && e.space === home && (e.occupant ?? e.who) === buyer)).toBe(true);
}, 2_400_000);
