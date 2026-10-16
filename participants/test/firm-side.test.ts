// How an employer adjusts its staff, what the law on ending a job gives, and how the tribunal hears an application
// for possession (docs/behaviour/firms.md, "Adjusting labour"; docs/behaviour/justice.md, "Possession"). The laws are
// records a world publishes: the figures here are the test's own.

import { expect, test } from "bun:test";
import { Book } from "../src/behaviour/common";
import { Hearings, HEARING_DEFAULTS } from "../src/behaviour/desk";
import { householdNamed, LabourPlan, possessionLaw, terminationLaw, weeksAt } from "../src/behaviour/firms";
import { inCurrency } from "../src/money";
import { Randomness } from "../src/rng";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DAY, lease, statement } from "./stepping";

inCurrency(PROFILE.values.currency);
const rng = (k: string) => new Randomness(7n).stream(["test", k]);
const law = (id: string, data: object) => statement(id, 0, "law", { speaks_for: "outside", data });
const bookOf = (...records: any[]) => {
  const b = new Book();
  b.absorb({ t: 0, entity: "x", participant: "x", channels: { mine: { kind: "records", records } }, inbox: [], outcomes: [], woke_for: "cadence" } as any);
  return b;
};
const TERMINATION = { employment: "termination", notice: [{ from_years: 0, days: 7 }, { from_years: 1, days: 14 }, { from_years: 5, days: 28 }], redundancy_pay: [{ from_years: 1, days: 28 }, { from_years: 2, days: 42 }], small_employer_under: 15 };

test("the trade a firm expects is its months smoothed: one freak month moves it part of the way, and it comes back", () => {
  const p = new LabourPlan({ smooth_months: 3, hiring_cost_weeks: 8 });
  expect(p.expect(400)).toBe(400);
  expect(p.expect(1_200)).toBe(800); // (half of the gap, with a horizon of three months)
  expect(p.expect(400)).toBe(600);
  expect(p.expect(400)).toBe(500);
  // (No horizon: last month's figure, the rule as it was.)
  const raw = new LabourPlan({ smooth_months: 0, hiring_cost_weeks: 0 });
  expect([raw.expect(400), raw.expect(1_200), raw.expect(400)]).toEqual([400, 1_200, 400]);
});

test("the law on ending a job is read from the world's record: notice and redundancy pay by service, none from a small employer; no such law, nothing", () => {
  expect(terminationLaw(bookOf())).toBeUndefined();
  const l = terminationLaw(bookOf(law("law-ending-employment", TERMINATION)))!;
  expect(l.id).toBe("law-ending-employment");
  expect([weeksAt(l.notice, 0.5), weeksAt(l.notice, 3), weeksAt(l.notice, 9)]).toEqual([1, 2, 4]);
  expect([weeksAt(l.redundancy_pay, 0.5), weeksAt(l.redundancy_pay, 1.5), weeksAt(l.redundancy_pay, 7)]).toEqual([0, 4, 6]);
  expect(l.small_employer_under).toBe(15);
});

test("someone is let go only when the surplus has lasted as long as ending the job and hiring again would cost; a month without one starts the count again", () => {
  const l = terminationLaw(bookOf(law("law-ending-employment", TERMINATION)))!;
  const p = new LabourPlan({ smooth_months: 3, hiring_cost_weeks: 8 });
  // A small shop, a hire of under a year: a week's notice by the law (two by the agreement) and eight weeks to hire again: three months.
  expect(p.waits(l, 4, 0.5, 14)).toBe(3);
  // A works of forty, three years' service: two weeks' notice, six of redundancy pay, eight to hire: four months.
  expect(p.waits(l, 40, 3, 14)).toBe(4);
  // The same works in a world with no such law: the agreement's notice and the hiring cost.
  expect(p.waits(undefined, 40, 3, 14)).toBe(3);
  expect([p.month(true, 3).letGo, p.month(true, 3).letGo, p.month(false, 3).letGo, p.month(true, 3).letGo, p.month(true, 3).letGo, p.month(true, 3).letGo]).toEqual([false, false, false, false, false, true]);
  // With no costs and no horizon it lets go the month it is over, as before.
  const raw = new LabourPlan({ smooth_months: 0, hiring_cost_weeks: 0 });
  expect(raw.waits(undefined, 4, 0, 14)).toBe(1);
  expect(raw.month(true, 1).letGo).toBe(true);
});

test("the law on possession is read from the world's record; a lease's words say who lives there", () => {
  expect(possessionLaw(bookOf())).toBeUndefined();
  expect(possessionLaw(bookOf(law("law-possession", { tenancy: "possession", arrears_days: 14, notice_days: 14, possession_days: 14, plan_months: 6, warrant_days: 14, eviction_notice_days: 7, enforced_by: "police" }))))
    .toEqual({ id: "law-possession", arrears_days: 14, notice_days: 14, possession_days: 14, plan_months: 6, warrant_days: 14, eviction_notice_days: 7, enforced_by: "police" });
  expect(householdNamed({ terms: { text: "c1 rents home h/dwelling.1 from landlord-1, to live there with their household: c2, c3." } }, "c1")).toEqual(["c1", "c2", "c3"]);
  expect(householdNamed(lease("L1", 0, "landlord-1", "c1", "h/dwelling.1", 100_000), "c1")).toEqual(["c1"]);
});

/** A tribunal's list hearing possession over the days given, each day shown what has newly come: what it counted. */
function heard(days: [number, any[]][], until = 40) {
  const h = new Hearings("tribunal", { rng, world: {} }, { ...HEARING_DEFAULTS, hears: [{ about: "possession", can: ["order"] }], answer_days: 21, possession: { days: 14, plan_months: 6 } },
    { application: ["tribunal_application"], notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" });
  const b = new Book();
  for (let d = 0; d <= until; d++) {
    b.absorb({ t: d * DAY, entity: "tribunal", participant: "x", channels: { mine: { kind: "records", records: days.filter(([at]) => at === d).flatMap(([, r]) => r) } }, inbox: [], outcomes: [], woke_for: "cadence" } as any);
    h.steps(b, d * DAY);
  }
  return { h };
}
const applied = (id: string, data: object) => statement(id, DAY, "tribunal_application", { author: "landlord-1-x", speaks_for: "landlord-1", addressed_to: ["tribunal"], visible_to: ["landlord-1", "tribunal", "c1"], basis: "L1",
  data: { kind: "possession", matter: "possession", against: "c1", about: "L1", amount: 400_000, rent: 200_000, account: "acc-landlord-1", space: "h/dwelling.1", structure: "h", household: ["c1", "c2"], ...data } });
const answered = (id: string, at: number, data: object) => statement(id, at * DAY, "tribunal_response", { author: "c1-self", speaks_for: "c1", addressed_to: ["tribunal"], visible_to: ["c1", "tribunal"], basis: "a1", data: { application: "a1", ...data } });
function findings(days: [number, any[]][]) {
  const { h } = heard(days);
  return h.counts;
}

test("possession: no answer or no plan that clears the arrears in time, possession on a date; an offer that does, a plan; a plan broken, possession; paid, dismissed", () => {
  expect(findings([[1, [applied("a1", {})]]])).toMatchObject({ applications: 1, possession: 1 });
  // $700 a month clears $4,000 within six months: a plan. $100 a month does not: possession.
  expect(findings([[1, [applied("a1", {})]], [5, [answered("r1", 5, { offer: 70_000 })]]])).toMatchObject({ plan: 1 });
  expect(findings([[1, [applied("a1", {})]], [5, [answered("r1", 5, { offer: 10_000 })]]])).toMatchObject({ possession: 1 });
  expect(findings([[1, [applied("a1", { breach: true })]], [5, [answered("r1", 5, { offer: 70_000 })]]])).toMatchObject({ possession: 1 });
  expect(findings([[1, [applied("a1", {})]], [5, [answered("r1", 5, { paid: 400_000 })]]])).toMatchObject({ dismissed: 1 });
});

// ---------------------------------------------------------------- wages owed: what a payment says, and the ledger

import { citizen } from "../src/behaviour/citizen";
import { PAYMENT_FAILED } from "../src/behaviour/common";
import { retailer } from "../src/behaviour/retailer";
import { OUTCOMES } from "../src/module";
import { context, employment, lease, person, signed, standingOrder, wake } from "./stepping";

test("money from an employer is pay come short only if it was paid as wages: a refund or a dividend is not", async () => {
  const WAGE = 200_000;
  const life = () => [...signed(lease("L1", 0, "landlord-1", "c1", "house-1/dwelling.1", 100_000)), ...signed(employment("J1", 0, "factory-1", "c1", WAGE)),
    standingOrder("so-rent", 0, "c1", "acc-landlord-1", 100_000, { basis: "L1", every: 30 * DAY, for: "rent" })];
  const READ = { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } };
  const from = (t: number, amount: number, memo: string | undefined) => [{ t: t - DAY, from: "acc-factory-1", to: "acc-c1", amount: String(amount), currency: "AUD", by: "bank", per_instruction: "x-1", ...(memo ? { memo } : {}) }];
  const seen = async (memo: string | undefined) => {
    const outcomes: any[] = [];
    const module = { create: (ctx: any) => {
      ctx.world = { ...ctx.world, dials: { ...(ctx.world?.dials ?? {}), friction_bps: 10_000 } };
      const m = citizen.create(ctx);
      return { step: async (o: any, c: any) => { const a: any = await m.step(o, c); outcomes.push(...(a[OUTCOMES] ?? [])); return a; } };
    } };
    const p = person(module as any, {}, { me: "c1" });
    await p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: from(DAY, WAGE, "Wages for c1") });
    await p.wake(15 * DAY, { transactions: from(15 * DAY, WAGE - 60_000, memo) });
    return outcomes.filter((o) => o.kind === "short" || o.domain === "friction").map((o) => o.kind);
  };
  expect(await seen("Wages for c1")).toEqual(["short", "arose"]);
  expect(await seen("Dividend")).toEqual([]);
  expect(await seen("Refund: 9 goods we couldn't sell you")).toEqual([]);
  // (A payment that says nothing of what it is for is judged by its size, as it was.)
  expect(await seen(undefined)).toEqual(["short", "arose"]);
});

test("a wage the account could not cover on its day is owed in the employer's books, said truthfully, and paid late when the account covers it", () => {
  const id = "shop-1";
  const ctx: any = context(`${id}-manager-system`, id, { premises: id, workplace: `${id}/workplace.1`, suppliers: [], demand: 200, wage: 200_000, respond: { grant_bps: { underpaid: 10_000 } } }, { position: `${id}-manager` });
  ctx.world = { ...ctx.world, dials: { friction_bps: 10_000 } };
  const m = retailer.create(ctx);
  const ids = { n: 0 };
  const own: any[] = [];
  const as = { participant: `${id}-manager-system`, position: `${id}-manager` };
  const at = (t: number, balance: number, records: any[] = [], inbox: any[] = []) => {
    const books = { kind: "accounts", accounts: [{ account: `acc-${id}`, holder: id, custodian: "bank", currency: "AUD", balance: String(balance) }], transactions: [] };
    const before = ids.n;
    const w = wake(m, t, { books, mine: { kind: "records", records: [...own.splice(0), ...records] } }, { entity: id, as, ids, inbox, more: { readings: { J1: { of: "agreement", status: "in_force" } } } });
    own.push(...w.made);
    return { ...w, idOf: (c: any) => `made.${before + w.said.indexOf(c) + 1}` };
  };
  const first = at(DAY, 100_000_000, signed(employment("J1", 0, id, "c1", 200_000)));
  const order = first.said.find((c) => c.fn === "money" && c.args.every && String(c.args.for).startsWith("Wages"))!;
  expect(order.args.amount).toBe("$2000.00");
  const orderId = first.idOf(order);
  // The bank could not pay it on its day: it says so, naming the order. The shop is shown its own order, as the bank keeps it.
  const asRecord = { id: orderId, at: DAY, record: "statement", kind: "request", author: as.participant, speaks_for: id, addressed_to: ["bank"], visible_to: [id, "bank"], basis: "J1",
    data: { outcome: { money: { from: `acc-${id}`, to: "acc-c1", amount: "200000", for: "Wages for c1." } }, every: 14 * DAY } };
  const failed = { from: "bank", re: orderId, text: PAYMENT_FAILED.note("$2,000.00", "acc-c1", orderId) };
  const short = at(15 * DAY, 50_000, [asRecord], [failed]);
  // Nothing in the bank to pay it with: nothing paid, and it stands in the books.
  expect(short.said.filter((c) => c.fn === "money" && /late/.test(String(c.args.for)))).toEqual([]);
  // Asked what is owed under the agreement, its books say the missed pay.
  const asked = at(16 * DAY, 50_000, [{ id: "r1", at: 16 * DAY, record: "statement", kind: "review_request", author: "c1-self", speaks_for: "c1", addressed_to: [id], visible_to: ["c1", id], basis: "J1", text: "r1",
    data: { matter: "underpaid", against: id, about: "J1", amount: 1, account: "acc-c1" } }]);
  const answer = asked.of("statement", "remedy_answer")[0];
  expect(answer === undefined || answer.args.data.granted === false || answer.args.data.amount === 200_000).toBe(true);
  // Money comes in: the missed pay is paid, late, saying what it is, before anything else is done with the money.
  const later = at(18 * DAY, 2_000_000);
  const late = later.said.filter((c) => c.fn === "money" && /late/.test(String(c.args.for)));
  // (Unless asking already had it paid in full, which the test's bank balance did not allow.)
  expect(late.map((c) => [c.args.to, c.args.amount])).toEqual([["acc-c1", "$2000.00"]]);
  expect(String(late[0]!.args.for)).toMatch(/^Wages for c1, late: due /);
  // And once only.
  expect(at(19 * DAY, 2_000_000).said.filter((c) => c.fn === "money" && /late/.test(String(c.args.for)))).toEqual([]);
});

import { Staffing } from "../src/behaviour/firms";

test("what the law gives someone let go for redundancy: redundancy pay by service unless the employer is small, and pay for notice the agreement falls short of; no law, nothing", () => {
  const job = signed(employment("J1", 0, "works-1", "c1", 200_000)); // $2,000 a fortnight: $1,000 a week
  const YEAR = 365 * DAY;
  const staffing = new Staffing(context("works-1-manager-system", "works-1", {}), "works-1", { period: 14 * DAY, notice_days: 14, role: "hand" });
  const withLaw = bookOf(...job, law("law-ending-employment", TERMINATION)), without = bookOf(...job);
  const agreed = (job[0] as any).terms.termination?.find((x: any) => x.party === "works-1")?.notice ?? 0;
  const lieu = Math.max(0, 14 * DAY - agreed) / (7 * DAY); // (two years' service: the law's notice is two weeks)
  // A works of twenty, two years on: six weeks' redundancy pay, and the notice the agreement falls short of.
  expect(staffing.redundancyOwed(withLaw, 2 * YEAR + DAY, job[0], 20).sum).toBe(Math.floor(100_000 * (6 + lieu)));
  // An employer of four owes no redundancy pay under this law.
  expect(staffing.redundancyOwed(withLaw, 2 * YEAR + DAY, job[0], 4).sum).toBe(Math.floor(100_000 * lieu));
  // Under a year: none either way.
  expect(staffing.redundancyOwed(withLaw, 100 * DAY, job[0], 20).sum).toBe(Math.floor(100_000 * Math.max(0, 7 * DAY - agreed) / (7 * DAY)));
  expect(staffing.redundancyOwed(without, 2 * YEAR + DAY, job[0], 20).sum).toBe(0);
});

// Before a dividend (docs/behaviour/firms.md): none while wages are owed in the books or anyone is under notice. Found in the
// fifth living pilot's trace: a factory paid a dividend twenty days after it had given its whole staff notice.
test("nothing is paid to the shareholders while wages are owed; with none owed, the month's earnings above the buffer are", () => {
  const run = (owed: boolean) => {
    const id = "shop-1";
    const ctx: any = context(`${id}-manager-system`, id, { premises: id, workplace: `${id}/workplace.1`, suppliers: [], demand: 20, wage: 200_000 }, { position: `${id}-manager` });
    const m = retailer.create(ctx);
    const ids = { n: 0 };
    const own: any[] = [];
    const as = { participant: `${id}-manager-system`, position: `${id}-manager` };
    const holders = statement("sh", 0, "shareholders", { speaks_for: id, data: { holders: [{ holder: "p1", account: "acc-p1", shares: 10_000 }] } });
    const at = (t: number, balance: number, records: any[] = [], inbox: any[] = []) => {
      const books = { kind: "accounts", accounts: [{ account: `acc-${id}`, holder: id, custodian: "bank", currency: "AUD", balance: String(balance) }], transactions: [] };
      const before = ids.n;
      const w = wake(m, t, { books, mine: { kind: "records", records: [...own.splice(0), ...records] } }, { entity: id, as, ids, inbox, more: { readings: { J1: { of: "agreement", status: "in_force" } } } });
      own.push(...w.made);
      return { ...w, idOf: (c: any) => `made.${before + w.said.indexOf(c) + 1}` };
    };
    const first = at(DAY, 10_000_000, [holders, ...signed(employment("J1", 0, id, "c1", 200_000))]);
    if (owed) {
      const orderId = first.idOf(first.said.find((c) => c.fn === "money" && c.args.every && String(c.args.for).startsWith("Wages"))!);
      const asRecord = { id: orderId, at: DAY, record: "statement", kind: "request", author: as.participant, speaks_for: id, addressed_to: ["bank"], visible_to: [id, "bank"], basis: "J1",
        data: { outcome: { money: { from: `acc-${id}`, to: "acc-c1", amount: "200000", for: "Wages for c1." } }, every: 14 * DAY } };
      at(15 * DAY, 10_000, [asRecord], [{ from: "bank", re: orderId, text: PAYMENT_FAILED.note("$2,000.00", "acc-c1", orderId) }]);
    }
    // A month on, the shop holds far more than it did: the month's earnings.
    const end = at(32 * DAY, 60_000_000);
    return end.said.filter((c) => c.fn === "statement" && c.args.kind === "request" && /dividend/i.test(String(c.args.text)));
  };
  expect(run(false).length).toBe(1);
  expect(run(true)).toEqual([]);
});
