//! End to end through the real binary: drive a run over the stdio protocol,
//! then `verify` and `replay` the log it wrote, then tamper with it.

use crate::common;

use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

const BIN: &str = env!("CARGO_BIN_EXE_oikos-kernel");

fn cli(args: &[&str]) -> (bool, String) {
    let out = Command::new(BIN).args(args).output().unwrap();
    (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

#[test]
fn serve_then_verify_then_replay() {
    let dir = std::env::temp_dir().join(format!("oikos-cli-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let log = dir.join("run.jsonl");
    let anchors = dir.join("run.anchors.jsonl");

    let requests = [
        json!({"op": "start", "config": common::riverbend(), "run_id": "cli-test", "log_path": log, "anchors_path": anchors}),
        json!({"op": "command", "command": {"command": "observe", "participant": "mayor-system"}}),
        json!({"op": "check", "participant": "builder-system", "as": "builder", "blocks": [{"block": "construct", "at": "cell.2.1", "structure_type": "park", "materials_at": "s-shop"}]}),
        json!({"op": "command", "command": {"command": "act", "participant": "bank-payments-system", "as": "bank-payments", "blocks": [{"block": "transfer", "from": "acc-bob", "to": "acc-devco", "amount": "180000", "per_instruction": "so-bob-rent"}], "provenance": {"via": "direct"}}}),
        json!({"op": "command", "command": {"command": "act", "participant": "bank-payments-system", "as": "bank-payments", "blocks": [{"block": "transfer", "from": "acc-city", "to": "acc-devco", "amount": "0"}], "provenance": {"via": "direct"}}}),
        json!({"op": "annotate", "annotation": {"annotation": "usage", "purpose": "participant", "subject": "mayor", "provider": "anthropic", "model": "claude-sonnet-5", "input_tokens": 900, "output_tokens": 120, "cost_microusd": 4500}}),
        json!({"op": "command", "command": {"command": "advance", "to": 5_184_000}}),
        json!({"op": "state"}),
        json!({"op": "finish", "reason": "completed"}),
    ];
    let mut child = Command::new(BIN).arg("serve").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    {
        let stdin = child.stdin.as_mut().unwrap();
        for r in &requests {
            writeln!(stdin, "{r}").unwrap();
        }
    }
    let out = child.wait_with_output().unwrap();
    let replies: Vec<Value> = String::from_utf8(out.stdout).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(replies.len(), requests.len());
    assert!(replies[1]["observation"]["participant"] == "mayor-system");
    assert_eq!(replies[2]["check"]["ok"], true);
    // An act begins now and takes effect when done (a second, in a world without act times), here during the advance.
    assert_eq!(replies[3]["events"][0]["event"], "action_started");
    assert_eq!(replies[3]["events"][0]["done"], 1);
    assert!(replies[6]["events"].as_array().unwrap().iter().any(|e| e["event"] == "action_applied"), "{}", replies[6]);
    // An off-contract command is rejected and never logged.
    assert_eq!(replies[4]["ok"], false, "{}", replies[4]);
    assert!(replies[4]["error"].as_str().unwrap().contains("contract"));
    assert!(replies.iter().enumerate().all(|(i, r)| i == 4 || r["ok"] == true), "{replies:?}");

    let (ok, msg) = cli(&["verify", log.to_str().unwrap(), "--anchors", anchors.to_str().unwrap()]);
    assert!(ok && msg.contains("complete"), "{msg}");
    let (ok, msg) = cli(&["replay", log.to_str().unwrap(), "--anchors", anchors.to_str().unwrap()]);
    assert!(ok && msg.contains("byte-identically"), "{msg}");
    assert!(msg.contains(replies[8]["state_hash"].as_str().unwrap()), "replayed final state differs: {msg}");

    let text = std::fs::read_to_string(&log).unwrap();
    std::fs::write(&log, text.replacen("\"amount\":\"180000\"", "\"amount\":\"1\"", 1)).unwrap();
    let (ok, msg) = cli(&["verify", log.to_str().unwrap()]);
    assert!(!ok && msg.contains("hash does not match"), "{msg}");
    std::fs::remove_dir_all(&dir).unwrap();
}
