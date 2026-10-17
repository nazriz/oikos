//! Papers of employers, landlords and firms in their own books: what `firms.ts`, `payroll.ts`, `returns.ts`, `tax.ts`,
//! `payments.ts`, `orgwants.ts` and `practice.ts` write (lane C1). Only `firms.ts` says anything: the others are
//! libraries for it (the payroll's returns calendar, the tax law, the support rules, an organisation's character and
//! practice) and write no paper of their own. See `papers/mod.rs` for the conventions.
//!
//! Money here is `i64` cents, a time is seconds from the world's start, a duration is seconds.

use super::{lenient, Paper};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The kinds typed in this file, in name order.
pub const KINDS: &[&str] = &[
    "closing",
    "closure",
    "confirmation_answer",
    "enterprise_agreement",
    "hours_notice",
    "hours_restored",
    "insolvency",
    "job_posting",
    "notice_to_vacate",
    "off_books",
    "payroll_notice",
    "plan_offer",
    "property_for_sale",
    "property_purchase",
    "property_sold",
    "rent_increase",
    "rent_statement",
    "rental_listing",
    "repair_order",
    "tax_report",
    "tribunal_application",
    "tribunal_reply",
    "variation_answer",
    "wage_offer",
    "warrant_request",
    "withholding_report",
];

// ------------------------------------------------------------------ an employer's staffing

/// A job advertisement: the wage and the pay period, for the post or posts the employer is filling. The jobs board
/// is a search of these; the employment offer the posting carries is on the statement (`offer`), not in `data`.
///
/// Written by: firms.ts (`Staffing.posting`, one on a standing wage, or by the day), the `job_advertisement` form of
/// papers.ts. Read by: firms.ts (`Staffing`, the employer's own open postings, matched by `role`), common.ts
/// (`jobPosting` of a cited record). Also read by: citizen.ts (job search, through the offer), openbooks.
/// `wage` is cents for each pay period; `period` is the pay period in seconds. A posting for work by the day has
/// `period` of one day and `by_the_day`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JobPosting {
    #[serde(deserialize_with = "lenient::int")]
    pub wage: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub period: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by_the_day: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub industry: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workplace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
}
impl Paper for JobPosting {
    const KIND: &'static str = "job_posting";
}

/// An employer's note, on its own file only, that an employment agreement is not on its payroll returns (an
/// employer that pays some of its staff off the books).
///
/// Written by: firms.ts (`Staffing.registers`). Read by: firms.ts (`Staffing`, to leave the agreement out of the
/// returns). Visible to the employer alone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OffBooks {
    pub agreement: String,
}
impl Paper for OffBooks {
    const KIND: &'static str = "off_books";
}

/// An employer's answer to an office that asked it to confirm a person's employment (for a claim the office is
/// deciding): from its own agreements, whether the person is in its employment, whether it has any record of them,
/// and when it ended.
///
/// Written by: firms.ts (`Staffing.confirm`), the `confirmation_answer` form of papers.ts. Read by: decisions.ts
/// (`Waits`, matching `claim` and `need`). Also read by: openbooks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfirmationAnswer {
    pub claim: String,
    pub need: String,
    pub request: String,
    pub subject: String,
    pub employed: bool,
    pub known: bool,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub ended_on: Option<i64>,
}
impl Paper for ConfirmationAnswer {
    const KIND: &'static str = "confirmation_answer";
}

/// A notice to the office that pays an organisation's staff, where hiring and paying are two offices of one
/// organisation (a town's works manager and its finance officer): a new starter with what the payroll needs to set
/// the wage up, or a leaver with the last day. It is on the organisation's own file; the hiring office also writes to
/// the payroll office as a letter naming the notice.
///
/// Written by: firms.ts (`Staffing`, on taking someone on and on the end of an agreement), the `payroll_starter` and
/// `payroll_leaver` forms of papers.ts (a seat fills `wage` as a decimal string, `period` and dates as the form
/// gives them). Read by: firms.ts (`Staffing`, `notice === "starter"` waited for before the payment is set up, and
/// the filed notices). Also read by: openbooks-townhall.
/// A starter has `wage` (cents each pay period, before tax), `period`, `first_pay` and `account`, and `line` where the
/// post is paid from a line of the adopted budget; a leaver has `last_day` and `reason` (`notice` or `died`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PayrollNotice {
    /// `starter` or `leaver`.
    pub notice: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub office: Option<String>,
    pub employee: String,
    pub post: String,
    pub agreement: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub wage: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub period: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub first_pay: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub last_day: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
impl Paper for PayrollNotice {
    const KIND: &'static str = "payroll_notice";
}

/// An employer's report of what it withheld from wages in a period and paid over, to the collector the tax law names.
/// One return reports the charges the law lists for it; where the law has several charges to one account the report
/// is the totals and `charges` has a line for each charge; where a charge is itemised, `staff` has a line for each
/// worker (what the support office reads as proof of contributions).
///
/// Written by: firms.ts (`Staffing.report`), the `withholding_return` form of papers.ts (totals only). Read by:
/// world.ts (the support office, `staff` for a claimant's contributions), decisions.ts (`Waits`, which employer
/// reported pay for a claimant), government.ts (the finance office's books). Also read by: openbooks-townhall.
/// `withheld` is what was withheld in the period, `paid` what is paid over with the report, both cents.
/// `period_end` is a time. `return`, `due`, `period_from` and `period_to` say which of the law's returns it is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WithholdingReport {
    #[serde(deserialize_with = "lenient::int")]
    pub withheld: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub paid: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub period_end: i64,
    pub account: String,
    #[serde(rename = "return")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub return_: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub due: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub period_from: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub period_to: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub charges: Vec<WithholdingCharge>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub staff: Vec<WithholdingStaff>,
}
impl Paper for WithholdingReport {
    const KIND: &'static str = "withholding_report";
}

/// One charge's line in a [`WithholdingReport`]: the charge's id, the account it is paid to, what was withheld under it
/// and what was paid (cents).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WithholdingCharge {
    pub charge: String,
    pub to: String,
    #[serde(deserialize_with = "lenient::int")]
    pub withheld: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub paid: i64,
}

/// One worker's line in an itemised [`WithholdingReport`]: the worker (none if the agreement names no second party)
/// and their gross pay in the period, in cents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WithholdingStaff {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worker: Option<String>,
    #[serde(deserialize_with = "lenient::int")]
    pub gross: i64,
}

/// An employer's notice to a worker that their hours are cut (or, where the law needs it, a request that they agree
/// to the cut), in place of letting them go.
///
/// Written by: firms.ts (`Hours`). Read by: citizen.ts (the worker's job: `hours_cut`, with `consent` and
/// `consent_bps`). `hours_bps` is the new hours as basis points of the ordinary week (10,000 is the full week);
/// `wage` the pay for the period at the new hours and `was` the full wage, cents; `from` and `until` times; `consent`
/// is true when the worker is asked to agree; `reply_by` a time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HoursNotice {
    pub employer: String,
    pub agreement: String,
    #[serde(deserialize_with = "lenient::int")]
    pub hours_bps: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub ordinary_week_hours: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub minutes_week: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub wage: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub was: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub from: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub until: i64,
    pub consent: bool,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub consent_bps: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub law: Option<String>,
    #[serde(deserialize_with = "lenient::int")]
    pub reply_by: i64,
}
impl Paper for HoursNotice {
    const KIND: &'static str = "hours_notice";
}

/// An employer's notice that a worker's hours go back to the full week from a day, at the full wage.
///
/// Written by: firms.ts (`Hours`). Read by: citizen.ts (the worker's job: `hours_restored`). `wage` is cents each pay
/// period, `hours_bps` basis points of the ordinary week (always 10,000 as written), `from` a time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HoursRestored {
    pub employer: String,
    pub agreement: String,
    #[serde(deserialize_with = "lenient::int")]
    pub wage: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub hours_bps: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub from: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub law: Option<String>,
}
impl Paper for HoursRestored {
    const KIND: &'static str = "hours_restored";
}

/// An employer's answer to a worker's request to vary the employment (to be paid a different wage, to stay on),
/// and a landlord's to a tenant's request to vary a tenancy: yes or no.
///
/// Written by: firms.ts (`Staffing`, wage requests; `Landlord`, a tenant's request), the `variation_answer` form of
/// papers.ts. Read by: citizen.ts (the asker, which reads the answer to its request by `basis`), reading.ts
/// (a decision seats can be asked to review). `about` is what was asked, in the request's word; `wage` is the agreed
/// wage in cents where an employer grants a wage request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VariationAnswer {
    pub about: String,
    pub granted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub wage: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
impl Paper for VariationAnswer {
    const KIND: &'static str = "variation_answer";
}

/// An employer's offer of a wage rise, in answer to a union's claim.
///
/// Written by: firms.ts (`Bargaining`), the `wage_offer` form of papers.ts. Read by: union.ts (the claimant, which
/// takes the best offer; its `rise_bps` is the offer in basis points of the wage). `why` says when it was made
/// ("after a stoppage" and the like). (gd-adoption: the offer then follows what a stoppage cost the employer in lost
/// sales; the paper is the same.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WageOffer {
    pub employer: String,
    pub claim: String,
    #[serde(deserialize_with = "lenient::int")]
    pub rise_bps: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
}
impl Paper for WageOffer {
    const KIND: &'static str = "wage_offer";
}

/// An enterprise agreement between an employer and a union: the wages of the employer's staff rise by `rise_bps`
/// basis points from a time.
///
/// Written by: firms.ts (`Bargaining`). Public. Read by: union.ts (the dispute is settled), citizen.ts (a worker
/// whose job began before it sees the rise). Also read by: openbooks-venues.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnterpriseAgreement {
    pub employer: String,
    pub union: String,
    #[serde(deserialize_with = "lenient::int")]
    pub rise_bps: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub from: i64,
}
impl Paper for EnterpriseAgreement {
    const KIND: &'static str = "enterprise_agreement";
}

// ------------------------------------------------------------------ a firm winding up

/// A firm's public notice that it is closing, by its owners' decision (`reason` says why).
///
/// Written by: firms.ts (`Winding`). Public. Read by: nobody in behaviour (the notice precedes the `closure`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Closing {
    pub firm: String,
    pub reason: String,
    #[serde(deserialize_with = "lenient::int")]
    pub since: i64,
}
impl Paper for Closing {
    const KIND: &'static str = "closing";
}

/// A firm's public notice that it cannot pay its debts as they fall due and is being wound up.
///
/// Written by: firms.ts (`Winding`). Public. Read by: nobody in behaviour.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Insolvency {
    pub firm: String,
    pub reason: String,
    #[serde(deserialize_with = "lenient::int")]
    pub since: i64,
}
impl Paper for Insolvency {
    const KIND: &'static str = "insolvency";
}

/// A firm's public notice that it has closed: what it paid its creditors and its shareholders (cents), and how many
/// of its debts it paid. A shop that never opened (its premises were sold to someone else) and a shop whose owner has
/// gone or given it up write one too.
///
/// Written by: firms.ts (`Winding`), retailer.ts (a shop that did not open, or whose owner went; `given_up`). Public.
/// Read by: union.ts and firms.ts (an employer that has closed has no dispute; matched by `firm`, else `speaks_for`).
/// Also read by: openbooks-venues.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Closure {
    pub firm: String,
    #[serde(deserialize_with = "lenient::int")]
    pub to_creditors: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub to_shareholders: i64,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub debts_paid: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub given_up: Option<bool>,
}
impl Paper for Closure {
    const KIND: &'static str = "closure";
}

/// A firm's public offer of its premises for sale, as a firm closing, a shop or a private owner writes it. The sale is
/// the offer on the statement; the title passes in words.
///
/// Written by: firms.ts (`Winding`, the premises of a closing firm, with `cell` and `lots`), citizen.ts (a private
/// owner's home: `lot`, `space`, `type` "home", `bedrooms`). Read by: firms.ts and retailer.ts (the listing of a
/// structure), citizen.ts (a buyer). `price` is cents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertyForSale {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seller: Option<String>,
    pub structure: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lots: Vec<String>,
    #[serde(deserialize_with = "lenient::int")]
    pub price: i64,
    pub account: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub bedrooms: Option<i64>,
}
impl Paper for PropertyForSale {
    const KIND: &'static str = "property_for_sale";
}

/// A buyer's purchase of a listed property: it names the listing and the account the buyer pays from; the price is
/// paid with it by a payment.
///
/// Written by: retailer.ts (a new shop buying premises), citizen.ts (a household buying a home). Read by: firms.ts
/// (`Winding`, the seller, which carries out the sale). Addressed to the seller; `basis` is the listing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertyPurchase {
    pub listing: String,
    pub account: String,
}
impl Paper for PropertyPurchase {
    const KIND: &'static str = "property_purchase";
}

/// A seller's public notice that a property is sold, to whom, and for how much (cents).
///
/// Written by: firms.ts (`Winding`), citizen.ts (a private owner; `lot`). Read by: citizen.ts, retailer.ts (the buyer
/// learns it is theirs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertySold {
    pub structure: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lot: Option<String>,
    pub buyer: String,
    #[serde(deserialize_with = "lenient::int")]
    pub price: i64,
}
impl Paper for PropertySold {
    const KIND: &'static str = "property_sold";
}

// ------------------------------------------------------------------ a landlord

/// A landlord's statement of the rent account under a lease as the year began, when rent was owed then (genesis only;
/// marked `brought_forward`). Addressed to the tenant, on the landlord's file: the rent book, its clerk and the tenant
/// all read the same paper.
///
/// Written by: the world generator. Read by: common.ts (`broughtForward`: `lease`, `owed`, `since`), citizen.ts
/// (`rent` and `account`, to pay the arrears a rent at a time). `owed` and `rent` are cents, `rents` a count, `since`
/// the time the oldest rent fell due (seconds, negative: before the year began).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RentStatement {
    pub lease: String,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub owed: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub rents: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub rent: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brought_forward: Option<bool>,
}
impl Paper for RentStatement {
    const KIND: &'static str = "rent_statement";
}

/// A home advertised to let. The lease it offers is on the statement (`offer`); `data` is what the board shows.
///
/// Written by: firms.ts (`Landlord`), the `rental_listing` form of papers.ts. Read by: firms.ts (its own open
/// listings), citizen.ts (the search for a home: `space`, `rent`, `bedrooms`). Also read by: openbooks.
/// `rent` is cents a month.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RentalListing {
    pub structure: String,
    pub space: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub bedrooms: Option<i64>,
    #[serde(deserialize_with = "lenient::int")]
    pub rent: i64,
}
impl Paper for RentalListing {
    const KIND: &'static str = "rental_listing";
}

/// A landlord's notice of a rent increase to a tenant: the new rent from a time, the rent now, and when the rent now
/// paid started (a tribunal tests the notice against the law on rents).
///
/// Written by: firms.ts (`Landlord`; also published as a block checked against the law before it is sent), the
/// `rent_increase` form of papers.ts. Read by: citizen.ts (the tenant: `rent`, `was`, `from`), tribunal.ts (a
/// challenge to it), household.ts. Also read by: openbooks. `rent` and `was` are cents a month; `from` and
/// `last_from` times.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RentIncrease {
    pub lease: String,
    #[serde(deserialize_with = "lenient::int")]
    pub rent: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub from: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub was: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub last_from: i64,
}
impl Paper for RentIncrease {
    const KIND: &'static str = "rent_increase";
}

/// A landlord's order to a builder for the repair of a building of its own, paid with the order.
///
/// Written by: firms.ts (`Landlord`, to remedy disrepair), the `repair_order` form of papers.ts. Read by:
/// institutions.ts (the builder, which does the repair once the price is in its account). Also read by: openbooks.
/// `units` is the units of repair work; `account` the account the price is paid from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepairOrder {
    pub structure: String,
    #[serde(deserialize_with = "lenient::int")]
    pub units: i64,
    pub account: String,
}
impl Paper for RepairOrder {
    const KIND: &'static str = "repair_order";
}

/// A landlord's offer to a tenant behind with the rent of a plan to pay: the rent as it falls due and an instalment a
/// month toward the arrears. The tenant answers whether the household can.
///
/// Written by: the `payment_plan_offer` form of papers.ts (a seat landlord; the code landlord does not write it).
/// Read by: citizen.ts (the tenant). `owed` and `instalment` are cents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanOffer {
    pub lease: String,
    #[serde(deserialize_with = "lenient::int")]
    pub owed: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub instalment: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
}
impl Paper for PlanOffer {
    const KIND: &'static str = "plan_offer";
}

/// A landlord's written notice to a tenant to leave a home by a day, for rent owed. It lapses if the arrears are paid
/// before the day; if the tenant is still there after it, the landlord may apply for possession.
///
/// Written by: firms.ts (`Landlord`), the `notice_to_vacate` form of papers.ts. Read by: firms.ts (the notice relied
/// on in an application for possession: `given`, `by`), citizen.ts (the tenant). Also read by: openbooks. `arrears`
/// is cents, `by` a time. `given` is the day the notice was given where it is not the record's own time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NoticeToVacate {
    pub lease: String,
    pub reason: String,
    #[serde(deserialize_with = "lenient::int")]
    pub arrears: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub by: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub law: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub given: Option<i64>,
}
impl Paper for NoticeToVacate {
    const KIND: &'static str = "notice_to_vacate";
}

/// A landlord's return of rent received in a month, to the town, which assesses a tax on it.
///
/// Written by: firms.ts (`Landlord`), the `tax_report` form of papers.ts. Read by: government.ts (the finance office
/// assesses `rent_received` at the law's rate). `rent_received` is cents; `period_end` a time; `account` the account
/// the rent was received into (where the tax is chased from).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaxReport {
    #[serde(deserialize_with = "lenient::int")]
    pub period_end: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub rent_received: i64,
    pub account: String,
}
impl Paper for TaxReport {
    const KIND: &'static str = "tax_report";
}

/// An application to the tribunal (or a body that hears it), by whoever brings it: a landlord for rent in arrears or
/// for possession of a let home, a tenant to have a notice of rent increase found invalid, a creditor for a debt.
/// What the tribunal needs to hear it is in `evidence` (a reference to the lease, or the record itself).
///
/// Written by: firms.ts (`Landlord`: kind `arrears`, `possession`), citizen.ts (kind `rent_increase`, `debt`), the
/// `arrears_application` and `possession_application` forms of papers.ts, police.ts (a charge: kind `charge`, with `victim` and
/// the `report` it rests on). Read by: tribunal.ts (`kind` picks the
/// list), openbooks-venues. `amount` and `rent` are cents; `breach` is true where a payment plan ordered has not been
/// kept; `household` lists who lives in the home by the lease (the tenant first); `notice`, `notice_given` and
/// `notice_by` name the notice to vacate relied on and its two days. `evidence` is `{id, record}` or a whole record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TribunalApplication {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub against: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub rent: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub breach: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty", deserialize_with = "lenient::ids")]
    pub household: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub notice_given: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub notice_by: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub victim: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Value>,
}
impl Paper for TribunalApplication {
    const KIND: &'static str = "tribunal_application";
}

/// A landlord's reply to a tenant's answer to an application for possession: what the rent book shows owed today, and
/// whether a plan the tenant offers would be taken. It goes to the tribunal and the tenant.
///
/// Written by: firms.ts (`Landlord`), the `possession_reply` form of papers.ts. Read by: tribunal.ts (the member who
/// decides), desk.ts. `owed` is cents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TribunalReply {
    pub application: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub against: Option<String>,
    #[serde(deserialize_with = "lenient::int")]
    pub owed: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub takes_plan: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<String>,
}
impl Paper for TribunalReply {
    const KIND: &'static str = "tribunal_reply";
}

/// A landlord's request to the tribunal's registrar for a warrant of possession, on an order whose day has passed with
/// the tenant still there.
///
/// Written by: firms.ts (`Landlord`), the `warrant_request` form of papers.ts. Read by: tribunal.ts (the registrar).
/// Also read by: openbooks-venues. `order` is the tribunal's order for possession.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WarrantRequest {
    pub order: String,
}
impl Paper for WarrantRequest {
    const KIND: &'static str = "warrant_request";
}

// Written here too, typed in another file (the writers' lane owns the type):
// - death_notification (firms.ts a landlord reporting a tenant's death; citizen.ts; police.ts): citizen.rs.
// - review_request (PAPER.request, firms.ts `Landlord` writes a rent reminder with it; citizen.ts) and application
//   (PAPER.application or the venue's form, firms.ts `Landlord`): finance.rs.
// - request (the bank instruction; firms.ts stops a standing order by reading it): finance.rs.
// - hold: offices.rs.
// - tribunal_response (the Respondent of frictions.ts, which every firm here runs, and a tenant's answer): finance.rs.
// - remedy_answer (frictions.ts Respondent, which firms.ts, retailer.ts, producer.ts run): finance.rs.

#[cfg(test)]
mod tests {
    use super::super::{data, read};
    use super::*;
    use oikos_sight::Record;
    use serde_json::json;

    fn statement(kind: &str, d: Value) -> Record {
        serde_json::from_value(json!({
            "record": "statement", "id": "s1", "author": "p1", "at": 0, "kind": kind, "text": "", "speaks_for": "p1",
            "visible_to": "public", "data": d
        }))
        .unwrap_or_else(|e| panic!("record shape: {e}"))
    }

    #[test]
    fn kinds_match_impls() {
        assert!(KINDS.windows(2).all(|w| w[0] < w[1]), "KINDS in name order");
        assert!(KINDS.contains(&JobPosting::KIND) && KINDS.contains(&WithholdingReport::KIND));
        assert_eq!(KINDS.len(), 26);
    }

    #[test]
    fn a_job_posting_reads_by_the_wage_and_the_day() {
        let d = json!({ "wage": 70000, "period": 1209600, "role": "cashier", "industry": "retail", "workplace": "shop-1", "space": "shop-1/floor" });
        let p = read::<JobPosting>(&statement("job_posting", d.clone())).unwrap();
        assert_eq!(p.wage, 70000);
        assert_eq!(p.role.as_deref(), Some("cashier"));
        assert_eq!(data(&p), d);
        let day = json!({ "wage": 9000, "period": 86400, "by_the_day": true, "role": "picker" });
        let p = read::<JobPosting>(&statement("job_posting", day.clone())).unwrap();
        assert_eq!(p.by_the_day, Some(true));
        assert_eq!(data(&p), day);
    }

    #[test]
    fn a_payroll_starter_written_by_code_and_by_a_seat_both_read() {
        let code = json!({ "notice": "starter", "office": "finance", "employee": "p4", "post": "clerk", "agreement": "agr.9",
            "wage": "480000", "period": 1209600, "first_pay": 2000000, "account": "acc-p4", "line": "works" });
        let n = read::<PayrollNotice>(&statement("payroll_notice", code)).unwrap();
        assert_eq!(n.wage, Some(480000));
        assert_eq!(n.line.as_deref(), Some("works"));
        let seat = json!({ "notice": "starter", "employee": "p4", "post": "clerk", "agreement": "agr.9", "wage": "480000", "period": "1209600" });
        let n = read::<PayrollNotice>(&statement("payroll_notice", seat)).unwrap();
        assert_eq!(n.period, Some(1209600));
        let leaver = json!({ "notice": "leaver", "office": "finance", "employee": "p4", "post": "clerk", "agreement": "agr.9", "last_day": 3000000, "reason": "notice" });
        let n = read::<PayrollNotice>(&statement("payroll_notice", leaver.clone())).unwrap();
        assert_eq!(n.last_day, Some(3000000));
        assert_eq!(data(&n), leaver);
    }

    #[test]
    fn a_withholding_report_with_charges_and_staff_round_trips() {
        let d = json!({ "withheld": 120000, "paid": 100000, "period_end": 5184000, "account": "acc-f1",
            "return": "return-rest", "due": 5300000, "period_from": 2592000, "period_to": 5184000,
            "charges": [{ "charge": "income-tax", "to": "acc-tax", "withheld": 90000, "paid": 80000 }],
            "staff": [{ "worker": "p1", "gross": 480000 }] });
        let r = read::<WithholdingReport>(&statement("withholding_report", d.clone())).unwrap();
        assert_eq!(r.return_.as_deref(), Some("return-rest"));
        assert_eq!(r.staff[0].gross, 480000);
        assert_eq!(data(&r), d);
        let totals = json!({ "withheld": 5, "paid": 5, "period_end": 9, "account": "a" });
        assert_eq!(data(&read::<WithholdingReport>(&statement("withholding_report", totals.clone())).unwrap()), totals);
    }

    #[test]
    fn a_tribunal_application_for_possession_and_a_challenge_to_a_rise_both_read() {
        let possession = json!({ "kind": "possession", "matter": "possession", "against": "t1", "about": "agr.1", "amount": 120000,
            "rent": 60000, "account": "acc-l", "space": "apts/1", "structure": "apts", "household": ["t1", "k1"],
            "notice": "rec.8", "notice_given": 100, "notice_by": 900, "evidence": { "id": "agr.1", "record": "agreement" } });
        let a = read::<TribunalApplication>(&statement("tribunal_application", possession.clone())).unwrap();
        assert_eq!(a.household, vec!["t1".to_string(), "k1".to_string()]);
        assert_eq!(data(&a), possession);
        let rise = json!({ "kind": "rent_increase", "against": "l1", "notice": "rec.3", "evidence": { "any": "record" } });
        assert_eq!(data(&read::<TribunalApplication>(&statement("tribunal_application", rise.clone())).unwrap()), rise);
    }

    #[test]
    fn hours_and_rent_papers_round_trip() {
        let h = json!({ "employer": "f1", "agreement": "agr.2", "hours_bps": 8000, "ordinary_week_hours": 38, "minutes_week": 1824,
            "wage": 384000, "was": 480000, "from": 100, "until": 900, "consent": true, "consent_bps": 6000, "law": "law.4", "reply_by": 700 });
        assert_eq!(data(&read::<HoursNotice>(&statement("hours_notice", h.clone())).unwrap()), h);
        let r = json!({ "lease": "agr.1", "rent": 66000, "from": 500, "was": 60000, "last_from": 10 });
        assert_eq!(data(&read::<RentIncrease>(&statement("rent_increase", r.clone())).unwrap()), r);
        let l = json!({ "structure": "apts", "space": "apts/1", "type": "apartments", "bedrooms": 2, "rent": 60000 });
        assert_eq!(data(&read::<RentalListing>(&statement("rental_listing", l.clone())).unwrap()), l);
    }

    #[test]
    fn a_rent_statement_round_trips() {
        let d = json!({ "lease": "lease-1", "owed": 216000, "rents": 2, "rent": 108000, "since": -2592000, "account": "acc-l1", "brought_forward": true });
        assert_eq!(data(&read::<RentStatement>(&statement("rent_statement", d.clone())).unwrap()), d);
    }
}
