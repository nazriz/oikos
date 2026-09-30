# World expansion: nature, accountability, services, justice, and what they need

**Status:** proposed 2026-10-01. Naz approved the scope, the order and building "into Rust where you can". The contract
changes (§9) need sign-off before each part is built. Scope: all three tiers from the 2026-10-01 checkpoint.

## 0. Principles (unchanged, restated because each part leans on them)

- **Physics in the kernel, in Rust, generic and unit-free.** It has no species names, place figures or rules of
  conduct. A world's config gives the vocabulary and parameters, a profile gives the place's figures with sources, and
  the generator writes them.
- **Institutions are seats running modules.** A court, a clinic, a school, an electoral office and a newspaper are
  positions whose holders act through the participant API, as the council clerk and the bank do. Modules stay in
  TypeScript: they're what a model seat replaces, and the rebuild kept them there (docs/decisions.md, "What stays in
  TypeScript"). Everything they rest on (fields, populations, measurement, bodies, travel) is Rust.
- **Nobody sees the truth for free.** A population's true size is the kernel's. People know it from a survey someone
  did (work that takes time and has sampling error), a newspaper report, or what they see around them. This is what
  makes a steward's knowledge a research variable.
- **Proportional fidelity (D25).** Each part says how faithful it is, and what it leaves out.
- **Irreversibility is physics.** An extinct species can't return. Mature habitat regrows over decades, not days.

## 1. The contract revision (signed 2026-10-01, built first)

1. **Periodic tenancies.** An agreement's terms may say `then: "periodic"`: once the term ends, the agreement stays in
   force until someone gives notice under its termination clauses. `terms` (Rust) reads it; the landlord renews as a
   choice, not a workaround.
2. **Ratified as they are:** `log.detail`, the run dataset format, `notices` on the observation, and
   `framing.debrief_text`.
3. **Things put forward to be believed:** already in 0.7 as `assertion` (`claim` is a legal position here). Beliefs
   now attach to it, not to the statement kind `teaching`, so news, promises and rumours can be believed too.
4. **Belief strengths in decisions:** already in 0.7 as the decision's mind `state`; now filled in (needs,
   satisfaction, certainty, the strongest feeling, beliefs, goal).
5. **A `consult` purpose:** already in 0.7, and used.
6. B13 (compact logs) and B1 (generated types) stay deferred. Construction payments are folded into §6.1 (materials
   from suppliers).

## 2. Nature (tier 1)

### 2.1 Physics (kernel, Rust: a new crate `terrarium-nature`, stepped by `world`)

- **Land cover.** Each cell's `terrain` (already in the state) is its cover when unbuilt: a kind from the catalogue's
  `land_covers`. A structure covers its cells, and its type may declare a `cover` of its own (a park is grassland; a
  wetland reserve is wetland). Covers may `succeed` to another kind after N unbuilt days (cleared land to scrub to
  woodland), so mature habitat is slow to come back.
- **Fields.** Named integer quantities on cells, from the catalogue's `fields`: pollution, water level, soil. Each day:
  - a source per structure type or per structure variable (a factory's emissions per unit made), and per cover;
  - decay toward a baseline;
  - diffusion to neighbours (a rate in basis points);
  - flow along a direction layer (a river carries pollution downstream).

  All integer arithmetic, deterministic, and bounded. The river is terrain `water` plus a `flow` layer the generator
  draws.
- **Populations.** Species from the catalogue's `species`. Each has, per cell:
  - an integer count;
  - discrete logistic growth (Verhulst), toward a carrying capacity set by the cover (per-cover capacities) and
    reduced by fields (a pollution tolerance);
  - dispersal to neighbouring cells with room, drawn from the kernel's keyed randomness (stochastic, so small
    populations can blink out);
  - a minimum viable count below which a cell's population fails;
  - habitat that a species crosses badly (`barrier` covers), so fragmentation matters (metapopulations: Levins 1969;
    Hanski 1998).

  A species whose total reaches zero is **extinct**: the kernel records it and refuses anything that would add it back
  (the Stage 4 irreversibility).
- **Measurement is work.** A new task kind `survey` (a unit covers a cell, for a named species or field) produces a
  record of an **estimate**. It's the true value with sampling error (a detection probability and a count error from
  the catalogue), drawn from the kernel's randomness. Only the surveyor, and those it tells, know it.
- **What people see without surveying.** The `street` view adds a cell's cover and, for species marked `conspicuous`,
  whether any are seen, never counts.

### 2.2 Institutions and rules (modules and world content, TypeScript)

- **An environment officer** (the town's, a position) surveys on a schedule its budget pays for, and publishes a
  state-of-environment report. It flags declines and advises on permits (docs/behaviour/environment.md).
- **Laws are records, as now:** a protected area where building isn't permitted (the river law, generalised); a
  threatened-species list (a statement) that planning checks; an emissions limit the town can fine against.
- **Planning** reads the officer's advice and the laws; the mayor can overrule and so answers for it. A developer
  (the Stage 4 AI seat) weighs it against profit.

### 2.3 The place (profile, with sources)

The town sits inside a larger detailed area (for the 1,000-person town, 80×60 cells, the town about a quarter of it)
of river, wetland, grassland, woodland and farmland. Covers and species are the profile's: a Victorian set would take
species listed under the state's Flora and Fauna Guarantee Act, with densities and growth rates from their action
statements (to source). Proportional fidelity: a few species, chosen for what they're sensitive to (a wetland frog to
water quality, a woodland glider to fragmentation, a common grassland bird as a control), not an ecosystem.

### 2.4 The contract, exactly (for sign-off; built on the `nature` branch, not merged)

**Catalogue** (world config), all optional: a world without them has no nature, as now.

```yaml
land_covers:                      # what ground is; a cell's `terrain` names one
  - id: woodland
  - id: cleared                   # what's left when a building comes down
    succeeds_to: { cover: scrub, after_days: 1825 }
  - id: scrub
    succeeds_to: { cover: woodland, after_days: 7300 }
  - id: water
default_cover: grassland          # unlabelled, unbuilt ground (absent: the reserved `open`)
cleared_cover: cleared
fields:                           # integer quantities on cells
  - id: pollution
    min: 0
    max: 1000000
    baseline: 0
    decay_bps_per_day: 200        # toward the baseline
    diffusion_bps_per_day: 500    # of what's above it, to the four neighbours
    flow_bps_per_day: 5000        # of what's above it, downstream along the flow layer
    from_structures: { factory-works: 50 }   # per building of the type (at its corner cell), per day
    from_covers: { farmland: 1 }
species:
  - id: glider
    capacity_per_1000_cells: { woodland: 125 }   # a fraction of one per cell, for sparse animals
    home_range: 3                                # crowding is felt over a square this far each way
    growth_bps_per_year: 3000                    # r (logistic)
    mortality_bps_per_year: 2000                 # background deaths (births replace them at capacity)
    dispersal_bps_per_year: 5000                 # the share that leaves for a neighbouring cell
    barriers: [built]                            # covers it dies crossing
    min_viable: 2                                # fewer in a home range don't breed (an Allee effect)
    tolerance: { pollution: { above: 500, mortality_bps_per_day: 50 } }
    detection_bps: 3000                          # a survey's chance of finding each one
    conspicuous: false                           # whether passers-by notice it
tasks:
  - id: survey
    labour: 3600                  # per cell surveyed
    surveys: true
```

- **Reserved covers:** `built` (a building whose type names no cover) and `open`.
- **Structure types** gain an optional `cover` (a park is `grassland`). In a world with land covers, every terrain
  label must be one.
- **World:**
  - `populations: [{ species, cell, count }]`;
  - `fields: [{ field, cell, value }]`, sparse;
  - `flows: [{ from, to }]`, the river's course.

**Physics** (the kernel, daily; keyed randomness per species and day):

1. Unbuilt covers succeed after their days; a demolished building's cells become `cleared_cover`.
2. Fields: sources, then decay, then diffusion, then flow; bounded.
3. Populations:
   - background and tolerance deaths;
   - births replacing background deaths plus logistic growth, against the home range's crowding (its individuals
     against its covers' capacity);
   - crowding deaths past capacity;
   - dispersal to neighbours, lost crossing a barrier or off the world's edge;
   - none survive in a cell whose cover gives no capacity.

   Fractions are rounded by draws (stochastic rounding). Capacity is nominal: a population settles somewhat below it,
   since each individual feels itself and those near it as crowding (Lloyd's mean crowding).
4. A species at zero everywhere is **extinct**: recorded once, permanent.

**Blocks and outcomes:**
- `work` with a `surveys` task takes `survey: { of, cells }`, one unit per cell, charged as work.
- The outcome's `surveyed` goes to the actor only:
  - for a species, each individual found with `detection_bps`;
  - for a field, the value off by up to 10%.
- Refusal `bad_survey`: no survey for a survey task, one for a task that isn't, an unknown species or field, or cells
  that don't match the units or don't exist.

**Events:**
- `species_extinct`.
- `nature_census` every 30 days: each species' count and cells, and the cells of each cover. For measurement; no
  participant perceives it.

**Observation:** `sites` cells already show their terrain (the cover). They gain `seen`: conspicuous species present,
never a count. A cell's change stamp moves when one comes or goes, or its cover succeeds.

**Why daily, not lazily** like structure variables: diffusion and dispersal couple neighbouring cells, so each day
must be stepped. At 4,800 cells, three fields and three species, that's small next to a day of acts.

## 3. Elections and information (tier 1)

- **Elections** (modules and records; the kernel already has ballots, votes and appointments):
  - The town's charter (a record) sets the offices, their terms and the voting method. The profile's is Victoria's
    council elections: preferential or proportional voting, compulsory for residents.
  - An electoral office runs nominations, the roll (adult residents), the ballot and the count, and appoints the
    winner.
  - Candidates: the incumbent seat (model or code), and code challengers with platforms (statements with assertions).
  - **How citizens vote** (the citizen's mind): retrospective and economic voting (Fiorina 1981; Lewis-Beck and
    Stegmaier 2000). They weigh their own fortunes, the town's that they've heard about, their anger at the town,
    their values against the platforms, and turnout's cost (zero where voting is compulsory).
- **The information environment:**
  - A **local newspaper** (a firm and a position) reads the public records (budgets, laws, ballot results, petitions,
    the environment report, court rulings) and publishes reports. Each is a statement with an `assertion`, chosen by
    newsworthiness and its own leaning (a parameter).
  - Citizens read it, some regularly and some not (a profile rate), and it feeds their beliefs about the town and the
    mayor, with word of mouth as now.
  - Promises and rumours are assertions too, so they can be believed, checked and broken.

## 4. Public services (tier 1)

- **Bodies get variables** (Rust): named integer attributes on a body (health, skill), from the catalogue, like
  structures' variables. They change by the day, by work done on a body (a new `on_body` for tasks), and by the
  kernel's life physics.
- **Health:** a clinic (building type, staff, a position) treats conditions. A `treat` task on a body shortens a
  condition, or lowers its severity, by the catalogue's figures. Untreated serious conditions carry the fatality
  they have now; treated ones less. Waiting lists come from staff hours. Pollution (a field at home) raises illness
  rates (life physics reading a field).
- **Education:** a school (building type, teachers). Children attend (occupancy, as gatherings are); a `teach` task
  raises attendees' `skill`. Employers may prefer, and pay more for, skill (human capital: Mincer 1974), and a
  posting may ask for it.
- **The budget gains real lines:** the clinic's and school's staff and running costs, so the mayor's trade-offs are
  among services, nature and taxes.

## 5. Justice (tier 1)

- **A tribunal** (a position; Victoria's VCAT is the model): it takes applications (tenancy disputes, unpaid wages, a
  breach of a law, a challenge to a decision of the town), hears both sides (records, with time to respond), and
  rules. Orders are records.
- **Enforcement is people:** a registrar and a bailiff (positions) carry out orders: a possession order, a debt
  recovered through the bank, a fine. Institutions and people comply or not with their `compliance_bps`, as now.
- **Tribunal for bargaining** (the one proposed in decisions.md): conciliation, then an intractable bargaining
  declaration and arbitrated terms.

## 6. Tier 2

### 6.1 Water and energy

- **Water:** the river's `water_level` and `pollution` fields. A water works (building and position) draws water (a
  task: water from a river cell into a `water` resource) and treats it. Households use it (consumption, as goods now,
  with a price or rates). Drought is the boundary lowering inflow.
- **Energy:** a power supply bought from the grid (the boundary) or made locally from fuel. Making it emits pollution
  (a field source) and greenhouse gas (a counter the kernel keeps, since it has no local effect but matters).
- **Materials:** builders buy materials from suppliers (the outside, or a local quarry that changes land cover) as
  stock construction consumes. This replaces the construction-payments stopgap.

### 6.2 Home ownership

- Homes for sale (property sales exist for premises; the same for dwellings), mortgages from the bank (credit exists),
  owner-occupiers who pay rates and upkeep, not rent. The profile's tenure split (ABS census: owners outright, with a
  mortgage, renters) sets the start.
- Development pressure becomes personal: owners oppose or favour building near them (petitions, votes).

### 6.3 Roads and commuting

- **Travel takes time** (Rust): moving between spaces costs time by distance, less along road cells (a cover). It
  uses the person's timeline, as acts do now.
- **Roads are structures** the town builds and maintains (wear, as now). Commuting time counts against a job's
  appeal (the mind's appraisal).
- **A daily round:** today a worker occupies their workplace from hire to leaving, and never goes home. So a housemate
  doesn't see a death at home for weeks (found 2026-10-01), and nobody is home at night. With travel time, people go
  to work and come home each working day, and see what's there.
- Proportional fidelity: no traffic or congestion, no vehicles as things, and no public transport at first.

## 7. Tier 3

### 7.1 Hazards

- **Floods:** the boundary sets the river's inflow, and when a cell's `water_level` passes a structure type's
  threshold, the structure takes damage (its wear variable) and its occupants are displaced (the kernel moves bodies
  out, as it does on demolition). Wetland cover holds water (a field sink), so draining it raises flood risk
  downstream.
- **Heat:** later.

### 7.2 Crime and policing

- **The physics of taking** (Rust): a person can take goods from a holding where they are, without the holder's
  consent. Money moves only through banks, so theft of money is fraud: a transfer on a forged instruction, which the
  bank's checks may or may not catch. The kernel records it as it happened; whether anyone notices is perception.
- **Why someone offends** (the citizen's mind): need, opportunity and the chance of being caught (Becker 1968;
  routine activity theory, Cohen and Felson 1979). Deliberately rare, and a parameter.
- **Police** (positions): report taking, investigate (work that can find the taker, with a probability), and charge.
  The tribunal (a magistrates' court's role) decides.
- **Care, given the stakes:** crime is where a simulation most easily encodes prejudice. No offending rate is tied to
  any group, only to circumstances, and the doc says so.

## 8. Order and milestones

| # | Part | Rust | TypeScript | Done when |
|---|---|---|---|---|
| 1 | Contract revision (§1) | `terms` (periodic) | landlord, citizen, belief via `assertion` | Suite passes; soak clean |
| 2 | Nature (§2) | `terrarium-nature`: covers, fields, populations, surveys, extinction | environment officer, planning, generator's landscape | A 5-year run where building on habitat measurably shrinks a species, and a survey sees it |
| 3 | Elections and information (§3) | (none needed) | electoral office, newspaper, voting mind, candidates | A mayor voted out in some seeds, for reasons the logs show |
| 4 | Services (§4) | body variables, `treat` and `teach` on bodies, fields in life physics | clinic, school, budget lines | Treatment shortens illness; schooling raises skill and pay |
| 5 | Justice (§5) | (none needed) | tribunal, registrar, bailiff | A tenancy dispute and a wage claim decided and enforced |
| 6 | Water and energy (§6.1) | fields as sources and sinks, water drawn as a resource | water works, power, materials suppliers | Pollution from making power reaches the river's species |
| 7 | Home ownership (§6.2) | (none needed) | sales, mortgages, owner-occupiers | Tenure split holds near the profile's |
| 8 | Roads and commuting (§6.3) | travel time on the timeline | roads in the budget; the mind's appraisal | Distance changes who takes which job |
| 9 | Hazards (§7.1) | flood physics | warnings, recovery | A flood damages river-side buildings, less with wetland kept |
| 10 | Crime and policing (§7.2) | taking; forged instructions | police, offending in the mind | Rare, circumstance-driven; investigated and tried |

Each part: design details in its own doc under docs/behaviour/, sources in docs/research/references.md, a test that
shows its mechanism, a soak run, and a line in docs/decisions.md.

## 9. Contract changes (for sign-off, part by part)

| Part | Change |
|---|---|
| 2 | Catalogue: `land_covers`, `fields`, `species` (with growth, capacities by cover, tolerances, dispersal, detection); structure types' `cover` and field sources; a `flow` layer on places. State and log: fields and populations on cells; `species_extinct` and `survey_recorded` events. Task: `survey`. Observation: cover in the street view, conspicuous species seen. |
| 3 | Ballots' `electorate` may name a roll (a record) as well as a body of office holders. Nothing else: charters, candidates and news are records. |
| 4 | Catalogue: body `variables`; tasks' `on_body` changes; life physics may read a field at the home cell. Observation: one's own body variables. |
| 5 | None: applications, rulings and orders are records. |
| 6 | Tasks may draw a resource from a cell's field (water); a greenhouse counter. |
| 7 | None beyond records (sales and mortgages exist). |
| 8 | Catalogue: travel cost by cover; the timeline charges travel. |
| 9 | Structure types' flood threshold; the kernel displaces occupants. |
| 10 | Block: `take` (goods from a holding where one is, without consent); the bank's instruction check may be fooled (a forged instruction). |
