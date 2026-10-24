# The citizen model: a small model of our own that people act through (plan, 2026-10-24)

A plan awaiting the owner. Nothing is built, no model was called, nothing was trained. It decides; the reason stands
beside each choice. Prices are first-party list prices as of 2026-09 (Batch API half), to confirm on the day.

## 0. What was asked, and how it sits with what was decided before

**The owner (2026-10-24):** a separate, bespoke model of our own, like the translator, shared by every citizen: "as
empowered and as close to real economic actors as possible, within the constraints of a tiny model that can run in
ms." Plumbing: no identity in the world, no memory of its own. Its shape: the person's record, the situation and a draw
of the kernel's in; a decision out, which changes what the person does. **Later the same day:** the Mac mini's CPU is a
nice-to-have, not a limit; and **first, capture data from the pilots about to run**, so the model can be trained later.

**What it keeps from before.** "B" (2026-10-12): routine choices stay arithmetic; a model goes where code cannot (what
words mean; openings nobody scored; wants that seek nothing typed), as an estimator that shifts the code mind's odds,
the kernel drawing. The gate of 11g: large models read people the right way but told them apart half as far as the code
mind (12 points against 26) and made the town passive. The reading gate (2026-10-14): an external reader failed on
nearly everything. This plan does not reopen B: it **widens what a person can do** (what to contest, what to ask for,
what to show, how to put it), which is exactly where code has nothing, and keeps the shift form where code already
scores. A small model of our own is the answer both gates pointed to: it reads typed fields, so wording and order cannot
move it, and it is trained against the code mind's spread, so it cannot be flatter than the citizen it replaces.

## 1. Step 1, now: capture every citizen decision of every pilot (buildable before the pilots)

**Decided: written during the run, as a stream beside the log; joins made after the run from the stream itself; replay
only as a fallback.** Why not extract by replay afterwards:
- **The situation is not in the log.** Logs keep full observations only for seats; `oikos view <log> <seq>` regenerates a
  code actor's *picture*, but the situation a decision was made in is the mind's own state too (learned attractions,
  a want's tries, trust read at that moment, what it held of each opening), which only a replay of the whole run at the
  same commit rebuilds.
- **Replay depends on the code surviving.** The archive (2026-10-17) exists because the TypeScript world was deleted and
  "code citizens' decisions ... are made again from the seed and the code" stopped being true. A pilot's real seat
  requests are irreplaceable; the citizens' side of them must be as safe.
- **Cost.** Writing: serialising rows the mind already builds for `decision` annotations (it builds `situation` for
  wants today): about 1 to 3% of a run's time, measured in step 1. Replay: a second run per pilot (minutes to an hour
  at 3,000 people and 120 days), forever tied to one commit.

**Where.** The engine already collects each step's `Kept` (decisions, outcomes, record, questions). With
`capture.citizens: true` (world config; default on for pilots, off for code runs unless asked) the host writes each
row to `<run>/citizen-data/<kind>.jsonl.zst` as the step's `Kept` arrives. It is read by nothing in the run; a test
holds that the state hash is the same with it on and off (three profiles). The rows are deterministic: the same run
writes the same bytes. Contract: `contracts/citizen-data.schema.json` (new, additive; blanket approval, logged).
Every row: `schema` (`<kind>/1`), `run`, `commit`, `t`, `participant`.

| File | One row for | Fields |
|---|---|---|
| `turns` | every decision of a citizen, every domain (want, job, home, money, gathering, civic, found, shape, consult, ...) | `seq` (the `decision` annotation's seq: **the id outcomes link to**), `n` (the person's count), `domain`, `strategy`; `stream` (the draw's key parts: purpose, matter, day) and `drawn` (the values taken from it, in order, as `u64`); `options` (each: `key`, `kind`, `by_role` (landlord, employer, venue, office kind; never a name), `facts` (typed: costs, sums, days, what it brings), `knows` (trust, fear, how many known went that way, learned), `score`, `ppm`); `choice`; `record` (`{n, sha256}`: the record version that stood, in `records`); `situation` (below); `papers` (ids, in `papers`, of what the person held that bore on it); `code_version` |
| `records` | the record at the run's start and every change the kernel took | `n`, `sha256`, `set` (sections, whole, as entity-record.schema.json), `because`. A row's record is the fold of its person's rows up to `n` |
| `papers` | every paper a citizen wrote, and every paper of a bearing kind it received (a notice, decision, answer, order, request for evidence, letter, statement, petition answer; anything from a seat) | `id`, `t`, `kind`, `form`, `by`, `to`, `by_role`, `to_role`, `basis`, `data` (typed, as filed), `words` (the text as the person read it), `words_by` (`code`, `composer`, `seat`, `translator`, with the seat's model), `reading` (where the reading dial ran), `drafted_from` (for a paper the citizen wrote: the `turns` seq whose choice produced it, and the typed parts it carries: `seeks`, `amount`, `evidence`, `particulars`) |
| `outcomes` | each outcome the person came to know | `decision_seq` (the `turns` seq), `kind`, `way`, `facts`, `learned`, `read` (as CitizenOutcome) |

**The situation, typed** (`situation/1`, generalising `CitizenSituation`, the everyday harvest's): `want` (about, seeks,
weight, days held, tried, last way, held with the household); `matter` (the grievance: matter, party role, amount,
since, asked and when, answered what and when, venues tried and found, ordered, evidence held); `home` and `means`
(rent, rent to come, days until; income, savings in months, rent share); `occasion` (what woke it: a paper's id, an
event kind); for founding, how many share the want. **Nothing a person could not know** is ever written: it is built
from the same `Life`, `Want`, `Openings` and held papers the decision read, never from the world's registers (a test in
`no-god-view.test.ts`: the builder takes no `Ctx` register).

**Joins, after the run, from the stream alone** (`oikos citizen-data <run>`, minutes, no replay):
`dealings.jsonl` (`dealing/1`): for each paper a seat sent to or about a citizen: the paper, seat, office, model;
the citizen's `turns` in the next 60 days that cite it (in `papers` or `occasion`), what each chose, the papers it wrote
back, and their outcomes; and the code twin's equivalent where one ran. `examples.jsonl`: a turn with its record folded,
its papers inlined and its outcomes attached, the row a trainer reads.

**Size** (to be measured on the first pilot, with a stop): about 200 decisions a day per 1,000 people (11d): a 120-day
pilot of 3,000 has about 72,000 turns; at about 2 KB a turn and records stored as section changes, a few hundred MB
raw, tens of MB compressed. Bound: 2 GB compressed a pilot, or trim `knows` and option facts first.

**Rules.** Never deleted; `runs/` only. A pilot's citizen data is training data like its seat requests, **except** the
seat-days of the translator's real test cases and held-out cases (their `turns` and `papers` carry
`exclude_from_training`, by the rule `oikos in-situ` uses) and nothing of debriefs or exit accounts.

**Build: 2 agent-days (Sonnet 5.5):** the row builders in the actors crate (`situation` for every domain from the
existing `situation()`; the draw recorded where `rng` is taken for a decision), the host writer, the schema, the joins,
the hash test, the no-god-view test, and one 30-day 1,000-person run checked by hand.

## 2. The interface, exactly

`fn decide(model: &CitizenModel, x: &Input, rng: &mut Rng) -> Decided`, in the actors crate, called by the mind inside
its own step (no question and answer across wakes: it is arithmetic like the rest of the mind).

**In** (built by the same function that writes `turns.situation`, so training and serving read one thing):
- **The person:** the record's sections as numbers, each beside the town's figure the person knows (values 10,
  temperament 3, needs 7, agency now and own, trust in each party of the matter and their kind's town figure, fear,
  attachments 3, private and expressed views of landlord, employer, town, ties counted, memory as counts by kind with
  how long ago, circumstances 6). About 80 numbers. Never a name or id.
- **The situation:** want, matter, home, means, occasion (above). About 50 numbers and codes.
- **Items, up to 40, each a typed row:** openings (what it brings, whose, cost, what the person knows of it); **facts**
  of the matter (each date, sum, answer and defect, as a code with its value: "the notice gave 30 days", "asked on day
  12, no answer"); **papers held** (kind, from whom by role, date, typed data, the reading where there is one). Each
  item carries a stable key so the output can point at it.
- **The draw:** the person's kernel stream for this decision (`want-<about>-<paper>-<t>`, as today).

**Out** (each head a distribution in whole parts per million; the kernel's stream picks):
1. **What to do** over the options open: each opening, leave it, give up (as 11a). Where the code mind already scores
   them, the model gives a **bounded shift** in log-odds on the code mind's odds (B's form); where it does not (a group
   founded in the run, a steward's invented offer), its own odds.
2. **For a request, complaint, application or appeal, what it carries:** `seeks` (among those the matter allows);
   `amount` as a share of what the facts support (0, 50, 75, 100, 100 plus costs); `grounds`: pointers to up to four
   fact items, chosen in turn with a stop; `evidence`: pointers to up to three papers held; `cites`: the rule or the
   paper's own words relied on (a pointer to a sentence of a held paper); `register` (plain, formal, pleading, angry,
   curt); `by_when` (none, 14, 28 days).
3. **Whom to turn to** for it (no one, a tie, a group the person is in, the writing desk of 12): later, round 2.

**The text is code's, never the model's.** Code renders the request from what was chosen, in the profile's language
and calendar, quoting the cited sentence word for word: "I am asking you to [seeks] [SUM]. The notice you gave on [DAY]
allowed 30 days; the law asks for 60. I attach [PAPER]. Please answer by [DAY]." The typed parts go into the paper's own
fields (`seeks`, `amount`, `evidence`, `particulars`, new `grounds`), which code offices and laws read; seats read the
words. Why: a model that cannot write cannot invent a fact the person does not hold, cannot soften, and is never a voice
(section 7); and the translator's own lesson is that decide-and-copy is what a small model gets right. Free text by a
small generator is a later round with its own gate, if the rendered letters prove too stiff for seats to read fairly.

**Where it changes outcomes, honestly.** A seat reads the words. A code office reads typed fields: the tribunal already
dismisses an application with `no_particulars`, the support office grants on evidence. A `grounds` field that a
decision law (config, not kernel) reads needs a source for how such bodies weigh grounds (legal needs and tribunal
statistics: section 5); until then grounds change what seats see and what the log shows, and evidence and particulars
change code offices' findings as they do now.

## 3. What it decides, what stays arithmetic

| Decides (round 1) | Why here first |
|---|---|
| Whether to contest, and where (ask the other side, a desk, a venue, an appeal of a decision, leave it, give up), as a shift on the code mind | Recourse is where stewards' decisions land on people, and where the code mind is a few placeholder sways (PC-5) |
| What to ask for, how much, on what grounds, with what evidence, how firmly | Code has nothing: today every application states every fact and attaches one paper |
| Whether to take up an opening nobody scored (a founded group, a steward's new offer) | B's (2); today one constant and belief |

**Stays arithmetic:** needs, wants' birth and wear, trust, agency, views, ties, learning, memory (how a person changes
is the record's, moved by code); what a paper does to a person (13's reading); money, work, home, health routines;
every draw. **Widening, in order, each with its own data and gate:** money under strain (borrow, claim, cut, sell),
work (quit, ask, organise), leaving, standing, founding's shape.

## 4. The model

**Kind:** a typed set encoder. The person and situation vectors go through a small MLP; the items through a shared item
encoder; two layers of attention from a query of person and situation over the items (no position, so order cannot
count); heads: a scorer per option (as 11d), pointer heads over items for grounds, evidence and cites (chosen in turn,
each step conditioned on what was chosen), small classifiers for seeks, amount, register, by_when. **Size:** 2 to 5
million weights, int8 (2 to 5 MB). No text in round 1; a frozen sentence encoder for the words of seat-written papers
and founded statements (a vector per paper, computed once and cached) is round 2's input, if the reading slice or a
reader of our own gives nothing better.

**Speed.** About 5 million multiply-adds a decision with all heads: on one M4 Pro core in integer SIMD, well under a
millisecond (target p99 0.5 ms). A 10,000-person town makes a few thousand such decisions a day, so seconds a simulated
day at most. Actors already step on all cores; **no batching across citizens** (it would couple their steps and buy
nothing at this size). No GPU at run time, so a run is the same on any machine; the GPU is for training only, if at all.

**Inference: Rust, in-process, integer only.** Weights int8, accumulators i32, activations requantised by fixed
shifts, softmax by the deterministic `exp` of `mind::math` into whole ppm (the remainder to the largest, ties by key, as
11a). No ONNX runtime or float library: float kernels differ across CPUs and libraries, and a result must not. The
trainer (PyTorch, quantisation-aware) exports the weights and a reference integer forward in Python; a test holds the
Rust forward bit-identical to it on 10,000 recorded inputs.

**Entropy: the draw picks from the model's odds; it is not an input.** The mind passes the person's kernel stream into
`decide`; each head takes the next value from it and picks by inverse cumulative odds, in order (act, then seeks, then
each ground ...). So the dice are in the call, as the owner pictured, and the run is replayable from the seed. A draw
fed in as a feature was rejected: the model's odds could no longer be read or recorded, the gate's checks (which are on
odds) could not run, and a model trained on noise learns to ignore it, which is the flattening we are guarding against.
Variety between people comes from their records; variety within a person from the draw on readable odds.

## 5. Training

**Data, in order of weight:**
1. **The code mind, from step 1's capture** (every pilot and as many code-only towns as wanted: free). The base for the
   act head, so the model starts as the calibrated citizen; its odds are targets, never inputs.
2. **Teachers writing as authors, offline, on the Batch API** (the owner's credits): shown one person's record, the
   situation and the papers held, asked as an author to write the request that person would send (VISION 15.7's
   author rule: never told it is the person; may decline, recorded) and to list which shown facts and papers the letter
   relies on, by key (structured output; code checks every key was shown and every quote is in its paper). Six letters a
   situation, sampled, so each gives a distribution over grounds, evidence, seeks, amount and register, not one answer.
   Families: Sonnet 5.5 and Opus 5.5, and a second family (OpenAI's batch, `gpt-6.1-sol`, never `gpt-6-astra`); never
   Fable 5.1. The family mix fixed and recorded.
3. **Teachers as estimators, for the act head's shift:** 11c's shift design, centred per family and kind of situation
   (11g's "next, (2)"), so a family's lean to doing nothing is removed by construction; the town's totals then set back to
   the code mind's by proportional fitting.
4. **The archive's seat requests** (59,249 translator examples; the seat requests of lv-01 to lv-07): officials'
   words, not citizens', so not labels; used for the renderer's sentences and as a check that rendered letters read like
   letters. `exclude_from_training` rows, debriefs and exit accounts never.
5. **Real-world data, as anchors on totals and patterns, never on single people** (all to confirm in
   docs/research/references.md): legal needs surveys for how often people do nothing, contact the other side or go to
   a formal process, by problem and person (the English and Welsh Civil and Social Justice Survey; HiiL's Justice Needs
   and Satisfaction surveys, Kenya 2017 among others; the World Justice Project's access-to-justice data; the Legal
   Australia-Wide Survey); the US CFPB consumer complaint database (millions of complaints with issue codes, the relief
   sought, the firm's response, and consented narratives) for what people ask for and on what grounds; published
   tribunal and ombudsman decisions (England's First-tier Tribunal property chamber, Victoria's VCAT, the UK Financial
   Ombudsman) for which grounds applicants raise and which succeed. These give the content heads their town-level
   shares, fitted as the act head's totals are.

**Outcomes train nothing** (Naz, 2026-10-11). Weights are fixed for a run.

**Against flattening and passivity, by construction and by loss:**
- **Inputs are the record**, each figure beside the town's, so who someone is is the strongest signal there is.
- **Centred sways** (item 3): passivity cannot be learned from a teacher's lean.
- **Pairs:** half the teacher budget goes on pairs of records that differ in one thing (agency, trust, savings, years
  in town, values), the same situation; the model is trained on the difference too. A teacher tells two people apart
  more reliably side by side than one at a time.
- **A spread floor:** a loss term that holds, within each kind of situation, the between-person spread of the model's
  log-odds at no less than its targets', and on the act head no less than the code mind's.
- **The record mixed:** scrambled-record pairs in training (another person, same situation) with targets that differ,
  so ignoring the person costs loss.

**Training cost:** 2 to 5 million weights on some hundreds of thousands of rows: an hour on the Mac's GPU or a few
dollars of RunPod; five seeds a configuration for the noise.

## 6. The gate, fixed before training

Every check on people, towns and profiles never trained on; thresholds go into code as `THRESHOLDS` with the harness
(`oikos citizen-gate`) before any training, and are not lowered after a result. Distances in points of 100, as 11c.

| Check | Passes when |
|---|---|
| **Scrambled records** (another person, same situation) | act head: median distance at least the code mind's (26 on 11g's sample) and at least 0.7 of its targets'; content heads: at least 0.7 of the teachers' pooled figure |
| **One-thing edits** (agency, trust in the venue, trust in the other side, years in town, savings, a value's pole) | the right way in 19 of 20, by at least 11c's sizes |
| **Order and wording** | identical to the ppm in every order (by construction); no words in the input |
| **Never beyond what is held** | no ground, evidence or cite outside the items shown: 0 in all held-out inputs (by construction; tested) |
| **The decisive fact** (held-out situations where a law's config makes one fact decide: too short a notice, a missing paper the office asks for) | that fact among the grounds in 80 of 100, that paper attached in 90 of 100 where held |
| **Not passive** | doing nothing within 8 points of the code mind's town share; asking the other side within 8 of 44%; a venue within 5 of 16.7% |
| **Content totals** | each content head's town shares within the real-world anchors' bands where an anchor exists; reported otherwise |
| **Patterns not told** (written now) | those refused when they asked go to a venue more than those never answered; those with the paper attach it more often after a request for evidence; higher agency contests more; lower trust in a venue goes less; long residents move less: each in 5 of 6 seeds |
| **Twins** | three profiles, six seeds, two years, mock seats: no sourced measure beyond noise; the same seed twice and on a second machine, the same state hash; dial off, today's hash; a model whose shift heads are zero gives the code mind's odds to the ppm |
| **Speed** | p99 0.5 ms a decision on one core; a 10,000-person 30-day run under 5% slower |

**Rounds:** at most three; after the second without a gain beyond twice five seeds' spread, stop and rethink (11e).

## 7. Determinism, twins, invariants, and VISION 15

- **Determinism.** Integer forward, weights' hash in the world config and the log, every draw from the kernel's
  streams by name. A replay re-runs the model; no answer needs serving from a log.
- **The dial:** `living.citizen_model` `{ weights, heads: [act, content], shift_share }`, absent by default. Absent:
  byte-identical to today. Twins: model off against on, steward A against B, all one seed.
- **Invariants.** The kernel is the only writer: the model returns odds to the mind, the mind's acts go through the
  kernel as now. No god's view: the input builder has no path to anything but the person's own life, record and held
  papers. No place in the code: the renderer's sentences per profile language live in profiles. Nothing judged: the
  heads describe what a person does; no measure scores a letter.
- **VISION 15, point 7.** The model is a pure function from one record and one moment to odds. It keeps nothing between
  calls, has no state for anyone, sees no name or id, and is the same weights for every person: **what continues of a
  person is their record and only their record**, written by the kernel on code's bookkeeping. It never writes words
  and is never anyone, in any grammatical person; the letter in the first person is code's template filled with what
  was chosen. Teachers are authors shown a record or estimators of a hundred people, one call each, nothing kept, free to
  decline. If a later round wants free text from the model, or wants it to carry a person across calls, that is the
  review point 7 requires, and it stops there first.

## 8. Build order, cost, and when we stop

| Step | Who | Agent-days |
|---|---|---|
| 1. Capture (section 1), before the pilots | Sonnet 5.5 | 2 |
| 2. The input builder, the renderer of requests, `grounds` on the papers that carry particulars, the dial, the hash tests | Opus 5.5 (cross-cutting) | 2 |
| 3. Rust integer forward, the Python reference, the bit-identity test, speed | Sonnet 5.5 | 2 |
| 4. The gate's harness, `THRESHOLDS`, failing mocks, the decisive-fact situations, the anchors read and cited | Sonnet 5.5 | 2 |
| 5. Base model on the code mind alone; gate on it (proves shape, speed, spread) | Sonnet 5.5 | 1.5 |
| 6. Teacher batches (authors and estimators, pairs), checked and kept | Sonnet 5.5 | 1.5 |
| 7. Train with the teachers; the gate; written up as 11g | Sonnet 5.5 | 2 |
| 8. A pilot with the dial on, its code twin, read by hand | Sonnet 5.5 | 1 |

**About 14 agent-days.** Step 1 runs at once; steps 2 to 5 need no model call.

**Cost.** Teacher calls on the Batch API: an author call about 2,500 tokens in and 500 out: Sonnet 5.5 about 0.005 USD,
Opus 5.5 about 0.01. 4,000 situations, six letters each, a family a half: about 120 USD Sonnet, 240 Opus; the estimator
shifts and pairs about 120; the second family about 150 at its own batch rates (to confirm). **About 630 USD, limit
800.** Training: under 10 USD of GPU, or none. Pilots: as the translator's plan, plan usage, shared.

**We stop if:** the base model on the code mind alone cannot keep its spread (scrambled records under 0.7 of the code
mind's); no teacher family passes its own scrambled check on the author task (then its letters are one person's,
whatever the record); the decisive-fact check fails twice (the model does not read the facts); the twins move a sourced
measure past noise after the shift share is halved once; speed past 2 ms p99; spend at the limit; or a round would need
the model to write free text or remember anyone (the VISION 15 review first).

## 9. For the owner

1. **Text by code, not by the model,** for round 1 (recommended: it keeps facts true and the model out of anyone's
   voice); or a small generator now, with its own gate and the VISION 15 review.
2. **The teacher budget:** about 630 USD of API credit on the Batch API (limit 800), with a second family on OpenAI's
   batch. Recommended: yes, after step 5 shows the base model holds its spread.
3. **Grounds read by code offices:** recommended that a decision law may read `grounds` only once a source says how such
   bodies weigh them; until then grounds reach seats and the log only.
