// A rates bill is one thing on two papers (docs/behaviour/government.md, "One bill, two papers"): the city's notice to
// the owner and the right it records against them, made together. The sixth living pilot's letting office paid the
// notice on day 32 and, because its books listed only the claim and read it as unpaid, paid the claim on day 74: the
// same 2,977.86 twice. A payment that names either paper settles the bill, for the office's books as for the rates office.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { Book } from "../src/shared/common";
import { Money, owedByUs } from "../src/readers/openbooks";
import { inCurrency } from "../src/money";

inCurrency(PROFILE.values.currency);
const DAY = 86_400;
const notice = (id: string, due: number, amount = 297_786) => ({ id, at: 30 * DAY, record: "statement", kind: "rates_notice", author: "rates-system", speaks_for: "city", addressed_to: ["landlord-38"], visible_to: ["city", "landlord-38"], data: { amount, due, account: "acc-city", lots: ["lot-1"] }, text: "Rates notice" });
const claim = (id: string, due: number, amount = 297_786) => ({ id, at: 30 * DAY, record: "claim", position: "right", holder: "city", counterparty: "landlord-38", author: "rates-system", speaks_for: "city", visible_to: ["city", "landlord-38"], about: { kind: "rates", amount, account: "acc-city", due, lots: ["lot-1"] } });
const book = (...records: any[]) => { const b = new Book(); b.absorb({ t: 31 * DAY, entity: "landlord-38", participant: "x", woke_for: "cadence", outcomes: [], inbox: [], channels: { mine: { kind: "records", records } } } as any); return b; };
const money = (...settles: string[]) => { const m = new Money(); for (const s of settles) m.settled.add(s); return m; };
const owed = (b: Book, m: Money) => owedByUs(b, "landlord-38", m).flatMap((h) => h.items);

const D1 = 60 * DAY, D2 = 150 * DAY;
const papers = [notice("rec.1", D1), claim("rec.2", D1)];

test("a rates bill stands once in the books: the claim, with the notice that came with it named", () => {
  const items = owed(book(...papers), money());
  expect(items.map((i) => i.id)).toEqual(["rec.2"]);
  expect(items[0]!.line).toContain("rec.1");
});

test("paying the notice settles the bill, and so does paying the claim: the books list nothing either way", () => {
  expect(owed(book(...papers), money("rec.1"))).toEqual([]);
  expect(owed(book(...papers), money("rec.2"))).toEqual([]);
});

test("a payment settles only its own bill: another instalment, or another sum, stays owed", () => {
  const two = book(...papers, notice("rec.3", D2), claim("rec.4", D2));
  expect(owed(two, money("rec.1")).map((i) => i.id)).toEqual(["rec.4"]);
  const other = book(notice("rec.1", D1, 100), claim("rec.2", D1));
  expect(owed(other, money("rec.1")).map((i) => i.id)).toEqual(["rec.2"]);
});

test("a fine has no notice: only a payment naming it settles it", () => {
  const fine = { ...claim("rec.7", D1), about: { kind: "fine", amount: 5_000, due: D1 } };
  expect(owed(book(fine, notice("rec.1", D1, 5_000)), money("rec.1")).map((i) => i.id)).toEqual(["rec.7"]);
  expect(owed(book(fine), money("rec.7"))).toEqual([]);
});
