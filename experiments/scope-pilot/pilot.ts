// The scope pilot's main run: every model as a parallel arm on the same town and seed, principals that look at their
// delegation again every 14 days once the month's hold is over (README.md; build.ts; the option chosen in plan.ts).
//
//   bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/pilot.ts --out runs/scope-pilot [--mock-models] [--resume]
import { build } from "./build";
import { ALLOW, ARMS, BUDGET, DAYS, SEEDS } from "./plan";

export default build({ name: "scope-pilot", days: DAYS, seeds: SEEDS, reviewDays: 14, arms: ARMS, budget: BUDGET.pilot, allow: ALLOW });
