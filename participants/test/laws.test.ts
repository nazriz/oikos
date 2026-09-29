import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { Book, lawInForce } from "../src/behaviour/common";

const law = (id: string, at: number, data: object) => ({ id, record: "statement", author: "x", at, visible_to: "public", speaks_for: "outside", kind: "law", text: id, data });
const seen = (t: number, records: object[]): Observation => ({ t, entity: "x", channels: { laws: { kind: "records", records } }, outcomes: [] }) as unknown as Observation;

test("the law in force on a matter is the latest standing one; a law withdrawn, or on another matter, isn't", () => {
  const book = new Book();
  expect(lawInForce(book, "rent_increases")).toBeUndefined();
  book.absorb(seen(0, [law("a", 0, { law: "rent_increases", review_months: 12 }), law("b", 0, { law: "industrial_action", notice_days: 3 })]));
  expect(lawInForce(book, "rent_increases")?.review_months).toBe(12);
  book.absorb(seen(100, [law("c", 100, { law: "rent_increases", review_months: 24 })]));
  expect(lawInForce(book, "rent_increases")).toMatchObject({ id: "c", review_months: 24 });
  book.absorb(seen(200, [{ id: "w", record: "withdrawal", author: "x", at: 200, visible_to: "public", speaks_for: "outside", withdraws: "c" }]));
  expect(lawInForce(book, "rent_increases")?.id).toBe("a");
  expect(lawInForce(book, "industrial_action")?.notice_days).toBe(3);
});
