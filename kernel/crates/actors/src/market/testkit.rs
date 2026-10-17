//! A scripted world for testing a market actor alone (docs/port-guide.md section 4): a `Harness` holds one actor, feeds
//! it hand-written observations (shoppers' orders and payments, suppliers' price lists, a staff on the books) the way
//! the engine would, answers each act it sends with an applied outcome (naming what the act made), and returns the
//! calls it wrote. Nothing here is in the shipped crate.

#![cfg(test)]

use crate::{Action, Actor, Ctx, Cx, Draws, Kind, WorldInfo};
use oikos_rules::slip::Performer;
use oikos_sight::calls::{program_text, Currency, Program};
use oikos_sight::{Observation, Picture, View};
use serde_json::{json, Value};
use std::sync::Arc;

pub fn world() -> WorldInfo {
    WorldInfo {
        tick: 3600,
        run_end: 400 * 86_400,
        currency: Some(Currency { code: "USD".into(), symbol: Some("$".into()), minor_units: 2, ..Default::default() }),
        ..Default::default()
    }
}

pub fn ctx(entity: &str, params: Value) -> Ctx {
    Ctx {
        participant: format!("{entity}-system"),
        performer: Performer::default(),
        entity: entity.into(),
        position: Some(format!("{entity}-manager")),
        params: params.as_object().cloned().unwrap_or_default(),
        world: Arc::new(world()),
    }
}

/// A record as JSON the state would hold: a statement.
pub fn statement(id: &str, at: i64, by: &str, kind: &str, to: &[&str], data: Value) -> Value {
    json!({ "id": id, "record": "statement", "author": format!("{by}-system"), "speaks_for": by, "at": at, "visible_to": "public",
        "kind": kind, "text": kind, "addressed_to": to, "data": data })
}

pub struct Harness {
    pub kind: &'static dyn Kind,
    pub ctx: Ctx,
    pub actor: Box<dyn Actor>,
    draws: Draws,
    view: View,
    seed: u64,
    n: u64,
    pub t: i64,
    /// Every program the actor has sent, in order, as text.
    pub sent: Vec<String>,
}

impl Harness {
    pub fn new(kind: &'static dyn Kind, entity: &str, params: Value) -> Harness {
        let ctx = ctx(entity, params);
        let actor = kind.create(&ctx).expect("the actor is made");
        let draws = Draws::new(&ctx.participant, ctx.position.as_deref().unwrap_or("self"));
        Harness { kind, ctx, actor, draws, view: View::default(), seed: 11, n: 0, t: 0, sent: vec![] }
    }

    /// Replace the actor with its own saved self (every actor's memory saves).
    pub fn save_and_restore(&mut self) {
        let saved = self.actor.save().expect("saves");
        self.actor = self.kind.restore(&self.ctx, saved.clone()).expect("restores");
        assert_eq!(self.actor.save().unwrap(), saved, "a restored actor saves as it was");
    }

    fn observation(&self, t: i64, channels: Value, outcomes: Value) -> Observation {
        serde_json::from_value(json!({ "participant": self.ctx.participant, "t": t, "status": "active", "outcomes": outcomes,
            "inbox": [], "drafts": [], "channels": channels }))
        .expect("an observation")
    }

    /// One wake at `t` with these channels. Each act the actor sends is answered applied (naming what it made: each
    /// line bound to a name is `rec.<n>` under that name), and it is woken again, until it waits. Returns the programs
    /// sent, as text.
    pub fn wake(&mut self, t: i64, channels: Value) -> Vec<String> {
        self.t = t;
        let mut out = vec![];
        let mut chans = channels;
        let mut outcomes = json!([]);
        let mut woke_for = "cadence";
        for _ in 0..200 {
            let obs = self.observation(t, chans.clone(), outcomes.clone());
            let pic: Picture = self.view.apply(obs, Some(self.ctx.position.as_deref().unwrap_or("self")), &self.ctx.entity, woke_for, 0);
            let mut cx = Cx::new(t, &self.ctx, &mut self.draws, self.seed, vec![]);
            let action = self.actor.step(&pic, &mut cx);
            chans = json!({});
            outcomes = json!([]);
            match action {
                Action::Call { program, .. } => {
                    self.n += 1;
                    let id = format!("act.{}", self.n);
                    let mut created = serde_json::Map::new();
                    if let Program::Lines(lines) = &program {
                        for l in lines {
                            if let Some(b) = &l.bind {
                                created.insert(b.clone(), json!(format!("rec.{}", 1000 + self.n)));
                            }
                        }
                    }
                    self.actor.sent(&id);
                    let text = program_text(&program);
                    out.push(text.clone());
                    self.sent.push(text);
                    outcomes = json!([{ "action": id, "t": t, "status": "applied", "created": created }]);
                    woke_for = "done";
                }
                Action::Wait { .. } => break,
                Action::Look { .. } => woke_for = "asked",
                other => panic!("unexpected action {other:?}"),
            }
        }
        out
    }

    /// Like `wake`, but each act is refused with this code and detail.
    pub fn wake_refused(&mut self, t: i64, channels: Value, code: &str, detail: &str) -> Vec<String> {
        self.t = t;
        let mut out = vec![];
        let mut chans = channels;
        let mut outcomes = json!([]);
        let mut woke_for = "cadence";
        for _ in 0..50 {
            let obs = self.observation(t, chans.clone(), outcomes.clone());
            let pic: Picture = self.view.apply(obs, Some(self.ctx.position.as_deref().unwrap_or("self")), &self.ctx.entity, woke_for, 0);
            let mut cx = Cx::new(t, &self.ctx, &mut self.draws, self.seed, vec![]);
            let action = self.actor.step(&pic, &mut cx);
            chans = json!({});
            outcomes = json!([]);
            match action {
                Action::Call { program, .. } => {
                    self.n += 1;
                    let id = format!("act.{}", self.n);
                    self.actor.sent(&id);
                    out.push(program_text(&program));
                    outcomes = json!([{ "action": id, "t": t, "status": "refused", "refusal": { "code": code, "detail": detail } }]);
                    woke_for = "done";
                }
                Action::Wait { .. } => break,
                Action::Look { .. } => woke_for = "asked",
                other => panic!("unexpected action {other:?}"),
            }
        }
        out
    }
}

/// The accounts channel: one account, with its balance, and transactions new since the last look.
pub fn money(entity: &str, balance: i64, transactions: Value) -> Value {
    json!({ "money": { "kind": "accounts", "accounts": [{ "account": format!("acc-{entity}"), "holder": entity, "custodian": "bank", "currency": "USD", "balance": balance.to_string() }], "transactions": transactions } })
}

pub fn tx(from: &str, to: &str, amount: i64, t: i64, memo: &str) -> Value {
    json!({ "t": t, "from": from, "to": to, "amount": amount.to_string(), "currency": "USD", "by": from, "memo": memo })
}

pub fn records(channel: &str, recs: Vec<Value>) -> Value {
    json!({ channel: { "kind": "records", "records": recs } })
}

pub fn holdings(items: &[(&str, &str, i64)]) -> Value {
    json!({ "stores": { "kind": "holdings", "holdings": items.iter().map(|(at, kind, q)| json!({ "at": at, "kind": kind, "quantity": q.to_string() })).collect::<Vec<_>>() } })
}

/// Merge channel objects.
pub fn channels(parts: Vec<Value>) -> Value {
    let mut m = serde_json::Map::new();
    for p in parts {
        for (k, v) in p.as_object().cloned().unwrap_or_default() {
            m.insert(k, v);
        }
    }
    Value::Object(m)
}

/// A picture of one observation (a fresh view: transactions are new in it).
pub fn picture(t: i64, entity: &str, channels: Value) -> Picture {
    let obs: Observation = serde_json::from_value(json!({ "participant": format!("{entity}-system"), "t": t, "status": "active",
        "outcomes": [], "inbox": [], "drafts": [], "channels": channels }))
    .expect("an observation");
    View::default().apply(obs, None, entity, "cadence", 0)
}

/// A book of these records, as an actor would have kept them.
pub fn book_of(recs: Vec<Value>) -> crate::common::Book {
    let mut b = crate::common::Book::new();
    let rs: Vec<Arc<oikos_sight::Record>> = recs.into_iter().map(|v| Arc::new(serde_json::from_value(v).expect("a record"))).collect();
    b.take_all(&rs);
    b
}

pub fn cx_for<'a>(ctx: &'a Ctx, draws: &'a mut Draws, t: i64) -> Cx<'a> {
    Cx::new(t, ctx, draws, 11, vec![])
}
