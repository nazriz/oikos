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
- **On the way** (S3, 2026-10-31; `State.transit`, keyed by body). An act that takes a body to another building puts it
  on its way when the act starts (it leaves its space then) until the act is done (it enters the new one then), with
  its vehicle, which stands with the body (no one else can take it). A body on its way is in no building: the presence
  checks refuse whatever would be done to it or by it at a place. A move refused when it is done brings the body back
  where it set out, into the space it left if there is room. A person's visit is a trip there and back. A person knows
  where they are going and when they get there (`body.on_way`).

- **Goods carried** (S4, 2026-10-31). In a world one travels, goods between two buildings go only with a carrier: the
  acting person (`move_goods` `carried`) or someone the actor may direct (`carrier`), driving a vehicle if named. The act
  takes the carrier from where it is by where the goods are and where they go, and back where it set out unless the act
  takes it into a building; its trip is the act's time and the carrier's own; when it is done the carrier has been by
  both, and the goods are there (they land when the carrier is back: a trip's liberty). Refused `not_carried` with no
  carrier, `not_present` if the carrier was not by both. A `work` on a building other than where it is done takes each
  performer there and back the same way: a crew goes to the site, a collection round goes by each home. To or from an
  edge's outside, goods go by the outside's freight: in the time it takes from the edge's node (the network's travel
  links, a road out of the town to it: `speed_kmh` on a link) to the door, on their way meanwhile (`goods_moved`
  `arrives`; still the world's, counted in the conservation property); at once where the world has no node for the edge.
- **The way out.** The generator joins the street end nearest the town's west edge to a node off the ground by the road
  out (the profile's `round.outside` distance and speed), and every edge's node to it.

Still to come (foundations-2 3.4): , link flows, congestion and a vehicle's
energy from its holding (S5), several towns (S6).
