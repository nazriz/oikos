//! firm.builder: a building firm. Ported to Rust from participants/src/behaviour/institutions.ts (`builder`, TS 0.13.1;
//! the Rust port keeps the version string so the manifest equals the TS one, docs/port-guide.md section 2).
//!
//! It publishes its prices (materials at its supplier's prices, the crew's hours at their hourly wage, a margin),
//! takes on a construction or demolition agreement a client has signed (declining in writing what it cannot do), buys
//! the materials, starts the building once they are in its yard, invoices the agreed price, has its crew work on its
//! sites each working day (repairs too, when it takes repair orders), sizes the crew to the work in hand, answers
//! letters with its prices. Permits are the owner's to get (docs/behaviour/building.md); the builder waits for the
//! structure call to be applied. Documented in docs/behaviour/building.md and institutions.md.
//!
//! **Where the Rust decides fresh** (bug hunt 2026-10-17, finding 2: a successor in the post carries on from the file):
//! - what a job's state is comes from the file: a contract is *taken on* if we signed it, *declined* if an
//!   `offer_declined` of ours cites it, *begun* if an invoice of ours cites it; the queue of waiting jobs is read
//!   again each wake in filed order; lots with a job of ours, orders not yet delivered (our `order`s less the
//!   `delivery_note`s addressed to us), the prices last published, the wage (our `enterprise_agreement`s), the dispute
//!   in bargaining (our `wage_offer`s), the last let-go (notices on our crew's agreements), what a cell has on it, when
//!   it was last gone to (the view's visit), and buildings of ours still being built (`built_by` us, incomplete) are
//!   all read from what it is shown.
//! - Memory is only a cache of the file for acts in flight (`in_flight`, `ordering`, `publishing`) or for what no
//!   paper records: hours left on a project and of each repair, hours each worker has put in today (the world's
//!   refusal corrects it), money that came in for repair orders, repair orders taken on, debts paid (the settling
//!   payment is seen once), the register's answers asked for.
//! - A stage moves on only when its act is applied: a start refused is tried again the next day (TS dropped the job);
//!   a debt is paid when the payment settles it is seen, not when it was sent.
//! - A contract it cannot do is declined in writing (`offer_declined`, reasons `unknown_type`, `cannot_build`) where
//!   TS ignored it for ever (PB-11): a kind of building it has no figures for, or a job without a site.
//! - Prices are exact integers (TS reckoned the hourly wage in floats).
//! - Not ported (they are lane C1's `Staffing`, stood in for by `offices::staff::Staff`): wages raised for the whole
//!   staff on an enterprise agreement, stopped and restarted on a strike, tax withheld, hands by the day, registered
//!   jobs. The agreement is made and published and the wage of new hires follows it; integration replaces.
//! - The builder never winds up (TS: "we don't wind up"), so finding 11 (shareholders before wages and tax) does not
//!   arise here; debts recorded against it (a fine, rates, a worker's claim for wages) are paid oldest first before
//!   any other spending in the wake.

use crate::firms::bargaining::{Bargaining, Takings};
use crate::firms::staffing::{Staffing, StaffingOpts, Want};
use crate::firms::winding::{creditor_account, WindingParams, WindingUp};
use crate::market::trade::{self, Ordering};
use crate::common::{
  ask, cells_of, data, filed_before, go_see, money_words, next_look, out_of_time, own_account, receipts, team, withdraw,
  Asked, Fields, Book, Letters, DAY,
};
use crate::papers::agreements::{self, commitment_of};
use crate::papers::{self, data as paper_data};
use crate::papers::market::{Invoice, PaymentOutcome};
use crate::papers::offices::{BuildingNotice, OfferDeclined, RepairDeclined, RepairDone};
use crate::steps::{arg, because, call, json, pay, say, text, Done, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms::{self, Answers};
use oikos_sight::calls::Line;
use oikos_sight::{LookRequest, Record, RecordBody, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json as j, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub struct Builder;

const PARAMS: &str = include_str!("builder.params.json");

const ROLE: &str = "construction worker";

fn answers() -> Answers {
    Answers {
        office: "the builder's office".into(),
        acts: "What it acts on: a construction agreement signed with it, built once a permit for the site is in force and invoiced as agreed. Its prices are published.".into(),
        forms: vec![],
        report: true,
    }
}

impl Kind for Builder {
    fn name(&self) -> &'static str {
        "firm.builder"
    }
    fn version(&self) -> &'static str {
        "0.14.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/institutions.md"
    }
    fn manifest(&self) -> Value {
        let mut issues = forms::group("JOB_ADVERTISEMENT");
        issues.extend(forms::group("ORDER"));
        j!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": serde_json::from_str::<Value>(PARAMS).unwrap_or(Value::Null),
            "perceives": [], "state": "none",
            "issues": issues,
            "answers": answers(),
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params::read(ctx)?;
        let staff = Staffing::new(
            &ctx.entity,
            StaffingOpts {
                workplace: Some(p.workplace.clone()).filter(|w| !w.is_empty()),
                industry: Some(p.industry.clone()).filter(|w| !w.is_empty()),
                registered_bps: Some(p.registered_bps),
                casual_bps: Some(p.casual_bps),
                day_wage: Some(p.day_wage),
                work_days: Some(p.work_days),
                week_days: p.look_days,
                ..StaffingOpts::new(p.period, p.notice_days, ROLE)
            },
        );
        Ok(Box::new(Stepper::new(Firm::new(p, staff, &ctx.entity))))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Firm>::restore(saved)?))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BuildType {
    #[serde(default)]
    materials: BTreeMap<String, i64>,
    #[serde(default)]
    build_labour: i64,
    #[serde(default)]
    demolition_labour: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    types: BTreeMap<String, BuildType>,
    yard: String,
    industry: String,
    supplier: String,
    wage: i64,
    period: i64,
    working_day: i64,
    work_days: i64,
    build_markup_bps: i64,
    quote_valid_days: i64,
    workplace: String,
    max_crew: i64,
    min_crew: i64,
    horizon_days: i64,
    notice_days: i64,
    let_go_every_days: i64,
    look_at: Option<i64>,
    look_days: Option<i64>,
    register: Option<String>,
    sites: String,
    notify: Vec<String>,
    repair_task: String,
    repair_labour: i64,
    repair_price: i64,
    repair_first: bool,
    registered_bps: i64,
    casual_bps: i64,
    day_wage: i64,
}

impl Params {
    fn read(ctx: &Ctx) -> Result<Params, String> {
        let supplier: String = ctx.need("supplier", "firm.builder")?;
        #[derive(Deserialize)]
        struct Reg {
            lots: String,
        }
        let register: Option<Reg> = ctx.param("register", None)?;
        Ok(Params {
            types: ctx.param("types", BTreeMap::new())?,
            yard: ctx.param("yard", String::new())?,
            industry: ctx.param("industry", String::new())?,
            supplier,
            wage: ctx.param("wage", 150_000)?,
            period: ctx.param("period", 14 * DAY)?,
            working_day: ctx.param("working_day", 8 * 3600)?,
            work_days: ctx.param("work_days", 5)?,
            build_markup_bps: ctx.param("build_markup_bps", 2000)?,
            quote_valid_days: ctx.param("quote_valid_days", 30)?,
            workplace: ctx.param("workplace", String::new())?,
            max_crew: ctx.param("max_crew", 12)?,
            min_crew: ctx.param("min_crew", 2)?,
            horizon_days: ctx.param("horizon_days", 90)?,
            notice_days: ctx.param("notice_days", 14)?,
            let_go_every_days: ctx.param("let_go_every_days", 7)?,
            look_at: ctx.param("look_at", None)?,
            look_days: ctx.param("look_days", None)?,
            register: register.map(|r| r.lots),
            sites: ctx.param("sites", String::new())?,
            notify: ctx.param("notify", vec![])?,
            repair_task: ctx.param("repair_task", String::new())?,
            repair_labour: ctx.param("repair_labour", 0)?,
            repair_price: ctx.param("repair_price", 0)?,
            repair_first: ctx.param("repair_first", true)?,
            registered_bps: ctx.param("registered_bps", 10_000)?,
            casual_bps: ctx.param("casual_bps", 0)?,
            day_wage: ctx.param("day_wage", 0)?,
        })
    }
}

/// A building or demolition of ours under way: hours of work left, and hours sent to the crew whose work has not
/// taken effect yet (F1, 2026-10-15). Hours left cannot be read from the file (the work leaves no paper): a cache.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Project {
    structure: String,
    build: bool,
    left: i64,
    flying: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Repair {
    id: String,
    orderer: String,
    structure: String,
    units: i64,
    left: i64,
    refused: i64,
    flying: i64,
}

/// A job a client has signed that we have taken on and not begun.
#[derive(Debug, Clone)]
struct Waiting {
    agreement: String,
    client: String,
    type_: Option<String>,
    on: Option<String>,
    remove: Option<String>,
    price: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum Then {
    /// A sign, decline, or start in flight for an agreement.
    Agreement(String),
    Started { agreement: String, type_: String, on: String, client: String, at: String, labour: i64 },
    Demolishing { agreement: String, sid: String, labour: i64 },
    Ordered,
    Published,
    Paying(String),
    Work { structure: String, build: bool, units: i64, share: i64, crew: Vec<String> },
    Mend { order: String, units: i64, share: i64, crew: Vec<String> },
}

#[derive(Debug, Serialize, Deserialize)]
struct Firm {
  p: Params,
  book: Book,
  staff: Staffing,
  dues: WindingUp,
  takings: Takings,
  bargaining: Bargaining,
  letters: Letters,
  asked: Asked,
  plans_out: BTreeSet<String>,
  no_plan: BTreeSet<String>,
  /// Acts in flight, by agreement or claim id (a cache of the file until it shows the act).
  in_flight: BTreeSet<String>,
  ordering: Vec<(String, i64)>,
  publishing: Option<String>,
  /// Jobs without an agreed price that we have begun (no invoice records it).
  begun: BTreeSet<String>,
  /// Debts we have paid (the payment settling them was seen).
  paying: BTreeSet<String>,
  projects: Vec<Project>,
  /// Structures whose hours are done or which are gone: never worked on again.
  over: BTreeSet<String>,
  finished: BTreeSet<String>,
  seen_type: BTreeMap<String, String>,
  repairs: Vec<Repair>,
  dealt: BTreeSet<String>,
  paid_in: BTreeMap<String, i64>,
  spoken_for: BTreeMap<String, i64>,
  used: BTreeMap<String, i64>,
  used_day: i64,
}

fn ceil_div(a: i128, b: i128) -> i128 {
    if b <= 0 {
        return a.max(0);
    }
    -((-a).div_euclid(b))
}
/// JS `Math.round` of a non-negative ratio (half up).
fn round_div(a: i64, b: i64) -> i64 {
    (2 * a + b).div_euclid(2 * b)
}
fn d(r: &Record) -> &Value {
    data(r)
}

fn sites_cells(pic: &Picture) -> Vec<&oikos_sight::SiteCell> {
    pic.channels.values().flat_map(|c| match c { Seen::Sites { cells, .. } => cells.iter().collect::<Vec<_>>(), _ => vec![] }).collect()
}

fn held(pic: &Picture, at: &str, kind: &str) -> i64 {
    pic.channels
        .values()
        .flat_map(|c| match c { Seen::Holdings { holdings } => holdings.iter().collect::<Vec<_>>(), _ => vec![] })
        .find(|h| h.at == at && h.kind == kind)
        .map_or(0, |h| h.quantity.clamp(0, i128::from(i64::MAX)) as i64)
}

impl Firm {
    fn new(p: Params, staff: Staffing, me: &str) -> Firm {
        Firm {
            p, book: Book::new(), staff, dues: WindingUp::new(me, WindingParams { short_days: 0, wind_up_days: 0, idle_days: 0, reprice_days: 0, reprice_bps: 0 }), takings: Takings::default(), bargaining: Bargaining::new(me), letters: Letters::default(), asked: Asked::default(), plans_out: BTreeSet::new(), no_plan: BTreeSet::new(),
            in_flight: BTreeSet::new(), ordering: vec![], publishing: None, begun: BTreeSet::new(), paying: BTreeSet::new(),
            projects: vec![], over: BTreeSet::new(), finished: BTreeSet::new(), seen_type: BTreeMap::new(), repairs: vec![], dealt: BTreeSet::new(),
            paid_in: BTreeMap::new(), spoken_for: BTreeMap::new(), used: BTreeMap::new(), used_day: -1,
        }
    }

    // ---- what the file says

    fn ours(&self, r: &Record, me: &str) -> bool {
        r.speaks_for.as_deref() == Some(me)
    }
    /// The wage now: the pay set, raised by each enterprise agreement of ours, in the order filed.
    fn wage_now(&self, me: &str) -> i64 {
        let mut w = self.p.wage;
        for r in self.book.open("enterprise_agreement") {
            if self.ours(r, me) && d(r).s("employer") == Some(me) {
                w = (w as i128 * (10_000 + d(r).i("rise_bps").unwrap_or(0)) as i128).div_euclid(10_000) as i64;
            }
        }
        w
    }
    fn hourly(&self, wage: i64) -> i64 {
        // the wage over the hours it pays for (working days in the period x the working day), exactly.
        let den = self.p.period as i128 * self.p.work_days as i128 * self.p.working_day as i128;
        ceil_div(wage as i128 * 3600 * DAY as i128 * 7, den.max(1)) as i64
    }
    fn declined(&self, me: &str, agreement: &str) -> bool {
        self.book.open("offer_declined").any(|r| self.ours(r, me) && papers::read::<OfferDeclined>(r).is_some_and(|p| p.agreement == agreement))
    }
    fn invoiced(&self, me: &str, agreement: &str) -> bool {
        self.book.open("invoice").any(|r| self.ours(r, me) && papers::read::<Invoice>(r).is_some_and(|p| p.agreement.as_deref() == Some(agreement)))
    }
    /// Begun: an invoice of ours cites it, or (no price agreed) we saw it begun.
    fn begun_job(&self, me: &str, agreement: &str) -> bool {
        self.begun.contains(agreement) || self.invoiced(me, agreement)
    }
    fn is_job(&self, r: &Record, me: &str) -> Option<(String, Option<agreements::Structure>, Option<i64>)> {
        let RecordBody::Agreement { terms } = &r.body else { return None };
        if !terms.parties.iter().any(|p| p == me) {
            return None;
        }
        let client = terms.parties.iter().find(|p| *p != me)?.clone();
        let job = commitment_of(r, me).0.and_then(|o| o.structure);
        let agreed = commitment_of(r, &client).0.and_then(|o| o.money).map(|m| m.amount);
        if terms.template.as_deref() != Some("construction") && !(job.is_some() && agreed.is_some()) {
            return None;
        }
        Some((client, job, agreed))
    }
    /// Taken on, declined or begun: no longer for the decision of the wake.
    fn settled(&self, r: &Record, me: &str) -> bool {
        self.book.signed_by(&r.id, me) || self.declined(me, &r.id) || self.begun_job(me, &r.id) || self.in_flight.contains(&r.id)
    }
    fn agreements(&self, me: &str) -> Vec<Arc<Record>> {
        self.book.of_type("agreement").filter(|r| agreements::parties_of(r).iter().any(|p| p == me)).cloned().collect()
    }
    /// Orders of ours not yet answered by a delivery note, by kind.
    fn on_order(&self, me: &str) -> BTreeMap<String, i64> {
        let answered: BTreeSet<&str> =
            self.book.all("delivery_note").filter(|n| crate::common::addressed_to(n).iter().any(|a| a == me)).filter_map(|n| d(n).s("order")).collect();
        let mut out: BTreeMap<String, i64> = BTreeMap::new();
        for o in self.book.all("order").filter(|o| self.ours(o, me) && d(o).s("at") == Some(self.p.yard.as_str())) {
            if answered.contains(o.id.as_str()) {
                continue;
            }
            *out.entry(d(o).s("kind").unwrap_or("").to_string()).or_insert(0) += d(o).i("quantity").unwrap_or(0);
        }
        for (k, q) in &self.ordering {
            *out.entry(k.clone()).or_insert(0) += q;
        }
        out
    }
    fn last_let_go(&self, me: &str) -> i64 {
        self.book
            .of_type("agreement")
            .filter(|a| agreements::template_of(a) == Some(agreements::EMPLOYMENT) && agreements::parties_of(a).first().map(String::as_str) == Some(me))
            .flat_map(|a| self.book.notices(&a.id).filter(|n| n.party == me).map(|n| n.at).collect::<Vec<_>>())
            .max()
            .unwrap_or(i64::MIN / 2)
    }

    // ---- debts recorded against us, paid as a firm pays its debts (we don't wind up): wages, tax withheld, then the rest

    fn pay_debts(&mut self, account: &str, balance: i64, keep: i64, cx: &Cx) -> Vec<Step<Then>> {
        let mut left = balance - keep;
        let mut out = vec![];
        let debts: Vec<Arc<Record>> = self.dues.debts(&self.book).into_iter().filter(|r| !self.paying.contains(&r.id)).cloned().collect();
        for dbt in debts {
            let RecordBody::Claim { holder, about, .. } = &dbt.body else { continue };
            let amount = about.i("amount").unwrap_or(0);
            let Some(to) = about.s("account").map(String::from).or_else(|| creditor_account(&self.book, holder)) else { break };
            if amount > left {
                break;
            }
            left -= amount;
            self.paying.insert(dbt.id.clone());
            let kind = about.s("kind").unwrap_or("debt");
            let mut s = because(
                format!("Paying a debt recorded against us ({}).", about.s("for").unwrap_or(kind)),
                vec![pay(&to, amount, Pay { from: Some(account.into()), for_: Some(format!("Paying {kind} {}.", dbt.id)), settles: Some(dbt.id.clone()), ..Default::default() }, cx)],
            );
            s.then = Some(Then::Paying(dbt.id.clone()));
            out.push(s);
        }
        out
    }
}

impl Plan for Firm {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, _cx: &mut Cx) {
        self.book.absorb(pic);
        self.staff.absorb(pic);
        let acc = own_account(pic);
        self.dues.absorb(pic, acc.as_ref().map(|a| a.account.as_str()));
        if let Some(a) = &acc {
            for tx in pic.transactions() {
                if tx.from == a.account {
                    if let Some(s) = &tx.settles {
                        self.paying.remove(s);
                    }
                }
            }
            // What others paid in: what a day without our crew costs us (Bargaining).
            for (_, c) in receipts(pic, &a.account) {
                self.takings.add(pic.t, c);
            }
            if !self.p.repair_task.is_empty() {
                for (from, c) in receipts(pic, &a.account) {
                    *self.paid_in.entry(from).or_insert(0) += c;
                }
            }
        }
        self.letters.take(pic, &self.book);
        // (The register's answer comes with the observation after we ask: a lot it has no plan of is not on it.)
        for lot in std::mem::take(&mut self.plans_out) {
            if !self.book.has(&lot) {
                self.no_plan.insert(lot);
            }
        }
        // What our crew left on the sites it worked on: theirs to know.
        for o in &pic.outcomes {
            for st in &o.seen {
                self.seen_type.insert(st.structure.clone(), st.structure_type.clone());
                if st.complete {
                    self.finished.insert(st.structure.clone());
                }
            }
        }
    }

    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        let me = pic.entity.clone();
        let built: BTreeMap<String, bool> = sites_cells(pic).iter().map(|c| (c.cell.clone(), c.structure.is_some())).collect();
        let (mut plan, mut visit) = (None, None);
        for r in self.agreements(&me) {
            let Some((client, job, _)) = self.is_job(&r, &me) else { continue };
            if self.settled(&r, &me) {
                continue;
            }
            let lot = job.as_ref().and_then(|j| j.on.clone());
            if let (None, Some(reg), Some(lot)) = (&plan, &self.p.register, &lot) {
                if !self.book.has(lot) && self.asked.first(lot, pic.t) {
                    plan = Some(ask::one(reg, lot));
                    self.plans_out.insert(lot.clone());
                }
            }
            if visit.is_some() || self.p.sites.is_empty() || !self.book.signed_by(&r.id, &client) {
                continue;
            }
            let place = job.as_ref().and_then(|j| j.remove.clone()).or_else(|| lot.as_ref().and_then(|l| cells_of(&self.book, l).into_iter().find(|c| built.get(*c) != Some(&true)).map(String::from)));
            if let Some(place) = place {
                if self.asked.first(&format!("site:{}:{place}", r.id), pic.t) {
                    visit = Some(go_see(&self.p.sites, &[place]));
                }
            }
        }
        plan.into_iter().chain(visit).collect()
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let me = pic.entity.clone();
        let t = pic.t;
        let mut steps: Vec<Step<Then>> = vec![];
        let Some(acc) = own_account(pic) else { return steps };
        let wage = self.wage_now(&me);
        // Seed the staff's notices from the file (a successor's Staff starts blank).
        let noticed: Vec<(String, i64)> = self
            .book
            .of_type("agreement")
            .filter(|a| agreements::template_of(a) == Some(agreements::EMPLOYMENT) && agreements::parties_of(a).first().map(String::as_str) == Some(me.as_str()))
            .flat_map(|a| self.book.notices(&a.id).filter(|n| n.party == me).map(|n| (a.id.clone(), n.at)).collect::<Vec<_>>())
            .collect();
        for (id, at) in noticed {
            self.staff.noticed.entry(id).or_insert(at);
        }
        let crew_now = self.staff.workers(&self.book, t);
        let keep = crew_now.len() as i64 * wage;
        steps.extend(self.pay_debts(&acc.account, acc.balance, keep, cx));

        // What stands on the ground, as it is shown.
        let cells = sites_cells(pic);
        let mut built_cell: BTreeMap<String, bool> = BTreeMap::new();
        let mut type_of: BTreeMap<String, String> = self.seen_type.clone();
        let mut went: BTreeMap<String, i64> = BTreeMap::new();
        for c in &cells {
            built_cell.insert(c.cell.clone(), c.structure.is_some());
            if let Some(s) = &c.structure {
                type_of.insert(s.structure.clone(), s.structure_type.clone());
            }
        }
        if !self.p.sites.is_empty() {
            if let Some(Seen::Sites { visit: Some(v), .. }) = pic.channels.get(&self.p.sites) {
                went = v.seen_at.clone();
            }
        }
        let site_on = |book: &Book, lot: &str| -> String {
            let cs = cells_of(book, lot);
            if cs.len() <= 1 { lot.to_string() } else { cs.iter().find(|c| built_cell.get(**c) == Some(&false)).map_or(lot, |c| *c).to_string() }
        };
        // Buildings of ours still going up (a successor finds them where the crew left them).
        for c in &cells {
            if let Some(s) = &c.structure {
                if s.built_by.as_deref() == Some(me.as_str()) && !s.complete && s.coming_down != Some(true) && !self.over.contains(&s.structure) && !self.finished.contains(&s.structure) && !self.projects.iter().any(|p| p.structure == s.structure) {
                    let labour = self.p.types.get(&s.structure_type).map_or(0, |x| x.build_labour);
                    if labour > 0 {
                        self.projects.push(Project { structure: s.structure.clone(), build: true, left: labour, flying: 0 });
                    }
                }
            }
        }

        // Prices.
        let offered = trade::goods_prices(&self.book, &self.p.supplier);
        let (supply, supply_account) = (offered.prices, offered.account);
        let hourly = self.hourly(wage);
        let with_margin = |x: i64| (x as i128 * (10_000 + self.p.build_markup_bps) as i128).div_euclid(10_000) as i64;
        let mut prices: BTreeMap<String, i64> = BTreeMap::new();
        let mut demolition: BTreeMap<String, i64> = BTreeMap::new();
        for (ty, x) in &self.p.types {
            let m: Option<i64> = x.materials.iter().map(|(k, q)| supply.get(k).map(|p| q * p)).sum();
            if let Some(m) = m {
                prices.insert(ty.clone(), with_margin(m + ceil_div(x.build_labour as i128 * hourly as i128, 3600) as i64));
            }
            demolition.insert(ty.clone(), with_margin(ceil_div(x.demolition_labour as i128 * hourly as i128, 3600) as i64));
        }
        let price_text = prices.keys().map(|ty| format!("{ty} {} (demolition {})", money_words(prices[ty], &cx.ctx.world), money_words(demolition[ty], &cx.ctx.world))).collect::<Vec<_>>().join("; ");
        let key = serde_json::to_string(&(&prices, &demolition)).unwrap_or_default();
        let old: Vec<Arc<Record>> = self.book.open("price_list").filter(|r| self.ours(r, &me)).cloned().collect();
        let on_file = old.iter().max_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&b.id, &a.id))).map(|r| {
            let m = |k: &str| -> BTreeMap<String, i64> { d(r).get(k).and_then(Value::as_object).map(|o| o.iter().filter_map(|(k, v)| v.as_i64().map(|n| (k.clone(), n))).collect()).unwrap_or_default() };
            serde_json::to_string(&(m("prices"), m("demolition"))).unwrap_or_default()
        });
        if !prices.is_empty() && on_file.as_deref() != Some(key.as_str()) && self.publishing.as_deref() != Some(key.as_str()) {
            self.publishing = Some(key);
            let mut calls: Vec<_> = old.iter().map(|r| withdraw(&r.id, Some("Superseded."))).collect();
            calls.push(say("price_list", &format!("Our prices for building on your lot, finished, and for demolition: {price_text}."), Say { visible: Some(Visible::Public), data: Some(j!({ "prices": prices, "demolition": demolition })), ..Default::default() }));
            let mut s = because(if old.is_empty() { "Publishing our prices, so clients know what building costs." } else { "Our costs have changed: republishing our prices." }, calls);
            s.then = Some(Then::Published);
            steps.push(s);
        }

        // Contracts a client has signed: take them on, or decline them in writing. Known by its terms, whatever it's called.
        let mut our_lots: BTreeSet<String> = BTreeSet::new();
        let mut waiting: Vec<Waiting> = vec![];
        let agreements_now = self.agreements(&me);
        for r in &agreements_now {
            let Some((client, job, agreed)) = self.is_job(r, &me) else { continue };
            if !self.book.signed_by(&r.id, &client) || self.book.taken_back(&r.id) {
                continue;
            }
            let ty = job.as_ref().and_then(|j| j.type_.clone());
            let on = job.as_ref().and_then(|j| j.on.clone());
            let remove = job.as_ref().and_then(|j| j.remove.clone());
            if self.declined(&me, &r.id) {
                continue;
            }
            if self.settled(r, &me) {
                if let (Some(_), Some(on)) = (&ty, &on) {
                    our_lots.insert(on.clone());
                }
                if !self.begun_job(&me, &r.id) && !self.in_flight_start(&r.id) {
                    waiting.push(Waiting { agreement: r.id.clone(), client, type_: ty, on, remove, price: agreed });
                }
                continue;
            }
            // (Not before our foreman has been to the lot, or to what is to come down, since the contract was made.)
            if let (Some(lot), None, false) = (&on, &remove, self.p.sites.is_empty()) {
                let cs = cells_of(&self.book, lot);
                let free = cs.iter().any(|c| built_cell.get(*c) == Some(&false) && went.get(*c).copied().unwrap_or(-1) >= r.at);
                let full = !cs.is_empty() && cs.iter().all(|c| built_cell.get(*c) == Some(&true));
                if if cs.is_empty() { self.p.register.is_some() && !self.no_plan.contains(lot) } else { !free && !full } {
                    continue;
                }
            }
            // A kind of building we have no figures for, or a job without a site, cannot be done: said so.
            let decline = |reason: &str, words: String, why: String, price: Option<i64>| {
                let p = OfferDeclined { agreement: r.id.clone(), reason: Some(reason.into()), price };
                let mut s = because(why, vec![say("offer_declined", &words, Say { to: Some(vec![client.clone()]), visible: Some(Visible::Only(vec![me.clone(), client.clone()])), basis: Some(r.id.clone()), data: Some(paper_data(&p)), ..Default::default() })]);
                s.then = Some(Then::Agreement(r.id.clone()));
                s
            };
            if let Some(ty) = &ty {
                if !self.p.types.contains_key(ty) {
                    self.in_flight.insert(r.id.clone());
                    steps.push(decline("unknown_type", format!("We can't build a {ty}: it is not a kind of building we build."), format!("{client} asks us to build a {ty}, which we have no figures for: declining, and saying so."), None));
                    continue;
                }
            } else if remove.is_none() {
                self.in_flight.insert(r.id.clone());
                steps.push(decline("cannot_build", "We can't take this job: it names no kind of building to build and nothing to bring down.".into(), format!("{client} asks for work that names neither a building nor something to demolish: declining, and saying so."), None));
                continue;
            }
            let ours = ty.as_ref().and_then(|ty| prices.get(ty)).copied();
            if ty.is_some() && ours.is_none() {
                continue; // (we wait for our supplier's prices, as a firm would)
            }
            // A lot already built on, or with a job of ours on it: declined, saying so.
            let lot_cells = if ty.is_some() { on.as_deref().map(|l| cells_of(&self.book, l)).unwrap_or_default() } else { vec![] };
            if let (Some(ty), Some(on)) = (&ty, &on) {
                if our_lots.contains(on) || (!lot_cells.is_empty() && lot_cells.iter().all(|c| built_cell.get(*c) == Some(&true))) {
                    let own = if our_lots.contains(on) { " (our own job there)" } else { "" };
                    self.in_flight.insert(r.id.clone());
                    steps.push(decline("site_taken", format!("We can't build a {ty} on {on}: it's already built on{}.", if own.is_empty() { "" } else { ", with our own job there" }), format!("{client} asks us to build a {ty} on {on}, which is already built on{own}: declining, and saying so."), None));
                    continue;
                }
            }
            // Offered less than our price: declined, saying what we charge. A price published in the last `quote_valid_days` is honoured.
            if let (Some(agreed), Some(ours), Some(ty)) = (agreed, ours, &ty) {
                let least = self.book.all("price_list").filter(|l| self.ours(l, &me) && t - l.at <= self.p.quote_valid_days * DAY).filter_map(|l| d(l).get("prices").and_then(|p| p.get(ty)).and_then(Value::as_i64)).fold(ours, i64::min);
                if agreed < least {
                    let w = &cx.ctx.world;
                    self.in_flight.insert(r.id.clone());
                    steps.push(decline("price", format!("We can't build a {ty} on {} for {}: our price is {}. Offer us a construction agreement at that price and we'll take it on.", on.clone().unwrap_or_default(), money_words(agreed, w), money_words(ours, w)), format!("{client} offers {} to build a {ty}; our price is {}: declining, and saying so.", money_words(agreed, w), money_words(ours, w)), Some(ours)));
                    continue;
                }
            }
            waiting.push(Waiting { agreement: r.id.clone(), client: client.clone(), type_: ty.clone(), on: on.clone(), remove, price: agreed });
            if let (Some(_), Some(on)) = (&ty, &on) {
                our_lots.insert(on.clone());
            }
            if !self.book.signed_by(&r.id, &me) && !self.book.taken_back(&r.id) {
                self.in_flight.insert(r.id.clone());
                let mut s = because("A client has signed a construction contract: taking it on.", vec![agreements::sign(&r.id)]);
                s.then = Some(Then::Agreement(r.id.clone()));
                steps.push(s);
            }
        }

        // Materials: what the waiting jobs need, oldest first, as far as we can pay for them, against what's in the yard and on order.
        let on_order = self.on_order(&me);
        let short_of = |k: &str, q: i64| (q - held(pic, &self.p.yard, k) - on_order.get(k).copied().unwrap_or(0)).max(0);
        let cost_of = |m: &BTreeMap<String, i64>| -> i128 { m.iter().map(|(k, q)| supply.get(k).map_or(i128::MAX / 4, |p| short_of(k, *q) as i128 * *p as i128)).sum() };
        let mut need: BTreeMap<String, i64> = BTreeMap::new();
        for w in &waiting {
            let mut next = need.clone();
            if let Some(x) = w.type_.as_ref().and_then(|ty| self.p.types.get(ty)) {
                for (k, q) in &x.materials {
                    *next.entry(k.clone()).or_insert(0) += q;
                }
            }
            if cost_of(&next) > acc.balance as i128 {
                break;
            }
            need = next;
        }
        for (kind, q) in &need {
            let short = short_of(kind, *q);
            let (Some(price), Some(seller_acc)) = (supply.get(kind), supply_account.as_ref()) else { continue };
            if short <= 0 || (acc.balance as i128) < short as i128 * *price as i128 {
                continue;
            }
            self.ordering.push((kind.clone(), short));
            let mut s = trade::order::<Then>(
                &Ordering {
                    me: me.clone(),
                    seller: self.p.supplier.clone(),
                    seller_account: seller_acc.clone(),
                    kind: kind.clone(),
                    quantity: short,
                    unit_price: *price,
                    to: None,
                    at: self.p.yard.clone(),
                    from: acc.account.clone(),
                    why: format!("Our waiting jobs need {q} {kind} and the yard has {}: ordering {short} from our supplier.", held(pic, &self.p.yard, kind)),
                    retry_of: None,
                    for_days: None,
                    terms: None,
                },
                cx,
            );
            s.then = Some(Then::Ordered);
            steps.push(s);
        }

        // Start what we can, oldest first: buildings once their materials are in the yard; demolitions at once.
        let mut in_yard: BTreeMap<String, i64> = BTreeMap::new();
        for w in &waiting {
            if self.in_flight.contains(&w.agreement) {
                continue;
            }
            let what = if let Some(r) = &w.remove { format!("demolishing {r}") } else { format!("building a {} on {}", w.type_.clone().unwrap_or_default(), w.on.clone().unwrap_or_default()) };
            let invoice = w.price.map(|price| {
                let p = Invoice { outcome: Some(PaymentOutcome { money: Some(crate::papers::market::MoneyOutcome { from: None, to: acc.account.clone(), amount: price, for_: Some(what.clone()), line: None, settles: None }), account: None }), agreement: Some(w.agreement.clone()), type_: if w.remove.is_some() { None } else { w.type_.clone() }, kind: None, quantity: None, from_at: None, dockets: vec![], service: None, home: None, kl: None, days: None, units: None, estimated: None };
                {
                    // (The amount of money an outcome asks for is a decimal string in the smallest unit, as every other invoice and
                    // request in the world writes it, and as the bank's transfers it is paid by record it.)
                    let mut d = paper_data(&p);
                    d["outcome"]["money"]["amount"] = Value::String(price.to_string());
                    say("invoice", &format!("Invoice: {} for {what}.", money_words(price, &cx.ctx.world)), Say { to: Some(vec![w.client.clone()]), basis: Some(w.agreement.clone()), data: Some(d), ..Default::default() })
                }
            });
            if let Some(sid) = &w.remove {
                // We need to know what it is (how long it takes to bring down): once we've seen it, we start.
                let Some(ty) = type_of.get(sid) else { continue };
                let labour = self.p.types.get(ty).map_or(0, |x| x.demolition_labour);
                for pr in self.projects.iter_mut().filter(|p| p.structure == *sid && p.build) {
                    pr.left = 0;
                }
                let mut calls = vec![call("structure", vec![("remove", Some(arg(sid))), ("by", Some(arg(&me)))])];
                calls.extend(invoice);
                if !self.p.notify.is_empty() {
                    let n = BuildingNotice { lot: None, at: None, structure: None, structure_type: None, client: Some(w.client.clone()), removes: Some(sid.clone()) };
                    calls.push(say("building_notice", &format!("Notice of building work: {sid} is being demolished, for {}.", w.client), Say { to: Some(self.p.notify.clone()), basis: Some(w.agreement.clone()), data: Some(paper_data(&n)), ..Default::default() }));
                }
                let mut s = because(format!("A demolition contract: starting to bring down {sid}, and invoicing the price."), calls);
                s.then = Some(Then::Demolishing { agreement: w.agreement.clone(), sid: sid.clone(), labour });
                self.in_flight.insert(w.agreement.clone());
                steps.push(s);
                continue;
            }
            let (Some(ty), Some(on)) = (&w.type_, &w.on) else { continue };
            let Some(x) = self.p.types.get(ty) else { continue };
            let yard = self.p.yard.clone();
            let stock = |m: &BTreeMap<String, i64>, k: &str| m.get(k).copied().unwrap_or_else(|| held(pic, &yard, k));
            if !x.materials.iter().all(|(k, q)| stock(&in_yard, k) >= *q) {
                continue;
            }
            for (k, q) in &x.materials {
                let left = stock(&in_yard, k) - q;
                in_yard.insert(k.clone(), left);
            }
            let at = site_on(&self.book, on);
            let mut lines = vec![Line { bind: Some("site".into()), call: call("structure", vec![("type", Some(arg(ty))), ("on", Some(arg(&at))), ("by", Some(arg(&me))), ("materials_at", Some(arg(&self.p.yard)))]) }];
            lines.extend(invoice.into_iter().map(|c| Line { bind: None, call: c }));
            let mut s = Step::new(lines);
            s.why = Some(format!("The materials for a {ty} on {on} are in the yard: starting it, and invoicing the agreed price."));
            let shown_at = if at.starts_with("cell.") { at.clone() } else { cells_of(&self.book, on).first().map_or(at.clone(), |c| c.to_string()) };
            s.then = Some(Then::Started { agreement: w.agreement.clone(), type_: ty.clone(), on: on.clone(), client: w.client.clone(), at: shown_at, labour: x.build_labour });
            self.in_flight.insert(w.agreement.clone());
            steps.push(s);
        }

        // Repair orders addressed to us: taken on once the money for them has come in from the account the order names.
        if !self.p.repair_task.is_empty() {
            let answered: BTreeSet<String> = self
                .book
                .open("repair_done")
                .chain(self.book.open("repair_declined"))
                .filter(|r| self.ours(r, &me))
                .filter_map(|r| d(r).s("order").map(String::from))
                .collect();
            let mut orders: Vec<Arc<Record>> = self.book.open("repair_order").filter(|r| !self.dealt.contains(&r.id) && !answered.contains(&r.id) && crate::common::addressed_to(r).iter().any(|a| *a == me)).cloned().collect();
            orders.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
            for r in orders {
                let orderer = r.speaks_for.clone().unwrap_or_default();
                let structure = d(&r).s("structure").map(String::from);
                let units = d(&r).i("units");
                let from = d(&r).s("account").map(String::from);
                let decline = |dealt: &mut BTreeSet<String>, steps: &mut Vec<Step<Then>>, reason: &str, words: String| {
                    dealt.insert(r.id.clone());
                    let p = RepairDeclined { order: r.id.clone(), structure: structure.clone(), reason: reason.into() };
                    steps.push(because(format!("{orderer} ordered a repair of {} and {reason}: declining, and saying so.", structure.clone().unwrap_or("something".into())), vec![say("repair_declined", &words, Say { to: Some(vec![orderer.clone()]), visible: Some(Visible::Only(vec![me.clone(), orderer.clone()])), basis: Some(r.id.clone()), data: Some(paper_data(&p)), ..Default::default() })]));
                };
                let (Some(structure), Some(units), Some(from)) = (structure.clone(), units.filter(|u| *u > 0), from) else {
                    decline(&mut self.dealt, &mut steps, "the order is not one we can read", "We can't take this order: it must name the building, a number of units, and the account it is paid from.".into());
                    continue;
                };
                let due = units * self.p.repair_price;
                if self.paid_in.get(&from).copied().unwrap_or(0) - self.spoken_for.get(&from).copied().unwrap_or(0) >= due {
                    self.dealt.insert(r.id.clone());
                    *self.spoken_for.entry(from).or_insert(0) += due;
                    self.repairs.push(Repair { id: r.id.clone(), orderer, structure, units, left: units, refused: 0, flying: 0 });
                } else if t - r.at >= 14 * DAY {
                    decline(&mut self.dealt, &mut steps, "the money has not come", format!("We have not taken your repair order for {structure}: the {} for it has not come into our account in 14 days. Send the order again with the money.", money_words(due, &cx.ctx.world)));
                }
            }
        }

        // The day's work: the crew at the yard, on our sites, oldest first, each up to a working day.
        let day = t.div_euclid(DAY);
        if day != self.used_day {
            self.used_day = day;
            self.used.clear();
        }
        let ours_crew: BTreeSet<String> = crew_now.iter().cloned().collect();
        let mut here: Vec<String> = cells
            .iter()
            .filter_map(|c| c.structure.as_ref())
            .filter(|s| s.structure == self.p.yard)
            .flat_map(|s| s.spaces.iter().flat_map(|sp| sp.occupants.clone().unwrap_or_default()))
            .filter(|w| ours_crew.contains(w))
            .collect();
        here.sort();
        here.dedup();
        let wd = self.p.working_day;
        let crew = { let used = &self.used; team(&here, |w| wd - used.get(w).copied().unwrap_or(0)).0 };
        let works_today = day.rem_euclid(7) < self.p.work_days && !crew.is_empty();
        if works_today && self.p.repair_first {
            self.repair_work(&crew, &mut steps);
        }
        if works_today {
            self.project_work(&crew, &mut steps);
        }
        if works_today && !self.p.repair_first {
            self.repair_work(&crew, &mut steps);
        }

        // The crew: enough hands for the work in hand within the horizon, within the yard's room.
        let in_hand: i64 = self.projects.iter().map(|p| p.left.max(0)).sum::<i64>()
            + self.repairs.iter().map(|r| r.left * self.p.repair_labour).sum::<i64>()
            + waiting.iter().map(|w| if let Some(r) = &w.remove { type_of.get(r).and_then(|ty| self.p.types.get(ty)).map_or(0, |x| x.demolition_labour) } else { w.type_.as_ref().and_then(|ty| self.p.types.get(ty)).map_or(0, |x| x.build_labour) }).sum::<i64>();
        let per_hand = (self.p.horizon_days * self.p.working_day * self.p.work_days).div_euclid(7).max(1);
        let want = self.p.max_crew.min(self.p.min_crew.max(ceil_div(in_hand as i128, per_hand as i128) as i64));
        let bill = (crew_now.len() as i128 * wage as i128 * 30 * DAY as i128).div_euclid(self.p.period.max(1) as i128) as i64;
        // Bargaining with a union (the employer's side: C1's): its offers follow what a stoppage costs it in takings.
        let per_day = self.takings.per_day(t);
        steps.extend(self.bargaining.steps::<Then>(&self.book, t, cx, &mut self.staff, &acc.account, acc.balance, per_day, 0).steps);
        let hours = round_div(in_hand, 3600);
        let wanted = Want {
            target: want,
            wage,
            can_post: acc.balance >= bill + wage,
            why: Some(format!("{hours} hours of work in hand need {want} hands to do within {} days; we have {}: posting a job.", self.p.horizon_days, crew_now.len())),
            recruit: None,
            stopped: None,
            work: Some(in_hand > 0),
        };
        steps.extend(self.staff.routine(pic, &self.book, cx, &acc.account, &wanted));
        // (Short of the next pay period for those we're keeping: someone already given notice is still crew until it runs out.)
        let keeping = self.staff.staying(&self.book, t) as i64;
        let broke = keeping > 0 && acc.balance < keeping * wage;
        if (crew_now.len() as i64 > want && t - self.last_let_go(&me) >= self.p.let_go_every_days * DAY) || broke {
            let why = if broke { format!("Can't cover the next pay period ({} for {keeping}): letting the most recent hire go.", money_words(acc.balance, &cx.ctx.world)) } else { format!("{hours} hours of work in hand need {want} hands; we have {}: letting the most recent hire go.", crew_now.len()) };
            let reason = if broke { "Redundancy: we can't cover the wage bill." } else { "Redundancy: there isn't the work." };
            steps.extend(self.staff.let_go(&self.book, t, cx, &why, reason));
        }
        let text = format!("Our prices for building on your lot, finished, and for demolition: {}. To have us build or demolish, offer us a construction agreement: what to build and on which lot (or what to demolish), and the price, paid from your account on our invoice. We start once you've signed and we have the materials; permits are the owner's to get.", if price_text.is_empty() { "none yet (we're waiting on our supplier's prices)".to_string() } else { price_text });
        let a = answers();
        steps.extend(self.letters.answer(Some(&a), "A letter asking about work: answering with our prices and how we take on a job.", |_| text.clone()));
        steps
    }

    fn until(&self, pic: &Picture) -> Option<i64> {
        let at = self.p.look_at?;
        Some(next_look(pic.t, at, self.p.look_days.unwrap_or(self.p.work_days)))
    }

    fn then(&mut self, tok: &Then, done: Done, cx: &mut Cx) -> Vec<Step<Then>> {
        let me = cx.ctx.entity.clone();
        let applied = done.applied();
        let out = match done { Done::Outcome(o) => Some(o), _ => None };
        match tok {
            Then::Agreement(id) => {
                self.in_flight.remove(id);
                vec![]
            }
            Then::Ordered => {
                if !self.ordering.is_empty() {
                    self.ordering.remove(0);
                }
                vec![]
            }
            Then::Published => {
                self.publishing = None;
                vec![]
            }
            Then::Paying(id) => {
                if !applied {
                    self.paying.remove(id);
                }
                vec![]
            }
            Then::Started { agreement, type_, on, client, at, labour } => {
                self.in_flight.remove(agreement);
                if !applied {
                    return vec![]; // (tried again tomorrow: the permit, or the site, may not yet be in order)
                }
                self.begun.insert(agreement.clone());
                let sid = out.and_then(|o| o.created.as_ref()).and_then(|c| c.get("site")).cloned();
                let Some(sid) = sid else { return vec![] };
                self.seen_type.insert(sid.clone(), type_.clone());
                if *labour > 0 {
                    self.projects.push(Project { structure: sid.clone(), build: true, left: *labour, flying: 0 });
                }
                if self.p.notify.is_empty() {
                    return vec![];
                }
                let n = BuildingNotice { lot: Some(on.clone()), at: Some(at.clone()), structure: Some(sid.clone()), structure_type: Some(type_.clone()), client: Some(client.clone()), removes: None };
                vec![because(format!("Work has begun on a {type_} on {on}: giving notice of it."), vec![say("building_notice", &format!("Notice of building work: a {type_} ({sid}) begun on {on}, for {client}."), Say { to: Some(self.p.notify.clone()), basis: Some(agreement.clone()), data: Some(paper_data(&n)), ..Default::default() })])]
            }
            Then::Demolishing { agreement, sid, labour } => {
                self.in_flight.remove(agreement);
                if applied {
                    self.begun.insert(agreement.clone());
                    if *labour > 0 {
                        self.projects.push(Project { structure: sid.clone(), build: false, left: *labour, flying: 0 });
                    }
                }
                vec![]
            }
            Then::Work { structure, build, units, share, crew } => {
                let (wd, i) = (self.p.working_day, self.projects.iter().position(|p| p.structure == *structure && p.build == *build));
                if let Some(i) = i {
                    let pr = &mut self.projects[i];
                    pr.flying = (pr.flying - units).max(0);
                    if applied {
                        pr.left -= units;
                        return vec![];
                    }
                }
                if applied {
                    return vec![];
                }
                self.unwork(crew, *share, out, wd);
                let code = refusal_code(out);
                if matches!(code.as_str(), "not_being_built" | "not_coming_down" | "unknown_structure") {
                    if let Some(i) = i {
                        self.projects[i].left = 0;
                    }
                    self.over.insert(structure.clone());
                }
                vec![]
            }
            Then::Mend { order, units, share, crew } => {
                let wd = self.p.working_day;
                let Some(i) = self.repairs.iter().position(|r| r.id == *order) else { return vec![] };
                self.repairs[i].flying = (self.repairs[i].flying - units).max(0);
                if applied {
                    self.repairs[i].left -= units;
                    if self.repairs[i].left <= 0 {
                        let r = self.repairs.remove(i);
                        let p = RepairDone { order: r.id.clone(), structure: r.structure.clone(), units: r.units };
                        return vec![because(format!("The repair of {} is done: telling {}.", r.structure, r.orderer), vec![say("repair_done", &format!("The repair of {} is done: {} units.", r.structure, r.units), Say { to: Some(vec![r.orderer.clone()]), visible: Some(Visible::Only(vec![me, r.orderer.clone()])), basis: Some(r.id.clone()), data: Some(paper_data(&p)), ..Default::default() })])];
                    }
                    return vec![];
                }
                self.unwork(crew, *share, out, wd);
                if out.is_some_and(|o| out_of_time(o).is_some()) {
                    return vec![]; // (tomorrow)
                }
                let code = refusal_code(out);
                self.repairs[i].refused += 1;
                if code == "unknown_structure" || self.repairs[i].refused >= 3 {
                    let r = self.repairs.remove(i);
                    let (reason, words) = if code == "unknown_structure" { ("unknown_structure".to_string(), format!("We cannot repair {}: it is not there.", r.structure)) } else { (if code.is_empty() { "refused".into() } else { code.clone() }, format!("We cannot repair {}: the work was refused.", r.structure)) };
                    let p = RepairDeclined { order: r.id.clone(), structure: Some(r.structure.clone()), reason };
                    return vec![because(format!("The repair of {} cannot be done ({}): telling {}.", r.structure, if code.is_empty() { "refused" } else { &code }, r.orderer), vec![say("repair_declined", &words, Say { to: Some(vec![r.orderer.clone()]), visible: Some(Visible::Only(vec![me, r.orderer.clone()])), basis: Some(r.id.clone()), data: Some(paper_data(&p)), ..Default::default() })])];
                }
                vec![]
            }
        }
    }
}

fn refusal_code(out: Option<&oikos_sight::Outcome>) -> String {
    out.and_then(|o| o.refusal.as_ref()).and_then(|r| serde_json::to_value(r.code).ok()).and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
}

impl Firm {
    fn in_flight_start(&self, id: &str) -> bool {
        self.in_flight.contains(id)
    }

    /// A refused work act gives the crew their hours back, and takes the world's count of anyone's day as ours.
    fn unwork(&mut self, crew: &[String], share: i64, out: Option<&oikos_sight::Outcome>, wd: i64) {
        for w in crew {
            let u = self.used.entry(w.clone()).or_insert(0);
            *u = (*u - share).max(0);
        }
        if let Some((who, left)) = out.and_then(out_of_time) {
            match who {
                Some(who) => {
                    self.used.insert(who, wd - left);
                    for w in crew {
                        let u = self.used.entry(w.clone()).or_insert(0);
                        *u = (*u).max(wd - left); // (the crew shares the work, so the others have no more room than they)
                    }
                }
                None => {
                    for w in crew {
                        self.used.insert(w.clone(), wd);
                    }
                }
            }
        }
    }

    fn repair_work(&mut self, crew: &[String], steps: &mut Vec<Step<Then>>) {
        if self.p.repair_task.is_empty() || self.p.repair_labour <= 0 {
            return;
        }
        let wd = self.p.working_day;
        for i in 0..self.repairs.len() {
            let r = self.repairs[i].clone();
            if r.left - r.flying <= 0 {
                continue;
            }
            let avail = crew.iter().map(|w| wd - self.used.get(w).copied().unwrap_or(0)).min().unwrap_or(0);
            let units = (r.left - r.flying).min((avail.max(0) * crew.len() as i64).div_euclid(self.p.repair_labour));
            if units <= 0 {
                break;
            }
            let share = ceil_div(units as i128 * self.p.repair_labour as i128, crew.len() as i128) as i64;
            for w in crew {
                *self.used.entry(w.clone()).or_insert(0) += share;
            }
            self.repairs[i].flying += units;
            let c = call("work", vec![("task", Some(arg(&self.p.repair_task))), ("units", Some(text(units.to_string()))), ("at", Some(arg(&self.p.yard))), ("by", Some(json(Value::from(crew.to_vec())))), ("on", Some(arg(&r.structure)))]);
            let mut s = because(format!("The day's work: {} of our crew repairing {} ({units} of the {} units left).", crew.len(), r.structure, r.left), vec![c]);
            s.then = Some(Then::Mend { order: r.id.clone(), units, share, crew: crew.to_vec() });
            steps.push(s);
        }
    }

    fn project_work(&mut self, crew: &[String], steps: &mut Vec<Step<Then>>) {
        let wd = self.p.working_day;
        let mut i = 0;
        while i < self.projects.len() {
            let pr = self.projects[i].clone();
            // A building finished (its hours done, or seen finished by the crew): nothing more to do there.
            if pr.left <= 0 || (pr.build && self.finished.contains(&pr.structure)) {
                self.projects.remove(i);
                continue;
            }
            i += 1;
            let avail = crew.iter().map(|w| wd - self.used.get(w).copied().unwrap_or(0)).min().unwrap_or(0);
            if avail <= 0 {
                break;
            }
            let units = (pr.left - pr.flying).min(avail * crew.len() as i64);
            if units <= 0 {
                continue;
            }
            let share = ceil_div(units as i128, crew.len() as i128) as i64;
            for w in crew {
                *self.used.entry(w.clone()).or_insert(0) += share;
            }
            self.projects[i - 1].flying += units;
            let task = if pr.build { "build" } else { "demolish" };
            let c = call("work", vec![("task", Some(arg(task))), ("units", Some(text(units.to_string()))), ("at", Some(arg(&self.p.yard))), ("by", Some(json(Value::from(crew.to_vec())))), ("on", Some(arg(&pr.structure)))]);
            let mut s = because(format!("The day's work: {} of our crew {} {} ({} hours of the {} left).", crew.len(), if pr.build { "building" } else { "demolishing" }, pr.structure, round_div(units, 3600), round_div(pr.left, 3600)), vec![c]);
            s.then = Some(Then::Work { structure: pr.structure.clone(), build: pr.build, units, share, crew: crew.to_vec() });
            steps.push(s);
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Draws, WorldInfo};
    use oikos_sight::{Action, Observation, View};

    fn ctx(extra: Value) -> Ctx {
        let mut params = j!({ "supplier": "outside", "yard": "yard", "types": { "house": { "materials": { "materials": 10 }, "build_labour": 7200, "demolition_labour": 3600 } } });
        if let (Some(p), Some(e)) = (params.as_object_mut(), extra.as_object()) {
            p.extend(e.clone());
        }
        Ctx { participant: "b-system".into(), performer: Default::default(), entity: "builder".into(), position: None, params: params.as_object().cloned().unwrap_or_default(), world: Arc::new(WorldInfo::default()) }
    }
    fn st(id: &str, at: i64, kind: &str, who: &str, data: Value, to: Value) -> Value {
        j!({ "id": id, "record": "statement", "author": "p.1", "speaks_for": who, "at": at, "visible_to": "public", "kind": kind, "text": kind, "data": data, "addressed_to": to })
    }
    fn supplier_list() -> Value {
        st("rec.1", 0, "price_list", "outside", j!({ "goods": { "materials": 100 }, "account": "acc-out" }), Value::Null)
    }
    fn obs(t: i64, records: Vec<Value>, yard_materials: i64, outcomes: Value) -> Observation {
        serde_json::from_value(j!({
            "participant": "b-system", "t": t, "status": "active", "outcomes": outcomes, "inbox": [], "drafts": [],
            "channels": {
                "budget": { "kind": "accounts", "accounts": [{ "account": "acc-b", "holder": "builder", "custodian": "bank", "currency": "XTS", "balance": "10000000" }], "transactions": [] },
                "yard": { "kind": "holdings", "holdings": [{ "kind": "materials", "at": "yard", "quantity": yard_materials.to_string() }] },
                "records": { "kind": "records", "records": records },
            }
        }))
        .unwrap()
    }
    /// One wake: every act the plan has for this moment, as call text.
    fn wake(a: &mut Box<dyn Actor>, view: &mut View, c: &Ctx, o: Observation) -> Vec<String> {
        let pic = view.apply(o, None, "builder", "cadence", DAY);
        let mut draws = Draws::new("b-system", "self");
        let mut out = vec![];
        for n in 0..40 {
            let mut cx = Cx::new(pic.t, c, &mut draws, 7, vec![]);
            match a.step(&pic, &mut cx) {
                Action::Call { program, .. } => {
                    out.push(oikos_sight::calls::program_text(&program));
                    a.sent(&format!("act.{n}"));
                }
                _ => break,
            }
        }
        out
    }
    fn agreement(id: &str, kind: &str, on: &str, price: i64) -> Vec<Value> {
        let a = j!({ "id": id, "record": "agreement", "author": "client", "at": 5, "visible_to": ["client", "builder"], "terms": { "template": "construction", "parties": ["client", "builder"], "commitments": [
            { "who": "client", "does": { "outcome": { "money": { "from": "acc-c", "to": "acc-b", "amount": price.to_string() } } } },
            { "who": "builder", "does": { "outcome": { "structure": { "type": kind, "on": on } } } }] } });
        let sig = |i: &str, who: &str| j!({ "id": i, "record": "signature", "author": who, "speaks_for": who, "at": 6, "visible_to": ["client", "builder"], "agreement": id, "as": who });
        vec![a, sig(&format!("{id}-c"), "client")]
    }
    fn fresh(c: &Ctx) -> Box<dyn Actor> {
        Builder.create(c).unwrap()
    }

    #[test]
    fn the_manifest_is_the_ts_one() {
        let ts: Value = crate::offices::testing::ts_manifest("firm.builder");
        let rust = Builder.manifest();
        for (k, v) in ts.as_object().unwrap() {
            assert_eq!(&rust[k], v, "{k}");
        }
    }

    #[test]
    fn it_publishes_prices_from_its_suppliers_and_a_successor_does_not_publish_them_again() {
        let c = ctx(j!({}));
        let (mut a, mut v) = (fresh(&c), View::default());
        let calls = wake(&mut a, &mut v, &c, obs(DAY, vec![supplier_list()], 0, j!([])));
        let first = calls.iter().find(|t| t.contains("price_list")).expect("publishes");
        assert!(first.contains("\"prices\":{\"house\":5700}") && first.contains("\"demolition\":{\"house\":2250}"), "{first}");
        // The prices on file as published: a successor with no memory leaves them be; a changed cost republishes.
        let ours = st("rec.9", DAY, "price_list", "builder", j!({ "prices": { "house": 5700 }, "demolition": { "house": 2250 } }), Value::Null);
        let (mut b, mut v) = (fresh(&c), View::default());
        let calls = wake(&mut b, &mut v, &c, obs(2 * DAY, vec![supplier_list(), ours.clone()], 0, j!([])));
        assert!(calls.iter().all(|t| !t.contains("price_list(")), "{calls:?}");
        let dearer = st("rec.10", 2 * DAY, "price_list", "outside", j!({ "goods": { "materials": 200 }, "account": "acc-out" }), Value::Null);
        let calls = wake(&mut b, &mut v, &c, obs(3 * DAY, vec![dearer], 0, j!([])));
        assert!(calls.iter().any(|t| t.contains("price_list") && t.contains("withdraw")), "{calls:?}");
    }

    #[test]
    fn a_job_it_has_no_figures_for_is_declined_in_writing() {
        let c = ctx(j!({}));
        let (mut a, mut v) = (fresh(&c), View::default());
        let mut rs = vec![supplier_list()];
        rs.extend(agreement("agr.1", "castle", "lot-1", 9_000_000));
        let calls = wake(&mut a, &mut v, &c, obs(DAY, rs, 0, j!([])));
        let d = calls.iter().find(|t| t.contains("offer_declined")).expect("declines");
        assert!(d.contains("unknown_type") && d.contains("agr.1"), "{d}");
        assert!(calls.iter().all(|t| !t.contains("sign=")), "{calls:?}");
    }

    #[test]
    fn an_offer_below_its_price_is_declined_saying_what_it_charges() {
        let c = ctx(j!({}));
        let (mut a, mut v) = (fresh(&c), View::default());
        let mut rs = vec![supplier_list()];
        rs.extend(agreement("agr.1", "house", "lot-1", 1000));
        let calls = wake(&mut a, &mut v, &c, obs(DAY, rs, 0, j!([])));
        let d = calls.iter().find(|t| t.contains("offer_declined")).expect("declines");
        assert!(d.contains("5700") && d.contains("agr.1"), "{d}");
    }

    #[test]
    fn a_signed_contract_is_taken_on_orders_materials_and_a_successor_starts_it_from_the_file() {
        let c = ctx(j!({}));
        let mut rs = vec![supplier_list()];
        rs.extend(agreement("agr.1", "house", "lot-1", 6_000_000));
        let (mut a, mut v) = (fresh(&c), View::default());
        let calls = wake(&mut a, &mut v, &c, obs(DAY, rs.clone(), 0, j!([])));
        assert!(calls.iter().any(|t| t.contains("sign=agr.1")), "{calls:?}");
        assert!(calls.iter().any(|t| t.contains("order(") || t.contains("kind=order")), "orders the materials: {calls:?}");
        // The builder signed, and the materials are in the yard: a new holder of the post begins it, once.
        let mut with_sig = rs.clone();
        with_sig.push(j!({ "id": "agr.1-b", "record": "signature", "author": "b", "speaks_for": "builder", "at": 7, "visible_to": ["client", "builder"], "agreement": "agr.1", "as": "builder" }));
        let (mut b, mut v) = (fresh(&c), View::default());
        let calls = wake(&mut b, &mut v, &c, obs(2 * DAY, with_sig.clone(), 10, j!([])));
        let start = calls.iter().find(|t| t.contains("structure(")).expect("starts the building");
        assert!(start.contains("type=house") && start.contains("on=lot-1") && start.contains("materials_at=yard"), "{start}");
        assert!(start.contains("kind=invoice") && start.contains("6000000"), "invoices the agreed price: {start}");
        // Its invoice on file: begun, never started again by yet another holder.
        let inv = st("rec.20", 2 * DAY, "invoice", "builder", j!({ "agreement": "agr.1", "type": "house", "outcome": { "money": { "to": "acc-b", "amount": "6000000" } } }), j!(["client"]));
        with_sig.push(inv);
        let (mut cc, mut v) = (fresh(&c), View::default());
        let calls = wake(&mut cc, &mut v, &c, obs(3 * DAY, with_sig, 10, j!([])));
        assert!(calls.iter().all(|t| !t.contains("structure(")), "{calls:?}");
    }

    #[test]
    fn a_refused_start_is_tried_again_and_its_memory_saves() {
        let c = ctx(j!({}));
        let mut rs = vec![supplier_list()];
        rs.extend(agreement("agr.1", "house", "lot-1", 6_000_000));
        rs.push(j!({ "id": "agr.1-b", "record": "signature", "author": "b", "speaks_for": "builder", "at": 7, "visible_to": ["client", "builder"], "agreement": "agr.1", "as": "builder" }));
        let (mut a, mut v) = (fresh(&c), View::default());
        let calls = wake(&mut a, &mut v, &c, obs(DAY, rs, 10, j!([])));
        let n = calls.iter().position(|t| t.contains("structure(")).expect("starts");
        // Refused (no permit): the next day it tries again.
        let refused = j!([{ "action": format!("act.{n}"), "t": DAY, "status": "refused", "refusal": { "code": "ground_occupied" } }]);
        let saved = a.save().unwrap();
        let mut a = Builder.restore(&c, saved.clone()).unwrap();
        assert_eq!(a.save().unwrap(), saved);
        let calls = wake(&mut a, &mut v, &c, obs(2 * DAY, vec![], 10, refused));
        assert!(calls.iter().any(|t| t.contains("structure(")), "{calls:?}");
    }
}
