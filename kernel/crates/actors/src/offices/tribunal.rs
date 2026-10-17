//! tribunal.member and tribunal.registrar: a civil tribunal (participants/src/behaviour/tribunal.ts;
//! docs/behaviour/justice.md; docs/design/world-expansion.md 5). Justice is people and records: a party applies; the
//! tribunal lists the application for a hearing and tells both sides; the respondent may answer; on the day the member
//! decides on the record, under the laws in force, and makes an order. Nothing happens because of an order unless
//! someone acts on it: the parties obey it or not, and an unpaid order to pay is enforced by the registrar, who orders
//! the debtor's bank to pay from what it holds (a garnishee order).
//!
//! Ported to Rust. Decided fresh:
//! - **The file is the memory** (bug hunt 2026-10-17, finding 2). Which cases are listed and which decided is read, at
//!   every wake, from the tribunal's own notices of hearing and orders on file (`listed`, `decided`); memory only
//!   bridges the time an act takes to reach the file. A new member carries on: no application is listed twice, no
//!   case decided twice. The registrar reads which requests it has dealt with from the papers it issued since.
//! - Days are written through `when_words`.
//!   (The bug-hunt finding on a dead sole tenant is the landlord's rule, firms.ts: it no longer applies to the tribunal
//!   for the dead; the tribunal still hears what is brought to it.)

use super::hearing::{hearing_notices, Forms, HearPart, Hearings, HearingParams, Hears, NoticeOpts, Possession};
use super::{spread, Booked, Noting};
use crate::common::work::ReportOf;
use crate::common::{breaches, data, filed_before, cites, money_words, when_words, Answering, Book, CounterWork, Fields, Part, StandingWork, DAY};
use crate::steps::{because, say, Plan, Say, Step, Visible};
use crate::{Actor, Cx, Ctx, Kind, Picture};
use oikos_rules::forms::Answers;
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// The kinds of application a tribunal hears here: a notice of rent increase said to breach the law; a debt unpaid.
pub const APPLICATION_KINDS: [&str; 3] = ["rent_increase", "debt", "charge"];

pub struct Member;
pub struct Registrar;

/// Everything the tribunal says it hears: its own lists apart from a charge (the police's), and the world's.
fn tribunal_hears(hears: &[Hears]) -> Vec<Hears> {
    let own = |about: &str, undoes: bool| Hears { about: about.into(), can: vec!["order".into()], undoes, form: Some("tribunal_application".into()), ..Default::default() };
    let mut v = vec![own("rent_increase", true), own("debt", false)];
    v.extend(hears.iter().map(|h| Hears { form: Some("tribunal_application".into()), ..h.clone() }));
    v
}

fn member_answers() -> Answers {
    Answers {
        office: "the tribunal".into(),
        acts: "What it acts on: an application made to it by a party to a dispute, which it hears and decides by the laws in force.".into(),
        forms: vec![],
        report: false,
    }
}
fn registrar_answers() -> Answers {
    Answers {
        office: "the tribunal's registry".into(),
        acts: "What it acts on: an order of the tribunal to pay that has gone unpaid, which it enforces by an order to the debtor's bank.".into(),
        forms: vec![],
        report: false,
    }
}

impl Kind for Member {
    fn name(&self) -> &'static str {
        "tribunal.member"
    }
    fn version(&self) -> &'static str {
        "0.8.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/justice.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "account": { "schema": { "type": "string" }, "default": "", "source": "placeholder" },
                "counter": { "schema": { "type": "boolean" }, "default": false, "source": "placeholder" },
                "fee": { "schema": { "type": "integer" }, "default": 0, "source": "placeholder" },
                "hearing_after_days": { "schema": { "type": "integer", "description": "listed for a hearing this long after it's made (the respondent's time to answer)" }, "unit": "days", "default": 21, "source": "placeholder" },
                "hears": { "schema": { "type": "array" }, "default": [], "source": "placeholder" },
                "office": { "schema": { "type": "string" }, "default": "", "source": "placeholder" },
                "part": { "schema": { "type": "string" }, "default": "", "source": "placeholder" },
                "pay_within_days": { "schema": { "type": "integer", "description": "an order to pay: within this long" }, "unit": "days", "default": 28, "source": "placeholder" },
                "possession": { "schema": {}, "default": null, "source": "placeholder" },
            },
            "perceives": [], "state": "none",
            "issues": super::forms_issued("TRIBUNAL_MEMBER"),
            "routines": [{
                "task": "answer", "at": "office", "every": 1,
                "what": "The tribunal's registry staff take in each application, list it for a hearing and tell both sides, with the day the other side may answer by. They decide nothing: every case is the member's to decide, on or after its day.",
                "papers": [
                    { "kind": "tribunal_application", "how": "taken in and listed; both sides are told, and the other side given the tribunal's time to answer. An application the tribunal does not hear is told so. The case is then the member's to decide" },
                    { "kind": "tribunal_response", "how": "filed with its application, for the member who decides it" },
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
        Ok(Box::new(Answering::new(Noting::new(MemberPlan::new(ctx)?), member_answers())))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let inner = saved.get("inner").cloned().ok_or("tribunal.member: nothing saved")?;
        Ok(Box::new(Answering::restore(Noting::<MemberPlan>::restore(inner)?, member_answers(), &saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct MemberPlan {
    hearing_after_days: i64,
    pay_within_days: i64,
    hears: Vec<Hears>,
    fee: i64,
    account: String,
    part: Part,
    office: String,
    book: Book,
    routines: StandingWork,
    counter: CounterWork,
    lists: Option<Hearings>,
    list_kinds: BTreeSet<String>,
    /// Application -> its hearing (read from the file; bridged by memory while an act is on its way).
    listed: BTreeMap<String, i64>,
    decided: BTreeSet<String>,
    said: bool,
}

impl MemberPlan {
    fn new(ctx: &Ctx) -> Result<Self, String> {
        let hears: Vec<Hears> = ctx.param("hears", vec![])?;
        let hearing_after_days: i64 = ctx.param("hearing_after_days", 21)?;
        let pay_within_days: i64 = ctx.param("pay_within_days", 28)?;
        let possession: Option<Possession> = ctx.param("possession", None)?;
        let part = Part::from_param(&ctx.param("part", String::new())?);
        let offices = ctx.position.as_ref().map(|p| p.trim_end_matches("-staff").to_string()).into_iter();
        let forms = Forms { application: vec!["tribunal_application".into()], notice: "hearing_notice".into(), response: "tribunal_response".into(), decision: "tribunal_order".into() };
        let lists = (!hears.is_empty()).then(|| {
            Hearings::new(&ctx.entity, HearingParams { hears: hears.clone(), answer_days: hearing_after_days, within_days: pay_within_days, refer_to: BTreeMap::new(), possession }, forms, &APPLICATION_KINDS)
        });
        Ok(MemberPlan {
            hearing_after_days,
            pay_within_days,
            list_kinds: hears.iter().map(|h| h.about.clone()).collect(),
            hears,
            fee: ctx.param("fee", 0)?,
            account: ctx.param("account", String::new())?,
            part,
            office: ctx.param("office", String::new())?,
            book: Book::new(),
            routines: StandingWork::new(&ctx.entity, part, offices),
            counter: CounterWork::new(ctx.param("counter", false)?),
            lists,
            listed: BTreeMap::new(),
            decided: BTreeSet::new(),
            said: false,
        })
    }
}

impl Booked for MemberPlan {
    fn book_mut(&mut self) -> &mut Book {
        &mut self.book
    }
}

/// A record or a copy of one a party tendered, as plain JSON (`id`, `record`, `kind`, `speaks_for`, `addressed_to`,
/// `data`, `holder`, `counterparty`, `about`, `at`).
fn doc_of(book: &Book, id: &str, tendered: Option<&Value>) -> Option<Value> {
    if let Some(r) = book.get(id) {
        return serde_json::to_value(r.as_ref()).ok();
    }
    tendered.filter(|e| e.s("id") == Some(id)).cloned()
}

fn names(v: &Value, key: &str) -> Vec<String> {
    v.ids(key).into_iter().map(String::from).collect()
}

impl Plan for MemberPlan {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let (t, me) = (pic.t, cx.ctx.entity.clone());
        let world = cx.ctx.world.clone();
        let when = |x: i64| when_words(x, &world);
        let money = |n: i64| money_words(n, &world);
        let mut steps: Vec<Step<()>> = vec![];
        // (With a registry, and someone in the member's chair: the staff list, while their standing order stands; the
        // member decides. Without one, whoever runs the tribunal does both.)
        let split = self.counter.offered && self.part != Part::Whole;
        let lists_ = !split || (self.part == Part::Staff && self.counter.works(&self.routines, &self.book, t));
        let decides = !split || self.part == Part::Seat;
        let office = if !self.office.is_empty() { self.office.clone() } else { cx.ctx.position.clone().unwrap_or_else(|| "office".into()) };
        steps.extend(self.routines.set(&self.book, self.counter.order(&office).as_slice()));
        // ---- what it hears, said once, so that whoever has such a matter can bring it ----
        if self.lists.is_some() && !self.said && self.part != Part::Staff {
            self.said = true;
            if !self.book.open("hearing").any(|r| r.speaks_for.as_deref() == Some(me.as_str())) {
                let o = NoticeOpts { fee: self.fee, account: &self.account, members_of: "", members_apply: false };
                for n in hearing_notices(&me, "The tribunal hears", &tribunal_hears(&self.hears), &o, cx) {
                    steps.push(because(
                        "Saying what the tribunal hears, so that whoever has such a matter can bring it.",
                        vec![say(&n.kind, &n.text, Say { visible: Some(Visible::Public), data: Some(n.data), extra: vec![("offer", n.offer)], ..Default::default() })],
                    ));
                }
            }
        }
        if let Some(lists) = self.lists.as_mut() {
            if lists_ || decides {
                let before = lists.count_of("applications");
                let part = if !split { HearPart::All } else if lists_ { HearPart::List } else { HearPart::Decide };
                steps.extend(lists.steps(&self.book, cx, part, None));
                for _ in before..lists.count_of("applications") {
                    self.counter.answered(&self.routines, "tribunal_application");
                }
            }
        }
        // ---- which of its own three lists' cases stand listed, and which are decided: read from its file ----
        let ordered: BTreeSet<String> = self
            .book
            .all("tribunal_order")
            .filter(|r| r.speaks_for.as_deref() == Some(me.as_str()))
            .filter_map(|r| data(r).s("application").map(String::from))
            .collect();
        for n in self.book.all("hearing_notice").filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && !data(r).get("matter").is_some_and(Value::is_string)) {
            let Some(id) = data(n).s("application") else { continue };
            if ordered.contains(id) {
                self.decided.insert(id.to_string());
                self.listed.remove(id);
            } else if !self.decided.contains(id) {
                if let Some(h) = data(n).i("hearing_at") {
                    self.listed.insert(id.to_string(), h);
                }
            }
        }
        for id in &ordered {
            self.decided.insert(id.clone());
            self.listed.remove(id);
        }
        // ---- applications: listed for a hearing, both sides told ----
        if lists_ {
            let mut apps: Vec<Arc<Record>> = self
                .book
                .open("tribunal_application")
                .filter(|x| crate::common::addressed_to(x).contains(&me) && !self.listed.contains_key(&x.id) && !self.decided.contains(&x.id))
                .cloned()
                .collect();
            apps.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
            for a in apps {
                let d = data(&a).clone();
                let kind = d.s("kind").unwrap_or("").to_string();
                if self.list_kinds.contains(&kind) {
                    continue; // (heard on its lists, above)
                }
                let against = d.s("against").unwrap_or("").to_string();
                let applicant = a.speaks_for.clone().unwrap_or_default();
                if !APPLICATION_KINDS.contains(&kind.as_str()) || against.is_empty() || against == applicant {
                    self.decided.insert(a.id.clone());
                    steps.push(because(
                        format!("An application we can't hear ({}{}): rejected.", if kind.is_empty() { "of no kind" } else { &kind }, if against.is_empty() { ", against no one" } else { "" }),
                        vec![say(
                            "tribunal_order",
                            &format!("Application {} rejected: the tribunal can't hear it.", a.id),
                            Say { to: Some(vec![applicant.clone()]), visible: Some(Visible::Only(vec![applicant.clone(), me.clone()])), basis: Some(a.id.clone()), data: Some(json!({ "application": a.id, "kind": kind, "finding": "rejected" })), ..Default::default() },
                        )],
                    ));
                    continue;
                }
                let hearing = t + self.hearing_after_days * DAY;
                self.listed.insert(a.id.clone(), hearing);
                self.counter.answered(&self.routines, "tribunal_application");
                steps.push(because(
                    format!("An application ({kind}) by {applicant} against {against}: listing it for a hearing on {}, and telling both.", when(hearing)),
                    vec![say(
                        "hearing_notice",
                        &format!("Notice of hearing: application {} ({kind}) by {applicant} against {against}, to be heard on {}. The respondent may answer before then.", a.id, when(hearing)),
                        Say { to: Some(vec![applicant.clone(), against.clone()]), visible: Some(Visible::Only(vec![applicant.clone(), against.clone(), me.clone()])), basis: Some(a.id.clone()), data: Some(json!({ "application": a.id, "kind": kind, "applicant": applicant, "against": against, "hearing_at": hearing })), ..Default::default() },
                    )],
                ));
            }
        }
        // ---- hearings: on the day, on the record ----
        let due: Vec<(String, i64)> = if decides { self.listed.iter().map(|(k, v)| (k.clone(), *v)).collect() } else { vec![] };
        for (id, hearing) in due {
            if t < hearing {
                continue;
            }
            self.listed.remove(&id);
            self.decided.insert(id.clone());
            let Some(a) = self.book.get(&id).cloned() else { continue };
            let ad = data(&a).clone();
            let kind = ad.s("kind").unwrap_or("").to_string();
            let applicant = a.speaks_for.clone().unwrap_or_default();
            let against = ad.s("against").unwrap_or("").to_string();
            let answer = self
                .book
                .open("tribunal_response")
                .filter(|r| cites(r, &id) && r.speaks_for.as_deref() == Some(against.as_str()))
                .fold(None::<&Arc<Record>>, |b, r| match b {
                    Some(b) if r.at < b.at => Some(b),
                    _ => Some(r),
                })
                .cloned();
            let answered = answer.is_some();
            let mut order = |finding: &str, text: &str, extra: Value, why: String| {
                let mut dd = json!({ "application": id, "kind": kind, "applicant": applicant, "against": against, "finding": finding });
                if let (Some(o), Some(e)) = (dd.as_object_mut(), extra.as_object()) {
                    o.extend(e.clone());
                }
                steps.push(because(
                    why,
                    vec![say(
                        "tribunal_order",
                        &format!("Order on application {id}: {text}"),
                        Say { to: Some(vec![applicant.clone(), against.clone()]), visible: Some(Visible::Only(vec![applicant.clone(), against.clone(), me.clone()])), basis: Some(id.clone()), data: Some(dd), ..Default::default() },
                    )],
                ));
            };
            match kind.as_str() {
                "rent_increase" => {
                    // The notice, tested against the laws in force when it was given, as the landlord gave it. (The
                    // original if we can see it; otherwise the copy the applicant tendered: what passed between the parties.)
                    let nid = ad.s("notice").unwrap_or("").to_string();
                    let n = doc_of(&self.book, &nid, ad.get("evidence"));
                    let ok = n.as_ref().is_some_and(|n| n.s("record") == Some("statement") && n.s("kind") == Some("rent_increase") && n.s("speaks_for") == Some(against.as_str()) && names(n, "addressed_to").contains(&applicant));
                    let Some(n) = n.filter(|_| ok) else {
                        order("dismissed", "dismissed: no such notice from the respondent to the applicant.", json!({ "notice": ad.get("notice") }), "The notice the application names isn't on the record as the respondent's to the applicant: dismissed.".into());
                        continue;
                    };
                    let nat = n.i("at").unwrap_or(0);
                    let act = json!({ "block": "publish", "kind": "rent_increase", "data": n.get("data").cloned().unwrap_or(Value::Null) });
                    let broken: Vec<String> = breaches(&mut self.book, &act, &against, nat).iter().map(|l| l.id.clone()).collect();
                    let nid = n.s("id").unwrap_or("").to_string();
                    if !broken.is_empty() {
                        let list = broken.join(", ");
                        order(
                            "invalid",
                            &format!("the notice of rent increase {nid} breaches {list} and is invalid; the rent stays as it was."),
                            json!({ "notice": nid, "laws": broken }),
                            format!("The notice breaches {list}{}: the increase is invalid.", if answered { " (whatever the respondent says)" } else { " (the respondent didn't answer)" }),
                        );
                    } else {
                        order("valid", &format!("the notice of rent increase {nid} is valid; the application is dismissed."), json!({ "notice": nid }), "The notice breaches no law in force when it was given: dismissed.".into());
                    }
                }
                "charge" => {
                    // A charge (crime): the police's evidence that the respondent took goods; proven, the taker makes good
                    // what they were worth to whom they were taken from.
                    let ev = ad.get("evidence").cloned().unwrap_or(Value::Null);
                    if ev.s("found") != Some(against.as_str()) || ad.get("account").is_none_or(Value::is_null) {
                        order("dismissed", "dismissed: the evidence doesn't show the respondent took them.", json!({}), "The evidence doesn't name the respondent: dismissed.".into());
                        continue;
                    }
                    let amount = ad.i("amount").unwrap_or(0);
                    let due = t + self.pay_within_days * DAY;
                    let victim = ad.s("victim").unwrap_or("").to_string();
                    order(
                        "pay",
                        &format!("proven: the respondent took {} from {victim} at {}, and is to pay them {} by {}.", ev.s("goods").unwrap_or("goods"), ev.get("at").map(|v| v.as_i64().map_or_else(|| v.to_string(), |n| when(n))).unwrap_or_default(), money(amount), when(due)),
                        json!({ "victim": victim, "amount": amount, "to": ad.get("account"), "due": due, "report": ad.get("report") }),
                        format!("The police's investigation found {against} took them{}: proven; ordering them to make good the {}.", if answered { " (whatever they say)" } else { " (they didn't answer)" }, money(amount)),
                    );
                }
                "debt" => {
                    // A debt on the record (the applicant's, against the respondent), less what the respondent says it has paid.
                    let cid = ad.s("claim").unwrap_or("").to_string();
                    let c = doc_of(&self.book, &cid, ad.get("evidence"));
                    let ok = c.as_ref().is_some_and(|c| c.s("record") == Some("claim") && c.s("holder") == Some(applicant.as_str()) && c.s("counterparty") == Some(against.as_str()));
                    let Some(c) = c.filter(|_| ok) else {
                        order("dismissed", "dismissed: no such debt recorded by the applicant against the respondent.", json!({ "claim": ad.get("claim") }), "The debt the application names isn't on the record: dismissed.".into());
                        continue;
                    };
                    let paid = answer.as_ref().and_then(|r| data(r).i("paid")).unwrap_or(0);
                    let total = c.get("about").and_then(|a| a.i("amount")).unwrap_or(0);
                    let owed = total - paid;
                    let cid = c.s("id").unwrap_or("").to_string();
                    if owed <= 0 {
                        order("paid", "the debt has been paid; dismissed.", json!({ "claim": cid, "paid": paid }), format!("The respondent says it has paid the {} owed: dismissed.", money(paid)));
                    } else {
                        let due = t + self.pay_within_days * DAY;
                        let said = if paid > 0 { format!(", {} of it paid, the respondent says", money(paid)) } else if answered { String::new() } else { " (the respondent didn't answer)".into() };
                        order(
                            "pay",
                            &format!("the respondent is to pay the applicant {} by {}.", money(owed), when(due)),
                            json!({ "claim": cid, "amount": owed, "to": ad.get("account"), "due": due }),
                            format!("A debt of {} on the record{said}: ordering payment of {}.", money(total), money(owed)),
                        );
                    }
                }
                _ => {}
            }
        }
        if split && self.part == Part::Staff {
            self.counter.flush(&mut self.routines, t);
            let office = cx.ctx.position.clone().unwrap_or_default().trim_end_matches("-staff").to_string();
            let tasks: Vec<_> = self.counter.tasks().into_iter().collect();
            let report: Vec<Step<()>> = self.routines.report(&self.book, cx, &ReportOf { office: &office, from: "the tribunal's registry staff", tasks, ..Default::default() });
            self.counter.reported(&mut self.routines, &report);
            steps.extend(report);
        }
        steps
    }
}

// ---------------------------------------------------------------------------------------------- the registrar

impl Kind for Registrar {
    fn name(&self) -> &'static str {
        "tribunal.registrar"
    }
    fn version(&self) -> &'static str {
        "0.3.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/justice.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "banks": { "schema": { "type": "array" }, "default": [], "required": true, "source": "placeholder" },
                "enforcer": { "schema": { "type": "string" }, "default": "", "source": "placeholder" },
                "eviction_notice_days": { "schema": { "type": "integer" }, "unit": "days", "default": 0, "source": "placeholder" },
                "part": { "schema": {}, "source": "the world gives it (no default)" },
                "warrant_days": { "schema": { "type": "integer" }, "unit": "days", "default": 14, "source": "placeholder" },
            },
            "perceives": [], "state": "none",
            "issues": super::forms_issued("TRIBUNAL_REGISTRAR"),
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        spread(ctx, 10 * 3600, 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let banks: Vec<String> = ctx.need("banks", "tribunal.registrar")?;
        let plan = RegistrarPlan {
            banks,
            enforcer: ctx.param("enforcer", String::new())?,
            warrant_days: ctx.param("warrant_days", 14)?,
            eviction_notice_days: ctx.param("eviction_notice_days", 0)?,
            book: Book::new(),
            done: BTreeSet::new(),
        };
        Ok(Box::new(Answering::new(Noting::new(plan), registrar_answers())))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let inner = saved.get("inner").cloned().ok_or("tribunal.registrar: nothing saved")?;
        Ok(Box::new(Answering::restore(Noting::<RegistrarPlan>::restore(inner)?, registrar_answers(), &saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct RegistrarPlan {
    banks: Vec<String>,
    enforcer: String,
    warrant_days: i64,
    eviction_notice_days: i64,
    book: Book,
    /// Requests dealt with (bridges the time an act takes to reach the file; the file says the same).
    done: BTreeSet<String>,
}

impl Booked for RegistrarPlan {
    fn book_mut(&mut self) -> &mut Book {
        &mut self.book
    }
}

impl RegistrarPlan {
    /// Whether the papers we have issued show a request dealt with already: a decline citing it, or the paper it
    /// asked for (a garnishee order, a warrant) on the same order made since the request.
    fn dealt_with(&self, me: &str, r: &Record, order: &str, issued: &str) -> bool {
        self.book.all("enforcement_decline").any(|d| d.speaks_for.as_deref() == Some(me) && cites(d, &r.id))
            || self.book.all(issued).any(|p| p.speaks_for.as_deref() == Some(me) && p.at >= r.at && data(p).s("order") == Some(order))
    }
}

impl Plan for RegistrarPlan {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let (t, me) = (pic.t, cx.ctx.entity.clone());
        let world = cx.ctx.world.clone();
        let when = |x: i64| when_words(x, &world);
        let money = |n: i64| money_words(n, &world);
        let mut steps: Vec<Step<()>> = vec![];
        let decline = |r: &Record, me: &str, why: &str, words: &str| -> Step<()> {
            let rs = r.speaks_for.clone().unwrap_or_default();
            because(why, vec![say("enforcement_decline", words, Say { to: Some(vec![rs.clone()]), visible: Some(Visible::Only(vec![rs, me.to_string()])), basis: Some(r.id.clone()), ..Default::default() })])
        };
        // A creditor asks for an order to pay to be enforced: once it's due, the debtor's banks are ordered to pay it from
        // what they hold for the debtor (what's unpaid, as the creditor says).
        let mut reqs: Vec<Arc<Record>> = self.book.open("enforcement_request").filter(|x| crate::common::addressed_to(x).contains(&me) && !self.done.contains(&x.id)).cloned().collect();
        reqs.sort_by(|a, b| filed_before(&a.id, &b.id));
        for r in reqs {
            let rd = data(&r).clone();
            let oid = rd.s("order").unwrap_or("").to_string();
            let o = self.book.get(&oid).cloned();
            let od = o.as_ref().map(|o| data(o).clone()).unwrap_or(Value::Null);
            let is_order = o.as_ref().is_some_and(|o| crate::common::is_kind(o, "tribunal_order"));
            if is_order && od.s("finding") == Some("pay") && od.i("due").is_some_and(|d| t < d) {
                continue; // (not due yet)
            }
            if self.dealt_with(&me, &r, &oid, "garnishee_order") {
                self.done.insert(r.id.clone());
                continue;
            }
            self.done.insert(r.id.clone());
            let rs = r.speaks_for.clone().unwrap_or_default();
            if !is_order || od.s("finding") != Some("pay") || od.s("applicant") != Some(rs.as_str()) || od.get("to").is_none_or(Value::is_null) {
                steps.push(decline(&r, &me, "A request to enforce something that isn't an order to pay this creditor: declined.", "Declined: no order to pay you to enforce."));
                continue;
            }
            let amount = od.i("amount").unwrap_or(0);
            let unpaid = amount.min(rd.i("unpaid").unwrap_or(amount));
            if unpaid <= 0 {
                continue;
            }
            let against = od.s("against").unwrap_or("").to_string();
            let mut seen = self.banks.clone();
            seen.extend([me.clone(), against.clone(), od.s("applicant").unwrap_or("").to_string()]);
            steps.push(because(
                format!("An order to pay {}, due and unpaid: ordering {against}'s bank to pay it from what it holds.", money(unpaid)),
                vec![say(
                    "garnishee_order",
                    &format!("Garnishee order: pay {} owed by {against} under order {oid} to {}, from what you hold for them.", money(unpaid), od.s("to").unwrap_or("")),
                    Say {
                        to: Some(self.banks.clone()),
                        visible: Some(Visible::Only(seen)),
                        basis: Some(oid.clone()),
                        data: Some(json!({ "order": oid, "debtor": against, "amount": unpaid, "to": od.get("to"), "claim": od.get("claim").cloned().unwrap_or(json!(oid)) })),
                        ..Default::default()
                    },
                )],
            ));
        }
        // A landlord asks for a warrant on an order for possession whose date has passed: issued to whoever carries our
        // warrants out (the world's: its police), naming the home, the tenant and their household, and the day it runs
        // out. The tenant is told. Nothing is done by the paper: someone must go.
        let mut reqs: Vec<Arc<Record>> = self.book.open("warrant_request").filter(|x| crate::common::addressed_to(x).contains(&me) && !self.done.contains(&x.id)).cloned().collect();
        reqs.sort_by(|a, b| filed_before(&a.id, &b.id));
        for r in reqs {
            let rd = data(&r).clone();
            let oid = rd.s("order").unwrap_or("").to_string();
            let o = self.book.get(&oid).cloned();
            let od = o.as_ref().map(|o| data(o).clone()).unwrap_or(Value::Null);
            let is_order = o.as_ref().is_some_and(|o| crate::common::is_kind(o, "tribunal_order"));
            if is_order && od.s("finding") == Some("possession") && od.i("due").is_some_and(|d| t < d) {
                continue;
            }
            if self.dealt_with(&me, &r, &oid, "warrant") {
                self.done.insert(r.id.clone());
                continue;
            }
            self.done.insert(r.id.clone());
            let rs = r.speaks_for.clone().unwrap_or_default();
            if self.enforcer.is_empty() || !is_order || od.s("finding") != Some("possession") || od.s("applicant") != Some(rs.as_str()) {
                steps.push(decline(&r, &me, "A request for a warrant on something that isn't an order for possession to this applicant: declined.", "Declined: no order for possession to you to enforce."));
                continue;
            }
            // (Not before the tenant has had the law's notice of the day; not after the warrant's last day.)
            let not_before = (t.div_euclid(DAY) + 1 + self.eviction_notice_days) * DAY;
            let until = not_before.max(t + self.warrant_days * DAY);
            let (tenant, landlord) = (od.s("against").unwrap_or("").to_string(), od.s("applicant").unwrap_or("").to_string());
            let household = od.get("household").cloned().unwrap_or_else(|| json!([tenant]));
            steps.push(because(
                format!("An order for possession whose date has passed, and the tenant has not left: a warrant to {}, to be carried out from {} to {}.", self.enforcer, when(not_before), when(until)),
                vec![say(
                    "warrant",
                    &format!(
                        "Warrant of possession under order {oid}: {tenant} and their household are to be removed from {}, and possession given to {landlord}. To be carried out {}by {}.",
                        od.s("space").unwrap_or("the home"),
                        if self.eviction_notice_days > 0 { format!("no sooner than {} and ", when(not_before)) } else { String::new() },
                        when(until)
                    ),
                    Say {
                        to: Some(vec![self.enforcer.clone()]),
                        visible: Some(Visible::Only(vec![self.enforcer.clone(), me.clone(), tenant.clone(), landlord.clone()])),
                        basis: Some(oid.clone()),
                        data: Some(json!({ "order": oid, "lease": od.get("about"), "tenant": tenant, "landlord": landlord, "space": od.get("space"), "structure": od.get("structure"), "household": household, "not_before": not_before, "until": until })),
                        ..Default::default()
                    },
                )],
            ));
        }
        // A landlord who withdraws its request for a warrant (the tenant has gone): the warrant we issued on it, if not
        // yet carried out or run out, is withdrawn, which whoever was to carry it out reads.
        let warrants: Vec<Arc<Record>> = self.book.open("warrant").filter(|x| x.speaks_for.as_deref() == Some(me.as_str()) && !self.done.contains(&format!("w:{}", x.id))).cloned().collect();
        for w in warrants {
            let wd = data(&w).clone();
            let withdrawn = self.book.all("warrant_request").any(|r| data(r).s("order") == wd.s("order") && r.speaks_for.as_deref() == wd.s("landlord") && self.book.withdrawn(&r.id));
            if !withdrawn {
                continue;
            }
            self.done.insert(format!("w:{}", w.id));
            if wd.i("until").is_some_and(|u| t > u) || self.book.all("warrant_executed").any(|x| data(x).s("warrant") == Some(w.id.as_str())) {
                continue;
            }
            steps.push(because(
                format!("{} has withdrawn its request for the warrant {} (the tenant has left): withdrawing the warrant.", wd.s("landlord").unwrap_or(""), w.id),
                vec![crate::common::withdraw(&w.id, Some("Withdrawn: the landlord says the tenant has left the home."))],
            ));
        }
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::{st, Rig, DAY};
    use super::*;
    use serde_json::json;

    fn rent_law() -> Value {
        let mut l = st("law-rent", 0, "law", "outside", &[], json!({}));
        l["adico"] = json!({ "attribute": "landlords", "deontic": "must_not", "aim": "increase a rent" });
        l["formal"] = json!({ "language": "cel", "condition": format!("block.block == 'publish' && block.kind == 'rent_increase' && (block.data.from - now < {} || block.data.from - block.data.last_from < {})", 60 * DAY, 360 * DAY) });
        l
    }
    fn notice(id: &str, at: i64, from: i64, last_from: i64) -> Value {
        st(id, at, "rent_increase", "landlord-1", &["c0001"], json!({ "lease": "lease-1", "rent": "200000", "from": from, "was": "180000", "last_from": last_from }))
    }
    fn apply(id: &str, at: i64, data: Value) -> Value {
        st(id, at, "tribunal_application", "c0001", &["tribunal"], data)
    }
    fn member(params: Value) -> Rig {
        Rig::new(&Member, "tribunal", None, params)
    }

    #[test]
    fn a_notice_of_rent_increase_that_breaks_the_law_is_found_invalid_and_one_that_does_not_valid() {
        let mut m = member(json!({ "hearing_after_days": 21 }));
        let t0 = 400 * DAY;
        let bad = notice("rec.1", t0 - 10 * DAY, t0 + 20 * DAY, t0 - 200 * DAY);
        let good = notice("rec.2", t0 - 10 * DAY, t0 + 60 * DAY, t0 - 400 * DAY);
        let a1 = apply("rec.3", t0, json!({ "kind": "rent_increase", "against": "landlord-1", "notice": "rec.1", "evidence": bad }));
        let a2 = apply("rec.4", t0, json!({ "kind": "rent_increase", "against": "landlord-1", "notice": "rec.2", "evidence": good }));
        let listed = m.day(t0, &[rent_law(), a1, a2]).join("\n");
        assert_eq!(listed.matches("kind=hearing_notice").count(), 2, "{listed}");
        assert!(listed.contains(&format!("\"hearing_at\":{}", t0 + 21 * DAY)), "{listed}");
        assert!(m.day(t0 + 10 * DAY, &[]).is_empty(), "not yet");
        let heard = m.day(t0 + 21 * DAY, &[]).join("\n");
        assert!(heard.contains("\"finding\":\"invalid\"") && heard.contains("law-rent"), "{heard}");
        assert!(heard.contains("\"finding\":\"valid\""), "{heard}");
    }

    #[test]
    fn an_application_is_listed_once_and_a_new_member_carries_on_from_the_file() {
        let t0 = 400 * DAY;
        let a = apply("rec.3", t0, json!({ "kind": "debt", "against": "firm-1", "claim": "rec.9" }));
        let mut m = member(json!({}));
        let first = m.day(t0, &[a.clone()]).join("\n");
        assert_eq!(first.matches("kind=hearing_notice").count(), 1, "{first}");
        assert!(m.day(t0 + DAY, &[]).is_empty(), "not listed twice");
        // A successor in the post is shown the file: the application and the tribunal's own notice of hearing.
        let mut n = st("rec.10", t0 + 3600, "hearing_notice", "tribunal", &["c0001", "firm-1"], json!({ "application": "rec.3", "kind": "debt", "applicant": "c0001", "against": "firm-1", "hearing_at": t0 + 21 * DAY }));
        n["author"] = json!("p.old");
        let mut s = member(json!({}));
        assert!(s.day(t0 + 2 * DAY, &[a, n]).is_empty(), "the successor lists nothing again");
    }

    #[test]
    fn a_debt_is_ordered_paid_less_what_the_respondent_says_it_paid_and_an_unhearable_application_is_rejected() {
        let t0 = 400 * DAY;
        let claim = json!({ "id": "rec.9", "record": "claim", "author": "p.x", "at": t0 - 50 * DAY, "visible_to": "public", "position": "right", "holder": "c0001", "counterparty": "firm-1", "about": { "kind": "debt", "amount": 90_000 } });
        let a = apply("rec.3", t0, json!({ "kind": "debt", "against": "firm-1", "claim": "rec.9", "account": "acc.c1", "evidence": claim }));
        let odd = apply("rec.4", t0, json!({ "kind": "gossip", "against": "firm-1" }));
        let resp = st("rec.5", t0 + DAY, "tribunal_response", "firm-1", &["tribunal"], json!({ "paid": 20_000 }));
        let mut resp = resp;
        resp["basis"] = json!("rec.3");
        let mut m = member(json!({ "pay_within_days": 28 }));
        let listed = m.day(t0, &[a, odd]).join("\n");
        assert!(listed.contains("rejected"), "{listed}");
        m.day(t0 + DAY, &[resp]);
        let heard = m.day(t0 + 21 * DAY, &[]).join("\n");
        assert!(heard.contains("\"finding\":\"pay\"") && heard.contains("\"amount\":70000"), "{heard}");
    }

    #[test]
    fn the_registrar_orders_the_debtors_bank_once_an_order_to_pay_falls_due_and_asked_once() {
        let t0 = 400 * DAY;
        let order = st("rec.20", t0, "tribunal_order", "tribunal", &["c0001", "firm-1"], json!({ "application": "rec.3", "finding": "pay", "applicant": "c0001", "against": "firm-1", "amount": 70_000, "to": "acc.c1", "due": t0 + 28 * DAY }));
        let req = st("rec.21", t0 + 29 * DAY, "enforcement_request", "c0001", &["tribunal-registry"], json!({ "order": "rec.20", "unpaid": 70_000 }));
        let mut r = Rig::new(&Registrar, "tribunal-registry", None, json!({ "banks": ["bank-1"] }));
        let first = r.day(t0 + 29 * DAY, &[order, req]).join("\n");
        assert!(first.contains("kind=garnishee_order") && first.contains("\"amount\":70000"), "{first}");
        assert!(r.day(t0 + 30 * DAY, &[]).is_empty());
    }

    #[test]
    fn the_manifests_are_the_ones_the_ts_modules_wrote() {
        for (kind, name) in [(&Member as &dyn Kind, "tribunal.member"), (&Registrar as &dyn Kind, "tribunal.registrar")] {
            let ts: Value = serde_json::from_slice(&std::fs::read(format!("{}/../../../participants/manifests/{name}.json", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap();
            let rust = kind.manifest();
            for (k, v) in ts.as_object().unwrap() {
                assert_eq!(&rust[k], v, "{name}: {k}");
            }
        }
    }
}
