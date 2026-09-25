//! Mutable world state. Every map is a BTreeMap, so serialization (and hence
//! the state hash) is deterministic. Static facts (catalogue, jurisdictions,
//! mandates, channels) live in the config, which the log header carries.

use crate::blocks::{AgreementTerms, Block, Id, RightKind, Rule};
use crate::config::{EntityKind, Level};
use crate::events::RefusalCode;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub t: i64,
    pub counters: Counters,
    pub entities: BTreeMap<Id, Entity>,
    pub parcels: BTreeMap<Id, Parcel>,
    pub rights: BTreeMap<Id, Right>,
    pub structures: BTreeMap<Id, Structure>,
    pub rules: BTreeMap<Id, RuleRec>,
    pub agreements: BTreeMap<Id, Agreement>,
    pub proposals: BTreeMap<Id, Proposal>,
    pub seats: BTreeMap<Id, SeatState>,
    /// Future effects, kept sorted by (at, seq).
    pub schedule: Vec<Scheduled>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Counters {
    pub ent: u64,
    pub rgt: u64,
    pub str: u64,
    pub rul: u64,
    pub agr: u64,
    pub prp: u64,
    pub act: u64,
    pub msg: u64,
    pub sched: u64,
    pub rule_order: u64,
    pub created_entities: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entity {
    pub kind: EntityKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controller: Option<Id>,
    pub balance: i64,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Parcel {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<Id>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Right {
    pub parcel: Id,
    pub kind: RightKind,
    pub holder: Id,
    /// Set for derived rights (grants and leases).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grantor: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units: Option<u32>,
    pub revocable: bool,
    /// The agreement that created this right, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub under: Option<Id>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Structure {
    pub parcel: Id,
    pub structure_type: Id,
    pub owner: Id,
    pub complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completes_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleRec {
    pub jurisdiction: Id,
    pub rule: Rule,
    pub enacted_at: i64,
    /// Enactment order; the latest zoning rule covering a parcel wins.
    pub order: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgreementStatus {
    Pending,
    Active,
    Ending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    Expired,
    Terminated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Agreement {
    /// Terms with every local ref resolved to an id.
    pub terms: AgreementTerms,
    pub status: AgreementStatus,
    pub proposed_by: Id,
    pub accepted: BTreeSet<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<EndReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_payment_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_right: Option<Id>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Proposal {
    /// Approval or Request.
    pub level: Level,
    pub seat: Id,
    pub action: Id,
    /// As submitted (local refs unresolved); resolved when applied.
    pub blocks: Vec<Block>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    pub awaiting: BTreeSet<Id>,
    pub approved: BTreeSet<Id>,
    pub since: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SeatStatus {
    Active,
    Resigned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeatState {
    pub status: SeatStatus,
    /// Delivered at this seat's next observation, then cleared.
    pub new_outcomes: Vec<Outcome>,
    pub new_inbox: Vec<Message>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeStatus {
    Applied,
    Refused,
    Held,
    Forwarded,
    Rejected,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposal: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub awaiting: Option<Vec<Id>>,
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
pub struct Scheduled {
    pub at: i64,
    pub seq: u64,
    pub what: Sched,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Sched {
    StructureComplete { structure: Id },
    Payment { agreement: Id },
    AgreementEnd { agreement: Id },
    OfferExpire { agreement: Id },
    RightExpire { right: Id },
}

impl State {
    pub fn mint(&mut self, prefix: &str) -> Id {
        let c = &mut self.counters;
        let n = match prefix {
            "ent" => &mut c.ent,
            "rgt" => &mut c.rgt,
            "str" => &mut c.str,
            "rul" => &mut c.rul,
            "agr" => &mut c.agr,
            "prp" => &mut c.prp,
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

    /// Total money in the world, including the boundary entity. Constant for a run.
    pub fn total_money(&self) -> i128 {
        self.entities.values().map(|e| e.balance as i128).sum()
    }
}
