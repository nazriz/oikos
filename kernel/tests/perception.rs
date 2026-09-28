//! INVARIANT: perception is changes, and nothing is lost.
//!
//! Each look through a channel delivers only what changed within its scope
//! since the participant last looked through it. A participant that applies those changes to
//! its own view (as the participant runtime does) must, right after every look, hold
//! exactly the full picture the channel covers. Over random worlds and random
//! command sequences, for every channel delivered in every observation.

mod common;

use common::*;
use proptest::prelude::*;
use proptest::strategy::ValueTree;
use std::collections::BTreeMap;
use terrarium_kernel::observe::{AccountItem, ChannelData, EntityItem, PositionItem, SiteCell};
use terrarium_kernel::run::Run;
use terrarium_kernel::Command;

#[derive(Default, Debug, PartialEq)]
struct View {
    accounts: BTreeMap<String, AccountItem>,
    holdings: BTreeMap<(String, String), i128>,
    records: Vec<String>,
    cells: BTreeMap<String, SiteCell>,
    entities: BTreeMap<String, EntityItem>,
    positions: BTreeMap<String, PositionItem>,
}

impl View {
    fn apply(&mut self, data: &ChannelData) {
        match data {
            ChannelData::Accounts { accounts, .. } => {
                for a in accounts {
                    if a.closed == Some(true) {
                        self.accounts.remove(&a.account);
                    } else {
                        self.accounts.insert(a.account.clone(), a.clone());
                    }
                }
            }
            ChannelData::Holdings { holdings } => {
                for h in holdings {
                    self.holdings.insert((h.kind.clone(), h.at.clone()), h.quantity);
                }
            }
            ChannelData::Records { records, whole, .. } => {
                if *whole == Some(true) {
                    self.records.clear();
                }
                self.records.extend(records.iter().map(|r| r.id.clone()))
            }
            ChannelData::Sites { cells, whole, .. } => {
                if *whole == Some(true) {
                    self.cells.clear();
                }
                for c in cells {
                    self.cells.insert(c.cell.clone(), c.clone());
                }
            }
            ChannelData::Directory { entities, positions } => {
                for e in entities {
                    self.entities.insert(e.entity.clone(), e.clone());
                }
                for p in positions {
                    self.positions.insert(p.position.clone(), p.clone());
                }
            }
        }
    }
}

fn full(data: &ChannelData) -> View {
    let mut v = View::default();
    v.apply(data);
    v
}

fn check_run(params: &WorldParams, ops: &[Op]) -> Result<(), TestCaseError> {
    let mut run = Run::start(world(params), "perception", Vec::new(), None).unwrap();
    let mut views: BTreeMap<(String, String), View> = BTreeMap::new();
    let mut looks = 0;
    for op in ops {
        let Some(cmd) = concretize(&run, op) else { continue };
        let Some(resp) = step(&mut run, &cmd) else { continue };
        let (Command::Observe { participant, .. }, Some(obs)) = (&cmd, resp.observation) else { continue };
        let reference = run.full_view(participant).unwrap();
        for (ch, data) in &obs.channels {
            let v = views.entry((participant.clone(), ch.clone())).or_default();
            v.apply(data);
            let want = full(&reference.channels[ch]);
            let mut have = View::default();
            // Compare like with like: the channel's kind decides which parts matter.
            match data {
                ChannelData::Accounts { .. } => have.accounts = v.accounts.clone(),
                ChannelData::Holdings { .. } => have.holdings = v.holdings.clone(),
                ChannelData::Records { .. } => have.records = v.records.clone(),
                ChannelData::Sites { .. } => have.cells = v.cells.clone(),
                ChannelData::Directory { .. } => {
                    have.entities = v.entities.clone();
                    have.positions = v.positions.clone();
                }
            }
            prop_assert_eq!(&have, &want, "participant {} channel {} drifted from the full picture", participant, ch);
            looks += 1;
        }
    }
    let _ = looks;
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]
    #[test]
    fn a_view_built_from_changes_equals_the_full_picture(ops in proptest::collection::vec(op_strategy(), 1..120)) {
        check_run(&default_params(), &ops)?;
    }
}

/// Watching many looks happen, not just a few: a long deterministic sequence with frequent observes.
#[test]
fn many_looks_over_a_long_run() {
    let mut runner = proptest::test_runner::TestRunner::deterministic();
    let ops = proptest::collection::vec(op_strategy(), 400..401).new_tree(&mut runner).unwrap().current();
    let with_looks: Vec<Op> = ops.into_iter().flat_map(|o| [o, Op::Observe { actor: 0 }, Op::Observe { actor: 3 }, Op::Observe { actor: 6 }]).collect();
    check_run(&default_params(), &with_looks).unwrap();
}

/// Closing an account the participant has seen reaches its view (random runs rarely manage an empty account to close).
#[test]
fn a_closed_account_leaves_the_view() {
    let mut run = Run::start(riverbend(), "perception-close", Vec::new(), None).unwrap();
    let act = |run: &mut Run<Vec<u8>>, blocks: serde_json::Value| {
        run.command(&rb_act("bank-payments", blocks)).unwrap()
    };
    let r = act(&mut run, serde_json::json!([{"block": "open_account", "holder": "alice", "ref": "a"}]));
    let acc = match &r.events[0].body {
        terrarium_kernel::events::EventBody::ActionApplied { created: Some(c), .. } => c["a"].clone(),
        other => panic!("{other:?}"),
    };
    let mut view = View::default();
    let look = |run: &mut Run<Vec<u8>>, view: &mut View| {
        let obs = run.command(&Command::Observe { participant: "bank-payments-system".into(), only: None }).unwrap().observation.unwrap();
        for data in obs.channels.values() {
            if matches!(data, ChannelData::Accounts { .. }) {
                view.apply(data);
            }
        }
    };
    look(&mut run, &mut view);
    assert!(view.accounts.contains_key(&acc));
    act(&mut run, serde_json::json!([{"block": "close_account", "account": acc}]));
    look(&mut run, &mut view);
    assert!(!view.accounts.contains_key(&acc), "the closure reached the view");
    let reference = run.full_view("bank-payments-system").unwrap();
    let want: Vec<String> = reference.channels.values().flat_map(|c| match c { ChannelData::Accounts { accounts, .. } => accounts.iter().map(|a| a.account.clone()).collect(), _ => vec![] }).collect();
    assert_eq!(view.accounts.keys().cloned().collect::<Vec<_>>(), want);
}
