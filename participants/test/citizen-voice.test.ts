// Voice (docs/behaviour/citizen.md "Voice"; Hirschman 1970, Granovetter 1978), on what a tenant is shown alone: who
// starts a petition and what it asks, who signs at all, who signs when, and the count its organiser publishes.

import { expect, test } from "bun:test";

import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DAY, employment, lease, person, signed, standingOrder, statement, type Said } from "./stepping";
import { engine } from "./engine";
const citizen = engine("citizen.default");

inCurrency(PROFILE.values.currency);

const WAGE = 120_000; // a fortnight: $2,571.42 a month
const INCOME = Math.floor((WAGE * 30) / 14);
/** A tenant of landlord-1 in work, paying `rent` a month, as the world's first records have them. */
const tenancy = (rent: number, me = "c1") => [...signed(lease("L1", 0, "landlord-1", me, "apts-1/dwelling.1", rent)), standingOrder("so-1", 0, me, "acc-landlord-1", rent, { basis: "L1", first: 0 }), ...signed(employment("J1", 0, "factory-1", me, WAGE))];
const READINGS = { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } };
/** Their fortnight's wages, as paid (someone unpaid for a pay period walks out: not what's tested here). */
const wages = (t: number, me = "c1") => [{ t: t - DAY, from: "acc-factory-1", to: `acc-${me}`, amount: String(WAGE), currency: "AUD", by: "bank", memo: "wages" }];
const STRAINED = 110_000; // 42.8% of income: aggrieved (40% or more)
const EASY = 80_000; // 31%: not
const PARAMS = { petition_willing_bps: 10_000, petition_start_bps: 10_000, threshold_mean_bps: 2500, threshold_sd_bps: 0, population: 200 };
const tenant = (rent: number, params: object = {}, o: { me?: string; seed?: bigint } = {}) => person(citizen, { ...PARAMS, ...params }, o);
const first = (p: ReturnType<typeof person>, rent: number, w: object = {}) => p.wake(DAY, { records: tenancy(rent, p.me), readings: READINGS, balance: 500_000, transactions: wages(DAY, p.me), ...w });
const petitions = (said: Said[]) => said.filter((c) => c.fn === "statement" && c.args.kind === "petition");
const signatures = (said: Said[]) => said.filter((c) => c.fn === "vote");
const open = (id: string, at: number, by: string, x: object = {}) => statement(id, at, "petition", { author: `${by}-self`, speaks_for: by, text: "Petition.", data: { demand: { kind: "law", text: "x", tags: ["tenant_protection"] } }, ...x });
const count = (id: string, of: string, at: number, by: string, n: number) => statement(id, at, "petition_count", { author: `${by}-self`, speaks_for: by, basis: of, text: `${n} people have signed.`, data: { petition: of, signatures: n } });

// DIVERGENCE (cut-over, held as test.failing): the engine's citizen differs from the TS one on this case (see docs/risks.md, PC-15).
test.failing("a tenant whose rent is 40% or more of income is aggrieved, and with no tenants' petition open starts one: a law, tagged tenant protection, with its breakdown", async () => {
  const said = await first(tenant(STRAINED), STRAINED);
  const made = petitions(said);
  expect(made.length).toBe(1);
  expect(made[0]!.why).toBe("Aggrieved (rent is 43% of household income) and no tenants' petition is open: starting one.");
  expect(made[0]!.args.text).toBe("Petition: landlords must give 90 days' notice, and may not raise rent by more than 5% a year.");
  expect(made[0]!.args.data).toEqual({ demand: { kind: "law", tags: ["tenant_protection"],
    text: "A landlord must give at least 90 days' notice to end a tenancy, and may not raise the rent by more than 5% in any 12 months.",
    adico: { attribute: "landlords", deontic: "must_not", aim: "end a tenancy on less than 90 days' notice, or raise rent by more than 5% a year" } } });
  // Where the world's law on ending a tenancy is made from figures, the demand also names it and the notice asked, as a figure.
  const named = petitions(await first(tenant(STRAINED, { tenancy_schedule: "schedule-tenancy" }), STRAINED));
  expect(named[0]!.args.data.demand.amend).toEqual({ schedule: "schedule-tenancy", figures: { notice: 90 * DAY } });
  // Just under 40% (39.6% of $2,571.42): not aggrieved, and nothing started.
  expect(petitions(await first(tenant(EASY), EASY))).toEqual([]);
  expect(petitions(await first(tenant(101_900), 101_900))).toEqual([]);
  expect(petitions(await first(tenant(102_900), 102_900)).length).toBe(1);
  expect(INCOME).toBe(257_142);
});

test("a tenant given notice to go is aggrieved while angry with the landlord, and starts a petition though the rent is easy", async () => {
  const p = tenant(EASY);
  expect(petitions(await first(p, EASY))).toEqual([]);
  const notice = { id: "n1", at: 5 * DAY, author: "landlord-1-office-system", record: "notice", agreement: "L1", as: "landlord-1", visible_to: ["landlord-1", "c1"], text: "Notice to end the tenancy." };
  const said = petitions(await p.wake(8 * DAY, { records: [notice], transactions: wages(8 * DAY) }));
  expect(said.length).toBe(1);
  expect(said[0]!.why).toBe("Aggrieved (our landlord gave us notice) and no tenants' petition is open: starting one.");
});

test("an aggrieved tenant starts a petition with the chance petition_start_bps each time it looks, and never while one is open", async () => {
  // Never, at 0.
  const never = tenant(STRAINED, { petition_start_bps: 0 });
  expect(petitions(await first(never, STRAINED))).toEqual([]);
  expect(petitions(await never.wake(8 * DAY, { transactions: wages(8 * DAY) }))).toEqual([]);
  // At the documented 3% a wake: of 400 aggrieved tenants looking once, a few (between 3 and 25).
  let started = 0;
  for (let i = 0; i < 400; i++) started += petitions(await first(tenant(STRAINED, { petition_start_bps: 300 }, { seed: BigInt(i + 1) }), STRAINED)).length;
  expect(started).toBeGreaterThanOrEqual(3);
  expect(started).toBeLessThanOrEqual(25);
  // One is open (someone else's): none started; aggrieved, it signs that one.
  const said = await first(tenant(STRAINED), STRAINED, { petitions: [open("pet-9", 0, "c9")] });
  expect(petitions(said)).toEqual([]);
  expect(signatures(said).map((c) => [c.args, c.why])).toEqual([[{ ballot: "pet-9", choice: "sign" }, "Signing the tenants' petition: we're aggrieved ourselves."]]);
  // A petition about something else isn't a tenants' petition: it neither stops one starting nor is signed.
  const other = await first(tenant(STRAINED), STRAINED, { petitions: [open("pet-8", 0, "c9", { data: { demand: { kind: "law", text: "Dogs.", tags: [] } } })] });
  expect(petitions(other).length).toBe(1);
  expect(signatures(other)).toEqual([]);
});

// DIVERGENCE (cut-over, held as test.failing): the engine's citizen differs from the TS one on this case (see docs/risks.md, PC-15).
test.failing("only those who sign petitions at all (petition_willing_bps, drawn once) start or sign one, however aggrieved", async () => {
  const unwilling = tenant(STRAINED, { petition_willing_bps: 0 });
  expect(petitions(await first(unwilling, STRAINED))).toEqual([]);
  const board = [open("pet-9", 0, "c9")];
  expect(signatures(await unwilling.wake(8 * DAY, { petitions: board, records: [count("n1", "pet-9", 7 * DAY, "c9", 200)], transactions: wages(8 * DAY) }))).toEqual([]);
  // At the documented 44%: of 300 aggrieved tenants, each certain to start if willing, about that share do (36% to 52%).
  let willing = 0;
  for (let i = 0; i < 300; i++) willing += petitions(await first(tenant(STRAINED, { petition_willing_bps: 4400 }, { seed: BigInt(i + 1) }), STRAINED)).length;
  expect(willing).toBeGreaterThan(108);
  expect(willing).toBeLessThan(156);
});

test("a tenant who isn't aggrieved signs once the share of the town in the organiser's latest published count reaches their own threshold, and once only", async () => {
  // Threshold 25% (no spread), population 200: 50 signatures.
  const p = tenant(EASY);
  const board = [open("pet-9", 0, "c9")];
  expect(signatures(await first(p, EASY, { petitions: board }))).toEqual([]); // (no count published yet)
  expect(signatures(await p.wake(8 * DAY, { petitions: board, records: [count("n1", "pet-9", 7 * DAY, "c9", 49)], transactions: wages(8 * DAY) }))).toEqual([]);
  // A count from someone who isn't the organiser isn't the petition's count.
  expect(signatures(await p.wake(15 * DAY, { petitions: board, records: [count("n2", "pet-9", 14 * DAY, "c7", 180)], transactions: wages(15 * DAY) }))).toEqual([]);
  const said = signatures(await p.wake(22 * DAY, { petitions: board, records: [count("n3", "pet-9", 21 * DAY, "c9", 50)], transactions: wages(22 * DAY) }));
  expect(said.map((c) => [c.args, c.why])).toEqual([[{ ballot: "pet-9", choice: "sign" }, "Signing the tenants' petition: 25% of the town has signed, past our own threshold of 25%."]]);
  expect(signatures(await p.wake(29 * DAY, { petitions: board, records: [count("n4", "pet-9", 28 * DAY, "c9", 90)], transactions: wages(29 * DAY) }))).toEqual([]);
});

// DIVERGENCE (cut-over, held as test.failing): the engine's citizen differs from the TS one on this case (see docs/risks.md, PC-15).
test.failing("thresholds are roughly normal around threshold_mean_bps with spread threshold_sd_bps, a person's own", async () => {
  // 300 tenants, none aggrieved, shown a petition the whole town has signed: each signs, and says its threshold.
  const board = [open("pet-9", 0, "c9")];
  const thresholds: number[] = [];
  for (let i = 0; i < 300; i++) {
    const said = signatures(await first(tenant(EASY, { threshold_sd_bps: 1000 }, { seed: BigInt(i + 1) }), EASY, { petitions: board, records: [...tenancy(EASY), count("n1", "pet-9", 0, "c9", 200)] }));
    expect(said.length).toBe(1);
    thresholds.push(Number(/threshold of (\d+)%/.exec(said[0]!.why)![1]));
  }
  const mean = thresholds.reduce((a, b) => a + b, 0) / thresholds.length;
  const sd = Math.sqrt(thresholds.reduce((a, b) => a + (b - mean) ** 2, 0) / thresholds.length);
  expect(mean).toBeGreaterThan(23);
  expect(mean).toBeLessThan(27);
  expect(sd).toBeGreaterThan(8);
  expect(sd).toBeLessThan(12);
  expect(Math.min(...thresholds)).toBeGreaterThanOrEqual(0);
});

test("the organiser publishes the petition's running count (the signatures it has seen, and itself) when it has changed, at most every 3 days, and closes the petition after petition_days", async () => {
  const p = tenant(STRAINED, { petition_days: 60 });
  const started = petitions(await first(p, STRAINED));
  expect(started.length).toBe(1);
  // The petition as the board shows it from now on (its organiser's own).
  const mine = open("pet-1", DAY, "c1");
  const sign = (id: string, at: number, who: string, choice = "sign") => ({ id, at, record: "vote", author: `${who}-self`, speaks_for: who, visible_to: [who, "c1"], ballot: "pet-1", choice });
  const counts = (said: Said[]) => said.filter((c) => c.fn === "statement" && c.args.kind === "petition_count").map((c) => ({ text: c.args.text, basis: c.args.basis, data: c.args.data }));
  const wake = (day: number, records: any[] = []) => p.wake(day * DAY, { petitions: [mine], records, transactions: wages(day * DAY) });
  // Nobody else yet: itself.
  expect(counts(await wake(8))).toEqual([{ text: "1 people have signed.", basis: "pet-1", data: { petition: "pet-1", signatures: 1 } }]);
  // Two sign (one of them twice: a signer counts once), and someone votes something that isn't a signature.
  expect(counts(await wake(15, [sign("s1", 9 * DAY, "c2"), sign("s2", 10 * DAY, "c3"), sign("s3", 11 * DAY, "c3"), sign("s4", 11 * DAY, "c4", "no")]))).toEqual([{ text: "3 people have signed.", basis: "pet-1", data: { petition: "pet-1", signatures: 3 } }]);
  // A fourth signs a day later: not published yet (less than 3 days since the last count); nor is an unchanged count ever.
  expect(counts(await wake(16, [sign("s5", 16 * DAY, "c5")]))).toEqual([]);
  expect(counts(await wake(17))).toEqual([]);
  expect(counts(await wake(18))).toEqual([{ text: "4 people have signed.", basis: "pet-1", data: { petition: "pet-1", signatures: 4 } }]);
  expect(counts(await wake(25))).toEqual([]);
  // The organiser never signs its own petition.
  expect(signatures(await wake(32))).toEqual([]);
  // After petition_days (60 from when it was made, day 1): closed, once.
  expect((await wake(60)).filter((c) => c.args.withdraw)).toEqual([]);
  const closing = (await wake(61)).filter((c) => c.args.withdraw);
  expect(closing.map((c) => [c.args.withdraw, c.why])).toEqual([["pet-1", "Closing our petition after 60 days."]]);
});
