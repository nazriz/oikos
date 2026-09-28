# When a run goes wrong (D59)

A run never hangs silently or carries on against something broken. What happens depends on the kind of failure, because **results must never depend on wall-clock timing**:
- **Deterministic failures** are recovered in place. They happen the same way every time, so the run can go on and still replay exactly.
- **Timing failures** stop the run cleanly, with a diagnosis. Recovering from them in place would make outcomes depend on how fast the machine was. You fix the cause and **resume**.

| What goes wrong | Kind | What happens |
|---|---|---|
| A behaviour module throws | Deterministic | Logged as a `participant_error` note (the error's name and message); the participant waits this wake; the run goes on. The run summary counts them. |
| A model call fails after its retries (every call has a time limit, 180 s by default, and retries with backoff) | Deterministic once logged | `ModelCallFailed`: the participant waits this wake (a `participant_error` note). A translator call that fails becomes "That couldn't be drafted just now." A debrief that fails is skipped (`debrief_skipped`). |
| Participants wake each other without end at one moment | Deterministic | `RunStuck` after 1,000 rounds of wakes at one moment: the run stops with a diagnosis. |
| Nothing makes progress (a module stuck in a loop, a kernel that stalls, a call that never returns despite its limit) | Timing | A watchdog thread sees the run's breadcrumbs stop. After `TERRARIUM_STALL_SECONDS` (default 300), it writes `<run>.failure.json` beside the log, saying what the run was doing, for whom, and when, and ends the process. |
| The kernel process dies | Timing | `KernelDied` at once, with its exit code, never mistaken for an off-contract request. `<run>.failure.json` says so. |
| One seed of a batch fails | Either | The other seeds finish and are measured. The CLI lists the failed seeds with their diagnoses, and exits 1. |
| The spending limit is reached | By design | The run stops, says why, and debriefs from the 5% kept back. |

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
