//! Hand-made records for this lane's tests (the TS tests' `statement`, `employment`, `signed`).

use crate::common::Book;
use crate::steps::Step;
use crate::{Ctx, Cx, Draws, WorldInfo};
use oikos_sight::calls::{Call, Value as Arg};
use oikos_sight::{ParticipantStatus, Picture, Record, Seen};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;

pub fn rec(v: Value) -> Arc<Record> {
    Arc::new(serde_json::from_value(v).expect("a record"))
}

/// A published statement (`speaks_for` the speaker; visible to all).
pub fn statement(id: &str, at: i64, kind: &str, data: Value, speaks_for: &str) -> Arc<Record> {
    rec(json!({ "id": id, "record": "statement", "author": "genesis", "speaks_for": speaks_for, "at": at, "visible_to": "public", "kind": kind, "text": id, "data": data }))
}

/// A book that has taken these records in.
pub fn taken(records: Vec<Arc<Record>>) -> Book {
    let mut b = Book::new();
    b.take_all(&records);
    b
}

/// Another person's agreement the office made (an employment as its offer words it).
pub fn employment(id: &str, at: i64, employer: &str, worker: &str, wage: i64, period: i64, author: &str, text: Option<&str>) -> Arc<Record> {
    let mut terms = json!({ "template": "employment", "parties": [employer, worker],
        "commitments": [{ "who": employer, "does": { "outcome": { "money": { "to": format!("acc-{worker}"), "amount": wage.to_string(), "for": "wages" } } }, "every": period }] });
    if let Some(t) = text {
        terms["text"] = json!(t);
    }
    rec(json!({ "id": id, "at": at, "author": author, "record": "agreement", "visible_to": [employer, worker], "terms": terms }))
}

/// The signatures of an agreement's parties at `at`.
pub fn signatures(a: &Record, at: i64) -> Vec<Arc<Record>> {
    crate::papers::agreements::parties_of(a)
        .iter()
        .map(|p| rec(json!({ "id": format!("sig-{}-{p}", a.id), "at": at, "author": format!("{p}-x"), "record": "signature", "agreement": a.id, "as": p, "visible_to": crate::papers::agreements::parties_of(a) })))
        .collect()
}

/// A picture of an entity at `t`: what it was shown (records, accounts as `(account, holder, balance)`, transactions).
pub fn picture(t: i64, entity: &str, records: Vec<Arc<Record>>, accounts: &[(&str, &str, i128)], transactions: Vec<oikos_sight::Transaction>) -> Picture {
    let items: Vec<oikos_sight::AccountItem> = accounts
        .iter()
        .map(|(a, h, b)| serde_json::from_value(json!({ "account": a, "holder": h, "custodian": "bank", "currency": "XTS", "balance": b.to_string() })).unwrap())
        .collect();
    let mut channels = BTreeMap::new();
    channels.insert("papers".into(), Seen::Records { records, search: false });
    channels.insert("treasury".into(), Seen::Accounts { accounts: Arc::new(items), transactions });
    Picture {
        participant: "x".into(),
        t,
        status: ParticipantStatus::Active,
        entity: entity.into(),
        as_position: None,
        body: None,
        positions: vec![],
        outcomes: vec![],
        inbox: vec![],
        channels,
        asking: vec![],
        readings: BTreeMap::new(),
        woke_for: "cadence".into(),
        since: 0,
    }
}

pub fn ctx(participant: &str, entity: &str) -> Ctx {
    Ctx { participant: participant.into(), performer: Default::default(), entity: entity.into(), position: None, params: Default::default(), world: Arc::new(WorldInfo::default()) }
}

/// A step's context at `t` (a seed of 1).
pub fn with_cx<R>(c: &Ctx, t: i64, f: impl FnOnce(&mut Cx) -> R) -> R {
    let mut draws = Draws::default();
    let mut cx = Cx::new(t, c, &mut draws, 1, vec![]);
    f(&mut cx)
}

/// Every call a list of steps would make, in order.
pub fn said<T>(steps: &[Step<T>]) -> Vec<Call> {
    steps.iter().flat_map(|s| s.lines.iter().map(|l| l.call.clone())).collect()
}

/// An argument as plain JSON (an id or text as a string).
pub fn argv(c: &Call, key: &str) -> Value {
    match c.get(key) {
        Some(Arg::Id(s)) | Some(Arg::Text(s)) | Some(Arg::Var(s)) => json!(s),
        Some(Arg::Json(v)) => v.clone(),
        Some(Arg::Call(k)) => json!({ "call": k.fn_ }),
        None => Value::Null,
    }
}

/// The calls of a given kind of statement.
pub fn statements<'a>(calls: &'a [Call], kind: &str) -> Vec<&'a Call> {
    calls.iter().filter(|c| c.fn_ == "statement" && argv(c, "kind") == json!(kind)).collect()
}

/// What an actor does in one wake at `pic`: the programs it sends (as text, one per action) until it waits, and the
/// looks it asks for on the way; it is answered by `answer` after each action (a world that applies everything).
pub fn drive(actor: &mut dyn crate::Actor, pic: &Picture, c: &Ctx) -> (Vec<oikos_sight::calls::Program>, Vec<oikos_sight::LookRequest>, Option<i64>) {
    use oikos_sight::Action;
    let (mut programs, mut looks, mut until) = (vec![], vec![], None);
    let mut draws = Draws::default();
    let mut p = pic.clone();
    for _ in 0..200 {
        let mut cx = Cx::new(pic.t, c, &mut draws, 1, vec![]);
        match actor.step(&p, &mut cx) {
            Action::Wait { until: u } => {
                until = u;
                break;
            }
            Action::Look { looks: l } => {
                looks.extend(l);
                p.woke_for = "asked".into();
            }
            Action::Call { program, .. } => {
                actor.sent("call");
                programs.push(program);
                p.woke_for = "done".into();
                p.outcomes = vec![serde_json::from_value(json!({ "action": "call", "t": pic.t, "status": "applied" })).unwrap()];
            }
            _ => break,
        }
    }
    (programs, looks, until)
}

/// The calls of programs, flattened.
pub fn calls_of(programs: &[oikos_sight::calls::Program]) -> Vec<Call> {
    programs
        .iter()
        .flat_map(|p| match p {
            oikos_sight::calls::Program::Lines(l) => l.iter().map(|x| x.call.clone()).collect::<Vec<_>>(),
            _ => vec![],
        })
        .collect()
}

/// A picture with a directory channel showing these positions `(position, entity, holder)` and entities
/// `(entity, kind, participant)`.
pub fn with_directory(mut pic: Picture, positions: &[(&str, &str, Option<&str>)], entities: &[(&str, &str, Option<&str>)]) -> Picture {
    let ps: Vec<oikos_sight::PositionItem> = positions
        .iter()
        .map(|(p, e, h)| serde_json::from_value(json!({ "position": p, "entity": e, "role": "officer", "holder": h })).unwrap())
        .collect();
    let es: Vec<oikos_sight::EntityItem> = entities.iter().map(|(e, k, p)| serde_json::from_value(json!({ "entity": e, "kind": k, "name": e, "participant": p })).unwrap()).collect();
    pic.channels.insert("who".into(), Seen::Directory { entities: Arc::new(es), positions: Arc::new(ps) });
    pic
}
