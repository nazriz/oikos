//! clinic.practice: a clinic's practice manager (participants/src/behaviour/health.ts 0.3.1; docs/behaviour/health.md;
//! docs/design/world-expansion.md 4). The clinic sees patients who come in and ask for care, in the order they asked,
//! as many as its doctors' hours allow each working day it is open. Seeing a patient is work done to their body: the
//! world's physics says what care does to a condition. The clinic tells the patient they have been seen.
//!
//! Taking on and paying its doctors is firms.ts's `Staffing` (lane C1's, not yet in Rust): left out here, and the
//! doctors are those with an employment agreement with the clinic in force in its book. The integration step puts
//! C1's `Staffing` routine back where TS called it (the office-holder's part, `part` not "staff").
//!
//! Decided fresh: a request's place in the queue is by when it was asked, then by `filed_before` on its id (TS
//! compared ids as strings).

use crate::common::work::{Part, ReportOf, Routine, StandingWork};
use crate::common::{data, filed_before, out_of_time, Book, Fields, DAY};
use crate::papers::agreements::{other_party, template_of};
use crate::steps::{arg, because, call, json, say, text, Done, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_sight::Seen;
use serde::{Deserialize, Serialize};
use serde_json::{json as j, Value};
use std::collections::{BTreeMap, BTreeSet};

const HOUR: i64 = 3_600;

pub struct Practice;

const MANIFEST: &str = include_str!("../../../../../participants/manifests/clinic.practice.json");

impl Kind for Practice {
    fn name(&self) -> &'static str {
        "clinic.practice"
    }
    fn version(&self) -> &'static str {
        "0.3.1"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/health.md"
    }
    fn manifest(&self) -> Value {
        serde_json::from_str(MANIFEST).unwrap_or(Value::Null)
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        // (TS: eight in the morning plus a draw within the hour; the kind is given no streams, so the hour itself.)
        8 * HOUR
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p: Params = serde_json::from_value(Value::Object((*ctx.params).clone())).map_err(|e| format!("clinic.practice's parameters: {e}"))?;
        for (k, v) in [("building", &p.building), ("workplace", &p.workplace), ("waiting", &p.waiting), ("account", &p.account)] {
            if v.is_empty() {
                return Err(format!("clinic.practice: the world must say {k} (whom it deals with; no module assumes a world's names)"));
            }
        }
        let routines = StandingWork::new(&ctx.entity, Part::from_param(&p.part), Vec::<String>::new());
        Ok(Box::new(Stepper::new(Clinic {
            me: ctx.entity.clone(),
            position: ctx.position.clone(),
            p,
            book: Book::new(),
            routines,
            view: None,
            queue: vec![],
            queued: BTreeSet::new(),
            used: BTreeMap::new(),
            used_day: -1,
            report_day: -1,
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Clinic>::restore(saved)?))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Params {
    building: String,
    workplace: String,
    waiting: String,
    account: String,
    doctors: i64,
    role: String,
    treat_task: String,
    consult_seconds: i64,
    working_day: i64,
    work_days: i64,
    opens: i64,
    closes: i64,
    consults: Vec<Consults>,
    give_up_days: i64,
    channel: String,
    part: String,
}
impl Default for Params {
    fn default() -> Self {
        Params {
            building: String::new(),
            workplace: String::new(),
            waiting: String::new(),
            account: String::new(),
            doctors: 0,
            role: "doctor".into(),
            treat_task: "treat".into(),
            consult_seconds: 1_800,
            working_day: 8 * HOUR,
            work_days: 5,
            opens: 8 * HOUR,
            closes: 18 * HOUR,
            consults: vec![],
            give_up_days: 3,
            channel: "premises".into(),
            part: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Consults {
    kind: String,
    #[serde(default)]
    severity: Option<String>,
    consults: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Waiting {
    request: String,
    patient: String,
    kind: String,
    severity: String,
    at: i64,
}

/// What follows from seeing a patient: not seen after all, they go back to the front of the queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Seen_ {
    q: Waiting,
    units: i64,
}

#[derive(Serialize, Deserialize)]
struct Clinic {
    me: String,
    position: Option<String>,
    p: Params,
    book: Book,
    routines: StandingWork,
    /// Who is where in the clinic's building, as last seen: space -> occupants.
    view: Option<BTreeMap<String, Vec<String>>>,
    queue: Vec<Waiting>,
    queued: BTreeSet<String>,
    /// doctor -> seconds worked today.
    used: BTreeMap<String, i64>,
    used_day: i64,
    report_day: i64,
}

impl Clinic {
    fn in_room(&self, space: &str) -> Vec<String> {
        let mut v = self.view.as_ref().and_then(|m| m.get(space)).cloned().unwrap_or_default();
        v.sort();
        v.dedup();
        v
    }
    /// Our doctors: those with an employment agreement with us in force (Staffing's `workers`, lane C1's).
    fn staff(&self, t: i64) -> Vec<(String, i64)> {
        let _ = t;
        let mut v: Vec<(String, i64)> = self
            .book
            .of_type("agreement")
            .filter(|a| template_of(a) == Some("employment") && self.book.in_force(&a.id))
            .filter(|a| crate::papers::agreements::parties_of(a).first().map(String::as_str) == Some(self.me.as_str()))
            .filter_map(|a| other_party(a, &self.me).map(|w| (w.to_string(), self.book.signed_at(&a.id).unwrap_or(0))))
            .collect();
        v.sort();
        v
    }
    fn open_at(&self, t: i64) -> bool {
        let day = t.div_euclid(DAY);
        day % 7 < self.p.work_days && t.rem_euclid(DAY) >= self.p.opens && t.rem_euclid(DAY) < self.p.closes
    }
}

impl Plan for Clinic {
    type Then = Seen_;
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        if let Some(Seen::Sites { cells, .. }) = pic.channels.get(&self.p.channel) {
            for c in cells.iter() {
                if let Some(st) = c.structure.as_ref().filter(|s| s.structure == self.p.building) {
                    self.view = Some(st.spaces.iter().map(|sp| (sp.space.clone(), sp.occupants.clone().unwrap_or_default())).collect());
                }
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Seen_>> {
        let t = pic.t;
        let mut steps: Vec<Step<Seen_>> = self.routines.set(
            &self.book,
            &[Routine { task: &self.p.treat_task, at: &self.p.building, every: DAY, why: "Setting the doctors' work: those waiting are seen each working day, as a standing work order." }],
        );
        // Who has asked for care, in the order they asked.
        let mut asked: Vec<Waiting> = self
            .book
            .open("care_request")
            .filter(|r| crate::common::addressed_to(r).contains(&self.me) && !self.queued.contains(&r.id))
            .map(|r| {
                let d = data(r);
                Waiting {
                    request: r.id.clone(),
                    patient: r.speaks_for.clone().unwrap_or_default(),
                    kind: d.s("kind").unwrap_or("").into(),
                    severity: d.s("severity").unwrap_or("").into(),
                    at: r.at,
                }
            })
            .collect();
        asked.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.request, &b.request)));
        for q in asked {
            self.queued.insert(q.request.clone());
            self.queue.push(q);
        }
        let day = t.div_euclid(DAY);
        if day != self.used_day {
            self.used_day = day;
            self.used.clear();
        }
        // Those who asked and never came, long enough ago, are dropped.
        let give_up = self.p.give_up_days * DAY;
        self.queue.retain(|q| t - q.at <= give_up);
        let open = self.open_at(t);
        let mine: BTreeSet<String> = self.staff(t).into_iter().map(|s| s.0).collect();
        let doctors: Vec<String> = self.in_room(&self.p.workplace).into_iter().filter(|w| mine.contains(w)).collect();
        let report = |c: &mut Clinic, cx: &Cx, doctors: &[String]| -> Vec<Step<Seen_>> {
            if c.p.part != "staff" || !open || c.report_day == day {
                return vec![];
            }
            let before = c.staff(t).iter().filter(|s| s.1 < day * DAY).count();
            if doctors.is_empty() && before == 0 {
                return vec![];
            }
            c.report_day = day;
            if doctors.is_empty() && c.routines.order(&c.book, &c.p.treat_task, t).is_some() {
                let why = format!("none of the {before} in post was at the clinic ({}) when it opened", c.p.workplace);
                c.routines.held_up(&c.p.treat_task, &why);
            }
            let office = c.position.clone().unwrap_or_default();
            let office = office.strip_suffix("-staff").unwrap_or(&office).to_string();
            let from = format!("the clinic's {}s", c.p.role);
            let task = c.p.treat_task.clone();
            let in_post: Vec<String> = mine.iter().cloned().collect();
            let o = ReportOf { office: &office, from: &from, tasks: vec![(&task, "patients seen", Some("consultations"))], in_post: Some(in_post), ..Default::default() };
            let book = std::mem::take(&mut c.book);
            let r = c.routines.report(&book, cx, &o);
            c.book = book;
            r
        };
        if !open || self.queue.is_empty() || self.routines.does(&self.book, &self.p.treat_task, t, DAY).is_none() {
            steps.extend(report(self, cx, &doctors));
            return steps;
        }
        let waiting: BTreeSet<String> = self.in_room(&self.p.waiting).into_iter().collect();
        for q in self.queue.clone() {
            if !waiting.contains(&q.patient) {
                continue;
            }
            let units = self
                .p
                .consults
                .iter()
                .find(|c| c.kind == q.kind && c.severity.as_ref().is_none_or(|s| *s == q.severity))
                .map_or(1, |c| c.consults);
            let need = units * self.p.consult_seconds;
            let Some(doctor) = doctors.iter().find(|d| self.p.working_day - self.used.get(*d).copied().unwrap_or(0) >= need).cloned() else {
                break; // (the doctors' day is full: the rest wait)
            };
            *self.used.entry(doctor.clone()).or_insert(0) += need;
            self.queue.retain(|x| x.request != q.request);
            self.routines.did(&self.p.treat_task, t, units, std::slice::from_ref(&doctor));
            let plural = if units == 1 { "" } else { "s" };
            let st = because(
                format!("{} is waiting with a {} {}: {doctor} sees them ({units} consultation{plural}).", q.patient, q.severity, q.kind),
                vec![
                    call(
                        "work",
                        vec![
                            ("task", Some(arg(&self.p.treat_task))),
                            ("units", Some(text(units.to_string()))),
                            ("at", Some(arg(&self.p.building))),
                            ("by", Some(json(j!([doctor])))),
                            ("on", Some(arg(&q.patient))),
                        ],
                    ),
                    say(
                        "consultation",
                        "You've been seen at the clinic.",
                        Say {
                            to: Some(vec![q.patient.clone()]),
                            visible: Some(Visible::Only(vec![q.patient.clone(), self.me.clone()])),
                            basis: Some(q.request.clone()),
                            data: Some(j!({ "request": q.request, "by": doctor })),
                            ..Default::default()
                        },
                    ),
                ],
            )
            .then(Seen_ { q, units });
            steps.push(st);
        }
        steps.extend(report(self, cx, &doctors));
        steps
    }

    fn then(&mut self, tok: &Seen_, done: Done, _: &mut Cx) -> Vec<Step<Seen_>> {
        if done.applied() {
            return vec![];
        }
        // (Not seen after all: back in the queue, first.)
        self.queue.insert(0, tok.q.clone());
        self.routines.undid(&self.p.treat_task, tok.units);
        if let Done::Outcome(o) = done {
            if let Some((Some(who), left)) = out_of_time(o) {
                self.used.insert(who, self.p.working_day - left);
            }
        }
        vec![]
    }

    /// When it next opens (a wake on its cadence would drift with the news that woke it, to hours it is closed).
    fn until(&self, pic: &Picture) -> Option<i64> {
        let t = pic.t;
        let mut d = t.div_euclid(DAY);
        loop {
            let at = d * DAY + self.p.opens;
            if d % 7 < self.p.work_days && at > t {
                return Some(at);
            }
            d += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clinic(view: &[(&str, &[&str])]) -> Clinic {
        Clinic {
            me: "clinic".into(),
            position: None,
            p: Params { building: "b".into(), workplace: "b/consult.1".into(), waiting: "b/waiting.1".into(), account: "acc".into(), ..Default::default() },
            book: Book::new(),
            routines: StandingWork::new("clinic", Part::from_param(""), Vec::<String>::new()),
            view: Some(view.iter().map(|(s, o)| (s.to_string(), o.iter().map(|x| x.to_string()).collect())).collect()),
            queue: vec![],
            queued: BTreeSet::new(),
            used: BTreeMap::new(),
            used_day: -1,
            report_day: -1,
        }
    }

    #[test]
    fn open_on_working_days_in_its_hours_and_wakes_when_it_next_opens() {
        let c = clinic(&[]);
        assert!(c.open_at(9 * HOUR));
        assert!(!c.open_at(7 * HOUR), "before it opens");
        assert!(!c.open_at(18 * HOUR), "after it closes");
        assert!(!c.open_at(5 * DAY + 9 * HOUR), "the sixth day of the week is not a working day");
        let pic = |t| Picture {
            participant: "p".into(),
            t,
            status: serde_json::from_value(j!("active")).unwrap(),
            entity: "clinic".into(),
            as_position: None,
            body: None,
            positions: vec![],
            outcomes: vec![],
            inbox: vec![],
            channels: Default::default(),
            asking: vec![],
            readings: Default::default(),
            woke_for: "cadence".into(),
            since: 0,
        };
        assert_eq!(c.until(&pic(9 * HOUR)), Some(DAY + 8 * HOUR));
        assert_eq!(c.until(&pic(4 * DAY + 20 * HOUR)), Some(7 * DAY + 8 * HOUR), "Friday evening: Monday morning");
    }

    #[test]
    fn whoever_is_in_a_room_is_read_from_the_view_in_id_order() {
        let c = clinic(&[("b/waiting.1", &["p2", "p1", "p2"])]);
        assert_eq!(c.in_room("b/waiting.1"), vec!["p1".to_string(), "p2".to_string()]);
        assert!(c.in_room("b/consult.1").is_empty());
    }
}
