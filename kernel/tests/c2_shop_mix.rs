//! A town whose shops sell the kinds its profile's expenditure survey names (docs/behaviour/demand.md, "A town's mix of
//! shops"): generated with `shop_mix=true` by `orchestrator/test/lib/write-town.ts`, run in the engine over 60 days. The
//! households divide their spending among the kinds and buy several of them; the world is the same on one thread and on
//! fourteen.

use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::OnceLock;

const DAY: i64 = 86_400;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// The town of worlds/town.yaml with ten shops for 120 citizens, divided among the kinds.
fn mixed_town() -> Value {
    static TOWN: OnceLock<Value> = OnceLock::new();
    TOWN.get_or_init(|| {
        let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("c2-shop-mix-town.json");
        let _ = std::fs::remove_file(&out);
        let r = std::process::Command::new("bun")
            .current_dir(root())
            .args(["orchestrator/test/lib/write-town.ts", "worlds/town.yaml", out.to_str().unwrap(), "1", "shop_mix=true", "citizens=120", "shops=10"])
            .output()
            .expect("bun, to generate the town");
        assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));
        serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap()
    })
    .clone()
}

/// The town with the plain mind for every citizen (and those born or arriving later).
fn plain(mut c: Value) -> Value {
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
fn the_town_has_several_kinds_of_shop_and_every_citizen_knows_to_weigh_them() {
    let c = mixed_town();
    let mut kinds = BTreeMap::<String, usize>::new();
    for p in c["positions"].as_array().unwrap() {
        if p["role_module"]["code"] == "firm.retailer" && p["entity"].as_str().is_some_and(|e| e.starts_with("shop-")) {
            *kinds.entry(p["role_module"]["params"]["kind"].as_str().expect("a shop names its kind").to_string()).or_default() += 1;
        }
    }
    assert!(kinds.len() >= 4, "several kinds of shop: {kinds:?}");
    let citizen = c["participants"].as_array().unwrap().iter().find(|p| p["controller"]["impl"] == "citizen.default").unwrap();
    let named: Vec<&str> = citizen["controller"]["params"]["demand"]["kinds"].as_array().unwrap().iter().map(|k| k["kind"].as_str().unwrap()).collect();
    for k in kinds.keys() {
        assert!(named.contains(&k.as_str()), "{k} is among the kinds the citizens' demand names: {named:?}");
    }
}

#[test]
fn households_buy_several_kinds_over_sixty_days_and_the_world_is_the_same_on_one_thread_and_on_fourteen() {
    let until = 60 * DAY;
    let (h1, e1) = run_code_world(plain(mixed_town()), "c2-mix", Vec::new(), opts(1, until)).unwrap();
    let (h14, e14) = run_code_world(plain(mixed_town()), "c2-mix", Vec::new(), opts(14, until)).unwrap();
    assert_eq!(h1, h14, "the same state on one thread and on fourteen");
    let (l1, l14) = (e1.into_log(), e14.into_log());
    assert!(l1 == l14, "the logs are byte for byte the same");
    let log = lines(&l1);
    // Orders placed by citizens, by the kind ordered.
    let mut bought = BTreeMap::<String, usize>::new();
    for l in &log {
        if l["kind"] == "event" && l["body"]["event"] == "recorded" && l["body"]["record"]["kind"] == "order" {
            let r = &l["body"]["record"];
            if r["author"].as_str().is_some_and(|a| { let a = a.strip_suffix("-self").unwrap_or(a); a.len() > 1 && a.starts_with('c') && a[1..].chars().all(|d| d.is_ascii_digit()) }) {
                if let Some(k) = r["data"]["kind"].as_str() {
                    *bought.entry(k.to_string()).or_default() += 1;
                }
            }
        }
    }
    eprintln!("orders by citizens, by kind: {bought:?}");
    assert!(bought.len() >= 3, "households buy several kinds: {bought:?}");
    assert!(bought.contains_key("goods"), "and goods among them: {bought:?}");
}
