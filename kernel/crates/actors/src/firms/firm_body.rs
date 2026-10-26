//! What a shop or a works does as an employer, a borrower, a party to a union and a firm that can fail: the body that lane
//! C2's retailer and producer run over (`market::body::Body`). In TS this was the middle of retailer.ts and producer.ts,
//! calling firms.ts's `Staffing`, `LabourPlan`, `Bargaining` and `WindingUp`, credit.ts's `Borrowing`, frictions.ts's
//! `Respondent` and orgwants.ts's `Org`; here those are lanes C1's and D's modules and this is the one place that puts them
//! together for a trading firm. The market side decides what the firm sells, buys and charges; this decides whom it
//! employs, what it does when it is short of money, how it answers a union and a venue, and when it closes.
//!
//! Decided fresh in the port (the rest is the TS rule step for step; docs/behaviour/firms.md, retailer.md, producer.md):
//! - **The month's staff decision is one function** (`review`), whichever side asks: a shop reads a surplus of hands against
//!   its serving, a works against its stock (`Surplus`), and both then cut hours before heads, hold staff through a dip,
//!   and let the most recent hire go only when a surplus has lasted what ending the job costs.
//! - **The organisation is made on the first wake**, because making one draws (`initiative`) and the draw needs the
//!   wake's streams; it has no wants book of its own to feed (a shop or a works never gives rise to a want of its own), so it
//!   keeps `NoWants`.
//! - **A character's size.** `Org` holds a character in ten-thousandths of a standard deviation; the respondent of lane D
//!   reads it in thousandths (`impl Character for Org`), rounded half away from nought.
//! - **Asked to put pay right, the firm's remedy takes the wake's streams** (`Answerer::remedy` was given `cx`): setting a
//!   wage order right is an act of the staff routine, which draws.

use super::decimal::{fmt_dec, round_div, scaled};
use super::orgwants::{Given, NoWants, Org, Spread};
use super::staffing::{termination_law, AdjustParams, LabourPlan, Staffing, StaffingOpts, Want as StaffWant};
use super::winding::{about_amount, Premises, State, WindingParams, WindingUp};
use super::{bargaining::Bargaining, landlord::practice_params};
use crate::common::book::Book;
use crate::common::{money_words, own_account, OwnAccount, DAY, MONTH};
use crate::finance::credit::Borrowing;
use crate::finance::frictions::{Answerer, Character, Matter, Respondent, Truth, VenueForms};
use crate::market::body::{Body, BodyThen, Dealt, House, Review, Stage, Staffed, Standing, Surplus, Wind};
use crate::market::lengnick::{distribute, From as Payer};
use crate::steps::{because, Done, Step};
use crate::{Belief, Cx, Ctx, Picture, WorldInfo};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Which trading firm this is: what differs in the staff it defaults to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trade {
    /// A shop: shop assistants, six days a week.
    Shop,
    /// A works: factory workers, five days a week.
    Works,
}

impl Trade {
    fn role(self) -> &'static str {
        match self {
            Trade::Shop => "shop assistant",
            Trade::Works => "factory worker",
        }
    }
    fn work_days(self) -> i64 {
        match self {
            Trade::Shop => 6,
            Trade::Works => 5,
        }
    }
}

/// The figures a firm's body reads of its parameters (names and defaults as retailer.ts and producer.ts had them).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    period: i64,
    notice_days: i64,
    adjust: AdjustParams,
    initiative: Option<bool>,
    owner_values: Option<BTreeMap<String, i64>>,
    values: BTreeMap<String, Spread>,
    org: Value,
}

/// A shop's or a works's body: its staff, union dealings, loans, failure and character.
#[derive(Serialize, Deserialize)]
pub struct FirmBody {
    p: Params,
    staffing: Staffing,
    labour: LabourPlan,
    winding: WindingUp,
    bargaining: Bargaining,
    borrowing: Borrowing,
    answering: Respondent,
    /// Its character and memory: made on the first wake (it draws).
    org: Option<Org<NoWants>>,
}

fn int(ctx: &Ctx, key: &str, default: i64) -> Result<i64, String> {
    ctx.param(key, default)
}

impl FirmBody {
    pub fn new(ctx: &Ctx, trade: Trade) -> Result<FirmBody, String> {
        let me = ctx.entity.as_str();
        let period = int(ctx, "period", 14 * DAY)?;
        let notice_days = int(ctx, "notice_days", 14)?;
        let adjust = {
            let a = ctx.params.get("adjust").filter(|a| a.is_object());
            let get = |k: &str| a.and_then(|a| a.get(k));
            AdjustParams {
                smooth_months: get("smooth_months").and_then(Value::as_i64).unwrap_or(3),
                hiring_cost_milliweeks: get("hiring_cost_weeks").and_then(|v| scaled(v, 1_000)).unwrap_or(8_000),
                hours_step_bps: get("hours_step_bps").and_then(Value::as_i64),
            }
        };
        let non_empty = |s: String| Some(s).filter(|s| !s.is_empty());
        let short_pay: Option<Value> = ctx.param("short_pay", None)?;
        let opts = StaffingOpts {
            workplace: non_empty(ctx.param("workplace", String::new())?),
            industry: non_empty(ctx.param("industry", String::new())?),
            registered_bps: Some(int(ctx, "registered_bps", 10_000)?),
            casual_bps: Some(int(ctx, "casual_bps", 0)?),
            day_wage: Some(int(ctx, "day_wage", 0)?),
            work_days: Some(int(ctx, "work_days", trade.work_days())?),
            week_days: Some(int(ctx, "look_days", 5)?),
            short_by_bps: short_pay.as_ref().and_then(|s| s.get("by_bps")).and_then(Value::as_i64),
            ..StaffingOpts::new(period, notice_days, &ctx.param("role", trade.role().to_string())?)
        };
        let lender: String = ctx.param("lender", String::new())?;
        let again = int(ctx, "borrow_again_days", 30)?;
        let winding = WindingParams {
            short_days: int(ctx, "short_days", 60)?,
            wind_up_days: int(ctx, "wind_up_days", 60)?,
            idle_days: int(ctx, "idle_days", 90)?,
            reprice_days: int(ctx, "reprice_days", 30)?,
            reprice_bps: int(ctx, "reprice_bps", 1_000)?,
        };
        let respond: Value = ctx.param("respond", json!({}))?;
        Ok(FirmBody {
            staffing: Staffing::new(me, opts),
            labour: LabourPlan::new(adjust, None),
            winding: WindingUp::new(me, winding),
            bargaining: Bargaining::new(me),
            borrowing: Borrowing::new(me, &lender, None, (again >= 0).then_some(again)),
            answering: Respondent::new(me, &respond, vec![VenueForms { notice: "hearing_notice".into(), response: "tribunal_response".into(), decision: "tribunal_order".into(), }], true),
            org: None,
            p: Params {
                period,
                notice_days,
                adjust,
                initiative: ctx.param("initiative", None)?,
                owner_values: ctx.param("owner_values", None)?,
                values: ctx.param("values", BTreeMap::new())?,
                org: ctx.param("org", json!({}))?,
            },
        })
    }

    /// A surplus of hands this month: the most recent hire goes once it has lasted what ending the job costs (the law's notice and
    /// redundancy pay, and taking someone on again), and till then the staff are kept and nobody who leaves is replaced.
    /// Whether one went.
    #[allow(clippy::too_many_arguments)]
    fn shed(&mut self, book: &Book, t: i64, cx: &mut Cx, steps: &mut Vec<Step<BodyThen>>, r: &Review, staff: i64, basis: &str, letting: &str, reason: &str) -> bool {
        let waits = self.labour.waits(termination_law(book).as_ref(), staff, self.staffing.last_hire_service(book, t), r.notice_days);
        let (go, lasted) = self.labour.month(true, waits);
        if go {
            let why = format!("{basis}{}: {letting}", if waits > 1 { format!(", as for {waits} months now") } else { String::new() });
            steps.extend(self.staffing.let_go(book, t, cx, &why, reason));
        } else {
            let keeping = if r.surplus == Surplus::OverStocked { "making less and keeping our people for now" } else { "keeping them for now" };
            steps.push(because(format!("{basis}: {keeping} ({lasted} of the {waits} months such a surplus must last before letting someone go is worth what it costs), and replacing nobody who leaves."), vec![]));
        }
        go
    }

    /// Its character and memory, made on the first wake.
    fn ensure_org(&mut self, cx: &mut Cx) {
        if self.org.is_none() {
            let g = Given {
                practice: vec![],
                initiative: self.p.initiative,
                owner_values: self.p.owner_values.clone(),
                values: self.p.values.clone(),
                org: Some(self.p.org.clone()),
                culture: practice_params(&cx.ctx.world.dials),
            };
            self.org = Some(Org::new(cx, g, NoWants::default()));
        }
    }
}

/// An organisation's character as the respondent of lane D reads it (thousandths of a standard deviation).
impl<W: super::orgwants::Wanting + Serialize + serde::de::DeserializeOwned> Character for Org<W> {
    fn lively(&self) -> bool {
        self.lively
    }
    fn keep(&self) -> i64 {
        round_div(i128::from(self.character.keep), 10) as i64
    }
    fn standing(&self) -> i64 {
        round_div(i128::from(self.character.standing), 10) as i64
    }
    fn pay_less(&self) -> i64 {
        round_div(i128::from(self.character.pay_less), 10) as i64
    }
    fn count(&mut self, what: &str) {
        Org::count(self, what, 1);
    }
    fn remember(&mut self, t: i64, what: &str, with: &str) {
        Org::remember(self, t, what, Some(with).filter(|w| !w.is_empty()), 1_000);
    }
}

/// What the firm's own books say of pay it is asked to put right, and how it puts it right.
struct Pay<'a> {
    staffing: &'a mut Staffing,
    book: &'a Book,
    account: &'a str,
}

impl Answerer<BodyThen> for Pay<'_> {
    fn truth(&mut self, m: &Matter, _from: &str, _book: &Book, _t: i64) -> Option<Truth> {
        match (&m.matter[..], &m.about) {
            ("underpaid", Some(about)) => Some(Truth { owed: Some(self.staffing.owed_short(about)), ..Default::default() }),
            _ => None,
        }
    }
    fn remedy(&mut self, cx: &mut Cx, m: &Matter, _from: &str, t: i64, why: &str, _basis: &str) -> Option<Vec<Step<BodyThen>>> {
        match (&m.matter[..], &m.about) {
            ("underpaid", Some(about)) if !self.account.is_empty() => { Some(self.staffing.pay_in_full(self.book, t, cx, self.account, about, why))}
            _ => None,
        }
    }
}

impl Body for FirmBody {
    fn set_workplace(&mut self, space: &str) {
        self.staffing.set_workplace(space);
    }
    fn absorb(&mut self, pic: &Picture, book: &Book, cx: &mut Cx) {
        self.ensure_org(cx);
        self.winding.recover(book);
        self.staffing.absorb(pic);
        let own = own_account(pic);
        self.winding.absorb(pic, own.as_ref().map(|a| a.account.as_str()));
    }

    fn workers(&self, book: &Book, t: i64) -> Vec<String> {
        self.staffing.workers(book, t)
    }

    fn hours_bps(&self, worker: &str, t: i64) -> i64 {
        self.staffing.hours_bps_at(worker, t)
    }

    fn vacancies(&self, book: &Book, t: i64) -> (bool, bool) {
        let posts = self.staffing.postings(book);
        (posts.iter().any(|x| t - x.at >= MONTH), !posts.is_empty())
    }

    fn strained(&self, book: &Book, t: i64, world: &WorldInfo) -> Option<String> {
        let staff = self.staffing.strained(book, t, world);
        if !staff.is_empty() {
            return Some(staff);
        }
        // (A debt recorded against us that stands unpaid.)
        let owing = self.winding.debts(book);
        if owing.is_empty() {
            return None;
        }
        let n = owing.len();
        let sum: i64 = owing.iter().map(|d| about_amount(d)).sum();
        Some(format!("{n} debt{} recorded against us {} unpaid ({})", if n > 1 { "s" } else { "" }, if n > 1 { "are" } else { "is" }, money_words(sum, world)))
    }

    fn review(&mut self, book: &Book, t: i64, r: &Review, workers: i64, cx: &mut Cx) -> Staffed {
        let n = workers;
        let trade = &r.trade;
        let mut steps: Vec<Step<BodyThen>> = vec![];
        // Hours before heads (docs/behaviour/firms.md): where the law lets us, a surplus of hands is met first by cutting
        // everyone's hours to what the trade needs, and only what that leaves is a surplus that ends a job. Trade back to
        // what the staff need: hours are restored.
        let target = match r.surplus {
            Surplus::OverStaffed if n > 0 => r.needed * 10_000 / n,
            Surplus::OverStocked if n > 0 => (n - 1) * 10_000 / n,
            _ => 10_000,
        };
        let hours = self.staffing.review_hours::<BodyThen>(book, t, cx, target, self.p.adjust.hours_step_bps.unwrap_or(1_000));
        steps.extend(hours.steps);
        let effective = n * hours.achieved / 10_000;
        let mut headcount = n;
        let mut why = String::new();
        match r.surplus {
            Surplus::OverStaffed => {
                if r.needed > n {
                    self.labour.month(false, 1);
                    headcount = n + 1;
                    why = format!(": {trade} needed {} hands to serve", r.needed);
                } else if r.needed < n && effective <= r.needed {
                    self.labour.month(false, 1);
                    steps.push(because(
                        format!("Month's end: {trade} needed {} hands to serve, and we have {n}: their hours are cut to match ({}% of the ordinary), and no one is let go.", r.needed, fmt_dec(hours.achieved, 100)),
                        vec![],
                    ));
                } else if r.needed < n {
                    let basis = format!("Month's end: {trade} needed {} hands to serve, and we have {n}", r.needed);
                    let went = self.shed(book, t, cx, &mut steps, r, n, &basis, "letting one go.", "Redundancy: there isn't the trade.");
                    headcount = if went { n - 1 } else { r.needed };
                } else {
                    self.labour.month(false, 1);
                }
            }
            Surplus::OverStocked => {
                if n > 0 && effective <= n - 1 {
                    self.labour.month(false, 1);
                    steps.push(because(
                        format!("Month's end: stock ({}) is above {trade}: making less, with everyone's hours cut to {}% of the ordinary, and no one let go.", r.stock, fmt_dec(hours.achieved, 100)),
                        vec![],
                    ));
                } else {
                    // Over stock: the works already makes nothing beyond the band (its people are paid and idle: labour held
                    // through the dip). Someone is let go only once that has lasted as long as ending the job and hiring again
                    // would cost; meanwhile nobody who leaves is replaced (docs/behaviour/firms.md, "Adjusting labour").
                    let basis = format!("Month's end: stock ({}) is above {trade}", r.stock);
                    self.shed(book, t, cx, &mut steps, r, n, &basis, "letting one worker go.", "Redundancy: we're making more than we sell.");
                    headcount = n - 1;
                }
            }
            Surplus::UnderStocked => {
                self.labour.month(false, 1);
                headcount = n + 1;
                why = format!(": at the month's end, stock ({}) was below {}% of {trade}", r.stock, fmt_dec(r.phi_low_bps, 100));
            }
        }
        Staffed { steps, headcount, why }
    }

    fn dealings(&mut self, h: &House, cx: &mut Cx) -> Dealt {
        let t = h.pic.t;
        let account = h.acct.account.as_str();
        let balance = h.acct.balance;
        let world = cx.ctx.world.clone();
        let usd = |n: i64| money_words(n, &world);
        let mut dealt = Dealt::default();
        let mut steps: Vec<Step<BodyThen>> = vec![];
        let mut wage = h.want.wage;
        self.ensure_org(cx);
        // Bargaining with a union (docs/behaviour/unions.md): a claim answered, an agreement's rise, a strike.
        let bargained = self.bargaining.steps::<BodyThen>(h.book, t, cx, &mut self.staffing, account, balance, h.takings_per_day, h.system_bps);
        steps.extend(bargained.steps);
        for rise in bargained.raised {
            wage = wage * (10_000 + rise) / 10_000;
            dealt.wage_rises.push(rise);
        }
        let org = self.org.as_mut().expect("made on the first wake");
        steps.extend(self.staffing.asked::<BodyThen, _>(h.book, t, cx, account, balance, org));
        // Asked to put pay right, told of a complaint, or ordered to: what our books say of it, and setting pay right from here on.
        let mut books = Pay { staffing: &mut self.staffing, book: h.book, account };
        steps.extend(self.answering.steps(cx, h.book, t, Some(account), balance, Some(&mut *org as &mut dyn Character), &mut books));
        let pay_less = if org.lively { org.character.pay_less } else { 0 };
        steps.extend(self.staffing.shortening::<BodyThen>(h.book, t, cx, account, balance, pay_less));
        // The staff: this month's headcount, hiring for it, or replacing someone who has left. (A rise agreed with the union
        // is the new wage: the money is judged again at it.)
        let months = self.months_in_hand(h.book);
        let can_post = h.want.postable && balance >= months * ((h.workers as i64 + 1) * wage * MONTH / self.p.period);
        let why = format!("Short of this month's headcount ({} of {}{}): posting a job at {} every {} days.", h.workers, h.want.headcount, h.want.headcount_why, usd(wage), self.p.period / DAY);
        steps.extend(self.staffing.routine(h.pic, h.book, cx, account, &StaffWant { target: h.want.target, wage, can_post, why: Some(why), ..Default::default() }));
        steps.extend(self.borrowing.steps(h.book, t, Some(account), cx));
        // Insolvent (it can't pay its debts as they fall due): wind up.
        let no_credit = !self.borrowing.can_apply(t) && !self.borrowing.waiting(t);
        let insolvent = self.winding.insolvent(t, h.book, cx, balance, no_credit, self.borrowing.impaired);
        let idle = if insolvent.is_some() { None } else { self.winding.idle(t, h.operator || h.workers > 0 || !self.staffing.offered(h.book, t).is_empty()) };
        if let Some(why) = insolvent {
            steps.extend(self.winding.begin(t, h.book, &mut self.staffing, &why, false));
            dealt.began = true;
        } else if let Some(why) = idle {
            steps.extend(self.winding.begin(t, h.book, &mut self.staffing, &why, true));
            dealt.began = true;
        } else {
            // Debts recorded against us (unpaid wages, a fine...), paid while we can, keeping the next pay period's wages; more
            // than we can pay, we ask our bank for the difference.
            steps.extend(self.winding.pay_debts(h.book, cx, account, balance, h.workers as i64 * wage));
            let owed: i64 = self.winding.debts(h.book).iter().map(|d| about_amount(d)).sum();
            if owed > balance && self.winding.state == State::Trading && self.borrowing.can_apply(t) {
                let amount = (owed - balance + 99_999).div_euclid(100_000) * 100_000;
                steps.push(self.borrowing.apply(
                    t,
                    account,
                    amount,
                    12,
                    "paying our debts",
                    &format!("We owe {} in debts recorded against us and have {}: asking our bank for the difference.", usd(owed), usd(balance)),
                    json!({}),
                    cx,
                ));
            }
        }
        // (Those we're keeping: someone already given notice is still staff until it runs out, and counting them made this let
        // everyone go, one after another within the moment, where the rule lets the most recent hire go.)
        let keeping = self.staffing.staying(h.book, t) as i64;
        if self.winding.state == State::Trading && keeping > 0 && balance < keeping * wage {
            // Short of the next pay period: first, working capital from our bank (two months' wages); while we wait to hear,
            // nobody is let go. Refused (or in default): the most recent hire goes, and this month's headcount with them (and
            // the next, until those we keep can be paid).
            let bill = h.workers as i64 * wage * MONTH / self.p.period;
            if self.borrowing.can_apply(t) {
                let amount = (2 * bill + 99_999).div_euclid(100_000) * 100_000;
                steps.push(self.borrowing.apply(
                    t,
                    account,
                    amount,
                    12,
                    "working capital",
                    &format!("We have {}, not enough for the next pay period ({} staff): asking our bank for {} of working capital before letting anyone go.", usd(balance), h.workers, usd(amount)),
                    json!({}),
                    cx,
                ));
            } else if !self.borrowing.waiting(t) {
                let s = self.staffing.let_go::<BodyThen>(
                    h.book,
                    t,
                    cx,
                    &format!("Can't cover the next pay period ({} for {keeping} staff), and no loan to be had: letting the most recent hire go.", usd(balance)),
                    "Redundancy: we can't cover the wage bill.",
                );
                if !s.is_empty() {
                    dealt.headcount_cap = Some(keeping - 1);
                    self.staffing.cash_layoff_at = Some(t);
                }
                steps.extend(s);
            }
        }
        dealt.steps = steps;
        dealt
    }

    fn standing(&self) -> Standing {
        match self.winding.state {
            State::Trading => Standing::Trading,
            State::WindingUp => Standing::Winding,
            State::Closed => Standing::Closed,
        }
    }

    fn winding_due(&self, t: i64) -> bool {
        self.winding.due(t)
    }

    /// After letting someone go because we could not pay them, we take nobody on until we hold the wages of those we would then
    /// have for as long as a surplus must last before a job is worth ending, where a month's is enough otherwise: the test to
    /// take someone on is never weaker than the test to keep them.
    fn months_in_hand(&self, book: &Book) -> i64 {
        if self.staffing.cash_layoff_at.is_some() && (self.p.adjust.smooth_months > 1 || self.p.adjust.hiring_cost_milliweeks > 0) {
            self.labour.waits(termination_law(book).as_ref(), 0, 0, self.p.notice_days)
        } else {
            1
        }
    }

    fn wind_up_owed(&mut self, book: &Book, t: i64, acct: &OwnAccount, cx: &mut Cx) -> (Vec<Step<BodyThen>>, i64) {
        self.staffing.wind_up_owed(book, t, cx, &acct.account, acct.balance)
    }

    fn keep(&mut self, cx: &mut Cx) {
        if let Some(org) = self.org.as_mut() {
            org.keep(cx, &BTreeMap::new());
        }
    }

    fn close(&mut self) {
        self.winding.state = State::Closed;
    }

    fn wind_up(&mut self, w: &Wind, cx: &mut Cx) -> Vec<Step<BodyThen>> {
        let world = cx.ctx.world.clone();
        let money = move |n: i64| money_words(n, &world);
        let me = cx.ctx.entity.clone();
        let from = Payer { account: &w.acct.account, custodian: &w.acct.custodian };
        match w.stage {
            // Closed: our premises, offered for sale (the proceeds go to what we still owe, then our shareholders).
            Stage::Closed => {
                let premises = w.premises.as_ref().map(|(structure, type_, cell)| Premises { structure: structure.clone(), type_: type_.clone(), cell: cell.clone(), });
                let distribute_to = |x: i64| { distribute::<BodyThen>(w.book, &me, &from, x, "The proceeds of our premises: to our shareholders by their shares", &money).0};
                self.winding.sell(w.pic, w.book, cx, &w.acct.account, w.acct.balance, premises.as_ref(), w.sale_price, &distribute_to)
            }
            // The winding-up is due: what is left of what we have, after our staff and suppliers, pays our other debts and then
            // goes to our shareholders.
            Stage::Due => {
                let distribute_to = |x: i64| { distribute::<BodyThen>(w.book, &me, &from, x, "Wound up: what's left, to our shareholders by their shares", &money).0};
                self.winding.finish(w.pic.t, w.book, cx, &w.acct.account, w.acct.balance - w.paid_suppliers, &distribute_to)
            }
        }
    }

    fn then(&mut self, _tok: &BodyThen, _done: Done, _cx: &mut Cx) -> Vec<Step<BodyThen>> {
        vec![]
    }

    fn beliefs(&self, book: &Book) -> Vec<Belief> {
        self.staffing.beliefs(book)
    }
}

#[cfg(test)]
mod tests;
