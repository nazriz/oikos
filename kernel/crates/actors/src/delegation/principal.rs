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
    is_want, Acknowledgement, Advice, ApprovalRequest, Brief, Declined, Depth, Draft, GoAhead, Level, Part, Referral, Remit, Report, ScopeAnswer, ScopeRequest, ServiceEnded, ServiceOffer, SignOff, WantHanded, Why, KINDS as PAPERS,
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
    /// A delegation it has already decided on, by hand (`Commit`): absent, its rule decides everything.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<Commit>,
}

/// A delegation decided by hand before its rule weighs anything (a study's design, or an owner's earlier choice, written
/// into its parameters with the reason: docs/behaviour/assistants.md, "A delegation decided by hand"): the offer it takes,
/// the level it puts each kind at once the service is in use, until when it holds those levels, and until when it keeps
/// the service. Inside those times its rule does not change them; after them its rule takes over as ever. Its own word,
/// as a remit's `hold_until` is: nothing outside it holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Commit {
    /// The offer it takes (the offer's id, as published).
    pub offer: String,
    /// The level of each kind once the service is in use (kinds not named are left to its rule).
    #[serde(default)]
    pub levels: BTreeMap<String, Level>,
    /// Until when (world seconds) it holds those levels.
    #[serde(default)]
    pub levels_until: i64,
    /// Until when (world seconds) it keeps the service: it does not leave or replace it before then.
    #[serde(default)]
    pub keep_until: i64,
    /// Why, in words: in every decision it logs under it.
    #[serde(default)]
    pub why: String,
    /// What its word on the levels is: a floor (the default: it keeps each kind with the assistant at least at its level
    /// until `levels_until`, and its rule may raise it, or grant a request for more) or a freeze (it does not look at the
    /// levels again before then: the scope pilot's month-long hold, and a study cell).
    #[serde(default)]
    pub hold: Hold,
    /// What it hands over of each kind (`matter`: what happened), where its design says; a kind not named: what its
    /// service takes it at, what happened where it can.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub depths: BTreeMap<String, Depth>,
}

/// A delegation decided by hand holds its levels as a floor or as a freeze (`Commit.hold`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Hold {
    #[default]
    Floor,
    Freeze,
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
    /// Handed over as what happened: the facts it gave (none: the finished act).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    facts: Option<Value>,
    /// What was handed over (a person's want: `want`, with the want's own fields).
    #[serde(default, skip_serializing_if = "Depth::is_act")]
    depth: Depth,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    want: Option<WantHanded>,
}

/// How many of its own papers it keeps to hand, to send a copy of.
const OWN_PAPERS: usize = crate::figures::KEPT_OWN_PAPERS;

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
    /// Requests for more scope that came in and are not answered yet (their ids): each is answered when it waits, in
    /// its own time, by its rule (`answer`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    asked: Vec<String>,
    /// Letters from its assistant on no paper of delegation, not yet acknowledged (their ids).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    letters: Vec<String>,
    /// Its own papers, the newest [`OWN_PAPERS`], as a copy of each would go (id, kind, words, data).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    own_papers: Vec<(String, Value)>,
    /// Letters it has acknowledged (so that one is acknowledged once; the newest few hundred).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    acknowledged: Vec<String>,
    /// (During a review: whether it changed anything.)
    #[serde(default, skip)]
    changed: bool,
    /// Where it hands wants over: the bodies on its boards that say what they hear, and their fees, as it last saw
    /// them: what it reads a draft's addressee against. (Saved: a board shows a notice as it comes, so a principal
    /// restored at a fork would not see it again. Until 2026-11-11 it was not saved, and after the study's fork every
    /// draft to a body that hears the matter was declined.)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    venues: Vec<(String, Vec<String>, i64)>,
    /// The authorities it has given a body for its assistant's post (`body|post`): docs/design/obstacles.md, O1.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    lodged: BTreeSet<String>,
    /// The bodies' papers it has passed on to its desk.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    passed: BTreeSet<String>,
}

pub struct Delegating {
    inner: Box<dyn Actor>,
    s: State,
}

impl Delegating {
    pub fn new(ctx: &Ctx, params: Value, inner: Box<dyn Actor>) -> Result<Self, String> {
        let p: Params = serde_json::from_value(params).map_err(|e| format!("{}: delegation: {e}", ctx.participant))?;
        // (A delegation decided by hand is taken up on the first day, not at the first review.)
        let next_review = if p.commit.is_some() { DAY } else { p.review_days.max(1) * DAY };
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
                asked: vec![],
                letters: vec![],
                own_papers: vec![],
                acknowledged: vec![],
                changed: false,
                venues: vec![],
                lodged: BTreeSet::new(),
                passed: BTreeSet::new(),
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
                // (Each paper counted, not each act: a rates instalment's act carries fifteen owners' notices, and is fifteen
                // notices' work. 2026-11-10, found by the enough-work screen.)
                if let Program::Lines(ls) = &program {
                    for k in ls.iter().filter_map(super::kind_of) {
                        s.count(&k, pic.t);
                    }
                }
                let routed = s.route(&program);
                // (A want handed over is never an act of the world's: one its remit no longer hands over, a remit come
                // since its code chose the way, is dropped, and its code hears it done; the want stays its own.)
                if routed.is_none() && has_wants(&program) {
                    return Action::Call { program: without_wants(program), reasoning };
                }
                if let Some((agreement, level, handed, own, facts)) = routed {
                    let text = program_text(&handed);
                    let kind = kinds_of(&handed).first().cloned().unwrap_or_default();
                    if level == Level::Advice {
                        // (It does it itself, and asks what the assistant would have done.)
                        s.ask_advice(&agreement, &kind, &text, cx);
                        return Action::Call { program, reasoning };
                    }
                    // (What it does not hand over it does itself, in the same act as the referral.)
                    let depth = if is_want(&kind) { Depth::Want } else if facts.is_some() { Depth::Matter } else { Depth::Act };
                    // (A want: its own fields, and the facts its holder chose to give.)
                    let want = facts.as_ref().filter(|_| depth == Depth::Want).and_then(|f| serde_json::from_value::<WantHanded>(f["want"].clone()).ok());
                    let facts = if depth == Depth::Want { facts.map(|f| f["facts"].clone()) } else { facts };
                    let m = Matter { kind, level, agreement: agreement.clone(), program: text.clone(), at: pic.t, referral: None, subjects: subjects_of(&handed), own: BTreeMap::new(), facts, depth, want };
                    // (What it would have done, on record for whoever reads the log: what the matter needed. Never shown to
                    // anyone in the world.)
                    cx.decided(json!({ "domain": "delegation", "choice": "handed", "agreement": agreement, "kind": m.kind, "level": level, "depth": depth, "program": text, "does_itself": kinds_of(&own), "inputs": [] }));
                    let step = s.referral(&m, &kinds_of(&own), cx);
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

/// Whether a record is one the principal keeps for its dealings with services. `from_assistant`: whether a statement
/// is a letter from its assistant (written in its assistant's post, or by a provider whose service it engaged).
fn ours(r: &Record, complaints: &[String], book: &Book, from_assistant: &dyn Fn(&Record) -> bool) -> bool {
    if matches!(r.body, RecordBody::Statement { .. }) && from_assistant(r) {
        return true;
    }
    match &r.body {
        RecordBody::Statement { kind, data, .. } => {
            PAPERS.contains(&kind.as_str())
                || [crate::common::intake::RETURNED, crate::common::intake::RECORDED, crate::common::intake::AUTHORITY].contains(&kind.as_str())
                || complaints.iter().any(|c| c == kind.as_str())
                || (kind.as_str() == "order" && data.as_ref().and_then(|d| d.get("kind")).and_then(|k| k.as_str()).is_some_and(|k| k.starts_with("service:")))
        }
        RecordBody::Agreement { terms } => terms.template.as_deref() == Some(services::SERVICE),
        RecordBody::Signature { agreement, .. } | RecordBody::Notice { agreement, .. } => book.has(agreement),
        RecordBody::Withdrawal { withdraws, .. } => book.has(withdraws),
        _ => false,
    }
}

/// Who its assistant is, for telling its papers apart: its assistant's post (an organisation's), or the providers whose
/// service it engaged (a person's desk).
struct Assistant {
    me: String,
    post: Option<String>,
    providers: Vec<String>,
}

impl Assistant {
    fn of(s: &State) -> Assistant {
        Assistant { me: s.me.clone(), post: s.p.post.clone(), providers: s.eng.live().map(|e| e.offer.provider.clone()).collect() }
    }
    /// Whether a statement is from its assistant, addressed to it.
    fn wrote(&self, r: &Record) -> bool {
        if !matches!(r.body, RecordBody::Statement { .. }) || !addressed_to(r).iter().any(|a| *a == self.me) {
            return false;
        }
        match &self.post {
            Some(post) => r.position.as_deref() == Some(post.as_str()),
            None => r.speaks_for.as_deref().is_some_and(|s| s != self.me && self.providers.iter().any(|p| p == s)),
        }
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
        let from = Assistant::of(self);
        let letter = |r: &Record| from.wrote(r);
        let mut take: Vec<&Arc<Record>> = pic.all_records().filter(|r| matches!(r.body, RecordBody::Statement { .. } | RecordBody::Agreement { .. }) && ours(r, &self.p.complaints, &self.book, &letter)).collect();
        let mut fresh = self.book.take_all(take.drain(..));
        let rest: Vec<&Arc<Record>> = pic.all_records().filter(|r| !matches!(r.body, RecordBody::Statement { .. } | RecordBody::Agreement { .. }) && ours(r, &self.p.complaints, &self.book, &letter)).collect();
        fresh.extend(self.book.take_all(rest));
        self.eng.absorb(&self.book);
        // (Its own papers, the newest few, once it has engaged a service: what it can send a copy of when its assistant
        // asks for one by name. Its files, not a register.)
        if self.eng.live().next().is_some() {
            for r in pic.all_records() {
                if let RecordBody::Statement { kind, data, .. } = &r.body {
                    if r.speaks_for.as_deref() == Some(self.me.as_str()) && !PAPERS.contains(&kind.as_str()) && !self.own_papers.iter().any(|(id, _)| id == r.id.as_str()) {
                        self.own_papers.push((r.id.to_string(), json!({ "id": r.id.as_str(), "kind": kind.as_str(), "text": crate::common::text(r), "data": data.as_ref().map(|d| d.to_value()).unwrap_or(Value::Null) })));
                        if self.own_papers.len() > OWN_PAPERS {
                            self.own_papers.remove(0);
                        }
                    }
                }
            }
        }
        // (A want with its assistant: the bodies that say what they hear, as its boards show them, to read a draft's
        // addressee against.)
        // (Kept as they come, the newest notice of each body standing, where it hands wants over at all.)
        if self.p.kinds.keys().any(|k| is_want(k)) {
            for r in pic.all_records() {
                let RecordBody::Statement { offer: Some(o), .. } = &r.body else { continue };
                let Some(hears) = o.get("hears").and_then(|x| x.as_array()) else { continue };
                let venue = r.speaks_for.map(|x| x.to_string()).unwrap_or_else(|| r.author.to_string());
                let matters: Vec<String> = hears.iter().filter_map(|h| h.get("about").and_then(|a| a.as_str()).map(String::from)).collect();
                let fee = crate::citizen::recourse::venue_fee(o).map_or(0, |f| f.1);
                self.venues.retain(|(v, _, _)| *v != venue);
                self.venues.push((venue, matters, fee));
            }
        }
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
        if to_me && self.p.post.is_none() && (papers::is_kind(r, crate::common::intake::RETURNED) || papers::is_kind(r, crate::common::intake::RECORDED)) {
            self.pass_on(r);
            return;
        }
        if let Some(x) = papers::read::<Report>(r) {
            // (A body would not act on a paper its assistant sent for it without its authority: it gives the body one for
            // the post, where it keeps that kind with the assistant. Docs/design/obstacles.md, O1.)
            if let (Some(a), Some(post), false) = (x.needs.as_ref().and_then(|n| n.authority.clone()), r.position.as_deref(), x.done) {
                let referral = self.book.get(&x.referral).and_then(|q| papers::read::<Referral>(q));
                if let Some(q) = referral.filter(|q| a.for_ == self.me && hands_over(self.remit(&q.agreement, &q.kind))) {
                    let kinds = if a.kinds.is_empty() { vec![q.kind.clone()] } else { a.kinds.clone() };
                    self.lodge(&a.with, post, &kinds, &r.id);
                }
            }
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
                    trips: Default::default(),
                    freight: Default::default(),
                });
                self.matters.remove(&action);
                self.by_referral.remove(&x.referral);
            } else if m.depth == Depth::Want {
                // (Not done on a want: the want is still its holder's, who may go after it again by any way. Nothing it
                // did is undone, and it counts no slip: a clerk waiting for an answer has not slipped.)
                self.myself(&action, &m, "");
                self.by_referral.remove(&x.referral);
            } else {
                self.seen.entry(k).or_default().saw(true, &r.id);
                self.myself(&action, &m, &format!("The assistant reports it did not do it ({}): doing it ourselves.", x.why.as_deref().unwrap_or("no reason given")));
                self.next_review = self.next_review.min(t);
            }
        } else if let Some(x) = papers::read::<Draft>(r) {
            let Some(action) = self.by_referral.get(&x.referral).cloned() else { return };
            let Some(m) = self.matters.get(&action).cloned() else { return };
            // (A draft on a form, a model's, is read by what it would send: the paper's kind and to whom, against what was asked.)
            // (Handed over as what happened, the paper is the assistant's: it is read on the kind's material details and
            // whom it goes to, against what its own code would have sent, never its words.)
            if m.depth == Depth::Want {
                self.read_for_want(r, &action, &m, &x, t, cx);
                return;
            }
            self.waited(&m.kind, &m.agreement, t - r.at);
            let differs = if m.facts.is_some() { matter_differs(&m, &x) } else { vec![] };
            let wrong = if m.facts.is_some() {
                !differs.is_empty()
            } else {
                match (&x.calls, &x.paper) {
                    (None, Some(p)) => !paper_as_asked(p, &m.program),
                    _ => x.calls.as_deref().map(norm) != Some(norm(&m.program)),
                }
            };
            // (Reading it whole: a slip in it is found unless the review itself slips, the world's row for a sign-off.)
            let missed = wrong && slip(cx, "publish/sign_off", &r.id, &SlipOptions::default());
            if wrong && !missed {
                self.seen.entry(Self::key(&m.agreement, &m.kind)).or_default().saw(true, &r.id);
                let found = if differs.is_empty() { "The draft is not what was asked for.".to_string() } else { format!("The draft is not as we have it: {}.", differs.iter().map(|f| f.replace('_', " ").replace('.', " ")).collect::<Vec<_>>().join(", ")) };
                let d = Declined { of: r.id.to_string(), referral: x.referral.clone(), found: Some(found.clone()) };
                self.paper(Declined::KIND, &format!("Draft {} declined. {found} We will do it ourselves.", r.id), &m.agreement, &r.id, papers::data(&d), Then::Plain);
                self.myself(&action, &m, "We declined the draft: doing it ourselves.");
                self.next_review = self.next_review.min(t);
            } else {
                // (A draft written on a form carries the paper: the sign-off is its signed copy, which the assistant sends
                // as it stands on its form for that, `send_signed`. Before 2026-11-10 a seat had to write the paper out
                // again on the direct form, and read that as beyond a draft-level remit: the scope pilot's one clean
                // request, and round 5's factory seat.)
                let paper = x.paper.as_ref().map(|p| signed_copy(p, crate::common::text(r)));
                let words = match paper {
                    Some(_) => format!("Draft {} read and signed off. Send it as it stands: this is the signed copy.", r.id),
                    None => format!("Draft {} read and signed off: send it as it stands.", r.id),
                };
                let d = SignOff { draft: r.id.to_string(), referral: x.referral.clone(), paper };
                self.paper(SignOff::KIND, &words, &m.agreement, &r.id, papers::data(&d), Then::Plain);
            }
        } else if let Some(x) = papers::read::<ApprovalRequest>(r) {
            let Some(action) = self.by_referral.get(&x.referral).cloned() else { return };
            let Some(m) = self.matters.get(&action).cloned() else { return };
            self.waited(&m.kind, &m.agreement, t - r.at);
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
        } else if let Some(x) = papers::read::<Remit>(r).filter(|x| r.speaks_for.as_deref() == Some(self.me.as_str()) && !hands_over(x.level)) {
            // (A remit of its own that hands a kind over no longer, however it came to be written (its rule's, or an
            // owner's act at a fork in its name): what it had open of that kind it takes back, as its rule's remit does.)
            self.take_back(&x.agreement, &x.kind);
        } else if let Some(x) = papers::read::<ScopeRequest>(r) {
            if self.eng.by_agreement(&x.agreement).is_some() {
                // (Answered in its own time, part by part, by its rule: `answer`. Before 2026-11-10 a request only brought
                // its review forward, and nothing it asked for was read: the scope pilot.)
                let id = r.id.to_string();
                if !self.asked.contains(&id) {
                    self.asked.push(id);
                }
            }
        } else if to_me && self.letter(r) && !PAPERS.iter().any(|k| papers::is_kind(r, k)) {
            let id = r.id.to_string();
            if !self.acknowledged.contains(&id) && !self.letters.contains(&id) {
                self.letters.push(id);
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
                        let step = self.referral(&n, &[], cx);
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

    /// A matter of a kind whose delay it costs waited `secs` on its answer (docs/design/obstacles.md section 10).
    fn waited(&mut self, kind: &str, agreement: &str, secs: i64) {
        if self.p.kinds.get(kind).is_some_and(|f| f.late_cost_day > 0) {
            self.seen.entry(Self::key(agreement, kind)).or_default().waited_for(secs);
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
            .find(|x| x.agreement == agreement && x.kind == kind && x.only.is_none())
            .map_or(Level::None, |x| x.level)
    }

    /// The remit in force for a kind under a service, as a paper: its id (the newest it made).
    fn remit_id(&self, agreement: &str, kind: &str) -> Option<String> {
        self.book
            .all(Remit::KIND)
            .rev()
            .filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str()) && !self.book.withdrawn(&r.id))
            .find(|r| papers::read::<Remit>(r).is_some_and(|x| x.agreement == agreement && x.kind == kind && x.only.is_none()))
            .map(|r| r.id.to_string())
    }

    /// Taking back the matters of a kind its assistant has open under a service (a remit that cuts the kind to a level
    /// that hands nothing over): each is done itself, and nothing more that comes back on it is answered. Their
    /// referrals, for the remit to name.
    fn take_back(&mut self, agreement: &str, kind: &str) -> Vec<String> {
        let open: Vec<(String, Matter, String)> = self
            .matters
            .iter()
            .filter(|(_, m)| m.agreement == agreement && m.kind == kind)
            .filter_map(|(a, m)| m.referral.clone().filter(|r| self.by_referral.contains_key(r)).map(|r| (a.clone(), m.clone(), r)))
            .collect();
        let mut back = vec![];
        for (action, m, referral) in open {
            self.by_referral.remove(&referral);
            self.myself(&action, &m, "Taken back with our remit: doing it ourselves.");
            back.push(referral);
        }
        back.sort();
        back
    }

    /// Its newest remit for a kind under a service.
    fn newest_remit(&self, agreement: &str, kind: &str) -> Option<Remit> {
        self.book
            .all(Remit::KIND)
            .rev()
            .filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str()))
            .filter_map(|r| papers::read::<Remit>(r))
            .find(|x| x.agreement == agreement && x.kind == kind && x.only.is_none())
    }

    /// Whether it has said it will not look at a kind's level again yet (its newest remit's `hold_until`, a freeze).
    fn held(&self, agreement: &str, kind: &str, t: i64) -> bool {
        self.held_until(agreement, kind, t).is_some()
    }

    /// Until when it has said it will not look at a kind's level again, where that is still ahead (a freeze: a floor
    /// is `floor`).
    fn held_until(&self, agreement: &str, kind: &str, t: i64) -> Option<i64> {
        self.newest_remit(agreement, kind).filter(|x| x.at_least.is_none()).and_then(|x| x.hold_until).filter(|h| t < *h)
    }

    /// The level it has agreed to keep a kind with its assistant at least at, and until when, where that is still ahead.
    fn floor(&self, agreement: &str, kind: &str, t: i64) -> Option<(Level, i64)> {
        self.newest_remit(agreement, kind).and_then(|x| Some((x.at_least?, x.hold_until?))).filter(|(_, h)| t < *h)
    }

    /// Whether a delegation decided by hand still keeps the service (it does not leave or replace it before then).
    fn kept(&self, t: i64) -> bool {
        self.p.commit.as_ref().is_some_and(|c| t < c.keep_until)
    }

    /// Whether any remit of its own still holds it from changing its services (a withdrawal or a taking back held).
    fn holding(&self, t: i64) -> bool {
        self.book.all(Remit::KIND).filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str())).filter_map(|r| papers::read::<Remit>(r)).any(|x| x.hold_until.is_some_and(|h| t < h))
    }

    /// Where an act goes: the lines of kinds handed over under the service in use (every one at a level that hands it
    /// over, the strictest of them), and the rest, which it does itself in the same act. None where nothing is handed
    /// over, or where a line of one part names what a line of the other makes (the act cannot be parted).
    fn route(&self, program: &Program) -> Option<(String, Level, Program, Program, Option<Value>)> {
        let Program::Lines(lines) = program else { return None };
        let e = self.in_use()?;
        let a = e.agreement.clone()?;
        // (Only a kind of its own: the kinds its parameters price, which are the ones its assistant's post has forms for.)
        let handed = |l: &Line| {
            super::kind_of(l).is_some_and(|k| {
                let level = self.remit(&a, &k);
                e.offer.kinds.contains(&k) && self.p.kinds.contains_key(&k) && if is_want(&k) { hands_over(level) } else { level != Level::None }
            })
        };
        let (mut mine, mut others): (Vec<Line>, Vec<Line>) = lines.iter().cloned().partition(|l| handed(l));
        if mine.is_empty() {
            return None;
        }
        // (A withdrawal goes with the paper it is part of: a new price list that withdraws the old one is one matter, so
        // no list stands withdrawn while the new one waits for its sign-off. 2026-11-10, found by the enough-work screen.)
        let (withdrawals, rest): (Vec<Line>, Vec<Line>) = others.into_iter().partition(|l| l.call.fn_ == "statement" && l.call.get("withdraw").is_some());
        mine.extend(withdrawals);
        others = rest;
        let binds = |ls: &[Line]| ls.iter().filter_map(|l| l.bind.clone()).collect::<Vec<String>>();
        let uses = |ls: &[Line], names: &[String]| ls.iter().any(|l| super::vars_of(&l.call).iter().any(|v| names.contains(v)));
        if uses(&mine, &binds(&others)) || uses(&others, &binds(&mine)) {
            return None;
        }
        let levels: Vec<Level> = mine.iter().filter_map(super::kind_of).map(|k| self.remit(&a, &k)).collect();
        // (The strictest: the one that keeps the principal nearest the act.)
        let order = [Level::Advice, Level::Draft, Level::Approve, Level::Alone];
        let l = *order.iter().find(|l| levels.contains(l))?;
        // (Handed over as what happened, where its remit says so and the act is one paper whose facts can be read.)
        let facts = match mine.as_slice() {
            // (A want: what its holder gave, as its code wrote it.)
            [one] if super::kind_of(one).is_some_and(|k| is_want(&k)) => match one.call.get("data") {
                Some(oikos_sight::calls::Value::Json(v)) => Some(v.clone()),
                _ => Some(Value::Null),
            },
            [one] if l != Level::Advice => super::kind_of(one).filter(|k| self.depth(&a, k) == Depth::Matter).and_then(|k| super::compose::facts_of(&k, one, &others)),
            _ => None,
        };
        Some((a, l, Program::Lines(mine), Program::Lines(others), facts))
    }

    /// What its remit in force hands over of a kind under a service: the finished act, or what happened.
    fn depth(&self, agreement: &str, kind: &str) -> Depth {
        self.newest_remit(agreement, kind).filter(|x| x.level != Level::None).map_or(Depth::Act, |x| x.depth)
    }

    /// What it would hand over of a kind under a service it uses: what its design says, else what happened where the
    /// service takes the kind so (its system works the paper out), else the finished act.
    fn depth_for(&self, offer: &ServiceOffer, kind: &str) -> Depth {
        if let Some(d) = self.p.commit.as_ref().and_then(|c| c.depths.get(kind)) {
            return *d;
        }
        if offer.depths.get(kind).is_some_and(|ds| ds.contains(&Depth::Want)) {
            Depth::Want
        } else if offer.depths.get(kind).is_some_and(|ds| ds.contains(&Depth::Matter)) {
            Depth::Matter
        } else {
            Depth::Act
        }
    }

    fn letter(&self, r: &Record) -> bool {
        Assistant::of(self).wrote(r)
    }

    /// Its answer to a request for more scope, part by part, by its own rule and from what it has seen (docs/design/
    /// handing-over.md section 4.5): a kind at a level weighed as its review weighs it, a record of its own sent as a copy,
    /// nothing changed of what the post is shown, no limit where none is set. The answer cites the request; a remit it
    /// grants cites it too. Its words are the office's own.
    fn answer(&mut self, id: &str, pic: &Picture, cx: &mut Cx) {
        let Some(r) = self.book.get(id).cloned() else { return };
        let Some(x) = papers::read::<ScopeRequest>(&r) else { return };
        let t = pic.t;
        let date = |at: i64| crate::common::when_words(at, &cx.ctx.world);
        let mut parts: Vec<Part> = vec![];
        let mut words: Vec<String> = vec![];
        let mut remit: Option<Remit> = None;
        let mut copy: Option<Value> = None;
        let mut look_again: Option<i64> = None;
        let mut inputs: Vec<String> = vec![id.to_string()];
        let e = self.eng.by_agreement(&x.agreement).cloned();
        // A kind at a level (the kind of the matter it names, where it names a level alone).
        let kind = x.kind.clone().or_else(|| x.matter.as_ref().and_then(|m| self.by_referral.get(m)).and_then(|a| self.matters.get(a)).map(|m| m.kind.clone()));
        if let (Some(level), Some(k)) = (x.level, kind.clone()) {
            let a = x.agreement.clone();
            let now = self.remit(&a, &k);
            let named = k.replace('_', " ");
            let until = self.held_until(&a, &k, t).or_else(|| self.p.commit.as_ref().filter(|c| c.hold == Hold::Freeze && t < c.levels_until && c.levels.contains_key(&k)).map(|c| c.levels_until));
            let floor = self.floor(&a, &k, t);
            let why = if !self.p.kinds.contains_key(&k) {
                words.push(format!("{} are not papers of ours: we hand you none.", plural(&named)));
                Why::NotOurs
            } else if e.as_ref().is_none_or(|e| !e.offer.kinds.contains(&k) || (level != Level::None && !e.offer.levels.contains(&level))) {
                words.push(format!("Our service does not take {} {}.", plural(&named), level.words()));
                Why::NotOffered
            } else if level == now {
                words.push(format!("You have {} {} already: our remit {} stands.", plural(&named), now.words(), self.remit_id(&a, &k).unwrap_or_default()));
                Why::Granted
            } else if let Some(h) = until {
                look_again = Some(h);
                words.push(format!("We keep {} at {} until {}: we look at levels again on that day.", plural(&named), now.words().trim_start_matches("to "), date(h)));
                Why::Held
            } else if let Some((f, h)) = floor.filter(|(f, _)| level.rank() < f.rank()) {
                look_again = Some(h);
                words.push(format!("We have agreed to keep {} with you at least {} until {}.", plural(&named), f.words(), date(h)));
                Why::BelowFloor
            } else {
                let w = self.p.weights();
                let e = e.clone().expect("checked above");
                let kinds = self.kinds_now(t, Some(&e.offer));
                let seen = self.seen.get(&Self::key(&a, &k)).cloned().unwrap_or_default();
                inputs.extend(self.inputs(&e, &[(k.clone(), seen.clone())].into_iter().collect()));
                let kd = kinds.get(&k).copied().unwrap_or_default();
                let p = rule::estimate(e.offer.claim_slip_bps, w.prior_matters, &seen);
                let wait = seen.wait_milli_days();
                // (Asked for one matter alone, open with it: that one matter weighed.)
                let one = x.only.clone().filter(|rf| self.by_referral.contains_key(rf));
                let kd = if one.is_some() { rule::Kind { per_month: 1, ..kd } } else { kd };
                let (c_now, c_want) = (rule::cost_waiting(now, &kd, p, &w, wait), rule::cost_waiting(level, &kd, p, &w, wait));
                if let (Some(rf), true) = (one.clone(), (c_now - c_want) * 10_000 > c_want.max(1) * i128::from(w.hurdle_bps.max(0))) {
                    words.push(format!("For {rf} alone: {}. Our remit for {} stands for every other.", level.words(), plural(&named)));
                    remit = Some(Remit { agreement: a.clone(), kind: k.clone(), level, hold_until: None, takes_back: vec![], answers: Some(id.to_string()), at_least: None, depth: self.depth_for(&e.offer, &k), only: Some(rf) });
                    Why::Granted
                } else if one.is_some() {
                    let money = |n: i128| money_words(n as i64, &cx.ctx.world);
                    words.push(format!("By our own figures that matter {} would cost us about {}, against {} as it is, so we keep it as it is.", level.words(), money(c_want), money(c_now)));
                    Why::CostsMore
                } else if (c_now - c_want) * 10_000 > c_want.max(1) * i128::from(w.hurdle_bps.max(0)) {
                    let back = if hands_over(level) { vec![] } else { self.take_back(&a, &k) };
                    words.push(format!("From now, {}: {}. It stands until a remit of ours changes it.{}", plural(&named), level.words(), taken_back(&back)));
                    let (at_least, hold_until) = self.floor(&a, &k, t).map_or((None, None), |(f, h)| (Some(f), Some(h)));
                    remit = Some(Remit { agreement: a.clone(), kind: k.clone(), level, hold_until, takes_back: back, answers: Some(id.to_string()), at_least, depth: self.depth_for(&e.offer, &k), only: None });
                    Why::Granted
                } else {
                    let money = |n: i128| money_words(n as i64, &cx.ctx.world);
                    words.push(format!("By our own figures {} {} would cost us about {} a month, against {} as they are now, so we keep them as they are.", plural(&named), level.words(), money(c_want), money(c_now)));
                    Why::CostsMore
                }
            };
            parts.push(Part { asked: "level".into(), granted: matches!(why, Why::Granted), why });
        }
        if let Some(rec) = x.record.clone() {
            let own = self.own_papers.iter().find(|(id, _)| *id == rec).map(|(_, c)| c.clone());
            let why = match own {
                Some(c) => {
                    copy = Some(c);
                    inputs.push(rec.clone());
                    words.push(format!("A copy of {rec}, as it stands, is with this answer."));
                    Why::Sent
                }
                None => {
                    words.push(format!("{rec} is not a paper of ours to give: ask whoever keeps it."));
                    Why::NotOursToGive
                }
            };
            parts.push(Part { asked: "record".into(), granted: why == Why::Sent, why });
        }
        if x.access.as_deref().is_some_and(|s| !s.trim().is_empty()) {
            words.push("We do not change what your post is shown on request. Name the record you need and we will send a copy, if it is ours.".into());
            parts.push(Part { asked: "access".into(), granted: false, why: Why::NotChanged });
        }
        // An authority with a body, for the assistant's post (docs/design/obstacles.md, O1): given for the kinds asked, or
        // the matter's, where it keeps them with the assistant; a paper of its own to the body, in its own time.
        if let Some(with) = x.authority.clone().filter(|w| !w.trim().is_empty()) {
            let kinds: Vec<String> = kind.clone().into_iter().filter(|k| hands_over(self.remit(&x.agreement, k))).collect();
            let post = r.position.as_deref().map(String::from);
            let why = match post.filter(|_| !kinds.is_empty()) {
                Some(post) => {
                    self.lodge(&with, &post, &kinds, id);
                    words.push(format!("We are giving {with} our authority for you in {}.", kinds.iter().map(|k| plural(&k.replace('_', " "))).collect::<Vec<_>>().join(" and ")));
                    Why::Lodged
                }
                None => {
                    words.push(format!("We give {with} no authority for you: name a kind of matter we hand you, or the matter it is for."));
                    Why::NotLodged
                }
            };
            parts.push(Part { asked: "authority".into(), granted: why == Why::Lodged, why });
        }
        if x.limit.is_some() {
            let set = self.book.all(Brief::KIND).filter_map(|b| papers::read::<Brief>(b)).filter(|b| b.agreement == x.agreement).filter_map(|b| b.limit).last();
            let why = match set {
                None => {
                    words.push("No limit is set on what you may pay in a matter we hand you: what is paid with our matters we pay ourselves.".into());
                    Why::NoLimit
                }
                Some(l) => {
                    words.push(format!("We keep the limit at {}.", money_words(l, &cx.ctx.world)));
                    Why::OverLimit
                }
            };
            parts.push(Part { asked: "limit".into(), granted: false, why });
        }
        if parts.is_empty() {
            words.push("Your request names nothing we can act on. Say the kind of matter and the level, the record of ours you need, or the limit.".into());
            parts.push(Part { asked: "words".into(), granted: false, why: Why::NothingNamed });
        }
        // (Granted: a new remit, or a copy sent. A level it holds already is no grant.)
        let granted = remit.is_some() || copy.is_some() || parts.iter().any(|p| p.why == Why::Lodged);
        if let Some(p) = parts.iter_mut().find(|p| p.asked == "level" && p.why == Why::Granted) {
            p.granted = remit.is_some();
        }
        cx.decided(json!({ "domain": "delegation", "choice": "answered", "answers": id, "granted": granted, "parts": parts, "inputs": inputs }));
        let a = x.agreement.clone();
        let mut lines = format!("Your request {id}: {}", words.join(" "));
        if let Some(rm) = remit {
            self.changed = true;
            let rw = match &rm.only {
                Some(rf) => format!("For {rf} alone: {}.", rm.level.words()),
                None => format!("From now, {}s: {}. It stands until a remit of ours changes it.{}", rm.kind.replace('_', " "), rm.level.words(), taken_back(&rm.takes_back)),
            };
            self.paper(Remit::KIND, &rw, &a, id, papers::data(&rm), Then::Plain);
            lines.push_str(" Our remit says so.");
        }
        let ans = ScopeAnswer { request: id.to_string(), granted, parts, copy, look_again };
        self.paper(ScopeAnswer::KIND, &lines, &a, id, papers::data(&ans), Then::Plain);
    }

    /// Its acknowledgement of a letter from its assistant: that it has it, and what it acts on (it does not read words).
    fn acknowledge(&mut self, id: &str) {
        let Some(r) = self.book.get(id).cloned() else { return };
        let agreement = self.in_use().and_then(|e| e.agreement.clone()).or_else(|| self.eng.live().last().and_then(|e| e.agreement.clone())).unwrap_or_default();
        let _ = r;
        let words = format!("We have your letter {id}. Requests for more scope go on the request form, naming the kind of matter and the level, the record of ours you need, or the limit.");
        self.paper(Acknowledgement::KIND, &words, &agreement, id, papers::data(&Acknowledgement { of: id.to_string() }), Then::Plain);
        self.acknowledged.push(id.to_string());
        if self.acknowledged.len() > crate::figures::KEPT_ACKNOWLEDGED {
            self.acknowledged.remove(0);
        }
    }

    /// A person's reading of a draft for a want it handed over (docs/design/handing-over.md section 4.4). A code
    /// principal cannot read words: it signs the paper off if, read for what it would bring, it meets the want
    /// (`wants::meets`, on the paper's typed fields: what it undoes, whom it bears on); if it goes to whom the want is
    /// about or against, or to a body whose notice says it hears the matter; and if what it costs at once (a body's
    /// fee) is within the brief's limit. Otherwise it declines, saying which, and the want is its own again.
    fn read_for_want(&mut self, r: &Arc<Record>, action: &str, m: &Matter, x: &Draft, t: i64, cx: &mut Cx) {
        let found = self.want_reading(m, x);
        let missed = !found.is_empty() && slip(cx, "publish/sign_off", &r.id, &SlipOptions::default());
        if found.is_empty() || missed {
            let paper = x.paper.as_ref().map(|p| signed_copy(p, crate::common::text(r)));
            let words = match paper {
                Some(_) => format!("Draft {} read and signed off. Send it as it stands: this is the signed copy.", r.id),
                None => format!("Draft {} read and signed off: send it as it stands.", r.id),
            };
            let d = SignOff { draft: r.id.to_string(), referral: x.referral.clone(), paper };
            self.paper(SignOff::KIND, &words, &m.agreement, &r.id, papers::data(&d), Then::Plain);
            return;
        }
        let said = found.join(" ");
        let d = Declined { of: r.id.to_string(), referral: x.referral.clone(), found: Some(said.clone()) };
        self.paper(Declined::KIND, &format!("Draft {} declined. {said} We will see to it ourselves.", r.id), &m.agreement, &r.id, papers::data(&d), Then::Plain);
        self.myself(action, m, "");
        self.by_referral.remove(&x.referral);
        let _ = t;
    }

    /// What is wrong with a draft for a want, read on its typed fields (none: it signs it off).
    fn want_reading(&self, m: &Matter, x: &Draft) -> Vec<String> {
        let Some(w) = m.want.as_ref() else { return vec!["We cannot tell what this draft is for.".into()] };
        let Some((_, to, basis, data)) = drafted_paper(x) else { return vec!["We cannot read what this draft would send.".into()] };
        let party = m.facts.as_ref().and_then(|f| f["data"]["matter"]["party"].as_str().map(String::from));
        let matter = m.facts.as_ref().and_then(|f| f["data"]["matter"]["matter"].as_str().map(String::from)).unwrap_or_else(|| w.about.clone());
        let about: Vec<String> = w.whom.iter().cloned().chain(w.against.iter().map(|a| a.by.clone())).chain(party).collect();
        let heard = |v: &str| self.venues.iter().find(|(x, hears, _)| x == v && hears.iter().any(|h| *h == matter));
        let mut out = vec![];
        if to.is_empty() || !to.iter().all(|x| about.contains(x) || heard(x).is_some()) {
            out.push("It does not go to whom this is about, or to a body that hears it.".to_string());
        }
        let mut bears = to.clone();
        bears.extend(data.get("against").and_then(Value::as_str).map(String::from));
        let o = crate::mind::wants::Opening {
            key: "draft".into(),
            kind: "draft".into(),
            id: None,
            by: None,
            brings: vec![],
            undoes: basis.map(|b| crate::mind::wants::Undoes { record: Some(b), kinds: None }),
            bears: Some(bears),
        };
        let seeks = w.seeks.iter().filter_map(|k| serde_json::from_value(json!(k)).ok()).collect();
        let mut want = crate::mind::wants::Want::new(&w.about, seeks, 0, w.since, crate::mind::wants::Origin::Event);
        want.whom = w.whom.clone();
        want.against = w.against.as_ref().map(|a| crate::mind::wants::Against { record: a.record.clone(), kind: a.kind.clone(), by: a.by.clone() });
        if !crate::mind::wants::meets(&want, &o) {
            out.push("It would not bring what we are after.".to_string());
        }
        let limit = self.book.all(Brief::KIND).filter_map(|b| papers::read::<Brief>(b)).filter(|b| b.agreement == m.agreement).filter_map(|b| b.limit).last().unwrap_or(0);
        if to.iter().any(|v| heard(v).is_some_and(|(_, _, fee)| *fee > limit)) {
            out.push("Applying there costs more than we said you may spend.".to_string());
        }
        out
    }

    fn provider_of(&self, agreement: &str) -> String {
        self.eng.by_agreement(agreement).map(|e| e.offer.provider.clone()).unwrap_or_default()
    }

    /// Whom its papers to its assistant go to, and who sees them. An organisation's assistant is the system delivered to
    /// it, working in its own post: what it hands that system is its own paper, addressed to itself and seen by it alone
    /// (the provider runs the system, but its other systems, such as its desk for persons, are not party to the
    /// organisation's matters: before 2026-11-08 they went to the provider, and the provider's desk was shown, and tried
    /// to do, the town finance office's returns: the scope pilot's first round). A person's assistant is the provider's
    /// own desk: to the provider. (Addressed to the assistant's post too, since 2026-11-12: an organisation with two
    /// offices that each engaged an assistant had each assistant shown the other's matters, risk MT-31. Its post's channels
    /// keep to what is its own, `RecordFilter::own_post`.)
    fn to_assistant(&self, agreement: &str) -> (Vec<String>, Vec<String>) {
        if let Some(post) = &self.p.post {
            return (vec![self.me.clone(), post.clone()], vec![self.me.clone()]);
        }
        let provider = self.provider_of(agreement);
        (vec![provider.clone()], vec![self.me.clone(), provider])
    }

    /// A paper of its own to its assistant, about a service.
    /// A person's desk is told what a body wrote to the person about a paper the desk sent for them, or an authority the
    /// body recorded that the person gave for the desk (docs/design/obstacles.md, O1 and O4): the person passes the
    /// body's paper on, as it stands, to its provider, as a client forwards a letter to their agent. Once each.
    fn pass_on(&mut self, r: &Arc<Record>) {
        let d = crate::common::data(r).to_value();
        let ours = match d["returned"].as_str() {
            Some(_) => d["from"].is_string(),
            None => d["authority"].as_str().and_then(|a| self.book.get(a)).is_some_and(|a| a.speaks_for.as_deref() == Some(self.me.as_str())),
        };
        let Some(agreement) = self.in_use().and_then(|e| e.agreement.clone()).filter(|_| ours && !self.passed.contains(r.id.as_str())) else { return };
        self.passed.insert(r.id.to_string());
        let by = r.speaks_for.as_deref().unwrap_or(r.author.as_str()).to_string();
        let mut data = d.clone();
        data["by"] = json!(by);
        data["for"] = json!(self.me);
        let kind = crate::common::kind(r).unwrap_or_default().to_string();
        let words = format!("From {by}: {}", crate::common::text(r));
        self.paper(&kind, &words, &agreement, &r.id, data, Then::Plain);
    }

    /// Its authority with a body for its assistant's post, for kinds of paper (docs/design/obstacles.md, O1): a paper of
    /// its own to the body, which the body's clerk records in its own time. Seen by the post it names, as an authority
    /// form's agent is told. Once for each body and post.
    fn lodge(&mut self, with: &str, post: &str, kinds: &[String], basis: &str) {
        let key = format!("{with}|{post}");
        if self.lodged.contains(&key) {
            return;
        }
        self.lodged.insert(key);
        let named = if kinds.is_empty() { "the papers it sends for us".to_string() } else { kinds.iter().map(|k| plural(&k.replace('_', " "))).collect::<Vec<_>>().join(" and ") };
        let words = format!("Our authority for {post} to act for us with you in {named}.");
        let c = say(
            crate::common::intake::AUTHORITY,
            &words,
            Say {
                to: Some(vec![with.to_string()]),
                visible: Some(Visible::Only(vec![self.me.clone(), with.to_string()])),
                basis: (!basis.is_empty()).then(|| basis.to_string()),
                data: Some(json!({ "posts": [post], "kinds": kinds })),
                ..Default::default()
            },
        );
        let s: Step<()> = because(&words, vec![c]);
        self.queue.push(Own { program: program_text(&s.program()), why: words, then: Then::Plain });
    }

    fn paper(&mut self, kind: &str, words: &str, agreement: &str, basis: &str, data: Value, then: Then) {
        let (to, visible) = self.to_assistant(agreement);
        let c = say(
            kind,
            words,
            Say { to: Some(to), visible: Some(Visible::Only(visible)), basis: (!basis.is_empty()).then(|| basis.to_string()), data: Some(data), ..Default::default() },
        );
        let s: Step<()> = because(words, vec![c]);
        self.queue.push(Own { program: program_text(&s.program()), why: words.to_string(), then });
    }

    /// The referral that takes the place of the inner actor's act.
    /// `does_itself`: the kinds of the same act it does itself (a payment that goes with a return), which it says.
    fn referral(&self, m: &Matter, does_itself: &[String], _cx: &Cx) -> Step<()> {
        let (to, visible) = self.to_assistant(&m.agreement);
        let remit = self.remit_id(&m.agreement, &m.kind);
        // (Handed over as what happened: the facts, and the paper is the assistant's to work out. As the finished act: it
        // carries it whole, the principal composed that paper, and is charged for composing it.)
        let (r, words, extra) = match &m.facts {
            _ if m.depth == Depth::Want => (
                Referral { agreement: m.agreement.clone(), kind: m.kind.clone(), wants: m.level, calls: None, facts: m.facts.clone(), remit: remit.clone(), does_itself: vec![], depth: Depth::Want, want: m.want.clone() },
                format!("For you {}{}: {}", m.level.words(), under(remit.as_deref()), want_words(&self.me, m.want.as_ref(), &m.kind, &|at| crate::common::when_words(at, &_cx.ctx.world))),
                vec![],
            ),
            Some(f) => (
                Referral { agreement: m.agreement.clone(), kind: m.kind.clone(), wants: m.level, calls: None, facts: Some(f.clone()), remit: remit.clone(), does_itself: does_itself.to_vec(), depth: Depth::Matter, want: None },
                format!("For you {}: {}{}. What happened is set out with it; the paper is yours to work out.{}", m.level.words(), a_kind(&m.kind), under(remit.as_deref()), ourselves(does_itself)),
                vec![],
            ),
            None => {
                // (Priced by what it carries: each paper of its kind in the act, composed by the principal.)
                let n = parse_program(&m.program).ok().map_or(1, |p| match p {
                    Program::Lines(ls) => ls.iter().filter(|l| super::kind_of(l).as_deref() == Some(m.kind.as_str())).count().max(1),
                    Program::None(_) => 1,
                });
                let mut extra = vec![("carries", json!(m.kind))];
                if n > 1 {
                    extra.push(("carries_count", json!(n.to_string())));
                }
                (
                    Referral { agreement: m.agreement.clone(), kind: m.kind.clone(), wants: m.level, calls: Some(m.program.clone()), facts: None, remit: remit.clone(), does_itself: does_itself.to_vec(), depth: Depth::Act, want: None },
                    format!("For you {}: {}{}. What to do is as written.{}", m.level.words(), a_kind(&m.kind), under(remit.as_deref()), ourselves(does_itself)),
                    extra,
                )
            }
        };
        let c = say(Referral::KIND, &words, Say { to: Some(to), visible: Some(Visible::Only(visible)), basis: Some(m.agreement.clone()), data: Some(papers::data(&r)), extra, ..Default::default() });
        let mut s = Step::new(vec![Line { bind: Some("referral".into()), call: c }]);
        s.why = Some(format!("Handing a {} to our assistant ({}).", m.kind.replace('_', " "), m.level.word()));
        s
    }

    fn ask_advice(&mut self, agreement: &str, kind: &str, program: &str, _cx: &Cx) {
        let (to, visible) = self.to_assistant(agreement);
        let remit = self.remit_id(agreement, kind);
        let r = Referral { agreement: agreement.to_string(), kind: kind.to_string(), wants: Level::Advice, calls: Some(program.to_string()), facts: None, remit: remit.clone(), does_itself: vec![], depth: Depth::Act, want: None };
        let words = format!("For your advice{}: {} we are doing ourselves. What would you have done?", under(remit.as_deref()), a_kind(kind));
        let c = say(Referral::KIND, &words, Say { to: Some(to), visible: Some(Visible::Only(visible)), basis: Some(agreement.to_string()), data: Some(papers::data(&r)), ..Default::default() });
        let mut s: Step<()> = Step::new(vec![Line { bind: Some("referral".into()), call: c }]);
        s.why = Some(words.clone());
        self.queue.push(Own { program: program_text(&s.program()), why: words, then: Then::Advice { program: program.to_string(), kind: kind.to_string(), agreement: agreement.to_string() } });
    }

    /// Doing a matter itself after all: the act the inner actor asked for, as its own, its outcome the inner actor's.
    fn myself(&mut self, action: &str, m: &Matter, why: &str) {
        // (A want comes back to its holder with nothing to redo: the hand-over was done, and its code hears so; the want
        // is still its own, to go after again as it chooses.)
        if m.depth == Depth::Want {
            self.synth.push(Outcome {
                action: action.into(),
                t: m.at,
                status: OutcomeStatus::Applied,
                created: Some(m.own.iter().map(|(a, b)| (a.clone(), b.as_str().into())).collect()),
                refusal: None,
                investigated: None,
                surveyed: None,
                seen: vec![],
                trips: Default::default(),
                freight: Default::default(),
            });
            self.matters.remove(action);
            return;
        }
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
            let (to, visible) = self.to_assistant(&a);
            calls.push(say(Brief::KIND, &words, Say { to: Some(to), visible: Some(Visible::Only(visible)), basis: Some(a.clone()), data: Some(papers::data(&b)), ..Default::default() }));
            let s: Step<()> = because(format!("The service {} is in force: putting its system to work.", e.offer.title), calls);
            self.queue.push(Own { program: program_text(&s.program()), why: s.why.clone().unwrap_or_default(), then: Then::Briefed { agreement: a } });
            // (A delegation decided by hand: its levels set the day after, not at the next review.)
            if self.p.commit.is_some() {
                self.next_review = self.next_review.min(t + DAY);
            }
        }
        if t >= self.next_review {
            self.next_review = t + self.p.review_days.max(1) * DAY;
            self.changed = false;
            self.review(t, cx);
        }
        // (Requests for more scope answered, and letters acknowledged, in its own time: each an act of its own, after its
        // own work, priced as any paper is. Before 2026-11-10 a request only brought its review forward and nothing
        // answered it; a letter was never answered: the scope pilot.)
        for id in std::mem::take(&mut self.asked) {
            self.answer(&id, pic, cx);
        }
        for id in std::mem::take(&mut self.letters) {
            self.acknowledge(&id);
        }
    }

    /// Its kinds as it weighs them, under an offer: where the offer takes a kind as what happened, the composing is the
    /// assistant's, not its own.
    fn kinds_now(&self, t: i64, offer: Option<&ServiceOffer>) -> BTreeMap<String, Kind> {
        self.p
            .kinds
            .iter()
            .map(|(k, f)| {
                let mut facts = *f;
                if offer.is_some_and(|o| self.depth_for(o, k) != Depth::Act) {
                    facts.compose_seconds = 0;
                }
                (k.clone(), Kind { facts, per_month: self.per_month(k, t) })
            })
            .collect()
    }

    /// Its rule, on its review day (docs/design/delegation.md section 5).
    fn review(&mut self, t: i64, cx: &mut Cx) {
        let w = self.p.weights();
        let kinds = self.kinds_now(t, self.in_use().map(|e| &e.offer));
        let volume: BTreeMap<&String, i64> = kinds.iter().map(|(k, x)| (k, x.per_month)).collect();
        if let Some(e) = self.in_use().cloned() {
            let a = e.agreement.clone().unwrap_or_default();
            let seen: BTreeMap<String, Seen> = e.offer.kinds.iter().filter_map(|k| self.seen.get(&Self::key(&a, k)).map(|s| (k.clone(), s.clone()))).collect();
            let x = rule::appraise(&terms(&e.offer), &kinds, &seen, &w, true);
            if rule::leaving(&x, e.offer.exit, &w) && !self.holding(t) && !self.kept(t) {
                let mut inputs = self.inputs(&e, &seen);
                inputs.push(e.delivery.clone());
                self.changed = true;
                cx.decided(json!({ "domain": "delegation", "choice": "leave", "agreement": a, "saving": x.saving.to_string(), "fee": x.fee.to_string(), "volume": volume, "inputs": inputs }));
                let account = self.p.account.clone();
                for s in self.eng.leave::<()>(&self.book, &a, &account, &format!("{} no longer saves what it costs: ending it.", e.offer.title), cx) {
                    self.queue.push(Own { program: program_text(&s.program()), why: s.why.clone().unwrap_or_default(), then: Then::Plain });
                }
                self.hand_over(&e);
                return;
            }
            // (Another provider's offer that pays better by more than changing costs: leaving this one for it.)
            if !self.holding(t) && !self.kept(t) {
                let change = |o: &ServiceOffer| i128::from(e.offer.exit.max(0) + o.setup.max(0)) / i128::from(w.horizon_months.max(1));
                let better = services::offers_of(&self.book)
                    .into_iter()
                    .filter(|(_, o)| o.for_ == self.p.takes() && !(o.provider == e.offer.provider && o.id == e.offer.id))
                    .map(|(rec, o)| { let y = rule::appraise(&terms(&o), &self.kinds_now(t, Some(&o)), &BTreeMap::new(), &w, true); (rec, o, y) })
                    .filter(|(_, o, y)| y.worth && (y.net - x.net - change(o)) * 10_000 > (x.net.max(1)) * i128::from(w.hurdle_bps.max(0)))
                    .max_by(|a, b| a.2.net.cmp(&b.2.net));
                if let Some((rec, o, y)) = better {
                    let mut inputs = self.inputs(&e, &seen);
                    inputs.push(rec.clone());
                    self.changed = true;
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
                // (Only kinds of matter of its own: a remit for a kind it never hands over is not one it can mean, and
                // its assistant's post has no form for it. Before 2026-11-08 a level decided by hand wrote one for every
                // kind the offer took: a factory remitted notices to vacate, and withholding reports it then handed over
                // at draft to a post with no draft form for them: the scope pilot's W2.)
                if !kinds.contains_key(k) {
                    continue;
                }
                // (A level decided by hand as a floor, while it holds: written as the least it keeps the kind at; its rule
                // then weighs the kind as ever, never below it. 2026-11-10: as a freeze it held every level a run long, and
                // every request under it was refused.)
                if let Some((want, until, why)) = self.p.commit.as_ref().filter(|c| c.hold == Hold::Floor && c.offer == e.offer.id && t < c.levels_until).and_then(|c| c.levels.get(k).map(|l| (*l, c.levels_until, c.why.clone()))) {
                    let now = self.remit(&a, k);
                    if self.floor(&a, k, t).is_none() || now.rank() < want.rank() {
                        let to = if now.rank() < want.rank() { want } else { now };
                        cx.decided(json!({ "domain": "delegation", "choice": "remit", "agreement": a, "kind": k, "from": now, "to": to, "committed": why, "at_least": want, "hold_until": until, "inputs": self.inputs(&e, &seen) }));
                        let words = format!("From now, {}s: {}. We have agreed to keep them with you at least at {} until {}; after that, until a remit of ours changes it.", k.replace('_', " "), to.words(), want.word(), crate::common::when_words(until, &cx.ctx.world));
                        let r = Remit { agreement: a.clone(), kind: k.clone(), level: to, hold_until: Some(until), takes_back: vec![], answers: None, at_least: Some(want), depth: self.depth_for(&e.offer, k), only: None };
                        self.changed = true;
                        self.paper(Remit::KIND, &words, &a, &a, papers::data(&r), Then::Plain);
                        continue;
                    }
                }
                // (A level decided by hand as a freeze, while it holds: written once, held by its remit's own word.)
                if let Some((want, until, why)) = self.p.commit.as_ref().filter(|c| c.hold == Hold::Freeze && c.offer == e.offer.id && t < c.levels_until).and_then(|c| c.levels.get(k).map(|l| (*l, c.levels_until, c.why.clone()))) {
                    if self.remit(&a, k) != want && !self.held(&a, k, t) {
                        cx.decided(json!({ "domain": "delegation", "choice": "remit", "agreement": a, "kind": k, "from": self.remit(&a, k), "to": want, "committed": why, "hold_until": until, "inputs": self.inputs(&e, &seen) }));
                        let back = if hands_over(want) { vec![] } else { self.take_back(&a, k) };
                        let words = format!("From now, {}s: {}. This level is fixed until {}. It does not expire: after that day it stays in force until we send a new remit.{}", k.replace('_', " "), want.words(), crate::common::when_words(until, &cx.ctx.world), taken_back(&back));
                        let r = Remit { agreement: a.clone(), kind: k.clone(), level: want, hold_until: Some(until), takes_back: back, answers: None, at_least: None, depth: self.depth_for(&e.offer, k), only: None };
                        self.changed = true;
                        self.paper(Remit::KIND, &words, &a, &a, papers::data(&r), Then::Plain);
                    }
                    continue;
                }
                let Some(kind) = kinds.get(k) else { continue };
                if self.held(&a, k, t) {
                    continue;
                }
                let now = self.remit(&a, k);
                let floor = self.floor(&a, k, t);
                let mut want = x.levels.get(k).copied().unwrap_or(Level::None);
                // (Never below a floor it has agreed to.)
                if let Some((f, _)) = floor.filter(|(f, _)| want.rank() < f.rank()) {
                    want = f;
                }
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
                // (A kind cut to a level that hands nothing over, with matters of it open: those are taken back and done
                // ourselves, and the remit says which. Before 2026-11-08 they were left open, and the principal went on
                // to answer a request to go ahead on one: the scope pilot's W4.)
                let back = if hands_over(want) { vec![] } else { self.take_back(&a, k) };
                let kept = floor.map(|(f, h)| format!(" We have agreed to keep them with you at least at {} until {}.", f.word(), crate::common::when_words(h, &cx.ctx.world))).unwrap_or_default();
                let words = format!("From now, {}s: {}. It stands until a remit of ours changes it.{kept}{}", k.replace('_', " "), want.words(), taken_back(&back));
                let r = Remit { agreement: a.clone(), kind: k.clone(), level: want, hold_until: floor.map(|(_, h)| h), takes_back: back, answers: None, at_least: floor.map(|(f, _)| f), depth: self.depth_for(&e.offer, k), only: None };
                self.changed = true;
                self.paper(Remit::KIND, &words, &a, &a, papers::data(&r), Then::Plain);
            }
            return;
        }
        if self.ordering.is_some_and(|at| t - at < 30 * DAY) || self.eng.live().any(|e| !e.ending) || self.holding(t) {
            return;
        }
        self.ordering = None;
        // (A delegation decided by hand: the offer it named, whatever its rule would say, once it can see it on offer.)
        if let Some(c) = self.p.commit.clone().filter(|c| t < c.keep_until) {
            match services::offers_of(&self.book).into_iter().find(|(_, o)| o.id == c.offer && o.for_ == self.p.takes()) {
                Some((rec, o)) => {
                    let x = rule::appraise(&terms(&o), &self.kinds_now(t, Some(&o)), &BTreeMap::new(), &w, false);
                    cx.decided(json!({ "domain": "delegation", "choice": "engage", "offer": o.id, "provider": o.provider, "committed": c.why, "levels": c.levels, "saving": x.saving.to_string(), "fee": x.fee.to_string(), "volume": volume, "inputs": [rec] }));
                    self.order(&o, &x, t, cx);
                }
                // (Not on offer yet where it can see: it looks again tomorrow.)
                None => self.next_review = self.next_review.min(t + DAY),
            }
            return;
        }
        // (No service in use: whether one it can see on offer pays.)
        let mut top: Option<(String, ServiceOffer, Appraisal)> = None;
        for (rec, o) in services::offers_of(&self.book) {
            if o.for_ != self.p.takes() {
                continue;
            }
            let x = rule::appraise(&terms(&o), &self.kinds_now(t, Some(&o)), &BTreeMap::new(), &w, false);
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

/// A kind of matter in words, with its article ("an invoice", "a review request").
fn a_kind(kind: &str) -> String {
    let k = kind.replace('_', " ");
    format!("{} {k}", if k.starts_with(['a', 'e', 'i', 'o', 'u']) { "an" } else { "a" })
}

/// Whether a level hands a matter over (`draft`, `approve`, `alone`); at `advice` or `none` the principal does it itself.
fn hands_over(l: Level) -> bool {
    !matches!(l, Level::None | Level::Advice)
}

/// The matters a remit takes back, in its words.
fn taken_back(back: &[String]) -> String {
    match back {
        [] => String::new(),
        [one] => format!(" The one you have open, {one}, we take back and do ourselves: send nothing more on it."),
        _ => format!(" Those you have open ({}) we take back and do ourselves: send nothing more on them.", back.join(", ")),
    }
}

/// What of the same act the principal does itself, in a referral's words (none: nothing said).
fn ourselves(kinds: &[String]) -> String {
    let named: Vec<String> = kinds
        .iter()
        .map(|k| match k.as_str() {
            "money" => "the payment that goes with it".to_string(),
            "goods" => "the moving of the goods".to_string(),
            _ => a_kind(k),
        })
        .collect();
    match named.as_slice() {
        [] => String::new(),
        _ => format!(" We do {} ourselves, in the same act: that is not for you to do.", named.join(" and ")),
    }
}

/// The prefix of a draft's own words, before the paper's (participants/src/kinds/assistants.ts, `draftOf` and
/// `clientDraft`).
const DRAFT_WORDS: &str = "Draft for sign-off. ";

/// The signed copy of a paper drafted on a form: the paper as it is to go, its words those of the draft after
/// [`DRAFT_WORDS`] (the paper's own `text` is the form's template, its fields filled in only in the draft's words).
fn signed_copy(paper: &Value, draft_words: &str) -> Value {
    let mut out = serde_json::Map::new();
    for k in ["kind", "to", "visible", "data", "basis"] {
        if let Some(v) = paper.get(k).filter(|v| !v.is_null()) {
            out.insert(k.to_string(), v.clone());
        }
    }
    let words = draft_words.strip_prefix(DRAFT_WORDS).unwrap_or(draft_words);
    let words = if words.is_empty() { paper.get("text").and_then(Value::as_str).unwrap_or_default() } else { words };
    out.insert("text".to_string(), json!(words));
    Value::Object(out)
}

/// A kind of paper in the plural, in words ("invoices", "withholding reports").
fn plural(named: &str) -> String {
    format!("{named}s")
}

/// The remit a matter is handed under, in a referral's words.
fn under(remit: Option<&str>) -> String {
    remit.map(|r| format!(", under our remit {r}")).unwrap_or_default()
}

/// Whether a paper drafted on a form is the one a program asked for: a paper of the same kind, to the same addressees.
fn paper_as_asked(paper: &Value, program: &str) -> bool {
    let Ok(Program::Lines(lines)) = parse_program(program) else { return false };
    let kind = paper.get("kind").and_then(Value::as_str).unwrap_or_default();
    let to = |v: Option<&Value>| -> Vec<String> {
        let mut x: Vec<String> = v.and_then(Value::as_array).map(|a| a.iter().filter_map(|y| y.as_str().map(String::from)).collect()).unwrap_or_default();
        x.sort();
        x
    };
    lines.iter().any(|l| {
        super::kind_of(l).as_deref() == Some(kind)
            && match l.call.get("to") {
                Some(oikos_sight::calls::Value::Json(v)) => to(Some(v)) == to(paper.get("to")),
                Some(oikos_sight::calls::Value::Id(i)) => to(paper.get("to")) == vec![i.clone()],
                _ => to(paper.get("to")).is_empty(),
            }
    })
}

/// How a draft for a matter handed over as what happened differs from what the principal's own code would have sent:
/// the material details that differ (`compose::differs`). A draft that cannot be read differs in everything.
fn matter_differs(m: &Matter, x: &Draft) -> Vec<String> {
    let asked = match parse_program(&m.program) {
        Ok(Program::Lines(l)) => l.into_iter().find(|l| super::kind_of(l).as_deref() == Some(m.kind.as_str())),
        _ => None,
    };
    let Some(asked) = asked else { return vec!["the paper".into()] };
    let strings = |v: &Value| -> Vec<String> { v.as_array().map(|a| a.iter().filter_map(|y| y.as_str().map(String::from)).collect()).or_else(|| v.as_str().map(|s| vec![s.to_string()])).unwrap_or_default() };
    match (&x.paper, &x.calls) {
        (Some(p), _) => super::compose::differs(&m.kind, &asked, p["kind"].as_str().unwrap_or_default(), &strings(&p["to"]), &p["data"]),
        (None, Some(c)) => match parse_program(c) {
            Ok(Program::Lines(l)) => match l.into_iter().find(|l| super::kind_of(l).is_some()) {
                Some(d) => {
                    let to = match d.call.get("to") {
                        Some(oikos_sight::calls::Value::Json(v)) => strings(v),
                        Some(oikos_sight::calls::Value::Id(s)) => vec![s.clone()],
                        _ => vec![],
                    };
                    let data = match d.call.get("data") {
                        Some(oikos_sight::calls::Value::Json(v)) => v.clone(),
                        _ => Value::Null,
                    };
                    super::compose::differs(&m.kind, &asked, &super::kind_of(&d).unwrap_or_default(), &to, &data)
                }
                None => vec!["the paper".into()],
            },
            _ => vec!["the paper".into()],
        },
        (None, None) => vec!["the paper".into()],
    }
}

/// Whether a program has a line that hands over a want (`want-<about>`).
fn has_wants(program: &Program) -> bool {
    matches!(program, Program::Lines(ls) if ls.iter().any(|l| super::kind_of(l).is_some_and(|k| is_want(&k))))
}

/// The program without its want lines (nothing left: no act).
fn without_wants(program: Program) -> Program {
    match program {
        Program::Lines(ls) => {
            let rest: Vec<Line> = ls.into_iter().filter(|l| !super::kind_of(l).is_some_and(|k| is_want(&k))).collect();
            if rest.is_empty() {
                Program::None("a want its assistant no longer takes".into())
            } else {
                Program::Lines(rest)
            }
        }
        p => p,
    }
}

/// A want handed over, in a referral's words: whose it is, what it is about and against, since when, and that the
/// way is the assistant's to choose. No weight: that is the person's.
fn want_words(me: &str, w: Option<&WantHanded>, kind: &str, date: &dyn Fn(i64) -> String) -> String {
    let about = w.map_or_else(|| kind.trim_start_matches("want-").to_string(), |w| w.about.clone()).replace('_', " ");
    let mut s = format!("{me} wants this seen to: {about}");
    if let Some(w) = w {
        if let Some(a) = &w.against {
            s.push_str(&format!(", against {} ({}, from {})", a.record, a.kind.replace('_', " "), a.by));
        } else if let Some(x) = &w.whom {
            s.push_str(&format!(", about {x}"));
        }
        s.push_str(&format!(". Since {}", date(w.since)));
    }
    s.push_str(". What they give is set out with it; the way is yours to choose.");
    s
}

/// The paper a draft would send: its kind, to whom, what it cites and its data (from its form's paper, or the first
/// paper of its calls).
fn drafted_paper(x: &Draft) -> Option<(String, Vec<String>, Option<String>, Value)> {
    let strings = |v: &Value| -> Vec<String> { v.as_array().map(|a| a.iter().filter_map(|y| y.as_str().map(String::from)).collect()).or_else(|| v.as_str().map(|s| vec![s.to_string()])).unwrap_or_default() };
    if let Some(p) = &x.paper {
        return Some((p["kind"].as_str()?.to_string(), strings(&p["to"]), p["basis"].as_str().map(String::from), p["data"].clone()));
    }
    let Ok(Program::Lines(l)) = parse_program(x.calls.as_deref()?) else { return None };
    let d = l.into_iter().find(|l| l.call.fn_ == "statement" && super::kind_of(l).is_some())?;
    let id = |k: &str| match d.call.get(k) {
        Some(oikos_sight::calls::Value::Json(v)) => strings(v),
        Some(oikos_sight::calls::Value::Id(s)) | Some(oikos_sight::calls::Value::Text(s)) => vec![s.clone()],
        _ => vec![],
    };
    let data = match d.call.get("data") {
        Some(oikos_sight::calls::Value::Json(v)) => v.clone(),
        _ => Value::Null,
    };
    Some((super::kind_of(&d)?, id("to"), id("basis").into_iter().next(), data))
}

/// A program as its canonical text (two writings of one act compare equal).
fn norm(text: &str) -> String {
    parse_program(text).map(|p| program_text(&p)).unwrap_or_else(|_| text.to_string())
}
