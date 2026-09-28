# The outside world as a boundary condition: `world.trade` (v0.2.0), `world.export_demand` (v0.2.0) and `world.migration` (v0.1.0)

`world.export_demand` (money on a schedule) is kept for worlds that want exports as money alone. The generated town uses `world.trade`.

**Seat:** the outside world (entity of kind `boundary`). **Source:** `participants/src/behaviour/world.ts`.

## What it does

Money enters a world only when the outside world's own seat pays (D31). A world can have several edges (v0.5, D58: the rest of the country, a neighbouring world, the unsimulated world), each an entity of kind `boundary` with its own seat and accounts. The generated town has one, `outside`. This module is the simplest such seat. On a researcher-set schedule, it buys from named town accounts, e.g. a factory's exports or tourist spending at shops. Each purchase is an ordinary transfer from the outside world's account (which may go negative) to the seller's account.

## Where the rule comes from

VISION §5: "boundary conditions: the world has an outside, with external markets, prices, demand… The researcher sets these." The town's export base, the classic economic-base view of a local economy (money earned from outside sustains local spending), is here reduced to researcher-set demand.

## Parameters

`purchases`: a list of `{ to, amount, every, memo? }`. For example, `{ "to": "acc-factory", "amount": 50000000, "every": 2592000 }` means the outside world buys $500,000 of the factory's output every 30 days.

## Leaves out

- Prices responding to quantity.
- Imports, beyond what construction materials already pay to the outside.
- Shocks: a researcher can script them as another module.

---

## `world.trade` (v0.1.0): the world market

The outside world as a trader (phase B). The world market is large next to a town, so it takes the town's prices as given in the other direction too: it sells whatever is ordered at world prices, and buys at world prices up to a demand. Both are researcher-set.
- **Selling (imports).** It publishes a price list (`sells`: a unit price for each kind) and fills paid orders from outside ([trade.md](trade.md)). The goods come from the edge's own holding, which may go negative: they come from elsewhere (D31). An order below the world price, or for something it doesn't sell, is refunded.
- **Buying (exports).** At the start of each month it publishes a `buying_offer` for each kind it `buys`: a unit price, and that month's quantity. The quantity is either shared by all sellers, first come first served, or split among named sellers (`from`: each seller's quantity, like a factory's own export customers). A town firm ships goods to the outside (`goods(..., to = outside, at = outside)`) and invoices it. The `invoice` data names the kind, the quantity, where the goods came from (`from_at`) and the payment asked for.
- **Paying invoices.** It pays an invoice once the goods have arrived: its own holding shows what came in, less what it has sent out itself. It pays at the offer's price, up to the month's quantity. Goods beyond that are sent back to where they came from, with a note (`invoice_declined`, `returned`). An invoice whose goods haven't come within `wait_days` (14) is declined.

**Where the rule comes from:** VISION §5 (boundary conditions: external markets, prices and demand, set by the researcher). A small open economy is a price-taker on world markets. Demand for its exports is capped here, rather than infinite at the world price, so the researcher sets how much of the town's output the world takes.

**Parameters:**
- `account` (the edge's own account);
- `sells` (`{ kind: cents each }`);
- `buys` (`{ kind: { unit_price, per_month, from? } }`);
- `wait_days`.

In the generated town (generator 0.12.0):
- it sells building materials at $1.25 a kg ([building.md](building.md)) and factory inputs at $2.50 a kg;
- it buys the factories' goods at $60 each. Its monthly quantity is the spec's `exports_per_month` (money at the world price) divided by that price, split between the factories by the size of their works (each factory's export customers).

This replaces `world.export_demand` in the town. Selling goods to shops comes with step 3.

A first-come-first-served quantity, shared by two factories, made the demand each factory saw swing from month to month: whoever shipped first took most of it. Named shares (a factory's own export customers) are steadier and closer to how a town's factories actually sell abroad.

**World prices move (0.2.0):**
- **The random process.** Each month a kind's price level (as a share of its starting price) takes a random step and drifts back towards where it started. It's a mean-reverting process: the standard deviation of a month's step, and how much of the gap from the start it keeps (`price_process`, from the world's profile: placeholders until estimated from international trade price indexes). The step is drawn from the world's seeded randomness, in integers (a normal draw from twelve uniforms).
- **Scripted shocks** (`shocks`, a researcher's scenario: `{ from_day, kind, what: price | demand, factor_bps }`) multiply a kind's price, or the demand for it, from a day on, until another shock to the same thing.
- **What moves with them.** The price list is republished when prices change. Buying offers carry the month's price and quantity. An order below the price now is refunded, and the buyer orders again. Invoices are paid at the month's price.

**Leaves out:**
- delivery times;
- exchange rates (one currency);
- trade policy (tariffs, quotas): these would be laws, as records, applied by an office.

## `world.transfers` (v0.1.0): support paid from outside

Support paid to people in the world by someone outside it: for a town, a national government's payments. The world names the payments (`payments`: a kind, its amount, how often, and the ages it's for). A person claims (a `benefit_claim` to the payer, with the kind, the account to pay and their date of birth); the payer grants the claim if their age fits (taking the stated date of birth as true), says so (`benefit_decision`), and pays on schedule until the person asks to stop (`benefit_change`), dies (a death registration) or leaves (a departure). One payment a person: a new claim replaces the old.

**Leaves out:** means tests; couples' rates; checking what's claimed; payments for anything but age and being out of work. A world that needs a national government's decisions inside it replaces this module with a participant of its own, reading the same claims (phase F).

In the generated town, the profile's payments are "pension" (from the retirement age) and "unemployment" (below it, from the age the profile gives).

## `world.migration` (v0.1.0): people moving in from elsewhere

**Participant:** the outside world's `migration` position ("People moving from elsewhere"), held by a system. **Source:** `participants/src/behaviour/world.ts`. People cross into the world only through the boundary (the `arrive` block; contracts v0.4), so arrivals are the outside world's act. Who comes is the outside world's business.

| Rule | Detail | Source |
|---|---|---|
| **When people come** | Monthly, it looks at the town's standing job postings, as someone thinking of moving would. A newcomer expects the mean posted wage times the chance of a job, where the chance is postings ÷ (postings + the adults it brought in the last 90 days, who compete for them). Where that beats `outside_monthly_income`, each posting draws a household with probability `response_bps` × the gap (as a share of the outside income). At most 8 households a month. | Harris & Todaro (1970), "Migration, Unemployment and Development: A Two-Sector Analysis", *AER* 60(1): migration responds to the *expected* wage gap, the wage times the probability of employment, so it can go on while there's unemployment. The response rate and the outside income are **placeholders** to calibrate against ABS regional internal migration. |
| **Who comes** | Households drawn from the same census shares as the town's ([households.md](households.md)) | ABS Census 2021 (a placeholder: movers are younger and more often single than the whole population) |
| **What they bring** | Each adult carries 1–3 months of `outside_monthly_income` in savings, in their own keeping. It moves from the outside world's account, which may go negative. | Placeholder |
| **Their paperwork** | It writes the `household` record the newcomers bring (members, couples, who will hold a lease), once it can see their participants in its directory | |

**Once here,** newcomers are ordinary citizens (template `newcomer`, running `citizen.default`; their sex is physical, stated on arrival). They ask the bank for an account, deposit what they brought, and hunt for work and a home. If they can't find a home in 90 days, they leave again.

**What it can't see:** the town's unemployment. It knows only the postings it can see and whom it has brought. A town that fills its vacancies quickly draws few people, whatever its unemployment; one with vacancies standing draws people even if many locals are out of work (Harris–Todaro's point).

**Observed:** on the 1,000-person town, postings are filled within the month by the ~150 adults out of work, so almost nobody comes. With four factories for 120 people and a lower income elsewhere, households arrive, bank their savings, and find factory work within two weeks and a home within about four (`orchestrator/test/migration.test.ts`).

**Leaves out:** people leaving *for* somewhere (departures are the citizens' own exit rule); return migration; family reunion; the town's reputation, housing costs, or unemployment figures as signals.
