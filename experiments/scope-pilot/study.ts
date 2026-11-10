// The study's town after design step H6 (docs/design/handing-over.md section 6), as an assigned condition: who has an
// assistant, and at what level, is set by the experiment and stated openly, as the pilots in effect did. The offices
// (the finance office, the factory and the rates post) and one adult in three have engaged provider A by hand on day 1
// (`delegation.commit`, each principal's own word in its parameters), at the pilot's modest levels, and hold those levels
// and the service to the end of the run; no other adult is offered the service. Why assigned: the code-only screen showed that by their own rule the principals
// take short papers back as soon as a hold ends (a draft's review costs them more than writing the paper), and households
// hand over almost nothing (docs/decisions.md, H6). The organic option, everyone deciding by their own rule from an offer
// that reaches them (a free tier beside the paid one), is `study-reach.ts`.
//
// A request for more scope made under a held level is, as things stand, declined with the hold's date; whether the
// principal may grant more while a level is held is being settled in the answers work (design H2), not here.
//
// Its spending limits are nought: no model arm runs on it until they are set (plan.ts).
//
//   bun experiments/scope-pilot/screen.ts experiments/scope-pilot/study.ts [--out <dir>]
import { build, OFFICES, RATES_POST, type Cohort } from "./build";
import { ALLOW, ARMS, DAYS } from "./plan";

export const study = (cohort: Cohort, holdLevels: "month" | "run", name: string) =>
  build({ name, days: DAYS, seeds: [7], reviewDays: 14, arms: ARMS, budget: { experiment_usd: 0, arm_usd: {} }, allow: ALLOW, offices: [...OFFICES, RATES_POST], cohort, holdLevels });

export default study({ by: "hand", every: 3, only: true }, "run", "scope-study");
