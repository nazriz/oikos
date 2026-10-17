# Public finance: income tax, rates and grants (phase C, stage C4a)

**Source:**
- `participants/src/behaviour/tax.ts`: the arithmetic of tax on pay;
- `Staffing` in `participants/src/behaviour/firms.ts`: payroll;
- `city.rates_officer` in `participants/src/behaviour/government.ts`;
- `world.valuer` and `world.grants` in `participants/src/behaviour/world.ts`.

Taxes are laws (records), and the institutions that levy, collect and pay are participants. Nothing in the kernel knows about tax. Every figure comes from the world's profile, with its source (docs/profiles.md). For a town, the higher government that taxes income, values land and pays grants is the outside world (D31).

## Tax on pay: a law that is a list of charges, withheld by employers (2026-10-08)

**The law's words** give each charge's bands by where they begin, and the first by where it ends ("nothing up to 18,200, 16% above 18,200": until 2026-10-09, "0% above 0").

**The law.** The outside world publishes a tax law at the start (`law-income-tax`, kind `law`, `data.tax` = `income`, `data.charges`). It is a list of **charges**, in the law's own order. A place with no charge on pay has no such law, and nothing is withheld. Each charge is data in four parts (`Charge`, `participants/src/behaviour/tax.ts`); every sum is a year's, in the smallest unit of the world's money:

| Part | Says | Forms |
|---|---|---|
| `base` | what it is charged on | a year's pay (nothing said); `less`: what is taken off first: an allowance (`amount`, which may taper away: `tapers: { above, bps }`, lost at that share of each unit of pay above a sum), a share of the pay within a least and a most (`share_bps`, `least`, `most`), or what other charges of the law take (`charges: [...]`: contributions deducted before a tax); `up_to`: a ceiling, pay beyond it is not charged; `from`: a threshold, nothing is due on pay below it and all of it is charged from there; `on`: another charge's amount in place of pay (a surcharge on a tax) |
| `schedule` | the rates | bands of marginal rates (`from`, `rate_bps`); one band from nought is a flat rate; a band may have a rate that rises in a straight line to its end (`rising_to_bps`), and its charge is the area under the line |
| `reliefs` | what is taken off the charge | a sum (`amount`, which may taper as an allowance does); `none_due_up_to`: nothing is due where what is charged is no more than a sum (a rebate that leaves low incomes untaxed). Never below nought |
| `collector`, `account` | whom it is paid to | the general government, a named fund or body of it, or the town. In a profile: `paid_to` (one of `public_finance.funds`, or `"town"`; nothing said: the general government) |

A charge may also say `itemised`: the employer's report of it names each worker and their pay in the month. That report is the record a payment that turns on contributions is decided on (docs/behaviour/boundary.md, `world.transfers`).

**The arithmetic** (`chargesOn`, `annualTax`, `withheld`). A charge on a year's pay: nothing if the pay is below `from`; else the pay (or the other charge's amount), held to `up_to`, less the deductions, never below nought; the schedule on that, each band rounded down; less the reliefs. What is withheld from one pay, in three steps (`withheld`, the one reckoning of it: the opening wage instructions, every employer's payroll, a worker's check of their own pay and a payment reckoned on net pay all call it): the pay as a year's pay, by days (the pay times 365 over the days it is for, rounded down); every charge on that; and the sum of them times the days over 365, rounded down once. Each charge's part is rounded down and what that leaves over (a unit or two) goes to the first charge that takes anything, so the parts add up to the whole. **The law's own text says these steps and each rounding** (`withholdingInWords`, since 2026-10-09), because the step a reader takes from habit is another: a year as a whole number of pays (26 of 14 days). The world's year is 365 days, 26.07 such pays, and the two routes differ by a little on every pay wherever rates step (0.30 on an Ohio works wage; a finance seat that took the calendar's route withdrew eight workers' wages over it). A real payroll's percentage method is the same shape (a pay made a year's, the year's tax, a pay's part of it), with a calendar's whole pays where this world has days.

**A law in the short form** (`data.brackets`, `levy_bps`, `levy_from`, `account`: how every law was written until 2026-10-08) is read as the two charges it is: marginal rates on a year's pay, and a levy on the whole of a pay from a threshold, both paid into one account. The sums are the same to the smallest unit (tested on a ladder of incomes; and all nine towns ended at the same state with the new arithmetic reading the old laws).

**Payroll** (`Staffing`, `firms.ts`). Every employer (factories, shops, the builder, the town's finance officer) starts a new hire's wages at the agreed wage less what the law's charges withhold. The standing order pays the net. Genesis wage orders are written net by the generator.

**Paying it over.** Each wage paid by one of its orders adds what that order withholds, charge by charge, to what the employer owes. Monthly it pays what it owes into each charge's own account and sends the collector one `withholding_report`: what was owed and paid, under each charge (`data.charges`: `charge`, `to`, `withheld`, `paid`) and, where a charge is itemised, each worker's gross pay since the last report (`data.staff`: `worker`, `gross`). A law whose charges all go to one account, none itemised, is reported as one sum, as before. Short of money, the employer keeps the next pay period's wages, pays the charges in the law's order as far as the money goes, and still owes the rest. The collector doesn't chase (yet).

**Returns on the law's days** (2026-10-12; docs/behaviour/firms.md). The law lists its returns (`data.returns`: each with the charges it reports, `every_months`, and `day`, counted from the first day of the month after the period, or `in: "same"` from the first day of the period's last month), from the profile's `public_finance.returns`. Every employer files each return on its day, and the finance office's books name the next. The world's months are 30 days from the year's first day, the twelfth taking the last five. A law that lists none has every charge reported on the first day of the month after.

**Employees** read the same public law and expect the net: that's how they know their wages came (docs/behaviour/citizen.md, unpaid wages). What they're owed if unpaid is the gross, as the agreement says. **The payments office** reads it too, to reckon pay after tax where a payment is a share of net pay.

**Funds.** A named fund or body (`public_finance.funds` in a profile: a pension insurance, a health fund) is, in a town, an account of the outside world's of its own (`acc-outside-<id>`), named in the law's words. It is not an organisation with an office: contributions go into it and the payments the law says it pays come out of it, and like the outside world's own account it is not limited by what the town pays in (a national fund is large next to a town). A world that brings the higher government inside would make each fund an organisation.

**In the nine profiles** (each profile's note on `public_finance.income_tax` says what was moved and what was said for the first time, with its source):

| Profile | Charges | Said truly since 2026-10-08, from the author's note | Still a stand-in or left out |
|---|---|---|---|
| au-vic-2026 | income tax; Medicare levy | (the same figures, moved) | the levy's phase-in |
| mx-jal-2026 | ISR | (the same figures; the levy of nought is gone) | the employment subsidy, the worker's social-security share (no figures in the note) |
| jp-akita-2026 | income and resident tax; social insurance premiums | the premiums are a charge of their own, paid to social insurance, reported worker by worker | the author's fitted rates stand for the deductions and the two taxes; the premiums are not split |
| de-ni-2026 | Einkommensteuer; pension, health, care and unemployment insurance | four contributions, each to its own body; the pension and health ceilings | the tariff is the author's steps, not the continuous one; no ceiling for care and unemployment; the solidarity surcharge; the employer's share |
| us-oh-2026 | federal and state income tax; Social Security; Medicare | FICA's two parts, each to its fund; the wage cap | the municipal income tax (the note gives a range, not this town's rate), school-district taxes, credits |
| br-mg-2026 | imposto de renda; INSS | the INSS table by slices, with its ceiling, paid to the INSS | the income tax's reduction is the author's three steps |
| ke-nakuru-2026 | PAYE; health insurance; housing levy; NSSF | the personal relief off the tax; the two levies each to its body; the NSSF contribution (new: it lowers net pay by 6%) | the NSSF earnings limit; contributions deducted before tax; the employer's share |
| gb-eng-2026 | Income Tax; National Insurance | the allowance as a deduction that tapers away; National Insurance at its two rates on pay above the threshold (it was 8% of the whole of a pay) | employers' National Insurance |
| in-tn-2026 | income tax; cess | the rebate below 12 lakh; the cess as a charge on the tax | the standard deduction (no figure in the note) |

**Leaves out:**
- a charge the employer bears on top of the wage (employers' contributions): firms' reckoning of what a worker costs would have to read it;
- credits paid out as money (a refundable credit, a credit for children), and anything else settled once a year: there is no yearly assessment, so no refunds or offsets;
- withholding on the year so far (each pay is reckoned as a year's);
- tax on other income (support payments, dividends, rent);
- a law that changes during a run (orders keep the withholding they started with);
- the collector chasing an employer that doesn't pay over;
- a tax on a small trader's turnover.

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
  - penalty interest on what's overdue (10% a year), where the place charges any: a profile that states none (`rates_penalty_interest_bps` left out) has a rating law with no "or else", and the rates officer records none.

  The generator sets the opening rate to raise the profile's rates per resident from what's rateable. Rates become a steward's lever when budgets can set them (C4b).
- **The rates officer** (`city.rates_officer`, replacing the tax clerk in the generated town):
  - every instalment period, sends each owner a `rates_notice` for their share of a year's rates on their latest valuations;
  - records it as the town's claim against them (`about.kind` rates, with the account to pay and the due date);
  - a month after the due date, and monthly while any stays unpaid, records a month's penalty interest (`rates_interest`) and writes to the owner.

  A payment into the town's account that names the claim (`settles`) settles it. So does one that names the notice the claim was recorded with (same owner, sum and due day): whoever is sent a notice pays the notice (2026-10-11; docs/decisions.md, "A payment that names the rates notice pays the rates"). Its report gives the rate, what's been levied and received, and who's overdue.
- **Owners pay.** Landlords pay rates as they pay fines, when they have the money (a non-complying landlord may not). Firms treat rates as debts: they pay them while they can, keeping the next pay period's wages, and unpaid rates count towards insolvency (docs/behaviour/insolvency.md). The builder pays the rates on its yard.

**The rates officer's file (ported to Rust, 2026-10-17; bug hunt finding 2).** Everything the office keeps that matters across holders is read from its own file, whoever held the post when it was written. *When the last notices went out* is the latest `rates_notice` the office itself made (by position): the next go out an instalment (a 365th over the instalments, in whole days) after, and not before the office's first levy day. *What interest has been charged* on a claim is the latest `rates_interest` claim of the office citing it: a month's interest is charged a month after the last, or after the due day. A new holder therefore neither levies out of cycle nor charges a month twice. Before this, both lived in the holder's memory, and a successor levied at once and charged every overdue claim again. What no paper records is kept only as a cache of the account's statement: which claims a payment has named, and the sum received. A notice or a charge whose act is refused is sent again at the next wake (the instalment is not lost). Dates in the clerks' note and report are written by the one function that words a date (`when_words`).

*Revisit if:* a world gives a new holder no sight of the account's earlier payments (it would charge interest on claims already paid), or if a rating law states instalments that do not divide the year into whole days evenly.

**The tax clerk and the finance officer, the same way.** The tax clerk's assessments and penalties are its own `tax` and `tax_penalty` claims, read from the file (no report is assessed or chased twice by a successor; a zero tax is not recorded). The finance officer's wage standing orders are the requests on its file; its record of invoices paid, the year's wages and the account's money in and out are caches of the account's statement.

**Leaves out:**
- the rate cap and its regulator (a scenario knob; municipal-economy.md);
- differential rates (residential, commercial);
- waste and other service charges (C4b);
- selling land for unpaid rates;
- landlords passing rates on in rent: their rent rule doesn't see rates yet.

## Grants

`world.grants` (an office of the outside world; v0.3.0) pays the town every quarter: a yearly amount per resident, for the residents the statistician's latest published estimate gives (`population_estimate`: docs/behaviour/boundary.md), with a `grant_payment` statement that cites the estimate. Until 0.3.0 it was shown every cell of the town each month and counted who was in the homes at three in the morning; a funder counts nobody, and pays by the published count (in the profile's place, grants to councils are distributed on the statistician's estimated resident population: Local Government (Financial Assistance) Act 1995 (Cth), to confirm; not opened). With no estimate published it pays nothing and looks again the next day. The same module pays the clinic's, the school's and the police's funding. The generated town's figure is the profile's: general purpose grants per resident.

**The determination on file (generator 0.39.0, 2026-10-09).** Whoever a grants office pays opens with the funder's determination among its papers (`grant-city`, and one each for the clinic, the school and the police; kind `grant_determination`, made in the grants office's post): "Grant determination, made before the year began: $87.68 a year for each resident, by the statistician's latest published estimate of the town's population, paid into acc-city every 91 days from year 1, day 31. Each payment comes with a notice of the sum and the count it was reckoned on." Its figures are the ones the grants office is given. It is the paper behind the grant an opening budget expects; nobody is bound by it and no code reads it. The landfill's charge has one too (`landfill-charges`, kind `charges_notice`: so much a tonne, invoiced every 30 days), where the place has a charge. Real basis: a funder notifies each body of its allocation for the year before the year begins, and a tip publishes its gate fee (docs/research/references.md, "What the second live check found"; to confirm).

**Leaves out:** grants tied to purposes (roads, capital works), and equalisation between councils.

## The rent tax, retired

The generated town no longer has `law-tax` (10% of rent, reported monthly), which had no source. Rates are the town's own tax (municipal-economy.md §9 Q3). The modules for a tax on reported income (the landlord's `tax_rate_bps`, `city.tax_clerk`) stay, for worlds that want one.

## The town's administrative staff are on its budget (foundations F5, 2026-10-16)

The town's own offices are now staffed by residents it employs (docs/behaviour/staffing.md), at the profile's pay and rate. Their wages are
a line of the budget of their own, `administration`, tabled by the mayor's office like the others (`administration_budget`; the first
year's budget is the sum of a year's pay for the staff the town opens with). The finance officer pays them by standing instruction, on
that line. The state's bodies (tribunal, ombudsman, consumer desk, electoral commission, land registry, the paper) are paid from a grant
from outside sized to their wage bill; the bank, the union and the utilities from their own takings, with twelve weeks' pay in hand at the
start. The bank also pays a monthly licence for its payment platform to the outside world.
