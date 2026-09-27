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
          | JSON                  {…} or […]: structured data (integers only), for statement data and claim contents
          | call                  a nested call: an agreement's commitments (we_do, they_do)
```

- **One program is one atomic act.** Its lines are independent calls, or bindings the later lines refer to (things the participant creates itself in the same act).
- **One program is done in one capacity:** as the participant itself, or in one position it holds. The capacity is on the action (`as`), not in the calls: an act is one person doing one thing, in one role.
- **Ids are bare, and copied text is quoted.** Inside a quoted string, `\"` is a quote and `\\` a backslash.
- **Keyword arguments only.**
- **Zero arithmetic.** Amounts and durations are always quoted text, converted by the parser's tables:
  - amounts: `"$500"`, `"$1,234.56"`, `"60k"`, `"$1.5k"`, `"$2m"`, `"500 dollars"` → integer cents;
  - durations: `"30 days"`, `"2 weeks"`, `"monthly"`, `"fortnightly"`, `"every 3 months"` → seconds. The world has no calendar: a month is 30 days and a year is 365.
- **Every call is checked against the argument table below** (the parsed form's schema, calls.schema.json). An unknown or missing argument means the call is refused as unclear; it is never silently ignored.
- **`none(LABEL)`** is the translator's refusal, with one of five labels: `not_yours`, `needs_calculation`, `too_much`, `unclear`, `unknown_form`.

## Functions

Each function names a physical outcome. The resolver decides nothing on the participant's behalf: missing decisions come back as questions; single physical answers are filled in; whoever else must physically act is asked (a `request`) or offered an agreement.

| Function | Arguments (`*` required) | Resolves to |
|---|---|---|
| `money` | `to*` (account or entity), `amount*`, `from`, `every`, `first`, `for`, `settles`, `basis`, `per_request` | `transfer` if the entity it acts for keeps `from` (`per_request` links the request it carries out); otherwise a `request` to its keeper, citing `basis` |
| `account` | `holder`, `at`, `close` | `open_account` / `close_account` if the entity it acts for keeps it; otherwise a `request` to `at` |
| `structure` | `type`, `on` (a lot or a cell), `by`, `price`, `from`, `basis`, `remove` | `construct` / `demolish` if `by` is the entity it acts for (materials or costs `from`); otherwise an offered construction agreement to `by`. On a lot, the footprint's corner is filled in when exactly one fits the lot's open ground; otherwise it asks which cell |
| `occupancy` | `in*` (a space, or a building), `who`, `leave` | `occupy` / `vacate`. A building with one space is that space; otherwise it asks which. `who` is a body brought or removed (default: its own person) |
| `entity` | `kind*`, `name*`, `visible`, `position` | `create_entity`; `position` is the title of the new organisation's first position, held by the participant (otherwise nobody could ever act for it) |
| `claim` | `holder`, `position`, `against`, `about`, `basis`, `transfer`, `to`, `release`, `visible` | `record_claim` / `transfer_claim` / `release_claim` |
| `agreement` | `with`, `template`, `terms`, `we_do`, `they_do`, `term`, `our_notice`, `their_notice`, `basis`, `visible`, `sign`, `notice`, `text` | An offer: `propose_agreement` plus its own `sign_agreement`. `sign=<agreement>` signs one; `notice=<agreement>` gives notice |
| `statement` | `kind`, `text`, `to`, `visible`, `basis`, `for`, `data`, `adico`, `formal`, `on`, `withdraw` | `publish` / `withdraw` (`adico` is the Institutional Grammar breakdown as data; `formal` a CEL condition, as text; `on` a lot to put it up on, where it's seen by those nearby) |
| `vote` | `ballot*`, `choice*`, `visible` | `vote` |
| `message` | `to*`, `text*`, `re` | `message` |
| `form` | `to*`, `form*`, plus the form's own fields | `publish` of the form's statement kind, with its fields checked against the form |
| `presence` | `who`, `name`, `age`, `template`, `carrying`, `leave` | `arrive` (at the boundary: a newcomer with `name`, `age` and `template`, carrying money; or `who` returning) / `leave` (its own body, or `who` removed) |
| `birth` | `name*`, `template*`, `with` | `birth`: its own person conceives a child, with another parent `with` if named |
| `harm` | `who*` | `harm`: its own body harms someone near it |
| `position` | `title`, `role`, `channels`, `role_module`, `appoint`, `to`, `vacate` | `create_position` (a new position of the organisation it acts for); `appoint=<position>, to=<participant>` → `appoint`; `vacate=<position>` → `appoint` of nobody |
| `system` | `template`, `title`, `retire` | `deploy` a system participant from a template / `retire` one |

**Common argument meanings:**
- `for`: whose name the act is in (`speaks_for`); records are in the name of the entity it acts for unless `for` says otherwise. On `money`, `for` is the payment's purpose (its memo).
- `visible`: `public`, or ids.
- `basis`: a record the act cites.

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
none(not_yours)
```
