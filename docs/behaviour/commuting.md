# Weighing the commute

`citizen.default`, `kernel/crates/actors/src/citizen/commute.rs` (the trip memory and the cost), `work.rs`
(`look_for_work`) and `housing.rs` (`hunt_home`). Risk WM-4; the design is docs/design/commute-choice.md.

## The rule

A job or a home that implies a trip between home and work the person knows carries that trip as a cost a month, in
their own terms, and the mind weighs it as it weighs any money. Nothing refuses a far job or home, and nothing sets how
far anyone goes.

- **What a person knows of a trip (no god's view; law 9).** When they set out (the act that moves them on their daily
  round) they note where from and when, and whether they drive; when they then see themselves on their way
  (`BodyView.on_way`), they keep the trip's seconds (`arrives` less when they set out), by the pair of buildings, either
  way round, the latest kept, at most 16 trips. A trip they arrived from before they looked, or never made, is not
  known, and an option that implies it carries no commute term: never a straight line, never the network's timetable.
  A published timetable, where one exists, is the other way to know it (none exists yet). So a first hire across towns
  can happen; from the first trips the commute counts, in the next job search and in the home search.
- **Time.** The round trip on each working day of the person's round (a year's weeks over its months), valued at the
  place's value of travel time, a share of the hourly pay of the job weighed (in the job search; a month's pay over 160
  hours) or of the job held (in the home search): `round.commute.time_bps`.
- **Money.** Where the trip was driven, the same hours at an hour's driving's running cost (`drive_per_hour`: the
  profile's `round.commute.vehicle_cost_per_km` at its `round.roads.speed_kmh`, since a person knows a trip's time, not
  its length). On foot, nothing.
- **In the job search,** each posting's pay a month less its commute (from the current home to the posting's
  `workplace`); in work, a posting is looked at only if it pays better than ours net of both commutes. **In the home
  search,** each listing's rent plus the commute from it to the job held.

## Why (sources)

People trade pay against commuting: they take longer commutes only for more pay or cheaper housing, and are not fully
compensated (Stutzer and Frey 2008); commuting costs are a source of employers' wage-setting power, workers weighing a
job's pay net of the trip (Manning 2003); job and home moves are a joint search over the commute (van Ommeren, Rietveld
and Nijkamp 1997). Appraisal values commuting time at a share of the traveller's wage (Small 2012; US DOT 2016; UK DfT
TAG A1.3; ATAP PV2). All in docs/research/references.md, all to confirm.

## Figures (profile `round.commute`, each with its source under `sources["round.commute"]`; WM-4)

| Profile | time_bps | vehicle_cost_per_km | Source (all WM-4) |
|---|---|---|---|
| au-vic | 4000 | 20 (cents) | ATAP PV2 (2016): private travel time at 40% of average hourly earnings; vehicle operating costs (to confirm) |
| gb-eng | 5000 | 11 (pence) | DfT TAG data book A1.3.1 (commuting, read as a share, to confirm); A1.3.11-14 fuel and non-fuel costs (to confirm) |
| us-oh | 5000 | 13 (cents) | USDOT revised value of travel time guidance (2016), half of hourly income (to confirm); AAA "Your Driving Costs" (2023) operating cost (to confirm) |
| others | 5000 | own fuel cost a km and 60% | PLACEHOLDER, labelled in each profile |

## Leaves out

- The trip's length: the money is reckoned from the time at the town's road speed, which understates a trip out of town
  on a faster road and overstates one partly on foot.
- What the trip actually burns (S5's fuel from holdings): the running cost is the profile's figure, not the tank.
- Commuting with others in the household: each person's own commute counts in their own job search; the home search
  weighs the leaseholder's.
- A trip learnt from someone else (a workmate's word): not built (WM-4).
