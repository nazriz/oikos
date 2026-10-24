# The development machine

One Mac is shared by many agents and people, each in a git worktree of its own. Left alone, each of them builds the
kernel, runs towns and runs the whole test suite at once, and the machine spends hours at a load several times its
cores: tests fail by timeout and a ten-minute suite takes an hour. Four things keep that from happening. The reasoning
and the measurements are in docs/decisions.md ("A shared machine that stays usable", 2026-10-08).

## The rule

**The merge gate, not the whole suite.** The suite is in two tiers (`scripts/test-tiers.json`, "Tiers" below). Work on a
branch runs `bun run test:changed`, which is the merge gate itself (`bun scripts/test.ts --gate`): about a minute and a half
at most on this machine, seconds for a document. `scripts/merge.ts` runs the same gate, and only it merges to main. CI
runs both tiers whole on every push to main and nightly, so every assertion runs on every push. Or run `bun scripts/test.ts <filter>...` for the tests you know cover the change; `bun run test:slow` for the slow tier.

**Never kill by pattern** (`pkill -f`, `killall`): another agent's suite or run matches the same pattern. Kill only a
process id you started.

## Slots: a limit on heavy jobs, machine-wide

`scripts/slots.ts` is a pool of tokens shared by every checkout and worktree of the user: files in `~/.oikos/slots`
(`OIKOS_SLOTS_DIR`), as many as the cores less two (`OIKOS_SLOTS=N`; `OIKOS_SLOTS=off` turns it off). What takes them:

| job | tokens |
|---|---|
| the test runner (`scripts/test.ts`) | one for each test file running (borrowed: see the cap); four for the kernel's tests |
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

## Disk tidy

`bun scripts/disk-tidy.ts` (dry run: prints what it would remove and why; `--apply` deletes; `--inventory FILE` writes the
table of every run and worktree). The rule that matters most: a run with any evidence of model calls (a cost.json that
records a real model, `claude-code/`, `codex/`, `*.calls.*`, debriefs, PILOT.txt, a batch that seats a model with no
mock-only cost.json beside it, a pilot's or translator's name) is training data and is never deleted or altered; when
unsure it is a model run. Only code-only runs older than 3 days are touched: `test-*` scratch whole; unreferenced ones
whole; ones with a STATUS or a mention in `docs/`, or holding a `*.dataset`, lose only their large logs (`*.jsonl`,
`*.jsonl.zst` of 50 MB or more; anchors, summaries, `measure/`, STATUS and datasets stay). Worktrees follow
`worktree-clean.ts` plus a protected list (merge-main, the running agents' trees, wave copies, anything made in the last
day); an old agent lock is lifted only with `--unlock-pid PID` for that pid. It also sweeps `/private/tmp` of `oikos-*`,
`forms-trained*` and `sz-*` folders older than a day. Tests no longer leave those: `scripts/tmp-preload.ts` (in
`bunfig.toml`) points TMPDIR at one folder per test process and a reaper removes it when the process ends, killed or not.
Not touched: caches in the home folder (huggingface models) and `/private/tmp/claude-*`.
## Tiers (2026-10-24)

- **The gate tier** is every test file not named in `scripts/test-tiers.json`. `bun scripts/test.ts --gate [--base REF]`
  (`test:changed`, and the merge's) chooses from it only: for a change to the kernel, the contracts, the manifests or
  the runner (`FULL_ON`), all of it, with the kernel's own tests of the crates the change reaches (from `cargo
  metadata`: each changed crate and every crate above it); for documents only, the tests that read documents; for
  anything else, the fast tier (under 10 s), the tests that reach the change, and always the backstops (`BACKSTOPS`:
  generality, no-god-view, contracts, `invariants-gate`, all-work-takes-time, risks, unstated-run, tiers). `--list`
  prints the choice.
- **The slow tier** is named file by file in `scripts/test-tiers.json`, each with why: towns of a year or more, several
  seeds, the 1,000-person town, anything over about 30 s. `bun scripts/test.ts --tier slow`. CI runs it on every push
  to main and nightly. The year of invariants on several seeds is here (`invariants.test.ts`); the gate has its own
  check of every invariant on 90 days of each main profile (`invariants-gate.test.ts`).
- Every run of `scripts/test.ts` leaves a record in `~/.oikos/test-runs/` (`OIKOS_TEST_RUNS`; the last 200): when, the
  checkout and commit, the mode (gate, tier, all, filtered), and each file's wall seconds, pass or fail and test count.
  `OIKOS_RUN_TRACE=<file>` adds a line per town run (test file, a hash of its options, seconds): it showed the slow tier
  repeats only 1 to 3% of its run time, so no cache of runs was built (docs/decisions.md).
- `scripts/tiers.test.ts` (a backstop) holds that every test file is in exactly one tier, that the slow tier's files
  exist and say why, that every gate file took at most 90 s (by `test-times.json`), and that CI runs both tiers.
- **The kernel in the gate.** Where the release build is current, the gate uses it. Where it is not (a kernel change, or a
  checkout last built at another commit), it builds the `gate` profile (`kernel/Cargo.toml`: release's optimisation and
  overflow checks, no fat LTO, 16 codegen units, incremental): 11 s after a one-file change where the release build
  takes minutes; the tests are pointed at it by `OIKOS_KERNEL`, `OIKOS_ENGINE_MODULE` and `OIKOS_LAW_MODULE`. The
  kernel's tests run in the same profile, under `cargo-nextest` (test programs side by side: 28 s for the workspace,
  against 87 s for `cargo test` in the same profile and half an hour for `cargo test --release`), then its doc tests.
  CI builds and runs on the release kernel.

## Coordination

- **One merge at a time.** `scripts/merge.ts` takes the merge lock (`scripts/merge-lock.ts`: `~/.oikos/merge/lock`,
  `OIKOS_MERGE_DIR`); a second merge waits in line and says so once a minute. **Only it pushes to main:** the pre-push
  hook (`scripts/hooks/pre-push`, put in the repository's shared hooks folder by merge.ts and `scripts/setup-mini.sh`;
  `bun scripts/merge-lock.ts install-hook`) refuses a push to main unless the pusher holds the lock.
- **A cap per agent.** No checkout (a worktree; `OIKOS_SLOT_OWNER` names another) holds more than a quarter of the slots
  (`OIKOS_SLOT_CAP=N` or `none`): a job asking more gets the cap. The cap is held by tokens of the checkout's own, so two
  jobs starting at once cannot both slip under it. Past it: the merge (priority high), and a job that borrows (the test
  runner's tokens and `bun test` by hand, held a test file each), only while no other checkout waits; once one waits, the
  borrower takes nothing more until it is back under its cap, and gets back what it lent as its files end.
- **`bun scripts/status.ts`**: one screen. Who is working (worktrees with a running process: branch, last commit and its
  age, processes, slots held), the merge lock and queue, the slots, the disk, CI's last results on main.
- **Disk:** `scripts/disk-tidy.ts` also removes `.claude/target-*` build folders nothing was built in for a day
  (`--target-hours`) and that no running process uses (no file open in one, no working folder there, no command line or
  environment naming it).

## Merging a branch: `scripts/merge.ts`

```
bun scripts/merge.ts <branch>... [--message "..."] [--no-push] [--full] [--fix-main]
```

It takes the merge lock, then in its own clean worktree (`.claude/worktrees/merge-bot`, made if missing; never
`merge-main`): fetch; reset to `origin/main`; `git merge --no-ff` each branch in order; the worktree warm-up
(`scripts/worktree-warm.ts --no-build`, installs); the typecheck alongside **the gate** (`bun scripts/test.ts --gate`, output
in `merge-bot/merge-test.log`); restores `scripts/test-times.json`; pushes to `origin main` only if all passed. `--full` runs
the whole suite on the release kernel instead. Everything it starts has slot priority (`OIKOS_SLOT_PRIORITY=high`): it
stands ahead of every waiting job and is not capped.

- **Batch:** `merge.ts a b c` merges the branches in order, tests once, pushes all or none; if that fails it bisects on
  prefixes (`settle`: the shortest failing prefix ends in the branch at fault, which is left out), pushes the rest, and
  exits 1 naming what it left out.
- **Red main:** CI's last step writes its result to `~/.oikos/main-ci.json` (`scripts/main-status.ts`; `gh run list` is asked
  first when it works); while the latest result is a failure on a commit in origin/main, `merge.ts` refuses everything but
  `--fix-main`.
- **Conflicts:** only `docs/decisions.md` and `docs/research/references.md` are resolved (both sides kept, markers
  stripped, the tree checked for any left). A conflict anywhere else leaves that branch out and says which files.
- **Flakes:** if the gate fails with exactly one failed test file and it is `scripts/slots.test.ts` or
  `orchestrator/test/pilot-wave.test.ts` (timing under load), that file is rerun alone and accepted only if it passes.
- The merge commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `--no-push` does
  everything but the push. Pure parts are tested in `scripts/merge.test.ts`, the lock and hook in `scripts/merge-lock.test.ts`.
- `.github/workflows/ci.yml` runs both tiers on every push to main and nightly on the self-hosted runner (`docs/ci-runner.md`);
  no pull-request trigger, since the repository is public and the runner is this machine.
## Time-saving (2026-10-17)

(History: the tiers above replaced the choice below, 2026-10-24. `--affected` is now `--gate`, and chooses within the gate tier.)


- **`bun scripts/test.ts --affected [--base REF] [--list]`** is the merge's selection (`--list` prints the choice and stops). The whole suite when
  the change touches `kernel/`, the contracts (not their notes), `package.json`, `bun.lock`, `bunfig.toml`, a tsconfig, the runner or the
  slots; documents only: the tests that read documents (`docs/` in them or their imports) and the backstops; anything else: the fast tier, the
  tests changed, importing a changed file, naming a changed data file or its folder, or naming a script (`cli.ts`) that imports one, and the
  backstops (generality, no-god-view, contracts) always. Over-choosing is the safe way to be wrong: it only costs time. Proved in
  `scripts/test-runner.test.ts` (a planted kernel change chooses everything). The whole suite, `bun run test:all`, is for a schedule.
- The kernel's cargo tests now run alongside the test files (before, a suite sat idle until it had seven tokens), with four tokens.
  `bun run kernel` takes four tokens, not half the cores: 41 s against 35 s cold at 7 jobs, and a queue of minutes shorter.
