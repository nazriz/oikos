//! The planning officer in a small world (docs/port-guide.md, section 4): the developer's application scripted, every
//! other actor idle; with and without a planning procedure stated by the town; the same world on 1 and 14 threads.

use crate::common;

use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

fn world(procedure: bool) -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(60 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        match p["id"].as_str().unwrap() {
            "planning-system" => p["controller"] = json!({ "type": "code", "impl": "city.planning_officer" }),
            "developer-system" => {
                p["controller"] = json!({ "type": "code", "impl": "stub.script", "params": { "script": [
                    { "at": 3600, "call": "statement(kind=permit_application, text=\"Application to build.\", to=[\"city\"], data={\"lot\":\"lot-1\",\"structure_type\":\"house\"})" },
                ] } })
            }
            "mayor-system" if procedure => {
                p["controller"] = json!({ "type": "code", "impl": "stub.script", "params": { "script": [
                    { "at": 60, "call": "statement(kind=procedure, text=\"How the planning office decides.\", visible=public, data={\"planning\":{\"notice_days\":10,\"decide_within_days\":40}})" },
                ] } })
            }
            _ => {
                if p["controller"]["type"] == "code" {
                    p["controller"] = json!({ "type": "code", "impl": "idle" });
                }
            }
        }
    }
    c
}

fn records(log: &[u8]) -> Vec<Value> {
    log.split(|b| *b == b'\n')
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_slice::<Value>(l).unwrap())
        .filter(|l| l["kind"] == "event" && l["body"]["event"] == "recorded")
        .map(|l| l["body"]["record"].clone())
        .collect()
}

fn run(procedure: bool, threads: usize) -> (String, Vec<Value>) {
    let opts = EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, ..Default::default() };
    let (hash, e) = run_code_world(world(procedure), "e-planning", Vec::new(), opts).unwrap();
    (format!("{hash:?}"), records(&e.into_log()))
}

#[test]
fn with_no_procedure_an_application_is_granted_at_the_next_round_with_the_liberty_to_build() {
    let (_, recs) = run(false, 4);
    let d = recs.iter().find(|r| r["kind"] == "permit_decision").expect("a decision");
    assert_eq!(d["data"]["decision"], "granted");
    assert!(recs.iter().any(|r| r["record"] == "claim" && r["position"] == "liberty" && r["about"]["action"] == "build"));
    assert!(!recs.iter().any(|r| r["kind"] == "permit_notice"));
}

#[test]
fn with_a_procedure_the_application_is_noticed_first_and_decided_after_the_period() {
    let (_, recs) = run(true, 4);
    let notice = recs.iter().find(|r| r["kind"] == "permit_notice").expect("a notice");
    let d = recs.iter().find(|r| r["kind"] == "permit_decision").expect("a decision");
    assert_eq!(d["data"]["decision"], "granted");
    assert!(d["at"].as_i64().unwrap() >= notice["at"].as_i64().unwrap() + 10 * DAY, "decided inside the objection period");
    assert!(d["data"].get("late").is_none(), "{d}");
}

#[test]
fn the_same_world_on_one_thread_and_on_fourteen_is_the_same_world() {
    assert_eq!(run(true, 1).0, run(true, 14).0);
}
