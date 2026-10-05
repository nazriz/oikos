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
- **Tests:** 361, about 9 minutes in parallel (`bun run test:all`); 16 seconds for the quick tier (`bun run test:fast`).

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

## What's in flight
- **Pilot 9 is running on the mini** (started 2026-10-05 19:45, detached, with `caffeinate`): the three-seat year, mayor,
  planning and finance on codex/gpt-6.1-sol, translator on codex/gpt-6-luna, into `runs/pilot-9` (its pid in
  `runs/pilot-9/pid`, its console in `runs/pilot-9/nohup.out`). About five minutes a simulated day.
  - **The mini's checkout (`~/oikos`) is still at a3d1531, on purpose,** and must stay there until pilot 9 ends: no
    `git pull`, no kernel rebuild, no source edits there. Work goes on in a worktree
    (`~/oikos/.claude/worktrees/translator-work`, its own kernel build) and is pushed from it.
  - **Pilot 9 can only be resumed from that checkout.** The code on `main` since then shows a seat more (forms whole,
    a law's rule), so its prompts differ and a resume on it would ask every call again. If it stops by itself: keep the
    log, say why, and `bun orchestrator/src/cli.ts resume runs/pilot-9/town-1000.seed1.jsonl` from `~/oikos` as it is.
    A resume after a failed model call diverges on that old code (fixed on `main`; it had no failed calls at day 14).
  - Its laws bind nobody (below), so read what its seats did, not what their laws changed.
- **The code audit of 2026-10-05 and its fixes** are in docs/decisions.md (five entries of that date). On `main`: runs
  can't be overwritten, stopped runs say so and resume (failed calls included), opt-out is always honoured, a seat is
  told what wasn't done, the kernel's guards cover `kernel/crates`, the preview shows every field of an act.
- **Pilot 8b stopped itself on day 39** (Codex calls timing out; the laptop). Its log is kept. The adapter's 180 seconds
  wasn't why: gpt-6.1-sol answers 8b's largest requests in 28 to 56 seconds on the mini (docs/decisions.md).

## The translator (the priority: Naz, 2026-10-05, "before the citizens, the translator")
- **The held-out test cases are outside the repository** (`~/oikos-private/translator/held-out.json`, 60 cases; the old
  set had leaked into the prompt). **Never read that file while working on the prompt or on training data**, and never
  quote it: `translator/eval/held-out.ts` says why. Results come by case id, outcome and shape only.
- **Baseline on the clean set** (gpt-6-luna through Codex, translator 0.5.1): held out 44/60 right, 11 no draft, 5 wrong
  drafts; seen 41/55, 3 wrong drafts. Ten of the sixteen held-out misses are refusals it didn't make.
- **Training data:** `oikos translator-data <logs> --model … --back-model … --out DIR` (translator/train/data.ts; give `--model`
  and `--back-model` more than once: a request is checked by a model that didn't write it) is
  built and tested with stand-in models. No model has written anything yet: see "Waiting on Naz".

## Waiting on Naz
0. **From 2026-10-05, in order of how much waits on them:**
   - **Who writes the training requests.** OpenAI's terms restrict using outputs to develop competing models, so Codex
     as the writer needs his call; the other route is a local open model (Ollama is installed, not running, and would
     share the machine with darkbloom). Then: the base model and where training runs.
   - **Laws that bind:** the proposal in docs/design/ai-citizens.md 2e (the clerk drafts amendments to laws in force
     from a form's figures; the translator can't write conditions). Councillors stay as they are until the citizens'
     work; they get the AI citizen code at most, never a model (his word).
   - **Where a second copy of the held-out cases lives** (one copy, on the mini).
   - **Two investigations or surveys in one action:** only the last result reaches the actor; reporting both needs the
     outcome's shape changed (a contract change, not made).
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
