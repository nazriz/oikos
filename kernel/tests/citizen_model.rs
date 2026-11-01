//! The citizen model as a citizen mind (docs/citizen-data.md, "The citizen model"; kernel/crates/actors/src/mind/model.rs):
//! a world names a model file by its hash in `dials.citizen_model`, and each want's way is drawn on its odds blended
//! with the code mind's. At a share of 0 it is the code mind to the bit (the same state hash as a world without it);
//! at its own odds it decides, the same way on every run; a file whose hash is not the config's is refused.

use oikos_actors::mind::model::{features, CitizenModel, Layer, Vocab};
use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const DAY: i64 = 86_400;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn town() -> Value {
    let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("citizen-model-town.json");
    let r = std::process::Command::new("bun")
        .current_dir(root())
        .args(["orchestrator/test/lib/write-town.ts", "worlds/town.yaml", out.to_str().unwrap(), "1", "living={\"initiative_bps\":10000}"])
        .output()
        .expect("bun, to generate the town");
    assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));
    serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap()
}

/// A model of the served shape with weights from a fixed pattern (no training: the mechanism, not a fit), written to a
/// file; its path and SHA-256.
fn model_file() -> (String, String) {
    let vocab = Vocab { about: vec!["shelter".into(), "social".into()], role: vec!["landlord".into()], ..Default::default() };
    let width = features(&vocab, &Value::Null, "wait", None).len();
    let w1: Vec<i32> = (0..width * 8).map(|i| ((i * 7919 + 13) % 4001) as i32 - 2000).collect();
    let w2: Vec<i32> = (0..8).map(|i| [30_000, -20_000, 15_000, -40_000, 25_000, 5_000, -10_000, 35_000][i]).collect();
    let m = CitizenModel { vocab, mean: vec![0; width], scale: vec![65_536; width], layers: vec![Layer { inp: width, out: 8, w: w1, b: vec![1_000; 8] }, Layer { inp: 8, out: 1, w: w2, b: vec![0] }], sha256: String::new(), share_bps: 10_000 };
    let bytes = serde_json::to_vec(&m.to_json(json!({ "test": true }))).unwrap();
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("citizen-model-test.json");
    std::fs::write(&path, &bytes).unwrap();
    (path.to_str().unwrap().to_string(), oikos_core::canon::to_hex(&Sha256::digest(&bytes)))
}

fn run(config: Value) -> Result<(String, Vec<Value>), String> {
    let mut out = vec![];
    let (h, e) = run_code_world(config, "world", &mut out, EngineOptions { threads: 2, until: Some(40 * DAY), ..Default::default() })?;
    drop(e);
    let wants = String::from_utf8_lossy(&out)
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|e| e["kind"] == "annotation" && e["body"]["annotation"] == "decision" && e["body"]["data"]["domain"] == "want")
        .map(|e| e["body"]["data"].clone())
        .collect();
    Ok((h, wants))
}

#[test]
fn a_citizen_model_at_share_zero_is_the_code_mind_and_at_its_own_odds_decides_the_same_way_every_run() {
    let base = town();
    let (path, sha) = model_file();
    let with = |share: i64, sha: &str| {
        let mut c = base.clone();
        c["dials"]["citizen_model"] = json!({ "weights": path, "sha256": sha, "share_bps": share });
        c
    };
    let (h0, code) = run(base.clone()).unwrap();
    assert!(code.len() > 20, "the town's people go after their wants ({} decisions)", code.len());
    assert!(code.iter().all(|d| d["situation"].get("model").is_none()));
    // Share 0: the code mind's draws, to the bit; the model's odds recorded beside its own (and equal to them).
    let (h, zero) = run(with(0, &sha)).unwrap();
    assert_eq!(h, h0);
    assert_eq!(zero.len(), code.len());
    for (a, b) in zero.iter().zip(&code) {
        assert_eq!(a["choice"], b["choice"]);
        assert_eq!(a["situation"]["code"], b["situation"]["code"]);
        assert_eq!(a["situation"]["model"]["odds"], a["situation"]["code"]["odds"]);
        assert_eq!(a["situation"]["model"]["sha256"], json!(sha));
    }
    // Its own odds: a different mind decides, the same way on every run.
    let (h1, own) = run(with(10_000, &sha)).unwrap();
    let (h2, again) = run(with(10_000, &sha)).unwrap();
    assert_eq!(h1, h2);
    assert_eq!(own, again);
    assert_ne!(h1, h0);
    assert!(own.iter().any(|d| d["situation"]["model"]["odds"] != d["situation"]["code"]["odds"]));
    for d in &own {
        let total: i64 = d["situation"]["model"]["odds"].as_array().unwrap().iter().map(|x| x["ppm"].as_i64().unwrap()).sum();
        assert!((total - 1_000_000).abs() <= 10, "{total}");
    }
    // A file that is not the one the config names does not run.
    let err = run(with(10_000, &"0".repeat(64))).unwrap_err();
    assert!(err.contains("SHA-256"), "{err}");
}
