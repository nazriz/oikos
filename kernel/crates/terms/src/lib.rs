//! Reading agreements by their own terms (docs/design/rebuild.md section 7): whether an agreement is offered, in
//! force, ending or ended, when it ends, and why. Read-only and mechanical: a reading is attached beside the records,
//! never in their place; it changes nothing by itself (an "ended" lease evicts nobody); and anyone may read the
//! records differently. Whether a notice was valid, or a debt owed, is for people and institutions in the world.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

use serde::{Deserialize, Deserializer, Serialize};
use oikos_contracts::blocks::AgreementTerms;

/// This reader's version, stated on every reading.
pub const READER: &str = "terms-0.2.0";

/// A mark made on an agreement: who (the party signed or gave notice as), and when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mark {
    pub party: String,
    pub at: i64,
}

/// An agreement, read by its terms (contracts 0.7: Reading).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Reading {
    pub of: &'static str,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_by: Option<&'static str>,
    pub reader: &'static str,
}

/// A reading as it was handed on (an observation read back, as a seat's brain run apart from the engine reads what it was
/// shown: kernel/src/host.rs). Its words are this reader's few, so they are taken back as its own; any other is refused.
impl<'de> Deserialize<'de> for Reading {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Words {
            of: String,
            status: String,
            #[serde(default)]
            ends_at: Option<i64>,
            #[serde(default)]
            ended_by: Option<String>,
            reader: String,
        }
        let w = Words::deserialize(d)?;
        let word = |x: &str, of: &[&'static str], what: &str| of.iter().copied().find(|y| *y == x).ok_or_else(|| serde::de::Error::custom(format!("a reading's {what} {x:?} is not one this reader writes")));
        Ok(Reading {
            of: word(&w.of, &["agreement"], "kind")?,
            status: word(&w.status, &["offered", "in_force", "ending", "ended"], "status")?,
            ends_at: w.ends_at,
            ended_by: w.ended_by.as_deref().map(|x| word(x, &["notice", "term"], "end")).transpose()?,
            reader: word(&w.reader, &[READER], "reader")?,
        })
    }
}

/// Reads an agreement at `now`, from its terms and the signatures and notices made on it.
///
/// - **Offered** until every party has signed.
/// - **In force** from the last party's signature: until its term runs out, if it has one (`ends_at`). An agreement
///   whose terms say it continues after its term (`then: periodic`) isn't ended by it: it runs on until ended by notice.
/// - **Ending** once a party has given notice under a termination clause of its own: it ends when that notice
///   period runs out (`ends_at`). A notice from a party the terms give no clause to ends nothing, by the terms.
/// - **Ended** once the earliest of those has come: by the term, or by notice.
pub fn read(terms: &AgreementTerms, signatures: &[Mark], notices: &[Mark], now: i64) -> Reading {
    let reading = |status, ends_at, ended_by| Reading { of: "agreement", status, ends_at, ended_by, reader: READER };
    // Each party's first signature; in force from the last of them.
    let mut signed_at: Option<i64> = Some(i64::MIN);
    for p in &terms.parties {
        match signatures.iter().filter(|s| &s.party == p).map(|s| s.at).min() {
            Some(t) => signed_at = signed_at.map(|x| x.max(t)),
            None => signed_at = None,
        }
    }
    let Some(from) = signed_at.filter(|_| !terms.parties.is_empty()) else {
        return reading("offered", None, None);
    };
    let by_term = if terms.then.as_deref() == Some("periodic") { None } else { terms.term.map(|d| from.saturating_add(d)) };
    // The earliest notice to run out, under the notice-giver's own clause (a notice before the agreement was in
    // force counts from when it came into force).
    let by_notice = notices
        .iter()
        .filter_map(|n| {
            let clause = terms.termination.as_ref()?.iter().find(|c| c.party == n.party)?;
            Some(n.at.max(from).saturating_add(clause.notice))
        })
        .min();
    let (ends_at, ended_by) = match (by_term, by_notice) {
        (Some(a), Some(b)) if b < a => (Some(b), Some("notice")),
        (Some(a), _) => (Some(a), Some("term")),
        (None, Some(b)) => (Some(b), Some("notice")),
        (None, None) => (None, None),
    };
    match ends_at {
        Some(e) if now >= e => reading("ended", Some(e), ended_by),
        Some(e) if ended_by == Some("notice") => reading("ending", Some(e), Some("notice")),
        Some(e) => reading("in_force", Some(e), None),
        None => reading("in_force", None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_contracts::blocks::{AgreementTerms, Termination};

    const DAY: i64 = 86_400;

    #[test]
    fn a_reading_read_back_is_the_same() {
        let r = Reading { of: "agreement", status: "ending", ends_at: Some(5), ended_by: Some("notice"), reader: READER };
        let back: Reading = serde_json::from_value(serde_json::to_value(&r).unwrap()).unwrap();
        assert_eq!(back, r);
        assert!(serde_json::from_value::<Reading>(serde_json::json!({ "of": "agreement", "status": "void", "reader": READER })).is_err());
    }
    fn terms(term: Option<i64>, clauses: &[(&str, i64)]) -> AgreementTerms {
        serde_json::from_value(serde_json::json!({ "parties": ["union", "c1"], "commitments": [] })).map(|mut t: AgreementTerms| {
            t.term = term;
            t.termination = if clauses.is_empty() { None } else { Some(clauses.iter().map(|(p, n)| Termination { party: p.to_string(), notice: *n }).collect()) };
            t
        }).unwrap()
    }
    fn m(party: &str, at: i64) -> Mark {
        Mark { party: party.into(), at }
    }

    #[test]
    fn offered_until_every_party_signs() {
        let t = terms(None, &[]);
        assert_eq!(read(&t, &[m("union", 0)], &[], 5).status, "offered");
        assert_eq!(read(&t, &[m("union", 0), m("c1", 10)], &[], 10).status, "in_force");
    }

    #[test]
    fn a_term_runs_out() {
        let t = terms(Some(365 * DAY), &[]);
        let s = [m("union", 0), m("c1", 5 * DAY)];
        let r = read(&t, &s, &[], 100 * DAY);
        assert_eq!((r.status, r.ends_at, r.ended_by), ("in_force", Some(370 * DAY), None));
        let r = read(&t, &s, &[], 370 * DAY);
        assert_eq!((r.status, r.ended_by), ("ended", Some("term")));
    }

    #[test]
    fn notice_under_a_clause_ends_it_when_the_period_runs_out() {
        // The membership that read as in force forever once the union gave notice (Book.inForce checked signatures only).
        let t = terms(None, &[("union", 30 * DAY)]);
        let s = [m("union", 0), m("c1", 0)];
        let r = read(&t, &s, &[m("union", 100 * DAY)], 110 * DAY);
        assert_eq!((r.status, r.ends_at, r.ended_by), ("ending", Some(130 * DAY), Some("notice")));
        let r = read(&t, &s, &[m("union", 100 * DAY)], 130 * DAY);
        assert_eq!((r.status, r.ended_by), ("ended", Some("notice")));
    }

    #[test]
    fn a_notice_the_terms_give_no_clause_for_ends_nothing_by_them() {
        let t = terms(None, &[("union", 30 * DAY)]);
        let r = read(&t, &[m("union", 0), m("c1", 0)], &[m("c1", 10 * DAY)], 400 * DAY);
        assert_eq!(r.status, "in_force");
    }

    #[test]
    fn a_periodic_agreement_runs_on_after_its_term_until_notice() {
        let mut t = terms(Some(365 * DAY), &[("union", 60 * DAY)]);
        t.then = Some("periodic".into());
        let s = [m("union", 0), m("c1", 0)];
        let r = read(&t, &s, &[], 400 * DAY);
        assert_eq!((r.status, r.ends_at, r.ended_by), ("in_force", None, None));
        let r = read(&t, &s, &[m("union", 500 * DAY)], 520 * DAY);
        assert_eq!((r.status, r.ends_at, r.ended_by), ("ending", Some(560 * DAY), Some("notice")));
        let r = read(&t, &s, &[m("union", 500 * DAY)], 560 * DAY);
        assert_eq!((r.status, r.ended_by), ("ended", Some("notice")));
    }

    #[test]
    fn the_earlier_of_term_and_notice() {
        let t = terms(Some(365 * DAY), &[("c1", 14 * DAY)]);
        let r = read(&t, &[m("union", 0), m("c1", 0)], &[m("c1", 360 * DAY)], 361 * DAY);
        assert_eq!((r.status, r.ends_at, r.ended_by), ("in_force", Some(365 * DAY), None));
        let r = read(&t, &[m("union", 0), m("c1", 0)], &[m("c1", 10 * DAY)], 11 * DAY);
        assert_eq!((r.status, r.ends_at, r.ended_by), ("ending", Some(24 * DAY), Some("notice")));
    }
}
