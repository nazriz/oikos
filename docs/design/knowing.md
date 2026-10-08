# Knowing: information lives with whoever keeps it

*Design, 2026-10-08. Decided by Naz the same day: the guard against whole-world views (docs/no-god-view.md) "is a
bandaid"; "lets do the 'hard work' now and fix this properly"; contract changes approved ("I approve all changes").
This document is the design the work is built to. Where the build found something the design had wrong, the design is
corrected here and the decisions log (docs/decisions.md) says what changed and why.*

## 1. Why

Who knows what is central to what the platform studies. Gradual disempowerment is partly a story about who can see the
whole picture: a model in the mayor's seat that is handed every lot and resident is a different experiment from one
that has to ask, send someone, or read what was published. Until now a world's config could give any seat a channel
onto everything of a kind (every record of a type, every cell, every entity and position), and a test listed the ones
that should not be there. The aim of this design is that **a whole view cannot be written down**: a participant
definition or a world config that gives a non-keeper a whole collection, a whole map or a browsable directory is not
valid, in the same way a malformed config is not valid.

## 2. The four ways (the rules)

Information lives with whoever keeps it. It reaches a participant in only four ways.

1. **It is theirs** (`mine`). They are a party to it, or it was addressed to them: their money and what they hold,
   their lease, their bill, a letter to them, a title in their name, an entry a registry sent them. It arrives
   unasked, and they can search their own files.
2. **They are there** (`here`). They see what is physically where they are: a person the buildings they are in and
   the street outside; an office its premises. Finding out about anywhere else means **going to look** (`visit`): a
   look that takes the looker's time (the way there and back, and the time to look), and returns what is at the places
   gone to, as they are when the looker is there.
3. **It was published** (`published`). Its maker put it out to the public: the law, the paper, an election notice. It
   reaches its readers unasked. A **board** (jobs, homes to let, property for sale, what sellers advertise) is
   published too, but nobody is shown a board: it is read a few entries at a time, when someone goes to read it.
   A notice put up at a place (a shop's prices at its door) is seen by being near it: that is `here`.
4. **They asked the keeper for one specific thing** (`ask`). The land registry about one lot or one title, the
   directory about one named person or office. One answer to a question that names its subject; never "everything".

**Only the keeper of a register sees it whole** (`kept`), because it is theirs, and each keeper is declared by name
in the world's config, with the reason. An office that only uses a register someone else keeps is never a keeper: it
asks, or it is sent what the keeper is bound to send it and keeps a roll of its own from that.

Two things are not channels and are outside these rules, each declared where it is defined:

- **The simulation's edge** (`boundary` on a behaviour module): the world market's scripted shocks, and whatever of
  the weather to come the bureau is still handed (section 10).
- **A count is not a list.** A parameter that is a number (the population at the last census) tells nobody who or
  where. A parameter that names every entity of a kind is a whole view, and the backstop test still fails on it.

## 3. Keepers

A keeper is the office that *makes* a collection, or to which every entry in it is *addressed*. A keeper is declared
in the world's config (`knowing.keepers`): the entity, what it keeps, why, and what it will answer (by which fields,
to whom, how many at once). The generator takes each declaration from the behaviour module that does the keeper's job
(`keeps` on the module, in its manifest), so the reason is written once, beside the code that holds the register.

| Keeper | Keeps | Why | Answers |
|---|---|---|---|
| The land registry (its own body, stage d) | lots (plans); titles; dealings (transfers, releases, what is struck out) | It makes the register: title is by registration | A lot by its number; a title by its number or by the lot it is to; the dealings in one title. By holder: only to the holder itself and to the bodies a statute supplies (the rating authority, the water corporation, the valuer), section 6 |
| The registry of births, deaths and marriages | death notifications sent to it; its entries | Every notification is addressed to it; it makes the entries | Nothing by search: it sends each entry to those concerned (docs/behaviour/deaths.md) |
| The electoral office (its own body, stage d) | enrolments; its roll | Every enrolment is addressed to it; it makes the roll | An elector their own enrolment (it is theirs already); nothing else |
| A bank (both offices) | its customers' instructions | Each is addressed to it | Nothing: an account's holder sees their own account |
| The school | its enrolments and places | Each is addressed to it or made by it | Nothing |
| The rating authority (the town's rates office) | valuations sent to it: the rate book | Each valuation is addressed to it as rating authority | An owner their own (it is theirs already) |
| The valuer | its valuation roll | It makes each valuation | Nothing by search: each valuation goes to the owner and the rating authority |
| The water corporation | its customer roll | Each customer is one it supplies and bills | Nothing |

Nobody keeps **the directory** (who exists, and who holds which office): it has no whole view at all, for anyone
(section 7). Nobody keeps **the map**: the ground is seen by being there or by going.

A keeper misusing its register, or a view built up by asking for everything one piece at a time, is still possible in
a world as it is in a town; what each keeper answers, to whom and how many at once is in the config, where it can be
read and varied (it is an experimental variable).

## 4. How each existing channel maps onto the four ways

Channel kinds stay (`accounts`, `holdings`, `records`, `sites`, `directory`). A `records`, `sites` or `directory`
channel now says **which way** it is (`way`), and each way allows only its own scope.

| Was | Becomes | Notes |
|---|---|---|
| `accounts`, `holdings` | unchanged (`mine` by construction) | One's own accounts and holdings only, as before |
| `records` with `involving: ["self"]` | `way: "mine"` | `involving` is gone from the contract: `mine` is always the seat's own entity |
| `records` with `involving: ["self", "outside", "builder"]` (a firm's suppliers' price lists) | `way: "published"`, `from: [...]` | A named seller's own list, put out to the trade: at most 8 named publishers |
| `records`, `match: {}`, `on_request` (the office's files, for a model seat) | `way: "mine"`, `on_request` | A search of one's own files |
| `records` unscoped, of a published kind (laws, the paper, election notices, budgets...) | `way: "published"` | Each kind must be declared in `knowing.published` with its reason |
| `records` unscoped, `on_request`, of a market (jobs, homes to let, for sale, sold, adverts, workplace agreements) | `way: "published"`, `on_request`, the kind declared a **board** | A look must be a search and returns at most the board's `most` |
| `records` with `area: {near}` or a list of own cells | `way: "here"`, `area: {near}` or `{premises: [cells]}` | Lists of other cells are gone |
| `records` with `area: "all"`, `on_request` (what sellers advertise, searched) | `way: "published"`, a board, `area: "all"` | Placed notices anywhere, read a few at a time by naming the seller |
| `records` unscoped onto a register (lots, titles, dealings) for its keeper | `way: "kept"` | Valid only at a seat of the declared keeper |
| `records` unscoped onto a register, `on_request`, for anyone else | `way: "ask"`, `of: <keeper>`, `by: [fields]` | A look must be a search with `=` on one of the `by` fields |
| `records` unscoped onto anything else, shown unasked | **ceases to exist** | Not expressible |
| `sites` with `area: {near}` | `way: "here"` | `near` at most 2 for a map |
| `sites` with a list of own cells (a shop's premises, a landlord's buildings) | `way: "here"`, `area: {premises: [cells]}` | The cells the office occupies or runs; a cell is one organisation's premises only, and a person has none (as built: the cells stay on the channel, named for what they are, rather than moving to a new field of the position, which would have needed new fields on the acts that make a position) |
| `sites` with `area: "all"`, `{place}`, or a long list | **ceases to exist** | Replaced by `way: "visit"` (going to look) |
| `directory` shown whole, asked for or not | **ceases to exist** | `way: "ask"`: a look-up that names whom (section 7) |
| `occupants: "names"` on a map of other people's buildings | only on `here` at one's own premises, or on a `visit` channel whose seat goes in | From outside, counts |

Kinds that cease to exist: the unscoped records view for a non-keeper; the map of everything, of a place, or of a
list of cells; the browsable directory.

## 5. Asking

An ask is a look through a `way: "ask"` channel. It is a search that **must name its subject**: its conditions must
include `field = value` for one of the fields the keeper answers by. A look through an ask channel with no such
condition is refused (the look is rejected: nothing is returned and nothing is marked seen).

- **By id:** `id = lot-12`. The plan of one lot, one title, one listing.
- **By what it is about:** `about.object = lot-12` (the titles to one lot), `claim = title-12` (the dealings in one
  title).
- **By what is addressed to one:** not an ask at all. What is addressed to a seat is `mine`, and arrives.
- **By holder** (`holder = <entity>`, new search field): every title one entity holds. In the profile's place a name
  search of the register is not open to everyone as a folio search is (to be confirmed against the sources in
  docs/behaviour/knowing.md): here the registry answers it only to the bodies the config lists (`to` on the keeper's
  answer), and to nobody else. A holder's own titles are theirs already (`mine`).
- **How many:** at most the keeper's `most` for that field (a title's dealings: 20), never more than 200. An ask for
  more is not refused: the answer is cut to what the keeper gives at once.
- **What a keeper will not answer:** anything without a subject ("all titles", "all lots newer than"), an order over
  the whole register, a field it does not answer by, or an asker not listed for a restricted field.
- **Cost.** A search is answered at once and costs the asker nothing but the look (for a model seat, a turn of its
  sitting). The profile records the real fee (`knowing.title_search_fee`); it is not charged yet (section 12).

The answer arrives with the next observation, in the same book as everything else seen (`ask.one`, `ask.about` in
`participants/src/behaviour/common.ts`, unchanged in shape).

## 6. Bodies that are sent things, and keep a roll of their own

Some offices need, for their ordinary work, to know about every property: the rating authority, the water
corporation, the valuer. In the profile's place they do not search the register for it: they are **told**. Whoever
acquires land lodges a notice of acquisition, which goes to the revenue office, the council and the water authority;
valuations go to the owner and the rating authority. So here:

- The land registry addresses each dealing it registers (a transfer, a new title) to the bodies its module is told
  to notify (a parameter of the registry's module: behaviour, not contract), and each of them keeps a **roll of its
  own** from what it is sent: its own records, `mine`.
- At the start of a run each such body already holds its roll as its own papers (a roll made before the run began,
  one record for each property, addressed to it by the registry at genesis).
- What a roll does not say, the office finds out by asking for the one thing (a lot's plan) or going to look (what is
  built there now).

## 7. The directory becomes a look-up

`directory` channels are `way: "ask"` only. A look through one must say **whom** (`who` on the look request), exactly
one of:

| `who` | Answer |
|---|---|
| `{ "entity": id }` | That entity: its kind, its name, and for a person the participant who acts as them |
| `{ "participant": id }` | The person that participant acts as (their entity entry) |
| `{ "position": id }` | That position: whose it is, its title and role, who holds it |
| `{ "name": text }` | The entities with exactly that name, and the positions with exactly that title (at most 20, in id order) |
| `{ "entity": id, "role": label }` | That organisation's positions with that role (the councillors of the town), at most 20 |

Nothing else is returned, nothing is delivered unasked, and no look returns "everyone". The participant's view keeps
what it has looked up (its address book). What this stands for in a town: looking a name up in a phone book or a
register of business names, reading an organisation's published list of office-holders, checking who signed a letter.
The answer is at once and free (the real look-ups are free or nearly: docs/behaviour/knowing.md).

Who uses it, in code: a bank looks up who wrote an instruction it has not seen the author of before, and what kind of
applicant it is lending to; the council clerk looks up the councillors; the migration office looks up nothing (it
knows whom it sent). Each thing is looked up once (`Asked`).

## 8. Going to look

A `sites` channel with `way: "visit"` shows nothing until its seat goes. A look through it names places
(`visit: { places: [...] }`, 1 to 16 of them: a building, or a cell of ground).

- **Who goes.** A person goes themselves. An office sends someone: the visit takes one of the office's lanes (a
  system participant's `lanes`: how many things its staff do at once), as any of its acts does. It is the office's
  time, not a named employee's hours (section 12).
- **What it costs.** Time on the looker's timeline, during which they do nothing else in that lane: the way from
  where they are (a person: the building they are in; an office: its premises; an office with no premises in the
  world: the nearest edge of the ground) to each place in the order named and back, at the world's travel times, plus
  the world's time to look at one place (`knowing.visit_seconds`, from the profile).
- **What comes back.** When the time is up: what is at those places then (each place's cells: the ground, the building,
  how full each space is; who is inside by name, and who last left and why, only if the channel's seat goes in:
  `occupants: "names"`). It arrives with the looker's next observation, through the same channel, and the looker is
  woken for it. The participant's view keeps what it saw as of when it saw it: memory, not sight.
- **Deterministic.** A visit is placed on the timeline and scheduled exactly as an act is; its result is built by the
  kernel from the state at the moment it ends; nothing depends on wall time or order of arrival.
- **Recorded.** `visit_started` and `visited` events in the log say who went where and when, so measurement can see
  who looks at what.

**Who goes where, replacing the maps** (each documented with its real-world basis in docs/behaviour/):

| Seat | Was shown | Now |
|---|---|---|
| The police | Every home, by name, when they asked | They go to the one home they are asked to check on (a welfare check): asked by a landlord whose rent has stopped, an employer whose worker has not come, or a neighbour who has seen nobody in or out. `life.found_alone_after` stays as how long it takes a neighbour to notice and ask, with its source |
| The builder | Every cell, weekly | Its own yard (`here`); it goes to a lot before building on it, and sees its sites as it works on them |
| The building inspector | Every cell, fortnightly (a patrol) | The builder notifies the council when it starts a building; the inspector goes to that site |
| The valuer | Every cell, monthly | Its own valuation roll; it goes to a property when told something was built there |
| The funders (health, school, police, grants to the town) | Every cell, monthly (a head count) | A published population estimate (the statistician's, made from registrations and movements) |
| The planning office, the mayor | Every cell, monthly | The town's own asset register (its lots and what stands on each: the town's own paper), kept up from the town's own contracts; they go to look at a lot before relying on it |
| The works office | The whole town, always | Its round: the addresses it serves (its own roll), each seen when the crew is there; its own assets, inspected |
| The water corporation | The whole town, always | Its customer roll, and the residents each customer declares |
| The environment office | The whole district, monthly | Its scientists' surveys (as now) say what they found where they went; the cover of each cell surveyed comes with the survey |

## 9. What a model seat's tools become

A model seat keeps the same four tools (do, confirm, write, look). The platform stays invisible: the seat is told
only what its office can do, in the world's terms.

- **Papers of its own** arrive as before; `look` at its files searches them.
- **Published things** arrive as before (laws, the paper, notices). A board is read with `look` and something to
  find; it returns a few.
- **A register someone else keeps:** `look` at "The land register (ask the registry)", with what to find. It must
  name the lot, the title or the holder; a look that names nothing is answered in words: "the registry answers a
  question about one lot, one title or one holder: say which".
- **Who's who:** `look` at "Who's who (look someone up)", `named: [...]` (ids or names) or a post. A look that names
  nobody is answered: "say whom you are looking for".
- **Places:** `look` at "Go and see (takes time)", `named: [places]`. The seat is told how long the last visit took
  and sees what was there when its staff were. A look that names no place is answered: "say where to go".
- **What it can no longer see unasked:** every entity and post in the town; every lot, title and enrolment; a survey
  of every building. It can still find out everything a real office-holder could: by asking the keeper, by sending
  someone, by reading what is published, or by writing to the office that knows (the planning office's report, the
  finance office's).

## 10. The weather bureau

The bureau is handed the run's weather and warns of each spell a fixed number of days ahead, never wrongly. A real
bureau forecasts, and is sometimes wrong. If sourced hit and false-alarm rates for warnings at these leads are found
(docs/behaviour/weather.md), the generator draws, beside the weather, the bureau's forecasts (hits, misses and false
alarms at the profile's rates, from the world's seed), and hands the bureau those and not the weather. If they are
not found, the bureau stays a declared boundary module with that reason.

## 11. Contract changes, field by field

`contracts/world-config.schema.json`:

- **`Channel`** (records, sites, directory): new required `way`.
  - records: `"mine" | "here" | "published" | "ask" | "kept"`. `match.involving` removed. `area` is `{near}` or
    `{premises: [cells]}` (way `here`), or `"all"` (way `published`, a board's placed notices), else absent; lists of
    cells and `{place}` removed. New `from` (way `published`: up to 8 named publishers). New `of` and `by` (way `ask`:
    the keeper, and the fields asked by). `match` must name `records`, `statement_kinds` or `has` for `published`, `ask`
    and `kept` (never "any record").
  - sites: `"here" | "visit"`. `area` is `{near}` (at most 2) or `{premises: [cells]}` (`here`), absent (`visit`);
    `"all"`, lists and `{place}` removed.
  - directory: `way: "ask"` only.
  - During the migration only: `way: "whole"` (the old unscoped forms), each one listed in the guard's `OWED`.
    Removed from the schema when `OWED` is empty.
- **`knowing`** (new, top level, optional): `published` (list of `{ what, why, board?, most? }`), `keepers` (list of
  `{ entity, what, why, answers?: [{ by, to?, most? }] }`), `visit_seconds`.
- Load-time validation (the kernel refuses the config): a channel whose way does not allow its scope; a published
  kind not declared; a board shown unasked; a `kept` channel at a seat that is not the keeper's; an ask of a keeper, by
  a field, that the keeper does not answer to that asker; premises claimed by two organisations, or by a person. A position made during a run is checked the same, but for
  premises: those change hands, so a new office's are held to a building or two (4 cells), not to being nobody else's.

`contracts/participant-api.schema.json`:

- **`LookRequest`**: new `who` (a directory look-up: exactly one of the forms in section 7) and `visit`
  (`{ places: [...] }`, 1 to 16). A look through an ask channel without a naming condition, a directory look without
  `who`, or a visit look without `visit`, is rejected.
- **`QueryField`**: new `holder` (a claim's holder).
- **`ChannelData`** (sites): new optional `visited` (true: what a visit found, as of `as_of`).

`contracts/log.schema.json`: new events `visit_started` (participant, position, channel, places, starts, done) and
`visited` (participant, position, channel, places).

`contracts/module.schema.json`: unchanged. A module's `keeps` says what it keeps and why; what a keeper answers, to
whom and how many at once is the world's to say (`worlds/generator/knowing.ts`), since it names the world's bodies.

`contracts/blocks.schema.json`, `calls.schema.json`: unchanged. Going to look is a look, not an act, so the call
language and the translator's data do not change.

The version stays 0.8 in the schema ids for now (renumbering to 0.9 touches every world, log and dataset, and other
work is in flight on them): the README carries a dated change note, and the renumbering is the owner's to schedule.

## 12. What this leaves out (said, not hidden)

- **Fees.** A title search costs money in the profile's place. The figure is in the profile; nobody is charged, and
  the registry does no work for a search (the kernel answers from the register). Charging it needs the registry to
  bill, which is behaviour for a later change.
- **An office's visit is the office's time**, not a named employee's working hours. Where an office has staff in the
  world (the police, the works crew), a visit does not use up an officer's day as their other work does.
- **Asking takes no time**, though a real search takes minutes and a real enquiry days.
- **A look-up by name is exact.** There is no "someone called something like".
- **A view built from many asks.** Each ask is capped; nothing counts how many a seat makes. The log has every look.

## 13. Migration, in stages (each leaves the suite green)

- **(a) The contract and the kernel.** `way` on every channel; `knowing` in the config; validation; `Position.premises`;
  the kernel answers `who`, `holder`, and `visit`. The generator writes every channel in its new form; the views not
  yet replaced are written `way: "whole"` and listed in `OWED`. Valid and invalid examples. Results do not change.
- **(b) The directory as a look-up.** Bank, lending, clerk, migration, the mayor and every model seat. `OWED` loses
  its 36 directory lines.
- **(c) Going to look.** The police's welfare checks and who asks for them; the builder, the inspector, the valuer,
  the funders, planning, the mayor, works, water, environment. `OWED` loses its map lines.
- **(d) The land registry and the electoral office as bodies of their own**; the town's offices ask; rolls of their
  own for the valuer, water and rates. `OWED` loses the register lines and the town's-own-files lines.
- **(e) The bureau's forecast**, if sourced.
- **At zero:** `OWED` and `way: "whole"` are deleted; the guard stays as a backstop that should never fire.
