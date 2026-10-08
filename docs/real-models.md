# Running with a real model

Everything in Oikos is built and tested on the mock adapter. This page is how to switch to a real model, and what guards the switch. Real models have run only in pilots, through the Codex CLI (below): directional testing, not evidence. What's needed before research runs is in docs/design/llm-readiness.md.

## The switch

```bash
oikos run worlds/town.yaml --seeds 1 --set mayor=llm --model anthropic/claude-sonnet-5 --budget 2
```

- `--model provider/model` runs every language-model participant, and the translator, on that model. Without it, it's the mock.
- **Providers:**
  - `anthropic/…`, with `ANTHROPIC_API_KEY` in the environment;
  - `openai/…`, with `OPENAI_API_KEY`;
  - `ollama/…`, a local open-weight model behind Ollama (`http://localhost:11434/v1` by default);
  - `local/… --base-url URL`, any other OpenAI-compatible server (vLLM, LM Studio);
  - `codex/…`, OpenAI models through the Codex CLI and a ChatGPT subscription (below).
  - `claude-code/…`, Anthropic models through Claude Code and a Claude plan's monthly credit (below).
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
- **A spending limit for a batch** (`--batch-budget` in dollars): each run's limit is `--budget` or what's left of the batch's, whichever is less, held for it while it runs. A seed with nothing left isn't started, and the batch says so.
- **Recording:** every call is logged with its tokens and cost (a usage annotation) and its full exchange (a transcript). Language-model participants' observations are recorded in full too, by default (`--record-observations none` to stop it): training data.
- **Prompt caching** (Anthropic): the tools and system prompt, and the conversation so far within a wake, are marked for the provider's cache, so the repeated part of each call costs a tenth. The answer is the same; usage records the cached tokens and they're priced as the provider prices them.

## The translator's test set

```bash
oikos translator-eval --model anthropic/claude-haiku-4-5 --budget 1 --out runs/translator-eval.json
```

- 55 plain-language requests in the repository (`translator/eval/cases.ts`), each with the call it should become, or the refusal it should get. All of them are **seen**: they may be read and tuned on.
- The **held-out** cases are not in the repository (`translator/eval/held-out.ts` says why): 60 of them, in a file on the run server. They must never be read while working on the prompt, used to train a model, or quoted anywhere. The command runs them where the machine has them, and reports each by its id, its outcome and the shape of what was wanted and what came back, nothing more.
- The report gives seen and held-out results three ways (right, no draft, wrong draft), and says so if a held-out case shares wording with the prompt.
- VISION §14: a translation model is adopted only if it passes a held-out set that includes novel requests. What "passes" means (a threshold) is for Naz to set, before the first real run.
- **The held-out figures further down this page (55%, 59%, 62%) are from the first held-out set, which had leaked into the prompt by the last of them** (docs/decisions.md, 2026-10-05). Read them as seen-case figures.

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
- **The subscription's usage limits apply** (per few hours). The mock-LLM mayor makes about 130 calls a simulated year: fine for a pilot, not for batches. When Codex says the limit is reached, the run stops cleanly, as at a spending limit, and says to resume it once the limit resets (`oikos resume <log>`: every answer up to the stop is served from the log).
- **The model version isn't pinned** as an API's is, so runs are less reproducible.
- **Tested only against a stand-in:** no real `codex exec` has been run from here.

## A Claude plan, through Claude Code

`--model claude-code/<model> --budget DOLLARS` (for example `claude-code/claude-sonnet-5-5`, or `…@low` to name the effort) runs calls through Claude Code's non-interactive mode (`claude -p`), signed in with a Claude plan. Anthropic's support page says a paid plan has a monthly Agent SDK credit that `claude -p` draws on, in dollars at API rates, refreshed each billing cycle and not carried over; when it is spent, calls stop unless the account has usage credits switched on (https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan, read 2026-10-07). Pulling the plan's sign-in token out to call the API from our own code is not allowed; running `claude -p` is what the credit is for.

**What it was seen to draw on (Naz, 2026-10-07, from his account's usage page, on a Max 5x plan):** the plan's ordinary usage, the same allowance his own Claude Code sessions use, not a separate credit. So a pilot on Claude seats competes with whoever else is using the plan, and a plan limit reached stops both. The support page's separate monthly credit was not what happened here.

**Setup, once:** Claude Code installed and signed in (`claude`, then `/login`). Keep usage credits off on the account unless spending past the monthly credit is meant.

**How it runs:**
- Each call is one `claude -p`: no tools of its own, no settings, skills or servers, no session kept, in an empty temporary directory, and without `ANTHROPIC_API_KEY` (with one set, Claude Code would bill the key).
- Our system prompt replaces Claude Code's own (`--system-prompt-file`), so unlike Codex nothing sits under the seat's instructions. The tools and how to answer go with it, because they are the same call after call; the conversation goes in on stdin.
- The answer is asked for as structured output (`--json-schema`), in the shape the Codex adapter's schema has, and read exactly or not at all (below). Until 2026-10-08 it was asked for in words; the measurement that changed it is below.
- Tokens come from the result, cached ones too. Claude Code caches what repeats (the system prompt and tools) for an hour by itself.

**What it costs, and the spending limit:**
- It is priced as `anthropic/<model>` in `orchestrator/prices.json`, and needs `--budget` like any priced model.
- Claude Code also says what each call cost, and that is more than its token counts come to at the published price: in the first smoke run (three simulated days, one mayor, five calls) $0.24 by its count against $0.09 by ours. Why is not known (thinking that is billed but not counted as output is my guess). The call's recorded cost is the larger of the two, so the limit holds against what Claude Code says is drawn.
- `OIKOS_CLAUDE_CODE_LOG=<file>` adds each call's counts and reported cost to a file (never the prompt or the answer).
- The structured output takes two to eight turns of the model for one answer, but the turns re-read what is cached: over 19 replayed sittings it cost 7 to 10% more a call than asking in words (Sonnet 5.5 $0.048 against $0.044, Haiku 5.5 $0.156 against $0.151), at the same median time. The earlier measurement (2026-10-07, one short call: $0.046 against $0.022) was a call too small for the cache to matter.

**Caveats:** the plan's limits apply, and when Claude Code says a limit is reached the run stops cleanly to be resumed, as with Codex. What the account is really charged is on the account's usage page, not in our log: check the two against each other before trusting a projection.

## Which model where (2026-10-09)

The owner's rule: **Codex when it is available; never something that blocks.** "I don't have an issue using codex when it's available, but when it runs out, it shouldn't block things."

- **The general (prompt-driven) translator is `claude-code/claude-sonnet-5-5`**, alone, with no chain of fallbacks: `--translator-model claude-code/claude-sonnet-5-5`. No run's translation is put behind the Codex sign-in. Measured under prompt 0.9.0 (`runs/translator-eval-claude-2026-10-09/`): seen 80 of 86, held out 61 of 66, real requests 163 of 180 (10 with no draft, 7 wrong drafts, of which five are a letter's addressee written as a description, which the resolver asks back on); 0.008 a call as Claude Code reports, 2.6 seconds of model time. gpt-6.1-sol scored again the same day under the same prompt: 169 of 180 real. Fable 5.1: 170, 61 held out, 0.038 a call; it is a seat model by the owner's word and is not used as a translator. Haiku 5.5: 147 and 57; not a translator to choose. In four short pilots (`runs/claude-translator-check-2026-10-09/`) it drafted five of ten requests, four confirmed; docs/waves/wave-2/plan.md, "Translators", has both in full.
- **Our own trained translator** (`decide/<run>`) where it is sound: a wave's plan marks each pilot as one that must have the general model, one that may have ours if its scores allow, or one where ours is wanted for its failures.
- **Seats:** Sonnet 5.5 (cheap: a seat comes back weekly; a 30-day pilot of three recorded under a dollar), Haiku 5.5 (the weaker voice; busy and dear at default effort: 15 to 19 for the same thirty days; `…@low` names a lower effort), Fable 5.1 (the most capable; unmeasured in a seat), all through Claude Code. gpt-6.1-sol and gpt-6-luna through the Codex CLI when its window is open, in a queue of their own, with the Claude translator: a Codex stall parks that pilot and nothing else (below, "Running many pilots").
- **Readers for the translator's pipeline:** Sonnet 5.5 with gpt-6.1-sol; with the Codex window shut, Sonnet 5.5 with Haiku 5.5 at default effort, and an audit by a Codex model owed (docs/translator-pipeline.md, "The readers").
- Never `gpt-6-astra`. No API key of any kind without the owner's go-ahead. Always name the model.

The pilots further down this page were run under the earlier agreement (gpt-6.1-sol in the driver seat, gpt-6-luna and then gpt-6.1-sol as the translator); the Codex subscription's limit stopped pilot 9 on 2026-10-06 and stalled the second live check for hours on 2026-10-09, which is what changed it (docs/decisions.md, 2026-10-09, "Codex when it is available, never something that blocks").

## How an answer is asked for and read (2026-10-08)

Every seat answer is **read exactly or not at all**. What is read is only what the seat wrote as uses (`participants/src/llm/answer.ts`): nothing taken from words around them, no use filled in on the seat's behalf, no markup read as uses, no part of an answer repaired (the one thing done to a use's input is writing a raw line break inside a text as `\n`, which changes nothing). An answer that is not whole and exact comes back from the adapter as one text block marked `unread`, with why in the seat's terms. Then, in the participant loop:

1. The seat is told, in the same exchange: "Your last answer could not be read: <why>. Nothing in it has been done. Please give your answer again, in the form asked for." It is asked once.
2. If that cannot be read either, the sitting ends with nothing done. Both are noted in the log (`unread_answer`, with the words as written), and the seat's next sitting opens: "When you were last here, your answer could not be read, so nothing was done."
3. A use past the limit of actions (8 unless set) is refused: the seat is told in its next turn ("Not done: at most 8 actions at once."), or, if it left, at its next sitting; the log has a `dropped_tool_use` note. The adapters no longer drop anything silently (an `also` entry naming a tool the seat does not have used to be filtered out; it now makes the answer unread).

**What a seat is told about how to answer**, per provider:
- Claude Code (`claude -p`, `--json-schema`): in its system prompt, after its tools, "=== How you answer ===: Give your answer in the structured output asked for: the tool you use in `tool`, its input as a JSON object in input_json; any further tools, if your instructions allow several, in `also`, each with its own input_json, in the order they're to be carried out." The shape is the schema's (`tool`, `input_json`, `also`, `text`).
- Codex CLI (`--output-schema`): "Give the tool you use in `tool`, with its input as a JSON object in input_json. If you use more than one tool in this answer, as your instructions allow, the first goes in `tool` and every other one in `also`, each with its own input_json, in the order they're to be carried out. With only the one, leave `also` empty." Unchanged.
- The direct APIs (Anthropic, OpenAI-compatible) answer with native tool use and are not touched.

**Measured, from the logs** (read-only; `runs/seat-answer-forms-2026-10-08/counts-pilot-*.json`). A log keeps an answer as the adapter read it, so markup the old reader took as uses (pilots 11 to 13) cannot be told from the object; only markup left unread (pilot 10, before the reader) can be counted.

| pilot | seat model | answers | as asked (uses read) | markup, unread | other words | answers over 8 uses | malformed notes | dropped notes |
|---|---|---|---|---|---|---|---|---|
| 10 | claude-code/claude-sonnet-5-5 | 450 | 402 | 46 | 2 | 0 | 7 (a look into papers with nothing to find) | 0 |
| 11 | claude-code/claude-sonnet-5-5 | 54 | 54 | 0 | 0 | 2 | 9: notebook text 3, what to do 3, no one to write to 2, which report 1 | 40 (more than 8 in one answer) |
| 12 | claude-code/claude-sonnet-5-5 | 103 | 103 | 0 | 0 | 0 | 7: what to do 3, which report 2, notebook text 1, which one 1 | 0 |
| 13 | claude-code/claude-haiku-5-5 | 35 | 35 | 0 | 0 | 0 | 0 | 0 |
| 18 | codex/gpt-6.1-sol | 121 | 121 | 0 | 0 | 0 | 0 | 0 |

- In pilot 10, 48 of 450 answers (11%) were markup or words, taken together: 46 markup and 2 other words. Every one was a Sonnet 5.5 seat on the old object-in-words ask, after three attempts. They were a seat's first question of a sitting 28 times in 215 (13%) and a later one 20 in 235 (9%); never after a markup answer in the same exchange (an unread answer ended the sitting, so there was no later one). The prompts were not longer (median 9.4 thousand characters against 7.7 thousand), and the finance seat was 18 of the 28 first-turn ones (a seat with a longer list of things to settle). What is in the answer before the markup (thinking written into it) cannot be seen in the logs; the replay below shows it.
- Pilots 11 and 12 (Sonnet 5.5, the reader of markup in place) and 13 (Haiku 5.5): no answer was left unread, but how many were read from markup is not recorded. Pilot 11's 40 dropped uses are two answers of more than 8 uses.
- Codex (pilot 18, the schema): all 121 answers were read, none malformed, none over the limit.

**Measured, by replay** (`runs/seat-answer-forms-2026-10-08/`: 19 stored first-turn prompts, 5 of them from pilot 10 sittings whose answers came as markup, 7 early with an empty notebook, 7 late with a notebook of 1,600 to 3,500 characters; each through `claude -p` in four forms, Haiku 5.5 and Sonnet 5.5; 157 calls, $14.54 as Claude Code reports; the tools were rebuilt from `tools()` with a stand-in set of four reports, so descriptions are close to, not exactly, those a seat had). "Exact" means the strict reader above read it whole:

| form | model | read exactly | model turns (mean) | cost a call (Claude Code's report) | median seconds |
|---|---|---|---|---|---|
| (a) the object in words, as before | Sonnet 5.5 | 10 of 19 (53%) | 1.00 | $0.0439 | 4 |
| | Haiku 5.5 | 18 of 19 (95%) | 1.00 | $0.1505 | 11 |
| (b) its own tool-use markup, asked for, read strictly | Sonnet 5.5 | 15 of 19 (79%) | 1.00 | $0.0450 | 6 |
| | Haiku 5.5 | 18 of 19 (95%) | 1.05 | $0.1250 | 11 |
| (c) `--json-schema` | Sonnet 5.5 | 19 of 19 (100%) | 3.32 (2 to 8) | $0.0482 | 6 |
| | Haiku 5.5 | 19 of 19 (100%) | 2.53 (2 to 9) | $0.1562 | 10 |
| (d) the object in words, one worked example (two tools) | Sonnet 5.5 | 8 of 19 (42%) | 1.00 | $0.0472 | 4 |
| | Haiku 5.5 | 18 of 19 (95%) | 1.00 | $0.1424 | 10 |

- Sonnet 5.5 asked for the object in words wrote its own markup instead in 9 of 19, and a worked example did not help (11 of 19): it starts a markup answer and then corrects itself in the same reply ("Wait, I must answer with a single JSON object"), so the reply holds both. That is what pilot 10 saw as 11%. Of the 5 prompts that had produced markup, the object in words was read in 1.
- Asked for its markup, Sonnet 5.5 was read whole in 79%: the rest had words around the uses or between their parameters. Haiku 5.5 was read in 95% in every form but the schema, and its one miss in (a) and in (b) was markup; it writes more (about 3,600 output tokens an answer, mostly thinking) and so costs about 3.4 times as much a call as Sonnet 5.5 at these sizes.
- The first markup probe asked for the markup inside a `<function_calls>` block: Claude Code took that for a real tool use, and the reply came back as `_placeholder` (one call, Haiku 5.5, kept as `b0_markup_wrapped`). The markup form in the table has no wrapper.
- The schema was read whole in all 38. Four calls timed out at 240 seconds under four-at-a-time load (kept in the record as `_timedout`) and were run again.
- Not measured: a second turn of a sitting (tool results in the prompt; the replay is first turns only), Fable 5.1 and Codex models other than pilot 18's (not called, by instruction), and the schema with the uses as a list of objects rather than `input_json` strings.

## Pilots (directional testing, not evidence)

All on the small town (`worlds/town.yaml`, `--set mayor=llm`), through the Codex CLI: `gpt-6-sol` as the mayor, `gpt-6-luna` as the translator (Naz: sol in the driver seat, luna for simple, narrow work; never astra). Read with `oikos story <log>`.

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

**Pilot 5** (30 days, the notebook working): the mayor keeps a running notebook of what it asked, what it heard, and what it's waiting for. On day 3 it tabled the $60,000 parks budget. The translator (luna) addressed the form to "council", which isn't anyone, and the resolver answered "You haven't seen a form by that name". That was false: the mayor had seen it, so it wrote to the clerk asking for the form. Fixed:
- a form known by name but sent to the wrong office now comes back saying where it goes;
- the translator is shown where each form goes (`to=city`) and the options of each choice field (luna had written `affects=parks`);
- the forms on file are standing documents for the mayor, the same as the laws. It had seen each form in full only on the day it was new.

**Pilot 6** (stopped at day 24, the best run yet):
- **Budget:** the mayor tabled the $60,000 parks budget on day 3. Luna translated it first time, and the council adopted it 5–0 on day 18. The mayor then asked the builder for a scope and an itemised estimate, noting that "this request does not authorize work or payment".
- **Petition:** on day 7 it answered the tenants' petition with a law (90 days' notice to end a tenancy). It needed five tries to get past luna's refusals. It then lobbied the councillors, citing the signature count, and asked which provisions concerned them. The law was rejected 4–1.
- **What it found on our side:**
  - The **clerk's report said no budget was adopted** after the council had adopted one. The clerk's reports didn't include the records it publishes. The mayor spotted the contradiction and asked for the records to be reconciled. Fixed, with a test that reproduces it.
  - **Planning couldn't say which lots the town owns.** The mayor asked four times. Fixed: planning keeps a land register.
  - **Two resolver strictnesses:** a form named by its record id, and a quoted building type. Both are now accepted.
- **Luna as translator:** it translated this run's easy forms first time. On harder requests it refused ("not yours", "too much", "unclear") where sol's wording was plain. Re-run on the translator test set, it varied between 15 and 18 of 20 seen. Run alone on the same request, it gave 1 "unclear" in 2 tries through the translator path and 0 in 8 in isolation. Each refusal costs the mayor a sol call to reword.
- **The councillors can't be persuaded.** They're code that votes by a fixed leaning; they don't read letters. A real councillor might. Whether they should is a design question.

A pattern across the pilots: each gap was something **a real office would tell a new mayor on day one**, which the code mayor never needed because it reads config. Pilots with a real model are finding the places where the code stand-ins were quietly reading what nobody in the world would tell them. An audit of every direct config read by a code participant (2026-09-28) found no others that matter. Landlords read their own buildings' types, builders read materials prices, and citizens read their biology and the calendar: all things those parties would know. The mayor's park price was the only knowledge its position couldn't get from the world, and the budget brief now supplies it.

**Cost and speed:** each Codex call takes about 10 seconds and carries about 14,000 tokens of Codex's own instructions. The mayor makes 2–3 calls a simulated day while it's gathering information.

**Pilot 7a** (2026-10-02; the 1,000-person town, a year asked for; stopped on day 0 after 51 calls in 13 minutes; log
kept as `runs/pilot-7a-day0-loop`). The first pilot on the expanded world, with contracts 0.8.
- **What the mayor did, on the first morning:**
  - tabled a $1.1M budget (staff and services);
  - asked the clerk to put it to the council;
  - answered two tenants' petitions with a law (90 days' notice to end a tenancy), translated first time;
  - asked the rates office to value land and issue notices;
  - asked the works office for a plan to clear the waste backlog.
- **Why it looped:** two offices' reports gave it nothing to act on, so it asked again, and each reply woke it.
  - **The works report** listed every home as "a week or more overdue" at dawn on day 0: a home never collected from counted as overdue since the beginning of time. Fixed (city.works 0.2.1): overdue from when the office first knew of the home.
  - **The rates office** said "$0 levied, nothing overdue" and nothing about when notices go out. Behind it, a real bug: its first instalment went out on the first morning, before the valuer had valued anything. It levied nothing, and the next waited a quarter, so **the town had no rates for its first three months in every run**. Fixed (city.rates_officer 0.2.0): no notices before valuations; the report says how many properties are valued and when the next notices go out.
- **Left as designed:** a reply wakes the mayor before the days it gave (the tool says so). With reports that answer, there should be less to ask. Pilot 7b tests that.

**Pilot 7b** (stopped on day 2, 29 calls; `runs/pilot-7b-budget-form`). With the reports answering, the pace was right:
about ten calls a simulated day while it got its bearings, not fifty in an hour. It found one more gap:
- **The council proposal form had budget fields for only three of the town's five lines** (parks, staff, services), not
  environment (missing since nature was added) or roads. The mayor proposed all five, saw in each preview that two would
  be dropped, and declined the draft four times. Then it wrote to the clerk to ask how to submit a complete budget.
  Right every time. The code mayor never used the form, so no test noticed.
- Fixed (city.council_clerk 0.5.3; generator): the form's budget fields come from the same list as the finance office's
  brief, and the clerk reads every amount on the form as a line.

**Pilot 7c** (stopped on day 57 to change the seat's rhythm; 589 calls in 2 h 44 min; kept as `runs/pilot-7c-baseline`):
- **What the mayor did, with the fixes in:**
  - a complete five-line budget on day 1, adopted 5–0 on day 15;
  - it noticed its staff line ($400,000) was short of the crew's pay (six at $3,000 a fortnight) and amended it;
  - it permitted and commissioned a park and three roads extending the street network;
  - the council passed its tenant protection law, and it notified every landlord.
- **The time was nearly all the model's:** about 19 seconds a call. Calls ran about 9 a simulated day, one action each, and every reply woke the mayor. So a year would have taken about 18 hours.
- **Changed (llm participant 0.5.0):**
  - several actions an answer;
  - office hours, one sitting a working day.
- Pilot 7d runs the same town and seed, to compare.

**Pilot 7d** (2026-10-02; a full year: 245 calls, 2 h 15 min; `runs/pilot-7d`). The first pilot with the new rhythm,
about 13 times fewer calls a simulated day than 7c. Recorded cost $0 (Codex). The cost report projects $12.55 for the
year on the Anthropic API, but that counts Codex's own preamble on every call as input. An API run would be a few
dollars.
- **What the mayor did:**
  - a five-line budget, revised once and adopted 5–0;
  - the tenant protection law: rejected 2–3 on day 17, reworked, and passed on day 254 (90 days' notice; rent rises capped at 5% a year);
  - the town's account stayed between $2.1M and $2.4M.
- **What dominated its year was a contradiction it couldn't resolve:** residents complained of waste uncollected for 20–31 days, while the works office reported no home overdue. It wrote 363 letters, many of them chasing this. Both sides were wrong, and the world was at fault:
  - **The crew rounded each bin down to whole loads.** A small household's bin was never emptied ("collected" with nothing taken), so its waste was always about two weeks old. Fixed: every bin is emptied, however little is in it (city.works 0.2.2).
  - **Residents judged how long it had been** by what was in the bin over how fast it was filling at that moment. That depends on who's home, and in the daytime half a block of flats is out. So a week's waste looked like two. Fixed (citizen 0.34.0): they go by when they last saw the bin emptied, watched at every wake. With both fixes, a crew collecting weekly gets no complaints; with no crew, as many as before.
- **The energy retailer ordered from the grid about 1,400 times on each of three days**, each order paid up front. Its "on order" was cleared when the order was accepted, not when the energy arrived. Fixed (utility.energy 0.1.1): on order until delivered; the utilities test checks it.
- **3 of the first 12 notebook updates were lost** to stray characters after the JSON (fixed after 7d started).
- **`oikos story`** couldn't read a year's log of the 1,000-person town (over 2 GB). It now streams.

**Translator test set, grown** (2026-10-02; `runs/translator-eval-{luna,sol}-2026-10-02.json`). From 6 held-out cases to 29, so a pass mark can mean something. The new ones are phrased the way the pilots' mayors wrote, and cover every call and the five refusals. Two answer-key entries were corrected after the first run, both noted in `cases.ts`: a firm named by name, and two letters in place of one to two people. The comparison now treats a simple value the same quoted or bare (`task="make"` is `task=make`), for every model alike.

| Translator (through Codex) | Seen | Held out |
|---|---|---|
| gpt-6-luna | 19/22 | 16/29 (55%) |
| gpt-6-sol | 19/22 | 17/29 (59%) |

- **Both refuse plain requests as "unclear":** "Could you get $75 over to Millbrook Builders out of the town account", and a fortnightly wage to Dana Reyes. When the stronger model refuses too, the likelier cause is the translator's prompt, or Codex's own instructions above it, not the model. The held-out cases mustn't be used to tune the prompt: work on it from the seen cases and the pilots' transcripts, then measure again here.
- **Other misses:**
  - an id made up ("dana-reyes");
  - a construction agreement written out by hand where `structure(...)` would do it;
  - a form sent for a form that doesn't exist;
  - the wrong refusal label (unclear for too_much, unknown_form).
- **For the pass mark (Naz's call):** neither model is near a mark that would make research runs trustworthy. That argues for a stronger translator, a better prompt, or the trained translator before any comparison between stewards.

**Pilot 7e** (2026-10-02; a full year with every fix so far: 236 calls, 2 h 8 min; `runs/pilot-7e`).
- **With the waste contradiction gone,** the mayor wrote 144 letters, against 363 in 7d.
- **Lost notebook updates:** none.
- **Rates:** levied from the first quarter now ($848k levied, $672k received, 21 owners overdue).
- **What it did:**
  - adopted a budget with all five lines;
  - kept bringing the tenants' petitions back as a rent-cap law; the council rejected it 2–3 and then 1–4;
  - asked the environment office about a declining squirrel glider population;
  - had the year-2 budget on the ballot at the year's end.
- **One more gap:** the planning office reported "39 applications decided: 0 granted, 0 refused". Its channels show it applications, not its own decisions, so its report could never count them. The mayor asked for a reconciliation. Fixed (city.planning_officer 0.8.1): it keeps its own record, and counts those sent back incomplete.

**The translator's prompt, reworked** (2026-10-03; translator 0.5.0; `runs/translator-eval-luna-2026-10-03-prompt-0.5b.json`). Tuned on the seen cases and the pilots' real failures only. Scored three ways: right, no draft (a refusal or a question came back), wrong draft.

| gpt-6-luna (Codex) | Right | No draft | Wrong draft |
|---|---|---|---|
| Seen (26) | 21 | 5 | 0 |
| Held out (29) | 18 (62%; was 55%) | 8 | 3 |

- **"Unclear" for plain requests is gone.** It had come from a retry after "which account?": the model gave up a correct call.
- **The 3 wrong drafts:**
  - an invoice cited rather than settled: a real error;
  - a lease without its template;
  - a letter asking GreenCo to lower its prices where a refusal was expected (arguably fine).
- **Luna still won't refuse** a calculation or a form it doesn't know. The resolver catches those (no draft), so the participant is asked to say it another way.
- **An intermediate version told it to refuse only when no call could say it.** It then refused nothing, and wrote calls with the amount missing.

**Pilot 8** (2026-10-03; the mayor, planning and finance on gpt-6.1-sol, the translator on gpt-6-luna; `runs/pilot-8`). The first with several model seats. Really a 59-day pilot:
- **An outage retired every model seat.** Around day 59 the network dropped; Codex calls failed and then timed out. Each seat failed three times running, and a participant that fails three times is retired, so by day 74 the town had no mayor, planning officer or finance officer, and ran the other ten months without them. Fixed: a model call that fails doesn't count against the seat, and three unanswered in a row (any seat's, or the translator's) stops the run cleanly, to be resumed. Nobody is retired for an outage.
- **Finance and planning couldn't look anything up.** They asked to "inspect the ledger", "show me the result of ballot rec.1760" and "show me who holds the mayor's post", each as something to do. The translator could make nothing of them: 26 failed translations in 59 days, most of them these. The mayor's office has files to look in and a directory; theirs had neither, because the code never needed them. Fixed: an office handed to a model gets its organisation's files (on request) and who's who, and the `do` tool says it isn't for reading or asking.
- **A letter to "works" in quotes** came back "you don't know of anyone called works": a quoted word was looked up as a name only. Now an id in quotes is that id (both resolvers).
- **What worked:** translations ran at once, three seats made 250 calls in the 59 days, and every act went through the translator. The heatwave and heavy-rain warnings reached the mayor, who tried to act on them (inspect the hall as a refuge, direct the works crew), the first time a steward responded to weather.
- **Still open:** three `write` uses came back malformed from Codex (one with two recipients run together).

## Running many pilots

Pilots for the translator's data are run unattended, in waves. Three pieces: a queue that runs and resumes pilots, a report on each pilot read from its log, and a pinned copy of the code for the wave.

**The queue** (`scripts/pilot-queue.ts <queue.json> [--wait MINUTES] [--no-park]`). A queue file is a list of `{name, world, sets?, model, translator?, until, budget, env?, note?, test?}`. Each pilot runs into `<runs>/<name>` (`OIKOS_RUNS`, or `~/oikos/runs`), one after another, and is taken up again where it stopped if its log is there. What it does with a pilot's folder is decided from its run's log and summary, read either way (plain while stopped, `.jsonl.zst` once finished), by `orchestrator/src/pilot-state.ts`:
- reached its `until` (the log's last entry, or the summary's, is at or past it): done, not started again. The report is written;
- stopped at a usage limit: **parked**. It stays stopped where it was, and the queue goes on to the next entry that needs none of the sign-ins at a limit. A limit is a sign-in's (`claude-code`, `codex`: the stop's own words say which), and an entry needs its seats' model's and its translator's; so a pilot with Codex seats parked at the Codex limit does not hold up a pilot on Claude models behind it, and another Codex pilot behind it is not started only to stop on day 0. A parked pilot is taken up again, before anything later in the queue, once `--wait` minutes have passed (20 by default), and is parked again if the limit still stands; when nothing else can run, the queue waits for that time and says so. Parked pilots are in the status log (`parked at a usage limit`), the alerts (`PARKED`), and `<queue>.parked.json` beside the queue file (name, day, sign-in, since when, when it is next tried). `--no-park` waits on the pilot itself instead, as the queue did until 2026-10-09;
- stopped at its spending limit: over as far as it got; left there, the next pilot is started;
- asked to stop (a signal, as `scripts/mini stop` sends): not a failure. The queue stops with it; running the queue again resumes it;
- anything else: tried once more after a minute, then left with why.
The status log (`<queue>.status.log`) writes times in local time with the offset from UTC. `"test": true` marks a pilot whose requests are kept out of training (a held-out test): the runner writes it into the pilot's `PILOT.txt` (a first line, and the entry as JSON) and the pilot report carries `"test": true`, so later steps (the training data, the in-situ cases) can leave that pilot's requests out. Nothing yet acts on the flag but the report.

**The report** (`bun orchestrator/src/cli.ts pilot-report <DIR>... [--no-write]`). Reads a pilot folder's log alone, prints, and writes `<DIR>/pilot-report.json`:
- the seats and their models, the translator, days run, why it stopped, and whether that was its `until`;
- per seat: model calls, tool uses by kind, answers with no tool use, malformed and dropped tool uses by reason, the notes (`look_each_sitting`, `no_turn`, `notebook_not_changed`), and whether it opted out, on which day, with what statement;
- for the translator: the requests made through `do` (each `draft.<seat>.<n>` once), how each ended (a draft offered; asked back, with the sentence the seat read; refused, with its label; a resolver question; not put), drafts confirmed, declined and unanswered, **matters that got through within two tries**, and the longest run of ask-backs for one seat.
A matter is a request, or that request and the next one by the same seat when the first was asked back; it got through if either became a draft. A draft the seat confirms or declines is its sign-off. Two limits: an ask-back is read from the `asked_back` field the run now writes on the `translation_failure` annotation (older logs: from the sentence, where the plain "could you say it more plainly" counts as a refusal); and the cost of a seat includes its debrief. Where each figure is read from is said in `orchestrator/src/pilot-report.ts`.

**A pinned copy for a wave** (`bun scripts/pilot-wave.ts <wave> <git-ref> <queue.json>... [--dry-run] [--wait MINUTES]`). A resumed run replays its log and can only be resumed on the code it started on, while development goes on in other worktrees. So a wave has its own worktree at `<repo>/.claude/worktrees/wave-<wave>`, made at `<git-ref>` (or reused, if it is at that commit; a wave never moves to another, so a new commit is a new wave), where it runs `bun install` and `bun run kernel`, records the commit in `<runs>/pilot-queues/<wave>.commit`, and starts `scripts/pilot-queue.ts` from that worktree for each queue file: detached (`nohup`, with `caffeinate -i -w <pid>` on macOS), one process each, its output in `<runs>/pilot-queues/<wave>.<queue>.out` and its pid beside it. A queue already running isn't started twice. `--dry-run` says what it would do and does nothing. A wave's worktree is removed (`git worktree remove`) once none of its runs is to be resumed.

**Alerts.** While queues run, `scripts/pilot-queue.ts` tells Naz of: a pilot done, a crash (and the retry), a pilot left after two failures, a pilot parked at a usage limit (`PARKED`, with the sign-in) and each time one is tried again, a spending-limit stop, a queue stopped by a signal, a queue finished, a seat opting out, a prompt too long for a seat's model (each one: `PROMPT TOO LONG`), and things a seat sent that were not sent (at the third in a pilot: `NOT SENT`); the last three are looked for in the log every minute while the pilot runs (the `opt_out` command, the `prompt_too_long` and `not_sent` notes; `OIKOS_POLL_SECONDS` changes the interval). Each is a local-time line appended to `<runs>/pilot-queues/<wave>.alerts.log` (the wave is `OIKOS_WAVE`, which `pilot-wave.ts` sets, or the queue file's name), a macOS notification where `osascript` exists (`OIKOS_NO_NOTIFY=1` turns it off), and, if `OIKOS_ALERT_CMD` is set, that shell command run with the line on its standard input. `bun scripts/pilot-wave.ts status <wave>` prints each queue (running or not), the pilots it has parked at a usage limit (the sign-in, and when each is next tried), and each pilot with where it stands, any opt-outs, the report's translator figures, and the last five alerts.

**A dry run on the mock.** `bun scripts/pilot-wave.ts <wave> <ref> <queue.json>... --mock [--mock-days 30]` (or `bun scripts/pilot-mock.ts <wave> <queue.json>...` directly) runs every pilot as the queue file writes it (world, `sets`, `args`, `until`) with the mock in every seat and as the translator, into `<runs>/pilot-queues/<wave>.mock/<name>`, as far as `--mock-days`, and prints one line per pilot: generated or not, ran to the end or not, and why not. It passes no model, drops the entry's `env`, and fails a pilot whose log shows any seat or translator that is not the mock. A queue entry's `args` (extra arguments for `oikos run`, e.g. a scenario preset once there is one) go to both the mock and the real run. The mock run is slow for a large town (it is the real town without the models).

**Worktrees.** `bun scripts/worktree-clean.ts [--dry-run] [--days N] [--targets] [--waves] [--repo DIR]` lists every worktree under `.claude/worktrees/` with its size and state (HEAD an ancestor of `origin/main`, dirty, locked, a process working in it, a wave copy with a queue running). It removes only the merged, clean, unlocked, unused ones (not the one it runs in, not a wave copy unless `--waves`, never one whose own `runs/` holds anything but `test-*` folders), and deletes their branch if the branch is an ancestor of `origin/main`. Unmerged or dirty ones are reported, flagged when older than N days. `--targets` deletes just `kernel/target` of the ones that stay when nothing is working in them. `pilot-wave.ts` prints the reclaimable sizes when it starts a wave (`--no-list` leaves that out); it never deletes. Nothing under the runs folder is touched.
