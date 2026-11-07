# Everything physical is somewhere

Naz, 2026-10-25: realism gaps must become impossible at the kernel and platform layer, not fixed one at a time. Law 9 of
[design/foundations-2.md](design/foundations-2.md) (section 3); each step is in the decisions log ("Foundations-2 phase
3", "S2" to "S6", and "Foundations-2 phase 5: law 9's last findings"). This page is the rule, how it is enforced, and
how to work with it, as [nothing-from-nothing.md](nothing-from-nothing.md) is for physical quantities,
[all-work-takes-time.md](all-work-takes-time.md) for time and [no-god-view.md](no-god-view.md) for information.

## The law

**Every body, holding, vehicle and machine is somewhere, and moves only along a network, taking time, capacity and the
mover's energy.**

- **A body** is in a space of a structure, or on its way along links (in transit, in no building, its vehicle with it).
- **A holding** is at a structure, in a vehicle (its tank, its load), or at an edge's own outside.
- **A system** is where the hardware it runs on is held (its template's `runs_on`: at a structure, or an edge's own
  outside). One whose template names no hardware runs on its supplier's own machines, abroad: only an edge supplies one.
- **A vehicle** stands where its last trip left it, and runs on a kind the world holds, drawn from its tank by the metres
  driven; with too little, it is left and the trip walked. Tanks are filled by driving to where the fuel is.
- **Goods between two places are carried**: by a body both places' acts take there, a vehicle and its driver, or the
  outside's freight from the edge's node. **A crew works where the work is**, having gone there.
- **A way** (a road) is links of the network with a speed and a capacity an hour; a full link holds a vehicle to the
  next hour, and a driven leg's time follows the volume-delay form (BPR).

## What the kernel enforces, and what it refuses

| Refused | Why |
|---|---|
| A body in two places, or acting where it is not (`kernel/tests/space.rs`) | One place at a time |
| Goods between buildings with no carrier (`not_carried`) | Goods are carried |
| A vehicle driven by someone not let drive it, or from where it is not | A car is where it stands |
| A system that runs on nothing held anywhere: its template names no hardware and its supplier is no edge (`unlocated`, the world does not load; `unknown_place` on `deploy`) | A machine is somewhere |
| A template's hardware held at no structure (nor its holder's own outside, for an edge) (`unlocated`) | A machine is somewhere |
| A kind of vehicle with no fuel, no use of it a hundred kilometres or no tank (`moves_for_nothing`, the world does not load) | Nothing moves for nothing |
| An edge with no node in a world with a network (the backstop) | What the outside sells arrives somewhere |

## The backstop

`orchestrator/test/everything-is-somewhere.test.ts`, in the fast tier (its audits in `test/lib/law9.ts`), generates the
town of every profile and reads the modules' sources; `everything-is-somewhere-runs.test.ts`, in the slow tier, reads a
month of each town's log. They fail, naming what is wrong, on:

| Found | Fails when |
|---|---|
| `unlocated` | a body in no space at the start, a holding at no place, a system with no place |
| `edgesWithoutNode` | an edge that is no node of the world's network |
| `waysOffNetwork` | ground crossed quicker than on foot (a way that is no link) |
| `movesForNothing` | a vehicle that uses no energy, a way with no capacity |
| `uncarried` | a module's move of goods that names no carrier |
| `uncarriedMoves`, `workElsewhere` (a month's log) | goods moved between places with no carrier; work on a building elsewhere with its crew where they were |
| `specialCasesLeft` | a special case a landed step deleted, standing again (`fixtures/space-inventory.json`) |

The inventory (`fixtures/space-inventory.json`) only shrinks. **One finding is left in it, waiting on the owner:** the
unhoused, who at the start are in no space (households the town could not house; the kernel lets a body with no
building travel in no time). Where a person with no home is (sleeping rough, a shelter, a car, a friend's floor) is a
law the world does not yet have; it is not a case to patch (docs/risks.md, WM-16).

## Working with it

**When something is nowhere, or gets somewhere without going: that is a missing law, never a case to patch.** Ask where
the thing is, who holds it, and how it gets from one place to another (who carries it, along what, in what time); then
make the world say it. Do not add a place that is no place (a holding at an id that is no structure), a move with no
carrier, or a system that runs on nothing.

**To add a kind of vehicle.** Give it its fuel (a kind the town sells; the generator keeps a seller of it where
households drive), its use a hundred kilometres and its tank.

**To add a system.** Say what it runs on (`runs_on`: hardware held at a structure, the recipe of an hour of its work),
or, if it is the outside's or is sold as a service from abroad, let an edge supply it.
