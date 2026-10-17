//! Lane E's actors (government.ts, institutions.ts, police.ts, tribunal.ts, desk.ts, school.ts, elections.ts, utilities.ts, books.ts; docs/port-guide.md, section 8). Each kind in a module of its own here, listed in
//! `KINDS` (the registry reads it: no lane edits another's list).

use crate::Kind;

pub mod hearing;
pub mod land;
pub mod staff;
pub mod books;
pub mod builder;
pub mod council;
pub mod desk;
pub mod elections;
pub mod planning;
pub mod police;
pub mod registry;
pub mod school;
pub mod treasury;
pub mod tribunal;
pub mod utilities;

/// Every kind of this lane, in name order.
pub static KINDS: &[&dyn Kind] = &[
    &registry::ChildProtection,
    &council::CouncilClerk,
    &council::Councillor,
    &elections::ElectoralOffice,
    &treasury::FinanceOfficer,
    &planning::Inspector,
    &council::MayorCode,
    &planning::PlanningOfficer,
    &treasury::RatesOfficer,
    &registry::CityRegistry,
    &treasury::TaxClerk,
    &treasury::Works,
    &builder::Builder,
    &registry::LandRegistry,
    &books::Clerk,
    &desk::Desk,
    &police::Station,
    &school::Principal,
    &tribunal::Member,
    &tribunal::Registrar,
    &utilities::Energy,
    &utilities::Water,
];

/// Where in its first hour an office first wakes: `base` seconds plus a spread of up to `span` that depends only on who
/// the participant is (TS drew `ctx.rng("first-wake")`; `Kind::first_wake` has no stream to draw from, and an office's
/// first wake needs spreading only so that they do not all act at the same second). FNV-1a of the participant's id.
pub fn spread(ctx: &crate::Ctx, base: i64, span: i64) -> i64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in ctx.participant.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    base + if span > 0 { (h % span as u64) as i64 } else { 0 }
}
