//! group.founded: the post a founder holds in what they have founded (participants/src/behaviour/founded.ts, 0.2.1;
//! docs/behaviour/founding.md), in Rust (lane A2). A group that gathers, a fund its members pay into and draw on, or a
//! body that takes its members' grievances up: each put up from blocks that exist (a statement of what it is for, a
//! gathering, an offer of membership, a hearing), by one module whose parameters say which. The kernel knows none of
//! them by name.
//!
//! What it does, as a convenor does it: opens an account if it takes dues; says what it is for; puts up its gathering
//! at the one place it can use (the founder's home, until it outgrows it and can pay the hire of a hall); offers
//! membership and takes in whoever applies; pays a member's draw on the fund by its stated rule; hears its members'
//! grievances with the hours its members give; and winds up when nobody has joined.
//!
//! Decided fresh (docs/port-guide.md, section 2):
//! - **Words through the translator** go through the host: each part of a founder's composed piece is a `words` question
//!   (`founding::words_question`), which the host drafts with the translator as run.ts `wordsFor` does; at the next wake
//!   the answer is held to `founding.rs`'s `accept_*`, and an accepted draft is sent as its blocks with the draft's
//!   provenance (`steps::Drafted`). Anything else arrives the other way: the composer's closed choice, or code. TS asked
//!   and acted in one wake; here the part waits a wake for its answer, and nothing else of setting up is done meanwhile.
//! - The hours a body's members give are kept as `hours x MONTH` (an integer: `(members + 1) x hours-a-month x seconds`
//!   added each wake), so the bank and the cases it pays for are exact where TS kept a float.
//! - A date in a text is written by `common::when_words` ("by day N" in TS), a sum by `common::money_words`.
//! - The record the group keeps of itself (`cx.set_record`) is worked out at the start of a wake that plans, after the
//!   planning, where TS worked it out when the group went idle; the group changes nothing between.
//! - `Hearings` below is the small part of desk.ts's class a founded body needs (lane E ports the whole): its venue is
//!   an application desk that recommends and represents (never orders, mediates, refers, or hears an appeal or
//!   possession), so those branches are left to lane E. Reads of a paper's data are lenient, as TS's were, through
//!   `Fields`; what it writes goes through the typed papers.

use oikos_core::frozen::JsonRef;
use super::founding::{accept_gathering, accept_membership, accept_purpose, membership_offer, slice16, words_came, words_question, Came, GatherBounds, Hall, MembershipBounds};
use crate::common::{
    addressed_to, cites, data, filed_before, money_words, own_banked, part, when_words, withdraw, Book, Fields, Occurrences, OwnAccount, Piece, DAY, MONTH,
};
use crate::papers::mind::{FundDecision, FundRule, HallBooking, Membership, Notice, Purpose, WoundUp};
use crate::papers::offices::{ComplaintNotice, Decision, Hearing, Notice as VenueNotice, VenueDecision};
use crate::papers::finance::ComplaintResponse;
use crate::papers::{data as paper_data, lenient, Paper};
use crate::steps::{arg, because, call, pay, say, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_contracts::blocks::Block;
use oikos_sight::calls::{Call, Value as Arg};
use oikos_sight::{Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

// ======================================================================================== desk.ts, the part founded uses

/// What a venue says it hears (the contract's Offer.hears), with how it goes about it (desk.ts `Hears`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Hears {
    pub about: String,
    /// `order`, `recommend`, `mediate`, `refer`, `represent`, `publish` (absent: it orders).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub can: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub undoes: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub within: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee: Option<i64>,
}

/// The offer a venue publishes: who it is, what it hears (desk.ts `hearingOffer`; lane E's, ported in the part founded
/// needs: `members_of`, the entity whose members apply; no fee).
pub fn hearing_offer(me: &str, hears: &[Hears], members_of: Option<&str>) -> Value {
    let mut o = Map::new();
    o.insert("by".into(), json!(me));
    o.insert("take_up".into(), json!("apply"));
    if let Some(m) = members_of.filter(|m| !m.is_empty()) {
        o.insert("to".into(), json!({ "members_of": m }));
    }
    let hs: Vec<Value> = hears
        .iter()
        .map(|h| {
            let mut x = Map::new();
            x.insert("about".into(), json!(h.about));
            if let Some(c) = h.can.as_ref().filter(|c| !c.is_empty()) {
                x.insert("can".into(), json!(c));
            }
            if h.undoes {
                x.insert("undoes".into(), json!(true));
            }
            if let Some(f) = h.form.as_ref().filter(|f| !f.is_empty()) {
                x.insert("form".into(), json!(f));
            }
            if let Some(w) = h.within.filter(|w| *w != 0) {
                x.insert("within".into(), json!(w));
            }
            Value::Object(x)
        })
        .collect();
    o.insert("hears".into(), Value::Array(hs));
    Value::Object(o)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Case {
    id: String,
    matter: String,
    applicant: String,
    against: String,
    at: i64,
    answer_by: i64,
    data: Value,
    hears: Hears,
}

/// The hearing of applications (desk.ts `Hearings`, `part: "all"`): listing, telling the other side, deciding on the
/// record, saying so. Where the record cannot settle a case it finds for the applicant at the rate of the world's table
/// of slips for a venue's decision (`publish/venue_decision`, foundations F7).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hearings {
    me: String,
    hears: Vec<Hears>,
    answer_days: i64,
    within_days: i64,
    cases: BTreeMap<String, Case>,
    seen: BTreeSet<String>,
    /// Cases we have decided ourselves: never taken up again from the file, where our own decision may not yet show.
    closed: BTreeSet<String>,
    /// Which case each application is to us: by who against whom about what, not by its number on file.
    nth: Occurrences,
    /// What it did, for whoever counts: applications, by finding.
    pub counts: BTreeMap<String, i64>,
    /// Days from application to decision, the last 512.
    pub waits: Vec<i64>,
}

/// Whether an application says what it is about: it gives its particulars, or names a paper, a place, a sum, what is
/// sought, or evidence (frictions.ts `hasParticulars`).
fn has_particulars<V: oikos_core::frozen::JsonRead + ?Sized>(d: &V) -> bool {
    let d = d.view();
    let num_pos = match d.get("amount") {
        Some(JsonRef::Number(n)) => n.as_f64().is_some_and(|x| x > 0.0),
        Some(JsonRef::String(s)) => s.trim().parse::<f64>().is_ok_and(|x| x > 0.0),
        _ => false,
    };
    d.get("particulars").and_then(|x| x.as_str()).is_some_and(|p| !p.trim().is_empty())
        || d.get("about").is_some()
        || d.get("structure").is_some()
        || d.get("seeks").is_some()
        || num_pos
        || d.get("evidence").is_some()
}

/// The latest response of the one it is against that cites an application (frictions.ts `responseTo`).
fn response_to<'a>(book: &'a Book, kind: &str, application: &str, from: &str) -> Option<&'a Arc<Record>> {
    let mut best: Option<&Arc<Record>> = None;
    for r in book.open(kind).filter(|r| cites(r, application) && r.speaks_for.as_deref() == Some(from)) {
        if best.is_none_or(|b| r.at > b.at) {
            best = Some(r);
        }
    }
    best
}

/// The truthy string of a data field (`...(d.about ? { about } : {})`).
fn truthy_s<V: Fields + ?Sized>(d: &V, k: &str) -> Option<String> {
    d.s(k).filter(|s| !s.is_empty()).map(String::from)
}

fn by_filed(a: &Arc<Record>, b: &Arc<Record>) -> std::cmp::Ordering {
    a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id))
}

/// A decision's extras (what a finding adds to the case's own facts).
#[derive(Default)]
struct Extra {
    amount: Option<i64>,
    to: Option<String>,
    due: Option<i64>,
    no_particulars: bool,
}

impl Hearings {
    pub fn new(me: &str, hears: Vec<Hears>, answer_days: i64, within_days: i64) -> Self {
        Hearings {
            me: me.to_string(),
            hears,
            answer_days,
            within_days,
            cases: BTreeMap::new(),
            seen: BTreeSet::new(),
            closed: BTreeSet::new(),
            nth: Occurrences::default(),
            counts: BTreeMap::new(),
            waits: vec![],
        }
    }
    /// How many cases stand open.
    pub fn open(&self) -> usize {
        self.cases.len()
    }
    fn count(&mut self, what: &str) {
        *self.counts.entry(what.to_string()).or_insert(0) += 1;
    }

    /// Says a decision on a case and closes it (`say2`).
    #[allow(clippy::too_many_arguments)]
    fn decide<T>(&mut self, steps: &mut Vec<Step<T>>, c: &Case, finding: &str, text: &str, extra: Extra, why: String, binding: bool, t: i64) {
        self.cases.remove(&c.id);
        self.closed.insert(c.id.clone());
        self.count(finding);
        let waited = (t - c.at).div_euclid(DAY);
        self.waits.push(waited);
        if self.waits.len() > 512 {
            self.waits.remove(0);
        }
        let mut d = Map::new();
        d.insert("application".into(), json!(c.id));
        d.insert("kind".into(), json!(c.matter));
        d.insert("matter".into(), json!(c.matter));
        d.insert("applicant".into(), json!(c.applicant));
        d.insert("against".into(), json!(c.against));
        d.insert("finding".into(), json!(finding));
        d.insert("binding".into(), json!(binding));
        d.insert("waited_days".into(), json!(waited));
        for k in ["about", "structure", "seeks"] {
            if let Some(v) = truthy_s(&c.data, k) {
                d.insert(k.into(), json!(v));
            }
        }
        if let Some(a) = extra.amount {
            d.insert("amount".into(), json!(a));
        }
        if let Some(to) = extra.to {
            d.insert("to".into(), json!(to));
        }
        if let Some(due) = extra.due {
            d.insert("due".into(), json!(due));
        }
        if extra.no_particulars {
            d.insert("no_particulars".into(), json!(true));
        }
        let decision: Decision = serde_json::from_value(Value::Object(d)).unwrap_or_else(|e| panic!("a decision's own shape: {e}"));
        let to: Vec<String> = [c.applicant.clone(), c.against.clone()].into_iter().filter(|x| !x.is_empty()).collect();
        let visible: Vec<String> = [c.applicant.clone(), c.against.clone(), self.me.clone()].into_iter().filter(|x| !x.is_empty()).collect();
        steps.push(because(
            why,
            vec![say(
                VenueDecision::KIND,
                &format!("Decision on {}: {}", c.id, text),
                Say { to: Some(to), visible: Some(Visible::Only(visible)), basis: Some(c.id.clone()), data: Some(paper_data(&VenueDecision(decision))), ..Default::default() },
            )],
        ));
    }

    /// What the venue does at a wake (`steps(book, t, "all", canDecide)`): `can_decide` is how many cases can be decided
    /// now (none: no limit, a fixed number a day), where it is the hours of those who decide.
    pub fn steps<T>(&mut self, book: &Book, t: i64, can_decide: Option<i64>, cx: &mut Cx) -> Vec<Step<T>> {
        let me = self.me.clone();
        let mut steps: Vec<Step<T>> = vec![];
        let usd = |n: i64, cx: &Cx| money_words(n, &cx.ctx.world);
        let day = |n: i64, cx: &Cx| when_words(n, &cx.ctx.world);
        let hears_of = |hs: &[Hears], matter: &str| hs.iter().find(|h| h.about == matter).cloned();

        // ---- cases our own file says are already listed, that we did not list ourselves: taken as they stand ----
        let decided_on_file: BTreeSet<String> =
            book.all(VenueDecision::KIND).filter(|r| r.speaks_for.as_deref() == Some(me.as_str())).map(|r| data(r).s("application").unwrap_or("").to_string()).collect();
        let mut listed: Vec<&Arc<Record>> =
            book.all(ComplaintNotice::KIND).filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("matter").is_some()).collect();
        listed.sort_by(|x, y| by_filed(x, y));
        for n in listed {
            let nd = data(n);
            let id = nd.s("application").unwrap_or("").to_string();
            if self.seen.contains(&id) {
                continue;
            }
            let Some(a) = book.get(&id) else { continue };
            self.seen.insert(id.clone());
            let d = data(a);
            let matter = d.s("matter").or_else(|| d.s("kind")).or_else(|| nd.s("matter")).unwrap_or("").to_string();
            if decided_on_file.contains(&id) || self.closed.contains(&id) || book.withdrawn(&id) {
                continue;
            }
            let against = d.s("against").or_else(|| nd.s("against")).unwrap_or("").to_string();
            let answer_by = nd.i("answer_by").or_else(|| nd.i("hearing_at")).unwrap_or(t);
            let hears = hears_of(&self.hears, &matter).unwrap_or(Hears { about: matter.clone(), ..Default::default() });
            self.cases.insert(id.clone(), Case { id, matter, applicant: a.speaks_for.unwrap_or_default().to_string(), against, at: a.at, answer_by, data: d.to_value(), hears });
        }

        // ---- applications: taken, and the other side told ----
        let mut apps: Vec<&Arc<Record>> = book.open("application").filter(|x| addressed_to(x).iter().any(|x| x == &me) && !self.seen.contains(x.id.as_str())).collect();
        apps.sort_by(|x, y| by_filed(x, y));
        for a in apps {
            let d = data(a);
            let matter = d.s("matter").or_else(|| d.s("kind")).unwrap_or("").to_string();
            self.seen.insert(a.id.to_string());
            let applicant = a.speaks_for.unwrap_or_default();
            let hears = hears_of(&self.hears, &matter);
            let against = d.s("against").unwrap_or("").to_string();
            let c = Case {
                id: a.id.to_string(),
                matter: matter.clone(),
                applicant: applicant.to_string(),
                against: against.clone(),
                at: a.at,
                answer_by: t + self.answer_days * DAY,
                data: d.to_value(),
                hears: hears.clone().unwrap_or(Hears { about: matter.clone(), ..Default::default() }),
            };
            self.count("applications");
            let words = matter.replace('_', " ");
            let Some(hears) = hears.filter(|_| against != applicant) else {
                self.decide(&mut steps, &c, "rejected", "we cannot hear it.", Extra::default(), format!("An application we do not hear ({}): saying so.", if matter.is_empty() { "of no kind" } else { &matter }), true, t);
                continue;
            };
            let can = hears.can.clone().unwrap_or_else(|| vec!["order".into()]);
            if against.is_empty() {
                self.decide(&mut steps, &c, "rejected", "it names nobody it is against.", Extra::default(), "An application against no one: saying so.".into(), true, t);
                continue;
            }
            self.cases.insert(a.id.to_string(), c.clone());
            let seeking = match d.get("amount").and_then(lenient::whole) {
                Some(n) if n != 0 => format!(", seeking {}", usd(n, cx)),
                _ => String::new(),
            };
            let text = format!(
                "{applicant} has applied to us about {words}{seeking} (application {}). You may answer by {}{}.",
                a.id,
                day(c.answer_by, cx),
                if can.iter().any(|x| x == "mediate") { ", and say whether you will meet them with us" } else { "" }
            );
            let notice = VenueNotice {
                application: a.id.to_string(),
                kind: matter.clone(),
                matter: Some(matter.clone()),
                applicant: applicant.to_string(),
                against: against.clone(),
                hearing_at: c.answer_by,
                answer_by: Some(c.answer_by),
                about: truthy_s(d, "about"),
                amount: d.get("amount").and_then(lenient::whole),
                structure: truthy_s(d, "structure"),
                seeks: truthy_s(d, "seeks"),
            };
            steps.push(because(
                format!("An application ({words}) by {applicant} against {against}: telling {against}, who has until {} to answer.", day(c.answer_by, cx)),
                vec![say(
                    ComplaintNotice::KIND,
                    &text,
                    Say {
                        to: Some(vec![applicant.to_string(), against.clone()]),
                        visible: Some(Visible::Only(vec![applicant.to_string(), against.clone(), me.clone()])),
                        basis: Some(a.id.to_string()),
                        data: Some(paper_data(&ComplaintNotice(notice))),
                        ..Default::default()
                    },
                )],
            ));
        }

        // ---- deciding: those whose time to answer has run, oldest first, as far as the day's hours go ----
        // (An application its maker has withdrawn is no longer a case: nothing is decided on it.)
        let gone: Vec<String> = self.cases.keys().filter(|id| book.withdrawn(id)).cloned().collect();
        for id in gone {
            self.cases.remove(&id);
            self.count("withdrawn");
        }
        // (How many it gets through is the hours of whoever decides, not a number: the ones behind wait.)
        let mut room = can_decide.unwrap_or(i64::MAX);
        let mut ripe: Vec<Case> = self.cases.values().filter(|x| t >= x.answer_by).cloned().collect();
        ripe.sort_by(|a, b| a.answer_by.cmp(&b.answer_by).then_with(|| filed_before(&a.id, &b.id)));
        for c in ripe {
            if room <= 0 {
                break;
            }
            room -= 1;
            let can = c.hears.can.clone().unwrap_or_else(|| vec!["order".into()]);
            let binding = can.iter().any(|x| x == "order");
            let due = t + self.within_days * DAY;
            let r = response_to(book, ComplaintResponse::KIND, &c.id, &c.against);
            let x = r.map_or(&oikos_core::frozen::NULL, |r| data(r));
            let claimed = c.data.get("amount").and_then(lenient::whole).unwrap_or(0);
            let verb = if binding { "is to" } else { "should" };
            // An application that says nothing of what it is about is turned away with leave to apply again with its
            // particulars, as a member would (docs/behaviour/justice.md, "Particulars"). Before any draw.
            if !has_particulars(&c.data) {
                let text = format!("the application states no particulars (what it is about, the sum, the dates); dismissed. {} may apply again with them.", c.applicant);
                self.decide(&mut steps, &c, "dismissed", &text, Extra { no_particulars: true, ..Default::default() }, "The application says nothing of what it is about: dismissed, with leave to apply again with its particulars.".into(), binding, t);
                continue;
            }
            if can.iter().any(|x| x == "mediate") && !binding {
                // Bringing the two together: nothing comes of it unless the other side will.
                if x.flag("agrees") {
                    let text = format!("{} and {} met with us and came to an understanding.", c.applicant, c.against);
                    self.decide(&mut steps, &c, "settled", &text, Extra::default(), format!("{} agreed to meet {}: they came to an understanding.", c.against, c.applicant), false, t);
                } else {
                    let said = if r.is_some() { "would not meet" } else { "did not answer" };
                    self.decide(&mut steps, &c, "dismissed", &format!("{} {said}; we can do no more.", c.against), Extra::default(), format!("{} {said}: mediation cannot be made to happen.", c.against), false, t);
                }
                continue;
            }
            // On the record: what the other side's own books say, where it answered and they can say.
            let (finding, amount, why): (&str, i64, String);
            if r.is_some() && x.get("owed").is_some() {
                let a = x.i("owed").unwrap_or(0).max(0);
                finding = if a > 0 { "pay" } else { "dismissed" };
                amount = a;
                why = format!("{} answers that its records show {} owed", c.against, usd(a, cx));
            } else if r.is_some() && x.get("wrong").is_some() {
                let wrong = x.flag("wrong");
                finding = if wrong {
                    if claimed > 0 {
                        "pay"
                    } else {
                        "set_aside"
                    }
                } else {
                    "dismissed"
                };
                amount = if wrong { claimed } else { 0 };
                why = format!("{} answers that the paper was {}", c.against, if wrong { "wrong" } else { "right" });
            } else if r.is_some() && x.get("done").is_some() {
                let done = x.flag("done");
                finding = if done { "dismissed" } else { "do" };
                amount = 0;
                why = format!("{} answers that it is {}", c.against, if done { "done" } else { "not done" });
            } else {
                // No answer, or one that cannot say: in default the applicant's account stands; word against word, the
                // venue's own rate. (An applicant who can show a paper for it has made it out; one with only their word
                // is believed as often as this venue's own figures say.)
                let shown = c.data.get("evidence").is_some() || c.data.get("request").is_some();
                let upheld = r.is_none() || shown || {
                    let case = self.nth.key(&c.id, &[Some(c.applicant.as_str()), Some(c.against.as_str()), Some(c.matter.as_str())]);
                    oikos_rules::slip::slip(cx, "publish/venue_decision", &case, &Default::default())
                };
                finding = if !upheld {
                    "dismissed"
                } else if claimed > 0 {
                    "pay"
                } else if c.hears.undoes && c.data.s("about").is_some_and(|a| !a.is_empty()) {
                    "set_aside"
                } else {
                    "do"
                };
                amount = if upheld { claimed } else { 0 };
                why = if r.is_some() {
                    format!(
                        "{} cannot say from its records; {}",
                        c.against,
                        if shown {
                            "the applicant has shown a paper for it"
                        } else if upheld {
                            "on what both say, the applicant's account is made out"
                        } else {
                            "the applicant has nothing to show for it, and it is not made out"
                        }
                    )
                } else {
                    format!("{} did not answer: the applicant's account stands", c.against)
                };
            }
            match finding {
                "pay" => {
                    let text = format!("{} {verb} pay {} {} by {}.", c.against, c.applicant, usd(amount, cx), day(due, cx));
                    let w = format!("{why}: {} payment of {}.", if binding { "ordering" } else { "recommending" }, usd(amount, cx));
                    self.decide(&mut steps, &c, "pay", &text, Extra { amount: Some(amount), to: truthy_s(&c.data, "account"), due: Some(due), ..Default::default() }, w, binding, t);
                }
                "do" => {
                    let text = format!("{} {verb} put it right by {}.", c.against, day(due, cx));
                    let w = format!("{why}: {} that it be put right.", if binding { "ordering" } else { "recommending" });
                    self.decide(&mut steps, &c, "do", &text, Extra { due: Some(due), ..Default::default() }, w, binding, t);
                }
                "set_aside" => {
                    let text = format!("the paper {} {}.", c.data.s("about").unwrap_or(""), if binding { "is set aside" } else { "should be withdrawn" });
                    self.decide(&mut steps, &c, "set_aside", &text, Extra::default(), format!("{why}: the paper {}.", if binding { "is set aside" } else { "should be withdrawn" }), binding, t);
                }
                _ => self.decide(&mut steps, &c, "dismissed", "not made out; dismissed.", Extra::default(), format!("{why}: dismissed."), binding, t),
            }
        }
        steps
    }
}

// ======================================================================================== the group's post

/// The founder's want, carried here as what the organisation is for; and whom it is against, where anyone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Want {
    pub about: String,
    pub whom: Option<String>,
    pub since: f64,
    pub weight: f64,
}

impl Default for Want {
    fn default() -> Self {
        Want { about: String::new(), whom: None, since: 0.0, weight: 0.0 }
    }
}

/// The composer's closed choice among what was open.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Choice {
    pub dues: Option<i64>,
    pub every_days: Option<i64>,
    pub starts_in_days: Option<i64>,
    pub lasts_minutes: Option<i64>,
}

/// The composed piece, where the founder was given one (the name is the organisation's already).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Composed {
    pub purpose: String,
    pub asks: String,
    pub gathers: String,
    pub choice: Choice,
    pub model: String,
}

/// The group's parameters (the manifest's, with TS's defaults).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Params {
    pub founder: String,
    /// `gathering`, `fund`, `cause` or `business` (kept as the world wrote it: only `fund` and `cause` differ).
    pub shape: String,
    pub idea: String,
    pub name: String,
    pub purpose: String,
    pub want: Want,
    /// Where it can gather: the founder's home, and how many it holds besides those who live there.
    pub place: String,
    pub place_room: i64,
    /// The cell the home stands on (empty: not known): only the translator's request named it (`on=`); with no
    /// translator route it is carried and not read.
    pub place_on: String,
    pub bank: String,
    pub founded_at: i64,
    pub composed: Option<Composed>,
    pub dues: Vec<i64>,
    pub every_days: Vec<i64>,
    pub starts_in_days: Vec<i64>,
    pub lasts_minutes: Vec<i64>,
    pub at_seconds: i64,
    pub lapse_days: i64,
    pub min_members: i64,
    pub hall: Option<Hall>,
    pub fund: super::founding::FundParams,
    pub cause: super::founding::CauseParams,
    pub member_notice_days: i64,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            founder: String::new(),
            shape: "gathering".into(),
            idea: String::new(),
            name: String::new(),
            purpose: String::new(),
            want: Want::default(),
            place: String::new(),
            place_room: 4,
            place_on: String::new(),
            bank: String::new(),
            founded_at: 0,
            composed: None,
            dues: vec![0],
            every_days: vec![14],
            starts_in_days: vec![7],
            lasts_minutes: vec![90],
            at_seconds: 19 * 3600,
            lapse_days: 120,
            min_members: 2,
            hall: None,
            fund: Default::default(),
            cause: Default::default(),
            member_notice_days: 7,
        }
    }
}

/// `params(defaults, ctx.params)`: the world's parameters over the defaults (every key replaced whole, as TS's spread
/// did; a `null` leaves the default). Errors if a given parameter is of the wrong kind.
pub fn params(given: &Value) -> Result<Params, String> {
    let mut all = match serde_json::to_value(Params::default()).map_err(|e| e.to_string())? {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    if let Some(g) = given.as_object() {
        for (k, v) in g {
            if !v.is_null() {
                all.insert(k.clone(), v.clone());
            }
        }
    }
    serde_json::from_value(Value::Object(all)).map_err(|e| format!("group.founded's parameters: {e}"))
}

/// Something that happened to the group, kept for its record (`RecordChange.because`, `memory.recent`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Happened {
    t: i64,
    what: String,
    about: Option<String>,
    size: i64,
}

impl Happened {
    fn json(&self) -> Value {
        let mut m = Map::new();
        m.insert("t".into(), json!(self.t));
        m.insert("what".into(), json!(self.what));
        if let Some(a) = &self.about {
            m.insert("about".into(), json!(a));
        }
        m.insert("size".into(), json!(self.size));
        Value::Object(m)
    }
}

struct Member {
    who: String,
    agreement: String,
    at: i64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Way {
    Choice,
    Code,
}

impl Way {
    fn name(self) -> &'static str {
        match self {
            Way::Choice => "choice",
            Way::Code => "code",
        }
    }
}

/// The group's memory: its parameters, its book of what it has seen, and where things stand.
#[derive(Serialize, Deserialize)]
pub struct Group {
    p: Params,
    me: String,
    book: Book,
    hearings: Hearings,
    hears: Vec<Hears>,
    /// Which way each part arrived: `translator`, `choice` or `code`.
    arrived: BTreeMap<String, String>,
    /// Parts sent through the translator (`words` questions), with the time each was asked (1, or 2: asked again).
    #[serde(default)]
    asked: BTreeMap<String, u8>,
    /// The host's answers, by part, until the plan takes them up.
    #[serde(default)]
    answers: BTreeMap<String, Value>,
    /// Parts whose accepted draft's acts could not be begun: they arrive the other way.
    #[serde(default)]
    redo: BTreeSet<String>,
    account_asked: bool,
    place: String,
    lapsed: bool,
    few_since: Option<i64>,
    hall_asked: bool,
    handled: BTreeSet<String>,
    drew: BTreeMap<String, i64>,
    counts: BTreeMap<String, i64>,
    since: Vec<Happened>,
    recent: Vec<Happened>,
    /// The record as last written (`Null`: none yet).
    written: Value,
    /// The hours its members have given and not yet used, as hours x `MONTH` (exact: see the file's doc).
    hours_bank: i64,
    hours_at: i64,
    /// The balance of its account as this wake saw it (less draws it has paid in this wake).
    balance: Option<i64>,
    /// The run's end and the clock's grain (the world's, for when it next wakes).
    run_end: i64,
    tick: i64,
}

pub struct Founded;

impl Kind for Founded {
    fn name(&self) -> &'static str {
        "group.founded"
    }
    fn version(&self) -> &'static str {
        "0.2.1"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/founding.md"
    }
    fn manifest(&self) -> Value {
        let p = |schema: Value, default: Value| json!({ "schema": schema, "default": default, "source": "placeholder" });
        let pu = |schema: Value, unit: &str, default: Value| json!({ "schema": schema, "unit": unit, "default": default, "source": "placeholder" });
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "at_seconds": pu(json!({ "type": "integer" }), "seconds", json!(68_400)),
                "bank": p(json!({ "type": "string" }), json!("")),
                "cause": p(json!({ "type": "object" }), json!({ "case_hours": 6, "hours_per_member_month": 2, "answer_days": 14 })),
                "composed": p(json!({}), Value::Null),
                "dues": p(json!({ "type": "array" }), json!([0])),
                "every_days": pu(json!({ "type": "array" }), "days", json!([14])),
                "founded_at": p(json!({ "type": "integer" }), json!(0)),
                "founder": p(json!({ "type": "string" }), json!("")),
                "fund": p(json!({ "type": "object" }), json!({ "qualify_days": 60, "draw_months": 6, "every_days": 180 })),
                "hall": p(json!({}), Value::Null),
                "idea": p(json!({ "type": "string" }), json!("")),
                "lapse_days": pu(json!({ "type": "integer" }), "days", json!(120)),
                "lasts_minutes": p(json!({ "type": "array" }), json!([90])),
                "member_notice_days": pu(json!({ "type": "integer" }), "days", json!(7)),
                "min_members": p(json!({ "type": "integer" }), json!(2)),
                "name": p(json!({ "type": "string" }), json!("")),
                "place": p(json!({ "type": "string" }), json!("")),
                "place_on": p(json!({ "type": "string" }), json!("")),
                "place_room": p(json!({ "type": "integer" }), json!(4)),
                "purpose": p(json!({ "type": "string" }), json!("")),
                "shape": p(json!({ "type": "string" }), json!("gathering")),
                "starts_in_days": pu(json!({ "type": "array" }), "days", json!([7])),
                "want": p(json!({ "type": "object" }), json!({ "about": "", "since": 0, "weight": 0 })),
            },
            "perceives": [], "state": "none",
        })
    }
    fn cadence(&self, ctx: &Ctx) -> i64 {
        if ctx.params.get("shape").and_then(|x| x.as_str()) == Some("cause") {
            DAY
        } else {
            7 * DAY
        }
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        0
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::new(Group::new(ctx)?)))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Group>::restore(saved)?))
    }
}

/// Fixed list of what the group says it takes up, for a body of grievances (`hears`).
fn hears_of(p: &Params) -> Vec<Hears> {
    if p.shape == "cause" && !p.want.about.is_empty() {
        vec![Hears { about: p.want.about.clone(), can: Some(vec!["recommend".into(), "represent".into()]), ..Default::default() }]
    } else {
        vec![]
    }
}

impl Group {
    /// A group made for this context (its parameters and the entity it acts for).
    pub fn new(ctx: &Ctx) -> Result<Group, String> {
        let p = params(&Value::Object(ctx.params.to_map()))?;
        let me = ctx.entity.clone();
        let hears = hears_of(&p);
        let hearings = Hearings::new(&me, hears.clone(), p.cause.answer_days, 28);
        Ok(Group {
            place: p.place.clone(),
            hours_at: p.founded_at,
            p,
            me,
            book: Book::new(),
            hearings,
            hears,
            arrived: BTreeMap::new(),
            asked: BTreeMap::new(),
            answers: BTreeMap::new(),
            redo: BTreeSet::new(),
            account_asked: false,
            lapsed: false,
            few_since: None,
            hall_asked: false,
            handled: BTreeSet::new(),
            drew: BTreeMap::new(),
            counts: BTreeMap::new(),
            since: vec![],
            recent: vec![],
            written: Value::Null,
            hours_bank: 0,
            balance: None,
            run_end: ctx.world.run_end,
            tick: ctx.world.tick,
        })
    }

    // ---- what the founder or the composer chose, among what was open ----
    fn pick(given: Option<i64>, open: &[i64]) -> i64 {
        match given {
            Some(g) if open.contains(&g) => g,
            _ => open.first().copied().unwrap_or(0),
        }
    }
    fn choice(&self) -> Option<&Choice> {
        self.p.composed.as_ref().map(|c| &c.choice)
    }
    /// Dues a month, cents.
    fn dues(&self) -> i64 {
        Self::pick(self.choice().and_then(|c| c.dues), &self.p.dues)
    }
    fn every(&self) -> i64 {
        Self::pick(self.choice().and_then(|c| c.every_days), &self.p.every_days) * DAY
    }
    fn lasts(&self) -> i64 {
        Self::pick(self.choice().and_then(|c| c.lasts_minutes), &self.p.lasts_minutes) * 60
    }
    fn first_at(&self) -> i64 {
        (self.p.founded_at.div_euclid(DAY) + Self::pick(self.choice().and_then(|c| c.starts_in_days), &self.p.starts_in_days)) * DAY + self.p.at_seconds
    }
    fn chose(&self, given: Option<i64>, open: &[i64]) -> Way {
        if self.p.composed.is_some() && given.is_some_and(|g| open.contains(&g)) {
            Way::Choice
        } else {
            Way::Code
        }
    }
    /// What a fund pays a member who is short, cents.
    fn draws(&self) -> i64 {
        if self.p.shape == "fund" {
            self.dues() * self.p.fund.draw_months
        } else {
            0
        }
    }
    fn notice_secs(&self) -> i64 {
        self.p.member_notice_days * DAY
    }

    // ---- what the book shows ----
    fn mine(&self, kind: &str) -> Option<Arc<Record>> {
        self.book.open(kind).find(|r| r.speaks_for.as_deref() == Some(self.me.as_str())).cloned()
    }
    fn practice(&self) -> Option<Arc<Record>> {
        self.book.practices().find(|r| r.speaks_for.as_deref().unwrap_or(r.author.as_str()) == self.me).cloned()
    }
    fn members(&self) -> Vec<Member> {
        self.book
            .of_type("agreement")
            .filter_map(|r| match &r.body {
                RecordBody::Agreement { terms }
                    if terms.template.as_deref() == Some("membership") && terms.parties.first() == Some(&self.me) && self.book.in_force(&r.id) =>
                {
                    Some(Member { who: terms.parties.get(1).cloned().unwrap_or_default(), agreement: r.id.to_string(), at: r.at })
                }
                _ => None,
            })
            .collect()
    }

    fn count(&mut self, what: &str, n: i64) {
        *self.counts.entry(what.to_string()).or_insert(0) += n;
    }
    fn happened(&mut self, t: i64, what: &str, about: Option<&str>, size: i64) {
        let h = Happened { t, what: what.to_string(), about: about.filter(|a| !a.is_empty()).map(String::from), size: size.clamp(0, 10_000) };
        self.since.push(h);
        if self.since.len() > 16 {
            self.since.remove(0);
        }
    }
    fn remember(&mut self, t: i64, what: &str, about: Option<&str>, size: i64) {
        let h = Happened { t, what: what.to_string(), about: about.filter(|a| !a.is_empty()).map(String::from), size: size.clamp(0, 10_000) };
        self.recent.push(h);
        if self.recent.len() > 8 {
            self.recent.remove(0);
        }
        self.happened(t, what, about, size);
    }

    // ---- the words ----
    fn say_purpose(&self) -> Step<()> {
        let words = self.p.purpose.as_str();
        because(
            "Saying what we are for, in plain words.",
            vec![say(
                "purpose",
                words,
                Say {
                    visible: Some(Visible::Public),
                    data: Some(paper_data(&Purpose { idea: Some(self.p.idea.clone()), written_by: Some("code".into()), for_: Some(self.p.founder.clone()) })),
                    extra: vec![("assertion", json!({ "that": slice16(words, 1_000) }))],
                    ..Default::default()
                },
            )],
        )
    }
    /// A part of the piece sent through the translator (founded.ts `through`): asked once; while its answer is out,
    /// nothing; then the accepted draft, or, if it does not come back as what it may be, `otherwise` (arrived `fallback`).
    #[allow(clippy::too_many_arguments)]
    fn through(&mut self, cx: &mut Cx, part: &str, text: String, accept: impl FnOnce(&[Block]) -> Result<Vec<Value>, String>, otherwise: Step<()>, fallback: &str) -> Option<Step<()>> {
        let about = format!("{}|{part}", self.p.idea);
        if self.redo.remove(part) {
            self.arrived.insert(part.into(), fallback.into());
            return Some(otherwise);
        }
        let Some(&attempt) = self.asked.get(part) else {
            self.asked.insert(part.into(), 1);
            cx.ask(words_question(&about, part, &self.p.idea, &text, 1));
            return None;
        };
        let answer = self.answers.remove(part)?;
        match words_came(&about, part, &self.p.idea, &answer, accept) {
            Came::Accepted(d) => {
                self.arrived.insert(part.into(), "translator".into());
                Some(Step::drafted(d))
            }
            Came::Again(w) if attempt < 2 => {
                cx.worded(w);
                self.asked.insert(part.into(), 2);
                cx.ask(words_question(&about, part, &self.p.idea, &text, 2));
                None
            }
            Came::Again(mut w) | Came::NotDone(mut w) => {
                w.again = false;
                cx.worded(w);
                self.arrived.insert(part.into(), fallback.into());
                Some(otherwise)
            }
        }
    }
    fn gather_text(&self) -> String {
        format!(
            "{} gathers at {} every {} days at {}:00, for {} minutes. All welcome.",
            self.p.name,
            self.place,
            self.every() / DAY,
            self.p.at_seconds.div_euclid(3600),
            self.lasts() / 60
        )
    }
    fn say_gathering(&self, way: Way, at: &str, first: i64) -> Step<()> {
        let words = match (&self.p.composed, way) {
            (Some(c), Way::Choice) => c.gathers.clone(),
            _ => self.gather_text(),
        };
        because(
            format!("Putting up our gathering ({}).", if way == Way::Choice { "as chosen" } else { "as is usual" }),
            vec![say(
                "notice",
                &words,
                Say {
                    visible: Some(Visible::Public),
                    data: Some(paper_data(&Notice { idea: Some(self.p.idea.clone()), words: Some(way.name().into()) })),
                    extra: vec![("practice", json!({ "at": at, "every": self.every(), "first": first, "lasts": self.lasts(), "roles": [{ "role": "member", "open": true }] }))],
                    ..Default::default()
                },
            )],
        )
    }
    /// A fund's rule, stated with its offer of membership, in words and as figures: who may draw, how much, how often,
    /// and that it pays while it has the money. It pays and refuses by this and nothing else.
    fn rule(&self) -> Option<FundRule> {
        (self.draws() > 0).then(|| FundRule { draw: self.draws(), qualify_days: self.p.fund.qualify_days, every_days: self.p.fund.every_days })
    }
    fn rule_text(&self, cx: &Cx) -> String {
        match self.rule() {
            Some(r) => format!(
                " The fund's rule: a member of {} days or more who is short may draw up to {}, once in {} days, while the fund has it.",
                r.qualify_days,
                money_words(r.draw, &cx.ctx.world),
                r.every_days
            ),
            None => String::new(),
        }
    }
    fn member_text(&self, cx: &Cx) -> String {
        let dues = self.dues();
        format!(
            "Anyone may join {}.{}{}",
            self.p.name,
            if dues > 0 { format!(" Members pay {} a month.", money_words(dues, &cx.ctx.world)) } else { " Nothing is asked but to come.".to_string() },
            self.rule_text(cx)
        )
    }
    /// (Where the founder's own words are the offer, the rule follows them, written by code: a rule is figures.)
    fn say_membership(&self, way: Way, account: Option<&str>, cx: &Cx) -> Step<()> {
        let words = match (&self.p.composed, way) {
            (Some(c), Way::Choice) => format!("{}{}", c.asks, self.rule_text(cx)),
            _ => self.member_text(cx),
        };
        let rule = self.rule();
        let data = paper_data(&Membership { idea: Some(self.p.idea.clone()), words: Some(way.name().into()), dues: Some(self.dues()), fund: rule });
        because(
            format!("Offering membership ({}).", if way == Way::Choice { "as chosen" } else { "as is usual" }),
            vec![say(
                "membership",
                &words,
                Say {
                    visible: Some(Visible::Public),
                    data: Some(data),
                    extra: vec![("offer", membership_offer(&self.me, self.dues(), account, self.notice_secs(), Some(self.draws())))],
                    ..Default::default()
                },
            )],
        )
    }
    /// An offer of the agreement that makes someone a member, on the terms we have put up (common.ts `offer`, whose
    /// `we_do` is words here).
    fn agreement_offer(&self, who: &str, owed: i64, account: Option<&str>, basis: &str, cx: &Cx) -> Call {
        let dues = match (owed > 0, account) {
            (true, Some(acc)) => Some(Arg::Call(pay(acc, owed, Pay { every: Some(MONTH), for_: Some("Dues.".into()), ..Default::default() }, cx))),
            _ => None,
        };
        let text = format!("{who} is a member of {}{}.", self.me, if owed > 0 { format!(", paying dues of {} a month", money_words(owed, &cx.ctx.world)) } else { String::new() });
        call(
            "agreement",
            vec![
                ("with", Some(arg(who))),
                ("template", Some(arg("membership"))),
                ("we_do", Some(crate::steps::text(format!("{} counts {who} among its members.", self.me)))),
                ("they_do", dues),
                ("their_notice", Some(crate::steps::secs(self.notice_secs()))),
                ("terms", Some(crate::steps::text(text))),
                ("basis", Some(arg(basis))),
            ],
        )
    }

    // ---- the work of a wake ----
    fn work(&mut self, pic: &Picture, cx: &mut Cx, acc: Option<OwnAccount>) -> Vec<Step<()>> {
        let t = pic.t;
        let me = self.me.clone();
        let mut out: Vec<Step<()>> = vec![];
        if self.lapsed {
            return out;
        }
        let dues = self.dues();
        // ---- setting up: an account, where money is to pass; what we are for; the gathering; membership; a hearing ----
        if dues > 0 && acc.is_none() {
            if !self.account_asked {
                self.account_asked = true;
                out.push(because(
                    "Dues are to be paid: opening an account at the bank.",
                    vec![call("account", vec![("holder", Some(arg(&me))), ("at", Some(arg(&self.p.bank)))])],
                ));
            }
            return out;
        }
        let quoted = |x: &str| x.split_whitespace().collect::<Vec<_>>().join(" ").replace('"', "'");
        let composed = self.p.composed.clone();
        if self.mine("purpose").is_none() {
            if let Some(c) = composed.as_ref().filter(|_| !self.arrived.contains_key("purpose") || self.redo.contains("purpose")) {
                let (idea, model, founder) = (self.p.idea.clone(), c.model.clone(), self.p.founder.clone());
                let text = format!("Put out a public statement, of kind purpose, in these words: \"{}\"", quoted(&c.purpose));
                let accept = |blocks: &[Block]| {
                    let mut r = accept_purpose(&me, blocks)?;
                    for b in &mut r {
                        b["data"] = json!({ "idea": idea, "written_by": "composer", "model": model, "for": founder });
                    }
                    Ok(r)
                };
                let otherwise = self.say_purpose();
                out.extend(self.through(cx, "purpose", text, accept, otherwise, "code"));
            } else if composed.is_none() {
                self.arrived.insert("purpose".into(), "code".into());
                out.push(self.say_purpose());
            }
            return out;
        }
        let Some(gathering) = self.practice() else {
            let way = if self.chose(self.choice().and_then(|c| c.every_days), &self.p.every_days) == Way::Choice
                || self.chose(self.choice().and_then(|c| c.lasts_minutes), &self.p.lasts_minutes) == Way::Choice
            {
                Way::Choice
            } else {
                Way::Code
            };
            if let Some(c) = composed.as_ref().filter(|_| !self.arrived.contains_key("gathers") || self.redo.contains("gathers")) {
                let on = if !self.p.place_on.is_empty() && self.place == self.p.place { format!(", on {}", self.p.place_on) } else { String::new() };
                let text = format!("Put up a public notice of our gathering, a practice held at {}{on}: \"{}\"", self.place, quoted(&c.gathers));
                let bounds = GatherBounds { at: self.place.clone(), every_days: self.p.every_days.clone(), lasts_minutes: self.p.lasts_minutes.clone(), first: (t, t + 30 * DAY), at_seconds: self.p.at_seconds };
                let otherwise = self.say_gathering(way, &self.place.clone(), self.first_at());
                out.extend(self.through(cx, "gathers", text, |b| accept_gathering(&me, &bounds, b), otherwise, way.name()));
            } else if composed.is_none() {
                self.arrived.insert("gathers".into(), way.name().into());
                out.push(self.say_gathering(way, &self.place.clone(), self.first_at()));
            }
            return out;
        };
        if self.mine("membership").is_none() {
            let way = self.chose(self.choice().and_then(|c| c.dues), &self.p.dues);
            let account = acc.as_ref().map(|a| a.account.clone());
            if let Some(c) = composed.as_ref().filter(|_| !self.arrived.contains_key("asks") || self.redo.contains("asks")) {
                let into = match (&account, dues > 0) {
                    (Some(a), true) => format!(" Dues are paid monthly into {a}."),
                    _ => String::new(),
                };
                let text = format!("Offer membership publicly, for anyone to join: \"{}\"{into}", quoted(&c.asks));
                let bounds = MembershipBounds { account: account.clone(), dues: self.p.dues.clone(), notice: self.notice_secs() };
                let otherwise = self.say_membership(way, account.as_deref(), cx);
                out.extend(self.through(cx, "asks", text, |b| accept_membership(&me, &bounds, b), otherwise, way.name()));
            } else if composed.is_none() {
                self.arrived.insert("asks".into(), way.name().into());
                out.push(self.say_membership(way, account.as_deref(), cx));
            }
            return out;
        }
        if !self.hears.is_empty() && !self.book.hearings().any(|r| r.speaks_for.as_deref() == Some(me.as_str())) {
            let abouts: Vec<String> = self.hears.iter().map(|h| h.about.replace('_', " ")).collect();
            let text = format!(
                "{} takes up for its members: {}{}. Members apply in writing; there is no fee.",
                self.p.name,
                abouts.join(", "),
                self.p.want.whom.as_deref().filter(|w| !w.is_empty()).map_or(String::new(), |w| format!(", with {w}"))
            );
            let mut d = paper_data(&Hearing { hears: self.hears.iter().map(|h| h.about.clone()).collect(), fee: None });
            if let Some(m) = d.as_object_mut() {
                m.insert("idea".into(), json!(self.p.idea));
            }
            out.push(because(
                "Saying what we take up for our members.",
                vec![say("hearing", &text, Say { visible: Some(Visible::Public), data: Some(d), extra: vec![("offer", hearing_offer(&me, &self.hears, Some(&me)))], ..Default::default() })],
            ));
        }

        // ---- members: whoever applies is offered membership on the terms we have put up ----
        let standing = self.mine("membership");
        let owed = standing
            .as_ref()
            .and_then(|s| {
                part(s, Piece::Offer)
                    .pointer("/terms/commitments")
                    .and_then(|x| x.as_array())
                    .and_then(|cs| {
                        cs.iter().find(|x| x.get("who").and_then(|x| x.as_str()) == Some("taker") && x.pointer("/does/outcome/money").is_some_and(|m| !m.is_null()))
                    })
                    .and_then(|x| x.pointer("/does/outcome/money/amount").and_then(lenient::whole))
            })
            .unwrap_or(0);
        let now = self.members();
        let in_force: BTreeSet<&str> = now.iter().map(|m| m.who.as_str()).collect();
        let applications: Vec<Arc<Record>> = self.book.open("membership_application").cloned().collect();
        let mut offers: Vec<Step<()>> = vec![];
        let mut applied = 0;
        for a in &applications {
            if self.handled.contains(a.id.as_str()) || !addressed_to(a).iter().any(|x| x == &me) {
                continue;
            }
            self.handled.insert(a.id.to_string());
            let who = a.speaks_for.unwrap_or_default();
            if in_force.contains(who.as_str()) {
                continue;
            }
            applied += 1;
            let why = format!("{who} asks to join: offering membership{}.", if owed > 0 { format!(", {} a month in dues", money_words(owed, &cx.ctx.world)) } else { String::new() });
            offers.push(because(why, vec![self.agreement_offer(&who, owed, acc.as_ref().map(|a| a.account.as_str()), &a.id, cx)]));
        }
        out.extend(offers);
        if applied > 0 {
            self.count("applications", applied);
        }
        let joined: Vec<(String, String)> = now.iter().filter(|m| !self.handled.contains(&format!("in:{}", m.agreement))).map(|m| (m.agreement.clone(), m.who.clone())).collect();
        for (agreement, who) in joined {
            self.handled.insert(format!("in:{agreement}"));
            self.remember(t, "member_joined", Some(&who), 1_000);
            self.count("joined", 1);
        }

        // ---- a fund: a member who is short asks, and is paid by the rule we stated, while the money lasts ----
        let draws = self.draws();
        if let (true, Some(acc)) = (draws > 0, acc.as_ref()) {
            let claims: Vec<Arc<Record>> = self.book.open("fund_claim").cloned().collect();
            for r in claims {
                if self.handled.contains(r.id.as_str()) || !addressed_to(&r).iter().any(|x| x == &me) {
                    continue;
                }
                self.handled.insert(r.id.to_string());
                let who = r.speaks_for.unwrap_or_default();
                let m = now.iter().find(|x| x.who == who);
                let d = data(&r);
                let want = draws.min(d.i("amount").unwrap_or(draws));
                let balance = self.balance.unwrap_or(acc.balance);
                let given = d.s("account").filter(|a| !a.is_empty());
                let f = &self.p.fund;
                let why = if m.is_none() {
                    "not a member"
                } else if t - m.map_or(0, |m| m.at) < f.qualify_days * DAY {
                    "not yet a member long enough"
                } else if self.drew.get(who.as_str()).is_some_and(|last| t - last < f.every_days * DAY) {
                    "drew not long ago"
                } else if balance < want {
                    "the fund has not got it"
                } else if given.is_none() {
                    "no account given"
                } else {
                    ""
                };
                self.count(if why.is_empty() { "draws_paid" } else { "draws_refused" }, 1);
                if why.is_empty() {
                    self.drew.insert(who.to_string(), t);
                    self.remember(t, "fund_drawn", Some(&who), want);
                    self.balance = Some(balance - want);
                }
                let decision = FundDecision { granted: why.is_empty(), why: (!why.is_empty()).then(|| why.to_string()), amount: why.is_empty().then_some(want) };
                let reason = if why.is_empty() {
                    format!("{who} is short and asks to draw on the fund: paying {}.", money_words(want, &cx.ctx.world))
                } else {
                    format!("{who} asks to draw on the fund: {why}.")
                };
                let words = if why.is_empty() { format!("A draw of {} from the fund, paid.", money_words(want, &cx.ctx.world)) } else { format!("We cannot pay a draw now: {why}.{}", self.rule_text(cx)) };
                let mut calls = vec![say(
                    "fund_decision",
                    &words,
                    Say { to: Some(vec![who.to_string()]), visible: Some(Visible::Only(vec![me.clone(), who.to_string()])), basis: Some(r.id.to_string()), data: Some(paper_data(&decision)), ..Default::default() },
                )];
                if why.is_empty() {
                    let to = given.unwrap_or_default();
                    calls.push(pay(to, want, Pay { from: Some(acc.account.clone()), for_: Some("A draw on the fund.".into()), ..Default::default() }, cx));
                }
                out.push(because(reason, calls));
            }
        }
        // (A member writes a `FundClaim`; one missing its amount or account is read leniently above, and refused for the
        // account it lacks, as TS did, so the data is read as fields rather than as the strict type.)

        // ---- grievances taken up, as far as our members' hours go ----
        if !self.hears.is_empty() {
            let c = &self.p.cause;
            let month = MONTH;
            self.hours_bank = (self.hours_bank + (now.len() as i64 + 1) * c.hours_per_member_month * (t - self.hours_at)).min(c.case_hours * 4 * month);
            self.hours_at = t;
            let others = |h: &Hearings| h.counts.iter().filter(|(k, _)| k.as_str() != "applications").map(|(_, n)| *n).sum::<i64>();
            let before = others(&self.hearings);
            let can = (c.case_hours > 0).then(|| self.hours_bank / (c.case_hours * month));
            out.extend(self.hearings.steps(&self.book, t, can, cx));
            let decided = others(&self.hearings) - before;
            self.hours_bank = (self.hours_bank - decided * self.p.cause.case_hours * month).max(0);
            if decided > 0 {
                self.count("cases_decided", decided);
                self.happened(t, "cases_decided", None, decided);
            }
        }

        // ---- outgrown the founder's home: the hall, when we can pay its hire, booked with whoever keeps it ----
        // (Only a group whose dues, between one gathering and the next, come to the hire: one that could pay for three
        // evenings out of what it has and nothing after would spend its members' money on a room.)
        let every = self.every();
        if let (Some(hall), Some(acc)) = (self.p.hall.clone(), acc.as_ref()) {
            let balance = self.balance.unwrap_or(acc.balance);
            if !self.hall_asked
                && self.place != hall.space
                && every > 0
                && now.len() as i64 + 1 > self.p.place_room
                && balance >= 3 * hall.hire
                && now.len() as i64 * dues * every >= hall.hire * MONTH
            {
                self.hall_asked = true;
                self.place = hall.space.clone();
                let first = part(&gathering, Piece::Practice).i("first").unwrap_or_else(|| self.first_at());
                let gap = (t + DAY - first).max(0);
                let next = first + ((gap + every - 1) / every) * every;
                self.remember(t, "moved_to_hall", Some(&hall.space), 1_000);
                let lasts = self.lasts();
                let booking = HallBooking { space: hall.space.clone(), every, first: next, lasts, hire: hall.hire, account: acc.account.clone(), members: now.len() as i64 };
                let usd = |n: i64| money_words(n, &cx.ctx.world);
                out.push(because(
                    format!("{} members are more than {} holds, and we can pay for the hall: booking it, {} a gathering.", now.len(), self.p.place, usd(hall.hire)),
                    vec![
                        say(
                            "hall_booking",
                            &format!(
                                "Booking: {} asks for the hall ({}) every {} days from {}, for {} minutes, at the hire of {} a time, paid into {}.",
                                self.p.name,
                                hall.space,
                                every / DAY,
                                when_words(next, &cx.ctx.world),
                                lasts / 60,
                                usd(hall.hire),
                                hall.account
                            ),
                            Say { to: Some(vec![hall.town.clone()]), visible: Some(Visible::Only(vec![me.clone(), hall.town.clone()])), data: Some(paper_data(&booking)), ..Default::default() },
                        ),
                        pay(&hall.account, hall.hire, Pay { from: Some(acc.account.clone()), every: Some(every), first: Some((next - t).max(0)), for_: Some("Hall hire.".into()), ..Default::default() }, cx),
                        withdraw(&gathering.id, Some("We have moved to the hall.")),
                        say(
                            "notice",
                            &format!("{} now gathers at {} every {} days at {}:00, for {} minutes. All welcome.", self.p.name, hall.space, every / DAY, self.p.at_seconds.div_euclid(3600), lasts / 60),
                            Say {
                                visible: Some(Visible::Public),
                                data: Some(paper_data(&Notice { idea: Some(self.p.idea.clone()), words: Some("code".into()) })),
                                extra: vec![("practice", json!({ "at": hall.space, "every": every, "first": next, "lasts": lasts, "roles": [{ "role": "member", "open": true }] }))],
                                ..Default::default()
                            },
                        ),
                    ],
                ));
            }
        }

        // ---- a thing nobody joins lapses ----
        if now.len() as i64 >= self.p.min_members {
            self.few_since = None;
        } else if self.few_since.is_none() {
            self.few_since = Some(t.max(self.p.founded_at));
        }
        if let Some(since) = self.few_since {
            if t - since >= self.p.lapse_days * DAY {
                self.lapsed = true;
                self.remember(t, "wound_up", None, now.len() as i64);
                let mut calls: Vec<Call> = vec![];
                for r in [self.mine("membership"), Some(gathering.clone())].into_iter().flatten().chain(self.book.hearings().filter(|r| r.speaks_for.as_deref() == Some(me.as_str())).cloned()) {
                    calls.push(withdraw(&r.id, Some("Wound up.")));
                }
                let mut who: Vec<String> = now.iter().map(|m| m.who.clone()).collect();
                who.sort();
                let data = paper_data(&WoundUp { idea: self.p.idea.clone(), members: now.len() as i64, days: (t - self.p.founded_at).div_euclid(DAY) });
                calls.push(say(
                    "wound_up",
                    &format!("{} has wound up: too few came.", self.p.name),
                    Say { to: (!who.is_empty()).then_some(who), visible: Some(Visible::Public), data: Some(data), ..Default::default() },
                ));
                out.push(because(format!("{} members after {} days: winding up.", now.len(), self.p.lapse_days), calls));
            }
        }
        out
    }

    /// The organisation's record (contracts/entity-record.schema.json, OrganisationRecord): what it is for, carried from
    /// its founder's want; the last things that happened to it; how it stands. Set when it changes.
    fn record(&mut self, cx: &mut Cx) {
        let p = &self.p;
        let mut purpose = Map::new();
        purpose.insert("idea".into(), json!(p.idea));
        purpose.insert("founder".into(), json!(p.founder));
        purpose.insert("shape".into(), json!(p.shape));
        purpose.insert("about".into(), json!(p.want.about));
        if let Some(w) = p.want.whom.as_deref().filter(|w| !w.is_empty()) {
            purpose.insert("whom".into(), json!(w));
        }
        purpose.insert("since".into(), json!(super::math::round(p.want.since)));
        let words = self.mine("purpose").map(|r| crate::common::text(&r).to_string()).unwrap_or_else(|| p.purpose.clone());
        purpose.insert("words".into(), json!(slice16(&words, 1_024)));
        purpose.insert("arrived".into(), json!(self.arrived));
        if let Some(c) = &p.composed {
            purpose.insert("model".into(), json!(c.model));
        }
        let wants = if p.want.about.is_empty() {
            json!([])
        } else {
            let mut w = Map::new();
            w.insert("about".into(), json!(p.want.about));
            if let Some(whom) = p.want.whom.as_deref().filter(|w| !w.is_empty()) {
                w.insert("whom".into(), json!(whom));
            }
            w.insert("seeks".into(), json!([]));
            w.insert("weight".into(), json!(super::math::round(p.want.weight).max(1)));
            w.insert("since".into(), json!(super::math::round(p.want.since)));
            w.insert("from".into(), json!("other"));
            w.insert("tried".into(), json!(0));
            json!([Value::Object(w)])
        };
        let mut circ = Map::new();
        for (k, n) in &self.counts {
            circ.insert(k.clone(), json!(n));
        }
        circ.insert("members".into(), json!(self.members().len()));
        circ.insert("lapsed".into(), json!(i64::from(self.lapsed)));
        circ.insert("at_hall".into(), json!(i64::from(p.hall.as_ref().is_some_and(|h| self.place == h.space))));
        if let Some(b) = self.balance {
            circ.insert("balance".into(), json!(b));
        }
        let all = json!({
            "purpose": Value::Object(purpose),
            "wants": wants,
            "memory": { "recent": self.recent.iter().map(Happened::json).collect::<Vec<_>>() },
            "circumstances": Value::Object(circ),
        });
        if all == self.written {
            return;
        }
        let before = self.written.as_object().cloned().unwrap_or_default();
        let set: Map<String, Value> = all.as_object().map(|m| m.iter().filter(|(k, v)| before.get(*k) != Some(*v)).map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
        self.written = all;
        let why: Vec<Value> = self.since.drain(..).map(|h| h.json()).collect();
        let mut change = Map::new();
        change.insert("set".into(), Value::Object(set));
        if !why.is_empty() {
            change.insert("because".into(), Value::Array(why));
        }
        cx.set_record(Value::Object(change));
    }

    /// Setting up goes a part at a time: awake again within the day until it is done.
    fn setting_up(&self) -> bool {
        !self.lapsed && (self.mine("purpose").is_none() || self.mine("membership").is_none() || self.practice().is_none())
    }
}

impl Plan for Group {
    type Then = ();

    fn absorb(&mut self, pic: &Picture, cx: &mut Cx) {
        self.book.absorb(pic);
        // The host's answers to our words: a draft (or why none), or that the acts of one we accepted were not begun.
        for a in std::mem::take(&mut cx.answers) {
            let Some(part) = a.about.strip_prefix(&format!("{}|", self.p.idea)).map(String::from) else { continue };
            if a.kind != "words" {
                continue;
            }
            if a.body.get("done").and_then(|x| x.as_bool()) == Some(false) {
                self.redo.insert(part);
            } else if self.asked.contains_key(&part) {
                self.answers.insert(part, a.body);
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let acc = own_banked(pic, &self.me);
        self.balance = acc.as_ref().map(|a| a.balance);
        let out = self.work(pic, cx, acc);
        self.record(cx);
        out
    }

    fn until(&self, pic: &Picture) -> Option<i64> {
        if self.lapsed {
            Some(self.run_end)
        } else if self.setting_up() && pic.t - self.p.founded_at < 3 * DAY {
            Some(pic.t + self.tick.max(3600))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Action, Draws, WorldInfo};
    use oikos_sight::calls::Program;
    use oikos_sight::View;

    const ME: &str = "ent.9";
    const AS: &str = "ent.9-convenor-system";

    fn arg_json(a: &Arg) -> Value {
        match a {
            Arg::Id(s) | Arg::Text(s) | Arg::Var(s) => json!(s),
            Arg::Json(j) => j.clone(),
            Arg::Call(c) => call_json(c),
        }
    }
    fn call_json(c: &Call) -> Value {
        let mut m = Map::new();
        m.insert("fn".into(), json!(c.fn_));
        for (k, v) in &c.args {
            m.insert(k.clone(), arg_json(v));
        }
        Value::Object(m)
    }

    /// A group stepped by hand: what it is shown, what it does.
    struct Rig {
        ctx: Ctx,
        actor: Box<dyn Actor>,
        view: View,
        draws: Draws,
        made: usize,
        /// The record it has set, the changes merged (each change sets only the sections that differ).
        record: Option<Value>,
        /// The questions it has put (to the host), and the answers it is given at its next wake.
        asked: Vec<crate::Question>,
        answers: Vec<crate::Answer>,
        /// What it made of drafts of its words (the engine's to note).
        worded: Vec<crate::Worded>,
    }

    fn rig(params: Value) -> Rig {
        let world = WorldInfo {
            tick: 3600,
            run_end: 400 * DAY,
            currency: Some(oikos_sight::calls::Currency { code: "XTS".into(), minor_units: 2, ..Default::default() }),
            ..Default::default()
        };
        let ctx = Ctx {
            participant: AS.into(),
            performer: Default::default(),
            entity: ME.into(),
            position: Some("convenor".into()),
            params: params.as_object().unwrap().clone().into(),
            world: Arc::new(world),
        };
        let actor = Founded.create(&ctx).unwrap();
        Rig { ctx, actor, view: View::default(), draws: Draws::new(AS, "convenor"), made: 0, record: None, asked: vec![], answers: vec![], worded: vec![] }
    }

    fn account(balance: i64) -> Value {
        json!({ "kind": "accounts", "accounts": [{ "account": "acc.9", "holder": ME, "custodian": "bank", "currency": "XTS", "balance": balance.to_string() }], "transactions": [] })
    }

    impl Rig {
        /// A wake at `t`, shown these new records and this account; every step it takes at that moment, as calls.
        fn wake(&mut self, t: i64, records: Vec<Value>, balance: Option<i64>) -> Vec<Value> {
            let mut out = vec![];
            let mut woke = "cadence";
            loop {
                let mut channels = json!({ "convenor/mine": { "kind": "records", "records": records.clone() } });
                if woke == "done" {
                    channels = json!({});
                } else if let Some(b) = balance {
                    channels["convenor/books"] = account(b);
                }
                let obs = serde_json::from_value(json!({ "participant": AS, "t": t, "status": "active", "outcomes": [], "inbox": [], "drafts": [], "channels": channels })).unwrap();
                let pic = self.view.apply(obs, Some("convenor"), ME, woke, DAY);
                let mut cx = Cx::new(t, &self.ctx, &mut self.draws, 1, std::mem::take(&mut self.answers));
                let action = self.actor.step(&pic, &mut cx);
                let kept = cx.into_kept();
                self.asked.extend(kept.questions);
                self.worded.extend(kept.worded);
                if let Some(r) = kept.record {
                    let mut all = self.record.take().unwrap_or_else(|| json!({ "set": {} }));
                    for (k, v) in r["set"].as_object().unwrap() {
                        all["set"][k] = v.clone();
                    }
                    self.record = Some(all);
                }
                match action {
                    Action::Call { program: Program::Lines(lines), reasoning } => {
                        self.made += 1;
                        self.actor.sent(&format!("act.{}", self.made));
                        for l in lines {
                            let mut c = call_json(&l.call);
                            c["reasoning"] = json!(reasoning);
                            out.push(c);
                        }
                        woke = "done";
                    }
                    // (A translator's draft, accepted: its blocks, written as the call that would say them, with how it came.)
                    Action::Act { blocks, provenance, .. } => {
                        self.made += 1;
                        self.actor.sent(&format!("act.{}", self.made));
                        for b in blocks {
                            let mut c = serde_json::to_value(&b).unwrap();
                            c["fn"] = json!(if c["block"] == "publish" { "statement" } else { "act" });
                            c["provenance"] = match &provenance {
                                oikos_sight::Provenance::Given(v) => v.clone(),
                                oikos_sight::Provenance::Direct => json!("direct"),
                            };
                            out.push(c);
                        }
                        woke = "done";
                    }
                    Action::Wait { .. } => return out,
                    other => panic!("unexpected {other:?}"),
                }
            }
        }
        /// When it next sleeps until, from a wake at `t` that left it with nothing to do.
        fn sleeps_until(&mut self, t: i64) -> Option<i64> {
            let obs = serde_json::from_value(json!({ "participant": AS, "t": t, "status": "active", "outcomes": [], "inbox": [], "drafts": [], "channels": {} })).unwrap();
            let pic = self.view.apply(obs, Some("convenor"), ME, "cadence", DAY);
            let mut cx = Cx::new(t, &self.ctx, &mut self.draws, 1, vec![]);
            match self.actor.step(&pic, &mut cx) {
                Action::Wait { until } => until,
                other => panic!("expected to wait: {other:?}"),
            }
        }
    }

    fn of<'a>(calls: &'a [Value], f: &str, kind: Option<&str>) -> Vec<&'a Value> {
        calls.iter().filter(|c| c["fn"] == f && kind.is_none_or(|k| c["kind"] == k)).collect()
    }

    /// What the world would have recorded of a statement a call made (with its practice or offer: the helper's records
    /// in TS's tests left these out; here they are what the group reads back).
    fn recorded(c: &Value, id: &str, t: i64) -> Value {
        let mut r = json!({ "id": id, "at": t, "record": "statement", "author": AS, "speaks_for": ME, "visible_to": "public", "kind": c["kind"], "text": c["text"] });
        for k in ["data", "practice", "offer", "assertion"] {
            if !c[k].is_null() {
                r[k] = c[k].clone();
            }
        }
        r
    }

    fn agreement(id: &str, who: &str, at: i64) -> Vec<Value> {
        vec![
            json!({ "id": id, "at": at, "record": "agreement", "author": ME, "visible_to": [ME, who], "terms": { "template": "membership", "parties": [ME, who], "commitments": [] } }),
            json!({ "id": format!("{id}.a"), "at": at, "record": "signature", "author": ME, "visible_to": [ME, who], "agreement": id, "as": ME }),
            json!({ "id": format!("{id}.b"), "at": at, "record": "signature", "author": who, "visible_to": [ME, who], "agreement": id, "as": who }),
        ]
    }

    fn claim(id: &str, who: &str, at: i64, amount: i64) -> Value {
        json!({ "id": id, "at": at, "record": "statement", "author": who, "speaks_for": who, "kind": "fund_claim", "addressed_to": [ME], "visible_to": [ME, who],
            "text": "Request: a draw on the fund.", "data": { "amount": amount, "account": format!("acc-{who}") } })
    }

    /// Runs the set-up days, feeding back what it made, until it has offered membership (and said a hearing, if it takes
    /// one up); returns the records it made.
    fn set_up(r: &mut Rig, balance: Option<i64>, days: i64) -> Vec<Value> {
        let mut made: Vec<Value> = vec![];
        let mut fresh: Vec<Value> = vec![];
        for day in 0..days {
            let w = r.wake(day * DAY, std::mem::take(&mut fresh), balance);
            for c in of(&w, "statement", None) {
                let rec = recorded(c, &format!("rec.s{}", made.len()), day * DAY);
                fresh.push(rec.clone());
                made.push(rec);
            }
        }
        made
    }

    /// `set_up`, with the host answering each question the group put at a wake by its next.
    fn set_up_answering(r: &mut Rig, balance: Option<i64>, days: i64, mut answer: impl FnMut(&crate::Question) -> Value) -> Vec<Value> {
        let mut made: Vec<Value> = vec![];
        let mut fresh: Vec<Value> = vec![];
        let mut seen = 0;
        for day in 0..days {
            let w = r.wake(day * DAY, std::mem::take(&mut fresh), balance);
            for c in of(&w, "statement", None) {
                let rec = recorded(c, &format!("rec.s{}", made.len()), day * DAY);
                fresh.push(rec.clone());
                // (What was made, with how it came and in whose name, as the act said it.)
                let mut m = rec;
                m["provenance"] = c["provenance"].clone();
                m["speaks_for"] = c["speaks_for"].clone();
                made.push(m);
            }
            let new: Vec<crate::Question> = r.asked[seen..].to_vec();
            seen = r.asked.len();
            for q in new {
                let body = answer(&q);
                r.answers.push(crate::Answer { kind: q.kind.clone(), about: q.about.clone(), body });
            }
        }
        made
    }

    fn fund_params() -> Value {
        json!({ "founder": "c0001", "shape": "fund", "idea": "idea.1", "name": "The Fall-Back Fund", "purpose": "A fund for those with nothing to fall back on.",
            "want": { "about": "security", "since": 0, "weight": 5000 }, "place": "house-1/dwelling.1", "bank": "bank", "founded_at": 0,
            "dues": [1000], "every_days": [28], "starts_in_days": [7], "lasts_minutes": [60], "fund": { "qualify_days": 60, "draw_months": 6, "every_days": 180 } })
    }

    #[test]
    fn a_fund_states_its_rule_with_its_offer_pays_a_member_of_long_enough_standing_and_refuses_by_the_same_rule_saying_it() {
        let mut r = rig(fund_params());
        let made = set_up(&mut r, Some(0), 6);
        let kinds: Vec<&str> = made.iter().map(|m| m["kind"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["purpose", "notice", "membership"], "a part at a time, in the order: what it is for, the gathering, membership");
        // The offer says the rule in words and as figures: whoever reads it knows when the fund pays.
        let offer = &made[2];
        assert!(offer["text"].as_str().unwrap().contains("The fund's rule: a member of 60 days or more who is short may draw up to XTS 60.00, once in 180 days, while the fund has it."));
        assert_eq!(offer["data"]["fund"], json!({ "draw": 6000, "qualify_days": 60, "every_days": 180 }));
        assert_eq!(offer["offer"]["terms"]["commitments"][0]["does"]["outcome"]["money"], json!({ "to": "acc.9", "amount": "1000", "for": "dues" }));

        // Day 100: one member of 90 days, one of 10; the fund holds 100.00. Both ask.
        let mut papers = agreement("agr.1", "c0002", 10 * DAY);
        papers.extend(agreement("agr.2", "c0003", 90 * DAY));
        papers.extend([claim("rec.1", "c0002", 100 * DAY, 6000), claim("rec.2", "c0003", 100 * DAY, 6000)]);
        let w = r.wake(100 * DAY, papers, Some(10_000));
        let decisions = of(&w, "statement", Some("fund_decision"));
        let seen: Vec<(Value, Value, Value)> = decisions.iter().map(|d| (d["to"].clone(), d["data"]["granted"].clone(), d["data"]["why"].clone())).collect();
        assert_eq!(seen, vec![(json!(["c0002"]), json!(true), Value::Null), (json!(["c0003"]), json!(false), json!("not yet a member long enough"))]);
        // Paid: the money goes to the member's account. Refused: the answer says why, and the rule.
        let paid: Vec<(Value, Value)> = of(&w, "money", None).iter().map(|p| (p["to"].clone(), p["amount"].clone())).collect();
        assert_eq!(paid, vec![(json!("acc-c0002"), json!("XTS 60.00"))]);
        assert!(decisions[1]["text"].as_str().unwrap().contains("We cannot pay a draw now: not yet a member long enough. The fund's rule: a member of 60 days or more"));
        assert_eq!(r.record.as_ref().unwrap()["set"]["circumstances"]["draws_paid"], 1);

        // Day 130: the same member asks again (too soon by the rule); another of long standing asks when the fund is short.
        let mut later = agreement("agr.3", "c0004", 20 * DAY);
        later.extend([claim("rec.3", "c0002", 130 * DAY, 6000), claim("rec.4", "c0004", 130 * DAY, 6000)]);
        let w2 = r.wake(130 * DAY, later, Some(4_000));
        let seen: Vec<(Value, Value, Value)> = of(&w2, "statement", Some("fund_decision")).iter().map(|d| (d["to"][0].clone(), d["data"]["granted"].clone(), d["data"]["why"].clone())).collect();
        assert_eq!(seen, vec![(json!("c0002"), json!(false), json!("drew not long ago")), (json!("c0004"), json!(false), json!("the fund has not got it"))]);
        assert!(of(&w2, "money", None).is_empty());
        // Draws in one wake see what the earlier ones paid: two members, money for one.
        let mut r2 = rig(fund_params());
        set_up(&mut r2, Some(0), 6);
        let mut two = agreement("agr.1", "c0002", 0);
        two.extend(agreement("agr.2", "c0003", 0));
        two.extend([claim("rec.1", "c0002", 100 * DAY, 6000), claim("rec.2", "c0003", 100 * DAY, 6000)]);
        let w3 = r2.wake(100 * DAY, two, Some(7_000));
        let seen: Vec<(Value, Value)> = of(&w3, "statement", Some("fund_decision")).iter().map(|d| (d["data"]["granted"].clone(), d["data"]["why"].clone())).collect();
        assert_eq!(seen, vec![(json!(true), Value::Null), (json!(false), json!("the fund has not got it"))]);
        // A claim naming no account is refused for that.
        let mut r3 = rig(fund_params());
        set_up(&mut r3, Some(0), 6);
        let mut bare = agreement("agr.1", "c0002", 0);
        let mut c = claim("rec.1", "c0002", 100 * DAY, 6000);
        c["data"] = json!({ "amount": 6000 });
        bare.push(c);
        let w4 = r3.wake(100 * DAY, bare, Some(10_000));
        assert_eq!(of(&w4, "statement", Some("fund_decision"))[0]["data"]["why"], "no account given");
    }

    #[test]
    fn a_plain_gathering_says_what_it_is_for_puts_up_its_gathering_at_the_one_place_and_offers_membership_free() {
        let mut r = rig(json!({ "founder": "c0001", "shape": "gathering", "idea": "idea.1", "name": "The Circle", "purpose": "We meet.", "want": { "about": "loss", "since": 5, "weight": 1 },
            "place": "house-1/dwelling.1", "bank": "bank", "founded_at": 0, "dues": [0], "every_days": [14], "starts_in_days": [7], "lasts_minutes": [90] }));
        let made = set_up(&mut r, None, 5);
        assert_eq!(made.iter().map(|m| m["kind"].as_str().unwrap()).collect::<Vec<_>>(), ["purpose", "notice", "membership"], "no account is asked for where nothing is paid");
        assert_eq!(made[0]["text"], "We meet.");
        assert_eq!(made[0]["data"], json!({ "idea": "idea.1", "written_by": "code", "for": "c0001" }));
        let practice = &made[1]["practice"];
        assert_eq!(*practice, json!({ "at": "house-1/dwelling.1", "every": 14 * DAY, "first": 7 * DAY + 19 * 3600, "lasts": 5400, "roles": [{ "role": "member", "open": true }] }));
        assert_eq!(made[1]["text"], "The Circle gathers at house-1/dwelling.1 every 14 days at 19:00, for 90 minutes. All welcome.");
        assert_eq!(made[1]["data"], json!({ "idea": "idea.1", "words": "code" }));
        assert_eq!(made[2]["text"], "Anyone may join The Circle. Nothing is asked but to come.");
        assert_eq!(made[2]["data"], json!({ "idea": "idea.1", "words": "code", "dues": 0 }));
        assert_eq!(made[2]["offer"], membership_offer(ME, 0, None, 7 * DAY, Some(0)));
        // The record it keeps of itself: what it is for, from its founder's want; how it stands.
        let set = &r.record.as_ref().unwrap()["set"];
        assert_eq!(set["purpose"]["arrived"], json!({ "purpose": "code", "gathers": "code", "asks": "code" }));
        assert_eq!(set["purpose"]["about"], "loss");
        assert_eq!(set["wants"][0]["weight"], 1);
        assert_eq!(set["circumstances"]["members"], 0);
        // Setting up it is awake again within the day; once set up (and past three days) on its cadence.
        assert_eq!(r.sleeps_until(5 * DAY), None);
        assert_eq!(Founded.cadence(&r.ctx), 7 * DAY);
    }

    #[test]
    fn a_composed_piece_goes_to_the_translator_a_part_at_a_time_and_with_no_draft_arrives_as_its_choice_or_plain() {
        let mut r = rig(composed_params());
        // No translator to be had (the host answers each `words` question with nothing): the plain purpose, and the
        // composer's closed choice for the gathering and the offer, in its words.
        let made = set_up_answering(&mut r, None, 8, |_| Value::Null);
        let parts: Vec<&str> = r.asked.iter().map(|q| q.body["what"].as_str().unwrap()).collect();
        assert_eq!(parts, ["purpose", "gathers", "asks"], "each part asked once, in order");
        assert!(r.asked.iter().all(|q| q.kind == "words" && q.about == format!("idea.1|{}", q.body["what"].as_str().unwrap())));
        assert_eq!(r.asked[0].body["text"], "Put out a public statement, of kind purpose, in these words: \"We are for something.\"");
        assert_eq!(r.asked[1].body["text"], "Put up a public notice of our gathering, a practice held at house-1/dwelling.1, on cell.4.7: \"The group gathers every week at 19:00.\"");
        assert_eq!(r.asked[2].body["text"], "Offer membership publicly, for anyone to join: \"Come as you are.\"");
        assert_eq!(made[0]["text"], "plain");
        assert_eq!(made[0]["data"], json!({ "idea": "idea.1", "written_by": "code", "for": "c0001" }));
        // Every week, the first in 3 days; 45 minutes was not among what was open, so the plain default length (90).
        assert_eq!(made[1]["practice"]["every"], 7 * DAY);
        assert_eq!(made[1]["practice"]["first"], 3 * DAY + 19 * 3600);
        assert_eq!(made[1]["practice"]["lasts"], 5400);
        assert_eq!(made[1]["text"], "The group gathers every week at 19:00.");
        assert_eq!(made[1]["data"]["words"], "choice");
        assert_eq!(made[2]["text"], "Come as you are.");
        assert_eq!(made[2]["data"]["words"], "choice");
        assert_eq!(r.worded.iter().map(|w| (w.what.as_str(), w.accepted)).collect::<Vec<_>>(), [("purpose", None), ("gathers", None), ("asks", None)]);
        let set = &r.record.as_ref().unwrap()["set"];
        assert_eq!(set["purpose"]["arrived"], json!({ "purpose": "code", "gathers": "choice", "asks": "choice" }));
        assert_eq!(set["purpose"]["model"], "m");
        // A choice outside everything open is the plain default.
        let mut plain = rig(json!({ "name": "G", "place": "p", "idea": "i", "dues": [0], "every_days": [14], "composed": { "purpose": "x", "asks": "y", "gathers": "z", "choice": { "every_days": 3 }, "model": "m" } }));
        let made = set_up_answering(&mut plain, None, 8, |_| Value::Null);
        assert_eq!(made[1]["data"]["words"], "code");
        assert_eq!(made[1]["text"], "G gathers at p every 14 days at 19:00, for 90 minutes. All welcome.");
    }

    fn composed_params() -> Value {
        json!({ "founder": "c0001", "shape": "gathering", "idea": "idea.1", "name": "The Circle", "purpose": "plain", "want": { "about": "loss", "since": 5, "weight": 1 },
            "place": "house-1/dwelling.1", "place_on": "cell.4.7", "bank": "bank", "founded_at": 0, "dues": [0], "every_days": [14, 7], "starts_in_days": [7, 3], "lasts_minutes": [90, 60],
            "composed": { "purpose": "We are for something.", "asks": "Come as you are.", "gathers": "The group gathers every week at 19:00.",
                "choice": { "dues": 0, "every_days": 7, "starts_in_days": 3, "lasts_minutes": 45 }, "model": "m" } })
    }

    /// The host's answer to a `words` question: the translator's draft of these blocks.
    fn drafted(q: &crate::Question, blocks: Value) -> Value {
        let draft = format!("draft.{}", q.body["what"].as_str().unwrap());
        json!({ "ok": true, "draft": draft, "draft_hash": "h", "blocks": blocks, "check": { "ok": true },
            "provenance": { "via": "translator", "proposal": q.body["text"], "draft": draft, "draft_hash": "h" } })
    }

    #[test]
    fn a_translators_draft_is_done_only_as_the_module_says_it_may_be_and_otherwise_arrives_as_the_composers_choice() {
        let mut r = rig(composed_params());
        let made = set_up_answering(&mut r, None, 8, |q| match q.body["what"].as_str().unwrap() {
            "purpose" => drafted(q, json!([{ "block": "publish", "kind": "purpose", "text": "We are for something.", "visible_to": "public" }])),
            "gathers" => drafted(q, json!([{ "block": "publish", "kind": "notice", "text": "Weekly.", "visible_to": "public", "practice": { "at": "house-1/dwelling.1", "every": 7 * DAY, "lasts": 3600 } }])),
            // (Dues into someone else's account: not what may be.)
            _ => drafted(q, json!([{ "block": "publish", "kind": "notice", "text": "Join.", "visible_to": "public", "offer": { "take_up": "join", "terms": { "commitments": [{ "who": "taker", "does": { "outcome": { "money": { "to": "acc-city", "amount": "999" } } }, "every": 30 * DAY }] } } }])),
        });
        // What it is for: the draft's words, in our name, held to be put forward, carrying who wrote them; sent as the draft.
        assert_eq!(made[0]["text"], "We are for something.");
        assert_eq!(made[0]["speaks_for"], ME);
        assert_eq!(made[0]["assertion"], json!({ "that": "We are for something." }));
        assert_eq!(made[0]["data"], json!({ "idea": "idea.1", "written_by": "composer", "model": "m", "for": "c0001" }));
        assert_eq!(made[0]["provenance"]["via"], "translator");
        assert_eq!(made[0]["provenance"]["draft"], "draft.purpose");
        // The gathering as drafted (weekly, an hour: among what was open), its first now, open to members.
        assert_eq!(made[1]["practice"], json!({ "at": "house-1/dwelling.1", "every": 7 * DAY, "first": 3 * DAY, "lasts": 3600, "roles": [{ "role": "member", "open": true }] }));
        assert_eq!(made[1]["provenance"]["via"], "translator");
        // The offer: not done; by the composer's closed choice, written by code.
        assert_eq!(made[2]["text"], "Come as you are.");
        assert_eq!(made[2]["data"]["words"], "choice");
        assert!(made[2]["provenance"].is_null());
        let w: Vec<_> = r.worded.iter().map(|w| (w.what.as_str(), w.accepted, w.plumbing_added, w.why.clone(), w.draft.clone())).collect();
        assert_eq!(w, [
            ("purpose", Some(true), true, None, Some("draft.purpose".into())),
            ("gathers", Some(true), true, None, Some("draft.gathers".into())),
            ("asks", Some(false), false, Some("dues paid to an account that is not ours".into()), Some("draft.asks".into())),
        ]);
        let set = &r.record.as_ref().unwrap()["set"];
        assert_eq!(set["purpose"]["arrived"], json!({ "purpose": "translator", "gathers": "translator", "asks": "choice" }));
    }

    #[test]
    fn a_trained_translators_draft_not_meant_is_put_once_more_and_one_whose_acts_were_not_begun_arrives_the_other_way() {
        // Asked again: the first answer's draft is refused by the kernel and may go behind (`again`); the second is not.
        let mut r = rig(composed_params());
        let made = set_up_answering(&mut r, None, 10, |q| {
            let mut a = drafted(q, json!([{ "block": "publish", "kind": "purpose", "text": "x", "visible_to": "public" }]));
            if q.body["what"] == "purpose" && q.body.get("attempt").is_none() {
                a["check"] = json!({ "ok": false, "refusal": "not_permitted" });
                a["again"] = json!(true);
            }
            a
        });
        let purpose: Vec<_> = r.asked.iter().filter(|q| q.body["what"] == "purpose").map(|q| q.body.get("attempt").cloned()).collect();
        assert_eq!(purpose, [None, Some(json!(2))]);
        assert_eq!(r.worded[0].accepted, Some(false));
        assert!(r.worded[0].again);
        assert_eq!(r.worded[0].why.as_deref(), Some("the acts would be refused (not_permitted)"));
        assert_eq!(made[0]["provenance"]["via"], "translator", "the second draft was what may be");
        // Accepted, but its acts not begun (the engine's `{done: false}`): the part arrives the other way.
        let mut r = rig(composed_params());
        r.wake(0, vec![], None);
        let q = r.asked.pop().unwrap();
        r.answers.push(crate::Answer { kind: "words".into(), about: q.about.clone(), body: drafted(&q, json!([{ "block": "publish", "kind": "purpose", "text": "x", "visible_to": "public" }])) });
        let sent = r.wake(DAY, vec![], None);
        assert_eq!(sent[0]["provenance"]["via"], "translator");
        r.answers.push(crate::Answer { kind: "words".into(), about: q.about, body: json!({ "done": false, "why": "the acts could not be carried out" }) });
        let again = r.wake(2 * DAY, vec![], None);
        assert_eq!(of(&again, "statement", Some("purpose"))[0]["text"], "plain");
        assert_eq!(r.record.as_ref().unwrap()["set"]["purpose"]["arrived"]["purpose"], "code");
    }

    #[test]
    fn dues_open_an_account_first_and_ask_for_it_only_once() {
        let mut r = rig(fund_params());
        let w = r.wake(0, vec![], None);
        assert_eq!(of(&w, "account", None).len(), 1);
        assert_eq!(of(&w, "account", None)[0]["holder"], ME);
        assert_eq!(of(&w, "account", None)[0]["at"], "bank");
        assert!(r.wake(DAY, vec![], None).is_empty(), "it does not ask again while it waits for the account");
        assert_eq!(of(&r.wake(2 * DAY, vec![], Some(0)), "statement", Some("purpose")).len(), 1);
    }

    #[test]
    fn whoever_applies_is_offered_membership_on_the_terms_put_up_once_and_a_member_is_counted_when_signed() {
        let mut r = rig(json!({ "founder": "c0001", "shape": "gathering", "idea": "idea.1", "name": "The Circle", "purpose": "We meet.", "place": "h", "bank": "bank", "dues": [500] }));
        let mut made = set_up(&mut r, Some(0), 5);
        assert!(made[2]["offer"]["terms"]["commitments"][0]["does"]["outcome"]["money"]["amount"] == "500");
        let apply = |id: &str, who: &str, at: i64| json!({ "id": id, "at": at, "record": "statement", "author": who, "speaks_for": who, "kind": "membership_application", "addressed_to": [ME], "visible_to": [ME, who], "text": "Request to join", "data": { "account": format!("acc-{who}") } });
        let w = r.wake(6 * DAY, vec![apply("rec.a1", "c0005", 6 * DAY), apply("rec.a2", "c0006", 6 * DAY)], Some(0));
        let offers = of(&w, "agreement", None);
        assert_eq!(offers.len(), 2);
        assert_eq!(offers[0]["with"], "c0005");
        assert_eq!(offers[0]["template"], "membership");
        assert_eq!(offers[0]["their_notice"], "7 days");
        assert_eq!(offers[0]["basis"], "rec.a1");
        assert_eq!(offers[0]["we_do"], "ent.9 counts c0005 among its members.");
        assert_eq!(offers[0]["they_do"]["fn"], "money");
        assert_eq!(offers[0]["they_do"]["to"], "acc.9");
        assert_eq!(offers[0]["they_do"]["amount"], "XTS 5.00");
        assert_eq!(offers[0]["they_do"]["every"], "30 days");
        assert_eq!(offers[0]["terms"], "c0005 is a member of ent.9, paying dues of XTS 5.00 a month.");
        assert_eq!(r.record.as_ref().unwrap()["set"]["circumstances"]["applications"], 2);
        // Not offered again; and a member who applies again is not offered it at all.
        let mut papers = agreement("agr.1", "c0005", 7 * DAY);
        papers.push(apply("rec.a3", "c0005", 8 * DAY));
        let w = r.wake(8 * DAY, papers, Some(0));
        assert!(of(&w, "agreement", None).is_empty());
        let set = &r.record.as_ref().unwrap()["set"];
        assert_eq!(set["circumstances"]["joined"], 1);
        assert_eq!(set["circumstances"]["members"], 1);
        assert_eq!(set["memory"]["recent"][0]["what"], "member_joined");
        made.clear();
    }

    #[test]
    fn a_thing_nobody_joins_withdraws_its_offers_and_says_it_has_wound_up_then_does_nothing() {
        let mut r = rig(json!({ "founder": "c0001", "shape": "gathering", "idea": "idea.1", "name": "The Circle", "purpose": "We meet.", "place": "h", "lapse_days": 60 }));
        let made = set_up(&mut r, None, 5);
        let ids: Vec<String> = made.iter().map(|m| m["id"].as_str().unwrap().to_string()).collect();
        let papers = made.clone();
        // (Day 5 is when it first counts nobody; 60 days after that it winds up.)
        assert!(of(&r.wake(10 * DAY, papers, None), "statement", Some("wound_up")).is_empty());
        let w = r.wake(70 * DAY, vec![], None);
        let withdrawn: Vec<&str> = of(&w, "statement", None).iter().filter_map(|c| c["withdraw"].as_str()).collect();
        assert_eq!(withdrawn.len(), 2, "its offer of membership and its gathering");
        assert!(withdrawn.iter().all(|id| ids.contains(&(*id).to_string())));
        let said = of(&w, "statement", Some("wound_up"));
        assert_eq!(said.len(), 1);
        assert_eq!(said[0]["text"], "The Circle has wound up: too few came.");
        assert_eq!(said[0]["data"], json!({ "idea": "idea.1", "members": 0, "days": 70 }));
        assert!(said[0]["to"].is_null());
        assert_eq!(r.record.as_ref().unwrap()["set"]["circumstances"]["lapsed"], 1);
        assert!(r.wake(80 * DAY, vec![], None).is_empty());
        assert_eq!(r.sleeps_until(90 * DAY), Some(400 * DAY), "it sleeps to the run's end");
    }

    #[test]
    fn a_group_that_has_outgrown_the_founders_home_books_the_hall_once_when_it_can_pay_its_hire() {
        let mut r = rig(json!({ "founder": "c0001", "shape": "gathering", "idea": "idea.1", "name": "The Circle", "purpose": "We meet.", "place": "house-1/dwelling.1", "bank": "bank", "dues": [5000],
            "place_room": 4, "hall": { "space": "hall-1/hall.1", "town": "town", "account": "acc-town", "hire": 4000 } }));
        let made = set_up(&mut r, Some(0), 5);
        let mut papers: Vec<Value> = vec![];
        for (i, who) in ["c1", "c2", "c3"].iter().enumerate() {
            papers.extend(agreement(&format!("agr.{i}"), who, 6 * DAY));
        }
        // Three members and the founder fill the home exactly: not yet.
        assert!(of(&r.wake(8 * DAY, papers, Some(50_000)), "statement", Some("hall_booking")).is_empty());
        let w = r.wake(9 * DAY, agreement("agr.5", "c4", 9 * DAY), Some(50_000));
        let booking = of(&w, "statement", Some("hall_booking"));
        assert_eq!(booking.len(), 1);
        assert_eq!(booking[0]["to"], json!(["town"]));
        assert_eq!(booking[0]["data"]["space"], "hall-1/hall.1");
        assert_eq!(booking[0]["data"]["members"], 4);
        // The next gathering on the rhythm after tomorrow: the first was day 7 at 19:00, every 14 days.
        let first = made[1]["practice"]["first"].as_i64().unwrap();
        assert_eq!(booking[0]["data"]["first"], first + 14 * DAY);
        let hire = of(&w, "money", None);
        assert_eq!(hire.len(), 1);
        assert_eq!((hire[0]["to"].clone(), hire[0]["amount"].clone(), hire[0]["from"].clone(), hire[0]["every"].clone()), (json!("acc-town"), json!("XTS 40.00"), json!("acc.9"), json!("14 days")));
        assert_eq!(of(&w, "statement", None).iter().filter(|c| c["withdraw"] == made[1]["id"]).count(), 1, "the notice at the home comes down");
        let notice = of(&w, "statement", Some("notice"));
        assert_eq!(notice[0]["practice"]["at"], "hall-1/hall.1");
        assert_eq!(r.record.as_ref().unwrap()["set"]["circumstances"]["at_hall"], 1);
        // Only once.
        assert!(of(&r.wake(10 * DAY, vec![], Some(50_000)), "statement", Some("hall_booking")).is_empty());
    }

    fn cause_params() -> Value {
        json!({ "founder": "c0001", "shape": "cause", "idea": "idea.2", "name": "The Tenants", "purpose": "We take up such matters.", "want": { "about": "disrepair", "whom": "landlord-1", "since": 5, "weight": 2000 },
            "place": "h", "bank": "bank", "dues": [0], "cause": { "case_hours": 1, "hours_per_member_month": 100, "answer_days": 2 } })
    }
    fn application(id: &str, who: &str, at: i64, d: Value) -> Value {
        json!({ "id": id, "at": at, "record": "statement", "author": who, "speaks_for": who, "kind": "application", "addressed_to": [ME], "visible_to": [ME, who], "text": "Application.", "data": d })
    }

    #[test]
    fn a_body_that_takes_grievances_up_says_what_it_hears_tells_the_other_side_and_decides_when_the_time_to_answer_has_run() {
        let mut r = rig(cause_params());
        let made = set_up(&mut r, None, 5);
        assert_eq!(made.iter().map(|m| m["kind"].as_str().unwrap()).collect::<Vec<_>>(), ["purpose", "notice", "membership", "hearing"]);
        assert_eq!(made[3]["text"], "The Tenants takes up for its members: disrepair, with landlord-1. Members apply in writing; there is no fee.");
        assert_eq!(made[3]["offer"], json!({ "by": ME, "take_up": "apply", "to": { "members_of": ME }, "hears": [{ "about": "disrepair", "can": ["recommend", "represent"] }] }));
        assert_eq!(made[3]["data"], json!({ "hears": ["disrepair"], "idea": "idea.2" }));
        assert_eq!(Founded.cadence(&r.ctx), DAY);

        // Three applications: one it hears with a sum; one about nothing it hears; one that says nothing of what it is about.
        let a1 = application("rec.a1", "c0007", 6 * DAY, json!({ "matter": "disrepair", "against": "landlord-1", "amount": 12_000, "account": "acc-c0007", "about": "lease-1" }));
        let a2 = application("rec.a2", "c0008", 6 * DAY, json!({ "matter": "noise", "against": "landlord-1" }));
        let a3 = application("rec.a3", "c0009", 6 * DAY, json!({ "matter": "disrepair", "against": "landlord-1" }));
        let w = r.wake(6 * DAY, vec![a1.clone(), a2, a3], None);
        let notices = of(&w, "statement", Some("complaint_notice"));
        assert_eq!(notices.len(), 2);
        assert_eq!(notices[0]["to"], json!(["c0007", "landlord-1"]));
        assert_eq!(notices[0]["basis"], "rec.a1");
        assert_eq!(notices[0]["data"]["answer_by"], 8 * DAY);
        assert_eq!(notices[0]["data"]["amount"], 12_000);
        assert!(notices[0]["text"].as_str().unwrap().contains("seeking XTS 120.00 (application rec.a1)"));
        let refused = of(&w, "statement", Some("venue_decision"));
        assert_eq!(refused.len(), 1);
        assert_eq!(refused[0]["data"]["finding"], "rejected");
        assert_eq!(refused[0]["text"], "Decision on rec.a2: we cannot hear it.");
        // The other side answers from its books; when the time has run, the body recommends payment.
        let answer = json!({ "id": "rec.r1", "at": 7 * DAY, "record": "statement", "author": "landlord-1", "speaks_for": "landlord-1", "kind": "complaint_response", "addressed_to": [ME],
            "visible_to": [ME, "landlord-1"], "basis": "rec.a1", "text": "Answer.", "data": { "application": "rec.a1", "owed": 9_000, "known": true } });
        assert!(of(&r.wake(7 * DAY, vec![answer], None), "statement", Some("venue_decision")).is_empty(), "not before the day to answer");
        let w = r.wake(8 * DAY + 3600, vec![], None);
        let decided = of(&w, "statement", Some("venue_decision"));
        assert_eq!(decided.len(), 2);
        let pay = decided.iter().find(|d| d["basis"] == "rec.a1").unwrap();
        assert_eq!(pay["data"]["finding"], "pay");
        assert_eq!(pay["data"]["amount"], 9_000);
        assert_eq!(pay["data"]["to"], "acc-c0007");
        assert_eq!(pay["data"]["binding"], false, "a body that recommends does not order");
        assert!(pay["text"].as_str().unwrap().starts_with("Decision on rec.a1: landlord-1 should pay c0007 XTS 90.00 by "));
        let none = decided.iter().find(|d| d["basis"] == "rec.a3").unwrap();
        assert_eq!(none["data"]["finding"], "dismissed");
        assert_eq!(none["data"]["no_particulars"], true);
        let c = &r.record.as_ref().unwrap()["set"]["circumstances"];
        assert_eq!(c["cases_decided"], 3, "the one turned away, the one paid, the one dismissed");
        // A case decided is not decided again.
        assert!(of(&r.wake(9 * DAY, vec![], None), "statement", Some("venue_decision")).is_empty());
    }

    #[test]
    fn a_body_decides_no_more_cases_than_its_members_hours_allow() {
        let mut p = cause_params();
        p["cause"] = json!({ "case_hours": 6, "hours_per_member_month": 2, "answer_days": 1 });
        let mut r = rig(p);
        set_up(&mut r, None, 5);
        let apps: Vec<Value> = (1..=3).map(|i| application(&format!("rec.a{i}"), &format!("c000{i}"), 6 * DAY, json!({ "matter": "disrepair", "against": "landlord-1", "about": "lease-1" }))).collect();
        r.wake(6 * DAY, apps, None);
        // One founder gives 2 hours a month: a case takes 6, so nothing is decided for the first quarter, then one.
        assert!(of(&r.wake(40 * DAY, vec![], None), "statement", Some("venue_decision")).is_empty());
        assert_eq!(of(&r.wake(95 * DAY, vec![], None), "statement", Some("venue_decision")).len(), 1);
        assert_eq!(of(&r.wake(96 * DAY, vec![], None), "statement", Some("venue_decision")).len(), 0, "the hours were spent on it");
    }

    #[test]
    fn what_a_group_has_saved_steps_exactly_as_the_original_would() {
        let mut r = rig(cause_params());
        set_up(&mut r, None, 5);
        let a = application("rec.a1", "c0007", 6 * DAY, json!({ "matter": "disrepair", "against": "landlord-1", "about": "lease-1" }));
        r.wake(6 * DAY, vec![a], None);
        let saved = r.actor.save().unwrap();
        let mut back = Rig { actor: Founded.restore(&r.ctx, saved.clone()).unwrap(), ctx: r.ctx.clone(), view: View::default(), draws: Draws::new(AS, "convenor"), made: r.made, record: None, asked: vec![], answers: vec![], worded: vec![] };
        assert_eq!(back.actor.save().unwrap(), saved, "restoring and saving again is the same memory");
        // (The view is the engine's, not the actor's: the restored rig is shown the same account and nothing new.)
        let now = r.wake(9 * DAY, vec![], None);
        let then = back.wake(9 * DAY, vec![], None);
        assert_eq!(now, then);
        assert_eq!(of(&now, "statement", Some("venue_decision")).len(), 1);
        assert_eq!(r.actor.save().unwrap(), back.actor.save().unwrap());
        assert_eq!(r.record.as_ref().unwrap()["set"]["circumstances"], back.record.as_ref().unwrap()["set"]["circumstances"]);
    }

    #[test]
    fn the_hearings_part_a_body_needs_is_tried_alone() {
        let hears = vec![Hears { about: "debt".into(), can: Some(vec!["recommend".into()]), ..Default::default() }];
        assert_eq!(hearing_offer("g", &hears, None), json!({ "by": "g", "take_up": "apply", "hears": [{ "about": "debt", "can": ["recommend"] }] }));
        assert!(has_particulars(&json!({ "particulars": " a thing " })));
        assert!(has_particulars(&json!({ "amount": "1200" })));
        assert!(!has_particulars(&json!({ "amount": 0, "particulars": "  " })));
        assert!(!has_particulars(&Value::Null));
        let h = Hearings::new("g", hears, 14, 28);
        assert_eq!(h.open(), 0);
    }

    #[test]
    fn the_manifest_names_its_params_and_the_defaults_read_as_the_modules() {
        let m = Founded.manifest();
        assert_eq!(m["name"], "group.founded");
        assert_eq!(m["params"]["dues"]["default"], json!([0]));
        let p = params(&json!({ "dues": [500], "hall": null, "shape": "fund" })).unwrap();
        assert_eq!((p.dues.clone(), p.hall.is_none(), p.shape.as_str(), p.at_seconds, p.place_room), (vec![500], true, "fund", 68_400, 4));
        assert!(params(&json!({ "dues": "much" })).is_err());
    }
}
