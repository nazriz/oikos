// A statement from the bank (docs/behaviour/bank-payment-system.md, "A statement"), on what the bank is shown alone.
// The bank is shown a payment once, when it is made; a letter comes later. The statement that answers it is written
// from the bank's own ledger: what was paid in and out since the last statement to that writer, by date, with the
// account paid or paying, what it was for and its reference, and the balance brought and carried forward. Until
// bank.payment_system 0.14.0 it said "No payments yet" after it had paid (the live check of 2026-10-09, finding 2).

import { expect, test } from "bun:test";
import { bankPaymentSystem } from "../src/behaviour/bank";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import OTHER from "../../worlds/profiles/de-ni-2026.json";
import { context, DAY, wake } from "./stepping";

const who = { kind: "directory", positions: [{ position: "firm-clerk", entity: "firm" }, { position: "firm-boss", entity: "firm" }],
  entities: [{ entity: "firm", kind: "organisation", name: "Firm" }, { entity: "c1", kind: "person", name: "C One", participant: "c1-self" }] };
const bank = (params: object = {}) => bankPaymentSystem.create(context("bank-pay-system", "bank", params, { position: "bank-pay" }));
/** The bank woken at `t`: the balances it keeps, the payments made since its last look (shown once), and its letters. */
const at = (m: any, t: number, balances: { [holder: string]: number }, transactions: any[] = [], inbox: any[] = []) =>
  wake(m, t, { requests: { kind: "records", records: [] }, who,
    custody: { kind: "accounts", transactions, accounts: Object.entries(balances).map(([holder, balance]) => ({ account: `acc-${holder}`, holder, custodian: "bank", currency: "AUD", balance: String(balance) })) } },
  { entity: "bank", inbox }).said.filter((c) => c.fn === "message").map((c) => c.args.text as string);
const tx = (t: number, from: string, to: string, amount: number, x: object = {}) => ({ t, from: `acc-${from}`, to: `acc-${to}`, amount: String(amount), currency: "AUD", by: "bank-pay-system", ...x });
const letter = (id: string, t: number, from: string, as?: string) => ({ id, t, from, ...(as ? { as, from_entity: "firm" } : {}), to: ["bank"], text: "What have you paid from our account?" });

test("a statement lists what was paid out and in since the ledger began, by date, account, purpose and reference, with the balances", () => {
  inCurrency(PROFILE.values.currency);
  const m = bank();
  at(m, 0, { firm: 1_000_000, c1: 50_000 });
  // Day 3: the bank is shown two payments it made the day before (a wage under the firm's standing instruction, and
  // an invoice the firm paid), and one paid to the firm. No letter: nothing is said.
  expect(at(m, 3 * DAY, { firm: 849_000, c1: 150_000 }, [
    tx(2 * DAY, "firm", "c1", 100_000, { per_instruction: "job-c1-wages", memo: "wages" }),
    tx(2 * DAY + 60, "firm", "builder", 75_000, { per_instruction: "rec.7", settles: "inv-1" }),
    tx(2 * DAY + 90, "shop", "firm", 24_000, { per_instruction: "rec.9", memo: "Goods.", settles: "inv-2" })])).toEqual([]);
  // Day 9: the firm's clerk writes. Nothing was paid at this look; the statement is from the ledger.
  const [said] = at(m, 9 * DAY, { firm: 849_000, c1: 150_000 }, [], [letter("msg.1", 9 * DAY, "clerk-1", "firm-clerk")]);
  expect(said).not.toContain("No payments yet");
  expect(said).toStartWith("Report from bank: Statement of acc-firm, year 1, day 1 to year 1, day 10: balance brought forward $10,000.00. " +
    "year 1, day 3: paid out $1,000.00 to acc-c1 (wages), under your instruction job-c1-wages; " +
    "year 1, day 3: paid out $750.00 to acc-builder, under your instruction rec.7, settling inv-1; " +
    "year 1, day 3: paid in $240.00 from acc-shop (Goods), settling inv-2. " +
    "In all $1,750.00 paid out and $240.00 paid in. Balance carried forward $8,490.00. You have no standing instructions with us.");
  // (Whoever was paid is not told the payer's instruction: it is the payer's paper.)
  const [worker] = at(m, 10 * DAY, { firm: 849_000, c1: 150_000 }, [], [letter("msg.2", 10 * DAY, "c1-self")]);
  expect(worker).toContain("Statement of acc-c1, year 1, day 1 to year 1, day 11: balance brought forward $500.00. year 1, day 3: paid in $1,000.00 from acc-firm (wages). In all $0.00 paid out and $1,000.00 paid in. Balance carried forward $1,500.00.");
  expect(worker).not.toContain("job-c1-wages");
});

test("a statement runs from the last one to the same writer; another officer of the same customer has their own", () => {
  inCurrency(PROFILE.values.currency);
  const m = bank();
  at(m, 0, { firm: 1_000_000 });
  at(m, 3 * DAY, { firm: 900_000 }, [tx(2 * DAY, "firm", "c1", 100_000, { per_instruction: "job-c1-wages", memo: "wages" })]);
  const first = at(m, 9 * DAY, { firm: 900_000 }, [], [letter("msg.1", 9 * DAY, "clerk-1", "firm-clerk")])[0]!;
  expect(first).toContain("paid out $1,000.00 to acc-c1");
  // The clerk again, with nothing paid since: the statement says so, and since when.
  const again = at(m, 12 * DAY, { firm: 900_000 }, [], [letter("msg.2", 12 * DAY, "clerk-1", "firm-clerk")])[0]!;
  expect(again).toContain("Statement of acc-firm, year 1, day 10 to year 1, day 13 (since our last statement to you): nothing was paid in or out. Balance $9,000.00.");
  // One more payment, then the clerk a third time: only that one, from the balance the last statement ended on.
  at(m, 17 * DAY, { firm: 800_000 }, [tx(16 * DAY, "firm", "c1", 100_000, { per_instruction: "job-c1-wages", memo: "wages" })]);
  const third = at(m, 20 * DAY, { firm: 800_000 }, [], [letter("msg.3", 20 * DAY, "clerk-1", "firm-clerk")])[0]!;
  expect(third).toContain("Statement of acc-firm, year 1, day 13 to year 1, day 21 (since our last statement to you): balance brought forward $9,000.00. year 1, day 17: paid out $1,000.00 to acc-c1 (wages), under your instruction job-c1-wages. In all $1,000.00 paid out and $0.00 paid in. Balance carried forward $8,000.00.");
  // The boss has had no statement: theirs runs from the beginning.
  const boss = at(m, 21 * DAY, { firm: 800_000 }, [], [letter("msg.4", 21 * DAY, "boss-1", "firm-boss")])[0]!;
  expect(boss).toContain("Statement of acc-firm, year 1, day 1 to year 1, day 22: balance brought forward $10,000.00. year 1, day 3: paid out $1,000.00 to acc-c1 (wages), under your instruction job-c1-wages; year 1, day 17: paid out $1,000.00");
});

test("a statement lists the latest entries up to the bank's figure and gives the rest in its totals; sums are written as the place writes money", () => {
  inCurrency(OTHER.values.currency);
  const m = bank({ statement_lists: 3 });
  at(m, 0, { firm: 1_000_000 });
  at(m, 8 * DAY, { firm: 300_000 }, [1, 2, 3, 4, 5, 6, 7].map((d) => tx(d * DAY, "firm", "c1", 100_000, { memo: "wages" })));
  const said = at(m, 9 * DAY, { firm: 300_000 }, [], [letter("msg.1", 9 * DAY, "clerk-1", "firm-clerk")])[0]!;
  expect(said).toContain("balance brought forward 10.000,00 €. year 1, day 6: paid out 1.000,00 € to acc-c1 (wages); year 1, day 7: paid out 1.000,00 € to acc-c1 (wages); year 1, day 8: paid out 1.000,00 € to acc-c1 (wages). " +
    "Those are the latest 3 of 7 entries; the 4 before them are in the totals. In all 7.000,00 € paid out and 0,00 € paid in. Balance carried forward 3.000,00 €.");
  inCurrency(PROFILE.values.currency);
});

test("someone with no account is told so, and nothing of anyone's payments", () => {
  inCurrency(PROFILE.values.currency);
  const m = bank();
  at(m, 0, { firm: 1_000_000 });
  at(m, 3 * DAY, { firm: 900_000 }, [tx(2 * DAY, "firm", "c1", 100_000)]);
  expect(at(m, 4 * DAY, { firm: 900_000 }, [], [letter("msg.1", 4 * DAY, "c1-self")])).toEqual(["Report from bank: we hold no account for you. To open one, ask us for one in writing."]);
});
