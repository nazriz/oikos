//! World config, mirroring contracts/world-config.schema.json (v0.2), plus
//! the semantic checks JSON Schema can't express: unique ids, references
//! resolve, one boundary, parcels don't overlap, occupancy within capacity.
//! None of these checks is law; they keep the world's physical description
//! coherent.

use crate::blocks::{Id, Record, RecordBody, GENESIS};
use crate::canon;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const CONTRACTS_VERSION: &str = "0.3";

/// Entity kinds with physical meaning. Every other kind is the world's vocabulary.
pub const PERSON: &str = "person";
pub const BOUNDARY: &str = "boundary";

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
    pub category: String,
    pub materials_cost: i64,
    pub build_time: i64,
    pub demolition_cost: i64,
    pub capacity: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct World {
    pub boundary: Id,
    pub parcels: Vec<ParcelCfg>,
    pub entities: Vec<EntityCfg>,
    pub accounts: Vec<AccountCfg>,
    pub structures: Vec<StructureCfg>,
    pub occupancy: Vec<OccupancyCfg>,
    pub records: Vec<Record>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntityCfg {
    pub id: Id,
    pub kind: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountCfg {
    pub id: Id,
    pub holder: Id,
    pub custodian: Id,
    pub balance: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructureCfg {
    pub id: Id,
    pub parcel: Id,
    #[serde(rename = "type")]
    pub structure_type: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub built_by: Option<Id>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OccupancyCfg {
    pub occupant: Id,
    pub structure: Id,
    pub slot: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Seat {
    pub id: Id,
    pub entity: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub channels: Vec<Channel>,
    /// Opaque to the kernel.
    pub controller: Value,
    /// Opaque to the kernel.
    pub framing: Value,
    /// What happens after an opt-out: absent or "vacant" means the seat never acts again;
    /// a code stand-in means acts continue (the orchestrator runs the stand-in).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_opt_out: Option<Value>,
}

impl Seat {
    /// Whether the seat stays silent after its controller opts out.
    pub fn vacant_after_opt_out(&self) -> bool {
        !matches!(&self.on_opt_out, Some(Value::Object(_)))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChannelKind {
    Accounts,
    Records {
        #[serde(rename = "match")]
        filter: RecordFilter,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        new_only: Option<bool>,
    },
    Sites {
        area: Area,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        every: Option<i64>,
    },
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Channel {
    pub id: Id,
    /// Presentation only (what a seat's reports call the channel).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(flatten)]
    pub kind: ChannelKind,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordFilter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub records: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statement_kinds: Option<Vec<String>>,
    /// Entity ids, or "self" for the seat's own entity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub involving: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Area {
    All(AllMarker),
    Parcels(Vec<Id>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AllMarker {
    All,
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
    let w = &c.world;

    // Ids are unique across every kind.
    let mut ids: BTreeSet<String> = BTreeSet::new();
    let mut claim = |id: &str, what: &str| -> Result<(), String> {
        if !ids.insert(id.to_string()) {
            return Err(format!("duplicate id {id:?} ({what})"));
        }
        Ok(())
    };
    for p in &w.parcels {
        claim(&p.id, "parcel")?;
    }
    for e in &w.entities {
        claim(&e.id, "entity")?;
    }
    for a in &w.accounts {
        claim(&a.id, "account")?;
    }
    for s in &w.structures {
        claim(&s.id, "structure")?;
    }
    for r in &w.records {
        claim(&r.id, "record")?;
    }
    for s in &c.seats {
        claim(&s.id, "seat")?;
    }
    let mut types = BTreeMap::new();
    for t in &c.catalogue.structure_types {
        if types.insert(t.id.as_str(), t).is_some() {
            return Err(format!("duplicate structure type {:?}", t.id));
        }
    }

    let entities: BTreeMap<&str, &EntityCfg> = w.entities.iter().map(|e| (e.id.as_str(), e)).collect();
    let parcels: BTreeSet<&str> = w.parcels.iter().map(|p| p.id.as_str()).collect();
    let seats: BTreeSet<&str> = c.seats.iter().map(|s| s.id.as_str()).collect();
    let records: BTreeMap<&str, &Record> = w.records.iter().map(|r| (r.id.as_str(), r)).collect();
    let entity = |id: &str| entities.get(id).copied().ok_or_else(|| format!("unknown entity {id:?}"));

    // The boundary.
    let boundaries: Vec<&EntityCfg> = w.entities.iter().filter(|e| e.kind == BOUNDARY).collect();
    if boundaries.len() != 1 || boundaries[0].id != w.boundary {
        return Err("exactly one entity of kind boundary is required, and world.boundary must name it".into());
    }
    if !w.accounts.iter().any(|a| a.holder == w.boundary && a.custodian == w.boundary) {
        return Err("the boundary needs an account it holds in its own custody".into());
    }

    // Money.
    let mut total: i128 = 0;
    for a in &w.accounts {
        entity(&a.holder)?;
        entity(&a.custodian)?;
        if a.holder != w.boundary && a.balance < 0 {
            return Err(format!("account {} has a negative opening balance", a.id));
        }
        if a.balance.abs() > canon::MAX_SAFE {
            return Err(format!("account {} balance out of range", a.id));
        }
        total += a.balance as i128;
    }
    if total.abs() > canon::MAX_SAFE as i128 {
        return Err("total money out of range".into());
    }

    // Land: parcels don't overlap.
    let mut rects: Vec<(i64, i64, i64, i64, &str)> = vec![];
    for p in &w.parcels {
        let (pw, ph) = (p.w.unwrap_or(1), p.h.unwrap_or(1));
        if pw < 1 || ph < 1 {
            return Err(format!("parcel {} has non-positive size", p.id));
        }
        rects.push((p.x, p.y, p.x + pw, p.y + ph, p.id.as_str()));
    }
    rects.sort();
    for (i, a) in rects.iter().enumerate() {
        for b in &rects[i + 1..] {
            if b.0 >= a.2 {
                break;
            }
            if a.1 < b.3 && b.1 < a.3 {
                return Err(format!("parcels {} and {} overlap", a.4, b.4));
            }
        }
    }

    // Structures: one per parcel, of a known type.
    let mut occupied = BTreeSet::new();
    let mut structures = BTreeMap::new();
    for s in &w.structures {
        if !parcels.contains(s.parcel.as_str()) {
            return Err(format!("structure {} is on unknown parcel {}", s.id, s.parcel));
        }
        let ty = types.get(s.structure_type.as_str()).ok_or_else(|| format!("structure {} has unknown type {}", s.id, s.structure_type))?;
        if let Some(b) = &s.built_by {
            entity(b)?;
        }
        if !occupied.insert(s.parcel.as_str()) {
            return Err(format!("parcel {} has more than one structure", s.parcel));
        }
        structures.insert(s.id.as_str(), *ty);
    }

    // Occupancy within physical capacity.
    let mut used: BTreeMap<(&str, &str), u64> = BTreeMap::new();
    let mut seen_occupant = BTreeSet::new();
    for o in &w.occupancy {
        entity(&o.occupant)?;
        let ty = structures.get(o.structure.as_str()).ok_or_else(|| format!("occupancy names unknown structure {}", o.structure))?;
        let cap = *ty.capacity.get(&o.slot).ok_or_else(|| format!("structure {} has no {} slots", o.structure, o.slot))? as u64;
        if !seen_occupant.insert((o.occupant.as_str(), o.structure.as_str(), o.slot.as_str())) {
            return Err(format!("{} occupies {} slots in {} twice", o.occupant, o.slot, o.structure));
        }
        let u = used.entry((o.structure.as_str(), o.slot.as_str())).or_default();
        *u += o.count as u64;
        if *u > cap {
            return Err(format!("structure {} is over its {} capacity", o.structure, o.slot));
        }
    }

    // Records: authors exist, and everything they reference exists.
    for r in &w.records {
        if r.author != GENESIS && !seats.contains(r.author.as_str()) {
            return Err(format!("record {} has unknown author {}", r.id, r.author));
        }
        for e in r.entities_named().into_iter().chain(r.visibility_entities()) {
            entity(e).map_err(|x| format!("record {}: {x}", r.id))?;
        }
        for other in r.body.records_referenced().into_iter().chain(r.basis.as_deref()) {
            if !records.contains_key(other) {
                return Err(format!("record {} references unknown record {other}", r.id));
            }
        }
        let want = match &r.body {
            RecordBody::ClaimTransfer { claim, .. } | RecordBody::ClaimRelease { claim } => Some((claim, "claim")),
            RecordBody::Signature { agreement, .. } | RecordBody::Notice { agreement, .. } => Some((agreement, "agreement")),
            RecordBody::Vote { ballot, .. } => Some((ballot, "statement")),
            _ => None,
        };
        if let Some((other, kind)) = want {
            if records[other.as_str()].body.kind_name() != kind {
                return Err(format!("record {} must reference a {kind}, but {other} is not one", r.id));
            }
        }
        if r.at != 0 {
            return Err(format!("record {} in the initial world must be at t=0", r.id));
        }
    }

    // Seats and their channels.
    for s in &c.seats {
        entity(&s.entity)?;
        let mut chans = BTreeSet::new();
        for ch in &s.channels {
            if !chans.insert(ch.id.as_str()) {
                return Err(format!("seat {} has duplicate channel {}", s.id, ch.id));
            }
            match &ch.kind {
                ChannelKind::Records { filter, .. } => {
                    for e in filter.involving.iter().flatten().filter(|e| *e != "self") {
                        entity(e).map_err(|x| format!("seat {} channel {}: {x}", s.id, ch.id))?;
                    }
                }
                ChannelKind::Sites { area: Area::Parcels(ps), .. } => {
                    for p in ps {
                        if !parcels.contains(p.as_str()) {
                            return Err(format!("seat {} channel {} names unknown parcel {p}", s.id, ch.id));
                        }
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}
