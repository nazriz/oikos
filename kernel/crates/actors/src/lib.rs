//! The world's built-in actors (docs/design/rust-port.md 2.1, 2.5; docs/port-guide.md).
//!
//! An actor is world content: a documented, cited rule set (docs/behaviour/) for one kind of participant. It is given
//! what its participant was shown (a `Picture`, from `oikos-sight`), its own memory, its parameters and its keyed
//! random streams, and it answers with an `Action`, exactly what any other participant answers, so a model or a person
//! can take over any actor without special cases (VISION principle 4).
//!
//! The boundary is a dependency rule: this crate cannot name the world's state (see Cargo.toml), so an actor knows the
//! world only through what it perceives and its own parameters (docs/no-god-view.md). Its work takes world time because
//! every act it returns goes through the kernel, which places it on its performer's timeline (docs/all-work-takes-time.md).
//!
//! Determinism rules (the engine runs actors on many threads at once and merges in key order):
//! - randomness only from `Cx::rng` / `Cx::chance` (the kernel's keyed streams), never by order of drawing;
//! - no clocks, no I/O, no global or thread-local state, no `HashMap` iterated where order can reach an outcome;
//! - integers for money and basis points; floats only where a model needs them, through `libm`, never in a result
//!   that is compared across machines without rounding to an integer first;
//! - memory is allowed (people remember) but depends only on what the actor was shown and drew.

#![forbid(unsafe_code)]

pub mod boundary;
pub mod citizen;
pub mod common;
pub mod draws;
pub mod finance;
pub mod firms;
pub mod market;
pub mod mind;
pub mod offices;
pub mod papers;
pub mod registry;
pub mod steps;
pub mod stub;
pub mod testkinds;

pub use draws::Draws;
pub use oikos_sight as sight;
pub use oikos_sight::{Action, Picture};

use oikos_core::rng::{Randomness, Rng};
use oikos_rules::slip::{Performer, SlipTable, Slipper};
use oikos_sight::calls::Currency;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::Arc;

pub const DAY: i64 = 86_400;

/// What an actor may know about the run itself: the clock's grain, when the run ends, the world's money, its dials and
/// its table of slips. Nothing about the world: that it knows only by perceiving (P14).
#[derive(Debug, Clone, Default)]
pub struct WorldInfo {
    pub tick: i64,
    pub run_end: i64,
    /// How the world's money is written (its config's first currency).
    pub currency: Option<Currency>,
    /// The living world's dials (docs/design/ai-citizens.md 10j), as the config sets them; `Null`: every dial off.
    pub dials: Value,
    /// `orchestration.slip`, read only through `oikos_rules::slip`.
    pub slip: Option<SlipTable>,
    /// The world's calendar (the config's `calendar`: docs/design/names-and-dates.md section 5), where it has one:
    /// civil dates, working days and calendar months. Absent: the old towns, whose dates are "year N, day D".
    pub calendar: Option<oikos_rules::calendar::Calendar>,
    /// How the place writes a date (the same `calendar` section's `format`, `long_format`, `months`, `weekdays`): absent, an
    /// ISO date. Read through `common::when_words`, the one place a date is written in words.
    pub date_style: Option<oikos_rules::calendar::DateStyle>,
}

/// Where an actor runs: which participant, acting for which entity, in which position (absent: as itself), and its
/// parameters (a role's parameters with the person's own traits on top, as the engine composes them).
#[derive(Debug, Clone)]
pub struct Ctx {
    pub participant: String,
    pub performer: Performer,
    pub entity: String,
    pub position: Option<String>,
    pub params: Map<String, Value>,
    pub world: Arc<WorldInfo>,
}

impl Ctx {
    /// A parameter, read as `T`, or `default` when the world does not give it (a module's documented default).
    pub fn param<T: serde::de::DeserializeOwned>(&self, key: &str, default: T) -> Result<T, String> {
        match self.params.get(key) {
            None | Some(Value::Null) => Ok(default),
            Some(v) => serde_json::from_value(v.clone()).map_err(|e| format!("{}'s parameter {key}: {e}", self.participant)),
        }
    }
    /// A parameter the world must give (whom an actor deals with: no module assumes a world's names).
    pub fn need<T: serde::de::DeserializeOwned>(&self, key: &str, kind: &str) -> Result<T, String> {
        match self.params.get(key) {
            None | Some(Value::Null) => {
                Err(format!("{kind}: the world must say {key} (whom it deals with; no module assumes a world's names)"))
            }
            Some(Value::String(s)) if s.is_empty() => {
                Err(format!("{kind}: the world must say {key} (whom it deals with; no module assumes a world's names)"))
            }
            Some(v) => serde_json::from_value(v.clone()).map_err(|e| format!("{}'s parameter {key}: {e}", self.participant)),
        }
    }
}

/// A question an actor puts to a model (the sparse mind's consult, the composer, the reading desk): asked in one wake,
/// answered by the next (docs/design/rust-port.md 2.3). `kind` names which model service; `about` is the actor's own
/// name for it, which the answer carries back; `body` is the question as that service takes it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Question {
    pub kind: String,
    pub about: String,
    pub body: Value,
}

/// A model's answer to a question of this actor's, with the question's `about`. `body` is `Null` where no answer
/// could be had (the allowance spent, the model did not answer): the actor decides without it, as it would offline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Answer {
    pub kind: String,
    pub about: String,
    pub body: Value,
}

/// A belief an actor holds about the world, in a form the engine can check against the terms' readings (truth audits,
/// docs/design/rebuild.md 8.2). Never used to decide anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "of", rename_all = "snake_case")]
pub enum Belief {
    Agreement { agreement: String, in_force: bool },
    Between { template: String, parties: [String; 2], in_force: bool },
    Held { party: String, template: String, agreements: Vec<String> },
}

/// One step's context: the moment, the actor's static context, its keyed streams, answers to its questions, and what
/// it records on the way (its decisions, what it came to know of how they turned out, a change to its own record, new
/// questions). The engine takes these after the step, in key order.
pub struct Cx<'a> {
    pub t: i64,
    pub ctx: &'a Ctx,
    draws: &'a mut Draws,
    randomness: Randomness,
    pub answers: Vec<Answer>,
    pub(crate) decisions: Vec<Value>,
    pub(crate) outcomes: Vec<Value>,
    pub(crate) record: Option<Value>,
    pub(crate) questions: Vec<Question>,
}

/// What a step left beside its action.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Kept {
    /// Decisions on the way (docs/design/ai-citizens.md 7: `decision` annotations), as their JSON.
    pub decisions: Vec<Value>,
    /// What it came to know of how its choices turned out (one `outcome` annotation).
    pub outcomes: Vec<Value>,
    /// A change to its own record (`{set, because?}`, docs/design/ai-citizens.md 10d): the kernel holds it.
    pub record: Option<Value>,
    pub questions: Vec<Question>,
}

impl<'a> Cx<'a> {
    pub fn new(t: i64, ctx: &'a Ctx, draws: &'a mut Draws, seed: u64, answers: Vec<Answer>) -> Self {
        Cx {
            t,
            ctx,
            draws,
            randomness: Randomness::new(seed),
            answers,
            decisions: vec![],
            outcomes: vec![],
            record: None,
            questions: vec![],
        }
    }
    /// A deterministic stream for this participant, this matter or day, and this purpose (docs/reliability.md, "Draws
    /// and the moment"): the same however many threads run and in whatever order actors step.
    pub fn rng(&mut self, purpose: &str) -> Rng {
        let key = self.draws.key(self.t, purpose);
        let parts: Vec<&str> = key.iter().map(String::as_str).collect();
        self.randomness.stream(&parts)
    }
    /// A stream for a purpose alone: the same for whoever draws it (a fact about a thing, not about who meets it).
    pub fn chance(&self, purpose: &str) -> Rng {
        self.randomness.stream(&["chance", purpose])
    }
    pub fn decided(&mut self, decision: Value) {
        self.decisions.push(decision);
    }
    pub fn learned(&mut self, outcome: Value) {
        self.outcomes.push(outcome);
    }
    pub fn set_record(&mut self, change: Value) {
        self.record = Some(change);
    }
    pub fn ask(&mut self, q: Question) {
        self.questions.push(q);
    }
    /// What the step left beside its action (the engine's).
    pub fn into_kept(self) -> Kept {
        Kept { decisions: self.decisions, outcomes: self.outcomes, record: self.record, questions: self.questions }
    }
}

impl Slipper for Cx<'_> {
    fn rng(&mut self, purpose: &str) -> Rng {
        Cx::rng(self, purpose)
    }
    fn performer(&self) -> Performer {
        self.ctx.performer
    }
    fn slip_table(&self) -> Option<&SlipTable> {
        self.ctx.world.slip.as_ref()
    }
    fn friction_bps(&self) -> i64 {
        self.ctx.world.dials.get("friction_bps").and_then(Value::as_i64).unwrap_or(0).max(0)
    }
}

/// One participant's controller: steps while awake, `Action::Wait` to sleep.
pub trait Actor: Send {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action;
    /// What it believes about the world when a wake is done, for truth audits.
    fn beliefs(&self) -> Vec<Belief> {
        vec![]
    }
    /// The act it just returned reached the world as this action (its outcome, when it comes, names it).
    fn sent(&mut self, _action: &str) {}
    /// Its whole memory, as JSON (snapshot and fork: docs/port-guide.md, "Snapshots"). `Kind::restore` of this must
    /// give an actor that steps exactly as this one would from here. Required: every actor's memory is saved.
    fn save(&self) -> Result<Value, String>;
}

/// A kind of actor (what a world names in `controller.impl` or a position's `role_module.code`).
pub trait Kind: Sync {
    fn name(&self) -> &'static str;
    /// Bumped whenever the rules change; recorded in every run's log.
    fn version(&self) -> &'static str;
    /// Where its rules are documented, with their sources.
    fn doc(&self) -> &'static str;
    /// Its manifest (contracts/module.schema.json): parameters, what it keeps and carries of the world's edge, the
    /// papers it issues and the directions it takes. Read by the generator, the seat prompts and the backstop tests.
    fn manifest(&self) -> Value;
    /// How long it sleeps when it waits without saying until when (seconds).
    fn cadence(&self, ctx: &Ctx) -> i64;
    /// When it first wakes (seconds from the start).
    fn first_wake(&self, _ctx: &Ctx) -> i64 {
        0
    }
    /// Woken by its cadence and what it asks for, never by news (foundations F6).
    fn deaf(&self) -> bool {
        false
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String>;
    /// An actor as `Actor::save` left it, in the same context.
    fn restore(&self, ctx: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String>;
}
