//! Agreements as modules make and read them (docs/port-guide.md, section 5; common.ts `Outcome`, `commitmentOf`,
//! `leaseTerms`, `jobTerms`, `advertisedJob`, `offer`; the standard encoding, contracts §9.2). An agreement's terms are
//! opaque to the kernel apart from its parties: what each party commits to bring about is an `Outcome`, and how often.
//!
//! **Templates** (the agreement's `terms.template`): each is named here with who offers it, who reads it, and what its
//! commitments are. A module that makes one writes these commitments; a module that reads one reads them through the
//! functions below. Owned by step 1b; changed only with every lane named in a template's doc told.

use crate::common::{bases_of, data, is_kind, structure_of, Book, Fields, DAY};
use oikos_sight::{Record, RecordBody};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Employment: the employer pays a wage every period; the worker comes to the workplace (an occupancy), or does work
/// at a place (`work.at`), for its ordinary hours (`work.hours`, seconds a week). Offered by firms.ts (`Staffing`, a
/// job advertisement's offer), institutions and the outside world's agencies; read by citizen.ts (its job), firms.ts
/// and payroll.ts (pay), tax.ts (withholding), union.ts (members), openbooks/roster (seat side). Termination: notice by
/// either party (`termination`).
pub const EMPLOYMENT: &str = "employment";
/// A lease: the landlord gives the home (an occupancy `in` a dwelling space); the tenant pays rent every period
/// (`every: 2_592_000`, the rent's period as written). Offered by firms.ts (landlord, a rental listing's offer) and
/// genesis; read by citizen.ts (its home), firms.ts (rent book), tribunal.ts and institutions.ts (possession), tax.ts.
/// `then: periodic` where it runs on after its term until ended by notice.
pub const LEASE: &str = "lease";
/// A loan: the lender pays the principal out; the borrower repays every month. Offered by credit.ts (bank.lending);
/// read by citizen.ts, firms.ts (a firm's loan), credit.ts.
pub const LOAN: &str = "loan";
/// Membership of a body (a union, a founded group): the member pays dues every period. Offered by union.ts and
/// founded.ts (`membership_offer`); read by citizen.ts, union.ts, founded.ts, fund.ts.
pub const MEMBERSHIP: &str = "membership";
/// A sale of property (a building put up for sale on winding up): the buyer pays the price; the seller transfers.
/// Offered by firms.ts; read by firms.ts and citizen.ts.
pub const SALE: &str = "sale";
/// A trader's pitch in a market the town keeps: written at genesis between the town and the trader; read by
/// retailer.ts (an own-account trader) and government.ts.
pub const PITCH: &str = "pitch";
/// A licence for a system from its supplier (the bank's payment platform from the outside): genesis; read by bank.ts
/// and the outside world.
pub const LICENCE: &str = "licence";
/// What a newcomer the outside world brings to town is drawn as (world.ts arrivals: a template of a person, not an
/// agreement between parties): named here because modules compare against it.
pub const NEWCOMER: &str = "newcomer";

/// What a party commits to bring about (contracts: Outcome). One of its parts is set.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outcome {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work: Option<Work>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub money: Option<MoneyOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goods: Option<Goods>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occupancy: Option<Occupancy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<Structure>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Work {
    pub task: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    /// Ordinary hours in a week, in seconds.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "super::lenient::opt_int")]
    pub hours: Option<i64>,
}

/// Money to an account. `amount` is the smallest unit; a seat's paper may write it as a decimal string.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MoneyOutcome {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    pub to: String,
    #[serde(deserialize_with = "super::lenient::int")]
    pub amount: i64,
    #[serde(default, rename = "for", skip_serializing_if = "Option::is_none")]
    pub for_: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Goods {
    pub kind: String,
    /// As written (a decimal string).
    pub quantity: String,
    pub to: String,
    pub at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Occupancy {
    pub who: String,
    #[serde(rename = "in")]
    pub in_: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leave: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Structure {
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remove: Option<String>,
}

/// A commitment's outcome, read from its `does` (`{ outcome: ... }`); none where it is not one this crate reads.
pub fn outcome_of(does: &oikos_core::Frozen) -> Option<Outcome> {
    does.get("outcome").and_then(|o| oikos_core::frozen::from_frozen(o).ok())
}

/// An agreement's template, if the record is one.
pub fn template_of(a: &Record) -> Option<&str> {
    match &a.body {
        RecordBody::Agreement { terms } => terms.template.as_deref(),
        _ => None,
    }
}

/// An agreement's parties.
pub fn parties_of(a: &Record) -> &[String] {
    match &a.body {
        RecordBody::Agreement { terms } => &terms.parties,
        _ => &[],
    }
}

/// The other party to a two-party agreement.
pub fn other_party<'a>(a: &'a Record, me: &str) -> Option<&'a str> {
    parties_of(a).iter().find(|p| *p != me).map(String::as_str)
}

/// What a party commits to bring about in an agreement (its first commitment), and how often (common.ts
/// `commitmentOf`).
pub fn commitment_of(a: &Record, who: &str) -> (Option<Outcome>, Option<i64>) {
    let RecordBody::Agreement { terms } = &a.body else { return (None, None) };
    match terms.commitments.iter().find(|c| c.who == who) {
        Some(c) => (outcome_of(&c.does), c.every),
        None => (None, None),
    }
}

/// Every outcome a party commits to, in order.
pub fn commitments_of(a: &Record, who: &str) -> Vec<(Outcome, Option<i64>)> {
    let RecordBody::Agreement { terms } = &a.body else { return vec![] };
    terms.commitments.iter().filter(|c| c.who == who).filter_map(|c| outcome_of(&c.does).map(|o| (o, c.every))).collect()
}

/// A lease's rent (paid by the tenant, into which account) and home: the space given by the other party, and its
/// building (common.ts `leaseTerms`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LeaseTerms {
    pub rent: i64,
    pub rent_to: Option<String>,
    pub space: Option<String>,
    pub structure: Option<String>,
    /// How often the rent falls due (seconds), as the lease writes it.
    pub every: Option<i64>,
}

pub fn lease_terms(a: &Record, tenant: &str) -> LeaseTerms {
    let Some(other) = other_party(a, tenant) else { return LeaseTerms::default() };
    let (pays, every) = commitment_of(a, tenant);
    let money = pays.and_then(|o| o.money);
    let space = commitment_of(a, other).0.and_then(|o| o.occupancy).map(|o| o.in_);
    LeaseTerms {
        rent: money.as_ref().map_or(0, |m| m.amount),
        rent_to: money.map(|m| m.to),
        structure: space.as_deref().map(|s| structure_of(s).to_string()),
        space,
        every,
    }
}

/// The advertisement an employment agreement was made on, where it cites one: the advertisement itself, or the
/// application that answered it (docs/behaviour/firms.md, "An offer made on an advertisement"), as the reader has seen.
pub fn advertised_job<'a>(book: &'a Book, a: &Record) -> Option<&'a Arc<Record>> {
    if !matches!(a.body, RecordBody::Agreement { .. }) {
        return None;
    }
    for id in bases_of(a) {
        let Some(r) = book.get(id) else { continue };
        if is_kind(r, "job_posting") {
            return Some(r);
        }
        if is_kind(r, "job_application") {
            if let Some(p) = data(r).s("posting").and_then(|p| book.get(p)).filter(|p| is_kind(p, "job_posting")) {
                return Some(p);
            }
        }
    }
    None
}

/// A job's wage and pay period (from the employer), workplace (the space the worker commits to be in, or where the
/// work it commits to is done; else, with the reader's book, the advertised one), and ordinary hours a week where the
/// agreement states them (common.ts `jobTerms`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobTerms {
    pub wage: i64,
    /// Seconds (14 days where the agreement does not say).
    pub period: i64,
    pub workplace: Option<String>,
    pub hours: Option<i64>,
}

pub fn job_terms(a: &Record, worker: &str, book: Option<&Book>) -> JobTerms {
    let none = JobTerms { wage: 0, period: 14 * DAY, workplace: None, hours: None };
    let Some(employer) = other_party(a, worker) else { return none };
    let (pays, every) = commitment_of(a, employer);
    let theirs: Vec<Outcome> = commitments_of(a, worker).into_iter().map(|x| x.0).collect();
    let stated = theirs
        .iter()
        .find_map(|o| o.occupancy.as_ref().map(|x| x.in_.clone()).filter(|s| !s.is_empty()))
        .or_else(|| theirs.iter().find_map(|o| o.work.as_ref().and_then(|w| w.at.clone()).filter(|s| !s.is_empty())));
    let advertised = match (&stated, book) {
        (None, Some(b)) => advertised_job(b, a).and_then(|p| data(p).s("space").filter(|s| !s.is_empty()).map(String::from)),
        _ => None,
    };
    JobTerms {
        wage: pays.and_then(|o| o.money).map_or(0, |m| m.amount),
        period: every.unwrap_or(14 * DAY),
        workplace: stated.or(advertised),
        hours: theirs.iter().find_map(|o| o.work.as_ref().and_then(|w| w.hours)).filter(|h| *h > 0),
    }
}

/// The parts of an offer of an agreement (common.ts `offer`): with whom, on which template, what each side commits to,
/// its term and notices.
#[derive(Debug, Clone, Default)]
pub struct Offer {
    pub template: String,
    pub we: Option<oikos_sight::calls::Call>,
    pub they: Option<oikos_sight::calls::Call>,
    pub term: Option<i64>,
    pub periodic: bool,
    pub our_notice: Option<i64>,
    pub their_notice: Option<i64>,
    pub text: Option<String>,
    pub basis: Option<String>,
    /// An employment's ordinary hours in a week (seconds).
    pub hours: Option<i64>,
}

/// Offer an agreement (signed on our side).
pub fn offer(with_whom: &str, o: Offer) -> oikos_sight::calls::Call {
    use crate::steps::{arg, call, secs, text};
    use oikos_sight::calls::Value as A;
    let nz = |x: Option<i64>| x.filter(|v| *v != 0).map(secs);
    call(
        "agreement",
        vec![
            ("with", Some(arg(with_whom))),
            ("template", Some(arg(&o.template))),
            ("we_do", o.we.map(A::Call)),
            ("they_do", o.they.map(A::Call)),
            ("hours", nz(o.hours)),
            ("term", nz(o.term)),
            ("then", o.periodic.then(|| arg("periodic"))),
            ("our_notice", nz(o.our_notice)),
            ("their_notice", nz(o.their_notice)),
            ("terms", o.text.map(text)),
            ("basis", o.basis.as_deref().map(arg)),
        ],
    )
}

/// Sign an agreement offered to us.
pub fn sign(agreement: &str) -> oikos_sight::calls::Call {
    crate::steps::call("agreement", vec![("sign", Some(crate::steps::arg(agreement)))])
}

/// Give notice on an agreement under its terms.
pub fn notice(agreement: &str, words: &str) -> oikos_sight::calls::Call {
    crate::steps::call("agreement", vec![("notice", Some(crate::steps::arg(agreement))), ("text", Some(crate::steps::text(words)))])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use oikos_sight::Record;
    use serde_json::json;

    fn rec(v: Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).unwrap())
    }

    #[test]
    fn a_lease_and_a_job_read_by_their_terms() {
        let lease = rec(json!({ "id": "rec.5", "record": "agreement", "author": "p.land", "at": 0, "visible_to": ["land", "ann"],
            "terms": { "template": "lease", "parties": ["land", "ann"], "commitments": [
                { "who": "land", "does": { "outcome": { "occupancy": { "who": "ann", "in": "apts-3/dwelling.2" } } } },
                { "who": "ann", "does": { "outcome": { "money": { "to": "acc.land", "amount": "120000", "for": "rent" } } }, "every": 2_592_000 } ] } }));
        let l = lease_terms(&lease, "ann");
        assert_eq!((l.rent, l.rent_to.as_deref(), l.space.as_deref(), l.structure.as_deref(), l.every), (120_000, Some("acc.land"), Some("apts-3/dwelling.2"), Some("apts-3"), Some(2_592_000)));
        assert_eq!(template_of(&lease), Some(LEASE));

        let mut book = Book::new();
        let posting = rec(json!({ "id": "rec.6", "record": "statement", "author": "p.firm", "at": 0, "visible_to": "public", "kind": "job_posting", "text": "Hiring", "data": { "space": "works-1/floor.1" } }));
        let job = rec(json!({ "id": "rec.7", "record": "agreement", "author": "p.firm", "at": 10, "visible_to": ["firm", "ann"], "basis": "rec.6",
            "terms": { "template": "employment", "parties": ["firm", "ann"], "commitments": [
                { "who": "firm", "does": { "outcome": { "money": { "to": "acc.ann", "amount": 90000, "for": "wages" } } }, "every": 1_209_600 },
                { "who": "ann", "does": { "outcome": { "work": { "task": "make", "hours": 136800 } } } } ] } }));
        book.take_all([&posting, &job]);
        let j = job_terms(&job, "ann", Some(&book));
        assert_eq!(j, JobTerms { wage: 90_000, period: 1_209_600, workplace: Some("works-1/floor.1".into()), hours: Some(136_800) });
        assert_eq!(job_terms(&job, "ann", None).workplace, None);
    }
}
