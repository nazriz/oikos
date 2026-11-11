// A short dry run of the study's town (study.ts) with every model played by the mock: the base town to the fork day,
// then one arm for `OIKOS_DRY_DAYS` days (3 by default), our translator alone serving every request. Nothing is called
// (the limits are only what the start checks against: the mock spends nothing).
// For checking the translator step end to end (it loads the served model, serves alone, and the report counts what it
// served by seat model) before a run that spends anything.
//   OIKOS_EXPERIMENT_MOCK_MODELS=1 bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/dry.ts --out <dir>
import { build, OFFICES, RATES_POST } from "./build";
import { ALLOW, ARMS } from "./plan";

const days = Number(process.env.OIKOS_DRY_DAYS ?? 3);
const spec = build({ name: "scope-study-dry", days, seeds: [7], reviewDays: 14, arms: ARMS.filter((a) => a.name === "code" || a.name === "haiku"), budget: { experiment_usd: 1, arm_usd: { haiku: 1 } }, allow: ALLOW, offices: [...OFFICES, RATES_POST], cohort: { by: "hand", every: 3, only: true }, holdLevels: "run", depth: "matter" });
export default { ...spec, seats: { ...(spec.seats ?? {}), mock_models: true } };
