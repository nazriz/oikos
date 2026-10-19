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
    assert!(acts > 100, "citizens live: they shop, pay, apply and move ({acts} acts)");
}

/// What citizens published in a run (statements, by kind), and the acts' calls.
fn statements(log: &[Value], kind: &str) -> Vec<Value> {
    log.iter().filter(|l| l["kind"] == "event" && l["body"]["event"] == "recorded" && l["body"]["record"]["kind"] == kind).map(|l| l["body"]["record"].clone()).collect()
}

#[test]
fn over_two_months_people_apply_for_work_and_order_goods_and_nobody_retired_applies() {
    let until = 60 * DAY;
    let c = plain_town();
    let retired: Vec<String> = c["participants"].as_array().unwrap().iter().filter(|p| p["controller"]["params"]["own_work"].is_object()).filter_map(|p| p["person"].as_str().map(String::from)).collect();
    let (_, e) = run_code_world(c, "a1-60", Vec::new(), opts(4, until)).unwrap();
    let log = lines(&e.into_log());
    let apps = statements(&log, "job_application");
    eprintln!("job applications: {}; orders: {}", apps.len(), statements(&log, "order").len());
    assert!(apps.iter().all(|a| !retired.iter().any(|r| a["speaks_for"] == r.as_str())), "someone who works for themself does not apply for jobs");
}

#[test]
fn with_take_up_at_nothing_nobody_claims_support() {
    let mut c = plain_town();
    for p in c["participants"].as_array_mut().unwrap() {
        if p["controller"]["impl"] == "citizen.default" {
            p["controller"]["params"]["take_up_bps"] = json!(0);
        }
    }
    // (And those who arrive in the run, from the templates they are made from: until the cut-over nobody who arrived
    // was out of work long enough to claim in 60 days; since a posting takes applications for a week before the
    // employer chooses, two arrivals were, and claimed at the template's take-up.)
    if let Some(ts) = c["templates"].as_array_mut() {
        for t in ts {
            if t["controller"]["impl"] == "citizen.default" {
                t["controller"]["params"]["take_up_bps"] = json!(0);
            }
        }
    }
    let (_, e) = run_code_world(c, "a1-takeup", Vec::new(), opts(4, 60 * DAY)).unwrap();
    let log = lines(&e.into_log());
    assert!(statements(&log, "benefit_claim").is_empty());
}

#[test]
#[ignore]
fn tally() {
    let (_, e) = run_code_world(plain_town(), "a1-tally", Vec::new(), opts(4, 60 * DAY)).unwrap();
    let log = lines(&e.into_log());
    let mut k = std::collections::BTreeMap::<String, usize>::new();
    for l in &log {
        if l["kind"] == "event" && l["body"]["event"] == "recorded" {
            *k.entry(format!("rec:{}", l["body"]["record"]["kind"].as_str().unwrap_or(l["body"]["record"]["record"].as_str().unwrap_or("?")))).or_default() += 1;
        }
        if l["kind"] == "command" && l["body"]["command"] == "act" {
            let c = l["body"]["provenance"]["call"].as_str().unwrap_or("").split('(').next().unwrap_or("").to_string();
            *k.entry(format!("call:{c}")).or_default() += 1;
        }
        if l["kind"] == "event" {
            *k.entry(format!("event:{}", l["body"]["event"].as_str().unwrap_or("?"))).or_default() += 1;
        }
        if l["kind"] == "outcome" || l["body"]["status"] == "refused" {
            *k.entry(format!("status:{}:{}", l["body"]["status"].as_str().unwrap_or("?"), l["body"]["refusal"]["code"].as_str().unwrap_or(""))).or_default() += 1;
        }
    }
    eprintln!("{k:#?}");
}
