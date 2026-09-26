//! Mutable world state (v0.2). Every map is a BTreeMap, so serialization (and
//! hence the state hash) is deterministic. Static facts (the catalogue, seats
//! and their channels) live in the config, which the log header carries.
//!
//! The state holds physics (accounts, parcels, structures, occupancy) and the
//! append-only record store. Nothing in it describes law or authority.

use crate::blocks::{Id, Record};
use crate::events::RefusalCode;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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
    pub parcels: Map<Id, Parcel>,
    pub structures: Map<Id, Structure>,
    /// structure -> occupant -> slot -> count
    pub occupancy: Map<Id, BTreeMap<Id, BTreeMap<String, u32>>>,
    pub records: Map<Id, Stored>,
    /// Record ids in the order they were made (record i has seq i+1).
    pub record_order: imbl::Vector<Id>,
    pub seats: Map<Id, SeatState>,
    /// Accounts that have been closed, kept so seats that keep or hold them perceive the closure.
    pub closed_accounts: Map<Id, ClosedAccount>,
    /// Future physical effects (construction completing), sorted by (at, seq).
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
    pub sched: u64,
    /// Order in which records were made; records channels deliver those after a seat's last look.
    pub record_seq: u64,
    pub created_entities: u64,
    /// Order of changes to accounts, parcels, entities and seats: other channels deliver
    /// what changed after a seat's last look (perception is changes, not snapshots).
    pub change: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entity {
    pub kind: String,
    pub name: String,
    /// The change stamp at which it came to exist (0: from the start).
    pub changed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    pub holder: Id,
    pub custodian: Id,
    pub balance: i64,
    /// The change stamp of its last change (opened, balance moved).
    pub changed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Parcel {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<Id>,
    /// The change stamp of its last change (a building started, finished or gone; occupancy moved).
    pub changed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Structure {
    pub parcel: Id,
    pub structure_type: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub built_by: Option<Id>,
    pub complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completes_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stored {
    pub seq: u64,
    /// Records are immutable once made, so copies of the state share them.
    pub record: Arc<Record>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SeatStatus {
    Active,
    OptedOut,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeatState {
    pub status: SeatStatus,
    /// The change stamp of the last status change (0: from the start).
    pub status_changed: u64,
    /// Delivered at this seat's next observation, then cleared.
    pub new_outcomes: Vec<Outcome>,
    pub new_inbox: Vec<Message>,
    /// Delivered by the seat's next look through an accounts channel.
    pub new_transactions: Vec<Transaction>,
    /// When the seat last looked through each channel, and how far it had seen.
    pub looks: BTreeMap<Id, Look>,
}

/// A seat's last look through a channel: when, and the cursor it had reached
/// (the record sequence for records channels, the change stamp for the others).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Look {
    pub at: i64,
    pub cursor: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClosedAccount {
    pub holder: Id,
    pub custodian: Id,
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
    pub from: Id,
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
    pub amount: i64,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Sched {
    StructureComplete { structure: Id },
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

    /// Mark the parcel a structure stands on as changed (building, completion, occupancy).
    pub fn touch_structure(&mut self, structure: &str) {
        let Some(parcel) = self.structures.get(structure).map(|x| x.parcel.clone()) else { return };
        let c = self.stamp();
        if let Some(p) = self.parcels.get_mut(&parcel) {
            p.changed = c;
        }
    }

    /// Store a record, giving it the next sequence number.
    pub fn store(&mut self, record: Record) {
        self.counters.record_seq += 1;
        let seq = self.counters.record_seq;
        self.record_order.push_back(record.id.clone());
        self.records.insert(record.id.clone(), Stored { seq, record: Arc::new(record) });
    }

    /// Total money in the world, including the boundary. Constant for a run.
    pub fn total_money(&self) -> i128 {
        self.accounts.values().map(|a| a.balance as i128).sum()
    }

    pub fn occupied(&self, structure: &str, slot: &str) -> u64 {
        self.occupancy.get(structure).map_or(0, |occ| occ.values().filter_map(|slots| slots.get(slot)).map(|c| *c as u64).sum())
    }
}
