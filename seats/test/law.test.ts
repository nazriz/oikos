import { expect, test } from "bun:test";
import { evaluate, standingClaims, violations } from "../src/law";

const RIVER = "block.block == 'construct' && block.parcel in ['p00-11','p01-11'] ";
const PLANNING = "block.block == 'construct' && !holds_liberty(actor, 'build', block.parcel)";

test("a planning law flags building without a permit, and not with one", () => {
  const permit = { id: "rec.9", record: "claim", author: "planning", at: 0, visible_to: "public", position: "liberty", holder: "landlord-1", about: { action: "build", parcel: "p03-04" } } as any;
  const act = { block: "construct", parcel: "p03-04", structure_type: "house" };
  expect(evaluate(PLANNING, { block: act, actor: "landlord-1", now: 0 }, [])).toEqual({ value: true });
  expect(evaluate(PLANNING, { block: act, actor: "landlord-1", now: 0 }, standingClaims([permit]))).toEqual({ value: false });
  // A withdrawn permit no longer counts.
  const revoked = { id: "rec.10", record: "withdrawal", author: "planning", at: 5, visible_to: "public", withdraws: "rec.9" } as any;
  expect(evaluate(PLANNING, { block: act, actor: "landlord-1", now: 9 }, standingClaims([permit, revoked]))).toEqual({ value: true });
  expect(evaluate(RIVER, { block: { block: "construct", parcel: "p01-11" }, actor: "x", now: 0 }, [])).toEqual({ value: true });
});

test("decimals, time and regex are rejected", () => {
  expect(violations("x > 1.5")).toEqual(["literal doubleValue"]);
  expect(violations("timestamp('2026-01-01T00:00:00Z') < now").length).toBeGreaterThan(0);
  expect(violations(PLANNING)).toEqual([]);
});
