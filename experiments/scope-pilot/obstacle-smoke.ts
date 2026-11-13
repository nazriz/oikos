// The obstacle run's smoke: rung 1 of obstacle-run.ts (10 days after the fork, one seed, level 2), the same setup as
// every rung (see obstacle-run.ts's header for the setup, the health check and the rungs). Ready to run after the
// baseline's faults are fixed (gate-faults, 2026-11-14); not yet run.
//
// PASS (rung 1): the funnel healthy for the desk and the factory; at least one obstacle met and cleared; every seat
// debriefed; and papers of the desk's that reached the lender (bank) or the support office (outside) came back and were
// shown to it. `bun experiments/scope-pilot/funnel.ts <dir> --gate rung1` says so, and exits 1 if not.
// Expected cost: well under a dollar (a 10-day fork: about 40 desk calls, 12 factory calls, two debriefs); its hard
// limit is rung 1's fork limit (RUNGS[1].forkUsd, $2).
//
// To start it (on the run server, from the checkout; detached and kept awake; never deletes a run):
//   cd ~/oikos && nohup zsh -c 'source ~/.zshenv; unset ANTHROPIC_API_KEY; OIKOS_TRANSLATOR_MODELS=$HOME/oikos/runs/translator-model bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/obstacle-smoke.ts --out $HOME/oikos/runs/scope-obstacle-smoke && bun experiments/scope-pilot/funnel.ts $HOME/oikos/runs/scope-obstacle-smoke --gate rung1' > $HOME/oikos/runs/scope-obstacle-smoke.out 2>&1 & caffeinate -i -w $! &
// (The same as `OIKOS_RUNG=1 OIKOS_OBSTACLES=2` with obstacle-run.ts, under its own name.)
process.env.OIKOS_RUNG = "1";
process.env.OIKOS_OBSTACLES = "2";
const { obstacleRun, RUNGS } = await import("./obstacle-run");

export default obstacleRun({ name: "scope-obstacle-smoke", level: 2, days: RUNGS[1]!.days, seeds: RUNGS[1]!.seeds[2]!, forkUsd: RUNGS[1]!.forkUsd });
