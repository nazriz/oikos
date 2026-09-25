//! Read-only questions about the world that the laws depend on.

use crate::blocks::{AgreementTerms, ParcelScope, RentCapScope, RightKind, Rule, StructureCategory, ALL_CATEGORIES};
use crate::canon::MAX_SAFE;
use crate::config::{Config, Seat, StructureType};
use crate::rng::Randomness;
use crate::state::{AgreementStatus, RuleRec, State};
use std::collections::{BTreeMap, BTreeSet};

/// Seconds in the rent-cap normalisation period (30 days).
pub const RENT_CAP_PERIOD: i128 = 2_592_000;

/// Facts fixed for the whole run, derived from the config.
#[derive(Debug, Clone)]
pub struct Statics {
    pub config: Config,
    pub types: BTreeMap<String, StructureType>,
    /// Entity id -> parcels it has jurisdiction over.
    pub jurisdictions: BTreeMap<String, BTreeSet<String>>,
    pub seats: BTreeMap<String, Seat>,
    pub boundary: String,
    pub tick: i64,
    pub randomness: Randomness,
}

impl Statics {
    /// A duration rounded up to whole ticks.
    pub fn span(&self, d: i64) -> i64 {
        (d + self.tick - 1) / self.tick * self.tick
    }

    /// End of the run, rounded up to a whole tick.
    pub fn run_end(&self) -> i64 {
        self.span(self.config.clock.run_seconds)
    }
}

/// Can a seat whose principal is `principal` act for `entity`? True when both
/// are active and `entity` is the principal or is (transitively) controlled by it.
pub fn can_act_for(st: &State, principal: &str, entity: &str) -> bool {
    let (Some(p), Some(_)) = (st.entities.get(principal), st.entities.get(entity)) else {
        return false;
    };
    if !p.active {
        return false;
    }
    let mut cur = entity;
    for _ in 0..=st.entities.len() {
        let Some(e) = st.entities.get(cur) else { return false };
        if !e.active {
            return false;
        }
        if cur == principal {
            return true;
        }
        match &e.controller {
            Some(c) => cur = c,
            None => return false,
        }
    }
    false
}

/// Active entities a seat with this principal can act for, in id order.
pub fn actable_set(st: &State, principal: &str) -> BTreeSet<String> {
    st.entities.keys().filter(|e| can_act_for(st, principal, e)).cloned().collect()
}

pub fn rule_covers(s: &Statics, rec: &RuleRec, parcel: &str) -> bool {
    match rec.rule.parcels() {
        ParcelScope::All(_) => s.jurisdictions.get(&rec.jurisdiction).is_some_and(|j| j.contains(parcel)),
        ParcelScope::List(l) => l.iter().any(|p| p == parcel),
    }
}

/// Categories that may be built on a parcel: the most recently enacted zoning
/// rule covering it decides; with no zoning rule, building is unrestricted.
pub fn zoning_allows(s: &Statics, st: &State, parcel: &str) -> Vec<StructureCategory> {
    st.rules
        .values()
        .filter(|r| matches!(r.rule, Rule::Zoning { .. }) && rule_covers(s, r, parcel))
        .max_by_key(|r| r.order)
        .map(|r| match &r.rule {
            Rule::Zoning { allow, .. } => {
                let set: BTreeSet<StructureCategory> = allow.iter().copied().collect();
                set.into_iter().collect()
            }
            Rule::RentCap { .. } => unreachable!(),
        })
        .unwrap_or_else(|| ALL_CATEGORIES.to_vec())
}

/// The lowest applicable rent cap (per unit per 30 days) on a parcel.
/// `payments_only` restricts to caps that also clip existing leases.
pub fn rent_cap(s: &Statics, st: &State, parcel: &str, payments_only: bool) -> Option<i64> {
    st.rules
        .values()
        .filter(|r| rule_covers(s, r, parcel))
        .filter_map(|r| match &r.rule {
            Rule::RentCap { max_per_30d, applies_to, .. } => {
                (!payments_only || *applies_to == RentCapScope::AllPayments).then_some(*max_per_30d)
            }
            Rule::Zoning { .. } => None,
        })
        .min()
}

/// Is `rent` for `units` over `period` seconds within the per-unit 30-day cap?
pub fn within_rent_cap(rent: i64, units: u32, period: i64, cap: i64) -> bool {
    (rent as i128) * RENT_CAP_PERIOD <= (cap as i128) * (period as i128) * (units as i128)
}

/// The most a lease may charge for one period under a cap (floored).
pub fn capped_rent(units: u32, period: i64, cap: i64) -> i64 {
    let max = (cap as i128) * (period as i128) * (units as i128) / RENT_CAP_PERIOD;
    max.min(MAX_SAFE as i128) as i64
}

/// Units currently let on a parcel under active or ending leases.
pub fn leased_units(st: &State, parcel: &str) -> u64 {
    st.agreements
        .values()
        .filter(|a| matches!(a.status, AgreementStatus::Active | AgreementStatus::Ending))
        .filter_map(|a| match &a.terms {
            AgreementTerms::Lease { parcel: p, units, .. } if p == parcel => Some(*units as u64),
            _ => None,
        })
        .sum()
}

/// The surface right on a parcel held (non-derived) by `holder`, if any.
pub fn holds_surface(st: &State, parcel: &str, holder: &str) -> bool {
    st.rights.values().any(|r| r.parcel == parcel && r.kind == RightKind::Surface && r.holder == holder && r.grantor.is_none())
}
