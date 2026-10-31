//! The police station, as participants/test/police.test.ts held it (calls at homes, warrants) and beyond: a successor
//! carries on from the file; a tenant registered dead is not put out; the manifest is the TS module's.

use super::*;
use crate::{Draws, WorldInfo};
use oikos_sight::calls::program_text;
use oikos_sight::{Action, Record, Visit};
use std::sync::Arc;

pub(crate) const ME: &str = "police";

pub(crate) fn rec(v: Value) -> Arc<Record> {
    Arc::new(serde_json::from_value(v).expect("a record"))
}

pub(crate) fn st(id: &str, at: i64, kind: &str, speaks_for: &str, to: &[&str], data: Value) -> Arc<Record> {
    rec(json!({ "id": id, "record": "statement", "author": "p.1", "speaks_for": speaks_for, "at": at, "visible_to": "public",
        "kind": kind, "text": kind, "data": data, "addressed_to": to }))
}

pub(crate) fn ctx(params: Value) -> Ctx {
    Ctx {
        participant: "police-oic-system".into(),
        performer: Default::default(),
        entity: ME.into(),
        position: Some("police-oic".into()),
        params: params.as_object().unwrap().clone().into(),
        world: Arc::new(WorldInfo { tick: 60, run_end: 400 * DAY, ..Default::default() }),
    }
}

/// The genesis papers: one officer in post.
pub(crate) fn staff_records() -> Vec<Arc<Record>> {
    vec![
        rec(json!({ "id": "job-1", "record": "agreement", "author": "p.1", "at": 0, "visible_to": [ME, "officer-1"],
            "terms": { "template": "employment", "parties": [ME, "officer-1"], "commitments": [], "text": "officer-1 works for police as police officer for 3800.00 every 14 days." } })),
        rec(json!({ "id": "sig-1", "record": "signature", "author": "p.1", "at": 0, "visible_to": [ME], "agreement": "job-1", "as": ME })),
        rec(json!({ "id": "sig-2", "record": "signature", "author": "p.2", "at": 0, "visible_to": [ME], "agreement": "job-1", "as": "officer-1" })),
    ]
}

pub(crate) fn premises(occupants: &[&str]) -> Seen {
    let cell: oikos_sight::SiteCell = serde_json::from_value(json!({ "cell": "c0", "x": 0, "y": 0, "structure": { "structure": "station", "type": "station", "at": "c0", "w": 1, "h": 1, "complete": true,
        "spaces": [{ "space": "station/workplace.1", "kind": "workplace", "capacity": 10, "count": occupants.len(), "occupants": occupants }] } })).unwrap();
    Seen::Sites { as_of: 0, cells: Arc::new(vec![cell]), visit: None }
}

pub(crate) fn home(n: u32, occupants: &[&str], left: Value) -> oikos_sight::SiteCell {
    serde_json::from_value(json!({ "cell": format!("h{n}"), "x": n, "y": 0, "structure": { "structure": format!("house-{n}"), "type": "house", "at": format!("h{n}"), "w": 1, "h": 1, "complete": true,
        "spaces": [{ "space": format!("house-{n}/dwelling.1"), "kind": "dwelling", "capacity": 6, "count": occupants.len(), "occupants": occupants, "left": left }] } })).unwrap()
}

fn base_params() -> Value {
    json!({ "building": "station", "workplace": "station/workplace.1", "account": "acc-police", "officers": 1, "wage": 380000, "tribunal": "tribunal", "calls_channel": "calls", "registry": "city" })
}

/// Drives an actor wake by wake as the engine would: acts it sends are answered (applied unless `refuse` says no) at its
/// next step in the same moment.
pub(crate) struct Driver {
    pub actor: Box<dyn Actor>,
    ctx: Ctx,
    draws: Draws,
    n: u32,
}

pub(crate) struct Wake {
    pub calls: Vec<String>,
    pub looks: Vec<Value>,
}

impl Wake {
    pub fn of(&self, what: &str) -> Vec<&String> {
        self.calls.iter().filter(|c| c.contains(what)).collect()
    }
}

impl Driver {
    pub fn new(kind: &dyn Kind, ctx: Ctx) -> Driver {
        Driver { actor: kind.create(&ctx).unwrap(), draws: Draws::new("police-oic-system", "police-oic"), ctx, n: 0 }
    }
    pub fn restore(kind: &dyn Kind, ctx: Ctx, saved: Value) -> Driver {
        Driver { actor: kind.restore(&ctx, saved).unwrap(), draws: Draws::new("police-oic-system", "police-oic"), ctx, n: 0 }
    }

    pub fn wake(&mut self, t: i64, records: Vec<Arc<Record>>, extra: Vec<(&str, Seen)>, refuse: &dyn Fn(&str) -> bool) -> Wake {
        let mut out = Wake { calls: vec![], looks: vec![] };
        let mut outcomes: Vec<Value> = vec![];
        let mut first = true;
        for _ in 0..60 {
            let mut channels = BTreeMap::new();
            channels.insert("mine".into(), Seen::Records { records: if first { records.clone() } else { vec![] }, search: false });
            for (k, v) in &extra {
                channels.insert((*k).into(), if first { v.clone() } else { match v { Seen::Sites { .. } => v.clone(), _ => v.clone() } });
            }
            let pic = Picture {
                participant: "police-oic-system".into(),
                t,
                status: oikos_sight::ParticipantStatus::Active,
                entity: ME.into(),
                as_position: Some("police-oic".into()),
                body: None,
                positions: vec![],
                outcomes: outcomes.drain(..).map(|o| serde_json::from_value(o).unwrap()).collect(),
                inbox: vec![],
                channels,
                asking: vec![],
                readings: BTreeMap::new(),
                woke_for: if first { "cadence".into() } else { "done".into() },
                since: DAY,
            };
            first = false;
            let mut cx = Cx::new(t, &self.ctx, &mut self.draws, 7, vec![]);
            match self.actor.step(&pic, &mut cx) {
                Action::Call { program, .. } => {
                    let text = program_text(&program);
                    self.n += 1;
                    let id = format!("act.{}", self.n);
                    self.actor.sent(&id);
                    let o = if refuse(&text) { json!({ "action": id, "t": t, "status": "refused", "refusal": { "code": "field_exhausted" } }) } else { json!({ "action": id, "t": t, "status": "applied" }) };
                    outcomes.push(o);
                    out.calls.push(text);
                }
                Action::Look { looks } => {
                    out.looks.push(serde_json::to_value(&looks).unwrap());
                    break;
                }
                _ => break,
            }
        }
        out
    }
}

fn warrant(id: &str, tenant: &str, household: &[&str], n: u32) -> Arc<Record> {
    st(id, 0, "warrant", "tribunal", &[ME], json!({ "order": format!("order-{id}"), "lease": format!("lease-{tenant}"), "tenant": tenant, "landlord": "landlord-1",
        "space": format!("house-{n}/dwelling.1"), "structure": format!("house-{n}"), "household": household, "not_before": DAY, "until": 20 * DAY }))
}

fn station() -> Driver {
    Driver::new(&Station, ctx(base_params()))
}

#[test]
fn the_manifest_is_the_one_the_ts_module_wrote() {
    let ts: Value = crate::offices::testing::ts_manifest("police.station");
    let rust = Station.manifest();
    for (k, v) in ts.as_object().unwrap() {
        assert_eq!(&rust[k], v, "{k}");
    }
}

#[test]
fn a_warrant_carried_out_says_how_many_were_there_and_put_out() {
    let mut s = station();
    s.wake(10 * 3600, [staff_records(), vec![warrant("rec.20", "t1", &["t1", "t2", "t3"], 1)]].concat(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    let w = s.wake(2 * DAY + 10 * 3600, vec![], vec![("premises", premises(&["officer-1"]))], &|c| c.contains("occupancy") && (c.contains("t2") || c.contains("t3")));
    assert_eq!(w.of("occupancy").len(), 3);
    let done = w.of("warrant_executed");
    assert_eq!(done.len(), 1, "{:?}", w.calls);
    assert!(done[0].contains("1 were there and were put out"), "{}", done[0]);
    assert!(done[0].contains("removed"), "{}", done[0]);
}

#[test]
fn nobody_there_possession_is_given_all_the_same_and_the_paper_says_nobody_was_put_out() {
    let mut s = station();
    s.wake(10 * 3600, [staff_records(), vec![warrant("rec.20", "t4", &["t4", "t5"], 2)]].concat(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    let w = s.wake(2 * DAY + 10 * 3600, vec![], vec![("premises", premises(&["officer-1"]))], &|c| c.contains("occupancy"));
    assert!(w.of("warrant_executed")[0].contains("0 were there and were put out"));
}

#[test]
fn a_warrant_withdrawn_before_its_day_is_not_gone_on_and_one_not_yet_due_does_not_hold_up_the_next() {
    let mut s = station();
    let withdrawn = rec(json!({ "id": "rec.30", "record": "withdrawal", "author": "p.1", "speaks_for": "tribunal", "at": 0, "visible_to": "public", "withdraws": "rec.20" }));
    let later = st("rec.21", 0, "warrant", "tribunal", &[ME], json!({ "lease": "l", "tenant": "t7", "landlord": "landlord-1", "space": "house-7/dwelling.1", "structure": "house-7", "not_before": 5 * DAY, "until": 20 * DAY }));
    s.wake(10 * 3600, [staff_records(), vec![warrant("rec.20", "t6", &["t6"], 3), later, withdrawn, warrant("rec.22", "t8", &["t8"], 8)]].concat(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    let w = s.wake(2 * DAY + 10 * 3600, vec![], vec![("premises", premises(&["officer-1"]))], &|_| false);
    let ins: Vec<_> = w.of("occupancy");
    assert_eq!(ins.len(), 1, "{:?}", w.calls);
    assert!(ins[0].contains("house-8"), "only the due one that stands: {}", ins[0]);
}

#[test]
fn a_tenant_the_register_shows_dead_is_not_put_out() {
    let mut s = station();
    let died = st("rec.40", 0, "death_registration", "city", &[ME], json!({ "deceased": "t1", "children": [], "without_adult": [] }));
    s.wake(10 * 3600, [staff_records(), vec![warrant("rec.20", "t1", &["t1", "t2"], 1), died]].concat(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    let w = s.wake(2 * DAY + 10 * 3600, vec![], vec![("premises", premises(&["officer-1"]))], &|_| false);
    assert!(w.of("occupancy").is_empty(), "{:?}", w.calls);
    let lapsed = w.of("warrant_lapsed");
    assert_eq!(lapsed.len(), 1, "{:?}", w.calls);
    assert!(lapsed[0].contains("tenant_dead"));
}

#[test]
fn a_warrant_past_its_last_day_lapses_and_the_landlord_is_told() {
    let mut s = station();
    s.wake(10 * 3600, [staff_records(), vec![warrant("rec.20", "t1", &["t1"], 1)]].concat(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    let w = s.wake(22 * DAY + 10 * 3600, vec![], vec![("premises", premises(&["officer-1"]))], &|_| false);
    assert!(w.of("occupancy").is_empty());
    assert_eq!(w.of("warrant_lapsed").len(), 1);
}

#[test]
fn no_officer_at_the_station_the_warrant_waits() {
    let mut s = station();
    s.wake(10 * 3600, [staff_records(), vec![warrant("rec.20", "t1", &["t1"], 1)]].concat(), vec![("premises", premises(&[]))], &|_| false);
    let w = s.wake(2 * DAY + 10 * 3600, vec![], vec![("premises", premises(&[]))], &|_| false);
    assert!(w.of("occupancy").is_empty());
    let w = s.wake(3 * DAY + 10 * 3600, vec![], vec![("premises", premises(&["officer-1"]))], &|_| false);
    assert_eq!(w.of("occupancy").len(), 1);
}

#[test]
fn a_successor_does_not_carry_out_a_warrant_or_look_into_a_report_its_office_has_already_dealt_with() {
    let report = st("rec.50", 0, "crime_report", "shop-1", &[ME], json!({ "at": "shop-1/floor", "kind": "goods", "value": 5000 }));
    let done = [
        st("rec.51", 0, "warrant_executed", ME, &["t1", "landlord-1"], json!({ "warrant": "rec.20", "removed": 1 })),
        st("rec.52", 0, "investigation_closed", ME, &["shop-1"], json!({ "report": "rec.50", "solved": false })),
    ];
    let mut s = station();
    let w = s.wake(2 * DAY + 10 * 3600, [staff_records(), vec![warrant("rec.20", "t1", &["t1"], 1), report.clone()], done.to_vec()].concat(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    assert!(w.of("occupancy").is_empty() && w.of("investigate").is_empty(), "{:?}", w.calls);
    // The same report not on file as dealt with is looked into, once.
    let mut fresh = station();
    let w = fresh.wake(2 * DAY + 10 * 3600, [staff_records(), vec![report]].concat(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    assert_eq!(w.of("investigate").len(), 1, "{:?}", w.calls);
}

#[test]
fn an_investigation_that_finds_the_taker_is_charged_and_one_that_does_not_is_closed() {
    let report = |id: &str| st(id, 0, "crime_report", "shop-1", &[ME], json!({ "at": "shop-1/floor", "kind": "goods", "value": 5000 }));
    let mut s = station();
    // Two reports; one officer has hours for two a day (8h / 4h).
    let pic = |t: i64, outcomes: Vec<Value>, records: Vec<Arc<Record>>| {
        let mut channels = BTreeMap::new();
        channels.insert("mine".into(), Seen::Records { records, search: false });
        channels.insert("premises".into(), premises(&["officer-1"]));
        Picture { participant: "police-oic-system".into(), t, status: oikos_sight::ParticipantStatus::Active, entity: ME.into(), as_position: Some("police-oic".into()), body: None, positions: vec![],
            outcomes: outcomes.into_iter().map(|o| serde_json::from_value(o).unwrap()).collect(), inbox: vec![], channels, asking: vec![], readings: BTreeMap::new(), woke_for: "done".into(), since: DAY }
    };
    let t = DAY + 10 * 3600;
    let mut draws = Draws::new("police-oic-system", "police-oic");
    let context = ctx(base_params());
    let mut texts = vec![];
    let mut cx = Cx::new(t, &context, &mut draws, 7, vec![]);
    let a = s.actor.step(&pic(t, vec![], [staff_records(), vec![report("rec.50"), report("rec.51")]].concat()), &mut cx);
    let Action::Call { program, .. } = a else { panic!("{a:?}") };
    texts.push(program_text(&program));
    s.actor.sent("act.1");
    let a = s.actor.step(&pic(t, vec![json!({ "action": "act.1", "t": t, "status": "applied", "investigated": { "from": "shop-1", "at": "x", "kind": "goods", "taker": "thief-1" } })], vec![]), &mut cx);
    let Action::Call { program, .. } = a else { panic!("{a:?}") };
    texts.push(program_text(&program));
    s.actor.sent("act.2");
    // Both findings are in; the next wake (later) plans their charge and closure.
    let t2 = t + 60;
    let mut cx = Cx::new(t2, &context, &mut draws, 7, vec![]);
    let outs = vec![
        json!({ "action": "act.1", "t": t2, "status": "applied", "investigated": { "from": "shop-1", "at": "x", "kind": "goods", "taker": "thief-1" } }),
        json!({ "action": "act.2", "t": t2, "status": "applied", "investigated": { "from": "shop-1", "at": "x", "kind": "goods", "taker": null } }),
    ];
    let a = s.actor.step(&pic(t2, outs, vec![]), &mut cx);
    let Action::Call { program, .. } = a else { panic!("{a:?}") };
    texts.push(program_text(&program));
    s.actor.sent("act.3");
    let a = s.actor.step(&pic(t2, vec![json!({ "action": "act.3", "t": t2, "status": "applied" })], vec![]), &mut cx);
    let Action::Call { program, .. } = a else { panic!("{a:?}") };
    texts.push(program_text(&program));
    assert!(texts.iter().any(|x| x.contains("investigation_closed")), "{texts:?}");
    assert!(texts[0].contains("investigate"), "{texts:?}");
    assert!(texts[1].contains("investigate"), "{texts:?}");
    assert!(texts.iter().any(|x| x.contains("tribunal_application") && x.contains("thief-1")), "{texts:?}");
}

#[test]
fn asked_to_call_at_a_home_an_officer_goes_and_whoever_died_alone_is_reported_once() {
    let ask = st("rec.60", 5 * DAY, "welfare_check_request", "neighbour-1", &[ME], json!({ "space": "house-1/dwelling.1", "structure": "house-1", "since": DAY }));
    let ask2 = st("rec.61", 6 * DAY, "welfare_check_request", "neighbour-2", &[ME], json!({ "space": "house-1/dwelling.1", "structure": "house-1", "since": DAY }));
    let mut s = station();
    let w = s.wake(5 * DAY + 10 * 3600, [staff_records(), vec![ask]].concat(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    assert_eq!(w.looks.len(), 1, "they go the day they are asked: {:?}", w.looks);
    assert!(w.looks[0].to_string().contains("house-1"));
    // Back: what is there is shown at the next wake.
    let cell = home(1, &[], json!([{ "occupant": "ann", "reason": "died", "at": 3 * DAY }]));
    let back = Seen::Sites { as_of: 5 * DAY + 13 * 3600, cells: Arc::new(vec![cell]), visit: Some(Visit { seen_at: [("h1".into(), 5 * DAY + 13 * 3600)].into(), fresh: vec!["h1".into()] }) };
    let w = s.wake(6 * DAY + 10 * 3600, vec![ask2], vec![("premises", premises(&["officer-1"])), ("calls", back)], &|_| false);
    assert_eq!(w.of("death_notification").len(), 1, "{:?}", w.calls);
    assert!(w.looks.is_empty(), "the same silence is not called at twice");
}

#[test]
fn a_home_nobody_asked_about_is_never_gone_to_and_a_death_someone_outlived_is_not_found() {
    let mut s = station();
    let w = s.wake(5 * DAY + 10 * 3600, staff_records(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    assert!(w.looks.is_empty());
    let ask = st("rec.60", 70 * DAY, "welfare_check_request", "n", &[ME], json!({ "space": "house-1/dwelling.1", "structure": "house-1", "since": 60 * DAY }));
    let mut s = station();
    s.wake(70 * DAY + 10 * 3600, [staff_records(), vec![ask]].concat(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    let cell = home(1, &[], json!([{ "occupant": "ann", "reason": "died", "at": DAY }, { "occupant": "bob", "reason": "left", "at": 60 * DAY }]));
    let back = Seen::Sites { as_of: 70 * DAY + 13 * 3600, cells: Arc::new(vec![cell]), visit: Some(Visit { seen_at: Default::default(), fresh: vec!["h1".into()] }) };
    let w = s.wake(71 * DAY + 10 * 3600, vec![], vec![("premises", premises(&["officer-1"])), ("calls", back)], &|_| false);
    assert!(w.of("death_notification").is_empty());
}

#[test]
fn a_saved_station_steps_as_the_original() {
    let mut s = station();
    s.wake(10 * 3600, [staff_records(), vec![warrant("rec.20", "t1", &["t1"], 1)]].concat(), vec![("premises", premises(&["officer-1"]))], &|_| false);
    let saved = s.actor.save().unwrap();
    let mut back = Driver::restore(&Station, ctx(base_params()), saved.clone());
    assert_eq!(back.actor.save().unwrap(), saved);
    let a = s.wake(2 * DAY + 10 * 3600, vec![], vec![("premises", premises(&["officer-1"]))], &|_| false);
    let b = back.wake(2 * DAY + 10 * 3600, vec![], vec![("premises", premises(&["officer-1"]))], &|_| false);
    assert_eq!(a.calls, b.calls);
}
