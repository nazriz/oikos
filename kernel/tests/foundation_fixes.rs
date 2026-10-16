//! Faults the independent review of the foundations found (runs/review-foundations-2026-10-16.md), each with the test that
//! failed before its fix. One test per finding, named for it.

mod common;

use common::*;
use oikos_kernel::events::{EventBody, RefusalCode};
use oikos_kernel::kernel::Command;
use oikos_kernel::run::Run;
use oikos_kernel::state::ParticipantStatus;
use serde_json::{json, Value};

type R = Run<Vec<u8>>;
const DAY: i64 = 86_400;

fn cmd_by(participant: &str, position: Option<&str>, blocks: Value, by: &[&str]) -> Command {
    Command::Act {
        participant: participant.into(),
        position: position.map(String::from),
        blocks: serde_json::from_value(blocks).expect("the blocks parse"),
        by: by.iter().map(|s| s.to_string()).collect(),
        provenance: json!({"via": "direct"}),
        reasoning: None,
        thinking: None,
    }
}

fn cmd(participant: &str, position: Option<&str>, blocks: Value) -> Command {
    cmd_by(participant, position, blocks, &[])
}

fn start(config: Value) -> R {
    Run::start(config, "fixes", Vec::new(), None).unwrap()
}

/// The code an act was refused with, or None if it took effect (carried to its end).
fn outcome(run: &mut R, c: &Command) -> Option<String> {
    let r = step(run, c).expect("the command is accepted");
    r.events.iter().find_map(|e| match &e.body {
        EventBody::ActionRefused { code, .. } => Some(serde_json::to_value(code).unwrap().as_str().unwrap().to_string()),
        _ => None,
    })
}

fn said(code: Option<String>) -> String {
    code.unwrap_or_else(|| "applied".into())
}

/// The F5 fixture: alice's `clerk-seat` (sharing her body) holds the `clerk` post beside her own participant.
fn seated() -> Value {
    let mut c = world(&default_params());
    let alice = c["participants"].as_array().unwrap().iter().find(|p| p["id"] == "alice-self").unwrap().clone();
    let mut seat = alice.clone();
    seat["id"] = json!("clerk-seat");
    seat["shares_body"] = json!(true);
    seat["channels"] = json!([]);
    c["participants"].as_array_mut().unwrap().push(seat);
    c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "clerk").unwrap()["holder"] = json!("clerk-seat");
    c
}

fn kill(run: &mut R, who: &str) {
    for i in 0..400 {
        if !run.kernel().state().body(who).unwrap().alive {
            return;
        }
        step(run, &cmd("bob-self", None, json!([{"block": "harm", "person": who}])));
        run.command(&Command::Advance { to: (i + 1) * DAY }).unwrap();
    }
    panic!("{who} did not die");
}

/// Finding 1: a model's seat ends with the person it acts through; its post falls vacant.
#[test]
fn f1_a_seat_ends_with_the_person_it_acts_through() {
    let mut run = start(seated());
    kill(&mut run, "alice");
    let st = run.kernel().state();
    assert_eq!(st.participants["alice-self"].status, ParticipantStatus::Ended);
    assert_eq!(st.participants["clerk-seat"].status, ParticipantStatus::Ended, "the seat outlived the person");
    assert_eq!(st.positions["clerk"].holder, None, "the post stayed with the dead person's seat");
    let say = cmd("clerk-seat", Some("clerk"), json!([{"block": "message", "to": ["bob-self"], "text": "from the grave"}]));
    assert_ne!(outcome(&mut run, &say), None, "the dead person's seat acted");
}

/// Finding 3: a system works for the organisation that owns it, and for none other.
#[test]
fn f3_a_system_is_not_appointed_to_an_organisation_that_does_not_own_it() {
    let mut run = start(world(&default_params()));
    let appoint = cmd("mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": "outside-system"}]));
    assert_eq!(said(outcome(&mut run, &appoint)), "not_theirs");
    assert_eq!(run.kernel().state().positions["clerk"].holder, None);
    // The city's own system is appointable.
    let own = cmd("mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": "finance-system"}]));
    assert_eq!(said(outcome(&mut run, &own)), "applied");
}

/// Finding 3, at load: a world whose post is held by another organisation's system does not load.
#[test]
fn f3_a_world_whose_post_is_held_by_anothers_system_does_not_load() {
    let mut c = world(&default_params());
    c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "clerk").unwrap()["holder"] = json!("outside-system");
    let err = Run::start(c, "fixes", Vec::new(), None).err().expect("loaded");
    assert!(format!("{err}").contains("belongs to"), "{err}");
}
