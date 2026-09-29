# Language-model runs: are we ready?

**Status:** a review, 2026-09-29, for Naz ("we need to start thinking about pulling in LLMs soon, but I want to make
sure we have all of our bases thoroughly covered"). It separates what's done (with where it's shown), what's open, and
who decides each open item.

## The answer

**Ready for more pilots now; not yet for research runs.**
- The machinery works end to end with a real model: seven Codex pilots (docs/real-models.md) had gpt-6-sol governing
  and gpt-6-luna translating. The pilots found world gaps, not platform failures, and each was fixed.
- What stands between us and a research run is mostly **decisions**, not code. The largest:
  - the translator's pass mark;
  - which provider research runs use (the Codex CLI confounds framing);
  - what to do about translator refusals shaping what the steward can do.

## What's covered

| Area | What's in place | Shown by |
|---|---|---|
| **Spending** | A limit per run, required for any paid model. The worst case is checked before every call; a call that could pass the limit isn't made, and the run ends saying why. 5% is kept for debriefs. No model without a published price. | docs/real-models.md; `orchestrator/test/models.test.ts` |
| **Failures** | Retries on 429, 5xx, timeouts and dropped connections, with backoff. A call that fails after its retries is recorded and the seat waits (D59). A watchdog catches a run that stops moving; a stopped run resumes from its log, with every model answer served from the log. | `resume.ts`; `docs/reliability.md` |
| **The world is safe from the model** | A model acts only through the translator and the resolver. Every act is checked by the kernel against the contracts; a bad one is refused and recorded. | the kernel's contract checks; translator tests |
| **Memory** | Each wake starts from a fresh report and the seat's own notebook (4,000 characters), so context doesn't grow over a long run. | `participants/src/llm/participant.ts`; pilot 5 |
| **Records and training data** | Every call's full exchange (a transcript), tokens and cost. Datasets (`terrarium dataset`) and the translator corpus (`terrarium corpus`) come from the log. Model runs keep full logs: `--keep measures` refuses them, and compression is lossless. | docs/design/run-datasets.md; `dataset.test.ts` |
| **Welfare (VISION §15)** | Framing from the world config, with a mandatory reason. Opting out is always offered, and is distinct from resigning office. A debrief after the run, logged as data. | `participant.ts` tools; `llm.test.ts` |
| **Platform invisible** | The seat reads reports in the world's terms and never sees the machinery (P14). | `render.ts` |
| **Keys** | From the environment, never logged. | `models.ts` |

## What's open

### Decisions for Naz (they block research runs, not pilots)

1. **The translator's pass mark.** VISION §14 and docs/real-models.md: "What passes means is for Naz to set, before the
   first real run." The held-out set has 6 cases; luna passes 4.
   - Suggestion: grow the held-out set to about 30 before setting the mark. Six cases can't tell 67% from 90%.
2. **The provider for research runs.** The Codex CLI puts a coding agent's instructions under ours, which we can't
   remove, and its model version isn't pinned. Fine for pilots; a confound wherever framing is the variable.
   - API runs need prices in `prices.json` (OpenAI's aren't there) and a budget per experiment.
3. **Translator refusals are part of the instrument.** In pilot 6, luna refused plain requests ("too much", "unclear")
   that sol then had to reword, five times for one law. A translator that refuses shapes what the steward can do, and
   differently for each translator model.
   - Options:
     - hold the translator fixed across compared runs (item 6 below) and report its refusal rate with every result;
     - use a stronger translator for research runs;
     - the trained translator, later.
   - At least the first is needed before any comparison between stewards.
4. **Scale (VISION §15.5).** A justification per experiment for how many runs, and for any pressure scenario. There's
   no mechanism for it. Suggestion: a required `justification` beside `framing.reason` in an experiment's config.
5. **Opt-out wording under framings other than honest disclosure** (VISION §15.4, open). This only matters once a
   non-honest framing is used; every pilot so far used honest disclosure.
6. **Contract sign-offs waiting:**
   - `notices` in the Observation;
   - `framing.debrief_text`;
   - **the translator's model in the world config**, so an experiment can hold it fixed (today it's run-wide);
   - the dataset format, the `observation` annotation, `log.detail`;
   - standing orders' `until`;
   - compact logs.
7. **Councillors can't be persuaded.** They're code that votes by a fixed leaning and doesn't read letters. Whether the
   steward's letters should be able to move them is a design question, and a large one for what a steward can do.
8. **Is the world calibrated enough for the question?** Unemployment, participation and employment are now near their
   targets. Saving isn't (17–21% against 6.5%). A study of a steward's budget choices may not care; one about household
   hardship would.

### Engineering (mine to do; none needs sign-off)

| | What | Why | Size |
|---|---|---|---|
| a | ✓ Done, 2026-09-29. **Prompt caching** in the Anthropic adapter (the system prompt and standing documents, which repeat on every call) | Cost: most of each call's input is the same as the last | Small |
| b | ✓ Done. **Record observations by default for model runs** (`--record-observations models` unless told otherwise) | Training data (Naz's first priority): the structured observation beside the rendered prompt | Small |
| c | **Translations in parallel** within a round, applied in order | With more than one model seat, each waits for every translation before it. Deferred: translations share one subject, and the log's order and resume's serving depend on their order; only worth it for a design with several model seats | Medium |
| d | ✓ Done (`--batch-budget`; the projection is the cost report of a mock batch). **A spending limit per batch**, and a projection before it starts (from the mock's call counts) | A 5-seed batch has 5 per-run limits and no total | Small |
| e | ✓ Done. **Subscription limits:** when the Codex CLI reports its usage limit, stop the run cleanly and say to resume later, rather than failing calls | Pilots will hit the per-few-hours limit on long runs | Small |
| f | ✓ Done. docs/real-models.md still opens with "nothing here has been run against a real model yet" | Stale since the pilots | Trivial |

### What a long run with a model costs in time

- The simulation can't advance while a seat is deciding: the order of events must not depend on how long a model takes.
- In pilots, the mayor made 2–3 calls a simulated day while gathering information, each about 10 s through Codex.
- So a 5-year run with one model mayor is roughly:
  - 3–11 hours through Codex;
  - less through an API, with the time set by the model's latency.
- The code participants take about 15 minutes of that.
- With several model seats, their decisions already run in parallel; the translations don't yet (item c).

## A suggested order

1. Engineering items a, b, e and f (a day's work), so the next pilot runs cheaper, records more, and survives the
   subscription's limits.
2. **A long pilot:** the 1,000-person town for one year, sol as mayor and luna translating, through Codex.
   - What it tests: whether the notebook keeps a mayor coherent over a year; the real call rate; limits and resume.
   - Directional, like the others: it finds gaps; it isn't evidence.
3. Naz's decisions 1–3 and 6. With those, a first research design can be written: its question, framing, justification,
   provider, and translator held fixed.
4. Then items c and d, before any batch with more than one model seat or seed.
