# Nothing physical from nothing

Naz, 2026-10-25: realism gaps must become impossible at the kernel and platform layer, not fixed one at a time,
"eliminating the possibility of whack-a-moles". Law 8 of [design/foundations-2.md](design/foundations-2.md) (section 2);
each step is in the decisions log ("Foundations-2 phase 2"). This page is the rule, how it is enforced, and how to work
with it, as [all-work-takes-time.md](all-work-takes-time.md) is for time and [no-god-view.md](no-god-view.md) for
information.

## The law

**Every physical quantity is a declared kind, held somewhere, and changed only by:** a move by its holder; a process (a
task) whose recipe states what goes in and what comes out; nature's declared dynamics (a river's inflow, decay, flow:
nature's edge); or a world edge (the outside, which sells and takes at its price, without limit unless a scarce kind is
given a quantity a period). A building's variable is a condition (wear, disrepair), never a stock.

- **A kind has a class:** `stock` (conserved: water, materials, goods, waste), `dissipates` (energy, fuel: it may be used
  up with nothing out, as its heat leaves the books) or `service` (a unit of a service sold over a counter: no physical
  quantity).
- **A field may hold a kind** (a river's water): a draw from it goes into the drawer's holding; what is put on it is a
  process's output; nature's own day is counted on nature's edge.
- **What flows all day flows on a network** (connections, settled each hour or day on a tree of links from a supply).
  A household's use is what it sets its connection to, used at its home by a recipe (water in, wastewater out to the
  sewer; energy in, dissipated); a bill is read from a meter.
- **Who goes short follows from three things only:** the network's physics (a pipe loses head with its load and its
  height, a wire over its rating trips, a supply short of stock trips its own links), the supply contracts in force
  (content the kernel stores and never reads), and the operators' own acts (valves, interruptions, rotations, each priced
  in the table of work). There is no allocation rule in the kernel or in a module.
- **Every recipe at a workplace states its energy and water** (nought, with its basis, is allowed; silence is not).

## What the kernel enforces, and what it refuses

The kernel conserves every kind over holdings, fields, nature's edge and the edges (`kernel/tests/conservation.rs`,
`kernel/tests/network.rs`), and refuses:

| Refused | Why |
|---|---|
| Taking more of a kind than is held (`insufficient_quantity`); a holding below nought but an edge's | Nothing from nothing |
| A field that holds an undeclared kind, or counts one from anything but nought; two fields holding one kind (the world does not load) | A stock is counted from nought |
| An emit to a field that holds a kind past its most (`overflow`) | Nothing lost to a bound |
| A variable that grows by its occupants (`per_occupant_per_day`, `stock_as_variable`: the world does not load) | A variable is a condition |
| A connection on a node no supply of its kind reaches; a use that is not a recipe of the kind; a pressure supply without its heads (the world does not load) | Flow follows the network |
| An act on a connection or a link by someone not its operator (its user may set its own rate) (`not_theirs`) | Only whoever may |
| An edge selling a scarce kind beyond its quantity a period (`beyond_supply`) | The outside's limits are its own |

## The backstop

`orchestrator/test/nothing-from-nothing.test.ts`, in the fast tier (its audits in `test/lib/law8.ts`), generates the town
of every profile and reads the modules' sources, and fails, naming the kind, the variable, the recipe or the file, on:

| Found | Fails when |
|---|---|
| `stocksAsVariables` | a variable that grows per occupant, has a kind's name, or is read as a meter |
| `orphanKinds` | a kind consumed that no recipe, edge or nature makes; a kind made that nothing uses or takes |
| `silentRecipes` | a recipe at a workplace that does not state its energy and water |
| `billsWithoutMeters` | a parameter that is an assumed use a head, customer, household or home |
| `vanishing` | a draw from a field that holds no kind; a process whose only effect is to destroy a stock |
| `allocationRules` | code that shares out a shortfall by a rule of its own |
| `specialCasesLeft` | a special case a landed step deleted, standing again (`fixtures/foundations-2-inventory.json`) |

Each is planted in the second half and seen named. It should never fire: a failure means a way round the law was found,
which is a finding to report.

What nothing can see: a kind nobody thought of (a world with no notion of a thing cannot conserve it); whether a
recipe's figures are right (each has its basis, law 11); whether the network's stand-in physics is close enough (trees,
linear losses, ratings and trips: the known limits, foundations-2 2.6).

## Working with it

**When something appears, disappears or is used without a cause: that is a missing law, never a case to patch.** Ask
what the thing is, who holds it, and which process makes or uses it; give it a kind and a recipe, and the network or the
edge it comes by. Do not add a variable that grows by itself, a figure a module assumes for use, or a share-out of a
shortfall. A gap is a missing law: find which of the rules above it falls under, and make the world say it.

**To add a kind.** Declare it in the catalogue with its unit and class; say what makes it (a recipe, an edge's offer,
nature) and what uses it; if it flows all day, give it a `settle` and a supply on the network.

**To connect something.** Its operator opens a connection on its node (`connection`, op `open`), with the rate its user
asks; its user sets the rate (`set`); the operator closes, interrupts and restores it. A shortage is then the network's
and the operator's to answer: a rotation, an interruption under an interruptible agreement, a protected list.
