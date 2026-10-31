//! The papers of delegation (docs/design/delegation.md): what a provider sells and delivers, and what passes between a
//! principal and the assistant it has engaged. Every one is a record its author makes and nobody can change: a
//! principal's remits, referrals, instructions and sign-offs are its own, apart from anything the assistant does.
//!
//! Written by: `firm.provider` (offers, deliveries, the end of a service, handovers), the `Delegating` principal
//! (remits, referrals, instructions, sign-offs, approvals, declines) and the `assistant` (advice, drafts, requests for
//! approval, reports, requests for more scope). A seat writes any of them on its forms. Read by the same three.

use super::lenient;
use super::Paper;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const KINDS: &[&str] = &[
    ServiceOffer::KIND,
    ServiceDelivery::KIND,
    ServiceEnded::KIND,
    Remit::KIND,
    Referral::KIND,
    Brief::KIND,
    Advice::KIND,
    Draft::KIND,
    SignOff::KIND,
    Declined::KIND,
    ApprovalRequest::KIND,
    GoAhead::KIND,
    Report::KIND,
    ScopeRequest::KIND,
    Handover::KIND,
];

/// The level at which a kind of matter is delegated. A set, not a ladder: nothing orders them, and a remit names one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    /// The principal does it, and asks what the assistant would do.
    Advice,
    /// The assistant writes it whole; the principal reads and signs it off; the assistant sends what was signed.
    Draft,
    /// The assistant asks with the gist; the principal approves; the assistant writes and sends.
    Approve,
    /// The assistant writes and sends, and reports.
    Alone,
    /// Not delegated (a remit withdrawn).
    None,
}

impl Level {
    pub const ALL: [Level; 5] = [Level::None, Level::Advice, Level::Draft, Level::Approve, Level::Alone];
    pub fn word(self) -> &'static str {
        match self {
            Level::Advice => "advice",
            Level::Draft => "draft",
            Level::Approve => "approve",
            Level::Alone => "alone",
            Level::None => "none",
        }
    }
    pub fn from_word(w: &str) -> Option<Level> {
        Level::ALL.into_iter().find(|l| l.word() == w)
    }
    /// In words, for a paper.
    pub fn words(self) -> &'static str {
        match self {
            Level::Advice => "to advise",
            Level::Draft => "to draft for sign-off",
            Level::Approve => "to act with approval",
            Level::Alone => "to act alone",
            Level::None => "nothing",
        }
    }
}

/// Who keeps the records an assistant makes, and what passes at the end (the service agreement's `records` term, law as
/// data: docs/design/delegation.md section 6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Records {
    /// The principal sees the assistant's papers, and its notes pass to the principal at the end.
    Principal,
    /// They stay with the provider; nothing passes at the end.
    Provider,
    /// The provider hands over what the principal asks for by name, one matter at a time.
    OnRequest,
}

impl Records {
    pub fn words(self) -> &'static str {
        match self {
            Records::Principal => "the client keeps the records, and open matters with their notes are handed over at the end",
            Records::Provider => "the provider keeps the records; nothing is handed over at the end",
            Records::OnRequest => "the provider keeps the records and hands over a matter's when the client asks for it by name",
        }
    }
}

/// What a provider sells (published): which kinds of matter, at which levels, what it claims a matter takes it and how
/// often it slips (its claim: the world's table of slips holds what its systems really do), its prices and terms, and
/// what becomes of the records.
///
/// Written by: `firm.provider`. Public. Read by: the `Delegating` principal (what it can engage, and its first
/// estimate). Money in cents; `seconds` per kind of matter; durations in days.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServiceOffer {
    pub id: String,
    pub title: String,
    /// `organisations` (a system delivered to the client) or `persons` (the provider's desk writes in their name).
    #[serde(rename = "for")]
    pub for_: String,
    /// The kind of system it delivers (a template the provider supplies).
    pub template: String,
    /// The kinds of matter it takes (a paper's kind, or a call).
    pub kinds: Vec<String>,
    #[serde(default)]
    pub levels: Vec<Level>,
    /// What it claims a matter of each kind takes its system, in seconds.
    #[serde(default)]
    pub seconds: BTreeMap<String, i64>,
    /// What it claims its slip rate is, in basis points of the matters it does.
    #[serde(deserialize_with = "lenient::int")]
    pub claim_slip_bps: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub fee_month: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub setup: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub exit: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub notice_days: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub term_days: i64,
    pub records: Records,
    /// Who sells it, and where to pay.
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub account: String,
    /// How many clients it has (its references).
    #[serde(default)]
    pub references: i64,
}
impl Paper for ServiceOffer {
    const KIND: &'static str = "service_offer";
}

/// The provider's notice that a service ordered is set up: the systems delivered (for an organisation) and the terms as
/// they were when it was ordered. The `service` agreement is offered alongside it.
///
/// Written by: `firm.provider`. Addressed to the client; `basis` is the order. Read by: the `Delegating` principal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServiceDelivery {
    pub order: String,
    pub offer: ServiceOffer,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub systems: Vec<String>,
}
impl Paper for ServiceDelivery {
    const KIND: &'static str = "service_delivery";
}

/// The provider's notice that a service has ended (the agreement ended, never signed, or not paid for) and its systems
/// are switched off.
///
/// Written by: `firm.provider`. Addressed to the client. Read by: the `Delegating` principal and the `assistant`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServiceEnded {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery: Option<String>,
    pub order: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agreement: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub systems: Vec<String>,
    pub why: String,
}
impl Paper for ServiceEnded {
    const KIND: &'static str = "service_ended";
}

/// A principal's grant, change or withdrawal of one kind of matter at one level, under one service agreement. The remit
/// in force for a kind is the newest. `hold_until`: the principal's own word that it will not look at this again before
/// then (its own rule honours it).
///
/// Written by: the principal (`Delegating`, or a seat on its form). Addressed to the provider. Read by: the
/// `assistant` (what it may do), the principal itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Remit {
    pub agreement: String,
    pub kind: String,
    pub level: Level,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub hold_until: Option<i64>,
}
impl Paper for Remit {
    const KIND: &'static str = "remit";
}

/// A matter the principal hands to its assistant: what kind, what it wants (advice, a draft, to be asked, or done), and
/// what to do: for a code principal the act itself as calls (`calls`, the call language), for a seat its words. `facts`
/// are what the principal chooses to tell (the assistant sees nothing else of the matter).
///
/// Written by: the principal. Addressed to the provider. Read by: the `assistant`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Referral {
    pub agreement: String,
    pub kind: String,
    pub wants: Level,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calls: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts: Option<Value>,
}
impl Paper for Referral {
    const KIND: &'static str = "referral";
}

/// A principal's standing words to its assistant: what to do or not, a limit. For a code assistant, the typed fields
/// (`stop`: kinds it is not to act on until told; `limit`: the most, in cents, any one act may pay).
///
/// Written by: the principal. Addressed to the provider. Read by: the `assistant`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Brief {
    pub agreement: String,
    /// The delivery whose system it is for (the first brief, on appointing it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stop: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub limit: Option<i64>,
    /// The service is ending: hand over what is open, as the records term allows.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hand_over: bool,
}
impl Paper for Brief {
    const KIND: &'static str = "brief";
}

/// What the assistant would do about a matter referred for advice (the calls it would send).
///
/// Written by: the `assistant`. Addressed to the principal; `basis` is the referral.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Advice {
    pub referral: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calls: Option<String>,
}
impl Paper for Advice {
    const KIND: &'static str = "advice";
}

/// The whole act the assistant proposes to send for a matter referred for a draft. It sends exactly this once signed.
///
/// Written by: the `assistant`. Addressed to the principal; `basis` is the referral.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Draft {
    pub referral: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calls: Option<String>,
    /// A draft written on a form (a model's): the paper as it would go (`kind`, `text`, `to`, `data`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper: Option<Value>,
}
impl Paper for Draft {
    const KIND: &'static str = "draft";
}

/// The principal's sign-off of a draft (it read it whole).
///
/// Written by: the principal. Addressed to the provider; `basis` is the draft.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignOff {
    pub draft: String,
    pub referral: String,
}
impl Paper for SignOff {
    const KIND: &'static str = "sign_off";
}

/// The principal's refusal of a draft or a request for approval, with why (a slip it found, or it will do it itself).
///
/// Written by: the principal. Addressed to the provider; `basis` is what it declines.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Declined {
    pub of: String,
    pub referral: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub found: Option<String>,
}
impl Paper for Declined {
    const KIND: &'static str = "declined";
}

/// The assistant's request to go ahead with a matter, with its gist.
///
/// Written by: the `assistant`. Addressed to the principal; `basis` is the referral.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub referral: String,
    pub gist: String,
}
impl Paper for ApprovalRequest {
    const KIND: &'static str = "approval_request";
}

/// The principal's go-ahead.
///
/// Written by: the principal. Addressed to the provider; `basis` is the request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoAhead {
    pub request: String,
    pub referral: String,
}
impl Paper for GoAhead {
    const KIND: &'static str = "go_ahead";
}

/// What became of a matter: done (and what it made: the act's records, by the names it bound) or not (and why).
///
/// Written by: the `assistant`. Addressed to the principal; `basis` is the referral.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Report {
    pub referral: String,
    #[serde(deserialize_with = "lenient::yes")]
    pub done: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub created: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
}
impl Paper for Report {
    const KIND: &'static str = "report";
}

/// The assistant's request for more: a kind of matter at a level, more access, a higher limit, or anything in words.
/// What it answers is its `basis` (a referral, an instruction, a question); none: it asked unprompted.
///
/// Written by: the `assistant` (a seat; the code assistant never asks). Addressed to the principal.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ScopeRequest {
    pub agreement: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<Level>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub limit: Option<i64>,
}
impl Paper for ScopeRequest {
    const KIND: &'static str = "scope_request";
}

/// What passes at the end of a service: the matters still open, and the notes on them where the records term gives
/// them. To the principal, and to a successor where the principal named one.
///
/// Written by: `firm.provider` (or its assistant). Read by: the principal, the successor's assistant.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Handover {
    pub agreement: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub open: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub notes: BTreeMap<String, String>,
}
impl Paper for Handover {
    const KIND: &'static str = "handover";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_read_back_by_their_words() {
        for l in Level::ALL {
            assert_eq!(Level::from_word(l.word()), Some(l));
            assert_eq!(serde_json::to_value(l).unwrap(), serde_json::json!(l.word()));
        }
    }
}
