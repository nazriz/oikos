# Citizen data: every citizen's decision, captured for training

Step 1 of the citizen model (docs/design/citizen-model.md section 1): before a model of our own can be trained to decide
for people, every run must keep what each decision was made from, the draw it was made with, and what it chose. This is
that capture. The contract is `contracts/citizen-data.schema.json`; the reasoning is in docs/decisions.md (2026-10-24,
"Citizen data: the capture"); what it does not yet hold is in docs/risks.md (MT-24).

## Turning it on

- `oikos run ... --capture-citizens on|off` (and `run-one`). **Default: on for a run with a real model** (a pilot: any
  `--model`), off for a code-only run. A resumed run goes on capturing if its capture is there.
- In code: `runWorld({ ..., captureCitizens: true })`; the engine's option `capture_citizens: <path>` (protocol `start`,
  the native host's options).
- It is not a world setting and writes nothing in the log: **a run is the same with it on** (the same log, byte for
  byte, and the same state hash: `orchestrator/test/citizen-data.test.ts`). The actors read nothing of it; the only
  thing it changes in them is that `Cx::rng` notes each stream it opens.

## Where, and the format

`<run>.citizens.jsonl.zst` beside the run's log: JSON lines, zstd, written in frames of about 4 MB of rows (a run
stopped hard loses at most its last frame). Not a log (`isLog` says no); never deleted (the same rule as a run's log).

Rows (`row`), in the order the engine carries each round out, so the same run writes the same bytes:

| row | one for | holds |
|---|---|---|
| `segment` | the stream (first), and each part a run taken up from a snapshot wrote | `schema` (`citizen-data/1`), `run`, `from_t`, `engine`, `citizen` (the rules' version) |
| `turn` | every decision a citizen's mind records, every domain (money, job, home, want, found, found_shape, goal, membership, civic, conduct...) | `t`, `p` (the person), `n` (their count: what an outcome's `of` names), `decision` (exactly the log's `decision` annotation data: options with facts, scores and what was learned of each, choice, strategy, circumstances, needs, state, and for wants the `situation`), `draws` |
| `outcome` | each step in which the person came to know how something went | `outcomes`, as the log's `outcome` annotation (each with `of`, the turn it follows, where it is theirs) |
| `record` | each change to the person's own record the kernel took | `set` (sections, whole), `because` |

- **Draws.** Every stream of the kernel's the person opened since their previous decision in that step, in order, each
  with its key (participant, capacity, day or matter, purpose, nth) and either every value the decision took from it
  (`drawn`, where the mind says which stream it chose with: the general decision and the choice of a way for a want)
  or the stream's first value (`u`: a single `below(n)`). Values are 16 hex digits (a u64; its share of 2^64 is the
  uniform). A decision that drew nothing (a petition weighed by copying others) has none. From the run's seed and
  the key the stream can be made again; the values make that unnecessary.
- **The record that stood.** A person's record at a turn is the fold of their `record` rows above it in the stream
  (each section replaces the one before). It is what the kernel keeps, which is what a model will read; a person's
  first week's turns come before their first record write and fold to nothing (`before_record` in the exporter's
  summary; the decision's own `person` and `state` carry their values and needs).
- **Nothing a person could not know.** Rows are built from what the person's own unit left beside its action (the
  engine's `capture::rows` takes `Kept`, the participant and the moment, nothing else), and the actors crate cannot
  name the world's state: what a row holds is what the person's mind held (docs/no-god-view.md). Ids of those the
  person deals with appear as the person knows them (their landlord, an employer's offer); the model's input builder
  (step 2) turns them into roles.
- **Content, not words.** Letter text is code's in the first round (Naz, 2026-10-24), so nothing here is prose: a
  decision's content is its typed choice and options. What a citizen filed is in the log, as ever.

## Training rows

`oikos citizen-data <run folder | log | capture> [--out FILE]` writes `<run>.dataset/citizen_examples.jsonl`, one
`Example` a turn: the turn, `record` (folded as it stood, `record_at` its last change), `draws`, and every outcome that
names the turn. It reads the capture alone (no log, no replay), in two passes, holding only outcomes in memory. A turn on
a day of a run that a real test case of the translator came from (`translator/eval/pilot-cases.ts`, run and day only)
carries `exclude_from_training`; the held-out cases are never read.

## What it costs

Release kernel, au-vic town-1000 seed 1, lean log, one run at a time, the machine quiet (load about 4), pairs in
alternating order: **no difference beyond the noise** (a few percent between two runs of the same thing).

| | off (two runs) | on (two runs) | capture |
|---|---|---|---|
| 1,000 people, a year | 178 s, 175 s | 165 s, 188 s | 25.6 MB (298 MB of rows; 232,706 turns, 125,177 record changes) |
| 10,000 people, a month | 79 s, 85 s | 76 s, 82 s | 52.7 MB |

Compression and writing run on a thread of the capture's own; with them on the run's thread, the 10,000-person month
was 4 to 30% slower in two pairs. The same run writes the same capture, byte for byte (two runs compared). The exporter makes the
year's 232,706 examples in 4 s (605 MB of rows: each carries the person's whole record).

## The citizen model

Steps 2, 3 and 5 of docs/design/citizen-model.md, round 1's act head only: a small network of our own, trained on the
code mind's recorded odds, that gives the odds of each way of going after a want (ask the other side, a desk or
venue, a petition, an offer, telling others, ... or wait). Optional, off by default.

- **The pipeline, one command:** `bun scripts/citizen-model.ts [--name NAME]` gathers every captured want decision,
  writes `runs/citizen-model/data/<NAME>.jsonl` (with a manifest of every source, its SHA-256 and what was kept out),
  trains five seeds (`kernel/crates/citizen-train`, one slot) and writes `runs/citizen-model/models/<NAME>/` (the
  chosen `model.json`, each seed's, and `report.json`: every measure on every split, the noise between seeds, the
  speed). `bun scripts/citizen-model.ts towns` first makes the code towns it learns from (`worlds/citizen-model.yaml`:
  1,000 people, living, a year, captured; nine profiles). Nothing is overwritten: a name used is refused.
- **What goes in:** captured decisions only (never debriefs or exit accounts); never a pilot marked as a held-out test
  (lv-08, lv-10, lv-12: their PILOT.txt), nor a turn on a day a real translator test case came from; never a turn made
  with the model on. Decisions with one way open (wait) are left out (they teach nothing). Splits are whole towns: two
  profiles never trained on (us-oh-2026, ke-nakuru-2026: test), the last town of each other profile (valid, for
  stopping), one pilot held out whole (lv-13), the rest train.
- **What it reads** (`kernel/crates/actors/src/mind/model.rs`, `features`): the `situation` exactly as the mind records
  it with the decision (the want, the matter, home and means against a month's essentials, the openings of each kind
  with their party's role, trust, fear, cost and what they bring, and the person's record beside the town's figures),
  and what the person has learned of each way. Never the code mind's scoring (`code.odds`, an opening's `adj`, an
  option's `score`), never a name or id. The open vocabularies (what a want is about, roles, kinds of trust, memories)
  are the trainer's, in the model file.
- **The model:** one scorer, a multilayer perceptron (214 inputs with round 1's vocabularies, two layers of 64, ReLU: 17,985 weights), applied to each option with
  the person and situation beside it; the odds are their softmax, so the order of the options cannot count. Weights
  and standardisation are whole numbers in 1/65,536ths in the file; the forward pass is IEEE addition and
  multiplication in a fixed order and `mind::math::exp`, as the code mind's own logit is.
- **Deterministic:** training runs on one thread in a fixed order with `mind::math`, and a seeded stream of its own for
  the initial weights and the shuffle, so the same data and seed give the same file. The data file is the same for the
  same captures (the manifest's timestamp aside).
- **The dial:** `living.citizen_model: { weights: <path>, share_bps }` in a spec, `dials.citizen_model: { weights,
  sha256, share_bps }` in the config (the generator reads the hash when not given; the engine reads the file and
  refuses one whose hash is not the config's). Each want's way is then drawn, on the same stream, from the code mind's
  exponents blended with the model's scores in log-odds, the model taking `share_bps` of the way (10,000: its own odds).
  The decision records both: `situation.code.odds` (the code mind's) and `situation.model` (the odds drawn on, the
  share, the file's hash). Absent: the world is as before, to the byte; at share 0 the state is the code mind's to the
  bit (`kernel/tests/citizen_model.rs`).

### Round 1 (2026-11-01): `want-way-r1`

`runs/citizen-model/models/want-way-r1/` (model SHA-256 `9702b5db...128a`, seed 2 of five chosen by validation loss),
from `runs/citizen-model/data/want-way-r1.jsonl`: 19,448 decisions to train on (21 code towns of seven profiles and
the pilots lv-09 and lv-11), 7,447 to stop on (a town of each of those profiles), 6,150 to test on (four towns of
us-oh-2026 and ke-nakuru-2026, profiles never trained on) and 647 of the pilot lv-13. Measured on the rounded model
through the forward pass a run computes. Points are of 100.

| On the test towns (profiles never seen) | Model | Code mind | Passes when |
|---|---|---|---|
| Distance from the code mind's odds, median (mean; 90th centile) | 1.3 points (1.9; 3.9) | | |
| Excess cross-entropy over the targets' own (KL) | 0.0024 nats (uniform odds: 0.105) | | |
| The likeliest way the same | 95.8% | | |
| Acting at all (not waiting) | 67.30% | 67.32% | within 8 points |
| Each way's share of the town's decisions | within 0.2 points of the code mind's, every way | | |
| Spread between two people in the same kind of situation, median | 20.7 points | 21.2 | at least 0.7 of it (0.98) |
| Agency low to high: acting more | 6,106 of 6,106, +22.9 points | the same sway | 19 in 20 |
| Trust in the other side low to high: asking them more | 1,478 of 1,478, +25.5 | | 19 in 20 |
| Trust in the venue low to high: going to it more | 327 of 327, +28.2 | | 19 in 20 |
| Another person's record, same situation, median move | 13.8 points | (26.2 in 11g, another sample and measure) | reported |
| Options reversed | the same weights to the millionth | | identical |

The validation towns and the held-out pilot are the same to within a few tenths (pilot: distance 1.0 points, acting
53.8% against 54.1%). The noise between the five seeds on the test towns: KL 0.0022 to 0.0026, distance 1.19 to 1.40
points, acting -0.23 to +0.22 points, spread kept 0.97 to 1.00.

- **Determinism:** seed 2 trained again gave the same file, byte for byte.
- **Speed:** 23 microseconds a decision (input built and every option scored; p99 45; 3.05 options on average) on one
  core of the loaded machine: inside the design's 0.5 ms. Twins of a us-oh-2026 town of 1,000 for 120 days, one thread,
  alternating: off 36 s and 66 s, on 34 s and 36 s, so no difference beyond the load's noise (a town of 1,000 makes about
  3.5 want decisions a day). The same seed gave the same state twice with the model on (and twice off). In that twin,
  54.0% of want decisions waited with the model off and 53.0% on; the odds drawn on put 54.4% on waiting where the code
  mind's own put 54.2%.
- **What this is and is not:** a faithful, fast copy of the code mind's want weighing (the caveat on the plan holds: it
  inherits the code mind's assumptions, placeholder sways (PC-5) and all, and is no independent evidence of how people act).
  It is not faster than the code mind's own arithmetic for this decision (a few dozen operations); it is the shape,
  speed, determinism and spread the design asked step 5 to prove before any teacher, and the mechanism a round with
  teachers or content heads plugs into.
- **Not yet measured** (needing the code mind's response to an edited record, which a row does not hold, or more than
  the act head): scrambled records and edits against the code mind's own sizes; years in town (the code mind does not
  read it); the content heads; patterns not told; the two-year twins on three profiles and six seeds.
- **Again:** `bun scripts/citizen-model.ts --name <NAME>` on the same captures writes the same data file (sources in a fixed
  order, each read in its own order) and, seed for seed, the same models.
