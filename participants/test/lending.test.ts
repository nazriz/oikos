// A loan against a price (docs/behaviour/credit.md, ownership.md): what a buyer asks and what a lender admits meet at
// every price, in whole units of the smallest kind. Until 2026-10-08 the buyer rounded its deposit down, so the loan it
// asked was a unit over the lender's share of the price wherever that share is not whole, and was refused.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { lending, loanFor, mostAgainst, shareDown, shareUp } from "../src/behaviour/credit";
import { inCurrency } from "../src/money";
import { Randomness } from "../src/rng";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { callsOf, statement } from "./stepping";

inCurrency(PROFILE.values.currency);

const DAY = 86_400, MONTH = 30 * DAY;

test("a share of an amount is whole units, rounded down or up, with no fraction made on the way", () => {
  expect(shareDown(100, 2000)).toBe(20);
  expect(shareUp(100, 2000)).toBe(20);
  expect(shareDown(101, 2000)).toBe(20);
  expect(shareUp(101, 2000)).toBe(21);
  expect(shareDown(0, 8000)).toBe(0);
  expect(shareUp(0, 8000)).toBe(0);
  // Large amounts stay exact (a float product of these loses the last unit), and beyond exact arithmetic it says so.
  expect(shareDown(900_000_000_001, 3333)).toBe(Number((900_000_000_001n * 3333n) / 10_000n));
  expect(shareUp(900_000_000_001, 3333)).toBe(Number((900_000_000_001n * 3333n) / 10_000n) + 1);
  expect(() => shareDown(Number.MAX_SAFE_INTEGER, 8000)).toThrow();
});

test("what a buyer asks is what the lender admits at every price: a deposit and a limit that make up the whole price", () => {
  // The two prices the test town's buyer was refused at, and every price around them; other splits too.
  const prices = [56_895_911, 51_348_561, 1, 2, 3, 4, 5, 6, 7, 9, 99, 101, 12_345_679];
  for (let x = 51_348_500; x < 51_348_700; x++) prices.push(x);
  for (const [deposit, lvr] of [[2000, 8000], [1000, 9000], [500, 9500], [3333, 6667], [1, 9999], [0, 10_000]] as const) {
    for (const price of prices) {
      const loan = loanFor(price, deposit);
      // Within the limit, and all of it: a unit more would be over.
      expect(loan).toBe(mostAgainst(price, lvr));
      expect(BigInt(loan) * 10_000n <= BigInt(price) * BigInt(lvr)).toBe(true);
      expect(BigInt(loan + 1) * 10_000n > BigInt(price) * BigInt(lvr)).toBe(true);
      // And the deposit is never short of its share.
      expect(BigInt(price - loan) * 10_000n >= BigInt(price) * BigInt(deposit)).toBe(true);
    }
  }
  // (What was asked before: the deposit rounded down, a unit over wherever a fifth is not whole.)
  expect(56_895_911 - Math.floor((56_895_911 * 2000) / 10_000)).toBe(mostAgainst(56_895_911, 8000) + 1);
});

/** The lending office, shown a customer with three months of pay coming in and their applications; what it decided. */
function decide(applications: { id: string; amount: number; price: number }[]) {
  const ME = "bank", WHO = "ann";
  const m = lending.create({ participant: "bank-lending-system", entity: ME, rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 2000 * DAY },
    params: { mortgage_rate_bps: 620, mortgage_max_months: 360, max_lvr_bps: 8000, max_share_bps: { person: 10_000, organisation: 10_000 }, funding_from: "outside" } } as any);
  const accounts = [{ account: "acc-bank", holder: ME, custodian: ME, currency: "AUD", balance: "100000000000" }, { account: "acc-ann", holder: WHO, custodian: ME, currency: "AUD", balance: "20000000" }];
  const decisions: { [application: string]: { approved: boolean; reason?: string } } = {};
  const wake = (t: number, records: any[], transactions: any[]) => {
    let o = { t, entity: ME, woke_for: "cadence", outcomes: [], readings: {}, channels: { mine: { kind: "records", records }, bank: { kind: "accounts", accounts, transactions } } } as unknown as Observation;
    for (let i = 0; i < 50; i++) {
      const a: any = m.step(o, undefined as any);
      if (a.type === "wait") break;
      for (const c of callsOf(a, t)) if (c.fn === "statement" && c.args.kind === "loan_decision") decisions[c.args.data.application] = { approved: c.args.data.approved, reason: c.args.data.reason };
      o = { ...o, woke_for: "done", outcomes: [{ action: `act-${i}`, t, status: "applied", created: { loan: `loan-${i}` } }], channels: { mine: { kind: "records", records: [] }, bank: { kind: "accounts", accounts, transactions: [] } } } as unknown as Observation;
    }
  };
  // Pay into the account in each of three months, then the applications.
  for (let k = 0; k < 3; k++) wake(k * MONTH + DAY, [], [{ t: k * MONTH + DAY, from: "acc-employer", to: "acc-ann", amount: "50000000", currency: "AUD", by: "bank", memo: "wages" }]);
  const t = 3 * MONTH;
  wake(t, applications.map((a) => statement(a.id, t, "loan_application", { speaks_for: WHO, author: "ann-self", addressed_to: [ME], visible_to: [WHO, ME], data: { amount: a.amount, months: 360, account: "acc-ann", purpose: "a home", price: a.price, home: "h1/home" } })), []);
  return decisions;
}

test("the lender admits a loan of exactly its share of the price, at a price the share does not divide, and refuses a unit more", () => {
  const price = 56_895_911; // (four fifths of it is 45,516,728.8)
  const d = decide([
    { id: "app-asked", amount: loanFor(price, 2000), price },
    { id: "app-over", amount: loanFor(price, 2000) + 1, price },
    { id: "app-even", amount: 40_000_000, price: 50_000_000 },
    { id: "app-even-over", amount: 40_000_001, price: 50_000_000 },
  ]);
  expect(d["app-asked"]).toEqual({ approved: true });
  expect(d["app-over"]!.approved).toBe(false);
  expect(d["app-over"]!.reason).toContain("more than 80% of the home's price");
  expect(d["app-even"]).toEqual({ approved: true });
  expect(d["app-even-over"]!.approved).toBe(false);
});

test("a loan the office offered that is on its file and not in its head is paid out once the borrower signs (the mock in the lending seat hears no id back for its offer: 2026-10-11)", () => {
  const ME = "bank", WHO = "ann";
  const m = lending.create({ participant: "bank-lending-system", entity: ME, rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 2000 * DAY }, params: { funding_from: "outside" } } as any);
  const accounts = [{ account: "acc-bank", holder: ME, custodian: ME, currency: "AUD", balance: "100000000000" }];
  const calls: any[] = [];
  const wake = (t: number, records: any[], transactions: any[] = []) => {
    let o = { t, entity: ME, woke_for: "cadence", outcomes: [], readings: {}, channels: { mine: { kind: "records", records }, bank: { kind: "accounts", accounts, transactions } } } as unknown as Observation;
    for (let i = 0; i < 20; i++) {
      const a: any = m.step(o, undefined as any);
      if (a.type === "wait") break;
      calls.push(...callsOf(a, t));
      // (No id comes back for anything made: as for an act said through someone else's hand.)
      o = { ...o, woke_for: "done", outcomes: [{ action: `act-${i}`, t, status: "applied" }], channels: { mine: { kind: "records", records: [] }, bank: { kind: "accounts", accounts, transactions: [] } } } as unknown as Observation;
    }
  };
  wake(DAY, []);
  const loan = { id: "rec.9", at: 2 * DAY, author: "bank-lending-system", record: "agreement", visible_to: [ME, WHO], terms: { template: "loan", parties: [ME, WHO], term: 12 * MONTH, text: "bank lends ann 1,000.00; ann repays 91.68 a month for 12 months (18% a year).",
    commitments: [{ who: ME, does: { outcome: { money: { to: "acc-ann", amount: "100000", for: "Loan principal." } } } }, { who: WHO, does: { outcome: { money: { from: "acc-ann", to: "acc-bank", amount: "9168", for: "Loan repayment." } } }, every: MONTH }] } };
  const sig = (as: string, at: number) => ({ id: `sig-${as}`, at, author: `${as}-x`, record: "signature", agreement: "rec.9", as, visible_to: [ME, WHO] });
  // Offered and signed by the bank: nothing is paid until the borrower signs.
  wake(2 * DAY, [loan, sig(ME, 2 * DAY)]);
  expect(calls.filter((c) => c.fn === "money")).toEqual([]);
  wake(3 * DAY, [sig(WHO, 3 * DAY)]);
  const paid = calls.filter((c) => c.fn === "money");
  expect(paid.map((c) => [c.args.to, c.args.settles])).toEqual([["acc-ann", "rec.9"]]);
  // Once, and not again when the payment is seen to leave.
  wake(4 * DAY, [], [{ t: 3 * DAY, from: "acc-bank", to: "acc-ann", amount: "100000", currency: "AUD", by: "bank", settles: "rec.9" }]);
  expect(calls.filter((c) => c.fn === "money")).toHaveLength(1);
});
