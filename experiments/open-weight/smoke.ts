// The open-weight smoke test (2026-11-08), for when OIKOS_FEATHERLESS_KEY exists: does each model of the list (models.ts)
// sit at an assistant's post at all? One short fork per model on the scope pilot's town and seed (its spec, build.ts),
// twenty days under the model, so a dozen sittings at each of the three posts and several matters, then the fixed debrief. It asks three things,
// read afterwards by check.ts: whether the prompts fit the model's context (no call refused before it was made, no
// sitting missed for a prompt too long), how long a call takes, and whether the model's answers can be read and its
// requests filled on the forms through the translator (drafts made and signed off, answers unread, the translator's
// refusals). It is not a measurement of anything the study asks.
//
//   bun orchestrator/src/cli.ts experiment run experiments/open-weight/smoke.ts --out runs/open-weight-smoke [--mock-models]
//   bun experiments/open-weight/check.ts runs/open-weight-smoke
//
// Keys: OIKOS_FEATHERLESS_KEY (the Developer plan; never the Chat plan, whose terms bar API traffic and automation). The
// translator is the study's: ours alone (2026-11-10); OIKOS_SMOKE_BEHIND names a model to put behind it (for example
// claude-code/claude-sonnet-5-5), as before. OIKOS_SMOKE_ONLY=<pair>[,<pair>] runs some.
import { build, OURS } from "../scope-pilot/build";
import type { Arm } from "../../orchestrator/src/experiment";
import { armName, OPEN_WEIGHT } from "./models";

/** Days under the model after the fork: enough for a dozen sittings at each post and several matters handed over (in the pilot's mock run, about 63 matters in 180 days over the three posts: about 7 in 20). */
export const SMOKE_DAYS = 20;
/** Room for a call's answer, thinking included: within a 32,768-token window beside the pilot's longest prompts
 * (prompts ran to about 16,000 tokens at the 99th percentile in the scope pilot's rounds 2 to 5). */
export const SMOKE_ROOM = 8_000;

const only = process.env.OIKOS_SMOKE_ONLY?.split(",").map((x) => x.trim()).filter(Boolean);
const models = OPEN_WEIGHT.filter((m) => !only?.length || only.includes(m.pair));

const arms: Arm[] = [
  { name: "code", steward: { kind: "code" } },
  ...models.map((m): Arm => ({ name: armName(m), steward: { kind: "model", model: m.model, params: { max_tokens: SMOKE_ROOM } } })),
];

// Limits, USD at Featherless's prices: a fork's twenty days and its debrief. The dearest (Qwen3.8-27B abliterated, $1.60
// in and $12 out a million) at the pilot's tokens a seat-day (about 15,000 in and 500 out, three seats) is about $1.80 for
// the days, more for a model that writes long thinking, and about $0.80 for the debrief (forty calls). The limit is $3 a
// fork; a debrief is never cut off by it, and a fork that reaches it stops cleanly and still says what the check needs.
const spec = build({
  name: "open-weight-smoke", days: SMOKE_DAYS, seeds: [1], reviewDays: 14, arms,
  budget: { experiment_usd: 3 * models.length, arm_usd: Object.fromEntries(models.map((m) => [armName(m), 3])) },
});
spec.seats = {
  ...spec.seats,
  translator: process.env.OIKOS_SMOKE_BEHIND ? { first: OURS, behind: process.env.OIKOS_SMOKE_BEHIND, arrangement: "then" } : { first: OURS, arrangement: "alone" },
  // (The owner chose Featherless for the study's open-weight arm on 2026-11-08: a token-metered key, so seated only by
  // name with this, and only under the dollar limits above.)
  allow_paid_api: true,
};
export default spec;
