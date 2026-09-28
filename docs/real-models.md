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
  - `local/… --base-url URL`, any other OpenAI-compatible server (vLLM, LM Studio);
  - `codex/…`, OpenAI models through the Codex CLI and a ChatGPT subscription (below).
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

## A ChatGPT subscription, through the Codex CLI

`--model codex/<model>` (or `codex/default`) runs calls through the Codex CLI's non-interactive mode (`codex exec`), signed in with a ChatGPT account. That's the legitimate route for a subscription: the Codex CLI is built to be run by scripts. Pulling its sign-in token out to call OpenAI's backend directly is not.

**Setup, once:**
- install the Codex CLI (`npm i -g @openai/codex`, or Homebrew);
- run `codex login` and sign in with ChatGPT in the browser.

**How it runs:**
- Each call is one `codex exec`, read-only, with no user config or rules, keeping no session files, in an empty temporary directory.
- Our system prompt, the conversation and the tools go in on stdin.
- The answer comes back as JSON matching a schema (`--output-schema`), which is read as a tool use.
- Tokens come from its `turn.completed` event; the cost is recorded as $0 a call (a flat-rate subscription).

**Caveats, which is why it's for smoke tests and pilots:**
- **Codex is a coding agent.** Its own instructions sit under ours, and there's no way to replace them. The model is being told two things at once, which confounds any study where the framing is the variable.
- **The subscription's usage limits apply** (per few hours). The mock-LLM mayor makes about 130 calls a simulated year: fine for a pilot, not for batches.
- **The model version isn't pinned** as an API's is, so runs are less reproducible.
- **Tested only against a stand-in:** no real `codex exec` has been run from here.

## Pilots (directional testing, not evidence)

All on the small town (`worlds/town.yaml`, `--set mayor=llm`), through the Codex CLI: `gpt-6-sol` as the mayor, `gpt-6-luna` as the translator (Naz: sol in the driver seat, luna for simple, narrow work; never astra). Read with `terrarium story <log>`.

**Translator test set** (2026-09-28):
- `gpt-6-luna`: 20/20 seen, 4/6 held out, after fixing things on our side:
  - the form's publisher was shown as the town, not the office;
  - a bare word with capitals is now read as a name;
  - "12-month" is now a duration;
  - the test compares what an answer comes to (its acts);
  - the Codex answer format no longer offers a "none" tool beside the call tool.
- The two held-out misses are the model refusing ("too much", "unclear") where it should have translated. They stay as findings; held-out cases are never tuned on.

**Pilot 1** (stopped at day 23):
- The loop works. The translator addressed a proposal to "council", which isn't anyone; the mayor saw it in the preview and **declined the draft**, and declined again when a retry came out as a plain letter.
- Found two gaps in the world:
  - **offices can't answer letters:** the mayor wrote almost daily for figures, and nobody replied;
  - **nothing said how to put something to the council.**
- Fixed: offices answer every letter with their standard report, and the clerk publishes a council proposal form.

**Pilot 2** (stopped at day 2): the replies arrived, and the mayor used them (it quoted the balance). It then asked, again and again, for a revenue forecast the report didn't have. Fixed: finance reports money in and out (the last 30 days, the year so far, the monthly rate).

**Pilot 3** (stopped at day 4): it asked finance for "expected costs of town services", "spending needs" and "recommended budget amounts", ten letters in four days. It never tabled a budget. The reports were accurate, but no office said what this town's budget can pay for: one line, parks, and nothing else. The code mayor knew that from the catalogue; a newcomer had no way to learn it. Refusing to invent figures was the right call, and the world gave it nothing to work from. Fixed: the finance report includes a budget brief, with the budget's lines, what each pays for, and a park's price ($60,000).

**Pilot 4** (stopped at day 1): with the brief, the mayor tabled a budget on day 1 (parks $60,000, for one park), and on its own chose a lot outside the flood-prone river lots. The translator left out the form's required `kind`. The resolver sent the form back ("needs: kind"), and the mayor re-sent it with the kind stated, the way a returned form works. The mayor then started asking for budget figures again, as if it hadn't just tabled one.

That was **our bug**, not the model's. The mayor's only memory between wakes is its notebook, which it updates as a second tool use alongside an action. The Codex answer format allowed only one tool use, so **pilots 1–4 ran with a mayor that could never write its notebook**. Every wake started from scratch, which explains much of the repeated asking in all four. Fixed: a Codex answer lists its tool uses. A second, latent bug was found alongside it: the participant gave a result only for the action's tool use, not the notebook's. The Anthropic and OpenAI APIs reject a tool use with no result, so the first real notebook write on either would have failed the run. Every tool use now gets a result, and a test enforces the APIs' rule.

A pattern across the pilots: each gap was something **a real office would tell a new mayor on day one**, which the code mayor never needed because it reads config. Pilots with a real model are finding the places where the code stand-ins were quietly reading what nobody in the world would tell them. An audit of every direct config read by a code participant (2026-09-28) found no others that matter. Landlords read their own buildings' types, builders read materials prices, and citizens read their biology and the calendar: all things those parties would know. The mayor's park price was the only knowledge its position couldn't get from the world, and the budget brief now supplies it.

**Cost and speed:** each Codex call takes about 10 seconds and carries about 14,000 tokens of Codex's own instructions. The mayor makes 2–3 calls a simulated day while it's gathering information.
