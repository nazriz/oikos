# Behaviour modules

Every code seat in a world runs a **behaviour module**: a documented, cited, swappable rule set in `participants/src/behaviour/` (D30). Modules are **world content**. They are not part of the platform, and none of them is "the" behaviour: a researcher can replace any of them, retune its parameters, or hand the seat to an LLM or a human.

Each module's doc gives:
1. **What it does**, in plain words.
2. **Where the rule comes from**: the literature or real-world practice it follows, with sources.
3. **Parameters** and their defaults.
4. **What it deliberately leaves out.**

Rules every module follows (so re-runs are reproducible):
- It sees only its Observation and acts only through SeatActions, like any other seat. Modules act through **calls** (contracts/calls.md): they say what they want brought about (`money(...)`, `form(...)`, `agreement(...)`), and the resolver turns that into the seat's own acts, exactly as for a language seat, only without the translator or a preview (D36). Paying someone is `money(...)`, and the resolver asks the account's bank. Agreements carry their commitments as outcomes, and payment requests are `request` statements (contracts/outcomes.schema.json). Helpers for all of this are in `participants/src/behaviour/common.ts`. A module reads its seat's **view** (D42): accounts, sites and the directory as their current picture, records as what's new since the seat last looked (each module keeps its own book of them).
- Randomness comes only from `ctx.rng(purpose)`: the kernel's keyed streams, keyed by seat, time and purpose.
- No clocks and no I/O. Memory is allowed, as long as it depends only on what the seat has observed and drawn.
- Its `version` is bumped whenever its rules change. Each run's log records every module's version and source hash (the `orchestrator` annotation).
- **Its parameters are declared** in its manifest (`participants/manifests/<name>.json`: types, units, defaults, each figure's source or "placeholder"), written from the module by `bun participants/scripts/manifests.ts`. A test fails if the two drift, and a world giving a module a parameter it doesn't take is refused at load.
- **Time, not wakes** (docs/design/rebuild.md 6): anything per period is computed from elapsed time (the observation's `since`), never per wake, and a retry waits a stated time. How often a module is woken must not change what it does over a period: the invariance test wakes units more often and checks.
- **Acts take time.** A module plans when a wake begins and carries on with that plan as its acts are done (`woke_for: "done"`), planning afresh only when it's finished. Time-bound steps go first: a plan's order is the order things get done.
- **Agreements by their terms.** Whether an agreement is in force, and when it ends, come from the readings with each observation (`Book.inForce`, `Book.endsAt`), not from the module's own arithmetic. What a module believes about agreements, it reports (`beliefs()`), for truth audits.

| Module | Seat | Doc |
|---|---|---|
| `bank.payment_system` | a bank's automated payment system | [bank-payment-system.md](bank-payment-system.md) |
| `world.trade` | the world market: sells at world prices against paid orders, buys exports against invoices (a boundary condition, D31) | [boundary.md](boundary.md) |
| `world.transfers` | support paid from outside (a national government's payments): decides claims by age, pays on schedule | [boundary.md](boundary.md) |
| `world.funding` | lends into the world from outside (a town bank's funding) | [boundary.md](boundary.md) |
| (winding up) | an insolvent firm's winding up, or one its owners close; selling its premises; in factories' and shops' modules | [insolvency.md](insolvency.md) |
| (entry) | founding a business: a citizen buys premises for sale and holds the new firm's first position; the firm sets itself up | [entry.md](entry.md) |
| `fund.retirement` | (off unless a world asks for a fund) a retirement fund's trustee: takes in what the fund's shares pay, pays its costs, keeps each member's part until they retire and pays it as a pension after | [firm-ownership.md](firm-ownership.md) |
| `bank.lending` | a bank's lending office: decides loans on serviceability from the account it keeps, pays out, follows arrears and default, draws funding | [credit.md](credit.md) |
| `world.export_demand` | the outside world's purchases as money on a schedule (worlds without goods) | [boundary.md](boundary.md) |
| `citizen.default` | a townsperson: housing, work, shopping and using goods up, leaving town | [citizen.md](citizen.md) |
| `firm.landlord` | a landlord's letting office | [firms.md](firms.md); its wants, in a living town: [firm-wants.md](firm-wants.md) |
| `firm.employer` | a manager with a fixed headcount at a fixed wage (not used by the generated town) | [firms.md](firms.md) |
| `firm.retailer` | a shop (Lengnick 2013): buys from the cheapest supplier, serves customers with its staff's hours, sets prices, sizes its staff to sales, pays dividends | [retailer.md](retailer.md) |
| `firm.producer` | a factory (Lengnick 2013): makes goods from inputs with its workers' hours, sells wholesale, exports; hires, sets wages and prices, pays dividends | [producer.md](producer.md) |
| `city.planning_officer` | decides permit applications under the laws that bind the office | [institutions.md](institutions.md) |
| `city.inspector` | patrols, detects unpermitted building, fines and orders demolition | [institutions.md](institutions.md) |
| `firm.builder` | builds and demolishes what it's contracted to: materials bought from its supplier, its crew's hours; invoices | [institutions.md](institutions.md) |
| `city.mayor_code` | a rule-following mayor (the all-code control; an LLM takes this seat in AI runs) | [government.md](government.md) |
| `city.council_clerk` | runs council ballots, publishes results and what passed | [government.md](government.md) |
| `city.councillor` | votes on council ballots (spatial voting) | [government.md](government.md) |
| `city.finance_officer` | pays the town's invoices under the payments procedure | [government.md](government.md) |
| `city.tax_clerk` | assesses reported tax, chases arrears (not in the generated town since C4a) | [government.md](government.md) |
| `union.organiser` | a trade union's organiser: members and dues; a yearly claim to each employer where it has members; protected action (ballot, notice, stoppages) when the offer is too low | [unions.md](unions.md) |
| (bargaining) | an employer's side: offers by capacity to pay, enterprise agreements and rises, no pay for time on strike, concessions after stoppages; in factories', shops' and the builder's modules | [unions.md](unions.md) |
| `city.works` | the town's works office: hires the crew the budget's staff line pays for; collects waste from homes and keeps the town's assets up, from the depot; takes waste to the landfill | [services.md](services.md) |
| `city.environment` | the town's environment office: hires the scientists the budget's environment line pays for; surveys the district's species each quarter; reports, and keeps a habitat register for planning | [environment.md](environment.md); the physics: [nature.md](nature.md) |
| `school.principal` | a school: keeps its teachers, gives places to children of school age, teaches each classroom on school days (raising pupils' skill), certifies those who finish | [education.md](education.md) |
| `clinic.practice` | a clinic: keeps its doctors, sees patients who come in and ask, in turn, as their hours allow (care shortens a condition) | [health.md](health.md) |
| (the daily round) | a body in one place at a time; travel takes time; citizens go to work and school and come home; employers look when their staff are in | [daily-round.md](daily-round.md) |
| (home ownership) | owner-occupiers at the start, mortgages the bank takes on, owners' rates, titles passed to heirs | [ownership.md](ownership.md) |
| `utility.water` | a water corporation: draws the town's use from the river each day (restrictions when it can't), bills owners quarterly | [utilities.md](utilities.md) |
| `utility.energy` | an energy retailer: buys from the grid, supplies its customers (emitting the grid's greenhouse gas), bills them monthly | [utilities.md](utilities.md) |
| `police.station` | the police: officers by establishment, reports investigated (finding who with a chance), charges to the tribunal; warrants carried out; in the officers' hands under standing orders when a model holds the office | [crime.md](crime.md), [standing-work.md](standing-work.md) |
| (a death made known) | those who share a home report a death there; someone with nobody at home is found by their landlord or the police; in the citizen's, the landlord's and the police's modules | [deaths.md](deaths.md) |
| (floods) | the river over its banks, buildings flooded and their people to the relief centre | [floods.md](floods.md) |
| `tribunal.member` | a tribunal's member: lists applications, tells both sides, and on the day decides on the record under the laws in force (a rent increase invalid or valid; a debt ordered paid) | [justice.md](justice.md) |
| `office.desk` | a body that hears grievances (a town's complaints desk, an ombudsman, a consumer desk): says what it hears, tells the other side, decides by its procedure as fast as its members' hours allow; and what goes wrong in a living town, and how often | [frictions.md](frictions.md) |
| `tribunal.registrar` | a tribunal's registrar: enforces an unpaid order to pay by a garnishee order to the debtor's bank | [justice.md](justice.md) |
| `city.electoral_office` | the town's elections: keeps the roll, gives notice, takes nominations, publishes the ballot, counts by instant runoff, and appoints the winner | [elections.md](elections.md) |
| `firm.newspaper` | the local paper's editor: runs the week's most newsworthy public records, with a tone toward the town's government and a leaning | [news.md](news.md) |
| `world.disposal` | the outside world's landfill: invoices monthly for what's delivered, at a price a tonne | [services.md](services.md) |
| `city.rates_officer` | levies rates on the valuer's valuations under the rating law, records them as claims, charges penalty interest on what's overdue | [public-finance.md](public-finance.md) |
| `world.weather` | the outside world's weather bureau: warns of heavy rain, drought and heatwaves ahead (the weather itself is drawn for the run from the climate) | [weather.md](weather.md) |
| `world.statistics` | the outside world's statistician: prices a sample of outlets monthly and publishes the mean (a price index) | [boundary.md](boundary.md) |
| `world.valuer` | the outside world's valuer: values every private property yearly (land, plus the builder's price for its buildings) | [public-finance.md](public-finance.md) |
| `world.grants` | the outside world's grants to the town: quarterly, per resident | [public-finance.md](public-finance.md) |
| (payroll) | employers withhold income tax under the published law and pay it over monthly, in `Staffing` | [public-finance.md](public-finance.md) |
| `body.payroll` | a body's payroll officer (pays and stops its staff's wages, files and pays over the tax withheld, hears of a death as an employer does) and its deputy (fills a post whose holder has died from the body's staff) | [staffing.md](staffing.md) |
| (an offer taken back) | whoever made an offer withdraws it before it is signed; it can then not be signed, and a signature after the withdrawal concludes nothing | [offers.md](offers.md) |
| `idle` | does nothing (placeholder, and a control condition) | this page |

Trade in goods (price lists, orders paid with the order, delivery notes) is shared by every module that buys or sells: [trade.md](trade.md). What buildings take (materials, hours of work) is in [building.md](building.md).

The town these modules run in is made by the [generator](generator.md). What a participant reads before it confirms a draft is in [preview.md](preview.md).

**Every act says why.** A module wraps each act's calls in `because("…", ...)` (`participants/src/behaviour/common.ts`): the rule that fired, in plain words, with the numbers it used ("Applying for apts-3/dwelling.2: the dearest home we've seen within a third of household income, with at least 2 bedrooms"). It goes into the log as the act's `reasoning`, and records cite what they rest on (`basis`) where there is something to cite. The renderer's causal trace (Stage 3) reads both. `measure … why` shows the coverage.
| `reading` (dial, not a seat) | what the words of a seat's paper mean to the person who receives it: a reader says what the paper is like, code moves each person from their own record | [reading.md](reading.md) |
| `culture` (dial, not a seat) | what each person takes those around them to do and approve of, for a short list of conducts; moved only by ties, presence and what is published; one bounded term in the decisions the code mind makes | [culture.md](culture.md) |
