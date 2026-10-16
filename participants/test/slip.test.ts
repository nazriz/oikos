// The one way a module makes a decision wrong by chance (participants/src/slip.ts; foundations F7).
import { expect, test } from "bun:test";
import { slip, slipPpm, type Slipper } from "../src/slip";
import { Randomness } from "../src/rng";

const rng = (k: string) => new Randomness(5n).stream(["slip-test", k]);
const table = { person: { "publish/benefit_decision": { bps: 2_000, friction: true }, "publish/venue_decision": { bps: 5_000 }, "transfer/wages": { bps: 3_650, per: "year" as const, friction: true } }, system: { "publish/benefit_decision": { bps: 100 } } };
const ctx = (over: Partial<Slipper> & { dial?: number } = {}): Slipper => ({ rng, world: { slip: table, ...(over.dial !== undefined ? { dials: { friction_bps: over.dial } } : {}) }, ...(over.kind ? { kind: over.kind } : {}) });
const rate = (c: Slipper, task: string, n = 4000, o = {}) => { let k = 0; for (let i = 0; i < n; i++) if (slip(c, task, `case-${i}`, o)) k++; return k / n; };

test("a task with no row, and a world with no table, never slip", () => {
  expect(slipPpm(ctx({ dial: 10_000 }), "publish/loan_decision")).toBe(0);
  expect(rate(ctx({ dial: 10_000 }), "publish/loan_decision")).toBe(0);
  expect(rate({ rng, world: {} }, "publish/venue_decision")).toBe(0);
});

test("a row is the performer's: a person's rate is not a system's, and a system with no row has none", () => {
  const person = rate(ctx({ dial: 10_000 }), "publish/benefit_decision"), system = rate(ctx({ dial: 10_000, kind: "system" }), "publish/benefit_decision");
  expect(person).toBeGreaterThan(0.17); expect(person).toBeLessThan(0.23);
  expect(system).toBeLessThan(0.03);
  expect(rate(ctx({ dial: 10_000, kind: "system" }), "publish/venue_decision")).toBe(0);
});

test("the friction dial scales a row that says so, and only that row", () => {
  expect(rate(ctx(), "publish/benefit_decision")).toBe(0); // (no dial: nothing arises)
  expect(rate(ctx({ dial: 0 }), "publish/benefit_decision")).toBe(0);
  expect(slipPpm(ctx({ dial: 20_000 }), "publish/benefit_decision")).toBe(400_000);
  expect(slipPpm(ctx(), "publish/venue_decision")).toBe(500_000); // (a rule of judgement: not scaled, and in force with no dial)
  expect(slipPpm(ctx({ dial: 1 }), "publish/venue_decision")).toBe(500_000);
});

test("a row per year is the chance over the days of exposure, and a performer's lean moves it", () => {
  const c = ctx({ dial: 10_000 });
  expect(slipPpm(c, "transfer/wages")).toBe(0); // (no days of exposure, no chance)
  expect(slipPpm(c, "transfer/wages", { days: 7 })).toBe(Math.floor((3_650 * 10_000 * 7) / (100 * 365)));
  expect(slipPpm(c, "transfer/wages", { days: 7, lean: (b) => b * 2 })).toBe(2 * slipPpm(c, "transfer/wages", { days: 7 }));
  expect(slipPpm(c, "transfer/wages", { days: 365 * 100 })).toBe(1_000_000);
});

test("a case slips the same way every time it is drawn", () => {
  const c = ctx({ dial: 10_000 });
  const first = Array.from({ length: 200 }, (_, i) => slip(c, "publish/benefit_decision", `case-${i}`));
  expect(Array.from({ length: 200 }, (_, i) => slip(c, "publish/benefit_decision", `case-${i}`))).toEqual(first);
});
