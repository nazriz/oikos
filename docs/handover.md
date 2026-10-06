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
- **Tests:** 441, about 8 minutes in parallel (`bun run test:all`); 16 seconds for the quick tier (`bun run test:fast`).

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
- Don't edit source while a test suite is running from the same checkout, or rebuild the engine while a run is using
  it: both have produced failures that weren't real.
