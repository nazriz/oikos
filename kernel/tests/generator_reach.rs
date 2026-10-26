//! Guards against vacuous property tests: the random operations used by the
//! invariant tests must actually reach the interesting parts of the world
//! (payments by banks and by people holding their own money, building,
//! demolition with people inside, eviction, arrivals, departures, births,
//! illness, injury, harm, death, appointments, every kind of record, refusals
//! of every physical kind), not just pile up refusals.

use crate::common;

use common::*;
use proptest::strategy::{Strategy, ValueTree};
use proptest::test_runner::{Config, RngAlgorithm, TestRng, TestRunner};
use std::collections::BTreeMap;
use oikos_kernel::events::EventBody;
use oikos_kernel::run::Run;

#[test]
fn random_operations_reach_the_interesting_states() {
    let mut runner = TestRunner::new_with_rng(Config::default(), TestRng::deterministic_rng(RngAlgorithm::ChaCha));
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    let (mut rejected, mut total) = (0usize, 0usize);
    for _ in 0..300 {
        let ops = proptest::collection::vec(op_strategy(), 40..60).new_tree(&mut runner).unwrap().current();
        let mut run = Run::start(world(&default_params()), "reach", Vec::new(), None).unwrap();
        for op in &ops {
            let Some(cmd) = concretize(&run, op) else { continue };
            total += 1;
            let Some(resp) = step(&mut run, &cmd) else {
                rejected += 1;
                continue;
            };
            for e in resp.events {
                let v = serde_json::to_value(&e.body).unwrap();
                let key = match &e.body {
                    EventBody::ActionRefused { code, .. } => format!("refused/{}", serde_json::to_value(code).unwrap().as_str().unwrap()),
                    EventBody::Transfer { .. } | EventBody::Vacated { .. } => {
                        format!("{}/{}", e.body.name(), v["reason"].as_str().unwrap())
                    }
                    EventBody::Recorded { record } => format!("recorded/{}", record.body.kind_name()),
                    _ => e.body.name().to_string(),
                };
                *seen.entry(key).or_default() += 1;
            }
        }
    }
    let report: Vec<String> = seen.iter().map(|(k, v)| format!("{k}: {v}")).collect();
    println!("{total} commands, {rejected} rejected as off-contract\n{}", report.join("\n"));
    for must in [
        "action_applied",
        "transfer/payment",
        "worked",
        "demolition_started",
        "refused/no_time_left",
        "refused/not_at_work",
        "refused/unknown_task",
        "transfer/carried",
        "account_opened",
        "account_closed",
        "goods_moved",
        "refused/insufficient_quantity",
        "refused/unknown_resource",
        "structure_started",
        "structure_completed",
        "structure_demolished",
        "occupied",
        "vacated/left",
        "vacated/removed",
        "vacated/demolition",
        "vacated/departed",
        "entity_created",
        "message_delivered",
        "observation",
        "participant_opted_out",
        "person_created",
        "person_arrived",
        "person_left",
        "person_died",
        "birth_started",
        "condition_began",
        "condition_ended",
        "harmed",
        "participant_created",
        "participant_ended",
        "position_created",
        "appointed",
        "recorded/claim",
        "recorded/claim_transfer",
        "recorded/claim_release",
        "recorded/agreement",
        "recorded/signature",
        "recorded/notice",
        "recorded/statement",
        "recorded/withdrawal",
        "recorded/vote",
        "recorded/entity_declaration",
        "refused/not_custodian",
        "refused/insufficient_funds",
        "refused/ground_occupied",
        "refused/unsuitable_terrain",
        "refused/unknown_cell",
        "refused/capacity_exceeded",
        "refused/structure_incomplete",
        "refused/unknown_space",
        "refused/already_present",
        "refused/not_present",
        "refused/not_a_person",
        "refused/not_in_position",
        "refused/not_theirs",
        "refused/too_far",
        "refused/reserved_kind",
        "refused/wrong_record_kind",
        "refused/participant_inactive",
        "refused/account_not_empty",
        "refused/boundary_protected",
    ] {
        assert!(seen.contains_key(must), "the generator never produced {must}:\n{}", report.join("\n"));
    }
    assert!(rejected * 5 < total, "too many generated commands are off-contract ({rejected}/{total})");
}
