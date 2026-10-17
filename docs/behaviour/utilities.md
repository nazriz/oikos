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
| **Supply** | Each day it draws from the river what the town uses: the statistician's latest published estimate of how many live in the town (docs/behaviour/boundary.md), at `litres_per_person_per_day` (160). With no estimate published it draws nothing. | ESC water performance reports (to confirm) |
| **Restrictions** | When the river can't give it (refused), it announces water restrictions, and lifts them when it can again. | — |
| **Bills** | Quarterly, to each home's owner as its customer roll has them: the service charge ($90) and what the home's meter shows was used since it was last billed ($3 a kilolitre). A meter not read this quarter is billed the service charge alone, and what it shows when next read. Owners pay (landlords pay invoices addressed to them). | A regional corporation's tariff (to confirm); Victorian water bills go to owners |

### Who knows what (utility.water 0.2.0, generator 0.32.0; docs/design/knowing.md)

Until 0.2.0 the corporation was shown the whole town, always (who was in every home, each morning), and the whole
land register. Nobody is shown a town (docs/no-god-view.md). What it has now:

| What | How it comes to know | Basis |
|---|---|---|
| **Its customers** | A roll of its own (`roll`, a register it keeps): the valuer's roll of each property as it stood at the start (the lot, its owner, the buildings on it and which hold dwellings), and each notice of acquisition the land registry sends when land changes hands. | Whoever disposes of land must give notice to the water authority (Water Act 1989 (Vic) s 159); valuations are returned to rating authorities, of which a water corporation is one (docs/behaviour/knowing.md, section 2; who is prescribed: to confirm) |
| **New buildings** | The builder gives it notice of building work as it begins (`building_notice`), and of a demolition; the building joins the roll, or leaves it. Whether it is a home, its meter says when first read. | A connection is applied for by whoever builds (to confirm: no source opened) |
| **What each home used** | A meter: each building that holds dwellings carries a measure, `water_used`, in litres, that rises with those in it (the world's catalogue, as waste does; `litres_per_person_per_day` a head). Before each quarter's bills (`read_days`, 21) its reader goes round the meters: a visit to up to 16 buildings at a time, which takes the corporation's time (the way there and back, and `knowing.meter_read_seconds` at each: 120, a placeholder), and the next when back. | Meters are read on a round before billing (common practice: to confirm, no source opened) |
| **How many the town is** | The published population estimate. | — |

**What changed in the town.** The daily draw follows the estimate (everyone counted as resident) and not who was
seen at home at six in the morning: about 8% more water drawn in the first month of the 1,000-person town. A home's
bill follows who was in it, hour by hour (the meter), not who was there at one look a day.

**Leaves out:** a meter reader is nobody's working day (the corporation has no staff in the world: its draw of water
takes none either); estimated readings; the tenant as the customer.

**Under a standing order** (a model in the office: docs/behaviour/standing-work.md) the billing staff count the round
from the order: the first bills go out one period after it came into force, the meter round begins `read_days`
before that, and their report to the office says both dates ("the meters are read from year 1, day 41 and the next
bills go out on year 1, day 62").

## The energy retailer

| | Rule | Source |
|---|---|---|
| **Customers** | A household that holds a home and lives there asks to be supplied (`supply_request`). It stops being a customer when it leaves, dies, or asks to stop (`supply_end`), with a last bill. | — |
| **Supply** | Each day the network supplies its customers' use (`units_per_customer_per_day`, 11 kWh) from what it holds: work that uses a kWh and emits the grid's 780 g of CO2e. Below a fortnight's use (with what's on order), it buys a month's from the grid (the outside's market). | AER / ESC average Victorian household (to confirm); NGA Factors 2024, Victoria scope 2 (to confirm) |
| **Bills** | Monthly, to each customer: the supply charge ($1.10 a day) and their use (30 cents a kWh). | The Victorian Default Offer 2025–26 (to confirm) |

**Buying from the grid (2026-10-09).** The retailer's order to the grid is a paper of kind `order` addressed to the
outside's market, paid in full into the account the market's price list names; the market delivers when it is paid
and sends back money that comes with no order waiting for it. Run by code, or by its staff under a supply order, the
office buys a month's use when what it holds and has on order is below a fortnight's, if its account can pay for the
whole month; if it cannot, it buys nothing. Where a model holds the office it has the order form among its
stationery, which says how buying is done, and its staff's weekly report says what is held and why nothing was
bought ("a month's from the grid (125400 at ... each) comes to ... and the account holds ..., so nothing was
ordered: a smaller order is the office's to place on its order form"). In the first utilities pilot the office had
no form: the seat's payments were sent back three times and the town's supply ran out for three weeks
(docs/decisions.md, 2026-10-09, "An office that buys from outside can place the order"). **Left as it is:** staff
that buy a whole month or nothing (under a dear grid the account cannot pay for a month before the first bills come
in, with code in the office as well); a seat is not shown the words that come with a payment sent back.

## Households

Bills addressed to them are paid when they come, if the account covers it, before anything else. What bills come to a
month (over the last 90 days) counts with the rent in the month's outgoings, so spending at the shops is less.

**In the small town** (120 days): about 31 kL of water a day; 74 households supplied with about 96,000 kWh, 75 tonnes of
CO2e; every bill paid; about 2% fewer goods made, as bills come before shopping. Turn off the river's inflow and it runs
dry within weeks: restrictions (a test).

## Leaves out (for now)

- **Use responds only a little** (the Rust port, below): the utility's own reckoning of use follows the price and a restriction, if the profile gives its figures; the households' own use, which is physics in the world, does not, and citizens do not read the tariff. Hardship is not modelled.
- **Disconnection** for unpaid bills, and hardship programs.
- **Drought over time:** the river's inflow is fixed config. A changing season or a drought needs a varying source,
  later.
- **Local generation:** solar on roofs, a power station.
- **Gas.** Tenants reimbursing owners for water use (Victoria's tenancy law allows it).

## Wrong bills (`utility.energy` v0.3.0)

Bills go wrong. An energy retailer's meter reading is sometimes an estimate, entered too high, and the customer is billed for units they did not use. In the world: of its customers, a share a year (basis points of customers, a year) are sent such a bill. That is a slip (foundations F7): a row of the world's table of slips (`orchestration.slip`, `publish/invoice/metered_bill`, `per: year`, scaled by the friction dial) with its source, drawn at each bill by the platform's one helper `slip()` from a stream named for the customer. No row, or the friction dial at 0 or absent: no bill is wrong. A wrong bill states `billing_over_bps` more units than were used (the bill's text and `data.units` show the units billed, `data.days` the true days, `data.estimated: true` marks it); its amount is the tariff on those units. Every other bill is as before.

A customer who finds a wrong bill asks the retailer to put it right (`review_request`, matter `bill`, `about` the invoice). The retailer answers from its own record of the bill: it recomputes the right amount from the bill's days and its tariff, and what was billed above that is what it owes. It pays that back exactly when it grants (`respond.grant_bps.bill`, as for any remedy: docs/behaviour/frictions.md), and answers that its records show nothing owed when the bill was right. Whoever does the billing work answers, once; the office-holder who only sets the standing orders does not.

The figures (the slip row, `billing_over_bps`, `respond`) are the profile's, with their sources (`frictions.bill`: docs/behaviour/frictions.md); the module's defaults are 0 (version 0.4.0: the rate left the module's parameters for the table of slips).

## In the Rust port (2026-10-17, lane E; risk WM-12)

`utility.water` and `utility.energy` are ported to `offices/utilities.rs` (manifests keep versions 0.3.0 and 0.4.0).

- **A successor carries on from the file.** Each bill carries the round it belongs to (`round`: the date the round fell due), so the next round is that date plus the rhythm (or the standing order's start plus the rhythm, if the order is newer) and a home or customer already billed in a round is not billed again. A water bill carries the meter reading it was billed at (`read_litres`); each batch of meters the reader brings back is entered in the corporation's own `meter_round` (to itself alone), so a new reader goes only to the homes not read since the round began; an energy bill carries the day billed to (`until`). Whether restrictions stand is the latest of the corporation's own restriction notices. Orders to the grid not yet delivered are the retailer's own `order` papers without a delivery note. Bills now fall on the round's date, not drifting by the lateness of the wake.
- **Each publishes its tariff** (`utility_tariff`, public): the unit price, the standing charge and how often it bills. Republished when the figures change.
- **Use responds, in the utility's own reckoning.** `price_elasticity_bps` with `reference_price_*`: use falls by that share of each 100% the price stands over the reference (Dalhuisen, de Groot, Nijkamp 2003, a meta-analysis of residential water demand price elasticities, mean about -0.4 (to confirm); Espey et al. 1997). `restriction_cut_bps`: while restrictions stand with a cut, the daily draw is cut by that share, except once each `restriction_review_days` when it draws the usual amount to see whether the river can give it (Melbourne's 2007-09 restrictions cut use by a fifth or more: to confirm). Defaults are no response: a profile gives its figures with their source. **Still not:** the households' own use (a meter that rises with those in the home) does not respond; citizens do not read the tariff or the notice; no disconnection or hardship programme; who pays the water bill is still the owner, not law data.
- **The retailer's answer to a wrong bill has a cause** (risk PB-16): where its own books show it billed more than was right it puts it right (an energy retailer must refund an overcharge it has found: National Energy Retail Rules; Ofgem standards of conduct; to confirm); the coin at `respond.grant_bps` remains for matters where the books are silent.
- New paper kinds written: `utility_tariff` and `meter_round` (they need a type in papers/offices.rs).

## Sources the Rust utilities cite (moved from the code, which names no place)

- Restrictions on water use: Melbourne's 2007-09 stage 3 and 3a restrictions saw use fall by a fifth or more (Water
  Services Association of Australia; Melbourne Water reports; to confirm).
- A retailer refunds an overcharge it has found: Australia, National Energy Retail Rules r.21; UK, Ofgem standards of
  conduct (to confirm; PS-2).
