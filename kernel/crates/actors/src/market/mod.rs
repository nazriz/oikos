//! Lane C2's actors (retailer.ts, producer.ts, trade.ts, lengnick.ts; world.ts and environment.ts are in `boundary`;
//! docs/port-guide.md, section 8). Each kind in a module of its own here, listed in `KINDS` (the registry reads it: no
//! lane edits another's list).
//!
//! What the lane builds natively rather than ports (docs/risks.md ME-14, ME-15, ME-16): prices formed from supply and
//! demand, costs and rivals' prices as each seller can know them (`prices`), exports that follow what the outside
//! world will buy (`boundary::trade`), and the market evidence a landlord reads at a rent review (`rents`).

use crate::Kind;

pub mod lengnick;
pub mod prices;
pub mod rents;
pub mod trade;
#[cfg(test)]
pub mod testkit;

/// Every kind of this lane, in name order.
pub static KINDS: &[&dyn Kind] = &[];
