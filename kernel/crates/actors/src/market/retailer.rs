//! firm.retailer: a shop, after Lengnick (2013), with wholesale buying and serving (phase B). Ported from
//! participants/src/behaviour/retailer.ts (0.15.0) and rewritten for Rust; documented in docs/behaviour/retailer.md,
//! with sources. Version 0.18.0 (the TS's: systems taken up for serving, a debt recorded against it held from the dividend,
//! a winding-up that pays its staff first); its price is formed from supply and demand, costs and the rivals it has been shown
//! (prices.rs), not held between fixed bounds of cost.
//!
//! A shop buys goods from the cheapest of its suppliers (local factories' wholesale, or the world market's imports) to
//! keep its stock within Lengnick's band of its sales, and sells them to whoever orders and pays. Selling takes its
//! staff's time: each item is a unit of the task `serve`, by the staff at the shop, each up to a working day; what they
//! cannot serve today waits for tomorrow. Monthly: its price moves, its headcount moves a worker at a time towards what
//! its sales need, and what it holds beyond its buffer, out of the month's earnings, goes to its shareholders.
//!
//! What the shop does as an employer, borrower, union party and firm that can fail is its [`Body`] (body.rs): the
//! shop is generic over it, and lane C1's real body drops in at integration. A shop just founded sets itself up first
//! (an account, the founder's capital, its premises bought from the listing), as retailer.ts did.
//!
//! Decided fresh in the port (docs/port-guide.md section 2): the draws a shop made once from its own stream
//! (`review-day`, its order of preference between suppliers at one price) are facts about the shop and are drawn from
//! its identity, not from a stream consumed in order; a month is 30 days (`MONTH`); ties between suppliers fall to the
//! supplier's id; every sum is `i64` with floor division, and a price rises by the ceiling of a step and falls by its
//! floor, as the TS did.

use super::automation::{self, params_from, system_slips, Adoption, AdoptionParams, AdoptionThen, Fleet};
use super::body::{lift, Body, BodyThen, House, PlainBody, Review, Stage, Standing, Surplus, Want, Wind};
use super::lengnick::{distribute, move_wage, pay_out, Expectation, From as Payer, Lengnick, WageMonth};
use super::prices::{move_price, rivals_seen, Level, PriceFigures, Signals, StockMeter};
use super::sourcing::{self, Candidate, SourcingFigures};
use super::trade::{self, decline, goods_prices, held, order, price_list, send_back, Deliveries, Order, OrderBook, Ordering, Payables, TradeThen, UNDELIVERABLE};
use crate::common::asking::{ask, Asked};
use crate::common::{data, money_words, out_of_time, own_account, published_price, team, withdraw, Book, Fields, Pace, DAY, MONTH};
use crate::papers::{self, market::CapitalCall};
use crate::steps::{arg, because, call, json, pay, say, text, Done, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::bargaining::Takings;
use oikos_sight::calls::Call;
use oikos_sight::{LookRequest, OutcomeStatus, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const MANIFEST: &str = include_str!("../../../../../participants/manifests/firm.retailer.json");
/// The TS module's version (firm.retailer 0.18.0), which this one does what and more (prices from supply and demand).
pub const VERSION: &str = "0.21.0";

/// FNV-1a of who and what, for a draw that is a fact about the shop (see the module's doc).
pub(crate) fn fact(who: &str, what: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in who.bytes().chain([0xff]).chain(what.bytes()) {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h ^ (h >> 29)
}

/// How a shop adjusts its staff (firms.md, "Adjusting labour"): AdjustParams.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Adjust {
    pub smooth_months: i64,
    pub hiring_cost_weeks: i64,
    #[serde(default)]
    pub hours_step_bps: Option<i64>,
}

/// A shop just founded (entry.md): who founded it, the capital, the listing it buys its premises from, its bank.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Founding {
    pub founder: Option<String>,
    pub capital: i64,
    pub listing: Option<String>,
    pub bank: String,
}

/// The shop's parameters (names unchanged from retailer.ts; defaults the TS's).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Params {
    pub premises: String,
    pub workplace: String,
    pub role: String,
    pub industry: String,
    pub max_staff: i64,
    pub min_staff: i64,
    pub kind: String,
    pub serve_task: String,
    pub serve_labour: i64,
    pub suppliers: Vec<String>,
    pub wage: i64,
    pub period: i64,
    pub notice_days: i64,
    pub working_day: i64,
    pub work_days: i64,
    pub police: String,
    pub stocktake_days: i64,
    pub look_at: i64,
    pub look_days: i64,
    pub price: i64,
    pub demand: i64,
    pub unpaid_days: i64,
    pub serve_within_days: i64,
    pub utilisation_bps: i64,
    pub adjust: Adjust,
    pub credit: bool,
    pub builder: String,
    pub premises_sale_bps: i64,
    pub shopfront: bool,
    pub trade_board: String,
    pub sale_board: String,
    pub sold_board: String,
    /// What sellers advertise to households (a shop's rivals): searched monthly for the prices a shop is compared with.
    pub rivals_board: String,
    pub search_limit: u32,
    pub operator: Option<String>,
    pub stock_days: i64,
    pub draw_days: i64,
    /// What running a business of one costs a month beside its stock (registration, a licence and the like: the
    /// profile's `business.home_fixed_per_month`), paid to `fixed_to` at each draw.
    pub fixed_per_month: i64,
    pub fixed_to: String,
    /// Where shop premises to let are listed (a business of one that outgrows its owner takes a unit: docs/behaviour/leasing.md).
    pub premises_board: String,
    /// Months running that premises we lease pay us less than trading alone before we ask to leave (a placeholder: ME-1).
    pub leave_after_months: i64,
    pub premises_cell: String,
    pub open_from: i64,
    pub open_until: i64,
    pub founding: Founding,
    /// Systems it may take up in place of some of its staff's work, and how it weighs them (the world's figures). None: it
    /// looks at none (a world with no vendor).
    #[serde(default)]
    pub automation: Option<AdoptionParams>,
    pub lengnick: Lengnick,
    pub figures: PriceFigures,
    /// How its restocking is spread across its suppliers (sourcing.rs).
    #[serde(default)]
    pub sourcing: SourcingFigures,
}

impl Params {
    pub fn read(ctx: &Ctx) -> Result<Params, String> {
        let adjust: Adjust = ctx.param("adjust", Adjust { smooth_months: 3, hiring_cost_weeks: 8, hours_step_bps: None })?;
        let p = Params {
            premises: ctx.param("premises", String::new())?,
            workplace: ctx.param("workplace", String::new())?,
            role: ctx.param("role", "shop assistant".to_string())?,
            industry: ctx.param("industry", String::new())?,
            max_staff: ctx.param("max_staff", 6)?,
            min_staff: ctx.param("min_staff", 1)?,
            kind: ctx.param("kind", "goods".to_string())?,
            serve_task: ctx.param("serve_task", "serve".to_string())?,
            serve_labour: ctx.param("serve_labour", 5400)?,
            suppliers: ctx.param("suppliers", vec![])?,
            wage: ctx.param("wage", 120_000)?,
            period: ctx.param("period", 14 * DAY)?,
            notice_days: ctx.param("notice_days", 14)?,
            working_day: ctx.param("working_day", 8 * 3600)?,
            work_days: ctx.param("work_days", 6)?,
            police: ctx.param("police", String::new())?,
            stocktake_days: ctx.param("stocktake_days", 30)?,
            look_at: ctx.param("look_at", 0)?,
            look_days: ctx.param("look_days", 5)?,
            price: ctx.param("price", 9000)?,
            demand: ctx.param("demand", 250)?,
            unpaid_days: ctx.param("unpaid_days", 7)?,
            serve_within_days: ctx.param("serve_within_days", 3)?,
            utilisation_bps: ctx.param("utilisation_bps", 8000)?,
            adjust,
            credit: ctx.param("credit", true)?,
            builder: ctx.param("builder", String::new())?,
            premises_sale_bps: ctx.param("premises_sale_bps", 5000)?,
            shopfront: ctx.param("shopfront", false)?,
            trade_board: ctx.param("trade_board", String::new())?,
            sale_board: ctx.param("sale_board", String::new())?,
            sold_board: ctx.param("sold_board", String::new())?,
            rivals_board: ctx.param("rivals_board", String::new())?,
            search_limit: ctx.param("search_limit", 20)?,
            operator: ctx.param("operator", None)?,
            stock_days: ctx.param("stock_days", 30)?,
            draw_days: ctx.param("draw_days", 0)?,
            fixed_per_month: ctx.param("fixed_per_month", 0)?,
            fixed_to: ctx.param("fixed_to", String::new())?,
            premises_board: ctx.param("premises_board", String::new())?,
            leave_after_months: ctx.param("leave_after_months", 3)?,
            premises_cell: ctx.param("premises_cell", String::new())?,
            open_from: ctx.param("open_from", 0)?,
            open_until: ctx.param("open_until", 0)?,
            founding: Founding {
                founder: ctx.param("founder", None)?,
                capital: ctx.param("capital", 0)?,
                listing: ctx.param("listing", None)?,
                bank: ctx.param("bank", String::new())?,
            },
            automation: params_from(ctx.params.get("automation").unwrap_or(&Value::Null))?,
            lengnick: Lengnick::read(ctx)?,
            figures: PriceFigures::read(ctx)?,
            sourcing: SourcingFigures::read(ctx)?,
        };
        if p.founding.founder.is_some() && p.founding.bank.is_empty() {
            return Err("firm.retailer: the world must say bank (a shop just founded opens its account here)".into());
        }
        Ok(p)
    }
    fn work_day(&self, t: i64) -> bool {
        t.div_euclid(DAY).rem_euclid(7) < self.work_days
    }
    fn hours_per_worker_month(&self) -> i64 {
        self.working_day * self.work_days * 30 / 7
    }
    /// A month's sales, as the days of them we stock and keep money for.
    fn stock_for(&self, monthly: i64) -> i64 {
        if self.stock_days == 30 {
            monthly
        } else {
            (monthly * self.stock_days + 29).div_euclid(30)
        }
    }
    fn hourly(&self, wage: i64) -> i64 {
        let secs = (self.period / DAY) * self.work_days * self.working_day / 7;
        (wage * 3600 + secs - 1).div_euclid(secs.max(1))
    }
}

/// An order being served: what was paid for, how much has been served, since when.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Queued {
    o: Order,
    served: i64,
    since: i64,
}

/// What follows from a shop's steps.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Then {
    Trade(TradeThen),
    Body(BodyThen),
    /// A system ordered (its outcome says whether the offer is still one it has an order out for).
    Adoption(AdoptionThen),
    /// A restocking order sent (its outcome names the order, or it was not made).
    Restocked { seller: String, quantity: i64, unit: i64 },
    /// Serving (part of) an order: what was sent (`q` all told, `by_system` of it by our systems), to whom, and what it took of
    /// the crew's day.
    Served { order: Order, q: i64, share: i64, crew: Vec<String>, by_system: Vec<Sys>, before: i64, finished: bool, since: i64, day: i64, t: i64 },
}

/// Units of an order a system of ours was given.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sys {
    pub id: String,
    pub offer: String,
    pub units: i64,
}

impl From<AdoptionThen> for Then {
    fn from(t: AdoptionThen) -> Then {
        Then::Adoption(t)
    }
}

impl From<TradeThen> for Then {
    fn from(t: TradeThen) -> Then {
        Then::Trade(t)
    }
}
impl From<BodyThen> for Then {
    fn from(t: BodyThen) -> Then {
        Then::Body(t)
    }
}

/// Shop premises a business of one has taken on a lease (docs/behaviour/leasing.md): the lease, the unit, where it
/// stands, and the room it has at work (its owner and those it takes on).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Lease {
    agreement: String,
    space: String,
    structure: String,
    cell: String,
    room: i64,
    rent: i64,
    /// Where we traded from before (our owner's home or pitch): where we go back to when the lease ends.
    #[serde(default)]
    from: (String, String, String),
    /// The landlord's papers about it we have dealt with (a demand for rent, a review, terms of a surrender).
    #[serde(default)]
    read: BTreeSet<String>,
    /// Rent orders to stop once their last payment before a new rent is made: (order, when).
    #[serde(default)]
    retiring: Vec<(String, i64)>,
    /// Months running in which the premises paid us less than trading alone would.
    #[serde(default)]
    losing: i64,
    /// When we asked to leave (a surrender asked for, or our notice given), and whether we must (our business is closing).
    #[serde(default)]
    leaving: Option<i64>,
    #[serde(default)]
    must_leave: bool,
}

/// A shop just founded, setting up.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Setup {
    account_asked: bool,
    capital_called: bool,
    founder_account: Option<String>,
    registered: bool,
    purchased: bool,
    ready: bool,
    asked: i64,
    listings: Option<Vec<String>>,
    sold: Option<Vec<String>>,
    gone_since: Option<i64>,
}

/// A business of one: where it trades from now (its owner tells it when they move home), whether it has anywhere to,
/// and whether its owner has gone from the town (it then closes: what it holds is its owner's).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct At {
    premises: String,
    workplace: String,
    cell: String,
    nowhere: bool,
    read: usize,
    gone: bool,
    closed: bool,
    given_up: bool,
}

/// The stocktake's books (crime.md): what was counted, what came, what went.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Books {
    last: Option<i64>,
    r#in: i64,
    out: i64,
    next: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(bound = "B: Body")]
pub struct Shop<B: Body> {
    me: String,
    p: Params,
    book: Book,
    body: B,
    expectation: Expectation,
    orders: OrderBook,
    payables: Payables,
    deliveries: Deliveries,
    asked: Asked,
    /// Goods ordered from suppliers, not yet delivered.
    on_order: i64,
    /// Our order -> (seller, quantity).
    ours: BTreeMap<String, (String, i64)>,
    /// What we have learned of each supplier's deliveries (sourcing.rs).
    #[serde(default)]
    sources: sourcing::Record,
    /// Our stock, a reading a day, over the month (what the price rule reads: prices.rs, `StockMeter`).
    #[serde(default)]
    stock_meter: StockMeter,
    suppliers: BTreeSet<String>,
    next_trade_look: i64,
    next_rival_look: i64,
    /// The premises we lease, once taken; the listing we have applied for, and when; when we next look at what is to let.
    #[serde(default)]
    lease: Option<Lease>,
    #[serde(default)]
    premises_applied: Option<(String, i64)>,
    #[serde(default)]
    next_premises_look: i64,
    unit_cost: i64,
    /// Worker -> seconds worked today.
    used: BTreeMap<String, i64>,
    used_day: i64,
    pace: Pace,
    wage: i64,
    price: i64,
    published_price: i64,
    price_why: String,
    review_day: i64,
    month: Option<i64>,
    opened_at: i64,
    reviewed: bool,
    /// This month: items customers ordered and paid for (served or not).
    sold: i64,
    /// This month: items we could not serve (out of stock or out of hands, or a customer's order we refunded for it).
    turned_away: i64,
    /// Goods in orders sent to be served whose work has not taken effect yet.
    reserved: i64,
    queue: Vec<Queued>,
    last_demand: i64,
    last_turned_away: i64,
    full_months: i64,
    headcount: i64,
    headcount_why: String,
    month_start: i64,
    next_restock: i64,
    next_draw: i64,
    at: At,
    books: Books,
    setup: Setup,
    cash_layoff: bool,
    /// What customers have paid us: what a day without our work costs in sales (the employer's side of bargaining).
    takings: Takings,
    /// The systems delivered to us and their licences, and how we weigh the offers (the vendor's: automation.rs).
    fleet: Fleet,
    adoption: Adoption,
    /// Order -> the items a system of ours got wrong, to be refunded.
    faulty: BTreeMap<String, BTreeSet<String>>,
    /// System -> seconds of today it has been given.
    sys_used: BTreeMap<String, i64>,
    /// The units of customers' orders the systems are owed, as the share of them they can do (in ten-thousandths of a unit).
    sys_credit: i64,
    /// Our account now (for a step's outcome to refund from).
    account_now: Option<String>,
    /// Order -> what its customer paid over our price for what it buys (refunded with its note).
    #[serde(default)]
    over_paid: BTreeMap<String, i64>,
}

impl<B: Body> Shop<B> {
    pub fn new(ctx: &Ctx, p: Params, body: B) -> Shop<B> {
        let me = ctx.entity.clone();
        let ready = p.founding.founder.is_none();
        Shop {
            expectation: Expectation::new(p.adjust.smooth_months, Some(p.demand)),
            orders: OrderBook::new(&me, Some(p.unpaid_days), None),
            payables: Payables::new(&me),
            deliveries: Deliveries::default(),
            asked: Asked::default(),
            on_order: 0,
            ours: BTreeMap::new(),
            sources: sourcing::Record::default(),
            stock_meter: StockMeter::default(),
            suppliers: p.suppliers.iter().cloned().collect(),
            next_trade_look: 0,
            next_rival_look: 0,
            lease: None,
            premises_applied: None,
            next_premises_look: 0,
            unit_cost: 0,
            used: BTreeMap::new(),
            used_day: -1,
            pace: Pace::new(p.serve_labour),
            wage: p.wage,
            price: p.price,
            published_price: -1,
            price_why: String::new(),
            review_day: (fact(&me, "review-day") % (30 * 24)) as i64 * 3600,
            month: None,
            opened_at: -1,
            reviewed: false,
            sold: 0,
            turned_away: 0,
            reserved: 0,
            queue: vec![],
            last_demand: p.demand,
            last_turned_away: 0,
            full_months: 0,
            headcount: -1,
            headcount_why: String::new(),
            month_start: -1,
            next_restock: 0,
            next_draw: -1,
            at: At { premises: p.premises.clone(), workplace: p.workplace.clone(), cell: p.premises_cell.clone(), ..Default::default() },
            books: Books::default(),
            setup: Setup { ready, asked: -1, ..Default::default() },
            cash_layoff: false,
            takings: Takings::default(),
            fleet: Fleet::new(&me),
            adoption: Adoption::new(&me, p.automation.clone().unwrap_or_default()),
            faulty: BTreeMap::new(),
            sys_used: BTreeMap::new(),
            sys_credit: 0,
            account_now: None,
            over_paid: BTreeMap::new(),
            body,
            book: Book::new(),
            p,
            me,
        }
    }

    /// What our systems do of `units` a month: the share they can do, as far as their month's seconds go.
    fn system_units(&self, units: i64) -> i64 {
        if self.p.automation.is_some() {
            self.fleet.units_of(&self.p.serve_task, units, self.p.utilisation_bps)
        } else {
            0
        }
    }

    /// The monthly fees of the licences we hold for serving.
    fn fleet_fees(&self) -> i64 {
        self.fleet.fees(&self.p.serve_task)
    }

    /// Between suppliers at one price, a shop has its own order of preference (its own, a fact about whom it happens to
    /// deal with). By name, every shop in a town ordered from the same factory, which could fill a few of the orders
    /// while the others' goods stood unsold.
    fn standing_of(&self, seller: &str) -> u64 {
        fact(&self.me, &format!("supplier-{seller}")) % 1_000_000_000
    }

    fn premises_of(&self, pic: &Picture) -> Option<(String, String, String)> {
        sites(pic).find_map(|c| c.structure.as_ref().filter(|s| s.structure == self.at.premises).map(|s| (s.structure.clone(), s.structure_type.clone(), c.cell.clone())))
    }

    /// Room in our workplace: its capacity less our staff, or the bodies in it now if more.
    fn room_at_work(&self, pic: &Picture, staff: i64) -> i64 {
        // (Premises we lease: their room, less the owner and those we have.)
        if let (Some(l), Some(_)) = (&self.lease, &self.p.operator) {
            return (l.room - 1 - staff).max(0);
        }
        let sp = sites(pic).find(|c| c.structure.as_ref().is_some_and(|s| s.structure == self.p.premises)).and_then(|c| c.structure.as_ref().and_then(|s| s.spaces.iter().find(|x| x.kind == "workplace").cloned()));
        match sp {
            Some(sp) => i64::from(sp.capacity) - i64::from(sp.count).max(staff),
            None => self.p.max_staff,
        }
    }

    /// Who is in the workplace now (those in its `workplace` spaces, by name).
    fn present(&self, pic: &Picture, t: i64, workers: &[String]) -> Vec<String> {
        let tod = t.rem_euclid(DAY);
        if let Some(op) = &self.p.operator {
            // (In premises we lease, we are there, and see who is: our owner and those we have taken on, as they come
            // to work. Until we see the unit, none: nothing is served there that the kernel would refuse for nobody
            // being there. docs/behaviour/leasing.md, "Who is at the unit".)
            // (A world that shows it no such ground: as before, its owner in its hours.)
            if let Some(l) = self.lease.as_ref().filter(|l| sites(pic).any(|c| c.structure.as_ref().is_some_and(|s| s.structure == l.structure))) {
                let ours: BTreeSet<&String> = workers.iter().chain(std::iter::once(op)).collect();
                let mut here: BTreeSet<String> = BTreeSet::new();
                for c in sites(pic).filter(|c| c.structure.as_ref().is_some_and(|s| s.structure == l.structure)) {
                    for sp in c.structure.iter().flat_map(|s| s.spaces.iter()).filter(|sp| sp.kind == "workplace") {
                        here.extend(sp.occupants.iter().flatten().filter(|o| ours.contains(o)).cloned());
                    }
                }
                return here.into_iter().collect();
            }
            let open = self.p.open_until == 0 || (self.p.work_day(t) && tod >= self.p.open_from && tod < self.p.open_until);
            let mut here = if open { vec![op.clone()] } else { vec![] };
            if open && self.lease.is_some() {
                here.extend(workers.iter().filter(|w| *w != op).cloned());
            }
            return here;
        }
        if self.p.open_until > 0 && !(self.p.work_day(t) && tod >= self.p.open_from && tod < self.p.open_until) {
            return vec![];
        }
        let mine: BTreeSet<&String> = workers.iter().collect();
        let mut here: BTreeSet<String> = BTreeSet::new();
        for c in sites(pic).filter(|c| c.structure.as_ref().is_some_and(|s| s.structure == self.p.premises)) {
            for sp in c.structure.iter().flat_map(|s| s.spaces.iter()).filter(|sp| sp.kind == "workplace") {
                for o in sp.occupants.iter().flatten() {
                    if mine.contains(o) {
                        here.insert(o.clone());
                    }
                }
            }
        }
        here.into_iter().collect()
    }

    /// Whether premises to let would pay us better than trading alone (docs/behaviour/leasing.md): the custom we had and
    /// turned away last month, served by as many hands as it needs within a unit's room, each paid the going wage, less
    /// the unit's rent and our running costs, against what the owner alone serves. The best that beats it, and that we
    /// have the deposit, a month's rent and a month's wages for, is applied for.
    fn apply_for_premises(&mut self, t: i64, balance: i64, account: &str, money: &dyn Fn(i64) -> String) -> Option<Step<Then>> {
        let wanted = self.last_demand + self.last_turned_away;
        let hpwm = self.p.hours_per_worker_month();
        let serve = self.p.serve_labour.max(1);
        let per_worker = (hpwm * self.p.utilisation_bps / 10_000 / serve).max(1);
        let alone = (hpwm / serve).max(1);
        let margin = (self.price - self.unit_cost).max(0);
        let wage_m = self.wage * MONTH / self.p.period.max(1);
        let now = wanted.min(alone) * margin - self.p.fixed_per_month;
        let mut best: Option<(i64, std::sync::Arc<oikos_sight::Record>, i64, i64)> = None;
        for l in self.book.open("premises_listing") {
            let d = data(l);
            let (rent, room, deposit) = (d.i("rent").unwrap_or(0), d.i("room").unwrap_or(0), d.i("deposit").unwrap_or(0));
            if room < 1 || rent <= 0 {
                continue;
            }
            let (with, hands) = premises_pay(wanted, per_worker, margin, wage_m, rent + self.p.fixed_per_month, room);
            if with > now && balance >= deposit + rent + (hands - 1) * wage_m && best.as_ref().is_none_or(|b| with > b.0) {
                best = Some((with, l.clone(), hands, deposit));
            }
        }
        let (with, l, hands, deposit) = best?;
        let landlord = l.speaks_for.clone()?;
        let me = self.me.clone();
        self.premises_applied = Some((l.id.clone(), t));
        let space = data(&l).s("space").unwrap_or_default().to_string();
        Some(because(
            format!(
                "We turned {} customers' items away last month: premises {space} at {} a month, with {} hand(s) beside our owner, would leave us {} a month against {} alone. Applying to lease it (a deposit of {}).",
                self.last_turned_away,
                money(data(&l).i("rent").unwrap_or(0)),
                hands - 1,
                money(with),
                money(now),
                money(deposit)
            ),
            vec![say(
                "rental_application",
                &format!("Application to lease the premises {space}."),
                Say { to: Some(vec![landlord.clone()]), visible: Some(Visible::Only(vec![me.clone(), landlord])), basis: Some(l.id.clone()), data: Some(json!({ "listing": l.id, "account": account, "premises": true })), ..Default::default() },
            )],
        ))
    }

    /// The lease offered for premises we applied for: signed, the deposit paid as we sign, the rent by standing order,
    /// our stock taken there, and our owner told we trade from there now (docs/behaviour/leasing.md). An application with
    /// no offer in a month is let go.
    fn take_premises(&mut self, t: i64, account: &str, stock: i64, cx: &Cx) -> Vec<Step<Then>> {
        let Some((listing, at)) = self.premises_applied.clone() else { return vec![] };
        let me = self.me.clone();
        let Some(l) = self.book.get(&listing).cloned() else {
            self.premises_applied = None;
            return vec![];
        };
        let landlord = l.speaks_for.clone().unwrap_or_default();
        let offered = self
            .book
            .of_type("agreement")
            .filter(|a| a.at >= at && !self.book.signed_by(&a.id, &me) && !self.book.concluded(&a.id) && matches!(&a.body, oikos_sight::RecordBody::Agreement { terms } if terms.template.as_deref() == Some("lease") && terms.parties.first() == Some(&landlord) && terms.parties.contains(&me)))
            .last()
            .cloned();
        let Some(a) = offered else {
            if t - at > 30 * DAY {
                self.premises_applied = None;
            }
            return vec![];
        };
        let d = data(&l);
        let (space, structure, cell) = (d.s("space").unwrap_or_default().to_string(), d.s("structure").unwrap_or_default().to_string(), d.s("cell").unwrap_or_default().to_string());
        let room = d.i("room").unwrap_or(1);
        let deposit = d.i("deposit").unwrap_or(0);
        let lt = crate::papers::agreements::lease_terms(&a, &me);
        let Some(rent_to) = lt.rent_to.clone() else { return vec![] };
        let mut calls = vec![crate::papers::agreements::sign(&a.id)];
        if deposit > 0 {
            calls.push(pay(&rent_to, deposit, Pay { from: Some(account.to_string()), basis: Some(a.id.clone()), for_: Some(format!("Security deposit under lease {}.", a.id)), ..Default::default() }, cx));
        }
        calls.push(pay(&rent_to, lt.rent, Pay { from: Some(account.to_string()), every: Some(MONTH), first: Some(0), basis: Some(a.id.clone()), for_: Some(format!("Rent for {space}, monthly in advance.")), ..Default::default() }, cx));
        if stock > 0 && structure != self.at.premises {
            calls.push(call("goods", vec![("kind", Some(arg(&self.p.kind))), ("quantity", Some(text(stock.to_string()))), ("to", Some(arg(&me))), ("at", Some(arg(&structure))), ("from_at", Some(arg(&self.at.premises)))]));
        }
        // (Until when it binds us: its term, from now, as its terms say.)
        let term = match &a.body {
            oikos_sight::RecordBody::Agreement { terms } => terms.term,
            _ => None,
        };
        if let Some(op) = self.p.operator.clone() {
            calls.push(say(
                "trading_at",
                &format!("We trade from {space} now, on a lease: work there."),
                Say { to: Some(vec![op.clone()]), visible: Some(Visible::Only(vec![me.clone(), op])), basis: Some(a.id.clone()), data: Some(json!({ "space": space, "structure": structure, "cell": cell, "rent": lt.rent, "until": self.book.ends_at(&a.id).unwrap_or(t + term.unwrap_or(60 * MONTH)) })), ..Default::default() },
            ));
        }
        let from = (self.at.premises.clone(), self.at.workplace.clone(), self.at.cell.clone());
        self.lease = Some(Lease { agreement: a.id.clone(), space: space.clone(), structure: structure.clone(), cell: cell.clone(), room, rent: lt.rent, from, ..Default::default() });
        self.premises_applied = None;
        self.at.premises = structure;
        self.at.workplace = space.clone();
        if !cell.is_empty() {
            self.at.cell = cell;
        }
        self.at.nowhere = false;
        self.published_price = -1;
        self.body.set_workplace(&space);
        vec![because(format!("{landlord} offers us a lease of {space} at {} a month: signing it, paying the deposit and the rent, and moving our stock there.", money_words(lt.rent, &cx.ctx.world)), calls)]
    }

    /// Our rent orders under a lease: the standing requests of ours that cite it and still stand.
    fn rent_orders(&self, lease: &str) -> Vec<String> {
        let me = self.me.as_str();
        self.book
            .all("request")
            .filter(|r| r.speaks_for.as_deref() == Some(me) && crate::common::cites(r, lease) && data(r).get("every").is_some() && !self.book.withdrawn(&r.id))
            .map(|r| r.id.clone())
            .collect()
    }

    /// Whether a lease of ours lets us end it by our own notice (the law gives the tenant a clause), and on what notice.
    fn our_notice(&self, lease: &str) -> Option<i64> {
        let a = self.book.get(lease)?;
        match &a.body {
            oikos_sight::RecordBody::Agreement { terms } => terms.termination.as_ref()?.iter().find(|c| c.party == self.me).map(|c| c.notice),
            _ => None,
        }
    }

    /// Asking to leave the premises we lease (docs/behaviour/leasing.md, "Leaving early"): by our own notice where the
    /// lease gives us one, else by asking the landlord to accept a surrender.
    fn ask_to_leave(&mut self, t: i64, why: &str) -> Option<Step<Then>> {
        let l = self.lease.as_mut()?;
        if l.leaving.is_some() {
            return None;
        }
        l.leaving = Some(t);
        let (agreement, space) = (l.agreement.clone(), l.space.clone());
        let landlord = self.book.get(&agreement).and_then(|a| crate::papers::agreements::other_party(a, &self.me).map(String::from)).unwrap_or_default();
        if let Some(n) = self.our_notice(&agreement) {
            return Some(because(
                format!("{why}: giving notice under our lease of {space}, which ends it in {} days.", n.div_euclid(DAY)),
                vec![crate::papers::agreements::notice(&agreement, "Notice: we end the lease, as its terms let us.")],
            ));
        }
        let me = self.me.clone();
        Some(because(
            format!("{why}: our lease of {space} gives us no notice of our own, so we ask {landlord} to accept its surrender."),
            vec![say(
                "surrender_request",
                &format!("Request: we ask you to accept the surrender of our lease {agreement} of {space}."),
                Say { to: Some(vec![landlord.clone()]), visible: Some(Visible::Only(vec![me, landlord])), basis: Some(agreement.clone()), data: Some(json!({ "lease": agreement })), ..Default::default() },
            )],
        ))
    }

    /// The affairs of the premises we lease, at each wake (docs/behaviour/leasing.md, "Remedies", "Rent reviews",
    /// "Leaving early"): the landlord's papers (a demand for rent owed, paid if we hold it; a rent review, our order
    /// changed to the new rent from its day; the terms of a surrender we asked for, paid if leaving is worth it), and the
    /// lease's end, however it came (its term, our notice, a surrender, or the landlord's ending it for rent owed): our
    /// rent orders stopped, our stock taken back where we traded before, and our owner told.
    fn lease_affairs(&mut self, t: i64, acct: &crate::common::OwnAccount, stock: i64, cx: &Cx, money: &dyn Fn(i64) -> String) -> Vec<Step<Then>> {
        let Some(l) = self.lease.clone() else { return vec![] };
        let me = self.me.clone();
        let mut steps = vec![];
        // Rent orders whose last payment before a new rent has been made.
        let (due, keep): (Vec<(String, i64)>, Vec<(String, i64)>) = l.retiring.iter().cloned().partition(|(_, at)| t >= *at);
        if !due.is_empty() {
            steps.push(because("The old rent's last payment is made: stopping its order; the new one takes over.", due.iter().map(|(o, _)| withdraw(o, Some("Replaced by a new standing order."))).collect()));
            if let Some(x) = self.lease.as_mut() {
                x.retiring = keep;
            }
        }
        // ---- the lease has ended ----
        if self.book.concluded(&l.agreement) && !self.book.in_force(&l.agreement) {
            let orders = self.rent_orders(&l.agreement);
            let mut calls: Vec<Call> = orders.iter().map(|o| withdraw(o, Some("Lease ended; stop this standing order."))).collect();
            let (back, back_space, back_cell) = l.from.clone();
            if stock > 0 && !back.is_empty() && back != l.structure {
                calls.push(call("goods", vec![("kind", Some(arg(&self.p.kind))), ("quantity", Some(text(stock.to_string()))), ("to", Some(arg(&me))), ("at", Some(arg(&back))), ("from_at", Some(arg(&l.structure)))]));
            }
            if let Some(op) = self.p.operator.clone() {
                calls.push(say(
                    "trading_at",
                    &format!("Our lease of {} has ended: we trade from where we did before, and you work from there.", l.space),
                    Say { to: Some(vec![op.clone()]), visible: Some(Visible::Only(vec![me.clone(), op])), basis: Some(l.agreement.clone()), data: Some(json!({ "space": back_space, "structure": back, "cell": back_cell, "back": true })), ..Default::default() },
                ));
            }
            steps.push(because(format!("Our lease of {} has ended: stopping its rent, and taking our stock back to {}.", l.space, if back_space.is_empty() { "our owner" } else { back_space.as_str() }), calls));
            self.lease = None;
            if !back.is_empty() {
                self.at.premises = back;
                self.at.workplace = back_space.clone();
                self.at.cell = back_cell;
                self.body.set_workplace(&back_space);
            }
            self.published_price = -1;
            return steps;
        }
        // ---- the landlord's papers ----
        let landlord = self.book.get(&l.agreement).and_then(|a| crate::papers::agreements::other_party(a, &me).map(String::from)).unwrap_or_default();
        let papers: Vec<(&str, std::sync::Arc<oikos_sight::Record>)> = ["review_request", "rent_review", "surrender_terms"]
            .iter()
            .flat_map(|k| self.book.open(k).map(|r| (*k, r.clone())).collect::<Vec<_>>())
            .filter(|(_, r)| r.speaks_for.as_deref() == Some(landlord.as_str()) && crate::common::addressed_to(r).contains(&me) && !l.read.contains(&r.id))
            .filter(|(_, r)| data(r).s("lease").or_else(|| data(r).s("about")) == Some(l.agreement.as_str()))
            .collect();
        let mut balance = acct.balance;
        for (kind, r) in papers {
            if let Some(x) = self.lease.as_mut() {
                x.read.insert(r.id.clone());
            }
            let d = data(&r);
            let to = d.s("account").unwrap_or_default().to_string();
            match kind {
                // A demand for rent owed: paid, if we hold it.
                "review_request" => {
                    let owed = d.i("amount").unwrap_or(0);
                    if owed > 0 && balance >= owed && !to.is_empty() {
                        balance -= owed;
                        steps.push(because(
                            format!("{landlord} asks for {} of rent owed under our lease: paying it.", money(owed)),
                            vec![pay(&to, owed, Pay { from: Some(acct.account.clone()), basis: Some(l.agreement.clone()), for_: Some("Rent owed.".into()), ..Default::default() }, cx)],
                        ));
                    }
                }
                // A rent review: the new rent paid on the old one's days from when it starts; the old order stopped once its last payment is made.
                "rent_review" => {
                    let (rent, from) = (d.i("rent").unwrap_or(0), d.i("from").unwrap_or(t));
                    let Some(rent_to) = self.book.get(&l.agreement).and_then(|a| crate::papers::agreements::lease_terms(a, &me).rent_to) else { continue };
                    if rent <= 0 {
                        continue;
                    }
                    let old = self.rent_orders(&l.agreement);
                    let stop_at = (from - DAY).max(t);
                    if let Some(x) = self.lease.as_mut() {
                        x.rent = rent;
                        x.retiring.extend(old.into_iter().map(|o| (o, stop_at)));
                    }
                    steps.push(because(
                        format!("{landlord} reviews our rent to {} a month from {}: paying it from then.", money(rent), crate::common::when_words(from, &cx.ctx.world)),
                        vec![pay(&rent_to, rent, Pay { from: Some(acct.account.clone()), every: Some(MONTH), first: Some((from - t).max(0)), basis: Some(l.agreement.clone()), for_: Some(format!("Rent for {}, monthly in advance.", l.space)), ..Default::default() }, cx)],
                    ));
                }
                // The terms of a surrender we asked for: paid, if we must leave, or if leaving costs less than staying would.
                "surrender_terms" => {
                    let price = d.i("price").unwrap_or(0);
                    let months_left = self.book.ends_at(&l.agreement).map_or(0, |e| (e - t).div_euclid(MONTH));
                    let worth = l.must_leave || price <= self.lease_loss() * months_left;
                    if l.leaving.is_some() && worth && balance >= price && !to.is_empty() {
                        balance -= price;
                        steps.push(because(
                            format!("{landlord} will accept our surrender for {}: paying it.", money(price)),
                            vec![pay(&to, price, Pay { from: Some(acct.account.clone()), basis: Some(l.agreement.clone()), for_: Some("The price of the surrender agreed.".into()), ..Default::default() }, cx)],
                        ));
                    } else if let Some(x) = self.lease.as_mut().filter(|x| !x.must_leave) {
                        // (Not worth it, or not in hand: we stay, and may ask again. One that must leave and cannot pay
                        // closes when its month of asking is up: the lease runs on.)
                        x.leaving = None;
                        x.losing = 0;
                    }
                }
                _ => {}
            }
        }
        steps
    }

    /// What staying in the premises we lease loses us a month against trading alone, by last month's custom (nought:
    /// they pay).
    fn lease_loss(&self) -> i64 {
        let Some(l) = &self.lease else { return 0 };
        let (with, alone) = self.premises_weighing(l.rent, l.room);
        (alone - with).max(0)
    }

    /// What premises at `rent` with `room` would leave us a month, against what our owner alone serves, by last month's
    /// custom (docs/behaviour/leasing.md): (with, alone).
    fn premises_weighing(&self, rent: i64, room: i64) -> (i64, i64) {
        let wanted = self.last_demand + self.last_turned_away;
        let hpwm = self.p.hours_per_worker_month();
        let serve = self.p.serve_labour.max(1);
        let per_worker = (hpwm * self.p.utilisation_bps / 10_000 / serve).max(1);
        let alone = (hpwm / serve).max(1);
        let margin = (self.price - self.unit_cost).max(0);
        let wage_m = self.wage * MONTH / self.p.period.max(1);
        let now = wanted.min(alone) * margin - self.p.fixed_per_month;
        let (with, _) = premises_pay(wanted, per_worker, margin, wage_m, rent + self.p.fixed_per_month, room);
        (with, now)
    }

    fn found(&self, pic: &Picture, channel: &str) -> Option<Vec<String>> {
        if channel.is_empty() {
            return None;
        }
        match pic.channels.get(channel) {
            Some(Seen::Records { records, search: true }) => Some(records.iter().map(|r| r.id.clone()).collect()),
            _ => None,
        }
    }

    /// Setting up a shop just founded: an account at the bank; the founder's capital; our shareholders (the founder);
    /// the premises bought from the property listing. If someone else buys them first, the capital goes back and we close.
    fn setting_up(&mut self, pic: &Picture, acct: Option<&crate::common::OwnAccount>, cx: &Cx) -> Vec<Step<Then>> {
        let money = |n| money_words(n, &cx.ctx.world);
        let me = self.me.clone();
        let founder = self.p.founding.founder.clone().unwrap_or_default();
        let Some(acc) = acct else {
            if self.setup.account_asked {
                return vec![];
            }
            self.setup.account_asked = true;
            return vec![because(
                "A new shop: opening our account at the bank.",
                vec![call("account", vec![("holder", Some(arg(&me))), ("at", Some(arg(&self.p.founding.bank)))])],
            )];
        };
        if !self.setup.capital_called {
            self.setup.capital_called = true;
            let cap = self.p.founding.capital;
            return vec![because(
                format!("A new shop: asking our founder for the {} of capital they're putting in.", money(cap)),
                vec![say(
                    "capital_call",
                    &format!("Please pay the {} of capital into {}.", money(cap), acc.account),
                    Say {
                        to: Some(vec![founder.clone()]),
                        visible: Some(Visible::Only(vec![me.clone(), founder.clone()])),
                        data: Some(papers::data(&CapitalCall { account: acc.account.clone(), amount: cap })),
                        ..Default::default()
                    },
                )],
            )];
        }
        let mut steps: Vec<Step<Then>> = vec![];
        if self.setup.founder_account.is_some() && !self.setup.registered {
            self.setup.registered = true;
            steps.push(because(
                "Our shareholders: our founder, who put in the capital.",
                vec![say(
                    "shareholders",
                    &format!("The shareholders of {me}, and their shares."),
                    Say {
                        to: Some(vec![founder.clone()]),
                        visible: Some(Visible::Only(vec![me.clone(), founder.clone()])),
                        data: Some(json!({ "holders": [{ "holder": founder, "account": self.setup.founder_account, "shares": 10_000 }] })),
                        ..Default::default()
                    },
                )],
            ));
        }
        // (A business of one, founded to trade from its owner's home: no premises to buy. Once the capital is in, it trades.)
        if self.p.operator.is_some() && self.p.founding.listing.is_none() {
            if self.setup.founder_account.is_some() {
                self.setup.ready = true;
            }
            return if self.setup.ready { [steps, vec![because("Our owner's capital is in: opening for trade, from their home.", vec![])]].concat() } else { steps };
        }
        let looked = !self.p.sale_board.is_empty();
        if looked && self.setup.listings.is_none() {
            return steps;
        }
        let first = self.p.founding.listing.as_deref().and_then(|l| self.book.get(l)).cloned();
        let structure: Option<String> = if looked {
            Some(self.p.premises.clone())
        } else {
            first.as_ref().and_then(|f| data(f).s("structure").map(str::to_string))
        };
        let standing: Vec<std::sync::Arc<oikos_sight::Record>> = if looked {
            self.setup.listings.iter().flatten().filter_map(|id| self.book.get(id).cloned()).collect()
        } else {
            self.book.open("property_for_sale").cloned().collect()
        };
        let mut relisted: Vec<_> = standing.into_iter().filter(|r| data(r).s("structure") == structure.as_deref()).collect();
        relisted.sort_by(|a, b| b.at.cmp(&a.at));
        let listing = relisted.first().cloned().or(if looked { None } else { first.clone() });
        let sold_rec = {
            let pool: Vec<std::sync::Arc<oikos_sight::Record>> = if looked {
                self.setup.sold.iter().flatten().filter_map(|id| self.book.get(id).cloned()).collect()
            } else {
                self.book.all("property_sold").cloned().collect()
            };
            pool.into_iter().find(|r| structure.is_some() && data(r).s("structure") == structure.as_deref())
        };
        if looked && sold_rec.is_none() {
            if listing.is_some() {
                self.setup.gone_since = None;
            } else if *self.setup.gone_since.get_or_insert(pic.t) > pic.t - DAY {
                return steps;
            }
        }
        if let Some(s) = sold_rec.as_ref().filter(|s| data(s).s("buyer") == Some(me.as_str())) {
            self.setup.ready = true;
            steps.push(because(format!("Our premises ({}) are ours: opening for trade.", data(s).s("structure").unwrap_or_default()), vec![]));
            return steps;
        }
        let taken_by_other = sold_rec.is_some()
            || if looked { listing.is_none() } else { listing.as_ref().is_some_and(|l| self.book.withdrawn(&l.id)) };
        if taken_by_other {
            // Someone else bought them: the capital goes back, and we close.
            let mut calls = vec![];
            if let (Some(fa), true) = (&self.setup.founder_account, acc.balance > 0) {
                calls.push(pay(fa, acc.balance, Pay { from: Some(acc.account.clone()), for_: Some("Capital returned: the venture didn't go ahead.".into()), ..Default::default() }, cx));
            }
            calls.push(say(
                "closure",
                &format!("{me} didn't open: its premises were sold to someone else."),
                Say { visible: Some(Visible::Public), data: Some(json!({ "firm": me, "to_creditors": 0, "to_shareholders": acc.balance })), ..Default::default() },
            ));
            steps.push(because("The premises we meant to buy were sold to someone else: returning the capital, and closing.", calls));
            self.setup.ready = true; // (the shop never trades: the body, told it is closed, does nothing more)
            self.setup.purchased = true;
            self.body.close();
            return steps;
        }
        if let Some(l) = &listing {
            let d = data(l);
            if let (Some(price), false) = (d.i("price"), self.setup.purchased) {
                if acc.balance >= price {
                    self.setup.purchased = true;
                    let structure = d.s("structure").unwrap_or_default().to_string();
                    steps.push(because(
                        format!("Buying our premises ({structure}) at the {} asked: publishing our purchase, and paying with it.", money(price)),
                        vec![
                            say(
                                "property_purchase",
                                &format!("Purchase of {structure}, as listed."),
                                Say {
                                    to: l.speaks_for.clone().map(|s| vec![s]),
                                    visible: l.speaks_for.clone().map(|s| Visible::Only(vec![me.clone(), s])),
                                    basis: Some(l.id.clone()),
                                    data: Some(json!({ "listing": l.id, "account": acc.account })),
                                    ..Default::default()
                                },
                            ),
                            pay(d.s("account").unwrap_or_default(), price, Pay { from: Some(acc.account.clone()), for_: Some(format!("Premises: {structure}.")), ..Default::default() }, cx),
                        ],
                    ));
                }
            }
        }
        steps
    }
}

/// The cells of the surroundings a shop's site channel shows.
fn sites(pic: &Picture) -> impl Iterator<Item = &oikos_sight::SiteCell> {
    pic.channels.values().flat_map(|c| match c {
        Seen::Sites { cells, .. } => cells.iter(),
        _ => [].iter(),
    })
}

impl<B: Body> Plan for Shop<B> {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, cx: &mut Cx) {
        self.book.absorb(pic);
        self.body.absorb(pic, &self.book, cx);
        if self.p.automation.is_some() {
            self.fleet.absorb(&self.book);
            self.adoption.delivered(&self.fleet);
        }
        let acct = own_account(pic);
        let account = acct.as_ref().map(|a| a.account.as_str());
        // What our looks found: producers advertising to the trade; our premises' listings and sale.
        if let Some(ids) = self.found(pic, &self.p.trade_board) {
            for id in ids {
                if let Some(s) = self.book.get(&id).and_then(|r| r.speaks_for.clone()).filter(|s| *s != self.me) {
                    self.suppliers.insert(s);
                }
            }
        }
        if self.setup.asked == pic.t {
            if let Some(l) = self.found(pic, &self.p.sale_board) {
                self.setup.listings = Some(l);
            }
            if let Some(l) = self.found(pic, &self.p.sold_board) {
                self.setup.sold = Some(l);
            }
        }
        // Setting up: the founder's capital, as it arrives (the account it comes from is theirs).
        if !self.setup.ready && self.setup.capital_called && self.setup.founder_account.is_none() {
            if let Some(mine) = account {
                for tx in pic.transactions() {
                    if tx.to == mine && tx.from != mine {
                        self.setup.founder_account = Some(tx.from.clone());
                        break;
                    }
                }
            }
        }
        self.orders.take(pic, account);
        self.payables.take(&self.book);
        for d in self.deliveries.take(&self.book, &self.me) {
            let Some((seller, quantity)) = self.ours.remove(&d.order) else { continue };
            self.on_order = (self.on_order - quantity).max(0);
            self.sources.delivered(&self.p.sourcing, &seller, quantity, d.delivered);
            self.books.r#in += d.delivered;
        }
    }

    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        let mut looks = vec![];
        if !self.p.trade_board.is_empty() && self.setup.ready && pic.t >= self.next_trade_look {
            self.next_trade_look = pic.t + 7 * DAY;
            looks.push(ask::board(&self.p.trade_board, self.p.search_limit, vec![cond("data.min_order", ">", json!(1))], None));
        }
        if !self.p.rivals_board.is_empty() && self.setup.ready && pic.t >= self.next_rival_look {
            self.next_rival_look = pic.t + 30 * DAY;
            looks.push(ask::board(&self.p.rivals_board, self.p.search_limit, vec![cond("kind", "=", json!("price_list"))], None));
        }
        // (A business of one that turned customers away last month: what premises are to let, cheapest first.)
        if self.p.operator.is_some() && !self.p.premises_board.is_empty() && self.lease.is_none() && self.last_turned_away > 0 && pic.t >= self.next_premises_look {
            self.next_premises_look = pic.t + 30 * DAY;
            looks.push(ask::board(&self.p.premises_board, self.p.search_limit, vec![], Some(("data.rent", false))));
        }
        if !self.p.sale_board.is_empty() && !self.setup.ready && self.setup.capital_called && self.setup.asked != pic.t {
            self.setup.asked = pic.t;
            looks.push(ask::about(&self.p.sale_board, "data.structure", self.p.premises.clone(), ask::About { most: self.p.search_limit, standing: true, ..Default::default() }));
            if !self.p.sold_board.is_empty() {
                looks.push(ask::about(&self.p.sold_board, "data.structure", self.p.premises.clone(), ask::About { most: 1, newest: true, ..Default::default() }));
            }
        }
        looks
    }

    fn until(&self, pic: &Picture) -> Option<i64> {
        (self.p.look_at > 0).then(|| crate::common::next_look(pic.t, self.p.look_at, self.p.look_days))
    }

    fn then(&mut self, tok: &Then, done: Done, cx: &mut Cx) -> Vec<Step<Then>> {
        match tok {
            Then::Trade(t) => trade::then(t, done, &mut self.orders, cx),
            Then::Body(b) => lift(self.body.then(b, done, cx), Then::Body),
            Then::Adoption(a) => {
                self.adoption.then(a, done);
                vec![]
            }
            Then::Restocked { seller, quantity, unit } => {
                let id = match done {
                    Done::Outcome(o) => o.created.as_ref().and_then(|c| c.get("order")).cloned(),
                    _ => None,
                };
                match id {
                    Some(id) => {
                        self.ours.insert(id, (seller.clone(), *quantity));
                        self.unit_cost = *unit;
                    }
                    None => self.on_order = (self.on_order - quantity).max(0),
                }
                vec![]
            }
            Then::Served { order, q, share, crew, by_system, before, finished, since, day, t } => self.served(order, *q, *share, crew, by_system, *before, *finished, *since, *day, *t, done, cx),
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        self.run(pic, cx)
    }
}

fn cond(field: &str, op: &str, value: Value) -> oikos_sight::Condition {
    let op = serde_json::from_value(json!(op)).expect("an operator");
    oikos_sight::Condition { field: field.into(), op, value }
}

impl<B: Body> Shop<B> {
    /// Serving's outcome: the goods went, or the world refused (and the order waits, or is refunded).
    #[allow(clippy::too_many_arguments)]
    fn served(&mut self, o: &Order, q: i64, share: i64, crew: &[String], by_system: &[Sys], before: i64, finished: bool, since: i64, day: i64, t: i64, done: Done, cx: &mut Cx) -> Vec<Step<Then>> {
        self.reserved = (self.reserved - q).max(0);
        let qs: i64 = by_system.iter().map(|b| b.units).sum();
        let qc = q - qs;
        if let Done::Outcome(res) = done {
            if res.status == OutcomeStatus::Applied {
                self.books.out += q;
                if qc > 0 {
                    self.pace.done(crew, t.div_euclid(DAY));
                }
                return vec![];
            }
            // (A system the world refuses is switched off, or not ours: not counted on again.)
            if !by_system.is_empty() {
                self.sys_credit += qs * 10_000;
                for b in by_system {
                    let secs = self.fleet.working(&self.p.serve_task).iter().find(|s| s.id == b.id).map_or(0, |s| s.seconds);
                    let used = self.sys_used.get(&b.id).copied().unwrap_or(0);
                    self.sys_used.insert(b.id.clone(), (used - b.units * secs).max(0));
                }
                if res.refusal.as_ref().is_some_and(|f| matches!(code_name(f).as_str(), "not_capable" | "participant_inactive" | "unknown_participant" | "not_theirs")) {
                    for b in by_system {
                        self.fleet.gone(&b.id);
                    }
                }
            }
            if qc > 0 {
                self.pace.refused(res, qc, crew);
            }
        }
        for w in crew {
            if share > 0 {
                let u = self.used.get(w).copied().unwrap_or(0);
                self.used.insert(w.clone(), (u - share).max(0));
            }
        }
        if let Done::Outcome(res) = done {
            // Someone's day is fuller than our count of it (work elsewhere today): the world's count, from now on.
            match out_of_time(res) {
                Some((Some(who), left)) => {
                    self.used.insert(who, self.p.working_day - left);
                    for w in crew {
                        let u = self.used.get(w).copied().unwrap_or(0);
                        self.used.insert(w.clone(), u.max(self.p.working_day - left));
                    }
                }
                Some((None, _)) => {
                    for w in crew {
                        self.used.insert(w.clone(), self.p.working_day);
                    }
                }
                // (A business of one whose owner could not work where they trade, for whatever the world's reason: the
                // place under water, the owner elsewhere. They see it, and try no more today.)
                None => {
                    if let (Some(op), true, true) = (self.p.operator.clone(), q > 0, res.status == OutcomeStatus::Refused) {
                        self.used.insert(op.clone(), self.p.working_day);
                        let detail = res.refusal.as_ref().and_then(|r| r.detail.clone()).unwrap_or_default();
                        if detail.starts_with(&format!("{op} isn't in the world")) || detail.starts_with(&format!("{op} has died")) {
                            self.at.gone = true;
                        }
                    }
                }
            }
        }
        let _ = day;
        // Where it was to go, or whom to, is gone: refund what is left of it. Otherwise (someone left in the same
        // moment, say) it waits its turn again.
        let undeliverable = matches!(done, Done::Outcome(r) if r.refusal.as_ref().is_some_and(|f| UNDELIVERABLE.contains(&code_name(f).as_str())));
        if let Some(x) = self.queue.iter_mut().find(|x| x.o.id == o.id) {
            x.served = before;
        }
        if undeliverable {
            self.queue.retain(|x| x.o.id != o.id);
            let why = match done {
                Done::Outcome(r) => r.refusal.as_ref().map(|f| f.detail.clone().unwrap_or_else(|| code_name(f))).unwrap_or_default(),
                _ => String::new(),
            };
            let Some(acct) = self.account_now.clone() else { return vec![] };
            return vec![self.fill_with(cx, o, 0, before, &[], &[], &format!("We couldn't deliver order {} ({why}): refunding what's left of it.", o.id), &acct)];
        }
        if finished {
            self.queue.insert(0, Queued { o: o.clone(), served: before, since });
        }
        vec![]
    }
}

fn code_name(f: &oikos_sight::RefusalInfo) -> String {
    serde_json::to_value(f.code).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

enum Out {
    Done,
    Late,
    Wait,
}

impl<B: Body> Shop<B> {
    /// Serving (part of) an order: the hours of serving and the goods to the customer; once it is finished (`total`
    /// served, all told; negative: not yet), a refund for what we could not serve and a note saying so.
    #[allow(clippy::too_many_arguments)]
    fn fill_with(&mut self, cx: &Cx, o: &Order, q: i64, total: i64, staff: &[String], by_system: &[Sys], why: &str, account: &str) -> Step<Then> {
        let money = |n| money_words(n, &cx.ctx.world);
        let mut calls: Vec<Call> = vec![];
        let by_staff = q - by_system.iter().map(|b| b.units).sum::<i64>();
        if q > 0 {
            if by_staff > 0 {
                calls.push(call(
                    "work",
                    vec![("task", Some(arg(&self.p.serve_task))), ("units", Some(text(by_staff.to_string()))), ("at", Some(arg(&self.at.premises))), ("by", Some(json(json!(staff))))],
                ));
            }
            for b in by_system {
                calls.push(call(
                    "work",
                    vec![("task", Some(arg(&self.p.serve_task))), ("units", Some(text(b.units.to_string()))), ("at", Some(arg(&self.at.premises))), ("by", Some(json(json!([b.id]))))],
                ));
            }
            calls.push(call(
                "goods",
                vec![("kind", Some(arg(&o.kind))), ("quantity", Some(text(q.to_string()))), ("to", Some(arg(&o.to))), ("at", Some(arg(&o.at))), ("from_at", Some(arg(&self.at.premises)))],
            ));
        }
        if total >= 0 {
            // (What a system of ours got wrong is refunded with what we could not serve.)
            let faulty = self.faulty.remove(&o.id).map_or(0, |f| f.len() as i64);
            let refund = (o.quantity - total + total.min(faulty)) * o.unit_price + self.over_paid.remove(&o.id).unwrap_or(0);
            if refund > 0 {
                let memo = if o.quantity > total { format!("Refund: {} {} we couldn't sell you.", o.quantity - total, o.kind) } else { format!("Refund: what you paid over our price of {}.", money(o.unit_price)) };
                calls.push(pay(&o.account, refund, Pay { from: Some(account.to_string()), for_: Some(memo), ..Default::default() }, cx));
            }
            let words = if total == o.quantity {
                format!("Served: {total} {} to {} at {}.", o.kind, o.to, o.at)
            } else {
                format!("Served {total} of the {} {} ordered{}.", o.quantity, o.kind, if refund > 0 { format!("; {} refunded", money(refund)) } else { String::new() })
            };
            calls.push(say(
                "delivery_note",
                &words,
                Say {
                    to: Some(vec![o.buyer.clone()]),
                    visible: Some(Visible::Only(vec![o.buyer.clone(), self.me.clone()])),
                    basis: Some(o.id.clone()),
                    data: Some(json!({ "order": o.id, "kind": o.kind, "ordered": o.quantity, "delivered": total, "refund": refund })),
                    ..Default::default()
                },
            ));
        }
        because(why, calls)
    }

    fn payer<'a>(acct: &'a crate::common::OwnAccount) -> Payer<'a> {
        Payer { account: &acct.account, custodian: &acct.custodian }
    }

    #[allow(clippy::too_many_lines)]
    fn run(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let t = pic.t;
        let acct = own_account(pic);
        self.account_now = acct.as_ref().map(|a| a.account.clone());
        let me = self.me.clone();
        let world = cx.ctx.world.clone();
        let money = move |n: i64| money_words(n, &world);
        let mut steps: Vec<Step<Then>> = vec![];
        if let (Some(a), Standing::Closed) = (&acct, self.body.standing()) {
            let where_ = self.premises_of(pic);
            let worth = where_.as_ref().and_then(|w| published_price(&self.book, &self.p.builder, &w.1, "prices"));
            let sale_price = worth.map(|w| w * self.p.premises_sale_bps / 10_000);
            let w = Wind { pic, book: &self.book, acct: a, stage: Stage::Closed, premises: where_, sale_price, paid_suppliers: 0, staying: false };
            return lift(self.body.wind_up(&w, cx), Then::Body);
        }
        // A shop just founded sets itself up before it trades.
        if !self.setup.ready {
            return self.setting_up(pic, acct.as_ref(), cx);
        }
        let Some(acct) = acct else { return steps };
        if self.body.winding_due(t) {
            // (Wages and redundancy pay owed, and the tax withheld from wages, come first: before suppliers, other debts and
            // shareholders. Then what we owe our suppliers for goods delivered on their terms, as the debts recorded against us are.)
            let (mut steps, staff_paid) = self.body.wind_up_owed(&self.book, t, &acct, cx);
            let mut steps: Vec<Step<Then>> = lift(std::mem::take(&mut steps), Then::Body);
            let (owed, paid) = self.payables.settle::<Then>(t, &acct.account, acct.balance - staff_paid, None, cx);
            steps.extend(owed);
            let w = Wind { pic, book: &self.book, acct: &acct, stage: Stage::Due, premises: None, sale_price: None, paid_suppliers: staff_paid + paid, staying: false };
            steps.extend(lift(self.body.wind_up(&w, cx), Then::Body));
            return steps;
        }
        let mut trading = self.body.standing() == Standing::Trading;
        // (Suppliers are paid on the day by whether we were trading when the wake began, as the TS read it once.)
        let was_trading = trading;
        let workers = self.body.workers(&self.book, t);
        let operator = self.p.operator.is_some();
        if self.headcount < 0 {
            // (a new shop starts by hiring its minimum)
            self.headcount = if operator { 0 } else { (workers.len() as i64).max(self.p.min_staff) };
        }
        let leased = operator && self.lease.is_some();
        let hands_bps: i64 = if operator { 10_000 + if leased { workers.iter().filter(|w| Some(w.as_str()) != self.p.operator.as_deref()).map(|w| self.body.hours_bps(w, t)).sum::<i64>() } else { 0 } } else { workers.iter().map(|w| self.body.hours_bps(w, t)).sum() };
        if self.month_start < 0 {
            self.month_start = acct.balance;
        }
        // (Its owner has moved home: it trades from there now, and takes its stock along.)
        let moves: Vec<_> = if operator { self.book.all("trading_from").cloned().collect() } else { vec![] };
        // (Once we trade from premises we lease, the owner's moving home moves nothing of ours; their giving up still closes us.)
        let moves: Vec<_> = if self.lease.is_some() { moves.into_iter().filter(|r| data(r).flag("closed")).collect() } else { moves };
        while self.at.read < moves.len() {
            let r = &moves[self.at.read];
            self.at.read += 1;
            if r.speaks_for.as_deref() != self.p.operator.as_deref() || !crate::common::addressed_to(r).iter().any(|a| *a == me) {
                continue;
            }
            let d = data(r);
            self.published_price = -1; // (its prices go up where it now is, or come down)
            if d.flag("nowhere") {
                self.at.nowhere = true;
                continue;
            }
            // (Its owner gives it up: it stops trading, refunds what it had not served, pays what it holds to its owner and says it has closed.)
            if d.flag("closed") {
                self.at.gone = true;
                self.at.given_up = true;
                continue;
            }
            let had = held(pic, &self.at.premises, &self.p.kind);
            let to = d.s("structure").unwrap_or_default().to_string();
            if had > 0 && to != self.at.premises {
                steps.push(because(
                    format!("Our owner lives at {} now: taking our stock there.", d.s("space").unwrap_or_default()),
                    vec![call(
                        "goods",
                        vec![("kind", Some(arg(&self.p.kind))), ("quantity", Some(text(had.to_string()))), ("to", Some(arg(&me))), ("at", Some(arg(&to))), ("from_at", Some(arg(&self.at.premises)))],
                    )],
                ));
            }
            self.at.premises = to;
            self.at.workplace = d.s("space").unwrap_or_default().to_string();
            self.at.cell = d.s("cell").map(str::to_string).unwrap_or_else(|| self.at.cell.clone());
            self.at.nowhere = false;
        }
        if operator && self.lease.is_none() {
            steps.extend(self.take_premises(t, &acct.account, held(pic, &self.at.premises, &self.p.kind), cx));
        } else if operator {
            steps.extend(self.lease_affairs(t, &acct, held(pic, &self.at.premises, &self.p.kind), cx, &money));
        }
        let stock = held(pic, &self.at.premises, &self.p.kind);
        if trading {
            self.stock_meter.read(t.div_euclid(DAY), stock);
        }
        // The stocktake (crime: docs/behaviour/crime.md), monthly: what is here against our books (last count, what came,
        // what we served). Short: reported to the police, with what it was worth at our price.
        if !self.p.police.is_empty() && t >= self.books.next {
            self.books.next = t + self.p.stocktake_days * DAY;
            let expected = self.books.last.map(|l| l + self.books.r#in - self.books.out);
            self.books.last = Some(stock);
            self.books.r#in = 0;
            self.books.out = 0;
            if let Some(e) = expected.filter(|e| *e > stock) {
                steps.push(because(
                    format!("The stocktake: {stock} {} here, where our books say {e}. {} missing: reporting it to the police.", self.p.kind, e - stock),
                    vec![say(
                        "crime_report",
                        &format!("Report: {} {} missing from {}, found at our stocktake.", e - stock, self.p.kind, self.p.premises),
                        Say {
                            to: Some(vec![self.p.police.clone()]),
                            visible: Some(Visible::Only(vec![me.clone(), self.p.police.clone()])),
                            data: Some(json!({ "kind": self.p.kind, "quantity": e - stock, "at": self.p.premises, "value": (e - stock) * self.price, "account": acct.account })),
                            ..Default::default()
                        },
                    )],
                ));
            }
        }
        // Our suppliers' prices, cheapest first (at one price, in our own order).
        struct Offer {
            seller: String,
            account: String,
            unit: i64,
            min: i64,
            terms: i64,
            /// The price we weigh it at: its regular price where it states a clearance (sourcing.rs).
            weigh_at: i64,
        }
        let mut offers: Vec<Offer> = self
            .suppliers
            .iter()
            .filter_map(|s| {
                let g = goods_prices(&self.book, s);
                let unit = *g.prices.get(&self.p.kind)?;
                let weigh_at = if g.clearance.is_some() { g.regular.unwrap_or(unit).max(unit) } else { unit };
                Some(Offer { seller: s.clone(), account: g.account?, unit, min: g.min_order.unwrap_or(1), terms: g.terms_days.unwrap_or(0), weigh_at })
            })
            .collect();
        offers.sort_by(|a, b| a.unit.cmp(&b.unit).then(self.standing_of(&a.seller).cmp(&self.standing_of(&b.seller))).then_with(|| a.seller.cmp(&b.seller)));
        if self.unit_cost == 0 {
            if let Some(o) = offers.first() {
                self.unit_cost = o.unit;
            }
        }
        // (What serving costs a unit: its hours at the wage, and where systems do some, their fees spread over the units they do.)
        let labour_cost = (self.p.hourly(self.wage) * self.p.serve_labour + 3599).div_euclid(3600);
        let by_us = self.system_units(self.last_demand);
        let marginal_cost = self.unit_cost
            + if by_us > 0 && self.last_demand > 0 { ((self.last_demand - by_us) * labour_cost + self.fleet_fees() + self.last_demand - 1).div_euclid(self.last_demand) } else { labour_cost };

        // ---- the month's end: Lengnick's rules (the price rule is prices.rs's) ----
        let m = (t - self.review_day).div_euclid(MONTH);
        if trading && self.month.is_none() {
            self.month = Some(m);
            self.opened_at = t;
        }
        if self.month != Some(m) && trading && t - self.opened_at < MONTH {
            // (a month's boundary before it has traded a whole month: it only starts counting)
            self.month = Some(m);
        } else if self.month != Some(m) && trading {
            self.month = Some(m);
            // (The first review looks at all the trade since opening, which is a month and some days, as a month's.)
            let span = t - self.opened_at;
            self.last_demand = if !self.reviewed && span > MONTH { (2 * self.sold * MONTH + span).div_euclid(2 * span) } else { self.sold };
            self.last_turned_away = self.turned_away;
            self.reviewed = true;
            self.sold = 0;
            self.turned_away = 0;
            let mut rng = cx.rng(&format!("month-{m}"));
            let mut why: Vec<String> = vec![];
            let (unfilled, posting) = self.body.vacancies(&self.book, t);
            let (wage, full, w_why) = move_wage(&self.p.lengnick, &mut rng, self.wage, WageMonth { unfilled, posting, staffed: !workers.is_empty(), full_months: self.full_months }, &money);
            self.wage = wage;
            self.full_months = full;
            why.extend(w_why);
            // Lengnick's firms deliver what their labour makes; a shop delivers what its staff's hours can serve. Short of
            // hands for last month's demand, it is short as a firm short of stock is: it may raise its price, and never
            // cuts it while it turns customers away.
            let can_serve = hands_bps * self.p.hours_per_worker_month() / (10_000 * self.p.serve_labour.max(1));
            let rivals = rivals_seen(&self.book, &me, &self.p.kind, Level::Retail, t, self.p.figures.rival_days * DAY);
            let moved = move_price(
                &self.p.lengnick,
                &self.p.figures,
                &mut rng,
                &Signals { price: self.price, marginal_cost, demand: self.last_demand, turned_away: self.last_turned_away, stock: self.stock_meter.month(stock), can_supply: Some(can_serve), rivals: &rivals },
                &money,
            );
            self.price = moved.price;
            if let Some(w) = moved.why {
                self.price_why = w;
            }
            // Headcount: a worker at a time towards the hands the trade we expect needs: our sales smoothed over a few
            // months, never one month's alone (docs/behaviour/firms.md, "Adjusting labour").
            let expected = self.expectation.expect(self.last_demand);
            let hpwm = self.p.hours_per_worker_month();
            let needed = if operator {
                // (A business of one in premises it leases: those its trade needs beside its owner, up to its room.)
                match &self.lease {
                    Some(l) => {
                        let all = (expected * self.p.serve_labour * 10_000 + hpwm * self.p.utilisation_bps - 1).div_euclid((hpwm * self.p.utilisation_bps).max(1));
                        (all - 1).clamp(0, (l.room - 1).max(0))
                    }
                    None => 0,
                }
            } else {
                // (What systems of ours do, our people need not: docs/behaviour/automation.md.)
                let people_units = expected - self.system_units(expected);
                self.p.max_staff.min(self.p.min_staff.max((people_units * self.p.serve_labour * 10_000 + hpwm * self.p.utilisation_bps - 1).div_euclid(hpwm * self.p.utilisation_bps)))
            };
            let trade = if self.p.adjust.smooth_months > 1 { format!("the trade we expect ({expected} a month; last month {})", self.last_demand) } else { format!("last month's sales ({})", self.last_demand) };
            let r = Review { needed, trade, notice_days: self.p.notice_days, expected, last_demand: self.last_demand, surplus: Surplus::OverStaffed, stock, phi_low_bps: self.p.lengnick.phi_low_bps };
            let staffed = self.body.review(&self.book, t, &r, workers.len() as i64, cx);
            self.headcount = staffed.headcount;
            self.headcount_why = format!("{}{}", staffed.why, if why.is_empty() { String::new() } else { format!("; {}", why.join("; ")) });
            steps.extend(lift(staffed.steps, Then::Body));
            // Systems on offer: whether to take one for serving, or to end a licence that has run its term (docs/behaviour/automation.md).
            if self.p.automation.is_some() && !operator {
                let monthly = self.wage * MONTH / self.p.period;
                let rv = automation::Review {
                    at: Some(self.at.premises.clone()),
                    task: self.p.serve_task.clone(),
                    facts: automation::Task {
                        units: expected,
                        labour: self.p.serve_labour,
                        wage_month: monthly,
                        seconds_per_worker_month: hpwm,
                        utilisation_bps: self.p.utilisation_bps,
                        unit_price: self.price,
                        hiring_cost_weeks: self.p.adjust.hiring_cost_weeks,
                    },
                    staff: workers.len() as i64,
                    account: acct.account.clone(),
                    balance: acct.balance,
                    keep: 2 * workers.len() as i64 * monthly + self.payables.owing(),
                };
                let adopted: Vec<Step<Then>> = self.adoption.review(&mut self.fleet, &mut self.book, t, &rv, cx);
                steps.extend(adopted);
            }
            // Out of the month's earnings, what we hold beyond the buffer goes to the shareholders: a month's wages, a
            // month's stock at cost, and Lengnick's chi of the wage bill.
            let bill = (workers.len() as i64).max(self.headcount) * self.wage * MONTH / self.p.period;
            // (And what we owe our suppliers for stock delivered on their terms: a dividend must not take the money its invoices are paid from.)
            let buffer = bill + self.p.stock_for(self.last_demand) * self.unit_cost + bill * self.p.lengnick.chi_bps / 10_000 + self.payables.owing();
            // (Nothing is paid out while wages are owed or anyone is under notice: docs/behaviour/firms.md, "Before a dividend".)
            let paid = if self.p.draw_days > 0 {
                0
            } else if let Some(strain) = self.body.strained(&self.book, t, &cx.ctx.world) {
                steps.push(because(format!("Month's end: {strain}, so nothing is paid out to our shareholders."), vec![]));
                0
            } else {
                let (s, paid) = pay_out::<Then>(&self.book, &me, &Self::payer(&acct), acct.balance, buffer, acct.balance - self.month_start, &format!("a month's wages and stock, and {}% of the wage bill", super::lengnick::percent(self.p.lengnick.chi_bps)), &money);
                steps.extend(s);
                paid
            };
            self.month_start = acct.balance - paid;
            // A business of one whose owner turned customers away: whether premises to let would pay, with the hands its
            // trade needs (docs/behaviour/leasing.md).
            if operator && self.lease.is_none() && self.premises_applied.is_none() && self.last_turned_away > 0 {
                if let Some(st) = self.apply_for_premises(t, acct.balance, &acct.account, &money) {
                    steps.push(st);
                }
            }
            // A business of one in premises it leases weighs them each month as it weighed taking them: the custom it had,
            // served by the hands it needs, less their wages and the rent, against what its owner alone would serve. Worse
            // for `leave_after_months` running: it asks to leave (docs/behaviour/leasing.md, "Leaving early").
            if operator && self.lease.as_ref().is_some_and(|l| l.leaving.is_none() && self.book.in_force(&l.agreement)) {
                let loss = self.lease_loss();
                let losing = if loss > 0 { self.lease.as_ref().map_or(0, |l| l.losing) + 1 } else { 0 };
                if let Some(l) = self.lease.as_mut() {
                    l.losing = losing;
                }
                if losing >= self.p.leave_after_months.max(1) {
                    let why = format!("For {losing} months our premises have paid us {} a month less than trading alone would", money(loss));
                    steps.extend(self.ask_to_leave(t, &why));
                }
            }
        }

        // ---- staff, the bank, the union, debts: the body's routine ----
        let months = self.body.months_in_hand(&self.book);
        let can_post = trading
            && (!operator || leased)
            && acct.balance >= months * ((workers.len() as i64 + 1) * self.wage * MONTH / self.p.period)
            && self.room_at_work(pic, workers.len() as i64) > 0;
        let postable = trading && (!operator || leased) && self.room_at_work(pic, workers.len() as i64) > 0;
        let most = match (&self.lease, operator) {
            (Some(l), true) => (l.room - 1).max(0),
            _ => self.p.max_staff,
        };
        let want = Want { target: if trading && (!operator || leased) { most.min(self.headcount) } else { 0 }, wage: self.wage, can_post, postable, headcount: self.headcount, headcount_why: self.headcount_why.clone() };
        // (What a day without our work costs in sales, and the share of our work that systems do: the employer's side of bargaining.)
        let system_bps = if self.last_demand > 0 { ((self.system_units(self.last_demand) * 10_000 * 2 + self.last_demand) / (2 * self.last_demand)).clamp(0, 10_000) } else { 0 };
        let house = House { pic, book: &self.book, acct: &acct, want, trading, workers: workers.len(), operator, takings_per_day: self.takings.per_day(t), system_bps };
        let dealt = self.body.dealings(&house, cx);
        steps.extend(lift(dealt.steps, Then::Body));
        for rise in dealt.wage_rises {
            self.wage = self.wage * (10_000 + rise) / 10_000;
        }
        if self.p.automation.is_some() {
            steps.extend(self.fleet.paperwork::<Then>(&self.book, &acct.account, cx));
        }
        if let Some(cap) = dealt.headcount_cap {
            self.headcount = self.headcount.min(cap);
        }
        if dealt.began {
            trading = false;
        }

        // ---- our price list: where we are, and what we charge ----
        // A business of one whose owner has gone from the town, or has nowhere to trade from: its prices come down, what
        // it was to serve is refunded, and (gone) what it holds goes to its owner's account and it says it has closed.
        if operator && (self.at.gone || self.at.nowhere) {
            let old: Vec<_> = self.book.open("price_list").filter(|r| r.speaks_for.as_deref() == Some(&me)).map(|r| r.id.clone()).collect();
            if !old.is_empty() {
                let why = if self.at.given_up {
                    "Our owner has given the business up: we have stopped trading."
                } else if self.at.gone {
                    "Our owner has gone: we have stopped trading."
                } else {
                    "Nowhere to trade from: our prices come down until there is."
                };
                steps.push(because(why, old.iter().map(|id| withdraw(id, Some("Not trading."))).collect()));
            }
            self.published_price = -1;
            for x in std::mem::take(&mut self.queue) {
                steps.push(self.fill_with(cx, &x.o, 0, x.served, &[], &[], "We are not trading: refunding what we had not served.", &acct.account));
            }
            let due = self.orders.due(&self.book, t, |_| true);
            for o in &due.paid {
                steps.push(self.fill_with(cx, o, 0, 0, &[], &[], "We are not trading: refunding the order.", &acct.account));
            }
            // (A business closing while it leases premises leaves them first (docs/behaviour/leasing.md, "Leaving early"): by
            // its own notice, where the lease gives it one, and it closes when the lease has ended; else by asking the
            // landlord to accept a surrender, paid for out of what it holds, and it closes when the lease has ended or a
            // month on with nothing come of asking: the lease then runs on, and the landlord has its remedies.)
            let leased_still = self.lease.as_ref().filter(|l| self.book.in_force(&l.agreement)).map(|l| (l.agreement.clone(), l.leaving));
            let mut wait = false;
            if let (true, false, Some((agreement, asked))) = (self.at.gone, self.at.closed, leased_still) {
                if let Some(l) = self.lease.as_mut() {
                    l.must_leave = true;
                }
                match asked {
                    None => {
                        steps.extend(self.ask_to_leave(t, "Our business is closing"));
                        wait = true;
                    }
                    Some(at) => wait = self.our_notice(&agreement).is_some() || t - at < MONTH,
                }
            }
            if self.at.gone && !self.at.closed && !wait {
                self.at.closed = true;
                // (A business that closes pays its suppliers what it owes them first, out of what it holds; the rest is its owner's.)
                let (owed, paid) = self.payables.settle::<Then>(t, &acct.account, acct.balance, None, cx);
                let why = if self.at.given_up { "Our owner has given the business up: what it holds is theirs" } else { "Our owner has gone from the town: what the business holds is theirs" };
                let (out, outpaid) = distribute::<Then>(&self.book, &me, &Self::payer(&acct), acct.balance - paid, why, &money);
                steps.extend(owed);
                steps.extend(out);
                let mut d = json!({ "firm": me, "to_creditors": 0, "to_shareholders": outpaid });
                if self.at.given_up {
                    d["given_up"] = json!(true);
                }
                steps.push(because(
                    if self.at.given_up { "Closed: our owner has given the business up." } else { "Closed: our owner has gone." },
                    vec![say(
                        "closure",
                        &format!("{me} has closed: its owner has {}.", if self.at.given_up { "given it up" } else { "gone" }),
                        Say { visible: Some(Visible::Public), data: Some(d), ..Default::default() },
                    )],
                ));
            }
            return steps;
        }
        if self.price != self.published_price && trading {
            let old: Vec<String> = self.book.open("price_list").filter(|r| r.speaks_for.as_deref() == Some(&me)).map(|r| r.id.clone()).collect();
            self.published_price = self.price;
            let on = if self.p.shopfront { self.premises_of(pic).map(|p| p.2).or_else(|| (!self.at.cell.is_empty()).then(|| self.at.cell.clone())) } else { None };
            let mut prices = BTreeMap::new();
            prices.insert(self.p.kind.clone(), self.price);
            let words = format!("{} at {} each, at {}: delivered to your home, or kept here for you. Order and pay with the order.", self.p.kind, money(self.price), self.at.premises);
            let mut calls: Vec<Call> = old.iter().map(|id| withdraw(id, Some("Superseded."))).collect();
            calls.push(price_list(&prices, &acct.account, &words, json!({ "at": self.at.premises }), Some(&me), on.as_deref(), !self.p.shopfront));
            let why = if old.is_empty() { "Publishing our price.".to_string() } else if self.price_why.is_empty() { format!("Our price is now {}.", money(self.price)) } else { self.price_why.clone() };
            steps.push(because(why, calls));
        }

        // ---- what we owe our suppliers for stock delivered on their terms: paid on the day, wages first ----
        if was_trading {
            let keep = (workers.len() as i64).max(self.headcount) * self.wage;
            steps.extend(self.payables.pay::<Then>(t, &acct.account, acct.balance, keep, None, false, cx));
        }

        // ---- restocking, weekly: below the middle of Lengnick's band of last month's sales, up to its top ----
        if t >= self.next_restock && !offers.is_empty() && trading {
            self.next_restock = t + if operator { 1 } else { 7 } * DAY; // (someone trading alone on a few days' stock buys when it runs low)
            let l = self.p.lengnick;
            let top = (l.phi_high_bps * self.p.stock_for(self.last_demand) + 9999).div_euclid(10_000);
            let mid = ((l.phi_low_bps + l.phi_high_bps) * self.p.stock_for(self.last_demand) + 19_999).div_euclid(20_000);
            let have = stock + self.on_order;
            // As much as we can pay for, keeping the next pay period's wages aside. On a supplier's terms (if it states
            // any, and we are not behind with it), what we can order is what we can pay for out of what we expect to sell
            // in the time it gives, less what we already owe: stock no longer comes out of the wage bill in the week it is
            // bought (docs/behaviour/trade.md, "Trade credit").
            let keep_for_wages = (workers.len() as i64).max(self.headcount) * self.wage;
            let pending = self.payables.pending(t);
            let mut cash = (acct.balance - pending - keep_for_wages).max(0);
            let longest = offers.iter().filter(|o| self.p.credit && o.terms > 0 && !self.payables.behind(&o.seller, t)).map(|o| o.terms).max().unwrap_or(0);
            let cheapest = offers.iter().map(|o| o.unit).min().unwrap_or(1).max(1);
            let mut room = if longest > 0 { (self.last_demand * cheapest * longest / 30 - self.payables.owing()).max(0) } else { 0 };
            if have < mid {
                // The order is spread across our suppliers by their prices and how fully each has delivered (sourcing.rs:
                // retailers multi-source), never all of it to the cheapest.
                let cands: Vec<Candidate> = offers
                    .iter()
                    .map(|o| Candidate { key: o.seller.clone(), weigh_at: o.weigh_at, min: o.min, fill_bps: self.sources.fill_bps(&o.seller), standing: self.standing_of(&o.seller) })
                    .collect();
                let split = sourcing::split(&self.p.sourcing, &cands, top - have);
                let mut ordered: BTreeSet<String> = BTreeSet::new();
                for (i, share) in split {
                    let o = &offers[i];
                    let terms = if self.p.credit && o.terms > 0 && !self.payables.behind(&o.seller, t) { o.terms } else { 0 };
                    let can = if terms > 0 { (cash + room).div_euclid(o.unit.max(1)) } else { cash.div_euclid(o.unit.max(1)) };
                    let q = share.min(can);
                    if q < o.min || q <= 0 {
                        continue;
                    }
                    let cost = q * o.unit;
                    if terms > 0 {
                        let from_room = cost.min(room);
                        room -= from_room;
                        cash -= cost - from_room;
                    } else {
                        cash -= cost;
                    }
                    ordered.insert(o.seller.clone());
                    self.on_order += q;
                    let why = format!(
                        "Restocking: {stock} in stock and {} on order, below {mid} (the middle of our band of last month's sales, {}): ordering {q}{} from {} at {}, its share of the {} we need by its price and how fully it has delivered{}.",
                        self.on_order - q,
                        self.last_demand,
                        if q < share { format!(" (as many as we can pay for of its {share})") } else { String::new() },
                        o.seller,
                        money(o.unit),
                        top - have,
                        if terms > 0 { format!(", on its terms (to pay within {terms} days of delivery)") } else { String::new() }
                    );
                    let mut st = order::<Then>(
                        &Ordering {
                            me: me.clone(),
                            seller: o.seller.clone(),
                            seller_account: o.account.clone(),
                            kind: self.p.kind.clone(),
                            quantity: q,
                            unit_price: o.unit,
                            to: None,
                            at: self.at.premises.clone(),
                            from: acct.account.clone(),
                            why,
                            retry_of: None,
                            for_days: None,
                            terms: (terms > 0).then_some(terms),
                        },
                        cx,
                    );
                    st.then = Some(Then::Restocked { seller: o.seller.clone(), quantity: q, unit: o.unit });
                    steps.push(st);
                }
                let others: Vec<&str> = offers.iter().map(|o| o.seller.as_str()).filter(|s| !ordered.contains(*s)).collect();
                self.sources.recover(&self.p.sourcing, &others);
            }
        }

        // ---- the owner's draw (a business run by its owner alone): every so often, what it holds beyond the money for
        // its stock (the top of its band, or a supplier's least order if that is more) goes to its owner ----
        if self.p.draw_days > 0 && trading {
            if self.next_draw < 0 {
                self.next_draw = t + self.p.draw_days * DAY;
            }
            if t >= self.next_draw {
                self.next_draw = t + self.p.draw_days * DAY;
                // (At what its supplier charges now, and a tenth over: kept to the last unit, a rise in the price left it
                // one item short of the least order, and it never bought again.)
                let top = (self.p.lengnick.phi_high_bps * self.p.stock_for(self.last_demand) + 9999).div_euclid(10_000);
                let least = offers.first().map_or(0, |o| o.min);
                let unit = self.unit_cost.max(offers.first().map_or(0, |o| o.unit));
                // (In premises we lease: the month's rent and a pay period's wages are kept too, before anything is the owner's.)
                let leased_keep = self.lease.as_ref().map_or(0, |l| l.rent + self.body.workers(&self.book, t).len() as i64 * self.wage);
                let keep = (top.max(least) * unit * 11 + 9).div_euclid(10) + self.payables.owing() + leased_keep;
                // (What running it costs beside its stock, the profile's: registration or licence, and the like, paid
                // for the period, before anything is the owner's: docs/behaviour/entry.md, "What a business costs".)
                let running = (self.p.fixed_per_month * self.p.draw_days * DAY).div_euclid(MONTH).min(acct.balance.max(0));
                let mut held = acct.balance;
                if running > 0 && !self.p.fixed_to.is_empty() {
                    held -= running;
                    steps.push(because(
                        format!("What running the business costs for {} days: {}.", self.p.draw_days, money(running)),
                        vec![pay(&self.p.fixed_to, running, Pay { from: Some(acct.account.clone()), for_: Some("Running costs: registration, licence and the like.".into()), ..Default::default() }, cx)],
                    ));
                }
                if held > keep {
                    let (s, _) = distribute::<Then>(&self.book, &me, &Self::payer(&acct), held - keep, &format!("We hold {} and keep {} for stock: the rest is our owner's", money(held), money(keep)), &money);
                    steps.extend(s);
                }
            }
        }

        // ---- serving: paid orders, oldest first, as far as today's hands and our stock go ----
        let day = t.div_euclid(DAY);
        if day != self.used_day {
            self.used_day = day;
            self.used.clear();
            self.sys_used.clear();
        }
        let present = self.present(pic, t, &workers);
        // Every paid order joins the queue: what customers wanted, served or not.
        let due = self.orders.due(&self.book, t, |_| true);
        for mut o in due.paid {
            // An order at a price we have since raised: the customer pays the price on our shelf, as at a till, for as many as
            // their money buys, and the rest of it comes back with the order's note (they read our price when they come,
            // whatever they last saw of it). Refunded whole only if it buys none.
            if o.kind == self.p.kind && o.unit_price < self.price && o.total() >= self.price && self.price > 0 {
                let q = o.total() / self.price;
                self.over_paid.insert(o.id.clone(), o.total() - q * self.price);
                o.quantity = q;
                o.unit_price = self.price;
            }
            if o.kind != self.p.kind || o.unit_price < self.price {
                let why = format!("An order {}: refunding it.", if o.kind != self.p.kind { format!("for {}, which we don't sell", o.kind) } else { "below our price".to_string() });
                steps.push(self.fill_with(cx, &o, 0, 0, &[], &[], &why, &acct.account));
                continue;
            }
            self.sold += o.quantity;
            self.takings.add(t, o.quantity * o.unit_price);
            self.queue.push(Queued { o, served: 0, since: t });
        }
        // Each worker's time left today; serving is shared evenly among those here, as the work is.
        let room_of = |s: &Self, w: &str| -> i64 {
            if s.p.work_day(t) {
                (s.p.working_day * s.body.hours_bps(w, t) / 10_000 - s.used.get(w).copied().unwrap_or(0)).max(0)
            } else {
                0
            }
        };
        // (Who serves today: those here with the most time between them, the work shared evenly.)
        let crew: Vec<String> = team(&present, |w| room_of(self, w)).0;
        let mut left = (stock - self.reserved).max(0);
        let ids: Vec<String> = self.queue.iter().map(|x| x.o.id.clone()).collect();
        for id in ids {
            let Some(x) = self.queue.iter().find(|x| x.o.id == id).cloned() else { continue };
            let want = x.o.quantity - x.served;
            // Systems of ours take the share of an order they can do, as far as their own day goes (a system works whatever the hour).
            let mut by_system: Vec<Sys> = vec![];
            if self.p.automation.is_some() && left > 0 {
                let w = self.fleet.working(&self.p.serve_task);
                if !w.is_empty() {
                    self.sys_credit += want * w.iter().map(|s| s.scope_bps).max().unwrap_or(0);
                    let mut owed = (self.sys_credit / 10_000).min(want).min(left);
                    for sy in &w {
                        let room = (DAY - self.sys_used.get(&sy.id).copied().unwrap_or(0)) / sy.seconds.max(1);
                        let units = owed.min(room);
                        if units <= 0 {
                            continue;
                        }
                        owed -= units;
                        self.sys_credit -= units * 10_000;
                        *self.sys_used.entry(sy.id.clone()).or_insert(0) += units * sy.seconds;
                        by_system.push(Sys { id: sy.id.clone(), offer: sy.offer.clone(), units });
                    }
                }
            }
            let qs: i64 = by_system.iter().map(|b| b.units).sum();
            let min_room = crew.iter().map(|w| room_of(self, w)).min().unwrap_or(0);
            let per_unit = self.pace.per_unit(&crew);
            let qc = (want - qs).min(left - qs).min(min_room * crew.len() as i64 / per_unit);
            let q = qs + qc;
            // (An order for a fortnight's shopping is served over the fortnight: it's what the household uses until then.)
            let within = x.o.for_days.unwrap_or(self.p.serve_within_days);
            let out = if left == 0 || q == want { Out::Done } else if t - x.since >= within * DAY { Out::Late } else { Out::Wait };
            if q == 0 && matches!(out, Out::Wait) {
                break; // no hands left today: the rest wait their turn
            }
            let share = if qc > 0 { (qc * per_unit + crew.len() as i64 - 1).div_euclid(crew.len() as i64) } else { 0 };
            left -= q;
            for w in &crew {
                if share > 0 {
                    *self.used.entry(w.clone()).or_insert(0) += share;
                }
            }
            let before = x.served;
            let served = x.served + q;
            let finished = !matches!(out, Out::Wait);
            if let Some(i) = self.queue.iter().position(|y| y.o.id == id) {
                if finished {
                    self.queue.remove(i);
                } else {
                    self.queue[i].served = served;
                }
            }
            if finished && served < x.o.quantity {
                self.turned_away += x.o.quantity - served;
            }
            let why = if !finished {
                format!("Serving {q} of the {} {} {} ordered today; the rest tomorrow.", x.o.quantity, x.o.kind, x.o.buyer)
            } else if served == x.o.quantity {
                format!("Serving an order paid in full: {served} {}{}.", x.o.kind, if before > 0 { " (the last of it)" } else { "" })
            } else if left == 0 && !matches!(out, Out::Late) {
                format!("Out of stock: served {served} of the {} ordered; refunding the rest.", x.o.quantity)
            } else {
                format!("We couldn't serve all of an order within {within} days: served {served} of the {} ordered; refunding the rest.", x.o.quantity)
            };
            // (A system slips at the rate its supplier's offer gives, in the world's table of slips; an item it got wrong is refunded.)
            let mut n = before;
            for b in &by_system {
                for _ in 0..b.units {
                    if system_slips(cx, &b.offer, &format!("{}.{n}", x.o.id)) {
                        self.faulty.entry(x.o.id.clone()).or_default().insert(n.to_string());
                    }
                    n += 1;
                }
            }
            let mut st = self.fill_with(cx, &x.o, q, if finished { served } else { -1 }, if qc > 0 { &crew } else { &[] }, &by_system, &why, &acct.account);
            // (Orders are sent one at a time, each when the last is done, and a delivery takes the crew out: one that comes up after the
            // close finds the crew gone, so it is not sent: it waits for tomorrow, as an order not got to in the day does.)
            if q > 0 && !operator && self.p.open_until > 0 {
                st.lapses_at = Some(day * DAY + self.p.open_until);
            }
            self.reserved += q;
            st.then = Some(Then::Served { order: x.o.clone(), q, share, crew: crew.clone(), by_system: by_system.clone(), before, finished, since: x.since, day, t });
            steps.push(st);
        }
        for o in due.unpaid {
            steps.push(decline::<Then>(&o, &me, "An order unpaid for a week: declining it."));
        }
        for (a, x) in self.orders.unclaimed(&self.book) {
            self.orders.refunded(&a);
            steps.push(send_back::<Then>(&a, x, &acct.account, cx));
        }
        steps
    }
}

/// The actor: the shop's plan, run as an office's steps, with its body's beliefs for the truth audits.
/// What premises would leave a business of one a month (docs/behaviour/leasing.md): the custom it wants served by as
/// many hands as it needs (`per_worker` units a month each) within the unit's room, owner included, each hand beside
/// the owner paid `wage_month`, less the unit's costs a month. With the hands that takes.
pub fn premises_pay(wanted: i64, per_worker: i64, margin: i64, wage_month: i64, costs: i64, room: i64) -> (i64, i64) {
    let per_worker = per_worker.max(1);
    let hands = ((wanted + per_worker - 1) / per_worker).clamp(1, room.max(1));
    let units = wanted.min(hands * per_worker);
    (units * margin - (hands - 1) * wage_month - costs, hands)
}

pub struct ShopActor<B: Body>(Stepper<Shop<B>>);

impl<B: Body> Actor for ShopActor<B> {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> crate::Action {
        let action = self.0.step(pic, cx);
        // The act that ends a wake carries the organisation's record, where it has one to write (orgwants.ts `keeping`).
        if matches!(action, crate::Action::Wait { .. }) {
            self.0.plan.body.keep(cx);
        }
        action
    }
    fn beliefs(&self) -> Vec<crate::Belief> {
        self.0.plan.body.beliefs(&self.0.plan.book)
    }
    fn sent(&mut self, action: &str) {
        self.0.sent(action);
    }
    fn save(&self) -> Result<Value, String> {
        self.0.save()
    }
}

/// firm.retailer.
pub struct Retailer;

/// The manifest the TS module wrote, with this port's own parameters added (their meaning in `source`).
pub fn manifest() -> Value {
    let mut m: Value = serde_json::from_str(MANIFEST).expect("the TS manifest");
    m["version"] = json!(VERSION);
    let params = m["params"].as_object_mut().expect("params");
    let add = |p: &mut serde_json::Map<String, Value>, k: &str, default: Value, unit: Option<&str>, what: &str| {
        let mut v = json!({ "schema": { "type": if default.is_string() { "string" } else { "integer" }, "description": what }, "default": default, "source": "placeholder" });
        if let Some(u) = unit {
            v["unit"] = json!(u);
        }
        p.insert(k.into(), v);
    };
    add(params, "price_adjust_bps", json!(5000), Some("bps"), "how much of the imbalance of supply and demand a month's price step answers (docs/behaviour/prices.md)");
    add(params, "rival_weight_bps", json!(2500), Some("bps"), "how much of the gap to rivals' median price a month's step closes");
    add(params, "clearance_cover_bps", json!(30_000), Some("bps"), "stock beyond this share of a month's demand is cleared at a discount");
    add(params, "clearance_floor_bps", json!(8000), Some("bps"), "the lowest a clearance sale takes a price, as a share of marginal cost");
    add(params, "supplier_price_power", json!(10), None, "the power on a supplier's price relative to the cheapest in the share of a restock it is given (docs/behaviour/sourcing.md; to be sourced)");
    add(params, "supplier_fill_weight_bps", json!(2500), Some("bps"), "how much a new delivery weighs in a supplier's delivery record");
    add(params, "supplier_recover_bps", json!(1250), Some("bps"), "how much of the way back to a full record a supplier not ordered from comes at each restock");
    add(params, "rival_days", json!(60), Some("days"), "how old a rival's price list may be and still count");
    add(params, "rivals_board", json!(""), None, "what sellers advertise to households, searched monthly for the prices a shop is compared with (none: only the lists it has been shown)");
    m
}

impl Kind for Retailer {
    fn name(&self) -> &'static str {
        "firm.retailer"
    }
    fn version(&self) -> &'static str {
        VERSION
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/retailer.md"
    }
    fn manifest(&self) -> Value {
        manifest()
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        (fact(&ctx.entity, "first-wake") % 24) as i64 * 3600
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params::read(ctx)?;
        Ok(Box::new(ShopActor(Stepper::new(Shop::new(ctx, p, PlainBody::new(&ctx.entity))))))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(ShopActor(Stepper::<Shop<PlainBody>>::restore(saved)?)))
    }
}

/// firm.retailer as the world runs it: a shop over the firm body of lane C1 (its staff, union, bank and failure:
/// `firms::firm_body`). `Retailer` above is the same shop over the stand-in body the lane tests with.
pub struct FirmRetailer;

impl Kind for FirmRetailer {
    fn name(&self) -> &'static str {
        Retailer.name()
    }
    fn version(&self) -> &'static str {
        VERSION
    }
    fn doc(&self) -> &'static str {
        Retailer.doc()
    }
    fn manifest(&self) -> Value {
        manifest()
    }
    fn cadence(&self, ctx: &Ctx) -> i64 {
        Retailer.cadence(ctx)
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        Retailer.first_wake(ctx)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        make(ctx, crate::firms::firm_body::FirmBody::new(ctx, crate::firms::firm_body::Trade::Shop)?)
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore_with::<crate::firms::firm_body::FirmBody>(saved)
    }
}

/// A shop over another body (lane C1's, at integration): its kind is made the same way.
pub fn make<B: Body>(ctx: &Ctx, body: B) -> Result<Box<dyn Actor>, String> {
    Ok(Box::new(ShopActor(Stepper::new(Shop::new(ctx, Params::read(ctx)?, body)))))
}
pub fn restore_with<B: Body>(saved: Value) -> Result<Box<dyn Actor>, String> {
    Ok(Box::new(ShopActor(Stepper::<Shop<B>>::restore(saved)?)))
}


#[cfg(test)]
mod tests;
