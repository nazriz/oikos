# Travel: ways, vehicles and trips

Written 2026-10-17 (lane F of the Rust port) as reserved shapes; made physics by foundations-2 phase 3 (law 9,
docs/design/foundations-2.md section 3), step by step. What stands today:

- **Ways** (S2, 2026-10-31). A structure type may be a way (`way`: its mode, what a link of it carries an hour each way,
  its speed for vehicles). Standing and complete, each of its cells is a node, joined to the next cell's node of the same
  mode by a link a cell long (the ground's `cell` metres). The ways are worked out from the standing structures once for
  the ground as it is, again when a way is finished or comes down (`kernel/crates/world/src/ways.rs`). A road the town
  builds joins the ways when it is finished.
- **A trip** goes on foot over the cells to the node nearest where it sets out, along the links (driven at the lower of
  the vehicle's speed and the link's, or at walking pace), and on foot from the node nearest where it is going; or on
  foot over the cells all the way, whichever is quicker (`travel.rs`). Off the ways a cell costs what its cover says, as
  before; no cover is quicker than walking any more (a road is a way, not a cheap cell).
- **Vehicle types** (`travel.vehicle_types`): seats, load, top speed.
- **Vehicles** (`travel.vehicles`): owned things, each of a declared type, owned by an entity, standing at a cell or in a
  structure, with who besides its owner may drive it (`drivers`). An `occupy` names the vehicle it goes by
  (`vehicle`, the call's `by`): refused unless the body may drive it and it stands where the body sets out; the vehicle
  then stands where the body arrived. Who goes by what is theirs: a citizen takes a vehicle of theirs that stands where
  they are, and walks if another of the household took it.
- **Positions in transit** (`State.transit`, keyed by body): reserved until S3, which puts bodies on the way.

Still to come (foundations-2 3.4): bodies in transit (S3), goods carried (S4), link flows, congestion and a vehicle's
energy from its holding (S5), several towns (S6).
