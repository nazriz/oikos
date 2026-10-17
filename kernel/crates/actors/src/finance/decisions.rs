//! What a decision waits for, and how an office looks at its own decision again: the acts (participants/src/behaviour/
//! decisions.ts; docs/behaviour/decisions.md). The law's part, a rule read as data, is `oikos_rules::decisions`.
//!
//! A library, not a kind: an office that decides claims (`Waits`) and one that looks at its decisions again when asked
//! (`Reconsiderations`) hold these in their own state and call them at each round, as the TS modules did. Nothing here
//! makes a decision wait or come out differently by itself: the office writes the request for papers (an act that takes
//! its performer's time), the claimant answers when they do (theirs), the employer answers from its own books (its staff's
//! time); the office decides at its next round when what it waited for has come or its time has run, and a review is the
//! office doing the deciding again on the facts then on file, as work with its time.

use crate::common::{addressed_to, data, made_at, Book, Fields, DAY};
use crate::steps::{because, say, Say, Step, Visible};
use oikos_rules::decisions::{self as law, DecisionLaw, Else, From, OnFile};
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// The papers this runs on. A request to look at a decision again is the one request of every grievance
/// (docs/behaviour/frictions.md).
pub mod kind {
    /// To whoever did it or put it wrong: look at this again / put this right.
    pub const REQUEST: &str = "review_request";
    /// Their answer, to the one who asked.
    pub const ANSWER: &str = "remedy_answer";
    /// The office's record that it looked at one of its decisions again: what was found.
    pub const REVIEW: &str = "decision_review";
    /// The office to a claimant: send these papers, by this day.
    pub const EVIDENCE_REQUEST: &str = "evidence_request";
    /// The claimant to the office: the papers.
    pub const EVIDENCE: &str = "evidence";
    /// The office to an organisation: confirm this about a person, by this day.
    pub const CONFIRMATION_REQUEST: &str = "confirmation_request";
    /// The organisation's answer, from its own books.
    pub const CONFIRMATION: &str = "confirmation_answer";
}

fn laws_on_file(book: &Book) -> impl Iterator<Item = OnFile<'_>> {
    book.open("law").map(|l| OnFile { at: l.at, data: data(l) })
}

/// The law on file for a decision of a kind (and, where it differs by payment, for that payment).
pub fn decision_law(book: &Book, kind: &str, payment: Option<&str>) -> Option<DecisionLaw> {
    law::decision_law(laws_on_file(book), kind, payment)
}

/// The law on file whose appeal is about this matter.
pub fn appeal_law(book: &Book, matter: &str) -> Option<DecisionLaw> {
    law::appeal_law(laws_on_file(book), matter)
}

/// Where a need stands (`Waits::state`).
#[derive(Debug)]
pub enum Waiting<T> {
    /// Nothing is left to wait for.
    Ready(Vec<Step<T>>),
    /// Something is out and not yet late.
    Waiting(Vec<Step<T>>),
    /// Something did not come in time and the law says refuse; the reason is in words.
    Lapsed { why: String, steps: Vec<Step<T>> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Asking {
    at: i64,
    by: i64,
}

/// What a decision waits for, for an office that decides claims. Per claim: the requests it has made, what has come, what
/// is late. It makes the requests and reads the answers on the file; it decides nothing.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Waits {
    me: String,
    /// need key (`claim|need`) -> when we asked and the day it is due by.
    asked: BTreeMap<String, Asking>,
}

impl Waits {
    pub fn new(me: &str) -> Self {
        Waits { me: me.to_string(), asked: BTreeMap::new() }
    }

    /// The employer to ask: whom the claimant's own papers name as their last employer (what they send with a claim),
    /// else the last one that reported pay for the claimant to us (the office's own file of reports).
    pub fn employer_of(book: &Book, me: &str, who: &str) -> Option<String> {
        let named = book
            .open(kind::EVIDENCE)
            .filter(|r| r.speaks_for.as_deref() == Some(who) && addressed_to(r).iter().any(|a| a == me) && data(r).s("last_employer").is_some())
            .max_by(|a, b| a.at.cmp(&b.at).then_with(|| crate::common::filed_before(&b.id, &a.id)));
        if let Some(n) = named {
            return data(n).s("last_employer").map(String::from);
        }
        let mut best: Option<(i64, &str)> = None;
        for r in book.all("withholding_report") {
            let Some(by) = r.speaks_for.as_deref() else { continue };
            if !addressed_to(r).iter().any(|a| a == me) {
                continue;
            }
            let Some(staff) = data(r).get("staff").and_then(|s| s.as_array()) else { continue };
            if !staff.iter().any(|l| l.s("worker") == Some(who)) {
                continue;
            }
            if best.is_none_or(|(at, _)| r.at > at) {
                best = Some((r.at, by));
            }
        }
        best.map(|(_, by)| by.to_string())
    }

    fn evidence_in(&self, book: &Book, claim: &Record, who: &str, need: &str) -> bool {
        book.open(kind::EVIDENCE)
            .any(|r| r.speaks_for.as_deref() == Some(who) && addressed_to(r).contains(&self.me) && data(r).s("claim") == Some(&claim.id) && data(r).s("need") == Some(need))
    }

    pub fn state<T>(&mut self, book: &Book, law: Option<&DecisionLaw>, c: &Record, t: i64) -> Waiting<T> {
        let needs = law.map(|l| l.needs.as_slice()).unwrap_or(&[]);
        let mut steps: Vec<Step<T>> = vec![];
        let who = c.speaks_for.clone().unwrap_or_default();
        let (mut waiting, mut lapsed): (bool, Option<String>) = (false, None);
        for n in needs {
            let key = format!("{}|{}", c.id, n.id);
            let came = match n.from {
                From::Claimant => self.evidence_in(book, c, &who, &n.id),
                From::Employer => book
                    .open(kind::CONFIRMATION)
                    .any(|r| addressed_to(r).contains(&self.me) && data(r).s("claim") == Some(&c.id) && data(r).s("need") == Some(&n.id)),
            };
            if came {
                continue;
            }
            let Some(asked) = self.asked.get(&key).cloned() else {
                let employer = if n.from == From::Employer { Self::employer_of(book, &self.me, &who) } else { None };
                if n.from == From::Employer && employer.is_none() {
                    // (Nobody to ask yet: the claimant's papers may name their last employer, so while those are out we
                    // wait; once they are in, or none are asked for, and no one is named and no pay was ever reported
                    // for the claimant, what cannot be had is not waited for.)
                    let papers_out = needs.iter().any(|x| {
                        x.from == From::Claimant
                            && !self.evidence_in(book, c, &who, &x.id)
                            && t < self.asked.get(&format!("{}|{}", c.id, x.id)).map_or(i64::MIN, |a| a.by)
                    });
                    if papers_out {
                        waiting = true;
                    }
                    continue;
                }
                let asking = Asking { at: t, by: t + n.within_days * DAY };
                self.asked.insert(key, asking.clone());
                let mut d = serde_json::json!({ "claim": c.id, "need": n.id, "what": n.what, "by": asking.by });
                if n.from == From::Employer {
                    d["about"] = who.clone().into();
                }
                let by_day = asking.by.div_euclid(DAY);
                let step = match n.from {
                    From::Claimant => because(
                        format!("Claim {} waits for what the law asks of the claimant ({}): asking {who}, to send it within {} days.", c.id, n.what, n.within_days),
                        vec![say(
                            kind::EVIDENCE_REQUEST,
                            &format!("For your claim {}: please send {}, within {} days (by day {by_day}).", c.id, n.what, n.within_days),
                            Say { to: Some(vec![who.clone()]), visible: Some(Visible::Only(vec![who.clone(), self.me.clone()])), basis: Some(c.id.clone()), data: Some(d), ..Default::default() },
                        )],
                    ),
                    From::Employer => {
                        let employer = employer.unwrap_or_default();
                        because(
                            format!("Claim {} waits for {employer} to confirm {}: asking, to answer within {} days.", c.id, n.what, n.within_days),
                            vec![say(
                                kind::CONFIRMATION_REQUEST,
                                &format!("For the claim {} of {who}: please confirm {}, within {} days (by day {by_day}).", c.id, n.what, n.within_days),
                                Say { to: Some(vec![employer.clone()]), visible: Some(Visible::Only(vec![employer, self.me.clone()])), basis: Some(c.id.clone()), data: Some(d), ..Default::default() },
                            )],
                        )
                    }
                };
                steps.push(step);
                waiting = true;
                continue;
            };
            if t < asked.by {
                waiting = true;
                continue;
            }
            if n.otherwise == Else::Refuse && lapsed.is_none() {
                lapsed = Some(format!(
                    "{} within {} days ({})",
                    if n.from == From::Claimant { "the papers asked for did not come" } else { "the confirmation asked for did not come" },
                    n.within_days,
                    n.what
                ));
            }
        }
        match lapsed {
            Some(why) => Waiting::Lapsed { why, steps },
            None if waiting => Waiting::Waiting(steps),
            None => Waiting::Ready(steps),
        }
    }
}

/// What an office found on looking at its own decision again.
pub struct Redone<T> {
    pub changed: bool,
    pub found: String,
    /// What puts it right, where it was found wrong.
    pub steps: Vec<Step<T>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Result_ {
    Changed,
    Upheld,
}

/// An office looking at its own decision again when asked (the generic route of law 5): a request on file addressed to it,
/// about one of its decisions of a kind whose law has a review. Inside the law's time it does the deciding again, on the
/// facts now on file and as the office's own `redo` has it, and records what it found: a record that the decision was
/// reviewed, and its answer to the one who asked. A decision found wrong is put right by the office itself (`redo`'s
/// steps); one found right is said to stand. A request after the time the law gives is answered no, and why.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Reconsiderations {
    me: String,
    kinds: Vec<String>,
    handled: BTreeSet<String>,
    /// Reviews done this round, by decision (the file shows them from the next look): a decision is looked at once; a
    /// second request on the same one is answered from the first.
    done: BTreeMap<String, Result_>,
    /// What it did, for whoever counts (nothing reads it back).
    pub counts: BTreeMap<String, u64>,
}

impl Reconsiderations {
    pub fn new(me: &str, kinds: &[&str]) -> Self {
        Reconsiderations { me: me.to_string(), kinds: kinds.iter().map(|k| k.to_string()).collect(), ..Default::default() }
    }

    fn count(&mut self, what: &str) {
        *self.counts.entry(what.to_string()).or_insert(0) += 1;
    }

    /// The reviews on file that we made, newest first.
    pub fn reviews<'a>(book: &'a Book, me: &str, decision: Option<&str>) -> Vec<&'a Arc<Record>> {
        let mut v: Vec<_> = book.all(kind::REVIEW).filter(|r| r.speaks_for.as_deref() == Some(me) && decision.is_none_or(|d| data(r).s("decision") == Some(d))).collect();
        v.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| crate::common::filed_before(&a.id, &b.id)));
        v
    }

    /// `redo(decision, request)`: the deciding again; `None` where it cannot be done yet (the request stays to be taken
    /// up at the next round).
    pub fn steps<T>(&mut self, book: &Book, t: i64, mut redo: impl FnMut(&Record, &Record) -> Option<Redone<T>>) -> Vec<Step<T>> {
        let mut steps: Vec<Step<T>> = vec![];
        let mut requests: Vec<&Arc<Record>> =
            book.open(kind::REQUEST).filter(|x| addressed_to(x).contains(&self.me) && !self.handled.contains(&x.id)).collect();
        requests.sort_by(|a, b| made_at(a).cmp(&made_at(b)).then_with(|| a.id.cmp(&b.id)));
        for r in requests {
            let about = data(r).s("about").and_then(|id| book.get(id));
            // (Not about one of our decisions of a kind with a review: some other request, not ours to look at again.)
            let Some(about) = about else { continue };
            let Some(about_kind) = crate::common::kind(about) else { continue };
            if about.speaks_for.as_deref() != Some(self.me.as_str()) || !self.kinds.iter().any(|k| k == about_kind) {
                continue;
            }
            let payment = data(about).s("payment");
            let Some(law) = decision_law(book, about_kind, payment) else { continue };
            let Some(review) = law.review.clone() else { continue };
            self.handled.insert(r.id.clone());
            let from = r.speaks_for.clone().unwrap_or_default();
            let matter = data(r).s("matter").unwrap_or_default().to_string();
            let left = law::days_left(about.at, review.within_days, t);
            let said = |this: &mut Self, granted: bool, outcome: &str, found: &str, words: &str, more: Vec<Step<T>>, steps: &mut Vec<Step<T>>| {
                this.count(&format!("review_{outcome}"));
                let who_only = Visible::Only(vec![from.clone(), this.me.clone()]);
                let review_data = serde_json::json!({ "decision": about.id, "kind": about_kind, "request": r.id, "outcome": outcome, "found": found, "asked_by": from, "decided_on": about.at });
                let mut answer = serde_json::json!({ "request": r.id, "matter": matter, "granted": granted, "review": outcome, "decision": about.id });
                if !granted {
                    answer["reason"] = found.into();
                }
                steps.push(because(
                    format!("{from} asks us to look at our decision {} again: {found}.", about.id),
                    vec![
                        say(
                            kind::REVIEW,
                            &format!("Review of {}, asked by {from}: {words}", about.id),
                            Say { to: Some(vec![from.clone()]), visible: Some(who_only), basis: Some(about.id.clone()), data: Some(review_data), ..Default::default() },
                        ),
                        say(
                            kind::ANSWER,
                            &format!("Answer to your request {}: {}: {words}", r.id, if granted { "yes" } else { "no" }),
                            Say {
                                to: Some(vec![from.clone()]),
                                visible: Some(Visible::Only(vec![from.clone(), this.me.clone()])),
                                basis: Some(r.id.clone()),
                                data: Some(answer),
                                ..Default::default()
                            },
                        ),
                    ],
                ));
                steps.extend(more);
            };
            if left < 0 {
                let found = format!("the law allows {} days to ask, and the decision was made {} days ago", review.within_days, (t - about.at).div_euclid(DAY));
                said(self, false, "out_of_time", &found, &format!("it was asked for after the {} days the law allows.", review.within_days), vec![], &mut steps);
                continue;
            }
            // (Looked at already: from the file, which is the record of it; or from this round's, before it shows.)
            let filed = Self::reviews(book, &self.me, Some(&about.id)).into_iter().find_map(|x| match data(x).s("outcome") {
                Some("changed") => Some(Result_::Changed),
                Some("upheld") => Some(Result_::Upheld),
                _ => None,
            });
            if let Some(first) = self.done.get(&about.id).copied().or(filed) {
                let (outcome, words) = if first == Result_::Changed { ("changed", "it was found wrong and has been put right.") } else { ("upheld", "it was looked at and stands.") };
                said(self, first == Result_::Changed, outcome, "it has been looked at already", words, vec![], &mut steps);
                continue;
            }
            let Some(out) = redo(about, r) else {
                self.handled.remove(&r.id);
                continue;
            };
            self.done.insert(about.id.clone(), if out.changed { Result_::Changed } else { Result_::Upheld });
            let words = if out.changed { format!("found wrong: {}; put right.", out.found) } else { format!("looked at again: {}; it stands.", out.found) };
            said(self, out.changed, if out.changed { "changed" } else { "upheld" }, &out.found, &words, out.steps, &mut steps);
        }
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finance::kit::{book_of, statement, DAY};
    use crate::steps::Step;
    use serde_json::{json, Value};

    fn route() -> Value {
        json!({ "kind": "benefit_decision", "name": "a decision on a claim", "payments": ["pension"], "refused_by": "office-holder",
            "needs": [{ "id": "papers", "from": "claimant", "what": "proof of who you are", "within_days": 14, "else": "refuse" }],
            "review": { "within_days": 30, "grounds": "any", "required": true }, "appeal": { "matter": "claim_refused", "within_days": 20, "grounds": "any error" } })
    }
    fn law(rules: Vec<Value>) -> Value {
        statement("law-decisions", 0, "law", json!({ "speaks_for": "outside" }), json!({ "decisions": rules }))
    }
    fn claim(id: &str, who: &str) -> Value {
        statement(id, 0, "benefit_claim", json!({ "speaks_for": who, "addressed_to": ["outside"], "visible_to": [who, "outside"] }), json!({ "payment": "pension" }))
    }
    fn evidence(id: &str, who: &str, claim: &str, need: &str) -> Value {
        statement(id, DAY, "evidence", json!({ "speaks_for": who, "addressed_to": ["outside"], "visible_to": [who, "outside"] }), json!({ "claim": claim, "need": need }))
    }
    fn kinds(steps: &[Step<()>]) -> Vec<String> {
        steps.iter().flat_map(|s| s.lines.iter().map(|l| crate::finance::kit::arg(&l.call, "kind").unwrap())).collect()
    }

    #[test]
    fn the_law_is_read_from_the_published_record_the_rule_for_a_payment_before_the_rule_for_the_kind() {
        let other = json!({ "kind": "benefit_decision", "name": "other", "review": { "within_days": 7, "grounds": "x" } });
        let b = book_of("outside", vec![law(vec![route(), other])]);
        assert_eq!(decision_law(&b, "benefit_decision", Some("pension")).unwrap().review.unwrap().within_days, 30);
        assert_eq!(decision_law(&b, "benefit_decision", Some("jobseeker")).unwrap().review.unwrap().within_days, 7);
        assert!(decision_law(&b, "permit_decision", None).is_none());
        assert_eq!(appeal_law(&b, "claim_refused").unwrap().appeal.unwrap().within_days, 20);
    }

    #[test]
    fn a_claim_waits_for_the_papers_the_law_asks_they_are_asked_for_once_and_it_is_ready_when_they_come() {
        let mut w = Waits::new("outside");
        let b = book_of("outside", vec![law(vec![route()]), claim("c1", "a")]);
        let c = b.get("c1").unwrap().clone();
        let l = decision_law(&b, "benefit_decision", Some("pension"));
        let Waiting::Waiting(asked) = w.state::<()>(&b, l.as_ref(), &c, 0) else { panic!("it waits") };
        assert_eq!(kinds(&asked), ["evidence_request"]);
        // Nothing more is asked while the days run.
        assert!(matches!(w.state::<()>(&b, l.as_ref(), &c, 5 * DAY), Waiting::Waiting(s) if s.is_empty()));
        // The papers come: ready.
        let b2 = book_of("outside", vec![law(vec![route()]), claim("c1", "a"), evidence("e1", "a", "c1", "papers")]);
        assert!(matches!(w.state::<()>(&b2, l.as_ref(), &c, 6 * DAY), Waiting::Ready(_)));
    }

    #[test]
    fn papers_that_do_not_come_in_the_laws_days_the_claim_is_refused_and_says_why_where_the_law_says_decide_it_is_decided_without() {
        let b = book_of("outside", vec![law(vec![route()]), claim("c1", "a")]);
        let c = b.get("c1").unwrap().clone();
        let l = decision_law(&b, "benefit_decision", Some("pension"));
        let mut w = Waits::new("outside");
        w.state::<()>(&b, l.as_ref(), &c, 0);
        assert!(matches!(w.state::<()>(&b, l.as_ref(), &c, 13 * DAY), Waiting::Waiting(_)));
        let Waiting::Lapsed { why, .. } = w.state::<()>(&b, l.as_ref(), &c, 14 * DAY) else { panic!("lapsed") };
        assert!(why.contains("papers asked for did not come within 14 days"), "{why}");
        let mut lax = route();
        lax["needs"][0] = json!({ "id": "papers", "from": "claimant", "what": "proof", "within_days": 3, "else": "decide" });
        let b = book_of("outside", vec![law(vec![lax]), claim("c1", "a")]);
        let l = decision_law(&b, "benefit_decision", Some("pension"));
        let mut d = Waits::new("outside");
        d.state::<()>(&b, l.as_ref(), &c, 0);
        assert!(matches!(d.state::<()>(&b, l.as_ref(), &c, 3 * DAY), Waiting::Ready(_)));
    }

    #[test]
    fn a_confirmation_from_the_claimants_last_employer_is_asked_for_from_the_pay_reports_on_file_no_employer_on_file_nothing_to_wait_for() {
        let rule = json!({ "kind": "benefit_decision", "name": "x", "payments": ["jobseeker"], "needs": [{ "id": "employer", "from": "employer", "what": "that the job has ended", "within_days": 10, "else": "decide" }] });
        let report = statement("w1", 0, "withholding_report", json!({ "speaks_for": "shop", "addressed_to": ["outside"], "visible_to": ["shop", "outside"] }), json!({ "staff": [{ "worker": "a", "gross": 100_000 }] }));
        let jobseeker = |id: &str, who: &str| statement(id, DAY, "benefit_claim", json!({ "speaks_for": who, "addressed_to": ["outside"] }), json!({ "payment": "jobseeker" }));
        let b = book_of("outside", vec![law(vec![rule.clone()]), report, jobseeker("c1", "a")]);
        let l = decision_law(&b, "benefit_decision", Some("jobseeker"));
        let c = b.get("c1").unwrap().clone();
        let mut w = Waits::new("outside");
        let Waiting::Waiting(asked) = w.state::<()>(&b, l.as_ref(), &c, DAY) else { panic!("it waits for the employer") };
        assert_eq!(kinds(&asked), ["confirmation_request"]);
        let line = &asked[0].lines[0].call;
        assert_eq!(crate::finance::kit::json_arg(line, "to"), json!(["shop"]));
        assert_eq!(crate::finance::kit::json_arg(line, "data")["about"], "a");
        // Nobody reported pay for this claimant: there is no one to ask.
        let b = book_of("outside", vec![law(vec![rule]), jobseeker("c2", "b")]);
        let c = b.get("c2").unwrap().clone();
        let l = decision_law(&b, "benefit_decision", Some("jobseeker"));
        assert!(matches!(Waits::new("outside").state::<()>(&b, l.as_ref(), &c, DAY), Waiting::Ready(s) if s.is_empty()));
    }

    fn decision() -> Value {
        statement("dec1", 0, "benefit_decision", json!({ "speaks_for": "outside" }), json!({ "claim": "c1", "payment": "pension", "granted": false }))
    }
    fn ask(id: &str, at: i64, who: &str) -> Value {
        statement(id, at, "review_request", json!({ "speaks_for": who, "addressed_to": ["outside"], "visible_to": [who, "outside"] }), json!({ "matter": "claim_refused", "about": "dec1" }))
    }
    fn review_world(more: Vec<Value>) -> crate::common::Book {
        let mut rs = vec![law(vec![{ let mut r = route(); r["needs"] = json!([]); r }]), decision()];
        rs.extend(more);
        book_of("outside", rs)
    }

    #[test]
    fn a_refusal_asked_about_inside_the_laws_days_is_looked_at_again_found_wrong_it_is_put_right_with_a_record_and_an_answer() {
        let b = review_world(vec![ask("q1", 4 * DAY, "a")]);
        let mut r = Reconsiderations::new("outside", &["benefit_decision"]);
        let steps = r.steps::<()>(&b, 4 * DAY, |dec, _req| {
            assert_eq!(dec.id, "dec1");
            Some(Redone { changed: true, found: "the claim could be verified".into(), steps: vec![] })
        });
        assert_eq!(kinds(&steps), ["decision_review", "remedy_answer"]);
        let review = crate::finance::kit::json_arg(&steps[0].lines[0].call, "data");
        assert_eq!((review["outcome"].as_str(), review["asked_by"].as_str(), review["decision"].as_str()), (Some("changed"), Some("a"), Some("dec1")));
        let answer = crate::finance::kit::json_arg(&steps[0].lines[1].call, "data");
        assert_eq!((answer["granted"].as_bool(), answer["review"].as_str(), answer["matter"].as_str()), (Some(true), Some("changed"), Some("claim_refused")));
        assert_eq!(r.counts["review_changed"], 1);
    }

    #[test]
    fn a_second_request_on_the_same_decision_is_answered_from_the_first_and_one_found_right_stands() {
        let mut r = Reconsiderations::new("outside", &["benefit_decision"]);
        let mut calls = 0;
        let mut redo = |_: &Record, _: &Record| {
            calls += 1;
            Some(Redone::<()> { changed: false, found: "the claimant is too young".into(), steps: vec![] })
        };
        let first = r.steps(&review_world(vec![ask("q1", DAY, "a")]), DAY, &mut redo);
        assert_eq!(crate::finance::kit::json_arg(&first[0].lines[0].call, "data")["outcome"], "upheld");
        assert_eq!(crate::finance::kit::json_arg(&first[0].lines[1].call, "data")["granted"], false);
        let again = r.steps(&review_world(vec![ask("q1", DAY, "a"), ask("q2", 2 * DAY, "a")]), 2 * DAY, &mut redo);
        assert_eq!(crate::finance::kit::json_arg(&again[0].lines[0].call, "data")["found"], "it has been looked at already");
        assert_eq!(calls, 1, "looked at once");
    }

    #[test]
    fn after_the_days_the_law_gives_the_answer_is_no_and_says_so_and_the_decision_is_not_looked_at() {
        let mut r = Reconsiderations::new("outside", &["benefit_decision"]);
        let steps = r.steps::<()>(&review_world(vec![ask("q3", 31 * DAY, "a")]), 31 * DAY, |_, _| panic!("not looked at"));
        let review = crate::finance::kit::json_arg(&steps[0].lines[0].call, "data");
        assert_eq!(review["outcome"], "out_of_time");
        assert_eq!(crate::finance::kit::json_arg(&steps[0].lines[1].call, "data")["granted"], false);
        assert!(steps[0].why.as_deref().unwrap().contains("the law allows 30 days to ask, and the decision was made 31 days ago"));
    }

    #[test]
    fn a_request_about_a_decision_of_a_kind_whose_law_has_no_review_is_not_looked_at_and_one_it_cannot_yet_redo_is_kept_for_the_next_round() {
        let mut no_review = route();
        no_review["review"] = Value::Null;
        no_review["needs"] = json!([]);
        let b = book_of("outside", vec![law(vec![no_review]), decision(), ask("q", DAY, "b")]);
        assert!(Reconsiderations::new("outside", &["benefit_decision"]).steps::<()>(&b, DAY, |_, _| panic!("no review in the law")).is_empty());
        // One the office cannot do yet (it declines to say): not handled, so it is taken up at the next round.
        let mut r = Reconsiderations::new("outside", &["benefit_decision"]);
        assert!(r.steps::<()>(&review_world(vec![ask("q", DAY, "b")]), DAY, |_, _| None).is_empty());
        let next = r.steps::<()>(&review_world(vec![ask("q", DAY, "b")]), 2 * DAY, |_, _| Some(Redone { changed: false, found: "fine".into(), steps: vec![] }));
        assert_eq!(kinds(&next), ["decision_review", "remedy_answer"]);
    }

    #[test]
    fn a_library_saves_and_restores_exactly() {
        let mut w = Waits::new("outside");
        let b = book_of("outside", vec![law(vec![route()]), claim("c1", "a")]);
        let c = b.get("c1").unwrap().clone();
        w.state::<()>(&b, decision_law(&b, "benefit_decision", Some("pension")).as_ref(), &c, 0);
        let back: Waits = serde_json::from_value(serde_json::to_value(&w).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(&back).unwrap(), serde_json::to_value(&w).unwrap());
        // Restored, it does not ask again.
        let mut back = back;
        assert!(matches!(back.state::<()>(&b, decision_law(&b, "benefit_decision", Some("pension")).as_ref(), &c, DAY), Waiting::Waiting(s) if s.is_empty()));
    }
}
