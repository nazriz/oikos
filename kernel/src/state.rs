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
    pub accounts: Map<Id, Account>,
    /// Holdings of resources (phase B), keyed `holder|at|kind` (holding_key): who holds how much of what, where.
    #[serde(default)]
    pub holdings: Map<String, Holding>,
    /// Work time each person has used on a day (phase B): person -> (day, seconds).
    #[serde(default)]
    pub labour_used: Map<Id, (i64, i64)>,
    /// Accounts that have been closed, kept so those who keep or hold them perceive the closure.
    pub closed_accounts: Map<Id, ClosedAccount>,
    pub cells: Map<Id, Cell>,
    pub structures: Map<Id, Structure>,
    /// structure -> space -> the bodies in it
    pub occupancy: Map<Id, BTreeMap<Id, BTreeSet<Id>>>,
    /// space -> its last few departures (who left, why, when): what those who can see who's there also see.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub departures: Map<Id, Vec<Departure>>,
    pub records: Map<Id, Stored>,
    /// Record ids in the order they were made (record i has seq i+1).
    pub record_order: imbl::Vector<Id>,
    pub participants: Map<Id, Participant>,
    pub positions: Map<Id, Position>,
    /// Future physical effects, sorted by (at, seq).
    pub schedule: Vec<Scheduled>,
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
        let mut list = self.departures.get(space).cloned().unwrap_or_default();
        list.push(Departure { occupant: occupant.into(), reason, at: t });
        if list.len() > DEPARTURES_KEPT {
            list.remove(0);
        }
        self.departures.insert(space.into(), list);
    }
}

/// A body's biological sex, where the world models it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sex {
    Female,
    Male,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConditionKind {
    Illness,
    Injury,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<Channel>,
    pub controller: Value,
    pub framing: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_opt_out: Option<Value>,
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
    pub def: Arc<ParticipantDef>,
    /// Its own parameters, as drawn when it was created.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traits: Option<Value>,
    pub status: ParticipantStatus,
    /// The change stamp of the last status change (0: from the start).
    pub status_changed: u64,
    /// Delivered at its next observation of each capacity ("self", or a position id), then cleared.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub pending: BTreeMap<Id, Pending>,
    /// Delivered by its next look through an accounts channel of a capacity acting for that entity.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub new_transactions: BTreeMap<Id, Vec<Transaction>>,
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
}

impl Pending {
    pub fn is_empty(&self) -> bool {
        self.outcomes.is_empty() && self.inbox.is_empty()
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
    pub action: Id,
    pub t: i64,
    pub status: OutcomeStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<BTreeMap<String, Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refusal: Option<RefusalInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub id: Id,
    pub t: i64,
    /// The participant who wrote it, and the position it wrote in (absent: as itself).
    pub from: Id,
    #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
    pub from_position: Option<Id>,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scheduled {
    pub at: i64,
    pub seq: u64,
    pub what: Sched,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeathCause {
    Illness,
    Injury,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Sched {
    StructureComplete { structure: Id },
    /// A year of age: draws for the coming year (illness, injury, other causes).
    Birthday { person: Id },
    /// A drawn chance of injury, taken now against the danger of where the body is (thinning).
    Exposure { person: Id, max_bps: u32 },
    ConditionBegins { person: Id, kind: ConditionKind, severity: String, until: i64, #[serde(default, skip_serializing_if = "Option::is_none")] death_at: Option<i64> },
    ConditionEnds { person: Id, condition: Id },
    Death { person: Id, cause: DeathCause },
    BirthDue { parents: Vec<Id>, name: String, template: Id },
}

impl State {
    pub fn mint(&mut self, prefix: &str) -> Id {
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

    pub fn schedule(&mut self, at: i64, what: Sched) {
        self.counters.sched += 1;
        let item = Scheduled { at, seq: self.counters.sched, what };
        let pos = self.schedule.partition_point(|s| (s.at, s.seq) <= (item.at, item.seq));
        self.schedule.insert(pos, item);
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
        self.counters.record_seq += 1;
        let seq = self.counters.record_seq;
        self.record_order.push_back(record.id.clone());
        self.records.insert(record.id.clone(), Stored { seq, record: Arc::new(record) });
    }

    /// The quantity of a kind held by an entity at a place (0 if none).
    pub fn holding(&self, holder: &str, at: &str, kind: &str) -> crate::money::Money {
        self.holdings.get(&holding_key(holder, at, kind)).map_or(0, |s| s.quantity)
    }

    /// Total of each resource kind in the world, edges included. Changes only by work.
    pub fn total_goods(&self) -> std::collections::BTreeMap<Id, crate::money::Money> {
        let mut t = std::collections::BTreeMap::new();
        for s in self.holdings.values() {
            *t.entry(s.kind.clone()).or_insert(0) += s.quantity;
        }
        t
    }

    /// Total money in the world in each currency, including the boundary. Constant for a run.
    pub fn total_money(&self) -> std::collections::BTreeMap<Id, crate::money::Money> {
        let mut t = std::collections::BTreeMap::new();
        for a in self.accounts.values() {
            *t.entry(a.currency.clone()).or_insert(0) += a.balance;
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
        self.occupancy.iter().filter(|(_, spaces)| spaces.values().any(|b| b.contains(person))).map(|(s, _)| s.clone()).collect()
    }

    /// The body of a person, if it is one.
    pub fn body(&self, entity: &str) -> Option<&Body> {
        self.entities.get(entity).and_then(|e| e.body.as_ref())
    }

    /// The entity a participant acts for in a capacity: its person as itself, or a position's organisation.
    pub fn acting_entity(&self, participant: &str, position: Option<&str>) -> Option<Id> {
        match position {
            Some(p) => self.positions.get(p).map(|x| x.entity.clone()),
            None => self.participants.get(participant).and_then(|x| x.person.clone()),
        }
    }

    /// The entity a record's author made it for (None for genesis).
    pub fn author_entity(&self, rec: &Record) -> Option<Id> {
        self.acting_entity(&rec.author, rec.position.as_deref())
    }

    /// Participants who act for an entity now, with the capacity they act in: a person's own
    /// participant (as itself), and the holders of an organisation's positions.
    pub fn acting_for(&self, entity: &str) -> Vec<(Id, Id)> {
        if let Some(b) = self.body(entity) {
            return b.participant.iter().map(|p| (p.clone(), crate::config::SELF.to_string())).collect();
        }
        self.positions.iter().filter(|(_, x)| x.entity == entity).filter_map(|(id, x)| x.holder.clone().map(|h| (h, id.clone()))).collect()
    }
}
