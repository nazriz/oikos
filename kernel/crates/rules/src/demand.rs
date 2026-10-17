//! Household demand across the goods and services on offer (docs/behaviour/demand.md): how a household divides what it
//! spends among the kinds of thing it can buy, by their prices and by what it needs of each.
//!
//! The rule is the linear expenditure system (Stone 1954; Geary 1950; Deaton and Muellbauer 1980, ch. 3): a household
//! first covers what it needs of each kind (a quantity, `need`), at today's prices; what is left over (its
//! "supernumerary" spending) is divided in fixed marginal shares. Spending on kind `i`, with budget `B`, prices `p`,
//! needs `g` and marginal shares `b` (summing to one):
//!
//! ```text
//!     e_i = p_i g_i + b_i (B - sum_j p_j g_j)
//! ```
//!
//! So a fall in one kind's price frees money from its needed part, and that money is spread over every kind by the
//! marginal shares: spending shifts towards the others (a necessity's share falls when it gets cheaper), and a richer
//! household spends its extra money as the marginal shares say, not as the average ones (income responses). Where the
//! budget does not cover the needs, each need is met in proportion (no kind is left out).
//!
//! **Calibration** (Lluch, Powell and Williams 1977; Frisch 1959): from a household expenditure survey's average budget
//! shares `w_i`, each kind's income elasticity `eta_i` and the money flexibility (Frisch's parameter, `phi`, negative):
//! `b_i = eta_i w_i` (renormalised to sum to one), and at the survey's mean budget `B0` and the reference prices `p0`,
//! the supernumerary ratio is `-1/phi`, so the need's value is `p0_i g_i = B0 (w_i - b_i / -phi)`. Every figure is the
//! profile's (docs/profiles.md); the code holds none.
//!
//! Only the kinds on offer to the household are weighed: the survey's shares are renormalised over them, so in a town
//! that sells one kind, the whole budget goes to it, as before this rule. Integers throughout (cents, basis points);
//! rounding down, with what rounding leaves going to the kind of the largest marginal share (ties by kind, byte order),
//! so the parts always add up to the budget.

use serde::{Deserialize, Serialize};

const BPS: i128 = 10_000;

/// A kind of thing a household buys, as the profile's survey describes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Survey {
    /// The kind (as price lists and holdings name it: `goods`, ...).
    pub kind: String,
    /// Its average share of household spending in the survey (basis points; renormalised over the kinds on offer).
    pub share_bps: i64,
    /// Its income (expenditure) elasticity (basis points: 10,000 is one; under one a necessity, over one a luxury).
    pub income_elasticity_bps: i64,
}

/// A kind on offer to one household now: what the survey says of it and what it costs today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub kind: String,
    /// The marginal share of supernumerary spending (basis points; the lines' shares sum to 10,000).
    pub marginal_bps: i64,
    /// What the need costs at the reference price (cents a month): `p0 g`.
    pub need_at_reference: i64,
    /// The reference price (cents a unit) and today's price (cents a unit).
    pub reference_price: i64,
    pub price: i64,
}

/// The lines for the kinds on offer, from the survey (`surveys`, the kinds the profile describes), the reference
/// budget `b0` (cents a month: the survey's mean, for the spender this is for), the money flexibility `frisch_bps`
/// (negative basis points: -20,000 is -2), and each kind on offer's reference and current prices
/// (`offer`: kind, reference price, price). A kind on offer the survey does not describe is left out; a kind the
/// survey describes and nobody offers is left out, and the shares are renormalised over the rest.
pub fn lines(surveys: &[Survey], b0: i64, frisch_bps: i64, offer: &[(String, i64, i64)]) -> Vec<Line> {
    let on: Vec<(&Survey, i64, i64)> = offer
        .iter()
        .filter(|(_, p0, p)| *p0 > 0 && *p > 0)
        .filter_map(|(k, p0, p)| surveys.iter().find(|s| &s.kind == k).map(|s| (s, *p0, *p)))
        .filter(|(s, _, _)| s.share_bps > 0)
        .collect();
    if on.is_empty() {
        return vec![];
    }
    let w_sum: i128 = on.iter().map(|(s, _, _)| i128::from(s.share_bps)).sum();
    // Average shares over the kinds on offer, and marginal shares b = eta w, renormalised (basis points).
    let w: Vec<i128> = on.iter().map(|(s, _, _)| i128::from(s.share_bps) * BPS / w_sum).collect();
    let raw: Vec<i128> = on.iter().zip(&w).map(|((s, _, _), wi)| (i128::from(s.income_elasticity_bps.max(0)) * wi / BPS).max(0)).collect();
    let raw_sum: i128 = raw.iter().sum();
    let b: Vec<i128> = if raw_sum > 0 { split(BPS, &raw, on.iter().map(|(s, _, _)| s.kind.as_str()).collect::<Vec<_>>().as_slice()) } else { w.clone() };
    // The supernumerary ratio at the mean: -1/phi (basis points), at most one.
    let s_bps: i128 = if frisch_bps < 0 { (BPS * BPS / i128::from(-frisch_bps)).min(BPS) } else { BPS };
    on.iter()
        .zip(w.iter().zip(&b))
        .map(|((s, p0, p), (wi, bi))| Line {
            kind: s.kind.clone(),
            marginal_bps: *bi as i64,
            need_at_reference: (i128::from(b0.max(0)) * (wi * BPS - bi * s_bps).max(0) / (BPS * BPS)) as i64,
            reference_price: *p0,
            price: *p,
        })
        .collect()
}

/// `total` split in proportion to `weights` (all non-negative, not all zero), rounding down, with what is left going to
/// the largest weight (ties by key, byte order): the parts sum to `total`.
fn split(total: i128, weights: &[i128], keys: &[&str]) -> Vec<i128> {
    let sum: i128 = weights.iter().sum();
    if sum <= 0 || weights.is_empty() {
        return weights.iter().map(|_| 0).collect();
    }
    let mut out: Vec<i128> = weights.iter().map(|x| total * x / sum).collect();
    let left = total - out.iter().sum::<i128>();
    let top = (0..weights.len()).max_by(|&a, &c| weights[a].cmp(&weights[c]).then_with(|| keys[c].cmp(keys[a]))).unwrap_or(0);
    out[top] += left;
    out
}

/// What the need for a line costs at today's price (cents a month).
pub fn need_now(l: &Line) -> i64 {
    if l.reference_price <= 0 {
        return 0;
    }
    (i128::from(l.need_at_reference) * i128::from(l.price) / i128::from(l.reference_price)) as i64
}

/// The budget (cents) divided among the lines: each need at today's price first, then what is left by the marginal
/// shares; if the budget does not cover the needs, each need in proportion. The parts sum to the budget (none below
/// nothing). One line takes the whole budget.
pub fn divide(budget: i64, lines: &[Line]) -> Vec<i64> {
    if lines.is_empty() {
        return vec![];
    }
    let budget = i128::from(budget.max(0));
    let keys: Vec<&str> = lines.iter().map(|l| l.kind.as_str()).collect();
    let needs: Vec<i128> = lines.iter().map(|l| i128::from(need_now(l).max(0))).collect();
    let need: i128 = needs.iter().sum();
    let out = if budget <= need {
        if need == 0 {
            split(budget, &lines.iter().map(|l| i128::from(l.marginal_bps.max(0))).collect::<Vec<_>>(), &keys)
        } else {
            split(budget, &needs, &keys)
        }
    } else {
        let extra = split(budget - need, &lines.iter().map(|l| i128::from(l.marginal_bps.max(0))).collect::<Vec<_>>(), &keys);
        needs.iter().zip(extra).map(|(n, x)| n + x).collect()
    };
    out.into_iter().map(|x| x as i64).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn surveys() -> Vec<Survey> {
        // (Figures for the test only: a necessity and a luxury, sixty and forty per cent of spending.)
        vec![
            Survey { kind: "goods".into(), share_bps: 6_000, income_elasticity_bps: 7_000 },
            Survey { kind: "services".into(), share_bps: 4_000, income_elasticity_bps: 14_500 },
        ]
    }
    fn offer(goods: i64, services: i64) -> Vec<(String, i64, i64)> {
        vec![("goods".into(), 1_000, goods), ("services".into(), 2_000, services)]
    }

    #[test]
    fn one_kind_on_offer_takes_the_whole_budget_whatever_its_price() {
        let l = lines(&surveys(), 100_000, -20_000, &[("goods".into(), 1_000, 700)]);
        assert_eq!(l.len(), 1);
        assert_eq!(divide(123_457, &l), vec![123_457]);
        assert_eq!(divide(0, &l), vec![0]);
    }

    #[test]
    fn the_parts_add_up_to_the_budget() {
        let l = lines(&surveys(), 100_000, -20_000, &offer(1_000, 2_000));
        for b in [0, 1, 999, 40_000, 100_000, 100_001, 333_333] {
            assert_eq!(divide(b, &l).iter().sum::<i64>(), b, "budget {b}");
        }
    }

    #[test]
    fn at_the_mean_budget_and_reference_prices_spending_is_the_survey_shares() {
        let l = lines(&surveys(), 100_000, -20_000, &offer(1_000, 2_000));
        let e = divide(100_000, &l);
        assert!((e[0] - 60_000).abs() <= 1 && (e[1] - 40_000).abs() <= 1, "{e:?}");
    }

    #[test]
    fn a_cheaper_necessity_frees_money_for_the_rest() {
        let l0 = lines(&surveys(), 100_000, -20_000, &offer(1_000, 2_000));
        let l1 = lines(&surveys(), 100_000, -20_000, &offer(800, 2_000));
        let (e0, e1) = (divide(100_000, &l0), divide(100_000, &l1));
        assert!(e1[0] < e0[0], "less is spent on goods when they are cheaper: {e0:?} -> {e1:?}");
        assert!(e1[1] > e0[1], "and more on services");
        // (Yet more goods are bought: the price fell further than the spending.)
        assert!(e1[0] * 1_000 / 800 > e0[0]);
    }

    #[test]
    fn a_richer_household_spends_its_extra_by_the_marginal_shares() {
        let l = lines(&surveys(), 100_000, -20_000, &offer(1_000, 2_000));
        let (e0, e1) = (divide(100_000, &l), divide(200_000, &l));
        let share_services = |e: &[i64]| e[1] * 10_000 / (e[0] + e[1]);
        assert!(share_services(&e1) > share_services(&e0), "the luxury's share rises with income");
        let extra_services = e1[1] - e0[1];
        assert_eq!(extra_services * 10_000 / 100_000, l[1].marginal_bps);
    }

    #[test]
    fn a_budget_under_the_needs_meets_each_in_proportion() {
        let l = lines(&surveys(), 100_000, -20_000, &offer(1_000, 2_000));
        let needs: Vec<i64> = l.iter().map(need_now).collect();
        let e = divide(10_000, &l);
        assert!(e.iter().all(|x| *x > 0));
        assert!((e[0] * needs[1] - e[1] * needs[0]).abs() <= needs[0].max(needs[1]), "{e:?} vs needs {needs:?}");
    }

    #[test]
    fn a_kind_nobody_offers_is_left_out_and_the_shares_renormalised() {
        let l = lines(&surveys(), 100_000, -20_000, &[("services".into(), 2_000, 2_000), ("bread".into(), 10, 10)]);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].marginal_bps, 10_000);
    }
}
