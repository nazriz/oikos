//! The kernel's physics and record mechanics as executable documentation: one
//! focused test per rule, on the Riverbend contract example. Note what is NOT
//! here: no test that anything illegal is refused, because the kernel doesn't
//! know the law (D19).

use crate::common;

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
        EventBody::ActionApplied { created: Some(c), .. } => c[name].to_string(),
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
    // A payment moves a whole positive amount: one of nothing, or of less, is no payment (a bill is not settled by it).
    let before = (balance(&run, "acc-bob"), balance(&run, "acc-devco"));
    for amount in ["0", "-5"] {
        // (Refused as an act, or not taken as one: either way nothing moves.)
        let r = run.done(&rb_act("bank-payments", json!([{"block": "transfer", "from": "acc-bob", "to": "acc-devco", "amount": amount}])));
        assert!(r.as_ref().map_or(true, |r| refusal(r).is_some()), "a transfer of {amount} is refused");
    }
    assert_eq!((balance(&run, "acc-bob"), balance(&run, "acc-devco")), before);
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
    c["participants"].as_array_mut().unwrap().push(json!({"id": "export-demand-system", "kind": "system", "owner": "outside", "template": "installed-system", "supplier": "outside", "controller": {"type": "code", "impl": "world.export_demand"}, "framing": {"disclosure": "unstated", "reason": "Code controller."}}));
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
    assert_eq!(run.kernel().state().structures[house.as_str()].built_by.as_deref(), Some("buildco"));

    // The inspector is shown none of the river bank: it sees what stands there by going (docs/design/knowing.md).
    // Until 2026-10-08 this test had a patrol channel over the bank's cells, looked through every 14 days; a map of
    // somewhere a seat is not can no longer be written, so the same thing is checked of a visit: nothing comes
    // unasked, and what a visit brings is what was there when the inspector was.
    let first = run.command(&Command::Observe { participant: "inspector-system".into(), only: None }).unwrap().observation.unwrap();
    assert!(!first.channels.contains_key("inspector/river-patrol"), "nothing of the bank is shown to someone who hasn't gone");
    let built = |cells: &[oikos_kernel::observe::SiteCell]| cells.iter().find(|p| p.cell == "cell.2.1").is_some_and(|p| p.structure.is_some());
    assert!(built(&go_and_see(&mut run, "inspector-system", "inspector/river-patrol", &["cell.2.1"])), "going there, it sees the house");
    // ...and a building started after a visit isn't seen until someone goes again.
    let mut run = town();
    assert!(!built(&go_and_see(&mut run, "inspector-system", "inspector/river-patrol", &["cell.2.1"])), "bare ground when it went");
    act(&mut run, "builder", json!([{"block": "construct", "at": "cell.2.1", "structure_type": "house", "materials_at": "s-shop"}]));
    run.command(&Command::Advance { to: 13 * DAY }).unwrap();
    let before = run.command(&Command::Observe { participant: "inspector-system".into(), only: None }).unwrap().observation.unwrap();
    assert!(!before.channels.contains_key("inspector/river-patrol"), "day 13: nobody has been by, so nothing is seen");
    assert!(built(&go_and_see(&mut run, "inspector-system", "inspector/river-patrol", &["cell.2.1"])), "going again, it sees it");
    // A visit takes the looker's time, and says so: half an hour at the place in this world (`knowing.visit_seconds`).
    assert!(run.kernel().state().t >= 13 * DAY + 1800);
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
    let f = &st.records[forged.as_str()].record;
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
    // Give Bob a channel onto every kind of record, so only visibility can hide one from him. No channel shows "any
    // record" any more (docs/design/knowing.md): for this test the world declares every kind of record published, and
    // Bob reads them all.
    let mut c = riverbend();
    let kinds = ["claim", "claim_transfer", "claim_release", "agreement", "signature", "notice", "statement", "withdrawal", "vote", "entity_declaration"];
    let published = c["knowing"]["published"].as_array_mut().unwrap();
    published.extend(kinds.iter().map(|k| json!({"what": format!("records:{k}"), "why": "For this test, every record is published: only visibility hides one."})));
    c["knowing"]["keepers"] = json!([]);
    let bob = c["participants"].as_array_mut().unwrap().iter_mut().find(|s| s["id"] == "bob-self").unwrap();
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "everything", "kind": "records", "way": "published", "match": {"records": kinds}}));
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
            record.id
        }
        other => panic!("{other:?}"),
    };
    let rec = &run.kernel().state().records[&vote].record;
    assert_eq!(
        rec.visible_to,
        oikos_kernel::blocks::Visibility::only(["alice".into(), "city".into()]),
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

#[test]
fn a_place_committed_to_is_a_place() {
    // Pilot lv-10 (2026-10-24): an employment whose work site was a job posting's id was signed, and the worker could
    // never come to work. Where a party commits to be or to work must be a building or a space in one; the act is refused
    // otherwise, with a reason the actor sees.
    let mut run = town();
    let r = act(&mut run, "developer", json!([{"block": "publish", "kind": "job_posting", "text": "Hiring.", "speaks_for": "devco", "ref": "post"}]));
    let posting = created(&r, "post");
    let job = |at: &str, k: &str| json!([{"block": "propose_agreement", "speaks_for": "devco", "terms": {"template": "employment", "parties": ["devco", "alice"],
        "commitments": [{"who": "devco", "every": 14 * DAY, "does": {"outcome": {"money": {"amount": "100000", "to": "acc-alice"}}}},
                        {"who": "alice", "does": {"outcome": if k == "work" { json!({"work": {"task": "serve", "at": at}}) } else { json!({"occupancy": {"in": at}}) }}}]}}]);
    for k in ["work", "occupancy"] {
        for bad in [posting.as_str(), "s-shop/stable.1", "nowhere/workplace.1", "cell.0.0"] {
            let r = act(&mut run, "developer", job(bad, k));
            assert_eq!(refusal(&r), Some(RefusalCode::NotAPlace), "{k} at {bad}");
            let EventBody::ActionRefused { detail: Some(detail), .. } = &r.events[0].body else { unreachable!() };
            assert!(detail.contains(&format!("{bad}, where alice commits to")) && detail.contains("is not a place"), "{detail}");
        }
        for good in ["s-shop/workplace.1", "s-shop"] {
            assert_eq!(refusal(&act(&mut run, "developer", job(good, k))), None, "{k} at {good}");
        }
    }
}

#[test]
fn an_offer_its_owner_has_taken_back_cannot_be_signed() {
    let offer = |run: &mut Run<Vec<u8>>| {
        let r = act(run, "developer", json!([{"block": "propose_agreement", "speaks_for": "devco", "ref": "job", "terms": {"template": "construction", "parties": ["devco", "buildco"], "commitments": [{"who": "buildco", "does": {"outcome": {"structure": {"type": "apartments", "on": "p12"}}}}]}},
                                             {"block": "sign_agreement", "agreement": "$job", "as": "devco"}]));
        created(&r, "job")
    };
    let signatures = |run: &Run<Vec<u8>>, a: &str| run.kernel().state().marks.get(a).map_or(0, |m| m.signatures.len());
    let mut run = town();

    // Taken back by someone else (anyone may write that they "withdraw" anything): nothing is taken back, the signature stands.
    let a = offer(&mut run);
    act(&mut run, "builder", json!([{"block": "withdraw", "record": a, "speaks_for": "buildco"}]));
    assert_eq!(refusal(&act(&mut run, "builder", json!([{"block": "sign_agreement", "agreement": a, "as": "buildco"}]))), None);
    assert_eq!(signatures(&run, &a), 2);

    // Taken back by its owner before the other party signed: a signature after it is refused, in the same instant too
    // (the order the kernel took the two commands in decides, and a refusal leaves no record).
    let b = offer(&mut run);
    act(&mut run, "developer", json!([{"block": "withdraw", "record": b, "speaks_for": "devco"}]));
    let before = run.kernel().state().records.len();
    let r = act(&mut run, "builder", json!([{"block": "sign_agreement", "agreement": b, "as": "buildco"}]));
    assert_eq!(refusal(&r), Some(RefusalCode::OfferWithdrawn));
    assert_eq!(run.kernel().state().records.len(), before, "a refused signature is not on the record");
    assert_eq!(signatures(&run, &b), 1);
    run.command(&Command::Advance { to: DAY }).unwrap();
    assert_eq!(refusal(&act(&mut run, "builder", json!([{"block": "sign_agreement", "agreement": b, "as": "buildco"}]))), Some(RefusalCode::OfferWithdrawn), "nor a day later");

    // The signature that came first stands, and withdrawing the paper afterwards ends nothing: signing again is harmless.
    let c = offer(&mut run);
    assert_eq!(refusal(&act(&mut run, "builder", json!([{"block": "sign_agreement", "agreement": c, "as": "buildco"}]))), None);
    act(&mut run, "developer", json!([{"block": "withdraw", "record": c, "speaks_for": "devco"}]));
    assert_eq!(refusal(&act(&mut run, "builder", json!([{"block": "sign_agreement", "agreement": c, "as": "buildco"}]))), None);
    assert_eq!(signatures(&run, &c), 3);
}
