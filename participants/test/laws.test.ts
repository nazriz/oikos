import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { Book, breaches } from "../src/behaviour/common";

const DAY = 86_400;
const law = (id: string, condition?: string, deontic = "must_not") => ({ id, record: "statement", author: "x", at: 0, visible_to: "public", speaks_for: "outside", kind: "law", text: id,
  adico: { attribute: "landlords", deontic, aim: "raise rent" }, ...(condition ? { formal: { language: "cel", condition } } : {}) });
const seen = (t: number, records: object[]): Observation => ({ t, entity: "x", channels: { laws: { kind: "records", records } }, outcomes: [] }) as unknown as Observation;
const notice = (from: number, lastFrom: number) => ({ block: "publish", kind: "rent_increase", data: { from, last_from: lastFrom } });

test("an act breaches the prohibitions in force whose formal condition it meets; a withdrawn law, a law without one, or an obligation doesn't bind this way", () => {
  const book = new Book();
  const rule = `block.kind == 'rent_increase' && (block.data.from - now < ${60 * DAY} || block.data.from - block.data.last_from < ${360 * DAY})`;
  book.absorb(seen(0, [law("a", rule), law("words-only"), law("duty", "true", "must")]));
  const now = 400 * DAY;
  expect(breaches(book, notice(now + 30 * DAY, 0), "landlord", now).map((l) => l.id)).toEqual(["a"]); // too little notice
  expect(breaches(book, notice(now + 60 * DAY, 200 * DAY), "landlord", now).map((l) => l.id)).toEqual(["a"]); // too soon after the last
  expect(breaches(book, notice(now + 60 * DAY, 0), "landlord", now)).toEqual([]);
  // Another act entirely: not what the law is about.
  expect(breaches(book, { block: "publish", kind: "notice", data: {} }, "landlord", now)).toEqual([]);
  // Withdrawn by whoever made it: no longer binds.
  book.absorb(seen(now, [{ id: "w", record: "withdrawal", author: "x", at: now, visible_to: "public", speaks_for: "outside", withdraws: "a" }]));
  expect(breaches(book, notice(now + DAY, 0), "landlord", now)).toEqual([]);
});
