//! Events and refusal codes, mirroring the Event and RefusalCode definitions
//! in contracts/log.schema.json (v0.2). Every refusal code is physics or
//! mechanics; there is no code for "illegal" (D19).

use crate::blocks::{Id, Record};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefusalCode {
    SeatResigned,
    UnknownRef,
    DuplicateRef,
    NotCustodian,
    NotHolder,
    InsufficientFunds,
    Overflow,
    UnknownAccount,
    AccountNotEmpty,
    BoundaryProtected,
    UnknownParcel,
    ParcelOccupied,
    UnknownStructureType,
    UnknownStructure,
    StructureIncomplete,
    UnknownSlot,
    CapacityExceeded,
    NotPresent,
    UnknownEntity,
    ReservedKind,
    UnknownRecord,
    WrongRecordKind,
    CapExceeded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferReason {
    Payment,
    Materials,
    Demolition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VacateReason {
    Left,
    Removed,
    Demolition,
}

/// One event: the command that caused it, plus what happened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    /// seq of the command entry that caused this event; set by the log writer.
    pub cause: u64,
    #[serde(flatten)]
    pub body: EventBody,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum EventBody {
    ActionApplied {
        action: Id,
        seat: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        created: Option<BTreeMap<String, Id>>,
    },
    ActionRefused {
        action: Id,
        seat: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        block: Option<usize>,
        code: RefusalCode,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    Transfer {
        from: Id,
        to: Id,
        amount: i64,
        by: Id,
        reason: TransferReason,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        settles: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        per_instruction: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        memo: Option<String>,
    },
    AccountOpened {
        account: Id,
        holder: Id,
        custodian: Id,
        by: Id,
    },
    AccountClosed {
        account: Id,
        by: Id,
    },
    StructureStarted {
        structure: Id,
        parcel: Id,
        structure_type: Id,
        built_by: Id,
        at: i64,
    },
    StructureCompleted {
        structure: Id,
    },
    StructureDemolished {
        structure: Id,
        by: Id,
    },
    Occupied {
        occupant: Id,
        structure: Id,
        slot: String,
        count: u32,
    },
    Vacated {
        occupant: Id,
        structure: Id,
        by: Id,
        reason: VacateReason,
    },
    Recorded {
        record: Box<Record>,
    },
    EntityCreated {
        entity: Id,
        kind: String,
        name: String,
    },
    MessageDelivered {
        message: Id,
        seat: Id,
        to: Vec<Id>,
    },
    Observation {
        seat: Id,
        observation_hash: String,
    },
    SeatResigned {
        seat: Id,
        statement: String,
    },
}

impl EventBody {
    pub fn name(&self) -> &'static str {
        match self {
            EventBody::ActionApplied { .. } => "action_applied",
            EventBody::ActionRefused { .. } => "action_refused",
            EventBody::Transfer { .. } => "transfer",
            EventBody::AccountOpened { .. } => "account_opened",
            EventBody::AccountClosed { .. } => "account_closed",
            EventBody::StructureStarted { .. } => "structure_started",
            EventBody::StructureCompleted { .. } => "structure_completed",
            EventBody::StructureDemolished { .. } => "structure_demolished",
            EventBody::Occupied { .. } => "occupied",
            EventBody::Vacated { .. } => "vacated",
            EventBody::Recorded { .. } => "recorded",
            EventBody::EntityCreated { .. } => "entity_created",
            EventBody::MessageDelivered { .. } => "message_delivered",
            EventBody::Observation { .. } => "observation",
            EventBody::SeatResigned { .. } => "seat_resigned",
        }
    }

    /// Does this event change the physical world (as opposed to records,
    /// messages, perception and bookkeeping)?
    pub fn is_physical(&self) -> bool {
        matches!(
            self,
            EventBody::Transfer { .. }
                | EventBody::AccountOpened { .. }
                | EventBody::AccountClosed { .. }
                | EventBody::StructureStarted { .. }
                | EventBody::StructureCompleted { .. }
                | EventBody::StructureDemolished { .. }
                | EventBody::Occupied { .. }
                | EventBody::Vacated { .. }
        )
    }
}

/// An event with the simulated time at which it happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Timed {
    pub t: i64,
    pub event: Event,
}

impl Timed {
    pub fn new(t: i64, body: EventBody) -> Self {
        Timed { t, event: Event { cause: 0, body } }
    }
}
