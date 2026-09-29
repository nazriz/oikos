// Signs of trouble that don't stop a run, said loudly (docs/reliability.md).

import { expect, test } from "bun:test";
import { healthWarnings } from "../src/batch";

test("a module falling behind, unexpected refusals and participant errors are warned about; the expected races aren't", () => {
  const profile = { modules: { "firm.retailer": { ms: 100, steps: 1000 }, "citizen.default": { ms: 100, steps: 100_000 } }, kernel: {} };
  // A shop out of actions in 5% of its steps: warned; citizens in 0.1% of theirs: not.
  const w = healthWarnings({ profile, health: { cut_short: { "firm.retailer": { wakes: 50, participants: 3 }, "citizen.default": { wakes: 100, participants: 40 } }, refused: { not_present: 12, insufficient_funds: 2 } }, participantErrors: 1 });
  expect(w.some((x) => x.startsWith("firm.retailer") && x.includes("50 of 1,000"))).toBe(true);
  expect(w.some((x) => x.startsWith("citizen.default"))).toBe(false);
  expect(w.some((x) => x.includes("insufficient_funds 2") && !x.includes("not_present"))).toBe(true);
  expect(w.some((x) => x.includes("1 participant error"))).toBe(true);
  // A healthy run: nothing to say.
  expect(healthWarnings({ profile, health: { cut_short: {}, refused: { not_present: 3, capacity_exceeded: 1 } }, participantErrors: 0 })).toEqual([]);
});
