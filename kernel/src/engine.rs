//! The engine: the world's run loop with its built-in actors inside it (docs/design/rust-port.md 2.2, 2.3;
//! docs/port-guide.md). It replaces the code-participant half of orchestrator/src/run.ts.
//!
//! A moment runs as the TS loop ran it:
//! 1. **Who wakes**: everyone due now, code actors and seats alike, in key order (crate::schedule).
//! 2. **Look**: each looks, in that order, through the kernel's own command path (logged, delivered, the seat's
//!    knowledge kept for the resolver), the observations made ready together on several threads (`Kernel::plan`). A
//!    code actor's observation goes into its view as typed values and is never written out for it; a seat's is
//!    handed to the host as the contract's JSON.
//! 3. **Decide**: every code actor of the round steps at once, on up to `threads` threads; each result goes to its
//!    unit's own slot, so nothing depends on which thread finished first. Seats' wakes go to the host
//!    (`Due::Seats`); the engine waits for each seat's action (`submit`).
//! 4. **Carry out**: every action of the round, in key order, serially. Nothing that ran in parallel wrote anything.
//! 5. Those whose wakes go on (they looked, or asked for something the resolver could not do) take another round at
//!    the same moment; then the clock moves.
//!
//! Actors cannot reach the world (they are in `oikos-actors`, which cannot name it); the engine is what hands them
//! what they were shown, and it is the only one that writes, through the kernel.

use crate::kernel::Command;
use crate::run::Run;
use crate::schedule::{Next, Scheduler};
use oikos_actors::sight::{Action, LookRequest, Provenance, View};
use oikos_actors::{Actor, Answer, Belief, Ctx, Cx, Draws, Kept, Question, WorldInfo, DAY};
use oikos_rules::slip::Performer;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::sync::Arc;

pub const ENGINE_VERSION: &str = "0.2.0";

mod hosted;
mod snapshot;
pub use snapshot::{Snapshot, SNAPSHOT_FORMAT};

/// More rounds than this at one moment means actors are waking each other without end (D59).
pub const MAX_ROUNDS_PER_MOMENT: u32 = 1000;
/// A unit that fails to decide this many times in a row is retired (D59).
pub const MAX_FAILURES_IN_A_ROW: u32 = 3;
/// Fewer actors than this in a round are stepped on one thread (starting threads costs more).
const WORTH_SHARING: usize = 16;

#[derive(Debug, Clone)]
pub struct EngineOptions {
    /// Threads the deciding is shared over (1: one at a time). No result depends on it.
    pub threads: usize,
    /// A kind to run for every kind the engine does not have yet (`idle`, while porting); `None`: refuse the world.
    pub stand_in: Option<String>,
    /// Stop early (simulated seconds); default: the world's run length.
    pub until: Option<i64>,
    /// Record code actors' decisions and outcomes (unless the log is lean).
    pub record_decisions: bool,
    /// Truth audits: each actor's beliefs, when a wake is done, checked against the terms' readings.
    pub audit: bool,
    /// Fewer actors than this in a round are stepped on one thread (starting threads costs more than it saves).
    pub share_at: usize,
    /// The seats are the mock (no model): a seat that sits as its code twin (`mock.twin` with a `mock.brain`) is
    /// scheduled as its brain's unit would be (run.ts `llmUnit`). A host with a real model says false.
    pub mock_seats: bool,
    /// The host carries its seats through the participant API itself (the TS host's run loop, orchestrator/src/run.ts,
    /// under OIKOS_WORLD=rust): a seat awake is handed over unobserved, the host observes it, decides and acts for it
    /// with commands of its own, and says when its wake is done (`host_finished`); the round's code actions before a
    /// seat in key order are carried out before that seat's first act (`host_command`).
    pub host_seats: bool,
    /// Record each code actor's observation in full, as an `observation` annotation, as run.ts did for code units when
    /// asked (`recordObservations: "code" | "all"`): for the invariants' no-god-view check and for training data.
    pub record_observations: bool,
    /// Or only these participants' (run.ts `recordObservations` as a list).
    pub record_observations_of: BTreeSet<String>,
}

impl Default for EngineOptions {
    fn default() -> Self {
        EngineOptions {
            threads: default_threads(),
            stand_in: None,
            until: None,
            record_decisions: true,
            audit: false,
            share_at: WORTH_SHARING,
            mock_seats: true,
            host_seats: false,
            record_observations: false,
            record_observations_of: BTreeSet::new(),
        }
    }
}

/// The events a host carrying its seats reads from the engine's own commands (orchestrator/src/run.ts, `absorb`): the
/// cast as it changes, refusals (its summary counts them), and statements recorded (its reading desk reads seats').
fn host_reads(e: &crate::events::EventBody) -> bool {
    use crate::events::EventBody as E;
    match e {
        E::ParticipantCreated { .. } | E::ParticipantEnded { .. } | E::PositionCreated { .. } | E::Appointed { .. } | E::ActionRefused { .. } => true,
        E::Recorded { record } => matches!(record.body, crate::blocks::RecordBody::Statement { .. }),
        _ => false,
    }
}

/// `OIKOS_ENGINE_THREADS` if set, else the machine's cores.
pub fn default_threads() -> usize {
    std::env::var("OIKOS_ENGINE_THREADS")
        .ok()
        .and_then(|x| x.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()))
}

/// A seat's wake, for its host: who, why, since when, and what it was shown (the contract's Observation, as JSON).
#[derive(Debug, Clone)]
pub struct SeatWake {
    pub key: String,
    pub participant: String,
    pub t: i64,
    pub woke_for: String,
    pub since: i64,
    pub observation: Value,
}

/// What the host must do next.
#[derive(Debug)]
pub enum Due {
    /// These seats are awake: `submit` an action for each, then call `next` again.
    Seats(Vec<SeatWake>),
    /// The run has reached its end (or `until`): call `finish`.
    End,
}

/// A participant of the cast, as the engine keeps it (run.ts `Part`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Part {
    kind: String,
    person: Option<String>,
    controller: Value,
    traits: Value,
    /// A model's seat in one post of a person (foundations F5): it acts through their body.
    #[serde(default)]
    shares_body: bool,
    ended: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Pos {
    entity: String,
    holder: Option<String>,
    role_module: Value,
    keeps_record: bool,
}

struct Unit {
    key: String,
    participant: String,
    /// "self" or a position; `None` for a seat (it perceives all its capacities).
    capacity: Option<String>,
    entity: String,
    kind: &'static str,
    actor: Option<Box<dyn Actor>>,
    ctx: Option<Ctx>,
    draws: Draws,
    view: View,
    looks: Option<Vec<LookRequest>>,
    answers: Vec<Answer>,
    woke_for: String,
    since: i64,
    failures: u32,
    /// Divergences of its beliefs found at its last audit, with when each was first found.
    diverged: BTreeMap<String, i64>,
}

impl Unit {
    fn seat(&self) -> bool {
        self.actor.is_none()
    }
}

/// What a unit decided this round.
enum Decided {
    Code(Result<(Action, Kept), String>),
    Seat(Option<Action>),
}

struct Round {
    awake: Vec<(String, u32)>,
    decided: BTreeMap<String, Decided>,
    /// How many of `awake` have been carried out (a host's seats carry themselves out in their places: `host_seats`).
    cursor: usize,
    /// Those carried out whose wakes go on.
    next: Vec<(String, u32)>,
}

/// What an actor may know of the run (its clock, money, dials, slips and calendar), as a world's config gives it.
pub fn world_info(config: &Value) -> Result<WorldInfo, String> {
    Ok((*Base::of(config)?.world).clone())
}

/// What the engine reads once from a world's config (the same at the start and when a snapshot is resumed).
struct Base {
    types: BTreeMap<String, Value>,
    currency: Option<oikos_resolver::calls::Currency>,
    dated: Option<oikos_rules::calendar::Dated>,
    templates: BTreeMap<String, Value>,
    world: Arc<WorldInfo>,
    seed: u64,
    tick: i64,
    run_end: i64,
    lean: bool,
    thinking: Option<i64>,
}

impl Base {
    fn of(config: &Value) -> Result<Base, String> {
        let types = config["catalogue"]["structure_types"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|t| Some((t["id"].as_str()?.to_string(), t.clone())))
            .collect();
        let currency = oikos_resolver::calls::Currency::from_config(&config["world"]["currencies"][0]);
        let tick = config["clock"]["tick_seconds"].as_i64().ok_or("the world's clock has no tick")?;
        let run_end = ceil_to(config["clock"]["run_seconds"].as_i64().ok_or("the world's clock has no run length")?, tick);
        let seed = config["seed"].as_u64().ok_or("the world has no seed")?;
        let lean = config["log"]["detail"].as_str() == Some("lean");
        let thinking = (config["orchestration"]["thinking_time"].as_str() == Some("costs_world_time"))
            .then(|| config["orchestration"]["thinking"]["code_seconds"].as_i64().unwrap_or(0));
        let world = Arc::new(WorldInfo {
            tick,
            run_end,
            currency: currency.clone(),
            dials: config.get("dials").cloned().unwrap_or(Value::Null),
            slip: config["orchestration"]
                .get("slip")
                .map(|s| serde_json::from_value(s.clone()))
                .transpose()
                .map_err(|e| format!("orchestration.slip: {e}"))?,
            // (The config's calendar, where a world has one: lane N writes the section; docs/port-guide.md, step 1b.)
            calendar: config.get("calendar").map(|c| serde_json::from_value(c.clone())).transpose().map_err(|e| format!("calendar: {e}"))?,
            date_style: config.get("calendar").map(|c| serde_json::from_value(c.clone())).transpose().map_err(|e| format!("calendar: {e}"))?,
        });
        let dated = oikos_rules::calendar::Dated::from_config(config.get("calendar"));
        let templates =
            config["templates"].as_array().into_iter().flatten().filter_map(|t| Some((t["id"].as_str()?.to_string(), t.clone()))).collect();
        Ok(Base { types, currency, dated, templates, world, seed, tick, run_end, lean, thinking })
    }
}

pub struct Engine<W: Write> {
    run: Run<W>,
    sched: Scheduler,
    knowledge: BTreeMap<String, oikos_resolver::Knowledge>,
    registers: oikos_resolver::knowledge::Registers,
    types: BTreeMap<String, Value>,
    currency: Option<oikos_resolver::calls::Currency>,
    dated: Option<oikos_rules::calendar::Dated>,
    parts: BTreeMap<String, Part>,
    positions: BTreeMap<String, Pos>,
    templates: BTreeMap<String, Value>,
    units: BTreeMap<String, Unit>,
    world: Arc<WorldInfo>,
    seed: u64,
    opts: EngineOptions,
    tick: i64,
    until: i64,
    run_end: i64,
    round: Option<Round>,
    rounds_at: (i64, u32),
    questions: Vec<(String, Question)>,
    lean: bool,
    thinking: Option<i64>,
    used: BTreeMap<String, String>,
    /// `next_by`'s limit: nothing after it is begun (the clock is not moved past it), so a snapshot taken there is
    /// one the run goes on from exactly as it would have.
    pause: Option<i64>,
    /// A host's own command is being carried out (its events are in its reply, not in `for_host`).
    hosting: bool,
    /// The events of the engine's own commands since the host last took them that the host reads (`host_seats`: it
    /// keeps its cast from them, counts refusals and reads seats' statements, as from its own commands' replies), and
    /// whether there were any events at all (the host is told time moved on either way). Only those it reads are kept:
    /// with no seat awake the host is not asked for a whole run, and keeping every event held the run's events in
    /// memory (10 GB for a 1,000-person year) to hand them over in one reply at the end.
    for_host: Vec<crate::events::Event>,
    for_host_any: bool,
    /// For whoever measures: how many steps the actors took (never logged).
    pub steps: u64,
}

fn ceil_to(t: i64, tick: i64) -> i64 {
    if tick <= 0 {
        return t;
    }
    t.div_euclid(tick) * tick + if t.rem_euclid(tick) == 0 { 0 } else { tick }
}

/// `f` of each item, in the items' order, on up to `threads` threads: each thread takes the next item not yet taken
/// (one actor's step can take a hundred times another's, so even chunks left most threads waiting on one), and each
/// result goes in its item's place. The same results however the work falls out.
pub fn each_mut<T: Send, R: Send>(items: &mut [T], threads: usize, share_at: usize, f: impl Fn(&mut T) -> R + Sync) -> Vec<R> {
    let threads = threads.min(items.len()).max(1);
    if threads < 2 || items.len() < share_at.max(1) {
        return items.iter_mut().map(f).collect();
    }
    let n = items.len();
    let next = std::sync::Mutex::new(items.iter_mut().enumerate());
    let (f, next) = (&f, &next);
    let done: Vec<Vec<(usize, R)>> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|_| {
                scope.spawn(move || {
                    let mut mine = vec![];
                    loop {
                        let Some((i, item)) = next.lock().unwrap_or_else(|e| e.into_inner()).next() else { break mine };
                        mine.push((i, f(item)));
                    }
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().expect("an actor's thread does not panic: steps are caught")).collect()
    });
    let mut slots: Vec<Option<R>> = (0..n).map(|_| None).collect();
    for (i, r) in done.into_iter().flatten() {
        slots[i] = Some(r);
    }
    slots.into_iter().map(|r| r.expect("every item was worked out")).collect()
}

impl<W: Write> Engine<W> {
    /// A run of this world, its log written to `out`.
    pub fn start(config: Value, run_id: &str, out: W, anchors: Option<Box<dyn Write>>, opts: EngineOptions) -> Result<Self, String> {
        let base = Base::of(&config)?;
        let mut parts = BTreeMap::new();
        for p in config["participants"].as_array().into_iter().flatten() {
            let id = p["id"].as_str().ok_or("a participant without an id")?.to_string();
            parts.insert(
                id,
                Part {
                    kind: p["kind"].as_str().unwrap_or("person").into(),
                    person: p["person"].as_str().map(String::from),
                    controller: p["controller"].clone(),
                    traits: p["traits"].clone(),
                    shares_body: p["shares_body"].as_bool() == Some(true),
                    ended: false,
                },
            );
        }
        let mut positions = BTreeMap::new();
        for x in config["positions"].as_array().into_iter().flatten() {
            let id = x["id"].as_str().ok_or("a position without an id")?.to_string();
            positions.insert(
                id,
                Pos {
                    entity: x["entity"].as_str().unwrap_or_default().into(),
                    holder: x["holder"].as_str().map(String::from),
                    role_module: x["role_module"].clone(),
                    keeps_record: x["keeps_record"].as_bool() == Some(true),
                },
            );
        }
        let thinking_time = config["orchestration"]["thinking_time"].clone();
        let run = Run::start(config, run_id, out, anchors).map_err(|e| e.to_string())?;
        let mut e = Engine::assemble(run, base, opts, Scheduler::new(0));
        e.sched = Scheduler::new(e.tick);
        e.parts = parts;
        e.positions = positions;
        for pid in e.parts.keys().cloned().collect::<Vec<_>>() {
            e.sync_units(&pid, None)?;
        }
        let modules: Map<String, Value> = e.used.iter().map(|(k, v)| (k.clone(), json!({ "version": v }))).collect();
        if e.opts.host_seats {
            // (The host writes the run's `orchestrator` record, as it always has: the engine's part is a note beside it.)
            e.note("orchestrator", json!({ "engine": { "version": ENGINE_VERSION, "modules": modules } }))?;
        } else {
            e.annotate(json!({ "annotation": "orchestrator", "subject": "orchestrator", "data": { "version": format!("engine {ENGINE_VERSION}"), "modules": modules, "thinking_time": thinking_time } }))?;
        }
        Ok(e)
    }

    /// An engine around a run, with nobody in it yet (`start` and `resume` fill it in).
    fn assemble(mut run: Run<W>, base: Base, opts: EngineOptions, sched: Scheduler) -> Self {
        // A moment's observations are made ready on the engine's threads, as its actors decide on them: the kernel's own
        // default (one) is for a host that decides itself. OIKOS_KERNEL_THREADS, where it is set, still says how many.
        // Nothing depends on it (`Kernel::plan`).
        if std::env::var_os("OIKOS_KERNEL_THREADS").is_none() {
            run.share(opts.threads, None);
        }
        let until = opts.until.map_or(base.run_end, |u| u.min(base.run_end));
        Engine {
            sched,
            run,
            knowledge: BTreeMap::new(),
            registers: Default::default(),
            types: base.types,
            currency: base.currency,
            dated: base.dated,
            parts: BTreeMap::new(),
            positions: BTreeMap::new(),
            templates: base.templates,
            units: BTreeMap::new(),
            world: base.world,
            seed: base.seed,
            opts,
            tick: base.tick,
            until,
            run_end: base.run_end,
            round: None,
            rounds_at: (-1, 0),
            questions: vec![],
            lean: base.lean,
            thinking: base.thinking,
            used: BTreeMap::new(),
            pause: None,
            hosting: false,
            for_host: vec![],
            for_host_any: false,
            steps: 0,
        }
    }

    pub fn t(&self) -> i64 {
        self.run.kernel().t()
    }
    pub fn state_hash(&self) -> Result<String, String> {
        self.run.kernel().state_hash().map_err(|e| e.to_string())
    }
    pub fn run(&self) -> &Run<W> {
        &self.run
    }
    /// The log's writer (a binary log, to put a snapshot in it; a tee, for its stream).
    pub fn log_out(&mut self) -> &mut W {
        self.run.log_out()
    }
    pub fn log_ref(&self) -> &W {
        self.run.log_ref()
    }
    /// A record of the host's own into the log (a seat's usage and cost, a transcript, a debrief): checked against
    /// the Annotation contract, as the stdio protocol's `annotate` is.
    pub fn annotate_from_host(&mut self, annotation: Value) -> Result<(), String> {
        self.annotate(annotation)
    }
    /// The log's next entry's seq and the last entry's hash.
    pub fn log_head(&self) -> (u64, String) {
        self.run.log_head()
    }
    /// The log's writer back (a test's buffer).
    pub fn into_log(self) -> W {
        self.run.into_log()
    }

    fn annotate(&mut self, a: Value) -> Result<(), String> {
        self.run.annotate(a).map(|_| ()).map_err(|e| e.to_string())
    }

    fn note(&mut self, subject: &str, data: Value) -> Result<(), String> {
        self.annotate(json!({ "annotation": "note", "subject": subject, "data": data }))
    }

    /// A command through the kernel, as the session's `command` takes one: logged, the seat's knowledge kept from what
    /// it was shown, the schedule told, the cast changed. `Err`: off-contract (never logged).
    fn command(&mut self, cmd: &Command) -> Result<crate::run::Response, String> {
        self.command_seen(cmd).map(|x| x.0)
    }

    /// `command`, with the observation as it was delivered (its JSON, for a host's reply).
    fn command_seen(&mut self, cmd: &Command) -> Result<(crate::run::Response, Option<crate::kernel::Observed>), String> {
        let mut resp = self.run.command(cmd).map_err(|e| e.to_string())?;
        let mut seen = None;
        if let Some(obs) = resp.observation.as_mut() {
            let o = self.run.observed(obs).map_err(|e| e.to_string())?;
            if let Command::Observe { participant, only } | Command::Look { participant, only, .. } = cmd {
                let key = only.as_ref().map_or_else(|| participant.clone(), |o| format!("{participant}|{o}"));
                let cur = self.currency.clone();
                let dated = self.dated.clone();
                self.knowledge.entry(key).or_insert_with(|| oikos_resolver::Knowledge::new(cur).with_dated(dated)).absorb_seen(
                    &crate::kernel::seen(obs),
                    &o.shown,
                    &mut self.registers,
                );
            }
            seen = Some(o);
        }
        let t = self.run.kernel().t();
        self.sched.note_events(Some(self.run.kernel().state()), &resp.events, t);
        self.note_cast(&resp.events)?;
        if self.opts.host_seats && !self.hosting && !resp.events.is_empty() {
            self.for_host_any = true;
            self.for_host.extend(resp.events.iter().filter(|e| host_reads(&e.body)).cloned());
        }
        Ok((resp, seen))
    }

    /// The cast as commands change it: participants and positions come and go, and units with them (run.ts `noteCast`).
    fn note_cast(&mut self, events: &[crate::events::Event]) -> Result<(), String> {
        use crate::events::EventBody as E;
        let mut changed = BTreeSet::new();
        for e in events {
            match &e.body {
                E::ParticipantCreated { participant, kind, person, template, traits, .. } => {
                    let tpl = self.templates.get(template);
                    let kind =
                        serde_json::to_value(kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_else(|| "person".into());
                    self.parts.insert(
                        participant.clone(),
                        Part {
                            kind,
                            person: person.clone(),
                            controller: tpl.map_or(Value::Null, |t| t["controller"].clone()),
                            traits: traits.clone().unwrap_or(Value::Null),
                            shares_body: false,
                            ended: false,
                        },
                    );
                    changed.insert(participant.clone());
                }
                E::PositionCreated { position, entity, role_module, .. } => {
                    let rm = role_module.clone().unwrap_or(Value::Null);
                    let keeps = rm["keeps_record"].as_bool() == Some(true);
                    self.positions
                        .insert(position.clone(), Pos { entity: entity.clone(), holder: None, role_module: rm, keeps_record: keeps });
                }
                E::Appointed { position, holder, .. } => {
                    if let Some(x) = self.positions.get_mut(position) {
                        if let Some(h) = x.holder.take() {
                            changed.insert(h);
                        }
                        x.holder = holder.clone();
                        if let Some(h) = holder {
                            changed.insert(h.clone());
                        }
                    }
                }
                E::ParticipantEnded { participant, .. } => {
                    if let Some(p) = self.parts.get_mut(participant) {
                        p.ended = true;
                    }
                    changed.insert(participant.clone());
                }
                _ => {}
            }
        }
        let t = self.run.kernel().t();
        for pid in changed {
            self.sync_units(&pid, Some(t))?;
        }
        Ok(())
    }

    fn held(&self, pid: &str) -> Vec<String> {
        self.positions.iter().filter(|(_, x)| x.holder.as_deref() == Some(pid)).map(|(id, _)| id.clone()).collect()
    }

    /// Every capacity of a participant has its unit, and nothing it no longer holds does (run.ts `syncUnits`).
    fn sync_units(&mut self, pid: &str, wake_at: Option<i64>) -> Result<(), String> {
        let Some(p) = self.parts.get(pid).cloned() else { return Ok(()) };
        let seat = p.controller["type"].as_str() == Some("llm");
        let mut want = BTreeSet::new();
        if !p.ended {
            if seat {
                want.insert(pid.to_string());
            } else {
                if p.kind == "person" {
                    want.insert(format!("{pid}|self"));
                }
                for x in self.held(pid) {
                    want.insert(format!("{pid}|{x}"));
                }
            }
        }
        let gone: Vec<String> =
            self.units.keys().filter(|k| (k.as_str() == pid || k.starts_with(&format!("{pid}|"))) && !want.contains(*k)).cloned().collect();
        for k in &gone {
            self.units.remove(k);
        }
        if !gone.is_empty() {
            self.sched.remove(&gone);
        }
        let mut added = vec![];
        for key in want {
            if self.units.contains_key(&key) {
                continue;
            }
            let made = if seat { Some(self.seat_unit(pid, &p, wake_at)) } else { self.code_unit(pid, &p, &key[pid.len() + 1..], wake_at)? };
            if let Some((u, entry)) = made {
                added.push(entry);
                self.units.insert(key, u);
            }
        }
        if !added.is_empty() {
            self.sched.add(&added)?;
        }
        Ok(())
    }

    fn seat_unit(&self, pid: &str, p: &Part, wake_at: Option<i64>) -> (Unit, Value) {
        let pp = &p.controller["params"];
        let mut cadence = ceil_to(pp["cadence_days"].as_i64().unwrap_or(7) * DAY, self.tick);
        let held = self.held(pid);
        let office = (held.len() == 1).then(|| held[0].clone());
        let entity = match &office {
            Some(o) => self.positions[o].entity.clone(),
            None => p.person.clone().unwrap_or_default(),
        };
        // (Where the person's own unit for this post would stand in a moment's wakes: the same key, so that a seat and
        // its code twin act in one order; run.ts `llmUnit`.)
        let code_twin = p.person.as_ref().and_then(|person| {
            self.parts.iter().find(|(id, x)| x.person.as_ref() == Some(person) && id.as_str() != pid && !x.shares_body).map(|(id, _)| id.clone())
        });
        let mut entry = json!({ "key": pid, "participant": pid, "llm": true });
        if let (Some(ct), Some(o)) = (&code_twin, &office) {
            entry["sort"] = json!(format!("{ct}|{o}"));
        }
        let mut first = wake_at.unwrap_or(0);
        // A mock seat that sits as its code twin does: woken as its brain's unit would be, by what wakes a code unit of
        // its post, no office hours of its own (docs/design/foundations.md section 4).
        let brain = pp["mock"]["brain"]
            .as_str()
            .filter(|_| self.opts.mock_seats && pp["mock"]["twin"].as_bool() == Some(true))
            .and_then(oikos_actors::registry::find);
        if let Some(b) = brain {
            let ctx = Ctx {
                participant: code_twin.clone().unwrap_or_else(|| pid.to_string()),
                performer: if p.kind == "system" { Performer::System } else { Performer::Person },
                entity: entity.clone(),
                position: office.clone(),
                params: pp["mock"]["params"].as_object().cloned().unwrap_or_default(),
                world: self.world.clone(),
            };
            cadence = ceil_to(b.cadence(&ctx), self.tick);
            first = wake_at.unwrap_or_else(|| ceil_to(b.first_wake(&ctx), self.tick));
            entry["hears"] = json!(true);
            if let Some(ct) = &code_twin {
                entry["body"] = json!(ct);
            }
        }
        entry["cadence"] = json!(cadence);
        entry["next_wake"] = json!(first);
        let u = Unit {
            key: pid.into(),
            participant: pid.into(),
            capacity: None,
            entity,
            kind: "llm.participant",
            actor: None,
            ctx: None,
            draws: Draws::new(pid, ""),
            view: View::default(),
            looks: None,
            answers: vec![],
            woke_for: "start".into(),
            since: 0,
            failures: 0,
            diverged: BTreeMap::new(),
        };
        (u, entry)
    }

    /// A code unit for one capacity of a participant, if there is a kind to run it (run.ts `codeUnit`).
    fn code_unit(&mut self, pid: &str, p: &Part, cap: &str, wake_at: Option<i64>) -> Result<Option<(Unit, Value)>, String> {
        let (impl_, params, entity) = if cap == "self" {
            (
                p.controller["impl"].as_str().or(p.controller["code"].as_str()).map(String::from),
                p.controller["params"].clone(),
                p.person.clone().unwrap_or_default(),
            )
        } else {
            let x = self.positions.get(cap).ok_or_else(|| format!("{pid} holds {cap}, which is not a position"))?;
            if p.kind == "system" {
                (
                    p.controller["impl"].as_str().or(p.controller["code"].as_str()).map(String::from),
                    p.controller["params"].clone(),
                    x.entity.clone(),
                )
            } else {
                // A person does the job by the position's procedures, in their own way.
                let mut params = x.role_module["params"].as_object().cloned().unwrap_or_default();
                for (k, v) in p.traits.as_object().into_iter().flatten() {
                    params.insert(k.clone(), v.clone());
                }
                (x.role_module["code"].as_str().map(String::from), Value::Object(params), x.entity.clone())
            }
        };
        let Some(name) = impl_.filter(|n| n != "test") else { return Ok(None) };
        let kind = match oikos_actors::registry::find(&name) {
            Some(k) => k,
            None => match &self.opts.stand_in {
                Some(s) => oikos_actors::registry::find(s).ok_or_else(|| format!("no kind {s} to stand in"))?,
                None => return Err(format!("participant {pid}: no actor kind \"{name}\" in the engine (docs/port-guide.md)")),
            },
        };
        self.used.insert(kind.name().into(), kind.version().into());
        let ctx = Ctx {
            participant: pid.into(),
            performer: if p.kind == "system" { Performer::System } else { Performer::Person },
            entity: entity.clone(),
            position: (cap != "self").then(|| cap.to_string()),
            params: params.as_object().cloned().unwrap_or_default(),
            world: self.world.clone(),
        };
        let actor = kind
            .create(&ctx)
            .map_err(|e| format!("participant {pid}{}: {e}", if cap == "self" { String::new() } else { format!(" (as {cap})") }))?;
        let key = format!("{pid}|{cap}");
        let cadence = ceil_to(kind.cadence(&ctx), self.tick);
        let first = wake_at.unwrap_or_else(|| ceil_to(kind.first_wake(&ctx), self.tick));
        let mut entry = json!({ "key": key, "participant": pid, "capacity": cap, "cadence": cadence, "next_wake": first });
        if kind.deaf() {
            entry["deaf"] = json!(true);
        }
        let u = Unit {
            key,
            participant: pid.into(),
            capacity: Some(cap.into()),
            entity,
            kind: kind.name(),
            actor: Some(actor),
            ctx: Some(ctx),
            draws: Draws::new(pid, cap),
            view: View::default(),
            looks: None,
            answers: vec![],
            woke_for: "start".into(),
            since: 0,
            failures: 0,
            diverged: BTreeMap::new(),
        };
        Ok(Some((u, entry)))
    }

    /// What is next: seats to wake, or the end. Code actors' moments are run inside.
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> Result<Due, String> {
        self.pause = None;
        self.go()
    }

    /// `next`, but stopping before anything after `by` is begun: `None` when the next thing to happen is after it (the
    /// clock moved no further than the last moment run, nothing begun). The run then is exactly where it would be
    /// between those two moments, to snapshot or fork; `next` (or `next_by` again) carries on as if it had never
    /// stopped.
    pub fn next_by(&mut self, by: i64) -> Result<Option<Due>, String> {
        self.pause = Some(by);
        let r = self.go();
        let paused = self.pause.take().is_none();
        match r {
            Ok(_) if paused => Ok(None),
            other => other.map(Some),
        }
    }

    fn go(&mut self) -> Result<Due, String> {
        loop {
            if let Some(r) = self.round.take() {
                let waiting: Vec<&String> = r.decided.iter().filter(|(_, d)| matches!(d, Decided::Seat(None)) && !self.opts.host_seats).map(|(k, _)| k).collect();
                if !waiting.is_empty() {
                    let msg =
                        format!("seats awake without an action: {}", waiting.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "));
                    self.round = Some(r);
                    return Err(msg);
                }
                let awake = self.carry_out(r)?;
                if !awake.is_empty() {
                    if let Some(due) = self.start_round(awake)? {
                        return Ok(due);
                    }
                }
                continue;
            }
            let t = self.run.kernel().t();
            match self.sched.next(t, self.until)? {
                Next::End if self.pause.is_some_and(|p| self.until > p) => {
                    self.pause = None;
                    return Ok(Due::End);
                }
                Next::End => {
                    // (The world is taken to the run's end, or `until`, even when nobody wakes before it: run.ts.)
                    if self.until > t {
                        self.command(&Command::Advance { to: self.until })?;
                    }
                    return Ok(Due::End);
                }
                Next::Advance { to } if self.pause.is_some_and(|p| to > p) => {
                    self.pause = None; // (paused: `next_by` reads this)
                    return Ok(Due::End);
                }
                Next::Advance { to } => loop {
                    self.command(&Command::AdvanceToNews { to })?;
                    let now = self.run.kernel().t();
                    if now >= to || self.sched.due_by(now) {
                        break;
                    }
                },
                Next::Cohort(c) => {
                    self.run.plan(self.sched.looks(&c));
                    let mut awake = vec![];
                    for (key, why, since) in c {
                        if let Some(u) = self.units.get_mut(&key) {
                            u.woke_for = why.to_string();
                            u.since = since;
                            awake.push((key, 0));
                        }
                    }
                    if let Some(due) = self.start_round(awake)? {
                        return Ok(due);
                    }
                }
            }
        }
    }

    /// A seat's action for this round (its host's: a confirmed draft is an `Act` with its provenance).
    pub fn submit(&mut self, key: &str, action: Action) -> Result<(), String> {
        let r = self.round.as_mut().ok_or("no round is waiting on seats")?;
        match r.decided.get_mut(key) {
            Some(d @ Decided::Seat(None)) => {
                *d = Decided::Seat(Some(action));
                Ok(())
            }
            _ => Err(format!("{key} is not a seat awake in this round, or has answered")),
        }
    }

    /// The questions code actors have put to models since last asked (asked in one wake, answered by the next).
    pub fn questions(&mut self) -> Vec<(String, Question)> {
        std::mem::take(&mut self.questions)
    }
    /// Answers for a unit, given to it with its next observation.
    pub fn answer(&mut self, key: &str, answers: Vec<Answer>) {
        if let Some(u) = self.units.get_mut(key) {
            u.answers.extend(answers);
        }
    }

    /// One round: those awake look, code actors decide at once, seats are handed to the host.
    fn start_round(&mut self, awake: Vec<(String, u32)>) -> Result<Option<Due>, String> {
        let t = self.run.kernel().t();
        if self.rounds_at.0 != t {
            self.rounds_at = (t, 0);
        }
        self.rounds_at.1 += 1;
        if self.rounds_at.1 > MAX_ROUNDS_PER_MOMENT {
            return Err(format!(
                "participants kept waking each other at t={t} ({MAX_ROUNDS_PER_MOMENT} rounds in one moment): {} among them",
                awake[0].0
            ));
        }
        // Look, in key order.
        // (Each code unit with what it was shown: its view takes the observation in as it decides, on its thread.)
        let mut stepping: Vec<(Unit, Option<crate::observe::Observation>, Option<String>)> = vec![];
        let mut seats = vec![];
        let mut kept_awake = vec![];
        for (key, n) in awake {
            let Some(mut u) = self.units.remove(&key) else { continue };
            if u.seat() && self.opts.host_seats {
                // (The host looks for it, through the participant API, as it decides and acts for it.)
                seats.push(SeatWake { key: key.clone(), participant: u.participant.clone(), t, woke_for: u.woke_for.clone(), since: u.since, observation: Value::Null });
                self.units.insert(key.clone(), u);
                kept_awake.push((key, n));
                continue;
            }
            let only = u.capacity.clone();
            let looks = u.looks.take().map(|ls| match &only {
                Some(c) if c != "self" => ls
                    .into_iter()
                    .map(|mut l| {
                        l.channel = format!("{c}/{}", l.channel);
                        l
                    })
                    .collect(),
                _ => ls,
            });
            let mut resp = match looks {
                Some(looks) => {
                    match self.command(&Command::Look { participant: u.participant.clone(), only: only.clone(), looks: looks.clone() }) {
                        Ok(r) => Some(r),
                        Err(_) => {
                            self.note(&u.participant, json!({ "look_rejected": serde_json::to_string(&looks).unwrap_or_default().chars().take(4000).collect::<String>() }))?;
                            None
                        }
                    }
                }
                None => None,
            };
            if resp.is_none() {
                resp = self.command(&Command::Observe { participant: u.participant.clone(), only: only.clone() }).ok();
            }
            // (Its capacity may have gone with what it saw: a unit no longer there does not decide.)
            let Some(obs) = resp.and_then(|r| r.observation) else {
                if self.units.contains_key(&key) || !self.parts.get(&u.participant).is_some_and(|p| !p.ended) {
                    continue;
                }
                continue;
            };
            if u.seat() {
                let mut v = serde_json::to_value(&obs).map_err(|e| e.to_string())?;
                v["entity"] = json!(u.entity);
                v["woke_for"] = json!(u.woke_for);
                v["since"] = json!(u.since);
                seats.push(SeatWake {
                    key: key.clone(),
                    participant: u.participant.clone(),
                    t,
                    woke_for: u.woke_for.clone(),
                    since: u.since,
                    observation: v,
                });
                self.units.insert(key.clone(), u);
            } else {
                if self.opts.record_observations || self.opts.record_observations_of.contains(&u.participant) {
                    // (Its channels as a list, each with its path, as run.ts recorded them: a position's channel paths
                    // have a "/", which the log's free-form data does not allow in a key.)
                    let mut v = serde_json::to_value(&obs).map_err(|e| e.to_string())?;
                    // (Whom it was shown to act for, as a seat's observation says: what the checker holds it to.)
                    v["entity"] = json!(u.entity);
                    if let Some(chans) = v.get("channels").and_then(Value::as_object).cloned() {
                        v["channels"] = Value::Array(chans.into_iter().map(|(path, mut c)| {
                            c["path"] = json!(path);
                            c
                        }).collect());
                    }
                    let mut data = json!({ "t": t, "observation": v });
                    // (The capacity it was shown in: its unit's post, or the one post a system holds, which a system's
                    // unit of no capacity sees as run.ts's did.)
                    let held = self.held(&u.participant);
                    let as_ = only.clone().filter(|c| c != "self").or_else(|| (held.len() == 1 && self.parts.get(&u.participant).is_some_and(|p| p.kind == "system")).then(|| held[0].clone()));
                    if let Some(c) = as_ {
                        data["as"] = json!(c);
                    }
                    self.annotate(json!({ "annotation": "observation", "subject": u.participant, "data": data }))?;
                }
                stepping.push((u, Some(obs), only));
            }
            kept_awake.push((key, n));
        }
        // Decide, all at once.
        let seed = self.seed;
        let results = each_mut(&mut stepping, self.opts.threads, self.opts.share_at, |(u, obs, only)| {
            let obs = obs.take().expect("each unit is stepped once");
            let pic = u.view.apply(obs, only.as_deref(), &u.entity, &u.woke_for, u.since);
            let pic = &pic;
            let answers = std::mem::take(&mut u.answers);
            let ctx = u.ctx.as_ref().expect("a code unit has its context");
            let actor = u.actor.as_mut().expect("a code unit has its actor");
            let mut cx = Cx::new(pic.t, ctx, &mut u.draws, seed, answers);
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| actor.step(pic, &mut cx))) {
                Ok(a) => Ok((a, cx.into_kept())),
                Err(p) => Err(p
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_else(|| "it panicked".into())),
            }
        });
        self.steps += results.len() as u64;
        let mut decided = BTreeMap::new();
        for ((u, _, _), r) in stepping.into_iter().zip(results) {
            decided.insert(u.key.clone(), Decided::Code(r));
            self.units.insert(u.key.clone(), u);
        }
        for s in &seats {
            decided.insert(s.key.clone(), Decided::Seat(None));
        }
        self.round = Some(Round { awake: kept_awake, decided, cursor: 0, next: vec![] });
        Ok((!seats.is_empty()).then_some(Due::Seats(seats)))
    }

    /// What the round decided, carried out in key order; those whose wakes go on.
    fn carry_out(&mut self, mut r: Round) -> Result<Vec<(String, u32)>, String> {
        self.carry_some(&mut r, None)?;
        Ok(r.next)
    }

    /// The round carried out in key order from where it stands, up to (not including) the unit `stop`, or to its end.
    fn carry_some(&mut self, r: &mut Round, stop: Option<&str>) -> Result<(), String> {
        while r.cursor < r.awake.len() {
            let (key, n) = r.awake[r.cursor].clone();
            if stop == Some(key.as_str()) {
                return Ok(());
            }
            r.cursor += 1;
            let Some(d) = r.decided.remove(&key) else { continue };
            if !self.units.contains_key(&key) {
                continue; // it ended this round
            }
            let action = match d {
                // (A host's seat carried itself out in its place, and said when its wake was done.)
                Decided::Seat(None) if self.opts.host_seats => continue,
                Decided::Seat(a) => a.expect("checked: every seat answered"),
                Decided::Code(Err(e)) => {
                    let u = self.units.get_mut(&key).expect("checked");
                    u.failures += 1;
                    let (pid, in_a_row) = (u.participant.clone(), u.failures);
                    self.note(&pid, json!({ "participant_error": { "unit": key, "error": e.chars().take(2000).collect::<String>(), "in_a_row": in_a_row } }))?;
                    if in_a_row >= MAX_FAILURES_IN_A_ROW {
                        self.retire(&key)?;
                    } else {
                        let t = self.run.kernel().t();
                        self.sched.finished(&key, None, t);
                    }
                    continue;
                }
                Decided::Code(Ok((action, kept))) => {
                    self.units.get_mut(&key).expect("checked").failures = 0;
                    self.keep(&key, kept)?;
                    action
                }
            };
            let (goes_on, acted, until) = self.apply(&key, action)?;
            if !self.units.contains_key(&key) {
                continue;
            }
            if goes_on && !acted {
                r.next.push((key, n + 1));
            } else {
                let t = self.run.kernel().t();
                self.sched.finished(&key, until, t);
            }
        }
        Ok(())
    }

    /// What a step left beside its action: its decisions and outcomes (annotations, unless the log is lean), a change
    /// to its own record (the kernel holds it), and its questions (queued for the host).
    fn keep(&mut self, key: &str, kept: Kept) -> Result<(), String> {
        let u = &self.units[key];
        let (pid, cap) = (u.participant.clone(), u.capacity.clone());
        if self.opts.record_decisions && !self.lean {
            for d in kept.decisions {
                self.annotate(json!({ "annotation": "decision", "subject": pid, "data": d }))?;
            }
            if !kept.outcomes.is_empty() {
                self.annotate(json!({ "annotation": "outcome", "subject": pid, "data": { "outcomes": kept.outcomes } }))?;
            }
        }
        if let Some(change) = kept.record {
            // (run.ts `recordChangeOf`: a person's own unit keeps its record; an organisation's, the unit of the post
            // that keeps it, running the kind that post names.)
            let set = change["set"].clone();
            if set.as_object().is_some_and(|s| !s.is_empty()) {
                let entity = match cap.as_deref() {
                    Some("self") => Some(None),
                    Some(post) => self
                        .positions
                        .get(post)
                        .filter(|x| {
                            x.keeps_record
                                && x.holder.as_deref() == Some(&pid)
                                && x.role_module["code"].as_str() == Some(self.units[key].kind)
                        })
                        .map(|x| Some(x.entity.clone())),
                    None => None,
                };
                if let Some(entity) = entity {
                    let mut cmd = json!({ "command": "entity_record", "participant": pid, "set": set });
                    if let Some(e) = entity {
                        cmd["entity"] = json!(e);
                    }
                    if change["because"].as_array().is_some_and(|b| !b.is_empty()) {
                        cmd["because"] = change["because"].clone();
                    }
                    let cmd: Command = serde_json::from_value(cmd).map_err(|e| e.to_string())?;
                    let _ = self.command(&cmd);
                }
            }
        }
        for q in kept.questions {
            self.questions.push((key.to_string(), q));
        }
        Ok(())
    }

    /// One action carried out: whether the wake goes on, whether an act was begun, and until when it waits.
    fn apply(&mut self, key: &str, action: Action) -> Result<(bool, bool, Option<i64>), String> {
        let u = &self.units[key];
        let (pid, seat) = (u.participant.clone(), u.seat());
        // (run.ts `capacityOf`: a code unit acts in its capacity; a seat of a system, in the one post it holds. A seat
        // holding several posts says which in its action: the host's, with the participant API's `as` (agent F).)
        let as_ = match u.capacity.clone() {
            Some(c) => Some(c).filter(|c| c != "self"),
            None => {
                let held = self.held(&pid);
                (held.len() == 1 && self.parts.get(&pid).is_some_and(|p| p.kind == "system")).then(|| held[0].clone())
            }
        };
        match action {
            Action::Wait { until } => {
                if self.opts.audit {
                    self.audit(key)?;
                }
                Ok((false, false, until))
            }
            Action::Look { looks } => {
                self.units.get_mut(key).expect("checked").looks = Some(looks);
                Ok((true, false, None))
            }
            Action::OptOut { statement } => {
                let _ = self.command(&Command::OptOut { participant: pid.clone(), statement: statement.unwrap_or_default() });
                if let Some(p) = self.parts.get_mut(&pid) {
                    p.ended = true;
                }
                self.sync_units(&pid, None)?;
                Ok((false, false, None))
            }
            Action::Message { to, text, re } => {
                let mut block = json!({ "block": "message", "to": to, "text": text });
                if let Some(re) = re {
                    block["re"] = json!(re);
                }
                let acted = self.begin(key, &pid, as_.as_deref(), vec![block], vec![], json!({ "via": "direct" }), None)?;
                Ok((true, acted, None))
            }
            Action::Act { blocks, reasoning, by, provenance } => {
                let blocks = blocks.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                let prov = match provenance {
                    Provenance::Direct => json!({ "via": "direct" }),
                    Provenance::Given(v) => v,
                };
                let acted = self.begin(key, &pid, as_.as_deref(), blocks, by, prov, reasoning.filter(|_| seat || !self.lean))?;
                Ok((true, acted, None))
            }
            Action::Call { program, reasoning } => {
                let text = oikos_resolver::calls::program_text(&program);
                let kkey = if seat { pid.clone() } else { key.to_string() };
                let empty = oikos_resolver::Knowledge::new(self.currency.clone()).with_dated(self.dated.clone());
                let k = self.knowledge.get(&kkey).unwrap_or(&empty);
                let types = &self.types;
                let type_of = |t: &str| types.get(t).cloned();
                match oikos_resolver::resolve(&program, k, &type_of, as_.as_deref()) {
                    oikos_resolver::Resolution::Blocks(blocks) => {
                        let prov = json!({ "via": "call", "call": text, "resolver": { "id": "resolver", "version": oikos_resolver::RESOLVER_VERSION } });
                        let acted =
                            self.begin(key, &pid, as_.as_deref(), blocks, vec![], prov, reasoning.filter(|_| seat || !self.lean))?;
                        Ok((true, acted, None))
                    }
                    oikos_resolver::Resolution::Questions { questions, invalid } => {
                        let mut data = json!({ "call_unresolved": text, "questions": questions });
                        if !invalid.is_empty() {
                            data["invalid"] = json!(invalid);
                        }
                        self.note(&pid, data)?;
                        Ok((true, false, None))
                    }
                }
            }
        }
    }

    /// An act begun (run.ts `begin`): after its thinking, it takes its actor the act's time; whether it began.
    #[allow(clippy::too_many_arguments)]
    fn begin(
        &mut self,
        key: &str,
        pid: &str,
        as_: Option<&str>,
        blocks: Vec<Value>,
        by: Vec<String>,
        provenance: Value,
        reasoning: Option<String>,
    ) -> Result<bool, String> {
        let mut cmd = json!({ "command": "act", "participant": pid, "blocks": blocks, "provenance": provenance });
        if let Some(a) = as_ {
            cmd["as"] = json!(a);
        }
        if !by.is_empty() {
            cmd["by"] = json!(by);
        }
        if let Some(r) = reasoning {
            cmd["reasoning"] = json!(r);
        }
        if let Some(th) = self.thinking.filter(|s| *s > 0 && !self.units[key].seat()) {
            cmd["thinking"] = json!(th);
        }
        let parsed: Result<Command, _> = serde_json::from_value(cmd.clone());
        let resp = match parsed.map_err(|e| e.to_string()).and_then(|c| self.command(&c)) {
            Ok(r) => r,
            Err(e) => {
                let rejected: String = serde_json::to_string(&cmd["blocks"]).unwrap_or_default().chars().take(4000).collect();
                self.note(pid, json!({ "rejected_action": rejected, "why": e.chars().take(500).collect::<String>() }))?;
                return Ok(false);
            }
        };
        for e in &resp.events {
            if let crate::events::EventBody::ActionStarted { action, .. } = &e.body {
                if let Some(a) = self.units.get_mut(key).and_then(|u| u.actor.as_mut()) {
                    a.sent(action);
                }
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// A unit whose decisions keep failing stops acting (D59).
    fn retire(&mut self, key: &str) -> Result<(), String> {
        let pid = self.units[key].participant.clone();
        self.note(&pid, json!({ "participant_retired": { "unit": key, "after_failures": MAX_FAILURES_IN_A_ROW } }))?;
        if let Some(p) = self.parts.get_mut(&pid) {
            p.ended = true;
        }
        self.sync_units(&pid, None)
    }

    /// Truth audit (orchestrator/src/truth.ts): each belief against the terms' readings; a divergence that stands from
    /// one audit to the next is annotated.
    fn audit(&mut self, key: &str) -> Result<(), String> {
        let Some(beliefs) = self.units[key].actor.as_ref().map(|a| a.beliefs()) else { return Ok(()) };
        let st = self.run.kernel().state();
        let read = |id: &str| -> Option<(String, Vec<String>, bool)> {
            let stored = st.records.get(id)?;
            let crate::blocks::RecordBody::Agreement { terms } = &stored.record.body else { return None };
            let status = st
                .reading(id)
                .map(|r| serde_json::to_value(&r).ok().and_then(|v| v["status"].as_str().map(String::from)).unwrap_or_default())
                .unwrap_or_default();
            Some((terms.template.clone().unwrap_or_default(), terms.parties.clone(), status == "in_force" || status == "ending"))
        };
        let of_party = |p: &str| -> Vec<(String, String, Vec<String>, bool)> {
            st.agreements_of
                .get(p)
                .into_iter()
                .flat_map(|v| v.iter())
                .filter_map(|id| read(id).map(|(t, ps, f)| (id.clone(), t, ps, f)))
                .collect()
        };
        let mut found_now = vec![];
        for b in &beliefs {
            let (expected, found) = match b {
                Belief::Agreement { agreement, in_force } => (json!(in_force), json!(read(agreement).is_some_and(|x| x.2))),
                Belief::Between { template, parties, in_force } => (
                    json!(in_force),
                    json!(of_party(&parties[0]).iter().any(|(_, t, ps, f)| t == template && ps.contains(&parties[1]) && *f)),
                ),
                Belief::Held { party, template, agreements } => {
                    let mut f: Vec<String> =
                        of_party(party).into_iter().filter(|(_, t, _, f)| t == template && *f).map(|(id, ..)| id).collect();
                    f.sort();
                    let mut e = agreements.clone();
                    e.sort();
                    (json!(e), json!(f))
                }
            };
            if expected != found {
                found_now.push((b.clone(), expected, found));
            }
        }
        let t = self.run.kernel().t();
        let u = self.units.get_mut(key).expect("checked");
        let was = std::mem::take(&mut u.diverged);
        let pid = u.participant.clone();
        let mut notes = vec![];
        for (b, expected, found) in found_now {
            let k = match &b {
                Belief::Held { party, template, .. } => json!([party, template]).to_string(),
                other => serde_json::to_string(other).unwrap_or_default(),
            };
            let since = was.get(&k).copied();
            u.diverged.insert(k, since.unwrap_or(t));
            if let Some(since) = since {
                notes.push(json!({ "annotation": "audit", "subject": pid, "data": { "t": t, "unit": key, "belief": b, "expected": expected, "found": found, "since": since } }));
            }
        }
        for n in notes {
            self.annotate(n)?;
        }
        Ok(())
    }

    /// The run's end: logged, its final state hash.
    pub fn finish(&mut self) -> Result<String, String> {
        let completed = self.until == self.run_end;
        let detail = format!("stopped at {}", self.until);
        self.run
            .finish(if completed { "completed" } else { "aborted" }, (!completed).then_some(detail.as_str()))
            .map(|(_, h)| h)
            .map_err(|e| e.to_string())
    }

    /// Every unit's memory (snapshot and fork: docs/port-guide.md, "Snapshots"): each code actor's own save, its view and
    /// its draws. The world's state is the kernel's; the whole snapshot format is agent F's (see the guide).
    pub fn save_actors(&self) -> Result<Value, String> {
        let mut out = Map::new();
        for (k, u) in &self.units {
            if let Some(a) = &u.actor {
                out.insert(k.clone(), json!({ "kind": u.kind, "actor": a.save()?, "view": serde_json::to_value(&u.view).map_err(|e| e.to_string())?, "draws": serde_json::to_value(&u.draws).map_err(|e| e.to_string())? }));
            }
        }
        Ok(Value::Object(out))
    }
}

/// Runs a world with no seats to its end (or `until`), and returns its final state hash. For the gate, the port's
/// own tests and `oikos-kernel world`.
pub fn run_code_world<W: Write>(config: Value, run_id: &str, out: W, opts: EngineOptions) -> Result<(String, Engine<W>), String> {
    let mut e = Engine::start(config, run_id, out, None, opts)?;
    loop {
        match e.next()? {
            Due::End => break,
            Due::Seats(seats) => {
                // (A world given no host for its seats: each seat waits, as a seat whose model did not answer.)
                for s in seats {
                    e.submit(&s.key, Action::wait())?;
                }
            }
        }
    }
    let hash = e.finish()?;
    Ok((hash, e))
}
