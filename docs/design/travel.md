# Travel: the reserved shapes

Written 2026-10-17 (lane F of the Rust port). **Shapes only: no traffic.** The world can now say what travel will be
built on, so that worlds, profiles and tools can name roads and vehicles before anything moves along them.

- **Roads** (`travel.roads` in the world config): an id, the cells it runs through in order (each next to the one
  before), how many vehicles it carries an hour each way at most (`capacity_per_hour`), and optionally its lanes and
  how long one of its cells takes to cross. Checked when the world is loaded.
- **Vehicle types** (`travel.vehicle_types`): seats, load, speed.
- **Vehicles** (`travel.vehicles`): owned things. Each is of a declared type, owned by an entity of the world, and
  stands at a cell or in a structure; the state keeps them (`State.vehicles`, hashed with the state).
- **Positions in transit** (`State.transit`, keyed by body): from, to, when it set out, when it arrives, by which road
  and vehicle. Nothing puts anyone in transit yet: a visit is still the time it takes, spent where one set out.

What is not here, on purpose: congestion, routing, fuel, anyone driving. When traffic is built, it is physics in the
kernel (a road's capacity fills; a trip takes the time the road gives it), and who drives, owns and pays for vehicles
is institutions' work, as everything else is (docs/all-work-takes-time.md). A world without a `travel` section is the
world it was, to the hash.
