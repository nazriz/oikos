//! Orchestrator <-> kernel transport: newline-delimited JSON over stdio.
//! One request line in, one response line out. Not a contract (the log and
//! participant API are); kept deliberately small.
//!
//! Requests:
//!   {"op":"start","config":{..},"run_id":"..","log_path":"..","anchors_path":".."}
//!   {"op":"command","command":{..}}        -> {"ok":true,"seq":n,"events":[..],"observation":{..}?}
//!   {"op":"check","participant":"..","as":".."?,"blocks":[..]} -> {"ok":true,"check":{"ok":..,"refusal":..}}
//!   {"op":"view","participant":".."}      -> {"ok":true,"observation":{..}} (the full picture; not logged)
//!   {"op":"annotate","annotation":{..}}    -> {"ok":true,"seq":n}
//!   {"op":"state"}                         -> {"ok":true,"t":..,"state_hash":..,"head":..}
//!   {"op":"finish","reason":"completed","detail":".."?} -> {"ok":true,"seq":n,"state_hash":..}
//! Errors: {"ok":false,"error":".."}. Errors are never logged.

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
}

impl Session {
    pub fn new() -> Self {
        Self::default()
    }

    /// One request, one reply (never an error: a refused request is `{"ok":false,"error":..}`).
    pub fn request(&mut self, req: &Value) -> Value {
        handle(self, req).unwrap_or_else(|e| json!({ "ok": false, "error": e }))
    }

    /// One request as a line of JSON, its reply as one.
    pub fn request_line(&mut self, line: &str) -> String {
        let reply = match serde_json::from_str::<Value>(line) {
            Ok(req) => self.request(&req),
            Err(e) => json!({ "ok": false, "error": format!("request is not JSON: {e}") }),
        };
        reply.to_string()
    }

    /// The connection closed: a run still open ends as aborted (errors if it already ended, which is fine).
    pub fn close(&mut self) {
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
        output.write_all(session.request_line(&line).as_bytes())?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    session.close();
    Ok(())
}

fn handle(session: &mut Session, req: &Value) -> Result<Value, String> {
    let Session { run, sched, knowledge, types } = session;
    let op = req.get("op").and_then(Value::as_str).ok_or("missing op")?;
    let str_field = |k: &str| req.get(k).and_then(Value::as_str).ok_or(format!("missing {k}"));
    if op == "start" {
        if run.is_some() {
            return Err("a run is already started".into());
        }
        let log = File::create(str_field("log_path")?).map_err(|e| e.to_string())?;
        let anchors: Option<Box<dyn Write>> = match req.get("anchors_path").and_then(Value::as_str) {
            Some(p) => Some(Box::new(File::create(p).map_err(|e| e.to_string())?)),
            None => None,
        };
        let config = req.get("config").cloned().ok_or("missing config")?;
        let r = Run::start(config, str_field("run_id")?, BufWriter::new(log), anchors).map_err(|e| e.to_string())?;
        let reply = json!({ "ok": true, "seq": 0, "head": r.head(), "t": r.kernel().t() });
        *types = req["config"]["catalogue"]["structure_types"].as_array().into_iter().flatten().filter_map(|t| Some((t["id"].as_str()?.to_string(), t.clone()))).collect();
        knowledge.clear();
        *sched = Some(crate::schedule::Scheduler::new(r.kernel().statics().tick));
        *run = Some(r);
        return Ok(reply);
    }
    let r = run.as_mut().ok_or("no run started")?;
    match op {
        "command" => {
            let cmd: Command =
                serde_json::from_value(req.get("command").cloned().ok_or("missing command")?).map_err(|e| format!("bad command: {e}"))?;
            let resp = r.command(&cmd).map_err(|e| e.to_string())?;
            let mut v = serde_json::to_value(&resp).map_err(|e| e.to_string())?;
            // What the seat now knows: each observation delivered to it, as it received it.
            if let (Command::Observe { participant, only } | Command::Look { participant, only, .. }, Some(obs)) = (&cmd, v.get("observation")) {
                let key = only.as_ref().map_or_else(|| participant.clone(), |o| format!("{participant}|{o}"));
                knowledge.entry(key).or_default().absorb(obs);
            }
            if let Some(s) = sched.as_mut() {
                s.note(Some(r.kernel().state()), v["events"].as_array().map(Vec::as_slice).unwrap_or_default(), r.kernel().t());
            }
            v["ok"] = Value::Bool(true);
            Ok(v)
        }
        // A call to the seat's own acts (the resolver, from what the seat knows): blocks, or questions for the seat.
        "resolve" => {
            let participant = str_field("participant")?;
            let key = req["only"].as_str().map_or_else(|| participant.to_string(), |o| format!("{participant}|{o}"));
            let program = oikos_resolver::calls::parse_program(str_field("program")?).map_err(|e| format!("the call doesn't parse: {}", e.0))?;
            let empty = oikos_resolver::Knowledge::default();
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
        "next" => {
            let until = req["until"].as_i64().ok_or("missing until")?;
            let s = sched.as_mut().ok_or("no run started")?;
            match s.next(r.kernel().t(), until)? {
                crate::schedule::Next::End => Ok(json!({ "ok": true, "end": true })),
                crate::schedule::Next::Cohort(c) => {
                    let mut v = crate::schedule::Scheduler::cohort_json(&c, r.kernel().t());
                    v["ok"] = Value::Bool(true);
                    Ok(v)
                }
                crate::schedule::Next::Advance { to } => {
                    // Time moves on (logged as the host's advance was): its events are the host's to read, as any command's.
                    let resp = r.command(&Command::Advance { to }).map_err(|e| e.to_string())?;
                    let mut v = serde_json::to_value(&resp).map_err(|e| e.to_string())?;
                    s.note(Some(r.kernel().state()), v["events"].as_array().map(Vec::as_slice).unwrap_or_default(), r.kernel().t());
                    v["ok"] = Value::Bool(true);
                    v["advanced"] = json!(to);
                    Ok(v)
                }
            }
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
        "agreements" => {
            // Agreements read by their terms now (the truth audits, docs/design/rebuild.md 8.2): those named, and every
            // one a party is in. Not logged; changes nothing.
            let st = r.kernel().state();
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
        "state" => {
            let hash = r.kernel().state_hash().map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "t": r.kernel().t(), "state_hash": hash, "head": r.head() }))
        }
        "finish" => {
            let reason = str_field("reason")?;
            let (seq, hash) = r.finish(reason, req.get("detail").and_then(Value::as_str)).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "seq": seq, "state_hash": hash }))
        }
        other => Err(format!("unknown op {other}")),
    }
}
