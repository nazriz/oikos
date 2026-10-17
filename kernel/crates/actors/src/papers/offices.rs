//! Papers written by lane offices's modules (docs/port-guide.md, section 5; conventions in papers/mod.rs): the public
//! offices of a town (the registry, the mayor and the council clerk, planning, the inspector, the works and rates
//! offices, the electoral office, the tribunal and its registrar, the desk, the police, the school, the utilities
//! and the support office's forms) and the kinds every office reads whoever wrote them (a law, a procedure, a form, a
//! budget, a standing work order, a hold, a direction, the staff's report).
//!
//! Sources: participants/src/behaviour/{government, institutions, police, tribunal, desk, school, elections,
//! utilities, books, papers, common}.ts and worlds/generator/generate.ts (what a town opens with). Where a kind is
//! written by a code office and by the same office's form (papers.ts, `FormWrites`), one type reads both: a form's
//! `=name` writes a decimal string and `#name` a whole number, and the `lenient` readers take either. Writing is
//! always a number. Fields a TS writer leaves `undefined` are `Option`s.
//!
//! The lists at the bottom say which kinds these offices read or write that are typed in another file.

use super::{lenient, Paper};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Every kind typed in this file, in name order.
pub const KINDS: &[&str] = &[
    "acquisition_notice",
    "approval",
    "asset_register",
    "ballot",
    "ballot_result",
    "birth_registration",
    "budget",
    "building_notice",
    "complaint_notice",
    "death_certificate",
    "death_registration",
    "demolition_order",
    "direction",
    "disposal_docket",
    "election_notice",
    "electoral_roll",
    "enforcement_decline",
    "form",
    "garnishee_order",
    "hearing",
    "hearing_notice",
    "hold",
    "investigation_closed",
    "law",
    "law_schedule",
    "lot",
    "nomination",
    "offer_declined",
    "office_books",
    "permit_application",
    "permit_decision",
    "petition_response",
    "procedure",
    "proposal",
    "rates_notice",
    "repair_declined",
    "repair_done",
    "school_certificate",
    "school_decline",
    "school_place",
    "service_address",
    "staff_report",
    "supply_end",
    "transmission_application",
    "tribunal_order",
    "valuation_request",
    "venue_decision",
    "warrant",
    "warrant_executed",
    "warrant_lapsed",
    "water_restrictions",
    "work_order",
];

// ================================================================== kinds every office reads

/// A hold (contracts/calls.md, `statement(hold=X)`): an instruction to whoever acts on a standing paper (a bank on a
/// payment instruction, an office on a direction given to it, an office's staff on a standing work order, an
/// employer's people on an advertisement) not to act on it while the hold stands. It does nothing by itself.
///
/// Written by: the kernel, resolving a seat's `hold` (code offices write none). Read by: `Book::onHold`
/// (common.ts: `StandingWork`, `Directions`, every office that honours one), bank.ts (payment instructions), firms.ts.
/// What readers rely on: the hold counts only when made in the name of whoever the held paper speaks for. It is
/// lifted by withdrawing it, which the book sees as the paper no longer standing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hold {
    /// The ids of the papers held (one statement may hold several).
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub holds: Vec<String>,
}
impl Paper for Hold {
    const KIND: &'static str = "hold";
}

/// What a standing work order is for (the `work` block of its data).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkSpec {
    /// The task: a routine of the office (`collect`, `levy`, `enact`, `answer`, `carry_out_warrants` ...).
    pub task: String,
    /// Where it is done (a structure, a space, or the office's name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    /// What it is done to. (A seat's order may give one id or a list; both read.)
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub on: Vec<String>,
    /// Who is to do it (none: whoever of the staff is there).
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub by: Vec<String>,
    /// How much each time (none: as much as it takes).
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub units: Option<i64>,
}

/// A standing work order (contracts/calls.md, "A standing work order"): work an organisation's own staff are to do
/// again and again, on the organisation's own file, until it is replaced, withdrawn or put on hold. Which task, where,
/// how often, perhaps on what, by whom, from when and until when. Nothing is done when it is made; the staff follow it
/// each time it falls due, in their own hours.
///
/// Written by: the kernel, resolving `work(task, at, every ...)` (a seat's own words, or code offices' `routines.set`
/// in common.ts `StandingWork.set`); and genesis (`order-<office>-<task>`, in force when the year began, with
/// `by_procedure`). Read by: common.ts `StandingWork` (every office with `routines`), roster.ts, llm/counter.ts.
/// Also read by: the translator and the seat renderer.
/// What readers rely on: `every` is seconds (nought or absent where `schedule` names the paper that sets when);
/// `first` seconds after it was lodged, or `first_at` a moment; `until` a moment (seconds from the world's start).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkOrder {
    pub work: WorkSpec,
    /// How often, in seconds. Absent where `schedule` is given.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub every: Option<i64>,
    /// The paper that sets when (a rating law's instalments), in place of `every`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    /// How long after it is lodged it starts, seconds.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub first: Option<i64>,
    /// The moment the day begins that it starts on, where the call gave a date.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub first_at: Option<i64>,
    /// The moment it ends.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
    /// The procedure that states this routine's rhythm, where the order was made at that rhythm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by_procedure: Option<String>,
}
impl Paper for WorkOrder {
    const KIND: &'static str = "work_order";
}

/// One order's line in a staff report: how it stands.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReportedOrder {
    /// The order's id (none for a routine with no order on file).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
    pub task: String,
    /// Seconds between times; nought where the order has none or names a `schedule`.
    #[serde(deserialize_with = "lenient::int")]
    pub every: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    /// `followed`, `no_order`, `no_such_task`, `replaced`, `on_hold`, `not_begun`, `ended`, `not_carried_out`.
    pub state: String,
    /// Why it was not carried out, where it was not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    /// How many times it was carried out, and how many units of work, since the last report.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub times: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub units: Option<i64>,
    /// The line in words.
    pub says: String,
}

/// One of the staff in a staff report: when they last worked, and whether their agreement names a place of work.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReportedStaff {
    pub person: String,
    /// The moment they last worked under an order, and at which task.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub last: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    /// True where neither their employment agreement nor the advertisement it cites names a place of work.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_place: Option<bool>,
}

/// The staff's report to their office on the work under its standing work orders: what was done under each order,
/// or that one is not being carried out and why, and who of the staff has worked. Filed when how an order stands has
/// changed, and about weekly otherwise; on the organisation's own file, seen by it alone.
///
/// Written by: common.ts `StandingWork.report` (every office with a staff part: government, institutions, police,
/// tribunal, desk, school, utilities, works). Read by: roster.ts (`Roster.report`, `orders`, `text`), daybook.ts (not
/// counted as an act). Also read by: llm renderers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StaffReport {
    /// The post whose staff they are (`works`, not `works-staff`).
    pub office: String,
    /// When the previous report was made.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,
    pub orders: Vec<ReportedOrder>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub staff: Vec<ReportedStaff>,
}
impl Paper for StaffReport {
    const KIND: &'static str = "staff_report";
}

/// A written direction to an office (contracts/calls.md, "A direction to an office"): a form filled in on an office's
/// own form for a direction it takes, addressed to the office's organisation and citing the form. The office follows
/// one from those its organisation's rule names, or doesn't. The fields are the form's own; these are the ones the
/// town's offices read, by form: `inspector_enforcement` (`fines`, `fine`), `rates_recovery` (`interest`),
/// `works_collection` (`every`), and the staffing forms (`recruit`, `posts`). A field of another form is ignored.
///
/// Written by: seats (the kernel resolves `form(...)`), never by code. Read by: common.ts `Directions`; government.ts
/// (rates officer, works), institutions.ts (inspector), environment.ts and others through `staffingUnder`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Direction {
    /// `inspector_enforcement`: `yes` or `no`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fines: Option<String>,
    /// `inspector_enforcement`: the fine, cents (a form writes an amount as a decimal string).
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub fine: Option<i64>,
    /// `rates_recovery`: `yes` or `no`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interest: Option<String>,
    /// `works_collection`: seconds between collections.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub every: Option<i64>,
    /// Staffing forms: `yes` or `no`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recruit: Option<String>,
    /// Staffing forms: the most posts to fill.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub posts: Option<i64>,
}
impl Paper for Direction {
    const KIND: &'static str = "direction";
}

/// A line of a budget: cents by name. (See [`Budget`].)
pub type BudgetLines = BTreeMap<String, i64>;

/// The town's budget for a year, adopted by the council: its lines, in cents. The year is counted from one: year 1 is
/// days 0 to 364.
///
/// Written by: government.ts (the council clerk, publishing what a passed ballot enacts, with the ballot as its
/// basis); genesis (`budget-year-1`, before the run). Read by: government.ts (finance officer, mayor, works),
/// roster.ts, the staffing code (`budget.data.lines[line]`), openbooks-townhall.ts.
/// What readers rely on: each line is cents; the latest budget for a year stands.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Budget {
    #[serde(deserialize_with = "lenient::int")]
    pub year: i64,
    pub lines: BudgetLines,
}
impl Paper for Budget {
    const KIND: &'static str = "budget";
}

// ------------------------------------------------------------------ laws

/// A figure a law carries: its value as held, and the unit it is held in (seconds for a duration).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LawFigureValue {
    #[serde(deserialize_with = "lenient::int")]
    pub value: i64,
    pub unit: String,
}

/// A law: a rule of the town or of the world outside, in words, with the breakdown (`adico`) and the rule (`formal`,
/// a CEL condition) as fields of the statement beside its data. This is its data. The data differs by the kind of
/// law, and a reader looks for the fields of the law it wants:
/// - a law made from figures by a schedule (rent increases, tenancy, industrial action, or any the council makes or
///   amends): `schedule` and `figures`; an amended one also names the law it `replaces`;
/// - the rates law (`tax: "rates"`): `rate_ppm` (parts per million of value a year), `instalments`, `due_days`,
///   `penalty_interest_bps`;
/// - the income tax law (`tax: "income"`): `charges` and `returns` (typed in firms.rs, `tax`), and in older worlds
///   `rate_bps` and `penalty_bps`;
/// - the support law (`support: "payments"`): `payments` (typed in firms.rs);
/// - the decisions law: `decisions`, a list of rules (typed in finance.rs, `decisions`);
/// - the law on possession (`tenancy: "possession"`), on ending a job (`employment: "termination"`) and on cutting
///   hours (`employment: "hours"`): their own figures, below.
/// Others (the river law, the elections law, the habitat law, the law on pay during action) have no data.
///
/// Written by: genesis (worlds/generator/generate.ts); government.ts (the council clerk, a passed amendment, via
/// `enactAmendment`; a law in free words enacted from a ballot, with the `enact.data` the proposal gave). Read by:
/// common.ts (`prohibitions`, `breaches`, `holdsOf` read the statement's `adico` and `formal`), government.ts (rates
/// officer, tax clerk, clerk), decisions.ts (`decisionLaw`, `appealLaw`), firms.ts (`possessionLaw`,
/// `terminationLaw`, `hoursLaw`), citizen.ts, openbooks-venues.ts, tax.ts.
/// What readers rely on: durations are seconds, shares basis points, `rate_ppm` parts per million; the latest
/// standing law of a kind wins.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Law {
    // ---- made from figures
    /// The schedule it was written by (the id of a `law_schedule`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    /// Its figures, by name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub figures: BTreeMap<String, LawFigureValue>,
    /// The law in force that this one took the place of.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaces: Option<String>,
    // ---- taxes and payments
    /// `rates` or `income`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub rate_ppm: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub instalments: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub due_days: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub penalty_interest_bps: Option<i64>,
    /// Income tax, older form of a flat rate (read by the tax clerk, written by no generator now).
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub rate_bps: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub penalty_bps: Option<i64>,
    /// Income tax: the charges on pay (firms.rs), and when returns are due (firms.rs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub charges: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns: Option<Value>,
    /// The support law: `payments`, and the payments (firms.rs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub support: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payments: Option<Value>,
    /// The decisions law: a list of rules (finance.rs, `decisions`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decisions: Vec<Value>,
    // ---- possession of a let home
    /// `possession`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tenancy: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub arrears_days: Option<i64>,
    /// Also the hours law's notice, in days.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub notice_days: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub possession_days: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub plan_months: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub warrant_days: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub eviction_notice_days: Option<i64>,
    /// Who carries out warrants (the police).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enforced_by: Option<String>,
    /// `may`, `must` or `none`: whether the tribunal may or must consider a plan to pay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_consider: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub plan_barred_rent_months: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub cure_days: Option<i64>,
    // ---- employment
    /// `termination` or `hours`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub employment: Option<String>,
    /// Termination: the least notice and the redundancy pay by years of service, lists of `{from_years, days}`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redundancy_pay: Option<Value>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub small_employer_under: Option<i64>,
    /// Hours: `notice`, `consent` or `no`; the ordinary week in hours; the notice in days (`notice_days`, above);
    /// the floor, the longest spell, the pay owed and from what size of employer, the share who must agree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub may_cut: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub ordinary_week_hours: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub floor_bps: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub max_days: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub pay_bps: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub pay_owed_from: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub consent_bps: Option<i64>,
}
impl Paper for Law {
    const KIND: &'static str = "law";
}

/// A figure of a law as its schedule declares it. A duration is held in seconds and worded in `unit`; a count is held
/// in `held_in` (default: its unit), `per_unit` of them to one `unit`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LawFigureSpec {
    /// `duration` or `count`; also the type of the figure's field on the law's amendment form.
    #[serde(rename = "type")]
    pub type_: String,
    pub unit: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub held_in: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub per_unit: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The law may do without it (given as nought, it is taken as not given).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub optional: Option<bool>,
}

/// A law schedule: how a law made from figures is written from them. In `text`, each `adico` part and `formal`,
/// `{name}` stands for a figure as worded and `{name:seconds}` for the number as held; clauses on optional figures
/// are written `<<separator;;clause;;clause>>`. World content: the council clerk knows no particular law.
///
/// Written by: genesis (worlds/law/schedules.json, every schedule a town is given). Read by: government.ts (the
/// council clerk: `schedules`, `amendment`, `enactAmendment`, via common.ts `draftLaw`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LawSchedule {
    pub title: String,
    /// The name of its amendment form (default `amend_<schedule>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form: Option<String>,
    pub figures: BTreeMap<String, LawFigureSpec>,
    pub text: String,
    /// The Institutional Grammar breakdown: attribute, deontic, aim, condition ...
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub adico: BTreeMap<String, String>,
    /// The rule, a CEL condition, if acts can be checked against the law.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formal: Option<String>,
}
impl Paper for LawSchedule {
    const KIND: &'static str = "law_schedule";
}

// ------------------------------------------------------------------ procedures

/// Who approves a payment over what sum: the payments procedure's rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApprovalRule {
    /// The post (whoever holds it).
    pub by: String,
    /// The sum over which approval is needed, cents.
    #[serde(deserialize_with = "lenient::int")]
    pub over: i64,
}

/// Who may direct the town's offices: the posts, and, for an office that has its own rule, the posts for it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DirectionRule {
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub by: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub offices: BTreeMap<String, Vec<String>>,
}

/// A paper kind an office's staff deal with at its counter, and how.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoutinePaper {
    pub kind: String,
    pub how: String,
}

/// One routine of an office, as its procedure states it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Routine {
    pub task: String,
    /// Where it is done.
    pub at: String,
    /// Its rhythm in seconds, or the paper that sets when (a rating law's instalments).
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub every: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    /// The papers the counter deals with under it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub papers: Vec<RoutinePaper>,
}

/// The council's standing orders as figures.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CouncilRule {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub proposers: Vec<String>,
    pub form: String,
    #[serde(deserialize_with = "lenient::int")]
    pub vote_days: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub members: i64,
}

/// The town's rule on petitions as figures.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PetitionRule {
    #[serde(deserialize_with = "lenient::int")]
    pub threshold_bps: i64,
    /// The adults the share is of, when the year began.
    #[serde(deserialize_with = "lenient::int")]
    pub of: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub signatures: i64,
}

/// A procedure: how an office or the town does its business, in words, with the figures its code or its readers go by.
/// Several, by the part present: `approval` (the payments procedure); `directions` (who may direct the town's
/// offices); `routines` and `office` (an office's routine work, written by genesis for each office with a staff part:
/// `proc-<office>-routines`); `council` (the council's standing orders); `petitions` (the rule on petitions);
/// `law` with the plan fields (a procedure that restates the law on possession's plan).
///
/// Written by: genesis only (worlds/generator/generate.ts); a seat may write more in words, which read as no data.
/// Read by: common.ts (`approvalOf`, `Directions.may`), llm/counter.ts (`CounterView`: `routines`), the staffing
/// and rates code (`routines` rhythms are followed through `StandingWork`), openbooks-venues.ts.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Procedure {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<ApprovalRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directions: Option<DirectionRule>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routines: Vec<Routine>,
    /// The office whose routines these are, where the town gives it a counter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub office: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub council: Option<CouncilRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub petitions: Option<PetitionRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub law: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_consider: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub plan_months: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub plan_barred_rent_months: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub cure_days: Option<i64>,
}
impl Paper for Procedure {
    const KIND: &'static str = "procedure";
}

// ------------------------------------------------------------------ forms

/// A field of a form.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FormField {
    /// `text`, `amount`, `count`, `duration`, `date`, `choice`, `record`, `entity`, `account`, `structure`, `lot`,
    /// `structure_type`, `list` ... (typed in `rules::forms`).
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    /// A law's amendment form: the unit the figure is worded in, and how many held to one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub per_unit: Option<i64>,
}

/// A form: an office's stationery, or the town's public forms (the council proposal form, the permit form, a law's
/// amendment form, a direction form). Filled in, it is a statement of kind `submit_as`. An office's own stationery
/// (`office`, `writes`) says how the fields are written into the statement; the form registry itself is data in
/// `rules::forms` (this is how a town carries it on file, and what a seat is shown).
///
/// Written by: genesis (`stationeryForm`, `directionForm`, `amendmentForm`, and the council proposal and permit
/// forms in worlds/generator/generate.ts). Read by: common.ts (`Directions`: `office`, `form`), government.ts (the
/// council clerk: `amends`, `form`; the councillors; the mayor's petitions), the translator, the seat renderers.
/// The order of a form's fields is not kept (a map by name).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Form {
    /// The form's name (`council_proposal`, `permit_application`, `works_staffing` ...).
    pub form: String,
    /// The office whose own form it is (none: a public form).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub office: Option<String>,
    /// The kind of statement filling it in makes.
    pub submit_as: String,
    #[serde(default, deserialize_with = "lenient::ids")]
    pub submit_to: Vec<String>,
    /// A law's amendment form: the id of the law schedule it amends.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amends: Option<String>,
    #[serde(default)]
    pub fields: BTreeMap<String, FormField>,
    /// How the fields are written into the statement (contracts: FormWrites; typed in `rules::forms`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writes: Option<Value>,
}
impl Paper for Form {
    const KIND: &'static str = "form";
}

// ------------------------------------------------------------------ land, as the offices hold it

/// A lot of land: the cells it covers. The land registry's plan of the lot.
///
/// Written by: genesis (one per lot, `speaks_for` the land registry). Read by: common.ts (`Book.lotSeen`,
/// `cellsOf`, the lot covering a cell), government.ts, institutions.ts, utilities.ts. The land registry alone is
/// shown the register whole; others ask it for one lot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Lot {
    pub cells: Vec<String>,
}
impl Paper for Lot {
    const KIND: &'static str = "lot";
}

/// One entry of the town's asset register: a lot the town holds, and one building on it (none: nothing built).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Asset {
    pub lot: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cells: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
}

/// The town's asset register: the land the town holds, with what stood on each lot when it was made up. A paper, not
/// a sight: what stands there today is known by going to look.
///
/// Written by: genesis (`asset-register`, seen by the town alone). Read by: institutions.ts `ownLand` (the mayor, the
/// planning officer, the works office).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssetRegister {
    pub assets: Vec<Asset>,
}
impl Paper for AssetRegister {
    const KIND: &'static str = "asset_register";
}

/// An address on the works office's collection round: a building people live in.
///
/// Written by: genesis (`round-<structure>`). Read by: government.ts (the works office's round).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServiceAddress {
    pub structure: String,
    /// The cell it stands at.
    pub at: String,
}
impl Paper for ServiceAddress {
    const KIND: &'static str = "service_address";
}

// ================================================================== government.ts

/// What a passed proposal enacts: the paper to be made (`law`, `budget`), its words, and its data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Enact {
    /// `law` or `budget`.
    pub kind: String,
    pub text: String,
    /// A law's Institutional Grammar breakdown (from a petition's demand).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub adico: BTreeMap<String, String>,
    /// A law's rule, `{ language, condition }` (from a petition's demand).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formal: Option<Value>,
    /// A budget's data: `{ year, lines }` ([`Budget`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// A proposal to the council. Two shapes: the mayor's (a budget it tables, or a petition's demand put as a law or as
/// an amendment) carries `enact` and `tags`; one made on a form (the council proposal form, or a law's amendment form)
/// carries that form's fields: `proposal` (the words), `kind` (`law`, `budget`, `other`), `affects`, `year`, and
/// then a field for each budget line (cents; a decimal string on the form) or each law figure (a count in the figure's
/// unit, or a duration in seconds), which are kept in `fields` by name.
///
/// Written by: government.ts (mayor: `proposal`); genesis (`budget-year-1-proposal`); seats and councillors
/// (`motion`) on the forms. Read by: government.ts (the council clerk: `amendment`, `fromForm`, `formTags`; the
/// councillors' tags come from the ballot).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Proposal {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enact: Option<Enact>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub affects: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub year: Option<i64>,
    /// The form's other fields by name: a budget's lines, a law's figures.
    #[serde(flatten)]
    pub fields: BTreeMap<String, Value>,
}
impl Paper for Proposal {
    const KIND: &'static str = "proposal";
}

/// The mayor's written approval of an invoice, which the payments procedure asks for over a sum.
///
/// Written by: government.ts (mayor); the mayor's form. Read by: government.ts (finance officer, matched by the post
/// that made it), openbooks-townhall.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Approval {
    pub invoice: String,
}
impl Paper for Approval {
    const KIND: &'static str = "approval";
}

/// The mayor's answer to a petition, to its organiser and in public.
///
/// Written by: government.ts (mayor); the mayor's form. Read by: openbooks-townhall.ts (ids named in its words).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PetitionResponse {
    pub petition: String,
    pub answer: String,
}
impl Paper for PetitionResponse {
    const KIND: &'static str = "petition_response";
}

/// A nomination for an elected office, lodged with the electoral body.
///
/// Written by: government.ts (the mayor standing again), citizen.ts (candidates, in their own words or on the form);
/// the mayor's form. Read by: elections.ts (the electoral office: `office`, `name`), news.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Nomination {
    pub office: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incumbent: Option<bool>,
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub values: Vec<String>,
}
impl Paper for Nomination {
    const KIND: &'static str = "nomination";
}

/// A candidate on an election ballot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Candidate {
    /// The author of the nomination.
    pub candidate: String,
    /// The number on the ballot paper, as text.
    pub number: String,
    /// Whom the candidate speaks for.
    #[serde(rename = "for", default, skip_serializing_if = "Option::is_none")]
    pub for_: Option<String>,
    pub name: String,
    pub nomination: String,
}

/// A ballot. Two shapes. The council's: `proposal`, `options` (`yes`, `no`), `closes_at`, `electorate: "council"`,
/// `tags` (`budget`, `tenant_protection`, `development`), and for a ballot held before the run, `closed` and `result`.
/// An election's: `office`, `electorate: "roll"`, the `candidates`, the `method`, when voting `opens_at` and
/// `closes_at`, and `options` (the numbers on the ballot paper). Votes are records of their own (`vote`), not papers.
///
/// Written by: government.ts (the council clerk: council ballots); elections.ts (the electoral office); genesis
/// (`budget-year-1-ballot`, closed). Read by: government.ts (clerk, councillors: `closes_at`, `electorate`, `tags`,
/// `closed`), elections.ts, citizen.ts (voting), tally.ts, openbooks-townhall.ts, llm/render.ts.
/// What readers rely on: times are seconds from the world's start; a vote counts only while it is open.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Ballot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposal: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub closes_at: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub opens_at: Option<i64>,
    /// `council` or `roll`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub electorate: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// A ballot held and closed before the year began.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed: Option<bool>,
    /// Its result paper, where it was declared before the run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub office: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<Candidate>,
    /// `preferential` or `plurality`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
}
impl Paper for Ballot {
    const KIND: &'static str = "ballot";
}

/// The declared result of a ballot. Three shapes: the council's (`ballot`, `yes`, `no`, `passed`, and who voted for
/// and against, by post); an election's (`ballot`, `office`, `winner`, the `rounds` of the count, `formal` votes,
/// `electors`, `turnout_bps`), or, with one candidate or none, `office`, `winner`, `unopposed` and the number of
/// `candidates`; the union's protected-action ballot (`employer`, `ballot`, `voted`, `eligible`, `yes`, `passed`).
///
/// Written by: government.ts (the council clerk); elections.ts (the electoral office); union.ts (finance.rs's
/// union: `employer`, `voted`, `eligible`, `yes`, `passed`); genesis (`budget-year-1-result`). Read by:
/// government.ts (the clerk: `ballot`, `passed`, `yes`, `no`; the seating of `winner`), tally.ts, citizen.ts (the
/// union's: `employer`, `voted`, `yes`), openbooks-townhall.ts, openbooks-venues.ts, llm/render.ts.
/// What readers rely on: counts are whole numbers; `turnout_bps` basis points; `winner` is a participant id.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct BallotResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ballot: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub yes: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub no: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_yes", skip_serializing_if = "Option::is_none")]
    pub passed: Option<bool>,
    /// The council's: the posts that voted each way.
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub voted_for: Vec<String>,
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub voted_against: Vec<String>,
    /// An election's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub office: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub winner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unopposed: Option<bool>,
    /// Unopposed or none: how many were nominated.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub candidates: Option<i64>,
    /// Each round of the count: votes by candidate.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rounds: Vec<BTreeMap<String, i64>>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub formal: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub electors: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub turnout_bps: Option<i64>,
    /// The union's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub employer: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub voted: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub eligible: Option<i64>,
}
impl Paper for BallotResult {
    const KIND: &'static str = "ballot_result";
}

/// A rates notice to an owner of land: what is owed on their lots for the instalment, when, and where to pay.
///
/// Written by: government.ts (the rates officer, with a `rates` claim beside it, both citing the rating law). Read
/// by: common.ts `ratesNotice` (a payment that names the notice pays the claim recorded with it), citizen.ts and
/// firms.ts landlords (paying rates). What readers rely on: `amount` and `due` match the claim's `about`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RatesNotice {
    /// Cents.
    #[serde(deserialize_with = "lenient::int")]
    pub amount: i64,
    pub lots: Vec<String>,
    /// The moment it falls due.
    #[serde(deserialize_with = "lenient::int")]
    pub due: i64,
    /// The account to pay into.
    pub account: String,
}
impl Paper for RatesNotice {
    const KIND: &'static str = "rates_notice";
}

/// A docket for a load of waste taken to the landfill.
///
/// Written by: government.ts (the works office, weekly; its form). Read by: world.ts (the landfill's monthly invoice,
/// by `kind` and `quantity`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DisposalDocket {
    pub kind: String,
    #[serde(deserialize_with = "lenient::int")]
    pub quantity: i64,
}
impl Paper for DisposalDocket {
    const KIND: &'static str = "disposal_docket";
}

// ================================================================== institutions.ts

/// An application for a planning permit: the lot, and the kind of building.
///
/// Written by: the mayor's office (`form permit_application`), firms.ts developers, citizen.ts, seats on the permit
/// form. Read by: institutions.ts (the planning officer: both fields required, else the decision is `incomplete`),
/// government.ts (the mayor's own applications).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PermitApplication {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure_type: Option<String>,
}
impl Paper for PermitApplication {
    const KIND: &'static str = "permit_application";
}

/// The planning office's decision on a permit application, to the applicant, citing the application. A grant is also
/// recorded as a liberty to build (a `liberty` record, not a paper). A refusal can be asked about again, and on a
/// second look is granted in a new paper that names the review and the refusal it replaces.
///
/// Written by: institutions.ts (the planning officer); the planning form. Read by: government.ts (mayor, builder
/// commissions), firms.ts (developers), openbooks-townhall.ts, decisions.ts (reconsideration).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PermitDecision {
    pub application: String,
    /// `granted`, `refused` or `incomplete`.
    pub decision: String,
    /// The law that forbids it (a refusal, or a grant against the law).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub law: Option<String>,
    /// For `incomplete`: the fields the application lacks (`lot`, `structure_type`).
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub missing: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// A grant on review: the request, and the refusal replaced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_review: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaces: Option<String>,
}
impl Paper for PermitDecision {
    const KIND: &'static str = "permit_decision";
}

/// A request to the valuer for a supplementary valuation: of a lot with a building newly built, or of a lot after one
/// was brought down.
///
/// Written by: institutions.ts (the inspector); the inspector's form. Read by: world.ts (the valuer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ValuationRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure_type: Option<String>,
    /// A building brought down.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed: Option<String>,
}
impl Paper for ValuationRequest {
    const KIND: &'static str = "valuation_request";
}

/// An order to demolish a building built in breach of a law, to its owner.
///
/// Written by: institutions.ts (the inspector, with a fine beside it as a claim); the inspector's form. Read by:
/// firms.ts (landlords and developers who own the building).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DemolitionOrder {
    pub structure: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lot: Option<String>,
    pub law: String,
}
impl Paper for DemolitionOrder {
    const KIND: &'static str = "demolition_order";
}

/// The builder declines a construction agreement: the site is taken, or the price offered is below its own.
///
/// Written by: institutions.ts (`firm.builder`). Read by: the client's code or seat (the mayor, developers).
/// What readers rely on: `price`, where given, is the builder's price in cents (TS wrote it as a string).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OfferDeclined {
    pub agreement: String,
    /// `site_taken`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub price: Option<i64>,
}
impl Paper for OfferDeclined {
    const KIND: &'static str = "offer_declined";
}

/// Notice of building work, to the town (and whoever else connects services): a building begun, or one being brought
/// down. A begun building names its lot, the cell, the structure and its type; a demolition names the structure
/// `removes`.
///
/// Written by: institutions.ts (`firm.builder`, to its `notify` list). Read by: institutions.ts (the inspector, the
/// asset register `ownLand`), government.ts (mayor, works round), utilities.ts (water customers), environment.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BuildingNotice {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lot: Option<String>,
    /// The cell it stands at.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client: Option<String>,
    /// The structure being brought down.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removes: Option<String>,
}
impl Paper for BuildingNotice {
    const KIND: &'static str = "building_notice";
}

/// The builder declines or gives up a repair order.
///
/// Written by: institutions.ts (`firm.builder`). Read by: firms.ts (landlords: the building's repair), openbooks.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepairDeclined {
    pub order: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    /// Why: `the order is not one we can read`, `the money has not come`, `unknown_structure`, `refused` ...
    pub reason: String,
}
impl Paper for RepairDeclined {
    const KIND: &'static str = "repair_declined";
}

/// The builder reports a repair done.
///
/// Written by: institutions.ts (`firm.builder`). Read by: firms.ts (landlords), openbooks.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepairDone {
    pub order: String,
    pub structure: String,
    #[serde(deserialize_with = "lenient::int")]
    pub units: i64,
}
impl Paper for RepairDone {
    const KIND: &'static str = "repair_done";
}

/// Notice that land has changed hands, to those who keep a roll from such notices (the valuer, the water corporation).
///
/// Written by: institutions.ts (the land registry, on each transfer of a title). Read by: utilities.ts (the water
/// corporation's customer roll), world.ts (the valuer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AcquisitionNotice {
    pub lot: String,
    pub owner: String,
    /// The title (a claim) that passed.
    pub title: String,
}
impl Paper for AcquisitionNotice {
    const KIND: &'static str = "acquisition_notice";
}
/// An entry in the register of deaths, sent to whoever reported the death, to those they named, and to those the
/// registry feeds as of right. The register is the registry's; nobody else is shown it whole.
///
/// Written by: institutions.ts (the registrar); the registry's form (`reported_by`, `partner`, `children`,
/// `without_adult`); genesis (people dead before the run have none). Read by: bank.ts, firms.ts (employers, landlords),
/// fund.ts, payroll.ts, school.ts, elections.ts (the roll), institutions.ts (child protection: `without_adult`),
/// openbooks*.ts, world.ts. What readers rely on: `deceased` is a participant id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeathRegistration {
    pub deceased: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reported_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partner: Option<String>,
    /// Always written (a list, empty if none).
    #[serde(default, deserialize_with = "lenient::ids")]
    pub children: Vec<String>,
    /// Children left with no adult at home (child protection takes them into care). Always written.
    #[serde(default, deserialize_with = "lenient::ids")]
    pub without_adult: Vec<String>,
}
impl Paper for DeathRegistration {
    const KIND: &'static str = "death_registration";
}

/// A certified copy of a registered death's entry, sent to a later informant.
///
/// Written by: institutions.ts (the registrar); the registry's form. Read by: firms.ts, openbooks.ts,
/// openbooks-townhall.ts (as a registration).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeathCertificate {
    pub deceased: String,
    /// The entry in the register.
    pub registration: String,
}
impl Paper for DeathCertificate {
    const KIND: &'static str = "death_certificate";
}

/// An application to the land registry for a dead owner's land to pass to their heir.
///
/// Written by: institutions.ts (the registrar); the registry's form. Read by: institutions.ts (the land registry).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransmissionApplication {
    pub deceased: String,
    pub heir: String,
}
impl Paper for TransmissionApplication {
    const KIND: &'static str = "transmission_application";
}

/// An entry in the register of births, sent to whoever reported the birth and to those the registry feeds.
///
/// Written by: institutions.ts (the registrar); the registry's form. Read by: world.ts (the population estimate
/// counts them). What readers rely on: `born_at` is seconds from the world's start.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BirthRegistration {
    pub child: String,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub born_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mother: Option<String>,
}
impl Paper for BirthRegistration {
    const KIND: &'static str = "birth_registration";
}

// ================================================================== police.ts

/// The police close a report of goods taken: nothing found to say who took them.
///
/// Written by: police.ts; the police form. Read by: the reporter (retailer.ts, producer.ts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InvestigationClosed {
    pub report: String,
    pub solved: bool,
}
impl Paper for InvestigationClosed {
    const KIND: &'static str = "investigation_closed";
}

/// A warrant of possession ran out before an officer could carry it out; the landlord must ask again.
///
/// Written by: police.ts; the police form. Read by: firms.ts and openbooks.ts (landlords: `lease`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WarrantLapsed {
    pub warrant: String,
    pub lease: String,
}
impl Paper for WarrantLapsed {
    const KIND: &'static str = "warrant_lapsed";
}

/// A warrant of possession carried out: how many of the household were there and were put out. Possession is the
/// landlord's whether or not anyone was there.
///
/// Written by: police.ts; the police form. Read by: citizen.ts (tenants: `lease`), firms.ts and openbooks.ts
/// (landlords), tribunal.ts (the registrar: `warrant`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WarrantExecuted {
    pub warrant: String,
    pub lease: String,
    pub tenant: String,
    pub space: String,
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub household: Vec<String>,
    /// How many were put out.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub removed: Option<i64>,
}
impl Paper for WarrantExecuted {
    const KIND: &'static str = "warrant_executed";
}

// ================================================================== tribunal.ts, desk.ts

/// What a venue says it hears: the matters (as the world's labels), and the fee to apply, where it charges one. Its
/// offer (the statement's `offer`, with `hears` and the fee as a commitment) is what a person takes up.
///
/// Written by: desk.ts `hearingNotice` for the tribunal, a desk or ombudsman, a union and a founded body. Read by:
/// desk.ts (a venue that has said it hears), the translator and the seat renderer (the offer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hearing {
    pub hears: Vec<String>,
    /// Cents, where applying costs.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub fee: Option<i64>,
}
impl Paper for Hearing {
    const KIND: &'static str = "hearing";
}
/// A venue's notice of an application, to the applicant and the one it is against: what it is, and the day the other
/// side may answer by. The tribunal's lists a case for a hearing day (`hearing_at`); a desk gives the answer day
/// (`answer_by`, equal to `hearing_at`) and echoes what the application said (`about`, `amount`, `structure`, `seeks`).
/// `matter` is present on a notice written by desk.ts `Hearings`; its absence marks the tribunal's own older lists
/// (rent increase, debt, charge), which its member decides itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Notice {
    pub application: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matter: Option<String>,
    pub applicant: String,
    pub against: String,
    /// The day of the hearing, or the day to answer by: a moment, seconds.
    #[serde(deserialize_with = "lenient::int")]
    pub hearing_at: i64,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub answer_by: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seeks: Option<String>,
}

/// The tribunal's notice of hearing (a [`Notice`]).
///
/// Written by: tribunal.ts (the member or its registry; the tribunal's forms), desk.ts `Hearings` for the matters on
/// its lists; genesis (the opening caseload). Read by: tribunal.ts and desk.ts (`Hearings`: the cases listed, by
/// `hearing_at` and `answer_by`), citizen.ts (a tenant: possession, `against`, `about`), openbooks*.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct HearingNotice(pub Notice);
impl Paper for HearingNotice {
    const KIND: &'static str = "hearing_notice";
}

/// A desk's notice of an application (a [`Notice`]).
///
/// Written by: desk.ts `Hearings` (a desk, an ombudsman); the desk's form; genesis. Read by: desk.ts `Hearings`,
/// frictions.ts (`Respondent`: answering from its books), openbooks-venues.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ComplaintNotice(pub Notice);
impl Paper for ComplaintNotice {
    const KIND: &'static str = "complaint_notice";
}

/// A venue's decision on an application. `finding` is `pay`, `do`, `set_aside`, `settled`, `dismissed`, `rejected`,
/// `referred`, `plan` or `possession` (a tribunal adds `valid`, `invalid`, `paid`). Which other fields are present
/// follows the finding: a `pay` has `amount`, `to` (the account) and `due`; a `do` a `due`; `possession` the date
/// `due`, the arrears `amount` and the home (`space`, `structure`, `household`); a `plan` the `amount` owed, the
/// `instalment` a month and `to`; an invalid notice the `laws` it breaches; a charge proven the `victim`, `report`.
/// A rejected application carries only `application`, `kind` and the finding.
///
/// Money is cents, times seconds. `binding` is true for an order, false for a recommendation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Decision {
    pub application: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applicant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub against: Option<String>,
    pub finding: String,
    #[serde(default, deserialize_with = "lenient::opt_yes", skip_serializing_if = "Option::is_none")]
    pub binding: Option<bool>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub waited_days: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seeks: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub instalment: Option<i64>,
    /// The account to pay into (or, in a referral, the office it went to).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub due: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub household: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// A rent increase: the notice judged, and the laws it breaches.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub laws: Vec<String>,
    /// A charge proven.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub victim: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report: Option<String>,
    /// A debt: the claim, and what the respondent said it had paid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub paid: Option<i64>,
    /// Flags a dismissal carries: no particulars stated; the notice relied on gave too few days; out of time;
    /// the tenant had left.
    #[serde(default, deserialize_with = "lenient::opt_yes", skip_serializing_if = "Option::is_none")]
    pub no_particulars: Option<bool>,
    #[serde(default, deserialize_with = "lenient::opt_yes", skip_serializing_if = "Option::is_none")]
    pub notice_short: Option<bool>,
    #[serde(default, deserialize_with = "lenient::opt_yes", skip_serializing_if = "Option::is_none")]
    pub out_of_time: Option<bool>,
    #[serde(default, deserialize_with = "lenient::opt_yes", skip_serializing_if = "Option::is_none")]
    pub left: Option<bool>,
}

/// The tribunal's order or decision on an application (a [`Decision`]): the finding, to both sides.
///
/// Written by: tribunal.ts (the member), desk.ts `Hearings` (the matters on the tribunal's lists); the member's
/// forms; genesis. Read by: citizen.ts (tenants and creditors: `finding`, `matter`, `against`, `about`), firms.ts
/// and openbooks.ts (landlords: possession), tribunal.ts (the registrar: `finding`, `due`, `to`, `amount`,
/// `applicant`, `space`, `structure`, `household`, `about`), reading.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TribunalOrder(pub Decision);
impl Paper for TribunalOrder {
    const KIND: &'static str = "tribunal_order";
}

/// A desk's decision on an application (a [`Decision`]).
///
/// Written by: desk.ts `Hearings` (a desk, an ombudsman, a mediation service); the desk's form; genesis. Read by:
/// citizen.ts (`matter`, `applicant`, `finding`), openbooks-venues.ts, reading.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct VenueDecision(pub Decision);
impl Paper for VenueDecision {
    const KIND: &'static str = "venue_decision";
}
/// The registrar's decline: a request to enforce something that is not an order for this creditor, or for a warrant
/// on something that is not an order for possession to this applicant. It says so in words; no data.
///
/// Written by: tribunal.ts (the registrar); the registrar's form. Read by: openbooks-venues.ts (by its basis).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct EnforcementDecline {}
impl Paper for EnforcementDecline {
    const KIND: &'static str = "enforcement_decline";
}

/// An order to the debtor's banks to pay an unpaid order from what they hold for the debtor.
///
/// Written by: tribunal.ts (the registrar); the registrar's form. Read by: bank.ts (a bank, for a court it
/// recognises: `courts`), openbooks-venues.ts. What readers rely on: `amount` is cents; `to` the account to pay.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GarnisheeOrder {
    /// The order enforced.
    pub order: String,
    pub debtor: String,
    #[serde(deserialize_with = "lenient::int")]
    pub amount: i64,
    pub to: String,
    /// The debt's claim (the order itself where it rests on none).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<String>,
}
impl Paper for GarnisheeOrder {
    const KIND: &'static str = "garnishee_order";
}

/// A warrant of possession, to whoever carries the tribunal's warrants out (the police): the home, the tenant and
/// their household, and the days it may be carried out between. Nothing is done by the paper: someone must go.
///
/// Written by: tribunal.ts (the registrar); the registrar's form. Read by: police.ts (`order`, `lease`, `tenant`,
/// `landlord`, `structure`, `space`, `household`, `not_before`, `until`), tribunal.ts (to withdraw it), firms.ts and
/// openbooks*.ts (landlords). What readers rely on: `not_before` and `until` are moments, seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Warrant {
    pub order: String,
    /// The lease the possession is of (the order's `about`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<String>,
    pub tenant: String,
    pub landlord: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    #[serde(default, deserialize_with = "lenient::ids", skip_serializing_if = "Vec::is_empty")]
    pub household: Vec<String>,
    #[serde(deserialize_with = "lenient::int")]
    pub not_before: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub until: i64,
}
impl Paper for Warrant {
    const KIND: &'static str = "warrant";
}

// ================================================================== school.ts

/// A place at the school, given to a child of school age: the classroom, and the building. The child's roll.
///
/// Written by: school.ts (the principal); genesis (a place for each pupil the world starts with). Read by: school.ts
/// (the roll), citizen.ts (a child goes to school; its classroom).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct SchoolPlace {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub classroom: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub building: Option<String>,
}
impl Paper for SchoolPlace {
    const KIND: &'static str = "school_place";
}

/// The school declines an enrolment: not of school age. Words only.
///
/// Written by: school.ts. Read by: nobody's code.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct SchoolDecline {}
impl Paper for SchoolDecline {
    const KIND: &'static str = "school_decline";
}

/// A household's word that it asks to stop being supplied (water, power and the like), with a last bill to follow.
/// It carries no data; who it is from (`speaks_for`) and the supplier it is addressed to are all it says.
///
/// Written by: a seat (free statement; no code writer or form in the TS). Read by: utilities.ts (the supplier: the
/// customer is dropped from its roll).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SupplyEnd {}
impl Paper for SupplyEnd {
    const KIND: &'static str = "supply_end";
}

/// A certificate of years of school completed, to a pupil past school age.
///
/// Written by: school.ts. Read by: citizen.ts (attainment).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SchoolCertificate {
    pub person: String,
    #[serde(deserialize_with = "lenient::int")]
    pub years: i64,
    /// The school.
    pub school: String,
}
impl Paper for SchoolCertificate {
    const KIND: &'static str = "school_certificate";
}

// ================================================================== elections.ts

/// Notice of an election: the office, the poll, when nominations close, and the method of voting.
///
/// Written by: elections.ts (the electoral office); the electoral form. Read by: government.ts (the mayor stands
/// again while nominations are open), citizen.ts (candidates, electors), news.ts. What readers rely on: times are
/// moments, seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElectionNotice {
    pub office: String,
    #[serde(deserialize_with = "lenient::int")]
    pub poll_at: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub nominations_close_at: i64,
    /// `preferential` or `plurality`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
}
impl Paper for ElectionNotice {
    const KIND: &'static str = "election_notice";
}

/// The electoral roll for an election: the electors, as enrolled and still living in the town. The office's own;
/// nobody is sent it.
///
/// Written by: elections.ts. Read by: elections.ts (the count checks each vote against it).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElectoralRoll {
    pub electors: Vec<String>,
    #[serde(deserialize_with = "lenient::int")]
    pub poll_at: i64,
}
impl Paper for ElectoralRoll {
    const KIND: &'static str = "electoral_roll";
}

// ================================================================== utilities.ts

/// The water corporation's announcement that the river cannot give what the town uses (`since`), or that
/// restrictions are lifted (`lifted`). Public.
///
/// Written by: utilities.ts. Read by: citizen.ts (water use).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct WaterRestrictions {
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub lifted: Option<i64>,
}
impl Paper for WaterRestrictions {
    const KIND: &'static str = "water_restrictions";
}
// ================================================================== books.ts

/// One entry of an office's books: something that stands open.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpenItem {
    /// The heading it stands under.
    pub what: String,
    /// What it is about (an id).
    pub about: String,
    /// The line in words.
    pub says: String,
    /// Since when, a moment.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,
    /// An amount in cents, where it has one.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
    /// A day it falls due, a moment.
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub due: Option<i64>,
}

/// How many matters wait on the office-holder with their day come, and how many are new on the list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DaysList {
    #[serde(deserialize_with = "lenient::int")]
    pub ripe: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub new: i64,
}

/// A heading whose list was cut: how many entries it leaves out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OverItem {
    pub what: String,
    #[serde(deserialize_with = "lenient::int")]
    pub not_listed: i64,
}

/// The paper an office's clerk files on the organisation's own file when what stands open at the office has changed:
/// what is new, what is settled, and the whole list for whoever opens it. Seen by the organisation alone; a code
/// office has none.
///
/// Written by: books.ts (`Clerk.due`, for a staff post of an office a model holds). Read by: daybook.ts (not counted
/// as an act); the seat renderers (`list` brings the office-holder back).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OfficeBooks {
    pub office: String,
    /// The moment it was made up.
    #[serde(deserialize_with = "lenient::int")]
    pub at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list: Option<DaysList>,
    pub open: Vec<OpenItem>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub over: Vec<OverItem>,
}
impl Paper for OfficeBooks {
    const KIND: &'static str = "office_books";
}

// ================================================================== written here too, typed in another file
//
// Read or written by these offices, with a main writer in another lane (the file in brackets; each must be typed
// there):
//
// - `invoice` (market.rs; written here by the builder, the water corporation and the energy retailer), `price_list`
//   (market.rs; the builder's `prices` and `demolition`), `benefit_decision`, `benefit_end`, `case_for_decision`
//   (market.rs; the desk writes it too, with `application`, `matter`, `applicant`, `against` and the whole `case`),
//   `support_statistics`, `valuation`, `property_roll`, `population_estimate`, `habitat_register`, `crime_report`
//   (market.rs, written in world.ts and trade.ts).
// - `tribunal_application` (firms.rs; written here by the police as a charge: `kind: "charge"`, `victim`, `report`),
//   `tribunal_reply`, `warrant_request`, `rent_increase`, `notice_to_vacate`, `repair_order`, `tax_report`,
//   `payroll_notice`, `job_posting` (firms.rs).
// - `death_notification` (citizen.rs; written here by the police), `birth_notification`, `enforcement_request`,
//   `school_enrolment`, `enrolment`, `departure`, `care_request`, `petition`, `petition_count`, `complaint`,
//   `benefit_claim`, `benefit_change` (citizen.rs).
// - `tribunal_response`, `application`, `complaint_response`, `remedy_answer`, `request`, `evidence`,
//   `review_request`, `loan_*`, `signatories`, `news`, `wage_claim` and the union's papers (finance.rs).
// - `vote`, `claim`, `claim_transfer`, `withdrawal`: records of the contract, not statements.
// - `public_form` (the tribunal's possession answer form): the data of a [`Form`], kind `public_form`.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::papers::{data, is, read};
    use oikos_sight::Record;
    use serde_json::json;

    fn statement(kind: &str, d: Value) -> Record {
        serde_json::from_value(json!({
            "id": "rec.1", "author": "someone", "at": 100, "visible_to": "public",
            "record": "statement", "kind": kind, "text": "words", "data": d
        }))
        .unwrap()
    }

    /// Reads a record as `P`, then writes it back and checks it reads the same.
    fn round<P: Paper + PartialEq + std::fmt::Debug>(d: Value) -> P {
        let r = statement(P::KIND, d);
        assert!(is::<P>(&r));
        let p = read::<P>(&r).expect("reads");
        let again: P = serde_json::from_value(data(&p)).expect("written data reads");
        assert_eq!(p, again);
        p
    }

    #[test]
    fn every_kind_is_listed_once_and_sorted() {
        let mut sorted = KINDS.to_vec();
        sorted.sort();
        assert_eq!(sorted, KINDS.to_vec(), "KINDS is in name order");
        sorted.dedup();
        assert_eq!(sorted.len(), KINDS.len());
    }

    #[test]
    fn every_type_is_in_kinds() {
        let all = [
            AcquisitionNotice::KIND, Approval::KIND, AssetRegister::KIND, Ballot::KIND, BallotResult::KIND,
            BirthRegistration::KIND, Budget::KIND, BuildingNotice::KIND,
            ComplaintNotice::KIND, DeathCertificate::KIND,
            DeathRegistration::KIND, DemolitionOrder::KIND, Direction::KIND, DisposalDocket::KIND,
            ElectionNotice::KIND, ElectoralRoll::KIND, EnforcementDecline::KIND, Form::KIND, GarnisheeOrder::KIND,
            Hearing::KIND, HearingNotice::KIND, Hold::KIND, InvestigationClosed::KIND, Law::KIND,
            LawSchedule::KIND, Lot::KIND, Nomination::KIND, OfferDeclined::KIND, OfficeBooks::KIND,
            PermitApplication::KIND, PermitDecision::KIND, PetitionResponse::KIND, Procedure::KIND, Proposal::KIND,
            RatesNotice::KIND, RepairDeclined::KIND, RepairDone::KIND, SchoolCertificate::KIND, SchoolDecline::KIND,
            SchoolPlace::KIND, ServiceAddress::KIND, StaffReport::KIND, SupplyEnd::KIND, TransmissionApplication::KIND,
            TribunalOrder::KIND, ValuationRequest::KIND, VenueDecision::KIND,
            Warrant::KIND, WarrantExecuted::KIND, WarrantLapsed::KIND, WaterRestrictions::KIND, WorkOrder::KIND,
        ];
        let mut a = all.to_vec();
        a.sort();
        assert_eq!(a, KINDS.to_vec());
    }

    #[test]
    fn work_order_as_the_kernel_writes_it() {
        // `work(task=levy, at=rates, every=7d)` by a seat, and the genesis order by a schedule.
        let w = round::<WorkOrder>(json!({ "work": { "task": "collect", "at": "depot", "on": "struct.1", "by": ["p.1", "p.2"], "units": 3 },
            "every": 604800, "first": 86400, "until": 31536000 }));
        assert_eq!(w.work.on, vec!["struct.1".to_string()]);
        assert_eq!(w.work.by.len(), 2);
        assert_eq!(w.every, Some(604800));
        let g = round::<WorkOrder>(json!({ "work": { "task": "levy", "at": "rates" }, "schedule": "law-rates", "by_procedure": "proc-rates-routines" }));
        assert_eq!(g.every, None);
        assert_eq!(g.schedule.as_deref(), Some("law-rates"));
    }

    #[test]
    fn hold_names_what_it_holds() {
        let h = round::<Hold>(json!({ "holds": ["rec.7", "rec.9"] }));
        assert_eq!(h.holds, vec!["rec.7", "rec.9"]);
        assert_eq!(round::<Hold>(json!({ "holds": "rec.7" })).holds, vec!["rec.7"]);
    }

    #[test]
    fn direction_reads_a_form_filled_in() {
        // `fine` is an amount: a form writes it as a decimal string.
        let d = round::<Direction>(json!({ "fines": "yes", "fine": "7500000", "recruit": "no", "posts": 4, "every": 1209600 }));
        assert_eq!(d.fine, Some(7_500_000));
        assert_eq!(d.fines.as_deref(), Some("yes"));
        assert_eq!(d.posts, Some(4));
    }

    #[test]
    fn law_reads_each_flavour() {
        let rates = round::<Law>(json!({ "tax": "rates", "rate_ppm": 7500, "instalments": 4, "due_days": 30, "penalty_interest_bps": 800 }));
        assert_eq!(rates.rate_ppm, Some(7500));
        let rent = round::<Law>(json!({ "schedule": "schedule-rent-increases", "figures": { "review": { "value": 31104000, "unit": "seconds" }, "notice": { "value": 5184000, "unit": "seconds" } } }));
        assert_eq!(rent.figures["notice"].value, 5_184_000);
        let amended = round::<Law>(json!({ "schedule": "schedule-tenancy", "figures": { "notice": { "value": 7776000, "unit": "seconds" } }, "replaces": "law-tenancy" }));
        assert_eq!(amended.replaces.as_deref(), Some("law-tenancy"));
        let poss = round::<Law>(json!({ "tenancy": "possession", "arrears_days": 14, "notice_days": 14, "possession_days": 14, "plan_months": 3, "warrant_days": 14,
            "eviction_notice_days": 0, "enforced_by": "police", "plan_consider": "may", "plan_barred_rent_months": 3 }));
        assert_eq!(poss.enforced_by.as_deref(), Some("police"));
        let term = round::<Law>(json!({ "employment": "termination", "notice": [{ "from_years": 0, "days": 7 }], "redundancy_pay": [], "small_employer_under": 15 }));
        assert_eq!(term.small_employer_under, Some(15));
        let hours = round::<Law>(json!({ "employment": "hours", "may_cut": "notice", "ordinary_week_hours": 38, "notice_days": 7, "floor_bps": 5000, "max_days": 0, "pay_bps": 0, "pay_owed_from": 0, "consent_bps": 10000 }));
        assert_eq!(hours.may_cut.as_deref(), Some("notice"));
        // A law with no data (the river law) reads too.
        assert_eq!(read::<Law>(&statement("law", json!({}))).unwrap(), Law::default());
    }

    #[test]
    fn staff_report_as_common_ts_writes_it() {
        let r = round::<StaffReport>(json!({
            "office": "works", "since": 86400,
            "orders": [
                { "order": "order-works-collect", "task": "collect", "every": 604800, "state": "followed", "times": 5, "units": 40, "says": "carried out: 5 days' work, 40 loads" },
                { "order": "order-works-maintain", "task": "maintain", "every": 86400, "schedule": "law-x", "state": "not_carried_out", "why": "nobody was at the depot", "says": "not carried out: nobody was at the depot" },
                { "task": "answer", "every": 0, "state": "no_order", "says": "not being done" }
            ],
            "staff": [{ "person": "p.3", "last": 172800, "task": "collect" }, { "person": "p.4", "no_place": true }]
        }));
        assert_eq!(r.orders.len(), 3);
        assert_eq!(r.orders[2].order, None);
        assert_eq!(r.staff[1].no_place, Some(true));
    }

    #[test]
    fn budget_and_proposal() {
        let b = round::<Budget>(json!({ "year": 2, "lines": { "parks": 8000000, "staff": 12000000 } }));
        assert_eq!(b.lines["parks"], 8_000_000);
        // The mayor's proposal.
        let m = round::<Proposal>(json!({ "enact": { "kind": "budget", "text": "The town's budget.", "data": { "year": 2, "lines": { "parks": 8000000 } } }, "tags": ["budget"] }));
        assert_eq!(m.enact.unwrap().kind, "budget");
        // One made on the council proposal form, with a budget line as a decimal string, and an amendment form's figure.
        let f = round::<Proposal>(json!({ "proposal": "A budget.", "kind": "budget", "affects": "neither", "year": 1, "parks": "80000.00", "notice": 7776000 }));
        assert_eq!(f.year, Some(1));
        assert!(f.fields.contains_key("parks") && f.fields.contains_key("notice"));
    }

    #[test]
    fn ballot_and_results() {
        let b = round::<Ballot>(json!({ "proposal": "rec.5", "options": ["yes", "no"], "closes_at": 1209600, "electorate": "council", "tags": ["tenant_protection"] }));
        assert_eq!(b.electorate.as_deref(), Some("council"));
        let c = round::<BallotResult>(json!({ "ballot": "rec.6", "yes": 4, "no": 1, "passed": true, "voted_for": ["councillor-1", "councillor-2"], "voted_against": ["councillor-3"] }));
        assert_eq!(c.passed, Some(true));
        let e = round::<BallotResult>(json!({ "ballot": "rec.9", "office": "mayor", "winner": "p.4", "rounds": [{ "p.4": 12, "p.7": 9 }], "formal": 21, "electors": 24, "turnout_bps": 8750 }));
        assert_eq!(e.rounds[0]["p.4"], 12);
        let u = round::<BallotResult>(json!({ "employer": "shop-1", "ballot": "rec.2", "voted": 8, "eligible": 12, "yes": 7, "passed": "yes" }));
        assert_eq!(u.passed, Some(true));
        let election = round::<Ballot>(json!({ "office": "mayor", "electorate": "roll", "candidates": [{ "candidate": "p.4", "number": "1", "for": "p.4-self", "name": "Ada", "nomination": "rec.3" }], "method": "preferential", "opens_at": 100, "closes_at": 200, "options": ["1"] }));
        assert_eq!(election.candidates[0].for_.as_deref(), Some("p.4-self"));
    }

    #[test]
    fn permit_decision_both_ways() {
        let g = round::<PermitDecision>(json!({ "application": "rec.3", "decision": "granted" }));
        assert_eq!(g.decision, "granted");
        let r = round::<PermitDecision>(json!({ "application": "rec.3", "decision": "refused", "law": "law-river" }));
        assert_eq!(r.law.as_deref(), Some("law-river"));
        let i = round::<PermitDecision>(json!({ "application": "rec.3", "decision": "incomplete", "missing": ["lot", "structure_type"] }));
        assert_eq!(i.missing.len(), 2);
        let rev = round::<PermitDecision>(json!({ "application": "rec.3", "decision": "granted", "on_review": "rec.8", "replaces": "rec.4" }));
        assert_eq!(rev.replaces.as_deref(), Some("rec.4"));
    }

    #[test]
    fn death_registration_and_friends() {
        // As the code registrar writes it, and as the registry's form does (children as the form's list).
        let d = round::<DeathRegistration>(json!({ "deceased": "p.9", "reported_by": "p.8", "partner": "p.8", "children": ["p.20", "p.21"], "without_adult": ["p.21"] }));
        assert_eq!(d.without_adult, vec!["p.21"]);
        let f = round::<DeathRegistration>(json!({ "deceased": "p.9", "reported_by": "p.8", "children": "p.20" }));
        assert_eq!(f.children, vec!["p.20"]);
        let c = round::<DeathCertificate>(json!({ "deceased": "p.9", "registration": "rec.11" }));
        assert_eq!(c.registration, "rec.11");
    }

    #[test]
    fn tribunal_papers() {
        // The tribunal's own notice, and a desk's.
        let n = round::<HearingNotice>(json!({ "application": "rec.2", "kind": "rent_increase", "applicant": "p.1", "against": "landlord-1", "hearing_at": 1_814_400 }));
        assert_eq!(n.0.hearing_at, 1_814_400);
        let d = round::<HearingNotice>(json!({ "application": "lease-1-possession", "kind": "possession", "matter": "possession", "applicant": "landlord-1", "against": "p.2",
            "hearing_at": 0, "answer_by": 0, "about": "lease-1", "amount": 240000, "structure": "home-1" }));
        assert_eq!(d.0.matter.as_deref(), Some("possession"));
        // An order to pay (a charge proven), one for possession, and a rejection.
        let pay = round::<TribunalOrder>(json!({ "application": "rec.4", "kind": "charge", "applicant": "shop-1", "against": "p.5", "finding": "pay", "victim": "shop-1", "amount": 9000, "to": "acc-shop-1", "due": 4_000_000, "report": "rec.1" }));
        assert_eq!(pay.0.finding, "pay");
        assert_eq!(pay.0.amount, Some(9000));
        let pos = round::<TribunalOrder>(json!({ "application": "lease-1-possession", "kind": "possession", "matter": "possession", "applicant": "landlord-1", "against": "p.2", "finding": "possession",
            "binding": true, "waited_days": 21, "about": "lease-1", "structure": "home-1", "amount": 240000, "due": 5_000_000, "space": "home-1/dwelling.1", "household": ["p.2", "p.3"] }));
        assert_eq!(pos.0.household.len(), 2);
        assert_eq!(pos.0.binding, Some(true));
        let rej = round::<TribunalOrder>(json!({ "application": "rec.9", "kind": "", "finding": "rejected" }));
        assert_eq!(rej.0.applicant, None);
        let inv = round::<TribunalOrder>(json!({ "application": "rec.2", "kind": "rent_increase", "applicant": "p.1", "against": "landlord-1", "finding": "invalid", "notice": "rec.1", "laws": ["law-rent-increases"] }));
        assert_eq!(inv.0.laws, vec!["law-rent-increases"]);
        // A desk's, with the form's amount as a decimal string.
        let v = round::<VenueDecision>(json!({ "application": "rec.7", "kind": "billing", "matter": "billing", "applicant": "p.1", "against": "water-corp", "finding": "pay", "binding": false, "waited_days": 3, "amount": "4200", "to": "acc-p.1", "due": 99 }));
        assert_eq!(v.0.amount, Some(4200));
        assert_eq!(v.0.binding, Some(false));
    }

    #[test]
    fn warrants_and_enforcement() {
        let w = round::<Warrant>(json!({ "order": "rec.20", "lease": "lease-1", "tenant": "p.2", "landlord": "landlord-1", "space": "home-1/dwelling.1", "structure": "home-1",
            "household": ["p.2", "p.3"], "not_before": 6_000_000, "until": 7_200_000 }));
        assert_eq!(w.not_before, 6_000_000);
        let e = round::<WarrantExecuted>(json!({ "warrant": "rec.21", "lease": "lease-1", "tenant": "p.2", "space": "home-1/dwelling.1", "household": ["p.2"], "removed": 1 }));
        assert_eq!(e.removed, Some(1));
        let l = round::<WarrantLapsed>(json!({ "warrant": "rec.21", "lease": "lease-1" }));
        assert_eq!(l.lease, "lease-1");
        let g = round::<GarnisheeOrder>(json!({ "order": "rec.4", "debtor": "p.5", "amount": 9000, "to": "acc-shop-1", "claim": "rec.4" }));
        assert_eq!(g.amount, 9000);
        assert!(read::<EnforcementDecline>(&statement("enforcement_decline", json!({}))).is_some());
    }

    #[test]
    fn small_office_papers() {
        round::<RatesNotice>(json!({ "amount": 125000, "lots": ["lot-1", "lot-2"], "due": 3_000_000, "account": "acc-city" }));
        round::<ElectionNotice>(json!({ "office": "mayor", "poll_at": 31536000, "nominations_close_at": 28944000, "method": "preferential" }));
        round::<ElectoralRoll>(json!({ "electors": ["p.1", "p.2"], "poll_at": 31536000 }));
        round::<SchoolPlace>(json!({ "classroom": "school-building/classroom.1", "building": "school-building" }));
        assert!(read::<SchoolDecline>(&statement("school_decline", json!({}))).is_some());
        assert!(read::<SupplyEnd>(&statement("supply_end", json!({}))).is_some());
        round::<SchoolCertificate>(json!({ "person": "p.12", "years": 12, "school": "school" }));
        let r = round::<WaterRestrictions>(json!({ "since": 86400 }));
        assert_eq!(r.lifted, None);
        round::<Lot>(json!({ "cells": ["cell.3.4"] }));
        round::<AssetRegister>(json!({ "assets": [{ "lot": "lot-1", "cells": ["cell.1.1"], "structure": "park-1", "type": "park" }, { "lot": "lot-2", "cells": ["cell.2.2"] }] }));
        round::<ServiceAddress>(json!({ "structure": "home-1", "at": "cell.1.1" }));
        round::<BuildingNotice>(json!({ "lot": "lot-1", "at": "cell.1.1", "structure": "site-4", "structure_type": "house", "client": "city" }));
        round::<BuildingNotice>(json!({ "removes": "site-3", "client": "city" }));
        round::<OfferDeclined>(json!({ "agreement": "agr.2", "price": "6200000" }));
        round::<RepairDone>(json!({ "order": "rec.2", "structure": "home-1", "units": 4 }));
        round::<RepairDeclined>(json!({ "order": "rec.2", "reason": "the money has not come" }));
        round::<AcquisitionNotice>(json!({ "lot": "lot-1", "owner": "p.1", "title": "title-lot-1" }));
        round::<BirthRegistration>(json!({ "child": "p.30", "born_at": 100, "mother": "p.2" }));
        round::<TransmissionApplication>(json!({ "deceased": "p.9", "heir": "p.8" }));
        round::<InvestigationClosed>(json!({ "report": "rec.1", "solved": false }));
        round::<DisposalDocket>(json!({ "kind": "waste", "quantity": 12 }));
        round::<Hearing>(json!({ "hears": ["rent increase", "debt"], "fee": 5000 }));
        round::<Approval>(json!({ "invoice": "rec.3" }));
        round::<PetitionResponse>(json!({ "petition": "rec.5", "answer": "the law in force already says what it asks." }));
        round::<Nomination>(json!({ "office": "mayor", "name": "the incumbent mayor", "incumbent": true, "values": ["security", "benevolence"] }));
        round::<ValuationRequest>(json!({ "lot": "lot-1", "structure": "site-4", "structure_type": "house" }));
        round::<DemolitionOrder>(json!({ "structure": "site-4", "lot": "lot-1", "law": "law-river" }));
        round::<PermitApplication>(json!({ "lot": "lot-1", "structure_type": "park" }));
    }

    #[test]
    fn procedures_forms_and_schedules() {
        let p = round::<Procedure>(json!({ "approval": { "over": 5000000, "by": "mayor" } }));
        assert_eq!(p.approval.unwrap().over, 5_000_000);
        let d = round::<Procedure>(json!({ "directions": { "by": ["mayor", "council-clerk"] } }));
        assert_eq!(d.directions.unwrap().by.len(), 2);
        let r = round::<Procedure>(json!({ "office": "registry", "routines": [
            { "task": "answer", "at": "registry", "every": 86400, "papers": [{ "kind": "death_notification", "how": "entered" }] },
            { "task": "levy", "at": "rates", "schedule": "law-rates" }] }));
        assert_eq!(r.routines[1].schedule.as_deref(), Some("law-rates"));
        round::<Procedure>(json!({ "council": { "proposers": ["mayor", "councillor"], "form": "form-council-proposal", "vote_days": 14, "members": 5 } }));
        round::<Procedure>(json!({ "petitions": { "threshold_bps": 1500, "of": 200, "signatures": 30 } }));
        let f = round::<Form>(json!({ "form": "amend_tenancy", "amends": "schedule-tenancy", "submit_as": "proposal", "submit_to": ["city"], "fields": {
            "notice": { "type": "duration", "description": "Notice.", "unit": "days" },
            "affects": { "type": "choice", "description": "Whom.", "options": ["tenants", "development", "neither"] } } }));
        assert_eq!(f.amends.as_deref(), Some("schedule-tenancy"));
        assert_eq!(f.fields["affects"].options.len(), 3);
        let s = round::<LawSchedule>(json!({ "title": "the law on ending a tenancy", "figures": { "notice": { "type": "duration", "unit": "days", "label": "notice", "optional": true } },
            "text": "A landlord must give {notice}.", "adico": { "deontic": "must" }, "formal": "block.notice >= {notice:seconds}" }));
        assert_eq!(s.figures["notice"].optional, Some(true));
    }

    #[test]
    fn office_books_as_books_ts_writes_it() {
        let b = round::<OfficeBooks>(json!({ "office": "tribunal", "at": 864000, "list": { "ripe": 2, "new": 1 },
            "open": [{ "what": "cases to decide", "about": "rec.8", "says": "application rec.8 by p.1", "since": 700000, "amount": 40000, "due": 900000 }],
            "over": [{ "what": "cases", "not_listed": 3 }] }));
        assert_eq!(b.list.unwrap().ripe, 2);
    }
}
