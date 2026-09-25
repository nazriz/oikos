//! Guards against vacuous property tests: the random operations used by the
//! invariant tests must actually reach the interesting parts of the world
//! (successful leases, approvals, dissolutions, payments, breaches...), not
//! just pile up refusals.

mod common;

use common::*;
use proptest::strategy::{Strategy, ValueTree};
use proptest::test_runner::{Config, TestRunner};
use std::collections::BTreeMap;
use terrarium_kernel::run::Run;

#[test]
fn random_operations_reach_the_interesting_states() {
    let mut runner = TestRunner::new_with_rng(
        Config::default(),
        proptest::test_runner::TestRng::deterministic_rng(proptest::test_runner::RngAlgorithm::ChaCha),
    );
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    let mut rejected = 0usize;
    let mut total = 0usize;
    let mut params = permissive();
    // Give the council approval duties so held proposals and approvals occur.
    params.mandates[0] = vec![(ALL_BLOCKS.to_vec(), 0, Some(20_000), 0), (ALL_BLOCKS.to_vec(), 1, None, 0b10010)];
    // And a resident with only a few powers, so denials occur.
    params.mandates[3] = vec![(vec!["message", "respond_agreement", "transfer", "terminate_agreement"], 0, None, 0)];
    for _ in 0..200 {
        let ops = proptest::collection::vec(op_strategy(), 40..60).new_tree(&mut runner).unwrap().current();
        let mut run = Run::start(world(&params), "reach", Vec::new(), None).unwrap();
        for op in &ops {
            let Some(cmd) = concretize(&run, op) else { continue };
            total += 1;
            let Some(resp) = step(&mut run, &cmd) else {
                rejected += 1;
                continue;
            };
            for e in &resp.events {
                // A rent payment below the lease's rent was clipped by a cap.
                if e.reason == Some(terrarium_kernel::events::Reason::Rent) {
                    let a = run.kernel().state().agreements.get(e.agreement.as_ref().unwrap());
                    if a.is_some_and(|a| a.terms.amount() > e.amount.unwrap()) {
                        *seen.entry("RentClipped".into()).or_default() += 1;
                    }
                }
            }
            for e in resp.events {
                let key = match (e.event, e.code, e.reason) {
                    (_, Some(code), _) => format!("{:?}/{:?}", e.event, code),
                    (_, None, Some(r)) => format!("{:?}/{:?}", e.event, r),
                    _ => format!("{:?}", e.event),
                };
                *seen.entry(key).or_default() += 1;
            }
        }
    }
    let report: Vec<String> = seen.iter().map(|(k, v)| format!("{k}: {v}")).collect();
    println!("{} commands, {} rejected as off-contract\n{}", total, rejected, report.join("\n"));
    for must in [
        "ActionApplied",
        "ActionHeld",
        "ProposalDecided",
        "EntityCreated",
        "EntityDissolved",
        "RightCreated",
        "RightTransferred",
        "StructureStarted",
        "StructureCompleted",
        "StructureDemolished",
        "RuleEnacted",
        "AgreementProposed",
        "AgreementActivated",
        "AgreementNotice",
        "MessageDelivered",
        "Transfer/Block",
        "Transfer/Rent",
        "Transfer/Wage",
        "Transfer/Construction",
        "PaymentFailed/InsufficientFunds",
        "AgreementEnded/Breach",
        "RentClipped",
        "RuleRepealed",
        "AgreementLapsed",
        "RightEnded/Expired",
        "ActionRefused/MandateDenied",
        "ActionRefused/InsufficientFunds",
        "ActionRefused/ZoningViolation",
        "ActionRefused/NotAuthorized",
        "SeatResigned",
        "Observation",
    ] {
        assert!(seen.keys().any(|k| k == must), "the generator never produced {must}:\n{}", report.join("\n"));
    }
    assert!(rejected * 3 < total, "too many generated commands are off-contract ({rejected}/{total})");
}
