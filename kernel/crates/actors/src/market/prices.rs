//! How a seller sets its price: from supply and demand, its costs, and what rivals charge as it can know them. Built
//! natively for the Rust world; it replaces Lengnick's (2013) price rule (a price held between 1.025 and 1.15 times
//! marginal cost, stepped on the state of the stock), which made gouging, deep discounting and monopoly pricing
//! impossible by construction (docs/risks.md ME-16). Documented in docs/behaviour/prices.md.
//!
//! **The rule**, once a month, for a firm that has the chance to look at its price (Calvo 1983: prices are sticky,
//! `theta_bps` of them are looked at in a month; Blinder et al. 1998 find the median firm reprices about once a year):
//! 1. *Imbalance.* Demand is what customers ordered and paid for last month, served or not. The seller reads scarcity
//!    from what it knows of its own books: orders it could not serve (customers turned away), stock below the band
//!    (`phi_low_bps` of a month's demand), staff who could not serve a month's demand. It reads glut from stock above
//!    the band (`phi_high_bps`). Their difference, in basis points, is the imbalance.
//! 2. *Step.* The price moves in the direction of the imbalance, by up to `adjust_bps` of it and never more than
//!    `vartheta_bps` in a month: price adjusts in proportion to excess demand (Lipsey 1960's law for markets; the
//!    sticky-price dynamics of the New Keynesian Phillips curve). The size of the step is drawn up to that bound, as
//!    firms differ in boldness.
//! 3. *Rivals.* A seller that has seen what rivals of its kind charge (price lists it has been shown, not a census: no
//!    god's view) is pulled towards their median by `rival_weight_bps` of the gap: competitors' prices are the second
//!    most cited reason for repricing in Blinder et al.'s survey, and a customer who can compare will. Scarcity lets a
//!    seller stay above rivals and glut lets it stay below; the pull acts against neither.
//! 4. *Bounds that come from the market, not from a table.* A price does not fall below marginal cost (a seller does
//!    not knowingly sell below cost) except to clear a stock more than `clearance_cover_bps` of a month's demand (a
//!    clearance sale: Lazear 1986, Pashigian 1988), down to `clearance_floor_bps` of cost; a price below cost is lifted
//!    towards it a step at a time. A price is not raised above its usual margin (`price_up_bound_bps` of cost) unless
//!    customers are being turned away or rivals charge more: so a seller can charge what scarcity allows (gouging
//!    emerges where there is scarcity and no rival to undercut), and cannot without it.
//!
//! Sources are in docs/research/references.md. Everything is integer arithmetic; the one random draw (whether the price
//! is looked at, and how bold the step) comes from the firm's own keyed stream, drawn in a fixed order.

use super::lengnick::Lengnick;
use crate::common::book::Book;
use crate::common::{data, Fields};
use oikos_core::rng::Rng;
use serde::{Deserialize, Serialize};

/// The figures the rule adds to Lengnick's Table 1 (a world's profile may state its own; all placeholders).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PriceFigures {
    /// How much of the imbalance a month's price step answers (bps of it).
    pub adjust_bps: i64,
    /// How much of the gap to rivals' median price a month's step closes (bps of the gap).
    pub rival_weight_bps: i64,
    /// Stock beyond this share of a month's demand is cleared at a discount.
    pub clearance_cover_bps: i64,
    /// The lowest a clearance sale takes a price, as a share of marginal cost.
    pub clearance_floor_bps: i64,
    /// How old a rival's price list may be and still count, in days.
    pub rival_days: i64,
}

impl Default for PriceFigures {
    fn default() -> Self {
        PriceFigures { adjust_bps: 5000, rival_weight_bps: 2500, clearance_cover_bps: 30_000, clearance_floor_bps: 8000, rival_days: 60 }
    }
}

impl PriceFigures {
    pub fn read(ctx: &crate::Ctx) -> Result<Self, String> {
        let d = PriceFigures::default();
        Ok(PriceFigures {
            adjust_bps: ctx.param("price_adjust_bps", d.adjust_bps)?,
            rival_weight_bps: ctx.param("rival_weight_bps", d.rival_weight_bps)?,
            clearance_cover_bps: ctx.param("clearance_cover_bps", d.clearance_cover_bps)?,
            clearance_floor_bps: ctx.param("clearance_floor_bps", d.clearance_floor_bps)?,
            rival_days: ctx.param("rival_days", d.rival_days)?,
        })
    }
}

/// What a seller knows when it looks at its price.
#[derive(Debug, Clone)]
pub struct Signals<'a> {
    pub price: i64,
    pub marginal_cost: i64,
    /// Last month's demand: units ordered and paid for, served or not.
    pub demand: i64,
    /// Of that, units it could not serve (out of stock, or out of hands).
    pub turned_away: i64,
    pub stock: i64,
    /// What a month's work by its staff can serve (a firm whose sales take its staff's time); absent: no such limit.
    pub can_supply: Option<i64>,
    /// What rivals of its kind were last seen to charge.
    pub rivals: &'a [i64],
}

/// The imbalance the rule reads, in basis points: positive, scarcity; negative, glut. Also its two parts.
pub fn imbalance(l: &Lengnick, s: &Signals) -> (i64, i64) {
    let demand = s.demand.max(0);
    let band_low = i128::from(l.phi_low_bps) * i128::from(demand);
    let short_handed = s.can_supply.is_some_and(|c| c < demand);
    let mut up = 0_i64;
    if demand > 0 {
        up = up.max((i128::from(s.turned_away.max(0)) * 10_000 / i128::from(demand)) as i64);
        if i128::from(s.stock.max(0)) * 10_000 < band_low {
            up = up.max(((band_low - i128::from(s.stock.max(0)) * 10_000) * 10_000 / band_low.max(1)) as i64);
        }
        if let (true, Some(c)) = (short_handed, s.can_supply) {
            up = up.max((i128::from(demand - c.max(0)) * 10_000 / i128::from(demand)) as i64);
        }
    }
    let mut down = 0_i64;
    let stock = i128::from(s.stock.max(0)) * 10_000;
    let band_high = i128::from(l.phi_high_bps) * i128::from(demand);
    if !short_handed && stock > band_high && stock > 0 {
        down = ((stock - band_high) * 10_000 / stock) as i64;
    }
    (up.clamp(0, 10_000), down.clamp(0, 10_000))
}

/// The middle value of the prices (the lower of the two middle ones for an even count): an integer, a rule of its own.
pub fn median(prices: &[i64]) -> Option<i64> {
    if prices.is_empty() {
        return None;
    }
    let mut v = prices.to_vec();
    v.sort_unstable();
    Some(v[(v.len() - 1) / 2])
}

/// A price after a month's look: the new price, and why it moved, if it did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Moved {
    pub price: i64,
    pub why: Option<String>,
}

/// The price rule. `money` writes an amount in the world's money for the reason given.
pub fn move_price(l: &Lengnick, f: &PriceFigures, rng: &mut Rng, s: &Signals, money: &dyn Fn(i64) -> String) -> Moved {
    let stay = Moved { price: s.price, why: None };
    // Calvo: only some prices are looked at in a month. (Drawn first, always, so the stream's order never depends on
    // what the seller knows.)
    let looked = rng.below(10_000) as i64 >= 10_000 - l.theta_bps;
    let boldness = rng.below(10_000) as i64;
    if !looked || s.price <= 0 {
        return stay;
    }
    let vt = l.vartheta_bps.max(0);
    let (up, down) = imbalance(l, s);
    let net = up - down;
    // The part of the step that answers the imbalance, and the part that answers rivals.
    let answer = (f.adjust_bps * net / 10_000).clamp(-vt, vt);
    let rival = median(s.rivals);
    let pull = rival
        .map(|m| ((f.rival_weight_bps * ((m - s.price) * 10_000 / s.price)) / 10_000).clamp(-vt, vt))
        .map(|p| match net {
            n if n > 0 => p.max(0),
            n if n < 0 => p.min(0),
            _ => p,
        })
        .unwrap_or(0);
    let total = (answer + pull).clamp(-vt, vt);
    // Firms differ in boldness: the step is drawn up to its size.
    let step = (total.abs() * (boldness + 1)) / 10_000;
    let mut next = match total {
        t if t > 0 => div_up(s.price * (10_000 + step), 10_000),
        t if t < 0 => s.price * (10_000 - step) / 10_000,
        _ => s.price,
    };
    // Bounds from the market.
    let cost = s.marginal_cost.max(0);
    let clearing = s.demand > 0 && i128::from(s.stock) * 10_000 > i128::from(f.clearance_cover_bps) * i128::from(s.demand);
    let floor = if clearing { cost * f.clearance_floor_bps / 10_000 } else { cost };
    if next < floor {
        next = if s.price >= floor { floor } else { floor.min(div_up(s.price * (10_000 + vt), 10_000)) };
    }
    if next > s.price && up == 0 {
        // A rise with no scarcity behind it goes as far as rivals charge or the usual margin, and no further.
        let usual = div_up(cost * l.price_up_bound_bps, 10_000);
        let limit = s.price.max(usual).max(rival.unwrap_or(0).min(div_up(s.price * (10_000 + vt), 10_000)));
        next = next.min(limit);
    }
    let next = next.max(1);
    if next == s.price {
        return stay;
    }
    let words = if next > s.price {
        let mut why = vec![];
        if s.turned_away > 0 {
            why.push(format!("we turned away {} of last month's {} ordered", s.turned_away, s.demand));
        }
        if i128::from(s.stock) * 10_000 < i128::from(l.phi_low_bps) * i128::from(s.demand) {
            why.push(format!("stock ({}) is low against last month's demand ({})", s.stock, s.demand));
        }
        if let Some(c) = s.can_supply.filter(|c| *c < s.demand) {
            why.push(format!("we could serve {c} of last month's demand ({})", s.demand));
        }
        if let Some(m) = rival.filter(|m| *m > s.price) {
            why.push(format!("rivals we have seen charge {}", money(m)));
        }
        format!("Month's end: {}: raising our price to {} (cost {}).", if why.is_empty() { "the market will bear it".to_string() } else { why.join("; ") }, money(next), money(cost))
    } else {
        let mut why = vec![];
        if down > 0 {
            why.push(format!("stock ({}) is high against last month's demand ({})", s.stock, s.demand));
        }
        if let Some(m) = rival.filter(|m| *m < s.price) {
            why.push(format!("rivals we have seen charge {}", money(m)));
        }
        let note = if clearing { ", clearing it" } else { "" };
        format!("Month's end: {}{note}: cutting our price to {} (cost {}).", why.join("; "), money(next), money(cost))
    };
    Moved { price: next, why: Some(words) }
}

fn div_up(a: i64, b: i64) -> i64 {
    (a + b - 1).div_euclid(b)
}

/// At which level of trade a seller's price lists are compared: a shop's list is for households (no minimum order); a
/// wholesaler's, or the world market's, has a minimum order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Level {
    Retail,
    Wholesale,
}

/// What rivals of a seller are last seen to charge for a kind of goods: the latest standing price list of each other
/// seller the book holds that lists the kind at the same level of trade, not older than `max_age` seconds. Only what
/// the seller has been shown (its own board, its search of what sellers advertise, a shop it passed): there is no
/// census of prices to read (docs/no-god-view.md). In seller-id order.
pub fn rivals_seen(book: &Book, me: &str, kind: &str, level: Level, t: i64, max_age: i64) -> Vec<i64> {
    let mut latest: std::collections::BTreeMap<&str, (i64, i64)> = Default::default();
    for r in book.open("price_list") {
        let Some(s) = r.speaks_for.as_deref().filter(|s| *s != me) else { continue };
        let d = data(r);
        let Some(p) = d.get("goods").and_then(|g| g.get(kind)).and_then(serde_json::Value::as_i64).filter(|p| *p > 0) else { continue };
        let wholesale = d.i("min_order").is_some_and(|m| m > 1);
        if (level == Level::Wholesale) != wholesale || t - r.at > max_age {
            continue;
        }
        match latest.get(s) {
            Some((at, _)) if r.at <= *at => {}
            _ => {
                latest.insert(s, (r.at, p));
            }
        }
    }
    latest.values().map(|(_, p)| *p).collect()
}

/// How much a seller can expect the outside world to take from it: the room it has found under the world's standing
/// offer. The outside is a price-taker's market (a small open economy takes what it is sold at the world price), so
/// a seller is limited by what it can make and ship, and by how much of the outside's appetite other sellers have
/// already taken, which it cannot see (no god's view): it learns that from the goods the outside sends back unpaid.
/// Each month it ships what it can; the room next month is what was accepted, probed upward by `probe_bps` when
/// nothing was returned. A quantity adjustment by trial, as sellers in a market find their share without being told it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportRoom {
    /// The room found: what the outside took of the last month's shipments, probed upward if it took all.
    room: Option<i64>,
    shipped: i64,
    returned: i64,
}

impl ExportRoom {
    /// A shipment went out under this month's offer.
    pub fn shipped(&mut self, q: i64) {
        self.shipped += q.max(0);
    }
    /// The outside sent back some of a shipment unpaid (its demand was met).
    pub fn sent_back(&mut self, q: i64) {
        self.returned += q.max(0);
    }
    /// A shipment was not made after all.
    pub fn not_shipped(&mut self, q: i64) {
        self.shipped = (self.shipped - q).max(0);
    }
    /// The month turned: learn from it.
    pub fn month_end(&mut self, probe_bps: i64) {
        if self.shipped > 0 {
            let accepted = (self.shipped - self.returned).max(0);
            self.room = Some(if self.returned == 0 { accepted + (accepted * probe_bps / 10_000).max(1) } else { accepted });
        } else if let Some(r) = self.room {
            // Nothing sent: the room is kept as it was found.
            self.room = Some(r);
        }
        self.shipped = 0;
        self.returned = 0;
    }
    /// This month's room, given the offer's total quantity (an upper bound the seller can read) and the share of it
    /// already shipped this month. Before it has learned any, the whole offer is open to it.
    pub fn open(&self, offer_quantity: i64) -> i64 {
        let cap = self.room.unwrap_or(offer_quantity).min(offer_quantity);
        (cap - self.shipped).max(0)
    }
    /// The share of the offer a seller plans on: the room it has found, else the share the offer names for it, else the
    /// whole offer.
    pub fn share(&self, offer_quantity: i64, named: Option<i64>) -> i64 {
        self.room.or(named).unwrap_or(offer_quantity).min(offer_quantity).max(0)
    }
    pub fn found(&self) -> Option<i64> {
        self.room
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_core::rng::Randomness;

    fn money(n: i64) -> String {
        format!("${}.{:02}", n / 100, n % 100)
    }
    fn sig<'a>(price: i64, cost: i64, demand: i64, stock: i64, rivals: &'a [i64]) -> Signals<'a> {
        Signals { price, marginal_cost: cost, demand, turned_away: 0, stock, can_supply: None, rivals }
    }
    fn certain() -> Lengnick {
        Lengnick { theta_bps: 10_000, ..Default::default() }
    }
    /// The same draw every time the seed is: runs of the rule over many seeds, to read what it does on average.
    fn runs(l: &Lengnick, s: &Signals, n: u64) -> Vec<Moved> {
        (0..n).map(|i| move_price(l, &PriceFigures::default(), &mut Randomness::new(i).stream(&["price"]), s, &money)).collect()
    }

    #[test]
    fn scarcity_raises_the_price_and_glut_lowers_it_and_balance_leaves_it() {
        let l = certain();
        let scarce = Signals { turned_away: 40, ..sig(1000, 800, 100, 5, &[]) };
        let rises = runs(&l, &scarce, 200);
        assert!(rises.iter().all(|m| m.price >= 1000 && m.price <= 1020), "up to vartheta: {:?}", rises.iter().map(|m| m.price).max());
        assert!(rises.iter().filter(|m| m.price > 1000).count() > 150);
        let glut = sig(1000, 800, 100, 400, &[]);
        let falls = runs(&l, &glut, 200);
        assert!(falls.iter().all(|m| m.price <= 1000 && m.price >= 980));
        assert!(falls.iter().filter(|m| m.price < 1000).count() > 100);
        // Stock inside the band, nobody turned away: the price stays.
        assert!(runs(&l, &sig(1000, 800, 100, 60, &[]), 50).iter().all(|m| m.price == 1000 && m.why.is_none()));
    }

    #[test]
    fn a_price_is_looked_at_only_some_months() {
        let l = Lengnick { theta_bps: 2500, ..Default::default() };
        let scarce = Signals { turned_away: 90, ..sig(1000, 800, 100, 0, &[]) };
        let moved = runs(&l, &scarce, 400).iter().filter(|m| m.price != 1000).count();
        assert!((60..140).contains(&moved), "about a quarter of months: {moved}");
    }

    #[test]
    fn a_price_is_not_cut_below_cost_except_to_clear_a_stock_far_over_a_months_demand() {
        let l = certain();
        // At cost already: a glut does not take it lower.
        assert!(runs(&l, &sig(800, 800, 100, 250, &[]), 100).iter().all(|m| m.price == 800));
        // Four months of stock: a clearance sale, down to 80% of cost and no lower.
        let clear = runs(&l, &sig(800, 800, 100, 400, &[]), 200);
        assert!(clear.iter().any(|m| m.price < 800), "clearing sells below cost");
        let mut p = 800;
        for i in 0..200 {
            p = move_price(&l, &PriceFigures::default(), &mut Randomness::new(i).stream(&["x"]), &sig(p, 800, 100, 400, &[]), &money).price;
        }
        assert_eq!(p, 640, "the floor of a clearance sale: 80% of cost");
        // A price below cost climbs back towards it a step at a time.
        let up = runs(&l, &sig(700, 800, 100, 60, &[]), 50);
        assert!(up.iter().all(|m| m.price > 700 && m.price <= 714 + 1), "{:?}", up.iter().map(|m| m.price).collect::<Vec<_>>());
    }

    #[test]
    fn without_scarcity_a_price_does_not_climb_past_its_usual_margin_but_with_scarcity_it_does() {
        let l = certain();
        // 1.15 x 800 = 920: a price there, with rivals no higher and no one turned away, stays.
        assert!(runs(&l, &sig(920, 800, 100, 5, &[]), 50).iter().all(|m| m.price >= 920));
        let calm = Signals { can_supply: None, ..sig(930, 800, 100, 60, &[]) };
        assert!(runs(&l, &calm, 50).iter().all(|m| m.price <= 930), "no evidence of scarcity: no rise past the usual margin");
        let scarce = Signals { turned_away: 50, ..sig(930, 800, 100, 0, &[]) };
        assert!(runs(&l, &scarce, 100).iter().any(|m| m.price > 930), "scarcity lets it charge what the market bears");
    }

    #[test]
    fn rivals_seen_pull_a_price_towards_their_median_without_overriding_scarcity_or_glut() {
        let l = certain();
        let rivals = [900, 1000, 1100];
        // Balanced, dearer than rivals: it comes down.
        assert!(runs(&l, &sig(1200, 800, 100, 60, &rivals), 100).iter().all(|m| m.price <= 1200));
        assert!(runs(&l, &sig(1200, 800, 100, 60, &rivals), 100).iter().any(|m| m.price < 1200));
        // Balanced, cheaper than rivals: it goes up towards them (price leadership and customers' comparing).
        assert!(runs(&l, &sig(900, 700, 100, 60, &rivals), 100).iter().any(|m| m.price > 900));
        // Scarce and dearer than rivals: it does not undercut them.
        let scarce = Signals { turned_away: 60, ..sig(1200, 800, 100, 0, &rivals) };
        assert!(runs(&l, &scarce, 100).iter().all(|m| m.price >= 1200));
        // Glut and cheaper than rivals: it does not raise to meet them.
        assert!(runs(&l, &sig(900, 700, 100, 400, &rivals), 100).iter().all(|m| m.price <= 900));
    }

    #[test]
    fn a_shop_short_of_hands_is_short_as_a_shop_short_of_stock_is_and_never_cuts_while_it_turns_customers_away() {
        let l = certain();
        let s = Signals { can_supply: Some(60), ..sig(1000, 800, 100, 500, &[]) };
        let (up, down) = imbalance(&l, &s);
        assert_eq!((up, down), (4000, 0), "stock is plentiful but hands are not");
        assert!(runs(&l, &s, 100).iter().all(|m| m.price >= 1000));
    }

    #[test]
    fn rivals_are_the_other_sellers_of_the_same_level_last_shown_and_not_a_census() {
        use crate::market::testkit::*;
        let book = book_of(vec![
            statement("rec.1", 10, "shop-a", "price_list", &[], json_goods("bread", 500, None)),
            statement("rec.2", 90, "shop-a", "price_list", &[], json_goods("bread", 520, None)),
            statement("rec.3", 80, "shop-b", "price_list", &[], json_goods("bread", 480, None)),
            statement("rec.4", 85, "mill", "price_list", &[], json_goods("bread", 300, Some(50))),
            statement("rec.5", 5, "shop-c", "price_list", &[], json_goods("bread", 100, None)),
            statement("rec.6", 80, "me", "price_list", &[], json_goods("bread", 999, None)),
        ]);
        let retail = rivals_seen(&book, "me", "bread", Level::Retail, 100, 60);
        assert_eq!(retail, vec![520, 480], "a-then-b order; the latest of a; c is too old; the wholesaler and I are not retail rivals");
        assert_eq!(rivals_seen(&book, "me", "bread", Level::Wholesale, 100, 60), vec![300]);
    }

    fn json_goods(kind: &str, p: i64, min: Option<i64>) -> serde_json::Value {
        let mut d = serde_json::json!({ "goods": { kind: p }, "account": "acc" });
        if let Some(m) = min {
            d["min_order"] = serde_json::json!(m);
        }
        d
    }

    #[test]
    fn an_exporter_finds_its_share_of_the_outsides_appetite_by_what_comes_back() {
        let mut r = ExportRoom::default();
        assert_eq!(r.open(500), 500, "before it has learned any, the whole offer is open to it");
        r.shipped(300);
        r.sent_back(100);
        assert_eq!(r.open(500), 200, "this month's room is what is left of the offer");
        r.month_end(1000);
        assert_eq!(r.found(), Some(200), "what was accepted");
        assert_eq!(r.open(500), 200);
        r.shipped(200);
        r.month_end(1000);
        assert_eq!(r.found(), Some(220), "nothing came back: probe 10% upward");
        r.month_end(1000);
        assert_eq!(r.found(), Some(220), "no shipment: the room is kept");
    }
}
