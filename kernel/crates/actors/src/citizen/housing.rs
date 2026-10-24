//! Housing (citizen.ts): a home's tenancy ending, offers signed (homes and jobs), a rent rise, possession, moving in,
//! staying with someone, hunting, the land register, buying and selling (docs/behaviour/citizen.md, households.md,
//! justice.md, ownership.md).
//!
//! **What is fresh.** citizen.ts weighed offers and papers in `fresh`, the records new since the last full plan. Here
//! the book's place at the last full plan is kept (`Housing::fresh_from`): the first housing part of a full plan
//! (`retire_old_rents`) marks how far the book now runs, the parts read what is between, and the last
//! (`selling_and_buying`) moves the mark on. A plan that ends early (another adult's, one with no account) leaves the
//! mark, as TS left `fresh` to grow.
//!
//! Decided fresh (docs/port-guide.md, section 2):
//! - A rent order's id is taken from the book (our own standing request citing the lease, the latest not replaced),
//!   where TS took it from the act's `created.so`: the same order, read where the person sees it.
//! - A survivor of a sole leaseholder signs the landlord's offer of the tenancy and stays (bughunt 2026-10-17 #3): see
//!   `offers`.
//! - Culture's lean on a threshold (TS `cul.term` on the affinity it takes to take someone in) is not on the seam: the
//!   act is recorded (`choose_conduct`), the threshold unleaned. The sways TS put on answering the tribunal (trust,
//!   agency, the desk's record, fear, somewhere to go) are the mind's own lean through `choose_conduct`'s `who`.

use super::mind::{Choice, ConductAsk, Decide, Event, Facts, Heard, HomeFacts, Intent, Outcome, Treated, Way};
use super::params::Params;
#[allow(unused_imports)]
use super::person::{bound, cells, inside, occupants, step_of_lines, Home, Mark, Missed, Person, Todo, Vacate, Week};
use super::household::SAYING;
use crate::common::{
    addressed_to, ask, cites, data, first_due, is_kind, kind, letters::message, money_words, structure_of, when_words, Asked, ClaimKey, Fields, DAY, MONTH,
};
use crate::common::calls::{move_in, move_out, withdraw};
use crate::papers::agreements::{commitment_of, job_terms, lease_terms, notice, other_party, parties_of, sign, template_of};
use crate::steps::{arg, because, call, pay, say, Pay, Say, Step, Visible};
use crate::Cx;
use oikos_sight::{CmpOp, Condition, LookRequest, Record, RecordBody, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// A home left when told to vacate for arrears (for an answer to the tribunal if the landlord applies after).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LeftHome {
    pub agreement: String,
    pub landlord: String,
    pub space: String,
    pub at: i64,
}

/// Whose home we are staying in as guests.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stay {
    pub host: String,
    pub space: String,
    pub since: i64,
}

/// A home of ours up for sale.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Selling {
    pub lot: String,
    pub space: Option<String>,
    pub structure: String,
    pub bedrooms: Option<i64>,
    pub price: i64,
    pub asked: i64,
    /// Every listing made of it (a buyer may answer one since replaced by a cheaper).
    pub listings: Vec<String>,
    pub leave_after: bool,
    /// The listing standing now ("pending": made, not yet seen).
    pub listing: Option<String>,
    pub buyer: Option<String>,
    pub buyer_account: Option<String>,
    pub received: i64,
    pub sold: bool,
    pub loan: Option<String>,
}

/// A home we are buying.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Buying {
    pub listing: String,
    pub seller: String,
    pub account: String,
    pub price: i64,
    pub lot: String,
    pub space: String,
    pub structure: String,
    /// Applied for the mortgage (false), or paid (true).
    pub paid: bool,
    pub since: i64,
    pub funded: bool,
    pub gone_since: Option<i64>,
}

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Housing {
    /// Lots whose plan we've asked the register for; titles and when we last asked about them.
    plan_asked: Asked,
    title_asked: Asked,
    /// The book's place at the last full plan, and how far it runs in this one (see the module's head).
    pub(super) fresh_from: usize,
    pub(super) fresh_to: usize,
    /// Rent orders replaced or stopped by us: never again taken for the home's order.
    old_orders: BTreeSet<String>,
    /// Listings we've applied for.
    applied: BTreeSet<String>,
    /// "home:<space>" -> the decision that chose it (an outcome's `of`).
    chose: BTreeMap<String, u64>,
    left_home: Option<LeftHome>,
    /// Homes we moved out of before their tenancy ended: (lease, the orders paying it until it does).
    left_homes: Vec<(String, Vec<String>)>,
    /// Applications for possession against us, by lease; those we answered.
    applied_for: BTreeMap<String, u32>,
    answered_apps: BTreeSet<String>,
    /// Leases whose notice to vacate we have taken in (once a tenancy); those whose notice lapsed or was answered.
    notice_seen: BTreeSet<String>,
    pub notice_over: BTreeSet<String>,
    stay: Option<Stay>,
    stay_asked_at: Option<i64>,
    stay_ended_at: Option<i64>,
    took_in: BTreeSet<String>,
    stay_asked: BTreeSet<String>,
    next_move_try: i64,
    energy_for: Option<String>,
    /// Notices of rent increase weighed for the tribunal; those it upheld (recourse pushes them), to apply after all.
    challenged: BTreeSet<String>,
    pub upheld: Vec<String>,
    /// A better-paid job taken while in one: the offer and its wage, signed once our notice is worked out
    /// (work's `switch_start` reads it: TS's `switching`).
    pub switching: Option<(String, i64)>,
    /// The lease whose premises were found flooded (absorb sets it from a refusal; TS's `uninhabitable`).
    pub uninhabitable: Option<String>,
    // ---- homes for sale
    selling: Option<Selling>,
    buying: Option<Buying>,
    next_buy_chance: i64,
    /// When we sold up to leave (leaving town reads it: TS's `soldAndGoing`).
    pub sold_and_going: Option<i64>,
    /// The mortgage we asked the bank to be paid off with the sale's money, until we see the payment made (leaving town waits for it: what we
    /// send on is what is left after it).
    #[serde(default)]
    pub paying_off: Option<String>,
    sold_lots: BTreeSet<String>,
    /// What the last look at the listings showed (ids), and when; whether a look is out.
    on_sale: Option<Vec<String>>,
    sale_asked: bool,
    sale_seen_at: i64,
}

impl Housing {
    /// Whether we have taken this notice of rent increase to the tribunal.
    pub fn is_challenged(&self, notice: &str) -> bool {
        self.challenged.contains(notice)
    }
    pub fn new(_p: &Params, cx: &mut Cx) -> Self {
        Housing { next_buy_chance: cx.rng("buy-day").below(30) as i64 * DAY, sale_seen_at: -1, ..Housing::default() }
    }
}

/// An outcome's facts from a JSON object.
fn facts(v: Value) -> BTreeMap<String, Value> {
    match v {
        Value::Object(m) => m.into_iter().filter(|(_, v)| !v.is_null()).collect(),
        _ => BTreeMap::new(),
    }
}

fn cond(field: &str, op: CmpOp, value: impl Into<Value>) -> Condition {
    Condition { field: field.into(), op, value: value.into() }
}

/// A statement of this kind addressed to us.
fn to_us(r: &Record, k: &str, me: &str) -> bool {
    is_kind(r, k) && addressed_to(r).iter().any(|a| a == me)
}

/// TS's `Math.round` of a non-negative quotient: half away from zero.
fn round_div(n: i64, d: i64) -> i64 {
    if d == 0 {
        return 0;
    }
    (2 * n + d.signum() * d) / (2 * d)
}

impl Person {
    // ------------------------------------------------------------------ small rules (citizen.ts 4231-4253)

    /// A rent we can afford: within the share of household income, or, without income, covered by savings for months.
    pub fn affordable(&self, rent: i64, balance: i64, t: i64) -> bool {
        let hi = self.household_income(t);
        if hi > 0 {
            rent * 10_000 <= hi * self.p.rent_share_bps
        } else {
            rent * self.p.savings_rent_months <= balance
        }
    }
    /// A rent we can bear in the home we have (moving costs too).
    fn bearable(&self, rent: i64, balance: i64, t: i64) -> bool {
        let hi = self.household_income(t);
        if hi > 0 {
            rent * 10_000 <= hi * self.p.rent_bearable_share_bps
        } else {
            self.affordable(rent, balance, t)
        }
    }
    /// When an agreement of ours ends by its reading (never: `i64::MAX`).
    fn ends(&self, agreement: &str) -> i64 {
        self.book.ends_at(agreement).unwrap_or(i64::MAX)
    }
    /// Who ended an agreement of ours, as its notices say.
    fn ended_by(&self, agreement: &str) -> &'static str {
        let mut any = false;
        for n in self.book.notices(agreement) {
            if n.party == self.me {
                return "self";
            }
            any = true;
        }
        if any {
            "other"
        } else {
            "term"
        }
    }
    /// Fewest bedrooms to look for: what the standard asks, less one for each stretch spent hunting without it.
    pub fn min_bedrooms(&self, t: i64) -> i64 {
        let Some(h) = &self.s.household else { return 0 };
        let relax = self.s.homeless_since.map_or(0, |s| (t - s) / (self.p.accept_fewer_bedrooms_after_days * DAY).max(1));
        (oikos_rules::household::bedrooms_needed(h, t, self.p.year, self.p.occupancy.as_ref()) - relax).max(0)
    }
    /// At the start, the share of the rent another adult already pays us (-1: none on file).
    fn genesis_share(&self, person: &str) -> i64 {
        self.book
            .all("request")
            .find(|r| r.speaks_for.as_deref() == Some(person) && data(r).pointer("/outcome/money/for").and_then(Value::as_str) == Some("Household share of the rent."))
            .and_then(|r| data(r).pointer("/outcome/money/amount").and_then(crate::papers::lenient::whole))
            .unwrap_or(-1)
    }
    /// What kind of institution someone is to us (citizen.ts `kindOf`).
    fn kind_of(&self, who: &str, ctx_params: &serde_json::Map<String, Value>) -> String {
        if let Some(k) = ctx_params.get("institutions").and_then(|i| i.get(who)).and_then(Value::as_str) {
            return k.into();
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
        .into()
    }
    fn usd(w: &Week, n: i64) -> String {
        money_words(n, &w.cx.ctx.world)
    }
    /// What happened, told the mind (TS `outcome` in the home's and the job's domains).
    fn told(&mut self, w: &mut Week, domain: &str, option: &str, kind: &str, from: Option<&str>, f: Value) {
        let of = if domain == "home" { self.housing.chose.get(&format!("home:{option}")).copied() } else { None };
        self.tell(w, Outcome { domain: domain.into(), option: option.into(), kind: kind.into(), way: Way::Mine, from: from.map(String::from), facts: facts(f), of, ..Default::default() });
    }
    /// The records new since the last full plan (TS `fresh`).
    fn fresh(&self) -> Vec<Arc<Record>> {
        let to = self.housing.fresh_to.max(self.housing.fresh_from).min(self.book.len());
        self.book.records().skip(self.housing.fresh_from).take(to.saturating_sub(self.housing.fresh_from)).cloned().collect()
    }
    /// Found a home or work where someone told us to look: grateful to them (the mind's: told as a kindness), and the
    /// words for the reason.
    fn thank(&mut self, w: &mut Week, structure: Option<&str>) -> String {
        let Some(s) = structure else { return String::new() };
        let Some(who) = self.s.lead_from.remove(s) else { return String::new() };
        self.treated(w, Treated { who: who.clone(), kind: "tip".into(), good: true, weight_bps: Some(2_000), ..Default::default() });
        self.happened(w, Event::Other { what: "thanked".into(), about: Some(who.clone()), facts: facts(json!({ "structure": s })) });
        self.s.people_we_know.insert(who.clone());
        format!(" ({who} told us to look there: we're grateful)")
    }
    /// The home's rent order, read from our own requests where the act that made it has not told us its id.
    fn find_rent_order(&mut self) {
        let Some(h) = self.s.home.as_ref().filter(|h| !h.owned && h.order.is_none()) else { return };
        let me = self.me.as_str();
        let found = self
            .book
            .all("request")
            .rev()
            .find(|r| {
                r.speaks_for.as_deref() == Some(me)
                    && cites(r, &h.agreement)
                    && data(r).get("every").is_some()
                    && !self.book.withdrawn(&r.id)
                    && !self.housing.old_orders.contains(&r.id)
                    && !h.retiring.iter().any(|(o, _)| *o == r.id)
            })
            .map(|r| r.id.clone());
        if let (Some(o), Some(h)) = (found, self.s.home.as_mut()) {
            h.order = Some(o);
        }
    }
    /// A rent order of ours replaced or stopped: never the home's order again.
    fn retire_order(&mut self, o: &str) {
        self.housing.old_orders.insert(o.to_string());
    }

    // ------------------------------------------------------------------ the land register (citizen.ts 1159-1220)

    /// Whom a title is registered to by what we've read of the register (none: released, withdrawn, not a title).
    pub fn holder_of(&self, title: &str) -> Option<String> {
        let c = self.book.get(title)?;
        let RecordBody::Claim { holder, about, .. } = &c.body else { return None };
        if about.get("kind").and_then(Value::as_str) != Some("ownership") || self.book.released(&c.id) || self.book.withdrawn(&c.id) {
            return None;
        }
        let mut transfers: Vec<&Arc<Record>> = self.book.of_type("claim_transfer").filter(|r| matches!(&r.body, RecordBody::ClaimTransfer { claim, .. } if claim == title)).collect();
        transfers.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| crate::common::filed_before(&a.id, &b.id)));
        let mut h = holder.clone();
        for r in transfers {
            if let RecordBody::ClaimTransfer { to, .. } = &r.body {
                if r.speaks_for.as_deref() == Some(h.as_str()) || (r.speaks_for.is_some() && r.speaks_for == c.speaks_for) {
                    h = to.clone();
                }
            }
        }
        Some(h)
    }
    /// The titles that are ours, as far as we've read: (title, lot).
    pub fn our_titles(&self) -> Vec<(String, String)> {
        let mut ids: Vec<String> = vec![];
        for c in self.book.claims_by(ClaimKey::Holder, &self.me) {
            if let RecordBody::Claim { about, .. } = &c.body {
                if about.get("kind").and_then(Value::as_str) == Some("ownership") && !ids.contains(&c.id) {
                    ids.push(c.id.clone());
                }
            }
        }
        for r in self.book.of_type("claim_transfer") {
            if let RecordBody::ClaimTransfer { claim, to } = &r.body {
                if *to == self.me && !ids.contains(claim) {
                    ids.push(claim.clone());
                }
            }
        }
        ids.into_iter()
            .filter(|id| self.holder_of(id).as_deref() == Some(self.me.as_str()))
            .filter_map(|id| {
                let lot = match &self.book.get(&id)?.body {
                    RecordBody::Claim { about, .. } => about.get("object").and_then(Value::as_str)?.to_string(),
                    _ => return None,
                };
                Some((id, lot))
            })
            .collect()
    }
    pub fn register_looks(&mut self, t: i64) -> Vec<LookRequest> {
        let Some(reg) = self.p.register.clone() else { return vec![] };
        let mut ask_title = None;
        for r in self.book.of_type("claim_transfer") {
            if let RecordBody::ClaimTransfer { claim, to } = &r.body {
                if *to != self.me || self.housing.title_asked.since(claim) >= r.at {
                    continue;
                }
                ask_title = Some(claim.clone());
                break;
            }
        }
        if let Some(claim) = ask_title {
            self.housing.title_asked.again(&claim, t);
            return vec![
                ask::one(&reg.titles, &claim),
                ask::about(&reg.dealings, "claim", claim.clone(), crate::common::asking::ask::About { most: self.p.search_limit, oldest: true, ..Default::default() }),
            ];
        }
        for (_, lot) in self.our_titles() {
            if self.book.has(&lot) || !self.housing.plan_asked.first(&lot, t) {
                continue;
            }
            return vec![ask::one(&reg.lots, &lot)];
        }
        vec![]
    }
    /// A home we own: a lot whose title is ours, with a dwelling we live in on it; what we repay on a loan naming it is
    /// what it costs us a month.
    pub fn find_own_home(&mut self, w: &mut Week) {
        if !self.is_leaseholder() || !matches!(w.pic.channels.get("street"), Some(Seen::Sites { .. })) {
            return;
        }
        for (title, lot) in self.our_titles() {
            let lot_cells: BTreeSet<String> = self.book.get(&lot).map(|l| data(l).ids("cells").into_iter().map(String::from).collect()).unwrap_or_default();
            let Some(st) = cells(w.pic, "street").iter().find(|c| lot_cells.contains(&c.cell) && c.structure.is_some()).and_then(|c| c.structure.clone()) else { continue };
            let Some(space) = st.spaces.iter().find(|sp| sp.kind == "dwelling" && occupants(sp).contains(&self.me)).map(|sp| sp.space.clone()) else { continue };
            let repay = self.mortgage_for(&space).map_or(0, |l| self.repayment(&l));
            self.s.home = Some(Home { agreement: title, space, structure: st.structure.clone(), landlord: self.me.clone(), rent: repay, moved_in: true, owned: true, ..Default::default() });
            self.s.living_at = None;
            // (A home of our own ends being without one. The lot it stands on is asked of the register, which takes its time to
            // answer, so at the first plan we may have marked ourselves homeless in the home we own.)
            self.s.homeless_since = None;
            return;
        }
    }
    /// A loan of ours in force whose words name this home.
    fn mortgage_for(&self, space: &str) -> Option<Arc<Record>> {
        self.book
            .of_type("agreement")
            .find(|r| {
                template_of(r) == Some("loan")
                    && parties_of(r).contains(&self.me)
                    && self.book.in_force(&r.id)
                    && matches!(&r.body, RecordBody::Agreement { terms } if terms.text.as_deref().unwrap_or("").contains(space))
            })
            .cloned()
    }
    fn repayment(&self, loan: &Record) -> i64 {
        commitment_of(loan, &self.me).0.and_then(|o| o.money).map_or(0, |m| m.amount)
    }

    // ------------------------------------------------------------------ the wake's looks (citizen.ts 4859-4899)

    pub fn staying_with(&self) -> Option<&str> {
        self.housing.stay.as_ref().map(|s| s.host.as_str())
    }
    pub fn home_budget(&self, balance: i64, t: i64) -> i64 {
        let hi = self.household_income(t);
        let usual = if hi > 0 { hi * self.p.rent_share_bps / 10_000 } else { balance / self.p.savings_rent_months.max(1) };
        // (A hunt for somewhere cheaper lapses once housed or its month is out: `hunt_home` forgets it.)
        match (self.s.cheaper_than, self.s.move_hunt) {
            (Some((rent, until)), _) if self.s.home.is_none() && t < until => usual.min(rent),
            (_, Some((_, Some(beat)))) => usual.min(beat),
            _ => usual,
        }
    }
    pub fn need_home(&self, t: i64) -> bool {
        self.is_leaseholder()
            && match &self.s.home {
                None => true,
                Some(h) => self.s.move_hunt.is_some_and(|(until, _)| t < until) && !h.owned,
            }
    }
    fn roomy(&self, t: i64) -> Vec<Condition> {
        let rooms = self.min_bedrooms(t);
        if rooms > 0 {
            vec![cond("data.bedrooms", CmpOp::Ge, rooms)]
        } else {
            vec![]
        }
    }
    pub fn home_lead_look(&self, lead: &str, budget: i64, t: i64) -> LookRequest {
        let mut w = vec![cond("data.structure", CmpOp::Eq, lead), cond("data.rent", CmpOp::Le, budget)];
        w.extend(self.roomy(t));
        ask::board("homes", self.p.search_limit, w, None)
    }
    pub fn home_market_look(&self, budget: i64, t: i64) -> LookRequest {
        let mut w = vec![cond("data.rent", CmpOp::Le, budget)];
        w.extend(self.roomy(t));
        ask::board("homes", self.p.search_limit, w, Some(("data.rent", true)))
    }
    /// The listings of property for sale, when we're looking: waiting on a purchase (the seller's own listings), or
    /// with this month's chance of buying a home coming up. (A venture's look at premises is work's.)
    pub fn sale_looks(&mut self, t: i64) -> Vec<LookRequest> {
        if self.p.sale_board.is_empty() {
            return vec![];
        }
        let mut looks = vec![];
        if let Some(b) = &self.housing.buying {
            looks.push(ask::about(&self.p.sale_board, "speaks_for", b.seller.clone(), crate::common::asking::ask::About { most: self.p.search_limit, standing: true, ..Default::default() }));
        } else if self.p.market.is_some() && self.s.home.as_ref().is_some_and(|h| !h.owned) && self.housing.selling.is_none() && t >= self.housing.next_buy_chance {
            looks.push(ask::board(&self.p.sale_board, self.p.search_limit, vec![], Some(("data.price", false))));
        } else {
            self.housing.on_sale = None;
        }
        self.housing.sale_asked = !looks.is_empty();
        looks
    }
    /// The answer to a look at the listings we just made (absorb may call it at every wake; the market reads it).
    pub fn take_sale_answer(&mut self, pic: &oikos_sight::Picture) {
        if self.p.sale_board.is_empty() {
            return;
        }
        if self.housing.sale_asked {
            if let Some(Seen::Records { records, search: true }) = pic.channels.get(&self.p.sale_board) {
                self.housing.on_sale = Some(records.iter().map(|r| r.id.clone()).collect());
                self.housing.sale_seen_at = pic.t;
            }
        }
        self.housing.sale_asked = false;
    }
    /// Money in that is the home's, not income (absorb asks of each payment to us, citizen.ts 1347-1362): a buyer's
    /// price for a home we're selling, or a mortgage's principal for one we're buying. True: counted here.
    pub fn home_money_in(&mut self, from: &str, amount: i64, settles: Option<&str>) -> bool {
        self.listing_seen();
        let me = self.me.clone();
        if let Some(s) = self.housing.selling.as_mut().filter(|s| !s.listings.is_empty()) {
            let sale = self.book.open("property_purchase").find(|r| crate::common::bases_of(r).iter().any(|b| s.listings.contains(b)) && data(r).s("account") == Some(from)).cloned();
            if let Some(sale) = sale {
                if s.buyer.is_none() {
                    s.buyer = sale.speaks_for.clone();
                }
                if s.buyer_account.is_none() {
                    s.buyer_account = Some(from.into());
                }
                if s.buyer_account.as_deref() == Some(from) {
                    s.received += amount;
                }
                return true;
            }
        }
        let _ = me;
        if let (Some(b), Some(st)) = (self.housing.buying.as_mut(), settles) {
            let names = self.book.get(st).is_some_and(|r| matches!(&r.body, RecordBody::Agreement { terms } if terms.text.as_deref().unwrap_or("").contains(&format!("their home, {}", b.space))));
            if names {
                b.funded = true;
                return true;
            }
        }
        false
    }
    /// The listing of a home we're selling, once it is on file.
    fn listing_seen(&mut self) {
        let me = self.me.clone();
        let Some(s) = self.housing.selling.as_mut() else { return };
        if s.listing.as_deref() == Some("pending") {
            s.listing = Some(
                self.book.open("property_for_sale").find(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("lot") == Some(s.lot.as_str())).map_or("pending".into(), |r| r.id.clone()),
            );
        }
        if let Some(l) = s.listing.clone().filter(|l| l != "pending") {
            if !s.listings.contains(&l) {
                s.listings.push(l);
            }
        }
    }
}

// ------------------------------------------------------------------ a tenancy's end (citizen.ts 1862-1906)

impl Person {
    /// An old rent's last payment made: its order stopped (the new rent's has taken over). The first housing part of
    /// a full plan: it marks how far the book runs for this plan's fresh papers.
    pub fn retire_old_rents(&mut self, w: &mut Week) {
        self.housing.fresh_to = self.book.len();
        self.find_rent_order();
        let t = w.t;
        let Some(h) = self.s.home.as_mut() else { return };
        let done: Vec<String> = h.retiring.iter().filter(|x| t >= x.1).map(|x| x.0.clone()).collect();
        h.retiring.retain(|x| t < x.1);
        for o in done {
            w.push(because("The old rent's last payment is made: stopping its order; the new one takes over.", vec![withdraw(&o, Some("Replaced by a new standing order."))]));
            self.retire_order(&o);
        }
    }

    /// Leaving a home we were told to leave, or put out of, on our record: once (citizen.ts `recordLeaving`).
    fn record_leaving(&mut self, w: &mut Week) -> Option<Step<()>> {
        let h = self.s.home.clone()?;
        let put = h.vacate.clone()?;
        if put.recorded {
            return None;
        }
        if let Some(v) = self.s.home.as_mut().and_then(|h| h.vacate.as_mut()) {
            v.recorded = true;
        }
        let how = if put.removed { "removed" } else if put.ordered { "left_on_order" } else { "left_on_notice" };
        self.told(w, "home", &h.space, "evicted", Some(&h.landlord), json!({ "how": how }));
        self.happened(w, Event::LeftHome { by: h.landlord.clone(), how: how.into() });
        let ends = self.ends(&h.agreement);
        if (ends == i64::MAX || w.t < ends) && !self.book.notices(&h.agreement).any(|n| n.party == self.me) {
            let why = if put.removed {
                "We have been put out of our home on the tribunal's warrant."
            } else if put.ordered {
                "The tribunal has ordered us out of our home, and its date has come: leaving."
            } else {
                "We cannot pay what is owed and have been given notice to vacate: leaving."
            };
            return Some(because(why, vec![notice(&h.agreement, "Leaving: told to vacate for arrears.")]));
        }
        None
    }

    /// A tenancy that has ended: move out and stop paying rent (told to leave for arrears: at the date we were given,
    /// if we mean to go; one who means to stay is there until the tribunal's date, or until put out).
    pub fn tenancy_end(&mut self, w: &mut Week) {
        let t = w.t;
        let Some(home) = self.s.home.clone() else { return };
        let ends = self.ends(&home.agreement);
        let due = match &home.vacate {
            Some(put) => !put.stays && (t >= put.by || t >= ends),
            None => t >= ends,
        };
        if !due {
            return;
        }
        if home.vacate.is_some() {
            if let Some(s) = self.record_leaving(w) {
                w.push(s);
            }
        }
        if self.mind.pursuing("cheaper home") {
            let bps = w.cx.ctx.params.get("goals").and_then(|g| g.get("cheaper_bps")).and_then(Value::as_i64).unwrap_or(9_000);
            self.s.cheaper_than = Some((home.rent * bps / 10_000, t + MONTH));
        }
        if !home.owned {
            let mut f = json!({ "by": self.ended_by(&home.agreement), "rent": home.rent });
            if let Some(s) = self.book.signed_at(&home.agreement) {
                f["held_days"] = json!((t - s).div_euclid(DAY));
            }
            self.told(w, "home", &home.space, "ended", None, f);
        }
        let cheaper = self.s.cheaper_than.map(|(r, _)| format!("; we'll look for somewhere cheaper, under {} a month", Self::usd(w, r))).unwrap_or_default();
        let mut calls = vec![];
        if home.moved_in {
            calls.push(move_out(&home.structure, &self.me));
        }
        if let Some(o) = &home.order {
            calls.push(withdraw(o, Some("Tenancy ended; stop this standing order.")));
            self.retire_order(o);
        }
        for (o, _) in &home.retiring {
            calls.push(withdraw(o, Some("Tenancy ended; stop this standing order.")));
            self.retire_order(o);
        }
        w.push(because(format!("Our tenancy of {} has ended: moving out and stopping the rent{cheaper}.", home.space), calls));
        if home.moved_in {
            for k in self.children(t) {
                w.push(because(
                    "Our tenancy has ended: taking the children out with us.",
                    vec![move_out(&home.structure, &k.person), message(&[k.reach().to_string()], &SAYING::move_out(&home.structure), None)],
                ));
            }
        }
        let acc = w.acc.as_ref().map(|a| a.account.clone()).unwrap_or_default();
        for a in self.adults(t) {
            w.push(because(
                "Our tenancy has ended: telling the household, and that there's no rent to share for now.",
                vec![message(&[a.reach().to_string()], &SAYING::move_out(&home.structure), None), message(&[a.reach().to_string()], &SAYING::share(0, &acc, &w.cx.ctx.world), None)],
            ));
            self.s.shares_told.insert(a.person.clone(), 0);
        }
        self.s.told_move_in = None;
        self.s.gave_up.insert(home.space.clone());
        if home.vacate.is_some() && !home.owned {
            self.housing.left_home = Some(LeftHome { agreement: home.agreement.clone(), landlord: home.landlord.clone(), space: home.space.clone(), at: t });
        }
        self.s.home = None;
        self.s.homeless_since = Some(t);
    }
}

// ------------------------------------------------------------------ offers signed (citizen.ts 2531-2618)

impl Person {
    /// A lease offered to us that succeeds to the tenancy of the home we live in (the leaseholder died, and the landlord
    /// offers it to us: firms.ts landlord 0.20.0, "succeeding <who> (lease <id>)"): a lease of the space we live in now,
    /// made on another lease. Absorb may mark such offers; otherwise they are known by this.
    fn succession_offer(&self, r: &Record) -> bool {
        let Some(at) = self.s.living_at.as_deref() else { return false };
        self.s.home.is_none() && !crate::common::bases_of(r).is_empty() && lease_terms(r, &self.me).space.as_deref() == Some(at)
    }
    /// When a succeeding lease's rent begins: when the lease it succeeds ends, as we read it (its reading, else the
    /// day its own words give), else now.
    fn succession_starts(&self, r: &Record, t: i64) -> i64 {
        if let Some(e) = crate::common::bases_of(r).iter().find_map(|b| self.book.ends_at(b)) {
            return e.max(t);
        }
        let words = match &r.body {
            RecordBody::Agreement { terms } => terms.text.clone().unwrap_or_default(),
            _ => String::new(),
        };
        words
            .split("from day ")
            .nth(1)
            .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
            .and_then(|d| d.parse::<i64>().ok())
            .map_or(t, |d| (d * DAY).max(t))
    }
    /// The first day a new rent falls due on the old order's days, from `from` on, and when the old order is to stop.
    fn on_old_days(&self, from: i64, t: i64) -> (i64, i64) {
        let mut starts = from;
        let mut stop_at = t;
        if let Some(old) = self.s.home.as_ref().and_then(|h| h.order.as_ref()).and_then(|o| self.book.get(o)) {
            if let Some(every) = data(old).get("every").and_then(Value::as_i64).filter(|e| *e > 0) {
                let due0 = first_due(old, every);
                starts = if due0 >= starts { due0 } else { due0 + (starts - due0 + every - 1).div_euclid(every) * every };
                stop_at = starts - every + DAY;
            }
        }
        (starts, stop_at)
    }
    /// How much more another job must pay before it is worth leaving ours (basis points), for one who takes
    /// initiative where the world says what holds people (citizen.ts `heldIn`; `job_move` is the world's).
    fn held_in(&self, w: &Week, t: i64, industry: Option<&str>) -> i64 {
        let (Some(job), Some(m)) = (&self.s.job, w.cx.ctx.params.get("job_move").filter(|m| m.is_object())) else { return 0 };
        if !self.mind.initiative() {
            return 0;
        }
        let g = |k: &str| m.get(k).and_then(Value::as_i64).unwrap_or(0);
        let lead = if job.since < 7 * DAY { self.p.started.as_ref().and_then(|s| s.trade_days).unwrap_or(0) * DAY } else { 0 };
        // (Years in the job, capped: the per-year premium in integers, rounded half away from zero.)
        let held = (t - job.since + lead).min(g("cap_years") * self.p.year).max(0);
        let other = industry.is_some_and(|i| self.s.industry_of.get(&job.employer).map(String::as_str) != Some(i));
        g("premium_bps") + round_div(g("per_year_bps") * held, self.p.year.max(1)) + if other { g("other_trade_bps") } else { 0 }
    }

    /// Offers made to us: sign what we asked for and can afford (homes and jobs).
    pub fn offers(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let Some(acc) = w.acc.clone() else { return };
        for r in self.fresh() {
            if !matches!(r.body, RecordBody::Agreement { .. }) || !parties_of(&r).contains(&me) || self.book.signed_by(&r.id, &me) || self.book.taken_back(&r.id) {
                continue;
            }
            let other = other_party(&r, &me).unwrap_or_default().to_string();
            let tpl = template_of(&r).unwrap_or_default();
            let home = self.s.home.clone();
            if tpl == "lease" && home.is_none() && self.succession_offer(&r) {
                // Succeeding to the tenancy of the home we live in (bughunt 2026-10-17 #3): we stay, sign, and pay its
                // rent from when it begins; nobody moves, and we are housed throughout.
                let lt = lease_terms(&r, &me);
                let (Some(space), Some(structure), Some(rent_to)) = (lt.space.clone(), lt.structure.clone(), lt.rent_to.clone()) else { continue };
                if !self.bearable(lt.rent, acc.balance, t) {
                    continue;
                }
                let starts = self.succession_starts(&r, t);
                let mut lines = vec![
                    oikos_sight::calls::Line { bind: None, call: sign(&r.id) },
                    bound("so", pay(&rent_to, lt.rent, Pay { from: Some(acc.account.clone()), every: Some(MONTH), first: Some((starts - t).max(0)), basis: Some(r.id.clone()), for_: Some(format!("Rent for {space}, monthly in advance.")), ..Default::default() }, w.cx)),
                ];
                if let Some((_, Some(o))) = self.s.share.clone() {
                    lines.push(oikos_sight::calls::Line { bind: None, call: withdraw(&o, Some("We hold the tenancy now: the rent is ours to pay.")) });
                }
                w.push(step_of_lines(format!("{other} offers us the tenancy of {space}, where we live, at {} a month: staying, and signing it.", Self::usd(w, lt.rent)), lines));
                self.s.share = None;
                self.s.home = Some(Home { agreement: r.id.clone(), space: space.clone(), structure, landlord: other.clone(), rent: lt.rent, order: None, moved_in: true, ..Default::default() });
                self.s.living_at = None;
                self.s.gave_up.remove(&space);
                let mut f = json!({ "rent": lt.rent, "succeeded": true });
                if let Some(h) = self.s.homeless_since {
                    f["days_without"] = json!((t - h).div_euclid(DAY));
                }
                self.told(w, "home", &space, "lease_signed", Some(&other), f);
                self.s.homeless_since = None;
            } else if tpl == "lease" && home.as_ref().is_some_and(|h| cites(&r, &h.agreement) && parties_of(&r).contains(&h.landlord)) && self.is_leaseholder() {
                // A new lease for the home we have, as the old one runs out: signed if we can bear its rent (moving costs
                // too), paid on the old one's days from the first after the old ends; the old order stops after its
                // last payment.
                let h = home.unwrap_or_default();
                let lt = lease_terms(&r, &me);
                let Some(rent_to) = lt.rent_to.clone() else { continue };
                if lt.space.as_deref() != Some(h.space.as_str()) || !self.bearable(lt.rent, acc.balance, t) {
                    continue;
                }
                let (starts, stop_at) = self.on_old_days(t.max(self.ends(&h.agreement)), t);
                w.push(step_of_lines(
                    format!("Our landlord offers a new lease on {} as ours runs out, at {} a month: staying, and signing it.", h.space, Self::usd(w, lt.rent)),
                    vec![
                        oikos_sight::calls::Line { bind: None, call: sign(&r.id) },
                        bound("so", pay(&rent_to, lt.rent, Pay { from: Some(acc.account.clone()), every: Some(MONTH), first: Some((starts - t).max(0)), basis: Some(r.id.clone()), for_: Some(format!("Rent for {}, monthly in advance.", h.space)), ..Default::default() }, w.cx)),
                    ],
                ));
                let mut retiring = h.retiring.clone();
                if let Some(o) = &h.order {
                    if stop_at <= t {
                        w.push(because("The old lease's rent is replaced by the new one's.", vec![withdraw(o, Some("Replaced by a new standing order."))]));
                        self.retire_order(o);
                    } else {
                        retiring.push((o.clone(), stop_at));
                    }
                }
                self.told(w, "home", &h.space, "renewed", None, json!({ "rent": lt.rent, "was": h.rent }));
                self.s.home = Some(Home { agreement: r.id.clone(), rent: lt.rent, order: None, retiring, ..h });
            } else if tpl == "lease" && home.is_none() {
                let lt = lease_terms(&r, &me);
                let (Some(space), Some(structure), Some(rent_to)) = (lt.space.clone(), lt.structure.clone(), lt.rent_to.clone()) else { continue };
                if !self.affordable(lt.rent, acc.balance, t) {
                    continue;
                }
                // (Signing, a record, and moving in, physics, are separate acts: the flat may not be free yet.)
                let third = Self::usd(w, self.household_income(t) * self.p.rent_share_bps / 10_000);
                let thanks = self.thank(w, Some(&structure));
                w.push(step_of_lines(
                    format!("Signing the lease offered for {space}: {} a month is within our budget (a third of household income, {third}; or six months' rent in savings without income){thanks}.", Self::usd(w, lt.rent)),
                    vec![
                        oikos_sight::calls::Line { bind: None, call: sign(&r.id) },
                        bound("so", pay(&rent_to, lt.rent, Pay { from: Some(acc.account.clone()), every: Some(MONTH), first: Some(0), basis: Some(r.id.clone()), for_: Some(format!("Rent for {space}, monthly in advance.")), ..Default::default() }, w.cx)),
                    ],
                ));
                self.s.home = Some(Home { agreement: r.id.clone(), space: space.clone(), structure, landlord: other.clone(), rent: lt.rent, moved_in: false, ..Default::default() });
                self.s.gave_up.remove(&space);
                let mut f = json!({ "rent": lt.rent });
                if let Some(h) = self.s.homeless_since {
                    f["days_without"] = json!((t - h).div_euclid(DAY));
                }
                self.told(w, "home", &space, "lease_signed", None, f);
                self.s.homeless_since = None;
            } else if tpl == "lease" && home.as_ref().is_some_and(|h| !h.owned && !cites(&r, &h.agreement)) && self.s.move_hunt.is_some() && self.is_leaseholder() {
                // Another home, offered while we still have ours (we went looking): we sign, leave the old one now, and
                // pay its rent until its tenancy ends (giving notice if none runs).
                let old = home.unwrap_or_default();
                let lt = lease_terms(&r, &me);
                let (Some(space), Some(structure), Some(rent_to)) = (lt.space.clone(), lt.structure.clone(), lt.rent_to.clone()) else { continue };
                if !self.affordable(lt.rent, acc.balance, t) {
                    continue;
                }
                let thanks = self.thank(w, Some(&structure));
                w.push(step_of_lines(
                    format!("Signing the lease offered for {space} ({} a month), and leaving {}{thanks}.", Self::usd(w, lt.rent), old.space),
                    vec![
                        oikos_sight::calls::Line { bind: None, call: sign(&r.id) },
                        bound("so", pay(&rent_to, lt.rent, Pay { from: Some(acc.account.clone()), every: Some(MONTH), first: Some(0), basis: Some(r.id.clone()), for_: Some(format!("Rent for {space}, monthly in advance.")), ..Default::default() }, w.cx)),
                    ],
                ));
                let open_ended = self.ends(&old.agreement) == i64::MAX;
                let mut out = vec![];
                if old.moved_in {
                    out.push(move_out(&old.structure, &me));
                }
                if open_ended {
                    out.push(notice(&old.agreement, "Moving to another home."));
                }
                w.push(because(format!("Leaving {} for the home we have taken{}.", old.space, if open_ended { ", with the notice our lease asks" } else { "" }), out));
                if old.moved_in {
                    for k in self.children(t) {
                        w.push(because("Taking the children out of our old home.", vec![move_out(&old.structure, &k.person)]));
                    }
                }
                let orders: Vec<String> = old.order.iter().cloned().chain(old.retiring.iter().map(|x| x.0.clone())).collect();
                self.housing.left_homes.push((old.agreement.clone(), orders));
                self.told(w, "home", &old.space, "ended", None, json!({ "by": "self", "rent": old.rent, "moved": true }));
                self.s.home = Some(Home { agreement: r.id.clone(), space: space.clone(), structure, landlord: other.clone(), rent: lt.rent, moved_in: false, ..Default::default() });
                self.s.gave_up.remove(&space);
                self.s.told_move_in = None;
                self.s.move_hunt = None;
                self.told(w, "home", &space, "lease_signed", None, json!({ "rent": lt.rent, "was": old.rent, "moved": true }));
            } else if tpl == "employment" && self.s.job.is_none() {
                let terms = job_terms(&r, &me, Some(&self.book));
                let thanks = self.thank(w, terms.workplace.as_deref().map(structure_of));
                let mut calls = vec![sign(&r.id)];
                if let (Some(wp), None) = (&terms.workplace, &self.p.round) {
                    calls.push(move_in(wp)); // (with the round, we go when work starts)
                }
                w.push(because(format!("Taking the job offered: {} every {} days{thanks}.", Self::usd(w, terms.wage), round_div(terms.period, DAY)), calls));
                self.s.job = Some(super::person::Job { agreement: r.id.clone(), employer: other.clone(), wage: terms.wage, period: terms.period, workplace: terms.workplace.clone(), since: t, ..Default::default() });
                self.s.employers.insert(other.clone());
                let mut f = json!({ "wage": terms.wage, "period_days": round_div(terms.period, DAY) });
                if let Some(j) = self.s.jobless_since {
                    f["days_without"] = json!((t - j).div_euclid(DAY));
                }
                self.told(w, "job", &other, "hired", None, f);
                self.s.jobless_since = None;
            } else if tpl == "employment" && self.housing.switching.is_none() && !self.s.retired && self.s.job.as_ref().is_some_and(|j| j.employer != other) {
                // Offered a better-paid job while in one (we applied for it): we take it, give notice at ours, and start
                // the new one when the notice is worked out.
                let job = self.s.job.clone().unwrap_or_default();
                let terms = job_terms(&r, &me, Some(&self.book));
                if terms.wage * job.period <= job.wage * terms.period {
                    continue;
                }
                let industry = crate::papers::agreements::advertised_job(&self.book, &r).and_then(|p| data(p).s("industry").map(String::from));
                let hold = self.held_in(w, t, industry.as_deref());
                if hold > 0 && terms.wage * job.period * 10_000 <= job.wage * terms.period * (10_000 + hold) {
                    continue;
                }
                self.housing.switching = Some((r.id.clone(), terms.wage));
                w.push(because(
                    format!(
                        "Offered a better-paid job ({} every {} days, against our {} every {}): taking it, and giving our employer the notice our contract asks.",
                        Self::usd(w, terms.wage),
                        round_div(terms.period, DAY),
                        Self::usd(w, job.wage),
                        round_div(job.period, DAY)
                    ),
                    vec![notice(&job.agreement, "Resigning: moving to another job.")],
                ));
            }
        }
    }
}

// ------------------------------------------------------------------ a rent rise (citizen.ts 2808-2811, 3211-3285)

impl Person {
    /// A rent increase on our home (the landlord's notice, as the tenancy law allows): if we can still afford it, we pay
    /// the new rent from when it starts; if not, we give notice and look elsewhere. A notice we challenged, upheld, or
    /// asked the landlord about with no answer in time, applies as it stands.
    pub fn rent_rise(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        // (A paper we asked the other party about, with no answer in the time the mind gives one: as it stands.)
        let answer_days = w.cx.ctx.params.get("wants").and_then(|x| x.get("answer_days")).and_then(Value::as_i64).unwrap_or(14);
        for (paper, (at, _)) in self.s.asked_of.clone() {
            if self.book.withdrawn(&paper) || t - at >= answer_days * DAY {
                self.s.asked_of.remove(&paper);
                if !self.book.withdrawn(&paper) {
                    self.housing.upheld.push(paper);
                }
            }
        }
        let upheld_now: Vec<Arc<Record>> = std::mem::take(&mut self.housing.upheld).iter().filter_map(|id| self.book.get(id).cloned()).collect();
        if self.s.home.is_none() || !self.is_leaseholder() {
            return;
        }
        let Some(acc) = w.acc.clone() else { return };
        let mut papers = self.fresh();
        papers.extend(upheld_now.iter().cloned());
        for r in papers {
            let Some(home) = self.s.home.clone() else { return };
            if !to_us(&r, "rent_increase", &me) || data(&r).s("lease") != Some(home.agreement.as_str()) {
                continue;
            }
            let rent = data(&r).i("rent").unwrap_or(0);
            if self.book.withdrawn(&r.id) {
                continue; // (taken back: the rent stays as it was)
            }
            let hi = self.household_income(t);
            let rise_share = if hi > 0 { (rent - home.rent) * 10_000 / hi } else { 10_000 };
            let was_upheld = upheld_now.iter().any(|u| u.id == r.id);
            // A rise is something to do something about, for one who takes initiative: the mind's want, pursued at once;
            // asked of the landlord or taken to the tribunal, the notice waits on the answer.
            if self.mind.initiative() && rent > home.rent && !was_upheld {
                let heard = self.happened(w, Event::RentRise { landlord: home.landlord.clone(), notice: r.id.clone(), rent, was: home.rent, share_bps: rise_share });
                if let Heard::Took(chosen) = heard {
                    let mut waits = false;
                    for c in chosen {
                        match &c.opening.intent {
                            Intent::AskLandlord { .. } => {
                                self.s.asked_of.insert(r.id.clone(), (t, home.landlord.clone()));
                                waits = true;
                            }
                            Intent::ChallengeRent { .. } => waits = true,
                            _ if c.opening.kind == "desk" => waits = true,
                            _ => {}
                        }
                        self.carry_out(w, &c.opening.intent, Some(&c.why));
                    }
                    if waits {
                        continue;
                    }
                }
            }
            // A notice that breaks the tenancy law (as we read it): some of us take it to the tribunal, and pay the rent
            // as it was meanwhile.
            if let (Some(trib), Some(by)) = (self.p.tribunal.clone(), r.speaks_for.clone()) {
                // (One taken to the tribunal as a way chosen for a want is challenged too: recourse keeps those.)
                if !self.housing.challenged.contains(&r.id) && !self.recourse.challenged.contains(&r.id) {
                    let act = json!({ "block": "publish", "kind": "rent_increase", "data": data(&r).clone() });
                    if !crate::common::breaches(&mut self.book, &act, &by, r.at).is_empty() {
                        self.housing.challenged.insert(r.id.clone());
                        self.recourse.challenged.insert(r.id.clone());
                        let draw = w.cx.rng(&format!("challenge-{}", r.id)).below(10_000) as i64;
                        let life = self.life(w.pic, t, Some(acc.balance));
                        let c = self.mind.choose_conduct(w.cx, &life, ConductAsk { conduct: "take_to_tribunal".into(), base_bps: trib.challenge_bps, draw_bps: draw, who: Some(trib.entity.clone()), lean: true, act: true, ..Default::default() });
                        if c.does {
                            let mut f = json!({ "rent": rent, "was": home.rent, "from": data(&r).i("from"), "challenged": true });
                            for (k, v) in c.facts {
                                f[k] = json!(v);
                            }
                            self.told(w, "home", &home.space, "rent_increase", None, f);
                            w.push(because(
                                "A notice of rent increase that breaks the law: taking it to the tribunal, and paying the rent as it was meanwhile.",
                                vec![say(
                                    "tribunal_application",
                                    &format!("Application: the notice of rent increase {} from {by} breaks the law; we ask that it be found invalid.", r.id),
                                    Say {
                                        to: Some(vec![trib.entity.clone()]),
                                        visible: Some(Visible::Only(vec![me.clone(), trib.entity.clone(), by.clone()])),
                                        basis: Some(r.id.clone()),
                                        data: Some(json!({ "kind": "rent_increase", "against": by, "notice": r.id, "evidence": serde_json::to_value(&*r).unwrap_or(Value::Null) })),
                                        ..Default::default()
                                    },
                                )],
                            ));
                            continue;
                        }
                    }
                }
            }
            let rent_to = self.book.get(&home.agreement).and_then(|l| lease_terms(l, &me).rent_to);
            let bearable = self.bearable(rent, acc.balance, t);
            self.told(w, "home", &home.space, "rent_increase", None, json!({ "rent": rent, "was": home.rent, "from": data(&r).i("from"), "bearable": bearable && rent_to.is_some() }));
            let up_to = Self::usd(w, hi * self.p.rent_bearable_share_bps / 10_000);
            match rent_to.filter(|_| bearable) {
                Some(rent_to) => {
                    let why = if self.affordable(rent, acc.balance, t) {
                        format!("Our rent goes up to {} a month (from {}): still within our budget, so we'll pay it from when it starts.", Self::usd(w, rent), Self::usd(w, home.rent))
                    } else {
                        format!(
                            "Our rent goes up to {} a month (from {}): more than a third of household income, but we can bear it (up to {up_to}), and moving costs too: we'll pay it from when it starts.",
                            Self::usd(w, rent),
                            Self::usd(w, home.rent)
                        )
                    };
                    // The new rent is paid on the old one's days, from the first after it starts; the old order runs
                    // until then and is stopped once its last payment is made.
                    let (starts, stop_at) = self.on_old_days(t.max(data(&r).i("from").unwrap_or(t)), t);
                    let mut lines = vec![];
                    let mut retiring = home.retiring.clone();
                    if let Some(o) = &home.order {
                        if stop_at <= t {
                            lines.push(oikos_sight::calls::Line { bind: None, call: withdraw(o, Some("Rent increased; replaced by a new standing order.")) });
                            self.retire_order(o);
                        } else {
                            retiring.push((o.clone(), stop_at));
                            self.retire_order(o);
                        }
                    }
                    lines.push(bound(
                        "so",
                        pay(&rent_to, rent, Pay { from: Some(acc.account.clone()), every: Some(MONTH), first: Some(starts - t), basis: Some(home.agreement.clone()), for_: Some(format!("Rent for {}, monthly in advance.", home.space)), ..Default::default() }, w.cx),
                    ));
                    w.push(step_of_lines(why, lines));
                    self.s.home = Some(Home { rent, order: None, retiring, ..home });
                }
                None => {
                    w.push(because(
                        format!("Our rent goes up to {} a month, beyond what we can bear ({up_to} of household income): giving notice, to find somewhere else.", Self::usd(w, rent)),
                        vec![notice(&home.agreement, "We can't afford the new rent.")],
                    ));
                }
            }
        }
    }

    /// A home we left for another before its tenancy ended: its rent's orders are stopped once it has.
    pub fn left_homes(&mut self, w: &mut Week) {
        for (lease, orders) in std::mem::take(&mut self.housing.left_homes) {
            if w.t < self.ends(&lease) {
                self.housing.left_homes.push((lease, orders));
            } else if !orders.is_empty() {
                w.push(because("The tenancy of the home we left has ended: stopping its rent.", orders.iter().map(|o| withdraw(o, Some("Tenancy ended; stop this standing order."))).collect()));
                for o in &orders {
                    self.retire_order(o);
                }
            }
        }
    }
}

// ------------------------------------------------------------------ possession, and being taken in (citizen.ts 2911-3183)

impl Person {
    /// A tie as the mind holds it (affinity, trust in basis points; none: not close).
    fn tie(&self, who: &str, t: i64) -> (i64, i64) {
        let trust = self.mind.closest(self.p.max_contacts + 3, t).into_iter().find(|x| x.who == who).and_then(|x| x.trust_bps).unwrap_or(0);
        (self.mind.affinity(who, t), trust)
    }
    fn people_bps(w: &Week) -> i64 {
        w.cx.ctx.params.get("outlook").and_then(|o| o.get("people_bps")).and_then(Value::as_i64).unwrap_or(5_000)
    }
    /// A draw that is ours and about one thing (TS `fixed`), in basis points.
    fn fixed_bps(&self, w: &mut Week, purpose: &str) -> i64 {
        w.cx.chance(&format!("{}/{purpose}", self.me)).below(10_000) as i64
    }
    fn conduct(&mut self, w: &mut Week, c: ConductAsk) -> super::mind::Conduct {
        let life = self.life(w.pic, w.t, w.acc.as_ref().map(|a| a.balance));
        self.mind.choose_conduct(w.cx, &life, c)
    }
    fn days_words(&self, w: &Week, t: i64) -> String {
        when_words(t, &w.cx.ctx.world)
    }

    /// Told to leave our home for arrears (docs/behaviour/justice.md, "Possession"), and asked to take someone in or
    /// taken in ourselves (households.md, "Taken in during the year"): the papers of the week, in the order seen.
    pub fn possession(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        for r in self.fresh() {
            let d = data(&r).clone();
            // (The landlord has applied for possession of a home we have already left on its notice: we tell the
            // tribunal so.)
            if let Some(left) = self.housing.left_home.clone() {
                if is_kind(&r, "hearing_notice")
                    && d.s("kind") == Some("possession")
                    && d.s("against") == Some(me.as_str())
                    && d.s("about") == Some(left.agreement.as_str())
                    && self.s.home.as_ref().is_none_or(|h| h.agreement != left.agreement)
                {
                    let app = d.get("application").map(|v| v.as_str().map_or(v.to_string(), String::from)).unwrap_or_default();
                    let when = self.days_words(w, left.at);
                    let tribunal = r.speaks_for.clone().unwrap_or_default();
                    w.push(because(
                        format!("{} has applied for possession of {}, which we left on {when}: telling the tribunal we have gone.", left.landlord, left.space),
                        vec![say(
                            "tribunal_response",
                            &format!("Answer to application {app}: we left {} on {when}, on the landlord's notice to vacate, and gave notice on the lease. We are not there.", left.space),
                            Say {
                                to: Some(vec![tribunal.clone()]),
                                visible: Some(Visible::Only(vec![me.clone(), tribunal, left.landlord.clone()])),
                                basis: Some(app.clone()),
                                data: Some(json!({ "application": d.get("application"), "left": true, "left_at": left.at })),
                                ..Default::default()
                            },
                        )],
                    ));
                    continue;
                }
            }
            if to_us(&r, "stay_request", &me) && r.speaks_for.as_deref().is_some_and(|s| s != me) {
                self.asked_to_take_in(w, &r);
                continue;
            }
            if to_us(&r, "stay_answer", &me) && r.speaks_for.is_some() {
                self.stay_answered(w, &r);
                continue;
            }
            if to_us(&r, "stay_ended", &me) && r.speaks_for.is_some() {
                let by = r.speaks_for.clone().unwrap_or_default();
                if d.s("by") == Some("guest") {
                    self.housing.took_in.remove(&by);
                } else if let Some(stay) = self.housing.stay.clone().filter(|s| s.host == by) {
                    let from = structure_of(&stay.space).to_string();
                    let kids = self.children(t);
                    let mut calls = vec![move_out(&from, &me)];
                    calls.extend(kids.iter().map(|k| move_out(&from, &k.person)));
                    w.push(because(format!("{}'s home has ended, where we were staying: leaving it{}.", stay.host, if kids.is_empty() { "" } else { ", with the children" }), calls));
                    for a in self.adults(t) {
                        w.push(because("Where we were staying has ended: telling the household.", vec![message(&[a.reach().to_string()], &SAYING::move_out(&from), None)]));
                    }
                    self.told(w, "home", &stay.space, "stay_ended", Some(&stay.host), json!({ "days": (t - stay.since).div_euclid(DAY) }));
                    self.s.gave_up.insert(stay.space.clone());
                    self.housing.stay = None;
                    self.s.living_at = None;
                    self.housing.stay_asked_at = None;
                    self.housing.stay_ended_at = Some(t);
                }
                continue;
            }
            let Some(home) = self.s.home.clone().filter(|h| !h.owned) else { continue };
            if !matches!(r.body, RecordBody::Statement { .. }) {
                continue;
            }
            let from_landlord = r.speaks_for.as_deref() == Some(home.landlord.as_str());
            let k = kind(&r).unwrap_or_default();
            if k == "rent_statement" && d.flag("brought_forward") && d.s("lease") == Some(home.agreement.as_str()) && from_landlord && to_us(&r, k, &me) && d.s("account").is_some() {
                // (Rent owed as the year began: owed as any rent the bank could not pay, a rent at a time.)
                let each = d.i("rent").filter(|x| *x > 0).unwrap_or(home.rent).max(1);
                let mut left = d.i("owed").unwrap_or(0);
                while left > 0 {
                    self.s.missed.push(Missed { instruction: r.id.clone(), to: d.s("account").unwrap_or_default().into(), amount: each.min(left), what: "the rent".into() });
                    left -= each;
                }
            } else if k == "notice_to_vacate" && d.s("lease") == Some(home.agreement.as_str()) && to_us(&r, k, &me) {
                self.notice_to_vacate(w, &r, &home);
            } else if k == "plan_offer" && d.s("lease") == Some(home.agreement.as_str()) && from_landlord && to_us(&r, k, &me) {
                // The landlord offers a plan to pay what is owed: yes if what we could pay a month beyond the rent and
                // essentials covers the instalment.
                let can = (self.household_income(t) - home.rent - self.p.essentials).max(0);
                let instalment = d.i("instalment").unwrap_or(0);
                let accepts = instalment > 0 && can >= instalment;
                let (us, uc) = (Self::usd(w, instalment), Self::usd(w, can));
                let why = if accepts { "we can pay that".to_string() } else if can > 0 { format!("we could pay {uc} a month, not that") } else { "we can pay nothing beyond the rent now".into() };
                let words = if accepts {
                    format!("Answer to your offer {}: yes. We can pay {us} a month toward the rent owed, and the rent as it falls due.", r.id)
                } else if can > 0 {
                    format!("Answer to your offer {}: no. We could pay {uc} a month toward the rent owed, beyond the rent.", r.id)
                } else {
                    format!("Answer to your offer {}: no. We can pay nothing beyond the rent now.", r.id)
                };
                w.push(because(
                    format!("{} offers a plan to pay the rent owed, {us} a month: {why}; answering.", home.landlord),
                    vec![say(
                        "plan_answer",
                        &words,
                        Say {
                            to: Some(vec![home.landlord.clone()]),
                            visible: Some(Visible::Only(vec![me.clone(), home.landlord.clone()])),
                            basis: Some(r.id.clone()),
                            data: Some(json!({ "offer": r.id, "lease": home.agreement, "accepts": accepts, "can_pay": can })),
                            ..Default::default()
                        },
                    )],
                ));
                self.told(w, "home", &home.space, "plan_offered", Some(&home.landlord), json!({ "instalment": instalment, "can_pay": can, "accepts": accepts }));
            } else if k == "review_request" && d.s("matter") == Some("arrears") && d.s("about") == Some(home.agreement.as_str()) && from_landlord && to_us(&r, k, &me) {
                // Asked in writing for the rent owed: on our record that the landlord asked, and for how much.
                self.told(w, "home", &home.space, "rent_asked", Some(&home.landlord), json!({ "amount": d.i("amount").unwrap_or(0) }));
            } else if k == "hearing_notice" && d.s("kind") == Some("possession") && d.s("against") == Some(me.as_str()) && d.s("about") == Some(home.agreement.as_str()) {
                self.answer_tribunal(w, &r, &home);
            } else if k == "tribunal_order" && d.s("kind") == Some("possession") && d.s("against") == Some(me.as_str()) && d.s("about") == Some(home.agreement.as_str()) {
                let by = r.speaks_for.clone().unwrap_or_default();
                let app = d.get("application").map(|v| v.as_str().map_or(v.to_string(), String::from)).unwrap_or_default();
                let answered = self.housing.answered_apps.contains(&app);
                let kind_by = self.kind_of(&by, &w.cx.ctx.params.clone());
                if d.s("finding") == Some("possession") {
                    // (How the order's words, where read, move the odds of obeying is the mind's reading: the same draw.)
                    let obeys = self.fixed_bps(w, &format!("obey-{}", home.agreement)) < self.p.possession.as_ref().map_or(10_000, |p| p.obey_bps);
                    self.happened(w, Event::OrderedOut { by: by.clone() });
                    if answered {
                        self.tell(w, Outcome { domain: "way".into(), option: "desk".into(), kind: "possession".into(), from: Some(by.clone()), payoff: Some(500), facts: facts(json!({ "about": "possession", "answered": true })), ..Default::default() });
                    }
                    let vby = d.i("due").filter(|x| *x != 0).unwrap_or(t);
                    if let Some(h) = self.s.home.as_mut() {
                        h.vacate = Some(Vacate { paper: r.id.clone(), by: vby, stays: !obeys, ordered: true, ..Default::default() });
                    }
                    self.told(w, "home", &home.space, "possession_ordered", Some(&home.landlord), json!({ "by": vby, "obeys": obeys }));
                    self.treated(w, Treated { who: by.clone(), kind: kind_by, good: false, weight_bps: Some(20_000), done_to: true, paper: Some(r.id.clone()), ..Default::default() });
                } else {
                    if let Some(h) = self.s.home.as_mut() {
                        h.vacate = None;
                    }
                    self.housing.notice_over.insert(home.agreement.clone());
                    let finding = d.s("finding").unwrap_or_default().to_string();
                    if answered {
                        self.tell(w, Outcome { domain: "way".into(), option: "desk".into(), kind: finding.clone(), from: Some(by.clone()), payoff: Some(10_000), facts: facts(json!({ "about": "possession", "answered": true })), ..Default::default() });
                    }
                    let (kd, f) = if finding == "plan" {
                        ("plan_ordered", json!({ "instalment": d.i("instalment").unwrap_or(0), "owed": d.i("amount").unwrap_or(0) }))
                    } else {
                        ("possession_dismissed", json!({}))
                    };
                    self.told(w, "home", &home.space, kd, Some(&home.landlord), f);
                    self.treated(w, Treated { who: by.clone(), kind: kind_by, good: true, weight_bps: Some(20_000), paper: Some(r.id.clone()), ..Default::default() });
                }
            } else if k == "warrant_executed" && d.s("lease") == Some(home.agreement.as_str()) {
                if let Some(h) = self.s.home.as_mut() {
                    let recorded = h.vacate.as_ref().is_some_and(|v| v.recorded);
                    h.vacate = Some(Vacate { paper: r.id.clone(), by: t, stays: false, ordered: true, removed: true, recorded });
                }
                if let Some(s) = self.record_leaving(w) {
                    w.push(s);
                }
                // (Put out by an officer: on our record with who did it.)
                if let Some(by) = r.speaks_for.clone() {
                    self.happened(w, Event::PutOut { by: by.clone() });
                    let kb = self.kind_of(&by, &w.cx.ctx.params.clone());
                    self.treated(w, Treated { who: by, kind: kb, good: false, weight_bps: Some(20_000), paper: Some(r.id.clone()), ..Default::default() });
                }
            }
        }
        // (A notice to vacate that has lapsed: the arrears were paid.)
        let lapsed = self.s.home.as_ref().and_then(|h| h.vacate.as_ref().filter(|v| !v.ordered && self.book.withdrawn(&v.paper)).map(|_| h.agreement.clone()));
        if let Some(ag) = lapsed {
            if let Some(h) = self.s.home.as_mut() {
                h.vacate = None;
            }
            self.housing.notice_over.insert(ag.clone());
            self.housing.notice_seen.remove(&ag);
        }
    }

    /// A notice to vacate: we go by its date, or stay (the rent we can pay is paid as it can be; paid up, it lapses).
    fn notice_to_vacate(&mut self, w: &mut Week, r: &Record, home: &Home) {
        let t = w.t;
        let d = data(r);
        let by = d.i("by").filter(|x| *x != 0).unwrap_or(t);
        // (A notice whose date had gone before it is first on our file, and we are still here: we stayed. That was
        // decided then; it is not drawn again.)
        let before = d.i("by").is_some_and(|b| b <= r.at) && d.flag("brought_forward");
        let (stays, cfacts) = if before {
            (true, BTreeMap::new())
        } else {
            let draw = self.fixed_bps(w, &format!("stay-{}", home.agreement));
            let c = self.conduct(w, ConductAsk { conduct: "stay_past_notice".into(), base_bps: self.p.possession.as_ref().map_or(0, |p| p.stay_bps), draw_bps: draw, lean: true, act: true, ..Default::default() });
            (c.does, c.facts)
        };
        if let Some(h) = self.s.home.as_mut() {
            h.vacate = Some(Vacate { paper: r.id.clone(), by, stays, ..Default::default() });
        }
        let mut f = json!({ "arrears": d.i("arrears").unwrap_or(0), "by": by, "stays": stays });
        for (k, v) in cfacts {
            f[k] = json!(v);
        }
        self.told(w, "home", &home.space, "notice_to_vacate", Some(&home.landlord), f);
        let kb = self.kind_of(&home.landlord, &w.cx.ctx.params.clone());
        // (Done to us; what being told to leave does to a tenant, once a tenancy, is the mind's: `NoticeSeen`.)
        self.treated(w, Treated { who: home.landlord.clone(), kind: kb, good: false, done_to: true, paper: Some(r.id.clone()), ..Default::default() });
        if self.housing.notice_seen.insert(home.agreement.clone()) {
            self.housing.notice_over.remove(&home.agreement);
            self.happened(w, Event::NoticeSeen { by: home.landlord.clone(), lease: home.agreement.clone() });
        }
    }

    /// Served with an application for possession: whether we answer is ours (the world's share, as the mind leans it);
    /// what we tell is ours to know, never anyone else's.
    fn answer_tribunal(&mut self, w: &mut Week, r: &Record, home: &Home) {
        let t = w.t;
        let me = self.me.clone();
        let d = data(r).clone();
        let tribunal = r.speaks_for.clone().unwrap_or_default();
        let app = d.get("application").map(|v| v.as_str().map_or(v.to_string(), String::from)).unwrap_or_default();
        let nth = {
            let n = self.housing.applied_for.entry(home.agreement.clone()).or_insert(0);
            *n += 1;
            *n
        };
        let balance = w.acc.as_ref().map_or(0, |a| a.balance);
        let offer = (self.household_income(t) - home.rent - self.p.essentials).max(0);
        let claimed = d.i("amount").unwrap_or(0);
        let owes: i64 = self.s.missed.iter().filter(|x| x.what == "the rent").map(|x| x.amount).sum();
        let mine: BTreeSet<String> = self.s.household.as_ref().map(|h| h.members.iter().map(|m| m.person.clone()).collect()).unwrap_or_default();
        let pb = Self::people_bps(w);
        let someone = self.mind.closest(5, t).into_iter().any(|x| (self.s.people_we_know.contains(&x.who) || self.mind.knows(&x.who)) && !mine.contains(&x.who) && x.affinity_bps >= 1_000 && x.trust_bps.unwrap_or(0) >= pb);
        let go_to = if balance >= home.rent + self.p.essentials {
            "means_for_another"
        } else if someone {
            "someone_to_ask"
        } else {
            "nowhere"
        };
        let (answers, cfacts) = match self.p.possession.as_ref().and_then(|p| p.answer_bps) {
            None => {
                let c = self.conduct(w, ConductAsk { conduct: "answer_tribunal".into(), base_bps: if offer > 0 { 10_000 } else { 0 }, draw_bps: 0, forced: offer > 0, act: true, ..Default::default() });
                (offer > 0, c.facts)
            }
            Some(base) => {
                let draw = self.fixed_bps(w, &format!("answer-{}-{nth}", home.agreement));
                let c = self.conduct(w, ConductAsk { conduct: "answer_tribunal".into(), base_bps: base, draw_bps: draw, who: Some(tribunal.clone()), lean: true, act: true, ..Default::default() });
                (c.does, c.facts)
            }
        };
        let mut f = json!({ "owed": claimed, "answer_by": d.i("answer_by").or(d.i("hearing_at")).unwrap_or(t), "offer": offer, "answers": answers });
        for (k, v) in cfacts {
            f[k] = json!(v);
        }
        self.told(w, "home", &home.space, "possession_applied", Some(&home.landlord), f);
        if !answers {
            return;
        }
        // (What the mind would hold back of it is the mind's; as the life sees it, everything below is told.)
        let mut data_ = json!({ "application": d.get("application"), "owes": owes, "offer": offer, "every_days": 30 });
        let mut said = vec![
            format!("we say {} is owed today", Self::usd(w, owes)),
            if offer > 0 { format!("we could pay {} a month toward it, beyond the rent as it falls due", Self::usd(w, offer)) } else { "we can pay nothing toward it beyond the rent now".into() },
        ];
        if owes < claimed {
            data_["disputes_sum"] = json!(true);
            said[0] = format!("we say {} is owed today, not {}", Self::usd(w, owes), Self::usd(w, claimed));
        }
        let ntv = home.vacate.as_ref().and_then(|v| self.book.get(&v.paper)).filter(|n| is_kind(n, "notice_to_vacate")).cloned();
        if let (Some(n), Some(days)) = (ntv, self.p.possession.as_ref().and_then(|p| p.notice_days)) {
            let nd = data(&n);
            if let Some(b) = nd.i("by") {
                let gave = b - nd.i("given").unwrap_or(n.at);
                if gave < days * DAY {
                    data_["disputes_notice"] = json!(true);
                    said.push(format!("the notice to vacate gave {} days, and the law asks {days}", gave.div_euclid(DAY)));
                }
            }
        }
        if self.s.job.is_none() && self.s.own_work.is_none() {
            if let Some(j) = self.s.jobless_since {
                data_["out_of_work_since"] = json!(j);
                said.push(format!("out of work since {}", self.days_words(w, j)));
            }
        }
        if self.s.job.as_ref().and_then(|j| j.short).unwrap_or(0) > 0 {
            data_["pay_short"] = json!(true);
            said.push("our pay has come short of what was agreed".into());
        }
        if w.pic.body.as_ref().is_some_and(|b| b.conditions.iter().any(|c| c.until > t)) {
            data_["ill"] = json!(true);
            said.push("there is illness in the home".into());
        }
        if let Some(h) = &self.s.household {
            let mut ages: Vec<i64> = h.members.iter().map(|m| oikos_rules::household::age_at(m.born_at, t, self.p.year)).collect();
            ages.sort_by(|a, b| b.cmp(a));
            let kids = ages.iter().filter(|a| **a < oikos_rules::household::ADULT_YEARS).count();
            if !ages.is_empty() {
                data_["people"] = json!(ages.len());
                data_["children"] = json!(kids);
                data_["ages"] = json!(ages);
                let list = ages.iter().map(|a| a.to_string()).collect::<Vec<_>>().join(", ");
                said.push(if ages.len() == 1 {
                    format!("I live here alone (aged {})", ages[0])
                } else {
                    format!("{} of us live here{} (aged {list})", ages.len(), if kids > 0 { format!(", {kids} of them children") } else { String::new() })
                });
            }
        }
        // (A tenancy that began before the year has no day on our file: nothing is said of it.)
        if let Some(s) = self.book.signed_at(&home.agreement).filter(|s| *s > 0) {
            let lived = ((t - s).div_euclid(DAY)).max(0);
            data_["lived_days"] = json!(lived);
            said.push(format!("we have lived here {lived} days"));
        }
        data_["go_to"] = json!(go_to);
        said.push(
            match go_to {
                "nowhere" => "we have nowhere else to go",
                "someone_to_ask" => "there is someone we could ask to take us in",
                _ => "we have the means for another home",
            }
            .into(),
        );
        self.housing.answered_apps.insert(app.clone());
        w.push(because(
            format!("{} has applied for possession of our home: answering the tribunal.", home.landlord),
            vec![say(
                "tribunal_response",
                &format!("Answer to application {app}: {}.", said.join("; ")),
                Say {
                    to: Some(vec![tribunal.clone(), home.landlord.clone()]),
                    visible: Some(Visible::Only(vec![me, tribunal, home.landlord.clone()])),
                    basis: Some(app),
                    data: Some(data_),
                    ..Default::default()
                },
            )],
        ));
    }

    /// Asked whether someone's household may stay with us: yes where the home is ours to open, there is room, nobody is
    /// staying already, we can carry those without income, and we are willing. Otherwise no, and why.
    fn asked_to_take_in(&mut self, w: &mut Week, r: &Record) {
        let t = w.t;
        let me = self.me.clone();
        let d = data(r).clone();
        let speaker = r.speaks_for.clone().unwrap_or_default();
        let household = self.s.household.clone();
        // (Asked by a member of our own household for someone they know: their word stands for willingness.)
        let vouched = d.s("vouched_by") == Some(speaker.as_str()) && household.as_ref().is_some_and(|h| h.members.iter().any(|m| m.person == speaker)) && d.s("for").is_some();
        let asker = if vouched { d.s("for").unwrap_or_default().to_string() } else { speaker.clone() };
        let asking = if vouched { d.s("request").map_or(r.id.clone(), String::from) } else { r.id.clone() };
        let adults_in = d.i("adults").unwrap_or(1);
        let kids = d.i("children").unwrap_or(0);
        let without = d.i("without_income").unwrap_or(0);
        let place = self.s.home.as_ref().filter(|h| h.moved_in).map(|h| h.space.clone());
        // (The threshold leans with benevolence, for one who takes initiative: (1 - 0.3 z), z clamped to 3.)
        let lean0 = if self.mind.initiative() { self.mind.value_z("benevolence").clamp(-300, 300) } else { 0 };
        let threshold = round_div(self.p.stay.willing_affinity_bps * (1_000 - 3 * lean0), 1_000);
        let (aff, trust) = self.tie(&asker, t);
        let willing = vouched || (aff >= threshold && trust >= Self::people_bps(w));
        if place.is_none() && !vouched && self.housing.stay.is_none() && willing {
            if let (Some(at), Some(h)) = (self.s.living_at.clone(), household.as_ref().filter(|h| h.leaseholder != me)) {
                // (We live in a home that is someone else's to open, and would have them: we put it to whoever holds it.)
                self.told(w, "home", &at, "asked_for_another", Some(&asker), json!({ "adults": adults_in, "children": kids }));
                let lh = h.leaseholder.clone();
                let s = if adults_in > 1 { "s" } else { "" };
                let ch = if kids > 0 { format!(" and {kids} child{}", if kids > 1 { "ren" } else { "" }) } else { String::new() };
                w.push(because(
                    format!("{asker} asks whether their household may stay with us: the home is {lh}'s to open; asking them."),
                    vec![say(
                        "stay_request",
                        &format!("{asker}, whom I know, has no home and asks whether they may stay with us. They are {adults_in} adult{s}{ch}."),
                        Say {
                            to: Some(vec![lh.clone()]),
                            visible: Some(Visible::Only(vec![me.clone(), lh, asker.clone()])),
                            basis: Some(r.id.clone()),
                            data: Some(json!({ "adults": adults_in, "children": kids, "without_income": without, "for": asker, "vouched_by": me, "request": r.id })),
                            ..Default::default()
                        },
                    )],
                ));
                return;
            }
        }
        let cap = place.as_ref().and_then(|p| super::person::spaces(w.pic).find(|sp| sp.space == *p).map(|sp| sp.capacity as i64));
        let ours = household.as_ref().map_or(1, |h| h.members.len() as i64);
        let own_adults = 1 + self.adults(t).len() as i64;
        let why = match cap {
            None => Some("not_mine"),
            Some(_) if !self.housing.took_in.is_empty() => Some("hosting"),
            Some(c) if ours + adults_in + kids > c => Some("no_room"),
            _ if self.household_income(t) < self.p.essentials * (own_adults + without) => Some("means"),
            _ if !willing => Some("not_willing"),
            _ => None,
        };
        if why.is_none() {
            self.housing.took_in.insert(asker.clone());
        }
        // (No room or no means is not a matter of willingness: only a yes or an unwilling no is an act of it.)
        let mut cf = BTreeMap::new();
        if why.is_none() || why == Some("not_willing") {
            cf = self.conduct(w, ConductAsk { conduct: "take_in".into(), base_bps: 0, draw_bps: 0, forced: why.is_none(), act: true, ..Default::default() }).facts;
        }
        let mut f = json!({ "adults": adults_in, "children": kids, "why": why });
        for (k, v) in cf {
            f[k] = json!(v);
        }
        let opt = place.clone().unwrap_or_else(|| "none".into());
        self.told(w, "home", &opt, if why.is_some() { "declined_to_take_in" } else { "took_in" }, Some(&asker), f);
        let reason = match why {
            Some("not_mine") => format!("{asker} asks whether their household may stay with us: the home is not ours to open; saying no."),
            Some("hosting") => format!("{asker} asks whether their household may stay with us: someone is staying with us already; saying no."),
            Some("no_room") => format!("{asker} asks whether their household may stay with us: there is no room for them here; saying no."),
            Some("means") => format!("{asker} asks whether their household may stay with us: we could not carry them; saying no."),
            Some(_) => format!("{asker} asks whether their household may stay with us: we are not close enough to them; saying no."),
            None => format!("{asker} asks whether their household may stay with us: there is room, and we are willing; saying yes."),
        };
        let words = match (&why, &place) {
            (None, Some(p)) => format!("Answer to your asking {asking}: yes. Come and stay with us at {p}."),
            _ => format!("Answer to your asking {asking}: no, we cannot take you in."),
        };
        let data_ = match why {
            Some(y) => json!({ "request": asking, "yes": false, "why": y }),
            None => json!({ "request": asking, "yes": true, "space": place }),
        };
        w.push(because(reason, vec![say("stay_answer", &words, Say { to: Some(vec![asker.clone()]), visible: Some(Visible::Only(vec![me, asker])), basis: Some(r.id.clone()), data: Some(data_), ..Default::default() })]));
    }

    /// The answer of someone we asked to take us in. Yes, and we still have no dwelling: we go there as their guests,
    /// with the children; the other adults are told. Our household's record stays ours, and we go on looking.
    fn stay_answered(&mut self, w: &mut Week, r: &Record) {
        let t = w.t;
        let me = self.me.clone();
        let d = data(r);
        let host = r.speaks_for.clone().unwrap_or_default();
        let space = d.s("space").map(String::from);
        let yes = d.get("yes") == Some(&Value::Bool(true)) && space.is_some();
        if yes && self.s.home.is_none() && self.housing.stay.is_none() && self.s.living_at.is_none() && self.is_leaseholder() {
            let space = space.unwrap_or_default();
            self.housing.stay = Some(Stay { host: host.clone(), space: space.clone(), since: t });
            self.s.living_at = Some(space.clone());
            self.s.gave_up.remove(&space);
            let mut f = json!({ "people": 1 + self.others().len() });
            if let Some(h) = self.s.homeless_since {
                f["days_without"] = json!((t - h).div_euclid(DAY));
            }
            self.told(w, "home", &space, "taken_in", Some(&host), f);
            self.treated(w, Treated { who: host.clone(), kind: "took_us_in".into(), good: true, weight_bps: Some(2_000), tried: true, ..Default::default() });
            self.s.people_we_know.insert(host.clone());
            let kids = self.children(t);
            let mut calls = vec![move_in(&space)];
            calls.extend(kids.iter().map(|k| call("occupancy", vec![("in", Some(arg(&space))), ("who", Some(arg(&k.person)))])));
            w.push(because(format!("{host} will take us in: going to stay at {space}{}.", if kids.is_empty() { "" } else { ", with the children" }), calls));
            for a in self.adults(t) {
                w.push(because(format!("{host} will take us in: telling the household to come."), vec![message(&[a.reach().to_string()], &SAYING::move_in(&space), None)]));
            }
        } else if !yes {
            let why = d.s("why").unwrap_or_default().to_string();
            self.told(w, "home", "stay", "not_taken_in", Some(&host), json!({ "why": why }));
            // (Refused for want of willingness: a little further from them.)
            self.treated(w, Treated { who: host, kind: if why == "not_willing" { "refused".into() } else { "asked".into() }, good: false, weight_bps: if why == "not_willing" { Some(500) } else { Some(0) }, tried: true, ..Default::default() });
        } else if self.housing.stay.as_ref().map(|s| s.host.as_str()) != Some(host.as_str()) {
            w.push(because(
                format!("{host} would take us in, and we no longer need it: telling them."),
                vec![say("stay_ended", "Thank you: we do not need to stay after all.", Say { to: Some(vec![host.clone()]), visible: Some(Visible::Only(vec![me, host])), basis: Some(r.id.clone()), data: Some(json!({ "by": "guest" })), ..Default::default() })],
            ));
        }
    }

    /// Ordered to pay someone (rent in arrears, by a tribunal that heard it): paid, if it can be and leave the month's
    /// essentials; if not, it is theirs to have enforced.
    pub fn ordered_to_pay_rent(&mut self, w: &mut Week) {
        let me = self.me.clone();
        for r in self.fresh() {
            let d = data(&r).clone();
            if !(is_kind(&r, "tribunal_order") || is_kind(&r, "venue_decision")) || d.s("against") != Some(me.as_str()) || d.s("finding") != Some("pay") || d.s("matter").is_none() {
                continue;
            }
            let amount = d.i("amount").unwrap_or(0);
            let to = d.s("to").map(String::from);
            let pays = to.is_some() && amount > 0 && w.acc.as_ref().is_some_and(|a| a.balance >= amount + self.p.essentials);
            let applicant = d.s("applicant").unwrap_or_default().to_string();
            self.tell(w, Outcome {
                domain: "friction".into(),
                option: d.s("matter").unwrap_or_default().into(),
                kind: "ordered_to_pay".into(),
                from: Some(applicant.clone()),
                facts: facts(json!({ "amount": amount, "paid": pays, "binding": d.get("binding") != Some(&Value::Bool(false)) })),
                paper: Some(r.id.clone()),
                ..Default::default()
            });
            let by = r.speaks_for.clone().unwrap_or_default();
            let kb = self.kind_of(&by, &w.cx.ctx.params.clone());
            self.treated(w, Treated { who: by.clone(), kind: kb, good: false, done_to: true, paper: Some(r.id.clone()), ..Default::default() });
            if let (true, Some(to), Some(acc)) = (pays, to, w.acc.clone()) {
                if let Some(a) = w.acc.as_mut() {
                    a.balance -= amount;
                }
                w.push(because(
                    format!("{by} orders us to pay {applicant} {}: paying it.", Self::usd(w, amount)),
                    vec![pay(&to, amount, Pay { from: Some(acc.account), for_: Some(format!("Under {}.", r.id)), settles: Some(r.id.clone()), ..Default::default() }, w.cx)],
                ));
            }
        }
    }
}

// ------------------------------------------------------------------ moving in, staying, hunting (citizen.ts 3287-3352, 3530-3559, 3805-3811)

impl Person {
    /// Moving into a home we hold a lease on, once there's physical room: with the children, in one go; then the other
    /// adults are told to come, and their share of the rent (split evenly among those earning).
    pub fn move_into_home(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        if let (Some(h), Some(at)) = (self.s.home.clone(), self.s.living_at.clone()) {
            if !h.moved_in && at != h.space {
                // We still live where the household used to (the lease there wasn't ours): leave it first.
                if inside(w.pic, &me, &at) {
                    w.push(because("Moving out of our old home, to the one we now hold a lease on.", vec![move_out(&at, &me)]));
                }
                for k in self.children(t) {
                    w.push(because("Taking the children out of our old home.", vec![move_out(&at, &k.person)]));
                }
                self.s.living_at = None;
            }
        }
        if let (Some(h), Some(flooded)) = (self.s.home.clone(), self.housing.uninhabitable.clone()) {
            if h.agreement == flooded {
                let mut calls = vec![notice(&h.agreement, "The premises are uninhabitable (flooded).")];
                if let Some(o) = &h.order {
                    calls.push(withdraw(o, Some("Lease ended: the premises are flooded.")));
                    self.retire_order(o);
                }
                w.push(because("The home we lease is under water: ending the lease, as one may for premises no one can live in.", calls));
                self.s.home = None;
                self.s.homeless_since = Some(t);
            }
        }
        self.housing.uninhabitable = None;
        // (Already there, the round having brought us: in.)
        let here = w.pic.body.as_ref().and_then(|b| b.in_space.clone());
        if let Some(h) = self.s.home.as_mut().filter(|h| !h.moved_in) {
            if here.as_deref() == Some(h.space.as_str()) {
                h.moved_in = true;
            }
        }
        // (Tried and not yet in, because the last tenants are still there: again the next day, whenever we look again.)
        if let Some(h) = self.s.home.clone().filter(|h| !h.moved_in) {
            if t >= self.housing.next_move_try {
                self.housing.next_move_try = t + DAY;
                let kids = self.children(t);
                let mut calls = vec![move_in(&h.space)];
                calls.extend(kids.iter().map(|k| call("occupancy", vec![("in", Some(arg(&h.space))), ("who", Some(arg(&k.person)))])));
                w.push_marked(because(format!("Moving into {}, which we hold a lease on{}.", h.space, if kids.is_empty() { "" } else { ", with the children" }), calls), Mark::Move);
                self.s.moving = true;
            }
        }
        let Some(h) = self.s.home.clone().filter(|h| h.moved_in) else { return };
        if !self.is_leaseholder() {
            return;
        }
        let grown = self.adults(t);
        if self.s.told_move_in.as_deref() != Some(h.space.as_str()) {
            for a in &grown {
                w.push(because("We've moved in: telling the household to come.", vec![message(&[a.reach().to_string()], &SAYING::move_in(&h.space), None)]));
            }
            self.s.told_move_in = Some(h.space.clone());
        }
        let acc = w.acc.as_ref().map(|a| a.account.clone()).unwrap_or_default();
        let earners = i64::from(self.monthly_income(t) > 0) + grown.iter().filter(|a| self.s.member_pay.get(&a.person).copied().unwrap_or(0) > 0).count() as i64;
        for a in &grown {
            let Some(pay_) = self.s.member_pay.get(&a.person).copied() else { continue }; // not heard what they earn yet
            let due = if pay_ > 0 { h.rent / earners.max(1) } else { 0 };
            let told = self.s.shares_told.get(&a.person).copied().unwrap_or_else(|| self.genesis_share(&a.person));
            if told != due {
                w.push(because(
                    format!("Telling a member of the household their share of the {} rent: split evenly among the {earners} of us earning.", Self::usd(w, h.rent)),
                    vec![message(&[a.reach().to_string()], &SAYING::share(due, &acc, &w.cx.ctx.world), None)],
                ));
            }
            self.s.shares_told.insert(a.person.clone(), due);
        }
    }

    /// With no dwelling: asking the people we are closest to whether we may stay with them (all at once, closest
    /// first; asked again after a while, of whoever we are close to then). Guests told when our home has ended; our
    /// host thanked once we have one of our own.
    pub fn stay_with_someone(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let again = self.housing.stay_asked_at.is_none_or(|a| t - a >= self.p.stay.ask_again_days * DAY);
        if self.is_leaseholder() && self.s.home.is_none() && self.housing.stay.is_none() && self.s.living_at.is_none() && self.s.homeless_since.is_some() && again {
            let mine: BTreeSet<String> = self.s.household.as_ref().map(|h| h.members.iter().map(|m| m.person.clone()).collect()).unwrap_or_default();
            let n = self.p.stay.ask + mine.len() + self.housing.stay_asked.len();
            let whom: Vec<String> = self
                .mind
                .closest(n, t)
                .into_iter()
                .map(|x| x.who)
                .filter(|x| (self.s.people_we_know.contains(x) || self.mind.knows(x)) && !mine.contains(x) && !self.housing.stay_asked.contains(x))
                .take(self.p.stay.ask)
                .collect();
            self.housing.stay_asked.extend(whom.iter().cloned());
            self.housing.stay_asked_at = Some(t);
            let grown = self.adults(t);
            let kids = self.children(t).len();
            let without = i64::from(self.monthly_income(t) <= 0) + grown.iter().filter(|a| self.s.member_pay.get(&a.person).copied().unwrap_or(0) <= 0).count() as i64;
            if !whom.is_empty() {
                self.told(w, "home", "stay", "asked_to_stay", None, json!({ "asked": whom.len(), "adults": 1 + grown.len(), "children": kids }));
            }
            let adults = 1 + grown.len();
            let words = format!(
                "We have no home. May we stay with you? We are {adults} adult{}{}.",
                if grown.is_empty() { "" } else { "s" },
                if kids > 0 { format!(" and {kids} child{}", if kids > 1 { "ren" } else { "" }) } else { String::new() }
            );
            for x in whom {
                w.push(because(
                    format!("We have no home: asking {x}, whom we know, whether we may stay with them."),
                    vec![say("stay_request", &words, Say { to: Some(vec![x.clone()]), visible: Some(Visible::Only(vec![me.clone(), x])), data: Some(json!({ "adults": adults, "children": kids, "without_income": without })), ..Default::default() })],
                ));
            }
        }
        // (Our guests are told if our own home has ended: they were there by our leave.)
        if self.s.home.is_none() && !self.housing.took_in.is_empty() {
            for g in std::mem::take(&mut self.housing.took_in) {
                w.push(because(
                    format!("Our home has ended: telling {g}, who was staying with us."),
                    vec![say("stay_ended", "Our home has ended: you cannot stay with us any longer.", Say { to: Some(vec![g.clone()]), visible: Some(Visible::Only(vec![me.clone(), g])), data: Some(json!({ "by": "host" })), ..Default::default() })],
                ));
            }
        }
        // (In a home of our own again: whoever took us in is told we have gone.)
        if self.s.home.is_some() {
            self.housing.stay_asked.clear();
            if let Some(stay) = self.housing.stay.take() {
                w.push(because(
                    format!("We have a home of our own: telling {}, with our thanks.", stay.host),
                    vec![say("stay_ended", "We have a home of our own now. Thank you for taking us in.", Say { to: Some(vec![stay.host.clone()]), visible: Some(Visible::Only(vec![me.clone(), stay.host.clone()])), data: Some(json!({ "by": "guest" })), ..Default::default() })],
                ));
                self.told(w, "home", &stay.space, "stay_ended", Some(&stay.host), json!({ "days": (t - stay.since).div_euclid(DAY), "own_home": true }));
            }
        }
    }

    /// Looking for a home: what someone told us about first, then the best we can afford among the listings seen,
    /// chosen by the mind.
    pub fn hunt_home(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        if self.s.move_hunt.is_some_and(|(until, _)| t >= until) || self.s.home.is_none() {
            self.s.move_hunt = None;
        }
        if self.s.cheaper_than.is_some_and(|(_, until)| self.s.home.is_some() || t >= until) {
            self.s.cheaper_than = None;
        }
        let looking = self.s.home.as_ref().is_none_or(|h| self.s.move_hunt.is_some() && !h.owned);
        if !self.is_leaseholder() || !looking {
            return;
        }
        let Some(acc) = w.acc.clone() else { return };
        let rooms = self.min_bedrooms(t);
        let here = self.s.home.as_ref().map(|h| h.space.clone());
        let fits = |p: &Person, id: &String| -> Option<Arc<Record>> {
            let l = p.book.get(id)?.clone();
            let d = data(&l);
            let rent = d.i("rent")?;
            (d.s("space").map(String::from) != here && !p.housing.applied.contains(&l.id) && p.affordable(rent, acc.balance, t) && d.i("bedrooms").unwrap_or(0) >= rooms).then_some(l)
        };
        let told: Vec<Arc<Record>> = self.s.lead_homes.iter().filter_map(|id| fits(self, id)).collect();
        let mut listings = told.clone();
        for id in &self.s.found_homes {
            if !told.iter().any(|x| x.id == *id) && !listings.iter().any(|x| x.id == *id) {
                if let Some(l) = fits(self, id) {
                    listings.push(l);
                }
            }
        }
        if listings.is_empty() {
            return;
        }
        let need = self.s.household.as_ref().map_or(1, |h| oikos_rules::household::bedrooms_needed(h, t, self.p.year, self.p.occupancy.as_ref()));
        let options = listings
            .iter()
            .map(|l| {
                let d = data(l);
                Choice {
                    key: l.id.clone(),
                    facts: Some(Facts { money_per_month: -d.i("rent").unwrap_or(0), home: Some(HomeFacts { bedrooms: d.i("bedrooms") }), ..Default::default() }),
                    others: Some(i64::from(told.iter().any(|x| x.id == l.id))),
                    ..Default::default()
                }
            })
            .collect();
        let life = self.life(w.pic, t, Some(acc.balance));
        let dec = self.mind.decide(w.cx, &life, Decide { domain: "home".into(), options, satisfied_here: Some(0), purpose: Some("home".into()), bedrooms_needed: Some(need.max(0) as u32), ..Default::default() });
        let Some(best) = listings.iter().find(|l| Some(&l.id) == dec.key.as_ref()).cloned() else { return };
        let d = data(&best).clone();
        if let (Some(space), Some(n)) = (d.s("space"), dec.n) {
            self.housing.chose.insert(format!("home:{space}"), n);
        }
        let Some(to) = best.speaks_for.clone() else { return };
        self.housing.applied.insert(best.id.clone());
        let members: Vec<String> = self.s.household.as_ref().map_or(vec![me.clone()], |h| h.members.iter().map(|m| m.person.clone()).collect());
        let how = if dec.strategy == "imitate" { "where someone told us to look" } else { "weighing each home's rent and room" };
        let what = d.s("space").or(d.s("structure")).unwrap_or_default().to_string();
        w.push(because(
            format!("Applying for {}: within a third of household income, with at least {rooms} bedrooms, {how}.", d.s("space").unwrap_or_default()),
            vec![say(
                "rental_application",
                &format!("Application for {what}, for a household of {}.", members.len()),
                Say {
                    to: Some(vec![to.clone()]),
                    visible: Some(Visible::Only(vec![me.clone(), to])),
                    basis: Some(best.id.clone()),
                    data: Some(json!({ "listing": best.id, "account": acc.account, "members": members, "household": { "people": members.len(), "bedrooms_needed": if self.s.household.is_some() { need } else { 0 } } })),
                    ..Default::default()
                },
            )],
        ));
    }

    /// Utilities: signed up for energy once we hold a home and live there.
    pub fn utilities(&mut self, w: &mut Week) {
        let (Some(u), Some(h), Some(acc)) = (self.p.utilities.clone(), self.s.home.clone().filter(|h| h.moved_in), w.acc.clone()) else { return };
        if !self.is_leaseholder() || self.housing.energy_for.as_deref() == Some(h.agreement.as_str()) {
            return;
        }
        self.housing.energy_for = Some(h.agreement.clone());
        w.push(because(
            "A home of ours: signing up for its energy supply.",
            vec![say(
                "supply_request",
                &format!("Supply request: energy for {}.", h.space),
                Say { to: Some(vec![u.energy.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), u.energy])), data: Some(json!({ "account": acc.account, "home": h.space })), ..Default::default() },
            )],
        ));
    }
}

// ------------------------------------------------------------------ owning, selling and buying (citizen.ts 4363-4510)

/// What a buyer borrows at a price, putting down a share as deposit: the deposit rounded up to a whole unit, the loan
/// the rest (credit.ts `loanFor`).
pub fn loan_for(price: i64, deposit_bps: i64) -> i64 {
    let n = price * deposit_bps;
    price - (n / 10_000 + i64::from(n % 10_000 > 0))
}

impl Person {
    /// Whether we'd apply to the bank now, as our papers show (credit.ts `Borrowing.canApply`, read from the book: an
    /// application not yet decided within a fortnight, a refusal within 60 days, a loan being repaid, a default).
    /// (Money's borrowing keeps this in memory in TS; until it is ported, read here.)
    fn can_borrow(&self, t: i64) -> bool {
        let Some(bank) = self.p.bank.as_deref() else { return false };
        let me = self.me.as_str();
        let decisions: Vec<&Arc<Record>> = self.book.all("loan_decision").filter(|r| addressed_to(r).iter().any(|a| a == me)).collect();
        let last_app = self.book.all("loan_application").filter(|r| r.speaks_for.as_deref() == Some(me)).map(|r| r.at).max();
        let waiting = last_app.is_some_and(|a| t - a < 14 * DAY && !decisions.iter().any(|d| d.at >= a));
        let refused = decisions.iter().any(|d| d.get_flag_false("approved") && t - d.at < 60 * DAY);
        let repaying = decisions.iter().any(|d| data(d).get("approved") == Some(&Value::Bool(true)) && t < d.at + data(d).i("months").filter(|m| *m > 0).unwrap_or(12) * MONTH);
        let defaulted = self.book.all("loan_default").any(|r| addressed_to(r).iter().any(|a| a == me));
        !bank.is_empty() && !waiting && !refused && !repaying && !defaulted
    }
    /// The title to a lot: ours, if one we've read is; else the first.
    fn title_of(&self, lot: &str) -> Option<String> {
        let all: Vec<String> = self.book.claims_by(ClaimKey::Object, lot).filter(|c| matches!(&c.body, RecordBody::Claim { about, .. } if about.get("kind").and_then(Value::as_str) == Some("ownership"))).map(|c| c.id.clone()).collect();
        all.iter().find(|c| self.holder_of(c).as_deref() == Some(self.me.as_str())).or(all.first()).cloned()
    }
    fn valuation_of(&self, lot: &str) -> Option<i64> {
        self.book.open("valuation").filter(|v| data(v).s("lot") == Some(lot)).max_by(|a, b| a.at.cmp(&b.at)).and_then(|v| data(v).i("value"))
    }
    /// The house on a lot (from the street): its building, type and dwelling.
    fn house_on(&self, pic: &oikos_sight::Picture, lot: &str) -> Option<(String, String, Option<String>)> {
        let lc: BTreeSet<String> = self.book.get(lot).map(|l| data(l).ids("cells").into_iter().map(String::from).collect()).unwrap_or_default();
        let st = cells(pic, "street").iter().find(|c| lc.contains(&c.cell) && c.structure.is_some())?.structure.clone()?;
        Some((st.structure.clone(), st.structure_type.clone(), st.spaces.iter().find(|sp| sp.kind == "dwelling").map(|sp| sp.space.clone())))
    }
    /// Put a lot of ours with a house on it up for sale, at its valuation.
    /// The lot of the home we own and live in (citizen.ts `ownLot`).
    pub fn own_lot(&self) -> Option<String> {
        self.s.home.as_ref().filter(|h| h.owned).and_then(|h| match &self.book.get(&h.agreement)?.body {
            RecordBody::Claim { about, .. } => about.get("object").and_then(Value::as_str).map(String::from),
            _ => None,
        })
    }
    /// Whether we are selling our home.
    pub fn is_selling(&self) -> bool {
        self.housing.selling.is_some()
    }
    /// An owner who would leave town puts the home up for sale to go once it is sold (citizen.ts, in `leaving`).
    pub fn sell_to_leave(&mut self, pic: &oikos_sight::Picture) {
        if self.p.market.is_some() && self.housing.selling.is_none() {
            if let Some(lot) = self.own_lot() {
                self.sell(pic, &lot, true);
            }
        }
    }
    fn sell(&mut self, pic: &oikos_sight::Picture, lot: &str, leave_after: bool) -> bool {
        let Some((structure, ty, Some(space))) = self.house_on(pic, lot) else { return false };
        let Some(price) = self.valuation_of(lot) else { return false };
        let bedrooms = self.p.market.as_ref().and_then(|m| m.bedrooms_by_type.get(&ty).copied());
        let loan = self.mortgage_for(&space).map(|l| l.id.clone());
        self.housing.selling = Some(Selling { lot: lot.into(), space: Some(space), structure, bedrooms, price, asked: price, leave_after, loan, ..Default::default() });
        true
    }
    /// What is for sale as far as we know: what our last look showed, or, shown listings unasked, those standing.
    fn for_sale_now(&self) -> Vec<Arc<Record>> {
        if self.p.sale_board.is_empty() {
            return self.book.open("property_for_sale").cloned().collect();
        }
        self.housing.on_sale.iter().flatten().filter_map(|id| self.book.get(id).cloned()).collect()
    }

    /// Owning a home: sold when the mortgage is in default, or land inherited that we don't live on; a sale carried
    /// through; and now and then, a renting household that can afford it buys (citizen.ts `market`). The last housing
    /// part of a full plan: the book's place moves on.
    pub fn selling_and_buying(&mut self, w: &mut Week) {
        self.take_sale_answer(w.pic);
        self.market(w);
        self.housing.fresh_from = self.housing.fresh_to.max(self.housing.fresh_from);
    }

    fn market(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let (Some(m), Some(acc)) = (self.p.market.clone(), w.acc.clone()) else { return };
        if !self.is_leaseholder() {
            return;
        }
        // Our mortgage in default: the home sold before the bank takes it (we rent after).
        let own_lot = self.own_lot();
        let our_loan = self.s.home.as_ref().filter(|h| h.owned).and_then(|h| self.mortgage_for(&h.space));
        if self.housing.selling.is_none() {
            if let (Some(loan), Some(lot)) = (&our_loan, &own_lot) {
                if self.book.all("loan_default").any(|r| data(r).s("loan") == Some(loan.id.as_str()) && addressed_to(r).contains(&me)) {
                    self.sell(w.pic, lot, false);
                }
            }
        }
        // Inherited land with a house we don't live in: sold (not until it's valued in our name).
        if self.housing.selling.is_none() {
            let transfers: Vec<String> = self.book.of_type("claim_transfer").filter_map(|r| match &r.body {
                RecordBody::ClaimTransfer { claim, to } if *to == me => Some(claim.clone()),
                _ => None,
            }).collect();
            for claim in transfers {
                let lot = match self.book.get(&claim).map(|c| &c.body) {
                    Some(RecordBody::Claim { about, .. }) => about.get("object").and_then(Value::as_str).map(String::from),
                    _ => None,
                };
                let Some(lot) = lot else { continue };
                let ours_home = self.s.home.as_ref().is_some_and(|h| h.owned && h.agreement == claim);
                if self.housing.sold_lots.contains(&lot) || self.holder_of(&claim).as_deref() != Some(me.as_str()) || ours_home {
                    continue;
                }
                if self.sell(w.pic, &lot, false) {
                    break;
                }
            }
        }
        // ---- selling: listed at the valuation; once paid in full, the title passed and the mortgage paid off
        self.listing_seen();
        if let Some(mut s) = self.housing.selling.clone() {
            let listing_at = s.listing.as_ref().filter(|l| *l != "pending").and_then(|l| self.book.get(l)).map_or(t, |r| r.at);
            let floor = s.asked * m.floor_bps / 10_000;
            if s.listing.is_none() {
                s.listing = Some("pending".into());
                let beds = s.bedrooms.map(|b| format!(" with {b} bedrooms")).unwrap_or_default();
                let mut dd = json!({ "structure": s.structure, "lot": s.lot, "space": s.space, "type": "home", "price": s.price, "account": acc.account });
                if let Some(b) = s.bedrooms {
                    dd["bedrooms"] = json!(b);
                }
                w.push(because(
                    format!("Selling {} at its valuation, {}{}.", s.structure, Self::usd(w, s.price), if s.leave_after { ", to leave town once it's sold" } else { "" }),
                    vec![say("property_for_sale", &format!("For sale: {}, a home{beds}, {}. To buy it, send a purchase naming this listing, and pay.", s.structure, Self::usd(w, s.price)), Say { visible: Some(Visible::Public), data: Some(dd), ..Default::default() })],
                ));
            } else if s.listing.as_deref() != Some("pending") && !s.sold && s.buyer.is_none() && t - listing_at >= m.relist_days * DAY && s.price > floor {
                let was = s.price;
                s.price = floor.max(s.price - s.price * m.cut_bps / 10_000);
                let l = s.listing.take().unwrap_or_default();
                w.push(because(format!("{} hasn't sold in {} days at {}: taking it off, to list it for {}.", s.structure, m.relist_days, Self::usd(w, was), Self::usd(w, s.price)), vec![withdraw(&l, Some("Relisting for less."))]));
            } else if s.listing.as_deref() != Some("pending") && s.listing.is_some() && !s.sold {
                // (A purchase answering any listing we made of it.)
                if s.buyer.is_none() {
                    let mut buys: Vec<Arc<Record>> = self.book.open("property_purchase").filter(|r| crate::common::bases_of(r).iter().any(|b| s.listings.contains(b)) && addressed_to(r).contains(&me)).cloned().collect();
                    buys.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| crate::common::filed_before(&a.id, &b.id)));
                    if let Some(b) = buys.first() {
                        s.buyer = b.speaks_for.clone();
                        s.buyer_account = data(b).s("account").map(String::from);
                    }
                }
                if let (Some(buyer), true) = (s.buyer.clone(), s.received >= s.price) {
                    s.sold = true;
                    self.housing.sold_lots.insert(s.lot.clone());
                    let listing = s.listing.clone().unwrap_or_default();
                    let mut calls = vec![];
                    if let Some(title) = self.title_of(&s.lot) {
                        calls.push(call("claim", vec![("transfer", Some(arg(&title))), ("to", Some(arg(&buyer)))]));
                    }
                    calls.push(withdraw(&listing, Some("Sold.")));
                    if let (true, Some(ba)) = (s.received > s.price, &s.buyer_account) {
                        calls.push(pay(ba, s.received - s.price, Pay { from: Some(acc.account.clone()), for_: Some(format!("The difference: {} was down to {}.", s.structure, Self::usd(w, s.price))), ..Default::default() }, w.cx));
                    }
                    calls.push(say(
                        "property_sold",
                        &format!("Sold: {} to {buyer} for {}.", s.structure, Self::usd(w, s.price)),
                        Say { visible: Some(Visible::Public), basis: Some(listing), data: Some(json!({ "structure": s.structure, "lot": s.lot, "buyer": buyer, "price": s.price })), ..Default::default() },
                    ));
                    w.push(because(format!("{buyer} has paid {} for {}: passing them the title.", Self::usd(w, s.received), s.structure), calls));
                    if let (Some(loan), Some(bank)) = (&s.loan, &self.p.bank) {
                        w.push(because(
                            "Sold: asking the bank what paying our mortgage off takes.",
                            vec![say("loan_payout_request", &format!("What does paying off {loan} take?"), Say { to: Some(vec![bank.clone()]), visible: Some(Visible::Only(vec![me.clone(), bank.clone()])), data: Some(json!({ "loan": loan })), ..Default::default() })],
                        ));
                    }
                    // (Leaving: we stay in it until we go. Not leaving: we look for somewhere to rent, staying until found.)
                    if !s.leave_after && self.s.home.as_ref().is_some_and(|h| h.owned && Some(&h.space) == s.space.as_ref()) {
                        self.s.home = None;
                    }
                    if s.loan.is_none() {
                        if s.leave_after {
                            self.housing.sold_and_going = Some(t);
                        }
                        self.housing.selling = None;
                        s = Selling::default();
                    }
                }
            } else if s.sold {
                if let Some(loan) = s.loan.clone() {
                    let fig = self.book.open("loan_payout").find(|r| data(r).s("loan") == Some(loan.as_str()) && addressed_to(r).contains(&me)).cloned();
                    if let Some(fig) = fig {
                        let amount = data(&fig).i("amount").unwrap_or(0);
                        let order = self.book.all("request").find(|r| cites(r, &loan) && r.speaks_for.as_deref() == Some(me.as_str()) && !self.book.withdrawn(&r.id)).map(|r| r.id.clone());
                        let mut calls = vec![pay(data(&fig).s("account").unwrap_or_default(), amount, Pay { from: Some(acc.account.clone()), for_: Some(format!("Paying off {loan}.")), settles: Some(loan.clone()), ..Default::default() }, w.cx)];
                        if let Some(o) = order {
                            calls.push(withdraw(&o, Some("Mortgage paid off.")));
                        }
                        w.push(because(format!("Paying our mortgage off ({}), and stopping its repayments.", Self::usd(w, amount)), calls));
                        self.housing.paying_off = Some(loan.clone());
                        if s.leave_after {
                            self.housing.sold_and_going = Some(t);
                        }
                        self.housing.selling = None;
                        s = Selling::default();
                    }
                }
            }
            if self.housing.selling.is_some() {
                self.housing.selling = Some(s);
            }
        }
        // ---- buying: a renting household with income that can afford a home that suits it, now and then
        if let Some(mut b) = self.housing.buying.clone() {
            if !b.paid {
                let declined = self.book.all("loan_decision").any(|r| r.at >= b.since && addressed_to(r).contains(&me) && data(r).get("approved") == Some(&Value::Bool(false)));
                let for_sale = self.for_sale_now().iter().any(|r| r.id == b.listing || (r.speaks_for.as_deref() == Some(b.seller.as_str()) && data(r).s("lot") == Some(b.lot.as_str())));
                let seen = if self.p.sale_board.is_empty() { t } else { self.housing.sale_seen_at };
                if for_sale {
                    b.gone_since = None;
                } else if b.gone_since.is_none() {
                    b.gone_since = Some(if self.p.sale_board.is_empty() { i64::MIN / 2 } else { self.housing.sale_seen_at });
                }
                let gone = !for_sale && seen - b.gone_since.unwrap_or(seen) > 7 * DAY;
                if declined || gone || t - b.since > 60 * DAY {
                    self.housing.buying = None;
                } else if for_sale && b.funded && acc.balance >= b.price {
                    b.paid = true;
                    w.push(because(
                        format!("Our mortgage is through: buying {} for {}.", b.structure, Self::usd(w, b.price)),
                        vec![
                            say("property_purchase", &format!("Purchase of {}, as listed.", b.structure), Say { to: Some(vec![b.seller.clone()]), visible: Some(Visible::Only(vec![me.clone(), b.seller.clone()])), basis: Some(b.listing.clone()), data: Some(json!({ "listing": b.listing, "account": acc.account })), ..Default::default() }),
                            pay(&b.account, b.price, Pay { from: Some(acc.account.clone()), for_: Some(format!("Buying {}.", b.structure)), ..Default::default() }, w.cx),
                        ],
                    ));
                    self.housing.buying = Some(b);
                } else {
                    self.housing.buying = Some(b);
                }
            } else if self.our_titles().iter().any(|(_, lot)| *lot == b.lot) {
                // Ours: notice on the home we rented, and in once the seller's out (the round takes us there).
                if let Some(old) = self.s.home.clone().filter(|h| !h.owned) {
                    let mut calls = vec![notice(&old.agreement, "We've bought a home.")];
                    if let Some(o) = &old.order {
                        calls.push(withdraw(o, Some("Moving to a home we've bought.")));
                        self.retire_order(o);
                    }
                    w.push(because(format!("{} is ours: giving notice on the home we rented.", b.structure), calls));
                }
                let rent = self.mortgage_for(&b.space).map_or(0, |l| self.repayment(&l));
                let agreement = self.title_of(&b.lot).unwrap_or_else(|| b.lot.clone());
                self.s.home = Some(Home { agreement, space: b.space.clone(), structure: b.structure.clone(), landlord: me.clone(), rent, moved_in: false, owned: true, ..Default::default() });
                self.housing.buying = None;
            }
        }
        let renting = self.s.home.as_ref().is_some_and(|h| !h.owned);
        if self.housing.buying.is_none() && self.housing.selling.is_none() && renting && self.household_income(t) > 0 && t >= self.housing.next_buy_chance {
            self.housing.next_buy_chance = t + MONTH;
            if (w.cx.rng("buy").below(10_000) as i64) < m.buy_bps && self.can_borrow(t) {
                let rooms = self.min_bedrooms(t);
                let mut homes: Vec<Arc<Record>> = self
                    .for_sale_now()
                    .into_iter()
                    .filter(|r| {
                        let d = data(r);
                        d.s("type") == Some("home") && r.speaks_for.as_deref() != Some(me.as_str()) && d.i("bedrooms").unwrap_or(rooms) >= rooms && d.i("price").is_some_and(|p| acc.balance * 10_000 >= p * (m.deposit_bps + m.costs_bps))
                    })
                    .collect();
                homes.sort_by(|a, b| data(a).i("price").cmp(&data(b).i("price")).then_with(|| a.id.cmp(&b.id)));
                if let Some(l) = homes.first() {
                    let d = data(l);
                    let price = d.i("price").unwrap_or(0);
                    let loan = loan_for(price, m.deposit_bps);
                    let space = d.s("space").unwrap_or_default().to_string();
                    let structure = d.s("structure").unwrap_or_default().to_string();
                    self.housing.buying = Some(Buying {
                        listing: l.id.clone(),
                        seller: l.speaks_for.clone().unwrap_or_default(),
                        account: d.s("account").unwrap_or_default().into(),
                        price,
                        lot: d.s("lot").unwrap_or_default().into(),
                        space: space.clone(),
                        structure: structure.clone(),
                        paid: false,
                        since: t,
                        funded: false,
                        gone_since: None,
                    });
                    let bank = self.p.bank.clone().unwrap_or_default();
                    w.push(because(
                        format!("{structure} is for sale at {}, and we have the deposit and costs: asking the bank for a mortgage of {}.", Self::usd(w, price), Self::usd(w, loan)),
                        vec![say(
                            "loan_application",
                            &format!("Application for a loan of {} over {} months, for a home.", Self::usd(w, loan), m.mortgage_months),
                            Say {
                                to: Some(vec![bank.clone()]),
                                visible: Some(Visible::Only(vec![me.clone(), bank])),
                                data: Some(json!({ "amount": loan, "months": m.mortgage_months, "account": acc.account, "purpose": "a home", "price": price, "home": space })),
                                ..Default::default()
                            },
                        )],
                    ));
                }
            }
        }
    }
}

trait FlagFalse {
    fn get_flag_false(&self, key: &str) -> bool;
}
impl FlagFalse for Arc<Record> {
    /// TS's `!r.data?.approved`: not approved (absent counts as not).
    fn get_flag_false(&self, key: &str) -> bool {
        !data(self).flag(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::OwnAccount;
    use crate::{Ctx, Draws, WorldInfo};
    use oikos_rules::household::{HouseholdData, Member};
    use oikos_sight::Picture;

    const ME: &str = "c1";
    const HOME: &str = "apts-1/dwelling.1";

    fn ctx(params: Value) -> Ctx {
        let currency = oikos_sight::calls::Currency { code: "XTS".into(), symbol: Some("$".into()), minor_units: 2, ..Default::default() };
        let mut params = params;
        params["mind"] = json!("plain");
        Ctx { participant: "c1-self".into(), performer: Default::default(), entity: ME.into(), position: None, params: serde_json::from_value(params).unwrap(), world: Arc::new(WorldInfo { currency: Some(currency), ..Default::default() }) }
    }
    fn rec(v: Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).expect("a record"))
    }
    /// A lease from `landlord` to `tenant`, signed by the landlord (and the tenant, `both`).
    fn lease(id: &str, at: i64, landlord: &str, tenant: &str, rent: i64, basis: Option<&str>, both: bool) -> Vec<Arc<Record>> {
        let mut l = json!({ "id": id, "record": "agreement", "author": "p.l", "at": at, "visible_to": [landlord, tenant],
            "terms": { "template": "lease", "parties": [landlord, tenant], "commitments": [
                { "who": landlord, "does": { "outcome": { "occupancy": { "who": tenant, "in": HOME } } } },
                { "who": tenant, "does": { "outcome": { "money": { "to": format!("acc-{landlord}"), "amount": rent.to_string(), "for": "rent" } } }, "every": MONTH } ],
                "text": format!("{tenant} rents home {HOME} from {landlord}, succeeding c0 (lease L1) for 12 months from day 60.") } });
        if let Some(b) = basis {
            l["basis"] = json!(b);
        }
        let sig = |n: &str, who: &str| rec(json!({ "id": format!("{id}-{n}"), "record": "signature", "author": "p", "at": at, "visible_to": [landlord, tenant], "agreement": id, "as": who }));
        let mut v = vec![rec(l), sig("s1", landlord)];
        if both {
            v.push(sig("s2", tenant));
        }
        v
    }
    fn order(id: &str, at: i64, lease: &str, rent: i64) -> Arc<Record> {
        rec(json!({ "id": id, "record": "statement", "author": "c1-self", "speaks_for": ME, "at": at, "visible_to": [ME, "bank"], "kind": "request", "text": "Rent.", "basis": lease,
            "data": { "every": MONTH, "first": 0, "outcome": { "money": { "to": "acc-landlord-1", "amount": rent.to_string(), "for": "Rent." } } } }))
    }
    fn statement(id: &str, at: i64, kind: &str, from: &str, d: Value) -> Arc<Record> {
        rec(json!({ "id": id, "record": "statement", "author": format!("{from}-office"), "speaks_for": from, "at": at, "visible_to": [from, ME], "addressed_to": [ME], "kind": kind, "text": kind, "data": d }))
    }
    fn pic(t: i64, records: Vec<Arc<Record>>, readings: &[(&str, &'static str, Option<i64>)]) -> Picture {
        let mut channels = BTreeMap::new();
        channels.insert("papers".to_string(), Seen::Records { records, search: false });
        Picture {
            participant: "c1-self".into(),
            t,
            status: oikos_sight::ParticipantStatus::Active,
            entity: ME.into(),
            as_position: None,
            body: None,
            positions: vec![],
            outcomes: vec![],
            inbox: vec![],
            channels,
            asking: vec![],
            readings: readings.iter().map(|(id, st, e)| (id.to_string(), oikos_sight::Reading { of: "agreement", status: st, ends_at: *e, ended_by: None, reader: "terms" })).collect(),
            woke_for: "cadence".into(),
            since: 0,
        }
    }
    fn acc(balance: i64) -> Option<OwnAccount> {
        Some(OwnAccount { account: "acc-c1".into(), balance, custodian: "bank".into(), currency: "XTS".into() })
    }
    fn tenant_home(p: &mut Person, rent: i64, order: Option<&str>) {
        p.s.home = Some(Home { agreement: "L1".into(), space: HOME.into(), structure: "apts-1".into(), landlord: "landlord-1".into(), rent, order: order.map(String::from), moved_in: true, ..Default::default() });
    }
    fn in_work(p: &mut Person) {
        p.s.job = Some(super::super::person::Job { agreement: "J1".into(), employer: "factory-1".into(), wage: 120_000, period: 14 * DAY, since: 0, ..Default::default() });
    }
    /// Every housing part, in the plan's order, at one wake: what went out, as (why, program).
    fn week(p: &mut Person, c: &Ctx, pc: &Picture, balance: i64) -> Vec<(String, String)> {
        p.book.absorb(pc);
        let mut d = Draws::default();
        let mut cx = crate::Cx::new(pc.t, c, &mut d, 1, vec![]);
        let mut w = Week { pic: pc, cx: &mut cx, t: pc.t, acc: acc(balance), steps: vec![] };
        p.retire_old_rents(&mut w);
        p.tenancy_end(&mut w);
        p.offers(&mut w);
        p.rent_rise(&mut w);
        p.possession(&mut w);
        p.ordered_to_pay_rent(&mut w);
        p.left_homes(&mut w);
        p.move_into_home(&mut w);
        p.stay_with_someone(&mut w);
        p.hunt_home(&mut w);
        p.utilities(&mut w);
        p.selling_and_buying(&mut w);
        w.steps.iter().map(|s| (s.step.why.clone().unwrap_or_default(), oikos_sight::calls::program_text(&s.step.program()))).collect()
    }

    #[test]
    fn a_survivor_of_the_leaseholder_signs_the_tenancy_offered_and_stays_housed_paying_rent_from_its_start() {
        // (bughunt 2026-10-17 #3.) c0 held the lease of the home c1 lives in, and has died; the household names c1 now.
        // The landlord offers c1 the tenancy, a lease made on c0's, from day 60.
        let c = ctx(json!({ "bank": "bank" }));
        let mut p = Person::new(&c).unwrap();
        let member = |who: &str| Member { person: who.into(), participant: None, born_at: -40 * 365 * DAY, sex: oikos_rules::household::Sex::Female, parents: None };
        p.s.household = Some(HouseholdData { leaseholder: ME.into(), members: vec![member(ME)], couples: vec![] });
        p.s.living_at = Some(HOME.into());
        p.s.share = Some((50_000, Some("share-1".into())));
        p.s.was_leaseholder = Some(false);
        p.s.planned_at = 0;
        // (No job: what other parts do with one is theirs; six months' rent in savings carries it.)
        let pc = pic(20 * DAY, lease("L2", 20 * DAY, "landlord-1", ME, 100_000, Some("L1"), false), &[]);
        p.book.absorb(&pc);
        let mut d = Draws::default();
        let mut cx = crate::Cx::new(pc.t, &c, &mut d, 1, vec![]);
        let mut w = Week { pic: &pc, cx: &mut cx, t: pc.t, acc: acc(5_000_000), steps: vec![] };
        p.plan(&mut w);
        let out: Vec<String> = w.steps.iter().map(|s| oikos_sight::calls::program_text(&s.step.program())).collect();
        let signing = out.iter().find(|s| s.contains("sign") && s.contains("L2")).unwrap_or_else(|| panic!("the tenancy is signed: {out:?}"));
        assert!(signing.contains("40 days"), "rent from when the new lease begins (day 60), not from now: {signing}");
        assert!(signing.contains("share-1"), "the share once paid to the leaseholder is stopped");
        assert!(!out.iter().any(|s| s.contains("occupancy")), "nobody moves: {out:?}");
        let h = p.s.home.clone().expect("housed");
        assert_eq!((h.agreement.as_str(), h.space.as_str(), h.moved_in, h.rent), ("L2", HOME, true, 100_000));
        assert_eq!((p.s.living_at.clone(), p.s.homeless_since), (None, None), "never homeless");
        assert!(!out.iter().any(|s| s.contains("rental_application")), "not hunting");
        // (The next week: the rent order is ours, read from our own request citing the lease.)
        let so = order("rec.90", 20 * DAY, "L2", 100_000);
        let pc = pic(27 * DAY, vec![so], &[("L2", "in_force", None)]);
        week(&mut p, &c, &pc, 400_000);
        assert_eq!(p.s.home.as_ref().and_then(|h| h.order.clone()).as_deref(), Some("rec.90"));
    }

    #[test]
    fn after_a_rent_increase_the_new_rent_is_paid_on_the_old_rents_days_and_the_old_order_stopped_after_its_last_payment() {
        // (citizen-rent.test.ts, the first.) Rent on days 0, 30, 60...; notice on day 40 of an increase from day 100.
        let c = ctx(json!({ "bank": "bank" }));
        let mut p = Person::new(&c).unwrap();
        tenant_home(&mut p, 100_000, Some("so-1"));
        in_work(&mut p);
        let mut start = lease("L1", 0, "landlord-1", ME, 100_000, None, true);
        start.push(order("so-1", 0, "L1", 100_000));
        week(&mut p, &c, &pic(DAY, start, &[("L1", "in_force", None)]), 5_000_000);
        let inc = statement("inc-1", 40 * DAY, "rent_increase", "landlord-1", json!({ "lease": "L1", "rent": "105000", "from": 100 * DAY, "was": "100000" }));
        let out = week(&mut p, &c, &pic(40 * DAY, vec![inc], &[]), 5_000_000);
        assert_eq!(out.len(), 1, "{out:?}");
        assert!(out[0].1.contains("80 days") && out[0].1.contains("30 days") && !out[0].1.contains("withdraw"), "{}", out[0].1);
        assert!(out[0].0.contains("more than a third of household income, but we can bear it (up to $1,285.71)"), "{}", out[0].0);
        assert_eq!(p.s.home.as_ref().map(|h| h.rent), Some(105_000));
        for (day, stops) in [(89, false), (90, false), (91, true), (98, false)] {
            let out = week(&mut p, &c, &pic(day * DAY, vec![], &[]), 5_000_000);
            assert_eq!(out.iter().any(|s| s.1.contains("withdraw") && s.1.contains("so-1")), stops, "day {day}: {out:?}");
        }
    }

    #[test]
    fn a_new_lease_on_the_same_home_is_signed_and_paid_from_the_first_of_the_old_days_after_the_old_ends() {
        let c = ctx(json!({ "bank": "bank" }));
        let mut p = Person::new(&c).unwrap();
        tenant_home(&mut p, 100_000, Some("so-1"));
        in_work(&mut p);
        let mut start = lease("L1", 0, "landlord-1", ME, 100_000, None, true);
        start.push(order("so-1", 0, "L1", 100_000));
        week(&mut p, &c, &pic(DAY, start, &[("L1", "in_force", Some(360 * DAY))]), 5_000_000);
        let out = week(&mut p, &c, &pic(300 * DAY, lease("L2", 300 * DAY, "landlord-1", ME, 105_000, Some("L1"), false), &[("L1", "in_force", Some(360 * DAY))]), 5_000_000);
        assert!(out.iter().any(|s| s.1.contains("sign") && s.1.contains("L2") && s.1.contains("60 days")), "{out:?}");
        let h = p.s.home.clone().unwrap();
        assert_eq!((h.agreement.as_str(), h.rent, h.retiring.clone()), ("L2", 105_000, vec![("so-1".to_string(), 331 * DAY)]));
        // (The old lease's end is no end of the new tenancy.)
        let out = week(&mut p, &c, &pic(361 * DAY, vec![], &[("L1", "ended", Some(360 * DAY)), ("L2", "in_force", Some(720 * DAY))]), 5_000_000);
        assert!(p.s.home.is_some() && !out.iter().any(|s| s.1.contains("leave")), "{out:?}");
    }

    #[test]
    fn told_to_vacate_and_going_the_tenant_leaves_on_its_date_on_the_record_and_tells_the_tribunal_it_has_gone() {
        let c = ctx(json!({ "bank": "bank", "possession": { "stay_bps": 0, "obey_bps": 10000 }, "tribunal": { "entity": "tribunal", "challenge_bps": 0, "apply_bps": 0, "apply_after_days": 30 } }));
        let mut p = Person::new(&c).unwrap();
        tenant_home(&mut p, 100_000, Some("so-1"));
        let mut start = lease("L1", 0, "landlord-1", ME, 100_000, None, true);
        start.push(order("so-1", 0, "L1", 100_000));
        week(&mut p, &c, &pic(DAY, start, &[("L1", "in_force", None)]), 0);
        let ntv = statement("ntv-1", 50 * DAY, "notice_to_vacate", "landlord-1", json!({ "lease": "L1", "by": 80 * DAY, "arrears": "200000" }));
        week(&mut p, &c, &pic(50 * DAY, vec![ntv], &[]), 0);
        let v = p.s.home.as_ref().and_then(|h| h.vacate.clone()).expect("told to vacate");
        assert_eq!((v.by, v.stays), (80 * DAY, false));
        assert!(week(&mut p, &c, &pic(79 * DAY, vec![], &[]), 0).is_empty(), "not before its date");
        let out = week(&mut p, &c, &pic(80 * DAY, vec![], &[]), 0);
        assert!(out.iter().any(|s| s.1.contains("notice") && s.1.contains("L1") && s.0.contains("given notice to vacate")), "{out:?}");
        assert!(out.iter().any(|s| s.1.contains("occupancy") && s.1.contains("leave") && s.1.contains("so-1")), "{out:?}");
        assert!(p.s.home.is_none() && p.s.homeless_since == Some(80 * DAY));
        let hn = statement("hn-1", 90 * DAY, "hearing_notice", "tribunal", json!({ "kind": "possession", "against": ME, "about": "L1", "application": "app-1" }));
        let out = week(&mut p, &c, &pic(90 * DAY, vec![hn], &[]), 0);
        assert!(out.iter().any(|s| s.1.contains("tribunal_response") && s.1.contains("We are not there")), "{out:?}");
    }

    #[test]
    fn a_title_that_came_down_a_chain_is_ours_only_if_each_hand_that_passed_it_on_held_it() {
        // (citizen-land.test.ts.)
        let c = ctx(json!({}));
        let mut p = Person::new(&c).unwrap();
        let title = rec(json!({ "id": "T1", "record": "claim", "author": "genesis", "speaks_for": "registry", "at": 0, "visible_to": "public", "position": "right", "holder": "a", "about": { "kind": "ownership", "object": "lot-1" } }));
        let tr = |id: &str, at: i64, by: &str, to: &str| rec(json!({ "id": id, "record": "claim_transfer", "author": by, "speaks_for": by, "at": at, "visible_to": "public", "claim": "T1", "to": to }));
        p.book.take_all(&[title, tr("rec.2", 1, "a", "b"), tr("rec.3", 2, "b", ME)]);
        assert_eq!(p.our_titles(), vec![("T1".to_string(), "lot-1".to_string())]);
        let mut q = Person::new(&c).unwrap();
        let title = p.book.get("T1").unwrap().clone();
        q.book.take_all(&[title, tr("rec.2", 1, "x", "b"), tr("rec.3", 2, "b", ME)]);
        assert!(q.our_titles().is_empty(), "x never held it: b's passing it on is nothing");
        assert_eq!(loan_for(30_000_001, 2_000), 24_000_000, "the deposit rounded up to a whole unit");
    }
}
