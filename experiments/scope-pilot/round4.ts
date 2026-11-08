// The scope pilot's round 4 (2026-11-08): what was left of the credit, spent as round 3 was, on round 2's code and spec:
// Opus 5.5 on seeds 5 and 6 (this file) and Haiku 5.5 on seeds 4 and 5 (round4-haiku.ts). Limits: plan.ts, ROUND4.
//
//   bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/round4.ts --out runs/scope-pilot-r4 [--mock-models] [--resume]
import { build } from "./build";
import { ALLOW, ARMS, DAYS, ROUND4 } from "./plan";

export default build({ name: "scope-pilot-r4", days: DAYS, seeds: [5, 6], reviewDays: 14, arms: ARMS.filter((a) => ["code", "opus"].includes(a.name)), budget: ROUND4.opus, allow: ALLOW.filter((x) => x.model.includes("opus")) });
