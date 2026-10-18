//! firm.landlord: a letting office (ported from participants/src/behaviour/firms.ts, `landlord`, 0.19.0; after the
//! of the BoE housing model, Baptista et al. 2016; docs/behaviour/firms.md, justice.md "Possession", frictions.md,
//! firm-wants.md, building.md). It lists vacant homes at a markup over its going rent, cuts the asking rent each month a
//! listing goes unlet, picks among applicants at random, lets for 12 to 24 months, offers the sitting tenant a new lease
//! as the old one runs out, reviews rents, takes up arrears (a letter, an application to a body that hears them, a notice
//! to vacate and, under the world's law on possession, an application to the tribunal, a plan to pay, an order and a
//! warrant it buys from the registrar: it never puts anyone out itself), reports a tenant's death, orders the repair of a
//! home in disrepair, builds more homes (a permit, the builder, the invoice), and spends, taxes and keeps a record.
//!
//! Changes made in the port (the rest is the TS rule step for step):
//! - **Rents at review follow the market** (`oikos_rules::rent`: risks ME-14, A-4; docs/behaviour/firms.md, "Rent
//!   reviews follow the market"). The old review was the landlord's own going rent plus a fixed `markup_bps`, so each
//!   review raised the next and no rent fell. A review now reads the evidence the landlord has of comparable homes (same
//!   building and size): what it has let them for lately (`evidence_days`), what it asks for those it has listed, how
//!   many stand empty, and any `rental_evidence` paper published to it; the sitting tenant's rent moves part of the way
//!   (`pass_up_bps`, `pass_down_bps`, `soft_vacancy_bps`; all optional). A rise is given by `rent_increase` notice as
//!   before; a fall cannot be an "increase", so it is offered at the lease's renewal as the new lease's rent. With no
//!   evidence the rent stays. The markup of a new listing is unchanged.
//! - **A notice to vacate gives the law's full days.** Its date was counted from the moment the landlord decided, but
//!   the notice is on the record a little later (all work takes time), so a notice given on exactly the law's period
//!   could be a day short (docs/testing.md: the fault of the one-day-short notice). The step is now made again when it is
//!   actually sent (`redo`, as the rent increase is) and its date is the first day to begin once the law's days have run
//!   in full from when it is on the record (`common::starts_on`).
//! - Wants (A2's `Wants`) and the everyday-frictions `Respondent` (lane D) are not in this lane's tree. The arrears wants
//!   the landlord keeps are its own small book (`ArrearsWants`, behind `Wanting`), and the venue's answers are a hook
//!   (`Respond`) that answers nothing until lane D's respondent is given; integration gives both.
//! - The owners' draw goes to the shareholders on the landlord's register (`market::lengnick::distribute`, as TS did);
//!   a world with no register keeps TS's stand-in, the draw spent at a local shop.
//! - The first wake is a day of the week drawn from the participant's id (a kind cannot draw before it exists); the day
//!   and hour of the rent book are drawn at the first wake from `cx.chance`.

use super::decimal::{fmt_dec, round_div, scaled};
use super::orgwants::{Given, Org, Spread, WantNote, Wanting};
use super::practice::{PracticeOf, PracticeParams};
use super::tax::latest_law;
use crate::common::{
    ask, between, breaches, brought_forward, cells_of, cents, data, money_words, noted, own_account, published_price, starts_on, stood_empty, 
    truthy, when_words, withdraw, Asked, Book, Fields, DAY, MONTH,
};
use crate::papers::agreements::{lease_terms, notice, offer, Offer};
use crate::papers::market::RentalEvidence;
use crate::steps::{arg, because, call, pay, say, Done, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Action, Actor, Belief, Ctx, Cx, Kind, Picture};
use oikos_rules::rent::{reviewed, Evidence, Review};
use oikos_sight::calls::{Call, Line};
use oikos_sight::{LookRequest, OutcomeStatus, Record, RecordBody, Seen, SiteCell};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub struct Landlord;
pub static LANDLORD: Landlord = Landlord;

const WEEK: i64 = 7 * DAY;
const MANIFEST: &str = include_str!("landlord.manifest.json");

// ------------------------------------------------------------------------------------------------ the law on possession

/// The law on possession of a let home for arrears, as its lawmaker published it (docs/behaviour/justice.md,
/// "Possession"): how long rent must be owed before a notice to vacate may be given, the notice it must give, how long
/// after its order the tribunal's date for possession falls, the longest plan to pay it will set, how long whoever
/// enforces a warrant has to carry it out, and the notice of the day they must give the tenant. A record a landlord, a
/// tenant and the tribunal read; no place's figures here, and a world with no such law has none of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PossessionLaw {
    pub id: String,
    pub arrears_days: i64,
    pub notice_days: i64,
    pub possession_days: i64,
    pub plan_months: i64,
    pub warrant_days: i64,
    pub eviction_notice_days: i64,
    pub enforced_by: Option<String>,
}

pub fn possession_law(book: &Book) -> Option<PossessionLaw> {
    let l = latest_law(book, |r| data(r).get("tenancy").and_then(Value::as_str) == Some("possession"))?;
    let d = data(l);
    let n = |k: &str| d.get(k).and_then(|v| scaled(v, 1)).filter(|x| *x >= 0).unwrap_or(0);
    Some(PossessionLaw {
        id: l.id.clone(),
        arrears_days: n("arrears_days"),
        notice_days: n("notice_days"),
        possession_days: n("possession_days"),
        plan_months: n("plan_months"),
        warrant_days: n("warrant_days"),
        eviction_notice_days: n("eviction_notice_days"),
        enforced_by: d.get("enforced_by").and_then(Value::as_str).map(String::from),
    })
}

/// Whom a lease names as living in the home with the tenant (its words say: "... to live there with their household:
/// a, b."; none named: the tenant alone), the tenant first.
pub fn household_named(lease_text: &str, tenant: &str) -> Vec<String> {
    let named: Vec<String> = lease_text
        .split_once("with their household: ")
        .and_then(|(_, rest)| rest.split_once('.'))
        .map(|(names, _)| names.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect())
        .unwrap_or_default();
    let mut out = vec![tenant.to_string()];
    for n in named {
        if !out.contains(&n) {
            out.push(n);
        }
    }
    out
}

// ------------------------------------------------------------------------------------------------ parameters

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Possession {
    tribunal: String,
    #[serde(default)]
    fee: Option<i64>,
    #[serde(default)]
    fee_account: Option<String>,
    #[serde(default)]
    warrant_fee: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Repair {
    builder: String,
    account: String,
    units: i64,
    price: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    markup_bps: i64,
    cut_bps: i64,
    min_term_months: i64,
    max_term_months: i64,
    landlord_notice_days: i64,
    tenant_notice_days: i64,
    arrears_months_before_notice: i64,
    possession: Option<Possession>,
    spend_share_bps: i64,
    upkeep_share_bps: i64,
    base_rent: Value,
    develop: bool,
    develop_type: String,
    develop_window_days: i64,
    develop_max_vacancy_bps: i64,
    compliance_bps: i64,
    tax_rate_bps: i64,
    max_people_per_bedroom: i64,
    rent_review_months: Option<i64>,
    rent_increase_notice_days: i64,
    after_term: Option<String>,
    renew: bool,
    register_lots: Option<String>,
    initiative: Option<bool>,
    owner_values: Option<BTreeMap<String, i64>>,
    values: BTreeMap<String, Spread>,
    org: Value,
    repair: Option<Repair>,
    respond: Value,
    pass_up_bps: i64,
    pass_down_bps: i64,
    soft_vacancy_bps: i64,
    evidence_days: i64,
    builder: Option<String>,
    city: Option<String>,
    city_account: Option<String>,
    outside_account: Option<String>,
    shop_accounts: Vec<String>,
}

impl Params {
    fn read(ctx: &Ctx) -> Result<Params, String> {
        let review = oikos_rules::rent::Review::default();
        let register_lots = ctx.params.get("register").and_then(|r| r.get("lots")).and_then(Value::as_str).map(String::from);
        Ok(Params {
            markup_bps: ctx.param("markup_bps", 500)?,
            cut_bps: ctx.param("cut_bps", 500)?,
            min_term_months: ctx.param("min_term_months", 12)?,
            max_term_months: ctx.param("max_term_months", 24)?,
            landlord_notice_days: ctx.param("landlord_notice_days", 60)?,
            tenant_notice_days: ctx.param("tenant_notice_days", 30)?,
            arrears_months_before_notice: ctx.param("arrears_months_before_notice", 2)?,
            possession: ctx.param("possession", None)?,
            spend_share_bps: ctx.param("spend_share_bps", 6000)?,
            upkeep_share_bps: ctx.param("upkeep_share_bps", 2000)?,
            base_rent: ctx.param("base_rent", json!({}))?,
            develop: ctx.param("develop", true)?,
            develop_type: ctx.param("develop_type", "house".to_string())?,
            develop_window_days: ctx.param("develop_window_days", 90)?,
            develop_max_vacancy_bps: ctx.param("develop_max_vacancy_bps", 1000)?,
            compliance_bps: ctx.param("compliance_bps", 10_000)?,
            tax_rate_bps: ctx.param("tax_rate_bps", 0)?,
            max_people_per_bedroom: ctx.param("max_people_per_bedroom", 2)?,
            rent_review_months: ctx.param("rent_review_months", None)?,
            rent_increase_notice_days: ctx.param("rent_increase_notice_days", 0)?,
            after_term: ctx.param("after_term", None)?,
            renew: ctx.param("renew", true)?,
            register_lots,
            initiative: ctx.param("initiative", None)?,
            owner_values: ctx.param("owner_values", None)?,
            values: ctx.param("values", BTreeMap::new())?,
            org: ctx.param("org", json!({}))?,
            repair: ctx.param("repair", None)?,
            respond: ctx.param("respond", json!({}))?,
            pass_up_bps: ctx.param("pass_up_bps", review.pass_up_bps)?,
            pass_down_bps: ctx.param("pass_down_bps", review.pass_down_bps)?,
            soft_vacancy_bps: ctx.param("soft_vacancy_bps", review.soft_vacancy_bps)?,
            evidence_days: ctx.param("evidence_days", 90)?,
            builder: ctx.param("builder", None)?,
            city: ctx.param("city", None)?,
            city_account: ctx.param("city_account", None)?,
            outside_account: ctx.param("outside_account", None)?,
            shop_accounts: ctx.param("shop_accounts", vec![])?,
        })
    }
    fn review(&self) -> Review {
        Review { pass_up_bps: self.pass_up_bps, pass_down_bps: self.pass_down_bps, soft_vacancy_bps: self.soft_vacancy_bps }
    }
    /// The rent per type, or per type and bedrooms (`base_rent`).
    fn base_rent_for(&self, kind: &str, bedrooms: Option<i64>) -> Option<i64> {
        match self.base_rent.get(kind)? {
            Value::Number(n) => n.as_i64(),
            Value::Array(list) => list.iter().find(|b| b.get("bedrooms").and_then(Value::as_i64) == bedrooms).and_then(|b| b.get("rent").and_then(Value::as_i64)),
            _ => None,
        }
    }
}

/// The culture dial's practice figures, where the dial is on (docs/behaviour/culture.md): the dial's own keys over the
/// defaults. Absent dial: none.
pub(crate) fn practice_params(dials: &Value) -> Option<PracticeParams> {
    let c = dials.get("culture").filter(|c| !c.is_null() && c.as_bool() != Some(false))?;
    let n = |k: &str, d: i64| c.get(k).and_then(Value::as_i64).unwrap_or(d);
    Some(PracticeParams { window_days: n("practice_window_days", 1_825), min_occasions: n("practice_min_occasions", 5), inertia_bps: n("practice_inertia_bps", 5_000), opening: n("practice_opening", 100) })
}

// ------------------------------------------------------------------------------------------------ the wants it keeps

/// An arrears want: a tenant behind with the rent that the landlord wants settled, and what it has tried.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Arrears {
    pub lease: String,
    pub tenant: String,
    pub weight: i64,
    pub since: i64,
    pub tried: i64,
    pub way: Option<String>,
    pub tried_at: Option<i64>,
}

/// The landlord's wants book: only the want it has, to be paid what it is owed (docs/behaviour/firm-wants.md). A2's
/// richer `Wants` replaces it behind `Wanting` at integration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ArrearsWants {
    held: Vec<Arrears>,
    events: Vec<WantNote>,
}

impl ArrearsWants {
    pub fn get(&self, lease: &str) -> Option<&Arrears> {
        self.held.iter().find(|w| w.lease == lease)
    }
    pub fn born(&mut self, lease: &str, tenant: &str, weight: i64, t: i64) {
        if self.get(lease).is_some() {
            return;
        }
        self.held.push(Arrears { lease: lease.into(), tenant: tenant.into(), weight, since: t, tried: 0, way: None, tried_at: None });
        self.events.push(WantNote { t, kind: "born".into(), about: "arrears".into(), weight, way: None });
    }
    pub fn tried(&mut self, lease: &str, way: &str, t: i64) {
        if let Some(w) = self.held.iter_mut().find(|w| w.lease == lease) {
            w.tried += 1;
            w.way = Some(way.into());
            w.tried_at = Some(t);
            let (weight, way) = (w.weight, w.way.clone());
            self.events.push(WantNote { t, kind: "pursued".into(), about: "arrears".into(), weight, way });
        }
    }
    pub fn met(&mut self, lease: &str, t: i64) {
        if let Some(i) = self.held.iter().position(|w| w.lease == lease) {
            let w = self.held.remove(i);
            self.events.push(WantNote { t, kind: "met".into(), about: "arrears".into(), weight: w.weight, way: w.way });
        }
    }
}

impl Wanting for ArrearsWants {
    fn take_events(&mut self) -> Vec<WantNote> {
        std::mem::take(&mut self.events)
    }
    fn section(&self) -> Value {
        json!(self
            .held
            .iter()
            .map(|w| {
                let mut v = json!({ "about": "arrears", "whom": w.tenant, "seeks": [{ "money": { "to": "me" } }], "against": { "record": w.lease, "kind": "arrears", "by": w.tenant },
                    "weight": w.weight, "since": w.since, "from": "event", "tried": w.tried });
                // (No way tried yet: none written, as the record's contract has it.)
                if let Some(way) = &w.way {
                    v["way"] = json!(way);
                }
                v
            })
            .collect::<Vec<_>>())
    }
}

// ------------------------------------------------------------------------------------------------ the frictions hook

/// What the landlord's books say, for the respondent (docs/behaviour/frictions.md): whether a home said to need repair
/// has been put right lately, what it would cost, and the order that puts it right.
pub trait Home {
    /// `Some(done)` for a home said to be in disrepair that our books speak of.
    fn truth(&self, structure: &str, t: i64) -> Option<bool>;
    /// What putting the disrepair of a structure right would cost us now (0: nothing to do or no means).
    fn cost(&self, structure: &str) -> i64;
    /// Order the repair (and remember it), with the reason; none if it cannot be ordered.
    fn remedy(&mut self, structure: &str, t: i64, why: &str, cx: &Cx) -> Option<Vec<Step<Then>>>;
}

/// How the landlord answers a venue when asked to put something right, told of a complaint or ordered to (lane D's
/// `Respondent`). Its memory is a plain value the landlord keeps for it. The default answers nothing.
pub trait Respond: Send + Sync {
    fn steps(&self, state: &mut Value, book: &Book, t: i64, account: &str, balance: i64, cx: &mut Cx, home: &mut dyn Home) -> Vec<Step<Then>>;
}

pub struct NoResponse;
impl Respond for NoResponse {
    fn steps(&self, _: &mut Value, _: &Book, _: i64, _: &str, _: i64, _: &mut Cx, _: &mut dyn Home) -> Vec<Step<Then>> {
        vec![]
    }
}

/// The respondent a landlord is given at creation (replaced by lane D's at integration).
pub fn respondent(_: &Ctx) -> Arc<dyn Respond> {
    Arc::new(NoResponse)
}

// ------------------------------------------------------------------------------------------------ the kind

fn fnv(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

impl Kind for Landlord {
    fn name(&self) -> &'static str {
        "firm.landlord"
    }
    fn version(&self) -> &'static str {
        "0.20.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/firms.md"
    }
    fn manifest(&self) -> Value {
        serde_json::from_str(MANIFEST).expect("the landlord's manifest is JSON")
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        WEEK
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        (fnv(&ctx.participant) % 7) as i64 * DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params::read(ctx)?;
        let responder = respondent(ctx);
        Ok(Box::new(Keeping(Stepper::new(Office::new(ctx, p, responder)))))
    }
    fn restore(&self, ctx: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let mut s = Stepper::<Office>::restore(saved)?;
        s.plan.responder = respondent(ctx);
        s.plan.world = ctx.world.clone();
        Ok(Box::new(Keeping(s)))
    }
}

/// The stepper with what wrapped it in the TS: the laws its book could not read are said with its next reasons
/// (`noting`), and its record is written with the act that ends a wake (`keeping`).
struct Keeping(Stepper<Office>);

impl Actor for Keeping {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        let action = self.0.step(pic, cx);
        let office = &mut self.0.plan;
        if matches!(action, Action::Wait { .. }) {
            if let Some(org) = office.org.as_mut() {
                let circumstances = BTreeMap::from([("homes".to_string(), office.owned.len() as i64)]);
                org.keep(cx, &circumstances);
            }
        }
        noted(&mut office.book, action)
    }
    fn beliefs(&self) -> Vec<Belief> {
        // The leases we hold in force, as we have them (truth audits).
        let me = &self.0.plan.me;
        let b = &self.0.plan.book;
        vec![Belief::Held {
            party: me.clone(),
            template: "lease".into(),
            agreements: b
                .of_type("agreement")
                .filter(|r| matches!(&r.body, RecordBody::Agreement { terms } if terms.template.as_deref() == Some("lease") && terms.parties.first() == Some(me)) && b.in_force(&r.id))
                .map(|r| r.id.clone())
                .collect(),
        }]
    }
    fn sent(&mut self, action: &str) {
        self.0.sent(action)
    }
    fn save(&self) -> Result<Value, String> {
        self.0.save()
    }
}

// ------------------------------------------------------------------------------------------------ memory

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Stage {
    Applying,
    Applied,
    Granted,
    Refused,
    Contracted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Permit {
    Granted,
    Refused,
}

/// A building of ours in the making: the lot, how far it has got, and, once the builder is asked, how the permit stood
/// then, the agreement we offered and when. `told`: what the builder last wrote that it charges, declining an offer of
/// ours, and when.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Dev {
    lot: String,
    stage: Stage,
    app: Option<String>,
    permit: Option<Permit>,
    contract: Option<String>,
    offered_at: Option<i64>,
    not_before: Option<i64>,
    told: Option<(i64, i64)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum EndStage {
    Noticed,
    Applied,
    Plan,
    Ordered,
    Warrant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct PlanSet {
    at: i64,
    owed: i64,
    instalment: i64,
}

/// A tenancy we are ending for arrears under the world's law on possession: where it has got to.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Ending {
    stage: EndStage,
    by: i64,
    notice: Option<String>,
    seen: BTreeSet<String>,
    plan: Option<PlanSet>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct RentChange {
    from: i64,
    rent: i64,
}

/// A home we own: a dwelling space in a finished building on one of our lots.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Owned {
    structure: String,
    type_: String,
    space: String,
    bedrooms: Option<i64>,
}

/// What a step does when it is made again for the moment it is sent (a date counts from when the notice is on the
/// record), and what follows from the one that offers the builder a building.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Then {
    /// The offer to the builder: its price, and when it was planned.
    Build { price: i64, planned: i64 },
    /// A notice of rent increase, to be dated when it is given.
    Rent(RentGive),
    /// A notice to vacate, to be dated when it is given.
    Vacate(VacateGive),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RentGive {
    lease: String,
    tenant: String,
    space: String,
    rent: i64,
    was: i64,
    last_from: i64,
    lead: i64,
    /// The change's `from` as last made (so that a later making finds it in the book of rent changes).
    from: i64,
    why: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VacateGive {
    lease: String,
    tenant: String,
    space: String,
    arrears: i64,
    law: String,
    arrears_days: i64,
    notice_days: i64,
    bears: i64,
    by: i64,
}

#[derive(Serialize, Deserialize)]
struct Office {
    me: String,
    participant: String,
    p: Params,
    book: Book,
    org: Option<Org<ArrearsWants>>,
    plan_asked: Asked,
    owned: Vec<Owned>,
    /// tenant account -> each payment received, and when
    received: BTreeMap<String, Vec<(i64, i64)>>,
    /// a lease we've offered to renew -> when its term ends (the new one's rent runs from then)
    renews_at: BTreeMap<String, i64>,
    /// agreement -> when we gave notice
    notice_given: BTreeMap<String, i64>,
    handled: BTreeSet<String>,
    income: i64,
    next_spend: i64,
    vacancy_history: Vec<(i64, i64, i64)>,
    dev: Option<Dev>,
    dev_cooldown_until: i64,
    /// our offer to the builder (an agreement) -> its price
    owing: BTreeMap<String, i64>,
    /// invoice -> a payment instructed, not yet seen debited (amount, when)
    paying: BTreeMap<String, (i64, i64)>,
    /// fines and orders we've responded to
    answered: BTreeSet<String>,
    /// lease -> rent increases we've given notice of
    rent_changes: BTreeMap<String, Vec<RentChange>>,
    /// lease -> when its rent was last reviewed
    last_review: BTreeMap<String, i64>,
    /// lease -> a lower rent for the lease that renews it (a fall at review)
    falls: BTreeMap<String, i64>,
    /// leases whose tenant we've offered a new one
    renewed: BTreeSet<String>,
    /// lease -> since when its rent has been a month or more behind
    late_since: BTreeMap<String, i64>,
    /// The day and hour of the week for going through the rent book (drawn at the first wake).
    book_time: Option<i64>,
    /// The week (counted from our own day) whose rent book we last went through.
    books_week: Option<i64>,
    /// a lease -> when we last wrote to ask for the rent owed under it
    asked_for: BTreeMap<String, i64>,
    files_read: bool,
    ending: BTreeMap<String, Ending>,
    repairing: BTreeMap<String, i64>,
    repaired: BTreeMap<String, i64>,
    pay_from: String,
    responder_state: Value,
    #[serde(skip, default = "no_response")]
    responder: Arc<dyn Respond>,
    /// The world's words for money and dates (set at creation and restore; not memory).
    #[serde(skip)]
    world: Arc<crate::WorldInfo>,
}

fn no_response() -> Arc<dyn Respond> {
    Arc::new(NoResponse)
}

impl Office {
    fn new(ctx: &Ctx, p: Params, responder: Arc<dyn Respond>) -> Office {
        Office {
            me: ctx.entity.clone(),
            participant: ctx.participant.clone(),
            p,
            book: Book::new(),
            org: None,
            plan_asked: Asked::default(),
            owned: vec![],
            received: BTreeMap::new(),
            renews_at: BTreeMap::new(),
            notice_given: BTreeMap::new(),
            handled: BTreeSet::new(),
            income: 0,
            next_spend: MONTH,
            vacancy_history: vec![],
            dev: None,
            dev_cooldown_until: 0,
            owing: BTreeMap::new(),
            paying: BTreeMap::new(),
            answered: BTreeSet::new(),
            rent_changes: BTreeMap::new(),
            last_review: BTreeMap::new(),
            falls: BTreeMap::new(),
            renewed: BTreeSet::new(),
            late_since: BTreeMap::new(),
            book_time: None,
            books_week: None,
            asked_for: BTreeMap::new(),
            files_read: false,
            ending: BTreeMap::new(),
            repairing: BTreeMap::new(),
            repaired: BTreeMap::new(),
            pay_from: String::new(),
            responder_state: json!({}),
            responder,
            world: ctx.world.clone(),
        }
    }

    fn org(&mut self) -> &mut Org<ArrearsWants> {
        self.org.as_mut().expect("the organisation is made at the first absorb")
    }

    /// The lots our ownership records name.
    fn own_lots(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .book
            .of_type("claim")
            .filter_map(|r| match &r.body {
                RecordBody::Claim { holder, about, .. } if *holder == self.me && about.get("kind").and_then(Value::as_str) == Some("ownership") => about.get("object").and_then(Value::as_str).map(String::from),
                _ => None,
            })
            .collect();
        v.sort();
        v
    }

    fn obeys(&self, cx: &mut Cx, key: &str) -> bool {
        (cx.rng(&format!("comply-{key}")).below(10_000) as i64) < self.p.compliance_bps
    }
}

fn site_cells(pic: &Picture) -> Vec<&SiteCell> {
    let mut out = vec![];
    for seen in pic.channels.values() {
        if let Seen::Sites { cells, .. } = seen {
            out.extend(cells.iter());
        }
    }
    out
}

fn tenant_of<'a>(a: &'a Record, me: &str) -> &'a str {
    crate::papers::agreements::parties_of(a).iter().find(|x| *x != me).map_or("", String::as_str)
}

fn offer_of(r: &Record) -> Option<&Value> {
    match &r.body {
        RecordBody::Statement { offer, .. } => offer.as_ref(),
        _ => None,
    }
}

fn line(c: Call) -> Line {
    Line { bind: None, call: c }
}
fn bound(name: &str, c: Call) -> Line {
    Line { bind: Some(name.into()), call: c }
}
fn step<T>(why: impl Into<String>, calls: Vec<Call>) -> Step<T> {
    because(why, calls)
}
fn step_lines<T>(why: impl Into<String>, lines: Vec<Line>) -> Step<T> {
    let mut s = Step::new(lines);
    s.why = Some(why.into());
    s
}
fn visible(ids: &[&str]) -> Option<Visible> {
    Some(Visible::Only(ids.iter().map(|s| s.to_string()).collect()))
}

// ------------------------------------------------------------------------------------------------ the plan

/// What one wake shows of the landlord's own affairs, made once and handed to each part of the plan.
struct Env {
    t: i64,
    account: String,
    /// The bank that keeps the account (it carries out an instruction to pay the shareholders).
    custodian: String,
    balance: i64,
    world: Arc<crate::WorldInfo>,
    at_books: bool,
    leases: Vec<Arc<Record>>,
    awaiting: Vec<Arc<Record>>,
    active: Vec<Arc<Record>>,
}

impl Env {
    fn usd(&self, n: i64) -> String {
        money_words(n, &self.world)
    }
    fn date(&self, t: i64) -> String {
        when_words(t, &self.world)
    }
}

/// An amount written in a paper (a number, or a decimal string of the smallest unit).
fn whole(v: Option<&Value>) -> i64 {
    v.and_then(crate::papers::lenient::whole).unwrap_or(0)
}

fn occupancy(who: &str, space: &str) -> Call {
    call("occupancy", vec![("who", Some(arg(who))), ("in", Some(arg(space)))])
}

fn rent_payment(account: &str, rent: i64, cx: &Cx) -> Call {
    pay(account, rent, Pay { every: Some(MONTH), for_: Some("rent".into()), ..Default::default() }, cx)
}

impl Plan for Office {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, cx: &mut Cx) {
        if self.org.is_none() {
            let g = Given {
                practice: vec![],
                initiative: self.p.initiative,
                owner_values: self.p.owner_values.clone(),
                values: self.p.values.clone(),
                org: Some(self.p.org.clone()),
                culture: practice_params(&cx.ctx.world.dials),
            };
            self.org = Some(Org::new(cx, g, ArrearsWants::default()));
        }
        if self.book_time.is_none() {
            // The office's own day and hour of the week for going through the rent book (each landlord's, drawn once):
            // it is then that arrears are taken up, by a letter, an application or a notice.
            self.book_time = Some(cx.chance(&format!("rent-book-day-{}", self.participant)).below(7 * 24) as i64 * 3_600);
        }
        self.book.absorb(pic);
        if let Some(dev) = self.dev.as_mut().filter(|d| d.stage == Stage::Applying) {
            for o in &pic.outcomes {
                if let Some(app) = o.created.as_ref().and_then(|c| c.get("app")) {
                    dev.app = Some(app.clone());
                    dev.stage = Stage::Applied;
                }
            }
        }
        if let Some(acc) = own_account(pic) {
            for tx in pic.transactions() {
                if tx.from == acc.account {
                    if let Some(s) = &tx.settles {
                        self.paying.remove(s);
                    }
                }
            }
            for tx in pic.transactions() {
                if tx.to == acc.account && tx.from != acc.account {
                    self.income += cents(tx.amount);
                    self.received.entry(tx.from.clone()).or_default().push((tx.t, cents(tx.amount)));
                }
            }
        }
    }

    /// Our titles are our own papers; the plan of each lot is looked up in the register, once.
    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        let Some(lots) = self.p.register_lots.clone() else { return vec![] };
        for lot in self.own_lots() {
            if self.book.has(&lot) || !self.plan_asked.first(&lot, pic.t) {
                continue;
            }
            return vec![ask::one(&lots, &lot)];
        }
        vec![]
    }

    /// It sleeps until its usual week is up or its next day for the rent book, whichever is sooner.
    fn until(&self, pic: &Picture) -> Option<i64> {
        let since_books = (pic.t - self.book_time.unwrap_or(0)).rem_euclid(WEEK);
        Some((pic.t + WEEK).min(pic.t - since_books + WEEK))
    }

    fn then(&mut self, token: &Then, done: Done, _cx: &mut Cx) -> Vec<Step<Then>> {
        // The agreement we offered the builder, to know its answer by. An offer that wasn't made (refused in the
        // moment) is no offer: the permit stands as it did, and we decide again in a week.
        if let Then::Build { price, planned } = token {
            let Some(dev) = self.dev.as_mut() else { return vec![] };
            match done {
                Done::Outcome(o) if o.status == OutcomeStatus::Applied && o.created.as_ref().is_some_and(|c| c.contains_key("build")) => {
                    let contract = o.created.as_ref().unwrap()["build"].clone();
                    dev.contract = Some(contract.clone());
                    self.owing.insert(contract, *price);
                }
                _ if dev.stage == Stage::Contracted => {
                    dev.stage = dev.permit.map_or(Stage::Granted, |p| if p == Permit::Refused { Stage::Refused } else { Stage::Granted });
                    dev.not_before = Some(planned + 7 * DAY);
                }
                _ => {}
            }
        }
        vec![]
    }

    /// A step made again for the moment it is done: a notice's date counts from when it is on the record.
    fn redo(&mut self, step: Step<Then>, t: i64) -> Step<Then> {
        let world = self.world.clone();
        match step.then.clone() {
            Some(Then::Rent(mut g)) => {
                let old = g.from;
                let new = starts_on(t, g.lead);
                if let Some(c) = self.rent_changes.get_mut(&g.lease).and_then(|v| v.iter_mut().find(|c| c.from == old && c.rent == g.rent)) {
                    c.from = new;
                }
                g.from = new;
                let mut s = rent_notice(&self.me, &g, &world);
                s.planned = step.planned;
                s
            }
            Some(Then::Vacate(mut g)) => {
                g.by = starts_on(t, g.notice_days * DAY);
                if let Some(e) = self.ending.get_mut(&g.lease) {
                    e.by = g.by;
                }
                let mut s = vacate_notice(&self.me, &g, &world);
                s.planned = step.planned;
                s
            }
            _ => step,
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let t = pic.t;
        let Some(acc) = own_account(pic) else { return vec![] };
        self.pay_from = acc.account.clone();
        let me = self.me.clone();
        // What we have heard of repairs.
        let repair_papers: Vec<Arc<Record>> = self.book.open("repair_done").chain(self.book.open("repair_declined")).cloned().collect();
        for r in repair_papers {
            let st = data(&r).s("structure").unwrap_or("").to_string();
            if !crate::common::addressed_to(&r).contains(&me) || !self.repairing.contains_key(&st) || r.at < self.repairing[&st] {
                continue;
            }
            self.repairing.remove(&st);
            if matches!(&r.body, RecordBody::Statement { kind, .. } if kind == "repair_done") {
                self.repaired.insert(st, t);
            }
        }
        // What we own: the lots our ownership records name, the cells they cover (seen through our own sites), and the
        // homes (dwelling units) in finished buildings on them, including anything we've since built.
        let own_lots = self.own_lots();
        let own_cells: BTreeSet<String> = own_lots.iter().flat_map(|l| cells_of(&self.book, l).into_iter().map(String::from)).collect();
        let sites: Vec<&SiteCell> = site_cells(pic).into_iter().filter(|c| own_cells.contains(&c.cell)).collect();
        let mut owned = vec![];
        let mut seen_structures = BTreeSet::new();
        for site in &sites {
            let Some(st) = site.structure.as_ref().filter(|s| s.complete && seen_structures.insert(s.structure.clone())) else { continue };
            for sp in st.spaces.iter().filter(|sp| sp.kind == "dwelling") {
                owned.push(Owned { structure: st.structure.clone(), type_: st.structure_type.clone(), space: sp.space.clone(), bedrooms: sp.attrs.as_ref().and_then(|a| a.get("bedrooms")).and_then(Value::as_i64) });
            }
        }
        self.owned = owned;
        // Our leases: in force, or offered by us and still awaiting the tenant's signature (up to a month). Both hold a
        // unit; counting only signed ones would let the same home twice.
        let leases: Vec<Arc<Record>> = self
            .book
            .of_type("agreement")
            .filter(|r| matches!(&r.body, RecordBody::Agreement { terms } if terms.template.as_deref() == Some("lease") && terms.parties.first() == Some(&me)) && self.book.signed_by(&r.id, &me))
            .cloned()
            .collect();
        let awaiting: Vec<Arc<Record>> = leases.iter().filter(|a| !self.book.concluded(&a.id) && t - a.at < MONTH).cloned().collect();
        let active: Vec<Arc<Record>> = leases.iter().filter(|a| self.book.in_force(&a.id)).cloned().collect();
        // The rent book is gone through once a week of our own: at our first look in it, which is our own day and hour
        // unless something kept us from it.
        let this_week = (t - self.book_time.unwrap_or(0)).div_euclid(WEEK);
        let at_books = Some(this_week) != self.books_week;
        self.books_week = Some(this_week);
        let e = Env { t, account: acc.account.clone(), custodian: acc.custodian.clone(), balance: acc.balance, world: cx.ctx.world.clone(), at_books, leases, awaiting, active };
        let mut steps: Vec<Step<Then>> = vec![];
        let mut let_now: BTreeSet<String> = BTreeSet::new();
        let mut offered_now: Vec<String> = vec![];
        self.letting(cx, &e, &mut steps, &mut let_now, &mut offered_now);
        self.renewals(cx, &e, &mut steps);
        self.listings(cx, &e, &mut steps, &let_now, &offered_now);
        self.deaths(&e, &sites, &mut steps);
        self.arrears(cx, &e, &mut steps);
        self.rent_reviews(cx, &e, &mut steps, &offered_now);
        self.monthly(cx, &e, &mut steps);
        self.development(cx, &e, &sites, &own_lots, &mut steps);
        self.invoices(&e, cx, &mut steps);
        self.fines(cx, &e, &sites, &mut steps);
        self.variations(cx, &e, &mut steps);
        self.tribunal_orders(cx, &e, &mut steps);
        // Asked to put something right (a home in disrepair), told of a complaint, or ordered to
        // (docs/behaviour/frictions.md): lane D's respondent, given the landlord's books.
        let Office { book, repairing, repaired, p, pay_from, org, responder, responder_state, me, .. } = self;
        let mut home = Books { repairing, repaired, repair: &p.repair, pay_from, org: org.as_mut().expect("made at absorb"), me };
        steps.extend(responder.steps(responder_state, book, t, &acc.account, acc.balance, cx, &mut home));
        steps
    }
}

/// The landlord's books as the respondent reads them (disjoint borrows of its memory).
struct Books<'a> {
    repairing: &'a mut BTreeMap<String, i64>,
    repaired: &'a BTreeMap<String, i64>,
    repair: &'a Option<Repair>,
    pay_from: &'a str,
    org: &'a mut Org<ArrearsWants>,
    me: &'a str,
}

impl Home for Books<'_> {
    /// What our books say of a home said to need repair: done, if the builder has told us so lately; else not.
    fn truth(&self, structure: &str, t: i64) -> Option<bool> {
        Some(self.repaired.get(structure).is_some_and(|at| t - at < 90 * DAY))
    }
    fn cost(&self, structure: &str) -> i64 {
        match self.repair {
            Some(r) if !self.repairing.contains_key(structure) => r.units * r.price,
            _ => 0,
        }
    }
    fn remedy(&mut self, structure: &str, t: i64, why: &str, cx: &Cx) -> Option<Vec<Step<Then>>> {
        let r = self.repair.as_ref()?;
        if self.pay_from.is_empty() || self.repairing.contains_key(structure) {
            return None;
        }
        self.repairing.insert(structure.to_string(), t);
        self.org.remember(t, "ordered_repair", Some(structure), 1_000);
        let price = money_words(r.units * r.price, &cx.ctx.world);
        Some(vec![step(
            format!("{why} Ordering the repair of {structure} from {}, and paying its price of {price}.", r.builder),
            vec![
                say(
                    "repair_order",
                    &format!("Order: the repair of {structure} ({} units of work), paid with this order.", r.units),
                    Say { to: Some(vec![r.builder.clone()]), visible: visible(&[self.me, &r.builder]), data: Some(json!({ "structure": structure, "units": r.units, "account": self.pay_from })), ..Default::default() },
                ),
                pay(&r.account, r.units * r.price, Pay { from: Some(self.pay_from.to_string()), for_: Some(format!("Repair of {structure}.")), ..Default::default() }, cx),
            ],
        )])
    }
}

// ------------------------------------------------------------------------------------------------ steps with dates

/// The notice of a rent increase as it is given at `g.from`.
fn rent_notice(me: &str, g: &RentGive, world: &crate::WorldInfo) -> Step<Then> {
    let usd = |n| money_words(n, world);
    let data = json!({ "lease": g.lease, "rent": g.rent, "from": g.from, "was": g.was, "last_from": g.last_from });
    let mut s = step(
        g.why.clone(),
        vec![say(
            "rent_increase",
            &format!("Notice of rent increase for {}: {} a month from {} (day), up from {}; it last changed on day {}.", g.space, usd(g.rent), g.from.div_euclid(DAY), usd(g.was), g.last_from.div_euclid(DAY)),
            Say { to: Some(vec![g.tenant.clone()]), visible: visible(&[me, &g.tenant]), basis: Some(g.lease.clone()), data: Some(data), ..Default::default() },
        )],
    );
    s.redo = true;
    s.then = Some(Then::Rent(g.clone()));
    s
}

/// The notice to vacate as it is given for the date `g.by`.
fn vacate_notice(me: &str, g: &VacateGive, world: &crate::WorldInfo) -> Step<Then> {
    let usd = |n| money_words(n, world);
    let by = when_words(g.by, world);
    let mut s = step(
        format!(
            "Rent is {} or more months in arrears ({}): giving {} notice to vacate by {by}, as {} allows after {} days' arrears. Paid before then, it lapses.",
            num_months(g.bears),
            usd(g.arrears),
            g.tenant,
            g.law,
            g.arrears_days
        ),
        vec![say(
            "notice_to_vacate",
            &format!(
                "Notice to vacate: the rent under {} is {} in arrears. You are to leave {} by {by}. If the arrears are paid before then, this notice lapses. If you are still there after it, we may apply to the tribunal for possession.",
                g.lease,
                usd(g.arrears),
                g.space
            ),
            Say {
                to: Some(vec![g.tenant.clone()]),
                visible: visible(&[me, &g.tenant]),
                basis: Some(g.lease.clone()),
                data: Some(json!({ "lease": g.lease, "reason": "arrears", "arrears": g.arrears, "by": g.by, "law": g.law })),
                ..Default::default()
            },
        )],
    );
    s.redo = true;
    s.then = Some(Then::Vacate(g.clone()));
    s
}

/// The months of patience as the words give them (a whole number bare).
fn num_months(bears: i64) -> String {
    bears.to_string()
}

// ------------------------------------------------------------------------------------------------ the parts of the plan

impl Office {
    /// The rent of a lease at a time: as agreed, or as we've since raised it.
    fn rent_at(&self, a: &Record, at: i64) -> i64 {
        self.rent_changes
            .get(&a.id)
            .and_then(|v| v.iter().rev().find(|c| c.from <= at))
            .map_or_else(|| lease_terms(a, tenant_of(a, &self.me)).rent, |c| c.rent)
    }

    /// A unit is taken while a lease for it is in force or awaiting signature, or we've just offered one.
    fn taken(&self, e: &Env, offered_now: &[String], space: &str) -> bool {
        e.active.iter().chain(e.awaiting.iter()).any(|a| lease_terms(a, tenant_of(a, &self.me)).space.as_deref() == Some(space)) || offered_now.iter().any(|s| s == space)
    }

    fn term_months(&self, cx: &mut Cx, key: &str) -> i64 {
        between(self.p.min_term_months, self.p.max_term_months, &mut cx.rng(key))
    }

    /// Applications: pick one at random per listing, offer a lease, withdraw the listing.
    fn letting(&mut self, cx: &mut Cx, e: &Env, steps: &mut Vec<Step<Then>>, let_now: &mut BTreeSet<String>, offered_now: &mut Vec<String>) {
        let me = self.me.clone();
        let apps: Vec<Arc<Record>> = self.book.open("rental_application").filter(|a| crate::common::addressed_to(a).contains(&me) && !self.handled.contains(&a.id)).cloned().collect();
        let mut by_listing: Vec<(String, Vec<Arc<Record>>)> = vec![];
        for a in apps {
            let l = data(&a).s("listing").unwrap_or("").to_string();
            match by_listing.iter_mut().find(|(k, _)| *k == l) {
                Some((_, v)) => v.push(a),
                None => by_listing.push((l, vec![a])),
            }
        }
        for (listing_id, applicants) in by_listing {
            for a in &applicants {
                self.handled.insert(a.id.clone());
            }
            let Some(listing) = self.book.get(&listing_id).cloned().filter(|l| matches!(l.body, RecordBody::Statement { .. }) && !self.book.withdrawn(&l.id)) else { continue };
            let d = data(&listing);
            let space = d.s("space").unwrap_or("").to_string();
            // Only let a home that's still free; a stale listing is taken down instead.
            if space.is_empty() || self.taken(e, offered_now, &space) || !self.owned.iter().any(|o| o.space == space) {
                let_now.insert(listing_id.clone());
                steps.push(step("An application for a home that's no longer free: taking the listing down.", vec![withdraw(&listing_id, Some("No longer available."))]));
                continue;
            }
            let_now.insert(listing_id.clone());
            // Households the home is big enough for, by our policy (someone living alone fits anywhere).
            let beds = d.i("bedrooms");
            let mut eligible: Vec<&Arc<Record>> = applicants
                .iter()
                .filter(|a| {
                    let people = data(a).get("household").and_then(|h| h.get("people")).and_then(Value::as_i64).unwrap_or(1);
                    self.p.max_people_per_bedroom == 0 || beds.is_none() || people <= (beds.unwrap() * self.p.max_people_per_bedroom).max(1)
                })
                .collect();
            eligible.sort_by(|x, y| crate::common::filed_before(&x.id, &y.id));
            if eligible.is_empty() {
                let_now.remove(&listing_id); // still to let: wait for another applicant
                continue;
            }
            let pick = eligible[cx.rng(&format!("pick-{listing_id}")).below(eligible.len() as u64) as usize].clone();
            let tenant = pick.speaks_for.clone().unwrap_or_default();
            let household: Vec<String> = data(&pick).get("members").and_then(Value::as_array).map(|m| m.iter().filter_map(Value::as_str).filter(|m| *m != tenant).map(String::from).collect()).unwrap_or_default();
            let months = self.term_months(cx, &format!("term-{listing_id}"));
            let rent = whole(d.get("rent"));
            let limit = if self.p.max_people_per_bedroom == 0 { "any number of".to_string() } else { self.p.max_people_per_bedroom.to_string() };
            let o = Offer {
                template: "lease".into(),
                term: Some(months * MONTH),
                periodic: self.p.after_term.as_deref() == Some("periodic"),
                our_notice: Some(self.p.landlord_notice_days * DAY),
                their_notice: Some(self.p.tenant_notice_days * DAY),
                we: Some(occupancy(&tenant, &space)),
                they: Some(rent_payment(&e.account, rent, cx)),
                text: Some(format!(
                    "{tenant} rents home {space} from {me} for {} a month, for {months} months{}.",
                    e.usd(rent),
                    if household.is_empty() { String::new() } else { format!(", to live there with their household: {}", household.join(", ")) }
                )),
                basis: Some(pick.id.clone()),
                ..Default::default()
            };
            steps.push(step_lines(
                format!("Letting {space}: an applicant picked at random among the {} it fits (at most {limit} people per bedroom), for {months} months.", eligible.len()),
                vec![bound("lease", offer(&tenant, o)), line(withdraw(&listing_id, Some("Let.")))],
            ));
            offered_now.push(space);
        }
    }

    /// Renewals: a tenancy whose term ends within our notice period, with no notice given, is offered again to the
    /// sitting tenant: the home, at its rent then, for a new term from when this one ends (what landlords and their
    /// agents do as a lease runs out; letting it run out and relisting the home costs a vacancy and a search).
    fn renewals(&mut self, cx: &mut Cx, e: &Env, steps: &mut Vec<Step<Then>>) {
        if !self.p.renew {
            return;
        }
        let me = self.me.clone();
        for a in &e.active {
            let RecordBody::Agreement { terms } = &a.body else { continue };
            let Some(ends) = self.book.ends_at(&a.id) else { continue };
            if terms.then.as_deref() == Some("periodic") || self.renewed.contains(&a.id) || self.notice_given.contains_key(&a.id) || ends - e.t > self.p.landlord_notice_days * DAY {
                continue;
            }
            let tenant = tenant_of(a, &me).to_string();
            let lt = lease_terms(a, &tenant);
            let Some(space) = lt.space.clone().filter(|s| self.owned.iter().any(|o| &o.space == s)) else { continue };
            self.renewed.insert(a.id.clone());
            self.renews_at.insert(a.id.clone(), ends);
            // The rent then: as it stands, or the lower rent a review found for it (a fall is offered here).
            let mut rent = self.rent_at(a, ends);
            if let Some(f) = self.falls.get(&a.id) {
                rent = rent.min(*f);
            }
            let months = self.term_months(cx, &format!("renew-{}", a.id));
            let household = terms.text.as_deref().and_then(|t| t.rsplit_once("household: ")).map(|(_, h)| h.strip_suffix('.').unwrap_or(h).to_string());
            let o = Offer {
                template: "lease".into(),
                term: Some(ends - e.t + months * MONTH),
                periodic: self.p.after_term.as_deref() == Some("periodic"),
                our_notice: Some(self.p.landlord_notice_days * DAY),
                their_notice: Some(self.p.tenant_notice_days * DAY),
                we: Some(occupancy(&tenant, &space)),
                they: Some(rent_payment(&e.account, rent, cx)),
                text: Some(format!(
                    "{tenant} rents home {space} from {me} for {} a month, renewing their lease ({}) for {months} months from day {}{}.",
                    e.usd(rent),
                    a.id,
                    ends.div_euclid(DAY),
                    household.map_or(String::new(), |h| format!(", to live there with their household: {h}"))
                )),
                basis: Some(a.id.clone()),
                ..Default::default()
            };
            steps.push(step_lines(
                format!("The tenancy of {space} ends on day {}: offering {tenant} a new lease at {} a month, for {months} months from then.", ends.div_euclid(DAY), e.usd(rent)),
                vec![bound("lease", offer(&tenant, o))],
            ));
        }
    }

    /// Vacancies: list each free unit, at a markup over what we currently get for homes in that building.
    fn listings(&mut self, cx: &mut Cx, e: &Env, steps: &mut Vec<Step<Then>>, let_now: &BTreeSet<String>, offered_now: &[String]) {
        let me = self.me.clone();
        let base_markup = self.p.markup_bps;
        let markup = self.org().markup(base_markup);
        let open: Vec<Arc<Record>> = self.book.open("rental_listing").filter(|l| l.speaks_for.as_deref() == Some(me.as_str())).cloned().collect();
        let listing = |o: &Owned, rent: i64, cx: &Cx, account: &str| -> Call {
            let beds = o.bedrooms.map_or(String::new(), |b| format!(", {b} bedrooms"));
            let mut d = json!({ "structure": o.structure, "space": o.space, "type": o.type_, "rent": rent });
            if let Some(b) = o.bedrooms.filter(|b| *b != 0) {
                d["bedrooms"] = json!(b);
            }
            // The lease it's for (2a): the home to occupy, the rent monthly.
            let mut terms = json!({ "template": "lease", "commitments": [
                { "who": me, "does": { "outcome": { "occupancy": { "in": o.space } } } },
                { "who": "taker", "does": { "outcome": { "money": { "to": account, "amount": rent.to_string(), "for": "rent" } } }, "every": MONTH } ] });
            if self.p.after_term.is_some() {
                terms["then"] = json!(self.p.after_term);
            }
            say(
                "rental_listing",
                &format!("Home to let: {}{beds}, {} a month.", o.space, money_words(rent, &cx.ctx.world)),
                Say { data: Some(d), extra: vec![("offer", json!({ "by": me, "take_up": "apply", "available": 1, "terms": terms }))], ..Default::default() },
            )
        };
        for o in self.owned.clone() {
            let listed: Vec<&Arc<Record>> = open.iter().filter(|l| data(l).s("space") == Some(o.space.as_str()) && !let_now.contains(&l.id)).collect();
            if !self.taken(e, offered_now, &o.space) && listed.is_empty() {
                // What we get now for homes like it: the same building, the same number of bedrooms.
                let like = |a: &Arc<Record>| {
                    let lt = lease_terms(a, tenant_of(a, &me));
                    lt.structure.as_deref() == Some(o.structure.as_str()) && self.owned.iter().find(|x| Some(&x.space) == lt.space.as_ref()).map(|x| x.bedrooms) == Some(o.bedrooms)
                };
                let going: Vec<i64> = e.active.iter().filter(|a| like(a)).map(|a| self.rent_at(a, e.t)).collect();
                let base_rent = self.p.base_rent_for(&o.type_, o.bedrooms).unwrap_or(100_000);
                let reference = if going.is_empty() { base_rent } else { going.iter().sum::<i64>() / going.len() as i64 };
                let noise = 9_750 + cx.rng(&format!("price-{}", o.space)).below(501) as i128;
                let rent = ((i128::from(reference) * i128::from(10_000 + markup) * noise) / 100_000_000) as i64;
                let basis = if going.is_empty() { format!("the base rent for its size ({})", e.usd(reference)) } else { format!("what similar homes in the building let for ({})", e.usd(reference)) };
                steps.push(step(format!("Listing a vacant home at {}% over {basis}.", fmt_dec(markup, 100)), vec![listing(&o, rent, cx, &e.account)]));
            }
            // Unlet for a month: cut the asking rent (BoE: 5% a month).
            for l in listed {
                if e.t - l.at >= MONTH {
                    let was = whole(data(l).get("rent"));
                    let rent = was * (10_000 - self.p.cut_bps) / 10_000;
                    steps.push(step(
                        format!("Unlet for a month: cutting the asking rent {}%.", fmt_dec(self.p.cut_bps, 100)),
                        vec![withdraw(&l.id, Some("Relisting at a lower rent.")), listing(&o, rent, cx, &e.account)],
                    ));
                }
            }
        }
    }

    /// A tenant has died. Seen in our own buildings (someone leaving a home because they died): report it, if nobody
    /// has, and only where nobody else lives: the home empty, and nobody in or out of it for a day (those who share a
    /// home report a death themselves, and say who the family is, which we can't; docs/behaviour/deaths.md). Once
    /// registered: give notice on their lease, as it allows (the household may apply for a home again).
    fn deaths(&mut self, e: &Env, sites: &[&SiteCell], steps: &mut Vec<Step<Then>>) {
        let me = self.me.clone();
        // Registered, as far as we have been told: the entry sent to us, or a certified copy of one made on someone
        // else's report.
        let registered: BTreeSet<String> = self.book.all("death_registration").chain(self.book.all("death_certificate")).filter_map(|r| data(r).s("deceased").map(String::from)).collect();
        let tenants: BTreeMap<String, Arc<Record>> = e.active.iter().map(|a| (tenant_of(a, &me).to_string(), a.clone())).collect();
        for site in sites {
            for sp in site.structure.iter().flat_map(|s| s.spaces.iter()) {
                for l in sp.left.iter().flatten() {
                    let died = serde_json::to_value(&l.reason).ok().and_then(|v| v.as_str().map(String::from)) == Some("died".into());
                    let key = format!("died-{}", l.occupant);
                    if !died || !tenants.contains_key(&l.occupant) || registered.contains(&l.occupant) || self.handled.contains(&key) || !stood_empty(sp, e.t) {
                        continue;
                    }
                    self.handled.insert(key);
                    let Some(city) = self.p.city.clone() else { continue };
                    steps.push(step(
                        format!("Our tenant {} has died in {}: reporting it to the registry.", l.occupant, sp.space),
                        vec![say("death_notification", &format!("{}, our tenant at {}, has died.", l.occupant, sp.space), Say { to: Some(vec![city]), data: Some(json!({ "deceased": l.occupant })), ..Default::default() })],
                    ));
                }
            }
        }
        for who in &registered {
            let Some(a) = tenants.get(who) else { continue };
            if self.notice_given.contains_key(&a.id) {
                continue;
            }
            self.notice_given.insert(a.id.clone(), e.t);
            steps.push(step(format!("Our tenant {who} has died (registered): giving notice on their lease."), vec![notice(&a.id, "The tenant has died.")]));
        }
    }
}

/// When a lease's rent falls due first: the lease's own rent day where it names one (`attrs.first_due`), counted from
/// when its rent begins.
fn first_due_of(a: &Record, begins: i64) -> i64 {
    let extra = match &a.body {
        RecordBody::Agreement { terms } => terms.attrs.as_ref().and_then(|x| x.get("first_due")).and_then(Value::as_i64).filter(|d| *d > 0).unwrap_or(0),
        _ => 0,
    };
    begins + extra
}

fn lease_text(a: &Record) -> &str {
    match &a.body {
        RecordBody::Agreement { terms } => terms.text.as_deref().unwrap_or(""),
        _ => "",
    }
}

impl Office {
    /// The notice to vacate an application relies on: which paper, the day it was given and the day it gave. The
    /// tribunal cannot see what passed between landlord and tenant, so the application says it.
    fn notice_relied(&self, lease: &str) -> Map<String, Value> {
        let mut m = Map::new();
        let me = self.me.as_str();
        let n = self.book.all("notice_to_vacate").filter(|r| r.speaks_for.as_deref() == Some(me) && data(r).s("lease") == Some(lease)).max_by(|x, y| x.at.cmp(&y.at).then_with(|| crate::common::filed_before(&y.id, &x.id)));
        if let Some(n) = n {
            m.insert("notice".into(), json!(n.id));
            m.insert("notice_given".into(), json!(data(n).i("given").unwrap_or(n.at)));
            m.insert("notice_by".into(), json!(data(n).i("by").unwrap_or(0)));
        }
        m
    }

    fn fee_call(&self, fee: i64, to: Option<&String>, account: &str, what: &str, cx: &Cx) -> Vec<Call> {
        match (fee > 0, to) {
            (true, Some(to)) => vec![pay(to, fee, Pay { from: Some(account.to_string()), for_: Some(what.into()), ..Default::default() }, cx)],
            _ => vec![],
        }
    }

    /// Arrears: give notice after enough unpaid months (rent is due monthly in advance). Each tenant pays from the
    /// account on their first application, or the one the world started them with.
    fn arrears(&mut self, cx: &mut Cx, e: &Env, steps: &mut Vec<Step<Then>>) {
        let me = self.me.clone();
        let t = e.t;
        let mut paying_account: BTreeMap<String, String> = BTreeMap::new();
        for r in self.book.all("rental_application") {
            if let (Some(who), Some(acc)) = (r.speaks_for.as_ref(), data(r).s("account")) {
                paying_account.entry(who.clone()).or_insert_with(|| acc.to_string());
            }
        }
        // Otherwise the account a lease of theirs says they pay from (an earlier one, for a lease we've renewed: the new
        // one doesn't name it).
        for a in &e.leases {
            let tenant = tenant_of(a, &me).to_string();
            let from = match &a.body {
                RecordBody::Agreement { terms } => terms.commitments.iter().find(|c| c.who == tenant).and_then(|c| c.does.get("outcome")?.get("money")?.get("from")?.as_str().map(String::from)),
                _ => None,
            };
            if let Some(from) = from.filter(|_| !tenant.is_empty()) {
                paying_account.entry(tenant).or_insert(from);
            }
        }
        let law = if self.p.possession.is_some() { possession_law(&self.book) } else { None };
        // Tenancies already being ended when we first open our files (a town that opens in the middle of things:
        // docs/behaviour/generator.md): where each has got to is what its papers say, as it is for whoever takes an
        // office over. A notice to vacate of ours that stands: noticed, to its date. An application of ours for
        // possession: applied (any order on it is then read as any order is, at our next day for the rent book).
        if law.is_some() && self.p.possession.is_some() && !self.files_read {
            self.files_read = true;
            for a in &e.active {
                if self.ending.contains_key(&a.id) || self.notice_given.contains_key(&a.id) {
                    continue;
                }
                let n = self.book.open("notice_to_vacate").filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("lease") == Some(a.id.as_str())).max_by_key(|r| r.at);
                let applied = self.book.open("tribunal_application").any(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("kind") == Some("possession") && data(r).s("about") == Some(a.id.as_str()));
                if let Some(n) = n {
                    let by = data(n).i("by").unwrap_or(0);
                    self.ending.insert(a.id.clone(), Ending { stage: if applied { EndStage::Applied } else { EndStage::Noticed }, by, notice: None, seen: BTreeSet::new(), plan: None });
                }
            }
        }
        for a in e.active.clone() {
            if self.notice_given.contains_key(&a.id) && !self.ending.contains_key(&a.id) {
                continue;
            }
            let tenant = tenant_of(&a, &me).to_string();
            let rent = self.rent_at(&a, t);
            // Each lease is judged on its own: what has fallen due under it against what has come in since its rent began
            // (its signing; for a lease that renews one of ours, the end of that one's term, which the old lease's rent
            // covers until). Everything the tenant ever paid us, set against this lease's dues alone, would let someone on
            // a renewed lease stop paying for as long as they had paid before.
            let renewals_end = crate::common::bases_of(&a).iter().map(|b| self.renews_at.get(b).copied().unwrap_or(0)).max().unwrap_or(0);
            let begins = self.book.signed_at(&a.id).unwrap_or(0).max(0).max(renewals_end);
            // Rent owed when the year began, where our statement of the rent account says so: owed with the rest, and owed since.
            let carried = brought_forward(&self.book, &me, &a.id);
            let first_due = first_due_of(&a, begins);
            let since = first_due.min(carried.as_ref().map_or(i64::MAX, |c| c.1));
            let due = if t < first_due { 0 } else { (t - first_due).div_euclid(MONTH) + 1 };
            let mut owed = carried.as_ref().map_or(0, |c| c.0);
            for k in 0..due {
                owed += self.rent_at(&a, first_due + k * MONTH);
            }
            let paid: i64 = paying_account.get(&tenant).and_then(|acc| self.received.get(acc)).map_or(0, |v| v.iter().filter(|(at, _)| *at >= begins).map(|(_, amt)| amt).sum());
            // How long we bear with arrears is our practice, and our character's: one that would keep its tenants waits
            // longer than one that would be rid of them.
            let months = self.p.arrears_months_before_notice;
            let bears = self.org().patience(months);
            let behind = owed - paid;
            let routine_arrears = behind >= self.p.arrears_months_before_notice * rent;
            if self.org().lively && e.at_books {
                // One want a lease: a tenant on a renewed lease has two for a while, and the one paid up must not be
                // taken for the one behind.
                let held = self.org().wants.get(&a.id).cloned();
                // Behind by as much as our routine calls arrears, at two looks a week apart: a payment a few days late is not.
                if routine_arrears {
                    self.late_since.entry(a.id.clone()).or_insert(t);
                } else {
                    self.late_since.remove(&a.id);
                }
                if routine_arrears && t - self.late_since[&a.id] >= 7 * DAY && held.is_none() {
                    let c = self.org().character;
                    let weight = 5_000 + round_div(i128::from(c.be_rid - c.keep), 10) as i64;
                    self.org().wants.born(&a.id, &tenant, weight, t);
                } else if held.is_some() && behind < self.p.arrears_months_before_notice * rent {
                    self.org().wants.met(&a.id, t);
                }
                // Going after it (docs/behaviour/firm-wants.md), as a person goes after a want: first by asking (a letter
                // saying what is owed); then, when that has had its time, by taking it to a body that says it hears
                // arrears, if we can see one and would sooner have the money than be rid of the tenant; the notice our
                // routine gives comes when our patience runs out, as before.
                let held = self.org().wants.get(&a.id).cloned();
                let character = self.org().character;
                if let Some(h) = held.as_ref().filter(|h| h.tried == 0 && !self.ending.contains_key(&a.id) && t - self.asked_for.get(&a.id).copied().unwrap_or(i64::MIN / 2) >= 30 * DAY) {
                    let _ = h;
                    self.asked_for.insert(a.id.clone(), t);
                    self.org().wants.tried(&a.id, "ask", t);
                    steps.push(step(
                        format!("{tenant} is {} behind with the rent: writing to ask for it.", e.usd(behind)),
                        vec![say(
                            "request",
                            &format!("Request: the rent for your home is {} in arrears. Please pay it.", e.usd(behind)),
                            Say {
                                to: Some(vec![tenant.clone()]),
                                visible: visible(&[&me, &tenant]),
                                basis: Some(a.id.clone()),
                                data: Some(json!({ "matter": "arrears", "against": tenant, "about": a.id, "amount": behind, "account": e.account })),
                                ..Default::default()
                            },
                        )],
                    ));
                } else if held.as_ref().is_some_and(|h| h.way.as_deref() == Some("ask") && t - h.tried_at.unwrap_or(t) >= 30 * DAY) && character.keep >= character.be_rid {
                    let venue = self.book.hearings().find(|h| {
                        offer_of(h).and_then(|o| o.get("hears")).and_then(Value::as_array).is_some_and(|x| x.iter().any(|x| x.get("about").and_then(Value::as_str) == Some("arrears")))
                            && h.speaks_for.as_ref().unwrap_or(&h.author) != &me
                    });
                    if let Some(venue) = venue.cloned() {
                        let entry = offer_of(&venue).and_then(|o| o.get("hears")?.as_array()?.iter().find(|x| x.get("about").and_then(Value::as_str) == Some("arrears"))).cloned();
                        let fee = offer_of(&venue)
                            .and_then(|o| o.get("terms")?.get("commitments")?.as_array())
                            .into_iter()
                            .flatten()
                            .filter(|c| c.get("who").and_then(Value::as_str) == Some("taker"))
                            .filter_map(|c| c.get("does")?.get("outcome")?.get("money").cloned())
                            .find(|m| m.get("to").is_some());
                        let fee_amount = fee.as_ref().map(|f| whole(f.get("amount")));
                        if entry.is_some() && fee_amount.map_or(true, |f| e.balance >= f) {
                            let v = venue.speaks_for.clone().unwrap_or_else(|| venue.author.clone());
                            self.org().wants.tried(&a.id, &format!("desk:{v}"), t);
                            let form = entry.as_ref().and_then(|x| x.get("form")).and_then(Value::as_str).unwrap_or("application").to_string();
                            let mut calls = vec![say(
                                &form,
                                &format!("Application: {tenant} owes us {} in rent under {}.", e.usd(behind), a.id),
                                Say {
                                    to: Some(vec![v.clone()]),
                                    visible: visible(&[&me, &v, &tenant]),
                                    basis: Some(venue.id.clone()),
                                    data: Some(json!({ "kind": "arrears", "matter": "arrears", "against": tenant, "about": a.id, "amount": behind, "account": e.account, "evidence": { "id": a.id, "record": "agreement" } })),
                                    ..Default::default()
                                },
                            )];
                            if let Some(f) = &fee {
                                calls.push(pay(f.get("to").and_then(Value::as_str).unwrap_or(""), fee_amount.unwrap_or(0), Pay { from: Some(e.account.clone()), for_: Some("Application fee.".into()), ..Default::default() }, cx));
                            }
                            steps.push(step(format!("{tenant} is still {} behind a month after we asked: applying to {v} for an order to pay.", e.usd(behind)), calls));
                        }
                    }
                }
            }
            // ---- possession, where the world has a law on it (docs/behaviour/justice.md, "Possession") ----
            // A tenant behind with the rent is given a notice to vacate, which ends nothing by itself: paid up before its
            // date, it lapses; gone by its date, that is the end of it; still there, we apply to the tribunal for
            // possession. The tribunal may give the tenant a plan to pay (we come back if it is not kept) or order
            // possession by a date; a tenant still there after it is removed by the police, on a warrant we buy from the
            // tribunal's registrar. We never put anyone out ourselves.
            if let (Some(law), Some(poss)) = (law.as_ref(), self.p.possession.clone()) {
                if let Some(mut en) = self.ending.get(&a.id).cloned() {
                    if self.possession(cx, e, &a, &tenant, rent, behind, law, &poss, &mut en, steps) {
                        self.ending.remove(&a.id);
                    } else {
                        self.ending.insert(a.id.clone(), en);
                    }
                    continue;
                }
                if e.at_books && routine_arrears_for(behind, bears, rent) && t - since >= bears * MONTH && behind >= rent && !self.notice_given.contains_key(&a.id) {
                    // A date by the day: the first day to begin once the notice's days have run in full, counted from
                    // when the notice is on the record. The step is made again for the moment it is sent.
                    let home = lease_terms(&a, &tenant);
                    let g = VacateGive {
                        lease: a.id.clone(),
                        tenant: tenant.clone(),
                        space: home.space.clone().unwrap_or_else(|| "the home".into()),
                        arrears: behind,
                        law: law.id.clone(),
                        arrears_days: law.arrears_days,
                        notice_days: law.notice_days,
                        bears,
                        by: starts_on(t, law.notice_days * DAY),
                    };
                    let seen: BTreeSet<String> = self.book.all("tribunal_order").filter(|o| data(o).s("about") == Some(a.id.as_str())).map(|o| o.id.clone()).collect();
                    self.ending.insert(a.id.clone(), Ending { stage: EndStage::Noticed, by: g.by, notice: None, seen, plan: None });
                    if self.org().wants.get(&a.id).is_some() {
                        self.org().wants.tried(&a.id, "notice", t);
                    }
                    self.org().remember(t, "gave_notice", Some(&tenant), 3_000);
                    steps.push(vacate_notice(&me, &g, &self.world));
                    continue;
                }
            }
            if self.notice_given.contains_key(&a.id) {
                continue;
            }
            if e.at_books && routine_arrears_for(behind, bears, rent) && t - since >= bears * MONTH {
                self.notice_given.insert(a.id.clone(), t);
                if self.org().wants.get(&a.id).is_some() {
                    self.org().wants.tried(&a.id, "notice", t);
                }
                self.org().remember(t, "gave_notice", Some(&tenant), 3_000);
                steps.push(step(format!("Rent is {bears} or more months in arrears: giving notice."), vec![notice(&a.id, "Notice: rent is in arrears.")]));
            }
        }
    }
}

/// Behind by as many rents as we bear with.
fn routine_arrears_for(behind: i64, bears: i64, rent: i64) -> bool {
    behind >= bears * rent
}

impl Office {
    /// A tenancy being ended under the law on possession, taken one step on. True when it is over (to be forgotten).
    #[allow(clippy::too_many_arguments)]
    fn possession(&mut self, cx: &mut Cx, e: &Env, a: &Arc<Record>, tenant: &str, rent: i64, behind: i64, law: &PossessionLaw, poss: &Possession, en: &mut Ending, steps: &mut Vec<Step<Then>>) -> bool {
        let me = self.me.clone();
        let t = e.t;
        let home = lease_terms(a, tenant);
        let space = home.space.clone().unwrap_or_else(|| "the home".into());
        // A warrant asked for, and the tenant's notice that they have gone has come: the registrar is told at once, by our
        // request withdrawn, so that nobody is sent to put out someone who has left. (In the fifth living pilot 11 of 23
        // warrants were carried out at homes the household had left inside the notice of the day.)
        if en.stage == EndStage::Warrant
            && !en.seen.contains("warrant-withdrawn")
            && self.book.notices(&a.id).any(|n| n.party == tenant)
            && !self.book.all("warrant_executed").any(|w| data(w).s("lease") == Some(a.id.as_str()))
        {
            en.seen.insert("warrant-withdrawn".into());
            let requests: Vec<Arc<Record>> = self.book.open("warrant_request").filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("order") == en.notice.as_deref()).cloned().collect();
            for w in requests {
                steps.push(step(format!("{tenant} has left {space} since we asked for a warrant: telling the tribunal's registrar there is nobody to remove."), vec![withdraw(&w.id, Some("Withdrawn: the tenant has left the home."))]));
            }
        }
        // Taken forward on our own day for the rent book, as arrears are taken up: never at whatever look comes first.
        if !e.at_books {
            return false;
        }
        let gone = self.book.notices(&a.id).any(|n| n.party == tenant);
        let mut orders: Vec<Arc<Record>> = self
            .book
            .all("tribunal_order")
            .filter(|o| data(o).s("kind") == Some("possession") && data(o).s("applicant") == Some(me.as_str()) && data(o).s("about") == Some(a.id.as_str()) && !en.seen.contains(&o.id))
            .cloned()
            .collect();
        let executed = self.book.all("warrant_executed").any(|w| data(w).s("lease") == Some(a.id.as_str()));
        let apps_of = |book: &Book| -> Vec<Arc<Record>> {
            book.open("tribunal_application").filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("kind") == Some("possession") && data(r).s("about") == Some(a.id.as_str())).cloned().collect()
        };
        if gone || executed {
            // They have gone, or been put out: the tenancy is over. On the record it ends by its own terms.
            if !self.notice_given.contains_key(&a.id) {
                self.notice_given.insert(a.id.clone(), t);
                steps.push(step(format!("{tenant} has left {space}: ending the tenancy on the record."), vec![notice(&a.id, "Notice: the tenancy is ended for arrears; the tenant has left.")]));
            }
            // An application for possession of a home already given up asks the tribunal for nothing it can give:
            // withdrawn. (Until 2026-10-12 it stood, and the tribunal gave someone who had gone six weeks to answer.)
            let decided: BTreeSet<String> = self.book.all("tribunal_order").filter(|o| data(o).s("applicant") == Some(me.as_str())).map(|o| data(o).s("application").unwrap_or("").to_string()).collect();
            for app in apps_of(&self.book).into_iter().filter(|r| !decided.contains(&r.id)) {
                steps.push(step(
                    format!("{tenant} has left {space}: withdrawing our application for possession ({}); there is nothing left for the tribunal to order.", app.id),
                    vec![withdraw(&app.id, Some("Withdrawn: the tenant has left the home."))],
                ));
            }
            return true;
        }
        if en.stage == EndStage::Noticed && behind < rent {
            let n = self.book.open("notice_to_vacate").find(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("lease") == Some(a.id.as_str())).cloned();
            self.org().remember(t, "arrears_paid", Some(tenant), 1_000);
            steps.push(step(format!("{tenant} has paid the rent that was owed: our notice to vacate lapses."), n.iter().map(|n| withdraw(&n.id, Some("Lapsed: the arrears are paid."))).collect()));
            return true;
        }
        if en.stage == EndStage::Noticed && t >= en.by {
            let fee = poss.fee.unwrap_or(0);
            if e.balance >= fee {
                en.stage = EndStage::Applied;
                let mut d = json!({ "kind": "possession", "matter": "possession", "against": tenant, "about": a.id, "amount": behind, "rent": rent, "account": e.account,
                    "household": household_named(lease_text(a), tenant), "evidence": { "id": a.id, "record": "agreement" } });
                if let Some(s) = &home.space {
                    d["space"] = json!(s);
                    d["structure"] = json!(home.structure);
                }
                d.as_object_mut().unwrap().extend(self.notice_relied(&a.id));
                let mut calls = vec![say(
                    "tribunal_application",
                    &format!("Application for possession: {tenant} is {} behind with the rent under {} and has not left on our notice to vacate.", e.usd(behind), a.id),
                    Say { to: Some(vec![poss.tribunal.clone()]), visible: visible(&[&me, &poss.tribunal, tenant]), basis: Some(a.id.clone()), data: Some(d), ..Default::default() },
                )];
                calls.extend(self.fee_call(fee, poss.fee_account.as_ref(), &e.account, "Application fee.", cx));
                steps.push(step(format!("Our notice to vacate has run out and {tenant} is still in {space}, {} behind: applying to the tribunal for possession.", e.usd(behind)), calls));
            }
            return false;
        }
        if en.stage == EndStage::Applied && orders.is_empty() && behind <= 0 {
            // Paid up while the application stands: there is nothing left to ask the tribunal for. Withdrawn.
            for app in apps_of(&self.book) {
                steps.push(step(
                    format!("{tenant} has paid the rent that was owed since we applied: withdrawing our application for possession ({}).", app.id),
                    vec![withdraw(&app.id, Some("Withdrawn: the rent owed has been paid."))],
                ));
            }
            self.org().remember(t, "arrears_paid", Some(tenant), 1_000);
            return true;
        }
        let answered_now: Vec<Arc<Record>> = self
            .book
            .all("tribunal_response")
            .filter(|r| r.speaks_for.as_deref() == Some(tenant) && !en.seen.contains(&r.id) && !data(r).get("left").is_some_and(truthy))
            .filter(|r| self.book.open("tribunal_application").any(|x| x.speaks_for.as_deref() == Some(me.as_str()) && Some(x.id.as_str()) == data(r).s("application")))
            .cloned()
            .collect();
        if en.stage == EndStage::Applied && orders.is_empty() && !answered_now.is_empty() {
            // The tenant has answered the tribunal: we reply with what our rent book shows owed today, and whether we
            // would take the plan they offer (one that clears what is owed within the law's longest), where their sum
            // differs from ours or they offer something. The member decides on what both have said.
            let all: Vec<Arc<Record>> = self.book.all("tribunal_response").filter(|x| x.speaks_for.as_deref() == Some(tenant) && !en.seen.contains(&x.id)).cloned().collect();
            for r in all {
                en.seen.insert(r.id.clone());
                let d = data(&r);
                let app = d.s("application").unwrap_or("").to_string();
                let offer_amount = whole(d.get("offer"));
                let theirs = d.get("owes").map(|o| whole(Some(o)));
                if !self.book.open("tribunal_application").any(|x| x.speaks_for.as_deref() == Some(me.as_str()) && x.id == app) || (offer_amount <= 0 && theirs.map_or(true, |t| t == behind)) {
                    continue;
                }
                let takes = (offer_amount > 0).then(|| law.plan_months > 0 && behind <= offer_amount * law.plan_months);
                let mut words = format!("Reply on application {app}: our rent book shows {} owed by {tenant} today.", e.usd(behind));
                match takes {
                    Some(true) => words.push_str(&format!(" We would take the plan offered ({} a month).", e.usd(offer_amount))),
                    Some(false) => words.push_str(&format!(" We would not take the plan offered ({} a month).", e.usd(offer_amount))),
                    None => {}
                }
                let mut data = json!({ "application": app, "against": tenant, "owed": behind });
                if let Some(tp) = takes {
                    data["takes_plan"] = json!(tp);
                }
                steps.push(step(
                    format!("{tenant} has answered the tribunal on our application {app}: replying with what our rent book shows."),
                    vec![say("tribunal_reply", &words, Say { to: Some(vec![poss.tribunal.clone(), tenant.to_string()]), visible: visible(&[&me, &poss.tribunal, tenant]), basis: Some(app.clone()), data: Some(data), ..Default::default() })],
                ));
            }
            return false;
        }
        if matches!(en.stage, EndStage::Applied | EndStage::Plan) && !orders.is_empty() {
            orders.sort_by(|x, y| y.at.cmp(&x.at));
            let o = orders[0].clone();
            for x in &orders {
                en.seen.insert(x.id.clone());
            }
            match data(&o).s("finding") {
                Some("plan") => {
                    en.stage = EndStage::Plan;
                    en.plan = Some(PlanSet { at: t, owed: behind, instalment: whole(data(&o).get("instalment")) });
                }
                Some("possession") => {
                    en.stage = EndStage::Ordered;
                    en.by = data(&o).i("due").filter(|d| *d != 0).unwrap_or(t);
                    en.notice = Some(o.id.clone());
                    // The tenancy is ended on the record now: by the lease's own terms, which is some weeks on.
                    if !self.notice_given.contains_key(&a.id) {
                        self.notice_given.insert(a.id.clone(), t);
                        steps.push(step(
                            format!("The tribunal orders possession of {space} by {}: ending the tenancy on the record.", e.date(en.by)),
                            vec![notice(&a.id, "Notice: possession ordered by the tribunal for arrears.")],
                        ));
                    }
                }
                // Dismissed: the arrears were paid, or it was not made out; we begin again if they fall behind.
                _ => return true,
            }
            return false;
        }
        if en.stage == EndStage::Plan {
            if let Some(plan) = en.plan.clone() {
                // A plan kept: the arrears come down by the instalment each month. Paid off: done. Not kept a month and a
                // week on: back to the tribunal, saying so.
                let months = (t - plan.at).div_euclid(MONTH);
                if behind < rent {
                    return true;
                }
                if t - plan.at >= MONTH + 7 * DAY && behind > plan.owed - months * plan.instalment + rent / 2 && e.balance >= poss.fee.unwrap_or(0) {
                    en.stage = EndStage::Applied;
                    let fee = poss.fee.unwrap_or(0);
                    let mut d = json!({ "kind": "possession", "matter": "possession", "against": tenant, "about": a.id, "amount": behind, "rent": rent, "account": e.account, "breach": true,
                        "household": household_named(lease_text(a), tenant), "evidence": { "id": a.id, "record": "agreement" } });
                    if let Some(s) = &home.space {
                        d["space"] = json!(s);
                        d["structure"] = json!(home.structure);
                    }
                    d.as_object_mut().unwrap().extend(self.notice_relied(&a.id));
                    let mut calls = vec![say(
                        "tribunal_application",
                        &format!("Application for possession: {tenant} has not kept the payment plan ordered, and is {} behind with the rent under {}.", e.usd(behind), a.id),
                        Say { to: Some(vec![poss.tribunal.clone()]), visible: visible(&[&me, &poss.tribunal, tenant]), basis: Some(a.id.clone()), data: Some(d), ..Default::default() },
                    )];
                    calls.extend(self.fee_call(fee, poss.fee_account.as_ref(), &e.account, "Application fee.", cx));
                    steps.push(step(
                        format!(
                            "{tenant} has not kept the plan the tribunal set ({} behind, where the plan would have it under {}): applying again for possession.",
                            e.usd(behind),
                            e.usd((plan.owed - months * plan.instalment).max(0))
                        ),
                        calls,
                    ));
                }
            }
            return false;
        }
        if en.stage == EndStage::Ordered && t >= en.by + DAY && e.balance >= poss.warrant_fee.unwrap_or(0) {
            en.stage = EndStage::Warrant;
            let fee = poss.warrant_fee.unwrap_or(0);
            let order = en.notice.clone().unwrap_or_default();
            let mut calls = vec![say(
                "warrant_request",
                &format!("Request for a warrant of possession under order {order}: {tenant} has not left."),
                Say { to: Some(vec![poss.tribunal.clone()]), visible: visible(&[&me, &poss.tribunal]), basis: Some(order.clone()), data: Some(json!({ "order": order })), ..Default::default() },
            )];
            calls.extend(self.fee_call(fee, poss.fee_account.as_ref(), &e.account, "Warrant fee.", cx));
            steps.push(step("The date the tribunal set for possession has passed and the tenant has not left: asking the tribunal's registrar for a warrant.".replace("the tenant", tenant), calls));
            return false;
        }
        if en.stage == EndStage::Warrant {
            // A warrant nobody came to carry out in its time has lapsed: we ask for another.
            let lapsed: Vec<String> = self.book.all("warrant_lapsed").filter(|w| data(w).s("lease") == Some(a.id.as_str()) && !en.seen.contains(&w.id)).map(|w| w.id.clone()).collect();
            if !lapsed.is_empty() {
                en.seen.extend(lapsed);
                en.stage = EndStage::Ordered;
            }
        }
        false
    }
}

impl Office {
    /// What the landlord knows of comparable homes (same building and size as `unit`): what it has let them for lately,
    /// what it asks for those it has listed, how many stand empty, and any `rental_evidence` paper published to it
    /// (docs/behaviour/firms.md, "Rent reviews follow the market"). Nothing here sees past its own books and what is
    /// published.
    fn evidence(&self, e: &Env, unit: &Owned, lease: &str, offered_now: &[String]) -> Evidence {
        let me = self.me.as_str();
        let comparable = |o: &Owned| o.structure == unit.structure && o.bedrooms == unit.bedrooms;
        let mut ev = Evidence::default();
        for o in self.owned.iter().filter(|o| comparable(o)) {
            ev.homes += 1;
            if !self.taken(e, offered_now, &o.space) {
                ev.vacant += 1;
            }
        }
        for x in e.leases.iter().filter(|x| x.id != lease) {
            let lt = lease_terms(x, tenant_of(x, me));
            let Some(o) = self.owned.iter().find(|o| Some(&o.space) == lt.space.as_ref()) else { continue };
            if comparable(o) && self.book.signed_at(&x.id).is_some_and(|s| s >= e.t - self.p.evidence_days * DAY) && self.book.in_force(&x.id) {
                ev.lets.push(lt.rent);
            }
        }
        for l in self.book.open("rental_listing").filter(|l| l.speaks_for.as_deref() == Some(me)) {
            let d = data(l);
            if d.s("structure") == Some(unit.structure.as_str()) && d.i("bedrooms") == unit.bedrooms {
                ev.asking.push(whole(d.get("rent")));
            }
        }
        // The market office's published evidence, where there is any: a rents board for the kind of home (the typed
        // `RentalEvidence` paper `world.rent_portal` writes; a statement of that kind that does not read as one is not evidence).
        for b in self.book.open("rental_evidence") {
            let Some(w) = crate::papers::read::<RentalEvidence>(b) else { continue };
            if w.type_ != unit.type_ || w.bedrooms.is_some() && w.bedrooms != unit.bedrooms {
                continue;
            }
            ev.lets.extend(w.lets);
            ev.asking.extend(w.asking);
            ev.homes += w.homes;
            ev.vacant += w.vacant;
        }
        ev
    }

    /// Rent reviews: once a review period (our practice, the law bounding it), a tenancy's rent moves toward what
    /// comparable homes let and ask for (`oikos_rules::rent`): a rise by notice, with the notice the law requires; a
    /// fall only where homes like it stand empty, offered at renewal as the new lease's rent.
    fn rent_reviews(&mut self, cx: &mut Cx, e: &Env, steps: &mut Vec<Step<Then>>, offered_now: &[String]) {
        let Some(review_months) = self.p.rent_review_months.filter(|m| *m > 0) else { return };
        let me = self.me.clone();
        let t = e.t;
        let notice_days = self.p.rent_increase_notice_days;
        for a in e.active.clone() {
            // A lease we've offered to renew isn't reviewed: the new one carries its rent, and its own reviews.
            if self.notice_given.contains_key(&a.id) || self.renewed.contains(&a.id) {
                continue;
            }
            // A review period runs from the notice on the record, not from the moment we decided: the notice is made a
            // few minutes later, by how long it takes to say, and counting from the decision gave two notices a little
            // under a period apart.
            let mut since = self.last_review.get(&a.id).copied().or_else(|| self.book.signed_at(&a.id)).unwrap_or(0);
            for n in self.book.open("rent_increase") {
                if n.speaks_for.as_deref() == Some(me.as_str()) && data(n).s("lease") == Some(a.id.as_str()) && n.at > since && n.at <= t {
                    since = n.at;
                }
            }
            if t - since < review_months * MONTH {
                continue;
            }
            // A tenancy that ends before a new rent could begin, the tenant having given notice, has no rent to review.
            if self.book.ends_at(&a.id).is_some_and(|ends| ends <= t + notice_days * DAY) {
                continue;
            }
            let tenant = tenant_of(&a, &me).to_string();
            let lt = lease_terms(&a, &tenant);
            let Some(unit) = self.owned.iter().find(|o| Some(&o.space) == lt.space.as_ref()).cloned() else { continue };
            let now = self.rent_at(&a, t);
            let ev = self.evidence(e, &unit, &a.id, offered_now);
            let market = reviewed(now, &ev, &self.p.review());
            if market == now {
                self.last_review.insert(a.id.clone(), t);
                continue;
            }
            if market < now {
                // A fall cannot be a notice of rent increase: it is offered at renewal, as the new lease's rent.
                self.last_review.insert(a.id.clone(), t);
                self.falls.insert(a.id.clone(), market);
                continue;
            }
            // The notice states when the rent last changed, as a notice of rent increase does. The law as we read it: the
            // soonest the increase can start without breaching a law in force, a week at a time. If none within half a
            // year, we wait and look again next month; unless we don't comply, and raise it anyway.
            let last_from = self.rent_changes.get(&a.id).and_then(|v| v.last()).map_or_else(|| self.book.signed_at(&a.id).unwrap_or(0), |c| c.from);
            let act = |from: i64| json!({ "block": "publish", "kind": "rent_increase", "data": { "lease": a.id, "rent": market, "from": from, "was": now, "last_from": last_from } });
            // An increase starts with a day: the first to begin once the notice has run.
            let mut lead = notice_days * DAY;
            let mut broken = breaches(&mut self.book, &act(starts_on(t, lead)), &me, t);
            while !broken.is_empty() && lead < (notice_days + 182) * DAY {
                lead += 7 * DAY;
                broken = breaches(&mut self.book, &act(starts_on(t, lead)), &me, t);
            }
            let complies = self.obeys(cx, &format!("rent-law-{}-{t}", a.id));
            if !broken.is_empty() && complies {
                continue;
            }
            if !broken.is_empty() {
                lead = notice_days * DAY; // not complying: our own practice, whatever the law says
            }
            self.last_review.insert(a.id.clone(), t);
            let why = if !broken.is_empty() {
                format!("; this breaches {}, and we raise it anyway", broken.iter().map(|l| l.id.clone()).collect::<Vec<_>>().join(", "))
            } else if lead > notice_days * DAY {
                ", from as soon as the law allows".to_string()
            } else {
                String::new()
            };
            let basis = if ev.lets.is_empty() && ev.asking.is_empty() { "no evidence".to_string() } else { format!("{} recent lets and {} asking rents of comparable homes", ev.lets.len(), ev.asking.len()) };
            let g = RentGive {
                lease: a.id.clone(),
                tenant,
                space: unit.space.clone(),
                rent: market,
                was: now,
                last_from,
                lead,
                from: starts_on(t, lead),
                why: format!(
                    "A rent review (every {review_months} months): by {basis}, what {} should let for now is {} a month, against the {} it lets for: moving it, with {} days' notice{why}.",
                    unit.space,
                    e.usd(market),
                    e.usd(now),
                    round_div(i128::from(lead), i128::from(DAY)) as i64
                ),
            };
            self.rent_changes.entry(a.id.clone()).or_default().push(RentChange { from: g.from, rent: market });
            steps.push(rent_notice(&me, &g, &self.world));
        }
    }

    /// Monthly: owners spend part of the income locally; upkeep is bought from outside.
    fn monthly(&mut self, cx: &mut Cx, e: &Env, steps: &mut Vec<Step<Then>>) {
        let t = e.t;
        if t < self.next_spend {
            return;
        }
        self.next_spend = t + MONTH;
        // Tax on rent received (the town's tax law): report it and pay, or (when not complying) report only half. The
        // tax clerk sees only the report.
        let mut tax = 0;
        if let (Some(city), Some(city_account)) = (self.p.city.clone(), self.p.city_account.clone()) {
            if self.p.tax_rate_bps != 0 && self.income > 0 {
                let honest = self.obeys(cx, &format!("tax-{t}"));
                let reported = if honest { self.income } else { self.income.div_euclid(2) };
                tax = e.balance.min(reported * self.p.tax_rate_bps / 10_000);
                let mut calls = vec![say(
                    "tax_report",
                    &format!("Rent received this month: {}.", e.usd(reported)),
                    Say { to: Some(vec![city]), data: Some(json!({ "period_end": t, "rent_received": reported, "account": e.account })), ..Default::default() },
                )];
                if tax > 0 {
                    calls.push(pay(&city_account, tax, Pay { from: Some(e.account.clone()), for_: Some("Tax on rent received.".into()), ..Default::default() }, cx));
                }
                steps.push(step(
                    if honest { "Monthly: reporting rent received to the town, and paying tax at the rate the law sets." } else { "Monthly: reporting rent received to the town (only half of it), and paying tax on that." },
                    calls,
                ));
            }
        }
        let spend = (e.balance - tax).min(self.income * self.p.spend_share_bps / 10_000);
        let upkeep = (e.balance - tax - spend).min(self.income * self.p.upkeep_share_bps / 10_000);
        self.income = 0;
        // The owners' draw: to the shareholders on our register, if we keep one (they spend it as they will: lengnick.ts
        // `distribute`, one instruction to the bank); a world without one keeps the money-only stand-in, spent at a
        // local shop.
        let shops = self.p.shop_accounts.clone();
        let from = crate::market::lengnick::From { account: &e.account, custodian: &e.custodian };
        let world = e.world.clone();
        let (draw, _) = crate::market::lengnick::distribute::<Then>(
            &self.book,
            &self.me,
            &from,
            spend,
            &format!("Monthly: the owners draw {}% of rent received, paid to our shareholders by their shares", fmt_dec(self.p.spend_share_bps, 100)),
            &|n| crate::common::money_words(n, &world),
        );
        let drew = !draw.is_empty();
        steps.extend(draw);
        let mut calls = vec![];
        if !drew && spend > 0 && !shops.is_empty() {
            let shop = shops[cx.rng("spend").below(shops.len() as u64) as usize].clone();
            calls.push(pay(&shop, spend, Pay { from: Some(e.account.clone()), for_: Some("Owners' spending.".into()), ..Default::default() }, cx));
        }
        if let (true, Some(outside)) = (upkeep > 0, self.p.outside_account.clone()) {
            calls.push(pay(&outside, upkeep, Pay { from: Some(e.account.clone()), for_: Some("Maintenance and repairs.".into()), ..Default::default() }, cx));
        }
        if !calls.is_empty() {
            let locally = if shops.is_empty() || drew { String::new() } else { format!(", and the owners spend {}% locally", fmt_dec(self.p.spend_share_bps, 100)) };
            steps.push(step(format!("Monthly: {}% of rent received goes on upkeep{locally}.", fmt_dec(self.p.upkeep_share_bps, 100)), calls));
        }
    }
}

impl Office {
    /// What we can spend: what is in the account, less what we already owe out of it (buildings asked for and not yet
    /// paid, payments on their way, invoices in hand). Until 2026-10-09 it was the balance alone: a landlord asked for a
    /// second house on the money that was to pay for the first, and the second was never paid for.
    fn free(&self, balance: i64) -> i64 {
        let me = self.me.as_str();
        let invoices: i64 = self
            .book
            .open("invoice")
            .filter(|inv| !self.answered.contains(&inv.id) && crate::common::addressed_to(inv).contains(&self.me) && data(inv).get("outcome").and_then(|o| o.get("money")).is_some())
            .filter(|inv| !self.owing.contains_key(data(inv).s("agreement").unwrap_or("")))
            .map(|inv| whole(data(inv).get("outcome").and_then(|o| o.get("money")).and_then(|m| m.get("amount"))))
            .sum();
        let _ = me;
        balance - self.owing.values().sum::<i64>() - self.paying.values().map(|x| x.0).sum::<i64>() - invoices
    }

    /// Development: once every home we have has been let for a while, build on a site we own. Apply for a permit; if
    /// refused, comply, or (with probability 1 - compliance) build anyway.
    fn development(&mut self, cx: &mut Cx, e: &Env, sites: &[&SiteCell], own_lots: &[String], steps: &mut Vec<Step<Then>>) {
        let t = e.t;
        let me = self.me.clone();
        let units = self.owned.len() as i64;
        self.vacancy_history.push((t, (units - e.active.len() as i64).max(0), units));
        while self.vacancy_history.first().is_some_and(|h| h.0 < t - self.p.develop_window_days * DAY) {
            self.vacancy_history.remove(0);
        }
        let vacant_sum: i64 = self.vacancy_history.iter().map(|h| h.1).sum();
        let unit_sum: i64 = self.vacancy_history.iter().map(|h| h.2).sum();
        let occupied_enough = t >= self.p.develop_window_days * DAY && unit_sum > 0 && vacant_sum * 10_000 <= unit_sum * self.p.develop_max_vacancy_bps;
        // A lot of ours with nothing on it yet.
        let empty_lots: Vec<&String> = own_lots
            .iter()
            .filter(|l| {
                let cells = cells_of(&self.book, l);
                !cells.is_empty() && cells.iter().all(|c| sites.iter().any(|s| s.cell == *c && s.structure.is_none()))
            })
            .collect();
        // What the builder charges for it, from its published prices.
        let price = self.p.builder.as_ref().and_then(|b| published_price(&self.book, b, &self.p.develop_type, "prices"));
        // (A payment told to the bank and not seen to leave in a week is no longer counted as on its way.)
        self.paying.retain(|_, x| t - x.1 < 7 * DAY);
        if let (true, None, true, true, Some(lot), Some(price), Some(city), Some(_)) =
            (self.p.develop, self.dev.as_ref().map(|_| ()), t >= self.dev_cooldown_until, occupied_enough, empty_lots.first().map(|l| (*l).clone()), price, self.p.city.clone(), self.p.builder.clone())
        {
            if self.free(e.balance) >= price + price / 2 {
                self.dev = Some(Dev { lot: lot.clone(), stage: Stage::Applying, app: None, permit: None, contract: None, offered_at: None, not_before: None, told: None });
                // The planning office's published form (it's in the world's genesis records).
                steps.push(step_lines(
                    format!("Our homes have been {}% let over {} days: applying to build on an empty lot of ours.", 100 - (vacant_sum * 100).div_euclid(unit_sum.max(1)), self.p.develop_window_days),
                    vec![bound("app", call("form", vec![("to", Some(arg(&city))), ("form", Some(arg("permit_application"))), ("lot", Some(arg(&lot))), ("structure_type", Some(arg(&self.p.develop_type)))]))],
                ));
            }
        }
        if let Some(app) = self.dev.as_ref().filter(|d| d.stage == Stage::Applied).and_then(|d| d.app.clone()) {
            let decision = self.book.open("permit_decision").find(|d| data(d).s("application") == Some(app.as_str())).and_then(|d| data(d).s("decision").map(String::from));
            match decision.as_deref() {
                Some("granted") => self.dev.as_mut().unwrap().stage = Stage::Granted,
                Some("refused") => {
                    if self.obeys(cx, &format!("refusal-{app}")) {
                        self.dev = None;
                        self.dev_cooldown_until = t + 180 * DAY;
                    } else {
                        self.dev.as_mut().unwrap().stage = Stage::Refused; // building anyway
                    }
                }
                _ => {}
            }
        }
        // The builder's answer to our offer (it declines in writing, saying why: docs/behaviour/building.md), read with
        // the week's post: at our first plan a week or more after we offered, never in the moment it comes (a wake is
        // not always a week apart: news wakes us too). Until 2026-10-08 nothing read it: an offer declined left us
        // waiting for a building for good, and we never built again. Declined for the price (the list changed as we
        // offered): the offer is dead, the permit stands, and we decide again below at what the builder charges now, as
        // with any permit in hand. Declined for the site (the builder says it can't build there): this plan is over, and
        // we wait as long as after a refusal we accept before thinking of building again.
        if let Some((contract, offered_at)) = self.dev.as_ref().filter(|d| d.stage == Stage::Contracted).and_then(|d| Some((d.contract.clone()?, d.offered_at.unwrap_or(t)))) {
            if t - offered_at >= 7 * DAY {
                let no = self.book.all("offer_declined").find(|r| data(r).s("agreement") == Some(contract.as_str()) && crate::common::addressed_to(r).contains(&me)).cloned();
                if let Some(no) = no {
                    self.owing.remove(&contract); // an offer declined is nothing owed
                    let price = data(&no).get("price").map(|p| whole(Some(p)));
                    let dev = self.dev.as_mut().unwrap();
                    match (price, dev.permit) {
                        (Some(price), Some(permit)) => {
                            dev.told = Some((price, no.at));
                            dev.stage = if permit == Permit::Refused { Stage::Refused } else { Stage::Granted };
                            dev.contract = None;
                        }
                        _ => {
                            self.dev = None;
                            self.dev_cooldown_until = t + 180 * DAY;
                        }
                    }
                }
            }
        }
        // What it charges now: its standing list, or its letter to us where we hold no list as late as the letter.
        let builder = self.p.builder.clone();
        let told = self.dev.as_ref().and_then(|d| d.told);
        let list_since = |at: i64| self.book.open("price_list").any(|r| (r.speaks_for == builder || Some(&r.author) == builder.as_ref()) && r.at >= at);
        let price_now = match (told, price) {
            (Some((p, at)), _) if !list_since(at) => Some(p),
            (_, p) => p,
        };
        // (A decline just read has given back what that offer held.)
        let ready = self.dev.as_ref().is_some_and(|d| matches!(d.stage, Stage::Granted | Stage::Refused) && d.not_before.map_or(true, |nb| t >= nb));
        if let (true, Some(price_now), Some(builder)) = (ready, price_now.or(Some(i64::MAX)).filter(|_| self.dev.is_some()), self.p.builder.clone()) {
            if price_now != i64::MAX && self.free(e.balance) >= price_now {
                let develop_type = self.p.develop_type.clone();
                let d = self.dev.as_mut().unwrap();
                let refused = d.stage == Stage::Refused;
                let again = d.told.is_some();
                d.permit = Some(if refused { Permit::Refused } else { Permit::Granted });
                d.stage = Stage::Contracted;
                d.offered_at = Some(t);
                let lot = d.lot.clone();
                let why = if again {
                    format!("The builder declined our offer: its price is now {}, which we can pay. Offering again at that.", e.usd(price_now))
                } else if refused {
                    "The permit was refused: building anyway.".to_string()
                } else {
                    "The permit was granted: commissioning the builder.".to_string()
                };
                let mut s = step_lines(
                    why,
                    vec![bound("build", call("structure", vec![("type", Some(arg(&develop_type))), ("on", Some(arg(&lot))), ("by", Some(arg(&builder))), ("price", Some(crate::steps::amount_text(price_now, cx))), ("from", Some(arg(&e.account)))]))],
                );
                // The agreement we offered, to know the builder's answer by.
                s.then = Some(Then::Build { price: price_now, planned: t });
                steps.push(s);
            }
        }
        if let Some(d) = self.dev.as_ref().filter(|d| d.stage == Stage::Contracted) {
            let cells = cells_of(&self.book, &d.lot);
            if sites.iter().any(|s| cells.contains(&s.cell.as_str()) && s.structure.is_some()) {
                self.dev = None;
            }
        }
    }

    /// Invoices addressed to us (from the builder, the utilities): pay each when we can, oldest first, out of what is in
    /// the account and not already on its way out. One we can't pay yet stays open, and is paid when we can. (Until
    /// 2026-10-09 an invoice was marked answered before we looked at the balance: one that came when we were short was
    /// never paid, and the builder built houses nobody paid for.)
    fn invoices(&mut self, e: &Env, cx: &mut Cx, steps: &mut Vec<Step<Then>>) {
        let me = self.me.clone();
        let mut in_hand = e.balance - self.paying.values().map(|x| x.0).sum::<i64>();
        let open: Vec<Arc<Record>> = self.book.open("invoice").cloned().collect();
        for inv in open {
            if self.answered.contains(&inv.id) || !crate::common::addressed_to(&inv).contains(&me) {
                continue;
            }
            let Some(money) = data(&inv).get("outcome").and_then(|o| o.get("money")).cloned() else {
                self.answered.insert(inv.id.clone()); // nothing we can pay by
                continue;
            };
            let amount = whole(money.get("amount"));
            if in_hand < amount {
                continue; // not yet
            }
            self.answered.insert(inv.id.clone());
            in_hand -= amount;
            self.paying.insert(inv.id.clone(), (amount, e.t));
            if let Some(ag) = data(&inv).s("agreement") {
                self.owing.remove(ag);
            }
            steps.push(step(
                "Paying an invoice addressed to us.",
                vec![pay(money.get("to").and_then(Value::as_str).unwrap_or(""), amount, Pay { from: Some(e.account.clone()), for_: Some("Paying an invoice.".into()), settles: Some(inv.id.clone()), ..Default::default() }, cx)],
            ));
        }
    }

    /// Fines recorded against us, and demolition orders addressed to us.
    fn fines(&mut self, cx: &mut Cx, e: &Env, sites: &[&SiteCell], steps: &mut Vec<Step<Then>>) {
        let me = self.me.clone();
        let records: Vec<Arc<Record>> = self.book.of_type("claim").chain(self.book.all("demolition_order")).cloned().collect();
        for r in records {
            if self.answered.contains(&r.id) {
                continue;
            }
            // Rates are paid when there's the money for them; a fine or rates we don't mean to pay are let be.
            if let RecordBody::Claim { position, counterparty, about, .. } = &r.body {
                let kind = about.get("kind").and_then(Value::as_str).unwrap_or("");
                if format!("{position:?}").to_lowercase() == "right" && counterparty.as_deref() == Some(me.as_str()) && ["fine", "tax_penalty", "rates", "rates_interest"].contains(&kind) {
                    let to = about.get("account").and_then(Value::as_str).map(String::from).or_else(|| self.p.city_account.clone());
                    let amount = whole(about.get("amount"));
                    if !self.obeys(cx, &format!("fine-{}", r.id)) || to.is_none() {
                        self.answered.insert(r.id.clone());
                    } else if e.balance >= amount {
                        self.answered.insert(r.id.clone());
                        let what = if kind.starts_with("rates") { "rates" } else { "a fine" };
                        steps.push(step(
                            format!("Paying {what} recorded against us."),
                            vec![pay(&to.unwrap(), amount, Pay { from: Some(e.account.clone()), for_: Some(format!("Paying {what}.")), settles: Some(r.id.clone()), ..Default::default() }, cx)],
                        ));
                    }
                }
            }
            if matches!(&r.body, RecordBody::Statement { kind, .. } if kind == "demolition_order") && crate::common::addressed_to(&r).contains(&me) {
                // Obeying: the builder does demolitions (it has the crew), at its published price for that kind of building.
                let which = data(&r).s("structure").unwrap_or("");
                let kind_of = sites.iter().find(|c| c.structure.as_ref().is_some_and(|s| s.structure == which)).and_then(|c| c.structure.as_ref()).map(|s| s.structure_type.clone());
                let price = match (&kind_of, &self.p.builder) {
                    (Some(k), Some(b)) => published_price(&self.book, b, k, "demolition"),
                    _ => None,
                };
                let Some(price) = price.filter(|p| e.balance >= *p) else { continue }; // not yet: we don't know the price, or can't pay it
                self.answered.insert(r.id.clone());
                if self.obeys(cx, &format!("order-{}", r.id)) {
                    let builder = self.p.builder.clone().unwrap_or_default();
                    steps.push(step(
                        "Obeying a demolition order: commissioning the builder to demolish it.",
                        vec![call("structure", vec![("remove", Some(arg(which))), ("by", Some(arg(&builder))), ("price", Some(crate::steps::amount_text(price, cx))), ("from", Some(arg(&e.account))), ("basis", Some(arg(&r.id)))])],
                    ));
                }
            }
        }
    }
}

impl Office {
    /// Asked by a tenant to vary what stands between us (docs/behaviour/firm-wants.md): to hold a rent we have given
    /// notice of raising, or to let them stay on under a notice of ours. We answer in writing, yes or no, by our
    /// character (keeping a tenant and being thought well of, against growing or being rid of them) and by what the
    /// tenant is worth to us (one who has paid as agreed, more); and, saying yes, we do it: the notice of increase is
    /// withdrawn, or a new lease is offered from when the old one ends. One with no wants of its own answers nothing.
    fn variations(&mut self, cx: &mut Cx, e: &Env, steps: &mut Vec<Step<Then>>) {
        if !self.org().lively {
            return;
        }
        let me = self.me.clone();
        let t = e.t;
        let requests: Vec<Arc<Record>> = self.book.open("variation_request").cloned().collect();
        for r in requests {
            if self.answered.contains(&r.id) || !crate::common::addressed_to(&r).contains(&me) {
                continue;
            }
            self.answered.insert(r.id.clone());
            let d = data(&r);
            let Some(a) = e.active.iter().find(|x| Some(x.id.as_str()) == d.s("agreement")).cloned() else { continue };
            let tenant = tenant_of(&a, &me).to_string();
            if tenant.is_empty() || r.speaks_for.as_deref() != Some(tenant.as_str()) {
                continue;
            }
            let about = d.s("about").unwrap_or("").to_string();
            let paper = self.book.get(&about).cloned();
            let paid_up = self.org().wants.get(&a.id).is_none();
            let reply = |granted: bool, words: &str| {
                say("variation_answer", words, Say { to: Some(vec![tenant.clone()]), visible: visible(&[&me, &tenant]), basis: Some(r.id.clone()), data: Some(json!({ "about": about, "granted": granted })), ..Default::default() })
            };
            let worth = if paid_up { 5_000 } else { -10_000 };
            let rent_notice_paper = paper.as_ref().filter(|p| matches!(&p.body, RecordBody::Statement { kind, .. } if kind == "rent_increase") && p.speaks_for.as_deref() == Some(me.as_str()) && !self.book.withdrawn(&p.id));
            if let Some(paper) = rent_notice_paper {
                let mut rng = cx.rng(&format!("vary-{}", r.id));
                let (granted, chance) = self.org().grants(PracticeOf::Hold, &mut rng, worth, t);
                self.org().remember(t, if granted { "held_rent" } else { "refused_hold" }, Some(&tenant), 2_000);
                if granted {
                    let (from, rent) = (data(paper).i("from").unwrap_or(0), whole(data(paper).get("rent")));
                    if let Some(v) = self.rent_changes.get_mut(&a.id) {
                        v.retain(|c| !(c.from == from && c.rent == rent));
                    }
                    steps.push(step(
                        format!("{tenant} asks us to hold the rent: we would sooner keep them (for us, {}% of such requests): withdrawing the notice; the rent stays as it was.", fmt_dec(chance, 100)),
                        vec![withdraw(&paper.id, Some("Withdrawn at the tenant's request.")), reply(true, "Granted: the notice of rent increase is withdrawn; your rent stays as it was.")],
                    ));
                } else {
                    steps.push(step(format!("{tenant} asks us to hold the rent: no (for us, {}% of such requests are granted).", fmt_dec(chance, 100)), vec![reply(false, "Not granted: the rent increase stands.")]));
                }
            } else if d.get("would").and_then(|w| w.get("does")).and_then(|w| w.get("outcome")).and_then(|o| o.get("occupancy")).is_some() && self.notice_given.contains_key(&a.id) && !self.renewed.contains(&a.id) {
                let ends = self.book.ends_at(&a.id);
                let lt = lease_terms(&a, &tenant);
                let mut rng = cx.rng(&format!("vary-{}", r.id));
                let (granted, _) = self.org().grants(PracticeOf::Stay, &mut rng, worth, t);
                self.org().remember(t, if granted { "let_stay" } else { "refused_stay" }, Some(&tenant), 2_000);
                match (granted, ends, lt.space.clone()) {
                    (true, Some(ends), Some(space)) => {
                        self.renewed.insert(a.id.clone());
                        self.renews_at.insert(a.id.clone(), ends);
                        let rent = self.rent_at(&a, ends).min(self.falls.get(&a.id).copied().unwrap_or(i64::MAX));
                        let months = self.term_months(cx, &format!("renew-{}", a.id));
                        let o = Offer {
                            template: "lease".into(),
                            term: Some(ends - t + months * MONTH),
                            periodic: self.p.after_term.as_deref() == Some("periodic"),
                            our_notice: Some(self.p.landlord_notice_days * DAY),
                            their_notice: Some(self.p.tenant_notice_days * DAY),
                            we: Some(occupancy(&tenant, &space)),
                            they: Some(rent_payment(&e.account, rent, cx)),
                            text: Some(format!("{tenant} rents home {space} from {me} for {} a month, renewing their lease ({}) for {months} months from day {}.", e.usd(rent), a.id, ends.div_euclid(DAY))),
                            basis: Some(a.id.clone()),
                            ..Default::default()
                        };
                        steps.push(step_lines(
                            format!("{tenant} asks to stay on: we would sooner keep them: offering a new lease at {} a month from when the old one ends.", e.usd(rent)),
                            vec![bound("lease", offer(&tenant, o)), line(reply(true, "Granted: a new lease is offered you from when yours ends."))],
                        ));
                    }
                    _ => steps.push(step(format!("{tenant} asks to stay on: no."), vec![reply(false, "Not granted: the notice stands.")])),
                }
            } else {
                steps.push(step(format!("{tenant} asks something of us that is not ours to vary as asked."), vec![reply(false, "Not granted.")]));
            }
        }
    }

    /// A tribunal's order that a notice of rent increase of ours is invalid (docs/behaviour/justice.md): obeying it (as
    /// often as we obey the law), we withdraw the notice and the rent stays as it was.
    fn tribunal_orders(&mut self, cx: &mut Cx, _e: &Env, steps: &mut Vec<Step<Then>>) {
        let me = self.me.clone();
        let orders: Vec<Arc<Record>> = self.book.open("tribunal_order").cloned().collect();
        for o in orders {
            let d = data(&o);
            if self.answered.contains(&o.id) || !crate::common::addressed_to(&o).contains(&me) || d.s("against") != Some(me.as_str()) || d.s("kind") != Some("rent_increase") || d.s("finding") != Some("invalid") {
                continue;
            }
            self.answered.insert(o.id.clone());
            let Some(n) = d.s("notice").and_then(|id| self.book.get(id)).cloned() else { continue };
            if !self.obeys(cx, &format!("tribunal-{}", o.id)) {
                continue;
            }
            let (lease, from, rent) = (data(&n).s("lease").unwrap_or("").to_string(), data(&n).i("from").unwrap_or(0), whole(data(&n).get("rent")));
            if let Some(v) = self.rent_changes.get_mut(&lease) {
                v.retain(|c| !(c.from == from && c.rent == rent));
            }
            steps.push(step(
                format!("The tribunal has found our notice of rent increase {} invalid: withdrawing it; the rent stays as it was.", n.id),
                vec![withdraw(&n.id, Some(&format!("Withdrawn: found invalid by the tribunal ({}).", o.id)))],
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::firms::testkit::*;
    use crate::{Draws, WorldInfo};
    use oikos_sight::calls::Currency;

    const ME: &str = "landlord-1";
    const RENT: i64 = 150_000;

    fn lease(id: &str, at: i64, tenant: &str, space: &str) -> Arc<Record> {
        rec(json!({ "id": id, "at": at, "author": "landlord-1-office-system", "record": "agreement", "visible_to": [ME, tenant], "terms": { "template": "lease", "parties": [ME, tenant], "commitments": [
            { "who": ME, "does": { "outcome": { "occupancy": { "who": tenant, "in": space } } } },
            { "who": tenant, "does": { "outcome": { "money": { "from": format!("acc-{tenant}"), "to": "acc-landlord", "amount": RENT.to_string(), "for": "rent" } } }, "every": MONTH } ] } }))
    }
    fn with_basis(r: Arc<Record>, basis: &str) -> Arc<Record> {
        let mut r = r.as_ref().clone();
        r.basis = Some(serde_json::from_value(json!(basis)).unwrap());
        Arc::new(r)
    }
    fn signed(agreement: &str, at: i64, tenant: &str) -> Vec<Arc<Record>> {
        [ME, tenant].iter().map(|p| rec(json!({ "id": format!("sig-{agreement}-{p}"), "at": at, "author": "x", "record": "signature", "agreement": agreement, "as": p, "visible_to": [ME, tenant] }))).collect()
    }
    fn rent_paid(t: i64, tenant: &str) -> oikos_sight::Transaction {
        serde_json::from_value(json!({ "t": t, "from": format!("acc-{tenant}"), "to": "acc-landlord", "amount": RENT.to_string(), "currency": "XTS", "by": "bank", "memo": "rent" })).unwrap()
    }
    fn title(lot: &str, holder: &str) -> Arc<Record> {
        rec(json!({ "id": format!("own-{lot}"), "at": 0, "author": "genesis", "record": "claim", "position": "right", "holder": holder, "about": { "kind": "ownership", "object": lot }, "visible_to": "public" }))
    }
    fn lot(id: &str, cells: &[&str]) -> Arc<Record> {
        statement(id, 0, "lot", json!({ "cells": cells }), "city")
    }
    /// A finished building of dwellings on one cell.
    fn house(cell: &str, structure: &str, homes: &[(&str, u32)]) -> Value {
        json!({ "cell": cell, "x": 0, "y": 0, "structure": { "structure": structure, "type": "house", "at": cell, "w": 1, "h": 1, "complete": true,
            "spaces": homes.iter().map(|(s, n)| json!({ "space": s, "kind": "dwelling", "capacity": 6, "count": n, "attrs": { "bedrooms": 2 } })).collect::<Vec<_>>() } })
    }

    #[derive(Debug, Clone)]
    struct Made {
        t: i64,
        call: Call,
        id: String,
    }
    impl Made {
        fn arg(&self, k: &str) -> Value {
            argv(&self.call, k)
        }
    }

    /// A landlord in a town of this test's making, woken as the engine would: each act it sends is answered applied a
    /// minute on, with an id for what it made.
    struct Town {
        actor: Box<dyn Actor>,
        ctx: Ctx,
        draws: Draws,
        n: u64,
        cells: Vec<Value>,
        balance: i128,
        readings: Vec<(String, &'static str, Option<i64>)>,
        looks: Vec<LookRequest>,
        /// What it said, shown to it again at its next wake as the world would.
        echo: Vec<Arc<Record>>,
    }
    impl Town {
        fn new(params: Value) -> Town {
            let mut c = ctx("landlord-1-office-system", ME);
            c.params = params.as_object().cloned().unwrap_or_default();
            let currency = Currency { code: "XTS".into(), minor_units: 2, ..Default::default() };
            c.world = Arc::new(WorldInfo { currency: Some(currency), ..Default::default() });
            let actor = LANDLORD.create(&c).unwrap();
            Town { actor, ctx: c, draws: Draws::new("landlord-1-office-system", "self"), n: 0, cells: vec![], balance: 100_000_000, readings: vec![], looks: vec![], echo: vec![] }
        }
        fn wake(&mut self, t: i64, woke_for: &str, records: Vec<Arc<Record>>, txs: Vec<oikos_sight::Transaction>) -> Vec<Made> {
            self.wake_with(t, woke_for, records, txs, &|_| None)
        }
        fn wake_with(&mut self, t: i64, woke_for: &str, records: Vec<Arc<Record>>, txs: Vec<oikos_sight::Transaction>, register: &dyn Fn(&str) -> Option<Arc<Record>>) -> Vec<Made> {
            let mut records = records;
            records.append(&mut self.echo);
            let mut pic = picture(t, ME, records, &[("acc-landlord", ME, self.balance)], txs);
            let cells: Vec<SiteCell> = self.cells.iter().map(|c| serde_json::from_value(c.clone()).unwrap()).collect();
            pic.channels.insert("sites".into(), Seen::Sites { as_of: t, cells: Arc::new(cells), visit: None });
            pic.woke_for = woke_for.into();
            for (id, status, ends) in &self.readings {
                pic.readings.insert(id.clone(), oikos_sight::Reading { of: "agreement", status, ends_at: *ends, ended_by: None, reader: "test" });
            }
            let mut made = vec![];
            for _ in 0..60 {
                let mut cx = Cx::new(pic.t, &self.ctx, &mut self.draws, 1, vec![]);
                match self.actor.step(&pic, &mut cx) {
                    Action::Wait { .. } => break,
                    Action::Look { looks } => {
                        for l in &looks {
                            let wanted = l.query.as_ref().and_then(|q| q.conditions.as_ref()).and_then(|c| c.first()).and_then(|c| c.value.as_str().map(String::from)).unwrap_or_default();
                            self.looks.push(l.clone());
                            pic.channels.insert(l.channel.clone(), Seen::Records { records: register(&wanted).into_iter().collect(), search: true });
                        }
                        pic.woke_for = "asked".into();
                        pic.outcomes = vec![];
                        if let Some(Seen::Records { records, .. }) = pic.channels.get_mut("papers") {
                            records.clear();
                        }
                    }
                    Action::Call { program, .. } => {
                        let mut created = BTreeMap::new();
                        for l in calls_lines(&program) {
                            self.n += 1;
                            let id = format!("made-{}", self.n);
                            if let Some(b) = &l.bind {
                                created.insert(b.clone(), id.clone());
                            }
                            if l.call.fn_ == "statement" && argv(&l.call, "kind") != Value::Null {
                                let to = argv(&l.call, "to");
                                self.echo.push(rec(json!({ "id": id, "at": pic.t + 60, "author": "landlord-1-office-system", "record": "statement", "speaks_for": ME, "visible_to": "public", "kind": argv(&l.call, "kind"),
                                    "text": argv(&l.call, "text"), "data": argv(&l.call, "data"), "addressed_to": if to.is_null() { json!([]) } else { to } })));
                            }
                            if l.call.fn_ == "statement" && argv(&l.call, "withdraw") != Value::Null {
                                self.echo.push(rec(json!({ "id": format!("{id}-w"), "at": pic.t + 60, "author": "landlord-1-office-system", "record": "withdrawal", "visible_to": "public", "withdraws": argv(&l.call, "withdraw") })));
                            }
                            made.push(Made { t, call: l.call.clone(), id });
                        }
                        let name = format!("act-{}", self.n);
                        self.actor.sent(&name);
                        pic.t += 60;
                        pic.woke_for = "done".into();
                        pic.outcomes = vec![oikos_sight::Outcome { action: name, t: pic.t, status: OutcomeStatus::Applied, created: Some(created), refusal: None, investigated: None, surveyed: None, seen: vec![] }];
                        pic.channels.remove("sites").map(|_| ());
                        let cells: Vec<SiteCell> = self.cells.iter().map(|c| serde_json::from_value(c.clone()).unwrap()).collect();
                        pic.channels.insert("sites".into(), Seen::Sites { as_of: t, cells: Arc::new(cells), visit: None });
                        // What it has just made is on the record by its next look.
                        if let Some(Seen::Records { records, .. }) = pic.channels.get_mut("papers") {
                            records.clear();
                            records.append(&mut self.echo);
                        }
                        if let Some(Seen::Accounts { transactions, .. }) = pic.channels.get_mut("treasury") {
                            transactions.clear();
                        }
                    }
                    _ => break,
                }
            }
            made
        }
    }
    fn calls_lines(p: &oikos_sight::calls::Program) -> Vec<Line> {
        match p {
            oikos_sight::calls::Program::Lines(l) => l.clone(),
            _ => vec![],
        }
    }
    fn fns<'a>(m: &'a [Made], f: &str) -> Vec<&'a Made> {
        m.iter().filter(|x| x.call.fn_ == f).collect()
    }
    fn kind<'a>(m: &'a [Made], k: &str) -> Vec<&'a Made> {
        m.iter().filter(|x| x.call.fn_ == "statement" && x.arg("kind") == json!(k)).collect()
    }

    fn base_params() -> Value {
        json!({ "develop": false, "renew": true, "min_term_months": 12, "max_term_months": 12, "arrears_months_before_notice": 2, "spend_share_bps": 0, "upkeep_share_bps": 0, "base_rent": { "house": RENT } })
    }
    fn genesis_two() -> Vec<Arc<Record>> {
        let mut g = vec![lot("lot-1", &["c1", "c2"]), title("lot-1", ME), lease("L1-a", 0, "ann", "s1/home"), lease("L1-b", 0, "bob", "s2/home")];
        g.extend(signed("L1-a", 0, "ann"));
        g.extend(signed("L1-b", 0, "bob"));
        g
    }
    fn town_two(params: Value) -> Town {
        let mut t = Town::new(params);
        t.cells = vec![house("c1", "s1", &[("s1/home", 1)]), house("c2", "s2", &[("s2/home", 1)])];
        t
    }

    // ---- participants/test/landlord.test.ts

    #[test]
    fn a_tenant_on_a_renewed_lease_who_stops_paying_gets_notice_after_two_unpaid_months_as_one_on_a_first_lease_would() {
        let end = 12 * MONTH; // the first leases' term
        let mut town = town_two(base_params());
        let mut renewed_at: Option<i64> = None;
        let mut notices: Vec<(i64, String)> = vec![];
        let mut said_basis: BTreeSet<String> = BTreeSet::new();
        let mut t = 0;
        while t <= 20 * MONTH {
            let mut records = if t == 0 { genesis_two() } else { vec![] };
            // The landlord offered both a new lease (within its notice period of the old one's end): each tenant signs it.
            if renewed_at.is_none() && said_basis.contains("L1-a") && said_basis.contains("L1-b") {
                renewed_at = Some(t);
                for (id, who, space) in [("L2-a", "ann", "s1/home"), ("L2-b", "bob", "s2/home")] {
                    records.push(with_basis(lease(id, t, who, space), &id.replace("L2", "L1")));
                    records.extend(signed(id, t, who));
                }
            }
            town.readings = vec![
                ("L1-a".into(), if t < end { "in_force" } else { "ended" }, Some(end)),
                ("L1-b".into(), if t < end { "in_force" } else { "ended" }, Some(end)),
            ];
            if renewed_at.is_some() {
                town.readings.push(("L2-a".into(), "in_force", Some(24 * MONTH)));
                town.readings.push(("L2-b".into(), "in_force", Some(24 * MONTH)));
            }
            // Rent, monthly in advance, on the same days all along. Ann pays every month of the first lease and nothing
            // under the second; Bob never misses.
            let mut txs = vec![];
            let mut due = 0;
            while due <= t {
                if due > t - WEEK {
                    if due < end {
                        txs.push(rent_paid(due, "ann"));
                    }
                    txs.push(rent_paid(due, "bob"));
                }
                due += MONTH;
            }
            let made = town.wake(t, "cadence", records, txs);
            for m in &made {
                if m.call.fn_ == "agreement" {
                    if let Some(b) = m.arg("basis").as_str() {
                        said_basis.insert(b.to_string());
                    }
                    if let Some(n) = m.arg("notice").as_str() {
                        notices.push((t, n.to_string()));
                    }
                }
            }
            t += WEEK;
        }
        let renewed_at = renewed_at.expect("both were offered a new lease");
        assert!(renewed_at >= end - 60 * DAY && renewed_at < end, "renewed at {renewed_at}");
        // One notice: on Ann's new lease, at the first wake once two months of it are unpaid. Never on Bob's, nor the old ones.
        assert_eq!(notices.iter().map(|n| n.1.as_str()).collect::<Vec<_>>(), ["L2-a"]);
        assert!(notices[0].0 >= end + 2 * MONTH && notices[0].0 < end + 2 * MONTH + WEEK, "notice at {}", notices[0].0);
    }

    #[test]
    fn a_letting_office_looks_up_the_plan_of_each_of_its_lots_once_before_it_plans() {
        let mut params = base_params();
        params["renew"] = json!(false);
        params["register"] = json!({ "lots": "lots" });
        let mut town = Town::new(params);
        town.cells = ["s1", "s2", "s3"].iter().enumerate().map(|(i, s)| house(&format!("c{}", i + 1), s, &[(&format!("{s}/home"), 0)])).collect();
        let register = |lot: &str| match lot {
            "lot-1" => Some(lot_record("lot-1", "c1")),
            "lot-2" => Some(lot_record("lot-2", "c2")),
            _ => None,
        };
        fn lot_record(id: &str, cell: &str) -> Arc<Record> {
            statement(id, 0, "lot", json!({ "cells": [cell] }), "city")
        }
        // Its two titles, and one that is somebody else's: the plans of its own two are looked up, then its homes are listed.
        let first = town.wake_with(0, "cadence", vec![title("lot-1", ME), title("lot-2", ME), title("lot-3", "landlord-2")], vec![], &register);
        let asked = |t: &Town| t.looks.iter().map(|l| l.query.as_ref().unwrap().conditions.as_ref().unwrap()[0].value.as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(asked(&town), ["lot-1", "lot-2"]);
        assert!(town.looks.iter().all(|l| l.channel == "lots"));
        let mut listed: Vec<String> = kind(&first, "rental_listing").iter().map(|m| argv(&m.call, "data")["structure"].as_str().unwrap().to_string()).collect();
        listed.sort();
        listed.dedup();
        assert_eq!(listed, ["s1", "s2"]);
        // Later wakes ask nothing more; a title with no plan in the register is asked about once.
        town.wake_with(WEEK, "cadence", vec![title("lot-9", ME)], vec![], &register);
        town.wake_with(2 * WEEK, "cadence", vec![], vec![], &register);
        assert_eq!(asked(&town), ["lot-1", "lot-2", "lot-9"]);
    }

    // ---- building: an offer the builder declines, what it owes, and its invoices

    fn price_list(id: &str, at: i64, house: i64) -> Arc<Record> {
        statement(id, at, "price_list", json!({ "prices": { "house": house }, "demolition": { "house": 1_000_000 } }), "builder")
    }
    fn declined(id: &str, at: i64, agreement: &str, d: Value) -> Arc<Record> {
        let mut data = json!({ "agreement": agreement });
        data.as_object_mut().unwrap().extend(d.as_object().unwrap().clone());
        let r = statement(id, at, "offer_declined", data, "builder");
        let mut r = r.as_ref().clone();
        r.visible_to = serde_json::from_value(json!([ME, "builder"])).unwrap();
        r.body = match r.body {
            RecordBody::Statement { kind, text, data, adico, formal, offer, practice, assertion, registry, place, .. } => {
                RecordBody::Statement { kind, text, data, adico, formal, offer, practice, assertion, registry, addressed_to: Some(vec![ME.into()]), place }
            }
            o => o,
        };
        Arc::new(r)
    }
    fn addressed(r: Arc<Record>) -> Arc<Record> {
        let mut r = r.as_ref().clone();
        r.body = match r.body {
            RecordBody::Statement { kind, text, data, adico, formal, offer, practice, assertion, registry, place, .. } => {
                RecordBody::Statement { kind, text, data, adico, formal, offer, practice, assertion, registry, addressed_to: Some(vec![ME.into()]), place }
            }
            o => o,
        };
        Arc::new(r)
    }
    fn granted(t: i64, application: &str) -> Arc<Record> {
        addressed(statement(&format!("pd-{application}"), t, "permit_decision", json!({ "application": application, "decision": "granted" }), "city"))
    }
    fn invoice(id: &str, at: i64, agreement: &str, amount: i64) -> Arc<Record> {
        addressed(statement(id, at, "invoice", json!({ "agreement": agreement, "outcome": { "money": { "to": "acc-builder", "amount": amount.to_string(), "for": "building a house" } } }), "builder"))
    }
    fn cents_of(text: &Value) -> i64 {
        text.as_str().unwrap().chars().filter(char::is_ascii_digit).collect::<String>().parse().unwrap()
    }
    fn is_application(m: &Made) -> bool {
        m.call.fn_ == "form" && m.arg("form") == json!("permit_application")
    }

    /// What a town does around a developing landlord, week by week.
    trait Scene {
        /// What is new that week, having seen what the landlord did the week before.
        fn world(&mut self, t: i64, last: &[Made]) -> Vec<Arc<Record>>;
        fn balance(&mut self, _t: i64) -> i128 {
            100_000_000
        }
        /// What comes by post the day after, which wakes the landlord.
        fn post(&mut self, _t: i64, _last: &[Made]) -> Vec<Arc<Record>> {
            vec![]
        }
        /// The cells with a building begun on them by then, and the bank's payments that week.
        fn town(&mut self, _t: i64) -> (Vec<String>, Vec<oikos_sight::Transaction>) {
            (vec![], vec![])
        }
    }

    /// A landlord with two homes let and two empty lots, woken weekly from day 0 to `until` in a town of this scene's
    /// making. Returns every call.
    fn developing(until: i64, scene: &mut impl Scene) -> Vec<Made> {
        let mut params = base_params();
        params["develop"] = json!(true);
        params["develop_type"] = json!("house");
        params["develop_window_days"] = json!(90);
        params["renew"] = json!(false);
        params["builder"] = json!("builder");
        params["city"] = json!("city");
        let mut tw = Town::new(params);
        let mut genesis = vec![lot("lot-1", &["c1", "c2"]), lot("lot-2", &["c3"]), lot("lot-3", &["c4"]), title("lot-1", ME), title("lot-2", ME), title("lot-3", ME)];
        for (id, who, space) in [("L1-a", "ann", "s1/home"), ("L1-b", "bob", "s2/home")] {
            genesis.push(lease(id, 0, who, space));
            genesis.extend(signed(id, 0, who));
        }
        tw.readings = vec![("L1-a".into(), "in_force", Some(2000 * DAY)), ("L1-b".into(), "in_force", Some(2000 * DAY))];
        let mut all = vec![];
        let mut last: Vec<Made> = vec![];
        let mut t = 0;
        while t <= until {
            let (built, paid) = scene.town(t);
            tw.cells = vec![house("c1", "s1", &[("s1/home", 1)]), house("c2", "s2", &[("s2/home", 1)])];
            for c in ["c3", "c4"] {
                tw.cells.push(if built.iter().any(|b| b == c) {
                    json!({ "cell": c, "x": 0, "y": 0, "structure": { "structure": format!("new-{c}"), "type": "house", "at": c, "w": 1, "h": 1, "complete": false, "spaces": [] } })
                } else {
                    json!({ "cell": c, "x": 0, "y": 0 })
                });
            }
            let mut records = if t == 0 { genesis.clone() } else { vec![] };
            records.extend(scene.world(t, &last));
            tw.balance = scene.balance(t);
            last = tw.wake(t, "cadence", records, paid);
            all.extend(last.clone());
            let letters = scene.post(t + DAY, &last);
            if !letters.is_empty() {
                tw.balance = scene.balance(t + DAY);
                all.extend(tw.wake(t + DAY, "news", letters, vec![]));
            }
            t += WEEK;
        }
        all
    }

    /// The builder declines offers: the first and second for the price, the third for the site. `bank`: the balance.
    struct Declining {
        seen: Vec<String>,
        bank: i128,
        decline_price: i64,
        declines: bool,
    }
    impl Scene for Declining {
        fn world(&mut self, t: i64, last: &[Made]) -> Vec<Arc<Record>> {
            let mut out = if t == 0 { vec![price_list("pl-1", 0, 27_000_000)] } else { vec![] };
            out.extend(last.iter().filter(|c| is_application(c)).map(|c| granted(t, &c.id)));
            out
        }
        fn balance(&mut self, _: i64) -> i128 {
            self.bank
        }
        fn post(&mut self, t: i64, last: &[Made]) -> Vec<Arc<Record>> {
            let mut out = vec![];
            if !self.declines {
                return out;
            }
            for c in last.iter().filter(|c| c.call.fn_ == "structure") {
                let n = self.seen.len();
                self.seen.push(c.id.clone());
                if self.decline_price > 0 {
                    // One offer, declined for a price the landlord cannot pay.
                    if n == 0 {
                        out.push(declined("no-1", t, &c.id, json!({ "price": self.decline_price.to_string() })));
                    }
                } else if n == 0 {
                    // The first offer crosses a change of prices: declined, the letter naming the price.
                    out.push(declined("no-1", t, &c.id, json!({ "price": "28000000" })));
                } else if n == 1 {
                    // The second is declined too, and a list later than that letter is out before the landlord plans again.
                    out.push(declined("no-2", t - 3600, &c.id, json!({ "price": "28500000" })));
                    out.push(price_list("pl-3", t, 29_000_000));
                } else if n == 2 {
                    // The third: the builder says the lot is taken.
                    out.push(declined("no-3", t, &c.id, json!({ "reason": "site_taken" })));
                }
            }
            out
        }
    }

    #[test]
    fn a_landlord_whose_offer_the_builder_declines_for_the_price_offers_again_a_week_on_at_what_the_builder_charges_now_and_once() {
        let said = developing(60 * WEEK, &mut Declining { seen: vec![], bank: 100_000_000, decline_price: 0, declines: true });
        let offs: Vec<Made> = said.iter().filter(|c| c.call.fn_ == "structure").cloned().collect();
        // Three offers for the one lot: at the list, then at the letter's price, then at the later list's; each a week
        // after the last, not on the day the letter came and woke it, and none repeated while nothing new has come. (A
        // fourth follows the second application, half a year on: a new plan, at the list then standing.)
        assert_eq!(offs.iter().map(|o| (o.arg("on"), o.arg("by"), cents_of(&o.arg("price")))).collect::<Vec<_>>(), vec![
            (json!("lot-2"), json!("builder"), 27_000_000),
            (json!("lot-2"), json!("builder"), 28_000_000),
            (json!("lot-2"), json!("builder"), 29_000_000),
            (json!("lot-2"), json!("builder"), 29_000_000),
        ]);
        assert_eq!(offs[1].t - offs[0].t, WEEK);
        assert_eq!(offs[2].t - offs[1].t, WEEK);
        assert!(offs.iter().all(|o| o.t % WEEK == 0));
        // Told the lot is taken, it gives the plan up, and waits as long as after a refusal it accepts before applying again.
        let apps: Vec<&Made> = said.iter().filter(|c| is_application(c)).collect();
        assert_eq!(apps.len(), 2);
        assert!(apps[1].t - offs[2].t >= 180 * DAY && apps[1].t - offs[2].t < 180 * DAY + 2 * WEEK);
        assert!(offs[3].t > apps[1].t);
    }

    #[test]
    fn a_landlord_who_cannot_pay_the_builders_new_price_keeps_its_permit_and_waits_and_one_whose_offer_stands_does_nothing_more() {
        // Enough to begin at the first list (one and a half times its price); not enough for the price the letter names.
        let short = developing(40 * WEEK, &mut Declining { seen: vec![], bank: 41_000_000, decline_price: 60_000_000, declines: true });
        assert_eq!(short.iter().filter(|c| c.call.fn_ == "structure").count(), 1);
        assert_eq!(short.iter().filter(|c| is_application(c)).count(), 1);
        // Not declined: one offer, and the landlord waits for its building.
        let waiting = developing(40 * WEEK, &mut Declining { seen: vec![], bank: 100_000_000, decline_price: 0, declines: false });
        assert_eq!(waiting.iter().filter(|c| c.call.fn_ == "structure").count(), 1);
        assert_eq!(waiting.iter().filter(|c| is_application(c)).count(), 1);
    }

    const PRICE: i64 = 27_000_000;

    /// The builder begins a house a week after it is asked and invoices its price then; the bank pays what the
    /// landlord tells it to by the week after, out of `money` (which `spend` may also draw on).
    struct Building {
        money: i128,
        spend: Box<dyn Fn(i64) -> i128>,
        begun: BTreeMap<String, i64>,
        due: Vec<oikos_sight::Transaction>,
        offers: Vec<Made>,
        invoices: Vec<(String, i64)>,
        payments: Vec<Made>,
    }
    impl Building {
        fn new(money: i128, spend: impl Fn(i64) -> i128 + 'static) -> Building {
            Building { money, spend: Box::new(spend), begun: BTreeMap::new(), due: vec![], offers: vec![], invoices: vec![], payments: vec![] }
        }
    }
    impl Scene for Building {
        fn world(&mut self, t: i64, last: &[Made]) -> Vec<Arc<Record>> {
            let mut out = if t == 0 { vec![price_list("pl-1", 0, PRICE)] } else { vec![] };
            for c in last {
                if is_application(c) {
                    out.push(granted(t, &c.id));
                }
                if c.call.fn_ == "structure" {
                    self.offers.push(c.clone());
                    self.begun.insert(if c.arg("on") == json!("lot-2") { "c3".into() } else { "c4".into() }, t);
                    self.invoices.push((format!("inv-{}", c.id), t));
                    out.push(invoice(&format!("inv-{}", c.id), t, &c.id, PRICE));
                }
                if c.call.fn_ == "money" && c.arg("settles") != Value::Null {
                    self.payments.push(c.clone());
                    let amount = cents_of(&c.arg("amount"));
                    self.money -= i128::from(amount);
                    self.due.push(serde_json::from_value(json!({ "t": t, "from": "acc-landlord", "to": "acc-builder", "amount": amount.to_string(), "currency": "XTS", "by": "bank", "settles": c.arg("settles") })).unwrap());
                }
            }
            self.money -= (self.spend)(t);
            out
        }
        fn balance(&mut self, _: i64) -> i128 {
            self.money
        }
        fn town(&mut self, t: i64) -> (Vec<String>, Vec<oikos_sight::Transaction>) {
            (self.begun.iter().filter(|(_, at)| **at <= t).map(|(c, _)| c.clone()).collect(), std::mem::take(&mut self.due))
        }
    }

    #[test]
    fn a_landlord_asks_for_a_second_house_only_on_money_the_first_does_not_need() {
        // Twice the price and a fifth: enough to begin one, and after that one's price is set aside, not enough to begin another.
        let mut one = Building::new(i128::from(PRICE) * 22 / 10, |_| 0);
        let said = developing(60 * WEEK, &mut one);
        assert_eq!(one.offers.iter().map(|o| o.arg("on")).collect::<Vec<_>>(), [json!("lot-2")]);
        assert_eq!(said.iter().filter(|c| is_application(c)).count(), 1);
        assert_eq!(one.payments.iter().map(|c| (c.arg("settles"), cents_of(&c.arg("amount")))).collect::<Vec<_>>(), [(json!(one.invoices[0].0), PRICE)]);
        // Two and a half times the price and a little: one house's price aside, it can still begin another; both are paid.
        let mut two = Building::new(i128::from(PRICE) * 26 / 10, |_| 0);
        developing(60 * WEEK, &mut two);
        assert_eq!(two.offers.iter().map(|o| o.arg("on")).collect::<Vec<_>>(), [json!("lot-2"), json!("lot-3")]);
        let mut paid: Vec<String> = two.payments.iter().map(|c| c.arg("settles").as_str().unwrap().to_string()).collect();
        let mut asked: Vec<String> = two.invoices.iter().map(|i| i.0.clone()).collect();
        paid.sort();
        asked.sort();
        assert_eq!(paid, asked);
    }

    #[test]
    fn an_invoice_that_comes_when_the_landlord_is_short_stays_open_and_is_paid_when_it_can_be_once() {
        // Enough to begin and to ask. In the week the house is begun and invoiced the money has gone elsewhere; ten weeks
        // on it is back.
        let mut probe = Building::new(i128::from(PRICE) * 16 / 10, |_| 0);
        developing(60 * WEEK, &mut probe);
        let t0 = probe.offers[0].t;
        let mut short = Building::new(i128::from(PRICE) * 16 / 10, move |t| {
            if t == t0 + WEEK {
                i128::from(PRICE)
            } else if t == t0 + 11 * WEEK {
                -i128::from(PRICE)
            } else {
                0
            }
        });
        developing(60 * WEEK, &mut short);
        assert_eq!(short.offers.iter().map(|o| o.t).collect::<Vec<_>>(), [t0]);
        assert_eq!(short.invoices, vec![(short.invoices[0].0.clone(), t0 + WEEK)]);
        // Not paid while short; paid at the plan when the money is back; never again.
        assert_eq!(short.payments.iter().map(|c| (c.arg("settles"), cents_of(&c.arg("amount")), c.t)).collect::<Vec<_>>(), [(json!(short.invoices[0].0), PRICE, t0 + 11 * WEEK)]);
    }

    // ---- the landlord's changes in the port

    fn big_payment(t: i64, tenant: &str) -> oikos_sight::Transaction {
        serde_json::from_value(json!({ "t": t, "from": format!("acc-{tenant}"), "to": "acc-landlord", "amount": "400000", "currency": "XTS", "by": "bank", "memo": "rent" })).unwrap()
    }
    fn lease_at(id: &str, at: i64, tenant: &str, space: &str, rent: i64) -> Arc<Record> {
        let mut v = serde_json::to_value(lease(id, at, tenant, space).as_ref()).unwrap();
        v["terms"]["commitments"][1]["does"]["outcome"]["money"]["amount"] = json!(rent.to_string());
        rec(v)
    }

    /// One building of four homes, three let (Ann's and Bob's from day 0 at 150,000, Cat's from day 190 at 180,000), one
    /// empty; the tenants pay more than they owe. Woken weekly to `until`; every call made.
    fn four_homes(params: Value, until: i64, lease_ends: i64) -> Vec<Made> {
        let mut town = Town::new(params);
        town.cells = vec![house("c1", "s1", &[("s1/home1", 1), ("s1/home2", 1), ("s1/home3", 1), ("s1/home4", 0)])];
        let mut made = vec![];
        let mut t = 0;
        while t <= until {
            let mut records = vec![];
            if t == 0 {
                records.extend([lot("lot-1", &["c1"]), title("lot-1", ME)]);
                for (id, who, space) in [("L1-a", "ann", "s1/home1"), ("L1-b", "bob", "s1/home2")] {
                    records.push(lease_at(id, 0, who, space, RENT));
                    records.extend(signed(id, 0, who));
                }
            }
            if t == 189 * DAY + 3 * DAY + 0 * WEEK && false {}
            if t >= 190 * DAY && !town.readings.iter().any(|r| r.0 == "L1-c") {
                records.push(lease_at("L1-c", 190 * DAY, "cat", "s1/home3", 180_000));
                records.extend(signed("L1-c", 190 * DAY, "cat"));
                town.readings.push(("L1-c".into(), "in_force", Some(lease_ends)));
            }
            if t == 0 {
                town.readings.push(("L1-a".into(), "in_force", Some(lease_ends)));
                town.readings.push(("L1-b".into(), "in_force", Some(lease_ends)));
            }
            let mut txs = vec![];
            let mut due = 0;
            while due <= t {
                if due > t - WEEK {
                    txs.push(big_payment(due, "ann"));
                    txs.push(big_payment(due, "bob"));
                    if due >= 190 * DAY {
                        txs.push(big_payment(due, "cat"));
                    }
                }
                due += MONTH;
            }
            made.extend(town.wake(t, "cadence", records, txs));
            t += WEEK;
        }
        made
    }

    fn reviewing() -> Value {
        let mut p = base_params();
        p["rent_review_months"] = json!(7);
        p["landlord_notice_days"] = json!(60);
        p
    }

    #[test]
    fn a_rent_at_review_moves_part_of_the_way_to_what_comparable_homes_let_for_and_is_given_by_notice() {
        let made = four_homes(reviewing(), 215 * DAY, 720 * DAY);
        let notices = kind(&made, "rent_increase");
        // Ann's and Bob's, each from 150,000 half the way to the 180,000 a comparable home let for lately: no fixed 5%.
        let mut got: Vec<(String, i64, i64)> = notices.iter().map(|m| { let d = argv(&m.call, "data"); (d["lease"].as_str().unwrap().to_string(), d["rent"].as_i64().unwrap(), d["was"].as_i64().unwrap()) }).collect();
        got.sort();
        assert_eq!(got, [("L1-a".to_string(), 165_000, 150_000), ("L1-b".to_string(), 165_000, 150_000)]);
        // The notice counts its days from when it is on the record.
        for m in &notices {
            let from = argv(&m.call, "data")["from"].as_i64().unwrap();
            assert_eq!(from, starts_on(m.t, 0));
        }
    }

    #[test]
    fn with_no_evidence_a_rent_stays_and_a_rent_already_at_the_market_never_moves() {
        // Nothing let lately and nothing else asked: only its own listing of the empty home, at about the going rent.
        let mut p = reviewing();
        p["rent_review_months"] = json!(4);
        let made = four_homes(p, 180 * DAY, 720 * DAY);
        let rises = kind(&made, "rent_increase");
        for m in rises {
            let d = argv(&m.call, "data");
            // Whatever moved, it moved to a rent it was within its own listing's reach of, never a fixed markup over the last.
            assert!(d["rent"].as_i64().unwrap() > d["was"].as_i64().unwrap());
        }
        // A landlord that has reviewed once at the market asks no more: five reviews at an unchanging market, no rise.
        let again = four_homes(reviewing(), 1_500 * DAY, 3_000 * DAY);
        let rent_rises: Vec<i64> = kind(&again, "rent_increase").iter().map(|m| argv(&m.call, "data")["rent"].as_i64().unwrap()).collect();
        let sorted = { let mut s = rent_rises.clone(); s.sort(); s };
        assert!(rent_rises.len() < 30, "no ratchet: {} notices in four years", rent_rises.len());
        assert!(sorted.iter().all(|r| *r <= 180_000), "never past what comparable homes let for: {sorted:?}");
    }

    #[test]
    fn a_fall_is_offered_at_renewal_as_the_new_leases_rent_not_by_notice_of_increase() {
        // Comparable homes were let for less and one stands empty: the sitting tenant's rent moves down part of the way.
        let mut p = reviewing();
        p["rent_review_months"] = json!(7);
        let mut town = Town::new(p);
        town.cells = vec![house("c1", "s1", &[("s1/home1", 1), ("s1/home2", 1), ("s1/home3", 0)])];
        let mut made = vec![];
        let end = 330 * DAY;
        town.readings = vec![("L1-a".into(), "in_force", Some(end)), ("L1-b".into(), "in_force", Some(end))];
        let mut t = 0;
        while t <= 310 * DAY {
            let mut records = vec![];
            if t == 0 {
                records.extend([lot("lot-1", &["c1"]), title("lot-1", ME)]);
                for (id, who, space) in [("L1-a", "ann", "s1/home1"), ("L1-b", "bob", "s1/home2")] {
                    records.push(lease_at(id, 0, who, space, RENT));
                    records.extend(signed(id, 0, who));
                }
                // Published to it: comparable homes were let for 100,000 lately.
                records.push(statement("ev-1", 0, "rental_evidence", json!({ "type": "house", "bedrooms": 2, "lets": [100_000, 100_000], "asking": [], "homes": 0, "vacant": 0, "window_days": 90 }), "market"));
            }
            let mut txs = vec![];
            let mut due = 0;
            while due <= t {
                if due > t - WEEK {
                    txs.extend([big_payment(due, "ann"), big_payment(due, "bob")]);
                }
                due += MONTH;
            }
            made.extend(town.wake(t, "cadence", records, txs));
            t += WEEK;
        }
        assert!(kind(&made, "rent_increase").is_empty(), "a fall is not a rent increase");
        // One of three homes empty is 33% vacancy: a quarter of the gap down, from 150,000 to the market's 100,000.
        let offers: Vec<&Made> = fns(&made, "agreement").into_iter().filter(|m| m.arg("template") == json!("lease") && m.arg("basis") == json!("L1-a")).collect();
        assert_eq!(offers.len(), 1);
        let rent = match offers[0].call.get("they_do") {
            Some(oikos_sight::calls::Value::Call(c)) => cents_of(&argv(c, "amount")),
            other => panic!("{other:?}"),
        };
        assert_eq!(rent, 137_500);
    }

    #[test]
    fn a_notice_to_vacate_gives_the_laws_full_days_counted_from_when_it_is_on_the_record() {
        let mut p = base_params();
        p["possession"] = json!({ "tribunal": "tribunal", "fee": 0 });
        p["renew"] = json!(false);
        let mut town = town_two(p);
        town.readings = vec![("L1-a".into(), "in_force", Some(900 * DAY)), ("L1-b".into(), "in_force", Some(900 * DAY))];
        let law = statement("law-possession", 0, "law", json!({ "tenancy": "possession", "arrears_days": 14, "notice_days": 14, "possession_days": 14, "plan_months": 6, "warrant_days": 14, "eviction_notice_days": 7, "enforced_by": "police" }), "city");
        let mut made = vec![];
        let mut t = 0;
        while t <= 20 * WEEK {
            let records = if t == 0 { let mut g = genesis_two(); g.push(law.clone()); g } else { vec![] };
            // Bob pays; Ann never does.
            let txs: Vec<_> = (0..=t / MONTH).filter(|k| k * MONTH > t - WEEK && k * MONTH <= t).map(|k| rent_paid(k * MONTH, "bob")).collect();
            made.extend(town.wake(t, "cadence", records, txs));
            t += WEEK;
        }
        let notices = kind(&made, "notice_to_vacate");
        assert_eq!(notices.len(), 1, "one notice, to Ann");
        let d = argv(&notices[0].call, "data");
        let by = d["by"].as_i64().unwrap();
        assert_eq!(by % DAY, 0, "a date by the day");
        // The law's 14 full days run between the day it is on the record and the day it gives.
        let on_record_day = (notices[0].t + 3_600).div_euclid(DAY);
        assert_eq!(by / DAY, on_record_day + 1 + 14);
        assert!(by / DAY - notices[0].t.div_euclid(DAY) >= 15, "never short of the 14 days whatever the hour");
        // Ann is still there when it runs out: the application to the tribunal follows the date, not before.
        let apps = kind(&made, "tribunal_application");
        assert_eq!(apps.len(), 1);
        assert!(apps[0].t >= by);
        assert_eq!(argv(&apps[0].call, "data")["notice_by"].as_i64(), Some(by));
    }

    #[test]
    fn a_notice_made_again_when_sent_counts_from_when_it_is_sent() {
        let mut c = ctx("landlord-1-office-system", ME);
        c.params = Map::new();
        let mut office = Office::new(&c, Params::read(&c).unwrap(), respondent(&c));
        let g = VacateGive { lease: "L1".into(), tenant: "ann".into(), space: "s1/home".into(), arrears: 300_000, law: "law-possession".into(), arrears_days: 14, notice_days: 14, bears: 2, by: starts_on(DAY - 3_700, 14 * DAY) };
        office.ending.insert("L1".into(), Ending { stage: EndStage::Noticed, by: g.by, notice: None, seen: BTreeSet::new(), plan: None });
        let planned = vacate_notice(ME, &g, &office.world);
        // Planned 3,700 seconds before midnight; sent a minute later it is still before the record's hour, and a quarter hour later it is not.
        let sent_early = office.redo(planned.clone(), DAY - 3_640);
        let sent_late = office.redo(planned, DAY - 2_000);
        let by_of = |s: &Step<Then>| match &s.then { Some(Then::Vacate(g)) => g.by, _ => panic!() };
        assert_eq!(by_of(&sent_early), g.by);
        assert_eq!(by_of(&sent_late), g.by + DAY, "the notice is on the record on the next day: one more day to run");
        assert_eq!(office.ending["L1"].by, g.by + DAY, "and the tenancy's file says the same date");
    }

    #[test]
    fn the_law_on_possession_is_read_from_the_worlds_record_and_a_leases_words_say_who_lives_there() {
        let law = |d: Value| taken(vec![statement("law-possession", 0, "law", d, "city")]);
        assert_eq!(possession_law(&Book::new()), None);
        assert_eq!(
            possession_law(&law(json!({ "tenancy": "possession", "arrears_days": 14, "notice_days": 14, "possession_days": 14, "plan_months": 6, "warrant_days": 14, "eviction_notice_days": 7, "enforced_by": "police" }))),
            Some(PossessionLaw { id: "law-possession".into(), arrears_days: 14, notice_days: 14, possession_days: 14, plan_months: 6, warrant_days: 14, eviction_notice_days: 7, enforced_by: Some("police".into()) })
        );
        assert_eq!(household_named("c1 rents home h/dwelling.1 from landlord-1, to live there with their household: c2, c3.", "c1"), ["c1", "c2", "c3"]);
        assert_eq!(household_named("c1 rents home h/dwelling.1 from landlord-1 for 100000 a month, for 12 months.", "c1"), ["c1"]);
    }

    #[test]
    fn a_landlord_saves_and_restores_and_steps_the_same() {
        let mut a = town_two(base_params());
        let mut records = genesis_two();
        records.push(title("lot-9", "landlord-2"));
        a.readings = vec![("L1-a".into(), "in_force", Some(900 * DAY)), ("L1-b".into(), "in_force", Some(900 * DAY))];
        for week in 0..10 {
            a.wake(week * WEEK, "cadence", if week == 0 { records.clone() } else { vec![] }, vec![]);
        }
        let saved = a.actor.save().unwrap();
        let mut b = Town::new(base_params());
        b.cells = a.cells.clone();
        b.readings = a.readings.clone();
        b.actor = LANDLORD.restore(&b.ctx, saved.clone()).unwrap();
        assert_eq!(b.actor.save().unwrap(), saved);
        b.draws = a.draws.clone();
        b.n = a.n;
        let left: Vec<_> = a.wake(10 * WEEK, "cadence", vec![], vec![]).iter().map(|m| (m.t, m.call.clone())).collect();
        let right: Vec<_> = b.wake(10 * WEEK, "cadence", vec![], vec![]).iter().map(|m| (m.t, m.call.clone())).collect();
        assert_eq!(left, right);
    }

    #[test]
    fn the_manifest_names_its_issues_and_every_parameter_the_module_reads() {
        let m = LANDLORD.manifest();
        assert_eq!((m["name"].as_str(), m["version"].as_str(), m["doc"].as_str()), (Some("firm.landlord"), Some("0.20.0"), Some("docs/behaviour/firms.md")));
        for k in ["pass_up_bps", "pass_down_bps", "soft_vacancy_bps", "evidence_days", "possession", "repair", "respond", "rent_review_months"] {
            assert!(m["params"][k].is_object(), "{k}");
        }
        assert!(m["issues"].as_array().is_some_and(|i| i.iter().any(|f| f["form"] == "rental_listing")));
        assert_eq!(LANDLORD.cadence(&ctx("x", "y")), WEEK);
    }
}
