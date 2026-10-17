//! office.desk: a body that hears grievances (participants/src/behaviour/desk.ts; docs/behaviour/frictions.md,
//! "Venues"): a council's complaints desk, an ombudsman, a consumer desk, a mediation service. What it hears it says in
//! an offer anyone may apply to (the contract's `hears`): a person with a grievance finds it by what it says, never by
//! its name, so a desk made in a run is found the same way.
//!
//! A venue has no power over the world. It takes an application, tells the one complained of and gives them time to
//! answer, decides by its procedure with the hours its staff have, and says what it decided: words, which the other
//! side obeys or does not. The hearing itself is `hearing::Hearings`, shared with the tribunal.
//!
//! Ported to Rust: the file is the memory (a new holder of the post carries on: `Hearings` reads its own notices and
//! decisions from the book), and the notice of what the desk hears is said once unless one of its own is on file.

use super::hearing::{hearing_notices, HearPart, Hearings, Forms, HearingParams, Hears, NoticeOpts, Refer};
use super::{spread, Booked, Noting};
use crate::common::{part, Answering, Book, CounterWork, Piece, StandingWork, Part, DAY};
use crate::common::work::ReportOf;
use crate::steps::{because, say, Plan, Say, Step, Visible};
use crate::{Actor, Cx, Ctx, Kind, Picture};
use oikos_rules::forms::Answers;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub struct Desk;

pub(crate) fn answers() -> Answers {
    Answers {
        office: "the desk".into(),
        acts: "What it acts on: an application made to it about something it has said it hears, which it puts to the other side and decides by its procedure.".into(),
        forms: vec![],
        report: false,
    }
}

impl Kind for Desk {
    fn name(&self) -> &'static str {
        "office.desk"
    }
    fn version(&self) -> &'static str {
        "0.2.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/frictions.md"
    }
    fn manifest(&self) -> Value {
        let issues = super::forms_issued("DESK");
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "account": { "schema": { "type": "string" }, "default": "", "source": "placeholder" },
                "answer_days": { "schema": { "type": "integer" }, "unit": "days", "default": 14, "source": "placeholder" },
                "counter": { "schema": { "type": "boolean" }, "default": false, "source": "placeholder" },
                "fee": { "schema": { "type": "integer", "description": "what applying costs (none: nothing), paid into `account`" }, "default": 0, "source": "placeholder" },
                "hears": { "schema": { "type": "array" }, "default": [], "source": "placeholder" },
                "members_of": { "schema": { "type": "string", "description": "heard only for members of this organisation (none: anyone)" }, "default": "", "source": "placeholder" },
                "office": { "schema": { "type": "string" }, "default": "", "source": "placeholder" },
                "part": { "schema": { "type": "string" }, "default": "", "source": "placeholder" },
                "refer_to": { "schema": { "type": "object" }, "default": {}, "source": "placeholder" },
                "title": { "schema": { "type": "string", "description": "what it calls itself in its notice" }, "default": "desk", "source": "placeholder" },
                "within_days": { "schema": { "type": "integer" }, "unit": "days", "default": 28, "source": "placeholder" },
            },
            "perceives": [], "state": "none",
            "issues": issues,
            "routines": [{
                "task": "answer", "at": "office", "every": 1,
                "what": "The desk's staff take in each application, tell the one it is against and give them time to answer, and decide what the record settles: the other side's own answer, no answer at all, or a paper the applicant can show. A case the record cannot settle is put before the office-holder.",
                "papers": [
                    { "kind": "application", "how": "taken in; the one it is against is told and given time to answer; decided on the record when that time has run, or put before the office-holder" },
                    { "kind": "complaint_response", "how": "filed with its application, which is decided on it when the time to answer has run" },
                ],
            }],
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        spread(ctx, 9 * 3600, 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let plan = DeskPlan::new(ctx)?;
        Ok(Box::new(Answering::new(Noting::new(plan), answers())))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let inner = saved.get("inner").cloned().ok_or("office.desk: nothing saved")?;
        Ok(Box::new(Answering::restore(Noting::<DeskPlan>::restore(inner)?, answers(), &saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct DeskPlan {
    title: String,
    hears: Vec<Hears>,
    fee: i64,
    account: String,
    members_of: String,
    part: Part,
    office: String,
    book: Book,
    routines: StandingWork,
    counter: CounterWork,
    hearings: Hearings,
    said: bool,
}

impl DeskPlan {
    fn new(ctx: &Ctx) -> Result<Self, String> {
        let hears: Vec<Hears> = ctx.param("hears", vec![])?;
        let answer_days: i64 = ctx.param("answer_days", 14)?;
        let within_days: i64 = ctx.param("within_days", 28)?;
        let refer_to: BTreeMap<String, Refer> = ctx.param("refer_to", BTreeMap::new())?;
        let part_s: String = ctx.param("part", String::new())?;
        let part = Part::from_param(&part_s);
        let offices = ctx.position.as_ref().map(|p| p.trim_end_matches("-staff").to_string()).into_iter();
        Ok(DeskPlan {
            title: ctx.param("title", "desk".to_string())?,
            fee: ctx.param("fee", 0)?,
            account: ctx.param("account", String::new())?,
            members_of: ctx.param("members_of", String::new())?,
            part,
            office: ctx.param("office", String::new())?,
            book: Book::new(),
            routines: StandingWork::new(&ctx.entity, part, offices),
            counter: CounterWork::new(ctx.param("counter", false)?),
            hearings: Hearings::new(&ctx.entity, HearingParams { hears: hears.clone(), answer_days, within_days, refer_to, possession: None }, Forms::default(), &[]),
            hears,
            said: false,
        })
    }
}

impl Booked for DeskPlan {
    fn book_mut(&mut self) -> &mut Book {
        &mut self.book
    }
}

impl Plan for DeskPlan {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let (t, me) = (pic.t, cx.ctx.entity.clone());
        let mut steps: Vec<Step<()>> = vec![];
        let office = if !self.office.is_empty() { self.office.clone() } else { cx.ctx.position.clone().unwrap_or_else(|| "office".into()) };
        steps.extend(self.routines.set(&self.book, self.counter.order(&office).as_slice()));
        if !self.said && self.part != Part::Staff {
            self.said = true;
            let standing = self.book.open("hearing").any(|r| r.speaks_for.as_deref() == Some(me.as_str()) && part(r, Piece::Offer).get("hears").is_some_and(|h| !h.is_null()));
            if !standing && !self.hears.is_empty() {
                let o = NoticeOpts { fee: self.fee, account: &self.account, members_of: &self.members_of, members_apply: false };
                for n in hearing_notices(&me, &format!("The {} hears", self.title), &self.hears, &o, cx) {
                    steps.push(because(
                        "Saying what we hear, so that whoever has such a matter can bring it.",
                        vec![say(&n.kind, &n.text, Say { visible: Some(Visible::Public), data: Some(n.data), extra: vec![("offer", n.offer)], ..Default::default() })],
                    ));
                }
            }
        }
        // (With a counter, and someone in the office: the staff do what the record settles, while their standing order
        // stands; the office-holder decides the rest. Without one, whoever runs the office does it all.)
        let split = self.counter.offered && self.part != Part::Whole;
        if !split {
            steps.extend(self.hearings.steps(&self.book, cx, HearPart::All, None));
        } else if self.part == Part::Seat {
            steps.extend(self.hearings.steps(&self.book, cx, HearPart::Seat, None));
        } else if self.counter.works(&self.routines, &self.book, t) {
            let before = self.hearings.count_of("applications");
            steps.extend(self.hearings.steps(&self.book, cx, HearPart::Staff, None));
            for _ in before..self.hearings.count_of("applications") {
                self.counter.answered(&self.routines, "application");
            }
            self.counter.flush(&mut self.routines, t);
        }
        if self.part == Part::Staff && self.counter.offered {
            let office = cx.ctx.position.clone().unwrap_or_default().trim_end_matches("-staff").to_string();
            let from = format!("the {}'s staff", self.title);
            let tasks: Vec<_> = self.counter.tasks().into_iter().collect();
            let report: Vec<Step<()>> = self.routines.report(&self.book, cx, &ReportOf { office: &office, from: &from, tasks, ..Default::default() });
            self.counter.reported(&mut self.routines, &report);
            steps.extend(report);
        }
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::{st, Rig, DAY};
    use super::*;

    fn rig(extra: Value) -> Rig {
        let mut p = json!({ "title": "complaints desk", "hears": [{ "about": "billing", "can": ["order"] }, { "about": "noise", "can": ["recommend"] }], "answer_days": 14, "within_days": 28 });
        if let (Some(o), Some(e)) = (p.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        Rig::new(&Desk, "desk", Some("complaints"), p)
    }
    fn apply(id: &str, at: i64, data: Value) -> Value {
        st(id, at, "application", "c0001", &["desk"], data)
    }

    #[test]
    fn it_says_what_it_hears_once_then_takes_in_an_application_and_tells_the_other_side() {
        let mut d = rig(json!({}));
        let first = d.day(0, &[apply("rec.1", 0, json!({ "matter": "billing", "against": "firm-1", "amount": 5000, "account": "acc.c1" }))]).join("\n");
        assert!(first.contains("kind=hearing") && first.contains("complaints desk hears: billing, noise"), "{first}");
        assert!(first.contains("kind=complaint_notice"), "{first}");
        assert!(d.day(DAY, &[]).is_empty(), "nothing more until the time to answer has run");
    }

    #[test]
    fn with_no_answer_the_applicants_account_stands_and_the_decision_orders_payment() {
        let mut d = rig(json!({}));
        d.day(0, &[apply("rec.1", 0, json!({ "matter": "billing", "against": "firm-1", "amount": 5000, "account": "acc.c1", "evidence": { "id": "rec.0" } }))]);
        let out = d.day(15 * DAY, &[]).join("\n");
        assert!(out.contains("kind=venue_decision") && out.contains("\"finding\":\"pay\"") && out.contains("\"amount\":5000"), "{out}");
        assert!(d.day(16 * DAY, &[]).is_empty(), "decided once");
    }

    #[test]
    fn an_application_it_does_not_hear_or_with_no_particulars_is_turned_away() {
        let mut d = rig(json!({}));
        let out = d.day(0, &[apply("rec.1", 0, json!({ "matter": "gossip", "against": "firm-1" })), apply("rec.2", 0, json!({ "matter": "billing", "against": "firm-1" }))]).join("\n");
        assert!(out.contains("\"finding\":\"rejected\""), "{out}");
        let later = d.day(15 * DAY, &[]).join("\n");
        assert!(later.contains("no particulars") && later.contains("\"finding\":\"dismissed\""), "{later}");
    }

    #[test]
    fn a_recommending_desk_recommends_and_a_new_holder_does_not_decide_a_decided_case_again() {
        let mut d = rig(json!({}));
        d.day(0, &[apply("rec.1", 0, json!({ "matter": "noise", "against": "firm-1", "seeks": "stop", "evidence": { "id": "rec.0" } }))]);
        let out = d.day(15 * DAY, &[]).join("\n");
        assert!(out.contains("should put it right") && out.contains("\"binding\":false"), "{out}");
        // The decision is on the desk's file: a successor, shown the file, decides nothing again.
        let mut dec = st("rec.9", 15 * DAY, "venue_decision", "desk", &["c0001", "firm-1"], json!({ "application": "rec.1", "finding": "do" }));
        dec["in_position"] = json!("complaints");
        let mut s = rig(json!({}));
        let again = s.day(16 * DAY, &[apply("rec.1", 0, json!({ "matter": "noise", "against": "firm-1", "seeks": "stop" })), dec]).join("\n");
        assert!(!again.contains("venue_decision"), "{again}");
    }

    #[test]
    fn the_manifest_is_the_one_the_ts_module_wrote() {
        let ts: Value = crate::offices::testing::ts_manifest("office.desk");
        let rust = Desk.manifest();
        for (k, v) in ts.as_object().unwrap() {
            assert_eq!(&rust[k], v, "{k}");
        }
    }
}
