// The study's town after design step H6 (docs/design/handing-over.md section 6): the scope pilot's spec with the work a
// seat needs made referable. The provider's offer to organisations takes a firm's dispatch and supply papers and the
// rates post's notices (the profile's offers); the rates post is seated as a principal beside the finance office and the
// factory; and the households' service reaches one adult in three, each of whom takes it up, or not, by their own rule.
// Read by the code-only screen (screen.ts) before any model is run; its spending limits are nought, so no model arm runs
// on it until they are set (plan.ts).
//
//   bun experiments/scope-pilot/screen.ts experiments/scope-pilot/study.ts [--out <dir>]
import { build, OFFICES, RATES_POST, type Cohort } from "./build";
import { ALLOW, ARMS, DAYS } from "./plan";

export const study = (cohort: Cohort, name = "scope-study") =>
  build({ name, days: DAYS, seeds: [7], reviewDays: 14, arms: ARMS, budget: { experiment_usd: 0, arm_usd: {} }, allow: ALLOW, offices: [...OFFICES, RATES_POST], cohort });

export default study({ by: "reach", every: 3 });
