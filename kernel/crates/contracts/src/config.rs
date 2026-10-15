//! World config, mirroring contracts/world-config.schema.json (v0.5), plus
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
use oikos_core::canon;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub const CONTRACTS_VERSION: &str = "0.8";

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
    /// Who knows what: what is published, who keeps each register (docs/design/knowing.md).
    #[serde(default, skip_serializing_if = "Knowing::is_empty")]
    pub knowing: Knowing,
    pub caps: Caps,
    /// Dials of a living world (docs/design/ai-citizens.md 10j). Opaque to the kernel; absent, every dial is off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dials: Option<BTreeMap<String, Value>>,
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
    /// How much the log keeps beyond what replay needs: `full` (the default) logs each observation's hash (so a replay
    /// checks every observation came out the same); `lean` doesn't (smaller and faster; a replay still checks the
    /// state, entry by entry, through the chain and the checkpoints).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalogue {
    pub structure_types: Vec<StructureType>,
    /// The kinds of thing the world holds, moves and makes (D58 §4.3, phase B): goods, inputs, materials. Money
    /// isn't one: it stays in accounts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resources: Vec<ResourceCfg>,
    /// Kinds of work (phase B): what a unit takes (performers' time, inputs) and gives (outputs, changes).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tasks: Vec<TaskCfg>,
    /// State variables of structures (phase B): wear, and later waste, habitat quality. The kernel keeps them exactly
    /// and attaches no meaning to them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<VariableCfg>,
    /// The most a person can work in a day (seconds): a physical limit on a body. Required when any work takes time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_day: Option<i64>,
    /// Nature (docs/design/world-expansion.md 2): kinds of land cover (a cell's terrain names one).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub land_covers: Vec<LandCoverCfg>,
    /// The cover of a cell with no terrain label and no building.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_cover: Option<Id>,
    /// What a cell's cover becomes when a building on it comes down.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cleared_cover: Option<Id>,
    /// Integer quantities on cells (pollution, water level): sources, decay, diffusion, flow.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<FieldCfg>,
    /// Living populations on cells: growth, mortality, dispersal, tolerances. An extinct species never returns.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub species: Vec<SpeciesCfg>,
    /// Named integers on every body (services, docs/design/world-expansion.md 4.2): skill, say. The kernel keeps them
    /// exactly and attaches no meaning to them; work changes them (a task's `on_body`), and they drift by `per_day`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub body_variables: Vec<BodyVariableCfg>,
    /// World totals the kernel keeps (tier 2: greenhouse gas).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub counters: Vec<CounterCfg>,
    /// Travel (world-expansion 6.3): moving between structures takes the time of the quickest path over the cells
    /// between, by each cell's cover. Absent: moving takes no time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub travel: Option<TravelCfg>,
}

/// What crossing a cell takes (seconds), by its cover (a road, quicker; water, slower), else `seconds_per_cell`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TravelCfg {
    pub seconds_per_cell: i64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub by_cover: BTreeMap<Id, i64>,
}

/// A body variable: its bounds, its value for a body born here (or given none), and its drift a day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BodyVariableCfg {
    pub id: Id,
    pub min: i64,
    pub max: i64,
    pub initial: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub per_day: i64,
}

/// The reserved cover of a cell with a building whose type names none.
pub const COVER_BUILT: &str = "built";
/// The cover of unbuilt ground with no terrain label, in a world that names no default.
pub const COVER_OPEN: &str = "open";

/// A kind of land cover, and what it becomes if left unbuilt long enough (cleared land to scrub to woodland).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LandCoverCfg {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub succeeds_to: Option<SuccessionCfg>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SuccessionCfg {
    pub cover: Id,
    pub after_days: i64,
}

/// An integer quantity on cells, stepped daily: sources (by cover, and per building of a type, at its corner cell),
/// then decay toward the baseline, then diffusion to the four neighbours, then flow downstream; within [min, max].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldCfg {
    pub id: Id,
    pub min: i64,
    pub max: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub baseline: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub decay_bps_per_day: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub diffusion_bps_per_day: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub flow_bps_per_day: i64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub from_structures: BTreeMap<Id, i64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub from_covers: BTreeMap<Id, i64>,
    /// What's above this level on a cell spreads to the four around it, `spill_bps_per_day` of it a day (a river over its
    /// banks: world-expansion 7.3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spills_above: Option<i64>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub spill_bps_per_day: i64,
    /// The sources scaled from a day on (rain, a wet season, a drought): `[{from_day, bps}]`; before the first, all.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_by_day: Vec<DayStep>,
}

/// From a day of the run on (days since its start), a share in basis points.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DayStep {
    pub from_day: i64,
    pub bps: i64,
}

/// A structure type that floods: when a field (water) passes `above` on any of its cells, its occupants are moved out,
/// no one can come in while it lasts, and its `wear` rises by `wear_per_day`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FloodsCfg {
    pub field: Id,
    pub above: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub wear_per_day: i64,
}

/// A species: its carrying capacity by cover (individuals per 1,000 cells, so a sparse animal can have a fraction of
/// one per cell), felt over its home range (a square of cells this far each way: where it finds food and mates); its
/// intrinsic growth and background mortality (a year); the share that disperses to a neighbouring cell (a year);
/// covers it can't cross; the least number in a home range that breeds (an Allee effect); deaths where a field passes
/// what it tolerates; and how surveys and passers-by see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpeciesCfg {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub capacity_per_1000_cells: BTreeMap<Id, i64>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub home_range: i64,
    pub growth_bps_per_year: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub mortality_bps_per_year: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub dispersal_bps_per_year: i64,
    /// How far a disperser can go (cells, a step at a time) through ground it can't live on before it dies there;
    /// 0: one step.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub dispersal_range: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub barriers: Vec<Id>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub min_viable: i64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tolerance: BTreeMap<Id, ToleranceCfg>,
    pub detection_bps: i64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub conspicuous: bool,
}

/// Where a field passes `above`, each individual there dies with `mortality_bps_per_day` a day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToleranceCfg {
    pub above: i64,
    pub mortality_bps_per_day: i64,
}

/// The built-in task that builds a structure begun with `construct` (one unit: one second of work).
pub const TASK_BUILD: &str = "build";
/// The built-in task that brings down a structure whose demolition has begun (one unit: one second of work).
pub const TASK_DEMOLISH: &str = "demolish";

/// A kind of work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskCfg {
    pub id: Id,
    /// Seconds of performers' time per unit (0: using things up, e.g. eating).
    pub labour: i64,
    /// The kind of space performers must be in, at the structure (e.g. `workplace`); absent: any space there.
    #[serde(default, rename = "in", skip_serializing_if = "Option::is_none")]
    pub in_space: Option<String>,
    /// Per unit: taken from the actor's holding at the structure.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty", with = "oikos_core::money::amount_map")]
    pub consumes: BTreeMap<Id, oikos_core::money::Money>,
    /// Per unit: added to the actor's holding at the structure.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty", with = "oikos_core::money::amount_map")]
    pub produces: BTreeMap<Id, oikos_core::money::Money>,
    /// Per unit: added to state variables of the structure worked on (`on`, or the structure itself).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub changes: BTreeMap<Id, i64>,
    /// Measurement (nature): a unit surveys one cell for a species or a field (`work`'s `survey`), and the actor learns
    /// an estimate.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub surveys: bool,
    /// Investigation (world-expansion 7.3): work with `investigate` finds who took the goods, with this chance.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub investigates: bool,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub detection_bps: u32,
    /// What a unit does to the bodies worked on (`work`'s `on` naming a person, or a space: everyone in it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_body: Option<OnBody>,
    /// Skill at work: the labour per unit scales with the performers' mean of a body variable, from all of it at the
    /// variable's minimum to `at_max_bps` of it at its maximum.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labour_by: Option<LabourBy>,
    /// Per unit: taken from a field, at the cell (the structure's, or the four around them) that has the most of it
    /// (water from the river).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draws: Option<Draws>,
    /// Per unit: added to a field at the structure's corner cell (pollution), or to a world counter (greenhouse gas).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub emits: BTreeMap<Id, i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Draws {
    pub field: Id,
    pub per_unit: i64,
}

/// A world total the kernel keeps (greenhouse gas): added to by work, censused monthly, with no effect on anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CounterCfg {
    pub id: Id,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OnBody {
    /// Per unit: added to each body's variables, within their bounds.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub changes: BTreeMap<Id, i64>,
    /// Care: what a work act of at least `units` does to a condition of this kind (and band, if given), once.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub treats: Vec<Treats>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Treats {
    pub kind: crate::vocab::ConditionKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    /// The least units of one work act that treat it.
    pub units: u64,
    /// The share of its remaining days it lasts once treated.
    pub days_kept_bps: u32,
    /// The chance a death due from it still happens once treated.
    pub fatal_kept_bps: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabourBy {
    pub variable: Id,
    pub at_max_bps: u32,
}

/// A state variable of structures, with its dynamics: it changes by `per_day`, and `per_occupant_per_day` for each
/// body inside, every whole day, within [min, max]. `types`: the structure types it applies to (absent: all).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VariableCfg {
    pub id: Id,
    pub min: i64,
    pub max: i64,
    pub initial: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub per_day: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub per_occupant_per_day: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub types: Option<Vec<Id>>,
}

fn is_zero_u32(x: &u32) -> bool {
    *x == 0
}

fn is_zero(x: &i64) -> bool {
    *x == 0
}

/// A kind of resource: its id and the unit its quantities count (items, kg...: the world's vocabulary).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceCfg {
    pub id: Id,
    pub unit: String,
}

/// A holding at the start: a quantity of a kind, held by an entity at a structure (or, for an edge, at itself).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HoldingCfg {
    pub kind: Id,
    pub holder: Id,
    pub at: Id,
    #[serde(with = "oikos_core::money::amount")]
    pub quantity: oikos_core::money::Money,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructureType {
    pub id: Id,
    pub category: String,
    /// What it's made of (phase B): quantities of resource kinds, taken from the builder's holding when it's begun.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty", with = "oikos_core::money::amount_map")]
    pub materials: BTreeMap<Id, oikos_core::money::Money>,
    /// The least time it takes to build, whatever the crew (some processes take time).
    pub build_time: i64,
    /// Seconds of work (the task `build`, on it) before it's complete; 0: it completes when build_time has passed.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub build_labour: i64,
    /// Seconds of work (the task `demolish`, on it) before it comes down; 0: it comes down at once.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub demolition_labour: i64,
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
    /// Nature: the land cover its cells count as while it stands (a park is grassland); absent, `built`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<Id>,
    /// Floods (world-expansion 7.3): above what level of which field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub floods: Option<FloodsCfg>,
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
    /// The world's edges (entities of kind boundary): at least one. The first is the default edge: construction
    /// materials are paid into it, and someone leaving without naming an edge leaves by it.
    pub boundaries: Vec<Id>,
    /// The currencies the world's money comes in; the first is the default.
    pub currencies: Vec<CurrencyCfg>,
    pub ground: Ground,
    /// The places (D58): named areas on the ground, nested, each detailed (its cells exist: lots, buildings,
    /// bodies) or summarised (an area, simulated in aggregate). One root; each other place lies within its parent.
    pub places: Vec<PlaceCfg>,
    pub entities: Vec<EntityCfg>,
    pub accounts: Vec<AccountCfg>,
    pub structures: Vec<StructureCfg>,
    pub occupancy: Vec<OccupancyCfg>,
    /// (Shared: the state's record store holds the same records, not copies.)
    pub records: Vec<Arc<Record>>,
    /// Holdings at the start (phase B).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub holdings: Vec<HoldingCfg>,
    /// Nature at the start: populations and field values on cells (sparse), and the flow layer (a river's course).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub populations: Vec<PopulationCfg>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<FieldValueCfg>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub flows: Vec<FlowCfg>,
    /// Nature's spin-up: this many days stepped before the run begins, over the land as it starts, so nature starts
    /// in its own balance, not the generator's guess at it (no events; the census begins with the run).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub nature_spin_up_days: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PopulationCfg {
    pub species: Id,
    pub cell: Id,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldValueCfg {
    pub field: Id,
    pub cell: Id,
    pub value: i64,
}

/// A cell and the cell downstream of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FlowCfg {
    pub from: Id,
    pub to: Id,
}

/// The ground: one plane of `w` by `h` cells (`cell.<x>.<y>`), each `cell` world units across (presentation only),
/// with optional terrain labels over rectangles. Only cells inside a detailed place exist (D58): a country-sized plane
/// costs nothing where it's summarised.
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

/// A place: a named area of the ground, within its parent (none: the root, the whole world).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaceCfg {
    pub id: Id,
    /// A label in the world's vocabulary (a country, region, locality, neighbourhood...).
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub within: Option<Id>,
    /// Its area on the ground: a rectangle of cells.
    pub area: PlaceRect,
    /// Detailed: its cells exist (lots, buildings, bodies in spaces). Summarised: simulated in aggregate (D58 §4.1).
    pub detailed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaceRect {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

/// The most cells the detailed places may cover together: what the kernel keeps one by one.
pub const MAX_DETAILED_CELLS: i64 = 16_777_216;

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
    /// Persons only: biological sex, where the world models it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sex: Option<crate::vocab::Sex>,
    /// Persons only: the body's starting variables (the catalogue's `body_variables`; others take `initial`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variables: Option<BTreeMap<Id, i64>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountCfg {
    pub id: Id,
    pub holder: Id,
    pub custodian: Id,
    /// Absent: the world's first currency.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<Id>,
    #[serde(with = "oikos_core::money::amount")]
    pub balance: oikos_core::money::Money,
}

/// A currency the world's money comes in: its code, and how many decimal places its smallest unit is
/// (presentation only: the kernel counts in the smallest unit).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrencyCfg {
    pub code: Id,
    pub minor_units: u8,
    /// The sign people write before an amount in it; absent: amounts are written with its code.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    /// The words people write after an amount for its unit, singular and plural; none: only its sign or code.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unit_words: Vec<String>,
    /// The words for its smallest unit, where that has a name; the first is the singular.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub minor_words: Vec<String>,
    /// The mark written before the decimals: "." or ","; absent: a point, unless the group mark is a point.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decimal_mark: Option<String>,
    /// The mark written between groups of digits; absent: a comma, or a point where the decimal mark is a comma.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_mark: Option<String>,
    /// [3] or [3, 2]; absent: threes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grouping: Option<Vec<u8>>,
    /// The sign (or code) is written after the digits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol_after: Option<bool>,
    /// A space stands between the sign and the digits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol_spaced: Option<bool>,
    /// Words this place writes for large numbers, with their values (read, never written).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub number_words: BTreeMap<String, u64>,
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
    /// Its starting variables (the catalogue's that apply to its type; others start at `initial`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variables: Option<BTreeMap<Id, i64>>,
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

/// No channels (for a shared list of them).
pub fn is_false(b: &bool) -> bool {
    !*b
}

pub fn no_channels(channels: &Arc<Vec<Channel>>) -> bool {
    channels.is_empty()
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
    /// A person's participant that acts through a body another participant already has (foundations F5): a model's seat in
    /// one post of a person whose own participant goes on with the rest of their life and posts. It shares the person's body
    /// and timeline, holds the posts it is given and no others; a body has one participant of its own, and any number of
    /// these beside it. Absent: the person's own.
    #[serde(default, skip_serializing_if = "is_false")]
    pub shares_body: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Personal channels (persons only): what it perceives of its own life. (Shared, as its controller and framing
    /// are: the state's participant holds the same ones, not copies.)
    #[serde(default, skip_serializing_if = "no_channels")]
    pub channels: Arc<Vec<Channel>>,
    /// Opaque to the kernel.
    pub controller: Arc<Value>,
    /// Opaque to the kernel.
    pub framing: Arc<Value>,
    /// What happens after an opt-out: absent or "vacant" means it never acts again (and its positions
    /// fall vacant); a code stand-in means it carries on (the orchestrator runs the stand-in).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_opt_out: Option<Value>,
    /// A system's: the template it was made from, and the organisation that supplied it (foundations F4: a system
    /// exists because someone delivered it; one at the start of the world is delivered by a genesis record naming both).
    /// A system that holds a post must name both.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supplier: Option<Id>,
    /// Its own parameters (a person's disposition), used by the role modules it runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traits: Option<Value>,
    /// A system's: how many acts it carries out at once (docs/design/rebuild.md 6.3). A person has one timeline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lanes: Option<u32>,
    /// The platform bookkeeping module that keeps this participant's person's record (e.g. "citizen.default").
    /// Absent: a code controller's module keeps it; any other controller has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record_keeper: Option<String>,
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
    /// The bookkeeping of this post (its `role_module.code`) keeps the record of the organisation it belongs to.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub keeps_record: bool,
}

impl PositionCfg {
    /// The bookkeeping that keeps the organisation's record through this post, if it is the keeping post.
    pub fn record_keeper_name(&self) -> Option<&str> {
        if !self.keeps_record {
            return None;
        }
        self.role_module.as_ref()?.get("code")?.as_str()
    }
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
    /// Trait values, `{"uniform": [lo, hi]}` (integers) or `{"pick": {value: weight}}`, drawn when the participant is created.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traits: Option<Value>,
    /// A system's: what a system from this template can do (foundations F4). Each row lists a block (and, for `work`, a
    /// task, or for `publish`, a kind of record). A system acts, or does another's work, only within its rows; outside
    /// them the act is refused (`not_capable`). A system's template must say (F5: there is no "no limit"); a person's has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub does: Option<Vec<Does>>,
    /// A system's: the organisation that supplies systems from this template. Only it delivers one (`deploy`, naming
    /// the client), and it may switch one off (`retire`) as the client may. Absent: nobody supplies it, so none is delivered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supplier: Option<Id>,
}

/// One thing a system from a template can do (foundations F4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Does {
    /// The block (`message`, `publish`, `work`, ...).
    pub block: String,
    /// For `work`: only this task. Absent: any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    /// For `publish`, `create_entity`: only this kind of record. Absent: any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// For `work`: the seconds a unit when the system is the one doing it (in place of the task's labour). Absent: the task's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seconds: Option<i64>,
}

impl Does {
    /// Does this row cover a block, whose `makes` is as `Block::makes` gives it?
    pub fn covers(&self, block: &str, makes: Option<&str>) -> bool {
        if self.block != block {
            return false;
        }
        match self.task.as_deref().or(self.kind.as_deref()) {
            None => true,
            Some(x) => makes.and_then(|m| m.split_once('/')).is_some_and(|(_, m)| m == x),
        }
    }
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
    /// The yearly chance rises by `bps_per_unit` for each unit of a field in the cell where the body is (its
    /// structure's corner cell).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<FieldEffect>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldEffect {
    pub field: Id,
    pub bps_per_unit: i64,
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
    /// The chance of death by the body's age (as `other_causes`), in place of `fatal_bps` where given: case fatality
    /// rises steeply with age.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fatal_by_age: Option<Vec<AgeStep>>,
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
    /// If set, a newborn's sex is drawn: this share (basis points) female. Unset: bodies born here have no sex modelled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub female_bps: Option<u32>,
}

impl ParticipantCfg {
    /// Whether it stays silent after its controller opts out.
    pub fn vacant_after_opt_out(&self) -> bool {
        !matches!(&self.on_opt_out, Some(Value::Object(_)))
    }
}

/// The way something reaches a participant (docs/design/knowing.md): it is theirs (`mine`), they are there (`here`)
/// or go to look (`visit`), it was published (`published`), they asked its keeper for one thing (`ask`), or they are
/// its keeper (`kept`). `whole`: a view not yet replaced (the migration's; each one is listed in the guard's test).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Way {
    Mine,
    Here,
    Visit,
    Published,
    Ask,
    Kept,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChannelKind {
    Accounts,
    /// What the capacity's entity holds, and where (phase B): its holdings that changed since the last look.
    Holdings,
    Records {
        way: Way,
        #[serde(rename = "match")]
        filter: RecordFilter,
        /// Where the channel looks: only records placed there are seen through it.
        /// Without an area, the channel sees records that aren't placed anywhere.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        area: Option<Area>,
        /// Published: only what these put out (their own lists), whatever its kind. "self": the capacity's entity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<Vec<Id>>,
        /// Ask: the keeper asked.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        of: Option<Id>,
        /// Ask: the fields a question may name its subject by (each one the keeper answers by).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        by: Option<Vec<String>>,
    },
    Sites {
        way: Way,
        /// Here: where. Visit: none (a look names the places gone to).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        area: Option<Area>,
        /// What can be told about who is in a space the capacity's entity doesn't occupy itself:
        /// how many (the default), or who.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        occupants: Option<Occupants>,
        /// Visit: how long looking at one place takes through this channel, where it is not the world's
        /// (`knowing.visit_seconds`): reading a meter at the gate is not an inspection.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        look_seconds: Option<i64>,
    },
    Directory {
        way: Way,
    },
    /// It is theirs: the record of the seat's own entity (who they are and how things stand with them, as their
    /// mind keeps it: docs/design/ai-citizens.md 10d). It names nobody, so it can show nobody else's.
    OwnRecord,
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
    /// Statements having all of these parts ("offer", "practice", "adico", "formal"), whatever their kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has: Option<Vec<String>>,
}

impl RecordFilter {
    /// The collections a filter names, as the world's `knowing` names them: a statement kind (`lot`), statements
    /// having something (`has:practice`), a record type (`records:claim`). None: it names none (any record).
    pub fn collections(&self) -> Option<Vec<String>> {
        if let Some(k) = &self.statement_kinds {
            Some(k.clone())
        } else if let Some(h) = &self.has {
            Some(h.iter().map(|x| format!("has:{x}")).collect())
        } else {
            self.records.as_ref().map(|r| r.iter().map(|x| format!("records:{x}")).collect())
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Area {
    /// Wherever it is put up: a board's placed notices (published, read on request). A map of everything is a whole
    /// view (the migration's).
    All(AllMarker),
    /// (A whole view not yet replaced: a list of cells.)
    Cells(Vec<Id>),
    /// Every cell within this distance of a cell under a building where the capacity's entity occupies a
    /// space (in cells; 0 is those cells and the ones touching them). Moves with it.
    Near(Near),
    /// The cells an office occupies or runs: one organisation's only.
    Premises(Premises),
    /// (A whole view not yet replaced: the cells of a place, where it's detailed.)
    Place(PlaceArea),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Premises {
    pub premises: Vec<Id>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaceArea {
    pub place: Id,
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
    /// The most an entity's own record may hold, in canonical bytes (absent: 8192). A record never grows past it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_record_bytes: Option<u64>,
}

/// A config the kernel has parsed and checked. `canonical` is the exact JSON
/// embedded in the log header; `hash` is its config hash.
#[derive(Debug, Clone)]
pub struct LoadedConfig {
    /// (Shared with the world made from it, which keeps it for the run.)
    pub config: Arc<Config>,
    /// The config as it was given, in canonical JSON: what its hash is of, and what the log's header carries.
    pub canonical: Vec<u8>,
    pub hash: String,
}

pub fn load(v: Value) -> Result<LoadedConfig, String> {
    canon::check_integers(&v).map_err(|e| e.to_string())?;
    crate::contracts::check(&crate::contracts::contracts().config, &v).map_err(|e| format!("config {e}"))?;
    let canonical = canon::canonical_value(&v).map_err(|e| e.to_string())?;
    // (Read out of the value, which is given up as it's read: a large world's config is held once, not as its JSON
    // too. Its canonical bytes are all that's kept of how it was given.)
    let config = Config::deserialize(v).map_err(|e| format!("config does not match contract: {e}"))?;
    validate(&config)?;
    let hash = canon::hash_with_domain(canon::DOMAIN_CONFIG, &canonical);
    Ok(LoadedConfig { config: Arc::new(config), canonical, hash })
}

/// Places form one tree over the ground: ids unique, one root, each other place within an existing parent (no cycles)
/// and inside its area, every area on the ground, and the detailed ones not too many cells together.
fn check_places(w: &World) -> Result<(), String> {
    let by_id: BTreeMap<&str, &PlaceCfg> = w.places.iter().map(|p| (p.id.as_str(), p)).collect();
    if by_id.len() != w.places.len() {
        return Err("a place id is used twice".into());
    }
    let roots = w.places.iter().filter(|p| p.within.is_none()).count();
    if roots != 1 {
        return Err(format!("places need exactly one root (a place within no other), found {roots}"));
    }
    let inside = |a: PlaceRect, b: PlaceRect| a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    let ground = PlaceRect { x: 0, y: 0, w: w.ground.w, h: w.ground.h };
    let mut detailed_cells: i64 = 0;
    for p in &w.places {
        if p.area.w < 1 || p.area.h < 1 || !inside(p.area, ground) {
            return Err(format!("place {}'s area must be at least one cell and on the ground", p.id));
        }
        if let Some(parent) = &p.within {
            let q = by_id.get(parent.as_str()).ok_or_else(|| format!("place {} is within unknown place {parent}", p.id))?;
            if !inside(p.area, q.area) {
                return Err(format!("place {} must lie within {parent}'s area", p.id));
            }
        }
        // No cycles: walking up from any place reaches the root within as many steps as there are places.
        let (mut at, mut steps) = (p, 0);
        while let Some(parent) = &at.within {
            at = by_id[parent.as_str()];
            steps += 1;
            if steps > w.places.len() {
                return Err(format!("place {} is within itself", p.id));
            }
        }
        if p.detailed {
            detailed_cells = detailed_cells.saturating_add(p.area.w.saturating_mul(p.area.h));
        }
    }
    if detailed_cells > MAX_DETAILED_CELLS {
        return Err(format!("the detailed places cover {detailed_cells} cells; at most {MAX_DETAILED_CELLS} are kept one by one"));
    }
    Ok(())
}

/// The detailed places' areas: where cells exist.
pub fn detailed_rects(places: &[PlaceCfg]) -> Vec<PlaceRect> {
    places.iter().filter(|p| p.detailed).map(|p| p.area).collect()
}

/// Does a cell exist: is it inside a detailed place?
pub fn cell_in(detailed: &[PlaceRect], x: i64, y: i64) -> bool {
    detailed.iter().any(|r| x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
}

/// The cells a footprint covers from its corner, in order, or None if any doesn't exist (off the ground, or outside
/// every detailed place).
pub fn footprint_cells(detailed: &[PlaceRect], at: &str, f: Footprint) -> Option<Vec<Id>> {
    let (x0, y0) = cell_xy(at)?;
    let mut v = vec![];
    for y in y0..y0 + f.h {
        for x in x0..x0 + f.w {
            if !cell_in(detailed, x, y) {
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

/// Whose channels are being checked, and against what (docs/design/knowing.md).
pub struct Seat<'a> {
    /// An organisation's seat (a position): its organisation. None: a person's own channels.
    pub organisation: Option<&'a str>,
    /// What the world says is published and who keeps what.
    pub knowing: &'a Knowing,
    /// The most cells a seat's premises may name (an office made during a run); None: as many as are its own.
    pub premises_most: Option<usize>,
    pub entity_exists: &'a dyn Fn(&str) -> bool,
    pub cell_exists: &'a dyn Fn(&str) -> bool,
    pub place_exists: &'a dyn Fn(&str) -> bool,
    /// The organisation whose premises a cell already is, if any.
    pub premises_of: &'a dyn Fn(&str) -> Option<String>,
}

/// How far a map may look near where its seat is (cells): the street outside, not the town.
pub const SITES_NEAR_MAX: i64 = 2;
/// How many cells the premises of an office made during a run may name.
pub const NEW_PREMISES_MAX: usize = 4;
/// How many publishers a channel may name (`from`).
pub const FROM_MAX: usize = 8;

/// Check a set of channels: ids unique; what they name exists; and each one's scope is one its way allows, so that
/// no seat but a register's keeper is given a whole collection, a whole map or a directory to read through
/// (docs/design/knowing.md, section 4).
pub fn check_channels(owner: &str, channels: &[Channel], seat: &Seat) -> Result<(), String> {
    let mut ids = BTreeSet::new();
    for ch in channels {
        if !ids.insert(ch.id.as_str()) {
            return Err(format!("{owner} has duplicate channel {}", ch.id));
        }
        if ch.id.contains('/') {
            return Err(format!("{owner} channel {}: a channel id can't contain '/'", ch.id));
        }
        let no = |why: String| Err(format!("{owner} channel {}: {why}", ch.id));
        let (way, area) = match &ch.kind {
            ChannelKind::Accounts | ChannelKind::Holdings | ChannelKind::OwnRecord => continue,
            ChannelKind::Records { way, area, .. } | ChannelKind::Sites { way, area, .. } => (*way, area.as_ref()),
            ChannelKind::Directory { way } => (*way, None),
        };
        // What an area names must exist, whatever the way.
        match area {
            Some(Area::Cells(cs)) => {
                if let Some(c) = cs.iter().find(|c| !(seat.cell_exists)(c)) {
                    return no(format!("unknown cell {c}"));
                }
            }
            Some(Area::Premises(p)) => {
                if p.premises.is_empty() {
                    return no("premises must name at least one cell".into());
                }
                if let Some(c) = p.premises.iter().find(|c| !(seat.cell_exists)(c)) {
                    return no(format!("unknown cell {c}"));
                }
            }
            Some(Area::Near(n)) if n.near < 0 => return no("near must be 0 or more".into()),
            Some(Area::Place(p)) if !(seat.place_exists)(&p.place) => return no(format!("unknown place {}", p.place)),
            _ => {}
        }
        // Where a seat is: near it (a map, the street outside and no further; notices put up, as far as the world says
        // its people get about), or its premises (an organisation's, and no other organisation's; for an office made
        // during a run, a building or two: premises change hands, so the old holder's seat may name them still).
        let here = |map: bool| -> Result<(), String> {
            match area {
                Some(Area::Near(n)) => {
                    if map && n.near > SITES_NEAR_MAX {
                        return no(format!("a map of where one is looks at most {SITES_NEAR_MAX} cells around (to see further, go and look)"));
                    }
                    Ok(())
                }
                Some(Area::Premises(p)) => {
                    let Some(org) = seat.organisation else { return no("premises are an organisation's (a person is where their body is: near)".into()) };
                    if seat.premises_most.is_some_and(|most| p.premises.len() > most) {
                        return no(format!("a new office's premises are a building or two (at most {} cells), not a district", seat.premises_most.unwrap_or(0)));
                    }
                    for c in &p.premises {
                        if let Some(other) = (seat.premises_of)(c).filter(|o| o != org) {
                            return no(format!("{c} is {other}'s premises already: a cell is one organisation's premises only"));
                        }
                    }
                    Ok(())
                }
                _ => no("what is here is near where one is (`near`) or at one's premises (`premises`): a whole map or a list of other cells is not expressible".into()),
            }
        };
        match &ch.kind {
            ChannelKind::Accounts | ChannelKind::Holdings | ChannelKind::OwnRecord => {}
            ChannelKind::Directory { .. } => {
                if way != Way::Ask {
                    return no("a directory is looked up (`way: ask`), never shown".into());
                }
            }
            ChannelKind::Sites { look_seconds, .. } => match way {
                Way::Here if look_seconds.is_some() => return no("`look_seconds` is how long a look at a place gone to takes (`way: visit`)".into()),
                Way::Here => here(true)?,
                Way::Visit => {
                    if area.is_some() {
                        return no("a visit goes to the places a look names: it has no area".into());
                    }
                    if look_seconds.is_some_and(|x| x < 1) {
                        return no("`look_seconds` must be 1 or more".into());
                    }
                }
                _ => return no("a map is of where one is (`here`) or of where one goes (`visit`)".into()),
            },
            ChannelKind::Records { filter, from, of, by, .. } => {
                if way != Way::Published && from.is_some() {
                    return no("`from` is for what named publishers put out (`way: published`)".into());
                }
                if way != Way::Ask && (of.is_some() || by.is_some()) {
                    return no("`of` and `by` are for asking a keeper (`way: ask`)".into());
                }
                let named = || filter.collections().ok_or_else(|| format!("{owner} channel {}: say which records (statement kinds, record types, or what they have): never any record", ch.id));
                match way {
                    Way::Mine => {
                        if area.is_some() {
                            return no("one's own papers are not at a place: no area".into());
                        }
                    }
                    Way::Here => here(false)?,
                    Way::Published => {
                        if let Some(from) = from {
                            if from.is_empty() || from.len() > FROM_MAX {
                                return no(format!("`from` names 1 to {FROM_MAX} publishers"));
                            }
                            if let Some(e) = from.iter().find(|e| *e != SELF && !(seat.entity_exists)(e)) {
                                return no(format!("unknown entity {e:?}"));
                            }
                            if area.is_some() {
                                return no("a named publisher's lists are not looked for at a place: no area".into());
                            }
                            named()?;
                            continue;
                        }
                        let kinds = named()?;
                        let mut boards = 0;
                        for k in &kinds {
                            let Some(p) = seat.knowing.published.iter().find(|p| &p.what == k) else {
                                return no(format!("{k} is not published in this world (`knowing.published`): it is somebody's, to be asked for"));
                            };
                            boards += usize::from(p.board == Some(true));
                        }
                        if boards != 0 && boards != kinds.len() {
                            return no("a board is read on request, a publication is shown: not both through one channel".into());
                        }
                        if boards != 0 && ch.on_request != Some(true) {
                            return no("a board is read a few at a time, on request: nobody is shown one".into());
                        }
                        match area {
                            None => {}
                            Some(Area::All(_)) if boards != 0 => {}
                            _ => return no("what is published is not at a place (a board's placed notices: `all`; a notice put up somewhere is seen by being near it: `way: here`)".into()),
                        }
                    }
                    Way::Kept => {
                        let Some(org) = seat.organisation else { return no("a register's keeper is an organisation".into()) };
                        if area.is_some() {
                            return no("a register is not at a place: no area".into());
                        }
                        for k in named()? {
                            if !seat.knowing.keepers.iter().any(|x| x.entity == org && x.what == k) {
                                return no(format!("{org} is not the keeper of {k} (`knowing.keepers`): it asks whoever is"));
                            }
                        }
                    }
                    Way::Ask => {
                        let (Some(of), Some(by)) = (of, by) else { return no("an ask names the keeper asked (`of`) and what it is asked by (`by`)".into()) };
                        if ch.on_request != Some(true) {
                            return no("a keeper answers when asked: on request".into());
                        }
                        if area.is_some() {
                            return no("a register is not at a place: no area".into());
                        }
                        if by.is_empty() {
                            return no("`by` names at least one field".into());
                        }
                        for k in named()? {
                            let Some(keeper) = seat.knowing.keepers.iter().find(|x| &x.entity == of && x.what == k) else {
                                return no(format!("{of} is not the keeper of {k} (`knowing.keepers`)"));
                            };
                            for f in by {
                                let Some(a) = keeper.answers.iter().find(|a| &a.by == f) else {
                                    return no(format!("{of} does not answer about {k} by {f}"));
                                };
                                if let Some(to) = &a.to {
                                    if !seat.organisation.is_some_and(|org| to.iter().any(|t| t == org)) {
                                        return no(format!("{of} answers about {k} by {f} only to {}", to.join(", ")));
                                    }
                                }
                            }
                        }
                    }
                    Way::Visit => return no("records are not gone to: a visit is a map's".into()),
                }
            }
        }
    }
    Ok(())
}

/// The cells each organisation's seats name as premises, by cell (the first to name it).
pub fn premises_of_positions<'a>(positions: impl Iterator<Item = (&'a str, &'a [Channel])>) -> BTreeMap<Id, Id> {
    let mut m = BTreeMap::new();
    for (org, channels) in positions {
        for ch in channels {
            let area = match &ch.kind {
                ChannelKind::Records { area, .. } | ChannelKind::Sites { area, .. } => area.as_ref(),
                _ => None,
            };
            if let Some(Area::Premises(p)) = area {
                for c in &p.premises {
                    m.entry(c.clone()).or_insert_with(|| org.to_string());
                }
            }
        }
    }
    m
}

/// What a world says of who knows what (docs/design/knowing.md): what is published, who keeps each register and
/// what they answer, and how long looking at a place takes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Knowing {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub published: Vec<Published>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keepers: Vec<Keeper>,
    /// Seconds to look at one place gone to (beside the way there and back).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visit_seconds: Option<i64>,
}

impl Knowing {
    pub fn is_empty(&self) -> bool {
        self.published.is_empty() && self.keepers.is_empty() && self.visit_seconds.is_none()
    }

    /// The most one look returns of a board (the least of the boards the filter names); None: not a board.
    pub fn board_most(&self, filter: &RecordFilter) -> Option<u32> {
        let kinds = filter.collections()?;
        kinds.iter().filter_map(|k| self.published.iter().find(|p| &p.what == k).filter(|p| p.board == Some(true))).map(|p| p.most.unwrap_or(SEARCH_MAX)).min()
    }

    /// The most a keeper returns to one question by this field (the least over the collections the filter names).
    pub fn answer_most(&self, of: &str, filter: &RecordFilter, by: &str) -> u32 {
        let kinds = filter.collections().unwrap_or_default();
        kinds.iter().filter_map(|k| self.keepers.iter().find(|x| x.entity == of && &x.what == k)).filter_map(|x| x.answers.iter().find(|a| a.by == by)).map(|a| a.most.unwrap_or(SEARCH_MAX)).min().unwrap_or(SEARCH_MAX)
    }
}

/// The most records any one search returns.
pub const SEARCH_MAX: u32 = 200;

/// Something its maker puts out to the public. A board (jobs, homes to let) is read a few at a time, on request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Published {
    pub what: String,
    pub why: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub board: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub most: Option<u32>,
}

/// The keeper of a register: the office that makes it, or to which every entry in it is addressed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Keeper {
    pub entity: Id,
    pub what: String,
    pub why: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub answers: Vec<Answer>,
}

/// What a keeper answers: a question naming its subject by this field, to these (absent: anyone), at most so many.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Answer {
    pub by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<Vec<Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub most: Option<u32>,
}

/// Check a template's traits: values, `{"uniform": [lo, hi]}` with lo <= hi, or `{"pick": {value: weight, ...}}`
/// with non-negative integer weights, at least one positive.
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
        if let Some(p) = v.as_object().and_then(|o| o.get("pick")) {
            let ok = p.as_object().is_some_and(|w| {
                !w.is_empty() && w.values().all(|x| x.as_u64().is_some_and(|n| n <= 1_000_000_000)) && w.values().any(|x| x.as_u64().unwrap_or(0) > 0)
            });
            if !ok {
                return Err(format!("{owner}: trait {k}: pick needs {{value: weight}} with non-negative integer weights, at least one positive"));
            }
        }
    }
    Ok(())
}

/// Bodies' variables, care and skill at work (docs/design/world-expansion.md 4.2): what they name exists, in range.
fn check_bodies(c: &Config) -> Result<(), String> {
    let cat = &c.catalogue;
    let bps = |v: u32, what: &str| if v <= 10_000 { Ok(()) } else { Err(format!("{what} must be 0..=10000 basis points")) };
    let mut vars: BTreeMap<&str, &BodyVariableCfg> = BTreeMap::new();
    for v in &cat.body_variables {
        if v.min > v.max || v.initial < v.min || v.initial > v.max {
            return Err(format!("body variable {}: min <= initial <= max", v.id));
        }
        if vars.insert(&v.id, v).is_some() {
            return Err(format!("duplicate body variable {}", v.id));
        }
    }
    for t in &cat.tasks {
        if let Some(ob) = &t.on_body {
            for k in ob.changes.keys() {
                if !vars.contains_key(k.as_str()) {
                    return Err(format!("task {}: no body variable {k}", t.id));
                }
            }
            for tr in &ob.treats {
                bps(tr.days_kept_bps, &format!("task {}: days_kept_bps", t.id))?;
                bps(tr.fatal_kept_bps, &format!("task {}: fatal_kept_bps", t.id))?;
                if tr.units == 0 {
                    return Err(format!("task {}: a treatment takes at least one unit", t.id));
                }
            }
        }
        if let Some(lb) = &t.labour_by {
            if !vars.contains_key(lb.variable.as_str()) {
                return Err(format!("task {}: labour_by names no body variable {}", t.id, lb.variable));
            }
            bps(lb.at_max_bps, &format!("task {}: labour_by.at_max_bps", t.id))?;
        }
    }
    let mut counters: BTreeSet<&str> = BTreeSet::new();
    for x in &cat.counters {
        if !counters.insert(&x.id) || cat.fields.iter().any(|f| f.id == x.id) {
            return Err(format!("counter {}: its id must be unique among counters and fields", x.id));
        }
    }
    for t in &cat.tasks {
        if let Some(d) = &t.draws {
            if !cat.fields.iter().any(|f| f.id == d.field) || d.per_unit < 0 {
                return Err(format!("task {}: draws from no field {} (or a negative amount)", t.id, d.field));
            }
        }
        for k in t.emits.keys() {
            if !counters.contains(k.as_str()) && !cat.fields.iter().any(|f| &f.id == k) {
                return Err(format!("task {}: emits to no field or counter {k}", t.id));
            }
        }
    }
    for e in &c.world.entities {
        for (k, v) in e.variables.iter().flatten() {
            let cfg = vars.get(k.as_str()).ok_or_else(|| format!("entity {}: no body variable {k}", e.id))?;
            if *v < cfg.min || *v > cfg.max {
                return Err(format!("entity {}: {k} out of its bounds", e.id));
            }
        }
    }
    if let Some(l) = c.life.as_ref() {
        let bands = l.illness.iter().flat_map(|x| x.severity.iter()).chain(l.injury.iter().flat_map(|x| x.severity.iter())).chain(l.harm.iter().flat_map(|x| x.severity.iter()));
        for b in bands {
            if b.fatal_bps > 10_000 || b.fatal_by_age.iter().flatten().any(|x| x.bps > 10_000) {
                return Err(format!("severity {}: fatality must be 0..=10000 basis points", b.label));
            }
        }
    }
    if let Some(ill) = c.life.as_ref().and_then(|l| l.illness.as_ref()) {
        for f in &ill.fields {
            if !cat.fields.iter().any(|x| x.id == f.field) {
                return Err(format!("illness: no field {}", f.field));
            }
        }
    }
    Ok(())
}

/// Semantic validation beyond the JSON Schema.
/// Nature's config (docs/design/world-expansion.md 2.4): everything it names exists, and its figures are in range.
fn check_nature(c: &Config) -> Result<(), String> {
    let (cat, w) = (&c.catalogue, &c.world);
    let rects = detailed_rects(&w.places);
    let cell_ok = |id: &str| cell_xy(id).is_some_and(|(x, y)| rects.iter().any(|r| x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h));
    let bps = |v: i64, what: &str| if (0..=10_000).contains(&v) { Ok(()) } else { Err(format!("{what} must be 0..=10000 basis points")) };
    let mut covers: BTreeSet<&str> = BTreeSet::new();
    for lc in &cat.land_covers {
        if lc.id == COVER_BUILT || !covers.insert(&lc.id) {
            return Err(format!("land cover {:?} is reserved or named twice", lc.id));
        }
    }
    covers.insert(COVER_BUILT);
    covers.insert(COVER_OPEN);
    let cover = |id: &str, what: &str| if covers.contains(id) { Ok(()) } else { Err(format!("{what}: no land cover {id:?}")) };
    for lc in &cat.land_covers {
        if let Some(sc) = &lc.succeeds_to {
            cover(&sc.cover, "a cover's succession")?;
            if sc.after_days < 1 {
                return Err(format!("{}'s succession must take at least a day", lc.id));
            }
        }
    }
    for (x, what) in [(&cat.default_cover, "default_cover"), (&cat.cleared_cover, "cleared_cover")] {
        if let Some(x) = x {
            cover(x, what)?;
        }
    }
    if !cat.land_covers.is_empty() {
        for t in &w.ground.terrain {
            cover(&t.label, "a terrain label, in a world with land covers,")?;
        }
    }
    let types: BTreeSet<&str> = cat.structure_types.iter().map(|t| t.id.as_str()).collect();
    for t in &cat.structure_types {
        if let Some(cv) = &t.cover {
            cover(cv, &format!("structure type {}", t.id))?;
        }
    }
    let mut fields: BTreeSet<&str> = BTreeSet::new();
    for f in &cat.fields {
        if !fields.insert(&f.id) {
            return Err(format!("field {:?} named twice", f.id));
        }
        if f.min > f.max || f.baseline < f.min || f.baseline > f.max {
            return Err(format!("field {}: min <= baseline <= max", f.id));
        }
        bps(f.decay_bps_per_day, "a field's decay")?;
        bps(f.diffusion_bps_per_day, "a field's diffusion")?;
        bps(f.flow_bps_per_day, "a field's flow")?;
        for k in f.from_covers.keys() {
            cover(k, &format!("field {}", f.id))?;
        }
        for k in f.from_structures.keys() {
            if !types.contains(k.as_str()) {
                return Err(format!("field {}: no structure type {k:?}", f.id));
            }
        }
    }
    let mut species: BTreeSet<&str> = BTreeSet::new();
    for sp in &cat.species {
        if !species.insert(&sp.id) || fields.contains(sp.id.as_str()) {
            return Err(format!("species {:?} named twice (or as a field)", sp.id));
        }
        for (k, v) in &sp.capacity_per_1000_cells {
            cover(k, &format!("species {}", sp.id))?;
            if *v < 0 || *v > 1_000_000_000_000 {
                return Err(format!("species {}: a capacity out of range", sp.id));
            }
        }
        if !(0..=1000).contains(&sp.dispersal_range) {
            return Err(format!("species {}: a dispersal range is 0..=1000 cells", sp.id));
        }
        if !(0..=100).contains(&sp.home_range) {
            return Err(format!("species {}: a home range is 0..=100 cells each way", sp.id));
        }
        for b in &sp.barriers {
            cover(b, &format!("species {}", sp.id))?;
        }
        for (f, tol) in &sp.tolerance {
            if !fields.contains(f.as_str()) {
                return Err(format!("species {}: no field {f:?}", sp.id));
            }
            bps(tol.mortality_bps_per_day, "a tolerance's mortality")?;
        }
        bps(sp.detection_bps, "a species' detection")?;
        for (v, what) in [(sp.growth_bps_per_year, "growth"), (sp.mortality_bps_per_year, "mortality"), (sp.dispersal_bps_per_year, "dispersal")] {
            if !(0..=1_000_000).contains(&v) {
                return Err(format!("species {}: {what} out of range", sp.id));
            }
        }
        if sp.min_viable < 0 {
            return Err(format!("species {}: min_viable can't be negative", sp.id));
        }
    }
    for p in &w.populations {
        if !species.contains(p.species.as_str()) || !cell_ok(&p.cell) || p.count < 1 || p.count > 1_000_000_000 {
            return Err(format!("a population of {:?} at {:?}: an unknown species or cell, or a count out of range", p.species, p.cell));
        }
    }
    for f in &w.fields {
        if !fields.contains(f.field.as_str()) || !cell_ok(&f.cell) {
            return Err(format!("a field value of {:?} at {:?}: an unknown field or cell", f.field, f.cell));
        }
    }
    if !(0..=36_500).contains(&w.nature_spin_up_days) {
        return Err("nature_spin_up_days is 0..=36500".into());
    }
    for f in &w.flows {
        if !cell_ok(&f.from) || !cell_ok(&f.to) || f.from == f.to {
            return Err(format!("a flow from {:?} to {:?}: unknown cells, or the same one", f.from, f.to));
        }
    }
    Ok(())
}

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
    if w.ground.w < 1 || w.ground.h < 1 || w.ground.w > i32::MAX as i64 || w.ground.h > i32::MAX as i64 {
        return Err("the ground must be 1..=2^31-1 cells each way".into());
    }
    check_places(w)?;
    check_nature(c)?;
    check_bodies(c)?;

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
    let records: BTreeMap<&str, &Record> = w.records.iter().map(|r| (r.id.as_str(), &**r)).collect();
    let entity = |id: &str| entities.get(id).copied().ok_or_else(|| format!("unknown entity {id:?}"));
    let detailed = detailed_rects(&w.places);
    let cell_exists = |id: &str| cell_xy(id).is_some_and(|(x, y)| cell_in(&detailed, x, y));
    let place_exists = |id: &str| w.places.iter().any(|p| p.id == id);

    // The edges: world.boundaries names exactly the entities of kind boundary, at least one, each once.
    let declared: BTreeSet<&str> = w.entities.iter().filter(|e| e.kind == BOUNDARY).map(|e| e.id.as_str()).collect();
    let named: BTreeSet<&str> = w.boundaries.iter().map(|b| b.as_str()).collect();
    if named.is_empty() || named.len() != w.boundaries.len() || named != declared {
        return Err("world.boundaries must name each entity of kind boundary exactly once (at least one)".into());
    }

    // Bodies: only persons have them.
    for e in &w.entities {
        if e.kind != PERSON && (e.born_at.is_some() || e.present.is_some() || e.parents.is_some() || e.sex.is_some()) {
            return Err(format!("entity {} isn't a person, so it has no body", e.id));
        }
        for p in e.parents.iter().flatten() {
            if entity(p)?.kind != PERSON {
                return Err(format!("{}'s parent {p} isn't a person", e.id));
            }
        }
    }

    // Money: in declared currencies, within range, and the outside world holds an account in each currency.
    let currencies: BTreeSet<&str> = w.currencies.iter().map(|c| c.code.as_str()).collect();
    if currencies.len() != w.currencies.len() {
        return Err("a currency is declared twice".into());
    }
    // How a currency is written (presentation): a sign and words an amount's digits can't be confused with.
    for c in &w.currencies {
        let plain = |s: &str| !s.is_empty() && !s.chars().any(|ch| ch.is_whitespace() || ch.is_ascii_digit() || ch == '.' || ch == ',');
        if c.minor_units > 8 {
            return Err(format!("currency {}: more than 8 decimal places", c.code));
        }
        if !c.symbol.iter().chain(&c.unit_words).chain(&c.minor_words).all(|s| plain(s)) {
            return Err(format!("currency {}: its sign and words can't be empty or hold spaces, digits, '.' or ','", c.code));
        }
        if c.minor_units == 0 && !c.minor_words.is_empty() {
            return Err(format!("currency {}: it has no smaller unit to name", c.code));
        }
        if c.decimal_mark.as_deref().is_some_and(|m| m != "." && m != ",") {
            return Err(format!("currency {}: its decimal mark is a point or a comma", c.code));
        }
        if c.group_mark.as_deref().is_some_and(|m| ![",", ".", " ", "\u{a0}", "\u{202f}", "'", "\u{2019}"].contains(&m)) {
            return Err(format!("currency {}: its group mark is a comma, a point, a space or an apostrophe", c.code));
        }
        if c.decimal_mark.is_some() && c.decimal_mark == c.group_mark {
            return Err(format!("currency {}: its decimal mark and its group mark can't be the same", c.code));
        }
        if c.grouping.as_ref().is_some_and(|g| g != &[3] && g != &[3, 2]) {
            return Err(format!("currency {}: its grouping is [3] or [3, 2]", c.code));
        }
        if !c.number_words.iter().all(|(w, v)| plain(w) && (10..=1_000_000_000_000).contains(v)) {
            return Err(format!("currency {}: its number words can't be empty or hold spaces, digits, '.' or ',', and stand for 10 to a million million", c.code));
        }
    }
    let mut totals: BTreeMap<&str, oikos_core::money::Money> = BTreeMap::new();
    for a in &w.accounts {
        entity(&a.holder)?;
        entity(&a.custodian)?;
        let cur = a.currency.as_deref().unwrap_or(&w.currencies[0].code);
        if !currencies.contains(cur) {
            return Err(format!("account {} is in {cur}, which the world doesn't declare", a.id));
        }
        if !named.contains(a.holder.as_str()) && a.balance < 0 {
            return Err(format!("account {} has a negative opening balance", a.id));
        }
        let t = totals.entry(cur).or_insert(0);
        *t = t.checked_add(a.balance).filter(|x| x.abs() <= oikos_core::money::MAX_MONEY).ok_or_else(|| format!("total money in {cur} out of range"))?;
    }
    for b in &w.boundaries {
        for cur in &currencies {
            if !w.accounts.iter().any(|a| &a.holder == b && &a.custodian == b && a.currency.as_deref().unwrap_or(&w.currencies[0].code) == *cur) {
                return Err(format!("the edge {b} needs an account in its own custody in {cur}"));
            }
        }
    }

    // Structures: footprints on the ground, on terrain they can stand on, not overlapping.
    let mut covered: BTreeMap<String, &str> = BTreeMap::new();
    let mut structures = BTreeMap::new();
    for s in &w.structures {
        let ty = types.get(s.structure_type.as_str()).ok_or_else(|| format!("structure {} has unknown type {}", s.id, s.structure_type))?;
        if let Some(b) = &s.built_by {
            entity(b)?;
        }
        let cells = footprint_cells(&detailed, &s.at, ty.footprint).ok_or_else(|| format!("structure {} doesn't fit on the detailed ground at {}", s.id, s.at))?;
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
    let mut placed: BTreeSet<&str> = BTreeSet::new();
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
        // A body is in one place at a time (world-expansion 6.4).
        if !placed.insert(o.occupant.as_str()) {
            return Err(format!("{} is in more than one space: a body is in one place at a time", o.occupant));
        }
        let u = used.entry(o.space.as_str()).or_default();
        *u += 1;
        if *u > spec.capacity as u64 {
            return Err(format!("space {} is over its capacity of {}", o.space, spec.capacity));
        }
    }

    // Resources and holdings (phase B): kinds unique; holdings of a known kind, held by an entity, at a structure or
    // (an edge only) at itself; within range; each (holder, place, kind) once.
    let kinds: BTreeSet<&str> = c.catalogue.resources.iter().map(|r| r.id.as_str()).collect();
    if kinds.len() != c.catalogue.resources.len() {
        return Err("a resource kind is declared twice".into());
    }
    // Tasks, variables and materials (phase B): what they name exists; bounds hold; a working day wherever work takes time.
    let var_ids: BTreeSet<&str> = c.catalogue.variables.iter().map(|v| v.id.as_str()).collect();
    if var_ids.len() != c.catalogue.variables.len() {
        return Err("a variable is declared twice".into());
    }
    for v in &c.catalogue.variables {
        if !(v.min <= v.initial && v.initial <= v.max) {
            return Err(format!("variable {}: needs min <= initial <= max", v.id));
        }
        for ty in v.types.iter().flatten() {
            if !types.contains_key(ty.as_str()) {
                return Err(format!("variable {} names unknown structure type {ty}", v.id));
            }
        }
    }
    let task_ids: BTreeSet<&str> = c.catalogue.tasks.iter().map(|t| t.id.as_str()).collect();
    if task_ids.len() != c.catalogue.tasks.len() {
        return Err("a task is declared twice".into());
    }
    let mut work_takes_time = false;
    for t in &c.catalogue.tasks {
        if t.id == TASK_BUILD || t.id == TASK_DEMOLISH {
            return Err(format!("task id {} is built in", t.id));
        }
        if t.labour < 0 {
            return Err(format!("task {}: labour can't be negative", t.id));
        }
        work_takes_time |= t.labour > 0;
        for k in t.consumes.keys().chain(t.produces.keys()) {
            if !kinds.contains(k.as_str()) {
                return Err(format!("task {} names unknown resource {k}", t.id));
            }
        }
        for (k, q) in t.consumes.iter().chain(t.produces.iter()) {
            if *q < 1 {
                return Err(format!("task {}: {k} must be a positive quantity", t.id));
            }
        }
        for v in t.changes.keys() {
            if !var_ids.contains(v.as_str()) {
                return Err(format!("task {} changes unknown variable {v}", t.id));
            }
        }
    }
    for ty in &c.catalogue.structure_types {
        if ty.build_labour < 0 || ty.demolition_labour < 0 {
            return Err(format!("structure type {}: labour can't be negative", ty.id));
        }
        work_takes_time |= ty.build_labour > 0 || ty.demolition_labour > 0;
        for (k, q) in &ty.materials {
            if !kinds.contains(k.as_str()) || *q < 1 {
                return Err(format!("structure type {}: materials must be positive quantities of declared resources ({k})", ty.id));
            }
        }
    }
    if work_takes_time && c.catalogue.working_day.is_none() {
        return Err("work takes time in this world (a task or a building's labour), so catalogue.working_day is needed".into());
    }
    let mut holding_keys = BTreeSet::new();
    for st in &w.holdings {
        if !kinds.contains(st.kind.as_str()) {
            return Err(format!("a holding of {}, which the catalogue doesn't declare", st.kind));
        }
        entity(&st.holder)?;
        let edge = w.boundaries.contains(&st.holder);
        if !(structures.contains_key(st.at.as_str()) || (edge && st.at == st.holder)) {
            return Err(format!("{}'s holding of {} is at {}, which isn't a structure (or, for an edge, itself)", st.holder, st.kind, st.at));
        }
        if !(0..=oikos_core::money::MAX_MONEY).contains(&st.quantity) && !edge {
            return Err(format!("{}'s holding of {} is out of range", st.holder, st.kind));
        }
        if !holding_keys.insert((st.holder.as_str(), st.at.as_str(), st.kind.as_str())) {
            return Err(format!("{}'s holding of {} at {} is given twice", st.holder, st.kind, st.at));
        }
    }

    // Who knows what (docs/design/knowing.md): each thing published once, each register with one keeper who exists
    // and answers by fields a search can use; then every channel is checked against it.
    let k = &c.knowing;
    let mut said = BTreeSet::new();
    for p in &k.published {
        if !said.insert(p.what.as_str()) {
            return Err(format!("knowing.published names {} twice", p.what));
        }
        if p.most.is_some_and(|n| n == 0 || n > SEARCH_MAX) || (p.most.is_some() && p.board != Some(true)) {
            return Err(format!("knowing.published {}: `most` is a board's, 1..={SEARCH_MAX}", p.what));
        }
    }
    let mut kept = BTreeSet::new();
    for x in &k.keepers {
        entity(&x.entity)?;
        if !kept.insert((x.entity.as_str(), x.what.as_str())) {
            return Err(format!("knowing.keepers names {} as keeper of {} twice", x.entity, x.what));
        }
        if said.contains(x.what.as_str()) {
            return Err(format!("knowing: {} is published and kept: one or the other", x.what));
        }
        for a in &x.answers {
            if !matches!(a.by.as_str(), "id" | "claim" | "holder" | "speaks_for") && a.by.strip_prefix("data.").or_else(|| a.by.strip_prefix("about.")).is_none_or(|p| p.is_empty()) {
                return Err(format!("knowing.keepers {} {}: {} isn't a field a question can name its subject by", x.entity, x.what, a.by));
            }
            if a.most.is_some_and(|n| n == 0 || n > SEARCH_MAX) {
                return Err(format!("knowing.keepers {} {}: `most` is 1..={SEARCH_MAX}", x.entity, x.what));
            }
            for t in a.to.iter().flatten() {
                entity(t)?;
            }
        }
    }
    if k.visit_seconds.is_some_and(|s| !(0..=30 * 86_400).contains(&s)) {
        return Err("knowing.visit_seconds is out of range".into());
    }
    let premises = premises_of_positions(c.positions.iter().map(|p| (p.entity.as_str(), p.channels.as_slice())));
    let entity_exists = |e: &str| entities.contains_key(e);
    let premises_of = |cell: &str| premises.get(cell).cloned();
    macro_rules! seat {
        ($organisation:expr) => {
            Seat { organisation: $organisation, knowing: k, premises_most: None, entity_exists: &entity_exists, cell_exists: &cell_exists, place_exists: &place_exists, premises_of: &premises_of }
        };
    }

    // Participants: persons have bodies of their own; systems belong to organisations.
    let mut bodies = BTreeSet::new();
    let mut deputies: Vec<(&str, &str)> = vec![];
    for p in &c.participants {
        if p.shares_body && p.kind != ParticipantKind::Person {
            return Err(format!("participant {} shares a body, and only a person's participant can", p.id));
        }
        match p.kind {
            ParticipantKind::Person => {
                let person = p.person.as_deref().ok_or_else(|| format!("participant {} is a person's but names no person", p.id))?;
                if entity(person)?.kind != PERSON {
                    return Err(format!("participant {}: {person} isn't a person", p.id));
                }
                if p.owner.is_some() {
                    return Err(format!("participant {} is a person's, so it has no owner", p.id));
                }
                if p.shares_body {
                    deputies.push((p.id.as_str(), person));
                } else if !bodies.insert(person) {
                    return Err(format!("{person} has more than one participant of their own"));
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
        check_channels(&format!("participant {}", p.id), &p.channels, &seat!(None))?;
        check_traits(&format!("participant {}", p.id), &p.traits)?;
    }
    for (id, person) in &deputies {
        if !bodies.contains(person) {
            return Err(format!("participant {id} shares {person}'s body, and {person} has no participant of their own"));
        }
    }
    for t in &c.templates {
        if t.kind == ParticipantKind::System && !t.channels.is_empty() {
            return Err(format!("template {}: a system has no personal channels", t.id));
        }
        check_channels(&format!("template {}", t.id), &t.channels, &seat!(None))?;
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
        check_channels(&format!("position {}", p.id), &p.channels, &seat!(Some(p.entity.as_str())))?;
        if p.keeps_record && p.record_keeper_name().is_none() {
            return Err(format!("position {}: keeps_record needs a role_module with a code", p.id));
        }
    }
    let mut keeping: BTreeMap<&str, &str> = BTreeMap::new();
    for p in c.positions.iter().filter(|p| p.keeps_record) {
        if let Some(first) = keeping.insert(p.entity.as_str(), p.id.as_str()) {
            return Err(format!("positions {first} and {} both keep the record of {}: at most one position of an organisation does", p.id, p.entity));
        }
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
            if b.ages[0] > b.ages[1] || b.gestation < 1 || b.reach < 0 || b.female_bps.is_some_and(|f| f > 10_000) {
                return Err("life.birth: ages lo <= hi, gestation positive, reach 0 or more, female_bps at most 10000".into());
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
        for other in r.body.records_referenced().into_iter().chain(r.basis.iter().flat_map(|b| b.ids()).map(String::as_str)) {
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

    // Systems come from a supplier (foundations F4). A template's supplier is an organisation of the world; a template
    // that lists what it does lists only systems' work. A system that holds a post was delivered: it names the template
    // it is from (a system's) and the organisation that supplied it, which is the world's delivery at its start.
    let org_exists = |who: &str, what: &str| -> Result<(), String> {
        match entities.get(who) {
            None => Err(format!("{what}: unknown entity {who:?}")),
            Some(e) if e.kind == PERSON => Err(format!("{what}: {who} is a person, and only an organisation supplies a system")),
            Some(_) => Ok(()),
        }
    };
    for t in &c.templates {
        if t.kind == ParticipantKind::Person && (t.does.is_some() || t.supplier.is_some()) {
            return Err(format!("template {}: a person's has no `does` or supplier (only a system is supplied)", t.id));
        }
        if let Some(s) = &t.supplier {
            org_exists(s, &format!("template {}: its supplier", t.id))?;
        }
        // A system can do only what its template lists (foundations F5): a template that says nothing of it is refused, never read as no limit.
        if t.kind == ParticipantKind::System && t.does.is_none() {
            return Err(format!("template {}: a system's template says what it does (`does`)", t.id));
        }
        for r in t.does.iter().flatten() {
            if r.seconds.is_some_and(|x| x < 1) || (r.seconds.is_some() && r.block != "work") {
                return Err(format!("template {}: `seconds` is a work row's, and is positive", t.id));
            }
        }
    }
    let template_of: BTreeMap<&str, &Template> = c.templates.iter().map(|t| (t.id.as_str(), t)).collect();
    for p in &c.participants {
        if p.kind == ParticipantKind::System && (p.template.is_none() || p.supplier.is_none()) {
            return Err(format!("system participant {}: nobody supplied it (it names its template and supplier)", p.id));
        }
        if p.kind == ParticipantKind::Person && (p.template.is_some() || p.supplier.is_some()) {
            return Err(format!("participant {} is a person's, so it has no supplier", p.id));
        }
        if let Some(t) = &p.template {
            if template_of.get(t.as_str()).is_none_or(|t| t.kind != ParticipantKind::System) {
                return Err(format!("system participant {}: no system template {t:?}", p.id));
            }
        }
        if let Some(s) = &p.supplier {
            org_exists(s, &format!("system participant {}: its supplier", p.id))?;
        }
    }
    for pos in c.positions.iter().filter(|x| x.holder.is_some()) {
        let h = participants[pos.holder.as_deref().unwrap_or_default()];
        if h.kind == ParticipantKind::System && (h.template.is_none() || h.supplier.is_none()) {
            return Err(format!("position {} is held by {}, a system nobody supplied (it names its template and supplier)", pos.id, h.id));
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
    /// A look-up (a directory): whom.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<Who>,
    /// Going to look (a map whose way is `visit`): where.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visit: Option<Visit>,
}

/// Whom a directory is asked about: one entity, one participant, one position, a name, or an organisation's holders
/// of one role (`entity` with `role`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Who {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participant: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

impl Who {
    /// Exactly one of the forms: an entity (with or without a role), a participant, a position, or a name.
    pub fn well_formed(&self) -> bool {
        matches!(
            (&self.entity, &self.participant, &self.position, &self.name, &self.role),
            (Some(_), None, None, None, _) | (None, Some(_), None, None, None) | (None, None, Some(_), None, None) | (None, None, None, Some(_), None)
        )
    }
}

/// The places a visit goes to, in order: buildings, or cells of ground.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Visit {
    pub places: Vec<Id>,
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
