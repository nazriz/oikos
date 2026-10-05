//! Goods (contracts v0.5, phase B): possession is physics (D20). Over any sequence of operations, every resource
//! kind's total over the world and its edges changes only as work (a task's inputs and outputs) and construction (a
//! building's materials) account for; nobody but an edge ever holds a negative quantity; and goods move only by
//! their holder's own act.

mod common;

use common::*;
use proptest::prelude::*;
use proptest::strategy::ValueTree;
use oikos_kernel::events::EventBody;
use oikos_kernel::run::Run;

fn check_run(ops: &[Op]) -> Result<usize, TestCaseError> {
    let mut run = Run::start(world(&default_params()), "goods", Vec::new(), None).unwrap();
    let mut expected = run.kernel().state().total_goods();
    let tasks = run.kernel().statics().config.catalogue.tasks.clone();
    let types = run.kernel().statics().types.clone();
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
            match &e.body {
                EventBody::GoodsMoved { from, quantity, .. } => {
                    prop_assert!(*quantity > 0);
                    prop_assert_eq!(Some(from), acting.as_ref(), "goods moved by someone other than their holder");
                    moved += 1;
                }
                // What work and construction account for: inputs used up, outputs made, materials built in.
                EventBody::Worked { task, units, .. } => {
                    if let Some(t) = tasks.iter().find(|x| &x.id == task) {
                        for (k, per) in &t.consumes {
                            *expected.entry(k.clone()).or_insert(0) -= per * *units as i128;
                        }
                        for (k, per) in &t.produces {
                            *expected.entry(k.clone()).or_insert(0) += per * *units as i128;
                        }
                    }
                }
                EventBody::StructureStarted { structure_type, .. } => {
                    for (k, q) in &types[structure_type].materials {
                        *expected.entry(k.clone()).or_insert(0) -= q;
                    }
                }
                _ => {}
            }
        }
        let st = run.kernel().state();
        let mut have = st.total_goods();
        for k in expected.keys() {
            have.entry(k.clone()).or_insert(0);
        }
        prop_assert_eq!(&have, &expected, "goods not accounted for after {:?}", cmd);
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
