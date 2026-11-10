// The study's town (study.ts) with organic take-up: the households' service reaches one adult in three, who see its
// offers (a free tier beside the paid one) and each take it up, or not, by their own rule, from their own papers; the
// rest are offered nothing. The offices engage by hand and hold their levels a month after the fork, then their own rule
// weighs each kind again. The option for the larger study; the assigned condition is study.ts.
//
//   bun experiments/scope-pilot/screen.ts experiments/scope-pilot/study-reach.ts [--out <dir>]
import { study } from "./study";

export default study({ by: "reach", every: 3 }, "month", "scope-study-reach");
