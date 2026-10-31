# The daily round: one place at a time, and travel (world-expansion §6.3)

**Source:** the kernel (`kernel/crates/world/src/travel.rs`; `exec.rs`, occupy; `kernel.rs`, an act's time); citizens
(`citizen.ts`: where they belong); employers (each module's `look_at`). Contract: world-expansion §6.4 (signed
2026-10-01). Figures: the profile's `round`, with sources.

## The physics (kernel)

- **A body is in one place at a time.** Occupying a space takes the body out of every other space it was in: it's
  recorded as leaving them (`vacated`, left). A world's config may put each body in one space only. Before, a worker
  was at home and at work at once, and never came home.
- **Going somewhere takes the trip.** An act that moves a body (`occupy`) from one structure to another takes, on top
  of the act itself, the time of the quickest trip (docs/design/travel.md): on foot over the cells (Dijkstra, within
  eight cells around the two ends; each cell costs what its cover says, `travel.by_cover`, else
  `travel.seconds_per_cell`), or on foot to the nearest road, along the roads (driven at the lower of the vehicle's
  speed and the road's, or walked), and on foot from the road to the door, whichever is quicker (law 9,
  foundations-2 S2). The body arrives when the act is done: until then it's where it was. From nowhere (arriving,
  newborn) there's no trip.
- **Vehicles.** A vehicle is driven by its owner or someone its owner lets, from where it stands, and stands where it
  was driven to.
- **Where a body is** is in its own view (`body.in`).

## Citizens (citizen 0.30.0)

At each wake a citizen works out where they belong now, and goes there if they're not:

| When | Where |
|---|---|
| Waiting at the clinic | The waiting room |
| At a gathering, while it lasts | There |
| A child of school age with a place, in school hours on a school day | Their classroom |
| An adult with a job, in working hours on a working day, not too ill, not on strike | The workplace |
| Otherwise | Home (the home they hold; else the household's; else the home they were last in) |

They wake when where they belong next changes: work and school starting or ending. Such a wake only takes them where
they belong; the full plan (shopping, hunting, petitions, the mind's choices) runs weekly, on news, and at a
gathering's time, as before. Taking a job, coming back from a strike, and going back after being ill: the round takes
them to work at its hour, not at once.

## Employers

Employers whose staff work in a place (factories, shops, the builder, the works crew, the environment office) look at
the day's work an hour after it starts (`look_at`), on working days: their staff are in. The clinic opens half an hour
after the working day starts; the school's lessons begin half an hour after school does.

## Roads

A road is a building type that is a way (law 9, foundations-2 S2: `way`, mode `road`, the profile's
`round.roads.speed_kmh` and `capacity_per_hour`); its ground is the cover `road`, for nature. The generator lays
streets across the town every 6 rows and 8 columns, before anything else is built; the town owns them. On foot, a cell
takes about 18 seconds, on a road as off it; driven along a road at 45 km/h (30 in some places), about 2. So whoever has
a car at hand drives to the nearest street and along it, and whoever has none walks.

## Vehicles (foundations-2 S2)

Of the households housed at the start, the profile's share has a vehicle (`round.vehicles.households`: a car, or in
some places a motorcycle; at most one a household), owned by the leaseholder or owner, standing at home, and the
household's other adults may drive it. A citizen going where they belong takes a vehicle of theirs that stands where
they are; if the world says it was not there to take (another of the household took it first), they walk.

- **Wear:** roads wear out over their life like the parks and the hall, and the works crew keeps them up.
- **The town builds roads** (city.mayor_code 0.8.0): within a roads budget (about $300 a resident a year), a road
  toward any building standing more than 3 cells from one, a road at a time, permit first (government.md). A road costs
  about $33,000 at the builder's prices (25 m of local road: placeholder).
- **Nature:** a road is a barrier to whatever building is one to.

## The profile

Working hours 9 to 5, Monday to Friday, for everyone (shops included: a liberty; they'd roster Saturday staff). School
9 to 3. Walking about 1.4 m/s; driving at 45 km/h on roads; slower across water, wetland and bush.

## In the small town (90 days, against the round's absence)

- **Work:** about the same. Goods made 66,000 against 62,000; served 8,900 against 8,700; waste collected 2,250 against
  2,230.
- **Wakes:** 74,000 against 20,000, most of them commutes (asked-for wakes), and the run takes 16 seconds against 9.
- **Waste:** complaints went up, from 4 to 25. People are home in the evenings now and see the waste. That's emergent,
  not tuned.

## Found by running it

- **Children taken out of town kept going to school.** Their bodies were gone but their modules carried on. A body no
  longer in the world now does nothing more.
- **The school's roll was whoever was in a classroom,** so every afternoon, with the pupils gone home, it would have
  certified them all. The roll is now the places it has given (the world's pupils have places too).

## Leaves out (for now)

- Traffic, congestion, fuel, public transport, parking. Worn roads aren't slower. A household has one vehicle at most, and it is bought by nobody: the ones the town opens with are all there are.
- Rosters: everyone works the same hours, five days.
- **Being in transit:** a body is where it was until it arrives.
- Nights out, errands, visiting: people are at work, school, the clinic, a gathering, or home.
