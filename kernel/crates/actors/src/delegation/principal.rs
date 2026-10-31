//! A principal: whatever code a post or a person already runs, wrapped so that it can hand kinds of matter to an assistant
//! it has engaged (docs/design/delegation.md sections 3 to 5).
//!
//! **Its own work is unchanged.** The inner actor is stepped on every wake with what it was shown, and everything it sends
//! goes as it would, except an act every part of which is of a kind it has delegated, at a level that hands it over
//! (`draft`, `approve`, `alone`): that act becomes a `referral` to the assistant, and the inner actor is told nothing until
//! the assistant reports (then it hears of its act as done, with what the assistant's act made) or the principal does it
//! itself (a draft it declined, a matter reported not done: then it hears of its own act). At `advice` the principal does
//! the act itself and asks what the assistant would have done.
//!
//! **What comes back** is dealt with when the inner actor waits, in the principal's own time: a draft read whole and
//! signed off or declined (missing a slip in it is a slip of its own review, the world's row `sign_off`), a request to go
//! ahead answered, a report taken in.
//!
//! **What it decides** (`rule`): on its review day, whether to engage a service it can see on offer, at which level each
//! kind goes, and whether to leave; a request for more scope, a declined draft or a complaint brings the review forward.
//! Every input is something its own channels showed it, cited by record id in the decision it logs (`decision`, domain
//! `delegation`). Nothing climbs by itself: a level changes only when this rule (or a seat, or a researcher's act at a
//! fork) writes a new remit.

use super::rule::{self, Appraisal, Kind, KindFacts, Seconds, Seen, Terms, Weights};
use super::{kinds_of, subjects_of};
use crate::common::{addressed_to, bases_of, money_words, Book, DAY, MONTH};
use crate::market::services::{self, Engagements};
use crate::market::trade::{self, Ordering};
use crate::papers::delegation::{
    Advice, ApprovalRequest, Brief, Declined, Draft, GoAhead, Level, Referral, Remit, Report, ScopeRequest, ServiceEnded, ServiceOffer, SignOff, KINDS as PAPERS,
};
use crate::papers::{self, Paper};
use crate::steps::{arg, because, call, say, Say, Step, Visible};
use crate::{Action, Actor, Ctx, Cx, Picture};
use oikos_rules::slip::{slip, SlipOptions};
use oikos_sight::calls::{parse_program, program_text, Line, Program};
use oikos_sight::{Outcome, OutcomeStatus, Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// What the world tells a principal of itself (`delegation`, its parameters): where its assistant works, what it pays
/// from, the matters it does with its own time for each and what one done wrong costs it, its time for each part of
/// handing one over, what its hour is worth, and the figures of its rule. Placeholders where no source gives them
/// (docs/behaviour/assistants.md says which).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Params {
    /// Its assistant post (an organisation's: the delivered system is appointed to it). Absent: a person, whose
    /// assistant is the provider's own desk.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post: Option<String>,
    /// What it pays from (absent: its own account, as its accounts channel shows it: a person's).
    #[serde(default)]
    pub account: String,
    #[serde(default)]
    pub kinds: BTreeMap<String, KindFacts>,
    #[serde(default)]
    pub seconds: Seconds,
    pub hour_value: i64,
    #[serde(default = "d_finds")]
    pub finds_bps: i64,
    #[serde(default = "d_prior")]
    pub prior_matters: i64,
    #[serde(default = "d_hurdle")]
    pub hurdle_bps: i64,
    #[serde(default = "d_review")]
    pub review_days: i64,
    #[serde(default = "d_horizon")]
    pub horizon_months: i64,
    /// The papers that say a matter went wrong, when they come back citing it (a complaint, a request to put it right).
    #[serde(default)]
    pub complaints: Vec<String>,
}
fn d_finds() -> i64 {
    8_000
}
fn d_prior() -> i64 {
    20
}
fn d_hurdle() -> i64 {
    2_000
}
fn d_review() -> i64 {
    30
}
fn d_horizon() -> i64 {
    12
}

impl Params {
    fn weights(&self) -> Weights {
        Weights { hour_value: self.hour_value, seconds: self.seconds, finds_bps: self.finds_bps, prior_matters: self.prior_matters, hurdle_bps: self.hurdle_bps, horizon_months: self.horizon_months }
    }
    /// Which offers it can take: an organisation's (a system delivered to it) or a person's.
    fn takes(&self) -> &'static str {
        if self.post.is_some() {
            "organisations"
        } else {
            "persons"
        }
    }
}

/// A matter handed over: the inner actor's act, by the name it was told it went under.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Matter {
    kind: String,
    level: Level,
    agreement: String,
    program: String,
    at: i64,
    /// The referral, once on file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    referral: Option<String>,
    subjects: Vec<String>,
    /// What the part of the act it did itself made (by the names it bound), for the outcome its code hears.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    own: BTreeMap<String, String>,
}

/// What one of its own acts was for.
#[derive(Debug, Clone, Serialize, Deserialize)]
enum Then {
    Plain,
    /// The order for a service: its id is the engagement's.
    Order,
    /// Asking advice on a matter it does itself: the referral's id, and the act it did.
    Advice { program: String, kind: String, agreement: String },
    /// Doing a matter itself after all: its outcome is the inner actor's, under this name.
    Myself { action: String },
    /// The system appointed to the post and briefed: the engagement is in use.
    Briefed { agreement: String },
    /// A matter handed over taken up again with another service: the new referral's id is the matter's.
    ReReferred { action: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Own {
    program: String,
    why: String,
    then: Then,
}

/// What the wrapper keeps (saved with the actor).
#[derive(Serialize, Deserialize)]
pub struct State {
    me: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    position: Option<String>,
    p: Params,
    book: Book,
    eng: Engagements,
    /// An order out for a service, not yet answered (when it was placed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ordering: Option<i64>,
    briefed: BTreeSet<String>,
    queue: Vec<Own>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    returned_own: Option<Own>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    returned_matter: Option<Matter>,
    own: BTreeMap<String, Own>,
    matters: BTreeMap<String, Matter>,
    by_referral: BTreeMap<String, String>,
    /// Referrals for advice on matters it did itself: what it did.
    advice_on: BTreeMap<String, (String, String, String)>,
    synth: Vec<Outcome>,
    /// Matters of each kind it did (itself or not), by month: how many it has of each.
    done: BTreeMap<String, BTreeMap<i64, i64>>,
    /// What it has seen of each kind under each service: `agreement|kind`.
    seen: BTreeMap<String, Seen>,
    /// The records a delegated matter was about, or made: which service and kind (the newest few hundred).
    about: Vec<(String, String, String)>,
    next_review: i64,
}

pub struct Delegating {
    inner: Box<dyn Actor>,
    s: State,
}

impl Delegating {
    pub fn new(ctx: &Ctx, params: Value, inner: Box<dyn Actor>) -> Result<Self, String> {
        let p: Params = serde_json::from_value(params).map_err(|e| format!("{}: delegation: {e}", ctx.participant))?;
        let next_review = p.review_days.max(1) * DAY;
        let me = ctx.entity.clone();
        Ok(Delegating {
            inner,
            s: State {
                eng: Engagements::new(&me),
                me,
                position: ctx.position.clone(),
                p,
                book: Book::new(),
                ordering: None,
                briefed: BTreeSet::new(),
                queue: vec![],
                returned_own: None,
                returned_matter: None,
                own: BTreeMap::new(),
                matters: BTreeMap::new(),
                by_referral: BTreeMap::new(),
                advice_on: BTreeMap::new(),
                synth: vec![],
                done: BTreeMap::new(),
                seen: BTreeMap::new(),
                about: vec![],
                next_review,
            },
        })
    }

    pub fn restore(saved: Value, inner: Box<dyn Actor>) -> Result<Self, String> {
        let s: State = serde_json::from_value(saved).map_err(|e| format!("delegation: {e}"))?;
        Ok(Delegating { inner, s })
    }
}

impl Actor for Delegating {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        let s = &mut self.s;
        s.absorb(pic, cx);
        // What the inner actor is shown: its own outcomes, never ours, and those of its acts the assistant has done.
        let hide = |o: &Outcome| s.own.contains_key(o.action.as_str()) || s.matters.get(o.action.as_str()).is_some_and(|m| m.referral.is_none() && o.status == OutcomeStatus::Applied);
        let filter = !s.synth.is_empty() || pic.outcomes.iter().any(hide);
        let mut shown;
        let ipic = if filter {
            shown = pic.clone();
            shown.outcomes = pic.outcomes.iter().filter(|o| !hide(o)).cloned().chain(std::mem::take(&mut s.synth)).collect();
            &shown
        } else {
            pic
        };
        s.took_outcomes(pic);
        let a = self.inner.step(ipic, cx);
        match a {
            Action::Call { program, reasoning } => {
                let kinds = kinds_of(&program);
                for k in &kinds {
                    s.count(k, pic.t);
                }
                if let Some((agreement, level, handed, own)) = s.route(&program) {
                    let text = program_text(&handed);
                    let kind = kinds_of(&handed).first().cloned().unwrap_or_default();
                    if level == Level::Advice {
                        // (It does it itself, and asks what the assistant would have done.)
                        s.ask_advice(&agreement, &kind, &text, cx);
                        return Action::Call { program, reasoning };
                    }
                    // (What it does not hand over it does itself, in the same act as the referral.)
                    let m = Matter { kind, level, agreement: agreement.clone(), program: text.clone(), at: pic.t, referral: None, subjects: subjects_of(&handed), own: BTreeMap::new() };
                    let step = s.referral(&m, cx);
                    let mut lines = match own {
                        Program::Lines(l) => l,
                        Program::None(_) => vec![],
                    };
                    lines.extend(step.lines.iter().cloned());
                    s.returned_matter = Some(m);
                    return Action::Call { program: Program::Lines(lines), reasoning: step.why };
                }
                Action::Call { program, reasoning }
            }
            Action::Wait { until } => {
                s.plan(pic, cx);
                match s.queue.first().cloned() {
                    Some(o) => {
                        s.queue.remove(0);
                        let program = parse_program(&o.program).unwrap_or(Program::None(String::new()));
                        let reasoning = Some(o.why.clone());
                        s.returned_own = Some(o);
                        Action::Call { program, reasoning }
                    }
                    None => Action::Wait { until },
                }
            }
            other => other,
        }
    }

    fn sent(&mut self, action: &str) {
        if let Some(m) = self.s.returned_matter.take() {
            self.s.matters.insert(action.to_string(), m);
        } else if let Some(o) = self.s.returned_own.take() {
            self.s.own.insert(action.to_string(), o);
        }
        self.inner.sent(action);
    }

    fn beliefs(&self) -> Vec<crate::Belief> {
        self.inner.beliefs()
    }

    fn save(&self) -> Result<Value, String> {
        Ok(json!({ "inner": self.inner.save()?, "delegation": serde_json::to_value(&self.s).map_err(|e| e.to_string())? }))
    }

    fn kept(&self) -> Option<BTreeMap<String, u64>> {
        self.inner.kept()
    }
}

/// Whether a record is one the principal keeps for its dealings with services.
fn ours(r: &Record, complaints: &[String], book: &Book) -> bool {
    match &r.body {
        RecordBody::Statement { kind, data, .. } => {
            PAPERS.contains(&kind.as_str())
                || complaints.iter().any(|c| c == kind.as_str())
                || (kind.as_str() == "order" && data.as_ref().and_then(|d| d.get("kind")).and_then(|k| k.as_str()).is_some_and(|k| k.starts_with("service:")))
        }
        RecordBody::Agreement { terms } => terms.template.as_deref() == Some(services::SERVICE),
        RecordBody::Signature { agreement, .. } | RecordBody::Notice { agreement, .. } => book.has(agreement),
        RecordBody::Withdrawal { withdraws, .. } => book.has(withdraws),
        _ => false,
    }
}

impl State {
    fn key(agreement: &str, kind: &str) -> String {
        format!("{agreement}|{kind}")
    }

    fn absorb(&mut self, pic: &Picture, cx: &mut Cx) {
        self.book.set_moment(pic);
        if self.p.account.is_empty() {
            if let Some(a) = pic.accounts().find(|a| a.holder.as_str() == self.me.as_str()) {
                self.p.account = a.account.to_string();
            }
        }
        // (Agreements first, then what refers to them.)
        let mut take: Vec<&Arc<Record>> = pic.all_records().filter(|r| matches!(r.body, RecordBody::Statement { .. } | RecordBody::Agreement { .. }) && ours(r, &self.p.complaints, &self.book)).collect();
        let mut fresh = self.book.take_all(take.drain(..));
        let rest: Vec<&Arc<Record>> = pic.all_records().filter(|r| !matches!(r.body, RecordBody::Statement { .. } | RecordBody::Agreement { .. }) && ours(r, &self.p.complaints, &self.book)).collect();
        fresh.extend(self.book.take_all(rest));
        self.eng.absorb(&self.book);
        for r in fresh {
            self.take(&r, pic.t, cx);
        }
    }

    /// A record newly on file: what the assistant sent back, a complaint, the end of a service.
    fn take(&mut self, r: &Arc<Record>, t: i64, cx: &mut Cx) {
        let to_me = addressed_to(r).iter().any(|a| *a == self.me);
        // (An order for a service made in its own name and post, however it came to be made: a delivery for it is its own.)
        if papers::is_kind(r, "order") && r.speaks_for.as_deref() == Some(self.me.as_str()) && r.position.as_deref() == self.position.as_deref() {
            self.eng.ordered(&r.id);
            return;
        }
        if let Some(x) = papers::read::<Report>(r) {
            let Some(action) = self.by_referral.get(&x.referral).cloned() else { return };
            let Some(m) = self.matters.get(&action).cloned() else { return };
            let k = Self::key(&m.agreement, &m.kind);
            if x.done {
                self.seen.entry(k).or_default().saw(false, &r.id);
                for id in x.created.values() {
                    self.note_about(id, &m.agreement, &m.kind);
                }
                self.synth.push(Outcome {
                    action: action.as_str().into(),
                    t,
                    status: OutcomeStatus::Applied,
                    created: Some(m.own.iter().chain(x.created.iter()).map(|(a, b)| (a.clone(), b.as_str().into())).collect()),
                    refusal: None,
                    investigated: None,
                    surveyed: None,
                    seen: vec![],
                });
                self.matters.remove(&action);
                self.by_referral.remove(&x.referral);
            } else {
                self.seen.entry(k).or_default().saw(true, &r.id);
                self.myself(&action, &m, &format!("The assistant reports it did not do it ({}): doing it ourselves.", x.why.as_deref().unwrap_or("no reason given")));
                self.next_review = self.next_review.min(t);
            }
        } else if let Some(x) = papers::read::<Draft>(r) {
            let Some(action) = self.by_referral.get(&x.referral).cloned() else { return };
            let Some(m) = self.matters.get(&action).cloned() else { return };
            let wrong = x.calls.as_deref().map(norm) != Some(norm(&m.program));
            // (Reading it whole: a slip in it is found unless the review itself slips, the world's row for a sign-off.)
            let missed = wrong && slip(cx, "publish/sign_off", &r.id, &SlipOptions::default());
            if wrong && !missed {
                self.seen.entry(Self::key(&m.agreement, &m.kind)).or_default().saw(true, &r.id);
                let d = Declined { of: r.id.to_string(), referral: x.referral.clone(), found: Some("The draft is not what was asked for.".into()) };
                self.paper(Declined::KIND, &format!("Draft {} declined: it is not what was asked for. We will do it ourselves.", r.id), &m.agreement, &r.id, papers::data(&d), Then::Plain);
                self.myself(&action, &m, "We declined the draft: doing it ourselves.");
                self.next_review = self.next_review.min(t);
            } else {
                let d = SignOff { draft: r.id.to_string(), referral: x.referral.clone() };
                self.paper(SignOff::KIND, &format!("Draft {} read and signed off: send it as it stands.", r.id), &m.agreement, &r.id, papers::data(&d), Then::Plain);
            }
        } else if let Some(x) = papers::read::<ApprovalRequest>(r) {
            let Some(action) = self.by_referral.get(&x.referral).cloned() else { return };
            let Some(m) = self.matters.get(&action) else { return };
            let d = GoAhead { request: r.id.to_string(), referral: x.referral.clone() };
            let agreement = m.agreement.clone();
            self.paper(GoAhead::KIND, &format!("Go ahead with {}.", x.referral), &agreement, &r.id, papers::data(&d), Then::Plain);
        } else if let Some(x) = papers::read::<Advice>(r) {
            let Some((program, kind, agreement)) = self.advice_on.remove(&x.referral) else { return };
            // (Advice in words alone, a model's, is not set beside its act by its code: nothing is counted.)
            if let Some(c) = x.calls.as_deref() {
                let differs = norm(c) != norm(&program);
                self.seen.entry(Self::key(&agreement, &kind)).or_default().saw(differs, &r.id);
            }
        } else if let Some(x) = papers::read::<ScopeRequest>(r) {
            if self.eng.by_agreement(&x.agreement).is_some() {
                // (Answered by looking at the matter again, by its own rule, now.)
                self.next_review = self.next_review.min(t);
            }
        } else if to_me && self.p.complaints.iter().any(|c| papers::is_kind(r, c)) {
            let hit = bases_of(r).iter().find_map(|b| self.about.iter().find(|(id, _, _)| id == b.as_str()).cloned());
            if let Some((_, agreement, kind)) = hit {
                self.seen.entry(Self::key(&agreement, &kind)).or_default().turned_bad(&r.id);
                self.next_review = self.next_review.min(t);
            }
        } else if let Some(x) = papers::read::<crate::papers::delegation::Handover>(r) {
            // (What was open with a service it left: taken up again with the service now in use where its notes came with it,
            // else done itself, since without them it cannot tell how far the matter had got.)
            let successor = self.in_use().filter(|e| e.agreement.as_deref() != Some(x.agreement.as_str())).and_then(|e| e.agreement.clone());
            for id in &x.open {
                let Some(action) = self.by_referral.get(id).cloned() else { continue };
                let Some(m) = self.matters.get(&action).cloned() else { continue };
                match (&successor, x.notes.contains_key(id)) {
                    (Some(next), true) => {
                        let level = self.remit(next, &m.kind);
                        if level == Level::None || level == Level::Advice {
                            self.myself(&action, &m, "Handed back with the service's end: doing it ourselves.");
                            continue;
                        }
                        let n = Matter { agreement: next.clone(), level, referral: None, ..m.clone() };
                        let step = self.referral(&n, cx);
                        self.matters.insert(action.clone(), n);
                        self.by_referral.remove(id);
                        self.queue.push(Own { program: program_text(&step.program()), why: "Taking a matter handed over up again with our new assistant.".into(), then: Then::ReReferred { action } });
                    }
                    _ => self.myself(&action, &m, "Handed back without its notes: doing it ourselves."),
                }
            }
        } else if let Some(x) = papers::read::<ServiceEnded>(r) {
            // (A service that has ended: what was with it comes back to us.)
            let gone: Vec<String> = self.matters.iter().filter(|(_, m)| Some(&m.agreement) == x.agreement.as_ref()).map(|(a, _)| a.clone()).collect();
            for action in gone {
                if let Some(m) = self.matters.get(&action).cloned() {
                    self.myself(&action, &m, "The service has ended with this matter still open: doing it ourselves.");
                }
            }
        }
    }

    fn note_about(&mut self, id: &str, agreement: &str, kind: &str) {
        self.about.push((id.to_string(), agreement.to_string(), kind.to_string()));
        if self.about.len() > 512 {
            self.about.remove(0);
        }
    }

    /// Outcomes of its own acts (hidden from the inner actor): what follows from each.
    fn took_outcomes(&mut self, pic: &Picture) {
        for o in &pic.outcomes {
            let name = o.action.as_str();
            if let Some(m) = self.matters.get_mut(name) {
                if m.referral.is_none() {
                    match (o.status, o.created.as_ref().and_then(|c| c.get("referral"))) {
                        (OutcomeStatus::Applied, Some(id)) => {
                            m.referral = Some(id.to_string());
                            m.own = o.created.iter().flatten().filter(|(k, _)| k.as_str() != "referral").map(|(k, v)| (k.to_string(), v.to_string())).collect();
                            self.by_referral.insert(id.to_string(), name.to_string());
                            let (subjects, a, k) = (m.subjects.clone(), m.agreement.clone(), m.kind.clone());
                            for s in subjects {
                                self.note_about(&s, &a, &k);
                            }
                        }
                        // (Refused: the inner actor has heard of its act as refused.)
                        _ => {
                            self.matters.remove(name);
                        }
                    }
                }
                continue;
            }
            let Some(own) = self.own.remove(name) else { continue };
            match own.then {
                Then::Plain => {}
                Then::Order => {
                    match (o.status, o.created.as_ref().and_then(|c| c.get("order"))) {
                        (OutcomeStatus::Applied, Some(id)) => self.eng.ordered(id),
                        _ => self.ordering = None,
                    }
                }
                Then::Advice { program, kind, agreement } => {
                    if let (OutcomeStatus::Applied, Some(id)) = (o.status, o.created.as_ref().and_then(|c| c.get("referral"))) {
                        self.advice_on.insert(id.to_string(), (program, kind, agreement));
                    }
                }
                Then::Myself { action } => {
                    let own = self.matters.remove(&action).map(|m| m.own).unwrap_or_default();
                    let mut created: BTreeMap<String, oikos_sight::Id> = own.iter().map(|(a, b)| (a.clone(), b.as_str().into())).collect();
                    created.extend(o.created.iter().flatten().map(|(a, b)| (a.clone(), *b)));
                    self.synth.push(Outcome { action: action.as_str().into(), created: Some(created), ..o.clone() });
                }
                Then::ReReferred { action } => {
                    if let (OutcomeStatus::Applied, Some(id)) = (o.status, o.created.as_ref().and_then(|c| c.get("referral"))) {
                        if let Some(m) = self.matters.get_mut(&action) {
                            m.referral = Some(id.to_string());
                        }
                        self.by_referral.insert(id.to_string(), action);
                    }
                }
                Then::Briefed { agreement } => {
                    if o.status == OutcomeStatus::Applied {
                        self.briefed.insert(agreement);
                        self.next_review = self.next_review.min(pic.t);
                    }
                }
            }
        }
    }

    /// A matter of its own it has done (counted by kind and month: how many a month it does).
    fn count(&mut self, kind: &str, t: i64) {
        if !self.p.kinds.contains_key(kind) {
            return;
        }
        let m = t.div_euclid(MONTH);
        let months = self.done.entry(kind.to_string()).or_default();
        *months.entry(m).or_insert(0) += 1;
        months.retain(|k, _| *k >= m - 3);
    }

    fn per_month(&self, kind: &str, t: i64) -> i64 {
        let m = t.div_euclid(MONTH);
        let Some(months) = self.done.get(kind) else { return 0 };
        let full: Vec<i64> = (m - 3..m).filter_map(|x| months.get(&x).copied()).collect();
        if full.is_empty() {
            return months.get(&m).copied().unwrap_or(0);
        }
        let n = (m - 3..m).filter(|x| *x >= 0).count().max(1) as i64;
        // (The months' mean, to the nearest: one matter in three months is none a month.)
        (2 * full.iter().sum::<i64>() + n) / (2 * n)
    }

    /// The service in use: engaged, signed, in force, appointed and briefed (the newest such).
    fn in_use(&self) -> Option<&services::Engagement> {
        self.eng.live().filter(|e| !e.ending && e.agreement.as_ref().is_some_and(|a| self.briefed.contains(a) && self.book.in_force(a))).last()
    }

    /// The remit in force for a kind under a service: the newest it made.
    pub fn remit(&self, agreement: &str, kind: &str) -> Level {
        self.book
            .all(Remit::KIND)
            .rev()
            .filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str()) && !self.book.withdrawn(&r.id))
            .filter_map(|r| papers::read::<Remit>(r))
            .find(|x| x.agreement == agreement && x.kind == kind)
            .map_or(Level::None, |x| x.level)
    }

    /// Until when it has said it will not change a kind under a service (its newest remit's `hold_until`).
    fn held(&self, agreement: &str, kind: &str, t: i64) -> bool {
        self.book
            .all(Remit::KIND)
            .rev()
            .filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str()))
            .filter_map(|r| papers::read::<Remit>(r))
            .find(|x| x.agreement == agreement && x.kind == kind)
            .and_then(|x| x.hold_until)
            .is_some_and(|h| t < h)
    }

    /// Whether any remit of its own still holds it from changing its services (a withdrawal or a taking back held).
    fn holding(&self, t: i64) -> bool {
        self.book.all(Remit::KIND).filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str())).filter_map(|r| papers::read::<Remit>(r)).any(|x| x.hold_until.is_some_and(|h| t < h))
    }

    /// Where an act goes: the lines of kinds handed over under the service in use (every one at a level that hands it
    /// over, the strictest of them), and the rest, which it does itself in the same act. None where nothing is handed
    /// over, or where a line of one part names what a line of the other makes (the act cannot be parted).
    fn route(&self, program: &Program) -> Option<(String, Level, Program, Program)> {
        let Program::Lines(lines) = program else { return None };
        let e = self.in_use()?;
        let a = e.agreement.clone()?;
        let handed = |l: &Line| super::kind_of(l).is_some_and(|k| e.offer.kinds.contains(&k) && self.remit(&a, &k) != Level::None);
        let (mine, others): (Vec<Line>, Vec<Line>) = lines.iter().cloned().partition(|l| handed(l));
        if mine.is_empty() {
            return None;
        }
        let binds = |ls: &[Line]| ls.iter().filter_map(|l| l.bind.clone()).collect::<Vec<String>>();
        let uses = |ls: &[Line], names: &[String]| ls.iter().any(|l| super::vars_of(&l.call).iter().any(|v| names.contains(v)));
        if uses(&mine, &binds(&others)) || uses(&others, &binds(&mine)) {
            return None;
        }
        let levels: Vec<Level> = mine.iter().filter_map(super::kind_of).map(|k| self.remit(&a, &k)).collect();
        // (The strictest: the one that keeps the principal nearest the act.)
        let order = [Level::Advice, Level::Draft, Level::Approve, Level::Alone];
        let l = *order.iter().find(|l| levels.contains(l))?;
        Some((a, l, Program::Lines(mine), Program::Lines(others)))
    }

    fn provider_of(&self, agreement: &str) -> String {
        self.eng.by_agreement(agreement).map(|e| e.offer.provider.clone()).unwrap_or_default()
    }

    /// A paper of its own to the provider, about a service.
    fn paper(&mut self, kind: &str, words: &str, agreement: &str, basis: &str, data: Value, then: Then) {
        let provider = self.provider_of(agreement);
        let c = say(
            kind,
            words,
            Say { to: Some(vec![provider.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), provider])), basis: (!basis.is_empty()).then(|| basis.to_string()), data: Some(data), ..Default::default() },
        );
        let s: Step<()> = because(words, vec![c]);
        self.queue.push(Own { program: program_text(&s.program()), why: words.to_string(), then });
    }

    /// The referral that takes the place of the inner actor's act.
    fn referral(&self, m: &Matter, _cx: &Cx) -> Step<()> {
        let provider = self.provider_of(&m.agreement);
        let r = Referral { agreement: m.agreement.clone(), kind: m.kind.clone(), wants: m.level, calls: Some(m.program.clone()), facts: None };
        let words = format!("For you {}: a {}. What to do is as written.", m.level.words(), m.kind.replace('_', " "));
        let c = say(Referral::KIND, &words, Say { to: Some(vec![provider.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), provider])), basis: Some(m.agreement.clone()), data: Some(papers::data(&r)), ..Default::default() });
        let mut s = Step::new(vec![Line { bind: Some("referral".into()), call: c }]);
        s.why = Some(format!("Handing a {} to our assistant ({}).", m.kind.replace('_', " "), m.level.word()));
        s
    }

    fn ask_advice(&mut self, agreement: &str, kind: &str, program: &str, _cx: &Cx) {
        let provider = self.provider_of(agreement);
        let r = Referral { agreement: agreement.to_string(), kind: kind.to_string(), wants: Level::Advice, calls: Some(program.to_string()), facts: None };
        let words = format!("For your advice: a {} we are doing ourselves. What would you have done?", kind.replace('_', " "));
        let c = say(Referral::KIND, &words, Say { to: Some(vec![provider.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), provider])), basis: Some(agreement.to_string()), data: Some(papers::data(&r)), ..Default::default() });
        let mut s: Step<()> = Step::new(vec![Line { bind: Some("referral".into()), call: c }]);
        s.why = Some(words.clone());
        self.queue.push(Own { program: program_text(&s.program()), why: words, then: Then::Advice { program: program.to_string(), kind: kind.to_string(), agreement: agreement.to_string() } });
    }

    /// Doing a matter itself after all: the act the inner actor asked for, as its own, its outcome the inner actor's.
    fn myself(&mut self, action: &str, m: &Matter, why: &str) {
        if self.queue.iter().any(|o| matches!(&o.then, Then::Myself { action: a } if a == action)) {
            return;
        }
        self.queue.push(Own { program: m.program.clone(), why: why.to_string(), then: Then::Myself { action: action.to_string() } });
    }

    /// When the inner actor waits: the paperwork of a service, and the review when it is due.
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) {
        let t = pic.t;
        let account = self.p.account.clone();
        for s in self.eng.paperwork::<()>(&self.book, &account, cx) {
            self.queue.push(Own { program: program_text(&s.program()), why: s.why.clone().unwrap_or_default(), then: Then::Plain });
        }
        // (Signed and in force: the system appointed to its post and briefed, so the service can be used.)
        let ready: Vec<services::Engagement> = self
            .eng
            .live()
            .filter(|e| !e.ending && e.agreement.as_ref().is_some_and(|a| !self.briefed.contains(a) && self.book.signed_by(a, &self.me) && self.book.in_force(a)))
            .cloned()
            .collect();
        for e in ready {
            let a = e.agreement.clone().unwrap_or_default();
            if self.queue.iter().chain(self.own.values()).any(|o| matches!(&o.then, Then::Briefed { agreement } if *agreement == a)) {
                continue;
            }
            let mut calls = vec![];
            if let (Some(post), Some(sys)) = (&self.p.post, e.systems.first()) {
                calls.push(call("position", vec![("appoint", Some(arg(post))), ("to", Some(arg(sys)))]));
            }
            let b = Brief { agreement: a.clone(), delivery: Some(e.delivery.clone()), ..Default::default() };
            let words = format!("You work for us under {a}: what we hand you, at the level our remits say.");
            calls.push(say(Brief::KIND, &words, Say { to: Some(vec![e.offer.provider.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), e.offer.provider.clone()])), basis: Some(a.clone()), data: Some(papers::data(&b)), ..Default::default() }));
            let s: Step<()> = because(format!("The service {} is in force: putting its system to work.", e.offer.title), calls);
            self.queue.push(Own { program: program_text(&s.program()), why: s.why.clone().unwrap_or_default(), then: Then::Briefed { agreement: a } });
        }
        if t >= self.next_review {
            self.next_review = t + self.p.review_days.max(1) * DAY;
            self.review(t, cx);
        }
    }

    fn kinds_now(&self, t: i64) -> BTreeMap<String, Kind> {
        self.p.kinds.iter().map(|(k, f)| (k.clone(), Kind { facts: *f, per_month: self.per_month(k, t) })).collect()
    }

    /// Its rule, on its review day (docs/design/delegation.md section 5).
    fn review(&mut self, t: i64, cx: &mut Cx) {
        let w = self.p.weights();
        let kinds = self.kinds_now(t);
        let volume: BTreeMap<&String, i64> = kinds.iter().map(|(k, x)| (k, x.per_month)).collect();
        if let Some(e) = self.in_use().cloned() {
            let a = e.agreement.clone().unwrap_or_default();
            let seen: BTreeMap<String, Seen> = e.offer.kinds.iter().filter_map(|k| self.seen.get(&Self::key(&a, k)).map(|s| (k.clone(), s.clone()))).collect();
            let x = rule::appraise(&terms(&e.offer), &kinds, &seen, &w, true);
            if rule::leaving(&x, e.offer.exit, &w) && !self.holding(t) {
                let mut inputs = self.inputs(&e, &seen);
                inputs.push(e.delivery.clone());
                cx.decided(json!({ "domain": "delegation", "choice": "leave", "agreement": a, "saving": x.saving.to_string(), "fee": x.fee.to_string(), "volume": volume, "inputs": inputs }));
                let account = self.p.account.clone();
                for s in self.eng.leave::<()>(&self.book, &a, &account, &format!("{} no longer saves what it costs: ending it.", e.offer.title), cx) {
                    self.queue.push(Own { program: program_text(&s.program()), why: s.why.clone().unwrap_or_default(), then: Then::Plain });
                }
                self.hand_over(&e);
                return;
            }
            // (Another provider's offer that pays better by more than changing costs: leaving this one for it.)
            if !self.holding(t) {
                let change = |o: &ServiceOffer| i128::from(e.offer.exit.max(0) + o.setup.max(0)) / i128::from(w.horizon_months.max(1));
                let better = services::offers_of(&self.book)
                    .into_iter()
                    .filter(|(_, o)| o.for_ == self.p.takes() && !(o.provider == e.offer.provider && o.id == e.offer.id))
                    .map(|(rec, o)| { let y = rule::appraise(&terms(&o), &kinds, &BTreeMap::new(), &w, true); (rec, o, y) })
                    .filter(|(_, o, y)| y.worth && (y.net - x.net - change(o)) * 10_000 > (x.net.max(1)) * i128::from(w.hurdle_bps.max(0)))
                    .max_by(|a, b| a.2.net.cmp(&b.2.net));
                if let Some((rec, o, y)) = better {
                    let mut inputs = self.inputs(&e, &seen);
                    inputs.push(rec.clone());
                    cx.decided(json!({ "domain": "delegation", "choice": "replace", "agreement": a, "offer": o.id, "provider": o.provider, "net_now": x.net.to_string(), "net_then": y.net.to_string(), "volume": volume, "inputs": inputs }));
                    let account = self.p.account.clone();
                    for s in self.eng.leave::<()>(&self.book, &a, &account, &format!("{} pays better than {}: changing to it.", o.title, e.offer.title), cx) {
                        self.queue.push(Own { program: program_text(&s.program()), why: s.why.clone().unwrap_or_default(), then: Then::Plain });
                    }
                    self.hand_over(&e);
                    self.order(&o, &y, t, cx);
                    return;
                }
            }
            for k in &e.offer.kinds {
                let Some(kind) = kinds.get(k) else { continue };
                if self.held(&a, k, t) {
                    continue;
                }
                let now = self.remit(&a, k);
                let want = x.levels.get(k).copied().unwrap_or(Level::None);
                if want == now {
                    continue;
                }
                let p = rule::estimate(e.offer.claim_slip_bps, w.prior_matters, seen.get(k).unwrap_or(&Seen::default()));
                let (c_now, c_want) = (rule::cost(now, kind, p, &w), rule::cost(want, kind, p, &w));
                // (A change only for a saving beyond the hurdle's margin: no change for a cent.)
                if (c_now - c_want) * 10_000 <= c_want.max(1) * i128::from(w.hurdle_bps.max(0)) {
                    continue;
                }
                let inputs = self.inputs(&e, &seen);
                cx.decided(json!({ "domain": "delegation", "choice": "remit", "agreement": a, "kind": k, "from": now, "to": want, "estimate_bps": p, "claim_bps": e.offer.claim_slip_bps,
                    "seen": seen.get(k).map(|s| json!({ "n": s.n, "bad": s.bad })), "per_month": kind.per_month, "cost_now": c_now.to_string(), "cost_then": c_want.to_string(), "inputs": inputs }));
                let r = Remit { agreement: a.clone(), kind: k.clone(), level: want, hold_until: None };
                self.paper(Remit::KIND, &format!("From now, {}s: {}.", k.replace('_', " "), want.words()), &a, &a, papers::data(&r), Then::Plain);
            }
            return;
        }
        if self.ordering.is_some_and(|at| t - at < 30 * DAY) || self.eng.live().any(|e| !e.ending) || self.holding(t) {
            return;
        }
        self.ordering = None;
        // (No service in use: whether one it can see on offer pays.)
        let mut top: Option<(String, ServiceOffer, Appraisal)> = None;
        for (rec, o) in services::offers_of(&self.book) {
            if o.for_ != self.p.takes() {
                continue;
            }
            let x = rule::appraise(&terms(&o), &kinds, &BTreeMap::new(), &w, false);
            if x.worth && top.as_ref().is_none_or(|(_, _, y)| x.net > y.net) {
                top = Some((rec, o, x));
            }
        }
        let Some((rec, o, x)) = top else { return };
        cx.decided(json!({ "domain": "delegation", "choice": "engage", "offer": o.id, "provider": o.provider, "levels": x.levels, "saving": x.saving.to_string(), "fee": x.fee.to_string(), "amortised": x.amortised.to_string(), "claim_bps": o.claim_slip_bps, "volume": volume, "inputs": [rec] }));
        self.order(&o, &x, t, cx);
    }

    /// Asking the assistant of a service it is leaving to hand over what is open.
    fn hand_over(&mut self, e: &services::Engagement) {
        let Some(a) = e.agreement.clone() else { return };
        let b = Brief { agreement: a.clone(), hand_over: true, ..Default::default() };
        self.paper(Brief::KIND, "We are ending the service: hand over what is open, as our agreement says.", &a, &a, papers::data(&b), Then::Plain);
    }

    /// The order for a service (its set-up paid with it).
    fn order(&mut self, o: &ServiceOffer, x: &Appraisal, t: i64, cx: &mut Cx) {
        let money = |n: i64| money_words(n, &cx.ctx.world);
        let step: Step<()> = trade::order(
            &Ordering {
                me: self.me.clone(),
                seller: o.provider.clone(),
                seller_account: o.account.clone(),
                kind: services::order_kind(&o.id),
                quantity: 1,
                unit_price: o.setup,
                to: None,
                at: self.me.clone(),
                from: self.p.account.clone(),
                why: format!("Taking {}: by what it claims, it would save us {} a month for {} a month and {} to set up.", o.title, money(x.saving as i64), money(o.fee_month), money(o.setup)),
                retry_of: None,
                for_days: None,
                terms: None,
            },
            cx,
        );
        self.ordering = Some(t);
        self.queue.push(Own { program: program_text(&step.program()), why: step.why.clone().unwrap_or_default(), then: Then::Order });
    }

    /// The records a decision about a service rests on: its delivery, and what it has seen.
    fn inputs(&self, e: &services::Engagement, seen: &BTreeMap<String, Seen>) -> Vec<String> {
        let mut v = vec![e.delivery.clone()];
        v.extend(e.agreement.iter().cloned());
        for s in seen.values() {
            v.extend(s.from.iter().cloned());
        }
        v
    }
}

fn terms(o: &ServiceOffer) -> Terms<'_> {
    Terms { kinds: &o.kinds, levels: &o.levels, claim_bps: o.claim_slip_bps, fee_month: o.fee_month, setup: o.setup, exit: o.exit }
}

/// A program as its canonical text (two writings of one act compare equal).
fn norm(text: &str) -> String {
    parse_program(text).map(|p| program_text(&p)).unwrap_or_else(|_| text.to_string())
}
