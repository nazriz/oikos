//! Faults the independent review of the foundations found (runs/review-foundations-2026-10-16.md), each with the test that
//! failed before its fix. One test per finding, named for it.

use crate::common;

use common::*;
use oikos_kernel::events::EventBody;
use oikos_kernel::kernel::Command;
use oikos_kernel::run::Run;
use oikos_kernel::state::ParticipantStatus;
use serde_json::{json, Value};

type R = Run<Vec<u8>>;
const DAY: i64 = 86_400;

fn cmd_by(participant: &str, position: Option<&str>, blocks: Value, by: &[&str]) -> Command {
    Command::Act {
        participant: participant.into(),
        position: position.map(String::from),
        blocks: serde_json::from_value(blocks).expect("the blocks parse"),
        by: by.iter().map(|s| s.to_string()).collect(),
        provenance: json!({"via": "direct"}),
        reasoning: None,
        thinking: None,
    }
}

fn cmd(participant: &str, position: Option<&str>, blocks: Value) -> Command {
    cmd_by(participant, position, blocks, &[])
}

fn start(config: Value) -> R {
    Run::start(config, "fixes", Vec::new(), None).unwrap()
}

/// The code an act was refused with, or None if it took effect (carried to its end).
fn outcome(run: &mut R, c: &Command) -> Option<String> {
    let r = step(run, c).expect("the command is accepted");
    r.events.iter().find_map(|e| match &e.body {
        EventBody::ActionRefused { code, .. } => Some(serde_json::to_value(code).unwrap().as_str().unwrap().to_string()),
        _ => None,
    })
}

fn said(code: Option<String>) -> String {
    code.unwrap_or_else(|| "applied".into())
}

/// The F5 fixture: alice's `clerk-seat` (sharing her body) holds the `clerk` post beside her own participant.
fn seated() -> Value {
    let mut c = world(&default_params());
    let alice = c["participants"].as_array().unwrap().iter().find(|p| p["id"] == "alice-self").unwrap().clone();
    let mut seat = alice.clone();
    seat["id"] = json!("clerk-seat");
    seat["shares_body"] = json!(true);
    seat["channels"] = json!([]);
    c["participants"].as_array_mut().unwrap().push(seat);
    c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "clerk").unwrap()["holder"] = json!("clerk-seat");
    c
}

fn kill(run: &mut R, who: &str) {
    for i in 0..400 {
        if !run.kernel().state().body(who).unwrap().alive {
            return;
        }
        step(run, &cmd("bob-self", None, json!([{"block": "harm", "person": who}])));
        run.command(&Command::Advance { to: (i + 1) * DAY }).unwrap();
    }
    panic!("{who} did not die");
}

/// Finding 1: a model's seat ends with the person it acts through; its post falls vacant.
#[test]
fn f1_a_seat_ends_with_the_person_it_acts_through() {
    let mut run = start(seated());
    kill(&mut run, "alice");
    let st = run.kernel().state();
    assert_eq!(st.participants["alice-self"].status, ParticipantStatus::Ended);
    assert_eq!(st.participants["clerk-seat"].status, ParticipantStatus::Ended, "the seat outlived the person");
    assert_eq!(st.positions["clerk"].holder, None, "the post stayed with the dead person's seat");
    let say = cmd("clerk-seat", Some("clerk"), json!([{"block": "message", "to": ["bob-self"], "text": "from the grave"}]));
    assert_ne!(outcome(&mut run, &say), None, "the dead person's seat acted");
}

/// Finding 3: a system works for the organisation that owns it, and for none other.
#[test]
fn f3_a_system_is_not_appointed_to_an_organisation_that_does_not_own_it() {
    let mut run = start(world(&default_params()));
    let appoint = cmd("mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": "outside-system"}]));
    assert_eq!(said(outcome(&mut run, &appoint)), "not_theirs");
    assert_eq!(run.kernel().state().positions["clerk"].holder, None);
    // The city's own system is appointable.
    let own = cmd("mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": "finance-system"}]));
    assert_eq!(said(outcome(&mut run, &own)), "applied");
}

/// Finding 3, at load: a world whose post is held by another organisation's system does not load.
#[test]
fn f3_a_world_whose_post_is_held_by_anothers_system_does_not_load() {
    let mut c = world(&default_params());
    c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "clerk").unwrap()["holder"] = json!("outside-system");
    let err = Run::start(c, "fixes", Vec::new(), None).err().expect("loaded");
    assert!(format!("{err}").contains("belongs to"), "{err}");
}

/// An employment agreement both have signed.
fn employ(run: &mut R, employer: &str, by: &str, position: Option<&str>, worker: &str) {
    let propose = cmd(by, position, json!([{"block": "propose_agreement", "terms": {"parties": [employer, worker], "commitments": [{"who": employer, "does": {"outcome": {"money": {"to": format!("acc-{worker}"), "amount": "100"}}}, "every": 2_592_000}]}, "speaks_for": employer}]));
    step(run, &propose).expect("accepted");
    let id = run.kernel().state().record_order.iter().rev().find(|id| run.kernel().state().records[*id].record.body.kind_name() == "agreement").cloned().expect("an agreement");
    step(run, &cmd(&format!("{worker}-self"), None, json!([{"block": "sign_agreement", "agreement": id, "as": worker}]))).expect("accepted");
    step(run, &cmd(by, position, json!([{"block": "sign_agreement", "agreement": id, "as": employer}]))).expect("accepted");
}

fn hi() -> Value {
    json!([{"block": "message", "to": ["bob-self"], "text": "hi"}])
}

/// Finding 5: `by` names someone the actor may direct: itself, its own systems, its staff by contract or in its posts.
#[test]
fn f5_by_names_only_someone_the_actor_may_direct() {
    let mut run = start(world(&default_params()));
    let by_carol = cmd_by("developer-system", Some("developer"), hi(), &["carol"]);
    assert_eq!(said(outcome(&mut run, &by_carol)), "not_theirs", "a stranger's hours were taken");
    assert!(run.kernel().state().timelines.get("carol").is_none_or(|t| t.iter().all(|&x| x <= 0)), "carol was charged");
    employ(&mut run, "devco", "developer-system", Some("developer"), "carol");
    assert_eq!(said(outcome(&mut run, &by_carol)), "applied", "its employee");
    let by_alice = cmd_by("developer-system", Some("developer"), hi(), &["alice"]);
    assert_eq!(said(outcome(&mut run, &by_alice)), "not_theirs", "carol's employment is not alice's");
    // Its own system, and a person who holds one of its posts, may be directed.
    let by_system = cmd_by("developer-system", Some("developer"), hi(), &["developer-system"]);
    assert_eq!(said(outcome(&mut run, &by_system)), "applied");
    step(&mut run, &cmd("mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": "alice-self"}]))).unwrap();
    let by_clerk = cmd_by("mayor-system", Some("mayor"), hi(), &["alice"]);
    assert_eq!(said(outcome(&mut run, &by_clerk)), "applied", "a holder of the city's post");
    // A system of another organisation is not its to direct.
    let by_other = cmd_by("developer-system", Some("developer"), hi(), &["builder-system"]);
    assert_eq!(said(outcome(&mut run, &by_other)), "not_theirs");
}

/// Finding 8: each performer is charged their own row's time for the work, whoever ordered it.
#[test]
fn f8_each_performer_is_charged_their_own_time() {
    let mut c = world(&default_params());
    c["orchestration"]["act_time"] = json!({"default": 1, "person": {"message": 2_400}, "system": {"message": 1}});
    let mut run = start(c);
    employ(&mut run, "devco", "developer-system", Some("developer"), "carol");
    // A system names a person: the person is charged the person's 2,400 s, not the system's 1 s.
    let m = cmd_by("developer-system", Some("developer"), hi(), &["carol"]);
    let Command::Act { .. } = &m else { unreachable!() };
    let before = run.kernel().state().timelines.get("carol").map_or(0, |t| t.iter().copied().max().unwrap_or(0));
    let r = run.command(&m).unwrap();
    let (starts, done) = r.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { starts, done, .. } => Some((*starts, *done)), _ => None }).unwrap();
    assert_eq!(done - starts, 2_400, "carol did it: a person's row");
    assert!(run.kernel().state().timelines["carol"].iter().copied().max().unwrap() >= before + 2_400);
    // A person names a system of the organisation: the system is charged its own row (1 s), not the person's.
    step(&mut run, &cmd("mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": "alice-self"}]))).unwrap();
    let m = cmd_by("alice-self", Some("clerk"), hi(), &["mayor-system"]);
    let r = run.command(&m).unwrap();
    let (starts, done) = r.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { starts, done, .. } => Some((*starts, *done)), _ => None }).unwrap();
    assert_eq!(done - starts, 1, "the system did it: its template's row, not the person's 2,400 s");
}

/// Finding 2: work the dry run at order time could not place (a performer who is not there until later) takes effect only
/// when its performers' hours are spent, not a second after the order.
#[test]
fn f2_work_that_could_not_be_checked_when_ordered_takes_effect_after_its_hours() {
    let mut c = world(&default_params());
    c["orchestration"]["act_time"] = json!({"default": 1, "person": {"occupy": 100, "vacate": 1}, "system": {"message": 200, "work": 1}});
    let mut run = start(c);
    let goods = |run: &R| run.kernel().state().holding("devco", "s-shop", "goods");
    // Carol leaves the shop, and starts back (she is there from t=102); the developer is busy for 200 s, then orders her work
    // at t=2, when she is not there: a dry run at the order refuses it.
    run.command(&cmd("carol-self", None, json!([{"block": "vacate", "occupant": "carol", "from": "s-shop"}]))).unwrap();
    run.command(&Command::Advance { to: 2 }).unwrap();
    assert!(run.kernel().state().structures_of("carol").is_empty());
    run.command(&cmd("carol-self", None, json!([{"block": "occupy", "space": "s-shop/workplace.1", "who": "carol"}]))).unwrap();
    run.command(&cmd("developer-system", Some("developer"), hi())).unwrap();
    let make = cmd("developer-system", Some("developer"), json!([{"block": "work", "task": "make", "units": 4, "at": "s-shop", "performers": ["carol"]}]));
    let before = goods(&run);
    let r = run.command(&make).unwrap();
    let done = r.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { done, .. } => Some(*done), _ => None }).unwrap();
    assert!(done < 300, "ordered behind the developer's other time: done at {done}");
    run.command(&Command::Advance { to: done + 60 }).unwrap();
    assert_eq!(goods(&run), before, "the output landed a minute after the order, before its two hours were spent");
    run.command(&Command::Advance { to: done + 4 * 1_800 + 100 }).unwrap();
    assert!(goods(&run) > before, "and it lands when they are spent");
    // The hours are carol's, from when the work could begin.
    assert!(run.kernel().state().timelines["carol"].iter().copied().max().unwrap() >= done + 4 * 1_800);
}

fn make16() -> Command {
    // Sixteen units at 1,800 s: eight hours of carol's, the whole of a working day.
    cmd("developer-system", Some("developer"), json!([{"block": "work", "task": "make", "units": 16, "at": "s-shop", "performers": ["carol"]}]))
}

fn code_of(r: &oikos_kernel::run::Response) -> Option<String> {
    r.events.iter().find_map(|e| match &e.body {
        EventBody::ActionRefused { code, .. } => Some(serde_json::to_value(code).unwrap().as_str().unwrap().to_string()),
        _ => None,
    })
}

/// Finding 9a: work refused when it is done, after its performers' lanes were held for its hours, was given back to the
/// day; so a crew could be given another full day's work on the same day. The hours were spent: they count.
#[test]
fn f9_work_refused_at_its_end_still_counts_against_the_day() {
    let mut run = start(world(&default_params()));
    run.command(&make16()).unwrap();
    // The developer sends the materials away before the work ends: it is refused when done.
    run.command(&cmd("developer-system", Some("developer"), json!([{"block": "move_goods", "kind": "materials", "quantity": "1000", "from_at": "s-shop", "to": "alice", "to_at": "s-house"}]))).unwrap();
    let r = run.command(&Command::Advance { to: 8 * 3600 + 10 }).unwrap();
    assert_eq!(code_of(&r).as_deref(), Some("insufficient_quantity"), "{:?}", r.events);
    // The same day (carol's eight hours are gone): the developer cannot have another day's work from her.
    run.command(&cmd("alice-self", None, json!([{"block": "move_goods", "kind": "materials", "quantity": "1000", "from_at": "s-house", "to": "devco", "to_at": "s-shop"}]))).ok();
    let again = run.command(&make16());
    let r = run.command(&Command::Advance { to: 8 * 3600 + 20 }).unwrap();
    let refused = again.ok().and_then(|a| code_of(&a)).or_else(|| code_of(&r));
    assert_eq!(refused.as_deref(), Some("no_time_left"), "a second full day's work on the same day");
}

/// Finding 9b: work that runs past midnight is counted on each day it is done on, not all on the day it began.
#[test]
fn f9_work_past_midnight_counts_on_the_next_day() {
    let mut run = start(world(&default_params()));
    run.command(&Command::Advance { to: 20 * 3600 }).unwrap();
    // Eight hours from 20:00: four on this day, four on the next.
    let r = run.command(&make16()).unwrap();
    assert!(r.events.iter().any(|e| matches!(e.body, EventBody::ActionStarted { .. })), "{:?}", r.events);
    // Six hours more at once: the next day has four used, and six more is over its eight.
    let six = cmd("developer-system", Some("developer"), json!([{"block": "work", "task": "make", "units": 12, "at": "s-shop", "performers": ["carol"]}]));
    let r = run.command(&six).unwrap();
    let r2 = run.command(&Command::Advance { to: 20 * 3600 + 20 }).unwrap();
    assert!(code_of(&r).or_else(|| code_of(&r2)).as_deref() == Some("no_time_left"), "{:?} {:?}", r.events, r2.events);
}

/// Finding 9c: work placed on an earlier day than one already counted does not wipe that day's count.
#[test]
fn f9_a_later_days_count_survives_work_placed_on_an_earlier_day() {
    let mut tl = oikos_kernel::state::Timeline::default();
    tl.add_worked(5, 20_000);
    tl.add_worked(4, 3_000);
    assert_eq!((tl.worked_on(5), tl.worked_on(4)), (20_000, 3_000));
    tl.add_worked(5, 4_000);
    tl.add_worked(4, -1_000);
    assert_eq!((tl.worked_on(5), tl.worked_on(4)), (24_000, 2_000));
}

/// Finding 6: a post's constitution may name who else fills it (an owner, a board, the council): that authority's own act
/// appoints into it, and nobody else's does.
#[test]
fn f6_the_authority_a_post_names_may_appoint_into_it() {
    let appoint = |by: (&str, &str)| cmd(by.0, Some(by.1), json!([{"block": "appoint", "position": "clerk", "participant": "alice-self"}]));
    // Without a constitution naming devco, devco's system may not fill the city's clerk post.
    let mut run = start(world(&default_params()));
    assert_eq!(said(outcome(&mut run, &appoint(("developer-system", "developer")))), "not_theirs");
    // With it, it may; the city still may, and a third body still may not.
    let mut c = world(&default_params());
    c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "clerk").unwrap()["appointed_by"] = json!("devco");
    let mut run = start(c);
    assert_eq!(said(outcome(&mut run, &appoint(("builder-system", "builder")))), "not_theirs");
    assert_eq!(said(outcome(&mut run, &appoint(("developer-system", "developer")))), "applied");
    assert_eq!(run.kernel().state().positions["clerk"].holder.as_deref(), Some("alice-self"));
    assert_eq!(said(outcome(&mut run, &appoint(("mayor-system", "mayor")))), "applied");
    // An authority that is no entity does not load.
    let mut bad = world(&default_params());
    bad["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "clerk").unwrap()["appointed_by"] = json!("nobody");
    assert!(Run::start(bad, "fixes", Vec::new(), None).is_err());
}
