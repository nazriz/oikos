// The scope pilot's round 3, seed 4: Opus 5.5 and the code assistant alone (round3.ts says why).
//
//   bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/round3-s4.ts --out runs/scope-pilot-r3-s4 [--mock-models] [--resume]
import { build } from "./build";
import { ALLOW, ARMS, DAYS, ROUND3 } from "./plan";

export default build({ name: "scope-pilot-r3-s4", days: DAYS, seeds: [4], reviewDays: 14, arms: ARMS.filter((a) => ["code", "opus"].includes(a.name)), budget: ROUND3.seed4, allow: ALLOW.filter((x) => x.model.includes("opus")) });
