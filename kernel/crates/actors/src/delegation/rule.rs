//! The principal's rule (docs/design/delegation.md section 5): what each level of a kind of matter would cost it a
//! month, from what it knows, and whether a service is worth engaging, keeping or leaving. Pure functions of figures the
//! principal holds: its own time and what it is worth, what an error costs it, how many matters of each kind it has done,
//! the provider's claim, and what it has itself seen come of the matters it handed over. Nothing here can read anything
//! else; the principal builds these figures from its own channels only (`principal`).
//!
//! Integers throughout: money in cents, rates in basis points, time in seconds; sums in `i128`.

use crate::papers::delegation::Level;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The principal's own time for each part of handing a matter over (the table of work's rows for those papers).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Seconds {
    pub referral: i64,
    pub sign_off: i64,
    pub go_ahead: i64,
}

impl Default for Seconds {
    fn default() -> Self {
        Seconds { referral: 120, sign_off: 300, go_ahead: 60 }
    }
}

/// What the principal knows of a kind of matter it does: how long one takes it, and what one done wrong costs it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct KindFacts {
    pub own_seconds: i64,
    pub error_cost: i64,
}

/// A kind as the rule weighs it: its facts, and how many a month it does.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Kind {
    pub facts: KindFacts,
    pub per_month: i64,
}

/// What the principal has seen come of the matters of a kind it handed over: how many it saw the end of, and of those
/// how many it found had gone wrong (a slip it caught, a draft it declined, a matter reported not done, advice it would not
/// have taken, a complaint about the matter).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Seen {
    pub n: i64,
    pub bad: i64,
    /// The records the counts come from (the newest few), for the decision's inputs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub from: Vec<String>,
}

impl Seen {
    pub const KEEP: usize = 16;
    pub fn saw(&mut self, bad: bool, record: &str) {
        self.n += 1;
        if bad {
            self.bad += 1;
        }
        self.cite(record);
    }
    /// A matter it had counted already turned out wrong (a complaint about it came later).
    pub fn turned_bad(&mut self, record: &str) {
        self.bad += 1;
        self.n = self.n.max(self.bad);
        self.cite(record);
    }
    fn cite(&mut self, record: &str) {
        if !self.from.iter().any(|r| r == record) {
            self.from.push(record.to_string());
        }
        if self.from.len() > Self::KEEP {
            self.from.remove(0);
        }
    }
}

/// The principal's figures for weighing, beyond a kind's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Weights {
    /// What an hour of its time is worth (cents).
    pub hour_value: i64,
    pub seconds: Seconds,
    /// Of the slips in a draft it reads whole, the share it believes it finds.
    pub finds_bps: i64,
    /// How many matters' worth the provider's claim counts for against what it has seen.
    pub prior_matters: i64,
    /// The margin a change must save by.
    pub hurdle_bps: i64,
    /// Months over which a set-up and an exit are spread.
    pub horizon_months: i64,
}

/// Its estimate of how often the assistant slips: the provider's claim, moved by what it has seen.
pub fn estimate(claim_bps: i64, prior_matters: i64, seen: &Seen) -> i64 {
    let prior = i128::from(prior_matters.max(0));
    let n = i128::from(seen.n.max(0));
    if prior + n == 0 {
        return claim_bps.max(0);
    }
    let v = (i128::from(claim_bps.max(0)) * prior + i128::from(seen.bad.max(0)) * 10_000 + (prior + n) / 2) / (prior + n);
    v.clamp(0, 10_000) as i64
}

fn time_cost(per_month: i64, seconds: i64, hour_value: i64) -> i128 {
    (i128::from(per_month) * i128::from(seconds.max(0)) * i128::from(hour_value.max(0)) + 1_800) / 3_600
}

/// What a kind of matter costs it a month at a level, with the assistant slipping `slip_bps` of the time (cents).
/// `Level::None` is doing it itself.
pub fn cost(level: Level, k: &Kind, slip_bps: i64, w: &Weights) -> i128 {
    let v = i128::from(k.per_month.max(0));
    let p = i128::from(slip_bps.clamp(0, 10_000));
    let err = i128::from(k.facts.error_cost.max(0));
    let own = |s: i64| time_cost(k.per_month, s, w.hour_value);
    let wrong = |share: i128| (v * p * share * err + 50_000_000) / 100_000_000;
    match level {
        Level::None => own(k.facts.own_seconds),
        Level::Advice => own(k.facts.own_seconds + w.seconds.referral),
        Level::Draft => {
            let f = i128::from(w.finds_bps.clamp(0, 10_000));
            // (What it finds it does itself: its own time again for those.)
            let redone = (v * p * f * i128::from(k.facts.own_seconds.max(0)) * i128::from(w.hour_value.max(0)) + 180_000_000_000) / (100_000_000 * 3_600);
            own(w.seconds.referral + w.seconds.sign_off) + wrong(10_000 - f) + redone
        }
        Level::Approve => own(w.seconds.referral + w.seconds.go_ahead) + wrong(10_000),
        Level::Alone => own(w.seconds.referral) + wrong(10_000),
    }
}

/// The cheapest of the levels on offer for a kind (itself included), with its cost. Ties go to doing it itself, then in
/// the order the levels are named (`Level::ALL`).
pub fn best(offered: &[Level], k: &Kind, slip_bps: i64, w: &Weights) -> (Level, i128) {
    let mut top = (Level::None, cost(Level::None, k, slip_bps, w));
    for l in Level::ALL {
        if l == Level::None || !offered.contains(&l) {
            continue;
        }
        let c = cost(l, k, slip_bps, w);
        if c < top.1 {
            top = (l, c);
        }
    }
    top
}

/// A service weighed whole: the best level of each kind, what it saves a month against doing everything itself, and
/// what it costs (the fee, with the set-up and the exit spread over the horizon).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Appraisal {
    pub levels: BTreeMap<String, Level>,
    pub saving: i128,
    pub fee: i128,
    pub amortised: i128,
    /// Worth taking: the saving covers the fee and the spread costs by the hurdle's margin.
    pub worth: bool,
    pub net: i128,
}

/// The service's offer as the rule needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Terms<'a> {
    pub kinds: &'a [String],
    pub levels: &'a [Level],
    pub claim_bps: i64,
    pub fee_month: i64,
    pub setup: i64,
    pub exit: i64,
}

/// Weighs a service: `kinds` are the principal's own (only those the offer takes count), `seen` what it has seen of each
/// under this service (none for one not yet engaged), `sunk` whether its set-up is paid already (a service in hand).
pub fn appraise(t: &Terms, kinds: &BTreeMap<String, Kind>, seen: &BTreeMap<String, Seen>, w: &Weights, sunk: bool) -> Appraisal {
    let mut levels = BTreeMap::new();
    let mut saving: i128 = 0;
    let none = Seen::default();
    for (name, k) in kinds {
        if !t.kinds.contains(name) || k.per_month <= 0 {
            continue;
        }
        let p = estimate(t.claim_bps, w.prior_matters, seen.get(name).unwrap_or(&none));
        let (l, c) = best(t.levels, k, p, w);
        if l != Level::None {
            saving += cost(Level::None, k, p, w) - c;
            levels.insert(name.clone(), l);
        }
    }
    let h = i128::from(w.horizon_months.max(1));
    let amortised = if sunk { 0 } else { (i128::from(t.setup.max(0)) + i128::from(t.exit.max(0)) + h / 2) / h };
    let fee = i128::from(t.fee_month.max(0));
    let worth = !levels.is_empty() && saving * 10_000 >= (fee + amortised) * i128::from(10_000 + w.hurdle_bps.max(0));
    Appraisal { levels, saving, fee, amortised, worth, net: saving - fee - amortised }
}

/// Whether a service in hand is worth leaving: what it saves no longer covers its fee, by more than leaving costs when
/// spread over the horizon.
pub fn leaving(a: &Appraisal, exit: i64, w: &Weights) -> bool {
    let h = i128::from(w.horizon_months.max(1));
    (a.fee - a.saving) * h > i128::from(exit.max(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w() -> Weights {
        Weights { hour_value: 4_000, seconds: Seconds::default(), finds_bps: 8_000, prior_matters: 20, hurdle_bps: 2_000, horizon_months: 12 }
    }
    fn k(per_month: i64, err: i64) -> Kind {
        Kind { facts: KindFacts { own_seconds: 1_800, error_cost: err }, per_month }
    }
    const ALL: [Level; 4] = [Level::Advice, Level::Draft, Level::Approve, Level::Alone];

    #[test]
    fn the_estimate_starts_at_the_claim_and_moves_only_with_what_was_seen() {
        assert_eq!(estimate(100, 20, &Seen::default()), 100);
        let mut s = Seen::default();
        for i in 0..20 {
            s.saw(false, &format!("r{i}"));
        }
        assert_eq!(estimate(100, 20, &s), 50, "twenty matters seen to go well halve a 1% claim");
        s.turned_bad("c1");
        assert!(estimate(100, 20, &s) > 50 && s.from.len() == Seen::KEEP, "a complaint later moves it back; the inputs kept are bounded");
    }

    #[test]
    fn no_level_is_a_rung_each_is_chosen_by_what_it_costs() {
        // A matter whose error costs little: going alone is cheapest, straight from doing it oneself.
        assert_eq!(best(&ALL, &k(10, 1_000), 100, &w()).0, Level::Alone);
        // One whose error is dear: a draft read whole is cheaper than going alone.
        assert_eq!(best(&ALL, &k(10, 50_000), 500, &w()).0, Level::Draft);
        // Dearer still, with slips common: doing it oneself.
        assert_eq!(best(&ALL, &k(10, 50_000_000), 5_000, &w()).0, Level::None);
        // Only what is offered can be chosen.
        assert_eq!(best(&[Level::Advice], &k(10, 1_000), 100, &w()).0, Level::None, "advice never saves time");
    }

    #[test]
    fn a_service_is_worth_taking_only_when_its_saving_covers_its_costs_by_the_hurdle() {
        let kinds: BTreeMap<String, Kind> = [("notice".to_string(), k(40, 1_000))].into();
        let names = vec!["notice".to_string()];
        let t = |fee: i64| Terms { kinds: &names, levels: &ALL, claim_bps: 100, fee_month: fee, setup: 100_000, exit: 50_000 };
        let cheap = appraise(&t(10_000), &kinds, &BTreeMap::new(), &w(), false);
        assert!(cheap.worth && cheap.levels["notice"] == Level::Alone, "{cheap:?}");
        assert!(!appraise(&t(200_000), &kinds, &BTreeMap::new(), &w(), false).worth);
        assert!(!appraise(&Terms { kinds: &[], ..t(10_000) }, &kinds, &BTreeMap::new(), &w(), false).worth, "nothing it does is taken");
        let dear = appraise(&t(200_000), &kinds, &BTreeMap::new(), &w(), true);
        assert!(leaving(&dear, 50_000, &w()) && !leaving(&cheap, 50_000, &w()));
    }
}
