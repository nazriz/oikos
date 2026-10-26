//! The census and the valuation roll, the landfill and the newcomers: world.statistics, world.valuer, world.disposal
//! (and, below, world.migration). Ported from participants/src/behaviour/world.ts (docs/behaviour/boundary.md,
//! public-finance.md and services.md). `idle` is the frame's (`stub::Idle`), not repeated here.
//!
//! Decided fresh in Rust, where TS leaned on JavaScript:
//! - a valuer's buildings on a lot are listed in structure-id order (TS listed them in the order the valuer learned of
//!   them, a `Map`'s insertion order; the order never carried meaning);
//! - papers of the same time are taken in the order they were filed (`rec.9` before `rec.10`), not as strings;
//! - a mean price is the integer mean rounded half up, as `Math.round` does for a positive ratio.

use super::household_draw::{draw_household, draw_savings, HouseholdSpec, Sex};
use super::shared::{answering, by_time, manifest, restore_answering, round_div};
use crate::common::{data, filed_before, is_kind, look_up, money_words, published_price, truthy, Asked, Book, Fields, LOOKS_MAX};
use crate::papers::{self, market as m};
use crate::steps::{amount_text, arg, because, call, json, say, text, Plan, Say, Step, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture, DAY};
use oikos_sight::calls::{parse_program, program_text, Line};
use oikos_sight::{Action, LookRequest, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

// ------------------------------------------------------------------ world.statistics

pub struct Statistics;

impl Kind for Statistics {
    fn name(&self) -> &'static str {
        "world.statistics"
    }
    fn version(&self) -> &'static str {
        "0.2.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/boundary.md"
    }
    fn manifest(&self) -> Value {
        manifest(include_str!("manifests/world.statistics.json"), "the statistician's office", "It publishes its figures as it makes them. It takes no requests.")
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        0
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let adverts: String = ctx.need("adverts", "world.statistics")?;
        answering(&self.manifest(), Statistician {
            adverts,
            sample: ctx.param("sample", 200)?,
            every_days: ctx.param("every_days", 30)?,
            population: ctx.param("population", 0)?,
            next: 0,
            next_estimate: 0,
            read: None,
            book: Book::new(),
        })
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore_answering::<Statistician>(&self.manifest(), saved)
    }
}

/// The statistician: a month's price index from what sellers advertise, and the population estimate from the census
/// and the registrations and movements that reach it.
#[derive(Serialize, Deserialize)]
struct Statistician {
    adverts: String,
    sample: i64,
    every_days: i64,
    population: i64,
    next: i64,
    next_estimate: i64,
    /// The prices read from the last search of the adverts, as (kind, price) in the order read; none: not yet read.
    read: Option<Vec<(String, i64)>>,
    /// Registrations and movements, as they reach it (each counted once, by the book).
    book: Book,
}

impl Plan for Statistician {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        if let Some(Seen::Records { records, search: true }) = pic.channels.get(self.adverts.as_str()) {
            // (Only price lists that list goods and set no minimum order are a shop's prices.)
            let mut prices = vec![];
            for r in records {
                let d = data(r);
                if !d.get("goods").is_some_and(truthy) || d.get("min_order").is_some_and(truthy) {
                    continue;
                }
                if let Some(goods) = d.get("goods").and_then(|x| x.as_object()) {
                    for (kind, price) in goods {
                        if let Some(p) = price.as_i64() {
                            prices.push((kind.to_string(), p));
                        }
                    }
                }
            }
            self.read = Some(prices);
        }
    }

    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        if pic.t >= self.next && self.read.is_none() {
            vec![crate::common::ask::board(&self.adverts, self.sample.max(0) as u32, vec![], None)]
        } else {
            vec![]
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let mut steps = vec![];
        if self.population > 0 && pic.t >= self.next_estimate {
            self.next_estimate = pic.t + self.every_days * DAY;
            let births = self.book.all("birth_registration").count() as i64;
            let deaths = self.book.all("death_registration").count() as i64;
            let arrived: i64 = self.book.all("arrival").map(|r| data(r).i("people").unwrap_or(0)).sum();
            let left = self.book.all("departure").count() as i64;
            let residents = (self.population + births + arrived - deaths - left).max(0);
            let estimate = m::PopulationEstimate { residents, census: self.population, births, arrivals: arrived, deaths, departures: left };
            steps.push(because(
                format!(
                    "The month's estimate of the town's population: {} at the census, {births} births and {arrived} arrivals since, less {deaths} deaths and {left} departures.",
                    self.population
                ),
                vec![say(
                    "population_estimate",
                    &format!("Estimated resident population: {residents}."),
                    Say { visible: Some(Visible::Public), data: Some(papers::data(&estimate)), ..Default::default() },
                )],
            ));
        }
        let Some(read) = self.read.take() else { return steps };
        self.next = pic.t + self.every_days * DAY;
        let mut by: BTreeMap<String, Vec<i64>> = BTreeMap::new();
        for (kind, price) in read {
            by.entry(kind).or_default().push(price);
        }
        for (kind, prices) in by {
            let mean = round_div(prices.iter().sum(), prices.len() as i64);
            let outlets = prices.len() as i64;
            steps.push(because(
                format!("This month's prices of {kind}, read at {outlets} outlets: publishing the mean."),
                vec![say(
                    "price_index",
                    &format!("Price index, {kind}: {} on average at {outlets} outlets.", money_words(mean, &cx.ctx.world)),
                    Say {
                        visible: Some(Visible::Public),
                        data: Some(papers::data(&m::PriceIndex { kind: kind.clone(), mean, outlets })),
                        ..Default::default()
                    },
                )],
            ));
        }
        steps
    }

    fn until(&self, _: &Picture) -> Option<i64> {
        Some(self.next.min(if self.population > 0 { self.next_estimate } else { i64::MAX }))
    }
}

// ------------------------------------------------------------------ world.valuer

pub struct Valuer;

impl Kind for Valuer {
    fn name(&self) -> &'static str {
        "world.valuer"
    }
    fn version(&self) -> &'static str {
        "0.2.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/public-finance.md"
    }
    fn manifest(&self) -> Value {
        manifest(include_str!("manifests/world.valuer.json"), "the valuer's office", "What it acts on: a rating authority's request to value a property; and the notices it is given of land changing hands.")
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        0
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let builder: String = ctx.need("builder", "world.valuer")?;
        let rating: String = ctx.need("rating", "world.valuer")?;
        answering(&self.manifest(), Assessor {
            me: ctx.entity.clone(),
            land_value: ctx.param("land_value", 0)?,
            builder,
            rating,
            exempt: ctx.param("exempt", vec![])?,
            every_days: ctx.param("every_days", 365)?,
            roll_channel: ctx.param("roll", "roll".to_string())?,
            book: Book::new(),
            roll: BTreeMap::new(),
            taken: BTreeSet::new(),
            next: 0,
        })
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore_answering::<Assessor>(&self.manifest(), saved)
    }
}

/// A property on the valuer's roll: its owner as it was last told, and the buildings on it (structure -> type).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct Entry {
    owner: Option<String>,
    buildings: BTreeMap<String, String>,
}

/// The valuer: values from its own roll, kept up by the notices of land changing hands and the council's requests.
#[derive(Serialize, Deserialize)]
struct Assessor {
    me: String,
    land_value: i64,
    builder: String,
    rating: String,
    exempt: Vec<String>,
    every_days: i64,
    roll_channel: String,
    book: Book,
    roll: BTreeMap<String, Entry>,
    taken: BTreeSet<String>,
    next: i64,
}

impl Plan for Assessor {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        if let Some(Seen::Records { records, .. }) = pic.channels.get(self.roll_channel.as_str()) {
            let mut sorted: Vec<_> = records.iter().collect();
            sorted.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
            for r in sorted {
                let d = data(r);
                if !matches!(r.body, oikos_sight::RecordBody::Statement { .. }) || self.taken.contains(r.id.as_str()) {
                    continue;
                }
                let Some(lot) = d.s("lot") else { continue };
                self.taken.insert(r.id.to_string());
                let x = self.roll.entry(lot.to_string()).or_default();
                if let Some(owner) = d.s("owner") {
                    x.owner = Some(owner.to_string());
                }
                if is_kind(r, "property_roll") {
                    for b in d.get("buildings").and_then(|x| x.as_array()).into_iter().flatten() {
                        if let (Some(s), Some(t)) = (b.s("structure"), b.s("type")) {
                            x.buildings.insert(s.to_string(), t.to_string());
                        }
                    }
                }
            }
        }
        // What the council asks us to value: something built, or brought down.
        let requests: Vec<_> = by_time(self.book.open("valuation_request").collect());
        for r in requests {
            if self.taken.contains(r.id.as_str()) || !crate::common::addressed_to(r).iter().any(|x| x == &self.me) {
                continue;
            }
            self.taken.insert(r.id.to_string());
            let d = data(r);
            if let Some(removed) = d.s("removed") {
                for x in self.roll.values_mut() {
                    x.buildings.remove(removed);
                }
            } else if let (Some(lot), Some(structure)) = (d.s("lot"), d.s("structure")) {
                self.roll.entry(lot.to_string()).or_default().buildings.insert(structure.to_string(), d.s("structure_type").unwrap_or("").to_string());
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let t = pic.t;
        if t < self.next {
            return vec![];
        }
        // Not until we can see the builder's prices (a valuation without them would value the buildings at nothing).
        let priced = self.book.open("price_list").any(|r| r.speaks_for.as_deref() == Some(self.builder.as_str()) && data(r).get("prices").is_some_and(truthy));
        if !priced {
            return vec![];
        }
        self.next = t + self.every_days * DAY;
        let world = cx.ctx.world.clone();
        let mut lines = vec![];
        for (lot, x) in &self.roll {
            let Some(owner) = x.owner.as_deref() else { continue };
            if owner.is_empty() || owner == self.rating || self.exempt.iter().any(|e| e == owner) {
                continue;
            }
            let buildings: Vec<m::ValuedBuilding> = x
                .buildings
                .iter()
                .map(|(structure, type_)| m::ValuedBuilding {
                    structure: structure.clone(),
                    type_: type_.clone(),
                    value: published_price(&self.book, &self.builder, type_, "prices").unwrap_or(0),
                })
                .collect();
            let value = self.land_value + buildings.iter().map(|b| b.value).sum::<i64>();
            let names = if buildings.is_empty() { String::new() } else { format!(" and {}", buildings.iter().map(|b| b.structure.as_str()).collect::<Vec<_>>().join(", ")) };
            lines.push(say(
                "valuation",
                &format!("Valuation of {lot}{names}: {}.", money_words(value, &world)),
                Say {
                    to: Some(vec![owner.to_string()]),
                    visible: Some(Visible::Only(vec![self.me.clone(), owner.to_string(), self.rating.clone()])),
                    basis: Some(lot.clone()),
                    data: Some(papers::data(&m::Valuation {
                        lot: lot.clone(),
                        owner: owner.to_string(),
                        land: self.land_value,
                        buildings,
                        value,
                        year: t.div_euclid(365 * DAY) + 1,
                    })),
                    ..Default::default()
                },
            ));
        }
        // (A program has at most 32 lines: thirty to a step.)
        lines
            .chunks(30)
            .map(|c| {
                because(
                    format!("The year's valuations: each property's land at {} a lot, and its buildings at what building them now would cost.", money_words(self.land_value, &world)),
                    c.to_vec(),
                )
            })
            .collect()
    }
}

// ------------------------------------------------------------------ world.disposal

pub struct Disposal;

impl Kind for Disposal {
    fn name(&self) -> &'static str {
        "world.disposal"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/services.md"
    }
    fn manifest(&self) -> Value {
        manifest(include_str!("manifests/world.disposal.json"), "the landfill's office", "What it acts on: a docket for what is brought to it, invoiced every month at the charge it has notified.")
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        0
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let account: String = ctx.need("account", "world.disposal")?;
        let every_days: i64 = ctx.param("every_days", 30)?;
        answering(&self.manifest(), Landfill {
            me: ctx.entity.clone(),
            kind: ctx.param("kind", "waste".to_string())?,
            price_per_tonne: ctx.param("price_per_tonne", 0)?,
            account,
            every_days,
            book: Book::new(),
            billed: BTreeSet::new(),
            next: every_days * DAY,
        })
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore_answering::<Landfill>(&self.manifest(), saved)
    }
}

/// A place outside the town that takes a kind of material. Whoever delivers gives it a docket with what they brought
/// (the weighbridge's record); every month it invoices each for what they brought since, at its price per tonne
/// (1,000 units), rounded up to the cent.
#[derive(Serialize, Deserialize)]
struct Landfill {
    me: String,
    kind: String,
    price_per_tonne: i64,
    account: String,
    every_days: i64,
    book: Book,
    billed: BTreeSet<String>,
    next: i64,
}

impl Plan for Landfill {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        if pic.t < self.next {
            return vec![];
        }
        self.next = pic.t + self.every_days * DAY;
        // Who brought how much, and on which dockets.
        let mut due: BTreeMap<String, (i64, Vec<String>)> = BTreeMap::new();
        let mut dockets: Vec<_> = self
            .book
            .open("disposal_docket")
            .filter(|r| crate::common::addressed_to(r).iter().any(|x| x == &self.me) && !self.billed.contains(r.id.as_str()) && data(r).s("kind") == Some(self.kind.as_str()))
            .collect();
        dockets.sort_by(|a, b| filed_before(&a.id, &b.id));
        for d in dockets {
            self.billed.insert(d.id.to_string());
            let Some(who) = d.speaks_for else { continue };
            let x = due.entry(who.to_string()).or_default();
            x.0 += data(d).i("quantity").unwrap_or(0).max(0);
            x.1.push(d.id.to_string());
        }
        let world = cx.ctx.world.clone();
        let mut steps = vec![];
        for (who, (quantity, dockets)) in due {
            // (Rounded up to the smallest unit.)
            let amount = (quantity * self.price_per_tonne + 999).div_euclid(1000);
            if amount <= 0 {
                continue;
            }
            steps.push(because(
                format!("The month's {} from {who}: {quantity} at {} a tonne, invoiced.", self.kind, money_words(self.price_per_tonne, &world)),
                vec![say(
                    "invoice",
                    &format!("Invoice: {} for {quantity} of {} taken this month.", money_words(amount, &world), self.kind),
                    Say {
                        to: Some(vec![who.clone()]),
                        visible: Some(Visible::Only(vec![self.me.clone(), who.clone()])),
                        basis: dockets.first().cloned(),
                        // (As the invoice form writes it: the amount as the decimal text a seat's form would.)
                        data: Some(json!({ "outcome": { "money": { "to": self.account, "amount": amount.to_string(), "for": format!("disposal of {}", self.kind) } }, "dockets": dockets })),
                        ..Default::default()
                    },
                )],
            ));
        }
        steps
    }
}

// ------------------------------------------------------------------ world.migration

pub struct Migration;

const NO_HOUSEHOLDS: &str = "world.migration: params.households is required (the world's household mix)";

impl Kind for Migration {
    fn name(&self) -> &'static str {
        "world.migration"
    }
    fn version(&self) -> &'static str {
        "0.6.2"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/boundary.md"
    }
    fn manifest(&self) -> Value {
        // (This module has no `answers`: it takes no letters and is not wrapped.)
        serde_json::from_str(include_str!("manifests/world.migration.json")).expect("a manifest")
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        30 * DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        30 * DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let households: Option<HouseholdSpec> = ctx.param("households", None)?;
        let households = households.ok_or(NO_HOUSEHOLDS)?;
        Ok(Box::new(Newcomers {
            me: ctx.entity.clone(),
            households,
            outside_monthly_income: ctx.param("outside_monthly_income", 250_000)?,
            response_bps: ctx.param("response_bps", 1000)?,
            max_households_per_month: ctx.param("max_households_per_month", 8)?,
            memory_days: ctx.param("memory_days", 90)?,
            savings_months: ctx.param("savings_months", [1, 3])?,
            savings_by_age: ctx.param("savings_by_age", None)?,
            template: ctx.param("template", "newcomer".to_string())?,
            search_limit: ctx.param("search_limit", 200)?,
            jobseekers_payment: ctx.param("jobseekers_payment", String::new())?,
            participation_bps: ctx.param("participation_bps", 10_000)?,
            template_outside_lf: ctx.param("template_outside_lf", String::new())?,
            seeker_ages: ctx.param("seeker_ages", None)?,
            schooling: ctx.param("schooling", None)?,
            who: ctx.param("who", String::new())?,
            asked: Asked::default(),
            book: Book::new(),
            reach: BTreeMap::new(),
            brought: vec![],
            arrivals: 0,
            looked: -1,
            postings: vec![],
            todo: vec![],
            pending: vec![],
            expecting: None,
        }))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        serde_json::from_value::<Newcomers>(saved).map(|n| Box::new(n) as Box<dyn Actor>).map_err(|e| e.to_string())
    }
}

/// An adult's savings by age: the band from this age (percentiles 10, 25, 50, 75, 90).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavingsBand {
    from: i64,
    pct: [i64; 5],
}

/// Who goes to school (the ages), and what adults have had (their highest level, as years).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Attainment {
    #[serde(default)]
    label: String,
    share_bps: i64,
    years: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Schooling {
    school_ages: [i64; 2],
    attainment: Vec<Attainment>,
    /// The variable years of schooling are kept in, and how much of it a year is.
    variable: String,
    per_year: i64,
}

/// Years of schooling at an age: a child's, the years since starting (to the end of school); an adult's, drawn from the
/// attainment shares (`pick(n)`: a uniform draw below n). Shared with the world's generator in TS (school.ts).
fn years_of_schooling(age: i64, s: &Schooling, pick: &mut dyn FnMut(i64) -> i64) -> i64 {
    if age < 18 {
        return (age.min(s.school_ages[1] + 1) - s.school_ages[0]).max(0);
    }
    let total: i64 = s.attainment.iter().map(|a| a.share_bps).sum();
    let mut x = pick(total.max(1));
    for a in &s.attainment {
        if x < a.share_bps {
            return a.years;
        }
        x -= a.share_bps;
    }
    s.attainment.last().map_or(0, |a| a.years)
}

/// A household that has crossed, waiting for the ids of its members and then its paperwork.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Crossing {
    refs: Vec<String>,
    persons: Option<Vec<String>>,
    sex: Vec<String>,
    born_at: Vec<i64>,
    couples: Vec<[usize; 2]>,
    leaseholder: usize,
}

/// A step waiting to be sent, as its program text, with the household it brings (the ids of whom come back).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Waiting {
    program: String,
    why: Option<String>,
    household: Option<Crossing>,
}

/// People moving to the town from elsewhere (a boundary condition, D31), after Harris & Todaro (1970, "Migration,
/// Unemployment and Development", AER 60(1)): people move when the income they expect where they are going beats what
/// they have where they are, and what they expect is the wage times the chance of getting a job.
///
/// Monthly, it looks at the town's standing job postings (as someone thinking of moving would). A newcomer expects the
/// mean posted wage times the chance of a job: postings / (postings + those competing for them: the town's jobseekers,
/// as the latest published counts of recipients of the payments for those out of work say, and the adults it has brought
/// in the last `memory_days`). For each posting, a household comes with probability `response_bps` x the gap over
/// `outside_monthly_income` (capped). Households are drawn from the same census shares as the town's; adults bring a few
/// months' income elsewhere as savings. It writes the household's paperwork (the `household` record the newcomers
/// bring) once it can reach them.
///
/// Decided in whole numbers: the expected wage is the posted monthly wages' sum over (postings + competitors), exactly
/// what the mean times the chance comes to, and the gap is a floor in basis points of that.
#[derive(Serialize, Deserialize)]
struct Newcomers {
    me: String,
    households: HouseholdSpec,
    outside_monthly_income: i64,
    response_bps: i64,
    max_households_per_month: i64,
    memory_days: i64,
    savings_months: [i64; 2],
    savings_by_age: Option<Vec<SavingsBand>>,
    template: String,
    search_limit: i64,
    jobseekers_payment: String,
    participation_bps: i64,
    template_outside_lf: String,
    /// The ages the one who comes for the job is of (from, below): a household that moves for work has its earner of working
    /// age. Absent: any age, as before.
    seeker_ages: Option<[i64; 2]>,
    schooling: Option<Schooling>,
    who: String,
    asked: Asked,
    book: Book,
    /// Person -> the participant that acts as them, for those looked up.
    reach: BTreeMap<String, String>,
    /// (when, adults) of each household brought.
    brought: Vec<(i64, i64)>,
    arrivals: i64,
    looked: i64,
    /// The monthly wage of each posting in the last search.
    postings: Vec<i64>,
    todo: Vec<Waiting>,
    pending: Vec<Crossing>,
    expecting: Option<Crossing>,
}

impl Newcomers {
    /// What an adult brings: the world's savings by age, else a few months' income from elsewhere.
    fn savings_of(&self, age: i64, r: &mut oikos_core::rng::Rng) -> i64 {
        let band = self.savings_by_age.as_ref().and_then(|b| b.iter().rev().find(|x| x.from <= age));
        match band {
            Some(b) => draw_savings(b.pct, r.below(10_000) as i64),
            None => (self.savings_months[0] + r.below((self.savings_months[1] - self.savings_months[0] + 1).max(1) as u64) as i64) * self.outside_monthly_income,
        }
    }

    /// The month's decision: how many households come, and their paperwork steps.
    fn month(&mut self, t: i64, cx: &mut Cx) {
        let world = cx.ctx.world.clone();
        let n = self.postings.len() as i64;
        let sum: i64 = self.postings.iter().sum();
        let recent: i64 = self.brought.iter().filter(|b| t - b.0 < self.memory_days * DAY).map(|b| b.1).sum();
        let stats = self.book.open("support_statistics").fold(None::<&std::sync::Arc<oikos_sight::Record>>, |a, b| match a {
            Some(a) if b.at < a.at || (b.at == a.at && filed_before(&b.id, &a.id).is_le()) => Some(a),
            _ => Some(b),
        });
        let jobseekers: i64 = self
            .jobseekers_payment
            .split(',')
            .filter(|k| !k.is_empty())
            .map(|k| stats.and_then(|s| data(s).get("recipients")).and_then(|r| r.get(k)).and_then(|x| x.as_number().and_then(serde_json::Number::as_f64)).map_or(0, |x| x as i64))
            .sum();
        let competing = n + recent + jobseekers;
        let outside = self.outside_monthly_income;
        let gap_bps = ((i128::from(sum) * 10_000 - i128::from(outside) * 10_000 * i128::from(competing)).div_euclid(i128::from(outside) * i128::from(competing))) as i64;
        let per_posting = (gap_bps * self.response_bps).div_euclid(10_000).clamp(0, 10_000);
        let mut come = 0;
        for i in 0..n {
            if come >= self.max_households_per_month {
                break;
            }
            if (cx.rng(&format!("come-{i}")).below(10_000) as i64) < per_posting {
                come += 1;
            }
        }
        let mean = sum.div_euclid(n.max(1));
        let chance_pct = round_div(100 * n, competing);
        let mut r = cx.rng("households");
        for _ in 0..come {
            // (A household that moves for work is one whose earner, the one who comes for the job, is of working age: drawn
            // again while it is not, a few times at most. Until 2026-10-26 a couple of pensioners could move to a town for its
            // wages and the one who 'came for the job' claim a pension on arriving: migration for work is of working ages,
            // the model migration schedule's labour peak, Rogers and Castro 1981, to confirm.)
            let mut d = draw_household(&self.households, &mut |m| r.below(m as u64) as i64);
            if let Some([from, below]) = self.seeker_ages {
                for _ in 0..32 {
                    let age = d.members[d.leaseholder].age;
                    if age >= from && age < below {
                        break;
                    }
                    d = draw_household(&self.households, &mut |m| r.below(m as u64) as i64);
                }
            }
            let refs: Vec<String> = (0..d.members.len()).map(|j| format!("m{j}")).collect();
            let born_at: Vec<i64> = d.members.iter().map(|m| t - (m.age * 365 + m.day) * DAY).collect();
            let mut lines = vec![];
            for (j, m) in d.members.iter().enumerate() {
                // (The draws in TS's order: whether they look for work, their savings, their schooling.)
                let looks = j == d.leaseholder || self.template_outside_lf.is_empty() || (r.below(10_000) as i64) < self.participation_bps;
                let template = if looks { self.template.clone() } else { self.template_outside_lf.clone() };
                self.arrivals += 1;
                let sex = match m.sex {
                    Sex::Female => "female",
                    Sex::Male => "male",
                };
                let mut args = vec![
                    ("name", Some(text(format!("m{}", self.arrivals)))),
                    ("age", Some(text(format!("{} days", m.age * 365 + m.day)))),
                    ("sex", Some(arg(sex))),
                    ("template", Some(arg(&template))),
                ];
                if m.age >= 18 {
                    let s = self.savings_of(m.age, &mut r);
                    args.push(("carrying", Some(amount_text(s, cx))));
                }
                if let Some(sc) = &self.schooling {
                    let years = years_of_schooling(m.age, sc, &mut |k| r.below(k as u64) as i64);
                    args.push(("variables", Some(json(serde_json::json!({ sc.variable.clone(): years * sc.per_year })))));
                }
                lines.push(Line { bind: Some(refs[j].clone()), call: call("presence", args) });
            }
            let why = format!(
                "A household moves here: the town's expected wage ({} a month x a {chance_pct}% chance of a job) beats {} elsewhere.",
                money_words(mean, &world),
                money_words(outside, &world)
            );
            let crossing = Crossing {
                refs,
                persons: None,
                sex: d.members.iter().map(|m| if m.sex == Sex::Female { "female".to_string() } else { "male".to_string() }).collect(),
                born_at,
                couples: d.couples.clone(),
                leaseholder: d.leaseholder,
            };
            let mut step: Step<()> = Step::new(lines);
            step.why = Some(why);
            self.todo.push(Waiting { program: program_text(&step.program()), why: step.why.clone(), household: Some(crossing) });
            self.brought.push((t, d.members.iter().filter(|m| m.age >= 18).count() as i64));
        }
    }
}

impl Actor for Newcomers {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        let t = pic.t;
        self.book.absorb(pic);
        if let Some(Seen::Records { records, search: true }) = pic.channels.get("jobs") {
            self.postings = records
                .iter()
                .map(|x| {
                    let d = data(x);
                    let wage = d.get("wage").and_then(|x| x.as_i64()).unwrap_or(0);
                    let period = d.get("period").and_then(|x| x.as_i64()).filter(|p| *p > 0).unwrap_or(14 * DAY);
                    (i128::from(wage) * i128::from(30 * DAY)).div_euclid(i128::from(period)) as i64
                })
                .collect();
        }
        // The ids of the household that just crossed.
        if let Some(mut e) = self.expecting.take() {
            let created: BTreeMap<&str, &str> = pic.outcomes.iter().filter_map(|o| o.created.as_ref()).flatten().map(|(k, v)| (k.as_str(), v.as_str())).collect();
            if e.refs.iter().all(|r| created.contains_key(r.as_str())) {
                e.persons = Some(e.refs.iter().map(|r| created[r.as_str()].to_string()).collect());
                self.pending.push(e);
            }
        }
        // Paperwork for households whose members we can now reach: each newcomer looked up once they have crossed (who acts as
        // them: nobody is shown who's who), the answer coming at once.
        if !self.pending.is_empty() || !self.who.is_empty() {
            for ch in pic.channels.values() {
                if let Seen::Directory { entities, .. } = ch {
                    for e in entities.iter() {
                        if let Some(p) = &e.participant {
                            self.reach.insert(e.entity.to_string(), p.to_string());
                        }
                    }
                }
            }
        }
        if !self.who.is_empty() && self.expecting.is_none() {
            let mut whom = vec![];
            for h in &self.pending {
                for person in h.persons.iter().flatten() {
                    if whom.len() < LOOKS_MAX && !self.reach.contains_key(person) && self.asked.first(person, t) {
                        whom.push(look_up::entity(&self.who, person));
                    }
                }
            }
            if !whom.is_empty() {
                return Action::Look { looks: whom };
            }
        }
        let mut i = self.pending.len();
        while i > 0 {
            i -= 1;
            let persons = self.pending[i].persons.clone().unwrap_or_default();
            if !persons.iter().all(|x| self.reach.contains_key(x)) {
                continue;
            }
            let h = self.pending.remove(i);
            let members: Vec<Value> = persons
                .iter()
                .enumerate()
                .map(|(j, person)| serde_json::json!({ "person": person, "participant": self.reach[person], "born_at": h.born_at[j], "sex": h.sex[j] }))
                .collect();
            let lh = persons[h.leaseholder].clone();
            let couples: Vec<Vec<String>> = h.couples.iter().map(|[a, b]| vec![persons[*a].clone(), persons[*b].clone()]).collect();
            let n = persons.len();
            let step: Step<()> = because(
                "Newcomers' paperwork: the household they came as.",
                vec![
                    say(
                        "household",
                        &format!("Household: {}.", persons.join(", ")),
                        Say {
                            to: Some(persons.clone()),
                            visible: Some(Visible::Only(persons.clone())),
                            for_: Some(lh.clone()),
                            data: Some(serde_json::json!({ "leaseholder": lh, "members": members, "couples": couples })),
                            ..Default::default()
                        },
                    ),
                    // (And for the count of who lives where: how many came, never who. The statistician reads it.)
                    say(
                        "arrival",
                        &format!("{n} {} moved to town.", if n == 1 { "person has" } else { "people have" }),
                        Say { visible: Some(Visible::Only(vec![self.me.clone()])), data: Some(papers::data(&m::Arrival { people: n as i64 })), ..Default::default() },
                    ),
                ],
            );
            self.todo.insert(0, Waiting { program: program_text(&step.program()), why: step.why.clone(), household: None });
        }
        if self.looked != t && pic.woke_for != "done" && self.todo.is_empty() && self.expecting.is_none() {
            self.looked = t;
            return Action::Look { looks: vec![crate::common::ask::board("jobs", self.search_limit.max(0) as u32, vec![], None)] };
        }
        if self.looked == t && !self.postings.is_empty() && self.todo.is_empty() && self.expecting.is_none() && self.pending.is_empty() {
            self.month(t, cx);
        }
        if self.todo.is_empty() {
            return Action::wait();
        }
        let next = self.todo.remove(0);
        self.expecting = next.household;
        match parse_program(&next.program) {
            Ok(program) => Action::Call { program, reasoning: next.why },
            Err(_) => Action::wait(),
        }
    }

    fn save(&self) -> Result<Value, String> {
        serde_json::to_value(self).map_err(|e| e.to_string())
    }
}


#[cfg(test)]
mod tests {
    use super::super::shared::rig::*;
    use super::*;
    use crate::Action;

    fn records(v: Vec<std::sync::Arc<oikos_sight::Record>>, search: bool) -> Seen {
        Seen::Records { records: v, search }
    }

    #[test]
    fn the_statistician_asks_for_the_adverts_then_publishes_the_mean_price_of_each_kind() {
        let mut r = Rig::new(&Statistics, "stats", json!({ "adverts": "adverts", "sample": 50 }));
        let first = r.wake(0, vec![]);
        let Action::Look { looks } = &first[0] else { panic!("it looks first: {first:?}") };
        assert_eq!(looks[0].channel, "adverts");
        assert_eq!(looks[0].query.as_ref().unwrap().limit, Some(50));
        let lists = vec![
            st("rec.1", 0, "price_list", "shop.a", json!({ "goods": { "bread": 300, "milk": 150 } })),
            st("rec.2", 0, "price_list", "shop.b", json!({ "goods": { "bread": 351 } })),
            // (A wholesaler's list, with a minimum order, is not a shop's price.)
            st("rec.3", 0, "price_list", "wholesale", json!({ "goods": { "bread": 10 }, "min_order": 100 })),
            st("rec.4", 0, "price_list", "shop.c", json!({ "prices": { "house": 5 } })),
        ];
        let acts = r.wake(0, vec![("adverts", records(lists, true))]);
        let said = statements(&acts);
        assert_eq!(said.len(), 2, "{said:?}");
        assert_eq!((said[0].kind.as_str(), said[0].data["kind"].clone(), said[0].data["mean"].clone(), said[0].data["outlets"].clone()), ("price_index", json!("bread"), json!(326), json!(2)));
        assert_eq!((said[1].data["kind"].clone(), said[1].data["mean"].clone()), (json!("milk"), json!(150)));
        assert!(said[0].text.contains("$3.26"), "{}", said[0].text);
        // A month on, it looks again; not before.
        let later = r.wake(29 * DAY, vec![]);
        assert!(matches!(later[0], Action::Wait { .. }), "{later:?}");
        let later = r.wake(30 * DAY, vec![]);
        assert!(matches!(later[0], Action::Look { .. }), "{later:?}");
    }

    #[test]
    fn the_population_estimate_is_the_census_with_what_has_reached_it_since() {
        let mut r = Rig::new(&Statistics, "stats", json!({ "adverts": "adverts", "population": 1000 }));
        let news = vec![
            st("rec.1", 5, "birth_registration", "registry", json!({})),
            st("rec.2", 6, "birth_registration", "registry", json!({})),
            st("rec.3", 7, "death_registration", "registry", json!({})),
            st("rec.4", 8, "arrival", "migration", json!({ "people": 5 })),
            st("rec.5", 9, "departure", "someone", json!({})),
        ];
        // (It looks at the adverts first; the estimate follows when they have come, empty.)
        assert!(matches!(r.wake(DAY, vec![("news", records(news, false))])[0], Action::Look { .. }));
        let acts = r.wake(DAY, vec![("adverts", records(vec![], true))]);
        let est: Vec<_> = statements(&acts).into_iter().filter(|s| s.kind == "population_estimate").collect();
        assert_eq!(est.len(), 1, "{acts:?}");
        assert_eq!(est[0].data["residents"], 1005);
        assert_eq!((est[0].data["births"].clone(), est[0].data["arrivals"].clone(), est[0].data["deaths"].clone(), est[0].data["departures"].clone()), (json!(2), json!(5), json!(1), json!(1)));
        assert!(est[0].text.contains("1005"));
    }

    #[test]
    fn no_census_no_estimate() {
        let mut r = Rig::new(&Statistics, "stats", json!({ "adverts": "adverts" }));
        r.wake(0, vec![("news", records(vec![st("rec.1", 5, "arrival", "m", json!({ "people": 3 }))], false))]);
        let acts = r.wake(0, vec![("adverts", records(vec![], true))]);
        assert!(statements(&acts).is_empty());
    }

    #[test]
    fn the_statistician_needs_a_channel_and_saves_its_memory() {
        let mut p = serde_json::Map::new();
        p.insert("sample".into(), json!(3));
        let ctx = Ctx { participant: "s".into(), performer: Default::default(), entity: "e".into(), position: None, params: p.into(), world: Default::default() };
        assert!(Statistics.create(&ctx).err().unwrap().contains("adverts"));
        let mut r = Rig::new(&Statistics, "stats", json!({ "adverts": "adverts", "population": 100 }));
        let mut twin = Rig::new(&Statistics, "stats", json!({ "adverts": "adverts", "population": 100 }));
        for rig in [&mut r, &mut twin] {
            rig.wake(0, vec![("news", records(vec![st("rec.1", 5, "arrival", "m", json!({ "people": 3 }))], false))]);
            rig.wake(0, vec![("adverts", records(vec![], true))]);
        }
        r.save_and_restore();
        let news = || vec![("news", records(vec![st("rec.2", 40, "arrival", "m", json!({ "people": 4 }))], false))];
        for rig in [&mut r, &mut twin] {
            rig.wake(31 * DAY, news());
        }
        let (a, b) = (r.wake(31 * DAY, vec![("adverts", records(vec![], true))]), twin.wake(31 * DAY, vec![("adverts", records(vec![], true))]));
        assert_eq!(format!("{a:?}"), format!("{b:?}"), "restored, it carries on as the original does");
        assert_eq!(statements(&a)[0].data["residents"], 107);
    }

    fn valuer(extra: Value) -> Rig {
        let mut p = json!({ "builder": "builder", "rating": "council", "land_value": 1_000_000, "exempt": ["school"], "every_days": 365 });
        p.as_object_mut().unwrap().extend(extra.as_object().cloned().unwrap_or_default());
        Rig::new(&Valuer, "valuer", p)
    }
    fn prices() -> std::sync::Arc<oikos_sight::Record> {
        st("rec.1", 0, "price_list", "builder", json!({ "prices": { "house": 20_000_000, "shed": 500_000 } }))
    }
    fn roll_entry(id: &str, kind: &str, lot: &str, owner: &str, buildings: Value) -> std::sync::Arc<oikos_sight::Record> {
        st(id, 0, kind, "land-office", json!({ "lot": lot, "owner": owner, "buildings": buildings }))
    }

    #[test]
    fn the_valuer_values_each_taxable_property_from_its_roll_and_the_builders_prices() {
        let mut r = valuer(json!({}));
        let roll = vec![
            roll_entry("rec.2", "property_roll", "lot.1", "alice", json!([{ "structure": "s1", "type": "house" }, { "structure": "s2", "type": "shed" }])),
            roll_entry("rec.3", "property_roll", "lot.2", "council", json!([{ "structure": "s3", "type": "house" }])),
            roll_entry("rec.4", "property_roll", "lot.3", "school", json!([])),
            roll_entry("rec.5", "acquisition_notice", "lot.4", "bob", json!([])),
        ];
        let acts = r.wake(0, vec![("roll", records(roll, false)), ("prices", records(vec![prices()], false))]);
        let said = statements(&acts);
        assert_eq!(said.len(), 2, "the council's and the school's are exempt: {said:?}");
        assert_eq!(said[0].data["lot"], "lot.1");
        assert_eq!(said[0].data["value"], 1_000_000 + 20_000_000 + 500_000);
        assert_eq!(said[0].data["land"], 1_000_000);
        assert_eq!(said[0].data["year"], 1);
        assert_eq!(said[0].to, ["alice"]);
        assert_eq!(said[0].basis.as_deref(), Some("lot.1"));
        assert!(said[0].text.starts_with("Valuation of lot.1 and s1, s2: "), "{}", said[0].text);
        assert_eq!((said[1].data["lot"].clone(), said[1].data["value"].clone()), (json!("lot.4"), json!(1_000_000)));
        // Once a year.
        assert!(statements(&r.wake(200 * DAY, vec![])).is_empty());
        assert_eq!(statements(&r.wake(366 * DAY, vec![])).len(), 2);
    }

    #[test]
    fn the_valuer_waits_for_the_builders_prices() {
        let mut r = valuer(json!({}));
        let roll = vec![roll_entry("rec.2", "property_roll", "lot.1", "alice", json!([]))];
        assert!(statements(&r.wake(0, vec![("roll", records(roll, false))])).is_empty());
        let acts = r.wake(DAY, vec![("prices", records(vec![prices()], false))]);
        assert_eq!(statements(&acts).len(), 1, "it values as soon as it can see the prices");
    }

    #[test]
    fn the_council_asks_it_to_value_what_is_built_and_what_is_brought_down() {
        let mut r = valuer(json!({}));
        let roll = vec![roll_entry("rec.2", "property_roll", "lot.1", "alice", json!([{ "structure": "s1", "type": "house" }]))];
        r.wake(0, vec![("roll", records(roll, false)), ("prices", records(vec![prices()], false))]);
        let asks = vec![
            st_to("rec.7", 10, "valuation_request", "inspector", &["valuer"], json!({ "lot": "lot.1", "structure": "s9", "structure_type": "shed" })),
            st_to("rec.8", 11, "valuation_request", "inspector", &["valuer"], json!({ "removed": "s1" })),
            // (Not addressed to us: not ours to act on.)
            st_to("rec.9", 12, "valuation_request", "inspector", &["someone"], json!({ "lot": "lot.1", "structure": "s10", "structure_type": "house" })),
        ];
        let acts = r.wake(366 * DAY, vec![("asks", records(asks, false))]);
        let v = &statements(&acts)[0];
        assert_eq!(v.data["buildings"], json!([{ "structure": "s9", "type": "shed", "value": 500_000 }]));
        assert_eq!(v.data["value"], 1_500_000);
    }

    #[test]
    fn a_land_change_notice_changes_whose_property_it_is() {
        let mut r = valuer(json!({}));
        let roll = vec![roll_entry("rec.2", "property_roll", "lot.1", "alice", json!([]))];
        r.wake(0, vec![("roll", records(roll, false)), ("prices", records(vec![prices()], false))]);
        let sold = vec![st("rec.20", 100, "acquisition_notice", "land-office", json!({ "lot": "lot.1", "owner": "carol" }))];
        let acts = r.wake(366 * DAY, vec![("roll", records(sold, false))]);
        assert_eq!(statements(&acts)[0].to, ["carol"]);
    }

    #[test]
    fn the_valuer_saves_its_roll() {
        let mut r = valuer(json!({}));
        let roll = vec![roll_entry("rec.2", "property_roll", "lot.1", "alice", json!([{ "structure": "s1", "type": "house" }]))];
        r.wake(0, vec![("roll", records(roll.clone(), false)), ("prices", records(vec![prices()], false))]);
        r.save_and_restore();
        let saved = r.actor.save().unwrap();
        assert_eq!(saved["inner"]["plan"]["roll"]["lot.1"]["owner"], "alice");
        assert_eq!(saved["inner"]["plan"]["next"], 365 * DAY);
        // (A restored valuer does not take a roll entry in twice.)
        let acts = r.wake(366 * DAY, vec![("roll", records(roll, false))]);
        assert_eq!(statements(&acts).len(), 1);
    }

    fn dockets() -> Vec<std::sync::Arc<oikos_sight::Record>> {
        vec![
            st_to("rec.1", 3, "disposal_docket", "works", &["landfill"], json!({ "kind": "waste", "quantity": 1500 })),
            st_to("rec.2", 4, "disposal_docket", "works", &["landfill"], json!({ "kind": "waste", "quantity": 700 })),
            st_to("rec.3", 5, "disposal_docket", "other-works", &["landfill"], json!({ "kind": "waste", "quantity": 1 })),
            st_to("rec.4", 6, "disposal_docket", "works", &["landfill"], json!({ "kind": "scrap", "quantity": 900 })),
            st_to("rec.5", 7, "disposal_docket", "works", &["elsewhere"], json!({ "kind": "waste", "quantity": 900 })),
        ]
    }

    #[test]
    fn the_landfill_invoices_each_for_what_they_brought_each_month_rounding_up() {
        let mut r = Rig::new(&Disposal, "landfill", json!({ "account": "landfill-acct", "price_per_tonne": 12_345, "every_days": 30 }));
        assert!(statements(&r.wake(DAY, vec![("dockets", records(dockets(), false))])).is_empty(), "not before the month is out");
        let acts = r.wake(30 * DAY, vec![]);
        let said = statements(&acts);
        assert_eq!(said.len(), 2, "{said:?}");
        // works: 2200 units at 12,345 a tonne = 27,159 (27,159.0); other-works: 1 unit = 13 (12.345 rounded up).
        assert_eq!(said[0].to, ["other-works"]);
        assert_eq!(said[0].data["outcome"]["money"]["amount"], "13");
        assert_eq!(said[1].to, ["works"]);
        assert_eq!(said[1].data["outcome"]["money"], json!({ "to": "landfill-acct", "amount": "27159", "for": "disposal of waste" }));
        assert_eq!(said[1].data["dockets"], json!(["rec.1", "rec.2"]));
        assert_eq!(said[1].basis.as_deref(), Some("rec.1"));
        // Each docket is invoiced once.
        assert!(statements(&r.wake(60 * DAY, vec![])).is_empty());
    }

    #[test]
    fn a_free_landfill_invoices_nothing_and_the_landfill_saves_what_it_has_billed() {
        let mut r = Rig::new(&Disposal, "landfill", json!({ "account": "a", "price_per_tonne": 0 }));
        assert!(statements(&r.wake(30 * DAY, vec![("dockets", records(dockets(), false))])).is_empty());
        let mut r = Rig::new(&Disposal, "landfill", json!({ "account": "a", "price_per_tonne": 1000 }));
        r.wake(DAY, vec![("dockets", records(dockets(), false))]);
        r.save_and_restore();
        let said = statements(&r.wake(30 * DAY, vec![]));
        assert_eq!(said.len(), 2);
        r.save_and_restore();
        assert!(statements(&r.wake(60 * DAY, vec![("dockets", records(dockets(), false))])).is_empty(), "a restored landfill remembers what it billed");
        let mut p = serde_json::Map::new();
        p.insert("price_per_tonne".into(), json!(5));
        let ctx = Ctx { participant: "s".into(), performer: Default::default(), entity: "e".into(), position: None, params: p.into(), world: Default::default() };
        assert!(Disposal.create(&ctx).err().unwrap().contains("account"));
    }
}

#[cfg(test)]
mod migration_tests {
    use super::super::shared::rig::*;
    use super::*;
    use oikos_sight::calls::{Program, Value as Arg};

    fn spec() -> Value {
        json!({
            "lone_bps": 2500, "group_bps": 500, "couple_bps": 2500, "couple_children_bps": 3000, "one_parent_bps": 1500,
            "children_couple": [3500, 4500, 2000], "children_one_parent": [5000, 3500, 1500],
            "same_sex_couple_bps": 150, "lone_parent_female_bps": 8000, "adult_female_bps": 5000, "child_male_bps": 5100,
            "adult_ages": [18, 99], "mother_age_at_first_birth": [22, 36], "child_max_age": 24, "group_size": [2, 3],
        })
    }
    fn town(extra: Value) -> Rig {
        let mut p = json!({ "households": spec(), "outside_monthly_income": 50_000, "response_bps": 10_000 });
        p.as_object_mut().unwrap().extend(extra.as_object().cloned().unwrap_or_default());
        Rig::new(&Migration, "town", p)
    }
    fn postings(n: usize, wage: i64) -> Vec<std::sync::Arc<oikos_sight::Record>> {
        (0..n).map(|i| st(&format!("rec.{i}"), 0, "job_posting", "factory", json!({ "wage": wage, "period": 14 * DAY }))).collect()
    }
    /// A month's wake: the look at the jobs, then the actions until it waits (or, if `first_only`, the first act, so the
    /// outcome can be given at the very next observation, as the engine does).
    fn found(r: &mut Rig, t: i64, jobs: Vec<std::sync::Arc<oikos_sight::Record>>, other: Vec<(&str, Seen)>) -> Vec<Action> {
        found_by(r, t, jobs, other, false)
    }
    fn found_by(r: &mut Rig, t: i64, jobs: Vec<std::sync::Arc<oikos_sight::Record>>, other: Vec<(&str, Seen)>, first_only: bool) -> Vec<Action> {
        let first = r.step(&Rig::picture(t, other.clone(), vec![], "cadence"));
        assert!(matches!(first, Action::Look { .. }), "it looks at the jobs first: {first:?}");
        let mut seen = other;
        seen.push(("jobs", Seen::Records { records: jobs, search: true }));
        let mut out = vec![];
        let mut pic = Rig::picture(t, seen, vec![], "cadence");
        loop {
            let a = r.step(&pic);
            let done = !matches!(a, Action::Call { .. });
            out.push(a);
            if done || first_only || out.len() > 40 {
                break;
            }
            // (Each act takes time: the next observation is later.)
            pic = Rig::picture(t + out.len() as i64, vec![], vec![], "done");
        }
        out
    }
    fn calls(v: &[Action]) -> Vec<&oikos_sight::calls::Program> {
        v.iter().filter_map(|a| if let Action::Call { program, .. } = a { Some(program) } else { None }).collect()
    }

    #[test]
    fn it_needs_the_worlds_household_mix() {
        let ctx = Ctx { participant: "s".into(), performer: Default::default(), entity: "e".into(), position: None, params: Default::default(), world: Default::default() };
        assert!(Migration.create(&ctx).err().unwrap().contains("households is required"));
    }

    #[test]
    fn the_one_who_comes_for_the_job_is_of_working_age() {
        // (Only the one who came for the job looks for work: participation 0, the others outside the labour force.)
        let mut r = town(json!({ "max_households_per_month": 5, "seeker_ages": [20, 60], "template_outside_lf": "out", "participation_bps": 0 }));
        let out = found(&mut r, 30 * DAY, postings(10, 100_000 * 14 / 30 + 1), vec![]);
        let progs = calls(&out);
        assert_eq!(progs.len(), 5);
        for p in progs {
            let Program::Lines(lines) = p else { panic!() };
            let seekers: Vec<i64> = lines
                .iter()
                .filter(|l| l.call.get("template") == Some(&Arg::Id("newcomer".into())))
                .filter_map(|l| match l.call.get("age") {
                    Some(Arg::Text(a)) => a.trim_end_matches(" days").parse::<i64>().ok(),
                    _ => None,
                })
                .collect();
            assert_eq!(seekers.len(), 1, "one comes for the job: {lines:?}");
            assert!((20 * 365..60 * 365).contains(&seekers[0]), "of working age: {} days", seekers[0]);
        }
    }

    #[test]
    fn with_no_jobs_going_nobody_comes() {
        let mut r = town(json!({}));
        let out = found(&mut r, 30 * DAY, vec![], vec![]);
        assert!(calls(&out).is_empty());
        assert!(matches!(out.last(), Some(Action::Wait { .. })));
    }

    #[test]
    fn with_jobs_going_households_come_up_to_the_most_a_month_each_a_step_of_presences() {
        let mut r = town(json!({ "max_households_per_month": 5 }));
        // Ten postings paying 100,000 a month against 50,000 elsewhere: the gap is the whole.
        let out = found(&mut r, 30 * DAY, postings(10, 100_000 * 14 / 30 + 1), vec![]);
        let progs = calls(&out);
        assert_eq!(progs.len(), 5, "one a step, to the most a month: {out:?}");
        let Program::Lines(lines) = progs[0] else { panic!() };
        assert!(!lines.is_empty());
        for (j, l) in lines.iter().enumerate() {
            assert_eq!(l.bind.as_deref(), Some(format!("m{j}").as_str()));
            assert_eq!(l.call.fn_, "presence");
            assert_eq!(l.call.get("template"), Some(&Arg::Id("newcomer".into())));
            assert!(matches!(l.call.get("age"), Some(Arg::Text(a)) if a.ends_with(" days")));
        }
        let adults = lines.iter().filter(|l| l.call.get("carrying").is_some()).count();
        assert!(adults >= 1, "the adults bring savings");
        let Action::Call { reasoning, .. } = &out[0] else { panic!() };
        assert!(reasoning.as_ref().unwrap().starts_with("A household moves here: the town's expected wage ($1,000.00 a month"), "{reasoning:?}");
    }

    #[test]
    fn the_towns_own_jobseekers_make_coming_less_worth_it() {
        let jobs = || postings(10, 100_000 * 14 / 30 + 1);
        let mut with = town(json!({ "jobseekers_payment": "dole" }));
        let stats = st("rec.90", 0, "support_statistics", "outside", json!({ "recipients": { "dole": 2000 } }));
        let out = found(&mut with, 30 * DAY, jobs(), vec![("news", Seen::Records { records: vec![stats], search: false })]);
        assert!(calls(&out).is_empty(), "the chance of a job is 10 in 2,010: the expected wage is below what they have");
        let mut without = town(json!({ "jobseekers_payment": "dole" }));
        assert!(!calls(&found(&mut without, 30 * DAY, jobs(), vec![])).is_empty());
    }

    #[test]
    fn adults_it_has_brought_lately_count_among_those_competing_for_the_jobs() {
        let mut r = town(json!({ "max_households_per_month": 8, "memory_days": 90 }));
        let jobs = || postings(3, 100_000 * 14 / 30 + 1);
        let first = found(&mut r, 30 * DAY, jobs(), vec![]);
        assert!(!calls(&first).is_empty());
        // (Everyone it brought is still on the way, so in a month it counts them: 3 postings against all of them.)
        let mut crowded = town(json!({}));
        crowded.step(&Rig::picture(0, vec![], vec![], "cadence"));
        let saved = r.actor.save().unwrap();
        assert!(saved["brought"].as_array().unwrap().len() >= 1);
    }

    #[test]
    fn once_the_ids_come_back_and_it_can_reach_them_it_writes_the_household_and_says_how_many_came() {
        let mut r = town(json!({ "max_households_per_month": 1 }));
        let out = found_by(&mut r, 30 * DAY, postings(10, 100_000 * 14 / 30 + 1), vec![], true);
        let Some(Program::Lines(lines)) = calls(&out).first().copied() else { panic!() };
        let created: serde_json::Map<String, Value> = lines.iter().enumerate().map(|(j, l)| (l.bind.clone().unwrap(), json!(format!("person.{j}")))).collect();
        let outcome: oikos_sight::Outcome = serde_json::from_value(json!({ "action": "act.1", "t": 30 * DAY, "status": "applied", "created": created })).unwrap();
        let entities: Vec<oikos_sight::EntityItem> =
            (0..lines.len()).map(|j| serde_json::from_value(json!({ "entity": format!("person.{j}"), "kind": "person", "name": format!("N{j}"), "participant": format!("par.{j}") })).unwrap()).collect();
        let dir = Seen::Directory { entities: std::sync::Arc::new(entities), positions: std::sync::Arc::new(vec![]) };
        let a = r.step(&Rig::picture(30 * DAY + 1, vec![("who", dir)], vec![outcome], "done"));
        let said = statements(&[a]);
        assert_eq!(said.iter().map(|s| s.kind.as_str()).collect::<Vec<_>>(), ["household", "arrival"]);
        let h = &said[0].data;
        assert_eq!(h["members"].as_array().unwrap().len(), lines.len());
        assert_eq!(h["members"][0]["participant"], "par.0");
        assert!(h["leaseholder"].as_str().unwrap().starts_with("person."));
        assert_eq!(said[1].data, json!({ "people": lines.len() }));
        assert_eq!(said[0].to.len(), lines.len());
        // Saved and restored mid-way, it carries on as it would.
        r.save_and_restore();
    }

    #[test]
    fn it_looks_up_how_to_reach_those_it_brought_when_told_where_to_ask() {
        let mut r = town(json!({ "max_households_per_month": 1, "who": "whoswho" }));
        let out = found_by(&mut r, 30 * DAY, postings(10, 100_000 * 14 / 30 + 1), vec![], true);
        let Some(Program::Lines(lines)) = calls(&out).first().copied() else { panic!() };
        let created: serde_json::Map<String, Value> = lines.iter().enumerate().map(|(j, l)| (l.bind.clone().unwrap(), json!(format!("person.{j}")))).collect();
        let outcome: oikos_sight::Outcome = serde_json::from_value(json!({ "action": "act.1", "t": 30 * DAY, "status": "applied", "created": created })).unwrap();
        let a = r.step(&Rig::picture(30 * DAY + 1, vec![], vec![outcome], "done"));
        let Action::Look { looks } = &a else { panic!("{a:?}") };
        assert_eq!(looks.len(), lines.len());
        assert!(looks.iter().all(|l| l.channel == "whoswho" && l.who.is_some()));
        // Asked once each.
        let again = r.step(&Rig::picture(30 * DAY + 2, vec![], vec![], "done"));
        assert!(matches!(again, Action::Wait { .. }), "{again:?}");
    }

    #[test]
    fn the_same_month_in_the_same_town_draws_the_same_households_and_a_restored_one_alike() {
        let jobs = || postings(10, 100_000 * 14 / 30 + 1);
        let mut a = town(json!({ "schooling": { "school_ages": [5, 17], "attainment": [{ "label": "school", "share_bps": 6000, "years": 12 }, { "label": "degree", "share_bps": 4000, "years": 16 }], "variable": "education", "per_year": 10 },
            "template_outside_lf": "outside", "participation_bps": 5000, "savings_by_age": [{ "from": 18, "pct": [0, 100, 1000, 5000, 20000] }] }));
        let mut b = town(json!({ "schooling": { "school_ages": [5, 17], "attainment": [{ "label": "school", "share_bps": 6000, "years": 12 }, { "label": "degree", "share_bps": 4000, "years": 16 }], "variable": "education", "per_year": 10 },
            "template_outside_lf": "outside", "participation_bps": 5000, "savings_by_age": [{ "from": 18, "pct": [0, 100, 1000, 5000, 20000] }] }));
        let (oa, ob) = (found(&mut a, 30 * DAY, jobs(), vec![]), found(&mut b, 30 * DAY, jobs(), vec![]));
        assert_eq!(format!("{oa:?}"), format!("{ob:?}"));
        let Some(Program::Lines(lines)) = calls(&oa).first().copied() else { panic!("{oa:?}") };
        assert!(lines.iter().all(|l| l.call.get("variables").is_some()), "schooling is given to each newcomer");
        a.save_and_restore();
        let mut c = town(json!({}));
        c.step(&Rig::picture(0, vec![], vec![], "cadence"));
        c.save_and_restore();
    }

    #[test]
    fn schooling_years_follow_the_ages_and_the_attainment_shares() {
        let s = Schooling { school_ages: [5, 17], attainment: vec![Attainment { label: "a".into(), share_bps: 6000, years: 12 }, Attainment { label: "b".into(), share_bps: 4000, years: 16 }], variable: "e".into(), per_year: 1 };
        assert_eq!(years_of_schooling(3, &s, &mut |_| 0), 0);
        assert_eq!(years_of_schooling(10, &s, &mut |_| 0), 5);
        assert_eq!(years_of_schooling(17, &s, &mut |_| 0), 12);
        assert_eq!(years_of_schooling(30, &s, &mut |_| 5999), 12);
        assert_eq!(years_of_schooling(30, &s, &mut |_| 6000), 16);
    }
}
