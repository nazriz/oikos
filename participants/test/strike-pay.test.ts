// A strike's stop and resume against the pay run (docs/decisions.md, "the wage race" and its sibling, 2026-10-16). Withdrawing
// a wage order takes the manager's time, and an order withdrawn after its pay moment still pays it. A pay moment inside the
// stop's act was paid by the old order, and then the return paid again what was earned from the pay day before to the
// strike, and a pay that covered strike days. A pay covers the period before its moment; the order's own payments say
// which moments it paid.

import { expect, test } from "bun:test";
import { Book, callAction, type Step } from "../src/behaviour/common";
import { Staffing } from "../src/behaviour/firms";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { callsOf, context, DAY, employment, signed, standingOrder } from "./stepping";

inCurrency(PROFILE.values.currency);

const PERIOD = 14 * DAY, WAGE = 300_000;
const said = (steps: Step[], t = 0) => steps.flatMap((s) => callsOf(callAction(s), t));
const obsOf = (t: number, records: any[], outcomes: any[] = [], transactions: any[] = []): any => ({ t, entity: "city", participant: "x", inbox: [], outcomes, readings: {},
  channels: { papers: { kind: "records", records }, treasury: { kind: "accounts", transactions, accounts: [{ account: "acc-city", holder: "city", custodian: "bank", currency: "AUD", balance: "900000000" }] } } });

/** A shop with one worker on a standing order whose pay days are the 14th day, the 28th, and so on. */
function shop() {
  const staffing = new Staffing(context("shop-system", "city", {}), "city", { period: PERIOD, notice_days: 14, role: "staff" });
  const book = new Book();
  const job = employment("job-1", 0, "city", "w1", WAGE);
  const records: any[] = [...signed(job, 0)];
  const see = (o: any) => { book.absorb(o); staffing.absorb(o); };
  const first = obsOf(DAY, records);
  see(first);
  const made = staffing.routine(first, book, "acc-city", { target: 1, wage: WAGE, canPost: false });
  const ref = made.flatMap((m) => callsOf(callAction(m))).find((c) => c.bind)!.bind!;
  expect(ref).toBeDefined();
  // (The order as the bank has it: its first pay a period after it was made, then every period.)
  const order = standingOrder("order-1", DAY, "city", "acc-w1", WAGE, { basis: "job-1", first: PERIOD, every: PERIOD, for: "Wages for w1." });
  records.push(order);
  see(obsOf(DAY + 60, [order], [{ action: "a1", t: DAY + 60, status: "applied", created: { [ref]: "order-1" } }]));
  return { staffing, book, see };
}
const PAY1 = DAY + PERIOD; // the first pay day

test("a strike's stop with a pay moment inside its act: the order pays it, and the return pays nothing again for the days before the strike and takes the strike days off the next pay", () => {
  const { staffing, book, see } = shop();
  const since = PAY1 - 3600; // the strike begins an hour before a pay day; the act withdrawing the wage waits for the manager's time
  see(obsOf(since, []));
  const stop = said(staffing.stop(book, since, ["w1"], "A strike."), since);
  expect(stop.length).toBe(1);
  // The old order pays its moment, as the bank carries it out.
  see(obsOf(PAY1, [], [], [{ t: PAY1, from: "acc-city", to: "acc-w1", amount: String(WAGE), currency: "AUD", by: "bank", per_instruction: "order-1" }]));
  const back = PAY1 + 5 * DAY;
  see(obsOf(back, []));
  const resumed = said(staffing.resume(book, back, "acc-city", ["w1"], "Back."), back).filter((c) => c.fn === "money");
  // Paid through the pay day: nothing earned before the strike is owed again (one standing order, no payment of the earned).
  expect(resumed.length).toBe(1);
  expect(resumed[0]!.args.every).toBe("14 days");
  // The hour of strike that pay day covered is off the next pay: it begins that much later, each pay a pay for the period before it.
  expect(resumed[0]!.args.first).toBe(`${PERIOD + 3600} seconds`);
});

test("a strike's stop with no pay moment in its act: what was earned from the pay day before to the strike is paid on the return, as ever", () => {
  const { staffing, book, see } = shop();
  const since = PAY1 - 4 * DAY; // four days before the pay day (ten days into the period)
  see(obsOf(since, []));
  said(staffing.stop(book, since, ["w1"], "A strike."), since);
  const back = since + 3 * DAY;
  see(obsOf(back, []));
  const resumed = said(staffing.resume(book, back, "acc-city", ["w1"], "Back."), back).filter((c) => c.fn === "money");
  expect(resumed.length).toBe(2);
  expect(resumed[0]!.args.amount).toBe("$2142.85");
  expect(resumed[1]!.args).toMatchObject({ every: "14 days", first: "14 days" });
});
