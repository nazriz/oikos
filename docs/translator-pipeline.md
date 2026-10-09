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
   example of a test-only pilot's run; and (since 2026-10-09) any example, new or standing, on any side, that shares five
   words running with a held-out case, where this machine has them (counted in the manifest's `join`, never listed).
9. **Export** (`translator/model/export.ts`, arguments by name): the steps the model is trained on, in `data/`.
10. **Train** (`"train": true`): `pod.sh run data NAME:ENCODER:SEED …` rents a GPU, sets it up, sends the trainer and `data/`,
    queues the runs, brings each home as it ends, ends the pod, and then scores each run here (`translator-eval --model
    decide/NAME --real`; the held-out test is read by the eval itself, on this machine, and never leaves it). With
    `"train": false` the pipeline stops after the export. See "The pod" below.
11. **Score on the test sets made here**: each run on each file of step 7 (`translator-eval --model decide/NAME --only-sets
    --set FILE` does the same by hand, for a trained model or any other: `--model codex/…`, `claude-code/…`): right, no
    draft, wrong draft, in all and by pilot, seat model, profile, currency, origin and function. Each case is asked and
    compared in the money of its own world (its line carries that world's currency, and amounts are read as that world
    writes them; a line that names none is read in the test town's and counted). The counts go in the manifest
    (`test_scores`), every answer in the run's `eval-sets.json`.

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
- **Scores are only comparable under the same scoring code.** The script's first whole run (2026-10-08, one seed of the
  small reader on data-13) scored 141 of 180 real requests where the same setup by hand had scored 147 the day before;
  the hand-run model scored again that day gave 141 too. The six were the scoring's: two keys that had since been given
  several bases, and four right answers under the cut-off on sureness that had since become the default. Before reading
  a difference between runs, score the older one again (`translator-eval --model decide/NAME --real --out <another file>`).
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
anywhere); see "The readers" below for why these two, and for the pair to name when the Codex window is shut
(`["claude-code/claude-sonnet-5-5", "claude-code/claude-haiku-5-5"]`: nothing waits on Codex). `budget`: the spending limit in USD for every model call the run makes (required; a Codex call costs nothing per
call, and its subscription limits apply). Optional: `testSituations` (as `situations`), `requestsPerSituation` (8), `realRequests`,
`writtenRequests` (all), `every` (3), `seed` (1), `repeat` (4), `validationDays` (10), `testsInValidationReal` (false: put the
test lane's examples into validation-real as well, which makes `real_right` in a run's report count them, and so no longer
comparable with earlier runs), `waitMinutes` (20) and `maxWaitHours` (12) for usage limits, `writerCallChars`, `readerBatch`,
`readerBatchChars`, `callMinutes` (15: how long one call to a writer or reader may take), `trainExtra` (flags for
`train.py`), `deadlineHours`, `name` (for the runs: `<name>-s<seed>`).

## The readers

Two different models: the point of reading twice, blind, is that two readers who agree did not make the same mistake for
the same reason, and two families are less likely to than one.

**The default pair is Sonnet 5.5 (through Claude Code) and gpt-6.1-sol (through the Codex CLI)**, as in the config above.
**When the Codex window is shut, the second reader is Haiku 5.5 at its default effort**: `"readers":
["claude-code/claude-sonnet-5-5", "claude-code/claude-haiku-5-5"]`. That is a choice made in the config when the pipeline
is started (a run never changes reader half way; a reader at a limit is waited for, `waitMinutes` and `maxWaitHours`,
and the run then stops to be resumed), and the manifest records it (`models.readers`, and usage by model). Codex running
out blocks nothing: the pipeline is started with the Claude pair and the audit below is owed.

Measured twice on the same 40 requests of pilot 11, 34 of them with a label two earlier readers had settled (made with
`bun orchestrator/src/reader-compare.ts <config.json>`, which measures any candidates the same way). First on 2026-10-08
under prompt 0.7.6 (`runs/reader-comparison-2026-10-08/`), then on 2026-10-09 under prompt 0.9.0 for the Claude models
alone (`runs/reader-comparison-2026-10-09/`; the Codex models were not asked again):

| Reader | Prompt | Read whole | With the settled labels | Seconds a request | Cost a request, as reported |
|---|---|---|---|---|---|
| claude-code/claude-sonnet-5-5 | 0.9.0 | 40/40 | 33/34 | 0.9 | 0.0043 USD |
| claude-code/claude-haiku-5-5 | 0.9.0 | 40/40 | 34/34 | 2.1 | 0.0171 USD |
| claude-code/claude-haiku-5-5@low | 0.9.0 | 40/40 | 26/34 | 1.5 | 0.0139 USD |
| claude-code/claude-fable-5-1 | 0.9.0 | 40/40 | 34/34 | 2.3 | 0.0258 USD |
| claude-code/claude-sonnet-5-5 | 0.7.6 | 40/40 | 34/34 | 1.4 | 0.0115 USD |
| claude-code/claude-haiku-5-5@low | 0.7.6 | 40/40 | 24/34 | 1.5 | 0.0162 USD |
| codex/gpt-6-luna | 0.7.6 | 39/40 | 29/34 | 0.8 | none per call |
| codex/gpt-6.1-sol | 0.7.6 | 40/40 | 34/34 | 2.0 | none per call |

Agreement between two (of 40):

| Pair | Agree | Of those, sol's stored answer agrees too |
|---|---|---|
| Sonnet with sol (both 0.7.6) | 36 | |
| Sonnet (0.9.0) with sol (0.7.6) | 35 | |
| **Sonnet with Haiku at default effort (0.9.0)** | **38** | 35 |
| Haiku at default effort with Fable (0.9.0) | 37 | 36 |
| Sonnet with Fable (0.9.0) | 36 | 35 |
| Sonnet with Haiku at low effort (0.9.0; 24 under 0.7.6) | 31 | |
| Sonnet or sol with luna (0.7.6) | 31 | |

- **Of the Claude pairs, Sonnet with Haiku at default effort**: it agrees most (38 of 40, so most examples), costs least
  (about 0.021 a request for the pair; with Fable 0.030; Haiku with Fable 0.043), and its two readers are the most unlike
  of the three in size. Fable reads as well as either and is the dearest; it is the one to bring in if Haiku cannot be had.
- **Haiku's earlier poor showing was the effort, not the model.** At low effort it still ends a copied text with a full
  stop the request's words do not have and agrees with the labels on 26 of 34; at default effort it agrees on all 34. It
  is never a reader at low effort.
- **The labels flatter the Claude models** (they were settled by Haiku 5.5 and Sonnet 5.5); sol's 34 of 34 was the
  independent figure. The third column is the check that does not: of what a Claude pair agrees on, sol's stored
  answers (an older prompt) agree with all but one to three. The one request all three Claude readers answer one way
  and sol another is refused by both, with different labels (`look_first`, which did not exist when sol read it).

**What is lost when both readers are one family.** Agreement between two Claude models is weaker evidence than agreement
across families: a reading both were trained toward (how to name an addressee, when to refuse, what counts as one act)
passes both and becomes a label. On these 40 requests nothing of the kind shows (above), but 40 requests of one pilot's
three offices cannot show much, and none of them is a hold, a direction, a standing work order or an office's own form.
The examples a one-family pair makes are also more numerous (38 of 40 against 36), which is the same fact seen from the
other side: they disagree less, so the label step drops less, including things it should have dropped.

**The audit, which blocks nothing.** When a pipeline run used the Claude pair, read a sample of its *examples* again with
`codex/gpt-6.1-sol` when its window is next open: 100 requests or one in ten, whichever is less, drawn evenly by function
(`reader-compare.ts` with `requests` and `labels` pointing at the run's `lanes/train/requests/unlabelled.jsonl` and
`label/examples.jsonl`, `readers: ["codex/gpt-6.1-sol"]`, `limit: 100`: about four batches, 100 calls' worth of the
window). Read the disagreements by hand. If sol disagrees with more than about one label in ten, or its disagreements
gather in one function, that function's examples from the run are read again by sol in full before they train anything.
Record the audit beside the run (`audit-<date>/`) and in its notes. Until it is done, the run's notes say "readers of one
family; audit owed".

**Other fallbacks.** gpt-6-luna in place of sol keeps two families and makes fewer examples (31 of 40). With the default
writers, each reader also reads requests its own model wrote; under the Claude pair Sonnet reads what Sonnet wrote and
Haiku never wrote any.

What "cost as reported" is: Claude Code's own figure for a call on the plan. On 2026-10-08 it was the tokens at one rate
for both models; on 2026-10-09 the three models' figures differ (Fable's is at its list price), so it is nearer a price,
and still a measure of plan usage rather than of money.

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
made here (`test_scores`: by run and set, in all and by pilot, seat model, profile, currency, origin and function), and usage and
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

- The held-out test (`~/oikos-private/`) is read by nobody and by two pieces of code alone: the scoring, and the join's
  check for shared wording. Nothing of it is written anywhere but counts and case ids, and no test leaves this machine.
- A test-only pilot's requests or situations never train; nothing in a test's words trains, new or standing.
- A reader's answers are not made by keyword rules or scripts, and a reader whose answers look as if they were is rejected.
- A model's run is never deleted: the ledger keeps every prompt and answer, and anything set aside is renamed.
- `gpt-6-astra` is not used. Nothing is pushed.
- Nothing in `runs/` is overwritten: the pipeline writes into its own new folder.

## The retrain after the wave

Written 2026-10-09, before wave 2, with no model called and nothing trained (the owner's word: the retrain that matters
needs the wave's requests first, and writing data now would compete with the wave for the same Claude limit). The
model on disk (`decide/pod-small-d16-s1`) was taught no hold, entry on one's own file, `look_first`, form of an office's
own, direction on a form or standing work. Three steps; the third is the one command above.

**What is ready.**
- The standing set re-keyed to prompt 0.9.0: `runs/translator-data-in-situ/joined-11` (its README has the rules and the
  counts; exported as `runs/translator-model/data-17`). It passes the leak check against the held-out cases, which
  `joined-10` did not (six cases shared wording with 94 rows: every held-out score of a data-13 or data-16 model was
  measured with that). 146 requests whose label may be stale and that no rule settles are in its `set-aside.jsonl`,
  for two readers.
- A part can be made of the new kinds by name: `--only` takes `hold`, `entry`, `standing_work`, `standing_work_hold`,
  `standing_work_withdraw`, `direction`, `paper`, `direction_unlisted` beside functions, and `--generated N` then counts
  the programs of the function each is drawn among.
- The trainer never shows a letter to an office beside a form that goes to that office (`with_forms`: since an office
  may have its own form for being directed, that pairing would teach a letter where the rule says the form), and
  `--forms-most N` sets how many forms are added beside an example (5 as before unless given).
- The export carries every new shape whole (`translator/test/model-export-shapes.test.ts`).

**1. Generated parts, weighted toward what the model lacks** (pipeline 0.12.0; briefs for three writers, then
`translator-data-write` and the blind check as for every part; or the same options with `--model` and `--back-model`,
which is a call a request). Counted by a dry run of the plans, with no model:

```
oikos translator-data <a log> --briefs --writers sonnet,haiku,fable --no-spares --out <runs>/translator-data-wave-2/part-h \
  --only hold,entry,standing_work_hold,standing_work_withdraw --generated 6000 --ceiling 0 --per-gold 2 \
  --refusal-labels look_first --refusal-floor 300 --seed 311 --validation 0
oikos translator-data <a log> --briefs --writers sonnet,haiku,fable --no-spares --out <runs>/translator-data-wave-2/part-f \
  --only direction,paper,direction_unlisted,standing_work --generated 2500 --ceiling 0 --per-gold 2 \
  --refusal-labels no_such_act,unknown_form --refusal-floor 150 --seed 312 --validation 0
```

- `part-h`, 3,324 briefs: 1,070 holds of a payment or a paper (406 of several), 520 holds of a standing work order,
  288 standing work orders withdrawn, 1,146 entries, 300 `look_first` in its three kinds.
- `part-f`, 4,318 briefs: 1,004 directions on an office's form, 1,004 papers on an office's own form (lists and dates
  among the fields; every third set is the worlds' own 38 declared papers), 624 of the same directions as letters where
  no form is listed, 1,536 standing work orders, 150 refusals.
- Both: every one of the 26 ways of writing money the generator draws (the nine profiles' and seventeen invented: a
  decimal comma, the sign after, groups of two with number words, no smaller unit), 80 to 290 briefs each; a little
  over half in the seats' two voices (`early`, `late`), the rest spread over eleven styles.
- Add a small general part for what seats ask beside these (`--only statement,money,vote,message --generated 400`:
  withdrawals said as lifting a hold, payments, votes, letters with and without an id for what they are about) if the
  wave's own requests turn out thin there. Decide the sizes after the wave: what its seats asked for is the weight.
- Writers: `claude-code/claude-sonnet-5-5`, `claude-code/claude-haiku-5-5`, `claude-code/claude-fable-5-1`, a third
  each (and `codex/gpt-6.1-sol` as a fourth voice only if its window is open). The blind reader is never the writer.

**2. Join them to the standing set** as `joined-12`: joined-11's three files, plus each new part's `checked.jsonl`,
split by gold program as `runs/translator-data-2026-10-06b/split.ts` does, the part's validation side added to
`validation.jsonl`. The 146 set aside go to the readers with the wave's requests (`in-situ-blind` on
`set-aside.jsonl`, then `in-situ-label`), and what two readers agree on joins too. Not one command: see "Not built".

**3. The pipeline over every pilot so far**, one command, with a config of this shape:

```json
{
  "out": "/Users/clawd/oikos/runs/translator-pipeline-wave-2",
  "pilots": [
    { "path": "/Users/clawd/oikos/runs/<each wave-2 pilot>" },
    { "path": "/Users/clawd/oikos/runs/pilot-11" }, { "path": "/Users/clawd/oikos/runs/pilot-12" },
    { "path": "/Users/clawd/oikos/runs/pilot-13" }, { "path": "/Users/clawd/oikos/runs/pilot-18" },
    { "path": "/Users/clawd/oikos/runs/live-check-2026-10-09/<each>" },
    { "path": "/Users/clawd/oikos/runs/live-check-2-2026-10-09/<each>" },
    { "path": "/Users/clawd/oikos/runs/claude-translator-check-2026-10-09/<each>" }
  ],
  "writers": { "claude-code": "claude-code/claude-sonnet-5-5", "codex": "codex/gpt-6.1-sol" },
  "readers": ["claude-code/claude-sonnet-5-5", "codex/gpt-6.1-sol"],
  "situations": 400, "testSituations": 120, "extraInstructions": ["writer-round2.txt"],
  "standing": "/Users/clawd/oikos/runs/translator-data-in-situ/joined-12",
  "budget": 150,
  "train": true, "encoder": "microsoft/deberta-v3-small", "seeds": [1, 2, 3],
  "trainExtra": ["--forms-most", "18"], "deadlineHours": 3, "name": "pod-small-w2"
}
```

- A pilot marked `"test": true` (every live-check pilot, the translator check's, and the wave's eleven) is a test set
  and never trains; the config cannot take the mark away. Pilots 12, 13 and 18 ran with the old trained translator in
  front of their seats: their requests train, their drafts are not labels.
- Readers: Sonnet 5.5 with gpt-6.1-sol if the Codex window can carry it; if not, Sonnet 5.5 with Fable 5.1 (measured
  2026-10-09 under prompt 0.9.0 on the same 40 requests, `runs/reader-comparison-2026-10-09/`: they agree on 36 of 40,
  each with 33 or 34 of the 34 settled labels; Sonnet with Haiku at its default effort agrees on 38 and costs less as
  reported, and is one family twice over, as is any Claude pair: say which in the run's notes).
- `--forms-most 18`: a seat of today's towns knows of 13 to 18 forms (measured on the live check: 533 to 760 of the
  reader's 1,024 tokens before the request is read); every model so far was shown at most five beside an example.
  It changes training, so the first batch should have one seed without it for comparison. Watch `left_out` in a run's
  report (`long`: an input past the reader's limit is left out of training and asked back in use).
- The pod step by hand, if the pipeline stopped after the export:
  `OIKOS_POD_STATE=<out>/pod OIKOS_POD_MODELS=<out>/models zsh translator/model/pod/pod.sh run <out>/data pod-small-w2-s1:microsoft/deberta-v3-small:1:"--forms-most 18" …`
  (about 18 minutes and 0.12 USD a run on 2026-10-08; `pod.sh pods` afterwards must list none of ours).

**Scoring, the same day, old model beside new** (scores are comparable only under the same scoring code):
- `oikos translator-eval --model decide/<run> --real --out <file>` for the new runs and again for
  `decide/pod-small-d16-s1`: seen, held out (by case id and outcome only) and the 180 real requests, right / no draft /
  wrong draft. The held-out cases were written before the hold and `look_first`: any keyed to the old rules count
  against a model that is right now, and whoever keeps them re-keys by case id.
- By kind: the pipeline scores each run on its test sets by function, pilot, seat model, profile and currency
  (`test_scores`). Read holds, forms, directions, standing work, entries and `look_first` off the by-function lines
  and the set's labels (`translator-eval --only-sets --set <out>/tests/test-pilots-real.jsonl`).
- The live check's pilot 2 (the 44 requests of which the old model refused 31): it is a test-only pilot, so its
  requests are in `tests/test-pilots-real.jsonl` with `pilot` on each line; its line in `test_scores` is the replay.
  Only requests two readers agreed on are scored: say how many of the 44 that is.
- Sureness: `OIKOS_DECIDE_LOG=<file>` logs each answer's sureness; report its spread and what the cut-off of 0.1 asks
  back. `DecideAdapter.cannot` must report nothing lacking for the new runs.

## A wide part

Written 2026-10-09 (data pipeline 0.13.0), for the owner's concern that the data is too narrow: the pilots' requests
are few, of a few kinds, in one careful register, all from office seats. Breadth is generated. The first run is
`runs/translator-data-broad-2026-10-09/` (its README has what was made and the agreement rates).

**The plan of a part** is `translator-data --briefs` as ever, with three things more:

- `--broad`: the styles are dealt by `BROAD_DEAL` (data.ts): three registers beside the older styles, `rambling` (the
  request buried in talk), `flat` (a simple writer's short literal sentences) and `slips` (typed fast, slips and odd
  word order, never inside what is copied), with the terse line two turns in five between them, and the seats' voices
  one turn in five. Every brief says **who is asking** (`ASKERS`: an office-holder in an office-holder's style;
  otherwise a shopkeeper, landlord, tenant, worker, union organiser, clinic manager, resident, farmer, bank clerk,
  newcomer or board member, among those who would honestly ask for such an act). The refusal briefs gain
  `look_first` for any act on something on record whose id the speaker lacks (a ballot, an agreement, something
  withdrawn, held, released or settled: the request must not hold the id), and `no_such_act` for attending something.
- `--world-forms N`: every paper the worlds' own offices issue (41 over 20 modules, `participants/src/behaviour/papers.ts`),
  each filled in N ways, every field of it in the first two; `--only world_form` for those alone. Whose paper it is
  decides who asks (a landlord for a rental listing).
- A plan made without them is what it was.

**Writing and checking through the adapters** (`orchestrator/src/broad.ts`), one resumable command:

```
oikos translator-data-batch <config.json> <PART>...
```

```json
{
  "out": "/Users/clawd/oikos/runs/translator-data-broad-2026-10-09",
  "writers": { "fable-a": "claude-code/claude-fable-5-1", "sonnet": "claude-code/claude-sonnet-5-5" },
  "readers": { "claude-code/claude-fable-5-1": "claude-code/claude-sonnet-5-5",
               "claude-code/claude-sonnet-5-5": "claude-code/claude-fable-5-1", "*": "claude-code/claude-sonnet-5-5" },
  "budget": 400, "writeBatch": 16, "readBatch": 30, "jobs": 4
}
```

`writers`: the model for each name the part's briefs were dealt to (`--writers fable-a,fable-b,sonnet,…`: several
names for one model give it that share). `readers`: who reads each writer's requests blind; a config in which a model
would read its own writing is refused. For each part: each writer's briefs to its model, a batch at a call; the
mechanical checks (`translator-data-write`'s); each request read blind under the translator's prompt; the gold
programs compared by meaning; `checked.jsonl` is what agrees, `disagreed.jsonl` is set aside and never trains;
agreement is counted by function, style, asker, writer, reader, currency shape and kind; then the leak check
(`leaks`, five words running with a held-out case: taken out as `leaked.jsonl`, named by case id only). Every call is
in `calls.jsonl`. A usage limit is waited out and then the run stops with exit code 3: the same command goes on.

**The banked part** (docs/design/translator-v2.md): `oikos translator-v2-data <pilots…> --out DIR --from-pilots N
--generated N --writers …` plans plain-text turns whose right reading is one of a seat's other tools, and the same
`translator-data-batch` writes, checks and reads them (`v2-checked.jsonl`). It is in no v1 training set.

**Joining a wide part** to the standing set is step 2 of the retrain above: each part's `checked.jsonl`, split by gold
program. The join's own leak check runs again there.

## Not built

- The retrain's first two steps as one command: generated parts are written and checked by their own commands, and
  joined to the standing set by a short script (as `runs/translator-data-2026-10-06b/split.ts`). Writers of generated
  parts are called one request at a call through an adapter, or work by file in batches.

- Scoring a prompt-driven model on the test sets from the pipeline itself: it scores the runs it trained; any other model is
  scored by hand (`oikos translator-eval --model provider/model --only-sets --set <out>/tests/<file>.jsonl`).
- Resuming a training run on the pod after the pod is ended: the checkpoint is not brought home, so it starts again.
- A third reader to settle disagreements (the label step drops them).
- Choosing among the trained runs: the manifest lists them, and a person chooses.
