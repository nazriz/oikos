//! What a decision waits for, and how it is looked at again: the law's part (participants/src/behaviour/decisions.ts,
//! docs/behaviour/decisions.md; foundations law 5, step F8). Pure: the law as data in, words and deadlines out. The offices'
//! acts that follow from it (asking for papers, looking at a decision again) are `actors::finance::decisions`.
//!
//! Review and appeal of a decision are routes the law states, as data, for any kind of decision. The world publishes a law
//! (`data.decisions`, a list of rules, each for a kind of decision and, where it differs by payment, for some payments
//! only) saying what the decision waits for (`needs`), that the office will look at it again if asked (`review`), what
//! venue hears an appeal (`appeal`) and who may refuse (`refused_by`). Nothing here makes a decision wait or come out
//! differently by itself: a rule is a statement, and the office's own acts, which take its time, do the rest.
//!
//! Decided fresh in Rust: a rule is read once into a typed `DecisionLaw` (lenient about whole numbers a seat's law might
//! write as digits); which of several rules for one kind governs is `governing`, with the rule TS applied (a rule for
//! named payments is the more particular and wins over one for the kind; among equals, the law published later).

use serde::{Deserialize, Serialize};
use oikos_core::Frozen;
use serde_json::Value;

pub const DAY: i64 = 86_400;

/// Where a need's papers come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum From {
    /// The claimant's own papers.
    Claimant,
    /// The claimant's last employer (found from the pay reports on the office's file).
    Employer,
}

/// What comes of a need that was not met in time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Else {
    /// The claim is refused.
    Refuse,
    /// The claim is decided on what is on hand.
    Decide,
}

/// What a decision waits for before it is made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Need {
    pub id: String,
    pub from: From,
    /// In words: what is asked for.
    pub what: String,
    /// Within so many days of the asking.
    #[serde(deserialize_with = "whole")]
    pub within_days: i64,
    #[serde(rename = "else")]
    pub otherwise: Else,
}

/// That the office whose decision it was will look at it again if asked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewRoute {
    /// Asked within so many days of the decision.
    #[serde(deserialize_with = "whole")]
    pub within_days: i64,
    pub grounds: String,
    /// An appeal lies only after a review has been asked for and answered.
    #[serde(default)]
    pub required: bool,
    /// Where the law says so: a review asked for and not answered within so many days of the asking is taken as
    /// refused (a deemed refusal), and the appeal's days run from then. None: silence is only silence.
    #[serde(default, deserialize_with = "opt_whole", skip_serializing_if = "Option::is_none")]
    pub deemed_refused_days: Option<i64>,
    /// Where the law has no deemed refusal but a body that recommends (an ombudsman, a complaints examiner, a
    /// representative's caseworker) takes up an agency's delay: a review asked for and not answered within so many
    /// days of the asking may be complained of there. It opens no appeal; it is a complaint, heard by that body at its
    /// own cost and time, and what it recommends binds nobody (MT-21).
    #[serde(default, deserialize_with = "opt_whole", skip_serializing_if = "Option::is_none")]
    pub complaint_after_days: Option<i64>,
}

impl ReviewRoute {
    /// When a review asked for at `asked` and not answered is taken as refused, if the law has a deemed refusal.
    pub fn deemed_refused_at(&self, asked: i64) -> Option<i64> {
        self.deemed_refused_days.map(|d| asked + d * DAY)
    }

    /// From when a review asked for at `asked` and not answered may be complained of to a body that recommends.
    pub fn complaint_from(&self, asked: i64) -> Option<i64> {
        self.complaint_after_days.map(|d| asked + d * DAY)
    }
}

/// The venue that can set the decision aside.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppealRoute {
    /// The matter a venue that can set the decision aside says it hears.
    pub matter: String,
    /// Within so many days of the decision, or of the review's answer where a review is required.
    #[serde(deserialize_with = "whole")]
    pub within_days: i64,
    pub grounds: String,
    /// What applying costs, in the smallest unit of the money (none: nothing).
    #[serde(default, deserialize_with = "opt_whole", skip_serializing_if = "Option::is_none")]
    pub fee: Option<i64>,
}

/// Who may refuse a claim where the office is a head and staff.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RefusedBy {
    /// The head alone.
    #[serde(rename = "office-holder")]
    OfficeHolder,
    /// The staff as well.
    #[serde(rename = "staff")]
    Staff,
}

/// One rule of the law: how a kind of decision is made, looked at again and appealed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecisionLaw {
    /// The kind of decision: the kind of statement the office makes.
    pub kind: String,
    #[serde(default)]
    pub name: String,
    /// For these payments only (a support payment's id); none: for every decision of the kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payments: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub needs: Vec<Need>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review: Option<ReviewRoute>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appeal: Option<AppealRoute>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refused_by: Option<RefusedBy>,
}

fn whole<'de, D: serde::Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    let v = Value::deserialize(d)?;
    match &v {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
    .ok_or_else(|| serde::de::Error::custom(format!("not a whole number: {v}")))
}
fn opt_whole<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    Ok(match Option::<Value>::deserialize(d)? {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => s.trim().parse().ok(),
        _ => None,
    })
}

/// A law on file, as far as this reads it: when it was published and its `data`. (The caller passes the laws in force.)
#[derive(Debug, Clone, Copy)]
pub struct OnFile<'a> {
    pub at: i64,
    pub data: &'a Frozen,
}

/// The rules a law's data carries (`data.decisions`), those that read; a malformed rule is not a rule (decisions.ts
/// took the list as it came and ignored what lacked a `kind`).
pub fn rules_of(data: &Frozen) -> Vec<DecisionLaw> {
    match data.get("decisions") {
        Some(Frozen::Array(list)) => list.iter().filter_map(|r| oikos_core::frozen::from_frozen(r).ok()).collect(),
        _ => vec![],
    }
}

/// The law on file for a decision of a kind (and, where it differs by payment, for that payment): the latest published
/// and not withdrawn. A rule for named payments is the more particular, and wins over one for the kind; of two equally
/// particular, the later wins, and of two at the same moment the one filed first of those given (as TS's `>`).
pub fn decision_law<'a>(laws: impl IntoIterator<Item = OnFile<'a>>, kind: &str, payment: Option<&str>) -> Option<DecisionLaw> {
    let mut best: Option<(i64, DecisionLaw)> = None;
    for l in laws {
        for d in rules_of(l.data) {
            if d.kind != kind {
                continue;
            }
            let fits = match &d.payments {
                None => true,
                Some(ps) => payment.is_some_and(|p| ps.iter().any(|x| x == p)),
            };
            if !fits {
                continue;
            }
            // (Scored as TS did: a rule for named payments outweighs any date.)
            let score = if d.payments.is_some() { 1_000_000_000_000_000 } else { 0 } + l.at;
            if best.as_ref().is_none_or(|(s, _)| score > *s) {
                best = Some((score, d));
            }
        }
    }
    best.map(|(_, d)| d)
}

/// The law on file whose appeal is about this matter (a venue that hears it reads the days an appeal may be made in).
/// Of several, the latest published (the later of two at one moment).
pub fn appeal_law<'a>(laws: impl IntoIterator<Item = OnFile<'a>>, matter: &str) -> Option<DecisionLaw> {
    let mut best: Option<(i64, DecisionLaw)> = None;
    for l in laws {
        for d in rules_of(l.data) {
            if d.appeal.as_ref().is_some_and(|a| a.matter == matter) && best.as_ref().is_none_or(|(at, _)| l.at >= *at) {
                best = Some((l.at, d));
            }
        }
    }
    best.map(|(_, d)| d)
}

/// What a rule says, in words a law's text can carry (neutral: the places' figures are the profile's). `written` words an
/// amount in the world's money.
pub fn decisions_in_words(rules: &[DecisionLaw], written: impl Fn(i64) -> String) -> String {
    rules
        .iter()
        .map(|r| {
            let mut parts: Vec<String> = vec![];
            for n in &r.needs {
                parts.push(format!(
                    "before it is decided, {} {}, to send it within {} days; {}",
                    if n.from == From::Claimant { "the claimant is asked for" } else { "the claimant's last employer is asked to confirm" },
                    n.what,
                    n.within_days,
                    if n.otherwise == Else::Refuse { "if it does not come in time, the claim is refused" } else { "if it does not come in time, the claim is decided on what is on hand" },
                ));
            }
            if let Some(v) = &r.review {
                parts.push(format!(
                    "the office that made the decision will look at it again if asked within {} days of it ({}){}",
                    v.within_days,
                    v.grounds,
                    if v.required { ", and an appeal lies only after that" } else { "" }
                ));
                if let Some(d) = v.deemed_refused_days {
                    let last = parts.pop().unwrap_or_default();
                    parts.push(format!("{last}; a review not answered within {d} days of being asked for is taken as refused"));
                }
                if let Some(d) = v.complaint_after_days {
                    let last = parts.pop().unwrap_or_default();
                    parts.push(format!("{last}; a review not answered within {d} days of being asked for may be complained of to a body that hears such complaints, which may recommend but not order"));
                }
            }
            if let Some(a) = &r.appeal {
                let after = match &r.review {
                    Some(v) if v.required && v.deemed_refused_days.is_some() => "the answer to the review, or of the day it is taken as refused",
                    Some(v) if v.required => "the answer to the review",
                    _ => "the decision",
                };
                let fee = match a.fee {
                    Some(f) if f != 0 => format!("applying costs {}", written(f)),
                    _ => "applying costs nothing".to_string(),
                };
                parts.push(format!(
                    "it may be appealed to a body that hears {} and can set it aside, within {} days of {} ({}); {}",
                    a.matter.replace('_', " "),
                    a.within_days,
                    after,
                    a.grounds,
                    fee
                ));
            }
            match r.refused_by {
                Some(RefusedBy::OfficeHolder) => parts.push("where the office has staff under a head, only the head refuses a claim".into()),
                Some(RefusedBy::Staff) => parts.push("the office's staff may refuse a claim".into()),
                None => {}
            }
            let for_payments = r.payments.as_ref().map(|p| format!(" ({})", p.join(", "))).unwrap_or_default();
            format!("{}{}: {}.", r.name, for_payments, parts.join("; "))
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The time a decision's review or appeal may still be asked, from its date: whole days left (negative: gone).
pub fn days_left(from: i64, within_days: i64, t: i64) -> i64 {
    within_days - (t - from).div_euclid(DAY)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn law(at: i64, rules: Value) -> (i64, Frozen) {
        (at, Frozen::from(json!({ "decisions": rules })))
    }
    fn on_file(laws: &[(i64, Frozen)]) -> Vec<OnFile<'_>> {
        laws.iter().map(|(at, data)| OnFile { at: *at, data }).collect()
    }

    #[test]
    fn a_rule_for_named_payments_is_the_more_particular_and_beats_a_later_rule_for_the_kind() {
        let laws = [
            law(10, json!([{ "kind": "claim_decision", "name": "Support", "review": { "within_days": 28, "grounds": "any" } }])),
            law(5, json!([{ "kind": "claim_decision", "name": "Carers", "payments": ["carer"], "review": { "within_days": 14, "grounds": "error" } }])),
        ];
        let d = decision_law(on_file(&laws), "claim_decision", Some("carer")).unwrap();
        assert_eq!(d.name, "Carers", "named payments win though earlier");
        let d = decision_law(on_file(&laws), "claim_decision", Some("pension")).unwrap();
        assert_eq!(d.name, "Support", "a payment the named rule does not list falls to the kind's rule");
        assert_eq!(decision_law(on_file(&laws), "claim_decision", None).unwrap().name, "Support");
        assert!(decision_law(on_file(&laws), "other_decision", None).is_none());
    }

    #[test]
    fn of_two_laws_for_one_kind_the_later_published_governs() {
        let laws = [law(5, json!([{ "kind": "k", "name": "old" }])), law(9, json!([{ "kind": "k", "name": "new" }]))];
        assert_eq!(decision_law(on_file(&laws), "k", None).unwrap().name, "new");
        let laws = [law(9, json!([{ "kind": "k", "name": "new" }])), law(5, json!([{ "kind": "k", "name": "old" }]))];
        assert_eq!(decision_law(on_file(&laws), "k", None).unwrap().name, "new", "not the order of filing");
    }

    #[test]
    fn a_rule_is_read_leniently_and_a_malformed_one_is_not_a_rule() {
        let data = json!({ "decisions": [
            { "kind": "k", "name": "n", "needs": [{ "id": "a", "from": "employer", "what": "pay", "within_days": "14", "else": "decide" }],
              "appeal": { "matter": "support_appeal", "within_days": 30, "grounds": "g", "fee": "2500" }, "refused_by": "office-holder" },
            { "name": "no kind" },
            { "kind": "bad", "needs": [{ "id": "a", "from": "nobody" }] },
        ] });
        let rules = rules_of(&oikos_core::Frozen::of(&data));
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].needs[0].within_days, 14);
        assert_eq!(rules[0].needs[0].otherwise, Else::Decide);
        assert_eq!(rules[0].appeal.as_ref().unwrap().fee, Some(2500));
        assert_eq!(rules[0].refused_by, Some(RefusedBy::OfficeHolder));
    }

    #[test]
    fn the_appeal_law_for_a_matter_is_the_latest_that_names_it() {
        let laws = [
            law(3, json!([{ "kind": "a", "name": "A", "appeal": { "matter": "m", "within_days": 10, "grounds": "g" } }])),
            law(8, json!([{ "kind": "b", "name": "B", "appeal": { "matter": "m", "within_days": 20, "grounds": "g" } }])),
            law(9, json!([{ "kind": "c", "name": "C", "appeal": { "matter": "other", "within_days": 5, "grounds": "g" } }])),
        ];
        assert_eq!(appeal_law(on_file(&laws), "m").unwrap().kind, "b");
        assert!(appeal_law(on_file(&laws), "none").is_none());
    }

    #[test]
    fn the_rules_in_words_say_what_is_asked_and_when() {
        let data = json!({ "decisions": [{ "kind": "k", "name": "Support", "payments": ["carer"],
            "needs": [{ "id": "a", "from": "claimant", "what": "proof of care", "within_days": 14, "else": "refuse" }],
            "review": { "within_days": 28, "grounds": "error", "required": true },
            "appeal": { "matter": "support_appeal", "within_days": 30, "grounds": "wrong law", "fee": 2500 },
            "refused_by": "staff" }] });
        let words = decisions_in_words(&rules_of(&oikos_core::Frozen::of(&data)), |n| format!("${}.{:02}", n / 100, n % 100));
        assert_eq!(
            words,
            "Support (carer): before it is decided, the claimant is asked for proof of care, to send it within 14 days; if it does not come in time, the claim is refused; \
the office that made the decision will look at it again if asked within 28 days of it (error), and an appeal lies only after that; \
it may be appealed to a body that hears support appeal and can set it aside, within 30 days of the answer to the review (wrong law); applying costs $25.00; \
the office's staff may refuse a claim."
        );
    }

    #[test]
    fn a_deemed_refusal_is_said_in_the_words_and_dated_from_the_asking() {
        let data = json!({ "decisions": [{ "kind": "k", "name": "Support",
            "review": { "within_days": 30, "grounds": "any", "required": true, "deemed_refused_days": 91 },
            "appeal": { "matter": "claim_refused", "within_days": 30, "grounds": "any error" } }] });
        let rules = rules_of(&oikos_core::Frozen::of(&data));
        let words = decisions_in_words(&rules, |n| format!("{n}"));
        assert_eq!(
            words,
            "Support: the office that made the decision will look at it again if asked within 30 days of it (any), and an appeal lies only after that; \
a review not answered within 91 days of being asked for is taken as refused; \
it may be appealed to a body that hears claim refused and can set it aside, within 30 days of the answer to the review, or of the day it is taken as refused (any error); applying costs nothing."
        );
        let review = rules[0].review.as_ref().unwrap();
        assert_eq!(review.deemed_refused_at(5 * DAY), Some(96 * DAY));
        let none = rules_of(&oikos_core::Frozen::from(json!({ "decisions": [{ "kind": "k", "name": "S", "review": { "within_days": 30, "grounds": "any", "required": true } }] })));
        assert_eq!(none[0].review.as_ref().unwrap().deemed_refused_at(0), None, "no deemed refusal unless the law says so");
        assert_eq!(none[0].review.as_ref().unwrap().complaint_from(0), None, "no complaint of delay unless the law says so");
        // Where the law has a complaint of delay instead (MT-21): said in the words, dated from the asking, opening no appeal.
        let c = rules_of(&oikos_core::Frozen::from(json!({ "decisions": [{ "kind": "k", "name": "S", "review": { "within_days": 30, "grounds": "any", "required": true, "complaint_after_days": 21 } }] })));
        assert_eq!(c[0].review.as_ref().unwrap().complaint_from(5 * DAY), Some(26 * DAY));
        assert_eq!(c[0].review.as_ref().unwrap().deemed_refused_at(5 * DAY), None);
        assert!(decisions_in_words(&c, |n| format!("{n}")).contains("not answered within 21 days of being asked for may be complained of to a body that hears such complaints, which may recommend but not order"));
    }

    #[test]
    fn days_left_counts_whole_days_and_goes_negative_when_the_time_is_gone() {
        assert_eq!(days_left(0, 28, 0), 28);
        assert_eq!(days_left(0, 28, 27 * DAY + 86_399), 1);
        assert_eq!(days_left(0, 28, 28 * DAY), 0);
        assert_eq!(days_left(0, 28, 29 * DAY), -1);
        assert_eq!(days_left(100, 5, 50), 6, "before the decision's own date counts as more time, never panics");
    }
}
