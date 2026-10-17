//! firm.landlord alone in the Rust world (docs/port-guide.md, section 4): Riverbend's developer replaced by a letting
//! office, every other kind stood in for by `idle`; the same state hash on one thread and on fourteen; the manifest the
//! TS module's in every key that file has (the Rust adds the review's optional parameters and its version).

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

fn landlord_world() -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(120 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "developer-system" {
            p["controller"] = json!({ "type": "code", "impl": "firm.landlord", "params": {
                "develop": false, "renew": true, "base_rent": { "house": 150_000 }, "rent_review_months": 3, "possession": { "tribunal": "city", "fee": 0 },
                "spend_share_bps": 0, "upkeep_share_bps": 0 } });
        }
    }
    c
}

#[test]
fn the_landlord_runs_alone_in_the_engine_and_the_world_is_the_same_on_one_thread_and_on_fourteen() {
    let run = |threads| {
        let (hash, e) = run_code_world(landlord_world(), "landlord", Vec::new(), opts(threads)).unwrap();
        (hash, e.into_log())
    };
    let (h1, l1) = run(1);
    let (h14, l14) = run(14);
    let (h14b, _) = run(14);
    assert_eq!(h1, h14);
    assert_eq!(h14, h14b);
    assert!(l1 == l14, "the logs are byte for byte the same");
    let log = lines(&l1);
    let orch = log.iter().find(|l| l["body"]["annotation"] == "orchestrator").unwrap();
    assert_eq!(orch["body"]["data"]["modules"]["firm.landlord"]["version"], "0.20.0");
}

#[test]
fn the_manifest_is_the_ts_modules_in_every_key_that_file_has() {
    let kind = oikos_actors::registry::find("firm.landlord").expect("registered");
    let rust = kind.manifest();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../participants/manifests/firm.landlord.json");
    let ts: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let new = ["pass_up_bps", "pass_down_bps", "soft_vacancy_bps", "evidence_days"];
    for (k, v) in ts.as_object().unwrap() {
        match k.as_str() {
            "version" => assert_eq!(rust["version"], "0.20.0"),
            "params" => {
                for (name, p) in v.as_object().unwrap() {
                    assert_eq!(&rust["params"][name], p, "param {name}");
                }
                assert_eq!(rust["params"].as_object().unwrap().len(), v.as_object().unwrap().len() + new.iter().filter(|n| v.get(**n).is_none()).count());
            }
            _ => assert_eq!(&rust[k], v, "key {k}"),
        }
    }
}
