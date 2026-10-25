//! Papers written by lane citizen's modules (docs/port-guide.md, section 5; conventions in papers/mod.rs): what a
//! person's life code says to an office, a landlord, an employer, a host or a household: housing, work, money,
//! lifecycle, deaths, recourse (`citizen.ts`, `household.ts`, `health.ts`).
//!
//! Times are seconds from the world's start, amounts cents. A kind written here and also by another lane's module is
//! typed once, in the file of the first writer named; those left to other files are listed at the bottom.

use super::Paper;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Every kind typed in this file, in name order.
pub const KINDS: &[&str] = &[
    "benefit_change",
    "benefit_claim",
    "birth_notification",
    "care_request",
    "complaint",
    "consultation",
    "death_notification",
    "departure",
    "enforcement_request",
    "enrolment",
    "hours_reply",
    "household",
    "job_application",
    "loan_payout_request",
    "membership_application",
    "membership_update",
    "petition",
    "petition_count",
    "plan_answer",
    "rental_application",
    "school_enrolment",
    "sick_leave",
    "stay_answer",
    "stay_ended",
    "stay_request",
    "supply_request",
    "trading_from",
    "variation_request",
    "welfare_check_request",
    "work_search",
];

/// A person asks the office that pays a support to stop paying a claim they made.
///
/// Written by: citizen.ts (a claimant whose circumstances no longer qualify). Read by: world.ts (the paying office
/// drops the claim from those in payment).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BenefitChange {
    /// The claim (the `benefit_claim` statement's id) to stop paying.
    pub claim: String,
    /// Always true as written; the paper says nothing else yet.
    #[serde(default)]
    pub stop: bool,
}
impl Paper for BenefitChange {
    const KIND: &'static str = "benefit_change";
}

/// What a claimant declares about their household, as a payment rule asks for it (payments.ts `declarationFor`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Declared {
    /// The household's income for a month, cents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub household_income: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub household_members: Option<i64>,
    /// The dates of birth of the household's children, seconds.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children_born_at: Vec<i64>,
    /// Whether the claimant has another pension.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub other_pension: Option<bool>,
}

/// A person's claim for a support payment, made to the office that pays it.
///
/// Written by: citizen.ts. Read by: world.ts (the paying office decides it by the support law's conditions), and by
/// citizen.ts itself (a claim already decided is not made twice).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BenefitClaim {
    /// The payment rule claimed (a payment rule's id).
    pub payment: String,
    /// The claimant's account, which a payment goes into.
    pub account: String,
    /// The claimant's date of birth, seconds, where their body is seen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub born_at: Option<i64>,
    /// What the claimant declares, where the rule asks for any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declares: Option<Declared>,
    /// Set by the paying office's own file for a claim made before the year opened and brought forward on paper; a
    /// seat's claim never carries it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brought_forward: Option<bool>,
}
impl Paper for BenefitClaim {
    const KIND: &'static str = "benefit_claim";
}

/// A parent reports a birth to the registry.
///
/// Written by: citizen.ts. Read by: institutions.ts (the registry enters it and sends the entry on).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BirthNotification {
    pub child: String,
    /// The child's date of birth, seconds.
    pub born_at: i64,
    pub mother: String,
}
impl Paper for BirthNotification {
    const KIND: &'static str = "birth_notification";
}

/// A person asks to be seen at the clinic, or a child of a home with no adult left asks child protection for help.
/// The two have different data: a clinic request names the condition, a request for help names the children.
///
/// Written by: citizen.ts. Read by: health.ts (the clinic queues the first), institutions.ts (child protection reads
/// `children` of the second).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CareRequest {
    /// The condition (the body's own record of it) to be seen for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
    /// What the condition is (an illness's or injury's name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// How bad it is, in the world's own words for it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    /// The children left with no adult at home.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<String>,
}
impl Paper for CareRequest {
    const KIND: &'static str = "care_request";
}

/// A householder tells the office that keeps a service that it has not come.
///
/// Written by: citizen.ts. Read by: government.ts (the home goes first on the next round), openbooks-townhall.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Complaint {
    /// The building complained of.
    pub structure: String,
    /// What was not done (the profile's service, e.g. a collection).
    pub about: String,
    /// How many days it has been.
    pub days: i64,
}
impl Paper for Complaint {
    const KIND: &'static str = "complaint";
}

/// A clinic tells a patient they have been seen.
///
/// Written by: health.ts. Read by: nobody in behaviour (the patient's body is treated by the work done, not by this
/// paper).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Consultation {
    /// The `care_request` it answers.
    pub request: String,
    /// The doctor who saw them.
    pub by: String,
}
impl Paper for Consultation {
    const KIND: &'static str = "consultation";
}

/// A death reported to the registrar, by whoever is present at it or finds it: a household, a host, the police, a
/// landlord. The registry registers it, and tells those named.
///
/// Written by: citizen.ts (household: `deceased`, `tell`, `partner`, `children`, `adult_children`; a neighbour or host:
/// `deceased`, `found_at`), police.ts (`deceased`, `found_at`), firms.ts (a landlord: `deceased` only), and the
/// forms `death_notification` of papers.ts (`deceased`, `found_at`). Read by: institutions.ts.
///
/// `children` present, even empty, means a member of the family reported it (the registry then does not write to the
/// estate's administrator); absent means a stranger did, so it must stay an `Option`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeathNotification {
    pub deceased: String,
    /// Where they were found, where the reporter was not family.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub found_at: Option<String>,
    /// Whom they had dealings with (their bank, the energy retailer, a child's school, the landlord): the registry
    /// sends its entry to each.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tell: Vec<String>,
    /// The surviving partner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partner: Option<String>,
    /// Their children, where the family reports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<String>>,
    /// Those of the children who are adults (the heir to land is the partner, else the eldest of these).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adult_children: Option<Vec<String>>,
    /// Children left with no adult at home. Institutions reads it and papers.ts's `death_registration` form has it;
    /// no writer in behaviour writes it to a notification, so it is always empty from code.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub without_adult: Vec<String>,
}
impl Paper for DeathNotification {
    const KIND: &'static str = "death_notification";
}

/// A person who is leaving town says so, to those they chose to tell.
///
/// Written by: citizen.ts. Read by: elections.ts (off the roll), fund.ts, utilities.ts, world.ts (a leaver is no
/// longer counted or billed). It carries no data; who it is from is all it says.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Departure {}
impl Paper for Departure {
    const KIND: &'static str = "departure";
}

/// A creditor asks the tribunal to enforce an order that someone pay them.
///
/// Written by: citizen.ts. Read by: tribunal.ts, openbooks-venues.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnforcementRequest {
    /// The `tribunal_order` to enforce.
    pub order: String,
    /// What is unpaid, cents.
    pub unpaid: i64,
}
impl Paper for EnforcementRequest {
    const KIND: &'static str = "enforcement_request";
}

/// A person puts themselves on the electoral roll.
///
/// Written by: citizen.ts. Read by: elections.ts (the roll is those who enrolled, less the dead and the departed),
/// citizen.ts (whether we are already on it).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Enrolment {
    /// The person's date of birth, seconds, where their body is seen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub born_at: Option<i64>,
}
impl Paper for Enrolment {
    const KIND: &'static str = "enrolment";
}

/// A worker's answer to an employer's asking for a cut in their hours.
///
/// Written by: citizen.ts. Read by: firms.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HoursReply {
    /// The employment agreement.
    pub agreement: String,
    pub agree: bool,
    /// The employer's notice it answers.
    pub notice: String,
}
impl Paper for HoursReply {
    const KIND: &'static str = "hours_reply";
}

/// One of a household's members.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Member {
    pub person: String,
    /// How the household reaches them (their participant), where it knows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participant: Option<String>,
    /// Date of birth, seconds.
    pub born_at: i64,
    pub sex: Sex,
    /// Their parents, where the household knows them (members' ids).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sex {
    Female,
    Male,
}

/// A household's standing record of who lives together: content, never physics. A member publishes a new one citing
/// the old and withdraws the old; the newest listing a person is theirs.
///
/// Written by: citizen.ts (a death, a birth), world.ts (the newcomers' first record). Read by: citizen.ts and
/// household.ts (`householdOf`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Household {
    /// The member who holds the lease, searches, applies and signs for the household.
    pub leaseholder: String,
    pub members: Vec<Member>,
    /// Couples living together, by person.
    #[serde(default)]
    pub couples: Vec<(String, String)>,
}
impl Paper for Household {
    const KIND: &'static str = "household";
}

/// A person applies for a job a firm has advertised.
///
/// Written by: citizen.ts. Read by: firms.ts (the hirer picks among those who applied; the account is where pay
/// goes), common.ts, openbooks-townhall.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JobApplication {
    /// The `job_posting` applied for.
    pub posting: String,
    /// The applicant's account.
    pub account: String,
    /// The trade they work in, or last worked in, as they know it (the industry of that employer's postings), for the
    /// employer to judge who fits (docs/design/market-realism.md, ME-2). None: no work on record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trade: Option<String>,
}
impl Paper for JobApplication {
    const KIND: &'static str = "job_application";
}

/// A borrower who is selling asks their bank what paying a loan off takes.
///
/// Written by: citizen.ts. Read by: credit.ts, openbooks-venues.ts. Answered by `loan_payout`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoanPayoutRequest {
    /// The loan (its agreement's id).
    pub loan: String,
}
impl Paper for LoanPayoutRequest {
    const KIND: &'static str = "loan_payout_request";
}

/// A person asks to join a body: a union (with where they work) or a founded group (the account dues come from).
///
/// Written by: citizen.ts. Read by: union.ts (`employer` and `industry` tell where members work), founded.ts,
/// openbooks-venues.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MembershipApplication {
    /// The applicant's account, which dues are taken from.
    pub account: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub employer: Option<String>,
    /// The industry of the employer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub industry: Option<String>,
}
impl Paper for MembershipApplication {
    const KIND: &'static str = "membership_application";
}

/// A union member says where they now work.
///
/// Written by: citizen.ts. Read by: union.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MembershipUpdate {
    /// The employer; the empty string when out of work.
    pub employer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub industry: Option<String>,
}
impl Paper for MembershipUpdate {
    const KIND: &'static str = "membership_update";
}

/// What a petition asks the law to become, in the shape the government reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PetitionDemand {
    /// "law" as written.
    pub kind: String,
    pub text: String,
    /// The institutional statement of it (attribute, deontic, aim), for the record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adico: Option<PetitionAdico>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// The law's schedule and the figures asked, where an amendment form can express it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amend: Option<PetitionAmend>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PetitionAdico {
    pub attribute: String,
    pub deontic: String,
    pub aim: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PetitionAmend {
    pub schedule: String,
    /// Figure name to the figure asked (a duration is seconds, an amount cents).
    pub figures: BTreeMap<String, i64>,
}

/// A petition to the town, started by a person with a grievance; others sign it.
///
/// Written by: citizen.ts. Read by: government.ts (answers a petition with enough signatures), common.ts
/// (`publishedCount`), openbooks-townhall.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Petition {
    pub demand: PetitionDemand,
}
impl Paper for Petition {
    const KIND: &'static str = "petition";
}

/// The organiser of a petition publishes how many have signed.
///
/// Written by: citizen.ts. Read by: common.ts (`petitionSignatures`), openbooks-townhall.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PetitionCount {
    pub petition: String,
    pub signatures: i64,
}
impl Paper for PetitionCount {
    const KIND: &'static str = "petition_count";
}

/// A tenant's answer to a landlord's offer of a payment plan for rent owed.
///
/// Written by: citizen.ts. Read by: openbooks.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanAnswer {
    /// The `plan_offer`.
    pub offer: String,
    /// The lease (agreement) it is about.
    pub lease: String,
    pub accepts: bool,
    /// What they could pay a month toward the arrears, beyond the rent, cents.
    pub can_pay: i64,
}
impl Paper for PlanAnswer {
    const KIND: &'static str = "plan_answer";
}

/// The size of a household as an application states it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseholdSize {
    pub people: i64,
    pub bedrooms_needed: i64,
}

/// A household applies to a landlord for a home they have listed.
///
/// Written by: citizen.ts. Read by: firms.ts (the landlord chooses among applicants, and notes the account rent is
/// paid from), openbooks.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RentalApplication {
    /// The `rental_listing` applied for.
    pub listing: String,
    pub account: String,
    /// The people who would live there.
    pub members: Vec<String>,
    pub household: HouseholdSize,
}
impl Paper for RentalApplication {
    const KIND: &'static str = "rental_application";
}

/// A child of school age (or a newcomer) asks the school for a place.
///
/// Written by: citizen.ts. Read by: school.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SchoolEnrolment {
    /// Date of birth, seconds.
    pub born_at: i64,
    /// Years already at school elsewhere (a newcomer's).
    pub years_before: i64,
}
impl Paper for SchoolEnrolment {
    const KIND: &'static str = "school_enrolment";
}

/// A worker tells their employer they are off work, too ill to go in.
///
/// Written by: citizen.ts. Read by: nobody in behaviour (the employer sees the worker's absence).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SickLeave {
    /// When the leave began, seconds.
    pub from: i64,
}
impl Paper for SickLeave {
    const KIND: &'static str = "sick_leave";
}

/// A host's answer to a request to be taken in.
///
/// Written by: citizen.ts. Read by: citizen.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StayAnswer {
    /// The request answered (for a vouched request, the original asker's own request).
    pub request: String,
    pub yes: bool,
    /// The space they may stay in, on a yes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    /// Why not, on a no.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
}
impl Paper for StayAnswer {
    const KIND: &'static str = "stay_answer";
}

/// Who ended a stay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StayEnder {
    /// The guest no longer needs it (or is leaving town).
    Guest,
    /// The host's own home has ended.
    Host,
}

/// A host or guest says a stay is over.
///
/// Written by: citizen.ts. Read by: citizen.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StayEnded {
    pub by: StayEnder,
}
impl Paper for StayEnded {
    const KIND: &'static str = "stay_ended";
}

/// A household with no home asks someone they know whether they may stay; or a member of the host's household puts
/// the request of a person they know to the leaseholder (`for`, `vouched_by`, `request` then set).
///
/// Written by: citizen.ts. Read by: citizen.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StayRequest {
    pub adults: i64,
    pub children: i64,
    /// How many of the adults have no income.
    pub without_income: i64,
    /// The person asking on whose behalf, for a vouched request.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "for")]
    pub for_: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vouched_by: Option<String>,
    /// The original request, for a vouched request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<String>,
}
impl Paper for StayRequest {
    const KIND: &'static str = "stay_request";
}

/// A new home's occupant signs up with the energy supplier.
///
/// Written by: citizen.ts. Read by: utilities.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SupplyRequest {
    /// The account bills are paid from.
    pub account: String,
    /// The home (space) supplied.
    pub home: String,
}
impl Paper for SupplyRequest {
    const KIND: &'static str = "supply_request";
}

/// A person who works from their own home says where their business now trades from, or that it has stopped.
///
/// Written by: citizen.ts. Read by: retailer.ts (the shop moves its stock; `nowhere` stops it trading; `closed` ends
/// it).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TradingFrom {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    /// The ground cell it stands on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nowhere: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed: Option<bool>,
}
impl Paper for TradingFrom {
    const KIND: &'static str = "trading_from";
}

/// A commitment asked for in a variation request: who would do what, and how often.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Would {
    pub who: String,
    /// A commitment's `does`: `{ outcome: { money: { amount: "<cents as digits>" } } }` or `{ outcome: { occupancy: {
    /// who, in } } }` (agreements.rs when typed).
    pub does: Value,
    /// Repeat period, seconds, where it recurs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub every: Option<i64>,
}

/// A tenant asks the landlord to hold the rent or let them stay on; a worker asks the employer for a rise.
///
/// Written by: citizen.ts. Read by: firms.ts (landlord and employer answer with `variation_answer`), openbooks.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VariationRequest {
    /// The agreement it would vary.
    pub agreement: String,
    /// The paper it follows from (the rent increase notice, or the agreement for a pay rise).
    pub about: String,
    pub would: Would,
}
impl Paper for VariationRequest {
    const KIND: &'static str = "variation_request";
}

/// A person who has seen nobody come out of a home for some days asks the police to call.
///
/// Written by: citizen.ts. Read by: police.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WelfareCheckRequest {
    /// The home (space).
    pub space: String,
    pub structure: String,
    /// The ground it stands on; police prefer this to `structure` (a building may be gone, its ground is there).
    pub at: String,
    /// When the home was last seen entered, seconds.
    pub since: i64,
}
impl Paper for WelfareCheckRequest {
    const KIND: &'static str = "welfare_check_request";
}

/// A person says whether they are looking for work.
///
/// Written by: citizen.ts. Read by: nobody in behaviour (measurement may).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkSearch {
    pub looking: bool,
}
impl Paper for WorkSearch {
    const KIND: &'static str = "work_search";
}

// Written here too, typed in another file (the writers' lane owns the type):
// - tribunal_application (citizen.ts, firms.ts, police.ts, forms of papers.ts): offices.rs (tribunal.ts reads it).
//   citizen.ts writes `kind` ("rent_increase", "debt"), `against`, `notice`/`claim`, `amount`, `account`, `evidence`.
// - tribunal_response (citizen.ts, firms.ts, retailer.ts, producer.ts, form of papers.ts): offices.rs. citizen.ts
//   writes `application`, `left`, `left_at` or `owes`, `offer`, `every_days`, `disputes_sum`, `disputes_notice`,
//   `out_of_work_since`, `pay_short`, `claim`, `claim_on`, `ill`, `people`, `children`, `ages`, `lived_days`, `go_to`.
// - review_request (PAPER.request / KIND.request), application (PAPER.application or the venue's form): frictions.ts,
//   decisions.ts, finance.rs. `evidence` (DECISION.evidence): decisions.ts, finance.rs.
// - property_for_sale, property_sold, property_purchase (citizen.ts for a private owner; firms.ts, retailer.ts):
//   firms.rs.
// - nomination (citizen.ts a candidate; government.ts the incumbent; form of papers.ts): offices.rs (elections.ts
//   reads it).
// - hearing (founded.ts and desk.ts `hearingNotice`): offices.rs.

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
        assert!(KINDS.contains(&DeathNotification::KIND) && KINDS.contains(&WelfareCheckRequest::KIND));
    }

    #[test]
    fn a_household_death_notice_reads_and_a_stranger_s_has_no_children() {
        let family = json!({ "deceased": "p9", "tell": ["bank", "energy"], "partner": "p2", "children": ["k1"], "adult_children": [] });
        let n = read::<DeathNotification>(&statement("death_notification", family.clone())).unwrap();
        assert_eq!(n.children, Some(vec!["k1".to_string()]));
        assert_eq!(n.partner.as_deref(), Some("p2"));
        assert_eq!(data(&n), family);
        let stranger = json!({ "deceased": "p9", "found_at": "h1" });
        let n = read::<DeathNotification>(&statement("death_notification", stranger.clone())).unwrap();
        assert!(n.children.is_none());
        assert_eq!(data(&n), stranger);
    }

    #[test]
    fn a_household_record_round_trips() {
        let d = json!({
            "leaseholder": "p1",
            "members": [
                { "person": "p1", "participant": "seat-1", "born_at": -900000000, "sex": "female" },
                { "person": "k1", "born_at": 100, "sex": "male", "parents": ["p1"] }
            ],
            "couples": [["p1", "p2"]]
        });
        let h = read::<Household>(&statement("household", d.clone())).unwrap();
        assert_eq!(h.members.len(), 2);
        assert_eq!(h.couples, vec![("p1".to_string(), "p2".to_string())]);
        assert_eq!(data(&h), d);
    }

    #[test]
    fn a_variation_request_for_rent_and_a_rental_application() {
        let d = json!({ "agreement": "a1", "about": "r7", "would": { "who": "p1", "does": { "outcome": { "money": { "amount": "120000" } } }, "every": 2592000 } });
        let v = read::<VariationRequest>(&statement("variation_request", d.clone())).unwrap();
        assert_eq!(v.would.every, Some(2_592_000));
        assert_eq!(data(&v), d);
        let d = json!({ "listing": "l1", "account": "acc1", "members": ["p1", "k1"], "household": { "people": 2, "bedrooms_needed": 2 } });
        assert_eq!(read::<RentalApplication>(&statement("rental_application", d.clone())).unwrap().household.people, 2);
        assert!(read::<RentalApplication>(&statement("job_application", d)).is_none());
    }

    #[test]
    fn a_claim_with_a_declaration_and_a_petition() {
        let d = json!({ "payment": "age_support", "account": "acc1", "born_at": -2000000000, "declares": { "household_income": 300000, "household_members": 1, "children_born_at": [] } });
        let c = read::<BenefitClaim>(&statement("benefit_claim", d)).unwrap();
        assert_eq!(c.declares.unwrap().household_income, Some(300_000));
        let d = json!({ "demand": { "kind": "law", "text": "t", "adico": { "attribute": "landlords", "deontic": "must_not", "aim": "x" }, "tags": ["tenant_protection"], "amend": { "schedule": "tenancy", "figures": { "notice": 7776000 } } } });
        let p = read::<Petition>(&statement("petition", d.clone())).unwrap();
        assert_eq!(p.demand.amend.as_ref().unwrap().figures["notice"], 7_776_000);
        assert_eq!(data(&p), d);
    }

    #[test]
    fn small_ones() {
        let s = read::<StayRequest>(&statement("stay_request", json!({ "adults": 2, "children": 1, "without_income": 1, "for": "p5", "vouched_by": "p4", "request": "r1" }))).unwrap();
        assert_eq!(s.for_.as_deref(), Some("p5"));
        let e = read::<StayEnded>(&statement("stay_ended", json!({ "by": "guest" }))).unwrap();
        assert_eq!(e.by, StayEnder::Guest);
        assert!(read::<Departure>(&statement("departure", Value::Null)).is_some());
        let t = read::<TradingFrom>(&statement("trading_from", json!({ "nowhere": true }))).unwrap();
        assert_eq!(t.nowhere, Some(true));
    }
}
