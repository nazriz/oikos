//! Law 10, capacity for every doer, systems included (docs/design/foundations-2.md section 4; steps P1 and P2): a system
//! template's own rows are what its acts take, before the world's one table for systems; a template's `hours` are when its
//! lanes work, and work coming faster than they take it is a queue, never a refusal; an act nobody priced is refused
//! (`unpriced`), where it once took a second; and someone who only orders an act is not held until it is done.

use crate::common;

use common::*;
use oikos_kernel::events::EventBody;
use oikos_kernel::kernel::Command;
use oikos_kernel::run::Run;
use serde_json::{json, Value};

type R = Run<Vec<u8>>;

const H: i64 = 3_600;
const DAY: i64 = 86_400;

fn cmd(participant: &str, position: Option<&str>, blocks: Value, by: &[&str]) -> Command {
    Command::Act {
        participant: participant.into(),
        position: position.map(Into::into),
        blocks: serde_json::from_value(blocks).expect("the blocks parse"),
        by: by.iter().map(|s| s.to_string()).map(Into::into).collect(),
        provenance: json!({"via": "direct"}),
        reasoning: None,
        thinking: None,
    }
}

/// The test world with the finance office's system made from the clerk-bot template, which `f` may give rows and hours.
fn town(f: impl FnOnce(&mut Value)) -> R {
    let mut c = world(&default_params());
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "finance-system" {
            p["template"] = json!("clerk-bot");
        }
    }
    let t = c["templates"].as_array_mut().unwrap().iter_mut().find(|t| t["id"] == "clerk-bot").unwrap();
    let mut does = all_blocks();
    does.as_array_mut().unwrap().push(json!({"block": "publish", "kind": "benefit_decision", "seconds": 4_500}));
    t["does"] = does;
    f(&mut c);
    Run::start(c, "capacity", Vec::new(), None).unwrap()
}

fn clerk_bot(c: &mut Value) -> &mut Value {
    c["templates"].as_array_mut().unwrap().iter_mut().find(|t| t["id"] == "clerk-bot").unwrap()
}

fn begun(run: &mut R, c: &Command) -> (i64, i64) {
    match &run.command(c).unwrap().events[0].body {
        EventBody::ActionStarted { starts, done, .. } => (*starts, *done),
        other => panic!("{other:?}"),
    }
}

/// An act carried to its end: the refusal's code and detail, or None if it took effect.
fn refused(run: &mut R, c: &Command) -> Option<(String, String)> {
    let r = step(run, c).expect("the command is accepted");
    r.events.iter().find_map(|e| match &e.body {
        EventBody::ActionRefused { code, detail, .. } => { Some((serde_json::to_value(code).unwrap().as_str().unwrap().to_string(), detail.clone().unwrap_or_default()))}
        _ => None,
    })
}

fn decide() -> Value {
    json!([{"block": "publish", "kind": "benefit_decision", "text": "Claim c1 granted."}])
}

fn notice() -> Value {
    json!([{"block": "publish", "kind": "notice", "text": "A notice."}])
}

#[test]
fn a_templates_own_row_is_what_its_act_takes_and_the_worlds_table_stands_for_the_rest() {
    let mut run = town(|_| {});
    // The finance office's system is a clerk-bot: its own row for a decision, an officer's hour and a quarter.
    let (s, d) = begun(&mut run, &cmd("finance-system", Some("finance"), decide(), &[]));
    assert_eq!(d - s, 4_500, "the template's row for what is made");
    // What its template does not price is the world's: here the test world's stated default, a second.
    let (s, d) = begun(&mut run, &cmd("finance-system", Some("finance"), notice(), &[]));
    assert_eq!(d - s, 1);
    // Another system, of another template, decides at the world's row.
    let (s, d) = begun(&mut run, &cmd("mayor-system", Some("mayor"), decide(), &[]));
    assert_eq!(d - s, 1);
}

#[test]
fn a_systems_lanes_work_inside_its_hours_and_a_backlog_is_a_queue() {
    let mut run = town(|c| clerk_bot(c)["hours"] = json!({"from": 9 * H, "seconds": 8 * H}));
    // Asked at midnight: begun when the office opens.
    assert_eq!(begun(&mut run, &cmd("finance-system", Some("finance"), decide(), &[])), (9 * H, 9 * H + 4_500));
    // Nine more, all at once, on its one lane: one after another, each inside the hours, the seventh and later carried to the
    // next day, and none refused.
    let spans: Vec<(i64, i64)> = (0..9).map(|_| begun(&mut run, &cmd("finance-system", Some("finance"), decide(), &[]))).collect();
    let mut prev = 9 * H + 4_500;
    for (s, d) in &spans {
        assert!(*s >= prev, "a lane does one thing at a time: {spans:?}");
        let into = s.rem_euclid(DAY);
        assert!((9 * H..17 * H).contains(&into), "begun outside the hours at {s}: {spans:?}");
        prev = *d;
    }
    // Ten decisions of 4,500 s are 12.5 hours of work: a day's eight, and four and a half the next day.
    assert_eq!(spans.last().unwrap().1, DAY + 9 * H + (45_000 - 8 * H));
    run.command(&Command::Advance { to: 2 * DAY }).unwrap();
    let decided = run.kernel().state().records.values().filter(|r| r.record.body.kind_name() == "statement" && serde_json::to_value(&r.record).unwrap()["kind"] == "benefit_decision").count();
    assert_eq!(decided, 10, "every decision was made, the backlog queued");
}

#[test]
fn an_act_nobody_priced_is_refused_and_takes_nobodys_time() {
    // A world that states no default: a person's message is priced, nothing else is.
    let mut run = town(|c| c["orchestration"]["act_time"] = json!({"person": {"message": 60}}));
    let say = cmd("alice-self", None, json!([{"block": "message", "to": ["bob-self"], "text": "hi"}]), &[]);
    let (code, detail) = refused(&mut run, &cmd("alice-self", None, notice(), &[])).expect("refused");
    assert_eq!(code, "unpriced");
    assert!(detail.contains("publish/notice") && detail.contains("alice-self"), "the reason names what and whose: {detail}");
    // Nobody's time was taken: her next act begins now.
    let now = run.kernel().state().t;
    assert_eq!(begun(&mut run, &say), (now, now + 60));
    // A system's act its template does not price, in a world whose table has no row for systems, is refused too...
    let (code, _) = refused(&mut run, &cmd("mayor-system", Some("mayor"), notice(), &[])).expect("refused");
    assert_eq!(code, "unpriced");
    // ...and one its template prices is not: the template's row is a price.
    assert_eq!(refused(&mut run, &cmd("finance-system", Some("finance"), decide(), &[])), None);
    // A performer named in `by` whom nobody priced: refused, and the one who asked is not charged.
    let (code, detail) = refused(&mut run, &cmd("mayor-system", Some("mayor"), notice(), &["finance-system"])).expect("refused");
    assert_eq!((code.as_str(), detail.contains("finance-system")), ("unpriced", true), "{detail}");
}

#[test]
fn someone_who_only_orders_an_act_gives_the_order_and_goes_on() {
    let mut run = town(|c| clerk_bot(c)["hours"] = json!({"from": 9 * H, "seconds": 8 * H}));
    // The mayor's system asks the finance office's (the city's own) to decide a claim: the decision is the clerk-bot's, in
    // its hours; the mayor's system is free a second after it asked.
    let r = run.command(&cmd("mayor-system", Some("mayor"), decide(), &["finance-system"])).unwrap();
    let EventBody::ActionStarted { starts, done, free, .. } = &r.events[0].body else { panic!("{:?}", r.events) };
    assert_eq!((*starts, *done), (9 * H, 9 * H + 4_500));
    assert_eq!(*free, Some(1), "the order took the mayor's system a second, at once");
    let (s, _) = begun(&mut run, &cmd("mayor-system", Some("mayor"), notice(), &[]));
    assert!(s < 9 * H, "the mayor's system was held until the work began: next act at {s}");
}

#[test]
fn hours_are_a_systems_and_within_the_day() {
    let mut c = world(&default_params());
    clerk_bot(&mut c)["hours"] = json!({"from": 9 * H, "seconds": 25 * H});
    assert!(Run::start(c, "capacity", Vec::new(), None).is_err(), "a window longer than the day");
    let mut c = world(&default_params());
    c["templates"].as_array_mut().unwrap().iter_mut().find(|t| t["id"] == "newcomer").unwrap()["hours"] = json!({"from": 9 * H, "seconds": 8 * H});
    assert!(Run::start(c, "capacity", Vec::new(), None).is_err(), "a person's template has no hours");
}
