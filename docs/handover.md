# Handover: where Oikos stands (2026-10-05)

For a session starting cold: on a new machine, in the cloud, after a break. Read CLAUDE.md first (the rules), then this.

## What exists
- **The world is built.** Every tier of docs/design/world-expansion.md: nature, elections and the paper, clinic and
  school, the tribunal, water and energy, home ownership and the home market, the daily round and roads, floods, crime,
  weather. Contracts are closed at 0.8 (`contracts/README.md`).
- **The AI side has started** (docs/real-models.md, pilots 7a to 8b). A model mayor has governed the 1,000-person town
  for two full simulated years; three seats at once (mayor, planning, finance) for the first 59 and 39 days of two
  more. A model seat takes several actions an answer and keeps office hours; a round's translations run at once; any
  office can be handed to a model (`model_seats`).
- **Tests:** 653, about 7 minutes in parallel on a quiet machine (`bun run test:all`, once per merge); the quick tier in
  under half a minute (`bun run test:fast`); on a branch, `bun run test:changed` (docs/dev-machine.md).

## Where things run
- **The run server is set up**: a Mac mini (always on, M4 Pro, 14 cores, 64 GB, about 620 GB free), host
  `clawds-mac-mini` on Naz's tailnet, user `clawd`. The repo is at `~/oikos`; the whole suite passes there in 204
  seconds. The Codex CLI is signed in to Naz's subscription. It pushes and pulls with a deploy key of its own (the
  remote is `git@github-oikos:nazriz/oikos.git`), which can write to this repo and nothing else.
- **Sessions run on the mini itself**, through Claude Code's Remote Control: a session opened from claude.ai/code or
  the phone (the environment is called "oikos") works in `~/oikos` there, with full permissions, so runs and tests are
  local commands and nothing has to be driven over SSH. It starts at login (`~/bin/oikos-remote-control`, from the
  launch agent `io.oikos.remote-control`), in a tmux session called `oikos`; if it stops it starts again after a minute.
  Not yet tried: an actual restart of the machine.
- **From another machine** (the laptop), `scripts/mini` drives it over SSH: `OIKOS_MINI=clawd@clawds-mac-mini`. The
  tailnet asks Naz to approve SSH in a browser now and then; a session that can't reach it should say so, not retry.
- **Cloud sessions can't reach it** (their network goes through a web proxy; no SSH, no tailnet), which is why Remote
  Control. A cloud session can still edit and push; it can't run anything worth the name.
- **The earlier model runs are on the mini too** (`~/oikos/runs`: pilots 7a to 8b, the Codex records, the translator
  evals), copied from the laptop, which still has them. Never delete either.
- **Also on the mini, and to be left running:** darkbloom (its provider and watchdog, and three models it serves).
  Everything else that used to run there has been stopped.
- Setting up another machine: `scripts/setup-mini.sh` (it has been corrected for what the mini's setup found; it hasn't
  been run from scratch since).

## What's in flight (2026-10-06, 09:00)
- **The Codex subscription's usage limit was reached at 08:38 on 2026-10-06; it says "try again at Oct 10th, 2026
  8:38 AM"** (or buy credits at chatgpt.com/codex/settings/usage: Naz's call). Until then nothing can run on
  gpt-6.1-sol or gpt-6-luna. Two things stopped on it, both cleanly:
  - **Pilot 9, on day 175** (0.48 years). Its log is whole (`runs/pilot-9/town-1000.seed1.jsonl`); resume it when the
    limit resets, from the worktree `pilot9-fix` as below.
  - **The training data** stopped in part 13 of 24 and was finished without Codex (next item).
- **The translator’s training set is written, blind-checked and split** (2026-10-06): `runs/translator-data-2026-10-06/`
  on the mini. Parts 1 to 12 were written by codex/gpt-6.1-sol (6,897 of 7,144 examples agreed in the blind check),
  parts 13 to 24 by Claude subagents through files, a third each to Sonnet, Haiku and Opus (5,843 of 6,156 agreed).
  Whole set: 12,740 of 13,300. `all/` holds the checked examples (12,736 after four exact repeats), `train.jsonl`
  (10,856) and `validation.jsonl` (1,880), split by gold program and by form by `split.ts` there, and a manifest.
  - **Known weakness:** the blind reader of every part was Claude Sonnet, so for parts 13 to 24 the reader is of the
    writers’ family (for a third of them, the same model). Reading those parts again with gpt-6.1-sol once the
    Codex limit resets would close that; `part-NN/blind.jsonl` is what a reader is given.
  - `part-13-sol-partial` (145 examples sol wrote before the stop) is kept and is in neither side: never blind-checked.
  - **Next:** more data in the seats’ own voice (below).
- **Where things stand (2026-10-08, early; the decisions log's last entries have the detail):**
  - **The town's opening slump (2026-10-08; the decisions log, "A town from any place" and "The 1,000-person town's opening slump" with the three entries after it).** It was faults, not behaviour: shops all asked one works; a firm short of a pay period let its whole staff go; and a works opened with a stated sum a third of what a month's inputs and wages cost it, so a month in it could not pay and, the bank lending nothing in a town's first three months, let most of its staff go. All fixed on main. Over 180 days and three seeds: employment 61%, unemployment 1% to 2%, unmet demand about 1%; the 1,000-person month of seed 1 ends at 78940f9a00615cb2. What is left in the first quarter is the scenario's own: the households the spec leaves without a home go by about day 120. Households' saving read negative mostly because the measure counted a dead person's estate as spending (fixed). Two fixes to how ages are drawn wait on the branch `slump-ages` (seven town tests to re-point first). For Naz: the bank's three months; opening staff spread over the works; the participation target, which the profile's own figures put out of reach; rates in the households' spending rule; whether to keep inputs bought with wages kept aside; pilots from day 0 (recommended) or from a town that has run (no saved state to start from today).

  - **Scenarios (2026-10-08; docs/scenarios.md; the decisions log's two entries "Scenarios").** A pilot can start from other than the calm town: `oikos run worlds/town-1000.yaml --scenario wet-year+lean-council ...` (`oikos scenarios` lists them and what each shifts; `--all` for the inert ones in full). Each is data (`worlds/scenarios/`), shifts only starting conditions and the profile's figures by multiples, and makes nothing happen by itself; no seat is told. The plain town is unchanged (78940f9a00615cb2 at 1,000 people, 30 days). Measured against the plain town (120 days, two seeds, what each office is shown): `wet-year`, `hot-summer`, `election-due`, `lean-council` (now a hundredth of the opening balance: wages fail from day 16 in two seeds of three), `jobs-slump`, `housing-shortage`, `dear-rents` (new) and `energy-price-shock` reach an office, some only faintly; `dry-year`, `export-slump`, `ageing-town`, `dirty-industry`, `doctor-shortage` and `police-understrength` are marked inert, each with the platform figure that stops it (the river against the town's draw; the producer's slow shedding; routine care; the pollution unit; the chance of offending). Twelve platform problems are listed in the entry, none patched. No model has been run under one yet.

  - **The call language gained a hold, an entry on one's own file and the refusal `look_first`** (2026-10-08; the decisions log, "A hold, an entry on one's own file, and look_first"; docs/design/call-language-gaps.md, steps 1 and 2). `statement(hold=…)` is an instruction to whoever acts on a standing record; the bank honours it (nothing under a held order is paid from the first due date a day after the hold, nothing is made up when it is lifted, and what was missed is still owed: docs/behaviour/bank-payment-system.md) and lists a customer's own standing instructions in its letters. Eight refusal labels. The prompt is 0.8.0 and the data pipeline 0.11.0: **the training data has to be made again and the model retrained before a trained model can answer with any of the three** (the model on disk loads and answers as before; `DecideAdapter.cannot` says what it lacks). 23 real cases and one seen case were re-keyed; the held-out cases were written before this and were not read. Not done: the seat's instructions do not yet say that a paper is named by its id; other readers of standing papers do not honour a hold; directions to offices and forms for an office's own papers wait for the knowing work.
  - **Nobody has a god's view (2026-10-08; docs/no-god-view.md; the decisions log's last two entries before "Open").** A fast-tier test (`orchestrator/test/no-god-view.test.ts`) fails when any kind of seat is shown a whole register, population or map, or handed the run's future, unless its module keeps that register and says so (`keeps`) or stands for the simulation's edge (`boundary`); behaviour code asks whoever keeps a thing for the one thing it needs (`ask`, `participants/src/behaviour/common.ts`). Of 133 whole views found, 52 are gone (deaths are told to those concerned; nobody is sent the electoral roll; people know the shops near them and those they hear of; property for sale is searched; the union reads a published price index and learns workplaces from its members; shops find producers by their trade lists; offices' channels say whose they are). 81 are listed in the test as owed, and wait on three decisions of Naz's: a directory that can be asked about one entity (a contract change), an act of going to look at a place (a contract and kernel change: the police, the builder, the inspector, the funders), and whether the land registry and the electoral office are bodies of their own. Months now end at 8ae630800d86f847 (1,000 people), 891c8efe8f07efa5 (3,000), 8c5562da7ea97d8d (10,000). In a year of 1,000 people unmet demand rose from 39% to about 48% (people order at the few shops they know; one run had 54%): a finding for Naz.
  - **The translator reads any world's money** (2026-10-08; the decisions log, "The translator reads any world's money"). An amount is copied by the translator and read by code, in the world's currency: its sign, code or word before or after, a decimal comma, points between thousands, groups of two, lakh and crore (now the Indian profile's `number_words`, not the parser's); what could be two numbers ("1.234") is refused. Both parsers are held to `contracts/test/amounts.json`. The prompt is 0.7.7 (one line changed; it is told no currency, on purpose), the data pipeline 0.10.0 (amounts in seventeen invented currencies and each profile's). No model has been run on another currency, and the model on disk has never seen a sign after the digits, a decimal comma or lakh: measure it on the first pilots' requests before trusting it there. Done the same day ("A place states how it writes money"): the currency has decimal_mark, group_mark, grouping, symbol_after, symbol_spaced and number_words, and each profile states its own.
  - **The training pipeline's pod step, test-set scores and readers** (2026-10-08; docs/translator-pipeline.md; the decisions log, "The pipeline's three unfinished things"). `pod.sh` has trained and brought home a run on a rented pod and ended it; `translator-eval --set FILE` scores any model on a pipeline's test sets by pilot, seat model, profile and currency, and the pipeline does it after training; the default readers are Sonnet 5.5 and gpt-6.1-sol. **A trained model's scores moved on 2026-10-08 because the scoring did** (a cut-off of 0.1 by default, keys with several bases): data-13 models score 141 of 180 real today, not 147. Score an older run again before comparing. Not yet done: one whole pipeline run on real models with training.
  - **The translator's model:** `microsoft/deberta-v3-small` as the reader, arguments by name, trained on `runs/translator-model/data-13` gets 147 to 148 of 180 real requests, 44 to 47 of 66 held out, 50 to 52 of 64 seen, over three seeds (`pod-small-s1..3`). The next reader up and the other argument orders are no better. With a cut-off on its sureness wrong drafts fall under 1 in 100 on real requests, and it then asks back on two in five. The pass mark (90% right, 1% wrong) is a floor, by Naz's word. Nothing is set as the shipped model or cut-off yet.
  - **Training runs on a rented GPU** when wanted: `runs/translator-model/runpod/` (`ssh.sh`, `pull.sh`, `watchdog.sh`, `stop.sh`; the key is `RUNPOD_API_KEY` in `~/.zshenv`, the SSH key `~/.ssh/oikos_runpod`). A run is about 18 minutes there. Check that no pod is left running: `stop.sh` ends the one in `pod-id`. Two runs on `data-15` (with the permission-granting claims) were queued when this was written.
  - **Who owns firms changed, and how a death comes to be known** (2026-10-08; the decisions log's last three entries; docs/behaviour/firm-ownership.md, deaths.md). Shops and landlords are held by their owners, factories mostly from outside with a minority of households holding shares directly; the retirement fund that was proposed with it is off unless a town asks for one (`retirement_fund: true`), by Naz's word. A death at home is reported by whoever of the household is there (looked for at every wake, not in the week's plan), by a child's word to an adult, or, with nobody at home, by the landlord or the police after the time the profile gives. Every run moves: the 1,000-person month ends at 2844216b75ba5d64 (was 7596cffa9d339a58). For Naz: the police's sight of every home on request (a stand-in for callers the world doesn't have); deaths outside any building and at work, which nobody registers; and one seed whose shops' start-up shortage now lasts most of a year.
  - **Seats can run on Claude** through Claude Code (`--model claude-code/claude-sonnet-5-5 --budget N`; docs/real-models.md). On Naz's plan it draws on his ordinary usage. Pilot 10 (`runs/pilot-10`: a town from seed 2, three Claude seats) ran half a year: 508 calls, about 42 by Claude Code's count.
  - **Pilot 10's requests are a test, not training data** (`runs/translator-data-in-situ/pilot-10-requests`). They showed that seats grant permits (a `claim` of a liberty), which the model had never seen said that way, and that the translator's prompt does not settle what `basis` holds when several records are cited: Naz's to decide.
  - **Scaling:** every citizen was shown the whole lot and title registers, each keeping its own copy. Records are now handed over once, a run starts from its config without copying it, and the bank goes through standing orders when due: a month of the 1,000-person town takes 12 to 15 seconds in 1.9 GB (was 23 s, 5.9 GB), 3,000 people 47 seconds in 5.9 GB (was 102 s, 28 GB), results the same to the byte. Then the books were made to share what they are shown in common (a long list shown in one look is held once, on a shelf every book shown it reads from; `Book` in `participants/src/behaviour/common.ts`, checked against a plain twin in `participants/test/book.test.ts`): 1,000 people now 1.3 GB, 3,000 people 2.9 GB, and a 10,000-person month, which had passed 40 GB on day 2, runs to its end in about 400 seconds at 11 GB (final state d33f1f4c9dd5ac32), results still the same to the byte at 1,000 and 3,000. What still grows faster than the town is time, not memory: each citizen's first look at both registers (the kernel builds and hashes 6 MB for each, the host reads 24,400 ids: over half the 10,000-person month), then public records arriving one by one in every book. Making the registers on request for citizens (Naz's call) would end the first. Also Naz's: households each holding every firm; and a found fault left alone because fixing it changes a run: a bulk payment whose amount is no number makes the bank's step throw where it should refuse.
  - **Seats spend most calls not acting:** in pilot 10, 60% of calls only looked something up, said they were done, or rewrote the notebook. (A seat's system prompt is nearly always the same from call to call: 10 versions in 157 to 201 calls, when a price list on file changed. I first read the log as saying it changed most calls; it does not, and there is nothing to split. The cache that is written every call is Claude Code caching what the seat is shown that turn, which is never read again and can't be turned off from the command line.) Naz approved making seats more efficient, and the loop (0.8.0) now has three things for it, none yet run with a real model: a look can be kept ready for every sitting (`look` with `each_sitting`), no turn is taken when all an answer did was look into whole reports and nothing was in them, and the notebook can be added to or changed in part (`add`, `change`). On pilot 10 that is 7% to 14% of calls if seats take the first up, and 29% fewer notebook characters; a short pilot has to say what seats do with it (decisions log, "A seat that takes fewer calls"). The largest waste in pilot 10 is not touched: 12% of its seats' answers were never read by the Claude Code adapter (the tool uses written in another shape), each ending a sitting with nothing done.
  - **Scaling:** every citizen was shown the whole lot and title registers, each keeping its own copy. Records are now handed over once, a run starts from its config without copying it, and the bank goes through standing orders when due: a month of the 1,000-person town takes 12 to 15 seconds in 1.9 GB (was 23 s, 5.9 GB), 3,000 people 47 seconds in 5.9 GB (was 102 s, 28 GB), results the same to the byte. Then the books were made to share what they are shown in common (a long list shown in one look is held once, on a shelf every book shown it reads from; `Book` in `participants/src/behaviour/common.ts`, checked against a plain twin in `participants/test/book.test.ts`): 1,000 people now 1.3 GB, 3,000 people 2.9 GB, and a 10,000-person month, which had passed 40 GB on day 2, runs to its end in about 400 seconds at 11 GB (final state d33f1f4c9dd5ac32), results still the same to the byte at 1,000 and 3,000. What still grows faster than the town is time, not memory: each citizen's first look at both registers (the kernel builds and hashes 6 MB for each, the host reads 24,400 ids: over half the 10,000-person month), then public records arriving one by one in every book. **Done 2026-10-08 ("Nobody has the land register by heart", the decisions log's last entry before "Open"): citizens, letting offices and the builder are shown no register and search it by id when a paper of their own calls for it; a person in work reads the agreements at their own workplace. Results change by decision: the months now end at 1fee363488718647 (1,000 people), 4f1d8ddcfe24cfed (3,000) and 29ace6951a9053aa (10,000, in about 240 to 380 seconds); a year of 1,000 people is the old year in every measure. One contract change for sign-off (a search may name a record's id, and the claim a transfer names). The entry lists the whole-town views still shown (every shop's prices and every death above all) and what narrowing each takes.** Also Naz's: households each holding every firm; and a found fault left alone because fixing it changes a run: a bulk payment whose amount is no number makes the bank's step throw where it should refuse.
  - **Seats spend most calls not acting:** in pilot 10, 60% of calls only looked something up, said they were done, or rewrote the notebook. (A seat's system prompt is nearly always the same from call to call: 10 versions in 157 to 201 calls, when a price list on file changed. I first read the log as saying it changed most calls; it does not, and there is nothing to split. The cache that is written every call is Claude Code caching what the seat is shown that turn, which is never read again and can't be turned off from the command line.) Fewer look-ups costing a call each, fewer wake-ups that end in nothing, and a notebook that can be added to are the savings, and each changes what a seat experiences: proposals for Naz, not done.
- **Where the translator’s model stands (2026-10-06, late):** the pretrained arm trained on the written set plus examples from real situations gets 132 of 180 real requests, 41 of 66 held out (`runs/translator-model/pretrained-4`); the pass mark is 90% right and 1% wrong. `pretrained-5` (all 1,211 real-situation examples, `data-7`) was training when this was written; `runs/translator-model/next.sh` scores it when it ends. In-situ data: `runs/translator-data-in-situ/` (88 of 230 writer chunks done; commands in the decisions log, “written in situ”). Decisions log: “What data from real situations did”.
- **The translator’s own model is being trained** (begun 2026-10-06; decisions log, “The translator’s own model”). Code: `translator/model/` (`encode.ts` programs as steps, `export.ts`, `score.ts`, `adapter.ts`; `py/` the model, `train.py`, `predict.py`, run with `uv run`). Runs and exported data: `runs/translator-model/` on the mini (each run’s folder has its log and a NOTE where its numbers shouldn’t be trusted).
  - To train: `bun translator/model/export.ts runs/translator-data-2026-10-06/all runs/translator-model/data-N`, then in `translator/model/py`: `uv run python train.py <data> <out> --epochs 45 --renumber 0.8 --forms 0.7 --dropout 0.2 --piece-dropout 0.15` (detached). To score: `bun translator/model/score.ts` for validation, `oikos translator-eval --model decide/<run> --real` for the tests.
  - **The second arm** (a pretrained encoder as the reader; decisions log, “second arm”): the same `train.py` with `--encoder microsoft/deberta-v3-xsmall --epochs 8 --validate-every 2 --renumber 0.8 --forms 0.7` (about 17 minutes an epoch alone on the GPU; don’t run two trainings at once). `uv run python tokens.py <data>` checks an export’s spans and lengths in the encoder’s tokens. `runs/translator-model/pretrained-3` (data-5): validation 93.5% by meaning; seen 50/64, held out 36/66, real 64/180. `OIKOS_DECIDE_LOG=<file>` makes `predict.py` log each answer’s length, sureness and time. Still to do: the from-nothing arm on data-5, for a like-for-like comparison.
  - **Where it stands:** good on validation (88%), poor on the tests (real 12/180): the training set isn’t in the seats’ voice. The pass mark is agreed (confidently wrong ≤ 1%, right ≥ 90%).
  - **Codex:** Naz’s plan is Plus now; a five-hour window lasts about 20 minutes of our use. Pilot 9 is paused on his word at day 178 (resume as before when pilots are decided on). Still to run when a window is open: gpt-6.1-sol on the real requests under prompt 0.7.4 (`oikos translator-eval --model codex/gpt-6.1-sol --only-real`).
  - What follows in this section was written before the stop.
- **The translator's training data is being written**: `runs/translator-data-2026-10-06/` on the mini, 24 parts
  (`part-NN/examples.jsonl`, `manifest.json`, `rejects.jsonl`), by `make.ts` there (its pid in `pid`, its console in
  `make.log`), codex/gpt-6.1-sol writing, six calls at a time, about 20 minutes a part. It skips parts already
  written, so if it stops (a usage limit: the log says so), run `bun make.ts` there again.
  - **It runs from the worktree `~/oikos/.claude/worktrees/dev`: don't edit source or rebuild there while it runs.**
    Work in another worktree.
  - **Still to do on each part:** the blind check. `oikos translator-data-check <part> --blind` writes the requests in
    shuffled order; a reader of another model family (a Claude subagent given only the translator's prompt) writes its
    answers; `oikos translator-data-check <part> --answers FILE --reader NAME` keeps what agrees by meaning.
  - **Then:** the other voices (about 30% of the set from Claude models and gpt-6-luna, the same pipeline), one split
    by gold program over all parts, and the choice of base model and where it trains (not made).
- **Pilot 9 is running on the mini** (the three-seat year; started 2026-10-05 19:45). It stopped itself on day 63
  (00:14) on a platform bug (a statement's kind written with spaces reached the log), and was resumed from its log at
  00:37 from the worktree `~/oikos/.claude/worktrees/pilot9-fix`: the code it started on (a3d1531) with that one fix.
  Its stopped log is `runs/pilot-9/town-1000.seed1.stopped-1.jsonl`. **It can only be resumed from that worktree**
  (`bun orchestrator/src/cli.ts resume ~/oikos/runs/pilot-9/town-1000.seed1.jsonl --until 31536000 --model
  codex/gpt-6.1-sol --translator-model codex/gpt-6-luna`): newer code shows a seat more, so its prompts differ and
  every call would be asked again. Its laws bind nobody (that is fixed on `main`, not in it).
- **The mini's own checkout (`~/oikos`) is still at a3d1531.** Nothing runs from it now; `main` is far ahead. Bring it
  up to date (`git pull`, `bun install`, `bun run kernel`) when pilot 9 has ended, and remove the worktrees then.
- **The readiness scorecard** (docs/decisions.md, 2026-10-05 and -06) is met on all ten lines: the suite passes (441);
  gpt-6.1-sol gets 64 of 66 held-out cases, 63 of 64 seen and 175 of 180 real pilot requests; the data pipeline's
  second trial was 98.9% right by an independent audit.
- **A 20-day stress run on the new code** (three seats and the translator on gpt-6.1-sol) is kept as
  `runs/stress-1-2026-10-06`: no errors, 94 seat calls where pilot 9 needed over 200.

## The translator (the priority: Naz, 2026-10-05, "before the citizens, the translator")
- **The held-out test cases are outside the repository** (`~/oikos-private/translator/held-out.json`, 66 cases).
  **Never read that file while working on the prompt or on training data**, and never quote it:
  `translator/eval/held-out.ts` says why. Results come by case id, outcome and shape only. Changes to it are made by
  a subagent that reports counts and ids.
- **Three test groups:** the seen cases (`translator/eval/cases.ts`), the held-out ones, and the pilots' 180 real
  requests (`translator/eval/pilot-cases.ts`; `oikos translator-eval --model … --real`).
- **gpt-6.1-sol is the reference** (and translates well enough to use in runs); gpt-6-luna gets 44 of 60 held out.
- **Seven refusals** now: `not_an_act` (a request to look, not to do) and `no_such_act` (clear, and nothing does it)
  were added from what real seats asked.

## Waiting on Naz
0. **From 2026-10-05 and -06** (he gave standing permission to change whatever the readiness goal needed, contracts
   included; these are what's left for him):
   - **The base model for the trained translator, and where it trains.** The data serves either design in
     docs/design/translator-and-resolver.md §16.10; nothing is chosen or installed.
   - **gpt-6.1-sol as the translator in runs** until the trained one exists (his earlier word was gpt-6-luna for
     narrow work; luna fails the test, sol passes it).
   - **Refusing a half-sayable request whole** (the rule now) or doing the part that can be said.
   - **Whether a town should own the laws built from figures** (they now speak for the town, so the council can amend
     them).
   - **Where a second copy of the held-out cases lives** (one copy, on the mini).
   - **Contract additions made under his permission, to look over:** two refusal labels; a form's office optional in a
     call; a currency's symbol and words; a failed model call in the log. Each is in contracts/README.md and
     docs/decisions.md.
   - **Not done, from the audit:** councillors still vote on a label (he said: the AI citizen code at most, after the
     translator); the stdio kernel connection isn't safe for several requests at once (only the fallback transport);
     a landlord's arrears count lifetime receipts against one lease's dues; `citizen.ts` and `exec.rs` are too large;
     a plain repeal of a law doesn't reach those who follow it.
1. **The translator's pass mark.** Suggested: on wrong drafts (at most 1 in 30 held out), not on percent right.
   gpt-6-luna on the clean set: 5 wrong drafts in 60 held out.
2. **Calibration.** Six of fifteen health measures were off after the expansion (docs/decisions.md, "Open"). Since then
   a kernel fix (bodies ran no risk until their first birthday in the world) changed every run's deaths and illness.
   Measured again 2026-10-05: four of fifteen off (unemployment, group participation, religious affiliation, demand
   unmet at 16.7%). Mechanisms first, not rates; nothing has been changed.
3. **The works manager as a model seat:** suggested after one clean year with three seats, alone, for 90 days.

## Found recently, worth keeping in mind
- Every run before 2026-10-05 had about half its first year's deaths and illness, and no effect of heat at all.
- Runs before the rename used different random draws: not comparable draw for draw with runs after.
- A session's background commands are stopped after about half an hour: a long run has to be detached from it (`nohup`),
  and looked in on, not waited for.
- A laptop that sleeps looks like a model that's slow. Long runs: detached, with `caffeinate`, on a machine that stays
  awake (what `scripts/mini run` does).
- **Running tests on the shared machine (2026-10-08; docs/dev-machine.md).** One full suite per merge: `bun run
  test:all` is run once, on the merge, by whoever merges. On a branch: `bun run test:changed` (the fast tier and the
  tests that import what the branch changed; it says what it chose and why), or `bun scripts/test.ts <filter>...`.
  Suites, kernel builds and `oikos run` batches share the cores through the slots (`bun scripts/slots.ts status` says
  who holds them and who waits; a job that waits says so once a minute and loses nothing but time). A fresh worktree
  is made ready with `bun scripts/worktree-warm.ts <path>`. Never kill by pattern (`pkill -f`, `killall`): only a
  process id you started.
- Don't edit source while a test suite is running from the same checkout, or rebuild the engine while a run is using
  it: both have produced failures that weren't real.
