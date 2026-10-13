// Hours before heads (docs/behaviour/firms.md, "Hours before heads"): the hours term of an agreement; the law on
// cutting hours as a record the world publishes; a shop that meets a surplus of hands by cutting hours, through a
// paper to each worker; and a worker who reads such a paper as the pay agreed and not as pay come short. The laws'
// figures here are the test's own.

import { expect, test } from "bun:test";
import { citizen } from "../src/behaviour/citizen";
import { Book, jobTerms, offer } from "../src/behaviour/common";
import { hoursLaw, ordinaryHours, paidShare, Staffing } from "../src/behaviour/firms";
import { retailer } from "../src/behaviour/retailer";
import { inCurrency } from "../src/money";
import { OUTCOMES } from "../src/module";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { context, DAY, employment, lease, person, signed, standingOrder, statement, wake } from "./stepping";

inCurrency(PROFILE.values.currency);
const law = (data: object) => statement("law-cutting-hours", 0, "law", { speaks_for: "outside", data: { employment: "hours", ordinary_week_hours: 40, ...data } });
const bookOf = (...records: any[]) => {
  const b = new Book();
  b.absorb({ t: 0, entity: "x", participant: "x", channels: { mine: { kind: "records", records } }, inbox: [], outcomes: [], woke_for: "cadence" } as any);
  return b;
};

test("the law on cutting hours is read from the world's record; no such law, no cutting; a share is never over the whole; paid for hours cut is added to hours worked", () => {
  expect(hoursLaw(bookOf())).toBeUndefined();
  const l = hoursLaw(bookOf(law({ may_cut: "notice", notice_days: 7, floor_bps: 6_000, max_days: 90, pay_bps: 5_000, pay_owed_from: 50, consent_bps: 12_000 })))!;
  expect(l).toMatchObject({ id: "law-cutting-hours", may_cut: "notice", ordinary_week_hours: 40, notice_days: 7, floor_bps: 6_000, max_days: 90, pay_bps: 5_000, pay_owed_from: 50, consent_bps: 10_000 });
  expect(hoursLaw(bookOf(law({ may_cut: "whenever" })))!.may_cut).toBe("no");
  // 60% of the hours, and half pay for the 40% cut: 80% of the pay.
  expect(paidShare(6_000, 5_000)).toBe(8_000);
  expect(paidShare(6_000, 0)).toBe(6_000);
  expect(paidShare(10_000, 6_000)).toBe(10_000);
});

test("an agreement's hours term is the other side's commitment to work them; with none, the ordinary week is the law's; offered through the call language", () => {
  const job = employment("J1", 0, "shop-1", "c1", 200_000);
  expect(jobTerms(job as any, "c1").hours).toBeUndefined();
  const withHours = { ...job, terms: { ...job.terms, commitments: [...job.terms.commitments, { who: "c1", does: { outcome: { work: { task: "ordinary_hours", hours: 38 * 3600 } } }, every: 7 * DAY }] } };
  expect(jobTerms(withHours as any, "c1")).toMatchObject({ wage: 200_000, hours: 38 * 3600 });
  const l = hoursLaw(bookOf(law({ may_cut: "notice" })));
  expect(ordinaryHours(withHours, "c1", l)).toBe(38);
  expect(ordinaryHours(job, "c1", l)).toBe(40);
  expect(ordinaryHours(job, "c1", undefined)).toBe(0);
  const c = offer("c1", { template: "employment", hours: 38 * 3600 });
  expect(c.args.hours).toEqual({ text: "136800 seconds" });
});

// ---------------------------------------------------------------- the shop

const WAGE = 200_000;
function shop(hoursLawData: object | undefined, params: object = {}) {
  const id = "shop-1";
  const ctx: any = context(`${id}-manager-system`, id, { premises: id, workplace: `${id}/workplace.1`, suppliers: [], demand: 200, wage: WAGE, min_staff: 1, ...params }, { position: `${id}-manager` });
  const m = retailer.create(ctx);
  const own: any[] = [];
  const as = { participant: `${id}-manager-system`, position: `${id}-manager` };
  const ids = { n: 0 };
  return (t: number, records: any[] = []) => {
    const books = { kind: "accounts", accounts: [{ account: `acc-${id}`, holder: id, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: [] };
    const w = wake(m, t, { books, mine: { kind: "records", records: [...own.splice(0), ...records] } }, { entity: id, as, ids, more: { readings: Object.fromEntries([1, 2, 3, 4].map((i) => [`J${i}`, { of: "agreement", status: "in_force" }])) } });
    own.push(...w.made);
    return w;
  };
}
const staffOf = (n: number) => [1, 2, 3, 4].slice(0, n).flatMap((i) => [...signed(employment(`J${i}`, 0, "shop-1", `c${i}`, WAGE)), standingOrder(`so-${i}`, 0, "shop-1", `acc-c${i}`, WAGE, { basis: `J${i}`, first: 14 * DAY, every: 14 * DAY })]);
const orders = (w: { said: any[] }) => w.said.filter((c) => c.fn === "money" && c.args.every && String(c.args.for).startsWith("Wages"));

/** Day by day until the shop does something about its four hands at its month's end: its papers and notices that day. */
function untilReview(at: ReturnType<typeof shop>, records: any[]) {
  const seen = { notices: [] as any[], gave: [] as any[], day: 0 };
  for (let d = 1; d <= 100 && !seen.notices.length && !seen.gave.length; d++) {
    const w = at(d * DAY, d === 1 ? records : []);
    seen.notices.push(...w.of("statement", "hours_notice"));
    seen.gave.push(...w.said.filter((c) => c.fn === "agreement" && c.args.notice));
    seen.day = d;
  }
  return seen;
}

test("a shop with hands to spare cuts everyone's hours before it lets anyone go, where the law lets it: a paper to each, and their pay follows on the paper's day", () => {
  const records = [law({ may_cut: "notice", notice_days: 7, floor_bps: 2_000, pay_bps: 0 }), ...staffOf(4)];
  const at = shop(undefined, { demand: 200 });
  const r = untilReview(at, records);
  expect(r.gave).toEqual([]);
  expect(r.notices.length).toBe(4);
  const n = r.notices[0]!.args;
  expect(n.visible).toEqual(["shop-1", n.to[0]]);
  const bps = n.data.hours_bps as number;
  expect(n.data).toMatchObject({ employer: "shop-1", consent: false, was: WAGE, law: "law-cutting-hours" });
  expect(bps).toBeLessThan(10_000);
  expect(bps).toBeGreaterThanOrEqual(2_000);
  expect(n.data.wage).toBe(Math.floor((WAGE * bps) / 10_000));
  expect(n.data.from - r.day * DAY).toBe(7 * DAY);
  // Before the paper's day the wage orders stand; after it each is replaced by one at the cut wage (less what is withheld).
  const net = (g: number) => g; // (no tax law in this world: nothing is withheld)
  expect(orders(at((r.day + 3) * DAY))).toEqual([]);
  const later = orders(at((r.day + 8) * DAY));
  expect(later.map((c) => c.args.amount)).toEqual(Array(4).fill(`$${(net(n.data.wage) / 100).toFixed(2)}`));
});

test("where the law lets it be done only with the worker's agreement, the shop asks and waits: the wage changes for those who agree, and no one else is paid less", () => {
  const records = [law({ may_cut: "consent", notice_days: 0, consent_bps: 10_000 }), ...staffOf(4)];
  const at = shop(undefined, { demand: 200 });
  const r = untilReview(at, records);
  expect(r.notices.length).toBe(4);
  expect(r.notices[0]!.args.data.consent).toBe(true);
  // Nothing changes without an answer.
  expect(orders(at((r.day + 5) * DAY))).toEqual([]);
  // Two agree and two do not (one never answers).
  const reply = (i: number, agree: boolean) => statement(`rep-${i}`, (r.day + 5) * DAY, "hours_reply", { speaks_for: `c${i}`, addressed_to: ["shop-1"], visible_to: [`c${i}`, "shop-1"], data: { agreement: `J${i}`, agree } });
  at((r.day + 6) * DAY, [reply(1, true), reply(2, true), reply(3, false)]);
  const changed = orders(at((r.day + 12) * DAY));
  expect(changed.length).toBe(2);
});

test("a world with no such law, or one that says employers may not, cuts nobody's hours: the shop lets its hands go as it always did", () => {
  for (const records of [[...staffOf(4)], [law({ may_cut: "no" }), ...staffOf(4)]]) {
    const at = shop(undefined, { demand: 200 });
    let notices = 0;
    for (let d = 1; d <= 130; d++) notices += at(d * DAY, d === 1 ? records : []).of("statement", "hours_notice").length;
    expect(notices).toBe(0);
  }
});

// ---------------------------------------------------------------- the worker

const HOME = "apts-1/dwelling.1", RENT = 100_000;
const life = () => [...signed(lease("L1", 0, "landlord-1", "c1", HOME, RENT)), standingOrder("so-1", 0, "c1", "acc-landlord-1", RENT, { basis: "L1", first: 0 }), ...signed(employment("J1", 0, "factory-1", "c1", WAGE))];
const READ = { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } };
const paid = (t: number, amount: number, order = "wo-1") => [{ t: t - DAY, from: "acc-factory-1", to: "acc-c1", amount: String(amount), currency: "AUD", by: "bank", memo: "wages", per_instruction: order }];
const ACTS = { initiative: true, wants: { choice: { trust: 0, own: 100_000, agency: 0, fear: 0, others: 0, belief: 0 } } };
function watched(params: object) {
  const outcomes: any[] = [];
  const module = { create: (ctx: any) => {
    ctx.world = { ...ctx.world, dials: { ...(ctx.world?.dials ?? {}), friction_bps: 10_000 } };
    const m = citizen.create(ctx);
    return { step: async (o: any, c: any) => { const a: any = await m.step(o, c); outcomes.push(...(a[OUTCOMES] ?? [])); return a; } };
  } };
  return { p: person(module, params, { seed: 1n }), outcomes };
}
const notice = (kind: string, at: number, data: object) => statement(`n-${kind}-${at}`, at, kind, { speaks_for: "factory-1", addressed_to: ["c1"], visible_to: ["c1", "factory-1"], basis: "J1", data: { employer: "factory-1", agreement: "J1", ...data } });

test("a cut the employer's paper told of is the pay agreed, and pay at the cut is not pay come short; the same pay with no paper is short", async () => {
  const cut = WAGE / 2;
  // With the paper (a cut to half, from day 10).
  const told = watched(ACTS);
  await told.p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE) });
  await told.p.wake(3 * DAY, { records: [notice("hours_notice", 2 * DAY, { hours_bps: 5_000, minutes_week: 1_200, wage: cut, was: WAGE, from: 10 * DAY, consent: false })] });
  await told.p.wake(16 * DAY, { transactions: paid(16 * DAY, cut) });
  expect(told.outcomes.filter((o) => o.domain === "job" && o.kind === "hours_cut").map((o) => o.facts.wage)).toEqual([cut]);
  expect(told.outcomes.some((o) => o.kind === "short" || o.domain === "friction")).toBe(false);
  expect(told.outcomes.filter((o) => o.domain === "job" && o.kind === "paid").map((o) => [o.facts.amount, o.facts.agreed])).toContainEqual([cut, cut]);
  // The old pay arriving a day or two after the paper's day (the employer changes the order on a day of its own) is still pay agreed.
  const late = watched(ACTS);
  await late.p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE) });
  await late.p.wake(3 * DAY, { records: [notice("hours_notice", 2 * DAY, { hours_bps: 5_000, minutes_week: 1_200, wage: cut, was: WAGE, from: 10 * DAY, consent: false })] });
  await late.p.wake(12 * DAY, { transactions: paid(12 * DAY, WAGE) });
  expect(late.outcomes.some((o) => o.kind === "short" || o.domain === "friction")).toBe(false);
  // Without the paper: the same cut is pay come short.
  const none = watched(ACTS);
  await none.p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE) });
  await none.p.wake(16 * DAY, { transactions: paid(16 * DAY, cut) });
  expect(none.outcomes.filter((o) => o.domain === "job" && o.kind === "short").map((o) => o.facts.short)).toEqual([WAGE - cut]);
  // A paper about someone else's job, or another employer's, is no paper of ours.
  const other = watched(ACTS);
  await other.p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE) });
  await other.p.wake(3 * DAY, { records: [notice("hours_notice", 2 * DAY, { agreement: "J9", hours_bps: 5_000, wage: cut, from: 10 * DAY, consent: false })] });
  await other.p.wake(16 * DAY, { transactions: paid(16 * DAY, cut) });
  expect(other.outcomes.filter((o) => o.kind === "short").length).toBe(1);
});

test("asked to agree to a cut, a worker answers by a paper of their own, and the cut is theirs only if they agree; hours restored by a paper put the pay back", async () => {
  const cut = WAGE / 2;
  const asked = (consent_bps: number) => notice("hours_notice", 2 * DAY, { hours_bps: 5_000, minutes_week: 1_200, wage: cut, was: WAGE, from: 10 * DAY, consent: true, consent_bps });
  const yes = watched(ACTS);
  await yes.p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE) });
  const said = await yes.p.wake(3 * DAY, { records: [asked(10_000)] });
  expect(said.filter((c) => c.fn === "statement" && c.args.kind === "hours_reply").map((c) => [c.args.to, c.args.data.agree, c.args.data.agreement])).toEqual([[["factory-1"], true, "J1"]]);
  await yes.p.wake(16 * DAY, { transactions: paid(16 * DAY, cut) });
  expect(yes.outcomes.some((o) => o.kind === "short")).toBe(false);
  expect(yes.outcomes.filter((o) => o.kind === "hours_agreed").length).toBe(1);
  // Restored: the pay is the whole wage again from the paper's day.
  await yes.p.wake(20 * DAY, { records: [notice("hours_restored", 19 * DAY, { wage: WAGE, from: 22 * DAY })] });
  await yes.p.wake(31 * DAY, { transactions: paid(31 * DAY, WAGE, "wo-2") });
  expect(yes.outcomes.some((o) => o.kind === "short")).toBe(false);
  expect(yes.outcomes.filter((o) => o.kind === "hours_restored").length).toBe(1);
  // One who does not agree says so, and is paid the whole wage; a cut over their refusal would be short pay.
  const no = watched(ACTS);
  await no.p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE) });
  const refused = await no.p.wake(3 * DAY, { records: [asked(0)] });
  expect(refused.filter((c) => c.args.kind === "hours_reply").map((c) => c.args.data.agree)).toEqual([false]);
  await no.p.wake(16 * DAY, { transactions: paid(16 * DAY, cut) });
  expect(no.outcomes.filter((o) => o.kind === "short").length).toBe(1);
});

test("Staffing is exported with the hours reading (the module-level pieces the shops and factories use)", () => {
  expect(typeof Staffing.prototype.reviewHours).toBe("function");
  expect(typeof Staffing.prototype.hoursBpsAt).toBe("function");
});
