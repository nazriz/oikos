//! The hearing of applications, for any venue (participants/src/behaviour/desk.ts `Hearings`, `hearingOffer`,
//! `hearingNotice(s)`; docs/behaviour/frictions.md, "Venues"; docs/behaviour/justice.md): listing, telling the other
//! side, deciding on the record, saying so. Used by `office.desk` and `tribunal.member`.
//!
//! A venue has no power over the world. It takes an application, tells the one complained of and gives them time to
//! answer, decides by its procedure with the hours its staff have, and says what it decided: words, which the other
//! side obeys or does not. Each step takes the time the world says it takes; a venue with more cases than its staff
//! can decide in a day falls behind, and its waits are what they come to (foundations F6).
//!
//! Decided fresh in Rust:
//! - **The file is the memory.** A case the venue has taken in, listed or decided is known from its own notices and
//!   decisions on file (`forms.notice`, `forms.decision` that speak for it), so a new holder of the post carries on
//!   and no application is taken twice (bug hunt 2026-10-17, finding 2). The sets kept here (`seen`, `closed`) only
//!   bridge the time an act of ours takes to reach the file.
//! - Days are written through `when_words` (a civil date where the world has a calendar), never "day N".
//! - Ties among cases of one day go by when they were filed, then `filed_before` (rec.9 before rec.10).
//! - An appeal law is read from the laws on file by lane D's `finance::decisions::appeal_law` (`rules::decisions`).
//! - A venue's hours are the caller's `can_decide`; a case is never decided more than once.

use crate::finance::decisions::appeal_law;
use crate::common::{data, filed_before, money_words, when_words, Book, Fields, Occurrences, DAY};
use crate::steps::{because, say, Say, Step, Visible};
use crate::Cx;
use oikos_rules::slip::{slip, SlipOptions};
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// The kinds of paper a venue that is not a tribunal uses (frictions.ts `PAPER`).
pub const APPLICATION: &str = "application";
pub const NOTICE: &str = "complaint_notice";
pub const RESPONSE: &str = "complaint_response";
pub const DECISION: &str = "venue_decision";

/// What a venue says it hears (the contract's `Offer.hears`), with how it goes about it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Hears {
    pub about: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub can: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub undoes: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub within: Option<i64>,
    /// What applying about this costs, where it differs from the body's own fee.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee: Option<i64>,
}

impl Hears {
    fn can(&self) -> Vec<&str> {
        if self.can.is_empty() {
            vec!["order"]
        } else {
            self.can.iter().map(String::as_str).collect()
        }
    }
    pub fn orders(&self) -> bool {
        self.can().contains(&"order")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Refer {
    pub to: String,
    pub kind: String,
}

/// Possession of a let home for arrears (docs/behaviour/justice.md): the days from the order to the date for
/// possession, the longest plan to pay it sets, and what the world's law asks and allows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Possession {
    pub days: i64,
    pub plan_months: i64,
    #[serde(default)]
    pub notice_days: Option<i64>,
    /// "may" | "must" | "none"
    #[serde(default)]
    pub plan_consider: Option<String>,
    #[serde(default)]
    pub plan_barred_rent_months: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HearingParams {
    pub hears: Vec<Hears>,
    /// The other side's time to answer.
    pub answer_days: i64,
    /// An order to pay or to do: within this long.
    pub within_days: i64,
    /// Matters it passes to whoever must act.
    pub refer_to: BTreeMap<String, Refer>,
    pub possession: Option<Possession>,
}

impl Default for HearingParams {
    fn default() -> Self {
        HearingParams { hears: vec![], answer_days: 14, within_days: 28, refer_to: BTreeMap::new(), possession: None }
    }
}

/// The names of the papers a venue uses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Forms {
    pub application: Vec<String>,
    pub notice: String,
    pub response: String,
    pub decision: String,
}

impl Default for Forms {
    fn default() -> Self {
        Forms { application: vec![APPLICATION.into()], notice: NOTICE.into(), response: RESPONSE.into(), decision: DECISION.into() }
    }
}

/// Which part of the hearing is done: the whole office; its counter staff (who take in, tell and decide what the
/// record settles); the office-holder (who decides the rest); a tribunal's registry (list) and its member (decide).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HearPart {
    All,
    Staff,
    Seat,
    List,
    Decide,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Case {
    pub id: String,
    pub matter: String,
    pub applicant: String,
    pub against: String,
    pub at: i64,
    pub answer_by: i64,
    pub data: Value,
    pub hears: Hears,
}

/// What a venue says it hears: its public notice, with the offer whoever has such a matter takes up.
#[derive(Debug, Clone, PartialEq)]
pub struct HearingNotice {
    pub kind: String,
    pub text: String,
    pub data: Value,
    pub offer: Value,
}

#[derive(Debug, Clone, Default)]
pub struct NoticeOpts<'a> {
    pub fee: i64,
    pub account: &'a str,
    pub members_of: &'a str,
    pub members_apply: bool,
}

/// The offer a venue publishes: who it is, what it hears, what applying costs (desk.ts `hearingOffer`).
pub fn hearing_offer(me: &str, hears: &[Hears], fee: i64, account: &str, members_of: &str) -> Value {
    let mut o = Map::new();
    o.insert("by".into(), json!(me));
    o.insert("take_up".into(), json!("apply"));
    if !members_of.is_empty() {
        o.insert("to".into(), json!({ "members_of": members_of }));
    }
    let hs: Vec<Value> = hears
        .iter()
        .map(|h| {
            let mut m = Map::new();
            m.insert("about".into(), json!(h.about));
            if !h.can.is_empty() {
                m.insert("can".into(), json!(h.can));
            }
            if h.undoes {
                m.insert("undoes".into(), json!(true));
            }
            if let Some(f) = &h.form {
                m.insert("form".into(), json!(f));
            }
            if let Some(w) = h.within.filter(|w| *w != 0) {
                m.insert("within".into(), json!(w));
            }
            Value::Object(m)
        })
        .collect();
    o.insert("hears".into(), Value::Array(hs));
    if fee > 0 && !account.is_empty() {
        o.insert(
            "terms".into(),
            json!({ "commitments": [{ "who": "taker", "does": { "outcome": { "money": { "to": account, "amount": fee.to_string(), "for": "application fee" } } } }] }),
        );
    }
    Value::Object(o)
}

/// The public notice of what a body hears (desk.ts `hearingNotice`).
pub fn hearing_notice(me: &str, words: &str, hears: &[Hears], o: &NoticeOpts, cx: &Cx) -> HearingNotice {
    let list: Vec<String> = hears.iter().map(|h| h.about.replace('_', " ")).collect();
    let fee = if o.fee > 0 { format!("; the fee is {}", money_words(o.fee, &cx.ctx.world)) } else { "; there is no fee".into() };
    let mut d = json!({ "hears": hears.iter().map(|h| h.about.clone()).collect::<Vec<_>>() });
    if o.fee > 0 {
        d["fee"] = json!(o.fee);
    }
    HearingNotice {
        kind: "hearing".into(),
        text: format!("{words}: {}. {} in writing{fee}.", list.join(", "), if o.members_apply { "Members apply" } else { "Apply" }),
        offer: hearing_offer(me, hears, o.fee, o.account, o.members_of),
        data: d,
    }
}

/// The notices of what a body hears: one, or one for each fee where what it hears is charged differently.
pub fn hearing_notices(me: &str, words: &str, hears: &[Hears], o: &NoticeOpts, cx: &Cx) -> Vec<HearingNotice> {
    let mut by_fee: BTreeMap<i64, Vec<Hears>> = BTreeMap::new();
    for h in hears {
        by_fee.entry(h.fee.unwrap_or(o.fee)).or_default().push(h.clone());
    }
    by_fee.into_iter().map(|(fee, hs)| hearing_notice(me, words, &hs, &NoticeOpts { fee, ..o.clone() }, cx)).collect()
}

/// Whether an application says what it is about: it gives its particulars, or names a paper, a place, a sum, what is
/// sought, or evidence (frictions.ts `hasParticulars`).
pub fn has_particulars(d: &Value) -> bool {
    d.s("particulars").is_some_and(|s| !s.trim().is_empty())
        || d.get("about").is_some_and(|v| !v.is_null())
        || d.get("structure").is_some_and(|v| !v.is_null())
        || d.get("seeks").is_some_and(|v| !v.is_null())
        || d.i("amount").is_some_and(|a| a > 0)
        || d.get("evidence").is_some_and(|v| !v.is_null())
}

/// The latest answer on file from a respondent that cites the application (frictions.ts `responseTo`).
pub fn response_to<'a>(book: &'a Book, kind: &str, application: &str, from: &str) -> Option<&'a Arc<Record>> {
    book.open(kind).filter(|r| crate::common::cites(r, application) && r.speaks_for.as_deref() == Some(from)).fold(None, |best: Option<&Arc<Record>>, r| match best {
        Some(b) if r.at < b.at => Some(b),
        _ => Some(r),
    })
}

fn by_time_then_id(a: &Arc<Record>, b: &Arc<Record>) -> std::cmp::Ordering {
    a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id))
}

/// A union's hearing of its members' grievances (union.ts `cases`): lane D's seam `finance::union::Grievances`, here as the
/// desk's `Hearings`. What the union takes up it says in public once, for its members; a case put to the employer, and what
/// the union then says should be done, is a recommendation with the union behind it, never an order (`can: represent`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnionCases {
    me: String,
    hears: Vec<Hears>,
    hearings: Hearings,
    said: bool,
}

impl UnionCases {
    pub fn new(me: &str, hears: Vec<Hears>, answer_days: i64) -> Self {
        let hears: Vec<Hears> = hears.into_iter().map(|h| Hears { can: vec!["represent".to_string()], ..h }).collect();
        let params = HearingParams { hears: hears.clone(), answer_days, ..Default::default() };
        UnionCases { me: me.to_string(), hears, hearings: Hearings::new(me, params, Forms::default(), &[]), said: false }
    }
}

impl crate::finance::union::Grievances for UnionCases {
    fn steps(&mut self, _pic: &crate::Picture, book: &Book, cx: &mut Cx) -> Vec<Step<()>> {
        let mut steps: Vec<Step<()>> = vec![];
        if !self.said {
            self.said = true;
            if !book.open("hearing").any(|r| r.speaks_for.as_deref() == Some(self.me.as_str())) {
                let o = NoticeOpts { fee: 0, account: "", members_of: &self.me, members_apply: true };
                for n in hearing_notices(&self.me, "The union takes up for its members", &self.hears, &o, cx) {
                    steps.push(because(
                        "Saying what the union takes up for its members, so that a member with such a matter can bring it.",
                        vec![say(&n.kind, &n.text, Say { visible: Some(Visible::Public), data: Some(n.data), extra: vec![("offer", n.offer)], ..Default::default() })],
                    ));
                }
            }
        }
        steps.extend(self.hearings.steps(book, cx, HearPart::All, None));
        steps
    }
    fn save(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

/// Builds a union's grievance hearings from its parameters (`hears`, `answer_days`) and what `save` left (`Null`: new).
pub fn union_cases(ctx: &crate::Ctx, saved: &Value) -> Result<Box<dyn crate::finance::union::Grievances>, String> {
    if !saved.is_null() {
        let back: UnionCases = serde_json::from_value(saved.clone()).map_err(|e| format!("union.organiser: the saved hearings: {e}"))?;
        return Ok(Box::new(back));
    }
    let hears: Vec<Hears> = ctx.param("hears", vec![])?;
    Ok(Box::new(UnionCases::new(&ctx.entity, hears, ctx.param("answer_days", 14)?)))
}

/// The hearing of applications for one venue (saved with the actor).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Hearings {
    me: String,
    pub p: HearingParams,
    forms: Forms,
    /// Kinds the venue's own code hears itself (a tribunal's older lists): left alone here.
    leave: Vec<String>,
    cases: BTreeMap<String, Case>,
    seen: BTreeSet<String>,
    /// Cases we have decided ourselves: never taken up again from the file, where our own decision may not yet show.
    closed: BTreeSet<String>,
    nth: Occurrences,
    /// What it did, for whoever counts: applications, by finding.
    pub counts: BTreeMap<String, i64>,
    /// Days from application to decision (the latest 512).
    pub waits: Vec<i64>,
}

impl Hearings {
    pub fn new(me: &str, p: HearingParams, forms: Forms, leave: &[&str]) -> Self {
        Hearings { me: me.to_string(), p, forms, leave: leave.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }
    pub fn open(&self) -> usize {
        self.cases.len()
    }
    pub fn count_of(&self, what: &str) -> i64 {
        self.counts.get(what).copied().unwrap_or(0)
    }
    fn count(&mut self, what: &str) {
        *self.counts.entry(what.to_string()).or_insert(0) += 1;
    }
    fn hears_for(&self, matter: &str) -> Hears {
        self.p.hears.iter().find(|h| h.about == matter).cloned().unwrap_or(Hears { about: matter.to_string(), ..Default::default() })
    }

    /// What our own file says: the applications we have decided (never taken again), and those it has put on record a
    /// notice for. Read at every step, so a new holder carries on.
    fn read_file(&mut self, book: &Book) {
        let me = self.me.clone();
        for r in book.all(&self.forms.decision) {
            if r.speaks_for.as_deref() == Some(me.as_str()) {
                if let Some(a) = data(r).s("application") {
                    self.closed.insert(a.to_string());
                    self.seen.insert(a.to_string());
                    self.cases.remove(a);
                }
            }
        }
    }

    /// `part`: see `HearPart`. `can_decide`: how many cases can be decided now, where that is not a fixed number a
    /// day (a body whose staff are its members' hours); `None`: no limit but the day.
    pub fn steps<T>(&mut self, book: &Book, cx: &mut Cx, part: HearPart, can_decide: Option<usize>) -> Vec<Step<T>> {
        let t = cx.t;
        let me = self.me.clone();
        let mut steps: Vec<Step<T>> = vec![];
        self.read_file(book);
        let world = cx.ctx.world.clone();
        let when = |x: i64| when_words(x, &world);
        let money = |n: i64| money_words(n, &world);
        if part == HearPart::Seat {
            // The cases the staff could not settle on the record: decided here as the code office would (failure of
            // proof, at the venue's own rate). A model in the office decides them for itself, on the decision form.
            let mut notes: Vec<&Arc<Record>> = book.open("case_for_decision").filter(|x| x.speaks_for.as_deref() == Some(me.as_str())).collect();
            notes.sort_by(|a, b| by_time_then_id(a, b));
            for n in notes {
                if !self.seen.insert(n.id.to_string()) {
                    continue;
                }
                let Some(c) = data(n).get("case").and_then(|c| serde_json::from_value::<Case>(c.to_value()).ok()) else { continue };
                let claimed = c.data.i("amount").unwrap_or(0).max(0);
                let key = self.nth.key(&c.id, &[Some(&c.applicant), Some(&c.against), Some(&c.matter)]);
                let upheld = slip(cx, "publish/venue_decision", &key, &SlipOptions::default());
                let binding = c.hears.orders();
                let due = t + self.p.within_days * DAY;
                let finding = if !upheld {
                    "dismissed"
                } else if claimed > 0 {
                    "pay"
                } else if c.hears.undoes && c.data.get("about").is_some() {
                    "set_aside"
                } else {
                    "do"
                };
                self.count(finding);
                let verb = if binding { "is to" } else { "should" };
                let text = match finding {
                    "pay" => format!("{} {verb} pay {} {} by {}.", c.against, c.applicant, money(claimed), when(due)),
                    "dismissed" => "not made out; dismissed.".into(),
                    _ => format!("{} {verb} put it right by {}.", c.against, when(due)),
                };
                let mut d = decision_data(&c, finding, binding, t);
                if finding == "pay" {
                    d["amount"] = json!(claimed);
                    if let Some(a) = c.data.s("account") {
                        d["to"] = json!(a);
                    }
                    d["due"] = json!(due);
                } else if finding == "do" {
                    d["due"] = json!(due);
                }
                steps.push(because(
                    format!(
                        "A case the record cannot settle ({}, {} against {}): {}.",
                        c.matter.replace('_', " "),
                        c.applicant,
                        c.against,
                        if upheld { "on what both say, it is made out" } else { "the applicant has nothing to show for it, and it is not made out" }
                    ),
                    vec![say(
                        &self.forms.decision,
                        &format!("Decision on {}: {text}", c.id),
                        Say { to: Some(vec![c.applicant.clone(), c.against.clone()]), visible: Some(Visible::Only(vec![c.applicant.clone(), c.against.clone(), me.clone()])), basis: Some(c.id.clone()), data: Some(d), ..Default::default() },
                    )],
                ));
            }
            return steps;
        }

        // ---- the member's part: the cases the tribunal's file says are listed, as its notices of hearing have them
        let notices_of_ours = |book: &Book, forms: &Forms| -> Vec<Arc<Record>> {
            let mut v: Vec<Arc<Record>> = book
                .all(&forms.notice)
                .filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).get("matter").is_some_and(|x| x.is_string()))
                .cloned()
                .collect();
            v.sort_by(|a, b| by_time_then_id(a, b));
            v
        };
        let take_case = |this: &Hearings, n: &Record, id: &str, a: &Record| -> Case {
            let d = data(a).clone();
            let matter = d.s("matter").or_else(|| d.s("kind")).or_else(|| data(n).s("matter")).unwrap_or("").to_string();
            Case {
                id: id.to_string(),
                matter: matter.clone(),
                applicant: a.speaks_for.unwrap_or_default().to_string(),
                against: d.s("against").or_else(|| data(n).s("against")).unwrap_or("").to_string(),
                at: a.at,
                answer_by: data(n).i("answer_by").or_else(|| data(n).i("hearing_at")).unwrap_or(t),
                data: d.to_value(),
                hears: this.hears_for(&matter),
            }
        };
        if part == HearPart::Decide {
            for n in notices_of_ours(book, &self.forms) {
                let id = data(&n).s("application").unwrap_or("").to_string();
                let a = book.get(&id).cloned();
                let leave = self.leave.iter().any(|l| Some(l.as_str()) == data(&n).s("matter"));
                match a {
                    Some(a) if !self.closed.contains(&id) && !book.withdrawn(&id) && !leave => {
                        // (The latest notice gives the day: a case put off is decided when its new day has come.)
                        let c = take_case(self, &n, &id, &a);
                        self.cases.insert(id, c);
                    }
                    _ => {
                        self.cases.remove(&id);
                    }
                }
            }
        }
        // ---- cases our own file says are already listed, that we did not list ourselves: taken as they stand, with
        // the day their notice gave; never listed again.
        if part != HearPart::Decide {
            for n in notices_of_ours(book, &self.forms) {
                let id = data(&n).s("application").unwrap_or("").to_string();
                if self.seen.contains(&id) {
                    continue;
                }
                let Some(a) = book.get(&id).cloned() else { continue };
                self.seen.insert(id.clone());
                let matter = {
                    let d = data(&a);
                    d.s("matter").or_else(|| d.s("kind")).or_else(|| data(&n).s("matter")).unwrap_or("").to_string()
                };
                if self.closed.contains(&id) || book.withdrawn(&id) || self.leave.contains(&matter) || part == HearPart::List {
                    continue;
                }
                let c = take_case(self, &n, &id, &a);
                self.cases.insert(id, c);
            }
        }
        // ---- applications: taken, and the other side told
        if part != HearPart::Decide {
            for kind in self.forms.application.clone() {
                let mut apps: Vec<Arc<Record>> =
                    book.open(&kind).filter(|x| crate::common::addressed_to(x).iter().any(|x| x == &me) && !self.seen.contains(x.id.as_str())).cloned().collect();
                apps.sort_by(|a, b| by_time_then_id(a, b));
                for a in apps {
                    let d = data(&a).clone();
                    let matter = d.s("matter").or_else(|| d.s("kind")).unwrap_or("").to_string();
                    if self.leave.contains(&matter) {
                        continue;
                    }
                    self.seen.insert(a.id.to_string());
                    let applicant = a.speaks_for.unwrap_or_default();
                    let hears = self.p.hears.iter().find(|h| h.about == matter).cloned();
                    let against = d.s("against").unwrap_or("").to_string();
                    let answer_by = t + self.p.answer_days * DAY;
                    let c = Case { id: a.id.to_string(), matter: matter.clone(), applicant: applicant.to_string(), against: against.clone(), at: a.at, answer_by, data: d.to_value(), hears: hears.clone().unwrap_or(Hears { about: matter.clone(), ..Default::default() }) };
                    self.count("applications");
                    let Some(hears) = hears.filter(|_| against != applicant) else {
                        self.say2(&mut steps, t, &c, "rejected", "we cannot hear it.", json!({}), format!("An application we do not hear ({}): saying so.", if matter.is_empty() { "of no kind" } else { &matter }), true);
                        continue;
                    };
                    let can = hears.can();
                    if can.contains(&"refer") {
                        if let Some(refer) = self.p.refer_to.get(&matter).cloned() {
                            // Passed to whoever must act, on that office's own paper; the applicant is told where it went.
                            let mut pd = d.to_value();
                            if let Some(o) = pd.as_object_mut() {
                                o.insert("from".into(), json!(applicant));
                                o.insert("application".into(), json!(a.id));
                            }
                            steps.push(because(
                                format!("An application about {}: it is for {} to act on; passing it on.", matter.replace('_', " "), refer.to),
                                vec![say(&refer.kind, &format!("Passed on from {me}: {}", crate::common::text(&a)), Say { to: Some(vec![refer.to.clone()]), visible: Some(Visible::Only(vec![refer.to.clone(), me.clone(), applicant.to_string()])), basis: Some(a.id.to_string()), data: Some(pd), ..Default::default() })],
                            ));
                            self.say2(&mut steps, t, &c, "referred", &format!("passed to {}, whose it is to act on.", refer.to), json!({ "to": refer.to }), format!("Telling {applicant} where their application went."), false);
                            continue;
                        }
                    }
                    if against.is_empty() {
                        self.say2(&mut steps, t, &c, "rejected", "it names nobody it is against.", json!({}), "An application against no one: saying so.".into(), true);
                        continue;
                    }
                    // An appeal against a decision (the law's, foundations F8): the days it may be made in, counted from
                    // the decision, or from the answer to a review where the law makes a review come first.
                    if hears.orders() {
                        if let Some(law) = appeal_law(book, &matter) {
                            if let Some(appeal) = &law.appeal {
                                let decided = d.get("evidence").and_then(|e| e.i("at")).or_else(|| d.i("decided_on"));
                                let reviewed = d.i("reviewed_on");
                                let review_required = law.review.as_ref().is_some_and(|r| r.required);
                                // Where the law takes a review left unanswered as refused after so many days, the
                                // days run from then (a deemed refusal, MT-21); before then there is still no answer.
                                let deemed = law.review.as_ref().zip(d.i("review_asked_on")).and_then(|(r, asked)| r.deemed_refused_at(asked)).filter(|at| a.at >= *at);
                                let from = if review_required { reviewed.or(deemed) } else { decided };
                                let within = appeal.within_days;
                                if review_required && from.is_none() {
                                    self.say2(&mut steps, t, &c, "rejected", "the law asks that the decision be looked at again by the office that made it before it is appealed, and there is no answer to that on the papers.", json!({}), format!("An appeal ({}) without the review the law asks first: saying so.", matter.replace('_', " ")), true);
                                    continue;
                                }
                                if let Some(from) = from {
                                    let late = (a.at - from).div_euclid(DAY);
                                    if late > within {
                                        self.say2(&mut steps, t, &c, "rejected", &format!("an appeal is to be made within {within} days of {}, and this was made {late} days after.", if reviewed.is_none() && deemed.is_some() { "the day the review was taken as refused" } else if review_required { "the answer to the review" } else { "the decision" }), json!({ "out_of_time": true }), format!("An appeal ({}) outside the {within} days the law allows: saying so.", matter.replace('_', " ")), true);
                                        continue;
                                    }
                                }
                            }
                        }
                    }
                    self.cases.insert(a.id.to_string(), c.clone());
                    let mut nd = json!({ "application": a.id, "kind": matter, "matter": matter, "applicant": applicant, "against": against, "hearing_at": answer_by, "answer_by": answer_by });
                    for k in ["about", "amount", "structure", "seeks"] {
                        if let Some(v) = d.get(k).filter(|v| !v.is_null()) {
                            nd[k] = v.to_value();
                        }
                    }
                    let seeking = d.i("amount").filter(|a| *a != 0).map(|a| format!(", seeking {}", money(a))).unwrap_or_default();
                    steps.push(because(
                        format!("An application ({}) by {applicant} against {against}: telling {against}, who has until {} to answer.", matter.replace('_', " "), when(answer_by)),
                        vec![say(
                            &self.forms.notice,
                            &format!("{applicant} has applied to us about {}{seeking} (application {}). You may answer by {}{}.", matter.replace('_', " "), a.id, when(answer_by), if can.contains(&"mediate") { ", and say whether you will meet them with us" } else { "" }),
                            Say { to: Some(vec![applicant.to_string(), against.clone()]), visible: Some(Visible::Only(vec![applicant.to_string(), against.clone(), me.clone()])), basis: Some(a.id.to_string()), data: Some(nd), ..Default::default() },
                        )],
                    ));
                }
            }
        }
        if part == HearPart::List {
            return steps;
        }
        // ---- deciding: those whose time to answer has run, oldest first, as far as the day's hours go
        // (An application its maker has withdrawn is no longer a case: nothing is decided on it.)
        let gone: Vec<String> = self.cases.keys().filter(|id| book.withdrawn(id)).cloned().collect();
        for id in gone {
            self.cases.remove(&id);
            self.count("withdrawn");
        }
        let mut room = can_decide.map_or(i64::MAX, |n| n as i64);
        // (The member decides a case on or after its day, and its books count the day from its first hour: a member who
        // sits in the morning decides what that day's list has. A whole office run by code decides at the hour.)
        let ripe = |x: &Case| if part == HearPart::Decide { x.answer_by.div_euclid(DAY) <= t.div_euclid(DAY) } else { t >= x.answer_by };
        let mut due_cases: Vec<Case> = self.cases.values().filter(|x| ripe(x)).cloned().collect();
        due_cases.sort_by(|a, b| a.answer_by.cmp(&b.answer_by).then_with(|| filed_before(&a.id, &b.id)));
        for c in due_cases {
            if room <= 0 {
                break;
            }
            room -= 1;
            self.decide(book, cx, part, &c, &mut steps);
        }
        steps
    }

    /// Say a decision, and close the case (desk.ts `say2`).
    #[allow(clippy::too_many_arguments)]
    fn say2<T>(&mut self, steps: &mut Vec<Step<T>>, t: i64, c: &Case, finding: &str, text: &str, extra: Value, why: String, binding: bool) {
        self.cases.remove(&c.id);
        self.closed.insert(c.id.clone());
        self.count(finding);
        self.waits.push((t - c.at).div_euclid(DAY));
        if self.waits.len() > 512 {
            self.waits.remove(0);
        }
        let mut d = decision_data(c, finding, binding, t);
        if let Some(s) = c.data.get("seeks").filter(|v| !v.is_null()) {
            d["seeks"] = s.clone();
        }
        if let (Some(o), Some(e)) = (d.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        let to: Vec<String> = [c.applicant.clone(), c.against.clone()].into_iter().filter(|x| !x.is_empty()).collect();
        let mut seen: Vec<String> = to.clone();
        seen.push(self.me.clone());
        steps.push(because(
            why,
            vec![say(&self.forms.decision, &format!("Decision on {}: {text}", c.id), Say { to: Some(to), visible: Some(Visible::Only(seen)), basis: Some(c.id.clone()), data: Some(d), ..Default::default() })],
        ));
    }

    fn decide<T>(&mut self, book: &Book, cx: &mut Cx, part: HearPart, c: &Case, steps: &mut Vec<Step<T>>) {
        let t = cx.t;
        let world = cx.ctx.world.clone();
        let when = |x: i64| when_words(x, &world);
        let money = |n: i64| money_words(n, &world);
        let binding = c.hears.orders();
        let can = c.hears.can();
        let due = t + self.p.within_days * DAY;
        let r = response_to(book, &self.forms.response, &c.id, &c.against);
        let x = r.map(|r| data(r).clone()).unwrap_or_default();
        let claimed = c.data.i("amount").map_or(0, |a| a.max(0));
        let verb = if binding { "is to" } else { "should" };
        let (who, ag) = (&c.applicant, &c.against);
        // An application that says nothing of what it is about is turned away with leave to apply again with its
        // particulars, as a member would (docs/behaviour/justice.md, "Particulars"). Before any draw.
        if c.matter != "possession" && !has_particulars(&c.data) {
            self.say2(steps, t, c, "dismissed", &format!("the application states no particulars (what it is about, the sum, the dates); dismissed. {who} may apply again with them."), json!({ "no_particulars": true }), "The application says nothing of what it is about: dismissed, with leave to apply again with its particulars.".into(), binding);
            return;
        }
        if can.contains(&"mediate") && !binding {
            // Bringing the two together: nothing comes of it unless the other side will.
            if x.flag("agrees") {
                self.say2(steps, t, c, "settled", &format!("{who} and {ag} met with us and came to an understanding."), json!({}), format!("{ag} agreed to meet {who}: they came to an understanding."), false);
            } else {
                let said = if r.is_some() { "would not meet" } else { "did not answer" };
                self.say2(steps, t, c, "dismissed", &format!("{ag} {said}; we can do no more."), json!({}), format!("{ag} {said}: mediation cannot be made to happen."), false);
            }
            return;
        }
        if c.matter == "possession" {
            self.decide_possession(book, cx, c, r.is_some(), &x, claimed, steps);
            return;
        }
        // On the record: what the other side's own books say, where it answered and they can say.
        let (finding, amount, why): (&str, i64, String);
        if r.is_some() && x.get("owed").is_some_and(|v| !v.is_null()) {
            let a = x.i("owed").unwrap_or(0).max(0);
            amount = a;
            finding = if a > 0 { "pay" } else { "dismissed" };
            why = format!("{ag} answers that its records show {} owed", money(a));
        } else if r.is_some() && x.get("wrong").is_some_and(|v| !v.is_null()) {
            let wrong = x.flag("wrong");
            finding = if wrong { if claimed > 0 { "pay" } else { "set_aside" } } else { "dismissed" };
            amount = if wrong { claimed } else { 0 };
            why = format!("{ag} answers that the paper was {}", if wrong { "wrong" } else { "right" });
        } else if r.is_some() && x.get("done").is_some_and(|v| !v.is_null()) {
            let done = x.flag("done");
            finding = if done { "dismissed" } else { "do" };
            amount = 0;
            why = format!("{ag} answers that it is {}", if done { "done" } else { "not done" });
        } else {
            // No answer, or one that cannot say: in default the applicant's account stands; word against word, the
            // venue's own rate. (What the rate stands for is failure of proof: an applicant who can show a paper for it
            // has made it out; one with only their word is believed as often as this venue's own figures say.)
            let shown = c.data.get("evidence").is_some_and(|v| !v.is_null()) || c.data.get("request").is_some_and(|v| !v.is_null());
            if part == HearPart::Staff && r.is_some() && !shown {
                // Not the counter's to decide: put before the office-holder, with the case as it stands.
                self.cases.remove(&c.id);
                self.count("for_decision");
                let seeking = if claimed > 0 { format!(", seeking {}", money(claimed)) } else { String::new() };
                steps.push(because(
                    format!("{ag} cannot say from its records and {who} has nothing to show: a decision for the office-holder."),
                    vec![say(
                        "case_for_decision",
                        &format!("For decision: application {} ({}) by {who} against {ag}{seeking}. {ag} answers that it cannot say from its records; the applicant has shown no paper for it.", c.id, c.matter.replace('_', " ")),
                        Say { to: Some(vec![self.me.clone()]), visible: Some(Visible::Only(vec![self.me.clone()])), basis: Some(c.id.clone()), data: Some(json!({ "application": c.id, "matter": c.matter, "applicant": who, "against": ag, "case": c })), ..Default::default() },
                    )],
                ));
                return;
            }
            let upheld = r.is_none() || shown || {
                let key = self.nth.key(&c.id, &[Some(who), Some(ag), Some(&c.matter)]);
                slip(cx, "publish/venue_decision", &key, &SlipOptions::default())
            };
            finding = if !upheld {
                "dismissed"
            } else if claimed > 0 {
                "pay"
            } else if c.hears.undoes && c.data.get("about").is_some() {
                "set_aside"
            } else {
                "do"
            };
            amount = if upheld { claimed } else { 0 };
            why = if r.is_some() {
                format!("{ag} cannot say from its records; {}", if shown { "the applicant has shown a paper for it" } else if upheld { "on what both say, the applicant's account is made out" } else { "the applicant has nothing to show for it, and it is not made out" })
            } else {
                format!("{ag} did not answer: the applicant's account stands")
            };
        }
        match finding {
            "pay" => {
                let mut extra = json!({ "amount": amount, "due": due });
                if let Some(a) = c.data.s("account") {
                    extra["to"] = json!(a);
                }
                self.say2(steps, t, c, "pay", &format!("{ag} {verb} pay {who} {} by {}.", money(amount), when(due)), extra, format!("{why}: {} payment of {}.", if binding { "ordering" } else { "recommending" }, money(amount)), binding);
            }
            "do" => self.say2(steps, t, c, "do", &format!("{ag} {verb} put it right by {}.", when(due)), json!({ "due": due }), format!("{why}: {} that it be put right.", if binding { "ordering" } else { "recommending" }), binding),
            "set_aside" => {
                let about = c.data.s("about").unwrap_or("");
                self.say2(steps, t, c, "set_aside", &format!("the paper {about} {}.", if binding { "is set aside" } else { "should be withdrawn" }), json!({}), format!("{why}: the paper {}.", if binding { "is set aside" } else { "should be withdrawn" }), binding)
            }
            _ => self.say2(steps, t, c, "dismissed", "not made out; dismissed.", json!({}), format!("{why}: dismissed."), binding),
        }
    }

    /// Possession of a let home for arrears (docs/behaviour/justice.md, "Possession"). The tenant may answer with what
    /// they have paid since, and with what they can pay a month toward the rest. The code member's rule, in this order,
    /// on the papers alone (it weighs nothing else: not hardship, not who lives there, not whether they have anywhere
    /// to go; a seat is shown the same papers and decides for itself):
    ///  1. the tenant says they have left: dismissed;
    ///  2. the notice relied on gave fewer days than the law asks: dismissed;
    ///  3. nothing is owed (the landlord's reply, else the tenant's figure, else the application's): dismissed;
    ///  4. the law gives a plan, not taken away at this sum, none was set and broken before, and what the tenant offers
    ///     clears what is owed within the law's longest plan: a plan;
    ///  5. otherwise possession, on the law's day.
    #[allow(clippy::too_many_arguments)]
    fn decide_possession<T>(&mut self, book: &Book, cx: &mut Cx, c: &Case, answered: bool, x: &oikos_core::Frozen, claimed: i64, steps: &mut Vec<Step<T>>) {
        let t = cx.t;
        let world = cx.ctx.world.clone();
        let when = |v: i64| when_words(v, &world);
        let money = |n: i64| money_words(n, &world);
        let pol = self.p.possession.clone().unwrap_or(Possession { days: 14, plan_months: 0, notice_days: None, plan_consider: None, plan_barred_rent_months: None });
        let (who, ag) = (&c.applicant, &c.against);
        let reply = book
            .all("tribunal_reply")
            .filter(|y| y.speaks_for.as_deref() == Some(who.as_str()) && data(y).s("application") == Some(c.id.as_str()))
            .fold(None::<&Arc<Record>>, |b, y| match b {
                Some(b) if y.at < b.at => Some(b),
                _ => Some(y),
            });
        let stated: Option<i64> = if let Some(o) = x.i("owes") {
            Some(o.max(0))
        } else {
            x.i("paid").map(|p| (claimed - p).max(0))
        };
        let reply_owed = reply.and_then(|r| data(r).i("owed"));
        let arrears = reply_owed.map(|o| o.max(0)).or(stated).unwrap_or(claimed);
        let offer = x.i("offer").unwrap_or(0).max(0);
        let space = c.data.s("space");
        let mut home = Map::new();
        if let Some(s) = space {
            home.insert("space".into(), json!(s));
            if let Some(v) = c.data.get("structure") {
                home.insert("structure".into(), v.clone());
            }
            if let Some(v) = c.data.get("household") {
                home.insert("household".into(), v.clone());
            }
        }
        let gave = match (c.data.i("notice_given"), c.data.i("notice_by")) {
            (Some(g), Some(b)) => Some((b - g).div_euclid(DAY)),
            _ => None,
        };
        let rent = c.data.i("rent").unwrap_or(0).max(0);
        let consider = if pol.plan_months > 0 { pol.plan_consider.clone().unwrap_or_else(|| "may".into()) } else { "none".into() };
        let barred = consider != "none" && pol.plan_barred_rent_months.is_some_and(|m| m > 0) && rent > 0 && arrears >= pol.plan_barred_rent_months.unwrap_or(0) * rent;
        let whose = if reply_owed.is_some() { "by the landlord's rent book" } else if stated.is_some() { "by the tenant's answer" } else { "by the application" };
        let home_words = space.unwrap_or("the home");
        let short = match (gave, pol.notice_days.filter(|n| *n > 0)) {
            (Some(g), Some(nd)) if g < nd => Some((g, nd)),
            _ => None,
        };
        let has_breach = c.data.get("breach").is_some_and(crate::common::truthy);
        if x.flag("left") {
            self.say2(steps, t, c, "dismissed", &format!("{ag} has left {home_words}; there is nothing left to order. Dismissed."), json!({ "left": true }), format!("{ag} answers that they have left the home: nothing to order; dismissed."), true);
        } else if let Some((g, nd)) = short {
            self.say2(steps, t, c, "dismissed", &format!("the notice to vacate relied on gave {g} days, and the law asks at least {nd}. Dismissed."), json!({ "notice_short": true }), format!("The notice relied on gave {g} days where the law asks {nd}: what the law asks before an order is not met; dismissed."), true);
        } else if arrears <= 0 {
            self.say2(steps, t, c, "dismissed", "the rent owed has been paid; dismissed.", json!({}), format!("Nothing is owed now ({whose}): dismissed."), true);
        } else if answered && offer > 0 && !has_breach && consider != "none" && !barred && arrears <= offer * pol.plan_months {
            let mut extra = json!({ "amount": arrears, "instalment": offer });
            if let Some(a) = c.data.s("account") {
                extra["to"] = json!(a);
            }
            if let Some(o) = extra.as_object_mut() {
                o.extend(home);
            }
            self.say2(steps, t, c, "plan", &format!("{ag} is to pay the rent as it falls due and {} a month toward the {} owed, until it is paid. If the plan is not kept, {who} may apply again for possession.", money(offer), money(arrears)), extra, format!("{ag} is {} behind ({whose}) and offers {} a month, which clears it within {} months: a plan to pay, and no possession.", money(arrears), money(offer), pol.plan_months), true);
        } else {
            let date = t + pol.days * DAY;
            let why = if has_breach {
                " and has not kept the plan set".to_string()
            } else if !answered {
                " and did not answer".to_string()
            } else if consider == "none" {
                "; the law here gives no plan to set".to_string()
            } else if barred {
                format!("; {} months' rent or more is owed, where the law allows no plan", pol.plan_barred_rent_months.unwrap_or(0))
            } else if offer > 0 {
                format!(", and what they offer ({} a month) would not clear it within {} months", money(offer), pol.plan_months)
            } else {
                ", and says they can pay nothing toward it".to_string()
            };
            let mut extra = json!({ "amount": arrears, "due": date });
            if let Some(o) = extra.as_object_mut() {
                o.extend(home);
            }
            self.say2(steps, t, c, "possession", &format!("{who} is to have possession of {home_words} on {}: {ag} and their household are to leave by then. If they have not, {who} may ask our registrar for a warrant, which is carried out by those who enforce our orders, and by nobody else.", when(date)), extra, format!("{ag} is {} behind with the rent ({whose}){why}: ordering possession by {}. (Decided on the sum owed and the sum offered alone.)", money(arrears), when(date)), true);
        }
    }
}

/// The data of every decision (the fields the TS `say2` wrote).
fn decision_data(c: &Case, finding: &str, binding: bool, t: i64) -> Value {
    let mut d = json!({
        "application": c.id, "kind": c.matter, "matter": c.matter, "applicant": c.applicant, "against": c.against,
        "finding": finding, "binding": binding, "waited_days": (t - c.at).div_euclid(DAY),
    });
    if let Some(a) = c.data.get("about").filter(|v| !v.is_null()) {
        d["about"] = a.clone();
    }
    if let Some(s) = c.data.get("structure").filter(|v| !v.is_null()) {
        d["structure"] = s.clone();
    }
    d
}
