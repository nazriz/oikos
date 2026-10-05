// A tenant's rent orders (docs/behaviour/citizen.md "A rent increase", "Rent the bank couldn't pay"), on what the tenant
// is shown alone, with the bank's own payment system carrying the orders out: after a rent increase, and after a new
// lease on the same home, the new rent is paid on the old one's days from the first after it starts, and the old order
// is stopped after its last payment (two pieces of code, the same rule); and rent the bank says it couldn't pay is paid
// by the tenant as soon as their balance covers it.

import { expect, test } from "bun:test";
import { bankPaymentSystem } from "../src/behaviour/bank";
import { citizen } from "../src/behaviour/citizen";
import { PAYMENT_FAILED } from "../src/behaviour/common";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { context, DAY, employment, lease, MONTH, person, signed, standingOrder, statement, wake, type Said } from "./stepping";

inCurrency(PROFILE.values.currency);

const WAGE = 120_000, RENT = 100_000, NEW_RENT = 105_000, HOME = "apts-1/dwelling.1";
/** A tenant in work, whose rent order was made on `orderAt` and first paid `first` later (then every 30 days). */
const tenancy = (orderAt = 0, first: number | null = 0) => [...signed(lease("L1", 0, "landlord-1", "c1", HOME, RENT)), standingOrder("so-1", orderAt, "c1", "acc-landlord-1", RENT, { basis: "L1", ...(first === null ? {} : { first }) }), ...signed(employment("J1", 0, "factory-1", "c1", WAGE))];
const wages = (t: number) => [{ t: t - DAY, from: "acc-factory-1", to: "acc-c1", amount: String(WAGE), currency: "AUD", by: "bank", memo: "wages" }];
const increase = (id: string, at: number, from: number, rent = NEW_RENT) => statement(id, at, "rent_increase", { author: "landlord-1-office-system", speaks_for: "landlord-1", addressed_to: ["c1"], visible_to: ["landlord-1", "c1"], text: "Notice of rent increase.",
  data: { lease: "L1", rent: String(rent), from, was: String(RENT), last_from: 0 } });
/** A new lease on the same home, offered by the landlord (signed on its side), citing the old one. */
const renewal = (id: string, at: number, rent = NEW_RENT) => { const l = lease(id, at, "landlord-1", "c1", HOME, rent, { basis: "L1" }); return [l, signed(l)[1]]; };
const orders = (said: Said[]) => said.filter((c) => c.fn === "money" && c.args.every).map((c) => ({ ...c.args, bind: c.bind }));
const stops = (said: Said[]) => said.filter((c) => c.fn === "statement" && c.args.withdraw).map((c) => [c.args.withdraw, c.why]);

/**
 * The tenant woken weekly from day 1 to `until`, with what arrives when (`news`: day -> records) and how the old lease
 * reads; and the bank, woken daily, carrying out the orders as the tenant makes and stops them. Returns what the tenant
 * did about its orders, by day, and every rent payment the bank made: [day, cents].
 */
async function run(until: number, o: { orderAt?: number; first?: number | null; news: { [day: number]: any[] }; readings?: (day: number) => object }) {
  const p = person(citizen, {});
  const bank = bankPaymentSystem.create(context("bank-pay-system", "bank", {}, { position: "bank-pay" }));
  const who = { kind: "directory", positions: [], entities: [{ entity: "c1", kind: "person", name: "C", participant: "c1-self" }] };
  const custody = { kind: "accounts", transactions: [], accounts: [{ account: "acc-c1", holder: "c1", custodian: "bank", currency: "AUD", balance: "100000000" }] };
  const start = tenancy(o.orderAt, o.first);
  const acts: { day: number; orders: any[]; stops: any[]; signed: string[] }[] = [];
  const paid: [number, number][] = [];
  let forBank: any[] = start.filter((r: any) => r.kind === "request");
  let n = 0;
  for (let day = 0; day <= until; day++) {
    // The tenant, weekly (day 1, 8, 15...), and on any day something arrives for them.
    if (day % 7 === 1 || o.news[day]) {
      const said = await p.wake(day * DAY, { records: [...(day === 1 ? start : []), ...(o.news[day] ?? [])], readings: { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" }, ...(o.readings?.(day) ?? {}) }, balance: 5_000_000, transactions: wages(day * DAY) });
      if (orders(said).length || stops(said).length) acts.push({ day, orders: orders(said), stops: stops(said), signed: said.filter((c) => c.args.sign).map((c) => c.args.sign) });
      // What the tenant asked of the bank reaches it: each new order as a request made now, each stop as a withdrawal.
      for (const c of said) {
        if (c.fn === "money" && c.args.every) forBank.push(standingOrder(c.id!, day * DAY, "c1", c.args.to, Math.round(Number(String(c.args.amount).replace(/[$,]/g, "")) * 100), { basis: c.args.basis, first: Number(/^(\d+) days$/.exec(c.args.first)![1]) * DAY }));
        if (c.fn === "statement" && c.args.withdraw) forBank.push({ id: `w-${++n}`, at: day * DAY, record: "withdrawal", author: "c1-self", speaks_for: "c1", visible_to: ["c1", "bank"], withdraws: c.args.withdraw });
      }
    }
    // The bank, daily, after the tenant (as in a town: it wakes at the start of each day; the order doesn't matter here,
    // the tenant never acts on a due day's payment before it's made).
    for (const c of wake(bank, day * DAY + 3600, { requests: { kind: "records", records: forBank }, custody, who }, { entity: "bank" }).said) if (c.fn === "money") paid.push([day, Math.round(Number(String(c.args.amount).replace(/[$,]/g, "")) * 100)]);
    forBank = [];
  }
  return { acts, paid };
}
test("after a rent increase the new rent is paid on the old rent's days, from the first after the increase starts, and the old order is stopped once its last payment is made", async () => {
  // Rent is paid on days 0, 30, 60... Notice on day 40 of an increase from day 100.
  const p = person(citizen, {});
  await p.wake(DAY, { records: tenancy(), readings: { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } }, balance: 5_000_000, transactions: wages(DAY) });
  const said = await p.wake(40 * DAY, { records: [increase("inc-1", 40 * DAY, 100 * DAY)], transactions: wages(40 * DAY) });
  // One new order: the new rent, monthly, first due on day 120 (the first of the old rent's days on or after day 100),
  // 80 days from now; the old order is left to run.
  expect(orders(said)).toEqual([{ bind: "so", to: "acc-landlord-1", amount: "$1050.00", from: "acc-c1", every: "30 days", first: "80 days", basis: "L1", for: `Rent for ${HOME}, monthly in advance.` }]);
  expect(stops(said)).toEqual([]);
  expect(said.find((c) => c.bind === "so")!.why).toBe("Our rent goes up to $1,050.00 a month (from $1,000.00): more than a third of household income, but we can bear it (up to $1,285.71), and moving costs too: we'll pay it from when it starts.");
  // The old order's last payment is day 90: it's stopped at the first look after that (from day 91), not before.
  expect(stops(await p.wake(89 * DAY, { transactions: wages(89 * DAY) }))).toEqual([]);
  expect(stops(await p.wake(90 * DAY, { transactions: wages(90 * DAY) }))).toEqual([]);
  expect(stops(await p.wake(91 * DAY, { transactions: wages(91 * DAY) }))).toEqual([["so-1", "The old rent's last payment is made: stopping its order; the new one takes over."]]);
  expect(stops(await p.wake(98 * DAY, { transactions: wages(98 * DAY) }))).toEqual([]);
});

test("after a rent increase, the bank pays rent once every 30 days throughout: the old rent up to the increase, the new from the first payment after it, with no month missed or paid twice", async () => {
  // As above, through the bank: notice on day 40 of an increase from day 100.
  const a = await run(200, { news: { 40: [increase("inc-1", 40 * DAY, 100 * DAY)] } });
  expect(a.paid).toEqual([[0, RENT], [30, RENT], [60, RENT], [90, RENT], [120, NEW_RENT], [150, NEW_RENT], [180, NEW_RENT]]);
  expect(a.acts.map((x) => [x.day, x.orders.length, x.stops.length])).toEqual([[40, 1, 0], [92, 0, 1]]);
  // An increase that starts on one of the rent's days is paid from that day.
  const b = await run(130, { news: { 20: [increase("inc-1", 20 * DAY, 90 * DAY)] } });
  expect(b.paid).toEqual([[0, RENT], [30, RENT], [60, RENT], [90, NEW_RENT], [120, NEW_RENT]]);
  // An order first paid a period after it was made (no `first`), on days 33, 63...: the same rule, on its own days.
  const c = await run(130, { orderAt: 3 * DAY, first: null, news: { 40: [increase("inc-1", 40 * DAY, 70 * DAY)] } });
  expect(c.paid).toEqual([[33, RENT], [63, RENT], [93, NEW_RENT], [123, NEW_RENT]]);
  // Short notice, the increase starting before the old order's next day: the old order is stopped at once, in the same
  // act, and the new rent is paid from that next day.
  const d = await run(100, { news: { 40: [increase("inc-1", 40 * DAY, 45 * DAY)] } });
  expect(d.acts.map((x) => [x.day, x.orders.map((o) => o.first), x.stops.map((s) => s[0])])).toEqual([[40, ["20 days"], ["so-1"]]]);
  expect(d.paid).toEqual([[0, RENT], [30, RENT], [60, NEW_RENT], [90, NEW_RENT]]);
});

test("a new lease on the same home as the old runs out: signed, its rent paid on the old rent's days from the first after the old lease ends, the old order stopped after its last payment", async () => {
  // The old lease ends on day 360; the landlord offers the new one on day 300.
  const ending = (day: number) => ({ L1: { of: "agreement", status: day < 360 ? "in_force" : "ended", ends_at: 360 * DAY, ...(day >= 360 ? { ended_by: "term" } : {}) }, ...(day >= 300 ? { L2: { of: "agreement", status: "in_force", ends_at: 720 * DAY } } : {}) });
  const a = await run(430, { news: { 300: renewal("L2", 300 * DAY) }, readings: ending });
  expect(a.acts.map((x) => [x.day, x.signed, x.orders.map((o) => [o.amount, o.first, o.basis]), x.stops.map((s) => s[0])])).toEqual([
    [300, ["L2"], [["$1050.00", "60 days", "L2"]], []],
    [337, [], [], ["so-1"]],
  ]);
  const months = Array.from({ length: 15 }, (_, i) => i * 30);
  expect(a.paid).toEqual(months.map((d) => [d, d < 360 ? RENT : NEW_RENT]));
  // Offered after the old rent's last payment (day 330): the old order is stopped at once (in an act of its own, after
  // the signing: the rent-increase path stops it in the same act as the new order; otherwise the two follow one rule).
  const b = await run(430, { news: { 340: renewal("L2", 340 * DAY) }, readings: (day) => ({ ...ending(day), ...(day < 340 ? { L2: undefined } : {}) }) });
  expect(b.acts.map((x) => [x.day, x.signed, x.orders.map((o) => o.first), x.stops])).toEqual([[340, ["L2"], ["20 days"], [["so-1", "The old lease's rent is replaced by the new one's."]]]]);
  expect(b.paid).toEqual(months.map((d) => [d, d < 360 ? RENT : NEW_RENT]));
});

test("an increase, then a new lease: each new order takes over from the one before it on the same days", async () => {
  const ending = (day: number) => ({ L1: { of: "agreement", status: day < 360 ? "in_force" : "ended", ends_at: 360 * DAY }, ...(day >= 300 ? { L2: { of: "agreement", status: "in_force", ends_at: 720 * DAY } } : {}) });
  const a = await run(430, { news: { 200: [increase("inc-1", 200 * DAY, 260 * DAY, 102_000)], 300: renewal("L2", 300 * DAY, 104_000) }, readings: ending });
  expect(a.paid).toEqual(Array.from({ length: 15 }, (_, i) => i * 30).map((d) => [d, d < 270 ? RENT : d < 360 ? 102_000 : 104_000]));
});

// ------------------------------------------------------------------ rent the bank couldn't pay

const failed = (id: string, re: string, amount = RENT) => ({ id, from: "bank-pay-system", t: 0, text: PAYMENT_FAILED.note(`${amount} cents`, "acc-landlord-1", re), re });
const madeGood = (said: Said[]) => said.filter((c) => c.fn === "money" && !c.args.every && /missed/.test(c.args.for ?? "")).map((c) => c.args);

test("told by the bank that a rent payment failed, the tenant still owes it: it pays it as soon as its balance covers it, before anything else, oldest first", async () => {
  const p = person(citizen, {});
  const readings = { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } };
  await p.wake(DAY, { records: tenancy(), readings, balance: 50_000, transactions: wages(DAY) });
  // Day 30's rent failed; told on day 31, with $500 in the account: not paid yet.
  expect(madeGood(await p.wake(31 * DAY, { inbox: [failed("m1", "so-1")], balance: 50_000, transactions: wages(31 * DAY) }))).toEqual([]);
  // Day 60's failed too. With $1,500: the older one is paid (the first thing it does), the newer still owed.
  const some = await p.wake(61 * DAY, { inbox: [failed("m2", "so-1")], balance: 150_000, transactions: wages(61 * DAY) });
  expect(madeGood(some)).toEqual([{ to: "acc-landlord-1", amount: "$1000.00", from: "acc-c1", for: "Rent missed (so-1)." }]);
  expect(some[0]).toMatchObject({ fn: "money", why: "The bank couldn't pay the rent ($1,000.00) when it was due: paying it now." });
  // With enough: the other. Then nothing more is owed.
  expect(madeGood(await p.wake(68 * DAY, { balance: 400_000, transactions: wages(68 * DAY) })).length).toBe(1);
  expect(madeGood(await p.wake(75 * DAY, { balance: 400_000, transactions: wages(75 * DAY) }))).toEqual([]);
});

test("only the bank's note of a payment failed for want of money, about one of the tenant's own rent orders, counts as rent missed", async () => {
  const p = person(citizen, {});
  await p.wake(DAY, { records: [...tenancy(), standingOrder("so-dues", 0, "c1", "acc-union", 2_000, { first: 0 })], readings: { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } }, balance: 400_000, transactions: wages(DAY) });
  const notes = [
    // A payment of something else that failed (not the rent's order).
    failed("m1", "so-dues", 2_000),
    // The rent's order, but another of the bank's notes: a payment the world refused, a request it can't carry out.
    { id: "m2", from: "bank-pay-system", t: 0, text: "Payment of 100000 cents to acc-landlord-1 (request so-1) couldn't be made: there's no such account.", re: "so-1" },
    { id: "m3", from: "bank-pay-system", t: 0, text: "Request so-1 not carried out: this bank doesn't keep account acc-c1.", re: "so-1" },
    // Words about failing from someone, citing the order.
    { id: "m4", from: "c9-self", t: 0, text: "Your landlord says your rent failed.", re: "so-1" },
  ];
  expect(madeGood(await p.wake(8 * DAY, { inbox: notes, balance: 400_000, transactions: wages(8 * DAY) }))).toEqual([]);
  // The note itself does.
  expect(madeGood(await p.wake(15 * DAY, { inbox: [failed("m5", "so-1")], balance: 400_000, transactions: wages(15 * DAY) })).length).toBe(1);
});

test("the bank's own words reach the tenant as rent missed: the note the payment system writes is the note the tenant reads", async () => {
  // The bank, with the tenant's order due and the account a cent short.
  const bank = bankPaymentSystem.create(context("bank-pay-system", "bank", {}, { position: "bank-pay" }));
  const who = { kind: "directory", positions: [], entities: [{ entity: "c1", kind: "person", name: "C", participant: "c1-self" }] };
  const custody = { kind: "accounts", transactions: [], accounts: [{ account: "acc-c1", holder: "c1", custodian: "bank", currency: "AUD", balance: String(RENT - 1) }] };
  const note = wake(bank, 0, { requests: { kind: "records", records: [standingOrder("so-1", 0, "c1", "acc-landlord-1", RENT, { basis: "L1", first: 0 })] }, custody, who }, { entity: "bank" }).said;
  expect(note.map((c) => c.fn)).toEqual(["message"]);
  expect(note[0]!.args.to).toEqual(["c1"]);
  const p = person(citizen, {});
  await p.wake(DAY, { records: tenancy(), readings: { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } }, balance: RENT - 1, transactions: wages(DAY) });
  const said = await p.wake(2 * DAY, { inbox: [{ id: "m1", from: "bank-pay-system", t: DAY, text: note[0]!.args.text, re: note[0]!.args.re }], balance: 300_000, transactions: wages(2 * DAY) });
  expect(madeGood(said)).toEqual([{ to: "acc-landlord-1", amount: "$1000.00", from: "acc-c1", for: "Rent missed (so-1)." }]);
});
