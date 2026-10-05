//! The kernel's physics and record mechanics as executable documentation: one
//! focused test per rule, on the Riverbend contract example. Note what is NOT
//! here: no test that anything illegal is refused, because the kernel doesn't
//! know the law (D19).

mod common;

use common::*;
use serde_json::{json, Value};
use oikos_kernel::blocks::RecordBody;
use oikos_kernel::events::{EventBody, RefusalCode, VacateReason};
use oikos_kernel::observe::ChannelData;
use oikos_kernel::run::{Response, Run};
use oikos_kernel::Command;

const DAY: i64 = 86_400;

fn town() -> Run<Vec<u8>> {
    Run::start(riverbend(), "physics", Vec::new(), None).unwrap()
}

/// Act as a Riverbend actor: an organisation's position (held by its system), or a person.
fn act(run: &mut Run<Vec<u8>>, participant: &str, blocks: Value) -> Response {
    run.done(&rb_act(participant, blocks)).unwrap()
}

fn refusal(r: &Response) -> Option<RefusalCode> {
    match &r.events[0].body {
        EventBody::ActionRefused { code, .. } => Some(*code),
        _ => None,
    }
}

fn balance(run: &Run<Vec<u8>>, acc: &str) -> i128 {
    run.kernel().state().accounts[acc].balance
}

fn created(r: &Response, name: &str) -> String {
    match &r.events[0].body {
        EventBody::ActionApplied { created: Some(c), .. } => c[name].clone(),
        other => panic!("expected an applied action, got {other:?}"),
    }
}

#[test]
fn only_the_custodian_can_move_money() {
    let mut run = town();
    let pay = json!([{"block": "transfer", "from": "acc-city", "to": "acc-devco", "amount": "100"}]);
    // The mayor and the city's own finance officer can't move the city's money: the bank holds it.
    assert_eq!(refusal(&act(&mut run, "mayor", pay.clone())), Some(RefusalCode::NotCustodian));
    assert_eq!(refusal(&act(&mut run, "finance", pay.clone())), Some(RefusalCode::NotCustodian));
    // The bank's payment system can, and whether it should is the bank's business (and the records').
    assert_eq!(refusal(&act(&mut run, "bank-payments", pay)), None);
    assert_eq!(balance(&run, "acc-devco"), 200_000_100);
}

#[test]
fn money_cant_be_conjured_or_overdrawn() {
    let mut run = town();
    let r = act(&mut run, "bank-payments", json!([{"block": "transfer", "from": "acc-bob", "to": "acc-devco", "amount": "800001"}]));
    assert_eq!(refusal(&r), Some(RefusalCode::InsufficientFunds));
    let r = act(&mut run, "bank-payments", json!([{"block": "transfer", "from": "acc-outside", "to": "acc-bob", "amount": "1"}]));
    assert_eq!(refusal(&r), Some(RefusalCode::NotCustodian), "only the outside world holds its own account");
}

#[test]
fn money_enters_only_through_the_outside_worlds_own_participant() {
    // Riverbend has nobody acting for the outside world, so no money can come in at all...
    let mut run = town();
    assert_eq!(
        refusal(&act(&mut run, "bank-payments", json!([{"block": "transfer", "from": "acc-outside", "to": "acc-devco", "amount": "1"}]))),
        Some(RefusalCode::NotCustodian)
    );
    // ...until a world gives the outside world a position someone acts in: its behaviour is the boundary condition (D31).
    let mut c = riverbend();
    c["participants"].as_array_mut().unwrap().push(json!({"id": "export-demand-system", "kind": "system", "owner": "outside", "controller": {"type": "code", "impl": "world.export_demand"}, "framing": {"disclosure": "unstated", "reason": "Code controller."}}));
    c["positions"].as_array_mut().unwrap().push(json!({"id": "export-demand", "entity": "outside", "holder": "export-demand-system"}));
    let mut run = Run::start(c, "boundary", Vec::new(), None).unwrap();
    let total = run.kernel().state().total_money();
    assert_eq!(
        refusal(&act(
            &mut run,
            "export-demand",
            json!([{"block": "transfer", "from": "acc-outside", "to": "acc-devco", "amount": "5000000"}])
        )),
        None
    );
    assert_eq!(balance(&run, "acc-outside"), -5_000_000, "the outside world's account goes negative as money flows in");
    assert_eq!(run.kernel().state().total_money(), total, "and total money, counting the outside, is unchanged");
}

#[test]
fn an_account_can_only_close_when_empty() {
    let mut run = town();
    assert_eq!(
        refusal(&act(&mut run, "bank-payments", json!([{"block": "close_account", "account": "acc-carol"}]))),
        Some(RefusalCode::AccountNotEmpty)
    );
    let r = act(
        &mut run,
        "bank-payments",
        json!([
            {"block": "transfer", "from": "acc-carol", "to": "acc-alice", "amount": "1200000"},
            {"block": "close_account", "account": "acc-carol"}
        ]),
    );
    assert_eq!(refusal(&r), None);
    assert!(!run.kernel().state().accounts.contains_key("acc-carol"));
}

#[test]
fn the_river_scenario_an_illegal_building_goes_up_because_physics_allows_it() {
    let mut run = town();
    // The planning office refuses the permit. That's a record, nothing more.
    act(
        &mut run,
        "planning",
        json!([{"block": "publish", "kind": "permit_decision", "speaks_for": "city", "basis": "law-river", "addressed_to": ["devco"], "text": "Refused: river zone."}]),
    );
    // The builder builds on the river lot (p12) anyway, on land the city owns, with no permit.
    let r = act(
        &mut run,
        "builder",
        json!([{"block": "construct", "at": "cell.2.1", "structure_type": "house", "materials_at": "s-shop", "ref": "h"}]),
    );
    assert_eq!(refusal(&r), None, "the kernel doesn't know the law");
    let house = created(&r, "h");
    // Phase B: the house took its materials from the builder's yard (no money paid to nowhere for them).
    assert_eq!(run.kernel().state().holding("buildco", "s-shop", "materials"), 100_000 - 30_000);
    assert!(!r.events.iter().any(|e| matches!(&e.body, EventBody::Transfer { .. })));
    // Ownership is untouched: the city's title record still says what it said.
    assert!(run.kernel().state().records.contains_key("title-p12"));
    assert_eq!(run.kernel().state().structures[&house].built_by.as_deref(), Some("buildco"));

    // The inspector patrols the river every 14 days. Their first observation was at t=0...
    let first = run.command(&Command::Observe { participant: "inspector-system".into(), only: None }).unwrap().observation.unwrap();
    // A look delivers what changed since the last look through the channel; a channel that isn't due is absent.
    let saw = |o: &oikos_kernel::observe::Observation| match o.channels.get("inspector/river-patrol") {
        Some(ChannelData::Sites { cells, .. }) => cells.iter().find(|p| p.cell == "cell.2.1").is_some_and(|p| p.structure.is_some()),
        None => false,
        _ => unreachable!(),
    };
    assert!(saw(&first), "a first look delivers everything the patrol covers");
    // ...so a building started after a look isn't seen until the next one, which delivers the change.
    let mut run = town();
    run.command(&Command::Observe { participant: "inspector-system".into(), only: None }).unwrap();
    act(&mut run, "builder", json!([{"block": "construct", "at": "cell.2.1", "structure_type": "house", "materials_at": "s-shop"}]));
    run.command(&Command::Advance { to: 13 * DAY }).unwrap();
    let before = run.command(&Command::Observe { participant: "inspector-system".into(), only: None }).unwrap().observation.unwrap();
    assert!(!saw(&before), "day 13: the patrol hasn't been by yet");
    run.command(&Command::Advance { to: 14 * DAY }).unwrap();
    let after = run.command(&Command::Observe { participant: "inspector-system".into(), only: None }).unwrap().observation.unwrap();
    assert!(saw(&after), "day 14: the patrol sees it");
}

#[test]
fn building_needs_space_materials_and_time() {
    let mut run = town();
    let build = |ty: &str, at: &str| json!([{"block": "construct", "at": at, "structure_type": ty, "materials_at": "s-shop", "ref": "x"}]);
    assert_eq!(refusal(&act(&mut run, "builder", build("park", "cell.0.1"))), Some(RefusalCode::GroundOccupied));
    assert_eq!(refusal(&act(&mut run, "builder", build("park", "cell.9.9"))), Some(RefusalCode::UnknownCell));
    // Phase B: a building needs its materials, from the builder's own holding where it says they are.
    assert_eq!(refusal(&act(&mut run, "builder", build("apartments", "cell.0.0"))), Some(RefusalCode::InsufficientQuantity));
    assert_eq!(
        refusal(&act(
            &mut run,
            "builder",
            json!([{"block": "construct", "at": "cell.0.0", "structure_type": "park", "materials_at": "s-house"}])
        )),
        Some(RefusalCode::InsufficientQuantity)
    );
    let r = act(&mut run, "builder", build("house", "cell.0.0"));
    let house = created(&r, "x");
    let home = format!("{house}/dwelling.1");
    assert_eq!(refusal(&act(&mut run, "alice-self", json!([{"block": "occupy", "space": home}]))), Some(RefusalCode::StructureIncomplete));
    // (Its building began a few seconds in, when the builder was done with the acts before: it's finished a few
    // seconds after its 90 days.)
    run.command(&Command::Advance { to: 90 * DAY + TICK }).unwrap();
    assert_eq!(refusal(&act(&mut run, "carol-self", json!([{"block": "occupy", "space": home}]))), None);
    assert_eq!(refusal(&act(&mut run, "carol-self", json!([{"block": "occupy", "space": home}]))), Some(RefusalCode::AlreadyPresent));
    assert_eq!(refusal(&act(&mut run, "bob-self", json!([{"block": "occupy", "space": home}]))), Some(RefusalCode::CapacityExceeded));
    assert_eq!(refusal(&act(&mut run, "bob-self", json!([{"block": "occupy", "space": format!("{house}/stable.1")}]))), Some(RefusalCode::UnknownSpace));
    // A space holds bodies: only a person in the world can go into one.
    assert_eq!(refusal(&act(&mut run, "developer", json!([{"block": "occupy", "space": home}]))), Some(RefusalCode::NotAPerson));
}

#[test]
fn eviction_is_an_act_someone_does_and_demolition_displaces_people() {
    let mut run = town();
    assert_eq!(
        refusal(&act(&mut run, "developer", json!([{"block": "vacate", "occupant": "alice", "from": "s-apts"}]))),
        Some(RefusalCode::NotPresent)
    );
    let r = act(&mut run, "developer", json!([{"block": "vacate", "occupant": "bob", "from": "s-apts"}]));
    assert!(matches!(&r.events[1].body, EventBody::Vacated { by, reason: VacateReason::Removed, .. } if by.as_deref() == Some("developer-system")));
    let r = act(&mut run, "carol-self", json!([{"block": "vacate", "occupant": "carol", "from": "s-shop"}]));
    assert!(matches!(&r.events[1].body, EventBody::Vacated { reason: VacateReason::Left, .. }));
    // Anyone who can pay can demolish, and whoever's inside is displaced.
    let r = act(&mut run, "developer", json!([{"block": "demolish", "structure": "s-house"}]));
    assert!(r
        .events
        .iter()
        .any(|e| matches!(&e.body, EventBody::Vacated { occupant, reason: VacateReason::Demolition, .. } if occupant == "alice")));
    assert!(!run.kernel().state().structures.contains_key("s-house"));
}

#[test]
fn bodies_and_the_edge_of_the_world_cant_be_created() {
    let mut run = town();
    for kind in ["person", "boundary"] {
        let r = act(&mut run, "mayor", json!([{"block": "create_entity", "kind": kind, "name": "X"}]));
        assert_eq!(refusal(&r), Some(RefusalCode::ReservedKind));
    }
    let r = act(
        &mut run,
        "mayor",
        json!([{"block": "create_entity", "kind": "trust", "name": "Land Trust", "speaks_for": "city", "ref": "t"}, {"block": "message", "to": ["developer"], "text": "We made a trust."}]),
    );
    assert_eq!(refusal(&r), None);
}

#[test]
fn records_are_append_only_attributed_and_never_judged() {
    let mut run = town();
    let original = run.kernel().state().records["title-p12"].clone();
    // Anyone can record that the city's land is now theirs: a forgery, on the record as such.
    let r = act(
        &mut run,
        "developer",
        json!([{"block": "transfer_claim", "claim": "title-p12", "to": "devco", "speaks_for": "city", "ref": "f"}]),
    );
    let forged = created(&r, "f");
    let st = run.kernel().state();
    assert_eq!(st.records["title-p12"], original, "the original title is untouched");
    let f = &st.records[&forged].record;
    assert_eq!((f.author.as_str(), f.position.as_deref(), f.speaks_for.as_deref()), ("developer-system", Some("developer"), Some("city")), "who really wrote it, and in what capacity, is recorded");
    // References must point at the right kind of record; that's mechanics, not law.
    let r = act(&mut run, "developer", json!([{"block": "transfer_claim", "claim": "law-river", "to": "devco"}]));
    assert_eq!(refusal(&r), Some(RefusalCode::WrongRecordKind));
    let r = act(&mut run, "developer", json!([{"block": "sign_agreement", "agreement": "rec.999", "as": "devco"}]));
    assert_eq!(refusal(&r), Some(RefusalCode::UnknownRecord));
}

#[test]
fn agreements_execute_nothing_by_themselves() {
    let mut run = town();
    let bob = balance(&run, "acc-bob");
    // Bob's lease says he pays monthly, and he gave the bank a standing order. A year passes
    // with no one acting: no money moves. Paying is something the bank's people (or systems) do.
    run.command(&Command::Advance { to: 365 * DAY }).unwrap();
    assert_eq!(balance(&run, "acc-bob"), bob);
}

#[test]
fn visibility_decides_who_perceives_what() {
    // Give Bob a channel showing every record, so only visibility can hide one from him.
    let mut c = riverbend();
    let bob = c["participants"].as_array_mut().unwrap().iter_mut().find(|s| s["id"] == "bob-self").unwrap();
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "everything", "kind": "records", "match": {}}));
    let mut run = Run::start(c, "visibility", Vec::new(), None).unwrap();
    let sees = |run: &mut Run<Vec<u8>>, participant: &str, id: &str| {
        let obs = run.command(&Command::Observe { participant: participant.into(), only: None }).unwrap().observation.unwrap();
        obs.channels.values().any(|c| matches!(c, ChannelData::Records { records, .. } if records.iter().any(|r| r.id == id)))
    };
    // Bob's lease is visible to Bob and devco, not to Alice.
    assert!(sees(&mut run, "bob-self", "lease-bob"));
    assert!(!sees(&mut run, "alice-self", "lease-bob"));
    // A vote is seen by the voter and whoever runs the ballot, not by other citizens.
    let r = act(
        &mut run,
        "mayor",
        json!([{"block": "publish", "kind": "ballot", "speaks_for": "city", "text": "Repeal law-river?", "ref": "b"}]),
    );
    let ballot = created(&r, "b");
    let r = act(&mut run, "alice-self", json!([{"block": "vote", "ballot": ballot, "choice": "no", "speaks_for": "alice"}]));
    let vote = match &r.events[1].body {
        EventBody::Recorded { record } => {
            assert!(matches!(record.body, RecordBody::Vote { .. }));
            record.id.clone()
        }
        other => panic!("{other:?}"),
    };
    let rec = &run.kernel().state().records[&vote].record;
    assert_eq!(
        rec.visible_to,
        oikos_kernel::blocks::Visibility::only(["alice".to_string(), "city".to_string()]),
        "voter and the ballot's runner"
    );
    assert!(sees(&mut run, "alice-self", &vote));
    // One look for Bob (a look delivers each new record once): the public ballot, but not Alice's vote.
    let obs = run.command(&Command::Observe { participant: "bob-self".into(), only: None }).unwrap().observation.unwrap();
    let got = |id: &str| obs.channels.values().any(|c| matches!(c, ChannelData::Records { records, .. } if records.iter().any(|r| r.id == id)));
    assert!(!got(&vote));
    assert!(got(&ballot), "the ballot itself is public, so Bob's channel does show public records");
}

#[test]
fn actions_are_atomic() {
    let mut run = town();
    let before = run.kernel().state().clone();
    let r = act(
        &mut run,
        "bank-payments",
        json!([
            {"block": "open_account", "holder": "carol", "ref": "a"},
            {"block": "transfer", "from": "acc-bob", "to": "$a", "amount": "1000"},
            {"block": "transfer", "from": "acc-bob", "to": "$a", "amount": "999999999"}
        ]),
    );
    assert!(matches!(&r.events[0].body, EventBody::ActionRefused { code: RefusalCode::InsufficientFunds, block: Some(2), .. }));
    let after = run.kernel().state();
    assert_eq!(before.accounts, after.accounts);
    assert_eq!(before.counters.acc, after.counters.acc, "the aborted account's id was never minted");
}

#[test]
fn opting_out_silences_a_participant_unless_the_world_names_a_stand_in() {
    // Vacant (the default): once the mayor's controller opts out, it never acts again, and its office falls vacant.
    let mut run = town();
    let r = run.command(&Command::OptOut { participant: "mayor-system".into(), statement: "I'd like to stop.".into() }).unwrap();
    assert!(r.events.iter().any(|e| matches!(&e.body, EventBody::Appointed { position, holder: None, by: None } if position == "mayor")));
    let r = act(&mut run, "mayor", json!([{"block": "message", "to": ["city"], "text": "hello"}]));
    assert_eq!(refusal(&r), Some(RefusalCode::ParticipantInactive));

    // With a code stand-in named in the world config, it goes on acting, in its offices (the orchestrator runs the stand-in).
    let mut cfg = riverbend();
    let parts = cfg["participants"].as_array_mut().unwrap();
    let mayor = parts.iter_mut().find(|s| s["id"] == "mayor-system").unwrap();
    mayor["on_opt_out"] = json!({"code": "idle"});
    let mut run = Run::start(cfg, "physics-stand-in", Vec::new(), None).unwrap();
    run.command(&Command::OptOut { participant: "mayor-system".into(), statement: "I'd like to stop.".into() }).unwrap();
    let r = act(&mut run, "mayor", json!([{"block": "message", "to": ["city"], "text": "hello"}]));
    assert_eq!(refusal(&r), None);
}
