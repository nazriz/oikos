//! INVARIANT: the log's hash chain verifies end to end, and tampering with any
//! entry is detected.
//!
//! What the chain alone catches: any edit, insertion, deletion, reordering or
//! reformatting of any entry. What it cannot catch alone: someone rewriting
//! history from some point and recomputing every later hash, or truncating the
//! tail. The witness anchors (written outside the log) catch both; these tests
//! pin down exactly that division of labour.

use crate::common;

use common::*;
use proptest::prelude::*;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::io::Write;
use std::rc::Rc;
use oikos_kernel::canon::{self, ZERO_HASH};
use oikos_kernel::log::{entry_hash, verify, Kind};
use oikos_kernel::run::Run;

#[derive(Clone, Default)]
struct Shared(Rc<RefCell<Vec<u8>>>);

impl Write for Shared {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.borrow_mut().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// A finished run with a mix of every entry kind. Returns (log, anchors).
fn sample_log() -> (Vec<u8>, Vec<u8>) {
    let anchors = Shared::default();
    let mut config = riverbend();
    config["log"]["anchor_every_entries"] = json!(5);
    let mut run = Run::start(config, "chain", Vec::new(), Some(Box::new(anchors.clone()))).unwrap();
    let act = |participant: &str, blocks: Value| {
        let (participant, position) = rb(participant);
        oikos_kernel::Command::Act { participant, position, blocks: serde_json::from_value(blocks).unwrap(), by: vec![], provenance: json!({"via": "direct"}), reasoning: Some("because".into()), thinking: None }
    };
    run.done(&act(
        "bank-payments",
        json!([{"block": "transfer", "from": "acc-city", "to": "acc-alice", "amount": "1000", "per_instruction": "so-bob-rent"}]),
    ))
    .unwrap();
    run.done(&act("mayor", json!([{"block": "transfer", "from": "acc-city", "to": "acc-alice", "amount": "1000"}]))).unwrap(); // refused: not custodian
    run.done(&act("mayor", json!([{"block": "message", "to": ["developer"], "text": "hello \"there\"\n"}]))).unwrap();
    run.annotate(json!({"annotation": "note", "subject": "test", "data": {"x": [1, "y", null]}})).unwrap();
    for m in 1..=4 {
        run.command(&oikos_kernel::Command::Advance { to: m * MONTH }).unwrap();
        run.command(&oikos_kernel::Command::Observe { participant: "mayor-system".into(), only: None }).unwrap();
    }
    run.finish("completed", None).unwrap();
    let log = run.into_log();
    let a = anchors.0.borrow().clone();
    (log, a)
}

fn entries(log: &[u8]) -> Vec<Value> {
    std::str::from_utf8(log).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
}

fn serialize(entries: &[Value]) -> Vec<u8> {
    let mut out = vec![];
    for e in entries {
        out.extend(canon::canonical_value(e).unwrap());
        out.push(b'\n');
    }
    out
}

/// Recompute every hash from `from` onwards: the "competent forger" attack.
fn rechain(entries: &mut [Value]) {
    let mut prev = ZERO_HASH.to_string();
    for e in entries.iter_mut() {
        e["prev"] = json!(prev);
        let kind: Kind = serde_json::from_value(e["kind"].clone()).unwrap();
        let h = entry_hash(e["seq"].as_u64().unwrap(), e["t"].as_i64().unwrap(), kind, &e["body"], &prev).unwrap();
        e["hash"] = json!(h);
        prev = h;
    }
}

#[test]
fn a_real_log_verifies_with_its_anchors() {
    let (log, anchors) = sample_log();
    let v = verify(&log, Some(&anchors)).unwrap();
    assert!(v.complete);
    assert!(v.anchors_checked >= 2, "expected periodic anchors plus the final one");
    let kinds: std::collections::BTreeSet<String> = entries(&log).iter().map(|e| e["kind"].as_str().unwrap().to_string()).collect();
    for k in ["header", "command", "event", "annotation", "checkpoint", "end"] {
        assert!(kinds.contains(k), "sample log lacks a {k} entry");
    }
}

#[test]
fn editing_any_field_of_any_entry_is_detected() {
    let (log, _) = sample_log();
    let original = entries(&log);
    for i in 0..original.len() {
        for field in ["seq", "t", "kind", "body", "prev", "hash"] {
            let mut es = original.clone();
            es[i][field] = match field {
                "seq" | "t" => json!(es[i][field].as_i64().unwrap() + 1),
                "kind" => json!(if es[i]["kind"] == "event" { "annotation" } else { "event" }),
                "body" => {
                    let mut b = es[i]["body"].clone();
                    b["tampered"] = json!(true);
                    b
                }
                _ => json!("f".repeat(64)),
            };
            assert!(verify(&serialize(&es), None).is_err(), "edit of {field} in entry {i} went undetected");
        }
    }
}

#[test]
fn insertion_deletion_reordering_and_reformatting_are_detected() {
    let (log, _) = sample_log();
    let es = entries(&log);
    for i in 1..es.len() {
        let mut del = es.clone();
        del.remove(i);
        if i != es.len() - 1 {
            assert!(verify(&serialize(&del), None).is_err(), "deleting entry {i} went undetected");
        }
        let mut dup = es.clone();
        dup.insert(i, es[i].clone());
        assert!(verify(&serialize(&dup), None).is_err(), "duplicating entry {i} went undetected");
        if i + 1 < es.len() {
            let mut swap = es.clone();
            swap.swap(i, i + 1);
            assert!(verify(&serialize(&swap), None).is_err(), "swapping entries {i},{} went undetected", i + 1);
        }
    }
    // Same content, non-canonical formatting.
    let pretty: Vec<u8> =
        es.iter().flat_map(|e| format!("{}\n", serde_json::to_string(e).unwrap().replace(":", ": ")).into_bytes()).collect();
    assert!(verify(&pretty, None).is_err());
}

#[test]
fn rewriting_history_and_rehashing_is_caught_only_by_anchors() {
    let (log, anchors) = sample_log();
    let mut es = entries(&log);
    let i = es.iter().position(|e| e["kind"] == "event" && e["body"]["event"] == "transfer").unwrap();
    es[i]["body"]["amount"] = json!(999_999);
    rechain(&mut es);
    let forged = serialize(&es);
    assert!(verify(&forged, None).is_ok(), "a fully rehashed chain is self-consistent; that is why anchors exist");
    let err = verify(&forged, Some(&anchors)).unwrap_err();
    assert!(err.reason.contains("witnessed hash"), "{err}");
}

#[test]
fn deleting_an_entry_and_renumbering_is_detected_by_the_links() {
    // A lazy forger deletes an entry, renumbers what follows and recomputes each
    // entry's own hash, but can't fix the links without redoing the whole chain.
    let (log, _) = sample_log();
    let mut es = entries(&log);
    let i = es.iter().position(|e| e["kind"] == "event").unwrap();
    es.remove(i);
    for (n, e) in es.iter_mut().enumerate().skip(i) {
        e["seq"] = json!(n);
        let kind: Kind = serde_json::from_value(e["kind"].clone()).unwrap();
        let prev = e["prev"].as_str().unwrap().to_string();
        e["hash"] = json!(entry_hash(n as u64, e["t"].as_i64().unwrap(), kind, &e["body"], &prev).unwrap());
    }
    let err = verify(&serialize(&es), None).unwrap_err();
    assert!(err.reason.contains("prev"), "{err}");
}

#[test]
fn checkpoints_follow_the_configured_cadence() {
    // One checkpoint per advance that crosses a checkpoint_every boundary,
    // carrying the state hash as of that advance.
    let mut run = Run::start(riverbend(), "cadence", Vec::new(), None).unwrap();
    let every = run.kernel().statics().config.log.checkpoint_every;
    let mut expected = vec![];
    for to in [every / 2, every, every + 60, 3 * every + 60, 3 * every + 120] {
        run.command(&oikos_kernel::Command::Advance { to }).unwrap();
        if [every, 3 * every + 60].contains(&to) {
            expected.push((to, run.kernel().state_hash().unwrap()));
        }
    }
    let got: Vec<(i64, String)> = entries(&run.into_log())
        .iter()
        .filter(|e| e["kind"] == "checkpoint")
        .map(|e| (e["t"].as_i64().unwrap(), e["body"]["state_hash"].as_str().unwrap().to_string()))
        .collect();
    assert_eq!(got, expected);
}

#[test]
fn truncation_is_visible_and_caught_by_anchors() {
    let (log, anchors) = sample_log();
    let es = entries(&log);
    let cut = serialize(&es[..es.len() - 3]);
    let v = verify(&cut, None).unwrap();
    assert!(!v.complete, "a truncated log must not claim to be complete");
    assert!(verify(&cut, Some(&anchors)).is_err());
    // A torn final line (crash mid-write) is rejected.
    assert!(verify(&log[..log.len() - 5], None).is_err());
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 2000, ..ProptestConfig::default() })]

    /// Any single-byte corruption anywhere in the log is detected.
    #[test]
    fn any_byte_flip_is_detected(pos in any::<prop::sample::Index>(), flip in 1u8..=255) {
        let (log, _) = SAMPLE.with(|s| s.clone());
        let mut bad = log.clone();
        let p = pos.index(bad.len());
        bad[p] ^= flip;
        prop_assert!(verify(&bad, None).is_err(), "flip at byte {} went undetected", p);
    }
}

thread_local! {
    static SAMPLE: (Vec<u8>, Vec<u8>) = sample_log();
}
