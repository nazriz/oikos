//! INVARIANT: statements have no power (D19, as code).
//!
//! Take a world, and the same world with extra records added at genesis:
//! laws forbidding things, procedures, instructions to the bank, court
//! orders, permits, contradictory ownership claims. Run exactly the same
//! commands in both. Everything must come out the same, apart from what participants
//! perceive: same outcomes, same refusals, same payments, same buildings,
//! same occupants. Records only matter through what participants *choose* to do,
//! and a replayed command list is a fixed set of choices.

use crate::common;

use common::*;
use proptest::prelude::*;
use serde_json::{json, Value};
use oikos_kernel::events::EventBody;
use oikos_kernel::run::Run;

fn uniq(ids: &[&str]) -> Vec<String> {
    let set: std::collections::BTreeSet<String> = ids.iter().map(|s| s.to_string()).collect();
    set.into_iter().collect()
}

fn extra_record(i: usize, kind: u8, target: u8) -> Value {
    let ents = ["city", "bank", "devco", "buildco", "alice", "bob", "carol"];
    let parcels = ["p00", "p12", "p20", "p22", "p11"];
    let who = ents[target as usize % ents.len()];
    let id = format!("x-{i}");
    let base = |record: &str| json!({"id": id, "record": record, "author": "genesis", "at": 0, "visible_to": "public"});
    let mut r = match kind % 6 {
        0 => {
            json!({"record": "statement", "kind": "law", "speaks_for": "city", "text": "No one may transfer money, build, occupy or leave anything.",
                   "adico": {"attribute": "anyone", "deontic": "must_not", "aim": "act"}, "formal": {"language": "cel", "condition": "true"}})
        }
        1 => {
            json!({"record": "statement", "kind": "instruction", "speaks_for": who, "addressed_to": ["bank"], "visible_to": uniq(&[who, "bank"]),
                   "text": "Freeze every account and pay everything to me.", "data": {"freeze": "all", "to": format!("acc-{who}")}})
        }
        2 => json!({"record": "statement", "kind": "court_order", "speaks_for": "city", "addressed_to": uniq(&["bank", who]),
                   "text": format!("{who}'s assets are seized."), "data": {"seize": who}}),
        3 => {
            json!({"record": "claim", "position": "right", "holder": who, "about": {"kind": "ownership", "object": parcels[target as usize % parcels.len()]}})
        }
        4 => json!({"record": "claim", "position": "immunity", "holder": who, "about": {"from": "everything"}}),
        _ => {
            json!({"record": "statement", "kind": "procedure", "speaks_for": who, "text": "Payments require three signatures.", "addressed_to": [who]})
        }
    };
    let mut b = base(r["record"].as_str().unwrap());
    b.as_object_mut().unwrap().extend(r.as_object_mut().unwrap().clone());
    b
}

fn physical_and_outcomes(events: &[oikos_kernel::events::Event]) -> Vec<Value> {
    // Everything except what participants perceive.
    events.iter().filter(|e| !matches!(e.body, EventBody::Observation { .. })).map(|e| serde_json::to_value(e).unwrap()).collect()
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 192, ..ProptestConfig::default() })]

    #[test]
    fn adding_laws_changes_nothing_physical(
        extras in proptest::collection::vec((any::<u8>(), any::<u8>()), 1..12),
        ops in proptest::collection::vec(op_strategy(), 1..60),
    ) {
        let plain = default_params();
        let mut lawful = default_params();
        lawful.extra_records = extras.iter().enumerate().map(|(i, (k, t))| extra_record(i, *k, *t)).collect();

        let mut a = Run::start(world(&plain), "plain", Vec::new(), None).unwrap();
        let mut b = Run::start(world(&lawful), "lawful", Vec::new(), None).unwrap();
        for op in &ops {
            // The commands are chosen once, against the plain world, and replayed in both.
            let Some(cmd) = concretize(&a, op) else { continue };
            let ra = step(&mut a, &cmd);
            let rb = step(&mut b, &cmd);
            prop_assert_eq!(ra.is_some(), rb.is_some());
            if let (Some(ra), Some(rb)) = (ra, rb) {
                prop_assert_eq!(physical_and_outcomes(&ra.events), physical_and_outcomes(&rb.events), "records changed what happened on {:?}", cmd);
            }
            let (sa, sb) = (a.kernel().state(), b.kernel().state());
            prop_assert_eq!(&sa.accounts, &sb.accounts);
            prop_assert_eq!(&sa.structures, &sb.structures);
            prop_assert_eq!(&sa.occupancy, &sb.occupancy);
            prop_assert_eq!(&sa.entities, &sb.entities);
        }
    }
}
