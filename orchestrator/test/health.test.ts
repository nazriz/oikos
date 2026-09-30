// Signs of trouble that don't stop a run, said loudly (docs/reliability.md).

import { expect, test } from "bun:test";
import { healthWarnings } from "../src/batch";

test("a module falling behind, unexpected refusals and participant errors are warned about; the expected races aren't", () => {
  const profile = { modules: { "firm.retailer": { ms: 100, steps: 1000 }, "citizen.default": { ms: 100, steps: 100_000 } }, kernel: {} };
  // A shop whose acts waited two days for its manager: warned; citizens whose waited an hour at most: not.
  const w = healthWarnings({ profile, health: { backlog: { "firm.retailer": { acts: 1000, waited: 1000 * 3600, longest: 2 * 86_400 }, "citizen.default": { acts: 100, waited: 100, longest: 3600 } }, repeats: { "citizen.default": { times: 86_400, unit: "c1-self", act: "[occupy]" }, "firm.retailer": { times: 3, unit: "s-system", act: "[work]" } }, refused: { not_present: 12, insufficient_funds: 2 } }, participantErrors: 1 });
  expect(w.some((x) => x.startsWith("firm.retailer") && x.includes("waited 2 days"))).toBe(true);
  // A citizen trying the same thing every second of a day (a retry loop): warned; a shop's three: not.
  expect(w.some((x) => x.startsWith("citizen.default: c1-self did the same thing 86,400 times"))).toBe(true);
  expect(w.some((x) => x.startsWith("firm.retailer") && x.includes("same thing"))).toBe(false);
  expect(w.some((x) => x.startsWith("citizen.default") && x.includes("waited"))).toBe(false);
  expect(w.some((x) => x.includes("insufficient_funds 2") && !x.includes("not_present"))).toBe(true);
  expect(w.some((x) => x.includes("1 participant error"))).toBe(true);
  // A healthy run: nothing to say.
  expect(healthWarnings({ profile, health: { backlog: {}, repeats: {}, refused: { not_present: 3, capacity_exceeded: 1 } }, participantErrors: 0 })).toEqual([]);
});
