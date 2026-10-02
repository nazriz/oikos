# Weather (`world.weather` v0.1.0, and the generator's climate)

**Source:** `worlds/generator/weather.ts` (drawn for a run), `participants/src/behaviour/world.ts` (the bureau).
Design: docs/design/world-expansion.md §7.3. Figures: the profile's `climate`, with sources. No contract change: the
weather is fields' sources by day (`source_by_day`, signed in §7.3) and illness by field (`illness.fields`).

## The weather of a run

The generator draws the run's weather from the profile's climate with its seeded randomness, before the run, like the
town itself. Nothing in the world can change it. A spec's own `weather` (the river's inflow by day) replaces the rain;
`climate: false` gives the usual every day.

| | Rule | Source |
|---|---|---|
| **The season** | The river's inflow by calendar month: lowest in late summer, highest in winter and spring. The run starts in `start_month` (January). | BoM climate statistics (shape a placeholder) |
| **Heavy rain** | About one month in twelve: two to four days at 2.5 times the inflow. Enough rain floods the town beside the river (floods.md). | Placeholder, to calibrate against flood frequency |
| **Drought** | About one year in twelve begins one: six to eighteen months at 40% of the inflow. The water corporation's restrictions follow when the river can't give the town its water (utilities.md). | Placeholder |
| **Heatwaves** | About one summer week in eight: three to five days. A `heat` field lies on every cell on those days (10 units; 12 on built ground and roads, the urban heat island), gone the next. | BoM heatwave service (placeholder) |
| **Heat and illness** | Each unit of heat where a body is adds 1% a year to its chance of falling ill: a heatwave about doubles an adult's illness for its days. The elderly die of it more, as of any illness (fatality by age). | January 2009 Victorian heatwave (DHS 2009, to confirm) |

## The weather bureau (`world.weather`)

The outside world's (a state's or nation's). It warns publicly `lead_days` (2) ahead of each heavy-rain spell, drought
and heatwave, saying when it's expected to end (`weather_warning`). The mayor's office sees the warnings. Nobody in the
town acts on them yet: what a steward does with a warning is the point.

## In the small town (two years)

Seven warnings: five heatwaves and two heavy-rain spells; no flood (the spells weren't enough), no drought. In a town of
200 a heatwave makes about one extra person ill: too few to see, and real at this scale. A test makes a heatwave hot
enough to see it.

## Leaves out (for now)

- **Responses to warnings:** cooling centres, checking on the elderly, sandbagging, water restrictions ahead of a
  drought. They're people's and institutions' choices, to add as behaviour.
- **Energy and water use** that rise in the heat: use is a fixed rate (utilities.md).
- **Wind and storm damage** to buildings; bushfire (a cover burning: a kernel mechanism, later); frost and crops.
- **Climate change:** the climate is fixed for a run. A changing one is a profile per period, or a trend in the draw.
