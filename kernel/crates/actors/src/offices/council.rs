//! city.mayor_code, city.council_clerk, city.councillor: the town's council and its code mayor. Ported to Rust from
//! participants/src/behaviour/government.ts (lines 1-540; versions kept as the TS manifests have them: 0.12.1, 0.11.1,
//! 0.6.0). Documented in docs/behaviour/government.md.
//!
//! **Where the Rust decides fresh** (docs/port-guide.md, section 2):
//! - *The file, not memory.* What each office has done is read from its own papers (records made in its position, whoever
//!   held it): the mayor's budgets tabled, parks and roads applied for, bases acted on; the clerk's ballots, results
//!   and laws; the councillor's own votes and motion. A set in memory (`sent`) only guards the wake or two between an
//!   act being sent and its paper being on the record, and an entry is dropped when the act is not applied, so a
//!   refused act is tried again (TS marked a thing done when it was planned). Memory is the only record of: a petition
//!   the mayor chose not to take up (no paper says so; a new mayor judges afresh), the clerk's notices to invalid
//!   voters (a letter is not a paper; a successor tells only of votes in the last `vote_days + 2` days), and what a
//!   visit found (a sight).
//! - *PB-11 (the code mayor's building programme).* A site the office has applied to build on (its own permit
//!   applications) is not applied for again: a road is offered on another site, never the same one twice; a park whose
//!   offer the builder declined (or whose permit was refused) is offered again on another lot in the same year, up to
//!   `park_tries` tries (new parameter, 3), where TS gave up for the year. Basis: a client whose contractor declines
//!   goes to the next site or the next tender; a council does not re-commission a site it already has under contract.
//! - *PB-12 (a law leaves the book only on a ballot).* The clerk declares a result in one step and publishes what it
//!   enacts (a law, a budget, or an amended law with its predecessor withdrawn) only in a later step, read from a
//!   passed result of its own on file, whoever's wake it is; the drafters (staff) do the same for amendments. Nothing is
//!   withdrawn without a passed, declared ballot behind it. Basis: a statute is repealed or amended only by an act
//!   passed by the legislature and certified by its clerk.
//! - *PB-14 (a councillor's vote has causes).* TS: one axis, +60/-60 on a tag, 0 loses; budgets on a 90% coin; noise a
//!   coin that flips. Now a vote is `score > 0` where the score is the sum of the councillor's own causes, each in
//!   points on the axis scale (100 = the whole axis): the axis term `|leaning| - |leaning - place|` (Downs 1957;
//!   Enelow & Hinich 1984, as before); the councillor's own values for the proposal's tags (`values`, tag -> points;
//!   for a budget, `budget_yes_bps` is its disposition to budgets, `(bps - 5000) / 100` points); deference to the
//!   proposer (`deference`, 40: the mayor or an officer; `colleague_deference`, 15: a fellow councillor; nothing for a
//!   resident; Kingdon 1973 on cue-taking from trusted colleagues, Krehbiel 1991 on deference to the better-informed
//!   proposer, Matthews 1960 on reciprocity among members); status-quo bias (`inertia`, 5 points against any change:
//!   Samuelson & Zeckhauser 1988); and an idiosyncratic taste shock uniform in +-`noise_bps / 100` points (random
//!   utility: McFadden 1974). No pass-rate coin remains; "most proposals from the mayor pass" is an outcome of the
//!   deference, to be checked against real council vote records (to confirm: unanimity of 80-90% in many councils).
//! - The ballot the clerk opens names the proposer's post (`proposed_in`) so a councillor who cannot see the proposal
//!   still knows who put it.
//! - Rounding is JavaScript's `Math.round` (half up) where a ratio is rounded; ties are broken by `filed_before`.

use super::land::own_land;
use crate::common::work::{ReportOf, Routine};
use crate::common::{
    Answering,
    bases_of, data, filed_before, go_see, is_kind, look_up, message, money_words, published_count, published_price, visited, vote, withdraw,
    addressed_to, own_account, text as record_text, Book, Fields, Letters, Part, StandingWork, DAY, VISIT_MAX, YEAR,
};
use crate::papers::{self, offices as po};
use crate::steps::{amount_text, arg, because, call, say, secs, text, Done, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms::{AnswerForm, Answers};
use oikos_rules::law::{draft_law, figure_given, figure_words, held_value, LawFigure, LawSchedule};
use oikos_sight::{LookRequest, Record, RecordBody};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

fn parse<T: DeserializeOwned>(ctx: &Ctx) -> Result<T, String> {
    serde_json::from_value(Value::Object(ctx.params.to_map())).map_err(|e| format!("{}'s parameters: {e}", ctx.participant))
}

/// An act sent and what it was for: dropped from the guard if it was not applied (a refused act is tried again).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sent(String);

/// Memory that guards the moment between sending an act and its paper being on the record.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Guard {
    sent: BTreeMap<String, i64>,
}
impl Guard {
    fn put(&mut self, key: impl Into<String>, t: i64) {
        self.sent.insert(key.into(), t);
    }
    fn has(&self, key: &str) -> bool {
        self.sent.contains_key(key)
    }
    /// Sent within `within` seconds (long enough for its paper to be on the record).
    fn recent(&self, key: &str, t: i64, within: i64) -> bool {
        self.sent.get(key).is_some_and(|at| t - at < within)
    }
    fn heard(&mut self, key: &str, done: Done) {
        if !done.applied() {
            self.sent.remove(key);
        }
    }
}

fn sent_step(key: &str, why: impl Into<String>, calls: Vec<oikos_sight::calls::Call>) -> Step<Sent> {
    let mut s = because(why, calls);
    s.then = Some(Sent(key.to_string()));
    s
}

/// A budget's year in days, as its papers say it: "day 0 to day 364". (Year 1 begins with the town's records.)
pub fn year_in_days(year: i64) -> String {
    format!("day {} to day {}", (year - 1) * 365, year * 365 - 1)
}

/// The lines of the budget the mayor's office tables, in the order the town writes them (a line it is given nothing
/// for is left out, but for parks).
pub fn tabled_lines(p: &MayorParams) -> Vec<(&'static str, i64)> {
    let mut v = vec![("parks", p.park_budget)];
    for (k, x) in [
        ("roads", p.road_budget),
        ("staff", p.staff_budget),
        ("administration", p.administration_budget),
        ("services", p.services_budget),
        ("environment", p.environment_budget),
    ] {
        if x != 0 {
            v.push((k, x));
        }
    }
    v
}

/// A budget's lines in words, as the town writes its money, and their sum.
pub fn lines_in_words(lines: &[(&str, i64)], written: &dyn Fn(i64) -> String) -> String {
    format!(
        "{}; {} in all",
        lines.iter().map(|(k, v)| format!("{k} {}", written(*v))).collect::<Vec<_>>().join(", "),
        written(lines.iter().map(|x| x.1).sum())
    )
}

/// Who voted which way on a ballot of the council, as its result records it: a council's votes are public record.
pub fn voted_words(yes: &[String], no: &[String], none: &[String]) -> String {
    let list = |xs: &[String]| if xs.is_empty() { "none".to_string() } else { xs.join(", ") };
    format!("Voting for: {}; against: {}{}.", list(yes), list(no), if none.is_empty() { String::new() } else { format!("; not voting: {}", list(none)) })
}

/// The town's budget for a year, of those adopted (the latest, if the council adopted more than one for it).
fn budget_for(book: &Book, year: i64) -> Option<&Arc<Record>> {
    let mut best: Option<&Arc<Record>> = None;
    for b in book.open("budget") {
        if data(b).i("year") == Some(year) && best.is_none_or(|x| b.at > x.at) {
            best = Some(b);
        }
    }
    best
}

fn line_of(b: &Record, line: &str) -> i64 {
    data(b).get("lines").and_then(|l| l.get(line)).and_then(Value::as_i64).unwrap_or(0)
}

fn xy(cell: &str) -> Option<(i64, i64)> {
    let mut it = cell.split('.');
    it.next()?;
    Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
}
fn dist(a: (i64, i64), b: (i64, i64)) -> i64 {
    (a.0 - b.0).abs() + (a.1 - b.1).abs()
}

fn s(x: &str) -> String {
    x.to_string()
}

// ====================================================================== city.mayor_code

fn d_responsiveness() -> i64 {
    7000
}
fn d_threshold() -> i64 {
    1500
}
fn d_population() -> i64 {
    200
}
fn d_park_budget() -> i64 {
    8_000_000
}
fn d_park() -> String {
    "park".into()
}
fn d_road() -> String {
    "road".into()
}
fn d_within() -> i64 {
    3
}
fn d_true() -> bool {
    true
}
fn d_sight() -> i64 {
    30
}
fn d_tries() -> i64 {
    3
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MayorParams {
    pub responsiveness_bps: i64,
    pub petition_threshold_bps: i64,
    pub population: i64,
    pub park_budget: i64,
    pub builder: String,
    pub park_type: String,
    pub staff_budget: i64,
    pub administration_budget: i64,
    pub services_budget: i64,
    pub environment_budget: i64,
    pub road_budget: i64,
    pub road_type: String,
    pub road_within: i64,
    pub budget_lead_days: i64,
    pub stands_again: bool,
    pub electoral: String,
    pub visits: String,
    pub sight_days: i64,
    /// How many parks it offers in a year at most when builders decline or permits are refused (PB-11).
    pub park_tries: i64,
}
impl Default for MayorParams {
    fn default() -> Self {
        MayorParams {
            responsiveness_bps: d_responsiveness(),
            petition_threshold_bps: d_threshold(),
            population: d_population(),
            park_budget: d_park_budget(),
            builder: String::new(),
            park_type: d_park(),
            staff_budget: 0,
            administration_budget: 0,
            services_budget: 0,
            environment_budget: 0,
            road_budget: 0,
            road_type: d_road(),
            road_within: d_within(),
            budget_lead_days: 0,
            stands_again: d_true(),
            electoral: String::new(),
            visits: String::new(),
            sight_days: d_sight(),
            park_tries: d_tries(),
        }
    }
}

pub struct MayorCode;

fn param(schema: Value, default: Value, unit: Option<&str>) -> Value {
    let mut m = json!({ "schema": schema, "default": default, "source": "placeholder" });
    if let Some(u) = unit {
        m["unit"] = json!(u);
    }
    m
}
fn int() -> Value {
    json!({ "type": "integer" })
}
fn string() -> Value {
    json!({ "type": "string" })
}

/// How the mayor's office answers a letter (it has no report of its own).
fn mayor_answers() -> Answers {
    Answers {
        office: "the mayor's office".into(),
        acts: "What it acts on: a petition once its organiser's published count reaches the town's threshold; an invoice for work this office commissioned, which it approves in writing; and each year's budget, which it puts to the council. It gives no direction by letter.".into(),
        forms: vec![AnswerForm {
            about: ["direction", "direct ", "staff", "recruit", "hire", "hiring", "crew", "vacanc", "posts"].iter().map(|x| s(x)).collect(),
            say: "If your letter asks for a direction: this office has given none on the matter, and an office needs none to act within its own powers and its budget line.".into(),
        }],
        report: false,
    }
}

impl Kind for MayorCode {
    fn name(&self) -> &'static str {
        "city.mayor_code"
    }
    fn version(&self) -> &'static str {
        // (Ported to Rust; the version is the TS module's, which the manifest must equal.)
        "0.12.1"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/government.md"
    }
    fn manifest(&self) -> Value {
        let mut builder = param(string(), json!(""), None);
        builder["required"] = json!(true);
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "administration_budget": param(int(), json!(0), None),
                "budget_lead_days": param(int(), json!(0), Some("days")),
                "builder": builder,
                "electoral": param(string(), json!(""), None),
                "environment_budget": param(int(), json!(0), None),
                "park_budget": param(int(), json!(8_000_000), None),
                "park_tries": param(int(), json!(3), None),
                "park_type": param(string(), json!("park"), None),
                "petition_threshold_bps": param(int(), json!(1500), Some("bps")),
                "population": param(int(), json!(200), None),
                "responsiveness_bps": param(int(), json!(7000), Some("bps")),
                "road_budget": param(int(), json!(0), None),
                "road_type": param(string(), json!("road"), None),
                "road_within": param(int(), json!(3), None),
                "services_budget": param(int(), json!(0), None),
                "sight_days": param(int(), json!(30), Some("days")),
                "staff_budget": param(int(), json!(0), None),
                "stands_again": param(json!({ "type": "boolean", "description": "false: it doesn't stand at the next election (retiring)" }), json!(true), None),
                "visits": param(string(), json!(""), None),
            },
            "perceives": [], "state": "none",
            "issues": serde_json::to_value(oikos_rules::forms::group("MAYOR")).unwrap_or(Value::Null),
            "answers": {
                "office": "the mayor's office",
                "acts": "What it acts on: a petition once its organiser's published count reaches the town's threshold; an invoice for work this office commissioned, which it approves in writing; and each year's budget, which it puts to the council. It gives no direction by letter.",
                "forms": [{ "about": ["direction", "direct ", "staff", "recruit", "hire", "hiring", "crew", "vacanc", "posts"], "say": "If your letter asks for a direction: this office has given none on the matter, and an office needs none to act within its own powers and its budget line." }],
            },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        7 * DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p: MayorParams = parse(ctx)?;
        if p.builder.is_empty() {
            return Err("city.mayor_code: the world must say builder (whom it deals with; no module assumes a world's names)".into());
        }
        // (The mayor has no report of its own: a letter is acknowledged in the words its manifest gives, as every such office's is.)
        Ok(Box::new(Answering::new(Stepper::new(Mayor {
            p,
            position: ctx.position.clone(),
            participant: ctx.participant.clone(),
            book: Book::new(),
            acted: BTreeSet::new(),
            parks: vec![],
            roads: vec![],
            tabled: BTreeMap::new(),
            nominated: vec![],
            guard: Guard::default(),
            decided: BTreeSet::new(),
            went_at: BTreeMap::new(),
            stood_free: BTreeMap::new(),
            not_as_papered: BTreeSet::new(),
            asked_to_see: BTreeMap::new(),
        }), mayor_answers())))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        // (One saved before the mayor acknowledged letters is the plain office's: wrapped, with no letter waiting.)
        match saved.get("inner") {
            Some(inner) => Ok(Box::new(Answering::restore(Stepper::<Mayor>::restore(inner.clone())?, mayor_answers(), &saved)?)),
            None => Ok(Box::new(Answering::new(Stepper::<Mayor>::restore(saved)?, mayor_answers()))),
        }
    }
}

/// One of the office's permit applications (its own papers).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Applied {
    at: i64,
    id: String,
    lot: String,
}

#[derive(Serialize, Deserialize)]
struct Mayor {
    p: MayorParams,
    position: Option<String>,
    participant: String,
    book: Book,
    /// Bases of the office's own records: what it has acted on (rebuilt from the file as records arrive).
    acted: BTreeSet<String>,
    parks: Vec<Applied>,
    roads: Vec<Applied>,
    /// Budgets tabled: year -> the latest time one was (from the office's own proposals).
    tabled: BTreeMap<i64, i64>,
    /// Nominations lodged: (office, time).
    nominated: Vec<(String, i64)>,
    guard: Guard,
    /// Petitions it has decided on (no paper records a decision to do nothing: memory).
    decided: BTreeSet<String>,
    // What it has seen by going to look (a sight: no paper records it).
    went_at: BTreeMap<String, i64>,
    stood_free: BTreeMap<String, bool>,
    not_as_papered: BTreeSet<String>,
    asked_to_see: BTreeMap<String, i64>,
}

impl Mayor {
    fn ours(&self, r: &Record) -> bool {
        match &self.position {
            Some(p) => r.position.as_deref() == Some(p.as_str()),
            None => r.author == self.participant,
        }
    }

    /// A lot of ours as we may rely on it: Some(true) seen free lately, Some(false) seen built on, None to be gone to.
    fn seen_free(&self, cells: &[String], t: i64) -> Option<bool> {
        if self.p.visits.is_empty() {
            return Some(true);
        }
        if cells.iter().any(|c| self.went_at.get(c).is_none_or(|w| *w < t - self.p.sight_days * DAY)) {
            return None;
        }
        Some(cells.iter().all(|c| self.stood_free.get(c).copied().unwrap_or(false)))
    }

    fn decision_of(&self, application: &str) -> Option<&Arc<Record>> {
        self.book.open("permit_decision").find(|d| data(d).s("application") == Some(application))
    }

    /// Did an application fail: refused (or incomplete), or granted and the builder declined the offer made on it?
    fn failed(&self, a: &Applied) -> bool {
        let Some(d) = self.decision_of(&a.id) else { return false };
        if data(d).s("decision") != Some("granted") {
            return true;
        }
        self.book.of_type("agreement").filter(|g| crate::common::cites(g, &d.id)).any(|g| self.book.all("offer_declined").any(|x| data(x).s("agreement") == Some(g.id.as_str())))
    }

    fn tried_lots(list: &[Applied]) -> BTreeSet<String> {
        list.iter().map(|a| a.lot.clone()).collect()
    }

    /// The lot a park would go on: the town's first with nothing on it, not one it has applied for already.
    fn park_lot(&self, me: &str) -> Option<super::land::OwnLot> {
        let tried = Self::tried_lots(&self.parks);
        own_land(&self.book, me).into_iter().find(|x| x.structures.is_empty() && !x.cells.is_empty() && !self.not_as_papered.contains(&x.lot) && !tried.contains(&x.lot))
    }

    fn year_open(&self, t: i64, me: &str) -> Option<(i64, i64, Arc<Record>)> {
        let year = t.div_euclid(YEAR);
        let b = budget_for(&self.book, year + 1)?.clone();
        let _ = me;
        Some((year, year + 1, b))
    }

    /// Can a park be applied for now (year, budget)? Open attempts this year, and tries.
    fn park_wanted(&self, t: i64) -> Option<(i64, Arc<Record>, i64)> {
        let (year, _, budget) = self.year_open(t, "")?;
        let price = published_price(&self.book, &self.p.builder, &self.p.park_type, "prices").unwrap_or(0);
        if price <= 0 || price > line_of(&budget, "parks") {
            return None;
        }
        let this: Vec<&Applied> = self.parks.iter().filter(|a| a.at.div_euclid(YEAR) == year).collect();
        let open = this.iter().filter(|a| !self.failed(a)).count() + usize::from(self.guard.recent(&format!("park:{year}"), t, 7 * DAY));
        if open > 0 || this.len() as i64 >= self.p.park_tries {
            return None;
        }
        Some((year, budget, price))
    }

    /// The road wanted now: (the building far from the network, the site beside it, the cell).
    fn road_wanted(&self, t: i64, me: &str) -> Option<(String, i64, Applied)> {
        let (year, _, budget) = self.year_open(t, me)?;
        let price = if self.p.road_budget != 0 { published_price(&self.book, &self.p.builder, &self.p.road_type, "prices").unwrap_or(0) } else { 0 };
        let this: Vec<&Applied> = self.roads.iter().filter(|a| a.at.div_euclid(YEAR) == year && !self.failed(a)).collect();
        let pending = self.roads.iter().any(|r| self.decision_of(&r.id).is_none() && t - r.at < 30 * DAY) || self.guard.recent("road", t, 7 * DAY);
        if price <= 0 || pending || (this.len() as i64 + 1) * price > line_of(&budget, "roads") {
            return None;
        }
        let land = own_land(&self.book, me);
        let roads: Vec<(i64, i64)> = land.iter().filter(|x| x.structures.iter().any(|st| st.1 == self.p.road_type)).flat_map(|x| x.cells.iter().filter_map(|c| xy(c))).collect();
        let mut known: BTreeMap<String, (i64, i64)> = BTreeMap::new();
        for x in &land {
            for st in &x.structures {
                if st.1 != self.p.road_type {
                    if let Some(c) = x.cells.first().and_then(|c| xy(c)) {
                        known.insert(st.0.clone(), c);
                    }
                }
            }
        }
        for n in self.book.open("building_notice") {
            let d = data(n);
            if let (Some(st), Some(at)) = (d.s("structure"), d.s("at")) {
                if d.s("structure_type") != Some(self.p.road_type.as_str()) {
                    if let Some(c) = xy(at) {
                        known.insert(st.to_string(), c);
                    }
                }
            }
        }
        for n in self.book.open("building_notice") {
            if let Some(r) = data(n).s("removes") {
                known.remove(r);
            }
        }
        if roads.is_empty() {
            return None;
        }
        let nearest = |c: (i64, i64)| roads.iter().map(|r| dist(*r, c)).min().unwrap_or(0);
        let far = known.iter().find(|(_, c)| nearest(**c) > self.p.road_within)?;
        let tried = Self::tried_lots(&self.roads);
        let mut sites: Vec<(&super::land::OwnLot, (i64, i64))> = land
            .iter()
            .filter(|x| x.structures.is_empty() && x.cells.len() == 1 && !self.not_as_papered.contains(&x.lot) && !tried.contains(&x.lot))
            .filter_map(|x| xy(&x.cells[0]).map(|c| (x, c)))
            .filter(|(_, c)| roads.iter().any(|r| dist(*r, *c) == 1))
            .collect();
        sites.sort_by(|a, b| dist(a.1, *far.1).cmp(&dist(b.1, *far.1)).then_with(|| filed_before(&a.0.lot, &b.0.lot)));
        let (site, c) = sites.first()?;
        if dist(*c, *far.1) >= nearest(*far.1) {
            return None;
        }
        Some((far.0.clone(), nearest(*far.1), Applied { at: t, id: String::new(), lot: site.lot.clone() }))
    }
}

impl Plan for Mayor {
    type Then = Sent;

    fn absorb(&mut self, pic: &Picture, _cx: &mut Cx) {
        if !self.p.visits.is_empty() {
            for c in visited(pic, &self.p.visits) {
                self.went_at.insert(c.cell.to_string(), pic.t);
                self.stood_free.insert(c.cell.to_string(), c.structure.is_none());
            }
        }
        for r in self.book.absorb(pic) {
            if !self.ours(&r) {
                continue;
            }
            for b in bases_of(&r) {
                self.acted.insert(b.to_string());
            }
            let d = data(&r);
            if is_kind(&r, "permit_application") {
                let a = Applied { at: r.at, id: r.id.to_string(), lot: d.s("lot").unwrap_or("").to_string() };
                if d.s("structure_type") == Some(self.p.park_type.as_str()) {
                    self.parks.push(a);
                } else if d.s("structure_type") == Some(self.p.road_type.as_str()) {
                    self.roads.push(a);
                }
            }
            if is_kind(&r, "proposal") {
                if let Some(e) = d.get("enact").filter(|e| e.s("kind") == Some("budget")) {
                    if let Some(y) = e.get("data").and_then(|x| x.i("year")) {
                        let at = self.tabled.entry(y).or_insert(r.at);
                        *at = (*at).max(r.at);
                    }
                }
            }
            if is_kind(&r, "nomination") {
                if let Some(o) = d.s("office") {
                    self.nominated.push((o.to_string(), r.at));
                }
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Sent>> {
        let me = pic.entity;
        let t = pic.t;
        let world = cx.ctx.world.clone();
        let usd = |n: i64| money_words(n, &world);
        let mut steps: Vec<Step<Sent>> = vec![];
        // An election for our office: standing again (once each notice, while nominations are open), on what we've done.
        let notices: Vec<Arc<Record>> = self.book.open("election_notice").cloned().collect();
        for n in notices {
            let Some(pos) = self.position.clone() else { continue };
            let nd = papers::read::<po::ElectionNotice>(&n);
            let Some(nd) = nd else { continue };
            let key = format!("nom:{}", n.id);
            if !self.p.stands_again || nd.office != pos || t >= nd.nominations_close_at || self.guard.has(&key) || self.nominated.iter().any(|(o, at)| *o == pos && *at >= n.at) {
                continue;
            }
            self.guard.put(&key, t);
            let platform = "Standing again: keeping the town's services running, its parks built and its budget balanced.";
            let to = if self.p.electoral.is_empty() { me } else { self.p.electoral.clone().into() };
            steps.push(sent_step(
                &key,
                "An election for this office: nominating, as the incumbent.",
                vec![say(
                    "nomination",
                    &format!("Nomination for {pos}: the incumbent. {platform}"),
                    Say {
                        to: Some(vec![to.to_string()]),
                        visible: Some(Visible::Public),
                        data: Some(papers::data(&po::Nomination { office: pos.clone(), name: Some("the incumbent mayor".into()), incumbent: Some(true), values: vec!["security".into(), "benevolence".into()] })),
                        extra: vec![("assertion", json!({ "that": platform }))],
                        ..Default::default()
                    },
                )],
            ));
        }
        // The annual budget (tabled before the year begins; again every 45 days until the council adopts one).
        let this_year = t.div_euclid(YEAR) + 1;
        let for_year = if budget_for(&self.book, this_year).is_none() {
            this_year
        } else if self.p.budget_lead_days > 0 && this_year * YEAR - t <= self.p.budget_lead_days * DAY && budget_for(&self.book, this_year + 1).is_none() {
            this_year + 1
        } else {
            0
        };
        if for_year > 0 {
            let mut last = self.tabled.get(&for_year).copied();
            if let Some(at) = self.guard.sent.get(&format!("budget:{for_year}")) {
                last = Some(last.map_or(*at, |l| l.max(*at)));
            }
            if last.is_none_or(|l| t >= l + 45 * DAY) {
                let first = last.is_none();
                let lines = tabled_lines(&self.p);
                let words = format!("The town's budget for year {for_year} ({}): {}.", year_in_days(for_year), lines_in_words(&lines, &usd));
                let why = if !first {
                    format!("No budget adopted for year {for_year} yet: tabling it again.")
                } else if for_year > this_year {
                    format!("Year {for_year} begins in {} days: tabling its budget, for the council to adopt before then.", (this_year * YEAR - t + DAY - 1) / DAY)
                } else {
                    "This year has no adopted budget: tabling one.".to_string()
                };
                let key = format!("budget:{for_year}");
                self.guard.put(&key, t);
                let lines_map: BTreeMap<&str, i64> = lines.iter().copied().collect();
                steps.push(sent_step(
                    &key,
                    why,
                    vec![say("proposal", &words, Say { to: Some(vec![me.to_string()]), data: Some(json!({ "enact": { "kind": "budget", "text": words, "data": { "year": for_year, "lines": lines_map } }, "tags": ["budget"] })), ..Default::default() })],
                ));
            }
        }
        // A park a year (or another site when the builder declined one), if the adopted budget has room.
        if let Some((year, budget, _price)) = self.park_wanted(t) {
            if let Some(lot) = self.park_lot(&me) {
                let free = self.seen_free(&lot.cells, t);
                if free == Some(false) {
                    self.not_as_papered.insert(lot.lot.clone());
                }
                if free == Some(true) {
                    let key = format!("park:{year}");
                    self.guard.put(&key, t);
                    steps.push(sent_step(
                        &key,
                        format!("The adopted budget has {} for parks and {} is free (our asset register says so, and we have been to see): applying for a permit for a {}, as anyone would.", usd(line_of(&budget, "parks")), lot.lot, self.p.park_type),
                        vec![call("form", vec![("to", Some(arg(&me))), ("form", Some(arg("permit_application"))), ("lot", Some(arg(&lot.lot))), ("structure_type", Some(arg(&self.p.park_type)))])],
                    ));
                }
            }
        }
        // Roads: toward a building more than `road_within` cells from the network, one at a time, never the same site twice.
        if let Some((far, near, site)) = self.road_wanted(t, &me) {
            let cells: Vec<String> = own_land(&self.book, &me).into_iter().find(|x| x.lot == site.lot).map(|x| x.cells).unwrap_or_default();
            let free = self.seen_free(&cells, t);
            if free == Some(false) {
                self.not_as_papered.insert(site.lot.clone());
            }
            if free == Some(true) {
                self.guard.put("road", t);
                steps.push(sent_step(
                    "road",
                    format!("{far} is {near} cells from the nearest road (we build toward anything further than {}), and the roads budget has room: applying for a permit for a road on {}, toward it.", self.p.road_within, site.lot),
                    vec![call("form", vec![("to", Some(arg(&me))), ("form", Some(arg("permit_application"))), ("lot", Some(arg(&site.lot))), ("structure_type", Some(arg(&self.p.road_type)))])],
                ));
            }
        }
        // A permit granted: commission the builder.
        let decisions: Vec<Arc<Record>> = self.book.open("permit_decision").cloned().collect();
        for d in decisions {
            let key = format!("commission:{}", d.id);
            if self.acted.contains(d.id.as_str()) || self.guard.has(&key) || !addressed_to(&d).iter().any(|x| x == &me.to_string()) {
                continue;
            }
            let dd = data(&d);
            let Some(app) = dd.s("application").and_then(|a| self.book.get(a)).cloned() else { continue };
            if !is_kind(&app, "permit_application") || !self.ours(&app) || dd.s("decision") != Some("granted") {
                continue;
            }
            let ad = data(&app);
            let ty = if ad.s("structure_type") == Some(self.p.road_type.as_str()) { self.p.road_type.clone() } else { self.p.park_type.clone() };
            let cost = published_price(&self.book, &self.p.builder, &ty, "prices").filter(|_| ty != self.p.road_type || self.p.road_budget != 0).unwrap_or(0);
            if cost == 0 {
                continue;
            }
            self.guard.put(&key, t);
            let from = own_account(pic).map(|a| a.account);
            let mut st = sent_step(
                &key,
                format!("The {ty}'s permit was granted: commissioning the builder."),
                vec![call(
                    "structure",
                    vec![
                        ("type", Some(arg(&ty))),
                        ("on", ad.s("lot").map(arg)),
                        ("by", Some(arg(&self.p.builder))),
                        ("price", Some(amount_text(cost, cx))),
                        ("from", from.as_deref().map(arg)),
                        ("basis", Some(arg(&d.id))),
                    ],
                )],
            );
            st.lines[0].bind = Some(ty.clone());
            steps.push(st);
        }
        // Approve invoices for work we commissioned.
        let invoices: Vec<Arc<Record>> = self.book.open("invoice").cloned().collect();
        for inv in invoices {
            let key = format!("approval:{}", inv.id);
            if self.acted.contains(inv.id.as_str()) || self.guard.has(&key) || !addressed_to(&inv).iter().any(|x| x == &me.to_string()) {
                continue;
            }
            let ours_ag = bases_of(&inv).iter().filter_map(|b| self.book.get(b)).any(|x| matches!(x.body, RecordBody::Agreement { .. }) && self.ours(x));
            if ours_ag {
                self.guard.put(&key, t);
                steps.push(sent_step(
                    &key,
                    "An invoice for work we commissioned: approving it in writing, as the payments procedure requires.",
                    vec![say("approval", &format!("Approved: pay invoice {}.", inv.id), Say { to: Some(vec![me.to_string()]), basis: Some(inv.id.to_string()), data: Some(papers::data(&po::Approval { invoice: inv.id.to_string() })), ..Default::default() })],
                ));
            }
        }
        // Petitions with enough signatures become proposals (sometimes).
        let petitions: Vec<Arc<Record>> = self.book.open("petition").cloned().collect();
        for pet in petitions {
            if self.decided.contains(pet.id.as_str()) || self.acted.contains(pet.id.as_str()) || self.guard.has(&format!("pet:{}", pet.id)) {
                continue;
            }
            if published_count(&self.book, &pet) * 10_000 < self.p.petition_threshold_bps * self.p.population {
                continue;
            }
            self.decided.insert(pet.id.to_string());
            if cx.rng(&format!("respond-{}", pet.id)).below(10_000) as i64 >= self.p.responsiveness_bps {
                continue;
            }
            if let Some(st) = self.answer_petition(&pet, &me, cx) {
                steps.extend(st);
            }
        }
        steps
    }

    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        if self.p.visits.is_empty() {
            return vec![];
        }
        let (t, me) = (pic.t, pic.entity);
        let mut want: Vec<String> = vec![];
        if self.park_wanted(t).is_some() {
            if let Some(l) = self.park_lot(&me) {
                want.extend(l.cells);
            }
        }
        if let Some((_, _, site)) = self.road_wanted(t, &me) {
            if let Some(l) = own_land(&self.book, &me).into_iter().find(|x| x.lot == site.lot) {
                want.extend(l.cells);
            }
        }
        let stale: Vec<String> = want
            .into_iter()
            .filter(|c| self.went_at.get(c).is_none_or(|w| *w < t - self.p.sight_days * DAY) && self.asked_to_see.get(c).is_none_or(|a| t - a >= DAY))
            .take(VISIT_MAX)
            .collect();
        if stale.is_empty() {
            return vec![];
        }
        for c in &stale {
            self.asked_to_see.insert(c.clone(), t);
        }
        vec![go_see(&self.p.visits, &stale)]
    }

    fn then(&mut self, token: &Sent, done: Done, _cx: &mut Cx) -> Vec<Step<Sent>> {
        self.guard.heard(&token.0, done);
        if !done.applied() {
            // (A petition's answer not applied is tried again.)
            if let Some(id) = token.0.strip_prefix("pet:") {
                self.decided.remove(id);
            }
        }
        vec![]
    }
}

impl Mayor {
    fn answer_petition(&mut self, pet: &Arc<Record>, me: &str, cx: &mut Cx) -> Option<Vec<Step<Sent>>> {
        let key = format!("pet:{}", pet.id);
        let t = cx.t;
        let d = data(pet).get("demand").cloned().unwrap_or(Value::Null);
        let tags: Vec<String> = d.get("tags").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(s)).collect()).unwrap_or_default();
        let amend = d.get("amend");
        let schedule = amend.and_then(|a| a.s("schedule"));
        let form = schedule.and_then(|sc| self.book.open("form").find(|f| f.speaks_for.as_deref() == Some(me) && data(f).s("amends") == Some(sc)).cloned());
        let fd = form.as_ref().and_then(|f| papers::read::<po::Form>(f));
        let asked: Vec<(String, i64)> = match (&fd, amend) {
            (Some(f), Some(a)) => a
                .get("figures")
                .and_then(Value::as_object)
                .map(|m| m.iter().filter(|(k, v)| f.fields.contains_key(*k) && v.is_i64()).map(|(k, v)| (k.clone(), v.as_i64().unwrap_or(0))).collect())
                .unwrap_or_default(),
            _ => vec![],
        };
        let answer = |words: &str| {
            say(
                "petition_response",
                &format!("Answer to petition {}: {words}", pet.id),
                Say {
                    to: pet.speaks_for.map(|x| vec![x.to_string()]),
                    visible: Some(Visible::Public),
                    basis: Some(pet.id.to_string()),
                    data: Some(papers::data(&po::PetitionResponse { petition: pet.id.to_string(), answer: words.to_string() })),
                    ..Default::default()
                },
            )
        };
        if let (Some(f), Some(fd), true) = (&form, &fd, !asked.is_empty()) {
            let law = self
                .book
                .open("law")
                .filter(|l| l.speaks_for.as_deref() == Some(me) && data(l).s("schedule") == schedule)
                .fold(None::<&Arc<Record>>, |a, b| if a.is_none_or(|a| b.at >= a.at) { Some(b) } else { a })
                .cloned();
            if let Some(l) = &law {
                if asked.iter().all(|(k, v)| data(l).get("figures").and_then(|f| f.get(k)).and_then(|x| x.i("value")) == Some(*v)) {
                    self.guard.put(&key, t);
                    return Some(vec![sent_step(&key, "A petition asking for what the law in force already says: answering so.", vec![answer(&format!("the law in force ({}) already says what it asks.", l.id))])]);
                }
            }
            let mut cargs: Vec<(&str, Option<oikos_sight::calls::Value>)> = vec![("to", Some(arg(me))), ("form", Some(arg(&fd.form)))];
            let fields: Vec<(String, oikos_sight::calls::Value)> = asked
                .iter()
                .map(|(k, v)| {
                    let fld = &fd.fields[k];
                    (k.clone(), if fld.type_ == "duration" { secs(*v) } else { text(per_text(*v, fld.per_unit.unwrap_or(1))) })
                })
                .collect();
            for (k, v) in &fields {
                cargs.push((k.as_str(), Some(v.clone())));
            }
            let affects = if tags.iter().any(|x| x == "tenant_protection") { "tenants" } else if tags.iter().any(|x| x == "development") { "development" } else { "neither" };
            cargs.push(("affects", Some(arg(affects))));
            let _ = f;
            self.guard.put(&key, t);
            return Some(vec![sent_step(
                &key,
                format!(
                    "A petition passed {}% of the town: putting what it asks that the {} form covers ({}) to the council on that form (we respond to {}% of such petitions).",
                    crate::firms::decimal::fmt_dec(self.p.petition_threshold_bps, 100),
                    fd.form.replace('_', " "),
                    asked.iter().map(|x| x.0.as_str()).collect::<Vec<_>>().join(", "),
                    crate::firms::decimal::fmt_dec(self.p.responsiveness_bps, 100)
                ),
                vec![
                    call("form", cargs),
                    answer(&format!(
                        "what it asks that the law in force covers ({}) has been put to the council as an amendment of that law. The rest of what it asks hasn't been put.",
                        asked.iter().map(|x| x.0.replace('_', " ")).collect::<Vec<_>>().join(", ")
                    )),
                ],
            )]);
        }
        let text_ = d.s("text").unwrap_or("");
        let mut enact = Map::new();
        enact.insert("kind".into(), json!("law"));
        enact.insert("text".into(), json!(text_));
        if let Some(a) = d.get("adico").filter(|x| !x.is_null()) {
            enact.insert("adico".into(), a.clone());
        }
        if let Some(f) = d.get("formal").filter(|x| !x.is_null()) {
            enact.insert("formal".into(), f.clone());
        }
        self.guard.put(&key, t);
        Some(vec![sent_step(
            &key,
            format!("A petition passed {}% of the town: putting its demand to the council (we respond to {}% of such petitions).", crate::firms::decimal::fmt_dec(self.p.petition_threshold_bps, 100), crate::firms::decimal::fmt_dec(self.p.responsiveness_bps, 100)),
            vec![say("proposal", &format!("Proposal (from petition {}): {text_}", pet.id), Say { to: Some(vec![me.to_string()]), basis: Some(pet.id.to_string()), data: Some(json!({ "enact": Value::Object(enact), "tags": tags })), ..Default::default() })],
        )])
    }
}

/// `v / per` as JavaScript wrote a number: whole, or a decimal with trailing noughts dropped.
fn per_text(v: i64, per: i64) -> String {
    let per = per.max(1);
    if v % per == 0 {
        return (v / per).to_string();
    }
    // (Six places, rounded half away from nought, trailing noughts dropped.)
    let neg = (v < 0) != (per < 0) && v != 0;
    let (n, d) = (i128::from(v).abs(), i128::from(per).abs());
    let scaled = (n * 1_000_000 * 2 + d) / (2 * d);
    let (whole, frac) = (scaled / 1_000_000, scaled % 1_000_000);
    let sign = if neg { "-" } else { "" };
    if frac == 0 {
        return format!("{sign}{whole}");
    }
    format!("{sign}{whole}.{}", format!("{frac:06}").trim_end_matches('0'))
}

// ====================================================================== city.council_clerk

fn d_vote_days() -> i64 {
    14
}
fn d_members_role() -> String {
    "councillor".into()
}
fn d_members_every() -> i64 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ClerkParams {
    pub vote_days: i64,
    pub who: String,
    pub members_role: String,
    pub members_every_days: i64,
    pub electoral: String,
    pub part: String,
    pub office: String,
}
impl Default for ClerkParams {
    fn default() -> Self {
        ClerkParams { vote_days: d_vote_days(), who: String::new(), members_role: d_members_role(), members_every_days: d_members_every(), electoral: String::new(), part: String::new(), office: String::new() }
    }
}

pub struct CouncilClerk;

fn clerk_answers() -> Answers {
    Answers {
        office: "the council clerk's office".into(),
        acts: "What it acts on: a proposal put to the council on the council proposal form (council_proposal) or on a law's amendment form, which it puts to a ballot of the councillors; and the votes cast in a councillor's post while a ballot is open.".into(),
        forms: vec![AnswerForm {
            about: ["propos", "motion", "amend", "resolution", "put to the council", "put to council"].iter().map(|x| s(x)).collect(),
            say: "What you want the council to decide goes on the council proposal form (council_proposal); a change to a figure in a law in force goes on that law's amendment form.".into(),
        }],
        report: true,
    }
}

impl Kind for CouncilClerk {
    fn name(&self) -> &'static str {
        "city.council_clerk"
    }
    fn version(&self) -> &'static str {
        "0.11.1"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/government.md"
    }
    fn manifest(&self) -> Value {
        let a = clerk_answers();
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "electoral": param(string(), json!(""), None),
                "members_every_days": param(int(), json!(30), Some("days")),
                "members_role": param(string(), json!("councillor"), None),
                "office": param(string(), json!(""), None),
                "part": param(string(), json!(""), None),
                "vote_days": param(int(), json!(14), Some("days")),
                "who": param(json!({ "type": "string", "description": "its channel onto who's who, where it looks up its council's members (\"\": it knows them as it is shown them)" }), json!(""), None),
            },
            "perceives": [], "state": "none",
            "issues": serde_json::to_value(oikos_rules::forms::group("COUNCIL_CLERK")).unwrap_or(Value::Null),
            "routines": [{ "task": "enact", "at": "office", "every": 1, "what": "When the council has passed a proposal made on a law's amendment form and the clerk has declared the result, the office's drafters write the amended law out by the law's own schedule, with the figures the proposal gives and the rest as they stand, publish it in place of the law in force, and withdraw that one. Declaring a result does not by itself change a law: this does. A law proposed in free words, or a budget, is not theirs: the clerk publishes that." }],
            "answers": { "office": a.office, "acts": a.acts, "forms": [{ "about": a.forms[0].about, "say": a.forms[0].say }], "report": true },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p: ClerkParams = parse(ctx)?;
        Ok(Box::new(Stepper::new(Clerk {
            routines: StandingWork::new(&ctx.entity, Part::from_param(&p.part), []),
            part: Part::from_param(&p.part),
            p,
            position: ctx.position.clone(),
            participant: ctx.participant.clone(),
            book: Book::new(),
            letters: Letters::default(),
            guard: Guard::default(),
            examined: BTreeMap::new(),
            report_day: -1,
            members_asked: None,
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Clerk>::restore(saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct Clerk {
    p: ClerkParams,
    part: Part,
    position: Option<String>,
    participant: String,
    book: Book,
    routines: StandingWork,
    letters: Letters,
    guard: Guard,
    /// Votes already examined (and told, if they did not count): id -> time cast. A letter is no paper (memory).
    examined: BTreeMap<String, i64>,
    report_day: i64,
    members_asked: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ClerkThen {
    key: String,
    /// A staff count to take back if the act was not applied.
    enacted: bool,
}

/// A proposal made on a law's amendment form: the schedule the law is written by, the law in force (if any), and the
/// figures the proposal gives, as held.
struct Amendment {
    schedule_id: String,
    s: LawSchedule,
    law: Option<Arc<Record>>,
    given: BTreeMap<String, i64>,
}

fn law_by_schedule(book: &Book, me: &str, schedule: &str) -> Option<Arc<Record>> {
    book.open("law").filter(|l| l.speaks_for.as_deref() == Some(me) && data(l).s("schedule") == Some(schedule)).fold(None::<&Arc<Record>>, |a, b| if a.is_none_or(|a| b.at >= a.at) { Some(b) } else { a }).cloned()
}

/// The town's schedules still standing, each with its amendment form (if one stands) and the law in force it wrote.
fn schedules(book: &Book, me: &str) -> Vec<(Arc<Record>, LawSchedule, Option<Arc<Record>>, Option<Arc<Record>>)> {
    let mut v: Vec<_> = book
        .open("law_schedule")
        .filter(|x| x.speaks_for.as_deref() == Some(me) && data(x).get("figures").is_some() && data(x).get("text").is_some_and(Value::is_string))
        .cloned()
        .collect();
    v.sort_by(|a, b| a.id.cmp(&b.id));
    v.into_iter()
        .filter_map(|sc| {
            let s: LawSchedule = serde_json::from_value(data(&sc).clone()).ok()?;
            let form = book.open("form").find(|f| f.speaks_for.as_deref() == Some(me) && data(f).s("amends") == Some(sc.id.as_str())).cloned();
            let law = law_by_schedule(book, me, &sc.id);
            Some((sc, s, form, law))
        })
        .collect()
}

fn amendment(book: &Book, me: &str, prop: Option<&Arc<Record>>) -> Option<Amendment> {
    let prop = prop?;
    let form = bases_of(prop).iter().filter_map(|b| book.get(b)).find(|x| is_kind(x, "form"))?;
    if form.speaks_for.as_deref() != Some(me) {
        return None;
    }
    let amends = data(form).s("amends")?;
    let (sc, s, _, law) = schedules(book, me).into_iter().find(|x| x.0.id == amends)?;
    let mut given = BTreeMap::new();
    for (k, f) in &s.figures {
        if let Some(v) = data(prop).get(k).and_then(|x| x.as_i64()).filter(|v| *v >= 0) {
            given.insert(k.clone(), held_value(f, v));
        }
    }
    Some(Amendment { schedule_id: sc.id.to_string(), s, law, given })
}

fn cap(x: &str) -> String {
    let mut c = x.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// What an amendment changes, in words.
fn changes(am: &Amendment, was: bool) -> String {
    am.given
        .iter()
        .map(|(k, v)| {
            let f: &LawFigure = &am.s.figures[k];
            let now = am.law.as_ref().and_then(|l| data(l).get("figures")).and_then(|f| f.get(k)).and_then(|x| x.i("value"));
            let words = |x: Option<i64>| if figure_given(Some(f), x) { figure_words(f, x, true) } else { "none".to_string() };
            let tail = if am.law.is_some() { format!(" ({})", if words(now) == words(Some(*v)) { "unchanged".to_string() } else { format!("{} {}", if was { "was" } else { "now" }, words(now)) }) } else { String::new() };
            format!("{} {}{tail}", f.label.clone().unwrap_or_else(|| k.clone()), words(Some(*v)))
        })
        .collect::<Vec<_>>()
        .join("; ")
}

const WORDS_ONLY: &str = "The law is recorded as worded. No rule was set down with it for acts to be checked against.";

/// Where figures are changed: the laws made from figures, each with its amendment form.
fn amendable(book: &Book, me: &str, with_figures: bool) -> String {
    let list: Vec<_> = schedules(book, me).into_iter().filter(|x| x.2.is_some()).collect();
    if list.is_empty() {
        return String::new();
    }
    let items: Vec<String> = list
        .iter()
        .map(|(_, sc, form, law)| {
            let mut x = format!("{}{} on {}", sc.title, law.as_ref().map_or(" (none in force)".to_string(), |l| format!(" ({})", l.id)), form.as_ref().and_then(|f| data(f).s("form")).unwrap_or(""));
            if let (true, Some(l)) = (with_figures, law) {
                x += &format!(
                    " ({})",
                    sc.figures.iter().map(|(k, f)| format!("{k}: {}, now {}", f.label.clone().unwrap_or_else(|| k.clone()), figure_words(f, data(l).get("figures").and_then(|g| g.get(k)).and_then(|y| y.i("value")), true))).collect::<Vec<_>>().join("; ")
                );
            }
            x
        })
        .collect();
    format!(" Laws made from figures are amended on their own forms: {}.", items.join("; "))
}

/// A passed amendment written into law: the amended law by its schedule (the figures given, the rest as they stand in
/// the law in force now), published in place of the law in force, which is then withdrawn; and what the result says
/// became of it. No calls where it cannot be written. Called only for a passed, declared ballot (PB-12).
fn enact_amendment(am: &Amendment, ballot: &str, book: &Book) -> (Vec<oikos_sight::calls::Call>, String) {
    let mut values: BTreeMap<String, i64> = am.law.as_ref().map(|l| oikos_rules::law::figures_of(data(l))).unwrap_or_default();
    values.extend(am.given.clone());
    let needed: Vec<&String> = am.s.figures.iter().filter(|(k, f)| !f.optional && !figure_given(Some(f), values.get(*k).copied())).map(|(k, _)| k).collect();
    let missing: Vec<String> = if !needed.is_empty() {
        needed.into_iter().cloned().collect()
    } else if am.s.figures.iter().any(|(k, f)| figure_given(Some(f), values.get(k).copied())) {
        vec![]
    } else {
        am.s.figures.keys().cloned().collect()
    };
    if !missing.is_empty() {
        return (vec![], format!(" Nothing is enacted: {} is no longer in force, and the proposal doesn't give {}.", am.s.title, missing.iter().map(|k| am.s.figures[k].label.clone().unwrap_or_else(|| k.clone())).collect::<Vec<_>>().join(" or ")));
    }
    let Ok(law) = draft_law(&am.schedule_id, &am.s, &values) else {
        return (vec![], format!(" Nothing is enacted: {} couldn't be written out from its figures.", am.s.title));
    };
    let mut data_ = law.data();
    if let Some(l) = &am.law {
        data_["replaces"] = json!(l.id);
    }
    let mut extra: Vec<(&'static str, Value)> = vec![];
    if let Some(a) = &law.adico {
        extra.push(("adico", json!(a)));
    }
    if let Some(f) = &law.formal {
        extra.push(("formal", json!(f)));
    }
    let words = format!("{} ({})", law.text, match &am.law { Some(l) => format!("As amended by the council on ballot {ballot}; this replaces {}.", l.id), None => format!("Made by the council on ballot {ballot}.") });
    let mut calls = vec![say("law", &words, Say { basis: Some(ballot.to_string()), visible: Some(Visible::Public), data: Some(data_), extra, ..Default::default() })];
    // (Only a law still standing, replaced on a passed, declared ballot: the guard of PB-12.)
    if let Some(l) = &am.law {
        if !book.withdrawn(&l.id) {
            calls.push(withdraw(&l.id, Some(&format!("Amended by the council on ballot {ballot}."))));
        }
    }
    let note = format!(
        " {} is amended: {}.{}{}",
        cap(&am.s.title),
        changes(am, true),
        am.law.as_ref().map_or(String::new(), |l| format!(" The amended law takes the place of {}.", l.id)),
        if law.formal.is_some() { " It is written as the law it replaces was, so acts are checked against it in the same way.".to_string() } else { format!(" {WORDS_ONLY}") }
    );
    (calls, note)
}

/// What a proposal made on the council proposal form enacts if it passes: a law, or a budget.
fn from_form(prop: Option<&Arc<Record>>, t: i64) -> Option<(String, String, Value)> {
    let d = data(prop?);
    let words = d.s("proposal")?;
    match d.s("kind") {
        Some("law") => Some(("law".into(), words.into(), Value::Null)),
        Some("budget") => {
            let mut lines = BTreeMap::new();
            let line = |x: &Value| -> Option<i64> {
                match x {
                    Value::Number(n) => n.as_i64(),
                    Value::String(sx) => amount_cents(sx),
                    _ => None,
                }
            };
            lines.insert("parks".to_string(), d.get("parks").and_then(line).unwrap_or(0));
            if let Some(o) = d.as_object() {
                for (k, v) in o {
                    if !["proposal", "kind", "affects", "form", "year"].contains(&k.as_str()) && (v.is_string() || v.is_number()) {
                        if let Some(x) = line(v) {
                            lines.insert(k.clone(), x);
                        }
                    }
                }
            }
            let now = t.div_euclid(YEAR) + 1;
            let year = d.get("year").and_then(|y| y.as_i64()).filter(|y| *y >= now).unwrap_or(now);
            Some(("budget".into(), words.into(), json!({ "year": year, "lines": lines })))
        }
        _ => None,
    }
}

/// An amount as a form writes it: cents as digits, or a decimal in the world's units is not read here (a form's amount
/// field is written in the smallest unit: contracts FormWrites).
fn amount_cents(x: &str) -> Option<i64> {
    x.trim().parse::<i64>().ok()
}

fn form_tags(prop: &Record) -> Vec<String> {
    let d = data(prop);
    if d.s("kind") == Some("budget") {
        vec!["budget".into()]
    } else if d.s("affects") == Some("tenants") {
        vec!["tenant_protection".into()]
    } else if d.s("affects") == Some("development") {
        vec!["development".into()]
    } else {
        vec![]
    }
}

impl Clerk {
    fn councillors(&self, me: &str) -> BTreeSet<String> {
        self.book.positions().iter().filter(|(_, x)| x.role.as_deref() == Some(self.p.members_role.as_str()) && x.entity == me).map(|(k, _)| k.clone()).collect()
    }
    fn declared(&self, me: &str, ballot: &str) -> Option<&Arc<Record>> {
        self.book.open("ballot_result").find(|r| r.speaks_for.as_deref() == Some(me) && data(r).s("ballot") == Some(ballot))
    }
    /// Has the clerk published what a ballot enacted (a law or budget resting on it)?
    fn enacted(&self, me: &str, ballot: &str) -> bool {
        ["law", "budget"].iter().any(|k| self.book.all(k).any(|l| l.speaks_for.as_deref() == Some(me) && crate::common::cites(l, ballot)))
    }
}

impl Plan for Clerk {
    type Then = ClerkThen;

    fn absorb(&mut self, pic: &Picture, _cx: &mut Cx) {
        self.book.absorb(pic);
        self.letters.take(pic, &self.book);
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<ClerkThen>> {
        let me = pic.entity;
        let t = pic.t;
        let mut steps: Vec<Step<ClerkThen>> = vec![];
        let key_step = |key: &str, why: String, calls: Vec<oikos_sight::calls::Call>, enacted: bool| {
            let mut st = because(why, calls);
            st.then = Some(ClerkThen { key: key.to_string(), enacted });
            st
        };
        let councillors = self.councillors(&me);
        let part = self.part;
        // The office's drafters (the staff part): amendments passed and declared are written into law, once.
        if part == Part::Staff {
            let working = self.routines.does(&self.book, "enact", t, DAY).is_some();
            let mut waiting = 0;
            let results: Vec<Arc<Record>> = self.book.open("ballot_result").cloned().collect();
            for r in results {
                let Some(ballot_id) = data(&r).s("ballot").map(s) else { continue };
                if r.speaks_for.as_deref() != Some(me.as_str()) || data(&r).get("passed") != Some(&Value::Bool(true)) {
                    continue;
                }
                let key = format!("enact:{ballot_id}");
                let Some(ballot) = self.book.get(&ballot_id).cloned() else { continue };
                let prop = data(&ballot).s("proposal").and_then(|p| self.book.get(p)).cloned();
                let Some(am) = amendment(&self.book, &me, prop.as_ref()) else { continue };
                if self.enacted(&me, &ballot_id) || self.guard.has(&key) {
                    continue;
                }
                if !working {
                    waiting += 1;
                    continue;
                }
                let (calls, note) = enact_amendment(&am, &ballot_id, &self.book);
                if calls.is_empty() {
                    self.routines.held_up("enact", &format!("the amendment passed on {ballot_id} could not be written into law:{note}"));
                } else {
                    self.guard.put(&key, t);
                    self.routines.did("enact", t, 1, &[]);
                    steps.push(key_step(&key, format!("The council passed an amendment on {ballot_id} and its result is declared ({}): writing it into the law by the law's schedule.", r.id), calls, true));
                }
            }
            if working {
                self.routines.note("enact", if waiting > 0 { None } else { Some("no amendment the council has passed is waiting to be written into law".into()) });
            } else {
                self.routines.note("enact", (waiting > 0).then(|| format!("{waiting} amendment{} the council has passed and the clerk has declared {} to be written into law", if waiting == 1 { "" } else { "s" }, if waiting == 1 { "waits" } else { "wait" })));
            }
            if self.report_day != t.div_euclid(DAY) {
                self.report_day = t.div_euclid(DAY);
                let office = self.position.clone().unwrap_or_default();
                let office = office.strip_suffix("-staff").unwrap_or(&office).to_string();
                let rep = self.routines.report::<ClerkThen>(&self.book, cx, &ReportOf { office: &office, from: "the clerk's drafters", tasks: vec![("enact", "amendments written into law", None)], ..Default::default() });
                steps.extend(rep);
            }
            return steps;
        }
        let at = if !self.p.office.is_empty() { self.p.office.clone() } else { self.position.clone().unwrap_or_else(|| "office".into()) };
        steps.extend(self.routines.set::<ClerkThen>(&self.book, &[Routine { task: "enact", at: &at, every: DAY, why: "Setting the drafters' work: an amendment the council has passed is written into the law it amends, as a standing work order." }]));
        // An election declared by the electoral body: whoever it declares elected takes the office.
        if !self.p.electoral.is_empty() {
            let rs: Vec<Arc<Record>> = self.book.open("ballot_result").cloned().collect();
            for r in rs {
                let d = data(&r);
                let (Some(office), Some(winner)) = (d.s("office"), d.s("winner")) else { continue };
                let key = format!("seat:{}", r.id);
                if r.speaks_for.as_deref() != Some(self.p.electoral.as_str()) || self.guard.has(&key) || self.book.position(office).is_some_and(|p| p.holder.as_deref() == Some(winner)) {
                    continue;
                }
                self.guard.put(&key, t);
                steps.push(key_step(&key, format!("The electoral body has declared {winner} elected to {office}: seating them."), vec![call("position", vec![("appoint", Some(arg(office))), ("to", Some(arg(winner)))])], false));
            }
        }
        // Proposals to a ballot.
        let props: Vec<Arc<Record>> = self.book.open("proposal").cloned().collect();
        for prop in props {
            let key = format!("ballot:{}", prop.id);
            if !addressed_to(&prop).iter().any(|x| x == &me.to_string()) || self.guard.has(&key) || self.book.open("ballot").any(|b| b.speaks_for.as_deref() == Some(me.as_str()) && data(b).s("proposal") == Some(prop.id.as_str())) {
                continue;
            }
            let am = amendment(&self.book, &me, Some(&prop));
            if let Some(am) = &am {
                if am.given.is_empty() {
                    self.guard.put(&key, t);
                    steps.push(key_step(
                        &key,
                        "A proposal on an amendment form that names no figure to change: not put to a ballot, and saying so.".into(),
                        vec![message(
                            &[prop.author.clone()],
                            &format!(
                                "Your proposal {} to amend {} names no figure to change, so it hasn't been put to a ballot. The figures that can be changed: {}.",
                                prop.id,
                                am.s.title,
                                am.s.figures.iter().map(|(k, f)| format!("{k} ({}{})", f.label.clone().unwrap_or_else(|| k.clone()), am.law.as_ref().map_or(String::new(), |l| format!(", now {}", figure_words(f, data(l).get("figures").and_then(|g| g.get(k)).and_then(|y| y.i("value")), true))))).collect::<Vec<_>>().join("; ")
                            ),
                            Some(&prop.id),
                        )],
                        false,
                    ));
                    continue;
                }
            }
            let words = match &am {
                Some(am) => format!("Council ballot: to amend {}{}: {}.", am.s.title, am.law.as_ref().map_or(String::new(), |l| format!(" ({})", l.id)), changes(am, false)),
                None => format!("Council ballot: {}", record_text(&prop)),
            };
            let tags: Vec<String> = match data(&prop).get("tags").and_then(Value::as_array) {
                Some(a) => a.iter().filter_map(|x| x.as_str().map(s)).collect(),
                None => form_tags(&prop),
            };
            let mut bd = json!({ "proposal": prop.id, "options": ["yes", "no"], "closes_at": t + self.p.vote_days * DAY, "electorate": "council", "tags": tags });
            if let Some(p) = &prop.position {
                bd["proposed_in"] = json!(p);
            }
            self.guard.put(&key, t);
            steps.push(key_step(&key, "A proposal addressed to the council: opening a ballot.".into(), vec![say("ballot", &words, Say { basis: Some(prop.id.to_string()), data: Some(bd), ..Default::default() })], false));
        }
        // Ballots closed: counted and declared. Only once the council's members are known.
        let ballots: Vec<Arc<Record>> = self.book.open("ballot").cloned().collect();
        for ballot in &ballots {
            let bd = data(ballot);
            let key = format!("result:{}", ballot.id);
            let closes = bd.i("closes_at");
            if ballot.speaks_for.as_deref() != Some(me.as_str()) || bd.s("electorate") != Some("council") || (bd.get("closed") != Some(&Value::Bool(true)) && t < closes.unwrap_or(i64::MAX)) {
                continue;
            }
            if councillors.is_empty() || self.guard.has(&key) || self.declared(&me, &ballot.id).is_some() {
                continue;
            }
            let closes = closes.unwrap_or(i64::MAX);
            // The latest vote of each post cast while the ballot was open.
            let mut latest: BTreeMap<String, (i64, String)> = BTreeMap::new();
            for r in self.book.of_type("vote") {
                if let (RecordBody::Vote { ballot: b, choice }, Some(pos)) = (&r.body, &r.position) {
                    if *b == ballot.id && councillors.contains(pos.as_str()) && r.at < closes && latest.get(pos.as_str()).is_none_or(|(at, _)| r.at >= *at) {
                        latest.insert(pos.to_string(), (r.at, choice.clone()));
                    }
                }
            }
            let voted_for: Vec<String> = latest.iter().filter(|(_, c)| c.1 == "yes").map(|(w, _)| w.clone()).collect();
            let voted_against: Vec<String> = latest.iter().filter(|(_, c)| c.1 == "no").map(|(w, _)| w.clone()).collect();
            let (yes, no) = (voted_for.len(), voted_against.len());
            let not_voting: Vec<String> = councillors.iter().filter(|c| !voted_for.contains(c) && !voted_against.contains(c)).cloned().collect();
            let passed = yes > no && yes * 2 > councillors.len();
            let prop = bd.s("proposal").and_then(|p| self.book.get(p)).cloned();
            let am = amendment(&self.book, &me, prop.as_ref());
            let enact = if am.is_some() { None } else { prop.as_ref().and_then(|p| data(p).get("enact").and_then(|e| e.s("kind").map(|k| (s(k), e.s("text").map(s).unwrap_or_default(), e.clone())))).or_else(|| from_form(prop.as_ref(), t)) };
            let mut note = String::new();
            if passed {
                if let Some(am) = &am {
                    note = if part == Part::Seat {
                        format!(" {} is to be amended: {}. The office's drafters write the amended law out and publish it in place of the law in force.", cap(&am.s.title), changes(am, false))
                    } else {
                        enact_amendment(am, &ballot.id, &self.book).1
                    };
                } else if let Some((kind, _, e)) = &enact {
                    if kind == "law" && e.get("formal").and_then(|f| f.get("condition")).is_none() && e.get("formal").is_none_or(Value::is_null) {
                        note = format!(" {WORDS_ONLY}{}", amendable(&self.book, &me, false));
                    }
                }
            }
            let words = format!("{}: {yes} for, {no} against.{note} {}", if passed { "Passed" } else { "Rejected" }, voted_words(&voted_for, &voted_against, &not_voting));
            self.guard.put(&key, t);
            steps.push(key_step(
                &key,
                format!("The ballot closed: counting the councillors' latest votes ({}).", if passed { "a majority for" } else { "no majority for" }),
                vec![say("ballot_result", &words, Say { basis: Some(ballot.id.to_string()), data: Some(json!({ "ballot": ballot.id, "yes": yes, "no": no, "passed": passed, "voted_for": voted_for, "voted_against": voted_against })), ..Default::default() })],
                false,
            ));
        }
        // What a passed, declared ballot enacts, published from the result on file (PB-12): a law in free words or a
        // budget by the clerk; an amendment by the clerk too unless the drafters (staff) have it.
        let results: Vec<Arc<Record>> = self.book.open("ballot_result").filter(|r| r.speaks_for.as_deref() == Some(me.as_str())).cloned().collect();
        for r in results {
            let Some(ballot_id) = data(&r).s("ballot").map(s) else { continue };
            let key = format!("enact:{ballot_id}");
            if data(&r).get("passed") != Some(&Value::Bool(true)) || self.guard.has(&key) || self.enacted(&me, &ballot_id) {
                continue;
            }
            let Some(ballot) = self.book.get(&ballot_id).cloned() else { continue };
            let prop = data(&ballot).s("proposal").and_then(|p| self.book.get(p)).cloned();
            let calls = if let Some(am) = amendment(&self.book, &me, prop.as_ref()) {
                if part == Part::Seat {
                    continue;
                }
                enact_amendment(&am, &ballot_id, &self.book).0
            } else {
                let enact = prop.as_ref().and_then(|p| data(p).get("enact").cloned().filter(|e| e.s("kind").is_some())).or_else(|| from_form(prop.as_ref(), t).map(|(k, w, d)| json!({ "kind": k, "text": w, "data": d })));
                let Some(e) = enact else { continue };
                let mut extra: Vec<(&'static str, Value)> = vec![];
                if let Some(a) = e.get("adico").filter(|x| !x.is_null()) {
                    extra.push(("adico", a.clone()));
                }
                if let Some(c) = e.get("formal").and_then(|f| f.s("condition")) {
                    extra.push(("formal", json!(c)));
                }
                vec![say(e.s("kind").unwrap_or("law"), e.s("text").unwrap_or(""), Say { basis: Some(ballot_id.clone()), data: e.get("data").filter(|d| !d.is_null()).cloned(), extra, ..Default::default() })]
            };
            if calls.is_empty() {
                continue;
            }
            self.guard.put(&key, t);
            steps.push(key_step(&key, format!("The council passed {ballot_id} and the result is declared ({}): publishing what it enacts.", r.id), calls, false));
        }
        // Votes that do not count, each answered once.
        if !councillors.is_empty() {
            let window = (self.p.vote_days + 2) * DAY;
            self.examined.retain(|_, at| t - *at <= window);
            let votes: Vec<Arc<Record>> = self.book.of_type("vote").filter(|v| t - v.at <= window).cloned().collect();
            for v in votes {
                if self.examined.contains_key(v.id.as_str()) {
                    continue;
                }
                self.examined.insert(v.id.to_string(), v.at);
                let RecordBody::Vote { ballot, .. } = &v.body else { continue };
                if v.author == oikos_contracts::blocks::GENESIS || v.author == self.participant {
                    continue;
                }
                let Some(b) = self.book.get(ballot).cloned() else { continue };
                let bd = data(&b);
                if !is_kind(&b, "ballot") || b.speaks_for.as_deref() != Some(me.as_str()) || bd.s("electorate") != Some("council") {
                    continue;
                }
                let result = self.declared(&me, &b.id).cloned();
                let late = bd.get("closed") == Some(&Value::Bool(true)) || v.at >= bd.i("closes_at").unwrap_or(i64::MAX) || result.as_ref().is_some_and(|r| r.at <= v.at);
                let member = v.position.as_ref().is_some_and(|p| councillors.contains(p.as_str()));
                if !late && member {
                    continue;
                }
                let declared = result.as_ref().map_or(String::new(), |r| format!(" Its result is declared ({}: {}, {} for, {} against).", r.id, if data(r).flag("passed") { "passed" } else { "rejected" }, data(r).i("yes").unwrap_or(0), data(r).i("no").unwrap_or(0)));
                let (why, words) = if late {
                    (
                        format!("A vote on {}, which is closed: not counted, and saying so.", b.id),
                        format!(
                            "From the council clerk: your vote on {} is not counted. {}{declared} A vote counts only when it is cast in a councillor's post while the ballot is open.",
                            b.id,
                            if bd.get("closed") == Some(&Value::Bool(true)) { "That ballot was held and closed before the year began.".to_string() } else { format!("That ballot closed on {}.", crate::common::when_words(bd.i("closes_at").unwrap_or(0), &cx.ctx.world)) }
                        ),
                    )
                } else {
                    (format!("A vote on {} by someone who is not a councillor: not counted, and saying so.", b.id), format!("From the council clerk: your vote on {} is not counted. The council's ballots are voted on by its councillors, each in their own post.", b.id))
                };
                steps.push(because(why, vec![message(&[v.author.clone()], &words, Some(&v.id))]));
            }
        }
        // Letters: the standing report.
        if !self.letters.is_empty() {
            let waiting: Vec<&Arc<Record>> = self.book.open("proposal").filter(|x| addressed_to(x).iter().any(|x| x == &me.to_string()) && !self.book.open("ballot").any(|b| b.speaks_for.as_deref() == Some(me.as_str()) && data(b).s("proposal") == Some(x.id.as_str()))).collect();
            let open: Vec<&Arc<Record>> = self.book.open("ballot").filter(|b| b.speaks_for.as_deref() == Some(me.as_str()) && data(b).s("electorate") == Some("council") && self.declared(&me, &b.id).is_none()).collect();
            let all: Vec<&Arc<Record>> = self.book.open("ballot_result").collect();
            let results = &all[all.len().saturating_sub(3)..];
            let year = t.div_euclid(YEAR) + 1;
            let (budget, next) = (budget_for(&self.book, year), budget_for(&self.book, year + 1));
            let w = &cx.ctx.world;
            let report = format!(
                "Report from the council clerk: {}{}{}{}Year {year} is {}; {}Anyone may put a proposal to the council on the council proposal form (form-council-proposal); I put it to a ballot of the councillors, open for {} days. A vote counts when it is cast in a councillor's post while the ballot is open; the result names who voted which way. A law proposed on that form stands as its words: no rule is set down with it for acts to be checked against.{}",
                if open.is_empty() { "no ballots are open. ".to_string() } else { format!("ballots open: {}. ", open.iter().map(|b| format!("{} on {}, closing {}", b.id, data(b).s("proposal").unwrap_or(""), crate::common::when_words(data(b).i("closes_at").unwrap_or(0), w))).collect::<Vec<_>>().join("; ")) },
                if waiting.is_empty() { String::new() } else { format!("Proposals waiting for a ballot: {}. ", waiting.iter().map(|x| x.id.as_str()).collect::<Vec<_>>().join(", ")) },
                if results.is_empty() {
                    String::new()
                } else {
                    format!(
                        "Recent results (each ballot is closed): {}. ",
                        results
                            .iter()
                            .map(|r| {
                                let d = data(r);
                                let names = |k: &str| { let v = d.ids(k); if v.is_empty() { "none".to_string() } else { v.join(", ") } };
                                format!("{}: {} {}-{}{}", d.s("ballot").unwrap_or(""), if d.flag("passed") { "passed" } else { "rejected" }, d.i("yes").unwrap_or(0), d.i("no").unwrap_or(0), if d.get("voted_for").is_some_and(Value::is_array) { format!(" (for: {}; against: {})", names("voted_for"), names("voted_against")) } else { String::new() })
                            })
                            .collect::<Vec<_>>()
                            .join("; ")
                    )
                },
                match budget { Some(b) => format!("The council adopted a budget for year {year} ({}). ", b.id), None => format!("No budget is adopted for year {year}. ") },
                year_in_days(year),
                match next { Some(b) => format!("the council has adopted a budget for year {} ({}). ", year + 1, b.id), None => format!("no budget is adopted yet for year {}, which the council adopts before it begins. ", year + 1) },
                self.p.vote_days,
                amendable(&self.book, &me, true)
            );
            let a = clerk_answers();
            steps.extend(self.letters.answer(Some(&a), "A letter to our office: answering with our standard report.", |_| report.clone()));
        }
        steps
    }

    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        if self.p.who.is_empty() || self.part == Part::Staff || self.members_asked.is_some_and(|a| pic.t - a < self.p.members_every_days * DAY) {
            return vec![];
        }
        self.members_asked = Some(pic.t);
        vec![look_up::holders(&self.p.who, &pic.entity, &self.p.members_role)]
    }

    fn then(&mut self, token: &ClerkThen, done: Done, _cx: &mut Cx) -> Vec<Step<ClerkThen>> {
        self.guard.heard(&token.key, done);
        if token.enacted && !done.applied() {
            self.routines.undid("enact", 1);
        }
        vec![]
    }
}

// ====================================================================== city.councillor

fn d_leaning() -> i64 {
    0
}
fn d_noise() -> i64 {
    1500
}
fn d_budget_yes() -> i64 {
    9000
}
fn d_deference() -> i64 {
    40
}
fn d_colleague() -> i64 {
    15
}
fn d_inertia() -> i64 {
    5
}

/// A motion this councillor moves of their own (content of a town or a scenario; nothing here holds one).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Motion {
    pub proposal: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub affects: Option<String>,
    #[serde(default)]
    pub on_day: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CouncillorParams {
    /// -100 = pro-development ... +100 = pro-tenant: the councillor's ideal point.
    pub leaning: i64,
    /// The width of the idiosyncratic taste shock, in basis points of the axis (1500: up to 15 points either way).
    pub noise_bps: i64,
    /// Disposition to budgets (a value for the tag `budget`): `(bps - 5000) / 100` points.
    pub budget_yes_bps: i64,
    pub motion: Option<Motion>,
    /// Points added for a proposal put by the mayor or an officer (an executive post).
    pub deference: i64,
    /// Points added for a fellow councillor's proposal.
    pub colleague_deference: i64,
    /// Points against any change from the status quo.
    pub inertia: i64,
    /// The councillor's own values: points for a proposal bearing a tag (negative: against).
    pub values: BTreeMap<String, i64>,
    /// The role of a council member's post, to tell a colleague's proposal from an officer's.
    pub role: String,
}
impl Default for CouncillorParams {
    fn default() -> Self {
        CouncillorParams { leaning: d_leaning(), noise_bps: d_noise(), budget_yes_bps: d_budget_yes(), motion: None, deference: d_deference(), colleague_deference: d_colleague(), inertia: d_inertia(), values: BTreeMap::new(), role: d_members_role() }
    }
}

pub struct Councillor;

fn councillor_answers() -> Answers {
    Answers {
        office: "a councillor".into(),
        acts: "A councillor acts by voting on the council's open ballots, and a letter does not change a vote. What you want the council to decide goes to the council clerk on the council proposal form (council_proposal).".into(),
        forms: vec![],
        report: true,
    }
}

impl Kind for Councillor {
    fn name(&self) -> &'static str {
        "city.councillor"
    }
    fn version(&self) -> &'static str {
        "0.6.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/government.md"
    }
    fn manifest(&self) -> Value {
        let a = councillor_answers();
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "budget_yes_bps": param(int(), json!(9000), Some("bps")),
                "colleague_deference": param(json!({ "type": "integer", "description": "points added for a fellow councillor's proposal (Matthews 1960, reciprocity; to confirm)" }), json!(15), None),
                "deference": param(json!({ "type": "integer", "description": "points added for a proposal put by the mayor or an officer (Kingdon 1973 cue-taking; Krehbiel 1991; to confirm)" }), json!(40), None),
                "inertia": param(json!({ "type": "integer", "description": "points against any change from the status quo (Samuelson & Zeckhauser 1988)" }), json!(5), None),
                "leaning": param(int(), json!(0), None),
                "motion": { "schema": {}, "source": "the world gives it (no default)" },
                "noise_bps": param(int(), json!(1500), Some("bps")),
                "role": param(string(), json!("councillor"), None),
                "values": param(json!({ "type": "object", "description": "the councillor's own values: points for a proposal bearing a tag" }), json!({}), None),
            },
            "perceives": [], "state": "none",
            "answers": { "office": a.office, "acts": a.acts, "report": true },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        3 * DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p: CouncillorParams = parse(ctx)?;
        Ok(Box::new(Stepper::new(Member { p, position: ctx.position.clone(), participant: ctx.participant.clone(), book: Book::new(), letters: Letters::default(), guard: Guard::default(), cast: vec![] })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Member>::restore(saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct Member {
    p: CouncillorParams,
    position: Option<String>,
    participant: String,
    book: Book,
    letters: Letters,
    guard: Guard,
    /// Votes cast and applied, until they are on the file: (ballot, choice).
    cast: Vec<(String, String)>,
}

/// Who put a proposal, as a councillor weighs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Proposer {
    Executive,
    Colleague,
    Resident,
    Unknown,
}

/// A councillor's reckoning of a ballot, in points: every cause, for the reason it gives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reckoning {
    pub axis: i64,
    pub place: i64,
    pub values: i64,
    pub deference: i64,
    pub inertia: i64,
    pub shock: i64,
    pub budget: i64,
}
impl Reckoning {
    pub fn total(&self) -> i64 {
        self.axis + self.values + self.budget + self.deference - self.inertia + self.shock
    }
}

impl Member {
    fn ours(&self, r: &Record) -> bool {
        match &self.position {
            Some(p) => r.position.as_deref() == Some(p.as_str()),
            None => r.author == self.participant,
        }
    }
    fn on_file(&self, ballot: &str) -> Option<String> {
        self.book.of_type("vote").filter(|v| self.ours(v)).fold(None, |a, v| match &v.body {
            RecordBody::Vote { ballot: b, choice } if b == ballot => Some(choice.clone()),
            _ => a,
        })
    }
    fn proposer(&self, ballot: &Record) -> Proposer {
        let bd = data(ballot);
        let prop = bd.s("proposal").and_then(|p| self.book.get(p));
        let pos: Option<String> = match prop {
            Some(p) => {
                if p.position.is_none() {
                    return Proposer::Resident;
                }
                p.position.map(|x| x.to_string())
            }
            None => match bd.s("proposed_in") {
                Some(x) => Some(x.to_string()),
                None => return Proposer::Unknown,
            },
        };
        let pos = pos.unwrap_or_default();
        if self.position.as_deref() == Some(pos.as_str()) || self.book.position(&pos).and_then(|x| x.role.as_deref()) == Some(self.p.role.as_str()) {
            Proposer::Colleague
        } else {
            Proposer::Executive
        }
    }
    /// How the councillor weighs a ballot: the causes of its vote (PB-14), the shock drawn from its own stream.
    pub fn reckon(p: &CouncillorParams, tags: &[String], who: Proposer, shock: i64) -> Reckoning {
        let place = (if tags.iter().any(|x| x == "tenant_protection") { 60 } else { 0 }) - (if tags.iter().any(|x| x == "development") { 60 } else { 0 });
        let axis = p.leaning.abs() - (p.leaning - place).abs();
        let values = tags.iter().map(|t| p.values.get(t).copied().unwrap_or(0)).sum();
        let budget = if tags.iter().any(|x| x == "budget") { (p.budget_yes_bps - 5000 + 50).div_euclid(100) } else { 0 };
        let deference = match who {
            Proposer::Executive => p.deference,
            Proposer::Colleague => p.colleague_deference,
            _ => 0,
        };
        Reckoning { axis, place, values, deference, inertia: p.inertia, shock, budget }
    }
}

impl Plan for Member {
    type Then = Sent;

    fn absorb(&mut self, pic: &Picture, _cx: &mut Cx) {
        self.book.absorb(pic);
        self.letters.take(pic, &self.book);
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Sent>> {
        let t = pic.t;
        let mut steps = vec![];
        // Their own motion, once (on file: a proposal of this post with the same words), on the council proposal form.
        if let Some(m) = self.p.motion.clone() {
            let moved = self.book.all("proposal").any(|x| self.ours(x) && data(x).s("proposal") == Some(m.proposal.as_str())) || self.guard.has("motion");
            if !moved && t >= m.on_day.unwrap_or(0) * DAY {
                if let Some(f) = self.book.open("form").find(|f| f.speaks_for.as_deref() == Some(pic.entity.as_str()) && data(f).s("form") == Some("council_proposal")) {
                    let _ = f;
                    self.guard.put("motion", t);
                    steps.push(sent_step(
                        "motion",
                        "A motion of our own: putting it to the council on the council proposal form.",
                        vec![call(
                            "form",
                            vec![
                                ("to", Some(arg(&pic.entity))),
                                ("form", Some(arg("council_proposal"))),
                                ("proposal", Some(text(m.proposal.clone()))),
                                ("kind", Some(arg(m.kind.as_deref().unwrap_or("other")))),
                                ("affects", m.affects.as_deref().map(arg)),
                            ],
                        )],
                    ));
                }
            }
        }
        let ballots: Vec<Arc<Record>> = self.book.open("ballot").cloned().collect();
        for b in ballots {
            let bd = data(&b);
            let key = format!("vote:{}", b.id);
            if bd.s("electorate") != Some("council") || bd.get("closed") == Some(&Value::Bool(true)) || t >= bd.i("closes_at").unwrap_or(0) || self.guard.has(&key) || self.on_file(&b.id).is_some() {
                continue;
            }
            if self.book.open("ballot_result").any(|r| data(r).s("ballot") == Some(b.id.as_str())) {
                continue;
            }
            let tags: Vec<String> = bd.get("tags").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(s)).collect()).unwrap_or_default();
            let width = self.p.noise_bps / 100;
            let shock = if width > 0 { cx.rng(&format!("vote-{}", b.id)).below(2 * width as u64 + 1) as i64 - width } else { 0 };
            let who = self.proposer(&b);
            let r = Member::reckon(&self.p, &tags, who, shock);
            let yes = r.total() > 0;
            self.guard.put(&key, t);
            let mut parts = vec![format!("our leaning ({}) against the proposal's place on the tenants-development axis ({}): {} points", self.p.leaning, r.place, r.axis)];
            if r.budget != 0 {
                parts.push(format!("our disposition to budgets {} points", r.budget));
            }
            if r.values != 0 {
                parts.push(format!("our own values {} points", r.values));
            }
            if r.deference != 0 {
                parts.push(format!("deference to {} {} points", if who == Proposer::Executive { "the office that proposed it" } else { "a colleague who proposed it" }, r.deference));
            }
            parts.push(format!("against change {} points", -r.inertia));
            if r.shock != 0 {
                parts.push(format!("the day's judgement {} points", r.shock));
            }
            let why = format!("Voting {}: {} (in all {}).", if yes { "yes" } else { "no" }, parts.join(", "), r.total());
            let ch = if yes { "yes" } else { "no" };
            let mut st = sent_step(&format!("vote:{}:{ch}", b.id), why, vec![vote(&b.id, ch, None)]);
            st.then = Some(Sent(format!("vote:{}:{ch}", b.id)));
            steps.push(st);
        }
        // A letter gets the voting record; it does not change a vote.
        if !self.letters.is_empty() {
            let mut rec: Vec<(String, String)> = vec![];
            for v in self.book.of_type("vote").filter(|v| self.ours(v)) {
                if let RecordBody::Vote { ballot, choice } = &v.body {
                    match rec.iter_mut().find(|x| x.0 == *ballot) {
                        Some(x) => x.1 = choice.clone(),
                        None => rec.push((ballot.to_string(), choice.clone())),
                    }
                }
            }
            for c in &self.cast {
                if !rec.iter().any(|x| x.0 == c.0) {
                    rec.push(c.clone());
                }
            }
            let words = format!("Report from a councillor: my votes on the council's ballots: {}.", if rec.is_empty() { "none yet".to_string() } else { rec.iter().map(|x| format!("{}: {}", x.0, x.1)).collect::<Vec<_>>().join(", ") });
            let a = councillor_answers();
            let pending = self.letters.answer(Some(&a), "A letter to a councillor: answering with our voting record.", |_| words.clone());
            steps.extend(pending);
        }
        steps
    }

    fn then(&mut self, token: &Sent, done: Done, _cx: &mut Cx) -> Vec<Step<Sent>> {
        // (The ballot's guard key is `vote:<ballot>`; the token carries the choice after it.)
        let mut parts = token.0.rsplitn(2, ':');
        let (choice, rest) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        if let Some(ballot) = rest.strip_prefix("vote:") {
            if done.applied() {
                self.cast.push((ballot.to_string(), choice.to_string()));
            } else {
                self.guard.sent.remove(&format!("vote:{ballot}"));
            }
        } else {
            self.guard.heard(&token.0, done);
        }
        vec![]
    }
}

// ====================================================================== tests

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Draws, WorldInfo};

    const DAYS: i64 = DAY;

    fn rec(v: Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).expect("a record"))
    }
    fn stmt(id: &str, at: i64, kind: &str, speaks_for: &str, x: Value) -> Arc<Record> {
        let mut v = json!({ "id": id, "at": at, "record": "statement", "author": "genesis", "speaks_for": speaks_for, "visible_to": "public", "kind": kind, "text": id });
        for (k, y) in x.as_object().unwrap() {
            v[k] = y.clone();
        }
        rec(v)
    }
    fn ctx(participant: &str, params: Value, position: Option<&str>) -> Ctx {
        Ctx { participant: participant.into(), performer: Default::default(), entity: "city".into(), position: position.map(String::from), params: params.as_object().cloned().unwrap_or_default().into(), world: Arc::new(WorldInfo::default()) }
    }
    const SEATS: [&str; 5] = ["councillor-1", "councillor-2", "councillor-3", "councillor-4", "councillor-5"];

    /// A picture at `t` showing these records, with the council's posts in the directory.
    fn pic(t: i64, records: Vec<Arc<Record>>, inbox: Vec<Value>) -> Picture {
        let mut positions: Vec<Value> = SEATS.iter().map(|p| json!({ "position": p, "entity": "city", "role": "councillor" })).collect();
        positions.push(json!({ "position": "mayor", "entity": "city", "role": "mayor" }));
        positions.push(json!({ "position": "councillor-9", "entity": "other-town", "role": "councillor" }));
        let obs: oikos_sight::Observation = serde_json::from_value(json!({
            "participant": "x", "t": t, "status": "active", "outcomes": [], "inbox": inbox, "drafts": [],
            "channels": { "business": { "kind": "records", "records": records }, "who": { "kind": "directory", "entities": [], "positions": positions } },
        }))
        .unwrap();
        let mut view = oikos_sight::View::default();
        view.apply(obs, None, "city", "cadence", DAYS)
    }

    /// One wake: the calls it makes (as text) and why.
    struct Run {
        actor: Box<dyn Actor>,
        c: Ctx,
        draws: Draws,
    }
    impl Run {
        fn new(kind: &dyn Kind, c: Ctx) -> Run {
            let actor = kind.create(&c).unwrap();
            Run { actor, draws: Draws::new(&c.participant, "x"), c }
        }
        fn wake(&mut self, p: &Picture) -> Vec<(String, String)> {
            let mut out = vec![];
            for i in 0..50 {
                let mut cx = Cx::new(p.t, &self.c, &mut self.draws, 1, vec![]);
                let a = self.actor.step(p, &mut cx);
                match a {
                    crate::Action::Call { program, reasoning } => {
                        out.push((oikos_sight::calls::program_text(&program), reasoning.unwrap_or_default()));
                        self.actor.sent(&format!("act.{i}"));
                        // (Outcomes are not shown: the next step of the same moment carries on.)
                        let mut next = p.clone();
                        next.woke_for = "done".into();
                        next.channels = Default::default();
                        next.inbox = vec![];
                        next.outcomes = vec![oikos_sight::Outcome { action: format!("act.{i}"), t: p.t, status: oikos_sight::OutcomeStatus::Applied, created: None, refusal: None, investigated: None, surveyed: None, seen: vec![] }];
                        return_more(self, &next, &mut out, i + 1);
                        break;
                    }
                    _ => break,
                }
            }
            out
        }
    }
    fn return_more(r: &mut Run, p: &Picture, out: &mut Vec<(String, String)>, from: usize) {
        for i in from..50 {
            let mut cx = Cx::new(p.t, &r.c, &mut r.draws, 1, vec![]);
            match r.actor.step(p, &mut cx) {
                crate::Action::Call { program, reasoning } => {
                    out.push((oikos_sight::calls::program_text(&program), reasoning.unwrap_or_default()));
                    r.actor.sent(&format!("act.{i}"));
                }
                _ => break,
            }
        }
    }
    fn calls(v: &[(String, String)]) -> String {
        v.iter().map(|x| x.0.clone()).collect::<Vec<_>>().join("\n")
    }
    fn lines(text: &str, kind: &str) -> Vec<String> {
        text.lines().filter(|l| l.contains(&format!("kind={kind}"))).map(String::from).collect()
    }
    fn ballot(id: &str, at: i64, tags: &[&str], extra: Value) -> Arc<Record> {
        let mut d = json!({ "proposal": format!("p-{id}"), "options": ["yes", "no"], "closes_at": at + 14 * DAYS, "electorate": "council", "tags": tags });
        for (k, y) in extra.as_object().unwrap() {
            d[k] = y.clone();
        }
        stmt(id, at, "ballot", "city", json!({ "author": "clerk", "data": d }))
    }
    fn cast(id: &str, of: &str, at: i64, seat: &str, choice: &str) -> Arc<Record> {
        rec(json!({ "id": id, "at": at, "record": "vote", "author": format!("{seat}-system"), "in_position": seat, "speaks_for": "city", "visible_to": "public", "ballot": of, "choice": choice }))
    }
    fn proposal(id: &str, at: i64, x: Value) -> Arc<Record> {
        let mut v = json!({ "addressed_to": ["city"], "author": "c1-self", "speaks_for": "c1" });
        for (k, y) in x.as_object().unwrap() {
            v[k] = y.clone();
        }
        stmt(id, at, "proposal", "c1", v)
    }

    // ---- manifests

    fn manifest_is_the_ts(name: &str) {
        let ts: Value = crate::offices::testing::ts_manifest(name);
        let rust = crate::registry::find(name).unwrap().manifest();
        for (k, v) in ts.as_object().unwrap() {
            if k == "params" {
                // (Parameters this port adds, documented in the module, may be beyond the TS manifest's.)
                for (pk, pv) in v.as_object().unwrap() {
                    assert_eq!(&rust["params"][pk], pv, "{name}: param {pk}");
                }
            } else {
                assert_eq!(&rust[k], v, "{name}: {k}");
            }
        }
    }
    #[test]
    fn the_manifests_are_the_ones_the_ts_modules_wrote() {
        for n in ["city.mayor_code", "city.council_clerk", "city.councillor"] {
            manifest_is_the_ts(n);
        }
    }

    // ---- city.councillor

    fn vote_of(leaning: i64, tags: &[&str], params: Value, extra: Value) -> (String, String) {
        let mut p = json!({ "leaning": leaning, "noise_bps": 0 });
        for (k, y) in params.as_object().unwrap() {
            p[k] = y.clone();
        }
        let mut r = Run::new(&Councillor, ctx("councillor-1-system", p, Some("councillor-1")));
        let out = r.wake(&pic(DAYS, vec![ballot("b1", DAYS, tags, extra)], vec![]));
        assert_eq!(out.len(), 1, "{out:?}");
        let choice = if out[0].0.contains("choice=yes") { "yes" } else { "no" };
        (choice.into(), out[0].1.clone())
    }

    #[test]
    fn a_councillor_weighs_the_axis_and_a_tie_is_no() {
        let tp = |l| vote_of(l, &["tenant_protection"], json!({}), json!({})).0;
        assert_eq!([-80, -40, 0, 40, 80].map(tp), ["no", "no", "no", "yes", "yes"]);
        let dv = |l| vote_of(l, &["development"], json!({}), json!({})).0;
        assert_eq!([-80, -40, 0, 40, 80].map(dv), ["yes", "yes", "no", "no", "no"]);
        assert_eq!(tp(30), "no");
        assert_eq!(tp(32), "no", "the axis gain must beat inertia");
        assert_eq!(tp(33), "yes");
        let v = vote_of(80, &["tenant_protection"], json!({}), json!({}));
        assert!(v.1.contains("our leaning (80)") && v.1.contains("(60)"), "{}", v.1);
    }

    #[test]
    fn a_proposal_off_the_axis_passes_on_deference_not_on_a_coin() {
        // A neutral, no-proposer proposal: inertia only, so no.
        for l in [-80, 0, 80] {
            assert_eq!(vote_of(l, &[], json!({}), json!({})).0, "no");
        }
        // The same proposal put by an office of the town (a post that is not a councillor's): everyone with no stake
        // defers, whatever the leaning (axis 0 off the axis).
        let by_office = json!({ "proposed_in": "mayor" });
        for l in [-80, 0, 80] {
            let v = vote_of(l, &[], json!({}), by_office.clone());
            assert_eq!(v.0, "yes", "{}", v.1);
        }
        // A fellow councillor's: a smaller weight, still enough against inertia.
        assert_eq!(vote_of(0, &[], json!({}), json!({ "proposed_in": "councillor-2" })).0, "yes");
        // Deference gives way to a strong stake: a pro-development councillor on a mayor's tenant-protection proposal.
        assert_eq!(vote_of(-80, &["tenant_protection"], json!({}), by_office.clone()).0, "no");
        // And the councillor's own values count: against, a budget from the mayor fails.
        assert_eq!(vote_of(0, &["budget"], json!({ "values": { "budget": -90 } }), by_office).0, "no");
    }

    #[test]
    fn budgets_follow_the_disposition_and_the_noise_is_a_shock_not_a_flip() {
        assert_eq!(vote_of(0, &["budget"], json!({ "budget_yes_bps": 10_000 }), json!({})).0, "yes");
        assert_eq!(vote_of(0, &["budget"], json!({ "budget_yes_bps": 0 }), json!({})).0, "no");
        // The shock is bounded: it cannot turn a 60-point conviction (noise 15 points) but can a near-tie.
        let mut yes = 0;
        for seed in 0..200 {
            let mut r = Run::new(&Councillor, ctx(&format!("c{seed}"), json!({ "leaning": 0, "noise_bps": 1500 }), Some(&format!("seat-{seed}"))));
            let out = r.wake(&pic(DAYS, vec![ballot("b1", DAYS, &[], json!({}))], vec![]));
            if out[0].0.contains("choice=yes") {
                yes += 1;
            }
        }
        assert!(yes < 100, "inertia leans against change: {yes}");
        let v = vote_of(80, &["tenant_protection"], json!({ "noise_bps": 1500 }), json!({}));
        assert_eq!(v.0, "yes", "a strong conviction is not flipped by taste");
    }

    #[test]
    fn a_councillor_votes_once_reads_its_own_vote_on_file_and_answers_a_letter() {
        let mut r = Run::new(&Councillor, ctx("councillor-1-system", json!({ "leaning": 80, "noise_bps": 0 }), Some("councillor-1")));
        let open = ballot("b1", DAYS, &["tenant_protection"], json!({}));
        let closed = ballot("b2", DAYS - 20 * DAYS, &["tenant_protection"], json!({}));
        let election = stmt("b3", DAYS, "ballot", "city", json!({ "data": { "electorate": "roll", "closes_at": 99 * DAYS } }));
        let out = r.wake(&pic(DAYS, vec![open.clone(), closed, election], vec![]));
        assert_eq!(calls(&out), "vote(ballot=b1, choice=yes)");
        // The vote is on file now (seen): not voted again, and a successor in the post reading the file does not vote.
        let mine = cast("v1", "b1", DAYS, "councillor-1", "yes");
        assert!(r.wake(&pic(4 * DAYS, vec![mine.clone()], vec![])).is_empty());
        let mut successor = Run::new(&Councillor, ctx("someone-else-self", json!({ "leaning": 80, "noise_bps": 0 }), Some("councillor-1")));
        assert!(successor.wake(&pic(4 * DAYS, vec![open, mine], vec![])).is_empty(), "reads its own vote from the file");
        let out = successor.wake(&pic(5 * DAYS, vec![], vec![json!({ "id": "m1", "t": 5 * DAYS, "from": "mayor-system", "to": ["x"], "text": "Please support b1." })]));
        assert!(calls(&out).contains("Report from a councillor: my votes on the council's ballots: b1: yes."), "{out:?}");
    }

    #[test]
    fn a_vote_not_applied_is_tried_again() {
        let c = ctx("councillor-1-system", json!({ "leaning": 80, "noise_bps": 0 }), Some("councillor-1"));
        let mut a = Councillor.create(&c).unwrap();
        let mut draws = Draws::new("councillor-1-system", "x");
        let p = pic(DAYS, vec![ballot("b1", DAYS, &["tenant_protection"], json!({}))], vec![]);
        let mut cx = Cx::new(p.t, &c, &mut draws, 1, vec![]);
        assert!(matches!(a.step(&p, &mut cx), crate::Action::Call { .. }));
        a.sent("act.1");
        let mut p2 = pic(2 * DAYS, vec![], vec![]);
        p2.outcomes = vec![oikos_sight::Outcome { action: "act.1".into(), t: 2 * DAYS, status: oikos_sight::OutcomeStatus::Refused, created: None, refusal: None, investigated: None, surveyed: None, seen: vec![] }];
        let mut cx = Cx::new(p2.t, &c, &mut draws, 1, vec![]);
        assert!(matches!(a.step(&p2, &mut cx), crate::Action::Call { .. }), "a refused vote is cast again");
    }

    // ---- city.council_clerk

    fn count(votes: Vec<Arc<Record>>, close_at: i64) -> (Run, String, String) {
        let mut clerk = Run::new(&CouncilClerk, ctx("clerk", json!({}), Some("council-clerk")));
        let p1 = proposal("p-b1", DAYS, json!({ "text": "Cap rent rises.", "data": { "enact": { "kind": "law", "text": "Rent rises are capped." }, "tags": ["tenant_protection"] } }));
        clerk.wake(&pic(DAYS, vec![p1.clone()], vec![]));
        let b = ballot("b1", DAYS, &["tenant_protection"], json!({}));
        let early = calls(&clerk.wake(&pic(2 * DAYS, vec![p1, b.clone()].into_iter().chain(votes).collect(), vec![])));
        assert!(early.lines().all(|l| l.starts_with("message(")), "{early}");
        assert!(clerk.wake(&pic(15 * DAYS - 1, vec![], vec![])).is_empty());
        let closed = calls(&clerk.wake(&pic(close_at, vec![], vec![])));
        (clerk, early, closed)
    }

    #[test]
    fn the_clerk_puts_a_proposal_to_a_ballot_naming_its_proposer() {
        let mut clerk = Run::new(&CouncilClerk, ctx("clerk", json!({ "vote_days": 10 }), Some("council-clerk")));
        let out = clerk.wake(&pic(
            3 * DAYS,
            vec![
                proposal("p1", 2 * DAYS, json!({ "text": "Cap rent rises.", "in_position": "mayor", "data": { "enact": { "kind": "law", "text": "Rent rises are capped." }, "tags": ["tenant_protection"] } })),
                proposal("p3", 2 * DAYS, json!({ "text": "council proposal", "data": { "proposal": "A budget.", "kind": "budget", "parks": "10000", "affects": "neither" } })),
                proposal("p4", 2 * DAYS, json!({ "text": "council proposal", "data": { "proposal": "Name the bridge.", "kind": "law", "affects": "neither" } })),
                proposal("p5", 2 * DAYS, json!({ "text": "To another town.", "addressed_to": ["other-town"], "data": { "enact": { "kind": "law", "text": "x" }, "tags": [] } })),
            ],
            vec![],
        ));
        let t = calls(&out);
        let b = lines(&t, "ballot");
        assert_eq!(b.len(), 3, "{t}");
        assert!(b[0].contains("\"proposed_in\":\"mayor\"") && b[0].contains("tenant_protection") && b[0].contains("Council ballot: Cap rent rises."), "{}", b[0]);
        assert!(b[1].contains("\"budget\"") && b[2].contains("\"tags\":[]"));
        assert!(clerk.wake(&pic(4 * DAYS, vec![], vec![])).is_empty(), "once each");
    }

    #[test]
    fn at_the_close_the_clerk_counts_each_seats_latest_vote_and_publishes_only_from_the_result_on_file() {
        let (mut clerk, early, closed) = count(
            vec![
                cast("v1", "b1", 2 * DAYS, "councillor-1", "yes"),
                cast("v2", "b1", 2 * DAYS, "councillor-2", "yes"),
                cast("v3", "b1", 2 * DAYS, "councillor-3", "no"),
                cast("v4", "b1", 2 * DAYS, "councillor-4", "no"),
                cast("v5", "b1", 3 * DAYS, "councillor-4", "yes"),
                cast("v6", "b1", 2 * DAYS, "mayor", "no"),
                cast("v7", "b1", 2 * DAYS, "councillor-9", "no"),
                cast("v9", "b0", 2 * DAYS, "councillor-5", "no"),
            ],
            15 * DAYS,
        );
        assert_eq!(early.lines().count(), 2, "the mayor and another town's councillor are told: {early}");
        let res = lines(&closed, "ballot_result");
        assert_eq!(res.len(), 1, "{closed}");
        assert!(res[0].contains("Passed: 3 for, 1 against.") && res[0].contains("Voting for: councillor-1, councillor-2, councillor-4; against: councillor-3; not voting: councillor-5."), "{}", res[0]);
        // PB-12: the law is not in the same step as the count; it follows from the result once that is on file.
        assert!(lines(&closed, "law").is_empty(), "{closed}");
        let result = stmt("res-b1", 15 * DAYS, "ballot_result", "city", json!({ "author": "clerk", "basis": "b1", "data": { "ballot": "b1", "yes": 3, "no": 1, "passed": true } }));
        let out = calls(&clerk.wake(&pic(16 * DAYS, vec![result], vec![])));
        let law = lines(&out, "law");
        assert_eq!(law.len(), 1, "{out}");
        assert!(law[0].contains("Rent rises are capped.") && law[0].contains("basis=b1"), "{}", law[0]);
    }

    #[test]
    fn a_rejected_ballot_enacts_nothing_and_abstentions_count_against() {
        let votes = |c: [Option<&str>; 5]| c.iter().enumerate().filter_map(|(i, x)| x.map(|x| cast(&format!("v{i}"), "b1", 2 * DAYS, SEATS[i], x))).collect::<Vec<_>>();
        let (_, _, closed) = count(votes([Some("yes"), Some("yes"), None, None, None]), 15 * DAYS);
        let res = lines(&closed, "ballot_result");
        assert!(res[0].contains("Rejected: 2 for, 0 against. Voting for: councillor-1, councillor-2; against: none; not voting: councillor-3, councillor-4, councillor-5."), "{}", res[0]);
        let (_, _, closed) = count(votes([Some("yes"), Some("yes"), Some("abstain"), Some("no"), None]), 15 * DAYS);
        assert!(lines(&closed, "ballot_result")[0].contains("Rejected: 2 for, 1 against."));
        let (_, _, closed) = count(votes([Some("yes"), Some("yes"), Some("yes"), None, None]), 15 * DAYS);
        assert!(lines(&closed, "ballot_result")[0].contains("Passed: 3 for, 0 against."));
    }

    #[test]
    fn a_vote_at_or_after_the_closing_time_is_not_counted_however_late_the_count() {
        let (_, _, closed) = count(
            vec![cast("v1", "b1", 2 * DAYS, "councillor-1", "yes"), cast("v2", "b1", 15 * DAYS - 1, "councillor-2", "yes"), cast("v3", "b1", 15 * DAYS, "councillor-3", "yes"), cast("v4", "b1", 15 * DAYS + 60, "councillor-4", "yes")],
            15 * DAYS + 3600,
        );
        assert!(lines(&closed, "ballot_result")[0].contains("Rejected: 2 for, 0 against."));
    }

    #[test]
    fn a_ballot_already_declared_by_the_office_is_not_counted_again_by_whoever_takes_it() {
        let b = ballot("b1", DAYS, &[], json!({}));
        let done = stmt("res-b1", 15 * DAYS, "ballot_result", "city", json!({ "author": "clerk", "basis": "b1", "data": { "ballot": "b1", "yes": 0, "no": 0, "passed": false } }));
        let mut successor = Run::new(&CouncilClerk, ctx("new-clerk-self", json!({}), Some("council-clerk")));
        assert!(successor.wake(&pic(16 * DAYS, vec![b, done], vec![])).is_empty());
    }

    #[test]
    fn a_vote_on_a_closed_ballot_is_not_counted_and_its_caster_told_once() {
        let opening = stmt("budget-year-1-ballot", 0, "ballot", "city", json!({ "in_position": "council-clerk", "data": { "proposal": "budget-year-1-proposal", "options": ["yes", "no"], "closes_at": 0, "closed": true, "result": "budget-year-1-result", "electorate": "council", "tags": ["budget"] } }));
        let declared = stmt("budget-year-1-result", 0, "ballot_result", "city", json!({ "in_position": "council-clerk", "basis": "budget-year-1-ballot", "data": { "ballot": "budget-year-1-ballot", "yes": 5, "no": 0, "passed": true } }));
        let mut clerk = Run::new(&CouncilClerk, ctx("clerk", json!({}), Some("council-clerk")));
        assert!(clerk.wake(&pic(0, vec![opening, declared], vec![])).is_empty());
        let out = clerk.wake(&pic(DAYS, vec![cast("v1", "budget-year-1-ballot", DAYS - 3600, "councillor-1", "YES")], vec![]));
        assert_eq!(out.len(), 1, "{out:?}");
        assert!(out[0].0.contains("That ballot was held and closed before the year began. Its result is declared (budget-year-1-result: passed, 5 for, 0 against)."), "{}", out[0].0);
        assert!(clerk.wake(&pic(2 * DAYS, vec![], vec![])).is_empty(), "told once");
        // A code councillor leaves it alone.
        let mut m = Run::new(&Councillor, ctx("councillor-2-system", json!({}), Some("councillor-2")));
        let b = stmt("budget-year-1-ballot", 0, "ballot", "city", json!({ "data": { "closes_at": 0, "closed": true, "electorate": "council", "tags": ["budget"] } }));
        assert!(m.wake(&pic(0, vec![b], vec![])).is_empty());
    }

    // ---- amendments (PB-12)

    fn law_world() -> Vec<Arc<Record>> {
        let schedule = stmt("sched-1", 0, "law_schedule", "city", json!({ "data": { "title": "notice of a rent increase", "form": "amend_notice", "figures": { "notice": { "type": "duration", "unit": "days", "label": "notice of an increase" } },
            "text": "A landlord must give {notice} notice of a rent increase.", "adico": { "attribute": "landlords", "deontic": "must", "aim": "give {notice} notice" } } }));
        let form = stmt("form-1", 0, "form", "city", json!({ "data": { "form": "amend_notice", "submit_as": "proposal", "amends": "sched-1", "fields": { "notice": { "type": "duration" } } } }));
        let law = stmt("law-1", 0, "law", "city", json!({ "data": { "schedule": "sched-1", "figures": { "notice": { "value": 60 * DAYS, "unit": "seconds" } } }, "text": "A landlord must give 60 days notice of a rent increase." }));
        vec![schedule, form, law]
    }

    #[test]
    fn a_passed_amendment_is_written_into_law_and_the_old_law_withdrawn_only_on_a_passed_declared_ballot() {
        let mut clerk = Run::new(&CouncilClerk, ctx("clerk", json!({}), Some("council-clerk")));
        let mut world = law_world();
        let prop = stmt("prop-1", DAYS, "proposal", "c1", json!({ "author": "c1-self", "addressed_to": ["city"], "basis": "form-1", "data": { "notice": 90 * DAYS, "affects": "tenants" } }));
        world.push(prop.clone());
        let out = calls(&clerk.wake(&pic(2 * DAYS, world.clone(), vec![])));
        assert!(lines(&out, "ballot")[0].contains("to amend notice of a rent increase (law-1): notice of an increase 90 days (now 60 days)"), "{out}");
        // A ballot that is rejected withdraws nothing.
        let b = ballot("b1", 2 * DAYS, &[], json!({ "proposal": "prop-1" }));
        let votes: Vec<_> = (0..2).map(|i| cast(&format!("v{i}"), "b1", 3 * DAYS, SEATS[i], "yes")).collect();
        let mut recs = vec![b.clone()];
        recs.extend(votes);
        clerk.wake(&pic(3 * DAYS, recs, vec![]));
        let closed = calls(&clerk.wake(&pic(17 * DAYS, vec![], vec![])));
        assert!(lines(&closed, "ballot_result")[0].contains("Rejected"), "{closed}");
        assert!(!closed.contains("withdraw"), "{closed}");
        // A passed, declared one: the law and its predecessor's withdrawal.
        let mut clerk = Run::new(&CouncilClerk, ctx("clerk", json!({}), Some("council-clerk")));
        let result = stmt("res-1", 17 * DAYS, "ballot_result", "city", json!({ "author": "clerk", "basis": "b1", "data": { "ballot": "b1", "yes": 4, "no": 0, "passed": true } }));
        let mut recs = world;
        recs.push(b);
        recs.push(result);
        let out = calls(&clerk.wake(&pic(18 * DAYS, recs, vec![])));
        assert!(out.contains("As amended by the council on ballot b1; this replaces law-1.") && out.contains("withdraw=law-1"), "{out}");
    }

    #[test]
    fn the_drafters_write_a_passed_amendment_under_the_standing_order() {
        let mut staff = Run::new(&CouncilClerk, ctx("drafter", json!({ "part": "staff" }), Some("council-clerk-staff")));
        let mut world = law_world();
        world.push(stmt("prop-1", DAYS, "proposal", "c1", json!({ "author": "c1-self", "basis": "form-1", "data": { "notice": 90 * DAYS } })));
        world.push(ballot("b1", 2 * DAYS, &[], json!({ "proposal": "prop-1" })));
        world.push(stmt("res-1", 17 * DAYS, "ballot_result", "city", json!({ "author": "clerk", "basis": "b1", "data": { "ballot": "b1", "yes": 4, "no": 0, "passed": true } })));
        let out = calls(&staff.wake(&pic(18 * DAYS, world.clone(), vec![])));
        assert!(!out.contains("withdraw="), "with no standing order the drafters do not write: {out}");
        world.push(stmt("order-1", 17 * DAYS, "work_order", "city", json!({ "data": { "work": { "task": "enact" }, "every": DAYS } })));
        let out = calls(&staff.wake(&pic(19 * DAYS, vec![world.pop().unwrap()], vec![])));
        assert!(out.contains("withdraw=law-1"), "{out}");
    }

    // ---- city.mayor_code

    fn mayor_params() -> Value {
        json!({ "builder": "builder", "population": 200, "responsiveness_bps": 10_000, "petition_threshold_bps": 1500, "park_budget": 0 })
    }
    fn petition(id: &str, at: i64) -> Arc<Record> {
        stmt(id, at, "petition", "c1", json!({ "author": "c1-self", "text": "Petition.", "data": { "demand": { "kind": "law", "text": "A landlord must give at least 90 days' notice.", "tags": ["tenant_protection"] } } }))
    }
    fn counted(id: &str, of: &str, at: i64, n: i64, who: &str) -> Arc<Record> {
        stmt(id, at, "petition_count", who, json!({ "author": format!("{who}-self"), "basis": of, "data": { "petition": of, "signatures": n } }))
    }
    fn answers(m: &mut Run, p: &Picture) -> Vec<String> {
        lines(&calls(&m.wake(p)), "proposal").into_iter().filter(|l| l.contains("from petition")).collect()
    }

    #[test]
    fn the_mayor_turns_a_petition_into_a_proposal_once_the_published_count_reaches_the_threshold() {
        let mut mayor = Run::new(&MayorCode, ctx("mayor-system", mayor_params(), Some("mayor")));
        assert!(answers(&mut mayor, &pic(DAYS, vec![petition("pet-1", 0), counted("n1", "pet-1", DAYS, 29, "c1")], vec![])).is_empty());
        assert!(answers(&mut mayor, &pic(2 * DAYS, vec![counted("n2", "pet-1", 2 * DAYS, 150, "c9")], vec![])).is_empty(), "not the organiser's count");
        let put = answers(&mut mayor, &pic(8 * DAYS, vec![counted("n3", "pet-1", 8 * DAYS, 30, "c1")], vec![]));
        assert_eq!(put.len(), 1);
        assert!(put[0].contains("Proposal (from petition pet-1): A landlord must give at least 90 days' notice.") && put[0].contains("basis=pet-1"), "{}", put[0]);
        assert!(answers(&mut mayor, &pic(15 * DAYS, vec![counted("n4", "pet-1", 15 * DAYS, 120, "c1")], vec![])).is_empty());
    }

    #[test]
    fn a_new_mayor_does_not_answer_a_petition_the_office_already_answered() {
        let seen = vec![petition("pet-1", 0), counted("n1", "pet-1", DAYS, 100, "c1")];
        let made = stmt("prop-1", DAYS, "proposal", "city", json!({ "author": "mayor-system", "in_position": "mayor", "basis": "pet-1", "addressed_to": ["city"], "data": { "enact": { "kind": "law", "text": "x" }, "tags": [] } }));
        let mut successor = Run::new(&MayorCode, ctx("c0042-self", mayor_params(), Some("mayor")));
        let mut recs = seen;
        recs.push(made);
        assert!(answers(&mut successor, &pic(30 * DAYS, recs, vec![])).is_empty());
        assert_eq!(answers(&mut successor, &pic(37 * DAYS, vec![petition("pet-2", 31 * DAYS), counted("n2", "pet-2", 37 * DAYS, 100, "c1")], vec![])).len(), 1);
    }

    fn town(extra: Vec<Arc<Record>>) -> Vec<Arc<Record>> {
        let register = stmt("assets-1", 0, "asset_register", "city", json!({ "data": { "assets": [
            { "lot": "lot-a", "cells": ["c.0.0"] }, { "lot": "lot-b", "cells": ["c.1.0"] }, { "lot": "lot-c", "cells": ["c.2.0"] },
            { "lot": "road-1", "cells": ["c.9.9"], "structure": "r1", "type": "road" } ] } }));
        let price = stmt("prices-1", 0, "price_list", "builder", json!({ "data": { "prices": { "park": 5_000, "road": 1_000 } } }));
        let budget = stmt("budget-1", 0, "budget", "city", json!({ "data": { "year": 1, "lines": { "parks": 20_000, "roads": 20_000 } } }));
        let title = |lot: &str, i: usize| rec(json!({ "id": format!("t{i}"), "record": "claim", "author": "genesis", "at": 0, "visible_to": "public", "position": "right", "holder": "city", "about": { "kind": "ownership", "object": lot } }));
        let mut v = vec![register, price, budget, title("lot-a", 1), title("lot-b", 2), title("lot-c", 3), title("road-1", 4)];
        v.extend(["lot-a", "lot-b", "lot-c", "road-1"].iter().map(|l| stmt(&format!("plan-{l}"), 0, "lot", "registry", json!({ "data": { "cells": [match *l { "lot-a" => "c.0.0", "lot-b" => "c.1.0", "lot-c" => "c.2.0", _ => "c.9.9" }] } }))));
        v.extend(extra);
        v
    }

    #[test]
    fn the_mayor_applies_for_a_park_and_when_the_builder_declines_offers_another_lot() {
        let mut m = Run::new(&MayorCode, ctx("mayor-system", json!({ "builder": "builder", "park_budget": 20_000 }), Some("mayor")));
        let out = calls(&m.wake(&pic(DAYS, town(vec![]), vec![])));
        assert!(out.contains("form(form=permit_application, lot=lot-a, structure_type=park, to=city)") || out.contains("lot=lot-a"), "{out}");
        // Its application is on file; granted; the mayor commissions the builder.
        let app = stmt("app-1", DAYS, "permit_application", "city", json!({ "author": "mayor-system", "in_position": "mayor", "data": { "lot": "lot-a", "structure_type": "park" } }));
        let dec = stmt("dec-1", 2 * DAYS, "permit_decision", "city", json!({ "author": "planning", "addressed_to": ["city"], "basis": "app-1", "data": { "application": "app-1", "decision": "granted" } }));
        let out = calls(&m.wake(&pic(8 * DAYS, vec![app, dec], vec![])));
        assert!(out.contains("structure(") && out.contains("on=lot-a") && out.contains("basis=dec-1"), "{out}");
        // The agreement is on file, the builder declines it: the mayor offers a park on another lot, the same year.
        let ag = rec(json!({ "id": "ag-1", "at": 8 * DAYS, "record": "agreement", "author": "mayor-system", "in_position": "mayor", "visible_to": ["city", "builder"], "basis": "dec-1", "terms": { "template": "sale", "parties": ["city", "builder"], "commitments": [] } }));
        let declined = stmt("dec-no", 9 * DAYS, "offer_declined", "builder", json!({ "author": "builder-self", "addressed_to": ["city"], "data": { "agreement": "ag-1", "reason": "site_taken" } }));
        let out = calls(&m.wake(&pic(15 * DAYS, vec![ag, declined], vec![])));
        assert!(out.contains("permit_application") && out.contains("lot=lot-b"), "{out}");
    }

    #[test]
    fn the_mayor_never_applies_for_the_same_road_site_twice() {
        // A building at c.20.0 far from the road at c.9.9: a road is wanted beside the network, on a free single-cell lot.
        let far = stmt("bn-1", 0, "building_notice", "builder", json!({ "addressed_to": ["city"], "data": { "structure": "h1", "at": "c.14.9", "structure_type": "house" } }));
        let mut m = Run::new(&MayorCode, ctx("mayor-system", json!({ "builder": "builder", "park_budget": 0, "road_budget": 20_000 }), Some("mayor")));
        let mut recs = town(vec![far]);
        recs.push(stmt("lot-d-asset", 0, "asset_register", "city", json!({ "data": { "assets": [{ "lot": "lot-d", "cells": ["c.10.9"] }, { "lot": "road-1", "cells": ["c.9.9"], "structure": "r1", "type": "road" }] } })));
        recs.push(rec(json!({ "id": "t9", "record": "claim", "author": "genesis", "at": 0, "visible_to": "public", "position": "right", "holder": "city", "about": { "kind": "ownership", "object": "lot-d" } })));
        recs.push(stmt("plan-lot-d", 0, "lot", "registry", json!({ "data": { "cells": ["c.10.9"] } })));
        let first = calls(&m.wake(&pic(DAYS, recs, vec![])));
        assert!(first.contains("lot=lot-d, structure_type=road"), "{first}");
        // Its application is on file and was refused; thirty-odd days on it is not applied for again.
        let app = stmt("app-r", DAYS, "permit_application", "city", json!({ "author": "mayor-system", "in_position": "mayor", "data": { "lot": "lot-d", "structure_type": "road" } }));
        let refused = stmt("dec-r", 2 * DAYS, "permit_decision", "city", json!({ "author": "planning", "addressed_to": ["city"], "basis": "app-r", "data": { "application": "app-r", "decision": "refused" } }));
        let again = calls(&m.wake(&pic(40 * DAYS, vec![app, refused], vec![])));
        assert!(!again.contains("lot=lot-d, structure_type=road"), "{again}");
    }

    #[test]
    fn the_mayor_tables_a_budget_once_per_window_reading_the_file() {
        let mut m = Run::new(&MayorCode, ctx("mayor-system", json!({ "builder": "builder", "park_budget": 100_000 }), Some("mayor")));
        let out = calls(&m.wake(&pic(DAYS, vec![], vec![])));
        assert_eq!(lines(&out, "proposal").len(), 1, "{out}");
        assert!(out.contains("The town's budget for year 1 (day 0 to day 364): parks"), "{out}");
        // A successor reads the proposal on file: not tabled again within 45 days, again after.
        let tabled = stmt("prop-b", DAYS, "proposal", "city", json!({ "author": "mayor-system", "in_position": "mayor", "addressed_to": ["city"], "data": { "enact": { "kind": "budget", "text": "x", "data": { "year": 1, "lines": { "parks": 1 } } }, "tags": ["budget"] } }));
        let mut s = Run::new(&MayorCode, ctx("new-self", json!({ "builder": "builder", "park_budget": 100_000 }), Some("mayor")));
        assert!(s.wake(&pic(10 * DAYS, vec![tabled], vec![])).is_empty());
        assert_eq!(lines(&calls(&s.wake(&pic(50 * DAYS, vec![], vec![]))), "proposal").len(), 1);
    }

    #[test]
    fn the_mayor_needs_its_builder_and_every_actor_saves() {
        assert!(MayorCode.create(&ctx("m", json!({}), Some("mayor"))).is_err());
        let c = ctx("m", mayor_params(), Some("mayor"));
        let mut a = MayorCode.create(&c).unwrap();
        let mut draws = Draws::new("m", "mayor");
        let p = pic(DAYS, vec![petition("pet-1", 0), counted("n1", "pet-1", DAYS, 100, "c1")], vec![]);
        let mut cx = Cx::new(p.t, &c, &mut draws, 1, vec![]);
        a.step(&p, &mut cx);
        let saved = a.save().unwrap();
        assert_eq!(MayorCode.restore(&c, saved.clone()).unwrap().save().unwrap(), saved);
        for (k, name) in [(&CouncilClerk as &dyn Kind, "clerk"), (&Councillor, "councillor")] {
            let c = ctx(name, json!({}), Some("x"));
            let a = k.create(&c).unwrap();
            let saved = a.save().unwrap();
            assert_eq!(k.restore(&c, saved.clone()).unwrap().save().unwrap(), saved);
        }
    }
}
