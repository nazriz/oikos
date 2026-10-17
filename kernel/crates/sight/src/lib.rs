//! What a built-in actor may see and say (docs/design/rust-port.md 2.1; docs/no-god-view.md).
//!
//! The actors crate depends on this crate, `oikos-core`, `oikos-contracts` and `oikos-rules`, and on nothing that holds
//! the world. In Rust a crate can name only its own direct dependencies, so the actors cannot name `State`, `World`,
//! `observe` or the engine: what they know of the world is what is handed to them here, as values. This crate
//! re-exports the value types an observation is made of, and adds the picture an actor reads (`view::Picture`: the
//! observation's changes kept up to date, as participants/src/view.ts did) and the action it answers with.
//! Nothing that could read the world may be re-exported from here (kernel/tests/actors_boundary.rs checks the list).

#![forbid(unsafe_code)]

pub mod action;
pub mod view;

pub use action::{Action, Provenance};
pub use view::{Picture, Seen, View, Visit};

/// The observation as the engine builds it (contracts/participant-api.schema.json, Observation), and its parts.
pub use oikos_perception::{
    AccountItem, BodyView, ChannelData, ChildView, ConditionView, EntityItem, HeldPosition, HoldingItem, Observation, OwnRecord,
    PositionItem, SiteCell, SiteSpace, SiteStructure, VariableView,
};
/// An agreement read by its terms, as an observation carries it.
pub use oikos_terms::Reading;
/// Records and blocks (contracts/blocks.schema.json), ids, money, look requests.
pub use oikos_world::blocks::{Block, Id, Record, RecordBody};
pub use oikos_world::config::{LookRequest, Query, Who};
pub use oikos_world::money::Money;
pub use oikos_world::state::{Message, Outcome, OutcomeStatus, ParticipantStatus, RefusalInfo, Transaction};
/// The call language (contracts/calls.md): what a code actor writes its acts in. The engine's resolver turns a call
/// into the actor's own acts from what the actor has been shown; an actor never resolves its own.
pub mod calls {
    pub use oikos_resolver::calls::{call_text, format_money, parse_program, program_text, Call, Currency, Line, Program, Value};
}
