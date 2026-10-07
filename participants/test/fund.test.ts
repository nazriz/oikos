// The retirement fund's trustee (docs/behaviour/firm-ownership.md): what comes in pays the fund's costs first; the
// rest is each member's by their units, kept for those below the access age and paid, as a pension, to those from it;
// what was kept is paid from that age at the yearly rate for the member's age, and on a member's death to their account.

import { expect, test } from "bun:test";
import { parseAmount } from "../src/calls";
import { currencyNow, inCurrency } from "../src/money";
import { retirementFund } from "../src/behaviour/fund";
import { context, DAY, MONTH, statement, wake } from "./stepping";

inCurrency({ code: "XTS", minor_units: 2 }); // (a test currency: the fund words amounts in whatever the world's is)
const YEAR = 365 * DAY;
const member = (id: string, age: number, units: number, days = 0) => ({ member: id, account: `acc-${id}`, born_at: -(age * YEAR + days * DAY), units });
const register = (members: object[]) => statement("members-fund", 0, "fund_members", { speaks_for: "fund", visible_to: ["fund"], data: { members } });
const params = { administrator_account: "acc-admin", access_age: 67, cost_bps_of_income: 1500, pay_every_days: 30, drawdown_bps_by_age: [{ from: 0, bps: 400 }, { from: 65, bps: 500 }, { from: 75, bps: 600 }] };
const shown = (balance: number, records: object[] = []) => ({
  ledger: { kind: "accounts", accounts: [{ account: "acc-fund", holder: "fund", custodian: "bank", currency: "AUD", balance: String(balance) }], transactions: [] },
  register: { kind: "records", records },
});
const fund = (p: object = params) => retirementFund.create(context("fund-trustee-system", "fund", p));
const payments = (w: ReturnType<typeof wake>) => (w.of("statement", "request")[0]?.args.data.payments ?? []) as { to: string; amount: string; for: string }[];
const costs = (w: ReturnType<typeof wake>) => w.of("money").map((c) => ({ to: c.args.to, amount: Number(parseAmount(c.args.amount, currencyNow())) }));

test("costs first; then each member's part by their units: kept below the access age, paid from it", () => {
  const m = fund();
  const members = [member("a", 70, 30), member("b", 40, 20), member("c", 80, 50)];
  expect(wake(m, 0, shown(0, [register(members)]), { entity: "fund" }).said).toEqual([]);
  // Nothing is paid before a period has passed.
  expect(wake(m, 29 * DAY, shown(100_000), { entity: "fund" }).said).toEqual([]);
  const first = wake(m, MONTH, shown(100_000), { entity: "fund" });
  expect(costs(first)).toEqual([{ to: "acc-admin", amount: 15_000 }]);
  expect(payments(first)).toEqual([{ to: "acc-a", amount: "25500", for: "Pension." }, { to: "acc-c", amount: "42500", for: "Pension." }]);
  // The next period: what it holds is what was kept for b (17,000) and 10,000 more come in.
  const second = wake(m, 2 * MONTH, shown(27_000), { entity: "fund" });
  expect(costs(second)).toEqual([{ to: "acc-admin", amount: 1_500 }]);
  expect(payments(second)).toEqual([{ to: "acc-a", amount: "2550", for: "Pension." }, { to: "acc-c", amount: "4250", for: "Pension." }]);
  // Nothing came in: nothing is paid, and what is kept stays kept.
  expect(wake(m, 3 * MONTH, shown(18_700), { entity: "fund" }).said).toEqual([]);
});

test("what was kept is paid from the access age at the rate for the member's age, and on death to the member's account", () => {
  const m = fund();
  // b turns 67 between the first and the second period.
  wake(m, 0, shown(0, [register([member("a", 70, 50), member("b", 66, 50, 365 - 45)])]), { entity: "fund" });
  const first = wake(m, MONTH, shown(200_000), { entity: "fund" });
  expect(payments(first)).toEqual([{ to: "acc-a", amount: "85000", for: "Pension." }]);
  // Kept for b: 85,000. Now 67: their part of what came in (20,000 less costs, halved), and 5% a year of what was kept.
  const second = wake(m, 2 * MONTH, shown(105_000), { entity: "fund" });
  const draw = Math.floor((85_000 * 500 * 30) / (10_000 * 365));
  expect(payments(second)).toEqual([{ to: "acc-a", amount: "8500", for: "Pension." }, { to: "acc-b", amount: String(8_500 + draw), for: "Pension." }]);
  // b dies: what is still kept for them goes to their account (their estate's, which the bank settles), and a has every unit.
  const death = statement("rec.9", 2 * MONTH + DAY, "death_registration", { data: { deceased: "b" } });
  const third = wake(m, 3 * MONTH, { ...shown(85_000 - draw + 10_000), gone: { kind: "records", records: [death] } }, { entity: "fund" });
  expect(payments(third)).toEqual([{ to: "acc-b", amount: String(85_000 - draw), for: "Death benefit." }, { to: "acc-a", amount: "8500", for: "Pension." }]);
});

test("a member who has left is paid nothing more here: their part is kept", () => {
  const m = fund();
  wake(m, 0, shown(0, [register([member("a", 70, 50), member("b", 71, 50)])]), { entity: "fund" });
  const left = statement("rec.3", DAY, "departure", { speaks_for: "b" });
  const first = wake(m, MONTH, { ...shown(100_000), gone: { kind: "records", records: [left] } }, { entity: "fund" });
  expect(payments(first)).toEqual([{ to: "acc-a", amount: "42500", for: "Pension." }]);
});

test("the world must say whom it pays its costs to, and from what age it pays", () => {
  expect(() => fund({})).toThrow("the world must say administrator_account, access_age");
});
