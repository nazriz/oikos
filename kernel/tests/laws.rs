//! The laws as executable documentation: one focused test per rule, on the
//! Riverbend example world (contracts/examples/valid/world-config/riverbend-mini.json).

mod common;

use common::*;
use serde_json::{json, Value};
use terrarium_kernel::events::{Event, EventName, Reason, RefusalCode};
use terrarium_kernel::run::{Response, Run};
use terrarium_kernel::Command;

const DAY: i64 = 86_400;

/// Riverbend with every seat given every power directly, so each test isolates one law.
fn town() -> Run<Vec<u8>> {
    let mut c = riverbend();
    for seat in c["seats"].as_array_mut().unwrap() {
        seat["mandate"] = json!({"powers": [{"blocks": ALL_BLOCKS, "level": "direct"}]});
    }
    Run::start(c, "laws", Vec::new(), None).unwrap()
}

fn act(run: &mut Run<Vec<u8>>, seat: &str, blocks: Value) -> Response {
    let cmd = Command::Act {
        seat: seat.into(),
        blocks: serde_json::from_value(blocks).unwrap(),
        provenance: json!({"via": "direct"}),
        reasoning: None,
    };
    run.command(&cmd).unwrap()
}

fn advance(run: &mut Run<Vec<u8>>, to: i64) -> Response {
    run.command(&Command::Advance { to }).unwrap()
}

fn refusal(r: &Response) -> Option<RefusalCode> {
    r.events.iter().find(|e| e.event == EventName::ActionRefused).and_then(|e| e.code)
}

fn find(r: &Response, name: EventName) -> Vec<&Event> {
    r.events.iter().filter(|e| e.event == name).collect()
}

fn balance(run: &Run<Vec<u8>>, id: &str) -> i64 {
    run.kernel().state().entities[id].balance
}

#[test]
fn lease_lifecycle_offer_accept_pay_notice_end() {
    let mut run = town();
    // devco offers alice one flat on p10 (12 units, 1 let to bob).
    let r = act(
        &mut run,
        "developer",
        json!([{"block": "propose_agreement", "terms": {"type": "lease", "lessor": "devco", "lessee": "alice", "parcel": "p10", "units": 1, "rent": 150_000, "period": 30 * DAY, "notice": 60 * DAY}, "ref": "l"}]),
    );
    let agr = r.events[0].created.as_ref().unwrap()["l"].clone();
    assert!(find(&r, EventName::AgreementActivated).is_empty(), "alice hasn't accepted yet");

    // Only a seat that can act for alice can accept for her. Give her one.
    assert_eq!(
        refusal(&act(&mut run, "mayor", json!([{"block": "respond_agreement", "agreement": agr, "as": "alice", "decision": "accept"}]))),
        Some(RefusalCode::NotAuthorized)
    );
    let mut c = riverbend();
    c["seats"].as_array_mut().unwrap().push(json!({
        "id": "alice-seat", "principal": "alice", "mandate": {"powers": [{"blocks": ["respond_agreement", "terminate_agreement"], "level": "direct"}]},
        "channels": [], "controller": {"type": "code"}, "framing": {"disclosure": "unstated", "reason": "test"}
    }));
    let mut run = Run::start(c, "lease", Vec::new(), None).unwrap();
    let r = act(
        &mut run,
        "developer",
        json!([{"block": "propose_agreement", "terms": {"type": "lease", "lessor": "devco", "lessee": "alice", "parcel": "p10", "units": 1, "rent": 150_000, "period": 30 * DAY, "notice": 60 * DAY}, "ref": "l"}]),
    );
    let agr = r.events[0].created.as_ref().unwrap()["l"].clone();
    let r = act(&mut run, "alice-seat", json!([{"block": "respond_agreement", "agreement": agr, "as": "alice", "decision": "accept"}]));
    assert_eq!(find(&r, EventName::AgreementActivated).len(), 1);
    let use_right = find(&r, EventName::RightCreated)[0].right.clone().unwrap();

    // Rent is paid in advance: first payment at activation, then every period.
    let before = balance(&run, "alice");
    let r = advance(&mut run, 0);
    assert_eq!(find(&r, EventName::Transfer)[0].amount, Some(150_000));
    advance(&mut run, 30 * DAY);
    assert_eq!(balance(&run, "alice"), before - 300_000);

    // Notice: payments continue until the notice period ends, then the use right goes.
    let r = act(&mut run, "alice-seat", json!([{"block": "terminate_agreement", "agreement": agr, "as": "alice"}]));
    assert_eq!(find(&r, EventName::AgreementNotice)[0].at, Some(30 * DAY + 60 * DAY));
    let r = advance(&mut run, 120 * DAY);
    let ended = find(&r, EventName::AgreementEnded);
    assert_eq!(ended[0].reason, Some(Reason::Terminated));
    assert!(!run.kernel().state().rights.contains_key(&use_right));
    assert_eq!(balance(&run, "alice"), before - 3 * 150_000, "paid at 0, 30 and 60 days; notice ended at 90");
}

#[test]
fn rent_caps_refuse_new_leases_and_can_clip_existing_ones() {
    let mut run = town();
    // Cap: 160,000 per unit per 30 days, new agreements only.
    act(
        &mut run,
        "mayor",
        json!([{"block": "enact_rule", "jurisdiction": "city", "rule": {"type": "rent_cap", "parcels": "all", "max_per_30d": 160_000, "applies_to": "new_agreements"}}]),
    );
    let offer = |rent: i64, period: i64| json!([{"block": "propose_agreement", "terms": {"type": "lease", "lessor": "devco", "lessee": "carol", "parcel": "p10", "units": 2, "rent": rent, "period": period, "notice": 30 * DAY}}]);
    assert_eq!(refusal(&act(&mut run, "developer", offer(320_001, 30 * DAY))), Some(RefusalCode::RentCapViolation));
    assert_eq!(refusal(&act(&mut run, "developer", offer(320_000, 30 * DAY))), None, "2 units at the cap");
    assert_eq!(
        refusal(&act(&mut run, "developer", offer(160_001, 15 * DAY))),
        Some(RefusalCode::RentCapViolation),
        "normalised to 30 days"
    );

    // Bob's existing lease (180,000/30 days) is untouched by a new-agreements cap...
    let r = advance(&mut run, 30 * DAY);
    assert!(find(&r, EventName::Transfer).iter().any(|e| e.from.as_deref() == Some("bob") && e.amount == Some(180_000)));
    // ...but clipped by an all-payments cap.
    act(
        &mut run,
        "mayor",
        json!([{"block": "enact_rule", "jurisdiction": "city", "rule": {"type": "rent_cap", "parcels": ["p10"], "max_per_30d": 100_000, "applies_to": "all_payments"}}]),
    );
    let r = advance(&mut run, 60 * DAY);
    assert!(find(&r, EventName::Transfer).iter().any(|e| e.from.as_deref() == Some("bob") && e.amount == Some(100_000)));
}

#[test]
fn the_latest_zoning_rule_wins_and_unzoned_land_is_unrestricted() {
    let mut run = town();
    let build = |ty: &str, parcel: &str| json!([{"block": "construct", "owner": "city", "parcel": parcel, "structure_type": ty, "contractor": "outside"}]);
    assert_eq!(
        refusal(&act(&mut run, "mayor", build("shop", "p12"))),
        Some(RefusalCode::ZoningViolation),
        "river zone is residential/green"
    );
    act(
        &mut run,
        "mayor",
        json!([{"block": "enact_rule", "jurisdiction": "city", "rule": {"type": "zoning", "parcels": ["p12"], "allow": ["commercial"]}, "ref": "z"}]),
    );
    assert_eq!(refusal(&act(&mut run, "mayor", build("shop", "p12"))), None);

    // With no zoning rule at all, building is unrestricted.
    let mut c = riverbend();
    c["world"]["rules"] = json!([]);
    c["catalogue"]["structure_types"].as_array_mut().unwrap().push(
        json!({"id": "factory", "category": "industrial", "cost": 1_000, "build_time": 60, "demolish_cost": 1, "units": 0, "jobs": 10}),
    );
    for seat in c["seats"].as_array_mut().unwrap() {
        seat["mandate"] = json!({"powers": [{"blocks": ALL_BLOCKS, "level": "direct"}]});
    }
    let mut run = Run::start(c, "unzoned", Vec::new(), None).unwrap();
    assert_eq!(refusal(&act(&mut run, "mayor", build("factory", "p01"))), None);
}

#[test]
fn construction_takes_time_and_unfinished_buildings_cannot_be_let() {
    let mut run = town();
    // Apartments take 180 days (a whole number of 60-second ticks).
    let r = act(
        &mut run,
        "mayor",
        json!([{"block": "construct", "owner": "city", "parcel": "p00", "structure_type": "apartments", "contractor": "outside", "ref": "a"}]),
    );
    let s = r.events[0].created.as_ref().unwrap()["a"].clone();
    assert_eq!(find(&r, EventName::StructureStarted)[0].at, Some(15_552_000));
    assert_eq!(
        find(&r, EventName::Transfer)[0].to,
        Some(terrarium_kernel::events::OneOrMany::One("outside".into())),
        "paying the boundary is money leaving the world"
    );
    let lease = json!([{"block": "propose_agreement", "terms": {"type": "lease", "lessor": "city", "lessee": "bob", "parcel": "p00", "units": 1, "rent": 1, "period": 30 * DAY, "notice": 30 * DAY}}]);
    assert_eq!(refusal(&act(&mut run, "mayor", lease.clone())), Some(RefusalCode::StructureIncomplete));
    let r = advance(&mut run, 15_552_000);
    assert_eq!(find(&r, EventName::StructureCompleted)[0].structure.as_deref(), Some(s.as_str()));
    assert_eq!(refusal(&act(&mut run, "mayor", lease)), None);
}

#[test]
fn structures_are_fixtures_and_encumbered_land_cannot_be_sold() {
    // Alice sells her house plot to the city: the house goes with it.
    let mut c = riverbend();
    c["seats"].as_array_mut().unwrap().push(json!({
        "id": "alice-seat", "principal": "alice", "mandate": {"powers": [{"blocks": ["transfer_right"], "level": "direct"}]},
        "channels": [], "controller": {"type": "code"}, "framing": {"disclosure": "unstated", "reason": "test"}
    }));
    let mut run2 = Run::start(c, "fixtures", Vec::new(), None).unwrap();
    act(&mut run2, "alice-seat", json!([{"block": "transfer_right", "right": "r-p11", "to": "city"}]));
    assert_eq!(run2.kernel().state().structures["s-house"].owner, "city");

    // devco's flats are let to bob: the surface right is encumbered by his lease.
    let mut run = town();
    assert_eq!(
        refusal(&act(&mut run, "developer", json!([{"block": "transfer_right", "right": "r-p10", "to": "city"}]))),
        Some(RefusalCode::InvalidState)
    );
    // And the building can't be demolished out from under him.
    assert_eq!(
        refusal(&act(&mut run, "developer", json!([{"block": "demolish", "structure": "s-apts", "contractor": "outside"}]))),
        Some(RefusalCode::StructureInUse)
    );
}

#[test]
fn dissolution_passes_everything_to_the_successor() {
    let mut run = town();
    let r = act(
        &mut run,
        "mayor",
        json!([
            {"block": "create_entity", "founder": "city", "kind": "trust", "name": "Land Trust", "ref": "t"},
            {"block": "transfer", "from": "city", "to": "$t", "amount": 4_000_000},
            {"block": "transfer_right", "right": "r-p12", "to": "$t"}
        ]),
    );
    let trust = r.events[0].created.as_ref().unwrap()["t"].clone();
    assert_eq!(balance(&run, &trust), 4_000_000);
    // The city controls the trust, so the mayor can act for it.
    let r = act(&mut run, "mayor", json!([{"block": "dissolve_entity", "entity": trust, "successor": "council"}]));
    assert_eq!(refusal(&r), None);
    assert_eq!(balance(&run, "council"), 4_000_000);
    assert_eq!(run.kernel().state().rights["r-p12"].holder, "council");
    assert_eq!(
        refusal(&act(&mut run, "mayor", json!([{"block": "transfer", "from": trust, "to": "city", "amount": 1}]))),
        Some(RefusalCode::EntityInactive)
    );
    // Governments, people and the boundary can't be dissolved.
    assert_eq!(
        refusal(&act(&mut run, "mayor", json!([{"block": "dissolve_entity", "entity": "city", "successor": "council"}]))),
        Some(RefusalCode::InvalidKind)
    );
}

#[test]
fn the_boundary_receives_but_never_pays() {
    let mut run = town();
    assert_eq!(
        refusal(&act(&mut run, "mayor", json!([{"block": "transfer", "from": "outside", "to": "city", "amount": 1}]))),
        Some(RefusalCode::BoundaryProtected)
    );
    act(&mut run, "mayor", json!([{"block": "transfer", "from": "city", "to": "outside", "amount": 500}]));
    assert_eq!(balance(&run, "outside"), 500);
}

#[test]
fn atomic_actions_leave_no_trace_when_any_block_fails() {
    let mut run = town();
    let before = run.kernel().state().clone();
    let r = act(
        &mut run,
        "mayor",
        json!([
            {"block": "create_entity", "founder": "city", "kind": "trust", "name": "T", "ref": "t"},
            {"block": "transfer", "from": "city", "to": "$t", "amount": 1_000},
            {"block": "transfer", "from": "city", "to": "$t", "amount": 999_999_999_999i64}
        ]),
    );
    let refused = &r.events[0];
    assert_eq!((refused.code, refused.block), (Some(RefusalCode::InsufficientFunds), Some(2)));
    assert_eq!(r.events.len(), 1);
    let after = run.kernel().state();
    assert_eq!(before.entities, after.entities);
    assert_eq!(before.counters.ent, after.counters.ent, "the aborted trust's id was never minted");
}

#[test]
fn messages_reach_every_seat_of_an_entity_and_observations_consume_them() {
    let mut run = town();
    act(&mut run, "developer", json!([{"block": "message", "to": ["city", "council-seat"], "text": "Rezone p12?"}]));
    let obs = run.command(&Command::Observe { seat: "mayor".into() }).unwrap().observation.unwrap();
    assert_eq!(obs.inbox.len(), 1);
    assert_eq!(obs.inbox[0].from, "developer");
    let again = run.command(&Command::Observe { seat: "mayor".into() }).unwrap().observation.unwrap();
    assert!(again.inbox.is_empty(), "inbox shows only what is new");
    run.command(&Command::Resign { seat: "council-seat".into(), statement: "enough".into() }).unwrap();
    let r = act(&mut run, "developer", json!([{"block": "message", "to": ["council"], "text": "hello?"}]));
    assert_eq!(
        find(&r, EventName::MessageDelivered)[0].to,
        Some(terrarium_kernel::events::OneOrMany::Many(vec![])),
        "resigned seats receive nothing"
    );
}
