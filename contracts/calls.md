# The call language (contracts v0.3)

A **call** is a structured intent: what a seat wants to bring about, named as a physical outcome, with the inputs the seat supplies. A translator turns plain language into calls, and code seats write them directly. The **resolver** turns a call into the seat's own acts (blocks). The full design and its reasoning are in [docs/design/translator-and-resolver.md](../docs/design/translator-and-resolver.md). This file is the reference, and [calls.schema.json](calls.schema.json) is the parsed form.

## Syntax

```
program  := line ( NEWLINE line )*
line     := [ NAME "=" ] call
          | "none(" LABEL ")"
call     := FUNC "(" [ arg ( "," arg )* ] ")"
arg      := KEY "=" value
value    := ID                    e.g.  p00-00   acc-city   rec.412
          | NAME                  a variable bound on an earlier line of the same program
          | STRING                "…"  copied text: amounts, durations, free text
          | JSON                  {…} or […]: structured data (integers only), for statement data and claim contents
          | call                  a nested call: an agreement's commitments (we_do, they_do)
```

- **One program is one atomic act.** Its lines are independent calls, or bindings the later lines refer to (things the seat creates itself in the same act).
- **Ids are bare, and copied text is quoted.** Inside a quoted string, `\"` is a quote and `\\` a backslash.
- **Keyword arguments only.**
- **Zero arithmetic.** Amounts and durations are always quoted text, converted by the parser's tables:
  - amounts: `"$500"`, `"$1,234.56"`, `"60k"`, `"$1.5k"`, `"$2m"`, `"500 dollars"` → integer cents;
  - durations: `"30 days"`, `"2 weeks"`, `"monthly"`, `"fortnightly"`, `"every 3 months"` → seconds. The world has no calendar: a month is 30 days and a year is 365.
- **`none(LABEL)`** is the translator's refusal, with one of five labels: `not_yours`, `needs_calculation`, `too_much`, `unclear`, `unknown_form`.

## Functions

Each function names a physical outcome. The resolver decides nothing on the seat's behalf: missing decisions come back as questions; single physical answers are filled in; whoever else must physically act is asked (a `request`) or offered an agreement.

| Function | Arguments (`*` required) | Resolves to |
|---|---|---|
| `money` | `to*` (account or entity), `amount*`, `from`, `every`, `first`, `for`, `settles`, `basis`, `per_request` | `transfer` if the seat's entity keeps `from` (`per_request` links the request it carries out); otherwise a `request` to its keeper, citing `basis` |
| `account` | `holder`, `at`, `close` | `open_account` / `close_account` if the seat's entity keeps it; otherwise a `request` to `at` |
| `structure` | `type`, `on`, `by`, `price`, `from`, `permit`, `remove` | `construct` / `demolish` if `by` is the seat's entity (materials or costs `from`); otherwise an offered construction agreement to `by` |
| `occupancy` | `in*`, `who`, `slot`, `count`, `leave` | `occupy` / `vacate` |
| `entity` | `kind*`, `name*`, `visible` | `create_entity` |
| `claim` | `holder`, `position`, `against`, `about`, `basis`, `transfer`, `to`, `release`, `visible` | `record_claim` / `transfer_claim` / `release_claim` |
| `agreement` | `with`, `template`, `terms`, `we_do`, `they_do`, `term`, `our_notice`, `their_notice`, `basis`, `visible`, `sign`, `notice`, `text` | An offer: `propose_agreement` plus the seat's own `sign_agreement`. `sign=<agreement>` signs one; `notice=<agreement>` gives notice |
| `statement` | `kind`, `text`, `to`, `visible`, `basis`, `for`, `data`, `adico`, `formal`, `withdraw` | `publish` / `withdraw` (`adico` is the Institutional Grammar breakdown as data; `formal` a CEL condition, as text) |
| `vote` | `ballot*`, `choice*`, `visible` | `vote` |
| `message` | `to*`, `text*`, `re` | `message` |
| `form` | `to*`, `form*`, plus the form's own fields | `publish` of the form's statement kind, with its fields checked against the form |

**Common argument meanings:**
- `for`: whose name the act is in (`speaks_for`); records are in the seat's own entity's name unless `for` says otherwise. On `money`, `for` is the payment's purpose (its memo).
- `visible`: `public`, or ids.
- `basis`: a record the act cites.

## Examples

```
money(to=builder, amount="$500", for="the fence")
money(to=acc-landlord-1, amount="$850", every="monthly", for="rent")
structure(type=park, on=p00-00, by=greenco, price="$60,000", from=acc-parks, permit=rec.412)
form(to=planning, form=permit_application, parcel=p00-00, structure_type=park)
agreement(with=c0042, template=lease, term="12 months", our_notice="60 days", their_notice="30 days",
          we_do=occupancy(who=c0042, in=str.3, slot=dwelling, count="1"),
          they_do=money(to=acc-landlord-1, amount="$850", every="monthly", for="rent"))
t = entity(kind=trust, name="River Land Trust")
statement(kind=charter, for=t, text="The trust holds land for the town, in perpetuity.")
none(not_yours)
```
