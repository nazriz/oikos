//! The world's edge (docs/behaviour/boundary.md): the outside world's offices and markets, which stand for the
//! simulation's boundary conditions. Ported from participants/src/behaviour/world.ts (agent C2 ports the rest).

pub mod weather;

/// Every boundary kind (the frame's weather; lane C2's outside world and environment), in name order.
pub static KINDS: &[&dyn crate::Kind] = &[&weather::Weather];
