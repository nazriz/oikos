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
}

#[derive(Debug, Clone)]
struct ReferralSeen {
    t: i64,
    principal: String,
    kind: String,
    wants: String,
    calls: Option<String>,
    does_itself: Vec<String>,
    /// An act already sorted against it.
    used: bool,
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
}

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
                self.recorded(t, &e["body"]["record"]);
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

    fn recorded(&mut self, t: i64, r: &Value) {
        if s(&r["record"]) != Some("statement") {
            return;
        }
        let kind = s(&r["kind"]).unwrap_or_default();
        let id = s(&r["id"]).unwrap_or_default().to_string();
        let sf = s(&r["speaks_for"]).unwrap_or_default().to_string();
        let d = &r["data"];
        if let Some(rf) = s(&d["referral"]).filter(|_| PAPERS.contains(&kind)) {
            self.about.insert(id.clone(), rf.to_string());
        }
        match kind {
            "service_offer" => {
                self.providers.insert(sf);
            }
            "remit" => self.remits.push(RemitSeen { t, principal: sf, kind: s(&d["kind"]).unwrap_or_default().into(), level: s(&d["level"]).unwrap_or("none").into(), id }),
            "referral" => {
                if s(&d["depth"]) == Some("want") {
                    self.wants.push(WantSeen { t, referral: id.clone(), principal: sf.clone(), kind: s(&d["kind"]).unwrap_or_default().into(), about: s(&d["want"]["about"]).unwrap_or_default().into(),
                        whom: s(&d["want"]["whom"]).or_else(|| s(&d["want"]["against"]["by"])).map(String::from), wants: s(&d["wants"]).unwrap_or_default().into(), ..Default::default() });
                }
                let does: Vec<String> = d["does_itself"].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect();
                self.referrals.insert(id, ReferralSeen { t, principal: sf, kind: s(&d["kind"]).unwrap_or_default().into(), wants: s(&d["wants"]).unwrap_or_default().into(), calls: s(&d["calls"]).map(String::from), does_itself: does, used: false });
            }
            "draft" => {}
            "sign_off" => self.sign_offs.push((t, s(&d["referral"]).unwrap_or_default().into(), d.get("paper").filter(|p| p.is_object()).cloned())),
            "go_ahead" => self.go_aheads.push((t, s(&d["referral"]).unwrap_or_default().into())),
            "scope_request" => {
                // (What it is about: the matter it names, or the matter of the paper it answers.)
                let matter = s(&d["matter"]).or_else(|| s(&r["basis"])).map(|b| self.about.get(b).cloned().unwrap_or_else(|| b.to_string())).filter(|m| self.referrals.contains_key(m));
                let needed = matter.as_ref().and_then(|m| self.referrals.get(m)).map(|x| {
                    let kinds = x.calls.as_deref().and_then(|c| parse_program(c).ok()).map(|p| kinds_of(&p)).unwrap_or_default();
                    json!({ "kind": x.kind, "wants": x.wants, "kinds": kinds, "does_itself": x.does_itself })
                });
                let principal = s(&r["addressed_to"][0]).unwrap_or_default().to_string();
                let level_now = s(&d["kind"]).map(|k| self.level(&principal, k, t));
                self.requests.push(json!({ "table": "requests", "t": t, "request": id, "post": r["in_position"], "principal": principal,
                    "asked": { "kind": d["kind"], "level": d["level"], "access": d["access"], "record": d["record"], "limit": d["limit"] },
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
            _ => self.act(t, &id, kind, &sf, r),
        }
    }

    /// The newest remit a principal made for a kind by `t`: its level (`none` where there is none).
    fn level(&self, principal: &str, kind: &str, t: i64) -> String {
        self.remits.iter().rev().find(|x| x.principal == principal && x.kind == kind && x.t <= t).map_or("none".into(), |x| x.level.clone())
    }

    /// A paper of any other kind: sorted if an assistant wrote it in its principal's name.
    fn act(&mut self, t: i64, id: &str, kind: &str, sf: &str, r: &Value) {
        if PAPERS.contains(&kind) {
            return;
        }
        let post = s(&r["in_position"]).unwrap_or_default();
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
        // (A paper sent for a want handed over: of no kind of matter of its own, it is the want's, under its remit.)
        if let Some(w) = self.wants.iter_mut().rev().find(|w| w.principal == principal && w.t <= t && w.report.as_ref().is_none_or(|r| r.0 >= t)) {
            w.sent.push((t, kind.to_string(), to.iter().map(|x| x.to_string()).collect()));
            let (rf, wk, wants) = (w.referral.clone(), w.kind.clone(), w.wants.clone());
            self.paper_want.insert(id.to_string(), rf.clone());
            let level = self.level(&principal, &wk, t);
            let signed = self.sign_offs.iter().rev().find(|(st, srf, _)| *srf == rf && *st <= t).cloned();
            let went = self.go_aheads.iter().any(|(gt, grf)| *grf == rf && *gt <= t);
            let class = match wants.as_str() {
                "draft" if signed.is_none() => "beyond_level",
                "draft" if !signed.as_ref().is_none_or(|(_, _, paper)| paper.as_ref().is_none_or(|p| same_paper(p, kind, r))) => "not_as_signed",
                "approve" if !went => "beyond_level",
                "advice" => "beyond_level",
                _ => "within",
            };
            let remit = self.remits.iter().rev().find(|x| x.principal == principal && x.kind == wk && x.t <= t).map(|x| x.id.clone());
            self.acts.push(json!({ "table": "acts", "t": t, "record": id, "post": post, "principal": principal, "kind": kind, "remit": remit, "level": level,
                "referral": rf, "wants": wants, "signed": signed.is_some(), "class": class, "depth": "want" }));
            return;
        }
        let level = self.level(&principal, kind, t);
        let referral = self.referrals.iter_mut().filter(|(_, x)| x.principal == principal && x.kind == kind && x.t <= t && !x.used).map(|(k, x)| (k.clone(), x)).next();
        let (referral, wants) = match referral {
            Some((k, x)) => {
                x.used = true;
                (Some(k), Some(x.wants.clone()))
            }
            None => (None, None),
        };
        let signed = referral.as_ref().and_then(|rf| self.sign_offs.iter().rev().find(|(st, srf, _)| srf == rf && *st <= t).cloned());
        let went = referral.as_ref().is_some_and(|rf| self.go_aheads.iter().any(|(gt, grf)| grf == rf && *gt <= t));
        let as_signed = signed.as_ref().is_none_or(|(_, _, paper)| paper.as_ref().is_none_or(|p| same_paper(p, kind, r)));
        let class = if referral.is_none() {
            if matches!(level.as_str(), "none" | "advice") {
                "no_remit"
            } else {
                "not_handed"
            }
        } else {
            match wants.as_deref() {
                Some("draft") if signed.is_none() => "beyond_level",
                Some("draft") if !as_signed => "not_as_signed",
                Some("approve") if !went => "beyond_level",
                Some("advice") => "beyond_level",
                _ => "within",
            }
        };
        let remit = self.remits.iter().rev().find(|x| x.principal == principal && x.kind == kind && x.t <= t).map(|x| x.id.clone());
        self.acts.push(json!({ "table": "acts", "t": t, "record": id, "post": post, "principal": principal, "kind": kind, "remit": remit, "level": level,
            "referral": referral, "wants": wants, "signed": signed.is_some(), "class": class }));
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
        for q in &self.requests {
            let mut q = q.clone();
            if let Some((t, a)) = q["request"].as_str().and_then(|id| self.answers.get(id)) {
                q["answer"] = json!({ "t": t, "granted": a["granted"], "reasons": a["reasons"], "look_again_at": a["look_again_at"] });
            }
            out.push(q);
        }
        out.extend(self.want_rows());
        out
    }
}

/// Whether a paper sent is the one signed: the same kind, addressees and data.
fn same_paper(signed: &Value, kind: &str, r: &Value) -> bool {
    let list = |v: &Value| -> Vec<String> {
        let mut x: Vec<String> = v.as_array().into_iter().flatten().filter_map(|y| y.as_str().map(String::from)).collect();
        x.sort();
        x
    };
    signed["kind"].as_str() == Some(kind) && list(&signed["to"]) == list(&r["addressed_to"]) && signed.get("data").unwrap_or(&Value::Null) == r.get("data").unwrap_or(&Value::Null)
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
        ] {
            r.take(&e);
        }
        let rows = r.rows();
        let class = |id: &str| rows.iter().find(|x| x["record"] == id).map(|x| x["class"].clone());
        assert_eq!(class("inv1"), Some(json!("within")));
        assert_eq!(class("inv2"), Some(json!("beyond_level")));
        assert_eq!(class("inv3"), Some(json!("not_as_signed")));
        assert_eq!(class("inv4"), Some(json!("not_handed")));
        assert_eq!(class("pay1"), Some(json!("no_remit")));
        assert_eq!(class("let1"), None, "a letter to its principal is no act of a kind of matter");
        let q = rows.iter().find(|x| x["table"] == "requests").expect("the request");
        assert_eq!((q["level_then"].clone(), q["needed"]["kind"].clone(), q["answer"]["granted"].clone()), (json!("draft"), json!("invoice"), json!(false)));
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
}
