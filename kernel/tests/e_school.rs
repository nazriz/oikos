//! school.principal: the kind in a small world of the engine (docs/port-guide.md, section 4): the inspector's seat is replaced by
//! the kind under test, a citizen by a script, every other kind idle; run on 1 thread and on 14, the same hash.

mod common;

use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

fn opts(threads: usize) -> EngineOptions {
    EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, ..Default::default() }
}

fn lines(log: &[u8]) -> Vec<Value> {
    log.split(|b| *b == b'\n').filter(|l| !l.is_empty()).map(|l| serde_json::from_slice(l).unwrap()).collect()
}

/// Riverbend with the inspector's seat given to `kind` (the office of the city), its channels widened to what an office
/// reads (its own file, its accounts, the premises), and alice's participant given a script.
fn world(kind: &str, params: Value, script: Value, days: i64) -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(days * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "inspector-system" {
            p["controller"] = json!({ "type": "code", "impl": kind, "params": params });
        }
        if p["controller"]["impl"] != "citizen.default" && p["id"] != "inspector-system" && p["controller"]["type"] == "code" {
            p["controller"] = json!({ "type": "code", "impl": "idle" });
        }
        if p["id"] == "alice-self" {
            p["controller"] = json!({ "type": "code", "impl": "stub.script", "params": { "script": script } });
        }
    }
    for p in c["positions"].as_array_mut().unwrap() {
        if p["id"] == "inspector" {
            let ch = p["channels"].as_array_mut().unwrap();
            ch.push(json!({ "id": "mine", "kind": "records", "way": "mine", "match": {} }));
            ch.push(json!({ "id": "books", "kind": "accounts" }));
            ch.push(json!({ "id": "premises", "kind": "sites", "way": "here", "area": { "near": 1 } }));
            ch.push(json!({ "id": "holdings", "kind": "holdings" }));
        }
    }
    c
}

fn run(config: &Value, threads: usize) -> (String, Vec<Value>) {
    let (hash, e) = run_code_world(config.clone(), "e", Vec::new(), opts(threads)).unwrap();
    (hash, lines(&e.into_log()))
}

fn statements<'a>(log: &'a [Value], kind: &str) -> Vec<&'a Value> {
    log.iter().filter(|l| l["kind"] == "event" && l["body"]["event"] == "recorded" && l["body"]["record"]["kind"] == kind).map(|l| &l["body"]["record"]).collect()
}

fn same_on_any_threads(config: &Value) {
    let (h1, l1) = run(config, 1);
    let (h14, l14) = run(config, 14);
    assert_eq!(h1, h14);
    assert_eq!(l1, l14);
}

fn params() -> Value {
    json!({ "building": "s-shop", "workplace": "s-shop/workplace.1", "account": "acc-city", "teachers": 1, "wage": 300000, "classrooms": ["s-apts/dwelling.1"], "school_ages": [0, 60] })
}

#[test]
fn the_school_posts_a_job_and_gives_a_place_to_a_child_who_asks() {
    let script = json!([{ "at": 3600, "call": "statement(kind=school_enrolment, text=\"A place, please.\", to=[\"city\"], data={\"born_at\": -946080000, \"years_before\": 0})" }]);
    let config = world("school.principal", params(), script, 12);
    let (_, log) = run(&config, 1);
    assert_eq!(statements(&log, "job_posting").len(), 1);
    let places = statements(&log, "school_place");
    assert_eq!(places.len(), 1, "{:?}", statements(&log, "school_decline"));
    assert_eq!(places[0]["data"]["classroom"], "s-apts/dwelling.1");
}

#[test]
fn the_school_runs_the_same_on_one_thread_and_on_fourteen() {
    same_on_any_threads(&world("school.principal", params(), json!([]), 15));
}
