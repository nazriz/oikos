//! Goods (contracts v0.5, phase B): possession is physics (D20). Over any sequence of operations, every resource
//! kind's total over the world and its edges is unchanged (only work changes it, and there is none here); nobody but
//! an edge ever holds a negative quantity; and goods move only by their holder's own act.

mod common;

use common::*;
use proptest::prelude::*;
use proptest::strategy::ValueTree;
use terrarium_kernel::events::EventBody;
use terrarium_kernel::run::Run;

fn check_run(ops: &[Op]) -> Result<usize, TestCaseError> {
    let mut run = Run::start(world(&default_params()), "goods", Vec::new(), None).unwrap();
    let opening = run.kernel().state().total_goods();
    let edges = run.kernel().statics().boundaries.clone();
    let mut moved = 0;
    for op in ops {
        let Some(cmd) = concretize(&run, op) else { continue };
        let Some(resp) = step(&mut run, &cmd) else { continue };
        let acting = resp.events.iter().find_map(|e| match &e.body {
            EventBody::ActionApplied { participant, position, .. } => run.kernel().state().acting_entity(participant, position.as_deref()),
            _ => None,
        });
        for e in &resp.events {
            if let EventBody::GoodsMoved { from, quantity, .. } = &e.body {
                prop_assert!(*quantity > 0);
                prop_assert_eq!(Some(from), acting.as_ref(), "goods moved by someone other than their holder");
                moved += 1;
            }
        }
        let st = run.kernel().state();
        prop_assert_eq!(&st.total_goods(), &opening, "goods created or destroyed by {:?}", cmd);
        for h in st.holdings.values() {
            prop_assert!(h.quantity >= 0 || edges.contains(&h.holder), "{} holds {} of {} at {}", h.holder, h.quantity, h.kind, h.at);
        }
    }
    Ok(moved)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]
    #[test]
    fn goods_are_conserved_and_move_only_by_their_holder(ops in proptest::collection::vec(op_strategy(), 1..120)) {
        check_run(&ops)?;
    }
}

/// Not vacuous: goods do move (imports, deliveries) and edges go negative. Over many short runs, since in one long run
/// the shop and the house tend to be demolished early, and then there's nowhere left to deliver.
#[test]
fn goods_do_move() {
    let mut runner = proptest::test_runner::TestRunner::deterministic();
    let mut n = 0;
    for _ in 0..50 {
        let ops = proptest::collection::vec(op_strategy(), 60..61).new_tree(&mut runner).unwrap().current();
        n += check_run(&ops).unwrap();
    }
    assert!(n > 20, "only {n} moves");
}
