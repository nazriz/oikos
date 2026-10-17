//! What the firms that follow Lengnick (2013) share (ported from participants/src/behaviour/lengnick.ts): the paper's
//! Table 1 parameters, the wage rule, and paying out what a firm holds beyond its buffer. Documented in
//! docs/behaviour/producer.md and docs/behaviour/retailer.md.
//!
//! Lengnick, M. (2013), Agent-based macroeconomics: a baseline model. Journal of Economic Behavior & Organization 86,
//! 102-120.
//!
//! **The price rule is not here any more.** Lengnick's price rule (a price kept between 1.025 and 1.15 times marginal
//! cost, moved by 2% on the state of the stock) was a stylised device for producing aggregate cycles, and it made
//! gouging, discounting and monopoly pricing impossible by construction (docs/risks.md ME-16). Prices are formed in
//! `prices.rs` from supply and demand, costs and what rivals are seen to charge. The stock band (`phi_low_bps`,
//! `phi_high_bps`), the chance a price is looked at (`theta_bps`) and the largest step (`vartheta_bps`) keep their
//! meaning; `price_up_bound_bps` and `price_down_bound_bps` keep theirs as the usual margin (below).

use crate::common::book::Book;
use crate::common::{data, Fields};
use crate::steps::{because, say, Say, Step};
use crate::Ctx;
use oikos_core::rng::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Table 1, as basis points of 1 (and months), read from a firm's parameters (names unchanged from the TS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lengnick {
    /// Restock (or hire) when stock is below this share of last month's demand.
    pub phi_low_bps: i64,
    /// Let one go (or stop restocking) above this.
    pub phi_high_bps: i64,
    /// Wage steps: up to 1.9%.
    pub delta_bps: i64,
    /// Months fully staffed before the wage offered falls.
    pub gamma_months: i64,
    /// The usual margin over marginal cost: a price above it needs evidence of scarcity (prices.rs).
    pub price_up_bound_bps: i64,
    /// Below this margin a price is only lowered to clear stock (prices.rs).
    pub price_down_bound_bps: i64,
    /// The chance a price is looked at in a month (Calvo 1983: prices are sticky).
    pub theta_bps: i64,
    /// The largest price step in a month.
    pub vartheta_bps: i64,
    /// The liquidity buffer, as a share of the monthly wage bill.
    pub chi_bps: i64,
}

impl Default for Lengnick {
    fn default() -> Self {
        Lengnick {
            phi_low_bps: 2500,
            phi_high_bps: 10_000,
            delta_bps: 190,
            gamma_months: 24,
            price_up_bound_bps: 11_500,
            price_down_bound_bps: 10_250,
            theta_bps: 7500,
            vartheta_bps: 200,
            chi_bps: 1000,
        }
    }
}

impl Lengnick {
    /// The firm's own figures (the world's parameters over Table 1).
    pub fn read(ctx: &Ctx) -> Result<Lengnick, String> {
        let d = Lengnick::default();
        Ok(Lengnick {
            phi_low_bps: ctx.param("phi_low_bps", d.phi_low_bps)?,
            phi_high_bps: ctx.param("phi_high_bps", d.phi_high_bps)?,
            delta_bps: ctx.param("delta_bps", d.delta_bps)?,
            gamma_months: ctx.param("gamma_months", d.gamma_months)?,
            price_up_bound_bps: ctx.param("price_up_bound_bps", d.price_up_bound_bps)?,
            price_down_bound_bps: ctx.param("price_down_bound_bps", d.price_down_bound_bps)?,
            theta_bps: ctx.param("theta_bps", d.theta_bps)?,
            vartheta_bps: ctx.param("vartheta_bps", d.vartheta_bps)?,
            chi_bps: ctx.param("chi_bps", d.chi_bps)?,
        })
    }
}

/// Basis points as a percentage in words: 190 is "1.9", 2000 is "20", 1250 is "12.5".
pub fn percent(bps: i64) -> String {
    let (w, f) = (bps / 100, bps.abs() % 100);
    match f {
        0 => w.to_string(),
        f if f % 10 == 0 => format!("{w}.{}", f / 10),
        f => format!("{w}.{f:02}"),
    }
}

/// What the wage rule heard this month.
#[derive(Debug, Clone, Copy)]
pub struct WageMonth {
    /// A job posted has stood unfilled for a month.
    pub unfilled: bool,
    /// A job is posted now.
    pub posting: bool,
    /// Someone works for the firm.
    pub staffed: bool,
    /// Months in a row with every position filled.
    pub full_months: i64,
}

/// The wage rule: a job posting that has stood unfilled for a month raises the wage offered by up to delta;
/// `full_months` in a row with every position filled (gamma) lowers it by up to delta. Returns the new wage, the
/// months fully staffed so far, and why, if it changed. (Efficiency-wage and vacancy-driven wage adjustment: Lengnick
/// 2013; the downward step is the model's.)
pub fn move_wage(p: &Lengnick, rng: &mut Rng, wage: i64, o: WageMonth, money: &dyn Fn(i64) -> String) -> (i64, i64, Option<String>) {
    if o.unfilled {
        let up = rng.below((p.delta_bps + 1) as u64) as i64;
        let next = wage * (10_000 + up) / 10_000;
        return (next, 0, Some(format!("a job we posted has gone unfilled for a month: offering {}% more ({} a pay period)", percent(up), money(next))));
    }
    if !o.posting && o.staffed {
        if o.full_months + 1 >= p.gamma_months {
            let down = rng.below((p.delta_bps + 1) as u64) as i64;
            let next = wage * (10_000 - down) / 10_000;
            return (
                next,
                0,
                Some(format!("fully staffed for {} months: offering {}% less to new hires ({} a pay period)", p.gamma_months, percent(down), money(next))),
            );
        }
        return (wage, o.full_months + 1, None);
    }
    (wage, o.full_months, None)
}

/// The trade a firm plans on: its sales (or its orders) smoothed over a few months, never one month's alone (Holt,
/// Modigliani, Muth and Simon 1960; docs/behaviour/firms.md, "Adjusting labour"). `smooth_months` 0 or 1: last month's
/// figure, as the rule was.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Expectation {
    level: i64,
    smooth_months: i64,
}

impl Expectation {
    /// `opening`: the trade the firm expected when it took its staff on, where it has one.
    pub fn new(smooth_months: i64, opening: Option<i64>) -> Self {
        Expectation { level: opening.filter(|o| *o > 0).unwrap_or(-1), smooth_months }
    }
    /// The trade expected, after another month's figure: an average weighted to the recent months over the horizon
    /// (an exponential average with the span `smooth_months`; half-up rounding, decided here).
    pub fn expect(&mut self, month: i64) -> i64 {
        let h = self.smooth_months.max(0);
        self.level = if self.level < 0 || h <= 1 {
            month
        } else {
            let n = (month - self.level) * 2;
            let d = h + 1;
            self.level + (2 * n + d).div_euclid(2 * d)
        };
        self.level
    }
    /// The trade expected now (before any month's figure: -1).
    pub fn level(&self) -> i64 {
        self.level
    }
}

/// One holder on a firm's register.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Holder {
    pub holder: String,
    pub account: String,
    pub shares: i64,
}

/// A firm's shareholders, from its register (the latest `shareholders` statement it keeps).
pub fn shareholders(book: &Book, firm: &str) -> Vec<Holder> {
    let mut mine: Vec<_> = book.open("shareholders").filter(|r| r.speaks_for.as_deref() == Some(firm)).collect();
    mine.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| crate::common::filed_before(&b.id, &a.id)));
    let Some(r) = mine.first() else { return vec![] };
    let d = data(r);
    d.get("holders")
        .and_then(Value::as_array)
        .map(|hs| {
            hs.iter()
                .map(|h| Holder {
                    holder: h.s("holder").unwrap_or_default().to_string(),
                    account: h.s("account").unwrap_or_default().to_string(),
                    shares: h.i("shares").unwrap_or(0),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The account a firm pays from, and the bank that keeps it (the bank carries out the instruction).
#[derive(Debug, Clone)]
pub struct From<'a> {
    pub account: &'a str,
    pub custodian: &'a str,
}

/// Paying an amount to a firm's shareholders by their shares, in one instruction to the bank, as a share registry pays a
/// dividend (docs/behaviour/bank-payment-system.md). Returns the steps and what was paid.
pub fn distribute<T>(book: &Book, firm: &str, from: &From, amount: i64, why: &str, money: &dyn Fn(i64) -> String) -> (Vec<Step<T>>, i64) {
    let holders = shareholders(book, firm);
    let total: i64 = holders.iter().map(|h| h.shares).sum();
    if amount <= 0 || total <= 0 {
        return (vec![], 0);
    }
    let _ = money;
    let lines: Vec<(&Holder, i64)> = holders.iter().map(|h| (h, (i128::from(amount) * i128::from(h.shares) / i128::from(total)) as i64)).filter(|(_, x)| *x > 0).collect();
    if lines.is_empty() {
        return (vec![], 0);
    }
    let payments: Vec<Value> = lines.iter().map(|(h, x)| json!({ "to": h.account, "amount": x.to_string(), "for": "Dividend." })).collect();
    let n = lines.len();
    let steps = vec![because(
        format!("{why} ({n} payment{}, in one instruction to the bank).", if n > 1 { "s" } else { "" }),
        vec![say(
            "request",
            &format!("Please pay this dividend from {}: {n} payments.", from.account),
            Say { to: Some(vec![from.custodian.to_string()]), data: Some(json!({ "from": from.account, "payments": payments })), ..Default::default() },
        )],
    )];
    (steps, lines.iter().map(|(_, x)| *x).sum())
}

/// Paying out, at the month's end: out of what the month earned (what came in beyond what went out), what is held
/// beyond the buffer, to the shareholders by their shares. Returns the steps and what was paid.
pub fn pay_out<T>(
    book: &Book,
    firm: &str,
    from: &From,
    balance: i64,
    buffer: i64,
    earned: i64,
    why: &str,
    money: &dyn Fn(i64) -> String,
) -> (Vec<Step<T>>, i64) {
    let surplus = (balance - buffer).min(earned);
    if surplus <= 0 {
        return (vec![], 0);
    }
    distribute(
        book,
        firm,
        from,
        surplus,
        &format!(
            "Month's end: we took in {} more than we paid out this month, and hold {} against a buffer of {} ({why}): paying {} to our shareholders by their shares",
            money(earned),
            money(balance),
            money(buffer),
            money(surplus)
        ),
        money,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_core::rng::Randomness;

    fn money(n: i64) -> String {
        format!("${}.{:02}", n / 100, n % 100)
    }

    #[test]
    fn a_job_unfilled_for_a_month_raises_the_wage_and_a_long_full_staff_lowers_it() {
        let p = Lengnick::default();
        let mut rng = Randomness::new(7).stream(&["wage"]);
        let (w, full, why) = move_wage(&p, &mut rng, 100_000, WageMonth { unfilled: true, posting: true, staffed: true, full_months: 5 }, &money);
        assert!((100_000..=101_900).contains(&w), "{w}");
        assert_eq!(full, 0);
        assert!(why.unwrap().contains("unfilled"));
        // Fully staffed, no posting: months count up, and at gamma the wage may fall.
        let (w, full, why) = move_wage(&p, &mut rng, 100_000, WageMonth { unfilled: false, posting: false, staffed: true, full_months: 3 }, &money);
        assert_eq!((w, full, why), (100_000, 4, None));
        let (w, full, why) = move_wage(&p, &mut rng, 100_000, WageMonth { unfilled: false, posting: false, staffed: true, full_months: 23 }, &money);
        assert!(w <= 100_000 && w >= 98_100);
        assert_eq!(full, 0);
        assert!(why.is_some());
        // Nobody on the staff and nothing posted: nothing is learned.
        let (w, full, _) = move_wage(&p, &mut rng, 100_000, WageMonth { unfilled: false, posting: false, staffed: false, full_months: 9 }, &money);
        assert_eq!((w, full), (100_000, 9));
    }

    #[test]
    fn expectation_follows_the_months_figure_weighted_to_the_recent_over_the_horizon() {
        let mut e = Expectation::new(3, None);
        assert_eq!(e.expect(100), 100, "the first figure is the expectation");
        assert_eq!(e.expect(200), 150, "span 3: half the way");
        assert_eq!(e.expect(100), 125);
        let mut last = Expectation::new(0, None);
        last.expect(100);
        assert_eq!(last.expect(300), 300, "no smoothing: last month's");
        let mut opened = Expectation::new(3, Some(250));
        assert_eq!(opened.expect(150), 200, "an opening expectation is moved like any other month's");
    }

    #[test]
    fn parameters_read_as_the_ts_table_with_the_worlds_over_them() {
        let d = Lengnick::default();
        assert_eq!((d.phi_low_bps, d.phi_high_bps, d.theta_bps, d.vartheta_bps, d.chi_bps), (2500, 10_000, 7500, 200, 1000));
    }
}
