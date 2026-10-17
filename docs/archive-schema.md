# The archive of past model runs (schema 1.0.0)

Written by `scripts/extract-archive.ts` into `runs/archive-2026-10-17/` (a copy of this file is there as `SCHEMA.md`).
Why: the platform is being rebuilt and its log format will change; real-model runs cannot be made again. This is what is
worth keeping from them, in a form that needs neither the old logs nor the old readers. It is read-only data: the runs
folder is never altered, and nothing in the archive is a replacement for a raw log until Naz has checked it and
confirmed each retirement.

## Format

- One JSON object a line (JSONL), UTF-8, every file compressed with zstd (`*.jsonl.zst`; `zstd -dc FILE`, or
  `zlib.zstdDecompressSync` in Bun or Node). The window is 2^27 at most, so the stock `zstd` reads it.
- Every row has `schema` (`<kind>/<version>`, the row's kind and its version, `1` for this release). A change that
  removes or renames a field raises the version of its kind and the archive's version (`manifest/totals.json`).
- Times are the old worlds' seconds from the start of the run (`t`); `day` is `floor(t / 86400)` from 0.
- Money is integer cents wherever a row says an amount in the world's currency, and integer microusd (`cost_microusd`)
  for what a model call cost.
- Run-derived kinds are one file a run, `<kind>/<run_key>.jsonl.zst`. The `run_key` is the log's folder (from `runs/`) and
  its name with every run of characters other than letters, digits, `.`, `_` and `-` replaced by `__`
  (`lv-05__town-3000.seed402`). `run` is the log's own id (`town-3000.seed402`), `run_key` is unique.
- A file that exists is whole (it is written aside and renamed). A run with no row of a kind has no file of it.

## Layout

```
SCHEMA.md  RESTRICTIONS.txt
seat_requests/<run_key>.jsonl.zst   1. every request a seat made in its own words
situations/<run_key>.jsonl.zst         what the seat had read (compact), by id
systems/<run_key>.jsonl.zst            system prompts, by sha256 of their text
transcripts/<run_key>.jsonl.zst     4. every model call, compactly: turns, tokens, cost (and the model's words, see below)
notebooks/<run_key>.jsonl.zst       4. a seat's notebook each time it changed
debriefs/<run_key>.jsonl.zst        3. published debrief answers only
exit_accounts/<run_key>.jsonl.zst      the exit accounts (a model writing as a person), where the run had them
translator/examples.jsonl.zst       2. the translator's examples, all runs, deduplicated
translator/rejects.jsonl.zst           what two readers disagreed on, with both answers
translator/cases.jsonl.zst             the repository's real test cases and seen evaluation cases, with their keys
translator/eval_results.jsonl.zst      models' answers to the seen cases (a held-out result is dropped, never read)
findings/findings.jsonl.zst         5. pilot reviews, STATUS and notes, decisions-log entries naming runs
manifest/runs.jsonl.zst             6. per log: classification, what was extracted, counts, sizes, what was not
manifest/totals.json                   archive-wide counts and sizes; manifest/verification.json: the checks
```

## 1. `seat_request/1`

One row for every request a model seat made through `do`, in its own words, and one for every translation the log holds
that no seat turn accounts for (`situation_id` null). Joined: what it read, the draft offered, the seat's answer, the
call carried out, the outcome.

| field | meaning |
|---|---|
| `run_key`, `run`, `seat`, `office`, `model` | where it came from; `office` is the post the seat spoke as (`as`); `model` is the seat's `provider/model` |
| `day`, `t`, `turn` | the day of the run, the draft's time, the turn of the sitting |
| `situation_id` | id of the row in `situations/` of the same run (what the seat had read); null if none |
| `request` | the seat's words, exactly |
| `forms` | the forms the translator was shown with it (each as a line of the form it is shown); absent if not recoverable |
| `draft_id` | the draft's id in the old log; null: the request was never taken up |
| `translation` | null if never taken up; else `translator_model`, `translator_version`, `system_id` (row of `systems/`), `route` (where two translators answered as one: which, why, what each said; the forms list left out), `exchange` (turn by turn, what the translator was shown and said), `retries`, `result` (`drafted` or `failed`), `call` (the call language program), `summary` (the plain-words account the seat was shown), `check` (the kernel's dry run), `failure` (reason and the model's raw answer, if it failed). The resolved `blocks` are not kept (they are in the old log's terms) |
| `decision`, `decision_note` | the seat's answer to the draft: `accept`, `reject`, `unanswered` (the run ended first), or null |
| `executed` | null, or `{applied, refusal?}`: whether the kernel applied the act |
| `outcome` | one of `applied`, `refused_by_kernel`, `declined`, `unanswered`, `translation_failed`, `accepted_not_carried_out`, `drafted_only`, `not_taken_up` |
| `test_case` | one of the real test cases of `translator/eval/pilot-cases.ts` (found by its draft, or by its words) |
| `test_like` | begins (first 60 characters) as a real test case does |
| `test_seat_day` | the seat's day contains a real test case, or quotes one (the rule `oikos in-situ` uses), or is one a case comes from |
| `exclude_from_training` | `test_case or test_like or test_seat_day`. **A training set must drop every row where it is true** |

## `situation/1`

What a seat read at one model turn of a run: `id` (`<folder>/<seat>/d<day>/<n>`), `seat`, `day`, `n` (the turn's number
that day), `turn` (the turn within its sitting), `model`, `system_id`, `shown` (the sitting so far, as text: what it was first
shown, then, turn by turn, what it did and what came back), `forms`, `currency` (how the world writes money), `partial`
(earlier turns of the sitting are not in the log), `test` (a real test case was asked in the sitting, or is quoted in
`shown`: not for training).

## 4. `transcript/1`

One row for every call a real model made in the run (the mock's calls are counted in the manifest and not written).
`purpose` is `participant` (a seat's turn), `translator`, `debrief`, `compose` (a model asked as an author in the town),
`notebook` (a seat's notes folded), `account` (an exit account). Fields: `seq` and `t`, `day`, `seat` (the subject),
`model`, `turn`, `draft_id` (for a translator call), `situation_id` (for a seat's turn), `system_sha256`, `input_chars`,
`tokens` = `{input, output, cache_read, cache_write, cost_microusd}`.

Content: `output` (the model's blocks: text, tool uses) is kept in full for `participant`, `compose`, `notebook` and `account`;
`input` too for the last three (a seat's input is `situation.shown`). A translator call's content is in the
`translation.exchange` of its request. **A debrief call's content is never in a transcript** (`output_omitted` says why);
its words are in `debriefs/` or are kept back.

## `notebook/1`

A seat's notebook (the text it is shown at the top of what it reads) each time it differs from the last: `run_key`, `run`,
`t`, `day`, `seat`, `model`, `situation_id`, `notebook`.

## 3. `debrief/1` and `exit_account/1`

`debriefs/` has what `oikos dataset` calls `debriefs.jsonl`: one row a question: `run`, `seat`, `title`, `model`,
`script`, `wording`, `variant`, `framing`, `setting`, `ended`, `step`, `question`, `answer` (or `values`, `declined`, `unread`),
`more`, `beside` (ids the account can be set beside). **A step the seat asked to keep back is a row that says
`kept_back: true` and holds nothing else; the answer is not in the archive.** A debrief of the older kind (before script
0.1.0: asked with nothing said of publication) is treated as kept back wholesale. The counts of what was kept back are
in the manifest, not the words.

`exit_accounts/` has the exit accounts as `accountRows` writes them (`person`, `participant`, `strata`, `dark`, `account`,
`views`, `record_changes`...): short pieces written by a model, in a person's voice, beside that person's own views.

## Restrictions

Debrief answers and exit accounts are welfare evidence (VISION section 15; `docs/behaviour/debrief.md`). They are never
training data to make a model say that taking part was fine, and no training export of this archive includes
`debriefs/`, `exit_accounts/`, or the content of a `debrief` transcript. The real test cases (`exclude_from_training`)
and the held-out cases (not in this archive at all) are never training data.

## 2. `translator_example/1`

Every example the translator was ever trained, validated or tested on that is on disk, from every folder of the runs
folder whose files have the shape (a first row with `request` and `program` or `gold`), deduplicated by `key` =
sha256 of the request, the forms shown, and the answer. Folders that are test scratch (`runs/test-*`), run datasets
and measure folders are not read.

| field | meaning |
|---|---|
| `key`, `request`, `forms`, `program`, `gold` | the example: the words, the forms the translator is shown, the call language answer (`gold` as keyed; `program` as the example's own) |
| `kind` (`positive`, `refusal`...), `shape`, `style`, `spans` | as the pipeline labelled it |
| `origin` | `synthetic`, `log`, `pilot`, `written`...: where the request came from |
| `written_by`, `verified_by` | who wrote the request, who read it (the readers that agreed) |
| `source` | the pilot, seat, day and turn it was taken from, or `synthetic: <shape>` |
| `currency` | how its world writes money |
| `ids`, `files`, `occurrences` | ids it carried (up to 20), the files it appeared in (up to 40, relative to `runs/`), how many times in all (training repeats it) |
| `splits`, `split`, `ever_in_train` | every split a file put it in; the one that counts first in the order `real_test`, `test`, `held_back`, `validation_real`, `validation`, `train`, `pool` (`pool`: an unsplit file of examples); whether any file trained on it |
| `real_test_case`, `test_like`, `test_seat_day`, `exclude_from_training` | as for a seat request; derived from `source` and the ids |

`rejects` rows: `key`, `request`, `why` (`not_encodable`, `readers_disagree`...), `detail`, `answers` (each reader's
program), `ids`, `from`, `files`, `occurrences`. `cases` rows: the repository's `PILOT_CASES` (`set: real`, flagged) and
`CASES` (`set: seen`) with `expect`, the right answers as the repository keys them. `eval_results`: `file`, `model`, `id`,
`pass`, `got`, `expect`; a result whose `held_out` is true is dropped when read and counted in the manifest.

## 5. `finding/1`

`kind` (`pilot_review`: a `runs/pilot-queues/*.review.md` section; `run_status`: a run folder's `STATUS`;
`run_note`: `PILOT.txt`, `NOTE`, `README`; `review_document`: a review or bug-hunt file in `runs/`; `decision`: a
`docs/decisions.md` entry that names a run), `source` (path from the repository or `runs/`), `line`, `heading`, `text`,
and `cites`: the run folders (and `folder/subfolder` names) the text names, matched as whole names, so a finding is
linked to the runs it cites (join to `manifest/runs.jsonl.zst` on `folder`).

## 6. `manifest_run/1`

One row for every log found under `runs/`: `log`, `folder`, `run_id`, `raw_log_bytes`, `classification` (`model`;
`code-only`: no model's answer, the log can be made again from git and the seed; `duplicate`: a copy of another log;
`stopped`: history of a resumed run, its answers are in the resumed log; `not-a-log`), `why`, `copy_of`, `extracted`
(the counts per kind, the test cases found and missing, the sizes of each shard, the run's seats and models, the seconds
it took) and `not_extracted` (what was not and why).

## Not in the archive

The citizen towns themselves (code citizens' decisions, records, the kernel's events: they are made again from the seed
and the code, and the new world is its own); the resolved `blocks` of a draft; raw reader and writer call files of the
translator pipelines (their products, the examples and rejects, are); score files that measure a model (they are made
again from the model and the examples); training exports (`data-N/train.jsonl`, the tokenised steps, derived from the
examples); model weights; any held-out case. The manifest lists, per run, what could not be read and why.
