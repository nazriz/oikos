// Trade credit (docs/behaviour/trade.md, "Trade credit"): a buyer orders on the seller's stated terms and pays after the
// goods are in; a seller that is not paid stops supplying on terms and, later, records the debt against the buyer (the
// debt insolvency reads). The figures here are the tests' own.

import { expect, test } from "bun:test";
import { Book } from "../src/behaviour/common";
import { Borrowing } from "../src/behaviour/credit";
import { OrderBook, Payables, fill, type Order } from "../src/behaviour/trade";
import { producer } from "../src/behaviour/producer";
import { retailer } from "../src/behaviour/retailer";
import { inCurrency } from "../src/money";
import { context, DAY, employment, signed, statement, wake } from "./stepping";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

inCurrency(PROFILE.values.currency);

const TERMS = { days: 30, stop_after_days: 7, claim_after_days: 30 };
const obsOf = (t: number, entity: string, o: { records?: any[]; transactions?: any[]; account?: string } = {}): any => ({ t, entity, participant: "x", inbox: [], outcomes: [], woke_for: "cadence",
  channels: { mine: { kind: "records", records: o.records ?? [] }, books: { kind: "accounts", accounts: o.account ? [{ account: o.account, holder: entity, custodian: "bank", currency: "AUD", balance: "0" }] : [], transactions: o.transactions ?? [] } } });
const bookOf = (...records: any[]) => { const b = new Book(); b.absorb(obsOf(0, "x", { records })); return b; };
const order = (id: string, at: number, buyer: string, seller: string, data: object) => statement(id, at, "order", { speaks_for: buyer, addressed_to: [seller], visible_to: [buyer, seller],
  data: { kind: "goods", quantity: 100, unit_price: 1_000, deliver_to: buyer, at: buyer, account: `acc-${buyer}`, ...data } });
const tx = (t: number, from: string, to: string, amount: number, memo: string, x: object = {}) => ({ t, from, to, amount: String(amount), currency: "AUD", by: "bank", memo, ...x });

test("an order on terms is supplied against the buyer's promise, with nothing paid; the delivery note is the invoice", () => {
  const book = bookOf(order("o1", 0, "shop-1", "factory-1", { pay_in_days: 30 }));
  const orders = new OrderBook("factory-1", undefined, TERMS);
  orders.take(obsOf(DAY, "factory-1", { account: "acc-factory-1" }), "acc-factory-1");
  const { paid, stopped } = orders.due(book, DAY);
  expect(paid.map((o) => o.id)).toEqual(["o1"]);
  expect(paid[0]!.terms).toBe(30);
  expect(stopped).toEqual([]);
  const filled = fill(paid[0]!, 60, "factory-1", "acc-factory-1", "delivering");
  const note = filled.map((x: any) => (Array.isArray(x) ? x[1] : x)).find((c: any) => c.fn === "statement" && c.args.kind?.text === "delivery_note" || c.fn === "statement");
  expect(JSON.stringify(filled)).toContain("owed");
  expect(JSON.stringify(filled)).not.toContain("Refund"); // (short of stock: nothing was paid, so nothing is refunded)
  expect(note).toBeDefined();
});

test("a seller with no terms of its own does not supply an order on terms: it waits for a payment that does not come, and is declined", () => {
  const book = bookOf(order("o1", 0, "shop-1", "factory-1", { pay_in_days: 30 }));
  const orders = new OrderBook("factory-1");
  expect(orders.due(book, DAY).paid).toEqual([]);
  expect(orders.due(book, 8 * DAY).unpaid.map((o) => o.id)).toEqual(["o1"]);
});

test("paying an invoice settles it: the payment is not taken as an order's, and is not refunded", () => {
  const book = bookOf(order("o1", 0, "shop-1", "factory-1", { pay_in_days: 30 }));
  const orders = new OrderBook("factory-1", undefined, TERMS);
  const o = orders.due(book, DAY).paid[0]!;
  orders.bill(o, 100, DAY);
  expect(orders.owedTo().map((r) => r.amount)).toEqual([100_000]);
  orders.take(obsOf(31 * DAY, "factory-1", { account: "acc-factory-1", transactions: [tx(31 * DAY, "acc-shop-1", "acc-factory-1", 100_000, "Invoice o1: 100 goods.")] }), "acc-factory-1");
  expect(orders.owedTo()).toEqual([]);
  expect(orders.unclaimed(book)).toEqual([]);
});

test("a buyer past its day by the stop days is supplied on terms no more; paying ends it", () => {
  const book = bookOf(order("o2", 40 * DAY, "shop-1", "factory-1", { pay_in_days: 30 }), order("o3", 40 * DAY, "shop-2", "factory-1", { pay_in_days: 30 }));
  const orders = new OrderBook("factory-1", undefined, TERMS);
  orders.bill({ id: "o1", seller: "factory-1", buyer: "shop-1", kind: "goods", quantity: 100, unitPrice: 1_000, to: "shop-1", at: "shop-1", account: "acc-shop-1", placed: 0, terms: 30 } as Order, 100, 0);
  expect(orders.stopped("acc-shop-1", 36 * DAY)).toBe(false); // (the day, and a week's grace)
  expect(orders.stopped("acc-shop-1", 38 * DAY)).toBe(true);
  const r = orders.due(book, 40 * DAY);
  expect(r.stopped.map((o) => o.id).sort()).toEqual(["o2"]); // (shop-1's; shop-2 is supplied)
  expect(r.paid.map((o) => o.id)).toContain("o3"); // (another buyer is supplied)
});

test("unpaid long enough, the debt is recorded against the buyer, and its payment settles that claim, not an order", () => {
  const orders = new OrderBook("factory-1", undefined, TERMS);
  orders.bill({ id: "o1", seller: "factory-1", buyer: "shop-1", kind: "goods", quantity: 100, unitPrice: 1_000, to: "shop-1", at: "shop-1", account: "acc-shop-1", placed: 0, terms: 30 } as Order, 100, 0);
  expect(orders.collect(59 * DAY, "acc-factory-1")).toEqual([]);
  const steps = orders.collect(61 * DAY, "acc-factory-1");
  expect(steps.length).toBe(1);
  const [bound, call]: any = (steps[0] as any[])[0];
  expect(bound).toBe("claim"); // (named, so the world's answer carries the claim's id: a payment settling it is then known)
  expect(call.fn).toBe("claim");
  expect(call.args.against.id ?? call.args.against).toBe("shop-1");
  expect(call.args.basis.id ?? call.args.basis).toBe("o1");
  expect(JSON.stringify(call.args.about)).toContain("\"debt\"");
  expect(orders.collect(70 * DAY, "acc-factory-1")).toEqual([]); // (once)
  steps[0]!.then?.({ action: "a", t: 61 * DAY, status: "applied", created: { claim: "c9" } } as any);
  expect(orders.stopped("acc-shop-1", 62 * DAY)).toBe(true);
  orders.take(obsOf(65 * DAY, "factory-1", { account: "acc-factory-1", transactions: [tx(65 * DAY, "acc-shop-1", "acc-factory-1", 100_000, "Paying debt c9.", { settles: "c9" })] }), "acc-factory-1");
  expect(orders.stopped("acc-shop-1", 66 * DAY)).toBe(false);
});

test("a buyer pays an invoice on its day, wages first, and no sooner", () => {
  const note = statement("n1", 2 * DAY, "delivery_note", { speaks_for: "factory-1", addressed_to: ["shop-1"], data: { order: "o1", kind: "goods", ordered: 100, delivered: 100, refund: 0, owed: 100_000, pay_in_days: 30, pay_to: "acc-factory-1" } });
  const p = new Payables("shop-1");
  p.take(bookOf(note));
  expect(p.owing).toBe(100_000);
  expect(p.pay(31 * DAY, "acc-shop-1", 1_000_000, 0)).toEqual([]);
  expect(p.pay(33 * DAY, "acc-shop-1", 150_000, 100_000)).toEqual([]); // (the wages would be short)
  expect(p.behind("factory-1", 33 * DAY)).toBe(true);
  expect(p.behind("factory-2", 33 * DAY)).toBe(false);
  const paid = p.pay(33 * DAY, "acc-shop-1", 1_000_000, 100_000);
  expect(paid.length).toBe(1);
  expect(JSON.stringify(paid)).toContain("Invoice o1");
  expect(p.owing).toBe(0);
});

test("an invoice the seller has recorded as a debt is paid as a debt, not twice", () => {
  const note = statement("n1", 2 * DAY, "delivery_note", { speaks_for: "factory-1", addressed_to: ["shop-1"], data: { order: "o1", kind: "goods", ordered: 100, delivered: 100, refund: 0, owed: 100_000, pay_in_days: 30, pay_to: "acc-factory-1" } });
  const claim = { id: "c9", at: 70 * DAY, record: "claim", position: "right", holder: "factory-1", counterparty: "shop-1", about: { kind: "debt", amount: "1000.00" }, basis: "o1", visible_to: ["shop-1", "factory-1"] };
  const p = new Payables("shop-1");
  p.take(bookOf(note, claim));
  expect(p.owing).toBe(0);
});

// ---- the buyers

const WAGE = 300_000, STAFF = 4;
const list = (seller: string, data: object) => statement(`list-${seller}`, 0, "price_list", { speaks_for: seller, data: { account: `acc-${seller}`, ...data } });

/** A works with the supplier's inputs priced 250 a unit (on 30 days' terms, or not), woken once: the order it places and whether it pays with it. */
function works(o: { balance: number; terms?: number; credit?: boolean; export?: number; price?: number; inputs?: number; extra?: object; behind?: boolean; records?: any[] }) {
  const AS = { participant: "works-manager-system", position: "works-manager" };
  const m = producer.create(context(AS.participant, "works", { works: "works", workplace: "works/workplace.1", max_staff: 10, wage: WAGE, per_unit: { inputs: 20 }, labour_per_unit: 3600, price: o.price ?? 10_000, supplier: "outside", market: "outside",
    ...(o.credit === false ? { credit: false } : {}), ...o.extra }, { position: AS.position }));
  const staff = Array.from({ length: STAFF }, (_, i) => signed(employment(`job-${i + 1}`, i + 1, "works", `worker-${i + 1}`, WAGE))).flat();
  const offer = o.export !== undefined ? [statement("offer", 0, "buying_offer", { speaks_for: "outside", visible_to: "public", data: { kind: "goods", unit_price: o.export, quantity: 1_000, quantities: { works: 1_000 }, until: 40 * DAY } })] : [];
  const w = wake(m, 10 * DAY, {
    books: { kind: "accounts", accounts: [{ account: "acc-works", holder: "works", custodian: "bank", currency: "AUD", balance: String(o.balance) }], transactions: [] },
    mine: { kind: "records", records: [...staff, ...offer, list("outside", { goods: { inputs: 250 }, min_order: 100, ...(o.terms ? { terms_days: o.terms } : {}) }), ...(o.records ?? [])] },
    stock: { kind: "holdings", holdings: [{ holder: "works", at: "works", kind: "inputs", quantity: String(o.inputs ?? 0) }] },
  }, { entity: "works", as: AS });

  return { order: w.of("statement", "order")[0], paid: w.of("money").filter((c) => !c.args.every), w };
}

test("a works short of money for inputs orders them on the supplier's terms, with nothing paid, and keeps its wages", () => {
  const cash = works({ balance: STAFF * WAGE + 10 * 250 }); // (pays for ten units beyond the wages)
  expect(cash.order?.args.data.quantity ?? 0).toBeLessThan(100); // (cash with order: at most what it can pay)
  const termed = works({ balance: STAFF * WAGE + 10 * 250, terms: 30 });
  expect(termed.order?.args.data.pay_in_days).toBe(30);
  expect(termed.order?.args.data.quantity).toBeGreaterThan(100);
  expect(termed.paid.length).toBe(0);
});

test("a works that does not take credit, or is behind with its supplier, pays with the order", () => {
  expect(works({ balance: 100_000_000, terms: 30, credit: false }).order?.args.data.pay_in_days).toBeUndefined();
  expect(works({ balance: 100_000_000, terms: 30, credit: false }).paid.length).toBe(1);
  const late = statement("n0", DAY, "delivery_note", { speaks_for: "outside", addressed_to: ["works"], data: { order: "o0", kind: "inputs", ordered: 100, delivered: 100, refund: 0, owed: 25_000, pay_in_days: 5, pay_to: "acc-outside" } });
  // Behind with its supplier and unable to pay it (wages first): no more on terms, and with the cash left, too little to order.
  const behind = works({ balance: STAFF * WAGE + 1_000, terms: 30, records: [late] });
  expect(behind.order).toBeUndefined();
  expect(behind.paid.length).toBe(0);
  // With the money it pays the invoice that has fallen due, and is no longer behind: its next order is on terms again.
  const caught = works({ balance: 100_000_000, terms: 30, records: [late] });
  expect(caught.paid.some((c) => /Invoice o0/.test(String(c.args.for)))).toBe(true);
  expect(caught.order?.args.data.pay_in_days).toBe(30);
});

test("inputs are bought to what can be sold, not to what the staff could make", () => {
  // A trade of 300 units a month (last month's orders) against a month's capacity of several thousand.
  const none = works({ balance: 100_000_000, export: 10_000 });
  const capacity = Math.floor((STAFF * 28_800 * 5 * 30) / 7 / 3600);
  expect(capacity).toBeGreaterThan(300);
  expect((none.order?.args.data.quantity as number) ?? 0).toBeGreaterThan(0);
  expect((none.order?.args.data.quantity as number)).toBeLessThanOrEqual(Math.floor(capacity * 20 * 3 / 2));
});

test("a works whose goods fetch less than their inputs cost buys no inputs, and takes nobody on to make them", () => {
  // Inputs cost 250 each, 20 to a unit: 5,000 a unit. The world market pays 4,000 and nobody orders at home: a unit loses 1,000 before a wage.
  const losing = works({ balance: 100_000_000, export: 4_000, price: 4_000 });
  expect(losing.order).toBeUndefined();
  expect(losing.w.of("statement", "job_posting").length).toBe(0);
  // At 6,000 a unit it buys.
  expect(works({ balance: 100_000_000, export: 6_000, price: 6_000 }).order).toBeDefined();
});

/** A shop with no stock, woken once, buying from one factory that states terms or not. */
function shop(o: { balance: number; terms?: number; credit?: boolean; records?: any[] }) {
  const AS = { participant: "shop-1-manager-system", position: "shop-1-manager" };
  const m = retailer.create(context(AS.participant, "shop-1", { premises: "shop-1", workplace: "shop-1/workplace.1", suppliers: ["factory-1"], demand: 200, wage: WAGE, ...(o.credit === false ? { credit: false } : {}) }, { position: AS.position }));
  const staff = signed(employment("job-1", 1, "shop-1", "worker-1", WAGE)).flat();
  const w = wake(m, DAY, {
    books: { kind: "accounts", accounts: [{ account: "acc-shop-1", holder: "shop-1", custodian: "bank", currency: "AUD", balance: String(o.balance) }], transactions: [] },
    mine: { kind: "records", records: [...staff, list("factory-1", { goods: { goods: 1_000 }, min_order: 50, ...(o.terms ? { terms_days: o.terms } : {}) }), ...(o.records ?? [])] },
  }, { entity: "shop-1", as: AS });
  return { order: w.of("statement", "order")[0], paid: w.of("money").filter((c) => !c.args.every), w };
}

test("a shop that has little beyond a pay period's wages orders its stock on the factory's terms, and pays nothing now", () => {
  const cash = shop({ balance: WAGE + 5_000 });
  expect(cash.order).toBeUndefined(); // (all but the wages is nothing: no stock is bought)
  const termed = shop({ balance: WAGE + 5_000, terms: 30 });
  expect(termed.order?.args.data.pay_in_days).toBe(30);
  expect(termed.paid.length).toBe(0);
  expect(termed.order?.args.data.quantity).toBeGreaterThanOrEqual(50);
});

test("a shop that does not take credit pays with its order", () => {
  const r = shop({ balance: 100_000_000, terms: 30, credit: false });
  expect(r.order?.args.data.pay_in_days).toBeUndefined();
  expect(r.paid.length).toBe(1);
});

// ---- more than one loan

test("a firm repaying a loan may apply for another a while after the last was granted, where it is allowed; otherwise one at a time", () => {
  const decided = (id: string, t: number) => bookOf(statement(id, t, "loan_decision", { speaks_for: "bank", addressed_to: ["f"], data: { approved: true, months: 12 } }));
  const one = new Borrowing("f", "bank");
  const many = new Borrowing("f", "bank", { again_days: 30 });
  for (const b of [one, many]) b.steps(decided("d1", 5 * DAY), 5 * DAY, undefined);
  expect([one.canApply(20 * DAY), many.canApply(20 * DAY)]).toEqual([false, false]); // (the money is not long in, and the bank's word is awaited)
  expect([one.canApply(40 * DAY), many.canApply(40 * DAY)]).toEqual([false, true]);
  // A refusal stops it asking again for the retry days, as before.
  many.steps(bookOf(statement("d2", 40 * DAY, "loan_decision", { speaks_for: "bank", addressed_to: ["f"], data: { approved: false } })), 40 * DAY, undefined);
  expect(many.canApply(60 * DAY)).toBe(false);
  expect(many.canApply(101 * DAY)).toBe(true);
});

test("told it is supplied on terms no more, a buyer asks that seller for none for a while, then tries again", () => {
  const note = statement("n2", 40 * DAY, "delivery_note", { speaks_for: "factory-1", addressed_to: ["shop-1"], data: { order: "o9", kind: "goods", ordered: 100, delivered: 0, refund: 0, declined: "overdue" } });
  const p = new Payables("shop-1");
  p.take(bookOf(note));
  expect(p.behind("factory-1", 41 * DAY)).toBe(true);
  expect(p.behind("factory-2", 41 * DAY)).toBe(false);
  expect(p.behind("factory-1", 71 * DAY)).toBe(false);
});

test("a dividend leaves the money the shop's invoices are paid from", () => {
  const dividend = (owing: number) => {
    const AS = { participant: "shop-1-manager-system", position: "shop-1-manager" };
    const m = retailer.create(context(AS.participant, "shop-1", { premises: "shop-1", workplace: "shop-1/workplace.1", suppliers: [], demand: 20, wage: WAGE }, { position: AS.position }));
    const holders = statement("sh", 0, "shareholders", { speaks_for: "shop-1", data: { holders: [{ holder: "p1", account: "acc-p1", shares: 10_000 }] } });
    const note = statement("n1", 20 * DAY, "delivery_note", { speaks_for: "factory-1", addressed_to: ["shop-1"], data: { order: "o1", kind: "goods", ordered: 100, delivered: 100, refund: 0, owed: owing, pay_in_days: 30, pay_to: "acc-factory-1" } });
    const staff = signed(employment("J1", 0, "shop-1", "c1", WAGE)).flat();
    const at = (t: number, balance: number, records: any[]) => wake(m, t, {
      books: { kind: "accounts", accounts: [{ account: "acc-shop-1", holder: "shop-1", custodian: "bank", currency: "AUD", balance: String(balance) }], transactions: [] },
      mine: { kind: "records", records } }, { entity: "shop-1", as: AS, more: { readings: { J1: { of: "agreement", status: "in_force" } } } });
    at(DAY, 10_000_000, [holders, ...staff]);
    const end = at(32 * DAY, 60_000_000, owing ? [note] : []);
    const req = end.said.find((c) => c.fn === "statement" && c.args.kind === "request" && /dividend/i.test(String(c.args.text)));
    return ((req?.args.data?.payments ?? []) as { amount: string }[]).reduce((x, p) => x + Number(String(p.amount).replace(/[^0-9.]/g, "")) * 100, 0);
  };
  const free = dividend(0), owing = dividend(20_000_000);
  expect(free).toBeGreaterThan(0);
  expect(owing).toBeLessThan(free);
  expect(free - owing).toBeGreaterThanOrEqual(19_000_000);
});

test("a firm closing or winding up pays every invoice it owes, due or not, oldest first, while its account covers them", () => {
  const note = (id: string, at: number, owed: number) => statement(id, at, "delivery_note", { speaks_for: "factory-1", addressed_to: ["shop-1"], data: { order: id, kind: "goods", ordered: 10, delivered: 10, refund: 0, owed, pay_in_days: 30, pay_to: "acc-factory-1" } });
  const p = new Payables("shop-1");
  p.take(bookOf(note("o1", DAY, 100_000), note("o2", 5 * DAY, 100_000), note("o3", 6 * DAY, 100_000)));
  const r = p.settle(8 * DAY, "acc-shop-1", 250_000);
  expect(r.paid).toBe(200_000);
  expect(r.steps.length).toBe(2);
  expect(p.owing).toBe(100_000);
  expect(JSON.stringify(r.steps)).toContain("Invoice o1");
});

test("a payment that says it is a dividend, or tax withheld, is not an order's payment and is not sent back; one that says nothing, 'Order' or something else still is", () => {
  const book = bookOf(order("o1", 0, "factory-9", "outside", {}));
  const mk = () => { const o = new OrderBook("outside"); o.due(book, 8 * DAY); return o; }; // (factory-9 has ordered: a customer)
  const paid = (memo: string) => { const o = mk(); o.take(obsOf(9 * DAY, "outside", { account: "acc-outside", transactions: [tx(9 * DAY, "acc-factory-9", "acc-outside", 500_000, memo)] }), "acc-outside"); return o.unclaimed(bookOf()); };
  expect(paid("Dividend")).toEqual([]);
  expect(paid("Income tax withheld from wages")).toEqual([]);
  expect(paid("Order: 5 goods.")).toEqual([["acc-factory-9", 500_000]]);
  expect(paid("")).toEqual([["acc-factory-9", 500_000]]);
  expect(paid("700 energy")).toEqual([["acc-factory-9", 500_000]]); // (a payment for goods nobody ordered is still a mistake)
});
