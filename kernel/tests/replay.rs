//! INVARIANT: replaying a log reproduces a byte-identical world.
//!
//! For random worlds and command sequences: replay regenerates the entire log
//! (header, commands, events, annotations, checkpoints, end) byte for byte,
//! and the final canonical world state is byte-identical to the live run's.
//! Running the same inputs twice, in fresh kernels, also gives identical logs.

mod common;

use common::*;
use proptest::prelude::*;
use serde_json::json;
use std::cell::RefCell;
use std::io::Write;
use std::rc::Rc;
use terrarium_kernel::run::{replay, ReplayError, Run};
use terrarium_kernel::Command;

/// A Write that can be read back after being moved into a Run.
#[derive(Clone, Default)]
pub struct Shared(Rc<RefCell<Vec<u8>>>);

impl Write for Shared {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.borrow_mut().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Execute ops live, with an annotation after every command; returns (log, anchors, final state).
fn live(params: &WorldParams, ops: &[Op], finish: bool) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let anchors = Shared::default();
    let mut run = Run::start(world(params), "replay-test", Vec::new(), Some(Box::new(anchors.clone()))).unwrap();
    for (i, op) in ops.iter().enumerate() {
        if let Some(cmd) = concretize(&run, op) {
            if step(&mut run, &cmd).is_none() {
                continue;
            }
            if i % 3 == 0 {
                run.annotate(json!({"annotation": "usage", "purpose": "seat", "subject": "mayor", "provider": "test", "model": "m", "input_tokens": i, "output_tokens": 3, "cost_microusd": 12})).unwrap();
            }
        }
    }
    if finish {
        run.finish("completed", None).unwrap();
    }
    let state = run.kernel().canonical_state().unwrap();
    let log = run.into_log();
    let a = anchors.0.borrow().clone();
    (log, a, state)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]

    #[test]
    fn replay_is_byte_identical(ops in proptest::collection::vec(op_strategy(), 1..60), finish in any::<bool>()) {
        let (log, anchors, state) = live(&permissive(), &ops, finish);
        let report = replay(&log, Some(&anchors)).map_err(|e| TestCaseError::fail(e.to_string()))?;
        prop_assert_eq!(&report.canonical_state, &state);
        prop_assert_eq!(report.complete, finish);
        prop_assert!(report.build_differs.is_none());

        let (log2, anchors2, state2) = live(&permissive(), &ops, finish);
        prop_assert!(log == log2, "same inputs produced different logs");
        prop_assert_eq!(anchors, anchors2);
        prop_assert_eq!(state, state2);
    }
}

#[test]
fn replay_detects_a_kernel_that_behaves_differently() {
    // Simulate a kernel change: edit a logged event and re-hash the whole chain,
    // so the chain is valid but the events no longer match what the kernel does.
    let ops: Vec<Op> =
        vec![Op::Act { seat: 0, blocks: vec![B::Transfer { from: 1, to: 3, amount: 500, to_ref: false }] }, Op::Advance { ticks: 800 }];
    let (log, _, _) = live(&permissive(), &ops, true);
    let text = String::from_utf8(log).unwrap();
    let mut entries: Vec<serde_json::Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    let i = entries.iter().position(|e| e["kind"] == "event" && e["body"]["event"] == "transfer").unwrap();
    entries[i]["body"]["amount"] = json!(501);
    let mut prev = terrarium_kernel::canon::ZERO_HASH.to_string();
    let mut forged = Vec::new();
    for e in &mut entries {
        e["prev"] = json!(prev);
        let kind: terrarium_kernel::log::Kind = serde_json::from_value(e["kind"].clone()).unwrap();
        let h = terrarium_kernel::log::entry_hash(e["seq"].as_u64().unwrap(), e["t"].as_i64().unwrap(), kind, &e["body"], &prev).unwrap();
        e["hash"] = json!(h);
        prev = h;
        forged.extend(terrarium_kernel::canon::canonical_value(e).unwrap());
        forged.push(b'\n');
    }
    assert!(terrarium_kernel::log::verify(&forged, None).is_ok(), "the forged chain is internally consistent");
    match replay(&forged, None) {
        Err(ReplayError::Diverged { line, .. }) => assert_eq!(line, i),
        other => panic!("expected divergence at line {}, got {other:?}", i + 1),
    }
}

#[test]
fn riverbend_replays_and_observations_are_reproducible() {
    let mut run = Run::start(riverbend(), "riverbend", Vec::new(), None).unwrap();
    let mut observations = vec![];
    for cmd in [
        Command::Observe { seat: "mayor".into() },
        Command::Advance { to: 40 * 86_400 },
        Command::Observe { seat: "mayor".into() },
        Command::Observe { seat: "developer".into() },
    ] {
        if let Some(o) = run.command(&cmd).unwrap().observation {
            observations.push(terrarium_kernel::canon::canonical(&o).unwrap());
        }
    }
    run.finish("completed", None).unwrap();
    let log = run.into_log();
    replay(&log, None).unwrap();

    // Same commands, fresh kernel: identical observations.
    let mut run2 = Run::start(riverbend(), "riverbend", Vec::new(), None).unwrap();
    let mut again = vec![];
    for cmd in [
        Command::Observe { seat: "mayor".into() },
        Command::Advance { to: 40 * 86_400 },
        Command::Observe { seat: "mayor".into() },
        Command::Observe { seat: "developer".into() },
    ] {
        if let Some(o) = run2.command(&cmd).unwrap().observation {
            again.push(terrarium_kernel::canon::canonical(&o).unwrap());
        }
    }
    assert_eq!(observations, again);
}
