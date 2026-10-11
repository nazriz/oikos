# Firms: `firm.landlord` (v0.16.0) and `firm.employer` (v0.6.0)

**Source:** `participants/src/behaviour/firms.ts`. Both wake weekly and whenever something names them.

## `firm.landlord`: a letting office

| Rule | Detail | Source |
|---|---|---|
| **Listing** | Each vacant home (a unit, with its bedrooms) is listed at a 5% markup over what the landlord currently gets for homes with the same number of bedrooms in the same building, ±2.5% noise. With no comparable, it uses the world's base rent for that size. | BoE housing model eq. (11): the asking rent is a markup over the average rent |
| **Cutting** | A listing unlet for a month is withdrawn and relisted 5% lower | BoE model §3.4.4: "the price is reduced each month by a constant fraction of 5%" |
| **Choosing a tenant** | One applicant at random per listing | BoE model §3.5: when several bidders can afford an offer, "one is randomly chosen", because a bidder's maximum is private |
| **Term** | 12–24 months, uniform; 60 days' notice from the landlord, 30 from the tenant | BoE model: "chosen randomly from 12 to 24 months with uniform probability, as suggested by data from the Association of Residential Letting Agents". The notice periods match the example tenancy law. |
| **Renewing** (`renew`, 2026-09-30) | Within its notice period of a lease's end (60 days), with no notice given, it offers the sitting tenant a new lease on the same home: at the rent then, for a new 12–24 month term from when the old one ends. The tenant signs if it can bear the rent, and its rent carries on on the same days. | What landlords and agents do as a lease runs out: letting it lapse costs a vacancy, a listing and a search. Without it, about 245 of some 350 tenancies a year simply ended, and the households hunted for a home (most leaving town after 90 days without one). The BoE model ends a lease at its term; the Victorian Act continues it as a periodic tenancy, which our leases can't say yet (a fixed `term` or none): a renewal is the nearest honest act |
| **Counting homes as taken** | Homes under a lease in force, *or* offered and still awaiting the tenant's signature (up to a month) | Found in M1: counting only signed leases let the same flat twice |
| **Letting only what's free** | A listing being let is never also relisted in the same plan. Before offering a lease, the landlord checks the building still has a free home; if not, it withdraws the listing | Found with D43: a monthly rent cut relisted a home in the same plan that let it, and the stale listing was let again later |
| **Who it lets to** | Among applicants, it turns down households with more than two people per bedroom (`max_people_per_bedroom`; 0 for no limit) and picks among the rest at random. The lease names the leaseholder and, in its terms, the household ([households.md](households.md)). | The occupancy standard's own ceiling (CNOS); whether a landlord applies it is a placeholder policy |
| **A tenant's death** | Seen in its own buildings (it sees them by name): it reports it to the registry, if nobody has. Once registered, it gives notice on the lease. | Victoria: a sole tenant's death ends the tenancy after notice; a household member may apply to take it over (not modelled yet) |
| **Arrears, where the world has a law on possession** (0.16.0) | A notice to vacate, which ends nothing by itself; then the tribunal; then the police. [justice.md](justice.md), "Possession". The row below is what it does in a world with no such law. | The place's tenancy law, published in the town |
| **Arrears** | After 2 months' unpaid rent, give notice. Each lease is judged on its own: what has fallen due under it against what the tenant has paid since its rent began (its signing; for a renewal, the end of the old lease's term), never against everything the tenant ever paid (0.12.2) | A typical landlord practice, not a law: what tenancy law requires is a record the landlord may follow or not |
| **A tribunal's order** (0.12.0) | Told by the tribunal that a notice of rent increase of ours is invalid: as often as it complies with the law (`compliance_bps`), it withdraws the notice and the rent stays as it was. | docs/behaviour/justice.md |
| **What it knows of land** (0.13.0) | Its titles are its own papers. The plan of each lot it holds it looks up in the register by the lot's id, once (the first time it plans holding it); it is no longer shown the plan of every lot in town. (`register`: its channel onto the plans; none: it knows the plans it is shown.) It sees its own buildings and who lives in them; a landlord with no land is shown no building (the generated town once showed such a one every building, by name). | A letting office holds its own deeds and plans; a plan is a search of the register ([ownership.md](ownership.md)) |
| **Development** | Builds on its own empty sites when average vacancy over 90 days is ≤10% and it can afford it. Applies for a permit; if refused, complies with probability `compliance_bps`, otherwise builds anyway. Pays fines and obeys demolition orders with the same probability. **An offer the builder declines** (0.13.2): the builder answers in writing ([building.md](building.md)). The landlord reads the answer with the week's post, at its first plan a week or more after it offered, never in the moment it comes. Declined for the price (the list changed as the offer was made): the offer is dead, the permit stands, and it decides again as with any permit in hand, at what the builder charges now (its standing list, or its letter where the landlord holds no list as late as the letter): it offers again if it can pay that, and otherwise waits until it can. Declined for the site: it gives the plan up and waits 180 days, as after a refusal it accepts. An offer that could not be made at all leaves the permit standing, and is tried again a week on. (Until 2026-10-08 nothing read the answer: a landlord declined once waited for its building for good and never built again.) | [institutions.md](institutions.md); a client whose order crosses a change of price list is told the new price and orders again or not (ordinary trade practice; no source sought for the week) |
| **What it can spend, and its invoices** (0.13.3) | A landlord keeps its own books beside the bank's balance: the price of each building it has asked the builder for is owed from the offer until that building's invoice is paid (or the offer is declined); a payment it has told the bank to make counts as gone until it is seen to leave the account (a week at most); an invoice in hand counts too. It begins a building when what is left after those is one and a half times the builder's price, and asks the builder when what is left covers the price. An invoice is paid when the account covers it beside payments already on their way, oldest first; one it cannot pay yet stays open and is paid when it can. (Until 2026-10-09 both tests read the balance alone, and an invoice was marked answered before the balance was looked at: a landlord asked for a second house on the money that was to pay for the first, and the invoice that came when it was short was never paid. In three 1,000-person towns over 180 days, 42 of 100 houses built for landlords were never paid for.) | A firm commits on what it has less what it owes (its payables), and an unpaid invoice remains payable: ordinary bookkeeping; no source sought |
| **Rates** (C4a) | Pays each rates notice's claim (and any penalty interest) when it has the money, naming the claim; a non-complying landlord may not. | [public-finance.md](public-finance.md) |
| **Tax on rent** (not in the generated town since C4a) | Monthly, with owners' spending: a `tax_report` to the town of rent received, and payment at the rate it believes the tax law sets (`tax_rate_bps`, supplied by the world). A non-complying landlord (probability `1 − compliance_bps` each month) reports only half. It pays tax penalties like fines. | Tax evasion as a gamble on detection (Allingham & Sandmo 1972). Here the tax clerk can't detect it at all yet. See [government.md](government.md). |
| **Owners' spending** | Monthly: 60% of rental income spent at local shops, 20% on upkeep bought from outside | A placeholder to stop money pooling at landlords (see the calibration notes below) |

**Differs from the BoE model on purpose:** that model injects cash so tenants never miss rent. Here arrears happen, and what follows is up to the landlord.

**Rent reviews (landlord 0.9.0; laws read as formal conditions, 2026-09-29):** a landlord reviews each tenancy's rent once a review period, with the notice it gives: its own practice (`rent_review_months`, `rent_increase_notice_days`; the generator sets both from the profile, as landlords here raise rents as often as the law allows). Before giving notice it checks the notice against every law in force, as any participant reads a law: prohibitions whose formal condition the act would meet (`breaches`, docs/design/ai-citizens.md 2e). The notice states when the rent last changed, as a notice of rent increase does. If the law forbids it, the landlord looks for the soonest start the law allows (a week at a time, up to half a year), and otherwise waits a month; a landlord that doesn't comply (`compliance_bps`) raises it anyway. A law changed in the world (by the council, or a model mayor) changes what landlords do. At each review:
- it raises the rent to what it would ask for that home now (its markup over what similar homes in the building let for, or its base rent), if that's more;
- it gives the notice the law requires, with a `rent_increase` statement to the tenant (`data: { lease, rent, from, was }`), counted from when the notice is given (if a busy wake gives it a day late, the date moves with it); the increase starts with a day, the first to begin once the notice has run (0.12.1: until 2026-10-05 it started to the second, counted from when the landlord decided, and the notice is on the record a moment later, so a notice on exactly the law's period was a moment short of it, and invalid before the tribunal);
- it never lowers a tenancy's rent (an unlet home's asking rent falls instead);
- the rent it expects, for arrears, follows the increases.

The tenant pays the new rent from when it starts, or gives notice (docs/behaviour/citizen.md). This is where tight housing reaches sitting tenants, the counterpart of the BoE model's cut for unlet homes. Victoria's law (the first profile): once in 12 months, 60 days' notice.

**The owners' draw (landlord 0.7.0):** monthly, 60% of rent received goes to the landlord's owners. With a `shareholders` register, it's paid to those on it by their shares, and they spend it as they will. In the generated town a landlord is held by one household or a few, or from outside ([firm-ownership.md](firm-ownership.md); until 2026-10-08 every household held a part of every landlord). Without one, the old money-only stand-in (spent at a local shop) remains. 20% goes on upkeep bought from outside (maintenance comes in phase C).

## `firm.employer`: a manager with a fixed headcount

How any employer hires and pays (postings, offers, standing orders, notice, a worker's death) is shared code, `Staffing` in `participants/src/behaviour/firms.ts`. Factories ([producer.md](producer.md)) and the builder use it too, each with its own rule for how many staff to have and at what wage. `firm.employer`'s rule is the simple one below: a fixed target headcount at a fixed wage. The generated town no longer uses it (its shops are `firm.retailer`s), but a researcher can put it in any seat (the migration test does).

| Rule | Detail |
|---|---|
| **Posting** | If staff plus pending offers are below the target headcount, and the balance covers 2 pay periods of the wage bill, post one job at the firm's wage |
| **Hiring** | One applicant at random per posting. The offer includes the workplace. |
| **Bargaining** (C5) | A union's wage claim gets an offer by capacity to pay; an accepted offer becomes an enterprise agreement and a rise for all staff (new wage orders from the next pay day). Staff on strike aren't paid for the time: their pay stops, and restarts at the return, with what they earned before the stoppage. After each stoppage, the offer rises by half the gap (Hicks 1932). | [unions.md](unions.md) |
| **Postings** | A posting says where the work is (`data.workplace`), so someone told about a workplace can find it. A posting still open when the firm's wage has moved (Lengnick's rule raises it for a posting unfilled a month) is withdrawn and published again at the new wage, so the rise reaches applicants. |
| **Paying** | Once the worker signs, set up a standing order through the firm's bank for wages every 14 days |
| **Layoffs** | If the balance can't cover the next pay period for the staff who are staying (those not already under notice), give 14 days' notice to the most recent hire, and stop their wages when it runs out. Counted with those already going, one shortfall gave the whole staff notice, one a look, before the first notice had run out (fixed 2026-10-08; the producer, the retailer and the builder count the same way) |
| **Suppliers** | Monthly: 40% of the month's revenue paid to the outside world, for goods bought in. This is a money-only stand-in until shops buy goods (phase B, stage B4 step 3). |

The labour-market literature (the Dosi et al. "Schumpeter meeting Keynes" labour extension) is the planned refinement for wage-setting and hiring.


## Adjusting labour (2026-10-11): how a shop or a factory changes its staff

**Source:** `LabourPlan`, `terminationLaw`, `Staffing.redundancyOwed` (`participants/src/behaviour/firms.ts`); the month's-end rules of `firm.retailer` 0.12.0 and `firm.producer` 0.7.0. **Figures:** each profile's `employment.termination` and `employment.adjustment`, with sources.

**The fault.** A shop set its staff at each month's end from that one month's sales, a worker up or down, and a factory from that month's stock; neither act cost anything. One shop's sales in a month swing two- and threefold (custom moves between thirty shops, and a shop short of hands turns customers away and loses them), so shops shed and rehired month about. In a year of the 1,000-person town firms gave 129 redundancy notices to about 425 people in jobs (six runs: 87 to 172), about 30%, where Australia's retrenchment rate is 1.8% of the employed a year (ABS, Job mobility, February 2026). Three factories also took someone on each month because stock was low and let them go weeks later because they could not cover a fortnight's wages: the test to hire (a month's wages in hand) was weaker than the test to keep.

**How firms really adjust labour**, and what is taken from each (docs/research/references.md, "Labour adjustment"):

| What real firms do | Here | Source |
|---|---|---|
| **Plan on smoothed trade, never one period's** | The trade a firm expects is an average of its months weighted to the recent ones over `smooth_months` (3: each new month counts for half). Heads are set against that. | Holt, Modigliani, Muth and Simon (1960), *Planning Production, Inventories, and Work Force*: workforce follows a smoothed forecast because changing it costs. The horizon is a **placeholder**. |
| **Hold labour through a dip** | Over its need, a firm keeps its people: a shop's hands are idle more of the day; a factory over its band of stock makes less (it already made nothing beyond the band). | Oi (1962): labour is a quasi-fixed factor; Fay and Medoff (1985): in a trough manufacturers held some 8% more labour than output needed (to confirm) |
| **Let go only when it is worth the cost** | The most recent hire is let go once the surplus has lasted `waits` months in a row: the weeks of pay it costs to end the job under the law (notice, and redundancy pay where the employer's size owes it, for that worker's service) and to hire again (`hiring_cost_weeks`, 8), as months, never less than one. A month without a surplus starts the count again. | Hamermesh (1989) and Caballero, Engel and Haltiwanger (1997): adjustment is lumpy, with a band of inaction; Bentolila and Bertola (1990): firing costs make employment answer less to shocks. **The rule itself is ours**: a firm cannot know how long a dip will last, and takes one that has lasted as long as the job costs to end and refill as likely to last that long again. `hiring_cost_weeks` is a **placeholder** (estimates run from under two weeks of pay to over sixteen: to confirm). |
| **Shed by attrition first** | While over its need a firm replaces nobody who leaves: its target is its need, and a target below its staff posts no job and ends none. | Davis, Faberman and Haltiwanger (2012): firms shrinking a little do it mostly through quits and not hiring; layoffs dominate only large contractions (to confirm) |
| **Pay what the law says on redundancy** | The place's law on ending a job (`law-ending-employment`, published in the town from the profile) is read by the employer: least notice and redundancy pay by service, and the size of employer below which none is owed. When a job ended for redundancy runs out, what the law gives beyond the agreement's notice is owed in the firm's books and paid with the wages it owes ("Wages owed", below). Service is counted from the start of a run: nobody's earlier years with an employer are known to it, so redundancy pay is understated in a first year. | Each profile's `employment.termination` (Victoria: Fair Work Act 2009 ss 117, 119, 121; to confirm) |
| **Do not recruit while unable to pay** | Once it has let someone go because it could not cover the wage bill, a firm takes nobody on until it holds the wages of those it would then have for as many months as a surplus must last before a job is worth ending (a month's was enough before, and still is for a firm that has never been short). | Consistency: the test to take someone on is never weaker than the test to keep them. No source sought. |

A world with no such law and a firm given `adjust: { smooth_months: 0, hiring_cost_weeks: 0 }` behave as before 2026-10-11. The builder's crew already follows the work in hand over a horizon of days; it now owes redundancy pay like anyone.

**What is not here.** Hours cut before heads as a change of pay (short-time work, stand-downs: a wage here is a sum a fortnight whatever the hours); a firm that asks for volunteers, or picks whom to let go by anything but last in, first out; an employer asking a trade of those it hires (which is why a shop's hand still moves to a factory for half as much again: docs/design/ai-citizens.md, "Progress"); a worker claiming redundancy pay that is not paid (it stands in the firm's books and is paid when it can be, or lost when the firm is wound up short); Japan's case law, which makes dismissal for redundancy rare there and is no figure.

## Wages owed (2026-10-11): one ledger, and what a bank statement says

**Source:** `Staffing.latePay`, `owedShort`, `wagesOwed` (`firms.ts`); `bank.payment_system` 0.11.0; `citizen.default` 0.47.0.

**The fault that was reported, and what it was.** Step 2b found about 18 people a year paid "4 to 48% under their agreed wage" by a "wage rule", with the firm's books owning to nothing. No rule cuts an agreed wage: the monthly wage rule moves only what is offered to new hires. Every one of those payments, traced in a year's log, was something else paid to a worker from their employer's account: a shop's refund to a hand who shops where they work (14 of 19), or a factory's dividend to a worker who holds its shares (5). The worker read any payment from the employer's account between half and the whole of their pay as "pay, short", because a payment carried no word of what it was for. The firm's books were right.

- **A payment is what its payer said it was for.** The bank now writes on each payment what the instruction said it was for (the contract's `memo`, there since 0.3 and never filled by the bank): the line on a statement. A worker takes for pay only what is paid as wages; a payment that says nothing is judged by its size, as before.
- **An agreed wage is owed in full, and the employer's books say what is unpaid.** One ledger per agreement holds two things. What an employer **keeps back** from a pay by its character or trouble (docs/behaviour/frictions.md, "Pay that comes short": unchanged, and the only deliberate underpayment there is). And a pay its account **could not cover on its day** (the bank tells it, naming its order): that pay is still owed, and is paid late, oldest first, as soon as the account covers it beside the next pay day's wages for those it keeps. Redundancy pay not yet paid stands there too.
- **Who can act on it.** Asked by the worker, a venue or the union, the employer answers with the ledger's sum for that agreement (`owedShort`), truthfully. A worker who has left and recorded the wages as a debt (docs/behaviour/insolvency.md) is paid as a creditor, and the ledger's line gives way to the debt, so nothing is paid twice. A firm being wound up pays what it can of the ledger as it goes, a whole sum at a time; what is left when it closes is lost, as unpaid wages are (a remainder smaller than any one sum owed goes to its recorded creditors and then its shareholders, never in part to the worker: a known gap).

**Not here:** interest on late pay; a guarantee scheme that pays workers of a failed firm (Australia's Fair Entitlements Guarantee: docs/behaviour/insolvency.md); pay for the part of a pay period worked before a leaver's last day (above, "Payroll notices").

## Jobs an employer does not register (2026-10-09; profile-depth item 1, part a)

**In the real world.** Most of what is called informal employment is an employer not doing what the payroll law says: nothing withheld, no contributions paid, the worker on no return. The ILO counts an employee as informally employed when the job is "not subject to national labour legislation, income taxation, social protection or entitlement to certain employment benefits", whatever the firm (17th ICLS guidelines, 2003; docs/research/references.md). It is a fact about the job, and it exists inside registered firms as well as outside them.

**The rule.** A profile may state, by kind of firm (the kinds it gives wages for: shop, factory, construction), the share of jobs that are registered (`employment.registered_bps`, with its source). Left out for a kind, every job of that kind is registered, as always; public bodies register every job. The share is the employer's own practice (`registered_bps`, a parameter of `firm.retailer`, `firm.producer` and `firm.builder`), carried out in `Staffing`:

| | A registered job | A job the employer does not register |
|---|---|---|
| **Pay** | the wage agreed less what the law's charges withhold | the wage agreed, whole |
| **Paid over** | what was withheld, monthly, to each charge's account | nothing |
| **Reported** | on the monthly report; by name where a charge is itemised | on no report |
| **Decided** | | once, when the job's wages start, with the chance the share gives (the employer's own draw); at the start, by the generator, the same way |
| **Recorded** | | the employer's own note (`off_books`, naming the agreement), which only the employer sees |

The agreement itself is an ordinary employment agreement: the same notice, a standing wage order through the bank (the bank account stands for mobile money where that is how wages are paid). The worker sees the whole wage arrive and counts it as their wages (docs/behaviour/citizen.md already took either the wage agreed or the wage less tax as "paid as agreed").

**What follows, with nothing coded for it.** The collector receives less. Whoever keeps a record of contributions (the payments office, from the reports addressed to it: docs/behaviour/boundary.md) has no line for the worker, so a payment that turns on a record is refused them, and one that is a share of past pay has no pay to be a share of. A flat payment that asks for no record is paid as to anyone. In a place whose law takes nothing from a low wage and has no itemised charge, registering a job or not changes no payment at all: only the note differs.

**Nobody is shown who works unregistered** (docs/no-god-view.md): the note is the employer's own paper; the tax office knows what is reported to it and nothing else. Measurement, which reads the log from outside, counts the notes (`economy/work`).

**No inspector.** The share is a stated fact of the place and stays put: nothing finds an unregistered job, fines an employer or makes it register. A labour or tax inspector would be an office of the higher government (or of the town, for a local levy) that goes to a workplace (a visit: docs/no-god-view.md), counts who is there, and asks the collector what was reported for that employer; the employer's `compliance` would then answer to the chance of a visit and the size of the penalty (Allingham and Sandmo 1972, as the landlord's tax on rent already cites). Where it attaches: a module beside `world.valuer` in `participants/src/behaviour/world.ts`, with an `ask` channel on the collector's own reports and a `visit` channel on workplaces; `Staffing.unregistered` is the one place the employer's decision is made.

**Leaves out:** a worker choosing or refusing an unregistered job, or asking less for a registered one (the citizen redesign: docs/design/ai-citizens.md, Open); an unregistered wage below the registered one (the surveys show a gap; the profile gives one wage for a kind of work, so both are paid it); a union treating such jobs differently; the firm's own tax; a share that differs between firms of one kind (each employer of a kind registers the kind's share of its own jobs, because a town has too few firms of a kind for "this firm does, that one does not" to give the place's share).

## Work by the day (2026-10-09; profile-depth item 1, part b)

**In the real world.** Casual labour is hired and paid by the day or the task: a builder's hands for the days there is a job, a works' extra hands for an order. Labour force surveys count it as a status of its own beside regular wage work and self-employment, and publish its daily wage (the profiles' notes cite theirs).

**The terms.** Work by the day is an employment agreement whose pay is a day's: the employer's commitment is a sum of money every day (`every` of one day), each side's notice is the least an agreement can say (one second: the agreement record's own fields, no new ones), and its words say "for each day worked; either may end it at once". That is all that marks it (`byTheDay`, `firms.ts`).

**The rule.** A profile may state, by kind of firm, the share of jobs that are by the day (`employment.casual_bps`) and a day's pay for it (`employment.day_wage`), each with its source; a share without a day's pay is refused. At the start the generator makes that share of each such employer's jobs by the day. In the run, `Staffing` (for `firm.retailer`, `firm.producer`, `firm.builder`):

| | |
|---|---|
| **Taking on** | A posting is for work by the day with the chance the share gives (drawn for each posting), at the day's pay, which moves as the firm's wage does. It says so (`data.by_the_day`, a period of a day), and its offer carries the terms. One applicant at random, as for any posting |
| **Pay** | No standing order. On each working day, each hand who is at the workplace is paid the day's pay that day, once, by a payment of its own (an instruction to the firm's bank). Not there, not a working day, or no work for them today: no pay, and nothing owed. Short of money for all, the longest with the firm are paid first |
| **The days there is work** | The builder: the days it has building in hand. The shop and the factory: every working day (a refinement for the factory, an order in hand, is left out) |
| **What the law takes** | From a registered job by the day, what the charges take from a day's pay, reckoned as a year's over the working days of the week (a day's pay is pay for a working day, not for every day of the year: `dayPayPeriod`); paid over and reported with the rest. An unregistered one: nothing, as above |
| **Ending** | Either side, at once. The firm lets the most recent hire go as before; with no notice to work out, the hand is gone that hour |

**The hand** (docs/behaviour/citizen.md): knows the day's pay, whole or less tax, as their pay; reckons a month's income as the working days of a month of it; and, with no pay for most of a week (a pay period and five days, as for any job), takes it that there is no work for them there and ends it, with nothing to claim: no debt arises from a day not worked. Then they look for work as anyone out of work does.

**Leaves out:** turning up each morning to be picked (the hand stays on the employer's list between days, which is how a regular day labourer is with a regular employer; a labour stand where strangers are picked each dawn is not modelled); pay by the task; a different crew each day; a firm choosing to fill a job by the day because trade is uncertain (the share is the place's stated fact); whether someone prefers a standing wage to more days' pay (the citizen redesign); the board's reader comparing a day's pay with a fortnight's on equal terms when the board is read in order of pay (a posting by the day reads low there; a person offered both compares them by the month).

: on the registration, it stops the wages and ends the employment on record; the post is advertised again as staffing allows.

## Payroll notices (2026-10-09): where one office hires and another pays

Most employers hire and pay through one office. A town does not: its works manager and its environment officer take staff on, and its finance officer pays them. Until 2026-10-09 the code finance office noticed any signed employment agreement of the town's by itself and set the wage up; nothing was ever sent to it. So a seat in the finance office was never told, and in two of three pilots with one the environment office's new scientist was never paid, resigned and filed a claim for the wages (live check 2, finding 9). In a real organisation the hiring manager sends payroll a new-starter notice, and payroll sets the payment up (docs/research/references.md, "What the second live check found": to confirm).

- **The agreement states its first pay day.** An offer of employment now ends "First pay 14 days after both have signed." (the pay period: wages are paid in arrears).
- **A new starter.** Once both have signed, the hiring office files a payroll notice (kind `payroll_notice`, the organisation's own paper, marked with the payroll office: `data.office`), resting on the agreement: "Payroll notice, new starter: c0550, environmental scientist, under employment agreement rec.1262. Pay: $3,000.00 every 14 days before tax, into acc-c0550; first pay day year 1, day 16, then every 14 days. For the finance office: the wage payment is to be set up from that day." Its content has each of those as a field (`employee`, `post`, `agreement`, `wage`, `period`, `first_pay`, `account`). Once for each agreement, by the office's own file. **With it goes a letter to the payroll office's post**, in the notice's words and with what the payment should be ("Payroll notice from the hiring office, new starter: ... The wage payment is to be set up from that day: a payment from the organisation's account to acc-c0550 every 14 days, first on year 1, day 16, citing rec.1262, of the pay less what the tax law says to withhold."): a paper on an organisation's own file is not put in front of anyone in it (a seat is shown what is new to its organisation from outside, and its own letters), and the mock runs showed a finance seat was never shown the notice itself. The leaver's notice goes the same way. Staff the organisation started with were on its payroll before the year began: no notice.
- **A leaver.** Once the employment has an end (either side gave notice), or the member of staff has died: "Payroll notice, leaver: c0550, environmental scientist, employment agreement rec.1262 ends on year 1, day 23 (notice). For the finance office: pay is due to that day, and the wage payment under the agreement is to end then." On a death the hiring office also ends the employment on record, if nobody of the organisation has yet (until now only the payroll did, so with a seat in the payroll the dead stayed on the staff and the post was never advertised again).
- **The forms.** `payroll_starter` and `payroll_leaver` are among the stationery of an office that hires and does not pay (docs/behaviour/office-papers.md): a seat in the works or environment office sends the same paper.
- **A code payroll** acts on the notice as it acted before: one standing payment through the bank, net of the tax withheld, **from the first pay day the notice gives** (before: a pay period from whenever it happened to look). It waits `payroll_wait_days` (3) for a notice; with none by then it sets the wage up from the agreement on file, whose first pay day is a pay period after both signed, and its reason says so. (A hiring office held by a seat that sends no notice therefore still has its hire paid by a code payroll, late by a few days; with seats in both offices nobody is paid until one of them acts, as in a real town.) It ends the payment when the employment ends, as before.
- **A seat in the payroll office** is shown the notice among its payroll papers when it is filed, with what it needs to act: who, the account, the pay before tax and the period, the first pay day, the agreement. The payment is an existing act (a payment every pay period, first on that day, citing the agreement); what to withhold is the tax law's, which the office has.
- **Employers that hire and pay through one office** (shops, factories, the builder, the clinic, the school, the police) are unchanged.

**Leaves out.** Pay for the part of a pay period worked before a leaver's last day: the payment simply ends, so the days since the last pay day go unpaid (so before this change too; a gap, listed for a decision: it needs a final payment reckoned by the day). A notice of a change of pay (the town's staff have had none: no enterprise agreement reaches them). A death in service is told to the payroll by the hiring office only if the registry's entry reached the town's papers.

## An offer made on an advertisement (2026-10-09)

**Source:** `advertisedJob` and `jobTerms` (`participants/src/behaviour/common.ts`); `Staffing.roleOf`; the citizen's
three readings of a job offered (`citizen.ts`); the offer's preview (`translator/src/preview.ts`).

The code that runs an employer writes an offer of employment whole: the pay, the place of work (the worker "will be
in" the workplace), the notice, and words that name the post. A person in a seat says "offer employment as works crew
to c0113 on my posting rec.1081, at this pay", and the agreement that is written has the pay and the advertisement it
cites, and nothing else. In the wave's first works pilot five people signed such offers, had no place of work, never
came to the depot, and no waste was collected in 180 days.

- **An offer that says nothing of where the work is, made on an advertisement, is on the advertisement's terms.**
  The advertisement is the one the agreement cites, or the one the application it cites answered. Whoever reads the
  agreement reads it so from papers they have: the worker saw the advertisement when they applied (and goes to work
  where it says, `data.space`); the employer wrote it (and counts the worker in the post it advertised, `data.role`).
- **What the offer itself says stands.** A place of work or a post named in the agreement is the place and the post.
- **An offer that names no place and cites no advertisement that does has none.** The person is employed and paid
  and has nowhere to come to; the offer's preview says so before it is confirmed ("It names no place of work and
  cites no job advertisement that does: whoever signs it is paid and has nowhere to come to work."), and the staff's
  report and the office's roster say it after (docs/behaviour/standing-work.md).
- **Nothing changes for an employer run by code**: its offers state the place and name the post.

**Real-world basis.** An employer must give a worker written particulars that include the place of work, and where a
contract is silent a term is taken from what was advertised and from what the parties did. United Kingdom: Employment
Rights Act 1996, s. 1(4)(h) (the place of work among the particulars) **(to confirm: the section not opened; implied
terms from an advertisement are general contract law, no case opened)**.

**Leaves out.** An offer on terms that differ from the advertisement's in the pay is read as it is written (the pay
is the agreement's). A worker with no place of work does not write to ask where to come, and an employer cannot add
one to a signed agreement: it gives notice and offers again.

## Calibration notes for the checkpoint

Over a 2-year run of the 200-citizen town (`worlds/town.yaml`):
- Employment holds at about 160.
- Housing settles at about 152 of the ~159 who stay; 41 people leave town.
- **Money pools in shops**, which pass profits on to no one.
- **Factories slowly run down**: wages plus supplies exceed export sales.

Modelling owners and their profit draws is the obvious next step. That's economic calibration, a medium-fidelity area (D25).
