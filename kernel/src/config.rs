//! World config, mirroring contracts/world-config.schema.json, plus the
//! semantic checks JSON Schema can't express (unique ids, references resolve,
//! one boundary entity, no overlapping parcels, no control cycles, ...).

use crate::blocks::{AgreementTerms, Id, ParcelScope, RightKind, Rule, StructureCategory, BLOCK_NAMES};
use crate::canon;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const CONTRACTS_VERSION: &str = "0.1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub contracts: String,
    pub meta: Meta,
    pub seed: u64,
    pub clock: Clock,
    pub log: LogParams,
    pub catalogue: Catalogue,
    pub world: World,
    pub seats: Vec<Seat>,
    pub caps: Caps,
    /// Enforced by the orchestrator; the kernel only records it.
    pub orchestration: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Meta {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub canary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Clock {
    pub tick_seconds: i64,
    pub run_seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogParams {
    pub checkpoint_every: i64,
    pub anchor_every_entries: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalogue {
    pub structure_types: Vec<StructureType>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructureType {
    pub id: Id,
    pub category: StructureCategory,
    pub cost: i64,
    pub build_time: i64,
    pub demolish_cost: i64,
    pub units: u32,
    pub jobs: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct World {
    pub boundary: Id,
    pub parcels: Vec<ParcelCfg>,
    pub entities: Vec<EntityCfg>,
    pub jurisdictions: Vec<JurisdictionCfg>,
    pub rights: Vec<RightCfg>,
    pub structures: Vec<StructureCfg>,
    pub rules: Vec<RuleCfg>,
    pub agreements: Vec<AgreementCfg>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParcelCfg {
    pub id: Id,
    pub x: i64,
    pub y: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    Person,
    Government,
    Council,
    Agency,
    Firm,
    Trust,
    Union,
    Club,
    Cooperative,
    Boundary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntityCfg {
    pub id: Id,
    pub kind: EntityKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controller: Option<Id>,
    pub balance: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JurisdictionCfg {
    pub entity: Id,
    pub parcels: ParcelScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RightCfg {
    pub id: Id,
    pub parcel: Id,
    pub kind: RightKind,
    pub holder: Id,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructureCfg {
    pub id: Id,
    pub parcel: Id,
    #[serde(rename = "type")]
    pub structure_type: Id,
    pub owner: Id,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuleCfg {
    pub id: Id,
    pub jurisdiction: Id,
    pub rule: Rule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgreementCfg {
    pub id: Id,
    pub terms: AgreementTerms,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Seat {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub principal: Id,
    pub mandate: Mandate,
    pub channels: Vec<Channel>,
    /// Opaque to the kernel.
    pub controller: Value,
    /// Opaque to the kernel.
    pub framing: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mandate {
    pub powers: Vec<Power>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Direct,
    Approval,
    Request,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Power {
    pub blocks: Vec<String>,
    pub level: Level,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approvers: Option<Vec<Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_to: Option<Vec<Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<Limits>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_amount: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelKind {
    Accounts,
    Parcels,
    Rules,
    Agreements,
    Directory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    #[serde(rename = "self")]
    Own,
    Jurisdiction,
    All,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Channel {
    pub id: Id,
    pub kind: ChannelKind,
    pub scope: Scope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Caps {
    pub max_created_entities: u64,
}

/// A config the kernel has parsed and checked. `canonical` is the exact JSON
/// embedded in the log header; `hash` is its config hash.
#[derive(Debug, Clone)]
pub struct LoadedConfig {
    pub config: Config,
    pub canonical: Value,
    pub hash: String,
}

pub fn load(v: Value) -> Result<LoadedConfig, String> {
    canon::check_integers(&v).map_err(|e| e.to_string())?;
    crate::contracts::check(&crate::contracts::contracts().config, &v).map_err(|e| format!("config {e}"))?;
    let config: Config = serde_json::from_value(v.clone()).map_err(|e| format!("config does not match contract: {e}"))?;
    validate(&config)?;
    let hash = canon::hash_with_domain(canon::DOMAIN_CONFIG, &canon::canonical_value(&v).map_err(|e| e.to_string())?);
    Ok(LoadedConfig { config, canonical: v, hash })
}

fn is_config_id(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_lowercase()
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_' || *c == b'-')
}

/// Semantic validation beyond the JSON Schema.
pub fn validate(c: &Config) -> Result<(), String> {
    if c.contracts != CONTRACTS_VERSION {
        return Err(format!("contracts version {} is not {}", c.contracts, CONTRACTS_VERSION));
    }
    if c.clock.tick_seconds < 1 || c.clock.run_seconds < 1 || c.log.checkpoint_every < 1 || c.log.anchor_every_entries < 1 {
        return Err("clock and log parameters must be positive".into());
    }
    if c.seed > canon::MAX_SAFE as u64 {
        return Err("seed must be <= 2^53-1".into());
    }

    // Ids are unique across every kind.
    let mut ids: BTreeSet<String> = BTreeSet::new();
    let mut claim = |id: &str, what: &str| -> Result<(), String> {
        if !is_config_id(id) {
            return Err(format!("{what} id {id:?} is not a valid config id"));
        }
        if !ids.insert(id.to_string()) {
            return Err(format!("duplicate id {id:?}"));
        }
        Ok(())
    };
    let w = &c.world;
    for p in &w.parcels {
        claim(&p.id, "parcel")?;
    }
    for e in &w.entities {
        claim(&e.id, "entity")?;
    }
    for r in &w.rights {
        claim(&r.id, "right")?;
    }
    for s in &w.structures {
        claim(&s.id, "structure")?;
    }
    for r in &w.rules {
        claim(&r.id, "rule")?;
    }
    for a in &w.agreements {
        claim(&a.id, "agreement")?;
    }
    for s in &c.seats {
        claim(&s.id, "seat")?;
    }
    let mut types = BTreeMap::new();
    for t in &c.catalogue.structure_types {
        if !is_config_id(&t.id) || types.insert(t.id.as_str(), t).is_some() {
            return Err(format!("bad or duplicate structure type {:?}", t.id));
        }
        if t.cost < 1 || t.build_time < 1 || t.demolish_cost < 1 {
            return Err(format!("structure type {} needs positive cost, build_time, demolish_cost", t.id));
        }
    }

    let entities: BTreeMap<&str, &EntityCfg> = w.entities.iter().map(|e| (e.id.as_str(), e)).collect();
    let parcels: BTreeMap<&str, &ParcelCfg> = w.parcels.iter().map(|p| (p.id.as_str(), p)).collect();
    let seats: BTreeSet<&str> = c.seats.iter().map(|s| s.id.as_str()).collect();
    let entity = |id: &str| entities.get(id).copied().ok_or_else(|| format!("unknown entity {id:?}"));
    let parcel = |id: &str| parcels.get(id).copied().ok_or_else(|| format!("unknown parcel {id:?}"));

    // Money.
    let boundaries: Vec<&EntityCfg> = w.entities.iter().filter(|e| e.kind == EntityKind::Boundary).collect();
    if boundaries.len() != 1 || boundaries[0].id != w.boundary {
        return Err("exactly one entity of kind boundary is required, and world.boundary must name it".into());
    }
    let mut total: i128 = 0;
    for e in &w.entities {
        if e.kind != EntityKind::Boundary && e.balance < 0 {
            return Err(format!("entity {} has a negative opening balance", e.id));
        }
        if e.balance.abs() > canon::MAX_SAFE {
            return Err(format!("entity {} balance out of range", e.id));
        }
        total += e.balance as i128;
    }
    if total.abs() > canon::MAX_SAFE as i128 {
        return Err("total money out of range".into());
    }

    // Control has no cycles and points at real entities.
    for e in &w.entities {
        let mut seen = BTreeSet::new();
        let mut cur = e;
        while let Some(ctrl) = &cur.controller {
            if !seen.insert(cur.id.as_str()) {
                return Err(format!("control cycle through {}", e.id));
            }
            cur = entity(ctrl)?;
        }
    }

    // Land: parcels don't overlap.
    let rects: Vec<(i64, i64, i64, i64, &str)> =
        w.parcels.iter().map(|p| (p.x, p.y, p.x + p.w.unwrap_or(1), p.y + p.h.unwrap_or(1), p.id.as_str())).collect();
    for p in &w.parcels {
        if p.w.unwrap_or(1) < 1 || p.h.unwrap_or(1) < 1 {
            return Err(format!("parcel {} has non-positive size", p.id));
        }
    }
    let mut sorted = rects.clone();
    sorted.sort();
    for (i, a) in sorted.iter().enumerate() {
        for b in &sorted[i + 1..] {
            if b.0 >= a.2 {
                break;
            }
            if a.0 < b.2 && b.0 < a.2 && a.1 < b.3 && b.1 < a.3 {
                return Err(format!("parcels {} and {} overlap", a.4, b.4));
            }
        }
    }

    let check_scope = |s: &ParcelScope| -> Result<(), String> {
        if let ParcelScope::List(l) = s {
            for p in l {
                parcel(p)?;
            }
        }
        Ok(())
    };
    let mut juris = BTreeSet::new();
    for j in &w.jurisdictions {
        entity(&j.entity)?;
        check_scope(&j.parcels)?;
        if !juris.insert(j.entity.as_str()) {
            return Err(format!("entity {} has more than one jurisdiction entry", j.entity));
        }
    }
    for r in &w.rights {
        parcel(&r.parcel)?;
        entity(&r.holder)?;
        if r.kind == RightKind::Surface && w.rights.iter().any(|o| o.id != r.id && o.parcel == r.parcel && o.kind == RightKind::Surface) {
            return Err(format!("parcel {} has more than one surface right", r.parcel));
        }
    }
    let mut occupied = BTreeSet::new();
    for s in &w.structures {
        parcel(&s.parcel)?;
        entity(&s.owner)?;
        if !types.contains_key(s.structure_type.as_str()) {
            return Err(format!("structure {} has unknown type {}", s.structure_type, s.id));
        }
        if !occupied.insert(s.parcel.as_str()) {
            return Err(format!("parcel {} has more than one structure", s.parcel));
        }
    }
    for r in &w.rules {
        entity(&r.jurisdiction)?;
        if !juris.contains(r.jurisdiction.as_str()) {
            return Err(format!("rule {} issued by {} which has no jurisdiction", r.id, r.jurisdiction));
        }
        check_scope(r.rule.parcels())?;
    }
    for a in &w.agreements {
        let [p1, p2] = a.terms.parties();
        entity(p1)?;
        entity(p2)?;
        if p1 == p2 {
            return Err(format!("agreement {} has the same party twice", a.id));
        }
        if a.terms.amount() < 1 || a.terms.period() < 1 || a.terms.notice() < 1 || a.terms.term().is_some_and(|t| t < 1) {
            return Err(format!("agreement {} needs positive amount, period, notice and term", a.id));
        }
        match &a.terms {
            AgreementTerms::Lease { parcel: p, lessor, units, .. } => {
                parcel(p)?;
                if !w.rights.iter().any(|r| r.parcel == *p && r.kind == RightKind::Surface && r.holder == *lessor) {
                    return Err(format!("lease {}: lessor does not hold the surface right on {p}", a.id));
                }
                let s = w.structures.iter().find(|s| s.parcel == *p).ok_or_else(|| format!("lease {}: no structure on {p}", a.id))?;
                let leased: u64 = w
                    .agreements
                    .iter()
                    .filter_map(|o| match &o.terms {
                        AgreementTerms::Lease { parcel: op, units: u, .. } if op == p => Some(*u as u64),
                        _ => None,
                    })
                    .sum();
                if *units < 1 || leased > types[s.structure_type.as_str()].units as u64 {
                    return Err(format!("leases on {p} exceed the structure's capacity"));
                }
            }
            AgreementTerms::Employment { workplace, .. } => {
                if let Some(p) = workplace {
                    parcel(p)?;
                }
            }
        }
    }
    for s in &c.seats {
        entity(&s.principal)?;
        let mut chans = BTreeSet::new();
        for ch in &s.channels {
            if !chans.insert(ch.id.as_str()) {
                return Err(format!("seat {} has duplicate channel {}", s.id, ch.id));
            }
        }
        for p in &s.mandate.powers {
            for b in &p.blocks {
                if !BLOCK_NAMES.contains(&b.as_str()) {
                    return Err(format!("seat {}: unknown block {b} in mandate", s.id));
                }
            }
            let targets = match p.level {
                Level::Direct => {
                    if p.approvers.is_some() || p.request_to.is_some() {
                        return Err(format!("seat {}: direct power names approvers or request targets", s.id));
                    }
                    vec![]
                }
                Level::Approval => p
                    .approvers
                    .clone()
                    .filter(|v| !v.is_empty())
                    .ok_or_else(|| format!("seat {}: approval power without approvers", s.id))?,
                Level::Request => p
                    .request_to
                    .clone()
                    .filter(|v| !v.is_empty())
                    .ok_or_else(|| format!("seat {}: request power without request_to", s.id))?,
            };
            for t in &targets {
                if !seats.contains(t.as_str()) {
                    return Err(format!("seat {}: mandate names unknown seat {t}", s.id));
                }
                if t == &s.id {
                    return Err(format!("seat {} cannot approve or receive its own requests", s.id));
                }
            }
        }
    }
    Ok(())
}
