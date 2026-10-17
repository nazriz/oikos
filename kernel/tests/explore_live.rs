//! The explorer's data layer attached to a live run (docs/port-guide.md section 9): the host's event stream (lane F)
//! fed line by line to an `oikos_explore::Index` while the run goes on, answering the service's routes mid-run; at the
//! end it holds what an index built from the finished log holds. Read-only: the stream is pulled, nothing flows back.

mod common;

use oikos_explore::service::{RunSpec, Service};
use oikos_explore::Index;
use oikos_kernel::host::Host;
use serde_json::{json, Value};
use std::sync::Arc;

const DAY: i64 = 86_400;

fn world() -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(20 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "inspector-system" {
            p["controller"] = json!({ "type": "code", "impl": "world.weather", "params": { "events": [{ "kind": "heatwave", "from_day": 6, "days": 3 }], "lead_days": 2 } });
        }
    }
    c
}

/// Every pulled entry, as the line the log has it (canonical JSON), fed to the index.
fn feed(h: &Host, ix: &Index) -> usize {
    let ev = h.events(1_000_000);
    assert_eq!(ev["missed"], 0);
    let entries = ev["entries"].as_array().unwrap();
    for e in entries {
        ix.feed(&e.to_string());
    }
    entries.len()
}

#[test]
fn an_index_fed_from_the_live_stream_answers_mid_run_and_ends_as_the_finished_log_indexed() {
    let mut h = Host::start(world(), &json!({ "run_id": "live", "stand_in": "idle", "stream": { "cap": 1000000 } })).unwrap();
    let ix = Arc::new(Index::new());
    let service = Arc::new(Service::new(vec![RunSpec::attached("live", ix.clone())]));
    let (mut fed, mut midrun) = (0, None);
    let mut rounds = 0;
    loop {
        let due = h.next().unwrap();
        fed += feed(&h, &ix);
        if due["due"] == "end" {
            break;
        }
        for s in due["seats"].as_array().unwrap() {
            h.submit(s["key"].as_str().unwrap(), &json!({ "type": "wait" })).unwrap();
        }
        rounds += 1;
        // (The service answers while the run is going.)
        if rounds == 3 && ix.has_header() {
            // (The first request opens the run: the service says it is reading; the next has the town.)
            let mut world = Value::Null;
            for _ in 0..200 {
                let r = service.get("/api/r/live/world");
                assert_eq!(r.status, 200);
                world = serde_json::from_slice::<Value>(&r.body).unwrap();
                if world.get("meta").is_some() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            midrun = Some(world);
        }
    }
    h.finish().unwrap();
    fed += feed(&h, &ix);
    let world_then = midrun.expect("the run lasted more than three rounds");
    assert!(world_then["meta"]["runId"].is_string());
    assert!(world_then["meta"]["lines"].as_u64() < ix.world_json().unwrap()["meta"]["lines"].as_u64(), "the index grew as the run went on");
    // The same run, finished and indexed from its log.
    let log = String::from_utf8(h.log_bytes().unwrap()).unwrap();
    let lines: Vec<&str> = log.lines().collect();
    assert_eq!(fed, lines.len(), "the stream gave every line of the log");
    let whole = Index::new();
    whole.feed_all(lines.iter().copied());
    assert_eq!(ix.kept(), whole.kept());
    let (a, b) = (ix.world_json().unwrap(), whole.world_json().unwrap());
    assert_eq!(a["meta"]["days"], b["meta"]["days"]);
    assert_eq!(a["meta"]["lines"], b["meta"]["lines"]);
    assert_eq!(a["meta"]["kept"], b["meta"]["kept"]);
    assert_eq!(a["townPulse"], b["townPulse"]);
}
