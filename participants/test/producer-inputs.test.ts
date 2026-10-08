// What a works spends on inputs (docs/behaviour/producer.md): as much as it can pay for with the next pay period's wages
// kept aside, as a shop does when it restocks.
//
// Found in the 1,000-person town's logs (decisions log, 2026-10-08): on day 31 a works of forty, holding a month's
// inputs, spent all but a fifth of a pay period's wages on the next half month's, was refused a loan, and gave 32 of
// its 40 staff notice, four days before its next export receipts.

import { expect, test } from "bun:test";
import { producer } from "../src/behaviour/producer";
import { inCurrency } from "../src/money";
import { context, DAY, employment, signed, statement, wake } from "./stepping";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

inCurrency(PROFILE.values.currency);

const ME = "works";
const AS = { participant: "works-manager-system", position: "works-manager" };
const WAGE = 300_000, STAFF = 4, PRICE = 250, PER_UNIT = 20, LABOUR = 3600;
// A month's making for four (8 hours, 5 days of 7, 30 days, an hour a unit), and the inputs it takes.
const MONTH_UNITS = Math.floor((STAFF * 28_800 * 5 * 30) / 7 / LABOUR), MONTH_INPUTS = MONTH_UNITS * PER_UNIT;

/** A works of four with `inputs` in hand and `balance` at the bank, woken once: the inputs it orders, and what it pays. */
function ordered(balance: number, inputs: number) {
  const m = producer.create(context(AS.participant, ME, { works: ME, workplace: `${ME}/workplace.1`, max_staff: 10, wage: WAGE, per_unit: { inputs: PER_UNIT }, labour_per_unit: LABOUR, price: 10_000, supplier: "outside", market: "outside" }, { position: AS.position }));
  const staff = Array.from({ length: STAFF }, (_, i) => signed(employment(`job-${i + 1}`, i + 1, ME, `worker-${i + 1}`, WAGE))).flat();
  const list = statement("list-outside", 0, "price_list", { speaks_for: "outside", data: { goods: { inputs: PRICE }, account: "acc-outside" } });
  const w = wake(m, 10 * DAY, {
    books: { kind: "accounts", accounts: [{ account: "acc-works", holder: ME, custodian: "bank", currency: "AUD", balance: String(balance) }], transactions: [] },
    mine: { kind: "records", records: [...staff, list] },
    stock: { kind: "holdings", holdings: [{ holder: ME, at: ME, kind: "inputs", quantity: String(inputs) }] },
  }, { entity: ME, as: AS });
  const o = w.of("statement", "order")[0];
  return o ? (o.args.data.quantity as number) : 0;
}

test("with money to spare, a works below a month's inputs orders up to a month and a half's", () => {
  expect(ordered(100_000_000, MONTH_INPUTS - 1)).toBe(Math.floor((MONTH_INPUTS * 3) / 2) - (MONTH_INPUTS - 1));
});

test("short of money, it orders what it can pay for with the next pay period's wages kept aside", () => {
  const balance = STAFF * WAGE + 1000 * PRICE + 99;
  expect(ordered(balance, MONTH_INPUTS - 1)).toBe(1000);
});

test("with no more than the next pay period's wages, it orders nothing", () => {
  expect(ordered(STAFF * WAGE, MONTH_INPUTS - 1)).toBe(0);
  expect(ordered(STAFF * WAGE - 50_000, 0)).toBe(0);
});
