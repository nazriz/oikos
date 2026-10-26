//! What a person takes in from every observation (citizen.ts `absorb`, 1246-1563; `learnFromInitialRecords`,
//! 1221-1242): the book, debts paid to us, what happens at work (a rise, hours, a stoppage and the return), the home's
//! building and its bin, money in (pay, pay come short, what our own business pays us), the market's answers, the
//! household's record and sayings, a payment of rent that failed, letters (what is the mind's goes to it; an office's
//! letter is kept, a lead is noted), and what our last acts made (a move in, a standing order).
//!
//! What another part acts on is left here for it, in `Absorbed` (the part named on each field). Decided fresh
//! (docs/port-guide.md, section 2): a house sale's money and a purchase loan's principal are told apart from the book
//! alone (our own listing's buyer; a loan for "their home, "), not from the housing part's state; a lead is a reply that
//! cites no record we hold and the mind did not take (TS also asked whether we had asked around: that is the mind's).

use super::household::hear;
use super::mind::{Event, Heard, Outcome, Way};
use super::params::Params;
#[allow(unused_imports)]
use super::person::{Job, Missed, Person, Said, Todo, Week};
use crate::common::letters::PAYMENT_FAILED;
use crate::common::{addressed_to, bases_of, cites, data, kind, office_note, Fields, DAY};
use crate::papers::agreements::{commitment_of, job_terms, lease_terms, other_party, parties_of, template_of};
use crate::Cx;
use oikos_sight::{Picture, Record, RecordBody, Seen, SiteStructure, VariableView};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// A cut of our hours our employer asks us to agree to (work's `hours_asked` answers it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HoursAsked {
    pub notice: String,
    pub agreement: String,
    pub wage: i64,
    pub from: i64,
    pub consent_bps: i64,
    /// The hours a week it names, in tenths of an hour (TS: hours to one decimal).
    pub hours_tenths: i64,
}

/// The bin at home as last seen (recourse's complaints read it).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinSeen {
    pub structure: String,
    pub value: i64,
    pub emptied_at: i64,
    pub at: i64,
    pub view: Option<VariableView>,
    /// Where waste is held at home (law 8): the units we have used up at home since we last looked, and what a unit
    /// leaves in the bin as we have seen it (kilograms, in thousandths), to tell an emptied bin from one we filled again.
    #[serde(default)]
    pub units: i64,
    #[serde(default)]
    pub per_unit_milli: i64,
}

/// This part's own memory: what absorb took in for the parts that act on it (each field says whose it is).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Absorbed {
    /// The records new to the book since the last plan, in the order taken in (TS `fresh`; the plan's parts read it,
    /// and it is cleared when a plan is made: `take_fresh`).
    pub fresh: Vec<String>,
    /// A debt owed us -> what has been paid against it (recourse and money read it).
    pub settled_to_us: BTreeMap<String, i64>,
    /// The stoppage is over: back into the workplace we left (employer, space) (work).
    pub back_to: Option<(String, String)>,
    /// Cuts of hours asked of us (work's `hours_asked` drains it).
    pub hours_asked: Vec<HoursAsked>,
    /// Our home's building, as we last saw it (recourse, housing).
    pub home_site: Option<std::sync::Arc<SiteStructure>>,
    pub bin_seen: BinSeen,
    /// What our own business has paid us, kept as long as we judge it by (work's ventures).
    pub drawn_log: Vec<(i64, i64)>,
    /// A business we have just founded, with its capital: its id comes back in the outcome (work sets it, absorb reads
    /// the answer into `founded_firm` or `firm_refused`).
    pub pending_firm: Option<i64>,
    pub founded_firm: Option<String>,
    pub firm_refused: bool,
    /// Shops whose prices we know from looking them up (money's shopping).
    pub looked_up: BTreeSet<String>,
    /// The listings of homes for sale, as the last look at the board answered, and when (housing).
    pub on_sale: Option<Vec<String>>,
    pub sale_seen_at: i64,
    /// A household member told us of a death at home (person, space) (lifecycle drains it).
    pub told_dead: Vec<(String, String)>,
    /// A lease on a home we found under water (housing ends it).
    pub uninhabitable: Option<String>,
    /// A rent standing order just set up for this lease: its id comes back in the outcome (housing sets it).
    pub pending_rent_order: Option<String>,
    /// Offers of a lease addressed to us that succeed a tenant who has died (their basis the old lease): housing signs
    /// them (the bug hunt of 2026-10-17, #3; firm.landlord 0.20.0).
    pub succession_offers: BTreeSet<String>,
}

impl Absorbed {
    pub fn new(_p: &Params, _cx: &mut Cx) -> Self {
        Absorbed { sale_seen_at: -1, bin_seen: BinSeen { emptied_at: -1, at: -1, ..Default::default() }, ..Default::default() }
    }
}

/// Facts for an outcome, in key order.
fn facts<const N: usize>(kv: [(&str, Value); N]) -> BTreeMap<String, Value> {
    kv.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
}

fn outcome(domain: &str, option: &str, kind: &str, way: Way, facts: BTreeMap<String, Value>, payoff: Option<i64>) -> Outcome {
    Outcome { domain: domain.into(), option: option.into(), kind: kind.into(), way, facts, payoff, ..Default::default() }
}

/// An agreement's words (empty where it has none).
fn terms_text(r: &Record) -> &str {
    match &r.body {
        RecordBody::Agreement { terms } => terms.text.as_deref().unwrap_or(""),
        _ => "",
    }
}

/// The friction dial (frictions.ts `frictionDial`): the world's `dials.friction_bps`, none below nought.
fn friction_dial(cx: &Cx) -> i64 {
    cx.ctx.world.dials.get("friction_bps").and_then(crate::papers::lenient::whole).unwrap_or(0).max(0)
}

/// Whether a bank's words for a payment say it was wages (citizen.ts: /wage|salar|\bpay\b|day's work/i).
fn as_wages(memo: &str) -> bool {
    let m = memo.to_lowercase();
    let word_pay = m.match_indices("pay").any(|(i, _)| {
        let before = m[..i].chars().next_back().is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
        let after = m[i + 3..].chars().next().is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
        before && after
    });
    m.contains("wage") || m.contains("salar") || word_pay || m.contains("day's work")
}

// ------------------------------------------------------------------ what is withheld from a pay (tax.ts)
// (Ported here for the worker's own check of their pay: tax.ts `incomeTaxLaw`, `taxLawOf`, `chargesOn`, `withheld`,
// `dayPayPeriod`. It belongs with the shared rules, `oikos_rules::withholding`, once that is written.)

const YEAR: i64 = 365 * DAY;

/// The income tax law in force that we have seen, as its charges (none: no income tax).
fn income_tax_law(book: &crate::common::Book) -> Option<Vec<Value>> {
    let mut laws: Vec<&Record> = book
        .open("law")
        .map(|r| r.as_ref())
        .filter(|r| data(r).s("tax") == Some("income") && (data(r).get("brackets").is_some_and(Value::is_array) || data(r).get("charges").is_some_and(Value::is_array)))
        .collect();
    laws.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| b.id.cmp(&a.id)));
    let d = data(laws.first()?);
    if let Some(c) = d.get("charges").and_then(Value::as_array) {
        return Some(c.clone());
    }
    let brackets = d.get("brackets")?.clone();
    let mut charges = vec![json!({ "id": "income-tax", "schedule": brackets })];
    let levy = d.i("levy_bps").unwrap_or(0);
    if levy > 0 {
        charges.push(json!({ "id": "levy", "base": { "from": d.i("levy_from").unwrap_or(0) }, "schedule": [{ "from": 0, "rate_bps": levy }] }));
    }
    Some(charges)
}

fn allowance(a: &Value, pay: i64) -> i64 {
    let amount = a.i("amount").unwrap_or(0);
    let taper = a.get("tapers").map_or(0, |t| {
        let above = t.i("above").unwrap_or(0);
        if pay > above {
            (pay - above) * t.i("bps").unwrap_or(0) / 10_000
        } else {
            0
        }
    });
    (amount - taper).max(0)
}

/// A schedule's charge on a base, each band rounded down.
fn scheduled(schedule: &[Value], base: i64) -> i64 {
    let mut bands: Vec<(i64, i64, Option<i64>)> = schedule.iter().map(|b| (b.i("from").unwrap_or(0), b.i("rate_bps").unwrap_or(0), b.i("rising_to_bps"))).collect();
    bands.sort_by_key(|b| b.0);
    let mut due = 0;
    for (i, &(from, rate, rising)) in bands.iter().enumerate() {
        let top = bands.get(i + 1).map(|b| b.0);
        if base <= from {
            continue;
        }
        let part = top.map_or(base, |t| base.min(t)) - from;
        match (rising, top) {
            (Some(to), Some(top)) => {
                let (width, x) = (i128::from(top - from), i128::from(part));
                due += ((x * (2 * i128::from(rate) * width + i128::from(to - rate) * x)) / (2 * width * 10_000)) as i64;
            }
            _ => due += part * rate / 10_000,
        }
    }
    due
}

/// What each charge takes of a year's pay, in the law's order.
fn charges_on(charges: &[Value], pay: i64) -> Vec<i64> {
    fn of(id: &str, charges: &[Value], pay: i64, done: &mut BTreeMap<String, i64>, doing: &mut BTreeSet<String>) -> i64 {
        if let Some(v) = done.get(id) {
            return *v;
        }
        let Some(c) = charges.iter().find(|c| c.s("id") == Some(id)) else { return 0 };
        if doing.contains(id) {
            return 0;
        }
        doing.insert(id.to_string());
        let b = c.get("base").cloned().unwrap_or(Value::Null);
        let on = b.s("on").map(String::from);
        let mut amount = 0;
        if on.is_some() || pay >= b.i("from").unwrap_or(0) {
            let mut base = match &on {
                Some(o) => of(o, charges, pay, done, doing),
                None => pay,
            };
            if let Some(u) = b.i("up_to") {
                base = base.min(u);
            }
            for d in b.get("less").and_then(Value::as_array).into_iter().flatten() {
                if let Some(cs) = d.get("charges").and_then(Value::as_array) {
                    for o in cs.iter().filter_map(Value::as_str) {
                        base -= of(o, charges, pay, done, doing);
                    }
                } else if let Some(s) = d.i("share_bps") {
                    base -= (pay * s / 10_000).max(d.i("least").unwrap_or(0)).min(d.i("most").unwrap_or(i64::MAX));
                } else {
                    base -= allowance(d, pay);
                }
            }
            base = base.max(0);
            amount = scheduled(c.get("schedule").and_then(Value::as_array).map_or(&[], |v| v.as_slice()), base);
            for r in c.get("reliefs").and_then(Value::as_array).into_iter().flatten() {
                amount = match r.i("none_due_up_to") {
                    Some(n) => {
                        if base <= n {
                            0
                        } else {
                            amount
                        }
                    }
                    None => (amount - allowance(r, pay)).max(0),
                };
            }
        }
        doing.remove(id);
        done.insert(id.to_string(), amount);
        amount
    }
    let (mut done, mut doing) = (BTreeMap::new(), BTreeSet::new());
    charges.iter().map(|c| of(c.s("id").unwrap_or(""), charges, pay, &mut done, &mut doing)).collect()
}

/// What is withheld from a pay of `gross` every `period` seconds (tax.ts `withholding`): none without a law.
pub fn withholding(law: Option<&[Value]>, gross: i64, period: i64) -> i64 {
    let Some(law) = law else { return 0 };
    if gross <= 0 || period <= 0 {
        return 0;
    }
    let yearly = (i128::from(gross) * i128::from(YEAR) / i128::from(period)) as i64;
    let year: i64 = charges_on(law, yearly).iter().sum();
    (i128::from(year) * i128::from(period) / i128::from(YEAR)) as i64
}

/// The span a day's pay is reckoned over (tax.ts `dayPayPeriod`): the week over its working days.
pub fn day_pay_period(work_days: i64) -> i64 {
    let d = work_days.clamp(1, 7);
    (2 * 7 * DAY + d) / (2 * d)
}

impl Person {
    /// The records new since the last plan (the plan's parts read them; the plan clears them when done).
    pub fn take_fresh(&mut self) -> Vec<String> {
        std::mem::take(&mut self.absorbed.fresh)
    }

    /// What was in force when we first looked (the world's genesis records): our home, our job, a share of the rent.
    /// (Whether we belong to a union at the start is the world's: the mind's union part reads it.)
    pub fn learn_from_initial_records(&mut self, _w: &mut Week) {
        let me = self.me.clone();
        for r in self.book.of_type("agreement") {
            if !parties_of(r).contains(&me) || !self.book.in_force(&r.id) {
                continue;
            }
            let since = self.book.signed_at(&r.id).unwrap_or(0);
            let other = other_party(r, &me).unwrap_or_default().to_string();
            if template_of(r) == Some("lease") && self.s.home.is_none() {
                let lt = lease_terms(r, &me);
                let order = self
                    .book
                    .all("request")
                    .find(|x| cites(x, &r.id) && x.speaks_for.as_deref() == Some(me.as_str()))
                    .map(|x| x.id.clone());
                self.s.home = Some(super::person::Home {
                    agreement: r.id.clone(),
                    space: lt.space.unwrap_or_default(),
                    structure: lt.structure.unwrap_or_default(),
                    landlord: other.clone(),
                    rent: lt.rent,
                    order,
                    moved_in: true,
                    ..Default::default()
                });
            }
            if template_of(r) == Some("employment") && self.s.job.is_none() {
                let jt = job_terms(r, &me, Some(&self.book));
                self.s.job = Some(Job { agreement: r.id.clone(), employer: other, wage: jt.wage, period: jt.period, workplace: jt.workplace, since, ..Default::default() });
            }
        }
        // Another adult's share of the rent, if one is already standing.
        let mine = self.book.all("request").find(|r| {
            r.speaks_for.as_deref() == Some(me.as_str()) && data(r).get("outcome").and_then(|o| o.get("money")).and_then(|m| m.s("for")) == Some("Household share of the rent.")
        });
        if let (Some(r), None) = (mine, &self.s.share) {
            let cents = data(r)["outcome"]["money"].i("amount").unwrap_or(0);
            self.s.share = Some((cents, Some(r.id.clone())));
        }
    }
}

impl Person {
    /// Everything we observe, at every wake, before anything else (citizen.ts `absorb`).
    pub fn absorb(&mut self, pic: &Picture, cx: &mut Cx) {
        let fresh = self.book.absorb(pic);
        self.absorbed.fresh.extend(fresh.iter().map(|r| r.id.clone()));
        let t = pic.t;
        let mut w = Week { pic, cx, t, acc: crate::common::money::own_banked(pic, &self.me), steps: vec![] };
        let me = self.me.clone();
        // What's paid to us against a debt owed us (by the debtor, or its bank under a garnishee order).
        if let Some(acc) = &w.acc {
            for tx in pic.transactions() {
                if let Some(debt) = tx.settles.as_ref().filter(|_| tx.from != tx.to && tx.to == acc.account) {
                    *self.absorbed.settled_to_us.entry(debt.clone()).or_insert(0) += crate::common::cents(tx.amount);
                }
            }
        }
        // The payment that pays our mortgage off, seen made.
        if let (Some(acc), Some(loan)) = (&w.acc, self.housing.paying_off.clone()) {
            if pic.transactions().any(|tx| tx.from == acc.account && tx.settles.as_deref() == Some(loan.as_str())) {
                self.housing.paying_off = None;
            }
        }
        self.at_work(&mut w, &fresh);
        self.home_seen(pic);
        self.firm_founded(&mut w);
        // A change of our hours the employer's paper named: from its day, the pay agreed is the paper's (for a few days
        // after, the old pay is still taken as pay too, as the employer changes the order on a day of its own).
        if let Some(j) = self.s.job.as_mut() {
            if let Some((at, wage)) = j.coming.filter(|c| t >= c.0) {
                j.prev = Some((j.wage, at + 3 * DAY));
                j.wage = wage;
                j.coming = None;
            }
        }
        self.money_in(&mut w);
        self.market_answers(pic);
        self.letters(&mut w);
        self.what_we_did(&mut w);
        // Offers of a tenancy addressed to us, succeeding a tenant who has died (the landlord's offer, firm.landlord
        // 0.20.0: its words say "succeeding <who> (lease <id>)", its basis the old lease): the housing part signs.
        for r in &fresh {
            if template_of(r) != Some("lease") || !parties_of(r).contains(&me) || self.book.signed_by(&r.id, &me) || self.book.taken_back(&r.id) {
                continue;
            }
            let text = terms_text(r);
            if text.contains(" succeeding ") && bases_of(r).iter().any(|b| text.contains(&format!("(lease {b})"))) {
                self.absorbed.succession_offers.insert(r.id.clone());
            }
        }
    }

    /// At work (docs/behaviour/unions.md), taken in as it's seen, before the money that comes with it: a rise in an
    /// enterprise agreement (paid from the next pay day), hours cut or restored, a stoppage called, and the return.
    fn at_work(&mut self, w: &mut Week, fresh: &[std::sync::Arc<Record>]) {
        let me = self.me.clone();
        let t = w.t;
        for r in fresh {
            if !matches!(r.body, RecordBody::Statement { .. }) {
                continue;
            }
            let Some(job) = self.s.job.clone() else { continue };
            let d = data(r);
            let k = kind(r).unwrap_or("");
            if k == "enterprise_agreement" && d.s("employer") == Some(job.employer.as_str()) && r.at >= job.since {
                let rise = d.i("rise_bps").unwrap_or(0);
                let wage = job.wage * (10_000 + rise) / 10_000;
                if let Some(j) = self.s.job.as_mut() {
                    j.wage = wage;
                    j.paid_at = Some(t);
                }
                // (Read at work some days after it was made: a pay at the new rate that came before we had read of the
                // rise was our wages as agreed, and counts as that now, as it would have had we known.)
                let net = wage - withholding(income_tax_law(&self.book).as_deref(), wage, job.period);
                self.tell(w, outcome("job", &job.employer, "rise", Way::Published, facts([("rise_bps", json!(rise)), ("wage", json!(wage)), ("made_at", json!(r.at))]), None));
                for (at, amount) in self.s.inflows.clone() {
                    if at >= r.at && (amount == wage || amount == net) {
                        let f = facts([("amount", json!(amount)), ("agreed", json!(wage)), ("paid_at", json!(at))]);
                        self.tell(w, outcome("job", &job.employer, "paid", Way::Mine, f, Some(10_000)));
                    }
                }
                // It paid: the union's members learn what belonging is worth (the mind feels it).
                if let Some(u) = self.p.union.clone().filter(|u| self.member_of(u)) {
                    let payoff = (6_000 + rise * 10).min(10_000);
                    let f = facts([("employer", json!(job.employer)), ("rise_bps", json!(rise)), ("union", json!(u))]);
                    self.tell(w, outcome("membership", "member", "rise_won", Way::Published, f, Some(payoff)));
                }
            }
            if !addressed_to(r).contains(&me) {
                continue;
            }
            // Our hours cut, asked or restored, by our employer's paper (docs/behaviour/firms.md, "Hours before heads"):
            // a cut we are told of, or have agreed to, is the pay agreed from the day it names, and not pay come short.
            if (k == "hours_notice" || k == "hours_restored") && d.s("employer") == Some(job.employer.as_str()) && d.s("agreement") == Some(job.agreement.as_str()) {
                if let (Some(wage), Some(from)) = (d.i("wage"), d.i("from")) {
                    let minutes = d.i("minutes_week").unwrap_or(0);
                    if k == "hours_notice" && d.get("consent") == Some(&Value::Bool(true)) {
                        // (Hours to a tenth, as TS's Math.round(minutes / 6) / 10: half away from zero.)
                        self.absorbed.hours_asked.push(HoursAsked {
                            notice: r.id.clone(),
                            agreement: job.agreement.clone(),
                            wage,
                            from,
                            consent_bps: d.i("consent_bps").unwrap_or(10_000),
                            hours_tenths: (minutes.max(0) + 3) / 6,
                        });
                    } else {
                        if let Some(j) = self.s.job.as_mut() {
                            j.coming = Some((from, wage));
                        }
                        let what = if k == "hours_notice" { "hours_cut" } else { "hours_restored" };
                        let f = facts([("minutes_week", json!(minutes)), ("wage", json!(wage)), ("was", json!(job.wage)), ("from", json!(from)), ("made_at", json!(r.at))]);
                        self.tell(w, outcome("job", &job.employer, what, Way::Published, f, None));
                    }
                }
            }
            if k == "stop_work" && d.s("employer") == Some(job.employer.as_str()) && self.s.striking.is_none() {
                self.s.striking = Some((job.employer.clone(), false, None));
                // (Pay lost for the time out.)
                if self.p.union.clone().is_some_and(|u| self.member_of(&u)) {
                    self.tell(w, outcome("membership", "member", "stoppage_called", Way::Mine, facts([("employer", json!(job.employer))]), Some(3_000)));
                }
            }
            if k == "return_to_work" {
                if let Some((employer, _, left)) = self.s.striking.clone().filter(|s| d.s("employer") == Some(s.0.as_str())) {
                    self.absorbed.back_to = left.map(|space| (employer, space));
                    self.s.striking = None;
                    // (Our pay restarts from now: none for the time on strike.)
                    if let Some(j) = self.s.job.as_mut() {
                        j.paid_at = Some(t);
                    }
                }
            }
        }
    }

    /// Our home's building, and the bin at home each time we see it: emptied if there's less in it than last time.
    /// (Emptied since we last looked, if there's well under what there would be had nobody come: less than last time
    /// misses it for a household that looks weekly, at the same point of each week's round. When, we reckon from what's
    /// in it now, no earlier than our last look.)
    fn home_seen(&mut self, pic: &Picture) {
        let Some(home) = self.s.home.clone() else { return };
        let t = pic.t;
        // The bin at home, where waste is a kind we hold (law 8, foundations-2 C4): emptied when we hold less of it than
        // when we last looked.
        let held: Option<i64> = pic.channels.values().find_map(|ch| match ch {
            Seen::Holdings { holdings, .. } => Some(holdings.iter().filter(|h| h.kind == self.p.complain_about && h.at == home.structure).map(|h| crate::common::cents(h.quantity)).sum()),
            _ => None,
        });
        if let Some(now) = held.filter(|_| self.p.complain_about_held) {
            let bin = &mut self.absorbed.bin_seen;
            // (What it would hold had nobody come: what it held, and what our use since added. Well under that, or under
            // what it held: emptied. Over what it held and nobody came: what a unit leaves in it, learned.)
            let expected = bin.value + bin.units * bin.per_unit_milli / 1000;
            if bin.structure != home.structure {
                bin.structure = home.structure.clone();
                bin.emptied_at = t;
            } else if now == 0 || now < bin.value || (bin.units > 0 && bin.per_unit_milli > 0 && now * 10 < expected * 6) {
                // (A bin with nothing in it is as good as emptied: nothing has waited in it. Without this a household
                // that had thrown nothing out for a fortnight counted the fortnight against its first bag.)
                bin.emptied_at = t;
            } else if bin.units > 0 && now > bin.value {
                bin.per_unit_milli = (now - bin.value) * 1000 / bin.units;
            }
            bin.units = 0;
            bin.value = now;
            bin.at = t;
            bin.view = None;
        }
        for ch in pic.channels.values() {
            let Seen::Sites { cells, .. } = ch else { continue };
            for c in cells.iter() {
                let Some(st) = c.structure.as_ref().filter(|s| s.structure == home.structure) else { continue };
                self.absorbed.home_site = Some(st.clone());
                let view = st.variables.as_ref().and_then(|v| v.get(&self.p.complain_about)).cloned();
                // (Where what is complained of is a kind we hold at home (waste: law 8), the bin is what we hold of it there.)
                if view.is_none() {
                    continue;
                }
                let now = view.as_ref().map_or(0, |v| crate::common::variable_today(v, t));
                let bin = &mut self.absorbed.bin_seen;
                if bin.structure != home.structure {
                    bin.structure = home.structure.clone();
                    bin.emptied_at = t;
                } else if let Some(before) = bin.view.as_ref().filter(|_| t - bin.at >= DAY) {
                    let untouched = crate::common::variable_today(before, t);
                    if now < bin.value || now * 10 < untouched * 6 {
                        let per_day = view.as_ref().map_or(1, |v| v.per_day).max(1);
                        bin.emptied_at = bin.at.max(t - (now * DAY).div_euclid(per_day));
                    }
                } else if now < bin.value {
                    bin.emptied_at = t;
                }
                bin.value = now;
                bin.at = t;
                bin.view = view;
            }
        }
    }

    /// A business we have just founded: its id, or its refusal, in what our act came to.
    fn firm_founded(&mut self, w: &mut Week) {
        let Some(capital) = self.absorbed.pending_firm else { return };
        let pic = w.pic;
        if let Some(id) = pic.outcomes.iter().find_map(|o| o.created.as_ref().and_then(|c| c.get("firm")).cloned()) {
            self.absorbed.pending_firm = None;
            self.absorbed.founded_firm = Some(id.clone());
            self.tell(w, outcome("venture", "found", "founded", Way::Mine, facts([("firm", json!(id)), ("capital", json!(capital))]), None));
        } else if let Some(o) = pic.outcomes.iter().find(|o| o.status == oikos_sight::OutcomeStatus::Refused) {
            let why = o.refusal.as_ref().map(|r| refusal_code(r.code)).unwrap_or_default();
            self.absorbed.pending_firm = None;
            self.absorbed.firm_refused = true;
            self.tell(w, outcome("venture", "found", "refused", Way::Mine, facts([("why", json!(why))]), None));
        }
    }

    /// Money that came in from others, for what our income is: our pay as agreed, pay come short, what our own
    /// business paid us. (A home's price, paid us for one we're selling, and a loan's principal for a home we're
    /// buying aren't income: they're the home's.)
    fn money_in(&mut self, w: &mut Week) {
        let pic = w.pic;
        let t = w.t;
        let me = self.me.clone();
        let mine: BTreeSet<&str> = pic.accounts().filter(|a| a.holder == me).map(|a| a.account.as_str()).collect();
        let law = income_tax_law(&self.book);
        let dial = friction_dial(w.cx);
        let work_days = self.p.round.map_or(5, |r| r.work_days);
        for tx in pic.transactions() {
            if !mine.contains(tx.to.as_str()) || mine.contains(tx.from.as_str()) {
                continue;
            }
            let amount = crate::common::cents(tx.amount);
            // A home's price paid us for one we're selling, or the principal of the loan for one we're buying, is the home's.
            if self.home_money_in(&tx.from, amount, tx.settles.as_deref()) {
                continue;
            }
            self.s.inflows.push((tx.t, amount));
            if let Some(ow) = self.s.own_work.clone().filter(|o| tx.from == o.account) {
                self.s.drawings.push((tx.t, amount));
                self.absorbed.drawn_log.push((tx.t, amount));
                // (For the record: what our own business paid us. The mind makes nothing of it; it follows no decision.)
                self.tell(w, outcome("own_work", &ow.firm, "drawn", Way::Mine, facts([("amount", json!(amount)), ("paid_at", json!(tx.t))]), None));
            }
            let Some(job) = self.s.job.clone() else { continue };
            // Our wages, as agreed: the wage, less the income tax the law says our employer withholds. (A day's pay for
            // work by the day: less what the law takes from a day's pay, reckoned over the working week.)
            let period = if job.period == DAY { day_pay_period(work_days) } else { job.period };
            let as_agreed = |wage: i64| amount == wage || amount == wage - withholding(law.as_deref(), wage, period);
            if as_agreed(job.wage) || job.prev.is_some_and(|(wage, until)| tx.t < until && as_agreed(wage)) {
                let since = tx.t - job.paid_at.unwrap_or(job.since);
                if let Some(j) = self.s.job.as_mut() {
                    j.paid_at = Some(tx.t);
                    j.paid_from = Some(tx.from.clone());
                }
                // (Days of the period rounded half up, as TS's Math.round.)
                let f = facts([
                    ("amount", json!(amount)),
                    ("agreed", json!(job.wage)),
                    ("paid_at", json!(tx.t)),
                    ("days_since_last", json!(since.div_euclid(DAY))),
                    ("period_days", json!((job.period + DAY / 2).div_euclid(DAY))),
                ]);
                self.tell(w, outcome("job", &job.employer, "paid", Way::Mine, f, Some(10_000)));
            } else if dial > 0 && job.period > DAY {
                // Pay that comes short of what was agreed (docs/behaviour/frictions.md): from our employer's account,
                // by a standing order, said to be wages (or saying nothing of what it is for), less than the wage after
                // what the law withholds, and not so little that it is something else. The difference is owed us.
                let from = job.paid_from.clone().or_else(|| {
                    self.book.get(&job.agreement).and_then(|a| commitment_of(a, &job.employer).0).and_then(|o| o.money).and_then(|m| m.from)
                });
                let net = job.wage - withholding(law.as_deref(), job.wage, job.period);
                let wages = tx.memo.as_deref().is_none_or(|m| m.is_empty() || as_wages(m));
                if from.as_deref() == Some(tx.from.as_str()) && tx.per_instruction.is_some() && wages && amount < net && amount * 2 >= net {
                    if let Some(j) = self.s.job.as_mut() {
                        j.paid_at = Some(tx.t);
                        j.short = Some(j.short.unwrap_or(0) + net - amount);
                    }
                    let f = facts([("amount", json!(amount)), ("agreed", json!(net)), ("short", json!(net - amount)), ("paid_at", json!(tx.t))]);
                    self.tell(w, outcome("job", &job.employer, "short", Way::Mine, f, Some(6_000)));
                }
            }
        }
        let window = t - self.p.income_window_days * DAY;
        self.s.inflows.retain(|x| x.0 >= window);
        self.s.drawings.retain(|x| x.0 >= window);
    }

    /// What the market's searches answered (a channel searched now: the view shows a search only when answered).
    fn market_answers(&mut self, pic: &Picture) {
        if let Some(Seen::Records { records, search: true }) = pic.channels.get(&self.p.adverts) {
            self.absorbed.looked_up.extend(records.iter().filter_map(|r| r.speaks_for.clone()));
        }
        if let Some(Seen::Records { records, search: true }) = pic.channels.get(&self.p.sale_board) {
            self.absorbed.on_sale = Some(records.iter().map(|r| r.id.clone()).collect());
            self.absorbed.sale_seen_at = pic.t;
        }
        let leads = self.s.looking == Some(super::person::Looking::Leads);
        for k in ["homes", "jobs", "petitions"] {
            let Some(Seen::Records { records, search: true }) = pic.channels.get(k) else { continue };
            let ids: Vec<String> = records.iter().map(|r| r.id.clone()).collect();
            match (k, leads) {
                ("homes", true) => self.s.lead_homes = ids,
                ("jobs", true) => self.s.lead_jobs = ids,
                ("homes", false) => self.s.found_homes = ids,
                ("jobs", false) => self.s.found_jobs = ids,
                _ => self.s.found_petitions = ids,
            }
        }
    }

    /// The household's record, and words from people: a payment of rent the bank could not make, what the household
    /// says, and the rest to the mind; what the mind does not take is an office's letter (kept) or a lead.
    fn letters(&mut self, w: &mut Week) {
        let me = self.me.clone();
        let pic = w.pic;
        let rec = household_of(&self.book, &me);
        self.s.household_record = rec.as_ref().map(|r| r.0.clone());
        self.s.household = rec.map(|r| r.1);
        for m in &pic.inbox {
            // The bank couldn't make a payment of our rent (or our share of it): we still owe it.
            let home = self.s.home.as_ref();
            let share_order = self.s.share.as_ref().and_then(|s| s.1.clone());
            let ours: Vec<String> = home.and_then(|h| h.order.clone()).into_iter().chain(share_order.clone()).chain(home.into_iter().flat_map(|h| h.retiring.iter().map(|x| x.0.clone()))).collect();
            if let Some(re) = m.re.as_ref().filter(|re| ours.contains(re) && PAYMENT_FAILED::is(&m.text).is_some()) {
                let money = self.book.get(re).map(|r| data(r)["outcome"]["money"].clone()).unwrap_or(Value::Null);
                if let (Some(to), Some(amount)) = (money.s("to"), money.i("amount")) {
                    let what = if share_order.as_deref() == Some(re.as_str()) { "our share of the rent" } else { "the rent" };
                    self.s.missed.push(super::person::Missed { instruction: re.clone(), to: to.into(), amount, what: what.into() });
                }
                continue;
            }
            // What a member of the household says, in our own phrasing.
            let from = self.s.household.as_ref().and_then(|h| h.members.iter().find(|x| x.participant.as_deref() == Some(m.from.as_str()) && x.person != me).cloned());
            if let Some(from) = from {
                match hear(&m.text, &w.cx.ctx.world) {
                    Some(Said::Died { person, space }) => {
                        self.absorbed.told_dead.push((person, space));
                        continue;
                    }
                    Some(Said::Trouble { what, by }) => {
                        // (Told the household's trouble: the mind holds it with us, where it has initiative. TS kept it
                        // for the plan; told now, at the moment it is heard.)
                        if self.mind.initiative() {
                            let with = self.s.household.as_ref().map(|h| h.leaseholder.clone());
                            self.happened(w, Event::HouseholdTrouble { what, by, with });
                        }
                        continue;
                    }
                    Some(said) => {
                        self.s.heard.push((from.person.clone(), said));
                        continue;
                    }
                    None => {}
                }
            }
            // Who wrote (the directory names their person).
            let person = m.from_entity.clone().or_else(|| self.book.person_of(&m.from).map(String::from)).unwrap_or_else(|| m.from.clone());
            let heard = self.happened(w, Event::Talk { from: m.from.clone(), person, text: m.text.clone(), re: m.re.clone() });
            if heard != Heard::NotMine {
                continue;
            }
            // A letter from an office, in words of its own (docs/behaviour/letters.md, "A letter to a person"): read
            // and kept, and on our record that the office wrote, about what paper if it says. We cannot tell what it
            // asks, and do not pretend to: nothing is done on it and nothing is answered.
            let reply_to_asking = m.re.as_ref().is_some_and(|re| !self.book.has(re));
            let office = m.from_position.as_ref().and_then(|p| m.from_entity.clone().or_else(|| self.book.position(p).map(|x| x.entity.clone())));
            if let Some(office) = office.filter(|o| *o != me && !office_note(&m.text) && !reply_to_asking) {
                let size = (m.text.chars().count() as i64).min(10_000);
                let mut f = facts([("characters", json!(m.text.chars().count()))]);
                if let Some(re) = &m.re {
                    f.insert("about".into(), json!(re));
                }
                self.happened(w, Event::Other { what: "office_wrote".into(), about: Some(office.clone()), facts: facts([("size", json!(size))]) });
                let mut o = outcome("letter", &office, "received", Way::Mine, f, None);
                o.from = Some(office);
                self.tell(w, o);
                continue;
            }
            // A place someone names in reply to our asking around (not a reply about a record: those are institutions
            // answering requests).
            if let Some(re) = m.re.as_ref().filter(|_| reply_to_asking) {
                self.s.leads.retain(|x| x != re);
                self.s.leads.push(re.clone());
                let n = self.s.leads.len();
                if n > 5 {
                    self.s.leads.drain(..n - 5);
                }
                let who = m.from_entity.clone().or_else(|| self.book.person_of(&m.from).map(String::from)).unwrap_or_else(|| m.from.clone());
                self.s.lead_from.insert(re.clone(), who);
            }
        }
    }

    /// What our last acts came to: the move in we just attempted, a rent share's standing order, a rent's.
    fn what_we_did(&mut self, w: &mut Week) {
        let pic = w.pic;
        if self.s.moving && self.s.last_was_move {
            if let Some(last) = pic.outcomes.last() {
                if last.status == oikos_sight::OutcomeStatus::Applied {
                    if let Some(h) = self.s.home.as_mut() {
                        h.moved_in = true;
                    }
                }
                let code = last.refusal.as_ref().map(|r| refusal_code(r.code)).unwrap_or_default();
                if let Some(h) = self.s.home.clone().filter(|h| !h.owned) {
                    let (k, f) = if h.moved_in { ("moved_in", BTreeMap::new()) } else { ("not_in_yet", facts([("why", json!(code))])) };
                    self.tell(w, outcome("home", &h.space, k, Way::Mine, f, None));
                    // (Under water: not a home anyone can live in. We end the lease, as a tenant of uninhabitable
                    // premises may.)
                    if code == "flooded" {
                        self.absorbed.uninhabitable = Some(h.agreement.clone());
                    }
                }
                self.s.moving = false;
            }
        }
        // The id of a rent-share standing order we just set up.
        if let Some(share) = self.s.share.as_mut().filter(|s| s.1.is_none()) {
            if let Some(id) = pic.outcomes.iter().filter_map(|o| o.created.as_ref().and_then(|c| c.get("share"))).next_back() {
                share.1 = Some(id.clone());
            }
        }
        // The id of a rent standing order we just set up.
        if let (Some(ag), Some(h)) = (self.absorbed.pending_rent_order.clone(), self.s.home.as_mut()) {
            if h.agreement == ag {
                if let Some(id) = pic.outcomes.iter().filter_map(|o| o.created.as_ref().and_then(|c| c.get("so"))).next_back() {
                    h.order = Some(id.clone());
                    self.absorbed.pending_rent_order = None;
                }
            }
        }
    }
}

/// A refusal's code as the contract writes it (`flooded`, `no_time_left` ...).
fn refusal_code(c: oikos_contracts::events::RefusalCode) -> String {
    serde_json::to_value(c).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
}

/// The standing household record that lists `person` (the newest), its id and data (household.ts `householdOf`).
fn household_of(book: &crate::common::Book, person: &str) -> Option<(String, oikos_rules::household::HouseholdData)> {
    let mut best: Option<(&Record, oikos_rules::household::HouseholdData)> = None;
    for r in book.open("household") {
        let Ok(h) = serde_json::from_value::<oikos_rules::household::HouseholdData>(data(r).clone()) else { continue };
        if !h.members.iter().any(|m| m.person == person) {
            continue;
        }
        // (Newest first; at the same moment, the greater id, as TS's sort.)
        if best.as_ref().is_none_or(|(b, _)| r.at > b.at || (r.at == b.at && r.id > b.id)) {
            best = Some((r.as_ref(), h));
        }
    }
    best.map(|(r, h)| (r.id.clone(), h))
}

#[cfg(test)]
mod tests {
    use super::super::household::SAYING;
    use super::*;
    use crate::{Ctx, Draws, WorldInfo};
    use oikos_sight::Picture;
    use std::sync::Arc;

    fn world() -> WorldInfo {
        let currency = oikos_sight::calls::Currency { code: "XTS".into(), symbol: Some("$".into()), minor_units: 2, ..Default::default() };
        WorldInfo { currency: Some(currency), dials: json!({ "friction_bps": 10_000 }), ..Default::default() }
    }
    fn ctx() -> Ctx {
        Ctx {
            participant: "p.ann".into(),
            performer: Default::default(),
            entity: "ann".into(),
            position: None,
            params: serde_json::from_value(json!({ "mind": "plain", "essentials": 40_000 })).unwrap(),
            world: Arc::new(world()),
        }
    }
    fn rec(v: Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).expect("a record"))
    }
    fn st(id: &str, at: i64, kind: &str, speaks_for: &str, data: Value) -> Arc<Record> {
        rec(json!({ "id": id, "record": "statement", "author": "p.x", "speaks_for": speaks_for, "at": at, "visible_to": "public", "kind": kind, "text": kind, "data": data }))
    }
    fn to_ann(id: &str, at: i64, kind: &str, speaks_for: &str, data: Value) -> Arc<Record> {
        rec(json!({ "id": id, "record": "statement", "author": "p.x", "speaks_for": speaks_for, "at": at, "visible_to": "public", "kind": kind, "text": kind, "data": data, "addressed_to": ["ann"] }))
    }
    fn sig(id: &str, ag: &str, who: &str) -> Arc<Record> {
        rec(json!({ "id": id, "record": "signature", "author": "p", "at": 0, "visible_to": "public", "agreement": ag, "as": who }))
    }
    fn job_ag() -> Arc<Record> {
        rec(json!({ "id": "rec.job", "record": "agreement", "author": "p.shop", "at": 0, "visible_to": "public", "terms": { "template": "employment", "parties": ["shop", "ann"], "commitments": [
            { "who": "shop", "does": { "outcome": { "money": { "from": "acc.shop", "to": "acc.ann", "amount": 100_000 } } }, "every": 14 * DAY },
            { "who": "ann", "does": { "outcome": { "work": { "task": "serve", "at": "shop/floor" } } } } ] } }))
    }
    fn lease_ag() -> Arc<Record> {
        rec(json!({ "id": "rec.lease", "record": "agreement", "author": "p.ll", "at": 0, "visible_to": "public", "terms": { "template": "lease", "parties": ["ll", "ann"], "commitments": [
            { "who": "ann", "does": { "outcome": { "money": { "to": "acc.ll", "amount": 150_000 } } }, "every": 30 * DAY },
            { "who": "ll", "does": { "outcome": { "occupancy": { "who": "ann", "in": "b1/dwelling.1" } } } } ] } }))
    }
    fn pic(t: i64, records: Vec<Arc<Record>>, inbox: Vec<Value>, txs: Vec<Value>) -> Picture {
        let mut channels = BTreeMap::new();
        channels.insert("papers".to_string(), Seen::Records { records, search: false });
        let accounts = vec![serde_json::from_value(json!({ "account": "acc.ann", "holder": "ann", "custodian": "bank", "currency": "XTS", "balance": "500000" })).unwrap()];
        let transactions = txs.into_iter().map(|v| serde_json::from_value(v).unwrap()).collect();
        channels.insert("bank".to_string(), Seen::Accounts { accounts: Arc::new(accounts), transactions });
        Picture {
            participant: "p.ann".into(),
            t,
            status: serde_json::from_value(json!("active")).unwrap(),
            entity: "ann".into(),
            as_position: None,
            body: None,
            positions: vec![],
            outcomes: vec![],
            inbox: inbox.into_iter().map(|v| serde_json::from_value(v).unwrap()).collect(),
            channels,
            asking: vec![],
            readings: Default::default(),
            woke_for: "cadence".into(),
            since: 0,
        }
    }
    fn msg(id: &str, from: &str, text: &str, re: Option<&str>) -> Value {
        json!({ "id": id, "t": 0, "from": from, "to": ["p.ann"], "text": text, "re": re })
    }
    fn tx(t: i64, from: &str, amount: i64, memo: Option<&str>, per: Option<&str>) -> Value {
        json!({ "t": t, "from": from, "to": "acc.ann", "amount": amount.to_string(), "currency": "XTS", "by": "bank", "memo": memo, "per_instruction": per })
    }
    fn run(person: &mut Person, c: &Ctx, p: &Picture) {
        let mut d = Draws::default();
        let mut cx = Cx::new(p.t, c, &mut d, 1, vec![]);
        person.absorb(p, &mut cx);
    }
    fn first(person: &mut Person, c: &Ctx, p: &Picture) {
        run(person, c, p);
        let mut d = Draws::default();
        let mut cx = Cx::new(p.t, c, &mut d, 1, vec![]);
        let mut w = Week { pic: p, cx: &mut cx, t: p.t, acc: None, steps: vec![] };
        person.learn_from_initial_records(&mut w);
    }
    fn household() -> Arc<Record> {
        st("rec.hh", 0, "household", "ann", json!({ "leaseholder": "ann", "members": [
            { "person": "ann", "participant": "p.ann", "born_at": -40 * 365 * DAY, "sex": "female" },
            { "person": "bob", "participant": "p.bob", "born_at": -40 * 365 * DAY, "sex": "male" } ], "couples": [["ann", "bob"]] }))
    }

    #[test]
    fn what_was_in_force_at_the_start_is_our_home_and_our_job() {
        let c = ctx();
        let mut ann = Person::new(&c).unwrap();
        let order = st("rec.so", 0, "request", "ann", json!({ "outcome": { "money": { "to": "acc.ll", "amount": 150_000 } } }));
        let order = rec({ let mut v = serde_json::to_value(&*order).unwrap(); v["basis"] = json!("rec.lease"); v });
        let p = pic(0, vec![lease_ag(), sig("rec.s1", "rec.lease", "ll"), sig("rec.s2", "rec.lease", "ann"), job_ag(), sig("rec.s3", "rec.job", "shop"), sig("rec.s4", "rec.job", "ann"), order], vec![], vec![]);
        first(&mut ann, &c, &p);
        let h = ann.s.home.as_ref().unwrap();
        assert_eq!((h.space.as_str(), h.landlord.as_str(), h.rent, h.order.as_deref(), h.moved_in), ("b1/dwelling.1", "ll", 150_000, Some("rec.so"), true));
        let j = ann.s.job.as_ref().unwrap();
        assert_eq!((j.employer.as_str(), j.wage, j.period, j.workplace.as_deref()), ("shop", 100_000, 14 * DAY, Some("shop/floor")));
    }

    #[test]
    fn the_household_s_sayings_are_heard_from_its_members_only_and_a_death_at_home_is_kept_for_lifecycle() {
        let c = ctx();
        let mut ann = Person::new(&c).unwrap();
        let w = world();
        let p = pic(DAY, vec![household()], vec![msg("m1", "p.bob", &SAYING::pay(250_000, &w), None), msg("m2", "p.eve", &SAYING::pay(9, &w), None), msg("m3", "p.bob", &SAYING::died("cal", "b1/dwelling.1"), None)], vec![]);
        run(&mut ann, &c, &p);
        assert_eq!(ann.s.household_record.as_deref(), Some("rec.hh"));
        assert_eq!(ann.s.heard, vec![("bob".to_string(), Said::Pay(250_000))], "words from someone not of the household move nothing");
        assert_eq!(ann.absorbed.told_dead, vec![("cal".to_string(), "b1/dwelling.1".to_string())]);
    }

    #[test]
    fn a_rent_payment_the_bank_could_not_make_is_owed_and_queued_only_for_our_own_rent_orders() {
        let c = ctx();
        let mut ann = Person::new(&c).unwrap();
        ann.s.home = Some(super::super::person::Home { agreement: "rec.lease".into(), order: Some("rec.so".into()), moved_in: true, ..Default::default() });
        let order = st("rec.so", 0, "request", "ann", json!({ "outcome": { "money": { "to": "acc.ll", "amount": 150_000 } } }));
        let other = st("rec.x", 0, "request", "ann", json!({ "outcome": { "money": { "to": "acc.gym", "amount": 5_000 } } }));
        let note = |r: &str| PAYMENT_FAILED::note("$1500.00", "acc.ll", r);
        let p = pic(DAY, vec![order, other], vec![msg("m1", "p.bank", &note("rec.so"), Some("rec.so")), msg("m2", "p.bank", &note("rec.x"), Some("rec.x"))], vec![]);
        run(&mut ann, &c, &p);
        assert_eq!(ann.s.missed, vec![Missed { instruction: "rec.so".into(), to: "acc.ll".into(), amount: 150_000, what: "the rent".into() }]);
    }

    #[test]
    fn pay_as_agreed_is_learned_as_paid_and_pay_come_short_by_a_standing_order_is_owed() {
        let c = ctx();
        let mut ann = Person::new(&c).unwrap();
        let p0 = pic(0, vec![job_ag(), sig("rec.s3", "rec.job", "shop"), sig("rec.s4", "rec.job", "ann")], vec![], vec![]);
        first(&mut ann, &c, &p0);
        let p = pic(14 * DAY, vec![], vec![], vec![tx(14 * DAY, "acc.shop", 100_000, Some("Wages."), Some("rec.wo"))]);
        run(&mut ann, &c, &p);
        let j = ann.s.job.clone().unwrap();
        assert_eq!((j.paid_at, j.paid_from.as_deref()), (Some(14 * DAY), Some("acc.shop")));
        assert_eq!(ann.mind.learned("job", "shop"), Some(10_000));
        assert_eq!(ann.s.inflows, vec![(14 * DAY, 100_000)]);
        // (A refund from the shop is not pay come short; wages paid short are.)
        let p = pic(28 * DAY, vec![], vec![], vec![tx(28 * DAY, "acc.shop", 70_000, Some("Refund."), Some("rec.wo")), tx(28 * DAY, "acc.shop", 80_000, Some("Wages."), Some("rec.wo"))]);
        run(&mut ann, &c, &p);
        assert_eq!(ann.s.job.as_ref().unwrap().short, Some(20_000));
        assert_eq!(ann.mind.learned("job", "shop"), Some(6_000));
    }

    #[test]
    fn a_cut_of_hours_told_is_the_pay_from_its_day_and_one_asked_waits_on_our_answer() {
        let c = ctx();
        let mut ann = Person::new(&c).unwrap();
        let p0 = pic(0, vec![job_ag(), sig("rec.s3", "rec.job", "shop"), sig("rec.s4", "rec.job", "ann")], vec![], vec![]);
        first(&mut ann, &c, &p0);
        let cut = to_ann("rec.h1", DAY, "hours_notice", "shop", json!({ "employer": "shop", "agreement": "rec.job", "wage": 80_000, "from": 7 * DAY, "minutes_week": 1_800 }));
        let ask = to_ann("rec.h2", DAY, "hours_notice", "shop", json!({ "employer": "shop", "agreement": "rec.job", "wage": 60_000, "from": 9 * DAY, "minutes_week": 1_250, "consent": true }));
        run(&mut ann, &c, &pic(DAY, vec![cut, ask], vec![], vec![]));
        assert_eq!(ann.s.job.as_ref().unwrap().coming, Some((7 * DAY, 80_000)));
        assert_eq!(ann.absorbed.hours_asked.len(), 1);
        assert_eq!(ann.absorbed.hours_asked[0].hours_tenths, 208, "1,250 minutes: 20.8 hours");
        run(&mut ann, &c, &pic(7 * DAY, vec![], vec![], vec![]));
        let j = ann.s.job.clone().unwrap();
        assert_eq!((j.wage, j.prev, j.coming), (80_000, Some((100_000, 10 * DAY)), None));
    }

    #[test]
    fn a_stoppage_and_the_return_to_work_and_a_rise() {
        let c = ctx();
        let mut ann = Person::new(&c).unwrap();
        first(&mut ann, &c, &pic(0, vec![job_ag(), sig("rec.s3", "rec.job", "shop"), sig("rec.s4", "rec.job", "ann")], vec![], vec![]));
        run(&mut ann, &c, &pic(DAY, vec![to_ann("rec.sw", DAY, "stop_work", "union", json!({ "employer": "shop" }))], vec![], vec![]));
        assert_eq!(ann.s.striking, Some(("shop".to_string(), false, None)));
        ann.s.striking = Some(("shop".into(), true, Some("shop/floor".into())));
        run(&mut ann, &c, &pic(3 * DAY, vec![to_ann("rec.rw", 3 * DAY, "return_to_work", "union", json!({ "employer": "shop" }))], vec![], vec![]));
        assert_eq!((ann.s.striking.clone(), ann.absorbed.back_to.clone()), (None, Some(("shop".to_string(), "shop/floor".to_string()))));
        run(&mut ann, &c, &pic(4 * DAY, vec![st("rec.ea", 4 * DAY, "enterprise_agreement", "union", json!({ "employer": "shop", "rise_bps": 300 }))], vec![], vec![]));
        assert_eq!(ann.s.job.as_ref().unwrap().wage, 103_000);
    }

    #[test]
    fn an_office_s_letter_is_kept_not_a_lead_and_a_reply_to_asking_around_is_a_lead() {
        let c = ctx();
        let mut ann = Person::new(&c).unwrap();
        let office = json!({ "id": "m1", "t": 0, "from": "p.clerk", "as": "clerk", "from_entity": "council", "to": ["p.ann"], "text": "Please call in about your rates." });
        run(&mut ann, &c, &pic(DAY, vec![], vec![office, msg("m2", "p.eve", "Try the flats on Elm.", Some("b7"))], vec![]));
        assert_eq!(ann.s.leads, vec!["b7".to_string()]);
        assert_eq!(ann.s.lead_from.get("b7").map(String::as_str), Some("p.eve"));
    }

    #[test]
    fn a_landlord_s_offer_of_the_tenancy_of_one_who_died_is_kept_for_the_heir_to_sign() {
        let c = ctx();
        let mut ann = Person::new(&c).unwrap();
        let offer = rec(json!({ "id": "rec.new", "record": "agreement", "author": "p.ll", "at": DAY, "visible_to": "public", "basis": "rec.old",
            "terms": { "template": "lease", "parties": ["ll", "ann"], "text": "ann rents home b1/dwelling.1 from ll for $1500.00 a month, succeeding bob (lease rec.old) for 12 months from day 61.", "commitments": [] } }));
        let other = rec(json!({ "id": "rec.o2", "record": "agreement", "author": "p.ll", "at": DAY, "visible_to": "public", "terms": { "template": "lease", "parties": ["ll", "ann"], "text": "ann rents home b2.", "commitments": [] } }));
        run(&mut ann, &c, &pic(DAY, vec![offer, sig("rec.s", "rec.new", "ll"), other], vec![], vec![]));
        assert_eq!(ann.absorbed.succession_offers.iter().collect::<Vec<_>>(), ["rec.new"]);
    }

    #[test]
    fn what_a_law_withholds_from_a_pay_is_reckoned_over_a_year_of_365_days() {
        let mut b = crate::common::Book::new();
        b.take_all(&[st("rec.law", 0, "law", "city", json!({ "tax": "income", "brackets": [{ "from": 0, "rate_bps": 0 }, { "from": 1_000_000, "rate_bps": 2_000 }], "levy_bps": 200 }))]);
        let law = income_tax_law(&b);
        // (A fortnight's 100,000 is 2,607,142 a year: 321,428 tax and 52,142 levy, 373,570 a year; 14/365 of it.)
        assert_eq!(withholding(law.as_deref(), 100_000, 14 * DAY), 14_328);
        assert_eq!(withholding(None, 100_000, 14 * DAY), 0);
        assert_eq!(day_pay_period(5), 120_960);
        assert!(as_wages("Your PAY for the week") && as_wages("Salary") && !as_wages("Repayment") && !as_wages("Refund."));
    }
}
