# Shop premises to let: commercial leasing (firm.landlord, firm.retailer 0.19.0; 2026-10-25; risk ME-1)

**Why.** A business of one could never take on its first employee: a home is the household's, a pitch holds one, and the
only premises a founder could get were a closed shop's, bought outright. Real small firms that grow lease premises (Naz,
2026-10-25: "build commercial leasing as a real institution ... so a sole trader can take premises and employ").

## The institution

| | |
|---|---|
| **The premises** | Beside its shops, a town opens with the profile's share of shop units standing empty (`commercial.vacant_bps` of all units), each a building of one workplace (`shop-unit`, room for as many at work as the town's largest goods shop) on a lot of one of its landlords. |
| **Who lets them** | The landlord who owns the lot (`firm.landlord`, `commercial`): a unit with no lease on it is listed (`premises_listing`, on the board "Shop premises to let"), at the profile's rent for a small unit (`rent_per_month`) or what its other units let for; a month unlet brings the asking rent down, as for a home (`cut_bps`). |
| **The lease** | Offered to the first business that applies (a landlord takes the first tenant who can sign; nothing is drawn): the rent monthly in advance, a term (`term_months`), notice either side at its end (`notice_days`), and a **security deposit** of `deposit_months` of rent, paid as the tenant signs and given back, by the landlord, to the account the tenant applied from, once the lease has ended. |
| **Not a home's tenancy** | The law on a home's tenancy, its rent reviews, its possession procedure and its tribunal do not reach a lease of shop premises: the landlord's books keep the two apart. |
| **Who takes them** | A business of one whose owner turned customers away last month looks at what is to let (a look at the board, cheapest first). It weighs each unit: the custom it had and turned away, served by as many hands as it needs within the unit's room, each paid the going wage, less the rent and its running costs, against what its owner alone serves. The best that beats it, and for which it holds the deposit, a month's rent and a month's wages, it applies for (`rental_application`). |
| **Taking them** | Offered the lease: it signs, pays the deposit, sets the rent up by standing order, takes its stock there, and tells its owner it trades from there now (`trading_at`); the owner works there from then on, not from home. |
| **Employing** | In leased premises a business of one takes on the hands its trade needs beside its owner, up to the unit's room, through ordinary hiring (a posting, interviews, an offer: docs/behaviour/firms.md, "Hiring"); before the owner's draw it keeps the month's rent and a pay period's wages. |

## Where the figures come from

Each profile's `commercial`, with its source; most are placeholders (ME-1), marked in the profile:

| (ME-1) | au-vic | gb-eng | ke-nakuru |
|---|---|---|---|
| term | 60 months, the Retail Leases Act 2003 (Vic) s 21 (opened) | 60 months, placeholder | 59 months, under Cap 301's five years (recalled) |
| deposit | 3 months' rent, placeholder (the Act's holding and 30-day return, opened) | 3 months, the low end of practitioners' 3 to 6 (opened) | 2 months, placeholder |
| notice | 90 days, placeholder | 180 days, recalled (Landlord and Tenant Act 1954 s 25) | 60 days, recalled (Cap 301) |
| rent of a small unit | $2,500 a month, placeholder | GBP 1,500, placeholder | KSh 20,000, placeholder |
| units empty | 10%, placeholder | 13.9%, recalled (BRC-LDC) | 10%, placeholder |

## Leaves out

Rent reviews within a commercial lease; a landlord's remedies for a tenant behind with the rent (forfeiture, distress):
a lease in arrears runs to its end and its deposit is given back whole; a tenant's own notice to leave early; premises
fitted out; a guarantor; options to renew; a shop that owns its premises moving into a leased unit; a landlord buying
a closed shop's premises to let them.
