# Nobody has a god's view

Naz, 2026-10-08: "no entity should have a god like view of anything"; shown what remained, "lets please eliminate all
whole-world views, like, tbh this should never be allowed to happen"; and of the guard that listed them, "a bandaid ...
lets do the 'hard work' now and fix this properly".

The design is in [design/knowing.md](design/knowing.md); how a real place does each thing, with the sources opened,
is in [behaviour/knowing.md](behaviour/knowing.md). This page is the rule, how it is enforced, and how to work with it.

## The rule

**Information lives with whoever keeps it, and reaches a participant in only four ways.**

1. **It is theirs.** They are a party to it, or it was addressed to them: their money and what they hold, their
   lease, their bill, a letter to them, a title in their name.
2. **They are there.** They see what is physically where they are: a person the buildings they are in and the street
   outside; an office its own premises. Finding out about anywhere else means **going to look**: a look that takes the
   looker's time (the way there and back, and the time to look) and returns what is at the places gone to.
3. **It was published.** Its maker put it out to the public (the law, the paper, a notice), and it reaches its
   readers. A board (jobs, homes to let, what sellers advertise) is published, but nobody is shown a board: it is read
   a few entries at a time.
4. **They asked the keeper for one specific thing.** The land registry about one lot or one title, the directory about
   one named person or office. One answer; never "everything".

**Only the keeper of a register sees it whole**, because it is theirs, and each keeper is declared by name with the
reason: in the behaviour module that does the keeper's job (`keeps`), and from there in the world's config
(`knowing.keepers`), which the kernel checks every channel against. An office that only uses a register someone else
keeps is never a keeper: it asks, or it is sent what the keeper is bound to send it and keeps a roll of its own.

One exception is not a channel and is declared where it is defined: **a boundary module carries the simulation's own
edge** (`boundary` on the module): what the world market is handed of a scenario's scripted shocks, and what the
weather bureau is handed of the weather to come (docs/behaviour/boundary.md, weather.md).

**A person's own record is theirs and nobody else's** (docs/design/ai-citizens.md 10d): who they are, what they trust,
what they think of whoever holds power over them. The one channel that shows a record (`own_record`) has no field that
could name anyone, the kernel shows through it only the looker's own, and no keeper keeps records: there is no
register of minds. What others know of a person is what that person says and does.

## How it is enforced

**It cannot be written.** A `records`, `sites` or `directory` channel says which way it is (`way`), and each way
allows only its own scope (`contracts/world-config.schema.json`, `Channel`):

| Way | What a channel of that way may be | What it may not |
|---|---|---|
| `mine` (and accounts, holdings) | Records naming the seat's own entity | Records naming anyone else (`involving` is gone from the contract) |
| `here` | The ground, or notices put up, near where the seat is (`{near}`; a map at most 2 cells around) or at an organisation's own premises (`{premises: [cells]}`; one organisation's only), or the ground of premises it holds by an agreement in force (`{held: "occupancy"}`: a unit it leases; nothing until it holds one) | Everywhere, a place, a list of other cells |
| `visit` | Nothing until a look names 1 to 16 places; then what was there, after the time it takes | A standing map |
| `published` | Kinds the world declares published (`knowing.published`, each with its reason); a board only on request, by searching, a few at a time; a named supplier's own lists (`from`) | A kind nobody published; "any record"; a board shown |
| `ask` | A register its declared keeper keeps, on request, to a search that names its subject by a field the keeper answers by, to that asker; the directory, to a look-up that says whom | The register shown; a search with no subject; a field the keeper does not answer by (the land register by holder, for anyone not listed) |
| `kept` | A register, whole, at a seat of its declared keeper | The same at any other seat |

The JSON Schema rules out what a schema can (twelve examples in `contracts/examples/invalid/world-config`); the
kernel refuses the rest when a world is loaded and when a position is made during a run (nine examples in
`contracts/examples/refused/world-config`; `kernel/crates/contracts/src/config.rs`, `check_channels`). A look that
asks a register for everything, reads a board through, looks nobody up, or goes nowhere is rejected before it reaches
the log (`kernel/tests/knowing.rs`).

**The backstop.** `orchestrator/test/no-god-view.test.ts`, in the fast tier, generates the town (as code seats, and
with every office handed to a model) and reads its config with `wholeViews` (`orchestrator/src/views.ts`) for what
the contract cannot see:

| Way in | Whole when |
|---|---|
| A `kept` channel | always: it must be a declared keeper's, and the test lists every one |
| A seat's own files (`mine`, shown as they come) | they hold, at the start, at least 25 records of a collection and nine tenths of all there are (everything a registry issues names the registry: which is why the land registry and the electoral commission are bodies of their own, and why a notice of acquisition is addressed to nobody) |
| Premises | they are half the ground or more |
| A parameter the module is handed | it names every entity of a kind there are five or more of, or every such entity's account (`every:shop`); or it holds a list of things dated after the start (`future`) |

Each whole view found must be a keeper's (`keeps`) or a boundary module's (`boundary`), listed in the test (`KEEPERS`,
`BOUNDARY`); otherwise the test fails, naming the module, the channel or parameter and one seat that has it. It also
fails on a declaration nothing needs any more. It should never fire: a failure means a way round the contract was
found, which is a finding to report.

What nothing can see: what a keeper does with its register; a view built up by asking for one thing after another
(each answer is capped, and the log has every look); a world written by hand that declares everything published
(`knowing.published` is in the config for a reader to argue with).

## Working with it

**To find out what someone else keeps** (`participants/src/behaviour/common.ts`):

- `ask.one(channel, id)`, `ask.about(channel, field, value, { most, ... })`: one named thing of a register.
- `ask.board(channel, { most, where, by })`: a reader's few of a board.
- `lookUp.entity / participant / position / name / holders(channel, ...)`: who someone is, or who holds an office.
- `goSee(channel, places)`, then `visited(obs, channel)`: going to look.
- `ownerLooks(book, asked, register, lot)`, then `ownerOf(book, lot)`: who owns one lot, by the register.
- `ownLand(book, owner)` (`behaviour/institutions.ts`): an organisation's own land, by its own papers.
- `ctx.chance(purpose)`: a draw that is the same for whoever makes it (how long a silent house goes unremarked).
- `Asked`: remembers what has been asked, so each thing is asked once.

Return them from a stepper's `looks` (`behaviour/firms.ts`) or as a `look` action. An ask, a board and a look-up are
answered with the next observation, at once; a visit when the looker is back. Work done on a building returns what
the crew left (`outcome.seen`).

**To give a seat a channel** (`worlds/generator/knowing.ts`): `mine`, `published`, `board`, `from`, `posted`,
`premises`, `held`, `around`, `visits`, `ask`, `lookUp`, `kept`. There is no helper for anything else.

**To declare a keeper.** Only for a collection the office itself makes, or that is addressed to it entry by entry.

1. On the module, add to `keeps` what it holds (`what`: a statement kind, statements having something as
   `has:registry`, a record type as `records:claim`) and why, in a sentence a reader outside the code would accept.
2. Run `bun participants/scripts/manifests.ts`.
3. Say what it answers, to whom and how many at once in `answersOf` (`worlds/generator/knowing.ts`); nothing there:
   it answers nothing.
4. Add the line to `KEEPERS` in `orchestrator/test/no-god-view.test.ts`.

If the honest reason is "it needs to look things up in it", it is not a keeper: give it `ask`.

**To publish a kind.** Add it to `PUBLISHED` (`worlds/generator/knowing.ts`) with the reason; a market is a board.
