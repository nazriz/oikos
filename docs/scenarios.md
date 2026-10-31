# Scenarios: named starting conditions

**Source:** `worlds/generator/scenario.ts` (how one is applied), `worlds/generator/weather.ts` (`chooseWeather`),
`worlds/scenarios/<id>.yaml` (the scenarios). Tests: `worlds/test/scenario.test.ts` (quick),
`orchestrator/test/scenarios.test.ts` (each one run for sixty days at 1,000 people, and generated from every profile).

Every pilot so far started from the same calm town, so its offices asked for the same few kinds of act. A scenario
starts the town somewhere else: under a wet year, with an election due, short of doctors, with little in the bank.
The offices that bear the pressure then have other things to ask for.

## What a scenario is, and is not

A scenario is **a set of starting conditions and world parameters, as data**. It shifts what a mechanism the world
already has is given: the year the weather is drawn as, the day a term ends, an opening balance, a staffing figure, the
world market's demand. The generator then makes the town as it makes any other, and the run is an ordinary run.

It is **not an event**. Nothing is made to happen on a day; no outcome is forced. A wet year's rain floods the town only
if the river, its banks and where the buildings stand make it so. An employer short of cash fails only if its sales and
its bank let it. If a scenario's pressure doesn't show in a run, that is a finding about the mechanism, not a fault in
the scenario (calibrate mechanisms, not outcomes).

Four rules, which `checkScenario` enforces when a scenario is read:

1. **For any place.** A scenario gives no place's figures. Money and quantities change only by a multiple of the
   profile's own (`times_bps`). Only a share (`..._bps`) or a count of days, months or years may be set outright. A
   profile's currency can't be touched. The weather isn't re-parameterised at all: the run is given one of the
   climate's own years, chosen by where it stands among them (a percentile).
2. **From the first day.** The world market's conditions (`shocks`) may be added only with `from_day: 0`: the world as
   the run finds it. A condition that begins later would be an event made to happen, and is refused. A scenario can't
   write the weather day by day, name a seed, or change the town's size, name or profile.
3. **Every change says its basis:** the real-world evidence for its size, or that it is a placeholder and why. The
   citations are gathered in `docs/research/references.md` ("Scenarios"), the unverified ones marked.
4. **Unseen.** A scenario's name and words reach no participant. A seat learns of its situation as anyone in the town
   would: the bureau's warning, the bank balance, the queue at the clinic. The only trace in the world's config is the
   end of `meta.description` ("Starting conditions: wet-year."), which is the researcher's (the run's dataset
   manifest carries it); no participant is shown `meta`.

The platform does not judge: a scenario's name describes conditions, never how the town should come through them.

## Using one

In a town's description:

```yaml
scenario: wet-year                 # or a list: [wet-year, lean-council]; or one text: wet-year+lean-council
```

From the command line (the same thing as `--set scenario=...`; the batch goes to `runs/<world>.<names>` unless
`--out` says):

```
oikos run worlds/town-1000.yaml --scenario wet-year+lean-council --set mayor=llm --set model_seats=planning,finance
oikos scenarios                    # the scenarios there are, and what each shifts; the inert ones named last (--all: each in full)
```

A batch's `batch.json` records the description with its `scenario`, so a run can be traced to its conditions. A resumed
run is run from its own log's config, which already holds the town as generated.

No scenario, or `baseline`, is the town exactly as before: the same config to the byte, the same run.

## How one is applied

`generate()` begins by applying the named scenarios to the town's description and to a copy of its profile's figures
(`applyScenarios`); everything after reads those. So a shift reaches everything derived from the figure it moves, by
the generator's own formulas: fewer in work means shops staffed to a poorer town's spending; an older census means
other households, pensions and deaths.

A change (`changes:`) names where it applies and does one thing:

| | |
|---|---|
| `in: profile`, `path: a.b.c` | a figure of the profile's `values`. A profile that doesn't describe it can't be put under the scenario, and generation says so. |
| `in: town`, `path: ...` | one of the description's own: `housed_bps`, `employed_bps`, `landlord_compliance_bps`, `first_election_days`, `houses`, `apartment_blocks`, `shops`, `factories`, `shocks`. Nothing else. |
| `times_bps: N` | a multiple of what is there (10,000 = unchanged). Whole numbers stay whole; a count never falls to none. |
| `set: N` | the value outright (shares, days, months, years only). |
| `shortfall_times_bps: N` | for a share: a multiple of what it falls short of 10,000 by (an employed share of 9,500 at 20,000 becomes 9,000: twice as many out of work). |
| `add: {from_day: 0, kind, what, factor_bps}` | a condition of the world market (to `shocks`): a kind's price, or the demand for it, as a multiple of the profile's. |
| `where: {field, at_least, at_most}`, `of: f` | of a list of rows in a profile: the rows within the bounds, and the field of each that is changed (the age bands from 65). |

Three more things a scenario may say:

- **`season.starts_in`**: `wet_half`, `dry_half` (the month from which the next six bring the river most or least, by
  the profile's `rain_by_month_bps`) or `hot_months` (the first of its `summer_months`). It sets the month the run
  starts in, so a half-year run holds the season that matters, in whichever hemisphere the profile is.
- **`weather`**: `rank_by`, `percentile`, `draws`, `over_days`. `draws` years are drawn from the profile's climate,
  each from a seeded stream of its own (`weather-1`, `weather-2`, ...); each is measured over the run's first
  `over_days` days (`wettest_spell`: the most the river is sent in five days running; `inflow`: what it is sent in
  all; `heatwave_days`); the one at `percentile` is the run's. The bureau warns of what that year holds, as of any
  year's. The climate is untouched, so how rare the year is means what it says.
- **`capability`** (docs/design/foundations-2.md 7.2 and 7.5; `worlds/generator/capability.ts`): the outside world's
  capability over time, as the owner ruled (2026-10-25: capabilities come from an outside scenario for now). `of` names
  what it moves (a vendor's offer by id, or `assistants`, every provider's offer where the town has them), `every_days`
  how often a new release comes out from the first day, and `time_bps`, `slip_bps` and `price_bps` each release's time,
  slips and prices as shares of the one before. Each release is a kind of system of its own (a template `<kind>-r<n>`,
  `released` on its day: the kernel refuses to deliver one before), with its rows quicker and its row of the table of
  slips lower; its seller sells the newest out and publishes the offer again when one comes out; a system delivered
  stays what it was. `tag` names the technology for measurement (`ai`): every kind it moves, and their releases, are
  listed in `meta.study_tags`, which nothing in the world reads (`orchestrator/test/generality.test.ts`). A rate from the
  first day, as a falling price is, never a release made to happen on a day of the scenario's choosing.

Everything is fixed by the description's seed: the same description and scenarios give the same town.

## Together

Scenarios named together are applied in the order named. Multiples multiply. Two that set the same thing to different
values, or that each choose the season or the weather (`wet-year+dry-year`), don't go together, and generation says
which. Otherwise any go together: `wet-year+lean-council` is a wet year for a town with little in the bank.

## The scenarios

Sizes are relative to the profile, so the figures in the last column are what they come to in the first profile's
1,000-person town, for illustration only. **What an office is shown** is measured: each scenario against the plain town,
like for like (1,000 people, 120 days, seeds 1 and 2, the mock in the mayor's, planning and finance offices; `oikos
diff`, the log's records by kind and addressee, and what eighteen offices were shown and sent, from their recorded
observations). The sources for the sizes, and which were opened, are in `docs/research/references.md` ("Scenarios").

**Bites** (offered by default):

| Scenario | What it shifts | Basis for the size | What moved, and what an office is shown |
|---|---|---|---|
| `baseline` | Nothing. | | The plain town, to the byte. |
| `wet-year` | Starts at the wet half-year; the weather is the climate's year at the 99th percentile of 199 by its wettest five days. | The 1%-a-year flood is the one planned against (the United States' base flood; opened). | The bureau's warning about day 110; buildings flooded from day 114; complaints to the town. |
| `hot-summer` | Starts with the first hot month; the climate's summer at the 95th percentile of 199 by heatwave days. | A one-in-twenty season (to confirm). | Heatwave warnings from day 12; about fifteen heatwave days in ninety against five; more falling ill. |
| `election-due` | Polling day is day 60. | Not a size: when a term ends. | Notice on day 0, nominations close day 30, voting from day 46, a result and an appointment. |
| `lean-council` | The town's opening balance a hundredth of the profile's (was a tenth); grants from above halved. | Balance: no source (the profile's is a placeholder); set against spending, it is nine days' worth, 2% to 3% of a year's. Grants: funding for English councils fell 49.1%, 2010-11 to 2017-18 (National Audit Office; opened). | In two seeds of three the bank writes to finance and the mayor from day 16 that a wage payment failed for want of funds (seven letters); the crew resign from day 23 and record the wages as debts (seven or eight claims); the tribunal sends notices of hearing; seventeen to twenty-four applications come for the posts. In the third the first rates arrive in time and the balance only runs low. A tenth was never drawn below 84% of itself. |
| `jobs-slump` | Twice the share out of work at the start. | Unemployment in the United States, 5.0% to 10.0%, December 2007 to October 2009 (opened). | 6.9% out of work at day 120 against 2.5%; an eighth more support claims (to the support office, outside); a third more people leave. An office of the town is shown only more applicants for each post it advertises (the police 22 to 24 against 8 to 9) and more notices of departure. The count of people on support is published monthly and no office is shown it unless it looks. |
| `housing-shortage` | A tenth fewer houses and apartment blocks. | A backlog of 4.3 million homes in Britain (Centre for Cities; opened), about a seventh of the stock (to confirm). | Twice as many households without a home (12.5 against 6.5); half as many again leave (87 against 59). The mayor, finance and rates are shown the departures (about 85 notices against 55 to 65, none saying why) and a tenth fewer ratepayers. Planning is shown no more applications: landlords were already building as fast as they do. |
| `energy-price-shock` | The grid's price to the retailer doubled from day 0. | Wholesale prices more than doubled in 2022 (to confirm). | The retailer's books only: it ends 120 days with a third of the plain town's balance. Its tariff is fixed, so no household, and no office of the town, sees anything. |
| `dear-rents` | Every rent a quarter higher, for the same wages. | Rents rose 22% to 30% in three years in one national index (to confirm). | 44% of renting households pay over 30% of income in rent, against 24%; the petition on rents, which the mayor is shown with its counts, has 42 to 65 signatures by day 120 against 27 to 28; a sixth more loan applications reach the bank. |

**Inert** (kept, and can be named; `status: inert` in the file with what is missing; left out of `oikos scenarios`'
list and of `offeredScenarioIds()`): the conditions hold, and nothing of them reaches an office until the platform changes.

| Scenario | What it shifts | Why nothing reaches an office | What it needs |
|---|---|---|---|
| `dry-year` | Starts at the dry half-year; the climate's year at the 1st percentile of 199 by inflow. | The bureau's public drought warning (day 108) and nothing more. The supplier restricts only when the river refuses its draw; every river cell is sent the profile's inflow, and the town draws about a thousandth of it, so four tenths of a low season is still hundreds of times the draw. | A river sized against the town's draw, or a supplier that restricts at a level of storage or flow, as suppliers do. |
| `export-slump` | The world market takes a quarter less of the factories' goods (was 12%). | Slow by the producer's own rule: a factory over-stocked stops making, keeps paying, and lets one worker go a month once stock passes a month's demand. Nine more redundancies in 240 days; unemployment doesn't move; nobody tells the town. | A headcount rule that sheds as fast as firms in a slump do, or a report of short time to someone. |
| `rising-capability` | A new release of the outside's case-handling systems and assistants every six months, each a fifth quicker and slipping a fifth less, at the same prices (`capability`). | The first release falls on day 182: nothing of it is out in 120 days, and nothing in the world is told of a release before it is out. | Years, not months (the multi-year runs). Not measured yet against the plain town over a year. |
| `ageing-town` | Half as many again in every age band from 65. | A smaller labour force and an eighth more pension claims (outside). Deaths and hospital-level illness are a handful in 120 days at any age mix; the clinic is far from full; the town provides nothing by age. | Routine and aged care; or years, not months. |
| `dirty-industry` | Each factory's pollution two and a half times the profile's. | Nothing differs from the plain town, to the count of every species. The unit of pollution is a placeholder, far under the one sensitive species' tolerance where it lives; pollution makes nobody ill; no office measures it. | A sourced unit, an effect at realistic levels, and someone who measures. |
| `doctor-shortage` | Half the doctors for the town's size. | About thirty requests for care in 120 days; one doctor can give twenty consultations a day. Every patient is seen the day they ask; only the clinic's grant halves. | Routine care, so a doctor's day is full. |
| `police-understrength` | 14% fewer officers for the town's size. | No taking is reported to the police in 120 days, with or without it. | A sourced rate of offending and of time per investigation. |

What was measured, the platform faults found on the way, and what was not verified are in the decisions log
(2026-10-08, "Scenarios").

## What has no honest scenario yet

- **A flood on a given day, or a flood for certain.** The weather can be made a wet year; the flood is the river's.
- **A crime wave.** Offending here follows need and opportunity, at a chance the profile calls a placeholder and keeps
  deliberately rare (docs/behaviour/crime.md): a town in a slump has almost no more of it. Raising that chance would
  be setting the outcome with no source for the size. What a scenario can honestly move is the police's strength
  (`police-understrength`) and how many are in need (`jobs-slump`); they can be named together.
- **A council in deficit from the first day.** An account can't open below nothing, and the town has no debts at the
  start to give it. `lean-council` is a town with almost no reserves, which has to live on what comes in.
  (Since 2026-10-09 every town opens with its first year's budget adopted, `lean-council`'s too: the same lines as
  the plain town, against a hundredth of the money. docs/decisions.md, "A town opens with its first year's budget
  adopted", has it measured.)
- **A works crew too small for its rounds.** Tried (`services.council_staff_per_1000` at 70%: four staff, not six) and
  dropped: nothing moved. The whole town's waste takes the crew about half an hour a day at the profile's
  `collect_seconds_per_10kg` (12, a placeholder), so no honest cut leaves a round undone.
- **A dearer grid that reaches households.** The retailer's tariff is fixed and nobody sets it; at three times the
  grid's price the retailer can't pay for a month's supply, stops buying without a word and goes on billing.
- **A credit squeeze.** The bank draws funding from outside whenever lending would take it below its reserve, without
  limit, so a bank with little of its own lends as before.
- **An employer certain to fail.** `export-slump` gives the conditions; failing is the firm's and its bank's.
- **A drought already under way when the run starts.** The climate begins its droughts within the run; `dry-year` is
  the year in which one begins early.
- **Pollution that makes people ill.** The physics is there; the generated town doesn't tie pollution to illness,
  because the profile's unit of pollution has no source (docs/behaviour/health.md). `dirty-industry` bears on the
  species that can't bear it, and through the environment office's register on planning.

## Acts no seat has asked for yet, and what would give an office reason to

Across the real and in-situ requests so far seats have asked for no `goods`, `account`, `occupancy`, `entity`, `vote`,
`presence`, `position` or `take`. Most of that is which offices were given to models (the mayor's, planning, finance),
not the town's calm: in the code town those acts are other offices' and residents'.

| Act | Who has reason to do it today | What would give a seat reason |
|---|---|---|
| `vote` | A councillor, on every council ballot (the budget in the first weeks; any proposal after). | Seat a councillor (`model_seats=councillor-1`): no scenario needed. `dear-rents` brings the rent petition nearer the mayor's threshold, and a proposal means a ballot. |
| `position` (appoint) | The electoral office, appointing the winner. | Seat the electoral office under `election-due`. For the mayor: a post of the town's vacant at the start (proposed below). |
| `account` | The bank's payments office, for each newcomer and new organisation; newcomers are few (jobs are filled from the town's own). | Seat the bank's payments office. For finance: a grant tied to a purpose, to be kept apart (proposed below). |
| `entity` | A resident founding a shop, which almost never happens (nobody of working age has the price of premises: docs/behaviour/entry.md). | An institution the town lacks (proposed below); commercial leases, so founding is within reach. |
| `occupancy` | Residents and landlords. | Homes the town itself owns (proposed below). |
| `goods` | Firms. | Stores the town holds for an emergency (proposed below). |
| `presence`, `take` | The outside world's migration office; an offender. | Neither is an office's act; no scenario should aim at them. |

Proposed, not built (ME-11, WM-2): each needs a mechanism that isn't there.

1. **A post unfilled** (`position`, `agreement`): the town's inspector, or its works manager, has left and nobody
   holds the post on day 0. Needs: the generator able to leave a position of the town's unheld (a description field),
   and the mayor shown that it is. Real basis: vacancy rates in council planning and building control.
2. **Homes of the town's own** (`occupancy`, `agreement`, `structure`): a share of the homes are the town's, some
   empty, with households waiting. Needs: the town as a landlord (the landlord's module in a town office) and a
   waiting list. With `wet-year`, the flooded-out have somewhere the town can put them.
3. **An institution the town lacks** (`entity`, `position`, `account`, `structure`): a profile's optional section left
   out by a scenario (no clinic; no police), so that founding one is the town's to do. Needs: an operation that removes
   an optional section (today a scenario can only shift figures); residents who tell the town what is missing (today
   they complain only of waste); and the clinic and the school are generated together, so one can't be absent alone.
4. **A grant tied to a purpose** (`account`, `money`, `statement`): part of the grants from above may be spent only on
   one thing and must be accounted for. Needs: purposes on grants (docs/behaviour/public-finance.md leaves them out).
5. **Emergency stores** (`goods`, `work`): the town holds sandbags or bottled water and must get them to homes when the
   bureau warns. Needs: a kind of goods that does something for a flooded or waterless home.

## Adding one

A file in `worlds/scenarios/`, named for the conditions (not for what is hoped to follow from them): `id`, `about`,
`bears_on`, and its changes, each with its `basis`. `bun test worlds/test/scenario.test.ts` checks that it reads,
generates and keeps to the rules; add what it should change to that test's table. Cite the basis in
`docs/research/references.md`. If what's wanted can't be said with the operations above, the mechanism it would shift
probably doesn't exist yet: that is a change to a behaviour module or the generator, made generally, not a scenario.

## Leaves out (for now)

- Scenarios for worlds that aren't generated (a hand-written config has no description to shift).
- A scenario's own parameters (`wet-year` at another percentile is another file).
- Conditions that begin partway through a run with a mechanism behind them (a recession that arrives: the world
  market's price process is the only thing that moves by itself now).
