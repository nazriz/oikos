# Floods (world-expansion §7.1)

**Source:** the kernel (`kernel/crates/nature`, fields; `kernel/crates/world/src/exec.rs`, `floods`); citizens
(`citizen.ts`, the relief centre). Contract: world-expansion §7.3 (signed 2026-10-02). Figures: the profile's
`hazards`, with sources.

## The physics (kernel)

- **A river over its banks:** a field's `spills_above` and `spill_bps_per_day`. Each day a share of what's above the
  level on a cell spreads to the four around it.
- **Rain and drought:** a field's `source_by_day` scales its sources from a day of the run on. That's exogenous, as
  weather is: a scenario sets it (the generator's `weather`).
- **Soaking:** a cover's source may be negative (wetland soaks up water).
- **Flooding:** a structure type's `floods` (`field`, `above`, `wear_per_day`). When the field passes the level on any
  of its cells, the building is under water:
  - its occupants are moved out (`vacated`, reason `flooded`), and that wakes them;
  - no one can come in while it lasts (refusal `flooded`);
  - its wear rises by `wear_per_day`.
  
  Below the level again, it has receded (`flood_receded`).

## In the generated town

The river carries water (docs/behaviour/utilities.md), about 9,000 kL a cell in the usual flow. Figures are
placeholders, sized against that:

| | Rule |
|---|---|
| **Banks** | Past 12,000 kL, the river spills 30% of the excess a day. |
| **A building floods** | With 300 kL on its cell, about half a metre of water. |
| **Wetland** | Soaks up 500 kL a cell a day. |
| **The relief centre** | The town hall. Councils run emergency relief centres. |

**Citizens:** flooded out of home (or finding it under water when they try to go back), they go to the relief centre,
and try home again a day on. A flooded workplace or school: they don't go in, and try again when their day next
changes.

**In the small town:** four times the usual rain from day 20 floods three houses and a shop beside the river within
days, and they recede once the rain stops (a test). A building put up on the river itself, against the law, stays under
water.

## Leaves out (for now)

- **Wetland's flood mitigation.** The river spills the same way into any land beside it, so wetland soaking up
  what reaches it doesn't lower the river's peak downstream. Draining the wetland changes nothing here (found). Doing it
  needs a bank by cover, a contract addition.
- Warnings, evacuation orders, insurance, repair, damage to goods; heat.
