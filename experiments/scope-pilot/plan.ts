// The option chosen for the scope pilot (README.md, "Cost"): its length, seeds, arms and hard spending limits. Changing
// this file changes the specs: a run already begun is taken up (--resume) only with the spec it began with.
import type { Arm } from "../../orchestrator/src/experiment";

/** Opus 5.5 and Fable 5.1 as arms. The harness refuses both as seats by the owner's rule of 2026-10-09 ("it drains usage
 * too much", of his plan): a guard on cost and usage. **The owner allowed both for this pilot on 2026-11-07**, on the
 * API's prepaid credit and within its hard limits (docs/decisions.md, 2026-11-07). False takes both arms out. */
export const OPUS_AND_FABLE = true;

/** Days run after the fork (the fork is on day 30, a month after the principals engaged). Round 1 ran 90; round 2, 180. */
export const DAYS = 180;
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

/** With OPUS_AND_FABLE: the owner's word, as the harness asks for it. */
export const ALLOW = OPUS_AND_FABLE ? [
  { model: "anthropic/claude-opus-5-5", why: "The owner, 2026-11-07: Opus 5.5 allowed as a seat in the scope pilot, on the API's prepaid credit, within the pilot's hard limits (the refusal of 2026-10-09 guards his plan's usage)." },
  { model: "anthropic/claude-fable-5-1", why: "The owner, 2026-11-07: Fable 5.1 allowed as a seat in the scope pilot, on the API's prepaid credit, within the pilot's hard limits (the refusal of 2026-10-09 guards his plan's usage)." },
] : [];

/** Hard limits, USD, at the API's published prices: per arm over its seeds, and for each experiment whole. Round 2
 * (2026-11-08): the credit had about $134 left after round 1 (which spent about $56), and must be spent before 11
 * November; the owner's cap for round 2 is $125 in all, with a margin kept. Sized from round 1's real spend a seat-day
 * (Fable: the finance office's seat $0.053, the desk's $0.21; Opus about 0.46 of Fable's, Sonnet 0.12, Haiku 0.015),
 * twice the days, a busier factory seat in the landlord's place, and the desk's prompt about half as long (its remits no
 * longer set out at every sitting) on two and a half times the matters: expected about Fable 56, Opus 26, Sonnet 8,
 * Haiku 1, each cell 9 (uncertain by half either way). A fork that reaches its limit stops cleanly and is debriefed out
 * of what was kept back; the limits hold whatever the estimate. Round 1's limits were 141, 18, 18, 4 and 2. */
type Limits = { experiment_usd: number; arm_usd: { [arm: string]: number } };
export const BUDGET: { pilot: Limits; rare: Limits; neutral: Limits; sol: Limits; scopeSet: number } = OPUS_AND_FABLE
  ? {
    // (123 in all: the main run 99, the rare-oversight and neutral-form cells 12 each; sol is not run in round 2, and the
    // scope set was read in round 1.)
    pilot: { experiment_usd: 99, arm_usd: { haiku: 4, sonnet: 12, opus: 28, fable: 55 } },
    rare: { experiment_usd: 12, arm_usd: { sonnet: 12 } },
    neutral: { experiment_usd: 12, arm_usd: { sonnet: 12 } },
    sol: { experiment_usd: 4, arm_usd: { sol: 4 } },
    scopeSet: 2,
  }
  : {
    pilot: { experiment_usd: 16, arm_usd: { haiku: 4, sonnet: 12 } },
    rare: { experiment_usd: 12, arm_usd: { sonnet: 12 } },
    neutral: { experiment_usd: 12, arm_usd: { sonnet: 12 } },
    sol: { experiment_usd: 4, arm_usd: { sol: 4 } },
    scopeSet: 2,
  };

/** Round 3's limits (2026-11-08). The credit's spend by the runs' own records: round 1 $56.85 (main 45.57, the cells 4.31
 * and 5.33, sol 0.38, the scope set 1.27), round 2 $79.31 (main 64.69, the cells 7.79 and 6.82): $136.16 of $190.20, so
 * $54.04 left; $4 kept as a margin, $49.50 the hard cap. Opus a seed $15.50 (round 2's seed spent $15.15: a seed that
 * calls more stops cleanly at its limit and is debriefed), Haiku a seed $1.50 (round 2's, $0.90). */
export const ROUND3: { seeds23: Limits; seed4: Limits } = {
  seeds23: { experiment_usd: 34, arm_usd: { opus: 31, haiku: 3 } },
  seed4: { experiment_usd: 15.5, arm_usd: { opus: 15.5 } },
};

/** Round 4's limits (2026-11-08). Spent by the runs' records through round 3: $166.19 of $190.20 (round 3: 20.52 and
 * 9.50), so $24.01 left; $2.01 kept as a margin, $22.00 the hard cap: Opus $10.25 a seed, Haiku $0.75 a seed. A known
 * cost of so small a limit: the end's reserve (the debriefs, kept back from the start: run.ts, `keptBackFor`) is sized
 * from the seats to be asked and capped at half the limit, so about half of each limit is not for the sitting days.
 * Round 3's Opus forks, limited to $15.50, stopped at days 150 to 159 of 210 having spent $8.5 (and $1 on the
 * debriefs); at $10.25 these will stop near day 110, about 80 days under the model. */
export const ROUND4: { opus: Limits; haiku: Limits } = {
  opus: { experiment_usd: 20.5, arm_usd: { opus: 20.5 } },
  haiku: { experiment_usd: 1.5, arm_usd: { haiku: 1.5 } },
};
