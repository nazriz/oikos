//! Everything physical is somewhere, and moves only along a network (law 9; docs/design/foundations-2.md section 3). The
//! kernel's side of its backstop (`orchestrator/test/everything-is-somewhere.test.ts`), grown step by step:
//!
//! - **S1:** over any sequence of operations, a body is in one place at a time: in at most one building's spaces, never
//!   in two. (Going somewhere takes the trip: `services.rs`, `a_body_is_in_one_place_and_going_somewhere_takes_the_trip`.)

use crate::common;

use common::*;
use oikos_kernel::events::EventBody;
use oikos_kernel::run::Run;
use proptest::prelude::*;
use proptest::strategy::ValueTree;
use serde_json::Value;

/// Runs the operations, checking after each that no body is in two buildings; returns how many times a body went in somewhere.
fn check_run(config: Value, ops: &[Op]) -> Result<usize, TestCaseError> {
    let mut run = Run::start(config, "space", Vec::new(), None).unwrap();
    let mut went = 0;
    for op in ops {
        let Some(cmd) = concretize(&run, op) else { continue };
        let Some(resp) = step(&mut run, &cmd) else { continue };
        went += resp.events.iter().filter(|e| matches!(e.body, EventBody::Occupied { .. })).count();
        let st = run.kernel().state();
        let mut seen = std::collections::BTreeMap::<&str, &str>::new();
        for (structure, spaces) in st.occupancy.iter() {
            for body in spaces.values().flatten() {
                if let Some(other) = seen.insert(body.as_str(), structure.as_str()) {
                    prop_assert_eq!(other, structure.as_str(), "{} is in {} and {} at once, after {:?}", body, other, structure, cmd);
                }
            }
        }
    }
    Ok(went)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]
    #[test]
    fn a_body_is_in_one_place_at_a_time(ops in proptest::collection::vec(op_strategy(), 1..120)) {
        check_run(world(&default_params()), &ops)?;
    }
}

/// Not vacuous: bodies do go from one place to another.
#[test]
fn bodies_do_move() {
    let mut runner = proptest::test_runner::TestRunner::deterministic();
    let mut n = 0;
    for _ in 0..30 {
        let ops = proptest::collection::vec(op_strategy(), 60..61).new_tree(&mut runner).unwrap().current();
        n += check_run(world(&default_params()), &ops).unwrap();
    }
    assert!(n > 10, "only {n} bodies went in anywhere");
}
