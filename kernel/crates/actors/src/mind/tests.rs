//! The citizen's mind driven through the seam alone, from a harness of `Life`s, events and outcomes (port guide 8,
//! lane A2: no life code needed). What citizen.ts's mind half did, asserted as behaviour.

use super::citizen::CitizenMind;
use crate::citizen::mind::*;
use crate::common::Book;
use crate::{Answer, Ctx, Cx, Draws, Kept, WorldInfo, DAY};
use oikos_sight::{ParticipantStatus, Picture};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;

fn ctx(params: Value, dials: Value) -> Ctx {
    Ctx {
        participant: "p.ann".into(),
        performer: Default::default(),
        entity: "ann".into(),
        position: None,
        params: serde_json::from_value(params).unwrap(),
        world: Arc::new(WorldInfo { tick: 3_600, run_end: 400 * DAY, dials, ..Default::default() }),
    }
}

fn pic(t: i64) -> Picture {
    Picture {
        participant: "p.ann".into(),
        t,
        status: ParticipantStatus::Active,
        entity: "ann".into(),
        as_position: None,
        body: None,
        positions: vec![],
        outcomes: vec![],
        inbox: vec![],
        channels: BTreeMap::new(),
        asking: vec![],
        readings: BTreeMap::new(),
        woke_for: "cadence".into(),
        since: 0,
    }
}

fn life(t: i64) -> Life {
    Life {
        t,
        adult: true,
        age_days: 40 * 365,
        monthly_income: 300_000,
        savings: 500_000,
        essentials: 150_000,
        household: 1,
        housed: Housed::Rents,
        rent: Some(120_000),
        landlord: Some("landlord.1".into()),
        lease: Some("lease.1".into()),
        employer: Some("firm.1".into()),
        job: Some("job.1".into()),
        leaseholder: true,
        dwelling: Some("block.1/dwelling.1".into()),
        account: Some("acct.ann".into()),
        goods_held: 10,
        in_labour_force: true,
        ..Default::default()
    }
}

/// A step's worth of the mind: run `f` with a fresh `Cx` at `t`, and give back what it kept.
fn at<R>(c: &Ctx, draws: &mut Draws, t: i64, answers: Vec<Answer>, f: impl FnOnce(&mut Cx) -> R) -> (R, Kept) {
    let seed = c.participant.bytes().fold(7u64, |a, b| a.wrapping_mul(31).wrapping_add(u64::from(b)));
    let mut cx = Cx::new(t, c, draws, seed, answers);
    let r = f(&mut cx);
    (r, cx.into_kept())
}

fn made(c: &Ctx) -> Box<dyn Mind> {
    let mut d = Draws::default();
    let l = life(0);
    at(c, &mut d, 0, vec![], |cx| super::make(cx, &Born { life: &l, own_values: None, parents: vec![] }).unwrap()).0
}

fn initiative() -> Value {
    json!({ "initiative": true, "complain_to": "town.1", "union": "union.1", "union_join_bps": { "other": 2_000 } })
}

#[test]
fn a_mind_is_the_citizen_mind_and_saves_to_the_bit() {
    let c = ctx(initiative(), Value::Null);
    let mut m = made(&c);
    let mut d = Draws::default();
    let (_, kept) = at(&c, &mut d, DAY, vec![], |cx| m.outcome(cx, &life(DAY), Outcome { domain: "job".into(), option: "firm.1".into(), kind: "unpaid".into(), ..Default::default() }));
    assert_eq!(kept.outcomes.len(), 1);
    let saved = m.save().unwrap();
    let mut again = super::restore(&c, saved.clone()).unwrap();
    assert_eq!(again.save().unwrap(), saved);
    // (The two step alike from here.)
    let ask = || Decide { domain: "job".into(), options: vec![Choice { key: "a".into(), facts: Some(Facts { money_per_month: 10, ..Default::default() }), ..Default::default() }, Choice { key: "b".into(), facts: Some(Facts { money_per_month: 20, ..Default::default() }), ..Default::default() }], ..Default::default() };
    let (x, _) = at(&c, &mut Draws::default(), 2 * DAY, vec![], |cx| m.decide(cx, &life(2 * DAY), ask()));
    let (y, _) = at(&c, &mut Draws::default(), 2 * DAY, vec![], |cx| again.decide(cx, &life(2 * DAY), ask()));
    assert_eq!(x, y);
    assert_eq!(m.save().unwrap(), again.save().unwrap());
}

#[test]
fn unpaid_wages_cost_trust_bring_fear_and_a_want() {
    let c = ctx(initiative(), Value::Null);
    let mut m = made(&c);
    let before = m.trust_z("firm.1");
    let mut d = Draws::default();
    at(&c, &mut d, DAY, vec![], |cx| m.outcome(cx, &life(DAY), Outcome { domain: "job".into(), option: "firm.1".into(), kind: "unpaid".into(), payoff: Some(0), ..Default::default() }));
    assert!(m.trust_z("firm.1") < before, "trust falls");
    assert!(m.feeling("fear", "firm.1", DAY) > 0 && m.feeling("anger", "firm.1", DAY) > 0);
    assert!(m.wants().iter().any(|w| w.about == "unpaid" && w.whom.as_deref() == Some("firm.1")));
    assert!(m.affinity("firm.1", DAY) < 0);
}

#[test]
fn without_initiative_nothing_is_wanted() {
    let c = ctx(json!({ "initiative": false }), Value::Null);
    let mut m = made(&c);
    at(&c, &mut Draws::default(), DAY, vec![], |cx| m.outcome(cx, &life(DAY), Outcome { domain: "job".into(), option: "firm.1".into(), kind: "unpaid".into(), ..Default::default() }));
    assert!(m.wants().is_empty());
    assert!(!m.initiative());
}

#[test]
fn a_decision_is_recorded_numbered_and_followed_by_its_outcome() {
    let c = ctx(json!({}), Value::Null);
    let mut m = made(&c);
    let mut d = Draws::default();
    let opts = vec![Choice { key: "shop.1".into(), ..Default::default() }, Choice { key: "shop.2".into(), ..Default::default() }];
    let (got, kept) = at(&c, &mut d, DAY, vec![], |cx| m.decide(cx, &life(DAY), Decide { domain: "shop".into(), options: opts, ..Default::default() }));
    assert_eq!(got.n, Some(1));
    let rec = &kept.decisions[0];
    assert_eq!((rec["n"].as_u64(), rec["domain"].as_str()), (Some(1), Some("shop")));
    assert!(rec["person"].is_object() && rec["state"]["needs"].is_object());
    let key = got.key.unwrap();
    let (_, kept) = at(&c, &mut d, 2 * DAY, vec![], |cx| m.outcome(cx, &life(2 * DAY), Outcome { domain: "shop".into(), option: key.clone(), kind: "served".into(), payoff: Some(9_000), ..Default::default() }));
    assert_eq!(kept.outcomes[0]["of"].as_u64(), Some(1));
    assert!(m.learned("shop", &key).is_some());
}

#[test]
fn a_death_in_the_household_is_mourned_and_told_to_those_closest() {
    let c = ctx(initiative(), Value::Null);
    let mut m = made(&c);
    let mut d = Draws::default();
    // Talking with bea and cal makes them ties.
    for who in ["bea", "cal"] {
        at(&c, &mut d, DAY, vec![], |cx| m.event(cx, &pic(DAY), &Book::new(), &life(DAY), Event::Talk { from: format!("p.{who}"), person: who.into(), text: "How are things with you?".into(), re: None }, &NoOpenings));
    }
    let (h, _) = at(&c, &mut d, 2 * DAY, vec![], |cx| m.event(cx, &pic(2 * DAY), &Book::new(), &life(2 * DAY), Event::Bereaved { who: "dan".into(), adults: vec![] }, &NoOpenings));
    match h {
        Heard::Mourn(to) => assert_eq!(to, vec!["bea".to_string(), "cal".to_string()]),
        other => panic!("{other:?}"),
    }
    assert!(m.wants().iter().any(|w| w.about == "loss"));
}

#[test]
fn asked_how_we_are_we_answer_in_our_own_words_at_the_plan() {
    let c = ctx(json!({}), Value::Null);
    let mut m = made(&c);
    let mut d = Draws::default();
    let l = life(DAY);
    let (h, _) = at(&c, &mut d, DAY, vec![], |cx| m.event(cx, &pic(DAY), &Book::new(), &l, Event::Talk { from: "p.bea".into(), person: "bea".into(), text: "How are things with you?".into(), re: None }, &NoOpenings));
    assert_eq!(h, Heard::Taken);
    // Talking with someone is coming to know them (TS `peopleWeKnow`): the people a household with no home asks.
    assert!(m.knows("bea") && !m.knows("cal"));
    let (planned, _) = at(&c, &mut d, DAY, vec![], |cx| m.plan(cx, &pic(DAY), &Book::new(), &l, &NoOpenings));
    let said: Vec<String> = planned.steps.iter().flat_map(|s| s.lines.iter().map(|l| format!("{:?}", l.call))).collect();
    assert!(said.iter().any(|x| x.contains("I work for firm.1; they pay on time.")), "{said:?}");
    // News in our phrasing is learned from as someone else's payoff.
    let (_, kept) = at(&c, &mut d, 2 * DAY, vec![], |cx| m.event(cx, &pic(2 * DAY), &Book::new(), &l, Event::Talk { from: "p.bea".into(), person: "bea".into(), text: "I shop at shop.9; it has what I need.".into(), re: None }, &NoOpenings));
    assert_eq!(kept.outcomes[0]["learned"]["heard"], json!(true));
    assert!(m.learned("shop", "shop.9").is_some());
    // Talk that is not ours goes back to life.
    let (h, _) = at(&c, &mut d, 2 * DAY, vec![], |cx| m.event(cx, &pic(2 * DAY), &Book::new(), &l, Event::Talk { from: "p.x".into(), person: "x".into(), text: "Your account is open.".into(), re: None }, &NoOpenings));
    assert_eq!(h, Heard::NotMine);
}

struct AskLandlord;
impl Openings for AskLandlord {
    fn for_want(&self, w: &WantView, _t: i64) -> Vec<Opening> {
        let Some((record, _, by)) = w.against.clone() else { return vec![] };
        vec![Opening { key: format!("ask:{by}"), kind: "ask".into(), on: Some(record.clone()), by: Some(by.clone()), undoes: Some(record.clone()), bears: vec![by], intent: Intent::AskLandlord { about: record, rise: true }, ..Default::default() }]
    }
    fn grievance(&self, _: &WantView) -> Option<GrievanceView> {
        None
    }
}

#[test]
fn a_rent_rise_is_a_want_pursued_at_once_by_a_way_life_offers_or_by_waiting() {
    let c = ctx(initiative(), Value::Null);
    let mut takes = 0;
    for seed in 0..20 {
        let c = Ctx { participant: format!("p.{seed}"), entity: format!("e{seed}"), ..c.clone() };
        let mut m = made(&c);
        let mut d = Draws::default();
        let (h, kept) = at(&c, &mut d, DAY, vec![], |cx| m.event(cx, &pic(DAY), &Book::new(), &life(DAY), Event::RentRise { landlord: "landlord.1".into(), notice: "notice.1".into(), rent: 140_000, was: 120_000, share_bps: 667 }, &AskLandlord));
        let Heard::Took(chosen) = h else { panic!() };
        assert_eq!(kept.decisions.len(), 1, "the choice among ways is recorded");
        assert!(kept.decisions[0]["situation"]["openings"].is_array());
        let took = kept.decisions[0]["choice"].as_str().unwrap_or_default().to_string();
        assert_eq!(chosen.first().map(|c| c.opening.kind.clone()), (took == "ask").then(|| "ask".to_string()), "only life's ways go back to it");
        if let Some(ch) = chosen.first() {
            assert_eq!(ch.opening.intent, Intent::AskLandlord { about: "notice.1".into(), rise: true });
            takes += 1;
        }
        assert!(m.wants().iter().any(|w| w.about == "rent_increase"));
    }
    assert!(takes > 0 && takes < 20, "some ask, the rest spend less or wait: {takes}");
}

#[test]
fn a_need_long_short_becomes_a_want_and_the_record_is_written() {
    let c = ctx(initiative(), Value::Null);
    let mut m = made(&c);
    let mut d = Draws::default();
    let mut poor = life(0);
    poor.savings = 0;
    let mut wrote = false;
    for week in 0..20 {
        let t = week * 7 * DAY + DAY;
        poor.t = t;
        let (_, kept) = at(&c, &mut d, t, vec![], |cx| {
            m.woke(cx, &pic(t), &Book::new(), &poor);
            let p = m.plan(cx, &pic(t), &Book::new(), &poor, &NoOpenings);
            m.record(cx, &poor);
            p
        });
        if let Some(r) = &kept.record {
            wrote = true;
            assert!(r["set"].is_object());
        }
    }
    assert!(wrote);
    assert!(m.wants().iter().any(|w| w.about == "security"), "{:?}", m.wants());
    assert!(m.satisfaction(&poor) < m.satisfaction(&life(0)));
}

#[test]
fn a_conduct_is_leaned_recorded_and_forced_as_asked() {
    let c = ctx(json!({}), Value::Null);
    let mut m = made(&c);
    let mut d = Draws::default();
    let (x, kept) = at(&c, &mut d, DAY, vec![], |cx| m.choose_conduct(cx, &life(DAY), ConductAsk { conduct: "complain".into(), base_bps: 3_000, draw_bps: 2_000, who: Some("town.1".into()), lean: true, act: true, record: Some(("complain".into(), "write".into(), "not".into())), ..Default::default() }));
    assert!(x.does && x.bps == 3_000, "no initiative and no culture: the rate as cited");
    assert_eq!(kept.decisions[0]["choice"], json!("write"));
    let (y, _) = at(&c, &mut d, DAY, vec![], |cx| m.choose_conduct(cx, &life(DAY), ConductAsk { conduct: "complain".into(), base_bps: 0, draw_bps: 9_000, forced: true, ..Default::default() }));
    assert!(y.does);
}

#[test]
fn the_sparse_mind_is_asked_once_and_answered_by_the_next_wake() {
    let c = ctx(json!({ "union": "union.1", "union_join_bps": { "other": 5_000 }, "consult": true }), Value::Null);
    let mut m = made(&c);
    let mut d = Draws::default();
    let l = life(DAY);
    let (p, kept) = at(&c, &mut d, DAY, vec![], |cx| m.plan(cx, &pic(DAY), &Book::new(), &l, &NoOpenings));
    assert_eq!(kept.questions.len(), 1);
    assert_eq!(kept.questions[0].kind, "consult");
    assert_eq!(p.wake_at, Some(DAY + 3_600));
    assert!(kept.decisions.iter().all(|x| x["domain"] != json!("membership")), "the decision waits for the answer");
    let answer = Answer { kind: "consult".into(), about: "join:union.1".into(), body: json!({ "scores": { "join": { "mean": 8_000, "sd": 0 }, "not": { "mean": 2_000, "sd": 0 } } }) };
    let t = DAY + 3_600;
    let (_, kept) = at(&c, &mut d, t, vec![answer], |cx| {
        m.woke(cx, &pic(t), &Book::new(), &l);
        m.plan(cx, &pic(t), &Book::new(), &l, &NoOpenings)
    });
    assert!(kept.questions.is_empty());
    assert!(kept.decisions.iter().any(|x| x["domain"] == json!("membership")));
}

#[test]
fn the_same_inputs_give_the_same_mind_whatever_else_ran() {
    let c = ctx(initiative(), json!({ "initiative_bps": 5_000 }));
    let run = || {
        let mut m = made(&c);
        let mut d = Draws::default();
        let mut l = life(0);
        for week in 0..12 {
            let t = week * 7 * DAY + DAY;
            l.t = t;
            l.savings = 400_000 - week * 40_000;
            at(&c, &mut d, t, vec![], |cx| {
                m.woke(cx, &pic(t), &Book::new(), &l);
                m.plan(cx, &pic(t), &Book::new(), &l, &AskLandlord);
                m.record(cx, &l);
            });
        }
        m.save().unwrap()
    };
    assert_eq!(run(), run());
    let _ = std::mem::size_of::<CitizenMind>();
}

