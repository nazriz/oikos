// The bank's payment system (docs/behaviour/bank-payment-system.md), on what it's shown alone: a standing order paid
// on its due dates; a payment the account can't cover not made, the holder told in the words both sides rely on, and
// that due date never tried again; and the difference between that and a payment the world refused.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { bankPaymentSystem } from "../src/behaviour/bank";
import { PAYEE_DIED, PAYMENT_FAILED } from "../src/behaviour/common";
import { inCurrency } from "../src/money";
import { Randomness } from "../src/rng";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { callsOf, context, DAY, MONTH, statement, wake } from "./stepping";

inCurrency(PROFILE.values.currency);

const who = { kind: "directory", positions: [], entities: [{ entity: "c1", kind: "person", name: "C One", participant: "c1-self" }, { entity: "c2", kind: "person", name: "C Two", participant: "c2-self" }] };
const custody = (balances: { [holder: string]: number }) => ({ kind: "accounts", transactions: [], accounts: Object.entries(balances).map(([holder, balance]) => ({ account: `acc-${holder}`, holder, custodian: "bank", currency: "AUD", balance: String(balance) })) });
const request = (id: string, at: number, from: string, amount: number, x: object = {}) => statement(id, at, "request", { author: `${from}-self`, speaks_for: from, addressed_to: ["bank"], visible_to: [from, "bank"],
  data: { outcome: { money: { from: `acc-${from}`, to: "acc-landlord", amount: String(amount), for: "Rent." } }, ...x } });
const bank = () => bankPaymentSystem.create(context("bank-pay-system", "bank", {}, { position: "bank-pay" }));
const at = (m: any, t: number, records: any[], balances: { [account: string]: number }) => wake(m, t, { requests: { kind: "records", records }, custody: custody(balances), who }, { entity: "bank" }).said;

test("the words a bank uses for a payment that failed for want of money are the words its readers know it by, and no other note of the bank's reads as one", () => {
  const note = PAYMENT_FAILED.note("$1,000.00", "acc-landlord", "rec.12");
  expect(note).toBe("Payment of $1,000.00 to acc-landlord (request rec.12) failed: insufficient funds.");
  expect(PAYMENT_FAILED.is(note)).toBe(true);
  // The bank's other notes about a request: a payment the world refused, and a request it can't carry out.
  expect(PAYMENT_FAILED.is("Payment of $1,000.00 to acc-landlord (request rec.12) couldn't be made: there's no such account.")).toBe(false);
  expect(PAYMENT_FAILED.is("Request rec.12 not carried out: this bank doesn't keep account acc-x.")).toBe(false);
  expect(PAYMENT_FAILED.is("Your application failed.")).toBe(false);
});

test("a standing order is paid on each due date (first at the request's time plus `first`, or plus `every`), naming its request", () => {
  const m = bank();
  const so = request("so-1", 0, "c1", 100_000, { every: MONTH, first: 0 });
  const later = request("so-2", 0, "c2", 50_000, { every: MONTH }); // no `first`: due a period on
  const day0 = at(m, 0, [so, later], { c1: 500_000, c2: 500_000 });
  expect(day0.map((c) => [c.fn, c.args])).toEqual([["money", { to: "acc-landlord", amount: "$1000.00", for: "Rent", from: "acc-c1", per_request: "so-1" }]]); // (with what the payer said it was for: the line on a statement)
  expect(at(m, DAY, [], { c1: 400_000, c2: 500_000 })).toEqual([]);
  const day30 = at(m, MONTH, [], { c1: 400_000, c2: 500_000 });
  expect(day30.map((c) => [c.args.per_request, c.args.amount])).toEqual([["so-1", "$1000.00"], ["so-2", "$500.00"]]);
  // Waking late (two due dates gone by), it pays each once.
  expect(at(m, 3 * MONTH + DAY, [], { c1: 400_000, c2: 500_000 }).filter((c) => c.args.per_request === "so-1").length).toBe(2);
});

test("a payment the account can't cover isn't made: the holder is told, once, in the bank's words, and that due date isn't tried again", () => {
  const m = bank();
  const so = request("so-1", 0, "c1", 100_000, { every: MONTH, first: 0 });
  // Day 0: $999.99 in the account, a cent short.
  const day0 = at(m, 0, [so], { c1: 99_999 });
  expect(day0.map((c) => [c.fn, c.args])).toEqual([["message", { to: ["c1"], text: PAYMENT_FAILED.note("$1,000.00", "acc-landlord", "so-1"), re: "so-1" }]]);
  expect(day0[0]!.args.text).toBe("Payment of $1,000.00 to acc-landlord (request so-1) failed: insufficient funds.");
  // The money arrives the next day: nothing. The missed payment is the payer's to make good, not the bank's to retry.
  expect(at(m, DAY, [], { c1: 900_000 })).toEqual([]);
  expect(at(m, 29 * DAY, [], { c1: 900_000 })).toEqual([]);
  // The next due date: one payment, the month's, and not the one missed as well.
  const day30 = at(m, MONTH, [], { c1: 900_000 });
  expect(day30.map((c) => [c.fn, c.args.per_request, c.args.amount])).toEqual([["money", "so-1", "$1000.00"]]);
  // Short again a month on: told again, for that due date.
  expect(at(m, 2 * MONTH, [], { c1: 5 }).map((c) => c.fn)).toEqual(["message"]);
});

test("a one-off payment that fails is told and done with; and payments due together are met in order while the money lasts", () => {
  const m = bank();
  const once = request("pay-1", DAY, "c1", 70_000);
  expect(at(m, DAY, [once], { c1: 100 }).map((c) => [c.fn, c.args.text])).toEqual([["message", "Payment of $700.00 to acc-landlord (request pay-1) failed: insufficient funds."]]);
  expect(at(m, 2 * DAY, [], { c1: 900_000 })).toEqual([]);
  // Three one-offs from one account holding enough for the first two (by due time, then request id): the third fails,
  // counted against what the first two leave.
  const three = [request("pay-a", 3 * DAY, "c2", 60_000), request("pay-b", 3 * DAY, "c2", 30_000), request("pay-c", 3 * DAY, "c2", 20_000)];
  const did = at(m, 3 * DAY, three, { c1: 0, c2: 100_000 });
  expect(did.map((c) => [c.fn, c.fn === "money" ? c.args.per_request : c.args.re])).toEqual([["money", "pay-a"], ["money", "pay-b"], ["message", "pay-c"]]);
});

test("a payment the world refuses is reported to the holder in other words (it \"couldn't be made\"), which don't read as a payment failed for want of money", () => {
  const m = bank();
  const channels = { requests: { kind: "records", records: [request("pay-1", DAY, "c1", 70_000)] }, custody: custody({ c1: 100_000 }), who };
  const obs = (more: object) => ({ t: DAY, entity: "bank", participant: "bank-pay-system", channels, inbox: [], outcomes: [], woke_for: "cadence", ...more }) as unknown as Observation;
  expect(callsOf(m.step(obs({}), undefined as any) as any).map((c) => c.fn)).toEqual(["money"]);
  const told = callsOf(m.step(obs({ woke_for: "done", outcomes: [{ action: "a", t: DAY, status: "refused", refusal: { code: "unknown_account" } }], channels: { ...channels, requests: { kind: "records", records: [] } } }), undefined as any) as any);
  expect(told.map((c) => [c.fn, c.args])).toEqual([["message", { to: ["c1"], text: "Payment of $700.00 to acc-landlord (request pay-1) couldn't be made: there's no such account.", re: "pay-1" }]]);
  expect(PAYMENT_FAILED.is(told[0]!.args.text)).toBe(false);
});

test("someone who pays by standing order into the account of a person the bank has been told has died is told so when a payment next falls due, and at each after until they stop it; it is still paid, into the estate", () => {
  const m = bank();
  const wages = statement("r1", 0, "request", { author: "c1-self", speaks_for: "c1", addressed_to: ["bank"], visible_to: ["c1", "bank"],
    data: { outcome: { money: { from: "acc-c1", to: "acc-c2", amount: "50000", for: "Wages." } }, every: 14 * DAY, first: 14 * DAY } });
  const death = statement("d1", 20 * DAY, "death_registration", { speaks_for: "city", addressed_to: ["bank"], visible_to: ["city", "bank"], data: { deceased: "c2" } });
  const paid = (said: any[]) => said.filter((c) => c.fn === "money").length;
  const told = (said: any[]) => said.filter((c) => c.fn === "message" && PAYEE_DIED.who(c.args.text));
  const first = at(m, 14 * DAY, [wages], { c1: 500_000, c2: 0 });
  expect([paid(first), told(first).length]).toEqual([1, 0]);
  // Told of the death between pay days: nothing is said until a payment falls due.
  expect(told(at(m, 21 * DAY, [death], { c1: 500_000, c2: 50_000 }))).toEqual([]);
  const next = at(m, 28 * DAY, [], { c1: 500_000, c2: 50_000 });
  expect(told(next).map((c) => [c.args.to, c.args.re, PAYEE_DIED.who(c.args.text)])).toEqual([[["c1-self"], "r1", "c2"]]);
  // (Told at each payment, not once, since foundations F6: a letter to an office with nobody in it is lost, and the wage went on for good.)
  expect(told(at(m, 35 * DAY, [], { c1: 500_000, c2: 100_000 }))).toEqual([]);
  expect(told(at(m, 42 * DAY, [], { c1: 500_000, c2: 100_000 })).map((c) => [c.args.re, PAYEE_DIED.who(c.args.text)])).toEqual([["r1", "c2"]]);
});

test("going through standing orders only when they're due gives the payments and replies that going through every one at every plan does", () => {
  const people = ["c1", "c2", "c3", "c4", "c5", "c6"];
  for (const seed of [1n, 2n, 3n, 4n, 5n, 6n]) {
    const rng = new Randomness(seed).stream(["bank", "orders"]);
    const pick = <T>(xs: T[]): T => xs[rng.below(xs.length)]!;
    const short = bankPaymentSystem.create(context("bank-pay-system", "bank", { courts: ["tribunal"], town: "city" }, { position: "bank-pay" }));
    const long = bankPaymentSystem.create(context("bank-pay-system", "bank", { courts: ["tribunal"], town: "city", review_all: true }, { position: "bank-pay" }));
    // The world as the bank is shown it: who has an account and what's in it, who is who, and what has been written.
    const balances: { [holder: string]: number } = Object.fromEntries([...people.slice(0, 4), "firm", "city"].map((h) => [h, 300_000]));
    let known = people.slice(0, 3); // the people the directory names (a request from one it doesn't name isn't its holder's)
    let directory: any;
    let boss = "firm"; // whose the position "firm-boss" is (it changes hands: an order written in it is the firm's only while it's the firm's)
    const redirect = () => (directory = { kind: "directory", positions: [{ position: "firm-clerk", entity: "firm" }, { position: "firm-boss", entity: boss }],
      entities: [{ entity: "firm", kind: "organisation", name: "Firm" }, ...known.map((c) => ({ entity: c, kind: "person", name: c, participant: `${c}-self` }))] });
    redirect();
    const written: any[] = [];
    let n = 0, paid = 0, told = 0;
    for (let hour = 0; hour < 24 * 45; hour += 1 + rng.below(9)) {
      const t = hour * 3600;
      const records: any[] = [];
      for (let i = rng.below(4); i > 0; i--) {
        const id = `r${String(++n).padStart(4, "0")}`, who = pick(people);
        const money = { from: `acc-${pick([who, who, who, pick(people), "firm"])}`, to: `acc-${pick(people)}`, amount: String(pick([500, 2_000, 40_000, 0, 900_000])), for: "x" };
        const by = pick([{ author: `${who}-self`, speaks_for: who }, { author: `${who}-self`, speaks_for: who }, { author: `${pick(people)}-self`, speaks_for: who },
          { author: "clerk-1", in_position: pick(["firm-clerk", "firm-boss"]), speaks_for: "firm" }, { author: "genesis", speaks_for: who }]);
        const firm = by.speaks_for === "firm";
        const data: any = pick<() => any>([
          () => ({ outcome: { money: firm ? { ...money, from: "acc-firm" } : money }, every: pick([3600, 7200, DAY, 3 * DAY, 10 * DAY]), ...(rng.below(2) ? { first: pick([0, 3600, 5 * DAY]) } : {}) }),
          () => ({ outcome: { money: firm ? { ...money, from: "acc-firm" } : money }, every: pick([DAY, 2 * DAY]) }),
          () => ({ outcome: { money } }),
          () => ({ from: money.from, payments: [{ to: "acc-c1", amount: "700" }, { to: "acc-c2", amount: pick(["300", "0"]) }] }),
          () => ({ outcome: { account: { holder: pick([who, "c6"]) } }, ...(rng.below(2) ? { every: DAY } : {}) }),
          () => ({ outcome: { occupancy: { who, in: "somewhere" } }, every: DAY }),
          () => ({ outcome: { money: { ...money, to: 7 } }, every: DAY }),
        ])();
        records.push(statement(id, t, "request", { ...by, addressed_to: [pick(["bank", "bank", "bank", "other-bank"])], visible_to: [who, "bank"], data }));
      }
      const some = (what: number) => rng.below(what) === 0;
      // (A withdrawal: mostly by whoever wrote the order, in whose name it was; now and then by someone else, or by nobody the bank can place.)
      if (written.length && some(6)) {
        const w = pick(written);
        const own = { author: w.author, ...(w.in_position ? { in_position: w.in_position } : {}), speaks_for: w.speaks_for };
        records.push({ id: `w${++n}`, at: t, record: "withdrawal", ...pick<object>([own, own, own, { author: `${pick(people)}-self`, speaks_for: pick(people) }, { author: "x" }]), withdraws: w.id, visible_to: ["bank"] });
      }
      if (some(8)) records.push(statement(`s${++n}`, t, "signatories", { author: "clerk-1", in_position: "firm-clerk", speaks_for: "firm", addressed_to: ["bank"], visible_to: ["bank"], data: { account: "acc-firm", positions: [pick(["firm-clerk", "firm-boss"])] } }));
      if (some(60)) records.push(statement(`d${++n}`, t, "death_registration", { speaks_for: "city", data: { deceased: pick(people), partner: pick(people), adult_children: [pick(people)] } }));
      if (some(40)) records.push(statement(`g${++n}`, t, "garnishee_order", { speaks_for: "tribunal", addressed_to: ["bank"], visible_to: ["bank"], data: { debtor: pick(people), to: `acc-${pick(people)}`, amount: "1500", claim: "claim-1" } }));
      // An account closed, or opened; someone the directory comes to name.
      if (some(30) && Object.keys(balances).length > 2) delete balances[pick(Object.keys(balances))];
      if (some(20)) balances[pick([...people, "firm"])] ??= 250_000;
      if (some(25) && known.length < people.length) {
        known = people.slice(0, known.length + 1);
        redirect();
      }
      if (some(6)) {
        boss = boss === "firm" ? "elsewhere" : "firm";
        redirect();
      }
      for (const h of Object.keys(balances)) if (some(5)) balances[h] = pick([0, 1_000, 60_000, 400_000]);
      written.push(...records.filter((r) => r.record === "statement"));
      const shown = () => ({ requests: { kind: "records", records }, custody: custody(balances), who: directory });
      const [a, b] = [wake(short, t, shown(), { entity: "bank" }).said, wake(long, t, shown(), { entity: "bank" }).said];
      expect(a).toEqual(b);
      paid += a.filter((c) => c.fn === "money").length;
      told += a.filter((c) => c.fn === "message").length;
    }
    // (The stream does make the bank pay, and refuse.)
    expect(paid).toBeGreaterThan(100);
    expect(told).toBeGreaterThan(20);
  }
});

test("who wrote an instruction is looked up before it is read: each writer once, a look's worth at a time; nobody is shown who's who", () => {
  // The bank with a look-up of who's who (`who`: its channel onto it) and nothing known of anyone yet.
  const m = bankPaymentSystem.create(context("bank-pay-system", "bank", { who: "who" }, { position: "bank-pay" }));
  const nobody = { kind: "directory", positions: [], entities: [] };
  const step = (t: number, records: any[], directory: any) => m.step({ t, participant: "bank-pay-system", entity: "bank", as: "bank-pay", status: "active", outcomes: [], inbox: [], drafts: [],
    channels: { requests: { kind: "records", records }, custody: custody({ c1: 500_000, c2: 500_000, firm: 500_000 }), who: directory } } as unknown as Observation, {} as any);
  const fromClerk = statement("so-3", 0, "request", { author: "boss-self", in_position: "firm-clerk", speaks_for: "firm", addressed_to: ["bank"], visible_to: ["firm", "bank"],
    data: { outcome: { money: { from: "acc-firm", to: "acc-landlord", amount: "700", for: "Rent." } }, every: MONTH, first: 0 } });
  // Three instructions arrive from two people and a firm's clerk: before reading them, it asks who each writer is.
  const first = step(0, [request("so-1", 0, "c1", 100_000, { every: MONTH, first: 0 }), request("so-2", 0, "c2", 50_000, { every: MONTH, first: 0 }), fromClerk, request("so-4", 0, "c1", 5, { every: MONTH, first: 0 })], nobody);
  expect(first).toEqual({ type: "look", looks: [{ channel: "who", who: { participant: "c1-self" } }, { channel: "who", who: { participant: "c2-self" } }, { channel: "who", who: { position: "firm-clerk" } }] });
  // The answers come at once (its address book now names them), and it pays as their holders instructed.
  const known = { kind: "directory", positions: [{ position: "firm-clerk", entity: "firm" }], entities: who.entities };
  const paid = step(0, [], known) as any;
  expect(paid.type).toBe("call");
  expect((paid.call.match(/per_request=/g) ?? []).length).toBe(4);
  // Someone the directory does not know (the look-up found nobody) is asked after once, and their instruction is not
  // their account holder's: never paid, and never asked about again.
  const stranger = statement("so-9", DAY, "request", { author: "ghost", speaks_for: "c1", addressed_to: ["bank"], visible_to: ["c1", "bank"], data: { outcome: { money: { from: "acc-c1", to: "acc-landlord", amount: "9", for: "x" } } } });
  expect(step(DAY, [stranger], known)).toEqual({ type: "look", looks: [{ channel: "who", who: { participant: "ghost" } }] });
  expect((step(DAY, [], known) as any).type).toBe("wait");
  expect((step(2 * DAY, [], known) as any).type).toBe("wait");
});

test("a payment that fell due before its standing order was withdrawn is still made; nothing due after is", () => {
  // (The bank goes through its instructions a day apart. An employer that replaced a wage order in the hours after
  // its pay day, for a new rate, lost its worker that pay: found 2026-10-08.)
  const m = bank();
  const so = request("so-1", 0, "c1", 100_000, { every: MONTH, first: 0 });
  expect(at(m, 0, [so], { c1: 900_000 }).map((c) => c.args.per_request)).toEqual(["so-1"]);
  expect(at(m, MONTH - DAY / 2, [], { c1: 900_000 })).toEqual([]);
  // Due at a month; withdrawn two hours after, and replaced by an order whose first payment is a month on. The bank
  // next looks half a day after the due time.
  const gone = { id: "w-1", at: MONTH + 7200, record: "withdrawal", author: "c1-self", speaks_for: "c1", withdraws: "so-1", visible_to: ["bank", "c1"] };
  const next = request("so-2", MONTH + 7200, "c1", 110_000, { every: MONTH, first: MONTH - 7200 });
  const did = at(m, MONTH + DAY / 2, [gone, next], { c1: 900_000 });
  expect(did.map((c) => [c.fn, c.args.per_request, c.args.amount])).toEqual([["money", "so-1", "$1000.00"]]);
  // After that the old order pays nothing more, and the new one pays on its own dates.
  expect(at(m, MONTH + 2 * DAY, [], { c1: 900_000 })).toEqual([]);
  expect(at(m, 2 * MONTH + DAY / 2, [], { c1: 900_000 }).map((c) => [c.args.per_request, c.args.amount])).toEqual([["so-2", "$1100.00"]]);
  // An order withdrawn before its next due time pays nothing more.
  const m2 = bank();
  expect(at(m2, 0, [so], { c1: 900_000 }).length).toBe(1);
  expect(at(m2, MONTH + DAY / 2, [{ ...gone, at: MONTH - 7200 }], { c1: 900_000 })).toEqual([]);
});
