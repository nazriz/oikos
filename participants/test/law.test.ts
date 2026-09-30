import { expect, test } from "bun:test";
import { evaluate, standingClaims, violations } from "../src/law";

const RIVER = "block.block == 'construct' && block.cells.exists(c, c in ['cell.0.11','cell.1.11']) ";
const PLANNING = "block.block == 'construct' && !holds_liberty(actor, 'build', block.lot)";

test("a planning law flags building without a permit, and not with one", () => {
  const permit = { id: "rec.9", record: "claim", author: "planning", at: 0, visible_to: "public", position: "liberty", holder: "landlord-1", about: { action: "build", object: "lot-03-04" } } as any;
  const act = { block: "construct", at: "cell.3.4", cells: ["cell.3.4"], lot: "lot-03-04", structure_type: "house" };
  expect(evaluate(PLANNING, { block: act, actor: "landlord-1", now: 0 }, [])).toEqual({ value: true });
  expect(evaluate(PLANNING, { block: act, actor: "landlord-1", now: 0 }, standingClaims([permit]))).toEqual({ value: false });
  // A withdrawn permit no longer counts.
  const revoked = { id: "rec.10", record: "withdrawal", author: "planning", at: 5, visible_to: "public", withdraws: "rec.9" } as any;
  expect(evaluate(PLANNING, { block: act, actor: "landlord-1", now: 9 }, standingClaims([permit, revoked]))).toEqual({ value: true });
  expect(evaluate(RIVER, { block: { block: "construct", at: "cell.1.11", cells: ["cell.1.11"] }, actor: "x", now: 0 }, [])).toEqual({ value: true });
});

test("decimals, time and regex are rejected", () => {
  expect(violations("x > 1.5")).toEqual(["literal doubleValue"]);
  expect(violations("timestamp('2026-01-01T00:00:00Z') < now").length).toBeGreaterThan(0);
  expect(violations(PLANNING)).toEqual([]);
});

test("a condition that can't be parsed is an error verdict, not a crash", () => {
  const r = evaluate("block.block ==", { block: {}, actor: "a", now: 0 }, []);
  expect("error" in r && r.error.startsWith("parse")).toBe(true);
  expect(violations("(((")[0]).toStartWith("parse");
  // (And the reader goes on reading after it.)
  expect(evaluate(PLANNING, { block: { block: "construct", lot: "l" }, actor: "a", now: 0 }, [])).toEqual({ value: true });
});
