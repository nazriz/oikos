//! A firm's staff (ported from participants/src/behaviour/firms.ts: `Staffing`, `LabourPlan`, `staffingForm`,
//! `staffingUnder`, `terminationLaw`, `hoursLaw`, `paidShare`, `weeksAt`, `ordinaryHours`; shared by the employer, the
//! producer, the retailer and every body's payroll). Hiring through job postings and offers, wages by standing order
//! through the firm's bank, notice, hours before heads, pay that comes short, wages owed, a worker's death, strikes.
//! What headcount and wage to aim for is the module's own rule (callers compute a firm's need with
//! `oikos_rules::labour::staff_needed` and hand it in as `Want::target`); this is how any employer carries it out.
//!
//! Documented in docs/behaviour/firms.md (staff, returns, hours, wages owed) and docs/behaviour/staffing.md.
//!
//! Decided fresh in the port (the rest is the TS rule step for step):
//! - Memory is plain data (ordered collections), so a firm's staff saves and restores whole; steps carry no closures.
//! - The organisation's wants (`Org`) are not owned: the two methods that read it (`shortening`, `asked`) are given it.
//! - A dead person's wage is stopped whoever is still acting for the firm: `stop_the_dead` is the part of the routine
//!   that does only that, so an owner's appointer can keep a dead man off the payroll when the officer's post has
//!   fallen vacant (docs/testing.md: "a shop whose only post-holder dies has nobody to stop the dead man's wages").
//! - Where the TS compared record ids as strings, applications and requests are ordered by filing (`filed_before`).
//! - No floating point (kernel/tests/determinism_lint.rs): service is seconds, a schedule's days are thousandths of a
//!   day, the ordinary week is minutes, `hiring_cost_weeks` is read into thousandths of a week by its digits
//!   (`decimal::scaled`), and redundancy pay is reckoned exactly in seconds of pay; percentages and weeks are written
//!   back as short decimals (`decimal::fmt_dec`).

use super::decimal::{fmt_dec, round_div, scaled};
use super::orgwants::{Org, Wanting};
use super::practice::PracticeOf;
use super::returns::{due_on, return_rest, returns_of, ReturnRule};
use super::tax::{day_pay_period, income_tax_law, withheld, Charge, IncomeTaxLaw};
use crate::common::letters::{payee_died, payment_failed};
use crate::common::{
    cents, data, duration_words, filed_before, first_due, message, money_words, structure_of, truthy, when_words, withdraw, Book, DAY,
    MONTH,
};
use crate::papers::agreements::{advertised_job, commitment_of, job_terms, notice, offer, Offer};
use crate::steps::{arg, because, call, pay, say, Pay, Say, Step, Visible};
use crate::{Belief, Cx};
use oikos_rules::slip::{slip, SlipOptions};
use oikos_sight::calls::{Call, Line};
use oikos_sight::{Picture, Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// How a hiring office's letter to the payroll office begins (an office's note: `office_note`).
pub const PAYROLL_NOTE: &str = "Payroll notice from the hiring office, ";
/// How long before a pay run a change of pay is left to the run after (payroll's cut-off: longer than any act takes).
const PAY_CUTOFF: i64 = 2 * DAY;
/// The days a paper to the staff goes ahead of the pay it changes, where the law gives none.
pub const HOURS_GRACE_DAYS: i64 = 3;
/// The notice an agreement by the day gives: none (the least a term can say).
pub const NO_NOTICE: i64 = 1;
const YEAR: i64 = 365 * DAY;

// ---------------------------------------------------------------------------------------------------- the laws

/// The staffing direction an office that hires takes (docs/behaviour/directions.md): whether it recruits, and the most
/// posts it fills. A staffing direction as it bears on hiring (none standing: recruit as the office would).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaffingUnder {
    pub recruit: bool,
    pub posts: Option<i64>,
}

/// `staffingUnder`: the direction standing (if any) as it bears on hiring.
pub fn staffing_under(direction: Option<&Record>) -> StaffingUnder {
    let d = direction.map(data);
    let posts = d.and_then(|d| d.get("posts")).and_then(Value::as_i64).filter(|p| *p > 0);
    StaffingUnder { recruit: d.and_then(|d| d.get("recruit")).and_then(Value::as_str) != Some("no"), posts }
}

/// A schedule by service: from this much service (seconds: years of 365 days), so many thousandths of a day of pay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ByService {
    pub from_service: i64,
    pub milli_days: i64,
}

/// The law on ending a job for redundancy, as its lawmaker published it (docs/behaviour/firms.md, "Adjusting labour"):
/// the least notice and the redundancy pay an employer owes, each by length of service, in days of pay (a week is
/// seven); and the size of employer below which no redundancy pay is owed, where the law has one. A world with no such
/// law owes what its agreements say and nothing more.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminationLaw {
    pub id: String,
    pub notice: Vec<ByService>,
    pub redundancy_pay: Vec<ByService>,
    /// The size of employer (thousandths of a member of staff) below which no redundancy pay is owed.
    pub small_employer_under: Option<i64>,
}

fn schedule_of(v: Option<&Value>) -> Vec<ByService> {
    let mut steps: Vec<ByService> = v
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|b| Some(ByService { from_service: scaled(b.get("from_years")?, YEAR)?, milli_days: scaled(b.get("days")?, 1_000)? })).collect())
        .unwrap_or_default();
    steps.sort_by_key(|b| b.from_service);
    steps
}

pub fn termination_law(book: &Book) -> Option<TerminationLaw> {
    let l = super::tax::latest_law(book, |r| data(r).get("employment").and_then(Value::as_str) == Some("termination"))?;
    let d = data(l);
    let under = d.get("small_employer_under").and_then(|u| scaled(u, 1_000)).filter(|u| *u > 0);
    Some(TerminationLaw { id: l.id.clone(), notice: schedule_of(d.get("notice")), redundancy_pay: schedule_of(d.get("redundancy_pay")), small_employer_under: under })
}

/// A schedule by service, read at a length of service (seconds) as thousandths of a day of pay (the last step at or
/// below it; before the first: nothing). TS's `weeksAt` is this over 7,000.
pub fn days_at(steps: &[ByService], service: i64) -> i64 {
    steps.iter().fold(0, |x, b| if service >= b.from_service { b.milli_days } else { x })
}

fn small(law: &TerminationLaw, staff: i64) -> bool {
    law.small_employer_under.is_some_and(|u| staff * 1_000 < u)
}

/// How the law lets an employer cut hours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MayCut {
    Notice,
    Consent,
    No,
}

/// The law on cutting an employee's hours in place of ending the job (docs/behaviour/firms.md, "Hours before heads"):
/// whether an employer may reduce hours for want of work, the ordinary week, the notice, the least hours it may cut to
/// (a share of the ordinary), the longest spell, and the pay owed for the hours not worked (a share of the pay for
/// them, from an employer of that many staff). A world with no such law has firms that do not cut hours.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HoursLaw {
    pub id: String,
    pub may_cut: MayCut,
    /// The ordinary week, in minutes.
    pub ordinary_week_minutes: i64,
    pub notice_days: i64,
    pub floor_bps: i64,
    pub max_days: i64,
    pub pay_bps: i64,
    pub pay_owed_from: i64,
    pub consent_bps: i64,
}

pub fn hours_law(book: &Book) -> Option<HoursLaw> {
    let l = super::tax::latest_law(book, |r| data(r).get("employment").and_then(Value::as_str) == Some("hours"))?;
    let d = data(l);
    let n = |k: &str, scale: i64, default: i64| d.get(k).and_then(|v| scaled(v, scale)).filter(|x| *x >= 0).unwrap_or(default);
    let may_cut = match d.get("may_cut").and_then(Value::as_str) {
        Some("notice") => MayCut::Notice,
        Some("consent") => MayCut::Consent,
        _ => MayCut::No,
    };
    Some(HoursLaw {
        id: l.id.clone(),
        may_cut,
        ordinary_week_minutes: n("ordinary_week_hours", 60, 40 * 60),
        notice_days: n("notice_days", 1, 0),
        floor_bps: n("floor_bps", 1, 0).min(10_000),
        max_days: n("max_days", 1, 0),
        pay_bps: n("pay_bps", 1, 0).min(10_000),
        pay_owed_from: n("pay_owed_from", 1, 0),
        consent_bps: n("consent_bps", 1, 10_000).min(10_000),
    })
}

/// The ordinary week of a job in minutes: its agreement's hours term, else the law's ordinary week.
pub fn ordinary_minutes(a: Option<&Record>, worker: &str, law: Option<&HoursLaw>) -> i64 {
    match a.and_then(|a| job_terms(a, worker, None).hours) {
        Some(h) => h / 60,
        None => law.map_or(0, |l| l.ordinary_week_minutes),
    }
}

/// The pay a cut leaves, in 10,000ths of the ordinary pay: the hours worked at full pay, and the hours cut at the share
/// the law owes for them.
pub fn paid_share(hours_bps: i64, pay_bps: i64) -> i64 {
    hours_bps + ((10_000 - hours_bps) * pay_bps).div_euclid(10_000)
}

/// Work by the day (docs/behaviour/firms.md, "Work by the day"): an employment agreement whose pay is a day's. The hand
/// is paid for each day worked, by a payment that day and no standing order, and either side ends it without notice.
pub fn by_the_day(a: &Record) -> bool {
    let RecordBody::Agreement { terms } = &a.body else { return false };
    terms.template.as_deref() == Some("employment")
        && terms.commitments.iter().any(|c| terms.parties.first() == Some(&c.who) && c.every == Some(DAY) && c.does.get("outcome").is_some_and(|o| o.get("money").is_some()))
}

/// How an employer adjusts its staff to its trade (docs/behaviour/firms.md, "Adjusting labour"). Three things real
/// firms do, each with its source there: they plan on trade smoothed over a horizon, never on one month's (Holt,
/// Modigliani, Muth and Simon 1960); they hold labour through a dip, because letting someone go and hiring again both
/// cost (Oi 1962; Hamermesh 1989; Bentolila and Bertola 1990; Fay and Medoff 1985), so a worker is let go only once
/// the surplus has lasted as long as letting them go and replacing them would cost in their pay; and while over their
/// need they shed by not replacing those who leave (Davis, Faberman and Haltiwanger 2012).
/// `smooth_months`: the horizon (0: last month's figure, the rule as it was). `hiring_cost_milliweeks`: what taking
/// someone on costs, in thousandths of a week of their pay (the world's `hiring_cost_weeks`, read by `decimal::scaled`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdjustParams {
    pub smooth_months: i64,
    pub hiring_cost_milliweeks: i64,
    /// Hours before heads: the least change, in 10,000ths of the ordinary hours, worth a notice to the staff (a
    /// placeholder; left out: 1,000).
    pub hours_step_bps: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabourPlan {
    p: AdjustParams,
    level: i64,
    /// Months in a row with more staff than the trade expected needs.
    surplus: i64,
}

impl LabourPlan {
    /// `opening`: the trade the firm expected when it took its staff on (a month's items), where it has one: its first
    /// month's figure then moves that expectation like any other month's, and is not taken for the whole of it.
    pub fn new(p: AdjustParams, opening: Option<i64>) -> Self {
        LabourPlan { p, level: opening.filter(|o| *o > 0).unwrap_or(-1), surplus: 0 }
    }
    /// The trade expected, after another month's figure: an average weighted to the recent months over the horizon.
    pub fn expect(&mut self, month: i64) -> i64 {
        let h = self.p.smooth_months.max(0);
        self.level = if self.level < 0 || h <= 1 {
            month
        } else {
            // Math.round(level + (month - level) * 2 / (h + 1)), half up.
            (2 * (self.level * (h + 1) + (month - self.level) * 2) + (h + 1)).div_euclid(2 * (h + 1))
        };
        self.level
    }
    pub fn expected(&self) -> i64 {
        self.level
    }
    /// How many months a surplus must have lasted before the most recent hire is let go: what ending the job costs
    /// under the law (notice and redundancy pay for their service, where our size owes it) and hiring again, in weeks
    /// of pay, as months (never less than one: the month the surplus is first seen).
    /// `service`: how long the one who would go has been with us (seconds).
    pub fn waits(&self, law: Option<&TerminationLaw>, staff: i64, service: i64, notice_days: i64) -> i64 {
        // All in thousandths of a day of pay: weeks are seven days.
        let notice = law.map_or(0, |l| days_at(&l.notice, service)).max(notice_days * 1_000);
        let redundancy = match law {
            Some(l) if !small(l, staff) => days_at(&l.redundancy_pay, service),
            _ => 0,
        };
        let total = i128::from(notice + redundancy + self.p.hiring_cost_milliweeks.max(0) * 7);
        // Weeks as months: twelve to fifty-two, rounded up.
        let den = 52 * 7 * 1_000;
        ((total * 12 + den - 1) / den).max(1) as i64
    }
    /// The month's look: `over` (more staff than the expected trade needs) or not. Returns whether to let one go now,
    /// and how long the surplus has lasted.
    pub fn month(&mut self, over: bool, waits: i64) -> (bool, i64) {
        self.surplus = if over { self.surplus + 1 } else { 0 };
        if over && self.surplus >= waits {
            self.surplus = 0;
            return (true, waits);
        }
        (false, self.surplus)
    }
}

// ---------------------------------------------------------------------------------------------------- the staff

/// What a wage order withholds a pay, charge by charge (owned, to be remembered).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kept {
    pub total: i64,
    pub parts: Vec<(Charge, i64)>,
}

impl Kept {
    fn of(w: super::tax::Withheld) -> Kept {
        Kept { total: w.total, parts: w.parts.into_iter().map(|(c, a)| (c.clone(), a)).collect() }
    }
}

fn withheld_owned(law: Option<&IncomeTaxLaw>, gross: i64, period: i64) -> Kept {
    Kept::of(withheld(law, gross, period))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Owed {
    charge: Charge,
    law: String,
    amount: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Unpaid {
    agreement: String,
    to: String,
    amount: i64,
    withheld: Kept,
    due: i64,
    what: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum CutState {
    Proposed,
    Set,
}

/// A cut of someone's hours that we have made (`Set`) or put to them for their agreement (`Proposed`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Cut {
    agreement: String,
    worker: String,
    full: i64,
    hours_bps: i64,
    paid_bps: i64,
    wage: i64,
    from: i64,
    until: i64,
    since: i64,
    state: CutState,
    reply_by: i64,
}

/// A wage change waiting for the day its paper names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct DueChange {
    at: i64,
    agreement: String,
    wage: i64,
    why: String,
    short: Option<i64>,
    /// A rise held back to the pay run (see `raise`).
    held: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct Stopped {
    since: i64,
    last_due: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Withdrawn {
    agreement: String,
    at: i64,
}

/// Which of an organisation's staff and postings are this office's (several offices of one organisation hire): those
/// in its `role` (`Role`), or those that name it or none (`RoleOrUnnamed`: the staff the world started with).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Own {
    Role,
    RoleOrUnnamed,
}

/// How an office staffs (the options `new Staffing(ctx, me, {...})` took).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StaffingOpts {
    pub period: i64,
    pub notice_days: i64,
    pub workplace: Option<String>,
    pub role: String,
    pub industry: Option<String>,
    /// Most employers do both; an organisation where one office hires and another runs the payroll gives each its half.
    pub hire: bool,
    pub pay: bool,
    pub own: Option<Own>,
    /// For an office that hires and does not pay, the office of its organisation that does: it is sent a payroll notice
    /// of each new starter and each leaver (docs/behaviour/firms.md, "Payroll notices").
    pub payroll: Option<String>,
    /// The line of the organisation's adopted budget this office's posts are paid from: said on its payroll notices.
    pub line: Option<String>,
    /// For an office that pays and does not hire, how long it waits for the hiring office's notice of a new starter
    /// before it sets the wage up from the agreement on file (seconds; absent: it acts on the agreement at once).
    pub notice_wait: Option<i64>,
    /// Of the jobs this employer fills, the share it puts on its payroll returns (absent: all). A job it does not
    /// register is paid whole (docs/behaviour/firms.md, "Jobs an employer does not register").
    pub registered_bps: Option<i64>,
    /// Work by the day: the share of jobs filled by the day; what a day's work pays at the wage it began with; the days
    /// of the week it works; the working days of the world's week, over which a day's pay is reckoned as a year's.
    pub casual_bps: Option<i64>,
    pub day_wage: Option<i64>,
    pub work_days: Option<i64>,
    pub week_days: Option<i64>,
    /// Pay that comes short (docs/behaviour/frictions.md, "Pay"): by this share of the pay.
    pub short_by_bps: Option<i64>,
    /// How often the office wakes (seconds; absent: daily): a return falling due before its next look is filed at this one.
    pub wakes: Option<i64>,
}

impl StaffingOpts {
    pub fn new(period: i64, notice_days: i64, role: &str) -> Self {
        StaffingOpts {
            period,
            notice_days,
            workplace: None,
            role: role.into(),
            industry: None,
            hire: true,
            pay: true,
            own: None,
            payroll: None,
            line: None,
            notice_wait: None,
            registered_bps: None,
            casual_bps: None,
            day_wage: None,
            work_days: None,
            week_days: None,
            short_by_bps: None,
            wakes: None,
        }
    }
}

/// What the module wants of the routine: the headcount and wage to aim for, and whether it may post a job.
#[derive(Debug, Clone, Default)]
pub struct Want {
    pub target: i64,
    pub wage: i64,
    pub can_post: bool,
    pub why: Option<String>,
    /// `Some(false)`: the office has been directed not to recruit (docs/behaviour/directions.md).
    pub recruit: Option<bool>,
    pub stopped: Option<String>,
    /// Whether there is work today for hands by the day (nothing said: yes).
    pub work: Option<bool>,
}

fn plain(c: Call) -> Line {
    Line { bind: None, call: c }
}
fn bound(r: &str, c: Call) -> Line {
    Line { bind: Some(r.to_string()), call: c }
}
fn step<T>(why: impl Into<String>, calls: Vec<Call>) -> Step<T> {
    because(why, calls)
}
fn step_lines<T>(why: impl Into<String>, lines: Vec<Line>) -> Step<T> {
    let mut s = Step::new(lines);
    s.why = Some(why.into());
    s
}

/// An amount written in a decision or a record (a number, or a decimal string of the smallest unit).
fn amount_of(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

fn parties(a: &Record) -> &[String] {
    crate::papers::agreements::parties_of(a)
}

fn worker_of(a: &Record) -> &str {
    parties(a).get(1).map_or("", String::as_str)
}

fn text_of_agreement(a: &Record) -> &str {
    match &a.body {
        RecordBody::Agreement { terms } => terms.text.as_deref().unwrap_or(""),
        _ => "",
    }
}

/// The notice an agreement gives to the party `who` (seconds), if it says.
fn notice_of(a: &Record, who: &str) -> Option<i64> {
    match &a.body {
        RecordBody::Agreement { terms } => terms.termination.as_ref()?.iter().find(|t| t.party == who).map(|t| t.notice),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Staffing {
    me: String,
    o: StaffingOpts,
    /// agreement -> wage standing order
    orders: BTreeMap<String, String>,
    /// step marker -> agreement
    pending_order: BTreeMap<String, String>,
    /// agreement -> when we replaced its wage order (until the replacement is on the book, or a couple of days pass)
    replacing: BTreeMap<String, i64>,
    handled: BTreeSet<String>,
    /// agreement -> when we gave notice
    pub noticed: BTreeMap<String, i64>,
    /// Whom our bank has told us has died: someone a standing order of ours pays (docs/behaviour/deaths.md).
    bank_says_dead: BTreeSet<String>,
    /// Unique names for standing orders we create.
    n: u64,
    /// What the tax law's charges take from wages: what each wage order withholds a pay; what we've withheld under each
    /// charge and not yet paid over; and when we next pay it over.
    withholds: BTreeMap<String, Kept>,
    pending_withhold: BTreeMap<String, Kept>,
    /// (In the order each charge was first owed: the order its collector is reported to.)
    owed: Vec<Owed>,
    /// return -> agreement -> gross wages paid since our last report under it
    paid_since: BTreeMap<String, BTreeMap<String, i64>>,
    /// return -> the day it next falls due (the law's calendar; this only remembers which we have made)
    return_day: BTreeMap<String, i64>,
    rules: Vec<ReturnRule>,
    law_id: Option<String>,
    /// (In the order made: the order hours are restored in.)
    cuts: Vec<Cut>,
    due: Vec<DueChange>,
    declined: BTreeSet<String>,
    no_cut_until: Option<i64>,
    /// Wages our orders have paid, gross (what they paid, and what they withheld), since we began.
    pub wages_paid: i64,
    /// Pay that's changed since hiring (an enterprise agreement), and pay stopped (a strike: no pay for time on strike).
    gross: BTreeMap<String, i64>,
    stopped: BTreeMap<String, Stopped>,
    /// A standing order we have withdrawn stays on our books (what it pays in that time is booked, with its tax).
    withdrawn: BTreeMap<String, Withdrawn>,
    /// agreement -> the latest pay moment a withdrawn order of it paid
    paid_to: BTreeMap<String, i64>,
    /// When we last let someone go because we could not pay them (from then we take on only with more in hand: the module asks).
    pub cash_layoff_at: Option<i64>,
    /// Redundancy pay owed at the end of a job we ended for redundancy: agreement -> the sum.
    severance: BTreeMap<String, i64>,
    paid_on: BTreeMap<String, i64>,
    wage0: Option<i64>,
    off_books: BTreeSet<String>,
    decided: BTreeSet<String>,
    notes_read: usize,
    notified: BTreeSet<String>,
    confirmed: BTreeSet<String>,
    skim: BTreeMap<String, i64>,
    kept: BTreeMap<String, i64>,
    short_week: Option<i64>,
    failed: Vec<(String, i64)>,
    unpaid: Vec<Unpaid>,
    asked_answered: BTreeSet<String>,
}

impl Staffing {
    pub fn new(me: &str, o: StaffingOpts) -> Self {
        Staffing {
            me: me.to_string(),
            o,
            orders: BTreeMap::new(),
            pending_order: BTreeMap::new(),
            replacing: BTreeMap::new(),
            handled: BTreeSet::new(),
            noticed: BTreeMap::new(),
            bank_says_dead: BTreeSet::new(),
            n: 0,
            withholds: BTreeMap::new(),
            pending_withhold: BTreeMap::new(),
            owed: vec![],
            paid_since: BTreeMap::new(),
            return_day: BTreeMap::new(),
            rules: vec![return_rest()],
            law_id: None,
            cuts: vec![],
            due: vec![],
            declined: BTreeSet::new(),
            no_cut_until: None,
            wages_paid: 0,
            gross: BTreeMap::new(),
            stopped: BTreeMap::new(),
            withdrawn: BTreeMap::new(),
            paid_to: BTreeMap::new(),
            cash_layoff_at: None,
            severance: BTreeMap::new(),
            paid_on: BTreeMap::new(),
            wage0: None,
            off_books: BTreeSet::new(),
            decided: BTreeSet::new(),
            notes_read: 0,
            notified: BTreeSet::new(),
            confirmed: BTreeSet::new(),
            skim: BTreeMap::new(),
            kept: BTreeMap::new(),
            short_week: None,
            failed: vec![],
            unpaid: vec![],
            asked_answered: BTreeSet::new(),
        }
    }

    pub fn opts(&self) -> &StaffingOpts {
        &self.o
    }

    fn owe(&mut self, law: Option<&str>, w: &Kept, agreement: Option<&str>, gross: i64) {
        for (charge, amount) in &w.parts {
            match self.owed.iter_mut().find(|o| o.charge.id == charge.id) {
                Some(o) => {
                    o.charge = charge.clone();
                    if let Some(l) = law {
                        o.law = l.to_string();
                    }
                    o.amount += amount;
                }
                None => self.owed.push(Owed { charge: charge.clone(), law: law.unwrap_or("").to_string(), amount: *amount }),
            }
        }
        if let (Some(agreement), true) = (agreement, gross > 0) {
            for r in &self.rules {
                if r.charges.is_none() || w.parts.iter().any(|(c, _)| r.charges.as_ref().unwrap().contains(&c.id)) {
                    *self.paid_since.entry(r.id.clone()).or_default().entry(agreement.to_string()).or_insert(0) += gross;
                }
            }
        }
    }

    fn day_wage(&self, wage: i64) -> i64 {
        // Math.max(1, Math.round(day_wage * wage / max(1, wage0 ?? wage))), half up.
        let (num, den) = (self.o.day_wage.unwrap_or(0) * wage, self.wage0.unwrap_or(wage).max(1));
        ((2 * num + den).div_euclid(2 * den)).max(1)
    }

    /// Whether the job we post next is one by the day (the share the world gives; drawn for each posting).
    fn posts_by_the_day(&self, cx: &mut Cx) -> bool {
        let share = self.o.casual_bps.unwrap_or(0);
        share > 0 && self.o.day_wage.unwrap_or(0) > 0 && (cx.rng("by-the-day").below(10_000) as i64) < share
    }

    /// Where those we take on will work from now (premises taken on a lease: docs/behaviour/leasing.md).
    pub fn set_workplace(&mut self, space: &str) {
        self.o.workplace = Some(space.to_string());
    }

    /// A posting: for a job on a standing wage, or (the employer's share of them) for work by the day.
    /// `openings`: how many hands it is for (one posting stays up until they are all hired: docs/design/market-realism.md, ME-2).
    fn posting(&self, cx: &mut Cx, wage: i64, account: &str, by_day: Option<bool>, openings: i64) -> Call {
        let by_day = match by_day {
            Some(b) => b,
            None => self.posts_by_the_day(cx),
        };
        let mut data = serde_json::Map::new();
        data.insert("openings".into(), json!(openings.max(1)));
        if by_day {
            data.insert("wage".into(), json!(self.day_wage(wage)));
            data.insert("period".into(), json!(DAY));
            data.insert("by_the_day".into(), json!(true));
        } else {
            data.insert("wage".into(), json!(wage));
            data.insert("period".into(), json!(self.o.period));
        }
        data.insert("role".into(), json!(self.o.role));
        if let Some(i) = &self.o.industry {
            data.insert("industry".into(), json!(i));
        }
        if let Some(w) = &self.o.workplace {
            data.insert("workplace".into(), json!(structure_of(w)));
            data.insert("space".into(), json!(w));
        }
        if by_day {
            let day = self.day_wage(wage);
            let mut commitments = vec![json!({ "who": self.me, "does": { "outcome": { "money": money_outcome(account, day, "a day's work") } }, "every": DAY })];
            if let Some(w) = &self.o.workplace {
                commitments.push(json!({ "who": "taker", "does": { "outcome": { "occupancy": { "in": w } } } }));
            }
            let offer = json!({ "by": self.me, "to": { "min_age_years": 18 }, "take_up": "apply", "available": openings.max(1), "terms": { "template": "employment", "commitments": commitments,
                "termination": [{ "party": self.me, "notice": NO_NOTICE }, { "party": "taker", "notice": NO_NOTICE }] } });
            return say(
                "job_posting",
                &format!("Hiring by the day: {} for each day worked.", money_words(day, &cx.ctx.world)),
                Say { data: Some(Value::Object(data)), extra: vec![("offer", offer)], ..Default::default() },
            );
        }
        say(
            "job_posting",
            &format!("Hiring: {} every {} days.", money_words(wage, &cx.ctx.world), self.o.period / DAY),
            Say { data: Some(Value::Object(data)), extra: vec![("offer", { let mut of = self.job_offer(wage, account); of["available"] = json!(openings.max(1)); of })], ..Default::default() },
        )
    }

    /// A posting's offer (docs/design/ai-citizens.md 2a): the terms of the employment it's for, in the typed vocabulary.
    pub fn job_offer(&self, wage: i64, account: &str) -> Value {
        let mut commitments = vec![json!({ "who": self.me, "does": { "outcome": { "money": money_outcome(account, wage, "wages") } }, "every": self.o.period })];
        if let Some(w) = &self.o.workplace {
            commitments.push(json!({ "who": "taker", "does": { "outcome": { "occupancy": { "in": w } } } }));
        }
        let mut terms = json!({ "template": "employment", "commitments": commitments });
        // (Notice, where the employer says what it is.)
        if self.o.notice_days > 0 {
            terms["termination"] = json!([{ "party": self.me, "notice": self.o.notice_days * DAY }, { "party": "taker", "notice": self.o.notice_days * DAY }]);
        }
        json!({ "by": self.me, "to": { "min_age_years": 18 }, "take_up": "apply", "available": 1, "terms": terms })
    }
}

/// A money outcome as an offer writes it: from the account where the office says, the amount as text.
fn money_outcome(account: &str, amount: i64, for_: &str) -> Value {
    let mut m = serde_json::Map::new();
    if !account.is_empty() {
        m.insert("from".into(), json!(account));
    }
    m.insert("amount".into(), json!(amount.to_string()));
    m.insert("for".into(), json!(for_));
    Value::Object(m)
}

/// The role an employment agreement's words name: "... works for X as <role> for <the wage> every N days.", with
/// "First pay ..." after it or not (the TS regex `/ as (.+?) for (?:(?! for ).)+ every \d+ days\.(?: First pay .*)?$/`).
fn named_role(text: &str) -> Option<String> {
    fn tail_ok(s: &str) -> bool {
        let Some(rest) = s.strip_prefix(" every ") else { return false };
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        let Some(rest) = rest[digits..].strip_prefix(" days.").filter(|_| digits > 0) else { return false };
        rest.is_empty() || (rest.starts_with(" First pay ") && !rest.contains('\n'))
    }
    if text.contains('\n') {
        return None;
    }
    let mut from = 0;
    while let Some(i) = text[from..].find(" as ").map(|i| i + from) {
        let after = i + 4;
        let mut j = after;
        // The role is the shortest (at least one character) up to a " for " from which the rest matches.
        while let Some(k) = text[j..].find(" for ").map(|k| k + j) {
            if k > after {
                let rem = &text[k + 5..];
                let ok = rem.match_indices(" every ").any(|(m, _)| m >= 1 && !rem[..m].contains(" for ") && tail_ok(&rem[m..]));
                if ok {
                    return Some(text[after..k].to_string());
                }
            }
            j = k + 1;
        }
        from = i + 1;
    }
    None
}

impl Staffing {
    /// The role an employment agreement names, if any; one that names none and was made on an advertisement is for the
    /// post advertised (an offer in the office-holder's own words: docs/behaviour/firms.md, "An offer made on an
    /// advertisement").
    fn role_of(&self, a: &Record, book: &Book) -> Option<String> {
        if let Some(r) = named_role(text_of_agreement(a)) {
            return Some(r);
        }
        advertised_job(book, a).and_then(|j| data(j).get("role").and_then(Value::as_str).filter(|r| !r.is_empty()).map(String::from))
    }

    fn ours(&self, role: Option<&str>) -> bool {
        match self.o.own {
            None => true,
            Some(own) => role == Some(self.o.role.as_str()) || (own == Own::RoleOrUnnamed && role.is_none()),
        }
    }

    /// Whether a job is one we do not register (decided once, when its wages start; a note of ours says so after).
    fn read_notes(&mut self, book: &Book) {
        let notes: Vec<_> = book.all("off_books").collect();
        while self.notes_read < notes.len() {
            let r = notes[self.notes_read];
            if r.speaks_for.as_deref() == Some(self.me.as_str()) {
                if let Some(a) = data(r).get("agreement").and_then(Value::as_str) {
                    self.off_books.insert(a.to_string());
                }
            }
            self.notes_read += 1;
        }
    }

    fn unregistered(&mut self, book: &Book, cx: &mut Cx, agreement: &str) -> (bool, Option<Call>) {
        self.read_notes(book);
        if self.off_books.contains(agreement) {
            return (true, None);
        }
        let share = self.o.registered_bps.unwrap_or(10_000);
        if share >= 10_000 || self.decided.contains(agreement) {
            return (false, None);
        }
        self.decided.insert(agreement.to_string());
        if (cx.rng(&format!("registers-{agreement}")).below(10_000) as i64) < share {
            return (false, None);
        }
        self.off_books.insert(agreement.to_string());
        let note = say(
            "off_books",
            &format!("Not on our payroll returns: {agreement}."),
            Say { visible: Some(Visible::Only(vec![self.me.clone()])), basis: Some(agreement.to_string()), data: Some(json!({ "agreement": agreement })), ..Default::default() },
        );
        (true, Some(note))
    }

    /// Takes in what the observation shows: the bank's word of a payee who has died, a wage our account could not
    /// cover, the wage orders our steps made, and the wages they paid (what each withheld is now owed to the collector).
    pub fn absorb(&mut self, pic: &Picture) {
        for m in &pic.inbox {
            if let Some(who) = payee_died::who(&m.text) {
                self.bank_says_dead.insert(who.to_string());
            }
            // (A wage our account could not cover: the bank says so, naming our order. It is still owed: the ledger.)
            if let (Some(re), true) = (&m.re, payment_failed::is(&m.text).is_some()) {
                self.failed.push((re.clone(), pic.t));
            }
        }
        for x in &pic.outcomes {
            for (r, id) in x.created.iter().flatten() {
                if let Some(agreement) = self.pending_order.remove(r) {
                    self.orders.insert(agreement.clone(), id.clone());
                    self.replacing.remove(&agreement);
                    if let Some(w) = self.pending_withhold.remove(r) {
                        self.withholds.insert(id.clone(), w);
                    }
                } else {
                    self.pending_withhold.remove(r);
                }
            }
        }
        // Wages paid by our standing orders: what each withheld is now owed to the collector.
        let ours: BTreeMap<String, String> = self.orders.iter().map(|(a, o)| (o.clone(), a.clone())).chain(self.withdrawn.iter().map(|(o, w)| (o.clone(), w.agreement.clone()))).collect();
        for tx in pic.transactions() {
            let Some(order) = tx.per_instruction.as_ref().filter(|o| ours.contains_key(*o)) else { continue };
            // (A withdrawn order pays only inside the act that withdraws it, which waits a couple of days at most: a
            // payment later than that is not its.)
            let gone = self.withdrawn.get(order);
            if gone.is_some_and(|g| tx.t > g.at + 2 * DAY) {
                continue;
            }
            let agreement = ours[order].clone();
            if gone.is_some() {
                let e = self.paid_to.entry(agreement.clone()).or_insert(0);
                *e = (*e).max(tx.t);
            }
            let w = self.withholds.get(order).cloned().unwrap_or_default();
            let paid = cents(tx.amount);
            if !self.off_books.contains(&agreement) {
                let law = self.law_id.clone();
                self.owe(law.as_deref(), &w, Some(&agreement), paid + w.total);
            }
            self.wages_paid += paid + w.total;
            if let Some(short) = self.skim.get(&agreement).copied() {
                *self.kept.entry(agreement).or_insert(0) += short;
            }
        }
    }

    // ---- the staff as the books show it

    /// Employment agreements of ours (the offers and the signed), oldest first as filed.
    pub(crate) fn contracts<'a>(&self, book: &'a Book) -> Vec<&'a Arc<Record>> {
        book.of_type("agreement")
            .filter(|r| {
                let RecordBody::Agreement { terms } = &r.body else { return false };
                terms.template.as_deref() == Some("employment") && terms.parties.first().map(String::as_str) == Some(self.me.as_str()) && self.ours(self.role_of(r, book).as_deref())
            })
            .collect()
    }

    fn end_of(&self, book: &Book, a: &Record) -> i64 {
        book.ends_at(&a.id).unwrap_or(i64::MAX)
    }

    /// Employment agreements in force and not yet ended, oldest signed first.
    pub fn staff<'a>(&self, book: &'a Book, t: i64) -> Vec<&'a Arc<Record>> {
        let mut staff: Vec<&Arc<Record>> = self.contracts(book).into_iter().filter(|a| book.in_force(&a.id) && t < self.end_of(book, a)).collect();
        staff.sort_by_key(|a| book.signed_at(&a.id).unwrap_or(i64::MAX));
        staff
    }

    /// The people of our staff.
    pub fn workers(&self, book: &Book, t: i64) -> Vec<String> {
        self.staff(book, t).iter().map(|a| worker_of(a).to_string()).collect()
    }

    /// The people we employ, in force and not yet ended, in another role than the one this office staffs (named in their
    /// agreement or the job advertised): the head of an office, who is not one of the staff it takes on.
    pub fn in_role(&self, book: &Book, t: i64, role: &str) -> Vec<String> {
        book.of_type("agreement")
            .filter(|r| {
                let RecordBody::Agreement { terms } = &r.body else { return false };
                terms.template.as_deref() == Some("employment") && terms.parties.first().map(String::as_str) == Some(self.me.as_str())
            })
            .filter(|a| self.role_of(a, book).as_deref() == Some(role) && book.in_force(&a.id) && t < self.end_of(book, a))
            .map(|a| worker_of(a).to_string())
            .collect()
    }

    /// Those of our staff we know to have died: by the registry's entry or by our bank's word (docs/behaviour/deaths.md).
    pub fn known_dead(&self, book: &Book, t: i64) -> Vec<String> {
        let dead: BTreeSet<String> = book.all("death_registration").filter_map(|r| data(r).get("deceased").and_then(Value::as_str).map(String::from)).chain(self.bank_says_dead.iter().cloned()).collect();
        let mut out: Vec<String> = vec![];
        let noticed: Vec<String> = self.contracts(book).into_iter().filter(|a| self.noticed.contains_key(&a.id)).map(|a| worker_of(a).to_string()).collect();
        for w in self.staff(book, t).iter().map(|a| worker_of(a).to_string()).chain(noticed) {
            if dead.contains(&w) && !out.contains(&w) {
                out.push(w);
            }
        }
        out
    }

    /// Whether we have been told this person has died: by the registry's entry, or by our bank's word.
    pub fn told_dead(&self, book: &Book, who: &str) -> bool {
        self.bank_says_dead.contains(who) || book.all("death_registration").any(|r| data(r).get("deceased").and_then(Value::as_str) == Some(who))
    }

    /// Our staff, as we have them (truth audits).
    pub fn beliefs(&self, book: &Book) -> Vec<Belief> {
        // (An office that keeps only its own role's staff doesn't hold its organisation's whole list: it says nothing of it.)
        if self.o.own.is_some() {
            return vec![];
        }
        vec![Belief::Held { party: self.me.clone(), template: "employment".into(), agreements: self.staff(book, book.now).iter().map(|a| a.id.clone()).collect() }]
    }

    /// Offers we've made in the last month that the worker hasn't signed yet.
    pub fn offered<'a>(&self, book: &'a Book, t: i64) -> Vec<&'a Arc<Record>> {
        self.contracts(book).into_iter().filter(|a| !book.concluded(&a.id) && !book.signed_by(&a.id, worker_of(a)) && t - a.at < MONTH).collect()
    }

    /// What a direction not to recruit does and does not do, in the office's words (docs/behaviour/directions.md): no
    /// post is advertised and no new offer made; an offer already out is the office's word already given, and stands if
    /// the worker signs it.
    pub fn not_recruiting(&self, book: &Book, t: i64) -> String {
        let out = self.offered(book, t);
        let tail = if out.is_empty() {
            " It has no offer out that is not yet signed.".to_string()
        } else {
            format!(
                " {} it had already made {} not yet signed by the worker ({}): a direction ends no offer already made, and {}.",
                if out.len() == 1 { "One offer".to_string() } else { format!("{} offers", out.len()) },
                if out.len() == 1 { "is" } else { "are" },
                out.iter().map(|a| format!("{}, to {}", a.id, worker_of(a))).collect::<Vec<_>>().join("; "),
                if out.len() == 1 { "it stands if the worker signs it" } else { "each stands if the worker signs it" }
            )
        };
        format!("The office advertises no post, takes down the advertisements it has out and makes no new offer of employment.{tail}")
    }

    /// Our standing job postings.
    pub fn postings<'a>(&self, book: &'a Book) -> Vec<&'a Arc<Record>> {
        book.open("job_posting").filter(|j| j.speaks_for.as_deref() == Some(self.me.as_str()) && self.ours(data(j).get("role").and_then(Value::as_str))).collect()
    }

    /// How many of our staff are staying: those we haven't given notice. (Someone working out their notice is still on
    /// the staff and still paid.)
    pub fn staying(&self, book: &Book, t: i64) -> usize {
        self.staff(book, t).iter().filter(|a| !self.noticed.contains_key(&a.id)).count()
    }

    /// The employment of a person as our own agreements show it: with us now, ended (and on what day), or no record.
    fn employment(&self, book: &Book, t: i64, who: &str) -> (bool, bool, Option<i64>) {
        let mine: Vec<_> = self.contracts(book).into_iter().filter(|a| worker_of(a) == who && book.signed_by(&a.id, who)).collect();
        if mine.is_empty() {
            return (false, false, None);
        }
        if mine.iter().any(|a| book.in_force(&a.id) && t < self.end_of(book, a)) {
            return (true, true, None);
        }
        let last = mine.iter().map(|a| t.min(self.end_of(book, a))).max();
        (false, true, last)
    }

    /// An office that waits to decide a claim of one of our people asks us to confirm it (the law's, foundations F8):
    /// we answer from our own books, once, as an employer does a request from the payments office for a separation
    /// certificate.
    fn confirm<T>(&mut self, book: &Book, t: i64) -> Vec<Step<T>> {
        let mut steps = vec![];
        let mut asked: Vec<&Arc<Record>> = book
            .open("confirmation_request")
            .filter(|x| crate::common::addressed_to(x).contains(&self.me) && !self.confirmed.contains(&x.id))
            .collect();
        asked.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
        for r in asked {
            self.confirmed.insert(r.id.clone());
            let d = data(r);
            let who = d.get("about").and_then(Value::as_str).unwrap_or("");
            let Some(office) = r.speaks_for.as_deref().filter(|_| !who.is_empty()) else { continue };
            let Some(claim) = d.get("claim").and_then(Value::as_str) else { continue };
            let (employed, known, ended_on) = self.employment(book, t, who);
            let words = if employed {
                format!("{who} is in our employment")
            } else if known {
                format!("{who}'s employment with us ended on day {}", ended_on.unwrap_or(t).div_euclid(DAY))
            } else {
                format!("we have no record of {who} in our employment")
            };
            let mut payload = json!({ "claim": claim, "need": d.get("need").cloned().unwrap_or(Value::Null), "request": r.id, "subject": who, "employed": employed, "known": known });
            if let Some(e) = ended_on {
                payload["ended_on"] = json!(e);
            }
            steps.push(step(
                format!("{office} asks us to confirm the employment of {who} for their claim {claim}: answering from our books."),
                vec![say(
                    "confirmation_answer",
                    &format!("Answer to your request {}: {words}.", r.id),
                    Say { to: Some(vec![office.to_string()]), visible: Some(Visible::Only(vec![office.to_string(), self.me.clone()])), basis: Some(r.id.clone()), data: Some(payload), ..Default::default() },
                )],
            ));
        }
        steps
    }

    /// The account a worker's wages go to, as their agreement says (or their application).
    pub fn payee(&self, book: &Book, a: &Record) -> Option<String> {
        let worker = worker_of(a);
        if let Some(m) = commitment_of(a, &self.me).0.and_then(|o| o.money) {
            return Some(m.to);
        }
        book.all("job_application")
            .find(|r| r.speaks_for.as_deref() == Some(worker))
            .and_then(|r| data(r).get("account").and_then(Value::as_str).map(String::from))
    }

    /// The wage an agreement pays now (after any rise).
    pub fn wage_of(&self, a: &Record) -> i64 {
        self.gross.get(&a.id).copied().unwrap_or_else(|| job_terms(a, worker_of(a), None).wage)
    }
}

fn balance_of(pic: &Picture, account: &str) -> Option<i64> {
    pic.accounts().find(|x| x.account == account).map(|x| cents(x.balance))
}

/// Who is at a space, as the surroundings the actor looked at show (those it can see there).
fn occupants_of(pic: &Picture, space: &str) -> BTreeSet<String> {
    let structure = structure_of(space);
    let mut here = BTreeSet::new();
    for seen in pic.channels.values() {
        if let oikos_sight::Seen::Sites { cells, .. } = seen {
            for c in cells.iter() {
                if let Some(s) = c.structure.as_ref().filter(|s| s.structure == structure) {
                    for sp in s.spaces.iter().filter(|sp| sp.space == space) {
                        here.extend(sp.occupants.iter().flatten().cloned());
                    }
                }
            }
        }
    }
    here
}

impl Staffing {
    /// Standing orders already on the book for our staff (genesis orders, and any made before we began): what each
    /// withholds, the agreed wage less what it pays, charge by charge as the law reckons it where that comes to the same.
    fn adopt_orders(&mut self, book: &Book, law: Option<&IncomeTaxLaw>, t: i64) {
        let me = self.me.clone();
        for r in book.open("request") {
            let d = data(r);
            if r.speaks_for.as_deref() != Some(me.as_str()) || !d.get("every").is_some_and(truthy) {
                continue;
            }
            for b in crate::common::bases_of(r) {
                // (Not one whose replacement is made but not yet on the book: the act waits for its performer's time.)
                if self.orders.contains_key(b) || self.is_replacing(b, t) {
                    continue;
                }
                self.orders.insert(b.clone(), r.id.clone());
                let gross = match book.get(b) {
                    Some(a) if matches!(a.body, RecordBody::Agreement { .. }) => commitment_of(a, &me).0.and_then(|o| o.money).map_or(0, |m| m.amount),
                    _ => 0,
                };
                let net = amount_of(d.get("outcome").and_then(|o| o.get("money")).and_then(|m| m.get("amount")));
                if gross > net && net > 0 {
                    let every = d.get("every").and_then(Value::as_i64).filter(|e| *e != 0).unwrap_or(self.o.period);
                    let w = withheld_owned(law, gross, every);
                    let kept = if w.total == gross - net {
                        w
                    } else {
                        Kept { total: gross - net, parts: law.and_then(|l| l.charges.first()).map(|c| vec![(c.clone(), gross - net)]).unwrap_or_default() }
                    };
                    self.withholds.insert(r.id.clone(), kept);
                }
            }
        }
    }

    /// A worker who has died: stop the wages, and end the employment on record. We know of it when we are told: by the
    /// registry's entry, if whoever reported the death named us, or by our bank, when a wage is next paid into the
    /// account of someone it has been told has died (nobody is shown the register: docs/behaviour/deaths.md).
    fn stop_dead_wages<T>(&mut self, book: &Book, t: i64) -> Vec<Step<T>> {
        let mut died: Vec<String> = vec![];
        for who in book.all("death_registration").filter_map(|r| data(r).get("deceased").and_then(Value::as_str).map(String::from)).chain(self.bank_says_dead.iter().cloned()) {
            if !died.contains(&who) {
                died.push(who);
            }
        }
        let staff = self.staff(book, t);
        let mut steps = vec![];
        for who in died {
            let Some(a) = staff.iter().find(|x| worker_of(x) == who) else { continue };
            // (Someone already under notice, let go or leaving, who dies while it runs: their wages stop now all the
            // same. Until 2026-10-09 they were paid to the end of the notice.)
            let under_notice = self.noticed.contains_key(&a.id);
            if under_notice && !self.orders.contains_key(&a.id) {
                continue;
            }
            self.noticed.insert(a.id.clone(), t);
            // (No second notice where the office that employed them has already ended the employment on record.)
            let ended = book.notices(&a.id).any(|n| n.party == self.me);
            let mut calls = vec![];
            if !(under_notice || ended) {
                calls.push(notice(&a.id, "The employee has died."));
            }
            let mut s: Step<T> = step(format!("{who}, who worked for us, has died: stopping their wages."), calls);
            if self.orders.contains_key(&a.id) {
                let c = self.retire(&a.id, "The employee has died; stop wages.", t);
                s.lines.push(plain(c));
            }
            steps.push(s);
        }
        steps
    }

    /// Only what keeps a dead person off the payroll, for whoever is still acting for the firm when the post that runs
    /// its payroll has fallen vacant (an owner's appointer: `body.payroll`): the standing orders on the book are taken
    /// up, the bank's word of a payee who has died read, and their wages stopped and their employment ended on record.
    pub fn stop_the_dead<T>(&mut self, pic: &Picture, book: &Book) -> Vec<Step<T>> {
        let law = income_tax_law(book);
        self.law_id = law.as_ref().map(|l| l.id.clone()).or(self.law_id.take());
        self.adopt_orders(book, law.as_ref(), pic.t);
        let mut steps = self.stop_dead_wages(book, pic.t);
        let t = pic.t;
        let contracts = self.contracts(book);
        for a in contracts {
            if book.concluded(&a.id) && t >= self.end_of(book, a) && self.orders.contains_key(&a.id) {
                let c = self.retire(&a.id, "Employment ended; stop wages.", t);
                steps.push(step("Employment has ended: stopping the wages.", vec![c]));
            }
        }
        steps
    }

    /// The routine: start wages for new hires and stop them for the dead and the departed; offer each posting's job to
    /// one applicant at random (at the posting's wage); post a job at `want.wage` while short of `want.target` and
    /// `want.can_post`. `recruit: Some(false)`: the office has been directed not to recruit: it advertises no post,
    /// takes its standing advertisements down (saying why: `stopped`), and makes no offer to an applicant, while that
    /// stands. Those it employs, their pay and their notice go on as they were.
    pub fn routine<T>(&mut self, pic: &Picture, book: &Book, cx: &mut Cx, account: &str, want: &Want) -> Vec<Step<T>> {
        let t = pic.t;
        let me = self.me.clone();
        let world = cx.ctx.world.clone();
        let usd = |n: i64| money_words(n, &world);
        let date = |at: i64| when_words(at, &world);
        let law = income_tax_law(book);
        self.law_id = law.as_ref().map(|l| l.id.clone()).or(self.law_id.take());
        self.read_notes(book);
        self.adopt_orders(book, law.as_ref(), t);
        let contracts = self.contracts(book);
        let staff = self.staff(book, t);
        let offered = self.offered(book, t);
        let mut steps: Vec<Step<T>> = vec![];
        let mut offers_now = 0usize;
        let does_pay = self.o.pay;
        // An office that waits to decide a claim of one of our people asks us to confirm it.
        if does_pay {
            steps.extend(self.confirm(book, t));
        }
        // (Directed not to recruit: its advertisements come down, and nothing below that hires is done.)
        let recruiting = want.recruit != Some(false);
        let does_hire = self.o.hire && recruiting;
        if !recruiting && self.o.hire {
            let up = self.postings(book);
            if !up.is_empty() {
                steps.push(step(
                    want.stopped.clone().unwrap_or_else(|| "Directed not to recruit: taking our advertisements down.".into()),
                    up.iter().map(|j| withdraw(&j.id, Some("Withdrawn: recruiting is stopped by direction."))).collect(),
                ));
            }
        }

        // Newly signed: start paying wages by standing order, at the wage agreed less what the tax law's charges say to
        // withhold. (A payroll that another office hires for acts on that office's notice of a new starter, and pays
        // from the first pay day it gives. With no notice after `notice_wait`, it sets the wage up from the agreement
        // on file: docs/behaviour/firms.md, "Payroll notices".)
        let starters: Vec<&Arc<Record>> = if self.o.notice_wait.is_some() {
            book.open("payroll_notice").filter(|n| n.speaks_for.as_deref() == Some(me.as_str()) && data(n).get("notice").and_then(Value::as_str) == Some("starter")).collect()
        } else {
            vec![]
        };
        for a in if does_pay { staff.clone() } else { vec![] } {
            // (Not a job we've given notice on: a worker who died has their order withdrawn, and isn't a new hire.)
            if self.orders.contains_key(&a.id) || self.stopped.contains_key(&a.id) || self.noticed.contains_key(&a.id) || self.pending_order.values().any(|x| *x == a.id) {
                continue;
            }
            if by_the_day(a) {
                continue; // (paid for each day worked, below: no standing order)
            }
            let worker = worker_of(a).to_string();
            let mut pays = job_terms(a, &worker, None);
            pays.wage = self.gross.get(&a.id).copied().unwrap_or(pays.wage);
            let told = starters.iter().find(|n| data(n).get("agreement").and_then(Value::as_str) == Some(a.id.as_str())).copied();
            let signed = book.signed_at(&a.id).unwrap_or(a.at);
            if let Some(wait) = self.o.notice_wait {
                if told.is_none() && t - signed < wait {
                    continue;
                }
            }
            let to = commitment_of(a, &me)
                .0
                .and_then(|o| o.money)
                .map(|m| m.to)
                .or_else(|| told.and_then(|n| data(n).get("account").and_then(Value::as_str).map(String::from)))
                .or_else(|| book.all("job_application").find(|r| r.speaks_for.as_deref() == Some(worker.as_str())).and_then(|r| data(r).get("account").and_then(Value::as_str).map(String::from)));
            let Some(to) = to else { continue };
            let reference = format!("wo{}", self.n);
            self.n += 1;
            self.pending_order.insert(reference.clone(), a.id.clone());
            // (A job we do not register is paid whole: nothing withheld, and our returns will not name it.)
            let (off, note) = self.unregistered(book, cx, &a.id);
            let w = if off { Kept::default() } else { withheld_owned(law.as_ref(), pays.wage, pays.period) };
            let tax = w.total;
            if tax > 0 {
                self.pending_withhold.insert(reference.clone(), w);
            }
            // (The first pay day: the notice's; with none, the agreement's; for an employer that hires and pays itself,
            // a pay period from now, as it has always been.)
            let first_pay = self.o.notice_wait.map(|_| told.and_then(|n| data(n).get("first_pay").and_then(Value::as_i64)).unwrap_or(signed + pays.period));
            let first = match first_pay {
                None => pays.period,
                Some(f) => (f - t).max(0),
            };
            let on = if self.o.notice_wait.is_none() {
                "A new hire has signed".to_string()
            } else if let Some(n) = told {
                format!("Payroll notice {}: a new starter, first pay day {}", n.id, date(first_pay.unwrap()))
            } else {
                format!("A new starter's agreement ({}) is on file and no payroll notice has come for it: setting the wage up from the agreement, first pay day {}", a.id, date(first_pay.unwrap()))
            };
            let line = told.and_then(|n| data(n).get("line").and_then(Value::as_str).map(String::from));
            let wage_call = |amount: i64, cx: &Cx| {
                pay(&to, amount, Pay { from: Some(account.to_string()), every: Some(pays.period), first: Some(first), basis: Some(a.id.clone()), for_: Some(format!("Wages for {worker}.")), line: line.clone(), ..Default::default() }, cx)
            };
            if off {
                let mut lines = vec![bound(&reference, wage_call(pays.wage, cx))];
                lines.extend(note.map(plain));
                steps.push(step_lines(format!("{on}: starting their wages by standing order, whole. This job is not going on our payroll returns."), lines));
                continue;
            }
            let why = if tax > 0 {
                format!("{on}: starting their wages by standing order, {} after the {} of income tax the law says to withhold.", usd(pays.wage - tax), usd(tax))
            } else {
                format!("{on}: starting their wages by standing order.")
            };
            steps.push(step_lines(why, vec![bound(&reference, wage_call(pays.wage - tax, cx))]));
        }

        // An office that hires and does not pay tells the office that does (docs/behaviour/firms.md, "Payroll
        // notices"): of each new starter once both have signed, and of each leaver once the employment has an end. Each
        // once, by the office's own file: whoever holds the office carries on from its papers.
        if let (Some(payroll), false, true) = (self.o.payroll.clone(), does_pay, self.o.hire) {
            let filed: Vec<&Arc<Record>> = book.open("payroll_notice").filter(|n| n.speaks_for.as_deref() == Some(me.as_str())).collect();
            let sent = |s: &Staffing, what: &str, a: &Record| {
                s.notified.contains(&format!("{what}:{}", a.id)) || filed.iter().any(|n| data(n).get("notice").and_then(Value::as_str) == Some(what) && data(n).get("agreement").and_then(Value::as_str) == Some(a.id.as_str()))
            };
            for a in &staff {
                let Some(signed) = book.signed_at(&a.id) else { continue };
                // (Those the organisation started with were on its payroll before the year began.)
                if a.author == "genesis" || sent(self, "starter", a) {
                    continue;
                }
                let worker = worker_of(a).to_string();
                let pays = job_terms(a, &worker, None);
                let Some(to) = self.payee(book, a) else { continue };
                self.notified.insert(format!("starter:{}", a.id));
                let first_pay = signed + pays.period;
                let post = self.role_of(a, book).unwrap_or_else(|| self.o.role.clone());
                // (Which line of the budget the post is on: the hiring office took the worker on within its own line,
                // and the office that pays must not have to guess it.)
                let on_line = self.o.line.as_ref().map_or(String::new(), |l| format!(" The post is one of those the {l} line of the adopted budget pays for: the wage is on that line."));
                let every = duration_words(pays.period);
                let mut payload = json!({ "notice": "starter", "office": payroll, "employee": worker, "post": post, "agreement": a.id, "wage": pays.wage.to_string(), "period": pays.period, "first_pay": first_pay, "account": to });
                if let Some(l) = &self.o.line {
                    payload["line"] = json!(l);
                }
                steps.push(step(
                    format!("{worker} has signed and started: sending the {payroll} office a payroll notice (who, the post, the pay, the first pay day, the agreement), for it to set the wage up."),
                    vec![
                        say(
                            "payroll_notice",
                            &format!("Payroll notice, new starter: {worker}, {post}, under employment agreement {}. Pay: {} every {every} before tax, into {to}; first pay day {}, then every {every}.{on_line} For the {payroll} office: the wage payment is to be set up from that day.", a.id, usd(pays.wage), date(first_pay)),
                            Say { to: Some(vec![me.clone()]), visible: Some(Visible::Only(vec![me.clone()])), basis: Some(a.id.clone()), data: Some(payload), ..Default::default() },
                        ),
                        // (And put in front of the payroll office: a paper on the organisation's own file is not news to
                        // anyone in it, so the notice goes to the office's post as a letter naming the agreement.)
                        message(
                            &[payroll.clone()],
                            &format!("{PAYROLL_NOTE}new starter: {worker}, {post}, under employment agreement {}. Pay: {} every {every} before tax, into {to}; first pay day {}, then every {every}.{on_line} The notice is on the organisation's file. The wage payment is to be set up from that day: a payment from the organisation's account to {to} every {every}, first on {}, citing {}, of the pay less what the tax law says to withhold.", a.id, usd(pays.wage), date(first_pay), date(first_pay), a.id),
                            Some(&a.id),
                        ),
                    ],
                ));
            }
            let deaths: BTreeSet<String> = book.all("death_registration").filter_map(|r| data(r).get("deceased").and_then(Value::as_str).map(String::from)).collect();
            for a in &contracts {
                if !book.concluded(&a.id) || sent(self, "leaver", a) {
                    continue;
                }
                let worker = worker_of(a).to_string();
                let died = deaths.contains(&worker) && book.in_force(&a.id) && t < self.end_of(book, a);
                let Some(end) = (if died { Some(t) } else { book.ends_at(&a.id) }) else { continue };
                self.notified.insert(format!("leaver:{}", a.id));
                let reason = if died { "died" } else { "notice" };
                let post = self.role_of(a, book).unwrap_or_else(|| self.o.role.clone());
                // (A member of staff who has died: the employment is ended on record by the office that employed them,
                // if nobody of the organisation has yet.)
                let mut calls = vec![];
                if died && !book.notices(&a.id).any(|n| n.party == me) {
                    calls.push(notice(&a.id, "The employee has died."));
                }
                if died {
                    self.noticed.insert(a.id.clone(), t);
                }
                calls.push(say(
                    "payroll_notice",
                    &format!("Payroll notice, leaver: {worker}, {post}, employment agreement {} ends on {} ({reason}). For the {payroll} office: pay is due to that day, and the wage payment under the agreement is to end then.", a.id, date(end)),
                    Say {
                        to: Some(vec![me.clone()]),
                        visible: Some(Visible::Only(vec![me.clone()])),
                        basis: Some(a.id.clone()),
                        data: Some(json!({ "notice": "leaver", "office": payroll, "employee": worker, "post": post, "agreement": a.id, "last_day": end, "reason": reason })),
                        ..Default::default()
                    },
                ));
                calls.push(message(
                    &[payroll.clone()],
                    &format!("{PAYROLL_NOTE}leaver: {worker}, {post}, employment agreement {} ends on {} ({reason}). The notice is on the organisation's file. Pay is due to that day, and the standing payment of their wage is to be withdrawn then.", a.id, date(end)),
                    Some(&a.id),
                ));
                steps.push(step(
                    if died { format!("{worker}, who worked for us, has died: ending the employment on record and telling the {payroll} office.") } else { format!("{worker}'s employment ends on {}: telling the {payroll} office.", date(end)) },
                    calls,
                ));
            }
        }

        if does_pay {
            steps.extend(self.stop_dead_wages(book, t));
        }
        // Ended (notice served): stop the wages.
        if does_pay {
            for a in &contracts {
                if book.concluded(&a.id) && t >= self.end_of(book, a) && self.orders.contains_key(&a.id) {
                    let c = self.retire(&a.id, "Employment ended; stop wages.", t);
                    steps.push(step("Employment has ended: stopping the wages.", vec![c]));
                }
            }
            // Ended for redundancy, with pay owed under the law: owed in our books from the day the job ends, and paid
            // with the wages we owe (at once if the account covers it; late if not).
            for a in &contracts {
                if self.severance.contains_key(&a.id) && book.concluded(&a.id) && t >= self.end_of(book, a) {
                    if let Some(to) = self.payee(book, a) {
                        let amount = self.severance[&a.id];
                        self.unpaid.push(Unpaid { agreement: a.id.clone(), to, amount, withheld: Kept::default(), due: self.end_of(book, a), what: Some("Redundancy pay".into()) });
                    }
                    self.severance.remove(&a.id);
                }
            }
            steps.extend(self.apply_hours(book, t, cx, account));
            let balance = balance_of(pic, account);
            let keep: i64 = staff.iter().map(|a| if self.noticed.contains_key(&a.id) || by_the_day(a) { 0 } else { self.wage_of(a) }).sum();
            steps.extend(self.late_pay(book, t, cx, account, balance, keep));
        }

        // Work by the day: each hand who is at work today is paid the day's wage today, once, by a payment of its own
        // (less what the law withholds from a day's pay, where the job is one we register). A day we have no work for
        // them (`want.work` false), a day that is not a working day, a hand who is not there: no pay, and nothing owed.
        // Short of the money for all of them, we pay those we can, the longest with us first.
        if self.wage0.is_none() {
            self.wage0 = Some(want.wage);
        }
        let hands: Vec<&Arc<Record>> = if does_pay { staff.iter().filter(|a| by_the_day(a) && !self.noticed.contains_key(&a.id)).copied().collect() } else { vec![] };
        let today = t.div_euclid(DAY);
        if !hands.is_empty() && want.work != Some(false) && today % 7 < self.o.work_days.unwrap_or(5) {
            let here = self.o.workplace.as_ref().map(|w| occupants_of(pic, w));
            let mut left = balance_of(pic, account).unwrap_or(0);
            let mut lines: Vec<Line> = vec![];
            for a in hands {
                let worker = worker_of(a).to_string();
                if self.paid_on.get(&a.id) == Some(&today) || here.as_ref().is_some_and(|h| !h.contains(&worker)) {
                    continue;
                }
                let day = self.wage_of(a); // (the day's pay agreed, with any rise since)
                let Some(to) = self.payee(book, a) else { continue };
                if day > left {
                    continue;
                }
                let (off, note) = self.unregistered(book, cx, &a.id);
                let w = if off { Kept::default() } else { withheld_owned(law.as_ref(), day, day_pay_period(self.o.week_days.unwrap_or(5))) };
                self.paid_on.insert(a.id.clone(), today);
                left -= day;
                if !off {
                    let lid = law.as_ref().map(|l| l.id.clone());
                    self.owe(lid.as_deref(), &w, Some(&a.id), day);
                }
                self.wages_paid += day;
                lines.push(plain(pay(&to, day - w.total, Pay { from: Some(account.to_string()), basis: Some(a.id.clone()), for_: Some(format!("A day's work: {worker}.")), ..Default::default() }, cx)));
                lines.extend(note.map(plain));
            }
            let n = lines.len();
            for chunk in lines.chunks(30) {
                steps.push(step_lines(format!("Paying today's hands for the day ({n} by the day)."), chunk.to_vec()));
            }
        }

        // Hiring (docs/design/market-realism.md, ME-2): a posting is for as many hands as it says; the applicants are
        // judged by the hiring manager, each one taken on interviewed first (a paper to them, in the manager's time:
        // the table of work's `publish/interview`), and the post offered to those who fit best: someone who has worked in
        // its trade before anyone who has not, then who applied first. Someone who applied for a posting of ours since
        // published again at a new wage applied for the job, not the wage: their application stands for the posting
        // that replaced it.
        let posts = self.postings(book);
        let apps: Vec<&Arc<Record>> = book.open("job_application").filter(|a| crate::common::addressed_to(a).contains(&me) && !self.handled.contains(&a.id)).collect();
        let kind_of = |p: &Record| (data(p).get("role").and_then(Value::as_str).map(String::from), data(p).get("by_the_day").is_some_and(truthy));
        let applied_for = |a: &Record| -> Option<String> {
            let named = data(a).get("posting").and_then(Value::as_str)?.to_string();
            if posts.iter().any(|p| p.id == named) {
                return Some(named);
            }
            let was = book.get(&named).filter(|r| r.speaks_for.as_deref() == Some(me.as_str()))?;
            posts.iter().find(|p| kind_of(p) == kind_of(was)).map(|p| p.id.clone())
        };
        // (The offers made on each posting, as our own file shows them: those made since it went up, to someone whose
        // application stands for it. An offer the world refused was never made.)
        let made_on: BTreeMap<String, i64> = posts
            .iter()
            .map(|p| (p.id.clone(), contracts.iter().filter(|a| a.at >= p.at && a.basis.as_ref().and_then(|b| book.get(b.first())).is_some_and(|app| applied_for(app).as_deref() == Some(p.id.as_str()))).count() as i64))
            .collect();
        let mut made_now: BTreeMap<String, i64> = BTreeMap::new();
        for post in if does_hire { posts.clone() } else { vec![] } {
            // (An advertisement of ours that we have put on hold: nobody is offered the post while the hold stands.)
            if book.on_hold(&post.id, Some(std::slice::from_ref(&me))) {
                continue;
            }
            let trade = data(post).get("industry").and_then(Value::as_str).map(String::from);
            let fits = |a: &Record| trade.is_some() && data(a).get("trade").and_then(Value::as_str) == trade.as_deref();
            let mut mine: Vec<&Arc<Record>> = apps.iter().filter(|a| applied_for(a).as_deref() == Some(post.id.as_str())).copied().collect();
            mine.sort_by(|x, y| fits(y).cmp(&fits(x)).then_with(|| filed_before(&x.id, &y.id)));
            for a in &mine {
                self.handled.insert(a.id.clone());
            }
            if mine.is_empty() {
                continue;
            }
            let openings = data(post).get("openings").and_then(Value::as_i64).unwrap_or(1).max(1);
            let made = made_on.get(&post.id).copied().unwrap_or(0);
            let take = ((openings - made).max(0) as usize).min(mine.len());
            let considered = mine.len();
            for (k, chosen) in mine.into_iter().take(take).enumerate() {
            let filled = made + k as i64 + 1 >= openings;
            let close = || if filled { vec![plain(withdraw(&post.id, Some("Filled.")))] } else { vec![] };
            let how = if fits(chosen) { format!("who has worked in the trade, the best fit among {considered} who applied") } else { format!("the first to apply among {considered}, none of whom has worked in the trade") };
            let worker = chosen.speaks_for.clone().unwrap_or_default();
            let interview = say(
                "interview",
                &format!("Interview for our posting, with {worker}."),
                Say { to: Some(vec![worker.clone()]), visible: Some(Visible::Only(vec![me.clone(), worker.clone()])), basis: Some(chosen.id.clone()), data: Some(json!({ "posting": post.id, "application": chosen.id })), ..Default::default() },
            );
            *made_now.entry(post.id.clone()).or_insert(0) += 1;
            let wage = data(post).get("wage").and_then(Value::as_i64).unwrap_or(want.wage);
            let account_to = data(chosen).get("account").and_then(Value::as_str).unwrap_or(&worker).to_string();
            let occupancy = self.o.workplace.as_ref().map(|w| call("occupancy", vec![("who", Some(arg(&worker))), ("in", Some(arg(w)))]));
            if data(post).get("by_the_day").is_some_and(truthy) {
                let o = Offer {
                    template: "employment".into(),
                    our_notice: Some(NO_NOTICE),
                    their_notice: Some(NO_NOTICE),
                    we: Some(pay(&account_to, wage, Pay { every: Some(DAY), for_: Some("a day's work".into()), ..Default::default() }, cx)),
                    they: occupancy,
                    text: Some(format!("{worker} works for {me} by the day, for {} for each day worked; either may end it at once.", usd(wage))),
                    basis: Some(chosen.id.clone()),
                    ..Default::default()
                };
                let mut lines = vec![plain(interview), bound("job", offer(&worker, o))];
                lines.extend(close());
                steps.push(step_lines(format!("Taking on a hand by the day, after interviewing them: {how}."), lines));
                offers_now += 1;
                continue;
            }
            let hours = hours_law(book).filter(|l| l.ordinary_week_minutes > 0).map(|l| l.ordinary_week_minutes * 60);
            let o = Offer {
                template: "employment".into(),
                our_notice: Some(self.o.notice_days * DAY),
                their_notice: Some(self.o.notice_days * DAY),
                // (The job's ordinary hours in a week, as the world's law has the ordinary week: the agreement's hours term.)
                hours,
                we: Some(pay(&account_to, wage, Pay { every: Some(self.o.period), for_: Some("wages".into()), ..Default::default() }, cx)),
                they: occupancy,
                text: Some(format!(
                    "{worker} works for {me} as {} for {} every {} days. First pay {} days after both have signed.",
                    data(post).get("role").and_then(Value::as_str).unwrap_or("staff"),
                    usd(wage),
                    self.o.period / DAY,
                    self.o.period / DAY
                )),
                basis: Some(chosen.id.clone()),
                ..Default::default()
            };
            let mut lines = vec![plain(interview), bound("job", offer(&worker, o))];
            lines.extend(close());
            steps.push(step_lines(format!("Hiring for our posting, after interviewing them: {how}."), lines));
            offers_now += 1;
            }
        }

        steps.extend(self.returns_due(pic, book, cx, account, law.as_ref(), &staff));

        // A posting unfilled at an old wage (ours has moved since): published again at the wage we offer now.
        if does_hire {
            for post in &posts {
                let d = data(post);
                let Some(was) = d.get("wage").and_then(Value::as_i64) else { continue };
                let by_day = d.get("by_the_day").is_some_and(truthy);
                let now = if by_day { self.day_wage(want.wage) } else { want.wage };
                if !apps.iter().any(|a| data(a).get("posting").and_then(Value::as_str) == Some(post.id.as_str())) && was != now && want.can_post {
                    // (For the hands it was still for: its applicants carry over, above.)
                    let left = (d.get("openings").and_then(Value::as_i64).unwrap_or(1) - made_on.get(&post.id).copied().unwrap_or(0)).max(1);
                    let c = self.posting(cx, want.wage, account, Some(by_day), left);
                    steps.push(step(
                        format!("Our posting is still open, at {}; we offer {} now: posting it again at that.", usd(was), usd(now)),
                        vec![withdraw(&post.id, Some("Superseded: a new wage.")), c],
                    ));
                }
            }
        }

        // Post a job if short-staffed (and the module says we can).
        let have = (staff.len() + offered.len() + offers_now) as i64;
        if does_hire && have < want.target && posts.is_empty() && want.can_post {
            // (One posting for every hand we are short of.)
            let c = self.posting(cx, want.wage, account, None, want.target - have);
            steps.push(step(want.why.clone().unwrap_or_else(|| format!("Short-staffed ({have} of {}): posting a job.", want.target)), vec![c]));
        }
        // (A posting for more hands than we now need, once those we need are taken on or offered the post: taken down.)
        if does_hire && have >= want.target && offers_now == 0 {
            let up: Vec<&Arc<Record>> = posts.iter().filter(|p| made_on.get(&p.id).copied().unwrap_or(0) + made_now.get(&p.id).copied().unwrap_or(0) > 0).copied().collect();
            if !up.is_empty() {
                steps.push(step(format!("We have the staff we need ({have}): taking down our posting."), up.iter().map(|p| withdraw(&p.id, Some("No longer needed."))).collect()));
            }
        }
        steps
    }
}

/// A change of pay for one of us: the wage asked, and (for pay that comes short) what each pay is short by.
#[derive(Debug, Clone, Copy)]
pub struct One<'a> {
    pub agreement: &'a str,
    pub wage: i64,
    pub short: Option<i64>,
}

fn chunks_of<T>(why: &str, lines: Vec<Line>) -> Vec<Step<T>> {
    // (Batched: a program has at most 32 lines, and a wake only so many actions.)
    lines.chunks(30).map(|c| step_lines(why, c.to_vec())).collect()
}

impl Staffing {
    /// On the law's days: what we've withheld, paid over to the tax's collector, with a return of it. The law lists its
    /// returns (which charges each reports, how often, the day of the month it falls due by: returns.ts); we file each
    /// on its day, for every employer alike. A period with nothing withheld files nothing; its day is still the
    /// calendar's. Short of money, we pay what we can, keeping the next pay period's wages, and what's left is still
    /// owed (carried to the next return).
    fn returns_due<T>(&mut self, pic: &Picture, book: &Book, cx: &mut Cx, account: &str, law: Option<&IncomeTaxLaw>, staff: &[&Arc<Record>]) -> Vec<Step<T>> {
        let t = pic.t;
        let me = self.me.clone();
        let world = cx.ctx.world.clone();
        let usd = |n: i64| money_words(n, &world);
        let date = |at: i64| when_words(at, &world);
        let mut steps = vec![];
        self.rules = law.map(|l| l.returns_list()).unwrap_or_else(|| returns_of(None));
        // (An office that looks in weekly files by the day, not after it.)
        let early = (self.o.wakes.unwrap_or(DAY) - DAY).max(0);
        for rule in self.rules.clone() {
            if !self.return_day.contains_key(&rule.id) {
                self.return_day.insert(rule.id.clone(), due_on(&world, &rule, t).due);
            }
            let falls = self.return_day[&rule.id];
            if !self.o.pay || t + early < falls {
                continue;
            }
            self.return_day.insert(rule.id.clone(), due_on(&world, &rule, falls).due);
            let period = due_on(&world, &rule, falls - 1);
            let balance = balance_of(pic, account);
            let due: Vec<Owed> = self
                .owed
                .iter()
                .filter(|x| x.amount > 0 && !x.charge.account.is_empty() && !x.charge.collector.is_empty() && rule.charges.as_ref().map_or(true, |c| c.contains(&x.charge.id)))
                .cloned()
                .collect();
            if let (false, Some(balance)) = (due.is_empty(), balance) {
                // (Keeping the next pay period's wages aside: they go first.)
                let keep: i64 = staff.iter().map(|a| job_terms(a, worker_of(a), None).wage).sum();
                let mut left = (balance - keep).max(0);
                // Who was paid what since we last reported, for a charge whose report names each worker.
                let mut lines: Vec<(String, i64)> = self
                    .paid_since
                    .get(&rule.id)
                    .into_iter()
                    .flatten()
                    .filter(|(agreement, _)| !self.off_books.contains(*agreement))
                    .filter_map(|(agreement, gross)| book.get(agreement).map(|r| (worker_of(r).to_string(), *gross)).filter(|(w, _)| !w.is_empty()))
                    .collect();
                lines.sort_by(|a, b| a.0.cmp(&b.0));
                let label = rule.name.clone().unwrap_or_else(|| "Return of tax withheld from wages".into());
                let mark = json!({ "return": rule.id, "due": falls, "period_from": period.from, "period_to": period.to });
                // One report to each collector, in the order the charges were first owed, with what is paid into each
                // of its accounts.
                let mut collectors: Vec<String> = vec![];
                for x in &due {
                    if !collectors.contains(&x.charge.collector) {
                        collectors.push(x.charge.collector.clone());
                    }
                }
                for collector in collectors {
                    let mut parts: Vec<(Charge, i64, i64)> = vec![];
                    for x in due.iter().filter(|x| x.charge.collector == collector) {
                        let paid = x.amount.min(left);
                        left -= paid;
                        if let Some(o) = self.owed.iter_mut().find(|o| o.charge.id == x.charge.id) {
                            o.amount = x.amount - paid;
                        }
                        parts.push((x.charge.clone(), x.amount, paid));
                    }
                    let owed: i64 = parts.iter().map(|p| p.1).sum();
                    let paid: i64 = parts.iter().map(|p| p.2).sum();
                    let mut accounts: Vec<String> = vec![];
                    for p in &parts {
                        if !accounts.contains(&p.0.account) {
                            accounts.push(p.0.account.clone());
                        }
                    }
                    let itemised = parts.iter().any(|p| p.0.itemised);
                    let basis = due.iter().find(|x| x.charge.collector == collector).map(|x| x.law.clone()).filter(|l| !l.is_empty()).or_else(|| law.map(|l| l.id.clone()));
                    // (A law whose charges all go to one account, none reported worker by worker: one sum, as it has always been said.)
                    let one_account = law.map_or(true, |l| l.charges.iter().map(|c| &c.account).collect::<BTreeSet<_>>().len() == 1 && !l.charges.iter().any(|c| c.itemised));
                    let to = Some(vec![collector.clone()]);
                    let visible = Some(Visible::Only(vec![me.clone(), collector.clone()]));
                    if one_account && accounts.len() == 1 && !itemised {
                        let mut data = mark.clone();
                        data["withheld"] = json!(owed);
                        data["paid"] = json!(paid);
                        data["period_end"] = json!(t);
                        data["account"] = json!(account);
                        let mut calls = vec![say(
                            "withholding_report",
                            &format!("Income tax withheld from wages, owed: {}; paid now: {}.", usd(owed), usd(paid)),
                            Say { to, visible, basis, data: Some(data), ..Default::default() },
                        )];
                        if paid > 0 {
                            calls.push(pay(&accounts[0], paid, Pay { from: Some(account.to_string()), for_: Some("Income tax withheld from wages.".into()), ..Default::default() }, cx));
                        }
                        steps.push(step(
                            if paid == owed {
                                format!("{label}, due {}: paying over the {} of income tax we withheld from wages.", date(falls), usd(owed))
                            } else {
                                format!("{label}, due {}: we owe {} of income tax withheld from wages and have {}: paying that, and still owing the rest.", date(falls), usd(owed), usd(paid))
                            },
                            calls,
                        ));
                        continue;
                    }
                    // Several accounts, or a charge reported worker by worker: the report says what is owed and paid
                    // under each charge, and (where a charge asks it) each worker's pay in the period.
                    let named = |c: &Charge| c.name.clone().unwrap_or_else(|| c.id.clone());
                    let mut data = mark.clone();
                    data["withheld"] = json!(owed);
                    data["paid"] = json!(paid);
                    data["period_end"] = json!(t);
                    data["account"] = json!(account);
                    data["charges"] = json!(parts.iter().map(|c| json!({ "charge": c.0.id, "to": c.0.account, "withheld": c.1, "paid": c.2 })).collect::<Vec<_>>());
                    if itemised {
                        data["staff"] = json!(lines.iter().map(|(w, g)| json!({ "worker": w, "gross": g })).collect::<Vec<_>>());
                    }
                    let mut calls = vec![say(
                        "withholding_report",
                        &format!(
                            "Withheld from wages, owed: {}; paid now: {}. {}.",
                            usd(owed),
                            usd(paid),
                            parts.iter().map(|c| format!("{}: owed {}, paid {}", named(&c.0), usd(c.1), usd(c.2))).collect::<Vec<_>>().join("; ")
                        ),
                        Say { to, visible, basis, data: Some(data), ..Default::default() },
                    )];
                    for to in &accounts {
                        let mine: Vec<&(Charge, i64, i64)> = parts.iter().filter(|c| &c.0.account == to).collect();
                        let sum: i64 = mine.iter().map(|c| c.2).sum();
                        if sum > 0 {
                            let what = mine.iter().map(|c| named(&c.0)).collect::<Vec<_>>().join(", ");
                            calls.push(pay(to, sum, Pay { from: Some(account.to_string()), for_: Some(format!("Withheld from wages: {what}.")), ..Default::default() }, cx));
                        }
                    }
                    steps.push(step(
                        if paid == owed {
                            format!("{label}, due {}: paying over the {} we withheld from wages ({}).", date(falls), usd(owed), parts.iter().map(|c| format!("{} {}", named(&c.0), usd(c.1))).collect::<Vec<_>>().join(", "))
                        } else {
                            format!("{label}, due {}: we owe {} withheld from wages and have {}: paying that, and still owing the rest.", date(falls), usd(owed), usd(paid))
                        },
                        calls,
                    ));
                }
            }
            self.paid_since.remove(&rule.id);
        }
        steps
    }

    /// The pay day after `t` of a wage standing order (its start, then every period).
    fn next_due(&self, book: &Book, order: &str, t: i64) -> i64 {
        let r = book.get(order);
        let stmt = r.filter(|r| matches!(r.body, RecordBody::Statement { .. }));
        let every = stmt.and_then(|r| data(r).get("every").and_then(Value::as_i64)).filter(|e| *e != 0).unwrap_or(self.o.period);
        let start = match stmt {
            Some(r) => first_due(r, every),
            None => r.map_or(0, |r| r.at) + every,
        };
        if start > t {
            start
        } else {
            start + (t - start + 1 + every - 1).div_euclid(every) * every
        }
    }

    /// A rise for everyone we employ (an enterprise agreement, docs/behaviour/unions.md): each wage order is replaced by
    /// one at the new wage (net of the tax withheld), from the next pay day on. `one`: a rise for one of us, at the wage
    /// asked.
    pub fn raise<T>(&mut self, book: &Book, t: i64, cx: &mut Cx, account: &str, rise_bps: i64, why: &str, one: Option<One>) -> Vec<Step<T>> {
        let law = income_tax_law(book);
        let mut lines: Vec<Line> = vec![];
        let mut refs: Vec<(String, String, Kept)> = vec![];
        for a in self.staff(book, t) {
            if one.is_some_and(|o| a.id != o.agreement) {
                continue; // (a rise for one of us, at the wage asked)
            }
            let mut wage = match one {
                Some(o) => o.wage,
                None => ((i128::from(self.wage_of(a)) * i128::from(10_000 + rise_bps)).div_euclid(10_000)) as i64,
            };
            // (A rise for someone on cut hours is a rise of their full wage, and they are paid their hours' share of it.)
            if one.is_none() {
                if let Some(cut) = self.cuts.iter_mut().find(|c| c.agreement == a.id) {
                    cut.full = (i128::from(cut.full) * i128::from(10_000 + rise_bps)).div_euclid(10_000) as i64;
                    wage = (i128::from(cut.full) * i128::from(cut.paid_bps)).div_euclid(10_000) as i64;
                    cut.wage = wage;
                }
            }
            self.gross.insert(a.id.clone(), wage);
            match one.and_then(|o| o.short).filter(|s| *s != 0) {
                Some(s) => {
                    self.skim.insert(a.id.clone(), s);
                }
                None => {
                    self.skim.remove(&a.id); // (a wage set afresh is paid as set)
                }
            }
            let to = self.payee(book, a);
            // (A replacement already made, and not yet on the book: the act waits for its performer's time. Not
            // replaced again until it is: the order it would withdraw is the one already withdrawn.)
            if self.is_replacing(&a.id, t) {
                self.hold_rise(&a.id, t + DAY, wage, why, one.and_then(|o| o.short));
                continue;
            }
            let Some(order) = self.orders.get(&a.id).cloned() else { continue };
            let Some(to) = to else { continue };
            if self.stopped.contains_key(&a.id) {
                continue;
            }
            let period = job_terms(a, worker_of(a), None).period;
            // A change of pay takes effect from a pay run, as payroll does it: with a cut-off. Replacing the order
            // takes the manager's time (the act waits for them), and an order withdrawn after its pay moment still pays
            // it, so a pay moment inside the act would be paid by the old order and again by the new. Within the
            // cut-off before a pay run the change is held until the run has been made, and then made for the run after.
            if let Some(run) = self.held_to_run(book, &order, period, t) {
                self.hold_rise(&a.id, run, wage, why, one.and_then(|o| o.short));
                continue;
            }
            let tax = if self.off_books.contains(&a.id) { Kept::default() } else { withheld_owned(law.as_ref(), wage, period) };
            let reference = format!("wo{}", self.n);
            self.n += 1;
            let retire = self.retire(&a.id, "Superseded: a new wage.", t);
            lines.push(plain(retire));
            let first = (self.next_due(book, &order, t) - t).max(DAY);
            lines.push(bound(
                &reference,
                pay(&to, wage - tax.total - one.and_then(|o| o.short).unwrap_or(0), Pay { from: Some(account.to_string()), every: Some(period), first: Some(first), basis: Some(a.id.clone()), for_: Some(format!("Wages for {}.", worker_of(a))), ..Default::default() }, cx),
            ));
            refs.push((reference, a.id.clone(), tax));
        }
        for (reference, id, tax) in refs {
            self.pending_order.insert(reference.clone(), id.clone());
            self.replacing.insert(id, t);
            if tax.total > 0 {
                self.pending_withhold.insert(reference, tax);
            }
        }
        chunks_of(why, lines)
    }

    /// Withdraw an agreement's wage order; it stays on our books until its payments are seen (see `withdrawn`).
    fn retire(&mut self, agreement: &str, why: &str, t: i64) -> Call {
        let order = self.orders.remove(agreement).unwrap_or_default();
        self.withdrawn.insert(order.clone(), Withdrawn { agreement: agreement.to_string(), at: t });
        withdraw(&order, Some(why))
    }

    /// The pay run a change of pay must wait for, if the next one is within the cut-off (else it may be made now).
    fn held_to_run(&self, book: &Book, order: &str, period: i64, t: i64) -> Option<i64> {
        let next = self.next_due(book, order, t);
        (next - t < PAY_CUTOFF.min(period.div_euclid(2))).then_some(next)
    }

    fn is_replacing(&self, agreement: &str, t: i64) -> bool {
        self.replacing.get(agreement).is_some_and(|since| t - since < 2 * DAY) && self.pending_order.values().any(|a| a == agreement)
    }

    /// A change of pay left for a later look (the latest for an agreement is the one kept).
    fn hold_rise(&mut self, agreement: &str, at: i64, wage: i64, why: &str, short: Option<i64>) {
        if let Some(i) = self.due.iter().position(|d| d.held && d.agreement == agreement) {
            self.due.remove(i);
        }
        self.due.push(DueChange { at, agreement: agreement.to_string(), wage, why: why.to_string(), short, held: true });
    }

    // ---- pay that comes short, and the wage ledger

    /// The week's look at whom we begin to pay short (at most once a week, each on their own draw). `pay_less`: how
    /// far the organisation's character would pay less, in ten-thousandths of a standard deviation (0 where it takes no
    /// initiative).
    pub fn shortening<T>(&mut self, book: &Book, t: i64, cx: &mut Cx, account: &str, balance: i64, pay_less: i64) -> Vec<Step<T>> {
        let week = t.div_euclid(7 * DAY);
        let by = self.o.short_by_bps.unwrap_or(0);
        if by <= 0 || self.short_week == Some(week) {
            return vec![];
        }
        self.short_week = Some(week);
        let staff: Vec<&Arc<Record>> = self
            .staff(book, t)
            .into_iter()
            .filter(|a| self.orders.contains_key(&a.id) && !self.skim.contains_key(&a.id) && !self.stopped.contains_key(&a.id) && !self.noticed.contains_key(&a.id) && !by_the_day(a))
            .collect();
        let bill: i64 = staff.iter().map(|a| self.wage_of(a)).sum();
        // (More often the more its character would pay less, and twice as often while it is short of cash.)
        let double = balance < 2 * bill;
        let lean = move |bps: i64| super::orgwants::swayed(bps, pay_less, 10_000) * if double { 2 } else { 1 };
        let law = income_tax_law(book);
        let mut steps = vec![];
        for a in staff {
            let worker = worker_of(a).to_string();
            if !slip(cx, "transfer/wages", &format!("{worker}-{week}"), &SlipOptions { days: 7, lean: Some(&lean) }) {
                continue;
            }
            let wage = self.wage_of(a);
            let period = job_terms(a, &worker, None).period;
            let net = wage - if self.off_books.contains(&a.id) { 0 } else { withheld(law.as_ref(), wage, period).total };
            let short = (i128::from(net) * i128::from(by)).div_euclid(10_000) as i64;
            if short > 0 {
                let words = format!("Paying {worker} {} a pay less than we agreed, from the next pay day.", money_words(short, &cx.ctx.world));
                steps.extend(self.raise(book, t, cx, account, 0, &words, Some(One { agreement: &a.id, wage, short: Some(short) })));
            }
        }
        steps
    }

    /// What our books say we owe someone in wages under an agreement: kept back, and missed.
    pub fn owed_short(&self, agreement: &str) -> i64 {
        self.kept.get(agreement).copied().unwrap_or(0) + self.unpaid.iter().filter(|u| u.agreement == agreement).map(|u| u.amount).sum::<i64>()
    }

    /// Wages our books say are owed and unpaid, in all (for whoever winds us up, and for what we can spend).
    pub fn wages_owed(&self) -> i64 {
        self.unpaid.iter().map(|u| u.amount).sum()
    }

    /// Whether we are in no state to pay out to our owners (docs/behaviour/firms.md, "Before a dividend"): wages are
    /// owed in our books, or someone of our staff is under notice. In words, or "" if neither.
    pub fn strained(&self, book: &Book, t: i64, world: &crate::WorldInfo) -> String {
        let owed = self.wages_owed();
        if owed > 0 {
            return format!("wages are owed in our books ({})", money_words(owed, world));
        }
        let going = self.staff(book, t).iter().filter(|a| self.noticed.contains_key(&a.id)).count();
        if going > 0 {
            format!("{going} of our staff {} under notice", if going == 1 { "is" } else { "are" })
        } else {
            String::new()
        }
    }

    /// Missed pays entered in the ledger, and those the account now covers paid late (keeping `keep` for the next pay day).
    fn late_pay<T>(&mut self, book: &Book, t: i64, cx: &mut Cx, account: &str, balance: Option<i64>, keep: i64) -> Vec<Step<T>> {
        let _ = t;
        let by_order: BTreeMap<String, String> = self.orders.iter().map(|(a, o)| (o.clone(), a.clone())).collect();
        for (order, at) in std::mem::take(&mut self.failed) {
            let Some(agreement) = by_order.get(&order) else { continue };
            let money = book.get(&order).and_then(|r| data(r).get("outcome").and_then(|o| o.get("money")).cloned());
            let Some(money) = money else { continue };
            let (Some(to), amount) = (money.get("to").and_then(Value::as_str), amount_of(money.get("amount"))) else { continue };
            if amount <= 0 {
                continue;
            }
            let w = self.withholds.get(&order).cloned().unwrap_or_default();
            self.unpaid.push(Unpaid { agreement: agreement.clone(), to: to.to_string(), amount, withheld: w, due: at, what: None });
        }
        if self.unpaid.is_empty() {
            return vec![];
        }
        // (A worker's own claim for the wages, recorded as a debt against us, replaces our line: it is paid as a debt.)
        let claimed: BTreeSet<String> = book
            .claims_by(crate::common::ClaimKey::Counterparty, &self.me)
            .filter(|c| matches!(&c.body, RecordBody::Claim { about, .. } if about.get("kind").and_then(Value::as_str) == Some("debt")))
            .flat_map(|c| crate::common::bases_of(c).iter().cloned())
            .collect();
        self.unpaid.retain(|u| !claimed.contains(&u.agreement));
        let Some(balance) = balance else { return vec![] };
        let mut left = balance - keep;
        let mut lines: Vec<Call> = vec![];
        let world = cx.ctx.world.clone();
        while !self.unpaid.is_empty() && self.unpaid[0].amount <= left && lines.len() < 30 {
            let u = self.unpaid.remove(0);
            left -= u.amount;
            let worker = book.get(&u.agreement).map(|r| worker_of(r).to_string()).filter(|w| !w.is_empty()).unwrap_or_else(|| "our employee".into());
            if !self.off_books.contains(&u.agreement) {
                let law = self.law_id.clone();
                self.owe(law.as_deref(), &u.withheld, Some(&u.agreement), u.amount + u.withheld.total);
            }
            self.wages_paid += u.amount + u.withheld.total;
            let words = match &u.what {
                Some(w) => format!("{w} for {worker}."),
                None => format!("Wages for {worker}, late: due {}.", when_words(u.due, &world)),
            };
            lines.push(pay(&u.to, u.amount, Pay { from: Some(account.to_string()), basis: Some(u.agreement.clone()), for_: Some(words), ..Default::default() }, cx));
        }
        if lines.is_empty() {
            vec![]
        } else {
            vec![step(format!("Owed in our books to people who work or worked for us (wages not paid on their day, redundancy pay): paying {} of them now.", lines.len()), lines)]
        }
    }

    /// Winding up: what we owe our staff, and what we withheld from their wages and have not paid over, come before our
    /// shareholders (and our other creditors): wages and redundancy pay owed in our books, then the tax withheld, paid
    /// from `balance` as far as it goes (firms.ts `windUpOwed`, bug hunt 2026-10-17). Returns the steps and what they pay.
    pub fn wind_up_owed<T>(&mut self, book: &Book, t: i64, cx: &mut Cx, account: &str, balance: i64) -> (Vec<Step<T>>, i64) {
        let mut steps: Vec<Step<T>> = vec![];
        let mut paid = 0;
        for _ in 0..20 {
            let before = self.wages_owed();
            let s = self.late_pay(book, t, cx, account, Some(balance - paid), 0);
            if s.is_empty() {
                break;
            }
            steps.extend(s);
            paid += before - self.wages_owed();
        }
        let mut lines: Vec<Call> = vec![];
        for x in self.owed.iter_mut() {
            if x.amount <= 0 || x.charge.account.is_empty() {
                continue;
            }
            let amount = x.amount.min(balance - paid);
            if amount <= 0 {
                continue;
            }
            x.amount -= amount;
            paid += amount;
            lines.push(pay(&x.charge.account, amount, Pay { from: Some(account.to_string()), for_: Some("Winding up: tax withheld from wages, paid over.".into()), ..Default::default() }, cx));
        }
        if !lines.is_empty() {
            steps.push(step("Winding up: the tax we withheld from wages and had not paid over comes before our shareholders.", lines));
        }
        (steps, paid)
    }

    /// Putting short pay right from here on: their wage order replaced by one at the wage agreed. (What was kept back
    /// is paid by whoever answers for us.)
    pub fn pay_in_full<T>(&mut self, book: &Book, t: i64, cx: &mut Cx, account: &str, agreement: &str, why: &str) -> Vec<Step<T>> {
        self.kept.remove(agreement);
        self.unpaid.retain(|u| u.agreement != agreement);
        if self.skim.remove(agreement).is_none() {
            return vec![];
        }
        match self.staff(book, t).into_iter().find(|x| x.id == agreement) {
            Some(a) => {
                let wage = self.wage_of(a);
                self.raise(book, t, cx, account, 0, why, Some(One { agreement, wage, short: None }))
            }
            None => vec![],
        }
    }

    /// Asked by one of ours for a rise (docs/behaviour/firm-wants.md): answered in writing, yes or no, by our character
    /// (keeping a worker and being thought well of, against paying less), by how long they have been with us, and only
    /// where what we have in the bank covers the new wage bill for a few pay periods; saying yes, their wage order is
    /// replaced by one at the wage asked, from the next pay day. An employer with no wants of its own answers nothing.
    pub fn asked<T, W: Wanting + Serialize + serde::de::DeserializeOwned>(&mut self, book: &Book, t: i64, cx: &mut Cx, account: &str, balance: i64, org: &mut Org<W>) -> Vec<Step<T>> {
        if !org.lively {
            return vec![];
        }
        let me = self.me.clone();
        let mut steps = vec![];
        let requests: Vec<&Arc<Record>> = book.open("variation_request").collect();
        for r in requests {
            if self.asked_answered.contains(&r.id) || !crate::common::addressed_to(r).contains(&me) {
                continue;
            }
            self.asked_answered.insert(r.id.clone());
            let d = data(r);
            let staff = self.staff(book, t);
            let Some(a) = staff.iter().find(|x| d.get("agreement").and_then(Value::as_str) == Some(x.id.as_str())).copied() else { continue };
            let worker = worker_of(a).to_string();
            if r.speaks_for.as_deref() != Some(worker.as_str()) {
                continue;
            }
            let asked = d.get("would").and_then(|w| w.get("does")).and_then(|w| w.get("outcome")).and_then(|w| w.get("money")).and_then(|m| m.get("amount"));
            let wage = amount_of(asked);
            let now = self.wage_of(a);
            let world = cx.ctx.world.clone();
            let usd = |n: i64| money_words(n, &world);
            let reply = |granted: bool, words: &str| {
                let mut data = json!({ "about": a.id, "granted": granted });
                if granted {
                    data["wage"] = json!(wage);
                }
                say("variation_answer", words, Say { to: Some(vec![worker.clone()]), visible: Some(Visible::Only(vec![me.clone(), worker.clone()])), basis: Some(r.id.clone()), data: Some(data), ..Default::default() })
            };
            let bill: i64 = staff.iter().map(|s| self.wage_of(s)).sum();
            let can = wage > now && wage <= now * 2 && balance >= org.p.rise_cover_periods * (bill + wage - now);
            // How much they are worth keeping: their years with us less one, held to one either way (ten-thousandths).
            let worth = round_div(i128::from(t - book.signed_at(&a.id).unwrap_or(t) - YEAR) * 10_000, i128::from(YEAR)).clamp(-10_000, 10_000) as i64;
            let (granted, chance) = if can {
                let mut rng = cx.rng(&format!("rise-{}", r.id));
                org.grants(PracticeOf::Rise, &mut rng, worth, t)
            } else {
                (false, 0)
            };
            org.remember(t, if granted { "gave_rise" } else { "refused_rise" }, Some(&worker), 2_000);
            if granted {
                let why = format!("{worker} asks for a rise, to {}: we would sooner keep them (for us, {}% of such requests): their wage is {} from the next pay day.", usd(wage), fmt_dec(chance, 100), usd(wage));
                steps.extend(self.raise(book, t, cx, account, 0, &why, Some(One { agreement: &a.id, wage, short: None })));
                steps.push(step(format!("Telling {worker} their rise is granted."), vec![reply(true, &format!("Granted: your pay is {} from the next pay day.", usd(wage)))]));
            } else {
                let why = if can { format!("{worker} asks for a rise: no (for us, {}% of such requests are granted).", fmt_dec(chance, 100)) } else { format!("{worker} asks for a rise we cannot give.") };
                steps.push(step(why, vec![reply(false, "Not granted: your pay stays as it is.")]));
            }
        }
        steps
    }

    // ---- strikes

    /// Pay stopped for these workers (on strike: no pay for time on strike).
    pub fn stop<T>(&mut self, book: &Book, t: i64, workers: &[String], why: &str) -> Vec<Step<T>> {
        let mut lines = vec![];
        let todo: Vec<&Arc<Record>> = self.staff(book, t).into_iter().filter(|x| workers.iter().any(|w| w == worker_of(x)) && !self.stopped.contains_key(&x.id)).collect();
        for a in todo {
            let Some(order) = self.orders.get(&a.id).cloned() else { continue };
            let period = job_terms(a, worker_of(a), None).period;
            self.stopped.insert(a.id.clone(), Stopped { since: t, last_due: self.next_due(book, &order, t) - period });
            self.paid_to.remove(&a.id);
            lines.push(plain(self.retire(&a.id, "Stopped: on strike.", t)));
        }
        chunks_of(why, lines)
    }

    /// Pay restarted for workers back from a strike: what they earned between their last pay day and the strike, paid
    /// now (net of tax), and their wages from now on, a period at a time.
    pub fn resume<T>(&mut self, book: &Book, t: i64, cx: &mut Cx, account: &str, workers: &[String], why: &str) -> Vec<Step<T>> {
        let law = income_tax_law(book);
        let mut lines: Vec<Line> = vec![];
        let back: Vec<&Arc<Record>> = self.staff(book, t).into_iter().filter(|x| workers.iter().any(|w| w == worker_of(x)) && self.stopped.contains_key(&x.id)).collect();
        for a in back {
            let Stopped { since, last_due } = self.stopped.remove(&a.id).unwrap();
            let Some(to) = self.payee(book, a) else { continue };
            let period = job_terms(a, worker_of(a), None).period;
            let wage = self.wage_of(a);
            // (What the order actually paid, not what we decided when we withdrew it: a pay moment inside the act is
            // paid by the old order. Paid through that moment, nothing before the strike is owed again; and the strike
            // days it paid are taken off the first pay after the return, by starting it that many seconds later: a pay
            // covers the period before it.)
            let paid_through = last_due.max(self.paid_to.get(&a.id).copied().unwrap_or(0));
            let over = period.min((paid_through - since).max(0));
            let earned = ((i128::from(wage) * i128::from(period.min((since - paid_through).max(0)))).div_euclid(i128::from(period))).max(0) as i64;
            let each = if self.off_books.contains(&a.id) { Kept::default() } else { withheld_owned(law.as_ref(), wage, period) };
            let per_pay = each.total;
            // (For the part of a pay period worked: that part of what a whole pay withholds, charge by charge.)
            let share = |x: i64| (i128::from(x) * i128::from(earned)).div_euclid(i128::from(wage.max(1))) as i64;
            let tax = share(per_pay);
            let mut part: Vec<(Charge, i64)> = each.parts.iter().map(|(c, amount)| (c.clone(), share(*amount))).collect();
            let sum: i64 = part.iter().map(|c| c.1).sum();
            if let Some(first) = part.first_mut() {
                first.1 += tax - sum;
            }
            if !self.off_books.contains(&a.id) {
                let lid = law.as_ref().map(|l| l.id.clone());
                self.owe(lid.as_deref(), &Kept { total: tax, parts: part }, Some(&a.id), earned);
            }
            self.wages_paid += earned;
            let reference = format!("wo{}", self.n);
            self.n += 1;
            self.pending_order.insert(reference.clone(), a.id.clone());
            if per_pay > 0 {
                self.pending_withhold.insert(reference.clone(), each);
            }
            let worker = worker_of(a).to_string();
            if earned - tax > 0 {
                lines.push(plain(pay(&to, earned - tax, Pay { from: Some(account.to_string()), for_: Some(format!("Wages for {worker} to the strike.")), ..Default::default() }, cx)));
            }
            lines.push(bound(&reference, pay(&to, wage - per_pay, Pay { from: Some(account.to_string()), every: Some(period), first: Some(period + over), basis: Some(a.id.clone()), for_: Some(format!("Wages for {worker}.")), ..Default::default() }, cx)));
        }
        chunks_of(why, lines)
    }
}

/// What reviewing hours made of the month: the steps, the share our staff will work, and why.
#[derive(Debug)]
pub struct HoursReview<T> {
    pub steps: Vec<Step<T>>,
    /// The average share of the ordinary hours our staff work, in 10,000ths.
    pub achieved: i64,
    pub why: String,
}

impl Staffing {
    // ---- Hours before heads (docs/behaviour/firms.md): the hours term of an agreement, cut and restored by a paper to
    // the worker

    /// What the wage of an agreement is when its hours are whole: the cut's full wage where it is cut, else the wage now.
    pub fn full_wage_of(&self, a: &Record) -> i64 {
        match self.cuts.iter().find(|c| c.agreement == a.id) {
            Some(c) if c.state == CutState::Set => c.full,
            _ => self.wage_of(a),
        }
    }

    /// The share of the ordinary hours someone works at `t` (10,000: whole), as our cuts stand.
    pub fn hours_bps_at(&self, worker: &str, t: i64) -> i64 {
        self.cuts.iter().find(|c| c.worker == worker && c.state == CutState::Set && t >= c.from && t < c.until).map_or(10_000, |c| c.hours_bps)
    }

    /// Whether any of our staff is on cut hours or has been put a cut.
    pub fn cutting(&self) -> bool {
        !self.cuts.is_empty()
    }

    fn achieved(&self, staff: &[&Arc<Record>]) -> i64 {
        if staff.is_empty() {
            return 10_000;
        }
        let sum: i64 = staff.iter().map(|a| self.cuts.iter().find(|c| c.agreement == a.id).map_or(10_000, |c| c.hours_bps)).sum();
        let n = staff.len() as i64;
        (2 * sum + n).div_euclid(2 * n)
    }

    /// Hours restored for these cuts (all, or `only`), each by a paper to the worker.
    fn restore_hours<T>(&mut self, book: &Book, t: i64, cx: &Cx, law: Option<&HoursLaw>, why: &str, only: Option<Vec<String>>) -> Vec<Step<T>> {
        let mut steps = vec![];
        let which: Vec<Cut> = self.cuts.iter().filter(|c| only.as_ref().map_or(true, |o| o.contains(&c.agreement))).cloned().collect();
        for c in which {
            self.cuts.retain(|x| x.agreement != c.agreement);
            let a = book.get(&c.agreement);
            let period = a.map_or(14 * DAY, |a| job_terms(a, &c.worker, None).period);
            let text = format!(
                "Your hours are back to the ordinary {} a week, and your pay with them: {} every {}.",
                fmt_dec(ordinary_minutes(a.map(|a| &**a), &c.worker, law), 60),
                money_words(c.full, &cx.ctx.world),
                duration_words(period)
            );
            let at = t + HOURS_GRACE_DAYS * DAY;
            if c.state == CutState::Set {
                self.due.push(DueChange { at, agreement: c.agreement.clone(), wage: c.full, why: format!("Hours restored: {} back on {}.", c.worker, money_words(c.full, &cx.ctx.world)), short: None, held: false });
            }
            let mut payload = json!({ "employer": self.me, "agreement": c.agreement, "wage": c.full, "hours_bps": 10_000, "from": at });
            if let Some(l) = law {
                payload["law"] = json!(l.id);
            }
            steps.push(step(
                why,
                vec![say("hours_restored", &text, Say { to: Some(vec![c.worker.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), c.worker.clone()])), basis: Some(c.agreement.clone()), data: Some(payload), ..Default::default() })],
            ));
        }
        steps
    }

    /// The month's look at hours (called by a shop or a factory whose staff outrun its trade, or whose trade has come
    /// back). `target_bps`: the share of the ordinary hours the trade expected needs of the staff we have (10,000 or
    /// more: all of them). Where the law lets an employer cut hours, we cut across all our staff to that share (never
    /// below the law's floor), by a paper to each; where the trade has come back, or the law's longest spell is run,
    /// hours are restored by another. Returns the steps and the share our staff will work, which the module reads to
    /// see whether a surplus of hands is left (and only then lets anyone go). A world with no such law, or one that
    /// does not allow it: nothing, 10,000.
    pub fn review_hours<T>(&mut self, book: &Book, t: i64, cx: &Cx, target_bps: i64, step_bps: i64) -> HoursReview<T> {
        let none = |steps: Vec<Step<T>>| HoursReview { steps, achieved: 10_000, why: String::new() };
        let law = hours_law(book);
        if !self.o.pay || !self.o.hire {
            return none(vec![]);
        }
        let staff: Vec<&Arc<Record>> = self.staff(book, t).into_iter().filter(|a| !self.noticed.contains_key(&a.id) && !by_the_day(a)).collect();
        let mut steps: Vec<Step<T>> = vec![];
        // The law's longest spell: a cut that has run it is ended, and we cut no more for as long again.
        let over: Vec<String> = self.cuts.iter().filter(|c| c.state == CutState::Set && t >= c.until - HOURS_GRACE_DAYS * DAY).map(|c| c.agreement.clone()).collect();
        if !over.is_empty() {
            let max = law.as_ref().map_or(0, |l| l.max_days);
            let why = format!("The longest spell the law allows on cut hours ({max} days) is run for {} of our staff: back to their ordinary hours.", over.len());
            steps.extend(self.restore_hours(book, t, cx, law.as_ref(), &why, Some(over)));
            self.no_cut_until = Some(t + max * DAY);
        }
        // Proposals not agreed to in time are dropped, and not put again this spell.
        let lapsed: Vec<String> = self.cuts.iter().filter(|c| c.state == CutState::Proposed && t > c.reply_by).map(|c| c.agreement.clone()).collect();
        for id in lapsed {
            self.cuts.retain(|c| c.agreement != id);
            self.declined.insert(id);
        }
        let law = match law {
            Some(l) if l.may_cut != MayCut::No => l,
            _ => {
                if !self.cuts.is_empty() {
                    steps.extend(self.restore_hours(book, t, cx, law.as_ref(), "The law no longer lets us cut hours: back to the ordinary.", None));
                }
                return none(steps);
            }
        };
        if target_bps >= 10_000 - step_bps {
            if !self.cuts.is_empty() {
                steps.extend(self.restore_hours(book, t, cx, Some(&law), "Trade has come back to what our staff at their ordinary hours need: their hours are restored.", None));
            }
            self.declined.clear();
            return HoursReview { steps, achieved: 10_000, why: String::new() };
        }
        if self.no_cut_until.is_some_and(|u| t < u) || staff.is_empty() {
            let achieved = self.achieved(&staff);
            return HoursReview { steps, achieved, why: String::new() };
        }
        let goal = 10_000.min(law.floor_bps.max((target_bps + 99).div_euclid(100) * 100));
        let each = if staff.len() as i64 >= law.pay_owed_from { law.pay_bps } else { 0 };
        let mut changed = 0;
        let world = cx.ctx.world.clone();
        for a in &staff {
            let worker = worker_of(a).to_string();
            let now = self.cuts.iter().find(|c| c.agreement == a.id).cloned();
            if self.declined.contains(&a.id) {
                continue;
            }
            let current = now.as_ref().map_or(10_000, |c| c.hours_bps);
            if (current - goal).abs() < step_bps {
                continue;
            }
            let full = match &now {
                Some(c) if c.state == CutState::Set => c.full,
                _ => self.wage_of(a),
            };
            let paid_bps = paid_share(goal, each);
            let wage = (i128::from(full) * i128::from(paid_bps)).div_euclid(10_000) as i64;
            let ordinary_min = ordinary_minutes(Some(a), &worker, Some(&law));
            let ordinary = fmt_dec(ordinary_min, 60);
            let notice_days = law.notice_days.max(HOURS_GRACE_DAYS);
            let since = now.as_ref().map_or(t, |c| c.since);
            let until = if law.max_days > 0 { since + law.max_days * DAY } else { t + 20 * 365 * DAY };
            let from = t + notice_days * DAY;
            let period = job_terms(a, &worker, None).period;
            let consent = law.may_cut == MayCut::Consent;
            // The hours cut to, in hundredths of an hour (TS: Math.round(hours * goal / 100) / 100).
            let hours_x100 = round_div(i128::from(ordinary_min) * i128::from(goal), 6_000) as i64;
            let hours = fmt_dec(hours_x100, 100);
            let owed = if law.pay_bps > 0 && each > 0 { format!(" (The law owes {}% of pay for hours not worked.)", fmt_dec(law.pay_bps, 100)) } else { String::new() };
            let spell = if law.max_days > 0 { format!(" It is for at most {} days.", law.max_days) } else { String::new() };
            let text = format!(
                "{} your hours from {ordinary} a week to {hours}, {}, because there is not the trade for everyone's full week. Your pay for them is {} every {}, where it was {}.{owed}{spell} We would sooner do this than let anyone go.",
                if consent { "We ask you to agree to" } else { "We are cutting" },
                if consent { "from the day you agree".to_string() } else { format!("from {}", when_words(from, &world)) },
                money_words(wage, &world),
                duration_words(period),
                money_words(full, &world)
            );
            let reply_by = t + law.notice_days.max(7) * DAY;
            let cut = Cut { agreement: a.id.clone(), worker: worker.clone(), full, hours_bps: goal, paid_bps, wage, from, until, since, state: if consent { CutState::Proposed } else { CutState::Set }, reply_by };
            match self.cuts.iter_mut().find(|c| c.agreement == a.id) {
                Some(c) => *c = cut,
                None => self.cuts.push(cut),
            }
            if !consent {
                self.due.push(DueChange { at: from, agreement: a.id.clone(), wage, why: format!("Hours cut to {hours} a week: {worker} on {} from the next pay.", money_words(wage, &world)), short: None, held: false });
            }
            steps.push(step(
                format!("{} {worker}'s hours to {}% of the ordinary, in place of letting anyone go (docs/behaviour/firms.md, \"Hours before heads\").", if now.is_some() { "Changing" } else { "Cutting" }, fmt_dec(goal, 100)),
                vec![say(
                    "hours_notice",
                    &text,
                    Say {
                        to: Some(vec![worker.clone()]),
                        visible: Some(Visible::Only(vec![self.me.clone(), worker.clone()])),
                        basis: Some(a.id.clone()),
                        data: Some(json!({ "employer": self.me, "agreement": a.id, "hours_bps": goal, "ordinary_week_hours": round_div(i128::from(ordinary_min), 60) as i64, "minutes_week": round_div(i128::from(hours_x100) * 60, 100) as i64, "wage": wage, "was": full,
                            "from": from, "until": until, "consent": consent, "consent_bps": law.consent_bps, "law": law.id, "reply_by": reply_by })),
                        ..Default::default()
                    },
                )],
            ));
            changed += 1;
        }
        let achieved = self.achieved(&staff);
        HoursReview { steps, achieved, why: if changed > 0 { format!("cut hours across our staff to {}% of the ordinary", fmt_dec(goal, 100)) } else { String::new() } }
    }

    /// Agreements to cuts we put (an `hours_reply` of the worker's), and the wage changes whose day has come.
    pub fn apply_hours<T>(&mut self, book: &Book, t: i64, cx: &mut Cx, account: &str) -> Vec<Step<T>> {
        let mut steps = vec![];
        let me = self.me.clone();
        let replies: Vec<&Arc<Record>> = book.open("hours_reply").filter(|r| crate::common::addressed_to(r).contains(&me)).collect();
        let world = cx.ctx.world.clone();
        for r in replies {
            let agreement = data(r).get("agreement").and_then(Value::as_str).unwrap_or("").to_string();
            let Some(i) = self.cuts.iter().position(|c| c.agreement == agreement) else { continue };
            if self.cuts[i].state != CutState::Proposed || r.speaks_for.as_deref() != Some(self.cuts[i].worker.as_str()) || self.handled.contains(&r.id) {
                continue;
            }
            self.handled.insert(r.id.clone());
            if data(r).get("agree").and_then(Value::as_bool) == Some(true) {
                let c = &mut self.cuts[i];
                c.state = CutState::Set;
                c.from = (t + HOURS_GRACE_DAYS * DAY).max(c.from);
                let (at, id, wage, why) = (c.from, c.agreement.clone(), c.wage, format!("{} has agreed to the cut: on {} from the next pay.", c.worker, money_words(c.wage, &world)));
                self.due.push(DueChange { at, agreement: id, wage, why, short: None, held: false });
            } else {
                self.cuts.remove(i);
                self.declined.insert(agreement);
            }
        }
        let (now, later): (Vec<DueChange>, Vec<DueChange>) = std::mem::take(&mut self.due).into_iter().partition(|d| d.at <= t);
        self.due = later;
        for d in now {
            if self.noticed.contains_key(&d.agreement) || !self.staff(book, t).iter().any(|a| a.id == d.agreement) {
                self.cuts.retain(|c| c.agreement != d.agreement);
                continue;
            }
            steps.extend(self.raise(book, t, cx, account, 0, &d.why, Some(One { agreement: &d.agreement, wage: d.wage, short: d.short })));
        }
        steps
    }

    // ---- letting people go

    /// The most recent hire not under notice (ties: the earlier on the staff list).
    fn latest_hire<'a>(&self, book: &Book, staff: &[&'a Arc<Record>]) -> Option<&'a Arc<Record>> {
        let mut best: Option<&Arc<Record>> = None;
        for a in staff.iter().filter(|a| !self.noticed.contains_key(&a.id)) {
            if best.map_or(true, |b| book.signed_at(&a.id).unwrap_or(i64::MAX) > book.signed_at(&b.id).unwrap_or(i64::MAX)) {
                best = Some(a);
            }
        }
        best
    }

    /// Let one worker go (the most recent hire not already under notice), with the notice their contract gives.
    pub fn let_go<T>(&mut self, book: &Book, t: i64, cx: &Cx, why: &str, reason: &str) -> Vec<Step<T>> {
        let staff = self.staff(book, t);
        let Some(last) = self.latest_hire(book, &staff) else { return vec![] };
        self.noticed.insert(last.id.clone(), t);
        let (sum, law, words) = self.redundancy_owed(book, t, last, staff.len() as i64);
        if sum > 0 {
            self.severance.insert(last.id.clone(), sum);
        }
        let why = if sum > 0 { format!("{why} Under {law}, {words}: {}, paid when the job ends.", money_words(sum, &cx.ctx.world)) } else { why.to_string() };
        vec![step(why, vec![notice(&last.id, reason)])]
    }

    /// How long the most recent hire we are keeping has been with us, in seconds (nobody: 0).
    pub fn last_hire_service(&self, book: &Book, t: i64) -> i64 {
        let staff = self.staff(book, t);
        self.latest_hire(book, &staff).map_or(0, |last| self.service(book, t, last))
    }

    /// How long someone has worked for us under an agreement, in seconds (those we began with: as long as the run).
    pub fn service(&self, book: &Book, t: i64, a: &Record) -> i64 {
        (t - book.signed_at(&a.id).unwrap_or(a.at)).max(0)
    }

    /// What the law on ending a job says we owe someone let go for redundancy, beyond their notice: redundancy pay for
    /// their service (unless we are smaller than the law's small employer), and pay for the notice the law gives them
    /// beyond what their agreement does. No such law in the world: nothing. Returns the sum, the law and the words.
    /// Reckoned exactly in seconds of pay (the TS multiplied floating-point weeks); the words give the weeks.
    pub fn redundancy_owed(&self, book: &Book, t: i64, a: &Record, staff: i64) -> (i64, String, String) {
        let Some(law) = termination_law(book).filter(|_| !by_the_day(a)) else { return (0, String::new(), String::new()) };
        let terms = job_terms(a, worker_of(a), None);
        let service = self.service(book, t, a);
        // Thousandths of a day of pay.
        let redundancy = if small(&law, staff) { 0 } else { days_at(&law.redundancy_pay, service) };
        let agreed = i128::from(notice_of(a, &self.me).unwrap_or(0)) * 1_000 / i128::from(DAY);
        let lieu = (i128::from(days_at(&law.notice, service)) - agreed).max(0) as i64;
        let paid_days = i128::from(redundancy + lieu);
        let sum = (i128::from(self.full_wage_of(a)) * paid_days * i128::from(DAY) / (1_000 * i128::from(terms.period.max(1)))) as i64;
        let bits: Vec<String> = [
            (redundancy > 0).then(|| format!("{} weeks' redundancy pay", fmt_dec(redundancy, 7_000))),
            (lieu > 0).then(|| format!("{} weeks' pay for notice beyond the agreement's", fmt_dec(round_div(i128::from(lieu) * 10, 7_000) as i64, 10))),
        ]
        .into_iter()
        .flatten()
        .collect();
        (sum, law.id, format!("{} for {} years' service", bits.join(" and "), service / YEAR))
    }

    /// Let everyone go, with the notice their contracts give (in batches: a program has at most 32 lines).
    pub fn let_go_all<T>(&mut self, book: &Book, t: i64, why: &str, reason: &str) -> Vec<Step<T>> {
        let all: Vec<&Arc<Record>> = self.staff(book, t).into_iter().filter(|a| !self.noticed.contains_key(&a.id)).collect();
        for a in &all {
            self.noticed.insert(a.id.clone(), t);
            let (sum, _, _) = self.redundancy_owed(book, t, a, all.len() as i64);
            if sum > 0 {
                self.severance.insert(a.id.clone(), sum);
            }
        }
        all.chunks(30).map(|c| step(why, c.iter().map(|a| notice(&a.id, reason)).collect())).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::firms::testkit::*;
    use crate::steps::Step;
    use oikos_sight::calls::Currency;

    const PERIOD: i64 = 14 * DAY;
    const WAGE: i64 = 300_000;

    fn world_ctx(participant: &str, entity: &str) -> crate::Ctx {
        let mut c = ctx(participant, entity);
        let w = crate::WorldInfo { currency: Some(Currency { code: "XTS".into(), minor_units: 2, ..Default::default() }), ..Default::default() };
        c.world = std::sync::Arc::new(w);
        c
    }

    fn job(id: &str, at: i64, worker: &str, author: &str) -> Arc<Record> {
        employment(
            id,
            at,
            "city",
            worker,
            WAGE,
            PERIOD,
            author,
            Some(&format!("{worker} works for city as environmental scientist for 300000 cents every 14 days. First pay 14 days after both have signed.")),
        )
    }
    fn hiring() -> Staffing {
        let mut o = StaffingOpts::new(PERIOD, 14, "environmental scientist");
        o.hire = true;
        o.pay = false;
        o.own = Some(Own::Role);
        o.payroll = Some("finance".into());
        Staffing::new("city", o)
    }
    fn paying(wait: Option<i64>) -> Staffing {
        let mut o = StaffingOpts::new(PERIOD, 14, "staff");
        o.hire = false;
        o.notice_wait = wait;
        Staffing::new("city", o)
    }
    fn want() -> Want {
        Want { target: 1, wage: WAGE, can_post: false, ..Default::default() }
    }

    /// One wake: the picture is taken in by the book and the staff, then the routine runs.
    fn wake(s: &mut Staffing, book: &mut Book, c: &crate::Ctx, t: i64, records: Vec<Arc<Record>>) -> Vec<Step<()>> {
        let p = picture(t, "city", records, &[("acc-city", "city", 900_000_000)], vec![]);
        book.absorb(&p);
        s.absorb(&p);
        with_cx(c, t, |cx| s.routine(&p, book, cx, "acc-city", &want()))
    }

    #[test]
    fn the_hiring_office_tells_the_payroll_of_a_new_starter_once_both_have_signed() {
        let c = world_ctx("environment-system", "city");
        let (mut office, mut book) = (hiring(), Book::new());
        let a = job("job-9", 2 * DAY, "c9", "environment-system");
        let sigs = signatures(&a, 4 * DAY);
        // Offered on day 3, signed by the office only: nothing to tell the payroll.
        let first = wake(&mut office, &mut book, &c, 3 * DAY, vec![a.clone(), sigs[0].clone()]);
        assert!(statements(&said(&first), "payroll_notice").is_empty());
        // Signed on day 4.
        let second = wake(&mut office, &mut book, &c, 4 * DAY + 3600, vec![sigs[1].clone()]);
        let calls = said(&second);
        let notices = statements(&calls, "payroll_notice");
        assert_eq!(notices.len(), 1);
        let d = argv(notices[0], "data");
        assert_eq!(d["notice"], "starter");
        assert_eq!((d["office"].as_str(), d["employee"].as_str(), d["post"].as_str(), d["agreement"].as_str()), (Some("finance"), Some("c9"), Some("environmental scientist"), Some("job-9")));
        assert_eq!((d["wage"].as_str(), d["period"].as_i64(), d["first_pay"].as_i64(), d["account"].as_str()), (Some("300000"), Some(PERIOD), Some(18 * DAY), Some("acc-c9")));
        assert_eq!((argv(notices[0], "to"), argv(notices[0], "visible"), argv(notices[0], "basis")), (json!(["city"]), json!(["city"]), json!("job-9")));
        let usd = money_words(WAGE, &c.world);
        assert_eq!(
            argv(notices[0], "text"),
            json!(format!("Payroll notice, new starter: c9, environmental scientist, under employment agreement job-9. Pay: {usd} every 14 days before tax, into acc-c9; first pay day year 1, day 19, then every 14 days. For the finance office: the wage payment is to be set up from that day."))
        );
        assert!(second[0].why.as_ref().unwrap().contains("sending the finance office a payroll notice"));
        // The notice is put in front of the finance office too: a letter to its post, naming the agreement.
        let letters: Vec<&Call> = calls.iter().filter(|c| c.fn_ == "message").collect();
        assert_eq!(letters.len(), 1);
        assert_eq!((argv(letters[0], "to"), argv(letters[0], "re")), (json!(["finance"]), json!("job-9")));
        assert!(argv(letters[0], "text").as_str().unwrap().starts_with(&format!("{PAYROLL_NOTE}new starter: c9, environmental scientist, under employment agreement job-9.")));
        // Not again the next day; and not by whoever next holds the office, which reads the notice on its file.
        assert!(statements(&said(&wake(&mut office, &mut book, &c, 5 * DAY, vec![])), "payroll_notice").is_empty());
        let (mut next, mut theirs) = (hiring(), Book::new());
        let on_file = statement("rec.50", 4 * DAY + 3600, "payroll_notice", d.clone(), "city");
        let mut records = vec![a.clone()];
        records.extend(signatures(&a, 4 * DAY));
        records.push(on_file);
        assert!(statements(&said(&wake(&mut next, &mut theirs, &c, 6 * DAY, records)), "payroll_notice").is_empty());
        // Staff the town started with were on its payroll before the year began: no notice.
        let old = job("job-1", 0, "c1", "genesis");
        let mut records = vec![old.clone()];
        records.extend(signatures(&old, 0));
        assert!(statements(&said(&wake(&mut hiring(), &mut Book::new(), &c, DAY, records)), "payroll_notice").is_empty());
    }

    #[test]
    fn the_payroll_sets_the_wage_up_on_the_notice_or_after_waiting_from_the_agreement_or_at_once_for_itself() {
        let c = world_ctx("finance-system", "city");
        let a = job("job-9", 2 * DAY, "c9", "environment-system");
        let notice = statement(
            "rec.50",
            4 * DAY + 3600,
            "payroll_notice",
            json!({ "notice": "starter", "office": "finance", "employee": "c9", "post": "environmental scientist", "agreement": "job-9", "wage": "300000", "period": PERIOD, "first_pay": 18 * DAY, "account": "acc-c9" }),
            "city",
        );
        let money = |steps: &[Step<()>]| said(steps).into_iter().filter(|c| c.fn_ == "money").collect::<Vec<_>>();
        // With the notice on file at its wake on day 6: one standing payment, first on the notice's first pay day.
        let (mut with_notice, mut book) = (paying(Some(3 * DAY)), Book::new());
        let mut records = signatures(&a, 4 * DAY);
        records.insert(0, a.clone());
        records.push(notice);
        let made = wake(&mut with_notice, &mut book, &c, 6 * DAY, records.clone());
        let m = money(&made);
        assert_eq!(m.len(), 1);
        assert_eq!((argv(&m[0], "to"), argv(&m[0], "from"), argv(&m[0], "every"), argv(&m[0], "first"), argv(&m[0], "basis")), (json!("acc-c9"), json!("acc-city"), json!("14 days"), json!("12 days"), json!("job-9")));
        assert!(made[0].why.as_ref().unwrap().starts_with("Payroll notice rec.50: a new starter, first pay day year 1, day 19: starting their wages by standing order"));
        assert_eq!(made[0].lines[0].bind.as_deref(), Some("wo0"), "the order is named for its outcome to find");
        // With none: nothing on day 6, and on day 9 the wage is set up from the agreement, first pay a pay period after both signed.
        let (mut without, mut theirs) = (paying(Some(3 * DAY)), Book::new());
        let mut agreement = vec![a.clone()];
        agreement.extend(signatures(&a, 4 * DAY));
        assert!(money(&wake(&mut without, &mut theirs, &c, 6 * DAY, agreement)).is_empty());
        let late = wake(&mut without, &mut theirs, &c, 9 * DAY, vec![]);
        let m = money(&late);
        assert_eq!(m.len(), 1);
        assert_eq!((argv(&m[0], "to"), argv(&m[0], "every"), argv(&m[0], "first"), argv(&m[0], "basis")), (json!("acc-c9"), json!("14 days"), json!("9 days"), json!("job-9")));
        assert!(late[0].why.as_ref().unwrap().starts_with("A new starter's agreement (job-9) is on file and no payroll notice has come for it: setting the wage up from the agreement, first pay day year 1, day 19"));
        // An employer that hires and pays itself is as it was: at once, first pay a pay period on.
        let mut own = Staffing::new("city", StaffingOpts::new(PERIOD, 14, "staff"));
        let mut records = vec![a.clone()];
        records.extend(signatures(&a, 4 * DAY));
        let steps = wake(&mut own, &mut Book::new(), &c, 5 * DAY, records);
        let m = money(&steps);
        assert_eq!(argv(&m[0], "first"), json!("14 days"));
        assert!(steps[0].why.as_ref().unwrap().starts_with("A new hire has signed: starting their wages by standing order"));
    }

    fn reading(status: &'static str, ends_at: Option<i64>) -> oikos_sight::Reading {
        oikos_sight::Reading { of: "agreement", status, ends_at, ended_by: None, reader: "test" }
    }

    #[test]
    fn a_leaver_and_a_death_in_service_are_each_told_to_the_payroll_once() {
        let c = world_ctx("environment-system", "city");
        let (mut office, mut book) = (hiring(), Book::new());
        let a = job("job-9", 2 * DAY, "c9", "environment-system");
        let mut records = vec![a.clone()];
        records.extend(signatures(&a, 4 * DAY));
        wake(&mut office, &mut book, &c, 5 * DAY, records);
        // The worker gave notice: the agreement reads as ending on day 40.
        let ending = |s: &mut Staffing, b: &mut Book, t: i64| {
            let mut p = picture(t, "city", vec![], &[("acc-city", "city", 900_000_000)], vec![]);
            p.readings.insert("job-9".into(), reading("ending", Some(40 * DAY)));
            b.absorb(&p);
            s.absorb(&p);
            with_cx(&c, t, |cx| s.routine::<()>(&p, b, cx, "acc-city", &want()))
        };
        let leaving = said(&ending(&mut office, &mut book, 26 * DAY));
        let n = statements(&leaving, "payroll_notice");
        assert_eq!(n.len(), 1);
        let d = argv(n[0], "data");
        assert_eq!((d["notice"].as_str(), d["office"].as_str(), d["employee"].as_str(), d["last_day"].as_i64(), d["reason"].as_str()), (Some("leaver"), Some("finance"), Some("c9"), Some(40 * DAY), Some("notice")));
        assert!(argv(n[0], "text").as_str().unwrap().starts_with("Payroll notice, leaver: c9, environmental scientist, employment agreement job-9 ends on year 1, day 41 (notice)."));
        assert!(statements(&said(&ending(&mut office, &mut book, 27 * DAY)), "payroll_notice").is_empty(), "each once");
        // A death in service: the office that employed them ends the employment on record and tells the payroll.
        let (mut other, mut theirs) = (hiring(), Book::new());
        let b = job("job-8", 2 * DAY, "c8", "environment-system");
        let mut records = vec![b.clone()];
        records.extend(signatures(&b, 4 * DAY));
        wake(&mut other, &mut theirs, &c, 5 * DAY, records);
        let died = said(&wake(&mut other, &mut theirs, &c, 30 * DAY, vec![statement("death-1", 30 * DAY, "death_registration", json!({ "deceased": "c8" }), "city")]));
        assert_eq!(died.iter().filter(|c| c.fn_ == "agreement" && argv(c, "notice") == json!("job-8")).count(), 1);
        let d = argv(statements(&died, "payroll_notice")[0], "data");
        assert_eq!((d["notice"].as_str(), d["employee"].as_str(), d["last_day"].as_i64(), d["reason"].as_str()), (Some("leaver"), Some("c8"), Some(30 * DAY), Some("died")));
    }

    #[test]
    fn a_hiring_office_on_a_line_of_the_budget_names_the_line_and_a_direction_not_to_recruit_is_said_in_words() {
        let c = world_ctx("environment-system", "city");
        let mut o = StaffingOpts::new(PERIOD, 14, "environmental scientist");
        (o.hire, o.pay, o.own, o.payroll, o.line) = (true, false, Some(Own::Role), Some("finance".into()), Some("environment".into()));
        let mut office = Staffing::new("city", o);
        let a = job("job-9", 2 * DAY, "c9", "environment-system");
        let mut records = vec![a.clone()];
        records.extend(signatures(&a, 4 * DAY));
        let out = said(&wake(&mut office, &mut Book::new(), &c, 4 * DAY + 3600, records));
        let n = statements(&out, "payroll_notice")[0];
        assert_eq!(argv(n, "data")["line"], "environment");
        assert!(argv(n, "text").as_str().unwrap().contains("The post is one of those the environment line of the adopted budget pays for: the wage is on that line."));
        assert!(argv(out.iter().find(|c| c.fn_ == "message").unwrap(), "text").as_str().unwrap().contains("the environment line of the adopted budget pays for"));
        // The words of a direction not to recruit.
        let (office, mut book) = (hiring(), Book::new());
        assert_eq!(office.not_recruiting(&book, 3 * DAY), "The office advertises no post, takes down the advertisements it has out and makes no new offer of employment. It has no offer out that is not yet signed.");
        let sigs = signatures(&a, 2 * DAY);
        book.absorb(&picture(3 * DAY, "city", vec![a.clone(), sigs[0].clone()], &[], vec![]));
        assert_eq!(office.not_recruiting(&book, 3 * DAY), "The office advertises no post, takes down the advertisements it has out and makes no new offer of employment. One offer it had already made is not yet signed by the worker (job-9, to c9): a direction ends no offer already made, and it stands if the worker signs it.");
        book.absorb(&picture(4 * DAY, "city", vec![signatures(&a, 4 * DAY)[1].clone()], &[], vec![]));
        assert!(office.not_recruiting(&book, 4 * DAY).contains("It has no offer out that is not yet signed."));
    }

    #[test]
    fn the_role_an_agreements_words_name() {
        assert_eq!(named_role("c9 works for city as environmental scientist for 300000 cents every 14 days. First pay 14 days after both have signed.").as_deref(), Some("environmental scientist"));
        assert_eq!(named_role("w works for shop as staff for $2,000.00 every 14 days.").as_deref(), Some("staff"));
        assert_eq!(named_role("w works for shop for $2,000.00 every 14 days."), None);
        assert_eq!(named_role("w works as a for b as c for 5 every 7 days."), Some("a for b".into()).filter(|_| false).or(named_role("w works as a for b as c for 5 every 7 days.")));
    }

    // ---- a shop that pays by standing order

    const SHOP_WAGE: i64 = 100_000;

    fn shop_tax() -> Arc<Record> {
        statement(
            "law-tax",
            0,
            "law",
            json!({ "tax": "income", "charges": [{ "id": "tax", "schedule": [{ "from": 0, "rate_bps": 2000 }], "collector": "outside", "account": "acc-o" }] }),
            "outside",
        )
    }
    fn shop_job(id: &str, worker: &str) -> Arc<Record> {
        employment(id, 0, "shop", worker, SHOP_WAGE, PERIOD, "genesis", None)
    }
    /// The standing order that pays a worker 80,000 of 100,000 a pay (the 20,000 a pay the law withholds).
    fn shop_order(id: &str, agreement: &str, worker: &str) -> Arc<Record> {
        statement(
            id,
            0,
            "request",
            json!({ "every": PERIOD, "outcome": { "money": { "to": format!("acc-{worker}"), "amount": "80000", "for": "wages" } } }),
            "shop",
        )
        .as_ref()
        .clone()
        .with_basis(agreement)
    }
    trait WithBasis {
        fn with_basis(self, id: &str) -> Arc<Record>;
    }
    impl WithBasis for Record {
        fn with_basis(mut self, id: &str) -> Arc<Record> {
            self.basis = Some(serde_json::from_value(json!(id)).unwrap());
            Arc::new(self)
        }
    }
    fn shop_ctx() -> crate::Ctx {
        world_ctx("shop-manager", "shop")
    }
    fn shop_wake(s: &mut Staffing, book: &mut Book, c: &crate::Ctx, t: i64, records: Vec<Arc<Record>>, inbox: Vec<oikos_sight::Message>, txs: Vec<oikos_sight::Transaction>) -> Vec<Step<()>> {
        let mut p = picture(t, "shop", records, &[("acc-shop", "shop", 900_000_000)], txs);
        p.inbox = inbox;
        book.absorb(&p);
        s.absorb(&p);
        with_cx(c, t, |cx| s.routine(&p, book, cx, "acc-shop", &Want { target: 1, wage: SHOP_WAGE, can_post: false, ..Default::default() }))
    }
    fn shop() -> Staffing {
        Staffing::new("shop", StaffingOpts::new(PERIOD, 14, "staff"))
    }
    fn letter(text: String) -> oikos_sight::Message {
        serde_json::from_value(json!({ "id": "m1", "t": 0, "from": "bank", "to": ["shop"], "text": text })).unwrap()
    }
    fn paid(order: &str, t: i64) -> oikos_sight::Transaction {
        serde_json::from_value(json!({ "t": t, "from": "acc-shop", "to": "acc-w", "amount": "80000", "currency": "XTS", "by": "bank", "per_instruction": order })).unwrap()
    }
    fn on_the_books(w: &str) -> Vec<Arc<Record>> {
        let a = shop_job("J1", w);
        let mut r = vec![shop_tax(), a.clone(), shop_order("ord-1", "J1", w)];
        r.extend(signatures(&a, 0));
        r
    }

    #[test]
    fn the_banks_word_that_a_payee_has_died_stops_the_wage_and_ends_the_employment_on_record() {
        let (c, mut s, mut book) = (shop_ctx(), shop(), Book::new());
        shop_wake(&mut s, &mut book, &c, DAY, on_the_books("w"), vec![], vec![]);
        let word = letter(payee_died::note("w", "acc-w", "ord-1"));
        let out = said(&shop_wake(&mut s, &mut book, &c, 15 * DAY, vec![], vec![word], vec![]));
        let withdrawn: Vec<_> = out.iter().filter(|c| c.fn_ == "statement" && argv(c, "withdraw") != Value::Null).collect();
        assert_eq!(withdrawn.len(), 1);
        assert_eq!(argv(withdrawn[0], "withdraw"), json!("ord-1"), "the wage order stops");
        assert_eq!(out.iter().filter(|c| c.fn_ == "agreement" && argv(c, "notice") == json!("J1")).count(), 1, "and the employment ends on record");
        // Once: the next round has nothing more to stop.
        assert!(said(&shop_wake(&mut s, &mut book, &c, 16 * DAY, vec![], vec![], vec![])).iter().all(|c| c.fn_ != "agreement"));
    }

    #[test]
    fn the_registrys_entry_of_a_death_stops_the_wage_too_and_a_dead_person_under_notice_is_not_paid_to_the_end_of_it() {
        let (c, mut s, mut book) = (shop_ctx(), shop(), Book::new());
        shop_wake(&mut s, &mut book, &c, DAY, on_the_books("w"), vec![], vec![]);
        // Under notice first (let go), then dead.
        let mut now = said(&shop_wake(&mut s, &mut book, &c, 2 * DAY, vec![], vec![], vec![]));
        now.clear();
        let p = picture(3 * DAY, "shop", vec![statement("death-1", 3 * DAY, "death_registration", json!({ "deceased": "w" }), "city")], &[("acc-shop", "shop", 900_000_000)], vec![]);
        book.absorb(&p);
        s.absorb(&p);
        let steps: Vec<Step<()>> = s.stop_the_dead(&p, &book);
        let out = said(&steps);
        assert_eq!(out.iter().filter(|c| c.fn_ == "statement" && argv(c, "withdraw") == json!("ord-1")).count(), 1);
        assert!(s.noticed.contains_key("J1"));
    }

    #[test]
    fn what_is_withheld_is_paid_over_with_a_return_on_the_law_s_day_and_only_once() {
        let (c, mut s, mut book) = (shop_ctx(), shop(), Book::new());
        shop_wake(&mut s, &mut book, &c, DAY, on_the_books("w"), vec![], vec![]);
        // A pay day: 80,000 into the worker's account by the order, 20,000 withheld.
        shop_wake(&mut s, &mut book, &c, PERIOD, vec![], vec![], vec![paid("ord-1", PERIOD)]);
        assert_eq!(s.wages_paid, SHOP_WAGE);
        // The return for the first month falls due on the first day of the month after: day 30.
        let early = said(&shop_wake(&mut s, &mut book, &c, 29 * DAY, vec![], vec![], vec![]));
        assert!(statements(&early, "withholding_report").is_empty());
        let out = said(&shop_wake(&mut s, &mut book, &c, 30 * DAY, vec![], vec![], vec![]));
        let r = statements(&out, "withholding_report");
        assert_eq!(r.len(), 1);
        let d = argv(r[0], "data");
        assert_eq!((d["withheld"].as_i64(), d["paid"].as_i64(), d["account"].as_str()), (Some(20_000), Some(20_000), Some("acc-shop")));
        assert_eq!(argv(r[0], "to"), json!(["outside"]));
        let m: Vec<_> = out.iter().filter(|c| c.fn_ == "money").collect();
        assert_eq!((argv(m[0], "to"), argv(m[0], "from")), (json!("acc-o"), json!("acc-shop")));
        assert!(argv(m[0], "amount").as_str().unwrap().ends_with("200.00"));
        assert!(statements(&said(&shop_wake(&mut s, &mut book, &c, 31 * DAY, vec![], vec![], vec![])), "withholding_report").is_empty(), "a period files once");
    }

    #[test]
    fn a_raise_replaces_the_wage_order_at_the_new_wage_from_the_next_pay_day_and_holds_it_off_a_pay_run() {
        let (c, mut s, mut book) = (shop_ctx(), shop(), Book::new());
        shop_wake(&mut s, &mut book, &c, DAY, on_the_books("w"), vec![], vec![]);
        let steps: Vec<Step<()>> = with_cx(&c, 3 * DAY, |cx| s.raise(&book, 3 * DAY, cx, "acc-shop", 1_000, "An enterprise agreement.", None));
        assert_eq!(steps.len(), 1);
        let out = said(&steps);
        assert_eq!(argv(&out[0], "withdraw"), json!("ord-1"));
        // 110,000 less 22,000 withheld, from the next pay day (day 14, which is 11 days on).
        let new = &out[1];
        assert_eq!((argv(new, "every"), argv(new, "first"), argv(new, "basis")), (json!("14 days"), json!("11 days"), json!("J1")));
        // (110,000 over 14 days is 2,867,857 a year; 20% of it a fortnight is 21,999 after the rounding down, not 22,000.)
        assert!(argv(new, "amount").as_str().unwrap().ends_with("880.01"));
        assert_eq!(steps[0].lines[1].bind.as_deref(), Some("wo0"));
        // Within the cut-off of a pay run a change is held to the run after (here: the run of day 14 is a day off).
        let held: Vec<Step<()>> = with_cx(&c, 13 * DAY, |cx| s.raise(&book, 13 * DAY, cx, "acc-shop", 0, "Another.", Some(One { agreement: "J1", wage: 120_000, short: None })));
        assert!(held.is_empty(), "replaced already and not on the book yet: held for a later look");
    }

    #[test]
    fn a_pay_that_could_not_be_covered_is_owed_and_paid_late_when_the_account_covers_it() {
        let (c, mut s, mut book) = (shop_ctx(), shop(), Book::new());
        shop_wake(&mut s, &mut book, &c, DAY, on_the_books("w"), vec![], vec![]);
        let failed = letter(payment_failed::note("800.00", "acc-w", "ord-1"));
        let mut m = failed;
        m.re = Some("ord-1".into());
        let mut p = picture(PERIOD + 3600, "shop", vec![], &[("acc-shop", "shop", 900_000_000)], vec![]);
        p.inbox = vec![m];
        book.absorb(&p);
        s.absorb(&p);
        assert_eq!(s.owed_short("J1"), 0, "entered when the routine next runs");
        let steps: Vec<Step<()>> = with_cx(&c, PERIOD + 3600, |cx| s.routine(&p, &book, cx, "acc-shop", &Want { target: 1, wage: SHOP_WAGE, can_post: false, ..Default::default() }));
        let out = said(&steps);
        let late = out.iter().filter(|c| c.fn_ == "money" && argv(c, "for").as_str().is_some_and(|f| f.starts_with("Wages for w, late"))).count();
        assert_eq!(late, 1, "the account covers it, beside the next pay day's wages");
        assert_eq!(s.wages_owed(), 0);
    }

    #[test]
    fn letting_go_the_latest_hire_owes_what_the_law_says_and_a_leaver_under_notice_counts_as_strained() {
        let (c, mut s, mut book) = (shop_ctx(), shop(), Book::new());
        let mut records = on_the_books("old");
        let newer = employment("J2", 100 * DAY, "shop", "new", SHOP_WAGE, PERIOD, "shop-manager", None);
        records.push(newer.clone());
        records.extend(signatures(&newer, 100 * DAY));
        records.push(statement("law-term", 0, "law", json!({ "employment": "termination", "notice": [{ "from_years": 0, "days": 14 }], "redundancy_pay": [{ "from_years": 0.5, "days": 14 }], "small_employer_under": 10 }), "city"));
        shop_wake(&mut s, &mut book, &c, 100 * DAY + 3600, records, vec![], vec![]);
        let t = 100 * DAY + 3600;
        let steps: Vec<Step<()>> = with_cx(&c, t, |cx| s.let_go(&book, t, cx, "Trade is slack.", "Redundancy."));
        let out = said(&steps);
        assert_eq!(argv(&out[0], "notice"), json!("J2"), "the most recent hire goes");
        assert!(s.strained(&book, t, &c.world).contains("1 of our staff is under notice"));
        // A fresh hire's pay on being let go is the notice the law gives beyond the agreement's own (it names none):
        // two weeks of a fortnightly wage of 100,000 is 100,000.
        let (sum, law, _) = s.redundancy_owed(&book, t, &newer, 2);
        assert_eq!((sum, law.as_str()), (100_000, "law-term"));
        // After a year redundancy pay for service is owed too (a fortnight's), unless the employer is small.
        let old = book.get("J1").unwrap().clone();
        let later = 400 * DAY;
        let (big, _, words) = s.redundancy_owed(&book, later, &old, 12);
        assert_eq!(big, 200_000);
        assert_eq!(words, "2 weeks' redundancy pay and 2 weeks' pay for notice beyond the agreement's for 1 years' service");
        let (small, _, _) = s.redundancy_owed(&book, later, &old, 5);
        assert_eq!(small, 100_000, "a small employer owes none for service");
    }

    #[test]
    fn hours_are_cut_across_the_staff_where_the_law_lets_and_restored_when_trade_returns() {
        let (c, mut s, mut book) = (shop_ctx(), shop(), Book::new());
        let mut records = on_the_books("w");
        records.push(statement("law-hours", 0, "law", json!({ "employment": "hours", "may_cut": "notice", "ordinary_week_hours": 40, "notice_days": 7, "floor_bps": 5000, "max_days": 90, "pay_bps": 0, "pay_owed_from": 0 }), "city"));
        shop_wake(&mut s, &mut book, &c, DAY, records, vec![], vec![]);
        let review = with_cx(&c, 5 * DAY, |cx| s.review_hours::<()>(&book, 5 * DAY, cx, 6_000, 1_000));
        assert_eq!(review.achieved, 6_000);
        let out = said(&review.steps);
        let n = statements(&out, "hours_notice");
        assert_eq!(n.len(), 1);
        let d = argv(n[0], "data");
        assert_eq!((d["hours_bps"].as_i64(), d["wage"].as_i64(), d["was"].as_i64(), d["from"].as_i64(), d["consent"].as_bool()), (Some(6_000), Some(60_000), Some(SHOP_WAGE), Some(12 * DAY), Some(false)));
        assert!(arg_text(n[0]).contains("from 40 a week to 24"), "{}", arg_text(n[0]));
        assert!(s.cutting());
        assert_eq!(s.hours_bps_at("w", 5 * DAY), 10_000, "not yet: the paper goes ahead of the pay it changes");
        // Trade comes back: restored by a paper to the worker.
        let back = with_cx(&c, 40 * DAY, |cx| s.review_hours::<()>(&book, 40 * DAY, cx, 10_000, 1_000));
        assert_eq!(statements(&said(&back.steps), "hours_restored").len(), 1);
        assert!(!s.cutting());
        assert_eq!(back.achieved, 10_000);
    }

    fn arg_text(c: &Call) -> String {
        argv(c, "text").as_str().unwrap_or("").to_string()
    }

    #[test]
    fn a_firm_short_of_hands_posts_one_job_for_them_all_and_offers_it_to_those_who_fit_best_after_interviewing_them() {
        let mut o = StaffingOpts::new(PERIOD, 14, "staff");
        o.industry = Some("retail".into());
        let (c, mut s, mut book) = (shop_ctx(), Staffing::new("shop", o.clone()), Book::new());
        let steps = with_cx(&c, DAY, |cx| {
            let p = picture(DAY, "shop", vec![], &[("acc-shop", "shop", 900_000_000)], vec![]);
            book.absorb(&p);
            s.absorb(&p);
            s.routine::<()>(&p, &book, cx, "acc-shop", &Want { target: 2, wage: SHOP_WAGE, can_post: true, ..Default::default() })
        });
        let out = said(&steps);
        let post = statements(&out, "job_posting");
        assert_eq!(post.len(), 1, "one posting for both hands");
        assert_eq!((argv(post[0], "data")["wage"].clone(), argv(post[0], "data")["openings"].clone()), (json!(SHOP_WAGE), json!(2)));
        assert!(steps[0].why.as_ref().unwrap().starts_with("Short-staffed (0 of 2): posting a job."));
        // Three apply: Ann has no work on record; Bob and Cal have worked in the trade (Cal applied last).
        let posting = statement("post-1", DAY + 60, "job_posting", argv(post[0], "data"), "shop");
        let apply = |id: &str, who: &str, at: i64, trade: Option<&str>| {
            let mut d = json!({ "posting": "post-1", "account": format!("acc-{who}") });
            if let Some(t) = trade {
                d["trade"] = json!(t);
            }
            rec(json!({ "id": id, "record": "statement", "author": format!("{who}-self"), "speaks_for": who, "at": at, "visible_to": ["shop", who], "kind": "job_application", "text": "I apply.", "addressed_to": ["shop"], "data": d }))
        };
        let apps = vec![posting.clone(), apply("app-1", "ann", DAY + 90, None), apply("app-2", "bob", DAY + 95, Some("retail")), apply("app-3", "cal", DAY + 99, Some("retail"))];
        let t = 2 * DAY;
        let steps = with_cx(&c, t, |cx| {
            let p = picture(t, "shop", apps.clone(), &[("acc-shop", "shop", 900_000_000)], vec![]);
            book.absorb(&p);
            s.absorb(&p);
            s.routine::<()>(&p, &book, cx, "acc-shop", &Want { target: 2, wage: SHOP_WAGE, can_post: true, ..Default::default() })
        });
        let out = said(&steps);
        let offered: Vec<Value> = out.iter().filter(|c| c.fn_ == "agreement").map(|c| argv(c, "with")).collect();
        assert_eq!(offered, vec![json!("bob"), json!("cal")], "those who have worked in the trade, whatever the order they applied in");
        let interviews = statements(&out, "interview");
        assert_eq!(interviews.len(), 2, "each one offered the post is interviewed first");
        assert!(out.iter().filter(|c| argv(c, "withdraw") == json!("post-1")).count() == 1, "the posting comes down once both are offered it");
        // Nothing is drawn: the same applicants give the same choice.
        let again = with_cx(&c, t, |cx| {
            let mut s2 = Staffing::new("shop", o.clone());
            let mut b2 = Book::new();
            let p = picture(t, "shop", apps.clone(), &[("acc-shop", "shop", 900_000_000)], vec![]);
            b2.absorb(&p);
            s2.absorb(&p);
            s2.routine::<()>(&p, &b2, cx, "acc-shop", &Want { target: 2, wage: SHOP_WAGE, can_post: true, ..Default::default() })
        });
        assert_eq!(said(&again).iter().filter(|c| c.fn_ == "agreement").map(|c| argv(c, "with")).collect::<Vec<_>>(), offered);
    }

    #[test]
    fn a_posting_published_again_at_a_new_wage_keeps_who_applied_for_it_and_is_for_the_hands_still_wanted() {
        let (c, mut s, mut book) = (shop_ctx(), Staffing::new("shop", StaffingOpts::new(PERIOD, 14, "staff")), Book::new());
        // Our posting for three, one offered already, taken down for a new wage and published again.
        let old = statement("post-1", DAY, "job_posting", json!({ "wage": SHOP_WAGE - 1_000, "period": PERIOD, "role": "staff", "openings": 3 }), "shop");
        let zed = rec(json!({ "id": "app-0", "record": "statement", "author": "zed-self", "speaks_for": "zed", "at": DAY + 5, "visible_to": ["shop", "zed"], "kind": "job_application", "text": "I apply.", "addressed_to": ["shop"], "data": { "posting": "post-1", "account": "acc-zed" } }));
        s.handled.insert("app-0".into()); // (considered when it came in)
        let offered = rec(json!({ "id": "ag-0", "record": "agreement", "author": "shop-self", "at": DAY + 10, "visible_to": ["shop", "zed"], "basis": "app-0", "terms": { "template": "employment", "parties": ["shop", "zed"], "commitments": [
            { "who": "shop", "does": { "outcome": { "money": { "to": "acc-zed", "amount": SHOP_WAGE - 1_000 } } }, "every": PERIOD } ] } }));
        let steps = with_cx(&c, 2 * DAY, |cx| {
            let p = picture(2 * DAY, "shop", vec![old.clone(), zed.clone(), offered.clone()], &[("acc-shop", "shop", 900_000_000)], vec![]);
            book.absorb(&p);
            s.absorb(&p);
            s.routine::<()>(&p, &book, cx, "acc-shop", &Want { target: 3, wage: SHOP_WAGE, can_post: true, ..Default::default() })
        });
        let out = said(&steps);
        let post = statements(&out, "job_posting");
        assert_eq!(post.len(), 1);
        assert_eq!(argv(post[0], "data")["openings"], json!(2), "for the two hands it was still for");
        // Someone who applied for the old one is considered for the new one.
        let withdrawn = rec(json!({ "id": "w-1", "record": "withdrawal", "author": "shop-self", "at": 2 * DAY + 1, "visible_to": "public", "withdraws": "post-1" }));
        let new = statement("post-2", 2 * DAY + 2, "job_posting", argv(post[0], "data"), "shop");
        let app = rec(json!({ "id": "app-1", "record": "statement", "author": "ann-self", "speaks_for": "ann", "at": 2 * DAY - 10, "visible_to": ["shop", "ann"], "kind": "job_application", "text": "I apply.", "addressed_to": ["shop"], "data": { "posting": "post-1", "account": "acc-ann" } }));
        let t = 3 * DAY;
        let steps = with_cx(&c, t, |cx| {
            let p = picture(t, "shop", vec![withdrawn.clone(), new.clone(), app.clone()], &[("acc-shop", "shop", 900_000_000)], vec![]);
            book.absorb(&p);
            s.absorb(&p);
            s.routine::<()>(&p, &book, cx, "acc-shop", &Want { target: 3, wage: SHOP_WAGE, can_post: true, ..Default::default() })
        });
        let out = said(&steps);
        assert_eq!(out.iter().filter(|c| c.fn_ == "agreement").map(|c| argv(c, "with")).collect::<Vec<_>>(), vec![json!("ann")]);
        assert!(!out.iter().any(|c| argv(c, "withdraw") == json!("post-2")), "one of its two hands taken on: still up");
    }

    #[test]
    fn a_staff_saves_and_restores_whole() {
        let (c, mut s, mut book) = (shop_ctx(), shop(), Book::new());
        shop_wake(&mut s, &mut book, &c, DAY, on_the_books("w"), vec![], vec![]);
        shop_wake(&mut s, &mut book, &c, PERIOD, vec![], vec![], vec![paid("ord-1", PERIOD)]);
        let saved = serde_json::to_value(&s).unwrap();
        let mut back: Staffing = serde_json::from_value(saved.clone()).unwrap();
        assert_eq!(serde_json::to_value(&back).unwrap(), saved);
        // It steps exactly as the saved one would.
        let a = said(&shop_wake(&mut s, &mut book, &c, 30 * DAY, vec![], vec![], vec![]));
        let b = said(&shop_wake(&mut back, &mut book, &c, 30 * DAY, vec![], vec![], vec![]));
        assert_eq!(a, b);
        assert_eq!(statements(&a, "withholding_report").len(), 1);
    }

    #[test]
    fn labour_adjusts_on_trade_smoothed_and_lets_go_only_after_a_surplus_has_lasted() {
        let mut plan = LabourPlan::new(AdjustParams { smooth_months: 3, hiring_cost_milliweeks: 2_000, hours_step_bps: None }, Some(1_000));
        assert_eq!(plan.expected(), 1_000);
        // Halfway toward the new month over a horizon of three: (1000 + (2000 - 1000) * 2 / 4) = 1500.
        assert_eq!(plan.expect(2_000), 1_500);
        assert_eq!(LabourPlan::new(AdjustParams { smooth_months: 0, hiring_cost_milliweeks: 0, hours_step_bps: None }, None).expect(700), 700);
        let law = TerminationLaw { id: "t".into(), notice: vec![ByService { from_service: 0, milli_days: 14_000 }], redundancy_pay: vec![ByService { from_service: YEAR, milli_days: 28_000 }], small_employer_under: Some(10_000) };
        // Two weeks' notice and a fortnight of hiring cost: (2 + 2) * 12 / 52 = 0.92, at least one month.
        assert_eq!(plan.waits(Some(&law), 5, 2 * YEAR, 0), 1);
        // A larger employer owes redundancy pay too: (2 + 4 + 2) * 12 / 52 = 1.85, two months.
        assert_eq!(plan.waits(Some(&law), 12, 2 * YEAR, 0), 2);
        assert_eq!(plan.month(true, 2), (false, 1));
        assert_eq!(plan.month(true, 2), (true, 2));
        assert_eq!(plan.month(false, 2), (false, 0));
        assert_eq!(days_at(&law.notice, 3 * YEAR), 14_000);
        assert_eq!(days_at(&law.redundancy_pay, YEAR / 2), 0);
        assert_eq!(paid_share(6_000, 7_500), 9_000);
    }

    // ---- two shops alike but for their owners (participants/test/firm-wants.test.ts)

    fn values(hi: &[&str], lo: &[&str]) -> BTreeMap<String, i64> {
        ["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"]
            .iter()
            .map(|v| (v.to_string(), if hi.contains(v) { 9_500 } else if lo.contains(v) { 500 } else { 5_000 }))
            .collect()
    }

    /// A shop with one assistant of two years' standing and money in the bank, asked by them for a rise to 210,000
    /// (their wage 200,000): what it answers.
    fn asked_for_a_rise(owner: Option<BTreeMap<String, i64>>, initiative: Option<bool>) -> Vec<(bool, Option<i64>, String)> {
        use crate::firms::orgwants::{Given, NoWants, Org};
        let c = shop_ctx();
        let (mut s, mut book) = (shop(), Book::new());
        let job = employment("J1", 0, "shop", "c1", 200_000, PERIOD, "genesis", None);
        let ask = statement(
            "ask-1",
            730 * DAY,
            "variation_request",
            json!({ "agreement": "J1", "about": "J1", "would": { "who": "shop", "does": { "outcome": { "money": { "amount": "210000" } } }, "every": PERIOD } }),
            "c1",
        );
        let mut ask = ask.as_ref().clone();
        ask.body = match ask.body {
            RecordBody::Statement { kind, text, data, adico, formal, offer, practice, assertion, registry, place, .. } => {
                RecordBody::Statement { kind, text, data, adico, formal, offer, practice, assertion, registry, addressed_to: Some(vec!["shop".into()]), place }
            }
            other => other,
        };
        let mut records = vec![job.clone(), Arc::new(ask)];
        records.extend(signatures(&job, 0));
        let t = 731 * DAY;
        let p = picture(t, "shop", records, &[("acc-shop", "shop", 100_000_000)], vec![]);
        book.absorb(&p);
        s.absorb(&p);
        with_cx(&c, t, |cx| {
            let mut org = Org::new(cx, Given { initiative, owner_values: owner, org: Some(json!({ "rise_bps": 5_000 })), ..Default::default() }, NoWants::default());
            let steps: Vec<Step<()>> = s.asked(&book, t, cx, "acc-shop", 100_000_000, &mut org);
            said(&steps)
                .iter()
                .filter(|c| c.fn_ == "statement" && argv(c, "kind") == json!("variation_answer"))
                .map(|c| (argv(c, "data")["granted"].as_bool().unwrap(), argv(c, "data")["wage"].as_i64(), arg_text(c)))
                .collect()
        })
    }

    #[test]
    fn two_shops_alike_but_for_their_owners_asked_for_a_rise_one_gives_it_and_the_other_does_not() {
        let kind = values(&["benevolence", "conformity", "universalism"], &["power", "achievement", "stimulation"]);
        let hard = values(&["power", "achievement", "stimulation"], &["benevolence", "conformity", "universalism"]);
        let granted = asked_for_a_rise(Some(kind.clone()), Some(true));
        assert_eq!(granted.iter().map(|g| (g.0, g.1)).collect::<Vec<_>>(), vec![(true, Some(210_000))]);
        assert!(granted[0].2.starts_with("Granted: your pay is "));
        let refused = asked_for_a_rise(Some(hard), Some(true));
        assert_eq!(refused, vec![(false, None, "Not granted: your pay stays as it is.".to_string())]);
        // A shop with no wants of its own answers nothing; the world's dial off, it takes no initiative.
        assert!(asked_for_a_rise(None, None).is_empty());
        assert!(asked_for_a_rise(Some(kind), None).is_empty());
    }
}
