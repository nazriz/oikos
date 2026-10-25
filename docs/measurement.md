# Running batches, measuring them, and what they cost

Measurement lives outside the world. The platform never judges outcomes: it writes logs, and everything here reads them. The tables are plain facts from the log (who did what, what happened, what it cost). The standing queries are descriptive counts and sums. What counts as good or bad is for the researcher to decide.

## Running a batch

```bash
oikos run worlds/town-1000.yaml --seeds 5 --set mayor=llm --out runs/llm-mayor
```

(`oikos` is `bun orchestrator/src/cli.ts`.)

- **Two seeds, two different things.** The *town's seed* is the spec's `seed`: what the generator draws the town from (who lives there, how old, where, which firms). The *run's seed* is what the kernel's randomness starts from: what happens in a town once drawn. `--seeds N` runs **one town N times** (the town generated once, from the spec's seed; the runs' seeds that seed and the N - 1 after it). `--towns T` runs **T different towns** (generated from the spec's seed and the T - 1 after it), each `--seeds` times (once, if not given), a town's runs seeded from its own seed: `--towns 3` is three towns once each, `--towns 3 --seeds 2` six runs, named `<world>.town<S>.seed<N>`. One town alone from another seed: `--set seed=7`, which is the run town 7 of a `--towns` batch makes. A claim about towns in general needs `--towns`; `--seeds` says how much one town varies from run to run. `batch.json` records both (`towns`, `runs_per_town`, each run's `town`), and `oikos diff` and `oikos health` begin by saying how many runs of how many towns they read (told from the tables: who was there at the start).
- **Each run is in its own process**, with its own kernel, several at a time (`--parallel P`; the default is half the machine's cores). A run's result never depends on being in a batch: a test checks that a batch run's log and final state are identical to the same seed run alone.
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
| `figures.txt`, `figures.json` | What the world's numbers rest on: how many are sourced, to confirm, derived, fitted, placeholders, conventions or unbased, and where the unbased are (`oikos figures <world>`; docs/design/foundations-2.md, law 11; PS-1). Counting only: never in the log. |

## Measurement tables

Each run's log is exported to Parquet, one file per table per run (`measure/<table>/<run>.parquet`). A batch is just a folder, and DuckDB reads every run in it together. Exporting a 2-year, 1,000-citizen log (about 720,000 entries) takes about a second.

**Reading a log with a very large first line.** A log's first line is the config header, which holds the whole world: 36 MB for a 3,000-person town, 123 MB for 10,000. DuckDB's JSON reader refuses a line over its `maximum_object_size` (16 MB by default), so the export sizes that limit from the log's own first line (streamed and counted, plain or `.zst`; twice its length, rounded up to a power of two; never below the default). The header is read in place by DuckDB, not taken out and handed over separately, because nine tables unnest parts of the config. The price is time and memory in proportion to the header: a 3,000-person, 180-day all-code log (620 MB compressed) is measured in about a minute using about 5.7 GB; a tiny log with a 123 MB header takes 19 s and 2 GB. If a header ever grows past what a machine holds, read the header apart (once, into a small table of its parts) and give the tables that. A run whose measuring fails leaves `measure-failed.txt` in its folder, and the pilot queue says so instead of reporting it simply done (status log, alerts, `oikos pilot-report`, `pilot-wave status`).

| Table | One row per | Columns |
|---|---|---|
| `runs` | run | `run_id`, `seed`, `world`, `contracts`, `config_hash`, `kernel_version`, `kernel_build`, `run_seconds`, `currency` and `minor_units` (the world's money: its code, and the decimal places of the smallest unit every amount is counted in), `end_reason`, `end_t`, `state_hash`, `entries`, `orchestrator_version` |
| `participants` | participant: the world config's (`created_t` = 0) and those created during the run from a template | `participant`, `kind` (person or system), `person`, `owner`, `title`, `template`, `created_t`, `created_seq`, `controller` (code or llm), `impl`, `model`, `adapter` (what actually answered), `configured` (the model the world names) |
| `entities` | entity: the world config's (`created_t` = 0) and those created or born during the run | `entity`, `kind`, `name`, `born_at` (people), `parents` (the newborn), `created_t` |
| `positions` | position: the world config's (`created_t` = 0) and those created during the run | `position`, `entity` (the organisation), `title`, `role`, `role_module` (the code module a code holder runs), `created_t` |
| `appointments` | the world config's holders (`t` = 0, `by` = genesis), then every appointment | `position`, `holder` (null: left vacant), `by` (the participant who appointed, or null when it fell vacant because its holder ended) |
| `life` | a body's coming, going and health | `event` (person_created, person_arrived, person_left, person_died, birth_started, condition_began, condition_ended, harmed), `person`, `by`, `detail` (the cause of death, or illness or injury), `severity`, `condition`, `until`, `parents` |
| `events` | kernel event | `seq`, `t`, `event`, `cause` (the command's seq), `body` (JSON) |
| `transfers` | money movement | `from`, `to`, `amount` (in the currency's smallest unit: `runs.minor_units`), `reason`, `by`, `settles`, `per_instruction`, `memo` |
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
- **About the generated town:** `town/economy`, `town/word-of-mouth`, `town/households` (at the end of each run: households living together, apart or unhoused, and overcrowded two ways: by the town's own occupancy standard, `overcrowded`, and by one yardstick that is the same for every place, more than three people to a room, `over_three_a_room`: docs/behaviour/households.md), `town/rent-stress` (rent against household income). Calibration targets and their sources: [calibration.md](calibration.md). These know the town's vocabulary (leases, `acc-city`, the citizens' own phrasing), which is fine: measurement is outside the world.

From TypeScript: `exportLogs`, `open`, `query`, `runQuery` and `table` in `@oikos/measure`.

## Frictions, venues and job mobility (2026-10-11)

- **`town/frictions`:** the papers grievances travelled on in the last 12 months, by paper and matter, as a count and for every 1,000 adults: requests to the other side, its answers (yes or no), applications by venue, decisions by venue and finding, enforcement asked, repairs ordered and done, and support claims granted and refused (docs/behaviour/frictions.md). What arose and how each ended is in people's records, so in `oikos dataset` (`frictions.jsonl`, `venues.jsonl`, the manifest's `frictions`), from lean logs too. Nothing is scored.
- **`town/founding`:** what people founded in the run (each has a statement of purpose made in it), and how many of those had words from the composing model; people who joined one and memberships made; the gathering notices and hearings put up; those that wound up; hall bookings; a fund's draws asked and paid. Counted; nothing is scored (docs/behaviour/founding.md). `town/economy`'s move-ins leave out first comers to a home after a gathering was put up there: they came to the gathering.
- **`economy/job-mobility`:** of people in a job at the end, the share who were in a job with another employer at some time in the last 12 months (a labour force survey's job mobility: whoever ended the old job).
- **`economy/separations`:** jobs ended in the last 12 months, by who ended them and why, as the notice on the agreement says: redundancies (no trade or work, over stock, cannot pay, closing), resignations (to another job, leaving town, retiring, unpaid), deaths; redundancies and moves to another job as shares of those in a job at the end. A count of notices (docs/behaviour/firms.md, "Adjusting labour").
- **`economy/businesses`:** the businesses there were a year before the end, births and deaths in the year (and of them, businesses of one), and both as shares (docs/behaviour/entry.md, "Starting a business of one").
- **`town/possession`:** notices to vacate, those lapsed by payment, applications for possession, orders by finding, warrants asked for, issued, carried out and lapsed, and applications and evictions carried out for every 1,000 renting households, and (2026-10-13) `left_on_order`: tenants who left on the tribunal's order with no warrant carried out on the home first (docs/behaviour/justice.md, "Possession").
- **`economy/summary`'s labour force** now leaves out whoever last noted that they are no longer looking for work (`work_search`, a person's own note in a living town), as a survey counts someone not looking.
- **`scripts/record-sizes.ts LOG`:** the sizes of people's and organisations' records at each year's end against the cap.

## Employment (2026-10-09)

**The definition.** `economy/summary` counts as employed what a labour force survey counts: someone of 18 or more, in town at the run's end, who in the reference week (the run's last seven days) did at least an hour of work for pay or profit, or has a job they were not at work in. That is the ILO's: "all those of working age who, during a short reference period, were engaged in any activity to produce goods or provide services for pay or profit", being "at work, i.e. who worked in a job for at least one hour" or "not at work due to temporary absence from a job" (19th ICLS resolution, 2013, as reprinted in the 21st ICLS amending resolution; docs/research/references.md). Read from the log as:

- **work done:** the person's share of each piece of work that took time (`worked` events naming them as a performer; the time split evenly among the performers, as the kernel splits it), an hour or more over the week;
- **or a job held:** an employment agreement they signed with no notice on it (absent from it or not: ill, on strike, a day with no work for a hand by the day);
- **or a business of their own in being** (the one a person working for themself was given at the start, unless it has said it is closing): the own-account worker's job, in a week without a sale.

`employment_to_population_pct` and `unemployment_pct` follow from it; the labour force is unchanged (those looking who have not stopped).

**The old series, kept.** Until 2026-10-09 employed meant the second line alone. It is still there under names of its own, so earlier runs compare: `employed_by_agreement`, `employment_by_agreement_pct`, `unemployment_by_agreement_pct`. For a town with no informal work the two differ by the few people working out a notice, who are at work and whom the old series dropped (the first profile's 1,000-person month: 427 against 424).

**`economy/work`**: the employed by how they work: employees, own-account workers, employees by the day, employees in jobs their employer has not registered; and informal employment as a share of the employed (own-account workers, whose businesses of one are all unregistered here, and employees in unregistered jobs: the 17th ICLS's informal jobs, less contributing family workers and employers, whom the town does not have). The unregistered jobs are counted from each employer's own note. Measurement reads the log from outside the world; nobody in it is shown this (docs/no-god-view.md).

**`economy/public-money`**: wages paid, what businesses of one paid their owners, what employers paid over of what they withheld (by payee), and what the outside world's accounts paid to people (by account, and to how many).

**What each profile's town can be checked against** (each a target in the profile, measured, never set; "(to confirm)" where the source was not opened by the profile's author or for this work):

| Profile | Target | Source |
|---|---|---|
| ke-nakuru-2026 | informal share of employment about 84% (the profile's own target, from KNBS); 86.5% by the ILO's definition, 2019 | KNBS Economic Survey 2026 via the press (to confirm); ILOSTAT, informal employment rate (opened) |
| in-tn-2026 | 87.2% national, 2025 (with farming); urban Tamil Nadu: self-employed 29.3%, casual labour 17.8% of workers | ILOSTAT (opened); PLFS annual report 2023-24, table 19 (opened) |
| br-mg-2026 | 36.5%, Minas Gerais, second quarter 2026 | IBGE, PNAD Contínua, SIDRA table 8529 (opened) |
| mx-jal-2026 | 46.5%, Jalisco, second quarter 2026 (TIL1) | INEGI, ENOE, Jalisco bulletin of August 2026 (opened) |
| au-vic-2026, de-ni-2026, gb-eng-2026, jp-akita-2026, us-oh-2026 | none stated: their towns have no informal work, and the measure reads 0 | to source: each national labour force survey's own-account share, and ILOSTAT's informal employment rate where it publishes one |

A town will read below a national target that counts farming households and unpaid family workers, and below any target by the share of own-account work it cannot hold yet (docs/behaviour/entry.md).

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
