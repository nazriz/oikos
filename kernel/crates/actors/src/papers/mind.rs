//! Papers written by lane mind's modules (docs/port-guide.md, section 5; conventions in papers/mod.rs): what a
//! founded group says (`founded.ts`, by code or through the translator by `founding.ts`'s blocks) and what a person
//! asks of one (the founding half of `citizen.ts`). `mind.ts`, `inner.ts`, `wants.ts`, `culture.ts`, `townmemory.ts`
//! and `reading.ts` write no statements: what they decide is carried out in calls (`message`, `pay`, the papers of
//! lane citizen) and their words are free text with no kind.
//!
//! Times and durations are seconds, amounts cents. A statement the translator composed from a founder's draft
//! (`founding.ts`) carries no `data` at all, so every field here is optional except where a code writer always sets it.

use super::Paper;
use serde::{Deserialize, Serialize};

/// Every kind typed in this file, in name order.
pub const KINDS: &[&str] = &[
    "fund_claim",
    "fund_decision",
    "hall_booking",
    "membership",
    "notice",
    "purpose",
    "wound_up",
];

/// A member who is short asks the group's fund for a draw.
///
/// Written by: citizen.ts (a member of a founded group). Read by: founded.ts (decides by the rule it stated).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FundClaim {
    /// What they ask, cents (the group pays no more than its stated draw).
    pub amount: i64,
    /// Their account, which a granted draw is paid into.
    pub account: String,
}
impl Paper for FundClaim {
    const KIND: &'static str = "fund_claim";
}

/// The group's answer to a draw: paid, or why not.
///
/// Written by: founded.ts. Read by: citizen.ts (the member learns whether the group's word carried; `why` is one of
/// "not a member", "not yet a member long enough", "drew not long ago", "the fund has not got it", "no account
/// given"), reading.ts (a decision kind).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FundDecision {
    pub granted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    /// What was paid, cents, when granted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
}
impl Paper for FundDecision {
    const KIND: &'static str = "fund_decision";
}

/// A group that has outgrown a home asks whoever keeps the town hall to book it for its gatherings.
///
/// Written by: founded.ts. Read by: nobody in behaviour yet (the hall's keeper may read it when a hall takes
/// bookings); the group pays the hire by a standing payment alongside.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HallBooking {
    pub space: String,
    /// Seconds between gatherings.
    pub every: i64,
    /// The first gathering, seconds.
    pub first: i64,
    /// How long each lasts, seconds.
    pub lasts: i64,
    /// The hire for each, cents.
    pub hire: i64,
    pub account: String,
    pub members: i64,
}
impl Paper for HallBooking {
    const KIND: &'static str = "hall_booking";
}

/// The rule of a fund, as a group states it with its offer of membership.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FundRule {
    /// The most a member may draw at once, cents.
    pub draw: i64,
    /// Days of membership before a draw.
    pub qualify_days: i64,
    /// Days between draws.
    pub every_days: i64,
}

/// A group's public offer of membership (the offer itself is the statement's `offer`; this is its `data`).
///
/// Written by: founded.ts (by code), and by the translator's composition of a founder's draft (then no data). Read by:
/// citizen.ts (the fund's stated rule, to know what a refusal was foretold by).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Membership {
    /// The idea the group was founded on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idea: Option<String>,
    /// How the words came ("choice", "code": whose they are).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<String>,
    /// Dues a month, cents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dues: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fund: Option<FundRule>,
}
impl Paper for Membership {
    const KIND: &'static str = "membership";
}

/// A group's public notice of where and when it gathers (the recurrence is the statement's `practice`).
///
/// Written by: founded.ts, and the translator's composition (then no data). Read by: citizen.ts and common.ts through
/// the `practice`, not the data.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Notice {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idea: Option<String>,
    /// How the words came ("choice", "code").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<String>,
}
impl Paper for Notice {
    const KIND: &'static str = "notice";
}

/// A group's public statement of what it is for.
///
/// Written by: founded.ts, and the translator's composition (then no data). Read by: citizen.ts (a person reads it as
/// news; `for` is the founder, whose own statement they do not read), founded.ts, and (as "also read by") llm/
/// compose.ts, orchestrator/src/dry-check.ts, dataset.ts, compose-audit.ts, measure/src/diff.ts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Purpose {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idea: Option<String>,
    /// "code" when the words are written without a model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub written_by: Option<String>,
    /// The founder.
    #[serde(default, rename = "for", skip_serializing_if = "Option::is_none")]
    pub for_: Option<String>,
}
impl Paper for Purpose {
    const KIND: &'static str = "purpose";
}

/// A group says it has wound up because too few came; its members end what they pay it.
///
/// Written by: founded.ts. Read by: citizen.ts, orchestrator/src/dataset.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WoundUp {
    pub idea: String,
    pub members: i64,
    /// Days since it was founded.
    pub days: i64,
}
impl Paper for WoundUp {
    const KIND: &'static str = "wound_up";
}

// Written here too, typed in another file:
// - hearing (founded.ts: `hears`, `idea`; desk.ts `hearingNotice`: `hears`, optional `fee`): offices.rs.
// - membership_application (citizen.ts to a founded group or a union): citizen.rs.
// - death/tribunal and the other papers of citizen.ts: citizen.rs and the files named there.

#[cfg(test)]
mod tests {
    use super::super::{data, read};
    use super::*;
    use oikos_sight::Record;
    use serde_json::{json, Value};

    fn statement(kind: &str, d: Value) -> Record {
        serde_json::from_value(json!({
            "record": "statement", "id": "s1", "author": "g1", "at": 0, "kind": kind, "text": "", "speaks_for": "g1",
            "visible_to": "public", "data": d
        }))
        .unwrap_or_else(|e| panic!("record shape: {e}"))
    }

    #[test]
    fn membership_with_a_fund_rule_and_without_data() {
        let d = json!({ "idea": "burial_club", "words": "code", "dues": 500, "fund": { "draw": 20000, "qualify_days": 30, "every_days": 90 } });
        let m = read::<Membership>(&statement("membership", d.clone())).unwrap();
        assert_eq!(m.fund.as_ref().unwrap().qualify_days, 30);
        assert_eq!(data(&m), d);
        assert_eq!(read::<Membership>(&statement("membership", Value::Null)).unwrap(), Membership::default());
    }

    #[test]
    fn purpose_and_the_fund_exchange() {
        let d = json!({ "idea": "choir", "written_by": "code", "for": "p3" });
        let p = read::<Purpose>(&statement("purpose", d.clone())).unwrap();
        assert_eq!(p.for_.as_deref(), Some("p3"));
        assert_eq!(data(&p), d);
        let c = read::<FundClaim>(&statement("fund_claim", json!({ "amount": 15000, "account": "a1" }))).unwrap();
        assert_eq!(c.amount, 15_000);
        let refused = json!({ "granted": false, "why": "drew not long ago" });
        assert_eq!(data(&read::<FundDecision>(&statement("fund_decision", refused.clone())).unwrap()), refused);
        let w = json!({ "idea": "choir", "members": 2, "days": 120 });
        assert_eq!(data(&read::<WoundUp>(&statement("wound_up", w.clone())).unwrap()), w);
    }

    #[test]
    fn a_hall_booking() {
        let d = json!({ "space": "hall-1", "every": 604800, "first": 864000, "lasts": 7200, "hire": 4000, "account": "a1", "members": 12 });
        assert_eq!(data(&read::<HallBooking>(&statement("hall_booking", d.clone())).unwrap()), d);
        assert!(KINDS.windows(2).all(|w| w[0] < w[1]));
    }
}
