//! Events and refusal codes, mirroring the Event and RefusalCode definitions
//! in contracts/log.schema.json (v0.5). Every refusal code is physics or
//! mechanics; there is no code for "illegal" (D19).

use crate::blocks::{Id, Record};
use crate::config::ParticipantKind;
use crate::vocab::{ConditionKind, DeathCause};
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
    /// A payment between accounts in different currencies (an exchange is a trade: two transfers).
    CurrencyMismatch,
    UnknownCurrency,
    /// Leaving by something that isn't one of the world's edges.
    NotABoundary,
    /// A resource kind the world doesn't declare.
    UnknownResource,
    /// Not enough of the holding where it's said to be.
    InsufficientQuantity,
    /// A place goods can't be at: not a structure (or, for an edge, not itself).
    UnknownPlace,
    /// A task the world doesn't declare.
    UnknownTask,
    /// A performer isn't at the place of work (in a space of the task's kind there).
    NotAtWork,
    /// A performer has no time left today (the world's working day).
    NoTimeLeft,
    /// A survey that doesn't say what of or where, of something the world has, or work that says so for a task that isn't one.
    BadSurvey,
    /// Work on a person or a space with a task that does nothing to bodies, or work on a structure with one that does.
    NoBodyEffect,
    /// Work that draws from a field where there isn't enough of it (water from a river run low).
    FieldExhausted,
    /// Into a building under water.
    Flooded,
    /// An investigation that doesn't say what of, or work that says so for a task that doesn't investigate.
    BadInvestigation,
    /// Building work on something that isn't being built.
    NotBeingBuilt,
    /// Demolition work on something that isn't being demolished.
    NotComingDown,
    /// It's being demolished.
    ComingDown,
    /// A signature on an agreement whose owner has withdrawn it before every party had signed: an offer that no longer
    /// stands cannot be accepted.
    OfferWithdrawn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferReason {
    Payment,
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
    /// Its building flooded (world-expansion 7.3).
    Flooded,
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
    /// An act begun (docs/design/rebuild.md 6.3): its actor is busy with it from `starts` (after any thinking) and it
    /// takes effect at `done`, when it's applied or refused.
    ActionStarted {
        action: Id,
        participant: Id,
        #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
        position: Option<Id>,
        starts: i64,
        done: i64,
        /// When the actor itself is free again, if before `done`: its part of the act is over, but the work it set others
        /// to takes them longer (foundations F1). Absent: at `done`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        free: Option<i64>,
    },
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
        #[serde(with = "oikos_core::money::amount")]
        amount: oikos_core::money::Money,
        currency: Id,
        by: Id,
        reason: TransferReason,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        settles: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        per_instruction: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        memo: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        line: Option<String>,
    },
    /// Work done (phase B): units of a task at a structure, by performers, taking `labour` seconds of their time.
    Worked {
        task: Id,
        units: u64,
        at: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on: Option<Id>,
        performers: Vec<Id>,
        labour: i64,
        by: Id,
    },
    /// A structure is being brought down (its type needs demolition labour): its occupants have left.
    DemolitionStarted {
        structure: Id,
        by: Id,
    },
    GoodsMoved {
        kind: Id,
        #[serde(with = "oikos_core::money::amount")]
        quantity: oikos_core::money::Money,
        from: Id,
        from_at: Id,
        to: Id,
        to_at: Id,
        by: Id,
    },
    AccountOpened {
        account: Id,
        holder: Id,
        custodian: Id,
        currency: Id,
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
    /// Nature: a species with none left anywhere. Once, and for good.
    SpeciesExtinct {
        species: Id,
    },
    /// Nature's truth, monthly, for measurement (no participant perceives it): each species' total and the cells it's
    /// in, and the cells of each cover.
    NatureCensus {
        species: BTreeMap<Id, CensusCount>,
        covers: BTreeMap<Id, i64>,
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
        sex: Option<crate::vocab::Sex>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        parents: Vec<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        participant: Option<Id>,
    },
    PersonArrived {
        person: Id,
        /// The edge they came in by (the boundary whose position acted).
        via: Id,
        by: Id,
    },
    PersonLeft {
        person: Id,
        /// The edge they left by.
        to: Id,
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
    /// Care given (services): the condition now lasts until `until`, and a death due from it was called off, or not.
    /// The truth, for measurement: nobody in the world is told whether a death was called off.
    ConditionTreated {
        person: Id,
        condition: Id,
        by: Id,
        until: i64,
        death_called_off: bool,
    },
    /// Goods taken without the holder's consent (world-expansion 7.3): the truth, for measurement. Nobody is told who.
    Taken {
        by: Id,
        from: Id,
        kind: Id,
        #[serde(with = "oikos_core::money::amount")]
        quantity: oikos_core::money::Money,
        at: Id,
    },
    /// A building flooded (a field passed its level): its occupants moved out.
    Flooded {
        structure: Id,
        level: i64,
    },
    /// The water's gone down below its level.
    FloodReceded {
        structure: Id,
    },
    /// The world's totals (tier 2: greenhouse gas), monthly, for measurement.
    CounterCensus {
        counters: BTreeMap<Id, i64>,
    },
    /// Work changed a body variable (services: teaching raises skill): its value now.
    BodyChanged {
        person: Id,
        variable: Id,
        value: i64,
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
    /// Someone has set out to look at places (docs/design/knowing.md): busy with it from `starts`, there and back by
    /// `done`, when they see what is there.
    VisitStarted {
        participant: Id,
        #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
        position: Option<Id>,
        channel: Id,
        places: Vec<Id>,
        starts: i64,
        done: i64,
    },
    /// They have looked: what was there is theirs to see at their next observation.
    Visited {
        participant: Id,
        #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
        position: Option<Id>,
        channel: Id,
        places: Vec<Id>,
    },
    ParticipantOptedOut {
        participant: Id,
        statement: String,
    },
    /// An entity's own record was set (docs/design/ai-citizens.md 10d): its `n`th change, the chain of its changes
    /// up to this one, and the digest of what the record now holds.
    EntityRecorded {
        entity: Id,
        n: u64,
        chain: String,
        digest: String,
        /// Who keeps this entity's record under the config (the bookkeeping module's name): by whose bookkeeping
        /// the change was made. Absent in logs written before it was named.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        keeper: Option<String>,
    },
}

impl EventBody {
    pub fn name(&self) -> &'static str {
        match self {
            EventBody::ActionStarted { .. } => "action_started",
            EventBody::ActionApplied { .. } => "action_applied",
            EventBody::ActionRefused { .. } => "action_refused",
            EventBody::Transfer { .. } => "transfer",
            EventBody::GoodsMoved { .. } => "goods_moved",
            EventBody::Worked { .. } => "worked",
            EventBody::DemolitionStarted { .. } => "demolition_started",
            EventBody::AccountOpened { .. } => "account_opened",
            EventBody::AccountClosed { .. } => "account_closed",
            EventBody::StructureStarted { .. } => "structure_started",
            EventBody::StructureCompleted { .. } => "structure_completed",
            EventBody::StructureDemolished { .. } => "structure_demolished",
            EventBody::SpeciesExtinct { .. } => "species_extinct",
            EventBody::NatureCensus { .. } => "nature_census",
            EventBody::Occupied { .. } => "occupied",
            EventBody::Vacated { .. } => "vacated",
            EventBody::PersonCreated { .. } => "person_created",
            EventBody::PersonArrived { .. } => "person_arrived",
            EventBody::PersonLeft { .. } => "person_left",
            EventBody::PersonDied { .. } => "person_died",
            EventBody::BirthStarted { .. } => "birth_started",
            EventBody::ConditionBegan { .. } => "condition_began",
            EventBody::ConditionEnded { .. } => "condition_ended",
            EventBody::ConditionTreated { .. } => "condition_treated",
            EventBody::BodyChanged { .. } => "body_changed",
            EventBody::CounterCensus { .. } => "counter_census",
            EventBody::Flooded { .. } => "flooded",
            EventBody::Taken { .. } => "taken",
            EventBody::FloodReceded { .. } => "flood_receded",
            EventBody::Harmed { .. } => "harmed",
            EventBody::ParticipantCreated { .. } => "participant_created",
            EventBody::ParticipantEnded { .. } => "participant_ended",
            EventBody::PositionCreated { .. } => "position_created",
            EventBody::Appointed { .. } => "appointed",
            EventBody::Recorded { .. } => "recorded",
            EventBody::EntityCreated { .. } => "entity_created",
            EventBody::MessageDelivered { .. } => "message_delivered",
            EventBody::Observation { .. } => "observation",
            EventBody::VisitStarted { .. } => "visit_started",
            EventBody::Visited { .. } => "visited",
            EventBody::ParticipantOptedOut { .. } => "participant_opted_out",
            EventBody::EntityRecorded { .. } => "entity_recorded",
        }
    }

    /// Does this event change the physical world (as opposed to records,
    /// messages, perception and bookkeeping)?
    pub fn is_physical(&self) -> bool {
        matches!(
            self,
            EventBody::Transfer { .. }
                | EventBody::GoodsMoved { .. }
                | EventBody::Worked { .. }
                | EventBody::DemolitionStarted { .. }
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
                | EventBody::ConditionTreated { .. }
                | EventBody::BodyChanged { .. }
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

/// A species in a census: how many, in how many cells.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CensusCount {
    pub count: i64,
    pub cells: i64,
}
