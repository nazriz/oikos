//! Lane C1's actors (firms.ts, payroll.ts, returns.ts, tax.ts, payments.ts, orgwants.ts, practice.ts; docs/port-guide.md, section 8). Each kind in a module of its own here, listed in
//! `KINDS` (the registry reads it: no lane edits another's list).

use crate::Kind;

/// Every kind of this lane, in name order.
pub static KINDS: &[&dyn Kind] = &[];
