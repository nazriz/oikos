//! firm.builder in the Rust world (docs/port-guide.md, section 4): the kind in Riverbend in place of the city's finance
//! officer, every other code actor idle, a supplier's prices scripted. The same world on 1 and 14 threads.

mod common;

use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

fn world() -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(20 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "builder-system" {
            p["controller"] = json!({ "type": "code", "impl": "idle" });
        }
        if p["id"] == "finance-system" {
            p["controller"] = json!({ "type": "code", "impl": "firm.builder", "params": {
                "supplier": "outside", "yard": "yard",
                "types": { "house": { "materials": { "materials": 10 }, "build_labour": 7200, "demolition_labour": 3600 } } } });
        }
    }
    c
}

fn opts(threads: usize) -> EngineOptions {
    EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, ..Default::default() }
}

#[test]
fn the_builder_runs_in_the_engine_and_is_the_same_world_on_one_thread_and_fourteen() {
    let run = |threads| {
        let (hash, e) = run_code_world(world(), "builder", Vec::new(), opts(threads)).unwrap();
        (hash, e.into_log())
    };
    let (h1, l1) = run(1);
    let (h14, l14) = run(14);
    assert_eq!(h1, h14);
    assert!(l1 == l14, "the logs are byte for byte the same");
    let log = String::from_utf8(l1).unwrap();
    assert!(log.contains("\"firm.builder\""), "the log says which kinds ran");
}

#[test]
fn the_builder_manifest_is_the_one_the_ts_module_wrote() {
    let ts: Value = serde_json::from_slice(&std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../participants/manifests/firm.builder.json")).unwrap()).unwrap();
    let rust = oikos_actors::registry::find("firm.builder").unwrap().manifest();
    for (k, v) in ts.as_object().unwrap() {
        assert_eq!(&rust[k], v, "{k}");
    }
}
