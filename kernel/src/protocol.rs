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
}

impl Session {
    pub fn new() -> Self {
        Self::default()
    }

    /// One request, one reply (never an error: a refused request is `{"ok":false,"error":..}`).
    pub fn request(&mut self, req: &Value) -> Value {
        handle(&mut self.run, req).unwrap_or_else(|e| json!({ "ok": false, "error": e }))
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

fn handle(run: &mut Option<Run<BufWriter<File>>>, req: &Value) -> Result<Value, String> {
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
            v["ok"] = Value::Bool(true);
            Ok(v)
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
