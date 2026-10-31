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
use oikos_kernel::run::{replay, ReplayError, Run};
use oikos_kernel::Command;

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
    let (log, anchors, state, _) = live_planning(params, ops, finish, None);
    (log, anchors, state)
}

/// `live`, with observations planned ahead (`Run::plan`) every `every` ops, to be made ready on three threads:
/// everyone, in each way they could be asked to observe, starting from a different one each time (so what's asked for
/// next is sometimes the next planned, sometimes further on, sometimes never asked for at all). Also returns how
/// many observations were delivered as they had been made ready.
fn live_planning(params: &WorldParams, ops: &[Op], finish: bool, every: Option<usize>) -> (Vec<u8>, Vec<u8>, Vec<u8>, u64) {
    let anchors = Shared::default();
    let mut run = Run::start(world(params), "replay-test", Vec::new(), Some(Box::new(anchors.clone()))).unwrap();
    if every.is_some() {
        run.share(3, Some(1));
    }
    for (i, op) in ops.iter().enumerate() {
        if every.is_some_and(|n| i % n == 0) {
            let st = run.kernel().state();
            let mut who: Vec<(oikos_kernel::blocks::Id, Option<oikos_kernel::blocks::Id>)> = st.participants.keys().flat_map(|p| [(*p, None), (*p, Some("self".into()))]).collect();
            who.extend(st.positions.iter().filter_map(|(id, x)| Some((x.holder?, Some(*id)))));
            who.push(("nobody".into(), None));
            let n = who.len();
            who.rotate_left(i % n);
            run.plan(who);
        }
        if let Some(cmd) = concretize(&run, op) {
            if step(&mut run, &cmd).is_none() {
                continue;
            }
            if i % 3 == 0 {
                run.annotate(json!({"annotation": "usage", "purpose": "participant", "subject": "mayor", "provider": "test", "model": "m", "input_tokens": i, "output_tokens": 3, "cost_microusd": 12})).unwrap();
            }
        }
    }
    if finish {
        run.finish("completed", None).unwrap();
    }
    let state = run.kernel().canonical_state().unwrap();
    let from_ready = run.kernel().from_ready();
    let log = run.into_log();
    let a = anchors.0.borrow().clone();
    (log, a, state, from_ready)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]

    #[test]
    fn replay_is_byte_identical(ops in proptest::collection::vec(op_strategy(), 1..60), finish in any::<bool>()) {
        let (log, anchors, state) = live(&default_params(), &ops, finish);
        let report = replay(&log, Some(&anchors)).map_err(|e| TestCaseError::fail(e.to_string()))?;
        prop_assert_eq!(&report.canonical_state, &state);
        prop_assert_eq!(report.complete, finish);
        prop_assert!(report.build_differs.is_none());

        let (log2, anchors2, state2) = live(&default_params(), &ops, finish);
        prop_assert!(log == log2, "same inputs produced different logs");
        prop_assert_eq!(anchors, anchors2);
        prop_assert_eq!(state, state2);
    }

    /// Observations made ready ahead, several at once on other threads, are the observations built when asked for:
    /// the same log, byte for byte, and the same world, however often they're planned.
    #[test]
    fn observations_made_ready_ahead_change_nothing(ops in proptest::collection::vec(op_strategy(), 1..60), every in 1usize..6) {
        let (log, anchors, state) = live(&default_params(), &ops, true);
        let (log2, anchors2, state2, _) = live_planning(&default_params(), &ops, true, Some(every));
        prop_assert!(log == log2, "planning observations ahead changed the log");
        prop_assert_eq!(anchors, anchors2);
        prop_assert_eq!(state, state2);
    }
}

#[test]
fn observations_planned_are_delivered_as_made_ready() {
    // Everyone looks, someone pays, everyone looks again, time moves on, everyone looks: with every look planned
    // ahead, most are delivered as they were made ready, and the log is the one written without.
    let mut ops: Vec<Op> = (0..12).map(|actor| Op::Observe { actor }).collect();
    ops.push(Op::Smart { kind: 0, a: 0, b: 1, flag: false });
    ops.extend((0..12).map(|actor| Op::Observe { actor }));
    ops.push(Op::Advance { ticks: 800 });
    ops.extend((0..12).map(|actor| Op::Observe { actor }));
    let (log, _, state) = live(&default_params(), &ops, true);
    let (log2, _, state2, from_ready) = live_planning(&default_params(), &ops, true, Some(1));
    assert!(log == log2 && state == state2, "planning observations ahead changed the run");
    assert!(from_ready >= 30, "only {from_ready} of 36 observations were delivered as made ready");
}

#[test]
fn replay_detects_a_kernel_that_behaves_differently() {
    // Simulate a kernel change: edit a logged event and re-hash the whole chain,
    // so the chain is valid but the events no longer match what the kernel does.
    let ops: Vec<Op> = vec![Op::Smart { kind: 0, a: 0, b: 1, flag: false }, Op::Advance { ticks: 800 }];
    let (log, _, _) = live(&default_params(), &ops, true);
    let text = String::from_utf8(log).unwrap();
    let mut entries: Vec<serde_json::Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    let i = entries.iter().position(|e| e["kind"] == "event" && e["body"]["event"] == "transfer").unwrap();
    entries[i]["body"]["amount"] = json!(501);
    let mut prev = oikos_kernel::canon::ZERO_HASH.to_string();
    let mut forged = Vec::new();
    for e in &mut entries {
        e["prev"] = json!(prev);
        let kind: oikos_kernel::log::Kind = serde_json::from_value(e["kind"].clone()).unwrap();
        let h = oikos_kernel::log::entry_hash(e["seq"].as_u64().unwrap(), e["t"].as_i64().unwrap(), kind, &e["body"], &prev).unwrap();
        e["hash"] = json!(h);
        prev = h;
        forged.extend(oikos_kernel::canon::canonical_value(e).unwrap());
        forged.push(b'\n');
    }
    assert!(oikos_kernel::log::verify(&forged, None).is_ok(), "the forged chain is internally consistent");
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
        Command::Observe { participant: "mayor-system".into(), only: None },
        Command::Advance { to: 40 * 86_400 },
        Command::Observe { participant: "mayor-system".into(), only: None },
        Command::Observe { participant: "developer-system".into(), only: None },
    ] {
        if let Some(o) = run.done(&cmd).unwrap().observation {
            observations.push(oikos_kernel::canon::canonical(&o).unwrap());
        }
    }
    run.finish("completed", None).unwrap();
    let log = run.into_log();
    replay(&log, None).unwrap();

    // Same commands, fresh kernel: identical observations.
    let mut run2 = Run::start(riverbend(), "riverbend", Vec::new(), None).unwrap();
    let mut again = vec![];
    for cmd in [
        Command::Observe { participant: "mayor-system".into(), only: None },
        Command::Advance { to: 40 * 86_400 },
        Command::Observe { participant: "mayor-system".into(), only: None },
        Command::Observe { participant: "developer-system".into(), only: None },
    ] {
        if let Some(o) = run2.done(&cmd).unwrap().observation {
            again.push(oikos_kernel::canon::canonical(&o).unwrap());
        }
    }
    assert_eq!(observations, again);
}
