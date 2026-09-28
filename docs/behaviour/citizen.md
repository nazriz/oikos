# `citizen.default` (v0.11.0)

**Seat:** a townsperson (acts as themselves). **Source:** `participants/src/behaviour/citizen.ts`. Wakes weekly, and whenever something names them (an offer, a notice, a message).

Everything happens the way a person does it: they apply, sign, move in, and ask their bank to pay. Nothing happens to them automatically.

**Households (0.8.0):** a citizen lives in a household ([households.md](households.md)). The rules on homes and leaving town below are the **leaseholder's**, for the household: the budget is a third of household income, the search is for the bedrooms the occupancy standard asks for, and the whole household moves and leaves together. Other adults follow the leaseholder and pay a share of the rent. Children act on their own only from 18, when they open a bank account. Voice (petitions) is the leaseholders'.

## What it does, and where each rule comes from

| Rule | Detail | Source |
|---|---|---|
| **Rent budget** | With a job: rent ≤ 33% of monthly income. Without one: only if savings cover 6 months' rent. | Bank of England housing model (Baptista et al. 2016, §3.4.1): renters "bid a fixed fraction of its income (set at 33%) on the rental market" |
| **Choosing a home** | From the listings seen, apply for the most expensive one within budget (rent standing in for quality), one application a week, never the same listing twice | BoE model §3.5: bids are matched "to the offer with the highest quality Q that they can afford" |
| **Signing and moving in** | Sign the landlord's offer and set up a monthly standing order for rent, paid in advance. Then move in as a separate physical act, retrying weekly until the home is free. | Rent in advance is standard UK/AU practice. Separating signing from moving in: someone can hold a lease before the last tenant has left. |
| **Staying** | Never ends a tenancy early; leaves when the term ends or the landlord's notice runs out | BoE model §3.4.2: "a household will never choose to terminate their renting agreement" |
| **Work** | If unemployed, apply for the best-paid posting seen, one a week | Simple job search; the labour-market literature (Dosi et al.) is the planned refinement |
| **Spending** (0.11.0) | A month's spending: out of income, what isn't saved (the saving ratio) less housing, never below essentials; plus a little out of savings above a buffer of 3 months' income (a wealth effect, a share a year). Income is a month's worth of what came in over the last 90 days, less refunds (which delivery notes report); before that, what the job and support pay | Consumption out of income, at the household saving ratio; the wealth effect's share from the literature on consumption and wealth. The world's figures come from its profile (docs/profiles.md). Replaces the BoE rule's 30% of savings a month, which kept households spending far more than they earned |
| **A rent increase** (0.11.0) | Given notice of a rent increase on its home, the leaseholder pays it from when it starts (a new standing order) if it's still within the household's budget (the rent rule above); if not, it gives notice on the lease and looks for somewhere else | The rent rule above; the notice is the lease's |
| **Retiring and support** (0.11.0) | At the world's retirement age (none unless the world sets one), a person gives notice at work and claims the support the world names for retirees; out of work below it (and in the labour force), they claim support for the unemployed. A claim is stopped when it no longer fits (work found, retired). A refused claim isn't made again until they're a year older. Support in retirement counts as income that keeps a household in town; support while out of work doesn't | The world's support payments, from its profile; the payer is the outside world (docs/behaviour/boundary.md, `world.transfers`) |
| **In the labour force** (0.11.0) | Some working-age adults aren't: they don't look for work or claim unemployment support (the world's participation, drawn at the start) | The world's profile |
| **Shopping** (0.10.0) | Every fortnight, half a month's spending buys goods at a favourite shop, at its listed price. It's ordered and paid with the order, delivered home, or kept at the shop without a home. The favourite changes two ways. At the start of a trip, with probability 25%, it compares its shop with another; it switches if the other is more than 1% cheaper. When a shop couldn't serve all it asked, it gives up on that shop with probability 25%, and tries the next cheapest for the rest, up to 5 shops a trip. Only shops that sell by the item count (wholesalers have minimum orders). | Lengnick (2013), Table 1: ψ_price = 0.25, ξ = 0.01, ψ_quant = 0.25, β = 5 |
| **Using things up** (0.10.0) | Weekly, it uses up (the task `consume`) what it holds, spread over the weeks until the next trip. With a home, it uses things there, bringing home what's elsewhere. Without one, it uses what a shop keeps for it. Going without is what it ordered and never got (the delivery notes); measurement reads it. | Lengnick's households consume what they buy. Spreading it to the next trip is a household budgeting rule (placeholder) |
| **Voice: starting a petition** | A tenant is *aggrieved* for 90 days after their landlord gives them notice, or while rent is ≥40% of income. If no tenant-protection petition is open, an aggrieved tenant starts one with probability 3% per wake. It demands a law (90 days' notice; rent rises capped at 5% a year), stated with its Institutional Grammar breakdown and tagged `tenant_protection`. The organiser closes it after 180 days. | Hirschman (1970): voice as the alternative to exit |
| **Voice: who signs at all** | Each person is someone who signs petitions with probability 44%, drawn once; the rules below apply only to them (and only they start petitions). | Australian Election Study 2016: 44% had signed a written petition in the last five years. A light calibration (D52): without it, one tenants' petition reached ~99% of adults. |
| **Voice: signing** | A tenant signs (a `vote` with choice `sign`, seen by the signer and the organiser only) when aggrieved, or once the share of the town that has signed, as the organiser's latest published `petition_count` says, reaches their personal threshold. The organiser publishes the running count at most every 3 days, as petition sites show one. Thresholds are drawn once per person, roughly normal (mean 25%, sd 10%, via the Irwin–Hall sum of 12 uniforms). | Granovetter, "Threshold Models of Collective Behavior" (1978). A uniform distribution, the first version, always cascades to everyone, which is Granovetter's own point; a normal one makes the outcome contingent. |
| **Leaving town** | After 90 days without a home, or 180 days with nobody in the household earning *and* without enough money for a month's rent: give notice, take all savings out of town, and leave the world physically, with the household (the leaseholder takes the children, a newborn not yet on the household's record included; the other adults are told) | Hirschman, *Exit, Voice, and Loyalty* (1970): exit as the response to decline. Thresholds are placeholders to calibrate. |

## Attention: what a citizen looks at (D43)

A citizen doesn't receive the housing or job market. It looks when it needs to, the way a person reads the listings when they're hunting:
- **Needing a home:** a search of standing rental listings within its budget (the rent rule above), dearest first, the top 20.
- **Needing work:** a search of standing job postings, best-paid first, the top 20.
- **Every wake:** a glance at the petitions board (standing petitions). The running signature counts arrive as an ordinary report.

It then chooses from what it found, as the rules above say. Someone with a home and a job never looks at the markets at all.

## Position: what a citizen can see around it (D44)

A citizen sees the lots touching where it lives and works ("Around you"): what's on each, and how full it is. It sees its household and workmates by name, and nobody else's. The view moves when it moves.

It also uses this to tell whether it's actually in its workplace before leaving it (a citizen whose move into a full workplace failed never entered it). That removed the long-standing `not_present` refusal.

## Word of mouth (D44)

Word of mouth is people telling people, over ordinary messages; the platform passes nothing along.

| Rule | Source |
|---|---|
| **Ties.** The people a citizen shares, or has shared, a home or workplace with: in its own buildings it sees who. The most recent `max_contacts` are remembered. | Granovetter, "The Strength of Weak Ties" (1973): former workmates and housemates are the weak ties that carry news. The cap is a placeholder, after Dunbar's ~15-person "sympathy group". |
| **Asking around.** Starting a hunt for a home, a citizen asks all its contacts with probability `ask_home_bps`; for work, `ask_work_bps`. Still hunting after `ask_again_days`, it counts as a new hunt. | Homes: 37% of renters ask friends or family (Apartments.com survey reported by the National Apartment Association, 2026, n > 15,000; a listing site's own audience, so likely an understatement). Work: 69% of 16–23-year-old job seekers used friends and relatives over a year (Holzer 1987, via Ioannides & Loury, *JEL* 2004); per month it's 15–23% (CPS). |
| **Passing on.** Asked, a citizen names a building where it can see room: for a home, its own building or one next to it; for work, only its own workplace (it's on the inside there). It says only what it can see; it can't know whether the owner is letting or hiring. With probability `pass_on_bps`. | Placeholder. |
| **Following up.** A citizen told about a building searches the listings or postings for it first, and applies to what it finds there before anything on the open market. | Schmidt, "Finding a Home during the Affordable Housing Crisis", *ASR* 2025 (qualitative; 69 renters): ties are leaned on heavily, and leads from them are acted on. |

Code citizens understand only their own phrasing of a question (`ASKING` in the module). A language-model citizen understands anything, and a code citizen won't understand its questions. That's a limit of code citizens, not of the world.

**No coded distortion.** A code citizen acts on the building named, not the words, so garbled wording would change nothing. Distortion arrives with language-model citizens; measurement can compare what was said with what was there.

**Calibration targets (outcomes to measure, never set):**
- Jobs found through friends or relatives: about half (Corcoran et al. 1980: 52% of white men, 47% of women); 30–60% across 24 studies (Bewley 1999). Both via Ioannides & Loury (2004).
- Homes found through ties: no rate found. Qualitative evidence says it's substantial for low-income renters (Schmidt 2025).

**Observed (2 years; measured from the log):**
- **200 citizens:** 116 home hunts and 34 job hunts asked around. 18% of move-ins followed a tip naming that building (31 of 189). No hire did (0 of 19).
- **1,000 citizens:** 18% of move-ins (178 of 981) and 1 of 61 hires.
- **Jobs are far below the target.** Likely reasons:
  - employers don't favour referred applicants (real ones do: Fernandez & Weinberg 1997);
  - insiders know only that there's room, not that the employer is hiring, and a lead is checked once;
  - there are very few hires at all.

  To calibrate, not to tune by hand.

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
- `search_limit` 20
- `ask_home_bps` 3700, `ask_work_bps` 6900, `ask_again_days` 60, `max_contacts` 15, `pass_on_bps` 10000
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
