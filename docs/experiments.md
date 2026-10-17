# Experiments: the same town, different stewards

The harness (`orchestrator/src/experiment.ts`, `oikos experiment`) answers one kind of question: *the same town, the
same seed, the same post, a different steward: what differs afterwards?* The owner's TARA project needs it: the same
benefits office or tribunal held by different models, against the post's own code as the control.

An experiment is:

- a **town** per seed (a world file, a generator spec or a config, then an optional `prepare`);
- a **post** (a position id: `tribunal-member`, `weather-bureau`...), the one thing that differs between arms;
- a **base**: each seed's town run to `forkDay` with the post held by its code twin (so the past is the same for every arm);
- **arms**: forks of the base from that day to `untilDay`, each with a different **steward** in the post:
  `{kind: "code"}` (the post's own code), `{kind: "none"}` (nobody acts), `{kind: "model", model: "provider/name"}`;
- **measures**: counts and times read from each fork's log from the fork on (never "good" or "bad": the platform does not judge);
- **seeds**: the whole thing over several, so every number has a spread.

It uses lane F's snapshot and fork (docs/port-guide.md section 10): the base is snapshotted once per seed and each arm
resumes the snapshot, so the base is paid for once, an arm costs only its own days, and an arm with the same steward as
the base's is the straight run to the hash (a `mock/diligent` arm has the code arm's state hash: tested).

## Run one (no model is called)

```
bun run kernel                                   # builds the engine's native module once
bun orchestrator/src/cli.ts experiment run experiments/weather-stewards.ts --out runs/exp-weather [--parallel 4]
bun orchestrator/src/cli.ts experiment report runs/exp-weather      # the report again
```

`experiments/weather-stewards.ts` runs today: the weather bureau's post, three seeds, five arms (code; nobody; a diligent
mock model; a mock model three days late; one that drops every second act). The bureau is the one office the Rust engine
has ported at the time of writing, so the rest of the town stands idle (`standIn: "idle"`, or `OIKOS_STAND_IN`).
`experiments/tribunal-stewards.json` is the TARA shape (the tribunal's member; five seeds; code, nobody, two mock models)
and runs as soon as lane E's `tribunal.member` is in the engine: nothing else changes.

What it writes, under `--out` (never overwritten: a second run needs another folder; a run is training data):

```
spec.json  results.json  report.json  report.txt
seed-1/base.oklog  snapshot.bin  brains.json  config.json     # the base, and what an arm resumes
seed-1/<arm>.oklog  <arm>.json                                 # each arm's binary log (it names base.oklog as its parent) and its result
```

`oikos-kernel export seed-1/<arm>.oklog --out arm.jsonl` writes the arm's whole log as JSONL (the base's entries first), so
`verify`, `replay`, `oikos measure` and the explorer read it.

## The report

One table per measure, an arm a row, `mean ±sd [min..max]` over the seeds; then, under each, every other arm's
difference from the reference arm computed seed by seed (the same town and seed, so the town's own variation drops out);
and each arm's seat cost (calls, tokens, USD). `report.json` has every value per seed. Nothing says which arm is better.

Measures built in: `acts` (the steward seat's acts), `records` / `records:<kind>` (papers recorded), `first_record:<kind>`
(whole days from the fork to the first), `first_act_day`, `refused`, `transfers_cents` (money moved, integer cents),
`log_entries`. In a TS spec a measure is also a `MeasureMaker` (`{name, make(ctx) -> {see(entry), result()}}`) over the log's
entries.

## How it runs

- **Across cores**: the (seed, arm) jobs are dealt to worker processes (`--parallel P`, default cores less two; each
  worker takes a slot of the machine's pool, `scripts/slots.ts`; `--no-slots` for tests). A worker runs its seeds' bases
  one after another, then its forks **together**: the engine steps are synchronous, but the seats' calls of every fork
  of the worker are in flight at once (a model's answer is what waits). `--parallel 0` is everything in one process.
- **Deterministic**: the same spec gives the same numbers for any number of workers or engine threads (tested: in-process
  against two workers). Mock models draw nothing.
- **Costs**: each model arm's seat records usage (`annotation: usage`: tokens and `cost_microusd`) in its log as every run
  does; the report reads them back from the log. Mock prices are placeholders given in the spec (`prices`).

## Stewards

- `code`: the post's code runs as its twin: the engine's own kind, run detached (docs/port-guide.md section 10), exactly
  as the straight run.
- `none`: the seat waits at every wake. The post is held by nobody who acts; what the town does without it is the measure.
- `model` with `mock/...`: policies over the post's code brain, each recording a model's usage: `mock/diligent` (as the
  code), `mock/delay:<days>` (acts that many days after the code would), `mock/skip:<n>` (drops every nth act). They
  exercise the whole harness and say nothing about any model.
- `model` with any other provider: needs a `SeatFactory`, below.

## Real models

A real steward is a `SeatController` (`decide(wake) -> {action, usage}`: the wake is the seat's observation; the action
the participant API's) made by a `SeatFactory` for its provider. Give `runExperiment` (or export `seatFactories` from a
TS spec file, which workers load) `{ anthropic: (a) => ..., codex: ... }`, name the model in the arm
(`"anthropic/claude-sonnet-5"`), and give the prices. **What does not exist yet**, and is the next step before a real run:

1. The factory itself. `run.ts` makes a model seat from pieces that are not yet separable from its 1,600-line loop (the
   framing and prompt, the seat's reports and notebook, the translator that turns its words into a call, the
   confirmation of a draft, the debrief). A factory should reuse those (`createLlmParticipant`, the translator
   arrangement) with a minimal `LlmIO` whose `annotate` is `world.annotate`; the light host (`RustWorld`) accepts `call`
   actions and resolves them in the engine, so no resolver is needed on this side. Debriefs belong at the end of an arm.
2. The seat arrives at the fork with no notebook: the base's seat was the code twin, so a model steward takes the post
   at the fork day knowing only what the office's files and the world show it (a handover, as a real new officeholder).
   Forking a *model* seat's own memory mid-run (a base with a live model) is not served; a base held by a model is a
   second experiment shape (arms branch from a shared model past), and needs the host's state (notebook, knowledge,
   translator) to be saved and restored with the snapshot.
3. Budgets: `callModel` needs a limit per real model; the factory must enforce one per arm. A paid API needs the
   owner's go-ahead; the Codex CLI on his subscription (`gpt-6.1-sol` the driver, `gpt-6-luna` for narrow work) is the
   default for pilots. Real runs go detached (`nohup`, `caffeinate -i -w`), never as a session's background command.
4. Seeds are the towns' (and the draws'); a real model's answers are not reproducible, so each (seed, arm) with a real
   model is one sample: use more seeds, and read the spread.

## The unit of an experiment

The unit is a set of forks (docs/port-guide.md, lane G): `results.json` holds every fork's result; `report.json` the
comparison. Compare experiments by reading both reports, or run a larger one: a spec is a file, and a set of seeds is one line.
