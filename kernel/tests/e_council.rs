//! Lane E, the council in the engine (docs/port-guide.md, section 4): Riverbend with its mayor's seat a code mayor, a
//! clerk and three councillors, every other kind standing idle. The mayor tables the year's budget, the clerk puts it
//! to a ballot, the councillors vote on their own causes (the mayor's proposal is deferred to), the clerk counts and
//! declares the result, and only then publishes the budget. The same world on 1 and 14 threads is the same world.

mod common;

use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

fn council_world() -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(60 * DAY);
    let channels = json!([
        { "id": "business", "kind": "records", "way": "mine", "match": {} },
        { "id": "who", "kind": "directory", "way": "ask", "on_request": true }
    ]);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "builder-system" || p["id"] == "inspector-system" {
            p["controller"] = json!({ "type": "code", "impl": "idle" });
        }
    }
    let mut add_participant = |id: &str, title: &str, imp: &str, params: Value| {
        c["participants"].as_array_mut().unwrap().push(json!({
            "id": id, "kind": "system", "owner": "city", "title": title,
            "controller": { "type": "code", "impl": imp, "params": params },
            "framing": { "disclosure": "unstated", "reason": "Code controller; framing does not apply." },
            "template": "installed-system", "supplier": "outside"
        }));
    };
    add_participant("clerk-system", "Council clerk", "city.council_clerk", json!({ "who": "who", "vote_days": 7 }));
    for (i, l) in [-80, 0, 80].iter().enumerate() {
        add_participant(&format!("councillor-{}-system", i + 1), "Councillor", "city.councillor", json!({ "leaning": l, "noise_bps": 1500 }));
    }
    let mut add_position = |id: &str, role: &str, holder: &str| {
        c["positions"].as_array_mut().unwrap().push(json!({ "id": id, "entity": "city", "title": id, "role": role, "channels": channels, "holder": holder }));
    };
    add_position("council-clerk", "clerk", "clerk-system");
    for i in 1..=3 {
        add_position(&format!("councillor-{i}"), "councillor", &format!("councillor-{i}-system"));
    }
    // The mayor's seat is the code mayor (its channels are the town's business and who's who).
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "mayor-system" {
            p["controller"] = json!({ "type": "code", "impl": "city.mayor_code", "params": { "builder": "builder", "park_budget": 5_000_000 } });
            p["framing"] = json!({ "disclosure": "unstated", "reason": "Code controller; framing does not apply." });
        }
    }
    c
}

fn opts(threads: usize) -> EngineOptions {
    EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, ..Default::default() }
}

fn lines(log: &[u8]) -> Vec<Value> {
    log.split(|b| *b == b'\n').filter(|l| !l.is_empty()).map(|l| serde_json::from_slice(l).unwrap()).collect()
}

fn recorded<'a>(log: &'a [Value], kind: &str) -> Vec<&'a Value> {
    log.iter().filter(|l| l["kind"] == "event" && l["body"]["event"] == "recorded" && l["body"]["record"]["kind"] == kind).map(|l| &l["body"]["record"]).collect()
}

#[test]
fn a_budget_goes_from_the_mayor_through_a_ballot_and_a_declared_result_to_the_book() {
    let (_, e) = run_code_world(council_world(), "council", Vec::new(), opts(4)).unwrap();
    let log = lines(&e.into_log());
    let proposals = recorded(&log, "proposal");
    assert!(!proposals.is_empty(), "the mayor tabled the year's budget");
    let ballots = recorded(&log, "ballot");
    assert!(!ballots.is_empty(), "the clerk opened a ballot");
    assert_eq!(ballots[0]["data"]["electorate"], "council");
    let votes: Vec<&Value> = log.iter().filter(|l| l["kind"] == "event" && l["body"]["event"] == "recorded" && l["body"]["record"]["record"] == "vote").map(|l| &l["body"]["record"]).collect();
    assert!(!votes.is_empty(), "the councillors voted: {}", votes.len());
    let results = recorded(&log, "ballot_result");
    assert!(!results.is_empty(), "the clerk declared a result");
    // The budget is published after the result, resting on the ballot (a published thing needs a declared ballot).
    let budgets = recorded(&log, "budget");
    if results[0]["data"]["passed"] == true {
        assert!(!budgets.is_empty(), "a passed budget is published");
        assert!(budgets[0]["at"].as_i64() > results[0]["at"].as_i64(), "after the result is on the record");
        assert_eq!(budgets[0]["basis"], results[0]["data"]["ballot"]);
    }
}

#[test]
fn the_same_council_world_on_one_thread_and_on_fourteen_is_the_same_world() {
    let run = |threads| {
        let (hash, e) = run_code_world(council_world(), "council-threads", Vec::new(), opts(threads)).unwrap();
        (hash, e.into_log())
    };
    let (h1, l1) = run(1);
    let (h14, l14) = run(14);
    assert_eq!(h1, h14);
    assert!(l1 == l14, "the logs are byte for byte the same");
}
