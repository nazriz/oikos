import { expect, test } from "bun:test";
import { earliestApplicationDay, formatDry, judgeDry, type DryFacts, type SeatFacts } from "../src/dry-check";

const seat = (o: Partial<SeatFacts>): SeatFacts => ({ seat: "s-system", position: "s", module: "city.finance_officer", forms: 1, listed: 0, ...o });
const facts = (o: Partial<DryFacts>): DryFacts => ({ daysRun: 60, fullRun: false, seats: [], founding: false, composer: false, founded: { count: 0 }, composed: { count: 0 }, ...o });
const one = (f: DryFacts, what: RegExp) => judgeDry(f).find((x) => what.test(x.what))!;

test("an office's clerk: shown with its first day, not shown once its day has passed, too early before it", () => {
  expect(one(facts({ seats: [seat({ booksDay: 2.5 })] }), /clerk/)).toMatchObject({ outcome: "shown", day: 2.5 });
  expect(one(facts({ seats: [seat({})] }), /clerk/).outcome).toBe("not shown");
  const early = one(facts({ daysRun: 6, seats: [seat({})] }), /clerk/);
  expect(early).toMatchObject({ outcome: "could not yet be seen", earliestDay: 10 });
  // (A seat named as one whose books wait on a matter is never faulted for the want of one in a short run.)
  expect(judgeDry(facts({ seats: [seat({})] }), { booksWhenOpen: ["s-system"] }).find((x) => /clerk/.test(x.what))!.outcome).toBe("could not yet be seen");
});

test("forms shown to a seat are counted, and none is a fault", () => {
  expect(one(facts({ seats: [seat({ forms: 15, booksDay: 1 })] }), /forms/)).toMatchObject({ outcome: "shown", count: 15 });
  expect(one(facts({ seats: [seat({ forms: 0, booksDay: 1 })] }), /forms/).outcome).toBe("not shown");
});

test("a tribunal seat: an application listed is shown; before the law's days it could not yet be seen, with the earliest day from the law's own figures", () => {
  const tri = (o: Partial<SeatFacts>) => seat({ seat: "t-system", position: "t", module: "tribunal.member", ...o });
  const law = { arrears_days: 30, notice_days: 30 };
  expect(earliestApplicationDay(law)).toBe(60);
  expect(earliestApplicationDay({ arrears_days: 14, notice_days: 21 })).toBe(35);
  expect(earliestApplicationDay(undefined)).toBeUndefined();
  const shown = one(facts({ daysRun: 120, law, seats: [tri({ listedDay: 76.2, listed: 78, booksDay: 76.2 })] }), /application/);
  expect(shown).toMatchObject({ outcome: "shown", day: 76.2, count: 78 });
  const early = one(facts({ daysRun: 30, law, seats: [tri({})] }), /application/);
  expect(early).toMatchObject({ outcome: "could not yet be seen", earliestDay: 60 });
  expect(early.detail).toContain("30 days of arrears and 30 days of notice");
  // Past the law's days, but not the whole pilot: a landlord's patience is its own, so still not a pass and not a fault.
  expect(one(facts({ daysRun: 90, law, seats: [tri({})] }), /application/).outcome).toBe("could not yet be seen");
  // The whole of the pilot's length and nothing listed: a fault.
  expect(one(facts({ daysRun: 120, fullRun: true, law, seats: [tri({})] }), /application/).outcome).toBe("not shown");
  // No law record in the run: no day is claimed.
  const nolaw = one(facts({ daysRun: 30, seats: [tri({})] }), /application/);
  expect(nolaw.outcome).toBe("could not yet be seen");
  expect(nolaw.earliestDay).toBeUndefined();
  // The clerk's books follow the cases.
  expect(one(facts({ daysRun: 30, law, seats: [tri({})] }), /clerk/)).toMatchObject({ outcome: "could not yet be seen", earliestDay: 60 });
});

test("a landlord seat: a tenant in arrears on its books", () => {
  const ll = (o: Partial<SeatFacts>) => seat({ seat: "l-system", position: "l", module: "firm.landlord", ...o });
  expect(one(facts({ seats: [ll({ booksDay: 11, booksOpenDay: 11 })] }), /arrears/)).toMatchObject({ outcome: "shown", day: 11 });
  expect(one(facts({ seats: [ll({})] }), /arrears/).outcome).toBe("could not yet be seen");
  expect(one(facts({ fullRun: true, seats: [ll({})] }), /arrears/).outcome).toBe("not shown");
});

test("founding: asked of the composer only if on; a founding with no ask is a fault; nothing founded in a short run is not a pass", () => {
  expect(judgeDry(facts({})).length).toBe(0);
  const on = { founding: true, composer: true };
  const ok = judgeDry(facts({ ...on, founded: { count: 1, firstDay: 23 }, composed: { count: 1, firstDay: 23.1 } }));
  expect(ok.map((x) => x.outcome)).toEqual(["shown", "shown"]);
  expect(judgeDry(facts({ ...on, founded: { count: 2, firstDay: 20 } })).map((x) => x.outcome)).toEqual(["shown", "not shown"]);
  expect(judgeDry(facts({ ...on })).map((x) => x.outcome)).toEqual(["could not yet be seen", "could not yet be seen"]);
  expect(judgeDry(facts({ ...on, fullRun: true })).map((x) => x.outcome)).toEqual(["not shown", "not shown"]);
});

test("the report says each outcome and counts them; it never reports a pass on what it did not see", () => {
  const lines = formatDry(judgeDry(facts({ daysRun: 30, law: { arrears_days: 30, notice_days: 30 }, seats: [seat({ booksDay: 1 }), seat({ seat: "t-system", position: "t", module: "tribunal.member" })] })));
  expect(lines.join("\n")).toContain("could not yet be seen in 30 days");
  expect(lines.at(-1)).toBe("  dry-run conditions: 3 shown, 0 not shown, 2 could not yet be seen");
});
