//! INVARIANT: no action takes effect unless it passes the acting seat's mandate.
//!
//! An independent oracle (written here from the contract's wording, reading
//! mandates straight from the config JSON, sharing no code with the kernel's
//! mandate module) decides each action's level. Then:
//!   - denied            -> exactly one event, action_refused/mandate_denied, and no change to the world;
//!   - approval/request  -> held/forwarded (or refused as unlawful), and no change to the world;
//!   - an action applied via a proposal had an approval proposal, and every
//!     required approver approved it, exactly once; a request never applies;
//!   - an action applied directly came from a direct-level act.

mod common;

use common::*;
use proptest::prelude::*;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use terrarium_kernel::blocks::Block;
use terrarium_kernel::events::{EventDecision, EventName, RefusalCode};
use terrarium_kernel::run::Run;
use terrarium_kernel::state::{SeatStatus, State};
use terrarium_kernel::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Oracle {
    Denied(usize),
    /// 0 direct, 1 approval, 2 request; with the seats that must respond.
    Level(u8, BTreeSet<String>),
}

fn oracle(config: &Value, st: &State, seat: &str, blocks: &[Block]) -> Oracle {
    let seat_cfg = config["seats"].as_array().unwrap().iter().find(|s| s["id"] == seat).unwrap();
    let catalogue = config["catalogue"]["structure_types"].as_array().unwrap();
    let cost = |ty: &str, field: &str| catalogue.iter().find(|t| t["id"] == ty).map(|t| t[field].as_i64().unwrap());
    let mut worst = 0u8;
    let mut targets: BTreeMap<u8, BTreeSet<String>> = BTreeMap::new();
    for (i, b) in blocks.iter().enumerate() {
        // None: no amount concept. Some(None): amount unknowable.
        let amount: Option<Option<i64>> = match b {
            Block::Transfer { amount, .. } => Some(Some(*amount)),
            Block::Construct { structure_type, .. } => Some(cost(structure_type, "cost")),
            Block::Demolish { structure, .. } => Some(st.structures.get(structure).and_then(|s| cost(&s.structure_type, "demolish_cost"))),
            Block::ProposeAgreement { terms, .. } => Some(Some(terms.amount())),
            _ => None,
        };
        let matched = seat_cfg["mandate"]["powers"].as_array().unwrap().iter().find(|p| {
            let names = p["blocks"].as_array().unwrap();
            if !names.iter().any(|n| n == b.name()) {
                return false;
            }
            match (p["limits"]["max_amount"].as_i64(), amount) {
                (None, _) | (Some(_), None) => true,
                (Some(max), Some(Some(a))) => a <= max,
                (Some(_), Some(None)) => false,
            }
        });
        let Some(p) = matched else { return Oracle::Denied(i) };
        let level = match p["level"].as_str().unwrap() {
            "direct" => 0,
            "approval" => 1,
            _ => 2,
        };
        worst = worst.max(level);
        let key = if level == 1 { "approvers" } else { "request_to" };
        if level > 0 {
            targets.entry(level).or_default().extend(p[key].as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()));
        }
    }
    Oracle::Level(worst, targets.remove(&worst).unwrap_or_default())
}

/// The parts of the world an action can change (not bookkeeping like id counters or outcomes).
fn world_of(st: &State) -> Value {
    json!({
        "entities": st.entities, "rights": st.rights, "structures": st.structures,
        "rules": st.rules, "agreements": st.agreements, "schedule": st.schedule,
    })
}

fn check(params: &WorldParams, ops: &[Op]) -> Result<(), TestCaseError> {
    let config = world(params);
    let mut run = Run::start(config.clone(), "mandate", Vec::new(), None).unwrap();
    // proposal -> (level, required seats)
    let mut proposals: BTreeMap<String, (u8, BTreeSet<String>)> = BTreeMap::new();
    let mut approvals: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut applied_proposals = BTreeSet::new();

    for op in ops {
        let Some(cmd) = concretize(&run, op) else { continue };
        let before = run.kernel().state().clone();
        let Some(resp) = step(&mut run, &cmd) else { continue };
        let after = run.kernel().state();

        if let Command::Act { seat, blocks, .. } = &cmd {
            let first = &resp.events[0];
            if before.seats[seat].status == SeatStatus::Resigned {
                prop_assert_eq!(resp.events.len(), 1);
                prop_assert_eq!(first.code, Some(RefusalCode::SeatResigned));
                prop_assert_eq!(world_of(&before), world_of(after));
                continue;
            }
            match oracle(&config, &before, seat, blocks) {
                Oracle::Denied(i) => {
                    prop_assert_eq!(resp.events.len(), 1, "denied action had effects: {:?}", resp.events);
                    prop_assert_eq!(first.event, EventName::ActionRefused);
                    prop_assert_eq!(first.code, Some(RefusalCode::MandateDenied));
                    prop_assert_eq!(first.block, Some(i));
                    prop_assert_eq!(world_of(&before), world_of(after));
                }
                Oracle::Level(level @ (1 | 2), targets) => {
                    prop_assert_eq!(resp.events.len(), 1, "held action had effects: {:?}", resp.events);
                    prop_assert_eq!(world_of(&before), world_of(after));
                    match first.event {
                        EventName::ActionRefused => prop_assert_ne!(first.code, Some(RefusalCode::MandateDenied)),
                        EventName::ActionHeld | EventName::ActionForwarded => {
                            prop_assert_eq!(first.event == EventName::ActionHeld, level == 1);
                            let awaiting: BTreeSet<String> = first.awaiting.clone().unwrap().into_iter().collect();
                            prop_assert_eq!(&awaiting, &targets);
                            proposals.insert(first.proposal.clone().unwrap(), (level, targets));
                        }
                        other => prop_assert!(false, "unexpected {:?} for a level-{} action", other, level),
                    }
                }
                Oracle::Level(_, _) => {
                    prop_assert!(matches!(first.event, EventName::ActionApplied | EventName::ActionRefused));
                    prop_assert!(first.proposal.is_none());
                    if first.event == EventName::ActionRefused {
                        prop_assert_ne!(first.code, Some(RefusalCode::MandateDenied));
                        prop_assert_eq!(world_of(&before), world_of(after));
                    }
                }
            }
        }

        for (i, e) in resp.events.iter().enumerate() {
            if e.event == EventName::ProposalDecided && e.decision == Some(EventDecision::Approve) {
                let p = e.proposal.clone().unwrap();
                let fresh = approvals.entry(p).or_default().insert(e.by.clone().unwrap());
                prop_assert!(fresh, "a seat approved the same proposal twice");
            }
            if e.event == EventName::ActionApplied {
                match &e.proposal {
                    Some(p) => {
                        let (level, required) = proposals.get(p).cloned().expect("applied proposal was never held");
                        prop_assert_eq!(level, 1, "a request was applied");
                        prop_assert_eq!(approvals.get(p).cloned().unwrap_or_default(), required, "applied without every approval");
                        prop_assert!(applied_proposals.insert(p.clone()), "proposal applied twice");
                    }
                    None => prop_assert!(i == 0 && matches!(cmd, Command::Act { .. }), "direct application not caused by its own act"),
                }
            }
        }
    }
    Ok(())
}

fn mandates() -> impl Strategy<Value = Vec<Vec<PowerSpec>>> {
    let power = (
        proptest::sample::subsequence(ALL_BLOCKS.to_vec(), 1..8),
        prop_oneof![3 => Just(0u8), 2 => Just(1u8), 1 => Just(2u8)],
        proptest::option::of(prop_oneof![1i64..5_000, 5_000i64..200_000]),
        0u8..32,
    );
    proptest::collection::vec(proptest::collection::vec(power, 0..4), 5)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, ..ProptestConfig::default() })]

    #[test]
    fn nothing_bypasses_a_mandate(m in mandates(), ops in proptest::collection::vec(op_strategy(), 1..60)) {
        let mut params = permissive();
        params.mandates = m;
        check(&params, &ops)?;
    }

    #[test]
    fn a_seat_without_powers_changes_nothing(ops in proptest::collection::vec(op_strategy(), 1..40)) {
        let mut params = permissive();
        params.mandates = vec![vec![]; 5];
        check(&params, &ops)?;
        let mut run = Run::start(world(&params), "powerless", Vec::new(), None).unwrap();
        for op in &ops {
            if let Some(cmd) = concretize(&run, op) {
                let Some(resp) = step(&mut run, &cmd) else { continue };
                prop_assert!(resp.events.iter().all(|e| e.event != EventName::ActionApplied));
            }
        }
    }
}

// ---- Concrete approval and request flows in the Riverbend example ----

fn act(seat: &str, blocks: Value) -> Command {
    Command::Act {
        seat: seat.into(),
        blocks: serde_json::from_value(blocks).unwrap(),
        provenance: json!({"via": "direct"}),
        reasoning: None,
    }
}

#[test]
fn approval_flow_holds_revalidates_and_applies_once() {
    let mut run = Run::start(riverbend(), "approval", Vec::new(), None).unwrap();
    let city = |r: &Run<Vec<u8>>| r.kernel().state().entities["city"].balance;
    let start = city(&run);

    // $600,000 exceeds the mayor's $50,000 direct limit: held for the council.
    let r = run.command(&act("mayor", json!([{"block": "transfer", "from": "city", "to": "devco", "amount": 60_000_000}]))).unwrap();
    assert_eq!(r.events[0].event, EventName::ActionHeld);
    let prp = r.events[0].proposal.clone().unwrap();
    assert_eq!(city(&run), start);

    // The developer is not an approver; the council can't approve twice.
    let r = run.command(&act("developer", json!([{"block": "decide", "proposal": prp, "decision": "approve"}]))).unwrap();
    assert_eq!(r.events[0].code, Some(RefusalCode::MandateDenied));
    let r = run.command(&act("council-seat", json!([{"block": "decide", "proposal": prp, "decision": "approve"}]))).unwrap();
    let kinds: Vec<EventName> = r.events.iter().map(|e| e.event).collect();
    assert_eq!(kinds, vec![EventName::ActionApplied, EventName::ProposalDecided, EventName::ActionApplied, EventName::Transfer]);
    assert_eq!(city(&run), start - 60_000_000);
    let r = run.command(&act("council-seat", json!([{"block": "decide", "proposal": prp, "decision": "approve"}]))).unwrap();
    assert_eq!(r.events[0].code, Some(RefusalCode::UnknownProposal));

    // Re-validation: a held transfer the city can no longer afford is refused on approval.
    let r = run.command(&act("mayor", json!([{"block": "transfer", "from": "city", "to": "devco", "amount": 400_000_000}]))).unwrap();
    let prp = r.events[0].proposal.clone().unwrap();
    for _ in 0..10 {
        run.command(&act("mayor", json!([{"block": "transfer", "from": "city", "to": "council", "amount": 5_000_000}]))).unwrap();
    }
    let r = run.command(&act("council-seat", json!([{"block": "decide", "proposal": prp, "decision": "approve"}]))).unwrap();
    let refused = r.events.iter().find(|e| e.event == EventName::ActionRefused).unwrap();
    assert_eq!(refused.code, Some(RefusalCode::InsufficientFunds));
    assert_eq!(refused.proposal.as_deref(), Some(prp.as_str()));
}

#[test]
fn a_bundle_takes_its_strictest_level() {
    let mut run = Run::start(riverbend(), "bundle", Vec::new(), None).unwrap();
    let before = run.kernel().state().entities["city"].balance;
    // A small direct transfer bundled with a rule change (approval): the whole bundle waits.
    let r = run.command(&act("mayor", json!([
        {"block": "transfer", "from": "city", "to": "devco", "amount": 100},
        {"block": "enact_rule", "jurisdiction": "city", "rule": {"type": "rent_cap", "parcels": "all", "max_per_30d": 150_000, "applies_to": "new_agreements"}}
    ]))).unwrap();
    assert_eq!(r.events.len(), 1);
    assert_eq!(r.events[0].event, EventName::ActionHeld);
    assert_eq!(run.kernel().state().entities["city"].balance, before);
}

#[test]
fn a_request_is_forwarded_and_never_applied() {
    let mut run = Run::start(riverbend(), "request", Vec::new(), None).unwrap();
    let rules_before = run.kernel().state().rules.clone();
    let r = run.command(&act("developer", json!([{"block": "enact_rule", "jurisdiction": "city", "rule": {"type": "zoning", "parcels": ["p12"], "allow": ["residential", "commercial"]}}]))).unwrap();
    assert_eq!(r.events[0].event, EventName::ActionForwarded);
    let prp = r.events[0].proposal.clone().unwrap();
    let obs = run.command(&Command::Observe { seat: "mayor".into() }).unwrap().observation.unwrap();
    assert_eq!(obs.awaiting.len(), 1);
    // The mayor has no `decide` power in Riverbend, so it can't even answer the request.
    let r = run.command(&act("mayor", json!([{"block": "decide", "proposal": prp, "decision": "approve"}]))).unwrap();
    assert_eq!(r.events[0].code, Some(RefusalCode::MandateDenied));
    assert_eq!(run.kernel().state().rules, rules_before);
}
