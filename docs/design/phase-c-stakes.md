# Phase C: an economy with stakes (design)

**Status:** 2026-09-28. Naz: "tbh everything you mentioned 1 to 7 I want implemented." After phase B the town's economy runs on goods and work, but nothing is at stake: nobody can go bust, nobody owes anyone, nothing hits from outside, every household owns a slice of every firm, scarcity doesn't raise prices, the state has no levers and workers have no voice. This phase adds the seven things that give a real town its tensions. It absorbs the foundation plan's phase C (the municipal economy, docs/design/municipal-economy.md) as item 6.

Everything here is **behaviour and content** unless flagged. Laws are records, institutions are participants, and the kernel stays physics (no laws in the kernel). Items flagged ⚑ need Naz's decision; ⚑⚑ would change the kernel or contracts and are held until he signs off.

## 0. First: a sourced baseline (calibration)

Tension has to come from the rules, not from placeholder numbers. Before anything else, every economic placeholder gets a source, and outcomes are measured against targets (docs/calibration.md: never tune a rule by hand to hit a target).

| What | Now | Sourced |
|---|---|---|
| Wages | shop $1,200, factory $1,500 a fortnight (below the minimum wage) | Award rates, Fair Work Commission (General Retail, Manufacturing, Building and Construction awards) |
| Rents | $700–1,550 a month | Median weekly rents for regional Victoria (Homes Victoria, *Rental Report*) |
| Spending | essentials + 30% of savings above a buffer, *every month* | Spending tied to income: the household saving ratio (ABS, *Australian National Accounts*); a wealth effect of a few cents per dollar a year (Dvornak & Kohler 2003, RBA RDP 2003-07) |
| Retirement | nobody retires; every adult looks for work | Age Pension age 67 (Services Australia); retirees don't look for work |
| Ownership | every household owns every firm, by savings | Wealth concentration (ABS, *Household Income and Wealth*): the top fifth hold about 60% of wealth; part of each firm owned from outside the town |
| Goods, inputs, productivity | placeholders | ABS input–output tables (manufacturing's input share); ABS retail trade (margin); labour productivity by industry |
| Exports | a boundary condition | Still set by the researcher; the town's figure chosen openly so employment starts near ABS rates, and documented as chosen, not sourced |

Targets (docs/calibration.md): employment-to-population (ABS Labour Force, about 64%), unemployment (about 4%), the household saving ratio, rent as a share of income, the retail margin.

## 1. Credit and debt

**Why:** debt is where most economic distress comes from: arrears, defaults, credit crunches, and the politics of who gets rescued.

- **The bank lends** (a bank lending module beside its payment system): personal loans, and business loans for working capital, entry and expansion.
  - **Assessment**, as Australian lenders do: repayments within a share of income, with the regulator's serviceability buffer (APRA, APG 223: assess at the rate plus 3 percentage points); for firms, cash flow and security.
  - **A loan is an agreement:** the bank pays out the principal; the borrower repays monthly by standing order, principal and interest, over a term (the credit-foncier formula).
  - **The rate** is the bank's own: a margin over its funding cost.
- **Funding:** the bank lends its own capital and deposits' worth of funding it borrows from outside (the national market: an edge), at a rate the researcher sets (the cash rate plus a spread). A small town's bank is a price-taker on funding.
  - ⚑⚑ **Money creation.** Real banks create deposits when they lend. The kernel conserves money (only edges can go negative), so here the bank lends what it has or borrows. Modelling deposit creation would let a bank's own books go negative: a physics change, held for Naz. Recommend: funding from the edge now (it has the same effect on the town: new money arrives when loans are made), and deposit creation only if a study needs the bank's balance sheet itself.
- **Arrears and default:** a missed repayment is arrears (the bank sees what didn't arrive); after a set time it's default. What the bank may then do is law content: calling in the loan, taking a secured asset, a judgment debt. Households in default are credit-impaired (the bank records it and won't lend again).
- **Leaves out:** mortgages and home ownership. ⚑⚑ They need a housing sales market (the town only rents): ownership transfers exist (claims), but pricing, valuation and settlement are a design of their own. Recommend as a follow-up.

## 2. Firms that fail, and firms that start

**Why:** a factory closing is the classic town crisis. With no exit and no entry, the economy can't lose or find capacity.

- **Insolvency** is law content (after the Corporations Act 2001, s 95A: a company unable to pay its debts as they fall due). A firm that can't cover its wages and repayments for a set time closes:
  - it lets its staff go;
  - an external administrator (an office of the outside world, as ASIC-registered liquidators are) sells its stock and property, pays creditors in the legal order (employees' entitlements first, then secured, then others), and passes on any remainder to the shareholders;
  - its premises go to let or for sale.
- **Entry:** entrepreneurs start firms where there's money to be made. The signals are sustained unmet demand, high margins, and empty premises to let. A household with savings (or an investor from outside) creates a firm (an entity), leases or buys premises, borrows (item 1), hires, and starts trading. Rates are compared with ABS business entry and exit (*Counts of Australian Businesses*).
- **Sources:** entry and exit rules after the agent-based macro literature where firms go bankrupt and are replaced (Assenza, Delli Gatti & Grazzini 2015, *JEDC*; Dosi et al. 2010, *JEDC*), with entry responding to profitability rather than replacement one for one.

## 3. Concentrated ownership

**Why:** distributional conflict comes from who owns what.

- Shares in each firm and each landlord are held by a few households, following ABS wealth quintiles, and a sourced share is owned **from outside the town** (dividends leave).
- Landlords are owned by the town's wealthiest households, or from outside.
- Everything downstream follows: dividends go to few; rent flows to owners; a closure or a rent rise hits different people differently.

## 4. Shocks

**Why:** a steward is only tested by the unexpected.

- **World prices and demand move.** The world market's prices for inputs, materials and goods, and its demand for the town's goods, follow a sourced stochastic process: an AR(1) in logs, with volatility from the RBA's Index of Commodity Prices.
- **Scripted scenarios**, a researcher-set schedule: an export customer lost, an input price spike, a funding-cost rise.
- ⚑⚑ **Physical hazards** (a flood on the river lots, a fire) damage buildings. That needs physics: structures taking damage. The wear variable is a start, but damage that stops a building being used is a kernel rule. Held for Naz, with a proposal.

## 5. Prices that bite

**Why:** scarcity has to reach people as cost, not only as queues.

- **Rents rise when housing is tight.** Landlords raise the asking rent when their homes let fast, and raise rent at renewal, within what the law allows. Victoria allows one increase in 12 months, with 60 days' notice (Residential Tenancies Act 1997, s 44). The BoE model's rent rule already cuts unlet rents; its counterpart raises them.
- **Wages and prices pass each other on:** the Lengnick wage rule (vacancies raise wages) and price rule (marginal cost moves the bounds) already link them. With shocks, that gives a cost-of-living squeeze.
- **Shops' prices:** Lengnick's bound (1.15 × marginal cost) stays, but unmet demand is part of demand, so shortage raises prices as far as the bound allows. What's left is entry (item 2).

## 6. Government with levers and duties

**Why:** a steward needs something to steer with, and a budget that has to balance.

- **The town** (the municipal economy, docs/design/municipal-economy.md, with its decisions taken as recommended):
  - rates on capital improved value, replacing the unsourced rent tax, with a state valuer and an optional rate cap;
  - grants per resident;
  - council staff;
  - waste collection and maintenance of the town's assets as work;
  - a budget with real lines.
- **The Commonwealth**, as the outside world (D31: an edge's participants):
  - income tax withheld by employers (PAYG) at the ATO's scales, paid out of the town;
  - JobSeeker for the unemployed and the Age Pension for retirees, paid into it, at Services Australia's rates.
- **The steward's levers** are the town's: rates, services, staff, spending. The Commonwealth's settings are world parameters (a researcher can change them, or put a second steward there later: phase F).

**As built (C4), in two steps.** Every figure is in the world's profile, with its source. The national government is the outside world's offices (docs/profiles.md: no place in the code).
- **C4a, revenue:**
  - **Income tax withheld by employers.** The outside world publishes the tax law (brackets, as a law record from the profile). Every employer's payroll (`Staffing`) pays the wage less what the law says to withhold, and sends what it withheld to the outside monthly, with a report. Support payments aren't taxed (below the tax-free threshold for the payments the profile gives; noted).
  - **Rates replace the rent tax.** The outside world's valuer values every privately owned property once a year (land per lot, from the profile, plus the builder's published price for the building on it) and publishes each valuation to its owner. The town's rating law (a law record: a rate in the dollar of value, adopted with the budget) is applied by the rates officer (the tax clerk, evolved). It sends each owner a quarterly notice, records the rates as a debt, and adds penalty interest to what's overdue. Owners (landlords, shops, factories) pay as they pay other debts, so unpaid rates count toward a firm's insolvency. The town doesn't rate its own land.
  - **Grants:** the outside world pays the town quarterly, an amount per resident (from the profile), counting the residents it can see.
- **C4b, services** (with the physics phase B already built: structure variables and tasks that change them):
  - **Waste** builds up in homes per occupant per day. A works crew (council staff: ordinary employment with the town, hired by the works manager, paid by the finance officer as payroll) collects it from the depot, a street's worth at a time, within its hours.
  - **Wear** comes on the town's parks and buildings per day. The crew maintains what's most worn.
  - **Service levels follow from staffing,** and staffing from the budget, which gets real lines (staff, maintenance, parks).
  - **Citizens complain** when their bin is overflowing (a letter to the town, with a propensity), and the complaints reach the mayor's reports.
- **Deferred:** the mayor/CEO framing (a study choice: municipal-economy.md §9 Q2); streets; the rate cap and its regulator (a scenario knob, later); contracting services out.

## 7. Workers' voice

**Why:** wages set only by employers leave out half of the labour market's politics.

- **A union** is an organisation that workers join (ABS, *Trade Union Membership*: about 12.5% of employees in 2022; higher in manufacturing and construction).
- **Bargaining.** When real wages fall (prices up, wages flat) or profits rise, the union asks for a pay rise in an enterprise agreement. The employer accepts, counter-offers or refuses, by its own rule.
- **Protected action**, after the Fair Work Act 2009, Part 3-3: a ballot of members, notice, then a strike. Striking workers withhold their labour: they leave the workplace, so no work gets done. The employer can concede, hold out, or lock out. A strike ends by agreement.
- **Rates** are compared with ABS *Industrial Disputes* (working days lost per 1,000 employees).

## Stages

Each stage ends with all tests green, its docs (sources), and a line in docs/decisions.md.

| Stage | What |
|---|---|
| C0 | Sourced baseline (§0), ownership (§3), and measurement against targets; the goods economy's queries |
| C1 | Prices that bite (§5); shocks: stochastic world prices and scripted scenarios (§4) |
| C2 | Credit (§1): lending, repayment, arrears, default |
| C3 | Failure and entry (§2) |
| C4 | Government (§6): the Commonwealth's taxes and payments; the town's rates, grants, staff and services |
| C5 | Workers' voice (§7) |
| C6 | Long, large runs (the 1,000-person town, five years, several seeds); calibration against the targets; a gap-finding pilot with a real model (gpt-6-sol as the steward, gpt-6-luna translating) |

Held for Naz (⚑⚑): money creation by banks, a housing sales market with mortgages, and physical hazards. Each needs physics, and each gets a proposal of its own.
