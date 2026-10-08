// A hold on a standing order, at the bank (docs/behaviour/bank-payment-system.md, "A hold"), on what the bank is shown
// alone: a held order is not paid, and is paid again from its next due date once the hold is withdrawn, with nothing
// made up; what fell due before the hold counted is still paid; a hold from anyone but whoever may instruct on the
// account changes nothing and is answered; and a letter to the bank lists the writer's own standing instructions.

import { expect, test } from "bun:test";
import { bankPaymentSystem, HOLD_NOTE } from "../src/behaviour/bank";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { context, DAY, statement, wake } from "./stepping";

inCurrency(PROFILE.values.currency);

const who = { kind: "directory", positions: [{ position: "firm-clerk", entity: "firm" }, { position: "firm-boss", entity: "firm" }],
  entities: [{ entity: "firm", kind: "organisation", name: "Firm" }, { entity: "c1", kind: "person", name: "C One", participant: "c1-self" }, { entity: "c2", kind: "person", name: "C Two", participant: "c2-self" }] };
const custody = (balances: { [holder: string]: number }) => ({ kind: "accounts", transactions: [], accounts: Object.entries(balances).map(([holder, balance]) => ({ account: `acc-${holder}`, holder, custodian: "bank", currency: "AUD", balance: String(balance) })) });
const RICH = { c1: 9_000_000, c2: 9_000_000, firm: 9_000_000 };
/** A standing order of a person's: 1,000 to the landlord every ten days, first due ten days after it was made. */
const order = (id: string, at: number, from: string, x: object = {}) => statement(id, at, "request", { author: `${from}-self`, speaks_for: from, addressed_to: ["bank"], visible_to: [from, "bank"],
  data: { outcome: { money: { from: `acc-${from}`, to: "acc-landlord", amount: "100000", for: "Rent." } }, every: 10 * DAY }, ...x });
const hold = (id: string, at: number, by: string, holds: string[], x: object = {}) => statement(id, at, "hold", { author: `${by}-self`, speaks_for: by, addressed_to: ["bank"], visible_to: [by, "bank"], data: { holds }, ...x });
const lifted = (id: string, at: number, what: string) => ({ id, at, record: "withdrawal", author: "x", withdraws: what, visible_to: ["bank"] });
const bank = (params: object = {}) => bankPaymentSystem.create(context("bank-pay-system", "bank", params, { position: "bank-pay" }));
const at = (m: any, t: number, records: any[], inbox: any[] = []) => wake(m, t, { requests: { kind: "records", records }, custody: custody(RICH), who }, { entity: "bank", inbox }).said;
const paid = (said: any[], under = "so-1") => said.filter((c) => c.fn === "money" && c.args.per_request === under).length;
const notes = (said: any[]) => said.filter((c) => c.fn === "message").map((c) => [c.args.to, c.args.text, c.args.re]);

test("a held order is not paid; once the hold is withdrawn it is paid again from its next due date, and what was missed is not made up", () => {
  const m = bank();
  expect(paid(at(m, 0, [order("so-1", 0, "c1")]))).toBe(0);
  expect(paid(at(m, 10 * DAY, []))).toBe(1);
  // The hold, given on day 15: the bank answers once, saying which payment is the first it stops.
  const told = at(m, 15 * DAY, [hold("h1", 15 * DAY, "c1", ["so-1"])]);
  expect(notes(told)).toEqual([[["c1-self"], HOLD_NOTE.taken("h1", ["so-1, from the payment due on day 21"]), "h1"]]);
  expect(told[0]!.args.text).toBe("Hold h1 is in place. Not paid while it stands: so-1, from the payment due on day 21. Anything due before then is still paid. A payment not made under a hold is not made up when the hold is lifted: what it was for is still owed, and is yours to settle with whoever it is owed to. To resume, withdraw h1; payments then go on from the next due date.");
  // Two due dates pass under it: nothing is paid, and nothing more is said.
  expect(at(m, 20 * DAY, [])).toEqual([]);
  expect(at(m, 30 * DAY, [])).toEqual([]);
  // Lifted on day 35: nothing at once (the two missed are not made up), then one payment on each due date after.
  expect(at(m, 35 * DAY, [lifted("w1", 35 * DAY, "h1")])).toEqual([]);
  expect(paid(at(m, 40 * DAY, []))).toBe(1);
  expect(paid(at(m, 50 * DAY, []))).toBe(1);
});

test("a payment that fell due before the hold counted is still made: one due before the hold was given, and one due within the bank's notice of it", () => {
  // The bank wakes late: due on days 10 and 20, the hold given on day 12, the bank's next plan on day 25. The payment
  // of day 10 goes; that of day 20 doesn't.
  const late = bank();
  at(late, 0, [order("so-1", 0, "c1")]);
  expect(paid(at(late, 25 * DAY, [hold("h1", 12 * DAY, "c1", ["so-1"])]))).toBe(1);
  // Given half a day before a due date, with a day's notice asked: that payment still goes, and the next doesn't.
  const m = bank();
  at(m, 0, [order("so-1", 0, "c1")]);
  const told = at(m, 9 * DAY + DAY / 2, [hold("h1", 9 * DAY + DAY / 2, "c1", ["so-1"])]);
  expect(notes(told)[0]![1]).toContain("so-1, from the payment due on day 21.");
  expect(paid(at(m, 10 * DAY, []))).toBe(1);
  expect(paid(at(m, 20 * DAY, []))).toBe(0);
  // A bank that asks for no notice stops the payment due that day.
  const prompt = bank({ hold_notice: 0 });
  at(prompt, 0, [order("so-1", 0, "c1")]);
  expect(notes(at(prompt, 9 * DAY + DAY / 2, [hold("h1", 9 * DAY + DAY / 2, "c1", ["so-1"])]))[0]![1]).toContain("so-1, from the payment due on day 11.");
  expect(paid(at(prompt, 10 * DAY, []))).toBe(0);
});

test("a hold from anyone but whoever may instruct on the account changes nothing, and is answered in a sentence that says nothing of anyone else's instructions", () => {
  const m = bank();
  at(m, 0, [order("so-1", 0, "c1"), order("so-f", 0, "firm", { author: "clerk-1", in_position: "firm-clerk" }),
    statement("sig-1", 0, "signatories", { author: "boss-1", in_position: "firm-boss", speaks_for: "firm", addressed_to: ["bank"], visible_to: ["firm", "bank"], data: { account: "acc-firm", positions: ["firm-boss"] } })]);
  const nothing = (hold: string, what: string) => `Hold ${hold} does not apply to ${what}: we have no standing instruction of yours by that reference.`;
  // Someone else's order, an order nobody made, and the firm's order held by a post that may not sign for its account.
  const told = at(m, 5 * DAY, [hold("h1", 5 * DAY, "c2", ["so-1"]), hold("h2", 5 * DAY, "c1", ["so-9"]), hold("h3", 5 * DAY, "firm", ["so-f"], { author: "clerk-1", in_position: "firm-clerk" })]);
  expect(notes(told)).toEqual([[["c2-self"], nothing("h1", "so-1"), "h1"], [["c1-self"], nothing("h2", "so-9"), "h2"], [["firm-clerk"], nothing("h3", "so-f"), "h3"]]);
  // The one sentence, whether the instruction exists or not.
  expect(notes(told)[0]![1].replace(/h1|so-1/g, "X")).toBe(notes(told)[1]![1].replace(/h2|so-9/g, "X"));
  const day10 = at(m, 10 * DAY, []);
  expect([paid(day10, "so-1"), paid(day10, "so-f")]).toEqual([1, 0]); // (the clerk's order was never the firm's to give either: its signatory is the boss)
  // The boss's order, and the boss's hold on it: taken. One hold may name several; what isn't theirs is said beside what is.
  at(m, 11 * DAY, [order("so-g", 11 * DAY, "firm", { author: "boss-1", in_position: "firm-boss" })]);
  const mixed = at(m, 12 * DAY, [hold("h4", 12 * DAY, "firm", ["so-g", "so-1"], { author: "boss-1", in_position: "firm-boss" })]);
  expect(notes(mixed)).toEqual([[["firm-boss"], `${HOLD_NOTE.taken("h4", ["so-g, from the payment due on day 22"])} ${nothing("h4", "so-1")}`, "h4"]]);
  const day21 = at(m, 21 * DAY, []);
  expect([paid(day21, "so-1"), paid(day21, "so-g")]).toEqual([1, 0]);
});

test("a letter to the bank is answered with the writer's own standing instructions, each by its reference, and nobody else's", () => {
  const m = bank();
  at(m, 0, [order("so-1", 0, "c1"), order("so-2", 0, "c1", { data: { outcome: { money: { from: "acc-c1", to: "acc-union", amount: "2500" } }, every: 30 * DAY, first: 0 } }), order("so-3", 0, "c2")]);
  at(m, 12 * DAY, [hold("h1", 12 * DAY, "c1", ["so-1"])]);
  const letter = (from: string) => notes(at(m, 13 * DAY, [], [{ id: `m-${from}`, from: `${from}-self`, text: "What do you hold for me?" }]))[0]![1] as string;
  const mine = letter("c1");
  expect(mine).toContain("Your standing instructions with us: so-1: $1,000.00 from acc-c1 to acc-landlord every 10 days, next due day 21, on hold (h1); so-2: $25.00 from acc-c1 to acc-union every 30 days, next due day 31. ");
  expect(mine).toEndWith("To end a standing instruction, withdraw it by its reference; to pause one, put a hold on it by its reference, and withdraw the hold to resume.");
  expect(mine).not.toContain("so-3");
  expect(letter("c2")).toContain("Your standing instructions with us: so-3: $1,000.00 from acc-c2 to acc-landlord every 10 days, next due day 21. ");
  // Once the hold is lifted the list no longer says it is held; someone with none is told so.
  at(m, 14 * DAY, [lifted("w1", 14 * DAY, "h1")]);
  expect(letter("c1")).toContain("so-1: $1,000.00 from acc-c1 to acc-landlord every 10 days, next due day 21; so-2");
  const none = bank();
  expect(notes(at(none, DAY, [], [{ id: "m1", from: "c1-self", text: "Hello." }]))[0]![1]).toContain("You have no standing instructions with us. ");
  // A long list is cut where the bank's parameter says, and says how many more there are.
  const short = bank({ letter_lists: 1 });
  at(short, 0, [order("so-1", 0, "c1"), order("so-2", 0, "c1")]);
  expect(notes(at(short, DAY, [], [{ id: "m1", from: "c1-self", text: "Hello." }]))[0]![1]).toContain("so-1: $1,000.00 from acc-c1 to acc-landlord every 10 days, next due day 11; and 1 more. ");
});

test("holds and their lifting, with the bank going through orders only when due and going through every one at every plan: the same payments and the same letters", () => {
  const short = bank(), long = bank({ review_all: true });
  const script: { [day: number]: any[] } = {
    0: [order("so-1", 0, "c1"), order("so-2", 0, "c2")],
    7: [hold("h1", 7 * DAY, "c1", ["so-1", "so-2"])],
    23: [lifted("w1", 23 * DAY, "h1"), hold("h2", 23 * DAY, "c2", ["so-2"])],
    38: [hold("h3", 38 * DAY, "c1", ["so-1"])],
    44: [lifted("w2", 44 * DAY, "h2"), lifted("w3", 44 * DAY, "h3")],
  };
  const seen: string[] = [];
  for (let day = 0; day <= 70; day++) {
    const a = at(short, day * DAY, script[day] ?? []), b = at(long, day * DAY, script[day] ?? []);
    expect({ day, said: a.map((c) => [c.fn, c.args]) }).toEqual({ day, said: b.map((c) => [c.fn, c.args]) });
    for (const c of a) if (c.fn === "money") seen.push(`${day}:${c.args.per_request}`);
  }
  // so-1: held from day 8 to 23 (days 10 and 20 missed), and from day 39 to 44 (day 40 missed). so-2: never c1's to
  // hold, held by c2 from day 24 to 44 (days 30 and 40 missed).
  expect(seen).toEqual(["10:so-2", "20:so-2", "30:so-1", "50:so-1", "50:so-2", "60:so-1", "60:so-2", "70:so-1", "70:so-2"]);
});
