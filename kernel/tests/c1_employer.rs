//! `firm.employer` run alone in the Rust world (docs/port-guide.md, section 4): Riverbend with its finance officer's
//! system replaced by an employer, everything else idle; the world is the same on one thread and on fourteen, and the
//! employer posts jobs for the staff it opens with (no trade on record yet).

mod common;

use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

fn opts(threads: usize) -> EngineOptions {
    EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, ..Default::default() }
}

fn world() -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(45 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"].as_str().unwrap() == "finance-system" {
            p["controller"] = json!({ "type": "code", "impl": "firm.employer", "params": { "wage": 140000, "target_staff": 3, "buffer_periods": 1 } });
        }
    }
    c
}

#[test]
fn the_employer_runs_alone_and_the_world_is_the_same_on_one_thread_and_on_fourteen() {
    let run = |threads| {
        let (hash, e) = run_code_world(world(), "employer", Vec::new(), opts(threads)).unwrap();
        (hash, e.into_log())
    };
    let (h1, l1) = run(1);
    let (h14, l14) = run(14);
    assert_eq!(h1, h14);
    assert!(l1 == l14, "the logs are byte for byte the same");
    let text = String::from_utf8(l1).unwrap();
    assert!(text.contains("\"firm.employer\""), "the log says the kind ran");
}
