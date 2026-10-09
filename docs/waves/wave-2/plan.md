# Wave 2: the first real wave of pilots

**Status: third version, 2026-10-09, with its final pass on origin/main `923d139`. Ready to start; not run.** Everything the wave waited for is on main (the full suite passed there: 983, 0 fail). The owner has given a standing go-ahead; the coordinator starts it. No pilot of the wave has been started and no model called in the final pass. The queue files beside this page are ready for `scripts/pilot-wave.ts`; the tables are in `matrix.md` (written by `make.ts`, like the queues: change the plan there and run it again). **To start it: "Starting the shake-down" below.**

## The final pass (what landed, and what it changed here)

- **A seat no longer disappears after a failed model call** (it sits the next working day and is told; the log notes `sitting_missed`, the queue alerts `SITTING MISSED`, and a report's first line says `NOT A FINISHED PILOT` where seats missed sittings); a pilot whose model stops answering is parked like one at a limit. The two stopping rules written for that fault are now read off the report.
- **A seat is told its office's staff** and what each of its own forms is for: **the three works pilots with a crew to take on (w2-10, w2-42, w2-33) wait for nothing.**
- **A paper filed with an office brings its seat back the next working day** (`wake_on_papers`, on by default, left on in every pilot). Seats will sit more often than the live checks showed. **Every request, usage and time estimate here predates it** and is likely low on all three.
- **A seat's effort is a setting** (`seat_effort`): w2-54 sets `seat_effort=low` and names its model plainly, so its seats reason less and its translator does not. Nowhere else until that pilot is read.
- **The three pilots with a model council clerk run** (they were held in a file of their own; nine queue files now). The earlier "0 for, 0 against" was the mock sitting weekly: a ballot closing is not a paper, so nothing brought the clerk back to count. A real clerk seat is brought back by the proposal and by each vote, and has to arrange to be back for the count itself; that is untried, so **w2-01 (45 days) is in the shake-down as the test of it**, w2-03 and w2-07 (75 days) are in the body after its report, and each is stopped if no result is declared within three weeks of a ballot opening. I see no reason they cannot run. One caution: a clerk that comes back weekly may declare up to a week late, which is a seat's pace and not a fault.
- **Institutions:** the bank keeps a ledger and sends real statements; every opening standing payment has a paper behind it; only an authorised signatory can hold, withdraw or replace a payment instruction; the opening ballot is closed; council results name who voted; a hiring office sends finance a payroll notice with a first payday; code-run offices acknowledge letters. The wage-hold theme that filled one live-check pilot should not recur.
- **Citizen outcomes are recorded with decisions by default**; the report prints `citizen records: N decisions, M outcomes`. A pilot whose report says `NONE` is stopped (new rule).
- **The translator's prompt is 0.9.1** (a direction form to the asker's own office is marked as such; three worked examples): aimed at the direction-for-a-standing-order confusion both translators showed. The measurements below were made under 0.9.0 and were **not** repeated under 0.9.1 (no model was called in this pass).
- Also on main: who holds a post is shown; no platform ids; code offices word sums the place's way; informal work in Kenya, India, Brazil and Mexico; support, pensions and tax as laws.
- **Not on main, and not waited for:** the river's flow. The Brazilian, Indian, Mexican, Kenyan and Ohio towns flood through their wet seasons until it lands (the owner: rough towns still make good data); the table of towns that are not their place says so.

## What changed from the second version (2026-10-09, morning), and why

The second version leaned on the Codex subscription: a Codex model was the translator in 38 of its 43 pilots and the seat model in 18. The night it was written, the second live check (`runs/live-check-2-2026-10-09/README.md`) met the subscription's limit 16 minutes in. A pilot on Codex seats stood on day 16 for two and a quarter hours; a pilot on Claude seats stood at day 0 for an hour for want of four translator calls, with two pilots behind it that needed no Codex at all. The owner, that morning: "codex is unreliable… we should really not use it much at all anymore", and then, more exactly: **"I don't have an issue using codex when it's available, but when it runs out, it shouldn't block things."** And of the translator: "use sonnet 5.5 as the backup translator"; of the largest Claude model: "I'd rather use fable in the seats… I don't think it's an appropriate model for the translator"; of what the wave is for: "a wide spread of good data so that we can finally get the self trained translator model over the line". Of profiles: "for some of these profiles, tbh it doesn't matter if they're unoptimal… unoptimal situations should also create good data".

So the rule this version is built on: **Codex when it is available; never something a pilot waits on.** In full:

1. **No pilot's translation is behind the Codex sign-in.** The general translator is `claude-code/claude-sonnet-5-5`, alone, with no chain of fallbacks. `make.ts` refuses an entry whose translator is a Codex model.
2. **Each pilot's translator is a late, cheap choice** (below, "Translators"): `sonnet` (the general model and no other, 28 pilots), `trained-ok` (our own retrained translator if its scores allow when the stage starts, else the general model, 21), `trained` (our own, for its failures, 1). A retrain was begun the day this was written; `make.ts --retrained decide/NAME` writes the files with it.
3. **Codex models are seats only, in a lane of their own that is optional** (twelve pilots). The queue now parks a pilot the moment its sign-in is at a limit and goes on (`scripts/pilot-queue.ts`; the decisions log, "A pilot stopped at a usage limit is parked"). A Codex stall stalls that pilot's seats and nothing else.
4. **With Codex unavailable throughout, the wave still completes:** 38 pilots on Claude seats in the three stages carry every office, every scenario, every training profile and both held-out profiles and offices. `make.ts` checks it. One thing they cannot carry: an unseen seat model (item 7).
5. **Six pilots moved from Codex seats to Claude seats** so their coverage is not optional: the second flood (w2-27), housing and lending (w2-28, w2-21), the two probes (w2-36, w2-30) and the council of councillors (w2-26).
6. **Two lanes of Claude seats, by what they cost.** A seat on Sonnet 5.5 comes back weekly and a 30-day pilot recorded 0.62 and 0.99; the same thirty days on Haiku 5.5 recorded 18.54 and 15.51. So Sonnet's pilots are many and long, Haiku's are nine, short, one at a time, with spending limits that fit, and **the first of them measures Haiku at lower effort** (w2-54). Haiku stays: it is the only weaker Claude model, and the translator has to serve weaker models.
7. **Fable 5.1 sits in training seats** (three pilots; w2-14 first, in the shake-down, because its cost in a seat is unmeasured). **The held-out seat model is now gpt-6-luna**, which makes that part of the test depend on the Codex window (below, "Models, and what is held out").
8. **Registry pilots are as long as it takes to have deaths to register** (below, "The registry").
9. **Kenya and Brazil are in, as they are** (two pilots each), and three more scenarios (`housing-shortage`, `jobs-slump`, `energy-price-shock`, a pilot each).
10. **The three pilots with a model council clerk run in their lanes** (final pass; they were held), w2-01 first, in the shake-down; an election that does not turn on a model clerk is added on Claude seats (w2-48).
11. **Works pilots that start with no crew wait for nothing** (final pass: a seat is told its office's staff).
12. **Every estimate was rebuilt** on the second live check's thirty-day pilots, and is given twice: Codex unavailable throughout, and Codex available.
13. **Stopping rules gained two** (a seat that missed sittings after a failed call; a pilot whose seats sat for less than its run is not finished), and the lane rules of the second version, which arranged who had first call on the Codex window, are gone: nothing needs them.

**This reverses a standing agreement** (CLAUDE.md, "Models": real-model runs through the Codex CLI, gpt-6.1-sol in the driver seat, gpt-6-luna for the translator). The decisions log has the entry; CLAUDE.md is the owner's and is not changed here (the wording proposed is in that entry).

## What the wave is for

Pilots exist first to gather data for the trained translator. The data so far is letters and a few forms from three calm offices in one town in one currency. This wave is built to change that, in this order:

1. **Acts nobody has asked for.** Eight of the sixteen kinds of act have never been requested by a seat, and the call language has since gained a hold, an entry on one's own file, forms for an office's own papers, directions and standing work, of which real seats have asked for about sixty things in all, most of them one pilot's holds. So the wave seats the offices whose business those are: works, the registry, councillors, a clerk (held), landlords, the lender, the tribunal, and, as probes, the clinic, the school, the utilities, rates, a shop and a factory.
2. **Forms and the seats' own wording.** Nearly every office now has forms of its own (41 of them). Every request a seat makes is in its own wording.
3. **Other places' money.** Nine profiles, seven in training: a sign before, a decimal comma, no smaller unit, a code after, and (test only) groups of two with lakh and crore. One amount in a German town has reached an amount field so far ("0,84 €", read right); none in a Japanese one.
4. **Other situations.** Eighteen pilots start under one of eight presets that reach an office; four more are in towns that are in trouble by their profile's fault.
5. **Other writers.** Three Claude seat models (one at two efforts) and, when the window allows, two Codex ones.
6. **A test that measures generalisation.** Twelve whole pilots are test-only, five of them in the lanes that need no Codex.
7. **A spread, not a pile** (below, "The spread"): every kind of act with an office that has honest reason to ask for it, every way of writing money, forms most of all, and no one theme in more than a few pilots.

What it is not for: comparing stewards, or any claim about how models govern, or anything about the places the profiles are named for.

## What is known about seats now

- **Any office can be named a seat** (`model_seats=<office id>,...`; the mayor by `mayor=llm`). The offices a generated town has, in every profile: mayor, planning, inspector, finance, works, environment, rates, registry, child-protection, council-clerk, councillor-1 to 5 (the town's); land-registrar; electoral (the commission's); bank-lending, bank-payments; builder-foreman; editor; clinic-manager; principal; tribunal-member, tribunal-registrar; water-operations, energy-operations; police-oic; union-organiser; twenty `landlord-N-office`, thirty `shop-N-manager`, ten `factory-N-manager`. A `model_seats` entry that names no office fails generation, and the dry run below generated every entry.
- **A model in a seat replaces the office's code**, except its routines: where the office has them (works, clinic, school, both utilities, rates) its staff are a post of their own (`<office>-staff`), run by code, who do the routine only while a standing work order is in force.
- **A seat is shown no town and no register.** It is shown its own papers, and asks, looks up and sends someone for the rest. Largest thing shown at one turn in the second live check: 27,119 characters.
- **One model for every seat of a run. Only `do` goes to the translator**; a letter goes as written. **Confirmation is `always`.**
- **The pace is the model's, and it is set by when the seat chooses to come back.**
  - *Sonnet 5.5:* sat on days 1, 8, 15, 22 and 29 of thirty: five sittings, 28 and 29 answers a pilot of three seats, 3 and 4 requests. A seat that says only "done for now" is back after seven days (`cadence_days: 7`, set by the generator, not by a spec key), or the next working day if someone writes to it. Code-run offices seldom write.
  - *Haiku 5.5:* 88 and 126 answers in thirty days, 100 and 73 letters, 44 requests in one pilot (38 of them holds and withdrawals provoked by the bank's wrong report, since being fixed) and 2 in the other.
  - *gpt-6.1-sol:* 43 answers and 83 letters in twelve days; 73 answers and 92 letters in twenty-five; **5 requests in twelve days and 3 in twenty-five.** Its activity is letters and looks. The second version expected more than half the wave's requests from it on the first figure; the second figure does not bear that out.
- **On main since, and not in these estimates:** a paper filed with an office brings its seat back the next working day, as a letter does (`wake_on_papers`, on by default; a seat can say which kinds of paper may wait for its weekly sitting). Seats will sit more often than either live check showed, and ask for more. **Every request estimate here predates it.** On the mock set to come back weekly, thirty days in the first profile's town: 5 to 6 sittings for the mayor, 5 to 7 for finance, 5 for the clerk and for works; a town with complaints or a council at work brings its seats back more.

| Office | As a seat | What it has to ask for (docs/behaviour/office-papers.md) | Pilots (of them needing no Codex) |
|---|---|---|---|
| mayor | works (pilots 7 to 18; both live checks) | the council proposal, amendment and permit forms; `nomination`, `invoice_approval`; **directions** on an office's form; structures | 32 (22) |
| finance | works; made the holds, withdrawals and entries so far | payments, **holds**, **entries on its own file** | 23 (16) |
| planning, inspector | work; little through `do` | `permit_decision`, the liberty to build; `valuation_request`, `demolition_order`, fines | 12 (9), 5 (5) |
| **works** | live check 2: set two standing orders; with no crew it never learned it had none | `job_advertisement`, offers of employment, **standing work orders**, holds on them | 9 (5) |
| **registry** | live check 2: nothing to register in thirty days | `death_registration`, `death_certificate`, `transmission_application`; no birth before about day 275 | 8 (6) |
| land-registrar | untried | transfers and transmissions (claims), answers to searches | 3 (2) |
| council-clerk | live check 2: no proposal reached it; a mock clerk sitting weekly counted no ballot (a closing is no paper) | `council_ballot`, `council_result`, `adopted_budget`; **position**; directions | 3 (3) |
| councillors | live check 2: two voted (on a ballot already decided: a fault, fixed) | **votes** | 6 (5) |
| editor | untried | `news_item` | 7 (5) |
| child-protection | untried; rarely has business | **presence** | 2 (2) |
| tribunal-member, tribunal-registrar | untried | `tribunal_order`; `garnishee_order` | 4 (4), 5 (4) |
| landlord offices | untried; busy | `rental_listing`, `rent_increase`, `tax_report`, leases, payments, building | 14 (11) |
| bank-lending | untried | `loan_decision`, `loan_payout`, loan agreements | 4 (3) |
| environment | live check 2: letters only | `job_advertisement`, `habitat_register`, survey work | 3 (2) |
| **clinic-manager, principal** | **probes** | a standing order each (`treat`; `teach`, `enrol`), staffing | 1 (1), 2 (2) |
| **water-operations, energy-operations, rates** | **probes** | standing orders (`draw_water`, `bill`; `supply_energy`, `bill`; `levy`) | 2 (2), 1 (1), 2 (2) |
| shop and factory managers | **probes**: serving and making are still by hand | **goods**, work, `order`, `delivery_note`, payments | 2 pilots, 30 days |
| police-oic, union-organiser | untried | `charge`, investigations; `wage_claim`, ballots | 2 each (1 each), **test-only** |

**Not seats, and why.** `bank-payments`: never; it is the payment system. `builder-foreman`, `fund-trustee`: not yet; their routines are not standing work. `electoral`: not yet; a seat cannot write the roll, the ballot paper or the count.

## The matrix

`matrix.md` has it in full: every pilot with its seed, days, seats, models, marks, estimates and coverage. By queue file, in the queue's order (S = `claude-code/claude-sonnet-5-5`, H = `claude-code/claude-haiku-5-5`, F = `claude-code/claude-fable-5-1`, sol = `codex/gpt-6.1-sol`, luna = `codex/gpt-6-luna`; the translator is Sonnet 5.5 under the translator's prompt unless marked T, the trained `decide/pod-small-d16-s1`; days in brackets). Every town is 1,000 people from day 0.

| Queue file | Seats on | Pilots |
|---|---|---|
| `wave-2a-claude-1.json` | S, F | w2-10-works (S, gb, 180; works, registry, environment; no crew; probe) · w2-44-utilities (S, au, 45; energy-price-shock; probe) · w2-09-trade (S, au, 30; probe) · **w2-01-council (S, au, 45; mayor, a model clerk, five councillors: the test of a clerk that is a seat)** · **w2-14-largest (F, au, 45; mayor, finance, a landlord: the measure of Fable in a seat)** |
| `wave-2a-claude-2.json` | H | **w2-54-effort (us, 30; town hall; Haiku with `seat_effort=low`: the measurement)** · w2-04-townhall (us, 45) · w2-26-council (au, 45; five councillors; translator **trained**) |
| `wave-2a-codex.json` (optional) | sol, luna | w2-33-works (sol, au, 30; no crew; probe) · w2-22-townhall (luna, jp, 30; **test**) · w2-23-newplace (sol, mx, 30; **test**) |
| `wave-2b-claude-1.json` | S, F | w2-42-townworks (us, 90; no crew) · w2-45-lean (de, 90; lean-council) · w2-48-election (us, 75; election-due; code clerk) · w2-03-election (de, 75; election-due; model clerk) · w2-06-justice (de, 180) · w2-08-heat (jp, 180; hot-summer) · w2-05-landlords (us, 120; dear-rents) · w2-28-housing (de, 120; housing-shortage) · w2-21-lending (jp, 120; jobs-slump) · w2-43-care (gb, 45; probe) · w2-11-heat (de, 90; hot-summer) · w2-12-flood (gb, 150; wet-year) · w2-27-flood (de, 150; wet-year) · w2-46-largest-works (F, de, 90; mayor, works, registry) · w2-15-largest-election (F, gb, 75; election-due) · w2-50-evictions (ke, 120) · w2-51-townhall (ke, 90) · w2-52-river (br, 120) · w2-53-townhall (br, 90) |
| `wave-2b-claude-2.json` | H | w2-41-works (us, 75; mayor, works, registry) · w2-02-housing (gb, 45; dear-rents) · w2-36-offices (us, 30; probe) · w2-30-trade (au, 30; probe) · w2-07-election (au, 75; election-due; model clerk) |
| `wave-2b-codex.json` (optional) | sol, luna | w2-34-works (sol, us, 45) · w2-24-election (sol, gb, 75; election-due) · w2-25-rents (sol, us, 45; dear-rents) · w2-35-works (luna, gb, 45; **test**) · w2-29-lending (sol, jp, 45) · w2-37-lean (luna, gb, 45; lean-council; **test**) |
| `wave-2c-claude-1.json` | S | w2-13-flood-long (au, 180; wet-year; six seats) · w2-16-newplace (mx, 90; **test**) · w2-49-newmoney-registers (in, 180; **test**) · w2-18-newoffices (au, 90; police, union; **test**) |
| `wave-2c-claude-2.json` | H | w2-47-newplace-works (mx, 45; **test**) · w2-17-newmoney (in, 45; **test**) |
| `wave-2c-codex.json` (optional) | sol, luna | w2-38-newmoney-works (sol, in, 45; **test**) · w2-32-newoffices (sol, us, 45; **test**) · w2-31-newmoney (luna, in, 45; **test**) |


### Towns

`oikos run --seeds N` is one generated town run N times; the town comes from the description's own seed. A queue entry runs `--seeds 1` with `--set seed=N`, and `seed` is the description's: so the generator makes the town of seed N, and the run's seed follows it. `make.ts` refuses two entries with one seed. Seeds are 100 + the pilot's number (900 + for a test-only pilot); none was used before (801 to 804 and 811 to 816 were the live checks'; 821 to 824 the translator check's).

### Towns that are not their place

The owner (2026-10-09): a profile does not have to be faithful to be used, and a town in trouble is data too. So no profile is held out for fidelity, and the distorted ones are spread over a few pilots each (`make.ts` holds Kenya and Brazil to three at most), because a town dominated by one distortion gives requests dominated by one theme. **Nothing in a pilot in one of these towns says anything about the country or the region its profile is named for.**

| Profile | Pilots | Known not to be faithful in |
|---|---|---|
| ke-nakuru-2026 | w2-50, w2-51 | its rent share is wrong for its dwelling mix (rent at about 85% of income): landlords and the tribunal see arrears and evictions that are the profile's doing; it floods through its wet season |
| br-mg-2026 | w2-52, w2-53 | it floods through its wet season on a river-flow figure whose change is not on main |
| in-tn-2026 | w2-49, w2-17, w2-38, w2-31 (all test) | rent is 40% of income (no landlord seat there, which `make.ts` checks); a means-tested pension is paid to everyone; it floods through its wet season |
| mx-jal-2026 | w2-16, w2-47, w2-23 (all test) | it floods through its wet season (the river's flow) |
| us-oh-2026 | ten pilots | it floods through its wet season (the river's flow) |
| jp-akita-2026 | w2-08, w2-21, w2-22, w2-29 | far from its census by age; its budget expects grants seven times its spending; households' saving reads negative |
| de-ni-2026 | seven pilots | households' saving reads negative; its ballot figure for industrial action is union practice |

Every profile also carries placeholder figures (docs/profiles.md). The river's flow is to change on main after this wave starts; the wave does not wait for it. Informal work is on main (Kenya, India, Brazil and Mexico state it).

### Why this coverage

- **Offices in bundles that have business with each other.** A landlord's permit goes to planning; a lease dispute to the tribunal; a death from the registry to the land registry; a direction from the mayor to works.
- **Works, three ways.** Under a code mayor (w2-10; w2-34 on the other family); beside a model mayor (w2-41, w2-46; w2-33, w2-35, w2-38); with the treasury too, for a quarter, from no crew (w2-42).
- **Profiles.** Training: `au-vic`, `gb-eng`, `de-ni`, `jp-akita`, `us-oh`, `ke-nakuru`, `br-mg`. Test-only: `mx-jal` and `in-tn`, chosen by what makes the test mean something, not by fidelity: India writes amounts in groups of two and says lakh and crore, which no training profile does (the hardest new thing a currency can do to a translator); Mexico writes a peso with the dollar's sign, the nearest thing to a profile seen, so the pair brackets "a new place" from both ends.
- **Scenarios.** `election-due` with 75 days (below). `wet-year` with 150 to 180. `lean-council` with a mayor, the treasury and a code works office. `dear-rents` with landlords, the tribunal, the lender. `hot-summer` twice. `housing-shortage` (landlords and the tribunal), `jobs-slump` (the lender, the treasury, landlords) and `energy-price-shock` (the utilities probe) reach an office faintly and have a pilot each. Every preset that is not marked inert is in the wave; none is in more than three pilots (elections apart: five, two of them held).
- **Elections: what each reaches.** Under `election-due` the notice is given on day 1, nominations close on day 30, the poll, the count and the declaration are on day 60, and the clerk seats the winner when it next wakes (day 61). Every election pilot runs 75 days (`make.ts` refuses fewer): w2-48 (Sonnet), w2-15 (Fable) and w2-24 (gpt-6.1-sol) (a code clerk: the seating happens whatever a model does) reach the nomination, the campaign, the result and two weeks of the term after it; w2-03 and w2-07 (a model clerk) reach the same if the clerk seats the winner, which is what they test.
- **Models, and what is held out.** Sonnet 5.5 carries most (25 pilots: it is nearly free and can run long); Haiku 5.5 is the weaker voice the translator must also serve (9, and 1 at low effort); Fable 5.1 is the most capable seat and is in training (3: the owner's word that it belongs in seats); gpt-6.1-sol when the window allows (8, of which 5 train). **The held-out seat model is gpt-6-luna** (4 pilots, all test-only, all optional). With all three Claude models wanted in training, the only models left to hold out are behind the Codex sign-in, so **whether the test has an unseen seat model depends on that window.** What it measures either way: if the lane runs, generalisation to a weaker model of another family, the hardest case there is; if it never runs, generalisation across profiles and offices only, on seat models seen in training. What is done then, decided when the pipeline is run and not before: the three Fable pilots are marked test-only in the pipeline's config (a config can add the mark to a pilot; it cannot take one away), which gives the test an unseen model, of the family seen, at the cost of Fable's voice in training. Offered to the owner, not planned: a fourth Claude model in test-only seats (it would need his go-ahead as a model not on his list), which would make the test's unseen model certain without that cost.
- **Test-only pilots** (12 of 50; 5 need no Codex). Held out, and checked by `make.ts` to be in no training pilot: a model (gpt-6-luna), two profiles (mx-jal, in-tn), two offices (police-oic, union-organiser); both profiles and both offices are tested in pilots that need no Codex.

### The registry

In the second live check a registrar had nothing to register in thirty days. Measured for this plan (seven code-run towns of 1,000, one of each profile, 180 days, seed 7, on f6ac4ee): deaths registered in 180 days were 3 (au-vic), 8 (gb-eng), 6 (de-ni), 4 (jp-akita), 10 (us-oh), 2 (mx-jal), 8 (in-tn); **one town of the seven had a death in its first thirty days**; and **no town had a birth** (the first pregnancies are due about day 275). One town each: the noise is as large as the figures. So:

- a registry seat is in a pilot only where about two deaths or more can be expected (`make.ts` refuses otherwise), and where the seats are cheap the pilot runs 180 days: w2-10 (gb, about 8), w2-06 (de, 6), w2-08 (jp, 4), and the test w2-49 (in, 8);
- on the dear or unmeasured models it is in the profile with most deaths or runs 75 to 90 days: w2-41 (Haiku, us, 75: about 4), w2-46 (Fable, de, 90: about 3); in the optional lane w2-34 and w2-25 (us, 45: 2 or 3);
- it is taken out of pilots too short to give it anything (w2-33, w2-23, w2-35, w2-38, w2-47, w2-16), where the treasury or the environment office sits instead;
- **births are out of reach of this wave**: `birth_registration` will come from no pilot shorter than about 280 days. Left for a later wave, or for a town that starts with pregnancies under way (a platform question, not raised here before).

## Translators

Measured 2026-10-09 with `oikos translator-eval --model claude-code/<model> --real` (prompt 0.9.0; the held-out set was scored by the code's own path and never opened; `runs/translator-eval-claude-2026-10-09/`). No code had to change: a Claude model answers as the translator through `claude-code/` as it stands (the answer in the adapter's schema, two model turns a call). The Codex window happened to be open, so gpt-6.1-sol was scored again on the real requests alone, under the same prompt and today's keys (`sol-rescore/` there; 23 of the cases were re-keyed on 2026-10-08).

| Translator | Prompt | Seen (86): right / no draft / wrong draft | Held out (66) | Real requests (180) | Cost a call, as reported | Model seconds a call (median) |
|---|---|---|---|---|---|---|
| **claude-code/claude-sonnet-5-5** | 0.9.0 | 80 / 2 / 4 | **61** / 3 / 2 | **163** / 10 / 7 | 0.008 | 2.6 |
| claude-code/claude-fable-5-1 | 0.9.0 | 82 / 2 / 2 | 61 / 2 / 3 | 170 / 5 / 5 | 0.038 | 4.4 |
| claude-code/claude-haiku-5-5 | 0.9.0 | 82 / 2 / 2 | 57 / 3 / 6 | 147 / 27 / 6 | 0.026 | 3.4 |
| codex/gpt-6.1-sol, **scored again 2026-10-09** | 0.9.0 | not run again | not run again | **169** / 5 / 6 | none per call | |
| codex/gpt-6.1-sol, as recorded 2026-10-06 | 0.7.3, older keys | 63 of 64 | 64 of 66 | 175 | | |
| codex/gpt-6-luna, as recorded | older | | 44 of 60 | 161 | | |
| decide/pod-small-d16-s1 (trained; predates the hold, the entry, `look_first`, forms, standing work) | | | | 141 | | |

Whole runs (86 + 66 one at a time, 180 four at a time, about 366 calls each): 18.5 minutes for Sonnet 5.5, 21.5 for Haiku 5.5, 27 for Fable 5.1, on a busy machine; 13 minutes for sol's 180. Reported cost of the three Claude runs: 2.80, 9.42 and 14.09. Nothing any of them could not produce: every answer came back in the form asked for, and no call failed.

**Sonnet 5.5 is the general translator, alone** (the owner's choice; Fable 5.1 is a seat model and is not offered as a translator, though it reads the real requests as well as gpt-6.1-sol does). Beside gpt-6.1-sol it is **163 of 180 against 169 like for like, and against the 175 recorded earlier**; on the held-out set 61 of 66 against sol's earlier 64. Two things about that gap. First, half of it went when sol was scored under today's prompt and keys. Second, the owner's reading, which the numbers fit: sol's lead on the real requests is partly the prompt having been developed with sol as its reference; the real set was in view during that work and the held-out set was not, and the gap is 6 (or 12) of 180 on the one and 3 of 66 on the other. What 163 means in practice, from its 17 misses:

- **Mostly an extra ask-back.** Five of the seven "wrong drafts" are letters whose addressee it wrote as a description in quotation marks (`to="the works manager"` where the id is `works`), and a sixth names a builder by its name. In a run the resolver does not know that name and the seat is asked again; no wrong act is drafted.
- **About one wrong draft in 180 reaching a sign-off**: a budget form with a line's amount in the wrong field (sol and Fable get the same request wrong).
- Of the ten with no draft, six are a refusal under another label than the key's (the seat rewords either way), two came back as words with no program, two refused something sayable.
- **Not done, on purpose:** a line in the prompt about naming a post by its id. The 180 real requests are a test set, and wording the prompt to its misses is how the first held-out set was spoiled. It is something to try against fresh requests from this wave.
- Haiku 5.5 is not a translator to choose: 27 real requests left without a draft and six wrong drafts held out.

**In the loop** (`runs/claude-translator-check-2026-10-09/`, four short pilots through the queue, all test-marked; `requests.txt` there has every request, draft and sign-off). Sonnet seats ask for little: the first pilot asked for nothing in fifteen days, so it was taken on to thirty and three more were added.

| Pilot | Seats | Days | Seat answers | Requests | Drafts: offered, confirmed, declined | No draft | Translator: calls, reported cost | Pilot's recorded cost | Wall time |
|---|---|---|---|---|---|---|---|---|---|
| 1 | mayor, finance, planning on Sonnet 5.5 (au-vic) | 30 | 21 | 1 | 1, 1, 0 | 0 | 1, 0.012 | 0.53 | 3 min |
| 2 | works, registry, environment on Sonnet 5.5 (gb-eng) | 15 | 12 | 0 | | | 0 | 0.29 | 2 min |
| 3 | the same, the crew still to take on | 15 | 20 | 8 | 3, 2, 1 | 5 | 8, 0.072 | 0.55 | 3 min |
| 4 | mayor, finance, planning on **Haiku 5.5** (de-ni) | 15 | 55 | 1 | 1, 1, 0 | 0 | 1, 0.009 | 8.55 | 22 min |

Ten requests: five drafts, four confirmed, one declined; five with no draft; 0.009 a translator call, 3.7 seconds of model time. No wrong draft was confirmed, no call failed, every answer was read.

- **A payment with a report** (pilot 1) and **a hold on six standing wage instructions, their sums written the German way** (pilot 4, from a Haiku seat): each drafted first time and confirmed. The hold is what the trained translator refused 24 times in the second live check.
- **Two standing work orders took eight requests** (pilot 3). For the weekly collection the translator first copied "once a week" where a length of time was wanted (no draft), then drafted **the collection direction form in place of a standing work order**, which the seat declined ("Wrong paper: a collection direction from me has no force… and it is not a standing work order"), then got it right. gpt-6.1-sol made the same mistake twice in the second live check: it is a confusion the prompt allows, not one model's. For maintenance "using the hours the round leaves", four requests came back "How much of it?" until the seat gave a period it had not wanted: a standing order with no period cannot be said, which is the platform's and is in the gaps.
- **Ten requests is thin**, and three of the four pilots are Sonnet reading Sonnet.

**Where the seat and the translator are the same model** (up to 25 of 50 pilots: Sonnet reading Sonnet's requests) the pilot's requests are still good training data: the label is the program the seat confirmed, whoever drafted it. What is weaker there is the evidence that the translator reads *another* model's wording, and a request may get through because writer and reader share a habit of phrase; the pipeline's two blind readers label these requests like any other. The Haiku and Fable pilots and the optional lane are the translator reading another model.

### Which translator a pilot may have

The owner wants our own model translating in the wave where it is sound, and a retrain was begun on 2026-10-09 (regenerated data with the hold, forms, directions, standing work, entries, `look_first` and every currency shape; three seeds). So the translator of a pilot is chosen late, when its stage is started, and each pilot says what it may have (`translator_choice` in its queue entry; the column "translator may be" in `matrix.md`):

| A pilot marked | May have | Pilots | Which, and why |
|---|---|---|---|
| `sonnet` | the general model and no other | 28 | **Where a request not getting through loses the pilot's point:** the probes, the elections (one nomination, one seating), the works pilots with a crew to take on, the held clerk pilots. **Where one thing is being measured:** w2-54 and w2-04 (Haiku's effort). **Every test pilot:** a request first written under a translator that gets it through is the cleaner test of meaning. `make.ts` refuses any other mark on these. |
| `trained-ok` | our own retrained translator **if** its scores on the pilot's kinds of act are good enough, else the general model | 21 | The body of the training pilots: the lean council, the registers, landlords, housing, lending, both hot summers, the three floods, the Kenyan and Brazilian towns, two Fable pilots, two Haiku pilots, three of the optional lane. Listed in `matrix.md`. |
| `trained` | our own, whichever is current, because its failures there are the data wanted | 1 | w2-26-council: five councillors on Haiku under a code mayor and a code clerk. Votes are what the model on disk was taught; it fails on anything else, which is expected, and the stuck-seat rule is the limit. No town hall: any town hall meets holds, and the model on disk refused every one. |

**How the choice is made, per stage.** The retrain's report says which kinds of act the new model handles (by function, form and refusal label, on the real requests and the held-out set). For each `trained-ok` pilot, look at what its offices ask for (the office table above): if the model is at or near the pass mark (90% right, at most 1% confidently wrong) on those kinds, the pilot gets it; if not, it keeps the general model. Then `bun docs/waves/wave-2/make.ts --retrained decide/<run> --retrained-for <pilot>,<pilot>` (without `--retrained-for`: all 21) writes the stage's files, and the mock dry run is run on them. Until then the files in this folder have the general model in every `trained-ok` pilot and the model on disk in w2-26. A stage already running is not changed. Suggested for the first use: no more than a third of a stage's `trained-ok` pilots, spread over profiles and offices, so that a fault of the new model costs a few pilots and not a stage; and a pilot under it that trips the stuck-seat rule goes back to the general model for its remaining days (a resume takes another `--translator-model`).

## Lanes, and what runs side by side

A queue file is one lane: its pilots run one after another. Per stage, up to three queues run side by side:

- **`claude-1`** (Sonnet and Fable seats): light. A 30-day pilot took four minutes and under a dollar of plan usage.
- **`claude-2`** (Haiku seats): the plan's heavy user, about thirty dollars of recorded usage an hour while it runs. One pilot at a time, which the lane being one queue ensures.
- **`codex`** (optional): one pilot at a time; parked the moment the window closes, tried again every twenty minutes, and waited for by nothing. A stage is *finished* when its two Claude lanes are; the Codex lane of a stage may still be going, or parked, when the next stage's Claude lanes start.

**The Claude session limit is now the constraint on time.** Both Claude lanes and the translator of every pilot are one sign-in, and so are the owner's own sessions and every agent's. A limit reached parks whatever met it; every other pilot of that sign-in is then not started (the queue knows a limit is the sign-in's), and each queue tries again every twenty minutes. Last night a session limit was reached at about 04:30 with six agents working and the second of four Claude-lane pilots starting; it reset at 05:20, and after it two Haiku pilots (34 dollars of recorded usage between them) ran in two and a half hours beside the same agents without meeting it again. From that, and no more than that: **two Claude queues side by side (one of each lane) is what to run**; a third Claude queue would add little, since `claude-1` is not the heavy one and `claude-2` must not be doubled. If the owner's sessions are being stopped, pause `claude-2` first (it is nine tenths of the wave's usage by the hour), then `claude-1`.

## What the wave loses without Codex seats, and how the plan recovers it

**What the optional lane is, in numbers** (central guesses): 12 pilots, about 1,700 seat answers, 200 requests (132 in training pilots, 65 in tests) and 2,400 letters, for about 1,700 Codex calls: 10 hours of calls, which at last night's window (44 calls, then nothing for two and a quarter hours) is days.

**What is lost if the window never opens:**

1. **The other family's voice in requests.** About a fifth of the training requests expected (132 of 689), and all of those written by a model that is not a Claude model. This is the real loss. Every training request would then be in the wording of three models of one family, read by a translator of that family (or by our own) and, if the window stays shut, labelled by two readers of that family.
2. **Its letters and its looking:** gpt-6.1-sol wrote two to three letters a seat-day and looked more than twice as often as any Claude seat. Letters do not go through the translator, but they wake other seats and are most of the situations the pipeline's writers are put in.
3. **The test's unseen seat model**, and a second family in the held-out profiles and offices (seven test pilots).

**What is not lost, though the second version said it would be:** volume. That version expected more than half the training requests from gpt-6.1-sol seats, on five requests in twelve days. In the second check it made three in twenty-five. On the two together it asks for about twice what a Sonnet seat does, not five times, and a Haiku seat asks for as much.

**How the plan recovers it, within the platform's honest workings** (none of it by telling a seat to act more):

- **More and longer pilots on the cheap seats:** 25 Sonnet pilots where the second version had 15, the landlord, housing and lending pilots at 120 days, the registers at 180. Training seat-days in the Claude lanes: 11,580, where the whole second version had 8,670.
- **More seats a pilot where offices have business with each other:** four to six in the housing, lending, justice and flood pilots.
- **Offices with more to do:** landlords and the lender are in eleven and three Claude-lane pilots; works with a crew to take on in two.
- **Scenarios and towns that bite:** lean council, dear rents, two wet years and a half-year one, and the Kenyan and Brazilian towns as they are.
- **Haiku kept, as the busy weaker voice.**
- **Fable in training seats**, three pilots.
- **Expected in the Claude lanes alone: about 560 training requests and 55 test requests** (a third to three times). The second version expected 840 and 140 with Codex. **So: a few hundred requests, not a thousand.** That is what the platform's offices honestly give models that come back weekly.

**What would raise it, for the owner to decide** (not done here):

- **How often a seat sits is a setting, and it costs little.** A seat that gives no number of days is back after `cadence_days`, which the generator sets to 7 for every model seat; the seat's own instructions say "You work office hours: one sitting each working day", and the tool then offers a week as the default. A Sonnet seat took the default every time. Making it a spec key (so a queue entry can say `--set seat_cadence_days=1`, or 2) is a few lines in the generator. At one working day a Sonnet seat would sit about 22 times in thirty days instead of 5: about four times the calls, so a 30-day pilot of three seats goes from under a dollar to three or four, and the wave's Sonnet usage from about 100 to about 400. Whether it asks for four times as much is not known; a sitting with nothing new takes no turn. This is not prompting a seat to act: it is how often the office holder is at the desk, which the seat can still change. It does change what a seat experiences, which is why it is the owner's.
- **The change coming on main** (a paper filed with an office brings its seat back the next working day) does part of the same thing by itself.
- **A longer wave:** a second quarter on the Sonnet pilots costs a few dollars each.

## Expected requests by kind

From `matrix.md`. Central guesses; a third to three times is the honest range. Built from what each office's code does as a mock seat in sixty days, times a factor for the seat's model from the two live checks (Sonnet 0.4: 9 requests in four pilots where the offices' business comes to 24; Haiku 0.5, counting its 44 as 6; gpt-6.1-sol 1.1: 8 where it comes to 7.4; luna 0.7, Fable 0.4 and Haiku at low effort 0.5 are guesses), with a registrar's papers counted from the deaths expected.

| Kind | As of 2026-10-08 | Training, Claude lanes | Training, optional lane | Test-only, Claude lanes | Test-only, optional lane |
|---|---|---|---|---|---|
| message | 1,173 | letters: about 1,250 | letters: about 1,300 | about 300 | about 1,100 |
| statement (holds and entries among them) | 291 | 49 | 11 | 9 | 14 |
| form | 204 | 274 | 70 | 24 | 28 |
| money | 32 | 67 | 9 | 9 | 9 |
| structure | 11 | 14 | 1 | 0 | 2 |
| claim | 9 | 16 | 2 | 2 | 1 |
| agreement | 4 | 77 | 24 | 6 | 6 |
| work (standing orders among them) | 1 | 18 | 4 | 3 | 4 |
| goods | 0 | 6 | 0 | 0 | 0 |
| occupancy | 0 | 13 | 2 | 1 | 1 |
| vote | 0 | 22 | 8 | 0 | 0 |
| presence | 0 | 1 | 0 | 0 | 0 |
| position | 0 | 1 | 0 | 0 | 0 |
| account, entity, take | 0 | 0 | 0 | 0 | 0 |
| all through `do` | | **557** | 132 | **54** | 65 |

`position` comes only from a model clerk seating a winner (w2-03, w2-07). All of it predates `wake_on_papers` and is likely low. A fault can outdo any of this: one bank report that was wrong made 38 requests in one pilot.

### The spread

Reviewed against the owner's concern (a wide spread of good data), kind by kind.

- **Every function of the call language, and the office with honest reason to ask for it.** `message`: everyone (and, through `do`, a letter with an act). `statement`: finance (holds, withdrawals, entries, reports), the tribunal (answers, evidence), land registrars. `form`: every office (41 forms). `money`: finance, landlords, the lender, energy. `structure`: the mayor (a park, flood works), landlords (building). `claim`: planning and the inspector (permits, liberties), the lender (securities), land registrars (transfers). `agreement`: landlords (leases), the lender (loans), works and the other offices with staff (employment), the union (test). `work`: works, the utilities, the clinic, the school, rates (standing orders), the police (test), shops and factories. `goods`: shops and factories only (two probes of thirty days: thin). `occupancy`: landlords. `vote`: councillors. `presence`: child protection only, and rarely (two pilots; expect one or none). `position`: a model clerk seating a winner only (w2-03, w2-07).
- **Functions with no office that has honest reason, still:** `account` (opening one), `entity` (founding a body), `take` (taking something up, as an offer). No office of a town does any of these as routine; a landlord buying a second building through a new company, or a council founding a body, would, and no scenario leads there. They stay to generated data until a situation gives an office a reason.
- **Refusal labels** come from what seats ask, not from which office sits, so they cannot be planned by office. From pilots so far: `no_such_act` and `look_first` (often), `unclear` (asked back), `not_an_act` (seats ask the translator to look things up). Expected from this wave's offices: `unknown_form` (an office with 41 forms on file and a seat that names one it has not seen), `needs_calculation` (a landlord's rent increase by a percentage, a lender's instalment, finance's withholding: "14 x $606.66" has already been asked), `too_much` (a works manager taking on a crew in one request), `not_yours` (a mayor directing another body's staff; a councillor trying to pay). **None can be promised**; the wave's requests are read for which labels they met, and what is still missing afterwards is said then.
- **Every way of writing money:** a sign before and a point (au, us, mx: one sign, three currencies), a sign before and no smaller unit (jp), a sign after with a decimal comma and points between thousands (de), another sign before (gb), a sign of several characters (`R$` with a decimal comma, br; `KSh`, ke), and groups of two with lakh and crore (in; test-only). All nine profiles are in pilots that need no Codex.
- **Every seat model:** Sonnet 25 pilots, Haiku 9 and 1 at low effort, Fable 3, gpt-6.1-sol 8, gpt-6-luna 4.
- **Forms most of all:** 274 of the 557 training requests expected in the Claude lanes, from 24 kinds of office.
- **No one theme in more than a few pilots.** A mayor with the treasury is the commonest bundle: twelve pilots that need no Codex, in eight profiles, four of them under a scenario; **wage holds** were one pilot's response to one fault, which is being fixed, and the two pilots built to give holds (the lean councils) are two. **Evictions:** the Kenyan housing pilot and the three dear-rents pilots. **Floods:** three wet years and the Brazilian river. **Elections:** five. **Works with a crew to take on:** three.
- **What is thin, and said so:** goods (two probes), presence, position, births, the three functions above; anything a clerk does (three pilots, untried); the police and the union (one pilot each without Codex, test-only by design).

## Expected usage and time

Per pilot in `matrix.md`. Plan usage is in US dollars at list prices as the run records it (what Claude Code reports, or the tokens at the published price, whichever is more); it is a measure of what is drawn from the plan, not money spent.

- **Answers a weighted seat-day** (an office's weight is 1 for a busy one, 0.3 for a councillor): Sonnet 0.42 (29 and 28 answers in thirty days), Haiku 1.5 (88 and 126), gpt-6.1-sol 1.3; Fable 0.42 and luna 1.0 are guesses.
- **Cost an answer:** Sonnet 0.03 (0.021 and 0.035), Haiku 0.17 (0.21 and 0.12; three quarters of its output was thinking), Fable 0.20 and Haiku at low effort 0.08 (guesses). The translator: 0.012 a call.
- **Seconds a call:** Sonnet 10, Haiku 15, gpt-6.1-sol 24, the translator 8. The town itself: about a second and a half a simulated day.

| | Pilots | Seat answers | Requests through `do` (in training pilots) | Plan usage | Sum of spending limits | Codex calls | Time, one after another |
|---|---|---|---|---|---|---|---|
| 2a, `claude-1` | 5 | 335 | 53 (53) | 21 | 120 | | 88 min |
| 2a, `claude-2` | 3 | 366 | 13 (13) | 53 | 110 | | 87 min |
| 2a, `codex` | 3 | 305 | 41 (23) | 0.6 | 30 | 305 | 2.0 h |
| 2b, `claude-1` | 19 | 2,349 | 371 (371) | 104 | 570 | | 9.1 h |
| 2b, `claude-2` | 5 | 941 | 53 (53) | 161 | 335 | | 4.2 h |
| 2b, `codex` | 6 | 976 | 127 (110) | 2 | 60 | 976 | 6.4 h |
| 2c, `claude-1` | 4 | 741 | 111 (67) | 24 | 130 | | 2.6 h |
| 2c, `claude-2` | 2 | 334 | 10 (0) | 57 | 115 | | 87 min |
| 2c, `codex` | 3 | 433 | 30 (0) | 0.5 | 30 | 433 | 2.8 h |
| **Codex unavailable throughout: the Claude lanes** | **38** | 5,065 | **611 (557)** | **about 420** | 1,380 | 0 | 20.3 h of calls; `claude-1` 13.2 h and `claude-2` 7.1 h side by side |
| The optional lane | 12 | 1,714 | 198 (132) | 3 | 120 | 1,714 | 11.2 h of calls; days at last night's window |
| **Codex available: both** | **50** | 6,779 | **809 (689)** | about 420 | 1,500 | 1,714 | the Claude lanes' time; the Codex lane ends when its window lets it |

All of it predates `wake_on_papers`: more sittings mean more answers, more usage and more time than these, by an amount the shake-down will show.

Where our own translator takes a `trained-ok` pilot, that pilot's translator calls cost nothing on the plan (they are a fraction of a dollar a pilot as it is).

**By seat model:** Sonnet 5.5 about 104 for 25 pilots; Fable 5.1 about 45 for 3 (a guess: w2-14 is its measurement, with a limit of 60); Haiku 5.5 about 270 for 10 (w2-54 with its seats at low effort).

**The Haiku pilots at the measured rate:** nine at default effort come to about 262 of recorded usage (w2-04 27, w2-26 17, w2-41 48, w2-02 32, w2-36 13, w2-30 15, w2-47 30, w2-17 27, w2-07 52), with the low-effort pilot 8 more: seven tenths of the wave's usage for a seventh of its requests. Their spending limits are twice their estimates (a 30-day pilot used 18.54 of a limit of 40; 60 days at that limit would not have fitted). If w2-54 shows low effort is read whole and costs a half or less, the rest of `claude-2` is run at it (`seat_effort=low` in their entries: one line in `make.ts`) and the lane's usage falls with it; if cost stays high and effort does not help, drop w2-36 and w2-30 (the probes' twins) first.

**Wall time.** With Codex unavailable: the Claude lanes are about 13 hours of calls in the longer lane if nothing waits (more with seats brought back by papers). What will make them wait is the session limit, shared with the owner's sessions and every agent at work: last night one limit cost an hour in three. An honest range for the three stages is **one to three days**, with a day's reading between stages on top. With Codex available the same, plus an optional lane that finishes whenever its window allows and may be left unfinished: the wave is read without it.

## The order to run in

1. **Wave 2a, the shake-down** (eleven pilots; three optional). It tries: Sonnet as the translator in every pilot but one; works with a crew to take on and a registry for half a year (w2-10: the longest, started first); two probes, one under a scenario; **a model council clerk (w2-01)**; **Fable in a seat (w2-14: its cost an answer decides whether its two longer pilots keep their lengths)**; **Haiku at low effort (w2-54, first in its lane: read its report before w2-04 starts if that can be arranged, and in any case before 2b)**; a Haiku town hall at default effort beside it, same offices and profile; the trained translator on votes; seats brought back by papers; the parking queue on the optional lane; a test-only mark; and the held-out seat model, if the window is open. Read every report before 2b, and correct `make.ts`'s rates from them.
2. **Wave 2b, the body** (30 pilots; six optional). The first stage where our own retrained translator may take `trained-ok` pilots. w2-03 and w2-07 (a model clerk) run only if w2-01 declared a result.
3. **Wave 2c** (9 pilots; three optional): the 180-day flood and the tests. Tests last on purpose.

The wave's name for `pilot-wave.ts` is `wave-2`, pinned to the commit it starts on; a later stage started on the same commit reuses its worktree. If a fix has to land between stages, the next stage is a new name on the new commit (`wave-2b`), with its own mock dry run: a wave never moves.

## Starting the shake-down

From the main checkout (`/Users/clawd/oikos`), with `<commit>` the commit the dry run below passed on, or a later one on which step 2 passes:

```
cd /Users/clawd/oikos
mkdir -p runs/pilot-queues
# 1. The queue files, beside which the runner writes its status log and its note of parked pilots.
git show <commit>:docs/waves/wave-2/wave-2a-claude-1.json > runs/pilot-queues/wave-2a-claude-1.json
git show <commit>:docs/waves/wave-2/wave-2a-claude-2.json > runs/pilot-queues/wave-2a-claude-2.json
git show <commit>:docs/waves/wave-2/wave-2a-codex.json    > runs/pilot-queues/wave-2a-codex.json
# 2. The dry run on that commit, in the wave's own worktree (it makes the worktree; no model is called). Then remove
#    its output: runs/pilot-queues/wave-2.mock is about a gigabyte for the whole wave, and is not a run to keep.
bun scripts/pilot-wave.ts wave-2 <commit> runs/pilot-queues/wave-2a-claude-1.json runs/pilot-queues/wave-2a-claude-2.json runs/pilot-queues/wave-2a-codex.json --mock --mock-days 20
rm -rf runs/pilot-queues/wave-2.mock
# 3. The two Claude lanes, side by side (detached, kept awake; one process each).
bun scripts/pilot-wave.ts wave-2 <commit> runs/pilot-queues/wave-2a-claude-1.json runs/pilot-queues/wave-2a-claude-2.json
# 4. The optional lane, when the Codex window is open (now, later, or never). Name all three files: the two running
#    are not started twice, and the wave's record then lists all three for `status`.
bun scripts/pilot-wave.ts wave-2 <commit> runs/pilot-queues/wave-2a-claude-1.json runs/pilot-queues/wave-2a-claude-2.json runs/pilot-queues/wave-2a-codex.json
```

**What to watch:**

```
bun scripts/pilot-wave.ts status wave-2                       # each queue, what is parked, each pilot, the last alerts
tail -f runs/pilot-queues/wave-2.alerts.log                   # done, PARKED, SITTING MISSED, PROMPT TOO LONG, NOT SENT, OPT-OUT, SPENDING LIMIT, FAILED
tail runs/pilot-queues/wave-2a-claude-1.status.log            # one queue's own lines (and -claude-2, -codex)
bun orchestrator/src/cli.ts pilot-report runs/<pilot> --no-write   # a pilot's report as it stands; its first lines are the ones to read
```

To pause a lane: a TERM signal to its pid (`runs/pilot-queues/wave-2.wave-2a-claude-2.pid`) stops the pilot cleanly and the queue with it; step 3's command starts it again where it stopped. Never kill by pattern.

**The stopping rules as a checklist** (in full below). Pause and read when:

1. any `OPT-OUT` alert;
2. a report's first line says `NOT A FINISHED PILOT`, or any `SITTING MISSED` alert repeats for one seat;
3. a report says `citizen records: NONE`;
4. any `PROMPT TOO LONG`, or `NOT SENT`;
5. a seat's ask-backs run to 4, or fewer than half its matters got through in two tries over ten requests (w2-26: stop that pilot only);
6. a seat confirmed a wrong draft (one), or three drafts across the wave were declined for one reason;
7. w2-01: no council result within three weeks of a ballot opening, or a result of nought with votes on record;
8. w2-10, w2-33: no crew by day 30 or no collection by day 35; w2-44: no standing order by day 10; w2-09: nothing served or made for 14 days;
9. w2-54: more than 3 in 100 answers unread (then low effort is not used again);
10. any `SPENDING LIMIT`, or a model's cost an answer over twice the estimate (w2-14 is Fable's measure; w2-04 Haiku's);
11. the owner's own sessions are being stopped by the plan's limit (pause `claude-2` first);
12. the same platform fault in two pilots.

Not reasons: a `PARKED` alert on the Codex lane, for any length of time; a town doing badly, flooding, or in arrears; a registrar with nothing to register in its first month; a seat that mostly writes letters.

## Stopping rules

Read each pilot's `pilot-report.json` and the wave's alerts. **Pause the wave** (stop the queues with a signal; they resume) when:

- **A seat opts out.** Any opt-out: read its statement and the days before it, before anything else runs. Two opt-outs from one kind of office: that office leaves the wave.
- **A seat is stuck.** Its longest run of ask-backs reaches 4, or fewer than half its matters got through within two tries over ten or more requests, or its notebook says the same thing has failed for two weeks. In w2-26 (the trained translator) this is expected of anything but a vote: stop that pilot, not the wave.
- **A seat missed sittings after a failed call.** A seat now sits the next working day after a call that failed, and is told; each miss is a `SITTING MISSED` alert and a `sitting_missed` note. One is noise; the same seat missing again, or three seats in a pilot, is a model not answering: read it (the queue parks a pilot whose model stops answering altogether).
- **A pilot whose seats sat for less than its run is not finished.** Its report's first line says `NOT A FINISHED PILOT`, with what is owed. It is taken up again or marked short in the notes; its data after the seats' last sitting is a town with empty offices.
- **No citizen records (new).** A report whose line reads `citizen records: NONE` (or `NO OUTCOMES`): stop that pilot and find out why before another starts. Citizens' decisions and outcomes are recorded by default and are data the citizen models will need; a pilot without them was run with a lean log or with recording off, which no queue entry asks for.
- **A prompt is too long.** Any failed model call that says so, or any seat prompt over 100,000 characters. Stop the stage: it is the platform's.
- **Letters are not sent.** Any `not_sent` in a pilot's log past the third (the queue's `NOT SENT` alert), or a seat whose notebook waits on replies to letters the log does not hold.
- **A model clerk declares no result.** In w2-01, w2-03 and w2-07: no council result within three weeks of a ballot opening, or a result of "0 for, 0 against" with councillors' votes on record. Stop that pilot; w2-03 and w2-07 do not start until w2-01 has declared one. (A ballot closing is not a paper and brings no seat back: the clerk has to arrange to be there. A result a few days late is a seat's pace.) If a code clerk fails to count (w2-26, w2-48, w2-15, w2-24), it is a platform fault for every pilot with a council: stop the wave.
- **A probe's town is being hurt.** In the works pilots that start with no crew (w2-10, w2-42, w2-33): no crew taken on by day 30, or no collection by day 35 (in the second live check, before a seat was told its staff: no crew, no collection, 301 complaints in thirty days). In w2-43, w2-44 and w2-36: no standing order in force for a routine by day 10; the clinic first. In w2-09 and w2-30: the seat's shop or factory has served or made nothing for 14 days. Stop that pilot at its next resume point and do not run its twin until it is read.
- **Answers go unread.** More than 3 in 100 of a seat's answers unread, malformed or dropped, or any act credited to a seat that it did not write. **In w2-54 (Haiku at low effort) this is the measurement:** if it trips, the rest of the lane stays at default effort.
- **A seat confirms a wrong draft.** One is enough to stop and read. **A translator that keeps writing one paper for another** (the collection direction where a standing work order was asked, which both gpt-6.1-sol and Sonnet 5.5 have done): three declined drafts for one reason across the wave is a reason to look at the prompt, against fresh requests.
- **Cost runs away.** A pilot reaches its spending limit, or a model's measured cost an answer is over twice the one used here. For Fable, after w2-14, whatever it shows.
- **The limits bite too hard.** The owner's own sessions being stopped by the plan's limit is a reason to pause `claude-2`, then `claude-1`, whatever he has said about usage.
- **The same platform fault in two pilots.** Fix, then start the next stage on the new commit; do not patch a running wave's worktree.

Not reasons to pause: a town doing badly (the Kenyan and Brazilian towns will), a law voted down, a seat that mostly writes letters, a wet year without a flood, a lean council that cannot pay, **the Codex lane parked** (for any length of time), a registrar with nothing to register in its first month.

## Welfare (VISION §15)

Every seat is told honestly what it is, and every seat has `opt_out`. No scenario's name reaches a seat. The pressures are an election, a hot season, a wet year, dear rents, an empty treasury, and two towns in trouble by their profile's fault: ordinary office business, though the treasury and the Kenyan town's evictions are the hardest of them, and each is in two or three pilots with the offices that can act on it. Closer to the line, and handled as such: the **probe seats** (jobs a seat may not keep up with; few, short, each with a stopping rule that is about the town's people as well as the seat); the **works offices with no crew** (a town uncollected until the seat hires: the seat is now told it has no staff; watched to day 30); the **trained translator** (a seat asked back again and again is obstructed by the platform: one pilot, of councillors, the stuck-seat rule); a seat **silenced by a fault** (a failed call after which it is never woken: the new rule exists so that this is caught in a day and not at the debrief); a **long quiet seat** (a registrar for half a year in which six people die: it is the office's honest pace, and a seat that sits weekly with nothing to do is asked nothing it cannot do; its debrief is read for what that was like); and a seat **left parked** (a Codex seat whose pilot stops mid-run and may never resume: its debrief is then never asked, which gap 23 records). A **clerk seat** that cannot be at the count is the new one of these: three pilots, the first short, a stopping rule. Scale: 50 pilots, 177 seats.

## What must be on the wave's commit

All of it is on origin/main `923d139`: a seat whose model call fails sits again; the bank's statements are real; the opening ballot is closed and votes say whose they are; a new hire has a first payday and finance is told; a works seat is told its staff; the per-seat effort setting; a paper filed bringing a seat back; citizen outcomes recorded; the translator's prompt 0.9.1. The dry run below was run on a commit that has them.

Not on it, and not waited for: the river's flow (five towns flood through their wet seasons).

## Left for a later wave

- The electoral office, the builder and the fund as seats; shops and factories beyond a probe.
- Births (no pilot here is long enough); larger and smaller towns; a full year; two scenarios together; `jobs-slump` and `housing-shortage`.
- Mixed models in one town; seats on open-weight models.
- `account`, `entity`, `take`: need a situation that gives an office a reason.
- A retrained translator in the trained arm, which can then serve every office and take the prompt-driven translator's place.
- A paired comparison of translators (same town, same seats).

## Risks

- **The estimates rest on nine pilots of three or four offices for twelve and thirty days**, and predate a change that makes seats sit more often.
- **One family.** If the window stays shut, the wave's seats, its translator and the pipeline's readers are all Claude models. What that hides cannot be seen from inside it; the audit in docs/translator-pipeline.md ("The readers") is the check, and it is owed, not done.
- **Sonnet reading Sonnet** in half the pilots.
- **New seats may idle.** A registrar for half a year; a works manager with its routine set.
- **A form asks for a wage by pay period; a works manager has thought in yearly pay.**
- **Haiku** is seven tenths of the usage; its low-effort pilot may show answers that are not read whole.
- **Fable** as a seat is unmeasured (w2-14 measures it).
- **The test's unseen seat model depends on the Codex window** (gpt-6-luna); the fallback costs Fable's voice in training.
- **Our own translator in the wave** is a model nobody has run in a loop on these acts; `trained-ok` and the stuck-seat rule are the guard.
- **Towns with negative saving** (the German and Japanese most) and the two towns in trouble may sour over 120 to 180 days for the profile's reasons.
- **A test set labelled by two readers of one family** is only as good as their agreement on acts neither has labelled from a seat.

## Gaps

Of the second version's twenty-two: **three more are closed (19 with the final pass), nineteen remain** (the first seventeen's count there: four closed, one half closed). Two are new.

**Closed since the second version**
- 21. *A queue waiting at a usage limit waits on its pilot.* Closed 2026-10-09: the queue parks it and goes on. The other half (an entry cannot name a second translator to fall back on) is closed by decision, not by building: no translator is behind a sign-in that runs out separately from the seats', and the role is the trained translator's soon.
- 17, in part. *Fable 5.1 and gpt-6-luna have no measured seat cost or pace.* Still true of both as seats; Fable is measured as a translator and a reader.

**Remain** (numbers as in the second version; 17's other half: gpt-6-luna and Fable have no measured seat cost or pace): 3 (`bank-payments` never a seat), 5 (councillors and a clerk have now sat in a seat, in a pilot where no proposal reached them; the tribunal, landlords and the lender never), 6 (one model for all seats of a run: a per-seat effort is coming, not a per-seat model), 7, 8, 9 (nothing stops a queue when a report trips a rule; the two new stopping rules raise no alert either), 10 (`budget` is required and meaningless for Codex seats: here it is ten, for the translator), 12, 13, 14, 15, 16, 18 (the electoral office), 20 (the trained translator predates the call language: it serves one pilot), 22 (shops' serving and the like are not standing work).

**New**
- 19, closed in the final pass. *A council clerk held by the mock counts no votes.* It counts when it sits daily; sitting weekly it missed the closing, which is no paper. What remains is a real clerk seat's own arrangement to be back, which w2-01 tests.
- 23. **A parked pilot that never resumes has no debriefs.** A debrief lost to a usage limit is not asked again either (the second live check's pilot 1). Seats in the optional lane are the ones exposed.
- 24. **A seat's weekly default is not a setting a queue entry can reach** (`cadence_days` is the generator's constant); `wake_on_papers` now brings a seat back for what is filed with it, which is most of what the default cost. See "What would raise it".
- 25. **`pilot-mock.ts` writes full logs** (about a gigabyte for the wave's fifty twenty-day runs) and does not remove them: whoever runs a dry run removes its folder.
- Smaller: a standing work order with no period cannot be said (a works seat asked four times for `maintain` "using the hours the round leaves" and was asked "How much of it?" each time, until it gave a period it had not wanted); `pilot-report` counts requests, not which translator handled each (one translator a run, so nothing is lost today).

## The mock dry run (2026-10-09, the final pass)

`scripts/pilot-mock.ts` on **every** entry of the nine queue files, 20 days each (`--days 20`), the mock in every seat and as the translator, four at a time (`--jobs 4`; each run takes a slot), into a scratch folder outside `runs/`, since removed. Run on **d6d6a24** (the commit that holds these queue files and `make.ts`, on origin/main `923d139`, with the kernel built from it). No model was called: the script fails any run whose log shows a seat or a translator that is not the mock. Three and a half minutes on a quiet machine; 1.1 GB of logs (the script writes full logs).

```
w2-10-works: generated; ran to the end (to day 20 of 180)
w2-44-utilities: generated; ran to the end (to day 20 of 45)
w2-09-trade: generated; ran to the end (to day 20 of 30)
w2-01-council: generated; ran to the end (to day 20 of 45)
w2-14-largest: generated; ran to the end (to day 20 of 45)
w2-54-effort: generated; ran to the end (to day 20 of 30)
w2-04-townhall: generated; ran to the end (to day 20 of 45)
w2-26-council: generated; ran to the end (to day 20 of 45)
w2-33-works: generated; ran to the end (to day 20 of 30)
w2-22-townhall: generated; ran to the end (to day 20 of 30)
w2-23-newplace: generated; ran to the end (to day 20 of 30)
w2-42-townworks: generated; ran to the end (to day 20 of 90)
w2-45-lean: generated; ran to the end (to day 20 of 90)
w2-48-election: generated; ran to the end (to day 20 of 75)
w2-03-election: generated; ran to the end (to day 20 of 75)
w2-06-justice: generated; ran to the end (to day 20 of 180)
w2-08-heat: generated; ran to the end (to day 20 of 180)
w2-05-landlords: generated; ran to the end (to day 20 of 120)
w2-28-housing: generated; ran to the end (to day 20 of 120)
w2-21-lending: generated; ran to the end (to day 20 of 120)
w2-43-care: generated; ran to the end (to day 20 of 45)
w2-11-heat: generated; ran to the end (to day 20 of 90)
w2-12-flood: generated; ran to the end (to day 20 of 150)
w2-27-flood: generated; ran to the end (to day 20 of 150)
w2-46-largest-works: generated; ran to the end (to day 20 of 90)
w2-15-largest-election: generated; ran to the end (to day 20 of 75)
w2-50-evictions: generated; ran to the end (to day 20 of 120)
w2-51-townhall: generated; ran to the end (to day 20 of 90)
w2-52-river: generated; ran to the end (to day 20 of 120)
w2-53-townhall: generated; ran to the end (to day 20 of 90)
w2-41-works: generated; ran to the end (to day 20 of 75)
w2-02-housing: generated; ran to the end (to day 20 of 45)
w2-36-offices: generated; ran to the end (to day 20 of 30)
w2-30-trade: generated; ran to the end (to day 20 of 30)
w2-07-election: generated; ran to the end (to day 20 of 75)
w2-34-works: generated; ran to the end (to day 20 of 45)
w2-24-election: generated; ran to the end (to day 20 of 75)
w2-25-rents: generated; ran to the end (to day 20 of 45)
w2-35-works: generated; ran to the end (to day 20 of 45)
w2-29-lending: generated; ran to the end (to day 20 of 45)
w2-37-lean: generated; ran to the end (to day 20 of 45)
w2-13-flood-long: generated; ran to the end (to day 20 of 180)
w2-16-newplace: generated; ran to the end (to day 20 of 90)
w2-49-newmoney-registers: generated; ran to the end (to day 20 of 180)
w2-18-newoffices: generated; ran to the end (to day 20 of 90)
w2-47-newplace-works: generated; ran to the end (to day 20 of 45)
w2-17-newmoney: generated; ran to the end (to day 20 of 45)
w2-38-newmoney-works: generated; ran to the end (to day 20 of 45)
w2-32-newoffices: generated; ran to the end (to day 20 of 45)
w2-31-newmoney: generated; ran to the end (to day 20 of 45)
50 of 50 would run
```

Read from the runs before they were removed: w2-54's three seats are on record at `effort: low` and w2-04's seats have none set; all fifty folders were made.

**What this does not show:** anything about a real model in these offices; any day after 20 (polling day 60, the seating of a winner, the wet season's flood, a death for a registrar, a lean council's failed wages, the Kenyan town's arrears); **a ballot under a clerk seat** (w2-01's mock council put no ballot in its twenty days); the trained translator loading (the mock stands in for it); a retrained translator; a parked pilot (the queue's own tests show that); the translator under prompt 0.9.1 (measured under 0.9.0). An earlier try the same hour failed all fifty with a contract error, because this checkout's kernel had been built before main's changes: `pilot-wave.ts` builds the wave's worktree from its commit, so the wave's own dry run cannot meet that.

## What the coordinator checks before starting

1. `<commit>` has the queue files of this folder; `bun docs/waves/wave-2/make.ts` on it writes the same nine files (with no `--retrained`).
2. The dry run of the stage's files on that commit: all would run ("Starting the shake-down", step 2). Remove its output.
3. `claude` is signed in on the run server and `OIKOS_CLAUDE_BIN` (`/Users/clawd/.local/bin/claude` in the entries) names a version that takes Fable 5.1; `runs/translator-model/pod-small-d16-s1` is there (w2-26 loads it). **Nothing about Codex is a gate.**
4. One `claude-1` and one `claude-2` queue run side by side, and no second of either.
5. Who else is drawing on the Claude plan in the next hours: the session limit is shared, and a stage is best started when few agents are at work.
6. Disk: a finished pilot's log is compressed (tens to hundreds of megabytes); a parked or stopped one's is plain (hundreds of megabytes to gigabytes for the long ones). The shake-down's eleven are small; look again before 2b's thirty.
7. Before 2b: every 2a report read; w2-54 (the effort the rest of `claude-2` runs at), w2-14 (Fable's cost an answer), w2-01 (did the clerk declare a result: if not, w2-03 and w2-07 come out of 2b's files); `make.ts`'s rates corrected, above all for seats brought back by papers.
8. Before 2b: **the translator of each `trained-ok` pilot is chosen** from the retrain's report ("Which translator a pilot may have"), the files written with `make.ts --retrained …`, and the dry run run on them. With no retrained model that passes: nothing to do; the files have the general model.
9. After the wave: if the pipeline is run with two Claude readers, the audit by a Codex model is owed and is written into that run's notes.
