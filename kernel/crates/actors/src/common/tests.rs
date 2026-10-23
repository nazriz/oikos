//! The common ground's behaviour, as participants/test held it of common.ts (book, asking, letters, standing work,
//! directions, laws), rewritten to assert behaviour.

use super::*;
use crate::{Ctx, Cx, Draws, WorldInfo};
use oikos_sight::Record;
use serde_json::{json, Value};
use std::sync::Arc;

fn rec(v: Value) -> Arc<Record> {
    Arc::new(serde_json::from_value(v).expect("a record"))
}

fn st(id: &str, at: i64, kind: &str, speaks_for: &str, data: Value) -> Arc<Record> {
    rec(json!({ "id": id, "record": "statement", "author": "p.1", "speaks_for": speaks_for, "at": at, "visible_to": "public", "kind": kind, "text": kind, "data": data }))
}

fn withdrawal(id: &str, at: i64, of: &str) -> Arc<Record> {
    rec(json!({ "id": id, "record": "withdrawal", "author": "p.1", "at": at, "visible_to": "public", "withdraws": of }))
}

#[test]
fn a_book_keeps_what_stands_in_the_order_seen() {
    let mut b = Book::new();
    let fresh = b.take_all(&[st("rec.10", 5, "law", "city", json!({})), st("rec.9", 1, "law", "city", json!({})), st("rec.11", 6, "notice_x", "city", json!({}))]);
    assert_eq!(fresh.len(), 3);
    assert_eq!(b.take_all(&[st("rec.10", 5, "law", "city", json!({}))]).len(), 0, "a record seen before is passed over");
    assert_eq!(b.open("law").map(|r| r.id.as_str()).collect::<Vec<_>>(), ["rec.10", "rec.9"], "in the order seen");
    b.take_all(&[withdrawal("rec.12", 7, "rec.10")]);
    assert_eq!(b.open("law").count(), 1);
    assert_eq!(b.all("law").count(), 2);
    assert!(b.repealed("rec.10"));
    assert_eq!(b.withdrawn_at("rec.10"), Some(7));
    // (A withdrawal seen before what it withdraws: the statement never stands.)
    b.take_all(&[withdrawal("rec.14", 8, "rec.13"), st("rec.13", 3, "law", "city", json!({}))]);
    assert_eq!(b.open("law").map(|r| r.id.as_str()).collect::<Vec<_>>(), ["rec.9"]);
}

#[test]
fn an_amended_law_replaces_the_one_it_names_for_its_speaker_only() {
    let mut b = Book::new();
    b.take_all(&[
        st("rec.1", 0, "law", "city", json!({})),
        st("rec.2", 10, "law", "city", json!({ "replaces": "rec.1" })),
        st("rec.3", 20, "law", "city", json!({ "replaces": "rec.2" })),
        st("rec.4", 0, "law", "other", json!({})),
        st("rec.5", 30, "law", "city", json!({ "replaces": "rec.4" })),
    ]);
    assert_eq!(b.current("rec.1").map(|r| r.id.as_str()), Some("rec.3"));
    assert!(!b.repealed("rec.1"));
    assert!(b.current("rec.4").is_some(), "a statement of another speaker is not replaced");
    assert_eq!(b.open("law").map(|r| r.id.as_str()).collect::<Vec<_>>(), ["rec.3", "rec.4", "rec.5"]);
}

#[test]
fn holds_name_what_they_hold_for_whom() {
    let mut b = Book::new();
    b.take_all(&[st("rec.1", 0, "work_order", "city", json!({ "work": { "task": "collect" }, "every": 86400 })), st("rec.2", 5, "hold", "city", json!({ "holds": ["rec.1"] }))]);
    assert!(b.on_hold("rec.1", None));
    assert!(!b.on_hold("rec.1", Some(&["bank".to_string()])), "a hold by anyone else is nothing to them");
    b.take_all(&[withdrawal("rec.3", 6, "rec.2")]);
    assert!(!b.on_hold("rec.1", None));
}

#[test]
fn agreements_concluded_in_force_and_taken_back() {
    let a = rec(json!({ "id": "rec.1", "record": "agreement", "author": "p.l", "at": 0, "visible_to": ["l", "t"], "terms": { "template": "lease", "parties": ["l", "t"], "commitments": [] } }));
    let sig = |id: &str, at: i64, who: &str| rec(json!({ "id": id, "record": "signature", "author": "p", "at": at, "visible_to": ["l", "t"], "agreement": "rec.1", "as": who }));
    let mut b = Book::new();
    b.take_all(&[a.clone(), sig("rec.2", 1, "l")]);
    assert!(!b.concluded("rec.1"));
    b.take_all(&[sig("rec.3", 4, "t")]);
    assert!(b.concluded("rec.1") && b.in_force("rec.1"));
    assert_eq!(b.signed_at("rec.1"), Some(4));
    // (An offer taken back before the last signature concludes nothing.)
    let mut b = Book::new();
    b.take_all(&[a, sig("rec.2", 1, "l"), withdrawal("rec.4", 2, "rec.1"), sig("rec.3", 4, "t")]);
    assert!(b.taken_back("rec.1") && !b.concluded("rec.1") && !b.in_force("rec.1"));
}

#[test]
fn claims_and_lots_by_what_they_are_about() {
    let claim = |id: &str, holder: &str, object: &str| rec(json!({ "id": id, "record": "claim", "author": "genesis", "at": 0, "visible_to": "public", "position": "right", "holder": holder, "about": { "kind": "ownership", "object": object } }));
    let mut b = Book::new();
    b.take_all(&[
        claim("rec.1", "ann", "lot-1"),
        claim("rec.2", "bob", "lot-2"),
        claim("rec.3", "ann", "lot-3"),
        st("rec.4", 0, "lot", "registry", json!({ "cells": ["c1", "c2", "c1"] })),
        st("rec.5", 0, "lot", "registry", json!({ "cells": ["c2"] })),
    ]);
    assert_eq!(b.claims_by(ClaimKey::Holder, "ann").count(), 2);
    assert_eq!(b.claims_by(ClaimKey::Object, "lot-2").next().map(|r| r.id.as_str()), Some("rec.2"));
    assert_eq!(lot_of(&b, "c2"), Some("rec.4"), "of several, the first seen");
    b.take_all(&[withdrawal("rec.6", 1, "rec.4")]);
    assert_eq!(lot_of(&b, "c2"), Some("rec.5"));
    assert_eq!(lot_of(&b, "c1"), None);
    assert!(cells_of(&b, "rec.4").is_empty());
}

#[test]
fn a_book_saved_and_restored_answers_as_before() {
    let mut b = Book::new();
    b.take_all(&[st("rec.1", 0, "law", "city", json!({})), st("rec.2", 1, "law", "city", json!({ "replaces": "rec.1" })), withdrawal("rec.3", 2, "rec.9")]);
    b.note_unread("rec.2", "an act", "no such field");
    let again = Book::restore(b.save()).unwrap();
    assert_eq!(again.open("law").map(|r| r.id.clone()).collect::<Vec<_>>(), b.open("law").map(|r| r.id.clone()).collect::<Vec<_>>());
    assert_eq!(again.current("rec.1").map(|r| r.id.clone()), Some("rec.2".into()));
    assert!(again.withdrawn("rec.9"));
    assert_eq!(again.unread("rec.2"), 1);
    assert_eq!(again.save(), b.save());
}

#[test]
fn papers_are_ordered_as_filed_not_as_text() {
    use std::cmp::Ordering::*;
    assert_eq!(filed_before("rec.9", "rec.10"), Less);
    assert_eq!(filed_before("rec.1000", "rec.999"), Greater);
    assert_eq!(filed_before("rec.007", "rec.7"), Equal);
    assert_eq!(filed_before("agr.2", "rec.1"), Less, "different names fall back to byte order");
    let mut v = vec!["rec.10", "rec.9", "rec.100"];
    v.sort_by(|a, b| filed_before(a, b));
    assert_eq!(v, ["rec.9", "rec.10", "rec.100"]);
}

#[test]
fn a_team_shares_the_day_evenly() {
    let here: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
    let left = |w: &str| match w {
        "a" => 8 * 3600,
        "b" => 2 * 3600,
        _ => 7 * 3600,
    };
    assert_eq!(team(&here, left), (vec!["a".into(), "c".into()], 7 * 3600), "two at seven hours beat three at two");
}

#[test]
fn occurrences_name_a_paper_by_who_and_what_never_its_number() {
    let mut o = Occurrences::default();
    assert_eq!(o.key("rec.40", &[Some("ann"), Some("apts-3")]), "ann/apts-3#1");
    assert_eq!(o.key("rec.41", &[Some("ann"), Some("apts-3")]), "ann/apts-3#2");
    assert_eq!(o.key("rec.40", &[Some("ann"), Some("apts-3")]), "ann/apts-3#1", "the same paper is the same occurrence");
    assert_eq!(o.key("rec.42", &[Some("ann"), Some("rec.40")]), "ann/#1", "a record's number is left out");
}

#[test]
fn office_notes_are_known_and_never_answered() {
    let note = PAYMENT_FAILED::note("12.00 units", "acc.7", "rec.88");
    assert_eq!(PAYMENT_FAILED::is(&note), Some("rec.88"));
    assert!(office_note(&note));
    let died = PAYEE_DIED::note("ann", "acc.7", "rec.5");
    assert_eq!(PAYEE_DIED::who(&died), Some("ann"));
    assert!(office_note("Report from the works office: all well."));
    assert!(office_note("From the bank: your request rec.4 is received."));
    assert!(office_note("Hold rec.4 is in place."));
    assert!(office_note("Request rec.9 not carried out: no such account."));
    assert!(!office_note("Please fix my roof."));
    let a = oikos_rules::forms::Answers {
        office: "the works office".into(),
        acts: "It acts on its forms.".into(),
        forms: vec![oikos_rules::forms::AnswerForm { about: vec!["bin".into()], say: "Bins are collected weekly.".into() }],
        report: false,
    };
    assert_eq!(acknowledged(&a, "My BIN was missed"), "From the works office: your letter is received. This office does not act on a letter's words. It acts on its forms. Bins are collected weekly.");
}

fn ctx(position: Option<&str>) -> Ctx {
    Ctx {
        participant: "p.works".into(),
        performer: Default::default(),
        entity: "city".into(),
        position: position.map(String::from),
        params: Default::default(),
        world: Arc::new(WorldInfo::default()),
    }
}

#[test]
fn standing_work_follows_the_order_in_force() {
    let mut b = Book::new();
    b.take_all(&[st("rec.1", 0, "work_order", "city", json!({ "work": { "task": "collect", "at": "depot", "units": 3 }, "every": 7 * DAY, "first": DAY }))]);
    let staff = StandingWork::new("city", Part::Staff, []);
    assert!(staff.order(&b, "collect", 0).is_none(), "not begun");
    let o = staff.order(&b, "collect", DAY).unwrap();
    assert_eq!((o.every, o.at.as_deref(), o.units), (7 * DAY, Some("depot"), Some(3)));
    assert!(staff.does(&b, "sweep", DAY, DAY).is_none(), "no order, no routine");
    assert_eq!(StandingWork::new("city", Part::Whole, []).does(&b, "sweep", DAY, DAY), Some((DAY, None)));
    assert!(StandingWork::new("city", Part::Seat, []).does(&b, "collect", DAY, DAY).is_none());
    b.take_all(&[st("rec.2", 5, "hold", "city", json!({ "holds": ["rec.1"] }))]);
    assert!(staff.order(&b, "collect", DAY).is_none(), "on hold");
    // (The seat sets an order for a routine with none on file, once.)
    let mut seat = StandingWork::new("city", Part::Seat, []);
    let r = [work::Routine { task: "sweep", at: "depot", every: DAY, why: "Sweeping." }, work::Routine { task: "collect", at: "depot", every: DAY, why: "x" }];
    assert_eq!(seat.set::<()>(&b, &r).len(), 1);
    assert!(seat.set::<()>(&b, &r).is_empty());
}

#[test]
fn the_staff_report_when_how_an_order_stands_changes() {
    let mut b = Book::new();
    b.take_all(&[st("rec.1", 0, "work_order", "city", json!({ "work": { "task": "collect" }, "every": 7 * DAY }))]);
    let c = ctx(Some("works-staff"));
    let mut draws = Draws::default();
    let mut staff = StandingWork::new("city", Part::Staff, []);
    let of = work::ReportOf { office: "works", from: "the works staff", tasks: vec![("collect", "rounds", Some("loads")), ("sweep", "days", None)], ..Default::default() };
    staff.did("collect", DAY, 4, &[]);
    let cx = Cx::new(2 * DAY, &c, &mut draws, 1, vec![]);
    let steps = staff.report::<()>(&b, &cx, &of);
    assert_eq!(steps.len(), 1);
    let text = oikos_sight::calls::program_text(&steps[0].program());
    assert!(text.contains("carried out: 1 rounds, 4 loads"), "{text}");
    assert!(text.contains("no standing work order for sweep"), "{text}");
    let cx = Cx::new(3 * DAY, &c, &mut draws, 1, vec![]);
    assert!(staff.report::<()>(&b, &cx, &of).is_empty(), "nothing changed, and a week has not passed");
    staff.held_up("collect", "nobody came in");
    let cx = Cx::new(4 * DAY, &c, &mut draws, 1, vec![]);
    let steps = staff.report::<()>(&b, &cx, &of);
    assert!(oikos_sight::calls::program_text(&steps[0].program()).contains("not carried out: nobody came in"));
}

#[test]
fn directions_are_followed_only_from_the_posts_the_rule_names() {
    let mut b = Book::new();
    let dir = |id: &str, at: i64, pos: &str| rec(json!({ "id": id, "record": "statement", "author": "p.mayor", "in_position": pos, "speaks_for": "city", "at": at, "visible_to": ["city"], "basis": "rec.2", "kind": "direction", "text": "Do it", "addressed_to": ["city"], "data": {} }));
    b.take_all(&[
        st("rec.1", 0, "procedure", "city", json!({ "directions": { "by": ["mayor"] } })),
        st("rec.2", 0, "form", "city", json!({ "office": "works", "form": "staffing" })),
        dir("rec.3", 5, "mayor"),
        dir("rec.4", 6, "clerk"),
    ]);
    let c = ctx(Some("works-staff"));
    let mut d = Directions::new(&c, "rec.1", None, "the works office");
    let mut draws = Draws::default();
    let mut cx = Cx::new(10, &c, &mut draws, 1, vec![]);
    assert_eq!(d.standing(&b, "staffing", &mut cx).map(|r| r.id.as_str()), Some("rec.3"), "the clerk's later one is not from a post that may direct");
    let letters = d.letters::<()>(&b, |_, _| "We will staff as it says.".into());
    assert_eq!(letters.len(), 2);
    assert!(d.letters::<()>(&b, |_, _| String::new()).is_empty(), "each answered once");
}

#[test]
fn pace_learns_how_long_a_crew_takes() {
    let mut p = Pace::new(600);
    let crew = vec!["a".to_string(), "b".to_string()];
    assert_eq!(p.per_unit(&crew), 600);
    let refusal: oikos_sight::Outcome = serde_json::from_value(json!({ "action": "x", "t": 0, "status": "refused", "refusal": { "code": "no_time_left", "detail": "a has 100 s of work left today; this needs 4800" } })).unwrap();
    p.refused(&refusal, 10, &crew);
    assert_eq!(p.per_unit(&crew), 960, "4800 each for 10 units between two: 960 a unit");
    p.done(&crew, 3);
    p.done(&crew, 4);
    assert_eq!(p.per_unit(&crew), 941, "2% quicker once in the week");
}

#[test]
fn a_prohibition_binds_an_act_it_is_true_of_and_says_when_it_cannot_be_read() {
    let law = rec(json!({ "id": "rec.1", "record": "statement", "author": "genesis", "speaks_for": "city", "at": 0, "visible_to": "public", "kind": "law", "text": "No building on lot-1.",
        "adico": { "deontic": "must_not" }, "formal": { "language": "cel", "condition": "block.block == 'construct' && block.on == 'lot-1'" } }));
    let odd = rec(json!({ "id": "rec.2", "record": "statement", "author": "genesis", "speaks_for": "city", "at": 0, "visible_to": "public", "kind": "law", "text": "x",
        "adico": { "deontic": "must_not" }, "formal": { "language": "cel", "condition": "block.rent > 5" } }));
    let mut b = Book::new();
    b.take_all(&[law, odd]);
    assert_eq!(prohibitions(&b, None).len(), 2);
    let hits = breaches(&mut b, &json!({ "block": "construct", "on": "lot-1" }), "ann", 5);
    assert_eq!(hits.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["rec.1"]);
    assert_eq!(b.unread("rec.2"), 1);
    let a = noted(&mut b, oikos_sight::Action::Call { program: oikos_sight::calls::parse_program("wait()").unwrap_or(oikos_sight::calls::Program::Lines(vec![])), reasoning: Some("Building.".into()) });
    let oikos_sight::Action::Call { reasoning: Some(r), .. } = a else { panic!() };
    assert!(r.starts_with("Building. (A law that can't be read against an act doesn't bind it: rec.2 couldn't be read against construct"), "{r}");
    assert!(b.take_unread().is_none(), "said once");
}

#[test]
fn asking_builds_one_named_thing_at_a_time() {
    let q = ask::about("titles", "about.object", "lot-1", ask::About { most: 5, newest: true, ..Default::default() });
    let j = serde_json::to_value(&q).unwrap();
    assert_eq!(j, json!({ "channel": "titles", "query": { "where": [{ "field": "about.object", "op": "=", "value": "lot-1" }], "order": { "field": "at", "desc": true }, "limit": 5 } }));
    assert_eq!(serde_json::to_value(look_up::holders("who", "city", "councillor")).unwrap(), json!({ "channel": "who", "who": { "entity": "city", "role": "councillor" } }));
    let places: Vec<String> = (0..20).map(|i| format!("c{i}")).collect();
    assert_eq!(go_see("map", &places).visit.unwrap().places.len(), VISIT_MAX);
    let mut asked = Asked::default();
    assert!(asked.first("x", 3) && !asked.first("x", 4));
    assert_eq!(asked.since("x"), 3);
    assert_eq!(asked.since("y"), -1);
}

#[test]
fn dates_and_notices() {
    let w = WorldInfo::default();
    assert_eq!(when_words(0, &w), "year 1, day 1");
    assert_eq!(when_words(400 * DAY, &w), "year 2, day 36");
    assert_eq!(when_words(-DAY - 5, &w), "2 days before the year began");
    let cal = oikos_rules::calendar::Calendar { start: oikos_rules::calendar::Date { year: 2026, month: 3, day: 12 }, weekend: vec![5, 6], holidays: vec![] };
    let w = WorldInfo { calendar: Some(cal.clone()), ..Default::default() };
    assert_eq!(when_words(DAY, &w), "2026-03-13", "a calendar with no words: ISO");
    let table: serde_json::Value = serde_json::from_str(include_str!("../../../../../contracts/test/dates.json")).unwrap();
    let w = WorldInfo { calendar: Some(cal.clone()), date_style: serde_json::from_value(table["calendars"]["dmy"].clone()).unwrap(), ..Default::default() };
    assert_eq!(when_words(DAY, &w), "13 March 2026");
    assert_eq!(when_words_long(DAY, &w), "Friday 13 March 2026");
    assert_eq!(read_date("Friday 13 March 2026", 0, &w), Some(DAY));
    assert_eq!(read_date("year 1, day 3", 0, &w), Some(2 * DAY), "an old paper still reads");
    assert_eq!(read_date("31 April 2026", 0, &w), None);
    let w = WorldInfo { calendar: Some(cal.clone()), ..Default::default() };
    assert_eq!(starts_on(DAY - 60, 60 * DAY), 62 * DAY, "a notice sent in a day's last minutes runs from the next");
    assert_eq!(next_working(&cal, 0, 9 * 3600), 9 * 3600);
    assert_eq!(next_working(&cal, DAY + 10 * 3600, 9 * 3600), 4 * DAY + 9 * 3600, "Friday after nine: Monday");
}

/// A notice counts from when it is on the record, which is after it is sent (foundations F7, 2026-10-16): a date counted from the moment
/// of sending was short of the law's notice for one sent in the last minutes of a day (a landlord's notice of 29 days, 23 hours and 34
/// minutes, where the law asks 30 days). Ported from participants/test/notice-lag.test.ts (the TypeScript helper is gone).
#[test]
fn a_notice_sent_at_any_moment_of_a_day_runs_its_days_before_the_change_begins() {
    let lead = 30 * DAY;
    for sent in [0, 3_600, 12 * 3_600, DAY - 3_600, DAY - 901, DAY - 60, DAY - 1] {
        let from = starts_on(sent, lead);
        assert_eq!(from % DAY, 0, "an increase begins with a day");
        assert!(from - (sent + NOTICE_LAG) >= lead, "sent at {sent}");
        assert!(from - sent <= lead + DAY + NOTICE_LAG, "sent at {sent}");
    }
    // (And what takes a quarter of an hour and waits half an hour more is within the lag.)
    assert!(starts_on(DAY - 60, lead) - (DAY - 60 + 900 + 1_800) >= lead);
}

#[test]
fn a_book_lets_go_of_what_it_is_told_and_stands_as_a_book_restored_from_what_it_kept() {
    let mut b = Book::new();
    b.take_all(&[
        st("rec.1", 1, "law", "city", json!({})),
        st("rec.2", 2, "news", "paper", json!({})),
        st("rec.3", 3, "news", "paper", json!({})),
        withdrawal("rec.4", 4, "rec.3"),
        st("rec.5", 5, "news", "paper", json!({})),
        withdrawal("rec.6", 6, "rec.5"),
        st("rec.7", 7, "law", "city", json!({ "replaces": "rec.1" })),
    ]);
    // Told to keep only the laws: the news goes, with the withdrawal of what went; the withdrawal of a kept paper
    // (rec.5 is asked to go, rec.6 to go: both go) and what replaced a kept law stay.
    let remap = b.forget(|r| r.id == "rec.1" || r.id == "rec.3" || r.id == "rec.7");
    assert_eq!(remap, vec![Some(0), None, Some(1), Some(2), None, None, Some(3)], "rec.4 withdraws rec.3, which is kept: kept too");
    assert_eq!(b.len(), 4);
    assert!(!b.has("rec.2") && !b.has("rec.5") && b.get("rec.2").is_none());
    assert!(b.withdrawn("rec.3") && !b.withdrawn("rec.5"));
    assert_eq!(b.current("rec.1").map(|r| r.id.as_str()), Some("rec.7"));
    assert_eq!(b.all("news").map(|r| r.id.as_str()).collect::<Vec<_>>(), ["rec.3"]);
    // Saved and restored, the same book.
    let back = Book::restore(b.save()).unwrap();
    assert_eq!(back.save(), b.save());
    for id in ["rec.1", "rec.3", "rec.5", "rec.7"] {
        assert_eq!((back.withdrawn(id), back.has(id)), (b.withdrawn(id), b.has(id)), "{id}");
    }
    assert_eq!(back.open("law").map(|r| r.id.as_str()).collect::<Vec<_>>(), b.open("law").map(|r| r.id.as_str()).collect::<Vec<_>>());
    // A record let go of and shown again is new.
    assert_eq!(b.take_all(&[st("rec.2", 2, "news", "paper", json!({}))]).len(), 1);
}
