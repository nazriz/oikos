// The scope pilot's form cell: the same town and seed, the request form under a neutral title with its fields described
// without "more" ("A note on the service's terms"; build.ts, NEUTRAL), since a form titled as a request for more scope
// may itself cue requests. The code assistant and Sonnet 5.5, to be set beside the main run's arms of the same names.
//
//   bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/neutral.ts --out runs/scope-pilot-neutral [--mock-models] [--resume]
import { build } from "./build";
import { ARMS, BUDGET, DAYS, SEEDS } from "./plan";

export default build({ name: "scope-pilot-neutral", days: DAYS, seeds: SEEDS, reviewDays: 14, neutralForm: true, arms: ARMS.filter((a) => ["code", "sonnet"].includes(a.name)), budget: BUDGET.neutral });
