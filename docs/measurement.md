# Running batches, measuring them, and what they cost

Measurement lives outside the world. The platform never judges outcomes: it writes logs, and everything here reads them. The tables are plain facts from the log (who did what, what happened, what it cost). The standing queries are descriptive counts and sums. What counts as good or bad is for the researcher to decide.

## Running a batch

```bash
oikos run worlds/town-1000.yaml --seeds 5 --set mayor=llm --out runs/llm-mayor
```

(`oikos` is `bun orchestrator/src/cli.ts`.)

- **Seeds vary a run's randomness, not the world.** A generated world is built once from its spec, and each run gets it with its own seed. To get a different town, set the spec's `seed`: `--set seed=7`.
- **Each seed runs in its own process**, with its own kernel, several at a time (`--parallel P`; the default is half the machine's cores). A run's result never depends on being in a batch: a test checks that a batch run's log and final state are identical to the same seed run alone.
- **`--set path=value`** changes the world file before it's generated or run. For example `--set citizens=500`, `--set mayor=llm`, or `--set orchestration.confirm=never` on an explicit config. Values are read as JSON where they can be.
- **`--until SECONDS`** stops runs early. `--no-measure` skips the measurement tables and the cost report.

A batch folder holds:

| File | What it is |
|---|---|
| `<run>.jsonl`, `<run>.anchors.jsonl` | Each run's hash-chained log and its anchors. `oikos replay` checks them. |
| `<run>.summary.json` | The run's counts and final state hash, and how long it took (wall-clock time is recorded here, never in the log). |
| `batch.json` | What ran: the world file, the overrides, the generated spec and generator version, seeds, versions, timings, and each run's final state hash. |
| `measure/` | The measurement tables (below). |
| `cost.txt`, `cost.json` | The cost report (below). |

## Measurement tables

Each run's log is exported to Parquet, one file per table per run (`measure/<table>/<run>.parquet`). A batch is just a folder, and DuckDB reads every run in it together. Exporting a 2-year, 1,000-citizen log (about 720,000 entries) takes about a second.

| Table | One row per | Columns |
|---|---|---|
| `runs` | run | `run_id`, `seed`, `world`, `contracts`, `config_hash`, `kernel_version`, `kernel_build`, `run_seconds`, `end_reason`, `end_t`, `state_hash`, `entries`, `orchestrator_version` |
| `participants` | participant: the world config's (`created_t` = 0) and those created during the run from a template | `participant`, `kind` (person or system), `person`, `owner`, `title`, `template`, `created_t`, `created_seq`, `controller` (code or llm), `impl`, `model`, `adapter` (what actually answered), `configured` (the model the world names) |
| `entities` | entity: the world config's (`created_t` = 0) and those created or born during the run | `entity`, `kind`, `name`, `born_at` (people), `parents` (the newborn), `created_t` |
| `positions` | position: the world config's (`created_t` = 0) and those created during the run | `position`, `entity` (the organisation), `title`, `role`, `role_module` (the code module a code holder runs), `created_t` |
| `appointments` | the world config's holders (`t` = 0, `by` = genesis), then every appointment | `position`, `holder` (null: left vacant), `by` (the participant who appointed, or null when it fell vacant because its holder ended) |
| `life` | a body's coming, going and health | `event` (person_created, person_arrived, person_left, person_died, birth_started, condition_began, condition_ended, harmed), `person`, `by`, `detail` (the cause of death, or illness or injury), `severity`, `condition`, `until`, `parents` |
| `events` | kernel event | `seq`, `t`, `event`, `cause` (the command's seq), `body` (JSON) |
| `transfers` | money movement | `from`, `to`, `amount` (cents), `reason`, `by`, `settles`, `per_instruction`, `memo` |
| `occupancy` | a body going into or out of a space, including the world's starting occupancy (`t` = 0, `by` = genesis) | `event` (occupied or vacated), `occupant` (a person), `space`, `structure` and `space_kind` (split out of the space id, `<structure>/<kind>.<n>`), `reason` (a departure's: departed, died, evicted…), `by` |
| `spaces` | space in a building, the world's and those built during the run (`built_t`) | `space`, `structure`, `type`, `kind`, `capacity`, `bedrooms` (a dwelling's, from its attributes), `attrs` |
| `records` | record, including the world's genesis records (`t` = 0) | `id`, `record`, `kind` (a statement's kind), `author` (a participant), `in_position` (the position it was made in, if any), `speaks_for`, `at`, `basis` (the record it rests on; of several, the one cited first), `bases` (all of them, a list in the order cited; empty where it cites nothing), `place`, `template` (an agreement's), `withdraws`, `body` |
| `commands` | command (not observations) | `command`, `participant`, `as` (the position, if any), `body` |
| `acts` | act | `participant`, `as`, `via` (direct, call or translator), `blocks`, `reasoning`, `applied`, `action`, `refusal`, `refused_block`, `detail`, `blocks_json` |
| `messages` | message sent | `participant`, `as`, `to` (list), `text`, `re` |
| `annotations` | annotation other than usage and transcripts | `annotation`, `subject`, `body` |
| `usage` | model call | `purpose`, `subject`, `provider`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_microusd` |
| `transcripts` | model call | `subject`, `purpose`, `data` (what was sent and what came back) |

Every table has `run_id`, and every per-entry table also has `seq` and `t`.

## Queries

```bash
oikos measure runs/llm-mayor --list
oikos measure runs/llm-mayor town/economy town/word-of-mouth
oikos measure runs/llm-mayor --sql "select run_id, count(*) from acts where via = 'translator' group by all"
```

The standing queries live in `measure/queries/`, one SQL file each, with a one-line description on the first line. Add a file and it's listed.
- **Generic:** `overview`, `activity`, `refusals`, `usage`, `why` (acts with a reason, and records citing a basis), `language-participants`, `cast` (people at the start, births, arrivals, departures, deaths by cause, illness, injury, harm, participants created, appointments).
- **About the generated town:** `town/economy`, `town/word-of-mouth`, `town/households` (at the end of each run: households living together, apart or unhoused, and overcrowded by the occupancy standard, CNOS), `town/rent-stress` (rent against household income). Calibration targets and their sources: [calibration.md](calibration.md). These know the town's vocabulary (leases, `acc-city`, the citizens' own phrasing), which is fine: measurement is outside the world.

From TypeScript: `exportLogs`, `open`, `query`, `runQuery` and `table` in `@oikos/measure`.

## Health and diff

- **`oikos health <DIR> [--profile NAME]`:** the batch's measures against its profile's calibration targets (`targets` in worlds/profiles/), each within a tolerance stated in `measure/src/health.ts`, breaches first; targets nothing measures yet are listed as such; and the demand households went without.
- **`oikos diff <BASELINE> <CHANGE> [QUERY...]`:** every measure of two batches of the same world compared. With several seeds a side, a difference is flagged beyond three standard errors of the seed-to-seed spread; with one, beyond a tenth. The default measures are the town's calibration measures (`DIFF_QUERIES`).

## The cost report

Every model call leaves a usage annotation in the log: tokens, and the cost at the price of the model that actually answered. The report (`oikos cost <dir>`, also written with every batch) shows two figures and never mixes them:

- **Recorded:** what was actually spent. On the mock adapter that's $0.00.
- **Projected:** what the same calls would have cost if each had gone to its participant's configured model, at published prices (`orchestrator/prices.json`, with its source and the date it was retrieved). The translator's model isn't set by the world, so it's priced as the participants' model, or as `--translator-model`.

While participants run on the mock, the projection is an order of magnitude, not a budget. The report says why:
- the token counts are estimates (about 4 characters a token);
- a real model's replies are longer (it also writes its reasoning);
- how often a participant acts comes from the mock's code brain;
- no prompt caching is assumed.

## First batches (2026-09-27; generator 0.8.0, citizen 0.6.0)

Two batches: `town-1000.yaml`, five seeds, two years each.

**Timing:** about 2 minutes each, with five runs in parallel on 10 cores. A single log replays byte-identically in about 34 s.

**Housing:**
- Leases signed: 971 to 1,001 per run.
- People moving away: 229 to 245.
- That's expected: housing is tight by design, with 875 homes for 1,000 people.

**Civic life:**
- Petitions started: 2 to 4 per run.
- Laws passed: 0 to 2 per run.

**Refusals:** 0 to 3 per run. All were a new tenant moving in before the previous tenant had physically left, then trying again. A real collision, not a bug.

**The mock-LLM mayor:**
- About 11 drafts per run, all confirmed.
- No failed translations.
- Projected cost at Sonnet 5 prices: about $0.70 per run.

## The translator corpus

Every run with language-model participants is also training data for the translator. The log keeps all of it: the participant's proposal; the translator's exchange, turn by turn (its transcripts carry the draft they were for, `data.ref`, and the system prompt is logged in full once, then by hash); the call it wrote, what that resolved to and the kernel's dry run (the `draft` annotation); retries and failures, with the model's raw answer (never cut short); the participant's decision (`signoff`); and, if it was carried out, whether the kernel applied it (the command's `provenance.draft` and its events).

`oikos corpus <DIR|log.jsonl> [--out FILE]` joins these into one JSON line per translation (`orchestrator/src/corpus.ts`), by default `DIR/translator-corpus.jsonl`. Examples from the mock are marked `synthetic`: only real models' are fit to train on. `orchestrator/test/corpus.test.ts` checks every translation reads back whole.

`oikos dataset` (docs/design/run-datasets.md) goes further: a versioned folder per run, with a manifest, the translations, the model participants' decisions, and optionally the code participants' acts and recorded observations.

**Keep every real-model run.** Its log is the only source of this data, and a real model's answers can't be made again. Never delete a language-model run's folder (or its log) to free space.

## The translator's training data: how requests are written and checked

The local translation model is trained on pairs of a request in plain words and the program it becomes (`translator/train/data.ts`, `orchestrator/src/training.ts`; docs/design/translator-and-resolver.md §16.4). The programs come from logs, the seen test cases and a generator; the requests are written for them. Who is asked for what, in which style, is one plan (`planOf`), the same for the same sources, options and seed, whichever way the requests are then written:

1. **By a model through an adapter.** `oikos translator-data <LOG|DIR>... --model provider/model [--model ...] [--back-model ...] --out DIR` sends each item's brief to a model, checks what comes back mechanically (every value of the program copied exactly and found outside the riders, the riders there as given, reading as a person and not as the call, not said before, no wording shared with a held-out case), and, with `--back-model`, has a model that didn't write it translate it back through the translator.
2. **By file**, where no model can be reached that way. `oikos translator-data <LOG|DIR>... --briefs [--writers a,b,c] --out DIR` (the same sources, `--shard I/N`, `--seed` and floors, no model) writes `DIR/plan.json`, `DIR/briefs.jsonl` (a line per item, `{id, kind, brief}`: the brief is exactly the message a model would be sent; `kind` is `request` or `refusal`, which says which instructions apply) and `DIR/writer-instructions.txt`. With `--writers` the items are dealt in turn into `DIR/briefs-<name>.jsonl`. A writer hands back `requests.jsonl`, a line of `{"id": …, "request": …}` per brief. `oikos translator-data-write DIR --requests FILE --writer NAME [--requests FILE --writer NAME ...]` runs the same mechanical checks and writes the same folder a model run writes (`examples.jsonl`, `rejects.jsonl`, `blind.jsonl`, `manifest.json`), with how many planned items had no request. Files may each cover part of the plan; an id written twice keeps the first. Nothing is translated back here.
3. **The blind check**, for both. `oikos translator-data-check DIR --blind` writes the requests and forms alone, shuffled (`blind.jsonl`; writing the data writes it too); a reader of another model family than the writer answers with the program each asks for (`{id, program}` lines); `oikos translator-data-check DIR --answers FILE --reader NAME` compares them with the gold programs by meaning and writes `checked.jsonl`, `disagreed.jsonl` and the counts into the manifest.

A briefs line marked `spare` is a refusal asked for ahead of need: it is used only if earlier ones of its label fail a check and leave the label short of its floor. `--no-spares` leaves these out of the briefs files (about a fifth of a part's briefs at a refusal floor of 12); a label that then comes out short is named in the manifest (`short_of_floor`).
