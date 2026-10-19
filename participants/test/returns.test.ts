// The days returns of tax withheld from wages fall due (participants/src/shared/returns.ts): the calendar function on a
// shared table of cases, each profile's rule against its charges, and what a law lists.

import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dueFrom, nextReturn, returnsOf, returnRulesOf } from "../src/shared/returns";
import { taxLawOf } from "../src/shared/tax";

const DAY = 86_400;
const root = join(import.meta.dir, "../..");
const table = JSON.parse(readFileSync(join(root, "contracts/test/returns-calendar.json"), "utf8")) as { cases: { rule: any; after: number; due: number; from: number; to: number }[] };

test("the next due day of a rule, and the period it reports, on the shared table", () => {
  for (const c of table.cases) {
    const r = nextReturn(c.rule, c.after * DAY);
    expect({ rule: c.rule.id, after: c.after, due: r.due / DAY, from: r.from / DAY, to: r.to / DAY }).toEqual({ rule: c.rule.id, after: c.after, due: c.due, from: c.from, to: c.to });
  }
});

test("a return due today is still to come for the books, and the day after it the next is shown", () => {
  const rule = { id: "m9", day: 9 };
  expect(dueFrom(rule, 38 * DAY + 3_600).due).toBe(38 * DAY);
  expect(dueFrom(rule, 38 * DAY + DAY).due).toBe(68 * DAY);
});

test("each profile's returns report every charge of its tax law exactly once, on days of a month", () => {
  const dir = join(root, "worlds/profiles");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const pf = p.values.public_finance;
    expect(pf.returns?.length, f).toBeGreaterThan(0);
    expect(returnRulesOf(pf.returns)?.length, f).toBe(pf.returns.length); // (all well formed)
    const law = taxLawOf("law", { charges: pf.income_tax.charges.map((c: any) => ({ ...c, account: "a" })), returns: pf.returns }, "outside")!;
    const seen = returnsOf(law).flatMap((r) => r.charges ?? []);
    expect(seen.sort(), f).toEqual(law.charges.map((c) => c.id).sort());
    expect(Object.keys(p.sources).includes("public_finance.returns"), f).toBe(true);
  }
});

test("a law that lists no return has its charges reported monthly, on the first day of the month after; a charge no return names falls under that", () => {
  const law = taxLawOf("law", { charges: [{ id: "a", schedule: [], account: "x" }, { id: "b", schedule: [], account: "x" }] }, "o")!;
  const rules = returnsOf(law);
  expect(rules.length).toBe(1);
  expect(rules[0]).toMatchObject({ day: 1, charges: ["a", "b"] });
  const part = taxLawOf("law", { charges: [{ id: "a", schedule: [], account: "x" }, { id: "b", schedule: [], account: "x" }], returns: [{ id: "r", day: 9, charges: ["a"] }] }, "o")!;
  expect(returnsOf(part).map((r) => [r.id, r.day, r.charges])).toEqual([["r", 9, ["a"]], ["return-rest", 1, ["b"]]]);
});
