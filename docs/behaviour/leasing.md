# Shop premises to let: commercial leasing (firm.landlord, firm.retailer 0.21.0; 2026-10-25; risk ME-1)

**Why.** A business of one could never take on its first employee: a home is the household's, a pitch holds one, and the
only premises a founder could get were a closed shop's, bought outright. Real small firms that grow lease premises (Naz,
2026-10-25: "build commercial leasing as a real institution ... so a sole trader can take premises and employ").

## The institution

| | |
|---|---|
| **The premises** | Beside its shops, a town opens with the profile's share of shop units standing empty (`commercial.vacant_bps` of all units), each a building of one workplace (`shop-unit`, room for as many at work as the town's largest goods shop) on a lot of one of its landlords. |
| **Who lets them** | The landlord who owns the lot (`firm.landlord`, `commercial`): a unit with no lease on it is listed (`premises_listing`, on the board "Shop premises to let"), at the profile's rent for a small unit (`rent_per_month`) or what its other units let for; a month unlet brings the asking rent down, as for a home (`cut_bps`). |
| **The lease** | Offered to the first business that applies (a landlord takes the first tenant who can sign; nothing is drawn): the rent monthly in advance, a term (`term_months`), and a **security deposit** of `deposit_months` of rent, paid as the tenant signs and given back, by the landlord, to the account the tenant applied from, once the lease has ended, less what is then owed. Its terms of ending are the law's (below): the landlord's, a notice it gives only to end the lease for rent owed or on a surrender agreed (re-entry the next day where the law asks no notice); the tenant's, a notice of its own only where the law gives one. |
| **Not a home's tenancy** | The law on a home's tenancy, its rent reviews, its possession procedure and its tribunal do not reach a lease of shop premises: the landlord's books keep the two apart. A lease of premises has a law of its own (`law-premises-leases`). |
| **Who takes them** | A business of one whose owner turned customers away last month looks at what is to let (a look at the board, cheapest first). It weighs each unit: the custom it had and turned away, served by as many hands as it needs within the unit's room, each paid the going wage, less the rent and its running costs, against what its owner alone serves. The best that beats it, and for which it holds the deposit, a month's rent and a month's wages, it applies for (`rental_application`). |
| **Taking them** | Offered the lease: it signs, pays the deposit, sets the rent up by standing order, takes its stock there, and tells its owner it trades from there now (`trading_at`); the owner works there from then on, not from home. |
| **Employing** | In leased premises a business of one takes on the hands its trade needs beside its owner, up to the unit's room, through ordinary hiring (a posting, interviews, an offer: docs/behaviour/firms.md, "Hiring"); before the owner's draw it keeps the month's rent and a pay period's wages. |
| **Who is at the unit** | The business is there as its premises are: it sees the unit's ground, and who is in it by name, through a channel of premises held by agreement (`{held: "occupancy"}`: the buildings where an agreement in force names it the occupant; nothing until it holds one, and it moves as its agreements do; docs/no-god-view.md). It serves with those it sees there, its owner and its hands, as they come to work: nothing is served there before its owner arrives, so no serving act is refused for nobody being there. |

## The law on premises leases (`law-premises-leases`)

Published from the profile's `commercial.law` where the town has premises to let; read by the landlord, the business
that leases and the tribunal. No place's figures in the code.

| Field | What it says |
|---|---|
| `arrears_days` | Rent owed (a month's or more) this long before a landlord may end the lease for it. |
| `forfeiture_notice_days` | The notice it then gives (0: it re-enters the next day; written as a notice of one day under the lease's own clause, as the agreement reader needs a period). |
| `tenant_notice_days` | A tenant's notice to end the lease early (0: none; only a surrender the landlord agrees to). |
| `review_months`, `review_notice_days`, `upward_only` | A rent review no more often than every so many months, on so many days' notice, to the market rent; up only, or up and down. |
| `disputes` (data `heard_by`) | Who hears a claim for rent owed: the town's tribunal, standing for the court or tribunal of the place. |

## Remedies (the landlord, at its look in the rent book, weekly)

| | |
|---|---|
| **The rent book** | For each lease of its premises the landlord sets what has fallen due (the deposit as it is signed, the rent monthly in advance from then to the lease's end, at each month's rent, and a surrender's price once asked) against everything come in from the account the tenant applied from since it was offered. |
| **Asking** | A month's rent or more behind: it writes to ask for it (`review_request`, `matter: arrears`, with the sum and its account), again a month on if still owed. The business pays a demand it holds the money for. |
| **Ending it for rent owed** | Still a month's rent behind once the law's `arrears_days` have run from when it was first seen behind: it ends the lease (forfeiture), by a notice to the tenant saying so and why (`lease_forfeiture`) and its notice under the lease (re-entry the next day, or the law's notice). It never puts anyone out or takes anything: the business moves out as its lease ends. |
| **At the end** | However it ended (its term, a notice, a surrender, forfeiture): the deposit is set against what is owed and the rest given back; anything owed beyond it is recorded as the tenant's debt (a claim) and, where the law sends such a claim to the tribunal and the town has one, brought before it (`tribunal_application`, kind `debt`, with the claim). The tribunal hears it as any debt (docs/behaviour/justice.md): an order to pay, enforced by its registrar on the debtor's bank. |

## Rent reviews

As often as the law lets (from the signing, then from the last review), and only where the new rent would start before
the lease ends: the landlord reads the market from its own books (what its other units have let for lately, what it asks
for those listed, how many stand empty) and moves the rent to it in full (a market review: the rent a unit would let for
now), never down where the law has reviews up only. The new rent starts on the first rent day once the law's notice has
run, by a notice to the tenant (`rent_review`). The business pays it from that day: a new standing order at the new rent,
the old one stopped after its last payment. With no evidence, the rent stays.

## Leaving early

| | |
|---|---|
| **When a business wants to** | Each month it weighs the premises as it weighed taking them (the custom it had, served by the hands it needs, their wages and the rent, against what its owner alone would serve); worse for `leave_after_months` running (3, a placeholder, ME-1), it asks to leave. A business closing (its owner has given it up or gone) asks to leave before it closes. |
| **How** | By its own notice, where the law gives tenants one; else by asking the landlord to accept a surrender (`surrender_request`). The landlord answers with its price (`surrender_terms`: `surrender_months` of rent, its practice, and any rent owed); paid, it ends the lease by its notice under it, and gives the deposit back less what is owed. Not paid in a month, the offer lapses. |
| **Paying for it** | The business pays the price if it holds it and leaving is worth it: the price no more than what staying would lose it to the lease's end (a business closing pays whatever it holds enough for). A closing business that cannot pay closes a month on: the lease runs on, and the landlord has its remedies. |
| **Moving out** | When the lease has ended, the business stops its rent orders, takes its stock back to where it traded before, and tells its owner (`trading_at`, `back`): its owner works from home again, as they did. |

## Where the figures come from

Each profile's `commercial`, with its source; most are placeholders (ME-1), marked in the profile:

| (ME-1) | au-vic | gb-eng | ke-nakuru |
|---|---|---|---|
| term | 60 months, the Retail Leases Act 2003 (Vic) s 21 (opened) | 60 months, placeholder | 59 months, under Cap 301's five years (recalled) |
| deposit | 3 months' rent, placeholder (the Act's holding and 30-day return, opened) | 3 months, the low end of practitioners' 3 to 6 (opened) | 2 months, placeholder |
| rent of a small unit | $2,500 a month, placeholder | GBP 1,500, placeholder | KSh 20,000, placeholder |
| units empty | 10%, placeholder | 13.9%, recalled (BRC-LDC) | 10%, placeholder |
| arrears before ending | 14 days, re-entry the next day: a lease's common re-entry clause, placeholder (the Property Law Act 1958 s 146 notice does not reach rent, to confirm) | 21 days, peaceable re-entry: a common clause, recalled | 30 days, placeholder; then two months' notice (Cap 301, recalled) |
| tenant's notice | none: a surrender only (the Act gives no right to leave early, recalled) | 180 days: a common tenant's break clause, recalled | 60 days (Cap 301, recalled) |
| rent reviews | at most yearly, up or down (the Act's s 35, to confirm), 30 days' notice placeholder | at five years, up only: common practice, recalled; 90 days' notice placeholder | yearly, placeholder; two months' notice (Cap 301, recalled) |
| claims heard by | the tribunal, standing for VCAT (retail tenancy disputes, Part 10, to confirm) | the tribunal, standing for the county court (a money claim), placeholder | the tribunal, standing for the Business Premises Rent Tribunal and the courts (recalled) |
| surrender's price | 3 months' rent, placeholder | 3 months, placeholder | 2 months, placeholder |

## Leaves out

Mediation before a dispute is heard (Victoria's Small Business Commission); a market rent set by a specialist valuer
when the parties disagree (the landlord's own reading of its books stands); a tenant's challenge to a review or a
forfeiture (relief from forfeiture; a reference to Kenya's rent tribunal); distress for rent and its successors
(Kenya's Cap 293; England's Commercial Rent Arrears Recovery); a claim for the rent lost after a forfeiture (only what
fell due before the lease ended is claimed); premises fitted out; a guarantor, so a lease holds a business's money and
nothing of its owner's; options to renew and security of tenure; assigning a lease; a shop that owns its premises moving
into a leased unit; a landlord buying a closed shop's premises to let them. An owner weighing whether to give up a
business with a lease still counts the rent to the lease's end, not what leaving early would cost. A business back from a
lease trades from its owner's home, whatever it traded from before (a pitch's agreement may have gone).
