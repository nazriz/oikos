# Nobody has a god's view

Naz, 2026-10-08: "no entity should have a god like view of anything"; and, shown what remained: "lets please
eliminate all whole-world views, like, tbh this should never be allowed to happen".

## The rule

No kind of participant (a person, a firm's office, a public office, a model seat, the outside world's offices) is shown,
unasked, a whole register, a whole population or a whole map, and none is handed the run's future. A participant is
shown **its own**: its money and what it holds, the records that name it or are addressed to it, the premises it
occupies and what is near where it is. Anything else it needs, it finds out as its real counterpart would: it **asks
whoever keeps it for the one thing** (a lot's plan from the land register by the lot's number; one shop's price list;
the agreements at its own workplace), it **is told** by someone with a reason to tell it (a family reports a death; a
registry writes to those concerned), it **reads what is published** (the law, the paper, a public notice), or someone
**goes and looks**, at the cost in time that takes.

Two exceptions, each said in the code where the kind of participant is defined, with the reason in words:

- **A keeper holds its own register whole** (`keeps` on the behaviour module): the land registry its register, the
  electoral office its roll, a bank its customers' instructions, a school its roll, the rating authority its rate book.
  A keeper is the office that *makes* the collection or to which every entry in it is *addressed*. An office that only
  uses a register someone else keeps is never a keeper: it asks.
- **A boundary module carries the simulation's own edge** (`boundary` on the module): the weather bureau is handed the
  weather to come and the world market a scenario's scripted shocks, because in this simulation they *are* the weather
  and the outside market. They are declared so that they are seen, not silently exempt (docs/behaviour/boundary.md and
  weather.md say what a real bureau or market would know instead).

**What is published is read, not kept.** A record its maker puts out to the whole public (the law, an election notice,
the paper, a weather warning, a notice of a gathering) may be shown to anyone unasked: being shown it is being one of
its readers. The kinds that count are listed, each with its reason, in `PUBLISHED` (`orchestrator/src/views.ts`). A
**market is not a publication**: every seller's prices, every home for sale or to let, every job on offer are many
parties' offers, found by going and looking (a search of a few, or the shops one knows), never shown whole.

## How it is enforced

`orchestrator/test/no-god-view.test.ts`, in the fast tier (`bun run test:fast`), generates the town (as code seats, and
with every office handed to a model) and reads its config with `wholeViews` (`orchestrator/src/views.ts`). A whole
view is, mechanically:

| Way in | Whole when | Not whole when |
|---|---|---|
| A `directory` channel | always, asked for or not (it is every entity and position, and cannot be searched) | never |
| A `sites` channel, asked for or not (a map cannot be searched) | its area is `all`, a place, or half the ground or more | a list of its own cells; `near` where it is |
| A `records` channel shown unasked, with no `involving` | for each kind or record type it names (all records, if it names none) | the kind is `PUBLISHED`; or the channel has an area of its own cells or `near`; or it is shown only on request (a search) |
| A `records` channel with `involving` (its own files) | it holds, at the start, at least 25 records of a collection and nine tenths of all there are (the town's offices were shown every lot, because the town issued them) | otherwise |
| A parameter the module is handed | it names every entity of a kind there are five or more of, or every such entity's account (`every:shop`); or it holds a list of things dated after the start (`future`) | otherwise |

Accounts and holdings channels show only one's own, by the contract. Each whole view found must be a keeper's
(`keeps`), a boundary module's (`boundary`) or published; otherwise the test fails, naming the module, the channel or
parameter and one seat that has it. The test also lists every `keeps` and `boundary` declaration (`KEEPERS`,
`BOUNDARY`), so adding one means changing the test, where a reviewer sees them all together; and it fails on a
declaration that nothing needs any more.

`OWED` in the test is the list of whole views found when the guard was written and not yet removed. It only shrinks: a
new view cannot be added to it without a reviewer seeing the diff, and a line whose view is gone must be taken out.

What the test cannot see: what a module does with what it is shown (a keeper misusing its register), a view assembled
by asking for everything a piece at a time (each search is capped by the contract at 200 records and by the module's
own `search_limit`), and worlds written by hand rather than generated (it reads the generated town; `wholeViews` can
be run on any config).

## The right way: `ask`

`participants/src/behaviour/common.ts` has the one way for behaviour code to find out what someone else keeps:

- `ask.one(channel, id)`: the one record with this id;
- `ask.about(channel, field, value, { most, since, standing, newest })`: the records that say something of one
  thing (one shop's price list by `speaks_for`; the dealings in one title by `claim`; one workplace's agreements);
- `ask.board(channel, { most, where, by })`: the few a reader would read of a board (listings, the petitions board);
- `Asked`: remembers what has been asked, so each thing is asked once.

Each is a search through a channel of the participant's own that is shown **only on request** (`on_request: true` in
the world's config), answered with what matches now. Return them from a stepper's `looks` (`behaviour/firms.ts`) or
as a `look` action; the answer arrives with the next observation, in the module's book.

## How to declare a keeper

Only for a collection the office itself makes, or that is addressed to it entry by entry.

1. On the module (`participants/src/behaviour/…`), add to `keeps` what it holds (`what`: a statement kind, a record
   type as `records:claim`, `directory`, `map`, `every:<kind>`) and why, in words a reader outside the code would accept.
2. Run `bun participants/scripts/manifests.ts` (the declaration is part of the module's manifest:
   `contracts/module.schema.json`, `keeps` and `boundary`).
3. Add the line to `KEEPERS` in `orchestrator/test/no-god-view.test.ts`.

If the honest reason is "it needs to look things up in it", it is not a keeper: give it the channel `on_request` and
use `ask`.
