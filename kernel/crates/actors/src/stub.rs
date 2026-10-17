//! Stand-ins, for testing an actor in a world whose other actors are not yet ported (docs/port-guide.md, "Testing a
//! module alone"). Never a research run's: a world that names a stand-in says so in its log (the engine's
//! `orchestrator` annotation lists every kind it ran).
//!
//! - `idle`: does nothing (participants/src/behaviour/world.ts `idle`; also a control condition). The engine's
//!   `stand_in` option runs it for every kind not yet ported.
//! - `stub.script`: does what its `script` says, when it says (`[{ "at": seconds, "call": "<call language>" }]`): a
//!   dependency's acts, scripted (an employer that pays a wage, a landlord that serves a notice), so that the actor
//!   under test meets them as it would the real one. The script is the test's words, resolved by the engine like any
//!   code actor's call.

use crate::{Action, Actor, Ctx, Cx, Kind, Picture, DAY};
use oikos_sight::calls::parse_program;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub struct Idle;

impl Kind for Idle {
    fn name(&self) -> &'static str {
        "idle"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/README.md"
    }
    fn manifest(&self) -> Value {
        json!({ "name": "idle", "version": "0.1.0", "doc": "docs/behaviour/README.md", "params": {}, "perceives": [], "state": "none" })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        30 * DAY
    }
    fn create(&self, _: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(IdleActor))
    }
    fn restore(&self, _: &Ctx, _: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(IdleActor))
    }
}

struct IdleActor;
impl Actor for IdleActor {
    fn step(&mut self, _: &Picture, _: &mut Cx) -> Action {
        Action::wait()
    }
    fn save(&self) -> Result<Value, String> {
        Ok(Value::Null)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Line {
    at: i64,
    call: String,
}

pub struct Script;

impl Kind for Script {
    fn name(&self) -> &'static str {
        "stub.script"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/port-guide.md"
    }
    fn manifest(&self) -> Value {
        json!({ "name": "stub.script", "version": "0.1.0", "doc": "docs/port-guide.md", "params": { "script": { "schema": { "type": "array" }, "default": [], "source": "test" } }, "perceives": [], "state": "none" })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let mut lines: Vec<Line> = ctx.param("script", vec![])?;
        lines.sort_by_key(|l| l.at);
        for l in &lines {
            parse_program(&l.call).map_err(|e| format!("stub.script: {}: {}", l.call, e.0))?;
        }
        Ok(Box::new(Scripted { lines, next: 0, end: ctx.world.run_end + DAY }))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        serde_json::from_value::<Scripted>(saved).map(|s| Box::new(s) as Box<dyn Actor>).map_err(|e| e.to_string())
    }
}

#[derive(Serialize, Deserialize)]
struct Scripted {
    lines: Vec<Line>,
    next: usize,
    /// After the run's end: it has nothing more to do.
    end: i64,
}

impl Actor for Scripted {
    fn step(&mut self, pic: &Picture, _: &mut Cx) -> Action {
        match self.lines.get(self.next) {
            Some(l) if l.at <= pic.t => {
                self.next += 1;
                Action::Call { program: parse_program(&l.call).expect("checked when made"), reasoning: Some("scripted".into()) }
            }
            Some(l) => Action::wait_until(l.at),
            None => Action::wait_until(self.end),
        }
    }
    fn save(&self) -> Result<Value, String> {
        serde_json::to_value(self).map_err(|e| e.to_string())
    }
}
