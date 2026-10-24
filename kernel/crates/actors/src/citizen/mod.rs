//! The citizen (lane A1: citizen.ts's life, household.ts, health.ts; docs/port-guide.md, section 8). The seam between
//! its life and its mind (lane A2) is `mind`. The person is `person`; the week's plan is `plan`, its parts in
//! `housing`, `work`, `money`, `lifecycle` and `recourse`; what is taken in at every wake is `absorb`.

pub mod absorb;
pub mod health;
pub mod household;
pub mod housing;
pub mod lifecycle;
pub mod memory;
pub mod mind;
pub mod money;
pub mod params;
pub mod person;
pub mod plan;
pub mod recourse;
pub mod work;

/// Every citizen kind (A1's), in name order.
pub static KINDS: &[&dyn crate::Kind] = &[&person::Citizen, &health::Practice];
