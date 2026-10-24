//! citizen.default: a townsperson's everyday life (participants/src/behaviour/citizen.ts, its life half;
//! docs/behaviour/citizen.md, households.md, justice.md, entry.md, ownership.md, deaths.md, with sources). The mind
//! (lane A2) is behind the seam in `mind.rs`; this file is the person: the kind, the actor, what it remembers, and the
//! wake. Each part of the week's plan is in its own file (`housing`, `work`, `money`, `lifecycle`, `recourse`), as
//! methods on `Person`, called in the order citizen.ts's `plan` did them (`plan.rs`).
//!
//! **How a wake goes** (citizen.ts `wake`): what is seen goes into the book (`absorb`); a child does a child's few
//! things; a death at home is seen to first; the daily round takes the body where it belongs; otherwise, once a week
//! (or when told something that changes it), the market is looked at as a search, then the week is planned, and the
//! steps go out one an action, the record written as the week leaves it.
//!
//! Decided fresh (docs/port-guide.md, section 2): integer arithmetic throughout, half away from zero where TS's
//! `Math.round` was used on a non-negative value; ties broken by id; a record's place by `filed_before`; dates by
//! `rules::calendar` where the world has one.

use super::mind::{self, Born, Event, Heard, Housed, Life, Mind, Outcome, Treated};
use super::params::Params;
use crate::common::{laws::noted, money::OwnAccount, Book, DAY, MONTH};
use crate::steps::{because, Step};
use crate::{Actor, Belief, Ctx, Cx, Kind, Picture};
use oikos_rules::household::{age_at, HouseholdData, Member, ADULT_YEARS};
use oikos_sight::calls::{Call, Line, Program};
use oikos_sight::{Action, LookRequest, Seen, SiteCell, SiteSpace};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub struct Citizen;

const MANIFEST: &str = include_str!("../../../../../participants/manifests/citizen.default.json");

impl Kind for Citizen {
    fn name(&self) -> &'static str {
        "citizen.default"
    }
    fn version(&self) -> &'static str {
        // (Held equal to the TS manifest until the cut-over, docs/port-guide.md section 2; the integration step bumps
        // it with the Rust's own changes, listed in the decisions entry.)
        "0.59.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/citizen.md"
    }
    fn manifest(&self) -> Value {
        serde_json::from_str(MANIFEST).unwrap_or(Value::Null)
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        7 * DAY
    }
    // (First wake: citizen.ts drew `rng("first-wake").below(7)` days. `Kind::first_wake` is given no streams, so the
    // person wakes at the start and, at that first wake, sleeps on to the day drawn on the same stream: `Person::wake`.)
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Person::new(ctx)?))
    }
    fn restore(&self, ctx: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Person::restore(ctx, saved)?))
    }
}

// ------------------------------------------------------------------ what a person remembers

/// A home: a unit (a space) in a building (citizen.ts `Home`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Home {
    /// The lease (or, owned, the title).
    pub agreement: String,
    pub space: String,
    pub structure: String,
    pub landlord: String,
    /// Rent a month (owned: the mortgage repayment, if any).
    pub rent: i64,
    /// The standing order that pays it.
    pub order: Option<String>,
    pub moved_in: bool,
    pub owned: bool,
    /// Rent orders replaced by a new rent's, to stop once their last payment is made (the order, when).
    pub retiring: Vec<(String, i64)>,
    /// Told to leave it for arrears (docs/behaviour/justice.md, "Possession").
    pub vacate: Option<Vacate>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vacate {
    pub paper: String,
    pub by: i64,
    pub stays: bool,
    pub ordered: bool,
    pub removed: bool,
    pub recorded: bool,
}

/// A job (citizen.ts `Job`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Job {
    pub agreement: String,
    pub employer: String,
    pub wage: i64,
    pub period: i64,
    pub workplace: Option<String>,
    pub since: i64,
    /// A change of our pay the employer's paper told us of: from when, and the wage then.
    pub coming: Option<(i64, i64)>,
    /// The wage before such a change, taken as our pay until then (wage, until).
    pub prev: Option<(i64, i64)>,
    /// The account our pay has come from.
    pub paid_from: Option<String>,
    /// What our pay has come short of what was agreed, and not yet put right.
    pub short: Option<i64>,
    /// When we walked out (unpaid), whatever the terms say.
    pub left_at: Option<i64>,
    pub paid_at: Option<i64>,
    pub claimed: bool,
}

/// Support paid to us once a claim is granted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Benefit {
    pub claim: String,
    pub payment: String,
    pub payer: String,
    pub amount: i64,
    pub every: i64,
    /// Income that lasts (a pension), not a stopgap while out of work.
    pub lasting: bool,
}

/// Rent (or a share of it) the bank could not pay: owed, and paid as soon as we can.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Missed {
    pub instruction: String,
    pub to: String,
    pub amount: i64,
    pub what: String,
}

/// Which search the next observation answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Looking {
    Leads,
    Market,
}

/// A step in the week's queue: its calls, and what it is to us.
#[derive(Debug, Clone)]
pub struct Todo {
    pub step: Step<()>,
    pub mark: Mark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mark {
    None,
    /// The move into our home planned this wake (`moveStep`).
    Move,
    /// A step that takes us to a place before the week is out (`goTo`): awake then.
    Go(String),
}

impl From<Step<()>> for Todo {
    fn from(step: Step<()>) -> Self {
        Todo { step, mark: Mark::None }
    }
}

/// Everything the life half remembers (citizen.ts's closure, its life variables). Every section's own memory is in
/// its own struct (`housing::Housing` and the rest); what more than one part reads is here. Serialised whole for a
/// snapshot.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct State {
    // ---- home and household
    pub home: Option<Home>,
    pub homeless_since: Option<i64>,
    /// Homes given up or put out of: no longer where we belong.
    pub gave_up: BTreeSet<String>,
    pub household: Option<HouseholdData>,
    /// The household record's id we read it from.
    pub household_record: Option<String>,
    /// As another adult: where we live, and our share of the rent (cents, its order).
    pub living_at: Option<String>,
    pub share: Option<(i64, Option<String>)>,
    /// As leaseholder: what the other adults told us they earn; the shares we told them.
    pub member_pay: BTreeMap<String, i64>,
    pub shares_told: BTreeMap<String, i64>,
    pub told_move_in: Option<String>,
    pub missed: Vec<Missed>,
    pub was_leaseholder: Option<bool>,
    /// The dwelling we were last in: where we go back to.
    pub last_dwelling: Option<String>,
    pub children_now: Vec<Member>,
    /// What the household told us since the last plan (from, what).
    pub heard: Vec<(String, Said)>,
    // ---- work and money
    pub job: Option<Job>,
    pub jobless_since: Option<i64>,
    pub last_employer: Option<String>,
    /// Those we have worked for.
    pub employers: BTreeSet<String>,
    /// employer -> the industry its posting said.
    pub industry_of: BTreeMap<String, String>,
    pub worked: bool,
    pub retired: bool,
    pub stop_age: Option<i64>,
    pub own_work: Option<super::params::OwnWork>,
    pub benefits: BTreeMap<String, Benefit>,
    /// Money that came in (t, amount; refunds negative), for what our income is.
    pub inflows: Vec<(i64, i64)>,
    /// What our own business has paid us (t, amount).
    pub drawings: Vec<(i64, i64)>,
    pub account_asked: bool,
    /// On strike from our job: the employer, whether out, the workplace we left.
    pub striking: Option<(String, bool, Option<String>)>,
    // ---- word of mouth and the market
    /// Buildings someone told us to look at, most recent last; and who told us.
    pub leads: Vec<String>,
    pub lead_from: BTreeMap<String, String>,
    pub looking: Option<Looking>,
    pub looked_at: i64,
    /// What the last search showed (record ids): homes, jobs, petitions; and what a lead's look showed.
    pub found_homes: Vec<String>,
    pub found_jobs: Vec<String>,
    pub found_petitions: Vec<String>,
    pub lead_homes: Vec<String>,
    pub lead_jobs: Vec<String>,
    pub people_we_know: BTreeSet<String>,
    // ---- the week
    pub planned_at: i64,
    pub next_plan_at: i64,
    pub last_seen_t: i64,
    pub moving: bool,
    pub last_was_move: bool,
    pub pending_go: Option<String>,
    pub leaving: bool,
    pub departed: bool,
    pub mourned: BTreeSet<String>,
    pub child_record_at: i64,
    pub pay_told_as: String,
    /// The mind's own next wake (a gathering, a model's answer): awake by then.
    pub mind_wake_at: Option<i64>,
    pub first_wake: Option<i64>,
    // ---- what a way chosen for a want set in train (citizen.ts 487-495, 514-515, 529, 539-540), for the parts of the
    // plan that carry it out: written by `recourse::carry_out`, read by housing, work and recourse.
    /// A look at the job board now, whatever the month's chance.
    pub search_forced: bool,
    /// A hunt for another home while we have one, until then, to beat this rent if that is the point.
    pub move_hunt: Option<(i64, Option<i64>)>,
    /// Looking for somewhere cheaper (a goal's method): homes under this rent, until then.
    pub cheaper_than: Option<(i64, i64)>,
    /// Whom we last asked to vary an agreement, and when; papers we wait on an answer about (paper -> (t, by)).
    pub asked_party: BTreeMap<String, i64>,
    pub asked_of: BTreeMap<String, (i64, String)>,
    /// Debts to take to the tribunal now; a complaint to make now; petitions to sign; elections to stand in.
    pub apply_debt_now: BTreeSet<String>,
    pub complain_now: bool,
    pub sign_now: BTreeSet<String>,
    pub stand_now: BTreeSet<String>,
    /// Not looking for work until then, having given up on it (0: looking).
    pub discouraged_until: i64,
    /// A business wanted: the venture hooks look until then (founding's `business` shape).
    pub venture_wanted: i64,
}

/// What a member of the household said, in our own phrasing (household.ts `hear`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Said {
    MoveIn(String),
    MoveOut(String),
    Leaving,
    Share { cents: i64, account: String },
    Pay(i64),
    Died { person: String, space: String },
    Trouble { what: String, by: String },
}

/// The person: parameters, memory, book and mind.
pub struct Person {
    pub p: Params,
    pub me: String,
    pub s: State,
    pub housing: super::housing::Housing,
    pub work: super::work::Work,
    pub money: super::money::Money,
    pub lifecycle: super::lifecycle::Lifecycle,
    pub recourse: super::recourse::Recourse,
    pub absorbed: super::absorb::Absorbed,
    pub book: Book,
    pub mind: Box<dyn Mind>,
    pub todo: Vec<Todo>,
    pub world_end: i64,
    pub tick: i64,
}

#[derive(Serialize, Deserialize)]
struct Saved {
    s: State,
    housing: super::housing::Housing,
    work: super::work::Work,
    money: super::money::Money,
    lifecycle: super::lifecycle::Lifecycle,
    recourse: super::recourse::Recourse,
    #[serde(default)]
    absorbed: super::absorb::Absorbed,
    book: Value,
    mind: Value,
    todo: Vec<(String, Option<String>, Mark)>,
    /// A translator's accepted draft a step of the queue carries, by its place in it (the call language cannot say it).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    drafted: Vec<(usize, crate::steps::Drafted)>,
}

/// A step's program as text and back (a snapshot keeps the queue as the call language reads it back exactly).
fn step_text(s: &Step<()>) -> String {
    oikos_sight::calls::program_text(&s.program())
}
fn step_of(text: &str, why: Option<String>) -> Result<Step<()>, String> {
    let lines = match oikos_sight::calls::parse_program(text).map_err(|e| e.0)? {
        Program::Lines(l) => l,
        Program::None(_) => vec![],
    };
    let mut s = Step::new(lines);
    s.why = why;
    Ok(s)
}

impl Person {
    pub fn new(ctx: &Ctx) -> Result<Person, String> {
        let p = Params::of(&ctx.params)?;
        let mut d = crate::Draws::new(&ctx.participant, ctx.position.as_deref().unwrap_or("self"));
        // (Who a person is is drawn from the run's seed, as every other draw of theirs is: runs of one town on two seeds are not the same people.)
        let mut cx = Cx::new(0, ctx, &mut d, ctx.world.seed, vec![]);
        let stop_age = p.stop_age(cx.rng("stops-work").below(10_000) as i64);
        let life = Life { adult: true, in_labour_force: p.in_labour_force, essentials: p.essentials, ..Default::default() };
        let m = mind::make(&mut cx, &Born { life: &life, own_values: ctx.params.get("own_values").filter(|v| !v.is_null()), parents: vec![] })?;
        let s = State {
            stop_age,
            own_work: p.own_work.clone(),
            planned_at: -1,
            looked_at: -1,
            ..Default::default()
        };
        let mut person = Person {
            housing: super::housing::Housing::new(&p, &mut cx),
            work: super::work::Work::new(&p, &mut cx),
            money: super::money::Money::new(&p, &mut cx),
            lifecycle: super::lifecycle::Lifecycle::new(&p, &mut cx),
            recourse: super::recourse::Recourse::new(&p, &mut cx),
            absorbed: super::absorb::Absorbed::new(&p, &mut cx),
            p,
            me: ctx.entity.clone(),
            s,
            book: Book::new(),
            mind: m,
            todo: vec![],
            world_end: ctx.world.run_end,
            tick: ctx.world.tick.max(1),
        };
        person.s.planned_at = -1;
        Ok(person)
    }

    pub fn restore(ctx: &Ctx, saved: Value) -> Result<Person, String> {
        let v: Saved = serde_json::from_value(saved).map_err(|e| e.to_string())?;
        let mut todo = v
            .todo
            .into_iter()
            .map(|(t, why, mark)| step_of(&t, why).map(|step| Todo { step, mark }))
            .collect::<Result<Vec<_>, _>>()?;
        for (i, d) in v.drafted {
            if let Some(t) = todo.get_mut(i) {
                t.step.act = Some(Box::new(d));
            }
        }
        Ok(Person {
            p: Params::of(&ctx.params)?,
            me: ctx.entity.clone(),
            s: v.s,
            housing: v.housing,
            work: v.work,
            money: v.money,
            lifecycle: v.lifecycle,
            recourse: v.recourse,
            absorbed: v.absorbed,
            book: Book::restore(v.book)?,
            mind: mind::restore(ctx, v.mind)?,
            todo,
            world_end: ctx.world.run_end,
            tick: ctx.world.tick.max(1),
        })
    }

    // ------------------------------------------------------------------ the household

    /// Holds the household's lease (or lives alone, as the leaseholder of one).
    pub fn is_leaseholder(&self) -> bool {
        self.s.household.as_ref().is_none_or(|h| h.leaseholder == self.me)
    }
    /// The other members of the household.
    pub fn others(&self) -> Vec<&Member> {
        self.s.household.as_ref().map_or(vec![], |h| h.members.iter().filter(|m| m.person != self.me).collect())
    }
    /// The household's children now (under 18), other than us.
    pub fn children(&self, t: i64) -> Vec<Member> {
        self.others().into_iter().filter(|m| age_at(m.born_at, t, self.p.year) < ADULT_YEARS).cloned().collect()
    }
    /// The household's other adults now.
    pub fn adults(&self, t: i64) -> Vec<Member> {
        self.others().into_iter().filter(|m| age_at(m.born_at, t, self.p.year) >= ADULT_YEARS).cloned().collect()
    }

    // ------------------------------------------------------------------ income (citizen.ts 1111-1157)

    /// What our own business brings in a month: what it paid us over the income window, or before the window has
    /// passed, what it was expected to.
    pub fn own_income(&self, t: i64) -> i64 {
        let Some(w) = &self.s.own_work else { return 0 };
        let window = self.p.income_window_days * DAY;
        if t < window {
            return w.expect_per_month;
        }
        let drawn: i64 = self.s.drawings.iter().map(|d| d.1).sum();
        drawn * MONTH / window.max(1)
    }
    /// Wages a month (work by the day: the working days of a month).
    pub fn wage_income(&self, t: i64) -> i64 {
        let job = match &self.s.job {
            None => 0,
            Some(j) if j.period == DAY => j.wage * 30 * self.p.round.map_or(5, |r| r.work_days) / 7,
            Some(j) => j.wage * MONTH / j.period.max(1),
        };
        self.own_income(t) + job
    }
    /// Support a month: lasting only, or with what is paid while out of work (not counted once in work).
    pub fn support_income(&self, lasting_only: bool) -> i64 {
        self.s.benefits.values().filter(|b| b.lasting || (!lasting_only && self.s.job.is_none())).map(|b| b.amount * MONTH / b.every.max(1)).sum()
    }
    pub fn monthly_income(&self, t: i64) -> i64 {
        self.wage_income(t) + self.support_income(false)
    }
    /// Income that keeps a household in town: work, or support that lasts.
    pub fn earned_income(&self, t: i64) -> i64 {
        self.wage_income(t) + self.support_income(true)
    }
    /// The household's income a month, as its leaseholder budgets: ours, and what the other adults told us.
    pub fn household_income(&self, t: i64) -> i64 {
        self.monthly_income(t) + if self.is_leaseholder() { self.s.member_pay.values().sum::<i64>() } else { 0 }
    }

    // ------------------------------------------------------------------ what the mind is told of life

    /// The person's circumstances, made fresh (seam rule: before each call that needs them).
    pub fn life(&self, pic: &Picture, t: i64, balance: Option<i64>) -> Life {
        let body = pic.body.as_ref();
        let age_days = body.map_or(0, |b| (t - b.born_at) / DAY);
        let adult = body.is_none_or(|b| age_at(b.born_at, t, self.p.year) >= ADULT_YEARS);
        let acc = crate::common::money::own_banked(pic, &self.me);
        let savings = balance.or(acc.as_ref().map(|a| a.balance)).unwrap_or(0);
        let home = self.s.home.as_ref();
        let housed = match (home, &self.s.living_at, self.lifecycle_lodging()) {
            (Some(h), _, _) if h.owned => Housed::Own,
            (Some(_), _, _) => Housed::Rents,
            (None, Some(_), _) => Housed::Lodging,
            (None, None, true) => Housed::Lodging,
            _ => Housed::None,
        };
        let goods_held = pic
            .channels
            .values()
            .flat_map(|c| match c {
                Seen::Holdings { holdings } => holdings.iter().filter(|h| h.kind == self.p.goods).map(|h| crate::common::money::cents(h.quantity)).collect::<Vec<_>>(),
                _ => vec![],
            })
            .sum::<i64>();
        let dwelling = home.filter(|h| h.moved_in).map(|h| h.space.clone()).or_else(|| self.s.living_at.clone());
        let mut neighbours: Vec<String> = match &dwelling {
            Some(d) => cells(pic, "street")
                .iter()
                .filter_map(|c| c.structure.as_ref())
                .filter(|st| st.structure == crate::common::structure_of(d))
                .flat_map(|st| st.spaces.iter().filter(|sp| &sp.space != d).flat_map(|sp| occupants(sp).iter().cloned()))
                .collect(),
            None => vec![],
        };
        neighbours.sort();
        neighbours.dedup();
        let member_of: Vec<String> = self.memberships();
        let h = self.s.household.as_ref();
        Life {
            t,
            age_days,
            adult,
            monthly_income: self.household_income(t),
            savings,
            essentials: self.p.essentials + home.map_or(self.s.share.as_ref().map_or(0, |s| s.0), |h| h.rent),
            household: h.map_or(1, |h| h.members.len() as u32),
            children: self.children(t).len() as u32,
            housed,
            bedrooms_needed: h.map(|h| oikos_rules::household::bedrooms_needed(h, t, self.p.year, self.p.occupancy.as_ref()) as u32),
            rent: home.filter(|h| !h.owned).map(|h| h.rent),
            landlord: home.filter(|h| !h.owned).map(|h| h.landlord.clone()),
            lease: home.filter(|h| !h.owned).map(|h| h.agreement.clone()),
            employer: self.s.job.as_ref().map(|j| j.employer.clone()),
            job: self.s.job.as_ref().map(|j| j.agreement.clone()),
            wage: self.s.job.as_ref().map(|j| j.wage),
            period: self.s.job.as_ref().map(|j| j.period),
            job_since: self.s.job.as_ref().map(|j| j.since),
            own_work: self.s.own_work.as_ref().map(|w| w.firm.clone()),
            retired: self.s.retired,
            in_labour_force: self.p.in_labour_force,
            goods_held,
            contacts: self.mind.contacts() as u32,
            deals_with: self.dealings(),
            member_of,
            industry: self.s.job.as_ref().and_then(|j| self.s.industry_of.get(&j.employer).cloned()),
            leaseholder: self.is_leaseholder(),
            leaseholder_is: h.map(|h| h.leaseholder.clone()).filter(|l| *l != self.me),
            household_adults: {
                let mut a: Vec<String> = self.adults(t).into_iter().map(|m| m.person).collect();
                a.sort();
                a
            },
            dwelling,
            owned: home.is_some_and(|h| h.owned),
            neighbours,
            sex: body.and_then(|b| b.sex).map(|s| format!("{s:?}").to_lowercase()),
            leaving: self.s.leaving,
            rent_share: self.s.share.as_ref().map(|s| s.0),
            account: acc.map(|a| a.account),
            shop: self.money.favourite.clone(),
            served_bps: Some(self.money.last_served),
            claimed_wages: self.s.job.as_ref().is_some_and(|j| j.claimed),
            workplace: self.s.job.as_ref().and_then(|j| j.workplace.clone()).or_else(|| self.s.own_work.as_ref().and_then(|w| w.at.clone())),
        }
    }

    /// Staying with someone, on their say-so (the lifecycle section keeps who).
    fn lifecycle_lodging(&self) -> bool {
        self.staying_with().is_some()
    }

    /// Organisations we hold a membership with, in force.
    pub fn memberships(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .book
            .of_type("agreement")
            .filter(|r| crate::papers::agreements::template_of(r) == Some("membership") && self.book.in_force(&r.id))
            .filter_map(|r| crate::papers::agreements::other_party(r, &self.me).map(String::from))
            .collect();
        v.sort();
        v.dedup();
        v
    }
    /// Those we are party to an agreement in force with.
    pub fn dealings(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .book
            .of_type("agreement")
            .filter(|r| self.book.in_force(&r.id))
            .filter_map(|r| crate::papers::agreements::other_party(r, &self.me).map(String::from))
            .collect();
        v.sort();
        v.dedup();
        v
    }
    pub fn member_of(&self, org: &str) -> bool {
        self.memberships().iter().any(|m| m == org)
    }

    /// Tell the mind how something turned out (citizen.ts `outcome`/`learn`/`hearOf`).
    pub fn tell(&mut self, w: &mut Week, o: Outcome) {
        let life = self.life(w.pic, w.t, w.acc.as_ref().map(|a| a.balance));
        self.mind.outcome(w.cx, &life, o);
    }
    /// Tell the mind how someone treated us.
    pub fn treated(&mut self, w: &mut Week, t: Treated) {
        self.mind.treated(w.cx, t);
    }
    /// Tell the mind something happened; its answer.
    pub fn happened(&mut self, w: &mut Week, e: Event) -> Heard {
        let life = self.life(w.pic, w.t, w.acc.as_ref().map(|a| a.balance));
        // (The mind may take a way at once, a rent rise, so it is handed life's openings: the mind is taken out for
        // the call so that the openings read life while the mind is busy.)
        let mut m = std::mem::replace(&mut self.mind, Box::new(mind::Plain::default()));
        let heard = m.event(w.cx, w.pic, &self.book, &life, e, &super::recourse::Ways { person: self, pic: w.pic, contacts: life.contacts as usize });
        self.mind = m;
        heard
    }
    /// The mind's half of the week's plan, with life's openings.
    pub fn mind_plan(&mut self, w: &mut Week) -> mind::Planned {
        let life = self.life(w.pic, w.t, w.acc.as_ref().map(|a| a.balance));
        let mut m = std::mem::replace(&mut self.mind, Box::new(mind::Plain::default()));
        let planned = m.plan(w.cx, w.pic, &self.book, &life, &super::recourse::Ways { person: self, pic: w.pic, contacts: life.contacts as usize });
        self.mind = m;
        planned
    }
}

/// The plan's working context: the picture, the step's context, the moment, our bank account as the plan has spent
/// it so far, and the steps planned.
pub struct Week<'w, 'c> {
    pub pic: &'w Picture,
    pub cx: &'w mut Cx<'c>,
    pub t: i64,
    pub acc: Option<OwnAccount>,
    pub steps: Vec<Todo>,
}

impl Week<'_, '_> {
    pub fn push(&mut self, s: Step<()>) {
        if !s.is_empty() {
            self.steps.push(s.into());
        }
    }
    pub fn push_marked(&mut self, s: Step<()>, mark: Mark) {
        if !s.is_empty() {
            self.steps.push(Todo { step: s, mark });
        }
    }
}

/// The cells of a sites channel (empty where the channel is none).
pub fn cells<'a>(pic: &'a Picture, channel: &str) -> &'a [SiteCell] {
    match pic.channels.get(channel) {
        Some(Seen::Sites { cells, .. }) => cells.as_slice(),
        _ => &[],
    }
}
/// Every space of the street's view.
pub fn spaces(pic: &Picture) -> impl Iterator<Item = &SiteSpace> {
    cells(pic, "street").iter().filter_map(|c| c.structure.as_ref()).flat_map(|st| st.spaces.iter())
}
/// Who is in a space, as the view shows (none shown: nobody we can tell).
pub fn occupants(sp: &SiteSpace) -> &[String] {
    sp.occupants.as_deref().unwrap_or(&[])
}
/// Whether we are in a space: around us we see who's in our own buildings; without that view, assume we are.
pub fn inside(pic: &Picture, me: &str, space: &str) -> bool {
    !matches!(pic.channels.get("street"), Some(Seen::Sites { .. })) || spaces(pic).any(|sp| sp.space == space && occupants(sp).iter().any(|o| o == me))
}
/// A line bound to a name (TS `["share", pay(...)]`).
pub fn bound(name: &str, call: Call) -> Line {
    Line { bind: Some(name.to_string()), call }
}
/// A step of lines with its reason.
pub fn step_of_lines(why: impl Into<String>, lines: Vec<Line>) -> Step<()> {
    let mut s = Step::new(lines);
    s.why = Some(why.into());
    s
}

// ------------------------------------------------------------------ the wake (citizen.ts `wake`)

impl Actor for Person {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        let action = self.wake(pic, cx);
        // (Questions to the mind's models out this wake: awake again by the next tick, to decide with the answer.)
        if !cx.questions.is_empty() {
            if let Action::Wait { until } = action {
                let next = pic.t + self.tick;
                return Action::Wait { until: Some(until.map_or(next, |u| u.min(next))) };
            }
        }
        action
    }
    fn beliefs(&self) -> Vec<Belief> {
        if self.s.departed || self.s.leaving {
            return vec![];
        }
        let mut b = vec![];
        if let Some(j) = &self.s.job {
            b.push(Belief::Agreement { agreement: j.agreement.clone(), in_force: true });
        }
        if let Some(h) = self.s.home.as_ref().filter(|h| !h.owned) {
            b.push(Belief::Agreement { agreement: h.agreement.clone(), in_force: true });
        }
        b
    }
    fn save(&self) -> Result<Value, String> {
        let v = Saved {
            s: self.s.clone(),
            housing: self.housing.clone(),
            work: self.work.clone(),
            money: self.money.clone(),
            lifecycle: self.lifecycle.clone(),
            recourse: self.recourse.clone(),
            absorbed: self.absorbed.clone(),
            book: self.book.save(),
            mind: self.mind.save()?,
            todo: self.todo.iter().map(|t| (step_text(&t.step), t.step.why.clone(), t.mark.clone())).collect(),
            drafted: self.todo.iter().enumerate().filter_map(|(i, t)| t.step.act.as_deref().map(|d| (i, d.clone()))).collect(),
        };
        serde_json::to_value(v).map_err(|e| e.to_string())
    }
}

impl Person {
    fn wait(&self, until: i64) -> Action {
        Action::Wait { until: Some(until) }
    }
    fn end(&self) -> i64 {
        self.world_end + DAY
    }

    fn wake(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        let t = pic.t;
        if self.s.leaving && pic.body.as_ref().is_some_and(|b| !b.present) {
            self.s.departed = true;
        }
        if self.s.departed {
            return self.wait(self.end());
        }
        // (The first wake of the run: on to the day drawn for it, as citizen.ts's `firstWake`.)
        if self.s.first_wake.is_none() {
            let at = if t == 0 { cx.rng("first-wake").below(7) as i64 * DAY } else { t };
            self.s.first_wake = Some(at);
            if at > t {
                // (What this first look showed is taken in now: the kernel hands a participant its records once, as
                // they come, so the world's opening papers, our home, job and household among them, are not shown
                // again at the day drawn. TS's first wake was the scheduler's, before any look.)
                self.absorb(pic, cx);
                return self.wait(at);
            }
        }
        self.s.last_seen_t = t;
        self.absorb(pic, cx);
        {
            let life = self.life(pic, t, None);
            self.mind.woke(cx, pic, &self.book, &life);
        }
        // (Taken out of the world with our household, or gone from it: nothing more here.)
        if pic.body.as_ref().is_some_and(|b| !b.present) {
            return self.wait(self.end());
        }
        self.heard_go(pic);

        // A child does nothing on their own until they're 18 (their parents house them): the child's wake.
        if pic.body.as_ref().is_some_and(|b| age_at(b.born_at, t, self.p.year) < ADULT_YEARS) {
            let mut w = Week { pic, cx, t, acc: crate::common::money::own_banked(pic, &self.me), steps: vec![] };
            return self.child_wake(&mut w);
        }
        // A death at home, seen now: what it asks of us is done first, and the week planned afresh after.
        let mourned_before = self.s.mourned.len();
        {
            let mut w = Week { pic, cx: &mut *cx, t, acc: crate::common::money::own_banked(pic, &self.me), steps: vec![] };
            self.see_death_at_home(&mut w);
            let seen = std::mem::take(&mut w.steps);
            self.todo.extend(seen);
        }
        if self.s.mourned.len() > mourned_before {
            self.s.next_plan_at = self.s.next_plan_at.min(t);
        }
        if self.todo.is_empty() {
            let mut w = Week { pic, cx: &mut *cx, t, acc: None, steps: vec![] };
            if let Some(s) = self.wonder_next_door(&mut w) {
                return self.send(s, cx);
            }
        }
        // The daily round: a wake only for going somewhere just takes us where we belong.
        // (A gathering to go to is the mind's: it plans the going; life wakes on its round and its week.)
        // (The time the mind asked to be woken for, a gathering's start: reached, the week is planned now, so the mind can go;
        // TS's `practiceWake`, compared before any filter. Filtering it to the future here sent every gathering's wake into
        // the daily round, and almost nobody went: integration, 2026-10-18.)
        let practice_wake: Option<i64> = self.s.mind_wake_at;
        if self.p.round.is_some()
            && t < self.s.next_plan_at
            && self.todo.is_empty()
            && pic.woke_for != "news"
            && pic.woke_for != "start"
            && !practice_wake.is_some_and(|p| t >= p)
        {
            if let Some(go) = self.go_where_we_belong(pic, cx) {
                return self.send_go(go, cx);
            }
            return self.wait(self.next_change(t).min(self.s.next_plan_at).min(practice_wake.filter(|p| *p > t).unwrap_or(i64::MAX)));
        }
        // Planned when a wake begins; woken because an act of ours is done, we carry on with the plan.
        if self.s.planned_at != t && (pic.woke_for != "done" || self.todo.is_empty()) {
            if let Some(looks) = self.looks(pic, cx) {
                return Action::Look { looks };
            }
            let acc = crate::common::money::own_banked(pic, &self.me);
            let mut w = Week { pic, cx: &mut *cx, t, acc, steps: vec![] };
            self.plan(&mut w);
            let planned = std::mem::take(&mut w.steps);
            self.todo.extend(planned.into_iter().filter(|s| !s.step.is_empty()));
            self.s.planned_at = t;
            {
                let life = self.life(pic, t, None);
                self.mind.record(cx, &life);
            }
            if self.p.round.is_some() {
                self.s.next_plan_at = t + 7 * DAY;
                if let Some(go) = self.go_where_we_belong(pic, cx) {
                    let to = self.belong(pic).unwrap_or_default();
                    let going_there = self.todo.iter().any(|st| {
                        st.step.lines.iter().any(|l| l.call.fn_ == "occupancy" && !l.call.args.iter().any(|(k, _)| k == "leave") && format!("{:?}", l.call.args).contains(&to))
                    });
                    if !going_there {
                        self.todo.push(go);
                    }
                }
            }
            self.s.lead_homes.clear();
            self.s.lead_jobs.clear();
        }
        if self.todo.is_empty() {
            self.s.last_was_move = false;
            let pw = self.s.mind_wake_at.filter(|p| *p > t);
            return match self.p.round {
                Some(_) => self.wait(pw.unwrap_or(i64::MAX).min(self.s.next_plan_at).min(self.next_change(t))),
                None => match pw {
                    Some(p) => self.wait(p.min(t + 7 * DAY)),
                    None => Action::wait(),
                },
            };
        }
        let next = self.todo.remove(0);
        self.s.last_was_move = next.mark == Mark::Move;
        if self.s.leaving && self.todo.is_empty() {
            self.s.departed = true;
        }
        if let Mark::Go(to) = &next.mark {
            self.s.pending_go = Some(to.clone());
        }
        self.send(next.step, cx)
    }

    /// One step as the action of this wake (noted against the laws we have read, as every code actor's act is).
    pub fn send(&mut self, s: Step<()>, cx: &mut Cx) -> Action {
        noted(&mut self.book, s.action(cx))
    }
    pub fn send_go(&mut self, go: Todo, cx: &mut Cx) -> Action {
        if let Mark::Go(to) = &go.mark {
            self.s.pending_go = Some(to.clone());
        }
        self.send(go.step, cx)
    }

    /// What to look up before the week is planned: a lead someone gave us, else the market as a search, else the
    /// register (citizen.ts `wake`, 4856-4929). None: plan now.
    fn looks(&mut self, pic: &Picture, cx: &mut Cx) -> Option<Vec<LookRequest>> {
        let t = pic.t;
        let register = self.register_looks(t);
        // (Not yet banked: nothing to search the market with, but papers about land of ours are still read up on first,
        // so a plan is never made not knowing a home we own: citizen.ts `wake` takes `register` whatever `acc` is.)
        let Some(acc) = crate::common::money::own_banked(pic, &self.me) else { return (!register.is_empty()).then_some(register) };
        let budget = self.home_budget(acc.balance, t);
        let need_home = self.need_home(t);
        let wants_work = self.s.job.is_none() && self.s.own_work.is_none() && !self.s.retired && self.p.in_labour_force;
        if self.s.looking.is_none() && self.s.looked_at != t && !self.s.leads.is_empty() && (need_home || wants_work) {
            let lead = self.s.leads.pop().unwrap_or_default();
            let mut looks = vec![];
            if need_home {
                looks.push(self.home_lead_look(&lead, budget, t));
            }
            if wants_work {
                looks.push(self.job_lead_look(&lead));
            }
            self.s.lead_homes.clear();
            self.s.lead_jobs.clear();
            self.s.looking = Some(Looking::Leads);
            return Some([register, looks].concat());
        }
        let mut looks = vec![];
        self.search_due(pic, cx);
        if self.s.looked_at != t {
            if need_home {
                looks.push(self.home_market_look(budget, t));
            }
            looks.extend(self.job_market_looks());
            looks.extend(self.sale_looks(t));
            looks.extend(self.shop_looks(pic, cx));
            looks.push(crate::common::ask::board("petitions", 10, vec![], None));
            if let (Some(j), Some(board)) = (&self.s.job, &self.p.work_board) {
                looks.push(crate::common::ask::about(
                    board,
                    "data.employer",
                    j.employer.clone(),
                    crate::common::ask::About { most: self.p.search_limit, since: Some(j.since), ..Default::default() },
                ));
            }
        }
        if !looks.is_empty() {
            self.s.looked_at = t;
            self.s.found_homes.clear();
            self.s.found_jobs.clear();
            self.s.found_petitions.clear();
            self.s.looking = Some(Looking::Market);
            return Some([register, looks].concat());
        }
        if !register.is_empty() {
            return Some(register);
        }
        self.s.looked_at = t;
        self.s.looking = None;
        None
    }

    // ------------------------------------------------------------------ leaving town (citizen.ts `departure`)

    /// Leaving town: stop paying, give notice, send our money on, and go (taking the children, if we hold the lease).
    pub fn departure(&mut self, w: &mut Week, why: &str) {
        let mut calls: Vec<Call> = vec![];
        use crate::common::calls::withdraw;
        use crate::papers::agreements::notice;
        if let Some(h) = self.s.home.as_mut().filter(|h| !h.owned) {
            if let Some(o) = &h.order {
                calls.push(withdraw(o, None));
            }
            for (o, _) in std::mem::take(&mut h.retiring) {
                calls.push(withdraw(&o, None));
            }
            calls.push(notice(&h.agreement, "Leaving town."));
        }
        if let Some((_, Some(o))) = &self.s.share {
            calls.push(withdraw(o, Some("Leaving town.")));
        }
        if let Some(j) = &self.s.job {
            calls.push(notice(&j.agreement, "Leaving town."));
        }
        calls.extend(self.leaving_union());
        // Everything else of ours we can end by notice under its terms (memberships): ended, and what we pay under it
        // stopped.
        let home_ag = self.s.home.as_ref().map(|h| h.agreement.clone());
        let job_ag = self.s.job.as_ref().map(|j| j.agreement.clone());
        for r in self.book.of_type("agreement") {
            if Some(&r.id) == home_ag.as_ref() || Some(&r.id) == job_ag.as_ref() || !self.book.in_force(&r.id) {
                continue;
            }
            if !crate::papers::agreements::parties_of(r).iter().any(|x| x == &self.me) || !ends_by_our_notice(r, &self.me) {
                continue;
            }
            for o in self.book.all("request") {
                if crate::common::cites(o, &r.id) && o.speaks_for.as_deref() == Some(self.me.as_str()) && !self.book.withdrawn(&o.id) {
                    calls.push(withdraw(&o.id, Some("Leaving town.")));
                }
            }
            calls.push(notice(&r.id, "Leaving town."));
        }
        let mut tell = self.p.tell_on_leaving.clone();
        tell.sort();
        calls.push(crate::steps::say(
            "departure",
            &format!("{} has left town.", self.me),
            crate::steps::Say { to: (!tell.is_empty()).then_some(tell), ..Default::default() },
        ));
        if let (Some(acc), Some(out)) = (&w.acc, &self.p.outside_account) {
            if acc.balance > 0 {
                calls.push(crate::steps::pay(
                    out,
                    acc.balance,
                    crate::steps::Pay { from: Some(acc.account.clone()), for_: Some("Moving away: send all my savings with me.".into()), ..Default::default() },
                    w.cx,
                ));
            }
        }
        self.s.leaving = true;
        calls.push(crate::steps::call("presence", vec![("leave", Some(crate::steps::arg("yes")))]));
        // The children go first, each on its own (one may not be here).
        if self.is_leaseholder() {
            for k in self.s.children_now.clone() {
                w.push(because(why, vec![crate::steps::call("presence", vec![("who", Some(crate::steps::arg(&k.person))), ("leave", Some(crate::steps::arg("yes")))])]));
            }
        }
        w.push(because(why, calls));
    }

    /// Grown up (or new to town) with no bank account: asking the bank for one.
    pub fn without_account(&mut self, w: &mut Week) {
        if self.s.account_asked {
            return;
        }
        if let Some(bank) = self.p.bank.clone() {
            self.s.account_asked = true;
            w.push(because(
                "Grown up (or new to town) with no bank account: asking the bank for one.",
                vec![crate::steps::call("account", vec![("holder", Some(crate::steps::arg(&self.me))), ("at", Some(crate::steps::arg(&bank)))])],
            ));
        }
    }
}

/// Whether an agreement's terms let this party end it by notice.
fn ends_by_our_notice(r: &oikos_sight::Record, me: &str) -> bool {
    match &r.body {
        oikos_sight::RecordBody::Agreement { terms, .. } => {
            let t = serde_json::to_value(terms).unwrap_or(Value::Null);
            t.get("termination").and_then(Value::as_array).is_some_and(|a| a.iter().any(|x| x.get("party").and_then(Value::as_str) == Some(me)))
        }
        _ => false,
    }
}
