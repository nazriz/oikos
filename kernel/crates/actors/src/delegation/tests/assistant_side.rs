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

/// Handed what happened, the code assistant works the paper out from the facts, as its principal's code would have.
#[test]
fn handed_what_happened_it_composes_the_paper_from_the_facts() {
    let mut h = assistant(None);
    let mut papers = handed("alone", "agr.1");
    papers[2] = statement("rec.ref", 34 * DAY, ME, "referral", &[PROV], json!({ "agreement": "agr.1", "kind": "invoice", "wants": "alone", "depth": "matter",
        "facts": { "goods": "goods", "quantity": 20, "sent_from": "works", "to": "outside", "unit_price": "10000", "paid_into": "acc-ll", "under": "rec.16" } }));
    let out = all(&h.wake(34 * DAY + 3600, world(papers)));
    let inv = out.lines().find(|l| l.contains("kind=invoice")).unwrap_or_else(|| panic!("{out}"));
    assert!(inv.starts_with("invoice = statement(") && inv.contains("\"amount\":\"200000\"") && inv.contains("basis=rec.16") && inv.contains("to=[\"outside\"]"), "{inv}");
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
    let line = out.lines().find(|l| l.contains("kind=draft")).unwrap_or_default();
    assert!(line.contains("visible=[\"ll\"]") && !line.contains(PROV), "an organisation's own system writes to it alone: {line}");
    let sign = statement("rec.so", 35 * DAY, ME, "sign_off", &[ME], json!({ "draft": draft, "referral": "rec.ref" }));
    let out = all(&h.wake(35 * DAY + 3600, world(vec![sign])));
    assert!(acted(&out) && out.contains("kind=report"), "signed off: sent as drafted: {out}");

    let mut h = assistant(None);
    let out = all(&h.wake(34 * DAY + 3600, world(handed("approve", "agr.1"))));
    assert!(out.contains("kind=approval_request") && !acted(&out), "{out}");
    let req = format!("rec.{}", 1000 + h.sent.len() as i64);
    let go = statement("rec.go", 35 * DAY, ME, "go_ahead", &[PROV], json!({ "request": req, "referral": "rec.ref" }));
    assert!(acted(&all(&h.wake(35 * DAY + 3600, world(vec![go.clone()])))));

    // (A remit that hands the kind over no longer, after the matter was handed: the principal took it back, and a
    // go-ahead that comes after all is not acted on: the scope pilot's W4.)
    let mut h = assistant(None);
    h.wake(34 * DAY + 3600, world(handed("approve", "agr.1")));
    let cut = statement("rec.cut", 34 * DAY + 7200, ME, "remit", &[PROV], json!({ "agreement": "agr.1", "kind": "notice_to_vacate", "level": "none" }));
    assert!(!acted(&all(&h.wake(35 * DAY + 3600, world(vec![cut, go])))), "taken back: not its to send");
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

/// Handed a want, the desk's code is a clerk (docs/design/handing-over.md section 4.3): it writes first, in its client's
/// name, to whom the want is about; asked already and refused, it applies to a body its board says hears the matter;
/// with nowhere to go, it reports so. Its report says the way it took.
#[test]
fn handed_a_want_its_clerk_writes_first_to_whom_it_is_about_then_to_a_body_that_hears_it() {
    let run = |facts: Value, extra: Vec<Value>| {
        let mut h = Harness::new(&Assistant, PROV, json!({}));
        h.ctx.performer = Performer::System;
        let mut person = offer();
        person["for"] = json!("persons");
        let mut recs = vec![
            statement("rec.del", 32 * DAY, PROV, "service_delivery", &["ann"], json!({ "order": "rec.50", "offer": person, "systems": ["prov-a-system"] })),
            statement("rec.brief", 33 * DAY, "ann", "brief", &[PROV], json!({ "agreement": "agr.9", "delivery": "rec.del" })),
            statement("rec.ref", 34 * DAY, "ann", "referral", &[PROV], json!({ "agreement": "agr.9", "kind": "want-disrepair", "wants": "alone", "depth": "want",
                "want": { "about": "disrepair", "whom": "lord-1", "since": DAY }, "facts": { "records": [], "data": facts } })),
        ];
        recs.extend(extra);
        all(&h.wake(60 * DAY + 3600, world(recs)))
    };
    let out = run(json!({ "matter": { "matter": "disrepair", "party": "lord-1", "structure": "apts-1" }, "account": "acc-ann", "answer_days": 14 }), vec![]);
    let ask = out.lines().find(|l| l.contains("kind=review_request")).unwrap_or_else(|| panic!("{out}"));
    assert!(ask.contains("to=[\"lord-1\"]") && ask.contains("for=ann") && ask.contains("\"against\":\"lord-1\""), "{ask}");
    let mut venue = statement("rec.h1", 0, "city", "offer", &[], json!({}));
    venue["offer"] = json!({ "take_up": "apply", "hears": [{ "about": "disrepair" }] });
    venue["visible_to"] = json!("public");
    let out = run(json!({ "matter": { "matter": "disrepair", "party": "lord-1" }, "account": "acc-ann", "asked": 40 * DAY, "answer": "refused", "answer_days": 14 }), vec![venue]);
    let app = out.lines().find(|l| l.contains("kind=application")).unwrap_or_else(|| panic!("{out}"));
    assert!(app.contains("to=[\"city\"]") && app.contains("basis=rec.h1") && app.contains("for=ann"), "{app}");
    let out = run(json!({ "matter": { "matter": "disrepair", "party": "lord-1" }, "account": "acc-ann", "asked": 40 * DAY, "answer": "refused", "answer_days": 14 }), vec![]);
    assert!(out.contains("kind=report") && out.contains("\"done\":false") && out.contains("no body on the board"), "{out}");
}
