# Workers' voice: unions, bargaining and strikes (phase C, stage C5)

**Source:**
- `union.organiser`, in `participants/src/behaviour/union.ts`;
- the employer's side (`Bargaining`, and pay stopped and restarted in `Staffing`), in `participants/src/behaviour/firms.ts`;
- members' behaviour, in `participants/src/behaviour/citizen.ts`.

A union is an organisation, and bargaining and protected action are procedures that people and firms follow. None of it is kernel mechanics. Wages set only by employers leave out half the labour market's politics (docs/design/phase-c-stakes.md §7).

## Membership

- **At the start,** each employee is a member with the profile's membership rate for their kind of work. For Australia: ABS, *Trade union membership*, August 2024: 13.1% of employees overall; manufacturing 9.0%, construction 11.7%, retail 7.0%, public administration 23.1%.
  - A membership is an agreement between the union and the member: the member pays dues monthly by standing order (the profile's, a placeholder), and the union represents them.
  - The union keeps a register of its members and where they work. Members keep it up: a member who starts work elsewhere, or is out of work, tells the union (a `membership_update`). An employer that closes (its public `closure`) is bargained with no more, and a dispute where no member works any longer is over (union.organiser 0.3.0).
- **Joining later:** someone starting a job joins at their kind of work's rate. They apply, the union offers the membership, and they sign and set up their dues.

## Bargaining

The union's organiser bargains once a year with each employer where it has members (factories, shops and the builder in the generated town). Its first claims are spread over its first two months.
- **The claim:** the year's rise in prices (the mean of the shops' published prices against a year ago; nothing before a year of prices) plus the profile's margin (2%, a placeholder). It's addressed to the employer.
- **The employer's offer:** by its capacity to pay (a criterion wage-fixing bodies weigh). It offers all of the claim if what it holds beyond a month's wages covers twice the claim's cost for a year, and less in proportion if not.
- **Agreement:** the union accepts an offer of at least half its claim (placeholder). The employer then makes it an **enterprise agreement**, published, and raises every employee's wage from their next pay day (new standing orders, net of the tax withheld), and the wage it hires at. Employees read it and expect the new pay: each looks, when they plan, for agreements at their own workplace made since they started there (citizen 0.36.0, `work_board`; before, every person in town was shown every workplace's agreement as it was made). So an employee knows of a rise by their next plan, within a week. A pay at the new rate that reached them before they had read of the rise is counted, once they have, as wages paid as agreed (what they learn of an employer that pays; without that, one seed's year parted from the old behaviour at the first such pay: docs/decisions.md, 2026-10-08). (An employer must give the employees an agreement covers access to it: Fair Work Act 2009 (Cth) s 180, to confirm. Addressing it to each of them was tried and taken out: a record that names a person wakes them, and a whole workplace then planned its week at the same moment from then on.)

## What a union knows (organiser 0.5.0; docs/no-god-view.md)

| | Rule | Source |
|---|---|---|
| **Where it bargains** | Until 0.5.0 it was handed every factory, shop and the builder when the world was made, and never learned of a shop founded later. Now it bargains where its members work: its register at the start, and what members tell it when they join or change jobs, each saying their employer and its industry (as the job's posting said). A workplace is one of its own when its industry is one the union organises (`industries`, its rule of eligibility: the world gives them). A workplace it learns of later is claimed at from then. | A union is the bargaining representative of an employee who is its member (Fair Work Act 2009 (Cth) s 176; to confirm: the section was not opened), and may represent only those its eligibility rules cover |
| **Prices** | Until 0.5.0 it was shown every shop's price list and took their mean. Now it reads the statistician's published index (`price_index`, monthly: docs/behaviour/boundary.md) and claims the year's rise in it. | Unions and tribunals argue from the official index, which a statistics office makes by pricing a sample of outlets (Australian Bureau of Statistics, *Consumer Price Index: Concepts, Sources and Methods*, 2025, "Price collection"; opened). That unions cite it in claims: no source opened (to confirm) |

## Protected action

The union's own rules decide its ballot (parameters: a majority, no turnout, no notice). Its notice of action states the ballot's figures, as a notice of protected action does, and is checked against every law in force (docs/design/ai-citizens.md 2e): if the law forbids it, the union gives more notice (a day at a time, up to a month), or takes no action and claims again in three months; a union that doesn't comply (`compliance_bps`) acts anyway. The generated town's law is the profile's `industrial_action`, written as a formal condition on the notice; for Victoria, the *Fair Work Act 2009*, Part 3-3, as below. The employer doesn't pay for time on strike: no work, no pay, and here the law says so too (`law-no-pay-for-action`, in words).
- **Ballot.** If the offer is too low, or none comes within 14 days, the union ballots its members at that employer on protected action. It needs at least half of them voting (s 459(1)(b)) and more than half of the votes yes (s 459(1)(c)). Members vote with the chance of voting and of voting yes (placeholders: 70%, 85%). Protected action ballots usually pass.
- **Notice.** Approved, the union gives the employer 3 days' notice of a stoppage (s 414: three working days). A stoppage starts with a day: the first to begin once the notice has run, so the notice as it stands on the record gives the period in full (0.4.1).
- **Stoppages.** The members there stop work: they leave the workplace and come back when the union calls the return. The stoppages get longer each time (1, 2, 3 days: placeholders), a week apart while no acceptable offer comes.
- **Pay.** Workers on strike aren't paid for the time (s 470; and no work, no pay where there's no such law, unless a law says they're paid: `paid_during_action`). The employer stops their wage orders at the stoppage. At the return, it pays what they earned between their last pay day and the stoppage, and restarts their wages a period on. Nothing in the kernel docks anyone's pay: the employer does it.
- **Concession** (by what a stoppage costs each side; employer 0.16.0 and after, union 0.7.0; before, the employer raised its offer by half the gap to the claim after each stoppage, and to all of it after three, whatever a stoppage cost, and the union never weighed its members' lost pay). Hicks (1932), *The Theory of Wages*: the employer's concession curve and the union's resistance curve; a strike lasts while the union asks more than the employer will give at the length of stoppage in prospect. Kennan and Wilson (1993): a stoppage is how each side learns what the other can bear. Card (1990): settlements follow the cost of disagreement. No settlement is set; the rules below are the same for every dispute, and where one ends follows the costs.
  - **The employer** knows what a stoppage cost it. The share of its work the strikers' hours were of all its hours of work (people's hours; the share of the work that systems do, `systemShare`, is not the strikers' to stop: it goes on, default 0, supplied by whatever puts systems to work) times its takings for the days stopped. The sales lost with the work: a shop that cannot serve loses the sale; a works that cannot make loses the output. The wages it did not pay the strikers are not set against it. Its takings are what customers paid it in the last month, per day, as its own books have them (a shop's paid orders; a works' paid orders and what it invoices the world market for its exports; the builder's receipts). It will concede, in a year's cost, up to what holding out against another stoppage a day longer than the last would cost it (the union's stoppages lengthen; it reads their length from the notices it is given): its offer after a stoppage is the rise whose year's cost (a month's wage bill x 12 x the rise) is that much, never above the claim and never below what it has offered. Its first offer is still by capacity to pay.
  - **The union** weighs its members' lost pay. After a stoppage, when the next would cost its members (their number x its days x a day's pay in the industry, `pay_per_day`, the profile's wages by industry: the union knows what the industries it organises pay) at least what the rest of the gap to its claim would add for them over a year (their number x a day's pay x 365 x the gap), it stops striking. If an offer stands it accepts it; else it lets the dispute rest and claims again in three months. A day's pay is on both sides of the comparison, so in effect a stoppage of d days is weighed against a rise worth 365 x the gap days of pay (a 0.8% gap is worth 3 days). Its other rules stand: an offer of at least `accept_share_bps` of the claim is accepted at once; the ballot, the notice, the law.
  - Neither side sees the other's books. The employer knows the notices and who struck; the union knows its members and what the industry pays. Nothing new is published.
  - The sum above is a one-off cost against a year's flow, which concedes little: a stoppage of a few days costs a firm a few days' sales, and a year's rise at a tenth of a percent of its wage bill is a day or so of its takings. The comparison is the owner's ruling (2026-10-17); see docs/decisions.md for what would make us revisit it.
- **Not approved:** the union lets it rest and claims again in three months.

## What to measure

Measurement reads the logs; the platform doesn't judge. Profile targets:
- **Working days lost per 1,000 employees a year:** about 11 (derived: 139,100 days lost in 2024, ABS *Industrial Disputes*, over about 12.3 million employees). In towns of a few hundred, strikes should be rare.
- **Union membership:** 13.1% of employees.
- **Settlements:** against the average annualised wage increases in new agreements (the national employment department's *Trends in Federal Enterprise Bargaining*).

## Leaves out

- **Bargaining with the town:** the town's crew are members, at the public sector's rate, but the union doesn't bargain with the town yet. That would be a steward's decision: a mayor facing a claim.
- Multi-year agreements, bargaining orders and the tribunal's intervention (an intractable bargaining declaration).
- (Since 0.6.0, in a town where things go wrong, the union takes up a member's short pay with their employer: it says so in a public notice only members may apply on, puts the matter to the employer, and says what should be paid. Its word is a recommendation: docs/behaviour/frictions.md, "Venues".)
- Lockouts, and employer response action.
- Replacement of strikers during a strike by the place's law (agency or other labour brought in where the law allows it; a place's law decides): not built. A firm whose strikers' work others do loses less in a stoppage; today only systems do it (`systemShare`, not yet supplied).
- Strike pay from the union.
- Members moving jobs: before 0.3.0 the union knew where a member worked only from its register and their application to join. A member who moved could be balloted and called out at an employer they'd left, and the union bargained on with a closed shop (five years: one dispute ran to 78 stoppages over nearly three years at a shop that had closed). Now members say where they work, and vote only in ballots about their own workplace.
- Industrial action outside protected action.
- A pro-rata payment at the return can be a couple of days off, from when a restarted wage order counts as starting.
