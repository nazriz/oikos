//! Orchestrator <-> kernel transport: newline-delimited JSON over stdio.
//! One request line in, one response line out. Not a contract (the log and
//! participant API are); kept deliberately small.
//!
//! Requests:
//!   {"op":"start","config":{..},"run_id":"..","log_path":"..","anchors_path":"..","record_refs":true?}
//!     (record_refs: the host keeps every record it's handed, so in an observation's records channels a record it
//!     has been handed before is written as its id, a string, in place of the record)
//!   {"op":"command","command":{..}}        -> {"ok":true,"seq":n,"events":[..],"observation":{..}?}
//!   {"op":"check","participant":"..","as":".."?,"blocks":[..]} -> {"ok":true,"check":{"ok":..,"refusal":..}}
//!   {"op":"view","participant":".."}      -> {"ok":true,"observation":{..}} (the full picture; not logged)
//!   {"op":"annotate","annotation":{..}}    -> {"ok":true,"seq":n}
//!   {"op":"state"}                         -> {"ok":true,"t":..,"state_hash":..,"head":..}
//!   {"op":"flush"}                         -> {"ok":true,"head":..} (the log file now holds every entry so far:
//!     for whoever reads a run's own log before it ends, as the debrief at a run's end does; changes nothing)
//!   {"op":"finish","reason":"completed","detail":".."?} -> {"ok":true,"seq":n,"state_hash":..}
//! Errors: {"ok":false,"error":".."}. Errors are never logged. A failure to write the log itself is
//! {"ok":false,"error":"log write failed: ..","fatal":true}: not a refused request, the end of the run.

use crate::blocks::Block;
use crate::kernel::Command;
use crate::run::Run;
use serde_json::{json, Value};
use std::fs::File;
use std::io::{BufRead, BufWriter, Write};

/// One connection's run: the same requests and replies whether they arrive over stdio (`serve`) or in-process
/// (the engine's native module, docs/design/rebuild.md section 5.1).
#[derive(Default)]
pub struct Session {
    run: Option<Run<BufWriter<File>>>,
    /// When each unit wakes (the engine's side of the loop: crate::schedule), once the host registers its units.
    sched: Option<crate::schedule::Scheduler>,
    /// What each seat knows (`<participant>|<capacity>`, or `<participant>` for all its capacities), from the
    /// observations delivered to it: the resolver's only source (P8).
    knowledge: std::collections::BTreeMap<String, oikos_resolver::Knowledge>,
    /// The world's structure types (its catalogue), by id: what the resolver reads of a kind of building.
    types: std::collections::BTreeMap<String, Value>,
    /// How the world's money is written (its config's first currency): how the resolver reads and writes amounts.
    currency: Option<oikos_resolver::calls::Currency>,
    /// The world's calendar and the words its dates are written in (its config's `calendar`), for the same.
    dated: Option<oikos_rules::calendar::Dated>,
    /// The registers of lots seats have been shown whole, held once between them (never part of what a seat knows).
    registers: oikos_resolver::knowledge::Registers,
    /// The Rust world (`start` with `engine`): the engine runs every built-in actor, the host its seats.
    engine: Option<crate::engine::Engine<BufWriter<File>>>,
    /// What `next` found while the host still had the engine's events to read: given at the next `next`.
    due: Option<Value>,
}

impl Session {
    pub fn new() -> Self {
        Self::default()
    }

    /// One request, one reply (never an error: a refused request is `{"ok":false,"error":..}`). A log that couldn't
    /// be written is marked `fatal`: the host must not take it for an off-contract request and carry on.
    pub fn request(&mut self, req: &Value) -> Value {
        match self.reply(req) {
            Reply::Value(v) => v,
            Reply::Line(s) => serde_json::from_str(&s).expect("a reply is JSON"),
        }
    }

    fn reply(&mut self, req: &Value) -> Reply {
        if self.engine.is_some() {
            return engine_reply(self, req).unwrap_or_else(refused);
        }
        let done = match req.get("op").and_then(Value::as_str) {
            Some("command") => command(self, req).map(Reply::Line),
            Some("next") => next(self, req),
            _ => handle(self, req).map(Reply::Value),
        };
        done.unwrap_or_else(refused)
    }

    /// As `reply`, for a request that is the caller's to take from: a run is started from its config where it is (a
    /// large world's isn't copied first).
    fn reply_taking(&mut self, req: &mut Value) -> Reply {
        if req.get("op").and_then(Value::as_str) != Some("start") || self.run.is_some() || self.engine.is_some() {
            return self.reply(req);
        }
        // (What the session keeps of the config is read before the config is taken.)
        let types = structure_types(&req["config"]);
        let currency = oikos_resolver::calls::Currency::from_config(&req["config"]["world"]["currencies"][0]);
        let config = req.get_mut("config").map(Value::take);
        start(self, req, config, types, currency).map(Reply::Value).unwrap_or_else(refused)
    }

    /// One request as a line of JSON, its reply as one.
    pub fn request_line(&mut self, line: &str) -> String {
        self.reply_to(serde_json::from_str::<Value>(line))
    }

    /// `request_line`, for a line that is the caller's to give up: it's let go once read, before the request is
    /// carried out (a large world's start is not held as its text too while the world is made).
    pub fn request_owned(&mut self, line: String) -> String {
        let req = serde_json::from_str::<Value>(&line);
        drop(line);
        self.reply_to(req)
    }

    fn reply_to(&mut self, req: serde_json::Result<Value>) -> String {
        match req {
            Ok(mut req) => match self.reply_taking(&mut req) {
                Reply::Value(v) => v.to_string(),
                Reply::Line(s) => s,
            },
            Err(e) => json!({ "ok": false, "error": format!("request is not JSON: {e}") }).to_string(),
        }
    }

    /// The connection closed: a run still open ends as aborted (errors if it already ended, which is fine).
    pub fn close(&mut self) {
        if let Some(mut e) = self.engine.take() {
            if !e.run().ended() {
                let _ = e.run_mut().finish("aborted", Some("orchestrator closed the connection"));
            }
        }
        if let Some(mut r) = self.run.take() {
            let _ = r.finish("aborted", Some("orchestrator closed the connection"));
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}

pub fn serve(input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
    let mut session = Session::new();
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        output.write_all(session.request_owned(line).as_bytes())?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    session.close();
    Ok(())
}

/// The reply to a request that wasn't carried out (a log that couldn't be written is marked fatal).
fn refused(e: String) -> Reply {
    Reply::Value(if e.starts_with(crate::run::LOG_WRITE_FAILED) {
        json!({ "ok": false, "error": e, "fatal": true })
    } else {
        json!({ "ok": false, "error": e })
    })
}

/// A reply: a value, or a line already written.
enum Reply {
    Value(Value),
    Line(String),
}

/// A command: its reply as a line, `{"events":[..],"observation":{..}?,"ok":true,"seq":n}`. Written directly: an
/// observation is most of what crosses to the host, and it has been serialised once already, for its hash in the log;
/// those bytes are the reply's.
fn command(session: &mut Session, req: &Value) -> Result<String, String> {
    let Session { run, sched, knowledge, currency, dated, registers, .. } = session;
    let r = run.as_mut().ok_or("no run started")?;
    let cmd: Command = serde_json::from_value(req.get("command").cloned().ok_or("missing command")?).map_err(|e| format!("bad command: {e}"))?;
    let mut resp = r.command(&cmd).map_err(|e| e.to_string())?;
    let observed = match resp.observation.as_mut() {
        Some(obs) => Some(r.observed(obs).map_err(|e| e.to_string())?),
        None => None,
    };
    // What the seat now knows: each observation delivered to it, as it received it.
    if let (Command::Observe { participant, only } | Command::Look { participant, only, .. }, Some(o), Some(obs)) = (&cmd, &observed, &resp.observation) {
        let key = only.as_ref().map_or_else(|| participant.clone(), |o| format!("{participant}|{o}"));
        knowledge.entry(key).or_insert_with(|| oikos_resolver::Knowledge::new(currency.clone()).with_dated(dated.clone())).absorb_seen(&crate::kernel::seen(obs), &o.shown, registers);
    }
    if let Some(s) = sched.as_mut() {
        s.note_events(Some(r.kernel().state()), &resp.events, r.kernel().t());
    }
    // (For a host that keeps the records it's handed, those it has had before are written as their ids.)
    let written = observed.as_ref().map(|o| o.wire.as_ref().unwrap_or(&o.canonical));
    let mut line = Vec::with_capacity(written.map_or(0, |w| w.len()) + 256 + resp.logged.iter().map(|b| b.len() + 1).sum::<usize>());
    line.extend_from_slice(b"{\"events\":");
    write_events(&resp, &mut line)?;
    if let Some(w) = written {
        line.extend_from_slice(b",\"observation\":");
        line.extend_from_slice(w);
    }
    line.extend_from_slice(format!(",\"ok\":true,\"seq\":{}}}", resp.seq).as_bytes());
    String::from_utf8(line).map_err(|e| e.to_string())
}

/// A command's events, as a JSON list: each as it was logged (its canonical JSON), where there's no doubt that reads
/// the same as the list written the plain way (members in the same order: so for ASCII, which is every event so far).
fn write_events(resp: &crate::run::Response, line: &mut Vec<u8>) -> Result<(), String> {
    if resp.logged.len() != resp.events.len() || !resp.logged.iter().all(|b| b.is_ascii()) {
        let events = serde_json::to_value(&resp.events).map_err(|e| e.to_string())?;
        return serde_json::to_writer(line, &events).map_err(|e| e.to_string());
    }
    line.push(b'[');
    for (i, b) in resp.logged.iter().enumerate() {
        if i > 0 {
            line.push(b',');
        }
        line.extend_from_slice(b);
    }
    line.push(b']');
    Ok(())
}

/// What's next for the host (crate::schedule): the end, a cohort to wake, or time moved on (logged as the host's
/// advance was: its events are the host's to read, as any command's). The reply to an advance is written as a line:
/// `{"advanced":to,"events":[..],"ok":true,"seq":n}`.
fn next(session: &mut Session, req: &Value) -> Result<Reply, String> {
    let Session { run, sched, .. } = session;
    let r = run.as_mut().ok_or("no run started")?;
    let until = req["until"].as_i64().ok_or("missing until")?;
    let s = sched.as_mut().ok_or("no run started")?;
    match s.next(r.kernel().t(), until)? {
        crate::schedule::Next::End => Ok(Reply::Value(json!({ "ok": true, "end": true }))),
        crate::schedule::Next::Cohort(c) => {
            // (Everyone woken looks next, in this order, before anything acts: their observations may be made ready
            // together. The host is free to ask otherwise; nothing depends on it.)
            r.plan(s.looks(&c));
            let mut v = crate::schedule::Scheduler::cohort_json(&c, r.kernel().t());
            v["ok"] = Value::Bool(true);
            Ok(Reply::Value(v))
        }
        crate::schedule::Next::Advance { to } => {
            // (Time moves on to the next wake, or to the moment something happens to a person's body if that comes first: the
            // news reaches them then, not at whichever wake follows.)
            // (Each stop is at a moment something reached somebody, and what it reached is noted at that moment: whoever it wakes wakes then. A
            // stop that wakes nobody goes on towards `to` in the same reply.)
            let (mut seq, mut events, mut logged) = (0, vec![], vec![]);
            loop {
                let resp = r.command(&Command::AdvanceToNews { to }).map_err(|e| e.to_string())?;
                let now = r.kernel().t();
                s.note_events(Some(r.kernel().state()), &resp.events, now);
                seq = seq.max(resp.seq);
                events.extend(resp.events);
                logged.extend(resp.logged);
                if now >= to || s.due_by(now) {
                    break;
                }
            }
            let resp = crate::run::Response { seq, events, observation: None, logged };
            let to = r.kernel().t();
            let mut line = Vec::with_capacity(64 + resp.logged.iter().map(|b| b.len() + 1).sum::<usize>());
            line.extend_from_slice(format!("{{\"advanced\":{to},\"events\":").as_bytes());
            write_events(&resp, &mut line)?;
            line.extend_from_slice(format!(",\"ok\":true,\"seq\":{}}}", resp.seq).as_bytes());
            String::from_utf8(line).map(Reply::Line).map_err(|e| e.to_string())
        }
    }
}

/// The world's structure types (its catalogue), by id.
fn structure_types(config: &Value) -> std::collections::BTreeMap<String, Value> {
    config["catalogue"]["structure_types"].as_array().into_iter().flatten().filter_map(|t| Some((t["id"].as_str()?.to_string(), t.clone()))).collect()
}

/// Starts a session's run from a config (the request's, handed over), with what the session keeps of it.
fn start(session: &mut Session, req: &Value, config: Option<Value>, structure_types: std::collections::BTreeMap<String, Value>, money: Option<oikos_resolver::calls::Currency>) -> Result<Value, String> {
    if req.get("engine").is_some_and(Value::is_object) {
        return start_engine(session, req, config);
    }
    let Session { run, sched, knowledge, types, currency, dated, registers, .. } = session;
    let str_field = |k: &str| req.get(k).and_then(Value::as_str).ok_or(format!("missing {k}"));
    if run.is_some() {
        return Err("a run is already started".into());
    }
    let log = File::create(str_field("log_path")?).map_err(|e| e.to_string())?;
    let anchors: Option<Box<dyn Write>> = match req.get("anchors_path").and_then(Value::as_str) {
        Some(p) => Some(Box::new(File::create(p).map_err(|e| e.to_string())?)),
        None => None,
    };
    let config = config.ok_or("missing config")?;
    *dated = oikos_rules::calendar::Dated::from_config(config.get("calendar"));
    let mut r = Run::start(config, str_field("run_id")?, BufWriter::new(log), anchors).map_err(|e| e.to_string())?;
    // A host that keeps the records it's handed asks for each one whole once, and by its id from then on.
    if req.get("record_refs").and_then(Value::as_bool) == Some(true) {
        r.refer_to_records();
    }
    let reply = json!({ "ok": true, "seq": 0, "head": r.head(), "t": r.kernel().t() });
    *types = structure_types;
    *currency = money;
    knowledge.clear();
    *registers = Default::default();
    *sched = Some(crate::schedule::Scheduler::new(r.kernel().statics().tick));
    *run = Some(r);
    Ok(reply)
}

fn handle(session: &mut Session, req: &Value) -> Result<Value, String> {
    let op = req.get("op").and_then(Value::as_str).ok_or("missing op")?;
    let str_field = |k: &str| req.get(k).and_then(Value::as_str).ok_or(format!("missing {k}"));
    if op == "start" {
        let types = structure_types(&req["config"]);
        let currency = oikos_resolver::calls::Currency::from_config(&req["config"]["world"]["currencies"][0]);
        return start(session, req, req.get("config").cloned(), types, currency);
    }
    let Session { run, sched, knowledge, types, currency, dated, .. } = session;
    let r = run.as_mut().ok_or("no run started")?;
    match op {
        // A call to the seat's own acts (the resolver, from what the seat knows): blocks, or questions for the seat.
        "resolve" => {
            let participant = str_field("participant")?;
            let key = req["only"].as_str().map_or_else(|| participant.to_string(), |o| format!("{participant}|{o}"));
            let program = oikos_resolver::calls::parse_program(str_field("program")?).map_err(|e| format!("the call doesn't parse: {}", e.0))?;
            let empty = oikos_resolver::Knowledge::new(currency.clone()).with_dated(dated.clone());
            let k = knowledge.get(&key).unwrap_or(&empty);
            let type_of = |t: &str| types.get(t).cloned();
            Ok(match oikos_resolver::resolve(&program, k, &type_of, req["as"].as_str()) {
                oikos_resolver::Resolution::Blocks(blocks) => json!({ "ok": true, "blocks": blocks }),
                oikos_resolver::Resolution::Questions { questions, invalid } => {
                    let mut v = json!({ "ok": true, "questions": questions });
                    if !invalid.is_empty() {
                        v["invalid"] = json!(invalid);
                    }
                    v
                }
            })
        }
        // The loop's schedule (crate::schedule): the host's units, when each wakes, and what's next.
        "units_add" => {
            sched.as_mut().ok_or("no run started")?.add(req["units"].as_array().ok_or("missing units")?)?;
            Ok(json!({ "ok": true }))
        }
        "units_remove" => {
            let keys: Vec<String> = req["keys"].as_array().ok_or("missing keys")?.iter().filter_map(|k| k.as_str().map(String::from)).collect();
            sched.as_mut().ok_or("no run started")?.remove(&keys);
            Ok(json!({ "ok": true }))
        }
        "to_cadence" => {
            let t = r.kernel().t();
            sched.as_mut().ok_or("no run started")?.to_cadence(str_field("participant")?, t);
            Ok(json!({ "ok": true }))
        }
        // Invariance tests only (never a research run): extra wakes, seeded.
        "perturb" => {
            let p = crate::schedule::Perturb { extra_wakes_bps: req["extra_wakes_bps"].as_u64().unwrap_or(0) as u32, seed: req["seed"].as_u64().unwrap_or(0) };
            sched.as_mut().ok_or("no run started")?.perturb(p);
            r.annotate(json!({ "annotation": "note", "subject": "orchestrator", "data": { "perturbed": { "extra_wakes_bps": p.extra_wakes_bps, "seed": p.seed } } })).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "finished" => {
            let t = r.kernel().t();
            sched.as_mut().ok_or("no run started")?.finished(str_field("key")?, req["until"].as_i64(), t);
            Ok(json!({ "ok": true }))
        }
        "check" => {
            let blocks: Vec<Block> =
                serde_json::from_value(req.get("blocks").cloned().ok_or("missing blocks")?).map_err(|e| format!("bad blocks: {e}"))?;
            let check = r.kernel().check(str_field("participant")?, req.get("as").and_then(Value::as_str), &blocks).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "check": check }))
        }
        "annotate" => {
            let seq = r.annotate(req.get("annotation").cloned().ok_or("missing annotation")?).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "seq": seq }))
        }
        "view" => {
            // What a participant's channels cover right now, in full: for checking a runtime's view. Not logged; changes nothing.
            let obs = r.full_view(str_field("participant")?).ok_or("unknown participant")?;
            Ok(json!({ "ok": true, "observation": obs }))
        }
        "agreements" => agreements_reply(r.kernel().state(), req),
        "state" => {
            let hash = r.kernel().state_hash().map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "t": r.kernel().t(), "state_hash": hash, "head": r.head() }))
        }
        "flush" => {
            // The log on disk now holds every entry appended so far. Not logged; changes nothing.
            r.flush().map_err(|e| format!("log write failed: {e}"))?;
            Ok(json!({ "ok": true, "head": r.head() }))
        }
        "finish" => {
            let reason = str_field("reason")?;
            let (seq, hash) = r.finish(reason, req.get("detail").and_then(Value::as_str)).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "seq": seq, "state_hash": hash }))
        }
        other => Err(format!("unknown op {other}")),
    }
}

// ------------------------------------------------------------------ the Rust world (lane F)

/// `start` with `engine: {stand_in?, threads?, audit?, record_decisions?}`: the Rust world. The engine runs every
/// built-in actor (crate::engine, `host_seats`); the host runs its seats with the same requests as ever: `command`
/// (its seats' looks and acts, in their places in the round), `annotate`, `resolve`, `check`, `units_add` (its seats),
/// `finished`, `next`, `flush`, `finish`. `next` gives a cohort of the host's seats only, unobserved, and before it
/// the events of the engine's own commands since last asked (as an `advanced` reply), so the host keeps its cast.
fn start_engine(session: &mut Session, req: &Value, config: Option<Value>) -> Result<Value, String> {
    let str_field = |k: &str| req.get(k).and_then(Value::as_str).ok_or(format!("missing {k}"));
    let log = File::create(str_field("log_path")?).map_err(|e| e.to_string())?;
    let anchors: Option<Box<dyn Write>> = match req.get("anchors_path").and_then(Value::as_str) {
        Some(p) => Some(Box::new(File::create(p).map_err(|e| e.to_string())?)),
        None => None,
    };
    let o = &req["engine"];
    let mut opts = crate::engine::EngineOptions { host_seats: true, stand_in: o["stand_in"].as_str().map(String::from), audit: o["audit"].as_bool() == Some(true), ..Default::default() };
    if let Some(n) = o["threads"].as_u64() {
        opts.threads = (n as usize).max(1);
    }
    match &o["record_observations"] {
        Value::Bool(b) => opts.record_observations = *b,
        Value::Array(ids) => opts.record_observations_of = ids.iter().filter_map(Value::as_str).map(String::from).collect(),
        _ => {}
    }
    if let Some(areas) = o["decision_areas"].as_array() {
        opts.decision_areas = Some(areas.iter().filter_map(Value::as_str).map(String::from).collect());
    }
    if let Some(b) = o["record_decisions"].as_bool() {
        opts.record_decisions = b;
    }
    if let Some(b) = o["mock_seats"].as_bool() {
        opts.mock_seats = b;
    }
    opts.withhold = crate::engine::withholds(&o["withhold"])?;
    let mut e = crate::engine::Engine::start(config.ok_or("missing config")?, str_field("run_id")?, BufWriter::new(log), anchors, opts)?;
    // (Records by reference are not kept here: the engine's own actors are handed records the host never sees, so the
    // host is handed every record whole. Only its seats' observations cross, and they are few.)
    let reply = json!({ "ok": true, "seq": 0, "head": e.run().head(), "t": e.t(), "engine": crate::engine::ENGINE_VERSION });
    session.engine = Some(e);
    session.due = None;
    Ok(reply)
}

fn engine_reply(session: &mut Session, req: &Value) -> Result<Reply, String> {
    let op = req.get("op").and_then(Value::as_str).ok_or("missing op")?;
    let str_field = |k: &str| req.get(k).and_then(Value::as_str).ok_or(format!("missing {k}"));
    let e = session.engine.as_mut().expect("checked");
    match op {
        "start" => Err("a run is already started".into()),
        "agreements" => agreements_reply(e.run().kernel().state(), req).map(Reply::Value),
        "command" => {
            let cmd: Command = serde_json::from_value(req.get("command").cloned().ok_or("missing command")?).map_err(|x| format!("bad command: {x}"))?;
            let (resp, observed) = e.host_command(&cmd)?;
            let written = observed.as_ref().map(|o| o.wire.as_ref().unwrap_or(&o.canonical));
            let mut line = Vec::with_capacity(written.map_or(0, |w| w.len()) + 256 + resp.logged.iter().map(|b| b.len() + 1).sum::<usize>());
            line.extend_from_slice(b"{\"events\":");
            write_events(&resp, &mut line)?;
            if let Some(w) = written {
                line.extend_from_slice(b",\"observation\":");
                line.extend_from_slice(w);
            }
            line.extend_from_slice(format!(",\"ok\":true,\"seq\":{}}}", resp.seq).as_bytes());
            String::from_utf8(line).map(Reply::Line).map_err(|x| x.to_string())
        }
        "next" => {
            if let Some(u) = req["until"].as_i64() {
                e.set_until(u);
            }
            // (`by`: stop between moments once the clock reaches it, and say how far it got, so a host running several
            // worlds in one process, or watching for a stall, gets its turn: nothing the world does depends on it.)
            let by = req["by"].as_i64();
            let due = match session.due.take() {
                Some(d) => d,
                None => match (match by { Some(b) => e.next_by(b), None => e.host_next().map(Some) })? {
                    None => json!({ "ok": true, "advanced": e.t(), "events": [] }),
                    Some(crate::engine::Due::End) => json!({ "ok": true, "end": true }),
                    Some(crate::engine::Due::Seats(seats)) => {
                        let cohort: Vec<Value> = seats.iter().map(|s| json!({ "key": s.key, "woke_for": s.woke_for, "since": s.since })).collect();
                        json!({ "ok": true, "t": e.t(), "cohort": cohort })
                    }
                },
            };
            // (What the engine's own actors did first: the host keeps its cast from it, as from an advance's events.)
            let (events, any) = e.host_events();
            if any {
                session.due = Some(due);
                let ev = serde_json::to_value(&events).map_err(|x| x.to_string())?;
                return Ok(Reply::Value(json!({ "ok": true, "advanced": e.t(), "events": ev, "seq": e.log_head().0.saturating_sub(1) })));
            }
            Ok(Reply::Value(due))
        }
        "resolve" => {
            let participant = str_field("participant")?;
            let key = req["only"].as_str().map_or_else(|| participant.to_string(), |o| format!("{participant}|{o}"));
            let program = oikos_resolver::calls::parse_program(str_field("program")?).map_err(|x| format!("the call doesn't parse: {}", x.0))?;
            Ok(Reply::Value(match e.host_resolve(&key, &program, req["as"].as_str()) {
                oikos_resolver::Resolution::Blocks(blocks) => json!({ "ok": true, "blocks": blocks }),
                oikos_resolver::Resolution::Questions { questions, invalid } => {
                    let mut v = json!({ "ok": true, "questions": questions });
                    if !invalid.is_empty() {
                        v["invalid"] = json!(invalid);
                    }
                    v
                }
            }))
        }
        "units_add" => {
            // (The host's seats only: the engine has every code unit.)
            let units: Vec<Value> = req["units"].as_array().ok_or("missing units")?.iter().filter(|u| u["llm"].as_bool() == Some(true)).cloned().collect();
            e.host_units_add(&units)?;
            Ok(Reply::Value(json!({ "ok": true })))
        }
        "units_remove" => {
            let keys: Vec<String> = req["keys"].as_array().ok_or("missing keys")?.iter().filter_map(|k| k.as_str().map(String::from)).filter(|k| !k.contains('|')).collect();
            e.host_units_remove(&keys);
            Ok(Reply::Value(json!({ "ok": true })))
        }
        "stand_in" => {
            e.host_stand_in(str_field("participant")?, req.get("controller").cloned().ok_or("missing controller")?)?;
            Ok(Reply::Value(json!({ "ok": true })))
        }
        "to_cadence" => {
            e.host_to_cadence(str_field("participant")?);
            Ok(Reply::Value(json!({ "ok": true })))
        }
        "perturb" => {
            let p = crate::schedule::Perturb { extra_wakes_bps: req["extra_wakes_bps"].as_u64().unwrap_or(0) as u32, seed: req["seed"].as_u64().unwrap_or(0) };
            e.host_perturb(p);
            e.annotate_from_host(json!({ "annotation": "note", "subject": "orchestrator", "data": { "perturbed": { "extra_wakes_bps": p.extra_wakes_bps, "seed": p.seed } } }))?;
            Ok(Reply::Value(json!({ "ok": true })))
        }
        "finished" => {
            e.host_finished(str_field("key")?, req["until"].as_i64());
            Ok(Reply::Value(json!({ "ok": true })))
        }
        "questions" => {
            // (The code actors' questions to models since last asked: the host answers those it has a model for.)
            // (With them, the signoffs of the actors' words since: a host whose translators stand as one hears each.)
            let qs: Vec<Value> = e.questions().into_iter().map(|(key, q)| json!({ "key": key, "kind": q.kind, "about": q.about, "body": q.body })).collect();
            let signed: Vec<Value> = e.signed().into_iter().map(|(draft, decision)| json!({ "draft": draft, "decision": decision })).collect();
            Ok(Reply::Value(json!({ "ok": true, "questions": qs, "signed": signed })))
        }
        "answer" => {
            let answers: Vec<oikos_actors::Answer> = serde_json::from_value(req.get("answers").cloned().ok_or("missing answers")?).map_err(|x| format!("bad answers: {x}"))?;
            e.answer(str_field("key")?, answers);
            Ok(Reply::Value(json!({ "ok": true })))
        }
        "goes_on" => {
            e.host_goes_on(str_field("key")?);
            Ok(Reply::Value(json!({ "ok": true })))
        }
        "check" => {
            let blocks: Vec<Block> = serde_json::from_value(req.get("blocks").cloned().ok_or("missing blocks")?).map_err(|x| format!("bad blocks: {x}"))?;
            let check = e.run().kernel().check(str_field("participant")?, req.get("as").and_then(Value::as_str), &blocks).map_err(|x| x.to_string())?;
            Ok(Reply::Value(json!({ "ok": true, "check": check })))
        }
        "annotate" => {
            let seq = e.run_mut().annotate(req.get("annotation").cloned().ok_or("missing annotation")?).map_err(|x| x.to_string())?;
            Ok(Reply::Value(json!({ "ok": true, "seq": seq })))
        }
        "view" => {
            let obs = e.run_mut().full_view(str_field("participant")?).ok_or("unknown participant")?;
            Ok(Reply::Value(json!({ "ok": true, "observation": obs })))
        }
        "state" => {
            let hash = e.state_hash()?;
            Ok(Reply::Value(json!({ "ok": true, "t": e.t(), "state_hash": hash, "head": e.run().head() })))
        }
        "flush" => {
            e.run_mut().flush().map_err(|x| format!("log write failed: {x}"))?;
            Ok(Reply::Value(json!({ "ok": true, "head": e.run().head() })))
        }
        "finish" => {
            let (seq, hash) = e.run_mut().finish(str_field("reason")?, req.get("detail").and_then(Value::as_str)).map_err(|x| x.to_string())?;
            Ok(Reply::Value(json!({ "ok": true, "seq": seq, "state_hash": hash, "wakes_by": e.wakes_by(), "failures": e.failures() })))
        }
        other => Err(format!("unknown op {other} (in the Rust world)")),
    }
}

/// Agreements read by their terms now (the truth audits, docs/design/rebuild.md 8.2): those named, and every one a party
/// is in. Not logged; changes nothing. (Served by both sessions: a classic run's and the engine's.)
fn agreements_reply(st: &oikos_world::state::State, req: &Value) -> Result<Value, String> {
            // Agreements read by their terms now (the truth audits, docs/design/rebuild.md 8.2): those named, and every
            // one a party is in. Not logged; changes nothing.
            let mut ids: Vec<String> = req
                .get("ids")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            if let Some(p) = req.get("party").and_then(Value::as_str) {
                ids.extend(st.agreements_of.get(p).into_iter().flat_map(|v| v.iter().cloned()));
            }
            let agreements: Vec<Value> = ids
                .iter()
                .filter_map(|id| {
                    let stored = st.records.get(id)?;
                    let crate::blocks::RecordBody::Agreement { terms } = &stored.record.body else { return None };
                    Some(json!({ "id": id, "template": terms.template, "parties": terms.parties, "reading": st.reading(id)? }))
                })
                .collect();
            Ok(json!({ "ok": true, "agreements": agreements }))
        }
