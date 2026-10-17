//! The citizen (lane A1: citizen.ts's life, household.ts, health.ts; docs/port-guide.md, section 8). The seam between
//! its life and its mind (lane A2) is `mind`.

pub mod mind;

/// Every citizen kind (A1's), in name order.
pub static KINDS: &[&dyn crate::Kind] = &[];
