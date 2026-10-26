//! city.environment: the town's environment office. Ported from participants/src/behaviour/environment.ts (0.5.2);
//! documented in docs/behaviour/environment.md.
//!
//! Nobody sees wildlife's numbers for free. The office hires the surveyors the adopted budget's line pays for, and each
//! round (a quarter by default) sends them over a sample of each species' habitat, as many cells as their hours allow.
//! A survey is work whose estimate only the office learns (each animal there found with the species' detection
//! chance). At a round's end it publishes what it found as a report put forward to be believed (an assertion: an
//! honest office reports what it counted), and a habitat register for planning: the lots where it found a listed
//! species, accumulated like an atlas's.
//!
//! The office's picture of the land is its own habitat map (a paper made at genesis from where its scientists have
//! been) less what it has since had notice of being built on; a lot is whatever the land registry says a cell is on,
//! asked once for each cell where a listed species was found. It is shown neither the district nor the register of
//! lots (no-god-view).
//!
//! Decided in the port: percentages are integers (`Math.round` half up, written out); a percentage in words prints as
//! JavaScript printed it (`12.5`, `20`); the first wake is drawn from the office's identity (like the shop's); the
//! sample of a round is drawn from the stream `sample-<species>-<round>` as the TS did. Its staff are the reduced
//! `Staff` in environment_staff.rs until C1's `Staffing` lands.

use super::environment_staff::{lift, Own, Staff, StaffOpts, StaffThen, Want};
use crate::common::asking::{ask, Asked};
use crate::common::{data, lot_of, money_words, next_look, out_of_time, team, withdraw, Book, Directions, DAY, MONTH, YEAR};
use crate::papers::market::{EnvironmentReport, HabitatMap, HabitatRegister, SpeciesCount};
use crate::papers::{self, Paper};
use crate::steps::{arg, because, call, json, say, Done, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_sight::calls::Line;
use oikos_sight::{LookRequest, Record, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const MANIFEST: &str = include_str!("../../../../../participants/manifests/city.environment.json");

pub struct Environment;

/// A species it surveys, where each lives (its covers), and whether it is listed as threatened (the world gives).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Species {
    pub id: String,
    pub name: String,
    pub covers: Vec<String>,
    #[serde(default)]
    pub listed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    depot: String,
    workplace: String,
    role: String,
    wage: i64,
    period: i64,
    notice_days: i64,
    industry: String,
    working_day: i64,
    work_days: i64,
    look_at: i64,
    look_days: i64,
    staff_line: String,
    survey_task: String,
    survey_labour: i64,
    species: Vec<Species>,
    survey_every_days: i64,
    sample_cells: i64,
    planning: String,
    decline_flag_bps: i64,
    lots: String,
    directed_under: String,
    direction_compliance_bps: i64,
}

impl Params {
    fn read(ctx: &Ctx) -> Result<Params, String> {
        const K: &str = "city.environment";
        Ok(Params {
            depot: ctx.need("depot", K)?,
            workplace: ctx.need("workplace", K)?,
            role: ctx.param("role", "environmental scientist".to_string())?,
            wage: ctx.param("wage", 0)?,
            period: ctx.param("period", 14 * DAY)?,
            notice_days: ctx.param("notice_days", 14)?,
            industry: ctx.param("industry", String::new())?,
            working_day: ctx.param("working_day", 8 * 3600)?,
            work_days: ctx.param("work_days", 5)?,
            look_at: ctx.param("look_at", 0)?,
            look_days: ctx.param("look_days", 5)?,
            staff_line: ctx.param("staff_line", "environment".to_string())?,
            survey_task: ctx.param("survey_task", "survey".to_string())?,
            survey_labour: ctx.param("survey_labour", 0)?,
            species: ctx.param("species", vec![])?,
            survey_every_days: ctx.param("survey_every_days", 91)?,
            sample_cells: ctx.param("sample_cells", 60)?,
            planning: ctx.need("planning", K)?,
            decline_flag_bps: ctx.param("decline_flag_bps", 2000)?,
            lots: ctx.param("lots", String::new())?,
            directed_under: ctx.param("directed_under", String::new())?,
            direction_compliance_bps: ctx.param("direction_compliance_bps", 10_000)?,
        })
    }
}

/// The manifest the TS module wrote, with its `answers` (what the office says of itself to a letter).
pub fn manifest() -> Value {
    let mut m: Value = serde_json::from_str(MANIFEST).expect("the TS manifest");
    m["answers"] = json!({
        "office": "the environment office",
        "acts": "What it acts on: the adopted budget's environment line, which sets its staff; and a direction on its staffing form from those the town's rule on directions names. It surveys the district's wildlife each quarter and publishes what it finds.",
        "forms": [{
            "about": ["staff", "recruit", "hire", "hiring", "crew", "vacanc", "posts"],
            "say": "On staffing it follows a direction on its staffing form (environment_staffing) from those the town's rule on directions names, and no letter."
        }],
    });
    m
}

impl Kind for Environment {
    fn name(&self) -> &'static str {
        "city.environment"
    }
    fn version(&self) -> &'static str {
        "0.5.2"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/environment.md"
    }
    fn manifest(&self) -> Value {
        manifest()
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        8 * 3600 + (crate::market::retailer::fact(&ctx.entity, "first-wake") % 3600) as i64
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params::read(ctx)?;
        Ok(Box::new(Stepper::new(Office::new(ctx, p))))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Office>::restore(saved)?))
    }
}

/// What follows from a step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Then {
    Staff(StaffThen),
    /// A survey sent: the species and the cells, and who went.
    Survey { species: String, cells: Vec<String>, crew: Vec<String>, },
    /// The register published: its id is kept to be withdrawn by the next.
    Register,
}

#[derive(Serialize, Deserialize)]
struct Office {
    p: Params,
    me: String,
    book: Book,
    directions: Directions,
    staff: Staff,
    /// Cell -> its cover.
    cover: BTreeMap<String, String>,
    mapped: BTreeSet<String>,
    asked: Asked,
    /// The workplace as last seen: its capacity and who is in it.
    room: Option<(i64, Vec<String>)>,
    /// Staff -> seconds worked today.
    used: BTreeMap<String, i64>,
    used_day: i64,
    round: i64,
    next_round: i64,
    queue: Vec<(String, Vec<String>)>,
    /// Species -> cell -> estimate.
    found: BTreeMap<String, BTreeMap<String, i64>>,
    /// Surveys sent whose results have not come.
    pending: i64,
    /// Species -> the last round's (cells, found).
    last: BTreeMap<String, (i64, i64)>,
    /// Our standing habitat register.
    register: Option<String>,
    /// Lots where a listed species was ever recorded.
    recorded: BTreeSet<String>,
}

impl Office {
    fn new(ctx: &Ctx, p: Params) -> Office {
        let staff = Staff::new(
            &ctx.entity,
            StaffOpts {
                period: p.period,
                notice_days: p.notice_days,
                workplace: Some(p.workplace.clone()),
                role: p.role.clone(),
                industry: Some(p.industry.clone()).filter(|s| !s.is_empty()),
                own: Own::Role,
                hire: true,
                pay: false,
            },
        );
        Office {
            directions: Directions::new(ctx, &p.directed_under, Some(p.direction_compliance_bps), "the environment office"),
            me: ctx.entity.clone(),
            book: Book::new(),
            staff,
            cover: BTreeMap::new(),
            mapped: BTreeSet::new(),
            asked: Asked::default(),
            room: None,
            used: BTreeMap::new(),
            used_day: -1,
            round: 0,
            next_round: 30 * DAY, // (a month in, to have seen the land and hired)
            queue: vec![],
            found: BTreeMap::new(),
            pending: 0,
            last: BTreeMap::new(),
            register: None,
            recorded: BTreeSet::new(),
            p,
        }
    }

    fn name_of(&self, species: &str) -> String {
        self.p.species.iter().find(|s| s.id == species).map_or_else(|| species.to_string(), |s| s.name.clone())
    }

    fn annual(&self) -> i64 {
        if self.p.period > 0 {
            self.p.wage * YEAR / self.p.period
        } else {
            0
        }
    }

    /// The round's report, put forward to be believed, and the habitat register for planning.
    fn report(&mut self) -> Vec<Step<Then>> {
        let mut lines: Vec<String> = vec![];
        let mut counts: BTreeMap<String, SpeciesCount> = BTreeMap::new();
        for s in &self.p.species {
            let Some(m) = self.found.get(&s.id).filter(|m| !m.is_empty()) else { continue };
            let n: i64 = m.values().sum();
            let size = m.len() as i64;
            let per100 = round_div(n * 100, size);
            let before = self.last.get(&s.id).filter(|(c, _)| *c > 0).map(|(c, f)| round_div(f * 100, *c));
            let change = before.filter(|b| *b > 0).map(|b| round_div((per100 - b) * 10_000, b));
            counts.insert(s.id.clone(), SpeciesCount { cells: size, found: n, per_100_cells: per100, change_bps: change });
            let mut line = format!("{}{}: {n} found in {size} cells surveyed ({per100} per 100 cells)", s.name, if s.listed { " (listed as threatened)" } else { "" });
            if let Some(c) = change {
                line += &format!(
                    ", {} {}% since the last round{}",
                    if c >= 0 { "up" } else { "down" },
                    percent_words(c.abs()),
                    if c <= -self.p.decline_flag_bps { ": a decline to watch" } else { "" }
                );
            }
            lines.push(line);
            self.last.insert(s.id.clone(), (size, n));
            if s.listed {
                for (cell, k) in m {
                    if *k > 0 {
                        if let Some(lot) = lot_of(&self.book, cell) {
                            self.recorded.insert(lot.to_string());
                        }
                    }
                }
            }
        }
        if lines.is_empty() {
            return vec![];
        }
        let text = format!("State of the environment, round {}: {}.", self.round, lines.join("; "));
        let report = EnvironmentReport { round: self.round, species: counts };
        let mut steps = vec![because(
            format!("Round {}'s surveys are done: publishing what we found.", self.round),
            vec![say(
                EnvironmentReport::KIND,
                &text,
                Say { visible: Some(Visible::Public), data: Some(papers::data(&report)), extra: vec![("assertion", json!({ "that": text }))], ..Default::default() },
            )],
        )];
        let lots: Vec<String> = self.recorded.iter().cloned().collect();
        let listed = if lots.is_empty() {
            String::new()
        } else {
            format!(" ({}{})", lots.iter().take(20).cloned().collect::<Vec<_>>().join(", "), if lots.len() > 20 { ", ..." } else { "" })
        };
        let register = HabitatRegister { round: self.round, lots: lots.clone() };
        let mut lines = vec![];
        if let Some(old) = &self.register {
            lines.push(Line { bind: None, call: withdraw(old, Some("Superseded by this round's register.")) });
        }
        lines.push(Line {
            bind: Some("register".into()),
            call: say(
                HabitatRegister::KIND,
                &format!("Habitat register, round {}: listed species recorded on {} lots{listed}.", self.round, lots.len()),
                Say { to: Some(vec![self.p.planning.clone()]), visible: Some(Visible::Public), data: Some(papers::data(&register)), ..Default::default() },
            ),
        });
        let mut s = Step::new(lines).then(Then::Register);
        s.why = Some(format!("The lots where we've recorded a listed species, this round or before: telling planning ({} lots).", lots.len()));
        steps.push(s);
        steps
    }
}

/// `Math.round(a / b)` on integers (half up), for `b > 0`.
fn round_div(a: i64, b: i64) -> i64 {
    (2 * a + b).div_euclid(2 * b)
}

/// A number of basis points as the percentage JavaScript would print (`1250` is `12.5`, `2000` is `20`).
fn percent_words(bps: i64) -> String {
    let (whole, rest) = (bps / 100, bps % 100);
    match rest {
        0 => whole.to_string(),
        r if r % 10 == 0 => format!("{whole}.{}", r / 10),
        r => format!("{whole}.{r:02}"),
    }
}

/// What a staffing direction says: whether to recruit, and how many posts to fill (staffingUnder).
fn staffing_under(d: Option<&Record>) -> (bool, Option<i64>) {
    let Some(d) = d else { return (true, None) };
    let f = data(d);
    let posts = f.get("posts").and_then(Value::as_i64).filter(|n| *n > 0);
    (f.get("recruit").and_then(Value::as_str) != Some("no"), posts)
}

/// A budget line as a number of cents (a figure or the text of one).
fn amount(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

impl Plan for Office {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.staff.absorb(pic);
        let mut maps: Vec<(String, HabitatMap)> = vec![];
        for r in self.book.open("habitat_map") {
            if self.mapped.contains(r.id.as_str()) || r.speaks_for.as_deref() != Some(self.me.as_str()) {
                continue;
            }
            maps.push((r.id.to_string(), papers::read::<HabitatMap>(r).unwrap_or(HabitatMap { areas: vec![], built: vec![] })));
        }
        for (id, m) in maps {
            self.mapped.insert(id);
            // (Area by area, a later area over an earlier, as a map is drawn; then what was built on when it was made.)
            for a in &m.areas {
                for y in a.y..a.y + a.h {
                    for x in a.x..a.x + a.w {
                        self.cover.insert(format!("cell.{x}.{y}"), a.cover.clone());
                    }
                }
            }
            for c in m.built {
                self.cover.insert(c, "built".into());
            }
        }
        let mut built: Vec<(String, String)> = vec![];
        for n in self.book.open("building_notice") {
            if !self.mapped.contains(n.id.as_str()) {
                if let Some(at) = data(n).get("at").and_then(Value::as_str) {
                    built.push((n.id.to_string(), at.to_string()));
                }
            }
        }
        for (id, at) in built {
            self.mapped.insert(id);
            self.cover.insert(at, "built".into());
        }
        for ch in pic.channels.values() {
            if let Seen::Sites { cells, .. } = ch {
                for c in cells.iter() {
                    if let Some(s) = c.structure.as_ref().filter(|s| s.structure == self.p.depot) {
                        if let Some(sp) = s.spaces.iter().find(|sp| sp.space == self.p.workplace) {
                            let here = sp.occupants.iter().flatten().cloned().map(|x| x.to_string()).collect();
                            self.room = Some((i64::from(sp.capacity), here));
                        }
                    }
                }
            }
        }
        // What our surveys found (only we see it).
        for o in &pic.outcomes {
            let Some(sv) = &o.surveyed else { continue };
            self.pending = (self.pending - 1).max(0);
            let Some(of) = sv.get("of").and_then(Value::as_str) else { continue };
            let m = self.found.entry(of.to_string()).or_default();
            if let Some(cells) = sv.get("cells").and_then(Value::as_object) {
                for (cell, n) in cells {
                    m.insert(cell.clone(), n.as_i64().unwrap_or(0));
                }
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let t = pic.t;
        let mut steps: Vec<Step<Then>> = vec![];
        // ---- staff: what the adopted budget's line pays for ----
        let year = t.div_euclid(YEAR) + 1;
        let budget = self.book.open("budget").filter(|b| data(b).get("year").and_then(Value::as_i64) == Some(year)).max_by_key(|b| b.at).cloned();
        let line = budget.as_ref().map_or(0, |b| amount(data(b).get("lines").and_then(|l| l.get(&self.p.staff_line))));
        let workers = self.staff.workers(&self.book, t);
        let annual = self.annual();
        let target = if budget.is_some() {
            let room = self.room.as_ref().map_or(i64::MAX, |(c, _)| *c);
            room.min(if annual > 0 { line / annual } else { 0 }).max(0) as usize
        } else {
            workers.len()
        };
        let money = |n: i64| money_words(n, &cx.ctx.world);
        if workers.len() > target && t % MONTH < DAY {
            steps.extend(lift(
                self.staff.let_go(
                    &self.book,
                    t,
                    &format!("The adopted budget's {} line ({}) pays for {target} staff, and we have {}: letting one go.", self.p.staff_line, money(line), workers.len()),
                    "Redundancy: the budget doesn't pay for the position.",
                ),
                Then::Staff,
            ));
        }
        // A staffing direction that stands (from whoever the town says may direct us): whether to recruit, and how many.
        let standing = self.directions.standing(&self.book, "environment_staffing", cx).cloned();
        let (recruit, posts) = staffing_under(standing.as_deref());
        let hire_to = target.min(posts.map_or(usize::MAX, |n| n as usize));
        let want = Want {
            target: hire_to,
            wage: self.p.wage,
            can_post: budget.is_some() && hire_to > workers.len(),
            recruit: Some(recruit),
            stopped: standing.as_ref().map(|d| format!("Direction {} says not to recruit: taking our advertisements down.", d.id)),
            why: Some(format!(
                "The adopted budget's {} line ({}) pays for {target} staff{}; we have {}: posting a job.",
                self.p.staff_line,
                money(line),
                match (&standing, hire_to < target) {
                    (Some(d), true) => format!(" (and direction {} says to fill {hire_to})", d.id),
                    _ => String::new(),
                },
                workers.len()
            )),
        };
        steps.extend(lift(self.staff.routine(pic, &self.book, "", &want, cx), Then::Staff));
        let staff = &self.staff;
        let book = &self.book;
        steps.extend(self.directions.letters(book, |d, _| {
            let (recruit, posts) = staffing_under(Some(d));
            if recruit {
                format!("The office recruits up to {} staff.", target.min(posts.map_or(usize::MAX, |n| n as usize)))
            } else {
                staff.not_recruiting(book, t)
            }
        }));

        // ---- a new round: a sample of each species' habitat, as we've seen the land ----
        if t >= self.next_round && self.queue.is_empty() && self.pending == 0 {
            if self.round > 0 {
                steps.extend(self.report());
            }
            self.round += 1;
            self.next_round = t + self.p.survey_every_days * DAY;
            self.found.clear();
            for s in &self.p.species {
                let mut habitat: Vec<&String> = self.cover.iter().filter(|(_, c)| s.covers.contains(c)).map(|(cell, _)| cell).collect();
                let mut r = cx.rng(&format!("sample-{}-{}", s.id, self.round));
                let mut cells: Vec<String> = vec![];
                while (cells.len() as i64) < self.p.sample_cells && !habitat.is_empty() {
                    let i = r.below(habitat.len() as u64) as usize;
                    cells.push(habitat.remove(i).clone());
                }
                if !cells.is_empty() {
                    self.queue.push((s.id.clone(), cells));
                }
            }
        }

        // ---- a working day's fieldwork: as many cells as the staff's hours allow ----
        let day = t.div_euclid(DAY);
        if day != self.used_day {
            self.used_day = day;
            self.used.clear();
        }
        if !self.queue.is_empty() && day.rem_euclid(7) < self.p.work_days && self.p.survey_labour > 0 {
            let mine: BTreeSet<&String> = workers.iter().collect();
            let here: Vec<String> = self.room.iter().flat_map(|(_, o)| o.iter()).filter(|w| mine.contains(w)).cloned().collect::<BTreeSet<_>>().into_iter().collect();
            let (crew, each) = team(&here, |w| self.p.working_day - self.used.get(w).copied().unwrap_or(0));
            let mut cells_today = if crew.is_empty() { 0 } else { each * crew.len() as i64 / self.p.survey_labour };
            while cells_today > 0 && !self.queue.is_empty() {
                let take = (cells_today as usize).min(self.queue[0].1.len());
                let batch: Vec<String> = self.queue[0].1.drain(..take).collect();
                let species = self.queue[0].0.clone();
                if self.queue[0].1.is_empty() {
                    self.queue.remove(0);
                }
                cells_today -= batch.len() as i64;
                let share = (batch.len() as i64 * self.p.survey_labour + crew.len() as i64 - 1) / crew.len() as i64;
                for w in &crew {
                    *self.used.entry(w.clone()).or_insert(0) += share;
                }
                self.pending += 1;
                let mut st = because(
                    format!("Round {}'s fieldwork: surveying {} cells of habitat for the {}.", self.round, batch.len(), self.name_of(&species)),
                    vec![call(
                        "work",
                        vec![
                            ("task", Some(arg(&self.p.survey_task))),
                            ("at", Some(arg(&self.p.depot))),
                            ("by", Some(json(json!(crew)))),
                            ("survey", Some(arg(&species))),
                            ("cells", Some(json(json!(batch)))),
                        ],
                    )],
                );
                st.then = Some(Then::Survey { species, cells: batch, crew: crew.clone() });
                steps.push(st);
            }
        }
        steps
    }

    fn until(&self, pic: &Picture) -> Option<i64> {
        (self.p.look_at > 0).then(|| next_look(pic.t, self.p.look_at, self.p.look_days))
    }

    /// Which lot each cell is on where we found a listed species: the land registry's to say, asked about the one cell
    /// (once each), before the round's report names the lots. (One search is answered to a look: one cell now, and the
    /// next as this is asked again.)
    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        if self.p.lots.is_empty() {
            return vec![];
        }
        for s in self.p.species.iter().filter(|s| s.listed) {
            let Some(m) = self.found.get(&s.id) else { continue };
            for (cell, k) in m {
                if *k > 0 && lot_of(&self.book, cell).is_none() && self.asked.first(&format!("ground:{cell}"), pic.t) {
                    return vec![ask::about(&self.p.lots, "data.cells", cell.clone(), ask::About { most: 1, ..Default::default() })];
                }
            }
        }
        vec![]
    }

    fn then(&mut self, token: &Then, done: Done, cx: &mut Cx) -> Vec<Step<Then>> {
        match token {
            Then::Staff(t) => lift(self.staff.then(t, done, cx), Then::Staff),
            Then::Survey { species, cells, crew } => {
                if done.applied() {
                    return vec![];
                }
                self.pending = (self.pending - 1).max(0);
                // (Not done: back to the queue for another day, the staff's day as the world counts it.)
                self.queue.push((species.clone(), cells.clone()));
                let short = match done {
                    Done::Outcome(o) => out_of_time(o),
                    _ => None,
                };
                match short {
                    Some((Some(who), left)) => {
                        self.used.insert(who, self.p.working_day - left);
                    }
                    _ => {
                        for w in crew {
                            self.used.insert(w.clone(), self.p.working_day);
                        }
                    }
                }
                vec![]
            }
            Then::Register => {
                if let Done::Outcome(o) = done {
                    if let Some(id) = o.created.as_ref().and_then(|c| c.get("register")) {
                        self.register = Some(id.to_string());
                    }
                }
                vec![]
            }
        }
    }
}

#[cfg(test)]
mod tests;
