//! world.trade and world.export_demand: the outside world as a trader and a buyer (a boundary condition, D31;
//! docs/behaviour/boundary.md). Ported from participants/src/behaviour/world.ts and rewritten for Rust.
//!
//! The world market is large next to a town, so it sells whatever is ordered at world prices and buys at world prices up
//! to a demand, both researcher-set. It publishes a price list (`sells`) and fills paid orders from outside; each month it
//! publishes a buying offer for each kind it `buys`, and pays invoices for goods shipped under the offer once the goods
//! have arrived; goods beyond the month's appetite are sent back, unpaid. World prices move: each month a kind's price
//! level takes a random step and drifts back towards where it started (`price_process`), and scripted shocks multiply a
//! kind's price or demand from a day on (`shocks`).
//!
//! **What is new (docs/risks.md ME-15).** The TS split the month's appetite among the factories that existed when the
//! town began (`from`), so a new factory could not export and the employment base was pinned. Here the appetite is the
//! outside's alone, open to every seller, taken in the order invoices arrive, and it depends on the world price (below).
//! `from` is read and ignored: a world that still names it gives its sellers a prior for their room (the offer still
//! carries it as `quantities`), never a limit. The appetite for a kind at the month's world price p, against the price
//! level it was set at (p0), is `per_month x (1 - e (p - p0) / p0)`, within a tenth and three times the base, where `e`
//! is `demand_elasticity_bps` (a placeholder: the price elasticity of the rest of the world's demand for the town's
//! goods; the foreign demand of an open economy falls as the price it must pay rises: the Armington (1969) treatment of
//! imports as imperfect substitutes, with elasticities of one to a few in trade studies (to confirm)). With `e` zero
//! (the default) the appetite is flat, as before. A seller's competitiveness is its own cost against the world price: it
//! ships only while that covers its marginal cost (producer.rs).

use crate::common::book::Book;
use crate::common::{cents, data, filed_before, money_words, withdraw, Fields, MONTH};
use crate::market::trade::{self, decline, decline_on_terms, fill, held, price_list, send_back, Order, OrderBook, SellingTerms, TradeThen};
use crate::steps::{because, call, pay, say, text, Done, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture, DAY};
use oikos_sight::OutcomeStatus;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const TRADE_MANIFEST: &str = include_str!("../../../../../participants/manifests/world.trade.json");
const EXPORT_MANIFEST: &str = include_str!("../../../../../participants/manifests/world.export_demand.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Buy {
    unit_price: i64,
    per_month: i64,
    #[serde(default)]
    from: Option<BTreeMap<String, i64>>,
    #[serde(default)]
    demand_elasticity_bps: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Process {
    sd_bps: i64,
    persistence_bps: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Shock {
    from_day: i64,
    kind: String,
    what: String,
    factor_bps: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    account: String,
    sells: BTreeMap<String, i64>,
    buys: BTreeMap<String, Buy>,
    wait_days: i64,
    min_order: i64,
    terms_days: i64,
    terms_stop_after_days: i64,
    terms_claim_after_days: i64,
    price_process: BTreeMap<String, Process>,
    shocks: Vec<Shock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Then {
    Trade(TradeThen),
    List,
    Offer { kind: String },
    Delivered { order: Order, t: i64 },
    Paid { kind: String, back: i64 },
}
impl From<TradeThen> for Then {
    fn from(t: TradeThen) -> Then {
        Then::Trade(t)
    }
}

#[derive(Serialize, Deserialize)]
struct Market {
    me: String,
    p: Params,
    book: Book,
    orders: OrderBook,
    published_key: String,
    list_id: Option<String>,
    level: BTreeMap<String, i64>,
    offers: BTreeMap<String, String>,
    month: i64,
    bought: BTreeMap<String, i64>,
    sent: BTreeMap<String, i64>,
    paid_for: BTreeMap<String, i64>,
    baseline: BTreeMap<String, i64>,
    answered: BTreeSet<String>,
}

impl Market {
    /// A kind's scripted factor on its price or demand now (basis points; the latest shock that has started).
    fn shocked(&self, kind: &str, what: &str, t: i64) -> i64 {
        self.p.shocks.iter().filter(|s| s.kind == kind && s.what == what && s.from_day * DAY <= t).max_by_key(|s| s.from_day).map_or(10_000, |s| s.factor_bps)
    }
    fn price_of(&self, kind: &str, base: i64, t: i64) -> i64 {
        let level = self.level.get(kind).copied().unwrap_or(10_000);
        let x = base * level / 10_000 * self.shocked(kind, "price", t);
        ((2 * x + 10_000) / 20_000).max(1)
    }
    fn sells_now(&self, t: i64) -> BTreeMap<String, i64> {
        self.p.sells.iter().map(|(k, x)| (k.clone(), self.price_of(k, *x, t))).collect()
    }
    /// What it buys this month: its price as world prices move; the appetite scaled by the demand shock and by how the
    /// price has moved against where it was set.
    fn buying_now(&self, kind: &str, b: &Buy, t: i64) -> (i64, i64) {
        let unit = self.price_of(kind, b.unit_price, t);
        let f = self.shocked(kind, "demand", t);
        let e = b.demand_elasticity_bps.unwrap_or(0);
        let responsive = (10_000 - e * ((unit - b.unit_price) * 10_000 / b.unit_price.max(1)) / 10_000).clamp(1_000, 30_000);
        (unit, b.per_month * f / 10_000 * responsive / 10_000)
    }
}

impl Plan for Market {
    type Then = Then;
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.orders.take(pic, Some(&self.p.account));
        let kinds: BTreeSet<String> = self.p.sells.keys().chain(self.p.buys.keys()).cloned().collect();
        for k in kinds {
            let h = held(pic, &self.me, &k);
            self.baseline.entry(k).or_insert(h);
        }
    }

    fn then(&mut self, tok: &Then, done: Done, cx: &mut Cx) -> Vec<Step<Then>> {
        match tok {
            Then::Trade(t) => trade::then(t, done, &mut self.orders, cx),
            Then::List => {
                if let Done::Outcome(o) = done {
                    if let Some(id) = o.created.as_ref().and_then(|c| c.get("list")) {
                        self.list_id = Some(id.to_string());
                    }
                }
                vec![]
            }
            Then::Offer { kind } => {
                if let Done::Outcome(o) = done {
                    if let Some(id) = o.created.as_ref().and_then(|c| c.get("offer")) {
                        self.offers.insert(kind.clone(), id.to_string());
                    }
                }
                vec![]
            }
            Then::Delivered { order, t } =>
                match done {
                    Done::Outcome(o) if o.status == OutcomeStatus::Applied => {
                        *self.sent.entry(order.kind.clone()).or_insert(0) += order.quantity;
                        self.orders.bill(order, order.quantity, *t);
                        vec![]
                    }
                    d => trade::then(&TradeThen::DeliveryRefused { order: order.clone(), from_at: self.me.clone(), pay_from: self.p.account.clone() }, d, &mut self.orders, cx),
                }
            ,
            Then::Paid { kind, back } => {
                if let Done::Outcome(o) = done {
                    if o.status == OutcomeStatus::Applied {
                        *self.sent.entry(kind.clone()).or_insert(0) += back;
                    }
                }
                vec![]
            }
        }
    }

    #[allow(clippy::too_many_lines)]
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let t = pic.t;
        let me = self.me.clone();
        let world = cx.ctx.world.clone();
        let money = move |n: i64| money_words(n, &world);
        let mut steps: Vec<Step<Then>> = vec![];
        // A new month: world prices take their step (a random step, drifting back towards where they started). The
        // world's price for a month is the world's: named for the good and the month, from the seed, never for the hour
        // this office happens to wake in.
        let m0 = t.div_euclid(MONTH);
        if m0 != self.month && self.month >= 0 {
            let processes: Vec<(String, Process)> = self.p.price_process.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
            for (kind, pr) in processes {
                let mut r = cx.chance(&format!("world-price/{kind}/{m0}"));
                let mut z: i64 = -60_000; // a normal draw in basis points of a standard deviation: 12 uniforms less 6 (Irwin-Hall)
                for _ in 0..12 {
                    z += r.below(10_000) as i64;
                }
                let now = self.level.get(&kind).copied().unwrap_or(10_000);
                self.level.insert(kind, (10_000 + (now - 10_000) * pr.persistence_bps / 10_000 + z * pr.sd_bps / 10_000).max(1_000));
            }
        }
        let sells = self.sells_now(t);
        let key = serde_json::to_string(&sells).unwrap_or_default();
        if key != self.published_key && !sells.is_empty() {
            let first = self.published_key.is_empty();
            self.published_key = key;
            let list = sells.iter().map(|(k, x)| format!("{k} {}", money(*x))).collect::<Vec<_>>().join("; ");
            let mut calls = vec![];
            if let Some(id) = &self.list_id {
                calls.push(withdraw(id, Some("Superseded: world prices have moved.")));
            }
            let words = format!(
                "Sold from outside, delivered, at world prices (each): {list}; at least {} to an order. Order and pay with the order{}.",
                self.p.min_order,
                if self.p.terms_days > 0 { format!(", or order on terms and pay within {} days of delivery", self.p.terms_days) } else { String::new() }
            );
            let mut extra = json!({ "min_order": self.p.min_order });
            if self.p.terms_days > 0 {
                extra["terms_days"] = json!(self.p.terms_days);
            }
            let mut s = because(if first { "The world market's prices, for anyone in the town who buys from outside." } else { "World prices have moved: republishing ours." }, calls);
            s.lines.push(oikos_sight::calls::Line { bind: Some("list".into()), call: price_list(&sells, &self.p.account, &words, extra, None, None, true), });
            s.then = Some(Then::List);
            steps.push(s);
        }
        // Orders paid in full: deliver from outside. An order below the world price, or for something not sold, is refunded.
        let due = self.orders.due(&self.book, t, |_| true);
        for o in &due.stopped {
            steps.push(decline_on_terms::<Then>(o, &me, &format!("An order on our terms from {}, which has not paid what it owed us: declining it.", o.buyer)));
        }
        steps.extend(self.orders.collect::<Then>(t, &self.p.account, cx));
        for o in &due.paid {
            let price = sells.get(&o.kind).copied();
            let ok = price.is_some_and(|p| o.unit_price >= p) && o.quantity >= self.p.min_order;
            let why = if ok {
                format!("An order paid in full: delivering {} {} from outside.", o.quantity, o.kind)
            } else {
                format!(
                    "An order {}: refunding it.",
                    match price {
                        None => format!("for {}, which isn't sold from outside", o.kind),
                        Some(_) if o.quantity < self.p.min_order => format!("for fewer than {}", self.p.min_order),
                        Some(_) => "below the world price".to_string(),
                    }
                )
            };
            let mut st: Step<Then> = fill(o, if ok { o.quantity } else { 0 }, &me, &self.p.account, &why, cx);
            if ok {
                st.then = Some(Then::Delivered { order: o.clone(), t });
            }
            steps.push(st);
        }
        for o in &due.unpaid {
            steps.push(decline::<Then>(o, &me, "An order unpaid for a week: declining it."));
        }
        for (a, x) in self.orders.unclaimed(&self.book) {
            self.orders.refunded(&a);
            steps.push(send_back::<Then>(&a, x, &self.p.account, cx));
        }
        // A new month: the buying offers for it.
        let m = t.div_euclid(MONTH);
        if m != self.month {
            self.month = m;
            self.bought.clear();
            let buys: Vec<(String, Buy)> = self.p.buys.iter().map(|(k, b)| (k.clone(), b.clone())).collect();
            for (kind, b0) in buys {
                let (unit, appetite) = self.buying_now(&kind, &b0, t);
                let mut calls = vec![];
                if let Some(old) = self.offers.get(&kind) {
                    calls.push(withdraw(old, Some("Superseded by this month's offer.")));
                }
                let mut d = json!({ "kind": kind, "unit_price": unit, "quantity": appetite, "until": (m + 1) * MONTH, "account": self.p.account });
                if let Some(f) = &b0.from {
                    // (A prior for a seller's room, never a limit: docs/risks.md ME-15.)
                    let scale = |q: i64| q * self.shocked(&kind, "demand", t) / 10_000;
                    d["quantities"] = json!(f.iter().map(|(s, q)| (s.clone(), scale(*q))).collect::<BTreeMap<_, _>>());
                }
                let words = format!("Buying {kind} from the town this month: up to {appetite} at {} each, from any seller. Ship to us (the outside) and invoice us; we pay once the goods arrive.", money(unit));
                calls.push(say("buying_offer", &words, Say { visible: Some(Visible::Public), data: Some(d), ..Default::default() }));
                let mut s = because(format!("A new month: the world market's demand for the town's {kind}."), calls);
                if let Some(l) = s.lines.last_mut() {
                    l.bind = Some("offer".into());
                }
                s.then = Some(Then::Offer { kind: kind.clone() });
                steps.push(s);
            }
        }
        // Invoices for goods shipped to us: pay those whose goods have come, up to the month's appetite, in the order
        // they arrived; send back the rest.
        let arrived = |s: &Self, kind: &str| { held(pic, &me, kind) - s.baseline.get(kind).copied().unwrap_or(0) + s.sent.get(kind).copied().unwrap_or(0) - s.paid_for.get(kind).copied().unwrap_or(0)};
        let mut invoices: Vec<_> = self.book.open("invoice").filter(|r| crate::common::addressed_to(r).iter().any(|a| *a == me) && !self.answered.contains(r.id.as_str())).cloned().collect();
        invoices.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
        for inv in invoices {
            let d = data(&inv).clone();
            let kind = d.s("kind").unwrap_or_default().to_string();
            let q = d.i("quantity").unwrap_or(0).max(0);
            let owed = d.get("outcome").and_then(|o| o.get("money")).cloned();
            let offer = self.p.buys.get(&kind).map(|b| self.buying_now(&kind, b, t));
            let from = inv.speaks_for.unwrap_or_default();
            let to = owed.as_ref().and_then(|o| o.s("to")).map(str::to_string);
            let (Some(offer), true, Some(owed_to)) = (offer, q > 0, to) else {
                self.answered.insert(inv.id.to_string());
                steps.push(because(
                    "An invoice we can't pay: it isn't for goods we buy, or doesn't say how many or where to pay.",
                    vec![say("invoice_declined", &format!("Invoice {} declined: we don't buy this.", inv.id), Say { to: Some(vec![from.to_string()]), visible: Some(Visible::Only(vec![from.to_string(), me.clone()])), basis: Some(inv.id.to_string()), data: Some(json!({ "invoice": inv.id })), ..Default::default() })],
                ));
                continue;
            };
            if arrived(self, &kind) < q {
                if t - inv.at >= self.p.wait_days * DAY {
                    self.answered.insert(inv.id.to_string());
                    steps.push(because(
                        format!("An invoice whose goods haven't come in {} days: declining it.", self.p.wait_days),
                        vec![say("invoice_declined", &format!("Invoice {} declined: the goods haven't arrived.", inv.id), Say { to: Some(vec![from.to_string()]), visible: Some(Visible::Only(vec![from.to_string(), me.clone()])), basis: Some(inv.id.to_string()), data: Some(json!({ "invoice": inv.id })), ..Default::default() })],
                    ));
                }
                continue;
            }
            self.answered.insert(inv.id.to_string());
            *self.paid_for.entry(kind.clone()).or_insert(0) += q;
            // Room this month: in all, whoever the seller (the first invoices to arrive are the first paid).
            let room = offer.1 - self.bought.get(&kind).copied().unwrap_or(0);
            let take = q.min(room).max(0);
            *self.bought.entry(kind.clone()).or_insert(0) += take;
            // (At the price of the offer the goods were shipped and invoiced under, which may be last month's: an
            // invoice can come after the next offer. At this month's, a payment was not the goods' price times any number.)
            let unit = crate::common::bases_of(&inv).first().and_then(|b| self.book.get(b)).and_then(|o| data(o).i("unit_price")).filter(|u| *u > 0).unwrap_or(offer.0);
            let amount = owed.as_ref().and_then(|o| o.i("amount")).map_or(0, cents_of).min(take * unit);
            let back = q - take;
            let return_to = d.s("from_at").unwrap_or_default().to_string();
            let mut calls = vec![];
            if amount > 0 {
                calls.push(pay(&owed_to, amount, Pay { from: Some(self.p.account.clone()), for_: Some(format!("{take} {kind} bought.")), settles: Some(inv.id.to_string()), ..Default::default() }, cx));
            }
            if back > 0 && !return_to.is_empty() {
                calls.push(call("goods", vec![("kind", Some(crate::steps::arg(&kind))), ("quantity", Some(text(back.to_string()))), ("to", Some(crate::steps::arg(&from))), ("at", Some(crate::steps::arg(&return_to))), ("from_at", Some(crate::steps::arg(&me)))]));
            }
            if back > 0 {
                calls.push(say(
                    "invoice_declined",
                    &format!("Invoice {}: {back} {kind} beyond this month's demand, sent back.", inv.id),
                    Say { to: Some(vec![from.to_string()]), visible: Some(Visible::Only(vec![from.to_string(), me.clone()])), basis: Some(inv.id.to_string()), data: Some(json!({ "invoice": inv.id, "returned": back, "paid_for": take })), ..Default::default() },
                ));
            }
            let why = if take == q { format!("Goods invoiced under our offer have arrived: paying for {q} {kind}.") } else { format!("Goods invoiced beyond this month's demand: paying for {take}, sending {back} back.") };
            let mut s = because(why, calls);
            if back > 0 && !return_to.is_empty() {
                s.then = Some(Then::Paid { kind: kind.clone(), back });
            }
            steps.push(s);
        }
        steps
    }
}

fn cents_of(n: i64) -> i64 {
    cents(i128::from(n))
}

struct Trade;
pub struct WorldTrade;

fn read_params(ctx: &Ctx) -> Result<Params, String> {
    let account: String = ctx.need("account", "world.trade")?;
    Ok(Params {
        account,
        sells: ctx.param("sells", BTreeMap::new())?,
        buys: ctx.param("buys", BTreeMap::new())?,
        wait_days: ctx.param("wait_days", 14)?,
        min_order: ctx.param("min_order", 100)?,
        terms_days: ctx.param("terms_days", 0)?,
        terms_stop_after_days: ctx.param("terms_stop_after_days", 7)?,
        terms_claim_after_days: ctx.param("terms_claim_after_days", 30)?,
        price_process: ctx.param("price_process", BTreeMap::new())?,
        shocks: ctx.param("shocks", vec![])?,
    })
}

impl Kind for WorldTrade {
    fn name(&self) -> &'static str {
        "world.trade"
    }
    fn version(&self) -> &'static str {
        "0.4.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/boundary.md"
    }
    fn manifest(&self) -> Value {
        let mut m: Value = serde_json::from_str(TRADE_MANIFEST).expect("the TS manifest");
        m["version"] = json!("0.4.0");
        m
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = read_params(ctx)?;
        let sells = (p.terms_days > 0).then_some(SellingTerms { days: p.terms_days, stop_after_days: p.terms_stop_after_days, claim_after_days: p.terms_claim_after_days, });
        let me = ctx.entity.clone();
        let _ = Trade;
        Ok(Box::new(Stepper::new(Market {
            orders: OrderBook::new(&me, None, sells),
            me,
            p,
            book: Book::new(),
            published_key: String::new(),
            list_id: None,
            level: BTreeMap::new(),
            offers: BTreeMap::new(),
            month: -1,
            bought: BTreeMap::new(),
            sent: BTreeMap::new(),
            paid_for: BTreeMap::new(),
            baseline: BTreeMap::new(),
            answered: BTreeSet::new(),
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Market>::restore(saved)?))
    }
}

// ------------------------------------------------------------------ world.export_demand

/// world.export_demand: the outside world buying from the town on a researcher's schedule (D31): fixed payments into
/// accounts, every so often.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Purchase {
    to: String,
    amount: i64,
    every: i64,
    #[serde(default)]
    memo: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Schedule {
    purchases: Vec<Purchase>,
    next: Vec<i64>,
}

impl Plan for Schedule {
    type Then = ();
    fn absorb(&mut self, _: &Picture, _: &mut Cx) {}
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let Some(mine) = pic.accounts().find(|a| a.holder == pic.entity && a.custodian == pic.entity).map(|a| a.account) else { return vec![]; };
        let mut calls = vec![];
        for (i, p) in self.purchases.iter().enumerate() {
            while self.next[i] <= pic.t && calls.len() < 32 && p.every > 0 {
                calls.push(pay(&p.to, p.amount, Pay { from: Some(mine.to_string()), for_: Some(p.memo.clone().unwrap_or_else(|| "export sales".into())), ..Default::default() }, cx));
                self.next[i] += p.every;
            }
        }
        if calls.is_empty() {
            vec![]
        } else {
            vec![because("The outside world's purchases due on the researcher's schedule.", calls)]
        }
    }
}

pub struct ExportDemand;

impl Kind for ExportDemand {
    fn name(&self) -> &'static str {
        "world.export_demand"
    }
    fn version(&self) -> &'static str {
        "0.2.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/boundary.md"
    }
    fn manifest(&self) -> Value {
        serde_json::from_str(EXPORT_MANIFEST).expect("the TS manifest")
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let purchases: Vec<Purchase> = ctx.param("purchases", vec![])?;
        let next = purchases.iter().map(|p| p.every).collect();
        Ok(Box::new(Stepper::new(Schedule { purchases, next })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Schedule>::restore(saved)?))
    }
}

#[cfg(test)]
mod tests;
