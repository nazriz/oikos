//! Recourse (citizen.ts): grievances and what is asked of whoever did wrong, answers to what we asked, a caseload
//! from before the year, disrepair, complaints about a service, the tribunal, carrying out the ways the mind chose for
//! its wants, and the openings life offers for a want (docs/behaviour/frictions.md, justice.md, services.md).
//!
//! Ported from citizen.ts: the `Grievance` map and `grieve`'s life half (520-524, 701-718), `waysFor`'s life ways
//! (2119-2298), what was asked of the other party and their answers (2811-2833), the opening caseload and the answers
//! and decisions on a grievance (2850-2911), a grievance's upkeep (3144-3180), disrepair (3196-3209), complaining of a
//! service (3490-3530) and the tribunal (4510-4548). What the mind owns stays out: wants met, given up and pursued again
//! (TS `wantMet`, `giveUp`, `again`), ties, feelings, the reading dial's bump and culture's record are the mind's, told
//! by the outcomes and treatments sent here.
//!
//! Decided fresh (docs/port-guide.md, section 2): grievances are kept by key (`matter:about-or-party`) and walked in key
//! order, not in the order they arose (TS's Map), so the first of several that match an answer is the first by key; a
//! way's money test reads the picture's balance (TS: the plan's, as spent so far); whether a notice of rent increase
//! breaks the law is read once, as the notice first comes (`answers`), since the ways are offered while the book cannot
//! be written; a complaint not written is recorded against the norm only the first time (TS also recorded a later
//! letter written); TS's "inner.experience" weight 2 is `weight_bps` 20,000.

use super::mind::{ConductAsk, Event, GrievanceView, Intent, Opening, Openings, Outcome, Treated, WantView, Way};
use super::params::Params;
#[allow(unused_imports)]
use super::person::{Person, Todo, Week};
use crate::common::{addressed_to, data, kind, money_words, when_words, ClaimKey, Fields, DAY, MONTH};
use crate::steps::{because, pay, say, Pay, Say, Visible};
use crate::Cx;
use oikos_sight::{Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// The papers a grievance travels on (frictions.ts `PAPER`, decisions.ts `KIND`).
pub mod paper {
    pub const REQUEST: &str = "review_request";
    pub const ANSWER: &str = "remedy_answer";
    pub const APPLICATION: &str = "application";
    pub const DECISION: &str = "venue_decision";
    pub const EVIDENCE_REQUEST: &str = "evidence_request";
    pub const EVIDENCE: &str = "evidence";
}

/// Telling someone we know that someone has done wrong by us (citizen.ts `WRONGED.say`; the mind reads it heard).
pub fn wronged_say(matter: &str, by: &str) -> String {
    format!("{by} has done wrong by me ({}).", matter.replace('_', " "))
}

/// A venue a grievance was taken to: when, and what it found.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Applied {
    pub t: i64,
    pub finding: Option<String>,
}

/// What a venue ordered or recommended on a grievance.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ordered {
    pub id: String,
    pub by: String,
    pub binding: bool,
    pub due: i64,
    pub amount: i64,
    pub enforced: bool,
}

/// Something gone wrong for us at someone's hands, held until it is put right or let go (citizen.ts `Grievance`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Grievance {
    pub key: String,
    pub matter: String,
    pub party: String,
    pub since: i64,
    pub about: Option<String>,
    pub amount: Option<i64>,
    pub structure: Option<String>,
    /// In a word, what is sought where it is not money (`repair`; for a refused claim, the payment).
    pub seeks: Option<String>,
    /// The paper we would show for it (frictions.ts `tendered`).
    pub evidence: Option<Value>,
    /// When we asked the other side to put it right; what they said, and when.
    pub asked: Option<i64>,
    pub answer: Option<String>,
    pub answered_at: Option<i64>,
    /// Said yes, when (and not yet done).
    pub promised: Option<i64>,
    /// The venues we took it to.
    pub applied: BTreeMap<String, Applied>,
    pub ordered: Option<Ordered>,
    pub told: bool,
}

/// A grievance's key (citizen.ts `gkey`).
pub fn gkey(matter: &str, party: &str, about: Option<&str>) -> String {
    format!("{matter}:{}", about.unwrap_or(party))
}

/// A paper as tendered to a venue (frictions.ts `tendered`).
pub fn tendered(r: &Record) -> Value {
    let k = kind(r);
    json!({ "id": r.id, "record": r.body.kind_name(), "kind": k, "at": r.at, "speaks_for": r.speaks_for, "addressed_to": addressed_to(r), "data": data(r) })
}

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Recourse {
    /// What has gone wrong for us and is not yet put right (work and money raise them with `grieve`).
    pub grievances: BTreeMap<String, Grievance>,
    /// Requests for papers for a claim of ours, answered.
    evidence_sent: BTreeSet<String>,
    /// Notices of rent increase taken to the tribunal by a way chosen (housing keeps those it weighed itself).
    pub challenged: BTreeSet<String>,
    /// Notices of rent increase that break the law as we read it, read when each came.
    breaching: BTreeSet<String>,
    /// Debts owed us we have weighed applying over; tribunal orders we have dealt with.
    pursued: BTreeSet<String>,
    enforcing: BTreeSet<String>,
    /// Debts owed us paid in full, told to the mind.
    settled_told: BTreeSet<String>,
    /// The home we have complained about, until it is seen to; homes noted as not written about.
    complained_of: Option<String>,
    complain_noted: BTreeSet<String>,
    /// Notices to vacate whose lapse the mind has been told (housing's `notice_over`).
    lapsed_told: BTreeSet<String>,
    /// Willing to sign a petition at all (citizen.ts `willing`, drawn once on "petition-willing").
    willing: bool,
    /// The wants' and goals' figures life's ways use (the mind's parameters, read where life needs them).
    ask_again_days: i64,
    rise_bps: i64,
    cheaper_bps: i64,
}

impl Recourse {
    pub fn new(p: &Params, cx: &mut Cx) -> Self {
        let params = &cx.ctx.params;
        let wants = |k: &str, d: i64| params.get("wants").and_then(|w| w.get(k)).and_then(crate::papers::lenient::whole).unwrap_or(d);
        let cheaper_bps = params.get("goals").and_then(|g| g.get("cheaper_bps")).and_then(crate::papers::lenient::whole).unwrap_or(9_000);
        let (ask_again_days, rise_bps) = (wants("ask_again_days", 365), wants("rise_bps", 500));
        let willing = (cx.rng("petition-willing").below(10_000) as i64) < p.petition_willing_bps;
        Recourse { willing, ask_again_days, rise_bps, cheaper_bps, ..Default::default() }
    }
}

// ------------------------------------------------------------------ small readings

fn facts(v: Value) -> BTreeMap<String, Value> {
    match v {
        Value::Object(m) => m.into_iter().collect(),
        _ => BTreeMap::new(),
    }
}

fn offer_of(r: &Record) -> Option<&Value> {
    match &r.body {
        RecordBody::Statement { offer, .. } => offer.as_ref(),
        _ => None,
    }
}

fn is_statement(r: &Record) -> bool {
    matches!(r.body, RecordBody::Statement { .. })
}

/// The world's friction dial (frictions.ts `frictionDial`).
fn friction_dial(cx: &Cx) -> i64 {
    cx.ctx.world.dials.get("friction_bps").and_then(crate::papers::lenient::whole).unwrap_or(0).max(0)
}

/// What an offer would bring, in the typed outcomes a want seeks (wants.ts `bringsOf`, without what it asks now).
pub fn brings_of(offer: Option<&Value>) -> Vec<String> {
    let mut out = BTreeSet::new();
    let none = vec![];
    let cs = offer.and_then(|o| o.get("terms")).and_then(|t| t.get("commitments")).and_then(Value::as_array).unwrap_or(&none);
    for c in cs {
        let Some(o) = c.get("does").and_then(|d| d.get("outcome")) else { continue };
        let taker = c.s("who") == Some("taker");
        if o.get("money").is_some() && !taker {
            out.insert("money.to");
        }
        if o.get("occupancy").is_some() {
            out.insert(if taker { "work" } else { "occupancy" });
        }
        if o.get("work").is_some() && taker {
            out.insert("work");
        }
        if o.get("goods").is_some() && !taker {
            out.insert("goods");
        }
        if o.get("attend").is_some() {
            out.insert("attend");
        }
    }
    ["money.to", "money.from", "occupancy", "work", "attend", "goods"].iter().filter(|k| out.contains(*k)).map(|k| k.to_string()).collect()
}

/// The law's route for a decision of this kind (decisions.ts `decisionLaw`): a rule for named payments wins over one
/// for the kind; of equals, the latest.
fn decision_law(book: &crate::common::Book, kind_: &str, payment: Option<&str>) -> Option<Value> {
    let mut best: Option<(i64, Value)> = None;
    for l in book.open("law") {
        let Some(list) = data(l).get("decisions").and_then(Value::as_array) else { continue };
        for d in list {
            if d.s("kind") != Some(kind_) {
                continue;
            }
            let pays = d.get("payments").and_then(Value::as_array);
            let fits = pays.is_none_or(|ps| payment.is_some_and(|p| ps.iter().any(|x| x.as_str() == Some(p))));
            if !fits {
                continue;
            }
            let score = (if pays.is_some() { 1_000_000_000_000 } else { 0 }) + l.at;
            if best.as_ref().is_none_or(|(b, _)| score > *b) {
                best = Some((score, d.clone()));
            }
        }
    }
    best.map(|b| b.1)
}

/// Days left of `within_days` from `from` (decisions.ts `daysLeft`).
fn days_left(from: i64, within_days: i64, t: i64) -> i64 {
    within_days - (t - from).div_euclid(DAY)
}

/// What an applicant states of a grievance, from their own record (frictions.ts `particularsOf`).
pub fn particulars_of(g: &Grievance, t: i64, world: &crate::WorldInfo) -> String {
    let words = g.matter.replace('_', " ");
    let when = |x: i64| if x < 0 { when_words(x, world) } else { format!("on {}", when_words(x, world)) };
    let asked = match g.asked {
        Some(a) => format!(
            "we asked them {}{}",
            when(a),
            match g.answer.as_deref() {
                Some("refused") => " and they refused",
                Some("ignored") => " and they have not answered",
                Some("granted") => " and they agreed, but it is not done",
                _ => "",
            }
        ),
        None => "we have not yet asked them".into(),
    };
    let mut s = format!("{words} against {}", g.party);
    if let Some(a) = &g.about {
        s += &format!(", about {a}");
    }
    if let Some(st) = &g.structure {
        s += &format!(", at {st}");
    }
    if let Some(k) = &g.seeks {
        s += &format!("; what we seek: {}", k.replace('_', " "));
    }
    if let Some(a) = g.amount.filter(|a| *a != 0) {
        s += &format!("; the sum: {}", money_words(a, world));
    }
    format!("{s}; it arose {}; {asked}; made on {}.", when(g.since), when_words(t, world))
}

/// Half away from zero (TS `Math.round` of a value of either sign, near enough for these).
fn div_round(n: i64, d: i64) -> i64 {
    if n >= 0 {
        (2 * n + d) / (2 * d)
    } else {
        -((-2 * n + d) / (2 * d))
    }
}

impl Person {
    /// What kind of institution someone is to us (citizen.ts `kindOf`).
    fn recourse_kind_of(&self, who: &str, params: &crate::Params) -> String {
        if let Some(k) = params.get("institutions").and_then(|i| i.get(who)).and_then(Value::as_str) {
            return k.to_string();
        }
        let p = &self.p;
        let is = |o: Option<&str>| o == Some(who);
        if is(p.bank.as_deref()) {
            "banks"
        } else if is(p.union.as_deref()) {
            "unions"
        } else if is(p.complain_to.as_deref()) || is(p.electoral_town.as_deref()) {
            "government"
        } else if is(p.tribunal.as_ref().map(|t| t.entity.as_str())) {
            "courts"
        } else if is(p.welfare.as_ref().map(|w| w.police.as_str())) {
            "policing"
        } else if is(p.paper.as_deref()) {
            "press"
        } else if is(p.care.as_ref().map(|c| c.entity.as_str())) || is(p.school.as_ref().map(|s| s.entity.as_str())) {
            "civil_service"
        } else if self.s.employers.contains(who) {
            "companies"
        } else {
            "other"
        }
        .to_string()
    }
    /// A venue's kind, where it is nothing else to us: an office (citizen.ts `civil`).
    fn civil(&self, who: &str, params: &crate::Params) -> String {
        match self.recourse_kind_of(who, params) {
            k if k == "other" => "civil_service".into(),
            k => k,
        }
    }
    fn usd_of(w: &Week, n: i64) -> String {
        money_words(n, &w.cx.ctx.world)
    }
    /// What has been paid to us against a debt or an order (absorb's `settled_to_us`).
    pub fn absorbed_settled(&self, id: &str) -> i64 {
        self.absorbed.settled_to_us.get(id).copied().unwrap_or(0)
    }
    /// The records new since the last plan (absorb's `fresh`), in the order taken in.
    fn recourse_fresh(&self) -> Vec<Arc<Record>> {
        self.absorbed.fresh.iter().filter_map(|id| self.book.get(id).cloned()).collect()
    }
    #[allow(clippy::too_many_arguments)]
    fn treat(&mut self, w: &mut Week, who: &str, good: bool, weight: bool, tried: bool, paper: Option<&str>, kind_: Option<String>) {
        let k = kind_.unwrap_or_else(|| self.recourse_kind_of(who, &w.cx.ctx.params));
        self.treated(w, Treated { who: who.into(), kind: k, good, weight_bps: weight.then_some(20_000), tried, paper: paper.map(String::from), ..Default::default() });
    }
    /// A decision that reached us after we asked or applied (citizen.ts `landing` with `tried` and `trust`): trust in whoever
    /// decided moves by `weight_bps` (granted 2, refused 1, in TS's weights), and so does the sense of agency: something
    /// we tried that worked, or that failed, whichever it was. (`treat`'s `tried` cannot say "tried and failed".)
    #[allow(clippy::too_many_arguments)]
    fn treat_landing(&mut self, w: &mut Week, who: &str, good: bool, weight_bps: i64, paper: Option<&str>, kind_: Option<String>, tie: Option<(i64, &'static str)>) {
        let k = kind_.unwrap_or_else(|| self.recourse_kind_of(who, &w.cx.ctx.params));
        self.treated(w, Treated { who: who.into(), kind: k, good, weight_bps: Some(weight_bps), tried: true, paper: paper.map(String::from), tie, ..Default::default() });
    }
    fn way_outcome(&mut self, w: &mut Week, option: &str, kind_: &str, from: &str, payoff: i64, f: Value) {
        self.tell(w, Outcome { domain: "way".into(), option: option.into(), kind: kind_.into(), way: Way::Mine, from: Some(from.into()), facts: facts(f), payoff: Some(payoff), ..Default::default() });
    }

    // ------------------------------------------------------------------ grievances (citizen.ts 701-718)

    /// Something has gone wrong for us at someone's hands (docs/behaviour/frictions.md): held until it is put right or
    /// let go, and told to the mind the first time (it records it arising, trust and agency move, a want is born).
    /// Held already, only its sum is brought up to date. `size_bps` 6,000 and `need` security where TS gave none.
    #[allow(clippy::too_many_arguments)]
    pub fn grieve(
        &mut self,
        w: &mut Week,
        matter: &str,
        party: &str,
        about: Option<&str>,
        amount: Option<i64>,
        structure: Option<&str>,
        size_bps: i64,
        need: &str,
        cause: Option<&str>,
    ) -> &mut Grievance {
        let key = gkey(matter, party, about);
        if !self.recourse.grievances.contains_key(&key) {
            let g = Grievance {
                key: key.clone(),
                matter: matter.into(),
                party: party.into(),
                since: w.t,
                about: about.map(String::from),
                amount,
                structure: structure.map(String::from),
                ..Default::default()
            };
            self.recourse.grievances.insert(key.clone(), g);
            self.happened(
                w,
                Event::Grieved {
                    matter: matter.into(),
                    party: party.into(),
                    about: about.map(String::from),
                    amount,
                    structure: structure.map(String::from),
                    size_bps,
                    need: need.into(),
                    cause: cause.map(String::from),
                },
            );
        }
        let g = self.recourse.grievances.get_mut(&key).unwrap_or_else(|| unreachable!());
        if amount.is_some() {
            g.amount = amount;
        }
        g
    }

    /// A grievance over (citizen.ts `ended`): told to the mind, whose want it was (met, or given up).
    fn ended(&mut self, w: &mut Week, key: &str, how: &str, good: bool) {
        let Some(g) = self.recourse.grievances.remove(key) else { return };
        let mut f = json!({ "how": how, "put_right": good, "days": (w.t - g.since).div_euclid(DAY), "asked": g.asked.is_some(), "venues": g.applied.len() });
        if let Some(a) = &g.answer {
            f["answer"] = json!(a);
        }
        if let Some(a) = g.amount {
            f["amount"] = json!(a);
        }
        self.tell(w, Outcome { domain: "friction".into(), option: g.matter.clone(), kind: "ended".into(), way: Way::Mine, from: Some(g.party.clone()), facts: facts(f), ..Default::default() });
        self.friction_ended(w, &g, how, if good { "good" } else { "given_up" });
    }

    /// A grievance over, told to the mind: its note (how it ended, whether we asked and what came of it, how many
    /// venues) and the want it was, met or given up (`met`: "good" as `wantMet`, "met" as `wants.met`, else given up).
    fn friction_ended(&mut self, w: &mut Week, g: &Grievance, how: &str, met: &str) {
        let asked = if g.asked.is_some() { format!("; asked: {}", g.answer.as_deref().unwrap_or("no answer yet")) } else { String::new() };
        let venues = if g.applied.is_empty() { String::new() } else { format!("; venues: {}", g.applied.len()) };
        let f = facts(json!({ "matter": g.matter, "how": how, "met": met, "days": (w.t - g.since).div_euclid(DAY), "by": format!("{how}{asked}{venues}") }));
        self.happened(w, Event::Other { what: "friction_ended".into(), about: Some(g.about.clone().unwrap_or_else(|| g.party.clone())), facts: f });
    }

    /// A refused claim granted after all (money's claims, citizen.ts 3647-3652): its grievances are over.
    pub fn refusals_granted(&mut self, w: &mut Week, payment: &str) {
        let keys: Vec<String> = self.recourse.grievances.values().filter(|g| g.matter == "claim_refused" && g.seeks.as_deref() == Some(payment)).map(|g| g.key.clone()).collect();
        for k in keys {
            let Some(g) = self.recourse.grievances.remove(&k) else { continue };
            let f = json!({ "how": "granted on review", "put_right": true, "days": (w.t - g.since).div_euclid(DAY), "asked": g.asked.is_some(), "venues": g.applied.len() });
            self.tell(w, Outcome { domain: "friction".into(), option: g.matter.clone(), kind: "ended".into(), way: Way::Mine, from: Some(g.party.clone()), facts: facts(f), ..Default::default() });
            self.friction_ended(w, &g, "granted on review", "met");
        }
    }

    /// A refusal set aside: the claim is ours to make again (money's record of refusals).
    fn refusal_cleared(&mut self, seeks: Option<&str>) {
        if let Some(s) = seeks {
            self.money.refused_at.remove(s);
            self.money.refused_on.remove(s);
        }
    }

    // ------------------------------------------------------------------ answers to what we asked (citizen.ts 2811-2833)

    /// An answer to something we asked of the other party to an agreement: granted (the paper withdrawn, the wage
    /// raised) or not; either way we learn what asking them is worth. Refused, a paper we asked about stands.
    pub fn answers(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let fresh = self.recourse_fresh();
        // (Whether a notice of rent increase breaks the law, read as it comes: the ways for a want read it later.)
        if self.p.tribunal.is_some() {
            for r in &fresh {
                if !is_statement(r) || kind(r) != Some("rent_increase") || !addressed_to(r).contains(&me) {
                    continue;
                }
                let Some(by) = r.speaks_for.clone() else { continue };
                let act = json!({ "block": "publish", "kind": "rent_increase", "data": data(r).clone() });
                if !crate::common::breaches(&mut self.book, &act, &by, r.at).is_empty() {
                    self.recourse.breaching.insert(r.id.clone());
                }
            }
        }
        for r in &fresh {
            if !is_statement(r) || kind(r) != Some("variation_answer") || !addressed_to(r).contains(&me) {
                continue;
            }
            let d = data(r).clone();
            let about = d.s("about").unwrap_or_default().to_string();
            let by = r.speaks_for.clone().unwrap_or_else(|| r.author.clone());
            let ok = d.flag("granted");
            self.way_outcome(w, "ask", if ok { "granted" } else { "refused" }, &by, if ok { 10_000 } else { 1_000 }, json!({ "about": about }));
            // (TS's `landing` and the tie: the mind moves trust and the tie from how we were treated.)
            self.treat_landing(w, &by, ok, if ok { 20_000 } else { 10_000 }, Some(&r.id), None, Some(if ok { (1_500, "granted") } else { (-500, "refused") }));
            let rise = d.i("wage").filter(|wg| ok && self.s.job.as_ref().is_some_and(|j| j.employer == by && j.agreement == about && *wg > j.wage));
            if let (Some(wage), Some(j)) = (rise, self.s.job.clone()) {
                self.tell(w, Outcome { domain: "job".into(), option: j.employer.clone(), kind: "rise".into(), way: Way::Mine, facts: facts(json!({ "wage": wage, "was": j.wage, "asked": true })), ..Default::default() });
                if let Some(j) = self.s.job.as_mut() {
                    j.wage = wage;
                    j.paid_at = Some(t);
                }
            }
            if self.s.asked_of.remove(&about).is_some() && !ok {
                self.housing.upheld.push(about);
            }
        }
    }

    // ------------------------------------------------------------------ a caseload from before (citizen.ts 2850-2911)

    /// A grievance already put when the year began (an opening caseload: a request or an application of ours made
    /// before it, brought forward on paper), then what came back on our grievances: papers asked for a claim of ours,
    /// the other side's answer, a venue's decision.
    pub fn opening_caseload(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let fresh = self.recourse_fresh();
        let dial = friction_dial(w.cx);
        if dial > 0 {
            for r in &fresh {
                let k = kind(r);
                let d = data(r).clone();
                if !is_statement(r) || !d.flag("brought_forward") || r.speaks_for.as_deref() != Some(me.as_str()) || (k != Some(paper::REQUEST) && k != Some(paper::APPLICATION)) {
                    continue;
                }
                let matter = d.s("matter").or(d.s("kind")).unwrap_or_default().to_string();
                let to0 = addressed_to(r).first().cloned();
                let party = d.s("against").map(String::from).or(to0.clone()).unwrap_or_default();
                let since = d.i("since").unwrap_or(r.at);
                if matter.is_empty() || party.is_empty() {
                    continue;
                }
                let g = self.grieve(w, &matter, &party, d.s("about"), None, d.s("structure"), 6_000, "security", None);
                if let Some(s) = d.s("seeks") {
                    g.seeks = Some(s.into());
                }
                g.since = g.since.min(since);
                g.asked = Some(since);
                if k == Some(paper::APPLICATION) {
                    g.applied.insert(to0.unwrap_or(party), Applied { t: since, finding: None });
                }
            }
        }
        for r in &fresh {
            if !is_statement(r) || !addressed_to(r).contains(&me) {
                continue;
            }
            let by = r.speaks_for.clone().unwrap_or_else(|| r.author.clone());
            let d = data(r).clone();
            let k = kind(r).unwrap_or_default();
            // An office that waits for papers before it decides our claim asks for them: we send what we have.
            if k == paper::EVIDENCE_REQUEST {
                if let (Some(claim), Some(need)) = (d.s("claim"), d.s("need")) {
                    if by != me && self.recourse.evidence_sent.insert(r.id.clone()) {
                        let last = self.s.last_employer.clone().or(self.s.job.as_ref().map(|j| j.employer.clone()));
                        let e = crate::papers::finance::Evidence { claim: claim.into(), need: Some(need.into()), request: Some(r.id.clone()), last_employer: last };
                        w.push(because(
                            format!("{by} asks for papers for our claim {claim} ({}): sending them.", d.s("what").unwrap_or("what the law asks")),
                            vec![say(
                                paper::EVIDENCE,
                                &format!("For my claim {claim}: {}, as asked.", d.s("what").unwrap_or("the papers asked for")),
                                Say { to: Some(vec![by.clone()]), visible: Some(Visible::Only(vec![me.clone(), by.clone()])), basis: Some(r.id.clone()), data: Some(crate::papers::data(&e)), ..Default::default() },
                            )],
                        ));
                    }
                    continue;
                }
            }
            if k == paper::ANSWER {
                let Some(key) = self.recourse.grievances.values().find(|g| Some(g.matter.as_str()) == d.s("matter") && g.party == by && g.asked.is_some() && g.answer.is_none()).map(|g| g.key.clone()) else { continue };
                let ok = d.flag("granted");
                let (matter, amount, about, seeks) = {
                    let g = self.recourse.grievances.get_mut(&key).unwrap_or_else(|| unreachable!());
                    g.answer = Some(if ok { "granted" } else { "refused" }.into());
                    g.answered_at = Some(t);
                    (g.matter.clone(), g.amount, g.about.clone(), g.seeks.clone())
                };
                self.way_outcome(w, "ask", if ok { "granted" } else { "refused" }, &by, if ok { 10_000 } else { 1_000 }, json!({ "about": matter }));
                self.treat_landing(w, &by, ok, if ok { 20_000 } else { 10_000 }, Some(&r.id), None, Some(if ok { (1_000, "granted") } else { (-1_000, "refused") }));
                if ok && amount.is_some() {
                    if matter == "underpaid" {
                        if let Some(j) = self.s.job.as_mut().filter(|j| Some(&j.agreement) == about.as_ref()) {
                            j.short = None;
                        }
                    }
                    self.ended(w, &key, "put right on asking", true);
                } else if ok {
                    if let Some(g) = self.recourse.grievances.get_mut(&key) {
                        g.promised = Some(t);
                    }
                    if matter == "claim_refused" {
                        self.refusal_cleared(seeks.as_deref());
                    }
                }
                // (Refused: what is tried next is the mind's.)
            } else if (k == paper::DECISION || k == "tribunal_order") && d.s("applicant") == Some(me.as_str()) && d.s("matter").is_some() {
                let Some(key) = self.recourse.grievances.values().find(|g| Some(g.matter.as_str()) == d.s("matter") && Some(g.party.as_str()) == d.s("against") && g.applied.contains_key(&by)).map(|g| g.key.clone()) else { continue };
                let f = d.s("finding").unwrap_or_default().to_string();
                let binding = d.get("binding") != Some(&Value::Bool(false));
                let (matter, seeks, since_applied) = {
                    let g = self.recourse.grievances.get_mut(&key).unwrap_or_else(|| unreachable!());
                    let a = g.applied.entry(by.clone()).or_default();
                    a.finding = Some(f.clone());
                    (g.matter.clone(), g.seeks.clone(), a.t)
                };
                let won = matches!(f.as_str(), "pay" | "do" | "set_aside" | "settled");
                let payoff = if won { 10_000 } else if f == "referred" { 5_000 } else { 500 };
                self.way_outcome(w, "desk", &f, &by, payoff, json!({ "about": matter, "days": (t - since_applied).div_euclid(DAY), "binding": binding }));
                if f != "referred" {
                    let kb = self.civil(&by, &w.cx.ctx.params);
                    self.treat_landing(w, &by, won, 20_000, Some(&r.id), Some(kb), None);
                }
                if f == "settled" {
                    self.ended(w, &key, "settled", true);
                } else if won {
                    let o = Ordered { id: r.id.clone(), by: by.clone(), binding, due: d.i("due").unwrap_or(t + 28 * DAY), amount: if f == "pay" { d.i("amount").unwrap_or(0) } else { 0 }, enforced: false };
                    if let Some(g) = self.recourse.grievances.get_mut(&key) {
                        g.ordered = Some(o);
                    }
                    if f == "set_aside" && matter == "claim_refused" {
                        self.refusal_cleared(seeks.as_deref());
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------ upkeep and disrepair (citizen.ts 3144-3209)

    /// What became of each grievance (no answer in time, a promise not kept, an order paid or not, long let go); a home
    /// fallen into disrepair, the landlord's to put right; and a notice to vacate that lapsed, told to the mind.
    pub fn disrepair(&mut self, w: &mut Week) {
        let t = w.t;
        let answer_days = self.p.frictions.answer_days.unwrap_or(14);
        let promise_days = self.p.frictions.promise_days.unwrap_or(45);
        let keys: Vec<String> = self.recourse.grievances.keys().cloned().collect();
        for key in keys {
            let Some(g) = self.recourse.grievances.get(&key).cloned() else { continue };
            if g.asked.is_some_and(|a| g.answer.is_none() && t - a >= answer_days * DAY) {
                // No answer in the time anyone would give: ignored.
                if let Some(x) = self.recourse.grievances.get_mut(&key) {
                    x.answer = Some("ignored".into());
                }
                self.way_outcome(w, "ask", "ignored", &g.party, 0, json!({ "about": g.matter }));
                self.treat(w, &g.party, false, false, true, None, None);
            }
            if g.promised.is_some_and(|p| t - p >= promise_days * DAY) {
                // Said yes, and it is not done: worse than a no.
                if let Some(x) = self.recourse.grievances.get_mut(&key) {
                    x.promised = None;
                    x.answer = Some("refused".into());
                }
                self.treat(w, &g.party, false, true, true, None, None);
            }
            if let Some(o) = &g.ordered {
                if o.amount > 0 && self.absorbed_settled(&o.id) >= o.amount {
                    if g.matter == "underpaid" {
                        if let Some(j) = self.s.job.as_mut().filter(|j| Some(&j.agreement) == g.about.as_ref()) {
                            j.short = None;
                        }
                    }
                    self.ended(w, &key, if o.binding { "paid under an order" } else { "paid on a recommendation" }, true);
                    continue;
                }
                if t >= o.due + DAY && !o.enforced {
                    let tribunal = self.p.tribunal.as_ref().map(|x| x.entity.clone());
                    if o.amount > 0 && o.binding && tribunal.as_deref() == Some(o.by.as_str()) {
                        if let Some(x) = self.recourse.grievances.get_mut(&key).and_then(|x| x.ordered.as_mut()) {
                            x.enforced = true;
                        }
                        let e = crate::papers::citizen::EnforcementRequest { order: o.id.clone(), unpaid: o.amount };
                        w.push(because(
                            format!("{} ordered {} to pay us {} by day {} and it is unpaid: asking for the order to be enforced.", o.by, g.party, Self::usd_of(w, o.amount), o.due.div_euclid(DAY)),
                            vec![say(
                                "enforcement_request",
                                &format!("Request to enforce order {}: {} unpaid.", o.id, Self::usd_of(w, o.amount)),
                                Say { to: Some(vec![o.by.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), o.by.clone()])), basis: Some(o.id.clone()), data: Some(crate::papers::data(&e)), ..Default::default() },
                            )],
                        ));
                    } else {
                        // Ordered or recommended, and not done: this venue's word did not carry.
                        let kb = self.civil(&o.by, &w.cx.ctx.params);
                        self.treat(w, &o.by, false, false, true, None, Some(kb));
                        if let Some(x) = self.recourse.grievances.get_mut(&key) {
                            x.ordered = None;
                        }
                    }
                }
            }
            // Long enough with nothing in train: let go.
            let Some(g) = self.recourse.grievances.get(&key) else { continue };
            if t - g.since >= 365 * DAY && g.promised.is_none() && g.ordered.as_ref().is_none_or(|o| t >= o.due + 90 * DAY) {
                self.ended(w, &key, "let go", false);
            }
        }
        // A home fallen into disrepair, as whoever lives there sees it: the landlord's to put right.
        let home = self.s.home.clone();
        if let (Some(dr), Some(h), true) = (self.p.frictions.disrepair.clone(), &home, friction_dial(w.cx) > 0) {
            let site = self.absorbed.home_site.clone().filter(|s| s.structure == h.structure);
            if let (false, true, Some(site)) = (h.owned, self.is_leaseholder(), site) {
                let level = site.variables.as_ref().and_then(|v| v.get(&dr.variable)).map_or(0, |v| crate::common::variable_today(v, t));
                let k0 = gkey("disrepair", &h.landlord, None);
                let g0 = self.recourse.grievances.get(&k0).cloned();
                if level >= dr.at && g0.is_none() {
                    let size = (5_000 + (level - dr.at) * 10_000 / (2 * dr.at.max(1))).min(12_000);
                    let g = self.grieve(w, "disrepair", &h.landlord.clone(), None, None, Some(&h.structure.clone()), size, "shelter", Some("wear"));
                    g.seeks = Some("repair".into());
                } else if let Some(g0) = g0.filter(|g| g.structure.as_deref() == Some(h.structure.as_str()) && level < dr.at) {
                    let asked = g0.asked.is_some();
                    self.treat(w, &h.landlord, true, asked, asked, None, None);
                    self.ended(w, &k0, "repaired", true);
                }
            }
        }
        let gone: Vec<String> = self
            .recourse
            .grievances
            .values()
            .filter(|g| g.matter == "disrepair" && home.as_ref().is_none_or(|h| g.structure.as_deref() != Some(h.structure.as_str())))
            .map(|g| g.key.clone())
            .collect();
        for k in gone {
            self.ended(w, &k, "left", false);
        }
        // (A notice to vacate that lapsed, or was answered by a plan or a dismissal: told to the mind once, whose want
        // to stay it met.)
        let over: Vec<String> = self.housing.notice_over.iter().cloned().collect();
        self.recourse.lapsed_told.retain(|x| over.contains(x));
        for lease in over {
            if self.recourse.lapsed_told.insert(lease.clone()) {
                self.tell(w, Outcome { domain: "home".into(), option: lease.clone(), kind: "notice_lapsed".into(), way: Way::Mine, facts: facts(json!({ "lease": lease })), ..Default::default() });
            }
        }
    }

    // ------------------------------------------------------------------ a service not done (citizen.ts 3490-3530)

    /// Waste piling up at home: the leaseholder writes to the town, with the week's chance, once until it's seen to.
    pub fn complaints(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let (Some(to), Some(home)) = (self.p.complain_to.clone(), self.s.home.clone()) else { return };
        let site = self.absorbed.home_site.clone().filter(|s| s.structure == home.structure);
        let Some(site) = site.filter(|_| self.is_leaseholder()) else { return };
        let now = if self.p.complain_about_held {
            // (Waste a kind we hold at home, law 8: what is in the bin is what we hold of it there.)
            if self.absorbed.bin_seen.structure == home.structure { self.absorbed.bin_seen.value } else { 0 }
        } else {
            site.variables.as_ref().and_then(|v| v.get(&self.p.complain_about)).map_or(0, |v| crate::common::variable_today(v, t))
        };
        if self.absorbed.bin_seen.structure != home.structure {
            let b = &mut self.absorbed.bin_seen;
            b.structure = home.structure.clone();
            b.value = now;
            b.emptied_at = t;
        }
        let emptied = self.absorbed.bin_seen.emptied_at;
        let days = (t - emptied).div_euclid(DAY);
        let kb = self.recourse_kind_of(&to, &w.cx.ctx.params);
        if self.recourse.complained_of.as_deref() == Some(home.structure.as_str()) && days < 7 {
            // Collected after we wrote: writing made a difference, and the town did its part.
            self.recourse.complained_of = None;
            self.treat(w, &to, true, false, true, None, Some(kb.clone()));
            self.tell(w, Outcome { domain: "complaint".into(), option: to.clone(), kind: "seen_to".into(), way: Way::Mine, facts: facts(json!({ "structure": home.structure, "days": days })), ..Default::default() });
        }
        let complained = self.recourse.complained_of.as_deref() == Some(home.structure.as_str());
        // Angry with whoever should collect it, the more so the longer it's been (the mind's feeling, and its want).
        if now > 0 {
            let share = ((t - emptied) * 5_000 / (DAY * self.p.complain_after_days.max(1))).min(10_000);
            self.happened(w, Event::ServiceLapsed { whom: to.clone(), share_bps: share, days, complained });
        }
        let forced = std::mem::take(&mut self.s.complain_now);
        let bearing = 5_000 + div_round((self.mind.facet("conformity") - 5_000) * 2, 5);
        let angry = now > 0 && days >= 7 && self.mind.feeling("anger", &to, t) >= bearing && !complained;
        if !angry {
            return;
        }
        let first = self.recourse.complain_noted.insert(home.structure.clone());
        let draw = w.cx.rng("complain").below(10_000) as i64;
        let life = self.life(w.pic, t, w.acc.as_ref().map(|a| a.balance));
        let c = self.mind.choose_conduct(
            w.cx,
            &life,
            ConductAsk {
                conduct: "complain".into(),
                base_bps: self.p.complain_bps,
                draw_bps: draw,
                who: Some(to.clone()),
                lean: true,
                forced,
                act: first,
                record: first.then(|| ("complain".to_string(), "write".to_string(), "not".to_string())),
            },
        );
        if !c.does {
            return;
        }
        self.recourse.complained_of = Some(home.structure.clone());
        self.treat(w, &to, false, false, false, None, Some(kb));
        let mut f = json!({ "structure": home.structure, "days": days });
        for (k, v) in &c.facts {
            f[k] = json!(v);
        }
        self.tell(w, Outcome { domain: "complaint".into(), option: to.clone(), kind: "made".into(), way: Way::Mine, facts: facts(f), ..Default::default() });
        // (TS's tone, from what the person says of the town, is the mind's view: not read here.)
        let about = self.p.complain_about.clone();
        let paper = crate::papers::citizen::Complaint { structure: home.structure.clone(), about: about.clone(), days };
        w.push(because(
            format!("Our {about} hasn't been collected for about {days} days: writing to the town."),
            vec![say(
                "complaint",
                &format!("Our {about} at {} hasn't been collected for about {days} days.", home.structure),
                Say { to: Some(vec![to.clone()]), visible: Some(Visible::Only(vec![me, to])), data: Some(crate::papers::data(&paper)), ..Default::default() },
            )],
        ));
    }

    // ------------------------------------------------------------------ the tribunal (citizen.ts 4510-4548)

    /// What the tribunal decided on our applications; debts owed us left unpaid, applied over; unpaid orders enforced.
    pub fn justice(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        // A debt owed us paid in full: the mind is told (it was pursued, or waited on).
        let debts: Vec<(String, Option<String>, i64)> = self
            .book
            .claims_by(ClaimKey::Holder, &me)
            .filter_map(|c| match &c.body {
                RecordBody::Claim { holder, counterparty, about, .. } if *holder == me && about.s("kind") == Some("debt") => Some((c.id.clone(), counterparty.clone(), about.i("amount").unwrap_or(0))),
                _ => None,
            })
            .collect();
        for (id, by, amount) in &debts {
            let paid = self.absorbed_settled(id);
            if *amount > 0 && paid >= *amount && self.recourse.settled_told.insert(id.clone()) {
                self.tell(w, Outcome { domain: "debt".into(), option: by.clone().unwrap_or_default(), kind: "settled".into(), way: Way::Mine, from: by.clone(), facts: facts(json!({ "claim": id, "paid": paid })), ..Default::default() });
            }
        }
        let Some(tr) = self.p.tribunal.clone() else { return };
        let orders: Vec<Arc<Record>> = self
            .book
            .open("tribunal_order")
            .filter(|x| addressed_to(x).contains(&me) && data(x).s("applicant") == Some(me.as_str()) && !self.recourse.enforcing.contains(&x.id))
            .cloned()
            .collect();
        for o in orders {
            let d = data(&o).clone();
            if d.s("kind") == Some("rent_increase") {
                self.recourse.enforcing.insert(o.id.clone());
                if d.s("finding") == Some("valid") {
                    if let Some(n) = d.s("notice") {
                        self.housing.upheld.push(n.into());
                    }
                }
                continue;
            }
            let due = d.i("due").unwrap_or(0);
            if d.s("kind") != Some("debt") || d.s("finding") != Some("pay") || t < due + DAY {
                continue;
            }
            self.recourse.enforcing.insert(o.id.clone());
            let claim = d.s("claim").unwrap_or_default().to_string();
            let ordered = d.i("amount").unwrap_or(0);
            let of_claim = self.book.get(&claim).and_then(|c| match &c.body {
                RecordBody::Claim { about, .. } => about.i("amount"),
                _ => None,
            });
            let unpaid = ordered.min(of_claim.unwrap_or(ordered) - self.absorbed_settled(&claim));
            if unpaid > 0 {
                let e = crate::papers::citizen::EnforcementRequest { order: o.id.clone(), unpaid };
                w.push(because(
                    format!(
                        "The tribunal ordered {} to pay us {} by day {}, and {} is still unpaid: asking for the order to be enforced.",
                        d.s("against").unwrap_or_default(),
                        Self::usd_of(w, ordered),
                        due.div_euclid(DAY),
                        Self::usd_of(w, unpaid)
                    ),
                    vec![say(
                        "enforcement_request",
                        &format!("Request to enforce order {}: {} unpaid.", o.id, Self::usd_of(w, unpaid)),
                        Say { to: Some(vec![tr.entity.clone()]), visible: Some(Visible::Only(vec![me.clone(), tr.entity.clone()])), basis: Some(o.id.clone()), data: Some(crate::papers::data(&e)), ..Default::default() },
                    )],
                ));
            }
        }
        let claims: Vec<Arc<Record>> = self.book.claims_by(ClaimKey::Holder, &me).cloned().collect();
        for c in claims {
            let RecordBody::Claim { holder, counterparty: Some(by), about, .. } = &c.body else { continue };
            let forced = self.s.apply_debt_now.contains(&c.id);
            if *holder != me || about.s("kind") != Some("debt") || self.recourse.pursued.contains(&c.id) || (!forced && t - c.at < tr.apply_after_days * DAY) {
                continue;
            }
            self.recourse.pursued.insert(c.id.clone());
            let owed = about.i("amount").unwrap_or(0) - self.absorbed_settled(&c.id);
            let Some(acc) = w.acc.clone().filter(|_| owed > 0) else { continue };
            let draw = w.cx.rng(&format!("apply-{}", c.id)).below(10_000) as i64;
            let life = self.life(w.pic, t, Some(acc.balance));
            let conduct = ConductAsk { conduct: "take_to_tribunal".into(), base_bps: tr.apply_bps, draw_bps: draw, who: Some(tr.entity.clone()), lean: true, forced, act: !forced, record: None };
            if !self.mind.choose_conduct(w.cx, &life, conduct).does {
                continue;
            }
            let what = about.s("for").unwrap_or("a debt").to_string();
            w.push(because(
                format!("{by} still owes us {} ({what}), {} days on: applying to the tribunal.", Self::usd_of(w, owed), (t - c.at).div_euclid(DAY)),
                vec![say(
                    "tribunal_application",
                    &format!("Application: {by} owes us {} ({what}, recorded as {}).", Self::usd_of(w, owed), c.id),
                    Say {
                        to: Some(vec![tr.entity.clone()]),
                        visible: Some(Visible::Only(vec![me.clone(), tr.entity.clone(), by.clone()])),
                        basis: Some(c.id.clone()),
                        data: Some(json!({ "kind": "debt", "against": by, "claim": c.id, "amount": owed, "account": acc.account, "evidence": serde_json::to_value(&*c).unwrap_or(Value::Null) })),
                        ..Default::default()
                    },
                )],
            ));
        }
    }

    // ------------------------------------------------------------------ carrying out a way (citizen.ts waysFor's acts)

    /// What a way the mind chose sets in train, or the steps it takes now.
    pub fn carry_out(&mut self, w: &mut Week, intent: &Intent, why: Option<&str>) {
        let t = w.t;
        let me = self.me.clone();
        let _ = why; // (The reason a way's steps give is life's own, as TS's acts gave it.)
        match intent {
            Intent::SearchJobs => self.s.search_forced = true,
            Intent::HuntHome { until, beat } => {
                if self.s.home.is_some() {
                    self.s.move_hunt = Some((*until, *beat));
                }
            }
            Intent::AskLandlord { about, rise } => {
                let Some(h) = self.s.home.clone().filter(|h| !h.owned) else { return };
                self.s.asked_party.insert(format!("{}:{about}", h.agreement), t);
                let was = Self::usd_of(w, h.rent);
                let (reason, words, would) = if *rise {
                    (
                        format!("Our landlord means to raise the rent: asking them to hold it at {was} a month."),
                        format!("Request: please hold the rent for {} at {was} a month.", h.space),
                        crate::papers::citizen::Would { who: me.clone(), does: json!({ "outcome": { "money": { "amount": h.rent.to_string() } } }), every: Some(MONTH) },
                    )
                } else {
                    (
                        "Our landlord has given us notice: asking to stay on.".to_string(),
                        format!("Request: please let us stay on at {}.", h.space),
                        crate::papers::citizen::Would { who: h.landlord.clone(), does: json!({ "outcome": { "occupancy": { "who": me, "in": h.space } } }), every: None },
                    )
                };
                let v = crate::papers::citizen::VariationRequest { agreement: h.agreement.clone(), about: about.clone(), would };
                w.push(because(
                    reason,
                    vec![say(
                        "variation_request",
                        &words,
                        Say { to: Some(vec![h.landlord.clone()]), visible: Some(Visible::Only(vec![me.clone(), h.landlord.clone()])), basis: Some(about.clone()), data: Some(crate::papers::data(&v)), ..Default::default() },
                    )],
                ));
            }
            Intent::AskRise { agreement, wage } => {
                let Some(j) = self.s.job.clone() else { return };
                self.s.asked_party.insert(agreement.clone(), t);
                let days = div_round(j.period, DAY);
                let pay_words = Self::usd_of(w, *wage);
                let v = crate::papers::citizen::VariationRequest {
                    agreement: agreement.clone(),
                    about: agreement.clone(),
                    would: crate::papers::citizen::Would { who: j.employer.clone(), does: json!({ "outcome": { "money": { "amount": wage.to_string() } } }), every: Some(j.period) },
                };
                w.push(because(
                    format!("Asking our employer for a rise, to {pay_words} every {days} days."),
                    vec![say(
                        "variation_request",
                        &format!("Request: a rise in my pay, to {pay_words} every {days} days."),
                        Say { to: Some(vec![j.employer.clone()]), visible: Some(Visible::Only(vec![me.clone(), j.employer.clone()])), basis: Some(agreement.clone()), data: Some(crate::papers::data(&v)), ..Default::default() },
                    )],
                ));
            }
            Intent::ChallengeRent { notice } => {
                let (Some(tr), Some(n)) = (self.p.tribunal.clone(), self.book.get(notice).cloned()) else { return };
                let Some(by) = n.speaks_for.clone() else { return };
                if self.housing.is_challenged(notice) || !self.recourse.challenged.insert(notice.clone()) {
                    return;
                }
                w.push(because(
                    "A notice of rent increase that breaks the law: taking it to the tribunal, and paying the rent as it was meanwhile.",
                    vec![say(
                        "tribunal_application",
                        &format!("Application: the notice of rent increase {notice} from {by} breaks the law; we ask that it be found invalid."),
                        Say {
                            to: Some(vec![tr.entity.clone()]),
                            visible: Some(Visible::Only(vec![me.clone(), tr.entity.clone(), by.clone()])),
                            basis: Some(notice.clone()),
                            data: Some(json!({ "kind": "rent_increase", "against": by, "notice": notice, "evidence": serde_json::to_value(&*n).unwrap_or(Value::Null) })),
                            ..Default::default()
                        },
                    )],
                ));
            }
            Intent::ApplyDebt { claim } => {
                self.s.apply_debt_now.insert(claim.clone());
            }
            Intent::Complain => self.s.complain_now = true,
            Intent::AskPutRight { grievance } => {
                let Some(acc) = w.acc.clone() else { return };
                let Some(g) = self.recourse.grievances.get_mut(grievance) else { return };
                g.asked = Some(t);
                let g = g.clone();
                let words = g.matter.replace('_', " ");
                let amt = g.amount.filter(|a| *a != 0).map(|a| Self::usd_of(w, a));
                let req = crate::papers::finance::ReviewRequest {
                    matter: g.matter.clone(),
                    against: Some(g.party.clone()),
                    about: g.about.clone(),
                    amount: g.amount,
                    account: g.amount.map(|_| acc.account.clone()),
                    structure: g.structure.clone(),
                    request: None,
                    seeks: g.seeks.clone(),
                    particulars: None,
                    brought_forward: None,
                };
                w.push(because(
                    format!("Asking {} to put it right ({words}{}).", g.party, amt.as_ref().map_or(String::new(), |a| format!(", {a}"))),
                    vec![say(
                        paper::REQUEST,
                        &format!(
                            "Request: please put this right ({words}{}{}).",
                            amt.as_ref().map_or(String::new(), |a| format!(": {a} is owed to us")),
                            g.structure.as_ref().map_or(String::new(), |s| format!(" at {s}"))
                        ),
                        Say { to: Some(vec![g.party.clone()]), visible: Some(Visible::Only(vec![me.clone(), g.party.clone()])), basis: g.about.clone(), data: Some(crate::papers::data(&req)), ..Default::default() },
                    )],
                ));
            }
            Intent::Venue { grievance, venue, hearing, cost } => {
                let Some(acc) = w.acc.clone() else { return };
                let Some(h) = self.book.get(hearing).cloned() else { return };
                let Some(g) = self.recourse.grievances.get(grievance).cloned() else { return };
                if let Some(x) = self.recourse.grievances.get_mut(grievance) {
                    x.applied.insert(venue.clone(), Applied { t, finding: None });
                }
                let offer = offer_of(&h).cloned().unwrap_or(Value::Null);
                let form = offer.get("hears").and_then(Value::as_array).and_then(|a| a.iter().find(|x| x.s("about") == Some(g.matter.as_str()))).and_then(|x| x.s("form")).unwrap_or(paper::APPLICATION).to_string();
                let fee_to = venue_fee(&offer).map(|f| f.0);
                let words = g.matter.replace('_', " ");
                let decided_at = self.decided_at(&g);
                let amt = g.amount.filter(|a| *a != 0).map(|a| Self::usd_of(w, a));
                let asked_words = g.asked.map_or(String::new(), |a| {
                    format!(
                        "; we asked them {} days ago{}",
                        (t - a).div_euclid(DAY),
                        match g.answer.as_deref() {
                            Some("refused") => " and they refused",
                            Some("ignored") => " and had no answer",
                            _ => "",
                        }
                    )
                });
                let app = crate::papers::finance::Application {
                    kind: Some(g.matter.clone()),
                    matter: g.matter.clone(),
                    against: Some(g.party.clone()),
                    about: g.about.clone(),
                    amount: g.amount,
                    account: g.amount.map(|_| acc.account.clone()),
                    structure: g.structure.clone(),
                    request: g.asked.map(|a| format!("asked on day {}", a.div_euclid(DAY))),
                    seeks: g.seeks.clone(),
                    particulars: Some(json!(particulars_of(&g, t, &w.cx.ctx.world))),
                    evidence: g.evidence.clone(),
                    decided_on: decided_at,
                    reviewed_on: g.answered_at,
                    review_asked_on: g.asked.filter(|_| g.answered_at.is_none() && g.matter == "claim_refused"),
                    brought_forward: None,
                };
                let mut calls = vec![say(
                    &form,
                    &format!(
                        "Application: {words} against {}{}{}{asked_words}.",
                        g.party,
                        amt.as_ref().map_or(String::new(), |a| format!("; {a} is owed to us")),
                        g.structure.as_ref().map_or(String::new(), |s| format!("; at {s}"))
                    ),
                    Say { to: Some(vec![venue.clone()]), visible: Some(Visible::Only(vec![me.clone(), venue.clone(), g.party.clone()])), basis: Some(hearing.clone()), data: Some(crate::papers::data(&app)), ..Default::default() },
                )];
                if let (true, Some(to)) = (*cost > 0, fee_to) {
                    calls.push(pay(&to, *cost, Pay { from: Some(acc.account.clone()), for_: Some("Application fee.".into()), ..Default::default() }, w.cx));
                }
                let fee_words = if *cost > 0 { format!(", with its fee of {}", Self::usd_of(w, *cost)) } else { String::new() };
                w.push(because(format!("Taking it to {venue}, which hears such things ({words} against {}){fee_words}.", g.party), calls));
            }
            Intent::TellWronged { grievance, whom } => {
                let Some(g) = self.recourse.grievances.get_mut(grievance) else { return };
                g.told = true;
                let (matter, party) = (g.matter.clone(), g.party.clone());
                // (Whom: as the mind named them, else those it holds closest, of the people we know.)
                let whom: Vec<String> = if whom.is_empty() {
                    self.mind.closest(3, t).into_iter().map(|x| x.who).filter(|x| self.mind.contact(x)).collect()
                } else {
                    whom.clone()
                };
                if !whom.is_empty() {
                    w.push(because(format!("Telling those we know what {party} did."), vec![crate::common::letters::message(&whom, &wronged_say(&matter, &party), None)]));
                }
            }
            // (Signing and standing are the mind's own acts, voice and civic; life notes what was chosen.)
            Intent::Sign { petition } => {
                self.s.sign_now.insert(petition.clone());
            }
            Intent::Stand { notice } => {
                self.s.stand_now.insert(notice.clone());
            }
            Intent::StopLooking { until } => self.s.discouraged_until = *until,
            Intent::FoundBusiness { until } => self.s.venture_wanted = *until,
            Intent::JoinUnion | Intent::JoinGroup { .. } | Intent::Other { .. } | Intent::Wait => {}
        }
    }

    /// When the decision a refused claim's grievance is about was made (its paper, or the paper tendered).
    fn decided_at(&self, g: &Grievance) -> Option<i64> {
        let dec = g.about.as_deref().filter(|_| g.matter == "claim_refused").and_then(|a| self.book.get(a));
        dec.map(|d| d.at).or_else(|| g.evidence.as_ref().and_then(|e| e.i("at")))
    }
}

/// What applying to a venue costs, where its terms say: (to whom, cents).
fn venue_fee(offer: &Value) -> Option<(String, i64)> {
    let none = vec![];
    offer
        .get("terms")
        .and_then(|t| t.get("commitments"))
        .and_then(Value::as_array)
        .unwrap_or(&none)
        .iter()
        .filter(|c| c.s("who") == Some("taker"))
        .filter_map(|c| c.get("does").and_then(|d| d.get("outcome")).and_then(|o| o.get("money")))
        .find(|m| m.get("to").is_some())
        .map(|m| (m.s("to").unwrap_or_default().to_string(), m.i("amount").unwrap_or(0)))
}

// ------------------------------------------------------------------ life's openings for a want (citizen.ts 2119-2298)

/// Life's openings for a want, as the mind asks for them mid-call (citizen.ts `waysFor`).
pub struct Ways<'a> {
    pub person: &'a Person,
    pub pic: &'a oikos_sight::Picture,
    /// How many people we remember (the mind's contacts, as life last read them: the mind is out of the person while
    /// it weighs these openings).
    pub contacts: usize,
}

impl Ways<'_> {
    fn open(key: String, kind_: &str, intent: Intent) -> Opening {
        Opening { key, kind: kind_.into(), intent, ..Default::default() }
    }
}

impl Openings for Ways<'_> {
    fn for_want(&self, want: &WantView, t: i64) -> Vec<Opening> {
        let p = self.person;
        let me = p.me.as_str();
        let book = &p.book;
        let r = &p.recourse;
        let home = p.s.home.as_ref();
        let mut out = vec![];
        // The job board: what its offers bring (as the postings we last saw there say; none seen: pay for work).
        if !p.s.retired && p.p.in_labour_force && p.s.own_work.is_none() {
            let offered = brings_of(p.s.found_jobs.first().and_then(|id| book.get(id)).and_then(|x| offer_of(x)));
            let base = if offered.is_empty() { vec!["money.to".to_string(), "work".to_string()] } else { offered };
            let mut o = Self::open("offer:employment".into(), "offer:employment", Intent::SearchJobs);
            o.brings = base.into_iter().filter(|k| p.s.job.is_none() || k != "work").collect();
            o.bears = p.s.job.iter().map(|j| j.employer.clone()).collect();
            out.push(o);
        }
        // The homes board: another home (and, housed, one that asks less).
        if p.is_leaseholder() && !home.is_some_and(|h| h.owned) {
            let intent = match home {
                Some(h) => Intent::HuntHome { until: t + 60 * DAY, beat: (!want.seeks.iter().any(|s| s == "occupancy")).then(|| h.rent * r.cheaper_bps / 10_000) },
                None => Intent::Wait,
            };
            let mut o = Self::open("offer:lease".into(), "offer:lease", intent);
            o.brings = if home.is_some() { vec!["occupancy".into(), "money.from".into()] } else { vec!["occupancy".into()] };
            o.bears = home.iter().map(|h| h.landlord.clone()).collect();
            out.push(o);
        }
        // Whoever made the paper in our way, or the other party to an agreement of ours: they can vary or undo it.
        let may_ask = |key: &str| p.s.asked_party.get(key).is_none_or(|at| t - at >= r.ask_again_days * DAY);
        if let (Some(h), Some((record, kind_, by))) = (home.filter(|h| !h.owned && p.is_leaseholder()), want.against.as_ref()) {
            if *by == h.landlord && may_ask(&format!("{}:{record}", h.agreement)) {
                let mut o = Self::open(format!("ask:{}", h.landlord), "ask", Intent::AskLandlord { about: record.clone(), rise: kind_ == "rent_increase" });
                o.on = Some(record.clone());
                o.by = Some(h.landlord.clone());
                o.undoes = Some(record.clone());
                o.bears = vec![h.landlord.clone()];
                out.push(o);
            }
        }
        if let Some(j) = p.s.job.as_ref() {
            if !j.claimed && want.seeks.iter().any(|s| s == "money.to") && j.period > DAY && t - j.since >= 180 * DAY && may_ask(&j.agreement) {
                let wage = j.wage * (10_000 + r.rise_bps) / 10_000;
                let mut o = Self::open(format!("ask:{}", j.employer), "ask", Intent::AskRise { agreement: j.agreement.clone(), wage });
                o.on = Some(j.agreement.clone());
                o.by = Some(j.employer.clone());
                o.brings = vec!["money.to".into()];
                o.bears = vec![j.employer.clone()];
                out.push(o);
            }
        }
        // A desk that hears papers of the kind in our way: the tribunal, for a notice of rent increase that breaks the
        // law as we read it, or a debt owed us.
        if let Some(tr) = &p.p.tribunal {
            let hears = tr.hears.clone().unwrap_or_else(|| vec!["rent_increase".into(), "debt".into()]);
            let desk = tr.entity.clone();
            if let Some((record, k, _)) = want.against.as_ref().filter(|a| a.1 == "rent_increase" && hears.iter().any(|h| h == "rent_increase")) {
                let _ = k;
                let n = book.get(record).filter(|n| is_statement(n) && n.speaks_for.is_some());
                if n.is_some() && !r.challenged.contains(record) && r.breaching.contains(record) {
                    let mut o = Self::open(format!("desk:{desk}"), "desk", Intent::ChallengeRent { notice: record.clone() });
                    o.on = Some(record.clone());
                    o.by = Some(desk.clone());
                    o.undoes = Some(record.clone());
                    o.conduct = Some("take_to_tribunal".into());
                    out.push(o);
                }
            }
            if let (true, Some(whom)) = (hears.iter().any(|h| h == "debt"), want.whom.as_ref()) {
                let owed = book.claims_by(ClaimKey::Holder, me).find(|c| match &c.body {
                    RecordBody::Claim { holder, counterparty, about, .. } => holder == me && about.s("kind") == Some("debt") && counterparty.as_ref() == Some(whom) && !r.pursued.contains(&c.id),
                    _ => false,
                });
                if let Some(c) = owed {
                    let mut o = Self::open(format!("desk:{desk}"), "desk", Intent::ApplyDebt { claim: c.id.clone() });
                    o.on = Some(c.id.clone());
                    o.by = Some(desk.clone());
                    o.brings = vec!["money.to".into()];
                    o.bears = vec![whom.clone()];
                    o.conduct = Some("take_to_tribunal".into());
                    out.push(o);
                }
            }
        }
        // The town's own desk for what it has not done (a complaint).
        if let (Some(to), Some(h)) = (&p.p.complain_to, home) {
            if p.is_leaseholder() && r.complained_of.as_deref() != Some(h.structure.as_str()) {
                let mut o = Self::open(format!("desk:{to}"), "desk", Intent::Complain);
                o.by = Some(to.clone());
                o.bears = vec![to.clone()];
                o.conduct = Some("complain".into());
                out.push(o);
            }
        }
        // A petition on the board about landlords: it bears on the landlord.
        if let Some(h) = home.filter(|h| r.willing && !h.owned) {
            for id in &p.s.found_petitions {
                let Some(pet) = book.get(id) else { continue };
                let signed = p.s.sign_now.contains(id) || book.of_type("vote").any(|v| v.speaks_for.as_deref() == Some(me) && matches!(&v.body, RecordBody::Vote { ballot, choice } if ballot == id && choice == "sign"));
                let tagged = data(pet).get("demand").and_then(|d| d.get("tags")).and_then(Value::as_array).is_some_and(|a| a.iter().any(|x| x.as_str() == Some("tenant_protection")));
                if pet.speaks_for.as_deref() == Some(me) || signed || !tagged {
                    continue;
                }
                let mut o = Self::open(format!("petition:{id}"), "petition", Intent::Sign { petition: id.clone() });
                o.on = Some(id.clone());
                o.bears = vec![h.landlord.clone()];
                o.others = Some(crate::common::published_count(book, pet));
                out.push(o);
            }
        }
        // An election called: it bears on the town.
        if let Some(town) = &p.p.electoral_town {
            for n in book.open("election_notice") {
                if p.s.stand_now.contains(&n.id) || t >= data(n).i("nominations_close_at").unwrap_or(0) {
                    continue;
                }
                let mut o = Self::open(format!("stand:{}", n.id), "stand", Intent::Stand { notice: n.id.clone() });
                o.on = Some(n.id.clone());
                o.bears = std::iter::once(town.clone()).chain(p.p.complain_to.clone()).collect();
                o.others = Some(0);
                out.push(o);
            }
        }
        // Something gone wrong at someone's hands: asking them to put it right; any body that says it hears such a
        // matter (an offer's `hears`: found by what it says, never by its name); and telling those we know.
        let acc = crate::common::money::own_banked(self.pic, me);
        if let (Some(g), Some(acc)) = (r.grievances.get(&gkey(&want.about, want.whom.as_deref().unwrap_or(""), want.against.as_ref().map(|a| a.0.as_str()))), acc) {
            // The law's route for a refused claim: whether it may be asked to be looked at again, still, and appealed.
            let dec = g.about.as_deref().filter(|_| g.matter == "claim_refused").and_then(|a| book.get(a));
            let law = dec.and_then(|d| decision_law(book, "benefit_decision", data(d).s("payment").or(g.seeks.as_deref())));
            let decided_at = p.decided_at(g);
            let review = law.as_ref().and_then(|l| l.get("review")).filter(|v| !v.is_null());
            let appeal = law.as_ref().and_then(|l| l.get("appeal")).filter(|v| !v.is_null());
            let may_ask_g = law.is_none() || (review.is_some() && decided_at.is_some_and(|d| days_left(d, review.and_then(|r| r.i("within_days")).unwrap_or(0), t) >= 0));
            // A review asked for and never answered, where the law takes silence as a refusal after so many days (a
            // deemed refusal): the appeal's days run from then, as from an answer (MT-21).
            let deemed = review.and_then(|r| r.i("deemed_refused_days")).zip(g.asked).map(|(d, a)| a + d * DAY).filter(|at| g.answered_at.is_none() && t >= *at);
            let may_apply = law.is_none() || {
                if review.is_some() && g.answer.is_none() && deemed.is_none() {
                    false
                } else if let Some(a) = appeal {
                    let from = if review.is_some_and(|r| r.flag("required")) { g.answered_at.or(deemed) } else { decided_at };
                    from.is_some_and(|f| days_left(f, a.i("within_days").unwrap_or(0), t) >= 0)
                } else {
                    false
                }
            };
            if g.asked.is_none() && may_ask_g {
                let mut o = Self::open(format!("ask:{}", g.party), "ask", Intent::AskPutRight { grievance: g.key.clone() });
                o.by = Some(g.party.clone());
                o.bears = vec![g.party.clone()];
                out.push(o);
            }
            // (A venue is for what asking did not settle: after a no, nothing, or a yes not done.)
            let after_asking = g.answer.as_deref().is_some_and(|a| a != "granted") || (law.is_some() && review.is_none()) || deemed.is_some();
            if after_asking && may_apply {
                for h in book.hearings() {
                    let venue = h.speaks_for.clone().unwrap_or_else(|| h.author.clone());
                    let Some(offer) = offer_of(h) else { continue };
                    let hears = offer.get("hears").and_then(Value::as_array).is_some_and(|a| a.iter().any(|x| x.s("about") == Some(g.matter.as_str())));
                    if !hears || venue == g.party || venue == me || g.applied.contains_key(&venue) {
                        continue;
                    }
                    if let Some(m) = offer.get("to").and_then(|x| x.s("members_of")) {
                        if !p.member_of(m) {
                            continue;
                        }
                    }
                    let cost = venue_fee(offer).map_or(0, |f| f.1);
                    if cost > acc.balance {
                        continue;
                    }
                    let mut o = Self::open(format!("desk:{venue}"), "desk", Intent::Venue { grievance: g.key.clone(), venue: venue.clone(), hearing: h.id.clone(), cost });
                    o.on = Some(h.id.clone());
                    o.by = Some(venue.clone());
                    o.bears = vec![g.party.clone()];
                    o.cost = (cost > 0).then_some(cost);
                    o.venue = true;
                    out.push(o);
                }
            }
            if self.contacts > 0 && !g.told {
                let mut o = Self::open("tell".into(), "tell", Intent::TellWronged { grievance: g.key.clone(), whom: vec![] });
                o.bears = vec![g.party.clone()];
                o.others = Some(0);
                out.push(o);
            }
        }
        out
    }

    fn grievance(&self, want: &WantView) -> Option<GrievanceView> {
        let g = self.person.recourse.grievances.get(&gkey(&want.about, want.whom.as_deref().unwrap_or(""), want.against.as_ref().map(|a| a.0.as_str())))?;
        Some(GrievanceView {
            key: g.key.clone(),
            matter: g.matter.clone(),
            party: g.party.clone(),
            since: g.since,
            amount: g.amount,
            asked_at: g.asked,
            answer: g.answer.clone(),
            venues: g.applied.len() as u32,
            told: g.told,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::mind::{Conduct, Decide, Decision, Heard, Life, Mind, Outlook, Planned, Tie};
    use super::super::person::{Home, Job};
    use super::*;
    use crate::common::{Book, OwnAccount};
    use crate::{Ctx, Draws, WorldInfo};
    use oikos_sight::calls::Value as Arg;
    use oikos_sight::{Picture, Seen};

    const ME: &str = "c1";
    const HOME: &str = "apts-1/dwelling.1";

    /// A mind for these tests: angry as told, close to whom it is told, and keeping what it was told (its save).
    #[derive(Default)]
    struct Kept {
        anger: i64,
        close: Vec<String>,
        contacts: Vec<String>,
        said: Vec<Value>,
    }
    impl Outlook for Kept {
        fn value_z(&self, _: &str) -> i64 {
            0
        }
        fn facet(&self, _: &str) -> i64 {
            5_000
        }
        fn trust_z(&self, _: &str) -> i64 {
            0
        }
        fn agency_z(&self) -> i64 {
            0
        }
        fn attached(&self, _: &str) -> i64 {
            0
        }
        fn feeling(&self, e: &str, _: &str, _: i64) -> i64 {
            if e == "anger" {
                self.anger
            } else {
                0
            }
        }
        fn affinity(&self, _: &str, _: i64) -> i64 {
            0
        }
        fn closest(&self, n: usize, _: i64) -> Vec<Tie> {
            self.close.iter().take(n).map(|w| Tie { who: w.clone(), affinity_bps: 5_000, trust_bps: None }).collect()
        }
        fn contact(&self, who: &str) -> bool {
            self.contacts.iter().any(|c| c == who)
        }
        fn contacts(&self) -> usize {
            self.contacts.len()
        }
        fn learned(&self, _: &str, _: &str) -> Option<i64> {
            None
        }
        fn wants(&self) -> Vec<WantView> {
            vec![]
        }
        fn initiative(&self) -> bool {
            true
        }
        fn pursuing(&self, _: &str) -> bool {
            false
        }
        fn at_gathering(&self, _: i64) -> Option<String> {
            None
        }
        fn patience_days(&self) -> i64 {
            1_000
        }
        fn satisfaction(&self, _: &Life) -> i64 {
            5_000
        }
    }
    impl Mind for Kept {
        fn woke(&mut self, _: &mut Cx, _: &Picture, _: &Book, _: &Life) {}
        fn decide(&mut self, _: &mut Cx, _: &Life, _: Decide) -> Decision {
            Decision::default()
        }
        fn choose_known(&mut self, _: &mut Cx, _: &str, _: &[String], _: Option<u64>) -> Option<String> {
            None
        }
        fn choose_conduct(&mut self, _: &mut Cx, _: &Life, c: ConductAsk) -> Conduct {
            self.said.push(json!({ "conduct": c.conduct, "act": c.act, "forced": c.forced }));
            Conduct { does: c.forced || c.draw_bps < c.base_bps, bps: c.base_bps, facts: BTreeMap::new() }
        }
        fn outcome(&mut self, _: &mut Cx, _: &Life, o: Outcome) {
            self.said.push(json!({ "domain": o.domain, "option": o.option, "kind": o.kind, "facts": o.facts, "payoff": o.payoff }));
        }
        fn treated(&mut self, _: &mut Cx, t: Treated) {
            self.said.push(json!({ "treated": t.who, "good": t.good }));
        }
        fn event(&mut self, _: &mut Cx, _: &oikos_sight::Picture, _: &crate::common::Book, _: &Life, e: Event, _: &dyn Openings) -> Heard {
            if let Event::Grieved { matter, party, .. } = &e {
                self.said.push(json!({ "grieved": matter, "by": party }));
            }
            if let Event::ServiceLapsed { share_bps, .. } = &e {
                self.said.push(json!({ "lapsed": share_bps }));
            }
            if let Event::Other { what, about, facts } = &e {
                self.said.push(json!({ "other": what, "about": about, "facts": facts }));
            }
            Heard::Taken
        }
        fn plan(&mut self, _: &mut Cx, _: &Picture, _: &Book, _: &Life, _: &dyn Openings) -> Planned {
            Planned::default()
        }
        fn say_how(&mut self, _: &mut Cx, _: &str, _: &Life) -> String {
            String::new()
        }
        fn troubles_to_tell(&mut self) -> Vec<(String, String)> {
            vec![]
        }
        fn record(&mut self, _: &mut Cx, _: &Life) {}
        fn words_done(&mut self, _: &mut Cx, _: &str, _: bool, _: Option<&str>) {}
        fn save(&self) -> Result<Value, String> {
            Ok(Value::from(self.said.clone()))
        }
    }

    fn ctx(params: Value, dial: bool) -> Ctx {
        let currency = oikos_sight::calls::Currency { code: "XTS".into(), symbol: Some("$".into()), minor_units: 2, ..Default::default() };
        let mut params = params;
        params["mind"] = json!("plain");
        params["bank"] = json!("bank");
        let dials = if dial { json!({ "friction_bps": 10_000 }) } else { json!({}) };
        Ctx { participant: "c1-self".into(), performer: Default::default(), entity: ME.into(), position: None, params: serde_json::from_value(params).unwrap(), world: Arc::new(WorldInfo { currency: Some(currency), dials, ..Default::default() }) }
    }
    fn person(c: &Ctx, anger: i64) -> Person {
        let mut p = Person::new(c).unwrap();
        p.mind = Box::new(Kept { anger, close: vec!["c2".into(), "c3".into()], ..Default::default() });
        p
    }
    fn said(p: &Person) -> Vec<Value> {
        match p.mind.save().unwrap() {
            Value::Array(a) => a,
            _ => vec![],
        }
    }
    fn rec(v: Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).expect("a record"))
    }
    fn statement(id: &str, at: i64, kind_: &str, from: &str, d: Value) -> Arc<Record> {
        rec(json!({ "id": id, "record": "statement", "author": format!("{from}-office"), "speaks_for": from, "at": at, "visible_to": [from, ME], "addressed_to": [ME], "kind": kind_, "text": kind_, "data": d }))
    }
    fn hearing(id: &str, venue: &str, about: &str) -> Arc<Record> {
        rec(json!({ "id": id, "record": "statement", "author": format!("{venue}-office"), "speaks_for": venue, "at": 0, "visible_to": "public", "kind": "offer", "text": "We hear these.",
            "offer": { "take_up": "apply", "hears": [{ "about": about }] } }))
    }
    fn pic(t: i64, records: Vec<Arc<Record>>) -> Picture {
        let mut channels = BTreeMap::new();
        channels.insert("papers".to_string(), Seen::Records { records, search: false });
        let a = oikos_sight::AccountItem { account: "acc-c1".into(), holder: ME.into(), custodian: "bank".into(), currency: "XTS".into(), balance: 5_000_000, closed: None };
        channels.insert("accounts".to_string(), Seen::Accounts { accounts: Arc::new(vec![a]), transactions: vec![] });
        Picture {
            participant: "c1-self".into(),
            t,
            status: oikos_sight::ParticipantStatus::Active,
            entity: ME.into(),
            as_position: None,
            body: None,
            positions: vec![],
            outcomes: vec![],
            inbox: vec![],
            channels,
            asking: vec![],
            readings: BTreeMap::new(),
            woke_for: "cadence".into(),
            since: 0,
        }
    }
    fn acc() -> Option<OwnAccount> {
        Some(OwnAccount { account: "acc-c1".into(), balance: 5_000_000, custodian: "bank".into(), currency: "XTS".into() })
    }
    /// One part (or several) at a wake, after the picture is taken in as absorb takes it: the statements that went
    /// out, as (kind, text, to, basis, data), and every call's name.
    fn at(p: &mut Person, c: &Ctx, pc: &Picture, part: impl FnOnce(&mut Person, &mut Week)) -> (Vec<(String, String, Value, Option<String>, Value)>, Vec<String>) {
        let fresh = p.book.absorb(pc);
        p.absorbed.fresh = fresh.iter().map(|r| r.id.clone()).collect();
        let mut d = Draws::default();
        let mut cx = crate::Cx::new(pc.t, c, &mut d, 1, vec![]);
        let mut w = Week { pic: pc, cx: &mut cx, t: pc.t, acc: acc(), steps: vec![] };
        part(p, &mut w);
        let mut out = vec![];
        let mut fns = vec![];
        for s in &w.steps {
            for l in &s.step.lines {
                fns.push(l.call.fn_.clone());
                if l.call.fn_ != "statement" {
                    continue;
                }
                let get = |k: &str| l.call.args.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
                let s_of = |v: Option<Arg>| match v {
                    Some(Arg::Id(s)) | Some(Arg::Text(s)) => Some(s),
                    _ => None,
                };
                let j_of = |v: Option<Arg>| match v {
                    Some(Arg::Json(j)) => j,
                    _ => Value::Null,
                };
                out.push((s_of(get("kind")).unwrap_or_default(), s_of(get("text")).unwrap_or_default(), j_of(get("to")), s_of(get("basis")), j_of(get("data"))));
            }
        }
        (out, fns)
    }
    fn want(about: &str, whom: &str, against: Option<(&str, &str)>, seeks: &[&str]) -> WantView {
        WantView { about: about.into(), whom: Some(whom.into()), against: against.map(|(r, k)| (r.into(), k.into(), whom.into())), seeks: seeks.iter().map(|s| s.to_string()).collect(), weight_bps: 5_000, since: 0 }
    }
    fn ways(p: &Person, pc: &Picture, w: &WantView) -> Vec<Opening> {
        Ways { person: p, pic: pc, contacts: p.mind.contacts() }.for_want(w, pc.t)
    }
    fn tenant(p: &mut Person) {
        p.s.home = Some(Home { agreement: "L1".into(), space: HOME.into(), structure: "apts-1".into(), landlord: "landlord-1".into(), rent: 100_000, moved_in: true, ..Default::default() });
    }
    fn in_work(p: &mut Person) {
        p.s.job = Some(Job { agreement: "J1".into(), employer: "factory-1".into(), wage: 120_000, period: 14 * DAY, since: 0, ..Default::default() });
    }

    #[test]
    fn a_grievance_is_held_once_its_sum_kept_up_and_seen_as_the_mind_asks() {
        let c = ctx(json!({}), true);
        let mut p = person(&c, 0);
        in_work(&mut p);
        at(&mut p, &c, &pic(15 * DAY, vec![]), |p, w| {
            p.grieve(w, "underpaid", "factory-1", Some("J1"), Some(6_000), None, 8_000, "security", Some("short pay"));
            p.grieve(w, "underpaid", "factory-1", Some("J1"), Some(9_000), None, 8_000, "security", Some("short pay"));
        });
        assert_eq!(said(&p), vec![json!({ "grieved": "underpaid", "by": "factory-1" })], "said to the mind once");
        let g = &p.recourse.grievances["underpaid:J1"];
        assert_eq!((g.amount, g.since), (Some(9_000), 15 * DAY));
        let pc = pic(16 * DAY, vec![]);
        let view = Ways { person: &p, pic: &pc, contacts: p.mind.contacts() }.grievance(&want("underpaid", "factory-1", Some(("J1", "underpaid")), &["money.to"])).unwrap();
        assert_eq!((view.key.as_str(), view.amount, view.asked_at), ("underpaid:J1", Some(9_000), None));
    }

    #[test]
    fn someone_underpaid_asks_refused_takes_it_to_a_body_that_hears_pay_and_paid_under_its_decision_it_is_over() {
        let c = ctx(json!({}), true);
        let mut p = person(&c, 0);
        in_work(&mut p);
        let agreement = rec(json!({ "id": "J1", "record": "agreement", "author": "p.f", "at": 0, "visible_to": ["factory-1", ME], "terms": { "template": "employment", "parties": ["factory-1", ME], "commitments": [] } }));
        at(&mut p, &c, &pic(15 * DAY, vec![agreement]), |p, w| {
            p.s.job.as_mut().unwrap().short = Some(6_000);
            p.short_pay(w);
        });
        let wnt = want("underpaid", "factory-1", Some(("J1", "underpaid")), &["money.to"]);
        let pc = pic(22 * DAY, vec![]);
        let asks: Vec<Opening> = ways(&p, &pc, &wnt).into_iter().filter(|o| o.kind == "ask").collect();
        assert_eq!(asks.iter().map(|o| o.key.as_str()).collect::<Vec<_>>(), ["ask:factory-1"]);
        let intent = asks[0].intent.clone();
        let (out, _) = at(&mut p, &c, &pc, |p, w| p.carry_out(w, &intent, None));
        assert_eq!((out[0].0.as_str(), &out[0].2), ("review_request", &json!(["factory-1"])));
        assert_eq!(out[0].4, json!({ "matter": "underpaid", "against": "factory-1", "about": "J1", "amount": 6_000, "account": "acc-c1" }));
        assert!(ways(&p, &pc, &wnt).iter().all(|o| o.kind != "ask"), "asked once");
        // Refused; two bodies say what they hear, one of them pay.
        let refusal = statement("ans-1", 70 * DAY, "remedy_answer", "factory-1", json!({ "request": "x", "matter": "underpaid", "granted": false }));
        let pc = pic(70 * DAY, vec![refusal, hearing("h1", "ombudsman", "underpaid"), hearing("h2", "consumer-desk", "goods")]);
        at(&mut p, &c, &pc, |p, w| p.opening_caseload(w));
        assert_eq!(p.recourse.grievances["underpaid:J1"].answer.as_deref(), Some("refused"));
        let desks: Vec<Opening> = ways(&p, &pc, &wnt).into_iter().filter(|o| o.venue).collect();
        assert_eq!(desks.iter().map(|o| o.key.as_str()).collect::<Vec<_>>(), ["desk:ombudsman"], "found by what it says it hears");
        let intent = desks[0].intent.clone();
        let (out, _) = at(&mut p, &c, &pic(77 * DAY, vec![]), |p, w| p.carry_out(w, &intent, None));
        let (k, _, to, basis, d) = &out[0];
        assert_eq!((k.as_str(), to, basis.as_deref()), ("application", &json!(["ombudsman"]), Some("h1")));
        assert_eq!((d["kind"].as_str(), d["amount"].as_i64(), d["account"].as_str()), (Some("underpaid"), Some(6_000), Some("acc-c1")));
        assert_eq!(d["evidence"]["id"], json!("J1"), "the agreement, tendered");
        assert_eq!(d["particulars"], json!("underpaid against factory-1, about J1; the sum: $60.00; it arose on year 1, day 16; we asked them on year 1, day 23 and they refused; made on year 1, day 78."));
        // Recommended to pay, and paid: over.
        let t = 77 * DAY;
        let dec = rec(json!({ "id": "dec-1", "record": "statement", "author": "ombudsman-office", "speaks_for": "ombudsman", "at": t + 20 * DAY, "visible_to": [ME, "factory-1", "ombudsman"], "addressed_to": [ME, "factory-1"], "kind": "venue_decision", "text": "Decided.",
            "data": { "application": "x", "matter": "underpaid", "applicant": ME, "against": "factory-1", "finding": "pay", "binding": false, "amount": 6_000, "to": "acc-c1", "due": t + 48 * DAY } }));
        at(&mut p, &c, &pic(t + 21 * DAY, vec![dec]), |p, w| p.opening_caseload(w));
        assert!(p.recourse.grievances["underpaid:J1"].ordered.is_some());
        p.absorbed.settled_to_us.insert("dec-1".into(), 6_000);
        at(&mut p, &c, &pic(t + 28 * DAY, vec![]), |p, w| p.disrepair(w));
        assert!(p.recourse.grievances.is_empty());
        let ended: Vec<Value> = said(&p).into_iter().filter(|x| x["kind"] == "ended").collect();
        assert_eq!(ended.len(), 1);
        assert_eq!((ended[0]["facts"]["how"].as_str(), ended[0]["facts"]["put_right"].as_bool(), ended[0]["facts"]["venues"].as_i64()), (Some("paid on a recommendation"), Some(true), Some(1)));
        // (The mind is told it is over, for the want it bore (met: it was put right) and its note; until 2026-10-18 the
        // want outlived the grievance, with nothing left to answer it.)
        let over: Vec<Value> = said(&p).into_iter().filter(|x| x["other"] == "friction_ended").collect();
        assert_eq!(over.len(), 1);
        assert_eq!(over[0]["about"], json!("J1"));
        assert_eq!((over[0]["facts"]["matter"].as_str(), over[0]["facts"]["met"].as_str()), (Some("underpaid"), Some("good")));
        assert_eq!(over[0]["facts"]["by"], json!("paid on a recommendation; asked: refused; venues: 1"));
        assert_eq!(p.s.job.as_ref().unwrap().short, None);
    }

    #[test]
    fn a_home_in_disrepair_is_the_landlords_to_put_right_repaired_it_is_over_and_with_the_dial_off_nobodys() {
        let site = |value: i64| {
            serde_json::from_value::<oikos_sight::SiteStructure>(json!({ "structure": "apts-1", "type": "apartments", "at": "cell.1.1", "w": 1, "h": 1, "complete": true,
                "variables": { "disrepair": { "value": value, "as_of_day": 0, "per_day": 0, "min": 0, "max": 100_000 } }, "spaces": [] }))
            .unwrap()
        };
        let params = json!({ "frictions": { "disrepair": { "variable": "disrepair", "at": 50_000 } } });
        let c = ctx(params.clone(), true);
        let mut p = person(&c, 0);
        tenant(&mut p);
        p.absorbed.home_site = Some(std::sync::Arc::new(site(10_000)));
        at(&mut p, &c, &pic(DAY, vec![]), |p, w| p.disrepair(w));
        assert!(p.recourse.grievances.is_empty());
        p.absorbed.home_site = Some(std::sync::Arc::new(site(60_000)));
        at(&mut p, &c, &pic(8 * DAY, vec![]), |p, w| p.disrepair(w));
        let g = &p.recourse.grievances["disrepair:landlord-1"];
        assert_eq!((g.structure.as_deref(), g.seeks.as_deref()), (Some("apts-1"), Some("repair")));
        // Asked of the landlord, the request says where and what is sought.
        let pc = pic(15 * DAY, vec![]);
        let o = ways(&p, &pc, &want("disrepair", "landlord-1", None, &[])).into_iter().find(|o| o.kind == "ask").unwrap();
        let (out, _) = at(&mut p, &c, &pc, |p, w| p.carry_out(w, &o.intent, None));
        assert_eq!(out[0].4, json!({ "matter": "disrepair", "against": "landlord-1", "structure": "apts-1", "seeks": "repair" }));
        assert_eq!(out[0].1, "Request: please put this right (disrepair at apts-1).");
        p.absorbed.home_site = Some(std::sync::Arc::new(site(0)));
        at(&mut p, &c, &pic(20 * DAY, vec![]), |p, w| p.disrepair(w));
        assert!(p.recourse.grievances.is_empty());
        assert!(said(&p).iter().any(|x| x["kind"] == "ended" && x["facts"]["how"] == "repaired"));
        let off = ctx(params, false);
        let mut q = person(&off, 0);
        tenant(&mut q);
        q.absorbed.home_site = Some(std::sync::Arc::new(site(60_000)));
        at(&mut q, &off, &pic(8 * DAY, vec![]), |p, w| p.disrepair(w));
        assert!(q.recourse.grievances.is_empty());
    }

    #[test]
    fn a_rise_is_asked_of_the_landlord_in_typed_terms_and_an_answer_refused_lets_the_notice_stand() {
        let c = ctx(json!({}), true);
        let mut p = person(&c, 0);
        tenant(&mut p);
        let pc = pic(40 * DAY, vec![statement("inc-1", 40 * DAY, "rent_increase", "landlord-1", json!({ "lease": "L1", "rent": "105000" }))]);
        p.book.absorb(&pc);
        let o = ways(&p, &pc, &want("rent_increase", "landlord-1", Some(("inc-1", "rent_increase")), &["money.from"])).into_iter().find(|o| o.key == "ask:landlord-1").unwrap();
        assert_eq!((o.undoes.as_deref(), o.on.as_deref()), (Some("inc-1"), Some("inc-1")));
        let (out, _) = at(&mut p, &c, &pc, |p, w| p.carry_out(w, &o.intent, None));
        assert_eq!(out[0].1, format!("Request: please hold the rent for {HOME} at $1,000.00 a month."));
        assert_eq!((out[0].3.as_deref(), &out[0].4), (Some("inc-1"), &json!({ "agreement": "L1", "about": "inc-1", "would": { "who": ME, "does": { "outcome": { "money": { "amount": "100000" } } }, "every": 30 * DAY } })));
        assert!(ways(&p, &pc, &want("rent_increase", "landlord-1", Some(("inc-1", "rent_increase")), &["money.from"])).iter().all(|o| o.kind != "ask"), "not asked again so soon");
        p.s.asked_of.insert("inc-1".into(), (40 * DAY, "landlord-1".into()));
        at(&mut p, &c, &pic(47 * DAY, vec![statement("ans-1", 46 * DAY, "variation_answer", "landlord-1", json!({ "about": "inc-1", "granted": false }))]), |p, w| p.answers(w));
        assert_eq!(p.housing.upheld, ["inc-1"]);
        assert!(said(&p).iter().any(|x| x["domain"] == "way" && x["kind"] == "refused" && x["payoff"] == 1_000));
    }

    #[test]
    fn a_rise_granted_by_the_employer_is_our_pay_from_then() {
        let c = ctx(json!({}), true);
        let mut p = person(&c, 0);
        in_work(&mut p);
        p.s.job.as_mut().unwrap().since = -400 * DAY;
        let pc = pic(DAY, vec![]);
        let o = ways(&p, &pc, &want("pay", "factory-1", None, &["money.to"])).into_iter().find(|o| o.key == "ask:factory-1").unwrap();
        assert_eq!(o.intent, Intent::AskRise { agreement: "J1".into(), wage: 126_000 });
        at(&mut p, &c, &pic(20 * DAY, vec![statement("ans-1", 19 * DAY, "variation_answer", "factory-1", json!({ "about": "J1", "granted": true, "wage": 126_000 }))]), |p, w| p.answers(w));
        assert_eq!(p.s.job.as_ref().map(|j| (j.wage, j.paid_at)), Some((126_000, Some(20 * DAY))));
    }

    #[test]
    fn a_caseload_brought_forward_is_a_grievance_already_asked_and_not_asked_again() {
        let c = ctx(json!({}), true);
        let mut p = person(&c, 0);
        tenant(&mut p);
        let mine = rec(json!({ "id": "rq-0", "record": "statement", "author": "c1-self", "speaks_for": ME, "at": 0, "visible_to": [ME, "landlord-1"], "addressed_to": ["landlord-1"], "kind": "review_request", "text": "Request.",
            "data": { "matter": "disrepair", "against": "landlord-1", "structure": "apts-1", "seeks": "repair", "since": -20 * DAY, "brought_forward": true } }));
        at(&mut p, &c, &pic(0, vec![mine]), |p, w| p.opening_caseload(w));
        let g = &p.recourse.grievances["disrepair:landlord-1"];
        assert_eq!((g.since, g.asked, g.seeks.as_deref()), (-20 * DAY, Some(-20 * DAY), Some("repair")));
        let pc = pic(DAY, vec![]);
        assert!(ways(&p, &pc, &want("disrepair", "landlord-1", None, &[])).iter().all(|o| o.kind != "ask"));
    }

    #[test]
    fn uncollected_waste_is_written_about_when_angry_enough_once_until_seen_to() {
        let site = |value: i64| {
            serde_json::from_value::<oikos_sight::SiteStructure>(json!({ "structure": "apts-1", "type": "apartments", "at": "cell.1.1", "w": 1, "h": 1, "complete": true,
                "variables": { "waste": { "value": value, "as_of_day": 0, "per_day": 0, "min": 0, "max": 100_000 } }, "spaces": [] }))
            .unwrap()
        };
        let c = ctx(json!({ "complain_to": "town", "complain_bps": 10_000 }), true);
        let mut p = person(&c, 8_000);
        tenant(&mut p);
        p.absorbed.home_site = Some(std::sync::Arc::new(site(5_000)));
        p.absorbed.bin_seen.structure = "apts-1".into();
        p.absorbed.bin_seen.emptied_at = 0;
        let (none, _) = at(&mut p, &c, &pic(5 * DAY, vec![]), |p, w| p.complaints(w));
        assert!(none.is_empty(), "not a week yet");
        let (out, _) = at(&mut p, &c, &pic(8 * DAY, vec![]), |p, w| p.complaints(w));
        assert_eq!((out[0].0.as_str(), &out[0].4), ("complaint", &json!({ "structure": "apts-1", "about": "waste", "days": 8 })));
        assert!(said(&p).iter().any(|x| x["domain"] == "complaint" && x["kind"] == "made"));
        let (again, _) = at(&mut p, &c, &pic(15 * DAY, vec![]), |p, w| p.complaints(w));
        assert!(again.is_empty(), "once until seen to");
        assert!(ways(&p, &pic(15 * DAY, vec![]), &want("service", "town", None, &[])).iter().all(|o| o.key != "desk:town"));
        p.absorbed.bin_seen.emptied_at = 15 * DAY;
        at(&mut p, &c, &pic(16 * DAY, vec![]), |p, w| p.complaints(w));
        assert!(said(&p).iter().any(|x| x["domain"] == "complaint" && x["kind"] == "seen_to"));
        // (With a week's chance of nothing, a complaint the mind's way chose is written all the same.)
        let c0 = ctx(json!({ "complain_to": "town", "complain_bps": 0 }), true);
        let mut q = person(&c0, 8_000);
        tenant(&mut q);
        q.absorbed.home_site = Some(std::sync::Arc::new(site(5_000)));
        q.absorbed.bin_seen.structure = "apts-1".into();
        q.absorbed.bin_seen.emptied_at = 0;
        assert!(at(&mut q, &c0, &pic(8 * DAY, vec![]), |p, w| p.complaints(w)).0.is_empty());
        let (forced, _) = at(&mut q, &c0, &pic(9 * DAY, vec![]), |p, w| {
            p.carry_out(w, &Intent::Complain, None);
            p.complaints(w);
        });
        assert_eq!(forced.len(), 1);
    }

    #[test]
    fn a_debt_left_unpaid_is_applied_over_less_what_was_paid_and_an_unpaid_order_enforced() {
        let c = ctx(json!({ "tribunal": { "entity": "tribunal", "challenge_bps": 0, "apply_bps": 10_000, "apply_after_days": 30 } }), true);
        let mut p = person(&c, 0);
        let claim = rec(json!({ "id": "cl-1", "record": "claim", "author": "c1-self", "at": 0, "visible_to": [ME, "c9"], "position": "right", "holder": ME, "counterparty": "c9", "about": { "kind": "debt", "amount": "50000", "for": "a loan" } }));
        p.absorbed.settled_to_us.insert("cl-1".into(), 10_000);
        let (none, _) = at(&mut p, &c, &pic(10 * DAY, vec![claim]), |p, w| p.justice(w));
        assert!(none.is_empty(), "not yet");
        assert!(ways(&p, &pic(10 * DAY, vec![]), &want("debt", "c9", None, &["money.to"])).iter().any(|o| o.intent == Intent::ApplyDebt { claim: "cl-1".into() }));
        let (out, _) = at(&mut p, &c, &pic(31 * DAY, vec![]), |p, w| p.justice(w));
        assert_eq!(out.len(), 1);
        assert_eq!((out[0].0.as_str(), out[0].4["amount"].as_i64(), out[0].4["claim"].as_str()), ("tribunal_application", Some(40_000), Some("cl-1")));
        let order = statement("ord-1", 40 * DAY, "tribunal_order", "tribunal", json!({ "kind": "debt", "finding": "pay", "applicant": ME, "against": "c9", "claim": "cl-1", "amount": 40_000, "due": 60 * DAY }));
        assert!(at(&mut p, &c, &pic(41 * DAY, vec![order]), |p, w| p.justice(w)).0.is_empty(), "not due yet");
        let (enf, _) = at(&mut p, &c, &pic(62 * DAY, vec![]), |p, w| p.justice(w));
        assert_eq!((enf[0].0.as_str(), &enf[0].4), ("enforcement_request", &json!({ "order": "ord-1", "unpaid": 40_000 })));
        p.absorbed.settled_to_us.insert("cl-1".into(), 50_000);
        at(&mut p, &c, &pic(70 * DAY, vec![]), |p, w| p.justice(w));
        assert_eq!(said(&p).iter().filter(|x| x["domain"] == "debt" && x["kind"] == "settled").count(), 1);
        // (An order on a notice of rent increase found valid: the notice applies after all.)
        let valid = statement("ord-2", 71 * DAY, "tribunal_order", "tribunal", json!({ "kind": "rent_increase", "finding": "valid", "applicant": ME, "notice": "inc-1" }));
        at(&mut p, &c, &pic(71 * DAY, vec![valid]), |p, w| p.justice(w));
        assert_eq!(p.housing.upheld, ["inc-1"]);
    }

    #[test]
    fn telling_those_we_know_what_was_done_goes_to_the_closest_we_know() {
        let c = ctx(json!({}), true);
        let mut p = person(&c, 0);
        in_work(&mut p);
        p.mind = Box::new(Kept { close: vec!["c2".into(), "c3".into()], contacts: vec!["c2".into()], ..Default::default() });
        at(&mut p, &c, &pic(DAY, vec![]), |p, w| {
            p.grieve(w, "underpaid", "factory-1", Some("J1"), Some(6_000), None, 8_000, "security", None);
        });
        let pc = pic(2 * DAY, vec![]);
        let o = ways(&p, &pc, &want("underpaid", "factory-1", Some(("J1", "underpaid")), &["money.to"])).into_iter().find(|o| o.kind == "tell").unwrap();
        let (_, fns) = at(&mut p, &c, &pc, |p, w| {
            p.carry_out(w, &o.intent, None);
            assert_eq!(w.steps.len(), 1);
            let text = oikos_sight::calls::program_text(&w.steps[0].step.program());
            assert!(text.contains("factory-1 has done wrong by me (underpaid).") && text.contains("c2") && !text.contains("c3"), "{text}");
        });
        assert_eq!(fns.len(), 1);
        assert!(p.recourse.grievances["underpaid:J1"].told);
    }

    /// A refused claim whose law requires a review before an appeal, with or without a deemed refusal; asked for at
    /// day 10 and never answered (MT-21).
    fn unanswered_review(deemed: Option<i64>) -> (Ctx, Person, Vec<Arc<Record>>) {
        let c = ctx(json!({}), true);
        let mut p = person(&c, 0);
        let mut review = json!({ "within_days": 30, "grounds": "any", "required": true });
        if let Some(d) = deemed {
            review["deemed_refused_days"] = json!(d);
        }
        let law = rec(json!({ "id": "law-decisions", "record": "statement", "author": "genesis", "speaks_for": "outside", "at": 0, "visible_to": "public", "kind": "law", "text": "Decisions.",
            "data": { "decisions": [{ "kind": "benefit_decision", "name": "Support", "payments": ["pension"], "review": review, "appeal": { "matter": "claim_refused", "within_days": 30, "grounds": "any error" } }] } }));
        let dec = statement("dec-1", 5 * DAY, "benefit_decision", "support", json!({ "claim": "cl-1", "payment": "pension", "granted": false, "reason": "papers" }));
        let world = vec![law, dec, hearing("h1", "tribunal", "claim_refused")];
        at(&mut p, &c, &pic(5 * DAY, world.clone()), |p, w| {
            let g = p.grieve(w, "claim_refused", "support", Some("dec-1"), None, None, 10_000, "security", Some("papers"));
            g.seeks = Some("pension".into());
        });
        let wnt = want("claim_refused", "support", Some(("dec-1", "claim_refused")), &["money.to"]);
        let pc = pic(10 * DAY, vec![]);
        let ask = ways(&p, &pc, &wnt).into_iter().find(|o| o.kind == "ask").expect("a review may be asked for");
        at(&mut p, &c, &pc, |p, w| p.carry_out(w, &ask.intent, None));
        (c, p, world)
    }

    #[test]
    fn a_review_never_answered_is_taken_as_refused_where_the_law_says_so_and_the_appeal_runs_from_then() {
        let wnt = want("claim_refused", "support", Some(("dec-1", "claim_refused")), &["money.to"]);
        let (c, mut p, _) = unanswered_review(Some(91));
        assert_eq!(p.recourse.grievances.values().next().unwrap().asked, Some(10 * DAY));
        // Unanswered past the claimant's patience: ignored, but the law's days have not run; no appeal yet.
        at(&mut p, &c, &pic(30 * DAY, vec![]), |p, w| p.disrepair(w));
        assert_eq!(p.recourse.grievances.values().next().unwrap().answer.as_deref(), Some("ignored"));
        assert!(ways(&p, &pic(100 * DAY, vec![]), &wnt).iter().all(|o| !o.venue), "the review is not yet taken as refused");
        // 91 days after asking: taken as refused; the tribunal is open, and the application says when the review was asked.
        let pc = pic(101 * DAY, vec![]);
        let venues: Vec<Opening> = ways(&p, &pc, &wnt).into_iter().filter(|o| o.venue).collect();
        assert_eq!(venues.iter().map(|o| o.key.as_str()).collect::<Vec<_>>(), ["desk:tribunal"]);
        let intent = venues[0].intent.clone();
        let (out, _) = at(&mut p, &c, &pc, |p, w| p.carry_out(w, &intent, None));
        assert_eq!((out[0].4["review_asked_on"].as_i64(), out[0].4.get("reviewed_on")), (Some(10 * DAY), None));
        // The appeal's 30 days run from the deemed refusal (day 101): gone by day 132.
        let (_, q, _) = unanswered_review(Some(91));
        assert!(ways(&q, &pic(131 * DAY, vec![]), &wnt).iter().any(|o| o.venue));
        assert!(ways(&q, &pic(132 * DAY, vec![]), &wnt).iter().all(|o| !o.venue), "out of time");
    }

    #[test]
    fn without_a_deemed_refusal_in_the_law_an_unanswered_review_still_leads_nowhere() {
        let wnt = want("claim_refused", "support", Some(("dec-1", "claim_refused")), &["money.to"]);
        let (c, mut p, _) = unanswered_review(None);
        at(&mut p, &c, &pic(30 * DAY, vec![]), |p, w| p.disrepair(w));
        for d in [31, 101, 200] {
            assert!(ways(&p, &pic(d * DAY, vec![]), &wnt).iter().all(|o| !o.venue), "day {d}: the law's route, as the place has it");
        }
    }

    #[test]
    fn a_lapsed_notice_to_vacate_is_told_to_the_mind_once() {
        let c = ctx(json!({}), true);
        let mut p = person(&c, 0);
        p.housing.notice_over.insert("L1".into());
        at(&mut p, &c, &pic(DAY, vec![]), |p, w| p.disrepair(w));
        at(&mut p, &c, &pic(2 * DAY, vec![]), |p, w| p.disrepair(w));
        assert_eq!(said(&p).iter().filter(|x| x["kind"] == "notice_lapsed").count(), 1);
    }
}
