# `citizen.default` (v0.4.0)

**Seat:** a townsperson (acts as themselves). **Source:** `seats/src/behaviour/citizen.ts`. Wakes weekly, and whenever something names them (an offer, a notice, a message).

Everything happens the way a person does it: they apply, sign, move in, and ask their bank to pay. Nothing happens to them automatically.

## What it does, and where each rule comes from

| Rule | Detail | Source |
|---|---|---|
| **Rent budget** | With a job: rent ≤ 33% of monthly income. Without one: only if savings cover 6 months' rent. | Bank of England housing model (Baptista et al. 2016, §3.4.1): renters "bid a fixed fraction of its income (set at 33%) on the rental market" |
| **Choosing a home** | From the listings seen, apply for the most expensive one within budget (rent standing in for quality), one application a week, never the same listing twice | BoE model §3.5: bids are matched "to the offer with the highest quality Q that they can afford" |
| **Signing and moving in** | Sign the landlord's offer and set up a monthly standing order for rent, paid in advance. Then move in as a separate physical act, retrying weekly until the home is free. | Rent in advance is standard UK/AU practice. Separating signing from moving in: someone can hold a lease before the last tenant has left. |
| **Staying** | Never ends a tenancy early; leaves when the term ends or the landlord's notice runs out | BoE model §3.4.2: "a household will never choose to terminate their renting agreement" |
| **Work** | If unemployed, apply for the best-paid posting seen, one a week | Simple job search; the labour-market literature (Dosi et al.) is the planned refinement |
| **Spending** | Once a month: essentials ($500) plus 30% of savings above a buffer of 3 months' income, at a local shop picked at random | BoE model eq. (2): consumption is a fraction of the gap between the bank balance and a desired balance |
| **Voice: starting a petition** | A tenant is *aggrieved* for 90 days after their landlord gives them notice, or while rent is ≥40% of income. If no tenant-protection petition is open, an aggrieved tenant starts one with probability 3% per wake. It demands a law (90 days' notice; rent rises capped at 5% a year), stated with its Institutional Grammar breakdown and tagged `tenant_protection`. The organiser closes it after 180 days. | Hirschman (1970): voice as the alternative to exit |
| **Voice: signing** | A tenant signs (a `vote` with choice `sign`, seen by the signer and the organiser only) when aggrieved, or once the share of the town that has signed, as the organiser's latest published `petition_count` says, reaches their personal threshold. The organiser publishes the running count at most every 3 days, as petition sites show one. Thresholds are drawn once per person, roughly normal (mean 25%, sd 10%, via the Irwin–Hall sum of 12 uniforms). | Granovetter, "Threshold Models of Collective Behavior" (1978). A uniform distribution, the first version, always cascades to everyone, which is Granovetter's own point; a normal one makes the outcome contingent. |
| **Leaving town** | After 90 days without a home, or 180 days without work *and* without enough money for a month's rent: move out, give notice, and take all savings out of town | Hirschman, *Exit, Voice, and Loyalty* (1970): exit as the response to decline. Thresholds are placeholders to calibrate. |

## Parameters (defaults)

- `rent_share_bps` 3300
- `savings_rent_months` 6
- `essentials` 50000
- `spend_above_buffer_bps` 3000
- `buffer_months` 3
- `leave_after_homeless_days` 90
- `leave_after_jobless_days` 180
- `petition_start_bps` 300, `petition_days` 180, `rent_burden_grievance_bps` 4000
- `threshold_mean_bps` 2500, `threshold_sd_bps` 1000
- `shop_accounts`, `outside_account`, `population`: supplied by the world

## Leaves out (for now)

- Voice beyond petitions: voting in elections, protest, contacting councillors.
- Knowing which laws already exist (so citizens may petition for a law that has already passed).
- Buying homes.
- Households (one person per citizen).
- Commuting.
- Quality of housing beyond price.
- Renegotiating rent.
- Wages rising over time.
- Behaviour depending on age or history.
