// The scope pilot's round 3 (2026-11-08): more seeds on round 2's code and spec (180 days after a day-30 fork; the
// finance office, factory-1's manager and a cohort of one adult in 15), for Opus 5.5 and Haiku 5.5 only: the owner,
// after round 2, would rather have more Opus runs than any more Fable, and no Sonnet cells. Seeds 2 and 3 here (Opus and
// Haiku); seed 4 is round3-s4.ts (Opus alone), so that Haiku runs two seeds and Opus three. Limits from round 2's real
// spend a seed (Opus $15.15, Haiku $0.90) and what was left of the credit ($54.04 on 2026-11-08, less a margin of $4):
// plan.ts, ROUND3.
//
//   bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/round3.ts --out runs/scope-pilot-r3 [--mock-models] [--resume]
import { build } from "./build";
import { ALLOW, ARMS, DAYS, ROUND3 } from "./plan";

export default build({ name: "scope-pilot-r3", days: DAYS, seeds: [2, 3], reviewDays: 14, arms: ARMS.filter((a) => ["code", "haiku", "opus"].includes(a.name)), budget: ROUND3.seeds23, allow: ALLOW.filter((x) => x.model.includes("opus")) });
