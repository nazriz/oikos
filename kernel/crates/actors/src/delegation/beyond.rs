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
                self.recorded(t, &e["body"]["record"]);
            }
            _ => {}
        }
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

    /// The rows: each act sorted, then each request with what came of it.
    pub fn rows(&self) -> Vec<Value> {
        let mut out = self.acts.clone();
        for q in &self.requests {
            let mut q = q.clone();
            if let Some((t, a)) = q["request"].as_str().and_then(|id| self.answers.get(id)) {
                q["answer"] = json!({ "t": t, "granted": a["granted"], "reasons": a["reasons"], "look_again_at": a["look_again_at"] });
            }
            out.push(q);
        }
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
}
