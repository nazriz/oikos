# Justice: the tribunal (`tribunal.member` v0.4.0, `tribunal.registrar` v0.2.0)

**Source:** `participants/src/behaviour/tribunal.ts`; the parties' side in `citizen.ts`, `firms.ts` (the landlord) and
`bank.ts` (garnishee orders). Design: docs/design/world-expansion.md §5. Figures: the profile's `justice`, with sources.

A law in the world binds nobody by itself: the engine never stops an act for breaking one (no laws in the kernel). A
law is enforced only if someone takes a breach to the tribunal, the tribunal decides, and the parties obey or someone
makes them. Each step is a person's, and each can fail. The tribunal is the state's (in the au-vic profile, a civil and
administrative tribunal on VCAT's model). No contract changes: applications, hearings, orders and enforcement are
records.

## The tribunal

| | Rule | Source |
|---|---|---|
| **Applications** | A party applies (`tribunal_application`) against another, of a kind it hears: a notice of rent increase said to break the law, or a debt unpaid. With it, a copy of the record relied on (the notice, the debt), since the tribunal can't see what passed between the parties. Anything else is rejected. | — |
| **Listing** | Listed for a hearing `hearing_after_days` (21) on, and both sides told (`hearing_notice`). The respondent may answer (`tribunal_response`) before then. | Placeholder (VCAT's times to finalise, to source) |
| **A rent increase** | On the day: the notice (the original if the tribunal can see it, else the copy), tested against the laws in force when it was given, as the landlord gave it (`breaches`, the law reader). Breaching: **invalid**, the rent stays as it was. Not: **valid**, dismissed. Not the respondent's notice to the applicant: dismissed. | The tenancy law's own words: "Or else: the increase is invalid" |
| **A debt** | The debt on the record (the applicant's, against the respondent), less what the respondent says it has paid: an order to **pay** it within `pay_within_days` (28), into the applicant's account. Nothing owed: dismissed. | Placeholder |
| **A charge** (0.2.0) | From the police, with what their investigation found. If it names the respondent: proven, and an order to make good the goods' value to the one they were taken from. | docs/behaviour/crime.md |
| **Enforcement** | A creditor whose order to pay is due and unpaid asks the registrar (`enforcement_request`). The registrar orders the debtor's banks (a `garnishee_order`) to pay what's unpaid from what they hold for the debtor. | Garnishee orders (Judgment Debt Recovery Act 1984 (Vic), to confirm) |

## Lists (tribunal.member 0.3.0; docs/behaviour/frictions.md, "Venues")

In a town where things go wrong the tribunal also hears, on the same forms: a home in disrepair, pay come short, faulty goods, a wrong bill, rent in arrears, and a refused claim for support. It says what it hears in a public notice (an offer to apply, with `hears` and its fee), and hears these by the common procedure of every venue (`Hearings`): the other side is told and has until the hearing to answer; cases are decided oldest first, as many a day as `cases_per_day`; on the other side's own answer where it gives one; in default where it gives none; and where it cannot say from its records, for an applicant who can show a paper for it, or else as often as `uphold_bps` says (failure of proof, never a coin on the truth: a seat in the tribunal decides for itself). It can order payment by a date, order a thing put right, or set a paper aside. An order to pay that rests on no recorded debt is enforced like any other: the registrar's garnishee order settles it against the order itself. A person ordered to pay (rent in arrears) pays if it leaves them the month's essentials. Its three older lists (a rent increase, a debt, a charge) are as they were.

## Possession (2026-10-11; tribunal.member 0.4.0, tribunal.registrar 0.2.0, police.station 0.4.0, firm.landlord 0.16.0, citizen 0.48.0)

**Source:** the landlord's side in `firms.ts` (`possessionLaw`, the `ending` of a tenancy); the hearing in `desk.ts` (`Hearings`, the matter `possession`); the warrant in `tribunal.ts` (the registrar); its carrying out in `police.ts`; the tenant's side in `citizen.ts`. **Figures:** each profile's `tenancy.possession`, with sources; most are marked to confirm or placeholders there.

**What was wrong.** A landlord owed two months' rent gave notice on the lease, the lease ended sixty days on, and the tenant walked out that day, home or no home: about 20 households a year of the 175 renting in the 1,000-person town, with no tribunal, no order and nobody enforcing anything. Most real tenancy applications are landlords' for possession and arrears; this town's tenancy list had under one application a year.

**The law is the world's.** Where a profile states its place's law on possession, and the town has a tribunal and police, it is published in the town (`law-possession`, the state's): the days rent must be owed before a notice to vacate, the notice's length, that paying up ends the notice, that a landlord must not put a tenant out, what the tribunal may order, who carries a warrant out, within how long, and after what notice of the day. Landlords, tenants and the tribunal read it. A world without it is as before: the notice ends the lease and the tenant goes.

| Step | Who, and what they do | What it costs, and how it can fail |
|---|---|---|
| **Arrears** | Arise as they did: a household that cannot cover its rent order misses it, owes it, and pays it when it can (docs/behaviour/citizen.md). Nothing is added to make them. | See "Where arrears come from" below. |
| **Asking** | A landlord with wants of its own (a living town) writes to ask for the rent when its want is born, and a month on may apply for an order to pay (docs/behaviour/frictions.md). Unchanged. | |
| **Notice to vacate** | When the arrears reach what the landlord's practice bears (two months' rent, longer or shorter by its character), and never sooner than the law's days: a `notice_to_vacate` to the tenant, with the sum and a date the law's notice on. It ends nothing. | A tenant who pays the arrears before the date: the notice is withdrawn, and the tenancy goes on. |
| **The tenant, told to go** | Pays what it can, as always. At the date, those who cannot pay go (`1 − stay_past_notice_bps`) or stay (a draw of their own, once: the profile's figure, a **placeholder**). One who goes gives notice on the lease and moves out. | |
| **Application** | The date past, the tenant still there and still behind: the landlord applies to the tribunal for possession (`tribunal_application`, kind `possession`), with the lease, the sum, the home and who lives there by the lease, and the fee where the tribunal has one. | A landlord without the fee waits until it has it. |
| **Hearing** | The tribunal tells the tenant, who may answer with what the household could pay a month toward the arrears beyond its rent (its income less rent and essentials). Heard after the tribunal's time to a hearing, as many cases a day as it decides. | The list's own wait. |
| **Its order** | Arrears paid: dismissed. An offer that clears the arrears within the law's longest plan, not tried and broken before: **a plan** (`finding: plan`): the tenant stays, pays the rent and the instalment. Otherwise **possession on a date** (`finding: possession`), the law's days on; the landlord ends the tenancy on the record. A seat in the tribunal decides for itself. | A plan not kept a month and a week on: the landlord applies again, and the order is possession. |
| **The tenant, ordered out** | Gone by the date (`leave_on_order_bps`: England's 59%, used for every place) or not. | |
| **Warrant** | A day past the date with the tenant still there: the landlord asks the tribunal's registrar for a warrant (`warrant_request`, and the fee). The registrar issues it to the police (`warrant`), naming the home, the tenant and the household, to be carried out no sooner than the law's notice of the day (`eviction_notice_days`) and within the law's days; the tenant sees it. | The notice of the day: a week in Victoria's town (a placeholder), a fortnight in England's. |
| **Carried out** | Once the day has come, an officer with the hours for it (the time an investigation takes) goes on a working day, puts out whoever of the household is there, and tells tenant and landlord (`warrant_executed`). The tenant treats the home as lost from that hour: leaves, takes the children, tells the household. | The station's hours: a warrant waits for a free officer, and investigations wait for the officer who went. One not carried out by its last day lapses (`warrant_lapsed`); the landlord must buy another. |

**Never self-executing.** No paper here moves anyone. A notice to vacate that is ignored does nothing; an order that is ignored does nothing; a warrant nobody has the hours to carry out lapses. A body leaves a home because its person decides to, or because a police officer puts it out.

**Afterwards.** A household out of its home is without one as any other is (docs/behaviour/citizen.md): it looks for another, taking a smaller one as time passes; its adults who did not hold the lease are told and go with it; without a home for long (90 days, by temperament) it leaves town. Its record keeps the eviction (a defining event), and what it thinks of landlords and of the tribunal moves.

**What the world can and cannot show of homelessness.** It can show: a household with no dwelling, for how many days, whether it found another home or left (`town/households` counts the unhoused at the end; the citizen's outcomes say `evicted` and how). It cannot show: where such a person sleeps (their body is in no dwelling; there is no shelter, car or street as a place to be, and nothing bad happens to a body for having no dwelling: no cold, no illness, no loss of a job for it); **staying with family or friends** (nobody moves into another household's home: the household mechanism has no guest; listed below); emergency or social housing, a homelessness service, or a payment for it. So the town understates what losing a home does, and overstates how many leave.

**Where arrears come from, and an opening-day artefact.** Of the tenancies that fall into arrears in a year of the 1,000-person town, most are households that open the year in a home nobody in them earns enough to pay for (pensioners and people out of work placed in homes by size, not by income); the rest follow a job lost, pay come short, or a support claim refused or late. The first group is partly the generator's doing: recorded in docs/decisions.md with its count, not fixed here.

**Measured** (`town/possession`): notices to vacate, lapsed by payment, applications, orders by finding, warrants, carried out, lapsed; each for every 1,000 renting households. Against sources: docs/design/ai-citizens.md, "Progress", and docs/calibration.md.

**Leaves out.** Staying with those one is tied to. An order to pay the arrears with the possession order (the landlord's own application for the money is the other list). Possession for anything but arrears (the end of a fixed term, sale, damage: a landlord's ordinary notice still ends a lease as before). A tenant's defence (the notice was wrong, the home was in disrepair), an adjournment, a hearing the tenant does not attend counted apart. Hardship stays. The bond. A landlord who changes the locks (unlawful, and real). Distress for rent. Costs. A bailiff or sheriff as an office of its own (the police stand for whoever enforces).

## The parties

- **Tenants** (citizen 0.26.0): given a notice of rent increase that breaks the law as they read it, they take it to the
  tribunal with the chance `challenge_bps` (the profile: 20%, a placeholder: few do). Meanwhile they pay the rent as it
  was. Found valid, they pay it from then. Found invalid, nothing changes for them.
- **Creditors** (citizen): a debt owed them (unpaid wages) still unpaid `apply_after_days` (30) on: they apply with the
  chance `apply_bps` (30%, a placeholder). If an order to pay goes unpaid a day past its date, they ask for it to be
  enforced.
- **Landlords** (firm.landlord 0.12.0): told their notice is invalid, they withdraw it as often as they comply with the
  law (`compliance_bps`). A landlord who doesn't keeps expecting the higher rent and, in time, may give notice for
  "arrears". That's unlawful, and real.
- **Firms** pay debts recorded against them as before. A debt settled from their account, by them or by their bank
  under a garnishee order, counts as paid, so it isn't paid twice.
- **The bank** (bank.payment_system 0.10.0) carries out the garnishee orders of the courts the world names: from the
  debtor's accounts it holds, up to the amount, to the creditor, settling the debt.

## In the small town

With the generator's laws, compliant landlords find a lawful date for every increase (a notice period, once a year), so
nothing reaches the tribunal. With a 5% cap on increases (as a council might pass on a tenants' petition), landlords who
don't comply raise rents anyway. In the test, with every tenant challenging, every unlawful notice was found invalid,
and half the landlords withdrew them.

## Leaves out (for now)

- **Possession for anything but arrears** (above, "Possession"): at the end of a term or on a landlord's ordinary
  notice a tenant still leaves when it runs out, home or no home.
- Other kinds of case: bonds, repairs, discrimination, a challenge to a decision of the town, the bargaining tribunal
  (decisions.md).
- Appeals; costs; legal representation; the tribunal's own staff and time.
- Evidence weighed: the tribunal believes what the parties say they paid (no one lies yet).
