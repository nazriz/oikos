//! INVARIANT: money is conserved across any sequence of actions.
//!
//! Over random worlds and random command sequences (many of them refused,
//! which is the point), after every command:
//!   1. total money, including the edges' accounts, equals the opening total in each currency;
//!   2. no ordinary account is negative;
//!   3. every account's balance equals its opening balance plus the `transfer`
//!      events logged so far: no money moves without a transfer event;
//!   4. every payment was executed by someone acting for the paying account's custodian.

use crate::common;

use common::*;
use proptest::prelude::*;
use std::collections::BTreeMap;
use oikos_kernel::events::EventBody;
use oikos_kernel::run::Run;

fn check_run(params: &WorldParams, ops: &[Op]) -> Result<(), TestCaseError> {
    let mut run = Run::start(world(params), "money", Vec::new(), None).unwrap();
    let opening = run.kernel().state().total_money();
    let mut ledger: BTreeMap<String, i128> = run.kernel().state().accounts.iter().map(|(k, a)| (k.clone(), a.balance)).collect();
    let edges = run.kernel().statics().boundaries.clone();

    for op in ops {
        let Some(cmd) = concretize(&run, op) else { continue };
        let before = run.kernel().state().accounts.clone();
        let Some(resp) = step(&mut run, &cmd) else { continue };
        // Who acted, and for whom: the capacity the action was made in.
        let acting = resp.events.iter().find_map(|e| match &e.body {
            EventBody::ActionApplied { participant, position, .. } => run.kernel().state().acting_entity(participant, position.as_deref()),
            _ => None,
        });
        for e in &resp.events {
            if let EventBody::Transfer { from, to, amount, .. } = &e.body {
                prop_assert!(*amount > 0);
                // An account opened earlier in this same action isn't in `before`.
                let src = before.get(from).or_else(|| run.kernel().state().accounts.get(from)).expect("paying account existed");
                let by_entity = acting.clone().expect("money moves only in an applied action");
                // Every movement of money is executed by the custodian of the account it leaves (construction no longer
                // moves money: phase B).
                prop_assert_eq!(by_entity.as_str(), src.custodian.as_str(), "payment not executed by the custodian");
                *ledger.entry(from.clone()).or_insert(0) -= *amount;
                *ledger.entry(to.clone()).or_insert(0) += *amount;
            }
        }
        let st = run.kernel().state();
        prop_assert_eq!(&st.total_money(), &opening, "money created or destroyed by {:?}", cmd);
        for (id, a) in &st.accounts {
            if !edges.contains(&a.holder) {
                prop_assert!(a.balance >= 0, "{} went negative ({}) after {:?}", id, a.balance, cmd);
            }
            prop_assert_eq!(
                ledger.get(id).copied().unwrap_or(0),
                a.balance,
                "{}'s balance moved without a transfer event after {:?}",
                id,
                cmd
            );
        }
        for (id, bal) in &ledger {
            if !st.accounts.contains_key(id) {
                prop_assert_eq!(*bal, 0, "account {} was closed while holding money", id);
            }
        }
    }
    Ok(())
}

fn balances() -> impl Strategy<Value = Vec<i64>> {
    proptest::collection::vec(prop_oneof![0i64..100_000, 100_000i64..50_000_000, Just(9_007_199_254_000_000i64)], 7)
        .prop_filter("total must fit", |v| v.iter().map(|x| *x as i128).sum::<i128>() <= 9_007_199_254_740_991)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, ..ProptestConfig::default() })]

    #[test]
    fn money_is_conserved(bal in balances(), ops in proptest::collection::vec(op_strategy(), 1..60)) {
        let mut params = default_params();
        params.balances = bal;
        check_run(&params, &ops)?;
    }
}
