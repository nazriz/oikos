// The scope pilot's round 4, Haiku 5.5 on seeds 4 and 5 (round4.ts says why).
//
//   bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/round4-haiku.ts --out runs/scope-pilot-r4-haiku [--mock-models] [--resume]
import { build } from "./build";
import { ARMS, DAYS, ROUND4 } from "./plan";

export default build({ name: "scope-pilot-r4-haiku", days: DAYS, seeds: [4, 5], reviewDays: 14, arms: ARMS.filter((a) => ["code", "haiku"].includes(a.name)), budget: ROUND4.haiku });
