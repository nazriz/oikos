//! Money (citizen.ts): claims for support, borrowing, paying what is ordered or recorded against us, spending,
//! shopping and using things up (docs/behaviour/citizen.md, boundary.md, credit.md, trade.md, frictions.md).
//!
//! Ported from citizen.ts 3567-3659 (claims), 3802-3805 (borrowing), 3811-3820 (a tribunal's order to pay), 3842-3878
//! (rates, fines, bills, a loan for living costs), 3878-4018 (spending, shopping, using things up), 4350-4369 (bills a
//! month), 4902-4915 (what sellers advertise), with the borrower's half of credit.ts `Borrowing`, the buyer's half of
//! trade.ts (`order`, `goodsPrices`, `offerOf`, `Deliveries`) and of payments.ts (`supportLaw`, `forOutOfWork`,
//! `forHousehold`, `declarationFor`).
//!
//! Decided fresh (docs/port-guide.md, section 2): integers throughout, `Math.round` of a non-negative value as half
//! up; the support law in force is the latest made, of two made at once the later filed (TS compared ids as strings);
//! benefits are stopped in payment-id order (TS: the order granted); a shop priced at nothing is no shop.

use super::mind::{Choice, Decide, Event, Facts, Outcome, Treated, Way};
use super::params::Params;
#[allow(unused_imports)]
use super::person::{bound, inside, step_of_lines, Benefit, Person, Todo, Week};
use crate::common::{addressed_to, data, filed_before, kind, latest_by_speaker, money_words, part, structure_of, truthy, ClaimKey, Fields, Piece, DAY, MONTH};
use crate::papers::agreements::{commitment_of, parties_of, sign, template_of};
use crate::papers::citizen::{BenefitChange, BenefitClaim, Declared};
use crate::papers::finance::LoanApplication;
use crate::papers::market::Order;
use crate::steps::{arg, because, call, pay, say, text, Pay, Say, Visible};
use crate::Cx;
use oikos_sight::{CmpOp, Condition, LookRequest, Record, RecordBody, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

// ------------------------------------------------------------------ the support law, as a claimant reads it

/// A payment the published support law sets out (payments.ts `PaymentRule`), the claimant's half: who may have it,
/// and how its amount is reckoned only as far as what a claim must declare. (Lane C1's `rules::support` was not in
/// when this was written: its rule replaces this reading once it is.)
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PaymentRule {
    pub id: String,
    #[serde(default)]
    pub payer: Option<String>,
    #[serde(default)]
    pub who: Option<PaymentWho>,
    /// `{flat}`, `{share_bps, with_child_bps, ...}` or `{household, per_member, per_child}`, as the law writes it.
    #[serde(default)]
    pub amount: Value,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PaymentWho {
    #[serde(default)]
    pub from_age: Option<i64>,
    #[serde(default)]
    pub to_age: Option<i64>,
    #[serde(default)]
    pub out_of_work: Option<bool>,
    /// Turns on a record of contributions (its months: the office's to read).
    #[serde(default)]
    pub record: Option<Value>,
    #[serde(default)]
    pub income_under: Option<IncomeUnder>,
    #[serde(default)]
    pub no_other_pension: Option<bool>,
    #[serde(default)]
    pub children: Option<ChildrenRule>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct IncomeUnder {
    pub amount: i64,
    #[serde(default)]
    pub per: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ChildrenRule {
    pub least: i64,
    pub under_age: i64,
}

impl PaymentRule {
    /// For those out of work (a stopgap while looking).
    pub fn for_out_of_work(&self) -> bool {
        self.who.as_ref().and_then(|w| w.out_of_work) == Some(true)
    }
    /// Paid to a household, claimed by its head.
    pub fn for_household(&self) -> bool {
        self.amount.get("household").is_some()
    }
    fn on_record(&self) -> bool {
        self.who.as_ref().is_some_and(|w| w.record.is_some())
    }
}

/// The support law in force that we have seen: the latest published and not withdrawn (payments.ts `supportLaw`),
/// each payment's payer the law's speaker where it names none.
pub fn support_law(book: &crate::common::Book) -> Vec<PaymentRule> {
    let law = book
        .open("law")
        .filter(|r| data(r).get("payments").is_some_and(Value::is_array))
        .max_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
    let Some(l) = law else { return vec![] };
    data(l)["payments"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|x| serde_json::from_value::<PaymentRule>(x.clone()).ok())
        .map(|mut r| {
            if r.payer.is_none() {
                r.payer = l.speaks_for.clone();
            }
            r
        })
        .collect()
}

/// What a claimant knows of their own household, for the rules that turn on it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ClaimFacts {
    pub household_income: i64,
    pub household_members: i64,
    pub children_born_at: Vec<i64>,
    pub other_pension: bool,
}

/// What a claim for this payment must declare (none: the rule asks for nothing) (payments.ts `declarationFor`).
pub fn declaration_for(r: &PaymentRule, f: &ClaimFacts) -> Option<Declared> {
    let w = r.who.clone().unwrap_or_default();
    let mut d = Declared::default();
    let mut any = false;
    if w.income_under.is_some() {
        d.household_income = Some(f.household_income);
        d.household_members = Some(f.household_members);
        any = true;
    }
    if r.for_household() {
        d.household_members = Some(f.household_members);
        any = true;
    }
    if w.children.is_some() || r.amount.pointer("/per_child").is_some() || r.amount.get("with_child_bps").is_some_and(|x| !x.is_null()) {
        // (No children: the list is empty, which the paper leaves out; TS wrote `[]`.)
        d.children_born_at = f.children_born_at.clone();
        any = true;
    }
    if w.no_other_pension == Some(true) {
        d.other_pension = Some(f.other_pension);
        any = true;
    }
    any.then_some(d)
}

// ------------------------------------------------------------------ the borrower (credit.ts `Borrowing`)

/// A borrower's side: apply to the bank when short, take the loan offered (sign it, and ask the bank to pay the
/// repayments monthly), and remember a refusal for a while (60 days; one loan at a time until it is repaid).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Borrower {
    pub applied: Option<i64>,
    pub refused_at: Option<i64>,
    pub granted_at: Option<i64>,
    pub taken: BTreeSet<String>,
    pub repaying_until: Option<i64>,
    pub impaired: bool,
}

impl Borrower {
    fn waiting(&self, t: i64) -> bool {
        self.applied.is_some_and(|a| t - a < 14 * DAY) || self.granted_at.is_some_and(|g| t - g < DAY)
    }
    /// Whether we would apply now: a lender to ask, not waiting, not in default, not repaying, not refused lately.
    pub fn can_apply(&self, lender: &str, t: i64) -> bool {
        !lender.is_empty()
            && !self.waiting(t)
            && !self.impaired
            && self.repaying_until.is_none_or(|u| t >= u)
            && self.refused_at.is_none_or(|r| t - r >= 60 * DAY)
    }
}

// ------------------------------------------------------------------ a shop, as a buyer sees it

/// A shop we could buy our goods at: its latest price list's price, account and premises.
#[derive(Debug, Clone, PartialEq)]
pub struct Shop {
    pub shop: String,
    pub price: i64,
    pub account: String,
    pub at: Option<String>,
}

/// The shops whose standing price lists sell `goods` to anyone (no wholesale minimum), in id order (trade.ts
/// `goodsPrices` for each seller of an open price list).
pub fn shops(book: &crate::common::Book, goods: &str) -> Vec<Shop> {
    let lists = latest_by_speaker(book, "price_list", |r| data(r).get("goods").is_some_and(truthy));
    let mut out = vec![];
    let sellers: BTreeSet<&str> = book.open("price_list").filter_map(|r| r.speaks_for.as_deref()).collect();
    for s in sellers {
        let Some(l) = lists.get(&Some(s)) else { continue };
        let d = data(l);
        let (Some(price), Some(account)) = (d.get("goods").and_then(|g| g.get(goods)).and_then(crate::papers::lenient::whole), d.s("account")) else { continue };
        if d.i("min_order").unwrap_or(1) > 1 || price <= 0 {
            continue;
        }
        out.push(Shop { shop: s.to_string(), price, account: account.to_string(), at: d.s("at").map(String::from) });
    }
    out
}

/// A seller's standing offer, if its latest price list that is one makes one (trade.ts `offerOf`).
fn shop_offer<'a>(book: &'a crate::common::Book, seller: &str) -> Option<&'a Value> {
    let lists = latest_by_speaker(book, "price_list", |r| !part(r, Piece::Offer).is_null());
    lists.get(&Some(seller)).map(|r| part(r, Piece::Offer))
}

/// An offer's facts for its taker, from its typed terms (mind.ts `factsOf`): money a month in and out, goods.
pub fn facts_of(offer: &Value, units: i64) -> Facts {
    let mut f = Facts::default();
    for c in offer.pointer("/terms/commitments").and_then(Value::as_array).into_iter().flatten() {
        let Some(o) = c.pointer("/does/outcome") else { continue };
        let every = c.get("every").and_then(crate::papers::lenient::whole).filter(|e| *e > 0);
        let per_unit = c.get("per").and_then(Value::as_str) == Some("unit");
        let per_month = |x: i64| every.map_or(x, |e| half_up(x * MONTH, e)) * if per_unit { units } else { 1 };
        let taker = c.get("who").and_then(Value::as_str) == Some("taker");
        if let Some(m) = o.get("money") {
            let a = m.get("amount").and_then(crate::papers::lenient::whole).unwrap_or(0);
            f.money_per_month += if taker { -1 } else { 1 } * per_month(a);
        }
        if let Some(g) = o.get("goods").filter(|_| !taker) {
            let q = g.get("quantity").and_then(crate::papers::lenient::whole).unwrap_or(0);
            f.goods_per_month = Some(f.goods_per_month.unwrap_or(0) + per_month(q));
        }
    }
    f
}

/// `a / b` rounded half up, for non-negative `a` and positive `b` (TS `Math.round`); otherwise rounded as TS would.
fn half_up(a: i64, b: i64) -> i64 {
    if b <= 0 {
        return 0;
    }
    (2 * a + b).div_euclid(2 * b)
}

fn ceil_div(a: i64, b: i64) -> i64 {
    -((-a).div_euclid(b))
}

/// A share kept, as people say it: `10_000 - bps` as a percentage with no trailing noughts (95, 94.5).
fn pct_kept(bps: i64) -> String {
    let k = 10_000 - bps;
    let (w, f) = (k.div_euclid(100), k.rem_euclid(100));
    if f == 0 {
        w.to_string()
    } else {
        format!("{w}.{}", format!("{f:02}").trim_end_matches('0'))
    }
}

/// The friction dial (frictions.ts `frictionDial`).
fn friction_dial(cx: &Cx) -> i64 {
    cx.ctx.world.dials.get("friction_bps").and_then(crate::papers::lenient::whole).unwrap_or(0).max(0)
}

/// The chance in parts per million that something with a yearly rate happens in `days` at the dial (frictions.ts
/// `chancePpm`).
fn chance_ppm(per_year_bps: i64, days: i64, dial: i64) -> i64 {
    if per_year_bps <= 0 || dial <= 0 || days <= 0 {
        return 0;
    }
    (per_year_bps * dial * days / (100 * 365)).min(1_000_000)
}

// ------------------------------------------------------------------ this part's memory

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Money {
    // ---- claims
    /// Claims made and not yet heard back on, by payment.
    pub claiming: BTreeSet<String>,
    /// A payment refused, at the age we were (not claimed again until older), and when.
    pub refused_at: BTreeMap<String, i64>,
    pub refused_on: BTreeMap<String, i64>,
    /// Payments whose time ran out, since we last worked.
    pub ran_out: BTreeSet<String>,
    /// Take-up (risks A-30): for each payment we are entitled to now, whether we claim it this spell, and how many
    /// spells of entitlement to it there have been (each spell's draw is the next of its stream).
    pub take_up: BTreeMap<String, bool>,
    pub spells: BTreeMap<String, u64>,
    // ---- borrowing and bills
    pub borrowing: Borrower,
    pub bills_paid: BTreeSet<String>,
    /// Bills paid lately (when, how much), for what bills come to a month.
    pub bills: Vec<(i64, i64)>,
    pub bill_seen: BTreeSet<String>,
    /// A service -> what its last bill came to a day.
    pub billed: BTreeMap<String, i64>,
    // ---- shopping
    pub next_shop_search: i64,
    pub next_spend: i64,
    pub favourite: Option<String>,
    /// How fully the last shop served us (basis points).
    pub last_served: i64,
    pub next_shop: i64,
    pub last_shop: Option<i64>,
    /// The trip under way: when, and the shops tried on it.
    pub trip: Option<(i64, BTreeSet<String>)>,
    pub next_use: i64,
    /// Budget not spent last trip (less than an item's price), carried to the next.
    pub carried: i64,
    /// Money meant for goods and refunded (a shop couldn't serve), spent on the next trip.
    pub deferred: i64,
    /// How many delivery notes seen we have read.
    pub deliveries_read: usize,
    /// Goods found faulty, to be thrown out; when goods last came home.
    pub spoiled: i64,
    pub fault_seen: i64,
    /// A shop -> our latest decision that chose it (an outcome names it as `of`).
    pub chose: BTreeMap<String, u64>,
}

impl Money {
    pub fn new(p: &Params, cx: &mut Cx) -> Self {
        Money {
            claiming: BTreeSet::new(),
            refused_at: BTreeMap::new(),
            refused_on: BTreeMap::new(),
            ran_out: BTreeSet::new(),
            take_up: BTreeMap::new(),
            spells: BTreeMap::new(),
            borrowing: Borrower::default(),
            bills_paid: BTreeSet::new(),
            bills: vec![],
            bill_seen: BTreeSet::new(),
            billed: BTreeMap::new(),
            next_shop_search: cx.rng("shop-search-day").below(30) as i64 * DAY,
            next_spend: cx.rng("spend-day").below(30) as i64 * DAY,
            favourite: None,
            last_served: 10_000,
            next_shop: cx.rng("shop-day").below(p.shop_every_days.max(1) as u64) as i64 * DAY,
            last_shop: None,
            trip: None,
            next_use: 0,
            carried: 0,
            deferred: 0,
            deliveries_read: 0,
            spoiled: 0,
            fault_seen: 0,
            chose: BTreeMap::new(),
        }
    }
}

impl Default for Money {
    fn default() -> Self {
        Money {
            claiming: BTreeSet::new(),
            refused_at: BTreeMap::new(),
            refused_on: BTreeMap::new(),
            ran_out: BTreeSet::new(),
            take_up: BTreeMap::new(),
            spells: BTreeMap::new(),
            borrowing: Borrower::default(),
            bills_paid: BTreeSet::new(),
            bills: vec![],
            bill_seen: BTreeSet::new(),
            billed: BTreeMap::new(),
            next_shop_search: 0,
            next_spend: 0,
            favourite: None,
            last_served: 10_000,
            next_shop: 0,
            last_shop: None,
            trip: None,
            next_use: 0,
            carried: 0,
            deferred: 0,
            deliveries_read: 0,
            spoiled: 0,
            fault_seen: 0,
            chose: BTreeMap::new(),
        }
    }
}

/// A benefit decision as a claimant reads it (leniently: an office's code and a seat's form both write it).
struct Answer {
    claim: String,
    payment: String,
    granted: bool,
    amount: i64,
    every: i64,
}

fn granted(d: &Value) -> bool {
    matches!(d.get("granted"), Some(Value::Bool(true))) || d.s("granted") == Some("yes")
}

impl Person {
    /// What a month's housing costs us: rent (or the mortgage), or our share of the household's.
    fn housing_cost(&self) -> i64 {
        self.s.home.as_ref().map(|h| h.rent).or(self.s.share.as_ref().map(|s| s.0)).unwrap_or(0)
    }

    /// What our bills come to a month: what we've paid over the last 90 days, from when we first paid one (citizen.ts
    /// `billsMonthly`).
    pub fn bills_monthly(&mut self, t: i64) -> i64 {
        self.money.bills.retain(|b| t - b.0 <= 90 * DAY);
        let Some(first) = self.money.bills.first() else { return 0 };
        let span = (30 * DAY).max((90 * DAY).min(t - first.0 + 30 * DAY));
        self.money.bills.iter().map(|b| b.1).sum::<i64>() * MONTH / span
    }

    /// What kind of institution someone is to us (citizen.ts `kindOf`).
    fn money_kind_of(&self, who: &str, params: &serde_json::Map<String, Value>) -> &'static str {
        if let Some(k) = params.get("institutions").and_then(|i| i.get(who)).and_then(Value::as_str) {
            return match k {
                "banks" => "banks",
                "unions" => "unions",
                "government" => "government",
                "courts" => "courts",
                "policing" => "policing",
                "press" => "press",
                "companies" => "companies",
                "civil_service" => "civil_service",
                _ => "other",
            };
        }
        let p = &self.p;
        let is = |o: &Option<String>| o.as_deref() == Some(who);
        if is(&p.bank) {
            "banks"
        } else if is(&p.union) {
            "unions"
        } else if is(&p.complain_to) || is(&p.electoral_town) {
            "government"
        } else if p.tribunal.as_ref().is_some_and(|x| x.entity == who) {
            "courts"
        } else if p.welfare.as_ref().is_some_and(|x| x.police == who) {
            "policing"
        } else if is(&p.paper) {
            "press"
        } else if p.care.as_ref().is_some_and(|x| x.entity == who) || p.school.as_ref().is_some_and(|x| x.entity == who) {
            "civil_service"
        } else if self.s.employers.contains(who) {
            "companies"
        } else {
            "other"
        }
    }

    // ------------------------------------------------------------------ what sellers advertise (4902-4915)

    /// What sellers advertise: a few shops, if we know of none; else, with the month's chance, the prices of a shop
    /// someone we know shops at and we don't; else those of our own shop, if we know it only from looking.
    pub fn shop_looks(&mut self, pic: &oikos_sight::Picture, cx: &mut Cx) -> Vec<LookRequest> {
        if self.p.adverts.is_empty() {
            return vec![];
        }
        let t = pic.t;
        let knows_shop = self.book.open("price_list").any(|r| {
            let d = data(r);
            d.get("goods").and_then(|g| g.get(&self.p.goods)).is_some() && !d.get("min_order").is_some_and(truthy)
        });
        if knows_shop && t >= self.money.next_shop_search {
            self.money.next_shop_search = t + MONTH;
            // (The draw is made as TS made it, so a twin draws alike. Which shop those we know go to is word of mouth,
            // the mind's (`newsNow`), and the seam does not yet say it: until it does, no shop is found this way.)
            let _ = cx.rng("shop-search").below(10_000);
        }
        if !knows_shop {
            let c = Condition { field: "data.at".into(), op: CmpOp::Gt, value: json!("") };
            return vec![crate::common::ask::board(&self.p.adverts, self.p.shops_known.max(0) as u32, vec![c], None)];
        }
        match &self.money.favourite {
            Some(f) if self.absorbed.looked_up.contains(f) => vec![crate::common::ask::about(
                &self.p.adverts,
                "speaks_for",
                f.clone(),
                crate::common::ask::About { most: 1, standing: true, newest: true, ..Default::default() },
            )],
            _ => vec![],
        }
    }

    // ------------------------------------------------------------------ claims for support (3567-3659)

    /// Claims for support, as the published law sets the payments out (docs/behaviour/boundary.md): a payment for those
    /// out of work, while out of work and looking (the first the law lists that hasn't refused us or run out); a
    /// payment for age, from its age, working or not; a household's payment, as its head. Where a rule turns on what
    /// we know of ourselves, we claim it only if we fit, and declare those on the claim. A claim that no longer fits is
    /// stopped by saying so. Of those entitled, a share claims (`take_up_bps`, where the world gives one).
    pub fn claims(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let year = self.p.year.max(1);
        let born_at = w.pic.body.as_ref().map(|b| b.born_at);
        let age = born_at.map_or(0, |b| (t - b).div_euclid(year));
        let rules = support_law(&self.book);
        if self.s.job.is_some() {
            self.s.worked = true;
            self.money.ran_out.clear();
            // (Work is what a record is made of: worth asking again.)
            for r in rules.iter().filter(|r| r.on_record()) {
                self.money.refused_at.remove(&r.id);
                self.money.refused_on.remove(&r.id);
            }
        }
        let fresh: Vec<Arc<Record>> = self.absorbed.fresh.iter().filter_map(|id| self.book.get(id).cloned()).collect();
        let addressed = |r: &Record| addressed_to(r).contains(&me);
        // (A payment already ours when the year began, granted on paper before it: drawn from the first day, not
        // claimed again. A claim made before the year and not yet decided is waited on; one refused before it is not
        // made again until we are a year older.)
        for r in &fresh {
            let d = data(r);
            let Some(payment) = d.s("payment").filter(|_| d.flag("brought_forward")) else { continue };
            if kind(r) == Some("benefit_claim") && r.speaks_for.as_deref() == Some(me.as_str()) {
                let decided = self.book.all("benefit_decision").any(|x| data(x).flag("brought_forward") && data(x).s("claim") == Some(r.id.as_str()));
                if !decided {
                    self.money.claiming.insert(payment.to_string());
                }
            } else if kind(r) == Some("benefit_decision") && !granted(d) && d.get("granted").is_some() && addressed(r) {
                self.money.refused_at.insert(payment.to_string(), age);
                self.money.refused_on.insert(payment.to_string(), t);
                self.money.claiming.remove(payment);
            }
        }
        for r in &fresh {
            let d = data(r);
            if kind(r) != Some("benefit_decision") || !d.flag("brought_forward") || !granted(d) || !addressed(r) {
                continue;
            }
            let payment = d.s("payment").unwrap_or_default().to_string();
            let rule = rules.iter().find(|x| x.id == payment);
            let b = Benefit {
                claim: d.s("claim").unwrap_or_default().into(),
                payer: rule.and_then(|x| x.payer.clone()).or(r.speaks_for.clone()).unwrap_or_default(),
                amount: d.i("amount").unwrap_or(0),
                every: d.i("every").unwrap_or(MONTH),
                lasting: rule.is_some_and(|x| !x.for_out_of_work()),
                payment: payment.clone(),
            };
            self.s.benefits.insert(payment, b);
        }

        let facts = self.claim_facts(&rules, t);
        let worked = self.s.worked;
        let fits = |r: &PaymentRule, benefits: &BTreeMap<String, Benefit>| -> bool {
            let w = r.who.clone().unwrap_or_default();
            if w.record.is_some() && !worked {
                return false; // (nobody has reported pay for someone who hasn't worked here)
            }
            if let Some(iu) = &w.income_under {
                let inc = if iu.per == "head" { facts.household_income.div_euclid(facts.household_members.max(1)) } else { facts.household_income };
                if inc >= iu.amount {
                    return false;
                }
            }
            if w.no_other_pension == Some(true) && rules.iter().any(|o| o.id != r.id && benefits.contains_key(&o.id) && !o.for_out_of_work() && !o.for_household()) {
                return false;
            }
            if let Some(c) = &w.children {
                if (facts.children_born_at.iter().filter(|b| (t - **b).div_euclid(year) < c.under_age).count() as i64) < c.least {
                    return false;
                }
            }
            true
        };
        let blocked = |m: &Money, r: &PaymentRule| {
            if r.on_record() {
                m.refused_on.get(&r.id).is_some_and(|on| t - on < MONTH)
            } else {
                m.refused_at.get(&r.id) == Some(&age)
            }
        };
        let looking = self.s.job.is_none() && self.s.own_work.is_none() && !self.s.retired && self.p.in_labour_force;
        let stopgaps: Vec<&PaymentRule> = rules.iter().filter(|r| r.for_out_of_work()).collect();
        // (The first the law lists that we may have; one we already draw is kept until an earlier one is granted.)
        let preferred: Option<String> = if !looking {
            None
        } else {
            stopgaps
                .iter()
                .find(|r| self.money.claiming.contains(&r.id))
                .or_else(|| stopgaps.iter().find(|r| !blocked(&self.money, r) && !self.money.ran_out.contains(&r.id) && fits(r, &self.s.benefits)))
                .map(|r| r.id.clone())
        };
        let drawn: Option<String> = if looking { stopgaps.iter().find(|r| self.s.benefits.contains_key(&r.id)).map(|r| r.id.clone()) } else { None };
        let leaseholder = self.is_leaseholder();
        let wanted = |r: &PaymentRule, benefits: &BTreeMap<String, Benefit>| -> bool {
            if r.for_out_of_work() {
                preferred.as_deref() == Some(r.id.as_str())
                    || (drawn.as_deref() == Some(r.id.as_str()) && !preferred.as_ref().is_some_and(|p| benefits.contains_key(p)))
            } else {
                let w = r.who.clone().unwrap_or_default();
                (!r.for_household() || leaseholder) && age >= w.from_age.unwrap_or(0) && w.to_age.is_none_or(|a| age <= a) && fits(r, benefits)
            }
        };
        // (Decided fresh: whether each payment is wanted is read once, before any is stopped; TS read it as it went.)
        let wanted_now: BTreeMap<String, bool> = rules.iter().map(|r| (r.id.clone(), wanted(r, &self.s.benefits))).collect();
        let (job_now, retired) = (self.s.job.is_some(), self.s.retired);
        for b in self.s.benefits.values().cloned().collect::<Vec<_>>() {
            if wanted_now.get(&b.payment) == Some(&true) && rules.iter().any(|r| r.id == b.payment) {
                continue;
            }
            let why = if job_now { "working again" } else if retired { "retired" } else { "no longer eligible" };
            w.push(because(
                format!("Our circumstances have changed ({why}): asking for our {} payments to stop.", b.payment),
                vec![say(
                    "benefit_change",
                    &format!("Please stop payment {}.", b.claim),
                    Say {
                        to: Some(vec![b.payer.clone()]),
                        visible: Some(Visible::Only(vec![me.clone(), b.payer.clone()])),
                        basis: Some(b.claim.clone()),
                        data: Some(crate::papers::data(&BenefitChange { claim: b.claim.clone(), stop: true })),
                        ..Default::default()
                    },
                )],
            ));
            self.s.benefits.remove(&b.payment);
        }
        // (A spell of entitlement ends when the payment is no longer one we would have: the next spell draws anew.)
        for r in &rules {
            if wanted_now.get(&r.id) != Some(&true) {
                self.money.take_up.remove(&r.id);
            }
        }
        let account = w.acc.as_ref().map(|a| a.account.clone()).unwrap_or_default();
        for r in &rules {
            if wanted_now.get(&r.id) != Some(&true) || self.s.benefits.contains_key(&r.id) || self.money.claiming.contains(&r.id) || blocked(&self.money, r) {
                continue;
            }
            if !self.takes_up(w, &r.id) {
                continue;
            }
            self.money.claiming.insert(r.id.clone());
            let payer = r.payer.clone().unwrap_or_default();
            let declares = declaration_for(r, &facts);
            let why = if r.for_out_of_work() {
                format!("Out of work: claiming {} support while we look.", r.id)
            } else if r.for_household() {
                format!("Our household may be paid {} support: claiming it.", r.id)
            } else if retired {
                format!("Retired, at {age}: claiming {} support.", r.id)
            } else {
                format!("At {age}: claiming {} support.", r.id)
            };
            let claim = BenefitClaim { payment: r.id.clone(), account: account.clone(), born_at, declares, brought_forward: None };
            w.push(because(
                why,
                vec![say(
                    "benefit_claim",
                    &format!("Claim: {}.", r.id),
                    Say { to: Some(vec![payer.clone()]), visible: Some(Visible::Only(vec![me.clone(), payer])), data: Some(crate::papers::data(&claim)), ..Default::default() },
                )],
            ));
        }
        let dial = friction_dial(w.cx);
        for r in &fresh {
            if !matches!(kind(r), Some("benefit_end") | Some("benefit_decision")) || !addressed(r) {
                continue;
            }
            let d = data(r);
            let payment = d.s("payment").unwrap_or("undefined").to_string();
            if kind(r) == Some("benefit_end") {
                // A payment whose time has run out: it isn't claimed again until we've worked.
                if self.s.benefits.get(&payment).is_some_and(|b| Some(b.claim.as_str()) == d.s("claim")) {
                    self.s.benefits.remove(&payment);
                }
                self.money.ran_out.insert(payment);
                continue;
            }
            // (A refusal put right on a second look, or set aside by a venue: the decision that grants it comes when we
            // are no longer claiming.)
            let ok = granted(d);
            if !(self.money.claiming.contains(&payment) || (d.flag("on_review") && ok && !self.s.benefits.contains_key(&payment))) {
                continue;
            }
            let rule = rules.iter().find(|x| x.id == payment);
            let a = Answer { claim: d.s("claim").unwrap_or_default().into(), payment: payment.clone(), granted: ok, amount: d.i("amount").unwrap_or(0), every: d.i("every").unwrap_or(MONTH) };
            if a.granted {
                let b = Benefit {
                    claim: a.claim.clone(),
                    payment: a.payment.clone(),
                    payer: rule.and_then(|x| x.payer.clone()).or(r.speaks_for.clone()).unwrap_or_default(),
                    amount: a.amount,
                    every: a.every,
                    lasting: rule.is_some_and(|x| !x.for_out_of_work()),
                };
                self.s.benefits.insert(payment.clone(), b);
            } else {
                self.money.refused_at.insert(payment.clone(), age);
                self.money.refused_on.insert(payment.clone(), t);
                // (Refused: to one who believes they qualify, a wrong of the office's, to be looked at again.)
                if let (true, Some(by)) = (dial > 0, r.speaks_for.clone()) {
                    if !d.flag("reviewed") {
                        let cause = d.s("reason").unwrap_or("refused").to_string();
                        let evidence = super::recourse::tendered(r);
                        let g = self.grieve(w, "claim_refused", &by, Some(&r.id), None, None, 10_000, "security", Some(&cause));
                        g.seeks = Some(payment.clone());
                        g.evidence = Some(evidence);
                    }
                }
            }
            if a.granted {
                self.refusals_granted(w, &payment);
            }
            // (A claim answered: what we asked for came, or did not; and the office that decides is trusted more, or less.)
            if let Some(by) = r.speaks_for.clone() {
                let k = match self.money_kind_of(&by, &w.cx.ctx.params) {
                    "other" => "civil_service",
                    k => k,
                };
                self.treated(w, Treated { who: by, kind: k.into(), good: a.granted, tried: true, paper: Some(r.id.clone()), ..Default::default() });
            }
            self.money.claiming.remove(&payment);
        }
    }

    /// What we know of our own household, for a rule that turns on it.
    fn claim_facts(&self, rules: &[PaymentRule], t: i64) -> ClaimFacts {
        let h = self.s.household.as_ref();
        ClaimFacts {
            household_income: self.wage_income(t) + if self.is_leaseholder() { self.s.member_pay.values().sum::<i64>() } else { 0 },
            household_members: h.map_or(1, |h| h.members.len() as i64),
            children_born_at: h.map_or(vec![], |h| h.members.iter().filter(|m| oikos_rules::household::age_at(m.born_at, t, self.p.year) < oikos_rules::household::ADULT_YEARS).map(|m| m.born_at).collect()),
            other_pension: rules.iter().any(|r| self.s.benefits.contains_key(&r.id) && !r.for_out_of_work() && !r.for_household()),
        }
    }

    /// Whether we claim a payment we are entitled to, this spell of entitlement (risks A-30: take-up of means-tested
    /// support is well under full). Drawn once a spell, on a stream that is the person's and the payment's: the n-th
    /// spell takes the stream's n-th draw, so a twin draws alike. No take-up given: everyone entitled claims.
    fn takes_up(&mut self, w: &mut Week, payment: &str) -> bool {
        let Some(bps) = self.p.take_up_bps else { return true };
        if let Some(d) = self.money.take_up.get(payment) {
            return *d;
        }
        let n = {
            let s = self.money.spells.entry(payment.to_string()).or_insert(0);
            *s += 1;
            *s
        };
        let mut rng = w.cx.chance(&format!("{}/take-up/{payment}", self.me));
        let mut draw = 0;
        for _ in 0..n {
            draw = rng.below(10_000) as i64;
        }
        let takes = draw < bps;
        self.money.take_up.insert(payment.to_string(), takes);
        takes
    }

    // ------------------------------------------------------------------ borrowing (3802-3805; credit.ts `Borrowing.steps`)

    /// Borrowing (docs/behaviour/credit.md): decisions on our applications, a default, and a loan offered to us, signed
    /// and repaid by standing order.
    pub fn borrowing(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let lender = self.p.bank.clone().unwrap_or_default();
        let b = &mut self.money.borrowing;
        for r in self.book.all("loan_decision") {
            if b.taken.contains(&r.id) || !addressed_to(r).contains(&me) {
                continue;
            }
            b.taken.insert(r.id.clone());
            b.applied = None;
            if !data(r).flag("approved") {
                b.refused_at = Some(t);
            } else {
                let months = data(r).i("months").filter(|m| *m != 0).unwrap_or(12);
                b.repaying_until = Some(b.repaying_until.unwrap_or(i64::MIN).max(t + months * MONTH));
                b.granted_at = Some(t);
            }
        }
        if self.book.all("loan_default").any(|r| addressed_to(r).contains(&me)) {
            b.impaired = true;
        }
        let Some(account) = w.acc.as_ref().map(|a| a.account.clone()) else { return };
        let mut signs = vec![];
        for r in self.book.of_type("agreement") {
            let ps = parties_of(r);
            if template_of(r) != Some("loan") || !ps.contains(&me) || ps.first() != Some(&lender) || b.taken.contains(&r.id) || self.book.signed_by(&r.id, &me) || self.book.taken_back(&r.id) {
                continue;
            }
            b.taken.insert(r.id.clone());
            b.applied = None;
            let (owe, every) = commitment_of(r, &me);
            let Some(m) = owe.and_then(|o| o.money) else { continue };
            b.granted_at = Some(t);
            signs.push((r.id.clone(), m.to, m.amount, every.unwrap_or(MONTH)));
        }
        for (id, to, amount, every) in signs {
            let words = money_words(amount, &w.cx.ctx.world);
            let p = pay(&to, amount, Pay { from: Some(account.clone()), every: Some(every), first: Some(every), basis: Some(id.clone()), for_: Some("Loan repayment.".into()), ..Default::default() }, w.cx);
            w.push(because(format!("The loan we applied for is offered: signing, and asking our bank to pay the {words} a month."), vec![sign(&id), p]));
        }
    }

    // ------------------------------------------------------------------ what we are ordered to pay (3811-3820)

    /// A tribunal's order that we pay (a debt, or making good what we took): paid when we can, keeping a month's
    /// essentials.
    pub fn ordered_to_pay(&mut self, w: &mut Week) {
        let me = self.me.clone();
        let orders: Vec<(String, i64, Option<String>, String)> = self
            .book
            .open("tribunal_order")
            .filter(|x| data(x).s("against") == Some(me.as_str()) && data(x).s("finding") == Some("pay") && !self.money.bills_paid.contains(&x.id))
            .map(|o| (o.id.clone(), data(o).i("amount").unwrap_or(0), data(o).s("to").map(String::from), data(o).s("claim").map_or_else(|| o.id.clone(), String::from)))
            .collect();
        for (id, amount, to, settles) in orders {
            let Some(acc) = w.acc.clone() else { return };
            let Some(to) = to else { continue };
            if amount <= 0 || acc.balance < amount + self.p.essentials {
                continue;
            }
            self.money.bills_paid.insert(id.clone());
            if let Some(a) = w.acc.as_mut() {
                a.balance -= amount;
            }
            let p = pay(&to, amount, Pay { from: Some(acc.account.clone()), for_: Some(format!("Paying under order {id}.")), settles: Some(settles), ..Default::default() }, w.cx);
            w.push(because(format!("The tribunal ordered us to pay {}: paying it.", money_words(amount, &w.cx.ctx.world)), vec![p]));
        }
    }

    // ------------------------------------------------------------------ what is recorded against us (3842-3878)

    /// What's recorded against us to pay (rates on a home we own, a fine): paid when we can, keeping a month's
    /// essentials; our bills for a service, paid when they come, if we can; and, short of next month's housing and
    /// essentials with income coming in, a loan from our bank to tide us over.
    pub fn recorded_against(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let Some(account) = w.acc.as_ref().map(|a| a.account.clone()) else { return };
        let recorded: Vec<(String, i64, Option<String>, String, String)> = self
            .book
            .claims_by(ClaimKey::Counterparty, &me)
            .filter_map(|c| match &c.body {
                RecordBody::Claim { position: oikos_contracts::blocks::Position::Right, counterparty: Some(cp), about, .. } if *cp == me => {
                    let k = about.s("kind")?;
                    if !["rates", "rates_interest", "fine"].contains(&k) || self.money.bills_paid.contains(&c.id) {
                        return None;
                    }
                    Some((c.id.clone(), about.i("amount").unwrap_or(0), about.s("account").map(String::from), k.to_string(), about.s("for").map_or_else(|| c.id.clone(), String::from)))
                }
                _ => None,
            })
            .collect();
        for (id, amount, to, k, what) in recorded {
            let bal = w.acc.as_ref().map_or(0, |a| a.balance);
            let Some(to) = to else { continue };
            if amount <= 0 || bal < amount + self.p.essentials {
                continue;
            }
            self.money.bills_paid.insert(id.clone());
            self.money.bills.push((t, amount));
            if let Some(a) = w.acc.as_mut() {
                a.balance -= amount;
            }
            let p = pay(&to, amount, Pay { from: Some(account.clone()), for_: Some(format!("Paying {k} {id}.")), settles: Some(id.clone()), ..Default::default() }, w.cx);
            w.push(because(format!("Paying the {k} recorded against us ({what})."), vec![p]));
        }
        let dial = friction_dial(w.cx);
        let invoices: Vec<Arc<Record>> = self
            .book
            .open("invoice")
            .filter(|r| addressed_to(r).contains(&me) && data(r).get("service").is_some_and(truthy) && !self.money.bills_paid.contains(&r.id))
            .cloned()
            .collect();
        for inv in invoices {
            let d = data(&inv);
            let service = d.get("service").map(|s| s.as_str().map_or_else(|| s.to_string(), String::from)).unwrap_or_default();
            let amount = d.pointer("/outcome/money/amount").and_then(crate::papers::lenient::whole).unwrap_or(0);
            let to = d.pointer("/outcome/money/to").and_then(Value::as_str).map(String::from);
            let days = d.i("days").unwrap_or(0);
            // A bill well over what the last one came to a day is looked at twice (docs/behaviour/frictions.md): the
            // difference is what we say we were overcharged. It is paid all the same.
            if dial > 0 && amount > 0 && !self.money.bill_seen.contains(&inv.id) && inv.speaks_for.is_some() && days > 0 {
                self.money.bill_seen.insert(inv.id.clone());
                let per_day = half_up(amount, days);
                let over = 10_000 + self.p.frictions.bill_over_bps.unwrap_or(1_500);
                match self.money.billed.get(&service).copied() {
                    Some(usual) if per_day * 10_000 > usual * over => {
                        let party = inv.speaks_for.clone().unwrap_or_default();
                        self.happened(
                            w,
                            Event::Grieved {
                                matter: "bill".into(),
                                party,
                                about: Some(inv.id.clone()),
                                amount: Some(amount - usual * days),
                                structure: None,
                                size_bps: 5_000,
                                need: "security".into(),
                                cause: Some("over the usual".into()),
                            },
                        );
                    }
                    _ => {
                        self.money.billed.insert(service.clone(), per_day);
                    }
                }
            }
            let bal = w.acc.as_ref().map_or(0, |a| a.balance);
            let Some(to) = to else { continue };
            if amount <= 0 || bal < amount {
                continue;
            }
            self.money.bills_paid.insert(inv.id.clone());
            self.money.bills.push((t, amount));
            if let Some(a) = w.acc.as_mut() {
                a.balance -= amount;
            }
            let p = pay(&to, amount, Pay { from: Some(account.clone()), for_: Some(format!("{service} bill.")), settles: Some(inv.id.clone()), ..Default::default() }, w.cx);
            w.push(because(format!("Paying our {service} bill."), vec![p]));
        }
        let housing = self.housing_cost();
        let bal = w.acc.as_ref().map_or(0, |a| a.balance);
        let lender = self.p.bank.clone().unwrap_or_default();
        if housing > 0 && self.monthly_income(t) > 0 && bal < housing + self.p.essentials && self.money.borrowing.can_apply(&lender, t) {
            let amount = ceil_div(3 * (housing + self.p.essentials) - bal, 10_000) * 10_000;
            let world = &w.cx.ctx.world;
            let why = format!(
                "We have {}, less than next month's housing and essentials ({}): asking our bank for a loan of {} to tide us over.",
                money_words(bal, world),
                money_words(housing + self.p.essentials, world),
                money_words(amount, world)
            );
            self.money.borrowing.applied = Some(t);
            let app = LoanApplication { amount, months: 12, account, purpose: "living costs".into(), price: None, home: None };
            w.push(because(
                why,
                vec![say(
                    "loan_application",
                    &format!("Application for a loan of {} over 12 months, for living costs.", money_words(amount, world)),
                    Say { to: Some(vec![lender.clone()]), visible: Some(Visible::Only(vec![me, lender])), data: Some(crate::papers::data(&app)), ..Default::default() },
                )],
            ));
        }
    }

    // ------------------------------------------------------------------ spending (3878-3899, 3981-3989)

    /// What we save of income: the household's usual share, or more while spending less (a goal's method).
    fn saving_bps(&self, cx: &Cx) -> i64 {
        if self.mind.pursuing("spend less") {
            let goal = cx.ctx.params.get("goals").and_then(|g| g.get("spend_less_saving_bps")).and_then(crate::papers::lenient::whole).unwrap_or(2_000);
            self.p.saving_bps.max(goal)
        } else {
            self.p.saving_bps
        }
    }

    /// A month's spending: out of income, what isn't saved, less housing; never below essentials; plus a little out of
    /// savings above a buffer (the wealth effect). Income is a month's worth of what came in lately (before we've a
    /// window of it, what our job and payments say).
    fn monthly_spend(&mut self, w: &Week) -> i64 {
        let t = w.t;
        let bal = w.acc.as_ref().map_or(0, |a| a.balance);
        let housing = self.housing_cost() + self.bills_monthly(t);
        let window = self.p.income_window_days * DAY;
        let income = if t >= window && window > 0 { (self.s.inflows.iter().map(|f| f.1).sum::<i64>() * MONTH).div_euclid(window) } else { self.monthly_income(t) };
        let from_income = self.p.essentials.max((income * (10_000 - self.saving_bps(w.cx))).div_euclid(10_000) - housing);
        let above = (bal - housing - self.p.buffer_months * income.max(self.p.essentials)).max(0);
        let from_wealth = above * self.p.wealth_effect_bps_per_year / 120_000;
        (bal - housing).min(from_income + from_wealth).max(0)
    }

    /// Spending without shops (a world with no price lists): the money-only stand-in, a month's worth to a shop's
    /// account.
    pub fn spending(&mut self, w: &mut Week) {
        let t = w.t;
        if !shops(&self.book, &self.p.goods).is_empty() || t < self.money.next_spend {
            return;
        }
        self.money.next_spend = t + MONTH;
        let accounts: Vec<String> = w.cx.ctx.params.get("shop_accounts").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
        let amount = self.monthly_spend(w);
        let Some(acc) = w.acc.clone() else { return };
        if amount > 0 && !accounts.is_empty() {
            let shop = accounts[w.cx.rng("shop").below(accounts.len() as u64) as usize].clone();
            let p = pay(&shop, amount, Pay { from: Some(acc.account), for_: Some("Shopping.".into()), ..Default::default() }, w.cx);
            w.push(because(format!("Monthly shopping: what we don't save of our income ({}%) less the rent, and a little out of savings.", pct_kept(self.p.saving_bps)), vec![p]));
        }
    }

    // ------------------------------------------------------------------ shopping (3899-3980)

    /// Where the goods go: home, if we're living there, or else kept at the shop for us.
    fn home_at(&self, pic: &oikos_sight::Picture) -> Option<String> {
        match (&self.s.home, &self.s.living_at) {
            (Some(h), _) if inside(pic, &self.me, &h.space) => Some(h.structure.clone()),
            (_, Some(l)) if inside(pic, &self.me, l) => Some(structure_of(l).to_string()),
            _ => None,
        }
    }

    /// An order for goods, paid with the order (trade.ts `order`), the trip's shops tried noted; false if it can't be
    /// placed (nowhere to put them, or nothing to buy).
    fn buy(&mut self, w: &mut Week, s: &Shop, q: i64, why: String, retry_of: Option<String>) -> bool {
        let Some(place) = self.home_at(w.pic).or(s.at.clone()) else { return false };
        if q < 1 {
            return false;
        }
        let Some(acc) = w.acc.clone() else { return false };
        if let Some((_, tried)) = self.money.trip.as_mut() {
            tried.insert(s.shop.clone());
        }
        // What it's for: until the next trip (it's what we use until then), and the shop may serve it over that time.
        let for_days = ceil_div(self.money.next_shop - w.t, DAY).max(1);
        let total = q * s.price;
        let world = &w.cx.ctx.world;
        let goods = &self.p.goods;
        let words = format!("Order: {q} {goods} at {} each ({}), delivered to {} at {place}. Paid with this order.", money_words(s.price, world), money_words(total, world), self.me);
        let o = Order { kind: goods.clone(), quantity: q, unit_price: s.price, deliver_to: Some(self.me.clone()), at: place, account: acc.account.clone(), pay_in_days: None, retry_of, for_days: Some(for_days) };
        let order = say("order", &words, Say { to: Some(vec![s.shop.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), s.shop.clone()])), data: Some(crate::papers::data(&o)), ..Default::default() });
        let p = pay(&s.account, total, Pay { from: Some(acc.account), for_: Some(format!("Order: {q} {goods}.")), ..Default::default() }, w.cx);
        w.push(step_of_lines(why, vec![bound("order", order), oikos_sight::calls::Line { bind: None, call: p }]));
        true
    }

    /// Shopping, where there are shops: what came of our orders (and another shop tried for what one couldn't serve),
    /// and every fortnight a trip, to the shop the mind chooses among their offers for the trip's budget.
    pub fn shopping(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let list = shops(&self.book, &self.p.goods);
        if list.is_empty() {
            return;
        }
        let price_at = |s: &str| list.iter().find(|x| x.shop == s).cloned();
        let dial = friction_dial(w.cx);
        // A shop that couldn't serve all we asked: now and then we give up on it; and we try another for what's missing.
        let notes: Vec<Arc<Record>> = self.book.all("delivery_note").skip(self.money.deliveries_read).cloned().collect();
        self.money.deliveries_read += notes.len();
        for n in notes.iter().filter(|n| addressed_to(n).contains(&me)) {
            let d = data(n);
            let delivered = d.i("delivered").unwrap_or(0);
            let ordered = d.i("ordered").unwrap_or(delivered);
            let refund = d.i("refund").unwrap_or(0);
            let order = d.s("order").map(String::from);
            let seller = n.speaks_for.clone().unwrap_or_default();
            if refund > 0 {
                self.s.inflows.push((t, -refund)); // (a refund isn't income)
            }
            let short = ordered - delivered;
            if d.s("kind") != Some(self.p.goods.as_str()) || ordered <= 0 {
                continue;
            }
            // What we learn of the shop: how fully it served us.
            let served = half_up(delivered * 10_000, ordered);
            let mut facts: BTreeMap<String, Value> = [("ordered".to_string(), json!(ordered)), ("delivered".to_string(), json!(delivered))].into();
            if refund > 0 {
                facts.insert("refund".into(), json!(refund));
            }
            if let Some(o) = &order {
                facts.insert("order".into(), json!(o));
            }
            let of = self.money.chose.get(&seller).copied();
            self.tell(w, Outcome { domain: "shop".into(), option: seller.clone(), kind: "served".into(), way: Way::Mine, facts, payoff: Some(served), of, paper: Some(n.id.clone()), ..Default::default() });
            if self.money.favourite.as_deref() == Some(seller.as_str()) {
                self.money.last_served = served;
            }
            // What was bought and is faulty (docs/behaviour/frictions.md): found at home, of no use, and paid for.
            let since = ((t - self.money.fault_seen) / DAY).min(self.p.shop_every_days).max(0);
            self.money.fault_seen = t;
            let oid = order.clone().unwrap_or_default();
            if dial > 0 && delivered > 0 && (w.cx.rng(&format!("faulty-{oid}")).below(1_000_000) as i64) < chance_ppm(self.p.frictions.faulty_bps_per_year.unwrap_or(0), since, dial) {
                let bad = half_up(delivered * self.p.frictions.faulty_share_bps.unwrap_or(2_500), 10_000).max(1);
                let price = price_at(&seller).map_or(0, |s| s.price);
                self.money.spoiled += bad;
                let facts: BTreeMap<String, Value> = [("delivered".to_string(), json!(delivered)), ("faulty".to_string(), json!(bad)), ("order".to_string(), json!(oid))].into();
                self.tell(w, Outcome { domain: "shop".into(), option: seller.clone(), kind: "faulty".into(), way: Way::Mine, facts, payoff: Some(half_up(served * (delivered - bad).max(0), delivered)), of, ..Default::default() });
                if price > 0 {
                    self.happened(
                        w,
                        Event::Grieved { matter: "goods".into(), party: seller.clone(), about: order.clone(), amount: Some(bad * price), structure: None, size_bps: 4_000, need: "subsistence".into(), cause: Some("faulty".into()) },
                    );
                }
            }
            if short <= 0 {
                continue;
            }
            // Tried elsewhere now, if this trip can: another shop we know, by what we've learned of each, not one that's
            // failed us. If not, what came back is spent on the next trip.
            let untried: Vec<Shop> = match &self.money.trip {
                Some((_, tried)) if (tried.len() as i64) < self.p.beta => list.iter().filter(|x| !tried.contains(&x.shop)).cloned().collect(),
                _ => vec![],
            };
            // (Chosen by the mind among those not yet tried, following the trip's decision; the stream is the mind's.)
            let chosen = if untried.is_empty() { None } else { self.mind.choose_known(w.cx, "shop", &untried.iter().map(|u| u.shop.clone()).collect::<Vec<_>>(), of) };
            let next = untried.iter().find(|x| Some(&x.shop) == chosen.as_ref()).cloned();
            let retried = match next {
                Some(nx) => {
                    let was_price = price_at(&seller).map_or(nx.price, |s| s.price);
                    let q = short.min(short * was_price / nx.price);
                    let why = format!("{seller} could serve {delivered} of the {ordered} we wanted: trying {} for the rest.", nx.shop);
                    self.buy(w, &nx, q, why, order.clone())
                }
                None => false,
            };
            if !retried && refund > 0 {
                self.money.deferred += refund;
            }
        }
        if t < self.money.next_shop {
            return;
        }
        self.money.next_shop = t + self.p.shop_every_days * DAY;
        self.money.trip = Some((t, BTreeSet::new()));
        // The trip's spending is for the time since the last one (up to two fortnights' worth).
        let since = match self.money.last_shop {
            None => self.p.shop_every_days * DAY,
            Some(l) => (t - l).min(2 * self.p.shop_every_days * DAY),
        };
        self.money.last_shop = Some(t);
        let bal = w.acc.as_ref().map_or(0, |a| a.balance);
        let budget = bal.min((self.monthly_spend(w) * since).div_euclid(MONTH) + self.money.carried + self.money.deferred);
        // Which shop: the mind's decision among the shops' offers, each for what the trip's budget buys there. (Those we
        // know who shop there are the mind's to count: word of mouth is its own.)
        let options: Vec<Choice> = list
            .iter()
            .map(|x| {
                let units = budget.max(0) / x.price;
                let facts = shop_offer(&self.book, &x.shop).map_or(Facts { money_per_month: -units * x.price, goods_per_month: Some(units), ..Default::default() }, |o| facts_of(o, units));
                Choice { key: x.shop.clone(), facts: Some(facts), ..Default::default() }
            })
            .collect();
        let was = self.money.favourite.clone();
        let current = was.clone().filter(|f| price_at(f).is_some());
        let life = self.life(w.pic, t, w.acc.as_ref().map(|a| a.balance));
        let d = self.mind.decide(
            w.cx,
            &life,
            Decide { domain: "shop".into(), options, current, satisfied_here: Some(self.money.last_served), purpose: Some("shopping".into()), bedrooms_needed: life.bedrooms_needed, ..Default::default() },
        );
        // (Nothing chosen: a shop at random, on the trip's stream; TS drew it after the mind's own draws on it.)
        let fav = d.key.clone().filter(|k| price_at(k).is_some()).unwrap_or_else(|| list[w.cx.rng("shopping").below(list.len() as u64) as usize].shop.clone());
        if let Some(n) = d.n {
            self.money.chose.insert(fav.clone(), n);
        }
        self.money.favourite = Some(fav.clone());
        let why = if Some(&fav) == was.as_ref() {
            String::new()
        } else if d.strategy == "imitate" {
            format!("going to {fav}, where others go")
        } else if d.strategy == "compare" {
            format!("going to {fav}, the best of the shops we know")
        } else {
            format!("choosing {fav}, weighing what each shop's prices buy{}", was.as_ref().map_or(String::new(), |w0| format!(" ({w0} served us {}% last time)", half_up(self.money.last_served, 100))))
        };
        let Some(s) = price_at(&fav) else { return };
        let q = budget.max(0) / s.price;
        self.money.carried = (budget - q * s.price).min(s.price).max(0);
        let world = &w.cx.ctx.world;
        let spend_less = self.mind.pursuing("spend less");
        let words = format!(
            "Shopping for the fortnight: what we don't save of our income ({}%{}) less the rent, and a little out of savings{}, is {}: {q} at {} ({} each){}.",
            pct_kept(self.saving_bps(w.cx)),
            if spend_less { ": spending less, to make ends meet" } else { "" },
            if self.money.deferred != 0 { format!(", and {} we meant to spend last time and got back", money_words(self.money.deferred, world)) } else { String::new() },
            money_words(budget, world),
            s.shop,
            money_words(s.price, world),
            if why.is_empty() { String::new() } else { format!("; {why}") },
        );
        self.buy(w, &s, q, words, None);
        self.money.deferred = 0;
    }

    // ------------------------------------------------------------------ using things up (3990-4018)

    /// Using things up: what we hold, spread over the weeks until the next trip. With a home, we use things there, and
    /// bring home what's elsewhere; without one, we use what a shop keeps for us, there.
    pub fn use_up(&mut self, w: &mut Week) {
        let t = w.t;
        let home_at = self.home_at(w.pic);
        let pickups: BTreeSet<String> = shops(&self.book, &self.p.goods).into_iter().filter_map(|s| s.at).collect();
        let mut had: Vec<(String, i64)> = w
            .pic
            .channels
            .values()
            .flat_map(|c| match c {
                Seen::Holdings { holdings } => holdings.iter().filter(|h| h.kind == self.p.goods).map(|h| (h.at.clone(), crate::common::money::cents(h.quantity))).collect::<Vec<_>>(),
                _ => vec![],
            })
            .filter(|(at, q)| *q > 0 && (home_at.is_some() || pickups.contains(at)))
            .collect();
        had.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let total: i64 = had.iter().map(|h| h.1).sum();
        if total <= 0 || t < self.money.next_use {
            return;
        }
        self.money.next_use = t + 7 * DAY;
        let weeks = ceil_div(self.money.next_shop - t, 7 * DAY).max(1);
        let each = ceil_div(total, weeks);
        let goods = self.p.goods.clone();
        let mut lines = vec![];
        let mut fetched = false;
        if let Some(home) = &home_at {
            for (at, q) in had.iter().filter(|h| &h.0 != home) {
                fetched = true;
                lines.push(call("goods", vec![("kind", Some(arg(&goods))), ("quantity", Some(text(q.to_string()))), ("to", Some(arg(&self.me))), ("at", Some(arg(home))), ("from_at", Some(arg(at)))]));
            }
            // (What was faulty is thrown out with what is used: it is gone, and the week is shorter for it.)
            let out = total.min(each + self.money.spoiled);
            self.money.spoiled = 0;
            lines.push(call("work", vec![("task", Some(arg("consume"))), ("units", Some(text(out.to_string()))), ("at", Some(arg(home)))]));
        } else {
            let mut left = each;
            for (at, q) in &had {
                let u = left.min(*q);
                if u <= 0 {
                    break;
                }
                lines.push(call("work", vec![("task", Some(arg("consume"))), ("units", Some(text(u.to_string()))), ("at", Some(arg(at)))]));
                left -= u;
            }
        }
        w.push(because(
            format!(
                "Using up {each} of the {total} {goods} we have: what we have, spread over the {weeks} week{} until we shop again{}.",
                if weeks > 1 { "s" } else { "" },
                if fetched { " (bringing home what's elsewhere)" } else { "" }
            ),
            lines,
        ));
    }
}


#[cfg(test)]
mod tests {
    //! participants/test/payments.test.ts (a claimant's half), and the person's side of spending, shopping, bills
    //! and borrowing, rewritten to assert behaviour.
    use super::*;
    use crate::{Ctx, Draws, WorldInfo};
    use oikos_sight::{AccountItem, HoldingItem, ParticipantStatus, Picture};

    const YEAR: i64 = 365 * DAY;

    fn ctx(extra: Value) -> Ctx {
        let mut params = json!({ "mind": "plain", "year": YEAR, "bank": "bank", "essentials": 40_000 });
        for (k, v) in extra.as_object().unwrap() {
            params[k] = v.clone();
        }
        Ctx { participant: "p.c1".into(), performer: Default::default(), entity: "c1".into(), position: None, params: serde_json::from_value(params).unwrap(), world: Arc::new(WorldInfo::default()) }
    }

    fn pic(t: i64, age: i64, balance: i64, holdings: Vec<(&str, i64)>) -> Picture {
        let mut channels = BTreeMap::new();
        let acc = AccountItem { account: "acc-c1".into(), holder: "c1".into(), custodian: "bank".into(), currency: "USD".into(), balance: i128::from(balance), closed: None };
        channels.insert("accounts".to_string(), Seen::Accounts { accounts: Arc::new(vec![acc]), transactions: vec![] });
        let h: Vec<HoldingItem> = holdings.into_iter().map(|(at, q)| HoldingItem { kind: "goods".into(), at: at.into(), quantity: i128::from(q) }).collect();
        channels.insert("holdings".to_string(), Seen::Holdings { holdings: Arc::new(h) });
        Picture {
            participant: "p.c1".into(),
            t,
            status: ParticipantStatus::Active,
            entity: "c1".into(),
            as_position: None,
            body: Some(serde_json::from_value(json!({ "born_at": t - age * YEAR, "present": true, "alive": true })).unwrap()),
            positions: vec![],
            outcomes: vec![],
            inbox: vec![],
            channels,
            asking: vec![],
            readings: BTreeMap::new(),
            woke_for: "cadence".into(),
            since: 0,
        }
    }

    fn rec(v: Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).expect("a record"))
    }
    fn st(id: &str, at: i64, kind: &str, by: &str, to: &[&str], data: Value) -> Arc<Record> {
        rec(json!({ "id": id, "record": "statement", "author": format!("p.{by}"), "speaks_for": by, "at": at, "visible_to": "public", "kind": kind, "text": kind, "addressed_to": to, "data": data }))
    }
    fn law(rules: Value) -> Arc<Record> {
        st("rec.1", 0, "law", "outside", &[], json!({ "payments": rules }))
    }

    /// A person at `t`: what they saw taken in, the part of the plan run, and the steps it planned.
    fn run(p: &mut Person, ctx: &Ctx, t: i64, age: i64, balance: i64, seen: &[Arc<Record>], part: impl Fn(&mut Person, &mut Week)) -> Vec<Step<()>> {
        let fresh = p.book.take_all(seen.iter());
        p.absorbed.fresh.extend(fresh.iter().map(|r| r.id.clone()));
        let picture = pic(t, age, balance, vec![]);
        let mut d = Draws::new("p.c1", "self");
        let mut cx = Cx::new(t, ctx, &mut d, 7, vec![]);
        let mut w = Week { acc: crate::common::money::own_banked(&picture, "c1"), pic: &picture, cx: &mut cx, t, steps: vec![] };
        part(p, &mut w);
        p.absorbed.fresh.clear();
        w.steps.into_iter().map(|s| s.step).collect()
    }
    use crate::steps::Step;

    fn said<'a>(steps: &'a [Step<()>], kind: &str) -> Vec<&'a Value> {
        steps
            .iter()
            .flat_map(|s| s.lines.iter())
            .filter(|l| l.call.fn_ == "statement" && l.call.args.iter().any(|(k, v)| k == "kind" && matches!(v, oikos_sight::calls::Value::Id(x) if x == kind)))
            .filter_map(|l| l.call.args.iter().find(|(k, _)| k == "data").and_then(|(_, v)| if let oikos_sight::calls::Value::Json(j) = v { Some(j) } else { None }))
            .collect()
    }
    fn calls<'a>(steps: &'a [Step<()>], f: &str) -> Vec<&'a oikos_sight::calls::Call> {
        steps.iter().flat_map(|s| s.lines.iter()).map(|l| &l.call).filter(|c| c.fn_ == f).collect()
    }
    fn arg_of(c: &oikos_sight::calls::Call, k: &str) -> String {
        match c.args.iter().find(|(n, _)| n == k).map(|(_, v)| v) {
            Some(oikos_sight::calls::Value::Id(s)) | Some(oikos_sight::calls::Value::Text(s)) => s.clone(),
            Some(v) => format!("{v:?}"),
            None => String::new(),
        }
    }
    fn decision(id: &str, t: i64, claim: &str, payment: &str, granted: bool, x: Value) -> Arc<Record> {
        let mut d = json!({ "claim": claim, "payment": payment, "granted": granted });
        for (k, v) in x.as_object().unwrap() {
            d[k] = v.clone();
        }
        st(id, t, "benefit_decision", "outside", &["c1"], d)
    }

    #[test]
    fn out_of_work_claims_the_first_payment_listed_then_the_next_when_refused_and_not_the_refused_again_at_that_age() {
        let c = ctx(json!({}));
        let mut p = Person::new(&c).unwrap();
        let rules = json!([
            { "id": "older", "payer": "outside", "account": "o", "every_days": 30, "who": { "out_of_work": true, "from_age": 50 }, "amount": { "flat": 6_000 } },
            { "id": "basic", "payer": "outside", "account": "o", "every_days": 30, "who": { "out_of_work": true }, "amount": { "flat": 4_000 } },
            { "id": "pension", "payer": "outside", "account": "o", "every_days": 30, "who": { "from_age": 67 }, "amount": { "flat": 9_000 } }
        ]);
        let first = run(&mut p, &c, DAY, 40, 500_000, &[law(rules)], Person::claims);
        assert_eq!(said(&first, "benefit_claim"), vec![&json!({ "payment": "older", "account": "acc-c1", "born_at": DAY - 40 * YEAR })]);
        assert_eq!(first[0].why.as_deref(), Some("Out of work: claiming older support while we look."));
        // Refused (the office applies the age): the next one.
        assert!(said(&run(&mut p, &c, 2 * DAY, 40, 500_000, &[decision("rec.3", 2 * DAY, "rec.2", "older", false, json!({}))], Person::claims), "benefit_claim").is_empty());
        let third = run(&mut p, &c, 3 * DAY, 40, 500_000, &[], Person::claims);
        assert_eq!(said(&third, "benefit_claim").iter().map(|d| d["payment"].as_str().unwrap()).collect::<Vec<_>>(), ["basic"]);
        // Granted: nothing more is claimed, and the refused one isn't asked for again at this age.
        let granted = decision("rec.5", 4 * DAY, "rec.4", "basic", true, json!({ "amount": 4_000, "every": 30 * DAY }));
        assert!(said(&run(&mut p, &c, 4 * DAY, 40, 500_000, &[granted], Person::claims), "benefit_claim").is_empty());
        assert_eq!(p.s.benefits["basic"].amount, 4_000);
        assert!(said(&run(&mut p, &c, 40 * DAY, 40, 500_000, &[], Person::claims), "benefit_claim").is_empty());
        // In work again: the payment is asked to stop.
        p.s.job = Some(super::super::person::Job { agreement: "rec.9".into(), employer: "shop".into(), wage: 100_000, period: MONTH, ..Default::default() });
        let back = run(&mut p, &c, 50 * DAY, 40, 500_000, &[], Person::claims);
        assert_eq!(said(&back, "benefit_change"), vec![&json!({ "claim": "rec.4", "stop": true })]);
        assert!(p.s.benefits.is_empty());
    }

    #[test]
    fn a_payment_that_turns_on_a_record_of_contributions_is_not_claimed_by_someone_who_has_not_worked_here() {
        let c = ctx(json!({}));
        let rules = json!([
            { "id": "insurance", "payer": "outside", "every_days": 30, "who": { "out_of_work": true, "record": {} }, "amount": { "share_bps": 6000, "of": "gross" } },
            { "id": "basic", "payer": "outside", "every_days": 30, "who": { "out_of_work": true }, "amount": { "flat": 4_000 } }
        ]);
        let mut p = Person::new(&c).unwrap();
        let s = run(&mut p, &c, DAY, 40, 500_000, &[law(rules.clone())], Person::claims);
        assert_eq!(said(&s, "benefit_claim").iter().map(|d| d["payment"].as_str().unwrap()).collect::<Vec<_>>(), ["basic"]);
        let mut q = Person::new(&c).unwrap();
        let only = json!([rules[0].clone()]);
        assert!(said(&run(&mut q, &c, DAY, 40, 500_000, &[law(only)], Person::claims), "benefit_claim").is_empty());
    }

    #[test]
    fn a_pension_is_claimed_at_its_own_age_by_someone_still_working_with_the_rules_declarations() {
        let rules = json!([{ "id": "pension", "payer": "outside", "every_days": 30, "who": { "from_age": 67, "no_other_pension": true, "income_under": { "amount": 300_000, "per": "household" } }, "amount": { "flat": 9_000 } }]);
        let c = ctx(json!({ "stops_work_at": 72, "retirement_age": 67 }));
        let mut works = Person::new(&c).unwrap();
        let s = run(&mut works, &c, DAY, 68, 500_000, &[law(rules.clone())], Person::claims);
        assert_eq!(
            said(&s, "benefit_claim"),
            vec![&json!({ "payment": "pension", "account": "acc-c1", "born_at": DAY - 68 * YEAR, "declares": { "household_income": 0, "household_members": 1, "other_pension": false } })]
        );
        assert_eq!(s[0].why.as_deref(), Some("At 68: claiming pension support."));
        let mut young = Person::new(&c).unwrap();
        assert!(said(&run(&mut young, &c, DAY, 60, 500_000, &[law(rules)], Person::claims), "benefit_claim").is_empty());
    }

    #[test]
    fn take_up_none_claims_as_before_nought_never_claims_and_a_share_draws_alike_for_a_twin() {
        let rules = json!([{ "id": "basic", "payer": "outside", "every_days": 30, "who": { "out_of_work": true }, "amount": { "flat": 4_000 } }]);
        let claimed = |extra: Value| {
            let c = ctx(extra);
            let mut p = Person::new(&c).unwrap();
            let mut n = 0;
            for week in 0..10 {
                n += said(&run(&mut p, &c, DAY + week * 7 * DAY, 40, 500_000, &[law(rules.clone())], Person::claims), "benefit_claim").len();
            }
            n
        };
        assert_eq!(claimed(json!({})), 1, "no take-up given: everyone entitled claims");
        assert_eq!(claimed(json!({ "take_up_bps": 10_000 })), 1);
        assert_eq!(claimed(json!({ "take_up_bps": 0 })), 0, "take-up nought: nobody claims, week after week");
        // (A share: the draw is the person's and the payment's, once a spell, so a twin decides alike.)
        let half = json!({ "take_up_bps": 5_000 });
        assert_eq!(claimed(half.clone()), claimed(half));
    }

    fn price_list(id: &str, shop: &str, price: i64) -> Arc<Record> {
        st(id, 0, "price_list", shop, &[], json!({ "goods": { "goods": price }, "account": format!("acc-{shop}"), "at": format!("{shop}-premises") }))
    }

    #[test]
    fn a_trip_spends_the_fortnights_budget_at_the_chosen_shop_and_tries_another_for_what_it_could_not_serve() {
        let c = ctx(json!({ "saving_bps": 0, "wealth_effect_bps_per_year": 0, "shop_every_days": 14, "income_window_days": 90 }));
        let mut p = Person::new(&c).unwrap();
        p.money.next_shop = 0;
        let seen = [price_list("rec.1", "s1", 1_000), price_list("rec.2", "s2", 1_200)];
        let trip = run(&mut p, &c, DAY, 40, 100_000, &seen, Person::shopping);
        // Nothing comes in: the month's spending is its essentials (40,000), and a fortnight's is 14/30 of it.
        let orders = said(&trip, "order");
        assert_eq!(orders.len(), 1);
        let budget = 40_000 * 14 * DAY / MONTH;
        assert_eq!(orders[0]["quantity"], json!(budget / 1_000));
        assert_eq!(orders[0]["at"], json!("s1-premises"), "no home: kept at the shop for us");
        assert_eq!(p.money.favourite.as_deref(), Some("s1"));
        let pays = calls(&trip, "money");
        assert_eq!(arg_of(pays[0], "to"), "acc-s1");
        // The shop could serve 10 of them: the rest is tried at the other, for what the money buys there.
        let q = orders[0]["quantity"].as_i64().unwrap();
        let note = st("rec.9", 2 * DAY, "delivery_note", "s1", &["c1"], json!({ "order": "rec.8", "kind": "goods", "ordered": q, "delivered": 10, "refund": (q - 10) * 1_000 }));
        let retry = run(&mut p, &c, 2 * DAY, 40, 100_000, &[note], Person::shopping);
        let again = said(&retry, "order");
        assert_eq!(again.len(), 1);
        assert_eq!((again[0]["quantity"].as_i64().unwrap(), again[0]["retry_of"].as_str()), (((q - 10) * 1_000) / 1_200, Some("rec.8")));
        assert_eq!(p.s.inflows.last(), Some(&(2 * DAY, -(q - 10) * 1_000)), "a refund isn't income");
        assert_eq!(p.money.last_served, half_up(10 * 10_000, q));
    }

    #[test]
    fn what_we_hold_is_used_up_over_the_weeks_until_the_next_trip() {
        let c = ctx(json!({}));
        let mut p = Person::new(&c).unwrap();
        p.book.take_all(&[price_list("rec.1", "s1", 1_000)]);
        p.money.next_shop = 15 * DAY;
        let picture = pic(DAY, 40, 0, vec![("s1-premises", 9)]);
        let mut d = Draws::new("p.c1", "self");
        let mut cx = Cx::new(DAY, &c, &mut d, 7, vec![]);
        let mut w = Week { acc: None, pic: &picture, cx: &mut cx, t: DAY, steps: vec![] };
        p.use_up(&mut w);
        let steps: Vec<Step<()>> = w.steps.into_iter().map(|s| s.step).collect();
        let used = calls(&steps, "work");
        assert_eq!((arg_of(used[0], "units"), arg_of(used[0], "at")), ("5".to_string(), "s1-premises".to_string()), "9 over 2 weeks: 5 this week, at the shop");
        assert_eq!(steps[0].why.as_deref(), Some("Using up 5 of the 9 goods we have: what we have, spread over the 2 weeks until we shop again."));
    }

    #[test]
    fn a_world_without_shops_spends_a_month_at_once_and_bills_count_with_the_rent() {
        let c = ctx(json!({ "saving_bps": 500, "shop_accounts": ["acc-shop"] }));
        let mut p = Person::new(&c).unwrap();
        p.money.next_spend = 0;
        let s = run(&mut p, &c, DAY, 40, 100_000, &[], Person::spending);
        let pay = calls(&s, "money");
        assert_eq!(arg_of(pay[0], "to"), "acc-shop");
        assert_eq!(s[0].why.as_deref(), Some("Monthly shopping: what we don't save of our income (95%) less the rent, and a little out of savings."));
        p.money.bills = vec![(0, 9_000)];
        assert_eq!(p.bills_monthly(10 * DAY), 9_000 * MONTH / (40 * DAY));
        assert_eq!(p.bills_monthly(200 * DAY), 0, "a bill over 90 days old no longer counts");
    }

    #[test]
    fn ordered_or_recorded_against_us_we_pay_when_we_can_keeping_a_months_essentials() {
        let c = ctx(json!({}));
        let mut p = Person::new(&c).unwrap();
        let order = st("rec.1", 0, "tribunal_order", "tribunal", &["c1"], json!({ "against": "c1", "finding": "pay", "amount": 30_000, "to": "acc-x", "claim": "rec.0" }));
        let fine = rec(json!({ "id": "rec.2", "record": "claim", "author": "p.town", "speaks_for": "town", "at": 0, "visible_to": "public", "position": "right", "holder": "town", "counterparty": "c1", "about": { "kind": "fine", "amount": 20_000, "account": "acc-town", "for": "littering" } }));
        // 60,000: the order (30,000) leaves 30,000, under the fine plus essentials.
        let s = run(&mut p, &c, DAY, 40, 75_000, &[order.clone(), fine.clone()], |p, w| {
            p.ordered_to_pay(w);
            p.recorded_against(w);
        });
        let pays = calls(&s, "money");
        assert_eq!(pays.len(), 1);
        assert_eq!((arg_of(pays[0], "to"), arg_of(pays[0], "settles")), ("acc-x".to_string(), "rec.0".to_string()));
        let s = run(&mut p, &c, 8 * DAY, 40, 100_000, &[], |p, w| {
            p.ordered_to_pay(w);
            p.recorded_against(w);
        });
        let pays = calls(&s, "money");
        assert_eq!(pays.len(), 1, "the order is paid once");
        assert_eq!(arg_of(pays[0], "settles"), "rec.2");
        assert_eq!(s[0].why.as_deref(), Some("Paying the fine recorded against us (littering)."));
    }

    #[test]
    fn short_of_next_months_housing_with_income_coming_in_we_ask_for_a_loan_and_sign_the_one_offered() {
        let c = ctx(json!({}));
        let mut p = Person::new(&c).unwrap();
        p.s.share = Some((50_000, None));
        p.s.job = Some(super::super::person::Job { agreement: "rec.9".into(), employer: "shop".into(), wage: 100_000, period: MONTH, ..Default::default() });
        let s = run(&mut p, &c, DAY, 40, 20_000, &[], Person::recorded_against);
        let app = said(&s, "loan_application");
        // Three months of housing and essentials (270,000) less what we have, up to a whole 100.00.
        assert_eq!(app, vec![&json!({ "amount": 250_000, "months": 12, "account": "acc-c1", "purpose": "living costs" })]);
        assert!(said(&run(&mut p, &c, 2 * DAY, 40, 20_000, &[], Person::recorded_against), "loan_application").is_empty(), "waiting on the answer");
        let loan = rec(json!({ "id": "rec.5", "record": "agreement", "author": "p.bank", "at": 3 * DAY, "visible_to": ["bank", "c1"], "terms": { "template": "loan", "parties": ["bank", "c1"],
            "commitments": [{ "who": "c1", "does": { "outcome": { "money": { "to": "acc-bank", "amount": "22000" } } }, "every": MONTH }] } }));
        let s = run(&mut p, &c, 3 * DAY, 40, 20_000, &[loan], Person::borrowing);
        assert_eq!(calls(&s, "agreement").len(), 1);
        let pay = calls(&s, "money");
        assert_eq!((arg_of(pay[0], "to"), arg_of(pay[0], "basis")), ("acc-bank".to_string(), "rec.5".to_string()));
        assert!(run(&mut p, &c, 4 * DAY, 40, 20_000, &[], Person::borrowing).is_empty(), "signed once");
    }

    #[test]
    fn the_support_law_in_force_is_the_latest_and_a_payments_payer_is_its_speaker() {
        let mut b = crate::common::Book::new();
        b.take_all(&[st("rec.1", 0, "law", "a", &[], json!({ "payments": [{ "id": "x", "every_days": 30, "amount": { "flat": 1 } }] })), st("rec.2", 5, "law", "b", &[], json!({ "payments": [{ "id": "y", "every_days": 30, "amount": { "household": 1 } }] }))]);
        let l = support_law(&b);
        assert_eq!((l[0].id.as_str(), l[0].payer.as_deref(), l[0].for_household()), ("y", Some("b"), true));
        let f = ClaimFacts { household_income: 5, household_members: 3, children_born_at: vec![1], other_pension: false };
        assert_eq!(declaration_for(&l[0], &f), Some(Declared { household_members: Some(3), ..Default::default() }));
        assert_eq!(pct_kept(550), "94.5");
    }
}
