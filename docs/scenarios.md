# Scenarios: named starting conditions

**Source:** `worlds/generator/scenario.ts` (how one is applied), `worlds/generator/weather.ts` (`chooseWeather`),
`worlds/scenarios/<id>.yaml` (the scenarios). Tests: `worlds/test/scenario.test.ts` (quick),
`orchestrator/test/scenarios.test.ts` (each one run for sixty days at 1,000 people).

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
oikos scenarios                    # the scenarios there are, and what each shifts
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

Two more things a scenario may say:

- **`season.starts_in`**: `wet_half`, `dry_half` (the month from which the next six bring the river most or least, by
  the profile's `rain_by_month_bps`) or `hot_months` (the first of its `summer_months`). It sets the month the run
  starts in, so a half-year run holds the season that matters, in whichever hemisphere the profile is.
- **`weather`**: `rank_by`, `percentile`, `draws`, `over_days`. `draws` years are drawn from the profile's climate,
  each from a seeded stream of its own (`weather-1`, `weather-2`, ...); each is measured over the run's first
  `over_days` days (`wettest_spell`: the most the river is sent in five days running; `inflow`: what it is sent in
  all; `heatwave_days`); the one at `percentile` is the run's. The bureau warns of what that year holds, as of any
  year's. The climate is untouched, so how rare the year is means what it says.

Everything is fixed by the description's seed: the same description and scenarios give the same town.

## Together

Scenarios named together are applied in the order named. Multiples multiply. Two that set the same thing to different
values, or that each choose the season or the weather (`wet-year+dry-year`), don't go together, and generation says
which. Otherwise any go together: `wet-year+lean-council` is a wet year for a town with little in the bank.

## The scenarios

Sizes are relative to the profile, so the last column's figures are what they come to in the first profile's 1,000-person
town (seed 1), for illustration only.

| Scenario | What it shifts | Basis for the size | Offices it bears on | In the first profile's town |
|---|---|---|---|---|
| `baseline` | Nothing. | | | |
| `wet-year` | Starts at the wet half-year; the weather is the climate's year at the 99th percentile of 199 by its wettest five days. | The 1%-a-year flood is the one planned against (Ball et al. 2019; the United States' base flood). | mayor, works, planning, environment, water | A four-day spell of heavy rain in the river's highest month, about day 110; fifteen buildings flooded from day 114. |
| `dry-year` | Starts at the dry half-year; the climate's year at the 1st percentile of 199 by what the river is sent in the first 180 days. | Water suppliers plan against droughts of one year in a hundred to five hundred (to confirm). | water, mayor, environment | A drought beginning about day 110 (seed 1; days 48 and 90 for seeds 2 and 3), lasting past the year. In 180 days it brought no water restrictions: the river still gave the town what it draws. |
| `hot-summer` | Starts with the first hot month; the climate's summer at the 95th percentile of 199 by heatwave days. | A one-in-twenty season (to confirm). | clinic, mayor | About fifteen heatwave days in the first ninety, against five in a middling summer. |
| `election-due` | Polling day is day 60. | Not a size: when a term ends. Sixty days is the electoral office's own notice. | mayor, electoral office, paper, council | Notice on day 0, nominations close day 30, voting from day 46. |
| `lean-council` | The town's opening balance a tenth of the profile's; grants from above halved. | Balance: placeholder (the profile's own is one). Grants: English councils' funding fell by half, 2010 to 2018 (National Audit Office 2018; to confirm). | finance, mayor, rates, works | About two months' revenue in the bank where the profile gives nearly two years'. |
| `export-slump` | The world market takes 12% less of the factories' goods from day 0; each factory starts with a quarter of the profile's balance. | World trade volume fell 12% in 2009 (World Trade Organization; to confirm). Balance: placeholder. | mayor, finance, union, bank, factories | |
| `jobs-slump` | Twice the share out of work at the start. | Unemployment doubled in the United States, 2007 to 2009 (Bureau of Labor Statistics; to confirm). | mayor, finance, support payments, union | 10% out of work, not 5%; shops open with fewer staff. |
| `ageing-town` | Half as many again in every age band from 65. | Japan's share of people 65 and over against the OECD's (to confirm). | clinic, registry, support payments, finance | About 30% aged 65 or more, not 22%. |
| `housing-shortage` | A tenth fewer houses and apartment blocks. | Estimated shortfalls of about a tenth of the stock (Centre for Cities 2023; to confirm). | planning, mayor, inspector, landlords, builder | 348 homes for about 430 households, not 380. |
| `dirty-industry` | Each factory's pollution two and a half times the profile's. | United States manufacturing's emissions fell 60% for more output, 1990 to 2008 (Shapiro and Walker 2018; to confirm). | environment, planning, mayor | |
| `doctor-shortage` | Half the doctors for the town's size. | Rural places have half the doctors a head of cities or fewer (to confirm). | clinic, mayor | One doctor, not two. |
| `police-understrength` | 14% fewer officers for the town's size. | Officer numbers in England and Wales, 2010 to 2017 (Home Office; to confirm). | police, tribunal | Two officers, not three. |
| `energy-price-shock` | The grid's price to the retailer doubled from day 0. | Wholesale electricity prices in 2021-22 (International Energy Agency; to confirm). | energy retailer, mayor | |

What sixty days and longer of each showed is in the decisions log (2026-10-08, "Scenarios").

## What has no honest scenario yet

- **A flood on a given day, or a flood for certain.** The weather can be made a wet year; the flood is the river's.
- **A crime wave.** Offending here follows need and opportunity, at a chance the profile calls a placeholder and keeps
  deliberately rare (docs/behaviour/crime.md): a town in a slump has almost no more of it. Raising that chance would
  be setting the outcome with no source for the size. What a scenario can honestly move is the police's strength
  (`police-understrength`) and how many are in need (`jobs-slump`); they can be named together.
- **A council in deficit from the first day.** An account can't open below nothing, and the town has no debts at the
  start to give it. `lean-council` is a town with almost no reserves, which has to live on what comes in.
- **An employer certain to fail.** `export-slump` gives the conditions; failing is the firm's and its bank's.
- **A drought already under way when the run starts.** The climate begins its droughts within the run; `dry-year` is
  the year in which one begins early.
- **Pollution that makes people ill.** The physics is there; the generated town doesn't tie pollution to illness,
  because the profile's unit of pollution has no source (docs/behaviour/health.md). `dirty-industry` bears on the
  species that can't bear it, and through the environment office's register on planning.

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
