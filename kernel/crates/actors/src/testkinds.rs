//! Test doubles that wrap a real kind (docs/port-guide.md, "Testing a module alone"). Never a research run's and never
//! used by a generated world: `registry::find` knows them, `registry::kinds()` (what the generator and the manifests
//! see) does not, and a world names one only from a test, as the TS tests named `test.leaving` and the like.
//!
//! Each does what the real kind does and, on days a test sets, one thing of its own as well: where `stub.script` stands
//! in for a whole actor, these stand beside a real one (a mayor who files a direction and later withdraws it, a finance
//! officer who holds a payment, a resident who leaves town), so that the real kind's conduct is what the test watches.
//!
//! Parameters (all but `inner` optional; the rest are the real kind's, passed on as they are):
//! - `inner`: the real kind's name (`test.finance_holding` defaults to `city.finance_officer`);
//! - `calls`: `[{ "at": seconds, "call": "<call language>", "after_withdrawals": bool }]`, each made once at its first
//!   wake on or after `at` (and, with `after_withdrawals`, once every withdrawal below is made);
//! - `withdraw`: `[{ "at": seconds, "kind": "hold", "by": "entity" | "author" }]`: from `at`, withdraws the double's own
//!   latest statement of that kind (one it was shown, made by its entity or by itself), once;
//! - `scribble`: `{ "every": seconds, "call": "<call language>" }`: each time the real kind would wait, and `every` has
//!   gone by since it last did this, makes the call instead (`{t}` in it is the moment, in seconds): papers of no effect
//!   (twin-draws.test.ts's `test.scribbling`).
//!
//! The wake it spends on its own act is the real kind's wake lost, as in TS.

use crate::{registry, Action, Actor, Ctx, Cx, Kind, Picture, DAY};
use oikos_contracts::blocks::RecordBody;
use oikos_sight::calls::parse_program;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Own {
    at: i64,
    call: String,
    #[serde(default)]
    after_withdrawals: bool,
    #[serde(default)]
    done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Withdraw {
    at: i64,
    kind: String,
    #[serde(default)]
    by: String,
    #[serde(default)]
    seen: Option<String>,
    #[serde(default)]
    done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Scribble {
    every: i64,
    call: String,
    /// (As the TS double began: -1, so the first is made at a wait half a day in.)
    #[serde(default = "minus_one")]
    last: i64,
}
fn minus_one() -> i64 {
    -1
}

const OWN_PARAMS: [&str; 4] = ["inner", "calls", "withdraw", "scribble"];

pub struct Double {
    name: &'static str,
    default_inner: &'static str,
}

/// Every double, in name order (found by `registry::find`, never listed by `registry::kinds`).
pub static KINDS: &[&dyn Kind] = &[
    &Faulty { name: "test.hang" },
    &Faulty { name: "test.throw" },
    &Double { name: "test.directing", default_inner: "" },
    &Double { name: "test.finance_holding", default_inner: "city.finance_officer" },
    &Double { name: "test.leaving", default_inner: "" },
    &Double { name: "test.scribbling", default_inner: "" },
];

/// `test.hang` and `test.throw`, for the reliability tests (the TS fixtures of the same names): a participant that waits a
/// day at a time and, from `hang_at` (or `throw_at`) seconds on, never returns (a hang, in a loop) or fails every time it
/// is asked (a panic, which the engine recovers in place, records, and retires after three in a row).
pub struct Faulty {
    name: &'static str,
}

impl Kind for Faulty {
    fn name(&self) -> &'static str {
        self.name
    }
    fn version(&self) -> &'static str {
        "0.0.1"
    }
    fn doc(&self) -> &'static str {
        "docs/port-guide.md"
    }
    fn manifest(&self) -> Value {
        json!({ "name": self.name, "version": "0.0.1", "doc": "docs/port-guide.md", "params": {}, "perceives": [], "state": "none" })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let key = if self.name == "test.hang" { "hang_at" } else { "throw_at" };
        Ok(Box::new(FaultyActor { hang: self.name == "test.hang", at: ctx.param(key, 0)? }))
    }
    fn restore(&self, ctx: &Ctx, _: Value) -> Result<Box<dyn Actor>, String> {
        self.create(ctx)
    }
}

struct FaultyActor {
    hang: bool,
    at: i64,
}

impl Actor for FaultyActor {
    fn step(&mut self, pic: &Picture, _: &mut Cx) -> Action {
        if pic.t >= self.at {
            if self.hang {
                // (Waits on a message nobody sends: no clock and no thread of its own, as the determinism rules ask, and
                // no core spent while the watchdog finds the stall.)
                let (tx, rx) = std::sync::mpsc::channel::<()>();
                std::mem::forget(tx);
                let _ = rx.recv();
                unreachable!("nobody sends")
            }
            panic!("Error: a bug at t={}", pic.t);
        }
        Action::wait()
    }
    fn save(&self) -> Result<Value, String> {
        Ok(Value::Null)
    }
}

impl Double {
    fn inner(&self, ctx: &Ctx) -> Result<(&'static dyn Kind, Ctx), String> {
        let want: String = ctx.param("inner", self.default_inner.to_string())?;
        let kind = registry::find(&want).filter(|k| !k.name().starts_with("test.")).ok_or_else(|| format!("{}: no kind {want:?} to wrap", self.name))?;
        let mut inner = ctx.clone();
        for k in OWN_PARAMS {
            inner.params.remove(k);
        }
        Ok((kind, inner))
    }
}

impl Kind for Double {
    fn name(&self) -> &'static str {
        self.name
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/port-guide.md"
    }
    fn manifest(&self) -> Value {
        json!({ "name": self.name, "version": "0.1.0", "doc": "docs/port-guide.md", "params": {}, "perceives": [], "state": "none" })
    }
    fn cadence(&self, ctx: &Ctx) -> i64 {
        self.inner(ctx).map(|(k, c)| k.cadence(&c).min(DAY)).unwrap_or(DAY)
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        self.inner(ctx).map(|(k, c)| k.first_wake(&c)).unwrap_or(0)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let (kind, ictx) = self.inner(ctx)?;
        let mut calls: Vec<Own> = ctx.param("calls", vec![])?;
        calls.sort_by_key(|c| c.at);
        for c in &calls {
            parse_program(&c.call).map_err(|e| format!("{}: {}: {}", self.name, c.call, e.0))?;
        }
        let mut withdraw: Vec<Withdraw> = ctx.param("withdraw", vec![])?;
        withdraw.sort_by_key(|w| w.at);
        let scribble: Option<Scribble> = ctx.param("scribble", None)?;
        if let Some(sc) = &scribble {
            parse_program(&sc.call.replace("{t}", "0")).map_err(|e| format!("{}: {}: {}", self.name, sc.call, e.0))?;
        }
        Ok(Box::new(Wrapped { inner: kind.create(&ictx)?, calls, withdraw, scribble }))
    }
    fn restore(&self, ctx: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let (kind, ictx) = self.inner(ctx)?;
        let mut saved = saved;
        let inner = saved.get_mut("inner").map(Value::take).ok_or("test double: no inner memory")?;
        let own: Own2 = serde_json::from_value(saved).map_err(|e| e.to_string())?;
        Ok(Box::new(Wrapped { inner: kind.restore(&ictx, inner)?, calls: own.calls, withdraw: own.withdraw, scribble: own.scribble }))
    }
}

#[derive(Serialize, Deserialize)]
struct Own2 {
    calls: Vec<Own>,
    withdraw: Vec<Withdraw>,
    #[serde(default)]
    scribble: Option<Scribble>,
}

struct Wrapped {
    inner: Box<dyn Actor>,
    calls: Vec<Own>,
    withdraw: Vec<Withdraw>,
    scribble: Option<Scribble>,
}

fn call(text: &str) -> Action {
    Action::Call { program: parse_program(text).expect("checked when made"), reasoning: Some("scripted".into()) }
}

impl Actor for Wrapped {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        // Its own papers, as it is shown them: the id a withdrawal goes by (the latest of that kind).
        for r in pic.all_records() {
            if let RecordBody::Statement { kind, .. } = &r.body {
                for w in self.withdraw.iter_mut().filter(|w| &w.kind == kind) {
                    let mine = if w.by == "author" { r.author == pic.participant } else { r.speaks_for.as_deref() == Some(pic.entity.as_str()) };
                    if mine {
                        w.seen = Some(r.id.to_string());
                    }
                }
            }
        }
        let withdrawn = self.withdraw.iter().all(|w| w.done);
        if let Some(c) = self.calls.iter_mut().find(|c| !c.done && c.at <= pic.t && (!c.after_withdrawals || withdrawn)) {
            c.done = true;
            return call(&c.call);
        }
        if let Some(w) = self.withdraw.iter_mut().find(|w| !w.done && w.at <= pic.t && w.seen.is_some()) {
            w.done = true;
            return call(&format!("statement(withdraw={})", w.seen.as_ref().unwrap()));
        }
        let a = self.inner.step(pic, cx);
        if let (Action::Wait { .. }, Some(sc)) = (&a, self.scribble.as_mut()) {
            if pic.t - sc.last >= sc.every {
                sc.last = pic.t;
                return Action::Call { program: parse_program(&sc.call.replace("{t}", &pic.t.to_string())).expect("checked when made"), reasoning: None };
            }
        }
        a
    }
    fn beliefs(&self) -> Vec<crate::Belief> {
        self.inner.beliefs()
    }
    fn sent(&mut self, action: &str) {
        self.inner.sent(action)
    }
    fn save(&self) -> Result<Value, String> {
        Ok(json!({ "inner": self.inner.save()?, "calls": self.calls, "withdraw": self.withdraw, "scribble": self.scribble }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_doubles_are_found_by_name_and_never_listed_with_the_world_s_kinds() {
        for k in KINDS {
            assert!(registry::find(k.name()).is_some());
            assert!(registry::kinds().iter().all(|x| x.name() != k.name()));
        }
    }
}
