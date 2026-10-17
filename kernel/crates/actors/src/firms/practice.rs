//! An organisation's practice: how an office has carried on, "as things are done here" (ported from
//! participants/src/behaviour/practice.ts; docs/behaviour/culture.md, "An office's practice"; docs/design/ai-citizens.md
//! 14g, as ruled on 2026-10-13).
//!
//! For each answer an organisation gives when asked (to hold a rent, to let a tenant under notice stay, to give a rise)
//! it keeps how many times the occasion arose, how many times it said yes, and since when the count runs. That is the
//! office's own habit, held in its own record, and it outlasts whoever holds the office. Basis: organisations act by
//! routines that outlast those who made them (Nelson and Winter 1982); the practice of an office is made at its counter
//! and handed on (Lipsky 1980); what was laid down early persists (Stinchcombe 1965). (To confirm:
//! docs/research/references.md.)
//!
//! WHAT IT IS NOT. It is not shown to a seat as ready counts (the owner's ruling, 2026-10-13: "sounds like a god like
//! view"): a seat that wants to know how its office has acted looks through the office's own papers. This is read only
//! by code holders, and only where the culture dial is on. Arithmetic only: no model, no draw, no clock. It judges
//! nothing: no rate is the good one.
//!
//! Decided fresh: JavaScript's `Math.round` is "half up" (`round_div`); rates are exact integer quotients.

use crate::DAY;
use serde::{Deserialize, Serialize};

/// The answers an organisation keeps a practice of, in the order the record keeps them. Closed; at most 6.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PracticeOf {
    Hold,
    Rise,
    Stay,
}

pub const PRACTICES: [PracticeOf; 3] = [PracticeOf::Hold, PracticeOf::Rise, PracticeOf::Stay];

/// A practice as the record writes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PracticeRow {
    pub of: PracticeOf,
    pub occasions: i64,
    pub did: i64,
    pub since: i64,
}

/// The culture dial's figures a practice runs on (`CultureParams.practice_*`; the world's own, from the dial).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PracticeParams {
    pub window_days: i64,
    pub min_occasions: i64,
    pub inertia_bps: i64,
    pub opening: i64,
}

/// `Math.round(num / den)` for a positive `den`: half up.
fn round_div(num: i64, den: i64) -> i64 {
    (2 * num + den).div_euclid(2 * den)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Practice {
    p: PracticeParams,
    rows: Vec<PracticeRow>,
}

impl Practice {
    pub fn new(p: PracticeParams, restored: &[PracticeRow]) -> Self {
        let mut me = Practice { p, rows: vec![] };
        for r in restored {
            me.put(r.clone());
        }
        me
    }

    fn put(&mut self, row: PracticeRow) {
        match self.rows.iter_mut().find(|r| r.of == row.of) {
            Some(r) => *r = row,
            None => self.rows.push(row),
        }
    }
    fn row(&self, of: PracticeOf) -> Option<&PracticeRow> {
        self.rows.iter().find(|r| r.of == of)
    }

    /// An office is never new on day 1: where it holds no practice of an answer, it opens with a past at the rate its
    /// character gives (`bps`), a whole number of occasions.
    pub fn open(&mut self, of: PracticeOf, bps: i64, t: i64) {
        if self.row(of).is_some() {
            return;
        }
        let n = self.p.opening;
        self.put(PracticeRow { of, occasions: n, did: round_div(n * bps, 10_000).clamp(0, n), since: t.div_euclid(DAY) });
    }

    /// The occasion arose and was answered, yes or no. Counts roll: when the window has run, the older half is let go.
    pub fn observe(&mut self, of: PracticeOf, t: i64, did: bool) {
        let day = t.div_euclid(DAY);
        let p = self.p;
        match self.rows.iter_mut().find(|r| r.of == of) {
            None => self.rows.push(PracticeRow { of, occasions: 1, did: i64::from(did), since: day }),
            Some(r) => {
                if day - r.since > p.window_days {
                    r.occasions = round_div(r.occasions, 2).max(1);
                    r.did = round_div(r.did, 2).clamp(0, r.occasions);
                    r.since += p.window_days.div_euclid(2);
                }
                r.occasions += 1;
                if did {
                    r.did += 1;
                }
            }
        }
    }

    /// Its own habit as a rate, once there are enough occasions to be one.
    pub fn rate(&self, of: PracticeOf) -> Option<i64> {
        self.row(of).filter(|r| r.occasions >= self.p.min_occasions).map(|r| round_div(r.did * 10_000, r.occasions))
    }

    /// A code holder's rate: `chance` is what its character and the asker give; `baseline` is what its character alone
    /// gives. Its habit pulls the rate `inertia` of the way from the baseline: at the opening habit is the baseline, so
    /// nothing moves.
    pub fn pulled(&self, of: PracticeOf, chance: i64, baseline: i64) -> i64 {
        match self.rate(of) {
            None => chance,
            Some(rate) => (chance + round_div((rate - baseline) * self.p.inertia_bps, 10_000)).clamp(0, 10_000),
        }
    }

    /// The record's section: at most six rows, in the closed order, each under 70 bytes.
    pub fn section(&self) -> Vec<PracticeRow> {
        PRACTICES.iter().filter_map(|k| self.row(*k).cloned()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: PracticeParams = PracticeParams { window_days: 1_825, min_occasions: 5, inertia_bps: 5_000, opening: 100 };

    #[test]
    fn a_habit_forms_from_what_an_office_does_outlasts_a_window_and_pulls_by_inertia_only() {
        let mut p = Practice::new(P, &[]);
        assert_eq!(p.rate(PracticeOf::Hold), None, "fewer than the minimum occasions is not yet a habit");
        for i in 0..20 {
            p.observe(PracticeOf::Hold, i * DAY, i % 4 != 0);
        }
        assert_eq!(p.rate(PracticeOf::Hold), Some(7_500));
        // Character's rate 3,000, habit 7,500, half the gap: 3,000 + 2,250.
        assert_eq!(p.pulled(PracticeOf::Hold, 3_000, 3_000), 5_250);
        assert_eq!(p.pulled(PracticeOf::Hold, 3_000, 7_500), 3_000, "a habit equal to the baseline moves nothing");
        let before = p.section()[0].clone();
        p.observe(PracticeOf::Hold, 2_000 * DAY, true);
        let after = p.section()[0].clone();
        assert!(after.occasions < before.occasions && after.occasions >= 1 && after.did <= after.occasions);
    }

    #[test]
    fn an_office_opens_with_a_past_and_the_section_is_bounded() {
        let mut p = Practice::new(P, &[]);
        for k in PRACTICES {
            p.open(k, 3_000, 0);
        }
        let rows = p.section();
        assert_eq!(rows.iter().map(|r| r.of).collect::<Vec<_>>(), PRACTICES);
        assert!(rows.iter().all(|r| r.occasions == 100 && r.did == 30));
        // Opening again changes nothing (a practice already held is kept).
        p.open(PracticeOf::Hold, 9_000, 5 * DAY);
        assert_eq!(p.section()[0].did, 30);
        for i in 0..5_000 {
            for k in PRACTICES {
                p.observe(k, i * DAY, i % 3 == 0);
            }
        }
        let rows = p.section();
        assert!(rows.len() <= 6 && serde_json::to_string(&rows).unwrap().len() < 500);
    }

    #[test]
    fn practice_persists_across_holders_through_the_record() {
        let mut first = Practice::new(P, &[]);
        for i in 0..40 {
            first.observe(PracticeOf::Rise, i * DAY, i % 2 == 0);
        }
        let written = first.section();
        assert_eq!(written[0].occasions, 40);
        let next = Practice::new(P, &written);
        assert_eq!(next.section(), written);
        // A saved practice restores to itself.
        let saved = serde_json::to_value(&first).unwrap();
        assert_eq!(serde_json::from_value::<Practice>(saved).unwrap(), first);
    }
}
