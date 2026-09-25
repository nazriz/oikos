# `world.export_demand` (v0.2.0): the outside world as a boundary condition

**Seat:** the outside world (entity of kind `boundary`). **Source:** `seats/src/behaviour/world.ts`.

## What it does

Money enters a world only when the outside world's own seat pays (D31). This module is the simplest such seat. On a researcher-set schedule, it buys from named town accounts, e.g. a factory's exports or tourist spending at shops. Each purchase is an ordinary transfer from the outside world's account (which may go negative) to the seller's account.

## Where the rule comes from

VISION §5: "boundary conditions: the world has an outside, with external markets, prices, demand… The researcher sets these." The town's export base, the classic economic-base view of a local economy (money earned from outside sustains local spending), is here reduced to researcher-set demand.

## Parameters

`purchases`: a list of `{ to, amount, every, memo? }`. For example, `{ "to": "acc-factory", "amount": 50000000, "every": 2592000 }` means the outside world buys $500,000 of the factory's output every 30 days.

## Leaves out

- Prices responding to quantity.
- Imports, beyond what construction materials already pay to the outside.
- Migration.
- Shocks: a researcher can script them as another module.
