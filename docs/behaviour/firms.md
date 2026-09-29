# Firms: `firm.landlord` (v0.8.0) and `firm.employer` (v0.6.0)

**Source:** `participants/src/behaviour/firms.ts`. Both wake weekly and whenever something names them.

## `firm.landlord`: a letting office

| Rule | Detail | Source |
|---|---|---|
| **Listing** | Each vacant home (a unit, with its bedrooms) is listed at a 5% markup over what the landlord currently gets for homes with the same number of bedrooms in the same building, ±2.5% noise. With no comparable, it uses the world's base rent for that size. | BoE housing model eq. (11): the asking rent is a markup over the average rent |
| **Cutting** | A listing unlet for a month is withdrawn and relisted 5% lower | BoE model §3.4.4: "the price is reduced each month by a constant fraction of 5%" |
| **Choosing a tenant** | One applicant at random per listing | BoE model §3.5: when several bidders can afford an offer, "one is randomly chosen", because a bidder's maximum is private |
| **Term** | 12–24 months, uniform; 60 days' notice from the landlord, 30 from the tenant | BoE model: "chosen randomly from 12 to 24 months with uniform probability, as suggested by data from the Association of Residential Letting Agents". The notice periods match the example tenancy law. |
| **Counting homes as taken** | Homes under a lease in force, *or* offered and still awaiting the tenant's signature (up to a month) | Found in M1: counting only signed leases let the same flat twice |
| **Letting only what's free** | A listing being let is never also relisted in the same plan. Before offering a lease, the landlord checks the building still has a free home; if not, it withdraws the listing | Found with D43: a monthly rent cut relisted a home in the same plan that let it, and the stale listing was let again later |
| **Who it lets to** | Among applicants, it turns down households with more than two people per bedroom (`max_people_per_bedroom`; 0 for no limit) and picks among the rest at random. The lease names the leaseholder and, in its terms, the household ([households.md](households.md)). | The occupancy standard's own ceiling (CNOS); whether a landlord applies it is a placeholder policy |
| **A tenant's death** | Seen in its own buildings (it sees them by name): it reports it to the registry, if nobody has. Once registered, it gives notice on the lease. | Victoria: a sole tenant's death ends the tenancy after notice; a household member may apply to take it over (not modelled yet) |
| **Arrears** | After 2 months' unpaid rent, give notice | A typical landlord practice, not a law: what tenancy law requires is a record the landlord may follow or not |
| **Development** | Builds on its own empty sites when average vacancy over 90 days is ≤10% and it can afford it. Applies for a permit; if refused, complies with probability `compliance_bps`, otherwise builds anyway. Pays fines and obeys demolition orders with the same probability. | [institutions.md](institutions.md) |
| **Rates** (C4a) | Pays each rates notice's claim (and any penalty interest) when it has the money, naming the claim; a non-complying landlord may not. | [public-finance.md](public-finance.md) |
| **Tax on rent** (not in the generated town since C4a) | Monthly, with owners' spending: a `tax_report` to the town of rent received, and payment at the rate it believes the tax law sets (`tax_rate_bps`, supplied by the world). A non-complying landlord (probability `1 − compliance_bps` each month) reports only half. It pays tax penalties like fines. | Tax evasion as a gamble on detection (Allingham & Sandmo 1972). Here the tax clerk can't detect it at all yet. See [government.md](government.md). |
| **Owners' spending** | Monthly: 60% of rental income spent at local shops, 20% on upkeep bought from outside | A placeholder to stop money pooling at landlords (see the calibration notes below) |

**Differs from the BoE model on purpose:** that model injects cash so tenants never miss rent. Here arrears happen, and what follows is up to the landlord.

**Rent reviews (landlord 0.9.0):** a landlord reviews each tenancy's rent once a review period. The period and the notice it gives are its own practice (`rent_review_months`, `rent_increase_notice_days`: none, 0), bounded by the world's law on rent increases where there is one: a law statement with `data: { law: "rent_increases", review_months, notice_days }`, which the landlord reads like anyone else, so a law changed in the world (by its lawmakers, or a steward) changes what landlords do. It reviews as often as the law allows, and gives at least the notice the law requires. (The generator publishes the law from the profile's `tenancy`.) At each review:
- it raises the rent to what it would ask for that home now (its markup over what similar homes in the building let for, or its base rent), if that's more;
- it gives the notice the law requires, with a `rent_increase` statement to the tenant (`data: { lease, rent, from, was }`), counted from when the notice is given (if a busy wake gives it a day late, the date moves with it);
- it never lowers a tenancy's rent (an unlet home's asking rent falls instead);
- the rent it expects, for arrears, follows the increases.

The tenant pays the new rent from when it starts, or gives notice (docs/behaviour/citizen.md). This is where tight housing reaches sitting tenants, the counterpart of the BoE model's cut for unlet homes. Victoria's law (the first profile): once in 12 months, 60 days' notice.

**The owners' draw (landlord 0.7.0):** monthly, 60% of rent received goes to the landlord's owners. With a `shareholders` register (the generated town's: its households), it's paid to them by their shares, and they spend it as they will. Without one, the old money-only stand-in (spent at a local shop) remains. 20% goes on upkeep bought from outside (maintenance comes in phase C).

## `firm.employer`: a manager with a fixed headcount

How any employer hires and pays (postings, offers, standing orders, notice, a worker's death) is shared code, `Staffing` in `participants/src/behaviour/firms.ts`. Factories ([producer.md](producer.md)) and the builder use it too, each with its own rule for how many staff to have and at what wage. `firm.employer`'s rule is the simple one below: a fixed target headcount at a fixed wage. The generated town no longer uses it (its shops are `firm.retailer`s), but a researcher can put it in any seat (the migration test does).

| Rule | Detail |
|---|---|
| **Posting** | If staff plus pending offers are below the target headcount, and the balance covers 2 pay periods of the wage bill, post one job at the firm's wage |
| **Hiring** | One applicant at random per posting. The offer includes the workplace. |
| **Bargaining** (C5) | A union's wage claim gets an offer by capacity to pay; an accepted offer becomes an enterprise agreement and a rise for all staff (new wage orders from the next pay day). Staff on strike aren't paid for the time: their pay stops, and restarts at the return, with what they earned before the stoppage. After each stoppage, the offer rises by half the gap (Hicks 1932). | [unions.md](unions.md) |
| **Postings** | A posting says where the work is (`data.workplace`), so someone told about a workplace can find it. A posting still open when the firm's wage has moved (Lengnick's rule raises it for a posting unfilled a month) is withdrawn and published again at the new wage, so the rise reaches applicants. |
| **Paying** | Once the worker signs, set up a standing order through the firm's bank for wages every 14 days |
| **Layoffs** | If the balance can't cover the next pay period, give 14 days' notice to the most recent hire, and stop their wages when it runs out |
| **Suppliers** | Monthly: 40% of the month's revenue paid to the outside world, for goods bought in. This is a money-only stand-in until shops buy goods (phase B, stage B4 step 3). |

The labour-market literature (the Dosi et al. "Schumpeter meeting Keynes" labour extension) is the planned refinement for wage-setting and hiring.


**A worker's death** (v0.5.0): on the registration, it stops the wages and ends the employment on record; the post is advertised again as staffing allows.

## Calibration notes for the checkpoint

Over a 2-year run of the 200-citizen town (`worlds/town.yaml`):
- Employment holds at about 160.
- Housing settles at about 152 of the ~159 who stay; 41 people leave town.
- **Money pools in shops**, which pass profits on to no one.
- **Factories slowly run down**: wages plus supplies exceed export sales.

Modelling owners and their profit draws is the obvious next step. That's economic calibration, a medium-fidelity area (D25).
