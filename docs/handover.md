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
- **Tests:** 319, about 7 minutes in parallel (`bun run test:all`); 16 seconds for the quick tier (`bun run test:fast`).

## What's in flight
- **Moving runs to the Mac mini** (always on, M4 Pro, 64 GB). The plan: cloud sessions edit and push; the mini pulls,
  builds, tests and runs, driven over SSH with `scripts/mini`. Set up the mini with `scripts/setup-mini.sh`.
  - Not yet done: the mini reachable (Tailscale, Remote Login); `codex login` there; the 96 GB of earlier runs copied
    from the laptop's `runs/` (never delete them); the cloud environment's network access and secrets.
  - Not yet checked: whether a cloud session can join a tailnet, how long an idle one lasts, whether memory carries
    over. Until that's known, what matters is written in the repo (CLAUDE.md, this file, docs/decisions.md).
- **Pilot 8b stopped itself on day 39** (Codex calls timing out; the laptop). Its log is kept. Rerun it on the mini as
  the first run there: `scripts/mini run pilot-9 worlds/town-1000.yaml --seeds 1 --set mayor=llm --set
  model_seats=planning,finance --model codex/gpt-6.1-sol --translator-model codex/gpt-6-luna --until 31536000`.
- **Check first** whether gpt-6.1-sol simply takes longer than the Codex adapter's 180 seconds on a big answer
  (`participants/src/llm/codex.ts`): that may be part of why 8b's calls timed out.

## Waiting on Naz
1. **The translator's pass mark.** Suggested: on wrong drafts (at most 1 in 30 held out), not on percent right.
   gpt-6-luna today: 21/26 seen, 18/29 held out, 3 wrong drafts.
2. **Calibration.** Six of fifteen health measures were off after the expansion (docs/decisions.md, "Open"). Since then
   a kernel fix (bodies ran no risk until their first birthday in the world) changed every run's deaths and illness:
   measure again before anything else. Mechanisms first, not rates.
3. **The works manager as a model seat:** suggested after one clean year with three seats, alone, for 90 days.

## Found recently, worth keeping in mind
- Every run before 2026-10-05 had about half its first year's deaths and illness, and no effect of heat at all.
- Runs before the rename used different random draws: not comparable draw for draw with runs after.
- A laptop that sleeps looks like a model that's slow. Long runs: detached, with `caffeinate`, on a machine that stays
  awake (what `scripts/mini run` does).
- Don't edit source while a test suite is running from the same checkout, or rebuild the engine while a run is using
  it: both have produced failures that weren't real.
