//! Events and refusal codes, mirroring the Event and RefusalCode definitions
//! in contracts/log.schema.json. An event is a flat record: which fields are
//! present depends on `event` (the schema pins the required ones per type).

use crate::blocks::{AgreementTerms, Id, RightKind, Rule};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventName {
    ActionApplied,
    ActionRefused,
    ActionHeld,
    ActionForwarded,
    ProposalDecided,
    Transfer,
    EntityCreated,
    EntityDissolved,
    RightCreated,
    RightTransferred,
    RightEnded,
    StructureStarted,
    StructureCompleted,
    StructureDemolished,
    RuleEnacted,
    RuleRepealed,
    AgreementProposed,
    AgreementResponded,
    AgreementActivated,
    AgreementLapsed,
    AgreementNotice,
    AgreementEnded,
    PaymentFailed,
    MessageDelivered,
    Observation,
    SeatResigned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefusalCode {
    Malformed,
    UnknownSeat,
    SeatResigned,
    MandateDenied,
    NotAuthorized,
    UnknownRef,
    DuplicateRef,
    UnknownEntity,
    EntityInactive,
    InvalidKind,
    BoundaryProtected,
    InsufficientFunds,
    Overflow,
    UnknownParcel,
    UnknownRight,
    RightNotHeld,
    RightNotTransferable,
    RightNotRevocable,
    ParcelOccupied,
    UnknownStructureType,
    UnknownStructure,
    StructureIncomplete,
    StructureInUse,
    ZoningViolation,
    RentCapViolation,
    CapacityExceeded,
    NoJurisdiction,
    UnknownRule,
    UnknownAgreement,
    NotAParty,
    InvalidState,
    UnknownProposal,
    NotApprover,
    AlreadyDecided,
    CapExceeded,
    TimeInPast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    Block,
    Rent,
    Wage,
    Construction,
    Demolition,
    Dissolution,
    Revoked,
    Expired,
    Terminated,
    Breach,
    AgreementEnded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventDecision {
    Approve,
    Reject,
    Accept,
    Decline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OneOrMany {
    One(Id),
    Many(Vec<Id>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub event: EventName,
    /// seq of the command entry that caused this event; set by the log writer.
    pub cause: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<BTreeMap<String, Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<RefusalCode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<crate::config::Level>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposal: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub awaiting: Option<Vec<Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision: Option<EventDecision>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<OneOrMany>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<Reason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub founder: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controller: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub successor: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right_kind: Option<RightKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parcel: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holder: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grantor: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure_type: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jurisdiction: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_body: Option<Rule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agreement: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terms: Option<AgreementTerms>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observation_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statement: Option<String>,
}

impl Event {
    pub fn new(event: EventName) -> Self {
        Event {
            event,
            cause: 0,
            action: None,
            seat: None,
            created: None,
            block: None,
            code: None,
            detail: None,
            level: None,
            proposal: None,
            awaiting: None,
            by: None,
            decision: None,
            from: None,
            to: None,
            amount: None,
            reason: None,
            entity: None,
            entity_kind: None,
            name: None,
            founder: None,
            controller: None,
            successor: None,
            right: None,
            right_kind: None,
            parcel: None,
            holder: None,
            grantor: None,
            units: None,
            until: None,
            structure: None,
            structure_type: None,
            owner: None,
            at: None,
            rule: None,
            jurisdiction: None,
            rule_body: None,
            agreement: None,
            terms: None,
            message: None,
            observation_hash: None,
            statement: None,
        }
    }
}

/// An event with the simulated time at which it happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Timed {
    pub t: i64,
    pub event: Event,
}
