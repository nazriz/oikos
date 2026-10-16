// A wrong energy bill (docs/behaviour/utilities.md, "Wrong bills"): at the friction dial, some customers are sent a bill
// that overstates their use (an estimated reading entered too high); asked to put one right, the retailer checks the bill
// against its own tariff and pays back exactly the overcharge, and answers no about a bill that was right.
import { expect, test } from "bun:test";
import { energy } from "../src/behaviour/utilities";
import { inCurrency } from "../src/money";
import { context, DAY, statement, wake } from "./stepping";

inCurrency({ code: "XTS", minor_units: 2 });
const ME = "power-co";
const PARAMS = { depot: "depot", grid: "grid", units_per_customer_per_day: 10, price_per_unit: 30, supply_per_day: 100 };
const CUSTOMERS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];

/** The retailer, with a dial and parameters; woken every 30 days for a year, each customer asking to be supplied at the
 * start. Returns the bills it sent, and a way to wake it again with more on its file. */
function retailer(params: object = {}, dial?: number) {
  // (How often a bill is wrong is the world's table of slips, foundations F7: `billing_error_bps_per_year` here stands for its row.)
  const { billing_error_bps_per_year: rate, ...rest } = params as { billing_error_bps_per_year?: number };
  const base: any = context(`${ME}-system`, ME, { ...PARAMS, ...rest }, { position: `${ME}-office` });
  if (dial !== undefined) base.world = { ...base.world, dials: { friction_bps: dial } };
  if (rate !== undefined) base.world = { ...base.world, slip: { person: { "publish/invoice/metered_bill": { bps: rate, per: "year", friction: true } } } };
  const m = energy.create(base);
  const ids = { n: 0 };
  const books = { kind: "accounts", accounts: [{ account: `acc-${ME}`, holder: ME, custodian: "bank", currency: "XTS", balance: "100000000" }], transactions: [] };
  const own: any[] = [];
  const as = { participant: `${ME}-system`, position: `${ME}-office` };
  const at = (t: number, records: any[] = []) => {
    const w = wake(m, t, { books, mine: { kind: "records", records: [...own.splice(0), ...records] } }, { entity: ME, as, ids });
    own.push(...w.made);
    return w;
  };
  const requests = CUSTOMERS.map((c) => statement(`req-${c}`, 0, "supply_request", { speaks_for: c, addressed_to: [ME], visible_to: [c, ME], data: { account: `acc-${c}` } }));
  const bills: any[] = [];
  const year = () => {
    at(0, requests);
    for (let d = 30; d <= 360; d += 30) {
      const w = at(d * DAY);
      bills.push(...w.of("statement", "invoice").map((c) => ({ day: d, to: c.args.to[0], text: c.args.text, data: c.args.data, id: w.made.find((r) => r.text === c.args.text && r.speaks_for === ME)?.id })));
    }
    return bills;
  };
  return { m, at, year, bills, own };
}

test("with the dial absent or the rate at nought, every bill is the true one", () => {
  const plain = retailer({}).year();
  expect(plain.length).toBeGreaterThan(0);
  for (const b of plain) {
    expect(b.data.units).toBe(300);
    expect(b.data.days).toBe(30);
    expect(b.data.estimated).toBeUndefined();
    expect(b.data.outcome.money.amount).toBe(String(30 * 100 + 300 * 30));
  }
  // (A rate with the dial off, and a dial with no rate: the same bills.)
  expect(retailer({ billing_error_bps_per_year: 10_000, billing_over_bps: 5_000 }).year()).toEqual(plain);
  expect(retailer({}, 10_000).year()).toEqual(plain);
});

test("at a high rate some bills overstate the units by the given share and say they were estimated; the rest are right", () => {
  const bills = retailer({ billing_error_bps_per_year: 40_000, billing_over_bps: 5_000 }, 10_000).year();
  const wrong = bills.filter((b) => b.data.estimated);
  expect(wrong.length).toBeGreaterThan(0);
  expect(wrong.length).toBeLessThan(bills.length);
  for (const b of wrong) {
    expect(b.data).toMatchObject({ units: 450, days: 30, estimated: true });
    expect(b.data.outcome.money.amount).toBe(String(30 * 100 + 450 * 30));
    expect(b.text).toContain("450 units");
  }
  for (const b of bills.filter((x) => !x.data.estimated)) expect(b.data.units).toBe(300);
});

/** A customer's request to put a bill right, as the citizen sends one. */
const ask = (id: string, at: number, who: string, about: string) => statement(id, at, "review_request", { speaks_for: who, addressed_to: [ME], visible_to: [who, ME],
  data: { matter: "bill", against: ME, about, amount: 99_999, account: `acc-${who}` } });

test("asked about a wrong bill, the retailer says yes and pays back exactly the overcharge; about a right bill, it says no and pays nothing", () => {
  const r = retailer({ billing_error_bps_per_year: 40_000, billing_over_bps: 5_000, respond: { grant_bps: { bill: 10_000 } } }, 10_000);
  const bills = r.year();
  const wrong = bills.find((b) => b.data.estimated)!;
  const right = bills.find((b) => !b.data.estimated)!;
  const w = r.at(361 * DAY, [ask("ask-1", 361 * DAY, wrong.to, wrong.id)]);
  const yes = w.of("statement", "remedy_answer");
  expect(yes.length).toBe(1);
  expect(yes[0]!.args.data).toMatchObject({ granted: true, matter: "bill", amount: 150 * 30 });
  const paid = w.of("money");
  expect(paid.length).toBe(1);
  expect(paid[0]!.args.to).toBe(`acc-${wrong.to}`);
  expect(String(paid[0]!.args.amount)).toContain("45");
  const n = r.at(362 * DAY, [ask("ask-2", 362 * DAY, right.to, right.id)]);
  expect(n.of("statement", "remedy_answer").map((c) => c.args.data)).toMatchObject([{ granted: false, matter: "bill" }]);
  expect(n.of("money").length).toBe(0);
});
