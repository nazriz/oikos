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
use oikos_kernel::observe::{AccountItem, ChannelData, EntityItem, PositionItem, SiteCell};
use oikos_kernel::run::Run;
use oikos_kernel::Command;

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
            ChannelData::OwnRecord { .. } => {}
            ChannelData::Holdings { holdings } => {
                // A holding gone to nothing drops out of the picture (as the participant runtime's view does).
                for h in holdings {
                    if h.quantity == 0 {
                        self.holdings.remove(&(h.kind.clone(), h.at.clone()));
                    } else {
                        self.holdings.insert((h.kind.clone(), h.at.clone()), h.quantity);
                    }
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

/// (Returns how many records were handed over by reference.)
fn check_run(params: &WorldParams, ops: &[Op]) -> Result<usize, TestCaseError> {
    let mut run = Run::start(world(params), "perception", Vec::new(), None).unwrap();
    // (As for a host that keeps the records it's handed: checked below.)
    run.refer_to_records();
    let mut handed: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    let mut referred = 0;
    let mut views: BTreeMap<(String, String), View> = BTreeMap::new();
    let mut looks = 0;
    // What each participant's seat knows, taken in two ways (see below).
    let mut known: BTreeMap<String, (oikos_resolver::Knowledge, oikos_resolver::Knowledge)> = BTreeMap::new();
    for op in ops {
        let Some(cmd) = concretize(&run, op) else { continue };
        let Some(resp) = step(&mut run, &cmd) else { continue };
        let (Command::Observe { participant, .. }, Some(mut obs)) = (&cmd, resp.observation) else { continue };
        // The observation as it's hashed and delivered (its records' bytes kept from the first time each is shown) is
        // its canonical JSON, byte for byte; and a seat's knowledge takes in the same from it, with its records
        // handed over beside it, as from the whole observation.
        let before = obs.clone();
        let observed = run.observed(&mut obs).unwrap();
        prop_assert_eq!(&obs, &before, "encoding an observation changed it");
        let plain = oikos_kernel::canon::canonical(&obs).unwrap();
        prop_assert_eq!(String::from_utf8_lossy(&observed.canonical), String::from_utf8_lossy(&plain), "participant {}'s observation as delivered isn't its canonical JSON", participant);
        // And as a host that keeps the records it's handed gets it: each record whole the first time it's shown to
        // anyone and by its id from then on, which, the records put back, is the same observation.
        let mut wire: serde_json::Value = serde_json::from_slice(observed.wire.as_ref().expect("a host that keeps records is handed a form of its own")).unwrap();
        let lists = || wire["channels"].as_object().into_iter().flat_map(|m| m.iter()).filter_map(|(path, ch)| Some((path.clone(), ch.get("records")?.as_array()?.clone())));
        for (_, records) in lists().collect::<Vec<_>>() {
            for r in records.iter().filter(|r| r.is_object()) {
                let id = r["id"].as_str().unwrap().to_string();
                prop_assert!(handed.insert(id.clone(), r.clone()).is_none(), "record {} was handed over whole twice", id);
            }
        }
        for (path, records) in lists().collect::<Vec<_>>() {
            referred += records.iter().filter(|r| r.is_string()).count();
            let whole: Vec<serde_json::Value> = records.iter().map(|r| r.as_str().map_or_else(|| r.clone(), |id| handed.get(id).cloned().unwrap_or_else(|| panic!("record {id} referred to before it was handed over")))).collect();
            wire["channels"][&path]["records"] = serde_json::Value::Array(whole);
        }
        prop_assert_eq!(wire, serde_json::from_slice::<serde_json::Value>(&plain).unwrap(), "participant {}'s observation by reference, its records put back, isn't the observation", participant);
        let (whole, apart) = known.entry(participant.clone()).or_default();
        whole.absorb(&serde_json::to_value(&obs).unwrap());
        apart.absorb_seen(&oikos_kernel::kernel::seen(&obs), &observed.shown, &mut Default::default());
        prop_assert_eq!(format!("{whole:?}"), format!("{apart:?}"), "participant {}'s seat knows something else from the observation as delivered", participant);
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
                ChannelData::OwnRecord { .. } => {}
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
    Ok(referred)
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
    let referred = check_run(&default_params(), &with_looks).unwrap();
    assert!(referred > 0, "no record was shown to a second seat: handing records over by reference went unchecked");
}

/// Closing an account the participant has seen reaches its view (random runs rarely manage an empty account to close).
#[test]
fn a_closed_account_leaves_the_view() {
    let mut run = Run::start(riverbend(), "perception-close", Vec::new(), None).unwrap();
    let act = |run: &mut Run<Vec<u8>>, blocks: serde_json::Value| {
        run.done(&rb_act("bank-payments", blocks)).unwrap()
    };
    let r = act(&mut run, serde_json::json!([{"block": "open_account", "holder": "alice", "ref": "a"}]));
    let acc = match &r.events[0].body {
        oikos_kernel::events::EventBody::ActionApplied { created: Some(c), .. } => c["a"].clone(),
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

/// The case the property shrank to (2026-10-25): the finance post handed away and back to the one who held it, whose
/// first look in the new tenure is the whole file again. Said only as "what's new", it was added to what the holder had
/// from before, and every record of `finance/laws` was in the view twice. (Also in perception.proptest-regressions.)
#[test]
fn a_post_handed_back_is_shown_whole_not_twice() {
    let s = |kind, a, b, flag| Op::Smart { kind, a, b, flag };
    let ops = vec![
        s(70, 0, 0, false),
        s(187, 0, 0, false),
        s(177, 7, 0, false),
        Op::Act { actor: 0, blocks: vec![B::OpenAccount { holder: 1, to_new: true }] },
        Op::Observe { actor: 93 },
        s(83, 191, 170, false),
        s(164, 103, 39, true),
        Op::OptOut { actor: 228 },
        s(21, 65, 241, true),
        s(60, 119, 85, false),
        s(47, 148, 214, true),
        Op::Observe { actor: 34 },
    ];
    check_run(&default_params(), &ops).unwrap();
}

/// Directly: a holder given its post back is told the file is whole; someone given a post for the first time is not (there
/// is nothing of it to replace), and neither is the next look after either.
#[test]
fn a_returning_holder_is_told_the_file_is_whole() {
    let mut run = Run::start(world(&default_params()), "perception-anew", Vec::new(), None).unwrap();
    let laws = |run: &mut Run<Vec<u8>>, who: &str| -> Option<(Option<bool>, Vec<String>)> {
        let obs = run.command(&Command::Observe { participant: who.into(), only: None }).unwrap().observation.unwrap();
        match obs.channels.get("finance/laws")? {
            ChannelData::Records { records, whole, .. } => Some((*whole, records.iter().map(|r| r.id.clone()).collect())),
            other => panic!("{other:?}"),
        }
    };
    let appoint = |run: &mut Run<Vec<u8>>, by: &str, to: &str| {
        let cmd = direct(by, Some("finance"), serde_json::from_value(serde_json::json!([{"block": "appoint", "position": "finance", "participant": to}])).unwrap()).unwrap();
        let r = run.done(&cmd).unwrap();
        assert!(r.events.iter().any(|e| matches!(e.body, oikos_kernel::events::EventBody::ActionApplied { .. })), "the appointment was applied: {:?}", r.events);
    };
    let (whole, first) = laws(&mut run, "finance-system").unwrap();
    assert_eq!(whole, None, "a first look has nothing to replace");
    assert!(first.contains(&"law-river".to_string()));
    appoint(&mut run, "finance-system", "mayor-system");
    assert_eq!(laws(&mut run, "mayor-system").unwrap().0, None, "a first tenure is not told whole");
    appoint(&mut run, "mayor-system", "finance-system");
    let (whole, again) = laws(&mut run, "finance-system").unwrap();
    assert_eq!(whole, Some(true), "the post given back: its file whole, in place of what was kept");
    assert_eq!(again, first);
    assert_eq!(laws(&mut run, "finance-system").unwrap(), (None, vec![]), "and then only what's new");
}
