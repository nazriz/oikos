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
6. **Label**: two readers agree when their programs are the same act; copied free text is not compared (since 2026-10-10:
   a letter's text and `re=`, a payment's `for=`, a statement's text, a form's text fields, a closing full stop; docs/decisions.md,
   ruling A), and the example is one reader's own program, every word of it found in the request. Where the two readers' programs differ in `basis` alone, the basis becomes every record either gave, in the
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
    scored as the 180 real requests are, free text not compared, with `text_exact` beside `passed` (how many of the right answers
    have the label's free text too); compared in the money of its own world (its line carries that world's currency, and amounts are read as that world
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
`train.py`), `deadlineHours`, `name` (for the runs: `<name>-s<seed>`). `uniformity` (the limits of the guard on a reader's answers, step 5: `{"topShare": 0.65}` where the
requests are known to be lopsided; the wave's writers, put in a seat, ask to be shown things about one time in three, which
is `none(not_an_act)`, and a batch of 30 then passes 40% of one program by chance: read the batch that stopped the run
before raising it).

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

### The retrain's results (2026-10-10)

Run folder: `runs/translator-retrain-2026-10-10/` (its README and STATUS; `scores/groups-all.txt` has every table).
Models: `pod-small-w2-s1`, `-s2`, `-s3` in its `models/` (`microsoft/deberta-v3-small`, arguments by name,
`--forms-most 18`, four epochs, `--token-budget 4096`), trained on `runs/translator-model/data-18`, the export of
`runs/translator-data-in-situ/joined-12`. **It does not pass**: 81 to 83% right on the 180 real requests against a
floor of 90%, wrong drafts 7 to 9% against 1%.

**What trained** (49,496 rows; 35,148 distinct requests; `joined-12.manifest.json` counts it every way):

| Source | Rows | Distinct requests |
|---|---|---|
| The older generated set (joined-11) | 19,236 | 18,361 |
| The wide generated set (less 442 rows sharing a source with the parity test) | 12,862 | 12,357 |
| Written in seats' situations, pilots 7 to 10 (joined-11) | 11,445 | 2,842 |
| Written in seats' situations, wave 2 and pilots 11 to 18 | 3,988 | 997 |
| Seats' own requests, wave 2 and pilots 11 to 18 | 1,448 | 362 |
| Seats' own requests, earlier | 385 | 97 |
| Directions with no form listed, read again under 0.9.3 (85 of 96 agreed with their gold) | 81 | 81 |

The 146 requests set aside from joined-11 were read again by two readers; the 81 they agree on are among the rows
above. Weighting: an example from a pilot (a seat's own request, or one written in its situation) is in four times,
as before; generated examples once. Pilot examples are then 35% of the rows and 12% of the distinct requests. One
seat-day in ten went to validation-real (404), and a third of each kind of the seats' own requests was held back as
a test (148 and 61). The closed set has 118 choices and lacks nothing of the call language (`cannotSay`: none);
`per_request` is in two examples. 141 rows longer than the reader's 1,024 tokens were left out.

**Scores, old model beside new, scored the same day with the same code** (right; no draft, wrong draft):

| Test | Old (`pod-small-d16-s1`) | Seed 1 | Seed 2 | Seed 3 |
|---|---|---|---|---|
| Seen (99) | 61 | 81 (6, 12) | 82 (8, 9) | 85 (7, 7) |
| Held out (66) | 41 (14, 11) | 46 (11, 9) | 46 (11, 9) | 48 (11, 7) |
| The 180 real requests | 130 (35, 15) | 147 (20, 13) | 146 (18, 16) | 149 (19, 12) |
| Parity test (1,466; generated, with groups) | 998 (304, 164) | 1,366 (47, 53) | 1,366 (50, 50) | 1,365 (48, 53) |
| Held-back seats' requests, wave 2 (148) | 13 | 122 (10, 16) | 122 (11, 15) | 126 (8, 14) |
| Held-back seats' requests, late pilots (61) | 5 | 55 (1, 5) | 54 (2, 5) | 56 (2, 3) |
| Test-only pilots, seats' own (77: live checks, w2-22, w2-23) | 10 | 57 (9, 11) | 55 (13, 9) | 57 (10, 10) |
| Test-only pilots, seats' own (59: stage 2c) | 5 | 44 (7, 8) | 48 (1, 10) | 45 (3, 11) |
| Test-only pilots, written in their situations (187) | 121 | 161 (11, 15) | 160 (8, 19) | 159 (10, 18) |
| Test-only pilots, written in their situations (108: stage 2c) | 57 | 92 (8, 8) | 95 (4, 9) | 93 (5, 10) |

The older figure of 141 real for the old model was under earlier scoring code and eval cases; today it is 130.

**By kind** (parity test, old then the three seeds): holds 0, then 30 of 30 each; entries on one's own file 0, then
24 of 24; standing work 0, then 60, 60, 59 of 60; `look_first` 0, then 66, 67, 66 of 68; standing payments 9, then
18, 19, 20 of 20; forms 45, then 182, 175, 182 of 250 (a form the request does not name does about as well as a
named one, so pointing at the form shown works); agreements 57 to 67%. On the 180 real: statements 13 of 22, forms 24
of 31, messages 17 of 21 (seed 1). On the test-only pilots' own requests: money 0 of 7 and 12 of 17, work 2 of 8.

**By group** (groups of 20 or more; best to worst, and how many groups are under 90%):

| Test, dimension | Old | Seed 1 | Seed 2 | Seed 3 |
|---|---|---|---|---|
| Parity, register (18) | gap 41; 17 under | 100 to 88.9 (slips); 1 under | to 87.3; 2 | to 85.7; 3 |
| Parity, asker (13) | gap 53; 12 under | 100 to 80.8 (banker); 1 | to 82.7; 1 | to 86.5; 1 |
| Parity, writer (6) | gap 70; 5 under | 100 to 79.3; 2 | to 77.9; 2 | to 78.3; 2 |
| Parity, way of writing money (15) | gap 14; 15 under | 99.3 to 83.9; 4 | to 86.8; 3 | to 83.9; 4 |
| Parity, ask-back rate across groups | 0 to 59% | 0 to 14% | 0 to 12% | 0 to 14% |
| Test pilots' own requests, seat model | all under 15% | Haiku 5.5 38/41, gpt-6.1-sol 12/20, Sonnet 5.5 6/12, gpt-6-luna 1/4 | 35/41, 13/20 | 35/41, 14/20 |
| Stage 2c's own requests, profile | | in-tn 16/17, mx-jal 24/37 | 15/17, 29/37 | 14/17, 28/37 |
| Held-back, profile | | gb-eng 21/22, us-oh 37/44, de-ni 53/62, au-vic 11/20 | gap 21 | gap 33 |

The lowest writer on the parity test is the largest Claude model's writing (it wrote the forms parts, the hardest
kind); the simple writer (Haiku 5.5 at low effort) is the other under 90%. On real requests the gaps by seat model
and by profile are 15 to 40 points, on cells of 10 to 60: too wide to release on, and too small to rank groups by.

**Replays.** Live check 2's pilot 2 (44 requests, of which the old model refused 31): 39 have a label two readers
agreed on; the old model gets 6, the new 36, 35 and 35. w2-26 and w2-56 gave one request between them.

**Sureness and the cut-off** (seed 1, the 180 real; right, no draft, wrong): 0: 149, 17, 14; 0.1 (the default): 147,
20, 13; 0.3: 139, 32, 9; 0.5: 128, 47, 5; 0.8: 113, 65, 2; 0.95: 99, 81, 0. On the 2,106 set answers 39 are under
0.1 and 199 under 0.5; the median is 0.998. Wrong drafts reach 1% only by asking back on a third or more.

**The audits by another family.** Of the wide set: `codex/gpt-6.1-sol` read 297 (nine of each of 33 kinds) and
agrees with 287; the one low kind, standing work (4 of 9), is sol adding `first="0 days"` for "from now on", which
the prompt's own worked example does not; nothing was set aside. Of the pipeline's own examples (two Claude readers,
since a Codex window cannot carry a pipeline's readings): sol agrees with 97 of 120, and the differences gather in
refusal labels: `too_much` 0 of 9 (sol writes a payment and its report as two lines), `unknown_form` 5 of 8,
agreements 6 of 9. **Owed before the next round:** sol reads the pipeline's refusals in full; 13 `too_much` examples
of this kind trained these models.

**The readers disagree a great deal on what seats really ask**: of the 3,555 requests the two pipelines sent to both readers, 2,382 became examples and 1,040
were dropped because the readers disagreed; by function, money 217 of 447, messages 125 of 284, agreements 19
of 94, work 14 of 84 (the first pipeline's training lane and the second's). What trains is therefore the easier half
of the hard kinds, which is where the models are weakest.

**The v2 decision** ("which kind of turn is this"; `v2-head/`): the same reader with one choice head over twelve
kinds of turn (an act for v1, a look, a notebook entry, a letter, a confirmation, done for now, opting out, several
uses, and the four plain replies to a preview), trained on the banked turns with a sixth held back: 689 of 698
right; every kind 96% or better but opting out (0 of 1; four examples in the bank); registers, askers and writers
all 95% or better; four wrong answers given with sureness over 0.9. It is a small addition and not a hard decision.

**Where it is weak, and what data would mend it.**
- Money on pilots it has not seen (wages with withholding, remittances, payments citing several records) and
  statements: more of the seats' own requests of these kinds, and the readers' disagreements settled by a third
  reader instead of dropped (1,040 requests here).
- Forms at 70 to 73% on the parity test and 76% on stage 2c's own: forms with several amounts, dates and lists.
- Agreements (57 to 67%): the fewest examples from pilots (19).
- Profiles and seat models it met least: mx-jal, gb-eng and au-vic seats, and Codex seats (one training pilot).
- `per_request`: two examples. A bank seat's requests are needed, or a generated part for it.

**What it can translate for now.** Nothing in place of Sonnet 5.5 where a wrong draft costs: 7 to 9% wrong drafts
on real requests is seven times the mark. It is fit to be measured beside Sonnet 5.5 as a second translator in
pilots whose requests are mostly holds, entries, standing work, votes and forms an office lists (a registry or
works seat on a profile it has seen), which is where it now scores 90% or more.

**Spend.** RunPod 1.98 USD of a limit of 6.00 (seed 1: 75 minutes, 0.46; a pod whose queue stopped with nothing
brought home: 100 minutes, 0.57; seeds 2 and 3: 140 minutes, 0.92); the provider lists no pod of ours. Plan usage
as Claude Code reckons it: 216 USD (Haiku 5.5 as second reader 94, Opus 5.5 52, Sonnet 5.5 50, Haiku 5.5 at low
effort 21). Codex: 417 requests read by gpt-6.1-sol, no charge per call.

**How it was run** (so that it can be run again): `scripts/` in the run folder has the small scripts (blind readings and
their reckoning, the base set, the configs, the manifest, scoring, the tables by group). Two pipeline folders, chained:
`pipeline/` over the pilots finished when it started, with `standing` the base set (joined-11, the wide set's train file
less what shares a source with the parity test, the rescued directions and set-aside requests), and `pipeline-late/` over
the pilots that finished later and stage 2c's test-only pilots, with `standing` the first's `joined/`; the second's
`joined/` and `data/` are joined-12 and data-18. Start the pipeline with `OIKOS_CLAUDE_BIN` naming a Claude Code new
enough for every writer (the first on the path was not). The pod step was by hand, a seed first and then two:
`pod.sh run <data> "NAME:microsoft/deberta-v3-small:SEED:--forms-most 18 --token-budget 4096"`. Give
`--token-budget 4096` whatever the card: a pod with a 24 GB card, left to the trainer's default, ran 100 minutes and
brought nothing home (why is not known; `pod.sh` now brings the runs' last log lines home when it finds the queue stopped).

### Round 2's results (2026-10-10)

Run folder: `runs/translator-round-2-2026-10-10/` (README, `STATUS`; `scores/groups-all.txt` has every table, old seed beside
new). Model: `pod-small-r2-s1` (`microsoft/deberta-v3-small`, seed 1's settings: `--forms-most 18 --token-budget 4096`), trained
on `runs/translator-model/data-19`, the export of `runs/translator-data-in-situ/joined-13`. **It does not pass**: 85% right on
the 180 real requests against 90%, wrong drafts 6.7% against 1%, held out 48 of 66.

**What the round found first** (`step1/`): of the 1,040 requests the last round dropped, 802 were of training pilots. Read by
cluster and a third time by `codex/gpt-6.1-sol`: 319 differed in copied free text alone, about 290 turned on rules the prompt
left open, about 80 were one reader's slip; the third reader agreed with one of the two on 401 and with neither on 400. Nine
rulings followed (docs/decisions.md, "The translator's prompt is 0.9.4"): prompt 0.9.4, and free text no longer compared
between readers or by the set scorer (`text_exact` is reported beside `passed`).

**What trained** (57,591 rows; 40,557 distinct examples):

| Source | Rows |
|---|---|
| The last round's set (joined-12), each in-situ example a ruling could touch checked under 0.9.4: 591 stand, 40 relabelled, 26 dropped, 3 set aside | 49,396 |
| The readers' former disagreements, read again under 0.9.4: 541 of 802 settle (481 train, four times; 58 to validation-real; 2 set aside) | 1,924 |
| w2-58, the 400-day council pilot (315 of 335 requests agreed; 257 train; 31 held back as a test) | 1,028 |
| Written in finance, bank, landlord and manager seats' situations under `writer-round3.txt` (728 of 828 agreed; 652 train, less 9 set aside) | 2,572 |
| Generated this round, the weak kinds (`wide/`: 3,014 kept of 3,277 briefs; 8 dropped for a source shared with the parity test; 376 to validation) | 2,675 |

Distinct examples, before and now: money 1,266 and 2,255 (from pilots 170 and 420), a payment with its report 0 and 53,
agreements 829 and 1,257 (from pilots 15 and 53), statements 1,795 and 2,141, forms 5,292 and 6,403, `per_request` 2 and 253,
asked by a banker 369 and 1,036. 14 single payments on a later day are set aside (docs/design/call-language-gaps.md B.9).
The closed set has 118 choices and lacks nothing; nothing that trains shares a source with the parity test, is in a test's
words, or comes from a test-only pilot.

**Who read what.** Under 0.9.3: sol read the 802, and every refusal example of the last round's pipelines (797: it read 38
otherwise, `too_much` 11 of 13). Under 0.9.4: Sonnet 5.5 read everything first; the second reader was sol for 390 of the 802 and
Opus 5.5 for the other 412 and for both new pipelines (1,163 requests), because the Codex window shut after about 2,300 requests
and reopened four hours later. So most of this round's new labels are two Claude readers'. Not read again under 0.9.4: 669
single forms and 622 `not_an_act` examples of the last round, and the 2,712 in-situ examples of pilots 7 to 10.

**Scores, last round's seed 1 beside the new seed, both scored the same day with the same code** (right; no draft, wrong):

| Test | `pod-small-w2-s1` | `pod-small-r2-s1` |
|---|---|---|
| Seen, the 99 of before | 81 (wrong 12) | 83 (wrong 9) |
| Seen, with the 17 cases of 0.9.4 | 89 of 116 | 95 of 116 |
| Held out (66) | 46 (11, 9) | 48 (10, 8) |
| The 180 real requests | 147 (20, 13) | 153 (15, 12) |
| Parity test (1,466) | 1,367 (47, 52) | 1,379 (33, 54) |
| Held-back seats' requests, wave 2 (148) | 128 (10, 10) | 136 (3, 9) |
| Held-back seats' requests, late pilots (61) | 56 (1, 4) | 56 (3, 2) |
| Held-back seats' requests, w2-58 (31; new this round) | 22 (4, 5) | 28 (2, 1) |
| Test-only pilots, seats' own (77) | 57 (10, 10) | 60 (7, 10) |
| Test-only pilots, seats' own, stage 2c (59) | 47 (7, 5) | 48 (1, 10) |
| Test-only pilots, written in their situations (187) | 161 (11, 15) | 162 (9, 16) |
| Test-only pilots, written in their situations, stage 2c (108) | 96 (8, 4) | 96 (6, 6) |

The scorer's change by itself moved the old seed little (held-back 122 to 128 of 148; parity 1,366 to 1,367). Of the new
seed's right answers on the set tests, the free text is the label's too in 96% (533 of 558 on the six pipeline-made files).

**By kind** (parity test, old then new): agreements 30 then 35 of 49 (wrong 14 both); forms 183 then 186 of 250 (asked back 40
then 31, wrong 27 then 33); money 48 then 50 of 50; standing payments 18 then 20 of 20. On the 180 real: statements 13 then 16
of 22, forms 24 then 27 of 31, holds 3 then 6 of 9, a form with a letter 11 then 9 of 13. On the test-only pilots' own requests:
money 0 of 7 both (2 then 5 wrong), work 2 then 5 of 8.

**By group** (groups of 20 or more): parity by asker, the banker 43 then 47 of 52 and no asker under 90% (one before); by way of
writing money, 4 then 1 under 90% (code only with no decimals, 26 then 25 of 31); by register, one under 90% both times (slips
112 then 115 of 126; now `named`, 48 of 54); by writer, the largest Claude model's forms 172 then 173 of 217. Held-back by
profile: au-vic 11 then 15 of 20, gap 40 then 25 points. Test pilots' own by seat model: gpt-6.1-sol 12 then 14 of 20.

**What it still lacks.** More data of the same kinds moved the scores a little and the pass mark not at all. (a) Forms of
several amounts written by the strongest writer: 1,096 more form examples changed 3 cases of 250; it now drafts where it asked
back, and is wrong as often as right when it does. (b) Agreements: 426 more, and the same 14 wrong drafts. Both point at what the
small reader can hold in one pass (many values of one type, nested calls), not at missing examples: the next experiment is the
reader, or how such programs are decoded, not another part. (c) Money in pilots it has not seen: 0 of 7. (d) Wrong drafts on
real requests are 12 of 180; they do not fall with data.

**The 27 real requests it still fails** (`scripts/real-errors.ts` in the run folder: ids, functions and argument names only).
Twelve wrong drafts: seven are the council's budget proposal form with an amount field left out or the amounts in each other's
fields (`staff`, `services`, `parks`, `environment`); four are a program of several lines written as one line (a second form, a
second letter, statements beside a form); one is a statement where nothing can be done. Fifteen with no draft: seven refused
`look_first` or `unclear` where one or several statements (withdrawals, holds, notices) were wanted; five gave another refusal
than the right one (`no_such_act` for `look_first`, `needs_calculation` or `not_an_act` for `no_such_act`); three refused where a
letter, or a payment with its report, was wanted. So the wrong drafts are two things, forms of several amounts and counting
lines, and neither is a kind the data lacks.

**Spend.** RunPod 0.55 USD of a limit of 2.00 (one pod, 87 minutes at 0.39; the provider lists none). Plan usage as Claude Code
reckons it: 115 USD (Opus 5.5 78: writing 54, reading 24; Sonnet 5.5 29; Haiku 5.5 at low effort 8), 53% of the last round's
216; Haiku at default effort was not used. Codex: about 2,300 requests read by gpt-6.1-sol in one window.

### Slot-by-slot decoding (2026-10-10)

A second way for the trained model to write a program (`translator/model/encode.ts`, "Slot by slot"; `py/slots.py`;
docs/decisions.md of the day): code lists what there is to decide (the kind of answer, the number of lines, each line's
function, then each slot once: a form's fields in its line's order, any other function's arguments in the contract's) and
the model decides each: left out, a closed-set value or a copied span. `export.ts <joined> <out> --decoding slots` writes
the data that way, `py/check_slots.py <out>` checks it against the trainer's rule, and a model's `config.json` says which
decoding it answers in. Tried once, against a control: `pod-small-slots-s1` (slot by slot) and `pod-small-steps6-s1` (the
earlier decoding), both on round 2's `joined-13`, six epochs, seed 1, scored the same day with the same code as
`pod-small-r2-s1` (four epochs). Everything is in `runs/translator-slot-decoding-2026-10-10/` on the run server.

| Test (right; no draft, wrong) | slot by slot | control, 6 epochs | `pod-small-r2-s1` |
|---|---|---|---|
| The 180 real requests | 147 (24, 9) | 150 (17, 13) | 153 (15, 12) |
| Held out, 66 | 49 (9, 8) | 50 (7, 9) | 48 (10, 8) |
| Seen, 116 | 99 (wrong 10) | 99 (wrong 10) | 95 (wrong 11) |
| Parity, 1,466 | 1,425 (6, 35) | 1,406 (15, 45) | 1,379 (33, 54) |
| Parity forms, 250 | 231 (2, 17) | 214 (14, 22) | 186 (31, 33) |
| Parity agreements, 49 | 37 (1, 11) | 36 (0, 13) | 35 (0, 14) |
| Held-back seats' requests: wave 2, 148; late, 61; w2-58, 31 | 136, 58, 28 | 134, 57, 28 | 136, 56, 28 |
| Test pilots' own: 77; late, 59 | 62, 52 | 60, 52 | 60, 48 |
| Test pilots' written: 187; late, 108 | 164, 101 | 168, 99 | 162, 96 |
| Mean time a request on the run server (the 362 fixed cases; the set files) | 60 ms; 67 ms | 67; 80 | 68; 93 |

**It did not do what it was built for on real requests.** The council's budget form with one amount: 1 of 5 (control 2,
last round 2); the model still leaves `staff` out, now by deciding the slot is left out instead of closing the form. Real
wrong form drafts 6 (control 7, last round 9; the mark was 3). Real programs of two lines 11 of 18 (control 12, last round
11), three or more 2 of 7 in all three: saying the number of lines first did not make it count them better. Agreements 37
of 49 (the mark was 42). On the 180 real it is the lowest of the three, by more refusals of its own at the first decision
(24 with no draft: all but four the model's own refusal, three the form check, one the cut-off), not by the cut-off.
**What it did do:** forms on the parity test, 231 of 250 against the control's 214, and every group of the parity test at
90% or more but agreements (currencies under 90%: 0 of 27, control 3, last round 7; ways of writing money 0, 1, 1; writers
0, 1, 2); and it never offered a form with a required field left out on the parity test (control 8 times, last round 14,
all wrongly), though 3 times on the 180 real, each wrongly (control 2). **And the longer schedule alone is most of the
parity gain**: the control has 27 of the 46 more parity cases, and 28 of the 45 more forms. One seed an arm: differences of
three cases in 180 or one in 66 are within what a seed moves (last round's two seeds differed by 6 on the 180).

**So:** six epochs is the schedule to keep. Slot-by-slot decoding is kept in the code as a second decoding and is not made
the default: it is better on generated forms and no better where it was meant to be. The failures it was aimed at are not
the decoder's shape: with no way to close early, the model chooses "left out" for the same field, and miscounts lines in the
same cases. That points back at what the model is taught about those requests (the label and the examples of a budget
proposal naming one head; acts with their reports as several lines), which was set aside for this experiment. Spend: 1.50
USD of a 3.00 limit (two pods, 119 and 109 minutes at 0.39; two that were ended in their first two minutes; the provider
lists none).

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
- A third reader to settle disagreements as a step of the pipeline (round 2 did it by hand: `runs/translator-round-2-2026-10-10/scripts/`; the label step still drops them).
- Choosing among the trained runs: the manifest lists them, and a person chooses.
