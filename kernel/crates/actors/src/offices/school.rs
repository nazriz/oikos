//! school.principal: a school's principal (docs/behaviour/education.md; docs/design/world-expansion.md 4). Ported from
//! participants/src/behaviour/school.ts (0.3.1) to Rust; the version string is the TS manifest's.
//!
//! The school keeps the teachers its establishment says (hired and paid like any employer's staff), gives a place to
//! each child of school age who asks (enrolment), and on each school day has a teacher teach each classroom: work done
//! to everyone in the room, which is what raises a pupil's skill (the world's physics). A pupil who leaves at the end of
//! school gets a certificate of the years they were taught here and before.
//!
//! **What a successor reads from the file** (bug hunt 2026-10-17, finding 2). The roll is the school's own places on
//! file (each `school_place` of ours, with the enrolment it cites): nobody is "in the pupils" only in memory. An
//! enrolment is answered when a place or a decline of ours cites it; a pupil has finished when a certificate of ours
//! names them (or a death is registered). In memory remain a cache of papers sent and not yet seen back (`settled`),
//! and the day the lessons were set (`taught_day`: nothing on paper says a lesson was taught, so a successor in the
//! same morning could set the lessons twice; the world refuses a teacher more hours than the day has).
//!
//! Decided fresh: first wake spread by a hash of the participant id (no keyed stream at that point); the roll is
//! derived each wake from the file rather than kept in a map.

use crate::common::{addressed_to, bases_of, data, filed_before, out_of_time, work::ReportOf, work::Routine, Book, Fields, Part, StandingWork, DAY};
use crate::offices::police::{as_text, param, spread};
use crate::firms::staffing::{Own, Staffing, StaffingOpts, Want};
use crate::papers::agreements;
use crate::steps::{arg, because, call, json, say, Done, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms;
use oikos_sight::Seen;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub struct Principal;

/// Schooling: who goes to school (the ages), and what adults have had (their highest level, as years).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SchoolingSpec {
    pub school_ages: [i64; 2],
    pub attainment: Vec<Attainment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attainment {
    pub label: String,
    pub share_bps: i64,
    pub years: i64,
}

/// Years of schooling at an age: a child's, the years since starting (to the end of school); an adult's, drawn from the
/// attainment shares (`pick(n)`: a uniform draw below n). Shared by the world's generator and the migration office.
pub fn years_of_schooling(age: i64, s: &SchoolingSpec, mut pick: impl FnMut(i64) -> i64) -> i64 {
    if age < 18 {
        return (age.min(s.school_ages[1] + 1) - s.school_ages[0]).max(0);
    }
    let total: i64 = s.attainment.iter().map(|a| a.share_bps).sum();
    let mut x = pick(total.max(1));
    for a in &s.attainment {
        if x < a.share_bps {
            return a.years;
        }
        x -= a.share_bps;
    }
    s.attainment.last().map_or(0, |a| a.years)
}

const ENROL: &str = "enrol";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    building: String,
    workplace: String,
    classrooms: Vec<String>,
    account: String,
    teachers: i64,
    role: String,
    wage: i64,
    period: i64,
    notice_days: i64,
    industry: String,
    teach_task: String,
    starts: i64,
    term_days: i64,
    school_ages: [i64; 2],
    year: i64,
    channel: String,
    part: String,
}

impl Kind for Principal {
    fn name(&self) -> &'static str {
        "school.principal"
    }
    // Ported to Rust with the roll, enrolments and certificates read from the school's own file. TS 0.3.1: returns of tax
    // withheld are filed on the days the law states; 0.3.0: its teachers report to the principal the lessons taught
    // under the standing order, or why none were.
    fn version(&self) -> &'static str {
        "0.3.1"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/education.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "account": param("string", Some("what it pays its staff from (its funding comes in there)"), json!(""), None, true, Some("placeholder")),
                "building": param("string", Some("the school, and where its teachers work (the world must say)"), json!(""), None, true, None),
                "channel": param("string", Some("its view of the building, who is where in it"), json!("premises"), None, false, Some("placeholder")),
                "classrooms": param("array", Some("its classrooms (spaces of the building)"), json!([]), None, false, Some("placeholder")),
                "industry": param("string", None, json!("education"), None, false, None),
                "lesson_seconds": param("integer", None, json!(6 * 3600), Some("seconds"), false, None),
                "notice_days": param("integer", None, json!(14), Some("days"), false, None),
                "part": param("string", None, json!(""), None, false, None),
                "period": param("integer", None, json!(14 * DAY), None, false, None),
                "role": param("string", None, json!("teacher"), None, false, None),
                "school_ages": param("array", Some("from the year one turns the first, to the end of the year one is the second"), json!([5, 17]), None, false, Some("placeholder")),
                "starts": param("integer", Some("when the school day starts (placeholder)"), json!(30600), None, false, None),
                "teach_task": param("string", None, json!("teach"), None, false, None),
                "teachers": param("integer", Some("the establishment: how many teachers it keeps (its funder's)"), json!(0), None, false, Some("placeholder")),
                "term_days": param("integer", None, json!(70), Some("days"), false, None),
                "wage": param("integer", None, json!(0), None, false, None),
                "working_day": param("integer", None, json!(8 * 3600), None, false, None),
                "workplace": param("string", None, json!(""), None, true, None),
                "year": param("integer", None, json!(365 * DAY), None, false, None),
            },
            "perceives": [], "state": "none",
            "keeps": [
                { "what": "school_enrolment", "why": "A school keeps its own roll: every pupil's enrolment is made with it." },
                { "what": "school_place", "why": "The places it has given, each to a pupil on its own roll." },
            ],
            "issues": forms::group("JOB_ADVERTISEMENT"),
            "routines": [
                { "task": "teach", "at": "building", "every": 1, "what": "Each school day, each classroom with pupils in it is taught by one of the teachers at work." },
                { "task": ENROL, "at": "building", "every": 1, "what": "The school office answers each enrolment: a place in the least full classroom for a child of school age, or a letter saying why not; and gives each leaver a certificate of their years." },
            ],
            "answers": { "office": "the school", "acts": "It teaches the children who come to it on school days. It enrols nobody by letter." },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        8 * 3600 + spread(&ctx.participant, 1800)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params {
            building: ctx.need("building", "school.principal")?,
            workplace: ctx.need("workplace", "school.principal")?,
            classrooms: ctx.param("classrooms", vec![])?,
            account: ctx.need("account", "school.principal")?,
            teachers: ctx.param("teachers", 0)?,
            role: ctx.param("role", "teacher".to_string())?,
            wage: ctx.param("wage", 0)?,
            period: ctx.param("period", 14 * DAY)?,
            notice_days: ctx.param("notice_days", 14)?,
            industry: ctx.param("industry", "education".to_string())?,
            teach_task: ctx.param("teach_task", "teach".to_string())?,
            starts: ctx.param("starts", 30_600)?,
            term_days: ctx.param("term_days", 70)?,
            school_ages: ctx.param("school_ages", [5, 17])?,
            year: ctx.param("year", 365 * DAY)?,
            channel: ctx.param("channel", "premises".to_string())?,
            part: ctx.param("part", String::new())?,
        };
        let me = ctx.entity.clone();
        let part = Part::from_param(&p.part);
        let staff = Staffing::new(
            &me,
            StaffingOpts { workplace: Some(p.workplace.clone()), industry: Some(p.industry.clone()), own: Some(Own::RoleOrUnnamed), ..StaffingOpts::new(p.period, p.notice_days, &p.role) },
        );
        Ok(Box::new(Stepper::new(School {
            routines: StandingWork::new(&me, part, []),
            position: ctx.position.clone().unwrap_or_default(),
            me,
            p,
            part,
            book: Book::new(),
            staff,
            view: None,
            settled: BTreeSet::new(),
            taught_day: -1,
            report_day: -1,
            telling: false,
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<School>::restore(saved)?))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum Then {
    Lesson,
}

#[derive(Serialize, Deserialize)]
struct School {
    me: String,
    position: String,
    p: Params,
    part: Part,
    book: Book,
    staff: Staffing,
    routines: StandingWork,
    view: Option<oikos_sight::SiteStructure>,
    /// Papers of ours sent and not yet seen back on the file (enrolments answered, certificates given).
    settled: BTreeSet<String>,
    taught_day: i64,
    report_day: i64,
    telling: bool,
}

impl School {
    fn in_room(&self, space: &str) -> Vec<String> {
        let occ = self.view.as_ref().and_then(|v| v.spaces.iter().find(|sp| sp.space == space)).and_then(|sp| sp.occupants.clone()).unwrap_or_default();
        occ.into_iter().collect::<BTreeSet<_>>().into_iter().map(|x| x.to_string()).collect()
    }
}

impl Plan for School {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, _cx: &mut Cx) {
        self.book.absorb(pic);
        self.staff.absorb(pic);
        if let Some(Seen::Sites { cells, .. }) = pic.channels.get(self.p.channel.as_str()) {
            for c in cells.iter() {
                if let Some(s) = &c.structure {
                    if s.structure == self.p.building {
                        self.view = Some((**s).clone());
                    }
                }
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let t = pic.t;
        let me = self.me.clone();
        let mut steps: Vec<Step<Then>> = vec![];
        let routines = [
            Routine { task: &self.p.teach_task, at: &self.p.building, every: DAY, why: "Setting the teachers' work: every classroom with pupils taught each school day, as a standing work order." },
            Routine { task: ENROL, at: &self.p.building, every: DAY, why: "Setting the school office's work: enrolments answered and leavers' certificates given, as a standing work order." },
        ];
        steps.extend(self.routines.set::<Then>(&self.book, &routines));
        let enrolling = self.routines.does(&self.book, ENROL, t, DAY).is_some();
        let workers = self.staff.workers(&self.book, t);
        if self.part != Part::Staff {
            let want = Want {
                target: self.p.teachers.max(0),
                wage: self.p.wage,
                can_post: (workers.len() as i64) < self.p.teachers,
                why: Some(format!("The school's establishment is {} teachers; we have {}: posting a job.", self.p.teachers, workers.len())),
                ..Default::default()
            };
            steps.extend(self.staff.routine(pic, &self.book, cx, &self.p.account, &want));
        }

        // ---- the roll, from the school's own file ----
        let ours = |r: &oikos_sight::Record| r.speaks_for.as_deref() == Some(me.as_str());
        // (Our roll: the places we've given, each to a pupil on it.)
        let mut placed: BTreeMap<String, std::sync::Arc<oikos_sight::Record>> = BTreeMap::new();
        for x in self.book.open("school_place").filter(|x| ours(x)) {
            if let Some(who) = addressed_to(x).first() {
                placed.insert(who.to_string(), x.clone());
            }
        }
        let mut answered: BTreeSet<String> = self.settled.clone();
        for k in ["school_place", "school_decline"] {
            for x in self.book.all(k).filter(|x| ours(x)) {
                answered.extend(bases_of(x).iter().map(|x| x.to_string()));
            }
        }
        let certified: BTreeSet<String> = self.book.all("school_certificate").filter(|x| ours(x)).filter_map(|x| data(x).s("person").map(String::from)).collect();
        let dead: BTreeSet<String> = self.book.all("death_registration").chain(self.book.all("death_certificate")).filter_map(|r| data(r).s("deceased").map(String::from)).collect();

        // ---- enrolment: a place for each child of school age who asks, in the least full classroom ----
        if enrolling {
            let mut asks: Vec<_> = self.book.open("school_enrolment").filter(|x| addressed_to(x).iter().any(|x| x == &me) && !answered.contains(x.id.as_str())).cloned().collect();
            asks.sort_by(|a, b| filed_before(&a.id, &b.id));
            for r in asks {
                self.settled.insert(r.id.to_string());
                self.routines.did(ENROL, t, 1, &[]);
                let Some(who) = r.speaks_for else { continue };
                if placed.contains_key(who.as_str()) {
                    continue; // (already has a place)
                }
                let born = data(&r).i("born_at");
                let age = born.map_or(-1, |b| (t - b).div_euclid(self.p.year));
                let ok = age >= self.p.school_ages[0] && age <= self.p.school_ages[1] && !self.p.classrooms.is_empty();
                let mut rooms: Vec<(usize, &String)> = self.p.classrooms.iter().map(|c| (self.in_room(c).len(), c)).collect();
                rooms.sort();
                let room = rooms.first().map(|x| x.1.clone()).unwrap_or_default();
                let (why, kind, words, d) = if ok {
                    (format!("A child of school age ({age}) asks for a place: offering one in {room}."), "school_place", format!("A place at the school, in {room}."), json!({ "classroom": room, "building": self.p.building }))
                } else {
                    (format!("An enrolment for someone not of school age ({age}): declined."), "school_decline", "No place: not of school age.".to_string(), json!({}))
                };
                steps.push(because(why, vec![say(kind, &words, Say { to: Some(vec![who.to_string()]), visible: Some(Visible::Only(vec![who.to_string(), me.clone()])), basis: Some(r.id.to_string()), data: Some(d), ..Default::default() })]));
            }
        }

        // ---- a school day: each classroom with pupils, taught by a teacher at work ----
        let day = t.div_euclid(DAY);
        let school_day = day.rem_euclid(7) < 5 && day.rem_euclid(91) < self.p.term_days;
        if school_day && self.taught_day != day && self.routines.does(&self.book, &self.p.teach_task, t, DAY).is_some() {
            self.taught_day = day;
            let mine: BTreeSet<&String> = workers.iter().collect();
            let here: Vec<String> = self.in_room(&self.p.workplace).into_iter().filter(|w| mine.contains(w)).collect();
            let rooms: Vec<String> = self.p.classrooms.iter().filter(|room| self.in_room(room).iter().any(|x| !mine.contains(x))).cloned().collect();
            // (For the teachers' report: who taught, the classrooms left without a teacher, or that nobody of those in post
            // since before today was at the school.)
            let before = self.staff.staff(&self.book, t).iter().filter(|a| self.book.signed_at(&a.id).unwrap_or(0) < day * DAY).count();
            let task = self.p.teach_task.clone();
            if here.is_empty() && before > 0 {
                self.routines.held_up(&task, &format!("none of the {before} in post was at the school ({}) when the school day began", self.p.workplace));
            }
            let short = rooms.len() as i64 - here.len() as i64;
            self.routines.note(&task, (!here.is_empty() && short > 0).then(|| format!("{short} classroom{} with pupils had no teacher today", if short > 1 { "s" } else { "" })));
            self.telling = self.part == Part::Staff && (!here.is_empty() || before > 0);
            for (i, room) in rooms.iter().enumerate() {
                let Some(teacher) = here.get(i) else { continue };
                self.routines.did(&task, t, 1, std::slice::from_ref(teacher));
                let c = call("work", vec![("task", Some(arg(&task))), ("units", Some(arg("1"))), ("at", Some(arg(&self.p.building))), ("by", Some(json(json!([teacher])))), ("on", Some(arg(room)))]);
                let mut s = because(format!("A school day: {teacher} teaches {room} ({} pupils).", self.in_room(room).len()), vec![c]);
                s.then = Some(Then::Lesson);
                steps.push(s);
            }
        }

        // ---- leaving: a pupil past school age gets a certificate of their years (one who has died, nothing) ----
        if enrolling {
            for (who, place) in &placed {
                if certified.contains(who) || self.settled.contains(&format!("cert:{who}")) || dead.contains(who) {
                    continue;
                }
                let enrolment = bases_of(place).first().and_then(|b| self.book.get(b));
                let years_before = enrolment.and_then(|e| data(e).i("years_before")).unwrap_or(0);
                let born = enrolment.and_then(|e| data(e).i("born_at"));
                if let Some(b) = born {
                    if (t - b).div_euclid(self.p.year) <= self.p.school_ages[1] {
                        continue;
                    }
                } else {
                    continue; // (no birth to age by: the pupil stays on the roll)
                }
                self.settled.insert(format!("cert:{who}"));
                let years = (years_before * self.p.year + (t - place.at) + self.p.year / 2).div_euclid(self.p.year);
                steps.push(because(
                    format!("{who} has finished school: a certificate of {years} years."),
                    vec![say("school_certificate", &format!("Certificate: {who} completed {years} years of school."), Say { to: Some(vec![who.clone()]), visible: Some(Visible::Only(vec![who.clone(), me.clone()])), data: Some(json!({ "person": who, "years": years, "school": me })), ..Default::default() })],
                ));
            }
        }
        // The teachers' report to the principal, once each school day (docs/behaviour/standing-work.md, "The staff's report").
        if self.telling && self.report_day != day {
            self.report_day = day;
            let no_place: Vec<String> = self
                .staff
                .staff(&self.book, t)
                .iter()
                .filter_map(|a| {
                    let w = agreements::parties_of(a).get(1).cloned().unwrap_or_default();
                    agreements::job_terms(a, &w, Some(&self.book)).workplace.is_none().then_some(w)
                })
                .collect();
            let office = self.position.strip_suffix("-staff").unwrap_or(&self.position).to_string();
            let from = format!("the school's {}s", self.p.role);
            let o = ReportOf { office: &office, from: &from, tasks: vec![(self.p.teach_task.as_str(), "lessons", None), (ENROL, "enrolments answered", None)], in_post: Some(workers.clone()), no_place, ..Default::default() };
            steps.extend(self.routines.report::<Then>(&self.book, cx, &o));
        }
        self.telling = false;
        let _ = as_text::<oikos_core::Frozen>;
        steps
    }

    /// The morning, when the school day starts; not wherever the news that last woke it left its cadence.
    fn until(&self, pic: &Picture) -> Option<i64> {
        Some((pic.t.div_euclid(DAY) + 1) * DAY + self.p.starts)
    }

    fn then(&mut self, token: &Then, done: Done, _cx: &mut Cx) -> Vec<Step<Then>> {
        match token {
            Then::Lesson => {
                if !done.applied() {
                    self.routines.undid(&self.p.teach_task, 1);
                    if let Done::Outcome(o) = done {
                        if out_of_time(o).is_some() {
                            self.taught_day = -1; // (try again later today)
                        }
                    }
                }
                vec![]
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::offices::police::tests::{ctx, rec, staff_records, st, Driver};
    use std::sync::Arc;

    fn params() -> Value {
        json!({ "building": "school", "workplace": "school/workplace.1", "account": "acc-school", "teachers": 1, "wage": 300000, "classrooms": ["school/class.1", "school/class.2"] })
    }

    fn school_records() -> Vec<Arc<oikos_sight::Record>> {
        let mut v = staff_records();
        // the police fixture is in the police's name; remake the agreement for the school
        v.clear();
        v.push(rec(json!({ "id": "job-1", "record": "agreement", "author": "p.1", "at": 0, "visible_to": ["police", "teacher-1"],
            "terms": { "template": "employment", "parties": ["police", "teacher-1"], "commitments": [], "text": "teacher-1 works for police as teacher for 3000.00 every 14 days." } })));
        v.push(rec(json!({ "id": "sig-1", "record": "signature", "author": "p.1", "at": 0, "visible_to": ["police"], "agreement": "job-1", "as": "police" })));
        v.push(rec(json!({ "id": "sig-2", "record": "signature", "author": "p.2", "at": 0, "visible_to": ["police"], "agreement": "job-1", "as": "teacher-1" })));
        v
    }

    fn rooms(teacher: bool, pupils: &[&str]) -> Seen {
        let mut a: Vec<&str> = vec![];
        if teacher {
            a.push("teacher-1");
        }
        let cell: oikos_sight::SiteCell = serde_json::from_value(json!({ "cell": "c0", "x": 0, "y": 0, "structure": { "structure": "school", "type": "school", "at": "c0", "w": 1, "h": 1, "complete": true,
            "spaces": [{ "space": "school/workplace.1", "kind": "workplace", "capacity": 10, "count": a.len(), "occupants": a },
                       { "space": "school/class.1", "kind": "classroom", "capacity": 30, "count": pupils.len(), "occupants": pupils },
                       { "space": "school/class.2", "kind": "classroom", "capacity": 30, "count": 0, "occupants": [] }] } })).unwrap();
        Seen::Sites { as_of: 0, cells: Arc::new(vec![cell]), visit: None }
    }

    fn enrol(id: &str, who: &str, born: i64) -> Arc<oikos_sight::Record> {
        st(id, 0, "school_enrolment", who, &["police"], json!({ "born_at": born, "years_before": 0 }))
    }

    #[test]
    fn the_manifest_is_the_one_the_ts_module_wrote() {
        let ts: Value = crate::offices::testing::ts_manifest("school.principal");
        let rust = Principal.manifest();
        for (k, v) in ts.as_object().unwrap() {
            assert_eq!(&rust[k], v, "{k}");
        }
    }

    #[test]
    fn a_child_of_school_age_gets_a_place_and_one_too_young_is_declined_once() {
        let mut s = Driver::new(&Principal, ctx(params()));
        let year = 365 * DAY;
        let t = 20 * year + 8 * 3600; // a Thursday-ish; enrolments answer any day
        let w = s.wake(t, [school_records(), vec![enrol("rec.10", "kid-1", t - 8 * year), enrol("rec.11", "baby-1", t - 2 * year)]].concat(), vec![("premises", rooms(true, &[]))], &|_| false);
        assert_eq!(w.of("school_place").len(), 1, "{:?}", w.calls);
        assert_eq!(w.of("school_decline").len(), 1, "{:?}", w.calls);
        assert!(w.of("school_place")[0].contains("school/class.1"));
        // Answered again? A successor on the same file (with the answers on it) does not answer again.
        let answers = [
            st("rec.20", t, "school_place", "police", &["kid-1"], json!({ "classroom": "school/class.1" })),
            st("rec.21", t, "school_decline", "police", &["baby-1"], json!({})),
        ];
        let answered = answers.iter().map(|a| {
            let mut v = serde_json::to_value(&**a).unwrap();
            v["basis"] = if a.id == "rec.20" { json!("rec.10") } else { json!("rec.11") };
            rec(v)
        });
        let mut next = Driver::new(&Principal, ctx(params()));
        let w = next.wake(t + DAY, [school_records(), vec![enrol("rec.10", "kid-1", t - 8 * year), enrol("rec.11", "baby-1", t - 2 * year)], answered.collect()].concat(), vec![("premises", rooms(true, &["kid-1"]))], &|_| false);
        assert!(w.of("school_place").is_empty() && w.of("school_decline").is_empty(), "{:?}", w.calls);
    }

    #[test]
    fn on_a_school_day_a_teacher_at_work_teaches_each_classroom_with_pupils() {
        let mut s = Driver::new(&Principal, ctx(params()));
        let w = s.wake(DAY + 8 * 3600, school_records(), vec![("premises", rooms(true, &["kid-1"]))], &|_| false);
        let lessons = w.of("work");
        assert_eq!(lessons.len(), 1, "{:?}", w.calls);
        assert!(lessons[0].contains("school/class.1") && lessons[0].contains("teacher-1"));
        // Not on a Saturday (day 5) and not out of term (day 70).
        let mut s = Driver::new(&Principal, ctx(params()));
        assert!(s.wake(5 * DAY + 8 * 3600, school_records(), vec![("premises", rooms(true, &["kid-1"]))], &|_| false).of("work").is_empty());
        let mut s = Driver::new(&Principal, ctx(params()));
        assert!(s.wake(70 * DAY + 8 * 3600, school_records(), vec![("premises", rooms(true, &["kid-1"]))], &|_| false).of("work").is_empty());
        // No teacher at the school, no lesson.
        let mut s = Driver::new(&Principal, ctx(params()));
        assert!(s.wake(DAY + 8 * 3600, school_records(), vec![("premises", rooms(false, &["kid-1"]))], &|_| false).of("work").is_empty());
    }

    #[test]
    fn a_leaver_gets_a_certificate_once_and_the_dead_none() {
        let year = 365 * DAY;
        let t = 30 * year + 8 * 3600;
        let born = t - 19 * year;
        let place = |id: &str, who: &str, enrolment: &str| {
            let mut v = serde_json::to_value(&*st(id, t - 10 * year, "school_place", "police", &[who], json!({ "classroom": "school/class.1" }))).unwrap();
            v["basis"] = json!(enrolment);
            rec(v)
        };
        let records = [school_records(), vec![enrol("rec.10", "old-1", born), enrol("rec.11", "old-2", born), place("rec.20", "old-1", "rec.10"), place("rec.21", "old-2", "rec.11"),
            st("rec.30", t, "death_registration", "city", &["police"], json!({ "deceased": "old-2" }))]]
        .concat();
        let mut s = Driver::new(&Principal, ctx(params()));
        let w = s.wake(t, records.clone(), vec![("premises", rooms(true, &[]))], &|_| false);
        let certs = w.of("school_certificate");
        assert_eq!(certs.len(), 1, "{:?}", w.calls);
        assert!(certs[0].contains("old-1") && certs[0].contains("10 years"), "{}", certs[0]);
        // With the certificate on the file a successor gives none.
        let mut v = serde_json::to_value(&*st("rec.40", t, "school_certificate", "police", &["old-1"], json!({ "person": "old-1", "years": 10 }))).unwrap();
        let mut next = Driver::new(&Principal, ctx(params()));
        let w = next.wake(t + DAY, [records, vec![rec(v)]].concat(), vec![("premises", rooms(true, &[]))], &|_| false);
        assert!(w.of("school_certificate").is_empty(), "{:?}", w.calls);
    }

    #[test]
    fn years_of_schooling_follows_the_ages_and_the_attainment_shares() {
        let s = SchoolingSpec { school_ages: [5, 17], attainment: vec![Attainment { label: "a".into(), share_bps: 3000, years: 10 }, Attainment { label: "b".into(), share_bps: 7000, years: 12 }] };
        assert_eq!(years_of_schooling(3, &s, |_| 0), 0);
        assert_eq!(years_of_schooling(9, &s, |_| 0), 4);
        assert_eq!(years_of_schooling(17, &s, |_| 0), 12);
        assert_eq!(years_of_schooling(40, &s, |n| n - 1), 12);
        assert_eq!(years_of_schooling(40, &s, |_| 0), 10);
    }
}
