//! Lane C1's actors (firms.ts, payroll.ts, returns.ts, tax.ts, payments.ts, orgwants.ts, practice.ts; docs/port-guide.md, section 8). Each kind in a module of its own here, listed in
//! `KINDS` (the registry reads it: no lane edits another's list).

pub mod bargaining;
pub mod employer;
pub mod orgwants;
pub mod payments;
pub mod payroll;
pub mod practice;
pub mod returns;
pub mod staffing;
pub mod tax;
pub mod winding;
#[cfg(test)]
pub mod testkit;

use crate::Kind;

/// Every kind of this lane, in name order.
pub static KINDS: &[&dyn Kind] = &[&employer::Employer, &payroll::PAYROLL];
