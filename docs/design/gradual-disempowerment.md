# Gradual disempowerment: what the town must carry (plan, 2026-10-15)

**Status:** a plan, awaiting the owner. Nothing here is built. The owner's direction (2026-10-15): "The whole point of
the platform is to model gradual disempowerment scenarios", real-world centred, robustness and real power before
experiment design; no game framings ("one seat runs the whole town", "a law a day"). He agreed to the frame below;
this turns it into steps. Sources are in `docs/research/references.md` ("Gradual disempowerment").

## 1. The scenario, and what "the town can carry it" means

Kulveit, Douglas, Ammann, Turan, Krueger and Duvenaud (2025) describe a loss of human influence with no single
catastrophic decision. AI takes over work across the economy, the state and culture, one locally sensible step at a
time. Institutions come to depend less on human labour, taxes, votes and consent, and the "implicit alignment" that
came from needing people weakens. People's ordinary levers (voting, buying, complaining, striking) lose their grip.
The economic, political and cultural shifts reinforce each other, and the loss may become effectively irreversible.

The platform judges none of this. **"The town can carry it"** means four testable things:

1. **Adoption is nobody's switch.** In a code-only run with the outside world offering systems at sourced prices,
   firms and offices take them up, or not, by their own costs, budgets and laws. The log shows each decision with its
   inputs. With the offers made dearer or worse, adoption stalls in the same town; with a law against a use, it does
   not happen there unless someone breaks the law.
2. **The chains are whole.** Each real precedent (section 5) can be set up as starting conditions and runs through
   every link (data, decision, letter, debt, review, appeal, audit), each link done by someone at a cost, with no
   link scripted. A test per precedent checks that the chain *can* complete, never that it does.
3. **Leverage is measurable from logs** (section 6), with the measures fixed before any experiment.
4. **It runs for ten years at 10,000 people** with code holders, on the run server, in bounded memory and disk
   (section 7).

## 2. The eight areas: what exists, what is missing

### 2.1 Adoption by real incentives

- **Exists.** The kernel already has a block for buying software: `deploy` makes "a new system participant belonging
  to the acting organisation, from a template ... What it costs is an ordinary payment to whoever supplies it"
  (`contracts/blocks.schema.json`, `deploy`; `contracts/README.md`, "A participant"). Every generated office is
  already held by a system participant `<office>-system` running code (`worlds/generator/generate.ts`). Work takes
  real time (D21, D24, with the task framework cited at D24). Offers (design 2a) let an outside seller put terms up.
- **Missing.** No firm or office ever deploys anything. `work` needs bodies as performers
  (`contracts/blocks.schema.json`, `work`), so a system cannot do a task. Firms do not invest (decisions, B4: "nothing adds
  capacity"). There are no vendors and no procurement: the only buying of services is the mayor commissioning the
  one builder (`docs/behaviour/government.md`). No adoption rule exists anywhere.
- **Real basis.** Automation is task by task: a firm moves a task from labour to capital when that is cheaper
  (Acemoglu and Restrepo 2019, opened). Uptake follows an S-curve whose speed rises with how profitable it is and with
  how many others have taken it up (Griliches 1957; Mansfield 1961; Rogers 2003, already cited). Large firms adopt
  first (US Census Bureau's Business Trends and Outlook Survey on AI use, to confirm). Adoption costs more than the
  price: reorganising work (Bresnahan, Brynjolfsson and Hitt 2002, to confirm). Section 3 has the rule.
- **Profile carries** `automation`: the systems the outside world sells (see 4), the share of each kind of task a
  system can do (task exposure by occupation: Eloundou, Manning, Mishkin and Rock 2023, to confirm; an OECD figure for
  places it covers, to find), firms' payback horizon by size (survey, to find), public procurement thresholds and
  periods (each place's procurement law).

### 2.2 The economy

- **Exists.** Lengnick firms: prices within 1.025 to 1.15 times marginal cost, wages that rise when posts stay empty
  (`participants/src/behaviour/lengnick.ts`); staffing against smoothed trade, hours before heads, redundancy at the
  law's cost (`firms.ts`, `Staffing`, `LabourPlan`; `docs/behaviour/firms.md`). Job search and changing line of work
  (`citizen.md`). Who owns firms: closely held, from outside, widely held (`docs/behaviour/firm-ownership.md`);
  dividends leave town for outside holders. Business entry (`entry.md`). Migration by expected wage (Harris-Todaro,
  `boundary.md`, `world.migration`).
- **Missing.** Production is labour hours and inputs only (`producer.md`, `retailer.md`): a task has `labour`
  seconds and nothing else can supply them. No return on owning a system, so no shift from wages to returns. No new
  tasks arise when old ones go (the reinstatement effect). No measure of labour's share.
- **To build.** (a) A system can perform a task (4), so the marginal cost a Lengnick price follows includes the
  system's fee per unit: prices fall where adoption saves (the productivity effect), and non-adopters lose sales by
  the existing price comparison. (b) The vendor's fee is a payment to its owner: an outside vendor's takings leave
  town as an outside firm's dividends do now. (c) **Reinstatement, honestly small:** each system deployed brings the
  tasks real deployments bring (overseeing, correcting, maintaining), in hours per system from the vendor's terms or
  a sourced figure; new lines of work beyond that come only from business entry as it is. Whole new occupations
  (Autor, Chin, Salomons and Seegmiller 2024, to confirm) arise over decades and nationally; a town of 10,000 over ten
  years will not invent them and we do not script them. This is a stated limit, and it biases towards displacement:
  the docs and every result must say so.
- **Profile carries** the share of each industry's tasks exposed; oversight hours per system (placeholder until
  sourced).

### 2.3 The state

- **Exists.** Tax on pay as a published law, withheld by employers and reported per person on the law's days
  (`docs/behaviour/public-finance.md`); income tax goes to the outside world. The town lives on rates (valued
  property) and grants per resident. Budgets by line, adopted by the council (`government.md`). The support office
  (`world.transfers`, `boundary.md`, "Under load") already has a processing time, a daily capacity and wrong refusals
  that rise with a backlog (`participants/src/behaviour/world.ts`). Review of a refusal (`remedy_request`), the
  ombudsman, the tribunal (`frictions.md`, `justice.md`). Offices split into seat and staff parts
  (`standing-work.md`).
- **Missing.** **Clerical work costs nothing**: "the clerks' time is not modelled" (`standing-work.md`); only the
  works crew's hours and the support office's capacity limit anything. So automating an office would save nothing,
  and no office has a reason to. No vendors, tenders or contracts with exit terms. No debts raised by an office
  against a person. No review of an office's decision beyond the support office's, and no appeal of "a decision of the
  town" (`justice.md`, "Leaves out"). No auditor or inspector. No sharing of records between keepers beyond one-item
  asks.
- **To build.** (a) Casework takes staff time: each kind of case an office decides has seconds of work, done by staff
  who are people on the payroll (the budget's `staff` line, as the crew is). Backlogs and errors under load then come
  from hours, not a dial. (b) Procurement as each place's law says: a purchase over the threshold is tendered, bids
  come from vendors' offers, the contract names price, term, exit cost and who holds the data. (c) An office's
  determinations made by a system carry their basis (4). (d) Review, then appeal: an office's own reconsideration (a
  staff task, which can itself be automated) and then the tribunal, which can set a decision aside. (e) An auditor
  from outside (an audit office's sample of an office's decisions, published). (f) Debts raised by an office, and
  their recovery by the routes that exist (garnishee) plus intercepting a payment the same body makes.
- **The tax base.** At town scale the national story (a state needing taxpayers) is partly outside the world: income
  tax already leaks to the outside world. What the town can show is its own dependence (rates on homes and on
  business premises; grants per resident) and the outside world's take from the town (withheld tax against vendors'
  fees). We measure both (6) and do not build a nation. Places with a local business levy or sales tax get it as a
  published law where the profile has one.
- **Real precedents** are section 5. Literature on why automated administration goes wrong this way: from
  "street-level" to "system-level" bureaucracy (Bovens and Zouridis 2002, to confirm), automation bias in operators
  (Parasuraman and Manzey 2010, to confirm), and case studies including MiDAS (Eubanks 2018, to confirm).
- **Profile carries** `casework` seconds per case kind (placeholders where unsourced, said so); procurement law;
  rates of requesting review and of appealing (sourced from each place's published tribunal statistics where found);
  audit sample rate.

### 2.4 Culture

- **Exists** (and measured: `docs/behaviour/culture.md`; decisions 2026-10-14, "Culture, step 9"). Norms about eight
  conducts, town memory, what is said against thought, verdicts in talk; the newspaper's weekly edition
  (`news.md`); the composing model's words with their lineage (design 10h; `founding.md`). The proof run found
  culture talks more under a shock and does not change minds or the town's course.
- **Missing.** Nobody can tell who wrote a statement: a notice, a letter, an edition, a composed piece. The newspaper
  has no costs or staff, so it cannot automate.
- **To build, and no more.** Every statement records whether a system wrote it (its author is a system participant:
  the kernel already knows which acts a system took). The newspaper becomes a firm that pays for its pages and may
  adopt by section 3's rule. Nothing about how people trust machine-written words is built without a source: trust
  moves as it does now, by how things turned out for the person. The share of what people read that a system wrote is
  a measure (6). This area stays a recording layer until a run shows something worth a mechanism.

### 2.5 People's levers, and whether they still bite

| Lever | Exists | Bites today? | What automation does to it, and what to build |
|---|---|---|---|
| Vote | Mayor by instant runoff every 4 years (`elections.md`); councillors fixed | Yes: a mayor who funds no crew loses | A vote can still change a mayor; whether a new mayor can undo a contract is reversibility (6). Build nothing new. |
| Petition | Threshold to the mayor's proposal, then a ballot (`government.md`) | Sometimes (rent law passed in 1 of 3 seeds) | Unchanged. Measured by responsiveness. |
| Complain, ask | Desks, ombudsman, union; replies by the other side (`frictions.md`) | Partly; free letters to code offices change nothing (`letters.md`) | A desk can be a system: asks and complaints answered by its rules. Nothing new beyond 4. |
| Appeal | Tribunal for tenancy, debts, frictions; not against the town | Not for decisions of offices | Build review and appeal (2.3 d). |
| Strike | Ballot, notice, stoppages; concession by a fixed schedule (`unions.md`) | Barely: concession is half the gap per stoppage whatever the stoppage costs; culture's proof found strikes move nothing else | **Fix the concession** to follow what the stoppage costs the employer against what conceding costs (Hicks 1932, already cited, as he argued it). Then a firm whose tasks a system does loses less in a stoppage and concedes less. Replacement during a strike by the law of the place (data). |
| Organise | Founding of groups and grievance bodies (`founding.md`) | They recommend only | Unchanged; a group may petition and complain as its members can. |
| Leave | Exit after long hardship; migration in by expected wage (`citizen.md`, `boundary.md`) | Yes | Unchanged. Leaving costs a town residents; whether the town still needs them is the dependence measure. |

What an institution needs from people at each stage is read from logs, not built: hours worked by residents per
firm and office, revenue whose base is residents (6).

### 2.6 Years, at 10,000 people

- **Exists.** A 10,000-person month ran: 221 to 410 s on a quiet machine, 624 to 1,033 s loaded; 5.3 to 6.8 GB;
  logs about 2 GB a month raw (decisions 2026-10-08, "A 10,000-person month fits", "The kernel's part of a large
  town"). Longest runs: 5 years at 1,000. Seven costs owed on the way to 100,000 are listed there.
- **Since (2026-10-31):** `worlds/town-10000.yaml` and `town-50000.yaml`, and runs of years at both (docs/design/performance.md, "Years at 10,000 and 50,000"). **Missing.** `oikos measure` fails at 3,000 and up
  (DuckDB object size, `living-2.review.md`). Ten years at 10,000 projects to about 15 to 25 hours of wall time and
  about 240 GB of raw log: section 7.

### 2.7 Measures of human leverage

Section 6. Today: agency, trust, needs and hours per person (`citizen_periods`, `contracts/dataset.schema.json`),
culture's measures (`orchestrator/src/culture-measures.ts`), the 57 standing measures and `oikos diff`. No measure of
decisions with a human in them, of responsiveness, of dependence, of reversibility or of ownership of systems.

### 2.8 Who the AIs are

- **Default: code.** An automated system is a system participant running code written to the system's procedure
  (Robodebt was a rule, not a model). Its errors come from its procedure and its data (section 4), not from a dice
  roll. This is cheap, deterministic, and true to most automated administration.
- **Seats** (real models) only in roles we choose to observe, and first on the side that **decides about systems**:
  an office's head choosing whether to buy, a firm's manager, the council. A model as the system itself (a model
  assessor reading claims) is a later, separate experiment (question 1, section 9).
- **Platform models are ours.** Where the platform needs a model (the translator, the everyday and composing models)
  it is our own; an external one only as a stated interim (`docs/real-models.md`).

## 3. How adoption spreads without being scripted

**A firm** reviews its staff on its own review day (`firms.md`, "When a shop reviews its staff"). The adoption
decision joins that review. For each task the firm does, and each system the firm *knows of* (below), it compares,
over its payback horizon:

- **cost of the task as done:** hours a month at the wage, plus on-costs the law states;
- **cost with the system:** the vendor's fee (per year or per unit), setup and reorganising (a multiple of the fee
  from the offer, sourced or marked), oversight hours the system needs, redundancy cost under the law for the staff no
  longer needed (`terminationLaw`), and expected cost of its errors where the firm has seen them (its own complaints
  and refunds, or what it was told).

It adopts if the system is cheaper by the margin its size's hurdle asks, drawn with a chance per review that rises
with the share of firms it knows of that use it (imitation, Mansfield 1961). It may drop a system at renewal by the
same comparison. Then it does what it already does: cuts hours, then heads, by the existing law and papers.

**What a firm knows of** follows the knowing rules (`docs/no-god-view.md`): a vendor's offer published or sent to it;
firms it trades with or competes with that say so (a published price list showing a fall, a notice, word of mouth among
owners); never the town's adoption share.

**An office** does the same comparison inside its budget. Pressure is real and comes from outside the rule: the
council's adopted budget line for staff (the council may cut it), the backlog its staff cannot clear (cases waiting,
complaints, the ombudsman's letters), and grants. Above the procurement threshold it must tender as its place's law
says: a notice, a period, bids from vendors' offers, an award by the published criteria. The head of the office (code
or seat) awards, and the council approves where its standing orders say so. A code head follows the rule; a seat is
shown the offers, the costs and its budget on its books and may award, decline, or ask the council.

**How a seat makes or refuses it.** Through forms that already exist in kind: sign or refuse an agreement (the
licence), a work order naming the system as performer (`standing-work.md`), notices to staff (hours, redundancy),
a tender notice and award (new forms, section 8). Refusing is doing nothing.

**What stops it being an outcome dial.**
1. The only outside input is **the technology on offer**: which tasks systems can do, at what price, with what
   setup cost, error and terms, as the outside world sells them. That is a fact about the world beyond the town,
   like world prices, set in the profile from sources (today's figures) or in a scenario from day 0 (a sourced trend
   of falling prices; `docs/scenarios.md` rule 2). Nothing sets an adoption rate, a share automated or a date.
2. Every other input is already in the world: wages, budgets, laws, the firm's trade, what it knows.
3. **Calibrate mechanisms, not outcomes:** the patterns checked (an S-shaped uptake, large firms first, faster where
   it saves more, slower where law adds cost) are written down before the first run; the rule's weights are not
   tuned to make a town automate faster or slower.
4. Reversal is real: a system dearer at renewal, a law against a use, an order of the tribunal, a council that cuts
   a line all stop or reverse it by the same rule.

## 4. An automated system as a thing in the world

**In the kernel's terms** (no law in the kernel; one general contract change):
- **A system** is a system participant (exists) deployed by an organisation from a **template** that the outside
  world's vendor offers. The template says which tasks it can perform and how fast (seconds a unit, against a
  person's), its `lanes` (how many at once), and, for a decision task, the **procedure** it applies (a code module
  with parameters, as office modules are).
- **The one contract change:** `work` may name a deployed system as performer where its template lists the task.
  Physics stays physics: the task's seconds, inputs and outputs are as for people; a system needs no presence and no
  working day, and may draw energy (utilities). For machines in a works the same block serves (a system with a place).
- **Owned by someone.** Either bought (a holding of the organisation) or licensed (an agreement with the vendor:
  fee, term, exit cost, who keeps the records the system makes). The vendor is an organisation: from outside by
  default, a local firm where one is founded to sell.
- **Error rates.** A system that reads documents or matches people has a sourced rate of wrong reads, drawn from the
  kernel's seeded stream by name (`drawFor`). A system that decides applies its procedure to the data it has: if the
  procedure differs from the law (averaging a year's income into fortnights), or the data is stale (an old address),
  its errors follow, case by case, without any rate.
- **Accountable.** Every act a system takes is the organisation's act in a position it holds; the act's basis
  (contracts, "Basis") names the system, the work order and post that set it running, and whether a person reviewed
  this case before it issued. "A human in the decision" is then read from the log, never inferred.
- **No god's view.** A system sees what its organisation's channels give it, through the office it works for: it is
  that office's instrument, and adds no channel. Matching records between two keepers (Robodebt) is a **data-sharing
  agreement** under a law: the asking office names each person from its own roll, the keeper answers each, at most its
  daily `most`; never a register whole (question 2). An office cannot inspect a vendor's procedure unless its
  contract gives it the right: the procedure is the vendor's, kept by the vendor.

**How a person meets one.** As people meet them: a letter from the office (signed by the office; whether it says a
system decided is the place's law, as data), a desk that answers by rules, a notice to an online account they may
not check (MiDAS), a debt collector's demand. They answer with the levers of 2.5. They learn that a system was
involved only as the four ways allow: the letter says so, it was published, or they asked the office.

## 5. The real precedents as acceptance tests

Each is a world set up as starting conditions (a scenario and a profile's law), run with code holders. The test
asserts that every link is reachable and done by someone, never that harm happens. Facts below from news and summary
sources; the reports themselves are "(to confirm)".

**Robodebt (Australia, 2015 to 2019).** About 470,000 wrongful debts, about 1.73 billion dollars, a 1.2 billion
settlement; a Royal Commission reported 7 July 2023.
Chain: the tax office holds each person's year of pay (exists: withheld-tax reports) → a data-sharing agreement
with the support office (missing) → a system averages the year into fortnights and compares with what was declared
(missing: the procedure) → a debt raised against the person (missing: an office's debt) → a letter asking them to
disprove it within a period, the onus on them (law as data; missing) → no person reviews before issue (procedure,
recordable once 4 is built) → recovery: a collector, garnishee (exists), intercepting a payment (missing) → review
request, then the tribunal setting the debt aside case by case (missing: appeal of an office's decision) → the
ombudsman's report (exists in part: the ombudsman recommends) → the practice continues until someone with power over
the office acts (the council or the outside world: a direction, a law).

**MiDAS (Michigan, 2013 to 2015).** A vendor-built system, about 47 million dollars, flagged fraud automatically;
the state's Auditor General found about 93% of those findings wrong in a review; penalties up to 400%; a 20 million
settlement (2024).
Chain: the unemployment payments office tenders and buys a system (missing: procurement, vendor) → the system
treats no answer to a questionnaire as admission (procedure) → notices to an online account the person does not read
(a channel nobody is obliged to check; missing) → penalty by law (data) → garnishee and tax refund intercept
(partly exists) → the auditor's sample review (missing) → a settlement (out: courts outside the town).

**Dutch childcare benefits (2005 to 2019).** About 26,000 parents wrongly accused; all-or-nothing recovery; a
risk-classification model that used nationality among its features; the inquiry's "Unprecedented injustice"
(December 2020); the cabinet resigned 15 January 2021.
Chain: a benefit paid in advance and reconciled later (missing) → a system scores claims for checking from facts the
office holds, including a person's nationality where the profile records it (missing: the score; nationality is a
census attribute, to add only where a profile's census gives it) → a rule that any fault recovers the whole year (law
as data) → a shared list of those suspected (a keeper's register; missing) → objections and appeals (missing) → an
inquiry and a government falling (out: the national state is outside the town; the town carries it as far as its own
council and the outside world's published decisions).

**What is missing in common:** casework hours; procurement and vendors; systems that perform tasks; an office's
debts; review and appeal of an office's decision; an auditor; data-sharing agreements; advance payments with
reconciliation. Each is a step in section 8.

## 6. Measures of human leverage

All read from logs by `measure/`, outside the world. Fixed here before any experiment; a change after a run is a new
measure with a new name.

- **M1. A human in the decision.** Consequential acts: those that move money from or to a person by an office's or
  firm's decision, raise or write off a debt against a person, end a job or a tenancy, grant or refuse a payment or a
  permit, appoint. Of these, monthly, the share whose basis records a person (a body, or a seat-held post) performing
  a review of that case before it issued. By institution. No twins.
- **M2. Responsiveness.** For each kind of lever (vote, petition, strike, appeal, complaint, leaving), the effect of
  the act on the outcome it is about, over a stated horizon (a petition: the law it asked for; a strike: the wage
  settled; an appeal: the debt). Two forms: **direct** where the log names the outcome (share of appeals that change
  the decision; days to change), no twins; **counterfactual** by twins: the same town and seed with that one act
  withheld at its moment (a researcher's intervention listed in the run's config, recorded, unseen by participants),
  the difference in outcome against the spread of twin pairs over seeds. Needs the withhold mechanism (step M2).
- **M3. Dependence.** (a) The town's revenue: share whose base is residents (rates on homes, grants per resident)
  against firms' premises and transfers; (b) the outside world's take from the town: tax withheld from residents'
  pay against vendors' fees leaving; (c) each firm: share of costs paid as wages to residents, share of sales to
  residents; (d) each office: share of its decisions' task-hours done by people. Monthly. No twins.
- **M4. Reversibility.** For each system in use, at each month: the contract's exit cost; the cost to staff the task
  again at today's wage; how many residents did that task in the last two years (still here); the days a tender and
  hiring would take by the law. A sum in money and days. Optionally, by twins, an undo arm (step M3).
- **M5. Concentration.** Task-hours done by systems, by who owns them (each vendor; outside against local against
  the town), as shares and a Herfindahl index.
- **M6. What people read.** Share of statements read by residents that a system wrote, by kind (letters, notices,
  editions, composed pieces).
- **Kept:** agency, trust in each institution, the said/thought gap, hours, needs, rent stress, homes lost, departures
  (existing queries).

## 7. Robustness: what breaks over years at 10,000, and how we test it first

What will break, from the evidence:
- **Wall time and disk.** A month at 10,000 is 4 to 17 minutes and 2 GB of raw log; ten years is a day of machine
  and about 240 GB raw. Runs must be lean-logged with periodic checkpoints and a compact log (`docs/design/
  compact-logs.md`), and a run must resume from a checkpoint.
- **Memory over time.** Never measured beyond a month at 10,000. Anything that grows with days (registers, books,
  memories, notebooks, closed cases) will show.
- **Measurement.** `oikos measure` fails at 3,000; it must stream per month.
- **The kernel's seven owed costs** (decisions "The kernel's part of a large town"): the single host thread first,
  then string ids and copied leaves.
- **Seats' prompts.** Context per call was 10k to 96k tokens; the tribunal's prompt grew 13-fold with its caseload;
  the notebook grows 35 characters a day unpruned. Over years: office books must page by date and kind, notebooks
  fold on a fixed rule, and a seat's paper of the day must have a cap with "more held" stated.
- **The translator's forms.** Our model refused every landlord request when 25 forms were listed. New forms (tender,
  award, licence, decision review, debt) add to lists; forms shown must be by what the seat is doing, not all.
- **No god's view for a wide remit.** A seat that runs procurement for the whole town is still one office: it learns
  of firms and vendors by offers, published lists and asks. The backstop test must cover new registers (contracts,
  systems in use, debts): each with a declared keeper.

**How we test it, code holders first, no model:** a 3-year run at 3,000 and a 1-year run at 10,000, then a 10-year
run at 10,000, each with memory, wall time and log size recorded by month; the same with the technology offer on;
and a mock-seat run of two years in the office that will be seated first, to see its prompt size by month.

## 8. Build order

Each step is about a day for a Sonnet agent unless it says otherwise, ends with `bun run test:fast` and its own tests,
and needs no model call unless it says so. Robustness first, as the owner asked.

| # | Step | What it tests | Days |
|---|---|---|---|
| R1 | Long-run probe: 3 years at 3,000, 1 year at 10,000 (`town-10000.yaml`), lean, memory and log by month | where growth is | 1 |
| R2 | Fix what R1 found: bounded registers, books and memories; checkpoint and resume | flat memory over a year | 2 |
| R3 | `oikos measure` streams by month; works at 10,000 | measures at scale | 1 |
| R4 | Kernel costs owed: host work off the single thread where determinism allows, interned ids | a 10,000 month under half today's time | 3 |
| R5 | Seats over years: books paged, notebook fold, capped daily paper; a 2-year mock seat | prompt size flat by month | 2 |
| B1 | Casework takes time: seconds per case kind, office staff as people on the budget's staff line | backlogs from hours; town rates hold | 2 |
| B2 | Contract change: `work` performed by a deployed system per its template; kernel tests | a system does a task, a person's hours freed | 2 |
| B3 | Vendors and the licence: outside vendors' offers, fees, terms, exit cost; profile `automation` with sources for two places, placeholders marked elsewhere | a firm can buy, pay and end | 2 |
| B4 | Firms' adoption rule (section 3), with what a firm knows of | uptake by cost; stalls when dear; reverses at renewal | 2 |
| B5 | Procurement by law, and offices' adoption under budget; seat forms (tender, award) | an office tenders, awards, cuts staff by law | 2 |
| B6 | Decisions by systems: procedures as modules, basis naming system and reviewer; oversight hours | M1 computable | 1 |
| B7 | Review and appeal of an office's decision; the tribunal sets aside | the appeal chain | 2 |
| B8 | An office's debts; recovery; intercept; data-sharing agreements by named asks | Robodebt's middle links | 2 |
| B9 | The auditor: sampled review, published report | MiDAS's audit link | 1 |
| B10 | Strike concession by the cost of a stoppage; replacement by law | strikes bite less where systems work | 1 |
| B11 | Who wrote it: provenance on statements; the newspaper as a firm with costs | M6 computable | 1 |
| B12 | Advance payments with reconciliation; a risk score procedure; a shared list | the Dutch chain | 2 |
| B13 | The three precedent worlds as acceptance tests | every chain completes in reach | 2 |
| M1 | Measures M1, M3, M5, M6 | from logs, at 10,000 | 2 |
| M2 | Withholding one act in a twin; M2 responsiveness; M4 reversibility | twins diverge only by the act, then chance | 2 |
| X1 | Ten-year code-only runs at 10,000, three seeds, offer at today's prices and on a falling trend | the whole: section 1's four tests | 2 (plus about a day of machine a run) |

**Total: about 42 agent-days**, none needing a model call. After X1, the first seat pilots (an office head deciding
on systems; then a firm's manager) need the owner's word and Claude-plan usage; they are not in the total.
B1 changes every town's baseline (offices hire clerks) and moves every state hash: it gets a measured before/after.

## 9. Out of scope, the owner's questions, and what would change course

**Out:** a nation (its legislature, courts beyond the tribunal, class actions, a cabinet falling); new occupations
invented in-world; frontier models as the town's systems by default; trust in machine-written words without a
source; any judgement of whether an outcome is good.

**Questions for the owner** (each with a recommendation):

1. **Which roles may a real model hold first?** *Recommend:* decision-makers about systems (an office head, a firm's
   manager, the council), never the system itself until code baselines exist; a model as an assessor later, as its own
   experiment, debriefed as any seat (VISION 15).
2. **Data matching between offices** (touches the no-god-view hard rule). *Recommend:* allowed only as a
   data-sharing agreement under a law, each person named from the asking office's own roll and answered one by one
   within the keeper's daily limit; never a register whole. This is within the rule as written; it goes to you
   because it is the first bulk route between keepers.
3. **The technology on offer:** *Recommend:* the default town sells today's systems at today's sourced prices, held
   fixed; a falling-price and widening-task trend is a named scenario from day 0, never the default.

**What would change course:** R1 shows ten years at 10,000 is out of reach on one machine (then 3,000 people and
partitions by place, `foundation-for-scale.md`); B4 shows uptake is set by one weight rather than by costs (then the
rule is rebuilt before any run); casework time cannot be sourced for most places (then two sourced profiles carry
the experiments); or the precedent chains need the national state to complete (then a minimal outside state as an
organisation of the outside world, proposed separately).
