# The town's government (code mayor v0.10.0, clerk v0.6.1)

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
- `signatories-city` tells the bank that only the `finance` seat may instruct payments from `acc-city`;
- `proc-payments` is the payments procedure: within the adopted budget, and over $50,000 only with the mayor's written approval;
- `law-rates` sets the rate in the dollar of value, the instalments and the penalty interest (docs/behaviour/public-finance.md). The generated town no longer has the rent tax (`law-tax`), which had no source;
- the law schedules (`schedule-...`, kind `law_schedule`) and a form to amend each one's law (`form-amend-...`): see "Laws made from figures" below.

## `city.mayor_code`: the all-code control

A rule-following mayor. In AI experiments an LLM takes this seat instead (M2), and this module is the baseline it's compared against.
- **Budget:** each year without an adopted budget (at the year's start, or on taking office), it proposes one (`data.enact` = a `budget` statement with `lines`: `parks`, and since C4b `staff`, the works crew's wages, and `services`, the landfill's charges; [services.md](services.md)). If the council hasn't adopted one within 45 days, it tables it again.
- **A park a year:** when the current year's adopted budget can pay for one and the town owns a free parcel, it applies for planning permission. Once that is granted, it proposes and signs a construction agreement with the builder at 1.2× materials cost.
- **Roads** (0.8.0; daily-round.md): with a `roads` line in the adopted budget, when a building stands more than `road_within` cells (3) from any road, it applies for a permit for a road on the town's free lot beside the network that comes nearest that building, and commissions the builder once granted: one road at a time, as many a year as the line pays for.
- **Approvals:** it writes an `approval` for each invoice for work it commissioned. The payments procedure needs one over $50,000.
- **Elections** (docs/behaviour/elections.md): given notice of an election for its office, while nominations are open, it stands as the incumbent, on its record.
- **The office's record:** what it has acted on (a permit decision, an invoice, a petition) and when it last applied for a park, it reads from the office's records, whoever made them. So whoever takes the office, elected or appointed, carries on from where the office left off. (Until 2026-10-01 it kept these in memory: a newly elected mayor commissioned again a park already built.)
- **Petitions:** once a petition's organiser's published count (`petition_count`) reaches `petition_threshold_bps` of the population, it turns the petition into a proposal carrying the petition's demand, with probability `responsiveness_bps`.
  - A demand may name a law's schedule and the figures it wants (`demand.amend`: `{ schedule, figures }`, the figures as a law holds them). Where the town has a form to amend that law, the mayor answers on that form (0.10.0), so what passes is a law acts can be checked against where the schedule has a rule. It answers the organiser publicly (`petition_response`): what was put, and that the rest wasn't; or, if the law in force already says what's asked, that.
  - The citizens' tenancy petition (citizen.md) asks for 90 days' notice to end a tenancy and a 5% cap on rent rises. The notice is a figure of the law on ending a tenancy, so it goes on that law's form. The cap is in no law's figures, so it isn't put: no schedule covers a cap yet.
  - A demand that names no schedule goes to the council in its own words, as before (`data.enact`, with whatever breakdown and rule the demand carries).

Params: `responsiveness_bps` 7000, `petition_threshold_bps` 1500, `population` 200, `park_budget` $80,000, `builder`, `park_type`, `road_budget` (none), `road_type`, `road_within` 3.

**Found in M1c:** the first version commissioned parks without a permit, and the inspector fined the town. That was correct behaviour from the inspector; the mayor module was wrong, since a rule-following mayor applies like anyone else.

## `city.council_clerk`

It wakes daily.
- It counts only the council's ballots (`electorate: "council"`), not the town's elections.
- It puts each proposal addressed to the town to a council ballot, open for `vote_days` (14).
- At close, it counts the latest vote of each **councillor seat**, so votes from anyone else don't count. Its council's members are the holders of the town's councillor posts, which it looks up (0.7.0: at its first wake and every `members_every_days`, 30, as a council keeps its own list of members; nobody is shown who's who, and until 0.7.0 the clerk read them off a directory of every entity and post in the town). Only votes made before the closing time count (0.6.1: until then a vote made after the close was counted if it reached the clerk before its daily count).
- A proposal passes with more yes than no *and* a majority of all councillors (so abstentions count against).
- It publishes the `ballot_result`. If the proposal passed, it publishes the law or budget itself, with the ballot as its basis.
- It drafts: a proposal on a law's amendment form that passes is written into law by the law's schedule (next section).
- It answers letters with its report: open ballots, recent results, whether a budget is adopted for the year, the council proposal form, and the laws that are amended on their own forms, each with its figures as they stand. It reads its own results, budgets and laws from its records channel. Before pilot 6 that channel held only proposals and ballots, so its report said "no budget is adopted" after the council had adopted one.

**Source:** ordinary council procedure (motion, vote, minute, enactment). Quorum, and amendment of a motion on the floor, are left out.

## Laws made from figures: schedules, amendment forms, and the clerk as drafter (clerk 0.6.0)

**Why.** Everyone run by code is bound by a law only through its rule (its `formal` condition: `breaches`, participants/src/behaviour/common.ts). A law the council passed on the council proposal form was words alone, so it passed and changed nothing, and nothing told the proposer (docs/design/ai-citizens.md 2e). In a real town the lawmaker doesn't write provisions: a drafting office does, and most of what's asked for is a change to a figure in a law that exists.

**A schedule** (a record of kind `law_schedule`, the town's; the examples are in `worlds/law/schedules.json`) says how one law is written from its figures:
- `figures`: each with a `type` (`duration` or `count`, the form field types), a `unit` it's worded in (days, months, percent), and for a count held in another unit, `held_in` and `per_unit` (a share: worded in percent, held in basis points, 100 to one). A duration is held in seconds.
- `text`, `adico` and, where acts can be checked against the law, `formal`: the law's words, its Institutional Grammar breakdown and its rule, with `{figure}` for the figure as worded ("60 days", "50") and `{figure:unit}` for the number as held (`{notice:seconds}`).
- `title` ("the law on rent increases") and `form` (the name of its amendment form).

A law written from a schedule carries its figures openly: `data.schedule`, and `data.figures`, each `{ value, unit }` as held (`notice: { value: 5184000, unit: "seconds" }`). The generator writes the town's opening laws this way from the profile's figures (`rentIncreaseLaw`, `industrialActionLaw`), and a test holds every such law to what its schedule writes.

| Schedule | Law at the start | Figures | Rule |
|---|---|---|---|
| `schedule-rent-increases` | `law-rent-increases` | `review` (least time between increases), `notice` | on a notice of rent increase; landlords, tenants and the tribunal check against it |
| `schedule-industrial-action` | `law-industrial-action` | `turnout`, `majority` (percent), `notice` | on a notice of industrial action; the union checks against it |
| `schedule-tenancy` | `law-tenancy` | `notice` (the landlord's, to end a tenancy), `tenant_notice` | none: nobody's acts are checked against it yet, and the clerk says so |

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
- **The finance officer** (0.8.3) applies the approval rule only while the payments procedure it's given (`procedure`) stands. Paying within the adopted budget is the charter's, and stays.

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

## `city.finance_officer` (0.8.0)

**Payroll (C4b):** the finance officer also runs the town's payroll: wages for the crew the works office hires, net of the income tax withheld, which it pays over monthly ([services.md](services.md), [public-finance.md](public-finance.md)). Wages count against the adopted budget with the invoices it pays.

It wakes every 3 days and, for each invoice addressed to the town, pays through the bank (it is the named signatory) when the payments procedure allows:
- within the adopted budget's total for the year;
- and, if the invoice is over `approval_over` ($50,000), only with the mayor's written approval.

Otherwise it waits: an approval or next year's budget may come. With probability `1 − compliance_bps` it pays anyway. The approval rule is the payments procedure's (`procedure`, the record's id): once that record is withdrawn, the rule goes with it (0.8.3).

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
