//! Services in the engine (docs/design/world-expansion.md 4.2): bodies have variables that work changes (teaching a
//! class raises skill); care shortens a condition and may call off a death due from it, once, and nobody is told which;
//! skill makes work quicker; and illness rises with a field where the body is.

mod common;

use common::*;
use serde_json::{json, Value};
use terrarium_kernel::events::{EventBody, RefusalCode};
use terrarium_kernel::run::Run;
use terrarium_kernel::Command;

const DAY: i64 = 86_400;

/// The test world, with skill on bodies (alice has some, carol a great deal), teaching and care as tasks done in a
/// workplace, and making goods quicker for the skilled.
fn services_world() -> Value {
    let mut w = world(&default_params());
    let cat = w["catalogue"].as_object_mut().unwrap();
    cat.insert("body_variables".into(), json!([{"id": "skill", "min": 0, "max": 10000, "initial": 0}]));
    let tasks = cat["tasks"].as_array_mut().unwrap();
    tasks.push(json!({"id": "teach", "labour": 3600, "in": "workplace", "on_body": {"changes": {"skill": 10}}}));
    tasks.push(json!({"id": "treat", "labour": 1800, "in": "workplace", "on_body": {"treats": [{"kind": "injury", "units": 2, "days_kept_bps": 5000, "fatal_kept_bps": 0}]}}));
    for t in tasks.iter_mut() {
        if t["id"] == "make" {
            t["labour_by"] = json!({"variable": "skill", "at_max_bps": 5000});
        }
    }
    for e in w["world"]["entities"].as_array_mut().unwrap() {
        match e["id"].as_str() {
            Some("alice") => e["variables"] = json!({"skill": 500}),
            Some("carol") => e["variables"] = json!({"skill": 10000}),
            _ => {}
        }
    }
    // Harm here is grave: it kills within 20 days, unless treated.
    w["life"]["harm"]["severity"] = json!([{"label": "grave", "share_bps": 10000, "days": [20, 20], "fatal_bps": 10000}]);
    w
}

fn start(w: &Value) -> Run<Vec<u8>> {
    Run::start(w.clone(), "services", Vec::new(), None).unwrap()
}

fn act(run: &mut Run<Vec<u8>>, participant: &str, position: Option<&str>, blocks: Value) -> Result<Vec<EventBody>, RefusalCode> {
    let cmd = direct(participant, position, serde_json::from_value(blocks).unwrap()).unwrap();
    let r = step(run, &cmd).unwrap();
    match &r.events[0].body {
        EventBody::ActionApplied { .. } => Ok(r.events.into_iter().map(|e| e.body).collect()),
        EventBody::ActionRefused { code, .. } => Err(*code),
        other => panic!("{other:?}"),
    }
}

fn advance(run: &mut Run<Vec<u8>>, to: i64) -> Vec<EventBody> {
    run.command(&Command::Advance { to }).unwrap().events.into_iter().map(|e| e.body).collect()
}

fn body_view(run: &mut Run<Vec<u8>>, participant: &str) -> Value {
    let o = run.command(&Command::Observe { participant: participant.into(), only: None }).unwrap().observation.unwrap();
    serde_json::to_value(&o).unwrap()["body"].clone()
}

#[test]
fn teaching_a_class_raises_the_skill_of_everyone_in_it() {
    let mut run = start(&services_world());
    // Alice goes to the shop (its dwelling, as a classroom); carol, at work there, teaches it for two hours.
    act(&mut run, "alice-self", None, json!([{"block": "occupy", "space": "s-shop/dwelling.1"}])).unwrap();
    let ev = act(&mut run, "carol-self", None, json!([{"block": "work", "task": "teach", "units": 2, "at": "s-shop", "performers": ["carol"], "on": "s-shop/dwelling.1"}])).unwrap();
    let changed: Vec<_> = ev.iter().filter_map(|e| match e { EventBody::BodyChanged { person, variable, value } => Some((person.as_str(), variable.as_str(), *value)), _ => None }).collect();
    assert_eq!(changed, vec![("alice", "skill", 520)]);
    // The teacher isn't taught by teaching; alice knows her own skill, and nobody else's.
    assert_eq!(body_view(&mut run, "alice-self")["variables"], json!({"skill": 520}));
    assert_eq!(body_view(&mut run, "carol-self")["variables"], json!({"skill": 10000}));
    // On a person directly: they must be there.
    act(&mut run, "carol-self", None, json!([{"block": "work", "task": "teach", "units": 1, "at": "s-shop", "performers": ["carol"], "on": "alice"}])).unwrap();
    assert_eq!(body_view(&mut run, "alice-self")["variables"], json!({"skill": 530}));
    assert_eq!(act(&mut run, "carol-self", None, json!([{"block": "work", "task": "teach", "units": 1, "at": "s-shop", "performers": ["carol"], "on": "bob"}])), Err(RefusalCode::NotPresent));
    // A task that does nothing to bodies, on a body; and one that does, on nobody.
    assert_eq!(act(&mut run, "carol-self", None, json!([{"block": "work", "task": "mend", "units": 1, "at": "s-shop", "performers": ["carol"], "on": "alice"}])), Err(RefusalCode::NoBodyEffect));
    assert_eq!(act(&mut run, "carol-self", None, json!([{"block": "work", "task": "teach", "units": 1, "at": "s-shop", "performers": ["carol"]}])), Err(RefusalCode::NoBodyEffect));
}

#[test]
fn care_calls_off_a_death_once_and_nobody_is_told() {
    // Untreated: harm kills alice within its 20 days.
    let mut run = start(&services_world());
    act(&mut run, "bob-self", None, json!([{"block": "harm", "person": "alice"}])).unwrap();
    let ev = advance(&mut run, 25 * DAY);
    assert!(ev.iter().any(|e| matches!(e, EventBody::PersonDied { person, .. } if person == "alice")));

    // Treated: she comes to the shop, and carol gives the care it takes (two units; one isn't enough).
    let mut run = start(&services_world());
    act(&mut run, "bob-self", None, json!([{"block": "harm", "person": "alice"}])).unwrap();
    act(&mut run, "alice-self", None, json!([{"block": "occupy", "space": "s-shop/dwelling.1"}])).unwrap();
    let little = act(&mut run, "carol-self", None, json!([{"block": "work", "task": "treat", "units": 1, "at": "s-shop", "performers": ["carol"], "on": "alice"}])).unwrap();
    assert!(!little.iter().any(|e| matches!(e, EventBody::ConditionTreated { .. })));
    let ev = act(&mut run, "carol-self", None, json!([{"block": "work", "task": "treat", "units": 2, "at": "s-shop", "performers": ["carol"], "on": "alice"}])).unwrap();
    let treated: Vec<_> = ev.iter().filter_map(|e| match e { EventBody::ConditionTreated { person, death_called_off, until, .. } => Some((person.clone(), *death_called_off, *until)), _ => None }).collect();
    assert_eq!(treated.len(), 1);
    assert!(treated[0].1, "the death is called off (fatal_kept_bps 0)");
    // It lasts half its remaining time: 10 days, not 20.
    let now = run.kernel().state().t;
    assert!(treated[0].2 <= now + 10 * DAY + 1 && treated[0].2 > now + 9 * DAY);
    // Alice knows it's been treated, and how long it will last, but not whether it would have killed her.
    let body = body_view(&mut run, "alice-self");
    assert_eq!(body["conditions"][0]["treated"], json!(true));
    assert!(!body.to_string().contains("death"));
    // More care does nothing more.
    let again = act(&mut run, "carol-self", None, json!([{"block": "work", "task": "treat", "units": 2, "at": "s-shop", "performers": ["carol"], "on": "alice"}])).unwrap();
    assert!(!again.iter().any(|e| matches!(e, EventBody::ConditionTreated { .. })));
    let ev = advance(&mut run, 25 * DAY);
    assert!(!ev.iter().any(|e| matches!(e, EventBody::PersonDied { person, .. } if person == "alice")));
    assert!(ev.iter().any(|e| matches!(e, EventBody::ConditionEnded { person, .. } if person == "alice")));
    assert!(run.kernel().state().body("alice").unwrap().conditions.is_empty());
}

#[test]
fn skill_makes_work_quicker() {
    let mut run = start(&services_world());
    // Carol (skill at the maximum) makes in half the time; the task's labour is 1,800 s a unit.
    let ev = act(&mut run, "developer-system", Some("developer"), json!([{"block": "work", "task": "make", "units": 2, "at": "s-shop", "performers": ["carol"]}])).unwrap();
    let labour = ev.iter().find_map(|e| match e { EventBody::Worked { labour, .. } => Some(*labour), _ => None }).unwrap();
    assert_eq!(labour, 1800);
    // Without skill on the task, the full time.
    let mut w = services_world();
    for t in w["catalogue"]["tasks"].as_array_mut().unwrap() {
        if t["id"] == "make" {
            t.as_object_mut().unwrap().remove("labour_by");
        }
    }
    let mut run = start(&w);
    let ev = act(&mut run, "developer-system", Some("developer"), json!([{"block": "work", "task": "make", "units": 2, "at": "s-shop", "performers": ["carol"]}])).unwrap();
    assert_eq!(ev.iter().find_map(|e| match e { EventBody::Worked { labour, .. } => Some(*labour), _ => None }), Some(3600));
}

#[test]
fn illness_rises_with_a_field_where_the_body_is() {
    // No illness but what pollution brings, and only the shop pollutes (it stays on its cell). Carol, at the shop all
    // year, falls ill; alice, at home, doesn't.
    let mut w = services_world();
    w["catalogue"]["fields"] = json!([{"id": "pollution", "min": 0, "max": 100, "from_structures": {"shop": 1}}]);
    w["life"]["illness"] = json!({"by_age": [{"from": 0, "bps": 0}], "severity": [{"label": "mild", "share_bps": 10000, "days": [3, 3], "fatal_bps": 0}], "fields": [{"field": "pollution", "bps_per_unit": 100}]});
    w["life"]["other_causes"] = json!({"by_age": [{"from": 0, "bps": 0}]});
    w["life"]["injury"]["bps"] = json!(0);
    let mut run = start(&w);
    let ev = advance(&mut run, 400 * DAY);
    let ill: Vec<&str> = ev.iter().filter_map(|e| match e { EventBody::ConditionBegan { person, kind, .. } if format!("{kind:?}") == "Illness" => Some(person.as_str()), _ => None }).collect();
    assert!(ill.contains(&"carol"), "{ill:?}");
    assert!(!ill.contains(&"alice"), "{ill:?}");
}
