//! What stands open at the town's offices, as each office's clerk reads it from the office's own papers and accounts
//! (participants/src/behaviour/openbooks-townhall.ts; docs/behaviour/office-books.md): the finance office, the mayor's,
//! the works and environment offices, the planning office and the council clerk's. Each reader is a plain restatement of
//! what that module's code works out for itself wake after wake, from the same papers, read the same way and with the
//! same figures; nothing here decides or does anything, and nothing is read that the office's code is not shown.
//!
//! Rewritten, not transliterated: whole numbers, ordered collections, the same papers out (the words are the TS words).
//!
//! Decided fresh:
//! - What a reader keeps across wakes (`State`) is its book, what its account has paid (`Paid`) and, for the mayor, what
//!   the office has acted on (`acted`); `save`/`restore` carry all of it.
//! - The works and environment readers read the directions that stand as filed (`Directions::stands`): the office's
//!   draw of compliance is the office's, and a clerk draws nothing.
//! - A return's day is the world's own (`due_on`: the calendar's months where the world has one, the thirty-day months
//!   otherwise), as the payroll that files the return reckons it.
//! - The mayor's office is the position the clerk keeps books for (`office`); the TS fell back to the participant's own
//!   authorship when there was none, which a clerk never has.

use super::books::{OfficeBooks, OpenHeading, OpenItem};
use super::openbooks::{addressed, amt, by_day, d, date_words, heading, js, num, pressing, terms_of, usd, when, R};
use crate::common::{approval_of, bases_of, cents, duration_words, made_at, text, truthy, Book, Directions, Fields, DAY, YEAR};
use crate::firms::returns::{due_on, ReturnDue};
use crate::firms::staffing::{staffing_under, Own, Staffing, StaffingOpts};
use crate::firms::tax::{income_tax_law, withheld};
use crate::papers::agreements::{commitment_of, job_terms};
use crate::{Picture, WorldInfo};
use oikos_sight::{Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

// ---------------------------------------------------------------- the small readings

fn is_statement(r: &Record) -> bool {
    matches!(r.body, RecordBody::Statement { .. })
}

/// A template literal of `x ?? y` for a field: its words, or the default where it is absent or null.
fn or_words(v: Option<&Value>, otherwise: &str) -> String {
    match v {
        None | Some(Value::Null) => otherwise.to_string(),
        x => js(x),
    }
}

/// A parameter as a whole number (the module's default where the world gives none).
fn pi(params: &Map<String, Value>, key: &str, otherwise: i64) -> i64 {
    params.get(key).map_or(otherwise, |v| num(Some(v)).unwrap_or(otherwise))
}

/// A parameter as text (the module's default where the world gives none).
fn ps(params: &Map<String, Value>, key: &str, otherwise: &str) -> String {
    match params.get(key) {
        None | Some(Value::Null) => otherwise.to_string(),
        Some(v) => js(Some(v)),
    }
}

/// `Number(r.data?.period_end ?? r.at)`.
fn period_end(r: &Record) -> i64 {
    match d(r).get("period_end") {
        None | Some(Value::Null) => r.at,
        v => num(v).unwrap_or(r.at),
    }
}

/// `durationWords(Number(x))`.
fn dur(v: Option<&Value>) -> String {
    num(v).map_or_else(|| "NaN seconds".to_string(), duration_words)
}

/// `Math.round(n / d)` of whole numbers (halves go up).
fn round_div(n: i128, den: i128) -> i64 {
    (2 * n + den).div_euclid(2 * den) as i64
}

fn plural<'a>(n: i64, one: &'a str, many: &'a str) -> &'a str {
    if n == 1 {
        one
    } else {
        many
    }
}

fn year_in_days(year: i64) -> String {
    format!("day {} to day {}", (year - 1) * 365, year * 365 - 1)
}

/// A budget's lines as written (`name -> cents`), in the order the paper keeps them.
fn lines_of(b: Option<&Record>) -> Vec<(String, i64)> {
    b.and_then(|b| d(b).get("lines")).and_then(Value::as_object).map(|m| m.iter().map(|(k, v)| (k.clone(), amt(Some(v)))).collect()).unwrap_or_default()
}

fn lines_words(lines: &[(String, i64)], w: &WorldInfo) -> String {
    lines.iter().map(|(k, v)| format!("{k} {}", usd(*v, w))).collect::<Vec<_>>().join(", ")
}

/// Is a budget's year this year (`b.data?.year === year`).
fn year_is(b: &Record, year: i64) -> bool {
    d(b).get("year").and_then(Value::as_i64) == Some(year)
}

/// The town's budget for a year, of those adopted (the latest, if the council adopted more than one for it).
fn budget_for(book: &Book, year: i64) -> Option<&R> {
    super::openbooks::latest(book.open("budget").filter(|b| year_is(b, year)))
}

/// Who has died, and when it was registered (the first paper to say so).
fn dead(book: &Book) -> BTreeMap<String, i64> {
    let mut m = BTreeMap::new();
    for r in book.all("death_registration").chain(book.all("death_certificate")) {
        if let Some(who) = d(r).get("deceased").and_then(Value::as_str) {
            m.entry(who.to_string()).or_insert(r.at);
        }
    }
    m
}

/// `t >= (closes_at ?? Infinity)`.
fn closed_by(t: i64, closes_at: Option<&Value>) -> bool {
    match closes_at {
        None | Some(Value::Null) => false,
        v => num(v).is_some_and(|c| t >= c),
    }
}

/// `Number.isFinite(x)` (no coercion: only a number is).
fn finite_number(v: Option<&Value>) -> Option<i64> {
    match v {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f as i64)),
        _ => None,
    }
}

/// `dateWords(x)` of something that may not be a number.
fn date_of(v: Option<&Value>, w: &WorldInfo) -> String {
    num(v).map_or_else(|| "year NaN, day NaN".to_string(), |t| date_words(t, w))
}

/// Every `rec.<n>` a paper's words name (`/\brec\.[0-9]+\b/g`).
fn rec_ids(s: &str) -> Vec<String> {
    let b = s.as_bytes();
    let word = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
    let mut out = vec![];
    let mut i = 0;
    while i < b.len() {
        if b[i..].starts_with(b"rec.") && (i == 0 || !word(b[i - 1])) {
            let mut j = i + 4;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            if j > i + 4 && (j == b.len() || !word(b[j])) {
                out.push(s[i..j].to_string());
                i = j;
                continue;
            }
        }
        i += 1;
    }
    out
}

// ---------------------------------------------------------------- what an office has seen leave its account

/// A payment seen to settle a paper: which, when, how much, and the line of the budget it was drawn on.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Settling {
    id: String,
    t: i64,
    amount: i64,
    line: Option<String>,
}

/// A payment seen made under a standing payment of the office's (after what was withheld).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ByOrder {
    t: i64,
    order: String,
    amount: i64,
    line: Option<String>,
}

/// A payment and what it said it was for (the bank's statement line, `memo`).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SaidFor {
    t: i64,
    memo: String,
    amount: i64,
}

/// What an office has seen leave its own account: what settled which paper and the wages its standing payments paid.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Paid {
    settled: BTreeSet<String>,
    settling: Vec<Settling>,
    by_order: Vec<ByOrder>,
    said_for: Vec<SaidFor>,
    account: Option<String>,
}

impl Paid {
    fn absorb(&mut self, pic: &Picture) {
        let Some(acc) = crate::common::own_account(pic) else { return };
        for tx in pic.transactions() {
            if tx.from != acc.account {
                continue;
            }
            let line = tx.line.clone().filter(|l| !l.is_empty());
            if let Some(m) = tx.memo.as_ref().filter(|m| !m.is_empty()) {
                self.said_for.push(SaidFor { t: tx.t, memo: m.clone(), amount: cents(tx.amount) });
            }
            if let Some(s) = tx.settles.as_ref().filter(|s| !s.is_empty()) {
                self.settled.insert(s.clone());
                self.settling.push(Settling { id: s.clone(), t: tx.t, amount: cents(tx.amount), line: line.clone() });
            }
            if let Some(o) = tx.per_instruction.as_ref().filter(|s| !s.is_empty()) {
                self.by_order.push(ByOrder { t: tx.t, order: o.clone(), amount: cents(tx.amount), line });
            }
        }
        self.account = Some(acc.account);
    }
}

// ---------------------------------------------------------------- the readers

/// What a reader keeps: its book, what its account has paid, and (the mayor's) what the office has acted on.
#[derive(Default)]
struct State {
    book: Book,
    paid: Paid,
    acted: BTreeSet<String>,
}

struct FinanceParams {
    period: i64,
    procedure: String,
    payroll_wait_days: i64,
}

enum Kind {
    Finance { p: FinanceParams, staffing: Staffing },
    Mayor { threshold_bps: i64, population: i64, budget_lead_days: i64 },
    Employer { payroll_office: String, staffing: Staffing, directions: Directions, forms: &'static [&'static str] },
    Planning,
    Clerk,
}

struct Reader {
    me: String,
    /// The position the clerk keeps the books of.
    office: String,
    kind: Kind,
    st: State,
}

const WORKS_FORMS: &[&str] = &["works_staffing", "works_collection"];
const ENVIRONMENT_FORMS: &[&str] = &["environment_staffing"];

/// The reader of the books of the town's offices, if `of` is one of them.
pub fn reader(of: &str, me: &str, office: &str, params: &Map<String, Value>) -> Option<Box<dyn OfficeBooks>> {
    let kind = match of {
        "city.finance_officer" => {
            let period = pi(params, "period", 14 * DAY);
            let wait = pi(params, "payroll_wait_days", 3);
            let mut o = StaffingOpts::new(period, pi(params, "notice_days", 14), "staff");
            o.hire = false;
            o.pay = true;
            o.notice_wait = Some(wait * DAY);
            Kind::Finance { p: FinanceParams { period, procedure: ps(params, "procedure", ""), payroll_wait_days: wait }, staffing: Staffing::new(me, o) }
        }
        "city.mayor_code" => Kind::Mayor {
            threshold_bps: pi(params, "petition_threshold_bps", 1500),
            population: pi(params, "population", 200),
            budget_lead_days: pi(params, "budget_lead_days", 0),
        },
        "city.works" | "city.environment" => {
            let works = of == "city.works";
            let role = ps(params, "role", if works { "works crew" } else { "environmental scientist" });
            let mut o = StaffingOpts::new(pi(params, "period", 14 * DAY), pi(params, "notice_days", 14), &role);
            let wp = ps(params, "workplace", "");
            o.workplace = Some(wp).filter(|s| !s.is_empty());
            o.industry = Some(ps(params, "industry", "")).filter(|s| !s.is_empty());
            o.hire = true;
            o.pay = false;
            o.own = Some(if works { Own::RoleOrUnnamed } else { Own::Role });
            let payroll_office = ps(params, "payroll_office", "");
            o.payroll = Some(payroll_office.clone()).filter(|s| !s.is_empty());
            let directions = Directions::reading(me, Some(office), &ps(params, "directed_under", ""));
            Kind::Employer { payroll_office, staffing: Staffing::new(me, o), directions, forms: if works { WORKS_FORMS } else { ENVIRONMENT_FORMS } }
        }
        "city.planning_officer" => Kind::Planning,
        "city.council_clerk" => Kind::Clerk,
        _ => return None,
    };
    Some(Box::new(Reader { me: me.to_string(), office: office.to_string(), kind, st: State::default() }))
}

impl Reader {
    /// The office's own records: made in the position the clerk keeps books for.
    fn ours(&self, r: &Record) -> bool {
        !self.office.is_empty() && r.position.as_deref() == Some(self.office.as_str())
    }
}

impl OfficeBooks for Reader {
    fn absorb(&mut self, pic: &Picture) {
        let fresh = self.st.book.absorb(pic);
        match &self.kind {
            Kind::Finance { .. } => self.st.paid.absorb(pic),
            Kind::Mayor { .. } => {
                let office = self.office.clone();
                for r in fresh.iter().filter(|r| !office.is_empty() && r.position.as_deref() == Some(office.as_str())) {
                    for b in bases_of(r) {
                        self.st.acted.insert(b.clone());
                    }
                    // (A paper of the office's own that names a petition in its words is the office acting on it, as one
                    // that cites it is: a seat put two petitions to the council on the proposal form, whose paper cites
                    // nothing, and its books listed all four as not acted on for the 45 days that followed.)
                    if let RecordBody::Statement { kind, text, .. } = &r.body {
                        if kind == "proposal" || kind == "petition_response" {
                            self.st.acted.extend(rec_ids(text));
                        }
                    }
                }
                self.st.paid.absorb(pic);
            }
            _ => {}
        }
    }

    fn open(&self, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
        let (st, me) = (&self.st, self.me.as_str());
        match &self.kind {
            Kind::Finance { p, staffing } => finance(st, me, p, staffing, t, w),
            Kind::Mayor { threshold_bps, population, budget_lead_days } => mayor(self, *threshold_bps, *population, *budget_lead_days, t, w),
            Kind::Employer { payroll_office, staffing, directions, forms } => employer(st, me, payroll_office, staffing, directions, forms, t, w),
            Kind::Planning => planning(&st.book, me, w),
            Kind::Clerk => clerk(&st.book, me, t, w),
        }
    }

    fn save(&self) -> Result<Value, String> {
        Ok(json!({ "book": self.st.book.save(), "paid": serde_json::to_value(&self.st.paid).map_err(|e| e.to_string())?, "acted": self.st.acted }))
    }

    fn restore(&mut self, saved: &Value) -> Result<(), String> {
        if saved.is_null() {
            return Ok(());
        }
        self.st.book = Book::restore(saved.get("book").cloned().unwrap_or(Value::Null))?;
        self.st.paid = serde_json::from_value(saved.get("paid").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
        self.st.acted = serde_json::from_value(saved.get("acted").cloned().unwrap_or(Value::Null)).unwrap_or_default();
        Ok(())
    }
}

// ---------------------------------------------------------------- the finance office

/// city.finance_officer: invoices addressed to the town and not paid; the town's employees whose wage is not being
/// paid; wages still being paid to someone who has died or whose employment has ended; the year's budget against what
/// has been paid; the tax withheld from wages and not yet paid over; and the returns that fall due.
fn finance(st: &State, me: &str, p: &FinanceParams, staffing: &Staffing, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
    let (book, paid) = (&st.book, &st.paid);
    let year = t.div_euclid(YEAR) + 1;
    // ---- invoices addressed to the town, not paid ----
    let rule = approval_of(book, &p.procedure);
    let approved: BTreeSet<String> = rule
        .as_ref()
        .map(|(by, _)| book.open("approval").filter(|a| a.position.as_deref() == Some(by.as_str())).map(|a| js(d(a).get("invoice"))).collect())
        .unwrap_or_default();
    let mut invoices = vec![];
    for r in book.open("invoice") {
        let money = d(r).get("outcome").and_then(|o| o.get("money")).filter(|m| truthy(m));
        if !addressed(r, me) || money.is_none() || paid.settled.contains(&r.id) {
            continue;
        }
        let amount = amt(money.and_then(|m| m.get("amount")));
        let over = rule.as_ref().is_some_and(|(_, over)| amount > *over);
        let line = format!(
            "{}: invoice from {} for {}, dated {}, not paid{}",
            r.id,
            r.speaks_for.clone().unwrap_or_else(|| r.author.clone()),
            usd(amount, w),
            when(made_at(r), w),
            match (&rule, over) {
                (Some((_, over_figure)), true) => format!(
                    "; it is over the payments procedure's figure of {} and {}",
                    usd(*over_figure, w),
                    if approved.contains(&r.id) { "the mayor's written approval is on file" } else { "the mayor's written approval is not on file" }
                ),
                _ => String::new(),
            }
        );
        invoices.push(OpenItem::new(r.id.clone(), line).since(made_at(r)).amount(Some(amount)));
    }
    // ---- wages: the standing payments on file, by the agreement each rests on ----
    let mut orders: Vec<(String, Vec<&R>)> = vec![]; // agreement -> its standing payments, not withdrawn
    for r in book.open("request") {
        if r.speaks_for.as_deref() == Some(me) && d(r).get("every").is_some_and(truthy) {
            for b in bases_of(r) {
                match orders.iter_mut().find(|(a, _)| a == b) {
                    Some((_, rs)) => rs.push(r),
                    None => orders.push((b.clone(), vec![r])),
                }
            }
        }
    }
    let has_order = |id: &str| orders.iter().any(|(a, _)| a == id);
    let deaths = dead(book);
    let mut starters: BTreeMap<String, &R> = BTreeMap::new();
    for n in book.open("payroll_notice") {
        if n.speaks_for.as_deref() == Some(me) && d(n).s("notice") == Some("starter") {
            if let Some(a) = d(n).s("agreement") {
                starters.insert(a.to_string(), n);
            }
        }
    }
    let mut unpaid = vec![];
    for a in staffing.staff(book, t) {
        let worker = terms_of(a).and_then(|x| x.parties.get(1)).map(String::as_str);
        let worker_words = super::openbooks::jss(worker);
        if has_order(&a.id) || worker.is_some_and(|x| deaths.contains_key(x)) {
            continue;
        }
        // (Work by the day is paid for each day worked, and has no standing payment.)
        if terms_of(a).is_some_and(|x| x.commitments.iter().any(|c| c.who == me && c.every == Some(DAY) && c.does.get("outcome").and_then(|o| o.get("money")).is_some_and(truthy))) {
            continue;
        }
        let signed = book.signed_at(&a.id).unwrap_or(a.at);
        let told = starters.get(&a.id);
        // (The office waits a few days for the hiring office's notice before it sets the wage up from the agreement.)
        if told.is_none() && t - signed < p.payroll_wait_days * DAY {
            continue;
        }
        let pays = job_terms(a, worker.unwrap_or(""), None);
        let line = format!(
            "{}: {} works for the town on {} every {}, in force since {}; no standing payment of the wage is on file{}",
            a.id,
            worker_words,
            usd(pays.wage, w),
            duration_words(pays.period),
            date_words(signed, w),
            match told {
                Some(n) => format!(
                    "; the hiring office's payroll notice {} names it{}",
                    n.id,
                    match d(n).get("line") {
                        Some(Value::String(l)) => format!(", as a post the {l} line of the adopted budget pays for"),
                        _ => String::new(),
                    }
                ),
                None => "; no payroll notice has come for it".to_string(),
            }
        );
        unpaid.push(OpenItem::new(a.id.clone(), line).since(signed).amount(Some(pays.wage)));
    }
    let mut stale = vec![];
    for (agreement, rs) in &orders {
        let Some(a) = book.get(agreement) else { continue };
        let Some(terms) = terms_of(a) else { continue };
        if terms.template.as_deref() != Some("employment") || terms.parties.first().map(String::as_str) != Some(me) {
            continue;
        }
        let worker = super::openbooks::jss(terms.parties.get(1).map(String::as_str));
        let ends = book.ends_at(agreement);
        let why = if let Some(&died) = deaths.get(&worker) {
            Some((died, format!("{worker}, whose death is registered ({})", date_words(died, w))))
        } else {
            ends.filter(|e| t >= *e).map(|e| (e, format!("{worker}, whose employment ended {}", date_words(e, w))))
        };
        let Some((since, words)) = why else { continue };
        for r in rs {
            let amount = amt(d(r).get("outcome").and_then(|o| o.get("money")).and_then(|m| m.get("amount")));
            let line = format!("{}: a standing payment of {} every {} for {}, under agreement {}, is not withdrawn", r.id, usd(amount, w), dur(d(r).get("every")), words, agreement);
            stale.push(OpenItem::new(r.id.clone(), line).since(since).amount(Some(amount)));
        }
    }
    // ---- the budget for the year ----
    // (The office's papers keep payments in total: a payment that settles an invoice is not marked with a line of the
    // budget, nor a wage, so what is paid against the budget can be told only for the year as a whole.)
    let (from, to) = ((year - 1) * YEAR, year * YEAR);
    let invoice_ids: BTreeSet<&str> = book.all("invoice").map(|r| r.id.as_str()).collect();
    let invoices_paid: i64 = paid.settling.iter().filter(|x| x.t >= from && x.t < to && invoice_ids.contains(x.id.as_str())).map(|x| x.amount).sum();
    // (What each payment drawn on the budget says line it is drawn on: an invoice paid, a wage paid with what was
    // withheld from it. A payment that names none is unallocated: shown so, never refused.)
    let mut spent_on: BTreeMap<String, i64> = BTreeMap::new();
    let mut draw = |line: Option<&str>, n: i64| *spent_on.entry(line.unwrap_or("").to_string()).or_insert(0) += n;
    for x in paid.settling.iter().filter(|x| x.t >= from && x.t < to && invoice_ids.contains(x.id.as_str())) {
        draw(x.line.as_deref(), x.amount);
    }
    let per_pay = |order: &str| -> i64 {
        let Some(r) = book.get(order).filter(|r| is_statement(r)) else { return 0 };
        let net = amt(d(r).get("outcome").and_then(|o| o.get("money")).and_then(|m| m.get("amount")));
        for b in bases_of(r) {
            if let Some(a) = book.get(b).filter(|a| terms_of(a).is_some()) {
                let gross = commitment_of(a, me).0.and_then(|o| o.money).map_or(0, |m| m.amount);
                return (gross - net).max(0);
            }
        }
        0
    };
    let mut held: BTreeMap<String, i64> = BTreeMap::new();
    let (mut wages, mut withheld_since) = (0i64, 0i64);
    let reports: Vec<&R> = book.open("withholding_report").filter(|r| r.speaks_for.as_deref() == Some(me)).collect();
    let last_report_end = reports.iter().fold(-1, |m, r| m.max(period_end(r)));
    for x in &paid.by_order {
        let hold = *held.entry(x.order.clone()).or_insert_with(|| per_pay(&x.order));
        if x.t >= from && x.t < to {
            wages += x.amount + hold;
            draw(x.line.as_deref(), x.amount + hold);
        }
        if x.t > last_report_end {
            withheld_since += hold;
        }
    }
    let adopted = budget_for(book, year);
    let last: Option<&R> = adopted.or_else(|| {
        let mut best: Option<(&R, i64)> = None;
        for b in book.open("budget") {
            let Some(y) = d(b).get("year").and_then(Value::as_i64).filter(|y| *y < year) else { continue };
            if best.is_none_or(|(c, cy)| y > cy || (y == cy && b.at > c.at)) {
                best = Some((b, y));
            }
        }
        best.map(|(b, _)| b)
    });
    // (What the year's payments said they were for, as the bank's statement has them: the nearest the office's papers
    // come to telling one kind of spending from another. The five largest, and the rest together.)
    let mut for_what: BTreeMap<&str, i64> = BTreeMap::new();
    for x in paid.said_for.iter().filter(|x| x.t >= from && x.t < to) {
        *for_what.entry(x.memo.as_str()).or_insert(0) += x.amount;
    }
    let mut by_memo: Vec<(&str, i64)> = for_what.into_iter().collect();
    by_memo.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    let said_words = if by_memo.is_empty() {
        String::new()
    } else {
        format!(
            ". By what the payments said they were for: {}{}",
            by_memo.iter().take(5).map(|(m, n)| format!("\"{m}\" {}", usd(*n, w))).collect::<Vec<_>>().join("; "),
            if by_memo.len() > 5 { format!("; {} other kinds {}", by_memo.len() - 5, usd(by_memo[5..].iter().map(|x| x.1).sum(), w)) } else { String::new() }
        )
    };
    // Room left by line: each line of the adopted budget, what has been drawn on it and what is left; and what no line was
    // named for. Lines the payments name that the budget does not have are said too.
    let by_line = |lines: &[(String, i64)]| -> String {
        let mut names: BTreeSet<&str> = lines.iter().map(|(k, _)| k.as_str()).collect();
        names.extend(spent_on.keys().filter(|k| !k.is_empty()).map(String::as_str));
        let each: Vec<String> = names
            .iter()
            .map(|k| {
                let drawn = spent_on.get(*k).copied().unwrap_or(0);
                match lines.iter().find(|(n, _)| n == k) {
                    None => format!("{k} (not a line of the budget) {} drawn", usd(drawn, w)),
                    Some((_, v)) => format!("{k} {} drawn of {}, {} left", usd(drawn, w), usd(*v, w), usd(*v - drawn, w)),
                }
            })
            .collect();
        let none = spent_on.get("").copied().unwrap_or(0);
        format!("{}; {}", each.join("; "), if none != 0 { format!("{} unallocated (payments that name no line)", usd(none, w)) } else { "nothing unallocated".to_string() })
    };
    let mut budget = vec![];
    if let Some(adopted) = adopted {
        let lines = lines_of(Some(adopted));
        let total: i64 = lines.iter().map(|(_, v)| v).sum();
        let spent = invoices_paid + wages;
        let line = format!(
            "{}: the budget adopted for year {year} ({}) is {} in all ({}); paid so far this year {} ({} on invoices, {} in wages, the wages counted before tax withheld); {} is left. By line: {}{}",
            adopted.id,
            year_in_days(year),
            usd(total, w),
            lines_words(&lines, w),
            usd(spent, w),
            usd(invoices_paid, w),
            usd(wages, w),
            usd(total - spent, w),
            by_line(&lines),
            said_words
        );
        budget.push(OpenItem::new(adopted.id.clone(), line).running().since(adopted.at).amount(Some(total - spent)));
    } else {
        let lines = lines_of(last.map(|l| l.as_ref()));
        let total: i64 = lines.iter().map(|(_, v)| v).sum();
        let line = match last {
            Some(l) => format!(
                "no budget is adopted for year {year} ({}); under the budget last adopted ({}, year {}: {}; {} in all) and at no more each month than a twelfth of it; paid so far this year {} ({} on invoices, {} in wages; {})",
                year_in_days(year),
                l.id,
                js(d(l).get("year")),
                lines_words(&lines, w),
                usd(total, w),
                usd(invoices_paid + wages, w),
                usd(invoices_paid, w),
                usd(wages, w),
                by_line(&lines)
            ),
            None => format!("no budget has been adopted for year {year} ({}), and none before it; paid so far this year {}", year_in_days(year), usd(invoices_paid + wages, w)),
        };
        budget.push(OpenItem::new(format!("budget-year-{year}"), line).running().since(from));
    }
    // ---- tax withheld from wages, not yet paid over ----
    let mut latest_report: Vec<(String, &R)> = vec![]; // collector -> its latest report
    for r in &reports {
        let c = crate::common::addressed_to(r).first().cloned().unwrap_or_else(|| "the collector".to_string());
        match latest_report.iter_mut().find(|(k, _)| *k == c) {
            Some((_, was)) => {
                if period_end(r) >= period_end(was) {
                    *was = r;
                }
            }
            None => latest_report.push((c, r)),
        }
    }
    let mut tax = vec![];
    for (collector, r) in &latest_report {
        let (owed, paid_over) = (amt(d(r).get("withheld")), amt(d(r).get("paid")));
        let owing = owed - paid_over;
        if owing > 0 {
            let line = format!(
                "{}: at the report to {collector} of {} the town owed {} of tax withheld from wages and paid over {}; {} was still owing",
                r.id,
                date_words(r.at, w),
                usd(owed, w),
                usd(paid_over, w),
                usd(owing, w)
            );
            tax.push(OpenItem::new(r.id.clone(), line).since(r.at).amount(Some(owing)));
        }
    }
    if withheld_since > 0 {
        let line = format!(
            "{} of tax has been withheld from wages paid {}",
            usd(withheld_since, w),
            if last_report_end >= 0 { format!("since the last report to a collector ({})", date_words(last_report_end, w)) } else { "so far, with no report yet to a collector".to_string() }
        );
        let mut item = OpenItem::new("withheld-since-last-report", line).running().amount(Some(withheld_since));
        if last_report_end >= 0 {
            item = item.since(last_report_end);
        }
        tax.push(item);
    }
    // ---- the returns of tax withheld that fall due, by the law's calendar ----
    let mut falling = vec![];
    if let Some(law) = income_tax_law(book) {
        let order_every = |order: &str| -> i64 {
            match book.get(order).filter(|r| is_statement(r)).and_then(|r| num(d(r).get("every"))) {
                Some(e) if e > 0 => e,
                _ => p.period,
            }
        };
        for rule in law.returns_list() {
            // A return is made when a report of ours says so: the code's names the return and the day it was due; one made
            // on the office's form (`withholding_return`) names neither, only the day the period ended, and covers every
            // period that ended on or before it. A return made stands no longer among those falling due, whatever day it
            // was due by.
            let first = due_on(w, &rule, t.div_euclid(DAY) * DAY - 1);
            let covers = |r: &Record, n: &ReturnDue| -> bool {
                let x = d(r);
                match x.get("return") {
                    Some(ret) if ret.as_str() != Some(rule.id.as_str()) => false,
                    Some(_) if x.get("due").is_some() => num(x.get("due")) == Some(n.due),
                    _ => num(x.get("period_end")).is_some_and(|e| e >= n.to - DAY),
                }
            };
            let mut next = first.clone();
            while reports.iter().any(|r| covers(r, &next)) {
                next = due_on(w, &rule, next.due);
            }
            let filed = reports
                .iter()
                .filter(|r| match d(r).get("return") {
                    Some(ret) => ret.as_str() == Some(rule.id.as_str()),
                    None => num(d(r).get("period_end")).is_some_and(|e| e >= first.to - DAY),
                })
                .fold(-1, |m, r| m.max(period_end(r)));
            // (What each pay withheld under this return's charges, as the law reckons it from the gross: the pay as paid,
            // and what was held.)
            let held_between = |after: i64, before: i64| -> i64 {
                let mut sum = 0;
                for x in &paid.by_order {
                    if x.t <= after || x.t >= before {
                        continue;
                    }
                    let hold = held.get(&x.order).copied().unwrap_or(0);
                    let parts = withheld(Some(&law), x.amount + hold, order_every(&x.order)).parts;
                    let all: i64 = parts.iter().map(|(_, a)| a).sum();
                    let mine: i64 = parts.iter().filter(|(c, _)| rule.charges.as_ref().is_none_or(|cs| cs.contains(&c.id))).map(|(_, a)| a).sum();
                    sum += if all > 0 { round_div(i128::from(hold) * i128::from(mine), i128::from(all)) } else { 0 };
                }
                sum
            };
            let sum = held_between(filed, i64::MAX);
            // A return whose day has passed and that no report of ours covers is still owed: it stays on the books, said to
            // be overdue.
            let mut o = due_on(w, &rule, -1);
            while o.due < first.due {
                if !reports.iter().any(|r| covers(r, &o)) {
                    let owed_then = held_between(o.from - 1, o.to);
                    if owed_then > 0 {
                        let line = format!(
                            "{}, under {}: was due on {} for pay from {} to {}, and no report has been made for it; {} was withheld from that pay",
                            rule.name.as_deref().unwrap_or("Return of tax withheld from wages"),
                            law.id,
                            date_words(o.due, w),
                            date_words(o.from, w),
                            date_words(o.to - 1, w),
                            usd(owed_then, w)
                        );
                        falling.push(OpenItem::new(format!("{}-{}", rule.id, o.due), line).due(Some(o.due)).amount(Some(owed_then)));
                    }
                }
                o = due_on(w, &rule, o.due);
            }
            let ids: Vec<&String> = match &rule.charges {
                Some(cs) => cs.iter().collect(),
                None => law.charges.iter().map(|c| &c.id).collect(),
            };
            let names = ids.iter().map(|id| law.charges.iter().find(|c| &c.id == *id).and_then(|c| c.name.clone()).unwrap_or_else(|| (*id).clone())).collect::<Vec<_>>().join(", ");
            let days = (next.due - t.div_euclid(DAY) * DAY + DAY / 2).div_euclid(DAY);
            let line = format!(
                "{} ({names}), under {}: the next falls due on {} ({}), for pay from {} to {}; the last was {}; {} of this has been withheld from wages paid since",
                rule.name.as_deref().unwrap_or("Return of tax withheld from wages"),
                law.id,
                date_words(next.due, w),
                match days {
                    0 => "today".to_string(),
                    1 => "tomorrow".to_string(),
                    n => format!("in {n} days"),
                },
                date_words(next.from, w),
                date_words(next.to - 1, w),
                if filed >= 0 { format!("made on {}", date_words(filed, w)) } else { "none yet".to_string() },
                usd(sum, w)
            );
            falling.push(OpenItem::new(format!("{}-{}", rule.id, next.due), line).running().due(Some(next.due)).amount(Some(sum)));
        }
    }
    [
        heading("Invoices addressed to the town, not paid", invoices),
        heading("Employees of the town with no standing payment of their wage on file", unpaid),
        heading("Wages still being paid to someone who has died or whose employment has ended", stale),
        heading("The budget for the year, against what has been paid", budget),
        heading("Tax withheld from wages and not yet paid over", tax),
        by_day("Returns of tax withheld from wages falling due, and the day each is due by", falling),
    ]
    .concat()
}

// ---------------------------------------------------------------- the mayor's office

/// city.mayor_code: petitions (their published counts against the town's threshold), invoices for work the office
/// commissioned and has not approved, permits granted on its applications and no builder commissioned, the budget
/// (tabled and not decided; years with none adopted), complaints about the town's services, and debts claimed against
/// the town.
fn mayor(rd: &Reader, threshold_bps: i64, population: i64, budget_lead_days: i64, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
    let (book, paid, acted, me) = (&rd.st.book, &rd.st.paid, &rd.st.acted, rd.me.as_str());
    let ours = |r: &Record| rd.ours(r);
    let needed = -((-(threshold_bps * population)).div_euclid(10_000));
    let reached = |n: i64| n * 10_000 >= threshold_bps * population;
    // ---- petitions ----
    let petitions: Vec<&R> = book.open("petition").collect();
    let mut counts: BTreeMap<&str, i64> = BTreeMap::new(); // petition -> the organiser's latest published count
    for c in book.open("petition_count") {
        let id = js(d(c).get("petition"));
        let Some(pet) = petitions.iter().rev().find(|p| p.id == id) else { continue };
        let sig = d(c).get("signatures").filter(|v| v.is_number());
        if c.speaks_for == pet.speaks_for {
            if let Some(n) = sig.and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))) {
                counts.insert(pet.id.as_str(), n);
            }
        }
    }
    let threshold = format!("the town's threshold of {needed} signature{}", plural(needed, "", "s"));
    let (mut over, mut below) = (vec![], vec![]);
    for pet in &petitions {
        if acted.contains(&pet.id) {
            continue;
        }
        let n = counts.get(pet.id.as_str()).copied().unwrap_or(0);
        let what: String = match d(pet).get("demand").and_then(|x| x.get("text")).filter(|v| !v.is_null()) {
            Some(v) => js(Some(v)),
            None => text(pet).to_string(),
        }
        .chars()
        .take(120)
        .collect();
        let base = format!(
            "{}: {}'s petition of {} ({what}) has {n} signature{} by its organiser's latest count",
            pet.id,
            pet.speaks_for.clone().unwrap_or_else(|| pet.author.clone()),
            date_words(pet.at, w),
            plural(n, "", "s")
        );
        if reached(n) {
            over.push(OpenItem::new(pet.id.clone(), format!("{base}, at or over {threshold}; it has not been put to the council or answered")).since(pet.at));
        } else if addressed(pet, me) {
            below.push(OpenItem::new(pet.id.clone(), format!("{base}, short of {threshold}")).since(pet.at));
        }
    }
    // ---- invoices for work the office commissioned, awaiting its approval ----
    let approvals: BTreeSet<String> = book.open("approval").filter(|a| ours(a)).map(|a| js(d(a).get("invoice"))).collect();
    let mut invoices = vec![];
    for inv in book.open("invoice") {
        if !addressed(inv, me) || approvals.contains(&inv.id) || paid.settled.contains(&inv.id) {
            continue;
        }
        let Some(ag) = bases_of(inv).iter().filter_map(|b| book.get(b)).find(|x| terms_of(x).is_some() && ours(x)) else { continue };
        let amount = amt(d(inv).get("outcome").and_then(|o| o.get("money")).and_then(|m| m.get("amount")));
        let line = format!(
            "{}: invoice from {} for {}, dated {}, for work commissioned under {}; no written approval of ours is on file",
            inv.id,
            inv.speaks_for.clone().unwrap_or_else(|| inv.author.clone()),
            usd(amount, w),
            date_words(inv.at, w),
            ag.id
        );
        invoices.push(OpenItem::new(inv.id.clone(), line).since(inv.at).amount(Some(amount)));
    }
    // ---- permits granted on the office's applications, no builder commissioned ----
    let mut permits = vec![];
    for dec in book.open("permit_decision") {
        if acted.contains(&dec.id) || !addressed(dec, me) || d(dec).s("decision") != Some("granted") {
            continue;
        }
        let Some(app) = book.get(&js(d(dec).get("application"))).filter(|a| is_statement(a) && ours(a)) else { continue };
        let line = format!(
            "{}: the permit to build {} on {} (our application {}) was granted {}; no builder has been commissioned",
            dec.id,
            js(d(app).get("structure_type")),
            js(d(app).get("lot")),
            app.id,
            date_words(dec.at, w)
        );
        permits.push(OpenItem::new(dec.id.clone(), line).since(dec.at));
    }
    // ---- the budget ----
    let year = t.div_euclid(YEAR) + 1;
    let decided: BTreeSet<String> = book.open("ballot_result").map(|r| js(d(r).get("ballot"))).collect();
    let mut ballot_of: BTreeMap<&str, &R> = BTreeMap::new();
    for b in book.open("ballot") {
        if let Some(p) = d(b).s("proposal") {
            ballot_of.insert(p, b);
        }
    }
    let mut tabled = vec![];
    for r in book.open("proposal") {
        let enact = d(r).get("enact");
        if !ours(r) || enact.and_then(|e| e.get("kind")).and_then(Value::as_str) != Some("budget") {
            continue;
        }
        let b = ballot_of.get(r.id.as_str());
        if b.is_some_and(|b| decided.contains(&b.id)) {
            continue;
        }
        let y = js(enact.and_then(|e| e.get("data")).and_then(|x| x.get("year")));
        let state = match b {
            Some(b) => {
                if d(b).get("closed") == Some(&Value::Bool(true)) || closed_by(t, d(b).get("closes_at")) {
                    format!("its ballot {} has closed and no result is on file", b.id)
                } else {
                    format!("its ballot {} is open until {}", b.id, date_of(d(b).get("closes_at"), w))
                }
            }
            None => "no ballot has been opened".to_string(),
        };
        tabled.push(OpenItem::new(r.id.clone(), format!("{}: the budget for year {y} tabled {}; {state}", r.id, date_words(r.at, w))).since(r.at));
    }
    let mut missing = vec![];
    if budget_for(book, year).is_none() {
        missing.push(OpenItem::new(format!("budget-year-{year}"), format!("no budget is adopted for year {year} ({})", year_in_days(year))).since((year - 1) * YEAR));
    } else if budget_lead_days > 0 && year * YEAR - t <= budget_lead_days * DAY && budget_for(book, year + 1).is_none() {
        missing.push(
            OpenItem::new(
                format!("budget-year-{}", year + 1),
                format!("no budget is adopted yet for year {} ({}), which begins {}", year + 1, year_in_days(year + 1), date_words(year * YEAR, w)),
            )
            .since(year * YEAR),
        );
    }
    // ---- complaints about the town's services, open: a count by kind, and the oldest few ----
    let mut kinds: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    let mut open: Vec<&R> = vec![];
    for c in book.open("complaint") {
        if !addressed(c, me) || acted.contains(&c.id) {
            continue;
        }
        open.push(c);
        let k = or_words(d(c).get("about"), "the town's services");
        let e = kinds.entry(k).or_insert((0, i64::MAX));
        e.0 += 1;
        e.1 = e.1.min(c.at);
    }
    let by_kind: Vec<OpenItem> = kinds
        .iter()
        .map(|(k, (n, oldest))| {
            OpenItem::new(format!("kind:{k}"), format!("{n} open complaint{} about {}, the oldest of {}", plural(*n, "", "s"), k.replace('_', " "), date_words(*oldest, w))).since(*oldest)
        })
        .collect();
    open.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
    let oldest: Vec<OpenItem> = open
        .iter()
        .take(3)
        .map(|c| {
            let x = d(c);
            let line = format!(
                "{}: {} complained {} about {}{}{}",
                c.id,
                c.speaks_for.clone().unwrap_or_else(|| c.author.clone()),
                date_words(c.at, w),
                or_words(x.get("about"), "the town's services").replace('_', " "),
                if x.get("structure").is_some_and(truthy) { format!(" at {}", js(x.get("structure"))) } else { String::new() },
                if x.get("days").is_some() { format!(", saying it had gone about {} days", js(x.get("days"))) } else { String::new() }
            );
            OpenItem::new(c.id.clone(), line).since(c.at)
        })
        .collect();
    // ---- debts claimed against the town ----
    let mut debts = vec![];
    for r in book.of_type("claim") {
        let RecordBody::Claim { position, holder, counterparty, about } = &r.body else { continue };
        if *position != oikos_contracts::blocks::Position::Right || counterparty.as_deref() != Some(me) || paid.settled.contains(&r.id) || book.released(&r.id) {
            continue;
        }
        let amount = about.get("amount").map(|a| amt(Some(a)));
        let line = format!(
            "{}: {} claims {} from the town ({}{}), recorded {}, not settled",
            r.id,
            holder,
            amount.map_or("a debt".to_string(), |a| usd(a, w)),
            or_words(about.get("kind"), "a debt").replace('_', " "),
            if about.get("for").is_some_and(truthy) { format!(": {}", js(about.get("for"))) } else { String::new() },
            date_words(r.at, w)
        );
        debts.push(OpenItem::new(r.id.clone(), line).since(r.at).amount(amount));
    }
    [
        heading("Petitions at or over the town's threshold, not put to the council or answered", over),
        heading("Petitions addressed to the mayor, short of the town's threshold", below),
        heading("Invoices for work the mayor's office commissioned, awaiting its written approval", invoices),
        heading("Permits granted on the office's applications, no builder commissioned", permits),
        heading("Budgets put to the council with no result yet", tabled),
        heading("Years with no budget adopted", missing),
        heading("Complaints about the town's services, still open, by kind", by_kind),
        heading("The oldest of the open complaints", oldest),
        heading("Debts claimed against the town, not settled", debts),
    ]
    .concat()
}

// ---------------------------------------------------------------- the works and environment offices

fn form_words(form: &str) -> &str {
    match form {
        "works_staffing" => "the works office's staffing form",
        "works_collection" => "the works office's collection form",
        "environment_staffing" => "the environment office's staffing form",
        other => other,
    }
}

/// An office that employs staff and leaves their pay to the finance office (city.works, city.environment), as its
/// office-holder keeps it: applications for its advertised posts not answered; starters and leavers the finance office
/// has not been told of; and the directions on its forms that stand. (The round, the upkeep, the complaints and the
/// survey are its staff's: nothing on file says where they stand.)
#[allow(clippy::too_many_arguments)]
fn employer(st: &State, me: &str, payroll_office: &str, staffing: &Staffing, directions: &Directions, forms: &[&str], t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
    let book = &st.book;
    // ---- applications for an advertised post, not answered ----
    let posts = staffing.postings(book);
    let contracts = staffing.contracts(book);
    let offered_on: BTreeSet<&str> = contracts.iter().flat_map(|a| bases_of(a).iter().map(String::as_str)).collect();
    let mut applications = vec![];
    if !posts.is_empty() {
        for a in book.open("job_application") {
            let wanted = js(d(a).get("posting"));
            let Some(post) = posts.iter().rev().find(|p| p.id == wanted) else { continue };
            if !addressed(a, me) || offered_on.contains(a.id.as_str()) {
                continue;
            }
            let line = format!(
                "{}: {} applied {} for the post advertised in {}{}; no offer has been made{}",
                a.id,
                a.speaks_for.clone().unwrap_or_else(|| a.author.clone()),
                date_words(a.at, w),
                post.id,
                if d(post).get("role").is_some_and(truthy) { format!(" ({})", js(d(post).get("role"))) } else { String::new() },
                if book.on_hold(&post.id, Some(&[me.to_string()])) { "; the advertisement is on hold" } else { "" }
            );
            applications.push(OpenItem::new(a.id.clone(), line).since(a.at));
        }
    }
    // ---- starters and leavers the finance office has not been told of ----
    let (mut starters, mut leavers) = (vec![], vec![]);
    if !payroll_office.is_empty() {
        let notices: Vec<&R> = book.open("payroll_notice").filter(|n| n.speaks_for.as_deref() == Some(me)).collect();
        let sent = |what: &str| -> BTreeSet<String> { notices.iter().filter(|n| d(n).s("notice") == Some(what)).map(|n| js(d(n).get("agreement"))).collect() };
        let (starter_sent, leaver_sent) = (sent("starter"), sent("leaver"));
        for a in staffing.staff(book, t) {
            let signed = book.signed_at(&a.id);
            // (Those the organisation started with were on its payroll before the year began.)
            let Some(signed) = signed.filter(|_| a.author != "genesis" && !starter_sent.contains(&a.id) && staffing.payee(book, a).is_some_and(|p| !p.is_empty())) else { continue };
            let worker = terms_of(a).and_then(|x| x.parties.get(1)).map(String::as_str);
            let pays = job_terms(a, worker.unwrap_or(""), None);
            let line = format!(
                "{}: {} signed {} for {} every {}; the {payroll_office} office has had no payroll notice of the new starter from us",
                a.id,
                super::openbooks::jss(worker),
                date_words(signed, w),
                usd(pays.wage, w),
                duration_words(pays.period)
            );
            starters.push(OpenItem::new(a.id.clone(), line).since(signed).amount(Some(pays.wage)));
        }
        let deaths = dead(book);
        for a in &contracts {
            if !book.concluded(&a.id) || leaver_sent.contains(&a.id) {
                continue;
            }
            let worker = super::openbooks::jss(terms_of(a).and_then(|x| x.parties.get(1)).map(String::as_str));
            let died = deaths.contains_key(&worker) && book.in_force(&a.id);
            let Some(end) = (if died { deaths.get(&worker).copied() } else { book.ends_at(&a.id) }) else { continue };
            let line = format!(
                "{}: {worker}, who worked for us, {}; the {payroll_office} office has had no payroll notice of the leaver from us",
                a.id,
                if died { format!("died (registered {})", date_words(end, w)) } else { format!("leaves on {}", date_words(end, w)) }
            );
            leavers.push(OpenItem::new(a.id.clone(), line).since(end));
        }
    }
    // ---- directions that stand ----
    let mut directed = vec![];
    for form in forms {
        let Some(dir) = directions.stands(book, form) else { continue };
        let says = if form.ends_with("_staffing") {
            let s = staffing_under(Some(dir));
            if !s.recruit {
                "to recruit nobody, to take down its advertisements and to offer nobody employment".to_string()
            } else if let Some(n) = s.posts {
                format!("to recruit up to {n} post{}, or fewer where the budget pays for fewer", plural(n, "", "s"))
            } else {
                "to recruit up to what its budget pays for".to_string()
            }
        } else {
            match d(dir).get("every").and_then(safe_integer) {
                Some(every) => format!("to collect from each address every {}", duration_words(every)),
                None => "as it is written".to_string(),
            }
        };
        let line = format!(
            "{}: {} directed the office on {}, {}: {says}; it stands until replaced or withdrawn",
            dir.id,
            dir.position.clone().unwrap_or_else(|| dir.author.clone()),
            form_words(form),
            date_words(dir.at, w)
        );
        directed.push(OpenItem::new(dir.id.clone(), line).since(dir.at));
    }
    [
        heading("Applications for an advertised post, not answered", applications),
        heading("New starters the finance office has not been told of", starters),
        heading("Staff who have left or died, the finance office not told", leavers),
        heading("Directions on the office's forms that stand", directed),
    ]
    .concat()
}

/// `Number.isSafeInteger(x)`.
fn safe_integer(v: &Value) -> Option<i64> {
    let n = v.as_i64().or_else(|| v.as_f64().filter(|f| f.fract() == 0.0 && f.is_finite()).map(|f| f as i64))?;
    (n.abs() <= (1 << 53) - 1).then_some(n)
}

// ---------------------------------------------------------------- the planning office

/// city.planning_officer: permit applications addressed to the town with no decision of ours yet.
fn planning(book: &Book, me: &str, w: &WorldInfo) -> Vec<OpenHeading> {
    let mut decided: BTreeSet<&str> = BTreeSet::new();
    for dec in book.all("permit_decision") {
        if dec.speaks_for.as_deref() != Some(me) {
            continue;
        }
        if let Some(a) = d(dec).s("application") {
            decided.insert(a);
        }
        decided.extend(bases_of(dec).iter().map(String::as_str));
    }
    let items: Vec<OpenItem> = book
        .open("permit_application")
        .filter(|a| addressed(a, me) && !decided.contains(a.id.as_str()))
        .map(|a| {
            let line = format!(
                "{}: {} applied {} for a permit to build {} on {}; no decision has been made",
                a.id,
                a.speaks_for.clone().unwrap_or_else(|| a.author.clone()),
                when(made_at(a), w),
                or_words(d(a).get("structure_type"), "(the kind of building is not said)"),
                or_words(d(a).get("lot"), "(no lot is named)")
            );
            OpenItem::new(a.id.clone(), line).since(made_at(a))
        })
        .collect();
    heading("Permit applications, not decided", items)
}

// ---------------------------------------------------------------- the council clerk

/// city.council_clerk, the office-holder's side: proposals with no ballot opened, and ballots closed with no result
/// declared.
fn clerk(book: &Book, me: &str, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
    let ballots: Vec<&R> = book.open("ballot").filter(|b| b.speaks_for.as_deref() == Some(me)).collect();
    let balloted: BTreeSet<String> = ballots.iter().map(|b| js(d(b).get("proposal"))).collect();
    let results: BTreeSet<String> = book.open("ballot_result").filter(|r| r.speaks_for.as_deref() == Some(me)).map(|r| js(d(r).get("ballot"))).collect();
    let proposals: Vec<OpenItem> = book
        .open("proposal")
        .filter(|r| addressed(r, me) && !balloted.contains(&r.id))
        .map(|r| {
            let said: String = text(r).chars().take(120).collect();
            let line = format!(
                "{}: {} put a proposal to the council on {} ({said}); no ballot has been opened",
                r.id,
                r.speaks_for.clone().unwrap_or_else(|| r.author.clone()),
                date_words(r.at, w)
            );
            OpenItem::new(r.id.clone(), line).since(r.at)
        })
        .collect();
    let closed: Vec<OpenItem> = ballots
        .iter()
        .filter(|b| d(b).s("electorate") == Some("council") && (d(b).get("closed") == Some(&Value::Bool(true)) || closed_by(t, d(b).get("closes_at"))) && !results.contains(&b.id))
        .map(|b| {
            let closes = finite_number(d(b).get("closes_at"));
            let line = format!(
                "{}: the ballot on {} {}; no result has been declared",
                b.id,
                js(d(b).get("proposal")),
                match closes {
                    Some(c) => format!("closed {}", date_words(c, w)),
                    None => "has closed".to_string(),
                }
            );
            OpenItem::new(b.id.clone(), line).since(closes.unwrap_or(b.at))
        })
        .collect();
    [heading("Proposals to the council with no ballot opened", proposals), pressing("Ballots closed with no result declared", closed)].concat()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::firms::testkit::{employment, picture, rec, signatures};
    use std::sync::Arc;

    const WAGE: i64 = 300_000;
    const PERIOD: i64 = 14 * DAY;
    const HALF: i64 = DAY / 2;

    fn world() -> WorldInfo {
        let currency = oikos_sight::calls::Currency { code: "XTS".into(), symbol: Some("$".into()), minor_units: 2, ..Default::default() };
        WorldInfo { currency: Some(currency), ..Default::default() }
    }

    /// A statement as the TS tests make one: speaks for the city, public, its words its id; `x` overrides.
    fn statement(id: &str, at: i64, kind: &str, x: Value) -> R {
        let mut v = json!({ "id": id, "at": at, "record": "statement", "author": "genesis", "speaks_for": "city", "visible_to": "public", "kind": kind, "text": id });
        for (k, val) in x.as_object().unwrap() {
            v[k] = val.clone();
        }
        rec(v)
    }

    fn withdrawal(id: &str, at: i64, what: &str) -> R {
        rec(json!({ "id": id, "at": at, "record": "withdrawal", "author": "x", "withdraws": what, "visible_to": "public" }))
    }

    fn job(id: &str, at: i64, worker: &str) -> R {
        employment(id, at, "city", worker, WAGE, PERIOD, "works-system", None)
    }

    fn signed(a: &R, at: i64) -> Vec<R> {
        let mut v = vec![a.clone()];
        v.extend(signatures(a, at));
        v
    }

    fn standing_order(id: &str, at: i64, who: &str, to: &str, amount: i64, basis: &str, every: i64) -> R {
        rec(json!({ "id": id, "at": at, "record": "statement", "kind": "request", "author": format!("{who}-self"), "speaks_for": who, "addressed_to": ["bank"], "visible_to": [who, "bank"],
            "text": "Payment request.", "basis": basis, "data": { "outcome": { "money": { "from": format!("acc-{who}"), "to": to, "amount": amount.to_string() } }, "every": every } }))
    }

    fn invoice(id: &str, at: i64, amount: i64) -> R {
        statement(id, at, "invoice", json!({ "speaks_for": "builder", "author": "builder-system", "addressed_to": ["city"], "visible_to": ["city", "builder"], "data": { "outcome": { "money": { "to": "acc-builder", "amount": amount.to_string() } } } }))
    }

    fn tx(t: i64, from: &str, to: &str, amount: i64, x: Value) -> oikos_sight::Transaction {
        let mut v = json!({ "t": t, "from": from, "to": to, "amount": amount.to_string(), "currency": "XTS", "by": "fin" });
        for (k, val) in x.as_object().unwrap() {
            v[k] = val.clone();
        }
        serde_json::from_value(v).unwrap()
    }

    fn feed(b: &mut Box<dyn OfficeBooks>, entity: &str, t: i64, records: Vec<R>, txs: Vec<oikos_sight::Transaction>) {
        feed_read(b, entity, t, records, txs, &[]);
    }

    fn feed_read(b: &mut Box<dyn OfficeBooks>, entity: &str, t: i64, records: Vec<R>, txs: Vec<oikos_sight::Transaction>, readings: &[(&str, &'static str, Option<i64>)]) {
        let acc = format!("acc-{entity}");
        let mut pic = picture(t, entity, records, &[(acc.as_str(), entity, 900_000_000)], txs);
        for (id, status, ends_at) in readings {
            pic.readings.insert((*id).to_string(), oikos_sight::Reading { of: "agreement", status, ends_at: *ends_at, ended_by: None, reader: "k" });
        }
        b.absorb(&pic);
    }

    fn make(of: &str, me: &str, office: &str, params: Value) -> Box<dyn OfficeBooks> {
        reader(of, me, office, params.as_object().unwrap()).expect("a reader")
    }

    fn find(hs: &[OpenHeading], what: &str) -> Vec<OpenItem> {
        hs.iter().find(|h| h.what == what).map(|h| h.items.clone()).unwrap_or_default()
    }

    fn ids(items: &[OpenItem]) -> Vec<&str> {
        items.iter().map(|i| i.id.as_str()).collect()
    }

    fn lines(hs: &[OpenHeading]) -> String {
        serde_json::to_string(&hs.iter().map(|h| (&h.what, h.items.iter().map(|i| (&i.id, &i.line)).collect::<Vec<_>>())).collect::<Vec<_>>()).unwrap()
    }

    fn open(b: &dyn OfficeBooks, t: i64) -> Vec<OpenHeading> {
        b.open(t, &world())
    }

    fn open_old(b: &dyn OfficeBooks, t: i64) -> Vec<OpenHeading> {
        b.open(t, &WorldInfo::default())
    }

    const INVOICES: &str = "Invoices addressed to the town, not paid";
    const UNPAID: &str = "Employees of the town with no standing payment of their wage on file";
    const STALE: &str = "Wages still being paid to someone who has died or whose employment has ended";
    const BUDGET: &str = "The budget for the year, against what has been paid";
    const TAX: &str = "Tax withheld from wages and not yet paid over";
    const RETURNS: &str = "Returns of tax withheld from wages falling due, and the day each is due by";

    fn finance(params: Value) -> Box<dyn OfficeBooks> {
        make("city.finance_officer", "city", "finance", params)
    }

    #[test]
    fn finance_an_invoice_is_open_until_a_payment_of_ours_settles_it_and_says_when_it_needs_the_mayors_approval() {
        let mut b = finance(json!({ "procedure": "proc-payments" }));
        feed(
            &mut b,
            "city",
            5 * DAY,
            vec![statement("proc-payments", 0, "procedure", json!({ "data": { "approval": { "by": "mayor", "over": 5_000_000 } } })), invoice("inv-1", 4 * DAY, 800_000), invoice("inv-2", 4 * DAY, 9_000_000)],
            vec![],
        );
        let o = find(&open(&*b, 6 * DAY), INVOICES);
        assert_eq!(ids(&o), ["inv-1", "inv-2"]);
        assert_eq!((o[0].since, o[0].amount), (Some(4 * DAY), Some(800_000)));
        assert!(o[1].line.contains("the mayor's written approval is not on file"));
        assert!(!o[0].line.contains("approval"));
        // The mayor approves inv-2 (made in the mayor's post); inv-1 is paid.
        feed(
            &mut b,
            "city",
            7 * DAY,
            vec![statement("ap-1", 6 * DAY, "approval", json!({ "in_position": "mayor", "data": { "invoice": "inv-2" } }))],
            vec![tx(6 * DAY, "acc-city", "acc-builder", 800_000, json!({ "settles": "inv-1" }))],
        );
        let after = find(&open(&*b, 8 * DAY), INVOICES);
        assert_eq!(ids(&after), ["inv-2"]);
        assert!(after[0].line.contains("the mayor's written approval is on file"));
    }

    #[test]
    fn finance_an_employment_agreement_in_force_with_no_standing_payment_is_listed_and_gone_once_one_citing_it_is_on_file() {
        let mut b = finance(json!({}));
        let a = job("job-1", 2 * DAY, "c1");
        feed(&mut b, "city", 10 * DAY, signed(&a, 3 * DAY), vec![]);
        let o = find(&open(&*b, 10 * DAY), UNPAID);
        assert_eq!(o.len(), 1);
        assert_eq!((o[0].id.as_str(), o[0].since, o[0].amount), ("job-1", Some(3 * DAY), Some(WAGE)));
        assert!(o[0].line.contains("c1"));
        assert!(o[0].line.contains("no payroll notice has come"));
        // (Within the days the office waits for a notice it is not yet short.)
        let mut young = finance(json!({}));
        feed(&mut young, "city", 4 * DAY, signed(&job("job-2", 3 * DAY, "c2"), 3 * DAY), vec![]);
        assert!(find(&open(&*young, 4 * DAY), UNPAID).is_empty());
        feed(&mut b, "city", 11 * DAY, vec![standing_order("ord-1", 10 * DAY + HALF, "city", "acc-c1", 270_000, "job-1", PERIOD)], vec![]);
        assert!(find(&open(&*b, 11 * DAY), UNPAID).is_empty());
    }

    #[test]
    fn finance_wages_still_paid_to_someone_registered_dead_are_listed_until_the_order_is_withdrawn() {
        let mut b = finance(json!({}));
        let a = job("job-1", 2 * DAY, "c1");
        let mut rs = signed(&a, 3 * DAY);
        rs.push(standing_order("ord-1", 4 * DAY, "city", "acc-c1", 270_000, "job-1", PERIOD));
        feed(&mut b, "city", 10 * DAY, rs, vec![]);
        assert!(!open(&*b, 10 * DAY).iter().any(|h| h.what.starts_with("Wages still")));
        feed(&mut b, "city", 20 * DAY, vec![statement("dr-1", 19 * DAY, "death_registration", json!({ "data": { "deceased": "c1" } }))], vec![]);
        let stale = find(&open(&*b, 20 * DAY), STALE);
        assert_eq!(stale.len(), 1);
        assert_eq!((stale[0].id.as_str(), stale[0].since, stale[0].amount), ("ord-1", Some(19 * DAY), Some(270_000)));
        // The order is withdrawn: nothing stale.
        feed(&mut b, "city", 21 * DAY, vec![withdrawal("w-1", 20 * DAY + HALF, "ord-1")], vec![]);
        assert!(find(&open(&*b, 21 * DAY), STALE).is_empty());
    }

    #[test]
    fn finance_the_budget_in_total_against_invoices_and_wages_and_the_line_is_the_same_on_two_days() {
        let mut b = finance(json!({}));
        let a = job("job-1", 2 * DAY, "c1");
        let budget = statement("bud-1", DAY, "budget", json!({ "data": { "year": 1, "lines": { "parks": 8_000_000, "staff": 2_000_000 } } }));
        let mut rs = vec![budget, invoice("inv-1", 4 * DAY, 800_000)];
        rs.extend(signed(&a, 3 * DAY));
        rs.push(standing_order("ord-1", 4 * DAY, "city", "acc-c1", 270_000, "job-1", PERIOD));
        feed(
            &mut b,
            "city",
            40 * DAY,
            rs,
            vec![
                tx(30 * DAY, "acc-city", "acc-builder", 800_000, json!({ "settles": "inv-1", "memo": "Paying an invoice" })),
                tx(31 * DAY, "acc-city", "acc-c1", 270_000, json!({ "per_instruction": "ord-1", "memo": "wages" })),
            ],
        );
        let item = find(&open(&*b, 40 * DAY), BUDGET).remove(0);
        assert_eq!(item.id, "bud-1");
        // 10,000,000 adopted; 800,000 on invoices + 270,000 net + 30,000 withheld = 1,100,000 paid; 8,900,000 left.
        assert_eq!(item.amount, Some(8_900_000));
        assert!(item.line.contains("$8,000.00"));
        assert!(item.line.contains("By line: parks $0.00 drawn of $80,000.00, $80,000.00 left; staff $0.00 drawn of $20,000.00, $20,000.00 left; $11,000.00 unallocated (payments that name no line). By what the payments said they were for: \"Paying an invoice\" $8,000.00; \"wages\" $2,700.00"));
        assert_eq!(lines(&open(&*b, 40 * DAY)), lines(&open(&*b, 41 * DAY)));
    }

    #[test]
    fn finance_room_left_by_line_a_payment_with_no_line_is_unallocated_a_line_the_budget_lacks_is_said() {
        let mut b = finance(json!({}));
        let a = job("job-1", 2 * DAY, "c1");
        let budget = statement("bud-1", DAY, "budget", json!({ "data": { "year": 1, "lines": { "parks": 8_000_000, "staff": 2_000_000 } } }));
        let t = |at: i64, amount: i64, x: Value| tx(at, "acc-city", "acc-x", amount, x);
        let mut rs = vec![budget.clone(), invoice("inv-1", 4 * DAY, 800_000), invoice("inv-2", 4 * DAY, 300_000), invoice("inv-3", 4 * DAY, 100_000)];
        rs.extend(signed(&a, 3 * DAY));
        rs.push(standing_order("ord-1", 4 * DAY, "city", "acc-c1", 270_000, "job-1", PERIOD));
        feed(
            &mut b,
            "city",
            40 * DAY,
            rs,
            vec![
                t(30 * DAY, 800_000, json!({ "settles": "inv-1", "line": "parks" })),
                t(30 * DAY, 300_000, json!({ "settles": "inv-2" })),
                t(30 * DAY, 100_000, json!({ "settles": "inv-3", "line": "fountains" })),
                t(31 * DAY, 270_000, json!({ "per_instruction": "ord-1", "line": "staff" })),
            ],
        );
        let item = find(&open(&*b, 40 * DAY), BUDGET).remove(0);
        // 10,000,000 adopted; 1,200,000 on invoices + 270,000 net + 30,000 withheld = 1,500,000 paid.
        assert_eq!(item.amount, Some(8_500_000));
        assert!(item.line.contains("By line: fountains (not a line of the budget) $1,000.00 drawn; parks $8,000.00 drawn of $80,000.00, $72,000.00 left; staff $3,000.00 drawn of $20,000.00, $17,000.00 left; $3,000.00 unallocated (payments that name no line)"));
        // (None unallocated once every payment names its line.)
        let mut c = finance(json!({}));
        feed(&mut c, "city", 40 * DAY, vec![budget, invoice("inv-1", 4 * DAY, 800_000)], vec![t(30 * DAY, 800_000, json!({ "settles": "inv-1", "line": "parks" }))]);
        assert!(find(&open(&*c, 40 * DAY), BUDGET)[0].line.contains("nothing unallocated"));
    }

    #[test]
    fn finance_tax_withheld_since_the_last_report_is_listed_and_a_shortfall_the_last_report_owed() {
        let mut b = finance(json!({}));
        let a = job("job-1", 2 * DAY, "c1");
        let mut rs = signed(&a, 3 * DAY);
        rs.push(standing_order("ord-1", 4 * DAY, "city", "acc-c1", 270_000, "job-1", PERIOD));
        rs.push(statement("wr-1", 30 * DAY, "withholding_report", json!({ "addressed_to": ["tax-office"], "data": { "withheld": 100_000, "paid": 40_000, "period_end": 30 * DAY } })));
        feed(&mut b, "city", 40 * DAY, rs, vec![tx(35 * DAY, "acc-city", "acc-c1", 270_000, json!({ "per_instruction": "ord-1" }))]);
        let tax = find(&open(&*b, 40 * DAY), TAX);
        let mut got = ids(&tax);
        got.sort();
        assert_eq!(got, ["withheld-since-last-report", "wr-1"]);
        let wr = tax.iter().find(|i| i.id == "wr-1").unwrap();
        assert_eq!((wr.amount, wr.since), (Some(60_000), Some(30 * DAY)));
        assert_eq!(tax.iter().find(|i| i.id == "withheld-since-last-report").unwrap().amount, Some(30_000));
    }

    fn two_returns_law() -> R {
        statement(
            "law-income-tax",
            0,
            "law",
            json!({ "speaks_for": "outside", "visible_to": "public", "data": { "tax": "income",
                "charges": [{ "id": "income-tax", "name": "Income tax", "schedule": [{ "from": 0, "rate_bps": 1000 }], "collector": "outside", "account": "acc-outside" },
                            { "id": "nssf", "name": "NSSF contribution", "schedule": [{ "from": 0, "rate_bps": 600 }], "collector": "nssf", "account": "acc-outside-nssf" }],
                "returns": [{ "id": "paye", "name": "PAYE return", "charges": ["income-tax"], "day": 9 }, { "id": "nssf", "name": "NSSF contribution", "charges": ["nssf"], "day": 12 }] } }),
        )
    }

    #[test]
    fn finance_the_returns_the_law_lists_which_falls_due_next_and_when_for_what_period_and_what_has_been_withheld() {
        let mut b = finance(json!({}));
        let a = job("job-1", 2 * DAY, "c1");
        let mut rs = vec![two_returns_law()];
        rs.extend(signed(&a, 3 * DAY));
        rs.push(standing_order("ord-1", 4 * DAY, "city", "acc-c1", 270_000, "job-1", PERIOD));
        rs.push(statement("wr-1", 38 * DAY, "withholding_report", json!({ "addressed_to": ["outside"], "speaks_for": "city", "data": { "withheld": 10_000, "paid": 10_000, "period_end": 38 * DAY, "return": "paye" } })));
        feed(
            &mut b,
            "city",
            40 * DAY,
            rs,
            vec![tx(35 * DAY, "acc-city", "acc-c1", 270_000, json!({ "per_instruction": "ord-1" })), tx(39 * DAY, "acc-city", "acc-c1", 270_000, json!({ "per_instruction": "ord-1" }))],
        );
        let due = find(&open_old(&*b, 40 * DAY), RETURNS);
        assert_eq!(ids(&due), [format!("nssf-{}", 41 * DAY), format!("paye-{}", 68 * DAY)].iter().map(String::as_str).collect::<Vec<_>>());
        let paye = due.iter().find(|i| i.id.starts_with("paye")).unwrap();
        assert!(paye.line.contains("PAYE return (Income tax), under law-income-tax: the next falls due on year 1, day 69 (in 28 days), for pay from year 1, day 31 to year 1, day 60; the last was made on year 1, day 39"), "{}", paye.line);
        assert!(paye.amount.unwrap() > 0); // (the pay of day 39 only, after the return of day 38)
        let nssf = due.iter().find(|i| i.id.starts_with("nssf")).unwrap();
        assert!(nssf.line.contains("the next falls due on year 1, day 42 (tomorrow), for pay from year 1, day 1 to year 1, day 30; the last was none yet"), "{}", nssf.line);
        // The day itself it is "today"; the day after, the next month's.
        let today = find(&open_old(&*b, 41 * DAY + 100), RETURNS);
        assert!(today.iter().find(|i| i.id.starts_with("nssf")).unwrap().line.contains("(today)"));
    }

    #[test]
    fn finance_a_return_made_on_the_offices_own_form_is_made_one_not_made_stays_once_its_day_has_passed() {
        let mut b = finance(json!({}));
        let a = job("job-1", 2 * DAY, "c1");
        let law = statement(
            "law-income-tax",
            0,
            "law",
            json!({ "speaks_for": "outside", "visible_to": "public", "data": { "tax": "income",
                "charges": [{ "id": "income-tax", "name": "Income tax", "schedule": [{ "from": 0, "rate_bps": 1000 }], "collector": "outside", "account": "acc-outside" }],
                "returns": [{ "id": "paye", "name": "PAYE return", "charges": ["income-tax"], "day": 9 }] } }),
        );
        // (A report on the form names no return and no due day: only the day the period ended, and the law.)
        let report = |id: &str, at: i64, end: i64| {
            statement(id, at, "withholding_report", json!({ "addressed_to": ["outside"], "speaks_for": "city", "data": { "withheld": 10_000, "paid": 10_000, "period_end": end } }))
        };
        let pay = |t: i64| tx(t, "acc-city", "acc-c1", 270_000, json!({ "per_instruction": "ord-1" }));
        let mut base = vec![law];
        base.extend(signed(&a, 3 * DAY));
        base.push(standing_order("ord-1", 4 * DAY, "city", "acc-c1", 270_000, "job-1", PERIOD));
        let falling = |x: &dyn OfficeBooks, t: i64| find(&open_old(x, t), RETURNS);
        // Day 38: the return for pay to the end of day 30 (due day 39) is not made: it is due tomorrow.
        feed(&mut b, "city", 37 * DAY, base.clone(), vec![pay(20 * DAY), pay(35 * DAY)]);
        assert_eq!(ids(&falling(&*b, 37 * DAY)), [format!("paye-{}", 38 * DAY)].iter().map(String::as_str).collect::<Vec<_>>());
        assert!(falling(&*b, 37 * DAY)[0].line.contains("falls due on year 1, day 39 (tomorrow), for pay from year 1, day 1 to year 1, day 30; the last was none yet"));
        // Made on day 38 (the period ended on day 30): the next to fall due is the next month's.
        feed(&mut b, "city", 37 * DAY + 100, vec![report("wr-1", 37 * DAY + 50, 29 * DAY)], vec![]);
        assert!(falling(&*b, 37 * DAY + 100)[0].line.contains("falls due on year 1, day 69 (in 31 days), for pay from year 1, day 31 to year 1, day 60"));
        // Not made at all by the day after its due day: it stays, as overdue, beside the next.
        let mut c = finance(json!({}));
        feed(&mut c, "city", 45 * DAY, base, vec![pay(20 * DAY), pay(35 * DAY)]);
        let heads: Vec<String> = falling(&*c, 45 * DAY).iter().map(|i| i.line.split(" (").next().unwrap().to_string()).collect();
        assert_eq!(heads.len(), 2);
        assert!(heads[0].contains("was due on year 1, day 39 for pay from year 1, day 1 to year 1, day 30, and no report has been made for it"), "{}", heads[0]);
        assert!(heads[1].contains("PAYE return"));
        // A late return that covers both periods closes both.
        feed(&mut c, "city", 80 * DAY, vec![report("wr-2", 79 * DAY, 78 * DAY)], vec![]);
        assert_eq!(ids(&falling(&*c, 80 * DAY)), [format!("paye-{}", 98 * DAY)].iter().map(String::as_str).collect::<Vec<_>>());
    }

    // ------------------------------------------------------------ mayor

    fn petition(id: &str, at: i64) -> R {
        statement(id, at, "petition", json!({ "speaks_for": "org", "author": "org-x", "addressed_to": ["city"], "data": { "demand": { "text": "Fix the rent rules" } } }))
    }

    fn count(id: &str, at: i64, pet: &str, n: i64) -> R {
        statement(id, at, "petition_count", json!({ "speaks_for": "org", "author": "org-x", "data": { "petition": pet, "signatures": n } }))
    }

    fn mayor() -> Box<dyn OfficeBooks> {
        make("city.mayor_code", "city", "mayor", json!({ "petition_threshold_bps": 1500, "population": 200 }))
    }

    #[test]
    fn mayor_a_petition_at_the_threshold_and_not_answered_is_open_put_to_the_council_it_is_gone_and_the_line_is_steady() {
        let mut b = mayor();
        feed(&mut b, "city", 10 * DAY, vec![petition("pet-1", 2 * DAY), count("c-1", 3 * DAY, "pet-1", 12), petition("pet-2", 2 * DAY), count("c-2", 3 * DAY, "pet-2", 31)], vec![]);
        const OVER: &str = "Petitions at or over the town's threshold, not put to the council or answered";
        let over = find(&open(&*b, 10 * DAY), OVER);
        assert_eq!(ids(&over), ["pet-2"]);
        assert_eq!(over[0].since, Some(2 * DAY));
        assert!(over[0].line.contains("the town's threshold of 30 signatures"));
        assert_eq!(ids(&find(&open(&*b, 10 * DAY), "Petitions addressed to the mayor, short of the town's threshold")), ["pet-1"]);
        assert_eq!(lines(&open(&*b, 10 * DAY)), lines(&open(&*b, 11 * DAY)));
        feed(&mut b, "city", 12 * DAY, vec![statement("prop-1", 11 * DAY, "proposal", json!({ "in_position": "mayor", "basis": "pet-2", "data": { "enact": { "kind": "law", "text": "x" } } }))], vec![]);
        assert!(find(&open(&*b, 12 * DAY), OVER).is_empty());
    }

    #[test]
    fn mayor_an_invoice_for_work_it_commissioned_awaits_approval_until_an_approval_of_ours_names_it() {
        let mut b = mayor();
        let ag = rec(json!({ "id": "ag-1", "at": DAY, "author": "mayor-p", "in_position": "mayor", "record": "agreement", "visible_to": ["city", "builder"],
            "terms": { "template": "construction", "parties": ["city", "builder"], "commitments": [] } }));
        let mut inv1 = serde_json::to_value(&*invoice("inv-1", 5 * DAY, 8_000_000)).unwrap();
        inv1["basis"] = json!("ag-1");
        feed(&mut b, "city", 6 * DAY, vec![ag, rec(inv1), invoice("inv-9", 5 * DAY, 100_000)], vec![]);
        const WHAT: &str = "Invoices for work the mayor's office commissioned, awaiting its written approval";
        let inv = find(&open(&*b, 6 * DAY), WHAT);
        assert_eq!(ids(&inv), ["inv-1"]);
        assert_eq!((inv[0].since, inv[0].amount), (Some(5 * DAY), Some(8_000_000)));
        assert_eq!(lines(&open(&*b, 6 * DAY)), lines(&open(&*b, 7 * DAY)));
        feed(&mut b, "city", 8 * DAY, vec![statement("ap-1", 7 * DAY, "approval", json!({ "in_position": "mayor", "basis": "inv-1", "data": { "invoice": "inv-1" } }))], vec![]);
        assert!(find(&open(&*b, 8 * DAY), WHAT).is_empty());
    }

    #[test]
    fn mayor_a_permit_granted_on_its_application_a_budget_tabled_and_no_budget_adopted() {
        let mut b = mayor();
        let app = statement("app-1", DAY, "permit_application", json!({ "in_position": "mayor", "data": { "lot": "lot.4", "structure_type": "park" } }));
        let dec = statement("dec-1", 3 * DAY, "permit_decision", json!({ "addressed_to": ["city"], "data": { "application": "app-1", "decision": "granted" } }));
        let prop = statement("prop-b", 2 * DAY, "proposal", json!({ "in_position": "mayor", "data": { "enact": { "kind": "budget", "data": { "year": 1 } } } }));
        feed(&mut b, "city", 5 * DAY, vec![app, dec, prop], vec![]);
        const PERMITS: &str = "Permits granted on the office's applications, no builder commissioned";
        const TABLED: &str = "Budgets put to the council with no result yet";
        const NONE: &str = "Years with no budget adopted";
        let out = open(&*b, 5 * DAY);
        assert_eq!(ids(&find(&out, PERMITS)), ["dec-1"]);
        assert_eq!(ids(&find(&out, TABLED)), ["prop-b"]);
        assert_eq!(ids(&find(&out, NONE)), ["budget-year-1"]);
        assert_eq!(lines(&open(&*b, 5 * DAY)), lines(&open(&*b, 6 * DAY)));
        // Commissioned; the ballot is declared and the budget adopted.
        feed(
            &mut b,
            "city",
            9 * DAY,
            vec![
                statement("com-1", 6 * DAY, "commission", json!({ "in_position": "mayor", "basis": "dec-1" })),
                statement("bal-1", 3 * DAY, "ballot", json!({ "data": { "proposal": "prop-b", "electorate": "council", "closes_at": 5 * DAY } })),
                statement("res-1", 6 * DAY, "ballot_result", json!({ "data": { "ballot": "bal-1", "passed": true } })),
                statement("bud-1", 6 * DAY, "budget", json!({ "data": { "year": 1, "lines": { "parks": 1 } } })),
            ],
            vec![],
        );
        let after = open(&*b, 9 * DAY);
        assert!(find(&after, PERMITS).is_empty());
        assert!(find(&after, TABLED).is_empty());
        assert!(find(&after, NONE).is_empty());
    }

    #[test]
    fn mayor_complaints_as_a_count_by_kind_and_the_oldest_three_only_a_debt_claimed_against_the_town_until_settled() {
        let mut b = mayor();
        let mut rs: Vec<R> = (0..6)
            .map(|i| statement(&format!("cmp-{i}"), (i + 1) * DAY, "complaint", json!({ "speaks_for": format!("c{i}"), "author": format!("c{i}-x"), "addressed_to": ["city"], "data": { "structure": format!("h{i}"), "about": "waste", "days": 14 } })))
            .collect();
        rs.push(rec(json!({ "id": "clm-1", "at": 3 * DAY, "record": "claim", "position": "right", "holder": "c1", "counterparty": "city", "author": "c1-x", "visible_to": ["city"],
            "about": { "kind": "debt", "amount": 600_000, "for": "Unpaid wages (2 pay periods)." } })));
        feed(&mut b, "city", 10 * DAY, rs, vec![]);
        let out = open(&*b, 10 * DAY);
        let kinds = find(&out, "Complaints about the town's services, still open, by kind");
        assert_eq!(kinds.len(), 1);
        assert!(kinds[0].line.contains("6 open complaints about waste"));
        assert_eq!(ids(&find(&out, "The oldest of the open complaints")), ["cmp-0", "cmp-1", "cmp-2"]);
        let debt = find(&out, "Debts claimed against the town, not settled").remove(0);
        assert_eq!((debt.id.as_str(), debt.amount, debt.since), ("clm-1", Some(600_000), Some(3 * DAY)));
        assert_eq!(lines(&open(&*b, 10 * DAY)), lines(&open(&*b, 11 * DAY)));
        feed(&mut b, "city", 12 * DAY, vec![], vec![tx(11 * DAY, "acc-city", "acc-c1", 600_000, json!({ "settles": "clm-1" }))]);
        assert!(find(&open(&*b, 12 * DAY), "Debts claimed against the town, not settled").is_empty());
    }

    #[test]
    fn mayor_what_it_has_acted_on_survives_a_save() {
        let mut b = mayor();
        feed(&mut b, "city", 10 * DAY, vec![petition("pet-2", 2 * DAY), count("c-2", 3 * DAY, "pet-2", 31)], vec![]);
        feed(&mut b, "city", 12 * DAY, vec![statement("prop-1", 11 * DAY, "proposal", json!({ "in_position": "mayor", "text": "Putting rec.12 and pet-2 to the council, see rec.7.", "data": { "enact": { "kind": "law", "text": "x" } } }))], vec![]);
        let saved = b.save().unwrap();
        let mut c = mayor();
        c.restore(&saved).unwrap();
        assert_eq!(lines(&open(&*b, 12 * DAY)), lines(&open(&*c, 12 * DAY)));
        assert_eq!(rec_ids("rec.12 and xrec.3 rec.4a rec.7."), ["rec.12", "rec.7"]);
    }

    // ------------------------------------------------------------ works and environment

    fn works(extra: Value) -> Box<dyn OfficeBooks> {
        let mut p = json!({ "depot": "d", "workplace": "d/room", "landfill": "lf", "payroll_office": "finance" });
        for (k, v) in extra.as_object().unwrap() {
            p[k] = v.clone();
        }
        make("city.works", "city", "works", p)
    }

    fn posting(id: &str, at: i64) -> R {
        statement(id, at, "job_posting", json!({ "speaks_for": "city", "in_position": "works", "data": { "wage": WAGE, "period": PERIOD, "role": "works crew" } }))
    }

    fn application(id: &str, at: i64, worker: &str, posting: &str) -> R {
        statement(id, at, "job_application", json!({ "speaks_for": worker, "author": format!("{worker}-x"), "addressed_to": ["city"], "data": { "posting": posting, "account": format!("acc-{worker}") } }))
    }

    fn offer_on(id: &str, at: i64, worker: &str, basis: &str) -> R {
        let text = format!("{worker} works for city as works crew for 300000 cents every 14 days. First pay 14 days after both have signed.");
        let mut v = serde_json::to_value(&*employment(id, at, "city", worker, WAGE, PERIOD, "works-system", Some(&text))).unwrap();
        v["basis"] = json!(basis);
        rec(v)
    }

    #[test]
    fn works_an_application_for_an_advertised_post_is_open_until_an_offer_is_made_on_it() {
        let mut b = works(json!({}));
        const WHAT: &str = "Applications for an advertised post, not answered";
        feed(&mut b, "city", 6 * DAY, vec![posting("post-1", DAY), application("app-1", 3 * DAY, "c1", "post-1")], vec![]);
        let o = find(&open(&*b, 6 * DAY), WHAT);
        assert_eq!(ids(&o), ["app-1"]);
        assert_eq!(o[0].since, Some(3 * DAY));
        assert_eq!(lines(&open(&*b, 6 * DAY)), lines(&open(&*b, 7 * DAY)));
        feed(&mut b, "city", 8 * DAY, vec![offer_on("job-1", 7 * DAY, "c1", "app-1")], vec![]);
        assert!(find(&open(&*b, 8 * DAY), WHAT).is_empty());
        // The advertisement withdrawn: an application on it is no longer open.
        let mut c = works(json!({}));
        feed(&mut c, "city", 6 * DAY, vec![posting("post-2", DAY), application("app-2", 3 * DAY, "c2", "post-2")], vec![]);
        assert_eq!(find(&open(&*c, 6 * DAY), WHAT).len(), 1);
        feed(&mut c, "city", 7 * DAY, vec![withdrawal("wd", 6 * DAY + HALF, "post-2")], vec![]);
        assert!(find(&open(&*c, 7 * DAY), WHAT).is_empty());
    }

    #[test]
    fn works_a_starter_with_no_payroll_notice_and_a_leaver_with_none_are_open_until_the_notices_are_on_file() {
        let mut b = works(json!({}));
        let a = offer_on("job-1", 2 * DAY, "c1", "app-1");
        let old = offer_on("job-2", DAY, "c2", "app-2");
        const STARTERS: &str = "New starters the finance office has not been told of";
        const LEAVERS: &str = "Staff who have left or died, the finance office not told";
        let mut rs = signed(&a, 3 * DAY);
        rs.extend(signed(&old, 2 * DAY));
        feed_read(&mut b, "city", 10 * DAY, rs, vec![], &[("job-2", "ending", Some(20 * DAY))]);
        let out = open(&*b, 10 * DAY);
        let mut s = ids(&find(&out, STARTERS)).iter().map(|x| x.to_string()).collect::<Vec<_>>();
        s.sort();
        assert_eq!(s, ["job-1", "job-2"]);
        let j1 = find(&out, STARTERS).into_iter().find(|i| i.id == "job-1").unwrap();
        assert_eq!((j1.since, j1.amount), (Some(3 * DAY), Some(WAGE)));
        let l = find(&out, LEAVERS);
        assert_eq!((l[0].id.as_str(), l[0].since), ("job-2", Some(20 * DAY)));
        assert_eq!(lines(&open(&*b, 10 * DAY)), lines(&open(&*b, 11 * DAY)));
        let notice = |id: &str, kind: &str, agreement: &str| statement(id, 11 * DAY, "payroll_notice", json!({ "speaks_for": "city", "in_position": "works", "data": { "notice": kind, "agreement": agreement } }));
        feed_read(&mut b, "city", 12 * DAY, vec![notice("pn-1", "starter", "job-1"), notice("pn-2", "starter", "job-2"), notice("pn-3", "leaver", "job-2")], vec![], &[("job-2", "ending", Some(20 * DAY))]);
        let after = open(&*b, 12 * DAY);
        assert!(find(&after, STARTERS).is_empty());
        assert!(find(&after, LEAVERS).is_empty());
    }

    #[test]
    fn works_and_environment_a_staffing_direction_that_stands_is_listed_with_who_gave_it_withdrawn_it_is_gone() {
        const WHAT: &str = "Directions on the office's forms that stand";
        let rule = statement("rule-dir", 0, "rule", json!({ "data": { "directions": { "by": ["mayor"] } } }));
        let form = statement("form-ws", 0, "form", json!({ "speaks_for": "city", "data": { "form": "works_staffing", "office": "works" } }));
        let dir = statement("dir-1", 5 * DAY, "direction", json!({ "in_position": "mayor", "author": "mayor-p", "addressed_to": ["city"], "basis": "form-ws", "data": { "recruit": "no" } }));
        let mut b = works(json!({ "directed_under": "rule-dir" }));
        feed(&mut b, "city", 6 * DAY, vec![rule.clone(), form, dir], vec![]);
        let out = find(&open(&*b, 6 * DAY), WHAT);
        assert_eq!(ids(&out), ["dir-1"]);
        assert_eq!(out[0].since, Some(5 * DAY));
        assert!(out[0].line.contains("mayor"));
        assert!(out[0].line.contains("recruit nobody"));
        assert_eq!(lines(&open(&*b, 6 * DAY)), lines(&open(&*b, 7 * DAY)));
        feed(&mut b, "city", 8 * DAY, vec![withdrawal("wd-1", 7 * DAY, "dir-1")], vec![]);
        assert!(find(&open(&*b, 8 * DAY), WHAT).is_empty());
        let mut env = make("city.environment", "city", "environment", json!({ "depot": "d", "workplace": "d/room", "planning": "plan", "directed_under": "rule-dir" }));
        let eform = statement("form-es", 0, "form", json!({ "speaks_for": "city", "data": { "form": "environment_staffing", "office": "environment" } }));
        feed(
            &mut env,
            "city",
            6 * DAY,
            vec![rule, eform, statement("dir-2", 5 * DAY, "direction", json!({ "in_position": "mayor", "author": "mayor-p", "addressed_to": ["city"], "basis": "form-es", "data": { "recruit": "yes", "posts": 2 } }))],
            vec![],
        );
        let e = find(&open(&*env, 6 * DAY), WHAT);
        assert_eq!(ids(&e), ["dir-2"]);
        assert!(e[0].line.contains("up to 2 posts"));
    }

    // ------------------------------------------------------------ planning and the clerk

    #[test]
    fn planning_a_permit_application_with_no_decision_of_ours_is_open_decided_it_is_gone() {
        let mut b = make("city.planning_officer", "city", "planning", json!({}));
        let app = statement("app-1", 2 * DAY, "permit_application", json!({ "speaks_for": "c1", "author": "c1-x", "addressed_to": ["city"], "data": { "lot": "lot.4", "structure_type": "house" } }));
        feed(&mut b, "city", 5 * DAY, vec![app], vec![]);
        let o = find(&open_old(&*b, 5 * DAY), "Permit applications, not decided");
        assert_eq!(o.len(), 1);
        assert_eq!((o[0].id.as_str(), o[0].since), ("app-1", Some(2 * DAY)));
        for w in ["c1", "lot.4", "house", "year 1, day 3"] {
            assert!(o[0].line.contains(w), "{w}: {}", o[0].line);
        }
        assert_eq!(lines(&open(&*b, 5 * DAY)), lines(&open(&*b, 6 * DAY)));
        feed(&mut b, "city", 7 * DAY, vec![statement("dec-1", 6 * DAY, "permit_decision", json!({ "data": { "application": "app-1", "decision": "granted" } }))], vec![]);
        assert!(open(&*b, 7 * DAY).is_empty());
    }

    #[test]
    fn clerk_a_proposal_with_no_ballot_and_a_closed_ballot_with_no_result_are_open_until_a_ballot_is_opened_and_a_result_declared() {
        let mut b = make("city.council_clerk", "council", "council-clerk", json!({ "part": "seat" }));
        let prop = statement("prop-1", 2 * DAY, "proposal", json!({ "speaks_for": "c1", "author": "c1-x", "addressed_to": ["council"], "text": "Plant trees" }));
        feed(&mut b, "council", 4 * DAY, vec![prop], vec![]);
        let o = find(&open(&*b, 4 * DAY), "Proposals to the council with no ballot opened");
        assert_eq!(ids(&o), ["prop-1"]);
        assert_eq!(o[0].since, Some(2 * DAY));
        assert_eq!(lines(&open(&*b, 4 * DAY)), lines(&open(&*b, 5 * DAY)));
        let ballot = statement("bal-1", 5 * DAY, "ballot", json!({ "speaks_for": "council", "data": { "proposal": "prop-1", "electorate": "council", "closes_at": 19 * DAY } }));
        feed(&mut b, "council", 6 * DAY, vec![ballot], vec![]);
        assert!(open(&*b, 6 * DAY).is_empty());
        let closed = find(&open(&*b, 20 * DAY), "Ballots closed with no result declared");
        assert_eq!(ids(&closed), ["bal-1"]);
        assert_eq!(closed[0].since, Some(19 * DAY));
        assert!(open(&*b, 20 * DAY).iter().any(|h| h.always));
        feed(&mut b, "council", 21 * DAY, vec![statement("res-1", 20 * DAY + HALF, "ballot_result", json!({ "speaks_for": "council", "data": { "ballot": "bal-1", "passed": true } }))], vec![]);
        assert!(open(&*b, 21 * DAY).is_empty());
    }

    #[test]
    fn a_module_without_a_reader_here_has_none() {
        assert!(reader("firm.landlord", "x", "y", &Map::new()).is_none());
        let _ = Arc::new(0);
    }
}
