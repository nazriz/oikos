//! `firm.retailer` and `firm.producer` run in the Rust world over the firm body of lane C1 (`firms::firm_body`: staff, union,
//! bank, failure; docs/port-guide.md, section 4): Riverbend with its finance officer's system replaced by one trading firm,
//! everything else idle. Each world is the same on one thread and on fourteen, and a shop short of the staff it wants posts a
//! job through the ordinary staff routine (the stand-in body the lane tested with posts none).

mod common;

use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

fn opts(threads: usize) -> EngineOptions {
    EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, ..Default::default() }
}

fn world(kind: &str, params: Value) -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(45 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"].as_str().unwrap() == "finance-system" {
            p["controller"] = json!({ "type": "code", "impl": kind, "params": params });
        }
    }
    common::alone(&mut c, &[kind]);
    c
}

fn same_on_any_threads(kind: &str, params: Value) -> String {
    let run = |threads| {
        let (hash, e) = run_code_world(world(kind, params.clone()), kind, Vec::new(), opts(threads)).unwrap();
        (hash, e.into_log())
    };
    let (h1, l1) = run(1);
    let (h14, l14) = run(14);
    assert_eq!(h1, h14, "{kind}: the same state on one thread and on fourteen");
    assert!(l1 == l14, "{kind}: the logs are byte for byte the same");
    String::from_utf8(l1).unwrap()
}

#[test]
fn a_shop_over_the_firm_body_posts_a_job_and_the_world_is_the_same_on_one_thread_and_on_fourteen() {
    let text = same_on_any_threads("firm.retailer", json!({ "kind": "bread", "suppliers": ["upriver"], "wage": 140_000, "max_staff": 3, "min_staff": 2, "demand": 40 }));
    assert!(text.contains("\"firm.retailer\""), "the log says the kind ran");
    assert!(text.contains("job_posting"), "short of its two staff, the shop advertises a job");
}

#[test]
fn a_works_over_the_firm_body_runs_and_the_world_is_the_same_on_one_thread_and_on_fourteen() {
    let text = same_on_any_threads("firm.producer", json!({ "supplier": "upriver", "market": "outside", "wage": 150_000, "max_staff": 3 }));
    assert!(text.contains("\"firm.producer\""), "the log says the kind ran");
    // (A works with no staff and no demand on record takes nobody on: its staff are what its stock and orders ask for.)
}
