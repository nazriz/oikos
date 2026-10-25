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

## `world.statistics` (v0.2.0): the statistician

An office of the outside world's government. Once a month (`every_days`, 30) its collectors read the prices of a sample
of outlets: one search of what sellers advertise, the first `sample` (200, what one search can read: a placeholder)
standing price lists, of which those that sell to anyone (no minimum order) count. It publishes the mean price of each
kind of goods as a `price_index` (`{ kind, mean, outlets }`), public. It is what anyone who needs "prices" reads: the
union's claims follow it (docs/behaviour/unions.md).

**Where the rule comes from:** a price index is made by a statistics office from prices collected at a sample of
outlets by its own staff, online and from retailers' data (Australian Bureau of Statistics, *Consumer Price Index:
Concepts, Sources and Methods*, 2025, "Price collection": "trained and experienced ABS staff", web-scraping, scanner
data; "87% of the CPI by weight is collected on a monthly basis"; opened 2026-10-08). It is not a keeper of prices and
is shown none unasked: it goes and reads them, capped at its sample.

**The population estimate (0.2.0).** Each month it publishes how many live in the town (`population_estimate`,
`{ residents, census, births, arrivals, deaths, departures }`, public): the count at the last census (`population`, a
number the world gives it; none: no estimate), plus the births registered and the people who have moved in since, less
the deaths registered and those who said they were leaving. What reaches it: the registry's entries of births and
deaths (it is one of those sent every entry: docs/behaviour/deaths.md, "Who is told"), a count of each household the
migration office brings (`arrival`: how many, never who), and the departures of those who tell the outside world's
offices they are going. It is what anyone who needs "the population" reads: the funders pay by it
(docs/behaviour/public-finance.md).

**Where the rule comes from:** between censuses a statistics office estimates the resident population from the census
count, registered births and deaths, and migration (Australian Bureau of Statistics, *National, state and territory
population* methodology: the estimated resident population is the census base updated by "natural increase" and "net
overseas and interstate migration"; to confirm: named from memory, not opened). It counts nobody itself between
censuses.

**Leaves out:** someone who dies and is never registered stays in the estimate; someone who leaves without telling any
of the outside world's offices does too. The estimate has no error added of its own.

**Leaves out:** weights (a plain mean of outlets); a basket (one index a kind of goods); a sample drawn at random
(a search returns the oldest standing lists first, so in a town with more outlets than the sample it leans to shops
whose prices have not changed: at 200 this bites above about 200 sellers); the collectors' time.

## `world.transfers` (v0.4.0): the payments office, applying the published support law

Support paid to people in the world by someone outside it: for a town, a higher government's payments office. Until 2026-10-08 the payments were the office's own settings (a kind, an amount, how often, the ages). Now **a payment is a rule of a published law**, and the office reads the law and applies it, as an employer reads the tax law.

**The law** (`law-support`, kind `law`, the outside world's; `data.payments`; `PaymentRule`, `participants/src/behaviour/payments.ts`). A place with no payments has no such law. Each payment is a rule in three parts, each from a short list; sums are in the smallest unit of the world's money, for one payment:

| Part | Says | Forms |
|---|---|---|
| `who` | who qualifies; everything listed must hold | `from_age`, `to_age` (whole years, both inclusive); `out_of_work` (for someone without work who is looking); `record` (contributions on the payer's book for the claimant: in at least `months` monthly reports, one if not said, within the last `within_months`); `income_under` (the household's income for a month, as the claimant declares it, under a sum: for the household, or a head); `no_other_pension`; `children` (at least so many under an age in the household) |
| `amount` | how much | `flat`; or `share_bps` of the claimant's previous pay for as long as one payment covers (`of`: `gross`, or `net`: after what the tax law withholds from such a pay), no less than `least` and no more than `most` (one sum, or by age: `[{ from_age, amount }]`), and `with_child_bps` for a claimant who declares a child under 18; or a household's: `household`, with `per_member` and `per_child` (under an age) |
| `lasts` | for how long | nothing said: while the claimant qualifies and claims; `days` from the grant; `until_age`; `then`: the payment that may be claimed when this one ends |

and `every_days` (how often it is paid: 14, 30, 61 for a pension paid every two months), `payer` and `account` (who pays, from which account: in a profile, `paid_from`, one of `public_finance.funds`, or the general government).

**Who decides, and on what.** The office decides each claim on what the claim states and on its own book. It is shown nothing whole that it does not keep (docs/no-god-view.md):
- *Age:* the date of birth stated on the claim, taken as true (as before).
- *What a rule has the claimant declare* (`data.declares` on the claim: the household's income for a month and how many live in it, the children's dates of birth, whether anyone else pays them a pension): taken as stated. A false declaration is possible and uncaught: an audit, asking the keeper of one record about one claimant, is a later module. The office does refuse a "no other pension" claim from someone it pays another pension itself.
- *A record of contributions and previous pay:* the employers' monthly `withholding_report`s addressed to the payer, where a charge of the tax law is reported worker by worker (docs/behaviour/public-finance.md). Each is addressed to it entry by entry: its own book (the `contributions` channel, given only where a payment needs it). Previous pay is the mean of the monthly gross pay reported for the claimant, over the last twelve reports at most; a month partly worked counts as it was paid, so it pulls the mean down. Work for an employer that reports nothing leaves no record, and so no payment.
- *Net pay:* the published tax law, which the office reads as anyone may.

It grants or refuses (`benefit_decision`: the sum, how often, and `until` where the payment's time is limited; a refusal says why, except for age), pays on the payment's schedule from the payment's account, and stops when the claimant asks (`benefit_change`), dies (a death registration), leaves (a departure), or the payment's time runs out. Then it tells the claimant (`benefit_end`, naming what may be claimed next). One payment of each kind a person: a new claim for the same payment replaces the old; different payments are drawn together (a pension and a household's payment).

**Looking again and waiting (0.10.0, foundations F8; docs/behaviour/decisions.md).** A claim waits for what the decisions law says it needs before it is decided (papers from the claimant, a confirmation from their last employer, within the law's days: asked for once, by the office, as work with its time); a refusal asked about inside the law's days is decided again on the facts, recorded (`decision_review`) and, if found wrong, put right by the office itself (a new `benefit_decision` with `on_review`) or on a venue's setting it aside. The office no longer keeps a memory of which refusals were wrong: the review recomputes the decision from the claim. The 6 days of the real agency come, if at all, from the claimant's and the employer's time and the office's rounds; nothing sets them.

**Mistakes** (0.4.0; the load of 0.4.0 removed in 0.8.0, foundations F6; the rate a slip of the world's table from 0.9.0, foundations F7). A payments office makes mistakes: a slip of whoever decides a claim, at the rate of the row `publish/benefit_decision` of the world's table of slips (`orchestration.slip`; of claims that qualify, the share wrongly refused, scaled by the world's friction dial `dials.friction_bps`; the same share however many claims are waiting; no row, no slip), drawn by `slip()` (participants/src/slip.ts). Until 0.8.0 there were also `processing_days` (a claim decided that long after it was made) and `capacity_per_day` (how many its staff decide in a day), and the share was doubled while more claims waited than a day's capacity: three dials that set the office's throughput and delay directly. How long a claim takes is now the hours of whoever decides it: a system's lanes and the seconds a decision takes in the world's table, a person's timeline. The wait of the real agency (Victoria: 6 days in July 2024, Services Australia annual report 2023-24) is not the town's to make, and returns when the keepers it asks take time to answer (foundations F11). A wrong refusal is a `benefit_decision` that says "the claim could not be verified" (drawn from a stream named for the claim); the office remembers it as wrong. A claimant who asks the office to review the refusal (`review_request`, matter `claim_refused`, `about` the decision, answered by `respond`: docs/behaviour/frictions.md) is told yes if its books show the refusal was wrong and no if the claim was rightly refused; a review pays nothing, but that person's next claim for the payment is decided on its facts, with no error draw, and they claim again. The figures are the profile's, with their sources (`frictions.support`: docs/behaviour/frictions.md).

**Who claims what** is the citizen's (docs/behaviour/citizen.md, "Retiring and support").

**Published figures** (0.2.0): every `publish_every_days` (none by default; the generated town, 30), it publishes how many it pays of each payment (a public `support_statistics` statement, `data: { recipients: { payment: n } }`), as a payments department publishes its recipients by area (DSS, *JobSeeker Payment and Youth Allowance recipients, monthly profile*, by SA2). Would-be migrants read it.

**The nine places' payments as data** (each profile's note on `support.payments` says what was moved, what was said for the first time and from what, and what is still a stand-in):

| Shape | Place | As data |
|---|---|---|
| none | India, Kenya, Mexico (no payment to the unemployed) | no payment in the list: nobody claims one, none is paid or counted. (Until 2026-10-08 each had a payment of nought; in a batch with pensions, a payment of nothing made the world refuse the whole batch, so most pensions in those towns went unpaid.) |
| flat, no time limit | Victoria, England; Germany's and Brazil's second payment | `who: { from_age, to_age, out_of_work }`, `amount: { flat }` |
| a share of previous pay, on a record, for a time | Germany: 60% of net (67% with a child), 360 days, then the flat payment; Ohio: half of gross up to a maximum, 182 days; Japan: 60% of gross under limits by age | `who.record`, `amount: { share_bps, of, most }`, `lasts: { days, then }` |
| a household's payment on declared income | Brazil's family transfer | sayable (`who.income_under` per head, `amount.household`, `per_child`); the profile still pays its average flat to those out of work, because its note gives no rule's figures |
| a pension for those without another | Kenya | `who: { from_age, no_other_pension }` |
| a pension on a means test | Tamil Nadu | sayable (`who.income_under`); the profile's note gives no income line, so everyone from the age is still paid |
| a pension every two months | Japan, Mexico | `every_days: 61` |
| a pension paid from a fund | Germany, Brazil, Ohio | `paid_from` |

**Behaviour that is deliberately not here** (it belongs to the citizen redesign, docs/design/ai-citizens.md): a payment changing how hard or how choosily someone looks for work. Longer or richer insurance lengthens spells out of work and leaving bunches when it runs out (Meyer 1990; Schmieder, von Wachter and Bender 2012; Chetty 2008; to confirm), but today's citizen applies for one posting a week and takes what it is offered: it has no wage below which it refuses for a payment to raise. Until then, a payment's size and length change people's income and when they give up and leave town, and nothing else. Nor is there a take-up share: everyone who fits claims.

**Who decides a claim** (law 10, foundations-2 P3, 2026-10-25; WM-14). The agency's officers, not its computer: the
generator gives the outside a desk, `outside-casework` (template `agency-casework`), whose rows are an officer's minutes
for a decision, a request for papers or a confirmation, and a decision looked at again (the person table's rows: sourced
for us-oh, placeholders elsewhere), whose hours are an officer's working day, and whose lanes are the town's share of the
agency's officers (`public_service.support_officers_per_1000_claims` times the town's claims in payment at generation;
a placeholder national ratio in every profile). The office names the desk (`casework: {by, kinds}`, `done_by` on each
act that is only those papers); its case system pays and gives notice at a computer's seconds. A share of an officer
under one is a share of a day. Where a model holds the office, its staff route the casework to the desk and its own
decisions on what is put before it stay its own, at the case system's speed (a person who is not a resident is not built:
WM-14).

**Leaves out:** a payment that falls as income rises (a taper); couples' rates; rules by sex or by year of birth; an early or late pension at a reduction or an increase; a waiting time before the first payment; a pension reckoned from years of contributions or past earnings; housing costs paid on top; checking what is declared; a payment whose rule changes in a run (a payment granted keeps its sum). A world that needs a national government's decisions inside it replaces this module with a participant of its own, reading the same law and claims (phase F).

## `world.funding` (v0.1.0): money lent into the world from outside

For a town's bank, the wider market it funds itself from. It lends what's asked for at once (`funding_draw`: an amount and an account), paying it with the draw settled: the market is large next to a town. The interest and repayments are the borrower's to make (`bank.lending` pays them monthly); this module doesn't chase them.

## `world.migration` (v0.2.0): people moving in from elsewhere

**Participant:** the outside world's `migration` position ("People moving from elsewhere"), held by a system. **Source:** `participants/src/behaviour/world.ts`. People cross into the world only through the boundary (the `arrive` block; contracts v0.4), so arrivals are the outside world's act. Who comes is the outside world's business.

| Rule | Detail | Source |
|---|---|---|
| **When people come** | Monthly, it looks at the town's standing job postings, as someone thinking of moving would. A newcomer expects the mean posted wage times the chance of a job, where the chance is postings ÷ (postings + those competing for them: the town's jobseekers, as the latest published counts of recipients of the payments for those out of work say (0.2.0; every such payment the law has: `jobseekers_payment`, their names with commas between, 0.6.1), and the adults it brought in the last 90 days). Where that beats `outside_monthly_income`, each posting draws a household with probability `response_bps` × the gap (as a share of the outside income). At most 8 households a month. | Harris & Todaro (1970), "Migration, Unemployment and Development: A Two-Sector Analysis", *AER* 60(1): migration responds to the *expected* wage gap, the wage times the probability of employment, so it can go on while there's unemployment. The response rate and the outside income are **placeholders** to calibrate against ABS regional internal migration. |
| **Who comes** | Households drawn from the same census shares as the town's ([households.md](households.md)) | ABS Census 2021 (a placeholder: movers are younger and more often single than the whole population) |
| **What they bring** | Each adult carries 1–3 months of `outside_monthly_income` in savings, in their own keeping. It moves from the outside world's account, which may go negative. | Placeholder |
| **Their paperwork** | It writes the `household` record the newcomers bring (members, couples, who will hold a lease), once it knows how to reach each of them: it looks each newcomer up once they have crossed (0.5.0; nobody is shown who's who, and the answer comes at once) | |

**Once here,** newcomers are ordinary citizens (template `newcomer`, running `citizen.default`; their sex is physical, stated on arrival). They ask the bank for an account, deposit what they brought, and hunt for work and a home. If they can't find a home in 90 days, they leave again.

**What it sees of the town's unemployment** (0.2.0): the support office's published count of unemployment support recipients. Before, it saw only postings and whom it had brought, so a town whose postings stood for a while drew people however many locals were out of work: in the 1,000-person town's 5-year runs, a quarter of those who came were out of work at the end. In Harris & Todaro the chance of a job is the destination's employment rate; its own unemployed make coming less worth it. (People aged 18 to 21 aren't counted: the profile's unemployment payment starts at 22.)

**Who looks for work** (0.2.0): the one who came for the job (the household's leaseholder); other adults at the world's participation (`participation_bps`, the profile's), the rest taking the `newcomer-outside-lf` template, outside the labour force.

**Observed:** on the 1,000-person town, postings are filled within the month by the ~150 adults out of work, so almost nobody comes. With four factories for 120 people and a lower income elsewhere, households arrive, bank their savings, and find factory work within two weeks and a home within about four (`orchestrator/test/migration.test.ts`).

**Leaves out:** people leaving *for* somewhere (departures are the citizens' own exit rule); return migration; family reunion; the town's reputation, housing costs, or unemployment figures as signals.
