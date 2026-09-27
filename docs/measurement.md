# Running batches, measuring them, and what they cost

Measurement lives outside the world. The platform never judges outcomes: it writes logs, and everything here reads them. The tables are plain facts from the log (who did what, what happened, what it cost). The standing queries are descriptive counts and sums. What counts as good or bad is for the researcher to decide.

## Running a batch

```bash
terrarium run worlds/town-1000.yaml --seeds 5 --set mayor=llm --out runs/llm-mayor
```

(`terrarium` is `bun orchestrator/src/cli.ts`.)

- **Seeds vary a run's randomness, not the world.** A generated world is built once from its spec, and each run gets it with its own seed. To get a different town, set the spec's `seed`: `--set seed=7`.
- **Each seed runs in its own process**, with its own kernel, several at a time (`--parallel P`; the default is half the machine's cores). A run's result never depends on being in a batch: a test checks that a batch run's log and final state are identical to the same seed run alone.
- **`--set path=value`** changes the world file before it's generated or run. For example `--set citizens=500`, `--set mayor=llm`, or `--set orchestration.confirm=never` on an explicit config. Values are read as JSON where they can be.
- **`--until SECONDS`** stops runs early. `--no-measure` skips the measurement tables and the cost report.

A batch folder holds:

| File | What it is |
|---|---|
| `<run>.jsonl`, `<run>.anchors.jsonl` | Each run's hash-chained log and its anchors. `terrarium replay` checks them. |
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
| `records` | record, including the world's genesis records (`t` = 0) | `id`, `record`, `kind` (a statement's kind), `author` (a participant), `in_position` (the position it was made in, if any), `speaks_for`, `at`, `basis`, `place`, `template` (an agreement's), `withdraws`, `body` |
| `commands` | command (not observations) | `command`, `participant`, `as` (the position, if any), `body` |
| `acts` | act | `participant`, `as`, `via` (direct, call or translator), `blocks`, `reasoning`, `applied`, `action`, `refusal`, `refused_block`, `detail`, `blocks_json` |
| `messages` | message sent | `participant`, `as`, `to` (list), `text`, `re` |
| `annotations` | annotation other than usage and transcripts | `annotation`, `subject`, `body` |
| `usage` | model call | `purpose`, `subject`, `provider`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_microusd` |
| `transcripts` | model call | `subject`, `purpose`, `data` (what was sent and what came back) |

Every table has `run_id`, and every per-entry table also has `seq` and `t`.

## Queries

```bash
terrarium measure runs/llm-mayor --list
terrarium measure runs/llm-mayor town/economy town/word-of-mouth
terrarium measure runs/llm-mayor --sql "select run_id, count(*) from acts where via = 'translator' group by all"
```

The standing queries live in `measure/queries/`, one SQL file each, with a one-line description on the first line. Add a file and it's listed.
- **Generic:** `overview`, `activity`, `refusals`, `usage`, `language-participants`, `cast` (people at the start, births, arrivals, departures, deaths by cause, illness, injury, harm, participants created, appointments).
- **About the generated town:** `town/economy`, `town/word-of-mouth`. These know the town's vocabulary (leases, `acc-city`, the citizens' own phrasing), which is fine: measurement is outside the world.

From TypeScript: `exportLogs`, `open`, `query`, `runQuery` and `table` in `@terrarium/measure`.

## The cost report

Every model call leaves a usage annotation in the log: tokens, and the cost at the price of the model that actually answered. The report (`terrarium cost <dir>`, also written with every batch) shows two figures and never mixes them:

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
