# The call language (contracts v0.4)

A **call** is a structured intent: what a participant wants to bring about, named as a physical outcome, with the inputs the participant supplies. A translator turns plain language into calls, and code participants write them directly. The **resolver** turns a call into the participant's own acts (blocks). The full design and its reasoning are in [docs/design/translator-and-resolver.md](../docs/design/translator-and-resolver.md). This file is the reference, and [calls.schema.json](calls.schema.json) is the parsed form.

## Syntax

```
program  := line ( NEWLINE line )*
line     := [ NAME "=" ] call
          | "none(" LABEL ")"
call     := FUNC "(" [ arg ( "," arg )* ] ")"
arg      := KEY "=" value
value    := ID                    e.g.  lot-00-00   cell.3.4   apts-3/dwelling.2   acc-city   rec.412
          | NAME                  a variable bound on an earlier line of the same program
          | STRING                "…"  copied text: amounts, durations, free text
          | JSON                  {…} or […]: structured data (integers only), for statement data and claim contents; a list of ids (["a","b"]) where an argument takes several
          | call                  a nested call: an agreement's commitments (we_do, they_do)
```

- **One program is one atomic act.** Its lines are independent calls, or bindings the later lines refer to (things the participant creates itself in the same act).
- **One program is done in one capacity:** as the participant itself, or in one position it holds. The capacity is on the action (`as`), not in the calls: an act is one person doing one thing, in one role.
- **Ids are bare, and copied text is quoted.** Inside a quoted string, `\"` is a quote and `\\` a backslash. No id has a capital letter, so a bare word with one (`GreenCo`) is read as a name, as if quoted.
- **Keyword arguments only.**
- **Zero arithmetic.** Amounts and durations are always quoted text, converted by the parser's tables:
  - amounts, in the world's currency as its config writes it (`world.currencies`, the first: its `symbol` or code, its `unit_words` and `minor_words`, its `minor_units`), to an integer in its smallest unit. In a world whose currency is written `$`, with two decimal places and the words "dollars" and "cents": `"$500"`, `"$1,234.56"`, `"60k"`, `"$1.5k"`, `"$2m"`, `"500 dollars"`, `"250 cents"`. In one written `¥` with none: `"¥500"`, `"1.5k yen"`. With only a code: `"XYZ 500"`, `"500 XYZ"`. Bare digits are whole units; the multipliers are k, m, b, t and thousand to trillion; nothing finer than the smallest unit is read, and another currency's sign or words aren't an amount. (The examples below are written in the first of these.)
  - durations: `"30 days"`, `"2 weeks"`, `"monthly"`, `"fortnightly"`, `"every 3 months"` → seconds. The world has no calendar: a month is 30 days and a year is 365.
- **Every call is checked against the argument table below** (the parsed form's schema, calls.schema.json). An unknown or missing argument means the call is refused as unclear; it is never silently ignored.
- **`none(LABEL)`** is the translator's refusal, with one of seven labels: `not_yours`, `needs_calculation`, `too_much`, `unclear`, `unknown_form`, `no_such_act` (what's asked is clear, and no function here brings it about: holding a standing arrangement to resume it later, going somewhere to see for oneself, changing what an office does of its own accord; added 2026-10-06, when a fifth of the pilots' real requests turned out to be of this kind and were being forced into the nearest function), `not_an_act` (the request is to see, read or check something, not to bring anything about: looking is the participant's own to do, with what it's shown; added 2026-10-05, when a sixth of the pilots' failed requests turned out to be of this kind and were being answered "it isn't clear what should happen").

## Functions

Each function names a physical outcome. The resolver decides nothing on the participant's behalf: missing decisions come back as questions; single physical answers are filled in; whoever else must physically act is asked (a `request`) or offered an agreement.

| Function | Arguments (`*` required) | Resolves to |
|---|---|---|
| `money` | `to*` (account or entity), `amount*`, `from`, `every`, `first`, `for`, `settles`, `basis`, `per_request` | `transfer` if the entity it acts for keeps `from` (`per_request` links the request it carries out); otherwise a `request` to its keeper, citing `basis` |
| `goods` | `kind*`, `quantity*` (a count), `to` (default: yourself), `at` (where to; required), `from_at` (where from; the one place you hold that kind, if there's just one), `every` (in a commitment), `for` | `move_goods` of your own goods (phase B). Someone else's goods are asked for (a request, or `they_do=goods(...)` in an agreement: a goods outcome) |
| `work` | `task*`, `units*` (a count; for a survey, the cells' count by default), `at*` (where it's done), `by` (who: one id, or a JSON list; none: work that takes nobody's time), `on` (what it's done to: a building being built or demolished, a structure a task changes, or, for a task done to bodies, a person there or a space of it: everyone in the room), `survey` (a species or field, for a task that surveys) with `cells` (a list), `investigate` (whose goods were taken, for a task that investigates) with `taken_at` (where) and `kind` (what) | `work` (phase B). The kernel checks the people are there with time left in the day, and the inputs are held there. A survey's estimates come back to the one who surveyed only |
| `account` | `holder`, `at`, `close` | `open_account` / `close_account` if the entity it acts for keeps it; otherwise a `request` to `at` |
| `structure` | `type`, `on` (a lot or a cell), `by`, `price`, `from`, `basis`, `remove`, `materials_at` | `construct` / `demolish` if `by` is the entity it acts for (the materials from your own holding at `materials_at`; the building work is then `work`); otherwise an offered construction agreement to `by`, paid `from` an account. On a lot, the footprint's corner is filled in when exactly one fits the lot's open ground; otherwise it asks which cell |
| `occupancy` | `in*` (a space, or a building), `who`, `leave` | `occupy` / `vacate`. A building with one space is that space; otherwise it asks which. `who` is a body brought or removed (default: its own person) |
| `entity` | `kind*`, `name*`, `visible`, `position`, `channels`, `role_module` | `create_entity`; `position` is the title of the new organisation's first position, held by the participant (otherwise nobody could ever act for it); `channels` and `role_module` are that position's, as for `position` (v0.5: someone founding a business holds a position that sees and does what the business needs) |
| `claim` | `holder`, `position`, `against`, `about`, `basis`, `transfer`, `to`, `release`, `visible` | `record_claim` / `transfer_claim` / `release_claim` |
| `agreement` | `with`, `template`, `terms`, `we_do`, `they_do`, `term`, `our_notice`, `their_notice`, `then`, `basis`, `visible`, `sign`, `notice`, `text` | An offer: `propose_agreement` plus its own `sign_agreement`. `then=periodic`: it continues after its term until ended by notice. `sign=<agreement>` signs one; `notice=<agreement>` gives notice |
| `statement` | `kind`, `text`, `to`, `visible`, `basis`, `for`, `data`, `adico`, `formal`, `offer`, `practice`, `on`, `withdraw` | `publish` / `withdraw` (`adico` is the Institutional Grammar breakdown as data; `formal` a CEL condition, as text; `offer` what someone may take up and on what terms, and `practice` a recurring situation people take part in, both as data in the contract's typed vocabulary (blocks: Offer, Practice); `on` a lot to put it up on, where it's seen by those nearby) |
| `vote` | `ballot*`, `choice*`, `visible` | `vote` |
| `message` | `to*`, `text*`, `re` | `message` |
| `form` | `form*` (its name, or its record's id; in ordinary words too: "permit application"), `to` (whose form: needed only when more than one office has a form by that name), plus the form's own fields | `publish` of the form's statement kind, with its fields checked against the form. A form the participant hasn't seen is said to be that, whatever else is given |
| `presence` | `who`, `name`, `age`, `sex`, `template`, `carrying`, `variables`, `leave` | `arrive` (at the boundary: a newcomer with `name`, `age`, `template` and, where the world models it, `sex`, carrying money, with their body's `variables` (a JSON object: their schooling, say); or `who` returning) / `leave` (its own body, or `who` removed) |
| `birth` | `name*`, `template*`, `with` | `birth`: its own person conceives a child, with another parent `with` if named |
| `take` | `kind*`, `quantity*`, `from*` (whose), `at*` (where: a structure the body is in) | `take`: goods another holds, without their consent (crime) |
| `harm` | `who*` | `harm`: its own body harms someone near it |
| `position` | `title`, `role`, `channels`, `role_module`, `appoint`, `to`, `vacate` | `create_position` (a new position of the organisation it acts for); `appoint=<position>, to=<participant>` → `appoint`; `vacate=<position>` → `appoint` of nobody |
| `system` | `template`, `title`, `retire` | `deploy` a system participant from a template / `retire` one |

**Common argument meanings:**
- `for`: whose name the act is in (`speaks_for`); records are in the name of the entity it acts for unless `for` says otherwise. On `money`, `for` is the payment's purpose (its memo).
- `visible`: `public`, or ids.
- `basis`: the records the act cites in support of itself (what it is done under, and the papers that back it), in the order cited: one record bare (`basis=rec.412`), or several as a list (`basis=["rec.412","rec.4019"]`; at most 64). A list of one is that record alone, and one named twice is cited once: one basis has one form (blocks and records: Basis). A record that is the thing acted on (the invoice a payment `settles`, the record a statement withdraws, the form filled in) is not also a basis.

## Examples

```
money(to=builder, amount="$500", for="the fence")
money(to=acc-landlord-1, amount="$850", every="monthly", for="rent")
structure(type=park, on=lot-00-00, by=greenco, price="$60,000", from=acc-parks, basis=rec.412)
form(to=planning, form=permit_application, lot=lot-00-00, structure_type=park)
agreement(with=c0042, template=lease, term="12 months", our_notice="60 days", their_notice="30 days",
          we_do=occupancy(who=c0042, in=apts-3/dwelling.2),
          they_do=money(to=acc-landlord-1, amount="$850", every="monthly", for="rent"))
t = entity(kind=trust, name="River Land Trust")
statement(kind=charter, for=t, text="The trust holds land for the town, in perpetuity.")
f = entity(kind=firm, name="Riverside Bakery", position="Owner")
position(title="Baker", role=staff)
position(appoint=bakery-baker, to=par.12)
presence(name="Ana Silva", age="31 years", template=newcomer, carrying="$2,400")
claim(position=liberty, holder=builder, about={"action":"build","object":"lot-12-03"})
none(not_yours)
```
