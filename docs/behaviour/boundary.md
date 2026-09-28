# The outside world as a boundary condition: `world.export_demand` (v0.2.0) and `world.migration` (v0.1.0)

**Seat:** the outside world (entity of kind `boundary`). **Source:** `participants/src/behaviour/world.ts`.

## What it does

Money enters a world only when the outside world's own seat pays (D31). This module is the simplest such seat. On a researcher-set schedule, it buys from named town accounts, e.g. a factory's exports or tourist spending at shops. Each purchase is an ordinary transfer from the outside world's account (which may go negative) to the seller's account.

## Where the rule comes from

VISION §5: "boundary conditions: the world has an outside, with external markets, prices, demand… The researcher sets these." The town's export base, the classic economic-base view of a local economy (money earned from outside sustains local spending), is here reduced to researcher-set demand.

## Parameters

`purchases`: a list of `{ to, amount, every, memo? }`. For example, `{ "to": "acc-factory", "amount": 50000000, "every": 2592000 }` means the outside world buys $500,000 of the factory's output every 30 days.

## Leaves out

- Prices responding to quantity.
- Imports, beyond what construction materials already pay to the outside.
- Shocks: a researcher can script them as another module.

---

## `world.migration` (v0.1.0): people moving in from elsewhere

**Participant:** the outside world's `migration` position ("People moving from elsewhere"), held by a system. **Source:** `participants/src/behaviour/world.ts`. People cross into the world only through the boundary (the `arrive` block; contracts v0.4), so arrivals are the outside world's act. Who comes is the outside world's business.

| Rule | Detail | Source |
|---|---|---|
| **When people come** | Monthly, it looks at the town's standing job postings, as someone thinking of moving would. A newcomer expects the mean posted wage times the chance of a job, where the chance is postings ÷ (postings + the adults it brought in the last 90 days, who compete for them). Where that beats `outside_monthly_income`, each posting draws a household with probability `response_bps` × the gap (as a share of the outside income). At most 8 households a month. | Harris & Todaro (1970), "Migration, Unemployment and Development: A Two-Sector Analysis", *AER* 60(1): migration responds to the *expected* wage gap, the wage times the probability of employment, so it can go on while there's unemployment. The response rate and the outside income are **placeholders** to calibrate against ABS regional internal migration. |
| **Who comes** | Households drawn from the same census shares as the town's ([households.md](households.md)) | ABS Census 2021 (a placeholder: movers are younger and more often single than the whole population) |
| **What they bring** | Each adult carries 1–3 months of `outside_monthly_income` in savings, in their own keeping. It moves from the outside world's account, which may go negative. | Placeholder |
| **Their paperwork** | It writes the `household` record the newcomers bring (members, couples, who will hold a lease), once it can see their participants in its directory | |

**Once here,** newcomers are ordinary citizens (templates `newcomer-female`, `newcomer-male`, running `citizen.default`). They ask the bank for an account, deposit what they brought, and hunt for work and a home. If they can't find a home in 90 days, they leave again.

**What it can't see:** the town's unemployment. It knows only the postings it can see and whom it has brought. A town that fills its vacancies quickly draws few people, whatever its unemployment; one with vacancies standing draws people even if many locals are out of work (Harris–Todaro's point).

**Observed:** on the 1,000-person town, postings are filled within the month by the ~150 adults out of work, so almost nobody comes. With four factories for 120 people and a lower income elsewhere, households arrive, bank their savings, and find factory work within two weeks and a home within about four (`orchestrator/test/migration.test.ts`).

**Leaves out:** people leaving *for* somewhere (departures are the citizens' own exit rule); return migration; family reunion; the town's reputation, housing costs, or unemployment figures as signals.
