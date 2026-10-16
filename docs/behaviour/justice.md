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

**Afterwards.** A household out of its home is without one as any other is (docs/behaviour/citizen.md). It asks the people it is closest to whether it may stay with them, and is taken in where there is room, means and willingness (docs/behaviour/households.md, "Taken in during the year"); it looks for another home it can carry, taking a smaller one as time passes; it claims what the support law lists; its adults who did not hold the lease are told and go with it; with no roof at all for long (90 days, by temperament) it leaves town. Its record keeps the order, the removal and the eviction, each about whoever did it, and its trust in the landlord, the tribunal and the police moves with them. **No office is told what became of it:** the landlord's books end with the tenancy and the member's with the order. The tenant's record and the measure `town/after-home-loss` have it.

**What the world can and cannot show of homelessness.** It can show: a household with no dwelling, for how many days, whether it found another home or left (`town/households` counts the unhoused at the end; the citizen's outcomes say `evicted` and how). It cannot show: where such a person sleeps (their body is in no dwelling; there is no shelter, car or street as a place to be, and nothing bad happens to a body for having no dwelling: no cold, no illness, no loss of a job for it); emergency or social housing, a homelessness service, or a payment for it: **no profile's support law has anything for a household without a home, and none is invented** (what each place has, a council's duty and temporary accommodation in England, crisis accommodation in Victoria, shelters and emergency rent help in Ohio, the Jobcenter taking over rent debt in Germany, is not built). Staying with people one knows is built (2026-10-12). So the town still understates what losing a home does.

**Where arrears come from.** A household that cannot cover its rent order misses it. Since 2026-10-12 (generator 0.49.0; docs/behaviour/generator.md, "Homes by income") a town's first tenancies are dealt by what each household has coming in, so a tenancy falls behind because something happened: a job lost, pay come short, a support claim refused or late, a rent raised, a death; or because someone was already out of work as the year began (those households took their homes in work, and are the town's opening hardship: as many as the description's share out of work makes). **Until then** most of a first year's arrears were an opening-day artefact: households placed, by size alone, in homes nobody in them could pay for (pensioners counted as having nothing coming in, people outside the labour force renting alone). Measured before and after, beside the sources there are: docs/decisions.md, 2026-10-12, "Homes by income".

**Measured** (`town/possession`): notices to vacate, lapsed by payment, applications, orders by finding, warrants, carried out, lapsed; each for every 1,000 renting households. Against sources: docs/design/ai-citizens.md, "Progress", and docs/calibration.md.

**Leaves out.** An order to pay the arrears with the possession order (the landlord's own application for the money is the other list). Possession for anything but arrears (the end of a fixed term, sale, damage: a landlord's ordinary notice still ends a lease as before). A tenant's defence that the home was in disrepair, an adjournment, a hearing attended in person ("A tenant's answer", below, has what a tenant can now say). Hardship stays. The bond. A landlord who changes the locks (unlawful, and real). Distress for rent. Costs. A bailiff or sheriff as an office of its own (the police stand for whoever enforces).

### A home given up (2026-10-12; citizen 0.51.0, firm.landlord 0.17.0, tribunal.member 0.6.0)

**What the fourth living pilot showed.** Two tenants went on the day their notice to vacate ran out, minutes after the landlord's seat had applied for possession (each party's first look after a weekend; the landlord's came first). Then: the tenant was back in the same dwelling two hours later; the landlord's rent book went on counting a rent a month against them and said nothing of their going; and the tribunal gave someone who had left six weeks to answer.

- **A person does not go back to a home they have given up.** The daily round took anyone with no home back to the dwelling their body was last in. A home whose tenancy has ended for us, or that our household has moved out of, is no longer where we belong; a home leased again is.
- **The tenancy is over from the day the tenant goes.** A tenant who goes on a notice to vacate gives notice on the lease as they go (as before). On the record the lease then runs out by its own notice period; in the landlord's books the tenancy is over that day, no rent is counted after it, and what was owed then is what is owed.
- **An application for possession of a home already given up.** The law gives possession where the tenant has not left. A landlord run by code withdraws such an application when it ends the tenancy on the record; a seat is shown that it stands, and may withdraw it as any paper of its own (its procedure says so). The tenant, told of the application, answers the tribunal that they have left and when. The tribunal's code dismisses on that answer ("there is nothing left to order"), and decides nothing on an application withdrawn; a seat reads the same in its books and decides for itself.
- **Not changed:** that a tenant who cannot pay goes at the notice's date as often as `1 − stay_past_notice_bps` says (a placeholder, 50%, in every profile). The coincidence of the two papers on one morning is two parties each acting on a date that has come: nothing makes it happen and nothing prevents it.

### A tenant's answer (2026-10-12; citizen 0.53.0, tribunal.member 0.7.0, firm.landlord 0.18.0, generator 0.50.0)

**Source:** the tenant's side in `citizen.ts` (the notice of hearing); the tribunal's form in `papers.ts` (`POSSESSION_ANSWER`, `possessionOrderFor`, `planLaw`); the rule in `desk.ts` (`Hearings`, the matter `possession`); the landlord's reply in `firms.ts`; the member's books in `openbooks-venues.ts`. Test: `orchestrator/test/tenant-answers.test.ts`. Decision: docs/decisions.md, "What the fifth living pilot found".

**What was wrong.** Across three pilots a model in the member's chair ordered possession in every case (56 of 56, 4 of 4, 4 of 4) and its code twin ordered the same; no tenant answered a single application, because a tenant answered only with a sum it could offer and none had one. A tribunal that hears one side tests nothing about whoever sits. The member said so afterwards: "The drafts gave me the legal conditions ... They gave me little about the households affected."

**Who answers.** A tenant served with an application for possession answers it or does not. One draw for each application, keyed on the lease and which application on it this is (the same in a run and its twin). The chance is the profile's `tenancy.possession.answer_bps`, read against who the tenant is as the citizen's other cited rates are (`swayed`, docs/behaviour/citizen.md, "Readers"; the weights are the same placeholders): higher with trust in courts, with the sense of agency, and with what they and those they know have found a desk or a tribunal to do; lower with fear of the landlord above what a notice gives everyone, and where they have somewhere to go (half a standard deviation either way of having nowhere). A tenant whose record is not read (the dial at nought) answers at the profile's rate. A tenant who has left says so, as before. **Answering is a paper.** Going to a hearing in person (a day, a room, time off work) is not built: the sourced figures are of answering or attending, and one draw stands for either.

| Profile | `answer_bps` | Source |
|---|---|---|
| au-vic-2026 | 4,300 | **Opened**: renter or someone for them at 43% of 822 hearings observed in 2023 ("Key Findings: VCAT hearing observations dataset"; social landlords; publisher not found, to confirm). Older Victorian figures, 20% to 28% for private renters: secondary |
| us-oh-2026 | 3,930 | **Opened**: tenant present at 177 of 450 first hearings, Cleveland Housing Court 2018-19 (Case Western Reserve University, The Cleveland Eviction Study, 2019); one city |
| gb-eng-2026 | 4,000 | **Placeholder**: "most tenants do not attend" (MHCLG 2018, opened); about 60% with nobody for the tenant (secondary) |
| de-ni, br-mg, in-tn, jp-akita, ke-nakuru, mx-jal | 4,000 | **Placeholder, named in each profile**: nothing found for the place; the middle of the two opened figures |

**What a tenant tells**, on the tribunal's published form (`possession_answer`, a `tribunal_response`). Every field is the tenant's own to know, from their own record; none is a number of the mind's (no trust, no agency), and none is anyone else's.

| Field | From |
|---|---|
| `owes`, `disputes_sum` | their own list of rents the bank could not pay; `disputes_sum` where that is less than the landlord's figure |
| `disputes_notice` | the notice to vacate on their file gave fewer days than the published law asks |
| `offer`, `every_days` | what the household could pay a month toward what is owed beyond the rent: income less rent less essentials (the figure a plan answer gives); nought is "nothing" |
| `out_of_work_since`, `pay_short`, `claim` (`refused` / `pending`) with `claim_on`, `ill` | why: out of work since a day; pay come short; a claim for support refused, or made and not decided; a condition of their own |
| `people`, `children`, `ages` | the household's record |
| `lived_days` | since the lease was signed, where that was in the year (a tenancy from before the year has no day on file, and nothing is said) |
| `go_to` | `means_for_another` (a month's rent and essentials put by), `someone_to_ask` (a person outside the home they are close to), or `nowhere` |

**Telling is their choice.** Whoever answers says the money part. Each other group (why; the household; how long; where they could go) is told or left out by a draw on the tenant's readiness to say what they think: the gap their record keeps between what they think of the landlord and what they say of them (docs/behaviour/citizen.md, "The record"). Someone with no such gap tells all of it; someone who says only what is expected says little. An answer that says little is short on the page.

**The landlord may reply** (`possession_reply`, a `tribunal_reply`, to the tribunal and the tenant): what its rent book shows owed that day, and whether it would take a plan offered. A landlord run by code replies, on its day for the rent book, where the tenant's sum differs from its own or something is offered; it would take a plan that clears what is owed within the law's longest. It withdraws its application once the rent owed is paid.

**What the law says of a plan** is the profile's, typed (`plan_consider`, `plan_barred_rent_months`, `cure_days`, beside `plan_months`), written into the published law, the procedure and the order form by one function (`planLawWords`). No place's law is in the code.

| Profile | The law | Source |
|---|---|---|
| au-vic-2026 | **must consider** a plan before possession; 6 months | Reasonable and proportionate; may adjourn or dismiss on an arrangement: Consumer Affairs Victoria, **opened**; sections recalled; the 6 months a placeholder |
| gb-eng-2026 | **may**; not where 2 months' rent or more is owed on the day | Housing Act 1988 s 9, **opened**; ground 8 recalled, to confirm |
| de-ni-2026 | **none**; paying everything within 60 days of the application ends the claim | BGB s 569(3) no. 2, **opened** |
| br-mg-2026 | **none**; paying everything within 15 days ends the claim | Lei 8.245/1991 art 62: recalled, to confirm |
| us-oh-2026 | **none** | Recalled, to confirm; court mediation is not built |
| in-tn, jp-akita, ke-nakuru, mx-jal | **may**; 3, 6, 3, 3 months | **Placeholders** |

Where the law has no plan, the member's order form has no plan on it (its choices are dismissed and possession; no instalment field), and says what the law has in its stead.

**The code member's rule**, in this order, on the papers alone:
1. the tenant says they have left: dismissed;
2. the notice relied on, by the application's own dates, gave fewer days than the law asks: dismissed;
3. nothing is owed (the landlord's reply where there is one, else the tenant's figure, else the application's): dismissed;
4. the law has a plan, it is not taken away at this sum, none was set and broken before, and what the tenant offers clears what is owed within the law's longest plan: a plan, at the sum offered;
5. otherwise possession on the law's day.

It weighs nothing else: not that a household can pay nothing or why, not who lives there, not whether they have anywhere to go. Its reasons say which line decided. That is what a rule does with the same papers, and it is the twin a seat is set beside. **A seat is shown the same papers and told nothing of what to decide:** the member's books give each case with the tenant's answer field by field as the tenant gave it (what was left out is simply absent), the landlord's reply, and at the head of the list the law's own words on the order.

**On the tenant's record.** The tribunal's order is an event of its own (`ordered_out`, about the tribunal) and moves trust in it, down for possession and up for a plan or a dismissal; being put out is `put_out`, about whoever did it. Until now only the landlord's notice was there, and a person ordered out by a seat had no trace of the order. One who answered learns what answering came to, as with any desk, and tells those they know.

**Left on an order, and put out on a warrant** (2026-10-13; `citizen.default` memory word, `town/possession` column `left_on_order`). A household that goes at the date of the tribunal's possession order, with no warrant asked or carried out, was made to leave in ordinary speech, but no officer put it out; one removed on a warrant was. The record said `evicted` of both, and an exit account (which takes the memory word as it finds it) told lv-06's c0773, who left on day 67.8 after an order due on day 66 with no warrant asked, as one the landlord "evicted". Now: leaving on the order is `left_on_order` on the person's record (weighed exactly as `evicted` is: the same dents, values shocks and size, so nothing about when or how often anything happens moves); a removal is `put_out` (at the warrant, as before) and `evicted` (at the leaving, as before); a notice gone on is `evicted`, as before. The measure `town/possession` gains a last column `left_on_order`: tenants who left a home with the tribunal's possession order made and no warrant carried out on it first (lv-06, measured on a copy of its log: 3, c0175 day 13.9, c0778 day 20.1 and c0773 day 67.8, beside 2 removals by warrant); the exit-account brief says "left the home on the tribunal's order, with no warrant carried out". Records written before keep `evicted` and read as they did. **Revisit if** a source says people who go on an order are not hurt as those put out are (then give `left_on_order` its own dents), or leaving on a notice is to be told apart as well.

**Measured** (`town/possession`): answers, those saying they had left, those offering something, replies, applications withdrawn. A year of the 1,000-person living town, six runs (docs/decisions.md, 2026-10-12, "what was measured"): in Nakuru's town tenants still in the home answered 3.8 of 12.2 applications; one answer in fourteen offered a sum; the code member set no plan in twelve runs, in either town.

**Why no tenant has had a sum to offer** (traced 2026-10-13, no change made; docs/decisions.md, "Why no tenant in arrears has anything to offer"). The offer is the household's income now less rent less essentials, and is right as computed. A tenant who misses a rent pays it as soon as the balance allows, so households with the means rarely reach a hearing; those who do are short whatever happens: out of work with nothing or a small payment, or in work on a wage below rent plus essentials (Nakuru's town: wage 15,563 a month, a 13,000 home, essentials 6,000, the profile's recorded rent inconsistency). Six runs of a year: 0 answers offering any sum and 0 plans in Nakuru's town (17.3 applications a run, 4.0 answers by tenants still at home), 0 and 0 in Victoria's (2.5 applications). Partial and temporary loss of income (hours cut, short-time, a late benefit) is the real path into arrears that is not built (firms.md: hours cut); a town where cases carry an offer needs rents sized to its wages or that mechanism, not a change here.

**Leaves out.** Attending in person. A defence that the home is in disrepair, or a counterclaim. Representation and advice (a duty adviser changes outcomes where there is one). A tenant who says what is not so. Mediation. Germany's limit on using the cure twice in two years. An adjournment the code member orders of its own motion (a seat can put a case off by a fresh notice).

### A warrant, and a home already left (2026-10-12; police.station 0.5.0, tribunal.registrar 0.3.0)

**What was wrong.** Traced in the police's own log of the fifth living pilot: 11 of 23 warrants "carried out" put nobody out (10 of 30 in its code twin). Each call to put someone out was refused by the world (`not_present`) and the station said "carried out" all the same. In every one the household had left after the warrant was issued, inside the notice of the day the law gives them; none had left before the landlord asked. Five more warrants found only part of the household.

- **The officer says what they found.** A warrant gives the landlord possession whoever is at home, as a bailiff's does: the officer goes, puts out whoever of the household is there, and the paper (`warrant_executed`) says how many were there and were put out (`removed`). Where nobody was there it says so: nobody was removed, possession is the landlord's, and the tenant is told as the landlord is. **An officer cannot tell a home given up from one whose tenant is out for the day**, so the two are not told apart at the door (a first version returned such a warrant "unexecuted"; a tenant who was at work then went on living in a home the landlord had been told was empty, which a test caught). The officer's hours are spent either way.
- **A landlord who learns the tenant has gone** (the tenant's notice on the lease, the day it reads it) withdraws its request for the warrant; the registrar withdraws the warrant, saying why; the station does not go on a warrant withdrawn. This is the case the pilot showed, and it now costs no officer's half day.
- **Removals mean removals.** `town/possession` counts, of the warrants an officer went on (`carried_out`): `carried_out_after_tenant_left` (the tenant's own notice that they had gone came before the officer: not a removal) and `removals` (the rest: the household lost the home by the warrant, whether or not anyone was in at that hour); `carried_out_nobody_at_home` (nobody was put out by hand; in a town where people work, most warrants) and `warrants_withdrawn` are beside them.

### The profiles' figures for possession, and how long a pilot needs (2026-10-12)

A possession order cannot come sooner than: the landlord's patience (two rents behind for two months, its own practice), the law's notice, the tribunal's time to a hearing. The tribunal's time in a living town is the profile's `frictions.venues.tribunal_days`; in a town without frictions, `justice.hearing_after_days`. Nothing here is shortened to make a pilot lively. What each profile publishes, and whether it is sourced:

| Profile | Arrears before notice / notice / order to its day / warrant runs (days) | Source of those | Tribunal's time, living town (`tribunal_days`) | Source | Its neighbour (`justice.hearing_after_days`) | First order no sooner than about |
|---|---|---|---|---|---|---|
| au-vic-2026 | 14 / 14 / 14 / 14 | 14 days' arrears and that paying ends the notice: **opened** (Consumer Affairs Victoria); the 14-day notice to confirm; the rest placeholders | 49 | **Opened**: VCAT annual report 2023-24, residential tenancies list, median 7 weeks to finalise | 21, placeholder | day 131 |
| gb-eng-2026 | 56 / 28 / 14 / 42 | Housing Act 1988 s 8, ground 8: recalled, to confirm; plan and warrant days placeholders (median claim to repossession 26.4 weeks: **opened**, Ministry of Justice) | 42 | Placeholder (six weeks) | 21, placeholder carried over; real waits known to be longer | day 138 |
| us-oh-2026 | 1 / 3 / 7 / 10 | Ohio Revised Code 1923.04: recalled, to confirm | 42 | Placeholder | 21, placeholder (hearings 5 to 15 days after service for an eviction: recalled) | day 113 |
| de-ni-2026 | 60 / 14 / 30 / 21 | BGB ss 543, 569: recalled, to confirm | 42 | Placeholder | 14 (conciliation hearing within two weeks: a statute's words, to confirm) | day 124 |
| br-mg-2026 | 30 / 30 / 15 / 15 | Lei 8.245/1991: recalled, to confirm; the days placeholders | 42 | Placeholder | 45 | day 140 |
| in-tn-2026 | 60 / 30 / 30 / 30 | Placeholders (the 2017 Act: recalled) | 42 | Placeholder | 120, placeholder (four months to a first hearing) | day 140 |
| jp-akita-2026 | 90 / 14 / 30 / 30 | Placeholders (case law: recalled) | 42 | Placeholder | 30 | day 124 |
| ke-nakuru-2026 | 30 / 30 / 30 / 14 | **Placeholders, all**: the Rent Restriction Act gives the tribunal the power; no period was retrieved | 42 | Placeholder (six weeks) | 30, placeholder; beside it a **secondary** figure: the Judiciary's median of 53 days to hear and conclude a small claim (to May 2023) | day 140 |
| mx-jal-2026 | 60 / 30 / 30 / 30 | Placeholders (Código Civil de Jalisco: recalled) | 42 | Placeholder | 60, placeholder | day 140 |

"First order no sooner than" is for a landlord run by code: a first rent missed in the first week, 60 days of the landlord's patience (two rents behind for two months, its practice), the notice and a day, and the tribunal's time (in the fourth living pilot the code landlords' first applications came on day 98 and their hearings would have fallen on day 140; the seated landlord, who gave notice as soon as the law allowed, had its first hearing on day 119). The order's own day is its days after that, and a warrant a day after that. **Sourced possession figures: one profile (au-vic-2026: the days of arrears, and the tribunal's median time). Every other possession figure in every profile is recalled and to confirm, or a placeholder.** In every profile `stay_past_notice_bps` (5,000: whether a tenant who cannot pay stays past the notice) is a **placeholder**, and `leave_on_order_bps` (5,900) is England's, from one quarter's flows, used everywhere.

So a 120-day pilot of a town that opens with every rent book at nought shows no possession order in any profile, whoever sits. Two honest ways to see one: a longer run (170 days for a first order and what follows; 200 for several), or a town that opens in the middle of things (docs/behaviour/generator.md, "An ordinary day's caseload").

## The registry lists; the member decides (2026-10-12; tribunal.member 0.5.0)

**Source:** `tribunal.ts` (`routines`, `part`); `Hearings` in `desk.ts` (the parts `list` and `decide`); the generator's staff post and standing order; `orchestrator/test/seat-acts.test.ts`. Decision: docs/decisions.md, "What the third living pilot found".

A tribunal run by code does everything in one head. With a model in the member's chair, in a living town, the tribunal has registry staff (`tribunal-member-staff`, run by the tribunal's own code): under a standing work order in force when the year begins they take each application in, list it, and tell both sides with the day the other side may answer by. They decide nothing. The member decides every case on or after its day (the day counts from its first hour: a member who sits in the morning decides what that day's list has, 2026-10-12): an application for possession on the possession order form (dismissed, a plan, possession on a day), anything else on the order form. The member's books list each case with whether the other side answered and with what. A case is put off by a fresh notice of hearing with a later day. If the member holds or withdraws the standing order, nothing is listed until it is made again. In a town with no `living` there is no registry, and the member lists on the notice of hearing form.

What the code member decides is unchanged (the table above); a seat decides for itself. What the law asks before an order is on the member's file (`proc-tribunal-member-possession`), from the profile's figures: rent owed for the law's days when the notice was given; the notice's days run; the tenant still there. An application names the notice it relies on, the day it was given and the day it gave. **A notice is given when it is on the record addressed to the tenant**: the world has no other way of serving a paper, and the procedure says the law asks no further proof. (The third living pilot's member asked every landlord for "proof of delivery", which nothing here could give.)

**The member's day (2026-10-12).** A tribunal's member is given a day's list: the cases whose day has come, in one paper from the registry's clerk, each with what is needed to decide it, and sits once to decide them, case by case. The clerk's books paper is that list (docs/behaviour/office-books.md, point 8): filed once a working day, every case whose day has come set out in full however many, and the paper that brings the member to the desk on the next working day when a case is on it for the first time. Before, the fifth living pilot's member (a model) sat 33 times in 90 days for 56 cases: nothing called it for its books, so it set its own day of return for each case's day, and each sitting opened the books paper a part at a time (eight entries to a look). A member who still sets a day of return for a case's day is back on it; nothing is taken away. What a code member decides, and when, is untouched.

**Real-world basis.** A tribunal's registry receives and lists applications and sends notices of hearing; members hear and decide. A tribunal's daily cause list is a registry's paper, drawn up for the sitting (to confirm: common practice; no source opened). (To confirm: common practice; VCAT's and the First-tier Tribunal's published procedures not opened.) A landlord offering a plan before a claim: England's Pre-Action Protocol for Possession Claims by Social Landlords asks for it (to confirm; not opened; used only as the reason the form exists).

## Appeals against an office's decision (foundations F8; docs/behaviour/decisions.md)

The tribunal says it hears `claim_refused` (a refused claim for support) and can set the decision aside only where the profile's law has an appeal route for it. Its fee for that
matter is the law's, not the tribunal's (it publishes one notice of what it hears for each fee). The days an appeal may be made in are the law's: from the decision, or from the answer to the review where
the law makes a review come first; the applicant tenders both dates, and the tribunal turns away an application out of time or without the review (finding `rejected`, with the days). A decision set aside is put
right by the office that made it.

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
