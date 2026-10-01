# Utilities: water and energy (`utility.water` v0.1.0, `utility.energy` v0.1.0)

**Source:** `participants/src/behaviour/utilities.ts`; households' side in `citizen.ts`. Design:
docs/design/world-expansion.md §6.1, contract §6.4 (signed 2026-10-01). Figures: the profile's `utilities`, with sources.

## The physics (kernel)

- **The river carries water:** a `water` field, fed along the river's cover each day, flowing downstream and lost
  along the way (decay). Placeholders, sized so a small town's draw is a small share of a modest river.
- **Drawing is work:** a task's `draws` takes from a field at the cell (the structure's, or the four around it) with
  the most. Where there isn't enough, it's refused (`field_exhausted`).
- **Emitting is work:** a task's `emits` adds to a field at the structure's corner cell, or to a world counter.
- **World counters** (`greenhouse_gas`, in grams of CO2e) are kept by the kernel and censused monthly
  (`counter_census`). They have no effect on anything in the world: emissions matter, but not locally.

## The water corporation

| | Rule | Source |
|---|---|---|
| **Supply** | Each day it draws from the river what the town used: the residents it sees in each home at `litres_per_person_per_day` (160). | ESC water performance reports (to confirm) |
| **Restrictions** | When the river can't give it (refused), it announces water restrictions, and lifts them when it can again. | — |
| **Bills** | Quarterly, to each home's owner (its lot's title): the service charge ($90) and what was used ($3 a kilolitre). Owners pay (landlords pay invoices addressed to them). | A regional corporation's tariff (to confirm); Victorian water bills go to owners |

## The energy retailer

| | Rule | Source |
|---|---|---|
| **Customers** | A household that holds a home and lives there asks to be supplied (`supply_request`). It stops being a customer when it leaves, dies, or asks to stop (`supply_end`), with a last bill. | — |
| **Supply** | Each day the network supplies its customers' use (`units_per_customer_per_day`, 11 kWh) from what it holds: work that uses a kWh and emits the grid's 780 g of CO2e. Below a fortnight's use (with what's on order), it buys a month's from the grid (the outside's market). | AER / ESC average Victorian household (to confirm); NGA Factors 2024, Victoria scope 2 (to confirm) |
| **Bills** | Monthly, to each customer: the supply charge ($1.10 a day) and their use (30 cents a kWh). | The Victorian Default Offer 2025–26 (to confirm) |

## Households

Bills addressed to them are paid when they come, if the account covers it, before anything else. What bills come to a
month (over the last 90 days) counts with the rent in the month's outgoings, so spending at the shops is less.

**In the small town** (120 days): about 31 kL of water a day; 74 households supplied with about 96,000 kWh, 75 tonnes of
CO2e; every bill paid; about 2% fewer goods made, as bills come before shopping. Turn off the river's inflow and it runs
dry within weeks: restrictions (a test).

## Leaves out (for now)

- **Use doesn't respond** to price, restrictions or hardship. It's a fixed rate per person or household: no meters, no
  saving water in a drought.
- **Disconnection** for unpaid bills, and hardship programs.
- **Drought over time:** the river's inflow is fixed config. A changing season or a drought needs a varying source,
  later.
- **Local generation:** solar on roofs, a power station.
- **Gas.** Tenants reimbursing owners for water use (Victoria's tenancy law allows it).
