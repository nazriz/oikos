//! Services in the engine (docs/design/world-expansion.md 4.2): bodies have variables that work changes (teaching a
//! class raises skill); care shortens a condition and may call off a death due from it, once, and nobody is told which;
//! skill makes work quicker; and illness rises with a field where the body is.

use crate::common;

use common::*;
use serde_json::{json, Value};
use oikos_kernel::events::{EventBody, RefusalCode};
use oikos_kernel::run::Run;
use oikos_kernel::Command;

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
    let treated: Vec<_> = ev.iter().filter_map(|e| match e { EventBody::ConditionTreated { person, death_called_off, until, .. } => Some((*person, *death_called_off, *until)), _ => None }).collect();
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

/// Whether care saves a life is the condition's own draw (who, what, since when), never the number it was filed under:
/// that number is its place among every condition in town, so keyed on it one more injury anywhere would change who
/// dies, and a pilot would part from its twin (docs/reliability.md, "Draws and the order papers were filed in"). Alice
/// is hurt and treated in two towns alike but for one more injury, to bob, filed before hers in the second; on every
/// seed care keeps or calls off her death alike in both.
#[test]
fn care_draws_on_the_condition_not_its_number() {
    let outcome = |seed: u64, other_first: bool| -> (bool, String) {
        let mut w = services_world();
        w["seed"] = json!(seed);
        for t in w["catalogue"]["tasks"].as_array_mut().unwrap() {
            if t["id"] == "treat" {
                t["on_body"]["treats"][0]["fatal_kept_bps"] = json!(5000);
            }
        }
        let mut run = start(&w);
        if other_first {
            act(&mut run, "alice-self", None, json!([{"block": "harm", "person": "bob"}])).unwrap();
        }
        // (Alice is hurt at the same moment in both towns: the condition's onset is part of what it is.)
        advance(&mut run, DAY);
        let ev = act(&mut run, "bob-self", None, json!([{"block": "harm", "person": "alice"}])).unwrap();
        let id = ev.iter().find_map(|e| match e { EventBody::ConditionBegan { person, condition, .. } if person == "alice" => Some(*condition), _ => None }).unwrap();
        act(&mut run, "alice-self", None, json!([{"block": "occupy", "space": "s-shop/dwelling.1"}])).unwrap();
        let ev = act(&mut run, "carol-self", None, json!([{"block": "work", "task": "treat", "units": 2, "at": "s-shop", "performers": ["carol"], "on": "alice"}])).unwrap();
        let off = ev.iter().find_map(|e| match e { EventBody::ConditionTreated { person, death_called_off, .. } if person == "alice" => Some(*death_called_off), _ => None }).unwrap();
        (off, id.to_string())
    };
    let mut kept = 0;
    for seed in 1..=16 {
        let (alone, id_alone) = outcome(seed, false);
        let (after, id_after) = outcome(seed, true);
        assert_ne!(id_alone, id_after, "the second town files her condition under another number");
        assert_eq!(alone, after, "seed {seed}: one more injury elsewhere changed whether care saved alice");
        kept += usize::from(!alone);
    }
    // (At 5,000 basis points both outcomes happen across the seeds: the draw is a draw, not a constant.)
    assert!(kept > 0 && kept < 16, "{kept} of 16 kept");
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

#[test]
fn a_condition_kills_by_the_bodys_age() {
    // Alice is 30. A grave harm that kills from 30 on kills her; one that kills only from 31, doesn't.
    for (from, dies) in [(30, true), (31, false)] {
        let mut w = services_world();
        w["life"]["harm"]["severity"] = json!([{"label": "grave", "share_bps": 10000, "days": [20, 20], "fatal_bps": 0,
            "fatal_by_age": [{"from": 0, "bps": 0}, {"from": from, "bps": 10000}]}]);
        let mut run = start(&w);
        act(&mut run, "bob-self", None, json!([{"block": "harm", "person": "alice"}])).unwrap();
        let ev = advance(&mut run, 25 * DAY);
        assert_eq!(ev.iter().any(|e| matches!(e, EventBody::PersonDied { person, .. } if person == "alice")), dies, "fatal from {from}");
    }
}

#[test]
fn a_body_is_in_one_place_and_going_somewhere_takes_the_trip() {
    // A minute a cell; water ten.
    let mut w = services_world();
    w["catalogue"]["travel"] = json!({"seconds_per_cell": 60, "by_cover": {"water": 600}});
    let mut run = start(&w);
    let now = run.kernel().state().t;
    // Alice at home (cell.1.1) goes to the shop (cell.0.2): two cells, two minutes on top of the act itself.
    let cmd = direct("alice-self", None, serde_json::from_value(json!([{"block": "occupy", "space": "s-shop/dwelling.1"}])).unwrap()).unwrap();
    let r = step(&mut run, &cmd).unwrap();
    let (starts, done) = r.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { starts, done, .. } => Some((*starts, *done)), _ => None }).unwrap();
    let mut still = start(&services_world());
    let r0 = step(&mut still, &cmd).unwrap();
    let base = r0.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { starts, done, .. } => Some(done - starts), _ => None }).unwrap();
    assert_eq!(done - starts, base + 120);
    assert!(starts >= now);
    // Arrived: in the shop, and no longer at home.
    // (The helper carries the act through to when it's done.)
    advance(&mut run, done + 1);
    assert!(r.events.iter().map(|e| &e.body).any(|e| matches!(e, EventBody::Vacated { occupant, space, .. } if occupant == "alice" && space == "s-house/dwelling.1")));
    let st = run.kernel().state();
    assert_eq!(st.structures_of("alice"), vec![oikos_kernel::blocks::Id::new("s-shop")]);
    assert_eq!(body_view(&mut run, "alice-self")["in"], json!("s-shop/dwelling.1"));
}

#[test]
fn goods_are_taken_and_investigation_finds_the_taker_with_its_chance() {
    let mut w = services_world();
    w["catalogue"]["tasks"].as_array_mut().unwrap().push(json!({"id": "investigate", "labour": 600, "in": "workplace", "investigates": true, "detection_bps": 10000}));
    w["catalogue"]["tasks"].as_array_mut().unwrap().push(json!({"id": "look_around", "labour": 600, "in": "workplace", "investigates": true, "detection_bps": 0}));
    let mut run = start(&w);
    // Not there: refused. There (bob comes in): taken, and the holding moved.
    assert_eq!(act(&mut run, "bob-self", None, json!([{"block": "take", "kind": "goods", "quantity": "3", "from": "alice", "at": "s-house"}])), Err(RefusalCode::NotPresent));
    act(&mut run, "bob-self", None, json!([{"block": "occupy", "space": "s-house/dwelling.1"}])).unwrap();
    let ev = act(&mut run, "bob-self", None, json!([{"block": "take", "kind": "goods", "quantity": "3", "from": "alice", "at": "s-house"}])).unwrap();
    assert!(ev.iter().any(|e| matches!(e, EventBody::Taken { by, from, .. } if by == "bob" && from == "alice")));
    let st = run.kernel().state();
    assert_eq!(st.holding("alice", "s-house", "goods"), 7);
    assert_eq!(st.holding("bob", "s-house", "goods"), 3);
    assert_eq!(act(&mut run, "bob-self", None, json!([{"block": "take", "kind": "goods", "quantity": "30", "from": "alice", "at": "s-house"}])), Err(RefusalCode::InsufficientQuantity));
    // Investigation: work that finds the taker (here, surely), told to the investigator only.
    let found = |run: &mut Run<Vec<u8>>, task: &str| {
        let cmd = direct("carol-self", None, serde_json::from_value(json!([{"block": "work", "task": task, "units": 1, "at": "s-shop", "performers": ["carol"], "investigate": {"from": "alice", "at": "s-house", "kind": "goods"}}])).unwrap()).unwrap();
        step(run, &cmd).unwrap();
        let o = run.command(&Command::Observe { participant: "carol-self".into(), only: None }).unwrap().observation.unwrap();
        serde_json::to_value(&o).unwrap()["outcomes"].as_array().unwrap().last().unwrap()["investigated"].clone()
    };
    assert_eq!(found(&mut run, "investigate")["taker"], json!("bob"));
    assert_eq!(found(&mut run, "look_around")["taker"], json!(null));
    assert_eq!(found(&mut run, "look_around")["taken"], json!(true));
    // Not an investigation: refused.
    assert_eq!(act(&mut run, "carol-self", None, json!([{"block": "work", "task": "mend", "units": 1, "at": "s-shop", "performers": ["carol"], "investigate": {"from": "alice", "at": "s-house", "kind": "goods"}}])), Err(RefusalCode::BadInvestigation));
}

/// Two investigations in one action are two tries, each with its own draw: keyed by the block as well as who asked, what
/// about and the day. (Until 2026-10-05 they shared the action's one draw: both found the taker, or neither. Until
/// 2026-10-12 the key was the action's number, which moves with every act anyone makes.)
#[test]
fn two_investigations_in_one_action_draw_independently() {
    let mut w = services_world();
    w["catalogue"]["tasks"].as_array_mut().unwrap().push(json!({"id": "ask_around", "labour": 600, "in": "workplace", "investigates": true, "detection_bps": 5000}));
    let mut run = start(&w);
    act(&mut run, "bob-self", None, json!([{"block": "occupy", "space": "s-house/dwelling.1"}])).unwrap();
    act(&mut run, "bob-self", None, json!([{"block": "take", "kind": "goods", "quantity": "3", "from": "alice", "at": "s-house"}])).unwrap();
    let ask = json!({"block": "work", "task": "ask_around", "units": 1, "at": "s-shop", "performers": ["carol"], "investigate": {"from": "alice", "at": "s-house", "kind": "goods"}});
    let (mut differ, mut found_some, mut found_none) = (0, 0, 0);
    for day in 1..=24 {
        advance(&mut run, day * DAY);
        let cmd = direct("carol-self", None, serde_json::from_value(json!([ask.clone(), ask.clone()])).unwrap()).unwrap();
        step(&mut run, &cmd).unwrap();
        let o = run.command(&Command::Observe { participant: "carol-self".into(), only: None }).unwrap().observation.unwrap();
        let o = serde_json::to_value(&o).unwrap();
        let outcome = o["outcomes"].as_array().unwrap().last().unwrap().clone();
        let action = outcome["action"].as_str().unwrap();
        // Each block's own draw: the taker is found with the task's chance, 5,000 in 10,000.
        let day = (run.kernel().state().t / DAY).to_string();
        let finds = |index: &str| run.kernel().statics().randomness.stream(&["investigate", "carol-self", "alice", "s-house", "goods", &day, index]).below(10_000) < 5_000;
        let (first, second) = (finds("0"), finds("1"));
        // The outcome carries the action's last investigation: the second block's.
        assert_eq!(outcome["investigated"]["taker"], if second { json!("bob") } else { json!(null) }, "day {day}, {action}");
        differ += usize::from(first != second);
        found_some += usize::from(second);
        found_none += usize::from(!second);
    }
    assert!(differ > 0 && found_some > 0 && found_none > 0, "the two tries differ on some days ({differ}), and each way happens ({found_some}, {found_none})");
}

/// A practised skill (foundations-2 E4): the world's craft, ordinary at 5,000 (the stated time), twice as slow at none,
/// half the time at the most; an hour's use closes a tenth of the gap to the most; unused, the part above 2,000 halves
/// every 100 days.
fn practised_world() -> Value {
    let mut w = services_world();
    w["catalogue"]["body_variables"].as_array_mut().unwrap().push(json!({"id": "craft", "min": 0, "max": 10000, "initial": 5000,
        "practice": {"gain_bps_per_hour": 1000, "half_life_days": 100, "floor": 2000}}));
    for t in w["catalogue"]["tasks"].as_array_mut().unwrap() {
        if t["id"] == "make" {
            t.as_object_mut().unwrap().remove("labour_by");
            t["skill"] = json!({"variable": "craft", "novice_bps": 20000, "expert_bps": 5000});
        }
    }
    w["catalogue"]["act_skills"] = json!([{"act": "message", "variable": "craft", "novice_bps": 20000, "expert_bps": 5000}]);
    w["orchestration"]["act_time"]["person"] = json!({"message": 600});
    w
}

fn craft(run: &Run<Vec<u8>>, who: &str) -> (i64, i64) {
    run.kernel().state().body(who).unwrap().variables[&oikos_kernel::blocks::Id::new("craft")]
}

fn labour_of(ev: &[EventBody]) -> i64 {
    ev.iter().find_map(|e| match e { EventBody::Worked { labour, .. } => Some(*labour), _ => None }).unwrap()
}

#[test]
fn a_practised_skill_grows_with_use_and_fades_without_it() {
    let w = practised_world();
    let mut run = start(&w);
    let make = json!([{"block": "work", "task": "make", "units": 2, "at": "s-shop", "performers": ["carol"]}]);
    // An ordinary hand takes the stated time, and the hour is practice: a tenth of the 5,000 still to learn.
    let ev = act(&mut run, "developer-system", Some("developer"), make.clone()).unwrap();
    assert_eq!(labour_of(&ev), 3600);
    assert_eq!(craft(&run, "carol").0, 5500);
    // Quicker for it (a tenth of the way to half the time: 95%), and practised again, by less (diminishing returns).
    let ev = act(&mut run, "developer-system", Some("developer"), make.clone()).unwrap();
    assert_eq!(labour_of(&ev), 3420);
    let v = craft(&run, "carol").0;
    assert_eq!(v, 5500 + 4500 * 1000 * 3420 / (10_000 * 3600));
    // A hundred days unused: the part above the floor halved, read as it stands (nothing is written until it is used).
    let t = run.kernel().state().t;
    advance(&mut run, t + 100 * DAY);
    let cfg = run.kernel().statics().config.catalogue.body_variables[1].clone();
    let stored = craft(&run, "carol");
    assert_eq!(stored.0, v, "fading is read, not written each day");
    let faded = 2000 + (v - 2000) / 2;
    assert_eq!(oikos_kernel::state::body_variable_at(&cfg, stored, stored.1 + 100 * DAY).0, faded);
    // Years without it: never below the floor.
    assert_eq!(oikos_kernel::state::body_variable_at(&cfg, stored, stored.1 + 20_000 * DAY).0, 2000);
    // ... and work is slower for it: below the ordinary hand, toward the novice's double time.
    let now = run.kernel().state().t;
    let at_now = oikos_kernel::state::body_variable_at(&cfg, stored, now).0;
    assert!(at_now <= faded + 1 && at_now < 5000);
    let ev = act(&mut run, "developer-system", Some("developer"), make.clone()).unwrap();
    assert_eq!(labour_of(&ev), (3600 * (20_000 - 10_000 * at_now / 5000) + 9_999) / 10_000);

    // An act with a skill: a person's time for it is scaled as work is, and doing it is practice.
    let took = |run: &mut Run<Vec<u8>>| {
        let cmd = direct("alice-self", None, serde_json::from_value(json!([{"block": "message", "to": ["bob-self"], "text": "hi"}])).unwrap()).unwrap();
        let r = step(run, &cmd).unwrap();
        r.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { starts, done, .. } => Some(done - starts), _ => None }).unwrap()
    };
    let mut w2 = w.clone();
    for e in w2["world"]["entities"].as_array_mut().unwrap() {
        if e["id"] == "alice" {
            e["variables"] = json!({"craft": 0});
        }
    }
    let mut run = start(&w2);
    assert_eq!(took(&mut run), 1200, "a novice takes twice the table's ten minutes");
    assert_eq!(craft(&run, "alice").0, 10_000 * 1000 * 1200 / (10_000 * 3600));
    // Without the act's skill, the table's time, and no practice.
    let mut w3 = w2.clone();
    w3["catalogue"].as_object_mut().unwrap().remove("act_skills");
    let mut run = start(&w3);
    assert_eq!(took(&mut run), 600);
    assert_eq!(craft(&run, "alice").0, 0);
}

#[test]
fn a_skill_is_named_only_on_a_practised_variable() {
    let mut w = practised_world();
    w["catalogue"]["act_skills"][0]["variable"] = json!("skill");
    assert!(Run::start(w, "services", Vec::new(), None).is_err(), "schooling is no practised skill");
    let mut w = practised_world();
    w["catalogue"]["body_variables"][1]["per_day"] = json!(1);
    assert!(Run::start(w, "services", Vec::new(), None).is_err(), "a skill fades by its half-life, not a drift as well");
}
