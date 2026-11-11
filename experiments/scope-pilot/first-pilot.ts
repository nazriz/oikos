// The first true pilot (docs/handover.md, "Now", step 5; written 2026-11-11, set 2026-11-12, not yet run). WHAT THIS RUN
// IS: a baseline, at obstacle level 0 (no obstacle laws: the world as before, docs/design/obstacles.md section 6), one
// seed (7), 45 days after the fork (day 30 to day 75), the Claude arms at low effort through the owner's subscription,
// the Codex arm not on equal terms, the local arm in plain notes. Leads, never findings: one seed, nothing registered.
//
// The study's town (study.ts: the finance office, the factory and the rating office, and one adult in three, engaged
// with provider A by hand on day 1 and held to the run's end as a floor, the organisations handing over invoices and
// delivery notes as what happened, the households their wants). In the assistants' seats (`assistant-a`,
// `assistant-a-personal`: the finance, factory and rating offices' assistants and the provider's desk, four seats):
// Claude Haiku 5.5 and Claude Sonnet 5.5 through the owner's Claude subscription (`claude -p`, the `claude-code/` route:
// never the Anthropic API key), at Claude Code's `--effort low` (EFFORT, below: a condition of this run, the
// coordinator's decision of 2026-11-12, on the measurement in docs/decisions.md, "What a claude -p seat's tokens are":
// what the seats did was the same at low and default in six of eight pairs, low is nearer the earlier API seats, and it
// halves the subscription drawn); the code assistant as the reference; gpt-6.1-sol through the owner's Codex
// subscription, at its default (a labelled extra, not on equal terms); and a local open-weight model (LOCAL, below),
// which writes plain notes, not tool calls (participants/src/llm/note.ts). Our translator alone (`decide/round3-s2`,
// build.ts `OURS`, nobody behind it); the framing unstated (a seat that asks is told the truth; every seat is debriefed).
//
// Since 2026-11-11 an assistant's seat keeps to its own post and to the working hours of the office it serves (one
// sitting a working day; its "done for n days" honoured; docs/behaviour/assistants.md, "When it sits").
//
// The estimate (2026-11-12, from real sittings of this spec: the second smoke, runs/scope-first-pilot-smoke-2c, 5 days
// at the default effort, after the fix that takes every answer a claude -p call gives; docs/decisions.md, "What a
// claude -p seat's tokens are"), for 45 days, per Claude arm:
//   - sittings: about 3.3 a working day for the four seats (10 in the smoke's 3 working days), about 105 in 45 days
//     (32 working days); 130 (every working day) taken for the limits;
//   - calls: 2.1 a sitting for Sonnet, 2.5 for Haiku (the first sittings carry 15 and 16 matters, and the rating office
//     hands over more referrals of 15 notices each on the next days; Codex, in the first smoke, 3.6): about 2.5 a
//     sitting, 325 sitting calls an arm; the debriefs about 47 calls; notebook folds a few;
//   - plan dollars as Claude Code reckons ($5 a million in, $6.25 written to its hour's cache, $0.50 read, $25 out:
//     orchestrator/prices.json). A sitting call measured at the default effort: Haiku $0.29 (62,000 tokens in, of them
//     about 22,000 written to the cache, and 4,800 out, most of it thinking), Sonnet $0.25 (111,000 in, 22,000 written,
//     2,200 out, 6 turns). At low effort about half that, by the 29 replayed calls (Haiku 4,200 out a call against
//     9,700, Sonnet 1,950 against 4,100; docs/real-models.md, "Effort"): Haiku about $0.15, Sonnet about $0.125. The
//     debriefs at the default came to Haiku $3.65, Sonnet $2.60; at low less (not measured: taken as about half).
//     So, an arm at low effort: Haiku about 325 x $0.15 + $2 + $1 (folds) = about $52; Sonnet 325 x $0.125 + $1.5 + $0.5
//     = about $43. (At the default effort it would be about twice that.)
//   - wall time: about 25 s a Haiku call, 18 s a Sonnet call at the default (less at low), three at once: under an hour
//     of calls a fork, the forks side by side, if the plan's window stays open (a shut one is waited for, up to 12
//     hours, inside the fork);
//   - the Codex arm (gpt-6.1-sol on the owner's ChatGPT subscription, flat rate: nothing reckoned a call): about 3.6
//     calls a sitting in the first smoke, about 400 sitting calls and 52 debrief questions, 5 to 7 s a call (measured
//     2026-11-10), under an hour. NOT ON EQUAL TERMS: the Codex CLI puts its own instructions under ours
//     (docs/real-models.md), so its seat is not told only what the others are told; a labelled extra, never pooled
//     with the Claude arms;
//   - the local arm (qwen2.5:14b-instruct on this machine's ollama, free): in the local test it made 63 sitting calls in
//     14 days at three seats, 47 s a call on average (32 s median, 205 s the longest, three at once, its prompts up to
//     23,564 tokens): about 270 calls in 45 days at four seats, about 1.5 hours.
// Limits: half again over each estimate (Haiku $78, Sonnet $65), so that no arm can spend more than half again its
// estimate; the fork's reserve for its debriefs (kept back from the start, about $5 for four seats, priced as Claude
// Code reckons) comes out of the limit and leaves the estimate covered.
//
// To start it (on the run server, from the checkout; detached and kept awake; never deletes a run; the local arm needs
// `OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_NUM_PARALLEL=3 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve` running and
// `ollama pull qwen2.5:14b-instruct` done): first the dry run,
//   OIKOS_TRANSLATOR_MODELS=$HOME/oikos/runs/translator-model bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/first-pilot.ts --out $HOME/oikos/runs/scope-first-pilot-dry --mock-models
// then, with the owner's go-ahead on the estimate, the one command:
//   env -u ANTHROPIC_API_KEY -u OIKOS_ANTHROPIC_KEY OIKOS_LOCAL_CONTEXT=32768 OIKOS_TRANSLATOR_MODELS=$HOME/oikos/runs/translator-model nohup bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/first-pilot.ts --out $HOME/oikos/runs/scope-first-pilot > $HOME/oikos/runs/scope-first-pilot.out 2>&1 & caffeinate -i -w $! &
import type { Arm } from "../../orchestrator/src/experiment";
import { build, OFFICES, RATES_POST } from "./build";

/** Days run after the fork (on day 30). */
export const DAYS = 45;
export const SEED = 7;

/** The local open-weight model, where the local test (experiments/open-weight/local.ts) found one that can hold a seat;
 * absent: no local arm. */
export const LOCAL: string | undefined = "qwen2.5:14b-instruct";

/** How hard the Claude seats reason (Claude Code's --effort): a condition of this run (the header). */
export const EFFORT: "low" | "medium" | undefined = "low";

/** Each arm's hard limit, USD as the adapter reckons: half again over its estimate at the effort set. */
export const LIMITS = EFFORT === "low" ? { haiku: 78, sonnet: 65 } : { haiku: 155, sonnet: 130 };

const ROOM = { max_tokens: 16_000 };
// (The Claude seats' effort goes with every call of theirs: sittings, notebook folds and debriefs.)
const CLAUDE = EFFORT ? { effort: EFFORT } : {};
export const ARMS: Arm[] = [
  { name: "code", steward: { kind: "code" } },
  { name: "haiku", steward: { kind: "model", model: "claude-code/claude-haiku-5-5", ...CLAUDE, params: ROOM } },
  { name: "sonnet", steward: { kind: "model", model: "claude-code/claude-sonnet-5-5", ...CLAUDE, params: ROOM } },
  // (Not on equal terms: the Codex CLI puts its own instructions under ours. A labelled extra; flat rate, no limit.)
  { name: "sol", steward: { kind: "model", model: "codex/gpt-6.1-sol", params: ROOM } },
  // (A local model writes plain notes, not tool calls: participants/src/llm/note.ts.)
  ...(LOCAL ? [{ name: "local", steward: { kind: "model" as const, model: `ollama/${LOCAL}`, params: { answer: "text", max_tokens: 2_000 } } }] : []),
];

const spec = build({ name: "scope-first-pilot", days: DAYS, seeds: [SEED], reviewDays: 14, arms: ARMS, budget: { experiment_usd: LIMITS.haiku + LIMITS.sonnet, arm_usd: LIMITS },
  offices: [...OFFICES, RATES_POST], cohort: { by: "hand", every: 3, only: true }, holdLevels: "run", depth: "matter", wants: true, obstacles: 0 });
// (One machine serves the local model and Claude Code's calls run one process each: three calls at once a fork.)
// (Each Claude arm's own limit, and none for Codex's flat rate or the local model, which cost nothing a call: an
// experiment-wide limit would leave them a share of nothing.)
spec.seats = { ...spec.seats, calls_at_once: 3, budget: { arm_usd: LIMITS } };
export default spec;
