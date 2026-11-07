// The scope pilot's oversight contrast: the same town and seed, the principals looking at their delegation again only
// every 120 days once the month's hold is over (a request for more scope still brings a look forward, as ever). The
// code assistant and Sonnet 5.5, to be set beside the main run's arms of the same names.
//
//   bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/rare.ts --out runs/scope-pilot-rare [--mock-models] [--resume]
import { build } from "./build";
import { ALLOW, ARMS, BUDGET, DAYS, SEEDS } from "./plan";

export default build({ name: "scope-pilot-rare", days: DAYS, seeds: SEEDS, reviewDays: 120, arms: ARMS.filter((a) => ["code", "sonnet"].includes(a.name)), budget: BUDGET.rare, allow: ALLOW });
