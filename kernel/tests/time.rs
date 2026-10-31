//! Acting costs time (docs/design/rebuild.md 6.2, 6.3): an act takes its actor the world's act time, after any
//! thinking; a person does one thing at a time, in whatever capacity; a system as many at once as it has lanes; and an
//! act takes effect when it's done, not when it's begun.

mod common;

use common::*;
use serde_json::{json, Value};
use oikos_kernel::events::EventBody;
use oikos_kernel::kernel::Command;
use oikos_kernel::run::Run;

fn act(participant: &str, position: Option<&str>, blocks: Value, thinking: Option<i64>) -> Command {
    Command::Act {
        participant: participant.into(),
        position: position.map(Into::into),
        blocks: serde_json::from_value(blocks).unwrap(),
        by: vec![],
        provenance: json!({"via": "direct"}),
        reasoning: None,
        thinking,
    }
}

/// When the act begun by this command starts, and when it's done.
fn begun(run: &mut Run<Vec<u8>>, cmd: &Command) -> (i64, i64) {
    let r = run.command(cmd).unwrap();
    match &r.events[0].body {
        EventBody::ActionStarted { starts, done, .. } => (*starts, *done),
        other => panic!("{other:?}"),
    }
}

fn pay(amount: u32) -> Value {
    json!([{"block": "transfer", "from": "acc-city", "to": "acc-alice", "amount": amount.to_string()}])
}

fn balance(run: &Run<Vec<u8>>, acc: &str) -> i128 {
    run.kernel().state().accounts[acc].balance
}

#[test]
fn an_act_takes_effect_when_done() {
    let mut config = riverbend();
    config["orchestration"]["act_time"] = json!({"default": 1, "system": { "transfer": 5 }, "person": { "message": 120 } });
    let mut run = Run::start(config, "time", Vec::new(), None).unwrap();
    let before = balance(&run, "acc-alice");
    assert_eq!(begun(&mut run, &act("bank-payments-system", Some("bank-payments"), pay(100), None)), (0, 5));
    // Begun, not done: nothing has moved yet.
    assert_eq!(balance(&run, "acc-alice"), before);
    let r = run.command(&Command::Advance { to: 5 }).unwrap();
    assert!(r.events.iter().any(|e| matches!(e.body, EventBody::ActionApplied { .. })));
    assert_eq!(balance(&run, "acc-alice"), before + 100);
    // The world's table, by the actor's kind: a person's message takes two minutes.
    assert_eq!(begun(&mut run, &act("alice-self", None, json!([{"block": "message", "to": ["bob-self"], "text": "hi"}]), None)), (5, 125));
}

#[test]
fn a_person_does_one_thing_at_a_time_and_thinking_comes_first() {
    let mut run = Run::start(riverbend(), "time", Vec::new(), None).unwrap();
    let msg = json!([{"block": "message", "to": ["bob-self"], "text": "hi"}]);
    assert_eq!(begun(&mut run, &act("alice-self", None, msg.clone(), None)), (0, 1));
    // Busy until 1: the next starts then.
    assert_eq!(begun(&mut run, &act("alice-self", None, msg.clone(), None)), (1, 2));
    // Thinking first: ready at 30, and it starts then.
    assert_eq!(begun(&mut run, &act("alice-self", None, msg.clone(), Some(30))), (30, 31));
    // Someone else isn't held up.
    assert_eq!(begun(&mut run, &act("bob-self", None, msg, None)), (0, 1));
}

#[test]
fn a_system_carries_out_as_many_at_once_as_it_has_lanes() {
    let mut config = riverbend();
    for p in config["participants"].as_array_mut().unwrap() {
        if p["id"] == "bank-payments-system" {
            p["lanes"] = json!(2);
        }
    }
    let mut run = Run::start(config, "time", Vec::new(), None).unwrap();
    let a = act("bank-payments-system", Some("bank-payments"), pay(1), None);
    assert_eq!(begun(&mut run, &a), (0, 1));
    assert_eq!(begun(&mut run, &a), (0, 1));
    assert_eq!(begun(&mut run, &a), (1, 2));
    let before = balance(&run, "acc-alice");
    run.command(&Command::Advance { to: 2 }).unwrap();
    assert_eq!(balance(&run, "acc-alice"), before + 3);
}

/// A system part-way through its lanes (it has acted fewer times than it has lanes): the lanes it hasn't used are free
/// now, and the state says so in numbers the contracts allow, so it can be hashed and checkpointed. (Until 2026-10-05
/// an unused lane was the smallest 64-bit integer, which canonical JSON refuses.)
#[test]
fn a_system_part_way_through_its_lanes_can_be_hashed_and_checkpointed() {
    let mut config = riverbend();
    for p in config["participants"].as_array_mut().unwrap() {
        if p["id"] == "bank-payments-system" {
            p["lanes"] = json!(3);
        }
    }
    let mut run = Run::start(config, "time", Vec::new(), None).unwrap();
    let a = act("bank-payments-system", Some("bank-payments"), pay(1), None);
    assert_eq!(begun(&mut run, &a), (0, 1));
    // One lane used of three.
    run.kernel().state_hash().expect("the state hashes with lanes unused");
    for lane in run.kernel().state().timelines.values().flatten() {
        assert!((-oikos_kernel::canon::MAX_SAFE..=oikos_kernel::canon::MAX_SAFE).contains(lane), "a lane's time {lane} is outside the contracts' integers");
    }
    run.command(&Command::Advance { to: 1 }).unwrap();
    assert_eq!(begun(&mut run, &a), (1, 2));
    run.kernel().state_hash().expect("the state hashes with two lanes used of three");
    // The lane choice is as before: an unused lane first, then the one that frees first.
    assert_eq!(begun(&mut run, &a), (1, 2));
    assert_eq!(begun(&mut run, &a), (1, 2));
    assert_eq!(begun(&mut run, &a), (2, 3));
    // A checkpoint (a finished run records the state's hash) and a replay to the same state.
    run.finish("completed", None).expect("the run finishes with its state hashed");
    oikos_kernel::replay(&run.into_log(), None).expect("the log replays to the same state");
}

/// The same, checkpointed and finished while lanes are still unused.
#[test]
fn a_run_ends_and_replays_with_lanes_unused() {
    let mut config = riverbend();
    for p in config["participants"].as_array_mut().unwrap() {
        if p["id"] == "bank-payments-system" {
            p["lanes"] = json!(4);
        }
    }
    let mut run = Run::start(config, "time", Vec::new(), None).unwrap();
    let a = act("bank-payments-system", Some("bank-payments"), pay(1), None);
    assert_eq!(begun(&mut run, &a), (0, 1));
    assert_eq!(begun(&mut run, &a), (0, 1));
    // Far enough for the run's own checkpoints to be written on the way.
    run.command(&Command::Advance { to: 40 * 86_400 }).expect("time advances past a checkpoint with lanes unused");
    run.finish("completed", None).expect("the run finishes with lanes unused");
    oikos_kernel::replay(&run.into_log(), None).expect("the log replays to the same state");
}
