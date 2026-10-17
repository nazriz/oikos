//! Everyday frictions, and how they are heard (participants/src/behaviour/frictions.ts; docs/behaviour/frictions.md;
//! docs/design/ai-citizens.md 10k step 2b).
//!
//! Things really go wrong: a home falls into disrepair and the repair asked for is not done; a bond is kept; pay comes
//! short; a bill is wrong; a claim is wrongly refused; a road is left; a neighbour is loud; what was bought is faulty.
//! Each is a mechanism where its cause lives (a building's age and its owner's upkeep, an employer's character and cash,
//! an office's load), at a rate the world's profile gives with its source and the world's dial scales
//! (`dials.friction_bps`; 0 or absent: none of it arises). Nothing here blocks or carries anything out: a friction leaves
//! a state of the world or a paper; whoever suffers it puts up with it, asks, or goes to a venue that says it hears such
//! things (an offer's `hears`); a venue decides by its own procedure, and its decision is words that the other side obeys
//! or does not.
//!
//! A library, not a kind: the dial and the arithmetic of a rate, the papers a grievance travels on, and what an
//! organisation does when it is asked to put something right, told of a complaint, or ordered to (`Respondent`). Every
//! draw is from a stream the actor is handed (`Cx`).
//!
//! Decided fresh in Rust: an organisation's character reaches the respondent through the `Character` trait (C1's
//! organisation implements it), in thousandths of a standard deviation, so the sway is integer arithmetic
//! (`swayed`); the rate sways as TS's did and is rounded half up. Whether a respondent grants, answers, complies or
//! heeds is a draw from its character and the profile's rate (frictions.md): the rate is the town's mean, the sway is
//! the character's, and the draw is the only chance; it is not a dial per case.

use crate::common::{addressed_to, data, money_words, when_words, Book, Fields, Occurrences, DAY};
use crate::steps::{because, pay, say, Pay, Say, Step, Visible};
use crate::{Cx, WorldInfo};
use oikos_core::rng::Rng;
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// The world's dial for how much goes wrong (basis points; 10,000: the profile's rates as sourced; 0: nothing).
pub fn friction_dial(dials: &Value) -> i64 {
    dials.get("friction_bps").and_then(super::floor_of).unwrap_or(0).max(0)
}

/// The chance, in parts per million, that something with a yearly rate (basis points of the exposed, a year) happens in
/// `days`, at the dial. Whole numbers, so the same on every machine; linear, which is exact enough while a period's
/// chance is small, and never over certainty.
pub fn chance_ppm(per_year_bps: i64, days: i64, dial_bps: i64) -> i64 {
    if per_year_bps <= 0 || dial_bps <= 0 || days <= 0 {
        return 0;
    }
    ((per_year_bps as i128 * dial_bps as i128 * days as i128) / (100 * 365)).min(1_000_000) as i64
}

pub fn arises(rng: &mut Rng, per_year_bps: i64, days: i64, dial_bps: i64) -> bool {
    (rng.below(1_000_000) as i64) < chance_ppm(per_year_bps, days, dial_bps)
}

/// A rate swayed by how far a character sits from the town's mean (wants.ts `swayed`): `bps` times one plus `per` of the
/// deviation, the deviation clamped to three, rounded half up, held between nothing and certainty. `z_milli` and
/// `per_milli` are in thousandths.
pub fn swayed(bps: i64, z_milli: i64, per_milli: i64) -> i64 {
    let z = z_milli.clamp(-3_000, 3_000) as i128;
    let num = bps as i128 * (1_000_000 + per_milli as i128 * z);
    ((num + 500_000).div_euclid(1_000_000)).clamp(0, 10_000) as i64
}

/// The papers a grievance travels on. A tribunal keeps its own forms (docs/behaviour/justice.md): an offer's `hears` names
/// the form an application to it is made on.
pub mod paper {
    /// To the other side: put this right.
    pub const REQUEST: &str = super::super::decisions::kind::REQUEST;
    /// Their answer.
    pub const ANSWER: &str = "remedy_answer";
    /// To a venue that hears the matter (unless its `hears` names another form).
    pub const APPLICATION: &str = "application";
    /// The venue to the one complained of: what is said, and by when to answer.
    pub const NOTICE: &str = "complaint_notice";
    /// Their answer to the venue.
    pub const RESPONSE: &str = "complaint_response";
    /// What the venue decided, to both.
    pub const DECISION: &str = "venue_decision";
}

/// What a grievance says, on any of its papers (`data`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Matter {
    /// The matter, in the world's labels: what a venue's `hears` names.
    #[serde(default)]
    pub matter: String,
    /// The other side.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub against: Option<String>,
    /// The paper it is about, where there is one (a bill, a decision, an agreement, a receipt).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    /// Money sought, and the account to pay it into.
    #[serde(default, deserialize_with = "crate::papers::lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    /// The building it is about (disrepair, a service not done).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    /// What was asked of the other side first, if anything.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<String>,
    /// In a word, what is sought where it is not money: `repair`, `stop`, `review`, `done`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seeks: Option<String>,
}

impl Matter {
    pub fn of(r: &Record) -> Matter {
        serde_json::from_value(data(r).clone()).unwrap_or_default()
    }
    fn label(&self) -> String {
        self.matter.replace('_', " ")
    }
}

/// What an organisation's own books say of something complained of: what it owes, whether what was asked is done, or
/// nothing (it cannot know: goods said to be faulty).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Truth {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owed: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrong: Option<bool>,
}

/// How an organisation answers when asked to put something right (docs/behaviour/frictions.md). The rates are the
/// profile's, with sources; the defaults are placeholders.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RespondParams {
    /// Asked to put something right, by matter: how often an organisation of the town's mean character does (`other` for
    /// the rest).
    pub grant_bps: BTreeMap<String, i64>,
    /// Not doing it: how often it at least says so (the rest is silence). PLACEHOLDER.
    pub answers_bps: i64,
    /// Told of a complaint by a venue: how often it answers. PLACEHOLDER.
    pub responds_bps: i64,
    /// Ordered: how often it does as ordered unasked again; recommended to: how often it does.
    pub comply_bps: i64,
    pub heed_bps: i64,
    /// How far a standard deviation of character sways each (a share of the rate), in thousandths. PLACEHOLDER. (The world's
    /// parameter is `sway`, written as a fraction, 0.5; it is read as the digits it is written in.)
    pub sway_milli: i64,
}

impl Default for RespondParams {
    fn default() -> Self {
        RespondParams { grant_bps: BTreeMap::from([("other".to_string(), 5_000)]), answers_bps: 5_000, responds_bps: 8_000, comply_bps: 8_000, heed_bps: 6_000, sway_milli: 500 }
    }
}

impl RespondParams {
    /// The defaults, with what the world gives on top (the rates by matter are merged, as TS did).
    pub fn given(given: &Value) -> RespondParams {
        let mut p = RespondParams::default();
        if let Some(o) = given.as_object() {
            for (k, v) in o {
                match k.as_str() {
                    "grant_bps" => {
                        if let Some(m) = v.as_object() {
                            for (matter, bps) in m {
                                if let Some(b) = bps.as_i64() {
                                    p.grant_bps.insert(matter.clone(), b);
                                }
                            }
                        }
                    }
                    "answers_bps" => p.answers_bps = v.as_i64().unwrap_or(p.answers_bps),
                    "responds_bps" => p.responds_bps = v.as_i64().unwrap_or(p.responds_bps),
                    "comply_bps" => p.comply_bps = v.as_i64().unwrap_or(p.comply_bps),
                    "heed_bps" => p.heed_bps = v.as_i64().unwrap_or(p.heed_bps),
                    "sway" => p.sway_milli = super::scaled(v, 1_000).unwrap_or(p.sway_milli),
                    _ => {}
                }
            }
        }
        p
    }
}

/// An organisation's character and memory, for what answers its grievances (C1's `Org`, orgwants.ts, implements this).
/// Values are in thousandths of a standard deviation from the town's mean owner.
pub trait Character {
    /// Whether it takes initiative at all (the dial for initiative is on); if not it answers at the profile's rates.
    fn lively(&self) -> bool;
    fn keep(&self) -> i64;
    fn standing(&self) -> i64;
    fn pay_less(&self) -> i64;
    /// Counts what it did, for whoever counts.
    fn count(&mut self, what: &str);
    /// Remembers what it did and to whom (a habit, where the culture dial is on).
    fn remember(&mut self, t: i64, what: &str, with: &str);
}

/// What a respondent needs of its organisation's own books and means, beyond the grievance itself.
pub trait Answerer<T> {
    /// What its own books say of this (it answers a venue truthfully when it answers: nobody lies yet; what it may do is
    /// not answer, and not pay).
    fn truth(&mut self, m: &Matter, from: &str, book: &Book, t: i64) -> Option<Truth>;
    /// The steps that put a thing right other than by paying (a repair ordered, a bill corrected).
    fn remedy(&mut self, _m: &Matter, _from: &str, _t: i64, _why: &str, _basis: &str) -> Option<Vec<Step<T>>> {
        None
    }
    /// What putting it right would cost beyond what is owed (a repair to be paid for): done only if it can.
    fn cost(&self, _m: &Matter) -> i64 {
        0
    }
}

/// Forms of a venue it is answerable to beyond the common ones (a tribunal's).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VenueForms {
    pub notice: String,
    pub response: String,
    pub decision: String,
}

/// An organisation asked to put something right, told of a complaint, or ordered to: what its post does about each paper,
/// once. Whether it grants, answers, complies or heeds is its character's (docs/behaviour/firm-wants.md): keeping those it
/// deals with and being thought well of, against paying less; one with no character (the dial for initiative off) answers
/// at the profile's rates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Respondent {
    me: String,
    handled: BTreeSet<String>,
    /// Which request, notice or decision each paper is to us: by who and what about, not by its number on file.
    nth: Occurrences,
    pub p: RespondParams,
    /// What it did, for whoever counts (nothing reads it back).
    pub counts: BTreeMap<String, u64>,
    forms: Vec<VenueForms>,
    /// Whether it answers requests to put something right itself (default: it does). An office that looks at its own
    /// decisions again by the law's route (`Reconsiderations`, foundations F8) answers its requests there, and uses this
    /// for the venues' notices and orders only.
    requests: bool,
}

impl Respondent {
    pub fn new(me: &str, params: &Value, forms: Vec<VenueForms>, requests: bool) -> Self {
        Respondent {
            me: me.to_string(),
            handled: BTreeSet::new(),
            nth: Occurrences::default(),
            p: RespondParams::given(params),
            counts: BTreeMap::new(),
            forms,
            requests,
        }
    }

    fn lean(org: &Option<&mut dyn Character>) -> i64 {
        match org {
            Some(o) if o.lively() => (o.keep() + o.standing()) / 2 - o.pay_less(),
            _ => 0,
        }
    }

    fn draw(&self, cx: &mut Cx, key: &str, bps: i64, lean_milli: i64) -> bool {
        (cx.rng(key).below(10_000) as i64) < swayed(bps, lean_milli, self.p.sway_milli)
    }

    fn count(&mut self, org: &mut Option<&mut dyn Character>, what: &str) {
        *self.counts.entry(what.to_string()).or_insert(0) += 1;
        if let Some(o) = org {
            o.count(what);
        }
    }

    fn mine(&self, r: &Record) -> bool {
        addressed_to(r).contains(&self.me) && !self.handled.contains(&r.id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn steps<T>(
        &mut self,
        cx: &mut Cx,
        book: &Book,
        t: i64,
        account: Option<&str>,
        balance: i64,
        mut org: Option<&mut dyn Character>,
        with: &mut dyn Answerer<T>,
    ) -> Vec<Step<T>> {
        let world = cx.ctx.world.clone();
        let (me, usd) = (self.me.clone(), |n: i64| money_words(n, &world));
        let mut steps: Vec<Step<T>> = vec![];
        let mut left = balance;
        // ---- asked to put something right ----
        let requests: Vec<_> = if self.requests { book.open(paper::REQUEST).filter(|r| self.mine(r)).cloned().collect() } else { vec![] };
        for r in requests {
            self.handled.insert(r.id.clone());
            let m = Matter::of(&r);
            let from = r.speaks_for.clone().unwrap_or_default();
            let truth = with.truth(&m, &from, book, t);
            // (What our books say is owed, where they say; what is asked, where they cannot say; nothing, where they say none is.)
            let owed = match truth.and_then(|x| x.owed) {
                Some(o) => o,
                None if m.amount.is_some() && truth.and_then(|x| x.wrong) != Some(false) => cents_of(m.amount),
                None => 0,
            };
            let nothing = truth.is_some_and(|x| x.wrong == Some(false) || x.done == Some(true) || (x.owed.is_some_and(|o| o <= 0) && x.wrong != Some(true) && x.done != Some(false)));
            let which = self.nth.key(&r.id, &[Some(&from), Some(&m.matter), m.structure.as_deref().or(m.about.as_deref())]);
            let rate = self.p.grant_bps.get(&m.matter).or_else(|| self.p.grant_bps.get("other")).copied().unwrap_or(5_000);
            let cost = owed.max(0) + with.cost(&m);
            let lean = Self::lean(&org);
            let granted = !nothing && self.draw(cx, &format!("remedy-{which}"), rate, lean) && (cost <= 0 || (account.is_some() && left >= cost));
            if granted {
                let how = with.remedy(&m, &from, t, &format!("Asked by {from} to put right {}: doing it.", m.label()), &r.id).unwrap_or_default();
                let mut calls = vec![say(
                    paper::ANSWER,
                    &format!("Answer to your request {}: yes{}.", r.id, if owed > 0 { format!(", {} is paid to you", usd(owed)) } else { String::new() }),
                    Say {
                        to: Some(vec![from.clone()]),
                        visible: Some(Visible::Only(vec![from.clone(), me.clone()])),
                        basis: Some(r.id.clone()),
                        data: Some({
                            let mut d = json!({ "request": r.id, "matter": m.matter, "granted": true });
                            if owed > 0 {
                                d["amount"] = owed.into();
                            }
                            d
                        }),
                        ..Default::default()
                    },
                )];
                if let (true, Some(to), Some(acc)) = (owed > 0, m.account.as_deref(), account) {
                    calls.push(pay(to, owed, Pay { from: Some(acc.to_string()), for_: Some(format!("Putting right: {}.", m.label())), settles: Some(r.id.clone()), ..Default::default() }, cx));
                }
                steps.push(because(format!("Asked by {from} to put something right ({}{}): we will.", m.label(), if owed > 0 { format!(", {}", usd(owed)) } else { String::new() }), calls));
                steps.extend(how);
                left -= cost;
                self.count(&mut org, "remedy_granted");
                if let Some(o) = &mut org {
                    o.remember(t, "remedy_granted", &from);
                }
            } else if nothing || self.draw(cx, &format!("answers-{which}"), self.p.answers_bps, lean) {
                let mut d = json!({ "request": r.id, "matter": m.matter, "granted": false });
                if nothing {
                    d["reason"] = "nothing owed on our records".into();
                }
                steps.push(because(
                    format!("Asked by {from} to put something right ({}): {}; saying so.", m.label(), if nothing { "our books show nothing to put right" } else { "we will not" }),
                    vec![say(
                        paper::ANSWER,
                        &format!("Answer to your request {}: no{}.", r.id, if nothing { ": our records show nothing owed" } else { "" }),
                        Say { to: Some(vec![from.clone()]), visible: Some(Visible::Only(vec![from.clone(), me.clone()])), basis: Some(r.id.clone()), data: Some(d), ..Default::default() },
                    )],
                ));
                self.count(&mut org, "remedy_refused");
                if let Some(o) = &mut org {
                    o.remember(t, "remedy_refused", &from);
                }
            } else {
                self.count(&mut org, "remedy_ignored");
            }
        }
        // ---- told of a complaint by a venue: answering from our books ----
        let mut forms = vec![VenueForms { notice: paper::NOTICE.into(), response: paper::RESPONSE.into(), decision: paper::DECISION.into() }];
        forms.extend(self.forms.clone());
        for f in forms {
            let notices: Vec<_> = book.open(&f.notice).filter(|r| self.mine(r)).cloned().collect();
            for n in notices {
                let d = data(&n);
                let m = Matter::of(&n);
                let (application, applicant) = (d.s("application"), d.s("applicant").unwrap_or_default().to_string());
                // (A tribunal's notices of other kinds are the module's own.)
                let Some(application) = application else { continue };
                if m.matter.is_empty() || m.against.as_deref() != Some(self.me.as_str()) {
                    continue;
                }
                self.handled.insert(n.id.clone());
                let venue = n.speaks_for.clone().unwrap_or_default();
                let which = self.nth.key(&n.id, &[Some(&venue), Some(&applicant), Some(&m.matter), m.structure.as_deref().or(m.about.as_deref())]);
                let standing = match &org {
                    Some(o) if o.lively() => o.standing(),
                    _ => 0,
                };
                if !self.draw(cx, &format!("responds-{which}"), self.p.responds_bps, standing) {
                    self.count(&mut org, "complaint_unanswered");
                    continue;
                }
                let truth = with.truth(&m, &applicant, book, t);
                let said = match truth {
                    Some(Truth { owed: Some(o), .. }) => format!("our records show {} owed", usd(o)),
                    Some(Truth { done: Some(dn), .. }) => (if dn { "it is done" } else { "it is not yet done" }).to_string(),
                    Some(Truth { wrong: Some(w), .. }) => (if w { "the paper was wrong" } else { "the paper was right" }).to_string(),
                    _ => "we have nothing on our records about it".to_string(),
                };
                let mut seen = vec![venue.clone(), me.clone()];
                if !applicant.is_empty() {
                    seen.push(applicant.clone());
                }
                let mut body = json!({ "application": application, "known": truth.is_some() });
                if let Some(tr) = truth {
                    if let Value::Object(extra) = serde_json::to_value(tr).unwrap_or_default() {
                        if let Some(b) = body.as_object_mut() { b.extend(extra) }
                    }
                }
                steps.push(because(
                    format!("{venue} tells us of a complaint by {applicant} ({}): answering from our books.", m.label()),
                    vec![say(&f.response, &format!("Answer on {application}: {said}."), Say { to: Some(vec![venue.clone()]), visible: Some(Visible::Only(seen)), basis: Some(application.to_string()), data: Some(body), ..Default::default() })],
                ));
                self.count(&mut org, "complaint_answered");
            }
            // ---- a decision against us: doing as ordered or recommended, or not ----
            let decisions: Vec<_> = book
                .open(&f.decision)
                .filter(|r| {
                    let d = data(r);
                    !self.handled.contains(&r.id) && d.s("against") == Some(self.me.as_str()) && d.s("matter").is_some() && matches!(d.s("finding"), Some("pay" | "do" | "set_aside"))
                })
                .cloned()
                .collect();
            for dr in decisions {
                self.handled.insert(dr.id.clone());
                let x = data(&dr);
                let binding = x.get("binding") != Some(&Value::Bool(false));
                let finding = x.s("finding").unwrap_or_default();
                let matter = x.s("matter").unwrap_or_default();
                let structure = x.s("structure").map(String::from);
                let about = x.s("about").map(String::from);
                let applicant = x.s("applicant").unwrap_or_default().to_string();
                let cost_of = Matter { matter: matter.to_string(), structure: structure.clone(), ..Default::default() };
                let amount = (if finding == "pay" { x.get("amount").map_or(0, |a| a.i64().unwrap_or_else(|| a.as_str().and_then(|s| s.parse().ok()).unwrap_or(0))) } else { 0 })
                    + if finding == "do" { with.cost(&cost_of) } else { 0 };
                let venue = dr.speaks_for.clone().unwrap_or_default();
                let which = self.nth.key(&dr.id, &[Some(&venue), Some(&applicant), Some(matter), structure.as_deref().or(about.as_deref())]);
                let lean = match &org {
                    Some(o) if o.lively() => o.standing() - o.pay_less() / 2,
                    _ => 0,
                };
                let will = self.draw(cx, &format!("complies-{which}"), if binding { self.p.comply_bps } else { self.p.heed_bps }, lean) && (amount <= 0 || (account.is_some() && left >= amount));
                if !will {
                    let what = if binding { "order_defied" } else { "recommendation_unheeded" };
                    self.count(&mut org, what);
                    if let Some(o) = &mut org {
                        o.remember(t, what, &applicant);
                    }
                    continue;
                }
                let m = Matter { matter: matter.to_string(), against: Some(self.me.clone()), about, structure, seeks: x.s("seeks").map(String::from), ..Default::default() };
                let why = format!(
                    "{venue} {} that we {}: doing so.",
                    if binding { "orders" } else { "recommends" },
                    match finding {
                        "pay" => format!("pay {applicant} {}", usd(amount)),
                        "do" => format!("put right {}", matter.replace('_', " ")),
                        _ => "withdraw the paper".to_string(),
                    }
                );
                if let (true, true, Some(to), Some(acc)) = (finding == "pay", amount > 0, x.s("to"), account) {
                    steps.push(because(why.clone(), vec![pay(to, amount, Pay { from: Some(acc.to_string()), for_: Some(format!("Under {}.", dr.id)), settles: Some(dr.id.clone()), ..Default::default() }, cx)]));
                }
                left -= amount;
                // (And whatever puts it right from here on: the work done, the paper withdrawn, the pay set right.)
                steps.extend(with.remedy(&m, &applicant, t, &why, &dr.id).unwrap_or_default());
                let what = if binding { "order_obeyed" } else { "recommendation_heeded" };
                self.count(&mut org, what);
                if let Some(o) = &mut org {
                    o.remember(t, what, &applicant);
                }
            }
        }
        steps
    }
}

fn cents_of(a: Option<i64>) -> i64 {
    a.unwrap_or(0)
}

/// The copy of a paper tendered to a venue that cannot see what passed between the parties.
pub fn tendered(r: &Record) -> Value {
    let kind = crate::common::kind(r);
    json!({ "id": r.id, "record": r.body.kind_name(), "kind": kind, "at": r.at, "speaks_for": r.speaks_for, "addressed_to": addressed_to(r), "data": data(r) })
}

/// What a grievance a person holds is, for the particulars of an application.
#[derive(Debug, Clone, Default)]
pub struct Particulars<'a> {
    pub matter: &'a str,
    pub party: &'a str,
    pub since: i64,
    pub about: Option<&'a str>,
    pub amount: Option<i64>,
    pub structure: Option<&'a str>,
    pub seeks: Option<&'a str>,
    /// When the other side was asked.
    pub asked: Option<i64>,
    /// How they answered: `refused`, `ignored` or `granted`.
    pub answer: Option<&'a str>,
}

/// What a person who applies to a venue states about what they apply for, from their own record: the dispute (what it is,
/// against whom, about which paper or place), the sum if their record shows one, what they seek, and the dates (when it
/// arose, when they asked the other side and what came of it). A real application form asks for exactly this, and a venue
/// turns away one that says nothing (docs/behaviour/justice.md, "Particulars"). A sum is stated only where the person's
/// record has one: nothing is made up for them.
pub fn particulars_of(g: &Particulars, t: i64, world: &WorldInfo) -> String {
    let words = g.matter.replace('_', " ");
    let before = |s: i64| format!("{} days before the year began", (-s + DAY - 1).div_euclid(DAY));
    let arose = if g.since < 0 { before(g.since) } else { format!("on {}", when_words(g.since, world)) };
    let asked = match g.asked {
        Some(a) => format!(
            "we asked them {}{}",
            if a < 0 { before(a) } else { format!("on {}", when_words(a, world)) },
            match g.answer {
                Some("refused") => " and they refused",
                Some("ignored") => " and they have not answered",
                Some("granted") => " and they agreed, but it is not done",
                _ => "",
            }
        ),
        None => "we have not yet asked them".to_string(),
    };
    format!(
        "{words} against {}{}{}{}{}; it arose {arose}; {asked}; made on {}.",
        g.party,
        g.about.map(|a| format!(", about {a}")).unwrap_or_default(),
        g.structure.map(|s| format!(", at {s}")).unwrap_or_default(),
        g.seeks.map(|s| format!("; what we seek: {}", s.replace('_', " "))).unwrap_or_default(),
        g.amount.filter(|a| *a != 0).map(|a| format!("; the sum: {}", money_words(a, world))).unwrap_or_default(),
        when_words(t, world)
    )
}

/// Whether an application says what it is about: it gives its particulars, or names a paper, a place, a sum, what is
/// sought, or evidence.
pub fn has_particulars(d: &Value) -> bool {
    d.s("particulars").is_some_and(|p| !p.trim().is_empty())
        || d.get("about").is_some_and(|v| !v.is_null())
        || d.get("structure").is_some_and(|v| !v.is_null())
        || d.get("seeks").is_some_and(|v| !v.is_null())
        || d.i("amount").is_some_and(|a| a > 0)
        || d.get("evidence").is_some_and(|v| !v.is_null())
}

/// Whether a response on file answers an application (the latest from the respondent).
pub fn response_to<'a>(book: &'a Book, kind: &str, application: &str, from: &str) -> Option<&'a std::sync::Arc<Record>> {
    book.open(kind)
        .filter(|r| crate::common::cites(r, application) && r.speaks_for.as_deref() == Some(from))
        .max_by(|a, b| a.at.cmp(&b.at).then_with(|| crate::common::filed_before(&b.id, &a.id)))
}

pub fn days(seconds: i64) -> i64 {
    seconds.div_euclid(DAY)
}

trait AsI64 {
    fn i64(&self) -> Option<i64>;
}
impl AsI64 for Value {
    fn i64(&self) -> Option<i64> {
        crate::papers::lenient::whole(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finance::kit::{arg, book_of, json_arg, statement, Stand, DAY};
    use oikos_sight::calls::Call;

    #[test]
    fn a_yearly_rate_becomes_a_periods_chance_in_whole_numbers_scaled_by_the_dial_and_nothing_with_the_dial_off() {
        assert_eq!(chance_ppm(3_650, 1, 10_000), 1_000, "36.5% a year: one in a thousand a day");
        assert_eq!(chance_ppm(3_650, 1, 20_000), 2_000);
        assert_eq!(chance_ppm(3_650, 1, 0), 0);
        assert_eq!(chance_ppm(0, 30, 10_000), 0);
        assert_eq!(chance_ppm(10_000, 3_650, 10_000), 1_000_000, "never over certainty");
        assert_eq!(friction_dial(&json!({})), 0);
        assert_eq!(friction_dial(&json!({ "friction_bps": 5_000 })), 5_000);
        assert_eq!(friction_dial(&json!({ "friction_bps": -5 })), 0);
    }

    #[test]
    fn a_rate_is_swayed_by_character_symmetrically_clamped_and_held_between_nothing_and_certainty() {
        assert_eq!(swayed(5_000, 0, 500), 5_000);
        assert_eq!(swayed(5_000, 1_000, 500), 7_500, "a standard deviation up moves it by half the rate");
        assert_eq!(swayed(5_000, -1_000, 500), 2_500);
        assert_eq!(swayed(5_000, 10_000, 500), 10_000, "the deviation is clamped to three, and the rate to certainty");
        assert_eq!(swayed(5_000, -10_000, 500), 0);
        assert_eq!(swayed(3_333, 1_000, 500), 4_999 + 1, "rounded half up");
    }

    fn truth_of(t: Option<Truth>) -> Fixed {
        Fixed(t)
    }
    struct Fixed(Option<Truth>);
    impl Answerer<()> for Fixed {
        fn truth(&mut self, _: &Matter, _: &str, _: &Book, _: i64) -> Option<Truth> {
            self.0
        }
    }
    fn request(id: &str, data: Value) -> Value {
        statement(id, DAY, paper::REQUEST, json!({ "author": "c1-self", "speaks_for": "c1", "addressed_to": ["shop-1"], "visible_to": ["c1", "shop-1"] }), data)
    }
    fn said(steps: Vec<Step<()>>) -> Vec<Call> {
        steps.into_iter().flat_map(|s| s.lines.into_iter().map(|l| l.call)).collect()
    }
    fn run(r: &mut Respondent, rs: Vec<Value>, t: i64, balance: i64, with: &mut Fixed) -> Vec<Call> {
        let mut stand = Stand::new("shop-1");
        let b = book_of("shop-1", rs);
        let mut cx = stand.cx(t);
        said(r.steps(&mut cx, &b, t, Some("acc-shop-1"), balance, None, with))
    }
    fn answer_of(said: &[Call]) -> Value {
        json_arg(said.iter().find(|c| arg(c, "kind").is_some()).unwrap(), "data")
    }

    #[test]
    fn asked_to_put_right_what_its_books_say_it_owes_an_organisation_that_will_pays_exactly_that_and_says_so_one_that_will_not_says_no_or_nothing() {
        let mut yes = Respondent::new("shop-1", &json!({ "grant_bps": { "underpaid": 10_000 } }), vec![], true);
        let mut with = truth_of(Some(Truth { owed: Some(4_200), ..Default::default() }));
        let s = run(&mut yes, vec![request("r1", json!({ "matter": "underpaid", "about": "J1", "amount": 9_999, "account": "acc-c1" }))], 2 * DAY, 1_000_000, &mut with);
        assert_eq!(s.iter().filter(|c| c.fn_ == "money").map(|c| (arg(c, "to").unwrap(), arg(c, "amount").unwrap(), arg(c, "settles").unwrap())).collect::<Vec<_>>(), [("acc-c1".to_string(), "$42.00".to_string(), "r1".to_string())]);
        assert_eq!(answer_of(&s), json!({ "request": "r1", "matter": "underpaid", "granted": true, "amount": 4_200 }));
        // Once: the same request on file again is not answered twice.
        let mut no = Respondent::new("shop-1", &json!({ "grant_bps": { "underpaid": 0 }, "answers_bps": 10_000 }), vec![], true);
        let rs = vec![request("r1", json!({ "matter": "underpaid", "about": "J1", "amount": 4_200, "account": "acc-c1" }))];
        let n = run(&mut no, rs.clone(), 2 * DAY, 1_000_000, &mut with);
        assert!(n.iter().all(|c| c.fn_ != "money"));
        assert_eq!(answer_of(&n)["granted"], false);
        assert!(run(&mut no, rs.clone(), 3 * DAY, 1_000_000, &mut with).is_empty());
        let mut silent = Respondent::new("shop-1", &json!({ "grant_bps": { "underpaid": 0 }, "answers_bps": 0 }), vec![], true);
        assert!(run(&mut silent, rs, 2 * DAY, 1_000_000, &mut with).is_empty());
        assert_eq!(silent.counts["remedy_ignored"], 1);
    }

    #[test]
    fn its_books_showing_nothing_owed_it_says_so_and_pays_nothing_however_willing_what_it_cannot_know_it_takes_on_the_askers_word_if_it_will_what_it_cannot_pay_it_does_not_grant() {
        let will = json!({ "grant_bps": { "other": 10_000 } });
        let mut r = Respondent::new("shop-1", &will, vec![], true);
        let nothing = run(&mut r, vec![request("r1", json!({ "matter": "underpaid", "amount": 500, "account": "acc-c1" }))], DAY, 1_000_000, &mut truth_of(Some(Truth { owed: Some(0), ..Default::default() })));
        assert!(nothing.iter().all(|c| c.fn_ != "money"));
        assert_eq!(answer_of(&nothing), json!({ "request": "r1", "matter": "underpaid", "granted": false, "reason": "nothing owed on our records" }));
        let mut r = Respondent::new("shop-1", &will, vec![], true);
        let word = run(&mut r, vec![request("r2", json!({ "matter": "goods", "amount": 700, "account": "acc-c1" }))], DAY, 1_000_000, &mut truth_of(None));
        assert_eq!(word.iter().filter(|c| c.fn_ == "money").map(|c| arg(c, "amount").unwrap()).collect::<Vec<_>>(), ["$7.00"]);
        let mut r = Respondent::new("shop-1", &json!({ "grant_bps": { "other": 10_000 }, "answers_bps": 10_000 }), vec![], true);
        let broke = run(&mut r, vec![request("r3", json!({ "matter": "goods", "amount": 700, "account": "acc-c1" }))], DAY, 100, &mut truth_of(None));
        assert!(broke.iter().all(|c| c.fn_ != "money"), "what it cannot pay it does not grant");
    }

    #[test]
    fn told_of_a_complaint_it_answers_a_venue_from_its_books_ordered_to_pay_one_that_obeys_pays_the_order_and_one_that_does_not_pays_nothing() {
        let notice = statement("n1", DAY, paper::NOTICE, json!({ "speaks_for": "ombudsman", "addressed_to": ["c1", "shop-1"], "visible_to": ["c1", "shop-1", "ombudsman"], "basis": "a1" }),
            json!({ "application": "a1", "matter": "underpaid", "applicant": "c1", "against": "shop-1", "about": "J1" }));
        let mut r = Respondent::new("shop-1", &json!({ "responds_bps": 10_000 }), vec![], true);
        let a = run(&mut r, vec![notice], 2 * DAY, 1_000_000, &mut truth_of(Some(Truth { owed: Some(4_200), ..Default::default() })));
        assert_eq!(a.iter().map(|c| (arg(c, "kind").unwrap(), json_arg(c, "to"), json_arg(c, "data"))).collect::<Vec<_>>(), [(paper::RESPONSE.to_string(), json!(["ombudsman"]), json!({ "application": "a1", "owed": 4_200, "known": true }))]);
        let order = statement("d1", 20 * DAY, paper::DECISION, json!({ "speaks_for": "ombudsman", "addressed_to": ["c1", "shop-1"], "visible_to": ["c1", "shop-1", "ombudsman"], "basis": "a1" }),
            json!({ "application": "a1", "matter": "underpaid", "applicant": "c1", "against": "shop-1", "finding": "pay", "amount": 4_200, "to": "acc-c1", "binding": true }));
        let mut obeys = Respondent::new("shop-1", &json!({ "comply_bps": 10_000 }), vec![], true);
        let paid = run(&mut obeys, vec![order.clone()], 21 * DAY, 1_000_000, &mut truth_of(None));
        assert_eq!(paid.iter().filter(|c| c.fn_ == "money").map(|c| (arg(c, "to").unwrap(), arg(c, "amount").unwrap(), arg(c, "settles").unwrap())).collect::<Vec<_>>(), [("acc-c1".to_string(), "$42.00".to_string(), "d1".to_string())]);
        assert_eq!(obeys.counts["order_obeyed"], 1);
        let mut defies = Respondent::new("shop-1", &json!({ "comply_bps": 0 }), vec![], true);
        assert!(run(&mut defies, vec![order], 21 * DAY, 1_000_000, &mut truth_of(None)).is_empty());
        assert_eq!(defies.counts["order_defied"], 1);
    }

    struct Lively(i64, i64, i64);
    impl Character for Lively {
        fn lively(&self) -> bool {
            true
        }
        fn keep(&self) -> i64 {
            self.0
        }
        fn standing(&self) -> i64 {
            self.1
        }
        fn pay_less(&self) -> i64 {
            self.2
        }
        fn count(&mut self, _: &str) {}
        fn remember(&mut self, _: i64, _: &str, _: &str) {}
    }

    #[test]
    fn character_sways_whether_it_grants_one_that_keeps_those_it_deals_with_grants_more_often_than_one_that_pays_less() {
        // Over many requests at a town rate of one half, a keeper (+3 sd) grants about 50% x 2.5 = all, a skinflint (-3 sd) about none.
        let grants = |lean: (i64, i64, i64)| {
            let mut r = Respondent::new("shop-1", &json!({ "grant_bps": { "other": 5_000 }, "answers_bps": 0 }), vec![], true);
            let mut stand = Stand::new("shop-1");
            let mut n = 0;
            for i in 0..200 {
                let b = book_of("shop-1", vec![request(&format!("r{i}"), json!({ "matter": "goods", "amount": 100, "account": "acc-c1" }))]);
                let mut c = Lively(lean.0, lean.1, lean.2);
                let mut cx = stand.cx(i * DAY);
                let s = said(r.steps(&mut cx, &b, i * DAY, Some("acc-shop-1"), 1_000_000, Some(&mut c), &mut truth_of(None)));
                n += s.iter().filter(|c| c.fn_ == "money").count();
                r = Respondent::new("shop-1", &json!({ "grant_bps": { "other": 5_000 }, "answers_bps": 0 }), vec![], true);
            }
            n
        };
        let (keeper, neutral, skinflint) = (grants((3_000, 3_000, 0)), grants((0, 0, 0)), grants((-3_000, -3_000, 3_000)));
        assert!(keeper > neutral && neutral > skinflint, "{keeper} {neutral} {skinflint}");
        assert!(keeper > 150 && skinflint < 40, "{keeper} {skinflint}");
    }

    #[test]
    fn what_a_person_states_in_an_application_is_from_their_own_record_and_a_venue_turns_away_one_that_says_nothing() {
        let world = crate::finance::kit::test_money();
        let g = Particulars { matter: "underpaid", party: "shop-1", since: 5 * DAY, about: Some("J1"), amount: Some(9_000), structure: None, seeks: Some("pay_owed"), asked: Some(6 * DAY), answer: Some("refused") };
        let words = particulars_of(&g, 20 * DAY, &world);
        assert_eq!(words, "underpaid against shop-1, about J1; what we seek: pay owed; the sum: $90.00; it arose on year 1, day 6; we asked them on year 1, day 7 and they refused; made on year 1, day 21.");
        let before = Particulars { since: -3 * DAY - 1, asked: None, amount: None, about: None, seeks: None, ..g.clone() };
        assert_eq!(particulars_of(&before, DAY, &world), "underpaid against shop-1; it arose 4 days before the year began; we have not yet asked them; made on year 1, day 2.");
        assert!(has_particulars(&json!({ "particulars": "x" })) && has_particulars(&json!({ "about": "J1" })) && has_particulars(&json!({ "amount": 5 })) && has_particulars(&json!({ "evidence": { "order": "o" } })));
        assert!(!has_particulars(&json!({ "matter": "underpaid", "against": "shop-1" })) && !has_particulars(&json!({ "particulars": "  ", "amount": 0 })));
    }

    #[test]
    fn a_respondent_saves_and_restores_exactly_and_does_not_answer_twice() {
        let mut r = Respondent::new("shop-1", &json!({ "grant_bps": { "other": 10_000 } }), vec![], true);
        let rs = vec![request("r1", json!({ "matter": "goods", "amount": 100, "account": "acc-c1" }))];
        assert_eq!(run(&mut r, rs.clone(), DAY, 1_000_000, &mut truth_of(None)).len(), 2);
        let mut back: Respondent = serde_json::from_value(serde_json::to_value(&r).unwrap()).unwrap();
        assert!(run(&mut back, rs, 2 * DAY, 1_000_000, &mut truth_of(None)).is_empty());
    }
}
