//! What a stoppage costs each side, and so where a strike settles (docs/behaviour/unions.md, "Concession"). Ported from
//! the `gd-adoption` branch (participants/src/behaviour/firms.ts `concessionBps`, `Takings`; union.ts `stopsStriking`),
//! which is where the risk register's "every strike is won in full after three stoppages" (A-2, PB-9) was fixed; read
//! here as it stood on 2026-10-17 (that branch is not merged).
//!
//! Pure arithmetic both sides share: the employer's side (`firms`: lane C1) calls `concession_bps` and keeps `Takings`; the
//! union's side (`union.organiser`: lane D) calls `stops_striking`. Neither side sees the other's books: the employer
//! knows the notices it was given and who struck; the union knows its members and what the industry pays. No settlement is
//! set; the rules are the same for every dispute, and where one ends follows the costs.
//!
//! Basis. Hicks (1932), *The Theory of Wages*: the employer's concession curve rises with the length of a stoppage as
//! the union's resistance curve falls; a strike lasts while the union asks more than the employer will give at the length
//! of stoppage in prospect. Kennan and Wilson (1993), "Bargaining with private information", J. Economic Literature
//! 31(1): a stoppage is how each side learns what the other can bear. Card (1990), "Strikes and wages: a test of an
//! asymmetric information model", QJE 105(3): settlements follow the cost of disagreement.
//!
//! The comparison is a one-off cost against a year's flow, which concedes little (a stoppage of a few days costs a firm
//! a few days' sales, and a year's rise of a tenth of a percent of its wage bill is a day or so of its takings): the
//! owner's ruling (2026-10-17); what would make us revisit it is in docs/decisions.md.

use serde::{Deserialize, Serialize};

pub const DAY: i64 = 86_400;
const MONTH: i64 = 30 * DAY;

/// What an employer will concede.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Concession {
    /// The cost of holding out against another stoppage a day longer than the last, in the smallest unit.
    pub cost: i64,
    /// The rise, in basis points (to a tenth of a percent), whose year's cost is that.
    pub rise_bps: i64,
}

/// What an employer will concede after a stoppage: the rise whose year's cost is what holding out against another
/// stoppage, a day longer than the last, would cost it in sales. That is the share of its work the strikers did
/// (`strikers_bps` of its hours of work, over whatever systems do of the work: `system_bps`) times its takings a day, for
/// the days of the next. The cost of a stoppage is lost sales; the wages not paid to strikers are not netted off. Zero
/// where it has no takings or no wage bill. Rounded down to a tenth of a percent.
pub fn concession_bps(strikers_bps: i64, system_bps: i64, takings_per_day: i64, last_days: i64, year_bill: i64) -> Concession {
    let lost_bps = strikers_bps as i128 * (10_000 - system_bps.clamp(0, 10_000)) as i128 / 10_000;
    let cost = (lost_bps * takings_per_day.max(0) as i128 * (last_days + 1) as i128 / 10_000) as i64;
    let rise_bps = if year_bill > 0 { (cost as i128 * 10_000 / year_bill as i128 / 10 * 10) as i64 } else { 0 };
    Concession { cost, rise_bps }
}

/// What a firm has taken in, as it sees it from its own books: money a customer paid for what it sells. A month of it, per
/// day, is what a day without its work costs it in sales.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Takings {
    log: Vec<(i64, i64)>,
    first: Option<i64>,
}

impl Takings {
    pub fn add(&mut self, t: i64, cents: i64) {
        if cents <= 0 {
            return;
        }
        if self.log.first().is_some_and(|(at, _)| *at < t - 2 * MONTH) {
            self.log.retain(|(at, _)| *at >= t - 2 * MONTH);
        }
        self.log.push((t, cents));
        self.first = Some(self.first.map_or(t, |f| f.min(t)));
    }
    /// The last month's takings per day (over the days it has been taking, if fewer), in the smallest unit.
    pub fn per_day(&self, t: i64) -> i64 {
        let Some(first) = self.first else { return 0 };
        let sum: i128 = self.log.iter().filter(|(at, _)| *at > t - MONTH && *at <= t).map(|(_, c)| *c as i128).sum();
        let span = (t - first).clamp(DAY, MONTH) as i128;
        (sum * DAY as i128 / span) as i64
    }
}

/// Whether a union stops striking, and what it weighed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stops {
    pub stop: bool,
    /// The pay the next stoppage would cost its members.
    pub cost: i64,
    /// What the rest of the gap to its claim would add for them over a year.
    pub gain: i64,
}

/// Whether a union stops striking (docs/behaviour/unions.md, "Concession"): the pay the next stoppage would cost its
/// members (their number, the days of it, a day's pay in the industry) is at least what the rest of the gap to its claim
/// would add for them over a year (the same pay, 365 days, the gap's share). Not a settlement: where this lands follows the
/// gap, the length of the stoppages and nothing else. (A day's pay is on both sides of it, so the comparison is of days: a
/// stoppage of d days against a rise worth 365 x gap days of pay. The pay is what it needs to know to weigh it; a union
/// that does not know it cannot, and does not stop.)
pub fn stops_striking(members: i64, days: i64, pay_per_day: i64, claim_bps: i64, standing_bps: i64) -> Stops {
    let cost = members as i128 * days as i128 * pay_per_day as i128;
    let gain = members as i128 * pay_per_day as i128 * 365 * (claim_bps - standing_bps).max(0) as i128 / 10_000;
    Stops { stop: pay_per_day > 0 && cost >= gain, cost: cost as i64, gain: gain as i64 }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORKS: (i64, i64, i64, i64, i64) = (9_000, 0, 1_000_000, 2, 120_000_000);
    fn c(w: (i64, i64, i64, i64, i64)) -> Concession {
        concession_bps(w.0, w.1, w.2, w.3, w.4)
    }

    #[test]
    fn an_employer_concedes_what_another_longer_stoppage_would_cost_it_in_sales_as_a_rise_on_its_year_s_wage_bill() {
        // 90% of its work stopped for 3 days of $10,000 takings: $27,000 of sales, 0.2% of a $1.2M year's bill.
        assert_eq!(c(WORKS), Concession { cost: 2_700_000, rise_bps: 220 });
        assert!(c((9_000, 0, 1_000_000, 5, 120_000_000)).rise_bps > c(WORKS).rise_bps, "a longer last stoppage");
        assert!(c((9_000, 0, 2_000_000, 2, 120_000_000)).rise_bps > c(WORKS).rise_bps, "more takings");
        assert!(c((4_500, 0, 1_000_000, 2, 120_000_000)).rise_bps < c(WORKS).rise_bps, "less of the work stopped");
        assert!(c((9_000, 0, 1_000_000, 2, 240_000_000)).rise_bps < c(WORKS).rise_bps, "a dearer wage bill: a rise costs more");
    }

    #[test]
    fn what_systems_do_of_the_work_is_not_the_strikers_to_stop() {
        let without = c(WORKS);
        let half = c((9_000, 5_000, 1_000_000, 2, 120_000_000));
        let all = c((9_000, 10_000, 1_000_000, 2, 120_000_000));
        assert!(half.rise_bps < without.rise_bps);
        assert_eq!(half.cost, without.cost / 2);
        assert_eq!(all, Concession { cost: 0, rise_bps: 0 });
    }

    #[test]
    fn no_takings_no_wage_bill_or_no_strikers_means_nothing_to_concede_and_nothing_is_invented() {
        assert_eq!(c((9_000, 0, 0, 2, 120_000_000)).rise_bps, 0);
        assert_eq!(c((0, 0, 1_000_000, 2, 120_000_000)).rise_bps, 0);
        assert_eq!(c((9_000, 0, 1_000_000, 2, 0)).rise_bps, 0);
    }

    #[test]
    fn takings_are_a_month_s_per_day_over_the_days_it_has_been_taking_if_fewer() {
        let mut k = Takings::default();
        assert_eq!(k.per_day(10 * DAY), 0);
        k.add(0, 3_000);
        k.add(5 * DAY, 3_000);
        assert_eq!(k.per_day(6 * DAY), 1_000, "6,000 over 6 days");
        assert_eq!(k.per_day(40 * DAY), 0, "nothing in the last month");
        k.add(39 * DAY, 30_000);
        assert_eq!(k.per_day(40 * DAY), 1_000, "30,000 over 30 days");
    }

    #[test]
    fn a_union_with_a_large_gap_and_small_pay_at_stake_keeps_striking_and_one_with_a_small_gap_and_large_pay_stops() {
        // 40 members, $100 a day: a 3-day stoppage costs $12,000.
        let big = stops_striking(40, 3, 10_000, 500, 100);
        assert!(!big.stop);
        assert_eq!(big.cost, 1_200_000);
        assert_eq!(big.gain, 40 * 10_000 * 365 * 400 / 10_000);
        assert!(stops_striking(40, 3, 10_000, 500, 450).stop, "0.5% to win is worth 1.8 days' pay");
        let at = |days, gap| stops_striking(40, days, 10_000, gap, 0).stop;
        assert!(!at(1, 60));
        assert!(at(3, 60), "the longer the stoppage the sooner it stops");
        assert!(!at(3, 200), "the wider the gap, the longer it holds");
        assert!(stops_striking(40, 1, 10_000, 500, 500).stop, "a claim met in full costs nothing more to win");
        assert!(!stops_striking(40, 1, 0, 500, 500).stop, "a union that does not know the pay cannot weigh it");
    }

    #[test]
    fn no_settlement_is_a_constant_the_same_rules_other_costs_other_rises() {
        let rises: std::collections::BTreeSet<i64> = [0, 1_000_000, 5_000_000, 20_000_000, 40_000_000].iter().map(|t| c((9_000, 0, *t, 2, 120_000_000)).rise_bps).collect();
        assert_eq!(rises.len(), 5);
    }
}
