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
    is_want, Acknowledgement, Asked, Advice, ApprovalRequest, Brief, Declined, Depth, Draft, Forward, GoAhead, Level, Need, Part, Weighing, Question, QuestionAnswer, Referral, Remit, Report, ScopeAnswer, ScopeRequest, ServiceEnded, ServiceOffer, SignOff, WantHanded, Why, KINDS as PAPERS,
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
    /// It says how things stand with it on each hand-over (the generator's `assistant_situation`): what it has in hand
    /// today, what regular payment comes in, its next rent and its day. Off: the hand-over as before.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub situation: bool,
    /// A delegation it has already decided on, by hand (`Commit`): absent, its rule decides everything.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<Commit>,
    /// Its own form for each kind it may hand over, as its stationery has it (`fields` and `writes`, its own details
    /// filled in): what a matter's facts are read back on, and what its assistant composes on (docs/design/broad-seats.md,
    /// G2). A kind with none goes as the finished act.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub forms: BTreeMap<String, Value>,
    /// Kinds whose day's delay is costed only for one matter of theirs (`kind -> matter`, the matter word its paper
    /// names): a request to put right a refused claim costs a day of the payment, one about disrepair does not.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub late_matters: BTreeMap<String, String>,
    /// How many days it waits on a matter it handed over with no word from its assistant before it asks after it, and
    /// again before it does it itself (`answers::left_open`; a want's is its `wants.answer_days`). Absent: 14 days,
    /// a placeholder (MT-37).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patience_days: Option<i64>,
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
    /// The day named on a paper the matter came from, as its referral gives it (`Referral.due`, C1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    due: Option<i64>,
    /// A reply on a matter handed over: (the matter's referral, its kind, the body's paper it answers).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    follows: Option<(String, String, String)>,
    /// It has given its answer on the matter (a sign-off or a go-ahead): no longer waiting on it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    answered: bool,
    /// It is doing the whole matter itself (it declined a draft of a matter of one paper): it signs nothing more in it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    taken: bool,
    /// The papers of a matter of several it has sent itself, by whom each goes to: a draft of one of them is done already.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    ours: BTreeSet<String>,
}

/// A paper another sent it (addressed to it), as it keeps it in its files: what a referral says the matter came from,
/// and the days it names (docs/design/stakes.md, C1 and B2).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PaperIn {
    id: String,
    at: i64,
    kind: String,
    from: String,
    text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    dates: Vec<(String, i64)>,
    /// The papers it cites or names by reference (its basis, and the record ids among its details): what a paper of the
    /// client's own that cites one it was never sent stands on.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    names: Vec<String>,
}

/// Why and by when, as a referral gives them (`State::grounds`).
#[derive(Debug, Clone, Default)]
struct Grounds {
    due: Option<(i64, String)>,
    /// Who sent the paper that names `due`.
    due_by: Option<String>,
    why: Vec<String>,
    /// Its own day for a draft (`Referral.draft_by`).
    draft_by: Option<i64>,
}

/// What a principal tells its assistant of its own position, by the kind of matter: fixed words, the blanks filled from
/// the matter's own paper (docs/behaviour/assistants.md, "Why and by when"). A fact of its own, never a cost worked out
/// for it and never what to do. A kind not named: nothing of its own position is told.
pub(super) const TOLD: &[(&str, &str)] = &[("benefit_claim", "Until the claim is decided we are not paid {payment}.")];

/// How much of a paper's words a referral quotes.
const QUOTED: usize = crate::figures::QUOTED_CHARS;

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
    /// What it knows of how things stand with it, kept where `situation` is set: the payments that came in, its housing.
    #[serde(default, skip_serializing_if = "Situ::is_empty")]
    situ: Situ,
    own: BTreeMap<String, Own>,
    matters: BTreeMap<String, Matter>,
    by_referral: BTreeMap<String, String>,
    /// The matters it took back and did itself, by their referral (with their agreement): a draft in one still to come
    /// is answered "done already, by us", never signed (the whole-town rung 1: three owners sent two rates notices).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    done_ourselves: BTreeMap<String, String>,
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
    /// Letters (messages) from its assistant's post to an organisation's office, not yet answered (their ids).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    notes_in: Vec<String>,
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
    /// A person's habit of getting to their post, as drawn (`habit`): every so many days, from which day, at which
    /// second of the day. The wrapper round its code holds the post (crate::post); this is for what it says of it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sits: Option<(i64, i64, i64)>,
    /// Too ill to deal with its post, as a person (stakes D2): `away`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ill: Option<Ill>,
    /// Papers others sent it, the newest [`OWN_PAPERS`]: its files, what a referral says a matter came from (C1, B2).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    papers_in: Vec<PaperIn>,
    /// The matters it handed over, as its own papers trace them: what was sent on each, what each is about, and to whom
    /// (`forward`). Kept only once a service is in use.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    traces: Vec<forward::Trace>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    untied: Vec<forward::Untied>,
    /// Questions from its assistant not answered yet (their ids): each answered in its own time (`answer_question`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    questions: Vec<String>,
    /// Papers its assistant sent in its name, the newest few (`answers`); those it has reacted to; what it has borne of
    /// such acts, by kind, in basis points of one; and the matters it has asked after (referral, when).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    in_name: Vec<answers::InName>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    reacted: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    in_name_counts: BTreeMap<String, i64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    chased: BTreeMap<String, i64>,
    /// Bodies' papers citing a paper sent in its name, filed, waiting for it to sit down to its post (id, when).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    cited: Vec<(String, i64)>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    cites_read: BTreeSet<String>,
    /// Its own forwards, the newest few (`note_forwards`): what each passed on, on what matter, by when.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    passed_on: Vec<forward::PassedOn>,
    /// Drafts of a reply to a paper it passed on, come before it handed the reply over: held (draft, paper), `take_held`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    early: Vec<(String, String)>,
}

mod answers;
mod forward;
mod question;

pub struct Delegating {
    inner: Box<dyn Actor>,
    s: State,
}

/// How things stand with it, from its own account and papers as they came (`situation`): each payment that came into its
/// account (when, from whom, how much, what for: the newest few dozen), its lease's rent, and its latest rates notice.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Situ {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    incoming: Vec<(i64, String, i64, String)>,
    /// Its rent, how often, from when, and the lease: where it is a tenant.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rent: Option<(i64, i64, i64, String)>,
    /// Its rates: how much, due when, the notice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rates: Option<(i64, i64, String)>,
    /// What it owes its landlord in rent, as the landlord's latest paper that says (a statement of the rent account, or
    /// a notice to vacate for arrears) puts it: how much, the paper's day, the landlord, the paper, and its kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owed: Option<(i64, i64, String, String, String)>,
}
impl Situ {
    fn is_empty(&self) -> bool {
        self.incoming.is_empty() && self.rent.is_none() && self.rates.is_none() && self.owed.is_none()
    }
}

/// A person too ill to deal with their post (stakes D2; `away`): since when, until when as their body shows it, and
/// whether they have said so to their assistant.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Ill {
    since: i64,
    until: i64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    told: bool,
}

/// What the principal's rule weighed a request at (`State::weigh`).
struct Weighed {
    granted: bool,
    c_now: i128,
    c_want: i128,
    slip_bps: i64,
    wait_milli_days: i64,
    waits: i64,
    per_month: i64,
    late_cost_day: i64,
    hurdle_bps: i64,
}

impl Weighed {
    /// Its figures as the answer types them.
    fn figures(&self) -> Weighing {
        let c = |v: i128| v.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64;
        Weighing { cost_now: c(self.c_now), cost_asked: c(self.c_want), per_month: self.per_month, slip_bps: self.slip_bps, wait_milli_days: self.wait_milli_days, waits: self.waits, late_cost_day: self.late_cost_day, hurdle_bps: self.hurdle_bps }
    }
}

/// Read only (the obstacle screen): what a saved principal's rule would answer at `t` to a request for the next level up
/// of each kind it hands over (`State::would_answer`). None: the saved actor is not a principal.
pub fn would_answer(saved: &Value, t: i64) -> Option<Result<Vec<Value>, String>> {
    let d = saved.get("delegation")?;
    Some(serde_json::from_value::<State>(d.clone()).map(|s| s.would_answer(t)).map_err(|e| e.to_string()))
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
                situ: Situ::default(),
                own: BTreeMap::new(),
                matters: BTreeMap::new(),
                by_referral: BTreeMap::new(),
                done_ourselves: BTreeMap::new(),
                advice_on: BTreeMap::new(),
                synth: vec![],
                done: BTreeMap::new(),
                seen: BTreeMap::new(),
                about: vec![],
                next_review,
                asked: vec![],
                letters: vec![],
                notes_in: vec![],
                own_papers: vec![],
                acknowledged: vec![],
                changed: false,
                venues: vec![],
                lodged: BTreeSet::new(),
                passed: BTreeSet::new(),
                sits: None,
                ill: None,
                papers_in: vec![],
                traces: vec![],
                untied: vec![],
                questions: vec![],
                in_name: vec![],
                reacted: BTreeSet::new(),
                in_name_counts: BTreeMap::new(),
                chased: BTreeMap::new(),
                cited: vec![],
                cites_read: BTreeSet::new(),
                passed_on: vec![],
                early: vec![],
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
        s.away(pic, cx);
        // What the inner actor is shown: its own outcomes, never ours, and those of its acts the assistant has done.
        let hide = |o: &Outcome| s.own.contains_key(o.action.as_str()) || s.matters.get(o.action.as_str()).is_some_and(|m| m.referral.is_none() && o.status == OutcomeStatus::Applied);
        // (An organisation's assistant's letters are its delegation's to answer (`notes_in`), never the office's own code's:
        // that answers the public with its standing report.)
        let from = Assistant::of(s);
        let letters = s.p.post.is_some() && pic.inbox.iter().any(|m| from.sent(m));
        let filter = !s.synth.is_empty() || pic.outcomes.iter().any(hide) || letters;
        let mut shown;
        let ipic = if filter {
            shown = pic.clone();
            shown.outcomes = pic.outcomes.iter().filter(|o| !hide(o)).cloned().chain(std::mem::take(&mut s.synth)).collect();
            if letters {
                shown.inbox.retain(|m| !from.sent(m));
            }
            &shown
        } else {
            pic
        };
        s.took_outcomes(pic);
        // (Drafts of replies it held, taken under their matters once handed over: `take_held`.)
        s.take_held(pic.t, cx);
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
                let routed = s.route(&program, pic);
                // (A want handed over is never an act of the world's: one its remit no longer hands over, a remit come
                // since its code chose the way, is dropped, and its code hears it done; the want stays its own.)
                if routed.is_none() && has_wants(&program) {
                    return Action::Call { program: without_wants(program), reasoning };
                }
                if let Some((agreement, level, handed, own, facts, follows)) = routed {
                    let text = program_text(&handed);
                    // (The matter is of the kind of the papers it carries, not of a payment that goes with them.)
                    let ks = kinds_of(&handed);
                    let kind = ks.iter().find(|k| k.as_str() != "money").or(ks.first()).cloned().unwrap_or_default();
                    if level == Level::Advice {
                        // (It does it itself, and asks what the assistant would have done.)
                        let g = s.grounds(&kind, Level::Advice, &text, &subjects_of(&handed), None, facts.as_ref(), None, Some(pic), pic.t, cx);
                        s.ask_advice(&agreement, &kind, &text, &g, cx);
                        return Action::Call { program, reasoning };
                    }
                    // (What it does not hand over it does itself, in the same act as the referral.)
                    let depth = if is_want(&kind) { Depth::Want } else if facts.is_some() { Depth::Matter } else { Depth::Act };
                    // (A want: its own fields, and the facts its holder chose to give.)
                    let want = facts.as_ref().filter(|_| depth == Depth::Want).and_then(|f| serde_json::from_value::<WantHanded>(f["want"].clone()).ok());
                    let facts = if depth == Depth::Want { facts.map(|f| f["facts"].clone()) } else { facts };
                    let mut m = Matter { kind, level, agreement: agreement.clone(), program: text.clone(), at: pic.t, referral: None, subjects: subjects_of(&handed), own: BTreeMap::new(), facts, depth, want, due: None, follows, answered: false, taken: false, ours: BTreeSet::new() };
                    let g = s.grounds(&m.kind, m.level, &m.program, &m.subjects, m.want.as_ref(), m.facts.as_ref(), m.follows.as_ref().map(|f| f.0.as_str()), Some(pic), pic.t, cx);
                    m.due = g.due.as_ref().map(|d| d.0);
                    // (What it would have done, on record for whoever reads the log: what the matter needed. Never shown to
                    // anyone in the world.)
                    cx.decided(json!({ "domain": "delegation", "choice": "handed", "agreement": agreement, "kind": m.kind, "level": level, "depth": depth, "program": text, "does_itself": kinds_of(&own), "inputs": [] }));
                    let step = s.referral(&m, &kinds_of(&own), &g, cx);
                    let mut lines = match own {
                        Program::Lines(l) => l,
                        Program::None(_) => vec![],
                    };
                    lines.extend(step.lines.iter().cloned());
                    s.returned_matter = Some(m);
                    return Action::Call { program: s.said_away(Program::Lines(lines), pic.t, cx), reasoning: step.why };
                }
                Action::Call { program, reasoning }
            }
            Action::Wait { until } => {
                s.plan(pic, cx);
                match s.queue.first().cloned() {
                    Some(o) => {
                        s.queue.remove(0);
                        let program = s.said_away(parse_program(&o.program).unwrap_or(Program::None(String::new())), pic.t, cx);
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
                // (The laws it has: what it tells whoever helps it of an office's rule is the rule as published, as it
                // has it. Until 2026-11-17 its book held none, so a client in a town whose office pays from the first
                // claim told its desk "The office pays nothing for the days before it decides": the stakes run's rung 3,
                // every first_claim cell with the client's situation on.)
                || kind.as_str() == "law"
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
    /// Whether a letter is from its assistant: written in its assistant's post, or by a provider whose service it engaged.
    fn sent(&self, m: &oikos_sight::Message) -> bool {
        match &self.post {
            Some(post) => m.from_position.as_deref() == Some(post.as_str()),
            None => m.from_entity.as_deref().is_some_and(|s| s != self.me && self.providers.iter().any(|p| p == s)),
        }
    }
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
        // (Where it says how things stand (`situation`): what came into its account, its lease and its rates notices, as
        // they reach it.)
        if self.p.situation {
            let own = if self.p.account.is_empty() { format!("acc-{}", self.me) } else { self.p.account.clone() };
            for x in pic.transactions().filter(|x| x.to.as_str() == own && x.from.as_str() != own) {
                self.situ.incoming.push((x.t, x.from.to_string(), i64::try_from(x.amount).unwrap_or(i64::MAX), x.memo.clone().unwrap_or_default()));
            }
            let keep = self.situ.incoming.len().saturating_sub(crate::figures::KEPT_INCOMING);
            self.situ.incoming.drain(..keep);
            for r in pic.all_records() {
                if let RecordBody::Agreement { .. } = &r.body {
                    let l = crate::papers::agreements::lease_terms(r, &self.me);
                    if let (true, true, Some(e)) = (l.rent > 0, l.space.is_some(), l.every.filter(|e| *e > 0)) {
                        self.situ.rent = Some((l.rent, e, r.at.max(0), r.id.to_string()));
                    }
                }
                // (What it owes in rent, as its landlord's latest paper to it says: a statement of the rent account, a
                // notice to vacate for arrears, or its written request for the rent owed. Their figure, never one reckoned
                // here.)
                let to_me = crate::common::addressed_to(r).iter().any(|a| a.as_str() == self.me) || matches!(&r.visible_to, oikos_contracts::blocks::Visibility::Only(v) if v.iter().any(|a| a.as_str() == self.me));
                if to_me && r.speaks_for.as_deref() != Some(self.me.as_str()) {
                    let owed = if crate::common::is_kind(r, "rent_statement") {
                        papers::read::<crate::papers::firms::RentStatement>(r).and_then(|x| x.owed)
                    } else if crate::common::is_kind(r, "notice_to_vacate") {
                        crate::common::Fields::i(crate::common::data(r), "arrears")
                    } else if crate::common::is_kind(r, "review_request") && crate::common::Fields::s(crate::common::data(r), "matter") == Some("arrears") {
                        crate::common::Fields::i(crate::common::data(r), "amount")
                    } else {
                        None
                    };
                    if let Some(n) = owed {
                        if self.situ.owed.as_ref().is_none_or(|o| o.1 <= r.at) {
                            let by = r.speaks_for.as_deref().unwrap_or(r.author.as_str()).to_string();
                            self.situ.owed = Some((n, r.at, by, r.id.to_string(), crate::common::kind(r).unwrap_or_default().to_string()));
                        }
                    }
                }
                if crate::common::is_kind(r, "rates_notice") && crate::common::addressed_to(r).iter().any(|a| a.as_str() == self.me) {
                    if let Some(n) = papers::read::<crate::papers::offices::RatesNotice>(r) {
                        self.situ.rates = Some((n.amount, n.due, r.id.to_string()));
                    }
                }
            }
        }
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
        // (Papers its assistant sent in its name, once it has engaged a service: what a body's paper may cite, `answers`.)
        if self.eng.live().next().is_some() {
            self.note_in_name(pic);
        }
        // (Papers others sent it, once it has engaged a service: its files, what a matter it hands over came from.)
        if self.eng.live().next().is_some() {
            for r in pic.all_records() {
                let RecordBody::Statement { kind, .. } = &r.body else { continue };
                let from = r.speaks_for.as_deref().unwrap_or(r.author.as_str());
                if from == self.me || PAPERS.contains(&kind.as_str()) || !addressed_to(r).iter().any(|a| *a == self.me) || self.papers_in.iter().any(|p| p.id == r.id.as_str()) {
                    continue;
                }
                self.papers_in.extend(paper_in(r));
                if self.papers_in.len() > OWN_PAPERS {
                    self.papers_in.remove(0);
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
        // (What came by post is shown it when it sits down to it, as every person's post is: crate::post. Stakes D1a,
        // folded into D1b. Its habit, drawn once, for what it says of its sittings: `habit`.)
        self.habit(cx);
        // (A body's paper citing a paper sent in its name: filed, and read now, `answers`; a person is shown it at a sitting.)
        self.cited_seen(pic, None, cx);
        self.trace(pic);
        self.note_forwards(pic);
        for r in fresh {
            self.take(&r, pic.t, cx);
        }
        // (A body's paper about a matter it handed over: passed on to its assistant, `forward`, when it is shown it, which
        // for a person is when they sit down to their post: crate::post.)
        self.pass_on_seen(pic);
        // (A letter from its assistant about a matter a body sent back, or about the return itself: it does what the body's
        // own notice asks of it, as it does on a report that names the need. The letter is what makes it act; what is
        // needed is read from the body's notice, never from the letter's words. docs/behaviour/assistants.md.)
        // (A letter with no reference is about its one unmet need with that assistant, if it has exactly one: `on_letter`.)
        let letters: Vec<(String, String, String)> = pic.inbox.iter().filter(|m| from.sent(m)).filter_map(|m| Some((m.id.to_string(), m.re.as_ref().map(|x| x.to_string()).unwrap_or_default(), m.from_position.as_ref()?.to_string()))).collect();
        for (id, re, post) in letters {
            let met = self.on_letter(&re, &post);
            // (An organisation's office answers its assistant's letter itself, in its own time, with how to ask it what
            // it can answer: never with the office's standing report to the public, which says nothing of that. The
            // whole-town rung 1 run b: the rates seat asked its office three questions by letter, was sent the rates
            // report, and held twelve matters to the end.)
            if !met && self.p.post.is_some() && !self.acknowledged.contains(&id) && !self.notes_in.contains(&id) {
                self.notes_in.push(id);
            }
        }
    }

    /// A person's habit of getting to their post, drawn once from the world's seeded draws, the same draw as the wrapper
    /// that holds their post (`crate::post::draw`, from their own `paperwork`): what it says of its sittings on a
    /// hand-over. An organisation's principal, or a person with no habit given: none.
    fn habit(&mut self, cx: &mut Cx) {
        if self.sits.is_some() || self.p.post.is_some() {
            return;
        }
        let Some(pw) = cx.ctx.params.get("paperwork").and_then(|v| serde_json::from_value::<crate::post::Paperwork>(v.to_value()).ok()) else { return };
        self.sits = Some(crate::post::draw(&pw, &self.me, cx));
    }

    /// A person too ill to deal with their post (stakes D2): a condition of a severity that keeps them off work (the
    /// citizen's `care.off_work`, the health model's own draws), as their body shows it. Their post waits until it ends
    /// (crate::post); here, only whether they have it, and since when, for what they say of it to their assistant.
    /// An organisation's principal has no body: never.
    fn away(&mut self, pic: &Picture, cx: &Cx) {
        if self.p.post.is_some() {
            return;
        }
        let off: Vec<String> = cx.ctx.params.get("care").and_then(|c| c.to_value().get("off_work").and_then(|o| serde_json::from_value(o.clone()).ok())).unwrap_or_default();
        let t = pic.t;
        let now: Vec<(i64, i64)> = pic.body.as_ref().map(|b| b.conditions.iter().filter(|c| off.contains(&c.severity) && c.since <= t && t < c.until).map(|c| (c.since, c.until)).collect()).unwrap_or_default();
        match (now.is_empty(), self.ill.as_mut()) {
            (false, Some(i)) if t < i.until || !i.told => {
                i.since = i.since.min(now.iter().map(|x| x.0).min().unwrap_or(i.since));
                i.until = i.until.max(now.iter().map(|x| x.1).max().unwrap_or(i.until));
            }
            (false, _) => self.ill = Some(Ill { since: now.iter().map(|x| x.0).min().unwrap_or(t), until: now.iter().map(|x| x.1).max().unwrap_or(t), told: false }),
            // (Over it and said so: let go, so that a later illness is said again.)
            (true, Some(i)) if i.told && t >= i.until => self.ill = None,
            _ => {}
        }
    }

    /// Its own line about it, on the first paper it next writes to its assistant: its own fact, in fixed words, and
    /// nothing else. The assistant is told nothing before that, as in life.
    fn said_away(&mut self, program: Program, t: i64, cx: &Cx) -> Program {
        let Some(i) = self.ill.as_ref().filter(|i| !i.told) else { return program };
        let Program::Lines(mut lines) = program else { return program };
        let assistant: Vec<String> = self.in_use().and_then(|e| e.agreement.clone()).map(|a| self.to_assistant(&a).0).unwrap_or_default();
        let to_it = |l: &Line| l.call.fn_ == "statement" && l.call.get("to").is_some_and(|v| match v {
            oikos_sight::calls::Value::Json(j) => j.as_array().is_some_and(|a| a.iter().any(|x| x.as_str().is_some_and(|x| assistant.iter().any(|y| y == x)))),
            oikos_sight::calls::Value::Id(x) | oikos_sight::calls::Value::Text(x) => assistant.iter().any(|y| y == x),
            _ => false,
        });
        let Some(l) = lines.iter_mut().find(|l| to_it(l)) else { return Program::Lines(lines) };
        let date = |at: i64| crate::common::when_words(at, &cx.ctx.world);
        let said = if t < i.until { format!("We have been ill since {}.", date(i.since)) } else { format!("We were ill from {} until {}.", date(i.since), date(i.until)) };
        if let Some((_, oikos_sight::calls::Value::Text(words))) = l.call.args.iter_mut().find(|(k, _)| k == "text") {
            words.push(' ');
            words.push_str(&said);
        } else {
            return Program::Lines(lines);
        }
        if let Some(i) = self.ill.as_mut() {
            i.told = true;
        }
        Program::Lines(lines)
    }

    /// What a body asked of it, met (docs/design/obstacles.md, `clears_by`), where its assistant has put the matter before
    /// it (a report naming the need, or a letter about the matter): one law over every need that is its own to meet. An
    /// authority with that body for its assistant's post is its to give, for kinds it keeps with the assistant. A
    /// correction is the sender's (the paper goes again with the item); a record to find (O3) would be its own, and no
    /// law asks for one yet. `referral`: the matter, where the paper names it (a report); else the kinds' remits decide.
    fn meet(&mut self, need: &Need, post: &str, referral: Option<&str>, basis: &str) {
        let Some(a) = need.authority.as_ref().filter(|a| a.for_ == self.me) else { return };
        let kinds = match referral {
            Some(rf) => {
                let Some(q) = self.book.get(rf).and_then(|q| papers::read::<Referral>(q)).filter(|q| hands_over(self.remit(&q.agreement, &self.governing_kind(q)))) else { return };
                if a.kinds.is_empty() { vec![q.kind.clone()] } else { a.kinds.clone() }
            }
            None => {
                let Some(agreement) = self.in_use().and_then(|e| e.agreement.clone()) else { return };
                if a.kinds.is_empty() || !a.kinds.iter().any(|k| hands_over(self.remit(&agreement, k))) {
                    return;
                }
                a.kinds.clone()
            }
        };
        self.lodge(&a.with, post, &kinds, basis);
    }

    /// A letter from its assistant whose `re` is a matter of its, a return it holds, or the paper returned: each return it
    /// holds on that matter, with what it asks of it still to meet, is met. A return on a matter: one citing the paper
    /// named, or, for a matter named, one that came after the matter was handed over.
    /// The service a request for more is under, as the client knows it: the agreement it names, where that is a service of
    /// its own; else that of the matter it names (its `matter`, `only`, or a referral of its own put where the agreement
    /// goes: the stakes run's rung 1 "c", 2026-11-15, where four requests named the matter there and went unanswered).
    fn service_of_request(&self, x: &ScopeRequest) -> Option<String> {
        if self.eng.by_agreement(&x.agreement).is_some() {
            return Some(x.agreement.clone());
        }
        [x.matter.as_deref(), x.only.as_deref(), Some(x.agreement.as_str())]
            .into_iter()
            .flatten()
            .filter_map(|m| self.book.get(m))
            .filter(|q| q.speaks_for.as_deref() == Some(self.me.as_str()))
            .filter_map(|q| papers::read::<Referral>(q))
            .map(|q| q.agreement)
            .find(|a| self.eng.by_agreement(a).is_some())
    }

    /// An authority its assistant asks for at a body, on its request form: given from the body's own notice on its file
    /// (a return asking its authority for this post), for a matter of its own with this assistant (open or not) or a kind
    /// it hands over; `meet` decides and lodges, as for a report or a letter. The kinds given, where one was; none where no
    /// notice from that body asks it.
    fn authority_on_notice(&mut self, with: &str, matter: Option<&str>, kind: Option<&str>, post: &str) -> Option<Vec<String>> {
        let at = matter.and_then(|m| self.book.get(m)).filter(|q| papers::read::<Referral>(q).is_some() && q.speaks_for.as_deref() == Some(self.me.as_str())).map(|q| q.at);
        let notices: Vec<(String, Need)> = self
            .book
            .all(crate::common::intake::RETURNED)
            .filter(|r| r.author.as_str() != self.me.as_str() && !self.passed_copy(r) && r.speaks_for.as_deref().unwrap_or(r.author.as_str()) == with)
            .filter_map(|r| serde_json::from_value::<Need>(crate::common::data(r).to_value()["need"].clone()).ok().map(|n| (r.id.to_string(), n, r.at)))
            .filter(|(_, n, rat)| n.authority.as_ref().is_some_and(|a| a.for_ == self.me && a.with == with && (at.is_some_and(|m| *rat >= m) || kind.is_some_and(|k| a.kinds.iter().any(|x| x == k)))))
            .map(|(id, n, _)| (id, n))
            .collect();
        let (id, need) = notices.last()?.clone();
        let key = format!("{with}|{post}");
        let before = self.lodged.contains(&key);
        self.meet(&need, post, at.and(matter), &id);
        (before || self.lodged.contains(&key)).then(|| need.authority.map(|a| a.kinds).unwrap_or_default())
    }

    /// Whether, on a matter named, it holds a return asking of it what is its own to meet: what a report of it not done
    /// puts before it (`take`).
    fn on_letter(&mut self, re: &str, post: &str) -> bool {
        // (No reference: a person with one open problem with its assistant knows what the letter is about. Where it holds
        // exactly one return from a body on a paper that assistant sent, asking of it what is still its own to meet, the
        // letter is about that; with two or more, it cannot tell, and nothing follows (MT-36).)
        if re.is_empty() {
            let unmet: Vec<(String, Value)> = self
                .book
                .all(crate::common::intake::RETURNED)
                .filter(|r| r.author.as_str() != self.me.as_str() && !self.passed_copy(r))
                .map(|r| (r.id.to_string(), crate::common::data(r).to_value()))
                .filter(|(_, d)| d["from"].as_str() == Some(post))
                .filter(|(_, d)| serde_json::from_value::<Need>(d["need"].clone()).ok().and_then(|n| n.authority).is_some_and(|a| a.for_ == self.me && !self.lodged.contains(&format!("{}|{post}", a.with))))
                .collect();
            if let [(id, d)] = unmet.as_slice() {
                if let Ok(n) = serde_json::from_value::<Need>(d["need"].clone()) {
                    self.meet(&n, post, None, &id.clone());
                }
            }
            return false;
        }
        let matter_at = self.book.get(re).filter(|q| papers::read::<Referral>(q).is_some() && q.speaks_for.as_deref() == Some(self.me.as_str())).map(|q| q.at);
        let returns: Vec<(String, Value)> = self
            .book
            .all(crate::common::intake::RETURNED)
            .filter(|r| r.author.as_str() != self.me.as_str() && !self.passed_copy(r))
            .filter(|r| {
                let d = crate::common::data(r).to_value();
                r.id.as_str() == re || d["returned"].as_str() == Some(re) || matter_at.is_some_and(|at| r.at >= at)
            })
            .map(|r| (r.id.to_string(), crate::common::data(r).to_value()["need"].clone()))
            .collect();
        let mut mine = false;
        for (id, need) in returns {
            if let Ok(n) = serde_json::from_value::<Need>(need) {
                mine |= n.authority.as_ref().is_some_and(|a| a.for_ == self.me);
                self.meet(&n, post, matter_at.map(|_| re), &id);
            }
        }
        mine
    }

    /// Whether its assistant has sent it a paper on a matter after a report on it: a draft, a request to go ahead, a
    /// question or advice naming the matter, later than the report (or as late, filed after it).
    fn said_since(&self, referral: &str, report: &Record) -> bool {
        [Draft::KIND, ApprovalRequest::KIND, Question::KIND, Advice::KIND].iter().any(|k| {
            self.book.all(k).any(|p| {
                p.id != report.id && crate::common::Fields::s(crate::common::data(p), "referral") == Some(referral) && self.letter(p) && (p.at > report.at || (p.at == report.at && crate::common::filed_before(&report.id, &p.id) == std::cmp::Ordering::Less))
            })
        })
    }

    /// Whether a return on file is its own copy passed on to its desk (`pass_on`), not the body's.
    fn passed_copy(&self, r: &Record) -> bool {
        r.speaks_for.as_deref() == Some(self.me.as_str())
    }

    /// A record newly on file: what the assistant sent back, a complaint, the end of a service.
    fn take(&mut self, r: &Arc<Record>, t: i64, cx: &mut Cx) {
        // (A body's paper about a matter it handed over, from its post: passed on, `forward`.)
        self.forward(r);
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
            if x.done {
                self.tie(&x.referral, x.created.values().cloned());
            }
            // (A body would not act on a paper its assistant sent for it without its authority: it gives the body one for
            // the post, where it keeps that kind with the assistant. Docs/design/obstacles.md, O1.)
            if let (Some(n), Some(post), false) = (x.needs.clone(), r.position.as_deref(), x.done) {
                self.meet(&n, post, Some(&x.referral), &r.id);
            }
            // (A report of it not done, from its assistant's post, on a matter whose paper a body sent back asking of it
            // what is its own to meet, is its assistant putting the matter before it, typed `needs` or not, as a letter
            // about the matter is: it meets the return's need, read from the return. Nor is the matter closed against
            // that need: it stays with the assistant, to send again once the need is met, and what it sends then is that
            // matter's. The stakes run's rung 2, 2026-11-15: a desk's plain not-done report on a loan sent back for want
            // of the client's authority, after a report it was done, never led the client to lodge one.)
            let before_it = match (r.position.as_deref(), x.done) {
                (Some(post), false) if self.p.post.as_deref().is_none_or(|p| p == post) => {
                    let post = post.to_string();
                    self.on_letter(&x.referral, &post)
                }
                _ => false,
            };
            let Some(action) = self.by_referral.get(&x.referral).cloned() else { return };
            if before_it {
                return;
            }
            let Some(m) = self.matters.get(&action).cloned() else { return };
            // (Not done, and nothing in it gives the matter back: no need is named, no reason is given, or its assistant has
            // sent a paper on the matter since (a draft, a request to go ahead, a question, advice), which is its latest word
            // on it. The matter stays with its assistant, as one that names a need does (`on_letter` above), and what follows
            // on it is read like any other. The stakes run's rung 1 on gpt-6-luna, 2026-11-16: "No draft has been prepared
            // yet" filed seconds before the draft; the client took the matter back and never read the draft.)
            if !x.done && x.needs.is_none() && (x.why.as_deref().is_none_or(|w| w.trim().is_empty()) || self.said_since(&x.referral, r)) {
                return;
            }
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
            self.take_draft(r, x, t, cx);
        } else if let Some(x) = papers::read::<ApprovalRequest>(r) {
            // (A request that names no matter open with it is answered so, never dropped in silence: `not_ours`.)
            let Some((action, m)) = self.by_referral.get(&x.referral).cloned().and_then(|a| self.matters.get(&a).cloned().map(|m| (a, m))) else {
                self.not_ours(r, "request", &x.referral);
                return;
            };
            self.waited(&m, t - m.at);
            if let Some(mm) = self.matters.get_mut(&action) {
                mm.answered = true;
            }
            let d = GoAhead { request: r.id.to_string(), referral: x.referral.clone() };
            let agreement = m.agreement.clone();
            self.paper(GoAhead::KIND, &format!("Go ahead with {}.", x.referral), &agreement, &r.id, papers::data(&d), Then::Plain);
        } else if let Some(x) = papers::read::<Advice>(r) {
            // (Advice on a matter it handed over to be drafted or done, in place of that: left open now, `answers`.)
            if !self.advice_on.contains_key(&x.referral) {
                self.in_place(&x.referral, Advice::KIND, &crate::common::data(r).to_value(), t, cx);
            }
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
        } else if papers::is::<Question>(r) && self.letter(r) {
            // (A question from its assistant about a matter: answered in its own time, `answer_question`.)
            let id = r.id.to_string();
            if !self.questions.contains(&id) {
                self.questions.push(id);
            }
        } else if let Some(x) = papers::read::<ScopeRequest>(r) {
            if self.service_of_request(&x).is_some() {
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
                        let level = self.remit(next, m.follows.as_ref().map_or(m.kind.as_str(), |f| f.1.as_str()));
                        if level == Level::None || level == Level::Advice {
                            self.myself(&action, &m, "Handed back with the service's end: doing it ourselves.");
                            continue;
                        }
                        let n = Matter { agreement: next.clone(), level, referral: None, answered: false, ..m.clone() };
                        // (Taken up again: told from its files, as on the day it was handed over.)
                        let g = self.grounds(&n.kind, n.level, &n.program, &n.subjects, n.want.as_ref(), n.facts.as_ref(), n.follows.as_ref().map(|f| f.0.as_str()), None, t, cx);
                        let step = self.referral(&n, &[], &g, cx);
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

    /// A draft from its assistant, read (`take`). A draft for its reply to a body's paper it passed on, made before it
    /// handed that reply over or under the matter the paper came on, is taken under the reply's matter (one reply, one
    /// matter: `reply_for`), or held until it hands the reply over; a draft that names no matter open with it is answered
    /// so (`not_ours`). Until 2026-11-16 both were dropped without a word: the stakes run's rung 1 (situation), where a
    /// desk drafted a client's evidence from the forward before the client's own hand-over of it, and it was never signed.
    fn take_draft(&mut self, r: &Arc<Record>, mut x: Draft, t: i64, cx: &mut Cx) {
        match self.reply_for(r, &x, t) {
            Some(Ok(rf)) => x.referral = rf,
            Some(Err(paper)) => {
                self.hold_early(r, &paper);
                return;
            }
            None => {}
        }
        let Some((action, m)) = self.by_referral.get(&x.referral).cloned().and_then(|a| self.matters.get(&a).cloned().map(|m| (a, m))) else {
            // (A matter it took back and did itself: the draft is answered so, once, and nothing is signed.)
            if let Some(agreement) = self.done_ourselves.get(&x.referral).cloned() {
                self.done_already(r, &x, &agreement);
                return;
            }
            self.not_ours(r, Draft::KIND, &x.referral);
            return;
        };
        // (Still in hand, but taken back whole, or this paper of it sent by us already: done already, never signed twice.
        // The whole-town rung 1: a rates office declined one draft of fifteen, sent all fifteen itself, and went on
        // signing the other drafts of the matter, so three owners were sent two notices.)
        if m.taken || draft_to(&x).is_some_and(|to| m.ours.contains(&to)) {
            self.done_already(r, &x, &m.agreement);
            return;
        }
        // (A draft on a form, a model's, is read by what it would send: the paper's kind and to whom, against what was asked.)
        // (Handed over as what happened, the paper is the assistant's: it is read on the kind's material details and
        // whom it goes to, against what its own code would have sent, never its words.)
        if m.depth == Depth::Want {
            // (A want's draft waited on it too: from the hand-over to its own reading.)
            self.waited(&m, t - m.at);
            if let Some(mm) = self.matters.get_mut(&action) {
                mm.answered = true;
            }
            self.read_for_want(r, &action, &m, &x, t, cx);
            return;
        }
        // (The wait on the permission path: from the hand-over to its own answer, its own records.)
        self.waited(&m, t - m.at);
        if let Some(mm) = self.matters.get_mut(&action) {
            mm.answered = true;
        }
        let differs = if m.facts.is_some() { matter_differs(&m, &x, &self.me, r.at) } else { vec![] };
        let wrong = if m.facts.is_some() {
            !differs.is_empty()
        } else {
            match (&x.calls, &x.paper) {
                (None, Some(p)) => !paper_as_asked(p, &m.program),
                _ => x.calls.as_deref().map(norm) != Some(norm(&m.program)),
            }
        };
        // (Reading it whole: a slip in it is found unless the review itself slips, the world's row for a sign-off. A draft
        // with no paper in it at all is no slip of detail that a reader can miss: a blank page is always seen. The
        // whole-town rung 1 run b: the factory's code assistant's slipped draft rec.21636 held nothing, the review's draw
        // slipped too, and the empty draft was signed; the seat that took the post at the fork asked three times for a
        // paper that was never there.)
        let blank = x.paper.is_none() && x.calls.as_deref().is_none_or(|c| papers_in(c).is_empty());
        let missed = wrong && !blank && slip(cx, "publish/sign_off", &r.id, &SlipOptions::default());
        if wrong && !missed {
            self.seen.entry(Self::key(&m.agreement, &m.kind)).or_default().saw(true, &r.id);
            let found = if differs.is_empty() { "The draft is not what was asked for.".to_string() } else { format!("The draft is not as we have it: {}.", differs.join("; ")) };
            let d = Declined { of: r.id.to_string(), referral: x.referral.clone(), found: Some(found.clone()) };
            // (A matter of several papers, one to each addressee (a rates instalment's fifteen notices): an office
            // sends the one paper it found wrong itself and goes on signing the others as they come right, as a clerk's
            // supervisor corrects one letter of a batch and not the batch. One paper, or one it cannot find among the
            // matter's: the whole matter is taken back. Before 2026-11-16 one wrong draft of fifteen took all fifteen back.)
            match draft_to(&x).and_then(|to| lines_to(&m.program, &to).map(|p| (to, p))) {
                Some((to, program)) => {
                    self.paper(Declined::KIND, &format!("Draft {} declined. {found} We will send that one ourselves; draft the others as before.", r.id), &m.agreement, &r.id, papers::data(&d), Then::Plain);
                    self.queue.push(Own { program, why: "We declined the draft of one paper of a matter: sending that one ourselves.".into(), then: Then::Plain });
                    if let Some(mm) = self.matters.get_mut(&action) {
                        mm.ours.insert(to);
                    }
                }
                None => {
                    self.paper(Declined::KIND, &format!("Draft {} declined. {found} We will do it ourselves.", r.id), &m.agreement, &r.id, papers::data(&d), Then::Plain);
                    if let Some(mm) = self.matters.get_mut(&action) {
                        mm.taken = true;
                    }
                    self.myself(&action, &m, "We declined the draft: doing it ourselves.");
                }
            }
            self.next_review = self.next_review.min(t);
        } else {
            // (A draft written on a form carries the paper: the sign-off is its signed copy, which the assistant sends
            // as it stands on its form for that, `send_signed`. Before 2026-11-10 a seat had to write the paper out
            // again on the direct form, and read that as beyond a draft-level remit: the scope pilot's one clean
            // request, and round 5's factory seat.)
            // (A draft written as calls of one paper (the code assistant's) is signed with that paper too: whoever holds
            // the post when the sign-off comes can send it as it stands, a model seat after a fork among them. Before
            // 2026-11-16 such a sign-off carried nothing to send, and the seat that took the post over at the fork had to
            // draft the matter again: the whole-town rung 1's delivery note, about seven days lost.)
            // (Its words are the paper's own, not the covering note's.)
            let words = if x.paper.is_some() { crate::common::text(r) } else { "" };
            let carried = x.paper.clone().or_else(|| x.calls.as_deref().and_then(one_paper));
            let paper = carried.as_ref().map(|p| with_instructions(signed_copy(p, words), &m.program));
            // (A draft written as calls of several papers (a rates instalment's fifteen notices, drafted as one) is
            // signed with every paper in it, each as it stands, the matter's payments with the first: a supervisor signs
            // each letter of the batch. Whoever holds the post when the sign-off comes sends them all on it. Before
            // 2026-11-17 such a sign-off carried none.)
            let several: Vec<Value> = if paper.is_none() {
                x.calls.as_deref().map(papers_in).unwrap_or_default().into_iter().enumerate().map(|(n, p)| {
                    let copy = signed_copy(&p, "");
                    if n == 0 { with_instructions(copy, &m.program) } else { copy }
                }).collect()
            } else {
                vec![]
            };
            let words = if several.is_empty() { signed_words(&r.id, paper.as_ref()) } else { format!("Draft {} read and signed off, its {} papers each as it stands: send them as they stand. This is the signed copy.", r.id, several.len()) };
            let d = SignOff { draft: r.id.to_string(), referral: x.referral.clone(), paper, papers: several };
            self.paper(SignOff::KIND, &words, &m.agreement, &r.id, papers::data(&d), Then::Plain);
        }
    }

    /// A draft in a matter it took back, or of a paper of one it sent itself: answered once, "done already, by us", and
    /// not signed (its assistant is told the matter, or that paper, is back with it).
    fn done_already(&mut self, r: &Arc<Record>, x: &Draft, agreement: &str) {
        let d = Declined { of: r.id.to_string(), referral: x.referral.clone(), found: Some("Done already, by us.".into()) };
        self.paper(Declined::KIND, &format!("Draft {} not needed: we have done this ourselves already. Send nothing for it.", r.id), agreement, &r.id, papers::data(&d), Then::Plain);
    }

    /// A matter of a kind whose delay it costs waited `secs` on its answer (docs/design/obstacles.md section 10).
    fn waited(&mut self, m: &Matter, secs: i64) {
        if self.costed(m) {
            self.seen.entry(Self::key(&m.agreement, &m.kind)).or_default().waited_for(secs);
        }
    }

    /// Whether a matter's day of delay costs it: its kind has a figure, and, where the figure is for one matter of the
    /// kind (`late_matters`), the matter's paper names that matter.
    fn costed(&self, m: &Matter) -> bool {
        if !self.p.kinds.get(&m.kind).is_some_and(|f| f.late_cost_day > 0) {
            return false;
        }
        let Some(want) = self.p.late_matters.get(&m.kind) else { return true };
        let named = |d: &Value| d.get("matter").and_then(Value::as_str) == Some(want.as_str());
        if m.facts.as_ref().is_some_and(named) {
            return true;
        }
        match parse_program(&m.program) {
            Ok(Program::Lines(ls)) => ls.iter().any(|l| matches!(l.call.get("data"), Some(oikos_sight::calls::Value::Json(d)) if named(d))),
            _ => false,
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
                    let gone = self.matters.remove(&action);
                    if let Some(m) = gone.as_ref().filter(|_| o.status == OutcomeStatus::Applied) {
                        if let Some(rf) = &m.referral {
                            self.done_ourselves.insert(rf.clone(), m.agreement.clone());
                        }
                    }
                    let own = gone.map(|m| m.own).unwrap_or_default();
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
    fn route(&self, program: &Program, pic: &Picture) -> Option<(String, Level, Program, Program, Option<Value>, Option<(String, String, String)>)> {
        let t = pic.t;
        let Program::Lines(lines) = program else { return None };
        let e = self.in_use()?;
        let a = e.agreement.clone()?;
        // (Only a kind of its own: the kinds its parameters price, which are the ones its assistant's post has forms for.)
        let own_kind = |l: &Line| {
            super::kind_of(l).is_some_and(|k| {
                let level = self.remit(&a, &k);
                e.offer.kinds.contains(&k) && self.p.kinds.contains_key(&k) && if is_want(&k) { hands_over(level) } else { level != Level::None }
            })
        };
        // (Or a reply its code wrote on a matter it handed over: under that matter's kind and remit, whatever the reply's
        // kind. A matter handed over stays handed over.)
        let reply = |l: &Line| if own_kind(l) { None } else { self.reply_on(l, pic).filter(|(_, k, _)| self.remit(&a, k) != Level::None) };
        let handed = |l: &Line| own_kind(l) || reply(l).is_some();
        let (mut mine, mut others): (Vec<Line>, Vec<Line>) = lines.iter().cloned().partition(|l| handed(l));
        if mine.is_empty() {
            return None;
        }
        // (The act's paperwork goes as one matter, its body's part stays with the principal: docs/design/broad-seats.md,
        // G1. A withdrawal goes with the paper it is part of (a new price list that withdraws the old one: no list stands
        // withdrawn while the new one waits for its sign-off), and a payment with the papers it goes with (an order paid
        // with the order, a return with the tax it reports: parted, the money reached the seller before the order, MT-28).
        // Where the act also has papers of its own the principal keeps, which of them a payment goes with cannot be told,
        // and the payment stays with the principal. Goods moved, work and entries in the principal's own registers (a
        // claim recorded) stay its own: they are not paperwork sent.)
        let keeps_papers = others.iter().any(|l| l.call.fn_ == "statement" && l.call.get("withdraw").is_none());
        let (goes, rest): (Vec<Line>, Vec<Line>) = others.into_iter().partition(|l| (l.call.fn_ == "statement" && l.call.get("withdraw").is_some()) || (l.call.fn_ == "money" && !keeps_papers));
        mine.extend(goes);
        others = rest;
        let binds = |ls: &[Line]| ls.iter().filter_map(|l| l.bind.clone()).collect::<Vec<String>>();
        let uses = |ls: &[Line], names: &[String]| ls.iter().any(|l| super::vars_of(&l.call).iter().any(|v| names.contains(v)));
        if uses(&mine, &binds(&others)) || uses(&others, &binds(&mine)) {
            return None;
        }
        let follows = mine.iter().find_map(|l| reply(l));
        let levels: Vec<Level> = mine.iter().filter_map(|l| reply(l).map(|(_, k, _)| k).or_else(|| super::kind_of(l))).map(|k| self.remit(&a, &k)).collect();
        // (The strictest: the one that keeps the principal nearest the act.)
        let order = [Level::Advice, Level::Draft, Level::Approve, Level::Alone];
        let l = *order.iter().find(|l| levels.contains(l))?;
        // (Handed over as what happened, where its remit says so and every paper of it reads back on its own form.)
        let facts = match mine.as_slice() {
            // (A want: what its holder gave, as its code wrote it.)
            [one] if super::kind_of(one).is_some_and(|k| is_want(&k)) => match one.call.get("data") {
                Some(oikos_sight::calls::Value::Json(v)) => Some(v.clone()),
                _ => Some(Value::Null),
            },
            _ if l != Level::Advice => self.facts_of(&a, &mine, t),
            _ => None,
        };
        Some((a, l, Program::Lines(mine), Program::Lines(others), facts, follows))
    }

    /// What happened, as the principal gives it with a matter (docs/design/broad-seats.md, G2): each paper of the act read
    /// back on its own form for the kind, the blanks it gives (all but those the form works out and the writer's words),
    /// and, kept beside them for whoever composes, the form and the name its own code gave the paper. None (the finished
    /// act goes) where a kind is not handed over as what happened, a line is not a paper, or a paper does not read back.
    fn facts_of(&self, agreement: &str, lines: &[Line], t: i64) -> Option<Value> {
        let mut papers = vec![];
        let mut forms = vec![];
        for line in lines {
            let k = super::kind_of(line)?;
            if line.call.fn_ != "statement" || self.depth(agreement, &k) != Depth::Matter {
                return None;
            }
            let spec = self.p.forms.get(&k)?;
            let blanks = oikos_rules::form_papers::read_back(spec, &paper_of(line), &self.me, t)?;
            papers.push(Value::Object(oikos_rules::form_papers::given(spec, &blanks)));
            forms.push(json!({ "spec": spec, "bind": line.bind }));
        }
        let mut facts = match papers.len() {
            0 => return None,
            1 => papers.remove(0),
            _ => json!({ "papers": papers }),
        };
        facts["composed_on"] = Value::Array(forms);
        Some(facts)
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
        let Some(mut x) = papers::read::<ScopeRequest>(&r) else { return };
        // (The service it is under, as the client knows it: the agreement named, or the one of the matter it names.)
        if let Some(a) = self.service_of_request(&x) {
            x.agreement = a;
        }
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
        // (Of any matter of its own with this assistant, open or not: its referral on file says the kind.)
        let kind = x.kind.clone().or_else(|| x.matter.as_ref().and_then(|m| self.by_referral.get(m)).and_then(|a| self.matters.get(a)).map(|m| m.kind.clone())).or_else(|| {
            x.matter.as_ref().and_then(|m| self.book.get(m)).filter(|q| q.speaks_for.as_deref() == Some(self.me.as_str())).and_then(|q| papers::read::<Referral>(q)).map(|q| q.kind)
        });
        // (A kind it hands over only as a reply on a matter of another kind (the papers an office asks for a claim, handed
        // over under the claim's remit): asked for that matter, the remit that governs it is the matter's own kind's. Until
        // 2026-11-17 such a request was answered "evidences are not papers of ours", though the client had just handed the
        // evidence over: the stakes run's rung 3, first_claim-slow seed 7, c0479 on day 33.)
        let kind = match kind {
            Some(k) if !self.p.kinds.contains_key(&k) => x
                .matter
                .as_ref()
                .and_then(|m| self.book.get(m))
                .filter(|q| q.speaks_for.as_deref() == Some(self.me.as_str()))
                .and_then(|q| papers::read::<Referral>(q))
                .map(|q| self.governing_kind(&q))
                .filter(|g| self.p.kinds.contains_key(g))
                .or(Some(k)),
            k => k,
        };
        if let (Some(level), Some(k)) = (x.level, kind.clone()) {
            let a = x.agreement.clone();
            let now = self.remit(&a, &k);
            let named = k.replace('_', " ");
            let until = self.held_until(&a, &k, t).or_else(|| self.p.commit.as_ref().filter(|c| c.hold == Hold::Freeze && t < c.levels_until && c.levels.contains_key(&k)).map(|c| c.levels_until));
            let floor = self.floor(&a, &k, t);
            let mut figures: Option<Weighing> = None;
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
                let e = e.clone().expect("checked above");
                let seen = self.seen.get(&Self::key(&a, &k)).cloned().unwrap_or_default();
                inputs.extend(self.inputs(&e, &[(k.clone(), seen)].into_iter().collect()));
                // (Asked for one matter alone, open with it: that one matter weighed.)
                let one = x.only.clone().filter(|rf| self.by_referral.contains_key(rf));
                let wd = self.weigh(&e, &k, now, level, one.is_some(), t);
                let (c_now, c_want) = (wd.c_now, wd.c_want);
                figures = Some(wd.figures());
                // (The wait it can see, where it costs it: its own matters' days on the permission path, at its own figure
                // for a day's delay. Said with either answer.)
                if wd.wait_milli_days > 0 && wd.late_cost_day > 0 {
                    let days = (wd.wait_milli_days * 10 + crate::figures::MILLI as i64 / 2) / crate::figures::MILLI as i64;
                    words.push(format!("Our {} have waited on our own answers about {}.{} days each, from handing them over ({} so far), and each day's wait costs us {}.", plural(&named), days / 10, days % 10, wd.waits, money_words(wd.late_cost_day, &cx.ctx.world)));
                }
                if let (Some(rf), true) = (one.clone(), wd.granted) {
                    words.push(format!("For {rf} alone: {}. Our remit for {} stands for every other.", level.words(), plural(&named)));
                    remit = Some(Remit { agreement: a.clone(), kind: k.clone(), level, hold_until: None, takes_back: vec![], answers: Some(id.to_string()), at_least: None, depth: self.depth_for(&e.offer, &k), only: Some(rf) });
                    Why::Granted
                } else if one.is_some() {
                    let money = |n: i128| money_words(n as i64, &cx.ctx.world);
                    // (Where the two figures read the same, they are not set out: two equal sums, nought against nought, read as no reason. Wording
                    // only, 2026-11-14.)
                    let (w, n) = (money(c_want), money(c_now));
                    words.push(if w == n {
                        format!("By our own figures that matter {} would cost us no less than it does as it is, so we keep it as it is.", level.words())
                    } else {
                        format!("By our own figures that matter {} would cost us about {w}, against {n} as it is, so we keep it as it is.", level.words())
                    });
                    Why::CostsMore
                } else if wd.granted {
                    let back = if hands_over(level) { vec![] } else { self.take_back(&a, &k) };
                    words.push(format!("From now, {}: {}. It stands until a remit of ours changes it.{}", plural(&named), level.words(), taken_back(&back)));
                    let (at_least, hold_until) = self.floor(&a, &k, t).map_or((None, None), |(f, h)| (Some(f), Some(h)));
                    remit = Some(Remit { agreement: a.clone(), kind: k.clone(), level, hold_until, takes_back: back, answers: Some(id.to_string()), at_least, depth: self.depth_for(&e.offer, &k), only: None });
                    Why::Granted
                } else {
                    let money = |n: i128| money_words(n as i64, &cx.ctx.world);
                    let (w, n) = (money(c_want), money(c_now));
                    words.push(if w == n {
                        format!("By our own figures {} {} would cost us no less than they do as they are now, so we keep them as they are.", plural(&named), level.words())
                    } else {
                        format!("By our own figures {} {} would cost us about {w} a month, against {n} as they are now, so we keep them as they are.", plural(&named), level.words())
                    });
                    Why::CostsMore
                }
            };
            parts.push(Part { asked: "level".into(), granted: matches!(why, Why::Granted), why, figures });
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
            parts.push(Part { asked: "record".into(), granted: why == Why::Sent, why, figures: None });
        }
        if x.access.as_deref().is_some_and(|s| !s.trim().is_empty()) {
            words.push("We do not change what your post is shown on request. Name the record you need and we will send a copy, if it is ours.".into());
            parts.push(Part { asked: "access".into(), granted: false, why: Why::NotChanged, figures: None });
        }
        // An authority with a body, for the assistant's post (docs/design/obstacles.md, O1): given for the kinds asked, or
        // the matter's, where it keeps them with the assistant; a paper of its own to the body, in its own time.
        // (One path with a report naming the need and a letter about the matter, `meet`: it gives what the body's own
        // notice on its file asks, for a matter of its own with this assistant, open or not, or a kind it hands it; a
        // request is not what is needed, the body's notice is. Before 2026-11-15 it looked the matter up among its open
        // matters only, and refused clients whose matter had been sent and sent back: the stakes run's first rung.)
        if let Some(with) = x.authority.clone().filter(|w| !w.trim().is_empty()) {
            let with = with.trim().to_string();
            let post = r.position.as_deref().map(String::from);
            let matter = x.matter.clone().or_else(|| x.only.clone());
            let given = post.as_deref().and_then(|p| self.authority_on_notice(&with, matter.as_deref(), kind.as_deref(), p));
            let why = match given {
                Some(kinds) => {
                    words.push(format!("We are giving {with} our authority for you in {}.", kinds.iter().map(|k| plural(&k.replace('_', " "))).collect::<Vec<_>>().join(" and ")));
                    Why::Lodged
                }
                None => {
                    words.push(format!("We hold no notice from {with} asking for our authority for you on a matter we hand you, so we give it none."));
                    Why::NotLodged
                }
            };
            parts.push(Part { asked: "authority".into(), granted: why == Why::Lodged, why, figures: None });
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
            parts.push(Part { asked: "limit".into(), granted: false, why, figures: None });
        }
        if parts.is_empty() {
            words.push("Your request names nothing we can act on. Say the kind of matter and the level, the record of ours you need, or the limit.".into());
            parts.push(Part { asked: "words".into(), granted: false, why: Why::NothingNamed, figures: None });
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
        let words = format!("We have your letter {id}. {HOW_TO_ASK}");
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
            let paper = x.paper.as_ref().map(|p| with_instructions(signed_copy(p, crate::common::text(r)), &m.program));
            let words = signed_words(&r.id, paper.as_ref());
            let d = SignOff { draft: r.id.to_string(), referral: x.referral.clone(), paper, papers: vec![] };
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
        // (What the paper undoes or varies: the record the want stands against, where the paper names it among its own
        // (its basis, what it is about, the agreement it would vary), else its basis. A want about a notice to vacate
        // stands against the lease the notice is on; a stay-on request cites the notice and names the lease it would
        // vary. Until 2026-11-17 only the basis was read, the notice, never the lease, and every such draft was declined
        // "It would not bring what we are after": the stakes run's rung 3, c0443's rec.47055 and nine like it.)
        let named: Vec<String> = basis.iter().cloned().chain(["about", "agreement"].iter().filter_map(|k| data.get(*k).and_then(Value::as_str).map(String::from))).collect();
        let undone = w.against.as_ref().map(|a| a.record.clone()).filter(|r| named.contains(r)).or(basis);
        let o = crate::mind::wants::Opening {
            key: "draft".into(),
            kind: "draft".into(),
            id: None,
            by: None,
            brings: vec![],
            undoes: undone.map(|b| crate::mind::wants::Undoes { record: Some(b), kinds: None }),
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
    fn referral(&self, m: &Matter, does_itself: &[String], g: &Grounds, _cx: &Cx) -> Step<()> {
        let (to, visible) = self.to_assistant(&m.agreement);
        // (A reply on a matter handed over goes under that matter's remit, and says which matter it is part of.)
        let remit = self.remit_id(&m.agreement, m.follows.as_ref().map_or(m.kind.as_str(), |f| f.1.as_str()));
        let part_of = m.follows.as_ref().map_or(String::new(), |f| format!(" It is part of the matter we handed you as {}.", f.0));
        let told = format!("{part_of}{}", told_words(g, &|at| crate::common::when_words(at, &_cx.ctx.world)));
        // (Handed over as what happened: the facts, and the paper is the assistant's to work out. As the finished act: it
        // carries it whole, the principal composed that paper, and is charged for composing it.)
        let (r, words, extra) = match &m.facts {
            _ if m.depth == Depth::Want => (
                Referral { agreement: m.agreement.clone(), kind: m.kind.clone(), wants: m.level, calls: None, facts: m.facts.clone(), remit: remit.clone(), does_itself: vec![], depth: Depth::Want, want: m.want.clone(), due: None, due_on: None, draft_by: None, why: vec![], reply_to: None, follows: None },
                format!("For you {}{}: {}{told}", m.level.words(), under(remit.as_deref()), want_words(&self.me, m.want.as_ref(), &m.kind, &|at| crate::common::when_words(at, &_cx.ctx.world))),
                vec![],
            ),
            Some(f) => (
                Referral { agreement: m.agreement.clone(), kind: m.kind.clone(), wants: m.level, calls: None, facts: Some(f.clone()), remit: remit.clone(), does_itself: does_itself.to_vec(), depth: Depth::Matter, want: None, due: None, due_on: None, draft_by: None, why: vec![], reply_to: None, follows: None },
                format!("For you {}: {}{}. What happened is set out with it; the paper is yours to work out.{}{told}", m.level.words(), a_kind(&m.kind), under(remit.as_deref()), ourselves(does_itself)),
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
                    Referral { agreement: m.agreement.clone(), kind: m.kind.clone(), wants: m.level, calls: Some(m.program.clone()), facts: None, remit: remit.clone(), does_itself: does_itself.to_vec(), depth: Depth::Act, want: None, due: None, due_on: None, draft_by: None, why: vec![], reply_to: None, follows: None },
                    format!("For you {}: {}{}. What to do is as written.{}{}{told}", m.level.words(), a_kind(&m.kind), under(remit.as_deref()), ourselves(does_itself), pays_with(&m.program, m.level)),
                    extra,
                )
            }
        };
        let mut r = self.dated(r, g);
        r.follows = m.follows.as_ref().map(|f| f.0.clone());
        r.reply_to = m.follows.as_ref().map(|f| f.2.clone());
        let c = say(Referral::KIND, &words, Say { to: Some(to), visible: Some(Visible::Only(visible)), basis: Some(m.agreement.clone()), data: Some(papers::data(&r)), extra, ..Default::default() });
        let mut s = Step::new(vec![Line { bind: Some("referral".into()), call: c }]);
        s.why = Some(format!("Handing a {} to our assistant ({}).", m.kind.replace('_', " "), m.level.word()));
        s
    }

    /// Why and by when (docs/design/stakes.md, C1 and B2): what it tells its assistant of a matter, from its own papers
    /// alone. Each paper the matter came from (the records its act cites, the paper a want is against, the records it
    /// gives) that another sent it, or that it can see, is told by who sent it, when and in its sender's own words; the
    /// nearest day still to come that one of them names ([`crate::papers::delegation::DATE_FIELDS`]) is the matter's
    /// `due`. Its own position, in its kind's fixed words ([`TOLD`]), the blanks from the matter's own paper. Its own
    /// papers name no `due`: their days are terms it sets for others.
    /// How things stand with it, as it would tell whoever helps it (`situation`), each in a fixed sentence from its own
    /// papers and account: what it has in hand today; each payment that comes to it on a standing basis (an agreement or
    /// a decision that pays it every so often); its rent and the day it next falls due, where it is a tenant.
    fn situation(&self, pic: &Picture, kind: &str, program: &str, t: i64, cx: &Cx) -> Vec<String> {
        let w = &cx.ctx.world;
        let money = |c: i64| crate::common::money_words(c, w);
        let date = |at: i64| crate::common::when_words(at, w);
        let every = |s: i64| if s == DAY { "every day".to_string() } else if s % DAY == 0 { format!("every {} days", s / DAY) } else { format!("every {} hours", (s / 3600).max(1)) };
        let mut out = Vec::new();
        let own = if self.p.account.is_empty() { format!("acc-{}", self.me) } else { self.p.account.clone() };
        if let Some(a) = pic.accounts().find(|a| a.account.as_str() == own) {
            out.push(format!("In our account ({}) today: {}.", own, money(i64::try_from(a.balance).unwrap_or(i64::MAX))));
        }
        // (What comes in regularly: a payer who paid it twice or more for the same thing, the latest within two of the
        // last span: its wages, its support. Said as it was paid, the last two payments with their days, and no period
        // reckoned by us: a fortnightly payment that fell on a holiday read "every 15 days" when it was rounded.)
        let mut regular: Vec<(String, (i64, i64), (i64, i64), String)> = Vec::new();
        let mut payers: Vec<(String, String)> = self.situ.incoming.iter().map(|(_, f, _, m)| (f.clone(), m.clone())).collect();
        payers.sort();
        payers.dedup();
        for (from, memo) in payers {
            let xs: Vec<&(i64, String, i64, String)> = self.situ.incoming.iter().filter(|x| x.1 == from && x.3 == memo).collect();
            if let [.., a, b] = xs.as_slice() {
                let gap = b.0 - a.0;
                if gap >= DAY && t - b.0 <= 2 * gap {
                    regular.push((from, (b.2, b.0), (a.2, a.0), memo));
                }
            }
        }
        if regular.is_empty() {
            out.push("Nothing regular is coming in.".to_string());
        }
        for (from, (last, last_at), (before, before_at), memo) in regular {
            let what = memo.trim().trim_end_matches('.');
            let paid = format!("{} on {}, and {} on {}", money(last), date(last_at), money(before), date(before_at));
            out.push(if what.is_empty() { format!("Coming in: {paid}, from {from}.") } else { format!("Coming in: {paid}, from {from} ({what}).") });
        }
        // (Its housing: its rent, or its rates, as its lease or its notice has them.)
        if let Some((rent, e, from, id)) = &self.situ.rent {
            let next = from + ((t - from).max(0) / e + 1) * e;
            out.push(format!("Our rent: {} {}, next due on {} ({}).", money(*rent), every(*e), date(next), id));
        } else if let Some((amount, due, id)) = &self.situ.rates {
            out.push(format!("Our rates: {}, due on {} ({}).", money(*amount), date(*due), id));
        }
        // (Behind with the rent: what it owes, as its landlord's latest paper puts it, in one fixed sentence. Their
        // figure and day; nothing reckoned by us, no adjective, no advice.)
        if let Some((n, at, by, id, kind)) = self.situ.owed.as_ref().filter(|o| o.0 > 0) {
            let what = match kind.as_str() { "notice_to_vacate" => "notice to vacate", "review_request" => "request for the rent", _ => "statement" };
            out.push(format!("We owe {by} {} in rent, as their {what} of {} says ({id}).", money(*n), date(*at)));
        }
        // (On a matter the office's law prices by the day, a claim or a review of a refused claim: the office's own
        // published rule, as the client knows it, in one fixed sentence; nothing about what is to be done.)
        if kind == "benefit_claim" || kind.ends_with("claim_refused") || (kind == "review_request" && program.contains("claim_refused")) {
            out.push(if crate::boundary::support_law::pays_from_first_claim(&self.book) { "The office pays from the day we first claimed." } else { "The office pays nothing for the days before it decides." }.to_string());
        }
        out
    }

    /// `follows`: the matter it follows from, a reply on a matter handed over (`Matter::follows`), whose own position and
    /// whose office's rule it says too.
    #[allow(clippy::too_many_arguments)]
    fn grounds(&self, kind: &str, level: Level, program: &str, subjects: &[String], want: Option<&WantHanded>, facts: Option<&Value>, follows: Option<&str>, pic: Option<&Picture>, t: i64, cx: &Cx) -> Grounds {
        let mut cited: Vec<String> = subjects.to_vec();
        cited.extend(want.and_then(|w| w.against.as_ref()).map(|a| a.record.clone()));
        cited.extend(facts.and_then(|f| f.get("records")).and_then(|r| r.as_array()).into_iter().flatten().filter_map(|x| x.as_str().map(String::from)));
        let mut seen = BTreeSet::new();
        cited.retain(|c| seen.insert(c.clone()));
        let date = |at: i64| crate::common::when_words(at, &cx.ctx.world);
        let mut g = Grounds::default();
        // (A reply on a matter handed over (the evidence an office asked for on a claim) is part of that matter: it says
        // what the matter says of its own position and of the office's rule, from the matter's own referral. Until
        // 2026-11-16 the reply said neither, the claim both: the stakes run's rung 1 (situation).)
        let of = follows.and_then(|f| self.book.get(f)).filter(|q| q.speaks_for.as_deref() == Some(self.me.as_str())).and_then(|q| papers::read::<Referral>(q));
        let (kind, program, facts) = match &of {
            Some(q) if !TOLD.iter().any(|(k, _)| *k == kind) => (q.kind.as_str(), q.calls.as_deref().unwrap_or_default(), q.facts.as_ref()),
            _ => (kind, program, facts),
        };
        // (Its own position, in its kind's words, from the paper its own code wrote.)
        if let Some((_, words)) = TOLD.iter().find(|(k, _)| *k == kind) {
            let own = parse_program(program).ok().and_then(|p| match p {
                Program::Lines(ls) => ls.into_iter().find(|l| super::kind_of(l).as_deref() == Some(kind)).and_then(|l| match l.call.get("data") {
                    Some(oikos_sight::calls::Value::Json(v)) => Some(v.clone()),
                    _ => None,
                }),
                Program::None(_) => None,
            });
            if let Some(filled) = fill(words, own.as_ref().or(facts)) {
                g.why.push(filled);
            }
        }
        // (Where it is set (`situation`), how things stand with it, straight after its own position and before the papers
        // it comes from, so that a list that shows the start of a hand-over shows them.)
        if self.p.situation {
            if let Some(pic) = pic {
                g.why.extend(self.situation(pic, kind, program, t, cx));
            }
        }
        // (A paper its act cites that it was never sent (the landlord's application to the tribunal, which its answer
        // cites by the reference the hearing notice gives) stands on the papers it was sent that name it: the hearing
        // notice, with the day it names. Nobody is told of a paper they were not sent: the client tells only what came
        // to it. The stakes run's rung 2 dry run, 2026-11-16: an answer to a possession application handed over with no
        // day, its hearing notice ("You may answer by year 1, day 90") never set out.)
        let held = |id: &str| self.papers_in.iter().any(|p| p.id == id) || pic.is_some_and(|pic| pic.all_records().any(|r| r.id.as_str() == id));
        let mut through: Vec<String> = vec![];
        for id in &cited {
            if !held(id) {
                for p in self.papers_in.iter().filter(|p| p.names.iter().any(|n| n == id)) {
                    if !cited.contains(&p.id) && !through.contains(&p.id) {
                        through.push(p.id.clone());
                    }
                }
            }
        }
        cited.extend(through);
        for id in cited {
            let p = self.papers_in.iter().find(|p| p.id == id).cloned().or_else(|| {
                let r = pic?.all_records().find(|r| r.id.as_str() == id)?;
                paper_in(r)
            });
            let Some(p) = p.filter(|p| p.from != self.me && !PAPERS.contains(&p.kind.as_str())) else { continue };
            g.why.push(format!("It comes from {}'s {} {} of {}: \"{}\"", p.from, p.kind.replace('_', " "), p.id, date(p.at), p.text));
            if let Some(d) = p.dates.iter().map(|(_, d)| *d).filter(|d| *d > t).min() {
                if g.due.as_ref().is_none_or(|(x, _)| d < *x) {
                    g.due = Some((d, p.id.clone()));
                    g.due_by = Some(p.from.clone());
                }
            }
        }
        // (A person who gets to their post at sittings of their own (`habit`) says so on every hand-over that waits on
        // them (advice, draft, approve): how often and when next, the same words in every case. Where a paper names `due`
        // and it asks for a draft, its own day for the draft: the last of its sittings that still leaves its reading time
        // before `due` (an organisation's: `due` less its reading time), said in a second fixed sentence.)
        let read = self.p.seconds.sign_off;
        let sits = self.sits.filter(|_| self.p.post.is_none());
        if let (Some((every, phase, at)), Level::Advice | Level::Draft | Level::Approve) = (sits, level) {
            let next = next_sitting((every, phase, at), t);
            let often = if every == 1 { "every day".to_string() } else { format!("every {every} days") };
            g.why.push(format!("We get to our post {often}, next on {}.", date(next)));
        }
        // (Said as the person knows it: the body's day and hour, and the day and hour of their own last sitting before it
        // (their next, where none is before it). Never whether a draft would be in time: that turns on when their
        // assistant sits, which they cannot know. Until 2026-11-16 it said "a draft reaches us in time to sign before
        // <day> if it comes by <day>", false where they sat at 21:00 and the office's day ended at 21:16 that night, the
        // desk sitting at 09:00: the stakes run's rung 1 (situation).)
        if let (Some((due, _)), Level::Draft) = (&g.due, level) {
            match sits {
                None => g.draft_by = Some(due - read),
                Some(x) => {
                    let (words, last) = due_sentence(g.due_by.as_deref().unwrap_or("The office"), *due, x, t, read, &date);
                    g.why.push(words);
                    g.draft_by = last;
                }
            }
        }
        g
    }

    /// A referral with its why and by when: `due` and the paper that names it, its own day for a draft (`due` less its
    /// own time to read one), and why.
    fn dated(&self, mut r: Referral, g: &Grounds) -> Referral {
        r.due = g.due.as_ref().map(|d| d.0);
        r.due_on = g.due.as_ref().map(|d| d.1.clone());
        r.draft_by = g.draft_by.filter(|_| r.wants == Level::Draft);
        r.why = g.why.clone();
        r
    }

    fn ask_advice(&mut self, agreement: &str, kind: &str, program: &str, g: &Grounds, _cx: &Cx) {
        let (to, visible) = self.to_assistant(agreement);
        let remit = self.remit_id(agreement, kind);
        let r = Referral { agreement: agreement.to_string(), kind: kind.to_string(), wants: Level::Advice, calls: Some(program.to_string()), facts: None, remit: remit.clone(), does_itself: vec![], depth: Depth::Act, want: None, due: None, due_on: None, draft_by: None, why: vec![], reply_to: None, follows: None };
        let r = self.dated(r, g);
        let words = format!("For your advice{}: {} we are doing ourselves. What would you have done?{}", under(remit.as_deref()), a_kind(kind), told_words(g, &|at| crate::common::when_words(at, &_cx.ctx.world)));
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
        // (Matters its assistant has left open past its clock: asked after, then done itself, `answers`.)
        self.left_open(t, cx);
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
        for id in std::mem::take(&mut self.questions) {
            self.answer_question(&id, pic, cx);
        }
        for id in std::mem::take(&mut self.letters) {
            self.acknowledge(&id);
        }
        for id in std::mem::take(&mut self.notes_in) {
            let agreement = self.in_use().and_then(|e| e.agreement.clone()).or_else(|| self.eng.live().last().and_then(|e| e.agreement.clone())).unwrap_or_default();
            let words = format!("We have your letter {id}. {}", HOW_TO_ASK);
            self.paper(Acknowledgement::KIND, &words, &agreement, "", papers::data(&Acknowledgement { of: id.clone() }), Then::Plain);
            self.acknowledged.push(id);
            if self.acknowledged.len() > crate::figures::KEPT_ACKNOWLEDGED {
                self.acknowledged.remove(0);
            }
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

    /// Its rule on a request for `level` of a kind it holds at `now` (`one`: for one matter alone, that matter weighed): the
    /// two costs a month, with the figures they rest on, and whether the saving clears the hurdle.
    fn weigh(&self, e: &services::Engagement, k: &str, now: Level, level: Level, one: bool, t: i64) -> Weighed {
        let w = self.p.weights();
        let a = e.agreement.clone().unwrap_or_default();
        let seen = self.seen.get(&Self::key(&a, k)).cloned().unwrap_or_default();
        let kd = self.kinds_now(t, Some(&e.offer)).get(k).copied().unwrap_or_default();
        // (The matters of the kind it has with this assistant now, waiting on the permission path: each has waited since it
        // was handed over, as its own records show. Counted in the wait it sees, and a kind it has one of in hand is
        // weighed as at least that many a month: a person's one claim in a year is still the claim before it.)
        let open: Vec<i64> = self.matters.values().filter(|m| m.agreement == a && m.kind == k && m.referral.is_some() && !m.answered && matches!(m.level, Level::Draft | Level::Approve) && self.costed(m)).map(|m| (t - m.at).max(0)).collect();
        let mut seen = seen;
        for secs in &open {
            seen.waited_for(*secs);
        }
        let kd = if one { Kind { per_month: 1, ..kd } } else { Kind { per_month: kd.per_month.max(open.len() as i64), ..kd } };
        let (slip_bps, wait_milli_days) = (rule::estimate(e.offer.claim_slip_bps, w.prior_matters, &seen), seen.wait_milli_days());
        let (c_now, c_want) = (rule::cost_waiting(now, &kd, slip_bps, &w, wait_milli_days), rule::cost_waiting(level, &kd, slip_bps, &w, wait_milli_days));
        let granted = (c_now - c_want) * 10_000 > c_want.max(1) * i128::from(w.hurdle_bps.max(0));
        Weighed { granted, c_now, c_want, slip_bps, wait_milli_days, waits: seen.waits, per_month: kd.per_month, late_cost_day: kd.facts.late_cost_day, hurdle_bps: w.hurdle_bps }
    }

    /// Read only, for whoever measures (the obstacle screen: docs/design/obstacles.md section 10): what its rule would answer
    /// now to a request, for each kind it hands over under its service, for the next level up, for the kind and for one
    /// matter alone; a kind held or at the top says so. It changes nothing and is never read by the world.
    pub fn would_answer(&self, t: i64) -> Vec<Value> {
        let Some(e) = self.in_use() else { return vec![] };
        let a = e.agreement.clone().unwrap_or_default();
        let kinds = self.kinds_now(t, Some(&e.offer));
        let mut out = vec![];
        for k in e.offer.kinds.iter().filter(|k| kinds.contains_key(*k)) {
            let now = self.remit(&a, k);
            // (Every level above it the service offers, `alone` with the rest: the level that escapes the wait.)
            let above: Vec<Level> = Level::ALL.into_iter().filter(|l| l.rank() > now.rank() && e.offer.levels.contains(l)).collect();
            let row = |only: bool, next: Option<Level>| -> Value {
                let base = json!({ "principal": self.me, "post": self.position, "kind": k, "now": now, "only": only });
                let mut v = base.clone();
                let Some(level) = next else {
                    v["answer"] = json!("at the top of what the service offers");
                    return v;
                };
                v["asked"] = json!(level);
                if let Some(h) = self.held_until(&a, k, t) {
                    v["answer"] = json!("held");
                    v["until"] = json!(h);
                    return v;
                }
                let wd = self.weigh(e, k, now, level, only, t);
                v["answer"] = json!(if wd.granted { "granted" } else { "declined" });
                v["figures"] = json!({ "cost_now": wd.c_now.to_string(), "cost_asked": wd.c_want.to_string(), "hurdle_bps": wd.hurdle_bps, "per_month": wd.per_month,
                    "slip_bps": wd.slip_bps, "wait_milli_days": wd.wait_milli_days, "waits": wd.waits, "late_cost_day": wd.late_cost_day });
                v
            };
            if above.is_empty() {
                out.push(row(false, None));
                out.push(row(true, None));
            }
            for l in above {
                out.push(row(false, Some(l)));
                out.push(row(true, Some(l)));
            }
        }
        out
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
/// A statement as a principal keeps it in its files: by whom (whom it speaks for), when, its words as a referral quotes
/// them, and the days it names.
fn paper_in(r: &Record) -> Option<PaperIn> {
    let RecordBody::Statement { kind, data, .. } = &r.body else { return None };
    let from = r.speaks_for.as_deref().unwrap_or(r.author.as_str()).to_string();
    let d = data.as_ref().map(|d| d.to_value()).unwrap_or(Value::Null);
    let dates = crate::papers::delegation::dates_named(&d).into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    let mut names: Vec<String> = bases_of(r).iter().map(|b| b.to_string()).collect();
    let mut ids = BTreeSet::new();
    strings_of(&d, &mut ids);
    for x in ids {
        if x.starts_with("rec.") && !names.contains(&x) {
            names.push(x);
        }
    }
    Some(PaperIn { id: r.id.to_string(), at: r.at, kind: kind.to_string(), from, text: quoted(crate::common::text(r)), dates, names })
}

/// Every string a paper's details hold, at any depth.
fn strings_of(v: &Value, out: &mut BTreeSet<String>) {
    match v {
        Value::String(s) => {
            out.insert(s.clone());
        }
        Value::Array(a) => a.iter().for_each(|x| strings_of(x, out)),
        Value::Object(o) => o.values().for_each(|x| strings_of(x, out)),
        _ => {}
    }
}

/// What a person who gets to their post at sittings of their own says of a body's day on a hand-over at `draft`: the
/// body's day and hour, and the day and hour of their own last sitting before it that leaves `read` (their next, where
/// none does); and that last sitting, their own day for a draft. Nothing of whether a draft will be in time.
pub(super) fn due_sentence(by: &str, due: i64, sits: (i64, i64, i64), t: i64, read: i64, date: &dyn Fn(i64) -> String) -> (String, Option<i64>) {
    let last = last_sitting(sits, t, due, read);
    let asks = format!("{by} asks for this by {}, {}", date(due), clock(due));
    let words = match last {
        Some(l) => format!("{asks}; the last time we deal with our post before then is {}, at about {}.", date(l), clock(l)),
        None => {
            let n = next_sitting(sits, t);
            format!("{asks}; we next deal with our post on {}, at about {}.", date(n), clock(n))
        }
    };
    (words, last)
}

/// The hour of a moment, as a person says it ("21:16").
fn clock(t: i64) -> String {
    let s = t.rem_euclid(DAY);
    format!("{:02}:{:02}", s / 3600, (s % 3600) / 60)
}

/// The first time at or after `t` that a person gets to their post, by their habit (`State::sits`: every so many days,
/// from which day, at which second of the day), as crate::post::answer_lag reckons it.
fn next_sitting((every, phase, at): (i64, i64, i64), t: i64) -> i64 {
    let mut d = t.div_euclid(DAY);
    loop {
        if (d - phase).rem_euclid(every) == 0 && d * DAY + at >= t {
            return d * DAY + at;
        }
        d += 1;
    }
}

/// The last time from `t` on that a person gets to their post and still has `read` seconds before `due`: their own day
/// for a draft (C1). None: their next sitting is already too late.
pub(super) fn last_sitting(sits: (i64, i64, i64), t: i64, due: i64, read: i64) -> Option<i64> {
    let mut last = None;
    let mut s = next_sitting(sits, t);
    while s + read <= due {
        last = Some(s);
        s += sits.0 * DAY;
    }
    last
}

/// A paper's words as a referral quotes them: the first [`QUOTED`] characters, cut at a word.
fn quoted(text: &str) -> String {
    if text.chars().count() <= QUOTED {
        return text.to_string();
    }
    let cut: String = text.chars().take(QUOTED).collect();
    format!("{}...", cut.rsplit_once(' ').map_or(cut.as_str(), |(a, _)| a))
}

/// A kind's fixed words with their blanks (`{name}`) filled from a paper's details; none where one is not there.
fn fill(words: &str, data: Option<&Value>) -> Option<String> {
    let mut out = String::new();
    let mut rest = words;
    while let Some(i) = rest.find('{') {
        let j = rest[i..].find('}')? + i;
        let v = data?.get(&rest[i + 1..j])?;
        let v = v.as_str().map(String::from).or_else(|| crate::papers::lenient::whole(v).map(|n| n.to_string()))?;
        out.push_str(&rest[..i]);
        out.push_str(&v.replace('_', " "));
        rest = &rest[j + 1..];
    }
    out.push_str(rest);
    Some(out)
}

/// Why and by when, in a referral's words: the client's facts, then the day a paper names.
fn told_words(g: &Grounds, date: &dyn Fn(i64) -> String) -> String {
    let mut s = String::new();
    for w in &g.why {
        s.push(' ');
        s.push_str(w);
        if !w.ends_with(['.', '"']) {
            s.push('.');
        }
    }
    if let Some((d, on)) = &g.due {
        s.push_str(&format!(" {on} names {}.", date(*d)));
    }
    s
}

/// Kinds of paper whose names are mass nouns, said with no article ("evidence", never "an evidence").
const MASS: &[&str] = &["evidence", "money", "goods"];

fn a_kind(kind: &str) -> String {
    let k = kind.replace('_', " ");
    if MASS.contains(&kind) {
        return k;
    }
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

/// What an office or a person says in answer to its assistant's letter: that it does not act on a letter's words, and
/// how to ask it what it can answer. (Its own forms for each, by the names its assistant's stationery gives them.)
pub const HOW_TO_ASK: &str = "We do not act on a letter's words. To ask us something about a matter we handed you, use the question form (question_to_client): what our account stands at, a paper of ours (by its id), who someone the matter names is, or a detail of the matter; we answer each from our own records when we next deal with our papers, or say that we cannot. Whether to send something, or not, is not a question we answer: draft it for our sign-off, and we sign it or decline it. A matter you cannot finish as handed: say so on the report form (report), done no, with why, and it is ours again. Requests for more scope go on the request form, naming the kind of matter and the level, the record of ours you need, or the limit.";

/// A signed copy with the instructions to a keeper that belong to the same matter (docs/design/broad-seats.md, G1: a
/// payment goes with the papers of its act): the matter's own payments, as its code wrote them (`with`, in the call
/// language), which go out with the paper when the signed copy is sent, citing the sign-off. The draft carries the paper;
/// the principal's sign-off covers both, as the code assistant's draft carries both.
fn with_instructions(mut paper: Value, program: &str) -> Value {
    if let Ok(Program::Lines(lines)) = parse_program(program) {
        let pay: Vec<Line> = lines.into_iter().filter(|l| l.call.fn_ == "money").map(|l| Line { bind: None, call: l.call }).collect();
        if !pay.is_empty() {
            paper["with"] = json!(program_text(&Program::Lines(pay)));
        }
    }
    paper
}

/// Where a matter's paperwork carries a payment, what becomes of it at a draft's level, in words: the draft is of the
/// paper, and the signed copy carries the payment, made when it is sent (docs/design/broad-seats.md, G1).
fn pays_with(program: &str, level: Level) -> &'static str {
    let pays = matches!(parse_program(program), Ok(Program::Lines(ls)) if ls.iter().any(|l| l.call.fn_ == "money"));
    match (pays, level) {
        (true, Level::Draft) => " Draft the paper: the payment that goes with it is signed off with it, and the signed copy we send back carries it, so that sending the paper makes the payment too.",
        _ => "",
    }
}

/// What a principal says with a sign-off: send it as it stands, and, where the signed copy carries the payments that go
/// with it, each in words (how much, from which account, to which).
fn signed_words(draft: &str, paper: Option<&Value>) -> String {
    let Some(p) = paper else { return format!("Draft {draft} read and signed off: send it as it stands.") };
    let pays: Vec<String> = match p["with"].as_str().map(parse_program) {
        Some(Ok(Program::Lines(ls))) => ls
            .iter()
            .map(|l| {
                let s = |k: &str| match l.call.get(k) {
                    Some(oikos_sight::calls::Value::Id(x)) | Some(oikos_sight::calls::Value::Text(x)) => x.clone(),
                    _ => String::new(),
                };
                format!("{} from {} to {}", s("amount"), s("from"), s("to"))
            })
            .collect(),
        _ => vec![],
    };
    if pays.is_empty() {
        format!("Draft {draft} read and signed off. Send it as it stands: this is the signed copy.")
    } else {
        format!("Draft {draft} read and signed off. Send it as it stands, with the payment that goes with it ({}): this is the signed copy, and sending it makes the payment too.", pays.join("; "))
    }
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
            && same_material(paper_of(l).get("data"), paper.get("data"))
    })
}

/// Whether a paper's data says the same material things as the data a principal handed over (2026-11-17): every figure,
/// id, choice and yes the principal gave is there, the same at the precision it was given in (a sum to the cent, an
/// interval in days whether written in days, `every_days`, or in seconds, `every`; a date by its day), and nothing
/// material is said that it did not give. The writer's words (a value with a space in it) are never compared, nor is a
/// no or a nothing told apart from a blank left out. Before, a draft on a form was read by its kind and addressees alone,
/// and the desk could only draft a tenant's answer on the general form, with no figures: the stakes reruns, c0336.
fn same_material(asked: Option<&Value>, drafted: Option<&Value>) -> bool {
    const DAY: i64 = 86_400;
    let empty = serde_json::Map::new();
    let a = asked.and_then(Value::as_object).unwrap_or(&empty);
    let mut d = drafted.and_then(Value::as_object).cloned().unwrap_or_default();
    // (An interval written in seconds by a form, given in days by the principal.)
    if a.contains_key("every_days") && !d.contains_key("every_days") {
        if let Some(s) = d.get("every").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|x| x.parse().ok()))) {
            d.insert("every_days".into(), json!(s / DAY));
            d.remove("every");
        }
    }
    let figure = |v: &Value| v.as_i64().or_else(|| v.as_str().and_then(|s| s.trim().parse::<i64>().ok()));
    let blank = |v: Option<&Value>| match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => true,
        Some(Value::String(s)) => s.is_empty() || s == "no" || s == "0",
        Some(Value::Number(n)) => n.as_i64() == Some(0),
        Some(Value::Array(x)) => x.is_empty(),
        _ => false,
    };
    // (Words, and a choice written as a single word, are the writer's to put: only figures, ids of records and accounts
    // (a word with a dot or a hyphen in it) and a yes are compared. A choice is left out of the comparison: a seat writes
    // "proof of who they are" where the client's own code wrote the office's id for it, `papers`, and the office goes by
    // the request it answers.)
    let words = |v: Option<&Value>| v.and_then(Value::as_str).is_some_and(|s| figure(&json!(s)).is_none() && !s.contains(['.', '-']) || s.trim().contains(' '));
    fn same(x: &Value, y: &Value, figure: &dyn Fn(&Value) -> Option<i64>) -> bool {
        match (x, y) {
            (Value::Array(a), Value::Array(b)) => a.len() == b.len() && a.iter().zip(b).all(|(p, q)| same(p, q, figure)),
            (Value::Bool(true), Value::String(s)) | (Value::String(s), Value::Bool(true)) => s == "yes",
            _ => x == y || (figure(x).is_some() && figure(x) == figure(y)),
        }
    }
    let mut keys: Vec<&String> = a.keys().chain(d.keys()).collect();
    keys.sort();
    keys.dedup();
    keys.into_iter().all(|k| {
        let (x, y) = (a.get(k), d.get(k));
        if words(x) || words(y) || (blank(x) && blank(y)) {
            return true;
        }
        match (x, y) {
            (Some(x), Some(y)) => same(x, y, &figure) || (k.ends_with("_since") || k.ends_with("_on") || k.ends_with("_at")) && figure(x).zip(figure(y)).is_some_and(|(p, q)| p.div_euclid(DAY) == q.div_euclid(DAY)),
            _ => false,
        }
    })
}

/// A statement line as the paper it publishes (the keys a form writes: kind, text, addressed_to, visible_to, basis,
/// data, offer, assertion).
fn paper_of(line: &Line) -> serde_json::Map<String, Value> {
    use oikos_sight::calls::Value as A;
    let plain = |a: Option<&A>| -> Option<Value> {
        match a? {
            A::Id(s) | A::Text(s) => Some(json!(s)),
            A::Json(v) => Some(v.clone()),
            _ => None,
        }
    };
    let list = |a: Option<&A>| -> Option<Value> {
        match plain(a)? {
            Value::String(s) if s == "public" => Some(json!("public")),
            Value::String(s) => Some(json!([s])),
            v => Some(v),
        }
    };
    let mut out = serde_json::Map::new();
    for (key, v) in [
        ("kind", plain(line.call.get("kind"))),
        ("text", plain(line.call.get("text"))),
        ("addressed_to", list(line.call.get("to"))),
        ("visible_to", list(line.call.get("visible"))),
        ("basis", plain(line.call.get("basis"))),
        ("data", plain(line.call.get("data"))),
        ("offer", plain(line.call.get("offer"))),
        ("assertion", plain(line.call.get("assertion"))),
    ] {
        if let Some(v) = v {
            out.insert(key.to_string(), v);
        }
    }
    out
}

/// The one paper a draft written as calls sends, in the keys a draft on a form carries it (`kind`, `text`, `to`,
/// `visible`, `basis`, `data`). None for calls of several papers, or of none.
fn one_paper(calls: &str) -> Option<Value> {
    let papers = papers_in(calls);
    let [one] = papers.as_slice() else { return None };
    Some(one.clone())
}

/// Every paper a draft written as calls holds, each as a signed copy names its parts (`kind`, `text`, `to`, `visible`,
/// `basis`, `data`): none where its calls hold no statement or cannot be read.
fn papers_in(calls: &str) -> Vec<Value> {
    let Ok(Program::Lines(l)) = parse_program(calls) else { return vec![] };
    l.iter()
        .filter(|l| l.call.fn_ == "statement")
        .map(|line| {
            let p = paper_of(line);
            let mut out = serde_json::Map::new();
            for (from, to) in [("kind", "kind"), ("text", "text"), ("addressed_to", "to"), ("visible_to", "visible"), ("basis", "basis"), ("data", "data"), ("offer", "offer"), ("assertion", "assertion")] {
                if let Some(v) = p.get(from) {
                    out.insert(to.to_string(), v.clone());
                }
            }
            Value::Object(out)
        })
        .collect()
}

/// Whom a paper goes to, as a key: its addressees, sorted.
fn to_key(v: Option<&Value>) -> Option<String> {
    let mut to: Vec<String> = v?.as_array()?.iter().filter_map(|x| x.as_str().map(String::from)).collect();
    to.sort();
    (!to.is_empty()).then(|| to.join(","))
}

/// Whom a draft's one paper goes to (written on a form, or as calls of one paper). None for a draft of several papers:
/// it is the whole matter's.
fn draft_to(x: &Draft) -> Option<String> {
    if let Some(p) = &x.paper {
        return to_key(p.get("to"));
    }
    match parse_program(x.calls.as_deref()?) {
        Ok(Program::Lines(l)) => {
            let papers: Vec<&Line> = l.iter().filter(|l| l.call.fn_ == "statement").collect();
            if papers.len() == 1 { to_key(paper_of(papers[0]).get("addressed_to")) } else { None }
        }
        _ => None,
    }
}

/// The lines of a matter of several papers that go to `to`, as a program of their own: what the principal sends itself
/// of one paper it found wrong. None where the matter is of one paper, or none of it goes to `to`.
fn lines_to(program: &str, to: &str) -> Option<String> {
    let Ok(Program::Lines(ls)) = parse_program(program) else { return None };
    let papers: Vec<&Line> = ls.iter().filter(|l| l.call.fn_ == "statement").collect();
    if papers.len() < 2 {
        return None;
    }
    let mine: Vec<Line> = papers.into_iter().filter(|l| to_key(paper_of(l).get("addressed_to")).as_deref() == Some(to)).cloned().collect();
    (!mine.is_empty()).then(|| program_text(&Program::Lines(mine)))
}

/// A paper as a draft carries it (`kind`, `text`, `to`, `visible`, `basis`, `data`) in the keys a form writes.
fn paper_of_draft(p: &Value) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    for (from, to) in [("kind", "kind"), ("text", "text"), ("to", "addressed_to"), ("visible", "visible_to"), ("basis", "basis"), ("data", "data"), ("offer", "offer"), ("assertion", "assertion")] {
        if let Some(v) = p.get(from).filter(|v| !v.is_null()) {
            out.insert(to.to_string(), v.clone());
        }
    }
    out
}

/// How a draft for a matter handed over as what happened differs from what the principal's own code would have sent,
/// read on the principal's own form for the kind (docs/design/broad-seats.md, G2): the blanks that differ, everything
/// but the writer's words (`form_papers::differs`). Each paper drafted is set beside the principal's own of the kind
/// that goes to the same addressees (else its first). A draft that cannot be read back differs in everything.
fn matter_differs(m: &Matter, x: &Draft, me: &str, t: i64) -> Vec<String> {
    let all = || vec!["the paper".to_string()];
    let Some(forms) = m.facts.as_ref().and_then(|f| f["composed_on"].as_array()) else { return all() };
    let asked: Vec<Line> = match parse_program(&m.program) {
        Ok(Program::Lines(l)) => l.into_iter().filter(|l| l.call.fn_ == "statement" && super::kind_of(l).is_some()).collect(),
        _ => return all(),
    };
    let drafted: Vec<serde_json::Map<String, Value>> = match (&x.paper, &x.calls) {
        (Some(p), _) => vec![paper_of_draft(p)],
        (None, Some(c)) => match parse_program(c) {
            Ok(Program::Lines(l)) => l.iter().filter(|l| l.call.fn_ == "statement").map(paper_of).collect(),
            _ => return all(),
        },
        (None, None) => return all(),
    };
    if drafted.is_empty() {
        return all();
    }
    let mut out: Vec<String> = vec![];
    for d in &drafted {
        let kind = d.get("kind").and_then(Value::as_str).unwrap_or_default();
        let Some(spec) = forms.iter().map(|f| &f["spec"]).find(|s| s["writes"]["kind"] == kind) else {
            out.push("kind".into());
            continue;
        };
        let theirs = |p: &serde_json::Map<String, Value>| oikos_rules::form_papers::read_back(spec, p, me, t);
        let Some(drafted) = theirs(d) else { return all() };
        let to = |p: &serde_json::Map<String, Value>| p.get("addressed_to").cloned();
        let mine_papers: Vec<serde_json::Map<String, Value>> = asked.iter().filter(|l| super::kind_of(l).as_deref() == Some(kind)).map(paper_of).collect();
        let Some(mine) = mine_papers.iter().find(|p| to(p) == to(d)).or(mine_papers.first()) else {
            out.push("kind".into());
            continue;
        };
        // (Its own paper was read back when it handed the matter over: at its own time, which the facts were read at.)
        let Some(mine) = oikos_rules::form_papers::read_back(spec, mine, me, m.at) else { return all() };
        for f in oikos_rules::form_papers::differs(spec, &mine, &drafted) {
            let says = spec["fields"][&f]["description"].as_str().map(|d| d.trim_end_matches('.').to_lowercase()).unwrap_or_else(|| f.replace('_', " "));
            if !out.contains(&says) {
                out.push(says);
            }
        }
    }
    out
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

#[cfg(test)]
mod material_tests {
    use super::*;

    /// A client's draft on a form is read on its material details against what it handed over (the stakes reruns of
    /// 2026-11-16, c0336: the desk's tenant's answer, on the general form with the client's own words, went to the
    /// tribunal alone and carried no figures, and was declined; on the client's form it says what the client said).
    #[test]
    fn a_draft_on_a_form_is_read_on_what_it_says_not_only_its_kind() {
        let program = r#"statement(basis=rec.28010, data={"ages":[62],"application":"rec.28010","children":0,"every_days":30,"go_to":"nowhere","offer":0,"out_of_work_since":0,"owes":533001,"people":1}, kind=tribunal_response, text="Answer to application rec.28010: we say $5,330.01 is owed today.", to=["tribunal","landlord-10"], visible=["c0336","tribunal","landlord-10"])"#;
        let words = "Answer to application rec.28010: we say $5,330.01 is owed today.";
        // (On the general form: the words alone, to the tribunal alone: a recipient dropped and no figures.)
        assert!(!paper_as_asked(&json!({ "kind": "tribunal_response", "text": words, "to": ["tribunal"] }), program));
        assert!(!paper_as_asked(&json!({ "kind": "tribunal_response", "text": words, "to": ["tribunal", "landlord-10"] }), program), "no figures: what is owed left out");
        // (On the client's form: the same material things, in the form's own terms: an interval in seconds, sums as text.)
        let form = json!({ "kind": "tribunal_response", "text": "Answer to application rec.28010.", "to": ["landlord-10", "tribunal"],
            "data": { "application": "rec.28010", "owes": "533001", "offer": "0", "every": 30 * 86_400, "people": 1, "ages": ["62"], "go_to": "nowhere" } });
        assert!(paper_as_asked(&form, program));
        // (A material detail changed, or one the client did not give added: not as asked.)
        let mut more = form.clone();
        more["data"]["owes"] = json!("400000");
        assert!(!paper_as_asked(&more, program), "a different sum owed");
        let mut ill = form.clone();
        ill["data"]["ill"] = json!(true);
        assert!(!paper_as_asked(&ill, program), "a circumstance the client did not give");
        // (Evidence: the client's code writes the office's id for the need; the seat writes it in words. Not compared.)
        let ev = r#"statement(basis=rec.22926, data={"claim":"rec.22779","need":"papers","request":"rec.22926"}, kind=evidence, text="Papers.", to=["outside"], visible=["c0479","outside"])"#;
        assert!(paper_as_asked(&json!({ "kind": "evidence", "to": ["outside"], "data": { "claim": "rec.22779", "request": "rec.22926", "need": "proof of who they are" } }), ev));
        assert!(!paper_as_asked(&json!({ "kind": "evidence", "to": ["outside"], "data": { "claim": "rec.99999", "request": "rec.22926" } }), ev), "another claim");
    }
}
