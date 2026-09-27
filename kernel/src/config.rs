//! World config, mirroring contracts/world-config.schema.json (v0.4), plus
//! the semantic checks JSON Schema can't express: unique ids, references
//! resolve, one boundary, footprints fit the ground and don't overlap,
//! occupancy within capacity, participants and positions coherent. None of
//! these checks is law; they keep the world's physical description coherent.
//!
//! v0.4 (docs/design/v0.4-cast-and-land.md): the cast and the land can change.
//! Bodies (persons) arrive, leave, are born and die; participants (whatever
//! decides: a person's, or a system belonging to an organisation) come and go;
//! positions (an organisation's roles) are created and change hands; the ground
//! is a grid of cells, buildings have footprints and spaces, and lots are records.

use crate::blocks::{Id, Record, RecordBody, GENESIS};
use crate::canon;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const CONTRACTS_VERSION: &str = "0.4";

/// Entity kinds with physical meaning. Every other kind is the world's vocabulary.
pub const PERSON: &str = "person";
pub const BOUNDARY: &str = "boundary";

/// The capacity name for a participant acting, or looking, as itself (its own person).
pub const SELF: &str = "self";

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
    pub participants: Vec<ParticipantCfg>,
    pub positions: Vec<PositionCfg>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub templates: Vec<Template>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub life: Option<Life>,
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
    /// The cells it stands on: `w` by `h`, from the corner cell it's built at.
    pub footprint: Footprint,
    /// Terrain labels it can stand on; absent: any cell with no terrain label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terrains: Option<Vec<String>>,
    /// The spaces inside it that bodies occupy.
    pub spaces: Vec<SpaceSpec>,
    /// Yearly chance (basis points) that someone occupying one of its spaces is injured there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub injury_bps: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Footprint {
    pub w: i64,
    pub h: i64,
}

/// `count` spaces of one kind, each holding at most `capacity` bodies. `kind` and `attrs` are the
/// world's vocabulary (a dwelling with 2 bedrooms): stored and reported, never interpreted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpaceSpec {
    pub kind: String,
    pub count: u32,
    pub capacity: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attrs: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct World {
    pub boundary: Id,
    pub ground: Ground,
    pub entities: Vec<EntityCfg>,
    pub accounts: Vec<AccountCfg>,
    pub structures: Vec<StructureCfg>,
    pub occupancy: Vec<OccupancyCfg>,
    pub records: Vec<Record>,
}

/// The land: a grid of `w` by `h` cells (`cell.<x>.<y>`), each `cell` world units across
/// (presentation only), with optional terrain labels over rectangles.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ground {
    pub w: i64,
    pub h: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub terrain: Vec<TerrainArea>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerrainArea {
    pub label: String,
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

/// A cell's id.
pub fn cell_id(x: i64, y: i64) -> Id {
    format!("cell.{x}.{y}")
}

/// A cell id's coordinates, if it is one.
pub fn cell_xy(id: &str) -> Option<(i64, i64)> {
    let rest = id.strip_prefix("cell.")?;
    let (x, y) = rest.split_once('.')?;
    let ok = |s: &str| !s.is_empty() && s.len() <= 6 && s.bytes().all(|b| b.is_ascii_digit());
    (ok(x) && ok(y)).then(|| (x.parse().ok(), y.parse().ok())).and_then(|(a, b)| Some((a?, b?)))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntityCfg {
    pub id: Id,
    pub kind: String,
    pub name: String,
    /// Persons only: when the body was born (seconds, may be before the run: negative).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub born_at: Option<i64>,
    /// Persons only: in the world (the default) or outside it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub present: Option<bool>,
    /// Persons only: biological parents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parents: Option<Vec<Id>>,
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
    /// The corner cell of its footprint.
    pub at: Id,
    #[serde(rename = "type")]
    pub structure_type: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub built_by: Option<Id>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OccupancyCfg {
    pub occupant: Id,
    pub space: Id,
}

/// A space's id: `<structure>/<kind>.<n>`, numbering each kind from 1 in the type's order.
pub fn space_id(structure: &str, kind: &str, n: u32) -> Id {
    format!("{structure}/{kind}.{n}")
}

/// A space id's structure and its local part (`dwelling.3`).
pub fn split_space(id: &str) -> Option<(&str, &str)> {
    let (s, local) = id.split_once('/')?;
    (!s.is_empty() && local.contains('.')).then_some((s, local))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantKind {
    /// A person's: tied to one body, acts as that person or in positions it holds.
    Person,
    /// A system's: no body; belongs to an organisation; acts only in positions it holds.
    System,
}

/// What a participant is, and how it perceives and is run (the orchestrator reads the controller).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParticipantCfg {
    pub id: Id,
    pub kind: ParticipantKind,
    /// Person participants: the person (a body).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub person: Option<Id>,
    /// System participants: the organisation it belongs to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Personal channels (persons only): what it perceives of its own life.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<Channel>,
    /// Opaque to the kernel.
    pub controller: Value,
    /// Opaque to the kernel.
    pub framing: Value,
    /// What happens after an opt-out: absent or "vacant" means it never acts again (and its positions
    /// fall vacant); a code stand-in means it carries on (the orchestrator runs the stand-in).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_opt_out: Option<Value>,
    /// Its own parameters (a person's disposition), used by the role modules it runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traits: Option<Value>,
}

/// A role through which a participant acts for an organisation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PositionCfg {
    pub id: Id,
    pub entity: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<Channel>,
    /// How a code participant does the job (opaque to the kernel).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_module: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holder: Option<Id>,
}

/// A kind of participant that may come into being during the run (a newcomer, a child, a deployed system).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Template {
    pub id: Id,
    pub kind: ParticipantKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<Channel>,
    pub controller: Value,
    pub framing: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_opt_out: Option<Value>,
    /// Trait values, or `{"uniform": [lo, hi]}` (integers) drawn when the participant is created.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traits: Option<Value>,
}

/// The physics of bodies (docs/design/v0.4-cast-and-land.md §4): all optional.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Life {
    /// Seconds in a year of age.
    pub year: i64,
    /// Yearly chance of death from causes not otherwise modelled, by age.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub other_causes: Option<ByAge>,
    /// Yearly chance of falling ill, by age, and what the illness is like.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub illness: Option<Hazard>,
    /// Yearly chance of an accidental injury anywhere (places add their own), and what it's like.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub injury: Option<Injury>,
    /// What harming someone does, and how near one has to be.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harm: Option<Harm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub birth: Option<BirthPhysics>,
}

/// Steps by age: each `{from, bps}` applies from that age (in years) until the next.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ByAge {
    pub by_age: Vec<AgeStep>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgeStep {
    pub from: u32,
    pub bps: u32,
}

impl ByAge {
    pub fn at(&self, age: i64) -> u32 {
        self.by_age.iter().rev().find(|s| (s.from as i64) <= age).map_or(0, |s| s.bps)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hazard {
    pub by_age: Vec<AgeStep>,
    pub severity: Vec<Severity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Injury {
    pub bps: u32,
    pub severity: Vec<Severity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Harm {
    /// How near (in cells, as for `near`) the one harming must be to the one harmed.
    pub reach: i64,
    pub severity: Vec<Severity>,
}

/// One band of how bad a condition is: its label (the world's vocabulary), its share of cases,
/// how long it lasts (days, drawn uniformly), and its chance of death over that time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Severity {
    pub label: String,
    pub share_bps: u32,
    pub days: [u32; 2],
    pub fatal_bps: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BirthPhysics {
    /// Ages (years) at which a body can bear a child, inclusive.
    pub ages: [u32; 2],
    /// Seconds from conception to birth.
    pub gestation: i64,
    /// How near (in cells) the other parent must be.
    pub reach: i64,
}

impl ParticipantCfg {
    /// Whether it stays silent after its controller opts out.
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
        /// Where the channel looks: only records placed there are seen through it.
        /// Without an area, the channel sees records that aren't placed anywhere.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        area: Option<Area>,
    },
    Sites {
        area: Area,
        /// What can be told about who is in a space the capacity's entity doesn't occupy itself:
        /// how many (the default), or who.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        occupants: Option<Occupants>,
    },
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Channel {
    pub id: Id,
    /// Presentation only (what the participant's reports call the channel).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// How often the participant looks through this channel (seconds). Between looks, changes accumulate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub every: Option<i64>,
    /// Perceived only when the participant asks (a look), never at ordinary observations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_request: Option<bool>,
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
    /// Entity ids, or "self" for the entity of the capacity looking (the person, or a position's organisation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub involving: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Area {
    All(AllMarker),
    Cells(Vec<Id>),
    /// Every cell within this distance of a cell under a building where the capacity's entity occupies a
    /// space (in cells; 0 is those cells and the ones touching them). Moves with it.
    Near(Near),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Near {
    pub near: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Occupants {
    Counts,
    Names,
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

/// The cells a footprint covers from its corner, in order, or None if any falls off the ground.
pub fn footprint_cells(ground: &Ground, at: &str, f: Footprint) -> Option<Vec<Id>> {
    let (x0, y0) = cell_xy(at)?;
    let mut v = vec![];
    for y in y0..y0 + f.h {
        for x in x0..x0 + f.w {
            if x >= ground.w || y >= ground.h {
                return None;
            }
            v.push(cell_id(x, y));
        }
    }
    Some(v)
}

/// The terrain label at a cell (the last area covering it wins).
pub fn terrain_at(ground: &Ground, x: i64, y: i64) -> Option<&str> {
    ground.terrain.iter().rev().find(|a| x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h).map(|a| a.label.as_str())
}

/// Check a set of channels: ids unique, entities and cells they name exist, distances sensible.
pub fn check_channels(owner: &str, channels: &[Channel], entity_exists: &dyn Fn(&str) -> bool, cell_exists: &dyn Fn(&str) -> bool) -> Result<(), String> {
    let mut ids = BTreeSet::new();
    for ch in channels {
        if !ids.insert(ch.id.as_str()) {
            return Err(format!("{owner} has duplicate channel {}", ch.id));
        }
        if ch.id.contains('/') {
            return Err(format!("{owner} channel {}: a channel id can't contain '/'", ch.id));
        }
        if let ChannelKind::Records { filter, .. } = &ch.kind {
            for e in filter.involving.iter().flatten().filter(|e| *e != SELF) {
                if !entity_exists(e) {
                    return Err(format!("{owner} channel {}: unknown entity {e:?}", ch.id));
                }
            }
        }
        let area = match &ch.kind {
            ChannelKind::Records { area, .. } => area.as_ref(),
            ChannelKind::Sites { area, .. } => Some(area),
            _ => None,
        };
        match area {
            Some(Area::Cells(cs)) => {
                for c in cs {
                    if !cell_exists(c) {
                        return Err(format!("{owner} channel {} names unknown cell {c}", ch.id));
                    }
                }
            }
            Some(Area::Near(n)) if n.near < 0 => return Err(format!("{owner} channel {}: near must be 0 or more", ch.id)),
            _ => {}
        }
    }
    Ok(())
}

/// Check a template's traits: values, or `{"uniform": [lo, hi]}` with lo <= hi.
pub fn check_traits(owner: &str, traits: &Option<Value>) -> Result<(), String> {
    let Some(t) = traits else { return Ok(()) };
    let Value::Object(m) = t else { return Err(format!("{owner}: traits must be an object")) };
    for (k, v) in m {
        if let Some(u) = v.as_object().and_then(|o| o.get("uniform")) {
            let ok = u.as_array().is_some_and(|a| a.len() == 2 && a[0].as_i64().zip(a[1].as_i64()).is_some_and(|(lo, hi)| lo <= hi));
            if !ok {
                return Err(format!("{owner}: trait {k}: uniform needs [lo, hi] integers with lo <= hi"));
            }
        }
    }
    Ok(())
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
    if w.ground.w < 1 || w.ground.h < 1 || w.ground.w > 100_000 || w.ground.h > 100_000 {
        return Err("the ground must be 1..=100000 cells each way".into());
    }

    // Ids are unique across every kind.
    let mut ids: BTreeSet<String> = BTreeSet::new();
    let mut claim = |id: &str, what: &str| -> Result<(), String> {
        if id == SELF {
            return Err(format!("{what} id {id:?} is reserved"));
        }
        if !ids.insert(id.to_string()) {
            return Err(format!("duplicate id {id:?} ({what})"));
        }
        Ok(())
    };
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
    for p in &c.participants {
        claim(&p.id, "participant")?;
    }
    for p in &c.positions {
        claim(&p.id, "position")?;
    }
    let mut templates = BTreeSet::new();
    for t in &c.templates {
        if !templates.insert(t.id.as_str()) {
            return Err(format!("duplicate template {:?}", t.id));
        }
    }
    let mut types = BTreeMap::new();
    for t in &c.catalogue.structure_types {
        if types.insert(t.id.as_str(), t).is_some() {
            return Err(format!("duplicate structure type {:?}", t.id));
        }
        if t.footprint.w < 1 || t.footprint.h < 1 {
            return Err(format!("structure type {} has an empty footprint", t.id));
        }
    }

    let entities: BTreeMap<&str, &EntityCfg> = w.entities.iter().map(|e| (e.id.as_str(), e)).collect();
    let participants: BTreeMap<&str, &ParticipantCfg> = c.participants.iter().map(|p| (p.id.as_str(), p)).collect();
    let records: BTreeMap<&str, &Record> = w.records.iter().map(|r| (r.id.as_str(), r)).collect();
    let entity = |id: &str| entities.get(id).copied().ok_or_else(|| format!("unknown entity {id:?}"));
    let cell_exists = |id: &str| cell_xy(id).is_some_and(|(x, y)| x < w.ground.w && y < w.ground.h);

    // The boundary.
    let boundaries: Vec<&EntityCfg> = w.entities.iter().filter(|e| e.kind == BOUNDARY).collect();
    if boundaries.len() != 1 || boundaries[0].id != w.boundary {
        return Err("exactly one entity of kind boundary is required, and world.boundary must name it".into());
    }
    if !w.accounts.iter().any(|a| a.holder == w.boundary && a.custodian == w.boundary) {
        return Err("the boundary needs an account it holds in its own custody".into());
    }

    // Bodies: only persons have them.
    for e in &w.entities {
        if e.kind != PERSON && (e.born_at.is_some() || e.present.is_some() || e.parents.is_some()) {
            return Err(format!("entity {} isn't a person, so it has no body", e.id));
        }
        for p in e.parents.iter().flatten() {
            if entity(p)?.kind != PERSON {
                return Err(format!("{}'s parent {p} isn't a person", e.id));
            }
        }
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

    // Structures: footprints on the ground, on terrain they can stand on, not overlapping.
    let mut covered: BTreeMap<String, &str> = BTreeMap::new();
    let mut structures = BTreeMap::new();
    for s in &w.structures {
        let ty = types.get(s.structure_type.as_str()).ok_or_else(|| format!("structure {} has unknown type {}", s.id, s.structure_type))?;
        if let Some(b) = &s.built_by {
            entity(b)?;
        }
        let cells = footprint_cells(&w.ground, &s.at, ty.footprint).ok_or_else(|| format!("structure {} doesn't fit on the ground at {}", s.id, s.at))?;
        for cell in cells {
            let (x, y) = cell_xy(&cell).unwrap();
            let t = terrain_at(&w.ground, x, y);
            let fits = match &ty.terrains {
                Some(ok) => t.is_some_and(|t| ok.iter().any(|o| o == t)),
                None => t.is_none(),
            };
            if !fits {
                return Err(format!("structure {} can't stand on {cell} ({})", s.id, t.unwrap_or("no terrain")));
            }
            if let Some(other) = covered.insert(cell.clone(), s.id.as_str()) {
                return Err(format!("structures {other} and {} overlap at {cell}", s.id));
            }
        }
        structures.insert(s.id.as_str(), *ty);
    }

    // Occupancy: persons, present, in spaces that exist, within capacity.
    let mut used: BTreeMap<&str, u64> = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for o in &w.occupancy {
        let e = entity(&o.occupant)?;
        if e.kind != PERSON || e.present == Some(false) {
            return Err(format!("{} can't occupy a space: only a person in the world can", o.occupant));
        }
        let (sid, local) = split_space(&o.space).ok_or_else(|| format!("{} isn't a space id", o.space))?;
        let ty = structures.get(sid).ok_or_else(|| format!("occupancy names unknown structure {sid}"))?;
        let spec = space_spec(ty, local).ok_or_else(|| format!("structure {sid} has no space {local}"))?;
        if !seen.insert((o.occupant.as_str(), o.space.as_str())) {
            return Err(format!("{} occupies {} twice", o.occupant, o.space));
        }
        let u = used.entry(o.space.as_str()).or_default();
        *u += 1;
        if *u > spec.capacity as u64 {
            return Err(format!("space {} is over its capacity of {}", o.space, spec.capacity));
        }
    }

    // Participants: persons have bodies of their own; systems belong to organisations.
    let mut bodies = BTreeSet::new();
    for p in &c.participants {
        match p.kind {
            ParticipantKind::Person => {
                let person = p.person.as_deref().ok_or_else(|| format!("participant {} is a person's but names no person", p.id))?;
                if entity(person)?.kind != PERSON {
                    return Err(format!("participant {}: {person} isn't a person", p.id));
                }
                if p.owner.is_some() {
                    return Err(format!("participant {} is a person's, so it has no owner", p.id));
                }
                if !bodies.insert(person) {
                    return Err(format!("{person} has more than one participant"));
                }
            }
            ParticipantKind::System => {
                let owner = p.owner.as_deref().ok_or_else(|| format!("system participant {} names no owner", p.id))?;
                if entity(owner)?.kind == PERSON {
                    return Err(format!("system participant {}: {owner} is a person, not an organisation", p.id));
                }
                if p.person.is_some() || !p.channels.is_empty() {
                    return Err(format!("system participant {} has no body, so no person and no personal channels", p.id));
                }
            }
        }
        check_channels(&format!("participant {}", p.id), &p.channels, &|e| entities.contains_key(e), &cell_exists)?;
        check_traits(&format!("participant {}", p.id), &p.traits)?;
    }
    for t in &c.templates {
        if t.kind == ParticipantKind::System && !t.channels.is_empty() {
            return Err(format!("template {}: a system has no personal channels", t.id));
        }
        check_channels(&format!("template {}", t.id), &t.channels, &|e| entities.contains_key(e), &cell_exists)?;
        check_traits(&format!("template {}", t.id), &t.traits)?;
    }

    // Positions: an organisation's, held by a participant or vacant.
    for p in &c.positions {
        if entity(&p.entity)?.kind == PERSON {
            return Err(format!("position {}: {} is a person, and only organisations have positions", p.id, p.entity));
        }
        if let Some(h) = &p.holder {
            if !participants.contains_key(h.as_str()) {
                return Err(format!("position {} is held by unknown participant {h}", p.id));
            }
        }
        check_channels(&format!("position {}", p.id), &p.channels, &|e| entities.contains_key(e), &cell_exists)?;
    }

    // Life: bands must make sense.
    if let Some(l) = &c.life {
        if l.year < 1 {
            return Err("life.year must be positive".into());
        }
        let bands = |what: &str, v: &[Severity]| -> Result<(), String> {
            if v.is_empty() || v.iter().map(|s| s.share_bps as u64).sum::<u64>() != 10_000 {
                return Err(format!("life.{what}: severity shares must add up to 10000"));
            }
            if v.iter().any(|s| s.days[0] < 1 || s.days[0] > s.days[1] || s.fatal_bps > 10_000) {
                return Err(format!("life.{what}: days must be 1 <= lo <= hi, fatal_bps <= 10000"));
            }
            Ok(())
        };
        if let Some(h) = &l.illness {
            bands("illness", &h.severity)?;
        }
        if let Some(h) = &l.injury {
            bands("injury", &h.severity)?;
        }
        if let Some(h) = &l.harm {
            bands("harm", &h.severity)?;
            if h.reach < 0 {
                return Err("life.harm.reach must be 0 or more".into());
            }
        }
        if let Some(b) = &l.birth {
            if b.ages[0] > b.ages[1] || b.gestation < 1 || b.reach < 0 {
                return Err("life.birth: ages lo <= hi, gestation positive, reach 0 or more".into());
            }
        }
        for steps in [l.other_causes.as_ref().map(|x| &x.by_age), l.illness.as_ref().map(|x| &x.by_age)].into_iter().flatten() {
            if steps.windows(2).any(|w| w[0].from >= w[1].from) || steps.iter().any(|s| s.bps > 10_000) {
                return Err("life: by_age steps must rise in age, with bps <= 10000".into());
            }
        }
    }

    // Records: authors exist, and everything they reference exists.
    let positions: BTreeMap<&str, &PositionCfg> = c.positions.iter().map(|p| (p.id.as_str(), p)).collect();
    for r in &w.records {
        if r.author != GENESIS && !participants.contains_key(r.author.as_str()) {
            return Err(format!("record {} has unknown author {}", r.id, r.author));
        }
        if let Some(p) = &r.position {
            if !positions.contains_key(p.as_str()) {
                return Err(format!("record {} names unknown position {p}", r.id));
            }
        }
        for e in r.entities_named().into_iter().chain(r.visibility_entities()) {
            entity(e).map_err(|x| format!("record {}: {x}", r.id))?;
        }
        for other in r.body.records_referenced().into_iter().chain(r.basis.as_deref()) {
            if !records.contains_key(other) {
                return Err(format!("record {} references unknown record {other}", r.id));
            }
        }
        if let RecordBody::Statement { place: Some(p), .. } = &r.body {
            if !cell_exists(p) {
                return Err(format!("record {} is placed on unknown cell {p}", r.id));
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

    Ok(())
}

/// A space's spec within its structure type, from its local id (`dwelling.3`).
pub fn space_spec<'a>(ty: &'a StructureType, local: &str) -> Option<&'a SpaceSpec> {
    let (kind, n) = local.rsplit_once('.')?;
    let n: u32 = n.parse().ok()?;
    if n == 0 || n.to_string() != local.rsplit_once('.')?.1 {
        return None;
    }
    let mut seen = 0;
    for s in ty.spaces.iter().filter(|s| s.kind == kind) {
        if n <= seen + s.count {
            return Some(s);
        }
        seen += s.count;
    }
    None
}

/// Every space in a structure of this type, in order: (local id, spec).
pub fn spaces_of(ty: &StructureType) -> Vec<(String, &SpaceSpec)> {
    let mut next: BTreeMap<&str, u32> = BTreeMap::new();
    let mut v = vec![];
    for s in &ty.spaces {
        for _ in 0..s.count {
            let n = next.entry(s.kind.as_str()).or_default();
            *n += 1;
            v.push((format!("{}.{}", s.kind, n), s));
        }
    }
    v
}

/// A participant's request to look through one of its channels now (attention). `channel` is a
/// personal channel's id, or `<position>/<channel>` for a channel of a position it holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LookRequest {
    pub channel: Id,
    /// A search (records channels only): what matches now, rather than what changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<Query>,
}

/// A search over records: mechanical matching, never interpretation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    /// Only records not withdrawn by their own author (or whoever they speak for).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub standing: Option<bool>,
    #[serde(default, rename = "where", skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<Condition>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<Order>,
    /// At most this many results (default 20, at most 200).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Condition {
    /// "record", "kind", "at", "author", "speaks_for", "basis", "data.<path>" or "about.<path>".
    pub field: String,
    pub op: CmpOp,
    pub value: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CmpOp {
    #[serde(rename = "=")]
    Eq,
    #[serde(rename = "!=")]
    Ne,
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = "<=")]
    Le,
    #[serde(rename = ">")]
    Gt,
    #[serde(rename = ">=")]
    Ge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Order {
    pub field: String,
    #[serde(default)]
    pub desc: bool,
}
