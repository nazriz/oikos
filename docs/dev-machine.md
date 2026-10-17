# The development machine

One Mac is shared by many agents and people, each in a git worktree of its own. Left alone, each of them builds the
kernel, runs towns and runs the whole test suite at once, and the machine spends hours at a load several times its
cores: tests fail by timeout and a ten-minute suite takes an hour. Four things keep that from happening. The reasoning
and the measurements are in docs/decisions.md ("A shared machine that stays usable", 2026-10-08).

## The rule

**One full suite per merge.** `bun run test:all` is run once, on the merge, by whoever merges. Work on a branch runs

- `bun run test:changed`: the fast tier, and every other test file that is changed, imports a changed file (however
  far down) or names a changed data file, compared with `origin/main` (`--base REF` for another). It prints what it
  chose and why. A change to the kernel's sources adds the kernel's own tests, not the tests that simulate towns:
  those are the merge's.
- or `bun scripts/test.ts <filter>...` for the tests you know cover the change, and `bun run test:fast`.

**Never kill by pattern** (`pkill -f`, `killall`): another agent's suite or run matches the same pattern. Kill only a
process id you started.

## Slots: a limit on heavy jobs, machine-wide

`scripts/slots.ts` is a pool of tokens shared by every checkout and worktree of the user: files in `~/.oikos/slots`
(`OIKOS_SLOTS_DIR`), as many as the cores less two (`OIKOS_SLOTS=N`; `OIKOS_SLOTS=off` turns it off). What takes them:

| job | tokens |
|---|---|
| the test runner (`scripts/test.ts`) | one for each test file running; half the cores for the kernel's tests |
| `bun test <file>` by hand, from the repo's root | one for the process (`scripts/slots-preload.ts`, in `bunfig.toml`) |
| `oikos run` | one for each run under way (`--parallel P`: up to P, fewer while the machine is busy). A run that asks a model takes none: it waits for answers, not for a core |
| `bun run kernel` | half the cores |
| anything else heavy | `bun scripts/slots.ts [--weight K] -- <command...>` (K a whole number of tokens, or `half`; anything else is refused at once, with the weights there are) |

- `bun scripts/slots.ts status` lists who holds tokens (pid, how long, what, where) and who waits.
- A job that waits says so once a minute (`slots: waiting 61 s so far for 1 of 12 ...`). Waiting costs time and nothing
  else: a run's state hash is the same with and without (checked on a 30-day run of 1,000 people).
- A holder that dies leaves its tokens behind; the next taker sees its pid is dead and reclaims them.
- A process started inside a slot takes nothing more (it is marked by `OIKOS_SLOT_HELD` in its environment, and known
  by its ancestry where that is lost), so nothing waits on its own parent.
- Not covered: `oikos run-one` and `oikos resume` run directly, `cargo` run directly, the translator's training. Wrap
  them (`bun scripts/slots.ts -- ...`) when they are heavy. The test runner also follows the load average, so work
  outside the slots still slows a suite down rather than piling on top of it.

## Warm worktrees

`bun scripts/worktree-warm.ts <worktree-path>` makes a fresh worktree ready: it clones `node_modules`,
`docs/research/cel-check/node_modules` and `kernel/target` from the checkout whose HEAD is nearest and that has them
(copy-on-write on APFS: no time, and no disk until a file changes), then runs `bun install` and `bun run kernel`, which
redo whatever differs. The clone only saves work: cargo builds the kernel's own crates from the worktree's sources
whatever was cloned (a workspace crate's build is keyed by its path), and what is reused is the compiled dependencies.
`scripts/pilot-wave.ts` does this for a wave's pinned copy. `scripts/worktree-clean.ts` removes worktrees that are
merged and idle.

## The compile cache

`sccache` is cargo's `rustc-wrapper` for the whole user (`~/.cargo/config.toml`, with `CARGO_INCREMENTAL=0`: the cache
cannot store incremental builds). A build in any worktree reuses dependencies compiled in any other (132 of 166
cacheable compilations on a from-empty kernel build; the kernel's own crates and the binary are never shared).
`scripts/setup-mini.sh` installs and configures it. `sccache --show-stats` says what it is doing.

## A check run: the measures of a town, cheaply

For "does the town still behave" rather than a result to keep:

```
oikos run worlds/town-300.yaml --until 7776000 --log lean --record-observations none --out /tmp/check-1
```

- `--log lean` keeps what the measures read and leaves out the rest of the log; `--record-observations none` records
  no participant's observations. Neither changes the run (same state hash).
- `worlds/town-300.yaml` is the small town one and a half times over. Use it, or `worlds/town.yaml` (200 people), when
  the size is not the point; `worlds/town-1000.yaml` when it is. Ninety days, lean, on a quiet machine: 9 s and 0.7 GB
  for 200 people, 13 s and 0.8 GB for 300, 44 s and 1.8 GB for 1,000.
- `--no-measure` when only the state hash or the summary is wanted; `--set k=v` to vary the spec.
- `--seeds N` is **one town run N times**; `--towns T` is **T different towns** (each run `--seeds` times, once if not
  given). A before and after that is to say anything of towns in general is `--towns 3` on each side; `oikos diff` says
  on its first line what each side was (docs/measurement.md, "Running a batch").
- Write to a folder outside `runs/` that you remove yourself; never remove anything under `runs/`.

## Merging a branch: `scripts/merge.ts`

```
bun scripts/merge.ts <branch> [--message "..."] [--no-push]
```

What the maintainer does by hand, in a clean worktree of its own (`.claude/worktrees/merge-bot`, made if missing; never
`merge-main`): fetch; reset to `origin/main`; `git merge --no-ff <branch>`; then the worktree warm-up
(`scripts/worktree-warm.ts`: installs, including cel-check, and `bun run kernel`), `bun run typecheck`, `cargo test` for the kernel, and `bun run test:all` (output in `merge-bot/merge-test.log`); restores
`scripts/test-times.json`; pushes to `origin main` only if all passed; prints tests passed, time and the pushed sha.

- **Conflicts:** only `docs/decisions.md` and `docs/research/references.md` are resolved (both sides kept, markers
  stripped, the tree checked for any left). A conflict anywhere else aborts the merge and says which files.
- **Flakes:** if the suite fails with exactly one failed test file and it is `scripts/slots.test.ts` or
  `orchestrator/test/pilot-wave.test.ts` (timing under load), that file is rerun alone and accepted only if it passes.
  Any other failure (a different file, two files, the kernel) stops it, with no push.
- The merge commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `--no-push` does everything but the push: the merge stays in the merge-bot worktree for inspection.
- It waits for slots like any heavy job, so on a busy machine it is slow; run it once per merge (the rule above).
- Pure parts (keep-both, marker check, failure reading) are tested in `scripts/merge.test.ts`.
- `.github/workflows/ci.yml` also runs the suite on every push and pull request, on a self-hosted runner: `docs/ci-runner.md`.
