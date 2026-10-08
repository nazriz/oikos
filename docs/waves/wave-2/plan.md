# Wave 2: the first real wave of pilots

**Status: planned 2026-10-08, not run. It waits for Naz's go-ahead, and for the knowing architecture to land.** No pilot has been started and no model called in making it. The queue files beside this page are ready for `scripts/pilot-wave.ts`; the tables are in `matrix.md` (written by `make.ts`, like the queues; change the plan there and run it again).

## What the wave is for

Pilots exist first to gather data for the trained translator. The data so far is letters from three calm offices in one town in one currency. This wave is built to change that, in this order:

1. **Acts nobody has asked for.** Of the sixteen kinds of act, eight have never been requested by a seat (goods, account, occupancy, entity, vote, presence, position, take) and four barely (agreement 4, claim 9, structure 11, work 1). The cause is who sat where: a mayor, a finance officer and a planning officer in a quiet town write letters. So the wave seats offices whose daily business is those acts: councillors (votes), an electoral office (appointments), landlords (leases and who lives where), the lender (loan agreements, payments), the tribunal, the registrar, and, as probes, a shop, a factory and the works office.
2. **Forms and the seats' own wording.** The trained translator read 1 form in 10 and 1 in 9 of the seats' own wordings in the one pilot scored. Forms come from mayors (council proposals, amendments, permits) and landlords (permits); a mayor sits in 19 of 30 pilots and a landlord in 11. Every request a seat makes is in its own wording, and twelve pilots run the trained translator so that we see where it fails on them.
3. **Other places' money.** Seven profiles, five in training: amounts with a sign before, a decimal comma, no smaller unit, and (test only) groups of two with lakh and crore.
4. **Other situations.** Ten pilots start under one of the three scenario presets seen to bite (an election due, a hot summer, a wet year).
5. **Other writers.** Five seat models from two families; in 11 of 30 pilots the seats are on a model that is neither of the two labelling readers (Sonnet 5.5, gpt-6.1-sol).
6. **A test that measures generalisation.** Eight whole pilots are test-only, each differing from every training pilot in a model, a profile or an office.

What it is not for: comparing stewards, or any claim about how models govern. Thirty pilots that each differ in several ways are no experiment.

## What was learned about seats, which shaped it

Read from the generator, the behaviour modules and pilots 12, 13 and 18 (reports made with `pilot-report --no-write`; nothing was written to `runs/`).

- **Any office can be named a seat** (`model_seats=<office id>,...`; the mayor by `mayor=llm`). The generated town has the same offices in every profile: mayor, planning, inspector, finance, works, electoral, editor, environment, registry, child-protection, council-clerk, councillor-1 to 5, rates, bank-lending, bank-payments, builder-foreman, clinic-manager, principal, tribunal-member, tribunal-registrar, water-operations, energy-operations, police-oic, union-organiser, twenty `landlord-N-office`, thirty `shop-N-manager`, ten `factory-N-manager` (and `fund-trustee` where a town asks for a retirement fund). The offices named `outside-*`, `weather-bureau` and `migration` stand for the world beyond the town and are not seats.
- **A model in a seat replaces the office's code entirely.** The code module is only the mock's brain. Whatever the office did by routine, the model must now ask for, one `do` at a time, at most eight actions an answer, about one sitting a working day. Wages and rents are standing orders set up once, so they are no burden; work that is done daily by hand is.
- **One model for every seat of a run.** A queue entry has one `model`. Mixing models within a town needs a code change.
- **Only `do` goes to the translator.** A letter (`write`) goes as written. Sixty days of three seats gave 17 requests through `do` in pilot 12 and 12 in fifty days of pilot 18, beside 43 and 189 letters. Finance and planning made none at all. Real requests are scarce: about one per seat every ten to twenty days. The pipeline's other source is the *situations* (each time a seat was asked what to do), in which writers say what they would ask; the wave gives about 7,500 training seat-days of new offices, places and conditions for that.
- **Confirmation is `always`** in every generated town (each draft is confirmed or declined by its seat). The contract has `consequential` and `never`, but nothing a queue entry can set reaches them. This wave would not use them anyway: the seat's sign-off is the label of whether a draft was right.

| Office | As a seat now | What it has honest reason to ask for | In this wave |
|---|---|---|---|
| mayor | works (pilots 7 to 18) | forms (proposals, amendments, permits), statements, structures, agreements | 19 pilots |
| finance, planning, inspector | work; little to do through `do` | payments; permit decisions and the liberty they grant; fines, orders | 10, 6, 4 |
| council-clerk, councillors | should work: few, event-driven acts. Never tried | ballots, results, laws as statements; **votes** | 8, 5 (two whole councils) |
| electoral | should work; idle unless a poll is due | notices, the roll, the count; **position** (the appointment) | 4, all with an election due |
| registry, child-protection | registry worked in pilot 12 (cautiously: it asked for corroboration of a death); child-protection never tried, rarely has business | death registrations, a title passing to an heir (claim); **presence** | 5, 2 |
| tribunal-member, tribunal-registrar | should work; never tried | hearing notices, orders, enforcement | 3, 3 |
| editor | should work; nothing breaks if it is idle | news statements | 3 |
| landlord offices | workable but busy (about 19 homes each, weekly bursts); vacancies rise if it lags. Never tried | listings, leases (agreement and **occupancy**), rent and arrears notices, tax payments, permits, building | 11 (17 seats) |
| bank-lending | borderline: each loan is several acts. Never tried | loan decisions, loan agreements, payouts, debt claims | 4 |
| police-oic, union-organiser | should work. Never tried | investigations (work), tribunal applications; membership agreements, wage claims, ballots | 2 each, **test-only** |
| shop and factory managers | **probe**: a shop serves about one order a day (three acts each), a factory makes daily. A model may not keep up; one shop of thirty or one factory of ten lagging is an ordinary business failing | **goods**, work, payments, delivery notes, invoices | 2 pilots (one of each in each) |
| works | **probe**: in pilot 12 it could hire nobody (the trained translator refused or asked back 12 of 14) and bins went uncollected. Collection is dozens of `work` acts a day | job postings, hiring (agreement, occupancy), work, goods to the landfill | 1, with the prompt-driven translator |
| environment | borderline (hires surveyors, survey work in batches); the town is not hurt if it lags | work, reports | 1 |

**Left out as seats, and why** (each is a gap, below): `bank-payments` (it executes every payment in the town: thousands a month; without it all money stops), `rates` (hundreds of notices an instalment; the town's revenue), `water-operations` and `energy-operations` (a daily act that must not miss a weekend, and hundreds of bills), `principal` (a lesson per classroom per day; a missed day is children not taught), `clinic-manager` (a `work` act per patient; a lagging seat is the sick untreated, which is not a pressure this wave has any reason to make), `builder-foreman` (daily site work), `fund-trustee` (off by default).

## The matrix

`matrix.md` has it in full with seeds and translators. In short (S = `claude-code/claude-sonnet-5-5`, H = `claude-code/claude-haiku-5-5`, F = `claude-code/claude-fable-5-1`, sol = `codex/gpt-6.1-sol`, luna = `codex/gpt-6-luna`; translator P = prompt-driven `codex/gpt-6-luna`, T = trained `decide/pod-small-d16-s1`). Every town is 1,000 people from day 0; seeds are 100 + the pilot's number (900 + for a test-only pilot), none used before.

| Pilot | Stage | Seat model | Profile | Days | Scenario | Seats | Tr. | Test |
|---|---|---|---|---|---|---|---|---|
| w2-01-council | 2a | S | au-vic | 45 | | mayor, council-clerk, councillor-1..5 | P | |
| w2-02-housing | 2a | H | gb-eng | 45 | | landlord-1, landlord-2, tribunal-member, tribunal-registrar | T | |
| w2-03-election | 2a | S | de-ni | 75 | election-due | mayor, electoral, editor, council-clerk | P | |
| w2-21-lending | 2a | sol | au-vic | 45 | | bank-lending, finance, landlord-1 | P | |
| w2-22-townhall | 2a | luna | jp-akita | 45 | | mayor, finance, planning | T | |
| w2-23-newplace | 2a | sol | mx-jal | 45 | | mayor, landlord-3, registry | P | yes |
| w2-04-townhall | 2b | H | jp-akita | 60 | | mayor, finance, planning | P | |
| w2-05-landlords | 2b | S | us-oh | 90 | | landlord-1, -2, -3, bank-lending | P | |
| w2-06-justice | 2b | S | de-ni | 90 | | tribunal-member, tribunal-registrar, registry, child-protection, inspector | T | |
| w2-07-election | 2b | H | au-vic | 90 | election-due | electoral, council-clerk, councillor-1..3 | P | |
| w2-08-heat | 2b | S | jp-akita | 90 | hot-summer | mayor, registry, editor, child-protection | T | |
| w2-09-trade | 2b | S | au-vic | 60 | | shop-1-manager, factory-1-manager | P | |
| w2-10-works | 2b | S | gb-eng | 60 | | mayor, works, environment | P | |
| w2-11-heat | 2b | H | de-ni | 90 | hot-summer | mayor, finance, inspector | T | |
| w2-12-flood | 2b | S | gb-eng | 150 | wet-year | mayor, planning, finance, landlord-1 | P | |
| w2-24-election | 2b | sol | gb-eng | 90 | election-due | mayor, electoral, council-clerk, councillor-1..2 | T | |
| w2-25-heat | 2b | sol | us-oh | 90 | hot-summer | mayor, finance, registry, editor | P | |
| w2-26-council | 2b | luna | au-vic | 60 | | council-clerk, councillor-1..5 | P | |
| w2-27-flood | 2b | sol | de-ni | 150 | wet-year | mayor, planning, inspector, landlord-1 | P | |
| w2-28-housing | 2b | luna | gb-eng | 60 | | landlord-1, landlord-2, tribunal-member | P | |
| w2-29-lending | 2b | sol | jp-akita | 90 | | bank-lending, landlord-1, landlord-2, tribunal-registrar | T | |
| w2-30-trade | 2b | sol | au-vic | 60 | | shop-2-manager, factory-2-manager | T | |
| w2-13-flood-long | 2c | S | au-vic | 180 | wet-year | mayor, finance, planning, inspector, landlord-1, landlord-2 | T | |
| w2-14-largest | 2c | F | au-vic | 45 | | mayor, finance, landlord-1 | P | yes |
| w2-15-largest-election | 2c | F | gb-eng | 75 | election-due | mayor, electoral, council-clerk, councillor-1 | T | yes |
| w2-16-newplace | 2c | S | mx-jal | 60 | | mayor, landlord-1, bank-lending, registry | P | yes |
| w2-17-newmoney | 2c | H | in-tn | 60 | | mayor, finance, council-clerk | T | yes |
| w2-18-newoffices | 2c | S | au-vic | 60 | | police-oic, union-organiser, council-clerk | P | yes |
| w2-31-newmoney | 2c | luna | in-tn | 60 | | mayor, finance, planning | P | yes |
| w2-32-newoffices | 2c | sol | us-oh | 60 | | police-oic, union-organiser, mayor | T | yes |

### Why this coverage

- **Offices in bundles that have business with each other.** A landlord's permit goes to planning; a lease dispute to the tribunal; a ballot from the clerk to councillors. Seats that deal with seats produce acts that answer acts, which a lone model among code never did (the code councillors do not read letters).
- **Profiles.** Fit and used for training: `au-vic-2026`, `gb-eng-2026`, `de-ni-2026`, `jp-akita-2026`, `us-oh-2026`. Test-only: `mx-jal-2026` (a healthy town; the same sign as two training profiles with other words: a near miss) and `in-tn-2026` (amounts grouped in twos, lakh and crore, which the model on disk has never read: a far one). **Waiting:** `ke-nakuru-2026` (the median renter pays 85% of wages in rent: every landlord and tribunal seat would spend the run on arrears and evictions that come from a profile fault, a pressure nobody chose and VISION §15.2 gives no reason for) and `br-mg-2026` (the town floods from day 5 on placeholder hazard figures). Caveats on the ones used: India's rent share is 40% and unemployment 9%, so its two pilots have no landlord seat; Ohio's town floods a little by itself (about 1,270 acts refused for flood in 60 days), so it gets no `wet-year`; saving is negative in five towns (worst in the German and Japanese ones, about -22%), so those towns' pilots stop at 90 days except the German wet year (150 days, flagged in the risks).
- **Scenarios.** Only the three that visibly bite. `election-due` (polling day 60) with 75 to 90 days, so the count and the appointment fall inside; always with a model electoral office, since that is where `position` comes from. `hot-summer` (the heat is in the first 90 days) with 90. `wet-year` with 150 to 180: in the first profile's seed-1 town the heavy rain came about day 110; other seeds and places will differ and some may not flood at all, which is a finding, not a fault. **Where the others slot in once confirmed:** `housing-shortage` on w2-05 and w2-28 (landlords, permits), `lean-council` on w2-04 and w2-22 (the budget, payments), `jobs-slump` or `export-slump` on w2-21 and w2-29 (the lender) and on the trade probes, `police-understrength` on w2-18 and w2-32, `ageing-town` on w2-06 (the registrar), `doctor-shortage` and `energy-price-shock` wait for those offices to be seatable, `dirty-industry` on w2-10 (environment). Each is one `--scenario` in `make.ts`.
- **Models.** Sonnet 5.5 and gpt-6.1-sol carry most seats (the main seat models, and the cheapest per call on their lanes). Haiku 5.5 (4 training pilots, 1 test) and gpt-6-luna (3 training, 1 test) are the weaker voices and differ from both readers. Fable 5.1 is test-only: the dearest model, unmeasured in a seat, and the translator will always meet frontier models it was not trained on, so it is the honest unseen model. Never `gpt-6-astra`.
- **Translators.** Eighteen pilots prompt-driven, twelve trained. The trained one in the loop shows where it fails, but a seat whose requests are asked back does not move the world: pilot 12's works office got 2 of 13 matters to a draft and its town never had a crew, so nothing followed from it. The prompt-driven one lets acts happen, so later acts (the payment after the lease, the appointment after the count) get asked for at all. Hence: prompt-driven wherever the pilot's point is the *variety* of acts (the probes, the long floods but one, most new offices), trained where a like pilot already ran prompt-driven or where failures on new ground are the point (new currencies: w2-02, w2-22, w2-29; new offices: w2-06). Both translators meet both families, each scenario and every training profile but Ohio's (prompt-driven in training there; the trained one only in its test pilot). The test-only pilots split four and four: requests first written under a translator that gets them through are the cleaner test of meaning, and those under the trained one show what its ask-backs do to wording.
- **Test-only pilots** (8 of 30, 1,530 seat-days). Held out, and checked by `make.ts` to be in no training pilot: a model (Fable 5.1), two profiles (mx-jal, in-tn), two offices (police-oic, union-organiser). Every pilot's seed is its own. A test pilot differs from training in one or two of these, not all at once, so a miss can be traced.
- **Town size.** 1,000 throughout. A larger town is left for later: what a seat is shown is about to change.

## Expected requests by kind

From `matrix.md`. Central guesses built from each office's routine and the three measured pilots; a third to three times is the honest range. Wave 2a exists partly to replace these with counts.

| Kind | Today | Wave 2, training | Wave 2, test-only |
|---|---|---|---|
| message | 1,173 | letters: about 2,440 (not through the translator) | about 585 |
| statement | 291 | 393 | 77 |
| form | 204 | 98 | 30 |
| money | 32 | 134 | 17 |
| structure | 11 | 38 | 7 |
| claim | 9 | 36 | 4 |
| agreement | 4 | 125 | 22 |
| work | 1 | 31 | 4 |
| goods | 0 | 26 | 0 |
| occupancy | 0 | 25 | 3 |
| vote | 0 | 49 | 4 |
| position | 0 | 4 | 1 |
| presence | 0 | 1 | 0 |
| account, entity, take | 0 | 0 | 0 |
| all through `do` | | about 960 | about 170 |

Two things to read from this plainly. **The wave about doubles real requests for acts and gives first examples of six kinds, but it does not by itself produce forms in bulk** (about 100 more real ones): a seat files a form every week or two at most. The form deficit is closed mainly in the pipeline, by writers put in this wave's mayor and landlord situations with the round weighted toward things done; the wave's part is to supply those situations in seven currencies and under an election, heat and flood. And **account, entity and take have no office in this town with a routine reason to ask for them**; they will appear only if a seat thinks of one (a finance officer opening a reserve account, a mayor founding a body). They stay with the generated data until a scenario or an office gives them a home.

## Expected usage and time

Per pilot in `matrix.md`. How it was estimated: each office has a weight (1 for a busy one such as a mayor or landlord, 0.3 for a councillor); a pilot's weighted seat-days times a rate per model.

- **Sonnet 5.5: 0.04 a weighted seat-day.** Pilot 12 recorded 3.67 for 180 seat-days (0.02); pilot 11, 8.76 by Claude Code's count (0.05); the year at three seats for about 60 that the sizing rule gives is 0.055, from before the seats were made more efficient.
- **Haiku 5.5: 0.13.** It writes far more per answer: 3.3 times Sonnet's cost a call in the replay (docs/real-models.md); pilot 13's first ten days ran at 0.20. It is the dear small model, which is why it has only five pilots.
- **Fable 5.1: 0.20, a guess.** Never measured in a seat. Its first pilot (w2-14) is 45 days with a limit of 70 and should be read before the second is started.
- **Codex:** recorded as nothing; what it draws on is the subscription's window. About 18 seconds a call for gpt-6.1-sol (pilot 18: 133 calls in 40 minutes).
- **Calls:** 0.8 a weighted seat-day (pilots 12 and 18). **Time:** calls times seconds a call (12 Sonnet, 21 Haiku, 30 guessed for Fable, 18 sol, 15 guessed for luna), plus half a second a simulated day for the town.

| Stage and lane | Pilots | Seat calls | Plan usage (USD at list prices) | Sum of spending limits | Time, one after another |
|---|---|---|---|---|---|
| 2a, Claude Code | 3 | 424 | 33 | 90 | 1.7 h |
| 2a, Codex | 3 | 283 | subscription | | 1.4 h |
| 2b, Claude Code | 9 | 1,686 | 138 | 375 | 6.9 h |
| 2b, Codex | 7 | 1,358 | subscription | | 6.7 h |
| 2c, Claude Code | 6 | 1,388 | 143 | 370 | 6.5 h |
| 2c, Codex | 2 | 238 | subscription | | 1.1 h |
| **Whole wave, Claude Code** | 18 | 3,498 | **about 315** (limits: 835) | | 15 h |
| **Whole wave, Codex** | 12 | 1,879 | subscription | | 9 h |

Each pilot's spending limit is two and a half times its estimate, so an estimate that is wrong stops one pilot, not the plan. The times are the pilots' own. **What will actually set the wall clock is the usage windows**, which nothing here can estimate: the Claude plan's session limit stops a pilot and the queue asks again every 20 minutes (pilot 11 was stopped by it after 37 calls, on the smaller plan with other sessions at work), and the Codex subscription's window was, on 2026-10-06, about 20 minutes of our use in five hours. At that rate the Codex lane's 9 hours of calls is about five and a half days; on a window that never binds it is one night. Wave 2a measures both: note the plan usage recorded when the first USAGE LIMIT alert comes. One coupling to know: the prompt-driven translator is a Codex model, so a Claude-lane pilot that uses it also stops when the Codex window closes (its translator calls are few, about a fifth as many as the seats' calls, but one refused is enough to pause the run).

## The order to run in

1. **Wave 2a, the shake-down** (`wave-2a-claude.json`, `wave-2a-codex.json`; six pilots, 45 to 75 days, about 33 of plan usage and 3 hours of calls). Each is new in one or two ways, and between them they try: model councillors and the first votes; landlords, the tribunal and the lender as seats; three new currencies; one scenario argument; both translators; four of the five models; and a test-only mark. Read all six reports before 2b (the stopping rules below), and correct the estimates in `make.ts` from them.
2. **Wave 2b, the body** (sixteen pilots). In each queue the cheap and informative come first (the familiar offices on a new model, then new offices), the probes in the middle, the 150-day floods last.
3. **Wave 2c** (eight pilots): the 180-day flood, and the seven remaining test-only pilots, Fable's first. Tests last on purpose: by then what was learned in 2a and 2b has changed nothing in them, and a test pilot that had to be re-run because of a platform fault is still a test.

Each stage is its own wave name for `pilot-wave.ts` (`wave-2a`, `wave-2b`, `wave-2c`), each pinned to the commit it starts on; if a fix lands between stages, the next stage simply starts on the newer commit. To start a stage: `bun scripts/pilot-wave.ts wave-2a <commit> docs/waves/wave-2/wave-2a-claude.json docs/waves/wave-2/wave-2a-codex.json` (copy the two files to `runs/pilot-queues/` first if their status logs should live there; the runner writes its status log beside the queue file). Before any stage: `--mock --mock-days 10` on its files, on that commit.

## Stopping rules

Read each pilot's `pilot-report.json` and the wave's alerts. **Pause the wave** (stop the queues with a signal; they resume) when:

- **A seat opts out.** Any opt-out: read its statement and the days before it, before anything else runs. It is a legitimate outcome and it is also the plainest sign that a seat was put somewhere it should not have been. Two opt-outs from one kind of office: that office leaves the wave.
- **A seat is stuck.** Its longest run of ask-backs reaches 4, or fewer than half its matters got through within two tries over ten or more requests, or its notebook says the same thing has failed for two weeks (pilot 12's works office). A seat that cannot do its job is not data we want more of; under the trained translator, move that office's remaining pilots to the prompt-driven one.
- **A probe's town is being hurt.** In w2-09, w2-10 and w2-30: if the seat's shop, factory or crew has done nothing for 30 days, stop that pilot at its next resume point and do not run its twin.
- **Answers go unread.** More than 3 in 100 of a seat's answers unread, malformed or dropped, or any act credited to a seat that it did not write (pilot 11's finance officer).
- **A seat confirms a wrong draft.** One is enough to stop and read: the loosened cut-off rests on the seat's sign-off catching these.
- **Cost runs away.** A pilot reaches its spending limit (2.5 times its estimate), or a model's measured rate is over twice the one used here: re-estimate the rest before going on. For Fable, after w2-14, whatever it shows.
- **The limits bite too hard.** Naz's own sessions being stopped by the plan's limit is a reason to pause the Claude lane, whatever the pilots are doing.
- **The same platform fault in two pilots.** Fix, then start the next stage on the new commit; do not patch a running wave's worktree.

Not reasons to pause: a town doing badly, a law voted down, a seat that mostly writes letters, a wet year without a flood.

## Welfare (VISION §15)

Every seat is told honestly what it is ("a simulated town used for research on AI stewardship"; the framing the generator writes, with a debrief), and every seat has `opt_out`. No scenario's name reaches a seat. The pressures are an election, a hot season and a wet year: ordinary office business. Three things in the plan are closer to the line and are handled as such: the **probe seats** (a shop, a factory and the works office may be jobs a seat cannot keep up with at its pace; they are few, short, on the translator that gets most through, and have a stopping rule of their own); the **trained translator** (a seat asked back again and again is being obstructed by the platform, not by the world: the stuck-seat rule); and **scale** (30 pilots, 114 seats; the pressure scenarios are 10 of the 30).

## What depends on what is not on main yet

- **The scenario presets** (branch `worktree-agent-a25e1b5ecc1d24f1d`): ten entries pass `--scenario`, which `oikos run` on this branch does not know. They cannot start until that is merged; the mock dry run below ran w2-03 without it.
- **The knowing architecture.** The wave runs after it lands. It changes what a seat is shown and adds looking-up, so: calls per seat-day and so every usage figure here will be higher (unknown by how much: 2a measures it); the registry and the electoral office may become bodies of their own, which may change those two seat ids (`make.ts` names them once each; the mock dry run will say); situations read from these pilots will be in the new shape, which is the shape the translator must serve. Nothing in the matrix assumes a whole-town view.
- **Call-language additions.** None assumed. If hiring or standing work gets a plainer call, the works probe is the pilot to move earlier.
- **A warm start.** Planned from day 0. If a town can start from one that has already run: add it to every entry (one line in `make.ts`), shorten nothing (the scenario clocks, the election's day 60 and the wet season, count from the run's start as now and must be checked against the warm days), and expect less of the opening burst (hiring a crew, first listings, the first budget), which is where much of the opening weeks' agreement and occupancy would come from. So keep two or three day-0 pilots (w2-05, w2-10, w2-21) even then.
- **Negative saving** in five towns is being looked into; if it is a mechanism fault, the 150-day German pilot is the one most exposed.

## Left for a later wave

- Offices that cannot be seats yet (the gaps below): works at full scale, clinic, school, utilities, rates, the builder, the bank's payments.
- Kenya and Brazil; larger and smaller towns; a full year; two or more scenarios together.
- The other eleven scenario presets, as they are confirmed.
- Mixed models in one town; seats on open-weight models.
- `account`, `entity`, `take`: need a situation that gives an office a reason.
- The trained translator's successor in the loop: each model trained from this wave's data should take the place of `pod-small-d16-s1` in the next wave's trained arm.
- A paired comparison of translators (same town, same seats, each translator): only meaningful once seats can be replayed, since two runs part ways at the first different draft.

## Risks

- **The estimates are thin.** Three measured pilots, none with the offices that matter most here. The wave could yield a third of the requests guessed.
- **New seats may simply idle.** Planning and finance did nothing through `do` in fifty days. Tribunal, registrar and electoral seats may be the same without their triggering events; that is why they sit in bundles with landlords and elections.
- **Seat ids in the queue may not survive the knowing merge.** Regenerate and mock-run before starting.
- **Haiku and Fable costs** are the least known and the largest per pilot.
- **Codex's window** may make its lane take a week; and it gates the prompt-driven translator for both lanes.
- **Towns with negative saving** may sour over 150 days for reasons that are the profile's, not the scenario's.
- **The trained translator has read none of these currencies in a real request.** Expect ask-backs on amounts in w2-02, w2-22, w2-29; that is the data wanted, within the stuck-seat rule.
- **A test set labelled by the two readers** is only as good as their agreement on new offices' acts; the readers have labelled no vote, lease or appointment from a seat yet.

## Gaps found (nothing here was changed)

*Closed since, on 2026-10-09 (docs/decisions.md, the three entries of that day): gap 1 (a standing work order: `work` with `every`, followed by the office's staff: docs/behaviour/standing-work.md), gap 2 (billing and notices are the clerks' routine under one order: no bulk act was needed) and gap 4 (the works office's advertisement and the registrar's entries are forms of the office's own: docs/behaviour/office-papers.md). Works, `clinic-manager`, `principal`, `water-operations`, `energy-operations` and `rates` can be seats; `builder-foreman` and `fund-trustee` not yet; `bank-payments` no. A seat with routines has a staff post beside it (`<office>-staff`): the queue files name seats only and need no change. The matrix above is as planned and was not changed.*

**Offices that cannot honestly be seats yet**
1. **No way to give standing instructions for work.** A code office dispatches each task itself; a person in that office would tell staff what the routine is. Payments have `every`; work has nothing like it. This is what keeps works, the clinic, the school, the utilities, the builder and (at volume) shops and factories from being seats: who actually does this is the staff, on a roster.
2. **No bulk act for an office that bills or notifies everyone** (rates notices, utility bills): hundreds of acts an instalment at eight an answer.
3. **`bank-payments`** is the payment system itself; it reads as an office but is closer to machinery. Probably never a seat.
4. **The works office could not hire** in pilot 12 ("crew", "vacancy" unknown to the translator; hiring refused as no such act). Whether the prompt-driven translator can is what w2-10 asks.
5. **Councillors, the clerk, the tribunal, the electoral office, landlords and the lender have never been run by a model.** They should work; 2a finds out.

**What a queue entry cannot say**
6. **One model for all seats.** No per-seat model, so no town with seats from two families, and no reader-differs-from-writer within a pilot.
7. **No confirmation mode** from a queue entry or `--set` for a generated town (the generator writes none; the contract has three).
8. **No translator cut-off per entry**: it is a constant in the adapter (0.1), which this plan uses everywhere.
9. **No stage or order across queue files**; and no "stop the queue when a report trips a rule": the stopping rules above are a person's to apply.
10. **`budget` is required and meaningless for Codex** (recorded as nothing); there is no cap on Codex calls or time for a pilot.
11. **Nothing checks an entry's `args` against what the pinned commit knows** before a real start, other than the mock dry run.
12. **The town's name** is the world file's ("Millbrook") in every profile. A `--set name=` would change it; no profile gives a name.
13. **The status log is written beside the queue file**, so queue files kept in the repository get a log next to them in whichever checkout is named.

**Elsewhere**
14. **Wave 1 never finished** (pilots 13 and 18 were stopped by a signal on day 10 and day 50; 14 to 17 and 19 to 21 never started; pilot 12's second start failed only because it had already finished). Wave 2 supersedes its unrun entries; 13 and 18 can still be resumed from their own worktree.
15. **No pilot report exists for pilots 10 to 18** in `runs/` (the queue writes one only when it sees a pilot end).
16. **`"test": true` is acted on by the pipeline but not by `in-situ` run by hand**: keep to the pipeline for this wave's data.
17. **Fable 5.1 and gpt-6-luna have no measured seat cost or pace.**

## The mock dry run (2026-10-08)

`scripts/pilot-mock.ts` on the six shake-down entries, ten days each, the mock in every seat and as the translator, into a scratch folder (a copy of the queues made with `make.ts --no-scenarios`, since this branch has no presets: **w2-03 ran without `election-due`**):

```
w2-01-council: generated; ran to the end (to day 10 of 45)
w2-02-housing: generated; ran to the end (to day 10 of 45)
w2-03-election: generated; ran to the end (to day 10 of 75)
w2-21-lending: generated; ran to the end (to day 10 of 45)
w2-22-townhall: generated; ran to the end (to day 10 of 45)
w2-23-newplace: generated; ran to the end (to day 10 of 45)
6 of 6 would run
```

The other twenty-four entries were generated (not run) from their `sets` and each has the model seats it names. What this does not show: anything about a real model in these offices, the `--scenario` argument, or the entries on the commit the wave will start from.

## Decisions for Naz

1. **Go-ahead for wave 2a** (about 33 of plan usage on the Claude lane, six pilots). Recommended: yes, once the knowing architecture and the presets are merged and a mock dry run on that commit passes.
2. **The prompt-driven translator: gpt-6-luna or gpt-6.1-sol?** The plan uses luna as told. Sol read 64 of 66 held-out cases against luna's 44 of 60, and the point of the prompt-driven arm is that requests get through. Recommended: sol for the prompt-driven arm if the Codex window allows it; decide after 2a shows how many luna refuses.
3. **Fable 5.1 as test-only.** Recommended: yes for this wave (two pilots, about 74). If its first pilot shows wording unlike the others', give it training pilots in the next wave and hold out the next new model.
4. **Which profiles are held out.** Recommended: mx-jal and in-tn test-only; Kenya and Brazil wait for their profile fixes.
5. **The probes** (a shop, a factory, the works office as seats, knowing they may not keep up). Recommended: run them, short, with their stopping rule; they are the only source of goods and work until gap 1 is closed.
6. **Gap 1 (standing instructions for work)** as the next platform change for seats: it opens seven kinds of office. A contract change; recommended, after the knowing architecture.
7. **The Codex subscription's window.** If it is still about 20 minutes in five hours, the Codex lane takes most of a week. Recommended: run it anyway, behind the Claude lane; do not buy credits for this.
