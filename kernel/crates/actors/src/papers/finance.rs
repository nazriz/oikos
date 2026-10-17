//! Papers of banks and lenders, funds, unions, the paper, and the grievance machinery every organisation runs: what
//! `bank.ts`, `credit.ts`, `fund.ts`, `union.ts`, `news.ts`, `frictions.ts` and `decisions.ts` write (lane D), and the
//! instruction to a bank that most modules write (`request`) and the bank reads. See `papers/mod.rs` for the
//! conventions.
//!
//! `bank.ts` writes no statement of its own (it answers in letters and statements of account, and moves money); it
//! reads `request`, `hold` (typed in offices.rs) and the registers of deaths. Money is `i64` cents, a time is seconds from the world's
//! start, a rate or a share is basis points.

use super::market::PaymentOutcome;
use super::{lenient, Paper};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The kinds typed in this file, in name order.
pub const KINDS: &[&str] = &[
    "action_ballot",
    "application",
    "complaint_response",
    "confirmation_request",
    "decision_review",
    "evidence",
    "evidence_request",
    "fund_members",
    "fund_report",
    "funding_draw",
    "industrial_action",
    "loan_application",
    "loan_arrears",
    "loan_decision",
    "loan_default",
    "loan_payout",
    "loan_statement",
    "loan_terms",
    "membership_offer",
    "membership_register",
    "news",
    "offer_accepted",
    "remedy_answer",
    "request",
    "return_to_work",
    "review_request",
    "signatories",
    "stop_work",
    "tribunal_response",
    "wage_claim",
];

// ------------------------------------------------------------------ registers a bank, lender, union or fund keeps

/// A lender's statement of a loan account as the year began, when the borrower had missed repayments before it
/// (genesis only; every paper is marked `brought_forward`). Addressed to the borrower, on the lender's file.
///
/// Written by: the world generator (`generate.ts`, for loans in arrears at the start). Read by: credit.ts (`payments`
/// missed, to start the loan's months earlier), openbooks-venues.ts (the same). `payment` and `behind` are cents,
/// `payments` a count; `account` is the account the repayments are made from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoanStatement {
    pub loan: String,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub payments: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub payment: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub behind: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brought_forward: Option<bool>,
}
impl Paper for LoanStatement {
    const KIND: &'static str = "loan_statement";
}

/// An account holder's mandate to its bank: which positions may instruct payments from an account. The latest
/// standing list on file governs.
///
/// Written by: the world generator (the town's mandate: the finance officer). Read by: bank.ts (the keeper, to refuse
/// an instruction from anyone else).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Signatories {
    pub account: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub positions: Vec<String>,
}
impl Paper for Signatories {
    const KIND: &'static str = "signatories";
}

/// One member in a union's register: who, which employer, and the industry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnionMember {
    pub member: String,
    pub employer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub industry: Option<String>,
}

/// A union's register of its members and where they work (genesis; visible to the union only).
///
/// Written by: the world generator. Read by: union.ts (the keeper: a member's employer, when not otherwise learnt).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MembershipRegister {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<UnionMember>,
}
impl Paper for MembershipRegister {
    const KIND: &'static str = "membership_register";
}

/// One member of a retirement fund: their id, the account their payout goes to, birth time (seconds from the world's
/// start, negative before it) and the units they hold (years of membership counted from 18, at least 1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FundMember {
    pub member: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub born_at: Option<i64>,
    #[serde(default, deserialize_with = "lenient::opt_int", skip_serializing_if = "Option::is_none")]
    pub units: Option<i64>,
}

/// A fund's register of its members and their units (genesis; visible to the fund only).
///
/// Written by: the world generator. Read by: fund.ts (the keeper, to share what comes in).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FundMembers {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<FundMember>,
}
impl Paper for FundMembers {
    const KIND: &'static str = "fund_members";
}

// ------------------------------------------------------------------ instructions to a bank

/// An instruction to the bank that keeps an account: pay (once, or again and again), many payments at once, or open or
/// close an account. The bank carries it out if the writer may instruct on the account; it answers a refusal by letter.
///
/// Written by: the kernel's resolver (every `money` call whose payer's account someone else keeps, and `account`
/// calls: `outcome`, `every`, `first` or `first_at`), fund.ts and lengnick.ts (one instruction for many payments:
/// `from`, `payments`), and a replacing instruction (`replaces`). Read by: bank.ts (the keeper: the whole of it),
/// common.ts (a standing order's first due time), firms.ts and openbooks-townhall.ts (to find and stop an order),
/// citizen.ts (to find and withdraw its own orders by what they cite), credit.ts (a repayment order), the
/// notices of `basis` and `settles`. Also read by: daybook.
/// Addressed to the keeper. `every` is seconds between payments; `first` seconds after the request that the first falls
/// due; `first_at` a time. The amount of a money outcome is cents (code writes it as a decimal string).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<PaymentOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub every: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub first: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub first_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaces: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub payments: Vec<BulkPayment>,
}
impl Paper for Request {
    const KIND: &'static str = "request";
}

/// One payment of a bulk [`Request`]: the account to pay, the amount (cents) and what it is for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BulkPayment {
    pub to: String,
    #[serde(deserialize_with = "lenient::int")]
    pub amount: i64,
    #[serde(rename = "for")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub for_: Option<String>,
}

// ------------------------------------------------------------------ lending

/// A borrower's application for a loan: how much, over how many months, paid into which account, and what for. A
/// mortgage also names the price and the home.
///
/// Written by: credit.ts (`Borrowing.apply`, called by citizen.ts, retailer.ts and producer.ts). Read by: credit.ts
/// (`lender`, which decides it), openbooks-venues. Addressed to the lender. `amount` is cents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoanApplication {
    #[serde(deserialize_with = "lenient::int")]
    pub amount: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub months: i64,
    pub account: String,
    pub purpose: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub price: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
}
impl Paper for LoanApplication {
    const KIND: &'static str = "loan_application";
}

/// A lender's public notice of what borrowing from it is: apply, saying how much, over how long and what for. The terms
/// are on the statement (`offer`); there is no data.
///
/// Written by: credit.ts (`lender`). Public. Read by: nobody in behaviour.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoanTerms {}
impl Paper for LoanTerms {
    const KIND: &'static str = "loan_terms";
}

/// A lender's decision on a loan application: approved (with the amount, the months, the yearly rate in basis points
/// and the monthly repayment) or declined (with why). An approved loan is offered as an agreement alongside it.
///
/// Written by: credit.ts (`lender`), the `loan_decision` form of papers.ts. Read by: citizen.ts (the borrower: whether
/// it was declined), reading.ts (a decision a seat may be asked to review), openbooks-venues. Addressed to the
/// applicant; `basis` is the application. `amount` and `payment` are cents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoanDecision {
    pub application: String,
    pub approved: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub months: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub rate_bps: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub payment: Option<i64>,
}
impl Paper for LoanDecision {
    const KIND: &'static str = "loan_decision";
}

/// A lender's advice that a loan has been paid out into an account.
///
/// Written by: credit.ts (`lender`, on a payoff request), the `loan_payout` form of papers.ts. Read by: citizen.ts (the
/// borrower), openbooks-venues. `amount` is cents; `loan` the loan agreement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoanPayout {
    pub loan: String,
    #[serde(deserialize_with = "lenient::int")]
    pub amount: i64,
    pub account: String,
}
impl Paper for LoanPayout {
    const KIND: &'static str = "loan_payout";
}

/// A lender's call on its funder: it is below its reserve and asks to draw an amount (cents) into its account at a
/// yearly rate in basis points.
///
/// Written by: credit.ts (`lender`), the `funding_draw` form of papers.ts. Read by: world.ts (the funder, the outside
/// world, which lends). Addressed to the funder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FundingDraw {
    #[serde(deserialize_with = "lenient::int")]
    pub amount: i64,
    pub account: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub rate_bps: Option<i64>,
}
impl Paper for FundingDraw {
    const KIND: &'static str = "funding_draw";
}

/// A lender's letter to a borrower that a loan is behind: how much is behind (cents). Addressed to the borrower; `basis`
/// is the loan. A loan carried forward from before the world began has `brought_forward`.
///
/// Written by: credit.ts (`lender`), the `loan_arrears` form of papers.ts. Read by: credit.ts (once, not again),
/// openbooks-venues.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoanArrears {
    pub loan: String,
    #[serde(deserialize_with = "lenient::int")]
    pub behind: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brought_forward: Option<bool>,
}
impl Paper for LoanArrears {
    const KIND: &'static str = "loan_arrears";
}

/// A lender's notice that a loan is in default: how much is behind and how much is owing (cents).
///
/// Written by: credit.ts (`lender`), the `loan_default` form of papers.ts. Read by: citizen.ts (the borrower, selling
/// to pay), openbooks-venues. Addressed to the borrower; `basis` is the loan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoanDefault {
    pub loan: String,
    #[serde(deserialize_with = "lenient::int")]
    pub behind: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub outstanding: i64,
}
impl Paper for LoanDefault {
    const KIND: &'static str = "loan_default";
}

// ------------------------------------------------------------------ a fund

/// A pension fund's public report for a period: members, what it took in, what it cost, what it paid in pensions and on
/// members' deaths, and what it keeps for members (all cents).
///
/// Written by: fund.ts. Public. Read by: nobody in behaviour (measurement may).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FundReport {
    #[serde(deserialize_with = "lenient::int")]
    pub members: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub income: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub costs: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub pensions: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub on_death: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub kept: i64,
}
impl Paper for FundReport {
    const KIND: &'static str = "fund_report";
}

// ------------------------------------------------------------------ a union

/// A union's public offer of membership: what joining is. The terms (dues, notice) are on the statement (`offer`);
/// there is no data.
///
/// Written by: union.ts. Public. Read by: nobody in behaviour (citizens find it as an offer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MembershipOffer {}
impl Paper for MembershipOffer {
    const KIND: &'static str = "membership_offer";
}

/// A union's claim to an employer for a wage rise for everyone at it: the rise in basis points and how many members.
///
/// Written by: union.ts, the `wage_claim` form of papers.ts. Read by: firms.ts (`Bargaining`, the employer answers it
/// with a `wage_offer`), openbooks-venues. Addressed to the employer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WageClaim {
    pub employer: String,
    #[serde(deserialize_with = "lenient::int")]
    pub rise_bps: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub members: i64,
}
impl Paper for WageClaim {
    const KIND: &'static str = "wage_claim";
}

/// A union's acceptance of an employer's offer: the rise in basis points it accepts. (gd-adoption: written also when the
/// union stops striking and takes the best offer standing, whose id is the `basis`; the paper is the same.)
///
/// Written by: union.ts, the `offer_accepted` form of papers.ts. Read by: firms.ts (`Bargaining`: the dispute is
/// settled and an enterprise agreement follows). Addressed to the employer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OfferAccepted {
    pub employer: String,
    pub claim: String,
    #[serde(deserialize_with = "lenient::int")]
    pub rise_bps: i64,
}
impl Paper for OfferAccepted {
    const KIND: &'static str = "offer_accepted";
}

/// A union's ballot of its members at an employer on stoppages of work, in support of its claim. Members vote on it
/// (the vote is the member's act); the union counts and writes a `ballot_result` (typed in offices.rs).
///
/// Written by: union.ts, the `action_ballot` form of papers.ts. Read by: citizen.ts (a member's turnout), union.ts (the
/// count). Addressed to the members. `closes` is a time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionBallot {
    pub employer: String,
    pub claim: String,
    #[serde(deserialize_with = "lenient::int")]
    pub closes: i64,
}
impl Paper for ActionBallot {
    const KIND: &'static str = "action_ballot";
}

/// A union's notice to an employer and its members of protected action: the stoppage from a time to a time, with the
/// figures of the ballot that approved it.
///
/// Written by: union.ts (also published as a block checked against the law), the `industrial_action` form of papers.ts.
/// Public. Read by: firms.ts (under gd-adoption: how long the stoppage is, matched by `employer` and `until`),
/// openbooks-venues. `from` and `until` are times; `voted`, `yes` and `eligible` count members.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndustrialAction {
    pub employer: String,
    #[serde(deserialize_with = "lenient::int")]
    pub from: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub until: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty", deserialize_with = "lenient::ids")]
    pub members: Vec<String>,
    pub ballot: String,
    #[serde(deserialize_with = "lenient::int")]
    pub voted: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub yes: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub eligible: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passed: Option<bool>,
}
impl Paper for IndustrialAction {
    const KIND: &'static str = "industrial_action";
}

/// A union's notice that its members at an employer stop work until a time.
///
/// Written by: union.ts, the `stop_work` form of papers.ts. Read by: firms.ts (the employer counts who is out),
/// citizen.ts (a member strikes), openbooks-venues. Addressed to the employer and the members.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StopWork {
    pub employer: String,
    #[serde(deserialize_with = "lenient::int")]
    pub until: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty", deserialize_with = "lenient::ids")]
    pub members: Vec<String>,
}
impl Paper for StopWork {
    const KIND: &'static str = "stop_work";
}

/// A union's notice that its members at an employer go back to work.
///
/// Written by: union.ts, the `return_to_work` form of papers.ts. Read by: firms.ts, citizen.ts (a member returns),
/// openbooks-venues. Addressed to the employer and the members.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReturnToWork {
    pub employer: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty", deserialize_with = "lenient::ids")]
    pub members: Vec<String>,
}
impl Paper for ReturnToWork {
    const KIND: &'static str = "return_to_work";
}

// ------------------------------------------------------------------ the paper

/// A newspaper's item: the kind of record it is about, whether it is about the town's government, its tone toward the
/// government (-1, 0 or 1), and the edition. The headline is the statement's text; the statement also carries an
/// assertion of it.
///
/// Written by: news.ts, the `news_item` form of papers.ts. Public. Read by: citizen.ts (a reader's picture of the
/// town). `kind` is the record kind it reports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct News {
    pub kind: String,
    #[serde(deserialize_with = "lenient::int")]
    pub tone: i64,
    pub about_office: bool,
    #[serde(deserialize_with = "lenient::int")]
    pub edition: i64,
}
impl Paper for News {
    const KIND: &'static str = "news";
}

// ------------------------------------------------------------------ grievances: asking to put right, answering

/// A request to someone to put something right: the matter in the world's labels, the other side, the paper it is
/// about, money sought and where to pay it, the building, and what is sought where it is not money.
///
/// Written by: citizen.ts (a grieving person or organisation, `PAPER.request`), firms.ts (a landlord's reminder of rent
/// in arrears: `matter` `arrears`), the `rent_reminder` and `review_request` forms of papers.ts. Read by:
/// frictions.ts (`Respondent`, the other side answers it: its `Matter`), decisions.ts (an office reads a request to
/// look at a decision again: `about` the decision, `matter`). Addressed to the other side. `amount` is cents.
/// `brought_forward` is true on a request carried forward from before the world began.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReviewRequest {
    pub matter: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub against: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seeks: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub particulars: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brought_forward: Option<bool>,
}
impl Paper for ReviewRequest {
    const KIND: &'static str = "review_request";
}

/// An application to a body that hears a matter (kind `application` where the body's notice names no other form): the
/// matter as a request says it, plus what was asked first, the evidence, and when a decision complained of was made.
///
/// Written by: citizen.ts (`PAPER.application`), firms.ts (a landlord's application for rent in arrears: `kind`
/// `arrears`, `evidence` `{id, record}`). Read by: desk.ts (a body's cases), frictions.ts (the Respondent), daybook.ts.
/// `kind` is the matter again where a body takes several; `evidence` is a reference or a whole record;
/// `decided_on` and `reviewed_on` are times; `request` says in words what was asked of the other side.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Application {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub matter: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub against: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seeks: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub particulars: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub decided_on: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub reviewed_on: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brought_forward: Option<bool>,
}
impl Paper for Application {
    const KIND: &'static str = "application";
}

/// The answer of an organisation (or an office) to a request to put something right: yes or no, and where money is
/// owed and paid, how much; or, from an office that reviews its own decision, the review's outcome and the decision.
///
/// Written by: frictions.ts (`Respondent`), decisions.ts (`Review`), the `remedy_answer` form of papers.ts. Read by:
/// citizen.ts (the asker: `granted`, `amount`, `reason`), reading.ts (a decision a seat may be asked to review).
/// Addressed to the asker; `basis` is the request. `amount` is cents; `review` is `changed`, `upheld` or `out_of_time`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RemedyAnswer {
    pub request: String,
    pub matter: String,
    pub granted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
}
impl Paper for RemedyAnswer {
    const KIND: &'static str = "remedy_answer";
}

/// The answer of an organisation to a body's notice of an application against it, from its own books: what they show
/// is owed, whether the thing is done, whether the paper complained of was wrong, and whether the books say anything.
/// The body decides on it when the time to answer has run; with no answer it decides in default.
///
/// Written by: frictions.ts (`Respondent`, with the response kind the body's form names: `complaint_response` here;
/// `tribunal_response` for the tribunal, typed below), the
/// `complaint_answer` and `tribunal_answer` forms of papers.ts. Read by: desk.ts (a body deciding), tribunal.ts.
/// Addressed to the body; `basis` is the application. `owed` is cents. `statement` is what the office says in its own
/// words where the figures do not say it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComplaintResponse {
    pub application: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub owed: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrong: Option<bool>,
    pub known: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statement: Option<String>,
}
impl Paper for ComplaintResponse {
    const KIND: &'static str = "complaint_response";
}

/// A tribunal's party's answer to an application: an organisation's answer from its own books (as `complaint_response`:
/// `owed`, `done`, `wrong`, `known`, `statement`), or a tenant's answer to an application for possession (what the
/// household wants the tribunal to know: whether they have left, what they say is owed, what they could pay, and their
/// circumstances). Every field but `application` is left out when it does not apply.
///
/// Written by: frictions.ts (`Respondent`, when the form names `tribunal_response`: run by firms.ts, retailer.ts and
/// producer.ts), citizen.ts (a tenant: `owes`, `offer`, `every_days`, the rest), the `tribunal_answer` and
/// `possession_answer` forms of papers.ts (a form writes `every` where code writes `every_days`). Read by: tribunal.ts
/// (the member who decides), firms.ts (a landlord reading a tenant's answer: `left`, `owes`, `offer`, `disputes_sum`).
/// Addressed to the tribunal and, for a tenant's, the landlord; `basis` is the application. `owes`, `offer`, `owed` are
/// cents; `every` and `every_days` the interval the tenant could pay at (a form: a duration in seconds; code: days);
/// `left_at`, `out_of_work_since`, `claim_on` are times; `claim` is `refused` or `pending`; `go_to` is `nowhere`,
/// `someone_to_ask` or `means_for_another`; `ages` the ages of those in the home.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TribunalResponse {
    pub application: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub owed: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrong: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statement: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub left_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub owes: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disputes_sum: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disputes_notice: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub offer: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub every: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub every_days: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub out_of_work_since: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pay_short: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub claim_on: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ill: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub people: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub children: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ages: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub lived_days: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub go_to: Option<String>,
}
impl Paper for TribunalResponse {
    const KIND: &'static str = "tribunal_response";
}

// ------------------------------------------------------------------ what a decision waits for

/// An office's request to a claimant: send these papers by this day, for a claim that waits for them. (`what` is in
/// words; `need` is the law's id of the need.)
///
/// Written by: decisions.ts (`Waits`). Read by: citizen.ts (the claimant, who answers with `evidence`), openbooks.
/// Addressed to the claimant; `basis` is the claim. `by` is a time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvidenceRequest {
    pub claim: String,
    pub need: String,
    pub what: String,
    #[serde(deserialize_with = "lenient::int")]
    pub by: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
}
impl Paper for EvidenceRequest {
    const KIND: &'static str = "evidence_request";
}

/// An office's request to an organisation: confirm this about a person (their employment) by this day, for a claim that
/// waits for it. `about` is the person.
///
/// Written by: decisions.ts (`Waits`). Read by: firms.ts (`Staffing.confirm`: the employer answers with a
/// `confirmation_answer`, typed in firms.rs), openbooks. Addressed to the organisation; `basis` is the claim. `by` is a
/// time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfirmationRequest {
    pub claim: String,
    pub need: String,
    pub what: String,
    #[serde(deserialize_with = "lenient::int")]
    pub by: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
}
impl Paper for ConfirmationRequest {
    const KIND: &'static str = "confirmation_request";
}

/// A claimant's papers for a claim, in answer to an `evidence_request`: the claim and need they answer, the request,
/// and (with the papers sent) the person's last employer, which the office then asks to confirm pay.
///
/// Written by: citizen.ts (`DECISION.evidence`), the `evidence` form of papers.ts. Read by: decisions.ts (`Waits`:
/// matched by `claim` and `need`; `last_employer` names who to ask), openbooks. Addressed to the office.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Evidence {
    pub claim: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub need: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_employer: Option<String>,
}
impl Paper for Evidence {
    const KIND: &'static str = "evidence";
}

/// An office's record that it looked at one of its decisions again: which decision, of what kind, on whose request, what
/// came of it (`changed`, `upheld` or `out_of_time`), what was found, and when the decision was made.
///
/// Written by: decisions.ts (`Review`). Read by: nobody in behaviour (the asker is answered with a `remedy_answer`).
/// Addressed to the asker. `decided_on` is a time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecisionReview {
    pub decision: String,
    pub kind: String,
    pub request: String,
    pub outcome: String,
    pub found: String,
    pub asked_by: String,
    #[serde(deserialize_with = "lenient::int")]
    pub decided_on: i64,
}
impl Paper for DecisionReview {
    const KIND: &'static str = "decision_review";
}

// Written here too, or read here, typed in another file:
// - ballot_result: union.ts writes it with `employer`, `ballot`, `voted`, `yes`, `eligible`, `passed` (a protected
//   action ballot's result; the `ballot_result` form of papers.ts writes the same fields); elections.ts and
//   government.ts write the council's with `yes`, `no`, `voted_for`, `voted_against`. offices.rs: it must hold
//   both sets as optional fields.
// - hearing (union.ts through desk.ts `hearingNotice`): offices.rs.
// - confirmation_answer (decisions.ts `KIND.confirmation`; written by firms.ts): firms.rs.
// - venue_decision, complaint_notice, hearing_notice (frictions.ts notices and decisions it reads; written by desk.ts
//   and tribunal.ts): offices.rs. hold (bank.ts and common.ts read it; the resolver writes it): offices.rs.
// - fund_decision (founded.ts): mind.rs. tribunal_application and warrant_request: firms.rs.
// - bank.ts writes no statement of its own; its letters are messages, not papers.

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
        assert!(KINDS.contains(&Request::KIND) && KINDS.contains(&TribunalResponse::KIND));
        assert_eq!(KINDS.len(), 30);
    }

    #[test]
    fn a_standing_order_a_bulk_dividend_and_an_account_opening_all_read_as_requests() {
        let standing = json!({ "outcome": { "money": { "from": "acc-p1", "to": "acc-l", "amount": "216000", "for": "Rent." } }, "every": 2592000, "first": 86400 });
        let r = read::<Request>(&statement("request", standing)).unwrap();
        let m = r.outcome.as_ref().and_then(|o| o.money.as_ref()).unwrap();
        assert_eq!((m.amount, r.every, r.first), (216000, Some(2592000), Some(86400)));
        let bulk = json!({ "from": "acc-f", "payments": [{ "to": "acc-a", "amount": "1500", "for": "Dividend." }, { "to": "acc-b", "amount": "500", "for": "Dividend." }] });
        let r = read::<Request>(&statement("request", bulk)).unwrap();
        assert_eq!(r.payments.len(), 2);
        assert_eq!(r.payments[0].amount, 1500);
        assert!(r.outcome.is_none());
        let open = json!({ "outcome": { "account": { "holder": "p1" } } });
        let r = read::<Request>(&statement("request", open.clone())).unwrap();
        assert_eq!(data(&r), open);
    }

    #[test]
    fn the_loan_papers_round_trip() {
        let app = json!({ "amount": 30000000, "months": 300, "account": "acc-p1", "purpose": "a home", "price": 40000000, "home": "apts/1" });
        assert_eq!(data(&read::<LoanApplication>(&statement("loan_application", app.clone())).unwrap()), app);
        let yes = json!({ "application": "rec.2", "approved": true, "amount": 30000000, "months": 300, "rate_bps": 650, "payment": 190000 });
        assert_eq!(data(&read::<LoanDecision>(&statement("loan_decision", yes.clone())).unwrap()), yes);
        let no = json!({ "application": "rec.2", "approved": false, "reason": "it could not be repaid" });
        assert_eq!(data(&read::<LoanDecision>(&statement("loan_decision", no.clone())).unwrap()), no);
        let late = json!({ "loan": "agr.5", "behind": 380000 });
        assert_eq!(data(&read::<LoanArrears>(&statement("loan_arrears", late.clone())).unwrap()), late);
        let seat_yes = json!({ "application": "rec.2", "approved": true, "months": "300", "rate_bps": "650" });
        assert_eq!(read::<LoanDecision>(&statement("loan_decision", seat_yes)).unwrap().rate_bps, Some(650));
    }

    #[test]
    fn the_union_s_papers_round_trip() {
        let claim = json!({ "employer": "f1", "rise_bps": 450, "members": 12 });
        assert_eq!(data(&read::<WageClaim>(&statement("wage_claim", claim.clone())).unwrap()), claim);
        let action = json!({ "employer": "f1", "from": 100, "until": 300, "members": ["p1", "p2"], "ballot": "rec.9", "voted": 9, "yes": 8, "eligible": 12 });
        let a = read::<IndustrialAction>(&statement("industrial_action", action.clone())).unwrap();
        assert_eq!(a.members.len(), 2);
        assert_eq!(data(&a), action);
        let stop = json!({ "employer": "f1", "until": 300, "members": ["p1"] });
        assert_eq!(data(&read::<StopWork>(&statement("stop_work", stop.clone())).unwrap()), stop);
    }

    #[test]
    fn grievance_papers_read_as_the_request_the_answer_and_the_response() {
        let req = json!({ "matter": "arrears", "against": "t1", "about": "agr.1", "amount": 120000, "account": "acc-l" });
        assert_eq!(data(&read::<ReviewRequest>(&statement("review_request", req.clone())).unwrap()), req);
        let yes = json!({ "request": "rec.6", "matter": "disrepair", "granted": true, "amount": 5000 });
        assert_eq!(data(&read::<RemedyAnswer>(&statement("remedy_answer", yes.clone())).unwrap()), yes);
        let reviewed = json!({ "request": "rec.6", "matter": "refusal", "granted": false, "review": "upheld", "decision": "rec.4", "reason": "the rule is not met" });
        assert_eq!(data(&read::<RemedyAnswer>(&statement("remedy_answer", reviewed.clone())).unwrap()), reviewed);
        let resp = json!({ "application": "rec.8", "owed": 0, "known": true });
        assert_eq!(data(&read::<ComplaintResponse>(&statement("complaint_response", resp.clone())).unwrap()), resp);
        let seat = json!({ "application": "rec.8", "known": false, "statement": "the sum is disputed" });
        assert_eq!(read::<ComplaintResponse>(&statement("complaint_response", seat)).unwrap().owed, None);
        let app = json!({ "kind": "arrears", "matter": "arrears", "against": "t1", "about": "agr.1", "amount": 120000, "account": "acc-l",
            "evidence": { "id": "agr.1", "record": "agreement" } });
        assert_eq!(data(&read::<Application>(&statement("application", app.clone())).unwrap()), app);
    }

    #[test]
    fn what_a_decision_waits_for_round_trips() {
        let ask = json!({ "claim": "rec.3", "need": "pay", "what": "proof of pay", "by": 900000, "about": "p1" });
        assert_eq!(data(&read::<ConfirmationRequest>(&statement("confirmation_request", ask.clone())).unwrap()), ask);
        let ev = json!({ "claim": "rec.3", "need": "pay", "request": "rec.4", "last_employer": "f1" });
        assert_eq!(data(&read::<Evidence>(&statement("evidence", ev.clone())).unwrap()), ev);
        let rev = json!({ "decision": "rec.1", "kind": "benefit_decision", "request": "rec.2", "outcome": "upheld", "found": "the claim did not qualify", "asked_by": "p1", "decided_on": 500 });
        assert_eq!(data(&read::<DecisionReview>(&statement("decision_review", rev.clone())).unwrap()), rev);
        let tenant = json!({ "application": "rec.8", "owes": 90000, "offer": 20000, "every_days": 30, "disputes_sum": true, "people": 3, "children": 1, "ages": [34, 33, 6], "go_to": "nowhere" });
        let t = read::<TribunalResponse>(&statement("tribunal_response", tenant.clone())).unwrap();
        assert_eq!(t.offer, Some(20000));
        assert_eq!(data(&t), tenant);
        let left = json!({ "application": "rec.8", "left": true, "left_at": 4000 });
        assert_eq!(data(&read::<TribunalResponse>(&statement("tribunal_response", left.clone())).unwrap()), left);
        let news = json!({ "kind": "petition", "tone": -1, "about_office": true, "edition": 3 });
        assert_eq!(data(&read::<News>(&statement("news", news.clone())).unwrap()), news);
    }

    #[test]
    fn registers_a_bank_a_union_and_a_fund_keep_round_trip() {
        let loan = json!({ "loan": "loan-1", "payments": 2, "payment": 90000, "behind": 180000, "account": "acc-bank", "brought_forward": true });
        assert_eq!(data(&read::<LoanStatement>(&statement("loan_statement", loan.clone())).unwrap()), loan);
        let sig = json!({ "account": "acc-city", "positions": ["finance"] });
        assert_eq!(data(&read::<Signatories>(&statement("signatories", sig.clone())).unwrap()), sig);
        let reg = json!({ "members": [{ "member": "c1", "employer": "firm-1", "industry": "manufacturing" }] });
        assert_eq!(data(&read::<MembershipRegister>(&statement("membership_register", reg.clone())).unwrap()), reg);
        let fund = json!({ "members": [{ "member": "c1", "account": "acc-c1", "born_at": -946080000, "units": 22 }] });
        assert_eq!(data(&read::<FundMembers>(&statement("fund_members", fund.clone())).unwrap()), fund);
    }
}
