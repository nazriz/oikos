# Public finance: income tax, rates and grants (phase C, stage C4a)

**Source:**
- `participants/src/behaviour/tax.ts`: the income tax arithmetic;
- `Staffing` in `participants/src/behaviour/firms.ts`: payroll;
- `city.rates_officer` in `participants/src/behaviour/government.ts`;
- `world.valuer` and `world.grants` in `participants/src/behaviour/world.ts`.

Taxes are laws (records), and the institutions that levy, collect and pay are participants. Nothing in the kernel knows about tax. Every figure comes from the world's profile, with its source (docs/profiles.md). For a town, the higher government that taxes income, values land and pays grants is the outside world (D31).

## Income tax, withheld by employers

- **The law.** The outside world publishes an income tax law at the start (`law-income-tax`, kind `law`, `data.tax` = `income`). It gives marginal rates on a year's income above each threshold, a levy on the whole of an income from its own threshold, and the account withheld tax is paid into. The generated town's figures are the profile's: Australia's resident rates for 2025–26, and the Medicare levy.
- **Payroll.** Every employer (factories, shops, the builder, any `Staffing` user) starts a new hire's wages at the agreed wage less what the law says to withhold. It reckons each pay as a year's income, taxes that, and takes a pay period's share, rounded down. The standing order pays the net. Genesis wage orders are written net by the generator.
- **Paying it over.** Each wage paid by one of its orders adds that order's withholding to what the employer owes. Monthly, the employer pays it over to the law's account with a `withholding_report` to the collector. A firm that can't pay it over just fails to; the collector doesn't chase (yet).
- **Employees** read the same public law and expect the net: that's how they know their wages came (docs/behaviour/citizen.md, unpaid wages). What they're owed if unpaid is the gross, as the agreement says.
- **Spending** follows what comes in (docs/behaviour/citizen.md), so tax reaches household budgets through their net pay. The rent-budget rule still reckons on gross income, as rental affordability measures usually do.

**Leaves out:**
- tax on other income (support payments, dividends, rent); the support payments in the generated town are below the tax-free threshold, but dividends and rent aren't;
- the yearly assessment, refunds and offsets;
- the levy's phase-in above its threshold;
- a law that changes during a run (orders keep the withholding they started with);
- the collector chasing an employer that doesn't pay over.

## Rates, on the valuer's valuations

- **The valuer** (`world.valuer`, an office of the outside world) values every property once a year. A property is a lot and its buildings. The valuer skips lots the town itself owns (and any owner the world exempts). The value is the land plus each building on it:
  - **land:** the world's land value per lot. The generator derives it from the profile: the median house price less what the builder charges to build the town's commonest house;
  - **buildings:** what the builder would charge to build each one now (its published prices).

  This is capital improved value, estimated without sales evidence: the town has almost no property sales. Each `valuation` goes to the owner and the town.

  **Who knows what (world.valuer 0.2.0).** Until 0.2.0 the valuer was shown the whole land register and a survey of every cell each month. It now values from its own roll (`roll`, a register it keeps): each property not the town's own as it stood at the start (the lot, its owner, its buildings), each notice of acquisition the land registry sends it when land changes hands, and each `valuation_request` the town's building inspector sends it for something built or brought down. It goes to no property: "Municipal property valuations are undertaken every year under a mass valuation", and a new building is valued "if so requested by the council" (docs/behaviour/knowing.md, section 2). Land the town sells joins the roll by the notice of its acquisition. **Leaves out:** the inspection of sales and of outlying properties, and the five-year rolling look from outside, which a real valuer makes; a building nobody told the council of is never valued.
- **The rating law** (`law-rates`, the town's) gives:
  - a rate in the dollar of value a year (`rate_ppm`, millionths);
  - the instalments (4);
  - the days an instalment falls due after its notice (30);
  - penalty interest on what's overdue (10% a year).

  The generator sets the opening rate to raise the profile's rates per resident from what's rateable. Rates become a steward's lever when budgets can set them (C4b).
- **The rates officer** (`city.rates_officer`, replacing the tax clerk in the generated town):
  - every instalment period, sends each owner a `rates_notice` for their share of a year's rates on their latest valuations;
  - records it as the town's claim against them (`about.kind` rates, with the account to pay and the due date);
  - a month after the due date, and monthly while any stays unpaid, records a month's penalty interest (`rates_interest`) and writes to the owner.

  A payment into the town's account that names the claim (`settles`) settles it. Its report gives the rate, what's been levied and received, and who's overdue.
- **Owners pay.** Landlords pay rates as they pay fines, when they have the money (a non-complying landlord may not). Firms treat rates as debts: they pay them while they can, keeping the next pay period's wages, and unpaid rates count towards insolvency (docs/behaviour/insolvency.md). The builder pays the rates on its yard.

**Leaves out:**
- the rate cap and its regulator (a scenario knob; municipal-economy.md);
- differential rates (residential, commercial);
- waste and other service charges (C4b);
- selling land for unpaid rates;
- landlords passing rates on in rent: their rent rule doesn't see rates yet.

## Grants

`world.grants` (an office of the outside world; v0.3.0) pays the town every quarter: a yearly amount per resident, for the residents the statistician's latest published estimate gives (`population_estimate`: docs/behaviour/boundary.md), with a `grant_payment` statement that cites the estimate. Until 0.3.0 it was shown every cell of the town each month and counted who was in the homes at three in the morning; a funder counts nobody, and pays by the published count (in the profile's place, grants to councils are distributed on the statistician's estimated resident population: Local Government (Financial Assistance) Act 1995 (Cth), to confirm; not opened). With no estimate published it pays nothing and looks again the next day. The same module pays the clinic's, the school's and the police's funding. The generated town's figure is the profile's: general purpose grants per resident.

**Leaves out:** grants tied to purposes (roads, capital works), and equalisation between councils.

## The rent tax, retired

The generated town no longer has `law-tax` (10% of rent, reported monthly), which had no source. Rates are the town's own tax (municipal-economy.md §9 Q3). The modules for a tax on reported income (the landlord's `tax_rate_bps`, `city.tax_clerk`) stay, for worlds that want one.
