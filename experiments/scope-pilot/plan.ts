// The option chosen for the scope pilot (README.md, "Cost"): its length, seeds, arms and hard spending limits. Changing
// this file changes the specs: a run already begun is taken up (--resume) only with the spec it began with.
import type { Arm } from "../../orchestrator/src/experiment";

/** Days run after the fork. */
export const DAYS = 90;
export const SEEDS = [1];

export const ARMS: Arm[] = [
  { name: "code", steward: { kind: "code" } },
  { name: "haiku", steward: { kind: "model", model: "anthropic/claude-haiku-5-5" } },
  { name: "sonnet", steward: { kind: "model", model: "anthropic/claude-sonnet-5-5" } },
  { name: "opus", steward: { kind: "model", model: "anthropic/claude-opus-5-5" } },
  { name: "fable", steward: { kind: "model", model: "anthropic/claude-fable-5-1" } },
  // (Through the Codex CLI on the owner's subscription: a labelled extra, its own experiment so that it never holds up
  // the others; Codex's own instructions sit under ours, a confound: docs/real-models.md.)
];

/** Otherwise refused models, allowed here on the API's prepaid credit: the brief of 2026-11-07 relayed the owner's
 * choice of models for this pilot; to be confirmed by him at "go" (the refusal of 2026-10-09 was of his plan's usage). */
export const ALLOW = [
  { model: "anthropic/claude-opus-5-5", why: "Scope pilot, 2026-11-07: Opus 5.5 as an arm on the API's prepaid credit, by the owner's choice of models as relayed in the brief; the plan-usage refusal does not apply to the API credit." },
  { model: "anthropic/claude-fable-5-1", why: "Scope pilot, 2026-11-07: Fable 5.1 as an arm on the API's prepaid credit, by the owner's choice of models as relayed in the brief; the plan-usage refusal does not apply to the API credit." },
];

/** Hard limits, USD, at the API's published prices: per arm over its seeds, and for each experiment whole. */
export const BUDGET = {
  pilot: { experiment_usd: 112, arm_usd: { haiku: 12, sonnet: 25, opus: 35, fable: 40 } },
  rare: { experiment_usd: 25, arm_usd: { sonnet: 25 } },
  sol: { experiment_usd: 5, arm_usd: { sol: 5 } },
};
