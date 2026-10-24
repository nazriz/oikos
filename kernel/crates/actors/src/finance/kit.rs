//! Test support for the kinds of lane D (docs/port-guide.md, section 4): an actor stepped alone, on what it is shown. A
//! `Rig` holds one actor and its view of the world and wakes it with observations written as JSON (the contract's shape),
//! as `participants/test/stepping.ts` did for the TS modules. Not used by any world; compiled in so that `kernel/tests/d_*.rs`
//! can use it too.

// (Everything below is test support: the generality scan, which reads platform code only, stops at the first cfg(test).)
#[cfg(test)]
mod _test_support_below {}

use crate::{Action, Actor, Ctx, Cx, Draws, Kind, WorldInfo};
use oikos_sight::calls::{parse_program, Call, Currency, Program, Value as Arg};
use oikos_sight::{Observation, View};
use serde_json::{json, Map, Value};
use std::sync::Arc;

pub const DAY: i64 = 86_400;
pub const MONTH: i64 = 30 * DAY;

/// A world whose money is a test currency with a sign and two decimals, as the tests of the TS modules had it.
pub fn test_money() -> Arc<WorldInfo> {
    Arc::new(WorldInfo {
        tick: 60,
        run_end: 10 * 365 * DAY,
        currency: Some(Currency { code: "XTS".into(), minor_units: 2, symbol: Some("$".into()), ..Default::default() }),
        ..Default::default()
    })
}

/// One actor, its context, its view and its keyed streams.
pub struct Rig {
    pub kind: &'static dyn Kind,
    pub ctx: Ctx,
    pub actor: Box<dyn Actor>,
    pub draws: Draws,
    pub view: View,
    pub seed: u64,
    pub woke: i64,
    sent: u64,
    last: Option<Program>,
}

impl Rig {
    pub fn new(kind: &'static dyn Kind, entity: &str, participant: &str, params: Value) -> Rig {
        Rig::with_world(kind, entity, participant, params, test_money())
    }

    pub fn with_world(kind: &'static dyn Kind, entity: &str, participant: &str, params: Value, world: Arc<WorldInfo>) -> Rig {
        let ctx = Ctx {
            participant: participant.into(),
            performer: Default::default(),
            entity: entity.into(),
            position: Some(format!("{entity}-office")),
            params: params.as_object().cloned().unwrap_or_default().into(),
            world,
        };
        let actor = kind.create(&ctx).expect("the kind is made");
        Rig { kind, draws: Draws::new(participant, &format!("{entity}-office")), ctx, actor, view: View::default(), seed: 7, woke: 0, sent: 0, last: None }
    }

    /// An observation at `t`: channels (name -> data), the letters in, and the outcomes of its last acts.
    pub fn observation(&self, t: i64, channels: Value, inbox: Value, outcomes: Value) -> Observation {
        serde_json::from_value(json!({
            "participant": self.ctx.participant, "t": t, "status": "active", "entity": self.ctx.entity,
            "outcomes": outcomes, "inbox": inbox, "drafts": [], "channels": channels,
        }))
        .expect("an observation")
    }

    /// Wakes the actor and returns its action.
    pub fn wake(&mut self, t: i64, woke_for: &str, channels: Value, inbox: Value, outcomes: Value) -> Action {
        let obs = self.observation(t, channels, inbox, outcomes);
        let pic = self.view.apply(obs, None, &self.ctx.entity.clone(), woke_for, t - self.woke);
        self.woke = t;
        let mut cx = Cx::new(t, &self.ctx, &mut self.draws, self.seed, vec![]);
        let action = self.actor.step(&pic, &mut cx);
        self.last = None;
        if let Action::Call { program, .. } = &action {
            self.last = Some(program.clone());
            self.sent += 1;
            self.actor.sent(&format!("act.{}", self.sent));
        }
        action
    }

    /// Wakes it as its cadence does and lets it go on until it waits, as the world would (each act done, its outcome
    /// handed to the next step, what it has been shown not shown again): what it said, and what it looked up.
    pub fn run(&mut self, t: i64, channels: Value, inbox: Value) -> Ran {
        let (mut woke_for, mut inbox, mut channels, mut outcomes) = ("cadence", inbox, channels, json!([]));
        let mut ran = Ran::default();
        for i in 0..2000 {
            match self.wake(t, woke_for, channels.clone(), inbox.clone(), outcomes.clone()) {
                Action::Wait { .. } => break,
                Action::Look { looks } => ran.looks.extend(looks.iter().map(|l| serde_json::to_value(l).unwrap_or_default())),
                a => ran.said.extend(calls(&a)),
            }
            let mut created = Map::new();
            if let Some(Program::Lines(lines)) = self.last_program() {
                for l in lines {
                    if let Some(b) = &l.bind {
                        created.insert(b.clone(), format!("made.{i}.{b}").into());
                    }
                }
            }
            outcomes = json!([{ "action": format!("act.{}", self.sent), "t": t, "status": "applied", "created": created }]);
            woke_for = "done";
            inbox = json!([]);
            if let Some(o) = channels.as_object_mut() {
                for c in o.values_mut() {
                    match c["kind"].as_str() {
                        Some("records") => c["records"] = json!([]),
                        Some("accounts") => c["transactions"] = json!([]),
                        _ => {}
                    }
                }
            }
        }
        ran
    }

    fn last_program(&self) -> Option<Program> {
        self.last.clone()
    }

    /// Wakes it as its cadence does, and returns the calls it made until it waited.
    pub fn at(&mut self, t: i64, channels: Value, inbox: Value) -> Vec<Call> {
        self.run(t, channels, inbox).said
    }

    /// The outcome of its last act, as the world would report it, to be handed to its next wake.
    pub fn applied(&self, created: Value) -> Value {
        json!([{ "action": format!("act.{}", self.sent), "t": 0, "status": "applied", "created": created }])
    }

    /// Saves the actor and brings it back, as a snapshot and a fork would.
    pub fn snapshot_round_trip(&mut self) {
        let saved = self.actor.save().expect("it saves");
        self.actor = self.kind.restore(&self.ctx, saved.clone()).expect("it restores");
        assert_eq!(self.actor.save().expect("it saves again"), saved, "a restored actor saves the same");
    }
}

/// What an actor did in one moment.
#[derive(Debug, Default)]
pub struct Ran {
    pub said: Vec<Call>,
    pub looks: Vec<Value>,
}

/// The calls an action makes, in order.
pub fn calls(a: &Action) -> Vec<Call> {
    match a {
        Action::Call { program: Program::Lines(lines), .. } => lines.iter().map(|l| l.call.clone()).collect(),
        _ => vec![],
    }
}

/// A call's argument as text (an id, a quoted text, or a number as written).
pub fn arg(c: &Call, key: &str) -> Option<String> {
    c.get(key).map(|v| match v {
        Arg::Id(s) | Arg::Text(s) | Arg::Var(s) => s.clone(),
        Arg::Json(j) => j.as_str().map_or_else(|| j.to_string(), String::from),
        Arg::Call(_) => String::new(),
    })
}

/// A call's argument as JSON.
pub fn json_arg(c: &Call, key: &str) -> Value {
    match c.get(key) {
        Some(Arg::Json(j)) => j.clone(),
        Some(Arg::Id(s) | Arg::Text(s)) => Value::String(s.clone()),
        _ => Value::Null,
    }
}

pub fn program(text: &str) -> Vec<Call> {
    match parse_program(text) {
        Ok(Program::Lines(l)) => l.into_iter().map(|l| l.call).collect(),
        _ => vec![],
    }
}

/// A statement record, as the kernel gives it.
pub fn statement(id: &str, at: i64, kind: &str, who: Value, data: Value) -> Value {
    let mut r = Map::new();
    r.insert("id".into(), id.into());
    r.insert("at".into(), at.into());
    r.insert("record".into(), "statement".into());
    r.insert("kind".into(), kind.into());
    r.insert("text".into(), format!("{kind} {id}").into());
    r.insert("author".into(), "genesis".into());
    r.insert("visible_to".into(), "public".into());
    r.insert("data".into(), data);
    if let Value::Object(o) = who {
        r.extend(o);
    }
    Value::Object(r)
}

/// Accounts held at one bank, `balances` by holder.
pub fn custody(custodian: &str, balances: &[(&str, i64)]) -> Value {
    json!({ "kind": "accounts", "transactions": [], "accounts": balances.iter().map(|(h, b)| json!({
        "account": format!("acc-{h}"), "holder": h, "custodian": custodian, "currency": "XTS", "balance": b.to_string() })).collect::<Vec<_>>() })
}

pub fn records(rs: Vec<Value>) -> Value {
    json!({ "kind": "records", "records": rs })
}

/// A letter to the actor.
pub fn letter(id: &str, t: i64, from: &str, text: &str) -> Value {
    json!({ "id": id, "t": t, "from": from, "to": ["x"], "text": text })
}

/// What an actor would see at `t` with these channels, made fresh (for a library tested without an actor around it).
pub fn picture(entity: &str, t: i64, channels: Value) -> oikos_sight::Picture {
    let obs: Observation = serde_json::from_value(json!({
        "participant": "x", "t": t, "status": "active", "entity": entity, "outcomes": [], "inbox": [], "drafts": [], "channels": channels,
    }))
    .expect("an observation");
    View::default().apply(obs, None, entity, "cadence", 0)
}

/// A book of what these records say (one channel of them, all shown at once).
pub fn book_of(entity: &str, rs: Vec<Value>) -> crate::common::Book {
    let mut b = crate::common::Book::new();
    b.absorb(&picture(entity, 0, json!({ "mine": records(rs) })));
    b
}

/// A context and keyed streams for a library called with a `Cx` (a respondent, a borrower).
pub struct Stand {
    pub ctx: Ctx,
    pub draws: Draws,
}

impl Stand {
    pub fn new(entity: &str) -> Stand {
        Stand {
            ctx: Ctx { participant: format!("{entity}-system"), performer: Default::default(), entity: entity.into(), position: None, params: Default::default(), world: test_money() },
            draws: Draws::new(&format!("{entity}-system"), "office"),
        }
    }
    pub fn cx(&mut self, t: i64) -> Cx<'_> {
        Cx::new(t, &self.ctx, &mut self.draws, 7, vec![])
    }
}
