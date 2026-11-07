//! The assistant's side: it does what it is handed at the level asked, waits for what each level waits for, follows
//! its principal's brief, slips as its template's row says, and acts on nothing it was not handed.

use super::*;
use crate::delegation::assistant::Assistant;
use oikos_rules::slip::Performer;
use std::sync::Arc;

fn assistant(slip_bps: Option<i64>) -> Harness {
    let mut h = Harness::new(&Assistant, ME, json!({}));
    h.ctx.performer = Performer::System;
    if let Some(bps) = slip_bps {
        let mut w = (*h.ctx.world).clone();
        w.slip = Some(serde_json::from_value(json!({ "system": { "assistant-a": { "bps": bps } } })).unwrap());
        h.ctx.world = Arc::new(w);
    }
    h
}

/// Its papers: the delivery naming it, its principal's brief, and what it is handed.
fn handed(wants: &str, agreement: &str) -> Vec<Value> {
    vec![
        statement("rec.del", 32 * DAY, PROV, "service_delivery", &[ME], json!({ "order": "rec.50", "offer": offer(), "systems": ["ll-system"] })),
        statement("rec.brief", 33 * DAY, ME, "brief", &[PROV], json!({ "agreement": "agr.1", "delivery": "rec.del" })),
        statement("rec.ref", 34 * DAY, ME, "referral", &[PROV], json!({ "agreement": agreement, "kind": "notice_to_vacate", "wants": wants, "calls": NOTICE })),
    ]
}

fn acted(out: &str) -> bool {
    out.lines().any(|l| l.starts_with("statement(basis=lease-1"))
}

#[test]
fn alone_it_does_the_matter_and_reports_with_what_its_act_made() {
    let mut h = assistant(None);
    let out = all(&h.wake(34 * DAY + 3600, world(handed("alone", "agr.1"))));
    assert!(acted(&out) && out.contains("kind=report") && out.contains("\"done\":true"), "{out}");
}

#[test]
fn a_draft_waits_for_its_sign_off_and_a_request_for_its_go_ahead() {
    let mut h = assistant(None);
    let out = all(&h.wake(34 * DAY + 3600, world(handed("draft", "agr.1"))));
    assert!(out.contains("kind=draft") && !acted(&out), "a draft, not the act: {out}");
    let draft = format!("rec.{}", 1000 + h.sent.len() as i64);
    let sign = statement("rec.so", 35 * DAY, ME, "sign_off", &[PROV], json!({ "draft": draft, "referral": "rec.ref" }));
    let out = all(&h.wake(35 * DAY + 3600, world(vec![sign])));
    assert!(acted(&out) && out.contains("kind=report"), "signed off: sent as drafted: {out}");

    let mut h = assistant(None);
    let out = all(&h.wake(34 * DAY + 3600, world(handed("approve", "agr.1"))));
    assert!(out.contains("kind=approval_request") && !acted(&out), "{out}");
    let req = format!("rec.{}", 1000 + h.sent.len() as i64);
    let go = statement("rec.go", 35 * DAY, ME, "go_ahead", &[PROV], json!({ "request": req, "referral": "rec.ref" }));
    assert!(acted(&all(&h.wake(35 * DAY + 3600, world(vec![go])))));
}

#[test]
fn it_acts_on_nothing_not_handed_to_it_and_nothing_its_brief_stops() {
    let mut h = assistant(None);
    let out = all(&h.wake(34 * DAY + 3600, world(handed("alone", "agr.other"))));
    assert!(out.is_empty(), "another service's matter is not its own: {out}");
    let mut h = assistant(None);
    let mut recs = handed("alone", "agr.1");
    recs[1]["data"]["stop"] = json!(["notice_to_vacate"]);
    let out = all(&h.wake(34 * DAY + 3600, world(recs)));
    assert!(!acted(&out) && out.contains("\"done\":false") && out.contains("your brief says not to"), "{out}");
}

#[test]
fn a_providers_desk_writes_each_clients_papers_in_their_name_and_reports_to_them() {
    let mut h = Harness::new(&Assistant, PROV, json!({}));
    h.ctx.performer = Performer::System;
    let mut person = offer();
    person["for"] = json!("persons");
    let recs = vec![
        statement("rec.del", 32 * DAY, PROV, "service_delivery", &["ann"], json!({ "order": "rec.50", "offer": person, "systems": ["prov-a-system"] })),
        statement("rec.brief", 33 * DAY, "ann", "brief", &[PROV], json!({ "agreement": "agr.9", "delivery": "rec.del" })),
        statement("rec.ref", 34 * DAY, "ann", "referral", &[PROV], json!({ "agreement": "agr.9", "kind": "notice_to_vacate", "wants": "alone", "calls": NOTICE })),
    ];
    let out = all(&h.wake(34 * DAY + 3600, world(recs)));
    assert!(out.lines().any(|l| l.starts_with("statement(basis=lease-1") && l.contains("for=ann")), "in her name: {out}");
    assert!(out.contains("kind=report") && out.contains("to=[\"ann\"]"), "and told to her: {out}");
}

#[test]
fn at_the_end_it_hands_over_what_is_open_with_its_notes_only_where_the_records_term_gives_them() {
    for (records, notes) in [("principal", true), ("provider", false)] {
        let mut h = assistant(None);
        let mut recs = handed("draft", "agr.1");
        recs[0]["data"]["offer"]["records"] = json!(records);
        h.wake(34 * DAY + 3600, world(recs));
        let end = statement("rec.end", 35 * DAY, ME, "brief", &[PROV], json!({ "agreement": "agr.1", "hand_over": true }));
        let out = all(&h.wake(35 * DAY + 3600, world(vec![end])));
        assert!(out.contains("kind=handover") && out.contains("\"open\":[\"rec.ref\"]"), "{out}");
        assert_eq!(out.contains("\"notes\""), notes, "records {records}: {out}");
    }
}

#[test]
fn where_it_slips_the_matter_is_lost_as_written_and_it_believes_it_done() {
    let mut h = assistant(Some(10_000));
    let out = all(&h.wake(34 * DAY + 3600, world(handed("alone", "agr.1"))));
    assert!(!acted(&out) && out.contains("\"done\":true"), "its template's row, not its provider's claim: {out}");
    let mut h = assistant(Some(10_000));
    let out = all(&h.wake(34 * DAY + 3600, world(handed("draft", "agr.1"))));
    assert!(out.contains("kind=draft") && !out.contains("\"calls\""), "a draft that is not what was asked: {out}");
}
