//! INVARIANT: no act takes effect unless it is physically possible.
//! (Replaces v0.1's "no action bypasses a mandate": authority is a matter of
//! records and people, D20. What the kernel must guarantee is physics.)
//!
//! Checked two independent ways over random command sequences:
//!   1. A MIRROR of the physical world and the cast, kept by this test from the
//!      events alone, replays every physical event and checks it was possible at
//!      that moment: buildings go only on free ground they can stand on, bodies
//!      go only into finished spaces with room, only bodies that are alive and in
//!      the world are in spaces, the dead stay dead, and positions change hands
//!      only by events. At the end of every command the mirror must equal the
//!      kernel's state, so nothing physical changes without an event.
//!   2. An ORACLE, written here from the contract's wording, predicts the
//!      outcome (applied, or the exact refusal code) of every single-block act it
//!      knows, from the state before it.
//!
//! Also: a refused action changes nothing at all.

use crate::common;

use common::*;
use proptest::prelude::*;
use proptest::strategy::ValueTree;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use oikos_kernel::blocks::Block;
use oikos_kernel::config::{cell_xy, footprint_cells, split_space};
use oikos_kernel::events::{EventBody, RefusalCode};
use oikos_kernel::run::Run;
use oikos_kernel::state::{ParticipantStatus, State};
use oikos_kernel::Command;

#[derive(Debug, Clone, PartialEq)]
struct Mirror {
    /// structure -> (cells, type, complete)
    structures: BTreeMap<String, (Vec<String>, String, bool)>,
    /// space -> bodies in it
    occupancy: BTreeMap<String, BTreeSet<String>>,
    /// person -> (present, alive)
    bodies: BTreeMap<String, (bool, bool)>,
    /// position -> holder
    holders: BTreeMap<String, Option<String>>,
}

fn mirror_of(st: &State) -> Mirror {
    Mirror {
        structures: st.structures.iter().map(|(id, x)| (id.clone(), (x.cells.clone(), x.structure_type.clone(), x.complete))).collect(),
        occupancy: st.occupancy.values().flat_map(|m| m.iter().map(|(sp, b)| (sp.clone(), b.clone()))).filter(|(_, b)| !b.is_empty()).collect(),
        bodies: st.entities.iter().filter_map(|(id, e)| e.body.as_ref().map(|b| (id.clone(), (b.present, b.alive)))).collect(),
        holders: st.positions.iter().map(|(id, x)| (id.clone(), x.holder.clone())).collect(),
    }
}

fn living(st: &State, who: &str) -> Result<(), RefusalCode> {
    match st.entities.get(who) {
        None => Err(RefusalCode::UnknownEntity),
        Some(e) => match &e.body {
            None => Err(RefusalCode::NotAPerson),
            Some(b) if !b.alive => Err(RefusalCode::Dead),
            Some(b) if !b.present => Err(RefusalCode::NotPresent),
            Some(_) => Ok(()),
        },
    }
}

/// The oracle's prediction for a single block: Ok(()) or the refusal code; None when it doesn't know the block.
fn predict(run: &Run<Vec<u8>>, participant: &str, position: Option<&str>, b: &Block) -> Option<Result<(), RefusalCode>> {
    let k = run.kernel();
    let st = k.state();
    let s = k.statics();
    // Who acts, in what capacity: it must be able to act, and hold the position it names.
    let p = &st.participants[participant];
    let active = match p.status {
        ParticipantStatus::Active => true,
        ParticipantStatus::OptedOut => !p.def.vacant_after_opt_out(),
        ParticipantStatus::Ended => false,
    };
    if !active {
        return Some(Err(RefusalCode::ParticipantInactive));
    }
    let me = match position {
        Some(pos) => match st.positions.get(pos) {
            None => return Some(Err(RefusalCode::UnknownPosition)),
            Some(x) if x.holder.as_deref() != Some(participant) => return Some(Err(RefusalCode::NotInPosition)),
            Some(x) => x.entity.clone(),
        },
        None => p.person.clone()?,
    };
    let me_person = position.is_none();
    // A system works only for the organisation it belongs to.
    if p.owner.as_deref().is_some_and(|o| o != me) {
        return Some(Err(RefusalCode::NotTheirs));
    }
    let types = &s.types;
    Some(match b {
        Block::Transfer { from, to, amount, settles: None, per_instruction: None, .. } => {
            let (Some(f), Some(t)) = (st.accounts.get(from), st.accounts.get(to)) else { return Some(Err(RefusalCode::UnknownAccount)) };
            // v0.5 (D58): amounts are exact to 38 digits, and money moves only within one currency.
            let max = oikos_kernel::money::MAX_MONEY;
            let above = || from != to && t.balance.checked_add(*amount).is_none_or(|x| x > max);
            if f.custodian != me {
                Err(RefusalCode::NotCustodian)
            } else if !(1..=max).contains(amount) {
                Err(RefusalCode::Overflow)
            } else if f.currency != t.currency {
                Err(RefusalCode::CurrencyMismatch)
            } else if s.is_boundary(&f.holder) {
                let below = f.balance.checked_sub(*amount).is_none_or(|x| x < -max);
                if below || above() {
                    Err(RefusalCode::Overflow)
                } else {
                    Ok(())
                }
            } else if f.balance < *amount {
                Err(RefusalCode::InsufficientFunds)
            } else if above() {
                Err(RefusalCode::Overflow)
            } else {
                Ok(())
            }
        }
        Block::Construct { at, structure_type, materials_at, .. } => {
            let Some(ty) = types.get(structure_type) else { return Some(Err(RefusalCode::UnknownStructureType)) };
            let Some(cells) = footprint_cells(&s.detailed, at, ty.footprint) else { return Some(Err(RefusalCode::UnknownCell)) };
            for c in &cells {
                let cell = &st.cells[c];
                if cell.structure.is_some() {
                    return Some(Err(RefusalCode::GroundOccupied));
                }
                let fits = match &ty.terrains {
                    Some(ok) => cell.terrain.as_ref().is_some_and(|t| ok.contains(t)),
                    None => cell.terrain.is_none(),
                };
                if !fits {
                    return Some(Err(RefusalCode::UnsuitableTerrain));
                }
            }
            // Phase B: its materials, from the builder's own holding where it says they are.
            match materials_at {
                None if !ty.materials.is_empty() => Err(RefusalCode::InsufficientQuantity),
                None => Ok(()),
                Some(yard) if ty.materials.iter().any(|(k, q)| st.holding(&me, yard, k) < *q) => Err(RefusalCode::InsufficientQuantity),
                Some(_) => Ok(()),
            }
        }
        Block::Occupy { space, who } => {
            let who = match who {
                Some(w) => w.clone(),
                None if me_person => me.clone(),
                None => return Some(Err(RefusalCode::NotAPerson)),
            };
            if let Err(e) = living(st, &who) {
                return Some(Err(e));
            }
            let Some((sid, local)) = split_space(space) else { return Some(Err(RefusalCode::UnknownSpace)) };
            let Some(x) = st.structures.get(sid) else { return Some(Err(RefusalCode::UnknownStructure)) };
            let Some(spec) = s.space(&x.structure_type, local) else { return Some(Err(RefusalCode::UnknownSpace)) };
            let bodies = st.occupancy.get(sid).and_then(|m| m.get(space));
            if !x.complete {
                Err(RefusalCode::StructureIncomplete)
            } else if bodies.is_some_and(|b| b.contains(&who)) {
                Err(RefusalCode::AlreadyPresent)
            } else if bodies.map_or(0, |b| b.len()) as u32 >= spec.capacity {
                Err(RefusalCode::CapacityExceeded)
            } else if x.demolition.is_some() {
                Err(RefusalCode::ComingDown)
            } else {
                Ok(())
            }
        }
        Block::Vacate { occupant, from } => {
            if !st.entities.contains_key(occupant) {
                Err(RefusalCode::UnknownEntity)
            } else {
                let sid = split_space(from).map_or(from.as_str(), |(s, _)| s);
                let there = st.occupancy.get(sid).is_some_and(|m| m.iter().any(|(sp, b)| (sp == from || sid == from) && b.contains(occupant)));
                if there {
                    Ok(())
                } else {
                    Err(RefusalCode::NotPresent)
                }
            }
        }
        Block::CloseAccount { account } => match st.accounts.get(account) {
            None => Err(RefusalCode::UnknownAccount),
            Some(a) if a.custodian != me => Err(RefusalCode::NotCustodian),
            Some(_) if s.is_boundary_account(account) => Err(RefusalCode::BoundaryProtected),
            Some(a) if a.balance != 0 => Err(RefusalCode::AccountNotEmpty),
            Some(_) => Ok(()),
        },
        Block::Work { task, units, at, performers, on, .. } => {
            // Phase B: performers there, alive and present, with time left today; inputs held there; what's worked on.
            let builtin = task == "build" || task == "demolish";
            let spec = s.config.catalogue.tasks.iter().find(|x| &x.id == task);
            if !builtin && spec.is_none() {
                return Some(Err(RefusalCode::UnknownTask));
            }
            let total = spec.map_or(1, |x| x.labour) * *units as i64;
            let Some(place) = st.structures.get(at) else { return Some(Err(RefusalCode::UnknownStructure)) };
            if !place.complete {
                return Some(Err(RefusalCode::StructureIncomplete));
            }
            let mut seen = std::collections::BTreeSet::new();
            if performers.iter().any(|p| !seen.insert(p)) {
                return Some(Err(RefusalCode::DuplicateRef));
            }
            if total > 0 && performers.is_empty() {
                return Some(Err(RefusalCode::NotAtWork));
            }
            let kind = spec.and_then(|x| x.in_space.clone());
            for p in performers {
                if let Err(e) = living(st, p) {
                    return Some(Err(e));
                }
                let there = st.occupancy.get(at).is_some_and(|m| {
                    m.iter().any(|(space, bodies)| bodies.contains(p) && kind.as_ref().is_none_or(|k| split_space(space).is_some_and(|(_, l)| l.split('.').next() == Some(k.as_str()))))
                });
                if !there {
                    return Some(Err(RefusalCode::NotAtWork));
                }
            }
            if total > 0 {
                let day = s.config.catalogue.working_day.unwrap();
                let share = (total + performers.len() as i64 - 1) / performers.len() as i64;
                // (The work is placed when the actor and every performer are free, after what each has in hand, and is
                // counted on each day it is done on: law 1, kernel.rs `begin`. Until 2026-10-24 the oracle charged the
                // whole share to today, and expected a refusal for work that began when its performer was next free, on a
                // day with room: proptest's case 3d09092b.)
                let free = |who: &str, lanes: usize| {
                    let mut l = st.timelines.get(who).map(|x| x.lanes.clone()).unwrap_or_default();
                    oikos_time::place(&mut l, lanes, st.t, 0).0
                };
                let (key, lanes) = match p.kind {
                    oikos_kernel::config::ParticipantKind::Person => (p.person.clone().unwrap_or_else(|| participant.to_string()), 1),
                    oikos_kernel::config::ParticipantKind::System => (participant.to_string(), p.def.lanes.unwrap_or(1) as usize),
                };
                let start = performers.iter().filter(|w| **w != key).map(|w| free(w, 1)).fold(free(&key, lanes), i64::max);
                let portions = |mut at: i64, mut left: i64| {
                    let mut out = vec![];
                    while left > 0 {
                        let d = oikos_kernel::exec::day_of(at);
                        let take = left.min((d + 1) * 86_400 - at);
                        out.push((d, take));
                        at += take;
                        left -= take;
                    }
                    out
                };
                // (And no one work is longer than a day: exec.rs refuses it whenever it would be done.)
                if share > day || performers.iter().any(|w| portions(start, share).into_iter().any(|(d, take)| st.timelines.get(w).map_or(0, |tl| tl.worked_on(d)) + take > day)) {
                    return Some(Err(RefusalCode::NoTimeLeft));
                }
            }
            if spec.is_some_and(|x| x.consumes.iter().any(|(k, per)| st.holding(&me, at, k) < per * *units as i128)) {
                return Some(Err(RefusalCode::InsufficientQuantity));
            }
            if builtin || spec.is_some_and(|x| !x.changes.is_empty()) {
                let target = on.clone().unwrap_or_else(|| at.clone());
                let Some(t) = st.structures.get(&target) else { return Some(Err(RefusalCode::UnknownStructure)) };
                if task == "build" && (t.complete || t.demolition.is_some()) {
                    return Some(Err(RefusalCode::NotBeingBuilt));
                }
                if task == "demolish" && t.demolition.is_none() {
                    return Some(Err(RefusalCode::NotComingDown));
                }
            }
            Ok(())
        }
        Block::MoveGoods { kind, quantity, from_at, to, to_at } => {
            // Possession (phase B): the actor moves its own holding; an edge's may go negative.
            let max = oikos_kernel::money::MAX_MONEY;
            if !s.config.catalogue.resources.iter().any(|r| &r.id == kind) {
                Err(RefusalCode::UnknownResource)
            } else if !(1..=max).contains(quantity) {
                Err(RefusalCode::Overflow)
            } else if !st.entities.contains_key(to) {
                Err(RefusalCode::UnknownEntity)
            } else if !(st.structures.contains_key(to_at) || (s.is_boundary(to) && to_at == to)) {
                Err(RefusalCode::UnknownPlace)
            } else {
                let have = st.holding(&me, from_at, kind);
                let edge_outside = s.is_boundary(&me) && from_at == &me;
                let same = &me == to && from_at == to_at;
                let there = st.holding(to, to_at, kind);
                if !edge_outside && have < *quantity {
                    Err(RefusalCode::InsufficientQuantity)
                } else if have.checked_sub(*quantity).is_none_or(|x| x < -max) || (!same && there.checked_add(*quantity).is_none_or(|x| x > max)) {
                    Err(RefusalCode::Overflow)
                } else {
                    Ok(())
                }
            }
        }
        Block::Leave { person, to } => {
            let who = match person {
                Some(w) => w.clone(),
                None if me_person => me.clone(),
                None => return Some(Err(RefusalCode::NotAPerson)),
            };
            // Leaving by something that isn't one of the world's edges is refused.
            if to.as_ref().is_some_and(|e| !s.is_boundary(e)) {
                return Some(Err(RefusalCode::NotABoundary));
            }
            if let Err(e) = living(st, &who) {
                return Some(Err(e));
            }
            // Only oneself, unless a minor in someone's care (the world's `life.majority`; none here: nobody else).
            if who != me && s.life().and_then(|l| l.majority).is_none() {
                return Some(Err(RefusalCode::NotTheirs));
            }
            Ok(())
        }
        Block::Appoint { position: target, participant: to } => {
            if position.is_none() || st.entities.get(&me).is_some_and(|e| e.body.is_some()) {
                Err(RefusalCode::NotTheirs)
            } else {
                match st.positions.get(target) {
                    None => Err(RefusalCode::UnknownPosition),
                    Some(x) if x.entity != me => Err(RefusalCode::NotTheirs),
                    Some(_) => match to.as_ref().map(|t| st.participants.get(t)) {
                        Some(None) => Err(RefusalCode::UnknownParticipant),
                        Some(Some(q)) if q.status == ParticipantStatus::Ended => Err(RefusalCode::ParticipantInactive),
                        // (A system works only for the organisation it belongs to.)
                        Some(Some(q)) if q.owner.is_some() && q.owner.as_deref() != Some(me.as_str()) => Err(RefusalCode::NotTheirs),
                        _ => Ok(()),
                    },
                }
            }
        }
        _ => return None,
    })
}

fn check(ops: &[Op]) -> Result<BTreeMap<String, usize>, TestCaseError> {
    let mut run = Run::start(world(&default_params()), "feasibility", Vec::new(), None).unwrap();
    let mut outcomes: BTreeMap<String, usize> = BTreeMap::new();
    for op in ops {
        let Some(cmd) = concretize(&run, op) else { continue };
        let before = run.kernel().state().clone();
        let prediction = match &cmd {
            Command::Act { participant, position, blocks, .. } if blocks.len() == 1 => predict(&run, participant, position.as_deref(), &blocks[0]),
            _ => None,
        };
        let Some(resp) = step(&mut run, &cmd) else { continue };
        let after = run.kernel().state();
        let s = run.kernel().statics();

        // 1. Mirror every physical event and check it was possible.
        let mut m = mirror_of(&before);
        let mut created: BTreeSet<String> = BTreeSet::new();
        for e in &resp.events {
            *outcomes.entry(e.body.name().into()).or_default() += 1;
            match &e.body {
                EventBody::StructureStarted { structure, on, structure_type, .. } => {
                    let ty = &s.types[structure_type];
                    let cells = footprint_cells(&s.detailed, on, ty.footprint).expect("a building stands on the ground");
                    for c in &cells {
                        prop_assert!(!m.structures.values().any(|(cs, _, _)| cs.contains(c)), "built on occupied ground {}", c);
                        let (x, y) = cell_xy(c).unwrap();
                        let t = oikos_kernel::config::terrain_at(&s.config.world.ground, x, y);
                        let fits = match &ty.terrains { Some(ok) => t.is_some_and(|t| ok.iter().any(|o| o == t)), None => t.is_none() };
                        prop_assert!(fits, "a {} stood on {:?} terrain", structure_type, t);
                    }
                    m.structures.insert(structure.clone(), (cells, structure_type.clone(), false));
                }
                EventBody::StructureCompleted { structure } => {
                    let x = m.structures.get_mut(structure).expect("completed structure exists");
                    prop_assert!(!x.2, "completed twice");
                    x.2 = true;
                }
                EventBody::StructureDemolished { structure, .. } => {
                    prop_assert!(m.structures.remove(structure).is_some(), "demolished a structure that wasn't there");
                    let prefix = format!("{structure}/");
                    prop_assert!(!m.occupancy.keys().any(|sp| sp.starts_with(&prefix)), "demolished with bodies still recorded inside");
                }
                EventBody::Occupied { occupant, space, .. } => {
                    let (sid, local) = split_space(space).unwrap();
                    let (_, ty, complete) = m.structures.get(sid).expect("occupied structure exists").clone();
                    prop_assert!(complete, "occupied an unfinished building");
                    prop_assert!(m.bodies.get(occupant) == Some(&(true, true)), "{} went into a space without being alive and in the world", occupant);
                    let cap = s.spaces[&ty][local].capacity as usize;
                    let b = m.occupancy.entry(space.clone()).or_default();
                    prop_assert!(b.insert(occupant.clone()), "{} was already in {}", occupant, space);
                    prop_assert!(b.len() <= cap, "over capacity: {} > {}", b.len(), cap);
                }
                EventBody::Vacated { occupant, space, .. } => {
                    let b = m.occupancy.get_mut(space);
                    prop_assert!(b.is_some_and(|b| b.remove(occupant)), "{} left {} without being there", occupant, space);
                    m.occupancy.retain(|_, b| !b.is_empty());
                }
                EventBody::PersonCreated { person, parents, .. } => {
                    // A newcomer is in the world; a child is where its birthing parent is.
                    let present = parents.first().is_none_or(|p| m.bodies.get(p).is_some_and(|b| b.0));
                    m.bodies.insert(person.clone(), (present, true));
                    created.insert(person.clone());
                }
                EventBody::PersonArrived { person, .. } => {
                    let b = m.bodies.get_mut(person).expect("arrived body exists");
                    prop_assert!(b.1, "the dead arrived");
                    prop_assert!(created.contains(person) || !b.0, "{} arrived while already in the world", person);
                    b.0 = true;
                }
                EventBody::PersonLeft { person, .. } => {
                    let b = m.bodies.get_mut(person).expect("body exists");
                    prop_assert!(*b == (true, true), "{} left without being alive and in the world", person);
                    b.0 = false;
                    prop_assert!(!m.occupancy.values().any(|x| x.contains(person)), "{} left the world still in a space", person);
                }
                EventBody::PersonDied { person, .. } => {
                    let b = m.bodies.get_mut(person).expect("body exists");
                    prop_assert!(b.1, "{} died twice", person);
                    b.1 = false;
                    prop_assert!(!m.occupancy.values().any(|x| x.contains(person)), "{} died still in a space", person);
                }
                EventBody::Appointed { position, holder, .. } => {
                    m.holders.insert(position.clone(), holder.clone());
                }
                EventBody::PositionCreated { position, .. } => {
                    m.holders.insert(position.clone(), None);
                }
                EventBody::ActionApplied { participant, .. } => {
                    // Only a participant that can act does.
                    let p = &before.participants[participant];
                    prop_assert!(p.status == ParticipantStatus::Active || (p.status == ParticipantStatus::OptedOut && !p.def.vacant_after_opt_out()), "{} acted though it can't", participant);
                    if let Some(person) = &p.person {
                        prop_assert!(before.body(person).is_some_and(|b| b.alive), "the dead acted");
                    }
                }
                _ => {}
            }
        }
        prop_assert_eq!(&m, &mirror_of(after), "the physical world or the cast changed without matching events after {:?}", cmd);
        for (_, spaces) in after.occupancy.iter() {
            for b in spaces.values().flatten() {
                prop_assert!(after.body(b).is_some_and(|x| x.alive && x.present), "{} is in a space without being alive and in the world", b);
            }
        }
        // Where each body is, as kept with the state (the lookup), is what looking through every building finds: for
        // every body that is somewhere or was, and nobody is kept who is nowhere.
        for (b, _) in after.entities.iter().filter(|(_, e)| e.body.is_some()) {
            prop_assert_eq!(after.whereabouts.get(b).map(|s| s.iter().cloned().collect::<Vec<_>>()).unwrap_or_default(), after.structures_of_by_scan(b), "the lookup of where {} is disagrees with the buildings", b);
        }
        prop_assert!(after.whereabouts.values().all(|s| !s.is_empty()), "the lookup keeps a body that is nowhere");

        // 2. A refused action changes nothing (beyond minting its action id and queuing its outcome).
        let quiet = resp.events.iter().all(|e| matches!(e.body, EventBody::ActionStarted { .. } | EventBody::ActionRefused { .. } | EventBody::ActionApplied { .. }));
        if let Some(EventBody::ActionRefused { code, .. }) = resp.events.first().map(|e| &e.body) {
            // (An act takes time: if something else scheduled happens while it waits, its response carries that too (a crew member dies during an
            // eight-hour work, a building completes), and the world differs for that reason and not the refusal's. Found by the property test: only
            // an act with nothing else in its response can be held to "nothing changed".)
            if quiet {
                prop_assert_eq!(resp.events.iter().filter(|e| !matches!(e.body, EventBody::ActionStarted { .. })).count(), 1);
                prop_assert_eq!(&before.accounts, &after.accounts);
                prop_assert_eq!(&before.structures, &after.structures);
                prop_assert_eq!(&before.occupancy, &after.occupancy);
                prop_assert_eq!(&before.entities, &after.entities);
                prop_assert_eq!(&before.records, &after.records);
                prop_assert_eq!(&before.positions, &after.positions);
                prop_assert_eq!(&before.schedule, &after.schedule);
            }
            // (The oracle looks at the world as it was ordered: not judged when the world moved during the wait.)
            if let Some(p) = prediction.as_ref().filter(|_| quiet) {
                prop_assert_eq!(p, &Err(*code), "oracle disagreed on {:?}", cmd);
            }
        } else if let (Some(p), Command::Act { .. }, Some(EventBody::ActionApplied { .. }), true) = (&prediction, &cmd, resp.events.first().map(|e| &e.body), true) {
            // (An act that couldn't be done before the run's end never took effect: nothing to judge.)
            prop_assert_eq!(p, &Ok(()), "oracle expected a refusal for {:?}", cmd);
        }
    }
    Ok(outcomes)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, ..ProptestConfig::default() })]

    #[test]
    fn nothing_physically_impossible_happens(ops in proptest::collection::vec(op_strategy(), 1..60)) {
        check(&ops)?;
    }
}

/// Life happens: over one long deterministic run, bodies arrive, leave, are born, fall ill,
/// are injured and die, and positions change hands, all checked by the mirror.
#[test]
fn the_cast_changes_and_physics_holds() {
    // Several fixed sequences, not one: which events one random sequence happens to reach shifts whenever the test
    // world changes (an actor added, v0.5's second edge), so the check is that each happens in at least one of them.
    let mut seen: std::collections::BTreeMap<String, usize> = Default::default();
    for seed in 0u8..4 {
        let rng = proptest::test_runner::TestRng::from_seed(proptest::test_runner::RngAlgorithm::ChaCha, &[seed; 32]);
        let mut runner = proptest::test_runner::TestRunner::new_with_rng(ProptestConfig::default(), rng);
        let ops = proptest::collection::vec(op_strategy(), 600..601).new_tree(&mut runner).unwrap().current();
        for (k, n) in check(&ops).unwrap() {
            *seen.entry(k).or_default() += n;
        }
    }
    for e in ["person_created", "person_arrived", "person_left", "person_died", "birth_started", "condition_began", "condition_ended", "appointed", "occupied", "vacated", "structure_started"] {
        assert!(seen.get(e).copied().unwrap_or(0) > 0, "{e} never happened: {seen:?}");
    }
}

#[test]
fn the_oracle_is_exercised() {
    // Guard against a vacuous oracle: single acts with each outcome occur.
    let mut run = Run::start(world(&default_params()), "oracle", Vec::new(), None).unwrap();
    let act = |p: &str, pos: Option<&str>, b: serde_json::Value| Command::Act {
        participant: p.into(),
        position: pos.map(String::from),
        blocks: vec![serde_json::from_value(b).unwrap()],
        by: vec![],
        provenance: json!({"via": "direct"}),
        reasoning: None,
        thinking: None,
    };
    let bld = |b: serde_json::Value| act("builder-system", Some("builder"), b);
    let cases = [
        (act("finance-system", Some("finance"), json!({"block": "transfer", "from": "acc-city", "to": "acc-devco", "amount": "5"})), Err(RefusalCode::NotCustodian)),
        (act("bank-pay-system", Some("bank-pay"), json!({"block": "transfer", "from": "acc-city", "to": "acc-devco", "amount": "5"})), Ok(())),
        (act("alice-self", Some("mayor"), json!({"block": "transfer", "from": "acc-city", "to": "acc-devco", "amount": "5"})), Err(RefusalCode::NotInPosition)),
        (bld(json!({"block": "construct", "at": "cell.1.0", "structure_type": "park", "materials_at": "s-flats"})), Err(RefusalCode::GroundOccupied)),
        (bld(json!({"block": "construct", "at": "cell.2.0", "structure_type": "jetty", "materials_at": "s-flats"})), Err(RefusalCode::UnsuitableTerrain)),
        (bld(json!({"block": "construct", "at": "cell.2.2", "structure_type": "flats", "materials_at": "s-flats"})), Err(RefusalCode::UnsuitableTerrain)),
        (bld(json!({"block": "construct", "at": "cell.3.0", "structure_type": "flats", "materials_at": "s-flats"})), Err(RefusalCode::UnknownCell)),
        (bld(json!({"block": "construct", "at": "cell.2.1", "structure_type": "park", "materials_at": "s-house"})), Err(RefusalCode::InsufficientQuantity)),
        (bld(json!({"block": "construct", "at": "cell.2.1", "structure_type": "park", "materials_at": "s-flats"})), Ok(())),
        (bld(json!({"block": "construct", "at": "cell.3.1", "structure_type": "jetty", "materials_at": "s-flats"})), Ok(())),
        (act("developer-system", Some("developer"), json!({"block": "vacate", "occupant": "carol", "from": "s-house"})), Err(RefusalCode::NotPresent)),
        (act("developer-system", Some("developer"), json!({"block": "vacate", "occupant": "bob", "from": "s-flats"})), Ok(())),
        (act("alice-self", None, json!({"block": "occupy", "space": "s-house/dwelling.1"})), Err(RefusalCode::AlreadyPresent)),
        (act("carol-self", None, json!({"block": "occupy", "space": "s-flats/dwelling.4"})), Ok(())),
        (act("bob-self", None, json!({"block": "occupy", "space": "s-flats/dwelling.9"})), Err(RefusalCode::UnknownSpace)),
        (act("mayor-system", Some("mayor"), json!({"block": "appoint", "position": "bank-pay", "participant": "alice-self"})), Err(RefusalCode::NotTheirs)),
        (act("mayor-system", Some("mayor"), json!({"block": "appoint", "position": "clerk", "participant": "alice-self"})), Ok(())),
        (act("alice-self", None, json!({"block": "appoint", "position": "clerk"})), Err(RefusalCode::NotTheirs)),
        (act("alice-self", Some("clerk"), json!({"block": "appoint", "position": "clerk"})), Ok(())),
        (act("alice-self", None, json!({"block": "leave"})), Ok(())),
        (act("alice-self", None, json!({"block": "occupy", "space": "s-shop/dwelling.1"})), Err(RefusalCode::NotPresent)),
        (act("mayor-system", Some("mayor"), json!({"block": "leave"})), Err(RefusalCode::NotAPerson)),
    ];
    for (cmd, expected) in cases {
        let Command::Act { participant, position, blocks, .. } = &cmd else { unreachable!() };
        assert_eq!(predict(&run, participant, position.as_deref(), &blocks[0]), Some(expected), "oracle on {cmd:?}");
        let resp = run.done(&cmd).unwrap();
        let got = match &resp.events[0].body {
            EventBody::ActionRefused { code, .. } => Err(*code),
            _ => Ok(()),
        };
        assert_eq!(got, expected, "kernel on {cmd:?}");
    }
}
