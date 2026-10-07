# Who owns firms; and a retirement fund, off unless a world asks for one (`fund.retirement` v0.1.0)

**Source:** the generator (`worlds/generator/generate.ts`: who holds each firm at the start); `participants/src/behaviour/fund.ts` (the retirement fund's trustee); `lengnick.ts` (`distribute`: how any firm pays its holders, unchanged). Figures: the profile's `firm_ownership` (and `retirement_fund`, for a world that has one), each with its source. No contract change: a firm's holders are a statement it keeps (`shareholders`); where there is a fund it is an organisation with an account and an office, and its members are a statement it keeps (`fund_members`).

**In since 2026-10-08, by Naz's decision, with the retirement fund off.** It replaces "every household holds shares in every firm" (below: what it was). The shape is what was proposed: shops and landlords run by their owners, factories mostly held from outside, a minority of households holding shares directly. The retirement fund that was proposed with it is **not in the generated town**: Naz has not decided on such an institution for the baseline, and as built it sits on idle money (below). Its module, its figures and its tests stay, for a world that asks for one (`retirement_fund: true` in the town's description).

## What it was

Every household's head held shares in every factory, shop and landlord, in proportion to the household's fifth of wealth (the ABS shares of net worth by quintile), with a part of each firm held from outside (80% of a factory, 20% of a shop, 30% of a landlord: placeholders). A firm's dividend was a payment to every household in town. Nobody anywhere owns a slice of every corner shop.

## How firms are held (the generator)

Each firm is held in one of three ways. Of each kind of firm, the profile says what share is held each way (`forms_bps`); the count is rounded, and which firms, drawn.

| Way | Who is on the register | The first profile | Based on |
|---|---|---|---|
| **Closely held** | One household, or a few (`closely_held.households_bps`: one 85%, two 12%, three 3%), in equal parts: the firm's owners. The holder is the household's head. Who: drawn by the household's fifth of wealth (`owner_wealth_fifth_bps`: the highest fifth 85%), and no household owns a second business while another that could own one has none. | 80% of shops, 70% of landlords | Small businesses are their owners': 97.4% of businesses have under 20 employees [1]; about two-thirds are family businesses [2, to confirm]; 85% of the value of households' business assets is held by the wealthiest fifth [3]; a landlord is a household with investment property, 70% of them with one [4]. |
| **From outside** | The outside world alone: a branch of a company from elsewhere, an investor who lives elsewhere. What it pays its owners leaves town. | 20% of shops, 30% of landlords (placeholders, carried over) | To source. |
| **Widely held** | Part from outside (`widely_held.outside_bps`, 80%: a placeholder, carried over). The town's part: the households that hold shares directly, all of it. (In a world with a retirement fund: the fund first, for its members, `retirement_fund.share_bps_of_local`, 72%, and direct holders the rest.) | Every factory | A works of 40 is a medium business, the nearest thing the town has to a company. |

**Households that hold shares directly.** A household does with the chance of its fifth of wealth (`direct_holders.by_wealth_fifth_bps`: 8%, 25%, 35%, 50%, 72%: 38% of all [3]; the middle two are placeholders). It holds a few of the widely held firms (`firms_held`: one to four, a placeholder), each in proportion to its wealth (its members' savings). A widely held firm nobody in town holds directly is held from outside altogether (with a fund: the fund has the town's whole part); so is the share or two that dividing leaves over. Every holder on a register has an account, so nothing a firm pays goes nowhere.

Wealth here is cash: the savings the generator drew for the household's members. Homes aren't counted (most of real wealth), so the fifths are fifths of savings.

**In the 1,000-person town** (seed 1; 429 households, 60 firms): 38 firms closely held by 45 households (32 with one owner, five with two, one with three; 39 of the 45 in the wealthiest fifth), 12 held from outside, the 10 factories widely held, each by 30 to 48 holders: the outside world with 80%, and the 20% that is the town's among 29 to 47 households. 150 households (35%) hold shares directly: 3%, 31%, 33%, 35% and 73% of the fifths, and the wealthiest fifth has 71% of what's held directly (in Australia about four-fifths [3]; not set, it follows from holding by wealth). 169 of the 429 households hold something; 260 hold nothing. All the registers together have 438 lines (they had 25,800); at 3,000 people 1,308 (224,460), at 10,000 people 4,656 (2,472,000), and the whole starting data 8.1, 24.5 and 92.6 MB (it was 9.6, 38.3 and 244.0).

## The retirement fund (off unless a world asks for one)

**Off by default, and why.** The generated town has no fund: no organisation, account, office or register of members, and nothing is paid to one (a test checks each). Naz's decision of 2026-10-08: the baseline should not hold an institution he has not decided on, and this one keeps money idle. With the factories' town part as its only holding, it pays its retired members a little and keeps the working members' part, 1.1 to 2.0 million after a year in the 1,000-person town, in a bank account with nothing to buy (shares aren't traded and there is no market to invest in). A world turns it on with `retirement_fund: true` in its description; the figures are the profile's `retirement_fund` (kept, with their sources), and a profile without them is refused. What follows describes the fund in such a world, as it was measured on the branch that proposed it.

An organisation of the town (`fund`, the town's Retirement Fund), with an account at the bank and one office, its trustee (`fund-trustee`), run by `fund.retirement`. Anyone could hold the office: a model, a person.

**Members** (the generator): the profile's share of adults (`retirement_fund.member_bps`, 84% [6]), each with units: the years of working life behind them (from 18 to the retirement age: a placeholder for a balance, which grows with the years of contributions). The fund keeps the register (`fund_members`: member, account, date of birth, units), and only the fund sees it.

**What it does** (`fund.retirement`), every `pay_every_days` (30 [7]):
1. **Takes what has come in:** what it holds beyond what it keeps for members. The firms it holds shares in pay it as they pay any holder.
2. **Pays its costs** out of that (`cost_bps_of_income`, 15%: fees of about 1.1% of assets a year [8, to confirm] over a return of 7.4% [9]), to its administrator (outside the town: a fund's administration and investment managers are elsewhere).
3. **Credits the rest to members by their units.**
   - A member below the access age (`access_age`: the generator gives the profile's retirement age, when people here stop work) is paid nothing: their part is kept for them, in the fund's account.
   - A member from that age is paid their part as it comes, as a pension, and with it what was kept for them before, at the yearly rate for their age (`drawdown_bps_by_age`: 4% under 65, 5% to 74, 6% to 79, rising to 14% from 95: the least an account-based pension must pay [7]).
4. **On a member's death** (as registered): what was kept for them is paid to their account, which is their estate's (the bank settles it: docs/behaviour/bank-payment-system.md); their units end.
5. **A member who has left town** is paid nothing more here; their part is kept.

All a period's payments are one instruction to the bank. Every `report_every_days` (a year) it reports publicly what it took in, what it cost, what it paid and what it keeps (`fund_report`).

**Its share of the factories:** of the town's part of each widely held firm, `share_bps_of_local` (72%): households' retirement savings are two and a half times their direct equity (72% to 28%) [5]. Direct holders have the rest.

**What this is, and isn't.** A retirement fund pays pensions and lump sums to members who have retired, not dividends to everyone's current account: in the year to March 2026 Australian funds paid out 143.5 billion (pensions 63.8, lump sums 79.7) against 226.1 billion contributed [9]. This one does that work with what the town has: a slice of ten factories. It is small beside real retirement savings (below).

**In the 1,000-person town with the fund on** (a year, three seeds, measured on the branch before the fund was turned off): 666 members, about 140 of them retired, in 104 households. The factories pay the fund 1.8 to 3.3 million a year (about a seventh of what they pay out). Of that, 15% goes on costs, 0.44 to 0.83 million is paid as pensions (a retired member's household gets about 4,600 a year, the median; a pension from outside is 31,000), and the rest is kept for working members: 1.1 to 2.0 million by the year's end, lying in the fund's account. That money has left the town's spending until those members retire, and there is nothing for the fund to do with it meanwhile.

## What changed in the 1,000-person town

A year, three seeds each: every household in every firm (main, with the fix to how deaths are made known) against this, with no fund (docs/decisions.md, 2026-10-08, has the table and how it was counted). Households are the 368 or so of the 429 at the start whose head had neither left nor died by the end. Income is wages, dividends and support from outside; z is the difference in standard errors (three seeds a side).

- **Who is paid dividends:** every household before (369); 142 after, the owners and the direct holders. Households had as much in dividends in all (7.0 million a year against 7.6: within what seeds differ by), in far fewer hands: the most any household was paid went from 64,000 to 311,000, and a household paid any had 131,000 a year of income where one paid none had 80,000.
- **Incomes spread out.** The median household's income fell from 103,000 to 83,000 (z -4.2) and the tenth percentile's from 52,000 to 31,000 (z -8.9); the ninetieth rose from 160,000 to 182,000 (z 3.1); the mean did not move (101,500 to 99,700). The Gini coefficient of household income went from 0.264 to 0.336, the top fifth's share from 33% to 40%. Before, dividends were a fifth of household income and reached everyone; they are still a fifth of household income.
- **Spending moved with them, and the total held.** The median household spent 63,000 at the shops (75,000 before; z -2.5); all households together 27.7 million against 27.9.
- **Eleven fewer adults in town at the year's end** (729 against 740), all of them of working age (565 against 576: z -5.3, the one thing in the platform's own measures beyond seed noise, with the labour force that follows from it). In two seeds fewer people came (49 and 42 against 79 and 55); in the third more left (130 against 120). The likely cause is the one the branch gave: a household out of work used to have its dividends to live on, and now leaves sooner, or does not come. Not traced household by household.
- **Leases and moves** did not move (19 to 20 leases; 48 to 42 move-ins, z -0.7), nor jobs held, unemployment, rent against income or the money paid to the town.

**With the fund on** (the branch's measurement against main, before the deaths fix; the same count): 147 households paid a dividend and 104 a pension from the fund; the median 81,000, the tenth percentile 36,000 (the fund's pensions go to retired households, who are at the bottom), the ninetieth 178,000; Gini 0.330; the most any household was paid 242,000; nine fewer adults. The fund kept 1.1 to 2.0 million out of the town's spending by the year's end. So the fund softens the bottom a little and takes from the top holders, at the cost of that idle money; the shape is the same with and without it.

## Parameters (`fund.retirement`)

| | Default | In a town that asks for a fund |
|---|---|---|
| `administrator_account` | (the world must say) | the outside world's |
| `access_age` | (the world must say) | the profile's retirement age (67) |
| `cost_bps_of_income` | 0 | 1500 |
| `pay_every_days` | 30 (placeholder) | 30 |
| `drawdown_bps_by_age` | none: only what comes in is paid | the profile's |
| `report_every_days` | 0 (never) | 365 |

## Leaves out (for now), and why

- **A national portfolio.** A household's shares, and a fund's, are mostly in companies elsewhere, and the dividends come in from outside. Here the town's part of its own factories stands for that. The other way (holdings in the outside world, paid from it) adds money coming into the town that nothing here earns; it would be a boundary condition to choose, as export demand is.
- **Contributions.** Real funds grow by what employers pay in for their workers (a law, and a tenth or more of the wage bill). Here the fund takes none and admits no members: it would take in money with nothing to buy (shares aren't traded, and there is no market to invest in), so it would be a drain on the town's spending. With a market for shares, or holdings outside, this is the next step. Until then the fund runs off: over decades its members die.
- **Retirees' own savings.** A retiree here starts with a large sum in the bank (`retiree_savings`), which stands for what a real retiree has in their fund. Moving that into the fund, paid as a pension, would be the realistic form; it changes what every retiree spends, so it's a separate decision.
- **Balances by age and by pay.** Units are years worked. Real balances follow pay and its history, and differ between men and women.
- **Lump sums, and a member's choices.** A real member can take a lump sum, more than the least, or a different payment day.
- **Statements to members.** A real fund writes to each member every year. A citizen here learns of the fund when it pays them.
- **Trading.** Shares aren't bought or sold, so holdings never change hands but by a firm's founding (its founder holds it: docs/behaviour/entry.md) and winding up. A shareholder who dies stays on the register, and what's paid to their account goes to their heirs; one who leaves town is still paid.
- **Owner-managers who work in the business.** A closely held shop's owners are paid its profits; its manager is still the shop's own office, and its staff are employed as before. The owner drawing a wage from their own shop, or working its counter, isn't modelled.
- **Voting.** Holders don't vote on anything; a firm's manager decides.
- **Who owns the bank, the builder, the utilities and the paper:** nobody, as before (they pay no dividends).

## Sources

Each read 2026-10-08.

1. ABS, *Counts of Australian Businesses, including Entries and Exits*, July 2022 to June 2026 (released 18 August 2026): 2,814,778 businesses; 1,499,077 with no employees, 689,600 with 1 to 4, 232,912 with 5 to 19, 68,325 with 20 to 199, 5,366 with 200 or more; companies 1,271,197, sole proprietors 848,300, partnerships 196,015. https://www.abs.gov.au/statistics/economy/business-indicators/counts-australian-businesses-including-entries-and-exits/jul2022-jun2026
2. KPMG and Family Business Australia, family business surveys (2021, 2022): family businesses are 67% of Australian businesses. **(to confirm:** seen only as quoted by others; the Parliamentary Joint Committee on Corporations and Financial Services, *Family Businesses in Australia* (2013), gives "on some estimates" 70%; its pages would not open.)
3. RBA Bulletin, April 2009, "The Composition and Distribution of Household Wealth in Australia" (HILDA 2006): equities held directly by 38% of households; 72% of the wealthiest fifth, 25% of the second fifth, 8% of the lowest; the wealthiest fifth held about four-fifths of their value (as read; the exact figure to confirm), and 85% of the value of business assets. https://www.rba.gov.au/publications/bulletin/2009/apr/2.html . Also RBA Bulletin, March 2012 (HILDA 2010): 34% of households held equities directly, down from 39% in 2002. https://www.rba.gov.au/publications/bulletin/2012/mar/3.html . And ASX, *Australian Investor Study 2023* (media release, 20 June 2023): 7.7 million adults, 38%, hold listed investments. https://asx.com.au/content/dam/asx/about/media-releases/2023/29-20-june-women-younger-australians-lift-number-of-adult-investors.pdf
4. RBA Bulletin, May 2026, "Insights from New Data on Australian Housing Investors": about 2.3 million individual investors (a tenth of the working-age population); about 70% own one investment property, and the 30% with more own about half; nearly 40% of investors are in the top fifth of incomes. https://rba.gov.au/publications/bulletin/2026/may/insights-from-new-data-on-australian-housing-investors.html
5. ABS, *Australian National Accounts: Finance and Wealth*, June quarter 2026: households' financial assets 9,059.9 billion: superannuation reserves 4,433.1, shares and other equity 1,749.5, currency and deposits 1,959.5. https://www.abs.gov.au/statistics/economy/national-accounts/australian-national-accounts-finance-and-wealth/latest-release
6. RBA Bulletin, June 2016, "Household Wealth in Australia: Evidence from the 2014 HILDA Survey": 84% of households held superannuation (about half of non-housing assets); direct equities 15% of non-housing assets, business assets 11%; a fifth of households own other property. https://www.rba.gov.au/publications/bulletin/2016/jun/1.html
7. Moneysmart (ASIC), "Account-based pensions": paid monthly, quarterly, half-yearly or yearly; the least to be paid a year by age (4% under 65 to 14% from 95); from preservation age with a condition of release; at death, to a beneficiary or the estate. https://moneysmart.gov.au/retirement-income/account-based-pensions
8. Productivity Commission (2018), *Superannuation: Assessing Efficiency and Competitiveness*: fees fell from 1.3% of assets in 2010 to 1.1% in 2016. **(to confirm:** seen only as quoted by others.)
9. APRA, *Quarterly superannuation statistics*, March 2026 (published 28 May 2026): assets 4,437.9 billion; in the year, contributions 226.1 billion, benefit payments 143.5 billion (lump sums 79.7, pensions 63.8); rate of return 7.4%. https://www.apra.gov.au/quarterly-superannuation-performance-statistics-highlights-march-2026

**The general pattern, elsewhere.** In the United States in 2022, 21% of families held stocks directly and 58% directly or through funds and retirement accounts; of those holding directly the median held 15,000 dollars and the mean 404,000; 20% of families owned a privately held business (14% of the lower half by income, nearly half of the top tenth), median value 90,000, mean 1.6 million (Federal Reserve, "Changes in U.S. Family Finances from 2019 to 2022", October 2023, https://www.federalreserve.gov/publications/october-2023-changes-in-us-family-finances-from-2019-to-2022.htm). The same shape as [3]: a minority holds shares directly, a few hold most of the value, most households' stake in companies is through retirement funds, and small firms are their owners'.

**Not found, or not opened:** who owns a regional town's shops and factories (local family, a chain, a company elsewhere): the outside shares stay placeholders. ABS, *Economic Activity of Foreign Owned Businesses in Australia* would give the foreign part by industry (its tables did not open). The ATO's pages (rental interests by number of properties; when a member may draw) refused the request; the RBA [4] and Moneysmart [7] cover both.
