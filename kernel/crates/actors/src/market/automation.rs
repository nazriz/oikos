//! Automation (gd-adoption's `participants/src/behaviour/automation.ts`, docs/behaviour/automation.md on that branch,
//! decisions entry "Adoption by the numbers"): systems the outside world sells, and how a business decides to take one.
//! Ported from the branch before it merges; whatever it changes before then is changed here.
//!
//! Two halves, both ordinary dealings:
//!
//! * **`world.vendor`**, the outside world's seller of systems (a [`Kind`]). It publishes what it sells (a
//!   `system_offer` for each kind: price, what the system does, its speed and error rate, set-up and exit, term),
//!   delivers a system once the set-up is paid with an order (`system`, the supplier's act), offers the licence as an
//!   agreement the client signs, answers a tender with a bid, and switches a system off when the licence ends or is not
//!   paid for (the supplier's physical power, kernel F4). The technology on offer is the only outside input (a boundary
//!   condition, declared in the manifest); its prices are the outside world's own, held where the profile says so, or
//!   moving at the yearly rate a named scenario gives (`change_bps_per_year`, the *falling-system-prices* scenario's
//!   `-5000`). Nothing sets an adoption rate: a business decides by its own costs and its law.
//! * **A library for the buyer** ([`Fleet`], [`Adoption`], [`appraise`], [`best`], [`dropping`], [`capacity_of`]): what
//!   the retailer and the producer call at integration. This module edits neither (lane C2 owns both and wires them).
//!
//! # The real-world basis of the comparison
//!
//! Automation is task by task: a firm moves a task from labour to capital when that is cheaper (Acemoglu and Restrepo
//! 2019, "Automation and new tasks", *Journal of Economic Perspectives*). Uptake follows an S-curve whose speed rises with
//! how profitable it is and with how many have taken it up (Griliches 1957; Mansfield 1961; Rogers 2003): each client
//! the vendor names eases the hurdle by `reference_bps`. Adoption costs more than the price, reorganising work, which is
//! why set-up is a multiple of the fee (Bresnahan, Brynjolfsson and Hitt 2002; to confirm). Firms ask for a payback of two
//! to three years on equipment (Graham and Harvey 2001; to confirm): `payback_months` 24 for a small firm, 36 for a large.
//! The share of a task a system can do follows task exposure (Eloundou, Manning, Mishkin and Rock 2023; to confirm).
//! [`appraise`] weighs the staff a system frees against its fees, the oversight of the buyer's own staff, its mistakes,
//! and the set-up and the exit spread over the payback horizon; it is worth it when the saving covers that cost by the
//! margin the hurdle asks. [`dropping`] weighs a licence at its term with the set-up sunk. A law in force against the use
//! stops adoption except in the share of cases the firm does not keep it (`compliance_bps`).
//!
//! # Hook points for the retailer (firm.retailer 0.16.0 on gd-adoption) and the producer
//!
//! `git diff port-1b -- participants/src/behaviour/retailer.ts` (and `producer.ts`) on `gd-adoption` is the complete
//! list; in Rust each is a call to this module:
//!
//! 1. **Parameter** `automation: Option<AdoptionParams>` (none: the firm looks at no systems). `Fleet::new(me)` and
//!    `Adoption::new(me, params)` live in the shop's plan; plus `faulty: BTreeMap<order, BTreeSet<item>>`,
//!    `sys_used: BTreeMap<system, seconds today>` and `sys_credit` (the units owed to systems) in the shop.
//! 2. **`absorb`**: `fleet.absorb(&book)` then `adoption.delivered(&fleet)`.
//! 3. **Marginal cost**: `fleet.units_of(task, lastDemand, utilisation_bps)` (`systemUnits`) and `fleet.fees(task)`
//!    (`systemFees`): `marginal = unit_cost + if by_us > 0 && demand > 0 { ceil(((demand - by_us) * labour_cost + fees) / demand) } else { labour_cost }`.
//! 4. **Headcount**: `needed` uses `expected - fleet.units_of(task, expected, util)` (the producer: `peopleNeeded` and
//!    `overStaffed`; its plan adds `fleet.capacity(task, UTILISATION)` to what it can make).
//! 5. **Month's end** (the shop's `p.automation && !operator`; the producer's likewise): `adoption.review(&mut fleet,
//!    &mut book, t, &Review { at, task, facts: Task { units: expected, labour, wage_month, seconds_per_worker_month,
//!    utilisation_bps, unit_price: price, hiring_cost_weeks }, staff, account, balance, keep }, cx)` with
//!    `keep = 2 * workers * monthly + payables.owing` (the producer adds `monthlyUnits(workers) * inputCost`). The
//!    steps carry `AdoptionThen`: the firm's own `Then` has a variant for it and calls `adoption.then(tok, done)`.
//! 6. **Every wake**: `fleet.paperwork(&book, t, account, cx)` signs a licence offered and sets up its fee.
//! 7. **Serving or making**: a system works whatever the hour, within its own day (`sys_used` is cleared each day);
//!    people only on a working day. Each system's units are a separate `work` call `by: [system id]`; an item a system
//!    gets wrong is drawn with [`system_slips`] (`slip(systemsCtx, offer, "<order>.<n>")`: the offer's row in the
//!    table of slips, drawn as a system) and refunded; a refusal of `not_capable`, `participant_inactive`,
//!    `unknown_participant` or `not_theirs` on a system's work calls `fleet.gone(id)`.
//! 8. **Takings** (what a day without the firm's work costs, for the bargaining model: `Takings`, `systemShare`) are
//!    lane D's and C1's: `bargaining` is not in this module.
//!
//! Left out here, as the library leaves them out for a first pass: `OfficeAdoption` and `OfficeDesk` (the rates and
//! planning offices' side, `done_by`, and the tender they send: lane E's, who also holds the procurement law); the
//! vendor does answer a tender with a bid.
//!
//! # Decided in the port (docs/port-guide.md section 2)
//!
//! * **No floats.** `seconds` and `oversight_hours_per_month` can be fractional in TS; here a unit's `seconds` is a whole
//!   number of seconds (a fractional one read from a published offer is rounded to the nearest, half up), and oversight
//!   is whole hours. The `hands` an appraisal frees are held in thousandths of a person (`hands_milli`). Every
//!   `Math.round` is half up on integers; money sums run in `i128` so a large firm cannot overflow.
//! * **A falling price** was `pow(1 + c/10000, months/12)`. It is now the integer twelfth root of the yearly factor
//!   (found by bisection, in parts of 10^12) raised to the whole months gone: the same curve to nine digits, with no
//!   float and the same answer on every machine.
//! * A firm's `units` and `labour` are integers (units a month; seconds a unit), so the smoothed demand the shop reads
//!   from its Lengnick plan is given already rounded.
//! * The firm draws whether it keeps a law against a use from `comply-adopt-<offer>-<month>`, only when a law applies,
//!   as TS did.

use super::trade::{self, Order, OrderBook};
use crate::common::{bases_of, breaches, cites, data, filed_before, money_words, withdraw, Book, DAY, MONTH};
use crate::papers::agreements::{self, Offer as Licence};
use crate::papers::market::{SystemDelivery, SystemEnded, Tender};
use crate::papers::{self, Paper};
use crate::steps::{arg, because, call, pay, say, text, Done, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::slip::{slip_row, Performer, SlipOptions, SlipTable, Slipper};
use oikos_sight::calls::Line;
use oikos_sight::Record;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Number, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub const OFFER: &str = "system_offer";
pub const DELIVERY: &str = "system_delivery";

/// What an order for a system is for: the kind of the order (`system:<offer>`).
pub fn order_kind(offer: &str) -> String {
    format!("system:{offer}")
}

// ------------------------------------------------------------------------------------------------ numbers

/// `Math.round(a / b)` on integers (half up), for `b > 0`.
fn round_div(a: i128, b: i128) -> i128 {
    (2 * a + b).div_euclid(2 * b)
}

/// A JSON number as a whole number: a fractional one is rounded half up (read from its text, with no float).
fn whole(n: &Number) -> i64 {
    if let Some(i) = n.as_i64() {
        return i;
    }
    let s = n.to_string();
    let (neg, s) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.as_str()),
    };
    let (int, frac) = s.split_once('.').unwrap_or((s, ""));
    let base: i64 = int.parse().unwrap_or(0);
    let up = frac.bytes().next().is_some_and(|d| d >= b'5');
    let v = base + i64::from(up);
    if neg {
        -v
    } else {
        v
    }
}

fn rounded<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Number(n) => whole(&n),
        Value::String(s) => s.trim().parse().unwrap_or(0),
        _ => 0,
    })
}

/// A number of basis points as a percentage, as JavaScript printed it (`15` for 1500, `12.5` for 1250).
fn pct(bps: i64) -> String {
    let (w, r) = (bps / 100, bps % 100);
    match r {
        0 => w.to_string(),
        r if r % 10 == 0 => format!("{w}.{}", r / 10),
        r => format!("{w}.{r:02}"),
    }
}

// ------------------------------------------------------------------------------------------------ the offers

/// What the vendor sells, as the profile gives it (prices in the world's smallest unit, today's, held unless a rate
/// moves them). `for` is `firms` (a task a business does: `task`) or `offices` (the papers an office writes: `kinds`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BaseOffer {
    pub id: String,
    pub title: String,
    #[serde(rename = "for")]
    pub for_: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kinds: Vec<String>,
    /// The template its systems are made from (the world's).
    #[serde(default)]
    pub template: String,
    /// Seconds a unit of the task takes it (firms); 0 for offices.
    #[serde(default, deserialize_with = "rounded")]
    pub seconds: i64,
    /// Its speed against a person's, in basis points of a person's time (10,000 is as long as a person takes).
    pub speed_bps: i64,
    /// The share of a task's units it can do (the rest need a person), in basis points.
    pub scope_bps: i64,
    pub setup: i64,
    pub fee_per_year: i64,
    pub exit: i64,
    pub term_days: i64,
    pub notice_days: i64,
    /// Hours a month of the buyer's own staff time that it takes to look after one.
    #[serde(default, deserialize_with = "rounded")]
    pub oversight_hours_per_month: i64,
}

/// An offer as published: the base offer at this month's prices. The paper is [`papers::market::SystemOffer`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Offer {
    #[serde(flatten)]
    pub base: BaseOffer,
    /// How often it gets a unit wrong, in basis points of the units it does (the world's table of slips has the rate).
    #[serde(default)]
    pub error_bps: i64,
    #[serde(default)]
    pub vendor: String,
    #[serde(default)]
    pub account: String,
    #[serde(default)]
    pub fee_month: i64,
    #[serde(default)]
    pub references: i64,
    /// The record it is in, and when it was made (from the record, never published).
    #[serde(skip)]
    pub record: String,
    #[serde(skip)]
    pub at: i64,
}

/// The offers a reader has been shown: the latest of each vendor's kinds, in vendor-and-id order.
pub fn offers_of(book: &Book) -> Vec<Offer> {
    let mut latest: BTreeMap<String, Offer> = BTreeMap::new();
    for r in book.open(OFFER) {
        let Some(vendor) = r.speaks_for.clone() else { continue };
        let Ok(mut o) = serde_json::from_value::<Offer>(data(r).clone()) else { continue };
        if o.base.id.is_empty() || o.base.template.is_empty() {
            continue;
        }
        let key = format!("{vendor}|{}", o.base.id);
        if latest.get(&key).is_some_and(|x| x.at > r.at) {
            continue;
        }
        o.vendor = vendor;
        o.record = r.id.clone();
        o.at = r.at;
        latest.insert(key, o);
    }
    latest.into_values().collect()
}

// ------------------------------------------------------------------------------------------------ the comparison

/// What a business weighs, as its profile gives it (placeholders where unsourced).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdoptionParams {
    /// Months over which the costs of changing must pay back: a small business (under `large_from` staff) and a large one.
    pub payback_months: Payback,
    pub large_from: i64,
    /// How much dearer the system's running costs may come out than the labour it replaces before a business will not
    /// (a margin of safety), in basis points.
    pub hurdle_bps: i64,
    /// Each business already known to use it eases the hurdle by this much (Mansfield 1961), in basis points; never below nothing.
    pub reference_bps: i64,
    /// What staff cost beyond their wage (the law's charges the employer bears), in basis points.
    pub on_cost_bps: i64,
    /// The most systems it would take of one kind at once.
    pub most: i64,
    /// How often it keeps to a law against a use when it would otherwise take one (basis points).
    pub compliance_bps: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Payback {
    pub small: i64,
    pub large: i64,
}

impl Default for AdoptionParams {
    fn default() -> Self {
        AdoptionParams { payback_months: Payback { small: 24, large: 36 }, large_from: 10, hurdle_bps: 2000, reference_bps: 200, on_cost_bps: 0, most: 6, compliance_bps: 10_000 }
    }
}

/// A firm's `automation` parameter as the TS read it: `null` (a world with no vendor): the firm looks at no systems; an
/// object: the profile's figures over the defaults, a key at a time (`{ ...ADOPTION, ...p.automation }`).
pub fn params_from(given: &Value) -> Result<Option<AdoptionParams>, String> {
    let Some(over) = given.as_object() else { return Ok(None) };
    let mut base = serde_json::to_value(AdoptionParams::default()).map_err(|e| e.to_string())?;
    if let Some(b) = base.as_object_mut() {
        for (k, v) in over {
            b.insert(k.clone(), v.clone());
        }
    }
    serde_json::from_value(base).map(Some).map_err(|e| format!("automation: {e}"))
}

/// The facts of the task as the business does it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Task {
    /// Units a month it expects (smoothed).
    pub units: i64,
    /// A person's seconds a unit.
    pub labour: i64,
    /// A person's pay a month (the wage, in the world's smallest unit).
    pub wage_month: i64,
    /// The seconds a worker works in a month.
    pub seconds_per_worker_month: i64,
    pub utilisation_bps: i64,
    /// What a unit sells for (an error is refunded at this).
    pub unit_price: i64,
    /// The weeks of a person's pay that taking one on costs.
    pub hiring_cost_weeks: i64,
}

/// What `appraise` needs of a system on offer, or of one already held.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Terms {
    pub fee_month: i64,
    pub setup: i64,
    pub exit: i64,
    pub seconds: i64,
    pub scope_bps: i64,
    pub error_bps: i64,
    pub oversight_hours_per_month: i64,
    /// Clients the vendor names (0 for a system already held).
    pub references: i64,
}

impl From<&Offer> for Terms {
    fn from(o: &Offer) -> Terms {
        Terms {
            fee_month: o.fee_month,
            setup: o.base.setup,
            exit: o.base.exit,
            seconds: o.base.seconds,
            scope_bps: o.base.scope_bps,
            error_bps: o.error_bps,
            oversight_hours_per_month: o.base.oversight_hours_per_month,
            references: o.references,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Appraisal {
    pub n: i64,
    /// Units a month the systems would do.
    pub units: i64,
    /// Staff-months a month it would free, in thousandths of a person.
    pub hands_milli: i64,
    pub saving: i64,
    pub running: i64,
    pub amortised: i64,
    pub net: i64,
    /// The hurdle used, in basis points.
    pub hurdle_bps: i64,
    pub worth: bool,
}

/// One system's units a month: the month's seconds at the utilisation, over its seconds a unit.
pub fn capacity_of(seconds: i64, utilisation_bps: i64) -> i64 {
    if seconds > 0 {
        MONTH * utilisation_bps / (10_000 * seconds)
    } else {
        0
    }
}

/// The hands that `units` of a task take, as a fraction: `(numerator, denominator)` in persons (units x a person's
/// seconds a unit over a worker's productive seconds a month).
fn hands(units: i64, t: &Task) -> (i128, i128) {
    (i128::from(units) * i128::from(t.labour) * 10_000, (i128::from(t.seconds_per_worker_month) * i128::from(t.utilisation_bps)).max(1))
}

/// The ordinary comparison. With `n` systems of the offer: the staff cost saved (the hands the units they do would have
/// taken, at the wage with its on-costs); against the fees, the oversight hours of its own staff, the errors refunded,
/// and the set-up and the exit spread over the payback `horizon`. It is worth it when the saving covers the cost by the
/// margin the hurdle asks. `standing` is a system already held: its set-up is spent, so only its running cost and its
/// exit are weighed (in [`dropping`]).
pub fn appraise(o: &Terms, n: i64, task: &Task, a: &AdoptionParams, horizon: i64, standing: bool) -> Appraisal {
    let cap = capacity_of(o.seconds, task.utilisation_bps);
    let units = (task.units * o.scope_bps / 10_000).min(n * cap);
    let (hn, hd) = hands(units, task);
    // saving = hands x wage, wage = wage_month x (1 + on-cost)
    let saving = round_div(hn * i128::from(task.wage_month) * i128::from(10_000 + a.on_cost_bps), hd * 10_000);
    // hourly = wage_month x 3600 / seconds_per_worker_month
    let oversight = round_div(i128::from(n) * i128::from(o.oversight_hours_per_month) * i128::from(task.wage_month) * 3600, i128::from(task.seconds_per_worker_month).max(1));
    let errors = round_div(i128::from(units) * i128::from(o.error_bps) * i128::from(task.unit_price), 10_000);
    let running = i128::from(n) * i128::from(o.fee_month) + oversight + errors;
    let spent = if standing { 0 } else { i128::from(n) * i128::from(o.setup) } + i128::from(o.exit);
    let amortised = round_div(spent, i128::from(horizon.max(1)));
    let hurdle = (a.hurdle_bps - a.reference_bps * o.references).max(0);
    let net = saving - running - amortised;
    Appraisal {
        n,
        units,
        hands_milli: round_div(hn * 1000, hd) as i64,
        saving: saving as i64,
        running: running as i64,
        amortised: amortised as i64,
        net: net as i64,
        hurdle_bps: hurdle,
        worth: units > 0 && saving * 10_000 >= (running + amortised) * i128::from(10_000 + hurdle),
    }
}

/// The best number of systems to take of an offer (the most net saving), if any is worth it.
pub fn best(o: &Terms, task: &Task, a: &AdoptionParams, horizon: i64) -> Option<Appraisal> {
    let mut top: Option<Appraisal> = None;
    for n in 1..=a.most {
        let x = appraise(o, n, task, a, horizon, false);
        let enough = x.units >= task.units * o.scope_bps / 10_000; // (more would do no more)
        if x.worth && top.as_ref().is_none_or(|t| x.net > t.net) {
            top = Some(x);
        }
        if enough {
            break;
        }
    }
    top
}

/// What dropping a licence at its term weighs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dropping {
    pub drop: bool,
    pub saving: i64,
    pub running: i64,
    pub leaving: i64,
}

/// Whether to end a licence that has run its term: the running cost against what it saves, with the cost of leaving and
/// of taking people on again.
pub fn dropping(l: &Lot, task: &Task, a: &AdoptionParams, horizon: i64) -> Dropping {
    let t = Terms { fee_month: l.fee_month, setup: 0, exit: 0, seconds: l.seconds, scope_bps: l.scope_bps, error_bps: l.error_bps, oversight_hours_per_month: l.oversight_hours_per_month, references: 0 };
    let x = appraise(&t, l.systems.len() as i64, task, a, horizon, true);
    // rehire = hands x (wage_month x 12 / 52) x hiring_cost_weeks
    let (hn, hd) = hands(x.units, task);
    let rehire = round_div(hn * i128::from(task.wage_month) * 12 * i128::from(task.hiring_cost_weeks), hd * 52);
    let leaving = i128::from(l.exit) + rehire;
    Dropping { drop: i128::from(x.running - x.saving) * i128::from(horizon) > leaving, saving: x.saving, running: x.running, leaving: leaving as i64 }
}

// ------------------------------------------------------------------------------------------------ the buyer's fleet

/// A delivery of systems to this business, with the licence that keeps them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lot {
    pub delivery: String,
    pub order: String,
    pub offer: String,
    pub vendor: String,
    pub account: String,
    pub task: Option<String>,
    pub kinds: Vec<String>,
    pub title: String,
    pub systems: Vec<String>,
    pub seconds: i64,
    pub scope_bps: i64,
    pub error_bps: i64,
    pub fee_month: i64,
    pub exit: i64,
    pub term_days: i64,
    pub notice_days: i64,
    pub oversight_hours_per_month: i64,
    pub setup: i64,
    pub since: i64,
    pub agreement: Option<String>,
    pub ending: bool,
    pub ended: bool,
}

/// A system that is working, with the seconds a unit takes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Working {
    pub id: String,
    pub seconds: i64,
    pub scope_bps: i64,
    /// The offer it came from (its row in the table of slips).
    pub offer: String,
}

/// What a business has been delivered, and its licences: from its own papers (the vendor's delivery, the agreement).
/// Saved with the actor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fleet {
    me: String,
    /// Deliveries in the order they came.
    lots: Vec<Lot>,
    /// Systems that refused or ended.
    dead: BTreeSet<String>,
    signed: BTreeSet<String>,
}

impl Fleet {
    pub fn new(me: &str) -> Fleet {
        Fleet { me: me.to_string(), ..Default::default() }
    }

    pub fn absorb(&mut self, book: &Book) {
        for r in book.all(DELIVERY) {
            if !crate::common::addressed_to(r).contains(&self.me) || self.lots.iter().any(|l| l.delivery == r.id) {
                continue;
            }
            let Some(d) = papers::read::<SystemDelivery>(r) else { continue };
            self.lots.push(Lot {
                delivery: r.id.clone(),
                order: d.order,
                offer: d.offer,
                vendor: d.vendor,
                account: d.account,
                task: d.task,
                kinds: d.kinds,
                title: d.title,
                systems: d.systems,
                seconds: whole(&d.seconds),
                scope_bps: d.scope_bps,
                error_bps: d.error_bps,
                fee_month: d.fee_month,
                exit: d.exit,
                term_days: d.term_days,
                notice_days: d.notice_days,
                oversight_hours_per_month: whole(&d.oversight_hours_per_month),
                setup: d.setup,
                since: r.at,
                agreement: None,
                ending: false,
                ended: false,
            });
        }
        for lot in &mut self.lots {
            let a = book.of_type("agreement").find(|x| cites(x, &lot.order) && agreements::template_of(x) == Some("licence") && agreements::parties_of(x).contains(&self.me));
            if let Some(a) = a {
                lot.agreement = Some(a.id.clone());
            }
            let ended_by_vendor = book.all("system_ended").any(|r| data(r).get("order").and_then(Value::as_str) == Some(lot.order.as_str()) && crate::common::addressed_to(r).contains(&self.me));
            lot.ended = lot.agreement.as_deref().is_some_and(|a| book.signed_by(a, &self.me) && !book.in_force(a)) || ended_by_vendor;
        }
    }

    fn alive(&self, l: &Lot) -> bool {
        !l.ended && l.systems.iter().any(|s| !self.dead.contains(s))
    }

    /// Its lots in service (delivered and not ended), for a task, or all (`None`).
    pub fn in_service(&self, task: Option<&str>) -> Vec<&Lot> {
        self.lots.iter().filter(|l| self.alive(l) && task.is_none_or(|t| l.task.as_deref() == Some(t))).collect()
    }
    pub fn all(&self) -> &[Lot] {
        &self.lots
    }

    /// The systems of a task that are working, with the seconds a unit takes each.
    pub fn working(&self, task: &str) -> Vec<Working> {
        self.in_service(Some(task))
            .into_iter()
            .flat_map(|l| l.systems.iter().filter(|s| !self.dead.contains(*s)).map(|id| Working { id: id.clone(), seconds: l.seconds, scope_bps: l.scope_bps, offer: l.offer.clone() }))
            .collect()
    }

    /// A system the world refused to work (it has been switched off): not counted again.
    pub fn gone(&mut self, id: &str) {
        self.dead.insert(id.to_string());
    }

    /// What our systems do of `units` a month: the share they can do, as far as their month's seconds go
    /// (`systemUnits`).
    pub fn units_of(&self, task: &str, units: i64, utilisation_bps: i64) -> i64 {
        let w = self.working(task);
        if w.is_empty() {
            return 0;
        }
        let top = w.iter().map(|s| s.scope_bps).max().unwrap_or(0);
        (units * top / 10_000).min(self.capacity(task, utilisation_bps))
    }

    /// The units a month all our working systems of a task could do.
    pub fn capacity(&self, task: &str, utilisation_bps: i64) -> i64 {
        self.working(task).iter().map(|s| capacity_of(s.seconds, utilisation_bps)).sum()
    }

    /// The monthly fees of the licences in service for a task (`systemFees`).
    pub fn fees(&self, task: &str) -> i64 {
        self.in_service(Some(task)).iter().map(|l| l.fee_month * l.systems.len() as i64).sum()
    }

    /// The licences offered to us: signed, with the fee set up to be paid each month.
    pub fn paperwork<T>(&mut self, book: &Book, from: &str, cx: &Cx) -> Vec<Step<T>> {
        let mut steps = vec![];
        for lot in &self.lots {
            let Some(id) = lot.agreement.clone() else { continue };
            if lot.ended || self.signed.contains(&id) || book.signed_by(&id, &self.me) || book.taken_back(&id) {
                continue;
            }
            let Some(a) = book.get(&id).filter(|a| agreements::template_of(a).is_some()) else { continue };
            self.signed.insert(id.clone());
            let fee = agreements::commitment_of(a, &self.me).0.and_then(|o| o.money).map_or(lot.fee_month * lot.systems.len() as i64, |m| m.amount);
            steps.push(because(
                format!("The licence of {} {} ({id}) is as ordered: signing it, and setting up its fee of {} a month.", lot.systems.len(), lot.title, money_words(fee, &cx.ctx.world)),
                vec![
                    agreements::sign(&id),
                    pay(&lot.account, fee, Pay { from: Some(from.to_string()), every: Some(MONTH), first: Some(MONTH), for_: Some(format!("Licence {id}")), basis: Some(id.clone()), ..Default::default() }, cx),
                ],
            ));
        }
        steps
    }

    /// Giving notice of leaving a licence: the notice, the exit cost, and its fee's standing order taken down.
    pub fn leave<T>(&mut self, book: &Book, delivery: &str, from: &str, why: &str, cx: &Cx) -> Vec<Step<T>> {
        let Some(lot) = self.lots.iter_mut().find(|l| l.delivery == delivery) else { return vec![] };
        let Some(agreement) = lot.agreement.clone() else { return vec![] };
        if lot.ending {
            return vec![];
        }
        lot.ending = true;
        let orders: Vec<String> = book
            .open("request")
            .filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str()) && data(r).get("every").is_some_and(|e| !e.is_null() && e != &json!(0)) && bases_of(r).contains(&agreement))
            .map(|r| r.id.clone())
            .collect();
        let mut calls = vec![agreements::notice(&agreement, &format!("We are ending the licence of {}.", lot.title))];
        if lot.exit > 0 {
            calls.push(pay(&lot.account, lot.exit, Pay { from: Some(from.to_string()), for_: Some(format!("Exit of licence {agreement}.")), ..Default::default() }, cx));
        }
        calls.extend(orders.iter().map(|o| withdraw(o, Some("The licence is ending."))));
        vec![because(why, calls)]
    }
}

/// Performing as a system (a system's row in the table of slips is its own, whoever is drawing): wraps the firm's `Cx`.
pub struct AsSystem<'a, 'b>(pub &'a mut Cx<'b>);

impl Slipper for AsSystem<'_, '_> {
    fn rng(&mut self, purpose: &str) -> oikos_core::rng::Rng {
        self.0.rng(purpose)
    }
    fn performer(&self) -> Performer {
        Performer::System
    }
    fn slip_table(&self) -> Option<&SlipTable> {
        self.0.ctx.world.slip.as_ref()
    }
    fn friction_bps(&self) -> i64 {
        self.0.friction_bps()
    }
}

/// Whether a system of this offer gets this case wrong (`slip(systemsCtx, offer, case)`): the case is named by the order
/// and the item (`<order>.<n>`).
pub fn system_slips(cx: &mut Cx, offer: &str, case: &str) -> bool {
    oikos_rules::slip::slip(&mut AsSystem(cx), offer, case, &SlipOptions::default())
}

// ------------------------------------------------------------------------------------------------ the buyer's side

/// What a review needs of the firm.
#[derive(Debug, Clone)]
pub struct Review {
    /// Where the systems are delivered to (the premises or the works); absent: the firm itself.
    pub at: Option<String>,
    pub task: String,
    pub facts: Task,
    pub staff: i64,
    pub account: String,
    pub balance: i64,
    /// What it must keep after paying for the set-up (wages and stock it owes).
    pub keep: i64,
}

/// What follows from the order step: if refused, the offer is no longer one it has an order out for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AdoptionThen {
    Ordered { offer: String },
}

/// The business's own side: weighing the offers on its review day, and ordering. Saved with the actor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Adoption {
    me: String,
    a: AdoptionParams,
    /// Offers it has an order out for, until the delivery comes.
    placed: BTreeSet<String>,
}

impl Adoption {
    pub fn new(me: &str, a: AdoptionParams) -> Adoption {
        Adoption { me: me.to_string(), a, placed: BTreeSet::new() }
    }

    pub fn horizon(&self, staff: i64) -> i64 {
        if staff >= self.a.large_from {
            self.a.payback_months.large
        } else {
            self.a.payback_months.small
        }
    }

    /// What it does at a review: end a licence that has run its term and does not pay, or take the best system on
    /// offer for its task.
    pub fn review<T: From<AdoptionThen>>(&mut self, fleet: &mut Fleet, book: &mut Book, t: i64, o: &Review, cx: &mut Cx) -> Vec<Step<T>> {
        let mut steps: Vec<Step<T>> = vec![];
        let horizon = self.horizon(o.staff);
        let money = |n: i64| money_words(n, &cx.ctx.world);
        let due: Vec<(String, Dropping, String, usize)> = fleet
            .in_service(Some(&o.task))
            .into_iter()
            .filter(|l| !l.ending && l.agreement.as_deref().is_some_and(|a| book.signed_by(a, &self.me)) && t >= l.since + l.term_days * DAY)
            .map(|l| (l.delivery.clone(), dropping(l, &o.facts, &self.a, horizon), l.title.clone(), l.systems.len()))
            .collect();
        for (delivery, d, title, n) in due {
            if d.drop {
                let why = format!(
                    "The licence of {n} {title} has run its term and costs {} a month against {} of staff it saves, over {horizon} months more than the {} it costs to leave and take people on again: ending it.",
                    money(d.running),
                    money(d.saving),
                    money(d.leaving)
                );
                steps.extend(fleet.leave(book, &delivery, &o.account, &why, cx));
            }
        }
        let holding = fleet.in_service(Some(&o.task)).len() + self.placed.len();
        if holding > 0 || o.facts.units <= 0 {
            return steps;
        }
        let mut top: Option<(Offer, Appraisal)> = None;
        for f in offers_of(book) {
            if f.base.for_ != "firms" || f.base.task.as_deref() != Some(o.task.as_str()) {
                continue;
            }
            let Some(x) = best(&Terms::from(&f), &o.facts, &self.a, horizon) else { continue };
            let cash = o.balance - o.keep - x.n * f.base.setup;
            let act = json!({ "block": "deploy", "task": f.base.task, "offer": f.base.id, "vendor": f.vendor });
            let law = !breaches(book, &act, &self.me, t).is_empty();
            // (A law against the use stops it, except in the share of cases the firm does not keep the law.)
            if cash < x.n * f.fee_month || (law && cx.rng(&format!("comply-adopt-{}-{}", f.base.id, t / MONTH)).below(10_000) < self.a.compliance_bps.max(0) as u64) {
                continue;
            }
            if top.as_ref().is_none_or(|(_, y)| x.net > y.net) {
                top = Some((f, x));
            }
        }
        let Some((f, x)) = top else { return steps };
        self.placed.insert(f.base.id.clone());
        let why = format!(
            "Taking {} {}: they would do {} of the {} {} units a month, freeing {} hands ({} a month) for {} a month in fees, oversight and errors, and {} to set up and {} to leave, spread over {horizon} months ({} a month): worth it by {}%, where {}% is asked ({} clients so far).",
            x.n,
            f.base.title,
            x.units,
            o.facts.units,
            o.task,
            tenths(x.hands_milli),
            money(x.saving),
            money(x.running),
            money(x.n * f.base.setup),
            money(f.base.exit),
            money(x.amortised),
            (round_div(i128::from(x.saving) * 100, i128::from((x.running + x.amortised).max(1))) - 100),
            pct(x.hurdle_bps),
            f.references
        );
        let mut st = trade::order::<T>(
            &trade::Ordering {
                me: self.me.clone(),
                seller: f.vendor.clone(),
                seller_account: f.account.clone(),
                kind: order_kind(&f.base.id),
                quantity: x.n,
                unit_price: f.base.setup,
                to: None,
                at: o.at.clone().unwrap_or_else(|| self.me.clone()),
                from: o.account.clone(),
                why,
                retry_of: None,
                for_days: None,
                terms: None,
            },
            cx,
        );
        st.then = Some(T::from(AdoptionThen::Ordered { offer: f.base.id }));
        steps.push(st);
        steps
    }

    /// The order step's outcome.
    pub fn then(&mut self, tok: &AdoptionThen, done: Done) {
        let AdoptionThen::Ordered { offer } = tok;
        if !done.applied() {
            self.placed.remove(offer);
        }
    }

    /// A delivery came: the order for it is no longer out.
    pub fn delivered(&mut self, fleet: &Fleet) {
        self.placed.retain(|id| !fleet.all().iter().any(|l| &l.offer == id && !l.ended));
    }
}

/// Hands as tenths of a person to one decimal place (`toFixed(1)`), from thousandths.
fn tenths(milli: i64) -> String {
    let t = (milli + 50).div_euclid(100);
    format!("{}.{}", t / 10, t % 10)
}

// ------------------------------------------------------------------------------------------------ the vendor

/// The behaviour doc. `docs/behaviour/automation.md` exists only on gd-adoption (unmerged), and the backstop wants the
/// doc to exist, so this points at the outside world's doc until that branch merges: **at integration, change it to
/// `docs/behaviour/automation.md`** (it is what the TS manifest names).
const MANIFEST_DOC: &str = "docs/behaviour/automation.md";

const OUTSIDE: &str = "The technology on offer is the outside world's: which tasks systems can do, at what price, in what time, with what error and what terms, as vendors beyond the town sell them. It is a fact about the world beyond the town, as world prices are, held in the profile with its source; this module stands for it at the world's edge. Nothing in the town can know or change it otherwise, and nothing here sets an adoption rate.";

pub struct Vendor;

impl Kind for Vendor {
    fn name(&self) -> &'static str {
        "world.vendor"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        MANIFEST_DOC
    }
    fn manifest(&self) -> Value {
        let p = |schema: Value, default: Option<Value>, unit: Option<&str>, source: &str| {
            let mut m = json!({ "schema": schema, "source": source });
            if let Some(d) = default {
                m["default"] = d;
            }
            if let Some(u) = unit {
                m["unit"] = json!(u);
            }
            m
        };
        let int = |what: &str| json!({ "type": "integer", "description": what });
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "account": p(json!({ "type": "string", "description": "the outside's account it is paid into (the world must say)" }), Some(json!("")), None, "the outside's account it is paid into (the world must say)"),
                "automation": p(json!({}), None, None, "the world gives it (no default)"),
                "casework": p(json!({}), None, None, "the world gives it (no default)"),
                "change_bps_per_year": p(int("how its prices move a year (negative: fall); 0: today's prices held"), Some(json!(0)), None, "placeholder"),
                "grace_days": p(int("a licence unpaid this long (two months' fees and a fortnight) lets the vendor switch the system off"), Some(json!(75)), Some("days"), "placeholder"),
                "most_systems": p(int("the most it delivers to one order"), Some(json!(40)), None, "placeholder"),
                "offers": p(json!({ "type": "array" }), Some(json!([])), None, "placeholder"),
                "procurement": p(json!({}), None, None, "the world gives it (no default)"),
                "sign_days": p(int("a system whose licence its client has not signed this long is switched off"), Some(json!(30)), Some("days"), "placeholder"),
                "unpaid_days": p(int("an order unpaid this long is declined"), Some(json!(7)), Some("days"), "placeholder"),
            },
            "perceives": [], "state": "none",
            "boundary": [{ "what": "technology on offer", "why": OUTSIDE }],
            "answers": { "office": "the vendor of systems", "acts": "It publishes what it sells, delivers a system once its set-up is paid with an order, offers the licence, bids on a tender, and switches a system off when the licence ends or is not paid for. It takes no requests." },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        0
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params {
            account: ctx.need("account", "world.vendor")?,
            offers: ctx.param("offers", vec![])?,
            change_bps_per_year: ctx.param("change_bps_per_year", 0)?,
            unpaid_days: ctx.param("unpaid_days", 7)?,
            sign_days: ctx.param("sign_days", 30)?,
            grace_days: ctx.param("grace_days", 75)?,
            most_systems: ctx.param("most_systems", 40)?,
        };
        let ratio = monthly_ratio(p.change_bps_per_year);
        Ok(Box::new(Stepper::new(Selling {
            orders: OrderBook::new(&ctx.entity, Some(p.unpaid_days), None),
            me: ctx.entity.clone(),
            p,
            ratio,
            book: Book::new(),
            listed: BTreeMap::new(),
            licences: vec![],
            clients: BTreeMap::new(),
            answered: BTreeSet::new(),
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Selling>::restore(saved)?))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    account: String,
    offers: Vec<BaseOffer>,
    change_bps_per_year: i64,
    unpaid_days: i64,
    sign_days: i64,
    grace_days: i64,
    most_systems: i64,
}

const S: u128 = 1_000_000_000_000;

/// The factor a month's price steps by, in parts of 10^12: the twelfth root of the yearly factor
/// `max(0.0001, 1 + change/10000)`, by bisection (the largest ratio whose twelfth power does not pass it).
fn monthly_ratio(change_bps: i64) -> u128 {
    let target = u128::from((10_000 + change_bps).max(1) as u64) * S / 10_000;
    let pow12 = |r: u128| (0..12).fold(S, |v, _| v * r / S);
    let (mut lo, mut hi) = (0u128, 10 * S);
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if pow12(mid) <= target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

/// A licence the vendor has granted.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Granted {
    order: String,
    delivery: Option<String>,
    buyer: String,
    offer: String,
    systems: Vec<String>,
    since: i64,
    agreement: Option<String>,
    last_paid: i64,
    retired: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Then {
    /// An offer published: its id is kept to be withdrawn when it is published again.
    Listed { offer: String, key: String },
    /// Systems delivered to a paid order: what follows is the delivery paper and the licence.
    Delivered { order: Order, offer: Offer },
    /// The delivery paper published: its id is the licence's.
    Noted { order: String },
}

#[derive(Serialize, Deserialize)]
struct Selling {
    me: String,
    p: Params,
    ratio: u128,
    book: Book,
    orders: OrderBook,
    /// Offer -> what it last published: its key (prices and clients) and its record.
    listed: BTreeMap<String, (String, Option<String>)>,
    licences: Vec<Granted>,
    /// Offer -> those who have licences (its references).
    clients: BTreeMap<String, BTreeSet<String>>,
    /// Tenders we have bid for.
    answered: BTreeSet<String>,
}

impl Selling {
    fn price_at(&self, t: i64) -> impl Fn(i64) -> i64 {
        let months = (t / MONTH).max(0);
        let factor = (0..months).fold(S, |v, _| v * self.ratio / S);
        move |x| ((u128::try_from(x.max(0)).unwrap_or(0) * factor + S / 2) / S).max(1) as i64
    }

    /// An offer at this month's prices, with the clients it has and the rate the table of slips gives.
    fn now_offer(&self, o: &BaseOffer, t: i64, cx: &Cx) -> Offer {
        let price = self.price_at(t);
        let fee_year = price(o.fee_per_year);
        let error_bps = slip_row(cx, &o.id).map_or(0, |r| r.bps);
        Offer {
            base: BaseOffer { setup: price(o.setup), exit: price(o.exit), fee_per_year: fee_year, ..o.clone() },
            error_bps,
            vendor: self.me.clone(),
            account: self.p.account.clone(),
            fee_month: (round_div(i128::from(fee_year), 12) as i64).max(1),
            references: self.clients.get(&o.id).map_or(0, |c| c.len() as i64),
            record: String::new(),
            at: t,
        }
    }

    fn words(&self, o: &Offer, cx: &Cx) -> String {
        let money = |n: i64| money_words(n, &cx.ctx.world);
        let b = &o.base;
        format!(
            "{}: {}, at {}% of a person's time a unit, for {}% of the units; an error {}% of the time. Set-up {} each, {} a month, {}-day licence ({} days' notice), {} to leave. Order {}, paid with the order. {} client{}.",
            b.title,
            if b.for_ == "firms" { format!("does the task \"{}\"", b.task.clone().unwrap_or_default()) } else { format!("writes {}", b.kinds.join(", ")) },
            pct(b.speed_bps),
            pct(b.scope_bps),
            pct(o.error_bps),
            money(b.setup),
            money(o.fee_month),
            b.term_days,
            b.notice_days,
            money(b.exit),
            order_kind(&b.id),
            o.references,
            if o.references == 1 { "" } else { "s" }
        )
    }

    /// The paper that goes with a delivery of `ids`.
    fn delivery_step(&self, o: &Order, x: &Offer, ids: &[String], cx: &Cx) -> Step<Then> {
        let money = |n: i64| money_words(n, &cx.ctx.world);
        let b = &x.base;
        let fee = x.fee_month * ids.len() as i64;
        let paper = SystemDelivery {
            order: o.id.clone(),
            offer: b.id.clone(),
            vendor: self.me.clone(),
            account: self.p.account.clone(),
            for_: b.for_.clone(),
            task: b.task.clone(),
            kinds: b.kinds.clone(),
            template: b.template.clone(),
            title: b.title.clone(),
            seconds: b.seconds.into(),
            speed_bps: b.speed_bps,
            scope_bps: b.scope_bps,
            error_bps: x.error_bps,
            systems: ids.to_vec(),
            fee_month: x.fee_month,
            exit: b.exit,
            term_days: b.term_days,
            notice_days: b.notice_days,
            oversight_hours_per_month: b.oversight_hours_per_month.into(),
            setup: b.setup,
        };
        let plural = if ids.len() == 1 { "" } else { "s" };
        let mut agree = agreements::offer(
            &o.buyer,
            Licence {
                template: "licence".into(),
                term: Some(b.term_days * DAY),
                periodic: true,
                our_notice: Some(b.notice_days * DAY),
                their_notice: Some(b.notice_days * DAY),
                basis: Some(o.id.clone()),
                they: Some(pay(&self.p.account, fee, Pay { every: Some(MONTH), for_: Some(format!("Licence of {}.", b.title)), ..Default::default() }, cx)),
                text: Some(format!(
                    "Licence of {} of {} to {}: {} a month, {} days, {} days' notice either way; {} to leave. Systems: {}.",
                    ids.len(),
                    b.title,
                    o.buyer,
                    money(fee),
                    b.term_days,
                    b.notice_days,
                    money(b.exit),
                    ids.join(", ")
                )),
                ..Default::default()
            },
        );
        agree.args.push(("we_do".into(), text(format!("{} keeps the {} system{plural} running ({}), and may switch them off if the fee is not paid.", self.me, ids.len(), ids.join(", ")))));
        let note = say(
            DELIVERY,
            &format!("Delivered to {}: {} of {} ({}), under licence at {} a month.", o.buyer, ids.len(), b.title, ids.join(", "), money(fee)),
            Say { to: Some(vec![o.buyer.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), o.buyer.clone()])), basis: Some(o.id.clone()), data: Some(papers::data(&paper)), ..Default::default() },
        );
        let mut s = Step::new(vec![Line { bind: Some("delivery".into()), call: note }, Line { bind: None, call: agree }]);
        s.why = Some(format!("Delivered {} of {} to {}: publishing the delivery and offering the licence.", ids.len(), b.title, o.buyer));
        s.then(Then::Noted { order: o.id.clone() })
    }
}

impl Plan for Selling {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.orders.take(pic, Some(self.p.account.as_str()).filter(|a| !a.is_empty()));
        for tx in pic.transactions() {
            // "Licence <agreement>." paid into our account: the licence is paid.
            let Some(rest) = tx.memo.as_deref().and_then(|m| m.strip_prefix("Licence ")) else { continue };
            let id = rest.strip_suffix('.').unwrap_or(rest);
            if tx.to == self.p.account && !id.is_empty() && !id.contains(char::is_whitespace) {
                for l in &mut self.licences {
                    if l.agreement.as_deref() == Some(id) {
                        l.last_paid = pic.t;
                    }
                }
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let t = pic.t;
        let mut steps: Vec<Step<Then>> = vec![];
        let money = |n: i64| money_words(n, &cx.ctx.world);
        // What it sells, at this month's prices: published again when they move.
        for o in self.p.offers.clone() {
            let x = self.now_offer(&o, t, cx);
            let key = format!("{}|{}|{}|{}", x.base.setup, x.fee_month, x.base.exit, x.references);
            let was = self.listed.get(&o.id).cloned();
            if was.as_ref().is_some_and(|(k, _)| *k == key) {
                continue;
            }
            self.listed.insert(o.id.clone(), (key.clone(), was.as_ref().and_then(|(_, id)| id.clone())));
            let mut lines = vec![];
            if let Some((_, Some(old))) = &was {
                lines.push(Line { bind: None, call: withdraw(old, Some("Superseded.")) });
            }
            lines.push(Line { bind: Some("listed".into()), call: say(OFFER, &self.words(&x, cx), Say { visible: Some(Visible::Public), data: serde_json::to_value(&x).ok(), ..Default::default() }) });
            let mut st = Step::new(lines).then(Then::Listed { offer: o.id.clone(), key });
            st.why = Some(if was.is_some() { format!("Our prices or clients have changed: publishing {} again.", o.title) } else { format!("What we sell: {}.", o.title) });
            steps.push(st);
        }
        // Orders paid in full: deliver the systems, then offer the licence.
        let due = self.orders.due(&self.book, t, |_| true);
        for o in due.paid {
            let id = o.kind.strip_prefix("system:").unwrap_or("");
            let base = self.p.offers.iter().find(|x| x.id == id).cloned();
            let x = base.as_ref().map(|b| self.now_offer(b, t, cx));
            let total = o.total();
            let ok = x.as_ref().is_some_and(|x| o.unit_price >= x.base.setup && o.quantity >= 1 && o.quantity <= self.p.most_systems);
            let Some(x) = x.filter(|_| ok) else {
                steps.push(because(
                    format!("An order for {} that is not one we can fill at the price asked: refunding it.", o.kind),
                    vec![pay(&o.account, total, Pay { from: Some(self.p.account.clone()), for_: Some(format!("Refund: {} is not on offer at {}.", o.kind, money(o.unit_price))), ..Default::default() }, cx)],
                ));
                continue;
            };
            let lines: Vec<Line> = (0..o.quantity)
                .map(|i| Line {
                    bind: Some(format!("sys{i}")),
                    call: call("system", vec![("template", Some(arg(&x.base.template))), ("to", Some(arg(&o.buyer))), ("title", Some(text(x.base.title.clone())))]),
                })
                .collect();
            let mut st = Step::new(lines).then(Then::Delivered { order: o.clone(), offer: x.clone() });
            st.why = Some(format!("{} has paid {} to set up {} of {}: delivering.", o.buyer, money(total), o.quantity, x.base.title));
            steps.push(st);
        }
        // Tenders (a public body's request for bids): a bid for each of our offers for offices that does what it asks.
        let tenders: Vec<(String, String, Tender)> = self
            .book
            .open(Tender::KIND)
            .filter(|r| !self.answered.contains(&r.id) && r.speaks_for.is_some())
            .filter_map(|r| papers::read::<Tender>(r).filter(|d| d.closes >= t).map(|d| (r.id.clone(), r.speaks_for.clone().unwrap_or_default(), d)))
            .collect();
        for (id, by, d) in tenders {
            self.answered.insert(id.clone());
            for base in &self.p.offers {
                if base.for_ != "offices" || d.kinds.is_empty() || !d.kinds.iter().all(|k| base.kinds.contains(k)) {
                    continue;
                }
                let x = self.now_offer(base, t, cx);
                let mut bid = serde_json::to_value(&x).unwrap_or(Value::Null);
                bid["tender"] = json!(id);
                steps.push(because(
                    format!("{by} has invited bids to {}: bidding {}.", d.what, x.base.title),
                    vec![say(
                        "bid",
                        &format!(
                            "Bid to {by} for tender {id}: {}, {} to set up each, {} a month each, {} to leave, {} days.",
                            x.base.title,
                            money(x.base.setup),
                            money(x.fee_month),
                            money(x.base.exit),
                            x.base.term_days
                        ),
                        Say { to: Some(vec![by.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), by.clone()])), basis: Some(id.clone()), data: Some(bid), ..Default::default() },
                    )],
                ));
            }
        }
        for o in due.unpaid {
            steps.push(trade::decline(&o, &self.me, "An order unpaid for a week: declining it."));
        }
        for (a, x) in self.orders.unclaimed(&self.book) {
            self.orders.refunded(&a);
            steps.push(trade::send_back(&a, x, &self.p.account, cx));
        }
        // Licences: the agreement we offered, and whether it stands. A system whose licence is unsigned, ended or unpaid is switched off.
        let mut order_ids: Vec<usize> = (0..self.licences.len()).collect();
        order_ids.sort_by(|a, b| filed_before(&self.licences[*a].order, &self.licences[*b].order));
        for i in order_ids {
            let l = self.licences[i].clone();
            if l.retired {
                continue;
            }
            let a: Option<Arc<Record>> = match &l.agreement {
                Some(id) => self.book.get(id).cloned(),
                None => self.book.of_type("agreement").find(|r| cites(r, &l.order) && agreements::template_of(r) == Some("licence")).cloned(),
            };
            if let (Some(a), None) = (&a, &l.agreement) {
                self.licences[i].agreement = Some(a.id.clone());
            }
            let unsigned = format!("{} has not signed the licence in {} days", l.buyer, self.p.sign_days);
            let waited = t - l.since >= self.p.sign_days * DAY;
            let why = match &a {
                None => waited.then(|| unsigned.clone()),
                Some(a) if self.book.taken_back(&a.id) => Some("the licence offer was taken back".to_string()),
                Some(a) if !self.book.signed_by(&a.id, &l.buyer) => waited.then(|| unsigned.clone()),
                Some(a) if !self.book.in_force(&a.id) => Some("the licence has ended".to_string()),
                Some(_) if t - l.last_paid >= self.p.grace_days * DAY => Some(format!("the licence fee has not been paid for {} days", (t - l.last_paid) / DAY)),
                Some(_) => None,
            };
            let Some(why) = why else { continue };
            self.licences[i].retired = true;
            let plural = if l.systems.len() == 1 { "" } else { "s" };
            let mut calls: Vec<_> = l.systems.iter().map(|s| call("system", vec![("retire", Some(arg(s)))])).collect();
            let ended = SystemEnded { delivery: l.delivery.clone(), order: l.order.clone(), systems: l.systems.clone(), why: why.clone() };
            calls.push(say(
                SystemEnded::KIND,
                &format!("The licence of {} has ended ({why}): switched off.", l.systems.join(", ")),
                Say {
                    to: Some(vec![l.buyer.clone()]),
                    visible: Some(Visible::Only(vec![self.me.clone(), l.buyer.clone()])),
                    basis: Some(l.delivery.clone().unwrap_or_else(|| l.order.clone())),
                    data: Some(papers::data(&ended)),
                    ..Default::default()
                },
            ));
            steps.push(because(format!("Switching off {} system{plural} at {}: {why}.", l.systems.len(), l.buyer), calls));
        }
        steps
    }

    fn then(&mut self, tok: &Then, done: Done, cx: &mut Cx) -> Vec<Step<Then>> {
        let Done::Outcome(out) = done else {
            // (A delivery never sent: the money goes back.)
            if let Then::Delivered { order: o, .. } = tok {
                return vec![self.refund_delivery(o, cx)];
            }
            return vec![];
        };
        match tok {
            Then::Listed { offer, key } => {
                if let Some(id) = out.created.as_ref().and_then(|c| c.get("listed")) {
                    self.listed.insert(offer.clone(), (key.clone(), Some(id.clone())));
                }
                vec![]
            }
            Then::Delivered { order: o, offer: x } => {
                if !done.applied() {
                    return vec![self.refund_delivery(o, cx)];
                }
                let ids: Vec<String> = (0..o.quantity).filter_map(|i| out.created.as_ref().and_then(|c| c.get(&format!("sys{i}"))).cloned()).collect();
                self.clients.entry(x.base.id.clone()).or_default().insert(o.buyer.clone());
                self.licences.push(Granted { order: o.id.clone(), delivery: None, buyer: o.buyer.clone(), offer: x.base.id.clone(), systems: ids.clone(), since: out.t, agreement: None, last_paid: out.t, retired: false });
                vec![self.delivery_step(o, x, &ids, cx)]
            }
            Then::Noted { order } => {
                if let Some(id) = out.created.as_ref().and_then(|c| c.get("delivery")) {
                    if let Some(l) = self.licences.iter_mut().find(|l| &l.order == order) {
                        l.delivery = Some(id.clone());
                    }
                }
                vec![]
            }
        }
    }
}

impl Selling {
    fn refund_delivery(&self, o: &Order, cx: &Cx) -> Step<Then> {
        because(
            format!("The delivery to {} was refused: sending the money back.", o.buyer),
            vec![pay(&o.account, o.total(), Pay { from: Some(self.p.account.clone()), for_: Some("Refund: we could not deliver.".into()), ..Default::default() }, cx)],
        )
    }
}

#[cfg(test)]
mod tests;
