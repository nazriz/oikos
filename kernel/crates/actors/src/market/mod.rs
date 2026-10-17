//! Lane C2's actors (retailer.ts, producer.ts, trade.ts, lengnick.ts (world.ts and environment.ts are in `boundary`); docs/port-guide.md, section 8). Each kind in a module of its own here, listed in
//! `KINDS` (the registry reads it: no lane edits another's list).

use crate::Kind;

/// Every kind of this lane, in name order.
pub static KINDS: &[&dyn Kind] = &[];
