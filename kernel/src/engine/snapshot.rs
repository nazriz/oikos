//! Snapshot and fork (docs/design/rust-port.md 2.3; docs/port-guide.md, lane F): the whole run saved at a moment, and
//! taken up again from there, as the same run (resume) or as another that shares its past (a fork).
//!
//! What is saved is everything a result can depend on, and nothing that is only a cache:
//! - **the world**: the kernel's state (the only writer's), as it is hashed; its derived lookups are made again from it
//!   (`State::rebuild_derived`), its caches start empty;
//! - **the engine**: the schedule (every unit's next wake, why, since when), the cast as the engine knows it, every
//!   unit's view, keyed draws, looks asked for and answers waiting, and every code actor's own memory
//!   (`Actor::save`, `Kind::restore`); what every seat and unit knows for the resolver; the questions put to models and
//!   not yet answered; a round open while seats think (each code actor's decision, each seat's action so far);
//! - **the log's head**: the next entry's seq and the last entry's hash, so the log a resumed run writes carries on the
//!   same chain.
//!
//! A snapshot is taken between moments (`Engine::next_by` stops there) or while a round waits on seats
//! (`Due::Seats`). Taken up again, on any number of threads, the run goes on exactly as it would have: the same acts,
//! the same log entries byte for byte, the same state hash (kernel/tests/snapshot.rs). In memory it is cheap: the
//! state is persistent, so a fork copies almost nothing until it changes. On disk (`to_bytes`) it is the config, the
//! state and the engine's part, compressed.

use super::{Base, Decided, Engine, EngineOptions, Part, Pos, Round, Unit};
use crate::kernel::Kernel;
use crate::run::{KernelIdentity, Run};
use crate::schedule::Scheduler;
use oikos_actors::sight::{Action, LookRequest, View};
use oikos_actors::{Answer, Ctx, Draws, Kept, Question};
use oikos_rules::slip::Performer;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::io::Write;

/// Bumped whenever what a snapshot holds changes shape (old snapshots are then refused, never misread).
pub const SNAPSHOT_FORMAT: u32 = 1;
const MAGIC: &[u8; 8] = b"OIKOSNP1";
/// zstd's level for snapshots: fast, and a third or less of the size of level 19's gain.
const LEVEL: i32 = 3;

/// The whole run at one moment.
pub struct Snapshot {
    pub head: Head,
    /// (As the run keeps it: compressed, in pieces. Whole only in the bytes of a snapshot that carries it.)
    config: crate::config::Canonical,
    kernel: Kernel,
    saved: Saved,
}

/// What a snapshot says of itself (the first part of its bytes: readable without the rest).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Head {
    pub format: u32,
    pub run_id: String,
    pub kernel: KernelIdentity,
    pub t: i64,
    /// The log entry the run's next will be, and the hash of the one before it.
    pub next_seq: u64,
    pub prev: String,
    pub state_hash: String,
    /// Seats awake in an open round (waiting on their actions): their keys. Empty: taken between moments.
    pub seats_waiting: Vec<String>,
    /// Its config is not in it: it is the log's (a snapshot in a binary log, whose header holds the config once).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub config_elsewhere: bool,
}

#[derive(Serialize, Deserialize)]
struct CtxSaved {
    participant: String,
    system: bool,
    entity: String,
    position: Option<String>,
    params: Map<String, Value>,
}

#[derive(Serialize, Deserialize)]
struct UnitSaved {
    key: String,
    participant: String,
    capacity: Option<String>,
    entity: String,
    kind: String,
    /// A code unit's context and its actor's memory (none for a seat).
    ctx: Option<CtxSaved>,
    actor: Option<Value>,
    draws: Draws,
    view: View,
    looks: Option<Vec<LookRequest>>,
    answers: Vec<Answer>,
    woke_for: String,
    since: i64,
    failures: u32,
    diverged: BTreeMap<String, i64>,
}

#[derive(Serialize, Deserialize)]
enum DecidedSaved {
    /// A code actor's action (as the participant API writes it, with its provenance) and what it kept beside it.
    Code(Result<(Value, Kept), String>),
    Seat(Option<Value>),
}

#[derive(Serialize, Deserialize)]
struct RoundSaved {
    awake: Vec<(String, u32)>,
    decided: Vec<(String, DecidedSaved)>,
    #[serde(default)]
    cursor: usize,
    #[serde(default)]
    next: Vec<(String, u32)>,
}

#[derive(Serialize, Deserialize)]
struct Saved {
    sched: Scheduler,
    knowledge: BTreeMap<String, oikos_resolver::Knowledge>,
    parts: BTreeMap<String, Part>,
    positions: BTreeMap<String, Pos>,
    units: Vec<UnitSaved>,
    round: Option<RoundSaved>,
    rounds_at: (i64, u32),
    questions: Vec<(String, Question)>,
    #[serde(default)]
    signed: Vec<(String, String)>,
    used: BTreeMap<String, String>,
    steps: u64,
    until: i64,
    record_decisions: bool,
    audit: bool,
    stand_in: Option<String>,
}

/// An action as it is saved: the participant API's JSON, with an act's provenance (read back by `Action::from_json`).
fn action_saved(a: &Action) -> Value {
    let mut v = a.to_json();
    if let Action::Act { provenance: oikos_actors::sight::Provenance::Given(p), .. } = a {
        v["provenance"] = p.clone();
    }
    v
}

impl Snapshot {
    /// The world as it was taken (for tests and tools: read only).
    pub fn state(&self) -> &crate::state::State {
        self.kernel.state()
    }

    /// The world's state hash when it was taken.
    pub fn state_hash(&self) -> &str {
        &self.head.state_hash
    }

    /// Its bytes (for a file, or the binary log): `OIKOSNP1`, the head's length and JSON, then the rest compressed
    /// (the config as given, the state, the engine's part, each with its length).
    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        self.bytes(false)
    }

    /// Its bytes without its config, for a binary log (whose header has the config): read back with
    /// `from_bytes_with` and the log's config (`blog::snapshot_in` does both).
    pub fn to_bytes_for_log(&self) -> Result<Vec<u8>, String> {
        self.bytes(true)
    }

    fn bytes(&self, without_config: bool) -> Result<Vec<u8>, String> {
        let mut head = self.head.clone();
        head.config_elsewhere = without_config;
        let head = serde_json::to_vec(&head).map_err(|e| e.to_string())?;
        let state = serde_json::to_vec(self.kernel.state()).map_err(|e| format!("the state: {e}"))?;
        let engine = serde_json::to_vec(&self.saved).map_err(|e| format!("the engine: {e}"))?;
        let config = if without_config { vec![] } else { self.config.to_vec() };
        let mut body = Vec::with_capacity(config.len() + state.len() + engine.len() + 24);
        for part in [&config, &state, &engine] {
            body.extend_from_slice(&(part.len() as u64).to_le_bytes());
            body.extend_from_slice(part);
        }
        let packed = zstd::bulk::compress(&body, LEVEL).map_err(|e| e.to_string())?;
        let mut out = Vec::with_capacity(packed.len() + head.len() + 32);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&(head.len() as u32).to_le_bytes());
        out.extend_from_slice(&head);
        out.extend_from_slice(&(body.len() as u64).to_le_bytes());
        out.extend_from_slice(&packed);
        Ok(out)
    }

    /// The head alone, without reading the rest.
    pub fn head_of(bytes: &[u8]) -> Result<Head, String> {
        if bytes.len() < 12 || &bytes[..8] != MAGIC {
            return Err("not a snapshot (or one of another format)".into());
        }
        let n = u32::from_le_bytes(bytes[8..12].try_into().expect("four bytes")) as usize;
        let head: Head = serde_json::from_slice(bytes.get(12..12 + n).ok_or("a snapshot cut short")?).map_err(|e| e.to_string())?;
        if head.format != SNAPSHOT_FORMAT {
            return Err(format!("a snapshot of format {}, and this engine reads {SNAPSHOT_FORMAT}", head.format));
        }
        Ok(head)
    }

    /// A snapshot read back: the world made again from its config and state, and checked against the hash it was
    /// taken with.
    pub fn from_bytes(bytes: &[u8]) -> Result<Snapshot, String> {
        Self::read(bytes, None)
    }

    /// A snapshot taken for a log (its config left out), read back with the log's config (canonical JSON).
    pub fn from_bytes_with(bytes: &[u8], config: &[u8]) -> Result<Snapshot, String> {
        Self::read(bytes, Some(config))
    }

    fn read(bytes: &[u8], given: Option<&[u8]>) -> Result<Snapshot, String> {
        let mut head = Self::head_of(bytes)?;
        let n = u32::from_le_bytes(bytes[8..12].try_into().expect("four bytes")) as usize;
        let rest = &bytes[12 + n..];
        let size = u64::from_le_bytes(rest.get(..8).ok_or("a snapshot cut short")?.try_into().expect("eight bytes")) as usize;
        let body = zstd::bulk::decompress(&rest[8..], size).map_err(|e| format!("a snapshot's body: {e}"))?;
        let mut parts = vec![];
        let mut at = 0;
        for _ in 0..3 {
            let len = u64::from_le_bytes(body.get(at..at + 8).ok_or("a snapshot's body cut short")?.try_into().expect("eight")) as usize;
            parts.push(body.get(at + 8..at + 8 + len).ok_or("a snapshot's body cut short")?);
            at += 8 + len;
        }
        let config: &[u8] = match (head.config_elsewhere, given) {
            (false, _) => parts[0],
            (true, Some(c)) => c,
            (true, None) => return Err("this snapshot was taken for a log and holds no config: read it with the log's (blog::snapshot_in)".into()),
        };
        head.config_elsewhere = false;
        let (loaded, _) = crate::config::load_from(config).map_err(|e| format!("the config: {e}"))?;
        let config = crate::config::Canonical::of(config);
        let state: crate::state::State = serde_json::from_slice(parts[1]).map_err(|e| format!("the state: {e}"))?;
        let kernel = Kernel::resume(&loaded, state)?;
        let hash = kernel.state_hash().map_err(|e| e.to_string())?;
        if hash != head.state_hash {
            return Err(format!("the snapshot's world reads back as {hash}, not the {} it was taken with", head.state_hash));
        }
        let saved: Saved = serde_json::from_slice(parts[2]).map_err(|e| format!("the engine: {e}"))?;
        Ok(Snapshot { head, config, kernel, saved })
    }
}

/// A step's `Kept` as it was decided: where its decisions and outcomes were let go of once written for the log
/// (`Engine::start_round`), read back from those bytes (each the canonical annotation; its data is the value).
fn kept_whole(kept: &Kept, prepared: &Option<(Vec<Option<Vec<u8>>>, bool, Vec<u8>)>) -> Kept {
    let mut k = kept.clone();
    let Some((bytes, true, _)) = prepared else { return k };
    for b in bytes.iter().flatten() {
        let mut v: Value = serde_json::from_slice(b).expect("an annotation the engine wrote is JSON");
        let data = v["data"].take();
        match v["annotation"].as_str() {
            Some("decision") => k.decisions.push(data),
            Some("outcome") => {
                if let Value::Object(mut m) = data {
                    if let Some(Value::Array(o)) = m.remove("outcomes") {
                        k.outcomes = o;
                    }
                }
            }
            other => unreachable!("a prepared annotation of kind {other:?}"),
        }
    }
    k
}

impl<W: Write> Engine<W> {
    /// The whole run as it is now: between moments (after `next_by` stopped), or while a round waits on seats.
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        let (next_seq, prev) = self.run.log_head();
        let units = self
            .units
            .values()
            .map(|u| {
                Ok(UnitSaved {
                    key: u.key.clone(),
                    participant: u.participant.clone(),
                    capacity: u.capacity.clone(),
                    entity: u.entity.clone(),
                    kind: u.kind.to_string(),
                    ctx: u.ctx.as_ref().map(|c| CtxSaved {
                        participant: c.participant.clone(),
                        system: c.performer == Performer::System,
                        entity: c.entity.clone(),
                        position: c.position.clone(),
                        params: c.params.to_map(),
                    }),
                    actor: u.actor.as_ref().map(|a| a.save()).transpose().map_err(|e| format!("{}: {e}", u.key))?,
                    draws: u.draws.clone(),
                    view: u.view.clone(),
                    looks: u.looks.clone(),
                    answers: u.answers.clone(),
                    woke_for: u.woke_for.clone(),
                    since: u.since,
                    failures: u.failures,
                    diverged: u.diverged.clone(),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let round = self.round.as_ref().map(|r| RoundSaved {
            awake: r.awake.clone(),
            cursor: r.cursor,
            next: r.next.clone(),
            decided: r
                .decided
                .iter()
                .map(|(k, d)| {
                    let d = match d {
                        // (Without the capture's draws: a snapshot is the same with the capture on or off.)
                        Decided::Code(Ok((a, kept)), prepared) => DecidedSaved::Code(Ok((action_saved(a), Kept { captured: vec![], ..kept_whole(kept, prepared) }))),
                        Decided::Code(Err(e), _) => DecidedSaved::Code(Err(e.clone())),
                        Decided::Seat(a) => DecidedSaved::Seat(a.as_ref().map(action_saved)),
                    };
                    (k.clone(), d)
                })
                .collect(),
        });
        let seats_waiting = self
            .round
            .iter()
            .flat_map(|r| r.decided.iter().filter(|(_, d)| matches!(d, Decided::Seat(None))).map(|(k, _)| k.clone()))
            .collect();
        Ok(Snapshot {
            head: Head {
                format: SNAPSHOT_FORMAT,
                run_id: self.run.run_id().to_string(),
                kernel: KernelIdentity::current(),
                t: self.t(),
                next_seq,
                prev,
                state_hash: self.state_hash()?,
                seats_waiting,
                config_elsewhere: false,
            },
            config: self.run.config_canonical().clone(),
            kernel: self.run.kernel().fork(),
            saved: Saved {
                sched: self.sched.clone(),
                knowledge: self.knowledge.clone(),
                parts: self.parts.clone(),
                positions: self.positions.clone(),
                units,
                round,
                rounds_at: self.rounds_at,
                questions: self.questions.clone(),
                signed: self.signed.clone(),
                used: self.used.clone(),
                steps: self.steps,
                until: self.until,
                record_decisions: self.opts.record_decisions,
                audit: self.opts.audit,
                stand_in: self.opts.stand_in.clone(),
            },
        })
    }

    /// The run taken up again from a snapshot, its log carried on into `out` (from the snapshot's entry: no header).
    /// `opts` says how many threads and, if given, a new `until`; what the run was started with (whether decisions are
    /// recorded, audits, the stand-in) is the snapshot's. The same snapshot may be resumed any number of times: each is
    /// a fork, apart from the others from then on.
    pub fn resume(snap: &Snapshot, out: W, anchors: Option<Box<dyn Write>>, opts: EngineOptions) -> Result<Self, String> {
        let s = &snap.saved;
        // (What the engine reads of the config as JSON: its members but the participants and most of the world.)
        let config = Value::Object(crate::config::rest_of(snap.config.reader()).map_err(|e| format!("the snapshot's config: {e}"))?);
        let base = Base::of(&config)?.capturing(opts.capture_citizens.is_some());
        let world = base.world.clone();
        let currency = base.currency.clone();
        let run = Run::resume(snap.kernel.fork(), snap.config.clone(), &snap.head.run_id, snap.head.next_seq, &snap.head.prev, out, anchors);
        let opts = EngineOptions {
            record_decisions: s.record_decisions,
            audit: s.audit,
            stand_in: s.stand_in.clone(),
            until: Some(opts.until.unwrap_or(s.until)),
            ..opts
        };
        let mut e = Engine::assemble(run, base, opts, s.sched.clone());
        e.parts = s.parts.clone();
        e.positions = s.positions.clone();
        e.knowledge = s.knowledge.clone();
        for k in e.knowledge.values_mut() {
            k.currency = currency.clone();
        }
        e.rounds_at = s.rounds_at;
        e.questions = s.questions.clone();
        e.signed = s.signed.clone();
        e.used = s.used.clone();
        e.steps = s.steps;
        for u in &s.units {
            // (A code unit is one with a context; an actor whose memory is nothing saved `null`, read back as `None`.)
            let (actor, ctx, kind) = match (&u.ctx, &u.actor) {
                (Some(c), saved) => {
                    let saved = saved.clone().unwrap_or(Value::Null);
                    let kind = oikos_actors::registry::find(&u.kind).ok_or_else(|| format!("{}: no actor kind {} in this engine", u.key, u.kind))?;
                    let ctx = Ctx {
                        participant: c.participant.clone(),
                        performer: if c.system { Performer::System } else { Performer::Person },
                        entity: c.entity.clone(),
                        position: c.position.clone(),
                        params: c.params.clone().into(),
                        world: world.clone(),
                    };
                    let actor = oikos_actors::offices::books::restore(kind, &ctx, saved).map_err(|e| format!("{}: {e}", u.key))?;
                    (Some(actor), Some(ctx), kind.name())
                }
                (None, _) => (None, None, "llm.participant"),
            };
            e.units.insert(
                u.key.clone(),
                Unit {
                    key: u.key.clone(),
                    participant: u.participant.clone(),
                    capacity: u.capacity.clone(),
                    entity: u.entity.clone(),
                    kind,
                    actor,
                    ctx,
                    draws: u.draws.clone(),
                    view: u.view.clone(),
                    looks: u.looks.clone(),
                    answers: u.answers.clone(),
                    woke_for: u.woke_for.clone(),
                    since: u.since,
                    failures: u.failures,
                    diverged: u.diverged.clone(),
                },
            );
        }
        if let Some(r) = &s.round {
            let mut decided = BTreeMap::new();
            for (k, d) in &r.decided {
                let d = match d {
                    DecidedSaved::Code(Ok((a, kept))) => Decided::Code(Ok((Action::from_json(a)?, kept.clone())), None),
                    DecidedSaved::Code(Err(x)) => Decided::Code(Err(x.clone()), None),
                    DecidedSaved::Seat(a) => Decided::Seat(a.as_ref().map(Action::from_json).transpose()?),
                };
                decided.insert(k.clone(), d);
            }
            e.round = Some(Round { awake: r.awake.clone(), decided, cursor: r.cursor, next: r.next.clone() });
        }
        e.open_capture()?;
        Ok(e)
    }

    /// A fork of this run, now, its log written to `out` (see `resume`). This run is untouched.
    pub fn fork<X: Write>(&self, out: X, anchors: Option<Box<dyn Write>>, opts: EngineOptions) -> Result<Engine<X>, String> {
        Engine::resume(&self.snapshot()?, out, anchors, opts)
    }
}
