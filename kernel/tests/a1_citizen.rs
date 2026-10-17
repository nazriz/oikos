//! Lane A1: the citizen's life in Rust, alone in the engine (docs/port-guide.md, section 4). A generated town (the
//! TS generator, written once per build to the target directory) with every kind not ported standing idle and the
//! plain mind: what the citizen does by itself, on any number of threads.

use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::OnceLock;

const DAY: i64 = 86_400;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// The town of `worlds/town.yaml`, as the generator writes it (cached for the build).
fn town() -> Value {
    static TOWN: OnceLock<Value> = OnceLock::new();
    TOWN.get_or_init(|| {
        let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("a1-town.json");
        if !out.exists() {
            let r = std::process::Command::new("bun")
                .current_dir(root())
                .args(["orchestrator/test/lib/write-town.ts", "worlds/town.yaml", out.to_str().unwrap(), "1"])
                .output()
                .expect("bun, to generate the town");
            assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));
        }
        serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap()
    })
    .clone()
}

/// The town with the plain mind for every citizen (and those born or arriving later).
pub fn plain_town() -> Value {
    let mut c = town();
    let plain = |ctl: &mut Value| {
        if ctl["impl"] == "citizen.default" {
            ctl["params"]["mind"] = json!("plain");
        }
    };
    for p in c["participants"].as_array_mut().unwrap() {
        plain(&mut p["controller"]);
    }
    if let Some(ts) = c["templates"].as_array_mut() {
        for t in ts {
            plain(&mut t["controller"]);
        }
    }
    c
}

fn opts(threads: usize, until: i64) -> EngineOptions {
    EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, until: Some(until), ..Default::default() }
}

fn lines(log: &[u8]) -> Vec<Value> {
    log.split(|b| *b == b'\n').filter(|l| !l.is_empty()).map(|l| serde_json::from_slice(l).unwrap()).collect()
}

#[test]
fn a_town_of_citizens_runs_in_the_engine_the_same_on_one_thread_and_on_fourteen() {
    let until = 21 * DAY;
    let (h1, e1) = run_code_world(plain_town(), "a1", Vec::new(), opts(1, until)).unwrap();
    let (h14, e14) = run_code_world(plain_town(), "a1", Vec::new(), opts(14, until)).unwrap();
    assert_eq!(h1, h14);
    let (l1, l14) = (e1.into_log(), e14.into_log());
    assert!(l1 == l14, "the logs are byte for byte the same");
    let log = lines(&l1);
    let acts = log.iter().filter(|l| l["kind"] == "command" && l["body"]["command"] == "act" && l["body"]["participant"].as_str().is_some_and(|p| p.starts_with('c'))).count();
    eprintln!("citizens' acts in 21 days: {acts}");
}
