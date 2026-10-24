//! Work (citizen.ts): pay and its shortfalls, a job ending and the next starting, the union, hours, stopping
//! work, looking for work, working for oneself and starting a business, taking from work (docs/behaviour/citizen.md,
//! unions.md, entry.md, crime.md).
//!
//! What absorb takes in for this part is in `Person::absorbed` (hours asked, the return from a stoppage, what our own
//! business paid us, a founded firm's id); the stoppage itself is `person::State::striking`; a better-paid job taken
//! while in one is housing's (`housing.switching`, signed by `offers`), started here once our notice has run.
//!
//! Decided fresh (docs/port-guide.md, section 2): every sway TS worked in floats is in integers (z-scores in
//! hundredths from the mind, a parameter's float read once as thousandths, a chance in basis points or, for a business
//! of one, parts per million), rounded half away from zero; postings tie-broken by the order they were seen.

use super::mind::{Choice, ConductAsk, Decide, Event, Facts, Outcome, Way};
use super::params::Params;
#[allow(unused_imports)]
use super::person::{bound, cells, inside, step_of_lines, Job, Person, Todo, Week};
use crate::common::calls::{move_in, move_out, record};
use crate::common::{data, filed_before, money_words, structure_of, Fields, DAY, MONTH};
use crate::papers::agreements::{job_terms, notice, other_party, sign};
use crate::papers::citizen::{HoursReply, JobApplication, MembershipUpdate, TradingFrom, WorkSearch};
use crate::steps::{arg, because, call, json, pay, say, text, Pay, Say, Visible};
use crate::Cx;
use oikos_sight::calls::Call;
use oikos_sight::{CmpOp, Condition, LookRequest, Picture, Record, RecordBody, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// A business we have founded (or are founding): the capital asked, whether paid, and, for a business of one, the home
/// it trades from and what it is expected to pay us a month (citizen.ts `founded`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Founded {
    pub firm: Option<String>,
    pub capital: i64,
    pub paid: bool,
    pub own: Option<(String, i64)>,
}

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Work {
    /// Where we last told the union we work, as a member (none: not yet; the register we joined with has it).
    pub told_union: Option<String>,
    /// This month's look for a better-paid job while employed, and when the next month's chance comes.
    pub searching_work: bool,
    pub next_job_search: i64,
    /// Postings applied for.
    pub applied: BTreeSet<String>,
    /// Where our business, worked from home, has been told it trades.
    pub trading_from: Option<String>,
    pub founded: Option<Founded>,
    /// Meaning to work for ourselves, from when (a job's notice given first).
    pub venturing: Option<i64>,
    pub own_since: i64,
    pub next_own_venture: i64,
    pub next_own_review: i64,
    pub next_venture: i64,
    pub next_take_chance: i64,
}

impl Work {
    pub fn new(p: &Params, cx: &mut Cx) -> Self {
        // (TS's order of drawing: the job search's day, then the ventures'.)
        let next_job_search = cx.rng("job-search-day").below(30) as i64 * DAY;
        let next_venture = cx.rng("venture-day").below(30) as i64 * DAY;
        let next_own_venture = cx.rng("own-venture-day").below(30) as i64 * DAY;
        let next_own_review = MONTH + cx.rng("own-review-day").below(30) as i64 * DAY;
        Work {
            next_job_search,
            next_venture,
            next_own_venture,
            next_own_review,
            own_since: if p.own_work.is_some() { 0 } else { -1 },
            trading_from: p.own_work.as_ref().and_then(|w| w.home.clone()),
            ..Default::default()
        }
    }
}

// ------------------------------------------------------------------ small rules

/// n / d rounded half away from zero (TS `Math.round` of a ratio).
fn div_round(n: i64, d: i64) -> i64 {
    if d == 0 {
        return 0;
    }
    let (n, d) = if d < 0 { (-n, -d) } else { (n, d) };
    if n >= 0 {
        (2 * n + d) / (2 * d)
    } else {
        -((-2 * n + d) / (2 * d))
    }
}

/// A rate swayed by where a person stands against their town (wants.ts `swayed`): `z` in hundredths of a standard
/// deviation (held within three), `per_milli` the share a standard deviation moves it, in thousandths.
fn swayed(bps: i64, z: i64, per_milli: i64) -> i64 {
    div_round(bps * (100_000 + per_milli * z.clamp(-300, 300)), 100_000).clamp(0, 10_000)
}

/// A float parameter read once as thousandths.
fn milli(v: Option<&Value>, default: i64) -> i64 {
    v.and_then(Value::as_f64).map_or(default, |f| (f * 1_000.0).round() as i64)
}

/// citizen.ts `SWAY`, as the world may set some of it (`params.sway`), in thousandths.
fn sway(w: &Week, key: &str) -> i64 {
    let default = match key {
        "enterprise_openness" => 400,
        "enterprise_achievement" => 300,
        _ => 0,
    };
    milli(w.cx.ctx.params.get("sway").and_then(|s| s.get(key)), default)
}

/// wants.ts `sway` (`params.wants.sway`), in thousandths.
fn wants_sway(w: &Week, key: &str) -> i64 {
    let default = match key {
        "found" => 1_000,
        _ => 300,
    };
    milli(w.cx.ctx.params.get("wants").and_then(|s| s.get("sway")).and_then(|s| s.get(key)), default)
}

/// The friction dial (frictions.ts `frictionDial`).
fn friction_on(w: &Week) -> bool {
    w.cx.ctx.world.dials.get("friction_bps").and_then(crate::papers::lenient::whole).unwrap_or(0) > 0
}

fn facts<const N: usize>(kv: [(&str, Value); N]) -> BTreeMap<String, Value> {
    kv.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
}

fn mine(domain: &str, option: &str, kind: &str, facts: BTreeMap<String, Value>) -> Outcome {
    Outcome { domain: domain.into(), option: option.into(), kind: kind.into(), way: Way::Mine, facts, ..Default::default() }
}

fn only(a: &str, b: &str) -> Option<Visible> {
    Some(Visible::Only(vec![a.to_string(), b.to_string()]))
}

/// Hours in tenths, as TS wrote them (one decimal, none when whole).
fn tenths_words(t: i64) -> String {
    if t % 10 == 0 {
        format!("{}", t / 10)
    } else {
        format!("{}.{}", t / 10, (t % 10).abs())
    }
}

/// An offer's facts, from its typed terms (mind.ts `factsOf`): money a month for the taker, work hours, a home, goods.
fn facts_of(offer: &Value) -> Facts {
    let mut f = Facts::default();
    let Some(cs) = offer.get("terms").and_then(|t| t.get("commitments")).and_then(Value::as_array) else { return f };
    for c in cs {
        let Some(o) = c.get("does").and_then(|d| d.get("outcome")) else { continue };
        let every = c.get("every").and_then(crate::papers::lenient::whole).filter(|e| *e != 0);
        let per_month = |x: i64| every.map_or(x, |e| div_round(x * MONTH, e));
        let taker = c.get("who").and_then(Value::as_str) == Some("taker");
        if let Some(m) = o.get("money") {
            let a = m.get("amount").and_then(crate::papers::lenient::whole).unwrap_or(0);
            f.money_per_month += if taker { -per_month(a) } else { per_month(a) };
        }
        if o.get("occupancy").is_some() {
            if taker {
                f.work_hours_per_month = Some(f.work_hours_per_month.unwrap_or(0) + 160);
            } else {
                f.home = Some(Default::default());
            }
        }
        if let (Some(wk), true) = (o.get("work"), taker) {
            let h = wk.get("hours").and_then(crate::papers::lenient::whole).unwrap_or(0);
            f.work_hours_per_month = Some(f.work_hours_per_month.unwrap_or(0) + div_round(per_month(h), 3_600));
        }
        if let (Some(g), false) = (o.get("goods"), taker) {
            let q = g.get("quantity").and_then(crate::papers::lenient::whole).unwrap_or(0);
            f.goods_per_month = Some(f.goods_per_month.unwrap_or(0) + per_month(q));
        }
    }
    f
}

/// Strings of a role module's template filled (citizen.ts `fill`): an exact placeholder is its value; for premises,
/// `{structure}` is also put in wherever it stands in a longer string.
fn fill(x: &Value, with: &BTreeMap<&str, Value>, inline_structure: Option<&str>) -> Value {
    match x {
        Value::String(s) => match with.get(s.as_str()) {
            Some(v) => v.clone(),
            None => match inline_structure {
                Some(st) => Value::String(s.replace("{structure}", st)),
                None => x.clone(),
            },
        },
        Value::Array(a) => Value::Array(a.iter().map(|y| fill(y, with, inline_structure)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, y)| (k.clone(), fill(y, with, inline_structure))).collect()),
        _ => x.clone(),
    }
}

/// The cheapest trade price of a kind on the price lists we hold that sell in lots (a wholesaler's), if any.
fn trade_price(book: &crate::common::Book, kind: &str) -> Option<i64> {
    crate::common::latest_by_speaker(book, "price_list", |r| data(r).i("min_order").unwrap_or(1) > 1)
        .values()
        .filter_map(|r| data(r).get("goods").and_then(|g| g.get(kind)).and_then(crate::papers::lenient::whole))
        .filter(|p| *p > 0)
        .min()
}

// ------------------------------------------------------------------ the part's own helpers

impl Person {

    /// Our values in the town's terms (basis points, each from the population's spread the world gives, `values`), for
    /// a business we found: its character is its owner's (firms::orgwants). Empty where the world gives no spread.
    fn owner_values(&self, cx: &crate::Cx) -> Value {
        let mut out = serde_json::Map::new();
        // (A citizen's `values` param holds the population's spread under `values`, beside its own.)
        let given = cx.ctx.params.get("values");
        if let Some(pop) = given.and_then(|v| v.get("values")).or(given).and_then(Value::as_object) {
            for (name, spread) in pop {
                let (Some(mean), Some(sd)) = (spread.get("mean_bps").and_then(Value::as_i64), spread.get("sd_bps").and_then(Value::as_i64)) else { continue };
                let z = self.mind.value_z(name);
                out.insert(name.clone(), json!((mean + (z * sd).div_euclid(100)).clamp(0, 10_000)));
            }
        }
        Value::Object(out)
    }
    fn wk_usd(w: &Week, n: i64) -> String {
        money_words(n, &w.cx.ctx.world)
    }
    /// When a job ends: by the terms' reading, or when we walked out (citizen.ts `jobEnds`).
    fn wk_job_ends(&self, j: &Job) -> i64 {
        j.left_at.unwrap_or(i64::MAX).min(self.book.ends_at(&j.agreement).unwrap_or(i64::MAX))
    }
    /// Who ended an agreement of ours, as its notices say (citizen.ts `endedBy`).
    fn wk_ended_by(&self, agreement: &str) -> &'static str {
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
    fn wk_is_member(&self) -> bool {
        self.p.union.as_deref().is_some_and(|u| self.member_of(u))
    }
    /// The dwelling we trade from or would: our home moved into, else where the household lives.
    fn wk_dwelling(&self) -> Option<String> {
        self.s.home.as_ref().filter(|h| h.moved_in).map(|h| h.space.clone()).or_else(|| self.s.living_at.clone())
    }
    /// The ground cell a building stands on, as we have seen it (being there).
    fn wk_cell_of(pic: &Picture, structure: &str) -> Option<String> {
        pic.channels.values().find_map(|c| match c {
            Seen::Sites { cells, .. } => cells.iter().find(|c| c.structure.as_ref().is_some_and(|s| s.structure == structure)).map(|c| c.cell.clone()),
            _ => None,
        })
    }
    /// A record by id: the book's, else what this picture shows.
    fn wk_record(&self, pic: &Picture, id: &str) -> Option<Arc<Record>> {
        self.book.get(id).cloned().or_else(|| pic.all_records().find(|r| r.id == id).cloned())
    }
    /// How much more another job must pay before it is worth leaving ours (basis points; 0: anything more), for one
    /// who takes initiative where the world says what holds people (`job_move`): citizen.ts `heldIn`.
    fn wk_held_in(&self, w: &Week, t: i64, industry: Option<&str>) -> i64 {
        let (Some(job), Some(m)) = (&self.s.job, w.cx.ctx.params.get("job_move").filter(|m| m.is_object())) else { return 0 };
        if !self.mind.initiative() {
            return 0;
        }
        let g = |k: &str| m.get(k).and_then(crate::papers::lenient::whole).unwrap_or(0);
        let lead = if job.since < 7 * DAY { self.p.started.as_ref().and_then(|s| s.trade_days).unwrap_or(0) * DAY } else { 0 };
        let held = (t - job.since + lead).min(g("cap_years") * self.p.year).max(0);
        let other = industry.is_some_and(|i| self.s.industry_of.get(&job.employer).map(String::as_str) != Some(i));
        g("premium_bps") + div_round(g("per_year_bps") * held, self.p.year.max(1)) + if other { g("other_trade_bps") } else { 0 }
    }
    /// What drives someone to start a business, against their town (citizen.ts `enterprise`), in basis points of the
    /// chance: the open and those who value achievement, more; and wanting work of one's own, for one who takes
    /// initiative.
    fn wk_enterprise(&self, w: &Week) -> i64 {
        let open = (self.mind.value_z("stimulation") + self.mind.value_z("self_direction")) / 2;
        let e = sway(w, "enterprise_openness") * open / 10 + sway(w, "enterprise_achievement") * self.mind.value_z("achievement") / 10;
        let wants_work = self.mind.initiative() && self.mind.wants().iter().any(|x| x.seeks.iter().any(|s| s == "work"));
        e + if wants_work { wants_sway(w, "found") * 10 } else { 0 }
    }
    /// Properties for sale as we know them: the last answer of the sale board, or the open listings we hold.
    fn wk_for_sale(&self, pic: &Picture) -> Vec<Arc<Record>> {
        if self.p.sale_board.is_empty() {
            return self.book.open("property_for_sale").cloned().collect();
        }
        self.absorbed.on_sale.iter().flatten().filter_map(|id| self.wk_record(pic, id)).collect()
    }
    /// What we know of a venture's market, as a would-be founder (docs/behaviour/entry.md, "Entry by expected profit";
    /// `oikos_rules::entry`): the price of its kind on the price lists we have read (the middle one), what it costs to
    /// bring in (a trade price list we hold, else the trade price the venture names, which is published), how much a
    /// customer like us buys of it a month (our own orders), the town's adults as the census publishes them, the sellers
    /// of it we know, what one person's working time serves, the going wage (the best posting we have seen, else the
    /// venture's), and nothing for premises (a home, or premises bought outright). `hires`: whether hands may be taken
    /// on. None where we know no price for it.
    pub fn venture_prospect(&self, pic: &Picture, v: &super::params::Venture, hires: bool) -> Option<oikos_rules::entry::Prospect> {
        // (The custom in reach: the homes around us, as we see them by being there; a business worked from home sells to
        // its neighbourhood first, and its rivals are the sellers we, like our neighbours, know.)
        let mut homes: BTreeSet<String> = BTreeSet::new();
        for c in pic.channels.values() {
            if let Seen::Sites { cells, .. } = c {
                for cell in cells.iter() {
                    for sp in cell.structure.iter().flat_map(|s| s.spaces.iter()).filter(|sp| sp.kind == "dwelling") {
                        for i in 0..sp.count.max(1) {
                            homes.insert(format!("{}#{i}", sp.space));
                        }
                    }
                }
            }
        }
        let pm = v.role_module.get("params").cloned().unwrap_or(Value::Null);
        let g = |k: &str| pm.get(k).and_then(crate::papers::lenient::whole);
        let kind = pm.get("kind").and_then(Value::as_str).unwrap_or(&self.p.goods).to_string();
        let mine: BTreeSet<String> = self.s.own_work.iter().map(|o| o.firm.clone()).collect();
        let known: Vec<super::money::Shop> = super::money::shops(&self.book, &kind).into_iter().filter(|s| !mine.contains(&s.shop)).collect();
        let mut prices: Vec<i64> = known.iter().map(|s| s.price).collect();
        prices.sort_unstable();
        let price = prices.get(prices.len() / 2).copied().or_else(|| g("price"))?;
        let unit_cost = trade_price(&self.book, &kind).or(v.unit_cost).unwrap_or(0);
        // (Per month, over the time we have kept count; none counted yet: what we need of it, the essentials' units.)
        let units: i64 = self.money.bought.iter().filter(|b| b.1 == kind).map(|b| b.2).sum();
        let first = self.money.bought.iter().map(|b| b.0).min();
        let last = self.money.bought.iter().map(|b| b.0).max();
        let units_per_household = match (first, last) {
            (Some(f), Some(l)) if units > 0 => div_round(units * MONTH, (l - f + 14 * DAY).max(14 * DAY)),
            _ => self.p.essentials_units,
        };
        let working_day = g("working_day").unwrap_or(8 * 3_600);
        let work_days = g("work_days").unwrap_or(5);
        let serve = g("serve_labour").unwrap_or(0);
        if serve <= 0 {
            return None;
        }
        let units_per_worker = working_day * work_days * 30 / 7 / serve;
        let period = g("period").unwrap_or(14 * DAY).max(DAY);
        let posted = self
            .s
            .found_jobs
            .iter()
            .filter_map(|id| self.book.get(id))
            .filter_map(|r| {
                let d = data(r);
                Some(div_round(d.i("wage")? * MONTH, d.i("period").unwrap_or(period).max(DAY)))
            })
            .max();
        let wage = if hires { posted.or_else(|| g("wage").map(|w| div_round(w * MONTH, period))).unwrap_or(0) } else { 0 };
        let opportunity = self.s.job.as_ref().map_or(0, |j| div_round(j.wage * MONTH, j.period.max(DAY)));
        Some(oikos_rules::entry::Prospect { price, unit_cost, units_per_household, households_reached: homes.len() as i64, sellers_known: known.len() as i64, units_per_worker, wage, fixed: 0, opportunity })
    }

    /// Whether to start it (docs/behaviour/entry.md, "Entry by expected profit"): the mind's decision between the
    /// business, at what we expect it to leave us a month, and life as it is (our pay, or nothing). Nothing is started
    /// that we do not expect to beat what we have; whether we start one that does is the mind's, as any choice of work
    /// is. `keeps_job`: the business is managed beside our work (premises with staff), not worked in.
    fn weigh_venture(&mut self, w: &mut Week, profit: i64, keeps_job: bool) -> bool {
        let now = self.s.job.as_ref().map_or(0, |j| div_round(j.wage * MONTH, j.period.max(DAY)));
        let with = if keeps_job { now + profit } else { profit };
        if with <= now {
            return false;
        }
        let hours = self.s.job.as_ref().map(|_| 160);
        let options = vec![
            // (What working for oneself means beyond the money, as it did for the chance before: more to the open and the
            // achieving, and to one who wants work of their own: `wk_enterprise`, the same sways.)
            Choice { key: "found".into(), facts: Some(Facts { money_per_month: with, work_hours_per_month: Some(160), ..Default::default() }), others: None, meaning: Some(self.wk_enterprise(w)) },
            Choice { key: "as_now".into(), facts: Some(Facts { money_per_month: now, work_hours_per_month: hours, ..Default::default() }), others: None, meaning: None },
        ];
        let life = self.life(w.pic, w.t, w.acc.as_ref().map(|a| a.balance));
        let d = self.mind.decide(w.cx, &life, Decide { domain: "venture".into(), options, current: Some("as_now".into()), purpose: Some("venture".into()), ..Default::default() });
        d.key.as_deref() == Some("found")
    }

    /// Recorded as the mind's decision, yes or no, at the chance it came to (TS `decision`, deliberate): a conduct the
    /// mind does not lean, decided already.
    fn wk_record_choice(&mut self, w: &mut Week, domain: &str, yes: &str, no: &str, score: i64, does: bool) {
        let life = self.life(w.pic, w.t, w.acc.as_ref().map(|a| a.balance));
        self.mind.choose_conduct(
            w.cx,
            &life,
            ConductAsk { conduct: domain.into(), base_bps: score, draw_bps: if does { 0 } else { 10_000 }, forced: does, record: Some((domain.into(), yes.into(), no.into())), ..Default::default() },
        );
    }
}

// ------------------------------------------------------------------ the part

impl Person {
    /// A building someone told us of: the jobs on offer there now.
    pub fn job_lead_look(&self, lead: &str) -> LookRequest {
        crate::common::ask::board("jobs", self.p.search_limit, vec![Condition { field: "data.workplace".into(), op: CmpOp::Eq, value: lead.into() }], None)
    }

    /// The jobs board, best-paid first, when we are looking (out of work, or this month's look for better).
    pub fn job_market_looks(&self) -> Vec<LookRequest> {
        let looking = self.s.job.is_none() || self.work.searching_work;
        if looking && self.s.own_work.is_none() && !self.s.retired && self.p.in_labour_force {
            vec![crate::common::ask::board("jobs", self.p.search_limit, vec![], Some(("data.wage", true)))]
        } else {
            vec![]
        }
    }

    /// In work: a month's chance of looking for something better paid (citizen.ts 4882-4889). Every month if our life
    /// falls short of what we want, or we mean to better our work; otherwise now and then, the more open we are.
    pub fn search_due(&mut self, pic: &Picture, cx: &mut Cx) {
        let t = pic.t;
        if self.s.job.is_some() && self.s.own_work.is_none() && self.housing.switching.is_none() && !self.s.retired && self.p.in_labour_force && (t >= self.work.next_job_search || self.s.search_forced) {
            self.work.next_job_search = t + MONTH;
            let life = self.life(pic, t, None);
            let aspiration = cx.ctx.params.get("mind").and_then(|m| m.get("aspiration_bps")).and_then(crate::papers::lenient::whole).unwrap_or(6_000);
            let unsatisfied = self.mind.satisfaction(&life) < aspiration;
            self.work.searching_work = unsatisfied || self.mind.pursuing("better work") || self.s.search_forced || {
                let open = div_round(self.mind.facet("openness"), 10);
                (cx.rng("job-search").below(10_000) as i64) < open
            };
        }
        self.s.search_forced = false;
    }

    /// Leaving town in work as a union member: telling the union we no longer are (citizen.ts 4720-4725).
    pub fn leaving_union(&mut self) -> Vec<Call> {
        let Some(u) = self.p.union.clone() else { return vec![] };
        if self.s.job.is_none() || !self.wk_is_member() || self.work.told_union.as_deref() == Some("") {
            return vec![];
        }
        self.work.told_union = Some(String::new());
        let d = crate::papers::data(&MembershipUpdate { employer: String::new(), industry: None });
        vec![say("membership_update", "I'm no longer in work.", Say { to: Some(vec![u.clone()]), visible: only(&self.me, &u), data: Some(d), ..Default::default() })]
    }

    /// Our own business, worked from our home: when we live somewhere else (or nowhere), we tell it, and it trades
    /// from there (citizen.ts 1907-1917). Where our new home stands we know from having been there.
    pub fn trading_from(&mut self, w: &mut Week) {
        let Some(own) = self.s.own_work.clone() else { return };
        if own.at.is_some() {
            return;
        }
        let dwelling = self.wk_dwelling();
        let cell = dwelling.as_deref().and_then(|d| Self::wk_cell_of(w.pic, structure_of(d)));
        if dwelling == self.work.trading_from || (dwelling.is_some() && cell.is_none()) {
            return;
        }
        self.work.trading_from = dwelling.clone();
        let (why, words, paper) = match &dwelling {
            Some(d) => (
                format!("We live at {d} now: our business trades from there."),
                format!("Trading from {d} now."),
                TradingFrom { space: Some(d.clone()), structure: Some(structure_of(d).to_string()), cell, ..Default::default() },
            ),
            None => ("We have no home to trade from: our business stops trading until we do.".into(), "Not trading: nowhere to trade from.".into(), TradingFrom { nowhere: Some(true), ..Default::default() }),
        };
        let to = own.firm.clone();
        w.push(because(why, vec![say("trading_from", &words, Say { to: Some(vec![to.clone()]), visible: only(&self.me, &to), data: Some(crate::papers::data(&paper)), ..Default::default() })]));
    }

    /// Wages not paid: a pay period (and a few days' grace) without them, we resign, and claim what we're owed, as an
    /// employee can (citizen.ts 1918-1942). Work by the day with no pay for most of a week: no work there; ended.
    pub fn unpaid_wages(&mut self, w: &mut Week) {
        let t = w.t;
        let Some(job) = self.s.job.clone() else { return };
        if job.claimed || t >= self.wk_job_ends(&job) || self.s.striking.is_some() {
            return;
        }
        let last = job.paid_at.unwrap_or(job.since);
        if t - last <= job.period + 5 * DAY {
            return;
        }
        let days = (t - last).div_euclid(DAY);
        if job.period == DAY {
            // (Nothing is owed for a day not worked, so nothing to claim: we end it, as its terms let either side.)
            self.tell(w, mine("job", &job.employer, "no_work", facts([("days_since_last", json!(days)), ("period_days", json!(1))])));
            w.push(because(format!("No pay from our work by the day for {days} days: there is no work for us there. Ending it."), vec![notice(&job.agreement, "No work by the day for us here.")]));
        } else {
            let missed = ((t - last) / job.period.max(1)).max(1);
            let owed = missed * job.wage;
            // (An employer that didn't pay: learned, with nothing to show for it.)
            let mut o = mine(
                "job",
                &job.employer,
                "unpaid",
                facts([("days_since_last", json!(days)), ("period_days", json!(div_round(job.period, DAY))), ("periods_missed", json!(missed)), ("owed", json!(owed))]),
            );
            o.payoff = Some(0);
            self.tell(w, o);
            let plural = if missed > 1 { "s" } else { "" };
            w.push(because(
                format!("Our wages haven't been paid for {days} days: resigning, and claiming the {} we're owed.", Self::wk_usd(w, owed)),
                vec![
                    notice(&job.agreement, "Resigning: our wages haven't been paid."),
                    record("right", &self.me, json!({ "kind": "debt", "amount": owed, "for": format!("Unpaid wages ({missed} pay period{plural}).") }), Some(&job.employer), Some(&job.agreement)),
                ],
            ));
        }
        if let Some(j) = self.s.job.as_mut() {
            j.claimed = true;
            j.left_at = Some(t);
        }
    }

    /// A job that has ended (citizen.ts 1943-1950).
    pub fn job_end(&mut self, w: &mut Week) {
        let t = w.t;
        let Some(job) = self.s.job.clone() else { return };
        if t < self.wk_job_ends(&job) {
            return;
        }
        if let Some(wp) = job.workplace.as_deref().filter(|wp| inside(w.pic, &self.me, wp)) {
            w.push(because("Our job has ended: leaving the workplace.", vec![move_out(wp, &self.me)]));
        }
        let by = if job.left_at.is_some() { "self" } else { self.wk_ended_by(&job.agreement) };
        let mut f = facts([("by", json!(by)), ("held_days", json!((t - job.since).div_euclid(DAY)))]);
        if job.claimed {
            f.insert("unpaid".into(), json!(true));
        }
        self.tell(w, mine("job", &job.employer, "ended", f));
        self.s.last_employer = Some(job.employer.clone());
        self.s.job = None;
        self.s.jobless_since = Some(t);
    }

    /// Our notice worked out: starting the job we're moving to, signing the offer we took (citizen.ts 1951-1964).
    pub fn switch_start(&mut self, w: &mut Week) {
        let t = w.t;
        if self.s.job.is_some() {
            return;
        }
        let Some((offer, _)) = self.housing.switching.take() else { return };
        let Some(r) = self.book.get(&offer).cloned() else { return };
        if !matches!(r.body, RecordBody::Agreement { .. }) || self.book.signed_by(&r.id, &self.me) || self.s.retired {
            return;
        }
        let me = self.me.clone();
        let terms = job_terms(&r, &me, Some(&self.book));
        let mut calls = vec![sign(&r.id)];
        if let (Some(wp), None) = (&terms.workplace, &self.p.round) {
            calls.push(move_in(wp)); // (with the round, we go when work starts)
        }
        w.push(because(format!("Our notice is worked out: starting the job we took ({} every {} days).", Self::wk_usd(w, terms.wage), div_round(terms.period, DAY)), calls));
        let employer = other_party(&r, &me).unwrap_or_default().to_string();
        self.s.job = Some(Job { agreement: r.id.clone(), employer: employer.clone(), wage: terms.wage, period: terms.period, workplace: terms.workplace.clone(), since: t, ..Default::default() });
        self.s.employers.insert(employer.clone());
        self.s.jobless_since = None;
        self.tell(w, mine("job", &employer, "hired", facts([("wage", json!(terms.wage)), ("period_days", json!(div_round(terms.period, DAY))), ("after_notice", json!(true))])));
    }

    /// The union, life's part (citizen.ts 2618-2626, 2796-2806): a member tells the union where they now work; a
    /// stoppage observed (out of the workplace until the return to work), and back in once it is over. (Joining,
    /// dues, ballots and votes are the mind's.)
    pub fn union(&mut self, w: &mut Week) {
        if let (Some(u), true) = (self.p.union.clone(), self.wk_is_member()) {
            let at = self.s.job.as_ref().map(|j| j.employer.clone()).unwrap_or_default();
            match &self.work.told_union {
                None => self.work.told_union = Some(at),
                Some(told) if *told != at => {
                    self.work.told_union = Some(at.clone());
                    let industry = (!at.is_empty()).then(|| self.s.industry_of.get(&at).cloned()).flatten();
                    let (why, words) = if at.is_empty() {
                        ("Telling the union we're out of work.".to_string(), "I'm no longer in work.".to_string())
                    } else {
                        (format!("Telling the union we now work at {at}."), format!("I now work at {at}."))
                    };
                    let d = crate::papers::data(&MembershipUpdate { employer: at, industry });
                    w.push(because(why, vec![say("membership_update", &words, Say { to: Some(vec![u.clone()]), visible: only(&self.me, &u), data: Some(d), ..Default::default() })]));
                }
                _ => {}
            }
        }
        // The stoppage: out of the workplace (if we are in it).
        if let (Some((employer, false, _)), Some(job)) = (self.s.striking.clone(), self.s.job.clone()) {
            let left = job.workplace.clone().filter(|wp| inside(w.pic, &self.me, wp));
            self.s.striking = Some((employer.clone(), true, left.clone()));
            // (What the town remembers of it: the mind's.)
            self.happened(w, Event::Other { what: "strike".into(), about: Some(job.employer.clone()), facts: BTreeMap::new() });
            let calls = left.iter().map(|l| move_out(l, &self.me)).collect();
            w.push(because(format!("The union's stoppage at {}: stopping work.", job.employer), calls));
        }
        if let Some((employer, space)) = self.absorbed.back_to.take() {
            // (Only if we still work there: a job may have ended, or another begun, in the meantime.)
            if self.s.job.as_ref().is_some_and(|j| j.employer == employer && j.workplace.as_deref() == Some(space.as_str())) && self.p.round.is_none() {
                w.push(because("The stoppage is over: back to work.", vec![move_in(&space)]));
            }
        }
    }

    /// A cut of our hours our employer asks our agreement to (where the law asks for it): whether we agree is the
    /// profile's share (`consent_bps`), drawn on our own stream; answered by a paper (citizen.ts 3183-3192).
    pub fn hours_asked(&mut self, w: &mut Week) {
        let t = w.t;
        for q in std::mem::take(&mut self.absorbed.hours_asked) {
            let Some(job) = self.s.job.clone().filter(|j| j.agreement == q.agreement) else { continue };
            let draw = w.cx.rng(&format!("hours-consent-{}-{}", q.agreement, t.div_euclid(DAY))).below(10_000) as i64;
            let life = self.life(w.pic, t, w.acc.as_ref().map(|a| a.balance));
            let agree = self.mind.choose_conduct(w.cx, &life, ConductAsk { conduct: "agree_hours_cut".into(), base_bps: q.consent_bps, draw_bps: draw, ..Default::default() }).does;
            if agree {
                if let Some(j) = self.s.job.as_mut() {
                    j.coming = Some((q.from.max(t + 3 * DAY), q.wage));
                }
            }
            self.tell(
                w,
                mine("job", &job.employer, if agree { "hours_agreed" } else { "hours_refused" }, facts([("minutes_week", json!(q.hours_tenths * 6)), ("wage", json!(q.wage)), ("was", json!(job.wage))])),
            );
            let hours = tenths_words(q.hours_tenths);
            let pay_words = Self::wk_usd(w, q.wage);
            let why = if agree {
                format!("Our employer asks us to agree to cut hours ({hours} a week, {pay_words} a pay), because there is not the trade for everyone's full week: agreeing, rather than see someone let go.")
            } else {
                format!("Our employer asks us to agree to cut hours ({hours} a week, {pay_words} a pay): we do not agree.")
            };
            let words = if agree { "I agree to the cut in my hours you asked for." } else { "I do not agree to the cut in my hours." };
            let d = crate::papers::data(&HoursReply { agreement: q.agreement.clone(), agree, notice: q.notice.clone() });
            w.push(because(why, vec![say("hours_reply", words, Say { to: Some(vec![job.employer.clone()]), visible: only(&self.me, &job.employer), basis: Some(q.notice.clone()), data: Some(d), ..Default::default() })]));
        }
    }

    /// Pay come short: owed us by our employer, for as long as it is not put right (citizen.ts 3195): a grievance,
    /// kept by recourse (said to the mind the first time; its sum kept up to date while it is held).
    pub fn short_pay(&mut self, w: &mut Week) {
        if !friction_on(w) {
            return;
        }
        let Some(job) = self.s.job.clone() else { return };
        let Some(short) = job.short.filter(|s| *s != 0) else { return };
        let evidence = self.book.get(&job.agreement).map(|r| super::recourse::tendered(r));
        let g = self.grieve(w, "underpaid", &job.employer, Some(&job.agreement), Some(short), None, 8_000, "security", Some("short pay"));
        if g.evidence.is_none() {
            g.evidence = evidence;
        }
    }

    /// Stopping work at our age for it (the world's one age, or our own): notice to our employer (citizen.ts 3559-3567).
    pub fn stop_work(&mut self, w: &mut Week) {
        let t = w.t;
        let age = w.pic.body.as_ref().map_or(0, |b| (t - b.born_at).div_euclid(self.p.year.max(1)));
        let Some(stop) = self.s.stop_age else { return };
        if self.s.retired || age < stop {
            return;
        }
        self.s.retired = true;
        if let Some(job) = &self.s.job {
            let why = match self.p.retirement_age {
                Some(r) if r == stop => format!("We've reached the retirement age ({r}): retiring, with the notice our job asks."),
                _ => format!("We've reached the age at which we stop work ({stop}): retiring, with the notice our job asks."),
            };
            w.push(because(why, vec![notice(&job.agreement, "Retiring.")]));
        }
    }

    /// Looking for work: where someone told us about first, then the best-paid posting (citizen.ts 3659-3698).
    /// Someone who has given up on finding work is not looking for as long as that lasts.
    pub fn look_for_work(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let Some(acc) = w.acc.clone() else { return };
        let initiative = self.mind.initiative();
        let working = self.s.job.is_some() || self.s.own_work.is_some();
        if initiative && working && self.s.discouraged_until > 0 {
            self.s.discouraged_until = t;
        }
        if initiative && self.s.discouraged_until > 0 && t >= self.s.discouraged_until {
            self.s.discouraged_until = 0;
            let d = crate::papers::data(&WorkSearch { looking: true });
            w.push(because(if working { "In work again." } else { "Looking for work again." }, vec![say("work_search", "Looking for work again.", Say { visible: Some(Visible::Only(vec![me.clone()])), data: Some(d), ..Default::default() })]));
        }
        let job = self.s.job.clone();
        let looking = job.is_none() || (self.work.searching_work && self.housing.switching.is_none());
        if !looking || self.s.own_work.is_some() || self.s.retired || !self.p.in_labour_force || t < self.s.discouraged_until {
            return;
        }
        // In work, only postings that pay better than ours, elsewhere (and, where the world says what holds people,
        // enough better).
        let held = self.wk_held_in(w, t, None);
        let better = |p: &Person, r: &Record| -> bool {
            let Some(j) = &job else { return true };
            let d = data(r);
            let (wage, period) = (d.i("wage").unwrap_or(0), d.i("period").unwrap_or(j.period));
            r.speaks_for.as_deref() != Some(j.employer.as_str())
                && wage * j.period > j.wage * period
                && (held == 0 || wage * j.period * 10_000 > j.wage * period * (10_000 + p.wk_held_in(w, t, d.s("industry"))))
        };
        let told: Vec<Arc<Record>> = if job.is_some() { vec![] } else { self.s.lead_jobs.iter().filter(|id| !self.work.applied.contains(*id)).filter_map(|id| self.wk_record(w.pic, id)).collect() };
        let told_ids: BTreeSet<String> = told.iter().map(|r| r.id.clone()).collect();
        let mut posts: Vec<Arc<Record>> = told.clone();
        posts.extend(self.s.found_jobs.iter().filter(|id| !told_ids.contains(*id)).filter_map(|id| self.wk_record(w.pic, id)));
        posts.retain(|r| !self.work.applied.contains(&r.id) && r.speaks_for.is_some() && better(self, r));
        self.work.searching_work = false;
        // An employer is one option (its first posting: one we were told of, if any).
        let mut by_employer: Vec<(String, Arc<Record>)> = vec![];
        for r in posts {
            let e = r.speaks_for.clone().unwrap_or_default();
            if !by_employer.iter().any(|(x, _)| *x == e) {
                by_employer.push((e, r));
            }
        }
        if by_employer.is_empty() {
            return;
        }
        // (Those we know who work there count as others having gone there: that is the mind's word of mouth, so life
        // counts only where someone told us to look.)
        let options: Vec<Choice> = by_employer
            .iter()
            .map(|(e, r)| {
                let offer = crate::common::part(r, crate::common::Piece::Offer);
                let d = data(r);
                let f = if offer.is_null() {
                    Facts { money_per_month: div_round(d.i("wage").unwrap_or(0) * MONTH, d.i("period").unwrap_or(14 * DAY).max(1)), work_hours_per_month: Some(160), ..Default::default() }
                } else {
                    facts_of(offer)
                };
                Choice { key: e.clone(), facts: Some(f), others: Some(i64::from(told_ids.contains(&r.id))), meaning: None }
            })
            .collect();
        let life = self.life(w.pic, t, Some(acc.balance));
        let d = self.mind.decide(w.cx, &life, Decide { domain: "job".into(), options, satisfied_here: Some(if job.is_some() { 10_000 } else { 0 }), purpose: Some("job".into()), ..Default::default() });
        let Some((employer, best)) = d.key.as_ref().and_then(|k| by_employer.iter().find(|(e, _)| e == k)).cloned() else { return };
        self.work.applied.insert(best.id.clone());
        if let Some(i) = data(&best).s("industry") {
            self.s.industry_of.insert(employer.clone(), i.to_string());
        }
        let how = match d.strategy.as_str() {
            "imitate" => ", where people we know told us to look or work",
            "compare" => ", with an employer we know",
            _ => ", weighing each job's pay and hours",
        };
        let ours = job.as_ref().map_or(String::new(), |j| format!(", better than ours ({})", Self::wk_usd(w, j.wage)));
        // (Our trade: where we work, or last worked, as we know its industry; else the one we had as the year began.)
        let trade = [self.s.job.as_ref().map(|j| j.employer.clone()), self.s.last_employer.clone()]
            .into_iter()
            .flatten()
            .find_map(|e| self.s.industry_of.get(&e).cloned())
            .or_else(|| self.p.trade.clone());
        let paper = crate::papers::data(&JobApplication { posting: best.id.clone(), account: acc.account.clone(), trade });
        w.push(because(
            format!("Applying for a job at {} a pay period{ours}{how}.", Self::wk_usd(w, data(&best).i("wage").unwrap_or(0))),
            vec![say("job_application", "Application for the advertised job.", Say { to: Some(vec![employer.clone()]), visible: only(&me, &employer), data: Some(paper), basis: Some(best.id.clone()), ..Default::default() })],
        ));
    }

    /// Starting a business (citizen.ts 3698-3802; docs/behaviour/entry.md): the capital a new business calls for, put
    /// in; a business of one from home, with the month's chance; one given up that pays no living; premises bought for a
    /// venture, with the month's chance. (docs/risks.md A-1/ME-1: the births come at a set rate, the world's
    /// `found_bps` and `found_own_ppm` shifted by who the person is; lane C1 replaces that with its own entry. The
    /// draw is as TS has it.)
    pub fn ventures(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let Some(acc) = w.acc.clone() else { return };
        // A firm we founded: its id, or its refusal, as absorb read our act's outcome.
        if let Some(id) = self.absorbed.founded_firm.take() {
            if let Some(f) = self.work.founded.as_mut() {
                f.firm = Some(id);
            }
        }
        if std::mem::take(&mut self.absorbed.firm_refused) {
            self.work.founded = None;
        }
        // The capital our new business calls for.
        if let Some(f) = self.work.founded.clone().filter(|f| f.firm.is_some() && !f.paid) {
            let firm = f.firm.clone().unwrap_or_default();
            let calls: Vec<Arc<Record>> = self.book.all("capital_call").filter(|r| r.speaks_for.as_deref() == Some(firm.as_str()) && crate::common::addressed_to(r).contains(&me)).cloned().collect();
            // (TS paid every call of the firm's addressed to us, without breaking: so here; a firm calls once.)
            for r in calls {
                let d = data(&r);
                let asked = d.i("amount").unwrap_or(0);
                let account = d.s("account").unwrap_or_default().to_string();
                if let Some(x) = self.work.founded.as_mut() {
                    x.paid = true;
                }
                let amount = acc.balance.min(asked);
                if amount > 0 {
                    w.push(because(format!("Putting the {} of capital into our new business.", Self::wk_usd(w, amount)), vec![pay(&account, amount, Pay { from: Some(acc.account.clone()), for_: Some("Capital.".into()), ..Default::default() }, w.cx)]));
                }
                self.tell(w, mine("venture", "found", "capital_called", facts([("firm", json!(firm)), ("asked", json!(asked)), ("paid", json!(amount.max(0)))])));
                // (A business of one: our work from now on, trading from our home; what it clears is our income.)
                if let Some((home, expect)) = f.own.clone() {
                    self.s.own_work = Some(super::params::OwnWork { firm: firm.clone(), account, at: None, home: Some(home.clone()), expect_per_month: expect });
                    self.work.trading_from = Some(home);
                    self.work.own_since = t;
                    self.work.next_own_review = t + MONTH;
                }
            }
        }
        self.found_own(w, &acc);
        self.give_up_own(w);
        self.found_premises(w, &acc);
    }

    /// A business of one (docs/behaviour/entry.md, "Starting a business of one"): in the labour force, with a home to
    /// trade from and savings for its stock beside a month or so of housing and essentials, with the month's chance.
    /// Someone in a job gives notice first and starts when it has run; someone out of work starts at once.
    fn found_own(&mut self, w: &mut Week, acc: &crate::common::OwnAccount) {
        let t = w.t;
        let me = self.me.clone();
        let Some(v) = self.p.ventures.iter().find(|v| v.own).cloned() else { return };
        let wanted = t < self.s.venture_wanted;
        let due = match self.work.venturing {
            Some(_) => self.s.job.is_none(),
            None => t >= self.work.next_own_venture,
        };
        if self.work.founded.is_some() || self.s.own_work.is_some() || self.s.retired || !self.p.in_labour_force || !due {
            return;
        }
        self.work.next_own_venture = t + MONTH;
        let dwelling = self.wk_dwelling();
        let cell = dwelling.as_deref().and_then(|d| Self::wk_cell_of(w.pic, structure_of(d)));
        let housing = self.s.home.as_ref().map(|h| h.rent).or_else(|| self.s.share.as_ref().map(|s| s.0)).unwrap_or(0);
        let means = dwelling.is_some() && cell.is_some() && acc.balance >= v.capital + self.p.found_own_buffer_months * (housing + self.p.essentials);
        let venturing = self.work.venturing.is_some();
        // (Entry by expected profit, weighed against what we have: no rate of births. Meant by a founding's draw: started
        // as soon as there are the means, as before.)
        let founds = means
            && (venturing || wanted || {
                // (Hands only where the business can take them on: its room for staff.)
                let hires = v.role_module.get("params").and_then(|p| p.get("max_staff")).and_then(crate::papers::lenient::whole).unwrap_or(0) > 0;
                let e = self.venture_prospect(w.pic, &v, hires).map(|p| oikos_rules::entry::expected(&p));
                e.is_some_and(|e| e.units > 0 && self.weigh_venture(w, e.profit, false))
            });
        if means && !venturing && wanted {
            self.wk_record_choice(w, "venture", "found_own", "not", 10_000, founds);
        }
        if !means {
            self.work.venturing = None;
            return;
        }
        if !founds {
            return;
        }
        if let Some(job) = self.s.job.clone() {
            if self.housing.switching.is_some() {
                return;
            }
            if !venturing {
                self.work.venturing = Some(t);
                if t < self.wk_job_ends(&job) && self.book.notices(&job.agreement).next().is_none() {
                    w.push(because(
                        format!("We have {} saved and mean to work for ourselves: giving notice at {}, to start a business of our own when it has run.", Self::wk_usd(w, acc.balance), job.employer),
                        vec![notice(&job.agreement, "Resigning: starting a business of my own.")],
                    ));
                }
            }
            return;
        }
        self.work.venturing = None;
        let dwelling = dwelling.unwrap_or_default();
        // (`{values}`: the person's values, which are the mind's: each read through the seam as how far it sits from the
        // town's (hundredths of a standard deviation) and written back in the town's terms, basis points, as TS wrote
        // `mind.person.values`.)
        let owner_values = self.owner_values(w.cx);
        let with: BTreeMap<&str, Value> = [
            ("{values}", owner_values),
            ("{structure}", json!(structure_of(&dwelling))),
            ("{home}", json!(dwelling)),
            ("{cell}", json!(cell)),
            ("{founder}", json!(me)),
            ("{capital}", json!(v.capital)),
        ]
        .into_iter()
        .collect();
        // (What we expect it to pay us a month, by what we know of its market, until it has a record of its own; the
        // venture's figure where we know no price.)
        let expect = self.venture_prospect(w.pic, &v, false).map(|p| oikos_rules::entry::expected(&p).profit).filter(|x| *x > 0).or(v.expect_per_month).unwrap_or(0);
        self.work.founded = Some(Founded { firm: None, capital: v.capital, paid: false, own: Some((dwelling.clone(), expect)) });
        let entity = call(
            "entity",
            vec![
                ("kind", Some(arg(&v.kind))),
                ("name", Some(text(format!("{} ({me})", v.name)))),
                ("position", Some(text("Owner"))),
                ("channels", Some(json(fill(&Value::Array(v.channels.clone()), &with, None)))),
                ("role_module", Some(json(fill(&v.role_module, &with, None)))),
            ],
        );
        w.push(step_of_lines(
            format!("We have {} saved and a home to trade from: starting a business of our own there ({}), putting in {}.", Self::wk_usd(w, acc.balance), v.name.to_lowercase(), Self::wk_usd(w, v.capital)),
            vec![bound("firm", entity)],
        ));
        self.absorbed.pending_firm = Some(v.capital);
    }

    /// Giving a business of one up: one that has not paid its owner a living for months is closed by them, and they
    /// look for work again. Not in its first months, while customers are still finding it.
    fn give_up_own(&mut self, w: &mut Week) {
        let t = w.t;
        let Some(own) = self.s.own_work.clone() else { return };
        if self.work.own_since < 0 || t < self.work.next_own_review {
            return;
        }
        self.work.next_own_review = t + MONTH;
        let months = (t - self.work.own_since).div_euclid(MONTH);
        let since = t - self.p.give_up_months * MONTH;
        let drawn: i64 = self.absorbed.drawn_log.iter().filter(|d| d.0 >= since).map(|d| d.1).sum();
        self.absorbed.drawn_log.retain(|d| d.0 >= since);
        if months < self.p.give_up_months || drawn * 10_000 >= self.p.give_up_below_bps * self.p.essentials * self.p.give_up_months {
            return;
        }
        self.tell(w, mine("own_work", &own.firm, "given_up", facts([("months", json!(months)), ("drawn", json!(drawn)), ("essentials", json!(self.p.essentials))])));
        let d = crate::papers::data(&TradingFrom { closed: Some(true), ..Default::default() });
        w.push(because(
            format!("Our business has paid us {} in {} months, under {}% of what essentials cost: closing it, and looking for work.", Self::wk_usd(w, drawn), self.p.give_up_months, self.p.give_up_below_bps / 100),
            vec![say("trading_from", "Closing: the business is given up.", Say { to: Some(vec![own.firm.clone()]), visible: only(&self.me, &own.firm), data: Some(d), ..Default::default() })],
        ));
        self.s.own_work = None;
        self.work.trading_from = None;
        self.work.own_since = -1;
        self.work.founded = None;
    }

    /// Premises for sale of a kind this world has ventures for; savings for them, the venture's capital and three
    /// months' housing and essentials; and the month's chance. We found the business and hold its first position.
    fn found_premises(&mut self, w: &mut Week, acc: &crate::common::OwnAccount) {
        let t = w.t;
        let me = self.me.clone();
        if self.work.founded.is_some() || self.p.ventures.iter().all(|v| v.own) || t < self.work.next_venture || self.s.retired || !self.p.in_labour_force {
            return;
        }
        self.work.next_venture = t + MONTH;
        let housing = self.s.home.as_ref().map(|h| h.rent).or_else(|| self.s.share.as_ref().map(|s| s.0)).unwrap_or(0);
        let ventures = self.p.ventures.clone();
        let venture_of = |r: &Record| data(r).s("type").and_then(|k| ventures.iter().find(|v| !v.own && v.kind == k)).cloned();
        let mut listings: Vec<Arc<Record>> = self.wk_for_sale(w.pic).into_iter().filter(|l| venture_of(l).is_some()).collect();
        listings.sort_by(|a, b| data(a).i("price").unwrap_or(0).cmp(&data(b).i("price").unwrap_or(0)).then_with(|| filed_before(&a.id, &b.id)));
        let essentials = self.p.essentials;
        let l = listings.into_iter().find(|x| venture_of(x).is_some_and(|v| acc.balance >= data(x).i("price").unwrap_or(0) + v.capital + 3 * (housing + essentials)));
        // (What a model would say it meant to someone like us, in a run with the sparse mind, is the mind's question:
        // not asked here.)
        let Some(l) = l else { return };
        let Some(v) = venture_of(&l) else { return };
        // (Entry by expected profit: the shop's sales among the sellers of its kind we know, served by hands whose margin
        // pays their wage, as many as its room holds; we keep our job and manage it. Meant by a founding's draw: bought,
        // as before.)
        let wanted = t < self.s.venture_wanted;
        let founds = wanted || {
            let room = v.role_module.get("params").and_then(|p| p.get("max_staff")).and_then(crate::papers::lenient::whole).unwrap_or(1).max(1);
            match self.venture_prospect(w.pic, &v, true) {
                Some(p) if p.wage > 0 => {
                    // (Nobody serves for nothing: the hand who serves what an owner alone would is paid too.)
                    let e = oikos_rules::entry::expected(&p);
                    let hands = (e.hired + 1).min(room);
                    let profit = e.units.min(hands * p.units_per_worker) * (p.price - p.unit_cost).max(0) - hands * p.wage;
                    e.units > 0 && self.weigh_venture(w, profit, true)
                }
                _ => false,
            }
        };
        if wanted {
            self.wk_record_choice(w, "venture", "found", "not", 10_000, founds);
        }
        if !founds {
            return;
        }
        let d = data(&l);
        let price = d.i("price").unwrap_or(0);
        let structure = d.s("structure").unwrap_or_default().to_string();
        let capital = price + v.capital;
        let owner_values = self.owner_values(w.cx);
        let with: BTreeMap<&str, Value> = [
            ("{values}", owner_values),
            ("{structure}", json!(structure)),
            ("{cell}", d.get("cell").cloned().unwrap_or(Value::Null)),
            ("{listing}", json!(l.id)),
            ("{founder}", json!(me)),
            ("{capital}", json!(capital)),
        ]
        .into_iter()
        .collect();
        self.work.founded = Some(Founded { firm: None, capital, paid: false, own: None });
        let entity = call(
            "entity",
            vec![
                ("kind", Some(arg(&v.kind))),
                ("name", Some(text(format!("{} ({structure})", v.name)))),
                ("position", Some(text("Manager"))),
                ("channels", Some(json(fill(&Value::Array(v.channels.clone()), &with, Some(&structure))))),
                ("role_module", Some(json(fill(&v.role_module, &with, Some(&structure))))),
            ],
        );
        w.push(step_of_lines(
            format!(
                "{structure} (a {}) is for sale at {}, and we have {}: starting a {} there, putting in {}.",
                d.s("type").unwrap_or_default(),
                Self::wk_usd(w, price),
                Self::wk_usd(w, acc.balance),
                v.kind,
                Self::wk_usd(w, capital)
            ),
            vec![bound("firm", entity)],
        ));
        self.absorbed.pending_firm = Some(capital);
    }

    /// Taking (crime; citizen.ts 3820-3842): in need (less than a month's essentials), at work where our employer
    /// sells goods, rarely, the more rarely the likelier we'd be caught; and home with them.
    pub fn taking(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let (Some(crime), Some(job)) = (self.p.crime.clone(), self.s.job.clone()) else { return };
        let Some(workplace) = job.workplace.clone() else { return };
        let sells = crate::common::latest_by_speaker(&self.book, "price_list", |_| true)
            .get(&Some(job.employer.as_str()))
            .and_then(|r| data(r).get("goods"))
            .is_some_and(|g| g.get(&self.p.goods).is_some());
        let at_work = w.pic.body.as_ref().is_some_and(|b| b.in_space.as_deref() == Some(workplace.as_str()));
        let balance = w.acc.as_ref().map_or(0, |a| a.balance);
        if !sells || !at_work || balance >= self.p.essentials || t < self.work.next_take_chance {
            return;
        }
        self.work.next_take_chance = t + MONTH;
        // (A want long unmet, with little trust in the town and little belief that anything one does counts, sways it.
        // Whether a want has grown or been tried enough is the mind's, and the seam does not say it yet: no strain
        // until it does.)
        let long_unmet = false;
        let strain = if self.mind.initiative() && long_unmet {
            -(self.mind.agency_z() + self.p.electoral_town.as_deref().map_or(0, |town| self.mind.trust_z(town))) / 2
        } else {
            0
        };
        let base = swayed(div_round(crime.take_bps * (10_000 - crime.caught_bps), 10_000), strain, wants_sway(w, "agency"));
        let home_at = self.s.home.as_ref().filter(|h| h.moved_in).map(|h| structure_of(&h.space).to_string()).or_else(|| self.s.living_at.as_deref().map(|l| structure_of(l).to_string()));
        let Some(home_at) = home_at else { return };
        let draw = w.cx.rng("take").below(10_000) as i64;
        let life = self.life(w.pic, t, Some(balance));
        let takes = self
            .mind
            .choose_conduct(w.cx, &life, ConductAsk { conduct: "take_from_employer".into(), base_bps: base, draw_bps: draw, lean: true, act: true, record: Some(("take".into(), "take".into(), "not".into())), ..Default::default() })
            .does;
        if !takes {
            return;
        }
        let at = structure_of(&workplace).to_string();
        let q = crime.quantity.to_string();
        w.push(because(
            format!("We can't make ends meet ({}, less than a month's essentials): taking {} {} from {}'s stock at work, and home with them.", Self::wk_usd(w, balance), crime.quantity, self.p.goods, job.employer),
            vec![
                call("take", vec![("kind", Some(arg(&self.p.goods))), ("quantity", Some(text(q.clone()))), ("from", Some(arg(&job.employer))), ("at", Some(arg(&at)))]),
                call("goods", vec![("kind", Some(arg(&self.p.goods))), ("quantity", Some(text(q))), ("to", Some(arg(&me))), ("at", Some(arg(&home_at))), ("from_at", Some(arg(&at)))]),
            ],
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::super::absorb::HoursAsked;
    use super::super::person::Home;
    use super::*;
    use crate::{Ctx, Draws, WorldInfo};

    const YEAR: i64 = 365 * DAY;

    fn ctx_with(extra: Value) -> Ctx {
        let currency = oikos_sight::calls::Currency { code: "XTS".into(), symbol: Some("$".into()), minor_units: 2, ..Default::default() };
        let mut params = json!({ "mind": "plain", "essentials": 40_000, "union": "union" });
        for (k, v) in extra.as_object().cloned().unwrap_or_default() {
            params[k] = v;
        }
        Ctx {
            participant: "p.ann".into(),
            performer: Default::default(),
            entity: "ann".into(),
            position: None,
            params: serde_json::from_value(params).unwrap(),
            world: Arc::new(WorldInfo { currency: Some(currency), dials: json!({ "friction_bps": 10_000 }), ..Default::default() }),
        }
    }
    fn rec(v: Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).expect("a record"))
    }
    fn st(id: &str, kind: &str, speaks_for: &str, data: Value) -> Arc<Record> {
        rec(json!({ "id": id, "record": "statement", "author": "p.x", "speaks_for": speaks_for, "at": 0, "visible_to": "public", "kind": kind, "text": kind, "data": data, "addressed_to": ["ann"] }))
    }
    fn sig(id: &str, ag: &str, who: &str) -> Arc<Record> {
        rec(json!({ "id": id, "record": "signature", "author": "p", "at": 0, "visible_to": "public", "agreement": ag, "as": who }))
    }
    fn job_offer(id: &str, employer: &str, wage: i64) -> Arc<Record> {
        rec(json!({ "id": id, "record": "agreement", "author": "p.x", "at": 0, "visible_to": "public", "terms": { "template": "employment", "parties": [employer, "ann"], "commitments": [
            { "who": employer, "does": { "outcome": { "money": { "to": "acc.ann", "amount": wage } } }, "every": 14 * DAY },
            { "who": "ann", "does": { "outcome": { "work": { "task": "serve", "at": format!("{employer}/floor") } } } } ] } }))
    }
    fn pic(t: i64, born_at: Option<i64>, street: bool) -> Picture {
        homes_around(t, born_at, if street { 1 } else { 0 })
    }
    /// A picture whose street shows ann's block, of so many homes (none: no street seen).
    fn homes_around(t: i64, born_at: Option<i64>, homes: u32) -> Picture {
        let mut channels = BTreeMap::new();
        if homes > 0 {
            let cell: oikos_sight::SiteCell = serde_json::from_value(json!({ "cell": "c.1", "x": 0, "y": 0, "structure": { "structure": "b1", "type": "house", "at": "c.1", "w": 1, "h": 1, "complete": true,
                "spaces": [{ "space": "b1/dwelling.1", "kind": "dwelling", "capacity": 4, "count": homes, "occupants": ["ann"] }] } }))
            .unwrap();
            channels.insert("street".to_string(), Seen::Sites { as_of: t, cells: Arc::new(vec![cell]), visit: None });
        }
        let body = born_at.map(|b| serde_json::from_value(json!({ "born_at": b, "present": true, "alive": true })).unwrap());
        Picture {
            participant: "p.ann".into(),
            t,
            status: serde_json::from_value(json!("active")).unwrap(),
            entity: "ann".into(),
            as_position: None,
            body,
            positions: vec![],
            outcomes: vec![],
            inbox: vec![],
            channels,
            asking: vec![],
            readings: Default::default(),
            woke_for: "cadence".into(),
            since: 0,
        }
    }
    fn acc(balance: i64) -> Option<crate::common::OwnAccount> {
        Some(crate::common::OwnAccount { account: "acc.ann".into(), balance, custodian: "bank".into(), currency: "XTS".into() })
    }
    /// One part of the plan, run on a picture: the programs it planned, as the call language writes them.
    fn run(ann: &mut Person, c: &Ctx, p: &Picture, balance: i64, part: impl FnOnce(&mut Person, &mut Week)) -> Vec<String> {
        let mut d = Draws::new("p.ann", "self");
        let mut cx = Cx::new(p.t, c, &mut d, 1, vec![]);
        let mut w = Week { pic: p, cx: &mut cx, t: p.t, acc: acc(balance), steps: vec![] };
        part(ann, &mut w);
        w.steps.iter().map(|s| oikos_sight::calls::program_text(&s.step.program())).collect()
    }
    fn job(employer: &str, since: i64) -> Job {
        Job { agreement: format!("rec.{employer}"), employer: employer.into(), wage: 100_000, period: 14 * DAY, workplace: Some(format!("{employer}/floor")), since, ..Default::default() }
    }

    #[test]
    fn wages_unpaid_past_a_period_and_its_grace_resign_and_claim_what_is_owed_and_the_job_ends() {
        let c = ctx_with(json!({}));
        let mut ann = Person::new(&c).unwrap();
        ann.s.job = Some(Job { paid_at: Some(DAY), ..job("shop", 0) });
        // (A pay period and five days' grace: not yet.)
        assert!(run(&mut ann, &c, &pic(20 * DAY, None, false), 0, |a, w| a.unpaid_wages(w)).is_empty());
        let out = run(&mut ann, &c, &pic(30 * DAY, None, false), 0, |a, w| a.unpaid_wages(w));
        assert_eq!(out.len(), 1);
        assert!(out[0].contains("notice=rec.shop") && out[0].contains("claim(") && out[0].contains("\"amount\":200000"), "two periods missed: {}", out[0]);
        let j = ann.s.job.clone().unwrap();
        assert!(j.claimed && j.left_at == Some(30 * DAY));
        assert!(run(&mut ann, &c, &pic(31 * DAY, None, false), 0, |a, w| a.unpaid_wages(w)).is_empty(), "claimed once");
        run(&mut ann, &c, &pic(31 * DAY, None, false), 0, |a, w| a.job_end(w));
        assert!(ann.s.job.is_none());
        assert_eq!((ann.s.jobless_since, ann.s.last_employer.as_deref()), (Some(31 * DAY), Some("shop")));
        // Work by the day with no pay for a week: ended, with nothing claimed.
        let mut bob = Person::new(&c).unwrap();
        bob.s.job = Some(Job { period: DAY, ..job("yard", 0) });
        let out = run(&mut bob, &c, &pic(7 * DAY, None, false), 0, |a, w| a.unpaid_wages(w));
        assert!(out.len() == 1 && out[0].contains("notice=rec.yard") && !out[0].contains("claim("), "{out:?}");
        // On strike, no pay is no grievance.
        let mut cal = Person::new(&c).unwrap();
        cal.s.job = Some(job("shop", 0));
        cal.s.striking = Some(("shop".into(), true, None));
        assert!(run(&mut cal, &c, &pic(60 * DAY, None, false), 0, |a, w| a.unpaid_wages(w)).is_empty());
    }

    #[test]
    fn a_better_job_taken_starts_once_our_notice_has_run_signed_and_gone_to() {
        let c = ctx_with(json!({}));
        let mut ann = Person::new(&c).unwrap();
        ann.book.take_all(&[job_offer("rec.10", "works", 150_000), sig("rec.11", "rec.10", "works")]);
        ann.housing.switching = Some(("rec.10".into(), 150_000));
        ann.s.job = Some(job("shop", 0));
        // (Still in the old job: nothing yet.)
        assert!(run(&mut ann, &c, &pic(10 * DAY, None, false), 0, |a, w| a.switch_start(w)).is_empty());
        ann.s.job = None;
        let out = run(&mut ann, &c, &pic(20 * DAY, None, false), 0, |a, w| a.switch_start(w));
        assert!(out.len() == 1 && out[0].contains("sign=rec.10") && out[0].contains("works/floor"), "{out:?}");
        let j = ann.s.job.clone().unwrap();
        assert_eq!((j.employer.as_str(), j.wage, j.since), ("works", 150_000, 20 * DAY));
        assert!(ann.housing.switching.is_none());
    }

    #[test]
    fn at_the_age_one_stops_work_a_worker_gives_notice_once_and_is_retired() {
        let c = ctx_with(json!({ "retirement_age": 67 }));
        let mut ann = Person::new(&c).unwrap();
        assert_eq!(ann.s.stop_age, Some(67));
        ann.s.job = Some(job("shop", 0));
        assert!(run(&mut ann, &c, &pic(DAY, Some(-66 * YEAR), false), 0, |a, w| a.stop_work(w)).is_empty());
        let out = run(&mut ann, &c, &pic(DAY, Some(-67 * YEAR), false), 0, |a, w| a.stop_work(w));
        assert!(out.len() == 1 && out[0].contains("notice=rec.shop") && out[0].contains("Retiring."), "{out:?}");
        assert!(ann.s.retired);
        assert!(run(&mut ann, &c, &pic(2 * DAY, Some(-67 * YEAR), false), 0, |a, w| a.stop_work(w)).is_empty());
        // Retired, nobody looks for work.
        ann.s.job = None;
        assert!(ann.job_market_looks().is_empty());
    }

    #[test]
    fn out_of_work_one_applies_for_the_best_paid_posting_once_and_in_work_only_for_better_elsewhere() {
        let c = ctx_with(json!({}));
        let mut ann = Person::new(&c).unwrap();
        let post = |id: &str, by: &str, wage: i64| rec(json!({ "id": id, "record": "statement", "author": "p.x", "speaks_for": by, "at": 0, "visible_to": "public", "kind": "job_posting", "text": "Hiring", "data": { "wage": wage, "period": 14 * DAY, "industry": "retail" } }));
        ann.book.take_all(&[post("rec.1", "shop", 90_000), post("rec.2", "works", 120_000)]);
        ann.s.found_jobs = vec!["rec.1".into(), "rec.2".into()];
        assert_eq!(ann.job_market_looks().len(), 1);
        let out = run(&mut ann, &c, &pic(DAY, None, false), 500_000, |a, w| a.look_for_work(w));
        assert!(out.len() == 1 && out[0].contains("job_application") && out[0].contains("rec.2") && out[0].contains("works"), "{out:?}");
        assert_eq!(ann.s.industry_of.get("works").map(String::as_str), Some("retail"));
        let again = run(&mut ann, &c, &pic(2 * DAY, None, false), 500_000, |a, w| a.look_for_work(w));
        assert!(again.len() == 1 && again[0].contains("rec.1"), "the one applied for is not applied for again: {again:?}");
        // In work at the shop, looking: only the better-paid posting elsewhere.
        let mut bob = Person::new(&c).unwrap();
        bob.book.take_all(&[post("rec.1", "shop", 90_000), post("rec.2", "works", 99_000)]);
        bob.s.found_jobs = vec!["rec.1".into(), "rec.2".into()];
        bob.s.job = Some(job("shop", 0));
        bob.work.searching_work = true;
        assert!(run(&mut bob, &c, &pic(DAY, None, false), 500_000, |a, w| a.look_for_work(w)).is_empty(), "99,000 does not beat 100,000");
        assert!(!bob.work.searching_work);
        // Given up on finding work: not looking until then.
        let mut cal = Person::new(&c).unwrap();
        cal.book.take_all(&[post("rec.1", "shop", 90_000)]);
        cal.s.found_jobs = vec!["rec.1".into()];
        cal.s.discouraged_until = 10 * DAY;
        assert!(run(&mut cal, &c, &pic(DAY, None, false), 500_000, |a, w| a.look_for_work(w)).is_empty());
    }

    #[test]
    fn asked_to_agree_to_a_cut_a_worker_answers_by_a_paper_and_the_cut_is_theirs_only_if_they_agree() {
        let c = ctx_with(json!({}));
        for (consent, agree) in [(10_000, true), (0, false)] {
            let mut ann = Person::new(&c).unwrap();
            ann.s.job = Some(Job { agreement: "J1".into(), ..job("factory-1", 0) });
            ann.absorbed.hours_asked = vec![
                HoursAsked { notice: "rec.5".into(), agreement: "J1".into(), wage: 50_000, from: 10 * DAY, consent_bps: consent, hours_tenths: 200 },
                HoursAsked { notice: "rec.6".into(), agreement: "J9".into(), wage: 1, from: 10 * DAY, consent_bps: 10_000, hours_tenths: 10 },
            ];
            let out = run(&mut ann, &c, &pic(3 * DAY, None, false), 0, |a, w| a.hours_asked(w));
            assert_eq!(out.len(), 1, "a cut of someone else's job is nothing of ours");
            assert!(out[0].contains("hours_reply") && out[0].contains(&format!("\"agree\":{agree}")) && out[0].contains("factory-1"), "{out:?}");
            assert_eq!(ann.s.job.as_ref().unwrap().coming, agree.then_some((10 * DAY, 50_000)));
            assert!(ann.absorbed.hours_asked.is_empty());
        }
    }

    #[test]
    fn pay_come_short_is_a_grievance_said_once_and_nothing_with_the_dial_off() {
        let c = ctx_with(json!({}));
        let mut ann = Person::new(&c).unwrap();
        ann.s.job = Some(Job { short: Some(6_000), ..job("factory-1", 0) });
        run(&mut ann, &c, &pic(15 * DAY, None, false), 0, |a, w| a.short_pay(w));
        run(&mut ann, &c, &pic(22 * DAY, None, false), 0, |a, w| a.short_pay(w));
        assert_eq!(ann.recourse.grievances.keys().collect::<Vec<_>>(), ["underpaid:rec.factory-1"]);
        assert_eq!(ann.recourse.grievances["underpaid:rec.factory-1"].amount, Some(6_000));
        let mut off = c.clone();
        off.world = Arc::new(WorldInfo { dials: json!({}), ..(*c.world).clone() });
        let mut bob = Person::new(&off).unwrap();
        bob.s.job = Some(Job { short: Some(6_000), ..job("factory-1", 0) });
        run(&mut bob, &off, &pic(15 * DAY, None, false), 0, |a, w| a.short_pay(w));
        assert!(bob.recourse.grievances.is_empty());
    }

    #[test]
    fn a_member_tells_the_union_where_they_work_when_it_changes_and_that_they_no_longer_do_on_leaving() {
        let c = ctx_with(json!({}));
        let mut ann = Person::new(&c).unwrap();
        let m = rec(json!({ "id": "rec.m", "record": "agreement", "author": "p.u", "at": 0, "visible_to": "public", "terms": { "template": "membership", "parties": ["union", "ann"], "commitments": [] } }));
        ann.book.take_all(&[m, sig("rec.m1", "rec.m", "union"), sig("rec.m2", "rec.m", "ann")]);
        ann.s.job = Some(job("shop", 0));
        assert!(run(&mut ann, &c, &pic(DAY, None, false), 0, |a, w| a.union(w)).is_empty(), "the register we joined with has it");
        ann.s.job = Some(job("works", 2 * DAY));
        let out = run(&mut ann, &c, &pic(3 * DAY, None, false), 0, |a, w| a.union(w));
        assert!(out.len() == 1 && out[0].contains("membership_update") && out[0].contains("\"employer\":\"works\""), "{out:?}");
        assert!(run(&mut ann, &c, &pic(4 * DAY, None, false), 0, |a, w| a.union(w)).is_empty());
        let left = ann.leaving_union();
        assert_eq!(left.len(), 1);
        assert!(ann.leaving_union().is_empty(), "said once");
    }

    #[test]
    fn a_stoppage_takes_the_worker_out_of_the_workplace_and_the_return_takes_them_back() {
        let c = ctx_with(json!({}));
        let mut ann = Person::new(&c).unwrap();
        ann.s.job = Some(job("shop", 0));
        ann.s.striking = Some(("shop".into(), false, None));
        // (Without a view of the street, we are taken to be where we work.)
        let out = run(&mut ann, &c, &pic(DAY, None, false), 0, |a, w| a.union(w));
        assert!(out.len() == 1 && out[0].contains("leave=yes") && out[0].contains("shop/floor"), "{out:?}");
        assert_eq!(ann.s.striking, Some(("shop".into(), true, Some("shop/floor".into()))));
        ann.s.striking = None;
        ann.absorbed.back_to = Some(("shop".into(), "shop/floor".into()));
        let back = run(&mut ann, &c, &pic(5 * DAY, None, false), 0, |a, w| a.union(w));
        assert!(back.len() == 1 && back[0].contains("in=shop/floor") && !back[0].contains("leave"), "{back:?}");
        assert!(ann.absorbed.back_to.is_none());
    }

    fn own_venture() -> Value {
        json!([{ "kind": "shop", "name": "A stall", "capital": 50_000, "own": true, "expect_per_month": 200_000, "unit_cost": 800,
            "channels": [{ "id": "street", "at": "{cell}" }], "role_module": { "code": "retailer", "params": { "premises": "{structure}", "home": "{home}", "founder": "{founder}", "price": 1_200, "serve_labour": 600 } } }])
    }
    /// The shops someone knows sell goods, each at `price`.
    fn known_shops(n: usize, price: i64) -> Vec<Arc<Record>> {
        (0..n).map(|i| st(&format!("rec.pl{i}"), "price_list", &format!("shop{i}"), json!({ "goods": { "goods": price }, "account": format!("acc.shop{i}") }))).collect()
    }
    fn at_home(ann: &mut Person) {
        ann.s.home = Some(Home { agreement: "rec.lease".into(), space: "b1/dwelling.1".into(), structure: "b1".into(), rent: 100_000, moved_in: true, ..Default::default() });
    }

    #[test]
    fn someone_out_of_work_with_a_home_and_the_means_starts_a_business_of_one_where_it_pays_puts_in_its_capital_and_trades_from_home() {
        let c = ctx_with(json!({ "ventures": own_venture() }));
        let mut ann = Person::new(&c).unwrap();
        at_home(&mut ann);
        // Two sellers known at 1,200 against 800 to bring in, 200 homes in view buying 10 a month: about 666 a month, $2,664 to us.
        ann.book.take_all(&known_shops(2, 1_200));
        ann.work.next_own_venture = 0;
        // Short of the capital and a month's housing and essentials: nothing.
        assert!(run(&mut ann, &c, &homes_around(DAY, None, 200), 100_000, |a, w| a.ventures(w)).is_empty());
        let p = ann.venture_prospect(&homes_around(DAY, None, 200), &ann.p.ventures[0].clone(), false).unwrap();
        assert_eq!((p.price, p.unit_cost, p.sellers_known, p.households_reached, p.units_per_household), (1_200, 800, 2, 200, 10));
        // With the means: weighed, month by month, against nothing coming in; started within the year.
        let mut out = vec![];
        for m in 1..=12 {
            ann.work.next_own_venture = 0;
            out = run(&mut ann, &c, &homes_around(m * MONTH, None, 200), 500_000, |a, w| a.ventures(w));
            if !out.is_empty() {
                break;
            }
        }
        assert!(out.len() == 1 && out[0].starts_with("firm = entity(") && out[0].contains("\"premises\":\"b1\"") && out[0].contains("\"at\":\"c.1\"") && out[0].contains("\"home\":\"b1/dwelling.1\""), "{out:?}");
        assert_eq!(ann.absorbed.pending_firm, Some(50_000));
        // What it is expected to pay us is what its market gave, not the venture's figure.
        assert_eq!(ann.work.founded.as_ref().and_then(|f| f.own.as_ref()).map(|o| o.1), Some(666 * 400));
        // The firm made, and its call for capital: paid, and it is our work from now on.
        ann.absorbed.pending_firm = None;
        ann.absorbed.founded_firm = Some("firm-1".into());
        ann.book.take_all(&[st("rec.30", "capital_call", "firm-1", json!({ "account": "acc.firm-1", "amount": 50_000 }))]);
        let paid = run(&mut ann, &c, &homes_around(13 * MONTH, None, 200), 500_000, |a, w| a.ventures(w));
        assert!(paid.len() == 1 && paid[0].contains("acc.firm-1") && paid[0].contains("$500.00"), "{paid:?}");
        let own = ann.s.own_work.clone().unwrap();
        assert_eq!((own.firm.as_str(), own.home.as_deref(), own.expect_per_month), ("firm-1", Some("b1/dwelling.1"), 666 * 400));
        assert_eq!(ann.work.trading_from.as_deref(), Some("b1/dwelling.1"));
        // Moved home to nowhere: the business is told it has nowhere to trade from.
        ann.s.home = None;
        let told = run(&mut ann, &c, &pic(13 * MONTH + DAY, None, true), 0, |a, w| a.trading_from(w));
        assert!(told.len() == 1 && told[0].contains("\"nowhere\":true"), "{told:?}");
    }

    #[test]
    fn nobody_starts_a_business_that_is_not_expected_to_beat_what_they_have_however_long_they_weigh_it() {
        let c = ctx_with(json!({ "ventures": own_venture() }));
        // No margin: goods sell for what they cost to bring in.
        let mut ann = Person::new(&c).unwrap();
        at_home(&mut ann);
        ann.book.take_all(&known_shops(2, 800));
        // A crowded market, against a job that pays more than a share of it would.
        let mut bob = Person::new(&c).unwrap();
        at_home(&mut bob);
        bob.book.take_all(&known_shops(40, 1_200));
        bob.s.job = Some(job("works", 0));
        for m in 1..=36 {
            for x in [&mut ann, &mut bob] {
                x.work.next_own_venture = 0;
                assert!(run(x, &c, &homes_around(m * MONTH, None, 200), 5_000_000, |a, w| a.ventures(w)).is_empty(), "month {m}");
            }
        }
        assert!(ann.work.founded.is_none() && bob.work.venturing.is_none());
        // The same crowded market draws someone with nothing coming in: a small share beats nothing.
        let e = oikos_rules::entry::expected(&bob.venture_prospect(&homes_around(DAY, None, 200), &bob.p.ventures[0].clone(), false).unwrap());
        assert!(e.profit > 0 && e.profit < 100_000 * MONTH / (14 * DAY), "{e:?}");
    }

    #[test]
    fn someone_in_a_job_who_means_to_work_for_themself_gives_notice_first() {
        let c = ctx_with(json!({ "ventures": own_venture() }));
        let mut ann = Person::new(&c).unwrap();
        at_home(&mut ann);
        // One seller known: the business would serve about 1,000 a month, $4,000, against a job's $2,143.
        ann.book.take_all(&known_shops(1, 1_200));
        ann.s.job = Some(job("shop", 0));
        let mut out = vec![];
        let mut at = 0;
        for m in 1..=12 {
            ann.work.next_own_venture = 0;
            out = run(&mut ann, &c, &homes_around(m * MONTH, None, 200), 500_000, |a, w| a.ventures(w));
            if !out.is_empty() {
                at = m * MONTH;
                break;
            }
        }
        assert!(out.len() == 1 && out[0].contains("notice=rec.shop"), "{out:?}");
        assert_eq!(ann.work.venturing, Some(at));
        // The job over: the business starts at once.
        ann.s.job = None;
        let out = run(&mut ann, &c, &homes_around(at + 20 * DAY, None, 200), 500_000, |a, w| a.ventures(w));
        assert!(out.len() == 1 && out[0].contains("entity("), "{out:?}");
        assert!(ann.work.venturing.is_none());
    }

    #[test]
    fn a_business_of_one_that_pays_no_living_for_its_months_is_closed_and_not_in_its_first_months() {
        let c = ctx_with(json!({ "own_work": { "firm": "stall-1", "account": "acc.stall", "home": "b1/dwelling.1", "expect_per_month": 100_000 } }));
        let mut ann = Person::new(&c).unwrap();
        assert_eq!((ann.work.own_since, ann.work.trading_from.as_deref()), (0, Some("b1/dwelling.1")));
        ann.absorbed.drawn_log = vec![(10 * DAY, 5_000)];
        ann.work.next_own_review = 0;
        assert!(run(&mut ann, &c, &pic(3 * MONTH, None, false), 0, |a, w| a.ventures(w)).is_empty(), "not in its first months");
        ann.work.next_own_review = 0;
        let out = run(&mut ann, &c, &pic(6 * MONTH + DAY, None, false), 0, |a, w| a.ventures(w));
        assert!(out.len() == 1 && out[0].contains("trading_from") && out[0].contains("\"closed\":true"), "{out:?}");
        assert!(ann.s.own_work.is_none() && ann.work.own_since == -1);
        // One that pays a living goes on.
        let mut bob = Person::new(&c).unwrap();
        bob.absorbed.drawn_log = (0..6).map(|m| (m * MONTH + DAY, 40_000)).collect();
        bob.work.next_own_review = 0;
        assert!(run(&mut bob, &c, &pic(6 * MONTH + DAY, None, false), 0, |a, w| a.ventures(w)).is_empty());
        assert!(bob.s.own_work.is_some());
    }

    #[test]
    fn in_need_at_work_where_the_employer_sells_goods_one_may_take_some_home_and_otherwise_not() {
        let c = ctx_with(json!({ "crime": { "take_bps": 10_000, "caught_bps": 0, "quantity": 2 } }));
        let prices = rec(json!({ "id": "rec.p", "record": "statement", "author": "p.shop", "speaks_for": "shop", "at": 0, "visible_to": "public", "kind": "price_list", "text": "Prices", "data": { "goods": { "goods": 500 }, "account": "acc.shop" } }));
        let at_work = |t: i64| {
            let mut p = pic(t, Some(-30 * YEAR), false);
            p.body.as_mut().unwrap().in_space = Some("shop/floor".into());
            p
        };
        let mut ann = Person::new(&c).unwrap();
        ann.book.take_all(&[prices]);
        ann.s.job = Some(job("shop", 0));
        ann.s.home = Some(Home { space: "b1/dwelling.1".into(), moved_in: true, ..Default::default() });
        assert!(run(&mut ann, &c, &at_work(DAY), 100_000, |a, w| a.taking(w)).is_empty(), "not in need");
        let out = run(&mut ann, &c, &at_work(2 * DAY), 1_000, |a, w| a.taking(w));
        assert!(out.len() == 1 && out[0].contains("take(") && out[0].contains("at=b1") && out[0].contains("from_at=shop"), "{out:?}");
        assert!(run(&mut ann, &c, &at_work(3 * DAY), 1_000, |a, w| a.taking(w)).is_empty(), "a month's chance");
    }
}
