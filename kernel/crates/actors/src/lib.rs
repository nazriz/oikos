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
    /// The run's seed (the config's): the one that every stream a unit draws from is made from. A person is drawn
    /// who they are from it too, so that runs of one town on different seeds are not the same people.
    pub seed: u64,
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
    /// The run captures its citizens' decisions for training (docs/citizen-data.md): each decision's draws are kept
    /// beside it (`Cx::rng` notes every stream it opens). Read by nothing that decides: a run is the same with it on.
    pub capture: bool,
}

/// Where an actor runs: which participant, acting for which entity, in which position (absent: as itself), and its
/// parameters (a role's parameters with the person's own traits on top, as the engine composes them).
#[derive(Debug, Clone)]
pub struct Ctx {
    pub participant: String,
    pub performer: Performer,
    pub entity: String,
    pub position: Option<String>,
    pub params: Params,
    pub world: Arc<WorldInfo>,
}

/// An actor's parameters: read as the map they are (`ctx.params.get(..)`), held without a copy where they are a member
/// of a value the engine keeps already (a participant's controller, shared with the world's config: a town's people
/// each have large params, and a second copy of them was 2.4 GB at 10,000 people).
/// (Always an object: `member_of` takes one that is not as no params.)
#[derive(Clone)]
pub struct Params {
    of: Arc<Value>,
    /// The member of `of` they are (absent: `of` itself).
    member: Option<&'static str>,
}

impl Params {
    /// The `member` of this value, shared (one that is not an object: no params).
    pub fn member_of(of: Arc<Value>, member: &'static str) -> Params {
        if of[member].is_object() {
            Params { of, member: Some(member) }
        } else {
            Params::default()
        }
    }
}

impl Default for Params {
    fn default() -> Params {
        Params::from(Map::new())
    }
}

impl From<Map<String, Value>> for Params {
    fn from(m: Map<String, Value>) -> Params {
        Params { of: Arc::new(Value::Object(m)), member: None }
    }
}

impl std::ops::Deref for Params {
    type Target = Map<String, Value>;
    fn deref(&self) -> &Map<String, Value> {
        let v = match self.member {
            Some(k) => &self.of[k],
            None => &*self.of,
        };
        match v {
            Value::Object(m) => m,
            _ => unreachable!("params are always an object (`member_of`, `from`)"),
        }
    }
}

/// (Changed in place, they become the actor's own: copied from what they were shared with, the first time.)
impl std::ops::DerefMut for Params {
    fn deref_mut(&mut self) -> &mut Map<String, Value> {
        if self.member.is_some() {
            *self = Params::from((**self).clone());
        }
        match Arc::make_mut(&mut self.of) {
            Value::Object(m) => m,
            _ => unreachable!("made an object just above"),
        }
    }
}

impl<'a> IntoIterator for &'a Params {
    type Item = (&'a String, &'a Value);
    type IntoIter = serde_json::map::Iter<'a>;
    fn into_iter(self) -> Self::IntoIter {
        (**self).iter()
    }
}

impl std::fmt::Debug for Params {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        (**self).fmt(f)
    }
}

impl<'de> Deserialize<'de> for Params {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Params, D::Error> {
        Map::deserialize(d).map(Params::from)
    }
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

/// What a code actor made of a draft of its words, one the host had the translator write for it (a `words` question;
/// docs/behaviour/founding.md, "Through the translator"; run.ts `wordsFor` on the TS world). Nobody reads a code
/// person's draft, so its own module says what the draft may be. The engine writes what the TS host wrote of it: the
/// signoff (where there was a draft to sign) and one `words` note of what came of it. An accepted draft goes with the
/// act that carries it out (`steps::Drafted`) and is reported in the step that sends that act, so the note can say
/// whether the acts were begun; one not accepted, or with no draft, is reported in the step that decided so.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Worded {
    /// The question's `about`: where the actor is told, as an answer of kind `words` (`{done: false, why}`), that the
    /// acts of a draft it accepted could not be begun (`Words.done(false)`).
    pub about: String,
    /// Which part of the words (`name`, `purpose`, `gathers`, `asks`).
    pub what: String,
    pub idea: Option<String>,
    /// The draft's id, where the host gave one.
    pub draft: Option<String>,
    pub draft_hash: Option<String>,
    /// Whether its module said the draft may be (absent: no draft came back to sign).
    pub accepted: Option<bool>,
    /// Why it is not done: the module's reason, or the translator's.
    pub why: Option<String>,
    /// Which translator drafted it, where two stand as one (`first`, `behind`).
    pub by: Option<String>,
    /// The module put in what it holds to be its own plumbing (the accepted acts are not the draft's).
    pub plumbing_added: bool,
    /// Not what was meant, and put once more (a trained translator's first draft): its note waits for the second.
    pub again: bool,
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
    pub(crate) worded: Vec<Worded>,
    /// The purposes of the draws made in the step, in order, where the caller asked to see them (a detached actor
    /// stepped by a test; `Cx::keep_draws`). `None` in a run: nothing is kept.
    drawn: Option<Vec<String>>,
    /// (Capturing: the streams opened since the last decision, and the decisions' draws: docs/citizen-data.md.)
    streams: Vec<Drawn>,
    captured: Vec<Captured>,
}

/// A stream an actor opened while its run captures (`WorldInfo::capture`): its key, where it started, and, where the
/// actor said so (`Cx::drew`), every value it took.
struct Drawn {
    key: Vec<String>,
    start: Rng,
    values: Option<Vec<u64>>,
}

/// A decision's draws, for the capture (docs/citizen-data.md): `at` is the decision's place in `Kept::decisions`, `n`
/// the person's count of it; `draws` the streams opened since the decision before it, in order, each `{key, drawn}`
/// (every value the decision took, where the mind said which stream it chose with) or `{key, u}` (the stream's first
/// value). Values are written as 16 hex digits: a u64 does not fit a JSON reader's number.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct Captured {
    pub at: usize,
    pub n: u64,
    pub draws: Vec<Value>,
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
    /// Drafts of its words it decided on, or whose acts it sends with this action (the engine writes their signoffs and notes).
    #[serde(default)]
    pub worded: Vec<Worded>,
    /// The purposes of the draws it made, in order (`Cx::keep_draws`; empty unless asked for): `chance:` marks a draw about one thing.
    #[serde(default)]
    pub drawn: Vec<String>,
    /// Its decisions' draws, where the run captures (docs/citizen-data.md); empty otherwise, and then not saved, so a
    /// snapshot is the same with the capture off.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub captured: Vec<Captured>,
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
            worded: vec![],
            drawn: None,
            streams: vec![],
            captured: vec![],
        }
    }
    /// Keep the purpose of each draw made from here (for a test that holds draws to their names).
    pub fn keep_draws(&mut self) {
        self.drawn.get_or_insert_with(Vec::new);
    }
    /// A deterministic stream for this participant, this matter or day, and this purpose (docs/reliability.md, "Draws
    /// and the moment"): the same however many threads run and in whatever order actors step.
    pub fn rng(&mut self, purpose: &str) -> Rng {
        if let Some(d) = self.drawn.as_mut() {
            d.push(purpose.to_string());
        }
        let key = self.draws.key(self.t, purpose);
        let parts: Vec<&str> = key.iter().map(String::as_str).collect();
        let r = self.randomness.stream(&parts);
        if self.ctx.world.capture {
            self.streams.push(Drawn { start: r.clone(), key, values: None });
        }
        r
    }
    /// A stream for a purpose alone: the same for whoever draws it (a fact about a thing, not about who meets it).
    pub fn chance(&mut self, purpose: &str) -> Rng {
        if let Some(d) = self.drawn.as_mut() {
            d.push(format!("chance:{purpose}"));
        }
        let purpose = self.draws.chance_purpose(purpose);
        let r = self.randomness.stream(&["chance", &purpose]);
        if self.ctx.world.capture {
            self.streams.push(Drawn { start: r.clone(), key: vec!["chance".into(), purpose], values: None });
        }
        r
    }
    /// Whether the run captures its citizens' decisions (docs/citizen-data.md).
    pub fn capturing(&self) -> bool {
        self.ctx.world.capture
    }
    /// The stream opened last has come to `now`: the values it took are kept for the capture (stepped from its start
    /// until it reaches `now`, at most 4,096; past that only its first value is kept). Nothing when not capturing.
    pub fn drew(&mut self, now: &Rng) {
        let Some(d) = self.streams.last_mut() else { return };
        let mut r = d.start.clone();
        let mut values = vec![];
        while &r != now && values.len() < 4_096 {
            values.push(r.next_u64());
        }
        if &r == now {
            d.values = Some(values);
        }
    }
    /// The decision just recorded (`decided`: this person's `n`th), with the streams opened since the one before it:
    /// for the capture. Nothing when not capturing.
    pub fn capture_turn(&mut self, n: u64) {
        if !self.ctx.world.capture || self.decisions.is_empty() {
            return;
        }
        let hex = |v: u64| Value::String(format!("{v:016x}"));
        let draws = self
            .streams
            .drain(..)
            .map(|d| {
                let mut o = Map::new();
                o.insert("key".into(), Value::Array(d.key.into_iter().map(Value::String).collect()));
                match d.values {
                    Some(v) => o.insert("drawn".into(), Value::Array(v.into_iter().map(hex).collect())),
                    None => o.insert("u".into(), hex(d.start.clone().next_u64())),
                };
                Value::Object(o)
            })
            .collect();
        self.captured.push(Captured { at: self.decisions.len() - 1, n, draws });
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
    /// What it made of a draft of its words (`Worded`).
    pub fn worded(&mut self, w: Worded) {
        self.worded.push(w);
    }
    /// What the step left beside its action (the engine's).
    pub fn into_kept(self) -> Kept {
        Kept { decisions: self.decisions, outcomes: self.outcomes, record: self.record, questions: self.questions, worded: self.worded, drawn: self.drawn.unwrap_or_default(), captured: self.captured }
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
    /// How much it keeps, counted by what (for whoever measures memory: `oikos-kernel world` with `OIKOS_KEPT` set
    /// sums these over a run's actors at its end). None: not counted.
    fn kept(&self) -> Option<std::collections::BTreeMap<String, u64>> {
        None
    }
}

/// Entries of each collection in a saved memory, by path (`s.read_news`), two levels down: for `Actor::kept`.
pub fn kept_sizes(prefix: &str, v: &Value, out: &mut std::collections::BTreeMap<String, u64>) {
    let Value::Object(m) = v else { return };
    for (k, x) in m {
        let path = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
        match x {
            Value::Array(a) => *out.entry(path).or_default() += a.len() as u64,
            Value::Object(o) => {
                *out.entry(path.clone()).or_default() += o.len() as u64;
                if prefix.split('.').count() < 3 {
                    kept_sizes(&path, x, out);
                }
            }
            _ => {}
        }
    }
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
