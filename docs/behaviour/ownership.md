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

## Owners (citizen 0.29.0)

- **Their home:** a lot whose title is theirs (at the start, or inherited), with a dwelling they live in on it. They pay
  no rent and never hunt for a rental.
- **What it costs:** the mortgage repayment counts as housing in the month's budget, as rent does. The other earners in
  the household share it, as they share rent.
- **Rates and bills:** the rates on their lot (and any penalty interest, or a fine) are paid when they come, keeping a
  month's essentials; the water bill comes to them as owners.
- **No tenants' grievances:** an owner isn't aggrieved at a landlord, and doesn't start or sign tenant-protection
  petitions for themselves.
- **They don't leave town** for being out of work and broke: they hold a house. Selling it first is the next step.

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

- **Buying and selling homes:** no homes come up for sale, so renters can't buy; owners who'd leave can't sell. Next:
  listings, mortgages for buyers, an owner selling before leaving (the BoE housing model's buy/rent decision).
- **Owners' deaths, unseen:** a death is registered only when someone sees it, and nobody comes home in the day yet,
  so an owner who dies while the household is out is never found (until the daily round: §6.3).
- Investors buying homes to let; strata; upkeep and renovation; negative gearing; interest-only loans; refinancing.
