// The scope pilot's round 5 (2026-11-08): a confirmation round on the world with the pilot's faults fixed (main c06bc249:
// W1, W2, W4, W6, the debrief reserve sized seat by seat, empty debrief answers; W5 still open). Sonnet 5.5 and Haiku 5.5,
// one new seed (7), round 2's spec otherwise (180 days after a day-30 fork). It asks two things: whether the faults
// recur, and whether a fork now runs its full length under the corrected reserve. Limits: plan.ts, ROUND5.
//
//   bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/round5.ts --out runs/scope-pilot-r5 [--mock-models] [--resume]
import { build } from "./build";
import { ARMS, DAYS, ROUND5 } from "./plan";

export default build({ name: "scope-pilot-r5", days: DAYS, seeds: [7], reviewDays: 14, arms: ARMS.filter((a) => ["code", "haiku", "sonnet"].includes(a.name)), budget: ROUND5 });
