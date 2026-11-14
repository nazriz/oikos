// The study's town (study.ts) with the obstacle laws at a level, for the code-only screen (docs/design/obstacles.md,
// step B8): `OIKOS_OBSTACLES` 0, 1 or 2 (default 1); `OIKOS_DESKS=2` splits the households' cohort between provider A's
// desk and provider B's, each with a cohort of its own. The screen runs its code arm only; no model is called, and its
// spending limits are nought. (A model arm on two desks would seat B's desk too: `post` names A's kinds alone.)
//
//   OIKOS_OBSTACLES=2 OIKOS_DESKS=2 bun experiments/scope-pilot/screen.ts experiments/scope-pilot/study-obstacles.ts
import { build, OFFICES, RATES_POST } from "./build";
import { ALLOW, ARMS, DAYS } from "./plan";

const level = Number(process.env.OIKOS_OBSTACLES ?? 1) as 0 | 1 | 2;
const two = process.env.OIKOS_DESKS === "2";

export default build({
  name: `scope-study-obstacles-${level}${two ? "-two-desks" : ""}`, days: DAYS, seeds: [7], reviewDays: 14, arms: ARMS, budget: { experiment_usd: 0, arm_usd: {} },
  allow: ALLOW, offices: [...OFFICES, RATES_POST], cohort: { by: "hand", every: 3, only: true, difficulty: true }, holdLevels: "run", depth: "matter", wants: true, obstacles: level, secondDesk: two,
});
