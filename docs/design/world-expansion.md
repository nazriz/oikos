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

### 2.4 The contract, exactly (signed 2026-10-01)

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
    dispersal_bps_per_year: 1000                 # the share of adults that leave a year (the young always do)
    dispersal_range: 3                           # cells it can cross of ground it can't live on
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
  - `flows: [{ from, to }]`, the river's course;
  - `nature_spin_up_days`: nature stepped alone this long before the start, so it begins in its own balance.

**Physics** (the kernel, daily; keyed randomness per species and day; docs/behaviour/nature.md has the detail):

1. Unbuilt covers succeed after their days; a demolished building's cells become `cleared_cover`.
2. Fields: sources, then decay, then diffusion, then flow; bounded.
3. Populations:
   - background and tolerance deaths;
   - births replacing background deaths plus logistic growth, against the home range's crowding (the others in it
     against its covers' capacity), none where too few are there to breed;
   - crowding deaths past capacity;
   - the young of a species with a home range leave it (natal dispersal), and a share of adults move each year:
     a correlated walk through ground they can't live on, settling by the ground's quality out of the range they left,
     within their range, or dying; a barrier kills; the world's edge turns them back;
   - none survive in a cell whose cover gives no capacity.

   Fractions are rounded by draws (stochastic rounding). On uniform habitat each species settles near its capacity.
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

*Built 2026-10-01: docs/behaviour/elections.md and news.md, citizen.md "Elections". As built: the roll is from enrolments (not the directory); the code mayor stands as the incumbent; the paper has no business yet (unpaid editor); word of mouth carries no politics yet.*

**No contract changes.** Votes are records the kernel only keeps. Who may vote, and what wins, is for whoever counts:
- a secret ballot is a vote visible only to the electoral office;
- a preferential vote is a ranking in the choice (`c0012-self>mayor-system>c0400-self`);
- the winner is appointed to the position, as organisations fill their own positions;
- news is statements carrying assertions.

### 3.1 The electoral office (`city.electoral_office`, a position of the town's)

- **The charter says when** (a record the generator writes from the profile): the offices elected (the mayor), the
  term (Victoria's councils: four years), the method (preferential), and whether voting is compulsory (it is).
- **The cycle:**
  1. **Notice:** it opens nominations, 60 days before polling day (a statement).
  2. **Nominations:** a candidate nominates by a statement (`nomination`), for the office, with a platform: an
     assertion of what they'll do, and the values it speaks to. The incumbent nominates by default.
  3. **The roll:** the adults resident in the town, from its directory, published when nominations close.
  4. **The ballot:** a statement listing the candidates, open for two weeks.
  5. **Votes:** each a ranking, visible to the office only.
  6. **The count:** valid votes from people on the roll, by instant runoff. The result is published, and the winner
     appointed to the office.
- **A candidate is a participant:** the AI mayor's seat (code or model), or a citizen's. A citizen who wins holds the
  position and runs its role module, as the position says. An AI that loses is out of office, which is the
  accountability the research is about.

### 3.2 The local newspaper (`firm.newspaper`, a firm with an editor's position)

- **It reads the public record:** budgets, laws, ballot results, petitions and their counts, the environment office's
  reports, permit decisions, complaints counts, tribunal rulings (later).
- **Weekly, it publishes the most newsworthy items**, each a statement with an assertion, saying whom it's about
  (`about`) and whether it reflects well or badly on them (`data.tone`: −1, 0, +1).
  - Newsworthiness: novelty, conflict (a refusal, a decline, a petition), and size. Placeholder weights.
  - Its leaning (a parameter, −1 to +1 toward the incumbent) tips which items it runs, and their tone where it's a
    matter of judgement. The facts it states are the records'; the paper doesn't invent.
- Its business: a cover price and subscriptions, or free (a placeholder). Later, a model can run the editor's desk.

### 3.3 Citizens: reading, judging, voting (the citizen's mind)

- **Reading the paper:** a share of people read it each week (the profile's: a survey of local news consumption).
  What's read about an office holder moves their **approval** of them, an attitude kept per office holder (−10,000 to
  10,000). It fades toward neutral over months.
- **What else moves approval:** their own fortunes over the term (retrospective, economic voting: Fiorina 1981;
  Lewis-Beck and Stegmaier 2000); anger at the town (an uncollected bin, a refused complaint); and word of mouth (what
  friends say of the mayor, now part of catching up).
- **Standing for office:** each nomination period, adults with the time and the drive (achievement and power among
  their values, swayed by dissatisfaction with the incumbent) stand with a small chance (the profile's). Their
  platform speaks to their own top values.
- **Voting:** compulsory, so nearly everyone votes; the profile gives the turnout. A citizen ranks the candidates:
  - the incumbent by approval;
  - a challenger by how well their platform's values match the voter's own, and by what the voter has heard of them
    (word of mouth);
  - each weighed by the voter's temperament (the conformist leans to whom friends favour).
  - The ranking is a choice, recorded as a decision (training data).

**Done when:** a mayor is voted out in some seeds, for reasons the logs show (approval falling with the news and with
people's fortunes), and kept in others.

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

*Built 2026-10-01: docs/behaviour/health.md and education.md, citizen.md. As built: the clinic is paid by a grant (not per consultation: routine visits aren't modelled, so fees would be almost nothing); care shortens conditions but can't yet save lives (fatality by age is proposed); pollution's effect on illness is in the physics but not in the generated town (no sourced figure).*

### 4.1 Who runs them (the real world, by profile)

In Victoria neither is the council's: state schools are the state's (the Department of Education employs the
teachers), and general practice is private, mostly bulk-billed to Medicare (the Commonwealth pays per consultation).
So in the au-vic profile the clinic is a practice (a firm) paid per consultation from outside (the boundary, as
support payments are), and the school is the state's (its teachers paid from outside). A profile can instead put them
on the town's budget (where municipalities run schools); the generator reads who runs each from the profile. The
council's own part in Victoria is maternal and child health and kindergartens: later, if a study needs them.

### 4.2 The contract, exactly (signed 2026-10-01: Naz, "yes signed off, include skill at work")

| Where | Change |
|---|---|
| **Catalogue** | `body_variables`: `[{id, min, max, initial, per_day?}]`, named integers on every body (e.g. `skill`, 0 to 10,000), as structures' `variables`. `per_day` drifts it (forgetting, if a world wants it). |
| **World config** | A person entity may give its body's starting `variables` (the generator draws adults' `skill` from the profile's attainment). The `arrive` block may too (a newcomer's). Born here: `initial`. |
| **Tasks** | `on_body` (optional): what a unit does to a body worked on.<br>• `changes: {variable: per_unit}`: adds to body variables, within their bounds;<br>• `treats: [{kind, severity?, units, days_kept_bps, fatal_kept_bps}]`: once a work act gives a condition of that kind (and band) at least `units`, its remaining days are cut to `days_kept_bps` of them, and if a death is due from it, it's called off with the chance 1 − `fatal_kept_bps`. A condition is treated once (`treated`); more care does nothing more. |
| **The `work` block** | `on` may name a **person** (their body must be in a space of the structure at `at`) or a **space** of it (every body in that space: a class). `on_body` applies to each. A structure, as now, otherwise. |
| **Skill at work** (signed: included) | A task's `labour_by`: `{variable, at_max_bps}`: its labour per unit scales with the performers' mean of that body variable, from 100% at 0 to `at_max_bps` at the maximum. The physical reason employers pay for skill (Mincer 1974). Without it, a school certificate is a pure signal (Spence 1973). |
| **Life physics** | `illness.fields`: `[{field, bps_per_unit}]`: the yearly illness chance rises by that much per unit of the field in the cell where the body is (its structure's corner cell), drawn by thinning, as places' injury risk is now. |
| **State** | A condition keeps when its death is due (`death_at`, hidden from views) and whether it's been `treated`. A death due from a condition happens only if the condition still says so. |
| **Log** | `condition_treated {person, condition, by, until, death_called_off}`: the truth, for measurement. Nobody in the world is told a death was called off. `body_changed {person, variable, value}` when work changes one (batched per work act). |
| **Observation** | One's own body: its `variables`, and `treated` on its conditions. Never `death_at`. Others' bodies: nothing new (a school learns a pupil's skill only by testing: a task, later, or the records it keeps). |
| **Refusals** | `not_there` (the person isn't at the structure; exists), `no_body_effect` (the task has no `on_body` but `on` names a person or space). |

Everything else is records and people: enrolment at a school, a doctor's appointment, a waiting list (the clinic's
staff hours), a certificate (a statement a school makes), a posting asking for one, Medicare's payment per
consultation (a payment from outside on the practice's claim).

## 5. Justice (tier 1)

*Built 2026-10-01 (no contract change): docs/behaviour/justice.md. As built: rent-increase disputes and debts, with enforcement by garnishee order through the bank; possession orders and the bailiff wait for tenants who stay on past a notice (behaviour to source); the bargaining tribunal isn't built.*

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

### 6.4 The contract, exactly (signed 2026-10-01: Naz, "yes to both, signed off")

**Water and energy (6.1):**

| Where | Change |
|---|---|
| **Tasks** | `draws` (optional): `{field, per_unit}`: a unit takes that much of a field from the cell (of the structure's, or the four around them) that has the most of it. It's refused (`field_exhausted`) if there isn't enough there. The water works draws `water` from the river this way, and `produces` a `water` resource. |
| **Tasks** | `emits` (optional): `{field_or_counter: per_unit}`: a unit adds to a field at the structure's corner cell (pollution from a generator), or to a world counter. |
| **Catalogue** | `counters`: `[{id}]`: world totals the kernel keeps and censuses monthly (`counter_census`), with no effect on anything (greenhouse gas: it matters, but not here). |
| **State, log** | Counters' values, and the census event. |

Everything else is records and existing physics:
- metering is a structure variable `per_occupant_per_day` (it exists);
- bills, supply contracts and disconnection notices are records;
- the grid and the gas network are the boundary selling `energy` (world.trade);
- drought is the boundary's inflow (the river's source) falling.

**Roads and commuting (6.3):**

| Where | Change |
|---|---|
| **Bodies are in one place at a time** | Occupying a space in another structure moves the body there: out of every space it was in elsewhere (it still holds a lease, a job; that's the record). Today a body can be at home and at work at once, which is why nobody is ever home. |
| **Travel takes time** | Catalogue `travel: {seconds_per_cell, by_cover: {cover: seconds_per_cell}}` (roads quicker). Moving from one structure to another takes the time of the quickest path over the cells between, by cover. The act is under way that long (acts take time already), and arrives then. From outside the world, or into a first space, no travel. |
| **Roads** | A cover (`road`) and a structure type the town builds on its lots. Wear on it as now. |
| **Observation** | Where one is: the space (or none: in transit). |

Behaviour (TypeScript): the daily round, which is citizens going to work on working days and home after; employers
seeing who's in. Each module that reads who's where is reviewed (deaths seen at home, the waste per occupant, a
shop's staff present, a school's pupils).

**Note on cost:** a body in one place at a time changes what every module sees. It's the biggest change since the
rebuild. I'd do it on its own branch, with the invariance and reliability tests as the gate.

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
| 3 | None, as built: a ballot's electorate is in its data, read by whoever counts. |
| 4 | §4.2: body variables; tasks' `on_body` (changes, treats) on a person or a space; optional skill at work; illness reading fields; treated conditions; two log events; one's own body variables in view. |
| 5 | None: applications, rulings and orders are records. |
| 6 | §6.4: tasks' `draws` (from a field) and `emits` (to a field or a counter); world `counters`. |
| 7 | None beyond records (sales and mortgages exist). |
| 8 | §6.4: a body in one place at a time; travel time by cover on moving between structures; where one is in the observation. |
| 9 | Structure types' flood threshold; the kernel displaces occupants. |
| 10 | Block: `take` (goods from a holding where one is, without consent); the bank's instruction check may be fooled (a forged instruction). |
