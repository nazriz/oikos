// The first true pilot (docs/handover.md, "Now", step 5; written 2026-11-11, not yet run): the study's town (study.ts:
// the finance office, the factory and the rating office, and one adult in three, engaged with provider A by hand on day
// 1 and held to the run's end as a floor, the organisations handing over invoices and delivery notes as what happened,
// the households their wants), one seed, forked on day 30 and run 90 days to day 120. In the assistants' seats
// (`assistant-a`, `assistant-a-personal`: the finance, factory and rating offices' assistants and the provider's desk,
// four seats): Claude Haiku 5.5 and Claude Sonnet 5.5 through the owner's Claude subscription (`claude -p`, the
// `claude-code/` route: never the Anthropic API key), the code assistant as the reference, gpt-6.1-sol through the
// owner's Codex subscription (a labelled extra, not on equal terms), and a local open-weight model (LOCAL, below) where
// the local test found one that can hold a seat. Our translator alone (`decide/round3-s2`, build.ts `OURS`,
// nobody behind it); the framing unstated (a seat that asks is told the truth; every seat is debriefed); each model at
// its default effort.
//
// Since 2026-11-11 an assistant's seat keeps to its own post and to the working hours of the office it serves (one
// sitting a working day; its "done for n days" honoured; docs/behaviour/assistants.md, "When it sits").
//
// The estimate (2026-11-11, measured: docs/decisions.md, "What a claude -p seat call costs"), for 90 days:
//   - sittings: at most one a working day a seat; this spec's dry run (the mock in every seat, no model called) sat 260
//     times an arm, every working day (a model that says it is done for longer sits less);
//   - calls: about 1.9 a sitting (the real models of round 5: Haiku 972 calls in 509 sittings, Sonnet 622 in 372; the
//     dry run's mock 1.68): about 490 sitting calls an arm, a few to fold the notebook, and the debriefs, about 13
//     questions a seat (52);
//   - plan dollars, as the adapter reckons (Claude Code's own reckoning of Haiku 5.5 and Sonnet 5.5, $5 a million in,
//     $6.25 written to its hour's cache, $0.50 read, $25 out: orchestrator/prices.json). Measured on 16 calls of three
//     of this spec's own seat prompts through `claude -p`: a sitting's first call writes the seat's prompt (about 12,000
//     tokens with the tools) to the cache, the day before's having lapsed, $0.13 on average (4 calls, $0.12 to $0.14); a
//     later call of the sitting reads it from the cache, $0.064 on average (8 calls, $0.035 to $0.10), most of it the
//     answer's tokens out (about 1,000 to 2,400, nine tenths of them reasoning: the answer itself is about 200). A
//     sitting about $0.13 + 0.9 x $0.064 = $0.19; 260 sittings about $49; the debriefs about $3; Haiku about $52 an arm.
//     Sonnet by the same table, the same tokens: about $52 (not called: how many tokens it reasons with under Claude
//     Code is the unknown, either way);
//   - wall time: about 11 s a call (measured, 5 to 15 s), about two calls at once: under an hour of calls a fork, the
//     forks side by side (forksAtOnce 3), so about 1.5 hours in all if the plan's window stays open (a shut one is
//     waited for, up to 12 hours, inside the fork);
//   - the Codex arm (gpt-6.1-sol on the owner's ChatGPT subscription, flat rate: nothing reckoned a call): about 490
//     sitting calls and 52 debrief questions, 5 to 7 s a call (measured 2026-11-10), about an hour. NOT ON EQUAL TERMS:
//     the Codex CLI puts its own instructions under ours (docs/real-models.md), so its seat is not told only what the
//     others are told; a labelled extra, never pooled with the Claude arms;
//   - the local arm (qwen2.5:14b-instruct on this machine's ollama, free): in the local test it made 63 sitting calls in
//     14 days at three seats, 47 s a call on average (32 s median, 205 s the longest, three at once, its prompts up to
//     23,564 tokens): about 540 calls in 90 days at four seats, about 3 hours.
// Limits: half again over each estimate, so that no arm can spend more than half again its estimate; the fork's reserve
// for its debriefs (kept back from the start, priced as Claude Code reckons since 2026-11-11) covers every seat's.
//
// To start it (on the run server, from the checkout; detached and kept awake; never deletes a run; the local arm needs
// `OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_NUM_PARALLEL=3 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve` running and
// `ollama pull qwen2.5:14b-instruct` done): first the dry run,
//   OIKOS_TRANSLATOR_MODELS=$HOME/oikos/runs/translator-model bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/first-pilot.ts --out $HOME/oikos/runs/scope-first-pilot-dry --mock-models
// then, with the owner's go-ahead on the estimate, the one command:
//   env -u ANTHROPIC_API_KEY OIKOS_LOCAL_CONTEXT=32768 OIKOS_TRANSLATOR_MODELS=$HOME/oikos/runs/translator-model nohup bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/first-pilot.ts --out $HOME/oikos/runs/scope-first-pilot > $HOME/oikos/runs/scope-first-pilot.out 2>&1 & caffeinate -i -w $! &
import type { Arm } from "../../orchestrator/src/experiment";
import { build, OFFICES, RATES_POST } from "./build";

/** Days run after the fork (on day 30). */
export const DAYS = 90;
export const SEED = 7;

/** The local open-weight model, where the local test (experiments/open-weight/local.ts) found one that can hold a seat;
 * absent: no local arm. */
export const LOCAL: string | undefined = "qwen2.5:14b-instruct";

/** Each arm's hard limit, USD as the adapter reckons (half again over its estimate). */
export const LIMITS = { haiku: 78, sonnet: 78 };

const ROOM = { max_tokens: 16_000 };
export const ARMS: Arm[] = [
  { name: "code", steward: { kind: "code" } },
  { name: "haiku", steward: { kind: "model", model: "claude-code/claude-haiku-5-5", params: ROOM } },
  { name: "sonnet", steward: { kind: "model", model: "claude-code/claude-sonnet-5-5", params: ROOM } },
  // (Not on equal terms: the Codex CLI puts its own instructions under ours. A labelled extra; flat rate, no limit.)
  { name: "sol", steward: { kind: "model", model: "codex/gpt-6.1-sol", params: ROOM } },
  // (A local model writes plain notes, not tool calls: participants/src/llm/note.ts.)
  ...(LOCAL ? [{ name: "local", steward: { kind: "model" as const, model: `ollama/${LOCAL}`, params: { answer: "text", max_tokens: 2_000 } } }] : []),
];

const spec = build({ name: "scope-first-pilot", days: DAYS, seeds: [SEED], reviewDays: 14, arms: ARMS, budget: { experiment_usd: LIMITS.haiku + LIMITS.sonnet, arm_usd: LIMITS },
  offices: [...OFFICES, RATES_POST], cohort: { by: "hand", every: 3, only: true }, holdLevels: "run", depth: "matter", wants: true });
// (One machine serves the local model and Claude Code's calls run one process each: three calls at once a fork.)
// (Each Claude arm's own limit, and none for Codex's flat rate or the local model, which cost nothing a call: an
// experiment-wide limit would leave them a share of nothing.)
spec.seats = { ...spec.seats, calls_at_once: 3, budget: { arm_usd: LIMITS } };
export default spec;
