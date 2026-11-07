//! Credit (phase C, stage C2): loans as agreements (participants/src/behaviour/credit.ts; docs/behaviour/credit.md). A
//! lender's office (`bank.lending`) decides applications on what it can see of the applicant's account, pays out, and
//! follows repayments into arrears and default; borrowers (households, factories, shops) apply when short, take the loan
//! offered, and repay by standing order (`Borrowing`, a library the citizen's life and the firms hold).
//!
//! `bank.lending`: decides applications by the bank's rules: repayments, at the loan's rate plus the serviceability buffer,
//! within a share of what came into the applicant's account over the last three months (what the bank can see: it keeps
//! the account); nothing to anyone in default. It offers a loan agreement (principal out; repayments monthly over the
//! term); once the borrower signs, it pays the principal out, drawing funding from outside if its own money will not cover
//! it. It follows repayments: a month behind is arrears (a notice); `default_days` behind is default (a notice, and the
//! debt recorded as a claim). It pays interest on its funding monthly, and repays funding when it can.
//!
//! Rewritten for Rust: the rules are TS's 0.5.0. Decided fresh: loans are indexed by the borrower's account (a repayment
//! is set against that account's loans without scanning every loan); applications are decided in the order they were filed
//! (`filed_before`, not the string order of their ids); the order lenders' rates are listed in a public notice is person
//! first, then organisation, then any other (a JSON object has no order here); a draw on funding is the ceiling-rounded
//! interest of whole numbers, no floating point. The lending office's own staff payroll (`pay_staff`: an employer's
//! routine, C1's `Staffing`) is a seam (`StaffPayroll`): the integration step wires C1's staffing to it.
//!
//! Not done in this port, and why (risk register ME-8): the lender still reads income as the least that came in over any of
//! the last three months, and draws funding without limit. Neither is a fault that corrupts data; both are listed there.

use oikos_core::frozen::JsonRead;
use super::{manifest_of, spread};
use crate::common::{
    addressed_to, cents, data, filed_before, look_up, money_words, own_account, record as right, Answering, Asked, Book, Fields, OwnAccount, DAY, LOOKS_MAX, MONTH,
};
use crate::papers::agreements::{commitment_of, offer, sign, Offer};
use crate::steps::{because, pay, say, Done, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms::Answers;
use oikos_sight::{LookRequest, RecordBody};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

// ------------------------------------------------------------------ the arithmetic of a loan

/// The monthly repayment on a loan (the credit-foncier formula: fixed payments that repay principal and interest over the
/// term), in cents, rounded up. Worked in ordinary arithmetic (no powers), so every machine gets the same answer: the
/// growth factor of the term is built by repeated multiplication in 128-bit fixed point (twelve decimal places).
pub fn repayment(principal: i64, annual_bps: i64, months: i64) -> i64 {
    if months <= 0 {
        return principal;
    }
    if annual_bps == 0 {
        return (principal + months - 1).div_euclid(months);
    }
    // r = annual_bps / 12 / 10_000, held as r_num / r_den with r_den = 120_000 * SCALE.
    const SCALE: i128 = 1_000_000_000_000;
    let step = SCALE + (annual_bps as i128 * SCALE) / 120_000; // 1 + r, scaled
    let mut f: i128 = SCALE;
    for _ in 0..months {
        f = f * step / SCALE;
    }
    // principal * r * f / (f - 1), with r = annual_bps / 120_000 and f scaled.
    let num = principal as i128 * annual_bps as i128 * f;
    let den = 120_000 * (f - SCALE);
    ((num + den - 1) / den) as i64
}

/// A share of an amount, in ten-thousandths, as a whole number of the smallest unit: rounded down.
pub fn share_down(amount: i64, bps: i64) -> i64 {
    (amount as i128 * bps as i128).div_euclid(10_000) as i64
}

/// A share of an amount, in ten-thousandths, rounded up.
pub fn share_up(amount: i64, bps: i64) -> i64 {
    let n = amount as i128 * bps as i128;
    (n.div_euclid(10_000) + i128::from(n.rem_euclid(10_000) > 0)) as i64
}

/// The most a lender lends against a price at a share of it (a loan-to-value limit): that share, rounded down to a whole
/// unit. A loan is within the limit exactly when it is no more than this.
pub fn most_against(price: i64, lvr_bps: i64) -> i64 {
    share_down(price, lvr_bps)
}

/// What a buyer borrows for something at a price, putting down a share of it as the deposit: the deposit is rounded up to a
/// whole unit, so the loan is the rest of the price rounded down. A lender that lends at most the rest of the price (80%
/// against a 20% deposit) admits it at any price (docs/decisions.md, "A home loan asked a fraction over the limit").
pub fn loan_for(price: i64, deposit_bps: i64) -> i64 {
    price - share_up(price, deposit_bps)
}

/// What is left on a loan: its remaining repayments' present value at its rate (what paying it off now takes).
pub fn payout(payment: i64, annual_bps: i64, months_left: i64) -> i64 {
    if months_left <= 0 {
        return 0;
    }
    if annual_bps == 0 {
        return payment * months_left;
    }
    // payment * (1 - (1 + r)^-n) / r, with r = annual_bps / 120_000: the discount built by n divisions, scaled.
    const SCALE: i128 = 1_000_000_000_000;
    let step = SCALE + (annual_bps as i128 * SCALE) / 120_000;
    let mut inv: i128 = SCALE;
    for _ in 0..months_left {
        inv = inv * SCALE / step;
    }
    let num = payment as i128 * (SCALE - inv) * 120_000;
    let den = annual_bps as i128 * SCALE;
    ((num + den - 1) / den) as i64
}

/// A rate in basis points as a percentage in words, the way a number is written (12, 8.5, 8.25).
pub fn pct(bps: i64) -> String {
    let (whole, frac) = (bps / 100, (bps % 100).abs());
    match frac {
        0 => whole.to_string(),
        f if f % 10 == 0 => format!("{whole}.{}", f / 10),
        f => format!("{whole}.{f:02}"),
    }
}

/// A number a seat or a form wrote, as `Number(x)` read it and `Math.floor` rounded it (nought where it is not one).
fn num<V: JsonRead + ?Sized>(v: Option<&V>) -> i64 {
    v.and_then(super::floor_of).unwrap_or(0)
}

/// The yearly rate a loan's own words state, "(12.5% a year)" -> 1250 (basis points, rounded half up).
fn rate_in(text: &str) -> Option<i64> {
    let end = text.find("% a year)")?;
    let head = &text[..end];
    let start = head.rfind(|c: char| !(c.is_ascii_digit() || c == '.')).map_or(0, |i| i + 1);
    if start == 0 || !head[..start].ends_with('(') || start == head.len() {
        return None;
    }
    super::scaled(&Value::String(head[start..].to_string()), 100)
}

// ------------------------------------------------------------------ a borrower's side

/// A borrower's side: apply to a lender when short, take the loan offered (sign it, and ask the bank to pay the repayments
/// monthly), and remember a refusal for a while. The same for a household or a firm. Held in its owner's state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Borrowing {
    me: String,
    lender: String,
    /// After a refusal.
    retry_days: i64,
    /// A firm that is repaying a loan may apply for another this long after the last was granted, and the bank decides it on
    /// its rule (it counts what the borrower already repays); without it, one loan at a time until it is repaid.
    again_days: Option<i64>,
    /// When we applied, if we are waiting to hear.
    applied: Option<i64>,
    refused_at: Option<i64>,
    /// When a loan was last approved, or signed for: its money is on the way.
    granted_at: Option<i64>,
    taken: BTreeSet<String>,
    /// A loan we are repaying (or have been offered): no other till it is done.
    repaying_until: Option<i64>,
    /// We have defaulted: the lender will not lend to us again.
    pub impaired: bool,
}

impl Borrowing {
    pub fn new(me: &str, lender: &str, retry_days: Option<i64>, again_days: Option<i64>) -> Borrowing {
        Borrowing {
            me: me.into(),
            lender: lender.into(),
            retry_days: retry_days.unwrap_or(60),
            again_days,
            applied: None,
            refused_at: None,
            granted_at: None,
            taken: BTreeSet::new(),
            repaying_until: None,
            impaired: false,
        }
    }

    /// Waiting on an application (so do not act as if the money will not come, for a few days), or on the money of a loan
    /// granted: the lender pays it out once it has seen our signature, at its next look, not in the moment we sign (a day is
    /// allowed for it). Without the second, a firm let someone go for want of a loan in the moment it signed for one.
    pub fn waiting(&self, t: i64) -> bool {
        self.applied.is_some_and(|a| t - a < 14 * DAY) || self.granted_at.is_some_and(|g| t - g < DAY)
    }

    /// Whether we would apply now: not waiting, not refused lately, not in default.
    pub fn can_apply(&self, t: i64) -> bool {
        !self.lender.is_empty()
            && !self.waiting(t)
            && !self.impaired
            && match self.again_days {
                Some(d) => self.granted_at.is_none_or(|g| t - g >= d * DAY),
                None => self.repaying_until.is_none_or(|u| t >= u),
            }
            && self.refused_at.is_none_or(|r| t - r >= self.retry_days * DAY)
    }

    /// Applying: how much, over how long, from and to which account, and why (the lender reads the account itself).
    #[allow(clippy::too_many_arguments)]
    pub fn apply<T>(&mut self, t: i64, account: &str, amount: i64, months: i64, purpose: &str, why: &str, extra: Value, cx: &Cx) -> Step<T> {
        self.applied = Some(t);
        let mut d = json!({ "amount": amount, "months": months, "account": account, "purpose": purpose });
        if let (Some(d), Value::Object(e)) = (d.as_object_mut(), extra) {
            d.extend(e);
        }
        because(
            why,
            vec![say(
                "loan_application",
                &format!("Application for a loan of {} over {months} months, for {purpose}.", money_words(amount, &cx.ctx.world)),
                Say { to: Some(vec![self.lender.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), self.lender.clone()])), data: Some(d), ..Default::default() },
            )],
        )
    }

    /// Each observation: decisions on our applications, loans offered to us (signed, and repaid by standing order), defaults.
    pub fn steps<T>(&mut self, book: &Book, t: i64, account: Option<&str>, cx: &Cx) -> Vec<Step<T>> {
        let mut steps = vec![];
        for r in book.all("loan_decision") {
            if self.taken.contains(r.id.as_str()) || !addressed_to(r).iter().any(|x| x == &self.me) {
                continue;
            }
            self.taken.insert(r.id.to_string());
            self.applied = None;
            if !data(r).flag("approved") {
                self.refused_at = Some(t);
            } else {
                let months = Some(num(data(r).get("months"))).filter(|m| *m != 0).unwrap_or(12);
                self.repaying_until = Some(self.repaying_until.map_or(t + months * MONTH, |u| u.max(t + months * MONTH)));
                self.granted_at = Some(t);
            }
        }
        if book.all("loan_default").any(|r| addressed_to(r).iter().any(|x| x == &self.me)) {
            self.impaired = true;
        }
        let Some(account) = account else { return steps };
        for r in book.of_type("agreement") {
            let RecordBody::Agreement { terms } = &r.body else { continue };
            if terms.template.as_deref() != Some("loan")
                || !terms.parties.contains(&self.me)
                || terms.parties.first() != Some(&self.lender)
                || self.taken.contains(r.id.as_str())
                || book.signed_by(&r.id, &self.me)
                || book.taken_back(&r.id)
            {
                continue;
            }
            self.taken.insert(r.id.to_string());
            self.applied = None;
            let (owe, every) = commitment_of(r, &self.me);
            let Some(m) = owe.and_then(|o| o.money) else { continue };
            self.granted_at = Some(t);
            steps.push(because(
                format!("The loan we applied for is offered: signing, and asking our bank to pay the {} a month.", money_words(m.amount, &cx.ctx.world)),
                vec![
                    sign(&r.id),
                    pay(&m.to, m.amount, Pay { from: Some(account.to_string()), every: Some(every.unwrap_or(MONTH)), first: Some(every.unwrap_or(MONTH)), basis: Some(r.id.to_string()), for_: Some("Loan repayment.".into()), ..Default::default() }, cx),
                ],
            ));
        }
        steps
    }
}

// ------------------------------------------------------------------ the lending office

/// What a lender remembers of a loan it has made.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Loan {
    agreement: String,
    borrower: String,
    account: String,
    principal: i64,
    payment: i64,
    months: i64,
    start: Option<i64>,
    arrears_notice_at: Option<i64>,
    defaulted: bool,
    rate_bps: Option<i64>,
}

/// The bank's own staff payroll, as an employer's routine (C1's `Staffing`; foundations F6): paid, their tax paid over,
/// starts and stops (a death), returns on the law's days. A seam: a lane that owns the employer's routine implements this
/// and hands the kind a maker (`Lending::payroll`). Its memory is saved and restored with the lender's.
pub trait StaffPayroll: Send {
    fn absorb(&mut self, pic: &Picture, cx: &mut Cx);
    /// The routine for today, given the book and the bank's own account.
    fn routine(&mut self, pic: &Picture, book: &Book, own: &OwnAccount, cx: &mut Cx) -> Vec<Step<()>>;
    fn save(&self) -> Value;
}

/// Builds the payroll for a lender in this context from what `save` left (`Null`: new).
pub type PayrollMaker = fn(&Ctx, &Value) -> Result<Box<dyn StaffPayroll>, String>;

#[derive(Default)]
struct PayrollSlot {
    inner: Option<Box<dyn StaffPayroll>>,
    saved: Value,
}

impl Serialize for PayrollSlot {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.inner.as_ref().map_or_else(|| self.saved.clone(), |p| p.save()).serialize(s)
    }
}
impl<'de> Deserialize<'de> for PayrollSlot {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(PayrollSlot { inner: None, saved: Value::deserialize(d)? })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Terms {
    /// Lending rates, a year, by kind of applicant.
    rate_bps: BTreeMap<String, i64>,
    /// Assessed at the rate plus this (serviceability).
    buffer_bps: i64,
    /// Of monthly income, for repayments.
    max_share_bps: BTreeMap<String, i64>,
    max_months: i64,
    /// A loan for a home, at its own rate, over longer, for at most a share of the price (the loan-to-value ratio). 0: none.
    mortgage_rate_bps: i64,
    mortgage_max_months: i64,
    max_lvr_bps: i64,
    /// This far behind: default.
    default_days: i64,
    /// This far behind: arrears (a notice).
    arrears_days: i64,
    /// Kept in the bank's own account, cents.
    reserve: i64,
    /// Who lends the bank money when it is short (an entity outside).
    funding_from: Option<String>,
    funding_rate_bps: i64,
    /// Its channel onto who's who, where it looks up what kind of applicant it has ("": it knows what it is shown).
    who: String,
    pay_staff: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum Then {
    /// A loan offered: when it is made, the lender remembers it by the agreement's id.
    Offered { borrower: String, account: String, principal: i64, payment: i64, months: i64, rate_bps: i64 },
    /// A draw on funding asked for: the record that the funder's payment will settle.
    Draw,
}

#[derive(Serialize, Deserialize)]
struct Lender {
    me: String,
    p: Terms,
    asked: Asked,
    book: Book,
    decided: BTreeSet<String>,
    loans: BTreeMap<String, Loan>,
    /// A borrower's account -> the loans repaid from it.
    by_account: BTreeMap<String, BTreeSet<String>>,
    /// Account -> what came in (last 90 days).
    inflows: BTreeMap<String, VecDeque<(i64, i64)>>,
    /// Agreement -> repaid so far.
    repaid: BTreeMap<String, i64>,
    /// Borrowers in default.
    defaulted: BTreeSet<String>,
    /// What we owe our funder.
    funding: i64,
    /// A draw asked for and not yet come.
    funding_asked: i64,
    /// That draw's record (the funder's payment settles it).
    draw_id: Option<String>,
    funder_account: Option<String>,
    next_interest: i64,
    own: Option<String>,
    terms_offered: bool,
    /// A loan -> when a payment of ours that settles it was seen to leave (its principal paid out).
    paid_out: BTreeMap<String, i64>,
    /// Loans in force when we first looked (the world's: mortgages already being repaid), taken on.
    adopted: bool,
    payroll_day: i64,
    payroll: PayrollSlot,
}

impl Lender {
    fn add_loan(&mut self, l: Loan) {
        self.by_account.entry(l.account.clone()).or_default().insert(l.agreement.clone());
        self.loans.insert(l.agreement.clone(), l);
    }

    /// What an applicant already owes us each month.
    fn current(&self, who: &str) -> Vec<&Loan> {
        self.loans.values().filter(|l| l.borrower == who && !l.defaulted && (l.start.is_none() || self.repaid.get(&l.agreement).copied().unwrap_or(0) < l.payment * l.months)).collect()
    }

    /// Whether they are behind on it.
    fn behind(&self, who: &str, t: i64) -> bool {
        self.current(who).iter().any(|l| l.start.is_some_and(|s| (l.months).min((t - s).div_euclid(MONTH)) * l.payment > self.repaid.get(&l.agreement).copied().unwrap_or(0)))
    }

    /// Regular income, as a lender reads a statement: the least that came in in any of the last three months (a one-off sum
    /// is not income; without three months of history there is nothing to lend against).
    fn income_of(&self, account: &str, t: i64) -> i64 {
        let Some(fs) = self.inflows.get(account) else { return 0 };
        (0..3).map(|k| fs.iter().filter(|(at, _)| *at >= t - (k + 1) * MONTH && *at < t - k * MONTH).map(|(_, a)| *a).sum::<i64>()).min().unwrap_or(0)
    }
}

pub struct Lending {
    pub payroll: Option<PayrollMaker>,
}

const MANIFEST: &str = include_str!("manifests/bank.lending.json");

impl Kind for Lending {
    fn name(&self) -> &'static str {
        "bank.lending"
    }
    fn version(&self) -> &'static str {
        "0.6.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/credit.md"
    }
    fn manifest(&self) -> Value {
        let mut m = manifest_of(MANIFEST);
        m["version"] = self.version().into();
        m["answers"] = json!({ "office": "the bank's lending office", "acts": ANSWERS.1 });
        m
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        spread(ctx, "first-wake", 24) * 3600
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let people = |person: i64, organisation: i64| BTreeMap::from([("person".to_string(), person), ("organisation".to_string(), organisation)]);
        let p = Terms {
            rate_bps: ctx.param("rate_bps", people(1200, 800))?,
            buffer_bps: ctx.param("buffer_bps", 300)?,
            max_share_bps: ctx.param("max_share_bps", people(3000, 2000))?,
            max_months: ctx.param("max_months", 60)?,
            mortgage_rate_bps: ctx.param("mortgage_rate_bps", 0)?,
            mortgage_max_months: ctx.param("mortgage_max_months", 360)?,
            max_lvr_bps: ctx.param("max_lvr_bps", 8000)?,
            default_days: ctx.param("default_days", 90)?,
            arrears_days: ctx.param("arrears_days", 30)?,
            reserve: ctx.param("reserve", 5_000_000)?,
            funding_from: ctx.param::<Option<String>>("funding_from", None)?.filter(|f| !f.is_empty()),
            funding_rate_bps: ctx.param("funding_rate_bps", 500)?,
            who: ctx.param("who", String::new())?,
            pay_staff: ctx.param("pay_staff", false)?,
        };
        let payroll = match (p.pay_staff, self.payroll) {
            (true, Some(make)) => Some(make(ctx, &Value::Null)?),
            _ => None,
        };
        let lender = Lender {
            me: ctx.entity.clone(),
            p,
            asked: Asked::default(),
            book: Book::new(),
            decided: BTreeSet::new(),
            loans: BTreeMap::new(),
            by_account: BTreeMap::new(),
            inflows: BTreeMap::new(),
            repaid: BTreeMap::new(),
            defaulted: BTreeSet::new(),
            funding: 0,
            funding_asked: 0,
            draw_id: None,
            funder_account: None,
            next_interest: MONTH,
            own: None,
            terms_offered: false,
            paid_out: BTreeMap::new(),
            adopted: false,
            payroll_day: -1,
            payroll: PayrollSlot { inner: payroll, saved: Value::Null },
        };
        Ok(Box::new(Answering::new(Stepper::new(lender), answers())))
    }
    fn restore(&self, ctx: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let inner = Stepper::<Lender>::restore(saved.get("inner").cloned().ok_or("bank.lending: nothing saved")?)?;
        let mut a = Answering::restore(inner, answers(), &saved)?;
        if let (true, Some(make)) = (a.inner.plan.p.pay_staff, self.payroll) {
            a.inner.plan.payroll.inner = Some(make(ctx, &a.inner.plan.payroll.saved)?);
        }
        Ok(Box::new(a))
    }
}

const ANSWERS: (&str, &str) = (
    "the bank's lending office",
    "What it acts on: an application for a loan, which it decides by its published terms; and the repayments of the loans it has made.",
);

fn answers() -> Answers {
    Answers { office: ANSWERS.0.into(), acts: ANSWERS.1.into(), forms: vec![], report: false }
}

impl Plan for Lender {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, cx: &mut Cx) {
        self.book.absorb(pic);
        if let Some(p) = self.payroll.inner.as_mut() {
            p.absorb(pic, cx);
        }
        if self.own.is_none() {
            self.own = own_account(pic).map(|a| a.account);
        }
        let own = self.own.clone();
        let txs: Vec<_> = pic.transactions().cloned().collect();
        for tx in txs {
            let amount = cents(tx.amount);
            if own.as_deref() == Some(tx.from.as_str()) {
                if let Some(s) = &tx.settles {
                    self.paid_out.entry(s.to_string()).or_insert(tx.t);
                }
            }
            let list = self.inflows.entry(tx.to.to_string()).or_default();
            if tx.from != tx.to {
                list.push_back((tx.t, amount));
            }
            while list.front().is_some_and(|(at, _)| *at < pic.t - 90 * DAY) {
                list.pop_front();
            }
            // Repayments: from a borrower's account into ours, set against their loans, oldest first. A payout (paying a
            // loan off: docs/behaviour/ownership.md): the loan it names is repaid.
            let to_us = own.as_deref() == Some(tx.to.as_str());
            if let (true, Some(s)) = (to_us, &tx.settles) {
                if let Some(l) = self.loans.get(s.as_str()) {
                    self.repaid.insert(l.agreement.clone(), l.payment * l.months);
                    continue;
                }
            }
            if to_us {
                let mut x = amount;
                let mut ours: Vec<&Loan> = self.by_account.get(tx.from.as_str()).into_iter().flatten().filter_map(|id| self.loans.get(id)).filter(|l| l.start.is_some()).collect();
                ours.sort_by_key(|l| l.start);
                let mut parts = vec![];
                for l in ours {
                    let left = l.payment * l.months - self.repaid.get(&l.agreement).copied().unwrap_or(0);
                    let part = x.min(left.max(0));
                    parts.push((l.agreement.clone(), part));
                    x -= part;
                    if x <= 0 {
                        break;
                    }
                }
                for (id, part) in parts {
                    *self.repaid.entry(id).or_insert(0) += part;
                }
                // Funding: the funder's payment settles our draw.
                if self.draw_id.is_some() && tx.settles.as_deref() == self.draw_id.as_deref() {
                    self.funding += amount;
                    self.funder_account = Some(tx.from.to_string());
                    self.funding_asked = 0;
                    self.draw_id = None;
                }
            }
        }
    }

    #[allow(clippy::too_many_lines)]
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let (t, me) = (pic.t, self.me.clone());
        let world = cx.ctx.world.clone();
        let usd = |n: i64| money_words(n, &world);
        let acc: Option<OwnAccount> = own_account(pic);
        let mut steps: Vec<Step<Then>> = vec![];
        // Loans in force when we first look: their repayments as their terms say, from when we first see them.
        if !self.adopted {
            self.adopted = true;
            let agreements: Vec<_> = self.book.of_type("agreement").cloned().collect();
            for r in agreements {
                let RecordBody::Agreement { terms } = &r.body else { continue };
                if terms.template.as_deref() != Some("loan") || terms.parties.first() != Some(&me) || self.loans.contains_key(r.id.as_str()) || !self.book.in_force(&r.id) {
                    continue;
                }
                let Some(who) = terms.parties.get(1).cloned() else { continue };
                let (repay, _) = commitment_of(&r, &who);
                let Some(m) = repay.and_then(|o| o.money) else { continue };
                let Some(from) = m.from.clone() else { continue };
                let payment = m.amount;
                let months = ((terms.term.unwrap_or(0) + MONTH / 2).div_euclid(MONTH)).max(1);
                let rate = terms.text.as_deref().and_then(rate_in);
                // (A loan that names the day its first repayment falls due, so long after it began (`attrs.first_due`: each
                // borrower's own day), is counted from that day: a month before it is where its months begin. Until
                // 2026-10-11 every loan standing at the start was counted from the bank's first look, so every borrower who
                // had not paid fell into arrears, and then into default, on the same day.)
                let first_due = terms.attrs.as_ref().and_then(|a| a.get("first_due")).and_then(|x| x.as_i64()).filter(|f| *f > 0);
                // (Repayments missed before the year began, by our statement of the loan account: counted as due, none repaid;
                // a letter of arrears already on file is not sent again.)
                let carried = self
                    .book
                    .open("loan_statement")
                    .filter(|x| x.speaks_for.as_deref() == Some(&me) && data(x).s("loan") == Some(&r.id) && data(x).flag("brought_forward"))
                    .max_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&b.id, &a.id)));
                let missed = carried.map_or(0, |c| num(data(c).get("payments")).max(0));
                let lettered = self.book.open("loan_arrears").any(|x| x.speaks_for.as_deref() == Some(&me) && data(x).s("loan") == Some(&r.id) && data(x).flag("brought_forward"));
                let start = first_due.map_or(t, |f| r.at + f - MONTH) - missed * MONTH;
                self.add_loan(Loan {
                    agreement: r.id.to_string(),
                    borrower: who,
                    account: from,
                    principal: payment * months,
                    payment,
                    months,
                    start: Some(start),
                    arrears_notice_at: lettered.then_some(t),
                    defaulted: false,
                    rate_bps: rate,
                });
            }
        }
        // What borrowing from us is, for anyone who might (docs/design/ai-citizens.md 2a): published once.
        if !self.terms_offered {
            self.terms_offered = self.book.open("loan_terms").any(|r| r.speaks_for.as_deref() == Some(&me));
            if !self.terms_offered {
                self.terms_offered = true;
                let mut kinds: Vec<(&String, &i64)> = self.p.rate_bps.iter().collect();
                kinds.sort_by_key(|(k, _)| (match k.as_str() { "person" => 0, "organisation" => 1, _ => 2 }, (*k).clone()));
                let rates = kinds.iter().map(|(k, r)| format!("{}% a year for {}", pct(**r), if k.as_str() == "person" { "people" } else { "organisations" })).collect::<Vec<_>>().join(", ");
                let terms = json!({ "template": "loan", "commitments": [
                    { "who": me, "does": { "text": format!("Lends the amount applied for, if it judges it can be repaid, over up to {} months.", self.p.max_months) } },
                    { "who": "taker", "does": { "text": format!("Repays it monthly with interest ({rates}).") } },
                ] });
                steps.push(because(
                    "Saying what borrowing from us is: apply, and we lend what we judge can be repaid.",
                    vec![say(
                        "loan_terms",
                        &format!("Loans: apply to us, saying how much, over how long (up to {} months) and what for. Interest: {rates}. Repaid monthly.", self.p.max_months),
                        Say { visible: Some(Visible::Public), extra: vec![("offer", json!({ "by": me, "take_up": "apply", "terms": terms }))], ..Default::default() },
                    )],
                ));
            }
        }
        let Some(acc) = acc else { return steps };
        let kind_of = |this: &Lender, e: &str| if this.book.entity_kind(e) == Some("person") { "person" } else { "organisation" }; // (as the directory said when it was looked up)
        let accounts: BTreeMap<&str, &oikos_sight::AccountItem> = pic.accounts().map(|a| (a.account.as_str(), a)).collect();

        // Applications: decided on the bank's rules.
        let mut apps: Vec<_> = self.book.open("loan_application").filter(|r| addressed_to(r).iter().any(|x| x == &me) && !self.decided.contains(r.id.as_str())).cloned().collect();
        apps.sort_by(|x, y| x.at.cmp(&y.at).then_with(|| filed_before(&x.id, &y.id)));
        for a in apps {
            self.decided.insert(a.id.to_string());
            let who = a.speaks_for.unwrap_or_default();
            let d = data(&a);
            let account = d.s("account").map_or_else(|| "null".to_string(), String::from);
            let amount = num(d.get("amount"));
            let mortgage = d.s("purpose") == Some("a home") && self.p.mortgage_rate_bps > 0;
            let price = num(d.get("price"));
            let months = (if mortgage { self.p.mortgage_max_months } else { self.p.max_months }).min(Some(num(d.get("months"))).filter(|m| *m != 0).unwrap_or(12).max(1));
            let kind = kind_of(self, &who);
            let rate = if mortgage { self.p.mortgage_rate_bps } else { self.p.rate_bps.get(kind).or_else(|| self.p.rate_bps.get("organisation")).copied().unwrap_or(0) };
            let income = self.income_of(&account, t);
            let already: i64 = self.current(&who).iter().map(|l| l.payment).sum();
            let assessed = repayment(amount, rate + self.p.buffer_bps, months) + already;
            let share = self.p.max_share_bps.get(kind).copied().unwrap_or(2000);
            let cap = share_down(income, share);
            let holder_ok = accounts.get(account.as_str()).is_some_and(|x| x.holder == who && x.custodian == me);
            let refuse = if !holder_ok {
                "we don't keep that account for you".to_string()
            } else if amount <= 0 {
                "it doesn't say how much".into()
            } else if self.defaulted.contains(who.as_str()) {
                "you're in default on a loan with us".into()
            } else if self.behind(&who, t) {
                "you're behind on a loan with us".into()
            } else if mortgage && amount > most_against(price, self.p.max_lvr_bps) {
                // (In whole units: the most we lend on the price, rounded down; a loan of exactly that much is within it.)
                format!("it's more than {}% of the home's price ({})", pct(self.p.max_lvr_bps), usd(price))
            } else if assessed > cap {
                format!(
                    "the repayments{}, {} a month at {}% (our rate and the buffer we assess at), are more than {}% of your regular income ({}, the least that came into your account in any of the last three months)",
                    if already > 0 { format!(" (with the {} a month you already repay us)", usd(already)) } else { String::new() },
                    usd(assessed),
                    pct(rate + self.p.buffer_bps),
                    pct(share),
                    usd(income)
                )
            } else {
                String::new()
            };
            let vis = Visible::Only(vec![who.to_string(), me.clone()]);
            if !refuse.is_empty() {
                steps.push(because(
                    format!("A loan application we can't approve: {refuse}."),
                    vec![say(
                        "loan_decision",
                        &format!("Loan application {} declined: {refuse}.", a.id),
                        Say { to: Some(vec![who.to_string()]), visible: Some(vis), basis: Some(a.id.to_string()), data: Some(json!({ "application": a.id, "approved": false, "reason": refuse })), ..Default::default() },
                    )],
                ));
                continue;
            }
            let monthly = repayment(amount, rate, months);
            let home = d.s("home").filter(|_| mortgage).map(|h| format!(" for their home, {h}")).unwrap_or_default();
            let text = format!("{me} lends {who} {}{home}, paid into {account}; {who} repays {} a month for {months} months ({}% a year).", usd(amount), usd(monthly), pct(rate));
            let loan = offer(
                &who,
                Offer {
                    template: "loan".into(),
                    term: Some(months * MONTH),
                    we: Some(pay(&account, amount, Pay { for_: Some("Loan principal.".into()), ..Default::default() }, cx)),
                    they: Some(pay(&acc.account, monthly, Pay { from: Some(account.clone()), every: Some(MONTH), for_: Some("Loan repayment.".into()), ..Default::default() }, cx)),
                    text: Some(text),
                    basis: Some(a.id.to_string()),
                    ..Default::default()
                },
            );
            let mut st = because(
                format!(
                    "A loan application that meets our rules: {} over {months} months at {}% ({} a month; {} at the assessment rate, within {}% of {} a month coming in): offering it.",
                    usd(amount),
                    pct(rate),
                    usd(monthly),
                    usd(assessed),
                    pct(share),
                    usd(income)
                ),
                vec![
                    loan,
                    say(
                        "loan_decision",
                        &format!("Loan application {} approved: offered.", a.id),
                        Say { to: Some(vec![who.to_string()]), visible: Some(vis), basis: Some(a.id.to_string()), data: Some(json!({ "application": a.id, "approved": true, "amount": amount, "months": months, "rate_bps": rate, "payment": monthly })), ..Default::default() },
                    ),
                ],
            );
            st.lines[0].bind = Some("loan".into());
            st.then = Some(Then::Offered { borrower: who.to_string(), account, principal: amount, payment: monthly, months, rate_bps: rate });
            steps.push(st);
        }

        // Asked what paying a loan off takes: its remaining repayments' present value at its rate (a payout figure).
        let requests: Vec<_> = self.book.open("loan_payout_request").filter(|x| addressed_to(x).iter().any(|x| x == &me) && !self.decided.contains(x.id.as_str())).cloned().collect();
        for r in requests {
            self.decided.insert(r.id.to_string());
            let Some(l) = data(&r).s("loan").and_then(|id| self.loans.get(id)) else { continue };
            if Some(l.borrower.as_str()) != r.speaks_for.as_deref() {
                continue;
            }
            let left = (l.months - self.repaid.get(&l.agreement).copied().unwrap_or(0).div_euclid(l.payment.max(1))).max(0);
            let amount = payout(l.payment, l.rate_bps.unwrap_or_else(|| self.p.rate_bps.get("person").copied().unwrap_or(0)), left);
            steps.push(because(
                format!("A payout figure for loan {}: {left} repayments left, worth {} now.", l.agreement, usd(amount)),
                vec![say(
                    "loan_payout",
                    &format!("To pay off loan {}: {}, to {}, naming the loan.", l.agreement, usd(amount), acc.account),
                    Say {
                        to: Some(vec![l.borrower.clone()]),
                        visible: Some(Visible::Only(vec![l.borrower.clone(), me.clone()])),
                        basis: Some(r.id.to_string()),
                        data: Some(json!({ "loan": l.agreement, "amount": amount, "account": acc.account })),
                        ..Default::default()
                    },
                )],
            ));
        }
        // A loan we offered that is on our file and not in our head (2026-10-11): whoever holds the office carries on from its
        // papers. Until then an offer was remembered only by the id its making gave back; where the offer was made through
        // someone else's hand (the mock in the lending seat says each act as a seat would, and hears no id back) nothing was
        // remembered, and no loan it approved was ever paid out: 232 offers, no principal, in a 120-day run of a 3,000-person
        // town. Read from the agreement: made in the run, ours, not yet paid out.
        let agreements: Vec<_> = self.book.of_type("agreement").cloned().collect();
        for r in agreements {
            let RecordBody::Agreement { terms } = &r.body else { continue };
            if terms.template.as_deref() != Some("loan") || terms.parties.first() != Some(&me) || self.loans.contains_key(r.id.as_str()) || r.author == "genesis" {
                continue;
            }
            let Some(who) = terms.parties.get(1).cloned() else { continue };
            let lent = commitment_of(&r, &me).0.and_then(|o| o.money);
            let repay = commitment_of(&r, &who).0.and_then(|o| o.money);
            let (Some(lent), Some(repay)) = (lent, repay) else { continue };
            let Some(from) = repay.from else { continue };
            let months = ((terms.term.unwrap_or(0) + MONTH / 2).div_euclid(MONTH)).max(1);
            self.add_loan(Loan {
                agreement: r.id.to_string(),
                borrower: who,
                account: lent.to,
                principal: lent.amount,
                payment: repay.amount,
                months,
                start: self.paid_out.get(r.id.as_str()).copied(),
                arrears_notice_at: None,
                defaulted: false,
                rate_bps: terms.text.as_deref().and_then(rate_in),
            });
            let _ = from;
        }
        // Signed: pay the principal out (drawing funding first if we're short).
        let mut to_pay: Vec<String> = self.loans.values().filter(|l| l.start.is_none() && self.book.signed_by(&l.agreement, &l.borrower)).map(|l| l.agreement.clone()).collect();
        let needed: i64 = to_pay.iter().map(|id| self.loans[id].principal).sum();
        if needed > 0 && acc.balance - needed < self.p.reserve && self.p.funding_from.is_some() && self.funding_asked == 0 {
            let funder = self.p.funding_from.clone().unwrap_or_default();
            let draw = self.p.reserve + needed - acc.balance;
            self.funding_asked = draw;
            let mut st = because(
                format!("Loans to pay out ({}) would take us below our reserve: drawing {} of funding.", usd(needed), usd(draw)),
                vec![say(
                    "funding_draw",
                    &format!("Please lend us {}.", usd(draw)),
                    Say {
                        to: Some(vec![funder.clone()]),
                        visible: Some(Visible::Only(vec![me.clone(), funder])),
                        data: Some(json!({ "amount": draw, "account": acc.account, "rate_bps": self.p.funding_rate_bps })),
                        ..Default::default()
                    },
                )],
            );
            st.lines[0].bind = Some("draw".into());
            st.then = Some(Then::Draw);
            steps.push(st);
        }
        let mut room = acc.balance - if self.p.funding_from.is_some() { 0 } else { self.p.reserve };
        to_pay.sort_by(|a, b| filed_before(a, b));
        for id in to_pay {
            let principal = self.loans[&id].principal;
            if room < principal {
                break;
            }
            room -= principal;
            let (borrower, account) = {
                let l = self.loans.get_mut(&id).expect("listed above");
                l.start = Some(t);
                (l.borrower.clone(), l.account.clone())
            };
            steps.push(because(
                format!("{borrower} has signed: paying out the {} loan.", usd(principal)),
                vec![pay(&account, principal, Pay { from: Some(acc.account.clone()), for_: Some("Loan principal.".into()), settles: Some(id.clone()), ..Default::default() }, cx)],
            ));
        }

        // Following repayments: arrears, then default.
        let ids: Vec<String> = self.loans.values().filter(|l| l.start.is_some() && !l.defaulted).map(|l| l.agreement.clone()).collect();
        for id in ids {
            let l = self.loans[&id].clone();
            let start = l.start.unwrap_or(t);
            let repaid = self.repaid.get(&id).copied().unwrap_or(0);
            let due_count = l.months.min((t - start).div_euclid(MONTH));
            let behind = due_count * l.payment - repaid;
            if behind <= 0 {
                self.loans.get_mut(&id).map(|x| x.arrears_notice_at = None);
                continue;
            }
            // How long behind: since the earliest payment not covered.
            let covered = repaid.div_euclid(l.payment.max(1));
            let since = start + (covered + 1) * MONTH;
            if t - since >= self.p.default_days * DAY {
                if let Some(x) = self.loans.get_mut(&id) {
                    x.defaulted = true;
                }
                self.defaulted.insert(l.borrower.clone());
                let outstanding = l.payment * l.months - repaid;
                steps.push(because(
                    format!("{}'s loan is {} days behind ({} is default): recording the debt and the default.", l.borrower, (t - since).div_euclid(DAY), self.p.default_days),
                    vec![
                        say(
                            "loan_default",
                            &format!("Loan {id} is in default: {} behind, {} owing.", usd(behind), usd(outstanding)),
                            Say {
                                to: Some(vec![l.borrower.clone()]),
                                visible: Some(Visible::Only(vec![l.borrower.clone(), me.clone()])),
                                basis: Some(id.clone()),
                                data: Some(json!({ "loan": id, "behind": behind, "outstanding": outstanding })),
                                ..Default::default()
                            },
                        ),
                        right("right", &me, json!({ "kind": "debt", "amount": outstanding, "for": format!("Loan {id}, in default.") }), Some(&l.borrower), Some(&id)),
                    ],
                ));
            } else if t - since >= self.p.arrears_days * DAY && l.arrears_notice_at.is_none() {
                if let Some(x) = self.loans.get_mut(&id) {
                    x.arrears_notice_at = Some(t);
                }
                steps.push(because(
                    format!("{}'s loan is {} days behind: a notice of arrears.", l.borrower, (t - since).div_euclid(DAY)),
                    vec![say(
                        "loan_arrears",
                        &format!("Loan {id}: {} behind. Please pay.", usd(behind)),
                        Say {
                            to: Some(vec![l.borrower.clone()]),
                            visible: Some(Visible::Only(vec![l.borrower.clone(), me.clone()])),
                            basis: Some(id.clone()),
                            data: Some(json!({ "loan": id, "behind": behind })),
                            ..Default::default()
                        },
                    )],
                ));
            }
        }

        // Our funding: interest monthly, and repaid when we have more than we need.
        if self.p.funding_from.is_some() && t >= self.next_interest {
            self.next_interest = t + MONTH;
            let interest = (self.funding * self.p.funding_rate_bps + 119_999).div_euclid(120_000);
            let repay = self.funding.min((acc.balance - interest - 2 * self.p.reserve).max(0));
            let mut calls = vec![];
            if let Some(fa) = &self.funder_account {
                if interest > 0 {
                    calls.push(pay(fa, interest, Pay { from: Some(acc.account.clone()), for_: Some("Interest on funding.".into()), ..Default::default() }, cx));
                }
                if repay > 0 {
                    calls.push(pay(fa, repay, Pay { from: Some(acc.account.clone()), for_: Some("Funding repaid.".into()), ..Default::default() }, cx));
                }
            }
            if !calls.is_empty() {
                self.funding -= repay;
                steps.push(because(
                    format!(
                        "Monthly: interest on our funding ({} at {}%){}.",
                        usd(self.funding + repay),
                        pct(self.p.funding_rate_bps),
                        if repay > 0 { format!(", and repaying {} of it, as we have more than we need", usd(repay)) } else { String::new() }
                    ),
                    calls,
                ));
            }
        }
        // The bank's own staff are paid and their tax paid over as any employer's: starts, stops (a death), returns on the
        // law's days. (Once a day, not at every wake: it goes through the bank's whole file of instructions, and the office
        // wakes for every application and letter.)
        if let (Some(p), Some(own)) = (self.payroll.inner.as_mut(), self.own.clone().and_then(|_| own_account(pic))) {
            if t.div_euclid(DAY) > self.payroll_day {
                self.payroll_day = t.div_euclid(DAY);
                for s in p.routine(pic, &self.book, &own, cx) {
                    steps.push(Step { lines: s.lines, act: s.act, why: s.why, then: None, redo: s.redo, planned: s.planned, lapses_at: s.lapses_at });
                }
            }
        }
        steps
    }

    /// What kind of applicant each new application is from (a person, or an organisation: the bank's rates and its rule on
    /// income differ): looked up before it is decided, each applicant once. Nobody is shown who's who.
    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        if self.p.who.is_empty() {
            return vec![];
        }
        let mut out = vec![];
        let apps: Vec<_> = self.book.open("loan_application").cloned().collect();
        for a in apps {
            let Some(applicant) = a.speaks_for.as_deref() else { continue };
            if out.len() >= LOOKS_MAX || self.decided.contains(a.id.as_str()) || !addressed_to(&a).iter().any(|x| x == &pic.entity.to_string()) {
                continue;
            }
            if self.book.entity_kind(applicant).is_none() && self.asked.first(applicant, pic.t) {
                out.push(look_up::entity(&self.p.who, applicant));
            }
        }
        out
    }

    fn then(&mut self, token: &Then, done: Done, _cx: &mut Cx) -> Vec<Step<Then>> {
        let created = |key: &str| match done {
            Done::Outcome(o) => o.created.as_ref().and_then(|c| c.get(key)).cloned(),
            Done::NotDone(_) => None,
        };
        match token {
            Then::Offered { borrower, account, principal, payment, months, rate_bps } => {
                if let Some(id) = created("loan") {
                    self.add_loan(Loan {
                        agreement: id.to_string(),
                        borrower: borrower.clone(),
                        account: account.clone(),
                        principal: *principal,
                        payment: *payment,
                        months: *months,
                        start: None,
                        arrears_notice_at: None,
                        defaulted: false,
                        rate_bps: Some(*rate_bps),
                    });
                }
            }
            Then::Draw => {
                self.draw_id = created("draw").map(|x| x.to_string());
                if self.draw_id.is_none() {
                    self.funding_asked = 0;
                }
            }
        }
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finance::kit::{arg, json_arg, records, statement, Rig, Stand, DAY, MONTH};
    use oikos_sight::calls::Call;

    #[test]
    fn a_share_of_an_amount_is_whole_units_rounded_down_or_up_with_no_fraction_made_on_the_way() {
        assert_eq!((share_down(100, 2000), share_up(100, 2000)), (20, 20));
        assert_eq!((share_down(101, 2000), share_up(101, 2000)), (20, 21));
        assert_eq!((share_down(0, 8000), share_up(0, 8000)), (0, 0));
        assert_eq!(share_down(900_000_000_001, 3333), (900_000_000_001_i128 * 3333 / 10_000) as i64);
        assert_eq!(share_up(900_000_000_001, 3333), (900_000_000_001_i128 * 3333 / 10_000) as i64 + 1);
    }

    #[test]
    fn what_a_buyer_asks_is_what_the_lender_admits_at_every_price() {
        let mut prices: Vec<i64> = vec![56_895_911, 51_348_561, 1, 2, 3, 4, 5, 6, 7, 9, 99, 101, 12_345_679];
        prices.extend(51_348_500..51_348_700);
        for (deposit, lvr) in [(2000, 8000), (1000, 9000), (500, 9500), (3333, 6667), (1, 9999), (0, 10_000)] {
            for &price in &prices {
                let loan = loan_for(price, deposit);
                assert_eq!(loan, most_against(price, lvr));
                assert!(loan as i128 * 10_000 <= price as i128 * lvr as i128);
                assert!((loan + 1) as i128 * 10_000 > price as i128 * lvr as i128, "all of it: a unit more is over");
                assert!((price - loan) as i128 * 10_000 >= price as i128 * deposit as i128, "the deposit is never short");
            }
        }
        // (What was asked before: the deposit rounded down, a unit over wherever a fifth is not whole.)
        assert_eq!(56_895_911 - 56_895_911 * 2000 / 10_000, most_against(56_895_911, 8000) + 1);
    }

    #[test]
    fn the_repayment_is_the_credit_foncier_payment_rounded_up_and_the_payout_its_remaining_worth() {
        assert_eq!(repayment(100_000, 1200, 12), 8885, "$1,000 at 12% over a year");
        assert_eq!(repayment(50_000_000, 600, 360), 299_776, "$500,000 at 6% over thirty years");
        assert_eq!(repayment(120_000, 0, 12), 10_000);
        assert_eq!(repayment(100_001, 0, 12), 8_334, "rounded up");
        assert_eq!(repayment(1_000_000, 0, 10), 100_000, "no interest: the principal in equal parts");
        assert_eq!(repayment(50_000_000, 739, 60), 999_286, "$500,000 at 7.39% over five years: $9,992.86 a month");
        assert_eq!(repayment(777, 900, 0), 777);
        // Whole of the loan paid back, with its interest, and a little over (the round up).
        for (p, r, m) in [(100_000, 1200, 12), (4_500_000, 780, 60), (40_000_000, 620, 360)] {
            let pay = repayment(p, r, m);
            assert!(pay * m >= p && pay * m < p * 3, "{p} {r} {m}: {pay}");
        }
        // What paying off takes is the worth of what is left at the loan's rate: all of it at the start.
        assert!((payout(8885, 1200, 12) - 100_000).abs() <= 2);
        assert_eq!(payout(8885, 1200, 0), 0);
        assert_eq!(payout(1000, 0, 5), 5000);
        assert!(payout(8885, 1200, 6) < payout(8885, 1200, 12));
    }

    #[test]
    fn rates_are_written_as_numbers_are() {
        assert_eq!((pct(1200), pct(850), pct(825), pct(0), pct(5)), ("12".into(), "8.5".into(), "8.25".into(), "0".into(), "0.05".into()));
        assert_eq!(rate_in("bank lends ann 1,000.00; ann repays 91.68 a month for 12 months (6.5% a year)."), Some(650));
        assert_eq!(rate_in("no rate here"), None);
    }

    const ME: &str = "bank";
    const WHO: &str = "ann";

    fn accounts(bank_balance: i64) -> Value {
        json!({ "kind": "accounts", "accounts": [
            { "account": "acc-bank", "holder": ME, "custodian": ME, "currency": "XTS", "balance": bank_balance.to_string() },
            { "account": "acc-ann", "holder": WHO, "custodian": ME, "currency": "XTS", "balance": "20000000" }], "transactions": [] })
    }
    fn lender(params: Value) -> Rig {
        Rig::new(&Lending { payroll: None }, ME, "bank-lending-system", params)
    }
    fn wake(m: &mut Rig, t: i64, rs: Vec<Value>, transactions: Vec<Value>, balance: i64) -> Vec<Call> {
        let mut acc = accounts(balance);
        acc["transactions"] = Value::Array(transactions);
        m.at(t, json!({ "mine": records(rs), "bank": acc }), json!([]))
    }
    fn decisions(said: &[Call]) -> Vec<(String, bool, Option<String>)> {
        said.iter()
            .filter(|c| arg(c, "kind").as_deref() == Some("loan_decision"))
            .map(|c| {
                let d = json_arg(c, "data");
                (d["application"].as_str().unwrap().into(), d["approved"].as_bool().unwrap(), d["reason"].as_str().map(String::from))
            })
            .collect()
    }
    fn wages(k: i64) -> Value {
        json!({ "t": k * MONTH + DAY, "from": "acc-employer", "to": "acc-ann", "amount": "50000000", "currency": "XTS", "by": "bank", "memo": "wages" })
    }
    fn application(id: &str, t: i64, amount: i64, price: i64) -> Value {
        statement(id, t, "loan_application", json!({ "speaks_for": WHO, "author": "ann-self", "addressed_to": [ME], "visible_to": [WHO, ME] }),
            json!({ "amount": amount, "months": 360, "account": "acc-ann", "purpose": "a home", "price": price, "home": "house-1" }))
    }

    #[test]
    fn the_lender_admits_a_loan_of_exactly_its_share_of_the_price_at_a_price_the_share_does_not_divide_and_refuses_a_unit_more() {
        let mut m = lender(json!({ "mortgage_rate_bps": 620, "mortgage_max_months": 360, "max_lvr_bps": 8000, "max_share_bps": { "person": 10_000, "organisation": 10_000 }, "funding_from": "outside" }));
        // Pay into the account in each of three months, then the applications.
        for k in 0..3 {
            wake(&mut m, k * MONTH + DAY, vec![], vec![wages(k)], 100_000_000_000);
        }
        let price = 56_895_911; // (four fifths of it is 45,516,728.8)
        let t = 3 * MONTH;
        let said = wake(
            &mut m,
            t,
            vec![application("app-asked", t, loan_for(price, 2000), price), application("app-over", t, loan_for(price, 2000) + 1, price), application("app-even", t, 40_000_000, 50_000_000), application("app-even-over", t, 40_000_001, 50_000_000)],
            vec![],
            100_000_000_000,
        );
        let d: BTreeMap<String, (bool, Option<String>)> = decisions(&said).into_iter().map(|(a, ok, why)| (a, (ok, why))).collect();
        assert_eq!(d["app-asked"], (true, None));
        assert!(!d["app-over"].0);
        assert!(d["app-over"].1.as_deref().unwrap().contains("more than 80% of the home's price"), "{:?}", d["app-over"]);
        assert_eq!(d["app-even"], (true, None));
        assert!(!d["app-even-over"].0);
    }

    #[test]
    fn an_applicant_with_no_income_history_or_not_the_accounts_holder_is_declined_with_the_reason_in_words() {
        let mut m = lender(json!({}));
        let t = 10 * DAY;
        let said = wake(&mut m, t, vec![application("a1", t, 5_000_000, 6_000_000)], vec![], 100_000_000_000);
        let d = decisions(&said);
        assert!(!d[0].1);
        assert!(d[0].2.as_deref().unwrap().contains("are more than"), "{:?}", d[0]);
        assert!(d[0].2.as_deref().unwrap().contains("of your regular income ($0.00, the least that came into your account in any of the last three months)"), "{:?}", d[0]);
        // Someone else's account.
        let mut other = application("a2", t, 100, 1000);
        other["speaks_for"] = "bob".into();
        let d = decisions(&wake(&mut m, t + DAY, vec![other], vec![], 100_000_000_000));
        assert_eq!(d[0].2.as_deref(), Some("we don't keep that account for you"));
    }

    fn the_loan() -> Value {
        json!({ "id": "rec.9", "at": 2 * DAY, "author": "bank-lending-system", "record": "agreement", "visible_to": [ME, WHO], "terms": { "template": "loan", "parties": [ME, WHO], "term": 12 * MONTH,
            "text": "bank lends ann $1,000.00; ann repays $91.68 a month for 12 months (6% a year).",
            "commitments": [{ "who": ME, "does": { "outcome": { "money": { "to": "acc-ann", "amount": "100000", "for": "Loan principal." } } } },
                { "who": WHO, "does": { "outcome": { "money": { "from": "acc-ann", "to": "acc-bank", "amount": "9168", "for": "Loan repayment." } } }, "every": MONTH }] } })
    }
    fn signed(by: &str, at: i64) -> Value {
        json!({ "id": format!("sig-{by}"), "at": at, "author": format!("{by}-x"), "record": "signature", "agreement": "rec.9", "as": by, "visible_to": [ME, WHO] })
    }

    #[test]
    fn a_loan_the_office_offered_that_is_on_its_file_and_not_in_its_head_is_paid_out_once_the_borrower_signs() {
        let mut m = lender(json!({ "funding_from": "outside" }));
        wake(&mut m, DAY, vec![], vec![], 100_000_000_000);
        // Offered and signed by the bank: nothing is paid until the borrower signs.
        let said = wake(&mut m, 2 * DAY, vec![the_loan(), signed(ME, 2 * DAY)], vec![], 100_000_000_000);
        assert!(said.iter().all(|c| c.fn_ != "money"));
        let said = wake(&mut m, 3 * DAY, vec![signed(WHO, 3 * DAY)], vec![], 100_000_000_000);
        assert_eq!(said.iter().filter(|c| c.fn_ == "money").map(|c| (arg(c, "to").unwrap(), arg(c, "settles").unwrap())).collect::<Vec<_>>(), [("acc-ann".to_string(), "rec.9".to_string())]);
        // Once, and not again when the payment is seen to leave.
        let seen = json!({ "t": 3 * DAY, "from": "acc-bank", "to": "acc-ann", "amount": "100000", "currency": "XTS", "by": "bank", "settles": "rec.9" });
        assert!(wake(&mut m, 4 * DAY, vec![], vec![seen], 100_000_000_000).iter().all(|c| c.fn_ != "money"));
    }

    #[test]
    fn a_borrower_who_pays_nothing_is_sent_a_notice_of_arrears_a_month_behind_and_is_in_default_three_months_behind_with_the_debt_recorded() {
        let mut m = lender(json!({ "funding_from": "outside" }));
        wake(&mut m, DAY, vec![], vec![], 100_000_000_000);
        wake(&mut m, 2 * DAY, vec![the_loan(), signed(ME, 2 * DAY)], vec![], 100_000_000_000);
        wake(&mut m, 3 * DAY, vec![signed(WHO, 3 * DAY)], vec![], 100_000_000_000); // paid out at day 3: the first repayment is due a month on
        let kinds = |said: &[Call]| said.iter().filter_map(|c| arg(c, "kind")).collect::<Vec<_>>();
        assert!(kinds(&wake(&mut m, 3 * DAY + MONTH - DAY, vec![], vec![], 100_000_000_000)).is_empty(), "not yet due");
        // The first repayment missed: 30 days behind is arrears, once.
        let arrears = wake(&mut m, 3 * DAY + 2 * MONTH, vec![], vec![], 100_000_000_000);
        assert_eq!(kinds(&arrears), ["loan_arrears"]);
        assert!(kinds(&wake(&mut m, 3 * DAY + 2 * MONTH + DAY, vec![], vec![], 100_000_000_000)).is_empty(), "the notice is sent once");
        // Ninety days behind the first: default, and the debt is recorded as a right against the borrower.
        let default = wake(&mut m, 3 * DAY + 4 * MONTH + DAY, vec![], vec![], 100_000_000_000);
        assert!(kinds(&default).contains(&"loan_default".to_string()), "{default:?}");
        assert!(default.iter().any(|c| c.fn_ == "record" || arg(c, "against").as_deref() == Some("ann") || c.fn_ == "claim"), "the debt is recorded: {default:?}");
        // And they are refused the next loan.
        let d = decisions(&wake(&mut m, 3 * DAY + 5 * MONTH, vec![application("a9", 3 * DAY + 5 * MONTH, 1000, 5000)], vec![], 100_000_000_000));
        assert_eq!(d[0].2.as_deref(), Some("you're in default on a loan with us"));
    }

    #[test]
    fn repayments_set_against_the_borrowers_loans_oldest_first_keep_a_borrower_out_of_arrears() {
        let mut m = lender(json!({ "funding_from": "outside" }));
        wake(&mut m, DAY, vec![], vec![], 100_000_000_000);
        wake(&mut m, 2 * DAY, vec![the_loan(), signed(ME, 2 * DAY)], vec![], 100_000_000_000);
        wake(&mut m, 3 * DAY, vec![signed(WHO, 3 * DAY)], vec![], 100_000_000_000);
        for k in 1..=4 {
            let pay = json!({ "t": 3 * DAY + k * MONTH, "from": "acc-ann", "to": "acc-bank", "amount": "9168", "currency": "XTS", "by": "ann-bank", "memo": "Loan repayment." });
            let said = wake(&mut m, 3 * DAY + k * MONTH + DAY, vec![], vec![pay], 100_000_000_000);
            assert!(said.iter().all(|c| arg(c, "kind").is_none()), "month {k}: {said:?}");
        }
    }

    #[test]
    fn it_publishes_what_borrowing_from_it_is_once_and_draws_funding_when_a_loan_would_take_it_below_its_reserve() {
        let mut m = lender(json!({ "funding_from": "outside", "reserve": 5_000_000 }));
        let first = wake(&mut m, DAY, vec![], vec![], 1_000_000);
        let terms = first.iter().find(|c| arg(c, "kind").as_deref() == Some("loan_terms")).expect("it says what borrowing is");
        assert_eq!(arg(terms, "text").unwrap(), "Loans: apply to us, saying how much, over how long (up to 60 months) and what for. Interest: 12% a year for people, 8% a year for organisations. Repaid monthly.");
        assert_eq!(arg(terms, "visible").as_deref(), Some("public"));
        assert!(wake(&mut m, 2 * DAY, vec![], vec![], 1_000_000).iter().all(|c| arg(c, "kind").as_deref() != Some("loan_terms")), "once");
        // A signed loan the bank cannot cover without going under its reserve: it asks its funder for the shortfall, once.
        wake(&mut m, 3 * DAY, vec![the_loan(), signed(ME, 3 * DAY)], vec![], 1_000_000);
        let said = wake(&mut m, 4 * DAY, vec![signed(WHO, 4 * DAY)], vec![], 1_000_000);
        let draw = said.iter().find(|c| arg(c, "kind").as_deref() == Some("funding_draw")).expect("a draw on funding");
        assert_eq!(json_arg(draw, "data")["amount"], 5_000_000 + 100_000 - 1_000_000);
        assert_eq!(json_arg(draw, "to"), json!(["outside"]));
        assert!(wake(&mut m, 5 * DAY, vec![], vec![], 1_000_000).iter().all(|c| arg(c, "kind").as_deref() != Some("funding_draw")), "not again while one is asked for");
    }

    #[test]
    fn a_lender_saves_and_restores_exactly() {
        let mut m = lender(json!({ "funding_from": "outside" }));
        let mut twin = lender(json!({ "funding_from": "outside" }));
        for r in [&mut m, &mut twin] {
            wake(r, DAY, vec![], vec![], 100_000_000_000);
            wake(r, 2 * DAY, vec![the_loan(), signed(ME, 2 * DAY)], vec![], 100_000_000_000);
            wake(r, 3 * DAY, vec![signed(WHO, 3 * DAY)], vec![], 100_000_000_000);
        }
        m.snapshot_round_trip();
        for t in [3 * DAY + 2 * MONTH, 3 * DAY + 2 * MONTH + DAY, 3 * DAY + 4 * MONTH + DAY] {
            assert_eq!(format!("{:?}", wake(&mut m, t, vec![], vec![], 100_000_000_000)), format!("{:?}", wake(&mut twin, t, vec![], vec![], 100_000_000_000)));
        }
    }

    // ---- a borrower's side

    #[test]
    fn a_borrower_applies_waits_is_refused_and_tries_again_only_after_a_while() {
        let mut stand = Stand::new("ann");
        let mut b = Borrowing::new(WHO, ME, None, None);
        assert!(b.can_apply(0));
        let step: Step<()> = b.apply(0, "acc-ann", 100_000, 12, "a car", "short of money", json!({ "price": 5 }), &stand.cx(0));
        assert_eq!(arg(&step.lines[0].call, "text").unwrap(), "Application for a loan of $1,000.00 over 12 months, for a car.");
        assert_eq!(json_arg(&step.lines[0].call, "data")["price"], 5);
        assert!(b.waiting(DAY) && !b.can_apply(DAY));
        // The lender refuses: nothing for sixty days.
        let refused = records(vec![statement("d1", 2 * DAY, "loan_decision", json!({ "speaks_for": ME, "addressed_to": [WHO], "visible_to": [WHO, ME] }), json!({ "approved": false, "reason": "no" }))]);
        let book = crate::finance::kit::book_of(WHO, vec![refused["records"][0].clone()]);
        let cx = stand.cx(2 * DAY);
        assert!(b.steps::<()>(&book, 2 * DAY, Some("acc-ann"), &cx).is_empty());
        assert!(!b.waiting(3 * DAY) && !b.can_apply(3 * DAY) && !b.can_apply(61 * DAY) && b.can_apply(62 * DAY + 1));
    }

    #[test]
    fn a_borrower_signs_the_loan_offered_and_asks_its_bank_to_pay_the_repayments_monthly_and_one_in_default_may_not_apply() {
        let mut stand = Stand::new("ann");
        let mut b = Borrowing::new(WHO, ME, None, None);
        let approved = statement("d1", 2 * DAY, "loan_decision", json!({ "speaks_for": ME, "addressed_to": [WHO], "visible_to": [WHO, ME] }), json!({ "approved": true, "months": 12 }));
        let book = crate::finance::kit::book_of(WHO, vec![approved, the_loan(), signed(ME, 2 * DAY)]);
        let cx = stand.cx(3 * DAY);
        let steps = b.steps::<()>(&book, 3 * DAY, Some("acc-ann"), &cx);
        assert_eq!(steps.len(), 1);
        let calls: Vec<&Call> = steps[0].lines.iter().map(|l| &l.call).collect();
        assert_eq!((calls[0].fn_.as_str(), arg(calls[0], "sign").unwrap()), ("agreement", "rec.9".to_string()));
        let pay = calls[1];
        assert_eq!((arg(pay, "to").unwrap(), arg(pay, "amount").unwrap(), arg(pay, "from").unwrap(), arg(pay, "every").unwrap(), arg(pay, "first").unwrap(), arg(pay, "basis").unwrap()),
            ("acc-bank".to_string(), "$91.68".to_string(), "acc-ann".to_string(), "30 days".to_string(), "30 days".to_string(), "rec.9".to_string()));
        // It is taken once, and a loan repaying means no other until it is done.
        assert!(b.steps::<()>(&book, 4 * DAY, Some("acc-ann"), &cx).is_empty());
        assert!(!b.can_apply(20 * DAY) && !b.can_apply(11 * MONTH) && b.can_apply(12 * MONTH + 3 * DAY), "one loan at a time until it is repaid");
        let default = crate::finance::kit::book_of(WHO, vec![statement("df", 0, "loan_default", json!({ "speaks_for": ME, "addressed_to": [WHO] }), json!({}))]);
        let mut c = Borrowing::new(WHO, ME, None, None);
        c.steps::<()>(&default, DAY, None, &cx);
        assert!(c.impaired && !c.can_apply(1000 * DAY));
        // A firm may borrow again this long after the last, and the bank decides it on its rule.
        let mut firm = Borrowing::new(WHO, ME, Some(30), Some(90));
        firm.steps::<()>(&book, 3 * DAY, Some("acc-ann"), &cx);
        assert!(!firm.can_apply(50 * DAY) && firm.can_apply(94 * DAY));
    }

    /// A loan granted is waited for: from the decision and from signing, for a day, as an application is (found in the 1,000-person town's
    /// logs, decisions log 2026-10-08: a shop signed for a loan and let someone go "with no loan to be had" two seconds before the bank paid it
    /// out). Ported from participants/test/pay-period.test.ts (the TypeScript `Borrowing` is gone).
    #[test]
    fn a_loan_granted_is_waited_for_from_the_decision_and_from_signing_for_a_day_as_an_application_is() {
        let mut stand = Stand::new("ann");
        let mut b = Borrowing::new(WHO, ME, None, None);
        let t = 20 * DAY;
        let _: Step<()> = b.apply(t, "acc-ann", 4_600_000, 12, "working capital", "Short of the next pay period.", json!({}), &stand.cx(t));
        assert!(b.waiting(t));
        // The bank's offer, and its decision, as the shop is shown them.
        let mut loan = the_loan();
        loan["at"] = json!(t + 60);
        let decision = statement("dec-1", t + 60, "loan_decision", json!({ "speaks_for": ME, "addressed_to": [WHO], "visible_to": [WHO, ME] }), json!({ "approved": true, "months": 12 }));
        let book = crate::finance::kit::book_of(WHO, vec![loan, decision]);
        let cx = stand.cx(t + 60);
        let steps = b.steps::<()>(&book, t + 60, Some("acc-ann"), &cx);
        assert_eq!(steps.len(), 1, "signing, and the repayments' standing order");
        // Signed, and the money not yet here: still waiting, where it used to say "no loan to be had".
        assert!(b.waiting(t + 62));
        assert!(!b.can_apply(t + 62));
        // A day on, it is no longer waited for (it has come, or it never will).
        assert!(!b.waiting(t + 60 + DAY));
    }
}
