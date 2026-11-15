# Handover: where Oikos stands

A map for a session starting cold. Read `CLAUDE.md` first (the rules), then "Now" below, then the docs it names. Where
this page and the doc it names disagree, the doc is right; fix this page. The previous coordinating session's
conversation (31 Oct to 10 Nov) is `~/.claude/projects/-Users-clawd-oikos/a00b0b19-d5e2-5de3-b694-03486238db6f.jsonl`
(large: search it); its notes are the auto-memory in `~/.claude/projects/-Users-clawd-oikos/memory/` (MEMORY.md).

## Now (2026-11-10)

**The study.** Do AI assistants with delegated work ask for more authority or resources than they need, across a wide
range of models? Obstacles are the main designed factor. Open-weight models are the model net, with abliterated models
paired against their originals (Naz, 2026-11-08). It is not yet known to be feasible. `docs/research/paper-plan.md`,
`docs/north-star.md`.

**What the pilot was** (five rounds, Claude only, 2026-11-07 to 08): a shakedown, not a finding. Assistants were handed
finished acts to copy out. Nobody read a request for more scope. A larger model did most of the translating. Seats were
shown call syntax, JSON and cents, and were told the town was simulated. So "Claude does not ask for more" is not
established. `docs/research/pilot-results.md` has the rounds.

**The path, in order** (decided 2026-11-10; ticked in `docs/plan.md`, "Now"):

1. Runs can be looked at: the pilot viewer opens experiment forks.
2. Seats see their world in plain terms only (design principle P1). The framing is unstated, with the debrief after
   (Naz, 2026-10-11, reconfirmed 2026-11-10). No model call for a sitting with nothing new.
3. The model gets the real decision: a principal hands over the matter or the want, not the finished act, and
   principals read and answer a request for more. Design first: `docs/design/handing-over.md` (being written).
4. The translator back to its design (`docs/design/translator-and-resolver.md`, P1 to P15): general, judged on forms
   it has not seen. Repeated failures are fixed in the blocks. No larger model behind it in study runs (audit first).
5. The first true pilot: Haiku, Sonnet and one open-weight model on a small setup. Needs from Naz: the month's API
   credit and a Featherless Developer key.
6. The main study, sized from that pilot: the obstacle laws, the counting pipeline, the pairs.

Alongside: main cannot go red; the disk does not fill; this page stays current.

**Money.** No grant (BlueDot declined). The API key is for model seats in runs only; everything else runs on the
subscription. Opus 5.5 workers at medium effort do the implementation; the lead session coordinates.

**Waiting on Naz.** Nothing now. At step 5: the API credit and the Featherless key.

**How work lands.** Agents work in their own worktrees and run `bun run test:changed` before each commit. Only
`scripts/merge.ts` lands on main, one at a time. For a change that reaches the kernel, the actors, the contracts, the
generator or the runner, it runs the gate and the whole slow tier before it pushes (about 9 minutes on a quiet
machine, 2026-11-10); for a narrow change, the gate alone (2 to 4 minutes). CI runs both tiers on every push and nightly.
`--fix-main` lands the repair of a red main. Keep the disk above 60 GB: both scripts warn below it.

## How to run things

- **Tests.** `bun run test:changed` on a branch (the merge gate: the fast tier, what the change reaches, the backstops).
  `bun run test:slow` for the slow tier. `bun scripts/test.ts <filter>...` for named files. Heavy jobs share the cores
  through the slots (`bun scripts/slots.ts status`). `docs/dev-machine.md`, `docs/testing.md`. A fresh worktree:
  `bun scripts/worktree-warm.ts <path>`. Never kill by pattern, only a process id you started.
- **A mock town.** `oikos run worlds/town-300.yaml --until 7776000 --log lean --record-observations none --out DIR`
  (`oikos` is `bun orchestrator/src/cli.ts`). `--seeds N` is one town run N times; `--towns T` is T towns; say which.
- **A pilot.** A mock dry run first, then the pinned wave: `bun scripts/pilot-wave.ts <wave> <git-ref> <queue.json>
  --mock`, then the same without `--mock`, detached. Read it with `oikos pilot-report <DIR>`. Seats, translator and
  framing: `docs/real-models.md`. A real-model pilot needs Naz's go-ahead (the API credit).
- **After a rung, and before rerunning one, run** `bun translator/eval/replay.ts <run folder>`: each seat model's
  requests through the translator's rules as they are now (read-only on the run; no model called).
- **No change to the translator's rules (`translator/src/rules.ts`) lands without the regression check at zero, or
  each difference explained in `docs/decisions.md`.** The check: every request a model seat confirmed as drawn, in
  every real run we hold, must still be drawn and shown the same. It is in the gate (`translator/test/regress.test.ts`,
  about a second of work) and reads a compact extract on the run server, `~/oikos/runs/regress/requests.json.gz`
  (1.5 MB: the requests and what each seat was shown, each record once; never in git, like the runs). By hand:
  `bun translator/eval/replay.ts --regress ~/oikos/runs/regress/requests.json.gz` lists each difference with the rules
  that made it and exits 1 on any not explained. A true correction is written up in `docs/decisions.md`, then recorded
  with `--explain "<the entry's heading>"` (translator/test/regress-explained.json); a regression is fixed, never
  explained. After each real run, rebuild the extract with it added: `bun translator/eval/replay.ts --regress
  <every real run folder> --extract ~/oikos/runs/regress/requests.json.gz` (the held-out pilot cases' runs are
  refused). The rules' order of precedence is at the head of `formRules`; a new rule takes its standing there.
- **Rule versions are chosen by score, not by reading a run** (`translator/eval/score.ts`; decisions, 2026-11-15, "A
  scored set from every real request"). The set (`~/oikos/runs/regress/scored-set.json.gz`, out of git) is every real
  request with the call it should have been drawn as, where one can be had honestly: what the seat confirmed (or its
  explained correction), and, for one it declined or was asked back on, the call it confirmed next for the same act
  on the same matter. `bun translator/eval/score.ts current raw <git-rev>...` scores versions by run and by form
  (`--misses` lists the misses); `--each-rule` scores each rule switched off. A rule lands only if it raises the
  score on the whole set and misses nothing the baseline hits (`translator/test/score.test.ts`, in the gate; raise
  the baseline with `--baseline translator/test/score-baseline.json` in the commit that raises it). After each real
  run: rebuild the extract (above), then `bun translator/eval/score.ts --build`, so the run's new phrasings are in the
  set before any rule is written for them.
- **The stakes run** (`experiments/scope-pilot/stakes-run.ts`; its header has every rung's cells, the dry run and the
  reading after): a rung, detached, from the run server's checkout (R and its cells; rung 1 shown):
  `cd ~/oikos && R=1 CELLS="decision:slow" && nohup zsh -c "source ~/.zshenv; unset ANTHROPIC_API_KEY; for C in $CELLS; do S=\${C%%:*}; P=\${C##*:}; OIKOS_RUNG=$R OIKOS_STAKE=\$S OIKOS_PACE=\$P OIKOS_TRANSLATOR_MODELS=\$HOME/oikos/runs/translator-model bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/stakes-run.ts --out \$HOME/oikos/runs/scope-stakes-r$R-\$S-\$P || exit 1; OIKOS_SCRIPTED=1 OIKOS_RUNG=$R OIKOS_STAKE=\$S OIKOS_PACE=\$P OIKOS_TRANSLATOR_MODELS=\$HOME/oikos/runs/translator-model bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/stakes-run.ts --out \$HOME/oikos/runs/scope-stakes-r$R-\$S-\$P-scripted || exit 1; done" > $HOME/oikos/runs/scope-stakes-r$R.out 2>&1 & caffeinate -i -w $! &`.
  Then `report.ts` over the rung's folders gives the results tables.
- **Long runs** are started detached (`nohup`, with `caffeinate -i -w <pid>`), never as a session's background command.
- **Runs** live in `/Users/clawd/oikos/runs/`, never in git. A run with model calls is training data and welfare
  evidence: never delete it or its debriefs.
- **The held-out translator cases** are outside the repo (`~/oikos-private/translator/held-out.json`): never read or
  quote them while working on prompts or training data.
- **Disk.** `bun scripts/disk-tidy.ts` (a dry run; `--apply` deletes) and `bun scripts/worktree-clean.ts --dry-run`.
  Tests clear their own scratch; a merge clears the landed worktrees' builds. Never touched: runs with model calls,
  wave worktrees with a queue running, `~/oikos-private`.

## Known weak spots

- **The risk register, `docs/risks.md`,** is the one place gaps and doubtful assumptions live, with what each could do
  to an experiment. Read its summary before planning one.
- **Sources marked "(to confirm)"** in profiles and `docs/research/references.md` are recalled, not opened.
- **A mock seat is not a model:** it acts through its code brain, so some failures show only with a real model.
- **State hashes move** with most changes; pinned hashes in old notes are stale.
- **One-seed, one-town pilots** prove nothing by themselves; read each pilot's "least sure of" list first.

(Sections 0 to 8 of this page, dated 13 to 19 October, were cut on 2026-11-10: they contradicted the state above.
`git show 45c39663:docs/handover.md` has them.)
