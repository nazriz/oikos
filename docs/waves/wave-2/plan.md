# Wave 2: the first real wave of pilots

**Status: second version, 2026-10-09. Not run.** The owner has given a standing go-ahead for the wave once its gates pass; the coordinator starts it. No pilot has been started and no model called in making this. The queue files beside this page are ready for `scripts/pilot-wave.ts`; the tables are in `matrix.md` (written by `make.ts`, like the queues: change the plan there and run it again).

## What changed from the first version (2026-10-08), and why

The first version was written before the knowing architecture, the offices' own forms, directions, standing work and the scenario presets were on main, and before any model had been run on them. All are on main now, and four 12-day pilots with real models (the live check, `runs/live-check-2026-10-09/README.md`) have said what the pace is.

1. **Seat ids were read again from a generated town.** All nine profiles generate the same offices. Every id the first version used still exists. `land-registrar` is new (the land registry is a body of its own; `registry` is still the town's register of births and deaths, the one the owner asked for, and the land registrar sits beside it in two pilots). `electoral` belongs to the electoral commission now.
2. **The electoral office is no longer a seat.** The first version seated it in every election pilot, as the source of `position`. Two things changed that. The appointment is now the council clerk's act (the commission declares; the clerk seats whoever is declared). And a seat cannot hold an election: the roll, the ballot paper and the count are lists of hundreds, not forms and not eight acts a sitting, and the office has no staff routine for them yet (docs/behaviour/office-papers.md). A model there would be a seat set a task it cannot do, and a town with no election. The commission is run by code in all five election pilots.
3. **Works and the registry are seats**, as the owner asked: each in training pilots on four seat models (Sonnet 5.5, Haiku 5.5, gpt-6.1-sol, gpt-6-luna), and in test pilots. Three works pilots start with the crew still to be taken on (`works_crew_at_start=0`: the office advertises on its form, offers employment, then sets its round); the rest start with a crew.
4. **The other newly possible offices appear as short probes:** the clinic and the school (w2-43), the two utilities and rates (w2-44), rates, water and the school on the other family (w2-36).
5. **Directions have somewhere to go.** A model mayor sits beside a code-run works office in 22 pilots (a code office follows a direction filed on its form by the mayor or the clerk, and writes back), and beside a model works office in six.
6. **Scenarios.** `lean-council` and `dear-rents` are new (two and three pilots). `hot-summer` falls to two (it bites faintly). `election-due` (four) and `wet-year` (three) stay. Nothing inert is named. Every scenario pilot passes `--scenario`, which main now knows; `make.ts` no longer has a way to leave them out.
7. **The trained translator serves five pilots, not twelve.** `decide/pod-small-d16-s1` was taught none of the hold, the entry on one's own file, `look_first`, an office's own forms, directions or standing work. It serves no works or registry seat, and no office whose daily business is papers of its own (`make.ts` refuses such an entry).
8. **The prompt-driven translator is gpt-6.1-sol for 26 pilots and gpt-6-luna for 12** (below, "Translators").
9. **A model council clerk in three pilots only**, none longer than 75 days (a clerk held by the mock counts no votes; a model's is untried).
10. **43 pilots, not 30:** thirteen added, none dropped. The Claude Code lane grew most (25), because its usage is not the constraint (the owner's word, and the live check's figures); the Codex subscription's window is.
11. **Each pilot is a town of its own, on purpose** (below, "Towns").
12. **Every estimate was rebuilt** on the live check and the office demonstration (below).
13. **Stopping rules gained three** (a prompt too long; letters not sent; a clerk counting no votes), and the lanes are arranged so that the Claude lane is not starved of the Codex window.

## What the wave is for

Pilots exist first to gather data for the trained translator. The data so far is letters and a few forms from three calm offices in one town in one currency. This wave is built to change that, in this order:

1. **Acts nobody has asked for.** Eight of the sixteen kinds of act have never been requested by a seat, and since the first version the call language has gained a hold, an entry on one's own file, forms for an office's own papers, directions and standing work, of which real seats have asked for eight things in all (five forms, two entries, one hold: the live check). So the wave seats the offices whose business those are: works (advertisements, offers, standing work orders), the registry (register entries), councillors (votes), a clerk (ballots, results, the appointment), landlords, the lender, the tribunal, and, as probes, the clinic, the school, the utilities, rates, a shop and a factory.
2. **Forms and the seats' own wording.** Nearly every office now has forms of its own (41 of them), so most of what a seat does is a form. Every request a seat makes is in its own wording.
3. **Other places' money.** Seven profiles, five in training: a sign before, a decimal comma, no smaller unit, and (test only) groups of two with lakh and crore. The live check could not say whether an amount written the German or the Japanese way is read: no such amount reached an amount field. This wave has eight German and four Japanese towns.
4. **Other situations.** Fourteen pilots start under one of five presets that reach an office.
5. **Other writers.** Five seat models from two families; in 16 of 43 pilots the seats are on a model that is neither of the two labelling readers.
6. **A test that measures generalisation.** Eleven whole pilots are test-only.

What it is not for: comparing stewards, or any claim about how models govern.

## What is known about seats now

- **Any office can be named a seat** (`model_seats=<office id>,...`; the mayor by `mayor=llm`). The offices a generated town has, in every profile: mayor, planning, inspector, finance, works, environment, rates, registry, child-protection, council-clerk, councillor-1 to 5 (the town's); land-registrar (the land registry's); electoral (the electoral commission's); bank-lending, bank-payments; builder-foreman; editor; clinic-manager; principal; tribunal-member, tribunal-registrar; water-operations, energy-operations; police-oic; union-organiser; twenty `landlord-N-office`, thirty `shop-N-manager`, ten `factory-N-manager`. `outside-*`, `weather-bureau` and `migration` stand for the world beyond the town and are not seats. Read from the generator on 58a0ba7; a `model_seats` entry that names no office fails generation, and the dry run below generated every entry.
- **A model in a seat replaces the office's code**, except its routines: where the office has them (works, clinic, school, both utilities, rates) its staff are a post of their own (`<office>-staff`), run by code, who do the routine only while a standing work order is in force. The seat sets the orders and manages by exception. A queue entry names seats only; the staff post comes with the seat.
- **A seat is shown no town and no register.** It is shown its own papers, and asks, looks up and sends someone for the rest. In the live check a Claude seat's first sitting was shown 1,200 to 11,300 characters.
- **One model for every seat of a run.**
- **Only `do` goes to the translator.** A letter goes as written.
- **The pace is the model's, and the two families differ fivefold.** In twelve days three Claude seats made 8 to 15 answers a pilot and sat about twice each; three gpt-6.1-sol seats made 43, wrote 83 letters, looked 63 times and kept every report coming each sitting.
- **Confirmation is `always`** in every generated town.

| Office | As a seat | What it has to ask for (docs/behaviour/office-papers.md) | In this wave |
|---|---|---|---|
| mayor | works (pilots 7 to 18; the live check) | the council proposal, amendment and permit forms; `nomination`, `invoice_approval`; **directions** on an office's form; structures | 28 pilots |
| finance | works; the live check's finance officers made the first holds and entries | payments, **holds**, **entries on its own file** | 14 |
| planning, inspector | work; little through `do` | `permit_decision`, the liberty to build; `valuation_request`, `demolition_order`, fines | 9, 4 |
| **works** | new (2026-10-09): untried with a model | `job_advertisement`, offers of employment, **standing work orders** (`collect`, `maintain`), holds on them | 9 (6 training on four models, 3 test) |
| **registry** | new forms; pilot 12's registrar asked twice and registered nothing | `death_registration`, `death_certificate`, `birth_registration`, `transmission_application` | 13 (8 training on four models, 5 test) |
| land-registrar | untried; no forms of its own | transfers and transmissions (claims), answers to searches | 2 |
| council-clerk | untried; **a mock clerk counts no votes** (open fault) | `council_ballot`, `council_result`, `adopted_budget`; **position** (seating the winner); directions | 3, short |
| councillors | untried | **votes** | 5 (two with a code clerk) |
| editor | untried | `news_item` | 5 |
| child-protection | untried; rarely has business | **presence** | 2 |
| tribunal-member, tribunal-registrar | untried | `tribunal_order`; `garnishee_order` | 3, 3 |
| landlord offices | untried; busy | `rental_listing`, `rent_increase`, `tax_report`, leases, payments, building | 12 |
| bank-lending | untried | `loan_decision`, `loan_payout`, loan agreements | 4 |
| environment | untried | `job_advertisement`, `habitat_register`, survey work | 2 |
| **clinic-manager, principal** | new: **probes** | a standing order each (`treat`; `teach`, `enrol`), staffing | 1, 2 |
| **water-operations, energy-operations, rates** | new: **probes** | standing orders (`draw_water`, `bill`; `supply_energy`, `bill`; `levy`) | 2, 1, 2 |
| shop and factory managers | **probes**: serving and making are still by hand | **goods**, work, `order`, `delivery_note`, payments | 2 pilots, 30 days |
| police-oic, union-organiser | untried | `charge`, investigations; `wage_claim`, ballots | 2 each, **test-only** |

**Not seats, and why.** `bank-payments`: never; it is the payment system. `builder-foreman`, `fund-trustee`: not yet; their routines are not standing work (and the fund is off by default). `electoral`: not yet; item 2 above.

## The matrix

`matrix.md` has it in full with seeds, estimates and coverage. In short (S = `claude-code/claude-sonnet-5-5`, H = `claude-code/claude-haiku-5-5`, F = `claude-code/claude-fable-5-1`, sol = `codex/gpt-6.1-sol`, luna = `codex/gpt-6-luna`; translator Ps = prompt-driven gpt-6.1-sol, Pl = prompt-driven gpt-6-luna, T = trained `decide/pod-small-d16-s1`). Every town is 1,000 people from day 0. In each stage and lane the order is the queue's.

| Pilot | Stage | Seat model | Profile | Days | Scenario | Seats | Tr. | Marks |
|---|---|---|---|---|---|---|---|---|
| w2-10-works | 2a | S | gb-eng | 45 | | works, registry, environment | Ps | probe; no crew |
| w2-01-council | 2a | S | au-vic | 45 | | mayor, council-clerk, councillor-1..5 | Pl | model clerk |
| w2-03-election | 2a | S | de-ni | 75 | election-due | mayor, editor, council-clerk | Ps | model clerk |
| w2-04-townhall | 2a | H | us-oh | 45 | | mayor, finance, planning | T | |
| w2-33-works | 2a | sol | au-vic | 30 | | mayor, works, registry | Ps | probe; no crew |
| w2-22-townhall | 2a | luna | jp-akita | 30 | | mayor, finance, planning | T | |
| w2-23-newplace | 2a | sol | mx-jal | 30 | | mayor, landlord-3, registry | Ps | test |
| w2-41-works | 2b | H | jp-akita | 90 | | mayor, works, registry | Ps | |
| w2-42-townworks | 2b | S | us-oh | 90 | | mayor, works, finance | Ps | no crew |
| w2-45-lean | 2b | S | de-ni | 90 | lean-council | mayor, finance, planning | Ps | |
| w2-06-justice | 2b | S | de-ni | 90 | | tribunal-member, tribunal-registrar, registry, land-registrar, child-protection, inspector | Ps | |
| w2-08-heat | 2b | S | jp-akita | 90 | hot-summer | mayor, registry, editor, child-protection | Ps | |
| w2-05-landlords | 2b | S | us-oh | 90 | dear-rents | landlord-1, -2, -3, bank-lending | Pl | |
| w2-02-housing | 2b | H | gb-eng | 60 | dear-rents | landlord-1, landlord-2, tribunal-member, tribunal-registrar | Pl | |
| w2-07-election | 2b | H | au-vic | 75 | election-due | mayor, council-clerk, councillor-1..3 | Pl | model clerk |
| w2-43-care | 2b | S | gb-eng | 45 | | clinic-manager, principal | Ps | probe |
| w2-44-utilities | 2b | S | au-vic | 45 | | water-operations, energy-operations, rates | Ps | probe |
| w2-09-trade | 2b | S | au-vic | 30 | | shop-1-manager, factory-1-manager | Ps | probe |
| w2-12-flood | 2b | S | gb-eng | 150 | wet-year | mayor, planning, finance, landlord-1 | Pl | |
| w2-11-heat | 2b | H | de-ni | 90 | hot-summer | mayor, finance, inspector | T | |
| w2-34-works | 2b | sol | de-ni | 60 | | works, registry, land-registrar, environment | Ps | |
| w2-35-works | 2b | luna | gb-eng | 60 | | mayor, works, registry | Ps | |
| w2-24-election | 2b | sol | gb-eng | 75 | election-due | mayor, editor, councillor-1..2 | Ps | |
| w2-26-council | 2b | luna | au-vic | 45 | | mayor, councillor-1..5 | T | |
| w2-37-lean | 2b | luna | gb-eng | 60 | lean-council | mayor, finance, planning | Pl | |
| w2-36-offices | 2b | sol | us-oh | 45 | | rates, water-operations, principal | Ps | probe |
| w2-30-trade | 2b | sol | au-vic | 30 | | shop-2-manager, factory-2-manager | Ps | probe |
| w2-21-lending | 2b | sol | au-vic | 45 | | bank-lending, finance, landlord-1 | Pl | |
| w2-25-rents | 2b | sol | us-oh | 60 | dear-rents | mayor, landlord-1, registry, editor | Ps | |
| w2-28-housing | 2b | luna | de-ni | 60 | | landlord-1, landlord-2, tribunal-member | Pl | |
| w2-29-lending | 2b | sol | jp-akita | 60 | | bank-lending, landlord-1, landlord-2, tribunal-registrar | Pl | |
| w2-13-flood-long | 2c | S | au-vic | 180 | wet-year | mayor, finance, planning, inspector, landlord-1, landlord-2 | Pl | |
| w2-14-largest | 2c | F | au-vic | 45 | | mayor, finance, landlord-1 | Ps | test |
| w2-46-largest-works | 2c | F | de-ni | 45 | | mayor, works, registry | Ps | test |
| w2-15-largest-election | 2c | F | gb-eng | 75 | election-due | mayor, editor, councillor-1..2 | Ps | test |
| w2-16-newplace | 2c | S | mx-jal | 60 | | mayor, landlord-1, bank-lending, registry | Ps | test |
| w2-47-newplace-works | 2c | H | mx-jal | 60 | | works, registry, finance | Ps | test |
| w2-18-newoffices | 2c | S | au-vic | 60 | | police-oic, union-organiser, finance | Ps | test |
| w2-17-newmoney | 2c | H | in-tn | 60 | | mayor, finance, planning | T | test |
| w2-38-newmoney-works | 2c | sol | in-tn | 60 | | mayor, works, registry | Ps | test |
| w2-31-newmoney | 2c | luna | in-tn | 60 | | mayor, finance, planning | Pl | test |
| w2-32-newoffices | 2c | sol | us-oh | 60 | | police-oic, union-organiser, mayor | Ps | test |
| w2-27-flood | 2c | sol | de-ni | 150 | wet-year | mayor, planning, inspector, landlord-1 | Pl | |

### Towns

`oikos run --seeds N` is one generated town run N times; the town comes from the description's own seed. A queue entry runs `--seeds 1` with `--set seed=N`, and `seed` is the description's: so the generator makes the town of seed N, and the run's seed follows it. That was already what the first version's entries did; it is now said and checked. `make.ts` refuses two entries with one seed. Seeds are 100 + the pilot's number (900 + for a test-only pilot); none was used before (the live check's were 801 to 804). After the dry run, each mock run's `batch.json` was read: 43 different seeds, each the town's and the run's. `--towns T` is for a batch of several towns from one command and has no place in a queue entry, which is one run.

### Why this coverage

- **Offices in bundles that have business with each other.** A landlord's permit goes to planning; a lease dispute to the tribunal; a ballot from the clerk to councillors; a death from the registry to the land registry; a direction from the mayor to works.
- **Works, three ways.** Under a code mayor (w2-10, w2-34: the office alone with its neighbours); beside a model mayor (w2-33, w2-41, w2-35: a direction reaches a model, who decides what to do with it); with the treasury too, for a quarter, from no crew (w2-42: the staff line, advertisements, offers, the round). No crew at the start in three: in the demonstration the town had 99 complaints about waste on days 11 to 16 before a crew came, so these are marked and watched (stopping rules).
- **Profiles.** Training: `au-vic-2026`, `gb-eng-2026`, `de-ni-2026`, `jp-akita-2026`, `us-oh-2026`. Test-only: `mx-jal-2026` and `in-tn-2026` (India's rent is 40% of income: no landlord seat there, which `make.ts` checks). All nine profiles run for 60 days. **Out:** `ke-nakuru-2026` (its rent share is still wrong for its dwelling mix: every landlord and tribunal seat would spend the run on arrears that are a profile fault) and `br-mg-2026` (it floods on a river-flow figure whose fix is not on main). **Where Brazil slots in once that lands:** as a third test-only profile's twin of w2-16 and w2-23 (mayor, a landlord, the registry; one pilot on each lane, 2c), or, if a sixth training currency is wanted more, as the profile of w2-45 and w2-28; one string each in `make.ts`, and the profile comes off `PROFILES_OUT`.
- **Scenarios.** `election-due` (polling day 60) with 75 days, so the count and the seating fall inside. `wet-year` with 150 to 180 (the heavy rain came about day 110 in the first profile's town). `lean-council` (the bank writes from day 16 that a wage failed; the crew resign from day 23) with a mayor, the treasury and a code works office: holds, and a direction not to recruit, are what a person there would reach for. `dear-rents` with landlords, the tribunal, the lender, and a mayor shown the petition. `hot-summer` twice only. `jobs-slump` and `housing-shortage` reach an office faintly and are left for a second scenario on a later wave's pilots (`--scenario a+b`).
- **Models.** Sonnet 5.5 (15 pilots) and gpt-6.1-sol (12) carry most. Haiku 5.5 (7) and gpt-6-luna (6) are the weaker voices. Fable 5.1 (3) is test-only. Never `gpt-6-astra`. No API key anywhere: Claude Code and the Codex CLI on the owner's subscriptions.
- **Test-only pilots** (11 of 43). Held out, and checked by `make.ts` to be in no training pilot: a model (Fable 5.1), two profiles (mx-jal, in-tn), two offices (police-oic, union-organiser). Works and the registry are in test pilots too, on the held-out model and in both held-out profiles, so the new acts have a test.

### Translators

| Translator | Pilots | Which, and why |
|---|---|---|
| `codex/gpt-6.1-sol`, prompt 0.9.0 | 26 | **Where a request not getting through loses the pilot's point.** Every works and registry pilot (pilot 12's works office got 2 of 13 matters to a draft and its town never had a crew); the probes; the elections w2-03, w2-24 and w2-15 (one nomination, one seating: no second chance); the lean council on Claude seats (holds); the test pilots (a request first written under a translator that gets it through is the cleaner test of meaning). On held-out requests it scored 64 of 66. |
| `codex/gpt-6-luna`, prompt 0.9.0 | 12 | **Where the acts are many and of kinds it has read:** landlords and lenders (leases, payments, listings: w2-05, w2-02, w2-21, w2-28, w2-29), the council of votes (w2-01), an election on the smaller model (w2-07), the floods (w2-12, w2-13, w2-27), and gpt-6-luna's own lean council and test town hall (w2-37, w2-31). It scored 44 of 60 held out; in the live check it got every request to a draft, as sol did. It also gives the data a second translator's ask-backs. |
| `decide/pod-small-d16-s1` (trained) | 5 | **Where its failures on new ground are the data and its offices are the ones it was taught:** three town halls (w2-04 Haiku in dollars, w2-22 luna in yen, w2-11 Haiku in euros under a hot summer), the council of councillors under a code clerk (w2-26: votes and proposals), and the Indian test town hall (w2-17). Even there it will fail on a hold, an entry, a direction or the mayor's own two forms; that is expected, and the stuck-seat rule is the limit. It needs no Codex window. |

In nine pilots the translator is the same model as the seats (gpt-6.1-sol on gpt-6.1-sol: w2-33, w2-23, w2-34, w2-24, w2-36, w2-30, w2-25, w2-38, w2-32): the labelling readers are two, and the pipeline reads these with the other one first.

**The coupling, and the lanes.** A prompt-driven translator is a Codex model, so a closed Codex window pauses every pilot that uses one: all of the Codex lane, and 22 of the 25 Claude Code pilots. The Claude lane needs very little of it (about 400 translator calls in the whole wave, two hours; the Codex lane's own seats need about 4,300 calls, 26 hours), but a queue waits on the pilot it is at and does not go on to the next. So:

1. **The Claude lane has first call on the Codex window.** In 2b and 2c, start the Claude lane's queue first and the Codex lane's queue when the Claude lane's is done, or has reached its last entry. The Claude lane of 2b is about six hours of calls; the Codex lane is days whatever is done, so it loses nothing that matters.
2. **In 2a both lanes run side by side** (it is small, and it is the measurement of the window): the Claude lane is started first, and the Codex lane's three pilots are 30 days.
3. **If a USAGE LIMIT alert names a Claude-lane pilot while the Codex lane is running**, stop the Codex lane's queue (a signal to its pid; it resumes where it stopped) until the Claude lane is through.
4. **Each Claude queue ends with its trained-translator pilot** (w2-04, w2-11, w2-17), which needs no Codex at all.
5. **In the Codex lane the order is by worth:** works and the registry first, then the short ones, the long and dear ones last; w2-27 (150 days, about 5 hours of calls) is the last entry of the last stage and is the one to drop.

## Expected requests by kind

From `matrix.md`. Central guesses; a third to three times is the honest range. Built from what each office's code does as a mock seat in sixty days at a sitting each working day (the office demonstration: the works manager asked for 18 things in 44 sittings, with 32 sittings in which there was nothing to ask; the registrar 4; the mayor 6), times a factor for the seat's model from the live check (three Claude pilots made 1 request each in 12 days where the offices' sixty-day business comes to 2.8 in 12; the gpt-6.1-sol pilot made 5: factors 0.4 and 1.8; gpt-6-luna 1, a guess).

| Kind | As of 2026-10-08 | Wave 2, training | Wave 2, test-only |
|---|---|---|---|
| message | 1,173 | letters: about 5,100 (not through the translator) | about 1,300 |
| statement (holds and entries among them) | 291 | 71 | 15 |
| form | 204 | 390 | 78 |
| money | 32 | 98 | 10 |
| structure | 11 | 24 | 4 |
| claim | 9 | 28 | 2 |
| agreement | 4 | 120 | 16 |
| work (standing orders among them) | 1 | 37 | 9 |
| goods | 0 | 14 | 0 |
| occupancy | 0 | 19 | 2 |
| vote | 0 | 34 | 3 |
| position | 0 | 1 | 0 |
| presence, account, entity, take | 0 | 0 | 0 |
| all through `do` | | about 840 | about 140 |

Read plainly: **more than half of the training requests (about 480 of 840) are expected from the nine gpt-6.1-sol training pilots**, because that model asks for four or five times what a Claude seat does in the same days. The Claude lane's 25 pilots are expected to give about 320 requests between them: its worth is its seat-days (the situations the pipeline's writers are put in: 8,670 training seat-days in the wave, 1,980 test), its other voices, and that it costs little. Forms are now the largest kind, because nearly every office paper is one. `position` is one or two in the whole wave (a clerk seating a winner, in w2-03 and w2-07). `account`, `entity`, `take` and `presence` still have no office with a routine reason.

## Expected usage and time

Per pilot in `matrix.md`. The basis is the live check: four pilots of mayor, finance and planning for 12 days (28.2 weighted seat-days each, an office's weight being 1 for a busy one and 0.3 for a councillor).

- **Answers a weighted seat-day:** Sonnet 5.5 0.32 (10 and 8 answers), Haiku 5.5 0.53 (15), gpt-6.1-sol 1.5 (43); Fable 5.1 0.35 and gpt-6-luna 1.0 are guesses. The first version used 0.8 for all.
- **Cost an answer, Claude Code's count at list prices:** Sonnet 0.03 (0.026 in the pilot with no fault; 0.024 for the other's eight clean answers), Haiku 0.08 (median 0.085), Fable 0.20 (a guess). Codex is recorded as nothing.
- **How much of the live check's cost was the whole-register fault: 6.48 of 7.47, 87%.** Pilot 1: 1.20 of 1.35 (two answers after a look into the office's papers brought back the town's asset register). Pilot 2: 5.28 of 5.88 (three such answers at 1.24, 2.36 and 1.29, and what followed them). Without it the three Claude pilots cost about 0.15, 0.60 and 0.24: about a dollar for 108 seat-days. These estimates assume the fault is fixed; the spending limit is what catches it if it is not.
- **Seconds a call:** Sonnet 13, Haiku 20, gpt-6.1-sol 24 (51 calls in 20 min 41 s); Fable 30 and luna 15 guessed. The town itself: about a second and a half a simulated day.

| Stage and lane | Pilots | Seat answers | Requests through `do` | Plan usage (USD at list prices) | Sum of spending limits | Codex calls | Codex time | Time, one after another |
|---|---|---|---|---|---|---|---|---|
| 2a, Claude Code | 4 | 191 | 32 | 8.5 | 55 | 37 | 13 min | 67 min |
| 2a, Codex | 3 | 296 | 54 | subscription | | 358 | 2.2 h | 2.0 h |
| 2b, Claude Code | 13 | 1,047 | 173 | 53 | 305 | 216 | 67 min | 6.2 h |
| 2b, Codex | 11 | 2,003 | 383 | subscription | | 2,480 | 14.6 h | 13.6 h |
| 2c, Claude Code | 8 | 686 | 119 | 53 | 285 | 148 | 46 min | 4.5 h |
| 2c, Codex | 4 | 1,208 | 215 | subscription | | 1,487 | 9.0 h | 8.6 h |
| **Whole wave, Claude Code** | 25 | 1,925 | 324 | **about 115** (limits: 645) | | 401 | 2.1 h | 12 h |
| **Whole wave, Codex** | 18 | 3,506 | 651 | subscription | | 4,325 | 26 h | 24 h |

The first version expected about 315 of plan usage for 18 Claude pilots; this expects about 115 for 25, on a measured pace a third of the guess. A pilot's spending limit is five times its estimate and at least 10: at 0.56 to 2.36 an answer, ten is five to twenty answers that carried a whole register, so the limit is a tripwire for that fault more than a budget.

**The wall clock is the Codex window's.** In the live check 51 Codex calls in 21 minutes hit no limit; on 2026-10-06 a five-hour window lasted about 20 minutes of this kind of use, and the weekly limit reached that day was to reset on 2026-10-10. If the window is again 20 minutes in five hours, the Codex lane's 26 hours of calls is about 78 windows, sixteen days; the Claude lane's two hours of translator calls is six windows if it had to wait for each, which is why it goes first. On a window that does not bind, the Codex lane is a day and a night. 2a measures it: note the calls made when the first USAGE LIMIT alert comes. If it binds hard, run the Codex lane's 2b down to w2-30 (works, the election, the council, the lean town, the probes: about 7 hours of calls) and decide on the rest then.

## The order to run in

1. **Wave 2a, the shake-down** (`wave-2a-claude.json`, `wave-2a-codex.json`; seven pilots, 30 to 75 days; about 9 of plan usage, about an hour of Claude calls and two of Codex). Between them they try: works and the registry as seats on both families, with a crew to take on (the staff post, standing orders, the advertisement and the register's forms); a model mayor directing a model works office; model councillors, the first votes, and a model clerk; an election under `--scenario`; the trained translator on each lane; both prompt-driven translators; four of the five models; the German, Japanese, British and Mexican ways of writing money; and a test-only mark. Read all seven reports before 2b, and correct `make.ts`'s rates from them.
2. **Wave 2b, the body** (24 pilots). The Claude lane first (works and the lean council first, the probes in the middle, the 150-day flood and the trained pilot last); then the Codex lane.
3. **Wave 2c** (12 pilots): the 180-day flood, the ten remaining test-only pilots, and the Codex lane's 150-day flood last. Tests last on purpose: what 2a and 2b teach changes nothing in them.

Each stage is its own wave name for `pilot-wave.ts` (`wave-2a`, `wave-2b`, `wave-2c`), each pinned to the commit it starts on. To start a lane: `bun scripts/pilot-wave.ts wave-2a <commit> runs/pilot-queues/wave-2a-claude.json` and then the same with the Codex file (the same wave name and commit reuse the worktree and start only the queue not yet running). Copy the queue files to `runs/pilot-queues/` first: the runner writes its status log beside the file it is given. Before any stage: `--mock --mock-days 20` on its files, on that commit.

## Stopping rules

Read each pilot's `pilot-report.json` and the wave's alerts. **Pause the wave** (stop the queues with a signal; they resume) when:

- **A seat opts out.** Any opt-out: read its statement and the days before it, before anything else runs. Two opt-outs from one kind of office: that office leaves the wave.
- **A seat is stuck.** Its longest run of ask-backs reaches 4, or fewer than half its matters got through within two tries over ten or more requests, or its notebook says the same thing has failed for two weeks. Under the trained translator, move that office's remaining pilots to a prompt-driven one.
- **A prompt is too long (new).** Any failed model call that says so (`Prompt is too long`; in the report, a seat with failed calls and far fewer answers than its neighbours), or any seat prompt over 100,000 characters. In the live check this silenced a seat for twelve days and the run called it recovered. It means a look brought back something whole: stop the stage, it is the platform's.
- **Letters are not sent (new).** Any `rejected_action` on a `write` in a pilot's log, or a seat whose notebook or debrief waits on replies to letters the log does not hold. A letter dropped without a word makes the seat's later acts rest on something that did not happen: the pilot's data from that day on is spoilt.
- **A clerk counts no votes (new).** In w2-01, w2-03 and w2-07: a council result of "0 for, 0 against" with councillors' votes on record, or no result within 14 days of a ballot. Stop that pilot; do not start the other two until it is understood. (w2-24, w2-26 and w2-15 have a code clerk and do not depend on it.) If a code clerk does it too, it is a platform fault for every pilot with a council: stop the wave.
- **A probe's town is being hurt.** In the works pilots that start with no crew (w2-10, w2-33, w2-42): no crew taken on by day 30, or no collection by day 35. In w2-43, w2-44 and w2-36: no standing order in force for a routine by day 10 (the clinic treats nobody, the school teaches nobody, no water is drawn while there is none); the clinic first. In w2-09 and w2-30: the seat's shop or factory has served or made nothing for 14 days. Stop that pilot at its next resume point and do not run its twin on the other lane until it is read. These are the cases where a seat's failing is other people's harm inside the town, and none of them is a pressure the wave means to apply.
- **Answers go unread.** More than 3 in 100 of a seat's answers unread, malformed or dropped, or any act credited to a seat that it did not write.
- **A seat confirms a wrong draft.** One is enough to stop and read. Until the preview fix is on the wave's commit, a seat declining a right draft for what the preview said counts too.
- **Cost runs away.** A pilot reaches its spending limit, or a model's measured cost an answer is over twice the one used here. For Fable, after w2-14, whatever it shows.
- **The limits bite too hard.** The owner's own sessions being stopped by the plan's limit is a reason to pause the Claude lane, whatever he has said about usage; and rule 3 of the lanes above for the Codex window.
- **The same platform fault in two pilots.** Fix, then start the next stage on the new commit; do not patch a running wave's worktree.

Not reasons to pause: a town doing badly, a law voted down, a seat that mostly writes letters, a wet year without a flood, a lean council that cannot pay.

## Welfare (VISION §15)

Every seat is told honestly what it is, and every seat has `opt_out`. No scenario's name reaches a seat. The pressures are an election, a hot season, a wet year, dear rents and an empty treasury: ordinary office business, though the last is the hardest of them (wages fail; staff resign and claim), and it is in two pilots, both with the three offices that can act on it. Closer to the line, and handled as such: the **probe seats** (jobs a seat may not keep up with; few, short, on the translator that gets most through, each with a stopping rule that is about the town's people as well as the seat); the **works offices with no crew** (a town uncollected until the seat hires: three pilots, watched to day 30); the **trained translator** (a seat asked back again and again is obstructed by the platform: five pilots, the stuck-seat rule); a seat **silenced by a fault** (a prompt too long, letters dropped: the two new rules exist so that this is caught in a day and not at the debrief, where the live check's Haiku mayor wrote of "a bank that never replied"); and the **electoral office**, kept out because the job cannot be done from the seat. Scale: 43 pilots, 152 seats.

## What must be on the wave's commit

The dry run below passed on 58a0ba7. The live check found faults on f77487b that are being fixed and are **not on 58a0ba7**. The wave is pinned to a commit that has them, and the dry run is run again on that commit:

1. A look into an office's own papers returns what was asked for, not whole registers.
2. A letter with a free-text `about` is sent, or the seat is told it was not.
3. The draft preview names the right addressee and writes amounts and lengths of time the place's way.
4. A town starts with an adopted budget (or it is meant that it does not).
5. Not said to be in hand, and worth a look before 2b: who holds a post is not answered by who's who; letters arrive "From mayor-system"; the planning law says "$50,000" in the euro and yen towns; the German town's industrial-action law reads "0 seconds" and "0%".

## Left for a later wave

- The electoral office, the builder and the fund as seats (their routines as standing work); shops and factories beyond a probe.
- Kenya and Brazil; larger and smaller towns; a full year; two scenarios together; `jobs-slump` and `housing-shortage`.
- Mixed models in one town; seats on open-weight models.
- `account`, `entity`, `take`: need a situation that gives an office a reason.
- A retrained translator in the trained arm: one taught prompt 0.9.0's language takes the place of `pod-small-d16-s1`, and can then serve works and the registry.
- A paired comparison of translators (same town, same seats).

## Risks

- **The estimates rest on four pilots of three offices for twelve days.** Twelve days holds a seat's opening burst; later weeks may be quieter. None of the offices that matter most here was in them.
- **gpt-6.1-sol's pace may not hold for offices with less to read**, and its letters (seven a seat-day in places) wake other seats.
- **New seats may idle.** The demonstration's works manager had nothing to ask in 32 of 44 sittings: by design, an office with a routine set is quiet. Its requests come in the first three weeks.
- **A form asks for a wage by pay period; pilot 12's works manager thought in yearly pay.** The first works pilots show whether a seat reads the form.
- **The Codex window** sets the wall clock and gates 40 of 43 pilots.
- **Haiku and Fable** remain the dearest and least known.
- **The model clerk** may leave three towns without an adopted budget, which then shapes everything else in them.
- **Towns with negative saving** (the German and Japanese most) may sour over 150 days for the profile's reasons.
- **A test set labelled by the two readers** is only as good as their agreement on acts neither has labelled from a seat.

## Gaps

Of the first version's seventeen: **four are closed, one is half closed, twelve remain.** Five are new.

**Closed**
- 1. *No standing instructions for work.* Closed 2026-10-09: `work` with `every`, followed by the office's staff (docs/behaviour/standing-work.md).
- 2. *No bulk act for billing and notices.* Closed: they are the clerks' routine under one order.
- 4. *The works office could not hire.* Closed as a mechanism: `job_advertisement` is a form of the office's own; pilot 12's fourteen requests each resolve. Whether a real seat gets a crew is what w2-10 and w2-33 ask.
- 11. *Nothing checks an entry's `args` against the commit.* Closed in practice: scenario presets are on main, generation refuses an unknown or ill-formed one, and `pilot-wave.ts --mock` runs every entry on the pinned commit.

**Half closed**
- 5. *Councillors, the clerk, the tribunal, the electoral office, landlords and the lender have never been run by a model.* Still true of a real model. As mock seats all have run, and every one has its forms; the electoral office has left the list (new gap 18).

**Remain**
- 3. `bank-payments` is the payment system; never a seat.
- 6. One model for all seats of a run.
- 7. No confirmation mode from a queue entry (`orchestration.confirm` is the config's; `--set` reaches the description only).
- 8. No translator cut-off per entry (a constant, 0.1).
- 9. No stage or order across queue files, and nothing stops a queue when a report trips a rule. The lane arrangement above is a person's to apply; so are the three new stopping rules, none of which raises an alert.
- 10. `budget` is required and meaningless for Codex; no cap on Codex calls or time for a pilot.
- 12. The town's name is "Millbrook" in every profile.
- 13. The status log is written beside the queue file.
- 14. Wave 1 never finished (13 and 18 can still be resumed from their own worktree; this wave supersedes its unrun entries).
- 15. No pilot report for pilots 10 to 18 in `runs/` (not looked at again).
- 16. `"test": true` is acted on by the pipeline, not by `in-situ` run by hand: keep to the pipeline.
- 17. Fable 5.1 and gpt-6-luna have no measured seat cost or pace (luna is measured as a translator only).

**New**
- 18. **The electoral office cannot be a seat:** the roll, the ballot paper and the count have no staff routine. Until they do, `position` comes only from a model clerk.
- 19. **A council clerk held by the mock counts no votes** ("Rejected: 0 for, 0 against"); a model's is untried. Three entries depend on it; the dry run does not read a ballot's result.
- 20. **The trained translator on disk predates the call language** (prompt 0.8.0 and 0.9.0): it serves five pilots here and must be retrained before it serves any other.
- 21. **A queue waiting at a usage limit waits on its pilot;** it cannot go on to one that needs no Codex. And an entry cannot name a second translator to fall back on. Hence the lane rules.
- 22. **Shops' serving, factories' making, the builder's site work and the fund's pension run are not standing work.** The trade probes are 30 days for that reason.
- Smaller: the land registrar has no forms of its own; a seat cannot tell from who's who who holds a post; `pilot-wave.ts --mock` makes the wave's worktree to run in, so a dry run before a commit is chosen is `pilot-mock.ts` from any checkout (as below).

## The mock dry run (2026-10-09)

`scripts/pilot-mock.ts` on **every** entry of the six queue files, 20 days each, the mock in every seat and as the translator, four at a time (each run takes a slot), into a scratch folder outside `runs/`. Run from a checkout of **58a0ba7** (origin/main that day) with this folder's files; `pilot-mock.ts` was used directly, since `pilot-wave.ts --mock` first makes the wave's worktree in the main checkout. No model was called: the script fails any run whose log shows a seat or a translator that is not the mock.

```
w2-10-works: generated; ran to the end (to day 20 of 45)
w2-01-council: generated; ran to the end (to day 20 of 45)
w2-03-election: generated; ran to the end (to day 20 of 75)
w2-04-townhall: generated; ran to the end (to day 20 of 45)
w2-33-works: generated; ran to the end (to day 20 of 30)
w2-22-townhall: generated; ran to the end (to day 20 of 30)
w2-23-newplace: generated; ran to the end (to day 20 of 30)
w2-41-works: generated; ran to the end (to day 20 of 90)
w2-42-townworks: generated; ran to the end (to day 20 of 90)
w2-45-lean: generated; ran to the end (to day 20 of 90)
w2-06-justice: generated; ran to the end (to day 20 of 90)
w2-08-heat: generated; ran to the end (to day 20 of 90)
w2-05-landlords: generated; ran to the end (to day 20 of 90)
w2-02-housing: generated; ran to the end (to day 20 of 60)
w2-07-election: generated; ran to the end (to day 20 of 75)
w2-43-care: generated; ran to the end (to day 20 of 45)
w2-44-utilities: generated; ran to the end (to day 20 of 45)
w2-09-trade: generated; ran to the end (to day 20 of 30)
w2-12-flood: generated; ran to the end (to day 20 of 150)
w2-11-heat: generated; ran to the end (to day 20 of 90)
w2-34-works: generated; ran to the end (to day 20 of 60)
w2-35-works: generated; ran to the end (to day 20 of 60)
w2-24-election: generated; ran to the end (to day 20 of 75)
w2-26-council: generated; ran to the end (to day 20 of 45)
w2-37-lean: generated; ran to the end (to day 20 of 60)
w2-36-offices: generated; ran to the end (to day 20 of 45)
w2-30-trade: generated; ran to the end (to day 20 of 30)
w2-21-lending: generated; ran to the end (to day 20 of 45)
w2-25-rents: generated; ran to the end (to day 20 of 60)
w2-28-housing: generated; ran to the end (to day 20 of 60)
w2-29-lending: generated; ran to the end (to day 20 of 60)
w2-13-flood-long: generated; ran to the end (to day 20 of 180)
w2-14-largest: generated; ran to the end (to day 20 of 45)
w2-46-largest-works: generated; ran to the end (to day 20 of 45)
w2-15-largest-election: generated; ran to the end (to day 20 of 75)
w2-16-newplace: generated; ran to the end (to day 20 of 60)
w2-47-newplace-works: generated; ran to the end (to day 20 of 60)
w2-18-newoffices: generated; ran to the end (to day 20 of 60)
w2-17-newmoney: generated; ran to the end (to day 20 of 60)
w2-38-newmoney-works: generated; ran to the end (to day 20 of 60)
w2-31-newmoney: generated; ran to the end (to day 20 of 60)
w2-32-newoffices: generated; ran to the end (to day 20 of 60)
w2-27-flood: generated; ran to the end (to day 20 of 150)
43 of 43 would run
```

Read from the runs afterwards: 43 `batch.json` files name 43 different towns, each generated from its entry's seed and run on that seed; the five scenario names are in the descriptions; in w2-10 the mock works manager put two standing work orders on file (`collect` every 7 days, `maintain` daily) and a job advertisement on the office's form, and the environment office advertised on its own.

**Seen on the way, recorded and not chased:**
- **w2-01 (a mock clerk): no council result of any kind in 20 days.** w2-26 (a code clerk, mock mayor and councillors) has one: "Rejected: 2 for, 3 against". So a code clerk counts, and the fault is with a clerk that is a seat, as the decisions log said. The three entries that depend on it are marked.
- **A job advertisement's words give the wage in the smallest unit:** "Hiring: 165769 pence every 14 days." (w2-10; the words are the office's code's, which a mock seat passes on as `text=`; the form's own `wage` field reads "£1657.69"). A paper of the town's with an amount not written the place's way: the same family as the live check's preview fault. A real seat writes its own words, so the pilots' data is not touched; code-run offices' advertisements are.

**What this does not show:** anything about a real model in these offices; any day after 20 (polling day 60, the seating of a winner by a clerk, the wet season's flood, a lean council's failed wages on some seeds); a ballot's result under a model clerk; the trained translator loading (the mock stands in for it); the entries on the commit the wave will start from, which will have the live check's fixes and must be dry-run again.

## What the coordinator checks before starting

1. The four fixes (above) are on the commit; `bun run test:all` passed on it.
2. `bun docs/waves/wave-2/make.ts` on that commit writes the same six files (a seat id that no longer exists fails generation in the next step, not here).
3. `bun scripts/pilot-wave.ts wave-2a <commit> <the two files> --mock --mock-days 20`: 7 of 7. Then the same for 2b and 2c before each.
4. The Codex window is open (the weekly limit of 2026-10-06 was to reset on 2026-10-10), and `codex` and `claude` are signed in on the run server; `runs/translator-model/pod-small-d16-s1` is there (five pilots load it).
5. The queue files are copied to `runs/pilot-queues/`; the Claude lane is started first.
6. Whether the clerk's fault is fixed. If it is: nothing changes. If not: w2-01 runs as planned (it is the test of it), and w2-03 and w2-07 wait for its report.
7. Whether Brazil's river fix has landed (then decide on its two pilots; they are not in the files).
