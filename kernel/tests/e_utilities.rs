//! utility.water and utility.energy: the kind in a small world of the engine (docs/port-guide.md, section 4): the inspector's seat is replaced by
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

fn energy() -> Value {
    json!({ "depot": "s-shop", "grid": "outside", "price_per_unit": 30, "supply_per_day": 110 })
}

fn water() -> Value {
    json!({ "works": "s-shop", "storage": 100_000, "price_per_kl": 300, "service_per_quarter": 9000 })
}

#[test]
fn a_customer_who_asks_to_be_supplied_where_there_is_no_network_is_billed_for_nothing() {
    let script = json!([{ "at": 3600, "call": "statement(kind=supply_request, text=\"Please supply me.\", to=[\"city\"], data={\"account\": \"acc-alice\"})" }]);
    let config = world("utility.energy", energy(), script, 40);
    let (_, log) = run(&config, 1);
    let tariffs = statements(&log, "utility_tariff");
    assert_eq!(tariffs.len(), 1, "published once");
    assert_eq!(tariffs[0]["visible_to"], "public");
    // (Foundations-2 C4, law 8: a customer is a connection on the retailer's network, billed from its meter. A world with
    // no network has nothing to connect to: the request is kept, nothing flows, and nobody is billed for an assumed use, as
    // until C4 they were. The network's bills are held in offices/utilities/tests.rs and orchestrator/test/utilities.test.ts.)
    let bills: Vec<_> = statements(&log, "invoice").into_iter().filter(|b| b["data"]["service"] == "energy").collect();
    assert!(bills.is_empty(), "{bills:?}");
}

#[test]
fn the_works_publishes_its_tariff_and_runs_the_same_on_one_thread_and_on_fourteen() {
    let config = world("utility.water", water(), json!([]), 20);
    let (_, log) = run(&config, 1);
    assert_eq!(statements(&log, "utility_tariff").len(), 1);
    same_on_any_threads(&config);
    same_on_any_threads(&world("utility.energy", energy(), json!([]), 15));
}
