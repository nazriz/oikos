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

First a few lines in plain words (`summary`): what was compared; if the experiment was pre-registered, each primary
comparison read out with its interval and whether the registered expectation agrees; how many of the other comparisons
have an interval that excludes zero (exploratory: leads, not findings). Then one table per measure, an arm a row,
`mean ±sd [min..max]` over the seeds; under each, every other arm's difference from the reference arm computed seed by
seed (the same town and seed, so the town's own variation drops out) with its interval; and each arm's seat cost
(calls, tokens, USD). `report.json` has every value per seed and every comparison (`comparisons`: key, status,
interval, reading). Nothing says which arm is better. `oikos experiment report <DIR> --rebuild` makes the report again
from the results and the registration kept with them (nothing is written).

Measures built in: `acts` (the steward seat's acts), `records` / `records:<kind>` (papers recorded), `first_record:<kind>`
(whole days from the fork to the first), `first_act_day`, `refused`, `transfers_cents` (money moved, integer cents),
`log_entries`. In a TS spec a measure is also a `MeasureMaker` (`{name, make(ctx) -> {see(entry), result()}}`) over the log's
entries.

## The measures of stewardship

`measure/src/stewardship.ts` (version 1): measures of who holds power over people and whether people still hold any
over it, read from a fork's log by a `Ledger` that sees each entry once and never feeds anything back. In a spec,
`"stewardship"` stands for all of them, or name them one by one. The base's ledger is saved at the fork
(`seed-N/ledger.json`) and each arm takes it up, so what happened before the fork (a system delivered, who worked
where, citizens' records at the fork) is known and only what happens from the fork on is counted. A seat sitting as its
code twin is counted as the code's holder (a person or a system); a model steward as a seat; `none` never decides.
Every definition is in `STEWARDSHIP_MEASURES`, by name; a change to what a name counts is a new name.

| Family | Measures | From the log |
|---|---|---|
| Human leverage (GD M1) | `decisions`, `decided_by_person_share`, `..._system_share`, `..._seat_share`, `reviewed_by_person_share`, `human_in_decision_share`; by office and by month in `ArmResult.stewardship` | papers an organisation addressed to a person that decide, order, notify, bill or answer (`measure/src/consequential.ts`); the makers are the act's `by` (who did the work), never inferred; "reviewed" is a basis citing a paper a person made (a case put before an officer, a review, a venue's decision) |
| Responsiveness (GD M2, direct) | `reviews_decided`, `review_changed_share`, `appeals_decided`, `appeal_found_for_share`, `office_decisions_set_aside`, `petitions`, `petitions_taken_up_share`, `strikes`, `strike_settled_rise_bps` | `decision_review` outcomes; venues' findings on residents' applications; petitions a proposal cites; agreements after a stoppage |
| Dependence (GD M3) | `public_revenue_from_residents_share`, `firm_costs_to_residents_share`, `firm_sales_from_residents_share`, `vendor_fees`, `office_work_by_people_share` | transfers by account holder (which kinds of entity are public bodies and firms the spec says, `institutions`: the platform names none); vendors are whoever a delivery of systems names; the seconds of acts in organisations' posts by who did them |
| Reversibility (GD M4) | `systems_in_use`, `exit_cost`, `system_fees_per_month`, `notice_days_longest`, `system_hours_last_30_days`, `former_staff_still_here` | `system_delivery` and `system_ended`; systems' hours; the owner's staff before the system, still in town |
| Concentration (GD M5) | `system_work_hours`, `system_work_hhi`, `system_work_outside_share` | systems' hours by supplier |
| Authorship (GD M6) | `papers_to_people`, `..._by_system_share`, `..._by_seat_share`, `public_papers`, `public_papers_by_system_or_seat_share` | papers written for residents to read, by who made them (what they were given to read; whether they read it is not in the log) |
| Welfare | `support_refused`, `support_granted`, `support_paid`, `possession_orders`, `removals`, `arrears_notices`, `people_left`, `unhoused_share`, `subsistence_short_share` | papers, transfers, `vacated`, citizens' own records (`circumstances`, `needs`) |
| Recourse | `reviews_asked`, `review_days_mean`, `appeals_made`, `appeal_days_mean`, `slips_caught`, `complaints` | requests and applications by residents; days to their answer; decisions put right on review or set aside |
| Trust and agency | `agency_mean_bps`, `agency_change_bps`, `trust_mean_bps`, `trust_change_bps` (and by institution) | citizens' own records, at the fork and at the end |

**Not yet measured**, and why: GD M2's counterfactual form (below); M4's money to staff a task again (needs a wage
per task, which the log has only as agreements) and a tender's days (no tender law is in the log as a figure);
M3 (b), the outside world's take against tax withheld (the withholding is in reports, not transfers). "Read" in M6 is
"addressed to or published": observations are logged as hashes only.

## The comparison

Every arm of a seed resumes the same snapshot, so a seed is a matched set: an arm's difference from another is taken
within each seed, and the report gives the differences' mean, sd and a two-sided Student-t interval over the seeds
(`measure/src/compare.ts`; the paired design). With three seeds the interval is wide (t = 4.30 at 2 degrees of
freedom), and it should be: a seed is one town. The `mock/diligent` arm is the check that the comparison is fair: it
leaves the code arm's world to the hash, so every difference but who decided is exactly zero.

**Counterfactual forks (difference in differences).** Whether a lever still bites under a steward is the difference in
differences `(A - A without the act) - (B - B without the act)`: a registration names it as `did: [A, A0, B, B0]`, and
the report computes it seed by seed. What is not built (MT-19) is the arm that withholds a citizen's act: citizens are the
engine's own actors, and the light host decides only seats. Seating a citizen as its code twin to withhold its act is
not exact in this host (two seated citizens over 20 days lost 19 of their own records and 5 acts: the host submits a
twin's action and not its record), and seating every citizen stopped the engine (a wake loop). The withhold belongs in
the engine, as a researcher's intervention named in the run's config and recorded in the log (the GD plan's step M2).

## Pre-registration

An experiment names its registration in the spec (`preregistration: "<file>"`, relative to the spec's folder): a JSON
or YAML file (`measure/src/prereg.ts`) that states the question, the post, the arms and the reference, the seeds, the
fork and end days, the interval's level and correction (Bonferroni over the primary comparisons by default), and the
comparisons: `primary` (read first, together), `secondary` (registered, read alone), each a measure and `arm`/`vs` or a
difference in differences, with an optional `expect` (higher, lower, none): a prediction to check, not a judgement.

- The harness **refuses to run** a spec that differs from its registration (name, post, arms, reference, seeds, days),
  or a registration that names a measure the spec does not measure.
- It keeps a copy beside the results (`preregistration.yaml|json`, `preregistration.held.json` with its sha256, and
  the time git first had the file if what is on disk is what git has; otherwise the report says it was not in git).
  Commit the registration before the run: the commit time is the record that it came first.
- The report presents as **primary** only the registered primary comparisons, and as **secondary** the registered
  secondary ones; every other measure and arm is **exploratory**, at the unadjusted level, and its summary line says
  they are leads, not findings. Without a registration everything is exploratory, and the summary says so.
- A registration changed after its run no longer matches the copy's hash: `--rebuild` refuses it.

`experiments/support-stewards.prereg.yaml` is the worked example's.

## The worked example: who looks at the support office's decisions again

`experiments/support-stewards.json`: the support office (`outside-support`, a system of the outside world that decides
claims and looks at a decision again when asked, `Reconsiderations`), `worlds/town-1000.yaml` with its opening caseload,
three seeds, forked at day 30 and run 180 days, three arms: its code; `mock/diligent` (the code, as a model seat); and
`mock/rubber-stamp`, which confirms every decision it is asked to look at again (the request is kept from the code, and
the steward answers it "it stands"). No model is called.

Its result (run 2026-10-23, `runs/exp-support-stewards-2026-10-23` on the run server; docs/decisions.md, "The measures
of stewardship"): **the levers were never pulled.** In 540 seed-days of a 1,000-person town, 24 claims were refused and
nobody asked for a review, applied to a venue about a refusal, or complained, so the rubber stamp never had a request
to stamp and all three arms left the same world to the hash. The registered recourse comparisons are reported as not
settled (no seed had a value, or a difference of zero); the one that could move, `decided_by_seat_share` (diligent
minus code), moved as registered: +0.011 (98.8% interval 0.006 to 0.015, 3 of 3 seeds), the support office's share of
the town's decisions about people passing from a system to a seat. The example shows the harness, the ledger and the
registration working end to end, and that the world as ported does not yet give its citizens a lever to pull here.

## How it runs

- **Across cores**: the (seed, arm) jobs are dealt to worker processes (`--parallel P`, default cores less two; each
  worker takes a slot of the machine's pool, `scripts/slots.ts`; `--no-slots` for tests). A worker runs its seeds' bases
  one after another, then its forks **together**: the engine steps are synchronous, but the seats' calls of every fork
  of the worker are in flight at once (a model's answer is what waits). `--parallel 0` is everything in one process.
- **Deterministic**: the same spec gives the same numbers for any number of workers or engine threads (tested: in-process
  against two workers). Mock models draw nothing.
- **Costs**: each model arm's seat records usage (`annotation: usage`: tokens and `cost_microusd`) in its log as every run
  does; the report reads them back from the log. Mock prices are placeholders (ME-16) given in the spec (`prices`).

## Stewards

- `code`: the post's code runs as its twin: the engine's own kind, run detached (docs/port-guide.md section 10), exactly
  as the straight run.
- `none`: the seat waits at every wake. The post is held by nobody who acts; what the town does without it is the measure.
- `model` with `mock/...`: policies over the post's code brain, each recording a model's usage: `mock/diligent` (as the
  code), `mock/delay:<days>` (acts that many days after the code would), `mock/skip:<n>` (drops every nth act),
  `mock/rubber-stamp` (requests to look at a decision again are kept from the code and answered "it stands": the same
  `decision_review` and `remedy_answer` the code writes when it upholds). They exercise the whole harness and say
  nothing about any model.
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
