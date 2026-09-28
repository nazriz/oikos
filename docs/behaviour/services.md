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
