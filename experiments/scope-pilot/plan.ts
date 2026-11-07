// The option chosen for the scope pilot (README.md, "Cost"): its length, seeds, arms and hard spending limits. Changing
// this file changes the specs: a run already begun is taken up (--resume) only with the spec it began with.
import type { Arm } from "../../orchestrator/src/experiment";

/** Opus 5.5 and Fable 5.1 as arms. The harness refuses both as seats by the owner's rule of 2026-10-09 ("it drains usage
 * too much", of his plan); this pilot would run them on the API's prepaid credit instead. **The owner's call, not
 * made here:** false until he says so; true adds both arms with the reason below (seats.allow_models) and their limits. */
export const OPUS_AND_FABLE = false;

/** Days run after the fork (the fork is on day 30, a month after the principals engaged). */
export const DAYS = 90;
export const SEEDS = [1];

/** Room for a call's output, thinking included, the same for every model (the participant's default, 4,000, would cut
 * off a model that thinks at length: Fable 5.1's answers ran to 4,100 tokens at the 90th percentile in past pilots). */
const ROOM = { max_tokens: 16_000 };

export const ARMS: Arm[] = [
  { name: "code", steward: { kind: "code" } },
  { name: "haiku", steward: { kind: "model", model: "anthropic/claude-haiku-5-5", params: ROOM } },
  { name: "sonnet", steward: { kind: "model", model: "anthropic/claude-sonnet-5-5", params: ROOM } },
  ...(OPUS_AND_FABLE ? [
    { name: "opus", steward: { kind: "model" as const, model: "anthropic/claude-opus-5-5", params: ROOM } },
    { name: "fable", steward: { kind: "model" as const, model: "anthropic/claude-fable-5-1", params: ROOM } },
  ] : []),
  // (gpt-6.1-sol through the Codex CLI is an experiment of its own, sol.ts, so that it never holds up the others.)
];

/** With OPUS_AND_FABLE: the owner's word, as the harness asks for it (filled in with his date when he gives it). */
export const ALLOW = OPUS_AND_FABLE ? [
  { model: "anthropic/claude-opus-5-5", why: "Scope pilot: Opus 5.5 as an arm on the API's prepaid credit, by the owner's word (the plan-usage refusal of 2026-10-09 is not about the API credit)." },
  { model: "anthropic/claude-fable-5-1", why: "Scope pilot: Fable 5.1 as an arm on the API's prepaid credit, by the owner's word (the plan-usage refusal of 2026-10-09 is not about the API credit)." },
] : [];

/** Hard limits, USD, at the API's published prices: per arm over its seeds, and for each experiment whole. Together
 * with the scope set's check they stay under the credit (190.20): the run cannot spend past them, and a spent credit
 * stops a fork cleanly besides. README.md, "Cost", has what each is expected to buy. */
export const BUDGET = OPUS_AND_FABLE
  ? {
    // (183 in all: the main run 141, the rare-oversight and neutral-form cells 18 each, sol's translator 4, the scope set 2.)
    pilot: { experiment_usd: 141, arm_usd: { haiku: 8, sonnet: 18, opus: 35, fable: 80 } },
    rare: { experiment_usd: 18, arm_usd: { sonnet: 18 } },
    neutral: { experiment_usd: 18, arm_usd: { sonnet: 18 } },
    sol: { experiment_usd: 4, arm_usd: { sol: 4 } },
    scopeSet: 2,
  }
  : {
    // (68 in all: the main run 26, the two cells 18 each, sol's translator 4, the scope set 2.)
    pilot: { experiment_usd: 26, arm_usd: { haiku: 8, sonnet: 18 } },
    rare: { experiment_usd: 18, arm_usd: { sonnet: 18 } },
    neutral: { experiment_usd: 18, arm_usd: { sonnet: 18 } },
    sol: { experiment_usd: 4, arm_usd: { sol: 4 } },
    scopeSet: 2,
  };
