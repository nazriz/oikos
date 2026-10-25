//! The money that comes in from outside the town: world.funding (a wider market lending to the bank), world.grants
//! (a higher government's grant) and world.transfers (the support office). Ported from participants/src/behaviour/
//! world.ts (docs/behaviour/boundary.md and public-finance.md).

use super::shared::{answering, manifest, restore_answering};
use super::support_law::{
    decision_law, income_tax_law, support_law, withholding, AgeMost, Amount, Most, PaymentRule, Reconsiderations, Redone, Wait, Waits,
};
use crate::common::work::ReportOf;
use crate::common::{addressed_to, data, filed_before, made_at, money_words, truthy, when_words, Book, Fields, Occurrences, Part, StandingWork, MONTH};
use crate::offices::auditor::{Answerer, Audited, ClaimOn, DecisionFile, DecisionOn, Reported};
use crate::papers::{self, market as m};
use crate::steps::{because, pay, say, Pay, Plan, Say, Step, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture, WorldInfo, DAY};
use oikos_rules::slip::{slip, SlipOptions};
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

// ------------------------------------------------------------------ world.funding

pub struct Funding;

impl Kind for Funding {
    fn name(&self) -> &'static str {
        "world.funding"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/boundary.md"
    }
    fn manifest(&self) -> Value {
        manifest(include_str!("manifests/world.funding.json"), "the wholesale funding desk", "What it acts on: a bank's draw on its funding, and the bank's repayments.")
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        0
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let account: String = ctx.need("account", "world.funding")?;
        answering(&self.manifest(), Desk { me: ctx.entity.clone(), account, book: Book::new(), lent: BTreeSet::new() })
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore_answering::<Desk>(&self.manifest(), saved)
    }
}

/// The wholesale funding desk: lends what is asked for, at once (the market is large next to a town), paying it with
/// the draw settled. What the borrower pays in interest and repays is the borrower's to do; this does not chase it.
#[derive(Serialize, Deserialize)]
struct Desk {
    me: String,
    account: String,
    book: Book,
    lent: BTreeSet<String>,
}

impl Plan for Desk {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }
    fn plan(&mut self, _: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let mut draws: Vec<_> = self.book.open("funding_draw").filter(|r| addressed_to(r).contains(&self.me) && !self.lent.contains(&r.id)).collect();
        draws.sort_by(|a, b| filed_before(&a.id, &b.id));
        let mut steps = vec![];
        for d in draws {
            self.lent.insert(d.id.clone());
            let amount = data(d).i("amount").unwrap_or(0);
            let Some(account) = data(d).s("account") else { continue };
            if amount > 0 {
                let from = d.speaks_for.clone().unwrap_or_default();
                steps.push(because(
                    format!("A draw on funding from {from}: lending {}.", money_words(amount, &cx.ctx.world)),
                    vec![pay(account, amount, Pay { from: Some(self.account.clone()), for_: Some("Funding.".into()), settles: Some(d.id.clone()), ..Default::default() }, cx)],
                ));
            }
        }
        steps
    }
}

// ------------------------------------------------------------------ world.grants

pub struct Grants;

impl Kind for Grants {
    fn name(&self) -> &'static str {
        "world.grants"
    }
    fn version(&self) -> &'static str {
        "0.3.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/public-finance.md"
    }
    fn manifest(&self) -> Value {
        manifest(include_str!("manifests/world.grants.json"), "the grants office", "It pays by its determination, which is on file with whoever it pays: so much a year for each resident, by the published estimate of the population. A letter changes nothing in a determination.")
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        3 * 3600
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let account: String = ctx.need("account", "world.grants")?;
        let to: String = ctx.need("to", "world.grants")?;
        let to_account: String = ctx.need("to_account", "world.grants")?;
        let first_day: i64 = ctx.param("first_day", 30)?;
        answering(&self.manifest(), Office {
            me: ctx.entity.clone(),
            account,
            to,
            to_account,
            per_resident_per_year: ctx.param("per_resident_per_year", 0)?,
            every_days: ctx.param("every_days", 91)?,
            book: Book::new(),
            next: first_day * DAY,
        })
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore_answering::<Office>(&self.manifest(), saved)
    }
}

/// The grants office: a grant every quarter at an amount a year per resident, residents being the statistician's latest
/// published estimate of the town's population (a funder pays by the published count, and counts nobody itself).
#[derive(Serialize, Deserialize)]
struct Office {
    me: String,
    account: String,
    to: String,
    to_account: String,
    per_resident_per_year: i64,
    every_days: i64,
    book: Book,
    next: i64,
}

impl Plan for Office {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let t = pic.t;
        if t < self.next || self.to_account.is_empty() || self.per_resident_per_year <= 0 {
            return vec![];
        }
        // (No estimate published yet: nothing to pay by; we look again tomorrow.)
        // (The newest; of two made together, the first seen.)
        let newest = self.book.open("population_estimate").fold(None, |a: Option<&std::sync::Arc<oikos_sight::Record>>, b| match a {
            Some(a) if b.at <= a.at => Some(a),
            _ => Some(b),
        });
        let Some(estimate) = newest else { return vec![] };
        let residents = data(estimate).i("residents").unwrap_or(0).max(0);
        self.next = t + self.every_days * DAY;
        let amount = self.per_resident_per_year * residents * self.every_days / 365;
        if amount <= 0 {
            return vec![];
        }
        let world = cx.ctx.world.clone();
        let paper = m::GrantPayment { amount, residents, per_resident_per_year: self.per_resident_per_year };
        vec![because(
            format!(
                "The quarter's grant: {} a resident a year, for the {residents} the statistician estimates live in the town.",
                money_words(self.per_resident_per_year, &world)
            ),
            vec![
                say(
                    "grant_payment",
                    &format!("A grant of {} for the quarter ({residents} residents).", money_words(amount, &world)),
                    Say {
                        to: Some(vec![self.to.clone()]),
                        visible: Some(Visible::Only(vec![self.me.clone(), self.to.clone()])),
                        basis: Some(estimate.id.clone()),
                        data: Some(papers::data(&paper)),
                        ..Default::default()
                    },
                ),
                pay(&self.to_account, amount, Pay { from: Some(self.account.clone()), for_: Some("Grant.".into()), ..Default::default() }, cx),
            ],
        )]
    }
}

// ------------------------------------------------------------------ world.transfers

pub struct Transfers;

const TASK: &str = "pay_claims";
const NOT_MET: &str = "it does not meet the conditions the support law states for the payment";

impl Kind for Transfers {
    fn name(&self) -> &'static str {
        "world.transfers"
    }
    fn version(&self) -> &'static str {
        "0.11.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/boundary.md"
    }
    fn manifest(&self) -> Value {
        manifest(
            include_str!("manifests/world.transfers.json"),
            "the support office",
            "What it acts on: a claim for a payment under the support law, made by the person it is for.",
        )
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        0
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let account: String = ctx.need("account", "world.transfers")?;
        let part = Part::from_param(&ctx.param("part", String::new())?);
        let publish_every_days: i64 = ctx.param("publish_every_days", 0)?;
        let me = ctx.entity.clone();
        let office = ctx.position.as_deref().map(|p| p.strip_suffix("-staff").unwrap_or(p).to_string());
        answering(
            &self.manifest(),
            Support {
                account,
                year: ctx.param("year", 365 * DAY)?,
                publish_every_days,
                part,
                office: office.clone().unwrap_or_default(),
                next_publish: if publish_every_days > 0 { publish_every_days * DAY } else { i64::MAX },
                book: Book::new(),
                decided: BTreeSet::new(),
                routines: StandingWork::new(&me, part, office),
                taken: BTreeSet::new(),
                seen: BTreeSet::new(),
                granted: 0,
                put_before: 0,
                lately: vec![],
                claim_nth: Occurrences::default(),
                waits: Waits::new(&me),
                recon: Reconsiderations::new(&me, &["benefit_decision"]),
                paying: BTreeMap::new(),
                opened: false,
                decided_on: BTreeMap::new(),
                lapsed_claims: BTreeSet::new(),
                audited: Audited::new(&me),
                casework: ctx.param("casework", None)?,
                me,
            },
        )
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore_answering::<Support>(&self.manifest(), saved)
    }
}

/// What the office pays under a claim.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Paying {
    person: String,
    account: String,
    payment: String,
    from: String,
    amount: i64,
    every: i64,
    next: i64,
    until: Option<i64>,
    then: Option<String>,
}

/// A claim, decided on the rule: granted (with the sum and how long), or why not.
enum Decided {
    Granted { amount: i64, until: Option<i64> },
    Refused(Option<String>),
}

/// The support office (for a town, a higher government's payments office, outside the world: a boundary condition,
/// D31). It reads the published support law and applies the payments it is the payer of: who qualifies, how much, for
/// how long. It decides each claim on what the claim states (a date of birth, and whatever the payment's rule has the
/// claimant declare), taken as stated, and on its own book: the employers' reports of contributions addressed to it,
/// which name each worker and their pay. It pays those it grants on the payment's schedule until the claimant says to
/// stop, dies (a death registration), leaves (a departure), or the payment's time runs out, which it tells them. Every
/// `publish_every_days` (0: never) it publishes how many it pays of each kind. Where a model holds the office (`part`),
/// the staff do the routine under a standing order and put a refusal or a doubt before the office-holder.
///
/// Left out for now, with its lane: the answers to a venue's notice of an application against a refusal and a venue's
/// setting a refusal aside (`Respondent`, frictions.ts, lane D). TS's `put` (claims put before the office-holder) was
/// written and never read, so it is not kept.
#[derive(Serialize, Deserialize)]
struct Support {
    me: String,
    /// The account it pays from where a payment names none (the world must say).
    account: String,
    year: i64,
    publish_every_days: i64,
    part: Part,
    /// Its office (its position without "-staff"), as the staff's report names it.
    office: String,
    next_publish: i64,
    book: Book,
    decided: BTreeSet<String>,
    routines: StandingWork,
    /// Decisions of the office-holder's the staff have taken up.
    taken: BTreeSet<String>,
    /// Cases the office-holder has decided.
    seen: BTreeSet<String>,
    /// Since the staff last reported.
    granted: i64,
    put_before: i64,
    lately: Vec<String>,
    /// Which claim each is: this person's nth for this payment, not its number on file.
    claim_nth: Occurrences,
    /// What a claim waits for before it is decided (the law's `needs`).
    waits: Waits,
    /// A decision of ours looked at again when asked (the law's `review`).
    recon: Reconsiderations,
    /// Claim -> what we pay under it.
    paying: BTreeMap<String, Paying>,
    /// Our file has been opened once (payments in force before the year are taken up then).
    opened: bool,
    /// When we decided each claim (each round), and which we refused for papers that did not come: our own record of the round a
    /// decision was made at, which the audit office's question "decided again as it was" needs (a decision's paper is stamped when
    /// it is done, which may be later than the round that made it). Not in the papers.
    decided_on: BTreeMap<String, Vec<i64>>,
    lapsed_claims: BTreeSet<String>,
    /// The audit office's questions to us (docs/behaviour/auditor.md).
    audited: Audited,
    /// Who does the office's casework, where the world says (law 10, foundations-2 P3): a system of the office's own
    /// organisation (its officers' desk) named in `by` on every act that is only papers of these kinds, so that the
    /// decision takes an officer's minutes in the officers' hours. Absent: whoever acts does it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    casework: Option<Casework>,
}

/// The office's casework, and who does it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct Casework {
    by: String,
    kinds: Vec<String>,
}

impl Casework {
    /// A step that is only casework papers goes to the desk: `done_by` on its first call (the platform gives it to the act
    /// as `by`). A step with anything else in it (a payment) stays the actor's own, whole.
    pub(crate) fn assign<T>(&self, step: &mut Step<T>) {
        let casework = |l: &oikos_sight::calls::Line| {
            l.call.fn_ == "statement" && matches!(l.call.get("kind"), Some(oikos_sight::calls::Value::Id(k) | oikos_sight::calls::Value::Text(k)) if self.kinds.iter().any(|x| x == k))
        };
        if step.lines.is_empty() || !step.lines.iter().all(casework) || step.lines[0].call.get("done_by").is_some() {
            return;
        }
        step.lines[0].call.args.push(("done_by".to_string(), crate::steps::arg(&self.by)));
    }
}

/// A figure written in a decision's data as `Number(x)` would take it, if it is one (a number, or a number in a string): whole
/// numbers, read by their digits.
fn finite(v: Option<&Value>) -> Option<i64> {
    crate::finance::floor_of(v?)
}

/// Our book of contributions for one person: the monthly pay employers reported for them, newest first.
fn reported_of(me: &str, book: &Book, who: &str, since: i64) -> Vec<(i64, i64)> {
    let mut reports: Vec<&Arc<Record>> =
        book.all("withholding_report").filter(|r| addressed_to(r).iter().any(|a| a == me) && r.at >= since && data(r).get("staff").is_some_and(Value::is_array)).collect();
    reports.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| filed_before(&b.id, &a.id)));
    reports
        .iter()
        .flat_map(|r| {
            data(r)
                .get("staff")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|l| l.s("worker") == Some(who))
                .map(|l| (r.at, l.get("gross").and_then(Value::as_f64).map_or(0, |g| g.floor() as i64)))
        })
        .collect()
}

/// What the audit office may ask of us, answered from our books (docs/behaviour/auditor.md): the decisions we made in a period,
/// in the order they are numbered (by when, then by filing), and one of them with the claim and the record it rests on.
/// Decisions brought forward from before the year are not ours to make again.
struct OurDecisions<'a> {
    me: &'a str,
    book: &'a Book,
    rules: &'a [PaymentRule],
    decided_on: &'a BTreeMap<String, Vec<i64>>,
    lapsed: &'a BTreeSet<String>,
    paying: &'a BTreeMap<String, Paying>,
}

impl OurDecisions<'_> {
    fn decisions_in(&self, kind: &str, from: i64, to: i64) -> Vec<&Arc<Record>> {
        let mut v: Vec<&Arc<Record>> = self
            .book
            .all(kind)
            .filter(|d| d.speaks_for.as_deref() == Some(self.me) && !data(d).get("brought_forward").is_some_and(truthy) && data(d).s("claim").is_some() && d.at >= from && d.at < to)
            .collect();
        v.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
        v
    }
}

impl Answerer for OurDecisions<'_> {
    fn count(&self, kind: &str, from: i64, to: i64) -> Option<i64> {
        Some(self.decisions_in(kind, from, to).len() as i64)
    }

    fn nth(&self, kind: &str, from: i64, to: i64, nth: i64) -> Option<Option<DecisionFile>> {
        let Some(d) = usize::try_from(nth - 1).ok().and_then(|i| self.decisions_in(kind, from, to).get(i).copied()) else { return Some(None) };
        let dd = data(d);
        let claim_id = dd.s("claim").unwrap_or("");
        let c = self.book.get(claim_id).filter(|c| matches!(c.body, oikos_sight::RecordBody::Statement { .. }));
        let on = self.decided_on.get(claim_id).into_iter().flatten().copied().filter(|x| *x <= d.at).max().unwrap_or(d.at);
        let decision = DecisionOn {
            id: d.id.clone(),
            at: d.at,
            on,
            granted: dd.get("granted") == Some(&Value::Bool(true)),
            amount: finite(dd.get("amount")),
            every: finite(dd.get("every")),
            until: finite(dd.get("until")),
            reason: dd.s("reason").map(String::from),
            lapsed: (dd.get("granted") != Some(&Value::Bool(true)) && !dd.get("replaces").is_some_and(truthy) && self.lapsed.contains(claim_id)).then_some(true),
        };
        let Some(c) = c.filter(|c| c.speaks_for.is_some()) else { return Some(Some(DecisionFile { decision, claim: None, reported: vec![], pays_other: false })) };
        let who = c.speaks_for.clone().unwrap_or_default();
        let payment = dd.s("payment").or_else(|| data(c).s("payment")).unwrap_or("").to_string();
        let rule = self.rules.iter().find(|r| r.id == payment);
        let reported = reported_of(self.me, self.book, &who, i64::MIN).into_iter().filter(|r| r.0 <= on).take(36).map(|(at, gross)| Reported { at, gross }).collect();
        let pays_other = rule.is_some_and(|rule| self.paying.values().any(|x| x.person == who && x.payment != rule.id && self.rules.iter().any(|r| r.id == x.payment && r.for_age())));
        Some(Some(DecisionFile {
            decision,
            claim: Some(ClaimOn {
                id: c.id.clone(),
                by: who,
                payment,
                born_at: data(c).get("born_at").and_then(Value::as_i64).unwrap_or(0),
                account: data(c).s("account").unwrap_or("").to_string(),
                declares: serde_json::from_value(data(c).get("declares").cloned().unwrap_or(Value::Null)).unwrap_or_default(),
            }),
            reported,
            pays_other,
        }))
    }
}

type Steps = Vec<Step<()>>;

impl Support {
    /// The payments we pay: the published law's, where we are the payer (no law: none).
    fn rules(&self, book: &Book) -> Vec<PaymentRule> {
        support_law(book).map(|(_, ps)| ps.into_iter().filter(|r| r.payer.as_deref() == Some(self.me.as_str())).collect()).unwrap_or_default()
    }

    fn from_account(&self, rule: Option<&PaymentRule>) -> String {
        rule.map(|r| r.account.clone()).filter(|a| !a.is_empty()).unwrap_or_else(|| self.account.clone())
    }

    /// Our book of contributions for one person: the monthly pay employers reported for them, newest first.
    fn reported(&self, book: &Book, who: &str, since: i64) -> Vec<(i64, i64)> {
        reported_of(&self.me, book, who, since)
    }

    /// A claim under a rule: granted (with the sum and how long), or why not.
    fn decide(&self, book: &Book, rule: Option<&PaymentRule>, ours: &[PaymentRule], c: &Record, t: i64, world: &WorldInfo) -> Decided {
        let d = data(c);
        let (Some(rule), Some(_), Some(born), Some(who)) = (rule, d.s("account"), d.get("born_at").and_then(Value::as_i64), c.speaks_for.as_deref()) else {
            return Decided::Refused(None);
        };
        let age = (t - born).div_euclid(self.year);
        let w = rule.who.clone().unwrap_or_default();
        let said = d.get("declares").cloned().unwrap_or(Value::Null);
        if w.from_age.is_some_and(|f| age < f) || w.to_age.is_some_and(|to| age > to) {
            return Decided::Refused(None);
        }
        let members = said.get("household_members").and_then(Value::as_f64).map_or(1, |x| (x.floor() as i64).max(1));
        let children = |under: i64| {
            said.get("children_born_at")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_i64)
                .filter(|b| (t - b).div_euclid(self.year) < under)
                .count() as i64
        };
        let record = if w.record.is_some() || matches!(rule.amount, Amount::Share { .. }) {
            // (Contributions within so many months of now: calendar months where the world has a calendar.)
            let since = match w.record.as_ref().and_then(|r| r.within_months) {
                Some(n) if n > 0 => match &world.calendar {
                    Some(cal) => cal.months_after(t, -n),
                    None => t - n * MONTH,
                },
                _ => i64::MIN,
            };
            self.reported(book, who, since)
        } else {
            vec![]
        };
        if let Some(rec) = &w.record {
            let months = rec.months.unwrap_or(1);
            if (record.len() as i64) < months {
                return Decided::Refused(Some(format!(
                    "contributions are on our record for {} month{}, and the payment asks for {months}",
                    record.len(),
                    if record.len() == 1 { "" } else { "s" }
                )));
            }
        }
        if let Some(iu) = &w.income_under {
            let Some(household_income) = said.get("household_income").and_then(Value::as_i64) else {
                return Decided::Refused(Some("the claim doesn't state the household's income".into()));
            };
            let income = if iu.per == "head" { household_income.div_euclid(members) } else { household_income };
            if income >= iu.amount {
                return Decided::Refused(Some(format!(
                    "the household's income as stated is not under {}{}",
                    money_words(iu.amount, world),
                    if iu.per == "head" { " a head" } else { "" }
                )));
            }
        }
        if w.no_other_pension == Some(true) {
            if said.get("other_pension") != Some(&Value::Bool(false)) {
                return Decided::Refused(Some("the claim doesn't state that no other pension is paid".into()));
            }
            if self.paying.values().any(|x| x.person == who && x.payment != rule.id && ours.iter().any(|r| r.id == x.payment && r.for_age())) {
                return Decided::Refused(Some("we pay the claimant another pension".into()));
            }
        }
        if let Some(ch) = &w.children {
            if children(ch.under_age) < ch.least {
                return Decided::Refused(Some(format!(
                    "the household as stated has fewer than {} child{} under {}",
                    ch.least,
                    if ch.least == 1 { "" } else { "ren" },
                    ch.under_age
                )));
            }
        }
        let amount = match &rule.amount {
            Amount::Flat { flat } => *flat,
            Amount::Share { share_bps, with_child_bps, of, least, most } => {
                // Their previous pay for as long as one payment covers: the mean of the monthly pay reported for them (the last
                // twelve reports at most), before or after what the tax law withholds from such a pay. (Whole-number arithmetic:
                // the mean times the days over thirty, rounded down once.)
                let last: Vec<i64> = record.iter().take(12).map(|l| l.1).collect();
                if last.is_empty() {
                    return Decided::Refused(Some("no pay is on our record for the claimant".into()));
                }
                let gross = (i128::from(last.iter().sum::<i64>()) * i128::from(rule.every_days) / (30 * last.len() as i128)) as i64;
                let pay = if of.as_deref() == Some("net") { gross - withholding(income_tax_law(book).as_ref(), gross, rule.every_days * DAY) } else { gross };
                let most = match most {
                    None => i64::MAX,
                    Some(Most::One(n)) => *n,
                    Some(Most::ByAge(bands)) => {
                        let mut b: Vec<&AgeMost> = bands.iter().collect();
                        b.sort_by(|x, y| y.from_age.cmp(&x.from_age));
                        b.iter().find(|x| x.from_age <= age).map_or(i64::MAX, |x| x.amount)
                    }
                };
                let bps = match with_child_bps {
                    Some(wc) if children(18) > 0 => *wc,
                    _ => *share_bps,
                };
                most.min(least.unwrap_or(0).max((i128::from(pay) * i128::from(bps) / 10_000) as i64))
            }
            Amount::Household { household, per_member, per_child } => {
                household + per_member.unwrap_or(0) * members + per_child.as_ref().map_or(0, |p| p.amount * children(p.under_age))
            }
        };
        if amount <= 0 {
            return Decided::Refused(Some("the payment comes to nothing".into()));
        }
        let ends = [
            rule.lasts.as_ref().and_then(|l| l.days).map(|d| t + d * DAY),
            rule.lasts.as_ref().and_then(|l| l.until_age).map(|a| born + a * self.year),
        ];
        Decided::Granted { amount, until: ends.into_iter().flatten().min() }
    }

    fn start_paying(&mut self, claim: &Record, rule: Option<&PaymentRule>, payment: String, amount: i64, every: i64, next: i64, until: Option<i64>) {
        let Some(person) = claim.speaks_for.clone() else { return };
        let account = data(claim).s("account").unwrap_or("").to_string();
        let from = self.from_account(rule);
        let then = rule.and_then(|r| r.lasts.as_ref()).and_then(|l| l.then.clone());
        self.paying.insert(claim.id.clone(), Paying { person, account, payment, from, amount, every, next, until, then });
    }

    /// A claim granted on the office's second look (a review, or a venue setting its refusal aside): the office decides
    /// again on the facts it has now, as it decides any claim, without a slip, and puts right what it finds wrong itself.
    fn decide_again(&mut self, book: &Book, refusal: &Record, t: i64, why: &str, basis: &str, world: &WorldInfo) -> Redone<()> {
        let claim = data(refusal).s("claim").and_then(|c| book.get(c)).filter(|c| matches!(c.body, oikos_sight::RecordBody::Statement { .. })).cloned();
        let ours = self.rules(book);
        let rule = ours.iter().find(|r| Some(r.id.as_str()) == data(refusal).s("payment"));
        let (Some(claim), Some(rule)) = (claim, rule) else {
            return Redone { changed: false, found: "the claim is not on our file".into(), steps: vec![] };
        };
        let (amount, until) = match self.decide(book, Some(rule), &ours, &claim, t, world) {
            Decided::Granted { amount, until } => (amount, until),
            Decided::Refused(w) => return Redone { changed: false, found: w.unwrap_or_else(|| NOT_MET.into()), steps: vec![] },
        };
        let who = claim.speaks_for.clone().unwrap_or_default();
        self.decided_on.entry(claim.id.clone()).or_default().push(t);
        self.lapsed_claims.remove(&claim.id);
        self.paying.retain(|_, x| !(x.person == who && x.payment == rule.id));
        let every = rule.every_days * DAY;
        self.start_paying(&claim, Some(rule), rule.id.clone(), amount, every, t + every, until);
        let lasting = until.map_or(String::new(), |u| format!(" until {}", when_words(u, world)));
        let paper = m::BenefitDecision {
            claim: claim.id.clone(),
            claimant: None,
            payment: Some(rule.id.clone()),
            granted: true,
            brought_forward: false,
            could_not_verify: false,
            amount: Some(amount),
            every: Some(every),
            until,
            reason: None,
            on_review: Some(basis.to_string()),
            replaces: Some(refusal.id.clone()),
        };
        Redone {
            changed: true,
            found: "the claim met the conditions the support law states for the payment when it was decided".into(),
            steps: vec![because(
                format!("{why}: the claim {} qualifies; granting it.", claim.id),
                vec![say(
                    "benefit_decision",
                    &format!("Claim {} granted on a second look: {} every {} days{lasting}.", claim.id, money_words(amount, world), rule.every_days),
                    Say {
                        to: Some(vec![who.clone()]),
                        visible: Some(Visible::Only(vec![who, self.me.clone()])),
                        basis: Some(claim.id.clone()),
                        data: Some(papers::data(&paper)),
                        ..Default::default()
                    },
                )],
            )],
        }
    }

    /// Payments already in force when the file is first opened (grants made before the year, brought forward on paper):
    /// taken up from the grant's own figures, the next payment on the day it names. Their claims are decided.
    fn open_file(&mut self, ours: &[PaymentRule]) {
        let decisions: Vec<Arc<Record>> = self.book.all("benefit_decision").cloned().collect();
        for d in decisions {
            let dd = data(&d);
            let mine = d.speaks_for.as_deref() == Some(self.me.as_str());
            let Some(claim_id) = dd.s("claim") else { continue };
            let brought = dd.get("brought_forward").is_some_and(truthy);
            let granted = dd.get("granted") == Some(&Value::Bool(true));
            // (A claim refused before the year began is decided; one in hand, still waiting its time, is not.)
            if mine && brought && !granted {
                self.decided.insert(claim_id.to_string());
            }
            if !mine || !brought || !granted {
                continue;
            }
            let Some(claim) = self.book.get(claim_id).filter(|c| matches!(c.body, oikos_sight::RecordBody::Statement { .. })).cloned() else { continue };
            self.decided.insert(claim_id.to_string());
            let (amount, every, next) = (dd.i("amount").unwrap_or(0), dd.i("every").unwrap_or(0), dd.i("next"));
            if amount <= 0 || every <= 0 || next.is_none_or(|n| n < 0) || data(&claim).s("account").is_none() {
                continue;
            }
            let payment = dd.s("payment").unwrap_or("").to_string();
            let rule = ours.iter().find(|r| r.id == payment);
            self.start_paying(&claim, rule, payment, amount, every, next.unwrap_or(0), dd.get("until").and_then(Value::as_i64));
        }
    }
}

impl Plan for Support {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Steps {
        let mut steps = self.plan_office(pic, cx);
        // (The casework goes to the officers' desk, where the world has one; never the office-holder's own decisions, which are
        // theirs: a seat decides what the staff put before it.)
        if let (Some(c), false) = (&self.casework, self.part == Part::Seat) {
            for s in &mut steps {
                c.assign(s);
            }
        }
        steps
    }
}

impl Support {
    fn plan_office(&mut self, pic: &Picture, cx: &mut Cx) -> Steps {
        let t = pic.t;
        let world = cx.ctx.world.clone();
        let mut steps: Steps = vec![];
        let ours = self.rules(&self.book);
        if !self.opened {
            self.opened = true;
            self.open_file(&ours);
        }
        // Claims: granted if the claimant fits the payment's rule; the first payment one period on. The office decides the
        // oldest first, every one it has; how many it gets through is the hours of whoever decides, which the kernel keeps:
        // each decision is an act that takes its maker's time. (Who does the routine now: the whole office; its staff while
        // their standing order is in force; the office-holder never.)
        let working = self.routines.does(&self.book, TASK, t, DAY).is_some();
        let staff = self.part == Part::Staff;
        if self.part == Part::Seat {
            // Whoever holds the office: what the staff have put before them is decided (a claim that fails the law's conditions
            // is refused, with the reason; so is one that could not be verified, which is the wrong refusal a review may find).
            let mut cases: Vec<Arc<Record>> =
                self.book.open("case_for_decision").filter(|x| x.speaks_for.as_deref() == Some(self.me.as_str()) && !self.seen.contains(&x.id)).cloned().collect();
            cases.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
            for n in cases {
                self.seen.insert(n.id.clone());
                let d = data(&n);
                let (Some(claim), Some(claimant)) = (d.s("claim"), d.s("claimant")) else { continue };
                self.decided_on.entry(claim.to_string()).or_default().push(t);
                let why = d.s("fails").unwrap_or("");
                let tail = if why.is_empty() { String::new() } else { format!(": {why}") };
                let paper = m::BenefitDecision {
                    claim: claim.into(),
                    claimant: None,
                    payment: d.s("payment").map(String::from),
                    granted: false,
                    brought_forward: false,
                    could_not_verify: false,
                    amount: None,
                    every: None,
                    until: None,
                    reason: (!why.is_empty()).then(|| why.to_string()),
                    on_review: None,
                    replaces: None,
                };
                steps.push(because(
                    format!("A claim the staff put before us ({claim}): refused{tail}."),
                    vec![say(
                        "benefit_decision",
                        &format!("Claim {claim} refused{tail}."),
                        Say {
                            to: Some(vec![claimant.into()]),
                            visible: Some(Visible::Only(vec![claimant.into(), self.me.clone()])),
                            basis: Some(claim.into()),
                            data: Some(papers::data(&paper)),
                            ..Default::default()
                        },
                    )],
                ));
            }
        }
        let mut waiting: Vec<Arc<Record>> = if working {
            self.book.open("benefit_claim").filter(|r| addressed_to(r).iter().any(|a| a == &self.me) && !self.decided.contains(&r.id)).cloned().collect()
        } else {
            vec![]
        };
        waiting.sort_by(|a, b| made_at(a).cmp(&made_at(b)).then_with(|| filed_before(&a.id, &b.id)));
        for c in waiting {
            let Some(who) = c.speaks_for.clone() else { continue };
            let payment = data(&c).s("payment").unwrap_or("").to_string();
            let rule = ours.iter().find(|r| r.id == payment);
            let age = data(&c).get("born_at").and_then(Value::as_i64).map_or(-1, |b| (t - b).div_euclid(self.year));
            // What the claim waits for before it is decided is the law's: papers from the claimant, a confirmation from their last
            // employer, within so many days, and what comes of it when they do not come. We ask once, for each; the claim stays on
            // our file until it has come, or its time has run. (A claim made before the year opened, brought forward, is decided.)
            let law = decision_law(&self.book, "benefit_decision", Some(&payment));
            let wait = if data(&c).get("brought_forward").is_some_and(truthy) {
                None
            } else {
                let w2 = world.clone();
                Some(self.waits.state::<()>(&self.book, law.as_ref(), &c, t, &move |x| when_words(x, &w2)))
            };
            if let Some((state, ws)) = &wait {
                steps.extend(ws.iter().cloned());
                if *state == Wait::Waiting {
                    continue;
                }
            }
            self.decided.insert(c.id.clone());
            self.decided_on.entry(c.id.clone()).or_default().push(t);
            if matches!(&wait, Some((Wait::Lapsed(_), _))) {
                self.lapsed_claims.insert(c.id.clone());
            }
            let mut d = match &wait {
                Some((Wait::Lapsed(why), _)) => Decided::Refused(Some(why.clone())),
                _ => self.decide(&self.book, rule, &ours, &c, t, &world),
            };
            // A claim that qualifies may be wrongly refused (a record not matched, a form read wrongly): a slip of whoever decides, at
            // the rate of the world's table of slips for a decision on a claim. It is put right when the decision is looked at again
            // (a review, or a venue): the office decides it again on the facts, without a slip, as `decide_again` has it.
            let mut slipped = false;
            if matches!(d, Decided::Granted { .. }) {
                let case = self.claim_nth.key(&c.id, &[Some(who.as_str()), Some(payment.as_str())]);
                if slip(cx, "publish/benefit_decision", &case, &SlipOptions::default()) {
                    d = Decided::Refused(Some("the claim could not be verified".into()));
                    slipped = true;
                }
            }
            // Who may refuse is the office's procedure's (the law's `refused_by`): where the head alone does, the staff put a claim that
            // does not meet the conditions, or that they could not verify, before whoever holds the office, with what it fails on (and,
            // for a doubt, what it would be paid). Where the staff may refuse, they decide it as the whole office does.
            if let (true, Decided::Refused(why)) = (staff, &d) {
                if law.as_ref().and_then(|l| l.refused_by.as_deref()) != Some("staff") {
                    let doubt = slipped;
                    let would = if doubt { Some(self.decide(&self.book, rule, &ours, &c, t, &world)) } else { None };
                    let why = why.clone().unwrap_or_else(|| NOT_MET.into());
                    self.put_before += 1;
                    let mut paper = m::CaseForDecision {
                        application: None,
                        matter: None,
                        applicant: None,
                        against: None,
                        case: None,
                        claim: Some(c.id.clone()),
                        claimant: Some(who.clone()),
                        payment: Some(payment.clone()),
                        fails: Some(why.clone()),
                        doubt: Some(Value::Bool(doubt)),
                        amount: None,
                        every: None,
                        until: None,
                    };
                    let mut if_granted = String::new();
                    if let (Some(Decided::Granted { amount, until }), Some(rule)) = (&would, rule) {
                        paper.amount = Some(*amount);
                        paper.every = Some(rule.every_days * DAY);
                        paper.until = *until;
                        if_granted = format!(" If it is granted, the payment by the law's rule is {} every {} days.", money_words(*amount, &world), rule.every_days);
                    }
                    steps.push(because(
                        format!("A claim for {payment} support that {}: putting it before the office-holder.", if doubt { "we could not verify" } else { "does not meet the law's conditions" }),
                        vec![say(
                            "case_for_decision",
                            &format!("For decision: claim {} by {who} for {payment} support (aged {age}): {why}.{if_granted}", c.id),
                            Say {
                                to: Some(vec![self.me.clone()]),
                                visible: Some(Visible::Only(vec![self.me.clone()])),
                                basis: Some(c.id.clone()),
                                data: Some(papers::data(&paper)),
                                ..Default::default()
                            },
                        )],
                    ));
                    continue;
                }
            }
            if staff && matches!(d, Decided::Granted { .. }) {
                self.granted += 1;
                self.lately.push(format!("{} ({who}, {payment})", c.id));
                if self.lately.len() > 3 {
                    self.lately.remove(0);
                }
            }
            // One payment of a kind a person: a new claim replaces the old.
            self.paying.retain(|_, x| !(x.person == who && x.payment == payment));
            let mut paper = m::BenefitDecision {
                claim: c.id.clone(),
                claimant: None,
                payment: Some(payment.clone()),
                granted: false,
                brought_forward: false,
                could_not_verify: false,
                amount: None,
                every: None,
                until: None,
                reason: None,
                on_review: None,
                replaces: None,
            };
            let (why_this, text) = match &d {
                Decided::Granted { amount, until } => {
                    let rule = rule.expect("a claim is granted only under a rule");
                    let every = rule.every_days * DAY;
                    self.start_paying(&c, Some(rule), payment.clone(), *amount, every, t + every, *until);
                    paper.granted = true;
                    paper.amount = Some(*amount);
                    paper.every = Some(every);
                    paper.until = *until;
                    let lasting = until.map_or(String::new(), |u| format!(" until {}", when_words(u, &world)));
                    let money = money_words(*amount, &world);
                    (
                        format!("A claim for {payment} support from someone it's for (aged {age}): granted, at {money} every {} days{lasting}.", rule.every_days),
                        format!("Claim {} granted: {money} every {} days{lasting}.", c.id, rule.every_days),
                    )
                }
                Decided::Refused(why) => {
                    let tail = why.as_ref().map_or(String::new(), |w| format!(": {w}"));
                    paper.reason.clone_from(why);
                    (format!("A claim for {payment} support that doesn't qualify{tail}: refused."), format!("Claim {} refused{tail}.", c.id))
                }
            };
            steps.push(because(
                why_this,
                vec![say(
                    "benefit_decision",
                    &text,
                    Say {
                        to: Some(vec![who.clone()]),
                        visible: Some(Visible::Only(vec![who.clone(), self.me.clone()])),
                        basis: Some(c.id.clone()),
                        data: Some(papers::data(&paper)),
                        ..Default::default()
                    },
                )],
            ));
        }
        // Asked by the audit office for a named item, under the audit law (docs/behaviour/auditor.md): answered from our books, by whoever
        // does our paperwork (never the office-holder alone, whose part is the decisions the staff put before them).
        if self.part != Part::Seat {
            let answerer = OurDecisions { me: &self.me, book: &self.book, rules: &ours, decided_on: &self.decided_on, lapsed: &self.lapsed_claims, paying: &self.paying };
            steps.extend(self.audited.steps::<()>(&self.book, &answerer));
        }
        // Asked to look at a decision again (the claimant's request, inside the days the law gives): the office decides it again
        // on the facts, and records that it did. Never the staff's where there is a head to do it.
        if !staff {
            let mut recon = std::mem::take(&mut self.recon);
            let book = std::mem::take(&mut self.book);
            let b = &book;
            let mut redo = |dec: &Record, req: &Record| -> Option<Redone<()>> {
                if data(dec).get("granted") != Some(&Value::Bool(false)) {
                    return Some(Redone { changed: false, found: "the claim was granted".into(), steps: vec![] });
                }
                let asked = format!("Asked by {} to look at our refusal {} again", req.speaks_for.as_deref().unwrap_or(""), dec.id);
                Some(self.decide_again(b, dec, t, &asked, &req.id, &world))
            };
            let more = recon.steps(b, t, &mut redo);
            self.book = book;
            self.recon = recon;
            steps.extend(more);
        }
        // A claim the office-holder granted on the office's decision form is paid by the staff like any other: from the
        // decision's own figures, the first payment one period on.
        if staff && working {
            let decisions: Vec<Arc<Record>> = self.book.all("benefit_decision").cloned().collect();
            for d in decisions {
                if self.taken.contains(&d.id) || d.speaks_for.as_deref() != Some(self.me.as_str()) {
                    continue;
                }
                self.taken.insert(d.id.clone());
                let dd = data(&d);
                let Some(claim) = dd.s("claim").and_then(|c| self.book.get(c)).filter(|c| matches!(c.body, oikos_sight::RecordBody::Statement { .. })).cloned() else { continue };
                if dd.get("granted") != Some(&Value::Bool(true)) || self.paying.contains_key(&claim.id) {
                    continue;
                }
                let (amount, every) = (dd.i("amount").unwrap_or(0), dd.i("every").unwrap_or(0));
                if amount <= 0 || every <= 0 || data(&claim).s("account").is_none() {
                    continue;
                }
                let payment = data(&claim).s("payment").unwrap_or("").to_string();
                let rule = ours.iter().find(|r| r.id == payment);
                self.start_paying(&claim, rule, payment, amount, every, d.at + every, dd.get("until").and_then(Value::as_i64));
            }
        }
        if !working {
            // (The routine is not ours now: the office-holder's part, or staff with no standing order in force. The staff say so
            // in their report; nothing is paid, stopped or published.)
            if staff {
                let office = self.office.clone();
                let r = ReportOf { office: &office, from: "the support office's staff", tasks: vec![(TASK, "days' work", Some("payments"))], ..Default::default() };
                steps.extend(self.routines.report(&self.book, cx, &r));
            }
            return steps;
        }
        // Stopping: the claimant asked, died or left.
        let mut gone: BTreeSet<String> = self.book.all("death_registration").filter_map(|r| data(r).s("deceased").map(String::from)).collect();
        gone.extend(self.book.all("departure").filter_map(|r| r.speaks_for.clone()));
        let stops: Vec<String> = self.book.all("benefit_change").filter(|r| data(r).get("stop").is_some_and(truthy)).filter_map(|r| data(r).s("claim").map(String::from)).collect();
        for claim in stops {
            self.paying.remove(&claim);
        }
        self.paying.retain(|_, x| !gone.contains(&x.person));
        // Paying what's due, in batches (a program has at most 32 lines); and a payment whose time has run out ends.
        let mut ids: Vec<String> = self.paying.keys().cloned().collect();
        ids.sort_by(|a, b| filed_before(a, b));
        let mut due = vec![];
        let mut ended = vec![];
        for id in ids {
            let Some(x) = self.paying.get_mut(&id) else { continue };
            while x.next <= t && x.next <= x.until.unwrap_or(i64::MAX) && x.every > 0 {
                due.push(pay(&x.account, x.amount, Pay { from: Some(x.from.clone()), for_: Some(format!("{} support.", x.payment)), ..Default::default() }, cx));
                x.next += x.every;
            }
            if x.until.is_some_and(|u| x.next > u || t >= u) {
                ended.push((id, x.clone()));
            }
        }
        for chunk in due.chunks(30) {
            steps.push(because(format!("Paying the support due ({} payments).", due.len()), chunk.to_vec()));
        }
        let paid = due.len() as i64;
        for (id, x) in ended {
            self.paying.remove(&id);
            let paper = m::BenefitEnd { claim: id.clone(), payment: x.payment.clone(), ended: true, then: x.then.clone() };
            steps.push(because(
                format!("The {} payment under claim {id} has run its time: telling the claimant it has ended.", x.payment),
                vec![say(
                    "benefit_end",
                    &format!("Claim {id}: the {} payment has ended.{}", x.payment, x.then.as_ref().map_or(String::new(), |th| format!(" You may claim {th}."))),
                    Say {
                        to: Some(vec![x.person.clone()]),
                        visible: Some(Visible::Only(vec![x.person.clone(), self.me.clone()])),
                        basis: Some(id.clone()),
                        data: Some(papers::data(&paper)),
                        ..Default::default()
                    },
                )],
            ));
        }
        // The published figures: recipients of each payment.
        if t >= self.next_publish {
            self.next_publish = t + self.publish_every_days * DAY;
            let recipients: BTreeMap<String, i64> =
                ours.iter().map(|r| (r.id.clone(), self.paying.values().filter(|x| x.payment == r.id).count() as i64)).collect();
            let words = recipients.iter().map(|(k, n)| format!("{k} {n}")).collect::<Vec<_>>().join(", ");
            steps.push(because(
                "Publishing this period's figures: how many we pay, of each kind.",
                vec![say(
                    "support_statistics",
                    &format!("Support recipients: {words}."),
                    Say { visible: Some(Visible::Public), data: Some(papers::data(&m::SupportStatistics { recipients })), ..Default::default() },
                )],
            ));
        }
        if staff {
            // The staff's report (docs/behaviour/standing-work.md): what was done under the order, in counts and a sample.
            self.routines.did(TASK, t, paid, &[]);
            let note = format!(
                "{} claim{} granted and {} put before the office-holder since the last report{}; {} {} being paid",
                self.granted,
                if self.granted == 1 { "" } else { "s" },
                self.put_before,
                if self.lately.is_empty() { String::new() } else { format!(" (granted lately: {})", self.lately.join("; ")) },
                self.paying.len(),
                if self.paying.len() == 1 { "person is" } else { "people are" }
            );
            self.routines.note(TASK, Some(note));
            let office = self.office.clone();
            let r = ReportOf { office: &office, from: "the support office's staff", tasks: vec![(TASK, "days' work", Some("payments"))], ..Default::default() };
            let report = self.routines.report(&self.book, cx, &r);
            if !report.is_empty() {
                self.granted = 0;
                self.put_before = 0;
                self.lately.clear();
            }
            steps.extend(report);
        }
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::super::shared::rig::*;
    use super::*;
    use oikos_sight::Seen;
    use serde_json::json;

    fn records(v: Vec<std::sync::Arc<oikos_sight::Record>>) -> Seen {
        Seen::Records { records: v, search: false }
    }

    #[test]
    fn the_funding_desk_lends_what_a_bank_draws_once_and_settles_the_draw() {
        let mut r = Rig::new(&Funding, "market", json!({ "account": "market-acct" }));
        let draws = vec![
            st_to("rec.5", 1, "funding_draw", "bank", &["market"], json!({ "amount": 250_000, "account": "bank-acct", "rate_bps": 400 })),
            st_to("rec.4", 1, "funding_draw", "bank", &["someone-else"], json!({ "amount": 9, "account": "bank-acct" })),
            st_to("rec.6", 2, "funding_draw", "bank", &["market"], json!({ "amount": 0, "account": "bank-acct" })),
            st_to("rec.7", 2, "funding_draw", "bank", &["market"], json!({ "amount": 100 })),
        ];
        let acts = r.wake(DAY, vec![("draws", records(draws.clone()))]);
        let pays = payments(&acts);
        assert_eq!(pays.len(), 1, "{acts:?}");
        assert_eq!(pays[0], ("bank-acct".to_string(), "$2500.00".to_string(), Some("market-acct".to_string()), Some("Funding.".to_string())));
        let crate::Action::Call { program: oikos_sight::calls::Program::Lines(l), .. } = &acts[0] else { panic!() };
        assert_eq!(l[0].call.get("settles"), Some(&oikos_sight::calls::Value::Id("rec.5".into())));
        // Lent once.
        r.save_and_restore();
        assert!(payments(&r.wake(2 * DAY, vec![("draws", records(draws))])).is_empty());
    }

    #[test]
    fn the_funding_desk_needs_its_account() {
        let ctx = Ctx { participant: "s".into(), performer: Default::default(), entity: "e".into(), position: None, params: Default::default(), world: Default::default() };
        assert!(Funding.create(&ctx).err().unwrap().contains("account"));
    }

    fn estimate(id: &str, at: i64, residents: i64) -> std::sync::Arc<oikos_sight::Record> {
        st(id, at, "population_estimate", "stats", json!({ "residents": residents, "census": 1, "births": 0, "arrivals": 0, "deaths": 0, "departures": 0 }))
    }
    fn grants() -> Rig {
        Rig::new(&Grants, "state", json!({ "account": "state-acct", "to": "council", "to_account": "council-acct", "per_resident_per_year": 36_500, "every_days": 91, "first_day": 30 }))
    }

    #[test]
    fn the_grant_is_paid_by_the_latest_published_estimate_each_quarter() {
        let mut r = grants();
        assert!(payments(&r.wake(3 * 3600, vec![("news", records(vec![estimate("rec.1", 100, 1000)]))])).is_empty(), "not before the first day");
        let acts = r.wake(30 * DAY, vec![("news", records(vec![estimate("rec.2", 20 * DAY, 1200)]))]);
        let pays = payments(&acts);
        // 36,500 a resident a year x 1,200 residents x 91 days / 365 = 10,920,000 cents.
        assert_eq!(pays, vec![("council-acct".to_string(), "$109200.00".to_string(), Some("state-acct".to_string()), Some("Grant.".to_string()))]);
        let said = statements(&acts);
        assert_eq!(said[0].kind, "grant_payment");
        assert_eq!(said[0].data, json!({ "amount": 10_920_000, "residents": 1200, "per_resident_per_year": 36_500 }));
        assert_eq!(said[0].to, ["council"]);
        assert_eq!(said[0].basis.as_deref(), Some("rec.2"), "it pays by a published count, and cites it");
        // Not again until the quarter is out; then by the newer estimate.
        assert!(payments(&r.wake(100 * DAY, vec![])).is_empty());
        let acts = r.wake(121 * DAY, vec![("news", records(vec![estimate("rec.3", 110 * DAY, 800)]))]);
        assert_eq!(statements(&acts)[0].data["residents"], 800);
    }

    #[test]
    fn with_no_estimate_the_grants_office_looks_again_tomorrow() {
        let mut r = grants();
        assert!(payments(&r.wake(30 * DAY, vec![])).is_empty());
        let acts = r.wake(31 * DAY, vec![("news", records(vec![estimate("rec.1", 30 * DAY, 100)]))]);
        assert_eq!(payments(&acts).len(), 1);
    }

    #[test]
    fn a_grant_of_nothing_is_not_paid_and_the_office_saves_when_it_pays_next() {
        let mut r = grants();
        assert!(payments(&r.wake(30 * DAY, vec![("news", records(vec![estimate("rec.1", 0, 0)]))])).is_empty());
        r.save_and_restore();
        assert_eq!(r.actor.save().unwrap()["inner"]["plan"]["next"], 121 * DAY);
        let mut free = Rig::new(&Grants, "state", json!({ "account": "a", "to": "c", "to_account": "ca" }));
        assert!(payments(&free.wake(100 * DAY, vec![("news", records(vec![estimate("rec.1", 0, 500)]))])).is_empty(), "no rate, no grant");
    }
}

#[cfg(test)]
mod transfer_tests {
    use super::super::shared::rig::*;
    use super::*;
    use oikos_sight::Seen;
    use serde_json::json;

    const YEAR: i64 = 365 * DAY;
    const MONTH: i64 = 30 * DAY;

    fn law(payments: Value) -> Arc<Record> {
        st("law-support", 0, "law", "outside", json!({ "support": "payments", "payments": payments }))
    }
    fn tax_law() -> Arc<Record> {
        st("law-tax", 0, "law", "outside", json!({ "tax": "income", "charges": [{ "id": "tax", "schedule": [{ "from": 0, "rate_bps": 2000 }], "collector": "outside", "account": "acc-o" }] }))
    }
    fn claim(id: &str, at: i64, who: &str, payment: &str, age: i64, declares: Option<Value>) -> Arc<Record> {
        let mut d = json!({ "payment": payment, "account": format!("acc-{who}"), "born_at": at - age * YEAR - DAY });
        if let Some(x) = declares {
            d["declares"] = x;
        }
        st_to(id, at, "benefit_claim", who, &["outside"], d)
    }
    fn report(id: &str, at: i64, staff: Value) -> Arc<Record> {
        st_to(id, at, "withholding_report", "firm", &["outside"], json!({ "withheld": 1, "paid": 1, "staff": staff }))
    }
    fn office() -> Rig {
        Rig::new(&Transfers, "outside", json!({ "account": "acc-o", "publish_every_days": 30 }))
    }
    fn at(r: &mut Rig, t: i64, records: Vec<Arc<Record>>) -> Vec<crate::Action> {
        r.wake(t, vec![("book", Seen::Records { records, search: false })])
    }
    fn decisions(a: &[crate::Action]) -> Vec<Value> {
        statements(a).into_iter().filter(|s| s.kind == "benefit_decision").map(|s| s.data).collect()
    }
    fn cents_of(text: &str) -> i64 {
        text.trim_start_matches('$').replace('.', "").parse().unwrap()
    }
    fn paid(a: &[crate::Action]) -> Vec<(String, i64, Option<String>)> {
        payments(a).into_iter().map(|(to, amount, from, _)| (to, cents_of(&amount), from)).collect()
    }
    fn by() -> Value {
        json!({ "payer": "outside", "account": "acc-o" })
    }
    fn rule(extra: Value) -> Value {
        let mut r = by();
        r.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        r
    }

    #[test]
    fn the_audit_office_is_answered_from_the_offices_books_the_count_of_decisions_and_one_with_its_claim_and_the_record_it_rests_on() {
        let mut m = office();
        let pension = rule(json!({ "id": "pension", "account": "acc-fund", "every_days": 14, "who": { "from_age": 67 }, "amount": { "flat": 50_000 } }));
        let audit_law = st("law-audit", 0, "law", "city", json!({ "audit": { "auditor": "audit", "office": "audit", "answer_within_days": 10, "report_within_days": 10, "bodies": [
            { "body": "support", "entity": "outside", "every_days": 30, "checks": ["decisions"], "kind": "benefit_decision" }] } }));
        // The office decided a claim on day 1 (the paper on file), the claimant having been reported by an employer.
        let first = at(&mut m, DAY, vec![law(json!([pension])), claim("c1", DAY, "old", "pension", 70, None)]);
        let made = decisions(&first);
        assert_eq!(made.len(), 1, "one decision to be audited");
        let decision = st_to("d1", DAY, "benefit_decision", "outside", &["old"], json!({ "claim": "c1", "payment": "pension", "granted": true, "amount": 50_000, "every": 14 * DAY }));
        let ask = |id: &str, ask: &str, extra: Value| {
            let mut d = json!({ "audit": "support|decisions|1", "body": "support", "ask": ask, "kind": "benefit_decision", "from": 0, "to": 30 * DAY, "answer_by": 50 * DAY });
            d.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            st_to(id, 35 * DAY, "audit_request", "audit", &[], d)
        };
        let out = at(&mut m, 36 * DAY, vec![audit_law, decision, ask("rec.90", "count", json!({})), ask("rec.91", "nth", json!({ "nth": 1 })), ask("rec.92", "nth", json!({ "nth": 2 }))]);
        let answers: Vec<Value> = statements(&out).into_iter().filter(|s| s.kind == "audit_answer").map(|s| s.data).collect();
        assert_eq!(answers.len(), 3, "each request answered once: {answers:?}");
        assert_eq!(answers[0]["count"], 1, "{answers:?}");
        assert_eq!(answers[1]["found"], true);
        assert_eq!(answers[1]["file"]["decision"]["granted"], true);
        assert_eq!(answers[1]["file"]["decision"]["on"], DAY, "the round it was made at: the office's own record of it");
        assert_eq!(answers[1]["file"]["claim"]["by"], "old");
        assert_eq!(answers[1]["file"]["claim"]["payment"], "pension");
        assert_eq!(answers[2]["found"], false, "there is no second decision in the period");
        let again = at(&mut m, 37 * DAY, vec![]);
        assert!(statements(&again).iter().all(|s| s.kind != "audit_answer"), "answered once");
    }

    #[test]
    fn a_flat_payment_by_age_is_granted_paid_on_its_schedule_and_counted_in_the_published_figures() {
        let mut m = office();
        let pension = rule(json!({ "id": "pension", "account": "acc-fund", "every_days": 14, "who": { "from_age": 67 }, "amount": { "flat": 50_000 } }));
        let first = at(&mut m, 0, vec![law(json!([pension])), claim("c1", 0, "old", "pension", 70, None), claim("c2", 0, "young", "pension", 30, None), claim("c3", 0, "x", "nothing", 70, None)]);
        assert_eq!(
            decisions(&first),
            [
                json!({ "claim": "c1", "payment": "pension", "granted": true, "amount": 50_000, "every": 14 * DAY }),
                json!({ "claim": "c2", "payment": "pension", "granted": false }),
                json!({ "claim": "c3", "payment": "nothing", "granted": false }),
            ]
        );
        let texts: Vec<_> = statements(&first).into_iter().map(|s| s.text).collect();
        assert_eq!(texts, ["Claim c1 granted: $500.00 every 14 days.", "Claim c2 refused.", "Claim c3 refused."]);
        assert!(paid(&at(&mut m, 13 * DAY, vec![])).is_empty());
        assert_eq!(paid(&at(&mut m, 14 * DAY, vec![])), [("acc-old".to_string(), 50_000, Some("acc-fund".to_string()))]);
        let month = at(&mut m, 30 * DAY, vec![]);
        assert_eq!(paid(&month).len(), 1);
        let stats: Vec<_> = statements(&month).into_iter().filter(|s| s.kind == "support_statistics").collect();
        assert_eq!(stats[0].data, json!({ "recipients": { "pension": 1 } }));
        // With no law published, there is nothing to claim.
        let mut none = office();
        assert_eq!(decisions(&at(&mut none, 0, vec![claim("c1", 0, "old", "pension", 70, None)])), [json!({ "claim": "c1", "payment": "pension", "granted": false })]);
    }

    #[test]
    fn a_record_of_contributions_ten_months_are_refused_where_twelve_are_asked() {
        let r = rule(json!({ "id": "insurance", "every_days": 30, "who": { "out_of_work": true, "record": { "months": 12, "within_months": 30 } }, "amount": { "flat": 10_000 } }));
        let months = |n: i64, from: i64| -> Vec<Arc<Record>> {
            (0..n).map(|i| report(&format!("r{}", from + i), (from + i) * MONTH, json!([{ "worker": "w", "gross": 300_000 }, { "worker": "other", "gross": 1 }]))).collect()
        };
        let mut m = office();
        let mut book = vec![law(json!([r]))];
        book.extend(months(10, 0));
        book.push(claim("c1", 10 * MONTH, "w", "insurance", 40, None));
        let ten = at(&mut m, 10 * MONTH, book);
        assert_eq!(decisions(&ten), [json!({ "claim": "c1", "payment": "insurance", "granted": false, "reason": "contributions are on our record for 10 months, and the payment asks for 12" })]);
        let mut more = months(2, 10);
        more.push(claim("c2", 12 * MONTH, "w", "insurance", 40, None));
        let twelve = decisions(&at(&mut m, 12 * MONTH, more));
        assert_eq!((twelve[0]["claim"].clone(), twelve[0]["granted"].clone(), twelve[0]["amount"].clone()), (json!("c2"), json!(true), json!(10_000)));
        // Thirty months on, those twelve are too long ago; and someone with no report at all has none.
        let late = decisions(&at(&mut m, 45 * MONTH, vec![claim("c3", 45 * MONTH, "w", "insurance", 43, None), claim("c4", 45 * MONTH, "never", "insurance", 43, None)]));
        assert_eq!(late.iter().map(|d| d["granted"].clone()).collect::<Vec<_>>(), [json!(false), json!(false)]);
    }

    #[test]
    fn a_share_of_previous_pay_before_or_after_what_the_tax_law_withholds_within_a_least_and_a_most() {
        let share = |x: Value| {
            let mut a = json!({ "share_bps": 6000, "of": "gross" });
            a.as_object_mut().unwrap().extend(x.as_object().unwrap().clone());
            rule(json!({ "id": "insurance", "every_days": 30, "who": { "out_of_work": true, "record": {} }, "amount": a }))
        };
        let book = || vec![tax_law(), report("r1", MONTH, json!([{ "worker": "w", "gross": 280_000 }])), report("r2", 2 * MONTH, json!([{ "worker": "w", "gross": 320_000 }]))];
        let amount = |r: Value, age: i64, declares: Option<Value>| {
            let mut b = book();
            b.insert(0, law(json!([r])));
            b.push(claim("c", 2 * MONTH, "w", "insurance", age, declares));
            decisions(&at(&mut office(), 2 * MONTH, b))[0]["amount"].as_i64().unwrap()
        };
        assert_eq!(amount(share(json!({})), 40, None), 180_000, "60% of a mean of 300,000");
        assert_eq!(amount(share(json!({ "of": "net" })), 40, None), 144_000, "the tax law takes a fifth of such a pay");
        assert_eq!(amount(share(json!({ "of": "net", "with_child_bps": 6700 })), 40, Some(json!({ "children_born_at": [2 * MONTH - 5 * YEAR] }))), 160_800);
        assert_eq!(amount(share(json!({ "of": "net", "with_child_bps": 6700 })), 40, Some(json!({ "children_born_at": [] }))), 144_000);
        assert_eq!(amount(share(json!({ "least": 200_000 })), 40, None), 200_000);
        let capped = share(json!({ "most": [{ "from_age": 0, "amount": 100_000 }, { "from_age": 30, "amount": 150_000 }, { "from_age": 60, "amount": 120_000 }] }));
        assert_eq!([25, 40, 62].map(|a| amount(capped.clone(), a, None)), [100_000, 150_000, 120_000]);
        // A payment every 14 days is that share of fourteen days of the monthly pay.
        let mut fortnight = share(json!({}));
        fortnight["every_days"] = json!(14);
        assert_eq!(amount(fortnight, 40, None), 84_000);
    }

    #[test]
    fn a_payment_for_so_many_days_stops_when_its_time_runs_out_and_the_claimant_is_told_what_next() {
        let mut m = office();
        let rules = json!([
            rule(json!({ "id": "insurance", "every_days": 30, "who": { "out_of_work": true }, "amount": { "flat": 10_000 }, "lasts": { "days": 60, "then": "basic" } })),
            rule(json!({ "id": "basic", "every_days": 30, "who": { "out_of_work": true }, "amount": { "flat": 4_000 } })),
        ]);
        let granted = at(&mut m, 0, vec![law(rules), claim("c1", 0, "w", "insurance", 40, None)]);
        assert_eq!(decisions(&granted), [json!({ "claim": "c1", "payment": "insurance", "granted": true, "amount": 10_000, "every": 30 * DAY, "until": 60 * DAY })]);
        assert_eq!(paid(&at(&mut m, 30 * DAY, vec![])).len(), 1);
        let last = at(&mut m, 60 * DAY, vec![]);
        assert_eq!(paid(&last).len(), 1);
        let ends: Vec<_> = statements(&last).into_iter().filter(|s| s.kind == "benefit_end").collect();
        assert_eq!((ends[0].to.clone(), ends[0].data.clone()), (vec!["w".to_string()], json!({ "claim": "c1", "payment": "insurance", "ended": true, "then": "basic" })));
        assert!(ends[0].text.contains("You may claim basic."));
        assert!(paid(&at(&mut m, 90 * DAY, vec![])).is_empty());
        // Until an age: a payment granted to someone a month short of it is paid once.
        let mut n = office();
        let to_age = rule(json!({ "id": "bridge", "every_days": 30, "amount": { "flat": 1_000 }, "lasts": { "until_age": 60 } }));
        let born = -(60 * YEAR - 45 * DAY);
        let c = st_to("c1", 0, "benefit_claim", "w", &["outside"], json!({ "payment": "bridge", "account": "acc-w", "born_at": born }));
        at(&mut n, 0, vec![law(json!([to_age])), c]);
        let only = at(&mut n, 30 * DAY, vec![]);
        assert_eq!(paid(&only).len(), 1);
        assert_eq!(statements(&only).iter().filter(|s| s.kind == "benefit_end").count(), 1);
        assert!(paid(&at(&mut n, 60 * DAY, vec![])).is_empty());
    }

    #[test]
    fn what_a_claim_declares_is_taken_as_stated() {
        let family = rule(json!({ "id": "family", "every_days": 30, "who": { "income_under": { "amount": 20_000, "per": "head" }, "children": { "least": 1, "under_age": 18 } },
            "amount": { "household": 60_000, "per_member": 1_000, "per_child": { "under_age": 6, "amount": 15_000 } } }));
        let kids = json!([-3 * YEAR, -10 * YEAR]);
        let d = |declares: Option<Value>| decisions(&at(&mut office(), 0, vec![law(json!([family.clone()])), claim("c", 0, "head", "family", 35, declares)])).remove(0);
        let ok = d(Some(json!({ "household_income": 70_000, "household_members": 4, "children_born_at": kids })));
        assert_eq!((ok["granted"].clone(), ok["amount"].clone()), (json!(true), json!(60_000 + 4_000 + 15_000)));
        let over = d(Some(json!({ "household_income": 80_000, "household_members": 4, "children_born_at": kids })));
        assert_eq!((over["granted"].clone(), over["reason"].clone()), (json!(false), json!("the household's income as stated is not under $200.00 a head")));
        assert_eq!(d(Some(json!({ "household_income": 10_000, "household_members": 2, "children_born_at": [] })))["granted"], false, "no child");
        assert_eq!(d(None)["granted"], false, "nothing declared");
    }

    #[test]
    fn a_pension_for_those_with_no_other_the_office_refuses_someone_it_pays_another_pension_itself() {
        let rules = json!([
            rule(json!({ "id": "contributory", "every_days": 30, "who": { "from_age": 60 }, "amount": { "flat": 9_000 } })),
            rule(json!({ "id": "social", "every_days": 30, "who": { "from_age": 70, "no_other_pension": true }, "amount": { "flat": 2_000 } })),
        ]);
        let mut m = office();
        let first = at(
            &mut m,
            0,
            vec![
                law(rules),
                claim("c1", 0, "a", "social", 72, Some(json!({ "other_pension": false }))),
                claim("c2", 0, "b", "social", 72, Some(json!({ "other_pension": true }))),
                claim("c3", 0, "c", "social", 72, None),
                claim("c4", 0, "d", "contributory", 72, None),
            ],
        );
        assert_eq!(decisions(&first).iter().map(|x| x["granted"].clone()).collect::<Vec<_>>(), [json!(true), json!(false), json!(false), json!(true)]);
        let c5 = decisions(&at(&mut m, DAY, vec![claim("c5", DAY, "d", "social", 72, Some(json!({ "other_pension": false })))])).remove(0);
        assert_eq!(c5["reason"], "we pay the claimant another pension");
        // A person may draw more than one payment, each on its own claim.
        assert_eq!(decisions(&at(&mut m, 2 * DAY, vec![claim("c6", 2 * DAY, "a", "contributory", 72, None)]))[0]["granted"], true);
        let mut a: Vec<i64> = paid(&at(&mut m, 32 * DAY, vec![])).into_iter().filter(|p| p.0 == "acc-a").map(|p| p.1).collect();
        a.sort();
        assert_eq!(a, [2_000, 9_000]);
    }

    #[test]
    fn a_claimant_who_stops_dies_or_leaves_is_paid_no_more() {
        let flat = rule(json!({ "id": "basic", "every_days": 10, "amount": { "flat": 100 } }));
        let mut m = office();
        at(&mut m, 0, vec![law(json!([flat])), claim("c1", 0, "a", "basic", 40, None), claim("c2", 0, "b", "basic", 40, None), claim("c3", 0, "c", "basic", 40, None), claim("c4", 0, "d", "basic", 40, None)]);
        let news = vec![
            st_to("rec.20", 5 * DAY, "benefit_change", "a", &["outside"], json!({ "claim": "c1", "stop": true })),
            st("rec.21", 5 * DAY, "death_registration", "registry", json!({ "deceased": "b" })),
            st("rec.22", 5 * DAY, "departure", "c", json!({})),
        ];
        let to: Vec<_> = paid(&at(&mut m, 10 * DAY, news)).into_iter().map(|p| p.0).collect();
        assert_eq!(to, ["acc-d"]);
    }

    fn staffed(part: &str) -> Rig {
        Rig::build(&Transfers, "outside", Some("support-staff"), json!({ "account": "acc-o", "part": part }), world(true))
    }
    fn refusal_law() -> Arc<Record> {
        st("law-dec", 0, "law", "outside", json!({ "decisions": [{ "kind": "benefit_decision", "name": "support", "refused_by": "office-holder" }] }))
    }
    fn order() -> Arc<Record> {
        st("ord-1", 0, "work_order", "outside", json!({ "work": { "task": "pay_claims", "at": "office" }, "every": DAY }))
    }

    #[test]
    fn staff_decide_what_the_law_settles_and_put_a_refusal_before_the_office_holder_who_refuses_it() {
        let flat = rule(json!({ "id": "pension", "every_days": 14, "who": { "from_age": 67 }, "amount": { "flat": 50_000 } }));
        let mut staff = staffed("staff");
        let book = vec![law(json!([flat])), refusal_law(), order(), claim("c1", 0, "old", "pension", 70, None), claim("c2", 0, "young", "pension", 30, None)];
        let acts = at(&mut staff, 0, book.clone());
        let said = statements(&acts);
        let kinds: Vec<_> = said.iter().map(|s| s.kind.as_str()).collect();
        assert_eq!(&kinds[..2], ["benefit_decision", "case_for_decision"], "{kinds:?}");
        assert_eq!(said[0].data["granted"], true);
        assert_eq!(said[1].data["claim"], "c2");
        assert_eq!(said[1].data["doubt"], false);
        assert_eq!(said[1].to, ["outside"], "the case is on the office's own file");
        assert!(said.iter().any(|s| s.kind == "staff_report"), "the staff report what they did: {kinds:?}");
        // Without a standing order the staff do nothing.
        let mut idle = staffed("staff");
        assert!(decisions(&at(&mut idle, 0, vec![law(json!([rule(json!({ "id": "p", "every_days": 14, "amount": { "flat": 1 } }))])), claim("c1", 0, "old", "p", 70, None)])).is_empty());
        // The office-holder decides what the staff put before them.
        let mut holder = staffed("seat");
        let case = st_to("rec.30", DAY, "case_for_decision", "outside", &["outside"], json!({ "claim": "c2", "claimant": "young", "payment": "pension", "fails": "it does not meet the conditions" }));
        let refused = decisions(&at(&mut holder, DAY, vec![case]));
        assert_eq!(refused, [json!({ "claim": "c2", "payment": "pension", "granted": false, "reason": "it does not meet the conditions" })]);
        // And what the holder granted on the decision form is paid by the staff like any other.
        let granted = st_to("rec.31", DAY, "benefit_decision", "outside", &["young"], json!({ "claim": "c2", "payment": "pension", "granted": true, "amount": 7_000, "every": 14 * DAY }));
        let acts = at(&mut staff, 2 * DAY, vec![granted]);
        assert!(paid(&acts).is_empty());
        let later: Vec<_> = paid(&at(&mut staff, DAY + 14 * DAY + 1, vec![])).into_iter().filter(|p| p.0 == "acc-young").collect();
        assert_eq!(later, [("acc-young".to_string(), 7_000, Some("acc-o".to_string()))]);
    }

    #[test]
    fn a_wrong_refusal_is_a_slip_at_the_worlds_rate_and_is_put_right_on_review() {
        let slips: oikos_rules::slip::SlipTable = serde_json::from_value(json!({ "person": { "publish/benefit_decision": { "bps": 10_000 } } })).unwrap();
        let mut w = (*world(true)).clone();
        w.slip = Some(slips);
        let flat = rule(json!({ "id": "pension", "every_days": 14, "who": { "from_age": 67 }, "amount": { "flat": 50_000 } }));
        let dec = st("law-dec", 0, "law", "outside", json!({ "decisions": [{ "kind": "benefit_decision", "review": { "within_days": 30, "grounds": "wrong" } }] }));
        let mut m = Rig::build(&Transfers, "outside", None, json!({ "account": "acc-o" }), std::sync::Arc::new(w));
        let first = at(&mut m, 0, vec![law(json!([flat])), dec, claim("c1", 0, "old", "pension", 70, None)]);
        let d = decisions(&first);
        assert_eq!((d[0]["granted"].clone(), d[0]["reason"].clone()), (json!(false), json!("the claim could not be verified")));
        // Asked inside the law's days, it looks again, without a slip, and puts it right.
        let refusal_id = "rec.40";
        let refusal = st_to(refusal_id, 0, "benefit_decision", "outside", &["old"], d[0].clone());
        let request = st_to("rec.41", 5 * DAY, "review_request", "old", &["outside"], json!({ "about": refusal_id, "matter": "claim_refused" }));
        let acts = at(&mut m, 5 * DAY, vec![refusal, request]);
        let said = statements(&acts);
        let kinds: Vec<_> = said.iter().map(|s| s.kind.as_str()).collect();
        // (The review and the answer first; the new decision, which puts it right, after them.)
        assert_eq!(kinds, ["decision_review", "remedy_answer", "benefit_decision"], "{kinds:?}");
        assert_eq!((said[2].data["granted"].clone(), said[2].data["replaces"].clone(), said[2].data["on_review"].clone()), (json!(true), json!(refusal_id), json!("rec.41")));
        assert_eq!(said[0].data["outcome"], "changed");
        assert_eq!(said[1].data["granted"], true);
        // The slip is the same on the same case, whoever runs it (a draw named for the case, not the order).
        let mut twin = Rig::build(&Transfers, "outside", None, json!({ "account": "acc-o" }), m.ctx.world.clone());
        let again = at(&mut twin, 0, vec![law(json!([rule(json!({ "id": "pension", "every_days": 14, "who": { "from_age": 67 }, "amount": { "flat": 50_000 } }))])), claim("c1", 0, "old", "pension", 70, None)]);
        assert_eq!(decisions(&again)[0]["granted"], false);
    }

    #[test]
    fn a_claim_waits_for_the_papers_the_law_asks_for_then_is_decided() {
        let flat = rule(json!({ "id": "pension", "every_days": 14, "who": { "from_age": 67 }, "amount": { "flat": 50_000 } }));
        let dec = st("law-dec", 0, "law", "outside", json!({ "decisions": [{ "kind": "benefit_decision", "needs": [{ "id": "n1", "from": "claimant", "what": "proof of age", "within_days": 5, "else": "refuse" }] }] }));
        let mut m = office();
        let first = at(&mut m, 0, vec![law(json!([flat])), dec, claim("c1", 0, "old", "pension", 70, None)]);
        let said = statements(&first);
        assert_eq!(said.iter().map(|s| s.kind.as_str()).collect::<Vec<_>>(), ["evidence_request"]);
        assert_eq!(said[0].to, ["old"]);
        assert!(decisions(&at(&mut m, 2 * DAY, vec![])).is_empty(), "it waits, and asks once");
        let evidence = st_to("rec.50", 3 * DAY, "evidence", "old", &["outside"], json!({ "claim": "c1", "need": "n1" }));
        assert_eq!(decisions(&at(&mut m, 3 * DAY, vec![evidence]))[0]["granted"], true);
        // Not sent: it lapses and is refused.
        let mut late = office();
        let dec2 = st("law-dec", 0, "law", "outside", json!({ "decisions": [{ "kind": "benefit_decision", "needs": [{ "id": "n1", "from": "claimant", "what": "proof of age", "within_days": 5, "else": "refuse" }] }] }));
        at(&mut late, 0, vec![law(json!([rule(json!({ "id": "pension", "every_days": 14, "who": { "from_age": 67 }, "amount": { "flat": 1 } }))])), dec2, claim("c1", 0, "old", "pension", 70, None)]);
        let d = decisions(&at(&mut late, 6 * DAY, vec![]));
        assert_eq!(d[0]["granted"], false);
        assert!(d[0]["reason"].as_str().unwrap().contains("papers asked for did not come within 5 days"));
    }

    #[test]
    fn payments_in_force_before_the_year_are_taken_up_and_paid_from_the_day_each_names() {
        let flat = rule(json!({ "id": "pension", "every_days": 14, "who": { "from_age": 67 }, "amount": { "flat": 50_000 } }));
        let old_claim = st_to("c9", -100 * DAY, "benefit_claim", "old", &["outside"], json!({ "payment": "pension", "account": "acc-old", "born_at": -70 * YEAR, "brought_forward": true }));
        let grant = st_to("rec.60", 0, "benefit_decision", "outside", &["old"], json!({ "claim": "c9", "payment": "pension", "granted": true, "amount": 50_000, "every": 14 * DAY, "next": 3 * DAY, "brought_forward": true }));
        let mut m = office();
        let first = at(&mut m, 0, vec![law(json!([flat])), old_claim, grant]);
        assert!(decisions(&first).is_empty(), "a brought-forward claim is not decided again");
        assert!(paid(&at(&mut m, 2 * DAY, vec![])).is_empty());
        assert_eq!(paid(&at(&mut m, 3 * DAY, vec![])), [("acc-old".to_string(), 50_000, Some("acc-o".to_string()))]);
        m.save_and_restore();
        assert_eq!(paid(&at(&mut m, 17 * DAY, vec![])).len(), 1, "a restored office pays on as it would");
    }

    #[test]
    fn the_support_office_acknowledges_a_letter_and_needs_its_account() {
        let mut m = office();
        let mut pic = Rig::picture(0, vec![], vec![], "cadence");
        pic.inbox = vec![serde_json::from_value(json!({ "id": "msg.1", "t": 0, "from": "someone", "to": ["outside"], "text": "Please pay me." })).unwrap()];
        let mut draws = crate::Draws::new("p", "self");
        let mut cx = crate::Cx::new(0, &m.ctx, &mut draws, 1, vec![]);
        let act = m.actor.step(&pic, &mut cx);
        let crate::Action::Call { program: oikos_sight::calls::Program::Lines(lines), .. } = &act else { panic!("{act:?}") };
        assert_eq!(lines[0].call.fn_, "message");
        let ctx = Ctx { participant: "s".into(), performer: Default::default(), entity: "e".into(), position: None, params: Default::default(), world: Default::default() };
        assert!(Transfers.create(&ctx).err().unwrap().contains("account"));
    }
}
