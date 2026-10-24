//! The engine for a host in another language (lane F; docs/design/rust-port.md 2.3): JSON in, JSON out, the same
//! calls the N-API module serves to the TypeScript host (kernel/crates/napi) and that a socket would serve to a seat in
//! any language. The host runs the seats (models, the translator, debriefs: TypeScript); the engine runs the world
//! and every built-in actor.
//!
//! - `start(config, options)`; `next()` gives the seats awake now, each with what it was shown (the contract's
//!   Observation), or the end; `submit(key, action)` for each; `next()` again carries the round out. Several hosts
//!   (forks) may have seats out at once: nothing waits on a model inside the engine.
//! - `annotate(annotation)`: the host's own records into the run's log (each seat's usage and cost, transcripts,
//!   debriefs): validated against the contract, as the stdio protocol's.
//! - `questions()` / `answer(key, answers)`: code actors' questions to models, asked in one wake, answered by the next.
//! - `snapshot()` (bytes), `resume(bytes, options)`, `fork(options)`; with a binary log, snapshots go into the log
//!   (`snapshot_every` days, or `snapshot_to_log()`), and a fork's log names its parent.
//! - `events(max)`: the live stream of log entries (stream.rs), if asked for.
//! - `Detached`: one actor kind run on observations it is handed (a mock seat sitting as its code twin, `mock.twin`):
//!   the same code as the engine runs for that post, so the twin is exact.

use crate::blog::{About, BinLog};
use crate::engine::{Due, Engine, EngineOptions, Snapshot};
use crate::log::Kind;
use crate::stream::{Stream, Tee};
use oikos_actors::sight::{Action, View};
use oikos_actors::{Actor, Answer, Ctx, Cx, Draws, Question};
use serde_json::{json, Value};
use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

/// Where a run's log goes.
pub enum Out {
    Jsonl(BufWriter<File>),
    Binary(BinLog<BufWriter<File>>),
    /// Kept in memory (tests; a fork nobody keeps).
    Memory(Vec<u8>),
    Nowhere,
}

impl Write for Out {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        match self {
            Out::Jsonl(w) => w.write(b),
            Out::Binary(w) => w.write(b),
            Out::Memory(v) => v.write(b),
            Out::Nowhere => Ok(b.len()),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        match self {
            Out::Jsonl(w) => w.flush(),
            Out::Binary(w) => w.flush(),
            Out::Memory(_) | Out::Nowhere => Ok(()),
        }
    }
}

/// The options a host gives (all optional): `run_id`, `log` (a path: `.jsonl` is the JSONL log, anything else the
/// binary log; absent: kept in memory), `anchors` (a path), `threads`, `until`, `stand_in`, `record_decisions`,
/// `audit`, `snapshot_every_days` (binary log only), `stream: {cap, kinds}`, `label` (a fork's), `withhold` (acts not
/// carried out: a researcher's intervention, `engine::Withhold`).
#[derive(Debug, Clone, Default)]
struct Options {
    run_id: Option<String>,
    log: Option<PathBuf>,
    anchors: Option<PathBuf>,
    snapshot_every: Option<i64>,
    stream: Option<Stream>,
    label: Option<String>,
    engine: EngineOptions,
}

fn options(v: &Value) -> Result<Options, String> {
    let mut engine = EngineOptions::default();
    if let Some(n) = v["threads"].as_u64() {
        engine.threads = (n as usize).max(1);
    }
    engine.until = v["until"].as_i64();
    engine.stand_in = v["stand_in"].as_str().map(String::from);
    if let Some(b) = v["record_decisions"].as_bool() {
        engine.record_decisions = b;
    }
    engine.audit = v["audit"].as_bool() == Some(true);
    engine.withhold = crate::engine::withholds(&v["withhold"])?;
    if let Some(n) = v["share_at"].as_u64() {
        engine.share_at = n as usize;
    }
    let stream = v.get("stream").filter(|s| s.is_object()).map(|s| {
        let kinds = s["kinds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|k| serde_json::from_value::<Kind>(k.clone()).ok())
            .collect();
        Stream::new(s["cap"].as_u64().unwrap_or(100_000) as usize, kinds)
    });
    Ok(Options {
        run_id: v["run_id"].as_str().map(String::from),
        log: v["log"].as_str().map(PathBuf::from),
        anchors: v["anchors"].as_str().map(PathBuf::from),
        snapshot_every: v["snapshot_every_days"].as_i64().filter(|d| *d > 0).map(|d| d * 86_400),
        stream,
        label: v["label"].as_str().map(String::from),
        engine,
    })
}

fn binary(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()) != Some("jsonl")
}

fn open(o: &Options, run_id: &str, from: Option<(u64, &str, Option<String>)>) -> Result<(Out, Option<Box<dyn Write>>), String> {
    let anchors: Option<Box<dyn Write>> = match &o.anchors {
        Some(p) => Some(Box::new(File::create(p).map_err(|e| format!("{}: {e}", p.display()))?)),
        None => None,
    };
    let out = match &o.log {
        None => Out::Memory(vec![]),
        Some(p) => {
            if let Some(d) = p.parent().filter(|d| !d.as_os_str().is_empty()) {
                std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
            }
            let f = BufWriter::with_capacity(1 << 20, File::create(p).map_err(|e| format!("{}: {e}", p.display()))?);
            if binary(p) {
                let (seq, prev, parent) = from.map_or((0, crate::canon::ZERO_HASH, None), |(s, p, parent)| (s, p, parent));
                let about = About { run_id: run_id.into(), parent, label: o.label.clone() };
                Out::Binary(BinLog::from_entry(f, &about, seq, prev).map_err(|e| e.to_string())?)
            } else {
                if from.is_some() {
                    return Err("a resumed or forked run's log is a binary one (it names its parent); a JSONL log is had by exporting it".into());
                }
                Out::Jsonl(f)
            }
        }
    };
    Ok((out, anchors))
}

pub struct Host {
    e: Engine<Tee<Out>>,
    log: Option<PathBuf>,
    snapshot_every: Option<i64>,
    next_snapshot: Option<i64>,
}

fn wake_json(s: &crate::engine::SeatWake) -> Value {
    json!({ "key": s.key, "participant": s.participant, "t": s.t, "woke_for": s.woke_for, "since": s.since, "observation": s.observation })
}

impl Host {
    pub fn start(config: Value, opts: &Value) -> Result<Host, String> {
        let o = options(opts)?;
        let run_id = o.run_id.clone().unwrap_or_else(|| "run".into());
        let (out, anchors) = open(&o, &run_id, None)?;
        let e = Engine::start(config, &run_id, Tee::new(out, o.stream.clone()), anchors, o.engine.clone())?;
        let mut h = Host { e, log: o.log.clone(), snapshot_every: None, next_snapshot: None };
        h.every(o.snapshot_every);
        Ok(h)
    }

    fn every(&mut self, every: Option<i64>) {
        let binary = self.log.as_deref().is_some_and(binary);
        self.snapshot_every = every.filter(|_| binary);
        self.next_snapshot = self.snapshot_every.map(|d| (self.e.t() / d + 1) * d);
    }

    /// The run taken up again from a snapshot's bytes. With a binary log, the new log names `parent` (relative to
    /// itself) as the log it carries on from.
    pub fn resume(bytes: &[u8], opts: &Value) -> Result<Host, String> {
        let snap = Snapshot::from_bytes(bytes)?;
        Self::from_snapshot(&snap, opts)
    }

    fn from_snapshot(snap: &Snapshot, opts: &Value) -> Result<Host, String> {
        let o = options(opts)?;
        let run_id = snap.head.run_id.clone();
        let parent = opts["parent"].as_str().map(String::from);
        let (out, anchors) = open(&o, &run_id, Some((snap.head.next_seq, &snap.head.prev, parent)))?;
        let e = Engine::resume(snap, Tee::new(out, o.stream.clone()), anchors, o.engine.clone())?;
        let mut h = Host { e, log: o.log.clone(), snapshot_every: None, next_snapshot: None };
        h.every(o.snapshot_every);
        Ok(h)
    }

    /// A fork of this run now (in memory: cheap), with its own log and options. Its binary log names this run's as its
    /// parent, where this one has a log on disk.
    pub fn fork(&mut self, opts: &Value) -> Result<Host, String> {
        let mut opts = opts.clone();
        if opts.get("parent").is_none() {
            if let (Some(mine), Some(theirs)) = (&self.log, opts["log"].as_str()) {
                if let Some(rel) = relative(mine, Path::new(theirs)) {
                    opts["parent"] = json!(rel);
                }
            }
        }
        // (What this run has written so far, on disk: a fork's export reads it.)
        self.e.log_out().flush().map_err(|e| e.to_string())?;
        Self::from_snapshot(&self.e.snapshot()?, &opts)
    }

    /// What this run has written so far, on disk (a snapshot taken for another process to resume from carries on a log
    /// that names this one: the experiment harness, orchestrator/src/experiment.ts).
    pub fn flush(&mut self) -> Result<(), String> {
        self.e.log_out().flush().map_err(|e| e.to_string())
    }

    fn snapshot_due(&mut self) -> Result<(), String> {
        if let (Some(at), Some(every)) = (self.next_snapshot, self.snapshot_every) {
            if self.e.t() <= at {
                self.snapshot_to_log()?;
            }
            self.next_snapshot = Some(at + every);
        }
        Ok(())
    }

    fn due(&mut self, d: Due) -> Value {
        match d {
            Due::Seats(seats) => json!({ "due": "seats", "t": self.e.t(), "seats": seats.iter().map(wake_json).collect::<Vec<_>>() }),
            Due::End => json!({ "due": "end", "t": self.e.t() }),
        }
    }

    /// Seats to wake, or the end (snapshots put in the log on the way, where asked for).
    pub fn next(&mut self) -> Result<Value, String> {
        loop {
            let r = match self.next_snapshot {
                Some(at) => self.e.next_by(at)?,
                None => Some(self.e.next()?),
            };
            match r {
                Some(d) => return Ok(self.due(d)),
                None => self.snapshot_due()?,
            }
        }
    }

    /// `next`, stopping between moments before anything after `by` (`{"due": "paused"}`).
    pub fn next_by(&mut self, by: i64) -> Result<Value, String> {
        loop {
            let limit = self.next_snapshot.map_or(by, |s| s.min(by));
            match self.e.next_by(limit)? {
                Some(d) => return Ok(self.due(d)),
                None if self.next_snapshot.is_some_and(|s| s <= by) => self.snapshot_due()?,
                None => return Ok(json!({ "due": "paused", "t": self.e.t() })),
            }
        }
    }

    pub fn submit(&mut self, key: &str, action: &Value) -> Result<(), String> {
        self.e.submit(key, Action::from_json(action)?)
    }

    /// The host's own record into the log (usage and cost per seat, transcripts, debriefs): checked by the contract.
    pub fn annotate(&mut self, annotation: Value) -> Result<(), String> {
        self.e.annotate_from_host(annotation)
    }

    pub fn questions(&mut self) -> Value {
        Value::Array(self.e.questions().into_iter().map(|(key, q)| json!({ "key": key, "kind": q.kind, "about": q.about, "body": q.body })).collect())
    }

    pub fn answer(&mut self, key: &str, answers: &Value) -> Result<(), String> {
        let a: Vec<Answer> = serde_json::from_value(answers.clone()).map_err(|e| format!("answers: {e}"))?;
        self.e.answer(key, a);
        Ok(())
    }

    pub fn snapshot(&self) -> Result<Vec<u8>, String> {
        self.e.snapshot()?.to_bytes()
    }

    /// A snapshot into the binary log, before its next entry.
    pub fn snapshot_to_log(&mut self) -> Result<(), String> {
        // (Without its config: the log's header holds it once; blog::snapshot_in reads it back with it.)
        let bytes = self.e.snapshot()?.to_bytes_for_log()?;
        let t = self.e.t();
        match self.e.log_out().inner() {
            Out::Binary(b) => b.snapshot(t, &bytes).map_err(|e| e.to_string()),
            _ => Err("snapshots go into a binary log only".into()),
        }
    }

    pub fn events(&self, max: usize) -> Value {
        match self.e.log_ref().stream() {
            Some(s) => {
                let (lines, missed) = s.take(max);
                let lines: Vec<Value> = lines.iter().filter_map(|l| serde_json::from_slice(l).ok()).collect();
                json!({ "entries": lines, "missed": missed })
            }
            None => json!({ "entries": [], "missed": 0, "note": "no stream was asked for (options.stream)" }),
        }
    }

    pub fn t(&self) -> i64 {
        self.e.t()
    }
    pub fn state_hash(&self) -> Result<String, String> {
        self.e.state_hash()
    }

    /// The run's end: logged; its final hash, and for a log kept in memory, the log.
    pub fn finish(&mut self) -> Result<Value, String> {
        let hash = self.e.finish()?;
        self.e.log_out().flush().map_err(|e| e.to_string())?;
        let mut out = json!({ "state_hash": hash, "t": self.e.t(), "steps": self.e.steps });
        if let Some(p) = &self.log {
            out["log"] = json!(p.display().to_string());
        }
        Ok(out)
    }

    /// The log, where it was kept in memory (after `finish`).
    pub fn log_bytes(&mut self) -> Option<Vec<u8>> {
        match self.e.log_out().inner() {
            Out::Memory(v) => Some(std::mem::take(v)),
            _ => None,
        }
    }
}

/// `to` written relative to the directory of `from`'s sibling: the parent's path as the fork's log names it.
fn relative(parent: &Path, fork: &Path) -> Option<String> {
    let fork_dir = fork.parent().unwrap_or(Path::new(""));
    if parent.parent() == Some(fork_dir) || (parent.parent().is_some_and(|p| p.as_os_str().is_empty()) && fork_dir.as_os_str().is_empty()) {
        return parent.file_name().map(|f| f.to_string_lossy().into_owned());
    }
    std::fs::canonicalize(parent).ok().map(|p| p.display().to_string())
}

/// One actor kind, run on observations it is handed (docs/design/rust-port.md 2.3: twins). Given the same context and
/// the same observations as the engine's unit for that post, it decides exactly as that unit would: the same code, the
/// same keyed draws, the same memory.
pub struct Detached {
    kind: &'static dyn oikos_actors::Kind,
    actor: Box<dyn Actor>,
    ctx: Ctx,
    draws: Draws,
    view: View,
    seed: u64,
    capacity: Option<String>,
}

impl Detached {
    /// `{kind, participant, capacity ("self" or a position), entity, system?, params, seed, config, saved?}`: `config` is the
    /// world's (its clock, money, dials, slips and calendar are what the actor may know of the run).
    pub fn new(spec: &Value) -> Result<Detached, String> {
        let s = |k: &str| spec[k].as_str().map(String::from);
        let kind = oikos_actors::registry::find(&s("kind").ok_or("a detached actor names its kind")?).ok_or("no such actor kind")?;
        let capacity = s("capacity").unwrap_or_else(|| "self".into());
        let participant = s("participant").ok_or("a detached actor names its participant")?;
        let ctx = Ctx {
            participant: participant.clone(),
            performer: if spec["system"].as_bool() == Some(true) { oikos_rules::slip::Performer::System } else { oikos_rules::slip::Performer::Person },
            entity: s("entity").unwrap_or_default(),
            position: (capacity != "self").then(|| capacity.clone()),
            params: spec["params"].as_object().cloned().unwrap_or_default(),
            world: std::sync::Arc::new(crate::engine::world_info(&spec["config"])?),
        };
        let seed = spec["seed"].as_u64().or(spec["config"]["seed"].as_u64()).unwrap_or(0);
        // (`saved`: one as `save` left it, taken up again: its memory, its view and its draws, so that a fork's twin goes
        // on as its parent's would.)
        let saved = &spec["saved"];
        if saved.is_object() {
            let actor = oikos_actors::offices::books::restore(kind, &ctx, saved["actor"].clone())?;
            let draws = serde_json::from_value(saved["draws"].clone()).map_err(|e| format!("saved draws: {e}"))?;
            let view = serde_json::from_value(saved["view"].clone()).map_err(|e| format!("saved view: {e}"))?;
            return Ok(Detached { kind, actor, draws, ctx, view, seed, capacity: Some(capacity) });
        }
        let actor = oikos_actors::offices::books::create(kind, &ctx)?;
        Ok(Detached { kind, actor, draws: Draws::new(&participant, &capacity), ctx, view: View::default(), seed, capacity: Some(capacity) })
    }

    /// When the engine's unit of this kind would first wake, and how often after (its `Kind`'s, before the world's tick
    /// rounds them): a seat sitting as its code twin is scheduled by these, not by the TS module's.
    pub fn schedule(&self) -> (i64, i64) {
        (self.kind.first_wake(&self.ctx), self.kind.cadence(&self.ctx))
    }

    /// One step on an observation (the contract's, as JSON: the seat's whole one is fine, its capacity is taken):
    /// `{action, decisions, outcomes, record, questions}`.
    pub fn step(&mut self, observation: &Value, woke_for: &str, since: i64, answers: &Value) -> Result<Value, String> {
        let obs: oikos_actors::sight::Observation = serde_json::from_value(observation.clone()).map_err(|e| format!("observation: {e}"))?;
        let answers: Vec<Answer> = if answers.is_null() { vec![] } else { serde_json::from_value(answers.clone()).map_err(|e| e.to_string())? };
        let pic = self.view.apply(obs, self.capacity.as_deref(), &self.ctx.entity.clone(), woke_for, since);
        let mut cx = Cx::new(pic.t, &self.ctx, &mut self.draws, self.seed, answers);
        let action = self.actor.step(&pic, &mut cx);
        let kept = cx.into_kept();
        let q: Vec<&Question> = kept.questions.iter().collect();
        Ok(json!({ "action": action.to_json(), "decisions": kept.decisions, "outcomes": kept.outcomes, "record": kept.record, "questions": q }))
    }

    /// The act it returned reached the world as this action.
    pub fn sent(&mut self, action: &str) {
        self.actor.sent(action);
    }

    /// All of it (`{actor, view, draws}`): given back as a spec's `saved`, it goes on exactly from here.
    pub fn save(&self) -> Result<Value, String> {
        Ok(json!({ "actor": self.actor.save()?, "view": serde_json::to_value(&self.view).map_err(|e| e.to_string())?, "draws": serde_json::to_value(&self.draws).map_err(|e| e.to_string())? }))
    }
}
