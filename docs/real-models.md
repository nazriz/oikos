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
- The answer is one JSON object in the shape the Codex adapter's schema has, asked for in words. An answer that isn't one is asked for again, then taken as words.
- Tokens come from the result, cached ones too. Claude Code caches what repeats (the system prompt and tools) for an hour by itself.

**What it costs, and the spending limit:**
- It is priced as `anthropic/<model>` in `orchestrator/prices.json`, and needs `--budget` like any priced model.
- Claude Code also says what each call cost, and that is more than its token counts come to at the published price: in the first smoke run (three simulated days, one mayor, five calls) $0.24 by its count against $0.09 by ours. Why is not known (thinking that is billed but not counted as output is my guess). The call's recorded cost is the larger of the two, so the limit holds against what Claude Code says is drawn.
- `OIKOS_CLAUDE_CODE_LOG=<file>` adds each call's counts and reported cost to a file (never the prompt or the answer).
- Forcing the answer's shape with `--json-schema` was tried and dropped: Claude Code then takes two to four turns of the model for one answer ($0.046 against $0.022 on one seat-sized call).

**Caveats:** the plan's limits apply, and when Claude Code says a limit is reached the run stops cleanly to be resumed, as with Codex. What the account is really charged is on the account's usage page, not in our log: check the two against each other before trusting a projection.

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
