// The scope pilot's labelled extra: gpt-6.1-sol through the Codex CLI on the owner's ChatGPT subscription, on the same
// town and seed as the main run, in an experiment of its own so that a shut Codex window holds up nothing else (its fork
// waits inside itself for at most 12 hours, then stops cleanly). Codex puts its own instructions under ours, which no
// arm of the main run has: read it apart (docs/real-models.md, "A ChatGPT subscription"). Its translator behind ours is
// Sonnet 5.5 on the API, as in every arm, and is what it spends.
//
//   bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/sol.ts --out runs/scope-pilot-sol [--mock-models] [--resume]
import { build } from "./build";
import { BUDGET, DAYS, SEEDS } from "./plan";

export default build({
  name: "scope-pilot-sol", days: DAYS, seeds: SEEDS, reviewDays: 14,
  arms: [{ name: "code", steward: { kind: "code" } }, { name: "sol", steward: { kind: "model", model: "codex/gpt-6.1-sol" } }],
  budget: BUDGET.sol,
});
