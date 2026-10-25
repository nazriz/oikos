//! Papers of shops, producers, trade and the world's edge: what `retailer.ts`, `producer.ts`, `trade.ts`,
//! `lengnick.ts`, `world.ts` and `environment.ts` write (lane C2). `world.ts` is the outside world's buyers and
//! sellers and the town's statistician, support office, valuer, weather bureau and grant-giver; see `papers/mod.rs`
//! for the conventions.
//!
//! Money is `i64` cents (a price is cents for one unit), a time is seconds from the world's start, rates are basis
//! points.
//!
//! Kinds marked `(gd-adoption)` are on the unmerged branch `gd-adoption` (`automation.ts`: the outside vendor of
//! systems, and a business's tender for them): typed now so the port needs no second pass.

use super::{lenient, Paper};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// The kinds typed in this file, in name order.
pub const KINDS: &[&str] = &[
    "arrival",
    "benefit_decision",
    "benefit_end",
    "bid",
    "buying_offer",
    "capital_call",
    "case_for_decision",
    "crime_report",
    "delivery_note",
    "environment_report",
    "grant_payment",
    "habitat_map",
    "habitat_register",
    "invoice",
    "invoice_declined",
    "order",
    "population_estimate",
    "price_index",
    "price_list",
    "rental_evidence",
    "shareholders",
    "support_statistics",
    "system_delivery",
    "system_ended",
    "system_offer",
    "tender",
    "valuation",
    "weather_warning",
];

// ------------------------------------------------------------------ prices, orders and deliveries

/// A seller's published prices: one unit price in cents for each kind of goods, and where to pay. A shop's (`at` its
/// premises; with one kind of goods the statement also carries an `offer` to order and pay), a wholesaler's or the
/// outside world's (`min_order`, `terms_days` when it sells on terms), or a builder's (`prices` for finished buildings
/// by type and `demolition`: typed here as it is one kind, written by institutions.ts).
///
/// Written by: trade.ts (`priceList`, called by retailer.ts, producer.ts and world.ts), institutions.ts (the
/// builder's list: `prices`, `demolition`). Read by: trade.ts (`Latest`, the buyers' search for the cheapest seller),
/// retailer.ts, producer.ts, firms.ts, citizen.ts (where to shop), government.ts, common.ts (a builder's prices),
/// world.ts. Public. `min_order` is the least units an order may be; `terms_days` how many days after delivery an
/// order on terms is paid.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PriceList {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub goods: BTreeMap<String, i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub min_order: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub terms_days: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub prices: BTreeMap<String, i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub demolition: Option<i64>,
}
impl Paper for PriceList {
    const KIND: &'static str = "price_list";
}

/// An order for goods, paid in the same act (a payment follows with the order's cents) or, on the seller's terms,
/// payable some days after delivery. It goes to the seller; the buyer and the seller see it.
///
/// Written by: trade.ts (`order`), the `order` form of papers.ts. Read by: trade.ts (`OrderBook`, the seller).
/// `unit_price` is cents; `deliver_to` the place the goods are to be delivered to, else the buyer's own; `at` where
/// the goods are to be delivered; `account` the buyer's paying account; `pay_in_days` set on terms; `retry_of` the
/// earlier order this one repeats; `for_days` how many days of use the buyer is stocking for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Order {
    pub kind: String,
    #[serde(deserialize_with = "lenient::int")]
    pub quantity: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub unit_price: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deliver_to: Option<String>,
    pub at: String,
    pub account: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub pay_in_days: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_of: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub for_days: Option<i64>,
}
impl Paper for Order {
    const KIND: &'static str = "order";
}

/// A seller's note on an order: what was delivered of what was ordered, what was refunded (cents), or that the order was
/// declined. On terms it is also the invoice: `owed` cents to be paid within `pay_in_days` into `pay_to`.
///
/// Written by: trade.ts (`fillAs`, `decline`), retailer.ts (a shop serving an order), producer.ts and world.ts
/// (declining an order unpaid for a week), the `delivery_note` form of papers.ts. Read by: trade.ts (`OrderBook`,
/// the buyer's books: what came, who failed it; `declined` of `overdue` marks a buyer refused for not paying),
/// citizen.ts (a household's delivery). Addressed to the buyer; `basis` is the order. `declined` is `unpaid` or
/// `overdue` where the order was refused.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeliveryNote {
    pub order: String,
    pub kind: String,
    #[serde(deserialize_with = "lenient::int")]
    pub ordered: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub delivered: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub refund: i64,
    /// The price charged for each delivered, where it was not the order's own (a shop's price risen since: the money
    /// paid bought fewer, and the rest is in `refund`).
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub unit_price: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declined: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub owed: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub pay_in_days: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pay_to: Option<String>,
}
impl Paper for DeliveryNote {
    const KIND: &'static str = "delivery_note";
}

/// What one party asks another to pay, as an outcome the invoice's reader pays: a money outcome with its payee and
/// amount and what it is for. `amount` is written as a decimal string in the smallest unit by code and by a form;
/// reading takes either, writing is a number.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MoneyOutcome {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    pub to: String,
    #[serde(deserialize_with = "lenient::int")]
    pub amount: i64,
    #[serde(rename = "for")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub for_: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settles: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
}

/// The outcome an invoice or a bank instruction carries: money to pay, or (in a request to a bank) an account to open
/// or close (`{holder, close?}` as the resolver writes it, kept as it is).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaymentOutcome {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub money: Option<MoneyOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<Value>,
}

/// An invoice: what the sender asks the addressee to pay, as the outcome to bring about, and for what. The reader pays
/// it with a payment naming the invoice (`settles`).
///
/// Written by: producer.ts (an export to the world market: `kind`, `quantity`, `from_at`), world.ts (the landfill's
/// monthly invoice: `dockets`), institutions.ts (a builder's: `agreement`, `type`), utilities.ts (water and energy
/// bills: `service`, `home`, `kl`, `days`, `units`, `estimated`), the `export_invoice` form of papers.ts. Read by:
/// firms.ts (`Landlord`/`Staffing` pay an invoice addressed to them), government.ts (the council), citizen.ts (a
/// household's bills: `service`). Also read by: openbooks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Invoice {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<PaymentOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub quantity: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_at: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dockets: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agreement: Option<String>,
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub kl: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub days: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub units: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated: Option<bool>,
}
impl Paper for Invoice {
    const KIND: &'static str = "invoice";
}

/// The outside world's answer to an invoice it will not pay: it is not for goods it buys, or says no quantity or
/// account, or the goods have not come in the days it waits; or part of the invoice is for more than this month's
/// demand and is sent back.
///
/// Written by: world.ts (`world.market`). Read by: nobody in behaviour (the exporter sees it in its book).
/// `returned` and `paid_for` are the quantities sent back and taken.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InvoiceDeclined {
    pub invoice: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub returned: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub paid_for: Option<i64>,
}
impl Paper for InvoiceDeclined {
    const KIND: &'static str = "invoice_declined";
}

/// The outside world's public offer to buy a kind of goods from the town this month: up to a quantity at a unit price
/// (cents), shipped to it and invoiced; it pays when the goods arrive. The offer to buy is also on the statement.
///
/// Written by: world.ts (`world.market`). Public. Read by: producer.ts (an exporter, matching `kind`, `until`,
/// `quantities`). `quantity` is the most it takes in the month; `quantities` how much of that from each named seller
/// where it names them; `until` a time; `account` where it is paid.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BuyingOffer {
    pub kind: String,
    #[serde(deserialize_with = "lenient::int")]
    pub unit_price: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub quantity: i64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub quantities: BTreeMap<String, i64>,
    #[serde(deserialize_with = "lenient::int")]
    pub until: i64,
    pub account: String,
}
impl Paper for BuyingOffer {
    const KIND: &'static str = "buying_offer";
}

/// What homes of a kind let for and stand empty at, as a letting portal publishes it for landlords at a rent review
/// (docs/risks.md ME-14), one statement per comparable type (`type`, `bedrooms`). It counts only what the portal has been
/// shown: public rental listings and when each came down. `lets` are the asking rents (cents a month) of homes let in
/// the last `window_days`; `asking` those of homes still standing; `homes` the homes it has seen listed; `vacant` the
/// ones standing now.
///
/// Written by: market/rent_portal.rs (`world.rent_portal`). Public. Read by: firms.ts (`Landlord`, at a rent review, into
/// `oikos_rules::rent::{Evidence, reviewed}`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RentalEvidence {
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bedrooms: Option<i64>,
    #[serde(default)]
    pub lets: Vec<i64>,
    #[serde(default)]
    pub asking: Vec<i64>,
    pub homes: i64,
    pub vacant: i64,
    pub window_days: i64,
}
impl Paper for RentalEvidence {
    const KIND: &'static str = "rental_evidence";
}

// ------------------------------------------------------------------ a shop

/// A new shop's request to its founder for the capital they are putting in: the account to pay it into.
///
/// Written by: retailer.ts (a new shop). Read by: citizen.ts (the founder, who pays it). `amount` is cents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapitalCall {
    pub account: String,
    #[serde(deserialize_with = "lenient::int")]
    pub amount: i64,
}
impl Paper for CapitalCall {
    const KIND: &'static str = "capital_call";
}

/// A firm's register of shareholders: who holds shares, in what account dividends are paid, and how many shares. The
/// latest the firm has published is the register.
///
/// Written by: retailer.ts (a new shop: its founder with 10,000 shares). Read by: lengnick.ts (`shareholders`,
/// `distribute`: a dividend is paid by shares). `shares` are whole shares.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Shareholders {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub holders: Vec<Holder>,
}
impl Paper for Shareholders {
    const KIND: &'static str = "shareholders";
}

/// One line of a [`Shareholders`] register.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Holder {
    pub holder: String,
    pub account: String,
    #[serde(deserialize_with = "lenient::int")]
    pub shares: i64,
}

/// A shop's report to the police of goods missing at its stocktake: how many, of what, from where, and their value.
///
/// Written by: retailer.ts (the stocktake), the `crime_report` form of papers.ts. Read by: police.ts. Addressed to the
/// police. `value` is cents; `at` the premises.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CrimeReport {
    pub kind: String,
    #[serde(deserialize_with = "lenient::int")]
    pub quantity: i64,
    pub at: String,
    #[serde(deserialize_with = "lenient::int")]
    pub value: i64,
    pub account: String,
}
impl Paper for CrimeReport {
    const KIND: &'static str = "crime_report";
}

// ------------------------------------------------------------------ the world's edge: support, statistics, valuation

/// The support office's decision on a claim: granted (with the sum and how often it is paid) or refused (with why).
/// A second look at a refusal that grants it writes one that `replaces` the refusal.
///
/// Written by: world.ts (`world.transfers`), the `benefit_decision` form of papers.ts. Read by: citizen.ts (the
/// claimant: `granted`, `payment`, and a refusal's reason), reading.ts (a decision a seat may be asked to review),
/// decisions.ts (a review of it). Also read by: openbooks. `amount` is cents for each payment; `every` seconds between
/// payments; `until` the time it ends, where it ends; `payment` is the law's id for the payment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BenefitDecision {
    pub claim: String,
    /// Who made the claim (the form writes it; the office's code does not).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment: Option<String>,
    /// (A seat's form writes `?granted`, a boolean; read leniently all the same.)
    #[serde(deserialize_with = "lenient::yes")]
    pub granted: bool,
    /// An opening caseload's decision, brought forward from before the year (genesis).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub brought_forward: bool,
    /// Refused at genesis because the claim could not be verified.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub could_not_verify: bool,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub every: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub until: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_review: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaces: Option<String>,
}
impl Paper for BenefitDecision {
    const KIND: &'static str = "benefit_decision";
}

/// The support office's notice to a claimant that a payment has ended, and what they may claim next.
///
/// Written by: world.ts (`world.transfers`). Read by: citizen.ts. `ended` is always true.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BenefitEnd {
    pub claim: String,
    pub payment: String,
    pub ended: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub then: Option<String>,
}
impl Paper for BenefitEnd {
    const KIND: &'static str = "benefit_end";
}

/// The support office's note to itself of a claim that needs a person to decide it (the rules fail or are in doubt):
/// why, and what the law's rule would pay. It is on the office's own file.
///
/// Written by: world.ts (`world.transfers`, where its staff decide); desk.ts writes the same kind for an application to
/// a body that hears grievances, with `application`, `matter`, `applicant`, `against` and the whole `case` instead. Read by:
/// desk.ts (`Casework`), openbooks, openbooks-venues. `amount` is cents; `every` seconds; `fails` why it fails the
/// rule and `doubt` whether it is in doubt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CaseForDecision {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applicant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub against: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub case: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fails: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doubt: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub every: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub until: Option<i64>,
}
impl Paper for CaseForDecision {
    const KIND: &'static str = "case_for_decision";
}

/// The statistician's public count of people receiving each support payment.
///
/// Written by: world.ts (`world.transfers`). Public. Read by: nobody in behaviour (measurement may).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SupportStatistics {
    pub recipients: BTreeMap<String, i64>,
}
impl Paper for SupportStatistics {
    const KIND: &'static str = "support_statistics";
}

/// The statistician's public estimate of the resident population, and the counts it is made from.
///
/// Written by: world.ts (`world.statistician`). Public. Read by: utilities.ts (the water and energy utilities size
/// their charges), world.ts (the grant). `residents` is the estimate; `census` the last census.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PopulationEstimate {
    #[serde(deserialize_with = "lenient::int")]
    pub residents: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub census: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub births: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub arrivals: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub deaths: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub departures: i64,
}
impl Paper for PopulationEstimate {
    const KIND: &'static str = "population_estimate";
}

/// The statistician's public price index for a kind of goods: the mean price (cents) across the outlets listing it.
///
/// Written by: world.ts (`world.statistician`). Public. Read by: union.ts (a claim over the year's rise: `kind`,
/// `mean`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PriceIndex {
    pub kind: String,
    #[serde(deserialize_with = "lenient::int")]
    pub mean: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub outlets: i64,
}
impl Paper for PriceIndex {
    const KIND: &'static str = "price_index";
}

/// The valuer's valuation of a lot and what stands on it, sent to the owner and the rating authority, which levies on
/// it. `land` is the land's value and `value` the whole, cents; `year` the valuation year (from 1).
///
/// Written by: world.ts (`world.valuer`). Read by: government.ts (the rate book: `lot`, `value`), citizen.ts (an
/// owner's rates). Addressed to the owner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Valuation {
    pub lot: String,
    pub owner: String,
    #[serde(deserialize_with = "lenient::int")]
    pub land: i64,
    // (Always written, empty for a lot with nothing built: the TS valuer's paper, and what a reader of valuations counts on.)
    #[serde(default)]
    pub buildings: Vec<ValuedBuilding>,
    #[serde(deserialize_with = "lenient::int")]
    pub value: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub year: i64,
}
impl Paper for Valuation {
    const KIND: &'static str = "valuation";
}

/// One building on a valued lot: its structure, type, and value (cents, what it would cost to build now).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ValuedBuilding {
    pub structure: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(deserialize_with = "lenient::int")]
    pub value: i64,
}

/// A grant to the town for a quarter, from the level of government above it: the sum (cents), the residents it is for
/// and the rate per resident per year (cents) that sized it. The money is paid with it by a payment.
///
/// Written by: world.ts (`world.grant`). Read by: government.ts (the council's books). `basis` is the population
/// estimate it rests on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GrantPayment {
    #[serde(deserialize_with = "lenient::int")]
    pub amount: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub residents: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub per_resident_per_year: i64,
}
impl Paper for GrantPayment {
    const KIND: &'static str = "grant_payment";
}

/// A public warning of weather expected: what kind, and from when to when (times).
///
/// Written by: world.ts (`world.weather`). Public. Read by: citizen.ts (people prepare).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WeatherWarning {
    pub kind: String,
    #[serde(deserialize_with = "lenient::int")]
    pub from: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub until: i64,
}
impl Paper for WeatherWarning {
    const KIND: &'static str = "weather_warning";
}

/// A count of newcomers who have come to town as a household: how many people (never who; the statistician reads it).
///
/// Written by: world.ts (`world.arrivals`). Visible to the town's own entity. Read by: world.ts (`population_estimate`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Arrival {
    #[serde(deserialize_with = "lenient::int")]
    pub people: i64,
}
impl Paper for Arrival {
    const KIND: &'static str = "arrival";
}

// ------------------------------------------------------------------ the environment

/// An area of a habitat map: its cover (a label) and the rectangle of cells it spans, from `(x, y)`, `w` wide, `h` tall.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HabitatArea {
    pub cover: String,
    #[serde(deserialize_with = "lenient::int")]
    pub x: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub y: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub w: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub h: i64,
}

/// The environment office's own habitat map (genesis): the district's cover area by area as its scientists last mapped
/// it (a later area over an earlier), and the cells built on then. As old as the day it was made.
///
/// Written by: the world generator. Read by: environment.ts (the office whose map it is). `built` is cell ids
/// (`cell.x.y`), sorted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HabitatMap {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub areas: Vec<HabitatArea>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub built: Vec<String>,
}
impl Paper for HabitatMap {
    const KIND: &'static str = "habitat_map";
}

/// The environmental surveyors' public report for a round: for each species surveyed, the cells covered, the number
/// found, the number in each hundred cells and the change since the last round in basis points (none for the first).
///
/// Written by: environment.ts. Public (the statement also carries an assertion of the text). Read by: nobody in
/// behaviour (the planning office reads the register below).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnvironmentReport {
    #[serde(deserialize_with = "lenient::int")]
    pub round: i64,
    pub species: BTreeMap<String, SpeciesCount>,
}
impl Paper for EnvironmentReport {
    const KIND: &'static str = "environment_report";
}

/// One species' line in an [`EnvironmentReport`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpeciesCount {
    #[serde(deserialize_with = "lenient::int")]
    pub cells: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub found: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub per_100_cells: i64,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient::opt_int")]
    pub change_bps: Option<i64>,
}

/// The register of lots where a listed species has been recorded, this round or before, sent to the planning office,
/// which refuses permits on them. A new round's register supersedes the last (the old one is withdrawn).
///
/// Written by: environment.ts, the `habitat_register` form of papers.ts. Public. Read by: institutions.ts (planning).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HabitatRegister {
    #[serde(deserialize_with = "lenient::int")]
    pub round: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty", deserialize_with = "lenient::ids")]
    pub lots: Vec<String>,
}
impl Paper for HabitatRegister {
    const KIND: &'static str = "habitat_register";
}

// ------------------------------------------------------------------ (gd-adoption) systems from an outside vendor

/// (gd-adoption) What the outside world's vendor sells, at this month's prices: a kind of system, what it does and
/// at what cost. Published again when its prices or its list of clients change (the old one is withdrawn). Prices are
/// cents; rates are basis points; `speed_bps` is its speed against a person's (10,000 is as long as a person takes);
/// `scope_bps` the share of a task's units it can do; `error_bps` how often it gets a unit wrong. `for` is `firms`
/// (a task a business does: `task`) or `offices` (the papers an office writes: `kinds`). `seconds` is the seconds a
/// unit of the task takes it and `oversight_hours_per_month` the buyer's own staff hours a month to look after
/// one; both can be fractional, so they are held as the JSON number written (no float in the world: whoever ports automation.ts decides their integer unit).
///
/// Written by: automation.ts (`world.vendor`). Public. Read by: automation.ts (`Adoption`, `offersOf`: the latest of
/// each vendor's offers). The record's own `speaks_for` is the vendor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SystemOffer {
    pub id: String,
    pub title: String,
    #[serde(rename = "for")]
    pub for_: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kinds: Vec<String>,
    pub template: String,
    pub seconds: serde_json::Number,
    #[serde(deserialize_with = "lenient::int")]
    pub speed_bps: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub scope_bps: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub setup: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub fee_per_year: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub exit: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub term_days: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub notice_days: i64,
    pub oversight_hours_per_month: serde_json::Number,
    #[serde(deserialize_with = "lenient::int")]
    pub error_bps: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    pub account: String,
    #[serde(deserialize_with = "lenient::int")]
    pub fee_month: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub references: i64,
}
impl Paper for SystemOffer {
    const KIND: &'static str = "system_offer";
}

/// (gd-adoption) The vendor's notice to a buyer that the systems it bought are delivered, with the offer's terms as
/// they were when it was bought, and the ids of the systems delivered. The licence is offered as an agreement
/// alongside it.
///
/// Written by: automation.ts (`world.vendor`). Read by: automation.ts (`Fleet`: which systems are the firm's, on what
/// terms). Addressed to the buyer; `basis` is the order. `setup` is the cents paid with the order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SystemDelivery {
    pub order: String,
    pub offer: String,
    pub vendor: String,
    pub account: String,
    #[serde(rename = "for")]
    pub for_: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kinds: Vec<String>,
    pub template: String,
    pub title: String,
    pub seconds: serde_json::Number,
    #[serde(deserialize_with = "lenient::int")]
    pub speed_bps: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub scope_bps: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub error_bps: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub systems: Vec<String>,
    #[serde(deserialize_with = "lenient::int")]
    pub fee_month: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub exit: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub term_days: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub notice_days: i64,
    pub oversight_hours_per_month: serde_json::Number,
    #[serde(deserialize_with = "lenient::int")]
    pub setup: i64,
}
impl Paper for SystemDelivery {
    const KIND: &'static str = "system_delivery";
}

/// (gd-adoption) The vendor's notice that a licence has ended or its fee was not paid and the systems are switched off.
///
/// Written by: automation.ts (`world.vendor`). Read by: automation.ts (`Fleet`, which stops counting them).
/// Addressed to the buyer. `why` says why.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SystemEnded {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery: Option<String>,
    pub order: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub systems: Vec<String>,
    pub why: String,
}
impl Paper for SystemEnded {
    const KIND: &'static str = "system_ended";
}

/// (gd-adoption) A public body's invitation to bid to supply systems that write a set of its papers: for what, how many
/// a month, and until when; the lowest cost over the payback horizon is awarded.
///
/// Written by: automation.ts (`Adoption`, an office). Public. Read by: automation.ts (`world.vendor`, which bids).
/// `closes` is a time; `volume` papers a month; `term_days` the licence's term.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tender {
    pub what: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kinds: Vec<String>,
    #[serde(deserialize_with = "lenient::int")]
    pub volume: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub closes: i64,
    #[serde(deserialize_with = "lenient::int")]
    pub term_days: i64,
}
impl Paper for Tender {
    const KIND: &'static str = "tender";
}

/// (gd-adoption) The vendor's bid on a tender: one of its offers, at its prices, with the tender's id.
///
/// Written by: automation.ts (`world.vendor`). Read by: automation.ts (`Adoption`, which awards to the cheapest).
/// Addressed to the body that invited bids.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bid {
    pub tender: String,
    #[serde(flatten)]
    pub offer: SystemOffer,
}
impl Paper for Bid {
    const KIND: &'static str = "bid";
}

// Written here too, typed in another file:
// - household (world.ts for newcomers; citizen.ts): citizen.rs.
// - hearing_notice, venue_decision (frictions.ts readers; desk.ts, tribunal.ts): offices.rs.
// - utilities.ts and institutions.ts write `invoice` and `price_list` too: typed above (the extra fields are optional).
// - request (lengnick.ts dividend, one instruction to the bank for many payments): finance.rs. shareholders and the
//   dividend are lengnick.ts's; the dividend's own paper is the request.
// - closure (retailer.ts: a shop that did not open, or whose owner went): firms.rs. property_purchase (retailer.ts):
//   firms.rs.
// - remedy_answer, tribunal_response (the Respondent that retailer.ts and producer.ts run): finance.rs, offices.rs.
// - fund_decision (founded.ts): mind.rs. death_notification: citizen.rs.

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
        assert!(KINDS.contains(&PriceList::KIND) && KINDS.contains(&Bid::KIND));
        assert_eq!(KINDS.len(), 28);
    }

    #[test]
    fn a_shop_s_a_wholesaler_s_and_a_builder_s_price_list_all_read() {
        let shop = json!({ "goods": { "bread": 450 }, "account": "acc-s1", "at": "shop-1" });
        let p = read::<PriceList>(&statement("price_list", shop.clone())).unwrap();
        assert_eq!(p.goods["bread"], 450);
        assert_eq!(data(&p), shop);
        let wholesale = json!({ "goods": { "flour": 200 }, "account": "acc-m", "min_order": 50, "terms_days": 30 });
        assert_eq!(data(&read::<PriceList>(&statement("price_list", wholesale.clone())).unwrap()), wholesale);
        let builder = json!({ "prices": { "house": 25000000 }, "demolition": 300000 });
        let b = read::<PriceList>(&statement("price_list", builder.clone())).unwrap();
        assert!(b.goods.is_empty() && b.account.is_none());
        assert_eq!(data(&b), builder);
    }

    #[test]
    fn an_order_paid_with_it_and_one_on_terms_both_round_trip() {
        let paid = json!({ "kind": "bread", "quantity": 20, "unit_price": 450, "deliver_to": "shop-1", "at": "shop-1", "account": "acc-b", "for_days": 7 });
        assert_eq!(data(&read::<Order>(&statement("order", paid.clone())).unwrap()), paid);
        let terms = json!({ "kind": "flour", "quantity": 100, "unit_price": 200, "deliver_to": "shop-1", "at": "shop-1", "account": "acc-b", "pay_in_days": 30, "retry_of": "rec.3" });
        let o = read::<Order>(&statement("order", terms.clone())).unwrap();
        assert_eq!(o.pay_in_days, Some(30));
        assert_eq!(data(&o), terms);
    }

    #[test]
    fn a_delivery_note_a_declined_note_and_an_invoice_on_terms_round_trip() {
        let part = json!({ "order": "rec.4", "kind": "bread", "ordered": 20, "delivered": 15, "refund": 2250 });
        assert_eq!(data(&read::<DeliveryNote>(&statement("delivery_note", part.clone())).unwrap()), part);
        let declined = json!({ "order": "rec.4", "kind": "bread", "ordered": 20, "delivered": 0, "refund": 0, "declined": "unpaid" });
        assert_eq!(read::<DeliveryNote>(&statement("delivery_note", declined)).unwrap().declined.as_deref(), Some("unpaid"));
        let on_terms = json!({ "order": "rec.4", "kind": "flour", "ordered": 100, "delivered": 100, "refund": 0, "owed": 20000, "pay_in_days": 30, "pay_to": "acc-m" });
        assert_eq!(data(&read::<DeliveryNote>(&statement("delivery_note", on_terms.clone())).unwrap()), on_terms);
    }

    #[test]
    fn an_invoice_reads_a_text_amount_and_a_utility_bill() {
        let export = json!({ "kind": "grain", "quantity": 40, "from_at": "works-1",
            "outcome": { "money": { "to": "acc-m", "amount": "800000", "for": "40 grain exported" } } });
        let i = read::<Invoice>(&statement("invoice", export)).unwrap();
        assert_eq!(i.outcome.unwrap().money.unwrap().amount, 800000);
        let water = json!({ "outcome": { "money": { "to": "acc-w", "amount": "5120" } }, "service": "water", "home": "h1", "kl": 18 });
        let i = read::<Invoice>(&statement("invoice", water)).unwrap();
        assert_eq!(i.service.as_deref(), Some("water"));
        assert_eq!(i.kl, Some(18));
    }

    #[test]
    fn a_benefit_decision_granted_and_refused_round_trips() {
        let granted = json!({ "claim": "rec.7", "payment": "pension", "granted": true, "amount": 150000, "every": 1209600, "until": 99999999 });
        assert_eq!(data(&read::<BenefitDecision>(&statement("benefit_decision", granted.clone())).unwrap()), granted);
        let refused = json!({ "claim": "rec.8", "payment": "pension", "granted": false, "reason": "too young" });
        assert_eq!(data(&read::<BenefitDecision>(&statement("benefit_decision", refused.clone())).unwrap()), refused);
    }

    #[test]
    fn the_registers_the_statistician_and_the_vendor_read() {
        let r = json!({ "holders": [{ "holder": "p1", "account": "acc-p1", "shares": 10000 }] });
        assert_eq!(data(&read::<Shareholders>(&statement("shareholders", r.clone())).unwrap()), r);
        let e = json!({ "round": 2, "species": { "frog": { "cells": 40, "found": 6, "per_100_cells": 15, "change_bps": -1200 } } });
        assert_eq!(data(&read::<EnvironmentReport>(&statement("environment_report", e.clone())).unwrap()), e);
        let offer = json!({ "id": "scribe", "title": "A scribe", "for": "offices", "kinds": ["permit_decision"], "template": "licence", "seconds": 30.0,
            "speed_bps": 5000, "scope_bps": 8000, "setup": 100000, "fee_per_year": 600000, "exit": 50000, "term_days": 365, "notice_days": 30,
            "oversight_hours_per_month": 2.0, "error_bps": 200, "vendor": "outside", "account": "acc-v", "fee_month": 50000, "references": 3 });
        let s = read::<SystemOffer>(&statement("system_offer", offer.clone())).unwrap();
        assert_eq!(data(&s), offer);
        let mut bid = offer;
        bid["tender"] = json!("rec.55");
        let b = read::<Bid>(&statement("bid", bid.clone())).unwrap();
        assert_eq!(b.tender, "rec.55");
        assert_eq!(data(&b), bid);
    }

    #[test]
    fn a_habitat_map_round_trips() {
        let d = json!({ "areas": [{ "cover": "woodland", "x": 0, "y": 0, "w": 4, "h": 3 }], "built": ["cell.1.1", "cell.2.2"] });
        assert_eq!(data(&read::<HabitatMap>(&statement("habitat_map", d.clone())).unwrap()), d);
    }
}
