//! Lane C1's small kinds, each run alone in the Rust world (docs/port-guide.md, section 4): `body.payroll` in
//! Riverbend in place of the city's finance officer, every other kind stood in for by `idle`, with the same state hash
//! on one thread and on fourteen, and its manifest equal to the TS module's in every key that file has.
//! (The libraries of the lane, tax, returns, payments, orgwants and practice, are not kinds: their tests are beside
//! the code, in `oikos-rules` and `oikos-actors`.)

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

/// Riverbend with its finance officer's system replaced by a payroll, the inspector's by a script that stands for a
/// hiring office's notice to it; everything else idle.
fn payroll_world(part: &str) -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(60 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        match p["id"].as_str().unwrap() {
            "finance-system" => p["controller"] = json!({ "type": "code", "impl": "body.payroll", "params": { "part": part, "watch": ["mayor"], "who": "who", "after_days": 14 } }),
            "inspector-system" => {
                p["controller"] = json!({ "type": "code", "impl": "stub.script", "params": { "script": [
                    { "at": 5 * DAY, "call": "statement(kind=payroll_notice, text=\"Payroll notice from the hiring office.\", to=[\"city\"], visible=[\"city\"], data={\"notice\": \"starter\", \"employee\": \"alice-self\", \"agreement\": \"none\"})" }
                ] } })
            }
            _ => {}
        }
    }
    common::alone(&mut c, &["body.payroll"]);
    c
}

#[test]
fn the_payroll_runs_alone_in_the_engine_and_the_world_is_the_same_on_one_thread_and_on_fourteen() {
    for part in ["officer", "deputy", "appointer"] {
        let run = |threads| {
            let (hash, e) = run_code_world(payroll_world(part), "payroll", Vec::new(), opts(threads)).unwrap();
            (hash, e.into_log())
        };
        let (h1, l1) = run(1);
        let (h14, l14) = run(14);
        let (h14b, _) = run(14);
        assert_eq!(h1, h14, "{part}");
        assert_eq!(h14, h14b, "{part}");
        assert!(l1 == l14, "{part}: the logs are byte for byte the same");
        let log = lines(&l1);
        let orch = log.iter().find(|l| l["body"]["annotation"] == "orchestrator").unwrap();
        assert!(orch["body"]["data"]["modules"]["body.payroll"].is_object(), "{part}: the log says which kinds ran");
        assert_eq!(orch["body"]["data"]["modules"]["body.payroll"]["version"], "0.5.0", "{part}");
    }
}

#[test]
fn the_manifest_is_the_ts_modules_in_every_key_that_file_has() {
    let kind = oikos_actors::registry::find("body.payroll").expect("registered");
    let rust = kind.manifest();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../participants/manifests/body.payroll.json");
    let ts: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    // The TS file is at 0.4.x until the bugfix branch (ab26ed7a: the owner's appointer, 0.5.0) is merged; the kind is
    // the bugfix version. Until then the file's own params and keys must all be equal, and the two additions are the
    // bugfix's. Once the file says 0.5.0 the whole manifest is equal.
    let bugfix_params = ["owner", "owner_participant"];
    let strict = ts["version"] == "0.5.0";
    for (k, v) in ts.as_object().unwrap() {
        match k.as_str() {
            "version" if !strict => assert_eq!(rust["version"], "0.5.0"),
            "params" => {
                for (name, p) in v.as_object().unwrap() {
                    assert_eq!(&rust["params"][name], p, "param {name}");
                }
                for name in bugfix_params {
                    assert!(rust["params"][name].is_object(), "{name}");
                    assert!(strict || v.get(name).is_none() || rust["params"][name] == v[name]);
                }
                assert_eq!(rust["params"].as_object().unwrap().len(), v.as_object().unwrap().len() + if strict { 0 } else { bugfix_params.iter().filter(|n| v.get(**n).is_none()).count() });
            }
            _ => assert_eq!(&rust[k], v, "key {k}"),
        }
    }
    assert_eq!(rust["answers"]["office"], "the payroll office");
}
