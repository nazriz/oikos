//! Lane D's bank in the engine (docs/port-guide.md, section 4): the payment system alone in a world whose other actors
//! are idle or scripted. A person's standing order is written by a scripted stand-in as a person's seat would write it,
//! and the bank reads it from its own file and pays on the due dates: the same log and the same state on one thread and
//! on fourteen; its memory saves, restores and carries on as the original would; a death registered with it ends the
//! dead person's order and settles their estate. (The rules, case by case, are the unit tests in
//! `crates/actors/src/finance/bank.rs`.)

mod common;

use oikos_actors::sight::Action;
use oikos_kernel::engine::{run_code_world, Due, Engine, EngineOptions};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

/// Riverbend with the bank's payment system real, and Alice (who has a standing order to pay Bob 100.00 every two days from
/// the second, written on day 1) and a registry that tells the bank on day 11 that Alice has died, scripted. Everything else
/// is idle.
fn world(dead_on: Option<i64>) -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(20 * DAY);
    let order = r#"statement(kind=request, text="Please pay Bob 100.00 every two days.", to=["bank"], data={"outcome":{"money":{"from":"acc-alice","to":"acc-bob","amount":"10000","for":"Rent."}},"every":172800,"first":172800})"#;
    let mut script = vec![json!({ "at": DAY, "call": order })];
    if let Some(day) = dead_on {
        let death = r#"statement(kind=death_registration, text="Alice has died.", to=["bank"], visible=["bank","city"], data={"deceased":"alice","partner":"bob"})"#;
        script.push(json!({ "at": day * DAY, "call": death }));
    }
    // The registry's notices of death are addressed to the bank, and it is shown them.
    for p in c["positions"].as_array_mut().unwrap() {
        if p["id"] == "bank-payments" {
            p["channels"].as_array_mut().unwrap().push(json!({ "id": "deaths", "kind": "records", "way": "mine", "match": { "statement_kinds": ["death_registration"] } }));
        }
    }
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "bank-payments-system" {
            // (This bank is shown no directory of who is who, so it cannot check whose hand wrote an instruction.)
            p["controller"]["params"] = json!({ "verify_author": false, "town": "city" });
        }
        if p["id"] == "alice-self" {
            p["controller"] = json!({ "type": "code", "impl": "stub.script", "params": { "script": script } });
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

/// The transfers between accounts in a run, as (day, from, to, amount).
fn transfers(log: &[Value]) -> Vec<(i64, String, String, String)> {
    log.iter()
        .filter(|l| l["kind"] == "event" && l["body"]["event"] == "transfer")
        .map(|l| {
            let b = &l["body"];
            (l["t"].as_i64().unwrap() / DAY, b["from"].as_str().unwrap().into(), b["to"].as_str().unwrap().into(), b["amount"].as_str().map_or_else(|| b["amount"].to_string(), String::from))
        })
        .collect()
}

#[test]
fn a_standing_order_is_paid_on_its_due_dates_by_the_bank_in_the_engine_and_the_world_is_the_same_on_any_number_of_threads() {
    let run = |threads| {
        let (hash, e) = run_code_world(world(None), "bank", Vec::new(), opts(threads)).unwrap();
        (hash, e.into_log())
    };
    let ((h1, l1), (h14, l14)) = (run(1), run(14));
    assert_eq!(h1, h14, "the same state on one thread and on fourteen");
    assert!(l1 == l14, "the logs are byte for byte the same");
    let log = lines(&l1);
    // The order is Alice's own; the bank pays from her account to Bob's, every other day from day 3, and always the 100.00.
    let paid: Vec<_> = transfers(&log).into_iter().filter(|t| t.1 == "acc-alice" && t.2 == "acc-bob").collect();
    assert!(paid.len() >= 8, "{paid:?}");
    assert!(paid.iter().all(|t| t.3 == "10000"), "{paid:?}");
    assert_eq!(paid.iter().map(|t| t.0 % 2).collect::<std::collections::BTreeSet<_>>().len(), 1, "every other day: {paid:?}");
    // The log says which kinds ran.
    let orch = log.iter().find(|l| l["body"]["annotation"] == "orchestrator").unwrap();
    assert!(orch["body"]["data"]["modules"]["bank.payment_system"].is_object());
}

#[test]
fn a_death_registered_with_the_bank_ends_the_dead_persons_order_and_settles_their_estate_on_the_partner() {
    let (_, e) = run_code_world(world(Some(11)), "dead", Vec::new(), opts(2)).unwrap();
    let log = lines(&e.into_log());
    let paid: Vec<_> = transfers(&log).into_iter().filter(|t| t.1 == "acc-alice" && t.2 == "acc-bob" && t.3 == "10000").collect();
    assert!(!paid.is_empty() && paid.iter().all(|t| t.0 <= 12), "no payment of Alice's order once the bank is told: {paid:?}");
    // Her account is emptied into Bob's, once: the estate.
    let estate: Vec<_> = transfers(&log).into_iter().filter(|t| t.1 == "acc-alice" && t.2 == "acc-bob" && t.3 != "10000").collect();
    assert_eq!(estate.len(), 1, "{estate:?}");
    assert!(estate[0].0 >= 11 && estate[0].0 <= 13, "{estate:?}");
}

#[test]
fn the_banks_memory_saves_and_the_saved_bank_steps_as_the_original() {
    let mut e = Engine::start(world(None), "save", Vec::new(), None, EngineOptions { until: Some(7 * DAY), ..opts(1) }).unwrap();
    while let Due::Seats(seats) = e.next().unwrap() {
        for s in seats {
            e.submit(&s.key, Action::wait()).unwrap();
        }
    }
    let saved = e.save_actors().unwrap();
    let bank = &saved["bank-payments-system|bank-payments"];
    assert_eq!(bank["kind"], "bank.payment_system");
    let kind = oikos_actors::registry::find("bank.payment_system").unwrap();
    let ctx = oikos_actors::Ctx { participant: "x".into(), performer: Default::default(), entity: "bank".into(), position: None, params: Default::default(), world: Default::default() };
    let back = kind.restore(&ctx, bank["actor"].clone()).unwrap();
    assert_eq!(back.save().unwrap(), bank["actor"], "saves exactly what it was given");
}

/// Every kind of the lane has the manifest the TS module wrote, in every key it has but the versions, the parameters the port
/// retired or added, and the papers a lane that is not this one owns.
#[test]
fn each_manifest_is_the_one_the_ts_module_wrote_but_for_what_the_port_changed() {
    let retired = [("union.organiser", "compliance_bps")];
    for name in ["bank.payment_system", "bank.lending", "fund.retirement", "union.organiser", "firm.newspaper"] {
        let ts: Value = serde_json::from_slice(&std::fs::read(format!("{}/../participants/manifests/{name}.json", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap();
        let rust = oikos_actors::registry::find(name).unwrap().manifest();
        for (k, v) in ts.as_object().unwrap() {
            match k.as_str() {
                "version" => assert!(rust["version"].as_str().unwrap() >= v.as_str().unwrap(), "{name}: the port never goes back a version"),
                "params" => {
                    for (p, spec) in v.as_object().unwrap() {
                        if retired.contains(&(name, p.as_str())) {
                            assert!(rust["params"].get(p).is_none(), "{name}: {p} is retired");
                        } else {
                            assert_eq!(&rust["params"][p], spec, "{name}: parameter {p}");
                        }
                    }
                }
                _ => assert_eq!(&rust[k], v, "{name}: {k}"),
            }
        }
    }
}

