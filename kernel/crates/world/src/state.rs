//! Mutable world state (v0.4). Every map is ordered, so serialization (and
//! hence the state hash) is deterministic. Static facts (the catalogue,
//! templates, the physics of life) live in the config, which the log header
//! carries.
//!
//! The state holds physics (bodies, accounts, ground, structures, who is in
//! which space), the append-only record store, and the cast: participants
//! (whatever decides) and positions (organisations' roles, and who holds
//! them). Nothing in it describes law or authority: holding a position is the
//! physical capacity to act for an organisation, never a legal right.

use crate::blocks::{Id, Record};
use crate::config::{Channel, ParticipantKind};
use crate::events::RefusalCode;
pub use crate::vocab::{ConditionKind, DeathCause, Sex};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Persistent (structurally shared) ordered map: cloning the state for an
/// all-or-nothing action is O(1), and only what the action touches is copied.
/// Iterates in key order, like BTreeMap, so serialization is unchanged.
pub type Map<K, V> = imbl::OrdMap<K, V>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub t: i64,
    pub counters: Counters,
    pub entities: Map<Id, Entity>,
    /// (Values behind `Arc`, here and in `participants`: a state's copy for an action then shares them, and changing one
    /// copies only it, not the 64 values of the tree node it's in. Serialised as the values themselves.)
    pub accounts: Map<Id, Arc<Account>>,
    /// Holdings of resources (phase B), keyed `holder|at|kind` (holding_key): who holds how much of what, where.
    #[serde(default)]
    pub holdings: Map<String, Holding>,
    /// Accounts that have been closed, kept so those who keep or hold them perceive the closure.
    pub closed_accounts: Map<Id, ClosedAccount>,
    pub cells: Map<Id, Cell>,
    pub structures: Map<Id, Structure>,
    /// structure -> space -> the bodies in it. (Each structure's behind an `Arc`, as accounts are, and each space's
    /// departures below: a move copies the one changed, not the 64 of the tree node it's in.)
    pub occupancy: Map<Id, Arc<BTreeMap<Id, BTreeSet<Id>>>>,
    /// body -> the structures it's in (in any space), in id order: derived from `occupancy` and kept with it (`enter`,
    /// `left_space`), never serialised, so the state and its hash are unchanged. For finding where someone is without
    /// looking through every building (`structures_of`).
    #[serde(skip)]
    pub whereabouts: Map<Id, BTreeSet<Id>>,
    /// space -> its last few departures (who left, why, when): what those who can see who's there also see.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub departures: Map<Id, Arc<Vec<Departure>>>,
    /// space -> when someone last went into it: what anyone outside can see (never who).
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub entered: Map<Id, i64>,
    pub records: Map<Id, Stored>,
    /// Each agreement's signatures and notices, as they're made: derived from the records (never serialised, so the
    /// state and its hash are unchanged), for reading agreements by their terms without scanning every record.
    #[serde(skip)]
    pub marks: Map<Id, AgreementMarks>,
    /// Each party's agreements, in the order they were made: derived like `marks`, for answering what's in force with
    /// someone (the truth audits, docs/design/rebuild.md 8.2).
    #[serde(skip)]
    pub agreements_of: Map<Id, imbl::Vector<Id>>,
    /// Travel times already worked out, while the ground they cross is unchanged (derived: never serialised, ignored by
    /// equality; see travel.rs).
    #[serde(skip)]
    pub ground: GroundCache,
    /// Record ids in the order they were made (record i has seq i+1).
    pub record_order: imbl::Vector<Id>,
    pub participants: Map<Id, Arc<Participant>>,
    pub positions: Map<Id, Position>,
    /// entity -> its positions, and participant -> the positions it holds, each in id order: derived from `positions`
    /// and kept with it (`add_position`, `set_holder`: the only ways a position is made or changes hands), never
    /// serialised, so the state and its hash are unchanged. For finding who acts for an organisation, and what a
    /// participant acts in, without looking through every position (`acting_for`, `held_by`).
    #[serde(skip)]
    pub positions_of: Map<Id, BTreeSet<Id>>,
    #[serde(skip)]
    pub held: Map<Id, BTreeSet<Id>>,
    /// What an office keeps on file: every transaction on its organisation's accounts that a post with an accounts channel
    /// would have been told of, by `transactions_key(post, organisation)`, whoever held the post then (or nobody). A new
    /// holder is handed it as the payments it has not yet been told of, so it reads its office's books and not an empty
    /// memory. Derived from the log (never serialised, so the state and its hash are unchanged).
    #[serde(skip)]
    pub ledgers: Map<String, imbl::Vector<Arc<Transaction>>>,
    /// Future physical effects and acts in progress, sorted by (at, seq).
    pub schedule: Schedule,
    /// Each actor's timeline (docs/design/rebuild.md 6.3): when each of its lanes is next free. A person's is keyed by
    /// their body, shared by every participant and capacity acting as them; a system's by the participant.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub timelines: Map<Id, Timeline>,
    /// Nature (docs/design/world-expansion.md 2): fields, populations, extinctions, covers' succession. Changed once a
    /// day, so kept behind an `Arc`: an action's copy of the state shares it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nature: Option<Arc<oikos_nature::NatureState>>,
    /// The world's totals (catalogue `counters`: greenhouse gas), as work adds to them.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub totals: BTreeMap<Id, i64>,
    /// Buildings under water now (world-expansion 7.3).
    #[serde(default, skip_serializing_if = "imbl::OrdSet::is_empty")]
    pub flooded: imbl::OrdSet<Id>,
    /// Goods taken without consent (world-expansion 7.3): the truth, which investigation can find.
    /// (A persistent vector, like the maps: it grows with the run, and an act's copy of the state shares it.)
    #[serde(default, skip_serializing_if = "imbl::Vector::is_empty")]
    pub takings: imbl::Vector<Taking>,
    /// Questions put to a register's keeper that nobody was there to answer (no one of its posts present and on duty), in
    /// the order asked: taken up, one after another, when someone is (checked each hour while any are held).
    ///
    /// Behind a shared pointer, like the state's persistent maps: every act copies the state to dry-run or apply it, and a
    /// plain list of thousands of held questions (a large town's) was copied whole each time. Serialised as the list it is.
    #[serde(default, skip_serializing_if = "held_is_empty")]
    pub asks_held: Arc<Vec<HeldAsk>>,
    /// Each entity's own record (docs/design/ai-citizens.md 10d): who they are and how things stand with them, as
    /// their mind keeps it. Held here and written only here (the `entity_record` command); bounded in size
    /// (`caps.entity_record_bytes`), so it never grows. The kernel reads none of it: its sections are opaque.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub entity_records: Map<Id, Arc<EntityRecord>>,
    /// Vehicles (reserved shapes for travel, docs/design/travel.md): each its type, its owner and where it stands, as
    /// the config declares them. Things their owners own; nothing moves them yet.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub vehicles: Map<Id, Vehicle>,
    /// Bodies on their way between places (reserved: nothing puts anyone in transit yet; a visit is still the time it
    /// takes, spent where one set out). Keyed by the body.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub transit: Map<Id, Transit>,
    /// The network for what flows (foundations-2 C3, law 8): each link's state, each connection with its meter. Behind
    /// an `Arc`, as nature is: settled hourly, and an action's copy of the state shares it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub network: Option<Arc<crate::network::NetState>>,
    /// What each edge has sold of a scarce kind this period (`edge|kind` -> (the period, how much)): foundations-2 C6.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub scarce_sold: Map<String, (i64, crate::money::Money)>,
}

/// A vehicle as the world keeps it (reserved shapes for travel).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vehicle {
    #[serde(rename = "type")]
    pub type_: Id,
    pub owner: Id,
    /// A cell, or a structure.
    pub at: Id,
}

/// A body on its way (reserved shapes for travel): from where, to where, when it set out and when it arrives, and by
/// which road and vehicle, where it goes by one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transit {
    pub from: Id,
    pub to: Id,
    pub departed: i64,
    pub arrives: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub road: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vehicle: Option<Id>,
}

/// An entity's own record: its sections (opaque, whole numbers only), how many times it has been set (`n`), when
/// last (`at`), and the chain of its changes: each change's hash over the one before, so the record can be rebuilt
/// from the log and checked (`oikos record`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityRecord {
    pub n: u64,
    pub at: i64,
    pub chain: String,
    /// (Frozen: a record set again shares the sections it does not change with the record before it.)
    pub sections: BTreeMap<Id, crate::blocks::Frozen>,
    /// The change stamp of its last change.
    pub changed: u64,
}

/// The most an entity's record may hold where the world says nothing (canonical bytes of its sections).
pub const ENTITY_RECORD_BYTES: u64 = 8192;
/// The most sections a record may have.
pub const ENTITY_RECORD_SECTIONS: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Taking {
    pub t: i64,
    pub by: Id,
    pub from: Id,
    pub kind: Id,
    pub at: Id,
}

/// Future physical effects in (at, seq) order: a persistent map, so the state's copy for each action is cheap (a
/// plain list was copied whole on every act). Serialised as the ordered list it always was.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Schedule(imbl::OrdMap<(i64, u64), Scheduled>);

impl Schedule {
    pub fn first(&self) -> Option<&Scheduled> {
        self.0.get_min().map(|(_, v)| v)
    }
    pub fn pop_first(&mut self) -> Option<Scheduled> {
        let k = self.0.get_min()?.0;
        self.0.remove(&k)
    }
    pub fn insert(&mut self, item: Scheduled) {
        self.0.insert((item.at, item.seq), item);
    }
    pub fn remove(&mut self, at: i64, seq: u64) -> Option<Scheduled> {
        self.0.remove(&(at, seq))
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    pub fn iter(&self) -> impl Iterator<Item = &Scheduled> {
        self.0.values()
    }
}

impl Serialize for Schedule {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(self.0.values())
    }
}

impl<'de> Deserialize<'de> for Schedule {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let items: Vec<Scheduled> = Vec::deserialize(d)?;
        Ok(Schedule(items.into_iter().map(|x| ((x.at, x.seq), x)).collect()))
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Counters {
    pub ent: u64,
    pub acc: u64,
    pub str: u64,
    pub rec: u64,
    pub act: u64,
    pub msg: u64,
    pub par: u64,
    pub pos: u64,
    pub cnd: u64,
    pub sched: u64,
    /// Order in which records were made; records channels deliver those after a participant's last look.
    pub record_seq: u64,
    pub created_entities: u64,
    /// Order of changes to accounts, cells, entities and positions: other channels deliver
    /// what changed after a participant's last look (perception is changes, not snapshots).
    pub change: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entity {
    pub kind: String,
    pub name: String,
    /// The change stamp at which it came to exist, or its body last changed (0: from the start).
    pub changed: u64,
    /// The change stamp at which the spaces it occupies last changed (0: never).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub moved: u64,
    /// Persons only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Body>,
}

fn is_zero(x: &u64) -> bool {
    *x == 0
}

/// A person's physical self.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Body {
    pub born_at: i64,
    /// Biological sex, where the world models it (who can bear a child). Physics only: gender is content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sex: Option<Sex>,
    /// In the world, or outside it.
    pub present: bool,
    pub alive: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parents: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditions: Vec<Condition>,
    /// Its participant (the one that decides for it), if it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participant: Option<Id>,
    /// Its biological children, in order of birth (the other side of `parents`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Id>,
    /// Its variables (the catalogue's `body_variables`): each value, as of a time (drift settles from then).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub variables: BTreeMap<Id, (i64, i64)>,
}

/// A body's variables as they start: what's given (clamped to the bounds), else each one's `initial`, as of `t`.
pub fn body_variables(cat: &crate::config::Catalogue, given: Option<&BTreeMap<Id, i64>>, t: i64) -> BTreeMap<Id, (i64, i64)> {
    cat.body_variables.iter().map(|v| (v.id, (given.and_then(|g| g.get(&v.id)).copied().unwrap_or(v.initial).clamp(v.min, v.max), t))).collect()
}

/// A body variable's value at `t`, settled: its drift a whole day at a time since it was last set; and the time it's
/// settled to (whole days on, so no part of a day's drift is lost when it's written back).
pub fn body_variable_at(cfg: &crate::config::BodyVariableCfg, (v, at): (i64, i64), t: i64) -> (i64, i64) {
    if cfg.per_day == 0 || t <= at {
        return (v, at);
    }
    let days = (t - at) / 86_400;
    (v.saturating_add(cfg.per_day.saturating_mul(days)).clamp(cfg.min, cfg.max), at + days * 86_400)
}

/// Someone leaving a space: who, why (they left, were removed, died, ...), and when.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Departure {
    pub occupant: Id,
    pub reason: crate::events::VacateReason,
    pub at: i64,
}

/// How many departures a space keeps.
pub const DEPARTURES_KEPT: usize = 5;

impl State {
    /// Note that someone left a space (keeping the last few).
    pub fn record_departure(&mut self, space: &str, occupant: &str, reason: crate::events::VacateReason) {
        let t = self.t;
        let mut list = self.departures.get(space).map(|l| (**l).clone()).unwrap_or_default();
        list.push(Departure { occupant: occupant.into(), reason, at: t });
        if list.len() > DEPARTURES_KEPT {
            list.remove(0);
        }
        self.departures.insert(space.into(), Arc::new(list));
    }
}

/// Something wrong with a body for a while: a category and a severity band (the world's
/// vocabulary), from when to when. Not a meter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Condition {
    pub id: Id,
    pub kind: ConditionKind,
    pub severity: String,
    pub since: i64,
    pub until: i64,
    /// When a death from it is due (the kernel's; never in a view).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub death_at: Option<i64>,
    /// Care has been given for it (once is all that counts).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub treated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    pub holder: Id,
    pub custodian: Id,
    /// Its currency: every amount in or out of it is in this unit.
    pub currency: Id,
    #[serde(with = "crate::money::amount")]
    pub balance: crate::money::Money,
    /// The change stamp of its last change (opened, balance moved).
    pub changed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cell {
    pub x: i64,
    pub y: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terrain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<Id>,
    /// The change stamp of its last change (a building started, finished or gone; who's inside changed).
    pub changed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Structure {
    /// The corner cell, and every cell it stands on.
    pub at: Id,
    pub cells: Vec<Id>,
    pub structure_type: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub built_by: Option<Id>,
    pub complete: bool,
    /// While being built: when its build time is up (None once it has passed, if it's still waiting on labour).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completes_at: Option<i64>,
    /// Seconds of building work done on it (phase B).
    #[serde(default, skip_serializing_if = "is_zero_i64")]
    pub labour_done: i64,
    /// Coming down (phase B): seconds of demolition work done so far.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub demolition: Option<i64>,
    /// Its state variables (phase B): each one's value as of a day (the start of it), settled when occupancy changes
    /// or work changes it; read at any later time by adding the whole days since.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub variables: std::collections::BTreeMap<Id, (i64, i64)>,
}

fn is_zero_i64(x: &i64) -> bool {
    *x == 0
}

/// An agreement's signatures and notices (State::marks).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgreementMarks {
    pub signatures: Vec<oikos_terms::Mark>,
    pub notices: Vec<oikos_terms::Mark>,
    /// When the paper's owner withdrew it (the first such withdrawal stored): an offer that no longer stands.
    pub withdrawn_at: Option<i64>,
}

impl State {
    /// The reading of an agreement by its terms, now (docs/design/rebuild.md section 7), if it's an agreement.
    pub fn reading(&self, agreement: &str) -> Option<oikos_terms::Reading> {
        let stored = self.records.get(agreement)?;
        let crate::blocks::RecordBody::Agreement { terms } = &stored.record.body else { return None };
        let m = self.marks.get(agreement).cloned().unwrap_or_default();
        Some(oikos_terms::read(terms, &m.signatures, &m.notices, self.t))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stored {
    pub seq: u64,
    /// Records are immutable once made, so copies of the state share them.
    pub record: Arc<Record>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantStatus {
    Active,
    /// Left the study (VISION §15). With a stand-in it carries on; without one it never acts again.
    OptedOut,
    /// Its body died, or its system was retired: it never acts again.
    Ended,
}

/// What a participant is (fixed when it's created). Shared between copies of the state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParticipantDef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// (Its channels, controller and framing are shared with the config they came from.)
    #[serde(default, skip_serializing_if = "crate::config::no_channels")]
    pub channels: Arc<Vec<Channel>>,
    pub controller: crate::config::Controller,
    pub framing: Arc<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_opt_out: Option<Value>,
    /// A system's lanes (acts at once); absent: one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lanes: Option<u32>,
}

impl ParticipantDef {
    pub fn vacant_after_opt_out(&self) -> bool {
        !matches!(&self.on_opt_out, Some(Value::Object(_)))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Participant {
    pub kind: ParticipantKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub person: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<Id>,
    /// A system's: the organisation that delivered it (it may switch it off, as its owner may).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supplier: Option<Id>,
    pub def: Arc<ParticipantDef>,
    /// Its own parameters, as drawn when it was created.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traits: Option<Value>,
    pub status: ParticipantStatus,
    /// The change stamp of the last status change (0: from the start).
    pub status_changed: u64,
    /// Delivered at its next observation of each capacity ("self", or a position id), then cleared.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub pending: BTreeMap<crate::blocks::Passing, Pending>,
    /// Delivered by its next look through an accounts channel of a capacity acting for that entity.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    /// (A persistent list: a busy custodian's queue holds a day's transfers, and a copy of the participant shares it;
    /// each transaction one copy, shared by every queue and office file it is on and the looks that deliver it.)
    pub new_transactions: BTreeMap<Id, imbl::Vector<Arc<Transaction>>>,
    /// When it last looked through each channel (`channel`, or `position/channel`), and how far it had seen.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub looks: BTreeMap<Id, Look>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pending {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outcomes: Vec<Outcome>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inbox: Vec<Message>,
    /// What its visits found (docs/design/knowing.md), each as of when the looker was there.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub visits: Vec<crate::sites::Visited>,
    /// Questions to a register's keeper that have been answered (foundations F11): each is looked through again, with
    /// the observation it comes with, as the register is when it is delivered.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub asks: Vec<crate::config::LookRequest>,
    /// The channels it has put a question to a keeper through and is not yet answered (each once for each question).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub asked: Vec<Id>,
}

impl Pending {
    pub fn is_empty(&self) -> bool {
        self.outcomes.is_empty() && self.inbox.is_empty() && self.visits.is_empty() && self.asks.is_empty() && self.asked.is_empty()
    }
}

/// A role through which a participant acts for an organisation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub entity: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub channels: Arc<Vec<Channel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_module: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holder: Option<Id>,
    /// The change stamp of its last change (created, or handed over).
    pub changed: u64,
}

/// A participant's last look through a channel: when, and the cursor it had reached
/// (the record sequence for records channels, the change stamp for the others).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Look {
    pub at: i64,
    pub cursor: u64,
    /// For a channel that looks near the capacity's entity: where it was then (the entity's `moved` stamp).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<u64>,
    /// Looked through in an earlier tenure of the post, which the holder has since lost and been given again: the next
    /// look is the office's file whole, said to be whole, so that what the holder kept of it from before is replaced, not
    /// added to (`set_holder`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub anew: bool,
}

/// A holding of a resource: a quantity of a kind, held by an entity, at a place (a structure, or an edge itself).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Holding {
    pub kind: Id,
    pub holder: Id,
    pub at: Id,
    #[serde(with = "crate::money::amount")]
    pub quantity: crate::money::Money,
    /// The change stamp of its last change.
    pub changed: u64,
}

/// A holding's key: sorted by holder, then place, then kind.
pub fn holding_key(holder: &str, at: &str, kind: &str) -> String {
    format!("{holder}|{at}|{kind}")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClosedAccount {
    pub holder: Id,
    pub custodian: Id,
    pub currency: Id,
    pub changed: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeStatus {
    Applied,
    Refused,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RefusalInfo {
    pub code: RefusalCode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outcome {
    pub action: crate::blocks::Passing,
    pub t: i64,
    pub status: OutcomeStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<BTreeMap<String, Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refusal: Option<RefusalInfo>,
    /// What an investigation found, seen only by the one who investigated: `{from, at, kind, taker}` (taker null: not found).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub investigated: Option<serde_json::Value>,
    /// A survey's estimates (nature), seen only by the one who surveyed: `{of, cells: {cell: estimate}}`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surveyed: Option<serde_json::Value>,
    /// Work done on buildings by people sent to them (docs/design/knowing.md: those doing it were there): each
    /// building worked on, as they left it, seen only by the one whose work it was.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub seen: Vec<crate::sites::SiteStructure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub id: crate::blocks::Passing,
    pub t: i64,
    /// The participant who wrote it, and the position it wrote in (absent: as itself).
    pub from: Id,
    #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
    pub from_position: Option<Id>,
    /// Who acted in writing it: the person, or the organisation acted for through the position (contracts 0.7).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_entity: Option<Id>,
    pub to: Vec<Id>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub re: Option<Id>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    pub t: i64,
    pub from: Id,
    pub to: Id,
    #[serde(with = "crate::money::amount")]
    pub amount: crate::money::Money,
    pub currency: Id,
    pub by: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settles: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_instruction: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scheduled {
    pub at: i64,
    pub seq: u64,
    pub what: Sched,
}

/// One actor's account of time (docs/design/foundations.md law 1; step F1): when each of its lanes is next free, and,
/// for a body that works, how much of its working day (`catalogue.working_day`) has been placed on that day. There is
/// no other ledger: work is placed on the timeline of every performer, and the day's limit is read where it is placed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Timeline {
    pub lanes: Vec<i64>,
    /// (day, seconds of work placed on it), for a body that has worked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worked: Option<(i64, i64)>,
    /// The day before `worked`'s that work was placed on, when work was placed on an earlier day than one already counted
    /// (work queued ahead on a later day, then work placed today): so that neither day's count is lost.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worked_before: Option<(i64, i64)>,
}

/// What an act's `work` took of its performers' time when the act began: the day it was counted on and the seconds of
/// each performer's (given back if the act is refused when done: time not worked is not counted against the day), or
/// the performer whose working day had no room for it (the act is then refused for that).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Placed {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub over: Option<String>,
    #[serde(default)]
    pub day: i64,
    /// When the work's hours were placed from (they run on, and may cross midnight: each day is counted its own part).
    #[serde(default, skip_serializing_if = "is_zero_i64")]
    pub from: i64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub hours: BTreeMap<Id, i64>,
    /// Who was where when the work was ordered (see `Exec::seen`): what it is on -> the bodies there.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub seen: BTreeMap<Id, Vec<Id>>,
    /// The work could not be checked when the act began (a dry run refused it, say for someone not there yet): it is
    /// placed when the act takes effect.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub late: bool,
    /// Nobody priced the act for whoever would do it (law 10, foundations-2 P2): it takes nobody's time and is refused
    /// (`unpriced`) when due, with this reason.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unpriced: Option<String>,
}

/// A person who is to be at work when an act's work begins: alive, in the world, and, if `at` is given, in that
/// structure (in a space of `space`'s kind, if given); else, if the world names where work is done, in a space of that kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkCheck {
    pub who: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
}

impl Placed {
    pub fn is_empty(&self) -> bool {
        self.over.is_none() && self.hours.is_empty() && self.seen.is_empty() && !self.late
    }
}

impl Timeline {
    /// Seconds of work already placed on this day.
    pub fn worked_on(&self, day: i64) -> i64 {
        self.worked.into_iter().chain(self.worked_before).find(|(d, _)| *d == day).map_or(0, |(_, s)| s)
    }

    /// Seconds of work placed on a day (negative: given back). Two days are kept, the latest and the one before it.
    pub fn add_worked(&mut self, day: i64, secs: i64) {
        match (self.worked, self.worked_before) {
            (Some((d, s)), _) if d == day => self.worked = Some((d, (s + secs).max(0))),
            (_, Some((d, s))) if d == day => self.worked_before = Some((d, (s + secs).max(0))),
            (Some((d, _)), _) if day < d => {
                if secs > 0 {
                    self.worked_before = Some((day, secs));
                }
            }
            _ => {
                if secs > 0 {
                    self.worked_before = self.worked;
                    self.worked = Some((day, secs));
                }
            }
        }
    }
}

impl std::ops::Deref for Timeline {
    type Target = Vec<i64>;
    fn deref(&self) -> &Vec<i64> {
        &self.lanes
    }
}

impl<'a> IntoIterator for &'a Timeline {
    type Item = &'a i64;
    type IntoIter = std::slice::Iter<'a, i64>;
    fn into_iter(self) -> Self::IntoIter {
        self.lanes.iter()
    }
}

fn held_is_empty(v: &Arc<Vec<HeldAsk>>) -> bool {
    v.is_empty()
}

/// A question a keeper has not yet taken up (State::asks_held).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeldAsk {
    pub participant: Id,
    #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
    pub position: Option<Id>,
    pub keeper: Id,
    pub look: crate::config::LookRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Sched {
    /// Held questions looked at again: is someone there now to answer them?
    HeldAsks,
    /// The network settled (foundations-2 C3): each hour, and a kind settled daily at midnight.
    Settle,
    StructureComplete { structure: Id },
    /// Nature's day (docs/design/world-expansion.md 2): covers, fields and populations stepped.
    NatureDay { day: i64 },
    /// The world's totals, censused (monthly).
    CounterCensus,
    /// A year of age: draws for the coming year (illness, injury, other causes).
    Birthday { person: Id },
    /// A drawn chance of injury, taken now against the danger of where the body is (thinning).
    Exposure { person: Id, max_bps: u32 },
    ConditionBegins { person: Id, kind: ConditionKind, severity: String, until: i64, #[serde(default, skip_serializing_if = "Option::is_none")] death_at: Option<i64> },
    ConditionEnds { person: Id, condition: Id },
    /// A death, from a condition (it happens only if the condition still says it's due now) or not.
    Death { person: Id, cause: DeathCause, #[serde(default, skip_serializing_if = "Option::is_none")] condition: Option<Id> },
    /// A chance of illness (thinning, as `Exposure`): drawn at `max_bps`, kept at the rate where the body is now.
    IllnessExposure { person: Id, max_bps: u32, age: i64 },
    BirthDue { parents: Vec<Id>, name: String, template: Id },
    /// An act in progress: it takes effect when its actor is done with it (docs/design/rebuild.md 6.2).
    Act {
        action: crate::blocks::Passing,
        participant: Id,
        #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
        position: Option<Id>,
        blocks: Vec<crate::blocks::Block>,
        /// Who the action named to do its work (`by`), apart from any a `work` names.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        by: Vec<Id>,
        /// How the act's work was placed on its performers' timelines (nothing, for an act with no work).
        #[serde(default, skip_serializing_if = "Placed::is_empty")]
        placed: Placed,
    },
    /// The start of an act whose work could not begin when it was ordered (its performers were busy): who is to be at
    /// work is looked at now, when the work begins, not when it ends (foundations F3). If someone is not there, the act
    /// is refused now, the time placed for it is given back, and the item that would have applied it (`done`, `seq`)
    /// is taken out.
    Start {
        action: crate::blocks::Passing,
        participant: Id,
        #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
        position: Option<Id>,
        done: i64,
        seq: u64,
        checks: Vec<WorkCheck>,
        placed: Placed,
    },
    /// A question to a register's keeper being answered (foundations F11): when it is done the asker is given the answer.
    Answer {
        participant: Id,
        #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
        position: Option<Id>,
        look: crate::config::LookRequest,
    },
    /// A visit in progress (docs/design/knowing.md): when it ends its looker sees what is at these cells.
    Visit {
        participant: Id,
        #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
        position: Option<Id>,
        channel: Id,
        places: Vec<Id>,
        cells: Vec<Id>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        names: bool,
    },
}

impl State {
    pub fn mint(&mut self, prefix: &str) -> Id {
        Id::from_string(self.mint_passing(prefix))
    }

    /// A new id as its text: for what passes (an act, a message: `Passing`), or to be interned by `mint`.
    pub fn mint_passing(&mut self, prefix: &str) -> String {
        let c = &mut self.counters;
        let n = match prefix {
            "ent" => &mut c.ent,
            "acc" => &mut c.acc,
            "str" => &mut c.str,
            "rec" => &mut c.rec,
            "act" => &mut c.act,
            "msg" => &mut c.msg,
            "par" => &mut c.par,
            "pos" => &mut c.pos,
            "cnd" => &mut c.cnd,
            other => panic!("unknown id prefix {other}"),
        };
        *n += 1;
        format!("{prefix}.{n}")
    }

    pub fn schedule(&mut self, at: i64, what: Sched) -> u64 {
        self.counters.sched += 1;
        let seq = self.counters.sched;
        self.schedule.insert(Scheduled { at, seq, what });
        seq
    }

    /// The next change stamp.
    pub fn stamp(&mut self) -> u64 {
        self.counters.change += 1;
        self.counters.change
    }

    /// Mark every cell a structure stands on as changed (building, completion, who's inside).
    pub fn touch_structure(&mut self, structure: &str) {
        let Some(cells) = self.structures.get(structure).map(|x| x.cells.clone()) else { return };
        let c = self.stamp();
        for cell in cells {
            if let Some(p) = self.cells.get_mut(&cell) {
                p.changed = c;
            }
        }
    }

    /// Mark an entity as having arrived in, or left, a space.
    pub fn moved(&mut self, entity: &str) {
        let c = self.stamp();
        if let Some(e) = self.entities.get_mut(entity) {
            e.moved = c;
        }
    }

    /// Store a record, giving it the next sequence number.
    pub fn store(&mut self, record: Record) {
        self.store_shared(Arc::new(record));
    }

    /// `store`, for a record held elsewhere too (the config's, at the start): the same one is kept, not a copy.
    pub fn store_shared(&mut self, record: Arc<Record>) {
        self.mark(&record);
        self.counters.record_seq += 1;
        let seq = self.counters.record_seq;
        self.record_order.push_back(record.id);
        self.records.insert(record.id, Stored { seq, record });
    }

    /// What a record adds to the derived lookups (`agreements_of`, `marks`), as it is stored.
    fn mark(&mut self, record: &Record) {
        match &record.body {
            crate::blocks::RecordBody::Agreement { terms } => {
                for p in &terms.parties {
                    self.agreements_of.entry(p.clone().into()).or_default().push_back(record.id);
                }
            }
            crate::blocks::RecordBody::Signature { agreement, party } => {
                let m = self.marks.entry(*agreement).or_default();
                m.signatures.push(oikos_terms::Mark { party: party.to_string(), at: record.at });
            }
            crate::blocks::RecordBody::Notice { agreement, party, .. } => {
                let m = self.marks.entry(*agreement).or_default();
                m.notices.push(oikos_terms::Mark { party: party.to_string(), at: record.at });
            }
            crate::blocks::RecordBody::Withdrawal { withdraws, .. } => {
                // (Only its owner ends a paper's standing: the same test as perception's `taken_down`.)
                let by_owner = self.records.get(withdraws).is_some_and(|t| {
                    let owner = |r: &Record| -> Vec<Id> { r.speaks_for.iter().cloned().chain(self.author_entity(r)).collect() };
                    let by = owner(record);
                    matches!(t.record.body, crate::blocks::RecordBody::Agreement { .. }) && owner(&t.record).iter().any(|o| by.contains(o))
                });
                if by_owner {
                    let m = self.marks.entry(*withdraws).or_default();
                    m.withdrawn_at.get_or_insert(record.at);
                }
            }
            _ => {}
        }
    }

    /// Every derived lookup (never serialised) made again from what is: a state read back from a snapshot is then the
    /// state it was saved from, lookups and all (snapshot and fork, kernel/src/snapshot.rs). The caches (`ground`)
    /// start empty, which changes no answer.
    pub fn rebuild_derived(&mut self) {
        self.whereabouts = Map::new();
        for (sid, spaces) in self.occupancy.iter() {
            for bodies in spaces.values() {
                for b in bodies {
                    self.whereabouts.entry(*b).or_default().insert(*sid);
                }
            }
        }
        self.positions_of = Map::new();
        self.held = Map::new();
        for (id, x) in self.positions.iter() {
            self.positions_of.entry(x.entity).or_default().insert(*id);
            if let Some(h) = &x.holder {
                self.held.entry(*h).or_default().insert(*id);
            }
        }
        self.marks = Map::new();
        self.agreements_of = Map::new();
        // (In the order they were made, as they were marked when stored: a withdrawal is read against the records made
        // before it, and every record it can take down was.)
        let order: Vec<Id> = self.record_order.iter().cloned().collect();
        for id in order {
            if let Some(r) = self.records.get(&id).map(|s| s.record.clone()) {
                self.mark(&r);
            }
        }
        self.ground = GroundCache::default();
        if let Some(n) = self.network.as_mut() {
            Arc::make_mut(n).reindex();
        }
    }

    /// The quantity of a kind held by an entity at a place (0 if none).
    pub fn holding(&self, holder: &str, at: &str, kind: &str) -> crate::money::Money {
        self.holdings.get(&holding_key(holder, at, kind)).map_or(0, |s| s.quantity)
    }

    /// Total of each resource kind in the world, edges included. Changes only by work.
    pub fn total_goods(&self) -> std::collections::BTreeMap<Id, crate::money::Money> {
        let mut t = std::collections::BTreeMap::new();
        for s in self.holdings.values() {
            *t.entry(s.kind).or_insert(0) += s.quantity;
        }
        t
    }

    /// Total money in the world in each currency, including the boundary. Constant for a run.
    pub fn total_money(&self) -> std::collections::BTreeMap<Id, crate::money::Money> {
        let mut t = std::collections::BTreeMap::new();
        for a in self.accounts.values() {
            *t.entry(a.currency).or_insert(0) += a.balance;
        }
        t
    }

    /// Bodies in a space.
    pub fn in_space(&self, space: &str) -> usize {
        let Some((sid, _)) = crate::config::split_space(space) else { return 0 };
        self.occupancy.get(sid).and_then(|m| m.get(space)).map_or(0, |b| b.len())
    }

    /// Structures a body is in (in any space).
    pub fn structures_of(&self, person: &str) -> Vec<Id> {
        let found: Vec<Id> = self.whereabouts.get(person).map(|s| s.iter().cloned().collect()).unwrap_or_default();
        debug_assert_eq!(found, self.structures_of_by_scan(person), "whereabouts out of step with occupancy for {person}");
        found
    }

    /// The same, by looking through every building: what `whereabouts` must always agree with (checked in debug
    /// builds, so by every kernel test that moves anyone, and by a test of its own).
    pub fn structures_of_by_scan(&self, person: &str) -> Vec<Id> {
        self.occupancy.iter().filter(|(_, spaces)| spaces.values().any(|b| b.contains(person))).map(|(s, _)| *s).collect()
    }

    /// Put a body into a space of a structure (the only way into `occupancy`, so `whereabouts` keeps step).
    pub fn enter(&mut self, sid: &str, space: &str, body: &str) {
        Arc::make_mut(self.occupancy.entry(sid.to_string().into()).or_default()).entry(space.to_string().into()).or_default().insert(body.to_string().into());
        self.whereabouts.entry(body.to_string().into()).or_default().insert(sid.to_string().into());
        self.entered.insert(space.to_string().into(), self.t);
    }

    /// A body has been taken out of a space of a structure: if it's in no other space of it, it's no longer there.
    pub fn left_space(&mut self, sid: &str, body: &str) {
        if self.occupancy.get(sid).is_some_and(|m| m.values().any(|b| b.contains(body))) {
            return;
        }
        if let Some(set) = self.whereabouts.get_mut(body) {
            set.remove(sid);
            if set.is_empty() {
                self.whereabouts.remove(body);
            }
        }
    }

    /// The body of a person, if it is one.
    pub fn body(&self, entity: &str) -> Option<&Body> {
        self.entities.get(entity).and_then(|e| e.body.as_ref())
    }

    /// The entity a participant acts for in a capacity: its person as itself, or a position's organisation.
    pub fn acting_entity(&self, participant: &str, position: Option<&str>) -> Option<Id> {
        match position {
            Some(p) => self.positions.get(p).map(|x| x.entity),
            None => self.participants.get(participant).and_then(|x| x.person),
        }
    }

    /// The entity a record's author made it for (None for genesis).
    pub fn author_entity(&self, rec: &Record) -> Option<Id> {
        self.acting_entity(&rec.author, rec.position.as_deref())
    }

    /// Participants who act for an entity now, with the capacity they act in: a person's own
    /// participant (as itself), and the holders of an organisation's positions.
    /// Whether a participant, in a capacity ("self", or a position it holds), has an accounts channel: the only way
    /// transactions reach it.
    pub fn sees_accounts(&self, participant: &str, capacity: &str) -> bool {
        let channels = if capacity == crate::config::SELF {
            self.participants.get(participant).map(|p| p.def.channels.as_slice())
        } else {
            self.positions.get(capacity).map(|x| x.channels.as_slice())
        };
        channels.is_some_and(|cs| cs.iter().any(|c| matches!(c.kind, crate::config::ChannelKind::Accounts)))
    }

    pub fn acting_for(&self, entity: &str) -> Vec<(Id, Id)> {
        if let Some(b) = self.body(entity) {
            return b.participant.iter().map(|p| (*p, Id::new(crate::config::SELF))).collect();
        }
        let found: Vec<(Id, Id)> = self.positions_of.get(entity).into_iter().flatten().filter_map(|id| self.positions.get(id)?.holder.map(|h| (h, *id))).collect();
        debug_assert_eq!(found, self.positions.iter().filter(|(_, x)| x.entity == entity).filter_map(|(id, x)| x.holder.map(|h| (h, *id))).collect::<Vec<_>>(), "positions_of out of step with positions for {entity}");
        found
    }

    /// The positions a participant holds now, in id order.
    pub fn held_by(&self, participant: &str) -> Vec<&Id> {
        let found: Vec<&Id> = self.held.get(participant).into_iter().flatten().collect();
        debug_assert_eq!(found, self.held_by_scan(participant), "held out of step with positions for {participant}");
        found
    }

    /// The same, by looking through every position: what `held` must always agree with (checked in debug builds).
    pub fn held_by_scan(&self, participant: &str) -> Vec<&Id> {
        self.positions.iter().filter(|(_, x)| x.holder.as_deref() == Some(participant)).map(|(id, _)| id).collect()
    }

    /// A position made (the only way into `positions`, so `positions_of` and `held` keep step).
    pub fn add_position(&mut self, id: Id, position: Position) {
        self.positions_of.entry(position.entity).or_default().insert(id);
        if let Some(h) = &position.holder {
            self.held.entry(*h).or_default().insert(id);
        }
        self.positions.insert(id, position);
    }

    /// A position changes hands, or falls vacant, at a change stamp (the only way its holder changes).
    pub fn set_holder(&mut self, position: &str, holder: Option<Id>, changed: u64) {
        let Some(x) = self.positions.get_mut(position) else { return };
        let was = std::mem::replace(&mut x.holder, holder);
        x.changed = changed;
        if was == holder {
            return;
        }
        if let Some(w) = was {
            if let Some(set) = self.held.get_mut(&w) {
                set.remove(position);
                if set.is_empty() {
                    self.held.remove(&w);
                }
            }
        }
        if let Some(h) = holder {
            self.held.entry(h).or_default().insert(position.to_string().into());
            // The office's file goes with the post: the new holder is told of every payment it has seen, as of any it has not.
            let key = transactions_key(position, &self.positions[position].entity);
            if let Some(ledger) = self.ledgers.get(&key) {
                if let Some(p) = self.participants.get_mut(&h) {
                    Arc::make_mut(p).new_transactions.insert(key.into(), ledger.clone());
                }
            }
            // And so does every channel of it, whole: what the holder looked through before, in an earlier tenure (a person
            // appointed again to a post they lost), is not what the unit made for this one has been shown. Its first look is the
            // office's file as it stands, as it is for someone who never held it; and, because a participant may have kept
            // what it was shown before, it is said to be whole (its marks are kept, marked `anew`): delivered as only
            // "what's new", the old file and the new one would be put together, each record twice.
            if let Some(p) = self.participants.get_mut(&h) {
                let prefix = format!("{position}/");
                if p.looks.iter().any(|(k, l)| k.starts_with(&prefix) && !l.anew) {
                    for (k, l) in Arc::make_mut(p).looks.iter_mut() {
                        if k.starts_with(&prefix) {
                            l.anew = true;
                        }
                    }
                }
            }
        }
    }
}

/// What travel depends on, changing (a cell's cover, or the building on it): `epoch` goes up with each change, and a
/// trip worked out at another epoch is worked out again. A cache only: the answer is the same with it or without it.
#[derive(Default)]
pub struct GroundCache {
    pub epoch: u64,
    pub trips: std::sync::Mutex<Map<(Id, Id), (u64, i64)>>,
    /// What entering each cell costs, as of an epoch (travel.rs): the same for every trip until the ground changes.
    pub costs: std::sync::Mutex<Option<(u64, Arc<CellCosts>)>>,
}

/// What entering each cell of the ground costs a traveller (seconds), over the rectangle the cells lie in: none where
/// there's no cell.
#[derive(Debug, Default)]
pub struct CellCosts {
    pub x0: i64,
    pub y0: i64,
    pub w: i64,
    pub h: i64,
    pub seconds: Vec<Option<i64>>,
}

impl CellCosts {
    pub fn at(&self, x: i64, y: i64) -> Option<i64> {
        let (dx, dy) = (x - self.x0, y - self.y0);
        if dx < 0 || dy < 0 || dx >= self.w || dy >= self.h {
            return None;
        }
        self.seconds[(dy * self.w + dx) as usize]
    }
}
impl GroundCache {
    /// The ground has changed: every trip is worked out afresh.
    pub fn changed(&mut self) {
        self.epoch += 1;
    }
    pub fn get(&self, from: &str, to: &str) -> Option<i64> {
        let trips = self.trips.lock().ok()?;
        trips.get(&(Id::new(from), Id::new(to))).filter(|(e, _)| *e == self.epoch).map(|(_, s)| *s)
    }
    pub fn put(&self, from: &str, to: &str, seconds: i64) {
        if let Ok(mut trips) = self.trips.lock() {
            trips.insert((from.to_string().into(), to.to_string().into()), (self.epoch, seconds));
        }
    }
}
impl Clone for GroundCache {
    fn clone(&self) -> Self {
        GroundCache {
            epoch: self.epoch,
            trips: std::sync::Mutex::new(self.trips.lock().map(|t| t.clone()).unwrap_or_default()),
            costs: std::sync::Mutex::new(self.costs.lock().map(|c| c.clone()).unwrap_or_default()),
        }
    }
}
impl PartialEq for GroundCache {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}
impl Eq for GroundCache {}
impl std::fmt::Debug for GroundCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "GroundCache(epoch {})", self.epoch)
    }
}

/// The key of one capacity's queue of transactions on one entity's accounts (`Participant::new_transactions`): a capacity is "self"
/// or a position the participant holds, and each has its own queue, so that a person who holds two posts of one organisation is
/// told of a payment in each (foundations F6).
pub fn transactions_key(capacity: &str, entity: &str) -> String {
    format!("{capacity}|{entity}")
}
