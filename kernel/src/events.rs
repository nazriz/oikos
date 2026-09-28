//! Events and refusal codes, mirroring the Event and RefusalCode definitions
//! in contracts/log.schema.json (v0.4). Every refusal code is physics or
//! mechanics; there is no code for "illegal" (D19).

use crate::blocks::{Id, Record};
use crate::config::ParticipantKind;
use crate::state::{ConditionKind, DeathCause};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefusalCode {
    /// The participant has left the study (without a stand-in), or has ended.
    ParticipantInactive,
    /// The participant doesn't hold the position it acted in.
    NotInPosition,
    UnknownRef,
    DuplicateRef,
    NotCustodian,
    NotHolder,
    InsufficientFunds,
    Overflow,
    UnknownAccount,
    AccountNotEmpty,
    BoundaryProtected,
    UnknownCell,
    GroundOccupied,
    UnsuitableTerrain,
    UnknownStructureType,
    UnknownStructure,
    StructureIncomplete,
    UnknownSpace,
    CapacityExceeded,
    NotPresent,
    AlreadyPresent,
    NotAPerson,
    Dead,
    TooFar,
    NotFertile,
    NotModelled,
    UnknownEntity,
    UnknownParticipant,
    UnknownPosition,
    UnknownTemplate,
    /// It isn't the acting organisation's (its position, or its system).
    NotTheirs,
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
    /// Money a newcomer brings across the boundary.
    Carried,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VacateReason {
    Left,
    Removed,
    Demolition,
    /// The body crossed out of the world.
    Departed,
    Died,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    Died,
    Retired,
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
        participant: Id,
        #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
        position: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        created: Option<BTreeMap<String, Id>>,
    },
    ActionRefused {
        action: Id,
        participant: Id,
        #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
        position: Option<Id>,
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
        /// Its corner cell.
        on: Id,
        structure_type: Id,
        built_by: Id,
        /// When it will be complete.
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
        space: Id,
        by: Id,
    },
    Vacated {
        occupant: Id,
        space: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        by: Option<Id>,
        reason: VacateReason,
    },
    PersonCreated {
        person: Id,
        name: String,
        born_at: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sex: Option<crate::state::Sex>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        parents: Vec<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        participant: Option<Id>,
    },
    PersonArrived {
        person: Id,
        by: Id,
    },
    PersonLeft {
        person: Id,
        by: Id,
    },
    PersonDied {
        person: Id,
        died_of: DeathCause,
    },
    BirthStarted {
        parents: Vec<Id>,
        due: i64,
    },
    ConditionBegan {
        person: Id,
        condition: Id,
        kind: ConditionKind,
        severity: String,
        until: i64,
    },
    ConditionEnded {
        person: Id,
        condition: Id,
    },
    Harmed {
        person: Id,
        by: Id,
        condition: Id,
    },
    ParticipantCreated {
        participant: Id,
        kind: ParticipantKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        person: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        owner: Option<Id>,
        template: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        traits: Option<Value>,
    },
    ParticipantEnded {
        participant: Id,
        reason: EndReason,
    },
    /// A position came into being. Its title, role and role module are carried so those who run
    /// participants know how the job is done (its channels are in the act that created it).
    PositionCreated {
        position: Id,
        entity: Id,
        by: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        role: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        role_module: Option<Value>,
    },
    /// A position changed hands: to `holder`, or to nobody. `by` is who handed it over; absent when it
    /// fell vacant because its holder died, was retired, or left the study.
    Appointed {
        position: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        holder: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        by: Option<Id>,
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
        participant: Id,
        to: Vec<Id>,
    },
    Observation {
        participant: Id,
        observation_hash: String,
    },
    ParticipantOptedOut {
        participant: Id,
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
            EventBody::PersonCreated { .. } => "person_created",
            EventBody::PersonArrived { .. } => "person_arrived",
            EventBody::PersonLeft { .. } => "person_left",
            EventBody::PersonDied { .. } => "person_died",
            EventBody::BirthStarted { .. } => "birth_started",
            EventBody::ConditionBegan { .. } => "condition_began",
            EventBody::ConditionEnded { .. } => "condition_ended",
            EventBody::Harmed { .. } => "harmed",
            EventBody::ParticipantCreated { .. } => "participant_created",
            EventBody::ParticipantEnded { .. } => "participant_ended",
            EventBody::PositionCreated { .. } => "position_created",
            EventBody::Appointed { .. } => "appointed",
            EventBody::Recorded { .. } => "recorded",
            EventBody::EntityCreated { .. } => "entity_created",
            EventBody::MessageDelivered { .. } => "message_delivered",
            EventBody::Observation { .. } => "observation",
            EventBody::ParticipantOptedOut { .. } => "participant_opted_out",
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
                | EventBody::PersonCreated { .. }
                | EventBody::PersonArrived { .. }
                | EventBody::PersonLeft { .. }
                | EventBody::PersonDied { .. }
                | EventBody::BirthStarted { .. }
                | EventBody::ConditionBegan { .. }
                | EventBody::ConditionEnded { .. }
                | EventBody::Harmed { .. }
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
