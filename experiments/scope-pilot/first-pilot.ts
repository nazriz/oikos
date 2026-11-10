// The first true pilot (docs/handover.md, "Now", step 5; written 2026-11-11, not yet run): the study's town (study.ts:
// the finance office, the factory and the rating office, and one adult in three, engaged with provider A by hand on day
// 1 and held to the run's end as a floor, the organisations handing over invoices and delivery notes as what happened,
// the households their wants), one seed, forked on day 30 and run 90 days to day 120. In the assistants' seats
// (`assistant-a`, `assistant-a-personal`: the finance, factory and rating offices' assistants and the provider's desk,
// four seats): Claude Haiku 5.5 and Claude Sonnet 5.5 through the owner's Claude subscription (`claude -p`, the
// `claude-code/` route: never the Anthropic API key), the code assistant as the reference, and a local open-weight model
// (LOCAL, below) where the local test found one that can hold a seat. Our translator alone (`decide/pod-small-v3-s2`,
// nobody behind it); the framing unstated (a seat that asks is told the truth; every seat is debriefed); each model at
// its default effort.
//
// Since 2026-11-11 an assistant's seat keeps to its own post and to the working hours of the office it serves (one
// sitting a working day; its "done for n days" honoured; docs/behaviour/assistants.md, "When it sits").
//
// The estimate (2026-11-11, from the mock run of this spec's town, seed 7, 60 days after the fork, every seat played by
// the mock, and the measured cost of Claude Code's calls; docs/decisions.md, "Assistant seats woken only by what is
// theirs"), for 90 days:
//   - sittings: at most one a working day a seat, 64 working days, 4 seats: about 256 (the mock sat 176 in 60 days, every
//     working day: a model that says it is done for longer sits less);
//   - calls: about 1.9 a sitting (the real models of round 5: Haiku 972 calls in 509 sittings, Sonnet 622 in 372; the
//     mock 1.43): about 490 sitting calls an arm, a few to fold the notebook, and the debriefs, about 13 questions a
//     seat (52);
//   - plan dollars, as the adapter reckons a call (Claude Code's own reckoning, the greater of it and the API price:
//     orchestrator/prices.json, `claude-code/...`, fitted to 35 Haiku calls; one Sonnet call within 10%): a sitting call
//     at the mock's mean prompt (8,600 tokens) is about $0.14 (the prompt written to the cache once, $0.06; read again in
//     Claude Code's two or three turns, $0.01; about 3,000 tokens out in its structured answer, $0.07), a debrief
//     question about $0.08 (measured): 490 x $0.14 + 52 x $0.08 + a few notebook folds, about $75 an arm, Haiku and
//     Sonnet alike (Claude Code reckons the two at about the same rates: why is not known; Sonnet's answers may take
//     fewer turns and cost less, which the first calls will show);
//   - wall time: Haiku 20 s a call (measured, median), Sonnet about the same (one call measured, 4 s, of one turn; Claude
//     Code's own turns are most of it); about two calls at once: about 1.5 hours a fork, the forks side by side
//     (forksAtOnce 3), so about 2 to 3 hours in all if the plan's window stays open (a shut one is waited for, up to 12
//     hours, inside the fork);
//   - the local arm (qwen2.5:14b-instruct on this machine's ollama, free): in the local test it made 63 sitting calls in
//     14 days at three seats, 47 s a call on average (32 s median, 205 s the longest, three at once, its prompts up to
//     23,564 tokens): about 540 calls in 90 days at four seats, about 3 hours.
// Checked by this spec's dry run (2026-11-11, the mock in every seat, no model called): 260 sittings, 436 sitting calls
// and 48 debrief questions an arm, prompts 9,202 tokens on average and 19,599 the largest, no fork stopped; reckoned at
// Claude Code's rates $24.50 an arm, the mock's answers being short (118 tokens) and of one turn: the low end.
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
export const LIMITS = { haiku: 112, sonnet: 112 };

const ROOM = { max_tokens: 16_000 };
export const ARMS: Arm[] = [
  { name: "code", steward: { kind: "code" } },
  { name: "haiku", steward: { kind: "model", model: "claude-code/claude-haiku-5-5", params: ROOM } },
  { name: "sonnet", steward: { kind: "model", model: "claude-code/claude-sonnet-5-5", params: ROOM } },
  // (A local model writes plain notes, not tool calls: participants/src/llm/note.ts.)
  ...(LOCAL ? [{ name: "local", steward: { kind: "model" as const, model: `ollama/${LOCAL}`, params: { answer: "text", max_tokens: 2_000 } } }] : []),
];

const spec = build({ name: "scope-first-pilot", days: DAYS, seeds: [SEED], reviewDays: 14, arms: ARMS, budget: { experiment_usd: LIMITS.haiku + LIMITS.sonnet, arm_usd: LIMITS },
  offices: [...OFFICES, RATES_POST], cohort: { by: "hand", every: 3, only: true }, holdLevels: "run", depth: "matter", wants: true });
// (One machine serves the local model and Claude Code's calls run one process each: three calls at once a fork.)
// (Each Claude arm's own limit, and none for the local model, which costs nothing: an experiment-wide limit would leave
// it a share of nothing.)
spec.seats = { ...spec.seats, calls_at_once: 3, budget: { arm_usd: LIMITS } };
export default spec;
