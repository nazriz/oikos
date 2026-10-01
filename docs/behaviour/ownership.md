# Home ownership (world-expansion §6.2)

**Source:** the generator (`worlds/generator/generate.ts`, tenure at the start); `citizen.ts` (owners); `credit.ts`
(the bank's mortgages); `institutions.ts` (the land registry passing a dead owner's land on). Figures: the profile's
`ownership`, with sources. No contract change: a home owned is a title (a claim), and a mortgage is a loan agreement.

## At the start (the generator)

| | Rule | Source |
|---|---|---|
| **Who owns** | Each household housed in a house owns it with the chance `house_owner_bps` (72%): its lot's title is the household head's. Flats are all rented (strata titles aren't modelled: a liberty). | ABS Census 2021, tenure by dwelling (to confirm) |
| **A mortgage** | With the chance for the head's age (`mortgage_bps_by_age`: 85% under 45, 55% to 64, 15% from 65), if the household has income: a loan agreement with the bank and a standing order repaying it monthly. The repayment is the median (`mortgage_payment_per_month`, $1,733) or what the bank's rule allows (30% of the household's pay), whichever is less. The term left is 5 to 30 years, and the balance follows at `mortgage_rate_bps` (6.2%). | ABS Census 2021 median repayment; RBA lending rates (to confirm); placeholder term |

(Before the repayment was capped by income, three of 24 mortgages defaulted within 200 days: households with no pay had
been given the median loan. No bank would have lent it.)

## Owners (citizen 0.29.0; selling 0.32.0)

- **Their home:** a lot whose title is theirs (at the start, or inherited), with a dwelling they live in on it. They pay
  no rent and never hunt for a rental.
- **What it costs:** the mortgage repayment counts as housing in the month's budget, as rent does. The other earners in
  the household share it, as they share rent.
- **Rates and bills:** the rates on their lot (and any penalty interest, or a fine) are paid when they come, keeping a
  month's essentials; the water bill comes to them as owners.
- **No tenants' grievances:** an owner isn't aggrieved at a landlord, and doesn't start or sign tenant-protection
  petitions for themselves.
- **Leaving town:** an owner who'd leave (out of work and broke, as a tenant would) sells first (below), and goes once
  it's sold and the mortgage is paid off.

## Buying and selling (citizen 0.32.0, bank.lending 0.3.0)

No contract change: a listing, a purchase and a sale are statements, the money is payments, and the title passes by the
holder's transfer.

| | Rule | Source |
|---|---|---|
| **Who sells** | An owner who'd leave town; an heir holding a house they don't live in (once it's valued in their name). | — |
| **The price** | The valuer's latest valuation (the land, and what building the house would cost now). Unsold after `relist_days` (30), it's relisted for `cut_bps` (5%) less, down to `floor_bps` (80%) of the first asking price. | Placeholders: sellers cut prices the longer a home is on the market (Merlo and Ortalo-Magné 2004, to confirm) |
| **Who buys** | A renting household with income, whose savings cover the deposit and costs (`deposit_bps` 20%, `costs_bps` 5%) of a listed home with the bedrooms it needs. Each month, with the chance `buy_bps_per_month` (1%), it takes the cheapest such home. | APRA's guidance on LVRs (20% deposit); SRO Victoria duty rates (costs); chance a placeholder |
| **The mortgage** | Purpose "a home": the bank lends at `mortgage_rate_bps` (6.2%) over up to 30 years, at most 80% of the price (`max_lvr_bps`), within its usual rule on income (30% at its rate plus the buffer, over the least of the last three months' pay). | RBA lending rates; APRA (to confirm) |
| **Buying** | Once the principal is in: a purchase naming the listing, and the price paid to the seller. Once the title's theirs: notice on the old lease, its rent stopped, and the household moves in. | — |
| **Selling** | Paid in full: the title transferred to the buyer, the listing withdrawn, a sale announced. With a mortgage: the bank's payout figure (what's left, at the loan's rate) paid, settling the loan, and its repayments stopped. Then, if leaving, they go (on a later wake, with what's left). | — |

Neither a home's price nor a mortgage's principal counts as the household's income (it would have been spent at the
shops: a seller once ordered $89,000 of goods with the price of their house).

## The bank (bank.lending 0.2.0)

Loans in force when it first looks (the world's mortgages) are taken on: their repayments as their terms say, followed
for arrears and default as any loan.

## The land registry (city.registry 0.4.0)

Registering a death, it passes the land the deceased held to their heir (the partner; else the eldest adult child; else
the town), recording the transfer as the issuer of the titles. A title's transfer counts only if its holder made it, or
whoever issued the title (`ownerOf`, 2026-10-01; before, any transfer by anyone counted).

## In the small town

About 27 of 38 houses owner-occupied (five seeds: 21 to 34), two-thirds of them with mortgages. Every repayment is
made, owners pay their rates, and none goes looking for a rental.

## Leaves out (for now)

- **Few buyers:** the generator gives people a few months' pay in savings, so almost no renter has a deposit. Homes
  listed go unsold for months, and the sellers, out of work, fall behind on their mortgages. A real wealth distribution
  (ABS Survey of Income and Housing) would give some renters deposits.
- **Mortgagee sales:** a bank whose borrower defaults doesn't take possession and sell; the loan just stays in default.
- **Bargaining:** a home sells at its asking price to the first buyer to pay; no offers, no auctions (common in
  Victoria), no agents, no conveyancing time.
- **Who buys:** only renters wanting a home of their own. Not owners moving house, investors, or newcomers from outside.
- **Owners' deaths, unseen:** a death is registered only when someone sees it, and nobody comes home in the day yet,
  so an owner who dies while the household is out is never found (until the daily round: §6.3).
- Investors buying homes to let; strata; upkeep and renovation; negative gearing; interest-only loans; refinancing.
