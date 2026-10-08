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
   prompt as sent, what it was shown, the forms it knew of; and the seats' own requests that are no test case. The real test
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
    queues the runs, brings each home as it ends, ends the pod, and then scores each run here (`translator-eval --model
    decide/NAME --real`; the held-out test is read by the eval itself, on this machine, and never leaves it). With
    `"train": false` the pipeline stops after the export. See "The pod" below.
11. **Score on the test sets made here**: each run on each file of step 7 (`translator-eval --model decide/NAME --only-sets
    --set FILE` does the same by hand, for a trained model or any other): right, no draft, wrong draft, in all and by pilot,
    seat model, profile, origin and function. The counts go in the manifest (`test_scores`), every answer in the run's
    `eval-sets.json`.

Writers and readers hand their file in as one object of a given shape (`answers`, a list with an object for each line, every
field a plain string): a model called through Claude Code or the Codex CLI is asked for exactly that shape as its answer
(`--json-schema`, `--output-schema`), and any other adapter is given it as a tool's input. Nothing in it is a string of JSON
for the model to escape by hand: the first form was (a tool whose input the adapters carry as a string), and one reader
escaped the quotation marks of 25 of 34 programs. A reply of plain words is still read if a model gives one (the Claude Code
adapter cuts those at 4,000 characters). A program whose every quotation mark came escaped by hand is still read as meant
(`undoubled`) and counted in the manifest (`escaped_by_hand_and_repaired`); in 160 answers through the new form there was none.

## The pod

`translator/model/pod/pod.sh run DATA NAME:ENCODER:SEED …` (the pipeline calls it; it can be run by hand, with
`OIKOS_POD_STATE` and `OIKOS_POD_MODELS` naming a state folder and where runs come home). It needs `RUNPOD_API_KEY` in
`~/.zshenv` (never written anywhere, nor put on a command line) and the key pair `~/.ssh/oikos_runpod`.

- **The pod is ended on every way out**: when the runs are home, on a failure at any step, on a signal (INT, TERM, HUP), and
  at the time limit (`deadlineHours` in the config, `SECONDS_LIMIT` by hand; 6 hours if absent), whatever is going on then.
  Two things do it: `run` on its way out, and a watchdog of its own process, which also ends the pod when the `run` that
  rented it is gone without having done so (killed outright, a lost session).
- **Ended means seen gone**: ending is asked of the provider until the pod is no longer among the account's pods, and on the
  way out every pod carrying the batch's name (`oikos-translator-<folder>-<hash>`) is ended too. `pod/pod.log` says what the
  provider then lists. If that cannot be confirmed, the exit code is 5 and the pipeline's status says so: look at once.
  `pod.sh pods` lists the account's pods; `pod.sh stop` ends this batch's.
- **Learned by hand, kept**: the pod is asked for with a public IP (without it there may be no SSH port to reach); the
  torch build is the cu128 one (recent cards); a card under 20 GB takes its steps in parts of 4,096 tokens
  (`--token-budget 4096`: the same loss, in more parts). Dearer than `OIKOS_POD_MAX_PER_HOUR` (1) is not taken.
- **Scoring is after the pod is ended**, on this machine. Runs that are home and not scored are scored with no pod rented.
- Exit codes: 0 all home and scored; 1 a run failed there, the queue stopped, or a run was not scored; 3 the pod stopped
  answering; 4 the time limit; 5 a pod could not be confirmed ended.

## The config

```json
{
  "out": "/Users/clawd/oikos/runs/translator-pipeline-2",
  "pilots": [
    { "path": "/Users/clawd/oikos/runs/pilot-11" },
    { "path": "/Users/clawd/oikos/runs/pilot-12", "test": true }
  ],
  "writers": { "claude-code": "claude-code/claude-sonnet-5-5", "codex": "codex/gpt-6.1-sol" },
  "readers": ["claude-code/claude-sonnet-5-5", "codex/gpt-6.1-sol"],
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
anywhere); see "The readers" below for why these two. `budget`: the spending limit in USD for every model call the run makes (required; a Codex call costs nothing per
call, and its subscription limits apply). Optional: `testSituations` (as `situations`), `requestsPerSituation` (8), `realRequests`,
`writtenRequests` (all), `every` (3), `seed` (1), `repeat` (4), `validationDays` (10), `testsInValidationReal` (false: put the
test lane's examples into validation-real as well, which makes `real_right` in a run's report count them, and so no longer
comparable with earlier runs), `waitMinutes` (20) and `maxWaitHours` (12) for usage limits, `writerCallChars`, `readerBatch`,
`readerBatchChars`, `callMinutes` (15: how long one call to a writer or reader may take), `trainExtra` (flags for
`train.py`), `deadlineHours`, `name` (for the runs: `<name>-s<seed>`).

## The readers

Two different models, of different families: the point of reading twice, blind, is that two readers who agree did not
make the same mistake for the same reason. **The default pair is Sonnet 5.5 (through Claude Code) and gpt-6.1-sol (through
the Codex CLI).** Measured 2026-10-08 on 40 requests of pilot 11, 34 of them with a label two earlier readers had settled
(`runs/reader-comparison-2026-10-08/`, made with `bun orchestrator/src/reader-compare.ts <config.json>`, which measures any
candidates the same way):

| Reader | Read whole | With the settled labels | Seconds a request | Cost a request, as reported |
|---|---|---|---|---|
| claude-code/claude-sonnet-5-5 | 40/40 | 34/34 | 1.4 | 0.0115 USD |
| claude-code/claude-haiku-5-5@low | 40/40 | 24/34 | 1.5 | 0.0162 USD |
| codex/gpt-6-luna | 39/40 | 29/34 | 0.8 | none per call |
| codex/gpt-6.1-sol | 40/40 | 34/34 | 2.0 | none per call |

Agreement between two (of 40): Sonnet with sol 36, Sonnet with luna 31, sol with luna 31, Sonnet with Haiku 24, Haiku with
luna 25, Haiku with sol 24. The labels were settled by Haiku 5.5 and Sonnet 5.5, which flatters those two; sol's 34 of 34
is the independent one. Haiku at low effort ends a copied text with a full stop the request's words don't have (8 of its 10
misses) and refuses two requests to hold payments. No answer of the 160 came with quotation marks escaped by hand.

**The fallback** when one of the pair cannot be had: gpt-6-luna in place of sol (still two families; fewer examples, since
it agrees with Sonnet on 31 of 40 and not 36); if Claude Code is what cannot be had, sol with luna (one family: the last
resort, and to be said in the run's notes). Haiku 5.5 at low effort is not a reader to choose: it costs no less as reported
and agrees least. With the default writers, each reader also reads requests its own model wrote; the other reader never did.

What "cost as reported" is: Claude Code's own figure for a call on the plan. In the comparison's four Claude calls it is
exactly the tokens at one rate for both models (per million: 5 input, 25 output, 0.5 cache read, 6.25 cache write), so it
measures tokens used and not either model's price. Haiku used 1.7 times Sonnet's output tokens for the same answers.

## What is written under `out`

`config.json`, `manifest.json` (below), `pipeline.log`, `calls.jsonl` (the ledger: every call's usage and cost, its prompt and
its answer: model runs are training data and are kept), `lanes/<train|test>/…` (situations, `selected.json`, `written/` and
`read/` with a file for each call, `requests/`, `label/`), `tests/`, `joined/`, `data/` (the export), `models/` (runs home from
the pod, each with `eval.json`, the fixed tests, and `eval-sets.json`, the test sets made here), `pod/` (the batch's pod
state; `pod.log` has each pod rented, its price, when it was ended and what the provider then listed).

The manifest has: the sources (test-only or not, and why; their logs; the seat models), commits (this repo, dirty or not; each
pilot's `commit.txt`), the translator prompt's version, the models, the counts at every step, agreement by function (of the
requests both readers answered, how many became examples), what was dropped and why (`by_reason` of the label step; the join's
counts), the test sets made, the data folder, the model runs with their scores on the fixed tests (`runs`) and on the test sets
made here (`test_scores`: by run and set, in all and by pilot, seat model, profile, origin and function), and usage and
cost in total and by model.
The command prints a short plain report from it.

## Resuming

The same command, with the same config, goes on. Each call, batch and step leaves a file carrying a fingerprint of its
inputs; one that is whole and has the same fingerprint is skipped (so a rerun makes no model call), and a stale one (the
instructions changed, say) is renamed `….stale-N`, never deleted. A usage limit is waited out (`waitMinutes`, up to
`maxWaitHours`) and the call made again; after that the run stops with a status in the manifest and exit code 3. The
spending limit is the run's, not the sitting's: what earlier sittings spent is read back from `calls.jsonl`. Runs already home
are not trained again (a run home and not scored is scored with no pod); a pod is never left up to be used again: a run cut
short on the pod is trained again from its start on a new one.

## What is never done

- The held-out test (`~/oikos-private/`) is not read, and no test leaves this machine: scoring is here.
- A test-only pilot's requests or situations never train; nothing in a test's words trains, new or standing.
- A reader's answers are not made by keyword rules or scripts, and a reader whose answers look as if they were is rejected.
- A model's run is never deleted: the ledger keeps every prompt and answer, and anything set aside is renamed.
- `gpt-6-astra` is not used. Nothing is pushed.
- Nothing in `runs/` is overwritten: the pipeline writes into its own new folder.

## Not built

- Scoring a prompt-driven model on the test sets from the pipeline itself: it scores the runs it trained; any other model is
  scored by hand (`oikos translator-eval --model provider/model --only-sets --set <out>/tests/<file>.jsonl`).
- Resuming a training run on the pod after the pod is ended: the checkpoint is not brought home, so it starts again.
- A third reader to settle disagreements (the label step drops them).
- Choosing among the trained runs: the manifest lists them, and a person chooses.
