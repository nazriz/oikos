//! Faults found in the bug hunt of 2026-10-17 (runs/bughunt-2026-10-17.md), kernel side, each with the test that failed
//! before its fix.

mod common;

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
