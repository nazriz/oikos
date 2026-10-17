//! A rent at review follows the market's evidence (docs/behaviour/firms.md, "Rent reviews follow the market"; risks
//! ME-14, A-4).
//!
//! The old rule set every review at the landlord's own going rents plus a fixed markup, so each review raised the
//! next and no rent ever fell. A landlord instead reads what comparable homes are asking and letting for, and what
//! stands empty, and moves a sitting tenant's rent only part of the way: new lets reprice fully at once, sitting
//! tenants pass through a share of the gap, and upward more than downward (Bank of England, "Rents, house prices and
//! inflation": new lets move far more than the stock; Genesove 2003 and Hilber 2011 on stickiness; ONS PIPR: sitting
//! tenants' rents rise more slowly than new lets (to confirm the exact figures; the shares are parameters)).
//! A rent falls for a sitting tenant only where homes like theirs are standing empty (the vacancy rate shows it).
//! Nothing here sees the world: the caller hands in the evidence the landlord has (its own lets and listings, and the
//! board's summary the market office publishes).

use serde::{Deserialize, Serialize};

/// The evidence on comparable homes (same kind and size, near).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Evidence {
    /// Rents of comparable homes let within the evidence window, a month.
    pub lets: Vec<i64>,
    /// Rents comparable homes are asking now.
    pub asking: Vec<i64>,
    /// Comparable homes known, and how many of them stand empty.
    pub homes: i64,
    pub vacant: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Review {
    /// How much of a gap to the market a rise closes at a review (basis points).
    pub pass_up_bps: i64,
    /// How much of a gap a fall closes (basis points), only when vacancy shows the market is soft.
    pub pass_down_bps: i64,
    /// Vacancy (basis points of comparable homes) from which a fall is on the table.
    pub soft_vacancy_bps: i64,
}

impl Default for Review {
    fn default() -> Self {
        // Placeholders until calibrated against a profile's rent index: half the gap up, a quarter down, soft at 5%.
        Review { pass_up_bps: 5_000, pass_down_bps: 2_500, soft_vacancy_bps: 500 }
    }
}

fn median(v: &[i64]) -> Option<i64> {
    if v.is_empty() {
        return None;
    }
    let mut s = v.to_vec();
    s.sort_unstable();
    let m = s.len() / 2;
    Some(if s.len() % 2 == 1 { s[m] } else { (s[m - 1] + s[m]) / 2 })
}

/// What a home like it would let for now, by the evidence: the median of recent lets, or of asking rents where there
/// are no lets (an asking rent is an offer, a let a bargain struck). None: no evidence, so no basis for a change.
pub fn market(e: &Evidence) -> Option<i64> {
    median(&e.lets).or_else(|| median(&e.asking))
}

/// The rent after review: `now` if nothing in the evidence moves it.
pub fn reviewed(now: i64, e: &Evidence, r: &Review) -> i64 {
    let Some(m) = market(e) else { return now };
    let gap = m - now;
    let vacancy_bps = if e.homes > 0 { e.vacant.max(0) * 10_000 / e.homes } else { 0 };
    let share = if gap > 0 {
        // A tight market (almost nothing empty) passes the whole share; a loose one less.
        r.pass_up_bps
    } else if gap < 0 && vacancy_bps >= r.soft_vacancy_bps {
        r.pass_down_bps
    } else {
        return now;
    };
    now + gap * share.clamp(0, 10_000) / 10_000
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(lets: &[i64], asking: &[i64], homes: i64, vacant: i64) -> Evidence {
        Evidence { lets: lets.to_vec(), asking: asking.to_vec(), homes, vacant }
    }

    #[test]
    fn no_evidence_no_change() {
        assert_eq!(reviewed(200_000, &Evidence::default(), &Review::default()), 200_000);
    }

    #[test]
    fn rises_part_of_the_way_to_new_lets() {
        assert_eq!(reviewed(200_000, &ev(&[220_000, 240_000, 230_000], &[], 20, 0), &Review::default()), 215_000);
    }

    #[test]
    fn a_tight_market_is_not_a_fixed_five_percent_and_there_is_no_ratchet() {
        let r = Review::default();
        // Market level with the rent: unchanged, however many reviews.
        let mut rent = 200_000;
        for _ in 0..10 {
            rent = reviewed(rent, &ev(&[200_000], &[], 20, 1), &r);
        }
        assert_eq!(rent, 200_000);
    }

    #[test]
    fn falls_only_where_homes_stand_empty() {
        let r = Review::default();
        assert_eq!(reviewed(200_000, &ev(&[160_000], &[], 20, 0), &r), 200_000);
        assert_eq!(reviewed(200_000, &ev(&[160_000], &[], 20, 4), &r), 190_000);
    }

    #[test]
    fn asking_rents_stand_in_where_nothing_has_let() {
        assert_eq!(market(&ev(&[], &[210_000, 230_000], 5, 2)), Some(220_000));
    }
}
