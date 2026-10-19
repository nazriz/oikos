//! How a buyer spreads its orders across suppliers: a general market law, built natively for the Rust world (ME-20;
//! docs/behaviour/sourcing.md).
//!
//! Retailers multi-source: a buyer splits its purchases of a good among several suppliers rather than giving all of it
//! to the cheapest, to keep its supply when one falls short and to keep its suppliers competing (dual and multiple
//! sourcing: Elmaghraby 2000; Burke, Carrillo and Vakharia 2007). How much each gets follows what the buyer knows of
//! each: its price and how fully it has delivered (price and delivery are the criteria buyers rank first: Dickson 1966;
//! Weber, Current and Benton 1991). The split is an attraction rule: each supplier's share of an order is its
//! attraction over the sum of all, the attraction being its delivery record times its price relative to the cheapest,
//! raised to a power (the multiplicative form of Bell, Keeney and Little 1975's market share theorem; Cooper and
//! Nakanishi 1988). Without it every shop moved its whole restocking to whichever factory was cheapest that week: the
//! factory could fill a few of the orders, the others' trade fell to nothing, and they let people go (a cobweb).
//!
//! **A clearance is weighed at the supplier's regular price.** A seller clearing stock at a discount says so on its
//! list (`clearance`: the quantity it is clearing, and `regular`: what it charges once that stock is gone); a buyer
//! does not move its standing custom for a discount that lasts as long as one lot (it pays the lower price on the
//! share it would have bought there anyway).
//!
//! **The delivery record.** What share of what was ordered the supplier delivered, over its last deliveries (each new
//! one weighs `fill_weight_bps`); a supplier not ordered from lately is given the benefit of the doubt again a step
//! at a time (`recover_bps` of the gap a restock), as buyers try a supplier again once its failure is old news.
//!
//! Everything is integer arithmetic; nothing is drawn.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The figures of the rule (a world's profile may state its own; placeholders, docs/risks.md ME-20).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourcingFigures {
    /// The power on the price relative to the cheapest (the price elasticity of a supplier's share).
    pub price_power: u32,
    /// How much a new delivery weighs in the delivery record (bps).
    pub fill_weight_bps: i64,
    /// How much of the way back to a full record a supplier not ordered from comes at each restock (bps).
    pub recover_bps: i64,
}

impl Default for SourcingFigures {
    fn default() -> Self {
        SourcingFigures { price_power: 10, fill_weight_bps: 2500, recover_bps: 1250 }
    }
}

impl SourcingFigures {
    pub fn read(ctx: &crate::Ctx) -> Result<Self, String> {
        let d = SourcingFigures::default();
        Ok(SourcingFigures {
            price_power: ctx.param("supplier_price_power", d.price_power)?,
            fill_weight_bps: ctx.param("supplier_fill_weight_bps", d.fill_weight_bps)?,
            recover_bps: ctx.param("supplier_recover_bps", d.recover_bps)?,
        })
    }
}

/// A supplier as the buyer weighs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub key: String,
    /// The price it is weighed at: its regular price (a clearance's is what it charges once the lot is gone).
    pub weigh_at: i64,
    /// The least it sells in one order.
    pub min: i64,
    /// Its delivery record (bps of what was ordered that it delivered).
    pub fill_bps: i64,
    /// The buyer's own order of preference between suppliers otherwise equal (a fact about whom it happens to deal with).
    pub standing: u64,
}

/// What a buyer has learned of each supplier's deliveries.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    fill: BTreeMap<String, i64>,
}

impl Record {
    /// The supplier's delivery record now (a full one for a supplier it has no word of).
    pub fn fill_bps(&self, supplier: &str) -> i64 {
        self.fill.get(supplier).copied().unwrap_or(10_000)
    }
    /// A delivery came: `delivered` of `ordered`.
    pub fn delivered(&mut self, f: &SourcingFigures, supplier: &str, ordered: i64, delivered: i64) {
        if ordered <= 0 {
            return;
        }
        let now = (delivered.clamp(0, ordered) * 10_000) / ordered;
        let was = self.fill_bps(supplier);
        let next = was + (now - was) * f.fill_weight_bps / 10_000;
        self.fill.insert(supplier.to_string(), next.clamp(0, 10_000));
    }
    /// A restock that ordered nothing from these: their records come back towards full a step.
    pub fn recover(&mut self, f: &SourcingFigures, not_ordered: &[&str]) {
        for s in not_ordered {
            if let Some(v) = self.fill.get_mut(*s) {
                *v += ((10_000 - *v) * f.recover_bps + 9_999) / 10_000;
                *v = (*v).min(10_000);
            }
        }
    }
}

/// A supplier's attraction: its delivery record times (cheapest price / its price) to the power (in bps of bps).
pub fn attraction(f: &SourcingFigures, c: &Candidate, cheapest: i64) -> i128 {
    if c.weigh_at <= 0 {
        return 0;
    }
    let rel = (i128::from(cheapest.max(1)) * 10_000 / i128::from(c.weigh_at)).clamp(0, 10_000);
    let mut x: i128 = 10_000;
    for _ in 0..f.price_power {
        x = x * rel / 10_000;
    }
    // (A record of nothing delivered still leaves a sliver: a buyer that has dropped a supplier can be won back by price
    // once its record has recovered, and is never divided by nothing.)
    i128::from(c.fill_bps.max(100)) * x / 10_000
}

/// How an order of `q` is split among the candidates: each a share by its attraction; a share under its supplier's
/// least order is given to the others (the least attractive first), and if every share is under its least, the whole
/// order goes to the most attractive, at least its least. In the candidates' order of attraction (then standing, key).
pub fn split(f: &SourcingFigures, cands: &[Candidate], q: i64) -> Vec<(usize, i64)> {
    if cands.is_empty() || q <= 0 {
        return vec![];
    }
    let cheapest = cands.iter().map(|c| c.weigh_at).filter(|p| *p > 0).min().unwrap_or(1);
    let w: Vec<i128> = cands.iter().map(|c| attraction(f, c, cheapest)).collect();
    let mut order: Vec<usize> = (0..cands.len()).filter(|i| w[*i] > 0).collect();
    order.sort_by(|a, b| w[*b].cmp(&w[*a]).then(cands[*a].standing.cmp(&cands[*b].standing)).then_with(|| cands[*a].key.cmp(&cands[*b].key)));
    if order.is_empty() {
        return vec![];
    }
    let mut active = order.clone();
    loop {
        let total: i128 = active.iter().map(|i| w[*i]).sum();
        let mut shares: Vec<(usize, i64)> = active.iter().map(|i| (*i, (i128::from(q) * w[*i] / total.max(1)) as i64)).collect();
        // (What the floors leave goes to the most attractive.)
        let given: i64 = shares.iter().map(|s| s.1).sum();
        shares[0].1 += q - given;
        // The least attractive whose share is under its least order is dropped, and the split made again.
        if let Some(pos) = shares.iter().rposition(|(i, s)| *s < cands[*i].min) {
            if active.len() == 1 {
                return vec![(active[0], q.max(cands[active[0]].min))];
            }
            active.remove(pos);
            continue;
        }
        return shares.into_iter().filter(|s| s.1 > 0).collect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(key: &str, price: i64, min: i64, fill: i64) -> Candidate {
        Candidate { key: key.into(), weigh_at: price, min, fill_bps: fill, standing: 0 }
    }

    #[test]
    fn an_order_is_spread_by_price_and_not_all_given_to_the_cheapest() {
        let f = SourcingFigures::default();
        let s = split(&f, &[c("a", 1000, 50, 10_000), c("b", 1010, 50, 10_000), c("c", 1100, 50, 10_000)], 600);
        let get = |k: usize| s.iter().find(|x| x.0 == k).map_or(0, |x| x.1);
        assert_eq!(s.iter().map(|x| x.1).sum::<i64>(), 600);
        assert!(get(0) > get(1) && get(1) > get(2), "cheaper gets more: {s:?}");
        assert!(get(1) * 10 > get(0) * 8, "a supplier 1% dearer keeps most of a share: {s:?}");
        assert!(get(2) > 0 && get(2) * 2 < get(0), "10% dearer: well under half the cheapest's share: {s:?}");
    }

    #[test]
    fn a_supplier_that_came_up_short_gets_less_until_it_recovers() {
        let f = SourcingFigures::default();
        let mut r = Record::default();
        r.delivered(&f, "a", 100, 0);
        r.delivered(&f, "a", 100, 0);
        assert!(r.fill_bps("a") < 6_000);
        let s = split(&f, &[c("a", 1000, 10, r.fill_bps("a")), c("b", 1000, 10, r.fill_bps("b"))], 400);
        assert!(s.iter().find(|x| x.0 == 1).unwrap().1 > s.iter().find(|x| x.0 == 0).unwrap().1);
        for _ in 0..60 {
            r.recover(&f, &["a"]);
        }
        assert_eq!(r.fill_bps("a"), 10_000);
    }

    #[test]
    fn shares_under_a_suppliers_least_order_go_to_the_others_and_a_small_order_to_the_most_attractive() {
        let f = SourcingFigures::default();
        let s = split(&f, &[c("a", 1000, 50, 10_000), c("b", 1000, 50, 10_000), c("c", 1000, 50, 10_000)], 120);
        assert_eq!(s.len(), 2, "three shares of 40 are each under 50: two of 60: {s:?}");
        assert_eq!(s.iter().map(|x| x.1).sum::<i64>(), 120);
        let one = split(&f, &[c("a", 1000, 50, 10_000), c("b", 1000, 50, 10_000)], 30);
        assert_eq!(one, vec![(0, 50)], "under every least: the most attractive, at its least");
    }

    #[test]
    fn the_same_offers_give_the_same_split() {
        let f = SourcingFigures::default();
        let cands = [c("a", 1000, 50, 9_000), c("b", 990, 50, 10_000)];
        assert_eq!(split(&f, &cands, 500), split(&f, &cands, 500));
    }
}
