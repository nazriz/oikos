# The town's services: staff, waste and upkeep (phase C, stage C4b)

**Source:**
- `city.works` (the works office) and the payroll in `city.finance_officer`, in `participants/src/behaviour/government.ts`;
- `world.disposal` (the landfill), in `participants/src/behaviour/world.ts`;
- the complaint rule, in `participants/src/behaviour/citizen.ts`.

The design is municipal-economy.md §5.2, with the physics phase B already built: structure variables, and tasks that change them. The kernel keeps the numbers (waste in a home, wear on a park) and attaches no meaning to them. People perceive them and respond; the platform doesn't judge a service level.

## What builds up, and what the work does

- **Waste** builds up in homes: the world's `waste` variable (grams) on every building with dwellings. It grows by the profile's waste per person a day (512 kg a year, DCCEEW) for each person inside.
- **Wear** comes on the town's parks and hall: the `wear` variable, 0 to 100,000 over the profile's asset life (15 years, a placeholder).
- **Collecting** (task `collect`) takes 10 kg of a home's waste into the crew's holding at the depot. It takes the profile's seconds of work (placeholder: about 1,000 bins a day for a one-driver truck).
- **Upkeep** (task `maintain`) takes an hour of work and undoes a week's wear for the profile's hours a week (placeholder: half a day a week keeps a park or the hall up).

The crew works from the depot (the town hall) on the homes and parks. They don't travel (D25, as the builder's crew).

## Who does it

- **The works office** (`city.works`, the town's works manager):
  - **Hiring.** It hires a crew of as many as the adopted budget's `staff` line pays for, at the crew's wage, within the depot's room. It lets one go a month while it has more. Until a budget is adopted it keeps the crew it has.
  - **The day's work,** each working day (5 of 7), with the crew at the depot and their hours:
    1. collection, first for any home complained about, then for the homes longest since a collection (a round every 7 days), in steps of up to 30 homes;
    2. upkeep of the most worn assets, with the hours left.
  - **Disposal.** Weekly, it takes what's been collected to the landfill (goods moved to the outside world) with a `disposal_docket`.
  - **Its report** (to a letter) gives the crew against what the budget pays for, the homes a week or more overdue, and how worn the assets are.
- **The finance officer** runs the town's payroll, since it's the only position the bank takes payment instructions from for the town's account. It starts each new crew member's wages (net of income tax withheld, docs/behaviour/public-finance.md), stops them when employment ends, and pays over what it withheld. It counts wages against the adopted budget with the invoices it pays.
- **The landfill** (`world.disposal`, the outside world's) invoices the town monthly for what its dockets say it brought, at the profile's price a tonne (the landfill levy; the gate fee is left out). The finance officer pays the invoice within the budget.
- **Citizens complain.** A leaseholder whose home's waste has gone two weeks' worth uncollected writes to the town (a `complaint`), with a chance each week (the profile's, a placeholder), once until it's collected. The works office collects that home first. The mayor sees complaints.

## Who knows what (city.works 0.3.0, generator 0.32.0; docs/design/knowing.md)

Until 0.3.0 the works office was shown the whole town, always: every building, how much waste was at each and how
worn each asset was, as it changed. Nobody is shown a town (docs/no-god-view.md). What it has now:

| What | How it comes to know | Basis |
|---|---|---|
| **Where to collect** | Its round: a register of its own (`round`, which it keeps: `service_address`, an entry for each building people lived in at the start). A building it has had notice of being built since (the builder's `building_notice` to the town) joins the round, unless it is the town's own; one the crew calls at and finds nothing kept of waste at is taken off. | A council's waste service runs on a list of the properties it serves (to confirm: no source opened) |
| **How much is at each address** | Nobody sees a bin between collections. The crew that collects sees the building as it leaves it (the outcome of its own work: `seen`), so the office knows what was left and, from what the loads it sent took, about how much had gathered since the last call. It sends for that much next time (at least a load's call at every address due). A bin left empty held no more than was sent for: next time a load less is sent, and a call that falls short is measured by what it leaves. An address never called at gets a first load, and the rest the day after. | — |
| **The town's assets** | The town's own asset register and the notices of building work since (`ownLand`: docs/behaviour/ownership.md). Each asset it has never seen it sends someone to inspect (a visit: up to 16 at a time, taking the office's time; the crew goes on working meanwhile, the office doing two things at once). Wear runs at a steady rate, so one sight and the crew's sight after each upkeep is enough. | "The Property Department maintains an asset register of Council land and building assets" (docs/behaviour/knowing.md, section 2) |

**What changed in the town** (the 1,000-person town, 90 days): about a tenth more loads' worth of the crew's time on
collection (4,090 a month against 3,711), from the first calls and the loads sent for a little more than was there;
no complaints; upkeep as before.

## The budget

The budget has three lines, each on the council proposal form:
- **parks:** capital works;
- **staff:** the crew's wages;
- **services:** the landfill's charges.

The finance officer's brief says what each line pays for. The code mayor proposes:
- parks as before;
- a crew of the profile's staff per 1,000 residents (derived: about 6);
- a year's waste at the landfill levy, with a fifth over.

A budget with no staff lets the crew go, and the waste isn't collected (`orchestrator/test/services.test.ts`). That's the steward's lever: what the town pays for, and what people then live with.

**At the start** the town has its crew in work, like the firms' staff: the profile's staff per 1,000 residents, at the hall, paid by the finance officer's genesis wage orders.

## Leaves out

- contracting services out (a waste contractor under an agreement);
- recycling and green waste (separate bins and streams);
- a waste service charge per household (the budget pays from rates and grants);
- streets (they need a street network);
- what worn assets do to people. Nothing yet uses a park, so a worn park only shows in the works office's report. A run-down park near home is a candidate for complaints and for the amenity term in leaving town (municipal-economy.md §6).
