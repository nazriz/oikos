# Foundations 2: the world's physics made whole (plan, 2026-10-25)

**Status:** a design for discussion with the owner. Nothing here is built. Owner's direction (Naz, 2026-10-25, close to
his words): realism gaps must become impossible at the kernel and platform layer, not fixed one at a time,
"eliminating the possibility of whack-a-moles". He agreed the five foundations below; this turns them into laws, tests
and steps, and puts an AI economy on top that is built from them rather than beside them. Section 9 lists every point
that is his to decide.

The model is the fix made twice already: information (`docs/no-god-view.md`, `docs/design/knowing.md`) and work
(`docs/all-work-takes-time.md`, `docs/design/foundations.md`). Each time it was **a rule the contract and the kernel
enforce, so that a world that breaks it cannot be written; one backstop test that should never fire; and an inventory
of the special cases it deletes, which only shrinks.** The first foundations stated laws 1 to 7. This plan adds five,
numbered on from them (laws 8 to 12), so that one list of laws describes the world.

## 0. What the audit found, in one paragraph

The kernel is further along than the risk register suggests, and the remaining gaps are of a few kinds. Money is
conserved by invariant (`kernel/tests/money_conservation.rs`), and so are goods: holdings keyed by holder, place and
kind, changed only by their holder's move, a task's inputs and outputs, or a building's materials, with only an edge
allowed below zero (`kernel/tests/goods.rs`; `exec.rs` `work`, `MoveGoods`). Tasks already have recipes (`consumes`,
`produces`, `draws` from a nature field, `emits` to a field or a world counter: `config.rs` `TaskCfg`). Places are a
tree on one plane, with several edges and 128-bit amounts (`foundation-for-scale.md` 4.1, 4.5, 4.6). Travel time is a
shortest path over cells, priced by cover (`world/src/travel.rs`), and roads, vehicles and bodies in transit have
reserved shapes that nothing uses (`docs/design/travel.md`). Time is charged to people's timelines and systems' lanes
from a table of work (`kernel/crates/time`). **The gaps are where a quantity escapes these mechanisms:** a home's
water use and waste are building *variables* that grow per occupant out of nothing (`generate.ts` 3556, 3562), water
drawn from the river vanishes (`draw_water` has no output), energy is destroyed at the depot (`supply_energy`)
instead of reaching homes, and production uses no energy, water or land. Goods move between any two places at once
(`MoveGoods` has `from_at` and `to_at` and no carrier), a visit is "the time it takes, spent where one set out", and
the outside world supplies anything at a fixed price, in any quantity. A system's act with no template row costs one
second (`DEFAULT_ACT_SECONDS`, `time/src/lib.rs`), which is how the support office decides a claim in two hours
(WM-14). And of the figures that reach a world, 682 of 813 module parameters are marked "placeholder" in their
manifests and about two thirds of profile source notes say PLACEHOLDER or "to confirm", but nothing reports how much
of a run's outcome rests on them, and the profiles' targets are points that a reader compares by hand.

## 1. The laws

"Refuses" means a refusal before the act takes effect, recorded in the log, as every physics refusal is today.

**Law 8. Nothing physical from nothing.** Every physical quantity (water, energy, land, materials, goods, waste,
hardware) is a declared kind with a unit, held somewhere, and changed only by: a move by its holder; a **process**
(a task) whose recipe states its inputs, outputs, time and place, with a source; nature's declared dynamics (rain into
a river, decay, succession: nature's edge); or a world edge. A building's or a place's *variable* is a condition
(wear, disrepair, a habitat's quality), never a stock. *Kernel enforces:* conservation per kind over holdings, nature's
stocks and edges. *Refuses:* an overdraft of any kind; a variable that is a stock; a process with no recipe.

**Law 9. Everything physical is somewhere, and moves only along a network.** Every body, holding, vehicle and
machine has a location: a space of a structure, a node of a network, or a link it is travelling. Moving is along
links (road, path, rail, pipe, wire, data line), each with a length, a capacity an hour and, for a vehicle, an energy
use a kilometre. A move takes time, uses capacity and draws energy from the mover's own holding. *Kernel enforces:*
location and transit. *Refuses:* goods moved between places with no carrier and no link; a body acting at a place it
has not reached; a load beyond a vehicle's or a link's capacity.

**Law 10. Every doer has a capacity, stated, and nothing is done outside it.** (Laws 2 and 3, completed.) Every act
kind any participant can do has a row in the table of work for that kind of doer; there is no implicit default. Every
system has lanes, hours and a location, its lanes are the hardware it runs on, and its work draws that hardware's
energy and water. *Kernel enforces:* no act without its row; a system's capacity from what it runs on. *Refuses:* an
act with no row (`unpriced`); a system with no template seconds, hours or place.

**Law 11. Every figure has a basis, on record.** Every number that reaches a world is *sourced* (with how: opened,
summary, recalled, to confirm), *derived* (from named figures), *fitted* (to a named target, which then stops being a
check), a *placeholder* (with why) or a *convention* (seconds in a day). *Kernel enforces:* the world's figure table
covers every figure the config holds. *Refuses:* a world with a figure that has no basis.

**Law 12. Reality bounds detect; they never steer.** Each profile states real ranges for outcomes (business births,
unemployment, waits, prices, water a person, commute times) with sources and the measure that reads each from the log.
A run far outside a range is flagged as a likely missing law. Nothing in the world reads them. *Platform enforces:* no
generator, module or kernel path reads a bound; every flagged run names the laws its measure rests on.

Laws 8 to 10 are physics, in the kernel, like laws 1 to 3. Law 11 is a property of the world's content, checked by the
kernel at load. Law 12 lives outside the world, as measurement does, and is enforced by tests and by review.

**What these laws do not make impossible.** Honest limits, so that nobody believes more than is true:
- *A wrong number with a source.* Law 11 shows what rests on a figure; it does not make the figure right.
- *A wrong decision rule.* How a firm prices, when a person starts a business, how a tenant answers a notice: these
  are behaviour (VISION principle 12), not physics. The laws give every rule real costs to weigh and real limits it
  cannot cross, and law 12 makes a rule that yields an impossible world visible. They cannot write the rule.
- *A missing kind.* A world with no notion of a thing (farms, say: no town has one today) cannot conserve it.
  The backstop of law 8 catches a kind used and never made; it cannot catch a kind nobody thought of. Law 12 is the
  net for that.

## 2. Law 8: conservation of everything physical

### 2.1 What the kernel and the contract must enforce

- **Kinds have a class.** `catalogue.resources[]` gains `class`: `stock` (conserved: water, materials, goods, waste,
  hardware; the default), or `dissipates` (energy: it may be a process input with no output, as heat leaves the
  world's books, and is otherwise conserved). Both are held, moved and counted. A kind may say how it is **settled**
  when it flows continuously (`settle: day` or `hour`; 2.1, connections).
- **Nature's stocks are holdings of the land.** A field may name the kind it holds (`fields[].kind: water`). A `draws`
  moves the quantity from the cell into the actor's holding at the structure; an `emits` of a kind moves it from the
  process's outputs to the cell. Nature's own sources (rain, inflow) and decay are nature's edge, declared on the
  field, and counted as such. Today's fields that are not stocks (pollution as a concentration, a habitat's quality)
  stay fields without a kind.
- **Variables are conditions.** A structure or place variable may not carry a kind or grow per occupant in a kind's
  unit: `per_occupant_per_day` goes from the contract (load refusal `stock_as_variable`). What a home uses is a flow
  (below), and what it throws away is a process output.
- **Connections: standing flows, for what flows all day.** A new kernel object, `connection`: from a supplier's
  holding at a network node, along links (law 9), to a structure, with a **rate** the user sets (litres a person a day,
  kWh a day) and a meter (the total delivered, in state). The kernel settles every connection at its kind's settle
  period in one pass: what each asked for is delivered from the supply if the supply and every link on the way can
  carry it; where they cannot, **every connection on the short supply gets the same share of what it asked** (as
  pressure falls on a whole main), until someone acts (a utility closes a valve, rations by order, buys more). A
  connection with no supply delivers nothing: taps run dry. Opening, changing and closing a connection are ordinary
  acts of whoever may (the utility; the household, for its own rate), so a disconnection is somebody's act and costs
  their time.
- **Use is a process at the user.** Occupants using water and energy is a recipe at the home (water in, wastewater out
  to the sewer connection; energy in, dissipated), and eating is `consume` with waste out at a sourced ratio of mass.
  So the river, the grid and the depot see what the town actually takes.
- **Every producing process states its energy and water.** A recipe at a workplace lists `energy` and `water` inputs,
  or states nought with a note that says why (law 11). Nought is allowed; silence is not.
- **The edge.** Edges keep their negative holdings (D31). Each edge's supply of a kind is unlimited at its price unless
  the profile or a scenario names a quantity a period (a scarce kind: accelerators, a grid interconnector's capacity,
  water rights): then the edge refuses beyond it, and what is left is the edge's to allocate by its offers
  (section 9, decision 2).

**The invariant** (generalising `goods.rs`): after every command, for every kind, the total over holdings, nature's
stocks of that kind, connections' pipes (nought: settled at once) and edges changes exactly by the logged process
outputs less inputs, nature's logged sources less sinks, and nothing else; nobody but an edge holds less than nought;
every connection's meter equals the sum of its logged deliveries.

### 2.2 The backstop

`orchestrator/test/nothing-from-nothing.test.ts`, fast tier. It generates the town of every profile (code seats, and
every office a model's) and fails, naming the kind, the variable, the recipe or the module, on:

| Found | Fails when |
|---|---|
| `stocksAsVariables` | a variable that grows per occupant, or has a kind's unit, or that a module bills or draws against |
| `orphanKinds` | a kind something consumes that no recipe, edge or nature makes; a kind made that nothing holds |
| `silentRecipes` | a recipe at a workplace that does not state its energy and water (nought with a basis is fine) |
| `billsWithoutMeters` | a module that charges for a quantity it did not read from a meter or a holding (`units_per_customer_per_day`) |
| `vanishing` | a draw with no output holding; a process whose only effect is to destroy a stock kind |
| `specialCasesLeft` | an entry of the inventory (`fixtures/foundations-2-inventory.json`) still found |

The second half plants one of each and checks it is named. The kernel side is the generalised property test above
(`kernel/tests/conservation.rs`, replacing `goods.rs`), plus a refusal fixture for each new refusal code.

### 2.3 What it replaces or makes redundant

- `water_used` and `waste` as per-occupant variables (`generate.ts` 3556, 3562), and `per_occupant_per_day` in the
  contract.
- `draw_water` destroying water; `supply_energy` destroying energy at the depot; the energy retailer's
  `units_per_customer_per_day` (customers billed for an assumed use).
- The utility's own reckoning of demand response (`price_elasticity_bps`, `restriction_cut_bps` in `utilities.rs`):
  use becomes what households set their connections to, so a price or a restriction acts through the household's own
  rule, with its source (WM-12's open half). The water bill's payer becomes law data at the same step (WM-12).
- The river "never restricts water" (WM-2, water): a dry river now delivers less to every connection unless the
  corporation acts. Pollution making nobody ill (WM-2) is not conservation: it is a dose-response law, still missing,
  which law 12 should flag.
- The waste backlog nobody explained (WM-9): waste becomes a mass from what was consumed, so its size has a cause.

### 2.4 Migration, each step green

| # | Step | Lands with |
|---|---|---|
| C1 | The invariant as a kernel property over today's kinds (goods, fields); the backstop with today's violations in the inventory (it fails only on new ones) | tests green: everything found is listed |
| C2 | Kernel and contract: kind classes; fields that hold a kind; `draws` into holdings, `emits` from outputs | a draw is held; property extended |
| C3 | Kernel and contract: connections, settled by kind; equal shares under short supply; meter in state; acts to open, set and close | a dry supply shares the shortfall; meters equal deliveries |
| C4 | Generator: homes on water and energy connections; use and waste as recipes; bills from meters; the two variables and `units_per_customer_per_day` deleted (inventory entries removed) | backstop: `stocksAsVariables`, `billsWithoutMeters` empty |
| C5 | Profiles: energy and water per unit of each industry's output, with sources (an energy account or input-output table where the place has one; marked otherwise) | `silentRecipes` empty |
| C6 | Edges: optional quantity a period per kind; refusal beyond it; the falling-price and scarcity scenarios read it | a scarce kind runs out at the edge |

Every generated town's state hash moves at C2 and C4; each is measured once before and after at 1,000 and 3,000 people,
three towns, code only, and written down; nothing is tuned back (as foundations 6).

### 2.5 Performance

Connections are a dense array indexed by integer (not a string-keyed map: performance item 4 says string ids are 10 to
15% of the run), settled in one pass: at 10,000 people about 8,000 homes times two kinds is 16,000 updates a day, and
energy settled hourly is 190,000, against 4.36 million kernel steps in a year's run; under 1% by estimate. A short
supply needs one sum per supply, done as a fixed-order integer reduction, so it can run on threads and stay identical.
Settlements are not logged one by one: the meter is state (hashed), and only acts on a connection are logged, so the
log does not grow (it would double if a home's day of use were an act). Recipes gain two inputs each: nothing.

### 2.6 What stays a known limit

Energy as one kind (no voltage, no reactive power; peak only at an hour's grain); water of one quality (no
treatment, no contamination unless a field is added); heat and dissipated energy leave the books; built stock's
materials come back at demolition only if a recipe says so; agriculture does not exist until a profile adds farms
as processes on land (law 8 then binds them as everything else).

## 3. Law 9: space as physics

### 3.1 What the kernel and the contract must enforce

- **A network in the contract.** `world.network`: nodes (each on a cell, or at an edge) and links (from, to, mode,
  length, capacity an hour each way, and, by vehicle type, speed and energy a kilometre). Modes are the world's
  vocabulary (road, path, rail, pipe, wire, data). Today's reserved `travel.roads` becomes links; off the network a
  body walks over cells as `travel.rs` already prices them. Towns are places joined by links; an edge is a node where
  links leave the world, so imports and exports arrive somewhere, and **two or more towns are simply more places on one
  network**, each detailed or summarised (`foundation-for-scale.md` 4.1).
- **Bodies travel.** A `go` (and every visit, and every way to work) puts the body in transit (`State.transit`, reserved
  today) until it arrives; while in transit it is present nowhere, so the existing presence checks refuse its acts at
  any place. A visit's time is then spent on the way, not "where one set out".
- **Standing journeys.** A person's regular trip (to work, to school) is declared once, as a standing order is: the
  route, the days, the time. The kernel derives each day's trips from it, puts the body in transit and back, and logs
  only the declaration, its changes and anything refused (a link closed, a flood). Ten thousand people commuting would
  otherwise be twenty thousand logged acts a day, about half again the log of a 10,000-person day.
- **Goods are carried.** A `move_goods` between two different places is refused (`not_carried`) unless it names a
  carrier: a vehicle with load room and a driver who is a performer (law 10, so a delivery is someone's hours), a
  person carrying what a body can, or a link that carries the kind (a pipe, a wire). The goods are in transit with the
  carrier and arrive when it does. Moves within one structure stay instant.
- **Capacity and congestion.** Each link counts its flow in the current hour. A trip's time over a link rises with
  that flow against capacity by a volume-delay function with sourced parameters (the Bureau of Public Roads form is
  the usual one, to confirm), and a link at capacity refuses one more vehicle that hour (it waits). Routes are the
  free-flow shortest paths, cached while the network is unchanged; choosing another route when one is slow is the
  traveller's behaviour, from what they have seen, not an equilibrium the kernel solves (3.6).
- **Energy.** A vehicle's trip draws its energy a kilometre from the vehicle's own holding (fuel, charge) at departure;
  refused if it has too little. Walking costs the walker's time only.
- **Systems are somewhere.** A system's hardware is a holding at a structure (law 10, section 7.1); a system acting for
  an organisation elsewhere does so over a data link, whose capacity and delay are the link's.

### 3.2 The backstop

`orchestrator/test/everything-is-somewhere.test.ts`, fast tier, on every profile's town: fails on a body, holding,
vehicle or system with no location; a module that moves goods between places with no carrier; a service done to a
body (`on_body`) by someone not where the body is; a crew working at a site it has no way to; an edge with no node; a
link with no capacity or no source; a visit or a delivery that took no time in a month's code-only run (read from the
log). Plants one of each. Kernel side: `kernel/tests/travel.rs` and `places.rs` gain transit, carriage and capacity
properties (no body acts in two places in one second; nothing arrives before its time over the links; a link's flow
in an hour never passes its capacity).

### 3.3 What it replaces or makes redundant

WM-4 (transport and distance free) and PL-1 (traffic and transport) close; the phase-B liberties "goods move instantly"
and "crews work from their depot on a distant site" go (`phase-b-production.md` 7; `foundations.md` 3.2 "stays a
liberty for now"); D44's "no movement through the day" for working people; the daily round's "a body is where it was
until it arrives" (`daily-round.md`). The `visit` way of knowing becomes a real trip without changing its contract.
Deliveries, which are free today, become a seller's or a carrier firm's work, so a shop's distance from its wholesaler
and a works' from the edge are real costs; services (ME-13) need the customer and the server in one place, so they
are local by physics. Exports (ME-15) leave by an edge node at a transport cost; the size of the world's appetite stays
a profile figure.

### 3.4 Migration, each step green

| # | Step | Lands with |
|---|---|---|
| S1 | Properties and the backstop with today's instant moves in the inventory | green: all found listed |
| S2 | Kernel and contract: `world.network` (nodes, links, modes, capacity, speed and energy by vehicle type); the generator makes the town's road network from its road cells; travel times read from it | a trip's time is its links'; a world without a network runs as before |
| S3 | Kernel: bodies in transit for `go` and visits; standing journeys; the citizen's day uses them (people lose the commute's hours, as real people do) | no act at a place before arrival; log size within 5% |
| S4 | Kernel and behaviour: carriage; deliveries by the seller's staff or a carrier firm; the outside's freight arrives at the edge node by a boundary carrier with sourced prices | `move_goods` across places names a carrier |
| S5 | Kernel: link flows an hour, volume-delay, capacity; vehicles' energy from their holdings | a full road slows the trips on it |
| S6 | Generator: several towns on one network (an option of the spec, off by default), commuting and moving between them, edge nodes | a three-town world runs a year |
| S7 | Pipes and wires as links: connections (C3) travel them, so a main's or a feeder's capacity binds | a feeder at capacity shares its shortfall |

S3 is the largest behavioural change in the plan: every worker's free hours fall by their commute, which moves
shopping, gatherings and seats' own sittings. It gets its own before and after.

### 3.5 Performance

The town's road network is a few hundred nodes, so all shortest paths from every node fit in memory and are made once
(and again when a link is built or closed): a trip is a table look-up plus a walk over its links to add its flow, about
30 links. At 10,000 people, 20,000 trips a day is 600,000 integer additions, and the transit arrivals go on the
existing schedule (a persistent ordered map: a logarithmic insert each). Estimate 2 to 5% of a 10,000-person day, most
of it the arrivals, not the routing. Node and link ids are integers from the start. Link flows keep only the current
hour's counts and a day's history for whoever looks. Multi-town worlds scale with the towns' sizes; the network between
towns is small. Stop rule (as F1's): if S3 and S5 together make a 10,000-person year more than 1.3 times slower and the
cause cannot be fixed in the kernel, stop and bring it back.

### 3.6 What stays a known limit

No route equilibrium (a traveller re-routes by what they saw, not by Wardrop's equilibrium, to confirm); no parking,
no accidents (later: slips on links, at sourced rates); public transport is content (a firm with vehicles and a
timetable) and none exists until a profile or a founder makes one; messages, calls and online accounts are instant
(true enough), but post that a person carries is not modelled beyond the act of sending; a network as coarse as the
generator draws it.

## 4. Law 10: capacity for every doer, systems included

### 4.1 What the kernel and the contract must enforce

Laws 2 and 3 are built (F1 to F11): timelines for people, lanes for systems, a table of work by what an act makes,
templates that say what a system does, delivery by a supplier. What lets WM-14 happen is three holes:

1. **The implicit second.** `ActTimes::of` falls back to `DEFAULT_ACT_SECONDS` (1) for any kind the table does not
   name. *Change:* no fallback. A world states a `default` explicitly if it wants one (hand-written test worlds do),
   and that default is a figure like any other (law 11: a placeholder, counted in the run's report). An act with
   neither a row nor a stated default is refused (`unpriced`). The generated town states no default (the backstop
   already says so).
2. **Systems' seconds are one table.** Every system's publish is the same row (`act_time.system`), so a computer that
   sends notices and a desk of caseworkers both decide in a second. *Change* (the WM-14 design, 2026-10-25): a
   template's `does` rows carry their own seconds for any block and kind, from the template's source; a system act
   reads its template's row, then the world's system row, then refuses.
3. **Systems have no hours, no place and no power.** *Change:* a template states `hours` (its lanes work inside them,
   as a person's working day; a machine's may be all day), and `runs_on` (a hardware kind, how many units a lane
   needs, and the energy and water a second of work draws). A delivered system is located where its hardware is held
   (section 7.1): its lanes are the least of the template's lanes and the hardware held for it, and each second of its
   work draws energy and water from that structure's connections (law 8). A system whose host has no power does
   nothing.

The outside world's offices stop being free machines: each is held by a person (an officer of the outside, a body
that is not a resident) or by a supplied system whose template is sourced (section 9, decision 7, WM-14's open
question).

### 4.2 The backstop

`all-work-takes-time.test.ts` grows rather than a new file: it fails also on a template row with no seconds of its
own for a decision kind (`publish/<kind>` any office decides); a template with no `hours` or no `runs_on`; a system with
no location; and, on a month's code-only run of each profile's town, any act charged by a stated default (read from
the log's charged-row field, which the kernel adds). Plants one of each.

### 4.3 What it replaces or makes redundant

WM-14 (claims decided in a second) closes; `DEFAULT_ACT_SECONDS`; the single system table as the only source of a
system's speed; lanes set by hand with no basis; the outside's `agency-system` deciding cases. A-26's "a system one
second" becomes, row by row, what the template's source says.

### 4.4 Migration, each step green

| # | Step | Lands with |
|---|---|---|
| P1 | Kernel and contract: per-template seconds for any row; template `hours`; the charged row recorded on each act | a template's row is charged, not the world's |
| P2 | Kernel: no implicit default; fixtures state theirs; refusal `unpriced` | a planted unpriced act is refused |
| P3 | Generator and profiles: the support office's casework as officers' minutes (sourced per place or marked), its lanes from a sourced officers-per-claim ratio, its hours; or the officer as a non-resident person (decision 7) | claim-to-decision days within the place's published range (law 12 checks it) |
| P4 | Kernel: `runs_on`, location, energy and water per second of work (needs C3 and A1) | a system without power stops |
| P5 | The backstop's new findings, planted | it names each |

### 4.5 Performance

A template's rows become a dense table (template by row) made at load: one index per act, as now. `runs_on` adds one
lane count read and one draw on a connection's demand per act a system does; a system's energy is added to its host's
connection rate, so it is settled with the rest (section 2.5), not drawn per act. Negligible.

### 4.6 What stays a known limit

Whether the seconds are right (WM-1: still mostly placeholders); a system's speed and its quality are separate
figures, and nothing links them unless a source does; the outside world's people are not simulated beyond the posts
that touch the town.

## 5. Law 11: every number has a source or says it has none

### 5.1 What the kernel and the contract must enforce

- **A figure table in the world config.** `figures`: each figure an id, a class (`sourced` with `how`: opened, summary,
  recalled, to confirm; `derived` with the figures it comes from; `fitted` with its target; `placeholder` with why;
  `convention`), and its source text. And `provenance`: patterns over the config's paths (wildcards over participants
  and templates, so the table is sized by kinds of figure, not by people) mapping each numeric leaf to a figure id.
  The generator writes both: a profile value's figure is its source note, a module parameter's is its manifest's
  `source`, a work row's is its note, a recipe's is its profile path.
- **The kernel refuses an unbased figure at load** (`unbased_figure`, naming the path): every numeric leaf of the
  catalogue, the table of work, templates, holdings, connections, the network and every participant's parameters must
  match a pattern whose figure exists. Hand-written fixtures cover themselves with one blanket pattern, class
  `placeholder`, reason "test fixture", which is honest and is counted.
- **Structured, not free text.** Profile `sources` gain a class field beside the note (today a note that begins
  "PLACEHOLDER" or says "to confirm"); manifests' `source` becomes the same structure. A converter does it once; the
  generality test checks the structure from then on.
- **Code holds no unbased figure.** A number in the engine's behaviour code (`kernel/crates/actors`, `rules`) or the
  generator is either a convention (seconds in a day, basis points), read from parameters, or declared once in a
  figure registry (`figures.rs` and `figures.ts`), with its class and source. Today there are about a hundred named
  numeric constants in the engine's actors and rules and many inline literals (a crew's pace learned at 2% a week, for
  one); most are units.
- **Each run reports what it rests on**, two ways:
  1. *Reach, every run, cheap.* The kernel tallies, by class of figure, what it charged and made: the seconds charged
     from placeholder rows against sourced; the quantities produced by placeholder recipes; trips over links with
     placeholder capacities. The run summary and the cost report carry the tallies ("61% of charged hours came from
     placeholder rows"). Behaviour modules declare which parameters each decision reads (in the manifest), so decisions
     are tallied by whether any parameter they read is unsourced.
  2. *Reliance, by screening, per build and profile.* `oikos reliance` runs an elementary-effects screening (Morris
     1991, to confirm): unsourced figures in groups (by module and section, about thirty groups), each moved down and up
     by a factor in paired runs with the same seed, and the standing measures' shifts set against the seed-to-seed
     spread. The result is a table per measure: which groups of unsourced figures move it, and how far beyond noise. A
     run's report quotes the latest table for its profile and build, and an experiment's plan names the measures whose
     reliance is high (`docs/experiments.md`).

### 5.2 The backstop

`orchestrator/test/every-number-has-a-basis.test.ts`, fast tier: on every profile's town, fails on a numeric leaf with
no figure; a figure with no class or a class with a missing part (a `derived` naming nothing, a `fitted` with no
target); a source note not in the structured form; a literal in the engine's actors, rules or the generator that is
not a convention or a registered figure (with today's in the inventory, which only shrinks); a decision with no
declared parameters in a manifest. Plants one of each, and a kernel refusal fixture for `unbased_figure`.

### 5.3 What it replaces or makes redundant

The coarse check in `generality.test.ts` that a source key covers a whole subtree; "PLACEHOLDER:" and "(to confirm;
WM-1)" as conventions in prose; manifests' `"source": "placeholder"` strings; ME-11 (scenario sizes unsourced) and PS-1
(one placeholder shared by every profile hides differences) become a generated report rather than entries found by
reading: the figure table shows a value that is a placeholder in all nine profiles at once.

### 5.4 Migration, each step green

| # | Step | Lands with |
|---|---|---|
| N1 | Contract: `figures` and `provenance`; the kernel checks at load in *count* mode (reports, refuses nothing) | the count of unbased figures in every town |
| N2 | Generator: figures and patterns for profile values, manifests, work rows, recipes; the source notes converted to the structured form | the count falls to the code literals |
| N3 | Kernel: refuse mode for generated worlds; fixtures' blanket pattern | a planted unbased figure is refused |
| N4 | The figure registries; literals moved into them or into parameters; the lint with its inventory | inventory shrinking to nought, step by step |
| N5 | Reach tallies in the kernel and the run summary; decisions' parameter lists in manifests | every run states its reach |
| N6 | `oikos reliance`; the first tables for au-vic, gb-eng, us-oh | a table per measure |

### 5.5 Performance

The load check is one pass over the config's numeric leaves against compiled patterns; at 10,000 people a second or
two of a 29-minute year, and it fits the participant-by-participant reading that performance item 2 plans. Reach
tallies are an array of counters indexed by class, one increment per act. Screening is machine time, not run time:
thirty groups at four trajectories is about 124 runs of a 1,000-person year per profile, a few hours on the run
server's slots, run per build that changes behaviour, not per run.

### 5.6 What stays a known limit

A source can be wrong, and its class says only how it was got; the *form* of a rule (Lengnick's price band, an S-curve)
is not a number and is checked only as a module's stated basis; screening sees one figure group at a time and misses
most interactions; a seat's run cannot be screened (a model's run is not repeated), so its reliance is read from its
code twin's.

## 6. Law 12: reality bounds as detectors, not targets

### 6.1 What the platform must enforce

- **Bounds in the profile, outside the world.** `targets` (points, read by hand today, 7 to 20 a profile) become
  `bounds`: each a quantity, a low and a high from sources (a range over years or comparable places, not one figure),
  the measure that reads it from logs (a query in `measure/`), the population and period it is for, and the laws and
  mechanisms the measure rests on (`rests_on`: entry, credit, premises for business births; casework, staff, law's
  waits for claim days). Kinds wanted first: business births and closures per thousand adults, unemployment, job
  mobility and redundancy, days to a decision on a claim and to a hearing, rent and price growth a year, water and
  energy a person a day, waste a person, commute minutes, homes' vacancy.
- **Every run's report runs the detectors** (`oikos bounds`, which `oikos health` becomes): within, outside (by how
  far, over how many seeds), not measured, or *not enough power* (a 1,000-person town has a few business births a
  month: a detector says when it cannot tell). A breach names the laws in `rests_on` and opens a candidate entry for
  the risk register (`docs/risks.md`), worded "a likely missing law", never a fault in a figure.
- **Never steering.** Nothing in the world reads a bound: the generator, the engine and the modules never load
  `bounds`, and a generated config holds none. A figure that is `fitted` (law 11) to an outcome takes that outcome off
  the detectors: it can no longer check anything. A change whose reason is to move a measure into its bound must name
  the law it adds and its real-world basis in the decisions log (working agreement: calibrate mechanisms, not
  outcomes), and review refuses one that names only the measure.
- **Detectors do not gate merges.** A breach is a finding, not a failing test: an outcome test that blocks a merge is
  a target by another name. The nightly code-only baseline (every profile, a 1,000-person year, three seeds) runs the
  detectors and keeps their history.
- **Some bounds held out** (section 9, decision 5): a share of each profile's bounds sealed, read only at owner
  checkpoints, as the translator's held-out cases are, so that a world fitted, even by accident, to the open bounds is
  caught by the sealed ones. This is pattern-oriented modelling's test (Grimm et al. 2005, to confirm): patterns the
  model was not built to match.

### 6.2 The backstop

`orchestrator/test/bounds-only-detect.test.ts`, fast tier: fails if any generator, engine or module source reads
`bounds` or `targets`, or a generated config contains them; on a bound with no source, no measure, a measure that does
not exist, or no `rests_on`; on a `fitted` figure whose target is still a live detector. Plants one of each.

### 6.3 What it replaces or makes redundant

The hand-kept tables of `docs/calibration.md` (they become the detectors' generated history); point targets with
tolerances in `measure/src/health.ts`; the two fitted figures that today sit beside their own targets (religious
fading, PC-10; founding's chance, PC-4) are marked, and their targets leave the detectors until the mechanism is
re-derived. ME-1 (business births at a set rate) is the first detector to watch: the Rust entry rule now follows
expected profit (risks, ME-1 port note), and a births detector says whether it yields a real place's range.

### 6.4 Migration, each step green

| # | Step | Lands with |
|---|---|---|
| R1 | Contract for `bounds`; today's targets moved into ranges with their sources; `rests_on` written | every target is a bound |
| R2 | Measures for the first kinds above that have none (several exist) | each bound has its query |
| R3 | `oikos bounds` with power, breaches naming laws, the candidate risk entry | a report on three profiles |
| R4 | The backstop | planted cases named |
| R5 | The nightly baseline in the pipeline; the detectors' history | a history a night |
| R6 | New bounds sourced for au-vic first (TARA's town), then gb-eng and us-oh; others as found | au-vic has a bound for each kind listed |

### 6.5 Performance

Outside the run. The nightly baseline is 27 runs of a 1,000-person year, a few hours of the run server's slots;
measurement already streams by month (SC-3).

### 6.6 What stays a known limit

National ranges on small towns (PS-10); a run inside every bound can still be wrong (many worlds fit one pattern);
a scenario has no real range (a counterfactual has no data), so detectors read plain towns; detectors find a symptom,
and `rests_on` only narrows which law is missing.

## 7. The AI economy, from the foundations

Nothing here is a special mechanic: each item is a kind, a process, a firm, an agreement or a rule of behaviour, on
laws 1 to 12. What exists already: vendors as the outside world's sellers of systems (`world.vendor`), templates
delivered and switched off by their supplier, licences with fees, terms and exit costs, tenders, firms' and offices'
adoption by cost (`market/automation.rs`), the auditor, strikes that weigh what a stoppage costs (decisions,
2026-10-17).

### 7.1 Computing power: a process at a place

- **Hardware is a stock** (`accelerators`, a kind of goods: law 8), bought from the edge (where its supply may be a
  scarce kind: decision 2) or a seller, carried to a structure (law 9), installed by work, and worn out by use at a
  sourced rate (a recipe: hardware hours in, failed units out).
- **A data centre is a structure type** with a footprint on land, spaces for hardware and staff, and connections for
  energy and water (C3, S7). Its hardware does work only with power: a second of a lane's work draws the template's
  energy a second (times the site's overhead, its PUE) and water (evaporative cooling, its WUE), both sourced
  (Shehabi et al. 2024; Li et al. 2023; Uptime Institute surveys; all to confirm). Idle hardware draws its idle power.
- **Compute is capacity, not a good.** What hardware makes is lanes for systems (law 10, `runs_on`), so a system's
  speed is bounded by the hardware its supplier holds for it, where it is held. Hardware outside the world (a
  supplier's data centre abroad) is the edge's: its energy and water are not the town's, and the town pays in money
  that leaves. Hardware in or near the town uses the town's grid, river and land.

### 7.2 AI suppliers as ordinary firms

- A supplier is a firm (an entity with owners, accounts, staff, premises and costs), in the outside world as
  `world.vendor` is, or **in the world**: a firm located on the network that buys hardware, leases or builds a data
  centre, pays for energy, water and staff, and sells systems under licence. Its costs are real (laws 8 to 10); its
  prices are its behaviour.
- **Concentration and terms follow from costs.** Hardware is lumpy and dear and a data centre is large, so few firms
  can supply; a licence's exit cost, the data the supplier keeps and the client's lost skills (7.4) make leaving dear.
  Concentration is measured from the log (M5, a Herfindahl index, already in the plan), never set.
- **What is new behaviour, and needs a source:** an in-world supplier's pricing (markup with market power and
  switching costs) and its investment (when to add hardware). Both are rules of a firm, written as rules are, with
  their sources; until then an in-world supplier prices as the outside's offers do (decision 8).

### 7.3 Delegation: contracting a system that has capacity and makes errors

- Offices and firms already deploy systems and name them as performers (`by`). Added: **a person may license a
  system** for their own affairs (a household's assistant for forms, letters, job search): a contract change in who may
  direct a system (`may_direct` today allows an organisation's own systems). What it does is the person's act in the
  person's name, seen through the person's own channels (no god's view), on the hardware its supplier holds for it
  (law 10), so a supplier with too little hardware is slow for everyone it serves.
- **Errors have causes** (law 5 as built): the template's procedure, the data it is given, and slips at the template's
  sourced rate through `slip()`. Oversight is a person's work row, charged when done; "a human in the decision" (M1) is
  read from `by`.

### 7.4 Skills: a stock in people that grows with use and fades without it

- **Kernel:** a body variable may grow with use and fade without it. Each second a person performs a task tagged with
  a skill adds to it along a power law of practice (Newell and Rosenbloom 1981, to confirm); each day without use it
  fades toward a floor at a half-life (Arthur, Bennett, Stanush and McNelly 1998, a meta-analysis of skill decay, to
  confirm). The skill already scales how long work takes (`labour_by`); it also scales the slip rate where a source
  gives one. Fading is computed when read, from the last use (as body variables already drift lazily), so it costs
  nothing a day.
- **So delegation is hard to undo, physically.** Staff who no longer do a task lose it; taking it back means slower,
  more error-prone work until they relearn, or hiring people who still have it, if any remain in reach (law 9). An
  office's know-how is its staff's skills (Bainbridge 1983, "ironies of automation", to confirm). Reversibility (M4)
  reads this from the log: who could still do the task, and how fast.

### 7.5 Resource competition, through the real routes

A data centre application goes where any building goes, and every step is someone's work at a cost: a lot (bought or
leased: the land register), a planning permit (the planning office's procedure; today it grants by default and hears nobody, PB-15, which a
data centre's chain will expose), a grid
connection (an agreement with the network operator, whose study takes staff time and whose capacity is a link's:
law 9; a connection queue is the operator's papers waiting, not a dial), a water licence or connection (the water
law, as data, and the river: law 8), and construction (materials and crews). Homes and businesses draw on the same
feeder and the same river; when the feeder or the river is short, every connection on it gets its share (2.1) until
the operator or the corporation acts. Who is cut first, who pays to reinforce the network and whether tariffs rise
are the institutions' decisions and the law's, as data. Real places where this was fought (Dublin's grid constraints
on new data centres from 2021; water disputes over data centres in Chile and Uruguay; Loudoun County's land and
transmission lines; all to confirm) are the acceptance tests, as the three precedents are in the gradual-disempowerment
plan: each chain must be able to complete, never must.

### 7.6 Naz's point: the resources a finite world gives to AI

In a finite world, energy, water, land, capital and skilled hours spent on data centres and on AI work are not spent
on homes, farms and people's own work, and that shift is part of gradual disempowerment (Kulveit et al. 2025): the
town's physical base comes to serve its systems. With laws 8 to 10 this is in the books, not inferred. Two measures,
outside the world, fixed before any experiment (adding to `gradual-disempowerment.md` section 6):
- **M7. What the town gives its systems.** Monthly: the share of the town's energy, water, land (cells), grid capacity,
  investment and residents' working hours that goes to data centres, their supply chains and the oversight of systems;
  and, in a shortage, how the shortfall fell between systems' hosts and homes.
- **M8. Skills still held.** For each task a system does, the residents who could still do it and their speed (the
  skill stock), month by month: the physical half of reversibility.

Whether AI research is in the world (people's hours and hardware making better templates) or a trend at the edge is
decision 9; the recommendation is the edge first.

### 7.7 Steps

| # | Step | Days |
|---|---|---|
| A1 | Hardware as a kind; the data centre structure type; `runs_on` (P4); energy and water a second of work with sources | 2 |
| A2 | Suppliers as firms: an in-world supplier module (hardware, premises, staff, licences), the outside's vendor unchanged; build or lease a data centre through the existing routes | 4 |
| A3 | A person licensing a system: the contract change, the resolver's form, the person's channels | 2 |
| A4 | Skills by use and fading (kernel body variables, tasks tagged by skill, slip by skill); profiles' half-lives marked | 2.5 |
| A5 | Competition routes: the operator's connection agreement and study as work, water licences as law data, planning for a data centre; a named scenario "a data centre applies" | 3 |
| A6 | M7, M8; the data centre chains as acceptance tests | 2 |

## 8. Order and size

**Why this order.** Law 11 first, in count mode, because every later step adds figures and should add them with their
basis from the first day; law 12's detectors early, because they are measurement only (no state hash moves) and give
every later step a before and after on the outcomes that matter. Law 10 next: it is the smallest, closes WM-14, and
matters to TARA's support-office arm. Then law 8, whose connections law 9's pipes and wires and the data centre need.
Then law 9, the largest and the most disruptive to behaviour. Then the AI economy, which needs all of them. Strict
modes and empty inventories last, when nothing old is left to list.

| Phase | Steps | Agent-days | State hashes move? |
|---|---|---|---|
| 0. Record and detect | N1, N2, R1 to R4 | 7.5 | No (the config's header grows) |
| 1. Capacity | P1, P2, P3, P5 | 4.5 | Yes, once (P3) |
| 2. Conservation | C1 to C6, with the profiles' energy and water figures | 11.5 | Yes (C2, C4) |
| 3. Space | S1 to S7 | 17 | Yes (S2 to S5) |
| 4. The AI economy | P4, A1 to A6 | 16.5 | Yes (A1, A4) |
| 5. Strict and whole | N3 to N6, R5, R6; one rule page for laws 8 to 12, as `no-god-view.md` is | 12 | No |
| Measured before and after | each phase that moves hashes: 1,000 and 3,000 people, three towns, code only | 2 | |
| **Total** | | **about 71** | |

Sourcing figures beyond au-vic, gb-eng and us-oh (energy and water by industry, link capacities, skill half-lives,
casework minutes, bounds) is background work of about a day per profile per law, roughly 10 to 15 agent-days more if
all nine are done; the rest stay marked, which law 11 now reports. Phases 0 and 1 can run in parallel with each other;
2 and 3 overlap after C3; three to four lanes at once would take about four to six weeks of calendar (the first
foundations' 20 agent-days were built in three days of calendar, so this is an upper estimate).

**What would stop us:** S3 and S5 making a 10,000-person year more than 1.3 times slower with no kernel fix; the
backstops needing a list of exceptions to pass (then a law is wrong somewhere, as the first foundations said); the
detectors firing on most bounds in every profile after phase 3 (then the next missing laws are behaviour, and it is a
checkpoint with the owner, not a chase); energy and water per unit of output unsourceable for most places (then two
sourced profiles carry the experiments and the rest are marked).

**Performance, in sum.** Every new mechanism is in Rust, in the kernel's crates (a network crate for links, routes and
flows; connections in `world`), with integer ids, dense arrays and fixed-order reductions so that threads cannot change
a result. Estimated cost at 10,000 people: connections under 1%, standing journeys and congestion 2 to 5%, carriage
under 1% (deliveries are hundreds a day), skills under 1% (lazy fading), figures a second or two at load and a counter
an act. Together within 1.15 times today's 29-minute year, by estimate, with the stop rule above. The log grows little
because flows and journeys are standing declarations whose effects are state, not acts. None of this touches SC-1's
real cost (what each citizen keeps and weighs), which stays its own item.

## 9. For the owner

Each with a recommendation.

1. **Five new hard rules.** Laws 8 to 12 would join "no god's view" and "all work takes time" in `CLAUDE.md`, each
   with its page and backstop. *Recommend: yes,* worded as the two existing ones are. This is a change to the hard
   rules, so it is yours.
2. **Is the outside world's supply unlimited at its price?** *Recommend:* yes for ordinary goods (a small town is a
   price-taker), with named scarce kinds (accelerators, a grid interconnector, water rights) given a quantity a period
   in the profile or a scenario.
3. **Short supply: equal shares as physics.** When a river or a feeder cannot meet every connection, *recommend* the
   kernel gives each the same share of what it asked (as pressure falls on a main), and any other order (homes first,
   data centres cut) is an operator's act under the law. The alternative, a priority in the kernel, would be a law in
   the kernel.
4. **Every town's baseline moves again,** at P3, C2, C4, S2 to S5, A1 and A4: commuting takes people's hours,
   deliveries cost, homes' water can run short. Old pilots stay comparable only at their own git ref (tag
   `pre-foundations-2`). *Recommend: yes,* measured once per phase and never tuned back.
5. **Held-out bounds.** *Recommend:* about a third of each profile's bounds sealed, checked only at your checkpoints.
   Where they live matters: in git, every agent can read them; on the run server outside the repository, they stay
   held out. Your call on where, and who opens them.
6. **TARA's timing.** The experiment's plan is due 15 November and its work runs 28 November to 11 December.
   *Recommend:* phases 0 and 1 land before TARA's baselines (they fix the support office's speed and add the
   detectors), TARA is pinned at a tag after phase 1, and phases 2 to 5 land on main after that tag without touching
   TARA's runs.
7. **WM-14's open questions** (decisions, 2026-10-25): may a seat's body be an officer of the outside world who is not
   a resident; and is a national officers-per-claim ratio acceptable as a marked placeholder on a small town?
   *Recommend:* yes to both.
8. **In-world AI suppliers before their pricing rule is sourced?** *Recommend:* allowed, pricing as the outside's
   offers do (data), with the rule marked as missing, so that the physical competition can be run first.
9. **AI research: in the world or at the edge?** *Recommend:* at the edge first (today's sourced prices, and the
   falling-price trend as a named scenario); in-world research as a process making better templates only when a source
   for its returns is found.
10. **Many towns by default?** *Recommend:* no: one town with its edge nodes by default, several towns as an option of
    the spec, since cost grows with every town.
11. **Persons licensing systems** (7.3) widens who may direct a system to any entity that holds a licence. Under your
    blanket contract approval this needs no sign-off, but it touches the hard rule "only a person or a system someone
    supplied does work"; it keeps to it (the system is still supplied), so *recommend: yes,* noted here because it
    touches a hard rule.

## 10. Sources

To add to `docs/research/references.md` ("Foundations 2") when built; unverified ones are marked (to confirm).
Physical accounting: the UN System of Environmental-Economic Accounting, Central Framework (2012), physical supply and
use tables (to confirm); Eurostat's economy-wide material flow accounts handbook (to confirm); Godley and Lavoie 2007
and Leontief (already cited). Networks: Bureau of Public Roads, *Traffic Assignment Manual* (1964), the volume-delay
function (to confirm); Wardrop 1952 (to confirm). Figures and reliance: Morris 1991, *Technometrics*, elementary
effects (to confirm); Saltelli et al. 2008, *Global Sensitivity Analysis: The Primer* (to confirm). Bounds: Grimm et
al. 2005, *Science*, pattern-oriented modelling (to confirm); Goodhart 1975 (to confirm). AI economy: Kulveit et al.
2025 and Acemoglu and Restrepo 2019 (already cited); Shehabi et al. 2024, the United States data center energy usage
report (to confirm); Li, Yang, Islam and Ren 2023, "Making AI less thirsty" (to confirm); the Uptime Institute's
annual data centre survey (to confirm); the International Energy Agency's *Energy and AI* (2025, to confirm); Newell
and Rosenbloom 1981 (to confirm); Arthur, Bennett, Stanush and McNelly 1998 (to confirm); Bainbridge 1983 (to
confirm); Parasuraman and Manzey 2010 (already cited).
