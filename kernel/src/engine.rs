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
use oikos_actors::sight::{Action, LookRequest, Picture, Provenance, View};
use oikos_actors::{Actor, Answer, Belief, Ctx, Cx, Draws, Kept, Question, WorldInfo, DAY};
use oikos_rules::slip::Performer;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::sync::Arc;

pub const ENGINE_VERSION: &str = "0.1.0";

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
        }
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
#[derive(Debug, Clone)]
struct Part {
    kind: String,
    person: Option<String>,
    controller: Value,
    traits: Value,
    ended: bool,
}

#[derive(Debug, Clone)]
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
}

pub struct Engine<W: Write> {
    run: Run<W>,
    sched: Scheduler,
    knowledge: BTreeMap<String, oikos_resolver::Knowledge>,
    registers: oikos_resolver::knowledge::Registers,
    types: BTreeMap<String, Value>,
    currency: Option<oikos_resolver::calls::Currency>,
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
    /// For whoever measures: how many steps the actors took (never logged).
    pub steps: u64,
}

fn ceil_to(t: i64, tick: i64) -> i64 {
    if tick <= 0 {
        return t;
    }
    t.div_euclid(tick) * tick + if t.rem_euclid(tick) == 0 { 0 } else { tick }
}

/// `f` of each item, in the items' order, on up to `threads` threads: contiguous chunks, each thread its own, each
/// result in its item's place. The same results however the work falls out.
pub fn each_mut<T: Send, R: Send>(items: &mut [T], threads: usize, share_at: usize, f: impl Fn(&mut T) -> R + Sync) -> Vec<R> {
    let threads = threads.min(items.len()).max(1);
    if threads < 2 || items.len() < share_at.max(1) {
        return items.iter_mut().map(f).collect();
    }
    let size = items.len().div_ceil(threads);
    let f = &f;
    std::thread::scope(|scope| {
        let handles: Vec<_> =
            items.chunks_mut(size).map(|chunk| scope.spawn(move || chunk.iter_mut().map(f).collect::<Vec<R>>())).collect();
        handles.into_iter().flat_map(|h| h.join().expect("an actor's thread does not panic: steps are caught")).collect()
    })
}

impl<W: Write> Engine<W> {
    /// A run of this world, its log written to `out`.
    pub fn start(config: Value, run_id: &str, out: W, anchors: Option<Box<dyn Write>>, opts: EngineOptions) -> Result<Self, String> {
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
        });
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
        let templates =
            config["templates"].as_array().into_iter().flatten().filter_map(|t| Some((t["id"].as_str()?.to_string(), t.clone()))).collect();
        let run = Run::start(config, run_id, out, anchors).map_err(|e| e.to_string())?;
        let until = opts.until.map_or(run_end, |u| u.min(run_end));
        let mut e = Engine {
            sched: Scheduler::new(tick),
            run,
            knowledge: BTreeMap::new(),
            registers: Default::default(),
            types,
            currency,
            parts,
            positions,
            templates,
            units: BTreeMap::new(),
            world,
            seed,
            opts,
            tick,
            until,
            run_end,
            round: None,
            rounds_at: (-1, 0),
            questions: vec![],
            lean,
            thinking,
            used: BTreeMap::new(),
            steps: 0,
        };
        for pid in e.parts.keys().cloned().collect::<Vec<_>>() {
            e.sync_units(&pid, None)?;
        }
        let modules: Map<String, Value> = e.used.iter().map(|(k, v)| (k.clone(), json!({ "version": v }))).collect();
        e.annotate(json!({ "annotation": "orchestrator", "subject": "orchestrator", "data": { "version": format!("engine {ENGINE_VERSION}"), "modules": modules, "thinking_time": thinking_time } }))?;
        Ok(e)
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
        let mut resp = self.run.command(cmd).map_err(|e| e.to_string())?;
        if let Some(obs) = resp.observation.as_mut() {
            let o = self.run.observed(obs).map_err(|e| e.to_string())?;
            if let Command::Observe { participant, only } | Command::Look { participant, only, .. } = cmd {
                let key = only.as_ref().map_or_else(|| participant.clone(), |o| format!("{participant}|{o}"));
                let cur = self.currency.clone();
                self.knowledge.entry(key).or_insert_with(|| oikos_resolver::Knowledge::new(cur)).absorb_seen(
                    &crate::kernel::seen(obs),
                    &o.shown,
                    &mut self.registers,
                );
            }
        }
        let t = self.run.kernel().t();
        self.sched.note_events(Some(self.run.kernel().state()), &resp.events, t);
        self.note_cast(&resp.events)?;
        Ok(resp)
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
        let cadence = ceil_to(p.controller["params"]["cadence_days"].as_i64().unwrap_or(7) * DAY, self.tick);
        let held = self.held(pid);
        let entity = if held.len() == 1 { self.positions[&held[0]].entity.clone() } else { p.person.clone().unwrap_or_default() };
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
        (u, json!({ "key": pid, "participant": pid, "llm": true, "cadence": cadence, "next_wake": wake_at.unwrap_or(0) }))
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
        loop {
            if let Some(r) = self.round.take() {
                let waiting: Vec<&String> = r.decided.iter().filter(|(_, d)| matches!(d, Decided::Seat(None))).map(|(k, _)| k).collect();
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
                Next::End => {
                    // (The world is taken to the run's end, or `until`, even when nobody wakes before it: run.ts.)
                    if self.until > t {
                        self.command(&Command::Advance { to: self.until })?;
                    }
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
        let mut stepping: Vec<(Unit, Picture)> = vec![];
        let mut seats = vec![];
        let mut kept_awake = vec![];
        for (key, n) in awake {
            let Some(mut u) = self.units.remove(&key) else { continue };
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
                let pic = u.view.apply(obs, only.as_deref(), &u.entity.clone(), &u.woke_for.clone(), u.since);
                stepping.push((u, pic));
            }
            kept_awake.push((key, n));
        }
        // Decide, all at once.
        let seed = self.seed;
        let results = each_mut(&mut stepping, self.opts.threads, self.opts.share_at, |(u, pic)| {
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
        for ((u, _), r) in stepping.into_iter().zip(results) {
            decided.insert(u.key.clone(), Decided::Code(r));
            self.units.insert(u.key.clone(), u);
        }
        for s in &seats {
            decided.insert(s.key.clone(), Decided::Seat(None));
        }
        self.round = Some(Round { awake: kept_awake, decided });
        Ok((!seats.is_empty()).then_some(Due::Seats(seats)))
    }

    /// What the round decided, carried out in key order; those whose wakes go on.
    fn carry_out(&mut self, mut r: Round) -> Result<Vec<(String, u32)>, String> {
        let mut next = vec![];
        for (key, n) in std::mem::take(&mut r.awake) {
            let Some(d) = r.decided.remove(&key) else { continue };
            if !self.units.contains_key(&key) {
                continue; // it ended this round
            }
            let action = match d {
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
                next.push((key, n + 1));
            } else {
                let t = self.run.kernel().t();
                self.sched.finished(&key, until, t);
            }
        }
        Ok(next)
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
                let empty = oikos_resolver::Knowledge::new(self.currency.clone());
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
