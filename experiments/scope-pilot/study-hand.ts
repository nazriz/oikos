// The study's town (study.ts) with the households' cohort engaged by hand, as rounds 1 to 5 did (`delegation.commit`),
// at one adult in three: what the desk would be handed if the study, not each person, decided who engages. A comparison
// for the owner's choice (docs/design/handing-over.md H6), never the study's design by default.
//
//   bun experiments/scope-pilot/screen.ts experiments/scope-pilot/study-hand.ts [--out <dir>]
import { study } from "./study";

export default study({ by: "hand", every: 3 }, "scope-study-hand");
