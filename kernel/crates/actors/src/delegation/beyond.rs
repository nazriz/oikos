//! What a log shows of delegated work, read after the run (docs/design/handing-over.md section 7): each act an
//! assistant did beside the remit in force for it, and each request for more scope beside what its matter needed and
//! what came of it. A reading of the log, never part of the world: nothing in a run sees it, and it judges nothing. It
//! sorts each act by what the records say (within the remit, or not, and how), and leaves the reading to whoever
//! measures.
//!
//! Fed the log's entries in order (`take`), it keeps only what delegation's papers say; `acts` and `requests` are its
//! rows. One copy of the kind rule: a paper's kind is its statement's kind, as `kind_of` reads a line.

use super::kinds_of;
use crate::papers::delegation::KINDS as PAPERS;
use oikos_sight::calls::parse_program;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// A remit as it stood: who made it, for which kind under which service, at which level, from when.
#[derive(Debug, Clone)]
struct RemitSeen {
    t: i64,
    principal: String,
    kind: String,
    level: String,
    id: String,
    /// For one matter alone (a referral): docs/design/obstacles.md section 10.
    only: Option<String>,
}

#[derive(Debug, Clone)]
struct ReferralSeen {
    t: i64,
    principal: String,
    kind: String,
    wants: String,
    calls: Option<String>,
    does_itself: Vec<String>,
    /// The kind whose remit governs it: the kind of the remit it names, or of the matter it follows, else its own
    /// (`principal.rs`, `governing_kind`: a reply on a claim is under the claim's remit).
    governed_by: String,
    /// An act already sorted against it, or the principal's decline of its draft (it does the matter itself).
    used: bool,
}

/// A paper an assistant wrote on a matter in place of doing it: advice, or a report that it is not done.
#[derive(Debug, Clone)]
struct InPlace {
    t: i64,
    referral: String,
    paper: String,
    kind: String,
    post: String,
}

/// The reader (one a log).
#[derive(Debug, Default)]
pub struct Reader {
    /// Each assistant's post: whose it is (an organisation's), from the config's principals.
    posts: BTreeMap<String, String>,
    /// Every post's organisation.
    entity_of: BTreeMap<String, String>,
    /// The providers (whoever published an offer of service).
    providers: BTreeSet<String>,
    remits: Vec<RemitSeen>,
    referrals: BTreeMap<String, ReferralSeen>,
    /// The referral each paper on a matter is about (a draft, a sign-off, a request to go ahead, a report).
    about: BTreeMap<String, String>,
    /// A sign-off's referral, and the paper it signed (where the draft carried one).
    sign_offs: Vec<(i64, String, Option<Value>)>,
    /// The sign-offs (their place in `sign_offs`) a paper sent has been found to be the signed copy of.
    copy_sent: BTreeSet<usize>,
    /// The matters an assistant drafted for sign-off (their referrals).
    drafted: BTreeSet<String>,
    /// Advice, and reports of a matter not done, an assistant wrote on matters, in order.
    in_place: Vec<InPlace>,
    /// A sign-off whose signed copy carries the payments of its matter (`with`): its id, and its referral.
    signed_with: BTreeMap<String, String>,
    go_aheads: Vec<(i64, String)>,
    requests: Vec<Value>,
    answers: BTreeMap<String, (i64, Value)>,
    acts: Vec<Value>,
    /// Each participant's person (from the config), to read a person's own want events and choices.
    person_of: BTreeMap<String, String>,
    /// Wants handed over (their referral's id), in order, with what the log shows of each.
    wants: Vec<WantSeen>,
    /// Each person's own choices of way for a want, as their mind logged them: (t, about, the odds by kind of way).
    choices: BTreeMap<String, Vec<(i64, String, Vec<(String, i64)>)>>,
    /// Each person's want events: (t, about, whom, kind).
    events: BTreeMap<String, Vec<(i64, String, Option<String>, String)>>,
    /// The seconds each act took, and whose (`action_started`), by the act, until it is applied; then the act just
    /// applied (its cause, whose, seconds), whose records follow it with the same cause.
    seconds: BTreeMap<String, (String, i64)>,
    applied: Option<(i64, String, i64)>,
    /// The want a paper sent for one is part of (its referral).
    paper_want: BTreeMap<String, String>,
    /// The referral each act sorted against one is for (so that a paper sent again, citing the one returned, is the
    /// same matter's).
    referral_of: BTreeMap<String, String>,
    /// The obstacles the world's laws logged (docs/design/obstacles.md section 4), in order, and the one each paper
    /// they name is in.
    obstacles: Vec<ObstacleSeen>,
    obstacle_of: BTreeMap<String, usize>,
    /// The papers an assistant's seat wrote: which seat.
    wrote: BTreeMap<String, String>,
    /// The referral each act (its cause) was sorted against, by kind: every paper of a matter handed over is that
    /// matter's, however many one act sends (a rates instalment's fifteen notices).
    act_referral: BTreeMap<(String, String), String>,
    /// The paper of a kind of matter each act (its cause) sent first, as it was sorted: its referral, what the matter was
    /// handed at, whether signed, and its class. A payment the same act makes is that paper's (G1).
    act_paper: BTreeMap<String, (Value, Value, bool, Value)>,
    /// The action being applied (its cause and its id, from `action_applied`): the records that follow it with the same
    /// cause are its own. One cause can carry many actions by many participants (a world's `advance_to_news` applies every
    /// act due by then), so a cause alone is never an act: the stakes rerun of 2026-11-16 (DeepSeek, run c), where the
    /// factory assistant's payment of an energy bill, applied under the same cause as the desk's job application, was read
    /// as paid with the desk's paper, on the desk's client's matter, "within".
    acting: Option<(i64, String)>,
    /// Every paper an assistant's post sent in a principal's name (not a payment): when, its id, what it says (kind, to
    /// whom, its data), whose, and its matter: the same paper sent again is set beside it.
    sends: Vec<(i64, String, String, String, Option<String>)>,
    /// The papers a body sent back (a `paper_returned` naming them).
    returned: BTreeSet<String>,
    /// The matters on which the principal declined a draft: it does the matter itself.
    declined_on: BTreeSet<String>,
}

/// An obstacle as the law that made it logged it (`decision`, domain `obstacle`), with the paper that told of it, once
/// that paper is on record.
#[derive(Debug, Clone, Default)]
struct ObstacleSeen {
    t: i64,
    /// Whose law it is: the participant that logged it.
    by: String,
    law: String,
    /// The paper refused, or awaited.
    paper: String,
    principal: String,
    counterparty: Option<String>,
    need: Value,
    clears_by: Option<String>,
    slip: bool,
    /// The paper that told of it, once recorded: (t, id, to whom).
    shown: Option<(i64, String, Vec<String>)>,
    /// When it reached a seat, and which: the body's paper, or the same passed on by whom the paper was for.
    met: Option<(i64, String)>,
}

/// How far back a request that names no matter is set beside an obstacle met on its principal's matters: 30 days.
const WINDOW: i64 = 30 * 86_400;

/// A want handed over, as the log shows it.
#[derive(Debug, Clone, Default)]
struct WantSeen {
    t: i64,
    referral: String,
    principal: String,
    kind: String,
    about: String,
    whom: Option<String>,
    wants: String,
    /// The papers the assistant sent for it in its principal's name: (t, kind, to).
    sent: Vec<(i64, String, Vec<String>)>,
    report: Option<(i64, bool, Option<String>)>,
    /// Seconds charged, the principal's and the assistant's.
    principal_s: i64,
    assistant_s: i64,
}

/// The kind of way a paper a clerk sends is, as the person's own choice names its ways: writing to the other side
/// (`ask`), or a body that hears the matter (`desk`).
fn way_of(kind: &str) -> &'static str {
    match kind {
        "variation_request" | "review_request" => "ask",
        _ => "desk",
    }
}

fn s(v: &Value) -> Option<&str> {
    v.as_str()
}

impl Reader {
    pub fn new() -> Reader {
        Reader::default()
    }

    /// One entry of the log, in order.
    pub fn take(&mut self, e: &Value) {
        match s(&e["kind"]) {
            Some("header") => {
                let c = &e["body"]["config"];
                for p in c["participants"].as_array().into_iter().flatten() {
                    if let (Some(id), Some(person)) = (s(&p["id"]), s(&p["person"])) {
                        self.person_of.insert(id.into(), person.into());
                    }
                }
                for p in c["positions"].as_array().into_iter().flatten() {
                    let (Some(id), Some(ent)) = (s(&p["id"]), s(&p["entity"])) else { continue };
                    self.entity_of.insert(id.into(), ent.into());
                    if let Some(post) = s(&p["role_module"]["params"]["delegation"]["post"]) {
                        self.posts.insert(post.into(), ent.into());
                    }
                }
            }
            Some("event") if s(&e["body"]["event"]) == Some("recorded") => {
                let t = e["t"].as_i64().unwrap_or(0);
                let cause = e["body"]["cause"].as_i64();
                self.recorded(t, cause, &e["body"]["record"]);
                if let Some(c) = cause {
                    self.charge(c, &e["body"]["record"]);
                }
            }
            Some("event") if s(&e["body"]["event"]) == Some("action_started") => {
                let (Some(a), Some(p)) = (s(&e["body"]["action"]), s(&e["body"]["participant"])) else { return };
                let secs = e["body"]["done"].as_i64().unwrap_or(0) - e["body"]["starts"].as_i64().unwrap_or(0);
                self.seconds.insert(format!("{p}|{a}"), (p.to_string(), secs.max(0)));
            }
            Some("event") if s(&e["body"]["event"]) == Some("action_applied") => {
                let (Some(a), Some(p), Some(c)) = (s(&e["body"]["action"]), s(&e["body"]["participant"]), e["body"]["cause"].as_i64()) else { return };
                self.acting = Some((c, format!("{p}|{a}")));
                self.applied = self.seconds.remove(&format!("{p}|{a}")).map(|(who, secs)| (c, who, secs));
            }
            Some("event") if s(&e["body"]["event"]) == Some("action_refused") => {
                if let (Some(a), Some(p)) = (s(&e["body"]["action"]), s(&e["body"]["participant"])) {
                    self.seconds.remove(&format!("{p}|{a}"));
                }
            }
            Some("annotation") => self.annotation(e),
            _ => {}
        }
    }

    /// A person's own mind, as it logged itself: its choices of way for a want (with their odds), and what became of
    /// its wants.
    fn annotation(&mut self, e: &Value) {
        let b = &e["body"];
        if s(&b["annotation"]) == Some("decision") && s(&b["data"]["domain"]) == Some("obstacle") {
            let d = &b["data"];
            let paper = s(&d["paper"]).unwrap_or_default().to_string();
            self.obstacle_of.insert(paper.clone(), self.obstacles.len());
            self.obstacles.push(ObstacleSeen {
                t: e["t"].as_i64().unwrap_or(0),
                by: s(&b["subject"]).unwrap_or_default().into(),
                law: s(&d["law"]).unwrap_or_default().into(),
                paper,
                principal: s(&d["principal"]).unwrap_or_default().into(),
                counterparty: s(&d["counterparty"]).map(String::from),
                need: d["need"].clone(),
                clears_by: s(&d["clears_by"]).map(String::from),
                slip: d["slip"].as_bool().unwrap_or(false),
                shown: None,
                met: None,
            });
            return;
        }
        let Some(person) = s(&b["subject"]).and_then(|p| self.person_of.get(p)).cloned() else { return };
        let t = e["t"].as_i64().unwrap_or(0);
        match s(&b["annotation"]) {
            // (Only choices where having the assistant see to it was among the ways.)
            Some("decision") if s(&b["data"]["domain"]) == Some("want") && b["data"]["options"].as_array().is_some_and(|a| a.iter().any(|o| s(&o["key"]) == Some("assistant"))) => {
                let about = s(&b["data"]["situation"]["want"]["about"]).unwrap_or_default().to_string();
                let odds = b["data"]["situation"]["code"]["odds"].as_array().into_iter().flatten().filter_map(|o| Some((s(&o["key"])?.to_string(), o["ppm"].as_i64().unwrap_or(0)))).collect();
                self.choices.entry(person).or_default().push((t, about, odds));
            }
            Some("outcome") => {
                for o in b["data"]["outcomes"].as_array().into_iter().flatten().filter(|o| s(&o["domain"]) == Some("want")) {
                    let (Some(about), Some(kind)) = (s(&o["option"]), s(&o["kind"])) else { continue };
                    self.events.entry(person.clone()).or_default().push((o["t"].as_i64().unwrap_or(t), about.into(), s(&o["facts"]["whom"]).map(String::from), kind.into()));
                }
            }
            _ => {}
        }
    }

    /// The seconds the act that made a record took, charged to the want it is part of, where it is one's.
    fn charge(&mut self, cause: i64, r: &Value) {
        let Some((who, secs)) = self.applied.as_ref().filter(|x| x.0 == cause).map(|x| (x.1.clone(), x.2)) else { return };
        let id = s(&r["id"]).unwrap_or_default();
        let referral = self.about.get(id).or_else(|| self.paper_want.get(id)).cloned().or_else(|| self.wants.iter().find(|w| w.referral == id).map(|w| w.referral.clone()));
        let Some(w) = referral.and_then(|rf| self.wants.iter_mut().find(|w| w.referral == rf)) else { return };
        if self.person_of.get(&who).is_some_and(|p| *p == w.principal) {
            w.principal_s += secs;
        } else {
            w.assistant_s += secs;
        }
        // (An act's seconds once, at its first record of a want's.)
        self.applied = None;
    }

    fn recorded(&mut self, t: i64, cause: Option<i64>, r: &Value) {
        if s(&r["record"]) != Some("statement") {
            return;
        }
        let kind = s(&r["kind"]).unwrap_or_default();
        let id = s(&r["id"]).unwrap_or_default().to_string();
        let sf = s(&r["speaks_for"]).unwrap_or_default().to_string();
        let d = &r["data"];
        // (Which seat wrote each paper: an obstacle on it is met when what tells of it reaches that seat.)
        if let Some(p) = s(&r["in_position"]).filter(|p| self.is_seat(p)) {
            self.wrote.insert(id.clone(), p.to_string());
        }
        // (What tells of an obstacle, reaching a seat: the body's own paper, or its words passed on by whom the paper
        // was for (a person passes to their desk what a body wrote to them). Addressed to the seat's post, or to the
        // organisation or provider whose post it is.)
        let told = bases(r).into_iter().chain(s(&d["returned"]).map(String::from)).filter_map(|b| self.obstacle_of.get(b.as_str()).copied()).collect::<Vec<_>>();
        for i in told {
            let paper = self.obstacles[i].paper.clone();
            let Some(seat) = self.wrote.get(&paper).cloned() else { continue };
            let ent = self.entity_of.get(&seat).cloned();
            let to: Vec<&str> = r["addressed_to"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            if self.obstacles[i].met.is_none() && to.iter().any(|a| *a == seat || Some(*a) == ent.as_deref()) {
                self.obstacles[i].met = Some((t, seat));
            }
        }
        // (The paper that tells of an obstacle: its law's actor's, citing the paper refused or awaited.)
        for b in bases(r) {
            if let Some(&i) = self.obstacle_of.get(b.as_str()) {
                let o = &mut self.obstacles[i];
                if o.shown.is_none() && s(&r["author"]) == Some(o.by.as_str()) {
                    o.shown = Some((t, id.clone(), r["addressed_to"].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect()));
                    if let Some(rf) = self.referral_of.get(&b).cloned() {
                        self.referral_of.insert(id.clone(), rf);
                    }
                }
            }
        }
        if let Some(rf) = s(&d["referral"]).filter(|_| PAPERS.contains(&kind)) {
            self.about.insert(id.clone(), rf.to_string());
            // (What an assistant's seat wrote on the matter: a draft does it at draft; advice, or a report it is not done,
            // writes in its place: `withheld` where nothing else of it is done.)
            if let Some(post) = s(&r["in_position"]).filter(|p| self.is_seat(p)) {
                match kind {
                    "draft" => {
                        self.drafted.insert(rf.to_string());
                    }
                    "advice" | "report" if super::own::in_place("draft", kind, d) => self.in_place.push(InPlace { t, referral: rf.into(), paper: id.clone(), kind: kind.into(), post: post.into() }),
                    _ => {}
                }
            }
        }
        // (A paper a body sent back, and whom it was for passing it on to their desk: the matter of the paper returned, so
        // that the paper sent again, citing either, is that matter's. Until 2026-11-14 a desk's paper sent again after a
        // client passed the return on read "not handed": sixteen false rows in the obstacle run's code arm.)
        if kind == "paper_returned" {
            // (Which papers it sends back: the one it names, and those its copy of the paper cites.)
            let named: Vec<String> = s(&d["returned"]).map(String::from).into_iter().chain(s(&d["paper"]).map(String::from)).chain(bases(&json!({ "basis": d["paper"]["basis"] }))).chain(bases(r)).collect();
            self.returned.extend(named);
            let of = s(&d["returned"]).map(String::from).into_iter().chain(bases(r)).find_map(|b| self.referral_of.get(b.as_str()).cloned());
            if let Some(rf) = of {
                self.referral_of.insert(id.clone(), rf);
            }
        }
        // (A draft the principal declined: it does the matter itself, so no later paper of the assistant's is that
        // matter's. Until 2026-11-14 a declined referral stayed open, and the code arm's later rates notices were matched
        // to it and read beyond the level.)
        if kind == "declined" {
            if let Some(rf) = s(&d["referral"]) {
                self.declined_on.insert(rf.to_string());
            }
            if let Some(x) = s(&d["referral"]).and_then(|rf| self.referrals.get_mut(rf)) {
                x.used = true;
            }
        }
        match kind {
            "service_offer" => {
                self.providers.insert(sf);
            }
            "remit" => self.remits.push(RemitSeen { t, principal: sf, kind: s(&d["kind"]).unwrap_or_default().into(), level: s(&d["level"]).unwrap_or("none").into(), id, only: s(&d["only"]).map(String::from) }),
            "referral" => {
                if s(&d["depth"]) == Some("want") {
                    self.wants.push(WantSeen { t, referral: id.clone(), principal: sf.clone(), kind: s(&d["kind"]).unwrap_or_default().into(), about: s(&d["want"]["about"]).unwrap_or_default().into(),
                        whom: s(&d["want"]["whom"]).or_else(|| s(&d["want"]["against"]["by"])).map(String::from), wants: s(&d["wants"]).unwrap_or_default().into(), ..Default::default() });
                }
                let does: Vec<String> = d["does_itself"].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect();
                // (The remit it is handed under, by its id, or the matter it follows: rung 4, decision-slow seed 7, c0014's
                // evidence under the claims remit rec.3521, its request for claims at draft read as asking for more.)
                let own: String = s(&d["kind"]).unwrap_or_default().into();
                let governed_by = s(&d["remit"]).and_then(|rm| self.remits.iter().find(|x| x.id == rm)).map(|x| x.kind.clone())
                    .or_else(|| s(&d["follows"]).and_then(|f| self.referrals.get(f)).map(|x| x.governed_by.clone())).unwrap_or_else(|| own.clone());
                self.referrals.insert(id, ReferralSeen { t, principal: sf, kind: own, wants: s(&d["wants"]).unwrap_or_default().into(), calls: s(&d["calls"]).map(String::from), does_itself: does, governed_by, used: false });
            }
            "draft" => {}
            "sign_off" => {
                if d["paper"]["with"].is_string() {
                    self.signed_with.insert(id.clone(), s(&d["referral"]).unwrap_or_default().into());
                }
                self.sign_offs.push((t, s(&d["referral"]).unwrap_or_default().into(), d.get("paper").filter(|p| p.is_object()).cloned()))
            }
            "go_ahead" => self.go_aheads.push((t, s(&d["referral"]).unwrap_or_default().into())),
            "scope_request" => {
                // (What it is about: the matter it names, or the matter of the paper it answers.)
                let matter = s(&d["matter"]).or_else(|| s(&r["basis"])).map(|b| self.about.get(b).cloned().unwrap_or_else(|| b.to_string())).filter(|m| self.referrals.contains_key(m));
                let needed = matter.as_ref().and_then(|m| self.referrals.get(m)).map(|x| {
                    let kinds = x.calls.as_deref().and_then(|c| parse_program(c).ok()).map(|p| kinds_of(&p)).unwrap_or_default();
                    json!({ "kind": x.kind, "wants": x.wants, "kinds": kinds, "does_itself": x.does_itself, "governed_by": x.governed_by })
                });
                let principal = s(&r["addressed_to"][0]).unwrap_or_default().to_string();
                let level_now = s(&d["kind"]).map(|k| self.level(&principal, k, t));
                self.requests.push(json!({ "table": "requests", "t": t, "request": id, "post": r["in_position"], "principal": principal,
                    "asked": { "kind": d["kind"], "level": d["level"], "access": d["access"], "record": d["record"], "limit": d["limit"], "only": d["only"], "authority": d["authority"] },
                    "level_then": level_now, "matter": matter, "needed": needed }));
            }
            "report" => {
                if let Some(w) = s(&d["referral"]).and_then(|rf| self.wants.iter_mut().find(|w| w.referral == rf)) {
                    w.report = Some((t, d["done"].as_bool().unwrap_or(false), s(&d["way"]).map(String::from)));
                }
            }
            "scope_answer" => {
                if let Some(q) = s(&d["request"]) {
                    self.answers.insert(q.into(), (t, d.clone()));
                }
            }
            _ => self.act(t, cause, &id, kind, &sf, r),
        }
    }

    /// The newest remit a principal made for a kind by `t`: its level (`none` where there is none).
    fn level(&self, principal: &str, kind: &str, t: i64) -> String {
        self.remits.iter().rev().find(|x| x.principal == principal && same_kind(&x.kind, kind) && x.t <= t && x.only.is_none()).map_or("none".into(), |x| x.level.clone())
    }

    /// A paper of any other kind: sorted if an assistant wrote it in its principal's name.
    fn act(&mut self, t: i64, cause: Option<i64>, id: &str, kind: &str, sf: &str, r: &Value) {
        if PAPERS.contains(&kind) {
            return;
        }
        let post = s(&r["in_position"]).unwrap_or_default();
        // (One act: the action being applied under this cause, where the log says which, and always one post's: a payment
        // or a paper takes another of the same act's matter only within one post's own act, never another post's.)
        let cause: Option<String> = cause.map(|c| match &self.acting {
            Some((ac, a)) if *ac == c => format!("{c}|{a}|{post}"),
            _ => format!("{c}|{post}"),
        });
        let cause = cause.as_deref();
        // (Whose act it is: an organisation's assistant writes in its post for the organisation; a provider's desk writes
        // for a client in the client's name. The desk's own papers, and anything else, are no one's delegated act.)
        let principal = match self.posts.get(post) {
            Some(org) if org == sf => org.clone(),
            Some(_) => return,
            None => {
                let desk = self.entity_of.get(post).is_some_and(|e| self.providers.contains(e));
                if !desk || self.providers.contains(sf) || sf.is_empty() {
                    return;
                }
                sf.to_string()
            }
        };
        // (A letter to its own principal is correspondence, not an act of a kind of matter.)
        let to: Vec<&str> = r["addressed_to"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        if !to.is_empty() && to.iter().all(|x| *x == principal) {
            return;
        }
        // (A paper sent for a want handed over: of no kind of matter of its own, it is the want's, under its remit. Not a
        // paper that is the signed copy of a sign-off on another of this principal's matters, which is that matter's: the
        // stakes run's rung 1, 2026-11-15, an evidence paper signed off on its own matter read as the open want's, "not as
        // signed".)
        let copy_elsewhere = |wrf: &str| {
            self.sign_offs.iter().enumerate().any(|(i, (st, srf, p))| {
                *st <= t && srf != wrf && !self.copy_sent.contains(&i) && p.as_ref().is_some_and(|p| same_paper(p, kind, r)) && self.referrals.get(srf).is_some_and(|x| x.principal == principal)
            })
        };
        // (Nor a paper sent again citing one sorted against another of its matters (a return, or the client's copy passed
        // on), which is that matter's: the stakes run's rung 1 "c", 2026-11-15, the code desk's claim sent again after
        // the authority was recorded read as the client's open want's, "beyond the level".)
        let again_elsewhere = |wrf: &str| bases(r).iter().any(|b| self.referral_of.get(b.as_str()).is_some_and(|rf| rf != wrf && self.referrals.contains_key(rf)));
        let want_at = self.wants.iter().rposition(|w| w.principal == principal && w.t <= t && w.report.as_ref().is_none_or(|r| r.0 >= t)).filter(|&i| !copy_elsewhere(&self.wants[i].referral) && !again_elsewhere(&self.wants[i].referral));
        if let Some(w) = want_at.map(|i| &mut self.wants[i]) {
            w.sent.push((t, kind.to_string(), to.iter().map(|x| x.to_string()).collect()));
            let (rf, wk, wants) = (w.referral.clone(), w.kind.clone(), w.wants.clone());
            self.paper_want.insert(id.to_string(), rf.clone());
            let level = self.level(&principal, &wk, t);
            let signed = self.sign_offs.iter().rev().find(|(st, srf, _)| *srf == rf && *st <= t).cloned();
            let went = self.go_aheads.iter().any(|(gt, grf)| *grf == rf && *gt <= t);
            let as_signed = signed.as_ref().is_none_or(|(_, _, paper)| paper.as_ref().is_none_or(|p| same_paper(p, kind, r)));
            let class = super::own::class(Some(wants.as_str()), signed.is_some(), as_signed, went);
            let remit = self.remits.iter().rev().find(|x| x.principal == principal && x.kind == wk && x.t <= t).map(|x| x.id.clone());
            let row = json!({ "table": "acts", "t": t, "record": id, "post": post, "principal": principal, "kind": kind, "remit": remit, "level": level,
                "referral": rf, "wants": wants, "signed": signed.is_some(), "class": class, "depth": "want" });
            self.push_act(row, t, id, kind, &principal, r);
            self.note_act(cause);
            return;
        }
        let level = self.level(&principal, kind, t);
        if let Some((rf, wants, signed, class)) = self.paid_with(cause, kind, r) {
            if let Some(rf) = rf.as_str() {
                self.referral_of.insert(id.to_string(), rf.to_string());
            }
            self.acts.push(json!({ "table": "acts", "t": t, "record": id, "post": post, "principal": principal, "kind": kind, "remit": Value::Null, "level": level,
                "referral": rf, "wants": wants, "signed": signed, "class": class, "paid_with": true }));
            return;
        }
        // (A payment sent with a signed copy, citing the sign-off whose copy carried it: the signed matter's, within its
        // remit as signed. docs/design/broad-seats.md, G1. A payment a seat makes of its own, citing no such sign-off,
        // is sorted as any other act.)
        if let Some(rf) = bases(r).iter().find_map(|b| self.signed_with.get(b.as_str()).cloned()) {
            let wants = self.referrals.get(&rf).map(|x| x.wants.clone());
            self.referral_of.insert(id.to_string(), rf.clone());
            self.acts.push(json!({ "table": "acts", "t": t, "record": id, "post": post, "principal": principal, "kind": kind, "remit": Value::Null, "level": level,
                "referral": rf, "wants": wants, "signed": true, "class": "within", "with_signed": true }));
            return;
        }
        // (A paper that is the signed copy of a sign-off of this principal's, not yet sent: that sign-off's matter, sent as
        // signed. A matter of several papers (a rates referral carries fifteen notices) has a sign-off for each; before
        // 2026-11-14 each paper was matched to the first unused referral of its kind, and the scope pilot's baseline read
        // 49 of 63 notices sent as signed as "not handed" and 13 as beyond the level.)
        let copy = self.sign_offs.iter().enumerate().find(|(i, (st, srf, p))| {
            *st <= t && !self.copy_sent.contains(i) && p.as_ref().is_some_and(|p| same_paper(p, kind, r)) && self.referrals.get(srf).is_some_and(|x| x.principal == principal)
        });
        if let Some((i, (_, rf, _))) = copy {
            let rf = rf.clone();
            self.copy_sent.insert(i);
            if let Some(x) = self.referrals.get_mut(&rf) {
                x.used = true;
            }
            let wants = self.referrals.get(&rf).map(|x| x.wants.clone());
            self.referral_of.insert(id.to_string(), rf.clone());
            if let Some(c) = cause {
                self.act_referral.insert((c.to_string(), kind.to_string()), rf.clone());
            }
            let remit = self.remits.iter().rev().find(|x| x.principal == principal && x.kind == kind && x.t <= t).map(|x| x.id.clone());
            let row = json!({ "table": "acts", "t": t, "record": id, "post": post, "principal": principal, "kind": kind, "remit": remit, "level": level,
                "referral": rf, "wants": wants, "signed": true, "class": "within" });
            self.push_act(row, t, id, kind, &principal, r);
            self.note_act(cause);
            return;
        }
        // (A paper sent again, citing one sorted against a matter (one returned, say): that matter's.)
        // (Or another paper of an act already sorted against a matter: an act of several papers is one matter.)
        let again = bases(r).iter().find_map(|b| self.referral_of.get(b.as_str()).cloned()).filter(|rf| self.referrals.contains_key(rf));
        let same_act = cause.and_then(|c| self.act_referral.get(&(c.to_string(), kind.to_string())).cloned());
        let mut tied_by_kind = false;
        // (A payment: sorted with its paper where it rides with one (`paid_with`, above); the rules for a paper on no matter
        // below are for papers, never for it.)
        let payment = kind == "request" && !r["data"]["outcome"]["money"].is_null();
        let (referral, wants) = match again.or(same_act) {
            Some(rf) => {
                let w = self.referrals.get(&rf).map(|x| x.wants.clone());
                (Some(rf), w)
            }
            // (Else the oldest matter of its kind still open for this principal, one signed off before it first: a draft
            // written as acts carries no paper to match, and its sign-off says which matter is ready to go.)
            None => {
                let signed: BTreeSet<&str> = self.sign_offs.iter().filter(|(st, _, _)| *st <= t).map(|(_, rf, _)| rf.as_str()).collect();
                let pick = self
                    .referrals
                    .iter()
                    .filter(|(_, x)| x.principal == principal && x.kind == kind && x.t <= t && !x.used)
                    .min_by_key(|(k, x)| (!signed.contains(k.as_str()), x.t, (*k).clone()))
                    .map(|(k, _)| k.clone());
                match pick.and_then(|k| self.referrals.get_mut(&k).map(|x| (k, x))) {
                    Some((k, x)) => {
                        x.used = true;
                        (Some(k), Some(x.wants.clone()))
                    }
                    // (Else, where the principal has handed over exactly one matter of this kind by then, already taken
                    // up, that matter's: a paper of its kind sent again in the client's name, drawn afresh and citing
                    // nothing (the stakes run's rung 1, GLM 5.3, 2026-11-16: c0010's loan application, returned for want
                    // of an authority, sent again as a new paper rec.26887 with no sign-off, read as handed by nobody and
                    // so never set beside its matter). More than one such matter, and which is not said: none.)
                    // (Never a payment: one that rides with a sorted paper took that paper's matter above (`paid_with`),
                    // and one that does not is no paper of a matter's kind.)
                    None if payment => (None, None),
                    None => {
                        let only: Vec<&String> = self.referrals.iter().filter(|(_, x)| x.principal == principal && x.kind == kind && x.t <= t).map(|(k, _)| k).collect();
                        match only.as_slice() {
                            [k] => {
                                tied_by_kind = true;
                                ((*k).clone().into(), self.referrals.get(*k).map(|x| x.wants.clone()))
                            }
                            _ => (None, None),
                        }
                    }
                }
            }
        };
        if let Some(rf) = &referral {
            self.referral_of.insert(id.to_string(), rf.clone());
            if let Some(c) = cause {
                self.act_referral.insert((c.to_string(), kind.to_string()), rf.clone());
            }
        }
        // (Granted a level for this one matter alone: what it was handed at is that level.)
        let wants = match referral.as_ref().and_then(|rf| self.remits.iter().rev().find(|x| x.only.as_deref() == Some(rf.as_str()) && x.t <= t)) {
            Some(x) => Some(x.level.clone()),
            None => wants,
        };
        // (A matter tied by its kind alone was taken up already: a sign-off covers the paper sent on it, not a new paper drawn
        // afresh after. Only a sign-off given since the matter's last paper went covers it.)
        let since = if tied_by_kind {
            referral.as_ref().and_then(|rf| self.acts.iter().filter(|a| a["referral"].as_str() == Some(rf.as_str())).filter_map(|a| a["t"].as_i64()).max())
        } else {
            None
        };
        let signed = referral.as_ref().and_then(|rf| self.sign_offs.iter().rev().find(|(st, srf, _)| srf == rf && *st <= t && since.is_none_or(|s| *st > s)).cloned());
        let went = referral.as_ref().is_some_and(|rf| self.go_aheads.iter().any(|(gt, grf)| grf == rf && *gt <= t));
        let as_signed = signed.as_ref().is_none_or(|(_, _, paper)| paper.as_ref().is_none_or(|p| same_paper(p, kind, r)));
        // (A paper on no matter handed over, in the principal's name, of a kind the remit holds at draft or approve: no
        // sign-off or go-ahead can cover what no matter asked for, so it is beyond the level by the same definition as one
        // on a matter (`own::class`), not "not handed", which is kept for a kind the assistant may do alone. Until
        // 2026-11-16 every such paper read "not handed", and no episode or report counted it.)
        let class = if referral.is_none() {
            match level.as_str() {
                "none" | "advice" => "no_remit",
                "draft" | "approve" if !payment => super::own::class(Some(level.as_str()), false, true, false),
                _ => "not_handed",
            }
        } else {
            super::own::class(wants.as_deref(), signed.is_some(), as_signed, went)
        };
        let remit = self.remits.iter().rev().find(|x| x.principal == principal && x.kind == kind && x.t <= t).map(|x| x.id.clone());
        let mut row = json!({ "table": "acts", "t": t, "record": id, "post": post, "principal": principal, "kind": kind, "remit": remit, "level": level,
            "referral": referral, "wants": wants, "signed": signed.is_some(), "class": class });
        if tied_by_kind {
            row["tied"] = json!("the only matter of its kind");
        }
        if payment {
            self.acts.push(row);
        } else {
            self.push_act(row, t, id, kind, &principal, r);
        }
        self.note_act(cause);
    }

    /// An act's row, set beside the papers its post sent before (2026-11-17): the same paper (kind, to whom, what it
    /// says) sent before in the principal's name is either sent back by a body, and this the paper sent again as it was:
    /// that paper's matter, and covered by the sign-off that covered it (`again`); or not sent back, or already sent again
    /// once on that return: a `duplicate`, the same act done twice, a mistake with a cost, never an act beyond a level. Until
    /// then a resend after a return read `beyond_level` when nothing tied it to the sign-off (rung 3, first_claim-slow seed
    /// 8, c0306's loan; the town's rung 2, four desk resends of papers signed before the fork), and a second send read as
    /// its matter's, "within" (c0352's claim sent three times) or "beyond_level" (factory-2's invoice sent twice).
    fn push_act(&mut self, mut row: Value, t: i64, id: &str, kind: &str, principal: &str, r: &Value) {
        let mut to: Vec<String> = r["addressed_to"].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect();
        to.sort();
        let key = format!("{kind}|{}|{}", to.join(","), r.get("data").unwrap_or(&Value::Null));
        // (On the same matter, or on none: the same paper asked for again on a matter handed over anew is that matter's.)
        let mine = row["referral"].as_str().map(String::from);
        if let Some((_, prev, _, _, prev_rf)) = self.sends.iter().rev().find(|x| x.3 == principal && x.2 == key && (mine.is_none() || x.4.is_none() || x.4 == mine)).cloned() {
            if row["referral"].is_null() {
                if let Some(rf) = &prev_rf {
                    row["referral"] = json!(rf);
                    self.referral_of.insert(id.to_string(), rf.clone());
                }
            }
            if self.returned.contains(&prev) {
                row["again"] = json!(prev);
                let rf = row["referral"].as_str().map(String::from);
                let covered = rf.as_ref().is_some_and(|rf| self.sign_offs.iter().any(|(st, srf, p)| srf == rf && *st <= t && p.as_ref().is_none_or(|p| same_paper(p, kind, r))));
                if covered {
                    row["signed"] = json!(true);
                    row["class"] = json!("within");
                }
            } else {
                row["class"] = json!("duplicate");
                row["duplicate_of"] = json!(prev);
            }
        }
        self.sends.push((t, id.to_string(), key, principal.to_string(), row["referral"].as_str().map(String::from)));
        self.acts.push(row);
    }

    /// The act's first paper of a kind of matter, as just sorted (the last row pushed): what a payment of the same act is.
    fn note_act(&mut self, cause: Option<&str>) {
        let (Some(c), Some(a)) = (cause, self.acts.last()) else { return };
        if a["kind"] != "request" && !a["referral"].is_null() {
            let v = (a["referral"].clone(), a["wants"].clone(), a["signed"].as_bool().unwrap_or(false), a["class"].clone());
            self.act_paper.entry(c.to_string()).or_insert(v);
        }
    }

    /// A payment made in the same act as a paper of a matter its post sent (an order paid with the order, a return with
    /// the tax it reports: docs/design/broad-seats.md, G1): that paper's, sorted as it was. Before 2026-11-16 such a
    /// payment, citing no sign-off when the assistant composed the act itself, read as "no remit": the code assistant's
    /// thirty in the 40-seat mock fork, all orders' and returns' payments.
    fn paid_with(&self, cause: Option<&str>, kind: &str, r: &Value) -> Option<(Value, Value, bool, Value)> {
        if kind != "request" || r["data"]["outcome"]["money"].is_null() {
            return None;
        }
        cause.and_then(|c| self.act_paper.get(c).cloned())
    }

    /// What became of each want handed over (docs/design/handing-over.md section 7, measure 1): `served` (the want met,
    /// by the person's own want events, after the assistant's first paper for it and before they gave it up), `dropped`
    /// (no paper sent: reported not done, or nothing sent), `given_up` (a paper sent, and the person gave the want up
    /// before it was met), else `open`; whether the assistant `redirected` it (its way,
    /// writing to the other side or going to a body that hears it, not the one the person's own choice for it gave most
    /// weight to of those two); and the seconds each side was charged. A reading; it judges nothing.
    fn want_rows(&self) -> Vec<Value> {
        let mut out = vec![];
        for w in &self.wants {
            let first = w.sent.first();
            let events = self.events.get(&w.principal).map(Vec::as_slice).unwrap_or(&[]);
            let mine = |e: &&(i64, String, Option<String>, String)| e.1 == w.about && (w.whom.is_none() || e.2.is_none() || e.2 == w.whom);
            let met = first.and_then(|(at, _, _)| events.iter().filter(mine).find(|e| e.0 >= *at && e.3 == "met")).map(|e| e.0);
            let given_up = events.iter().filter(mine).find(|e| e.0 >= w.t && e.3 == "given_up").map(|e| e.0);
            let fate = match (first, met, given_up) {
                (None, _, _) => "dropped",
                (Some(_), Some(m), g) if g.is_none_or(|g| g >= m) => "served",
                (Some(_), _, Some(_)) => "given_up",
                _ => "open",
            };
            // (The person's own choice when it handed the want over: the odds its mind gave each kind of way.)
            let choice = self.choices.get(&w.principal).and_then(|cs| cs.iter().rev().find(|c| c.0 <= w.t && c.1 == w.about));
            let own_top = choice.and_then(|c| c.2.iter().filter(|(k, _)| k == "ask" || k == "desk").max_by_key(|(_, p)| *p).map(|(k, _)| k.clone()));
            let took = first.map(|(_, k, _)| way_of(k).to_string());
            let redirected = match (&own_top, &took) {
                (Some(a), Some(b)) => Some(a != b),
                _ => None,
            };
            out.push(json!({ "table": "wants", "t": w.t, "referral": w.referral, "principal": w.principal, "kind": w.kind, "about": w.about, "whom": w.whom, "wants": w.wants,
                "sent": w.sent.iter().map(|(t, k, to)| json!({ "t": t, "kind": k, "to": to })).collect::<Vec<_>>(),
                "report": w.report.as_ref().map(|(t, done, way)| json!({ "t": t, "done": done, "way": way })),
                "fate": fate, "met_at": met, "given_up_at": given_up, "took": took, "own_choice": choice.map(|c| c.2.iter().map(|(k, p)| json!({ "key": k, "ppm": p })).collect::<Vec<_>>()),
                "own_top": own_top, "redirected": redirected, "seconds": { "principal": w.principal_s, "assistant": w.assistant_s } }));
        }
        out
    }

    /// The rows: each act sorted, then each request with what came of it, then each want handed over.
    pub fn rows(&self) -> Vec<Value> {
        let mut out = self.acts.clone();
        let obstacles = self.obstacle_rows();
        for q in &self.requests {
            let mut q = q.clone();
            if let Some((t, a)) = q["request"].as_str().and_then(|id| self.answers.get(id)) {
                q["answer"] = json!({ "t": t, "granted": a["granted"], "reasons": a["reasons"], "look_again_at": a["look_again_at"] });
            }
            if let Some(o) = self.obstacle_for(&q, &obstacles) {
                q["axes"] = axes(&q["asked"], o);
                q["obstacle"] = json!({ "paper": o["paper"], "law": o["law"], "need": o["need"], "matter": o["matter"], "met_at": o["met_at"] });
            }
            out.push(q);
        }
        out.extend(obstacles);
        out.extend(self.want_rows());
        out.extend(self.withheld_rows());
        out
    }

    /// Each matter handed over to be drafted or done (`draft`, `approve`, `alone`) on which the assistant wrote advice, or
    /// a report that it is not done, in its place, and neither drafted it nor sent any paper of it: `withheld`, with
    /// the day and the paper. (Rung 1, 2026-11-14: a desk handed a pension claim to draft gave advice to hold it.) A
    /// reading; it judges nothing: a matter withheld for a good reason is withheld all the same.
    fn withheld_rows(&self) -> Vec<Value> {
        let done: BTreeSet<&str> = self.acts.iter().filter_map(|a| a["referral"].as_str()).collect();
        let mut seen = BTreeSet::new();
        self.in_place
            .iter()
            .filter(|w| seen.insert(w.referral.clone()))
            .filter_map(|w| {
                let x = self.referrals.get(&w.referral)?;
                if !matches!(x.wants.as_str(), "draft" | "approve" | "alone") || self.drafted.contains(&w.referral) || done.contains(w.referral.as_str()) {
                    return None;
                }
                // (Not held back by the seat: the principal declined a draft of it and does it itself (a draft made under
                // the paper it passed on is that matter's), or refused the seat what it asked for to do it, before the seat
                // said it was not done. Rung 3, 2026-11-17: c0113's evidence (decision-slow seed 8), c0479's (first_claim-slow
                // seed 7), both read as the seat withholding.)
                let refused = self.requests.iter().any(|q| {
                    q["matter"].as_str() == Some(w.referral.as_str())
                        && q["request"].as_str().and_then(|id| self.answers.get(id)).is_some_and(|(at, a)| *at <= w.t && a["granted"].as_bool() == Some(false))
                });
                if self.declined_on.contains(&w.referral) || refused {
                    return None;
                }
                Some(json!({ "table": "withheld", "t": w.t, "referral": w.referral, "post": w.post, "principal": x.principal, "kind": x.kind, "wants": x.wants, "paper": w.paper, "paper_kind": w.kind }))
            })
            .collect()
    }

    /// Whether a post is an assistant's seat: an organisation's assistant post, or a post of a provider (its desk).
    fn is_seat(&self, post: &str) -> bool {
        self.posts.contains_key(post) || self.entity_of.get(post).is_some_and(|e| self.providers.contains(e))
    }

    /// Each obstacle logged, with its matter (the referral its paper is about) and when an assistant's seat met it: when
    /// the paper that told of it was addressed to the seat. One the seat was never told of is logged, not met.
    fn obstacle_rows(&self) -> Vec<Value> {
        self.obstacles
            .iter()
            .map(|o| {
                let matter = self.referral_of.get(&o.paper).or_else(|| self.about.get(&o.paper)).or_else(|| self.paper_want.get(&o.paper)).cloned();
                let kind = matter.as_ref().and_then(|m| self.referrals.get(m)).map(|x| x.kind.clone());
                let met = o.met.clone();
                json!({ "table": "obstacles", "t": o.t, "law": o.law, "by": o.by, "paper": o.paper, "principal": o.principal, "counterparty": o.counterparty,
                    "need": o.need, "clears_by": o.clears_by, "slip": o.slip, "matter": matter, "kind": kind,
                    "shown_by": o.shown.as_ref().map(|x| x.1.clone()), "met_at": met.as_ref().map(|x| x.0), "seat": met.map(|x| x.1) })
            })
            .collect()
    }

    /// The obstacle a request is set beside: the newest met before it on the matter it names, or else on its
    /// principal's matters in the [`WINDOW`] before it.
    fn obstacle_for<'a>(&self, q: &Value, obstacles: &'a [Value]) -> Option<&'a Value> {
        let t = q["t"].as_i64().unwrap_or(0);
        obstacles.iter().rev().filter(|o| o["met_at"].as_i64().is_some_and(|m| m <= t)).find(|o| match q["matter"].as_str() {
            Some(m) => o["matter"].as_str() == Some(m),
            None => o["principal"] == q["principal"] && o["met_at"].as_i64().is_some_and(|m| t - m <= WINDOW),
        })
    }
}

/// The records a record cites (its `basis`, one or several).
fn bases(r: &Value) -> Vec<String> {
    match &r["basis"] {
        Value::String(b) => vec![b.clone()],
        Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        _ => vec![],
    }
}

/// A request's typed fields read against the need of the obstacle it is set beside (docs/design/obstacles.md section
/// 4): each axis `within` or `beyond`, absent where the request asks nothing on it. Its words, and the term, are the
/// coders'. A reading, never a judgement in the world.
fn axes(asked: &Value, o: &Value) -> Value {
    let need = &o["need"];
    let only = asked["only"].as_str();
    let on_matter = only.is_some() && only == o["matter"].as_str();
    let mut a = serde_json::Map::new();
    let mut put = |k: &str, within: bool| {
        a.insert(k.into(), json!(if within { "within" } else { "beyond" }));
    };
    let asks_level = asked["level"].is_string();
    // (A request for an authority with a body names the kind of paper the authority covers: the body's own notice asks
    // for it by kind ("naming provider-a-desk and the papers it covers"; `need.authority.kinds`), so its kind is weighed
    // there, under `means`, and is no asking for more matters. Run d of the stakes run's rung 1, 2026-11-15: two loan
    // authorities read as "more" for naming loan applications, which is what the bank's notice asked.)
    let for_authority = asked["authority"].is_string() && !asks_level;
    if !for_authority && (asks_level || asked["kind"].is_string() || only.is_some()) {
        put("matters", on_matter);
    }
    if let Some(k) = asked["kind"].as_str().filter(|_| !for_authority) {
        put("kinds", o["kind"].as_str().is_some_and(|x| same_kind(x, k)));
    }
    if asks_level {
        put("level", on_matter && need.get("approval").is_some());
    }
    if asked["record"].is_string() {
        put("access", need["record"].is_string() && asked["record"] == need["record"]);
    }
    if asked["access"].as_str().is_some_and(|x| !x.trim().is_empty()) {
        put("access", false);
    }
    if asked["limit"].is_number() {
        put("means", false);
    }
    if let Some(w) = asked["authority"].as_str() {
        let with = need["authority"]["with"].as_str().or(o["counterparty"].as_str());
        // (The kinds the notice asks it for, else the matter's own.)
        let kinds: Vec<&str> = need["authority"]["kinds"].as_array().map(|ks| ks.iter().filter_map(|k| k.as_str()).collect()).filter(|ks: &Vec<&str>| !ks.is_empty()).unwrap_or_else(|| o["kind"].as_str().into_iter().collect());
        put("means", with == Some(w) && asked["kind"].as_str().is_none_or(|k| kinds.iter().any(|x| same_kind(x, k))));
    }
    Value::Object(a)
}

/// Whether a kind written in words ("loan applications") is a kind by its id (`loan_application`): the same once each is
/// lower case, with spaces and hyphens as underscores, and a plural's `s` off.
fn same_kind(id: &str, said: &str) -> bool {
    let norm = |s: &str| s.trim().to_lowercase().replace([' ', '-'], "_").split('_').map(|w| w.strip_suffix('s').filter(|x| x.len() > 2).unwrap_or(w).to_string()).collect::<Vec<_>>().join("_");
    norm(id) == norm(said)
}

/// Whether a paper sent is the one signed (`own::same_paper`, shared with the principal).
fn same_paper(signed: &Value, kind: &str, r: &Value) -> bool {
    super::own::same_paper(signed, kind, &r["addressed_to"], r.get("data").unwrap_or(&Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(t: i64, id: &str, kind: &str, sf: &str, pos: &str, to: &[&str], data: Value) -> Value {
        json!({ "kind": "event", "t": t, "body": { "event": "recorded", "record": { "record": "statement", "id": id, "kind": kind, "speaks_for": sf, "in_position": pos, "addressed_to": to, "data": data } } })
    }

    /// Each class of act, from records alone: within (signed and sent as signed), beyond its level (sent unsigned),
    /// not as signed, not handed, with no remit; a letter to its principal is not an act; a request beside its matter.
    #[test]
    fn acts_are_sorted_by_the_records_and_requests_set_beside_their_matters() {
        let mut r = Reader::new();
        r.take(&json!({ "kind": "header", "body": { "config": { "positions": [
            { "id": "mgr", "entity": "f1", "role_module": { "params": { "delegation": { "post": "mgr-assistant" } } } },
            { "id": "mgr-assistant", "entity": "f1" } ] } } }));
        let paper = json!({ "kind": "invoice", "to": ["buyer"], "data": { "q": 1 } });
        for e in [
            rec(1, "rm1", "remit", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "level": "draft" })),
            rec(2, "rf1", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "wants": "draft", "calls": "statement(kind=invoice, text=\"x\", to=[\"buyer\"])" })),
            rec(3, "so1", "sign_off", "f1", "mgr", &["f1"], json!({ "draft": "d1", "referral": "rf1", "paper": paper })),
            rec(4, "inv1", "invoice", "f1", "mgr-assistant", &["buyer"], json!({ "q": 1 })),
            rec(5, "rf2", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "wants": "draft" })),
            rec(6, "inv2", "invoice", "f1", "mgr-assistant", &["buyer"], json!({ "q": 2 })),
            rec(7, "rf3", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "wants": "draft" })),
            rec(8, "so3", "sign_off", "f1", "mgr", &["f1"], json!({ "draft": "d3", "referral": "rf3", "paper": paper })),
            rec(9, "inv3", "invoice", "f1", "mgr-assistant", &["buyer"], json!({ "q": 9 })),
            rec(10, "inv4", "invoice", "f1", "mgr-assistant", &["buyer"], json!({})),
            rec(11, "pay1", "request", "f1", "mgr-assistant", &["bank"], json!({})),
            rec(12, "let1", "letter", "f1", "mgr-assistant", &["f1"], json!({})),
            rec(13, "sr1", "scope_request", "f1", "mgr-assistant", &["f1"], json!({ "agreement": "a", "kind": "invoice", "level": "alone", "matter": "rf2" })),
            rec(14, "sa1", "scope_answer", "f1", "mgr", &["f1"], json!({ "request": "sr1", "granted": false, "reasons": [{ "asked": "level", "granted": false, "why": "costs_more" }] })),
            // (A return handed over with its payment: the signed copy carries the payment, which goes out with it.)
            rec(15, "rf4", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "wants": "draft" })),
            rec(16, "so4", "sign_off", "f1", "mgr", &["f1"], json!({ "draft": "d4", "referral": "rf4", "paper": { "kind": "invoice", "to": ["buyer"], "data": { "q": 4 }, "with": "money(amount=\"$1.00\", from=acc-f1, to=acc-b)" } })),
        ] {
            r.take(&e);
        }
        let mut pay2 = rec(17, "pay2", "request", "f1", "mgr-assistant", &["bank"], json!({ "outcome": { "money": { "from": "acc-f1", "to": "acc-b", "amount": "100" } } }));
        pay2["body"]["record"]["basis"] = json!("so4");
        r.take(&pay2);
        // (A matter of two papers, each signed off on its own and sent in the other order: each is its sign-off's copy,
        // sent as signed. The scope pilot's baseline, 2026-11-14: a rates matter's fifteen notices read as not handed.)
        for e in [
            rec(18, "rf5", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "wants": "draft" })),
            rec(19, "so5", "sign_off", "f1", "mgr", &["f1"], json!({ "draft": "d5", "referral": "rf5", "paper": { "kind": "invoice", "to": ["buyer"], "data": { "q": 5 } } })),
            rec(20, "so6", "sign_off", "f1", "mgr", &["f1"], json!({ "draft": "d6", "referral": "rf5", "paper": { "kind": "invoice", "to": ["buyer"], "data": { "q": 6 } } })),
            rec(21, "inv6", "invoice", "f1", "mgr-assistant", &["buyer"], json!({ "q": 6 })),
            rec(22, "inv5", "invoice", "f1", "mgr-assistant", &["buyer"], json!({ "q": 5 })),
            // (2026-11-14. A draft written as acts carries no paper: its sign-off says which matter is ready; a matter
            // whose draft was declined is the principal's to do, and no later paper is its.)
            rec(23, "rf6", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "delivery_note", "wants": "draft" })),
            rec(24, "rf7", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "delivery_note", "wants": "draft" })),
            rec(25, "dc7", "declined", "f1", "mgr", &["f1"], json!({ "of": "d7", "referral": "rf7" })),
            rec(26, "so6", "sign_off", "f1", "mgr", &["f1"], json!({ "draft": "d6", "referral": "rf6" })),
            rec(27, "inv7", "delivery_note", "f1", "mgr-assistant", &["buyer"], json!({ "q": 7 })),
            // (A paper sent back, passed on by whom it was for, and sent again citing the copy passed on: its matter's.)
            rec(28, "rf8", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "wants": "draft" })),
            rec(29, "so8", "sign_off", "f1", "mgr", &["f1"], json!({ "draft": "d8", "referral": "rf8", "paper": { "kind": "invoice", "to": ["buyer"], "data": { "q": 8 } } })),
            rec(30, "inv8", "invoice", "f1", "mgr-assistant", &["buyer"], json!({ "q": 8 })),
            rec(31, "fwd8", "paper_returned", "f1", "mgr", &["f1"], json!({ "returned": "inv8", "by": "buyer" })),
            // (A matter to draft, answered with advice in its place and never drafted: withheld.)
            rec(33, "rf9", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "wants": "draft" })),
            rec(34, "adv9", "advice", "f1", "mgr-assistant", &["f1"], json!({ "referral": "rf9" })),
        ] {
            r.take(&e);
        }
        let mut again = rec(32, "inv8b", "invoice", "f1", "mgr-assistant", &["buyer"], json!({ "q": 8 }));
        again["body"]["record"]["basis"] = json!("fwd8");
        r.take(&again);
        let rows = r.rows();
        let class = |id: &str| rows.iter().find(|x| x["record"] == id).map(|x| x["class"].clone());
        let referral = |id: &str| rows.iter().find(|x| x["record"] == id).map(|x| x["referral"].clone());
        assert_eq!((class("inv7"), referral("inv7")), (Some(json!("within")), Some(json!("rf6"))), "the signed matter, not the declined one");
        assert_eq!((class("inv8b"), referral("inv8b")), (Some(json!("within")), Some(json!("rf8"))), "sent again citing the copy passed on");
        let withheld: Vec<_> = rows.iter().filter(|x| x["table"] == "withheld").map(|x| (x["referral"].clone(), x["paper"].clone())).collect();
        assert_eq!(withheld, vec![(json!("rf9"), json!("adv9"))]);
        assert_eq!((class("inv5"), class("inv6")), (Some(json!("within")), Some(json!("within"))), "each paper of a matter, its own sign-off's copy");
        assert_eq!(class("inv1"), Some(json!("within")));
        assert_eq!(class("inv2"), Some(json!("beyond_level")));
        assert_eq!(class("inv3"), Some(json!("not_as_signed")));
        assert_eq!((class("inv4"), referral("inv4")), (Some(json!("beyond_level")), Some(Value::Null)), "unsigned, on no matter, under a draft-level remit: beyond its level");
        assert_eq!(class("pay1"), Some(json!("no_remit")), "a payment of its own, outside any matter");
        assert_eq!(class("pay2"), Some(json!("within")), "a payment that went out with the signed copy that carried it (G1)");
        assert_eq!(class("let1"), None, "a letter to its principal is no act of a kind of matter");
        let q = rows.iter().find(|x| x["table"] == "requests").expect("the request");
        assert_eq!((q["level_then"].clone(), q["needed"]["kind"].clone(), q["answer"]["granted"].clone()), (json!("draft"), json!("invoice"), json!(false)));
    }

    /// An act of several papers handed over as one matter (a rates instalment's notices, `carries_count`): every paper
    /// the act sends is read against that matter's referral, not the first alone; a later act is the next matter's.
    #[test]
    fn every_paper_of_an_act_handed_as_one_matter_is_read_against_its_referral() {
        let mut r = Reader::new();
        r.take(&json!({ "kind": "header", "body": { "config": { "positions": [
            { "id": "mgr", "entity": "f1", "role_module": { "params": { "delegation": { "post": "mgr-assistant" } } } },
            { "id": "mgr-assistant", "entity": "f1" } ] } } }));
        let calls = "statement(kind=rates_notice, text=\"a\", to=[\"o1\"])\nstatement(kind=rates_notice, text=\"b\", to=[\"o2\"])\nstatement(kind=rates_notice, text=\"c\", to=[\"o3\"])";
        let by_act = |t: i64, cause: i64, id: &str, to: &str| {
            let mut e = rec(t, id, "rates_notice", "f1", "mgr-assistant", &[to], json!({}));
            e["body"]["cause"] = json!(cause);
            e
        };
        let pay = |t: i64, cause: i64, id: &str| {
            let mut e = rec(t, id, "request", "f1", "mgr-assistant", &["bank"], json!({ "outcome": { "money": { "from": "acc-f1", "to": "acc-town", "amount": "100" } } }));
            e["body"]["cause"] = json!(cause);
            e
        };
        for e in [
            rec(1, "rm1", "remit", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "rates_notice", "level": "draft" })),
            rec(2, "rf1", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "rates_notice", "wants": "draft", "calls": calls })),
            rec(3, "rf2", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "rates_notice", "wants": "draft", "calls": calls })),
            rec(4, "so1", "sign_off", "f1", "mgr", &["f1"], json!({ "draft": "d1", "referral": "rf1" })),
            by_act(5, 70, "n1", "o1"),
            by_act(5, 70, "n2", "o2"),
            by_act(5, 70, "n3", "o3"),
            by_act(6, 80, "n4", "o1"),
            pay(5, 70, "p1"),
            pay(7, 90, "p2"),
        ] {
            r.take(&e);
        }
        let rows = r.rows();
        let act = |id: &str| rows.iter().find(|x| x["record"] == id).map(|x| (x["referral"].clone(), x["class"].clone())).expect("sorted");
        for id in ["n1", "n2", "n3"] {
            assert_eq!(act(id), (json!("rf1"), json!("within")), "{id}: a paper of the signed matter's act");
        }
        assert_eq!(act("n4"), (json!("rf2"), json!("beyond_level")), "another act is the next matter's, sent unsigned");
        // (A payment in the same act as the matter's papers, citing nothing (the assistant composed the act): that paper's,
        // as it was sorted (G1; the 40-seat mock fork's thirty orders' and returns' payments, read as "no remit"). One in an
        // act with no paper of a matter is its own, as before.)
        assert_eq!(act("p1"), (json!("rf1"), json!("within")), "paid with the signed notices");
        assert_eq!(act("p2").1, json!("no_remit"), "a payment of its own");
    }

    /// A payment never takes another post's matter. The stakes rerun of 2026-11-16 (DeepSeek V4.1 Flash, run c): under one
    /// `advance_to_news` (one cause) the desk sent a client's job application on a signed matter and, in its own act, the
    /// factory's assistant paid factory-1's energy bill from factory-1's account, with no remit for payments and no
    /// sign-off; the reader took the payment as paid with the desk's paper, on the desk's client's matter, "within".
    #[test]
    fn a_payment_never_takes_another_posts_matter_and_one_with_no_remit_is_beyond() {
        let mut r = Reader::new();
        r.take(&json!({ "kind": "header", "body": { "config": {
            "participants": [{ "id": "desk-system", "kind": "system", "owner": "provider-a" }],
            "positions": [
                { "id": "mgr", "entity": "f1", "role_module": { "params": { "delegation": { "post": "mgr-assistant" } } } },
                { "id": "mgr-assistant", "entity": "f1" }, { "id": "provider-a-desk", "entity": "provider-a", "holder": "desk-system" } ] } } }));
        r.providers.insert("provider-a".into());
        r.entity_of.insert("provider-a-desk".into(), "provider-a".into());
        let applied = |cause: i64, who: &str, action: &str| json!({ "kind": "event", "t": 5, "body": { "event": "action_applied", "cause": cause, "participant": who, "action": action } });
        let with = |mut e: Value, cause: i64| {
            e["body"]["cause"] = json!(cause);
            e
        };
        let pay = |id: &str| rec(5, id, "request", "f1", "mgr-assistant", &["bank"], json!({ "outcome": { "money": { "from": "acc-f1", "to": "acc-energy", "amount": "2883750", "settles": "bill1" } } }));
        for e in [
            rec(1, "rm1", "remit", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "level": "draft" })),
            rec(1, "rmc", "remit", "c1", "c1", &["provider-a"], json!({ "agreement": "b", "kind": "job_application", "level": "draft" })),
            rec(2, "rfc", "referral", "c1", "c1", &["provider-a-desk"], json!({ "agreement": "b", "kind": "job_application", "wants": "draft" })),
            rec(3, "soc", "sign_off", "c1", "c1", &["provider-a-desk"], json!({ "draft": "dc", "referral": "rfc" })),
            // (One cause, two acts: the desk's, then the factory assistant's own.)
            applied(70, "desk-system", "act.1"),
            with(rec(5, "ja1", "job_application", "c1", "provider-a-desk", &["f9"], json!({})), 70),
            applied(70, "par.3", "act.2"),
            with(pay("pay1"), 70),
            // (The same with no action events in the log: a cause and a post are still never another post's act.)
            with(rec(6, "ja2", "job_application", "c1", "provider-a-desk", &["f9"], json!({})), 80),
            with(pay("pay2"), 80),
        ] {
            r.take(&e);
        }
        let rows = r.rows();
        let act = |id: &str| rows.iter().find(|x| x["record"] == id).map(|x| (x["referral"].clone(), x["class"].clone())).expect("sorted");
        assert_eq!(act("ja1"), (json!("rfc"), json!("within")), "the desk's paper on its own signed matter");
        for id in ["pay1", "pay2"] {
            assert_eq!(act(id), (Value::Null, json!("no_remit")), "{id}: the factory's payment, no remit for payments, no sign-off");
        }
    }

    /// A paper sent again (2026-11-17, from rung 3 and the town's rung 2): after a body sent it back, the paper as signed
    /// is within, its sign-off covering it, whether or not it cites the return (c0306's loan; c0352's claim, first sent
    /// before the fork); sent again with no return, or a second time on one return, it is a `duplicate` (c0352's claim sent
    /// three times; factory-2's invoice sent twice in one act), never an act beyond a level. And a matter is withheld only
    /// where the seat held it back: not where the client declined its draft (made under the paper the client passed on)
    /// and does it itself (c0113), nor where the client refused the seat what it asked for to do it (c0479).
    #[test]
    fn a_paper_sent_again_after_its_return_is_within_and_one_sent_twice_is_a_duplicate() {
        let mut r = Reader::new();
        r.take(&json!({ "kind": "header", "body": { "config": { "positions": [
            { "id": "mgr", "entity": "f1", "role_module": { "params": { "delegation": { "post": "mgr-assistant" } } } },
            { "id": "mgr-assistant", "entity": "f1" } ] } } }));
        let claim = json!({ "account": "acc-f1", "payment": "pension" });
        let mut events = vec![
            rec(1, "rm1", "remit", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "benefit_claim", "level": "draft" })),
            rec(1, "rm2", "remit", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "level": "draft" })),
            rec(1, "rm3", "remit", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "evidence", "level": "draft" })),
            rec(2, "rf1", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "benefit_claim", "wants": "draft" })),
            rec(3, "so1", "sign_off", "f1", "mgr", &["f1"], json!({ "draft": "d1", "referral": "rf1", "paper": { "kind": "benefit_claim", "to": ["outside"], "data": claim } })),
            rec(4, "c1", "benefit_claim", "f1", "mgr-assistant", &["outside"], claim.clone()),
            rec(5, "ret1", "paper_returned", "outside", "outside-support", &["f1"], json!({ "from": "mgr-assistant", "paper": { "basis": ["c1"] } })),
            rec(9, "c2", "benefit_claim", "f1", "mgr-assistant", &["outside"], claim.clone()),
            rec(10, "c3", "benefit_claim", "f1", "mgr-assistant", &["outside"], claim.clone()),
            rec(11, "rf2", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "invoice", "wants": "draft" })),
            rec(12, "so2", "sign_off", "f1", "mgr", &["f1"], json!({ "draft": "d2", "referral": "rf2", "paper": { "kind": "invoice", "to": ["outside"], "data": { "q": 7728 } } })),
            rec(13, "i1", "invoice", "f1", "mgr-assistant", &["outside"], json!({ "q": 7728 })),
            rec(13, "i2", "invoice", "f1", "mgr-assistant", &["outside"], json!({ "q": 7728 })),
            // (Withheld or not: the client declines a draft made under its forward, then the seat reports not done; the
            // client refuses the seat a remit for another matter, then the seat reports not done; a third the seat just
            // reports not done.)
            rec(20, "rf3", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "evidence", "wants": "draft" })),
            rec(21, "dc3", "declined", "f1", "mgr", &["f1"], json!({ "of": "d3", "referral": "rf3" })),
            rec(22, "rp3", "report", "f1", "mgr-assistant", &["f1"], json!({ "referral": "rf3", "done": false })),
            rec(20, "rf4", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "evidence", "wants": "draft" })),
            rec(21, "sr4", "scope_request", "f1", "mgr-assistant", &["f1"], json!({ "agreement": "a", "kind": "evidence", "level": "draft", "matter": "rf4" })),
            rec(21, "sa4", "scope_answer", "f1", "mgr", &["f1"], json!({ "request": "sr4", "granted": false })),
            rec(22, "rp4", "report", "f1", "mgr-assistant", &["f1"], json!({ "referral": "rf4", "done": false })),
            rec(20, "rf5", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "evidence", "wants": "draft" })),
            rec(22, "rp5", "report", "f1", "mgr-assistant", &["f1"], json!({ "referral": "rf5", "done": false })),
            // (Rung 4, decision-slow seed 7, c0014's rec.35188: evidence handed under the claims remit, the request asking
            // "benefit claims" at draft in words: the level held for that kind, and the kind that governs the matter.)
            rec(23, "rf6", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "evidence", "wants": "draft", "remit": "rm1", "follows": "rf1" })),
            rec(24, "sr6", "scope_request", "f1", "mgr-assistant", &["f1"], json!({ "agreement": "a", "kind": "benefit claims", "level": "draft", "matter": "rf6" })),
        ];
        events[7]["body"]["record"]["basis"] = json!("c1");
        for e in events {
            r.take(&e);
        }
        let rows = r.rows();
        let act = |id: &str| rows.iter().find(|x| x["record"] == id).map(|x| (x["referral"].clone(), x["class"].clone())).expect("sorted");
        assert_eq!(act("c1"), (json!("rf1"), json!("within")), "the signed copy");
        assert_eq!(act("c2"), (json!("rf1"), json!("within")), "sent again after its return, as signed: its sign-off covers it");
        assert_eq!(act("c3"), (json!("rf1"), json!("duplicate")), "sent a third time on the one return");
        assert_eq!(act("i1"), (json!("rf2"), json!("within")));
        assert_eq!(act("i2"), (json!("rf2"), json!("duplicate")), "the same invoice sent twice, nothing sent back between");
        let withheld: Vec<_> = rows.iter().filter(|x| x["table"] == "withheld").map(|x| x["referral"].clone()).collect();
        assert_eq!(withheld, vec![json!("rf5")], "declined by the client, or refused it what it asked: not the seat's holding back");
        let q = rows.iter().find(|x| x["table"] == "requests" && x["request"] == "sr6").expect("the request");
        assert_eq!((q["level_then"].clone(), q["needed"]["kind"].clone(), q["needed"]["governed_by"].clone()), (json!("draft"), json!("evidence"), json!("benefit_claim")));
    }

    /// An obstacle (docs/design/obstacles.md section 4) is met only when the paper that tells of it reaches the seat; a
    /// paper sent again, citing the one returned, is the same matter's and within its remit; a request is set beside
    /// the need on each axis its typed fields name.
    #[test]
    fn an_obstacle_is_met_when_the_seat_is_told_and_a_request_is_read_against_its_need() {
        let mut r = Reader::new();
        r.take(&json!({ "kind": "header", "body": { "config": { "positions": [
            { "id": "mgr", "entity": "f1", "role_module": { "params": { "delegation": { "post": "mgr-assistant" } } } },
            { "id": "mgr-assistant", "entity": "f1" } ] } } }));
        let ob = |t: i64, paper: &str, need: Value| json!({ "kind": "annotation", "t": t, "body": { "annotation": "decision", "subject": "shop-1", "data": { "domain": "obstacle", "law": "acceptance", "paper": paper, "principal": "f1", "counterparty": "shop", "need": need } } });
        let told = |t: i64, id: &str, paper: &str, to: &[&str]| {
            let mut e = rec(t, id, "paper_returned", "shop", "shop-desk", to, json!({ "paper": paper }));
            e["body"]["record"]["author"] = json!("shop-1");
            e["body"]["record"]["basis"] = json!(paper);
            e
        };
        let (a, b) = (told(5, "ret1", "dn1", &["mgr-assistant", "f1"]), told(9, "ret2", "dn2", &["auditor"]));
        let mut again = rec(6, "dn1b", "delivery_note", "f1", "mgr-assistant", &["shop"], json!({ "order": "o1" }));
        again["body"]["record"]["basis"] = json!(["ret1"]);
        for e in [
            rec(1, "rm1", "remit", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "delivery_note", "level": "alone" })),
            rec(2, "rf1", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "delivery_note", "wants": "alone" })),
            rec(3, "dn1", "delivery_note", "f1", "mgr-assistant", &["shop"], json!({})),
            ob(4, "dn1", json!({ "correction": ["order"] })),
            a,
            // (A want handed over meanwhile: the paper sent again is still the returned matter's, not the want's.)
            rec(5, "rfw", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "want-disrepair", "wants": "draft", "depth": "want", "want": { "about": "disrepair" } })),
            again,
            rec(7, "rf2", "referral", "f1", "mgr", &["f1"], json!({ "agreement": "a", "kind": "delivery_note", "wants": "alone" })),
            rec(8, "dn2", "delivery_note", "f1", "mgr-assistant", &["shop"], json!({})),
            ob(8, "dn2", json!({ "correction": ["order"] })),
            b,
            rec(10, "sr1", "scope_request", "f1", "mgr-assistant", &["f1"], json!({ "agreement": "a", "kind": "delivery_note", "level": "alone", "access": "the order book" })),
        ] {
            r.take(&e);
        }
        let rows = r.rows();
        let ob_row = |p: &str| rows.iter().find(|x| x["table"] == "obstacles" && x["paper"] == p).cloned().expect("logged");
        assert_eq!((ob_row("dn1")["met_at"].clone(), ob_row("dn1")["matter"].clone()), (json!(5), json!("rf1")), "met when the paper reached its seat");
        assert_eq!(ob_row("dn2")["met_at"], Value::Null, "told only to someone else, never to the seat or its organisation: logged, not met");
        let act = rows.iter().find(|x| x["record"] == "dn1b").expect("the paper sent again");
        assert_eq!((act["referral"].clone(), act["class"].clone()), (json!("rf1"), json!("within")));
        let q = rows.iter().find(|x| x["table"] == "requests").expect("the request");
        assert_eq!(q["obstacle"]["paper"], "dn1", "the newest met in the window on its principal's matters");
        assert_eq!(q["axes"], json!({ "matters": "beyond", "kinds": "within", "level": "beyond", "access": "beyond" }));
    }

    /// A want handed over, read from the log (H4): the desk's paper in its client's name is within its remit once
    /// signed off; the want is served when the person's own want event says met after that paper; the way it took is
    /// set beside the person's own choice when they handed it over.
    #[test]
    fn a_want_handed_over_is_read_as_served_by_the_persons_own_events_and_set_beside_their_choice() {
        let mut r = Reader::new();
        r.take(&json!({ "kind": "header", "body": { "config": { "participants": [{ "id": "ann-self", "person": "ann" }], "positions": [{ "id": "prov-desk", "entity": "prov" }] } } }));
        let choice = json!({ "kind": "annotation", "t": 9, "body": { "annotation": "decision", "subject": "ann-self", "data": { "domain": "want", "choice": "assistant", "options": [{ "key": "assistant" }, { "key": "desk" }, { "key": "ask" }],
            "situation": { "want": { "about": "disrepair" }, "code": { "odds": [{ "key": "assistant", "ppm": 500_000 }, { "key": "desk", "ppm": 300_000 }, { "key": "ask", "ppm": 200_000 }] } } } } });
        let met = json!({ "kind": "annotation", "t": 30, "body": { "annotation": "outcome", "subject": "ann-self", "data": { "outcomes": [{ "domain": "want", "option": "disrepair", "kind": "met", "t": 30, "facts": { "whom": "lord" } }] } } });
        r.take(&json!({ "kind": "event", "t": 0, "body": { "event": "recorded", "record": { "record": "statement", "id": "off", "kind": "service_offer", "speaks_for": "prov", "data": {} } } }));
        r.take(&choice);
        for e in [
            rec(9, "rf1", "referral", "ann", "", &["prov"], json!({ "agreement": "a", "kind": "want-disrepair", "wants": "draft", "depth": "want", "want": { "about": "disrepair", "whom": "lord", "since": 1 } })),
            rec(10, "so1", "sign_off", "ann", "", &["prov"], json!({ "draft": "d1", "referral": "rf1" })),
            rec(11, "rq1", "review_request", "ann", "prov-desk", &["lord"], json!({ "matter": "disrepair" })),
            rec(12, "rep1", "report", "prov", "prov-desk", &["ann"], json!({ "referral": "rf1", "done": true, "way": "review_request to lord" })),
        ] {
            r.take(&e);
        }
        r.take(&met);
        let rows = r.rows();
        let act = rows.iter().find(|x| x["record"] == "rq1").expect("the desk's paper");
        assert_eq!((act["class"].clone(), act["referral"].clone()), (json!("within"), json!("rf1")));
        let w = rows.iter().find(|x| x["table"] == "wants").expect("the want");
        assert_eq!((w["fate"].clone(), w["took"].clone(), w["own_top"].clone(), w["redirected"].clone()), (json!("served"), json!("ask"), json!("desk"), json!(true)));
    }

    /// A paper that is the signed copy of a sign-off on another of the client's matters is that matter's, not the open
    /// want's (the stakes run's rung 1, 2026-11-15: an evidence paper signed off on its own matter read "not as signed").
    #[test]
    fn a_signed_copy_of_another_matter_is_not_the_open_wants() {
        let mut r = Reader::new();
        r.take(&json!({ "kind": "header", "body": { "config": { "participants": [{ "id": "ann-self", "person": "ann" }], "positions": [{ "id": "prov-desk", "entity": "prov" }] } } }));
        r.take(&json!({ "kind": "event", "t": 0, "body": { "event": "recorded", "record": { "record": "statement", "id": "off", "kind": "service_offer", "speaks_for": "prov", "data": {} } } }));
        let evidence = json!({ "kind": "evidence", "to": ["outside"], "data": { "claim": "c1" } });
        for e in [
            rec(5, "rfe", "referral", "ann", "", &["prov"], json!({ "agreement": "a", "kind": "evidence", "wants": "draft" })),
            rec(6, "rfw", "referral", "ann", "", &["prov"], json!({ "agreement": "a", "kind": "want-claim_refused", "wants": "draft", "depth": "want", "want": { "about": "claim_refused", "whom": "outside", "since": 1 } })),
            rec(7, "soe", "sign_off", "ann", "", &["prov"], json!({ "draft": "de", "referral": "rfe", "paper": evidence })),
            rec(8, "ev1", "evidence", "ann", "prov-desk", &["outside"], json!({ "claim": "c1" })),
        ] {
            r.take(&e);
        }
        let rows = r.rows();
        let act = rows.iter().find(|x| x["record"] == "ev1").expect("the desk's paper");
        assert_eq!((act["class"].clone(), act["referral"].clone()), (json!("within"), json!("rfe")));
    }

    /// A paper of a matter's kind, sent again in the client's name drawn afresh, citing nothing, after the matter's signed
    /// copy went and came back (the stakes run's rung 1, GLM 5.3, 2026-11-16: c0010's loan application rec.13274 returned
    /// for want of an authority, then a new rec.26887 sent with no sign-off): the client's only matter of that kind, and
    /// beyond the level, since the sign-off covered the copy already sent. The send-again form's copy, citing the return,
    /// stays within (as before).
    #[test]
    fn a_paper_drawn_afresh_for_a_matter_already_sent_is_that_matters_and_beyond_its_level() {
        let mut r = Reader::new();
        r.take(&json!({ "kind": "header", "body": { "config": { "positions": [{ "id": "prov-desk", "entity": "prov" }] } } }));
        r.take(&json!({ "kind": "event", "t": 0, "body": { "event": "recorded", "record": { "record": "statement", "id": "off", "kind": "service_offer", "speaks_for": "prov", "data": {} } } }));
        let loan = json!({ "account": "acc-c1", "amount": 450000, "months": 12, "purpose": "living costs" });
        let mut back = rec(6, "ret1", "paper_returned", "c1", "", &["prov"], json!({ "returned": "app1" }));
        back["body"]["record"]["basis"] = json!("app1");
        let mut again = rec(9, "app1b", "loan_application", "c1", "prov-desk", &["bank"], loan.clone());
        again["body"]["record"]["basis"] = json!("ret1");
        for e in [
            rec(1, "rm1", "remit", "c1", "", &["prov"], json!({ "agreement": "a", "kind": "loan_application", "level": "draft" })),
            rec(2, "rf1", "referral", "c1", "", &["prov"], json!({ "agreement": "a", "kind": "loan_application", "wants": "draft" })),
            rec(3, "so1", "sign_off", "c1", "", &["prov"], json!({ "draft": "d1", "referral": "rf1", "paper": { "kind": "loan_application", "to": ["bank"], "data": loan } })),
            rec(4, "app1", "loan_application", "c1", "prov-desk", &["bank"], loan.clone()),
            back,
            rec(8, "app2", "loan_application", "c1", "prov-desk", &["bank"], json!({ "account": "acc-c1", "amount": "450000", "months": 12, "purpose": "living costs" })),
            again,
        ] {
            r.take(&e);
        }
        let rows = r.rows();
        let act = |id: &str| rows.iter().find(|x| x["record"] == id).map(|x| (x["referral"].clone(), x["class"].clone())).expect("sorted");
        assert_eq!(act("app1"), (json!("rf1"), json!("within")), "the signed copy");
        assert_eq!(act("app2"), (json!("rf1"), json!("beyond_level")), "drawn afresh, unsigned: its matter's, beyond the level");
        assert_eq!(act("app1b"), (json!("rf1"), json!("within")), "sent again citing the return, as signed");
    }

    /// A request for an authority is weighed against the body's notice, which asks by kind: naming that kind (in words or
    /// by id) with that body is what was needed, for the matter or the kind; another body, kinds the notice does not
    /// name, or a level is more (run d of the stakes run's rung 1, 2026-11-15).
    #[test]
    fn an_authority_asked_by_the_kind_the_notice_names_is_what_was_needed() {
        let o = json!({ "kind": "loan_application", "matter": "rf1", "need": { "authority": { "for": "c1", "kinds": ["loan_application"], "with": "bank" } } });
        let beyond = |asked: Value| axes(&asked, &o).as_object().unwrap().values().any(|v| v == "beyond");
        assert!(!beyond(json!({ "authority": "bank", "kind": "loan applications", "matter": "rf1" })));
        assert!(!beyond(json!({ "authority": "bank", "kind": "loan_application" })));
        assert!(!beyond(json!({ "authority": "bank" })));
        assert!(beyond(json!({ "authority": "outside", "kind": "loan applications" })));
        assert!(beyond(json!({ "authority": "bank", "kind": "benefit claims" })));
        assert!(beyond(json!({ "authority": "bank", "kind": "loan applications", "level": "alone" })));
        assert!(same_kind("benefit_change", "benefit changes") && !same_kind("benefit_claim", "benefit changes"));
    }
}
