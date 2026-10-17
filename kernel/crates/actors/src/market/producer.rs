//! firm.producer: a factory, after Lengnick (2013), with inputs, wholesale and exports (phase B). Ported from
//! participants/src/behaviour/producer.ts (0.9.0) and rewritten for Rust; documented in docs/behaviour/producer.md.
//! Version 0.10.0: its wholesale price is formed from supply and demand, costs and the rivals it has been shown (prices.rs,
//! with imports among the rivals), and its exports follow what the outside world will buy of it, not a quota fixed at
//! the town's opening output (docs/risks.md ME-15).
//!
//! A factory's workers' hours turn inputs into goods (the task `make`, at its works); it keeps inputs for the next
//! month's production by an (s, S) rule, sells goods wholesale to whoever orders, and ships what it does not need to keep
//! to the world market under its standing offer. **Exports (native).** The outside is a market far larger than the town
//! and takes goods at the world price (a small open economy is a price-taker abroad: Mundell 1963, Heckscher-Ohlin). The
//! offer states the most the outside will take in a month; it does not split it among sellers, and a seller cannot see
//! what the others have sent (no god's view). So a factory ships what it holds beyond what its own customers need, up to
//! the room it has found; the outside pays for what it takes up to its appetite and sends the rest back unpaid; the
//! factory learns its room from what comes back and probes it upward when nothing does (`ExportRoom`: a quantity
//! adjustment by trial). A new factory finds room as an old one does; a factory exports as much as it can profitably
//! make, which is what lets the town's employment base respond to its costs. It exports only while the world price
//! covers its marginal cost (inputs and the hours of making), as a seller who is not irrational does.
//!
//! Like the shop it is generic over its body (body.rs): its employer, bank, union and failure dealings are lane C1's.

use super::body::{lift, Body, BodyThen, House, PlainBody, Review, Stage, Standing, Surplus, Want, Wind};
use super::lengnick::{distribute, move_wage, pay_out, Expectation, From as Payer, Lengnick, WageMonth};
use super::prices::{move_price, rivals_seen, ExportRoom, Level, PriceFigures, Signals};
use super::retailer::{fact, Adjust};
use super::trade::{self, decline, decline_on_terms, fill, goods_prices, held, order, price_list, send_back, Committed, Deliveries, Order, OrderBook, Ordering, Payables, SellingTerms, TradeThen};
use crate::common::{data, money_words, out_of_time, own_account, published_price, team, withdraw, Book, Fields, Pace, DAY, MONTH};
use crate::steps::{arg, because, call, json, say, text, Done, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_sight::calls::Call;
use oikos_sight::{LookRequest, OutcomeStatus, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const MANIFEST: &str = include_str!("../../../../../participants/manifests/firm.producer.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Params {
    pub works: String,
    pub workplace: String,
    pub max_staff: i64,
    pub task: String,
    pub output: String,
    pub per_unit: BTreeMap<String, i64>,
    pub labour_per_unit: i64,
    pub supplier: String,
    pub market: String,
    pub wage: i64,
    pub period: i64,
    pub notice_days: i64,
    pub adjust: Adjust,
    pub working_day: i64,
    pub work_days: i64,
    pub look_at: i64,
    pub look_days: i64,
    pub price: i64,
    pub min_order: i64,
    pub terms_days: i64,
    pub terms_stop_after_days: i64,
    pub terms_claim_after_days: i64,
    pub credit: bool,
    pub builder: String,
    pub premises_sale_bps: i64,
    /// How far an exporter probes its room upward when the outside sent nothing back (bps of what was taken).
    pub export_probe_bps: i64,
    pub lengnick: Lengnick,
    pub figures: PriceFigures,
}

impl Params {
    pub fn read(ctx: &Ctx) -> Result<Params, String> {
        let mut per = BTreeMap::new();
        per.insert("inputs".to_string(), 10);
        let p = Params {
            works: ctx.param("works", String::new())?,
            workplace: ctx.param("workplace", String::new())?,
            max_staff: ctx.param("max_staff", 40)?,
            task: ctx.param("task", "make".to_string())?,
            output: ctx.param("output", "goods".to_string())?,
            per_unit: ctx.param("per_unit", per)?,
            labour_per_unit: ctx.param("labour_per_unit", 5400)?,
            supplier: ctx.need("supplier", "firm.producer")?,
            market: ctx.need("market", "firm.producer")?,
            wage: ctx.param("wage", 150_000)?,
            period: ctx.param("period", 14 * DAY)?,
            notice_days: ctx.param("notice_days", 14)?,
            adjust: ctx.param("adjust", Adjust { smooth_months: 3, hiring_cost_weeks: 8, hours_step_bps: None })?,
            working_day: ctx.param("working_day", 8 * 3600)?,
            work_days: ctx.param("work_days", 5)?,
            look_at: ctx.param("look_at", 0)?,
            look_days: ctx.param("look_days", 5)?,
            price: ctx.param("price", 6000)?,
            min_order: ctx.param("min_order", 50)?,
            terms_days: ctx.param("terms_days", 0)?,
            terms_stop_after_days: ctx.param("terms_stop_after_days", 7)?,
            terms_claim_after_days: ctx.param("terms_claim_after_days", 30)?,
            credit: ctx.param("credit", true)?,
            builder: ctx.param("builder", String::new())?,
            premises_sale_bps: ctx.param("premises_sale_bps", 5000)?,
            export_probe_bps: ctx.param("export_probe_bps", 1000)?,
            lengnick: Lengnick::read(ctx)?,
            figures: PriceFigures::read(ctx)?,
        };
        Ok(p)
    }
    fn work_day(&self, t: i64) -> bool {
        t.div_euclid(DAY).rem_euclid(7) < self.work_days
    }
    fn monthly_units(&self, workers: i64) -> i64 {
        workers * self.working_day * self.work_days * 30 / 7 / self.labour_per_unit.max(1)
    }
    fn hourly(&self, wage: i64) -> i64 {
        let secs = (self.period / DAY) * self.work_days * self.working_day / 7;
        (wage * 3600 + secs - 1).div_euclid(secs.max(1))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Then {
    Trade(TradeThen),
    Body(BodyThen),
    /// An order filled: on terms, billed when the goods went; refused, the whole order is refunded.
    Filled { order: Order, q: i64, t: i64 },
    /// An input order sent.
    Bought { kind: String, quantity: i64, seller_account: String, cost: i64, terms: bool },
    /// The day's making.
    Made { units: i64, share: i64, crew: Vec<String>, t: i64, started: i64 },
    /// A shipment to the outside.
    Exported { q: i64 },
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

#[derive(Serialize, Deserialize)]
#[serde(bound = "B: Body")]
pub struct Factory<B: Body> {
    me: String,
    p: Params,
    book: Book,
    body: B,
    expectation: Expectation,
    orders: OrderBook,
    payables: Payables,
    deliveries: Deliveries,
    committed: Committed,
    room: ExportRoom,
    invoices_read: usize,
    /// Makings ordered whose crew has not had the hours for them yet: (units, by).
    making: Vec<(i64, i64)>,
    on_order: BTreeMap<String, i64>,
    order_qty: BTreeMap<String, (String, i64)>,
    used: BTreeMap<String, i64>,
    used_day: i64,
    pace: Pace,
    wage: i64,
    price: i64,
    published_price: i64,
    price_why: String,
    month: i64,
    /// This month: units ordered by customers, and what we could not fill of them.
    domestic: i64,
    short: i64,
    quota: i64,
    month_start: i64,
    last_demand: i64,
    last_domestic: i64,
    last_short: i64,
    full_months: i64,
    headcount: i64,
    headcount_why: String,
    next_losing_note: i64,
    next_shipment: i64,
    account_now: Option<String>,
}

impl<B: Body> Factory<B> {
    pub fn new(ctx: &Ctx, p: Params, body: B) -> Self {
        let me = ctx.entity.clone();
        let sells = (p.terms_days > 0).then_some(SellingTerms { days: p.terms_days, stop_after_days: p.terms_stop_after_days, claim_after_days: p.terms_claim_after_days });
        Factory {
            expectation: Expectation::new(p.adjust.smooth_months, None),
            orders: OrderBook::new(&me, None, sells),
            payables: Payables::new(&me),
            deliveries: Deliveries::default(),
            committed: Committed::new(),
            room: ExportRoom::default(),
            invoices_read: 0,
            making: vec![],
            on_order: BTreeMap::new(),
            order_qty: BTreeMap::new(),
            used: BTreeMap::new(),
            used_day: -1,
            pace: Pace::new(p.labour_per_unit),
            wage: p.wage,
            price: p.price,
            published_price: -1,
            price_why: String::new(),
            month: -1,
            domestic: 0,
            short: 0,
            quota: 0,
            month_start: -1,
            last_demand: -1,
            last_domestic: 0,
            last_short: 0,
            full_months: 0,
            headcount: -1,
            headcount_why: String::new(),
            next_losing_note: 0,
            next_shipment: 0,
            account_now: None,
            body,
            book: Book::new(),
            p,
            me,
        }
    }

    fn premises_of(&self, pic: &Picture) -> Option<(String, String, String)> {
        sites(pic).find_map(|c| c.structure.as_ref().filter(|s| s.structure == self.p.works).map(|s| (s.structure.clone(), s.structure_type.clone(), c.cell.clone())))
    }
    fn room_at_work(&self, pic: &Picture, staff: i64) -> i64 {
        let sp = sites(pic).find(|c| c.structure.as_ref().is_some_and(|s| s.structure == self.p.works)).and_then(|c| c.structure.as_ref().and_then(|s| s.spaces.iter().find(|x| x.kind == "workplace").cloned()));
        match sp {
            Some(sp) => i64::from(sp.capacity) - i64::from(sp.count).max(staff),
            None => self.p.max_staff,
        }
    }
    /// The world market's standing offer for what we make, if one is open: its latest, with its record.
    fn export_offer(&self, t: i64) -> Option<(String, Value)> {
        self.book
            .open("buying_offer")
            .filter(|r| r.speaks_for.as_deref() == Some(self.p.market.as_str()) && data(r).s("kind") == Some(self.p.output.as_str()) && data(r).i("until").unwrap_or(i64::MAX) > t)
            .max_by(|a, b| a.at.cmp(&b.at).then_with(|| crate::common::filed_before(&b.id, &a.id)))
            .map(|r| (r.id.clone(), data(r).clone()))
    }
}

fn sites(pic: &Picture) -> impl Iterator<Item = &oikos_sight::SiteCell> {
    pic.channels.values().flat_map(|c| match c {
        Seen::Sites { cells, .. } => cells.iter(),
        _ => [].iter(),
    })
}

impl<B: Body> Plan for Factory<B> {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, cx: &mut Cx) {
        self.book.absorb(pic);
        self.body.absorb(pic, &self.book, cx);
        let acct = own_account(pic);
        let account = acct.as_ref().map(|a| a.account.as_str());
        self.orders.take(pic, account);
        self.committed.take(pic, account);
        self.payables.take(&self.book);
        for d in self.deliveries.take(&self.book, &self.me) {
            if let Some((kind, q)) = self.order_qty.remove(&d.order) {
                let e = self.on_order.entry(kind).or_insert(0);
                *e = (*e - q).max(0);
            }
        }
        // What the outside sent back unpaid is what we learn our room from.
        let notes: Vec<_> = self.book.all("invoice_declined").cloned().collect();
        for n in notes.iter().skip(self.invoices_read) {
            if crate::common::addressed_to(n).iter().any(|a| *a == self.me) {
                if let Some(back) = data(n).i("returned") {
                    self.room.sent_back(back);
                }
            }
        }
        self.invoices_read = notes.len();
    }

    fn until(&self, pic: &Picture) -> Option<i64> {
        (self.p.look_at > 0).then(|| crate::common::next_look(pic.t, self.p.look_at, self.p.look_days))
    }

    fn looks(&mut self, _: &Picture) -> Vec<LookRequest> {
        vec![]
    }

    fn then(&mut self, tok: &Then, done: Done, cx: &mut Cx) -> Vec<Step<Then>> {
        match tok {
            Then::Trade(t) => trade::then(t, done, &mut self.orders, cx),
            Then::Body(b) => lift(self.body.then(b, done, cx), Then::Body),
            Then::Filled { order, q, t } => match done {
                Done::Outcome(o) if o.status == OutcomeStatus::Applied => {
                    if order.terms.is_some() && *q > 0 {
                        self.orders.bill(order, *q, *t);
                    }
                    vec![]
                }
                Done::Outcome(_) if *q > 0 => {
                    let Some(acct) = self.account_now.clone() else { return vec![] };
                    trade::then(&TradeThen::DeliveryRefused { order: order.clone(), from_at: self.p.works.clone(), pay_from: acct }, done, &mut self.orders, cx)
                }
                _ => vec![],
            },
            Then::Bought { kind, quantity, seller_account, cost, terms } => {
                let id = match done {
                    Done::Outcome(o) => o.created.as_ref().and_then(|c| c.get("order")).cloned(),
                    _ => None,
                };
                match id {
                    Some(id) => {
                        self.order_qty.insert(id, (kind.clone(), *quantity));
                    }
                    None => {
                        let e = self.on_order.entry(kind.clone()).or_insert(0);
                        *e = (*e - quantity).max(0);
                        if !terms {
                            self.committed.undo(seller_account, *cost);
                        }
                    }
                }
                vec![]
            }
            Then::Made { units, share, crew, t, started } => {
                if let Done::Outcome(o) = done {
                    if o.status == OutcomeStatus::Applied {
                        self.pace.done(crew, t.div_euclid(DAY));
                        return vec![];
                    }
                    self.pace.refused(o, *units, crew);
                    match out_of_time(o) {
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
                        None => {}
                    }
                }
                self.making.retain(|m| !(m.0 == *units && m.1 > *started));
                for w in crew {
                    let u = self.used.get(w).copied().unwrap_or(0);
                    self.used.insert(w.clone(), (u - share).max(0));
                }
                vec![]
            }
            Then::Exported { q } => {
                if let Done::Outcome(o) = done {
                    if o.created.as_ref().is_none_or(|c| !c.contains_key("invoice")) {
                        self.room.not_shipped(*q); // not shipped after all
                    }
                } else {
                    self.room.not_shipped(*q);
                }
                vec![]
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        self.run(pic, cx)
    }
}

impl<B: Body> Factory<B> {
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
            let w = Wind { pic, book: &self.book, acct: a, stage: Stage::Closed, premises: where_, sale_price: worth.map(|w| w * self.p.premises_sale_bps / 10_000), paid_suppliers: 0, staying: false };
            return lift(self.body.wind_up(&w, cx), Then::Body);
        }
        let Some(acct) = acct else { return steps };
        if self.body.winding_due(t) {
            let (mut owed, paid) = self.payables.settle::<Then>(t, &acct.account, acct.balance, Some(&mut self.committed), cx);
            let w = Wind { pic, book: &self.book, acct: &acct, stage: Stage::Due, premises: None, sale_price: None, paid_suppliers: paid, staying: false };
            owed.extend(lift(self.body.wind_up(&w, cx), Then::Body));
            return owed;
        }
        let mut trading = self.body.standing() == Standing::Trading;
        let workers = self.body.workers(&self.book, t);
        let nw = workers.len() as i64;
        let offer_now = self.export_offer(t);
        if self.last_demand < 0 {
            let first = self.book.open("buying_offer").find(|r| r.speaks_for.as_deref() == Some(self.p.market.as_str()) && data(r).s("kind") == Some(self.p.output.as_str()));
            let share = first.and_then(|r| data(r).get("quantities").and_then(|q| q.get(&me)).and_then(Value::as_i64));
            self.last_demand = share.unwrap_or_else(|| self.p.monthly_units(nw));
        }
        if self.headcount < 0 {
            self.headcount = nw;
        }
        if self.month_start < 0 {
            self.month_start = acct.balance;
        }
        let supply = goods_prices(&self.book, &self.p.supplier);
        let input_cost: i64 = self.p.per_unit.iter().map(|(k, q)| q * supply.prices.get(k).copied().unwrap_or(0)).sum();
        let marginal_cost = input_cost + (self.p.hourly(self.wage) * self.p.labour_per_unit + 3599).div_euclid(3600);
        let stock = held(pic, &self.p.works, &self.p.output);
        let export_unit = offer_now.as_ref().map_or(0, |(_, d)| d.i("unit_price").unwrap_or(0));
        let export_share = offer_now.as_ref().map_or(0, |(_, d)| {
            let q = d.i("quantity").unwrap_or(0);
            self.room.share(q, d.get("quantities").and_then(|x| x.get(&me)).and_then(Value::as_i64))
        });
        let known = self.last_domestic + export_share;
        let home_ok = self.price >= input_cost;
        // The world price must cover what it costs us to make a unit abroad-bound (inputs and the hours of making).
        let abroad_ok = export_unit >= marginal_cost;
        let sellable = if home_ok { self.last_domestic } else { 0 } + if abroad_ok { export_share } else { 0 };
        let trade_units = if known > 0 { sellable } else { self.last_demand.max(0) };
        let fetches = if sellable > 0 { ((if home_ok { self.last_domestic * self.price } else { 0 }) + if abroad_ok { export_share * export_unit } else { 0 }) / sellable } else { self.price };
        let losing = input_cost > 0 && known > 0 && sellable == 0;
        let sellable_bps = if known > 0 { sellable * 10_000 / known } else { 10_000 };

        let m = t.div_euclid(MONTH);
        if self.month < 0 {
            self.month = m;
        }
        if m != self.month && trading {
            self.month = m;
            self.last_demand = self.domestic + self.quota;
            self.last_domestic = self.domestic;
            self.last_short = self.short;
            self.domestic = 0;
            self.short = 0;
            self.room.month_end(self.p.export_probe_bps);
            let mut rng = cx.rng(&format!("month-{m}"));
            let mut why: Vec<String> = vec![];
            let (unfilled, posting) = self.body.vacancies(&self.book, t);
            let (wage, full, w_why) = move_wage(&self.p.lengnick, &mut rng, self.wage, WageMonth { unfilled, posting, staffed: nw > 0, full_months: self.full_months }, &money);
            self.wage = wage;
            self.full_months = full;
            why.extend(w_why);
            // Rivals: other wholesalers of the same goods, and the world's own list of imports.
            let rivals = rivals_seen(&self.book, &me, &self.p.output, Level::Wholesale, t, self.p.figures.rival_days * DAY);
            let moved = move_price(
                &self.p.lengnick,
                &self.p.figures,
                &mut rng,
                &Signals { price: self.price, marginal_cost, demand: self.last_domestic.max(0), turned_away: self.last_short, stock, can_supply: None, rivals: &rivals },
                &money,
            );
            self.price = moved.price;
            if let Some(w) = moved.why {
                self.price_why = w;
            }
            let expected = self.expectation.expect(self.last_demand);
            let l = self.p.lengnick;
            let low = stock * 10_000 < l.phi_low_bps * expected;
            let high = stock * 10_000 > l.phi_high_bps * expected;
            let demand_words = if self.p.adjust.smooth_months > 1 { format!("the demand we expect ({expected} a month; last month {})", self.last_demand) } else { format!("last month's demand ({})", self.last_demand) };
            let surplus = if high && nw > 0 {
                Surplus::OverStocked
            } else if low && nw < self.p.max_staff && !losing {
                Surplus::UnderStocked
            } else {
                Surplus::OverStaffed
            };
            let r = Review { needed: nw, trade: demand_words, notice_days: self.p.notice_days, expected, last_demand: self.last_demand, surplus };
            let staffed = self.body.review(&self.book, t, &r, nw, cx);
            self.headcount = staffed.headcount;
            self.headcount_why = format!("{}{}", staffed.why, if why.is_empty() { String::new() } else { format!("; {}", why.join("; ")) });
            steps.extend(lift(staffed.steps, Then::Body));
            let staff_for = nw.max(self.headcount);
            let bill = staff_for * self.wage * MONTH / self.p.period;
            let buffer = bill + self.p.monthly_units(staff_for) * input_cost + bill * l.chi_bps / 10_000 + self.payables.owing();
            let paid = if let Some(strain) = self.body.strained(&self.book, t) {
                steps.push(because(format!("Month's end: {strain}, so nothing is paid out to our shareholders."), vec![]));
                0
            } else {
                let (s, paid) = pay_out::<Then>(&self.book, &me, &Self::payer(&acct), acct.balance, buffer, if self.month_start < 0 { 0 } else { acct.balance - self.month_start }, &format!("a month's wages and inputs, and {}% of the wage bill", super::lengnick::percent(l.chi_bps)), &money);
                steps.extend(s);
                paid
            };
            self.month_start = acct.balance - paid;
        }

        let months = self.body.months_in_hand(&self.book);
        let can_post = trading && acct.balance >= months * ((nw + 1) * self.wage * MONTH / self.p.period) && self.room_at_work(pic, nw) > 0;
        let want = Want {
            target: if trading { self.p.max_staff.min(self.headcount) } else { 0 },
            wage: self.wage,
            can_post,
            why: format!("Short of this month's headcount ({nw} of {}{}): posting a job at {} every {} days.", self.headcount, self.headcount_why, money(self.wage), self.p.period / DAY),
        };
        let dealt = self.body.dealings(&House { pic, book: &self.book, acct: &acct, want, trading, workers: workers.len() }, cx);
        steps.extend(lift(dealt.steps, Then::Body));
        if let Some(rise) = dealt.wage_rise_bps {
            self.wage = self.wage * (10_000 + rise) / 10_000;
        }
        if let Some(cap) = dealt.headcount_cap {
            self.headcount = self.headcount.min(cap);
        }
        if dealt.began {
            trading = false;
        }

        if self.price != self.published_price && trading {
            let old: Vec<String> = self.book.open("price_list").filter(|r| r.speaks_for.as_deref() == Some(&me)).map(|r| r.id.clone()).collect();
            self.published_price = self.price;
            let mut prices = BTreeMap::new();
            prices.insert(self.p.output.clone(), self.price);
            let words = format!(
                "Wholesale {} from {me}: {} each, at least {} to an order, delivered. Order and pay with the order{}.",
                self.p.output,
                money(self.price),
                self.p.min_order,
                if self.p.terms_days > 0 { format!(", or order on terms and pay within {} days of delivery", self.p.terms_days) } else { String::new() }
            );
            let mut extra = json!({ "min_order": self.p.min_order });
            if self.p.terms_days > 0 {
                extra["terms_days"] = json!(self.p.terms_days);
            }
            let mut calls: Vec<Call> = old.iter().map(|id| withdraw(id, Some("Superseded."))).collect();
            calls.push(price_list(&prices, &acct.account, &words, extra, Some(&me), None, true));
            let why = if old.is_empty() { "Publishing our wholesale price.".to_string() } else if self.price_why.is_empty() { format!("Our wholesale price is now {}.", money(self.price)) } else { self.price_why.clone() };
            steps.push(because(why, calls));
        }

        // ---- what to make, and the inputs to buy for it ----
        let expected_units = ((if self.expectation.level() >= 0 { self.expectation.level() } else { self.last_demand }) * sellable_bps / 10_000).max(0);
        let top_of_band = (self.p.lengnick.phi_high_bps * expected_units + 9999).div_euclid(10_000);
        let plan = if losing { 0 } else { self.p.monthly_units(nw).min(expected_units + (top_of_band - stock).max(0)) };
        if trading {
            let keep = nw.max(self.headcount) * self.wage;
            steps.extend(self.payables.pay::<Then>(t, &acct.account, acct.balance - self.committed.owed(), keep, Some(&mut self.committed), false, cx));
        }
        let mut spare = acct.balance - self.committed.owed() - self.payables.pending(t) - nw.max(self.headcount) * self.wage;
        let mut on_terms = 0_i64; // ordered on terms this wake (not yet in what we owe)
        let kinds: Vec<(String, i64)> = self.p.per_unit.iter().map(|(k, q)| (k.clone(), *q)).collect();
        for (kind, per) in kinds {
            if !trading {
                break; // winding up: no more buying
            }
            let have = held(pic, &self.p.works, &kind) + self.on_order.get(&kind).copied().unwrap_or(0);
            let s = plan * per;
            let up = plan * per * 3 / 2;
            let Some(unit) = supply.prices.get(&kind).copied() else { continue };
            let Some(sacct) = supply.account.clone() else { continue };
            if have >= s {
                continue;
            }
            let least = supply.min_order.unwrap_or(1); // at least what the supplier sells in one order
            let wanted = (up - have).max(least);
            let terms = if self.p.credit && supply.terms_days.is_some() && !self.payables.behind(&self.p.supplier, t) { supply.terms_days.unwrap_or(0) } else { 0 };
            let room = if terms > 0 { (trade_units * fetches * terms / 30 - self.payables.owing() - on_terms).max(0) } else { 0 };
            let q = wanted.min((if terms > 0 { spare + room } else { spare }).div_euclid(unit.max(1)));
            if q < least || q <= 0 {
                continue;
            }
            if terms > 0 {
                on_terms += q * unit; // (the order costs no cash now: it uses the room)
            } else {
                spare -= q * unit;
                self.committed.add(&sacct, q * unit, t);
            }
            *self.on_order.entry(kind.clone()).or_insert(0) += q;
            let why = format!(
                "Our {kind} ({have} with what's on order) are below a month's production ({s}, for the {expected_units} {} we expect to sell{}): ordering {q}{}{}.",
                self.p.output,
                if plan < self.p.monthly_units(nw) { String::new() } else { ", as many as our staff can make".to_string() },
                if terms > 0 { format!(", on {}'s terms (to pay within {terms} days of delivery)", self.p.supplier) } else { String::new() },
                if q < wanted { ", as many as we can pay for".to_string() } else { String::new() }
            );
            let mut st = order::<Then>(
                &Ordering { me: me.clone(), seller: self.p.supplier.clone(), seller_account: sacct.clone(), kind: kind.clone(), quantity: q, unit_price: unit, to: None, at: self.p.works.clone(), from: acct.account.clone(), why, retry_of: None, for_days: None, terms: (terms > 0).then_some(terms) },
                cx,
            );
            st.then = Some(Then::Bought { kind: kind.clone(), quantity: q, seller_account: sacct, cost: q * unit, terms: terms > 0 });
            steps.push(st);
        }
        if losing && trading && t >= self.next_losing_note {
            self.next_losing_note = t + MONTH;
            steps.push(because(format!("A {} fetches {} on the trade we have, and its inputs cost {}: buying none, and making only from what we hold.", self.p.output, money(fetches), money(input_cost)), vec![]));
        }

        // ---- the day's making ----
        let day = t.div_euclid(DAY);
        if day != self.used_day {
            self.used_day = day;
            self.used.clear();
        }
        let present: Vec<String> = {
            let mut v = std::collections::BTreeSet::new();
            for c in sites(pic).filter(|c| c.structure.as_ref().is_some_and(|s| s.structure == self.p.works)) {
                for sp in c.structure.iter().flat_map(|s| s.spaces.iter()).filter(|sp| sp.kind == "workplace") {
                    for o in sp.occupants.iter().flatten().filter(|o| workers.contains(o)) {
                        v.insert(o.clone());
                    }
                }
            }
            v.into_iter().collect()
        };
        let enough = stock * 10_000 > self.p.lengnick.phi_high_bps * self.last_demand;
        if self.p.work_day(t) && !present.is_empty() && !enough && trading {
            let (crew, each) = team(&present, |w| (self.p.working_day * self.body.hours_bps(w, t) / 10_000 - self.used.get(w).copied().unwrap_or(0)).max(0));
            let per_unit = self.pace.per_unit(&crew);
            let by_hours = each * crew.len() as i64 / per_unit;
            let by_inputs = self.p.per_unit.iter().map(|(k, q)| held(pic, &self.p.works, k) / q.max(&1)).min().unwrap_or(0);
            let in_flight: i64 = self.making.iter().filter(|x| x.1 > t).map(|x| x.0).sum();
            let room = ((self.p.lengnick.phi_high_bps * self.last_demand + 9999).div_euclid(10_000) - stock - in_flight).max(0);
            let units = by_hours.min(by_inputs).min(room);
            if units > 0 && !crew.is_empty() {
                let share = (units * per_unit + crew.len() as i64 - 1).div_euclid(crew.len() as i64);
                for w in &crew {
                    *self.used.entry(w.clone()).or_insert(0) += share;
                }
                let by = t + 2 * share; // (its crew may be busy first: twice the hours it needs, to be safe)
                self.making.retain(|x| x.1 > t);
                self.making.push((units, by));
                let why = format!(
                    "The day's work: {} of our workers making {units} {}{}{}.",
                    crew.len(),
                    self.p.output,
                    if by_inputs < by_hours { " (all our inputs allow)" } else { "" },
                    if crew.len() < present.len() { " (the others here have done a day's work already)" } else { "" }
                );
                let mut st = because(why, vec![call("work", vec![("task", Some(arg(&self.p.task))), ("units", Some(text(units.to_string()))), ("at", Some(arg(&self.p.works))), ("by", Some(json(json!(crew))))])]);
                st.then = Some(Then::Made { units, share, crew: crew.clone(), t, started: t });
                steps.push(st);
            }
        }

        // ---- orders: filled from stock, oldest first ----
        let mut left = stock;
        let due = self.orders.due(&self.book, t, |_| true);
        for o in &due.stopped {
            steps.push(decline_on_terms::<Then>(o, &me, &format!("An order on our terms from {}, which has not paid what it owed us: declining it (cash with order, if it wants the goods).", o.buyer)));
        }
        steps.extend(self.orders.collect::<Then>(t, &acct.account, cx));
        for o in &due.paid {
            let ok = o.kind == self.p.output && o.unit_price >= self.price && o.quantity >= self.p.min_order;
            let q = if ok { o.quantity.min(left) } else { 0 };
            left -= q;
            self.domestic += o.quantity;
            if ok {
                self.short += o.quantity - q;
            }
            let why = if !ok {
                format!(
                    "An order {}: refunding it.",
                    if o.kind != self.p.output { format!("for {}, which we don't sell", o.kind) } else if o.quantity < self.p.min_order { format!("for fewer than {}", self.p.min_order) } else { "below our price".to_string() }
                )
            } else if q == o.quantity {
                format!("An order paid in full: delivering {q} {}.", o.kind)
            } else {
                format!("An order paid in full: we have {q} of the {}; delivering them and refunding the rest.", o.quantity)
            };
            let mut st: Step<Then> = fill(o, q, &self.p.works, &acct.account, &why, cx);
            if q > 0 {
                st.then = Some(Then::Filled { order: o.clone(), q, t });
            }
            steps.push(st);
        }
        for o in &due.unpaid {
            steps.push(decline::<Then>(o, &me, "An order unpaid for a week: declining it."));
        }
        for (a, x) in self.orders.unclaimed(&self.book) {
            self.orders.refunded(&a);
            steps.push(send_back::<Then>(&a, x, &acct.account, cx));
        }

        // ---- exports: what we need not keep, to the outside under its offer ----
        if let Some((offer_id, d)) = &offer_now {
            self.quota = export_share;
            if t >= self.next_shipment {
                self.next_shipment = t + 7 * DAY;
                let l = self.p.lengnick;
                let keep = ((l.phi_low_bps + l.phi_high_bps) * self.last_domestic / 2 + 9999).div_euclid(10_000);
                let room = self.room.open(d.i("quantity").unwrap_or(0));
                let q = (left - keep).min(room);
                if q > 0 && abroad_ok {
                    let unit = d.i("unit_price").unwrap_or(0);
                    self.room.shipped(q);
                    let ship = call("goods", vec![("kind", Some(arg(&self.p.output))), ("quantity", Some(text(q.to_string()))), ("to", Some(arg(&self.p.market))), ("at", Some(arg(&self.p.market))), ("from_at", Some(arg(&self.p.works)))]);
                    let invoice = say(
                        "invoice",
                        &format!("Invoice: {q} {} at {} each, {}.", self.p.output, money(unit), money(q * unit)),
                        Say {
                            to: Some(vec![self.p.market.clone()]),
                            visible: Some(Visible::Only(vec![me.clone(), self.p.market.clone()])),
                            basis: Some(offer_id.clone()),
                            data: Some(json!({ "kind": self.p.output, "quantity": q, "from_at": self.p.works,
                                "outcome": { "money": { "to": acct.account, "amount": (q * unit).to_string(), "for": format!("{q} {} exported", self.p.output) } } })),
                            ..Default::default()
                        },
                    );
                    let mut st = because(
                        format!("Exporting: {q} {} we needn't keep (we keep {keep} for customers), to the world market under its offer at {} each; invoicing it.", self.p.output, money(unit)),
                        vec![],
                    );
                    st.lines.push(oikos_sight::calls::Line { bind: None, call: ship });
                    st.lines.push(oikos_sight::calls::Line { bind: Some("invoice".into()), call: invoice });
                    st.then = Some(Then::Exported { q });
                    steps.push(st);
                }
            }
        }
        steps
    }
}

/// The actor: the factory's plan as steps, with its body's beliefs for the truth audits.
pub struct FactoryActor<B: Body>(Stepper<Factory<B>>);

impl<B: Body> Actor for FactoryActor<B> {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> crate::Action {
        self.0.step(pic, cx)
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

/// firm.producer.
pub struct Producer;

pub fn manifest() -> Value {
    let mut m: Value = serde_json::from_str(MANIFEST).expect("the TS manifest");
    m["version"] = json!("0.10.0");
    let params = m["params"].as_object_mut().expect("params");
    let mut add = |k: &str, default: i64, unit: &str, what: &str| {
        params.insert(k.into(), json!({ "schema": { "type": "integer", "description": what }, "unit": unit, "default": default, "source": "placeholder" }));
    };
    add("price_adjust_bps", 5000, "bps", "how much of the imbalance of supply and demand a month's price step answers (docs/behaviour/prices.md)");
    add("rival_weight_bps", 2500, "bps", "how much of the gap to rivals' median price a month's step closes");
    add("clearance_cover_bps", 30_000, "bps", "stock beyond this share of a month's demand is cleared at a discount");
    add("clearance_floor_bps", 8000, "bps", "the lowest a clearance sale takes a price, as a share of marginal cost");
    add("rival_days", 60, "days", "how old a rival's price list may be and still count");
    add("export_probe_bps", 1000, "bps", "how far an exporter probes its room upward when the outside sent nothing back (docs/behaviour/boundary.md, Exports)");
    m
}

impl Kind for Producer {
    fn name(&self) -> &'static str {
        "firm.producer"
    }
    fn version(&self) -> &'static str {
        "0.10.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/producer.md"
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
        make(ctx, PlainBody::new(&ctx.entity))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore_with::<PlainBody>(saved)
    }
}

pub fn make<B: Body>(ctx: &Ctx, body: B) -> Result<Box<dyn Actor>, String> {
    Ok(Box::new(FactoryActor(Stepper::new(Factory::new(ctx, Params::read(ctx)?, body)))))
}
pub fn restore_with<B: Body>(saved: Value) -> Result<Box<dyn Actor>, String> {
    Ok(Box::new(FactoryActor(Stepper::<Factory<B>>::restore(saved)?)))
}

#[cfg(test)]
mod tests;
