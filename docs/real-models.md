# Running with a real model

Everything in Terrarium is built and tested on the mock adapter. This page is how to switch to a real model, and what guards the switch. **Nothing here has been run against a real model yet** (as agreed: mock until Naz says).

## The switch

```bash
terrarium run worlds/town.yaml --seeds 1 --set mayor=llm --model anthropic/claude-sonnet-5 --budget 2
```

- `--model provider/model` runs every language-model participant, and the translator, on that model. Without it, it's the mock.
- **Providers:**
  - `anthropic/…`, with `ANTHROPIC_API_KEY` in the environment;
  - `openai/…`, with `OPENAI_API_KEY`;
  - `ollama/…`, a local open-weight model behind Ollama (`http://localhost:11434/v1` by default);
  - `local/… --base-url URL`, any other OpenAI-compatible server (vLLM, LM Studio).
- Keys are read from the environment and never logged.

## What guards it

- **A spending limit, per run** (`--budget` in dollars), required for any model that costs money.
  - Before every call, its worst case is checked: the prompt, estimated generously, and every output token allowed.
  - A call that could take spending past the limit isn't made. The run stops, the log's end entry says why ("spending limit reached …"), and the cost report shows what was spent.
  - 5% of the limit is kept back so the debriefs (VISION §15.3) still happen.
- **A published price** for the model in `orchestrator/prices.json`, with its source and date. A model with no price can't be used: no call is ever priced from a guess.
  - Anthropic's prices are there.
  - OpenAI's aren't yet; add them from OpenAI's price page before using one.
  - A local model costs nothing to call; its compute is yours.
- **Recording:** every call is logged with its tokens and cost (a usage annotation) and its full exchange (a transcript).

## The translator's test set

```bash
terrarium translator-eval --model anthropic/claude-haiku-4-5 --budget 1 --out runs/translator-eval.json
```

- 26 plain-language requests (`translator/eval/cases.ts`), each with the call it should become, or the refusal it should get.
- Six are **held out**: phrased unlike the call language's own examples. They must never be used to tune the prompt or train a model.
- The report gives seen and held-out pass rates, and what failed.
- VISION §14: a translation model is adopted only if it passes a held-out set that includes novel requests. What "passes" means (a threshold) is for Naz to set, before the first real run.

## Why not a ChatGPT or Claude subscription

A consumer subscription isn't an API.
- Using one to drive a program would go against the provider's terms.
- It would make the runs irreproducible: no pinned model version, and no per-call token counts, which every run must record (CLAUDE.md).
- Use an API key with a spending limit, or a local open-weight model.
