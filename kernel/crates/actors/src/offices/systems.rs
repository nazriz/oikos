//! An office's dealings with systems (participants/src/behaviour/automation.ts: `OfficeAdoption`, `OfficeDesk`;
//! docs/behaviour/automation.md, "Offices"). The planning and rates offices may take up systems the outside world's
//! vendor sells (`market::automation`) to write their papers: the same comparison as a business's, with its own papers as
//! the units and its staff's time as the cost; and, where the contract is large, the law on public buying: a notice
//! inviting bids, the period they are open, and an award to the bid that costs least over the payback horizon. A system
//! it holds does the papers the office writes (`done_by` on the act's first call, whoever holds the office); the head of
//! the office (code or a seat) decides by this or by hand.
//!
//! A module given no `automation` (or no `casework`) has none, and does everything as before.
//!
//! **Decided in the Rust** (integers, docs/port-guide.md section 2): a paper's seconds (`labour`) is the mean of the
//! kinds' person-seconds, rounded half up; the volume a month is the papers made in the last year (at most), scaled to a
//! month, rounded half up; the cost of an error is ten papers' time at the staff's pay, rounded half up. Dates are written
//! through `when_words`. The tender's id is read from the act's outcome (`created.tender`).

use crate::common::{data, money_words, when_words, Book, Fields, DAY, MONTH};
use crate::common::breaches;
use crate::market::automation::{
    best, dropping, offers_of, order_kind, AdoptionParams, Appraisal, Fleet, Offer, Task, Terms,
};
use crate::market::trade::{self, Ordering};
use crate::papers::market::Tender;
use crate::papers;
use crate::steps::{arg, because, say, Done, Say, Step, Visible};
use crate::Cx;
use oikos_sight::calls::Line;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

const YEAR: i64 = 365 * DAY;

/// The law on public buying, as a place states it (the profile's): above this value a contract is tendered; bids are open
/// this long.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Procurement {
    pub threshold: i64,
    pub bid_days: i64,
}

/// What an office knows of the casework it does: how long a paper takes its staff, and what its staff are paid and work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Casework {
    pub kinds: Vec<String>,
    /// A person's seconds a paper of each kind (the town's table of work).
    #[serde(default)]
    pub person_seconds: BTreeMap<String, i64>,
    pub wage_month: i64,
    pub seconds_per_worker_month: i64,
    pub utilisation_bps: i64,
}

/// The office's own parameters for systems (`automation`, `procurement`, `casework`), as a module reads them from its
/// parameters. `automation` is partial: what it does not say is the default (`AdoptionParams::default`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DeskParams {
    pub automation: Option<AdoptionParams>,
    pub procurement: Option<Procurement>,
    pub casework: Option<Casework>,
}

impl DeskParams {
    pub fn read(ctx: &crate::Ctx) -> Result<DeskParams, String> {
        let automation = match ctx.params.get("automation").filter(|v| !v.is_null()) {
            None => None,
            Some(given) => {
                let mut base = serde_json::to_value(AdoptionParams::default()).map_err(|e| e.to_string())?;
                if let (Some(b), Some(g)) = (base.as_object_mut(), given.as_object()) {
                    for (k, v) in g {
                        b.insert(k.clone(), v.clone());
                    }
                }
                Some(serde_json::from_value(base).map_err(|e| format!("automation: {e}"))?)
            }
        };
        let procurement = ctx.param("procurement", None)?;
        let casework = ctx.param("casework", None)?;
        Ok(DeskParams { automation, procurement, casework })
    }
}

/// What follows from the office's steps about systems.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeskThen {
    /// The order for systems: refused, and the office has none out.
    Ordered,
    /// The notice inviting bids: applied, its id is the tender; refused, there is no tender.
    Tendered,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TenderOut {
    id: Option<String>,
    kinds: Vec<String>,
    closes: i64,
}

fn round_div(a: i128, b: i128) -> i64 {
    if b <= 0 {
        return a.max(0) as i64;
    }
    ((2 * a + b).div_euclid(2 * b)) as i64
}

/// The office's side of weighing systems (a library: saved with the office).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeAdoption {
    me: String,
    a: AdoptionParams,
    law: Option<Procurement>,
    tender: Option<TenderOut>,
    placed: bool,
    turn: usize,
}

/// What a review needs of the office.
pub struct OfficeReview<'a> {
    pub casework: &'a Casework,
    pub volume: i64,
    pub account: &'a str,
    pub balance: i64,
    pub keep: i64,
    pub staff: i64,
}

impl OfficeAdoption {
    pub fn new(me: &str, a: AdoptionParams, law: Option<Procurement>) -> Self {
        OfficeAdoption { me: me.to_string(), a, law, tender: None, placed: false, turn: 0 }
    }

    /// A system of ours to do a paper of this kind, if any is in service (taking them in turn).
    pub fn system_for(&mut self, fleet: &Fleet, kind: &str) -> Option<String> {
        let working: Vec<String> = fleet.in_service(None).into_iter().filter(|l| l.kinds.iter().any(|k| k == kind)).flat_map(|l| l.systems.clone()).collect();
        if working.is_empty() {
            return None;
        }
        let id = working[self.turn % working.len()].clone();
        self.turn += 1;
        Some(id)
    }

    /// The share of a month's papers of these kinds our systems do, in basis points.
    pub fn share(&self, fleet: &Fleet, kinds: &[String]) -> i64 {
        fleet.in_service(None).into_iter().filter(|l| kinds.iter().any(|k| l.kinds.contains(k))).map(|l| l.scope_bps).max().unwrap_or(0)
    }

    fn horizon(&self, staff: i64) -> i64 {
        if staff >= self.a.large_from {
            self.a.payback_months.large
        } else {
            self.a.payback_months.small
        }
    }

    pub fn review<T: From<DeskThen>>(&mut self, fleet: &mut Fleet, book: &mut Book, t: i64, o: &OfficeReview, cx: &mut Cx) -> Vec<Step<T>> {
        let mut steps: Vec<Step<T>> = vec![];
        let c = o.casework;
        let labour = round_div(c.kinds.iter().map(|k| i128::from(c.person_seconds.get(k).copied().unwrap_or(0))).sum(), c.kinds.len().max(1) as i128);
        // (What an error costs an office: the paper done again and looked at by a second pair of eyes; ten times the time of a
        // paper, a placeholder.)
        let facts = Task {
            units: o.volume,
            labour,
            wage_month: c.wage_month,
            seconds_per_worker_month: c.seconds_per_worker_month,
            utilisation_bps: c.utilisation_bps,
            unit_price: round_div(10 * i128::from(labour) * i128::from(c.wage_month), i128::from(c.seconds_per_worker_month).max(1)),
            hiring_cost_weeks: 8,
        };
        let horizon = self.horizon(o.staff);
        let money = |n: i64| money_words(n, &cx.ctx.world);
        let mine: Vec<String> = fleet.in_service(None).into_iter().filter(|l| c.kinds.iter().all(|k| l.kinds.contains(k))).map(|l| l.delivery.clone()).collect();
        let due: Vec<(String, crate::market::automation::Dropping, String, usize)> = fleet
            .in_service(None)
            .into_iter()
            .filter(|l| mine.contains(&l.delivery) && !l.ending && l.agreement.as_deref().is_some_and(|a| book.signed_by(a, &self.me)) && t >= l.since + l.term_days * DAY)
            .map(|l| (l.delivery.clone(), dropping(l, &facts, &self.a, horizon), l.title.clone(), l.systems.len()))
            .collect();
        for (delivery, d, title, n) in due {
            if d.drop {
                let why = format!(
                    "The licence of {n} {title} has run its term and costs {} a month against {} of staff time it frees, over {horizon} months more than the {} it costs to leave: ending it.",
                    money(d.running),
                    money(d.saving),
                    money(d.leaving)
                );
                steps.extend(fleet.leave(book, &delivery, o.account, &why, cx));
            }
        }
        if !mine.is_empty() || self.placed || facts.units <= 0 {
            return steps;
        }
        // A tender in hand: closed, it is awarded to the bid that frees most for least.
        if let Some(tender) = self.tender.clone() {
            if t < tender.closes {
                return steps;
            }
            self.tender = None;
            let id = tender.id.clone().unwrap_or_default();
            let bids: Vec<Offer> = book
                .all("bid")
                .filter(|r| crate::common::addressed_to(r).contains(&self.me) && data(r).s("tender") == Some(id.as_str()))
                .filter_map(|r| serde_json::from_value::<Offer>(data(r).clone()).ok())
                .filter(|f| c.kinds.iter().all(|k| f.base.kinds.contains(k)))
                .collect();
            let mut top: Option<(Offer, Appraisal)> = None;
            for f in &bids {
                if let Some(x) = best(&Terms::from(f), &facts, &self.a, horizon) {
                    if top.as_ref().is_none_or(|(_, y)| x.net > y.net) {
                        top = Some((f.clone(), x));
                    }
                }
            }
            let Some((f, x)) = top else {
                // (None is worth taking: no act, the tender is over. The TS said so in a step with no call.)
                return steps;
            };
            let what = format!("Awarding tender {id} to {}, the lowest of {} bid{} by cost over {horizon} months", f.vendor, bids.len(), if bids.len() == 1 { "" } else { "s" });
            steps.extend(self.order::<T>(&f, &x, &facts, horizon, o.account, &what, cx));
            return steps;
        }
        let mut top: Option<(Offer, Appraisal)> = None;
        for f in offers_of(book) {
            if f.base.for_ != "offices" || !c.kinds.iter().all(|k| f.base.kinds.contains(k)) {
                continue;
            }
            let Some(x) = best(&Terms::from(&f), &facts, &self.a, horizon) else { continue };
            let act = serde_json::json!({ "block": "deploy", "kinds": f.base.kinds, "offer": f.base.id, "vendor": f.vendor });
            let against = !breaches(book, &act, &self.me, t).is_empty();
            // (A law against the use stops it, except in the share of cases the office does not keep the law.)
            if against && cx.rng(&format!("comply-adopt-{}-{}", f.base.id, t / MONTH)).below(10_000) < self.a.compliance_bps.max(0) as u64 {
                continue;
            }
            if top.as_ref().is_none_or(|(_, y)| x.net > y.net) {
                top = Some((f, x));
            }
        }
        let Some((f, x)) = top else { return steps };
        let value = i128::from(x.n) * i128::from(f.base.setup) + i128::from(x.n) * i128::from(f.fee_month) * i128::from(round_div(i128::from(f.base.term_days), 30));
        if let Some(law) = self.law.filter(|l| value > i128::from(l.threshold)) {
            // Above the threshold the law asks for open bids: the notice goes out, and the award waits for them.
            let closes = t + law.bid_days * DAY;
            self.tender = Some(TenderOut { id: None, kinds: c.kinds.clone(), closes });
            let kinds = c.kinds.join(" and ");
            let notice = Tender { what: format!("write {kinds}"), kinds: c.kinds.clone(), volume: facts.units, closes, term_days: f.base.term_days };
            let mut s: Step<T> = Step::new(vec![Line {
                bind: Some("tender".into()),
                call: say(
                    "tender",
                    &format!(
                        "Tender: {} invites bids from sellers of systems to write {kinds}, about {} a month, for a licence of {} days. Bids close on {}; the lowest cost over {horizon} months is awarded.",
                        self.me,
                        facts.units,
                        f.base.term_days,
                        when_words(closes, &cx.ctx.world)
                    ),
                    Say { visible: Some(Visible::Public), data: Some(papers::data(&notice)), ..Default::default() },
                ),
            }]);
            s.why = Some(format!(
                "Taking systems to do {kinds} would come to {} over the licence, above the {} the law asks to be put out to tender: inviting bids for {} days.",
                money(value as i64),
                money(law.threshold),
                law.bid_days
            ));
            s.then = Some(T::from(DeskThen::Tendered));
            steps.push(s);
            return steps;
        }
        let what = format!("Taking {} {}", x.n, f.base.title);
        steps.extend(self.order::<T>(&f, &x, &facts, horizon, o.account, &what, cx));
        steps
    }

    #[allow(clippy::too_many_arguments)]
    fn order<T: From<DeskThen>>(&mut self, f: &Offer, x: &Appraisal, facts: &Task, horizon: i64, account: &str, what: &str, cx: &Cx) -> Vec<Step<T>> {
        self.placed = true;
        let money = |n: i64| money_words(n, &cx.ctx.world);
        let why = format!(
            "{what}: they would write {} of the {} papers a month, freeing {} of a clerk ({} a month) for {} a month in fees, oversight and mistakes, and {} to set up and {} to leave, spread over {horizon} months ({} a month).",
            x.units,
            facts.units,
            hundredths(x.hands_milli),
            money(x.saving),
            money(x.running),
            money(x.n * f.base.setup),
            money(f.base.exit),
            money(x.amortised)
        );
        let mut s = trade::order::<T>(
            &Ordering {
                me: self.me.clone(),
                seller: f.vendor.clone(),
                seller_account: f.account.clone(),
                kind: order_kind(&f.base.id),
                quantity: x.n,
                unit_price: f.base.setup,
                to: None,
                at: self.me.clone(),
                from: account.to_string(),
                why,
                retry_of: None,
                for_days: None,
                terms: None,
            },
            cx,
        );
        s.then = Some(T::from(DeskThen::Ordered));
        vec![s]
    }

    /// What follows from a step's outcome.
    pub fn then(&mut self, tok: &DeskThen, done: Done) {
        match tok {
            DeskThen::Ordered => {
                if !done.applied() {
                    self.placed = false;
                }
            }
            DeskThen::Tendered => {
                if done.applied() {
                    if let (Some(t), Done::Outcome(o)) = (self.tender.as_mut(), done) {
                        t.id = o.created.as_ref().and_then(|c| c.get("tender")).cloned();
                    }
                } else {
                    self.tender = None;
                }
            }
        }
    }
}

/// Thousandths of a person as hundredths, to two places (`toFixed(2)`).
fn hundredths(milli: i64) -> String {
    let h = (milli + 5).div_euclid(10);
    format!("{}.{:02}", h / 100, h % 100)
}

/// An office's dealings with systems, for a module to hold: its fleet and its adoption, the monthly look, and the papers
/// that go to a system it holds. A module given no `automation` has none, and does everything as before.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeDesk {
    me: String,
    p: DeskParams,
    fleet: Fleet,
    adoption: Option<OfficeAdoption>,
    next: i64,
}

impl OfficeDesk {
    pub fn new(me: &str, p: DeskParams) -> Self {
        let adoption = match (&p.automation, &p.casework) {
            (Some(a), Some(_)) => Some(OfficeAdoption::new(me, a.clone(), p.procurement)),
            _ => None,
        };
        OfficeDesk { me: me.to_string(), p, fleet: Fleet::new(me), adoption, next: 30 * DAY }
    }

    pub fn on(&self) -> bool {
        self.adoption.is_some()
    }

    pub fn absorb(&mut self, book: &Book) {
        if self.adoption.is_some() {
            self.fleet.absorb(book);
        }
    }

    /// Each plan: the licence papers; each month, whether to take a system for the papers it writes, or end a licence.
    pub fn steps<T: From<DeskThen>>(&mut self, book: &mut Book, t: i64, account: &str, balance: i64, staff: i64, keep: i64, cx: &mut Cx) -> Vec<Step<T>> {
        let (Some(adoption), Some(casework)) = (self.adoption.as_mut(), self.p.casework.as_ref()) else { return vec![] };
        let mut steps = self.fleet.paperwork::<T>(book, account, cx);
        if t < self.next {
            return steps;
        }
        self.next = t + MONTH;
        let since = MONTH.max(YEAR.min(t));
        let made: i64 = casework.kinds.iter().map(|k| book.all(k).filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str()) && r.at >= t - YEAR).count() as i64).sum();
        let volume = round_div(i128::from(made) * i128::from(MONTH), i128::from(since));
        steps.extend(adoption.review::<T>(&mut self.fleet, book, t, &OfficeReview { casework, volume, account, balance, keep, staff }, cx));
        steps
    }

    /// A step's paper goes to a system of ours that writes this kind, if we hold one: `done_by` on its first call, which the
    /// platform gives to the act.
    pub fn assign<T>(&mut self, step: &mut Step<T>, kind: &str) {
        let Some(adoption) = self.adoption.as_mut() else { return };
        let Some(id) = adoption.system_for(&self.fleet, kind) else { return };
        if let Some(first) = step.lines.first_mut() {
            first.call.args.push(("done_by".to_string(), arg(&id)));
        }
    }

    /// What follows from a step about systems.
    pub fn then(&mut self, tok: &DeskThen, done: Done) {
        if let Some(a) = self.adoption.as_mut() {
            a.then(tok, done);
        }
    }

    /// The share of a month's papers of these kinds our systems do, in basis points.
    pub fn share(&self, kinds: &[String]) -> i64 {
        self.adoption.as_ref().map_or(0, |a| a.share(&self.fleet, kinds))
    }
}

/// An office's tender (docs/behaviour/automation.md), as participants/test/automation.test.ts held it on the TypeScript `OfficeAdoption`
/// (gone): the figures are the test's own.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::finance::kit::{book_of, statement, Stand};
    use crate::market::automation::{AdoptionParams, Fleet};
    use oikos_sight::calls::program_text;
    use serde_json::json;

    fn offer_data(id: &str, setup: i64, fee: i64) -> Value {
        json!({ "id": id, "title": id, "for": "offices", "kinds": ["rates_notice"], "template": id, "seconds": 20, "speed_bps": 1_500, "scope_bps": 6_000, "setup": setup,
            "fee_per_year": fee * 12, "exit": 0, "term_days": 365, "notice_days": 30, "oversight_hours_per_month": 0, "error_bps": 0, "account": format!("acc-{id}"), "fee_month": fee, "references": 0 })
    }
    fn offer(id: &str, vendor: &str, setup: i64, fee: i64) -> Value {
        statement(&format!("offer-{id}"), 0, "system_offer", json!({ "speaks_for": vendor }), offer_data(id, setup, fee))
    }
    fn bid(id: &str, vendor: &str, setup: i64, fee: i64) -> Value {
        let mut d = offer_data(id, setup, fee);
        d["tender"] = json!("tender-1");
        statement(&format!("bid-{id}"), 45 * DAY, "bid", json!({ "speaks_for": vendor, "addressed_to": ["city"] }), d)
    }
    fn casework() -> Casework {
        Casework { kinds: vec!["rates_notice".into()], person_seconds: [("rates_notice".to_string(), 120)].into(), wage_month: 450_000, seconds_per_worker_month: 160 * 3600, utilisation_bps: 8_000 }
    }
    fn review(o: &mut OfficeAdoption, stand: &mut Stand, records: Vec<Value>, t: i64, volume: i64) -> Vec<Step<DeskThen>> {
        let c = casework();
        let mut book = book_of("city", records);
        let mut fleet = Fleet::new("city");
        let ask = OfficeReview { casework: &c, volume, account: "acc-city", balance: 10_000_000_000, keep: 0, staff: 1 };
        o.review::<DeskThen>(&mut fleet, &mut book, t, &ask, &mut stand.cx(t))
    }
    fn said(steps: &[Step<DeskThen>]) -> String {
        steps.iter().map(|s| program_text(&s.program())).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn an_office_puts_a_large_contract_to_tender_as_the_law_asks_waits_for_the_bids_and_awards_it_to_the_one_that_costs_least() {
        let mut stand = Stand::new("city");
        let offers = vec![offer("sys-a", "vendor-a", 10_000_000, 400_000), offer("sys-b", "vendor-b", 7_500_000, 300_000)];
        // A large office: 40,000 notices a month (a city of a million), so a clerk's days are worth a system. Under the law's threshold: ordered at once.
        let mut small = OfficeAdoption::new("city", AdoptionParams::default(), Some(Procurement { threshold: 10_000_000_000_000, bid_days: 30 }));
        let direct = said(&review(&mut small, &mut stand, offers.clone(), 40 * DAY, 40_000));
        assert!(direct.contains("kind=order") && !direct.contains("kind=tender"), "{direct}");
        // Above it: a tender, and nothing decided while it is open.
        let mut o = OfficeAdoption::new("city", AdoptionParams::default(), Some(Procurement { threshold: 1_000_000, bid_days: 30 }));
        let first = said(&review(&mut o, &mut stand, offers.clone(), 40 * DAY, 40_000));
        assert!(first.contains("kind=tender") && !first.contains("kind=order"), "{first}");
        assert!(review(&mut o, &mut stand, offers.clone(), 50 * DAY, 40_000).is_empty());
        // Closed, with two bids: the dearer is passed over. (The tender's id as the world gave it.)
        o.tender.as_mut().expect("a tender out").id = Some("tender-1".into());
        let mut all = offers.clone();
        all.extend([bid("sys-a", "vendor-a", 10_000_000, 400_000), bid("sys-b", "vendor-b", 7_500_000, 300_000)]);
        let awarded = said(&review(&mut o, &mut stand, all, 75 * DAY, 40_000));
        assert!(awarded.contains("system:sys-b") && !awarded.contains("system:sys-a"), "{awarded}");
        // With no bids it awards nothing.
        let mut none = OfficeAdoption::new("city", AdoptionParams::default(), Some(Procurement { threshold: 1_000_000, bid_days: 30 }));
        review(&mut none, &mut stand, offers.clone(), 40 * DAY, 40_000);
        none.tender.as_mut().expect("a tender out").id = Some("tender-9".into());
        assert!(review(&mut none, &mut stand, offers, 75 * DAY, 40_000).is_empty());
    }

    #[test]
    fn a_small_office_whose_papers_cost_its_staff_little_takes_none_at_any_of_these_prices() {
        let mut stand = Stand::new("city");
        let mut o = OfficeAdoption::new("city", AdoptionParams::default(), Some(Procurement { threshold: 1_000_000, bid_days: 30 }));
        assert!(review(&mut o, &mut stand, vec![offer("sys-a", "vendor-a", 2_325_000, 31_000)], 40 * DAY, 400).is_empty());
    }
}
