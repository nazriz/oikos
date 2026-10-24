//! An office's routine work and whom it takes directions from (common.ts `StandingWork`, `CounterWork`, `Directions`,
//! `approvalOf`, `Pace`; docs/behaviour/standing-work.md, directions.md). Who may do what is law and contract, as
//! data (foundations F8): a standing work order, a procedure's `directions` and `approval`, all records on file.

use super::book::Book;
use super::{bases_of, data, first_due, is_kind, Fields, DAY};
use crate::steps::{because, call, secs, Say, Step, Visible};
use crate::Cx;
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Which part of an office a participant does (StandingWork's `part`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Part {
    /// The whole office, as code runs one: its routine by its own practice, with no order.
    #[default]
    Whole,
    /// The office-holder alone, where a model holds the office and its staff are a post of their own: makes the
    /// standing orders, does none of the routine.
    Seat,
    /// The office's staff: the routine a standing order in force is for, and nothing else of the office's business.
    Staff,
}

impl Part {
    /// From a module's `part` parameter ("" | "seat" | "staff").
    pub fn from_param(s: &str) -> Part {
        match s {
            "seat" => Part::Seat,
            "staff" => Part::Staff,
            _ => Part::Whole,
        }
    }
}

/// A standing work order as the staff read it (contracts/calls.md, a standing work order).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkOrder {
    pub id: String,
    pub task: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub on: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub by: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units: Option<i64>,
    /// Seconds between times it falls due; nought where the order names the paper that sets when (`schedule`).
    pub every: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    pub from: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
}

/// Who approves a payment over what sum, as the payments procedure states it (`data.approval`: the post and the sum in
/// cents). None where the procedure is not on file, is withdrawn with nothing in its place, or states none.
pub fn approval_of(book: &Book, procedure: &str) -> Option<(String, i64)> {
    if procedure.is_empty() || book.repealed(procedure) {
        return None;
    }
    let a = data(book.get(procedure)?).get("approval")?;
    Some((a.s("by")?.to_string(), a.get("over").and_then(Value::as_i64)?))
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Count {
    times: i64,
    units: i64,
}

/// Standing work (docs/behaviour/standing-work.md): an office's routine is its staff's, done by the organisation's
/// standing work orders each time one falls due, in their hours, until replaced, withdrawn or put on hold. Saved with
/// the actor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StandingWork {
    me: String,
    pub part: Part,
    /// The posts whose orders are ours, where more than one office speaks for the same organisation. Empty: every
    /// order of the organisation's is.
    offices: BTreeSet<String>,
    made: BTreeSet<String>,
    count: BTreeMap<String, Count>,
    stuck: BTreeMap<String, String>,
    said: BTreeMap<String, String>,
    last_at: BTreeMap<String, (i64, String)>,
    reported: Option<(i64, String)>,
}

/// A routine as the office-holder sets an order for it (`StandingWork::set`).
#[derive(Debug, Clone)]
pub struct Routine<'a> {
    pub task: &'a str,
    pub at: &'a str,
    pub every: i64,
    pub why: &'a str,
}

/// What the staff report on (`StandingWork::report`).
#[derive(Debug, Clone, Default)]
pub struct ReportOf<'a> {
    /// The post whose staff they are.
    pub office: &'a str,
    /// What they are called in the report's words.
    pub from: &'a str,
    /// Their routines, each with what its count is of: (task, times word, units word).
    pub tasks: Vec<(&'a str, &'a str, Option<&'a str>)>,
    /// Where the staff are people: who is in post (`Some(empty)`: nobody, so nobody reports).
    pub in_post: Option<Vec<String>>,
    /// Of those, who has no place of work in their agreement or its advertisement.
    pub no_place: Vec<String>,
    /// How often a report is due with nothing changed (default a week).
    pub every: Option<i64>,
}

impl StandingWork {
    pub fn new(me: &str, part: Part, offices: impl IntoIterator<Item = String>) -> Self {
        StandingWork { me: me.to_string(), part, offices: offices.into_iter().collect(), ..Default::default() }
    }

    /// The organisation's standing work orders that are ours, in the order seen.
    fn orders<'a>(&'a self, book: &'a Book) -> impl Iterator<Item = &'a Arc<Record>> + 'a {
        book.open("work_order").filter(move |x| {
            x.speaks_for.as_deref() == Some(self.me.as_str())
                && (self.offices.is_empty() || x.position.as_ref().is_none_or(|p| self.offices.contains(p)))
        })
    }

    fn task_of(r: &Record) -> Option<&str> {
        data(r).get("work").and_then(|w| w.s("task"))
    }

    /// The standing order in force for a task: our latest one standing for it, begun, not ended, and not on hold.
    pub fn order(&self, book: &Book, task: &str, t: i64) -> Option<WorkOrder> {
        let r = self.orders(book).filter(|x| Self::task_of(x) == Some(task)).fold(None::<&Arc<Record>>, |a, b| match a {
            Some(a) if b.at < a.at => Some(a),
            _ => Some(b),
        })?;
        let d = data(r);
        let from = first_due(r, 0);
        let schedule = d.s("schedule").filter(|s| !s.is_empty()).map(String::from);
        let every = d.get("every").and_then(Value::as_i64);
        let until = d.get("until").and_then(Value::as_i64);
        if (schedule.is_none() && every.is_none_or(|e| e <= 0)) || t < from || until.is_some_and(|u| t >= u) {
            return None;
        }
        if book.on_hold(&r.id, Some(std::slice::from_ref(&self.me))) {
            return None;
        }
        let w = d.get("work").cloned().unwrap_or(Value::Null);
        let list = |k: &str| match w.get(k) {
            Some(Value::Array(a)) if a.iter().all(Value::is_string) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
            _ => vec![],
        };
        Some(WorkOrder {
            id: r.id.clone(),
            task: task.to_string(),
            at: w.s("at").map(String::from),
            on: list("on"),
            by: list("by"),
            units: w.get("units").and_then(Value::as_i64),
            every: if schedule.is_none() { every.unwrap_or(0) } else { 0 },
            schedule,
            from,
            until,
        })
    }

    /// Whether this participant does a routine task now, and by what: the whole office by its own practice (`own`:
    /// how often); the staff by the order in force (none: they don't); the office-holder never.
    pub fn does(&self, book: &Book, task: &str, t: i64, own_every: i64) -> Option<(i64, Option<WorkOrder>)> {
        match self.part {
            Part::Seat => None,
            Part::Whole => Some((own_every, None)),
            Part::Staff => {
                let o = self.order(book, task, t)?;
                // (An order that names the paper that sets when: the staff's own practice keeps the time.)
                Some((if o.every > 0 { o.every } else { own_every }, Some(o)))
            }
        }
    }

    /// For the office-holder: a standing order for each routine that has none on file, made once.
    pub fn set<T>(&mut self, book: &Book, routines: &[Routine]) -> Vec<Step<T>> {
        if self.part != Part::Seat {
            return vec![];
        }
        let mut steps = vec![];
        for r in routines {
            if !self.made.insert(r.task.to_string()) {
                continue;
            }
            if book.all("work_order").any(|x| x.speaks_for.as_deref() == Some(self.me.as_str()) && Self::task_of(x) == Some(r.task)) {
                continue;
            }
            steps.push(because(
                r.why,
                vec![call("work", vec![("task", Some(crate::steps::arg(r.task))), ("at", Some(crate::steps::arg(r.at))), ("every", Some(secs(r.every)))])],
            ));
        }
        steps
    }

    /// The standing orders of ours that stand, in words, for a report.
    pub fn words(&self, book: &Book, t: i64) -> String {
        let all: Vec<&Arc<Record>> = self.orders(book).collect();
        if all.is_empty() {
            return "none".into();
        }
        all.iter()
            .map(|x| {
                let task = Self::task_of(x).unwrap_or("");
                let rhythm = match data(x).s("schedule") {
                    Some(s) => format!("as {s} sets"),
                    None => format!("every {} days", round_days(data(x).i("every").unwrap_or(0))),
                };
                let in_force = self.order(book, task, t).is_some_and(|o| o.id == x.id);
                format!("{} ({task} {rhythm}{})", x.id, if in_force { "" } else { ", not in force" })
            })
            .collect::<Vec<_>>()
            .join(", ")
    }

    // ---- the staff's report to their office

    /// The staff did a task under its order: once more, so many units, by whom.
    pub fn did(&mut self, task: &str, t: i64, units: i64, by: &[String]) {
        if self.part != Part::Staff {
            return;
        }
        let c = self.count.entry(task.to_string()).or_default();
        c.times += 1;
        c.units += units;
        self.stuck.remove(task);
        for w in by {
            self.last_at.insert(w.clone(), (t, task.to_string()));
        }
    }
    /// What was counted as done turned out not to be (the act was refused): taken back.
    pub fn undid(&mut self, task: &str, units: i64) {
        if let Some(c) = self.count.get_mut(task) {
            c.times = (c.times - 1).max(0);
            c.units = (c.units - units).max(0);
        }
    }
    /// A task whose order is in force could not be done when it fell due, and why, as the staff would tell it.
    pub fn held_up(&mut self, task: &str, why: &str) {
        if self.part == Part::Staff {
            self.stuck.insert(task.to_string(), why.to_string());
        }
    }
    /// How a task stands beyond the count, for the report (none: nothing to add).
    pub fn note(&mut self, task: &str, words: Option<String>) {
        match words {
            Some(w) => {
                self.said.insert(task.to_string(), w);
            }
            None => {
                self.said.remove(task);
            }
        }
    }

    /// The staff's report, when one is due: at once when how an order stands has changed (from the next day), and
    /// each `every` (a week) otherwise. A `staff_report` on the organisation's own file, to it alone; its data is
    /// typed as `papers::offices`'s staff report. With nobody in post there is nobody to report.
    pub fn report<T>(&mut self, book: &Book, cx: &Cx, o: &ReportOf) -> Vec<Step<T>> {
        let t = cx.t;
        if self.part != Part::Staff || o.in_post.as_ref().is_some_and(Vec::is_empty) {
            return vec![];
        }
        let dated = |x: i64| super::when_words(x, &cx.ctx.world);
        let named: Vec<&str> = o.tasks.iter().map(|x| x.0).collect();
        let mut all: Vec<&Arc<Record>> =
            self.orders(book).filter(|x| x.position.as_deref() == Some(o.office) || Self::task_of(x).is_some_and(|k| named.contains(&k))).collect();
        all.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| super::filed_before(&a.id, &b.id)));
        let unordered: Vec<&str> = if t >= DAY { named.iter().copied().filter(|k| !all.iter().any(|x| Self::task_of(x) == Some(k))).collect() } else { vec![] };
        if all.is_empty() && unordered.is_empty() {
            return vec![];
        }
        struct Line {
            order: Option<String>,
            task: String,
            every: i64,
            schedule: Option<String>,
            state: &'static str,
            why: Option<String>,
            count: Option<Count>,
            words: String,
        }
        let mut lines: Vec<Line> = vec![];
        for r in &all {
            let task = Self::task_of(r).unwrap_or("").to_string();
            let every = data(r).i("every").unwrap_or(0);
            let schedule = data(r).s("schedule").map(String::from);
            let head = |state, words: String| Line { order: Some(r.id.clone()), task: task.clone(), every, schedule: schedule.clone(), state, why: None, count: None, words };
            if !named.contains(&task.as_str()) {
                lines.push(head("no_such_task", format!("not carried out: the staff have no routine called \"{task}\" (their routines: {})", named.join(", "))));
                continue;
            }
            let latest = all.iter().filter(|x| Self::task_of(x) == Some(task.as_str())).fold(*r, |a, b| if b.at >= a.at { b } else { a });
            if latest.id != r.id {
                lines.push(head("replaced", format!("replaced by {}", latest.id)));
                continue;
            }
            let from = r.at + data(r).get("first").and_then(Value::as_i64).unwrap_or(0);
            if book.on_hold(&r.id, Some(std::slice::from_ref(&self.me))) {
                lines.push(head("on_hold", "on hold: not carried out while the hold stands".into()));
                continue;
            }
            if t < from {
                lines.push(head("not_begun", format!("begins {}", dated(from))));
                continue;
            }
            if let Some(u) = data(r).get("until").and_then(Value::as_i64).filter(|u| t >= *u) {
                lines.push(head("ended", format!("ended {}", dated(u))));
                continue;
            }
            let c = self.count.get(&task).copied();
            let why = self.stuck.get(&task).cloned();
            let more = self.said.get(&task).cloned();
            let (_, times_w, units_w) = o.tasks.iter().find(|x| x.0 == task).copied().unwrap_or(("", "times", None));
            let more_s = more.map(|m| format!("; {m}")).unwrap_or_default();
            if let (Some(w), true) = (&why, c.is_none_or(|c| c.times == 0)) {
                let mut l = head("not_carried_out", format!("not carried out: {w}{more_s}"));
                l.why = Some(w.clone());
                lines.push(l);
                continue;
            }
            let done = match c {
                Some(c) if c.times > 0 => {
                    let u = match units_w {
                        Some(u) if c.units > 0 => format!(", {} {u}", c.units),
                        _ => String::new(),
                    };
                    format!("carried out: {} {times_w}{u}", c.times)
                }
                _ => "in force; nothing fell due".into(),
            };
            let then = why.as_ref().map(|w| format!("; then not carried out: {w}")).unwrap_or_default();
            let mut l = head("followed", format!("{done}{then}{more_s}"));
            l.count = c;
            lines.push(l);
        }
        for task in unordered {
            let more = self.said.get(task).map(|m| format!("; {m}")).unwrap_or_default();
            lines.push(Line {
                order: None,
                task: task.into(),
                every: 0,
                schedule: None,
                state: "no_order",
                why: None,
                count: None,
                words: format!("not being done: no standing work order for {task} is on file, and with none the staff do not do it (whoever holds the office makes one){more}"),
            });
        }
        let key = lines.iter().map(|x| format!("{}:{}:{}", x.order.as_deref().unwrap_or(&x.task), x.state, x.why.as_deref().unwrap_or(""))).collect::<Vec<_>>().join("|");
        let last = self.reported.clone();
        self.stuck.clear();
        let due = match &last {
            None => true,
            Some((at, k)) if *k != key => t.div_euclid(DAY) > at.div_euclid(DAY),
            Some((at, _)) => t - at >= o.every.unwrap_or(7 * DAY) - DAY / 2,
        };
        if !due {
            return vec![];
        }
        let since = last.as_ref().map(|x| x.0);
        self.reported = Some((t, key.clone()));
        self.count.clear();
        let staff: Vec<Value> = o
            .in_post
            .iter()
            .flatten()
            .map(|p| {
                let mut v = json!({ "person": p });
                if let Some((at, task)) = self.last_at.get(p) {
                    v["last"] = json!(at);
                    v["task"] = json!(task);
                }
                if o.no_place.contains(p) {
                    v["no_place"] = json!(true);
                }
                v
            })
            .collect();
        let people = if staff.is_empty() {
            String::new()
        } else {
            let each: Vec<String> = staff
                .iter()
                .map(|x| {
                    let p = x["person"].as_str().unwrap_or("");
                    match x.get("last").and_then(Value::as_i64) {
                        Some(at) => format!("{p} last worked {} ({})", dated(at), x["task"].as_str().unwrap_or("")),
                        None if x.get("no_place").is_some() => {
                            format!("{p} has not come in to work (no place of work in the employment agreement or the advertisement it cites)")
                        }
                        None => format!("{p} has not come in to work"),
                    }
                })
                .collect();
            format!(" In post {}: {}.", staff.len(), each.join("; "))
        };
        let said: Vec<String> = lines
            .iter()
            .map(|x| match &x.order {
                None => format!("{}: {}", x.task, x.words),
                Some(id) => {
                    let rhythm = match &x.schedule {
                        Some(s) if !s.is_empty() => format!("as {s} sets"),
                        _ => {
                            let d = round_days(x.every);
                            if d == 0 {
                                "every ? days".into()
                            } else {
                                format!("every {d} day{}", if d == 1 { "" } else { "s" })
                            }
                        }
                    };
                    format!("{} ({id}, {rhythm}): {}", x.task, x.words)
                }
            })
            .collect();
        let since_w = since.map(|s| format!(" since {}", dated(s))).unwrap_or_default();
        let words = format!("Report of {}, {}, on the work under the office's standing work orders{since_w}. {}.{people}", o.from, dated(t), said.join(". "));
        let orders: Vec<Value> = lines
            .iter()
            .map(|x| {
                let mut v = json!({ "task": x.task, "every": x.every, "state": x.state, "says": x.words });
                if let Some(id) = &x.order {
                    v["order"] = json!(id);
                }
                if let Some(s) = &x.schedule {
                    v["schedule"] = json!(s);
                }
                if let Some(w) = &x.why {
                    v["why"] = json!(w);
                }
                if let Some(c) = x.count {
                    v["times"] = json!(c.times);
                    v["units"] = json!(c.units);
                }
                v
            })
            .collect();
        let mut d = json!({ "office": o.office, "orders": orders });
        if let Some(s) = since {
            d["since"] = json!(s);
        }
        if !staff.is_empty() {
            d["staff"] = json!(staff);
        }
        let changed = last.as_ref().is_some_and(|(_, k)| *k != key);
        vec![because(
            format!("Reporting to the office on the work under its standing orders{}.", if changed { ": how an order stands has changed" } else { "" }),
            vec![crate::steps::say(
                "staff_report",
                &words,
                Say { to: Some(vec![self.me.clone()]), visible: Some(Visible::Only(vec![self.me.clone()])), data: Some(d), ..Default::default() },
            )],
        )]
    }
}

/// Whole days, half up (TS's `Math.round` of a positive number).
fn round_days(s: i64) -> i64 {
    (s + DAY / 2).div_euclid(DAY)
}

/// An office's counter (docs/behaviour/standing-work.md, "The counter"): the routine post its staff sort and answer
/// under the office's procedure. Offered: the whole office does it as ever; the office-holder never; the staff only
/// while a standing order for `answer` is in force. Saved with the actor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CounterWork {
    pub offered: bool,
    tally: BTreeMap<String, i64>,
    today: i64,
}

impl CounterWork {
    pub const TASK: &'static str = "answer";
    pub fn new(offered: bool) -> Self {
        CounterWork { offered, ..Default::default() }
    }
    /// Whether this part answers the counter's papers now.
    pub fn works(&self, routines: &StandingWork, book: &Book, t: i64) -> bool {
        if !self.offered || routines.part == Part::Whole {
            return true;
        }
        routines.part == Part::Staff && routines.order(book, Self::TASK, t).is_some()
    }
    /// One paper of a kind answered at the counter.
    pub fn answered(&mut self, routines: &StandingWork, kind: &str) {
        if !self.offered || routines.part != Part::Staff {
            return;
        }
        *self.tally.entry(kind.to_string()).or_insert(0) += 1;
        self.today += 1;
    }
    /// The day's counter work done: counted under the order, and what was answered, by kind, said in the report.
    pub fn flush(&mut self, routines: &mut StandingWork, t: i64) {
        if !self.offered || routines.part != Part::Staff {
            return;
        }
        if self.today > 0 {
            routines.did(Self::TASK, t, self.today, &[]);
        }
        self.today = 0;
        let kinds: Vec<String> = self.tally.iter().map(|(k, n)| format!("{n} {}{}", k.replace('_', " "), if *n == 1 { "" } else { "s" })).collect();
        routines.note(Self::TASK, (!kinds.is_empty()).then(|| format!("answered at the counter: {}", kinds.join(", "))));
    }
    /// The staff's report went out: the count starts again.
    pub fn reported<T>(&mut self, routines: &mut StandingWork, steps: &[Step<T>]) {
        if !steps.is_empty() {
            self.tally.clear();
            routines.note(Self::TASK, None);
        }
    }
    /// The routine the staff report on, where a counter is offered.
    pub fn tasks(&self) -> Option<(&'static str, &'static str, Option<&'static str>)> {
        self.offered.then_some((Self::TASK, "days of counter work", Some("papers answered")))
    }
    /// The seat's standing order for the counter, once (with its other orders).
    pub fn order<'a>(&self, at: &'a str) -> Option<Routine<'a>> {
        self.offered.then_some(Routine {
            task: Self::TASK,
            at,
            every: DAY,
            why: "Setting the counter: the routine post the office's procedure lists is answered by the staff, as a standing work order.",
        })
    }
}

/// The written directions an office takes (docs/behaviour/directions.md): a statement of kind `direction` filed on the
/// office's own form for it (the form is its basis), addressed to the office's organisation. Who may direct it is the
/// organisation's own rule (`under`: a procedure whose data names the posts, `directions.by`, or for one office
/// `directions.offices[office]`). The direction that stands is the latest one not withdrawn and not on hold, followed
/// unless the office's compliance draw says otherwise. Saved with the actor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Directions {
    entity: String,
    participant: String,
    /// The office these directions are to: the post itself, or for its staff's post the office whose staff they are.
    office: Option<String>,
    under: String,
    compliance_bps: i64,
    office_words: String,
    answered: BTreeSet<String>,
    acknowledged: BTreeSet<String>,
}

impl Directions {
    pub fn new(ctx: &crate::Ctx, under: &str, compliance_bps: Option<i64>, office_words: &str) -> Self {
        Directions {
            entity: ctx.entity.clone(),
            participant: ctx.participant.clone(),
            office: ctx.position.as_ref().map(|p| p.strip_suffix("-staff").unwrap_or(p).to_string()),
            under: under.to_string(),
            compliance_bps: compliance_bps.unwrap_or(10_000),
            office_words: office_words.to_string(),
            ..Default::default()
        }
    }

    /// Directions as a clerk reads them, never acting on them: the entity they are to, the post of the office (or its
    /// staff's), and the rule that says who may direct it.
    pub fn reading(entity: &str, position: Option<&str>, under: &str) -> Self {
        Directions {
            entity: entity.to_string(),
            office: position.map(|p| p.strip_suffix("-staff").unwrap_or(p).to_string()),
            under: under.to_string(),
            compliance_bps: 10_000,
            ..Default::default()
        }
    }

    /// The direction on a form that stands as filed (the latest from a post that may direct the office, not on hold),
    /// whether or not the office's draw of compliance follows it: a clerk reads what is on file and draws nothing.
    pub fn stands<'a>(&self, book: &'a Book, form: &str) -> Option<&'a Arc<Record>> {
        let may = self.may(book);
        let d = self.filed(book, Some(form)).into_iter().rev().find(|x| x.position.as_ref().is_some_and(|p| may.contains(p)))?;
        (!book.on_hold(&d.id, None)).then_some(d)
    }

    /// The posts that may direct this office, by the organisation's rule as it stands.
    fn may(&self, book: &Book) -> Vec<String> {
        let Some(rule) = (!self.under.is_empty()).then(|| book.current(&self.under)).flatten() else { return vec![] };
        let d = data(rule).get("directions");
        let posts = self.office.as_ref().and_then(|o| d.and_then(|d| d.get("offices")).and_then(|x| x.get(o))).or_else(|| d.and_then(|d| d.get("by")));
        posts.and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
    }

    /// The form a direction was filed on, if it cites one of this office's.
    fn form_of<'a>(&self, book: &'a Book, d: &Record) -> Option<&'a Arc<Record>> {
        bases_of(d).iter().filter_map(|b| book.get(b)).find(|f| is_kind(f, "form") && data(f).s("office") == self.office.as_deref())
    }

    /// The directions filed on our form `form` (any of ours: none) that still stand, oldest first.
    fn filed<'a>(&self, book: &'a Book, form: Option<&str>) -> Vec<&'a Arc<Record>> {
        let mut v: Vec<&Arc<Record>> = book
            .open("direction")
            .filter(|d| super::addressed_to(d).contains(&self.entity))
            .filter(|d| self.form_of(book, d).is_some_and(|f| form.is_none_or(|x| data(f).s("form") == Some(x))))
            .collect();
        v.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| super::filed_before(&a.id, &b.id)));
        v
    }

    /// The direction in force on a form: the latest standing one from a post that may direct us, if we follow it.
    pub fn standing<'a>(&self, book: &'a Book, form: &str, cx: &mut Cx) -> Option<&'a Arc<Record>> {
        let may = self.may(book);
        let d = self.filed(book, Some(form)).into_iter().rev().find(|x| x.position.as_ref().is_some_and(|p| may.contains(p)))?;
        if book.on_hold(&d.id, None) {
            return None;
        }
        // (PB-16: a direction from a post the rule names, not on hold, is followed. It is not followed for lack of authority or
        // because it is held; no draw. `compliance_bps` is accepted and unused.)
        let _ = (&cx, self.compliance_bps);
        Some(d)
    }

    /// Letters about directions newly received, one to each writer, once: to one who may direct us, that we have it
    /// and what we will do while it stands (`doing`: in the office's words, by form); to anyone else, that it is not
    /// followed, and the rule that says whose directions are.
    pub fn letters<T>(&mut self, book: &Book, doing: impl Fn(&Record, &str) -> String) -> Vec<Step<T>> {
        let may = self.may(book);
        let mut steps = vec![];
        for d in self.filed(book, None) {
            if self.answered.contains(&d.id) || self.acknowledged.contains(&d.id) || d.author == self.participant {
                continue;
            }
            let form = self.form_of(book, d).and_then(|f| data(f).s("form")).unwrap_or("").to_string();
            let author = std::slice::from_ref(&d.author);
            if d.position.as_ref().is_some_and(|p| may.contains(p)) {
                self.acknowledged.insert(d.id.clone());
                let fw = if form.is_empty() { "form".to_string() } else { form.replace('_', " ") };
                steps.push(because(
                    format!("A direction from {} on our {fw} form: acknowledging it.", d.position.as_deref().unwrap_or("")),
                    vec![super::letters::message(
                        author,
                        &format!("From {}: your direction {} is received. {} It stands until you replace or withdraw it.", self.office_words, d.id, doing(d, &form)),
                        Some(&d.id),
                    )],
                ));
            } else {
                self.answered.insert(d.id.clone());
                let rule = if !self.under.is_empty() && !may.is_empty() {
                    format!("This office takes directions on its forms only from those {} names.", self.under)
                } else {
                    "No rule of this organisation's says who may direct this office.".to_string()
                };
                steps.push(because(
                    format!("A direction ({}) from someone our rules don't say may direct us: not following it, and saying so.", d.id),
                    vec![super::letters::message(author, &format!("From {}: your direction {} is not being followed. {rule}", self.office_words, d.id), Some(&d.id))],
                ));
            }
        }
        steps
    }
}

/// How long a unit of work takes, as a manager learns it, worker by worker (common.ts `Pace`): the figure it plans
/// with at first; once the world has said a crew had not the time ("this needs N" each), each of them as slow as that
/// crew turned out to be; after work that went through, each a little quicker (2%) once a week. Decided fresh: held
/// in thousandths of a second, integers throughout. Saved with the actor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pace {
    nominal_ms: i64,
    known_ms: BTreeMap<String, i64>,
    asked: BTreeMap<String, i64>,
}

impl Pace {
    /// `nominal`: seconds a unit, as planned at first.
    pub fn new(nominal: i64) -> Self {
        Pace { nominal_ms: nominal * 1000, ..Default::default() }
    }
    fn of(&self, w: &str) -> i64 {
        self.known_ms.get(w).copied().unwrap_or(self.nominal_ms)
    }
    fn mean_ms(&self, crew: &[String]) -> i64 {
        crew.iter().map(|w| self.of(w)).sum::<i64>() / crew.len().max(1) as i64
    }
    /// Seconds a unit for this crew (its members' mean, rounded up; at least one).
    pub fn per_unit(&self, crew: &[String]) -> i64 {
        let m = if crew.is_empty() { self.nominal_ms } else { self.mean_ms(crew) };
        ((m + 999) / 1000).max(1)
    }
    /// Refused for time: `units` of work shared by `crew`, each needing what the refusal says ("this needs N").
    pub fn refused(&mut self, o: &oikos_sight::Outcome, units: i64, crew: &[String]) {
        let Some(r) = o.refusal.as_ref().filter(|r| r.code == oikos_contracts::events::RefusalCode::NoTimeLeft) else { return };
        let needs = r.detail.as_deref().and_then(|d| d.split_once("this needs ")).and_then(|(_, n)| {
            let digits: String = n.chars().take_while(char::is_ascii_digit).collect();
            digits.parse::<i64>().ok()
        });
        let (Some(needs), true, false) = (needs, units > 0, crew.is_empty()) else { return };
        let wanted_ms = i128::from(needs) * 1000 * crew.len() as i128 / i128::from(units);
        let mean = i128::from(self.mean_ms(crew).max(1));
        if wanted_ms > mean {
            for w in crew {
                let v = (i128::from(self.of(w)) * wanted_ms / mean) as i64;
                self.known_ms.insert(w.clone(), v);
            }
        }
    }
    /// Done in the time we gave it (on day `day`): perhaps they are quicker than we think. Once a week each.
    pub fn done(&mut self, crew: &[String], day: i64) {
        let week = day.div_euclid(7);
        for w in crew {
            if self.asked.get(w) != Some(&week) {
                self.asked.insert(w.clone(), week);
                let v = self.of(w) * 98 / 100;
                self.known_ms.insert(w.clone(), v);
            }
        }
    }
}

/// The text of a call argument (for tests and readers that want a step's words).
pub fn words_of(a: &oikos_sight::calls::Value) -> Option<&str> {
    match a {
        oikos_sight::calls::Value::Text(s) | oikos_sight::calls::Value::Id(s) => Some(s),
        _ => None,
    }
}
