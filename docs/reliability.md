# When a run goes wrong (D59)

A run never hangs silently or carries on against something broken. What happens depends on the kind of failure, because **results must never depend on wall-clock timing**:
- **Deterministic failures** are recovered in place. They happen the same way every time, so the run can go on and still replay exactly.
- **Timing failures** stop the run cleanly, with a diagnosis. Recovering from them in place would make outcomes depend on how fast the machine was. You fix the cause and **resume**.

| What goes wrong | Kind | What happens |
|---|---|---|
| A behaviour module throws | Deterministic | Logged as a `participant_error` note (the error's name and message, and how many in a row); the participant waits this wake; the run goes on. After **3 in a row** it's retired (`participant_retired`): its stand-in carries on if the world names one (`on_opt_out`), otherwise it stops acting. The run summary counts them. |
| A model call fails after its retries (every call has a time limit, 180 s by default, and retries with backoff) | Deterministic once logged | `ModelCallFailed`: the participant waits this wake (a `participant_error` note). A translator call that fails becomes "That couldn't be drafted just now." A debrief that fails is skipped (`debrief_skipped`). |
| Participants wake each other without end at one moment | Deterministic | `RunStuck` after 1,000 rounds of wakes at one moment: the run stops with a diagnosis. |
| Nothing makes progress (a module stuck in a loop, a kernel that stalls, a call that never returns despite its limit) | Timing | A watchdog thread sees the run's breadcrumbs stop. A model call in flight keeps them moving every 10 s for up to 20 minutes, beyond every adapter's own limits, so a slow but healthy call isn't taken for a stall. After `TERRARIUM_STALL_SECONDS` (default 300), it writes `<run>.failure.json` beside the log, saying what the run was doing, for whom, and when, and ends the process. Time the machine spends asleep doesn't count: a gap between the watchdog's ticks far longer than a tick means everything was frozen, the run included, so a laptop closed overnight pauses a run rather than failing it. |
| The kernel process dies | Timing | `KernelDied` at once, with its exit code, never mistaken for an off-contract request. `<run>.failure.json` says so. |
| One seed of a batch fails | Either | The other seeds finish and are measured. The CLI lists the failed seeds with their diagnoses, and exits 1. |
| The spending limit is reached | By design | The run stops, says why, and debriefs from the 5% kept back. |

## Signs of trouble that don't stop a run

A run that finishes can still have gone wrong quietly. This session found two such bugs: steps a wake didn't get to were dropped, and the bank dropped payments at busy moments; nothing said so. Each run's summary has a `health` section, and `terrarium run` prints a `!` line under a seed for anything worth a look (`healthWarnings`, orchestrator/src/batch.ts):
- **A module out of actions with more to do** in more than 1% of its steps. What a wake didn't get to carries over, so nothing is lost, but it may be falling behind: planning more than a wake allows (12 actions, `orchestration.max_actions_per_wake`), with a backlog that grows.
- **Refusals other than the expected races** (someone who just left, or moving in where the last tenants are still leaving: D58). Anything else means a participant acted on something that wasn't so.
- **Participants' errors,** recovered in place (above).

`batch.json` keeps each run's health and warnings.

## Resuming a run

```bash
terrarium resume runs/codex/pilot7/town.seed1.jsonl --model codex/gpt-6-sol --translator-model codex/gpt-6-luna --budget 5
```

This runs the world again from the log's own config: not the world file, which may have changed since. Every model call is served its recorded response, in order, checked against the recording (the same system prompt and the same last message).
- **Up to where it stopped,** the resumed run reproduces the old one exactly and makes **no new model calls**. From there it goes on with the live model.
- **If the code changed in between** and a request differs from its recording, serving stops there and every later call is live. The log's closing `resumed_from` note says how many calls were served, and where serving stopped if it did.
- **The old files are kept** as `<run>.stopped-<n>.*`.

## Your own modules

`--modules FILE` (for `run` and `resume`) loads behaviour modules from a file exporting `modules: { [name]: BehaviourModule }`, which worlds then name in a controller's `impl`. The reliability tests use it for modules that hang or throw on purpose (`orchestrator/test/fixtures/faulty-modules.ts`).

## Limits (as of 2026-09-28)

- **A hang stops the whole run**, not only the module that hung. That's consistent with the split: a hang is a timing failure. Isolating each module in its own thread, so one could be stopped alone, isn't built.
- **The watchdog runs for runs started by the CLI** (`run`, `run-one`, `resume`). A program calling `runWorld` directly passes its own `watchdog`, or has none.
- **Resume re-runs from the start.** For a two-year town that takes seconds. For very long runs (centuries), resuming from a kernel checkpoint would be needed, restoring the kernel's state and every module's. Not built yet.
- **Logs from before contracts v0.5** (the pilots of 2026-09-28) can't be resumed: the v0.5 kernel won't load their config.
- **Logs from contracts 0.5** (before 2026-09-29's typed commitments) replay and resume with a 0.5 kernel (kernel 0.5.x, before 0.6.0): the 0.6 kernel won't load their config.
- **Resume is tested with the mock model** (including a log cut off mid-line), not yet against a real one.
- **Resource growth over very long runs** (log size, memory) isn't addressed yet.

## Speed and log size (2026-09-29)

Where a run's time goes: each run's `<run>.summary.json` has a `profile`: each behaviour module's deciding time and steps, and each kind of kernel command's time and count.

**What was slow, and what changed** (the 1,000-person town, 540 days, one seed):

| | Wall | Kernel | Modules |
|---|---|---|---|
| Before | 260 s | 123 s | 113 s |
| Modules stop rescanning history | 180 s | 123 s | 34 s |
| A round's looks sent together | 154 s | 98 s | 33 s |
| A lean log | 147 s | 88 s | 33 s |

- **Modules rescanned their whole history on every decision,** so a run got slower as it went: a 5-year run took 46 minutes against 1 for 180 days. The bank reread every payment instruction ever made (3.6 ms a step by day 540); a shop reread every order it had ever had. `Book` now keeps each kind's standing statements as they arrive, and indexes records by type; order books, delivery notes and the bank read only what's new since last time. The same world comes out: the same commands, the same final state.
- **The kernel's state grew for ever** (kernel 0.5.1). Every transfer was queued for every participant acting for an entity concerned, to be delivered through an accounts channel; a participant without one (the outside world's valuer and landfill, the town's councillors...) never took its queue, so it grew with every transaction the town or the outside world made, and the whole state with it. Each act runs on a copy of the state (to throw away if it's refused), so every act got slower. Transactions are now queued only for those with an accounts channel. And the schedule of future effects (birthdays, births, conditions) was a list copied whole on every act; it's a persistent map now, written out as the same list.
- **A day's work isn't carried to the next day.** What a wake didn't get to carries over (above), but a step with work in it spent that day's hours; when the day's over it's dropped, and its module hears it wasn't done (as if refused), so a shop puts the order back in its queue.
- **The kernel mostly waited on the orchestrator,** one request at a time over the pipe. Everyone's looks in a round (nothing acts in between) are now sent together and their replies read in order: the kernel takes its requests strictly in turn, so the log is the same.

**Log size.** A 5-year run of the 1,000-person town wrote about 2.5 GB. Two flags, for `terrarium run`:
- **`--log lean`** keeps what replay needs and leaves out the rest: no observation hashes (a replay then checks the state through the chain and the checkpoints, not each observation), and no written reasoning from code participants (a model's is always kept). About 30% smaller, and a little faster. The world's config says so (`log.detail`), so a lean log replays as lean. For quick test runs; **full (the default) when the data matters**, and always for model runs.
- **Compressed by default** (`--no-compress` to keep plain; before, `--compress` asked for it): each log is compressed once the batch is measured (`<run>.jsonl.zst`, zstd): about a seventh the size, checked to read back whole before the plain log goes. Measurement, `dataset`, `corpus`, `story` and `replay` all read compressed logs. **Needs Bun 1.4 or later:** Bun 1.3's zstd stream stalled after 64 MB, so reading back a 5-year run's log (2.3 GB, 326 MB compressed) hung at 0% CPU, and so would any reader of it; 1.4.2 reads it back in about 4 seconds. A test reads back a compressed log over 100 MB line by line.
- **`--keep measures`** (for test runs): once measured, a run keeps its measurement tables, its summary and a recipe (`<run>.recipe.json`: the `run-one` command, the commit, the kernel's version, the final state hash), not its log. Running the command at the commit regenerates the log exactly, and the hash says so. About 150 MB for three 5-year runs' tables together, against 1 GB of compressed logs. Refused (the log is kept, and it says why) for a run with a language-model participant (a model's answers can't be regenerated, and they're training data), with uncommitted changes, or with modules from outside the repository.
- **A more compact log** (dropping what replay regenerates) is proposed in docs/design/compact-logs.md: it changes the log contract.
