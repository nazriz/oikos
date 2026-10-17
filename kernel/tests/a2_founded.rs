//! group.founded alone in the Rust world (docs/port-guide.md, section 4; lane A2): the founder's post of a founded group,
//! run inside the engine with every other code participant standing idle and a member's papers scripted. Same result on
//! one thread and on fourteen.

mod common;

use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

/// The call a person makes to ask to join (the call language, as the script says it).
fn application(_who: &str, account: &str) -> String {
    use oikos_actors::sight::calls::{program_text, Line, Program};
    use oikos_actors::steps::{arg, call, json, text};
    let c = call(
        "statement",
        vec![
            ("kind", Some(arg("membership_application"))),
            ("text", Some(text("I would like to join."))),
            ("to", Some(json(json!(["city"])))),
            ("data", Some(json(json!({ "account": account })))),
        ],
    );
    program_text(&Program::Lines(vec![Line { bind: None, call: c }]))
}

/// Riverbend with its inspector's post made the founder's post of a group (the group is the city's, for the test), and
/// Carol's participant a script that asks to join on day 3. The group takes dues, so it has an account at the bank.
fn world(shape: &str, lapse_days: i64) -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(60 * DAY);
    for p in c["positions"].as_array_mut().unwrap() {
        if p["id"] == "inspector" {
            p["role_module"] = json!({ "code": "group.founded" });
            p["keeps_record"] = json!(true);
            let ch = p["channels"].as_array_mut().unwrap();
            ch.push(json!({ "id": "mine", "kind": "records", "way": "mine", "match": {} }));
            ch.push(json!({ "id": "books", "kind": "accounts" }));
        }
    }
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "inspector-system" {
            p["controller"] = json!({ "type": "code", "impl": "group.founded", "params": {
                "founder": "alice", "shape": shape, "idea": "idea.alice.1", "name": "The Riverbend Circle", "purpose": "We meet, so that nobody has to carry it alone.",
                "want": { "about": "loss", "since": 0, "weight": 3000 }, "place": "s-house/dwelling.1", "bank": "bank", "founded_at": 0,
                "dues": [500], "every_days": [14], "starts_in_days": [7], "lasts_minutes": [90], "lapse_days": lapse_days } });
        }
        if p["id"] == "carol-self" {
            p["controller"] = json!({ "type": "code", "impl": "stub.script", "params": { "script": [
                { "at": 3 * DAY, "call": application("carol", "acc-carol") } ] } });
        }
    }
    common::alone(&mut c, &["group.founded"]);
    c
}

fn opts(threads: usize) -> EngineOptions {
    EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, ..Default::default() }
}

fn lines(log: &[u8]) -> Vec<Value> {
    log.split(|b| *b == b'\n').filter(|l| !l.is_empty()).map(|l| serde_json::from_slice(l).unwrap()).collect()
}

fn recorded(log: &[Value]) -> Vec<&Value> {
    log.iter().filter(|l| l["kind"] == "event" && l["body"]["event"] == "recorded").map(|l| &l["body"]["record"]).collect()
}

#[test]
fn a_founded_group_sets_itself_up_offers_membership_to_whoever_applies_and_winds_up_when_nobody_joins() {
    let (_, e) = run_code_world(world("gathering", 20), "founded", Vec::new(), opts(4)).unwrap();
    let log = lines(&e.into_log());
    let all = recorded(&log);
    let mine: Vec<&&Value> = all.iter().filter(|r| r["speaks_for"] == "city").collect();
    let kinds: Vec<&str> = mine.iter().filter_map(|r| r["kind"].as_str()).collect();
    assert_eq!(&kinds[..3], ["purpose", "notice", "membership"], "what it is for, the gathering, membership: {kinds:?}");
    let purpose = mine[0];
    assert_eq!(purpose["visible_to"], "public");
    assert_eq!(purpose["data"]["written_by"], "code");
    assert_eq!(purpose["assertion"]["that"], "We meet, so that nobody has to carry it alone.");
    let notice = mine[1];
    assert_eq!(notice["practice"]["at"], "s-house/dwelling.1");
    assert_eq!(notice["practice"]["every"], 14 * DAY);
    let membership = mine[2];
    assert_eq!(membership["offer"]["take_up"], "join");
    assert_eq!(membership["offer"]["terms"]["commitments"][0]["does"]["outcome"]["money"]["to"], "acc-city", "dues are paid into its own account");
    assert_eq!(membership["data"]["dues"], 500);
    // It takes Carol's application in and offers her the agreement that makes her a member, on its terms.
    let offered: Vec<&&Value> = all.iter().filter(|r| r["record"] == "agreement" && r["terms"]["template"] == "membership").collect();
    assert_eq!(offered.len(), 1, "one offer, once: {offered:?}");
    assert_eq!(offered[0]["terms"]["parties"], json!(["city", "carol"]));
    // Nobody signs, so it winds up after `lapse_days`, taking its offers down and saying so.
    assert!(kinds.contains(&"wound_up"), "{kinds:?}");
    let wound = mine.iter().find(|r| r["kind"] == "wound_up").unwrap();
    assert_eq!(wound["text"], "The Riverbend Circle has wound up: too few came.");
    let withdrawn = all.iter().filter(|r| r["record"] == "withdrawal" && r["speaks_for"] == "city").count();
    assert_eq!(withdrawn, 2, "its offer of membership and its gathering");
    // The log says which kinds ran, stand-ins too, and the group's version.
    let orch = log.iter().find(|l| l["body"]["annotation"] == "orchestrator").unwrap();
    assert_eq!(orch["body"]["data"]["modules"]["group.founded"]["version"], "0.2.1");
    // Its record of itself reached the kernel, which holds it (at setting up, and again as it changed, to the winding up).
    let kept = log.iter().filter(|l| l["body"]["event"] == "entity_recorded" && l["body"]["entity"] == "city").count();
    assert!(kept >= 3, "the record was written {kept} times");
}

#[test]
fn the_same_founded_group_on_one_thread_and_on_fourteen_is_the_same_world() {
    let run = |threads| {
        let (hash, e) = run_code_world(world("gathering", 20), "threads", Vec::new(), opts(threads)).unwrap();
        (hash, e.into_log())
    };
    let (h1, l1) = run(1);
    let (h14, l14) = run(14);
    assert_eq!(h1, h14);
    assert!(l1 == l14, "the logs are byte for byte the same");
    // And a body that takes grievances up (a daily cadence, a hearing and an hours bank) is the same too.
    let cause = |threads| run_code_world(world("cause", 20), "cause", Vec::new(), opts(threads)).unwrap().0;
    assert_eq!(cause(1), cause(14));
}

#[test]
fn the_founded_manifest_is_the_one_the_ts_module_wrote() {
    let ts: Value = serde_json::from_slice(&std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../participants/manifests/group.founded.json")).unwrap()).unwrap();
    let rust = oikos_actors::registry::find("group.founded").unwrap().manifest();
    for (k, v) in ts.as_object().unwrap() {
        assert_eq!(&rust[k], v, "{k}");
    }
}

#[test]
fn the_founded_memory_saves_and_the_saved_group_steps_as_the_original() {
    let mut e = oikos_kernel::engine::Engine::start(world("gathering", 20), "save", Vec::new(), None, EngineOptions { until: Some(5 * DAY), ..opts(1) }).unwrap();
    while let oikos_kernel::engine::Due::Seats(seats) = e.next().unwrap() {
        for s in seats {
            e.submit(&s.key, oikos_actors::sight::Action::wait()).unwrap();
        }
    }
    let saved = e.save_actors().unwrap();
    let group = &saved["inspector-system|inspector"];
    assert_eq!(group["kind"], "group.founded");
    let kind = oikos_actors::registry::find("group.founded").unwrap();
    let ctx = oikos_actors::Ctx {
        participant: "inspector-system".into(),
        performer: Default::default(),
        entity: "city".into(),
        position: Some("inspector".into()),
        params: Default::default(),
        world: Default::default(),
    };
    let back = kind.restore(&ctx, group["actor"].clone()).unwrap();
    assert_eq!(back.save().unwrap(), group["actor"]);
}
