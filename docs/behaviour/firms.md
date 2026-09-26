# Firms: `firm.landlord` (v0.3.2) and `firm.employer` (v0.2.0)

**Source:** `seats/src/behaviour/firms.ts`. Both wake weekly and whenever something names them.

## `firm.landlord`: a letting office

| Rule | Detail | Source |
|---|---|---|
| **Listing** | Each vacant home is listed at a 5% markup over what the landlord currently gets for homes in the same building, ±2.5% noise. With no comparable, it uses the world's base rent. | BoE housing model eq. (11): the asking rent is a markup over the average rent |
| **Cutting** | A listing unlet for a month is withdrawn and relisted 5% lower | BoE model §3.4.4: "the price is reduced each month by a constant fraction of 5%" |
| **Choosing a tenant** | One applicant at random per listing | BoE model §3.5: when several bidders can afford an offer, "one is randomly chosen", because a bidder's maximum is private |
| **Term** | 12–24 months, uniform; 60 days' notice from the landlord, 30 from the tenant | BoE model: "chosen randomly from 12 to 24 months with uniform probability, as suggested by data from the Association of Residential Letting Agents". The notice periods match the example tenancy law. |
| **Counting homes as taken** | Homes under a lease in force, *or* offered and still awaiting the tenant's signature (up to a month) | Found in M1: counting only signed leases let the same flat twice |
| **Letting only what's free** | A listing being let is never also relisted in the same plan. Before offering a lease, the landlord checks the building still has a free home; if not, it withdraws the listing | Found with D43: a monthly rent cut relisted a home in the same plan that let it, and the stale listing was let again later |
| **Arrears** | After 2 months' unpaid rent, give notice | A typical landlord practice, not a law: what tenancy law requires is a record the landlord may follow or not |
| **Development** | Builds on its own empty sites when average vacancy over 90 days is ≤10% and it can afford it. Applies for a permit; if refused, complies with probability `compliance_bps`, otherwise builds anyway. Pays fines and obeys demolition orders with the same probability. | [institutions.md](institutions.md) |
| **Tax** | Monthly, with owners' spending: a `tax_report` to the town of rent received, and payment at the rate it believes the tax law sets (`tax_rate_bps`, supplied by the world). A non-complying landlord (probability `1 − compliance_bps` each month) reports only half. It pays tax penalties like fines. | Tax evasion as a gamble on detection (Allingham & Sandmo 1972). Here the tax clerk can't detect it at all yet. See [government.md](government.md). |
| **Owners' spending** | Monthly: 60% of rental income spent at local shops, 20% on upkeep bought from outside | A placeholder to stop money pooling at landlords (see the calibration notes below) |

**Differs from the BoE model on purpose:** that model injects cash so tenants never miss rent. Here arrears happen, and what follows is up to the landlord.

## `firm.employer`: a shop or factory's manager

| Rule | Detail |
|---|---|
| **Posting** | If staff plus pending offers are below the target headcount, and the balance covers 2 pay periods of the wage bill, post one job at the firm's wage |
| **Hiring** | One applicant at random per posting. The offer includes the workplace. |
| **Paying** | Once the worker signs, set up a standing order through the firm's bank for wages every 14 days |
| **Layoffs** | If the balance can't cover the next pay period, give 14 days' notice to the most recent hire, and stop their wages when it runs out |
| **Suppliers** | Monthly: 40% of the month's revenue paid to the outside world, for goods bought in |

The labour-market literature (the Dosi et al. "Schumpeter meeting Keynes" labour extension) is the planned refinement for wage-setting and hiring.

## Calibration notes for the checkpoint

Over a 2-year run of the 200-citizen town (`worlds/town.yaml`):
- Employment holds at about 160.
- Housing settles at about 152 of the ~159 who stay; 41 people leave town.
- **Money pools in shops**, which pass profits on to no one.
- **Factories slowly run down**: wages plus supplies exceed export sales.

Modelling owners and their profit draws is the obvious next step. That's economic calibration, a medium-fidelity area (D25).
