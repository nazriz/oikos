//! Winding up an insolvent firm, or one its owners close (ported from participants/src/behaviour/firms.ts `WindingUp`;
//! docs/behaviour/insolvency.md). A firm is insolvent when it cannot pay its debts as they fall due: in default on a
//! loan, or short of what is recorded against it for `short_days` with no credit to be had. Then it says so publicly,
//! lets everyone go, stops buying and making, and sells what it has; after `wind_up_days` it pays what it owes (debts
//! recorded against it, oldest first, then what is left on its loans), passes anything left to its shareholders, and
//! closes. Every payment is an act of its own, taking its own time.
//!
//! Order of payment: the TS paid debts oldest first. Employees' entitlements rank ahead of unsecured creditors in most
//! places (risk A-14; Corporations Act 2001 (Cth) s 556; Insolvency Act 1986 (UK) sch 6): debts for wages (kind
//! `wages`) are paid first, then the tax withheld (`withheld_tax`), then the rest oldest first. The kinds are the
//! claims' own, so no place's law is written here; a world whose law orders them otherwise gives `priority`.

use super::staffing::Staffing;
use crate::common::{bases_of, filed_before, money_words, Book};
use crate::papers::agreements::commitment_of;
use crate::steps::{arg, because, call, pay, say, Pay, Say, Step, Visible};
use crate::{Cx, DAY};
use oikos_sight::{Picture, Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub const DEBT_KINDS: [&str; 4] = ["debt", "fine", "rates", "rates_interest"];
const MONTH: i64 = 30 * DAY;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Trading,
    WindingUp,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindingParams {
    pub short_days: i64,
    pub wind_up_days: i64,
    pub idle_days: i64,
    pub reprice_days: i64,
    pub reprice_bps: i64,
}

/// Where a firm's premises are, for the sale after it closes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Premises {
    pub structure: String,
    pub type_: String,
    pub cell: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindingUp {
    me: String,
    p: WindingParams,
    pub state: State,
    pub since: i64,
    paid: BTreeSet<String>,
    active_at: i64,
    listed_at: i64,
    asking: i64,
    sold: bool,
    /// paying account -> money received for our property
    credit: BTreeMap<String, i64>,
}

fn about_kind(r: &Record) -> &str {
    match &r.body {
        RecordBody::Claim { about, .. } => about.get("kind").and_then(Value::as_str).unwrap_or(""),
        _ => "",
    }
}
pub fn about_amount(r: &Record) -> i64 {
    match &r.body {
        RecordBody::Claim { about, .. } => match about.get("amount") {
            Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
            Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
            _ => 0,
        },
        _ => 0,
    }
}
fn about_str<'a>(r: &'a Record, k: &str) -> Option<&'a str> {
    match &r.body {
        RecordBody::Claim { about, .. } => about.get(k).and_then(Value::as_str),
        _ => None,
    }
}

/// The account a creditor is paid into (when the claim does not name one): a lender's (its loan agreement names it), or
/// a worker's (their employment agreement names it).
pub fn creditor_account(book: &Book, holder: &str) -> Option<String> {
    for r in book.of_type("agreement") {
        let RecordBody::Agreement { terms } = &r.body else { continue };
        if !terms.parties.iter().any(|p| p == holder) {
            continue;
        }
        let other = |who: &str| terms.commitments.iter().find(|c| c.who != who).and_then(|c| c.does.get("outcome")?.get("money")?.get("to")?.as_str().map(String::from));
        match terms.template.as_deref() {
            Some("loan") if terms.parties.first().is_some_and(|p| p == holder) => {
                if let Some(to) = other(holder) {
                    return Some(to);
                }
            }
            Some("employment") if terms.parties.get(1).is_some_and(|p| p == holder) => {
                if let Some(to) = other(holder) {
                    return Some(to);
                }
            }
            _ => {}
        }
    }
    None
}

/// Rank of a debt: wages first, then the tax withheld from them, then everything else (risk A-14).
fn rank(r: &Record) -> u8 {
    match about_kind(r) {
        "wages" | "redundancy" => 0,
        "withheld_tax" | "tax_withheld" => 1,
        _ => 2,
    }
}

impl WindingUp {
    pub fn new(me: &str, p: WindingParams) -> Self {
        WindingUp { me: me.into(), p, state: State::Trading, since: 0, paid: BTreeSet::new(), active_at: -1, listed_at: -1, asking: 0, sold: false, credit: BTreeMap::new() }
    }

    /// A new holder of the post (the last left town, say) takes the firm over as it stands, and finds in its books what
    /// the firm has said: that it is closing, or has closed, and where its premises are in the sale. A firm that has
    /// announced its closing does not trade again because the person who closed it has gone (ME-21): the state is read
    /// back from the firm's own public papers, which outlast whoever wrote them.
    pub fn recover(&mut self, book: &Book) {
        if self.state != State::Trading {
            return;
        }
        let mine = |r: &&Arc<Record>| r.speaks_for.as_deref() == Some(self.me.as_str()) && !book.withdrawn(&r.id);
        let newest = |kind: &str| book.open(kind).filter(mine).max_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&b.id, &a.id))).cloned();
        if let Some(c) = newest("closure") {
            self.state = State::Closed;
            self.since = c.at;
            if let Some(l) = newest("property_for_sale") {
                self.listed_at = l.at;
                self.asking = crate::common::data(&l).get("price").and_then(Value::as_i64).unwrap_or(0);
            }
            self.sold = book.open("property_sold").any(|r| r.speaks_for.as_deref() == Some(self.me.as_str()));
            return;
        }
        let closing = newest("closing").or_else(|| newest("insolvency"));
        if let Some(c) = closing {
            self.state = State::WindingUp;
            self.since = crate::common::data(&c).get("since").and_then(Value::as_i64).unwrap_or(c.at);
        }
    }

    /// Debts recorded against us that we have not paid, in the order they are paid: wages, the tax withheld, then the
    /// rest, each oldest first.
    pub fn debts<'a>(&self, book: &'a Book) -> Vec<&'a Arc<Record>> {
        let mut v: Vec<&Arc<Record>> = book
            .of_type("claim")
            .filter(|r| {
                matches!(&r.body, RecordBody::Claim { position, counterparty: Some(c), .. } if *c == self.me && format!("{position:?}") == "Right")
                    && (DEBT_KINDS.contains(&about_kind(r)) || rank(r) < 2)
                    && !self.paid.contains(r.id.as_str())
            })
            .collect();
        v.sort_by(|a, b| rank(a).cmp(&rank(b)).then(a.at.cmp(&b.at)).then_with(|| filed_before(&a.id, &b.id)));
        v
    }

    /// Paying debts recorded against us in order, while we can and keep `keep` in hand.
    pub fn pay_debts<T>(&mut self, book: &Book, cx: &Cx, account: &str, balance: i64, keep: i64) -> Vec<Step<T>> {
        let mut out = vec![];
        let mut left = balance - keep;
        for d in self.debts(book) {
            let amount = about_amount(d);
            let holder = match &d.body {
                RecordBody::Claim { holder, .. } => holder.as_str(),
                _ => "",
            };
            let to = about_str(d, "account").map(String::from).or_else(|| creditor_account(book, holder));
            let Some(to) = to else { break };
            if amount > left {
                break;
            }
            left -= amount;
            self.paid.insert(d.id.to_string());
            let what = about_str(d, "for").unwrap_or_else(|| about_kind(d));
            out.push(because(
                format!("Paying a debt recorded against us ({what})."),
                vec![pay(&to, amount, Pay { from: Some(account.into()), for_: Some(format!("Paying {} {}.", about_kind(d), d.id)), settles: Some(d.id.to_string()), ..Default::default() }, cx)],
            ));
        }
        out
    }

    /// Each plan: are we insolvent now (only while trading)? In default on a loan; or with debts recorded against us
    /// unpaid for `short_days` that we cannot pay (more than we have), and no credit to be had.
    pub fn insolvent(&self, t: i64, book: &Book, cx: &Cx, balance: i64, no_credit: bool, defaulted: bool) -> Option<String> {
        if self.state != State::Trading {
            return None;
        }
        if defaulted {
            return Some("we're in default on a loan".into());
        }
        let owed = self.debts(book);
        let total: i64 = owed.iter().map(|d| about_amount(d)).sum();
        let first = owed.iter().map(|d| d.at).min()?;
        if no_credit && total > balance && t - first >= self.p.short_days * DAY {
            return Some(format!(
                "{} of debts recorded against us have gone unpaid for {} days, more than we have, with no credit to be had",
                money_words(total, &cx.ctx.world),
                (t - first).div_euclid(DAY)
            ));
        }
        None
    }

    /// Each plan: have our owners given up on us? Nobody has worked for us for `idle_days` (we cannot staff ourselves,
    /// so cannot trade): they close us, a voluntary winding up, while we can still pay what we owe.
    pub fn idle(&mut self, t: i64, staffed: bool) -> Option<String> {
        if self.active_at < 0 || staffed {
            self.active_at = t;
        }
        if self.state != State::Trading || t - self.active_at < self.p.idle_days * DAY {
            return None;
        }
        Some(format!("nobody has worked for us for {} days", (t - self.active_at).div_euclid(DAY)))
    }

    /// Beginning to wind up: said publicly (insolvent, or closed by our owners); everyone let go; our price lists
    /// withdrawn.
    pub fn begin<T>(&mut self, t: i64, book: &Book, staffing: &mut Staffing, why: &str, voluntary: bool) -> Vec<Step<T>> {
        self.state = State::WindingUp;
        self.since = t;
        let lists: Vec<String> = book.open("price_list").filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str())).map(|r| r.id).map(|x| x.to_string()).collect();
        let withdraw = |why: &str| lists.iter().map(|id| crate::common::withdraw(id, Some(why))).collect::<Vec<_>>();
        let mut steps = vec![];
        if voluntary {
            let mut calls = vec![say(
                "closing",
                &format!("{} is closing ({why}), and is being wound up by its owners.", self.me),
                Say { visible: Some(Visible::Public), data: Some(json!({ "firm": self.me, "reason": why, "since": t })), ..Default::default() },
            )];
            calls.extend(withdraw("Closing: no longer trading."));
            steps.push(because(format!("Our owners are closing us ({why}): winding up."), calls));
        } else {
            let mut calls = vec![say(
                "insolvency",
                &format!("{} can't pay its debts as they fall due ({why}), and is being wound up.", self.me),
                Say { visible: Some(Visible::Public), data: Some(json!({ "firm": self.me, "reason": why, "since": t })), ..Default::default() },
            )];
            calls.extend(withdraw("Winding up: no longer trading."));
            steps.push(because(format!("We can't pay our debts as they fall due ({why}): we're insolvent, and winding up."), calls));
        }
        steps.extend(staffing.let_go_all(book, t, "Winding up: letting everyone go, with the notice their contracts give.", "Redundancy: the business is being wound up."));
        steps
    }

    /// Whether it is time to finish (after the wind-up period).
    pub fn due(&self, t: i64) -> bool {
        self.state == State::WindingUp && t - self.since >= self.p.wind_up_days * DAY
    }

    /// Finishing: what we owe paid from what we have, in order; our loan repayments stopped; anything left to our
    /// shareholders (`distribute_to`); and closed.
    pub fn finish<T>(&mut self, t: i64, book: &Book, cx: &Cx, account: &str, balance: i64, distribute_to: &dyn Fn(i64) -> Vec<Step<T>>) -> Vec<Step<T>> {
        self.state = State::Closed;
        let usd = |n: i64| money_words(n, &cx.ctx.world);
        let mut left = balance;
        let mut pays = vec![];
        let mut paid: Vec<String> = vec![];
        let debts = self.debts(book);
        let in_default: BTreeSet<String> = debts.iter().flat_map(|d| bases_of(d).iter().map(|x| x.to_string())).collect();
        for d in &debts {
            let amount = left.min(about_amount(d));
            let holder = match &d.body {
                RecordBody::Claim { holder, .. } => holder.as_str(),
                _ => "",
            };
            let Some(to) = about_str(d, "account").map(String::from).or_else(|| creditor_account(book, holder)) else { continue };
            if amount <= 0 {
                continue;
            }
            pays.push(pay(&to, amount, Pay { from: Some(account.into()), for_: Some(format!("Winding up: paying {} {}.", about_kind(d), d.id)), settles: Some(d.id.to_string()), ..Default::default() }, cx));
            left -= amount;
            paid.push(d.id.to_string());
        }
        // Loans not in default: what is left of the repayments falls due now.
        for a in book.of_type("agreement") {
            let RecordBody::Agreement { terms } = &a.body else { continue };
            if terms.template.as_deref() != Some("loan") || !terms.parties.contains(&self.me) || !book.concluded(&a.id) || in_default.contains(a.id.as_str()) {
                continue;
            }
            let (owe, _) = commitment_of(a, &self.me);
            let Some(m) = owe.and_then(|o| o.money) else { continue };
            let months = terms.term.unwrap_or(0).div_euclid(MONTH);
            let done = (t - book.signed_at(&a.id).unwrap_or(t)).div_euclid(MONTH);
            let amount = left.min((months - done).max(0) * m.amount);
            if amount > 0 {
                pays.push(pay(&m.to, amount, Pay { from: Some(account.into()), for_: Some(format!("Winding up: repaying loan {}.", a.id)), ..Default::default() }, cx));
                left -= amount;
            }
        }
        for p in &paid {
            self.paid.insert(p.clone());
        }
        let stops: Vec<String> = book
            .all("request")
            .filter(|r| {
                r.speaks_for.as_deref() == Some(self.me.as_str())
                    && !book.withdrawn(&r.id)
                    && matches!(&r.body, RecordBody::Statement { data: Some(d), .. } if d.pointer("/outcome/money/for").and_then(Value::as_str) == Some("Loan repayment."))
            })
            .map(|r| r.id).map(|x| x.to_string())
            .collect();
        let mut steps = vec![];
        for chunk in pays.chunks(30) {
            steps.push(because(format!("Winding up: paying what we owe from the {} we have.", usd(balance)), chunk.to_vec()));
        }
        if !stops.is_empty() {
            steps.push(because("Winding up: our loan repayments are settled (or can't be); stopping them.", stops.iter().map(|id| crate::common::withdraw(id, Some("Winding up."))).collect()));
        }
        if left > 0 {
            steps.extend(distribute_to(left));
        }
        let to_creditors = balance - left.max(0);
        steps.push(because(
            format!("Wound up: {} paid to creditors{}. Closed.", usd(to_creditors), if left > 0 { format!(", {} to our shareholders", usd(left)) } else { String::new() }),
            vec![say(
                "closure",
                &format!("{} has been wound up and has closed.", self.me),
                Say { visible: Some(Visible::Public), data: Some(json!({ "firm": self.me, "to_creditors": to_creditors, "to_shareholders": left.max(0), "debts_paid": paid })), ..Default::default() },
            )],
        ));
        steps
    }

    /// Every observation: money paid to us once we have closed, by paying account (a buyer's); a debt settled from our
    /// account (by us, or by our bank under a garnishee order) is paid.
    pub fn absorb(&mut self, pic: &Picture, account: Option<&str>) {
        if let Some(acc) = account {
            for tx in pic.transactions() {
                if tx.from == acc {
                    if let Some(s) = &tx.settles {
                        self.paid.insert(s.to_string());
                    }
                }
            }
        }
        if self.state != State::Closed {
            return;
        }
        let Some(acc) = account else { return };
        for tx in pic.transactions() {
            if tx.to == acc && tx.from != acc {
                *self.credit.entry(tx.from.to_string()).or_insert(0) += crate::common::cents(tx.amount);
            }
        }
    }

    /// After closing: our premises offered for sale (the lot's title, and the building on it) at `price`, and sold to
    /// the first buyer whose purchase is paid in full; the title is transferred, and the proceeds go to what we still
    /// owe, then to our shareholders. Unsold after `reprice_days`, the asking price comes down by `reprice_bps` (the
    /// listing withdrawn and published again), and again after as long. Payments that come too late are returned.
    pub fn sell<T>(&mut self, pic: &Picture, book: &Book, cx: &Cx, account: &str, balance: i64, premises: Option<&Premises>, price: Option<i64>, distribute_to: &dyn Fn(i64) -> Vec<Step<T>>) -> Vec<Step<T>> {
        let (Some(premises), Some(price)) = (premises, price.filter(|p| *p > 0)) else { return vec![] };
        if self.state != State::Closed {
            return vec![];
        }
        let usd = |n: i64| money_words(n, &cx.ctx.world);
        let t = pic.t;
        let titles: Vec<&Arc<Record>> = book
            .of_type("claim")
            .filter(|r| {
                matches!(&r.body, RecordBody::Claim { position, holder, .. } if *holder == self.me && format!("{position:?}") == "Right")
                    && about_kind(r) == "ownership"
                    && !book.withdrawn(&r.id)
                    && !book.of_type("claim_transfer").any(|x| matches!(&x.body, RecordBody::ClaimTransfer { claim, .. } if *claim == r.id))
            })
            .collect();
        let lots: Vec<String> = titles.iter().filter_map(|c| about_str(c, "object").map(String::from)).collect();
        let me = self.me.clone();
        let listing = |s: &mut Self, why: String, at: i64, old: Vec<String>| -> Step<T> {
            s.listed_at = t;
            s.asking = at;
            let mut calls: Vec<_> = old.iter().map(|id| crate::common::withdraw(id, Some("Superseded: a new asking price."))).collect();
            let offer = json!({ "by": me, "take_up": "order", "available": 1, "terms": { "template": "sale", "commitments": [
                { "who": "taker", "does": { "outcome": { "money": { "to": account, "amount": at.to_string(), "for": format!("{} and its lot", premises.structure) } } } },
                { "who": me, "does": { "text": format!("Transfers {} and its lot ({}) to the buyer.", premises.structure, lots.join(", ")) } },
            ] } });
            calls.push(say(
                "property_for_sale",
                &format!("For sale: {} (a {}) and its lot, {}. To buy, publish a purchase and pay with it.", premises.structure, premises.type_, usd(at)),
                Say {
                    visible: Some(Visible::Public),
                    data: Some(json!({ "seller": me, "structure": premises.structure, "type": premises.type_, "cell": premises.cell, "lots": lots, "price": at, "account": account })),
                    extra: vec![("offer", offer)],
                    ..Default::default()
                },
            ));
            because(why, calls)
        };
        if self.listed_at < 0 && !titles.is_empty() {
            let why = format!("Closed: offering our premises ({}, a {}) for sale at {}.", premises.structure, premises.type_, usd(price));
            return vec![listing(self, why, price, vec![])];
        }
        let price = if self.asking > 0 { self.asking } else { price };
        if !self.sold && self.listed_at >= 0 && t - self.listed_at >= self.p.reprice_days * DAY && !book.open("property_purchase").any(|r| crate::common::addressed_to(r).iter().any(|x| x == &self.me)) {
            let lower = price * (10_000 - self.p.reprice_bps) / 10_000;
            let old: Vec<String> = book.open("property_for_sale").filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str())).map(|r| r.id).map(|x| x.to_string()).collect();
            let why = format!("Our premises unsold after {} days at {}: asking {}.", (t - self.listed_at).div_euclid(DAY), usd(price), usd(lower));
            return vec![listing(self, why, lower, old)];
        }
        let mut steps = vec![];
        if self.sold {
            // Paid too late (sold already): returned.
            let back: Vec<(String, i64)> = self.credit.iter().filter(|(_, x)| **x > 0).map(|(k, x)| (k.clone(), *x)).collect();
            for (from, x) in back {
                steps.push(because("A payment for our premises, already sold: returning it.", vec![pay(&from, x, Pay { from: Some(account.into()), for_: Some("Refund: the property is sold.".into()), ..Default::default() }, cx)]));
                self.credit.insert(from, 0);
            }
            return steps;
        }
        let mut purchases: Vec<&Arc<Record>> = book.open("property_purchase").filter(|r| crate::common::addressed_to(r).iter().any(|x| x == &self.me)).collect();
        purchases.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
        for pch in purchases {
            let from = match &pch.body {
                RecordBody::Statement { data: Some(d), .. } => d.get("account").and_then(Value::as_str).unwrap_or("").to_string(),
                _ => String::new(),
            };
            if self.credit.get(&from).copied().unwrap_or(0) < price {
                continue;
            }
            self.sold = true;
            *self.credit.entry(from).or_insert(0) -= price;
            let buyer = pch.speaks_for.unwrap_or_default();
            let mut calls: Vec<_> = titles.iter().map(|c| call("claim", vec![("transfer", Some(arg(&c.id))), ("to", Some(arg(&buyer)))])).collect();
            calls.push(say(
                "property_sold",
                &format!("Sold: {} to {} for {}.", premises.structure, buyer, usd(price)),
                Say { visible: Some(Visible::Public), basis: Some(pch.id.to_string()), data: Some(json!({ "structure": premises.structure, "buyer": buyer, "price": price })), ..Default::default() },
            ));
            steps.push(because(format!("{buyer} has bought our premises, paid in full: transferring the title."), calls));
            // The proceeds: what we still owe first (as far as it goes), then our shareholders.
            let owed: i64 = self.debts(book).iter().map(|d| about_amount(d)).sum();
            steps.extend(self.pay_debts(book, cx, account, balance, 0));
            let still: i64 = self.debts(book).iter().map(|d| about_amount(d)).sum();
            let paid_now = owed - still;
            if balance - paid_now > 0 {
                steps.extend(distribute_to(balance - paid_now));
            }
            break;
        }
        steps
    }
}

#[cfg(test)]
mod recover_tests {
    use super::*;
    use crate::firms::testkit::{statement, taken};

    fn params() -> WindingParams {
        WindingParams { short_days: 10, wind_up_days: 10, idle_days: 30, reprice_days: 30, reprice_bps: 1_000 }
    }

    /// ME-21: a new holder of a closed shop's post finds the shop closed, and its premises in the sale at the price asked.
    #[test]
    fn a_new_holder_finds_the_firm_closed_and_for_sale() {
        let book = taken(vec![
            statement("rec.1", 100, "closure", json!({ "firm": "shop-1" }), "shop-1"),
            statement("rec.2", 200, "property_for_sale", json!({ "price": 33_000, "structure": "shop-1-premises" }), "shop-1"),
            statement("rec.3", 300, "closure", json!({ "firm": "other" }), "other"),
        ]);
        let mut w = WindingUp::new("shop-1", params());
        w.recover(&book);
        assert_eq!(w.state, State::Closed);
        assert_eq!((w.listed_at, w.asking, w.sold), (200, 33_000, false));
        let mut other = WindingUp::new("shop-2", params());
        other.recover(&book);
        assert_eq!(other.state, State::Trading);
    }

    #[test]
    fn a_new_holder_finds_the_firm_winding_up() {
        let book = taken(vec![statement("rec.1", 100, "closing", json!({ "firm": "shop-1", "since": 90 }), "shop-1")]);
        let mut w = WindingUp::new("shop-1", params());
        w.recover(&book);
        assert_eq!((w.state, w.since), (State::WindingUp, 90));
    }
}
