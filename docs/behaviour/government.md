# The town's government (code mayor v0.12.0, clerk v0.10.0)

**Source:** `participants/src/behaviour/government.ts`. These are code seats of the town (`entity: city`), plus the mayor's code stand-in. None of this is kernel mechanics (D19, D20). A law exists because a clerk published it after counting a ballot. Money leaves the town's account because the finance officer instructed the bank, and the bank checked its list of signatories. Every step is a person following, or not following, a procedure written as a record.

## How the pieces fit

```
petition (citizens) ─┐
                     ├─> proposal (mayor) ─> ballot (clerk) ─> votes (councillors) ─> result + law/budget (clerk)
annual budget ───────┘
amendment form (anyone) ─> proposal ─> ballot (clerk) ─> votes ─> result + the law rewritten from its figures, the old one withdrawn (clerk)
permit application (mayor) ─> decision (planning officer) ─> construction agreement (mayor, builder)
  ─> construct + invoice (builder) ─> approval (mayor) ─> money(...) (finance officer): a payment request ─> transfer (bank)
valuation (valuer, outside) ─> rates notice + claim (rates officer) ─> payment naming the claim (owner) ─> penalty interest monthly if overdue
```

The genesis records that set this up are world content, made by the generator:
- `signatories-city` is the town's mandate to its bank, by resolution of the council before the year began: only the `finance` seat instructs payments from `acc-city`, and only it holds, changes or withdraws a standing instruction on it (docs/behaviour/bank-payment-system.md, "The instructions a town opens with");
- `grant-city` is the funder's determination of the town's grant (so much a year for each resident by the published population estimate, how often, from when, into which account), and `landfill-charges` the landfill's charge a tonne, where the place has one: the papers behind the grant the budget expects and the invoices the services line pays (docs/behaviour/public-finance.md);
- `proc-payments` is the payments procedure: wages and bills only within the budget adopted for the year (while a year has none, as the charter allows: below, "The budget year"), and any one payment over the profile's figure only with the written approval of the post the procedure names (the mayor): the procedure's record carries it as data (`data.approval`: the post and the sum), and the finance office reads it there and not from a parameter (foundations F8);
- `budget-year-1` and the four kinds of paper it rests on: the budget the town opens with ("The budget year");
- `law-rates` sets the rate in the dollar of value, the instalments and the penalty interest (docs/behaviour/public-finance.md). The generated town has no rent tax (`law-tax` had no source, and is gone from the example code since 2026-10-09; a world that wants one writes its law);
- `law-planning`'s fine and `law-tenancy`'s notices are the profile's (docs/profiles.md, "Sums and figures in a town's laws"): the example code holds no sum and no figure;
- the law schedules (`schedule-...`, kind `law_schedule`) and a form to amend each one's law (`form-amend-...`): see "Laws made from figures" below.

## The budget year (2026-10-09)

**A town opens with its first year's budget adopted.** A council does not begin a year without a budget: the year's was adopted before the year began (docs/research/references.md, "A council's budget year"). Until 2026-10-09 a generated town began with none and a procedure that forbade paying outside one; the code mayor tabled one on the first day and the council adopted it about a fortnight later, so a code town never noticed, and every model seat did (the live check of 2026-10-09: a finance officer put a hold on all six wage orders, a mayor asked the bank to stop wages).

- **The papers.** The generator writes what the town's own procedure leaves on file, each in the post that makes it and each resting on the one before: the mayor's proposal on the council proposal form (`budget-year-1-proposal`; since generator 0.43.0 each line's sum in its content is written as the town writes its money, as its words are: until then the content held bare counts of the smallest unit, "environment: 4321834", beside the same sums written properly), the clerk's ballot of the council (`budget-year-1-ballot`), a vote for each councillor's post, the result (`budget-year-1-result`) and the budget (`budget-year-1`, kind `budget`, `data.year` 1 and `data.lines`). The budget's `data` is what the clerk's own form for an adopted budget writes. Like the agreements people start with, they were made before the run began: their author is the world's beginning, their time its first moment, and their words say "before the year began".
- **The lines** are the ones the mayor's office tables every year (`tabledLines`), each from the town's own figures and none set to make a sum come out:
  - `staff`: the posts on the works crew (the profile's council staff for each 1,000 residents) at a year of the crew's wage. It covers the wage orders the town starts with (tested for every profile);
  - `environment`: the environment office's posts (the profile's survey staff), likewise;
  - `services`: the landfill's charge on a year of the town's waste, and a fifth over (no charge: no line);
  - `roads`: the profile's roads budget for each resident;
  - `parks`: the profile's parks line (a placeholder in every profile: a stated sum that does not follow the town's size).
  The budget's words give each line and the sum as the town writes its money, the year in days ("day 0 to day 364"), and what the town expects in rates and grants in the year (the profile's figures for each resident). Nothing checks one against the other: a small town's parks line can be more than it takes in, and that is the profile's placeholder showing.
- **The year turns over.** A budget is for one year of 365 days from the town's first day. The code mayor tables the next year's `budget_lead_days` before the year ends (the generated town: 73, which is a rejected budget tabled once more after 45 days, the ballot's 14, and a fortnight for the offices' own rounds), the clerk puts it to the council, and the budget adopted says which year it is for. A seat does the same on the council proposal form, which has a `year` field (left out: the year in which the council adopts it). Seen in a 400-day code town: tabled on day 293, adopted on day 307.
- **While a year has no budget** (the council rejected it, or nobody proposed one), the charter's interim rule holds: the finance office may go on paying what the town is already bound to pay, at no more each month than a twelfth of the budget last adopted; nothing new is undertaken; the year's budget, once adopted, covers the whole year, what was paid in the meantime included. This is what the nine profiles' places have in common, in the form several of them use (a twelfth a month); no place's own rule is stated yet (references, as above: nearly all of it **to confirm**). The works and environment offices keep the staff they have and hire nobody; the code mayor commissions nothing.
- **`lean-council`** (docs/scenarios.md) changes the town's money and not its budget: the same lines, a hundredth of the opening balance.

**Leaves out:** a revenue side the council votes (the rate is the rating law's, set at the start); a budget revised in the year; lines the finance office holds each payment to (it checks the total); the charter's "already bound to pay" as something the code finance office tests (it applies the twelfth and pays invoices as they come: in a code town nothing new is commissioned without the year's budget, so the two agree; a model mayor who commissions in the interim would be paid within the twelfth).

## `city.mayor_code`: the all-code control

A rule-following mayor. In AI experiments an LLM takes this seat instead (M2), and this module is the baseline it's compared against.
- **Budget** (0.12.0; "The budget year" above): it tables the next year's budget `budget_lead_days` before the year ends, and at once for a year that has none adopted (`data.enact` = a `budget` statement with the year and `lines`: `parks`, and since C4b `staff`, the works crew's wages, and `services`, the landfill's charges; [services.md](services.md)). Its words give each line as the town writes its money (until 0.12.0, as a count of the smallest unit). If the council hasn't adopted one within 45 days, it tables it again. It builds by the budget of the year it is in.
- **A park a year:** when the current year's adopted budget can pay for one and the town's asset register shows a lot of the town's with nothing on it (the first by its number), it sends someone to see the lot (0.11.0: see "What the mayor knows of the town") and, the lot seen free, applies for planning permission. Once that is granted, it proposes and signs a construction agreement with the builder at 1.2× materials cost.
- **Roads** (0.8.0; daily-round.md): with a `roads` line in the adopted budget, when a building it knows of (0.11.0: the town's own, and those it has had notice of being built) stands more than `road_within` cells (3) from any of the town's roads, it applies for a permit for a road on the town's free lot beside the network that comes nearest that building, and commissions the builder once granted: one road at a time, as many a year as the line pays for.
- **Approvals:** it writes an `approval` for each invoice for work it commissioned. The payments procedure needs one over $50,000.
- **Elections** (docs/behaviour/elections.md): given notice of an election for its office, while nominations are open, it stands as the incumbent, on its record (its nomination lodged with the electoral body, `electoral`).
- **The office's record:** what it has acted on (a permit decision, an invoice, a petition) and when it last applied for a park, it reads from the office's records, whoever made them. So whoever takes the office, elected or appointed, carries on from where the office left off. (Until 2026-10-01 it kept these in memory: a newly elected mayor commissioned again a park already built.)
- **Petitions:** once a petition's organiser's published count (`petition_count`) reaches `petition_threshold_bps` of the population, it turns the petition into a proposal carrying the petition's demand, with probability `responsiveness_bps`.
  - A demand may name a law's schedule and the figures it wants (`demand.amend`: `{ schedule, figures }`, the figures as a law holds them). Where the town has a form to amend that law, the mayor answers on that form (0.10.0), so what passes is a law acts can be checked against where the schedule has a rule. It answers the organiser publicly (`petition_response`): what was put, and that the rest wasn't; or, if the law in force already says what's asked, that. The answer is a field of the form (`answer`, required, in full): the paper's text is "Answer to petition rec.X: <the answer>" and the answer is again `data.answer`, so a seat's answer says what it says and the draft it confirms shows all of it (the fourth living pilot's mayor answered on a form with no field for the words, and every answer went out as "Answer to petition rec.X."). The code mayor writes the same paper.
  - The citizens' tenancy petition (citizen.md) asks for 90 days' notice to end a tenancy and a 5% cap on rent rises. The notice is a figure of the law on ending a tenancy, so it goes on that law's form. The cap is in no law's figures, so it isn't put: no schedule covers a cap yet.
  - A demand that names no schedule goes to the council in its own words, as before (`data.enact`, with whatever breakdown and rule the demand carries).

Params: `responsiveness_bps` 7000, `petition_threshold_bps` 1500, `population` 200, `park_budget` (a placeholder; the generated town gives the profile's), `builder`, `park_type`, `road_budget` (none), `road_type`, `road_within` 3, `budget_lead_days` 0 (at the year's start).

**What the mayor knows of the town (0.11.0, generator 0.32.0; docs/design/knowing.md).** Until 0.11.0 the mayor's office was shown a survey of every cell of the town each month, and (because the town issued every title) the whole land register and every elector's enrolment among the town's papers. Nobody is shown a town (docs/no-god-view.md). It now has:
- **the town's own land, on paper** (`ownLand`: docs/behaviour/ownership.md): the titles the town holds, its asset register, and the notices of building work the town is given. Where each lot is, its plan in the asset register says (a cell's id is its address);
- **going to look** (`visits`: a channel that shows nothing until a look names the ground): before it applies to build on a lot it sends someone to see it, which takes the office's time (the way there and back, and the world's time at a place). The sight is good for `sight_days` (30). Its plan asks for the sight at one wake, the going sets out at the next (a week on: its cadence), and the application follows when they are back. A lot the papers showed free and the visit shows built on is set aside;
- **nothing of buildings that are not the town's** but what it has had notice of. At the start every building in the generated towns stands within three cells of a road (checked: none of 114, none of 582), so the roads rule begins where it did; a building put up without notice to the town would draw no road.

A model in the office has the same: the town's files (searched), the asset register among them, "go and see" (it names the buildings or the cells; what was found comes with the report after its staff are back), who's who looked up by name, and the land register asked about one lot. What it can no longer do is read the town off a survey: it can write to the planning office for the town's vacant lots, to the works office for the state of the town's assets, and go and look.

**Found in M1c:** the first version commissioned parks without a permit, and the inspector fined the town. That was correct behaviour from the inspector; the mayor module was wrong, since a rule-following mayor applies like anyone else.

## `city.council_clerk`

It wakes daily.
- It counts only the council's ballots (`electorate: "council"`), not the town's elections.
- It puts each proposal addressed to the town to a council ballot, open for `vote_days` (14).
- At close, it counts the latest vote of each **councillor seat**, so votes from anyone else don't count. Its council's members are the holders of the town's councillor posts, which it looks up (0.7.0: at its first wake and every `members_every_days`, 30, as a council keeps its own list of members; nobody is shown who's who, and until 0.7.0 the clerk read them off a directory of every entity and post in the town). Only votes made before the closing time count (0.6.1: until then a vote made after the close was counted if it reached the clerk before its daily count).
- A proposal passes with more yes than no *and* a majority of all councillors (so abstentions count against).
- It publishes the `ballot_result`. If the proposal passed, it publishes the law or budget itself, with the ballot as its basis. A budget is for the year its proposal names, if that is this year or one to come; else for the year in which it is adopted.
- It takes up its office's papers (0.9.0): a proposal a ballot already stands for is not balloted again, and a ballot whose result is on file is not counted again. So the budget a town opens with is left as it is, and so is whatever a clerk before it had done.
- It drafts: a proposal on a law's amendment form that passes is written into law by the law's schedule (next section).
- It seats whoever the electoral body declares elected to an office of the town (0.8.0, `electoral`; docs/behaviour/elections.md, "A body of its own"): the commission declares, the town fills its own office.
- **A closed ballot, and whose a vote is (0.10.0, 2026-10-09).** A ballot is closed once its closing time has passed or its result is declared; the ballot a town opens with says so itself (`data.closed`, with its result, and in its words: "held and closed before the year began (result budget-year-1-result: passed, 5 for, 0 against)"). Nothing stops anyone writing a vote on any ballot at any time (a vote is a record, and the kernel judges none). **It is the clerk, who keeps the ballot, that refuses it**: a vote cast on a closed ballot, or by anyone not in a councillor's post, is not counted, and the clerk writes to whoever cast it, once: "From the council clerk: your vote on budget-year-1-ballot is not counted. That ballot was held and closed before the year began. Its result is declared (budget-year-1-result: passed, 5 for, 0 against). A vote counts only when it is cast in a councillor's post while the ballot is open." (or "That ballot closed on year 1, day 16."; or, to someone who is no councillor, "The council's ballots are voted on by its councillors, each in their own post.").
- **The council's votes are public record; the election of persons is secret.** A result names its count and who voted which way: "Passed: 3 for, 1 against. ... Voting for: councillor-1, councillor-2, councillor-4; against: councillor-3; not voting: councillor-5." (`data.voted_for`, `data.voted_against`: the posts). The clerk's form for a result has the two lists. A vote paper itself carries the post it was cast in (`in_position`), as it always did. The one secret ballot in this world is an election's (docs/behaviour/elections.md): a vote there is seen by the electoral body alone, its result gives counts and never names, and that is unchanged.
- It answers letters with its report: open ballots, recent results (each with who voted which way), whether a budget is adopted for the year, the council proposal form, and the laws that are amended on their own forms, each with its figures as they stand. It reads its own results, budgets and laws from its records channel. Before pilot 6 that channel held only proposals and ballots, so its report said "no budget is adopted" after the council had adopted one.

**Source:** ordinary council procedure (motion, vote, minute, enactment). Quorum, and amendment of a motion on the floor, are left out.

## Laws made from figures: schedules, amendment forms, and the clerk as drafter (clerk 0.6.0)

**Why.** Everyone run by code is bound by a law only through its rule (its `formal` condition: `breaches`, participants/src/behaviour/common.ts). A law the council passed on the council proposal form was words alone, so it passed and changed nothing, and nothing told the proposer (docs/design/ai-citizens.md 2e). In a real town the lawmaker doesn't write provisions: a drafting office does, and most of what's asked for is a change to a figure in a law that exists.

**A schedule** (a record of kind `law_schedule`, the town's; the examples are in `worlds/law/schedules.json`) says how one law is written from its figures:
- `figures`: each with a `type` (`duration` or `count`, the form field types), a `unit` it's worded in (days, months, percent), and for a count held in another unit, `held_in` and `per_unit` (a share: worded in percent, held in basis points, 100 to one). A duration is held in seconds.
- `text`, `adico` and, where acts can be checked against the law, `formal`: the law's words, its Institutional Grammar breakdown and its rule, with `{figure}` for the figure as worded ("60 days", "50") and `{figure:unit}` for the number as held (`{notice:seconds}`).
- A figure may be `optional` (2026-10-09; every figure of the three example schedules is): a place that has no such requirement states none, and the law says nothing of it. The clauses that turn on optional figures are written as a list, `<<separator;;clause;;clause>>`: a clause is kept where every figure it names is given, and the kept ones are joined by the separator (a space between sentences; `, or ` in a breakdown; ` || ` in a rule). An optional figure given as nought is not given: a requirement of nothing is none, so a council takes a requirement out of a law by amending it to nought, and adds one the law lacks by giving it. With none of its figures there is no law to write. No law states a duration in seconds (days, hours or minutes where whole, else the schedule's unit as a decimal).
- `title` ("the law on rent increases") and `form` (the name of its amendment form).

A law written from a schedule carries its figures openly: `data.schedule`, and `data.figures`, each `{ value, unit }` as held (`notice: { value: 5184000, unit: "seconds" }`). The generator writes the town's opening laws this way from the profile's figures (`rentIncreaseLaw`, `industrialActionLaw`), and a test holds every such law to what its schedule writes.

| Schedule | Law at the start | Figures | Rule |
|---|---|---|---|
| `schedule-rent-increases` | `law-rent-increases` | `review` (least time between increases), `notice` | on a notice of rent increase; landlords, tenants and the tribunal check against it |
| `schedule-industrial-action` | `law-industrial-action` | `turnout`, `majority` (percent), `notice`: whichever the place requires | on a notice of industrial action; the union checks against it |
| `schedule-tenancy` | `law-tenancy` (written from the profile's notices since 2026-10-09; until then the example code's own words) | `notice` (the landlord's, to end a tenancy), `tenant_notice` | none: nobody's acts are checked against it yet, and the clerk says so |

These laws speak for the town (the first two spoke for the world outside until 2026-10-05): a council amends its own laws, and only the one a law speaks for can withdraw it.

**The amendment form** (`form-amend-...`, one for each schedule, written from the schedule by the generator's `amendmentForm`): the law's figures as fields of the schedule's types, each optional (an amendment changes the figures given and keeps the rest), and `affects`, as on the council proposal form (the councillors place the proposal by it).

**What the clerk does with a proposal on one:**
- It opens a ballot worded as what would change: "to amend the law on rent increases (law-rent-increases): notice of an increase 75 days (now 60 days)". A proposal that names no figure isn't put, and the proposer is told which figures there are.
- If it passes, the clerk writes the law by the schedule from the figures of the law in force then, with those given in their place; publishes it, citing the ballot and naming the law it replaces (in its words, and `data.replaces`); and withdraws the old one. The result says what was amended ("notice of an increase 75 days (was 60 days)").
- If the law has been withdrawn in the meantime, an amendment must give every figure; otherwise the result says nothing is enacted, and what's missing.
- If it fails, nothing changes.

**A law in free words** (the council proposal form, or a proposal carrying its own words) still goes to a ballot and, passed, stands as words. The result says so: "The law is recorded as worded. No rule was set down with it for acts to be checked against. Laws made from figures are amended on their own forms: ...". The council proposal form's own text and the clerk's report say the same. The code mayor's proposals that carry a rule (`data.enact` with `formal`) are enacted with it, as before.

**How readers follow.** A participant's book of laws is shown laws, not what's taken down. So a reader (`Book`) takes a law that names an earlier law of the same lawmaker as the one it replaces in that law's place, from when it was made; and an act is judged by the laws as they stood when it was made (`breaches(..., now)`: the tribunal judges a notice by the law in force when it was given).

**The clerk knows no law by name.** It reads schedules and forms from its records; a fourth schedule needs a record and a form, and no change to the clerk (its tests use a law that exists in no world).

**Source:** legislation is drafted by a drafting office from instructions, and figures expected to change are kept where they can be changed without redrafting (docs/research/references.md, "Laws and claims"; to confirm).

**Leaves out:** a law of a new kind that binds (a cap on rent rises, a ban on evictions in winter): that needs every code participant to check every act against the laws it knows, and a way to state a rule without knowing a notice's field names (ai-citizens.md 2e). Repeal by itself reaching readers of laws (below). Commencement dates: an amended law is in force when published. Transitional provisions.

## Offices and the laws they apply (2026-10-05)

Some offices apply a rule they were given by its id or as a parameter, not by reading the laws in force. Each now stops when that record is withdrawn with nothing in its place, and follows a replacement that names it:
- **The planning officer** (0.8.2) applies the habitat law (`habitat_law`) only while it stands.
- **The rates officer** (0.2.1) levies under the rating law (`law`) only while it stands, and its report says when it doesn't.
- **The tax clerk** (0.4.2) assesses and penalises under the tax law only while it stands.
- **The finance officer** (0.8.3) applies the approval rule only while the payments procedure it's given (`procedure`) stands. Paying within the adopted budget, and the interim rule, are the charter's, and stay.

**Still not read from the law in force:**
- the finance officer's limit (`approval_over`) is a parameter, and the procedure's words say $50,000 without carrying the figure;
- the rates officer and the tax clerk read their rates from the law's `data` (a replacement written by a schedule would need to carry them the same way: no schedule covers rates yet);
- the habitat law has no rule: the planning officer applies it from the habitat register, by its id;
- landlords' own practice (how often they review, the notice they give) and the union's are parameters, bounded by the law as they read it;
- a law withdrawn without a replacement is known to be withdrawn only by those whose records show them withdrawals (the town's own offices do; landlords, tenants, the union and the tribunal are shown laws only).

## `city.councillor`

Spatial voting on one axis, from pro-development (−100) to pro-tenant (+100) (Downs 1957; Enelow & Hinich 1984).
- A proposal's position comes from its tags: `tenant_protection` is +60 and `development` is −60.
- A councillor votes yes when the proposal is closer to their ideal point than the status quo (0) is.
  - A tie is no (a councillor at +30 is as far from a tenant-protection proposal at +60 as from the status quo).
  - A proposal with neither tag (or both) sits at 0, where the status quo is, so no councillor finds it closer: all five vote no, and only the noise can pass it (three flips of five: under 3%). An amendment marked `neither`, or a law in free words about anything else, so almost never passes a code council. Pinned by a test (2026-10-06) and left for a decision: what a councillor does with a proposal off its axis needs a basis.
- With probability `noise_bps` (1500), the vote flips. This stands in for everything the one-dimensional model leaves out.
- Budgets pass on a base propensity `budget_yes_bps` (9000).

The generator seats five councillors at −80, −40, 0, 40 and 80. That makes tenant-protection proposals a coin-flip-ish affair: the two pro-tenant councillors plus noise. The council's composition is an experimental variable.

- **A motion of their own** (0.6.0, 2026-10-09): a councillor given one by the town's description (`motion`: what is proposed, its `kind`, whom it `affects`, and `on_day`; none by default) puts it to the council once, on the council proposal form, as the standing orders let any councillor. Only a councillor with the form on file can (a post a model holds has; the code's post is shown ballots only), so it is how a council of mock seats is given business: nothing in a generated town sets one.

## The council's standing orders (`proc-council`, 2026-10-09)

The charter says who may propose ("on proposals from the mayor or any councillor") and that the council decides by majority. How its business is done was nowhere on file: a model clerk told a councillor it had "found no rule on file that says who may make a proposal", and five model councillors, shown one closed ballot and nothing else, did nothing for 45 days. A real council has standing orders. The town's are a published procedure under the charter (law data: a record, not code), in seven orders that say what the clerk's office does and no more:

1. the mayor or any councillor may put a proposal of their own motion, with no seconder and no notice beyond filing it;
2. on the council proposal form, or a law's amendment form for a figure in a law in force, filed with the clerk by being handed in;
3. the clerk puts every proposal so filed to a ballot of the councillors, open for 14 days from when the clerk opens it;
4. each councillor votes yes or no in their own post while it is open, the latest vote counts, the mayor has no vote, and a vote after the close or by anyone else is not counted;
5. it passes if more vote yes than no and the yes votes are more than half of all the councillors;
6. at the close the clerk counts and declares the result in public, naming who voted for, who against and who did not vote, and publishes what passed;
7. a petition lodged with the council lies on its table; the council is not bound to act on one, and the mayor or any councillor may take it up by a proposal.

Real councils differ in the detail (a seconder, days of notice before a meeting, a show of hands); this one meets on paper, so a motion is on notice from the day it is filed and the ballot's fourteen days are its debate. The code clerk ballots a proposal on the form from whoever files it; the orders say who may put one, which is for whoever holds the clerk's post to hold to.

**What a council seat has on its desk when a person (a model) holds it** (generator 0.45.0; the code in these posts is given none of it, and reads only what it acts on):

| Post | On file (standing) | Comes to it |
|---|---|---|
| a councillor | the charter, the standing orders and procedures, the town's laws; the forms (the council proposal form, each law's amendment form) | proposals put to the council and its ballots, as papers of its own body (one filed brings the seat back to its desk at the next working day's sitting); petitions lodged, their counts and answers, budgets adopted, results declared; its files and who's who on request |
| the clerk | the charter and the standing orders; its own stationery (ballot, result, law, budget) | as before (the council's business, proposals, votes), and petitions, budgets and results |

Nothing here tells a seat to act: it is what the office can do, on paper it would have.

## `city.finance_officer` (0.9.0)

**Payroll (C4b):** the finance officer also runs the town's payroll: wages for the crew the works office hires, net of the income tax withheld, which it pays over monthly ([services.md](services.md), [public-finance.md](public-finance.md)). Wages count against the adopted budget with the invoices it pays. Since 0.10.0 it sets a new starter's wage up on the hiring office's **payroll notice**, from the first pay day the notice gives; with no notice after `payroll_wait_days` (3) it sets it up from the agreement on file ([firms.md](firms.md), "Payroll notices").

**Asking for an approval (0.10.0).** An invoice within the budget and over the procedure's figure waits for the mayor's written approval. Until 0.10.0 the office waited in silence: the code mayor approves only invoices for work it commissioned, so the landfill's invoice, once over the figure, would never be paid, and a mayor seat was never told a payment was waiting on it. The office now writes to the mayor's post, once for each such invoice: "From the finance office: your written approval is needed for invoice rec.812 ($120,000.00, payable to acc-builder): it is within the budget and over $50,000.00, and the payments procedure asks for the mayor's approval of such a payment. It will be paid once an approval of it is on the town's file."

It wakes every 3 days and, for each invoice addressed to the town, pays through the bank (it is the named signatory) when the payments procedure allows:
- within the total of the budget adopted for the year it is in (0.9.0: until then, the latest budget adopted, whatever its year); while the year has none, within a twelfth of the budget last adopted for each month of the year begun ("The budget year"). Spending is reckoned by the year, wages with it, so what is paid in the interim counts against the year's budget once adopted;
- and, if the invoice is over `approval_over` ($50,000), only with the mayor's written approval.

Otherwise it waits: an approval, the next month's twelfth or the year's budget may come. With probability `1 − compliance_bps` it pays anyway. The approval rule is the payments procedure's (`procedure`, the record's id): once that record is withdrawn, the rule goes with it (0.8.3).

It answers letters with its report: the balance, money in and out, the adopted budget and what's been spent under it, unpaid invoices, and the **budget brief**. The brief lists the budget's lines and what each one pays for (`budget_lines`, from world config), and says that the amounts are for the mayor and the council. The generated town has one line, parks, priced at the builder's rate. Without the brief, a language-model mayor asked for cost estimates day after day and never tabled a budget (pilot 3, docs/real-models.md). It had no way to learn what a budget in this town could fund, and a real finance office would tell it.

**Source:** delegated spending limits and budget control, as in real local-government finance.

## `city.tax_clerk` (not in the generated town since C4a: rates replaced the rent tax; [public-finance.md](public-finance.md))

It wakes weekly.
- For each `tax_report` addressed to the town, it records the tax owed as a claim at `law-tax`'s `rate_bps`.
- It tracks money arriving in the town's account from each reporter's account, applied to their assessments oldest first.
- For an assessment still unpaid after `grace_days` (45), it records the law's penalty (`penalty_bps`) and sends a demand.

It works only from what is reported, so under-reporting is invisible to it. Audits would need information it doesn't have, and would be a later module.

**Found in M1c:** the first version compared the total assessed, including a report that had only just arrived, with the payments seen so far. The payment for a fresh report settles when the bank next acts, so paid-up landlords were penalised.

## What the other modules do (see their docs)

- **Citizens** ([citizen.md](citizen.md)) start petitions when aggrieved and sign by Granovetter thresholds against the organiser's published count. Signatures are private to signer and organiser. Nobody verifies the count, so an organiser who lies is a possible later module.
- **Landlords** ([firms.md](firms.md)) report rent monthly and pay the tax, under-reporting by half when they don't comply. They pay tax penalties like fines.
- **The bank** ([bank-payment-system.md](bank-payment-system.md)) applies the signatories list.

## Observed in 2-year runs (200 citizens, three seeds)

- Budgets pass every year. One seed's council rejected a year-2 budget, and the mayor tabled it again.
- The parks are built and paid for through the full chain.
- About $250,000–330,000 reaches the town's account over two years (mostly tax, plus the occasional fine). That's near what half-honest reporting at 10% predicts. No penalties were assessed after the fix.
- The first petition gathers ~180 of 200 signatures, and later ones either cascade (~150) or fizzle (2–15).
- The tenant-protection law passed in 1 of 3 seeds.

**For the checkpoint:**
- Landlords read the law on rent increases (its rule) and an amendment of it changes what they do (above). The law on ending a tenancy still has no rule, so amending it changes no one's behaviour: the petition's 90 days passes as a figure nobody checks an act against, and the clerk says so.
- Citizens don't know when a law they petitioned for already exists, so they petition again.
- Petition cascades are near-total at the current thresholds, which need calibration.

## Leaves out

- Electing councillors (they're fixed; the mayor is elected: elections.md).
- Committees.
- Amendments to a motion on the floor (amending a law in force is in: above).
- Appeals.
- Tax audits.
- Spending lines other than parks.
- Public consultation.
- The work time all of this takes (D24).

## A council in the hands of seats: the count, a member's own vote, and a passed amendment (2026-10-09)

**Source:** `participants/src/behaviour/tally.ts` (`Tally`), `orchestrator/src/run.ts` (set out with a seat's roster),
the generator's `ballot_count` on the council's desks, `city.council_clerk` 0.11.0 (`part`, the routine `enact`,
`enactAmendment`). Test: `orchestrator/test/council-machinery.test.ts`. Decision: docs/decisions.md, "A council's
machinery in the hands of seats".

- **The whole count, set out for whoever keeps the ballots.** A code clerk counts from its own book. A person in the
  clerk's seat is shown papers as they come, so each vote reached it once, in the sitting after it was cast. It now
  reads, at every sitting where it has changed, the count of each ballot of the council with no result declared, from
  every vote on file: the latest vote of each post cast while the ballot was open, who voted which way, and what was
  not counted (a post's earlier votes, votes at or after the close, votes in no post). These are the council's own
  papers, which the clerk keeps: nothing is asked of anyone.
- **A member reads its own vote on file** ("your vote on file is "yes" (rec.2824, cast year 1, day 10)"), on each
  ballot not yet declared. A councillor's desk has the council's votes (a council's votes are its own record, and
  public).
- **A passed amendment is put in force by the office's drafters.** Writing an amended law out from its schedule is
  drafting, which the code clerk does in the step that declares the result. Where a seat holds the office the
  drafters are the office's staff (docs/behaviour/standing-work.md): under the standing work order for `enact`
  (daily by the office's procedure; an order that says nothing of how often follows that), each amendment the council
  has passed and the clerk has declared is written into the law by its schedule, published in place of the law in
  force, which is withdrawn, once; and they report it. The clerk's result form says that declaring a result does not
  by itself change a law. A law proposed in free words, and a budget, are the clerk's own to publish, as before.

**Real-world basis.** A returning officer or clerk counts from the ballot papers in hand, not from memory; division
lists record how each member voted; an amended act is engrossed by the clerk's or the drafting office after the vote.
**(to confirm: common practice; no source opened.)**

**Leaves out.** The count is of the council's ballots only (an election's count is the electoral office's). A search
of the votes by what they cite still finds nothing, since a vote names its ballot and cites nothing: the count is
where to read them. Who has not voted is not listed (the seat knows its council's members from who's who, not from
the votes).

## Payments carry their budget line (finance 0.10.2, 2026-10-12)

**The fault.** The finance office's books gave the year's budget in total only: "no payment is marked with a line of the budget". A payment said what it was for in words (the bank statement's memo) and nothing the code could read said which line of the adopted budget it was drawn on, so a finance seat could not see that the parks line was spent and the roads line was not (docs/decisions.md, "The fourth living pilot found", item 9: "spent by line").

**What it is now.** A payment may name the line of the payer's adopted budget it is drawn on: `money(..., line=parks)`. The line is a label the payer gives, carried on the payment and on the transaction both sides' statements show (`Transaction.line`), and on a standing payment's request and each payment made under it. The kernel reads nothing into it, checks nothing against any budget, and **a payment with no line is not refused**.
- **Wages:** the payroll notice already names the line a post is on; the standing payment of the wage set up from it carries that line (the staff line for the works crew, environment for the environment office). The town's crew the year opens with are on the staff line, in the orders it opens with.
- **Invoices:** the office's brief says which line pays for what: an invoice for a building the town commissioned is on that building's line (a park on `parks`, a road on `roads`: the builder's invoice says the kind of building it is for), the landfill's invoice on `services`. The generator gives the finance office that brief (`lines_by_structure`, `lines_by_position`). An invoice the brief does not place is paid with no line.
- **The books** (office-books.md): the budget's item says, for each line of the adopted budget, what has been drawn on it and what is left; what no line was named for as **unallocated**; and any line the payments name that the budget does not have ("not a line of the budget"). The code office's own check is still the budget in total (as the charter has it); the lines are what a seat reads.
- **A seat paying an invoice** says the line in the payment (`money(..., settles=<invoice>, line=parks)`).

**Revisit if** the council's lines should bind (a payment over its line held for the council's word): that is a rule of the town's, not of the books. If lines are redrawn in the year (a budget amended), payments keep the label they were made with.

## One bill, two papers (rates, 2026-10-13)

**What a real rates office does.** It sends an owner a notice and enters the sum in its ledger against them: two papers for one debt. The owner pays the bill, whichever paper they have in front of them; the ledger is credited and the notice is marked paid. Nobody owes it twice for paying "the notice" rather than "the ledger entry".

**What the town did.** The rates officer writes, for each owner and instalment, a `rates_notice` letter to the owner and a `claim` (the city's right against them, kind `rates`) in one step, with the same sum and due day. The office had learned (2026-10-11, wave 2c) that a payment naming the notice settles the claim, so it charged no interest and sent no reminder. A landlord's books (`owedByUs`, "Sums recorded against us (rates, fines), not paid") did not: they listed claims only and counted one settled only if a payment named the claim. In the sixth living pilot (lv-06) the landlord seat paid rec.19352, the notice, on day 32 (KSh 2,977.86), saw rec.19353, the claim, still listed as unpaid, and paid it on day 74: **the same sum twice, 5,955.72 from its account to the city's for one bill of 2,977.86.** Nothing refused the second; the city took it.

**Not the cause, looked for:** a reminder issued as a fresh notice (the rates office sends none; it adds penalty interest as a claim of its own kind), an opening-caseload paper (both records were made on day 31 by the live levy), the books double-listing one record (they listed one, the claim; it was the settlement that was missed).

**The rule now** (`noticesOf`, `billSettled` in `participants/src/behaviour/common.ts`): the notices that go with a rates claim are those to the same owner with the same due day and sum; a bill is settled when a payment names the claim or any of its notices. The rates office's own `paid()` and the landlord's books use the one reading. The books line for a rates claim names the notice that came with it ("one bill: the city's notice for it is rec.N, and paying either settles it"), so a seat sees one bill on two papers. Fines, tax penalty and interest have no notice and are as before.

**What does not change.** A bank pays what it is instructed; a second payment of a bill that is settled is still possible (a seat that does not read its books), and the city takes it: a real office would credit it against the next bill, which the town does not model. The code landlord paid the claim and never twice.

**Seen by seats:** the "Sums recorded against us" book line for a rates claim gains the parenthesis above. No form, no standing instruction and nothing of the translator's prompt changes.

Tests: `participants/test/rates-one-bill.test.ts` (4: listed once with its notice named; paying either paper settles it; only its own instalment and sum; a fine is settled only by naming it); `orchestrator/test/government.test.ts` (a run: no rates bill is paid more than once, whichever paper is named).

**Revisit if** a payment of a settled bill should be turned away or credited by the rates office; or a notice should name its claim (a field on the paper) in place of matching by owner, due day and sum.

