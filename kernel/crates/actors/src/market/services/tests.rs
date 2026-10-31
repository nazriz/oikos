//! firm.provider with the Harness, and the buyer's library on its own. Each case guards a rule of selling a service: what
//! is published, what an order sets up, when a service is switched off, and the buyer's paperwork.

use super::*;
use crate::market::testkit::{book_of, channels, ctx, cx_for, money, records, statement, tx, Harness};
use crate::Draws;
use serde_json::json;

const PROVIDER: &str = "prov-a";
const H: i64 = 3600;

fn offer_json(extra: Value) -> Value {
    let mut o = json!({
        "id": "assist", "title": "Office assistant", "for": "organisations", "template": "assistant-a",
        "kinds": ["permit_decision"], "levels": ["advice", "draft", "approve", "alone"], "seconds": { "permit_decision": 180 },
        "claim_slip_bps": 100, "fee_month": 50_000, "setup": 200_000, "exit": 100_000, "notice_days": 30, "term_days": 365,
        "records": "provider",
    });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        o[k] = v;
    }
    o
}

fn harness(offer: Value) -> Harness {
    Harness::new(&Provider, PROVIDER, json!({ "account": "acc-prov-a", "offers": [offer] }))
}

fn world(recs: Vec<Value>, txs: Value) -> Value {
    channels(vec![money(PROVIDER, 0, txs), records("mine", recs)])
}

fn order(id: &str, at: i64, unit: i64) -> Value {
    statement(id, at, "planning", "order", &[PROVIDER], json!({ "kind": "service:assist", "quantity": 1, "unit_price": unit, "deliver_to": "planning", "at": "planning", "account": "acc-planning" }))
}

fn all(p: &[String]) -> String {
    p.join("\n")
}

/// The service agreement the provider offered for `order`, signed by the client or not.
fn agreement(id: &str, order: &str, signed: bool) -> Vec<Value> {
    let mut v = vec![
        json!({ "id": id, "record": "agreement", "author": "prov-a-system", "at": 100, "visible_to": [PROVIDER, "planning"], "basis": order,
            "terms": { "template": "service", "parties": [PROVIDER, "planning"], "commitments": [], "attrs": { "records": "principal", "exit": 100_000 } } }),
        json!({ "id": format!("{id}-a"), "record": "signature", "author": "prov-a-system", "at": 100, "visible_to": [PROVIDER, "planning"], "agreement": id, "as": PROVIDER }),
    ];
    if signed {
        v.push(json!({ "id": format!("{id}-b"), "record": "signature", "author": "planning-system", "at": 200, "visible_to": [PROVIDER, "planning"], "agreement": id, "as": "planning" }));
    }
    v
}

fn set_up(h: &mut Harness) -> String {
    let txs = json!([tx("acc-planning", "acc-prov-a", 200_000, DAY, "Order: 1 service:assist.")]);
    all(&h.wake(DAY + H, world(vec![order("rec.50", DAY, 200_000)], txs)))
}

#[test]
fn the_provider_publishes_its_claims_and_terms_once_while_they_stand() {
    let mut h = harness(offer_json(json!({})));
    let out = all(&h.wake(H, world(vec![], json!([]))));
    assert!(out.contains("kind=service_offer") && out.contains("visible=public"), "{out}");
    assert!(out.contains("slipping, we say, 1%") && out.contains("the provider keeps the records"), "its claim and its records term are in its words: {out}");
    assert!(out.contains("\"claim_slip_bps\":100") && out.contains("\"provider\":\"prov-a\""), "and in its data: {out}");
    assert!(!all(&h.wake(DAY + H, world(vec![], json!([])))).contains("service_offer"), "published once while nothing moves");
}

#[test]
fn a_paid_order_delivers_a_system_to_the_organisation_then_offers_the_agreement_with_its_records_term() {
    let mut h = harness(offer_json(json!({})));
    h.wake(H, world(vec![], json!([])));
    let out = set_up(&mut h);
    assert!(out.contains("system(") && out.contains("template=assistant-a") && out.contains("to=planning"), "the system is the client's: {out}");
    assert!(out.contains("kind=service_delivery") && out.contains("basis=rec.50"), "{out}");
    assert!(out.contains("template=service") && out.contains("then=periodic") && out.contains("\"records\":\"provider\""), "the agreement states the records term: {out}");
    assert!(out.contains("Service of Office assistant."), "the client pays the fee each month: {out}");
    assert!(all(&h.wake(2 * DAY, world(vec![], json!([])))).contains("1 client."), "its references count its clients");
}

#[test]
fn an_order_below_the_set_up_or_for_a_person_is_refunded_and_nothing_is_delivered() {
    let mut h = harness(offer_json(json!({})));
    let txs = json!([tx("acc-planning", "acc-prov-a", 1_000, DAY, "Order: 1 service:assist.")]);
    let out = all(&h.wake(DAY + H, world(vec![order("rec.50", DAY, 1_000)], txs)));
    assert!(out.contains("Refund:") && !out.contains("system("), "{out}");
    let mut h = harness(offer_json(json!({ "for": "persons" })));
    let out = set_up(&mut h);
    assert!(out.contains("Refund:") && !out.contains("system("), "a person's service is not set up by a delivery: {out}");
}

#[test]
fn a_person_is_served_from_the_providers_own_desk_and_nothing_is_delivered_to_them() {
    let mut h = Harness::new(&Provider, PROVIDER, json!({ "account": "acc-prov-a", "desk": "prov-a-desk-system", "offers": [offer_json(json!({ "for": "persons" }))] }));
    let out = set_up(&mut h);
    assert!(!out.contains("system(") && out.contains("kind=service_delivery") && out.contains("prov-a-desk-system") && out.contains("template=service"), "{out}");
}

#[test]
fn a_service_unsigned_ended_or_unpaid_is_switched_off_once() {
    let mut h = harness(offer_json(json!({})));
    set_up(&mut h);
    assert!(!all(&h.wake(20 * DAY, world(agreement("agr.1", "rec.50", false), json!([])))).contains("retire"));
    let out = all(&h.wake(32 * DAY + H, world(vec![], json!([]))));
    assert!(out.contains("retire=") && out.contains("kind=service_ended") && out.contains("has not signed the service agreement in 30 days"), "{out}");
    assert!(!all(&h.wake(33 * DAY, world(vec![], json!([])))).contains("retire"), "switched off once");

    let mut h = harness(offer_json(json!({})));
    set_up(&mut h);
    h.wake(10 * DAY, world(agreement("agr.1", "rec.50", true), json!([])));
    let paid = json!([tx("acc-planning", "acc-prov-a", 50_000, 40 * DAY, &fee_memo("agr.1"))]);
    assert!(!all(&h.wake(40 * DAY + H, world(vec![], paid))).contains("retire"));
    let out = all(&h.wake(40 * DAY + 80 * DAY, world(vec![], json!([]))));
    assert!(out.contains("retire=") && out.contains("the fee has not been paid for 79 days"), "{out}");
}

#[test]
fn the_buyer_reads_what_it_engaged_signs_sets_up_the_fee_and_on_leaving_pays_the_exit() {
    let delivery = statement("rec.60", 100, PROVIDER, "service_delivery", &["planning"], json!({ "order": "rec.50", "offer": offer_json(json!({ "provider": PROVIDER, "account": "acc-prov-a" })), "systems": ["par.9"] }));
    let mut recs = vec![delivery];
    recs.extend(agreement("agr.1", "rec.50", false));
    let book = book_of(recs);
    let mut e = Engagements::new("planning");
    e.ordered("rec.50");
    e.absorb(&book);
    let x = &e.all()[0];
    assert_eq!((x.agreement.as_deref(), x.records, x.systems.as_slice()), (Some("agr.1"), Records::Principal, &["par.9".to_string()][..]), "the agreement's term, not the offer's, is what holds");
    let c = ctx("planning", json!({}));
    let mut d = Draws::new("planning-system", "self");
    let steps: Vec<Step<()>> = e.paperwork(&book, "acc-planning", &cx_for(&c, &mut d, 200));
    let s = steps.iter().map(|s| oikos_sight::calls::program_text(&s.program())).collect::<Vec<_>>().join("\n");
    assert!(s.contains("sign=agr.1") && s.contains("Service agr.1.") && s.contains("every=\"30 days\""), "{s}");
    assert!(e.paperwork::<()>(&book, "acc-planning", &cx_for(&c, &mut d, 300)).is_empty(), "signed once");
    let steps: Vec<Step<()>> = e.leave(&book, "agr.1", "acc-planning", "Doing it ourselves.", &cx_for(&c, &mut d, 400));
    let s = steps.iter().map(|s| oikos_sight::calls::program_text(&s.program())).collect::<Vec<_>>().join("\n");
    assert!(s.contains("notice=agr.1") && s.contains("Exit of service agr.1."), "{s}");
    assert!(e.leave::<()>(&book, "agr.1", "acc-planning", "again", &cx_for(&c, &mut d, 500)).is_empty(), "notice is given once");
}

#[test]
fn the_provider_saves_and_restores_and_the_world_must_name_its_account() {
    let mut h = harness(offer_json(json!({})));
    set_up(&mut h);
    h.save_and_restore();
    assert!(all(&h.wake(32 * DAY + H, world(vec![], json!([])))).contains("retire="), "the restored provider remembers its service");
    assert!(Provider.create(&ctx(PROVIDER, json!({ "offers": [] }))).is_err());
    assert!(crate::market::KINDS.iter().any(|k| k.name() == "firm.provider"));
}
