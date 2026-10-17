//! An employer's side of bargaining with a union (ported from firms.ts `Bargaining`, with the concession rule of branch
//! `gd-adoption`'s `concessionBps`; docs/behaviour/unions.md, "Concession"; risk A-2).
//!
//! A wage claim gets an offer by the firm's capacity to pay: all of the claim if what it holds beyond a month's wages
//! covers twice the claim's cost for a year, less in proportion if not. An offer the union accepts becomes an
//! enterprise agreement (published) and a rise for all staff. Workers on strike are not paid for the time. After a
//! stoppage the employer knows what it cost it: the share of its work the strikers' hours were of all the hours of its
//! work (less what systems do of it), times its takings for the days stopped. It will concede, in a year's cost, up to
//! what holding out against another stoppage a day longer than the last would cost (Hicks 1932; Kennan and Wilson
//! 1993). Its offer rises to that, never above the claim, never below what it offered. The old rule (half the gap, all of
//! it after three stoppages whatever a stoppage cost) is gone: how far it goes follows what the stoppages cost.
//!
//! The arithmetic (`concession_bps`, `Takings`) is `oikos_rules::bargaining`'s alone, shared with the union's side (lane D);
//! this is the employer's dealings with it.

use super::decimal::{fmt_dec, round_div};
use super::staffing::Staffing;
use crate::common::{data, money_words, Fields, MONTH};
use crate::papers::agreements::job_terms;
use crate::steps::{because, say, Say, Step, Visible};
use crate::{Cx, DAY};
use oikos_rules::bargaining::concession_bps;
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeSet;
use std::sync::Arc;

/// What a firm has taken in, and what a stoppage costs it: the pure arithmetic is `oikos_rules::bargaining` (one place, shared
/// with the union's side).
pub use oikos_rules::bargaining::Takings;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Dispute {
    claim: String,
    union: String,
    claim_bps: i64,
    offer_bps: i64,
    stoppages: i64,
    last_days: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Stoppage {
    at: i64,
    days: i64,
    share_bps: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bargaining {
    me: String,
    handled: BTreeSet<String>,
    open: Option<Dispute>,
    strikers: Vec<String>,
    stoppage: Option<Stoppage>,
}

/// What a round of bargaining did: its steps, and the rises (basis points) the firm has agreed to.
pub struct Bargained<T> {
    pub steps: Vec<Step<T>>,
    pub raised: Vec<i64>,
}

impl Bargaining {
    pub fn new(me: &str) -> Self {
        Bargaining { me: me.into(), handled: BTreeSet::new(), open: None, strikers: vec![], stoppage: None }
    }

    /// `takings_per_day`: the firm's takings as it keeps them (none: it counts no cost, concedes nothing beyond its
    /// capacity). `system_bps`: the share of its work systems do (supplied by whatever puts systems to work; none: 0).
    #[allow(clippy::too_many_arguments)]
    pub fn steps<T>(&mut self, book: &crate::common::Book, t: i64, cx: &mut Cx, staffing: &mut Staffing, account: &str, balance: i64, takings_per_day: i64, system_bps: i64) -> Bargained<T> {
        let me = self.me.clone();
        let world = cx.ctx.world.clone();
        let usd = |n: i64| money_words(n, &world);
        let mut steps: Vec<Step<T>> = vec![];
        let mut raised = vec![];
        let mine = |handled: &BTreeSet<String>, r: &Arc<Record>| !handled.contains(&r.id) && crate::common::addressed_to(r).contains(&me) && data(r).s("employer") == Some(me.as_str());
        let staff: Vec<Arc<Record>> = staffing.staff(book, t).into_iter().cloned().collect();
        let worker = |a: &Record| crate::papers::agreements::parties_of(a).get(1).cloned().unwrap_or_default();
        let month_bill: i64 = staff.iter().map(|a| staffing.wage_of(a) * MONTH / job_terms(a, &worker(a), None).period.max(1)).sum();
        let offer_for = |claim_bps: i64| {
            let year_cost = month_bill * 12 * claim_bps / 10_000;
            let spare = (balance - month_bill).max(0);
            if year_cost <= 0 {
                claim_bps
            } else {
                // claimBps * min(1, spare / (2 * yearCost)), down to a tenth of a percent.
                (claim_bps * spare.min(2 * year_cost) / (2 * year_cost)) / 10 * 10
            }
        };
        let offer = |o: &Dispute, why: &str| {
            say(
                "wage_offer",
                &format!("We offer a rise of {}% (the claim was {}%).", fmt_dec(o.offer_bps, 100), fmt_dec(o.claim_bps, 100)),
                Say { to: Some(vec![o.union.clone()]), visible: Some(Visible::Only(vec![me.clone(), o.union.clone()])), basis: Some(o.claim.clone()), data: Some(json!({ "employer": me, "claim": o.claim, "rise_bps": o.offer_bps, "why": why })), ..Default::default() },
            )
        };
        // Hours of work: each person's, as their agreement states them (else the mean of those that do).
        let stated: Vec<i64> = staff.iter().filter_map(|a| job_terms(a, &worker(a), None).hours).collect();
        let usual = if stated.is_empty() { 1 } else { stated.iter().sum::<i64>() / stated.len() as i64 };
        let hours_of = |s: &Staffing, a: &Record| i128::from(job_terms(a, &worker(a), None).hours.unwrap_or(usual)) * i128::from(s.hours_bps_at(&worker(a), t)) / 10_000;
        let claims: Vec<Arc<Record>> = book.open("wage_claim").filter(|r| mine(&self.handled, r)).cloned().collect();
        for c in claims {
            self.handled.insert(c.id.clone());
            let claim_bps = data(&c).i("rise_bps").unwrap_or(0).max(0);
            let d = Dispute { claim: c.id.clone(), union: c.speaks_for.clone().unwrap_or_default(), claim_bps, offer_bps: claim_bps.min(offer_for(claim_bps)), stoppages: 0, last_days: 0 };
            steps.push(because(
                format!("A wage claim from {} for {}%: offering {}%, as far as what we hold beyond a month's wages ({}) covers twice its cost for a year.", d.union, fmt_dec(claim_bps, 100), fmt_dec(d.offer_bps, 100), usd((balance - month_bill).max(0))),
                vec![offer(&d, "capacity to pay")],
            ));
            self.open = Some(d);
        }
        let accepted: Vec<Arc<Record>> = book.open("offer_accepted").filter(|r| mine(&self.handled, r)).cloned().collect();
        for a in accepted {
            self.handled.insert(a.id.clone());
            let Some(open) = self.open.as_ref().filter(|o| data(&a).s("claim") == Some(o.claim.as_str())) else { continue };
            let (rise, union) = (open.offer_bps, open.union.clone());
            self.open = None;
            raised.push(rise);
            steps.push(because(
                format!("{union} accepted our offer: an enterprise agreement, a rise of {}% for all our staff.", fmt_dec(rise, 100)),
                vec![say(
                    "enterprise_agreement",
                    &format!("Enterprise agreement between {me} and {union}: wages rise {}% from now.", fmt_dec(rise, 100)),
                    Say { visible: Some(Visible::Public), to: Some(vec![union.clone()]), basis: Some(a.id.clone()), data: Some(json!({ "employer": me, "union": union, "rise_bps": rise, "from": t })), ..Default::default() },
                )],
            ));
            steps.extend(staffing.raise(book, t, cx, account, rise, &format!("The enterprise agreement: everyone's wages up {}%, from their next pay.", fmt_dec(rise, 100)), None));
        }
        let stops: Vec<Arc<Record>> = book.open("stop_work").filter(|r| mine(&self.handled, r)).cloned().collect();
        for s in stops {
            self.handled.insert(s.id.clone());
            let members: Vec<String> = data(&s).ids("members").into_iter().map(String::from).collect();
            self.strikers = members.into_iter().filter(|w| staff.iter().any(|a| worker(a) == *w)).collect();
            // What the stoppage takes of our work: the strikers' hours of all our hours, and how long the notice says.
            let total: i128 = staff.iter().map(|a| hours_of(staffing, a)).sum();
            let out: i128 = staff.iter().filter(|a| self.strikers.contains(&worker(a))).map(|a| hours_of(staffing, a)).sum();
            let until = data(&s).i("until");
            let notice = book.open("industrial_action").filter(|n| data(n).s("employer") == Some(me.as_str()) && until.is_some() && data(n).i("until") == until).max_by_key(|n| n.at);
            let length = match (notice, until) {
                (Some(n), Some(u)) => Some(u - data(n).i("from").unwrap_or(s.at)),
                (None, Some(u)) => Some(u - s.at),
                _ => None,
            };
            self.stoppage = Some(Stoppage {
                at: s.at,
                days: length.map_or(1, |l| (round_div(i128::from(l), i128::from(DAY)) as i64).max(1)),
                share_bps: if total > 0 { (out * 10_000 / total) as i64 } else { 0 },
            });
            steps.extend(staffing.stop(book, t, &self.strikers, &format!("A strike by {}'s members: no pay for the time on strike.", s.speaks_for.clone().unwrap_or_default())));
        }
        let returns: Vec<Arc<Record>> = book.open("return_to_work").filter(|r| mine(&self.handled, r)).cloned().collect();
        for r in returns {
            self.handled.insert(r.id.clone());
            let strikers = std::mem::take(&mut self.strikers);
            steps.extend(staffing.resume(book, t, cx, account, &strikers, "Back from the strike: paying what they earned before it, and restarting their wages."));
            let Some(mut o) = self.open.take() else { continue };
            o.stoppages += 1;
            let was = self.stoppage.take();
            if let Some(w) = &was {
                o.last_days = w.days;
            }
            let share = was.as_ref().map_or(0, |w| w.share_bps);
            let oikos_rules::bargaining::Concession { rise_bps: rise, cost: willing } = concession_bps(share, system_bps, takings_per_day, o.last_days, month_bill * 12);
            let before = o.offer_bps;
            o.offer_bps = o.claim_bps.min(o.offer_bps.max(rise));
            steps.push(because(
                format!(
                    "After {} stoppage{}, the last of {} day{} with {}% of our hours out{}, against takings of {} a day: another a day longer would cost us {}, which a year's cost covers a rise of {}%. {}",
                    o.stoppages, if o.stoppages > 1 { "s" } else { "" }, o.last_days, if o.last_days > 1 { "s" } else { "" }, fmt_dec(share, 100),
                    if system_bps > 0 { format!(" and systems doing {}% of our work", fmt_dec(system_bps, 100)) } else { String::new() },
                    usd(takings_per_day.max(0)), usd(willing), fmt_dec(rise, 100),
                    if o.offer_bps > before { format!("Improving our offer to {}%.", fmt_dec(o.offer_bps, 100)) } else { format!("Our offer stays at {}%.", fmt_dec(o.offer_bps, 100)) }
                ),
                vec![offer(&o, "after a stoppage")],
            ));
            self.open = Some(o);
        }
        Bargained { steps, raised }
    }
}

