//! world.tax_collector: the tax collector's office, which keeps each taxpayer's account (docs/behaviour/public-finance.md,
//! "The taxpayer's account"; risk PB-23). For a town, the collector of the tax on pay is the outside world's (a higher
//! government's), as the support office is.
//!
//! What it keeps is made only of what is its own: the returns of tax withheld addressed to it, the payments into the
//! accounts its charges are paid into, and its own decisions. Nobody's whole register is shown to it (no `keeps`): an
//! account is a taxpayer's returns and payments as they reached the collector. A taxpayer sees its own account in the
//! statements the collector sends it, and on asking for one.
//!
//! How an account is reckoned (`ledger`), in the order things happened:
//! - each return is a liability for its period: what it says is owed, less what was still owing from the return before
//!   it under the same rule (a return that could not be paid in full carries the rest into the next one's figure);
//! - each payment is allocated to what is outstanding, the oldest first; what is left over is held on account;
//! - money on account is allocated to the next return's liability as it comes (so a taxpayer that pays ahead, or sets a
//!   credit off against a return by paying less, is square);
//! - a refund it grants is paid out of what is on account.
//!
//! A payment is a tax payment when its reference says so: it goes into one of the collector's accounts, from somewhere
//! else, and its words name tax, a sum withheld, or a charge of the law. (A real payment carries a structured reference;
//! a payment here carries its payer's words: PB-23, what is left.) One that does not is not allocated to anyone.
//!
//! What is on account, less any credit the collector has agreed may be set against a later return and not yet used, is
//! the taxpayer's credit. The collector tells a taxpayer of a credit when it first stands (and of a new figure); the
//! taxpayer may claim it back (a refund) or, where the law allows, ask to set it against its next return, on the public
//! claim form. Whoever does the collector's work decides each claim in the time its row in the table of work gives,
//! against the account, and may wrongly refuse one that is due at the rate of the world's table of slips; a decision is
//! looked at again when asked inside the days the law's decisions give (`law-decisions`, kind `tax_credit_decision`).

use super::shared::{answering, manifest, restore_answering};
use super::support::Casework;
use super::support_law::{Reconsiderations, Redone};
use crate::common::{addressed_to, cents, data, filed_before, made_at, money_words, when_words, Book, Fields, Occurrences};
use crate::firms::tax::{income_tax_law, latest_law};
use crate::steps::{because, pay, say, Pay, Plan, Say, Step, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture, DAY};
use oikos_rules::slip::{slip, SlipOptions};
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub const CLAIM: &str = "tax_credit_claim";
pub const DECISION: &str = "tax_credit_decision";
pub const STATEMENT: &str = "tax_statement";
pub const REQUEST: &str = "tax_account_request";
const RETURN: &str = "withholding_report";

/// The law on tax paid and not owed (`law-tax-refunds`, data.refunds): who keeps the accounts, whether a credit may be
/// set against a later return, and the days the law gives the collector to pay a refund (said, not waited for).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefundLaw {
    pub id: String,
    pub collector: String,
    pub set_off: bool,
    pub pay_within_days: Option<i64>,
}

/// The law on refunds in force that has been seen (the latest published and not withdrawn), if any.
pub fn refund_law(book: &Book) -> Option<RefundLaw> {
    let l = latest_law(book, |r| data(r).get("refunds").is_some_and(Value::is_object))?;
    let d = &data(l)["refunds"];
    Some(RefundLaw {
        id: l.id.clone(),
        collector: d.s("collector").map(String::from).or_else(|| l.speaks_for.clone()).unwrap_or_default(),
        set_off: d.get("set_off").and_then(Value::as_bool).unwrap_or(false),
        pay_within_days: d.i("pay_within_days"),
    })
}

/// An amount written in a paper (a number, or a decimal string of the smallest unit).
fn amount(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

/// A payment into one of the collector's accounts that its reference says is tax.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Paid {
    pub t: i64,
    pub from: String,
    pub to: String,
    pub amount: i64,
}

/// A taxpayer's account as the collector reckons it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Ledger {
    /// Every period's liability, as its return gave it.
    pub owed: i64,
    pub paid: i64,
    pub refunded: i64,
    /// Owed and not yet paid.
    pub outstanding: i64,
    /// Paid and not allocated to any period.
    pub on_account: i64,
    /// Credit the collector has agreed may be set against a later return, not yet used in one.
    pub reserved: i64,
    pub returns: usize,
    /// The accounts its returns say it pays from (the first named first).
    pub accounts: Vec<String>,
}

impl Ledger {
    /// What the taxpayer may claim: what is on account, less what is to be set off.
    pub fn credit(&self) -> i64 {
        (self.on_account - self.reserved).max(0)
    }
}

/// A decision of ours not yet on the file (made this round or the last), so that a second claim is not granted the same credit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Granted {
    claim: String,
    taxpayer: String,
    refund: bool,
    amount: i64,
    at: i64,
}

/// The account of `who` with `me`, from the papers on file and the payments received.
pub fn ledger(book: &Book, me: &str, paid: &[Paid], who: &str, unseen: &[(bool, i64, i64)]) -> Ledger {
    let mut l = Ledger::default();
    // (0: a liability, 1: a payment, 2: a refund paid; in the order they happened, a return before the payment made with it.)
    let mut events: Vec<(i64, u8, i64)> = vec![];
    let mut returns: Vec<&Arc<Record>> =
        book.all(RETURN).filter(|r| r.speaks_for.as_deref() == Some(who) && addressed_to(r).iter().any(|a| a == me)).collect();
    returns.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
    let mut carried: BTreeMap<String, i64> = BTreeMap::new();
    let mut set_off_used = 0;
    for r in &returns {
        let d = data(r);
        let rule = d.s("return").unwrap_or("").to_string();
        let (withheld, paid_now, set_off) = (amount(d.get("withheld")), amount(d.get("paid")), amount(d.get("set_off")));
        let before = carried.get(&rule).copied().unwrap_or(0);
        let liability = (withheld - before).max(0);
        carried.insert(rule, (withheld - paid_now - set_off).max(0));
        set_off_used += set_off;
        if let Some(a) = d.s("account") {
            if !l.accounts.iter().any(|x| x == a) {
                l.accounts.push(a.to_string());
            }
        }
        l.returns += 1;
        events.push((r.at, 0, liability));
    }
    for p in paid.iter().filter(|p| l.accounts.contains(&p.from)) {
        events.push((p.t, 1, p.amount));
    }
    let mut set_off_granted = 0;
    let mut mine: Vec<&Arc<Record>> = book.all(DECISION).filter(|r| r.speaks_for.as_deref() == Some(me) && data(r).s("taxpayer") == Some(who)).collect();
    mine.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
    for d in mine {
        let dd = data(d);
        if dd.get("granted").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let g = amount(dd.get("amount"));
        if dd.s("use") == Some("set_off") {
            set_off_granted += g;
        } else {
            events.push((d.at, 2, g));
        }
    }
    for (refund, g, at) in unseen {
        if *refund {
            events.push((*at, 2, *g));
        } else {
            set_off_granted += g;
        }
    }
    events.sort();
    for (_, what, n) in events {
        match what {
            0 => {
                l.owed += n;
                l.outstanding += n;
                let take = l.on_account.min(l.outstanding);
                l.on_account -= take;
                l.outstanding -= take;
            }
            1 => {
                l.paid += n;
                let take = n.min(l.outstanding);
                l.outstanding -= take;
                l.on_account += n - take;
            }
            _ => {
                l.refunded += n;
                l.on_account -= n;
                if l.on_account < 0 {
                    l.outstanding -= l.on_account;
                    l.on_account = 0;
                }
            }
        }
    }
    l.reserved = (set_off_granted - set_off_used).max(0);
    l
}

/// Whether a payment's words say it is tax: they name tax, something withheld, or one of the law's charges.
pub fn says_tax(memo: &str, charges: &[(String, Option<String>)]) -> bool {
    let m = memo.to_lowercase();
    m.contains("tax")
        || m.contains("withheld")
        || charges.iter().any(|(id, name)| (id.len() > 2 && m.contains(&id.to_lowercase())) || name.as_ref().is_some_and(|n| n.len() > 2 && m.contains(&n.to_lowercase())))
}

pub struct TaxCollector;

impl Kind for TaxCollector {
    fn name(&self) -> &'static str {
        "world.tax_collector"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/public-finance.md"
    }
    fn manifest(&self) -> Value {
        manifest(
            include_str!("manifests/world.tax_collector.json"),
            "the tax collector",
            "What it acts on: a taxpayer's claim to have a credit on its account repaid or set against its next return, made on the claim form; a taxpayer's request for a statement of its own account; and a request to look at one of its decisions again. A letter changes nothing on an account.",
        )
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        0
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let me = ctx.entity.clone();
        answering(
            &self.manifest(),
            Collector {
                recon: Reconsiderations::new(&me, &[DECISION]),
                me,
                book: Book::new(),
                paid: vec![],
                decided: BTreeSet::new(),
                answered: BTreeSet::new(),
                stated: BTreeMap::new(),
                unseen: vec![],
                nth: Occurrences::default(),
                casework: ctx.param("casework", None)?,
            },
        )
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore_answering::<Collector>(&self.manifest(), saved)
    }
}

#[derive(Serialize, Deserialize)]
struct Collector {
    me: String,
    book: Book,
    /// Every tax payment received, as the account's statement showed it (the statement shows each once).
    paid: Vec<Paid>,
    decided: BTreeSet<String>,
    answered: BTreeSet<String>,
    /// The credit last stated to each taxpayer.
    stated: BTreeMap<String, i64>,
    unseen: Vec<Granted>,
    nth: Occurrences,
    recon: Reconsiderations,
    /// Who does the collector's casework, where the world says (law 10): its officers' desk, named on every step that is only
    /// papers of these kinds (a decision, a review and its answer), so that each takes an officer's minutes in the officers'
    /// hours. A refund's payment is a step of its own, the case system's. Absent: whoever acts does it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    casework: Option<Casework>,
}

/// The decision on a claim, against the account.
struct Decided {
    granted: i64,
    reason: Option<String>,
}

/// The accounts the law's charges collected by `me` are paid into, and each such charge's id and name.
fn charges_of(book: &Book, me: &str) -> (Vec<String>, Vec<(String, Option<String>)>) {
    let Some(law) = income_tax_law(book) else { return (vec![], vec![]) };
    let mut accounts = vec![];
    let mut names = vec![];
    for c in law.charges.iter().filter(|c| c.collector == me && !c.account.is_empty()) {
        if !accounts.contains(&c.account) {
            accounts.push(c.account.clone());
        }
        names.push((c.id.clone(), c.name.clone()));
    }
    (accounts, names)
}

impl Collector {
    fn unseen_of(&self, who: &str) -> Vec<(bool, i64, i64)> {
        self.unseen.iter().filter(|g| g.taxpayer == who).map(|g| (g.refund, g.amount, g.at)).collect()
    }

    fn account_of(&self, who: &str) -> Ledger {
        self.account_in(&self.book, who)
    }

    fn account_in(&self, book: &Book, who: &str) -> Ledger {
        ledger(book, &self.me, &self.paid, who, &self.unseen_of(who))
    }

    fn statement(&self, who: &str, l: &Ledger, t: i64, cx: &Cx, basis: Option<String>, why: &str) -> Step<()> {
        let world = &cx.ctx.world;
        let usd = |n: i64| money_words(n, world);
        let mut text = format!(
            "Your account with the tax collector, as at {}: owed on your returns {}, paid {}, refunded {}; {}.",
            when_words(t, world),
            usd(l.owed),
            usd(l.paid),
            usd(l.refunded),
            if l.credit() > 0 {
                format!("in credit by {}", usd(l.credit()))
            } else if l.outstanding > 0 {
                format!("{} owing", usd(l.outstanding))
            } else {
                "nothing owing and nothing in credit".to_string()
            }
        );
        if l.reserved > 0 {
            text.push_str(&format!(" A further {} is to be set against your next return, as agreed.", usd(l.reserved)));
        }
        if l.credit() > 0 {
            text.push_str(" A credit may be claimed on the claim form.");
        }
        because(
            why.to_string(),
            vec![say(
                STATEMENT,
                &text,
                Say {
                    to: Some(vec![who.to_string()]),
                    visible: Some(Visible::Only(vec![who.to_string(), self.me.clone()])),
                    basis,
                    data: Some(json!({ "taxpayer": who, "as_of": t, "owed": l.owed, "paid": l.paid, "refunded": l.refunded, "outstanding": l.outstanding, "credit": l.credit(), "to_set_off": l.reserved })),
                    ..Default::default()
                },
            )],
        )
    }

    /// A claim decided against the account (no slip: that is the caller's).
    fn decide(l: &Ledger, refund: bool, asked: i64, law: Option<&RefundLaw>, world: &crate::WorldInfo) -> Decided {
        if !refund && !law.is_some_and(|x| x.set_off) {
            return Decided { granted: 0, reason: Some("the law gives no setting of a credit against a later return: a credit is claimed back".into()) };
        }
        let credit = l.credit();
        if credit <= 0 {
            return Decided { granted: 0, reason: Some("the account shows no credit".into()) };
        }
        let granted = if asked > 0 { asked.min(credit) } else { credit };
        let reason = (asked > credit).then(|| format!("the account is in credit by {} only", money_words(credit, world)));
        Decided { granted, reason }
    }

    /// The decision's paper (and the refund paid with it).
    #[allow(clippy::too_many_arguments)]
    fn decision(&mut self, book: &Book, claim: &Record, who: &str, refund: bool, asked: i64, d: &Decided, t: i64, cx: &Cx, review: Option<(&str, &str)>) -> (oikos_sight::calls::Call, Option<oikos_sight::calls::Call>) {
        let world = cx.ctx.world.clone();
        let usd = |n: i64| money_words(n, &world);
        let law = refund_law(book);
        let into = data(claim).s("account").map(String::from).or_else(|| self.account_in(book, who).accounts.first().cloned());
        let (from, _) = charges_of(book, &self.me);
        let use_ = if refund { "refund" } else { "set_off" };
        let mut dd = json!({ "claim": claim.id, "taxpayer": who, "use": use_, "asked": asked, "granted": d.granted > 0, "amount": d.granted });
        if let Some(r) = &d.reason {
            dd["reason"] = json!(r);
        }
        if let Some((req, replaces)) = review {
            dd["on_review"] = json!(req);
            dd["replaces"] = json!(replaces);
        }
        let text = if d.granted > 0 && refund {
            let within = law.as_ref().and_then(|l| l.pay_within_days).map_or(String::new(), |n| format!(" (the law gives {n} days)"));
            format!("Claim {} decided: a refund of {} granted, paid now into {}{within}{}.", claim.id, usd(d.granted), into.clone().unwrap_or_default(), d.reason.as_ref().map_or(String::new(), |r| format!("; {r}")))
        } else if d.granted > 0 {
            format!(
                "Claim {} decided: {} of your credit may be set against your next return: pay that much less on it, and say so on it{}.",
                claim.id,
                usd(d.granted),
                d.reason.as_ref().map_or(String::new(), |r| format!("; {r}"))
            )
        } else {
            format!("Claim {} refused: {}.", claim.id, d.reason.clone().unwrap_or_default())
        };
        let paper = say(
            DECISION,
            &text,
            Say { to: Some(vec![who.to_string()]), visible: Some(Visible::Only(vec![who.to_string(), self.me.clone()])), basis: Some(claim.id.clone()), data: Some(dd), ..Default::default() },
        );
        let mut paying = None;
        if d.granted > 0 {
            self.unseen.push(Granted { claim: claim.id.clone(), taxpayer: who.to_string(), refund, amount: d.granted, at: t });
            if let (true, Some(into), Some(from)) = (refund, into, from.first()) {
                paying = Some(pay(&into, d.granted, Pay { from: Some(from.clone()), for_: Some(format!("Refund of tax paid and not owed (claim {}).", claim.id)), ..Default::default() }, cx));
            }
        }
        (paper, paying)
    }
}

impl Plan for Collector {
    type Then = ();

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        let (accounts, names) = charges_of(&self.book, &self.me);
        if accounts.is_empty() {
            return;
        }
        for tx in pic.transactions() {
            if accounts.contains(&tx.to) && !accounts.contains(&tx.from) && says_tax(tx.memo.as_deref().unwrap_or(""), &names) {
                self.paid.push(Paid { t: tx.t, from: tx.from.clone(), to: tx.to.clone(), amount: cents(tx.amount) });
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let mut steps = self.plan_office(pic, cx);
        if let Some(c) = &self.casework {
            for s in &mut steps {
                c.assign(s);
            }
        }
        steps
    }
}

impl Collector {
    fn plan_office(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let t = pic.t;
        let world = cx.ctx.world.clone();
        let mut steps: Vec<Step<()>> = vec![];
        // (A decision of ours now on the file is counted from the file.)
        let on_file: BTreeSet<String> = self.book.all(DECISION).filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str())).filter_map(|r| data(r).s("claim").map(String::from)).collect();
        self.unseen.retain(|g| !on_file.contains(&g.claim));
        // A taxpayer's request for a statement of its own account: answered with one.
        let mut asks: Vec<Arc<Record>> = self.book.open(REQUEST).filter(|r| addressed_to(r).iter().any(|a| a == &self.me) && !self.answered.contains(&r.id)).cloned().collect();
        asks.sort_by(|a, b| made_at(a).cmp(&made_at(b)).then_with(|| filed_before(&a.id, &b.id)));
        for r in asks {
            self.answered.insert(r.id.clone());
            let Some(who) = r.speaks_for.clone() else { continue };
            let l = self.account_of(&who);
            self.stated.insert(who.clone(), l.credit());
            steps.push(self.statement(&who, &l, t, cx, Some(r.id.clone()), &format!("{who} asks for a statement of its account: sending it.")));
        }
        // Claims, the oldest first: each decided against the account.
        let law = refund_law(&self.book);
        let mut claims: Vec<Arc<Record>> = self.book.open(CLAIM).filter(|r| addressed_to(r).iter().any(|a| a == &self.me) && !self.decided.contains(&r.id)).cloned().collect();
        claims.sort_by(|a, b| made_at(a).cmp(&made_at(b)).then_with(|| filed_before(&a.id, &b.id)));
        for c in claims {
            self.decided.insert(c.id.clone());
            let Some(who) = c.speaks_for.clone() else { continue };
            let refund = data(&c).s("use") != Some("set_off");
            let asked = amount(data(&c).get("amount"));
            let l = self.account_of(&who);
            let mut d = Self::decide(&l, refund, asked, law.as_ref(), &world);
            // A claim that is due may be refused wrongly (a payment not matched to the account): a slip of whoever decides, at the
            // rate of the world's table of slips; a review decides it again on the account, without one.
            if d.granted > 0 {
                let case = self.nth.key(&c.id, &[Some(who.as_str())]);
                if slip(cx, "publish/tax_credit_decision", &case, &SlipOptions::default()) {
                    d = Decided { granted: 0, reason: Some("the payment could not be matched to the account".into()) };
                }
            }
            let why = if d.granted > 0 { format!("{who} claims a credit on its account: {} granted.", money_words(d.granted, &world)) } else { format!("{who} claims a credit on its account: refused.") };
            let book = std::mem::take(&mut self.book);
            let (paper, paying) = self.decision(&book, &c, &who, refund, asked, &d, t, cx, None);
            self.book = book;
            steps.push(because(why, vec![paper]));
            if let Some(p) = paying {
                steps.push(because(format!("Paying {who} the refund granted on its claim {}.", c.id), vec![p]));
            }
        }
        // A credit that stands on an account is stated to its taxpayer, when it first stands and when its figure changes.
        let mut payers: BTreeSet<String> = BTreeSet::new();
        for r in self.book.all(RETURN).filter(|r| addressed_to(r).iter().any(|a| a == &self.me)) {
            if let Some(w) = &r.speaks_for {
                payers.insert(w.clone());
            }
        }
        for who in payers {
            let l = self.account_of(&who);
            let credit = l.credit();
            let before = self.stated.get(&who).copied().unwrap_or(0);
            if credit != before {
                self.stated.insert(who.clone(), credit);
                if credit > 0 {
                    steps.push(self.statement(&who, &l, t, cx, None, &format!("{who}'s account is in credit by {}: telling it.", money_words(credit, &world))));
                }
            }
        }
        // Asked to look at a decision again, inside the law's days: decided again on the account as it stands, without a slip.
        let mut recon = std::mem::take(&mut self.recon);
        let book = std::mem::take(&mut self.book);
        let b = &book;
        let mut redo = |dec: &Record, req: &Record| -> Option<Redone<()>> {
            let dd = data(dec);
            let who = dd.s("taxpayer")?.to_string();
            let refund = dd.s("use") != Some("set_off");
            let asked = amount(dd.get("asked"));
            let had = amount(dd.get("amount"));
            if dd.get("granted").and_then(Value::as_bool) == Some(true) && (asked <= 0 || had >= asked) {
                return Some(Redone { changed: false, found: "the claim was granted in full".into(), steps: vec![] });
            }
            let claim = b.get(dd.s("claim")?)?.clone();
            let l = self.account_in(b, &who);
            let law = refund_law(b);
            let d = Collector::decide(&l, refund, if asked > 0 { asked - had } else { 0 }, law.as_ref(), &world);
            if d.granted <= 0 {
                return Some(Redone { changed: false, found: d.reason.unwrap_or_else(|| "the account shows no credit".into()), steps: vec![] });
            }
            let (paper, paying) = self.decision(b, &claim, &who, refund, asked, &d, t, cx, Some((&req.id, &dec.id)));
            let mut more = vec![because(format!("Our decision {} looked at again: put right.", dec.id), vec![paper])];
            if let Some(p) = paying {
                more.push(because(format!("Paying {who} the refund granted on review of {}.", dec.id), vec![p]));
            }
            Some(Redone { changed: true, found: format!("the account is in credit by {}", money_words(l.credit(), &world)), steps: more })
        };
        let more = recon.steps(&book, t, &mut redo);
        self.book = book;
        self.recon = recon;
        steps.extend(more);
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::super::shared::rig::*;
    use super::*;
    use crate::Action;
    use oikos_sight::{AccountItem, Seen, Transaction};

    fn tax_law() -> Arc<Record> {
        st("law-tax", 0, "law", "outside", json!({ "tax": "income", "charges": [{ "id": "isr", "name": "ISR", "schedule": [{ "from": 0, "rate_bps": 1000 }], "collector": "outside", "account": "acc-o" }] }))
    }
    fn refunds(set_off: bool) -> Arc<Record> {
        st("law-tax-refunds", 0, "law", "outside", json!({ "refunds": { "collector": "outside", "set_off": set_off, "pay_within_days": 40 } }))
    }
    fn reviews() -> Arc<Record> {
        st("law-decisions", 0, "law", "outside", json!({ "decisions": [{ "kind": DECISION, "name": "A decision on a claim for tax paid and not owed", "review": { "within_days": 30, "grounds": "any" } }] }))
    }
    fn ret(id: &str, at: i64, withheld: i64, paid: i64, set_off: i64) -> Arc<Record> {
        let mut d = json!({ "return": "isr", "withheld": withheld, "paid": paid, "account": "acc-clinic" });
        if set_off > 0 {
            d["set_off"] = json!(set_off);
        }
        st_to(id, at, RETURN, "clinic", &["outside"], d)
    }
    fn claim(id: &str, at: i64, use_: &str, amount: i64) -> Arc<Record> {
        st_to(id, at, CLAIM, "clinic", &["outside"], json!({ "office": "outside", "use": use_, "amount": amount, "account": "acc-clinic" }))
    }
    fn tx(t: i64, from: &str, amount: i64, memo: &str) -> Transaction {
        serde_json::from_value(json!({ "t": t, "from": from, "to": "acc-o", "amount": amount.to_string(), "currency": "XTS", "by": "bank", "memo": memo })).unwrap()
    }
    fn office() -> Rig {
        Rig::new(&TaxCollector, "outside", json!({}))
    }
    fn at(r: &mut Rig, t: i64, records: Vec<Arc<Record>>, txs: Vec<Transaction>) -> Vec<Action> {
        let acc = AccountItem { account: "acc-o".into(), holder: "outside".into(), custodian: "bank".into(), currency: "XTS".into(), balance: 1_000_000_000, closed: None };
        r.wake(t, vec![("taxpayers", Seen::Records { records, search: false }), ("ledger", Seen::Accounts { accounts: Arc::new(vec![acc]), transactions: txs })])
    }
    fn kinds(a: &[Action], kind: &str) -> Vec<Value> {
        statements(a).into_iter().filter(|s| s.kind == kind).map(|s| s.data).collect()
    }
    fn book_of(records: Vec<Arc<Record>>) -> Book {
        let mut b = Book::new();
        b.take_all(&records);
        b
    }
    fn paid(t: i64, amount: i64) -> Paid {
        Paid { t, from: "acc-clinic".into(), to: "acc-o".into(), amount }
    }

    #[test]
    fn an_account_allocates_payments_to_what_is_owing_and_holds_what_is_paid_twice_as_credit() {
        // lv-12: month 2's return paid with it; month 3 paid by hand (day 91) before its return; the return paid with it as well (day 105).
        let b = book_of(vec![ret("r1", 77 * DAY, 1_757_392, 1_757_392, 0), ret("r2", 105 * DAY, 1_757_392, 1_757_392, 0)]);
        let early = ledger(&b, "outside", &[paid(77 * DAY + 60, 1_757_392), paid(91 * DAY, 1_757_392)], "clinic", &[]);
        // (Before day 105's payment came in, the hand payment had met month 3's return: square.)
        assert_eq!((early.owed, early.paid, early.outstanding, early.credit()), (3_514_784, 3_514_784, 0, 0));
        let l = ledger(&b, "outside", &[paid(77 * DAY + 60, 1_757_392), paid(91 * DAY, 1_757_392), paid(105 * DAY + 60, 1_757_392)], "clinic", &[]);
        assert_eq!((l.owed, l.paid, l.outstanding, l.credit()), (3_514_784, 5_272_176, 0, 1_757_392), "a month's tax paid twice is a month's credit");
        assert_eq!(l.accounts, ["acc-clinic"]);
        // Someone else's account is not this one, and a payment from an account no return of theirs names is not theirs.
        assert_eq!(ledger(&b, "outside", &[paid(DAY, 5)], "shop", &[]), Ledger::default());
    }

    #[test]
    fn a_return_short_of_money_carries_the_rest_into_the_next_and_it_is_owed_once() {
        // Owed 100, paid 60; the next return says 140 (40 carried, 100 new), all paid: 200 owed in all, 200 paid, square.
        let b = book_of(vec![ret("r1", 30 * DAY, 100, 60, 0), ret("r2", 60 * DAY, 140, 140, 0)]);
        let l = ledger(&b, "outside", &[paid(30 * DAY + 1, 60), paid(60 * DAY + 1, 140)], "clinic", &[]);
        assert_eq!((l.owed, l.paid, l.outstanding, l.credit()), (200, 200, 0, 0));
        // Between the two, 40 was owing.
        let mid = ledger(&book_of(vec![ret("r1", 30 * DAY, 100, 60, 0)]), "outside", &[paid(30 * DAY + 1, 60)], "clinic", &[]);
        assert_eq!(mid.outstanding, 40);
    }

    #[test]
    fn a_payment_is_the_collectors_when_its_words_say_tax() {
        let charges = vec![("isr".to_string(), Some("ISR".to_string()))];
        for m in ["Income tax withheld from wages.", "Withheld from wages: ISR.", "income tax withheld from wages", "ISR month 3"] {
            assert!(says_tax(m, &charges), "{m}");
        }
        for m in ["Order: 153 goods.", "Dividend", "licence of the payment platform", "Maintenance and repairs", ""] {
            assert!(!says_tax(m, &charges), "{m}");
        }
    }

    #[test]
    fn a_month_paid_twice_is_stated_claimed_back_and_repaid_once_and_nothing_is_said_where_nobody_overpays() {
        let mut r = office();
        // A month's return and its payment: nothing to say.
        let quiet = at(&mut r, 78 * DAY, vec![tax_law(), refunds(false), reviews(), ret("r1", 77 * DAY, 1_757_392, 1_757_392, 0)], vec![tx(77 * DAY + 60, "acc-clinic", 1_757_392, "Income tax withheld from wages.")]);
        assert!(statements(&quiet).is_empty(), "an account that is square is not written about: {:?}", statements(&quiet));
        // Other money into the same account is not tax.
        assert!(statements(&at(&mut r, 80 * DAY, vec![], vec![tx(79 * DAY, "acc-clinic", 50_000, "Order: 3 goods.")])).is_empty());
        // Month 3 paid by hand ahead of its return: in credit, said once.
        let ahead = at(&mut r, 92 * DAY, vec![], vec![tx(91 * DAY, "acc-clinic", 1_757_392, "income tax withheld from wages")]);
        let s = kinds(&ahead, STATEMENT);
        assert_eq!(s.len(), 1);
        assert_eq!((s[0]["credit"].as_i64(), s[0]["taxpayer"].as_str()), (Some(1_757_392), Some("clinic")));
        assert_eq!(statements(&ahead)[0].to, ["clinic"], "the taxpayer sees its own account, and nobody else");
        // Its return and its payment as well: the credit stands at the same figure, and is not said again.
        let again = at(&mut r, 106 * DAY, vec![ret("r2", 105 * DAY, 1_757_392, 1_757_392, 0)], vec![tx(105 * DAY + 60, "acc-clinic", 1_757_392, "Income tax withheld from wages.")]);
        assert!(kinds(&again, STATEMENT).is_empty());
        r.save_and_restore();
        // Claimed back: granted, and repaid into the account the claim names.
        let out = at(&mut r, 107 * DAY, vec![claim("c1", 106 * DAY + 600, "refund", 0)], vec![]);
        let d = kinds(&out, DECISION);
        assert_eq!(d.len(), 1);
        assert_eq!((d[0]["granted"].as_bool(), d[0]["amount"].as_i64(), d[0]["use"].as_str()), (Some(true), Some(1_757_392), Some("refund")));
        let p = payments(&out);
        assert_eq!(p.len(), 1);
        assert_eq!((p[0].0.as_str(), p[0].1.as_str(), p[0].2.as_deref()), ("acc-clinic", "$17573.92", Some("acc-o")));
        // A second claim the same day finds nothing left: the first is counted before it is on file.
        let second = at(&mut r, 107 * DAY + 3600, vec![claim("c2", 107 * DAY, "refund", 1_000)], vec![]);
        let d2 = kinds(&second, DECISION);
        assert_eq!((d2[0]["granted"].as_bool(), d2[0]["reason"].as_str()), (Some(false), Some("the account shows no credit")));
        assert!(payments(&second).is_empty());
    }

    #[test]
    fn a_set_off_is_granted_only_where_the_law_allows_it_and_is_used_by_paying_less_on_the_next_return() {
        let dup = vec![tx(31 * DAY, "acc-clinic", 1_000, "Income tax withheld from wages."), tx(32 * DAY, "acc-clinic", 1_000, "income tax")];
        let mut no = office();
        at(&mut no, 33 * DAY, vec![tax_law(), refunds(false), ret("r1", 30 * DAY, 1_000, 1_000, 0)], dup.clone());
        let refused = kinds(&at(&mut no, 34 * DAY, vec![claim("c1", 33 * DAY, "set_off", 1_000)], vec![]), DECISION);
        assert_eq!(refused[0]["granted"], false);
        assert!(refused[0]["reason"].as_str().unwrap().contains("no setting of a credit against a later return"));
        let mut yes = office();
        at(&mut yes, 33 * DAY, vec![tax_law(), refunds(true), ret("r1", 30 * DAY, 1_000, 1_000, 0)], dup.clone());
        let out = at(&mut yes, 34 * DAY, vec![claim("c1", 33 * DAY, "set_off", 0)], vec![]);
        let d = kinds(&out, DECISION);
        assert_eq!((d[0]["granted"].as_bool(), d[0]["amount"].as_i64()), (Some(true), Some(1_000)));
        assert!(payments(&out).is_empty(), "a set-off moves no money");
        // The decision on file, the next return paid that much less and saying so: square, with nothing left to set off.
        let dec = st_to("d1", 34 * DAY, DECISION, "outside", &["clinic"], json!({ "claim": "c1", "taxpayer": "clinic", "use": "set_off", "granted": true, "amount": 1_000 }));
        let b = book_of(vec![ret("r1", 30 * DAY, 1_000, 1_000, 0), dec.clone()]);
        let pays = [paid(31 * DAY, 1_000), paid(32 * DAY, 1_000)];
        let before = ledger(&b, "outside", &pays, "clinic", &[]);
        assert_eq!((before.on_account, before.reserved, before.credit()), (1_000, 1_000, 0), "a credit to be set off is not claimed back as well");
        let b = book_of(vec![ret("r1", 30 * DAY, 1_000, 1_000, 0), dec, ret("r2", 60 * DAY, 1_000, 0, 1_000)]);
        let after = ledger(&b, "outside", &pays, "clinic", &[]);
        assert_eq!((after.owed, after.outstanding, after.on_account, after.reserved), (2_000, 0, 0, 0));
    }

    #[test]
    fn a_refusal_asked_about_inside_the_laws_days_is_decided_again_on_the_account_and_put_right() {
        let mut r = office();
        at(&mut r, 31 * DAY, vec![tax_law(), refunds(false), reviews(), ret("r1", 30 * DAY, 1_000, 1_000, 0)], vec![tx(30 * DAY + 60, "acc-clinic", 1_000, "tax")]);
        // A claim with nothing in credit: refused.
        let first = at(&mut r, 32 * DAY, vec![claim("c1", 31 * DAY, "refund", 1_000)], vec![]);
        assert_eq!(kinds(&first, DECISION)[0]["granted"], false);
        let refusal = st_to("d1", 32 * DAY, DECISION, "outside", &["clinic"], json!({ "claim": "c1", "taxpayer": "clinic", "use": "refund", "asked": 1_000, "granted": false, "amount": 0, "reason": "the account shows no credit" }));
        // The payment it was about comes in; asked to look again: the office finds the credit and repays it.
        at(&mut r, 33 * DAY, vec![refusal], vec![tx(32 * DAY + 60, "acc-clinic", 1_000, "tax")]);
        let ask = st_to("q1", 34 * DAY, "review_request", "clinic", &["outside"], json!({ "matter": "refund_refused", "about": "d1" }));
        let out = at(&mut r, 35 * DAY, vec![ask], vec![]);
        let review = kinds(&out, "decision_review");
        assert_eq!(review.len(), 1);
        assert_eq!(review[0]["outcome"], "changed");
        let d = kinds(&out, DECISION);
        assert_eq!((d[0]["granted"].as_bool(), d[0]["amount"].as_i64(), d[0]["replaces"].as_str()), (Some(true), Some(1_000), Some("d1")));
        assert_eq!(payments(&out).len(), 1);
        // Asked after the law's days: answered no.
        let late = st_to("q2", 70 * DAY, "review_request", "clinic", &["outside"], json!({ "matter": "refund_refused", "about": "d1" }));
        let out = at(&mut r, 70 * DAY, vec![late], vec![]);
        assert_eq!(kinds(&out, "decision_review")[0]["outcome"], "out_of_time");
    }

    #[test]
    fn the_decision_is_the_officers_desks_work_and_the_refund_the_case_systems() {
        let mut r = Rig::new(&TaxCollector, "outside", json!({ "casework": { "by": "outside-tax-casework", "kinds": [DECISION, "decision_review", "remedy_answer"] } }));
        at(&mut r, 31 * DAY, vec![tax_law(), refunds(false), ret("r1", 30 * DAY, 1_000, 1_000, 0)], vec![tx(30 * DAY + 60, "acc-clinic", 1_000, "tax"), tx(30 * DAY + 90, "acc-clinic", 1_000, "tax")]);
        let out = at(&mut r, 32 * DAY, vec![claim("c1", 31 * DAY, "refund", 0)], vec![]);
        let calls: Vec<(String, bool)> = out
            .iter()
            .filter_map(|a| match a {
                Action::Call { program: oikos_sight::calls::Program::Lines(lines), .. } => Some(lines),
                _ => None,
            })
            .map(|lines| (lines[0].call.fn_.clone(), lines[0].call.get("done_by").is_some()))
            .collect();
        assert_eq!(calls, [("statement".to_string(), true), ("money".to_string(), false)], "the decision by the desk, then the payment by the system");
        r.save_and_restore();
    }

    #[test]
    fn a_taxpayer_asking_is_sent_its_own_account() {
        let mut r = office();
        at(&mut r, 31 * DAY, vec![tax_law(), ret("r1", 30 * DAY, 1_000, 600, 0)], vec![tx(30 * DAY + 60, "acc-clinic", 600, "tax")]);
        let ask = st_to("a1", 40 * DAY, REQUEST, "clinic", &["outside"], json!({ "office": "outside" }));
        let out = at(&mut r, 41 * DAY, vec![ask], vec![]);
        let s = kinds(&out, STATEMENT);
        assert_eq!((s[0]["owed"].as_i64(), s[0]["paid"].as_i64(), s[0]["outstanding"].as_i64(), s[0]["credit"].as_i64()), (Some(1_000), Some(600), Some(400), Some(0)));
        assert!(statements(&out)[0].text.contains("owing"));
        assert!(at(&mut r, 42 * DAY, vec![], vec![]).iter().all(|a| !matches!(a, Action::Call { .. })), "answered once");
    }
}
