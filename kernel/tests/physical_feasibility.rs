//! INVARIANT: no act takes effect unless it is physically possible.
//! (Replaces v0.1's "no action bypasses a mandate": authority is now a matter
//! of records and people, D20. What the kernel must guarantee is physics.)
//!
//! Checked two independent ways over random command sequences:
//!   1. A MIRROR of the physical world, kept by this test from the events
//!      alone, replays every physical event and checks it was possible at that
//!      moment: buildings go only on empty parcels, occupants arrive only
//!      within capacity and in finished buildings, only people who are present
//!      leave or are removed. At the end of every command the mirror must equal
//!      the kernel's state, so nothing physical changes without an event.
//!   2. An ORACLE, written here from the contract's wording, predicts the
//!      outcome (applied, or the exact refusal code) of every single-block
//!      physical act from the state before it.
//!
//! Also: a refused action changes nothing at all.

mod common;

use common::*;
use proptest::prelude::*;
use serde_json::json;
use std::collections::BTreeMap;
use terrarium_kernel::blocks::Block;
use terrarium_kernel::events::{EventBody, RefusalCode};
use terrarium_kernel::run::Run;
use terrarium_kernel::state::{SeatStatus, State};
use terrarium_kernel::Command;

#[derive(Debug, Clone, PartialEq)]
struct Mirror {
    /// structure -> (parcel, type, complete)
    structures: BTreeMap<String, (String, String, bool)>,
    /// (structure, occupant, slot) -> count
    occupancy: BTreeMap<(String, String, String), u32>,
}

fn mirror_of(st: &State) -> Mirror {
    Mirror {
        structures: st.structures.iter().map(|(id, x)| (id.clone(), (x.parcel.clone(), x.structure_type.clone(), x.complete))).collect(),
        occupancy: st
            .occupancy
            .iter()
            .flat_map(|(sid, occ)| {
                occ.iter().flat_map(move |(o, slots)| slots.iter().map(move |(slot, c)| ((sid.clone(), o.clone(), slot.clone()), *c)))
            })
            .collect(),
    }
}

/// The oracle's prediction for a single physical block: Ok(()) or the refusal code.
fn predict(run: &Run<Vec<u8>>, seat: &str, b: &Block) -> Option<Result<(), RefusalCode>> {
    let k = run.kernel();
    let st = k.state();
    let me = k.statics().entity_of(seat).unwrap();
    // An opted-out seat can't act, unless the world names a stand-in that carries it on.
    if st.seats[seat].status == SeatStatus::OptedOut && k.statics().seats[seat].vacant_after_opt_out() {
        return Some(Err(RefusalCode::SeatOptedOut));
    }
    let types = &k.statics().types;
    Some(match b {
        Block::Transfer { from, to, amount, settles: None, per_instruction: None, .. } => {
            let (Some(f), Some(t)) = (st.accounts.get(from), st.accounts.get(to)) else { return Some(Err(RefusalCode::UnknownAccount)) };
            if f.custodian != me {
                Err(RefusalCode::NotCustodian)
            } else if f.holder == k.statics().boundary {
                let below = (f.balance as i128) - (*amount as i128) < -9_007_199_254_740_991;
                let above = from != to && t.balance as i128 + *amount as i128 > 9_007_199_254_740_991;
                if below || above {
                    Err(RefusalCode::Overflow)
                } else {
                    Ok(())
                }
            } else if f.balance < *amount {
                Err(RefusalCode::InsufficientFunds)
            } else if from != to && t.balance as i128 + *amount as i128 > 9_007_199_254_740_991 {
                Err(RefusalCode::Overflow)
            } else {
                Ok(())
            }
        }
        Block::Construct { parcel, structure_type, materials_from, .. } => {
            let Some(p) = st.parcels.get(parcel) else { return Some(Err(RefusalCode::UnknownParcel)) };
            let Some(ty) = types.get(structure_type) else {
                return Some(if p.structure.is_some() { Err(RefusalCode::ParcelOccupied) } else { Err(RefusalCode::UnknownStructureType) });
            };
            let Some(acc) = st.accounts.get(materials_from) else {
                return Some(if p.structure.is_some() { Err(RefusalCode::ParcelOccupied) } else { Err(RefusalCode::UnknownAccount) });
            };
            if p.structure.is_some() {
                Err(RefusalCode::ParcelOccupied)
            } else if acc.holder != me {
                Err(RefusalCode::NotHolder)
            } else if acc.holder != k.statics().boundary && acc.balance < ty.materials_cost {
                // (The outside world pays materials to itself: a quirk of the temporary liberty.)
                Err(RefusalCode::InsufficientFunds)
            } else {
                Ok(())
            }
        }
        Block::Occupy { structure, slot, count } => {
            let Some(x) = st.structures.get(structure) else { return Some(Err(RefusalCode::UnknownStructure)) };
            let Some(cap) = types[&x.structure_type].capacity.get(slot) else {
                return Some(if !x.complete { Err(RefusalCode::StructureIncomplete) } else { Err(RefusalCode::UnknownSlot) });
            };
            if !x.complete {
                Err(RefusalCode::StructureIncomplete)
            } else if *count == 0 || st.occupied(structure, slot) + *count as u64 > *cap as u64 {
                Err(RefusalCode::CapacityExceeded)
            } else {
                Ok(())
            }
        }
        Block::Vacate { occupant, structure } => {
            if !st.entities.contains_key(occupant) {
                Err(RefusalCode::UnknownEntity)
            } else if st.occupancy.get(structure).is_some_and(|o| o.contains_key(occupant)) {
                Ok(())
            } else {
                Err(RefusalCode::NotPresent)
            }
        }
        Block::CloseAccount { account } => match st.accounts.get(account) {
            None => Err(RefusalCode::UnknownAccount),
            Some(a) if a.custodian != me => Err(RefusalCode::NotCustodian),
            Some(_) if *account == k.statics().boundary_account => Err(RefusalCode::BoundaryProtected),
            Some(a) if a.balance != 0 => Err(RefusalCode::AccountNotEmpty),
            Some(_) => Ok(()),
        },
        _ => return None,
    })
}

fn check(ops: &[Op]) -> Result<(), TestCaseError> {
    let mut run = Run::start(world(&default_params()), "feasibility", Vec::new(), None).unwrap();
    for op in ops {
        let Some(cmd) = concretize(&run, op) else { continue };
        let before = run.kernel().state().clone();
        let prediction = match &cmd {
            Command::Act { seat, blocks, .. } if blocks.len() == 1 => predict(&run, seat, &blocks[0]),
            _ => None,
        };
        let Some(resp) = step(&mut run, &cmd) else { continue };
        let after = run.kernel().state();
        let types = &run.kernel().statics().types;

        // 1. Mirror every physical event and check it was possible.
        let mut m = mirror_of(&before);
        for e in &resp.events {
            match &e.body {
                EventBody::StructureStarted { structure, parcel, structure_type, .. } => {
                    prop_assert!(!m.structures.values().any(|(p, _, _)| p == parcel), "built on occupied parcel {}", parcel);
                    m.structures.insert(structure.clone(), (parcel.clone(), structure_type.clone(), false));
                }
                EventBody::StructureCompleted { structure } => {
                    let x = m.structures.get_mut(structure).expect("completed structure exists");
                    prop_assert!(!x.2, "completed twice");
                    x.2 = true;
                }
                EventBody::StructureDemolished { structure, .. } => {
                    prop_assert!(m.structures.remove(structure).is_some(), "demolished a structure that wasn't there");
                    prop_assert!(!m.occupancy.keys().any(|(s, _, _)| s == structure), "demolished with occupants still recorded inside");
                }
                EventBody::Occupied { occupant, structure, slot, count } => {
                    let (_, ty, complete) = m.structures.get(structure).expect("occupied structure exists").clone();
                    prop_assert!(complete, "occupied an unfinished building");
                    let cap = types[&ty].capacity[slot] as u64;
                    *m.occupancy.entry((structure.clone(), occupant.clone(), slot.clone())).or_default() += count;
                    let used: u64 = m.occupancy.iter().filter(|((s, _, sl), _)| s == structure && sl == slot).map(|(_, c)| *c as u64).sum();
                    prop_assert!(used <= cap, "over capacity: {} > {}", used, cap);
                }
                EventBody::Vacated { occupant, structure, .. } => {
                    let keys: Vec<_> = m.occupancy.keys().filter(|(s, o, _)| s == structure && o == occupant).cloned().collect();
                    prop_assert!(!keys.is_empty(), "{} vacated {} without being there", occupant, structure);
                    for key in keys {
                        m.occupancy.remove(&key);
                    }
                }
                _ => {}
            }
        }
        prop_assert_eq!(&m, &mirror_of(after), "the physical world changed without matching events after {:?}", cmd);

        // 2. A refused action changes nothing (beyond minting its action id and queuing its outcome).
        if let Some(EventBody::ActionRefused { code, .. }) = resp.events.first().map(|e| &e.body) {
            prop_assert_eq!(resp.events.len(), 1);
            prop_assert_eq!(&before.accounts, &after.accounts);
            prop_assert_eq!(&before.structures, &after.structures);
            prop_assert_eq!(&before.occupancy, &after.occupancy);
            prop_assert_eq!(&before.entities, &after.entities);
            prop_assert_eq!(&before.records, &after.records);
            if let Some(p) = &prediction {
                prop_assert_eq!(p, &Err(*code), "oracle disagreed on {:?}", cmd);
            }
        } else if let (Some(p), Command::Act { .. }) = (&prediction, &cmd) {
            prop_assert_eq!(p, &Ok(()), "oracle expected a refusal for {:?}", cmd);
        }
    }
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, ..ProptestConfig::default() })]

    #[test]
    fn nothing_physically_impossible_happens(ops in proptest::collection::vec(op_strategy(), 1..60)) {
        check(&ops)?;
    }
}

#[test]
fn the_oracle_is_exercised() {
    // Guard against a vacuous oracle: single physical blocks with each outcome occur.
    let mut run = Run::start(world(&default_params()), "oracle", Vec::new(), None).unwrap();
    let act = |seat: &str, b: serde_json::Value| Command::Act {
        seat: seat.into(),
        blocks: vec![serde_json::from_value(b).unwrap()],
        provenance: json!({"via": "direct"}),
        reasoning: None,
    };
    let cases = [
        (act("finance", json!({"block": "transfer", "from": "acc-city", "to": "acc-devco", "amount": 5})), Err(RefusalCode::NotCustodian)),
        (act("bank-pay", json!({"block": "transfer", "from": "acc-city", "to": "acc-devco", "amount": 5})), Ok(())),
        (
            act("builder", json!({"block": "construct", "parcel": "p20", "structure_type": "park", "materials_from": "acc-buildco"})),
            Err(RefusalCode::ParcelOccupied),
        ),
        (
            act("builder", json!({"block": "construct", "parcel": "p12", "structure_type": "park", "materials_from": "acc-city"})),
            Err(RefusalCode::NotHolder),
        ),
        (act("builder", json!({"block": "construct", "parcel": "p12", "structure_type": "park", "materials_from": "acc-buildco"})), Ok(())),
        (act("developer", json!({"block": "vacate", "occupant": "carol", "structure": "s-house"})), Err(RefusalCode::NotPresent)),
        (act("developer", json!({"block": "vacate", "occupant": "bob", "structure": "s-flats"})), Ok(())),
    ];
    for (cmd, expected) in cases {
        let Command::Act { seat, blocks, .. } = &cmd else { unreachable!() };
        assert_eq!(predict(&run, seat, &blocks[0]), Some(expected), "oracle on {cmd:?}");
        let resp = run.command(&cmd).unwrap();
        let got = match &resp.events[0].body {
            EventBody::ActionRefused { code, .. } => Err(*code),
            _ => Ok(()),
        };
        assert_eq!(got, expected, "kernel on {cmd:?}");
    }
}
