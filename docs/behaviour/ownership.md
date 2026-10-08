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

## What an owner knows, and what is looked up (citizen 0.36.0, generator 0.24.0)

Nobody has the land register by heart (Naz, 2026-10-08: "no entity should have a god like view of anything"). Until
0.36.0 every citizen was shown every lot and every title in the town, and every dealing in them, as they were made. Now a
person knows their own papers, and looks the rest up where it is kept:

| | Rule | Source |
|---|---|---|
| **Their own papers** | A title they hold, a transfer of a title to them or by them, a valuation of their lot, the rates recorded against them: each reaches them as a record that names them (their `mine` channel), unasked. | A registered proprietor holds (or can call for) their own title; rates and valuation notices are sent to the owner |
| **The register** | Three channels shown only on request: `lots` (the plan of each lot: its cells), `titles` (claims) and `dealings` (transfers and releases of claims). Each is searched, never read through: a lot or a title by its own id, the dealings in a title by the title they name. The register is public, as before: anyone can search it, nobody is sent it. | A Torrens register is public and is searched folio by folio, for a fee: Land Use Victoria's title search; Transfer of Land Act 1958 (Vic) s 27 (the Register), s 114 (searches) (to confirm) |
| **The plan of their lot** | The first time they plan with a title that is theirs whose lot they have never seen the plan of, they look that lot up (one search). Their home is then the dwelling they live in on a lot of theirs, as before. | A title refers to a plan of subdivision; the plan is a separate search (to confirm) |
| **A title that came from someone else** | When a transfer to them has arrived that they haven't read up on (a home bought, land inherited), they look up the title it names and the dealings in that title (one look: two searches), and read them in the order made: the title is theirs if each transfer in the chain was made by whoever held it then, or by whoever issued the title (the registry, passing on a dead owner's land). Then the plan of its lot, as above. | A purchaser's conveyancer searches the title before settlement and confirms registration after it (Consumer Affairs Victoria, "Conveyancing"; Law Institute of Victoria contract of sale, general conditions) (to confirm) |
| **When** | At the start of a plan (the weekly plan, or the first wake), before anything is decided; the answer comes at once, and the plan is made knowing it. Each thing is asked once; a title is asked about again only when something new passes it to them. | — |
| **The lot under their own home** | The one their title names (before: the register searched for the lot over the building's cell). | — |

So a buyer still pays on the listing's word, and learns the home is theirs when the transfer reaches them and the register
bears it out; an heir learns what they've inherited the same way. Nothing else about owning, buying or selling changed.

**Parameters:** `register` (`{ lots, titles, dealings }`: the person's channels onto the register; none: they know of
the register only what they are shown, as in a world that shows it); `search_limit` (20: the most dealings one search
of a title reads; a title dealt in more often than that reads as not theirs, which a world with such titles should
raise).

**Leaves out:** the search fee (a title search costs a few tens of the currency's units in Victoria: nobody is charged
here, and the registry does no work for it: the search is the kernel's, mechanical); a search *before* buying (a
conveyancer would search before the buyer pays; here the old behaviour is kept, and a listing by someone who doesn't own
the home would take the buyer's money: no code seat lists what it doesn't own); and an heir's view of an inherited
house: they sell it only if they can see it from where they live or work (`street`), which was already so.

## Buying and selling (citizen 0.32.0, bank.lending 0.3.0)

No contract change: a listing, a purchase and a sale are statements, the money is payments, and the title passes by the
holder's transfer.

| | Rule | Source |
|---|---|---|
| **Who sells** | An owner who'd leave town; an owner whose mortgage is in default (sold before the bank takes it; they rent after); an heir holding a house they don't live in (once it's valued in their name). | — |
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

## The land registry (land.registry 0.1.0; until 2026-10-08, the town's registrar)

**Who knows what.** The register of land (the plan of each lot, every title, every dealing) is made and kept by the
land registry: a body of its own (`land-registry`), not the town's. Until 2026-10-08 the town's registrar of deaths
kept it, and because every title was issued in the town's name, every office of the town was shown every lot and
title among its own papers (docs/no-god-view.md). In the profile's place the registry is the state's
(docs/behaviour/knowing.md, section 1).

- **It alone is shown the register whole** (its `keeps`, with the reason).
- **Anyone else asks it for one thing:** the plan of a lot by the lot's number, or the lot a cell of ground is on (an
  address); a title by its number, or the titles to one lot; the dealings in one title. The kernel answers a search
  of the register; the registry does no work for one, and nobody is charged (the fee is in the profile:
  docs/behaviour/knowing.md, "Leaves out"). Nobody may ask it whose land is whose by naming the holder.
- **A transmission on death.** The registrar of deaths, registering a death, applies to it
  (`transmission_application`: who died, and their heir by the law of succession: the partner; else the eldest adult
  child; else the town). The land registry finds each title the dead person held in its register and enters its
  transfer to the heir, as the issuer of the titles. A title's transfer counts only if its holder made it, or whoever
  issued the title (`ownerOf`).
- **Notices of acquisition.** Each time land changes hands (a sale, a transmission) it tells the bodies that keep a
  roll of their own from such notices (`notify`: the valuer and the water corporation): `acquisition_notice`, seen by
  them alone. In the profile's place whoever acquires land gives the notice (to the revenue office, the council and
  the water authority: docs/behaviour/knowing.md, section 2); here the registry sends it, as an electronic lodgement
  generates it.

**The town's own land** is the town's own paper: the titles it holds (addressed to nobody else), and its asset
register (`asset_register`: one document, an entry for each lot it held at the start with its ground and what stood
on it), kept up by the notices of building work the town is given. `ownLand` (`institutions.ts`) reads the three
together. It is paper: whoever relies on a lot being free goes to look at it first.

**Leaves out:** the notice to the council (the town's rates follow the valuer's valuations, which name the owner);
new lots made during a run (none are); a search fee; the days a registration takes.

## In the small town

About 27 of 38 houses owner-occupied (five seeds: 21 to 34), two-thirds of them with mortgages. Every repayment is
made, owners pay their rates, and none goes looking for a rental.

## Leaves out (for now)

- **Savings** (generator 0.23.0) are drawn by age from the profile's distribution (`savings_by_age`), not as a few
  months' pay: some renters have a deposit now (16 of 44 leaseholders in the small town, many of them retirees the bank
  won't lend to on a pension). Owners have savings too, so fewer fall behind and sell (5 listings a year, against 17).
  The poorest have less than before, and more households leave town broke (28 a year against 23).
- **Mortgagee sales:** an owner in default sells; one who didn't would keep the house, as the bank doesn't take
  possession (that needs the registry to act for it).
- **Bargaining:** a home sells at its asking price to the first buyer to pay; no offers, no auctions (common in
  Victoria), no agents, no conveyancing time.
- **Who buys:** only renters wanting a home of their own. Not owners moving house, investors, or newcomers from outside.
- **Owners' deaths, unseen:** a death is registered only when someone sees it, and nobody comes home in the day yet,
  so an owner who dies while the household is out is never found (until the daily round: §6.3).
- Investors buying homes to let; strata; upkeep and renovation; negative gearing; interest-only loans; refinancing.
