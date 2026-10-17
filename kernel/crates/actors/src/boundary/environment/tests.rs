//! city.environment alone, with its staff, the budget and the land scripted (docs/port-guide.md section 4):
//! environment.ts's behaviour, rewritten to assert it. The surveys' results are fed back as the world would give them.

use super::*;
use crate::market::testkit::{channels, ctx, records, statement, Harness};
use crate::steps::Done;
use crate::{Draws, WorldInfo};
use oikos_sight::calls::program_text;
use oikos_sight::{Outcome, View};
use serde_json::json;

const ME: &str = "env";
const H: i64 = 3600;

fn params(extra: Value) -> Value {
    let mut p = json!({
        "depot": "depot-1", "workplace": "depot-1-floor", "planning": "planning", "lots": "lots",
        "wage": 120_000, "period": 14 * DAY, "survey_labour": 7200, "work_days": 7, "sample_cells": 8,
        "species": [
            { "id": "frog", "name": "green frog", "covers": ["wetland"], "listed": true },
            { "id": "heron", "name": "heron", "covers": ["wetland", "reeds"] },
        ],
    });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        p[k] = v;
    }
    p
}

fn map(areas: Value) -> Value {
    statement("rec.map", 0, ME, "habitat_map", &[], json!({ "areas": areas, "built": [] }))
}

/// A budget whose environment line pays for `staff` people.
fn budget(staff: i64) -> Value {
    let annual = 120_000 * (365 * DAY) / (14 * DAY);
    statement("rec.budget", 0, "council", "budget", &[], json!({ "year": 1, "lines": { "environment": annual * staff } }))
}

fn depot(workers: &[&str]) -> Value {
    json!({ "town": { "kind": "sites", "as_of": 0, "cells": [{ "cell": "cell.1.1", "x": 1, "y": 1, "structure": {
        "structure": "depot-1", "type": "depot", "at": "cell.1.1", "w": 1, "h": 1, "complete": true,
        "spaces": [{ "space": "depot-1-floor", "kind": "workplace", "capacity": 6, "count": workers.len(), "occupants": workers }] } }] } })
}

fn employment(id: &str, worker: &str) -> Vec<Value> {
    let wid = format!("{id}-b");
    vec![
        json!({ "id": id, "record": "agreement", "author": "env-system", "at": 0, "visible_to": [ME, worker], "terms": { "template": "employment", "parties": [ME, worker],
            "text": format!("{worker} works for {ME} as environmental scientist for $1,200.00 every 14 days."),
            "commitments": [{ "who": ME, "does": { "outcome": { "money": { "to": format!("acc-{worker}"), "amount": "120000", "for": "Wages." } } }, "every": 14 * DAY },
                            { "who": worker, "does": { "outcome": { "work": { "at": "depot-1-floor" } } } }] } }),
        json!({ "id": format!("{id}-a"), "record": "signature", "author": "env-system", "at": 0, "visible_to": [ME, worker], "agreement": id, "as": ME }),
        json!({ "id": wid, "record": "signature", "author": format!("{worker}-self"), "at": 0, "visible_to": [ME, worker], "agreement": id, "as": worker }),
    ]
}

fn world(workers: &[&str], budget_staff: i64, extra: Vec<Value>) -> Value {
    let mut recs = vec![map(json!([{ "cover": "wetland", "x": 0, "y": 0, "w": 5, "h": 4 }])), budget(budget_staff)];
    for (i, w) in workers.iter().enumerate() {
        recs.extend(employment(&format!("emp{i}"), w));
    }
    recs.extend(extra);
    channels(vec![records("mine", recs), depot(workers)])
}

/// A driver that wakes the plan directly, so that a survey's result can be handed back as the world would.
struct Drive {
    office: Office,
    ctx: crate::Ctx,
    draws: Draws,
    view: View,
    outcomes: Vec<Value>,
}

impl Drive {
    fn new(extra: Value) -> Drive {
        let ctx = ctx(ME, params(extra));
        let office = Office::new(&ctx, Params::read(&ctx).expect("params"));
        let draws = Draws::new(&ctx.participant, "self");
        Drive { office, ctx, draws, view: View::default(), outcomes: vec![] }
    }
    /// Wake at `t`, handing in the outcomes queued; returns the steps planned.
    fn wake(&mut self, t: i64, chans: Value) -> Vec<Step<Then>> {
        let obs = serde_json::from_value(json!({ "participant": self.ctx.participant, "t": t, "status": "active", "outcomes": std::mem::take(&mut self.outcomes),
            "inbox": [], "drafts": [], "channels": chans }))
        .expect("an observation");
        let pic = self.view.apply(obs, None, ME, "cadence", 0);
        let mut cx = crate::Cx::new(t, &self.ctx, &mut self.draws, 11, vec![]);
        self.office.absorb(&pic, &mut cx);
        self.office.plan(&pic, &mut cx)
    }
    /// Answer a step applied.
    fn applied(&mut self, st: &Step<Then>, created: Value, t: i64) {
        let o: Outcome = serde_json::from_value(json!({ "action": "a", "t": t, "status": "applied", "created": created })).unwrap();
        let mut cx = crate::Cx::new(t, &self.ctx, &mut self.draws, 11, vec![]);
        if let Some(tok) = &st.then {
            self.office.then(tok, Done::Outcome(&o), &mut cx);
        }
    }
    /// Queue the world's answer to a survey: `found(cell)` of the species in each cell.
    fn surveyed(&mut self, st: &Step<Then>, t: i64, found: impl Fn(&str) -> i64) {
        let Some(Then::Survey { species, cells, .. }) = &st.then else { panic!("not a survey") };
        let cs: serde_json::Map<String, Value> = cells.iter().map(|c| (c.clone(), json!(found(c)))).collect();
        self.outcomes.push(json!({ "action": "s", "t": t, "status": "applied", "surveyed": { "of": species, "cells": cs } }));
    }
}

fn text_of(steps: &[Step<Then>]) -> String {
    steps.iter().map(|s| program_text(&s.program())).collect::<Vec<_>>().join("\n")
}

fn surveys(steps: &[Step<Then>]) -> Vec<&Step<Then>> {
    steps.iter().filter(|s| matches!(s.then, Some(Then::Survey { .. }))).collect()
}

#[test]
fn the_manifest_is_the_ts_manifest_and_its_answers() {
    let m = Environment.manifest();
    assert_eq!(m["name"], "city.environment");
    assert_eq!(m["version"], "0.5.2");
    assert!(m["params"]["depot"]["required"] == json!(true));
    assert_eq!(m["answers"]["office"], "the environment office");
    assert!(m["takes"].as_array().is_some_and(|t| !t.is_empty()));
}

#[test]
fn it_posts_the_jobs_its_budget_line_pays_for_and_hires_an_applicant() {
    let mut h = Harness::new(&Environment, ME, params(json!({})));
    let out = h.wake(2 * DAY + 9 * H, world(&[], 2, vec![])).join("\n");
    assert!(out.contains("job_posting") && out.contains("environmental scientist"), "{out}");
    // An applicant for the standing posting is offered the job.
    let post = statement("rec.post", DAY, ME, "job_posting", &[], json!({ "wage": 120_000, "period": 14 * DAY, "role": "environmental scientist" }));
    let app = statement("rec.app", DAY + 100, "ann", "job_application", &[ME], json!({ "posting": "rec.post", "account": "acc-ann" }));
    let out = h.wake(3 * DAY + 9 * H, world(&[], 2, vec![post, app])).join("\n");
    assert!(out.contains("employment") && out.contains("ann"), "{out}");
    assert!(out.contains("withdraw=rec.post"), "the filled posting comes down: {out}");
}

#[test]
fn it_does_not_post_without_a_budget_nor_beyond_what_the_line_pays() {
    let mut h = Harness::new(&Environment, ME, params(json!({})));
    let none = channels(vec![records("mine", vec![map(json!([]))]), depot(&[])]);
    assert!(!h.wake(2 * DAY + 9 * H, none).join("\n").contains("job_posting"), "no adopted budget, no posts");
    let mut h = Harness::new(&Environment, ME, params(json!({})));
    let out = h.wake(2 * DAY + 9 * H, world(&["w1", "w2"], 2, vec![])).join("\n");
    assert!(!out.contains("job_posting"), "two staff, two paid for: {out}");
}

#[test]
fn a_budget_that_pays_for_fewer_lets_one_go() {
    let mut h = Harness::new(&Environment, ME, params(json!({})));
    let out = h.wake(30 * DAY + 9 * H, world(&["w1", "w2"], 1, vec![])).join("\n");
    assert!(out.contains("notice") && out.contains("emp"), "{out}");
}

#[test]
fn a_direction_not_to_recruit_stops_the_posting_and_is_acknowledged() {
    // The town's rule names who may direct its offices; a direction on the office's staffing form says not to recruit.
    let rule = statement("rec.rule", 0, "council", "procedure", &[], json!({ "directions": { "by": ["mayor"] } }));
    let form = statement("rec.form", 0, "council", "form", &[ME], json!({ "form": "environment_staffing" }));
    let mut dir = statement("rec.dir", DAY, "mayor", "direction", &[ME], json!({ "recruit": "no" }));
    dir["in_position"] = json!("mayor");
    dir["basis"] = json!("rec.form");
    let mut up = Drive::new(json!({ "directed_under": "rec.rule" }));
    let plain = up.wake(2 * DAY + 9 * H, world(&[], 2, vec![rule.clone(), form.clone()]));
    assert!(text_of(&plain).contains("job_posting"), "undirected, it posts");
    let mut d = Drive::new(json!({ "directed_under": "rec.rule" }));
    let post = statement("rec.post", DAY, ME, "job_posting", &[], json!({ "wage": 120_000, "period": 14 * DAY, "role": "environmental scientist" }));
    let steps = d.wake(2 * DAY + 9 * H, world(&[], 2, vec![rule, form, dir, post]));
    let t = text_of(&steps);
    assert!(!t.contains("kind=job_posting"), "told not to recruit: {t}");
    assert!(t.contains("withdraw=rec.post"), "its advertisement comes down: {t}");
    assert!(t.contains("your direction rec.dir is received"), "the writer is told what the office does: {t}");
}

#[test]
fn a_survey_round_sends_the_surveyors_over_a_sample_of_habitat_within_their_hours() {
    // Two surveyors, 8 hours each, 2 hours a cell: eight cells a day. The wetland is 20 cells; the sample is at most 8.
    let mut d = Drive::new(json!({ "sample_cells": 30 }));
    let w = world(&["w1", "w2"], 2, vec![]);
    let t0 = 31 * DAY + 9 * H;
    let day1 = d.wake(t0, w.clone());
    let s1 = surveys(&day1);
    assert!(!s1.is_empty(), "{}", text_of(&day1));
    let sent: usize = s1.iter().map(|s| if let Some(Then::Survey { cells, .. }) = &s.then { cells.len() } else { 0 }).sum();
    assert_eq!(sent, 8, "as many cells as two people's hours allow: {}", text_of(&day1));
    let t = text_of(&day1);
    assert!(t.contains("task=survey") && t.contains("at=depot-1") && t.contains("w1") && t.contains("w2"), "{t}");
    assert!(t.contains("survey=frog"), "the first species is surveyed first: {t}");
    // Again the same day: their hours are used up.
    let again = d.wake(t0 + H, w.clone());
    assert!(surveys(&again).is_empty(), "no more cells today: {}", text_of(&again));
    // The next day, eight more.
    let day2 = d.wake(t0 + DAY, w);
    let sent2: usize = surveys(&day2).iter().map(|s| if let Some(Then::Survey { cells, .. }) = &s.then { cells.len() } else { 0 }).sum();
    assert_eq!(sent2, 8, "{}", text_of(&day2));
}

#[test]
fn a_sample_is_only_habitat_of_the_species_and_never_built_on_ground() {
    let mut d = Drive::new(json!({ "sample_cells": 100, "species": [{ "id": "frog", "name": "frog", "covers": ["wetland"], "listed": true }] }));
    let built = statement("rec.bn", 5, "council", "building_notice", &[], json!({ "at": "cell.0.0" }));
    let w = channels(vec![records("mine", vec![map(json!([{ "cover": "wetland", "x": 0, "y": 0, "w": 2, "h": 2 }, { "cover": "grass", "x": 1, "y": 1, "w": 1, "h": 1 }])), budget(2), built]), depot(&[])]);
    d.wake(2 * DAY, w.clone());
    let _ = d.wake(31 * DAY, w);
    let queued: Vec<&String> = d.office.queue.iter().flat_map(|(_, c)| c.iter()).collect();
    assert_eq!(queued.len(), 2, "a 2x2 map, one cell grassed over and one built on: {queued:?}");
    assert!(queued.iter().all(|c| *c == "cell.1.0" || *c == "cell.0.1"));
}

#[test]
fn a_refused_survey_goes_back_in_the_queue_and_the_crew_is_spent_for_the_day() {
    let mut d = Drive::new(json!({}));
    let w = world(&["w1", "w2"], 2, vec![]);
    let steps = d.wake(31 * DAY + 9 * H, w);
    let s = surveys(&steps)[0].clone();
    let before = d.office.queue.len();
    let o: Outcome = serde_json::from_value(json!({ "action": "a", "t": 31 * DAY, "status": "refused", "refusal": { "code": "no_time_left", "detail": "w1 has 600 s of work left today" } })).unwrap();
    let mut cx = crate::Cx::new(31 * DAY, &d.ctx, &mut d.draws, 11, vec![]);
    d.office.then(s.then.as_ref().unwrap(), Done::Outcome(&o), &mut cx);
    assert!(d.office.queue.len() > before, "its cells are back to be done another day");
    assert_eq!(d.office.used.get("w1"), Some(&(8 * H - 600)));
}

#[test]
fn the_next_round_waits_for_the_results_then_publishes_an_assertion_and_a_register_of_lots() {
    let mut d = Drive::new(json!({ "species": [{ "id": "frog", "name": "green frog", "covers": ["wetland"], "listed": true }] }));
    // Two lots over the wetland's cells, so that a cell where frogs were found can be put on a lot.
    let lots = |ids: &[&str]| -> Vec<Value> {
        ids.iter().enumerate().map(|(i, c)| statement(&format!("lot.{i}"), 0, "registry", "lot", &[], json!({ "cells": [c] }))).collect()
    };
    let all_cells: Vec<String> = (0..5).flat_map(|x| (0..4).map(move |y| format!("cell.{x}.{y}"))).collect();
    let refs: Vec<&str> = all_cells.iter().map(String::as_str).collect();
    let w = |staff: &[&str]| world(staff, 2, lots(&refs));
    let t0 = 31 * DAY + 9 * H;
    let day1 = d.wake(t0, w(&["w1", "w2"]));
    let s = surveys(&day1)[0].clone();
    // Round one's results: a frog in every other cell.
    d.surveyed(&s, t0 + H, |c| i64::from(c.len() % 2 == 0) * 2);
    let mid = d.wake(t0 + 2 * H, w(&["w1", "w2"]));
    assert!(text_of(&mid).find("environment_report").is_none(), "round one's report is not due until the next round");
    assert_eq!(d.office.pending, 0);
    // A quarter later: the round is closed with a report and a register, then the next round begins.
    let t1 = t0 + 91 * DAY;
    let steps = d.wake(t1, w(&["w1", "w2"]));
    let txt = text_of(&steps);
    assert!(txt.contains("environment_report") && txt.contains("assertion"), "{txt}");
    assert!(txt.contains("green frog (listed as threatened)") && txt.contains("per 100 cells"), "{txt}");
    assert!(!txt.contains("since the last round"), "the first round has nothing to compare with: {txt}");
    assert!(txt.contains("habitat_register") && txt.contains("to=[\"planning\"]") && txt.contains("visible=public"), "{txt}");
    let reg = steps.iter().find(|s| matches!(s.then, Some(Then::Register))).expect("the register step");
    d.applied(reg, json!({ "register": "rec.900" }), t1);
    assert_eq!(d.office.register.as_deref(), Some("rec.900"));
    assert!(!d.office.recorded.is_empty(), "lots with a listed species are recorded");
    let first_lots = d.office.recorded.len();
    // Round two finds far fewer: the report flags the decline, and the new register withdraws the old.
    let s2 = surveys(&steps)[0].clone();
    d.surveyed(&s2, t1 + H, |c| i64::from(c.len() % 2 == 0));
    d.wake(t1 + 2 * H, w(&["w1", "w2"]));
    let steps = d.wake(t1 + 91 * DAY, w(&["w1", "w2"]));
    let txt = text_of(&steps);
    assert!(txt.contains("down 50% since the last round: a decline to watch"), "{txt}");
    assert!(txt.contains("withdraw=rec.900"), "the old register is superseded: {txt}");
    assert!(d.office.recorded.len() >= first_lots, "records accumulate, as an atlas's do");
}

#[test]
fn a_cell_with_no_known_lot_is_asked_of_the_land_registry_once() {
    let mut d = Drive::new(json!({ "species": [{ "id": "frog", "name": "frog", "covers": ["wetland"], "listed": true }] }));
    let w = world(&["w1", "w2"], 2, vec![]);
    let t0 = 31 * DAY + 9 * H;
    let day1 = d.wake(t0, w.clone());
    let s = surveys(&day1)[0].clone();
    d.surveyed(&s, t0 + H, |_| 1);
    d.wake(t0 + 2 * H, w.clone());
    let pic = {
        let obs = serde_json::from_value(json!({ "participant": d.ctx.participant, "t": t0 + 3 * H, "status": "active", "outcomes": [], "inbox": [], "drafts": [], "channels": w })).unwrap();
        d.view.apply(obs, None, ME, "cadence", 0)
    };
    let first = d.office.looks(&pic);
    assert_eq!(first.len(), 1, "one cell asked at a time");
    assert_eq!(first[0].channel, "lots");
    let second = d.office.looks(&pic);
    assert_eq!(second.len(), 1);
    assert_ne!(first[0].query.as_ref().unwrap().conditions, second[0].query.as_ref().unwrap().conditions, "each cell once");
    let mut none = Drive::new(json!({ "lots": "" }));
    assert!(none.office.looks(&pic).is_empty());
}

#[test]
fn percentages_round_half_up_and_print_as_javascript_does() {
    assert_eq!(round_div(250, 100), 3);
    assert_eq!(round_div(-250, 100), -2);
    assert_eq!(round_div(149, 100), 1);
    assert_eq!(percent_words(2000), "20");
    assert_eq!(percent_words(1250), "12.5");
    assert_eq!(percent_words(1205), "12.05");
    assert_eq!(percent_words(50), "0.5");
}

#[test]
fn it_saves_and_restores_mid_round_and_runs_the_same_on_both() {
    let mut h = Harness::new(&Environment, ME, params(json!({ "sample_cells": 30 })));
    let w = world(&["w1", "w2"], 2, vec![]);
    let day1 = h.wake(31 * DAY + 9 * H, w.clone());
    assert!(day1.join("\n").contains("task=survey"));
    h.save_and_restore();
    let mut twin = Harness::new(&Environment, ME, params(json!({ "sample_cells": 30 })));
    let t = twin.wake(31 * DAY + 9 * H, w.clone());
    assert_eq!(day1, t, "the same world gives the same acts");
    let a = h.wake(32 * DAY + 9 * H, w.clone());
    let b = twin.wake(32 * DAY + 9 * H, w);
    assert_eq!(a, b, "a restored office carries on as the one that never stopped");
    assert!(a.join("\n").contains("task=survey"), "the second day's cells");
}

#[test]
fn the_world_must_say_where_it_works_and_whom_it_tells() {
    let _ = WorldInfo::default();
    for missing in ["depot", "workplace", "planning"] {
        let mut p = params(json!({}));
        p[missing] = json!("");
        let c = ctx(ME, p);
        assert!(Environment.create(&c).is_err(), "{missing} is required");
    }
}
