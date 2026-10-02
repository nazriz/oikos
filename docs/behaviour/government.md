# The town's government (code mayor v0.7.0, clerk v0.5.2)

**Source:** `participants/src/behaviour/government.ts`. These are code seats of the town (`entity: city`), plus the mayor's code stand-in. None of this is kernel mechanics (D19, D20). A law exists because a clerk published it after counting a ballot. Money leaves the town's account because the finance officer instructed the bank, and the bank checked its list of signatories. Every step is a person following, or not following, a procedure written as a record.

## How the pieces fit

```
petition (citizens) ─┐
                     ├─> proposal (mayor) ─> ballot (clerk) ─> votes (councillors) ─> result + law/budget (clerk)
annual budget ───────┘
permit application (mayor) ─> decision (planning officer) ─> construction agreement (mayor, builder)
  ─> construct + invoice (builder) ─> approval (mayor) ─> money(...) (finance officer): a payment request ─> transfer (bank)
valuation (valuer, outside) ─> rates notice + claim (rates officer) ─> payment naming the claim (owner) ─> penalty interest monthly if overdue
```

The genesis records that set this up are world content, made by the generator:
- `signatories-city` tells the bank that only the `finance` seat may instruct payments from `acc-city`;
- `proc-payments` is the payments procedure: within the adopted budget, and over $50,000 only with the mayor's written approval;
- `law-rates` sets the rate in the dollar of value, the instalments and the penalty interest (docs/behaviour/public-finance.md). The generated town no longer has the rent tax (`law-tax`), which had no source.

## `city.mayor_code`: the all-code control

A rule-following mayor. In AI experiments an LLM takes this seat instead (M2), and this module is the baseline it's compared against.
- **Budget:** each year without an adopted budget (at the year's start, or on taking office), it proposes one (`data.enact` = a `budget` statement with `lines`: `parks`, and since C4b `staff`, the works crew's wages, and `services`, the landfill's charges; [services.md](services.md)). If the council hasn't adopted one within 45 days, it tables it again.
- **A park a year:** when the current year's adopted budget can pay for one and the town owns a free parcel, it applies for planning permission. Once that is granted, it proposes and signs a construction agreement with the builder at 1.2× materials cost.
- **Roads** (0.8.0; daily-round.md): with a `roads` line in the adopted budget, when a building stands more than `road_within` cells (3) from any road, it applies for a permit for a road on the town's free lot beside the network that comes nearest that building, and commissions the builder once granted: one road at a time, as many a year as the line pays for.
- **Approvals:** it writes an `approval` for each invoice for work it commissioned. The payments procedure needs one over $50,000.
- **Elections** (docs/behaviour/elections.md): given notice of an election for its office, while nominations are open, it stands as the incumbent, on its record.
- **The office's record:** what it has acted on (a permit decision, an invoice, a petition) and when it last applied for a park, it reads from the office's records, whoever made them. So whoever takes the office, elected or appointed, carries on from where the office left off. (Until 2026-10-01 it kept these in memory: a newly elected mayor commissioned again a park already built.)
- **Petitions:** once a petition's organiser's published count (`petition_count`) reaches `petition_threshold_bps` of the population, it turns the petition into a proposal carrying the petition's demand, with probability `responsiveness_bps`.

Params: `responsiveness_bps` 7000, `petition_threshold_bps` 1500, `population` 200, `park_budget` $80,000, `builder`, `park_type`, `road_budget` (none), `road_type`, `road_within` 3.

**Found in M1c:** the first version commissioned parks without a permit, and the inspector fined the town. That was correct behaviour from the inspector; the mayor module was wrong, since a rule-following mayor applies like anyone else.

## `city.council_clerk`

It wakes daily.
- It counts only the council's ballots (`electorate: "council"`), not the town's elections.
- It puts each proposal addressed to the town to a council ballot, open for `vote_days` (14).
- At close, it counts the latest vote of each **councillor seat**, checked against the directory's roles, so votes from anyone else don't count.
- A proposal passes with more yes than no *and* a majority of all councillors (so abstentions count against).
- It publishes the `ballot_result`. If the proposal passed, it publishes the law or budget itself, with the ballot as its basis.
- It answers letters with its report: open ballots, recent results, whether a budget is adopted for the year, and the council proposal form. It reads its own results, budgets and laws from its records channel. Before pilot 6 that channel held only proposals and ballots, so its report said "no budget is adopted" after the council had adopted one.

**Source:** ordinary council procedure (motion, vote, minute, enactment). Quorum and amendment are left out.

## `city.councillor`

Spatial voting on one axis, from pro-development (−100) to pro-tenant (+100) (Downs 1957; Enelow & Hinich 1984).
- A proposal's position comes from its tags: `tenant_protection` is +60 and `development` is −60.
- A councillor votes yes when the proposal is closer to their ideal point than the status quo (0) is.
- With probability `noise_bps` (1500), the vote flips. This stands in for everything the one-dimensional model leaves out.
- Budgets pass on a base propensity `budget_yes_bps` (9000).

The generator seats five councillors at −80, −40, 0, 40 and 80. That makes tenant-protection proposals a coin-flip-ish affair: the two pro-tenant councillors plus noise. The council's composition is an experimental variable.

## `city.finance_officer` (0.8.0)

**Payroll (C4b):** the finance officer also runs the town's payroll: wages for the crew the works office hires, net of the income tax withheld, which it pays over monthly ([services.md](services.md), [public-finance.md](public-finance.md)). Wages count against the adopted budget with the invoices it pays.

It wakes every 3 days and, for each invoice addressed to the town, pays through the bank (it is the named signatory) when the payments procedure allows:
- within the adopted budget's total for the year;
- and, if the invoice is over `approval_over` ($50,000), only with the mayor's written approval.

Otherwise it waits: an approval or next year's budget may come. With probability `1 − compliance_bps` it pays anyway.

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
- No landlord module reads the new tenancy law yet, so it has no effect on anyone's behaviour. That is by design (laws have no power), but it means the M1 town can't yet show a law *mattering*.
- Citizens don't know when a law they petitioned for already exists, so they petition again.
- Petition cascades are near-total at the current thresholds, which need calibration.

## Leaves out

- Electing councillors (they're fixed; the mayor is elected: elections.md).
- Committees.
- Amendments.
- Courts and appeals.
- Tax audits.
- Spending lines other than parks.
- Public consultation.
- The work time all of this takes (D24).
