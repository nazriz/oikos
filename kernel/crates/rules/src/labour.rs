//! How many hands a firm needs (docs/behaviour/staffing.md, "Hiring follows need"; risk ME-2).
//!
//! A firm hires while the next worker pays for themselves: the trade it expects, less the other costs of earning it,
//! covers their pay with a margin to spare (the demand for labour is its marginal revenue product: Marshall; Hamermesh
//! 1993, *Labor Demand*). It plans on trade smoothed over months, not one month's (Holt, Modigliani, Muth & Simon
//! 1960; the same horizon `LabourPlan` keeps), and the capacity of its premises is a ceiling, not a target.
//! Where it has no record of trade yet (just opened) it has only the staff it opened with expecting, `opening`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Need {
    /// Trade expected a month (cents of takings), smoothed over the horizon; negative: none on record yet.
    pub expected_takings: i64,
    /// Share of takings spent on what is bought in (basis points).
    pub bought_in_bps: i64,
    /// A worker's pay a month, with the costs of having them on.
    pub wage: i64,
    /// Margin over their pay that taking someone on must clear (basis points; 0: break even).
    pub required_margin_bps: i64,
    /// Staff the premises can hold.
    pub capacity: i64,
    /// Staff the firm opened with, expecting trade (the figure before any is on record).
    pub opening: i64,
    /// The least a firm of this kind runs with while it trades.
    pub least: i64,
}

/// Staff to have: those the expected takings can pay, within what the premises hold; the opening staff until there
/// is a trade record.
pub fn staff_needed(n: &Need) -> i64 {
    let ceiling = n.capacity.max(0);
    let want = if n.expected_takings < 0 || n.wage <= 0 {
        n.opening
    } else {
        let net = i128::from(n.expected_takings) * i128::from((10_000 - n.bought_in_bps).clamp(0, 10_000)) / 10_000;
        let per = i128::from(n.wage) * i128::from(10_000 + n.required_margin_bps.max(0)) / 10_000;
        i64::try_from(net / per.max(1)).unwrap_or(i64::MAX)
    };
    want.max(n.least).min(ceiling)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n() -> Need {
        Need { expected_takings: 3_000_000, bought_in_bps: 4_000, wage: 300_000, required_margin_bps: 2_000, capacity: 10, opening: 4, least: 1 }
    }

    #[test]
    fn staff_follow_trade() {
        // 3.0m less 40% = 1.8m; each worker must clear 360k: 5.
        assert_eq!(staff_needed(&n()), 5);
        assert_eq!(staff_needed(&Need { expected_takings: 1_000_000, ..n() }), 1);
        assert_eq!(staff_needed(&Need { expected_takings: 0, least: 0, ..n() }), 0);
    }

    #[test]
    fn capacity_is_a_ceiling_and_opening_is_the_start() {
        assert_eq!(staff_needed(&Need { expected_takings: 90_000_000, ..n() }), 10);
        assert_eq!(staff_needed(&Need { expected_takings: -1, ..n() }), 4);
    }
}
