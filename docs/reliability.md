# When a run goes wrong (D59)

A run never hangs silently or carries on against something broken. What happens depends on the kind of failure, because **results must never depend on wall-clock timing**:
- **Deterministic failures** are recovered in place. They happen the same way every time, so the run can go on and still replay exactly.
- **Timing failures** stop the run cleanly, with a diagnosis. Recovering from them in place would make outcomes depend on how fast the machine was. You fix the cause and **resume**.

| What goes wrong | Kind | What happens |
|---|---|---|
| A behaviour module throws | Deterministic | Logged as a `participant_error` note (the error's name and message, and how many in a row); the participant waits this wake; the run goes on. After **3 in a row** it's retired (`participant_retired`): its stand-in carries on if the world names one (`on_opt_out`), otherwise it stops acting. The run summary counts them. |
| A model call fails after its retries (every call has a time limit, 180 s by default, and retries with backoff) | Deterministic once logged | `ModelCallFailed`: the call is logged as a `model_call_failed` annotation (what was sent, and the error), and the seat misses that sitting (a `participant_error` note, and its own `sitting_missed`): it sits again at its next working day's sitting (a day on, with no office hours), whatever it had last arranged, and is told there that it missed one and nothing was done; the queue alerts, and the pilot report says in its first line that the pilot is not a finished one. A translator call that fails becomes "That couldn't be drafted just now." A debrief the model could not give (no answer after its retries, or a provider's limit) stops the run at its end to be resumed, and the resumed run asks it again; one is skipped (`debrief_skipped`) only when the run's own spending limit is gone. A resumed run is served the failure as the same failure. |
| The model can't be reached (3 calls in a row fail, with none answered between), or a provider's usage limit is reached | Timing | The run stops there, saying so, its log closed ("aborted"), to be resumed. Nobody is retired, and nobody is debriefed (`debriefs_deferred`): for those in it the run isn't over. |
| The run is asked to stop (`scripts/mini stop`, a TERM signal, Ctrl-C) | Timing | It stops before its next moment and closes its log, as above. A batch passes the request on to its runs and starts no more. If a model call is still out after `OIKOS_STOP_GRACE_SECONDS` (120), the process ends as it is: the log resumes all the same. |
| Participants wake each other without end at one moment | Deterministic | `RunStuck` after 1,000 rounds of wakes at one moment: the run stops with a diagnosis. |
| Nothing makes progress (a module stuck in a loop, a kernel that stalls, a call that never returns despite its limit) | Timing | A watchdog thread sees the run's breadcrumbs stop. A model call in flight keeps them moving every 10 s for up to 20 minutes, beyond every adapter's own limits, so a slow but healthy call isn't taken for a stall. After `OIKOS_STALL_SECONDS` (default 300), it writes `<run>.failure.json` beside the log, saying what the run was doing, for whom, and when, and ends the process. Time the machine spends asleep doesn't count: a gap between the watchdog's ticks far longer than a tick means everything was frozen, the run included, so a laptop closed overnight pauses a run rather than failing it. |
| The kernel process dies | Timing | `KernelDied` at once, with its exit code, never mistaken for an off-contract request. `<run>.failure.json` says so. |
| One seed of a batch fails | Either | The other seeds finish and are measured. The CLI lists the failed seeds with their diagnoses, and exits 1. |
| The spending limit is reached | By design | The run stops, says why, and debriefs from the 5% kept back. It can be resumed with a higher limit. |

**A run that stopped is never shown as one that finished.** `oikos run` prints `seed N: STOPPED at ... not finished: <why>` and, under it, the exact command that resumes it; the run's summary and `batch.json` carry how it ended (`end`) and why it stopped (`stopped`). It's measured as far as it got, and its log is left plain. (The command still exits 0 if the only trouble was runs that stopped: 1 is for runs that failed, or a batch that couldn't be measured or compressed, which `batch.json` records under `problems`.)

## Logs are never overwritten

A model's answers can't be made again. So a fresh run refuses to start where its log already is: `oikos run` and `run-one` stop with the log's name ("choose another --out, or resume it") if the folder holds that run's log, plain or compressed, or one a resume left behind; a batch checks every run, and the folder's `measure/`, before it starts any. `--overwrite` replaces a run, for tests' own folders; it's never the default, and it never replaces a log in which any model call came from a real provider (anything but the mock), nor anything in a folder that holds one.

## Signs of trouble that don't stop a run

A run that finishes can still have gone wrong quietly. This session found two such bugs: steps a wake didn't get to were dropped, and the bank dropped payments at busy moments; nothing said so. Each run's summary has a `health` section, and `oikos run` prints a `!` line under a seed for anything worth a look (`healthWarnings`, orchestrator/src/batch.ts):
- **Someone falling behind:** an act that waited more than a day for its actor to be free (acts take time: docs/design/rebuild.md 6.3). The summary's `backlog` has each module's acts, total and longest wait.
- **A retry loop:** the same act by the same unit more than 24 times in a day (`repeats`): something tried again at every wake instead of by time. (Acting time exposed several, 2026-09-30.)
- **Refusals other than the expected races** (someone who just left, or moving in where the last tenants are still leaving: D58). Anything else means a participant acted on something that wasn't so.
- **Participants' errors,** recovered in place (above).

`batch.json` keeps each run's health and warnings. For the batch as a whole:
- **`oikos health <DIR>`:** the batch's measures against its profile's calibration targets, each within a stated tolerance, breaches first, and the demand households went without.
- **`oikos diff <BASELINE> <CHANGE>`:** every measure of two batches of the same world, judged against the noise between each side's runs; it says first how many runs of how many towns each side is (runs of one town, `--seeds`, are not towns: `--towns`). Run it before and after any change to behaviour.

## Resuming a run

```bash
oikos resume runs/codex/pilot7/town.seed1.jsonl --model codex/gpt-6-sol --translator-model codex/gpt-6-luna --budget 5
```

A compressed log (`.jsonl.zst`) can be named too: it's written out plain first, and kept. So can the folder, if just one run in it stopped short (no summary, or a summary that says it stopped). On the run server: `scripts/mini resume <name> [run id] [--model ...]`.

This runs the world again from the log's own config: not the world file, which may have changed since. Every model call is served its recorded response, in order, checked against the recording (the same system prompt and the same last message).
- **Up to where it stopped,** the resumed run reproduces the old one exactly and makes **no new model calls**. From there it goes on with the live model.
- **A call that failed is served as the same failure** (the log's `model_call_failed` annotation), so the participant waits the same wake again and the run takes the same path. The exception is the round the run stopped in: its stop note counts the calls that failed there (`failed_calls_to_ask_again`), and those are asked again, or a run stopped because the model couldn't be reached would stop at the same place.
- **If the code changed in between** and a request differs from its recording, serving stops there and every later call is live. The log's closing `resumed_from` note says how many calls were served, and where serving stopped if it did.
- **The old files are kept** as `<run>.stopped-<n>.*`. They're history: `corpus`, `dataset`, `measure` and `cost` on a folder take each run once, its current log, and read a stopped log only when it's named (its answers are in the resumed log too).

## Your own modules

`--modules FILE` (for `run` and `resume`) loads behaviour modules from a file exporting `modules: { [name]: BehaviourModule }`, which worlds then name in a controller's `impl`. The reliability tests use it for modules that hang or throw on purpose (`orchestrator/test/fixtures/faulty-modules.ts`).

## Draws and the order papers were filed in (2026-10-12)

A participant's random stream is keyed on the seed, the participant, the capacity it acts in, the hour, and a purpose it names. A record made in a run is numbered in the order every record of the town was made, so a purpose that names a record's number makes the draw depend on how many papers anyone had filed before. One more paper from a seat then changes draws all over the town, and a pilot parts from its twin by nothing its steward did.

- The run (`stablePurpose`, `orchestrator/src/run.ts`) writes a record's number in a purpose as "the nth such paper this participant has drawn on for this purpose". Nothing in a module needs to know.
- Where it matters most a module names the draw for who and what (`Occurrences`, `participants/src/behaviour/common.ts`): who asked, the matter, the lease or building, and which time that is for the pair.
- **When writing a draw:** name it for the entity deciding, who or what it is about, the kind of thing, and its occurrence; never for an id the world handed out in filing order. A draw named for the moment (`${t}`) holds only while that moment is the same in both towns.
- `orchestrator/test/twin-draws.test.ts` holds it: a town with an office filing two papers of no effect a day is, apart from those papers, the same town to the word.
- **Not covered:** a seat's acts land at other moments than its code twin's, and draws people make are named for the moment. Two towns that truly differ go on to differ by chance. Compare a pilot with its twin in totals against the spread between runs, and case by case only among those the seats did not deal with, in runs made at or after this change.

### The world's prices, and what is still named for the moment (2026-10-12)

A participant's own stream (`ctx.rng`) is keyed on the hour it draws in. That is right for a draw that is about the moment and wrong for one that is not. Two kinds were moved off it, onto the run's stream that has no hour in it (`ctx.chance`), each named for what it is about:

- **A month's world price** (`world.trade` 0.2.1): for the good and the month. It had been drawn on the outside market's own stream, so anything that moved that office's first look of a month gave the town another year of prices. Twelve runs of one town before and after an unrelated change had inputs 16% and 21% dearer in the "same" run, and whether its factories failed turned on that (docs/decisions.md, 2026-10-12, "What the fifth living pilot found", item 8). `orchestrator/test/twin-draws.test.ts` holds that a town and its twin with an office in a mock seat see the same world prices month by month over a year.
- **A tenant's draws about a tenancy** (citizen 0.53.0): whether they stay past a notice, obey an order, answer an application, and what of their answer they tell; each for the person and the lease (and which application on it).

**Still named for the moment** (through `ctx.rng`, so the same in a town and its twin only while that participant draws in the same hour): every other draw of a person (which shop, whom to ask, a job taken or left, a child conceived, a claim made, signing, voting, standing, taking goods, founding, word passed on); every draw of an office or a firm (a wrong refusal, a bill that errs, pay that comes short, a repair, hiring, a landlord's choice among applicants, a venue's finding where the record cannot settle it, which is named for the case but drawn in its hour); migration into the town (`come-` and `households-`, named for the very tick); deaths and illness, births' sex and weather are the kernel's own and are not participants' draws. Moving any of these is a change to every run's state; each should be moved when a comparison turns on it, as these two did.

## Limits (as of 2026-09-28)

- **A hang stops the whole run**, not only the module that hung. That's consistent with the split: a hang is a timing failure. Isolating each module in its own thread, so one could be stopped alone, isn't built.
- **The watchdog runs for runs started by the CLI** (`run`, `run-one`, `resume`). A program calling `runWorld` directly passes its own `watchdog`, or has none.
- **Resume re-runs from the start** (about 100 seconds a simulated year for the 1,000-person town). Checkpoints, which would need every module's state saved, wait until runs are long enough to need them (docs/decisions.md).
- **Logs from before contracts v0.5** (the pilots of 2026-09-28) can't be resumed: the v0.5 kernel won't load their config.
- **Logs from contracts 0.5** (before 2026-09-29's typed commitments) replay and resume with a 0.5 kernel (kernel 0.5.x, before 0.6.0): the 0.6 kernel won't load their config.
- **Resume is tested with the mock model** (including a log cut off mid-line, a failed call, and a run stopped with the model out of reach), not yet against a real one.
- **A program that calls `runWorld` itself** isn't kept from writing over a log: the refusal is in `run`, `run-one` and the batch.
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

**Log size.** A 5-year run of the 1,000-person town wrote about 2.5 GB. Two flags, for `oikos run`:
- **`--log lean`** keeps what replay needs and leaves out the rest: no observation hashes (a replay then checks the state through the chain and the checkpoints, not each observation), and no written reasoning from code participants (a model's is always kept). About 30% smaller, and a little faster. The world's config says so (`log.detail`), so a lean log replays as lean. For quick test runs; **full (the default) when the data matters**, and always for model runs.
- **Compressed by default** (`--no-compress` to keep plain; before, `--compress` asked for it): each log is compressed once the batch is measured (`<run>.jsonl.zst`, zstd): about a seventh the size, checked to read back the same (by hash) and to be on the disk before the plain log goes. A run that stopped to be resumed is left plain. Measurement, `dataset`, `corpus`, `story` and `replay` all read compressed logs. **Needs Bun 1.4 or later:** Bun 1.3's zstd stream stalled after 64 MB, so reading back a 5-year run's log (2.3 GB, 326 MB compressed) hung at 0% CPU, and so would any reader of it; 1.4.2 reads it back in about 4 seconds. A test reads back a compressed log over 100 MB line by line.
- **`--keep measures`** (for test runs): once measured, a run keeps its measurement tables, its summary and a recipe (`<run>.recipe.json`: the `run-one` command, the commit, the kernel's version, the final state hash), not its log. Running the command at the commit regenerates the log exactly, and the hash says so. About 150 MB for three 5-year runs' tables together, against 1 GB of compressed logs. Refused (the log is kept, and it says why) for a run with a language-model participant (a model's answers can't be regenerated, and they're training data), with uncommitted changes, or with modules from outside the repository.
- **A more compact log** (dropping what replay regenerates) is proposed in docs/design/compact-logs.md: it changes the log contract.

## Soak runs (2026-10-01)

A soak is a batch run to find trouble: many seeds over several years, read for the signs above (`oikos run ...`
prints them per run).

**The first soak** was 10 seeds of the 1,000-person town over three years each (commit fb0f115), five at a time on a
busy machine:
- every run finished, at about 2,700–3,800 seconds for three years;
- refusals 15–179 a run, all of the expected kinds;
- one warning: a factory posting a job 27 times in a day. Not a loop. It had lost all 40 of its staff by day 66 and
  was rehiring, at about one hire per posting. The repeat heuristic (24 a day) can't tell a hiring burst from a retry
  loop.

Losing a whole workforce in a day is an outcome worth a look in calibration, not a reliability fault.

**Next:** soaks as a regular check, after any change to physics or to a module many seats run.

**Invariance, a residual (2026-10-01).** Woken 50% more often, the small town delivers about 3% fewer goods to
households over 90 days, with or without nature, across three perturbation seeds (one alone moved it 10%, on its draws).
That's inside the test's 10%, but it's consistent, so something still counts a little per wake: to look at.
