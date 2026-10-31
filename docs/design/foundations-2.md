# Foundations 2: the world's physics made whole (plan, 2026-10-25)

**Status:** approved by the owner (Naz, 2026-10-25), with his decisions in section 9. Phases 0 and 1 are being built
first. **Each law's line joins the hard rules in `CLAUDE.md` when its enforcement and its backstop test land, not
before**, so that the hard rules never promise what the platform does not yet enforce. Owner's direction (Naz, 2026-10-25, close to
his words): realism gaps must become impossible at the kernel and platform layer, not fixed one at a time,
"eliminating the possibility of whack-a-moles". He agreed the five foundations below; this turns them into laws, tests
and steps, and adds the few general laws any economy needs (services, technologies, entry, skills), from which an AI
economy emerges with nothing built for it. Section 9 records what he has decided and lists what is still his.

**Revised the same day, after the owner's first reading.** (1) Shortages: the first draft's "every connection gets the
same share until an operator acts" was an invented rule and is gone; who goes short follows from the network's physics,
the supply contracts in force and the operators' own acts, with no allocation rule in the kernel (2.1). (2) The AI
economy: the first draft built AI-specific pieces (a data centre type, in-world AI suppliers, a person licensing an
assistant, skills only where systems took over). They are replaced by four general laws any economy needs (section 7),
and the only AI-specific parts left are outside the world: the scenario of AI's capability and cost, and the measures.

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
summary, recalled, to confirm), *derived* (from named figures), *fitted* (to a named outcome), a *placeholder* (with why) or a *convention* (seconds in a day). *Kernel enforces:* the world's figure table
covers every figure the config holds. *Refuses:* a world with a figure that has no basis.

**Law 12. A clearly broken world is flagged, never steered.** A light check outside the world reads each run's log
for states no real place could be in, whatever its figures: everyone starting a business at once, nobody ever hired, a
stock below nought or growing without bound, a law that never once applies. A flag names the likely missing law. It
holds no real-world figure or range, and nothing in the world reads it. *Platform enforces:* no generator, module or
kernel path reads the flags; they never gate a merge.

Laws 8 to 10 are physics, in the kernel, like laws 1 to 3. Law 11 is a property of the world's content, checked by the
kernel at load. Law 12 lives outside the world, as measurement does, and is enforced by tests and by review.

**What these laws do not make impossible.** Honest limits, so that nobody believes more than is true:
- *A wrong number with a source.* Law 11 shows what rests on a figure; it does not make the figure right.
- *A wrong decision rule.* How a firm prices, when a person starts a business, how a tenant answers a notice: these
  are behaviour (VISION principle 12), not physics. The laws give every rule real costs to weigh and real limits it
  cannot cross, and law 12 flags a rule that yields a clearly broken world. They cannot write the rule.
- *A missing kind.* A world with no notion of a thing (farms, say: no town has one today) cannot conserve it.
  The backstop of law 8 catches a kind used and never made; it cannot catch a kind nobody thought of. Law 12 is a
  coarse net for that, and only for what is clearly broken.

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
  period in one pass. **There is no allocation rule in the kernel.** Who goes short when supply or a link cannot
  carry what is asked follows from three things only:
  1. *The network's physics* (below): where a connection sits on the network and what each link on the way can carry.
  2. *The supply contracts in force:* a connection's agreement says whether it is firm or interruptible and what tariff
     it pays (one that moves with scarcity, where the place has one). The kernel stores them and never reads them; the
     operator reads them, and the household reads its tariff and sets its rate.
  3. *The operators' own acts:* closing a valve, switching a feeder off on a rotation schedule, keeping a list of
     protected customers (a hospital, a home on life support), interrupting an interruptible customer. Each is an act
     with its row in the table of work and its source; a rotation is a standing schedule the operator declares once,
     as a standing journey is (3.1), so its effects are state and only the schedule and its changes are logged.
- **The network's physics, as cheaply as is still credible.** Distribution networks for water and power are, in the
  main, radial (trees fed from a source), and the kernel treats each as a tree: a meshed main is cut to a tree at load,
  which is the known limit. One pass up the tree sums what is asked; one pass down delivers. *Water:* each node has a
  head (pressure, in metres): the source's, less the node's height, less a loss on each link on the way that rises
  with the link's flow against its capacity (a linear stand-in for a pipe's friction, sourced per network or marked).
  A connection whose node keeps at least the service head gets what it asks; below it, it gets a share that falls with
  the head to nothing at the least head (pressure-driven demand, Wagner, Shamir and Marks 1988, to confirm). So a short
  source or a full main is felt first at the far end and up the hill, as in a real town. A low river lowers the source
  (the reservoir's level), and the same physics follows. *Power:* links carry only what their capacity allows, and a
  feeder, transformer or interconnector asked for more than its rating at a settle trips (its protection opens): every
  connection beyond it gets nothing until someone closes it again, an act of the operator's. A system asked for more
  than its supply can give does not ration itself: its import link trips, and the town goes dark, unless the operator
  sheds load first. That is why real operators keep rotation schedules, and here they must too. Heights come from the
  ground (a field or the flow layer); a world that gives none is level.
- A connection with no supply delivers nothing: taps run dry. Opening, changing and closing a connection are ordinary
  acts of whoever may (the utility; the household, for its own rate), so a disconnection is somebody's act and costs
  their time.
- **Use is a process at the user.** Occupants using water and energy is a recipe at the home (water in, wastewater out
  to the sewer connection; energy in, dissipated), and eating is `consume` with waste out at a sourced ratio of mass.
  So the river, the grid and the depot see what the town actually takes.
- **Every producing process states its energy and water.** A recipe at a workplace lists `energy` and `water` inputs,
  or states nought with a note that says why (law 11). Nought is allowed; silence is not.
- **The edge.** Edges keep their negative holdings (D31). Each edge's supply of a kind is unlimited at its price unless
  the profile or a scenario names a quantity a period (a scarce kind: a kind of hardware, a grid interconnector's
  capacity, water rights): then the edge sells no more than that, and to whom is its offers' (the order they are taken
  up in, and their terms), never a rule of the kernel (section 9, decision 2).

**The invariant** (generalising `goods.rs`): after every command, for every kind, the total over holdings, nature's
stocks of that kind, connections' pipes (nought: settled at once) and edges changes exactly by the logged process
outputs less inputs, nature's logged sources less sinks, and nothing else; nobody but an edge holds less than nought;
every connection's meter equals the sum of its logged deliveries.

**Built (2026-10-26, phase 2: C1 to C6 with C3b; branch `f2-phase2`; decisions "Foundations-2 phase 2"):** the invariant
(`kernel/tests/conservation.rs`, replacing `goods.rs`) and the backstop with its inventory (C1); kinds' classes, with a third
class `service` beside the design's two (a unit of a service sold over a counter: a haircut is no stock and need not become
waste), fields that hold a kind, a draw held, nature's edge (C2); the network, connections settled on trees by pressure,
ratings and drains, meters in state, the acts on connections and links, rotations as standing schedules (C3, C3b in the
kernel); the generated town's homes on water, electricity and sewer connections, use and waste as recipes, collection from
where waste is held, bills from meters, who pays the water bill as law data, the two variables, the assumed use and the
energy at the depot deleted, and the operators' reclosing and rotation (C4); every workplace recipe states its energy and
water, each nought with its basis (C5, short of the design: no workplace is supplied yet, WM-15); scarce kinds at an edge,
refused `beyond_supply` (C6). **Not as designed:** the `connection` and `link` calls are code's own until the
translator is taught them (TR-7); households do not yet read the tariff or a restriction (WM-12); the CLAUDE.md line is
drafted in the decisions entry and added when C4 lands.

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
| `allocationRules` | a module that shares out a shortfall by a rule of its own (a share, a priority) instead of an operator's act on the network |
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
- The river "never restricts water" (WM-2, water): a dry river now lowers the source, and the far end and the high
  ground lose pressure first, unless the corporation acts (restrictions, rotation, buying water in). Pollution making nobody ill (WM-2) is not conservation: it is a dose-response law, still missing
  (WM-2).
- The waste backlog nobody explained (WM-9): waste becomes a mass from what was consumed, so its size has a cause.

### 2.4 Migration, each step green

| # | Step | Lands with |
|---|---|---|
| C1 | The invariant as a kernel property over today's kinds (goods, fields); the backstop with today's violations in the inventory (it fails only on new ones) | tests green: everything found is listed |
| C2 | Kernel and contract: kind classes; fields that hold a kind; `draws` into holdings, `emits` from outputs | a draw is held; property extended |
| C3 | Kernel and contract: connections, settled by kind; the network's physics as trees (water: heads, link losses, pressure-driven delivery; power: ratings and trips); meter in state; acts to open, set and close | the far end of a full main goes short first; an overloaded feeder trips; meters equal deliveries |
| C3b | Contract and behaviour: supply agreements firm or interruptible, tariffs that move with scarcity (as law data where a place has them); operators' acts: valves, rotation schedules as standing schedules, protected lists, each with its work row | a rotation keeps the import link from tripping; an interruptible customer is cut by an act |
| C4 | Generator: homes on water and energy connections; use and waste as recipes; bills from meters; the two variables and `units_per_customer_per_day` deleted (inventory entries removed) | backstop: `stocksAsVariables`, `billsWithoutMeters` empty |
| C5 | Profiles: energy and water per unit of each industry's output, with sources (an energy account or input-output table where the place has one; marked otherwise) | `silentRecipes` empty |
| C6 | Edges: optional quantity a period per kind; refusal beyond it; the falling-price and scarcity scenarios read it | a scarce kind runs out at the edge |

Every generated town's state hash moves at C2 and C4; each is measured once before and after at 1,000 and 3,000 people,
three towns, code only, and written down; nothing is tuned back (as foundations 6).

### 2.5 Performance

Connections are a dense array indexed by integer (not a string-keyed map: performance item 4 says string ids are 10 to
15% of the run), settled in one pass: at 10,000 people about 8,000 homes times two kinds is 16,000 updates a day, and
energy settled hourly is 190,000, against 4.36 million kernel steps in a year's run; under 1% by estimate. The
network's physics is two passes over each tree a settle (sums up, heads and deliveries down), linear in its nodes and
connections, in integers; separate trees run on threads with a fixed-order reduction, so the result is identical.
A full hydraulic solver (loops, Hazen-Williams friction, an EPANET-style iteration) would cost tens to hundreds of
times more and need floating point; it is not proposed.
Settlements are not logged one by one: the meter is state (hashed), and only acts on a connection are logged, so the
log does not grow (it would double if a home's day of use were an act). Recipes gain two inputs each: nothing.

### 2.6 What stays a known limit

**The network's physics is a stand-in, chosen as the cheapest credible one:** networks as trees (a meshed main's
second path is ignored, so a real town's resilience to one broken main is understated); a pipe's loss linear in its
load, not Hazen-Williams; no transients, no storage in the pipes, no pumps' curves beyond a source head; power as
ratings and trips only (no voltage, no frequency, no reactive power), so a system short of supply goes dark at the
settle rather than sagging; peak only at an hour's grain. Energy as one kind; water of one quality (no
treatment, no contamination unless a field is added); heat and dissipated energy leave the books; built stock's
materials come back at demolition only if a recipe says so; agriculture does not exist until a profile adds farms
as processes on land (law 8 then binds them as everything else).

## 3. Law 9: space as physics

### 3.1 What the kernel and the contract must enforce

- **A network in the contract** (brought in at C3 for pipes and wires; roads and paths join it here).
  `world.network`: nodes (each on a cell, or at an edge) and links (from, to, mode,
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
- **Systems are somewhere.** A system's hardware is a holding at a structure (law 10); a system acting for
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
| S2 | Kernel and contract: roads and paths join the network C3 brought in (modes, capacity, speed and energy by vehicle type); the generator makes the town's road network from its road cells; travel times read from it | a trip's time is its links'; a world without a network runs as before |
| S3 | Kernel: bodies in transit for `go` and visits; standing journeys; the citizen's day uses them (people lose the commute's hours, as real people do) | no act at a place before arrival; log size within 5% |
| S4 | Kernel and behaviour: carriage; deliveries by the seller's staff or a carrier firm; the outside's freight arrives at the edge node by a boundary carrier with sourced prices | `move_goods` across places names a carrier |
| S5 | Kernel: link flows an hour, volume-delay, capacity; vehicles' energy from their holdings | a full road slows the trips on it |
| S6 | Generator: several towns on one network (an option of the spec, off by default), commuting and moving between them, edge nodes | a three-town world runs a year |

S3 is the largest behavioural change in the plan: every worker's free hours fall by their commute, which moves
shopping, gatherings and seats' own sittings. It gets its own before and after.

**Built (branch `f2-phase3`; decisions "Foundations-2 phase 3"):** S1 (2026-10-31): the backstop
(`everything-is-somewhere.test.ts`, its log half `everything-is-somewhere-runs.test.ts` in the slow tier, audits in
`test/lib/law9.ts`), the inventory (`fixtures/space-inventory.json`) and `kernel/tests/space.rs`. Added to the design's
list: systems' places and the unhoused, who are in no space.

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
   (goods at a structure, law 8): its lanes are the least of the template's lanes and the hardware held for it, and each second of its
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
| P3 | Generator and profiles: the support office's casework as officers' minutes (sourced per place or marked), its lanes from a sourced officers-per-claim ratio, its hours; or the officer as a non-resident person (decision 7) | claim-to-decision days come from officers' hours (measured, not aimed at) |
| P4 | Kernel: `runs_on`, location, energy and water per second of work (needs C3 and E2) | a system without power stops |
| P5 | The backstop's new findings, planted | it names each |

**Built (2026-10-25, phase 1: P1, P2, P3, P5; branch `f2-phase1`; decisions "Foundations-2 phase 1"):** a template's
`does` rows carry seconds for any block (read before the world's system row; `work`'s stay a unit's), and `hours` (a
pure function, `oikos_time::place_within`, used wherever a system's lanes are placed: an act, a question answered, a
visit); no implicit second (`unpriced`; test worlds state `default: 1` as a marked placeholder); someone who only orders
an act goes on at once (`ORDER_SECONDS`); the support office's casework is done `by` the desk `outside-casework`
(`agency-casework`: the person table's minutes, an officer's working day spread over the week, lanes from a placeholder
national ratio in every profile); every machine's template states its hours (the whole day); an office offer's seconds
are its template's rows; and the engine now gives a code unit's `done_by` to the act as `by` (found on the way: it had
never reached an act in the engine). The backstop gained `decisionsAtTheSystemsSecond`, `systemsWithoutHours`, template rows'
sources in `unpricedWork`, and (slow tier) `unpricedActs` over a month of each profile's town, each planted. **Not
built here:** the charged row on each act in the log (P1's third part: the backstop reads `unpriced` refusals instead of
acts charged by a default, since the generated town states none); the seat as a non-resident officer (decision 7: not
contained, WM-14); P4 (`runs_on`), as planned.

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
  recalled, to confirm; `derived` with the figures it comes from; `fitted` with the outcome it was fitted to; `placeholder` with why;
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
no figure; a figure with no class or a class with a missing part (a `derived` naming nothing, a `fitted` naming no
outcome); a source note not in the structured form; a literal in the engine's actors, rules or the generator that is
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

**Built (phase 0, 2026-10-25; decisions, "Law 11, counting").** N1 and N2 as counting only, outside the config and the
log, so that no run changes (three profiles' half-year logs byte-identical before and after): `orchestrator/src/figures.ts`
reads every number of a config and finds its basis in the table of work's and slips' notes, the generator's table
(`worlds/generator/figures.ts`, patterns over the config's paths naming a profile path or a class and why) and, for a
parameter left at its module's default, the manifest's note; `oikos figures <world>` prints it and every batch writes
`figures.txt` and `figures.json` beside its runs. A town of 200 (au-vic) has 54,483 numbers: 7% sourced, 6% to confirm,
41% derived, 39% placeholder, 6% conventions, 0.9% unbased (464 in 156 places, listed in
`orchestrator/test/fixtures/figures-unbased.json`, which only shrinks; emptied on 2026-10-25 by rows for every module
parameter and catalogue entry the table lacked, with no profile value changed: decisions, "Law 11: every unbased place
given its basis"). Left for N3, when the table goes into the config
and the kernel refuses: the kernel's own check, and the profiles' notes in structured form (a note's class is read from
its words today, and a note that calls any of its figures a placeholder counts all of them as placeholders). The
`derived` rows are the generator's statements of where a figure comes from; the class of what it is derived from is not
yet carried through.
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

## 6. Law 12: flags for a clearly broken world, never targets

**Cut down on the owner's word** (2026-10-25: "who cares? I don't care what the real figure is"). The first draft had
real-world ranges per profile, sourced, with a held-out set. That is gone: no real-world target ranges, no held-out
set, and no comparison with a place's figures. What is left is a light aid that flags states no world should be in,
whatever its place.

### 6.1 What the platform must enforce

- **Flags, outside the world.** `oikos flags <run>` reads a run's log (as measurement does) and flags, each with the
  run, the moment and the laws the state rests on (`rests_on`, written beside each flag):
  - *a stampede or a freeze:* a large share of the eligible doing one thing at once (everyone starting a business in a
    month, everyone leaving), or nobody ever doing a thing the world offers (nobody hired in a year, no home ever let,
    no claim ever decided);
  - *a stock that breaks physics:* a holding below nought outside an edge, or a quantity, a balance or a backlog that
    grows without bound over the run (a trend that does not level, judged on the run's own course, not against a
    figure);
  - *a dead law:* a law in force whose condition never once applies, or a form, an office or a route nobody uses in the
    run.
  The thresholds are the run's own (shares of the run's eligible, the run's own course), stated once in the flags'
  code with their reason, and are conventions, not figures of any place.
- **Never steering, never gating.** Nothing in the world reads a flag; a flag is a finding for the risk register,
  worded "a likely missing law", never a failing test or a reason to tune a figure. The nightly code-only run of each
  profile prints its flags.

### 6.2 The backstop

`orchestrator/test/flags-only-flag.test.ts`, fast tier: fails if any generator, engine or module source reads the
flags or their output; on a flag with no `rests_on`; and on planted logs of each broken state (a negative stock, a
month where every adult founds a business, a year with no hire, a law that never applies), each of which must be
flagged, and a plain town's month, which must raise none of the stampede or physics flags.

### 6.3 What it replaces or makes redundant

Nothing is replaced: the profiles' `targets` and `oikos health` stay as they are, as reading aids, and are not built
on. Several of today's open risks are of the kind the flags find (ME-1's births, PC-4's founding at pilots' rates,
PB-7's papers no office reads), so they would surface by themselves.

### 6.4 Migration, each step green

| # | Step | Lands with |
|---|---|---|
| L1 | `oikos flags` with the three kinds of flag, `rests_on` beside each, on the run summary | flags on three profiles' plain runs, written down |
| L2 | The backstop with planted logs | each planted state flagged |
| L3 | The nightly code-only run prints them | a list a night |

### 6.5 Performance

Outside the run, one pass over a log that measurement already streams by month (SC-3).

### 6.6 What stays a known limit

Only the clearly broken is caught: a world that is wrong but plausible raises nothing. "Grows without bound" over a
short run cannot be told from a slow rise.

## 7. An economy whose AI part emerges

**The rule for this section:** nothing in the world is about AI. An AI economy has to fall out of laws any economy
needs, so that the same laws carry a bakery, a smelter and a data centre, and a model in a seat meets AI only as it
meets any other technology: a thing on offer, at a price, that does some work. Four general laws do it, on top of laws
1 to 12. What exists already and is general: templates delivered and switched off by their supplier, licences with fees,
terms and exit costs, tenders, adoption by the numbers (`market/automation.rs`), entry by expected profit for small
firms (the Rust entry rule, ME-1's port note), the auditor, strikes that weigh what a stoppage costs.

### 7.1 Anyone buys services from anyone (ME-13, made general)

- **A service is work done for a buyer,** sold under an agreement: to a body (care, a haircut: `on_body`, exists), to
  a thing (a repair, a delivery: law 9's carriage), or papers in the buyer's name (a tax return, a letter, a claim).
  The seller does the work with its own people or systems, named as performers (`by`), in their hours (law 10), and
  the buyer pays by the agreement. Households can buy, as firms and offices can; today they buy only goods.
- **Papers in someone's name** are written by the seller with the buyer's mandate (an agreement) as their basis, as a
  bank already acts on a mandate. Whether the receiving office accepts an agent's papers is that office's procedure
  (content). No kernel change is expected; E1 checks it.
- **So delegation is a purchase.** A household that has its forms done by a system, an office that buys casework, a
  firm that buys its bookkeeping: each is a service bought from whoever sells it, done by whatever the seller uses,
  with that doer's capacity, speed and slips (laws 5 and 10). There is no separate mechanism for AI helpers: they are
  systems that sellers already deploy (owner's ruling, 2026-10-25).

### 7.2 Technologies are goods with a cost and a capability

- **A technology is something sold**: a good (a machine, a vehicle, hardware) or a system delivered from a template,
  with a price, what it can do (its template's rows: which work, at what seconds, at what slip rate, how many at once),
  what it runs on (law 10's `runs_on`: hardware, energy and water a second) and its terms. A firm's or office's
  adoption is the existing comparison by the numbers (`appraise`), widened from systems to any technology: a forklift,
  a self-service till and a casework system are weighed the same way.
- **AI is one technology among them,** distinguished only outside the world: a **scenario** gives its capability (the
  rows its templates have, their seconds and slip rates) and its cost (prices of the systems, and of the hardware they
  run on) over time, from day 0, as today's `falling-system-prices` scenario does (owner's ruling: capabilities come
  from an outside scenario for now). Nothing in the world knows which templates are AI.
- **Where suppliers are** is the profile's (owner's ruling): abroad (the outside's sellers, as `world.vendor` is) or
  local (firms of the town or a neighbouring place, which then hold their hardware somewhere on the network and draw
  its energy and water there).

### 7.3 Firms enter any industry where expected profit pays, capital-heavy ones included

- The Rust entry rule (expected profit, a start-up that employs when demand outruns one person) is widened from shops
  and small trades to **any industry in the world's catalogue**: an entrant weighs the expected margin it can see
  against the capital the industry's recipe needs (premises or land, equipment, inputs), borrowed or owned, over its
  horizon (Hopenhayn 1992; Dunne, Roberts and Samuelson 1988, both to confirm; proposed in the decisions log,
  2026-10-17).
- It needs two general things that are missing today: **commercial premises** (leasing a building, or buying land
  and building through planning, as anyone does: ME-1) and **finance for a larger venture** (credit as it exists, with
  its limits: ME-8).
- **So a data centre is just a firm** in an industry whose recipe turns energy, water, land (its footprint), hardware
  and staff time into capacity that it sells as a service to system suppliers (hosting, 7.1). It applies for a lot, a
  permit, a grid connection and a water connection through the same routes as a factory or a cold store, and competes
  with homes and farms on the same feeders and mains because laws 8 and 9 put them on one network. Whether it gets a
  firm or an interruptible connection, and what tariff, is the agreement it signs with the operator (2.1).
- Concentration among suppliers is whatever the costs make it (hardware is dear and lumpy, a data centre is large,
  exit terms and lost skills make leaving dear), measured from the log, never set. How a firm with few rivals prices is
  the general firm pricing rule, which has no term for market power today (ME-16): a general gap, not an AI one
  (decision 6).

### 7.4 Skills grow with use and fade without it, for every skill

- **Kernel:** a body variable may grow with use and fade without it. Each second a person performs a task tagged with
  a skill adds to it along a power law of practice (Newell and Rosenbloom 1981, to confirm); each day without use it
  fades toward a floor at a half-life (Arthur, Bennett, Stanush and McNelly 1998, a meta-analysis of skill decay, to
  confirm). The skill already scales how long work takes (`labour_by`); it scales a slip rate too where a source gives
  one. Fading is computed when read, from the last use (body variables already drift lazily), so it costs nothing a
  day.
- **Every task has its skill** (serving, building, casework, driving, teaching, bookkeeping), so a crew that has not
  laid bricks for a year is slower, and a town that buys a service it once did itself loses the skill. Taking work back
  is then slow and error-prone until relearned, or needs people who still have it, if any remain in reach (law 9). An
  office's know-how is its staff's skills (Bainbridge 1983, "ironies of automation", to confirm).

### 7.5 What is AI-specific, and why it is outside the world

Only two things, both outside, as measurement and boundary conditions always are:
1. **The scenario** of AI's capability and cost (7.2), a boundary condition set from day 0 (`docs/scenarios.md`), with a
   tag naming which templates and hardware kinds count as AI. The tag is read by measurement only; the backstop of
   law 12 grows to fail on any world code that reads it, as it does for the flags.
2. **The measures** that read logs, fixed before any experiment (added to `gradual-disempowerment.md` section 6):
   - **M7. What the town gives to AI.** Monthly: the share of the town's energy, water, land, grid and main capacity,
     capital invested and residents' working hours that goes to AI-tagged hardware, its hosts, their supply chains and
     the oversight of AI-tagged systems; and, in a shortage, who went short and why (position, contract, an operator's
     act), read from the settlements and the acts. This is Naz's point in the books: in a finite world, what goes to
     data centres and to AI work is not going to homes, farms and people's own work (Kulveit et al. 2025).
   - **M8. Who can still do the work.** For each kind of work AI-tagged systems do, the residents who could still do it
     and at what speed (their skill), month by month: the physical half of reversibility (M4).

Everything else the first draft had for AI is gone: the data centre structure type (a profile's industry now), the
in-world AI supplier module (entry), the person licensing an assistant (a service purchase), the data-centre scenario
as a special case (any large user's application is a starting condition like any other). The real chains (Dublin's grid
limits on new data centres from 2021; water disputes over data centres in Chile and Uruguay; Loudoun County's land and
transmission lines; all to confirm) stay as acceptance tests of the general laws, as the gradual-disempowerment
precedents are: each chain must be able to complete, never must.

### 7.6 Steps

| # | Step | Days |
|---|---|---|
| E1 | Services sold to anyone: the service agreement, sellers of services, households as buyers, papers in a buyer's name on a mandate (checked: no kernel change) | 3 |
| E2 | Technologies as goods with a capability: `runs_on` (P4), hardware as goods, adoption widened from systems to any technology; the AI scenario as one technology's capability and cost over time, with its measurement-only tag | 2.5 |
| E3 | Entry in any industry by expected profit, with commercial premises (leasing, building) and finance for larger ventures; capital-heavy recipes in the profiles (a hosting industry among them, with sourced energy and water per unit) | 5 |
| E4 | Skills by use and fading for every task; tasks tagged by skill; slip by skill where sourced; half-lives marked | 2.5 |
| E5 | Large users' routes as content: connection agreements (firm or interruptible) and the operator's study of a connection as work; water licences as law data; the acceptance chains | 2 |
| E6 | M7, M8; the backstop's check on the AI tag | 1.5 |

## 8. Order and size

**Why this order.** Law 11 first, in count mode, because every later step adds figures and should add them with their
basis from the first day, and counting changes no result. Law 10 next: it is the smallest and closes WM-14.
Then law 8, which brings the network into the contract for pipes and wires (C3); law 9 then adds roads, paths and
carriage to the same network, and is the largest step and the most disruptive to behaviour. Then the general economy
laws, which need all of them. Strict modes, the flags and empty inventories last. **The tag `pre-foundations-2` is
set on main before the first step that changes results** (phase 1's P1 or P3, whichever lands first), so that every
earlier run replays and re-runs its twins there.

| Phase | Steps | Agent-days | State hashes move? |
|---|---|---|---|
| 0. Record | N1, N2 (counting and reporting only) | 3 | No: logs byte-identical |
| 1. Capacity | P1, P2, P3, P5 | 4.5 | Yes, once (P3) |
| 2. Conservation, with the network for pipes and wires | C1 to C6, C3b, with the profiles' energy and water figures | 14.5 | Yes (C2, C3, C4) |
| 3. Space | S1 to S6 (S7 folded into C3) | 16 | Yes (S2 to S5) |
| 4. The general economy | P4, E1 to E6 | 17.5 | Yes (E1, E3, E4) |
| 5. Strict and whole | N3 to N6, L1 to L3; one rule page for laws 8 to 12, as `no-god-view.md` is | 12 | No |
| Measured before and after | each phase that moves hashes: 1,000 and 3,000 people, three towns, code only | 2 | |
| **Total** | | **about 70** | |
| After phase 4 | ME-16: market power in prices, a general pricing rule with a sourced term for rivals and switching costs | its own item | |

Sourcing figures beyond au-vic, gb-eng and us-oh (energy and water by industry, networks' ratings and heads, link
capacities, skill half-lives, casework minutes) is background work of about a day per profile per law, roughly
10 to 15 agent-days more if all nine are done; the rest stay marked, which law 11 now reports. Phases 0 and 1 can run
in parallel; 2 and 3 overlap after C3; three to four lanes at once would take about four to six weeks of calendar (the
first foundations' 20 agent-days were built in three days of calendar, so this is an upper estimate).

**What would stop us:** S3 and S5 making a 10,000-person year more than 1.3 times slower with no kernel fix; the
backstops needing a list of exceptions to pass (then a law is wrong somewhere, as the first foundations said); the
flags firing on most towns after phase 3 (then the next missing laws are behaviour, and it is a checkpoint with the
owner, not a chase); energy and water per unit of output unsourceable for most places (then two
sourced profiles carry the experiments and the rest are marked); the tree stand-in for networks giving shortages a
real town plainly would not have (then the next cheapest model, loops by a fixed number of passes, comes back to the
owner with its cost).

**Performance, in sum.** Every new mechanism is in Rust, in the kernel's crates (a network crate for links, routes,
trees and flows; connections in `world`), with integer ids, dense arrays and fixed-order reductions so that threads
cannot change a result. Estimated cost at 10,000 people: connections and the networks' two passes under 1%, standing
journeys and congestion 2 to 5%, carriage under 1% (deliveries are hundreds a day), skills under 1% (lazy fading),
services as much as the work they are (acts that are someone's hours, as all acts are), figures a second or two at load
and a counter an act. Together within 1.15 times today's 29-minute year, by estimate, with the stop rule above. The log
grows little because flows, rotations and journeys are standing declarations whose effects are state, not acts. None
of this touches SC-1's real cost (what each citizen keeps and weighs), which stays its own item.

## 9. For the owner

**Decided (owner, 2026-10-25), recorded here:**
- Capabilities and costs of AI come from an outside scenario for now; nothing in the world makes them better.
- AI suppliers are abroad or local, by profile.
- WM-14: a seat's body may be an officer of the outside world who is not a resident; a national officers-per-claim
  ratio is acceptable as a marked placeholder on a small town.
- No separate mechanism for AI helpers: they are systems sellers already deploy, bought as services (7.1).
- Shortages follow network physics, contracts in force and operators' acts only; no allocation rule in the kernel.
- The AI economy emerges from general laws; the only AI-specific parts are the scenario and the measures.

**Decided at approval (owner, 2026-10-25):**
1. Laws 8 to 12 become hard rules in `CLAUDE.md`, each line added when that law's enforcement and backstop land.
2. The outside world's supply is unlimited at its price, except named scarce kinds (a kind of hardware, a grid
   interconnector, water rights), given a quantity a period in the profile or a scenario and sold by the edge's offers.
3. The tree model for networks is accepted, as a known limit said in every result that reads a shortage.
4. Baselines move again; the tag `pre-foundations-2` goes on main before the first result-changing step.
5. Market power in prices (ME-16) is its own item after phase 4.
6. Several towns are opt-in; one town with its edge nodes is the default.
7. Law 12 is cut to a light aid that flags clearly broken states only: no real-world ranges, no held-out set, outside
   the world, never gating (section 6).

Nothing is open. New questions found while building go to the owner as they arise.

## 10. Sources

To add to `docs/research/references.md` ("Foundations 2") when built; unverified ones are marked (to confirm).
Physical accounting: the UN System of Environmental-Economic Accounting, Central Framework (2012), physical supply and
use tables (to confirm); Eurostat's economy-wide material flow accounts handbook (to confirm); Godley and Lavoie 2007
and Leontief (already cited). Networks: Wagner, Shamir and Marks 1988, *Journal of Water Resources Planning and
Management*, pressure-driven delivery (to confirm); Kersting, *Distribution System Modeling and Analysis*, radial
feeders (to confirm); Bureau of Public Roads, *Traffic Assignment Manual* (1964), the volume-delay function (to
confirm); Wardrop 1952 (to confirm). Figures and reliance: Morris 1991, *Technometrics*, elementary effects (to
confirm); Saltelli et al. 2008, *Global Sensitivity Analysis: The Primer* (to confirm). Economy: Hopenhayn 1992 and Dunne,
Roberts and Samuelson 1988, entry (to confirm); Acemoglu and Restrepo 2019 and Kulveit et al. 2025 (already cited);
Newell and Rosenbloom 1981 (to confirm); Arthur, Bennett, Stanush and McNelly 1998 (to confirm); Bainbridge 1983 (to
confirm). Figures for a hosting industry's recipe, in profiles: Shehabi et al. 2024, the United States data center
energy usage report; Li, Yang, Islam and Ren 2023, "Making AI less thirsty"; the Uptime Institute's annual data centre
survey; the International Energy Agency's *Energy and AI* (2025); all to confirm.
