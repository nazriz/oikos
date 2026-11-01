//! police.station: the kind in a small world of the engine (docs/port-guide.md, section 4): the inspector's seat is replaced by
//! the kind under test, a citizen by a script, every other kind idle; run on 1 thread and on 14, the same hash.

use crate::common;

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
    json!({ "building": "s-shop", "workplace": "s-shop/workplace.1", "account": "acc-city", "officers": 1, "wage": 380000, "tribunal": "city", "registry": "city", "calls_channel": "premises" })
}

#[test]
fn the_station_posts_a_job_for_its_establishment_and_answers_a_welfare_check_without_a_home_to_go_to() {
    let script = json!([{ "at": 3600, "call": "statement(kind=welfare_check_request, text=\"Nobody has come out of number 4.\", to=[\"city\"], data={\"space\": \"s-house/dwelling.1\", \"structure\": \"s-house\", \"since\": 0})" }]);
    let config = world("police.station", params(), script, 20);
    let (_, log) = run(&config, 1);
    let ads = statements(&log, "job_posting");
    assert_eq!(ads.len(), 1, "one post to fill, one advertisement");
    assert_eq!(ads[0]["speaks_for"], "city");
    let orch = log.iter().find(|l| l["body"]["annotation"] == "orchestrator").unwrap();
    assert!(orch["body"]["data"]["modules"]["police.station"].is_object());
}

#[test]
fn the_station_runs_the_same_on_one_thread_and_on_fourteen() {
    same_on_any_threads(&world("police.station", params(), json!([]), 15));
}
