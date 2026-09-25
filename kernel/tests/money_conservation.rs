//! INVARIANT: money is conserved across any sequence of actions.
//!
//! Over random worlds and random command sequences (most of which the kernel
//! refuses, which is the point), after every command:
//!   1. total money, including the boundary entity, equals the opening total;
//!   2. no ordinary balance is negative;
//!   3. every balance equals its opening balance plus the `transfer` events
//!      logged so far: no money moves without a transfer event.

mod common;

use common::*;
use proptest::prelude::*;
use std::collections::BTreeMap;
use terrarium_kernel::events::{EventName, OneOrMany};
use terrarium_kernel::run::Run;

fn check_run(params: &WorldParams, ops: &[Op]) -> Result<(), TestCaseError> {
    let config = world(params);
    let mut run = Run::start(config, "money", Vec::new(), None).unwrap();
    let st = run.kernel().state();
    let opening: i128 = st.total_money();
    let mut ledger: BTreeMap<String, i128> = st.entities.iter().map(|(k, e)| (k.clone(), e.balance as i128)).collect();
    let boundary = run.kernel().statics().boundary.clone();

    for op in ops {
        let Some(cmd) = concretize(&run, op) else { continue };
        let Some(resp) = step(&mut run, &cmd) else { continue };
        for e in &resp.events {
            if e.event == EventName::Transfer {
                let amount = e.amount.unwrap() as i128;
                prop_assert!(amount > 0, "transfer of non-positive amount {amount}");
                let Some(OneOrMany::One(to)) = &e.to else { panic!("transfer without a single recipient") };
                *ledger.get_mut(e.from.as_ref().unwrap()).unwrap() -= amount;
                *ledger.entry(to.clone()).or_insert(0) += amount;
            }
        }
        let st = run.kernel().state();
        prop_assert_eq!(st.total_money(), opening, "money created or destroyed by {:?}", cmd);
        for (id, e) in &st.entities {
            if *id != boundary {
                prop_assert!(e.balance >= 0, "{} went negative ({}) after {:?}", id, e.balance, cmd);
            }
            prop_assert_eq!(
                ledger.get(id).copied().unwrap_or(0),
                e.balance as i128,
                "{}'s balance moved without a transfer event after {:?}",
                id,
                cmd
            );
        }
    }
    Ok(())
}

fn balances() -> impl Strategy<Value = Vec<i64>> {
    proptest::collection::vec(prop_oneof![0i64..100_000, 100_000i64..5_000_000, Just(9_007_199_254_740_000i64)], 6)
        .prop_filter("total must fit", |v| v.iter().map(|x| *x as i128).sum::<i128>() <= 9_007_199_254_740_991)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, ..ProptestConfig::default() })]

    #[test]
    fn money_is_conserved(bal in balances(), ops in proptest::collection::vec(op_strategy(), 1..60)) {
        let mut params = permissive();
        params.balances = bal;
        check_run(&params, &ops)?;
    }
}

#[test]
fn rent_and_wages_move_money_without_creating_it() {
    // Long quiet run: only scheduled payments, until tenants run dry and breach.
    let mut run = Run::start(world(&permissive()), "money-quiet", Vec::new(), None).unwrap();
    let opening = run.kernel().state().total_money();
    let end = run.kernel().statics().run_end();
    let mut breached = false;
    while run.kernel().t() < end {
        let to = (run.kernel().t() + 7 * 86_400).min(end);
        let resp = run.command(&terrarium_kernel::Command::Advance { to }).unwrap();
        breached |= resp.events.iter().any(|e| e.event == EventName::PaymentFailed);
        assert_eq!(run.kernel().state().total_money(), opening);
    }
    assert!(breached, "bob's 8,000 cents cannot cover 40 months of 1,800 rent");
}
