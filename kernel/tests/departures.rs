//! Faults found in the bug hunt of 2026-10-17 (runs/bughunt-2026-10-17.md), kernel side, each with the test that failed
//! before its fix.

use crate::common;

use common::*;
use oikos_kernel::events::EventBody;
use oikos_kernel::kernel::Command;
use oikos_kernel::run::Run;
use oikos_kernel::state::ParticipantStatus;
use serde_json::{json, Value};

type R = Run<Vec<u8>>;

fn cmd(participant: &str, position: Option<&str>, blocks: Value) -> Command {
    Command::Act {
        participant: participant.into(),
        position: position.map(String::from),
        blocks: serde_json::from_value(blocks).expect("the blocks parse"),
        by: vec![],
        provenance: json!({"via": "direct"}),
        reasoning: None,
        thinking: None,
    }
}

fn outcome(run: &mut R, c: &Command) -> Option<String> {
    let r = step(run, c).expect("the command is accepted");
    r.events.iter().find_map(|e| match &e.body {
        EventBody::ActionRefused { code, .. } => Some(serde_json::to_value(code).unwrap().as_str().unwrap().to_string()),
        _ => None,
    })
}

/// Finding 1: someone who leaves the world holds no post in it and acts no more, through their own participant or a seat.
#[test]
fn a_person_who_leaves_the_world_loses_their_posts_and_seats() {
    let mut c = world(&default_params());
    let alice = c["participants"].as_array().unwrap().iter().find(|p| p["id"] == "alice-self").unwrap().clone();
    let mut seat = alice.clone();
    seat["id"] = json!("clerk-seat");
    seat["shares_body"] = json!(true);
    seat["channels"] = json!([]);
    c["participants"].as_array_mut().unwrap().push(seat);
    c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "clerk").unwrap()["holder"] = json!("clerk-seat");
    let mut run = Run::start(c, "departures", Vec::new(), None).unwrap();
    assert_eq!(outcome(&mut run, &cmd("alice-self", None, json!([{"block": "leave"}]))), None);
    let st = run.kernel().state();
    assert_eq!(st.participants["clerk-seat"].status, ParticipantStatus::Ended, "the seat outlived the person's departure");
    assert_eq!(st.positions["clerk"].holder, None, "the post stayed with a person who has left");
    let say = cmd("clerk-seat", Some("clerk"), json!([{"block": "message", "to": ["bob-self"], "text": "from abroad"}]));
    assert_ne!(outcome(&mut run, &say), None, "the departed person's seat acted");
    // Their own affairs abroad stay theirs; a post they held is no longer theirs to act in.
    let own = cmd("alice-self", None, json!([{"block": "message", "to": ["bob-self"], "text": "from abroad"}]));
    assert_eq!(outcome(&mut run, &own), None);
}

#[test]
fn a_person_who_leaves_the_world_no_longer_holds_their_own_post() {
    let mut c = world(&default_params());
    c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "clerk").unwrap()["holder"] = json!("alice-self");
    let mut run = Run::start(c, "departures", Vec::new(), None).unwrap();
    assert_eq!(outcome(&mut run, &cmd("alice-self", None, json!([{"block": "leave"}]))), None);
    assert_eq!(run.kernel().state().positions["clerk"].holder, None, "the post stayed with a person who has left");
    let say = cmd("alice-self", Some("clerk"), json!([{"block": "message", "to": ["bob-self"], "text": "as clerk, from abroad"}]));
    assert_ne!(outcome(&mut run, &say), None, "acted in a post they no longer hold");
}

/// Finding 2: an office's books stay with the office. A new holder is told of the payments made while the post was held by
/// another and while it was vacant, as the payments it has not yet seen.
#[test]
fn a_new_holder_of_a_post_is_told_of_the_payments_the_office_has_had() {
    let mut c = world(&default_params());
    c["positions"].as_array_mut().unwrap().push(json!({"id": "devco-office", "entity": "devco", "title": "office", "channels": [{"id": "money", "kind": "accounts"}], "role_module": {"code": "test"}, "holder": "bob-self"}));
    let mut run = Run::start(c, "ledger", Vec::new(), None).unwrap();
    let told = |run: &mut R, who: &str| -> usize {
        let o = run.command(&Command::Observe { participant: who.into(), only: Some("devco-office".into()) }).unwrap().observation.unwrap();
        match o.channels.get("devco-office/money") {
            Some(oikos_kernel::observe::ChannelData::Accounts { transactions, .. }) => transactions.len(),
            other => panic!("no accounts channel: {other:?}"),
        }
    };
    let pay = cmd("carol-self", None, json!([{"block": "transfer", "from": "acc-carol", "to": "acc-devco", "amount": "5"}]));
    assert_eq!(outcome(&mut run, &pay), None);
    assert_eq!(told(&mut run, "bob-self"), 1);
    // The post falls vacant; another payment is made; alice takes the post.
    let vacate = cmd("developer-system", Some("developer"), json!([{"block": "appoint", "position": "devco-office"}]));
    assert_eq!(outcome(&mut run, &vacate), None);
    assert_eq!(outcome(&mut run, &pay), None);
    let appoint = cmd("developer-system", Some("developer"), json!([{"block": "appoint", "position": "devco-office", "participant": "alice-self"}]));
    assert_eq!(outcome(&mut run, &appoint), None);
    assert_eq!(told(&mut run, "alice-self"), 2, "the new holder was told of nothing the office had had");
}

/// An owner's post that the world marks `holds_abroad` stays theirs when they leave; any other falls vacant.
#[test]
fn a_post_that_holds_abroad_stays_with_its_holder_who_leaves() {
    let mut c = world(&default_params());
    let p = c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "clerk").unwrap();
    p["holder"] = json!("alice-self");
    p["holds_abroad"] = json!(true);
    let mut run = Run::start(c, "abroad", Vec::new(), None).unwrap();
    assert_eq!(outcome(&mut run, &cmd("alice-self", None, json!([{"block": "leave"}]))), None);
    assert_eq!(run.kernel().state().positions["clerk"].holder.as_deref(), Some("alice-self"));
}

/// Risk register (guardianship): the kernel let anyone take anyone out of the world. Now an adult is taken out by
/// themselves only; a minor by a parent on record or a position the world names a guardian; a world that sets no age of
/// majority lets nobody take another.
#[test]
fn nobody_takes_another_out_of_the_world_but_a_guardian_of_a_minor() {
    let build = |majority: Option<u32>, parent: bool| {
        let mut c = world(&default_params());
        // carol is a child of 12, with alice as her parent on record; bob is 25.
        let ents = c["world"]["entities"].as_array_mut().unwrap();
        let carol = ents.iter_mut().find(|e| e["id"] == "carol").unwrap();
        carol["born_at"] = json!(-12 * YEAR);
        if parent {
            carol["parents"] = json!(["alice"]);
        }
        if let Some(m) = majority {
            c["life"]["majority"] = json!(m);
            c["life"]["guardians"] = json!(["clerk"]);
        }
        Run::start(c, "guardianship", Vec::new(), None).unwrap()
    };
    // No age of majority: refused, whoever asks.
    let mut run = build(None, true);
    assert_eq!(outcome(&mut run, &cmd("alice-self", None, json!([{"block": "leave", "person": "carol"}]))).as_deref(), Some("not_theirs"));
    // With one: a stranger cannot take an adult or a child; the parent takes the child; nobody takes an adult.
    let mut run = build(Some(18), true);
    assert_eq!(outcome(&mut run, &cmd("alice-self", None, json!([{"block": "leave", "person": "bob"}]))).as_deref(), Some("not_theirs"));
    assert_eq!(outcome(&mut run, &cmd("bob-self", None, json!([{"block": "leave", "person": "carol"}]))).as_deref(), Some("not_theirs"));
    assert_eq!(outcome(&mut run, &cmd("alice-self", None, json!([{"block": "leave", "person": "carol"}]))), None);
    // A minor with no parent on record (a newcomer's child) can be taken by any person; an adult still by nobody.
    let mut run = build(Some(18), false);
    assert_eq!(outcome(&mut run, &cmd("alice-self", None, json!([{"block": "leave", "person": "bob"}]))).as_deref(), Some("not_theirs"));
    assert_eq!(outcome(&mut run, &cmd("bob-self", None, json!([{"block": "leave", "person": "carol"}]))), None);
}
