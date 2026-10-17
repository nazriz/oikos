//! The explorer's data layer (docs/port-guide.md, "The explorer's data layer"; docs/design/renderer.md; docs/explorer.md):
//! the interface, fixed in the frame, that the port's explorer lane implements by porting renderer/src/indexer.ts,
//! store.ts, trace.ts, world.ts and panels.ts (branch `explorer`). Read-only: it reads a run's log (and, when the
//! engine streams one, a live run's events) and never writes to a run or feeds anything back.
//!
//! Three things, each as the TS explorer has them, so its Three.js client keeps working unchanged:
//! - **the run index** (`RunIndex`): every kept line of a log addressable by its ordinal, and by every id it names
//!   (a person, a place, an organisation, a record, an account), by day, with the act behind each effect;
//! - **the causal trace** (`RunIndex::trace`): from a change back through the act that made it, who decided it and
//!   why, to the records it rested on, and theirs, as far as the log goes; nothing inferred the log does not say;
//! - **who decided** (`Decider`): by role in the world (the person themselves, a person, an organisation's system,
//!   a model seat, the world), never by what runs it.
//!
//! A future engine (a Bevy viewer, in Rust, attached to a live run) uses the same trait in process; the HTTP service
//! (`ROUTES`) serves it to the current client on 127.0.0.1.
//!
//! # Using it
//!
//! ```no_run
//! use oikos_explore::{Index, RunIndex, Panel};
//! let ix = Index::new();
//! ix.load_path(std::path::Path::new("runs/town.seed1.jsonl.zst")).unwrap(); // a finished log
//! // or a live run: ix.feed(&line) for each line the kernel's Stream::take hands out
//! let meta = ix.meta();                       // run id, days, last moment, counts, state
//! let ords = ix.postings("c0042");            // every kept line that names a person
//! let links = ix.trace(ords[0], Some("c0042"), 8);   // the causal trace, newest first
//! let panel = ix.panel(Panel::Person("c0042".into()), 90 * 86_400);
//! ```
//!
//! `Index` is `Send + Sync`: feed from one thread (`feed`, `feed_all`, `load_path` each take the write lock for a
//! batch) and query from any number, at any time. Every query is read-only and returns owned values. The kept lines
//! are held zstd-compressed in frames of 4096, so memory stays bounded. `service::Service` serves the same index to
//! the Three.js client over HTTP on 127.0.0.1; `oikos-explore` is the command line for both.
//!
//! What it never does: write to a run, take a debrief (VISION 15: debriefs and debrief annotations are dropped before
//! anything is parsed into the index), or judge an outcome. Counts and sentences come from the log, as the log has them.

// The explorer is outside the world (a read-only viewer's data layer): nothing it computes is read back, and its
// outputs are ordered by vectors and sorted maps, so the world's determinism lints (kernel/clippy.toml) do not apply.
#![allow(clippy::disallowed_types, clippy::disallowed_methods)]

mod consequential;
mod frames;
mod index;
pub mod inner;
mod js;
mod panels;
pub mod service;
mod trace;
mod world;

pub use index::{Index, INDEX_VERSION};
pub use inner::{parse_line, Item};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A kept line of a run's log, by its place among the kept lines (debriefs and their annotations are not kept: VISION 15).
pub type Ord = u32;

/// Who decided something, by role in the world (renderer/src/world.ts `DeciderClass`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decider {
    /// The person it is traced for, themselves.
    #[serde(rename = "self")]
    Own,
    Person,
    /// An organisation's office, run by a system.
    System,
    /// A model seat.
    Seat,
    /// No act of anyone's: a scheduled payment, a life event, nature, a rule taking its course.
    World,
}

/// What a link of a trace is (renderer/src/trace.ts `Link.role`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Change,
    Act,
    Instruction,
    Basis,
    Genesis,
    World,
    Stop,
}

/// Why an act was done, as the log gives it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Why {
    /// "seat" (its own words, or a confirmed draft), "decision" (a code citizen's recorded decision), "reason" (the
    /// act's reasoning), "none".
    pub kind: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ord: Option<Ord>,
}

/// One link of a causal trace: a sentence in the world's terms, with its time, who decided, their class, and the line
/// it comes from (renderer/src/trace.ts `Link`, field for field).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Link {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ord: Option<Ord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub t: Option<i64>,
    pub depth: u32,
    pub role: Role,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<String>,
    #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
    pub as_: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cls: Option<Decider>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<Why>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record: Option<String>,
}

/// The act behind an action: the act command's line, who, how it came out, when it was done.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionRef {
    pub act: Ord,
    pub participant: String,
    /// "pending", "applied", "refused".
    pub status: String,
    pub end_t: i64,
}

/// A run's index: built once from its log (or kept up to date from a live run's stream), then only read.
pub trait RunIndex: Send + Sync {
    /// The run's id, how many days it covers, its last moment, how many lines are kept.
    fn meta(&self) -> Value;
    /// A kept line, as the log has it (parsed).
    fn line(&self, ord: Ord) -> Option<Value>;
    /// A kept line's text, byte for byte as the log has it.
    fn line_text(&self, ord: Ord) -> Option<String>;
    /// The kept lines that name an id (a person, an entity, a place, a record, an account, a participant), in order.
    fn postings(&self, id: &str) -> Vec<Ord>;
    /// The kept lines of a day (`[first, last)`).
    fn day(&self, day: i64) -> std::ops::Range<Ord>;
    /// The action a kept line is an effect of, if any, and its act.
    fn action_of(&self, ord: Ord) -> Option<ActionRef>;
    /// Who decided, by role, for whom it is traced (`about`: their own acts are `Own`).
    fn decider(&self, participant: &str, about: Option<&str>) -> Decider;
    /// The causal trace of a kept line, newest first, to `max_depth` (the TS default is 8).
    fn trace(&self, ord: Ord, about: Option<&str>, max_depth: u32) -> Vec<Link>;
    /// The panels the client opens (renderer/src/panels.ts), as their JSON: a person, an organisation, a building, a
    /// seat's act, the town's pulse.
    fn panel(&self, what: Panel, t: i64) -> Option<Value>;
}

/// What a panel is of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Panel {
    Person(String),
    Org(String),
    Building(u32),
    SeatAct(Ord),
    TownPulse,
}

/// The HTTP service's routes (renderer/src/server.ts serves the same under `/api`; the client calls these). `<run>` is
/// a run's key; `t` defaults to the run's last moment. 127.0.0.1 only, GET only; anything else is refused.
pub const ROUTES: &[(&str, &str)] = &[
    ("GET /api/runs", "the runs it can show, and their state (none, indexing, ready, failed)"),
    ("GET /api/r/<run>/status[?open=1]", "{state, message, seconds}; `open` starts indexing a run not yet opened"),
    ("GET /api/r/<run>/world", "the town: meta, structures, posts, persons, seats' acts, the town's pulse"),
    (
        "GET /api/r/<run>/bin/<moves|where|pulses|money|agency>[?from=&to=]",
        "the binary tracks the scene draws from (little-endian: moves, pulses int32; where uint32; money float64; agency int16)",
    ),
    ("GET /api/r/<run>/person/<id>?t=", "a person's panel at a moment"),
    ("GET /api/r/<run>/org/<id>?t=", "an organisation's panel"),
    ("GET /api/r/<run>/building/<n>?t=", "a building's panel"),
    ("GET /api/r/<run>/act/<ord>", "a seat's act: its words, the draft, confirmed or not, what came of it, its twin's"),
    ("GET /api/r/<run>/trace/<ord>?about=", "a kept line's row and its causal trace"),
    ("GET /api/r/<run>/line/<ord>", "a kept line as the log has it"),
    ("GET /api/r/<run>/seat/<id>", "a seat's sittings and notebook"),
];
