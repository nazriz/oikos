//! Delegation's rules, held by the Harness: the wrapper changes nothing a principal does until it hands a kind over; a
//! kind handed over goes as a referral and its act's outcome comes back to the principal's own code; each level's papers;
//! the principal engages, sets levels and reads only what it was shown; the assistant does what it is handed, slips as its
//! template's row says, and acts on nothing else.

use super::*;
use crate::market::testkit::{channels, money, records, statement, Harness};
use crate::papers::delegation::Level;
use crate::DAY;
use crate::Kind;
use serde_json::json;

const ME: &str = "ll";
const PROV: &str = "prov-a";
const NOTICE: &str = "statement(kind=notice_to_vacate, text=\"Please leave.\", to=[\"t1\"], basis=lease-1)";

fn offer() -> Value {
    json!({ "id": "assist", "title": "Letting assistant", "for": "organisations", "template": "assistant-a", "kinds": ["notice_to_vacate"],
        "levels": ["advice", "draft", "approve", "alone"], "seconds": { "notice_to_vacate": 60 }, "claim_slip_bps": 100, "fee_month": 10_000,
        "setup": 50_000, "exit": 20_000, "notice_days": 30, "term_days": 365, "records": "provider", "provider": PROV, "account": "acc-prov-a" })
}

/// A principal whose own code is a script of notices, one a day from day 1 to day `n`, wrapped for delegation.
fn principal(n: i64, fee: i64) -> Harness {
    principal_doing(n, fee, NOTICE)
}

fn principal_doing(n: i64, fee: i64, call: &str) -> Harness {
    let script: Vec<Value> = (1..=n).map(|d| json!({ "at": d * DAY + 3600, "call": call })).collect();
    let mut h = Harness::new(&crate::stub::Script, ME, json!({ "script": script,
        "delegation": { "post": "ll-assistant", "account": "acc-ll", "kinds": { "notice_to_vacate": { "own_seconds": 1800, "error_cost": 1000 } }, "hour_value": 4000, "review_days": 30 } }));
    let inner = crate::stub::Script.create(&h.ctx).unwrap();
    h.actor = wrap(&h.ctx, inner).unwrap();
    let _ = fee;
    h
}

fn world(recs: Vec<Value>) -> Value {
    channels(vec![money(ME, 1_000_000, json!([])), records("mine", recs)])
}

fn all(p: &[String]) -> String {
    p.join("\n")
}

fn offer_rec(fee: i64) -> Value {
    let mut o = offer();
    o["fee_month"] = json!(fee);
    statement("rec.off", 0, PROV, "service_offer", &[], o)
}

/// The world's records of a service set up for an order: the delivery, the agreement, both signatures.
fn set_up(order: &str) -> Vec<Value> {
    vec![
        statement("rec.del", 32 * DAY, PROV, "service_delivery", &[ME], json!({ "order": order, "offer": offer(), "systems": ["par.sys"] })),
        json!({ "id": "agr.1", "record": "agreement", "author": "prov-a-system", "at": 32 * DAY, "visible_to": [PROV, ME], "basis": order,
            "terms": { "template": "service", "parties": [PROV, ME], "commitments": [], "attrs": { "records": "provider" } } }),
        json!({ "id": "agr.1-a", "record": "signature", "author": "prov-a-system", "at": 32 * DAY, "visible_to": [PROV, ME], "agreement": "agr.1", "as": PROV }),
    ]
}

fn signed() -> Value {
    json!({ "id": "agr.1-b", "record": "signature", "author": "ll-system", "at": 33 * DAY, "visible_to": [PROV, ME], "agreement": "agr.1", "as": ME })
}

/// Through engaging to a service in use whose remit for notices is the one the rule chose; the remit's record (as the
/// world files the principal's own paper) and every program sent along the way.
fn engaged() -> (Harness, String, Value) {
    engaged_doing(NOTICE)
}

fn engaged_doing(call: &str) -> (Harness, String, Value) {
    let mut h = principal_doing(40, 10_000, call);
    let mut out = vec![];
    for d in 1..=29 {
        out.extend(h.wake(d * DAY + 3600, world(if d == 1 { vec![offer_rec(10_000)] } else { vec![] })));
    }
    assert!(!all(&out).contains("kind=order"), "nothing is engaged before its review day");
    let at30 = all(&h.wake(30 * DAY + 3600, world(vec![])));
    assert!(at30.contains("kind=order") && at30.contains("service:assist"), "on its review day the offer it sees pays: it orders: {at30}");
    // (The order's id, as the harness named what the act made: the order line is bound `order`.)
    let order = format!("rec.{}", 1000 + h.sent.iter().position(|p| p.contains("kind=order")).unwrap() as i64 + 1);
    let papers = all(&h.wake(32 * DAY + 3600, world(set_up(&order))));
    assert!(papers.contains("sign=agr.1") && papers.contains("Service agr.1."), "it signs and sets the fee up: {papers}");
    let briefed = all(&h.wake(33 * DAY + 3600, world(vec![signed()])));
    assert!(briefed.contains("appoint=ll-assistant") && briefed.contains("to=par.sys") && briefed.contains("kind=brief"), "the system is put to work: {briefed}");
    let remit_prog = h.sent.iter().rev().find(|p| p.contains("kind=remit")).cloned().unwrap_or_default();
    assert!(remit_prog.contains("\"level\":\"alone\""), "cheap errors and a cheap service: alone, straight from doing it itself: {remit_prog}");
    let remit = json!({ "id": "rec.remit", "record": "statement", "author": "ll-system", "speaks_for": ME, "at": 33 * DAY, "visible_to": [ME, PROV],
        "kind": "remit", "text": "From now", "addressed_to": [PROV], "basis": "agr.1", "data": { "agreement": "agr.1", "kind": "notice_to_vacate", "level": "alone" } });
    (h, order, remit)
}

#[test]
fn the_wrapper_sends_what_its_principal_sends_until_a_kind_is_handed_over() {
    let mut plain = Harness::new(&crate::stub::Script, ME, json!({ "script": [{ "at": DAY + 3600, "call": NOTICE }] }));
    let mut wrapped = principal(1, 10_000);
    let a = plain.wake(DAY + 3600, world(vec![offer_rec(10_000)]));
    let b = wrapped.wake(DAY + 3600, world(vec![offer_rec(10_000)]));
    assert_eq!(a, b, "the same acts, to the letter");
}

/// The referral the last wake sent, as the harness named what it made.
fn last_referral(h: &Harness) -> String {
    let i = h.sent.iter().rposition(|p| p.contains("kind=referral")).expect("a referral was sent");
    format!("rec.{}", 1001 + i as i64)
}

#[test]
fn a_kind_handed_over_goes_as_a_referral_and_comes_back_to_the_principal_when_not_done() {
    let (mut h, _, remit) = engaged();
    let out = all(&h.wake(34 * DAY + 3600, world(vec![remit])));
    assert!(out.contains("kind=referral") && out.contains("\"wants\":\"alone\""), "the notice goes to the assistant: {out}");
    assert!(!out.lines().any(|l| l.starts_with("statement(basis=lease-1")), "and not out under the principal's hand: {out}");
    let referral = last_referral(&h);
    let report = statement("rec.rep", 34 * DAY + 7200, ME, "report", &[ME], json!({ "referral": referral, "done": false, "why": "refused" }));
    let back = all(&h.wake(35 * DAY + 3600, world(vec![report])));
    assert!(back.lines().any(|l| l.starts_with("statement(basis=lease-1")), "reported not done: the principal does it itself: {back}");
}

#[test]
fn what_is_not_handed_over_is_done_by_the_principal_in_the_same_act_as_the_referral() {
    // (Its notices come with a fee paid in the same act: the payment stays its own.)
    let pay = "money(to=acc-tribunal, amount=\"$10.00\", from=acc-ll, for=\"fee\")";
    let (mut h, _, remit) = engaged_doing(&format!("{NOTICE}\n{pay}"));
    let out = all(&h.wake(34 * DAY + 3600, world(vec![remit])));
    let act = out.lines().skip_while(|l| !l.starts_with("money(")).take(2).collect::<Vec<_>>().join("\n");
    assert!(act.starts_with("money(") && act.contains("kind=referral"), "one act: its payment and the referral: {out}");
    let sent = h.sent.iter().rev().find(|p| p.contains("kind=referral")).unwrap();
    let calls = sent.split("\"calls\":\"").nth(1).and_then(|x| x.split("\",\"kind\"").next()).unwrap_or_default();
    assert!(calls.contains("notice_to_vacate") && !calls.contains("acc-tribunal"), "the notice is handed over, the payment is not: {calls}");
}

#[test]
fn a_draft_not_as_asked_is_declined_and_done_by_the_principal_and_one_as_asked_is_signed_off() {
    let (mut h, _, mut remit) = engaged();
    remit["data"]["level"] = json!("draft");
    h.wake(34 * DAY + 3600, world(vec![remit.clone()]));
    let referral = last_referral(&h);
    let wrong = statement("rec.d1", 34 * DAY + 7200, ME, "draft", &[ME], json!({ "referral": referral }));
    let out = all(&h.wake(35 * DAY + 3600, world(vec![wrong])));
    assert!(out.contains("kind=declined") && out.lines().any(|l| l.starts_with("statement(basis=lease-1")), "found wrong: declined, and done by the principal: {out}");
    h.wake(36 * DAY + 3600, world(vec![]));
    let referral = last_referral(&h);
    let right = statement("rec.d2", 36 * DAY + 7200, ME, "draft", &[ME], json!({ "referral": referral, "calls": NOTICE }));
    let out = all(&h.wake(37 * DAY + 3600, world(vec![right])));
    assert!(out.contains("kind=sign_off") && !out.lines().any(|l| l.starts_with("statement(basis=lease-1")), "as asked: signed off, the assistant sends it: {out}");
}

#[test]
fn a_draft_on_a_form_is_read_by_the_paper_it_would_send() {
    let (mut h, _, mut remit) = engaged();
    remit["data"]["level"] = json!("draft");
    h.wake(34 * DAY + 3600, world(vec![remit]));
    let referral = last_referral(&h);
    let other = statement("rec.d1", 34 * DAY + 7200, ME, "draft", &[ME], json!({ "referral": referral, "paper": { "kind": "notice_to_vacate", "text": "Leave.", "to": ["t9"] } }));
    let out = all(&h.wake(35 * DAY + 3600, world(vec![other])));
    assert!(out.contains("kind=declined"), "to someone else: not what was asked: {out}");
    h.wake(36 * DAY + 3600, world(vec![]));
    let referral = last_referral(&h);
    let same = statement("rec.d2", 36 * DAY + 7200, ME, "draft", &[ME], json!({ "referral": referral, "paper": { "kind": "notice_to_vacate", "text": "Please go.", "to": ["t1"] } }));
    let out = all(&h.wake(37 * DAY + 3600, world(vec![same])));
    assert!(out.contains("kind=sign_off"), "the same paper to the same tenant, in its own words: signed off: {out}");
}

#[test]
fn a_matter_handed_back_without_its_notes_is_done_by_the_principal() {
    let (mut h, _, mut remit) = engaged();
    remit["data"]["level"] = json!("draft");
    h.wake(34 * DAY + 3600, world(vec![remit]));
    let referral = last_referral(&h);
    let back = statement("rec.ho", 35 * DAY, ME, "handover", &[ME], json!({ "agreement": "agr.1", "open": [referral] }));
    let out = all(&h.wake(35 * DAY + 3600, world(vec![back])));
    assert!(out.lines().any(|l| l.starts_with("statement(basis=lease-1")), "{out}");
}

#[test]
fn every_input_of_a_decision_is_a_record_the_principal_was_shown() {
    let (h, order, _) = engaged();
    // (What the harness showed it, and the records its own acts made.)
    let shown: Vec<String> = ["rec.off", "rec.del", "agr.1", "agr.1-a", "agr.1-b", order.as_str()].iter().map(|s| s.to_string()).collect();
    let ds: Vec<&Value> = h.decisions.iter().filter(|d| d["domain"] == "delegation").collect();
    assert!(ds.iter().any(|d| d["choice"] == "engage") && ds.iter().any(|d| d["choice"] == "remit"), "{ds:?}");
    for d in ds {
        for i in d["inputs"].as_array().expect("inputs") {
            assert!(shown.iter().any(|s| s == i.as_str().unwrap_or("")), "{i} is not among what it was shown: {d}");
        }
    }
}

#[test]
fn a_hidden_slip_leaves_the_estimate_where_the_claim_put_it_and_a_seen_one_moves_it() {
    // (Not a bug: a principal that is never told of its assistant's slips goes on believing its provider.)
    let mut seen = rule::Seen::default();
    for i in 0..10 {
        seen.saw(false, &format!("rep{i}"));
    }
    let hidden = rule::estimate(100, 20, &seen);
    seen.turned_bad("complaint");
    assert!(hidden < 100 && rule::estimate(100, 20, &seen) > hidden);
}

#[test]
fn a_service_too_dear_for_what_it_saves_is_not_taken() {
    let mut h = principal(40, 10_000);
    for d in 1..=29 {
        h.wake(d * DAY + 3600, world(if d == 1 { vec![offer_rec(5_000_000)] } else { vec![] }));
    }
    assert!(!all(&h.wake(30 * DAY + 3600, world(vec![]))).contains("kind=order"));
}

#[test]
fn levels_are_read_from_the_newest_remit_and_lines_name_their_kinds() {
    let p = parse_program(&format!("{NOTICE}\nstatement(withdraw=rec.4)")).unwrap();
    assert_eq!(kinds_of(&p), vec!["notice_to_vacate".to_string()]);
    assert_eq!(subjects_of(&p), vec!["lease-1".to_string(), "t1".to_string()]);
    assert_eq!(Level::from_word("alone"), Some(Level::Alone));
}

use oikos_sight::calls::parse_program;

mod assistant_side;
