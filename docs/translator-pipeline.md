# The translator's training pipeline

One command takes pilots' logs to an exported data folder, and (if asked) to trained, scored models:

```
bun orchestrator/src/cli.ts translator-pipeline <config.json>
```

The code is `orchestrator/src/pipeline.ts`; the instructions it gives writers and readers are `translator/train/in-situ/`
(each with a note of where it came from in `SOURCES.txt`); the GPU step is `translator/model/pod/pod.sh`. Every step was
once run by hand, a shell command at a time, with Claude subagents doing the writing and reading; this is the same steps,
called through the repo's own adapters (`claude-code/…`, `codex/…`), so a run needs nothing but a config file and, for the
GPU step, the RunPod key.

## The steps

For each *lane* (the training pilots; and the test-only pilots, if there are any), in this order. A step whose output is
there and whole is skipped.

1. **Situations** (`oikos in-situ`): every time a model seat was asked what to do, read back from the pilots' logs: the seat's
   prompt as sent, what it was shown, the forms it knew of, and the money of its world (the log's header: its first
   currency), which goes with every request and example made from it, so that amounts are compared, and can be written
   again, as that world writes them; and the seats' own requests that are no test case. The real test
   cases (`translator/eval/pilot-cases.ts`) and every seat-day they come from are marked and never given out.
2. **Select**: which situations each writer gets. One seat-day in `every` (3), one turn of it (a turn where the seat itself
   asked for something, if there is one), spread through the run; at most `situations` in all, shared among the seat model
   families. A seat model with no writer in the config gets none (counted).
3. **Write**: for each seat model family, its writer (a model of that family) is put in the seat and says up to eight
   requests it would make through `do`. The instructions are the hand-run ones: `inSituInstructions()`, then the addendum
   (`writer-addendum.txt`), then any `extraInstructions` (for a round weighted toward things done: `writer-round2.txt`). Several
   situations go in a call up to `writerCallChars` characters (120,000, about 30,000 tokens, as a hand chunk was).
4. **Take in**: the writers' requests, and the seats' own, as requests for readers (`written-unlabelled`, the seats' real ones,
   less what was said before or is in a test case's words), capped by `realRequests` and `writtenRequests` in a seeded order,
   as a blind file (`{id, request, forms}`, shuffled).
5. **Read**: two readers of different models each translate every request, with the translator's current prompt
   (`translatorSystem()`) as the system message and the task of `reader-call.txt` (the hand-run reader task, worded for a
   call). A reader sees the prompt and the blind lines: not the other reader's answers, not the gold, not the request's
   origin. A batch is up to `readerBatch` requests (30). A request left unanswered is asked once more. A reader's answers
   are never made by a script: the instruction says so, and a batch or a whole reader file of implausibly uniform answers
   (more than 40% the same program, under 30% different programs; and, for a whole file, over 90% refusals, or over 95%
   one function in 20 or more) is set aside and the run stops.
6. **Label**: where the two readers' programs differ in `basis` alone, the basis becomes every record either gave, in the
   request's order (ids only); then `oikos in-situ-label`: what they agree on is an example (with spans), the rest is a reject
   with its reason. Agreement by function is in the manifest.
7. **Tests.** A pilot is *test-only* if its `PILOT.txt` (the queue entry's JSON after the note) or `pilot-report.json` says
   `"test": true`, or the config does. Its lane goes through steps 1 to 6 like the other, and its examples are test sets
   (`tests/test-pilots-real.jsonl`, the seats' own requests; `tests/test-pilots-written.jsonl`, written in its situations),
   which never train. Of the training pilots' *real* requests, a third of each kind is held back
   (`tests/held-back-real.jsonl`).
8. **Join**: the standing set (`standing`: a folder with `train.jsonl`, `validation.jsonl`, optionally `validation-real.jsonl`),
   plus the new examples `repeat` times (4). Whole seat-days, one in `validationDays` (10), go to `validation-real` instead,
   kept out of training. Left out: any example, new or standing, whose request is in the words of any test; any standing
   example of a test-only pilot's run.
9. **Export** (`translator/model/export.ts`, arguments by name): the steps the model is trained on, in `data/`.
10. **Train** (`"train": true`): `pod.sh run data NAME:ENCODER:SEED …` rents a GPU, sets it up, sends the trainer and `data/`,
    queues the runs, brings each home as it ends and scores it here (`translator-eval --model decide/NAME --real`; the held-out
    test is read by the eval itself, on this machine, and never leaves it), ends the pod when all are home or at the deadline
    (the watchdog; `deadlineHours`, 6 if absent). With `"train": false` the pipeline stops after the export.

Writers and readers hand their file in through a `hand_in` tool, as a list of objects: the Claude Code adapter cuts a reply of
plain words at 4,000 characters. A reply of words is still read if a model gives one. A program whose every quotation mark came
escaped by hand (a model doing in a tool's JSON what the tool already does) is read as meant (`undoubled`).

## The config

```json
{
  "out": "/Users/clawd/oikos/runs/translator-pipeline-2",
  "pilots": [
    { "path": "/Users/clawd/oikos/runs/pilot-11" },
    { "path": "/Users/clawd/oikos/runs/pilot-12", "test": true }
  ],
  "writers": { "claude-code": "claude-code/claude-sonnet-5-5", "codex": "codex/gpt-6.1-sol" },
  "readers": ["claude-code/claude-haiku-5-5", "codex/gpt-6-luna"],
  "situations": 120,
  "testSituations": 40,
  "realRequests": 300,
  "extraInstructions": ["writer-round2.txt"],
  "standing": "/Users/clawd/oikos/runs/translator-data-in-situ/joined-10",
  "budget": 20,
  "train": true,
  "encoder": "microsoft/deberta-v3-small",
  "seeds": [1, 2]
}
```

`out` is a new folder (an existing one is resumed). `pilots`: folders of logs; `test: true` marks one test-only (the pilot's own
mark cannot be taken away from here). `writers`: the seat's provider (`claude-code`) or its whole model name, to a
`provider/model`; the longest match wins. `readers`: two different `provider/model`s (checked; `gpt-6-astra` is refused
anywhere). `budget`: the spending limit in USD for every model call the run makes (required; a Codex call costs nothing per
call, and its subscription limits apply). Optional: `testSituations` (as `situations`), `requestsPerSituation` (8), `realRequests`,
`writtenRequests` (all), `every` (3), `seed` (1), `repeat` (4), `validationDays` (10), `testsInValidationReal` (false: put the
test lane's examples into validation-real as well, which makes `real_right` in a run's report count them, and so no longer
comparable with earlier runs), `waitMinutes` (20) and `maxWaitHours` (12) for usage limits, `writerCallChars`, `readerBatch`,
`readerBatchChars`, `trainExtra` (flags for `train.py`), `deadlineHours`, `name` (for the runs: `<name>-s<seed>`).

## What is written under `out`

`config.json`, `manifest.json` (below), `pipeline.log`, `calls.jsonl` (the ledger: every call's usage and cost, its prompt and
its answer: model runs are training data and are kept), `lanes/<train|test>/…` (situations, `selected.json`, `written/` and
`read/` with a file for each call, `requests/`, `label/`), `tests/`, `joined/`, `data/` (the export), `models/` (runs home from
the pod, with `eval.json`), `pod/` (the batch's pod state).

The manifest has: the sources (test-only or not, and why; their logs; the seat models), commits (this repo, dirty or not; each
pilot's `commit.txt`), the translator prompt's version, the models, the counts at every step, agreement by function (of the
requests both readers answered, how many became examples), what was dropped and why (`by_reason` of the label step; the join's
counts), the test sets made, the data folder, the model runs with their scores, and usage and cost in total and by model.
The command prints a short plain report from it.

## Resuming

The same command, with the same config, goes on. Each call, batch and step leaves a file carrying a fingerprint of its
inputs; one that is whole and has the same fingerprint is skipped (so a rerun makes no model call), and a stale one (the
instructions changed, say) is renamed `….stale-N`, never deleted. A usage limit is waited out (`waitMinutes`, up to
`maxWaitHours`) and the call made again; after that the run stops with a status in the manifest and exit code 3. The
spending limit is the run's, not the sitting's: what earlier sittings spent is read back from `calls.jsonl`. A pod of the batch
that is still up is used again; runs already home and scored are not queued again.

## What is never done

- The held-out test (`~/oikos-private/`) is not read, and no test leaves this machine: scoring is here.
- A test-only pilot's requests or situations never train; nothing in a test's words trains, new or standing.
- A reader's answers are not made by keyword rules or scripts, and a reader whose answers look as if they were is rejected.
- A model's run is never deleted: the ledger keeps every prompt and answer, and anything set aside is renamed.
- `gpt-6-astra` is not used. Nothing is pushed.
- Nothing in `runs/` is overwritten: the pipeline writes into its own new folder.

## Not built

- Scoring a model on the pipeline's own test sets: `translator-eval` has no input for them yet. `testsInValidationReal` is the
  stand-in (the trainer scores `validation-real` every epoch), at the cost of comparability.
- A third reader to settle disagreements (the label step drops them).
- Choosing among the trained runs: the manifest lists them, and a person chooses.
