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
