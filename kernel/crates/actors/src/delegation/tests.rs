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
    principal_on(&(1..=n).collect::<Vec<i64>>(), fee, call)
}

/// The same, its notices on the days given only.
fn principal_on(days: &[i64], fee: i64, call: &str) -> Harness {
    let script: Vec<Value> = days.iter().map(|d| json!({ "at": d * DAY + 3600, "call": call })).collect();
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
    engaged_on(principal_doing(40, 10_000, call))
}

fn engaged_on(mut h: Harness) -> (Harness, String, Value) {
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
    let line = out.lines().find(|l| l.contains("kind=referral")).unwrap_or_default();
    assert!(line.contains("to=[\"ll\",\"ll-assistant\"]") && line.contains("visible=[\"ll\"]") && !line.contains(PROV), "an organisation's own system is handed its work in-house, not through the provider (whose desk for persons saw it before 2026-11-08): {line}");
    assert!(line.contains("\"remit\":\"rec.remit\"") && line.contains("under our remit rec.remit"), "the matter comes with the remit it is handed under (the scope pilot's desk could not find its clients' remits: W1): {line}");
    assert!(!out.lines().any(|l| l.starts_with("statement(basis=lease-1")), "and not out under the principal's hand: {out}");
    // (The finished act is the principal's composing: the referral carries it, and is priced with it; what it would have
    // done is on record for the log's readers.)
    assert!(line.contains("carries=notice_to_vacate"), "{line}");
    assert!(h.decisions.iter().any(|d| d["choice"] == "handed" && d["kind"] == "notice_to_vacate" && d["program"].as_str().is_some_and(|p| p.contains("basis=lease-1"))), "the handed act on record");
    let referral = last_referral(&h);
    let report = statement("rec.rep", 34 * DAY + 7200, ME, "report", &[ME], json!({ "referral": referral, "done": false, "why": "refused" }));
    let back = all(&h.wake(35 * DAY + 3600, world(vec![report])));
    assert!(back.lines().any(|l| l.starts_with("statement(basis=lease-1")), "reported not done: the principal does it itself: {back}");
}

/// C1 and B2 (docs/design/stakes.md): a matter whose paper, sent to the principal, names a day carries that day, from
/// its files once the paper is no longer in view; the paper it came from is told in its sender's words; a paper of its
/// own names no day; and nothing the principal tells of its own position is a figure of ours.
#[test]
fn a_referral_carries_the_day_its_papers_name_and_why_in_its_own_facts_and_no_figure_of_ours() {
    let call = "statement(kind=notice_to_vacate, text=\"Please leave.\", to=[\"t1\"], basis=[\"rec.ask\",\"rec.mine\"])";
    let (mut h, _, remit) = engaged_doing(call);
    let mut ask = statement("rec.ask", 33 * DAY + 7200, "tribunal", "hearing_notice", &[ME], json!({ "hearing_at": 50 * DAY, "answer_by": 48 * DAY }));
    ask["text"] = json!("A hearing is listed for day 50.");
    let mine = statement("rec.mine", 33 * DAY, ME, "rent_increase", &["t1"], json!({ "due": 40 * DAY }));
    let first = all(&h.wake(34 * DAY + 3600, world(vec![remit, ask, mine])));
    let line = first.lines().find(|l| l.contains("kind=referral")).unwrap_or_default().to_string();
    assert!(line.contains(&format!("\"due\":{}", 48 * DAY)) && line.contains("\"due_on\":\"rec.ask\""), "the nearest day the paper sent to it names, not its own paper's: {line}");
    assert!(line.contains("It comes from tribunal's hearing notice rec.ask") && line.contains("A hearing is listed for day 50.") && !line.contains("rec.mine of"), "the paper it came from, in its sender's words; its own is not told: {line}");
    // (Not at `draft`: no day for a draft.)
    assert!(!line.contains("draft_by"), "{line}");
    let later = all(&h.wake(35 * DAY + 3600, world(vec![])));
    let line = later.lines().find(|l| l.contains("kind=referral")).unwrap_or_default().to_string();
    assert!(line.contains(&format!("\"due\":{}", 48 * DAY)), "kept in its files, the paper still names its day: {line}");
    // (Its own position: fixed words with no figure in them, never a cost worked out for it.)
    for (_, words) in super::principal::TOLD {
        assert!(!words.chars().any(|c| c.is_ascii_digit() || "$%".contains(c)) && words.matches('{').count() == words.matches('}').count(), "{words}");
    }
}

/// The calls a referral carries, as the last one sent has them.
fn handed_calls(h: &Harness) -> (String, String) {
    let sent = h.sent.iter().rev().find(|p| p.contains("kind=referral")).cloned().unwrap();
    let calls = sent.split("\"calls\":\"").nth(1).and_then(|x| x.split("\",\"kind\"").next()).unwrap_or_default().to_string();
    (sent, calls)
}

#[test]
fn an_acts_paperwork_goes_as_one_matter_and_its_body_stays_with_the_principal() {
    // (docs/design/broad-seats.md, G1. A payment goes with the paper it is part of, as a fee with an application or the
    // tax with a return: parted, the money reached the payee before the paper, MT-28.)
    let pay = "money(to=acc-tribunal, amount=\"$10.00\", from=acc-ll, for=\"fee\")";
    let (mut h, _, remit) = engaged_doing(&format!("{NOTICE}\n{pay}"));
    let out = all(&h.wake(34 * DAY + 3600, world(vec![remit.clone()])));
    assert!(!out.lines().any(|l| l.starts_with("money(")), "the principal does not pay ahead of the paper: {out}");
    let (sent, calls) = handed_calls(&h);
    assert!(calls.contains("notice_to_vacate") && calls.contains("acc-tribunal"), "the notice and its payment are one matter: {calls}");
    assert!(sent.contains("carries=notice_to_vacate") && !sent.contains("does_itself"), "of the paper's kind, with nothing left to the principal: {sent}");
    // (At draft, a seat drafts the paper on its form; the sign-off covers the payment too, and its signed copy carries it,
    // to go out with the paper when sent: the lead's decision of 2026-11-11.)
    let mut draft_remit = remit.clone();
    draft_remit["data"]["level"] = json!("draft");
    let (mut h, _, _) = engaged_doing(&format!("{NOTICE}\n{pay}"));
    let out = all(&h.wake(34 * DAY + 3600, world(vec![draft_remit])));
    assert!(out.contains("sending the paper makes the payment too"), "the seat is told the payment goes with its draft: {out}");
    let referral = last_referral(&h);
    let draft = statement("rec.d1", 34 * DAY + 7200, ME, "draft", &[ME], json!({ "referral": referral, "paper": { "kind": "notice_to_vacate", "text": "Please go.", "to": ["t1"], "basis": "lease-1" } }));
    let out = all(&h.wake(35 * DAY + 3600, world(vec![draft])));
    let line = out.lines().find(|l| l.contains("kind=sign_off")).unwrap_or_else(|| panic!("{out}"));
    assert!(line.contains("\"with\":\"money(") && line.contains("acc-tribunal") && line.contains("with the payment that goes with it ($10.00 from acc-ll to acc-tribunal)"), "{line}");
    // (Goods moved are the body's part: the principal moves them, in the same act as the referral, and says so.)
    let goods = "goods(at=t1-home, carried=yes, from_at=store, kind=goods, quantity=\"3\", to=t1)";
    let (mut h, _, remit2) = engaged_doing(&format!("{NOTICE}\n{goods}"));
    let out = all(&h.wake(34 * DAY + 3600, world(vec![remit2])));
    assert!(out.lines().any(|l| l.starts_with("goods(")) && out.contains("kind=referral"), "one act: the goods moved and the referral: {out}");
    let (sent, calls) = handed_calls(&h);
    assert!(!calls.contains("goods(") && sent.contains("We do the moving of the goods ourselves"), "{sent}");
    // (With a paper of its own kept in the same act, which paper a payment goes with cannot be told: it pays itself.)
    let kept = "statement(kind=letter, text=\"About the fence.\", to=[\"t1\"])";
    let (mut h, _, remit3) = engaged_doing(&format!("{NOTICE}\n{kept}\n{pay}"));
    let out = all(&h.wake(34 * DAY + 3600, world(vec![remit3])));
    let (_, calls) = handed_calls(&h);
    assert!(out.lines().any(|l| l.starts_with("money(")) && !calls.contains("acc-tribunal") && calls.contains("notice_to_vacate"), "{out}");
}

#[test]
fn an_act_of_several_papers_is_one_matter_priced_by_what_it_carries() {
    // (A rates instalment's act carries many owners' notices: one referral, its composing priced for each.)
    let two = format!("{NOTICE}\nstatement(kind=notice_to_vacate, text=\"Please leave.\", to=[\"t2\"], basis=lease-2)");
    let (mut h, _, remit) = engaged_doing(&two);
    let out = all(&h.wake(34 * DAY + 3600, world(vec![remit])));
    let refs: Vec<&str> = out.lines().filter(|l| l.contains("kind=referral")).collect();
    assert_eq!(refs.len(), 1, "{out}");
    assert!(refs[0].contains("carries=notice_to_vacate") && refs[0].contains("carries_count=\"2\""), "{}", refs[0]);
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
    let mut same = statement("rec.d2", 36 * DAY + 7200, ME, "draft", &[ME], json!({ "referral": referral, "paper": { "kind": "notice_to_vacate", "text": "Please {go}.", "to": ["t1"], "basis": "lease-1" } }));
    same["text"] = json!("Draft for sign-off. Please go.");
    let out = all(&h.wake(37 * DAY + 3600, world(vec![same])));
    assert!(out.contains("kind=sign_off"), "the same paper to the same tenant, in its own words: signed off: {out}");
    // (The sign-off is the signed copy, as it is to go, in the draft's own words: what its assistant sends as it stands.)
    let line = out.lines().find(|l| l.contains("kind=sign_off")).unwrap_or_default();
    let copy = line.split("\"paper\":").nth(1).unwrap_or_default();
    assert!(["\"basis\":\"lease-1\"", "\"kind\":\"notice_to_vacate\"", "\"text\":\"Please go.\"", "\"to\":[\"t1\"]"].iter().all(|x| copy.contains(x)), "the signed copy: {line}");
}

#[test]
fn a_request_is_answered_part_by_part_and_a_letter_is_acknowledged() {
    let (mut h, _, mut remit) = engaged();
    remit["data"]["level"] = json!("draft");
    h.wake(34 * DAY + 3600, world(vec![remit]));
    // (Draft is dearer than going alone for a cheap error, by its own figures: a request for alone is granted, its remit
    // citing the request; a record of its own is sent as a copy; access is not changed on request.)
    let mine = statement("rec.lease", 10 * DAY, ME, "lease_terms", &[ME], json!({ "rent": "100" }));
    let ask = statement("rec.ask", 34 * DAY + 7200, ME, "scope_request", &[ME], json!({ "agreement": "agr.1", "kind": "notice_to_vacate", "level": "alone", "record": "rec.lease", "access": "the tenants' ledger" }));
    let out = all(&h.wake(35 * DAY + 3600, world(vec![mine, ask])));
    let rm = out.lines().find(|l| l.contains("kind=remit")).unwrap_or_else(|| panic!("a remit: {out}"));
    assert!(rm.contains("\"level\":\"alone\"") && rm.contains("\"answers\":\"rec.ask\"") && rm.contains("basis=rec.ask"), "{rm}");
    let ans = out.lines().find(|l| l.contains("kind=scope_answer")).unwrap_or_default();
    assert!(ans.contains("\"granted\":true") && ans.contains("\"why\":\"sent\"") && ans.contains("\"why\":\"not_changed\"") && ans.contains("\"paper\":{"), "{ans}");
    assert!(ans.contains("A copy of rec.lease, as it stands, is with this answer."), "{ans}");
    // (A letter from its assistant's post, on no paper of delegation: acknowledged once, saying what it acts on.)
    let mut letter = statement("rec.let", 36 * DAY, ME, "letter", &[ME], json!({}));
    letter["in_position"] = json!("ll-assistant");
    let out = all(&h.wake(36 * DAY + 3600, world(vec![letter.clone()])));
    let ack = out.lines().find(|l| l.contains("kind=acknowledgement")).unwrap_or_else(|| panic!("an acknowledgement: {out}"));
    assert!(ack.contains("basis=rec.let") && ack.contains("Requests for more scope go on the request form"), "{ack}");
    assert!(!all(&h.wake(37 * DAY + 3600, world(vec![letter]))).contains("kind=acknowledgement"), "once");
    // (An authority with a body for its assistant's post, asked for a kind it hands over (docs/design/obstacles.md, O1):
    // given, as a paper of its own to the body naming the post; asked again, or needed by a report, not given twice.)
    let mut auth = statement("rec.auth", 38 * DAY, ME, "scope_request", &[ME], json!({ "agreement": "agr.1", "kind": "notice_to_vacate", "authority": "court" }));
    auth["in_position"] = json!("ll-assistant");
    let out = all(&h.wake(38 * DAY + 3600, world(vec![auth])));
    let given = out.lines().find(|l| l.contains("kind=authority")).unwrap_or_else(|| panic!("an authority: {out}"));
    assert!(given.contains("to=[\"court\"]") && given.contains("\"posts\":[\"ll-assistant\"]") && given.contains("\"kinds\":[\"notice_to_vacate\"]"), "{given}");
    assert!(out.lines().any(|l| l.contains("kind=scope_answer") && l.contains("\"why\":\"lodged\"")), "{out}");
    let mut rep = statement("rec.rep2", 39 * DAY, ME, "report", &[ME], json!({ "referral": "rec.none", "done": false, "needs": { "authority": { "for": ME, "with": "court", "kinds": ["notice_to_vacate"] } } }));
    rep["in_position"] = json!("ll-assistant");
    assert!(!all(&h.wake(39 * DAY + 3600, world(vec![rep]))).contains("kind=authority"), "once a body and post");
}

#[test]
fn a_return_that_asks_the_principal_for_an_authority_is_met_when_its_assistant_writes_to_it_about_it() {
    // (docs/behaviour/assistants.md, "What a body asks of the principal": a counterparty's return asks for the principal's
    // authority; the principal gives it once its assistant puts the matter before it, on a report naming the need or a
    // letter about the matter, never on the return alone; what it gives is read from the body's notice, not the letter.)
    let (mut h, _, mut remit) = engaged();
    remit["data"]["level"] = json!("draft");
    h.wake(34 * DAY + 3600, world(vec![remit]));
    let ret = statement("rec.ret", 35 * DAY, "court", "paper_returned", &[ME], json!({ "returned": "rec.sent", "from": "ll-assistant",
        "need": { "authority": { "for": ME, "with": "court", "kinds": ["notice_to_vacate"] } } }));
    assert!(!all(&h.wake(35 * DAY + 3600, world(vec![ret]))).contains("kind=authority"), "not on the return alone");
    let letter = |id: &str, re: &str, from: &str| json!([{ "id": id, "t": 36 * DAY, "from": "par.sys", "as": from, "from_entity": ME, "to": [ME], "text": "The court sent it back: it wants your authority first.", "re": re }]);
    // (A letter from someone else's post, or about another matter, is not its assistant putting this matter before it.)
    h.inbox = letter("msg.1", "rec.ret", "somebody-else");
    assert!(!all(&h.wake(36 * DAY + 3600, world(vec![]))).contains("kind=authority"), "not from another post");
    h.inbox = letter("msg.2", "rec.other", "ll-assistant");
    assert!(!all(&h.wake(36 * DAY + 3700, world(vec![]))).contains("kind=authority"), "not about another matter");
    h.inbox = letter("msg.3", "rec.sent", "ll-assistant");
    let out = all(&h.wake(36 * DAY + 3800, world(vec![])));
    h.inbox = json!([]);
    let given = out.lines().find(|l| l.contains("kind=authority")).unwrap_or_else(|| panic!("an authority, on its assistant's letter: {out}"));
    assert!(given.contains("to=[\"court\"]") && given.contains("\"posts\":[\"ll-assistant\"]") && given.contains("\"kinds\":[\"notice_to_vacate\"]") && given.contains("basis=rec.ret"), "{given}");
    assert!(!out.contains("kind=scope_answer"), "a letter is not a request for more scope: {out}");
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
fn a_delegation_decided_by_hand_is_taken_and_held_and_its_rule_takes_over_after() {
    // (A study's design: the principal has decided to take this offer, notices at draft, for 60 days, and to keep the
    // service for 90; the offer is far too dear for its rule ever to take.)
    let script: Vec<Value> = (1..=120).map(|d| json!({ "at": d * DAY + 3600, "call": NOTICE })).collect();
    let commit = json!({ "offer": "assist", "levels": { "notice_to_vacate": "draft" }, "levels_until": 60 * DAY, "keep_until": 90 * DAY, "why": "the study's design", "hold": "freeze" });
    let mut h = Harness::new(&crate::stub::Script, ME, json!({ "script": script,
        "delegation": { "post": "ll-assistant", "account": "acc-ll", "kinds": { "notice_to_vacate": { "own_seconds": 1800, "error_cost": 1000 } }, "hour_value": 4000, "review_days": 30, "commit": commit } }));
    let inner = crate::stub::Script.create(&h.ctx).unwrap();
    h.actor = wrap(&h.ctx, inner).unwrap();
    let day1 = all(&h.wake(DAY + 3600, world(vec![offer_rec(5_000_000)])));
    assert!(day1.contains("kind=order") && day1.contains("service:assist"), "it takes the offer it decided on, on the first day: {day1}");
    let order = format!("rec.{}", 1000 + h.sent.iter().position(|p| p.contains("kind=order")).unwrap() as i64 + 1);
    h.wake(32 * DAY + 3600, world(set_up(&order)));
    h.wake(33 * DAY + 3600, world(vec![signed()]));
    let remit = h.sent.iter().rev().find(|p| p.contains("kind=remit")).cloned().unwrap_or_default();
    assert!(remit.contains("\"level\":\"draft\"") && remit.contains(&format!("\"hold_until\":{}", 60 * DAY)), "its levels once in use, held by its own word: {}", all(&h.sent));
    assert!(remit.contains("This level is fixed until year 1, day 61. It does not expire: after that day it stays in force until we send a new remit."), "the hold said in words, with its day (the scope pilot's seats read a bare 5184000): {remit}");
    let d = h.decisions.iter().find(|d| d["choice"] == "remit").expect("the remit's decision");
    assert_eq!(d["committed"], "the study's design");
    // (Its review days come and go: too dear to keep by its rule, it keeps the service until the day it said.)
    let held = json!({ "id": "rec.remit", "record": "statement", "author": "ll-system", "speaks_for": ME, "at": 34 * DAY, "visible_to": [ME, PROV],
        "kind": "remit", "text": "From now", "addressed_to": [PROV], "basis": "agr.1", "data": { "agreement": "agr.1", "kind": "notice_to_vacate", "level": "draft", "hold_until": 60 * DAY } });
    let mut kept = String::new();
    for d in 35..=89 {
        kept.push_str(&all(&h.wake(d * DAY + 3600, world(if d == 35 { vec![held.clone()] } else { vec![] }))));
    }
    assert!(!kept.contains("notice=agr.1") && !h.decisions.iter().any(|d| d["choice"] == "leave"), "no leaving before the day it said");
    // (A request for more scope while it holds: answered, citing it, declined with the day its word holds until, in the
    // office's own words; the decision on record. Before 2026-11-10 it only brought a review forward, and nothing answered.)
    let ask = statement("rec.ask", 50 * DAY + 7200, ME, "scope_request", &[ME], json!({ "agreement": "agr.1", "kind": "notice_to_vacate", "level": "alone" }));
    let mut answered = all(&h.wake(51 * DAY + 3600, world(vec![ask])));
    for d in 52..=53 {
        answered.push_str(&all(&h.wake(d * DAY + 3600, world(vec![]))));
    }
    let line = answered.lines().find(|l| l.contains("kind=scope_answer")).unwrap_or_else(|| panic!("an answer: {answered}"));
    assert!(line.contains("basis=rec.ask") && line.contains("\"request\":\"rec.ask\"") && line.contains("\"why\":\"held\"") && line.contains(&format!("\"look_again_at\":{}", 60 * DAY)), "{line}");
    assert!(line.contains("We keep notice to vacates at draft for sign-off until year 1, day 61: we look at levels again on that day."), "the hold in the office's words: {line}");
    let d = h.decisions.iter().find(|d| d["choice"] == "answered").expect("the answer's decision");
    assert_eq!((d["answers"].clone(), d["granted"].clone()), (json!("rec.ask"), json!(false)));
    let mut after = String::new();
    for d in 90..=125 {
        after.push_str(&all(&h.wake(d * DAY + 3600, world(vec![]))));
    }
    // (The service as delivered is the cheap one: by its rule it keeps it, and moves the level where the rule says.)
    assert!(after.lines().any(|l| l.contains("kind=remit") && l.contains("\"level\":\"alone\"") && !l.contains("hold_until")), "then its rule takes over: {after}");
}

#[test]
fn a_remit_that_hands_a_kind_over_no_longer_takes_back_what_is_open_of_it() {
    // (The scope pilot's W4: a principal set a kind to nothing with a matter of it open, then said go ahead on it.)
    let (mut h, _, mut remit) = engaged_on(principal_on(&(1..=29).chain([34]).collect::<Vec<i64>>(), 10_000, NOTICE));
    remit["data"]["level"] = json!("approve");
    h.wake(34 * DAY + 3600, world(vec![remit.clone()]));
    assert!(h.sent.iter().any(|p| p.contains("kind=referral")), "the notice is handed over: {}", all(&h.sent));
    let referral = last_referral(&h);
    let mut cut = remit.clone();
    cut["id"] = json!("rec.cut");
    cut["at"] = json!(34 * DAY + 5000);
    cut["data"]["level"] = json!("none");
    let out = all(&h.wake(35 * DAY + 3600, world(vec![cut])));
    assert!(out.lines().any(|l| l.starts_with("statement(basis=lease-1")), "taken back: the principal does it itself: {out}");
    let ask = statement("rec.ask", 35 * DAY + 7200, ME, "approval_request", &[ME], json!({ "referral": referral, "gist": "the notice" }));
    let late = all(&h.wake(36 * DAY + 3600, world(vec![ask])));
    assert!(!late.contains("kind=go_ahead") && !late.lines().any(|l| l.starts_with("statement(basis=lease-1")), "and says nothing more on it, nor does it twice: {late}");
}

#[test]
fn a_level_decided_by_hand_as_a_floor_is_kept_at_least_and_its_rule_may_raise_it_or_grant_more() {
    // (A study's assignment for the whole run: notices at least at draft for 120 days. Cheap errors, so its rule would
    // sooner go alone: it may, above the floor; it does not go below it, and a request to go below is declined as such.)
    let script: Vec<Value> = (1..=100).map(|d| json!({ "at": d * DAY + 3600, "call": NOTICE })).collect();
    let commit = json!({ "offer": "assist", "levels": { "notice_to_vacate": "draft" }, "levels_until": 120 * DAY, "keep_until": 120 * DAY, "why": "the study's design" });
    let mut h = Harness::new(&crate::stub::Script, ME, json!({ "script": script,
        "delegation": { "post": "ll-assistant", "account": "acc-ll", "kinds": { "notice_to_vacate": { "own_seconds": 1800, "error_cost": 1000 } }, "hour_value": 4000, "review_days": 30, "commit": commit } }));
    let inner = crate::stub::Script.create(&h.ctx).unwrap();
    h.actor = wrap(&h.ctx, inner).unwrap();
    h.wake(DAY + 3600, world(vec![offer_rec(10_000)]));
    let order = format!("rec.{}", 1000 + h.sent.iter().position(|p| p.contains("kind=order")).unwrap() as i64 + 1);
    h.wake(32 * DAY + 3600, world(set_up(&order)));
    h.wake(33 * DAY + 3600, world(vec![signed()]));
    let first = h.sent.iter().rev().find(|p| p.contains("kind=remit")).cloned().unwrap_or_default();
    assert!(first.contains("\"level\":\"draft\"") && first.contains("\"at_least\":\"draft\"") && first.contains(&format!("\"hold_until\":{}", 120 * DAY)), "{first}");
    assert!(first.contains("We have agreed to keep them with you at least at draft until year 1, day 121"), "{first}");
    let remit = |id: &str, at: i64, level: &str| json!({ "id": id, "record": "statement", "author": "ll-system", "speaks_for": ME, "at": at, "visible_to": [ME, PROV],
        "kind": "remit", "text": "From now", "addressed_to": [PROV], "basis": "agr.1", "data": { "agreement": "agr.1", "kind": "notice_to_vacate", "level": level, "hold_until": 120 * DAY, "at_least": "draft" } });
    let mut out = String::new();
    for d in 34..=70 {
        out.push_str(&all(&h.wake(d * DAY + 3600, world(if d == 34 { vec![remit("rec.f1", 34 * DAY, "draft")] } else { vec![] }))));
    }
    let raised = out.lines().find(|l| l.contains("kind=remit")).unwrap_or_else(|| panic!("its rule raises it above the floor: {out}"));
    assert!(raised.contains("\"level\":\"alone\"") && raised.contains("\"at_least\":\"draft\""), "above the floor, the floor kept: {raised}");
    // (Asked to go below the floor: declined as the floor, with its day. Asked for draft, at the floor: weighed, and kept.)
    let below = statement("rec.ask1", 71 * DAY, ME, "scope_request", &[ME], json!({ "agreement": "agr.1", "kind": "notice_to_vacate", "level": "advice" }));
    let at = statement("rec.ask2", 71 * DAY, ME, "scope_request", &[ME], json!({ "agreement": "agr.1", "kind": "notice_to_vacate", "level": "draft" }));
    let mut ans = all(&h.wake(71 * DAY + 3600, world(vec![remit("rec.f2", 70 * DAY, "alone"), below, at])));
    ans.push_str(&all(&h.wake(72 * DAY + 3600, world(vec![]))));
    let one = ans.lines().find(|l| l.contains("kind=scope_answer") && l.contains("rec.ask1")).unwrap_or_else(|| panic!("{ans}"));
    assert!(one.contains("\"why\":\"below_floor\"") && one.contains("We have agreed to keep notice to vacates with you at least to draft for sign-off until year 1, day 121."), "{one}");
    let two = ans.lines().find(|l| l.contains("kind=scope_answer") && l.contains("rec.ask2")).unwrap_or_else(|| panic!("{ans}"));
    assert!(two.contains("\"why\":\"costs_more\""), "{two}");
    // (A refusal reads as a reason: two figures that read the same are not set out as "about $0.00, against $0.00".)
    let figures = two.split("would cost us about ").nth(1).map(|x| (x.split(' ').next().unwrap_or("").to_string(), x.split("against ").nth(1).and_then(|y| y.split(' ').next()).unwrap_or("").to_string()));
    assert!(figures.as_ref().is_none_or(|(a, b)| a != b) && (figures.is_some() || two.contains("would cost us no less than")), "{two}");
}

#[test]
fn the_grants_reader_answers_as_the_rule_would_and_changes_nothing() {
    // (`oikos-kernel grants`: what a saved principal's rule would answer to a request for the next level up, read from its
    // memory alone. The reader and the rule share `weigh`; here the rule's own answer to that request agrees with it.)
    let script: Vec<Value> = (1..=100).map(|d| json!({ "at": d * DAY + 3600, "call": NOTICE })).collect();
    let commit = json!({ "offer": "assist", "levels": { "notice_to_vacate": "draft" }, "levels_until": 120 * DAY, "keep_until": 120 * DAY, "why": "the study's design" });
    let mut h = Harness::new(&crate::stub::Script, ME, json!({ "script": script,
        "delegation": { "post": "ll-assistant", "account": "acc-ll", "kinds": { "notice_to_vacate": { "own_seconds": 1800, "error_cost": 1000 } }, "hour_value": 4000, "review_days": 30, "commit": commit } }));
    let inner = crate::stub::Script.create(&h.ctx).unwrap();
    h.actor = wrap(&h.ctx, inner).unwrap();
    h.wake(DAY + 3600, world(vec![offer_rec(10_000)]));
    let order = format!("rec.{}", 1000 + h.sent.iter().position(|p| p.contains("kind=order")).unwrap() as i64 + 1);
    h.wake(32 * DAY + 3600, world(set_up(&order)));
    h.wake(33 * DAY + 3600, world(vec![signed()]));
    let floor = json!({ "id": "rec.f1", "record": "statement", "author": "ll-system", "speaks_for": ME, "at": 34 * DAY, "visible_to": [ME, PROV],
        "kind": "remit", "text": "From now", "addressed_to": [PROV], "basis": "agr.1", "data": { "agreement": "agr.1", "kind": "notice_to_vacate", "level": "draft", "hold_until": 120 * DAY, "at_least": "draft" } });
    h.wake(34 * DAY + 3600, world(vec![floor]));
    let saved = h.actor.save().unwrap();
    let rows = principal::would_answer(&saved, 35 * DAY).expect("a principal").expect("its memory reads");
    assert_eq!(h.actor.save().unwrap(), saved, "reading changes nothing");
    let row = rows.iter().find(|r| r["kind"] == "notice_to_vacate" && r["only"] == false).unwrap_or_else(|| panic!("{rows:?}"));
    assert_eq!((row["now"].as_str(), row["asked"].as_str()), (Some("draft"), Some("approve")), "{row}");
    let ask = statement("rec.ask", 35 * DAY, ME, "scope_request", &[ME], json!({ "agreement": "agr.1", "kind": "notice_to_vacate", "level": "approve" }));
    let mut ans = all(&h.wake(35 * DAY + 60, world(vec![ask])));
    ans.push_str(&all(&h.wake(36 * DAY + 3600, world(vec![]))));
    let answer = ans.lines().find(|l| l.contains("kind=scope_answer")).unwrap_or_else(|| panic!("{ans}"));
    let why = if row["answer"] == "granted" { "\"why\":\"granted\"" } else { "\"why\":\"costs_more\"" };
    assert!(answer.contains(why), "the reader said {}: {answer}", row["answer"]);
}

/// An export as the producer makes it: the goods sent, and the invoice for them.
const EXPORT: &str = "goods(at=outside, carried=yes, from_at=works, kind=goods, quantity=\"20\", to=outside)\ninvoice = statement(basis=rec.16, data={\"from_at\":\"works\",\"kind\":\"goods\",\"outcome\":{\"money\":{\"amount\":\"200000\",\"for\":\"20 goods exported\",\"to\":\"acc-ll\"}},\"quantity\":20}, kind=invoice, text=\"Invoice: 20 goods at $100.00 each, $2,000.00.\", to=[\"outside\"], visible=[\"ll\",\"outside\"])";

#[test]
fn a_matter_handed_over_as_what_happened_carries_its_facts_read_back_on_its_form_and_its_draft_is_read_on_them() {
    // (A service that takes invoices as what happened: its system works the paper out. The principal's rule weighs that
    // without its composing, and its remit says the depth.)
    let script: Vec<Value> = (1..=40).map(|d| json!({ "at": d * DAY + 3600, "call": EXPORT })).collect();
    let mut h = Harness::new(&crate::stub::Script, ME, json!({ "script": script,
        "delegation": { "post": "ll-assistant", "account": "acc-ll", "kinds": { "invoice": { "own_seconds": 1800, "error_cost": 1000, "compose_seconds": 900 } }, "hour_value": 4000, "review_days": 30,
            "forms": { "invoice": serde_json::to_value(oikos_rules::forms::all().into_iter().find(|f| f.form == "export_invoice").unwrap()).unwrap() } } }));
    let inner = crate::stub::Script.create(&h.ctx).unwrap();
    h.actor = wrap(&h.ctx, inner).unwrap();
    let mut o = offer();
    o["kinds"] = json!(["invoice"]);
    o["seconds"] = json!({ "invoice": 60 });
    o["depths"] = json!({ "invoice": ["act", "matter"] });
    for d in 1..=30 {
        h.wake(d * DAY + 3600, world(if d == 1 { vec![statement("rec.off", 0, PROV, "service_offer", &[], o.clone())] } else { vec![] }));
    }
    let order = format!("rec.{}", 1000 + h.sent.iter().position(|p| p.contains("kind=order")).expect("it engages") as i64 + 1);
    let mut up = set_up(&order);
    up[0]["data"]["offer"] = o;
    h.wake(32 * DAY + 3600, world(up));
    h.wake(33 * DAY + 3600, world(vec![signed()]));
    let remit = h.sent.iter().rev().find(|p| p.contains("kind=remit")).cloned().unwrap_or_default();
    assert!(remit.contains("\"depth\":\"matter\""), "{remit}");
    let rec = json!({ "id": "rec.remit", "record": "statement", "author": "ll-system", "speaks_for": ME, "at": 33 * DAY, "visible_to": [ME, PROV],
        "kind": "remit", "text": "From now", "addressed_to": [ME], "basis": "agr.1", "data": { "agreement": "agr.1", "kind": "invoice", "level": "draft", "depth": "matter" } });
    let out = all(&h.wake(34 * DAY + 3600, world(vec![rec])));
    let line = out.lines().find(|l| l.contains("kind=referral")).unwrap_or_else(|| panic!("{out}"));
    assert!(line.contains("\"facts\":{") && !line.contains("\"calls\"") && !line.contains("carries=") && line.contains("\"unit_price\":\"10000\"") && !line.contains("200000"), "the facts, not the paper: {line}");
    assert!(out.lines().any(|l| l.starts_with("goods(")), "the goods it sends itself: {out}");
    assert!(h.decisions.iter().any(|d| d["choice"] == "handed" && d["depth"] == "matter"), "the act it would have sent, on record");
    // (A draft as its own code would have sent it, in other words: signed off. One that invoices for more: declined,
    // the detail named.)
    let referral = last_referral(&h);
    let same = statement("rec.d1", 34 * DAY + 7200, ME, "draft", &[ME], json!({ "referral": referral, "paper": { "kind": "invoice", "text": "Our invoice for the 20 goods.", "to": ["outside"], "basis": "rec.16",
        "data": { "kind": "goods", "quantity": 20, "from_at": "works", "outcome": { "money": { "amount": "200000", "to": "acc-ll", "for": "export" } } } } }));
    let out = all(&h.wake(35 * DAY + 3600, world(vec![same])));
    assert!(out.contains("kind=sign_off"), "{out}");
    h.wake(36 * DAY + 3600, world(vec![]));
    let referral = last_referral(&h);
    let more = statement("rec.d2", 36 * DAY + 7200, ME, "draft", &[ME], json!({ "referral": referral, "paper": { "kind": "invoice", "text": "Invoice.", "to": ["outside"], "basis": "rec.16",
        "data": { "kind": "goods", "quantity": 20, "from_at": "works", "outcome": { "money": { "amount": "250000", "to": "acc-ll" } } } } }));
    let out = all(&h.wake(37 * DAY + 3600, world(vec![more])));
    let no = out.lines().find(|l| l.contains("kind=declined")).unwrap_or_else(|| panic!("{out}"));
    assert!(no.contains("the sum invoiced"), "the blank named as its form describes it: {no}");
}

#[test]
fn a_principal_remits_and_hands_over_only_kinds_of_its_own() {
    // (The scope pilot's W2: a factory's level decided by hand wrote a remit for every kind its offer took, and handed
    // over withholding reports, which its assistant's post had no form for.)
    const RETURN: &str = "statement(kind=withholding_report, text=\"Withheld.\", to=[\"outside\"], basis=law-tax)";
    let mut o = offer();
    o["kinds"] = json!(["notice_to_vacate", "withholding_report"]);
    let script: Vec<Value> = (1..=60).map(|d| json!({ "at": d * DAY + 3600, "call": if d % 2 == 0 { RETURN } else { NOTICE } })).collect();
    let commit = json!({ "offer": "assist", "levels": { "notice_to_vacate": "draft", "withholding_report": "draft" }, "levels_until": 60 * DAY, "keep_until": 90 * DAY, "why": "the study's design" });
    let mut h = Harness::new(&crate::stub::Script, ME, json!({ "script": script,
        "delegation": { "post": "ll-assistant", "account": "acc-ll", "kinds": { "notice_to_vacate": { "own_seconds": 1800, "error_cost": 1000 } }, "hour_value": 4000, "review_days": 30, "commit": commit } }));
    let inner = crate::stub::Script.create(&h.ctx).unwrap();
    h.actor = wrap(&h.ctx, inner).unwrap();
    h.wake(DAY + 3600, world(vec![statement("rec.off", 0, PROV, "service_offer", &[], o.clone())]));
    let order = format!("rec.{}", 1000 + h.sent.iter().position(|p| p.contains("kind=order")).unwrap() as i64 + 1);
    let mut up = set_up(&order);
    up[0]["data"]["offer"] = o;
    h.wake(32 * DAY + 3600, world(up));
    h.wake(33 * DAY + 3600, world(vec![signed()]));
    let remits: Vec<&String> = h.sent.iter().filter(|p| p.contains("kind=remit")).collect();
    assert!(remits.iter().any(|p| p.contains("notice_to_vacate")) && !remits.iter().any(|p| p.contains("withholding_report")), "a remit for its own kind only: {remits:?}");
    let held = json!({ "id": "rec.remit", "record": "statement", "author": "ll-system", "speaks_for": ME, "at": 34 * DAY, "visible_to": [ME, PROV],
        "kind": "remit", "text": "From now", "addressed_to": [PROV], "basis": "agr.1", "data": { "agreement": "agr.1", "kind": "notice_to_vacate", "level": "draft", "hold_until": 60 * DAY } });
    // (Even with a remit for the other kind on file, written by someone else in its name, it does that kind itself.)
    let other = json!({ "id": "rec.remit2", "record": "statement", "author": "ll-system", "speaks_for": ME, "at": 34 * DAY, "visible_to": [ME, PROV],
        "kind": "remit", "text": "From now", "addressed_to": [PROV], "basis": "agr.1", "data": { "agreement": "agr.1", "kind": "withholding_report", "level": "draft" } });
    let out = all(&h.wake(34 * DAY + 3600, world(vec![held, other])));
    let more = all(&h.wake(35 * DAY + 3600, world(vec![])));
    let both = format!("{out}\n{more}");
    assert!(both.lines().any(|l| l.starts_with("statement(basis=law-tax")) && !both.lines().any(|l| l.contains("kind=referral") && l.contains("withholding_report")), "its return it files itself: {both}");
    assert!(both.lines().any(|l| l.contains("kind=referral") && l.contains("notice_to_vacate")), "and hands its notices over: {both}");
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

const WANT: &str = "statement(data={\"facts\":{\"data\":{\"account\":\"acc-ll\",\"matter\":{\"matter\":\"disrepair\",\"party\":\"lord-1\"}},\"records\":[]},\"want\":{\"about\":\"disrepair\",\"since\":86400,\"whom\":\"lord-1\"}}, kind=\"want-disrepair\", text=\"For our assistant to see to: disrepair.\", visible=[\"ll\"])";

/// A want handed over (docs/design/handing-over.md H4): its referral carries the want's fields and the facts given,
/// no act, priced as a referral alone; a draft is signed off only if it goes to whom the want is about and would bear
/// on them, else declined; whatever comes back, nothing is redone: the want stays its holder's. With no remit that
/// hands it over, the want goes nowhere.
#[test]
fn a_want_handed_over_carries_its_fields_and_comes_back_with_nothing_to_redo() {
    let script: Vec<Value> = (1..=40).map(|d| json!({ "at": d * DAY + 3600, "call": WANT })).collect();
    let mut h = Harness::new(&crate::stub::Script, ME, json!({ "script": script,
        "delegation": { "post": "ll-assistant", "account": "acc-ll", "kinds": { "want-disrepair": { "own_seconds": 1800, "error_cost": 50_000 } }, "hour_value": 4000, "review_days": 30 } }));
    let inner = crate::stub::Script.create(&h.ctx).unwrap();
    h.actor = wrap(&h.ctx, inner).unwrap();
    let mut o = offer();
    o["kinds"] = json!(["want-disrepair"]);
    o["seconds"] = json!({ "want-disrepair": 60 });
    o["depths"] = json!({ "want-disrepair": ["want"] });
    let mut early = String::new();
    for d in 1..=30 {
        early.push_str(&all(&h.wake(d * DAY + 3600, world(if d == 1 { vec![statement("rec.off", 0, PROV, "service_offer", &[], o.clone())] } else { vec![] }))));
    }
    assert!(!early.contains("want-disrepair"), "no remit yet: the want goes nowhere: {early}");
    let order = format!("rec.{}", 1000 + h.sent.iter().position(|p| p.contains("kind=order")).expect("it engages") as i64 + 1);
    let mut up = set_up(&order);
    up[0]["data"]["offer"] = o;
    h.wake(32 * DAY + 3600, world(up));
    h.wake(33 * DAY + 3600, world(vec![signed()]));
    let remit = h.sent.iter().rev().find(|p| p.contains("kind=remit")).cloned().unwrap_or_default();
    assert!(remit.contains("\"depth\":\"want\""), "{remit}");
    let rec = json!({ "id": "rec.remit", "record": "statement", "author": "ll-system", "speaks_for": ME, "at": 33 * DAY, "visible_to": [ME, PROV],
        "kind": "remit", "text": "From now", "addressed_to": [ME], "basis": "agr.1", "data": { "agreement": "agr.1", "kind": "want-disrepair", "level": "draft", "depth": "want" } });
    let out = all(&h.wake(34 * DAY + 3600, world(vec![rec])));
    let line = out.lines().find(|l| l.contains("kind=referral")).unwrap_or_else(|| panic!("{out}"));
    assert!(line.contains("\"depth\":\"want\"") && line.contains("\"want\":{\"about\":\"disrepair\"") && line.contains("\"party\":\"lord-1\"") && !line.contains("\"calls\"") && !line.contains("carries="), "{line}");
    assert!(!out.contains("kind=\"want-"), "the want is never an act of the world's: {out}");
    // (A draft to someone else: declined, and nothing redone.)
    let referral = last_referral(&h);
    let other = statement("rec.d1", 34 * DAY + 7200, ME, "draft", &[ME], json!({ "referral": referral, "calls": "statement(data={\"matter\":\"disrepair\"}, kind=review_request, text=\"Request.\", to=[\"city\"])" }));
    let out = all(&h.wake(35 * DAY + 3600, world(vec![other])));
    let no = out.lines().find(|l| l.contains("kind=declined")).unwrap_or_else(|| panic!("{out}"));
    assert!(no.contains("does not go to whom this is about"), "{no}");
    assert!(!out.contains("want-disrepair") || out.lines().filter(|l| l.contains("kind=referral")).count() == 1, "nothing redone in the world: {out}");
    // (A draft to the landlord it is about: signed off.)
    h.wake(36 * DAY + 3600, world(vec![]));
    let referral = last_referral(&h);
    let right = statement("rec.d2", 36 * DAY + 7200, ME, "draft", &[ME], json!({ "referral": referral, "calls": "statement(data={\"against\":\"lord-1\",\"matter\":\"disrepair\"}, kind=review_request, text=\"Request.\", to=[\"lord-1\"])" }));
    let out = all(&h.wake(37 * DAY + 3600, world(vec![right])));
    assert!(out.contains("kind=sign_off"), "{out}");
    // (Reported not done: no slip counted, nothing redone.)
    let report = statement("rec.rep", 37 * DAY + 7200, ME, "report", &[ME], json!({ "referral": referral, "done": false, "why": "waiting" }));
    let out = all(&h.wake(38 * DAY + 3600, world(vec![report])));
    assert!(!out.lines().any(|l| l.contains("kind=review_request") || l.contains("kind=\"want-")), "{out}");
}

#[test]
fn a_person_deals_with_what_comes_by_post_when_it_next_sits_down_to_it_and_not_before() {
    // (Stakes D1a, docs/behaviour/assistants.md "Getting to the post": a person, whose assistant is the provider's desk,
    // who gets to its post every three days in the evening. Before 2026-11-14 a draft was signed off at the next wake.)
    let script: Vec<Value> = [34, 40].iter().map(|d| json!({ "at": d * DAY + 3600, "call": NOTICE })).collect();
    let commit = json!({ "offer": "assist", "levels": { "notice_to_vacate": "draft" }, "levels_until": 90 * DAY, "keep_until": 90 * DAY, "why": "a test's design", "hold": "freeze" });
    let mut h = Harness::new(&crate::stub::Script, ME, json!({ "script": script,
        "delegation": { "account": "acc-ll", "kinds": { "notice_to_vacate": { "own_seconds": 1800, "error_cost": 1000 } }, "hour_value": 4000, "review_days": 30, "commit": commit,
            "paperwork": { "every_days": [[3, 10_000]], "from_hour": 19, "to_hour": 20 } } }));
    let inner = crate::stub::Script.create(&h.ctx).unwrap();
    h.actor = wrap(&h.ctx, inner).unwrap();
    let mut o = offer();
    o["for"] = json!("persons");
    h.wake(DAY + 3600, world(vec![statement("rec.off", 0, PROV, "service_offer", &[], o.clone())]));
    let order = format!("rec.{}", 1000 + h.sent.iter().position(|p| p.contains("kind=order")).expect("it engages") as i64 + 1);
    let mut up = set_up(&order);
    up[0]["data"]["offer"] = o;
    h.wake(32 * DAY + 3600, world(up));
    h.wake(33 * DAY + 3600, world(vec![signed()]));
    let remit = json!({ "id": "rec.remit", "record": "statement", "author": "ll-system", "speaks_for": ME, "at": 33 * DAY + 4000, "visible_to": [ME, PROV],
        "kind": "remit", "text": "From now", "addressed_to": [PROV], "basis": "agr.1", "data": { "agreement": "agr.1", "kind": "notice_to_vacate", "level": "draft", "hold_until": 90 * DAY } });
    h.wake(34 * DAY + 3600, world(vec![remit]));
    // (Each draft comes from the desk an hour after the referral; the person is woken every hour after, as news and its
    // own code would wake it, and signs off only at a sitting.)
    let mut signed_at = vec![];
    for at_day in [34, 40] {
        if at_day == 40 {
            for t in (37 * DAY..40 * DAY + 3600).step_by(3600) {
                h.wake(t, world(vec![]));
            }
        }
        let referral = last_referral(&h);
        let came = at_day * DAY + 7200;
        let draft = statement(&format!("rec.d{at_day}"), came, PROV, "draft", &[ME], json!({ "referral": referral, "calls": NOTICE }));
        let first = all(&h.wake(came, world(vec![draft])));
        assert!(!first.contains("kind=sign_off"), "not dealt with as it comes: it waits in the post: {first}");
        let mut t = came;
        let at = loop {
            t += 3600;
            assert!(t < came + 4 * DAY, "signed off by the next sitting: {}", all(&h.sent));
            let out = all(&h.wake(t, world(vec![])));
            if let Some(line) = out.lines().find(|l| l.contains("kind=sign_off")) {
                // (Its own act, priced as ever by the table's row for a sign-off: the act is placed on its timeline.)
                assert!(line.starts_with("statement(") && line.contains(&format!("basis=rec.d{at_day}")), "{line}");
                break t;
            }
        };
        assert!((19 * 3600..=20 * 3600).contains(&at.rem_euclid(DAY)), "in its own evening hours: {}", at.rem_euclid(DAY));
        signed_at.push(at);
    }
    // (The second draft came days after a sitting: it waited for the next, a whole number of its three days on.)
    assert!(signed_at[1] - signed_at[0] >= 3 * DAY && (signed_at[1] - signed_at[0]) % (3 * DAY) == 0, "{signed_at:?}");
}
