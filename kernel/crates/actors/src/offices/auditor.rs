//! office.auditor: an office of the town that examines other bodies' accounts and decisions as the place's law says, on a
//! sample, and publishes a report (participants/src/behaviour/auditor.ts, 0.1.0; docs/behaviour/auditor.md;
//! docs/design/foundations.md B9). It has no power over anything it examines: it asks a body for one named thing (the count
//! of the period's decisions of a kind, then the nth of them for each number it draws; or the body's statement for the
//! period), the body answers from its own books (`Audited`, its work and its time), and the office decides each again on
//! the file under the law and writes what it found; at the end it publishes one report a body and period. It judges
//! nothing and no consequence follows from a finding (the review and appeal routes the law already has).
//!
//! **Where the Rust decides fresh.**
//! - *The file is the memory* (as the TS was): a run is read again from the office's own papers when a new holder
//!   begins (`restore_run`), the answering side's answered requests from the body's own answers.
//! - A support payment's conditions are `oikos_rules::support::decide`, the one reading the paying office also uses.
//! - Money in integer cents; the sample is Floyd's algorithm, drawn on a stream named for the body, the check and the
//!   period (`cx.rng`).
//! - Days are written through `when_words` (a civil date where the world has a calendar), not "day N".
//! - Ids are ordered by filing (`filed_before`), not as strings.
//!
//! The answering side `Audited` is a library: the finance officer (treasury.rs) runs it; the support office's is the
//! boundary's.

use super::{spread, Booked, Noting};
use crate::common::{addressed_to, data, filed_before, money_words, when_words, Answering, Book, Fields, DAY};
use crate::firms::tax::income_tax_law;
use crate::steps::{because, say, Plan, Say, Step, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::calendar::Calendar;
use oikos_rules::forms::Answers;
use oikos_rules::support::{decide, record_since, reads_record, Claimant, Declared, PaymentRule};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub struct Auditor;

/// The papers this runs on.
pub mod kind {
    /// The auditor to a body: this named thing, by this day. Made in public, as the law that empowers it is, and
    /// addressed to no one: a paper addressed to an organisation wakes every post of it (foundations F6).
    pub const REQUEST: &str = "audit_request";
    /// The body's answer, from its own books.
    pub const ANSWER: &str = "audit_answer";
    /// The auditor's working paper on one item. The auditor's own; the report is what is published.
    pub const FINDING: &str = "audit_finding";
    /// The auditor's report on a body for a period: public.
    pub const REPORT: &str = "audit_report";
}

/// Each role in the words a report uses.
fn role_words(role: &str) -> &'static str {
    match role {
        "support" => "the office that decides claims for support",
        "town_finance" => "the town's finance office",
        _ => "a body of the town",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sample {
    pub share_bps: i64,
    pub least: i64,
    pub most: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditBody {
    pub body: String,
    pub entity: String,
    pub every_days: i64,
    pub checks: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample: Option<Sample>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditLaw {
    #[serde(default)]
    pub id: String,
    pub auditor: String,
    #[serde(default)]
    pub office: String,
    pub answer_within_days: i64,
    pub report_within_days: i64,
    pub bodies: Vec<AuditBody>,
}

/// The audit law on file: the latest published and not withdrawn (the later filed, of two at one moment).
pub fn audit_law(book: &Book) -> Option<AuditLaw> {
    let l = book
        .open("law")
        .filter(|r| data(r).get("audit").is_some_and(Value::is_object))
        .max_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&b.id, &a.id)))?;
    let mut law: AuditLaw = serde_json::from_value(data(l).get("audit")?.clone()).ok()?;
    law.id = l.id.to_string();
    Some(law)
}

/// The support law's payments in force that the book shows: the latest published and not withdrawn (none: no payments).
/// A payment that names no payer is its lawmaker's.
pub fn support_payments(book: &Book) -> Vec<PaymentRule> {
    let Some(l) = book.open("law").filter(|r| data(r).get("payments").is_some_and(Value::is_array)).max_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&b.id, &a.id))) else {
        return vec![];
    };
    let maker = l.speaks_for.unwrap_or_default();
    data(l)
        .get("payments")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|p| serde_json::from_value::<PaymentRule>(p.clone()).ok())
                .map(|mut r| {
                    if r.payer.is_empty() {
                        r.payer = maker.to_string();
                    }
                    r
                })
                .collect()
        })
        .unwrap_or_default()
}

/// How many of a period's `n` decisions are examined: the law's share, no fewer than `least`, no more than `most`, never
/// more than there are.
pub fn sample_size(n: i64, s: &Sample) -> i64 {
    if n <= 0 {
        return 0;
    }
    let share = (i128::from(n) * i128::from(s.share_bps) + 9_999).div_euclid(10_000) as i64;
    n.min(s.least.max(s.most.min(share)))
}

/// `k` distinct numbers of 1 to `n`, in order, drawn from a stream (Floyd's algorithm: k draws, the same whatever the hour).
pub fn draw_sample(mut below: impl FnMut(u64) -> u64, n: i64, k: i64) -> Vec<i64> {
    let mut chosen: BTreeSet<i64> = BTreeSet::new();
    let mut j = n - k;
    while j < n {
        let r = below((j + 1) as u64) as i64 + 1;
        chosen.insert(if chosen.contains(&r) { j + 1 } else { r });
        j += 1;
    }
    chosen.into_iter().collect()
}

// ------------------------------------------------------------------ the audited side

/// The decision a request for "the nth" names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecisionOn {
    pub id: String,
    pub at: i64,
    pub on: i64,
    pub granted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub every: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lapsed: Option<bool>,
}

/// The claim the decision was made on, as the body has it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaimOn {
    pub id: String,
    pub by: String,
    pub payment: String,
    pub born_at: i64,
    pub account: String,
    #[serde(default)]
    pub declares: Declared,
}

/// Pay reported for the claimant to the body, one report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reported {
    pub at: i64,
    pub gross: i64,
}

/// A decision and the file it was made on: what the body's answer carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecisionFile {
    pub decision: DecisionOn,
    /// Absent: the claim the decision names is not on the body's file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<ClaimOn>,
    /// The pay reported for the claimant to the body up to the day it decided, newest first.
    #[serde(default)]
    pub reported: Vec<Reported>,
    /// Whether the body paid the claimant another payment for age.
    #[serde(default)]
    pub pays_other: bool,
}

/// A payment in the books.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InBooks {
    pub id: String,
    pub amount: i64,
    pub at: i64,
}

/// A payment in the bank's record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InBank {
    pub id: String,
    pub amount: i64,
    pub t: i64,
}

/// A body's payments in its books and the bank's record of them.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Statement {
    pub books: Vec<InBooks>,
    pub bank: Vec<InBank>,
}

/// What a body that is audited can answer, from its own books. A method that returns `None` is one the body does not
/// answer (the request is left); `Some(None)` is an answer that there is nothing.
pub trait Answerer {
    /// How many decisions of a kind it made in [from, to), counted in the order `nth` takes them.
    fn count(&self, _kind: &str, _from: i64, _to: i64) -> Option<i64> {
        None
    }
    /// The nth (from 1) of them, with the file it was made on.
    fn nth(&self, _kind: &str, _from: i64, _to: i64, _nth: i64) -> Option<Option<DecisionFile>> {
        None
    }
    /// Its payments in the books and the bank's record of them, for [from, to).
    fn statement(&self, _from: i64, _to: i64) -> Option<Option<Statement>> {
        None
    }
}

/// The answering side of an audit, for any body (docs/behaviour/auditor.md, "A body that is audited"): it answers a request
/// from the auditor the law names, for a body the law names, with the thing asked for and nothing else. Each answer is a
/// paper the body makes (its performer's time). It does not decide whether to be audited and cannot refuse.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Audited {
    me: String,
    done: BTreeSet<String>,
}

impl Audited {
    pub fn new(me: &str) -> Self {
        Audited { me: me.to_string(), done: BTreeSet::new() }
    }

    pub fn steps<T>(&mut self, book: &Book, answer: &dyn Answerer) -> Vec<Step<T>> {
        let mut steps: Vec<Step<T>> = vec![];
        let Some(law) = audit_law(book) else { return steps };
        // (A new holder of the post has no memory but the office's papers: a request already answered stays answered.)
        for a in book.all(kind::ANSWER) {
            if a.speaks_for.as_deref() == Some(self.me.as_str()) {
                if let Some(r) = data(a).s("request") {
                    self.done.insert(r.to_string());
                }
            }
        }
        let mut asked: Vec<Arc<Record>> = book.open(kind::REQUEST).cloned().collect();
        asked.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
        for r in asked {
            if self.done.contains(r.id.as_str()) || r.speaks_for.as_deref() != Some(law.auditor.as_str()) {
                continue;
            }
            let d = data(&r);
            if !law.bodies.iter().any(|b| b.entity == self.me && Some(b.body.as_str()) == d.s("body")) {
                continue;
            }
            self.done.insert(r.id.to_string());
            let (from, to) = (d.i("from").unwrap_or(0), d.i("to").unwrap_or(0));
            let ask = d.s("ask").unwrap_or("").to_string();
            let kind_ = d.s("kind").unwrap_or("").to_string();
            let day = |t: i64| t.div_euclid(DAY);
            let (reply, words): (Value, String) = match ask.as_str() {
                "count" => {
                    let Some(count) = answer.count(&kind_, from, to) else { continue };
                    (json!({ "count": count }), format!("{count} decision{} ({}) made between day {} and day {}.", if count == 1 { "" } else { "s" }, kind_.replace('_', " "), day(from), day(to)))
                }
                "nth" => {
                    let nth = d.i("nth").unwrap_or(0);
                    let Some(file) = answer.nth(&kind_, from, to, nth) else { continue };
                    match file {
                        Some(f) => (json!({ "found": true, "file": f }), format!("Decision {} (number {nth} of the period), with the claim and the record it was made on.", f.decision.id)),
                        None => (json!({ "found": false }), format!("There is no decision number {nth} in the period.")),
                    }
                }
                "statement" => {
                    let Some(statement) = answer.statement(from, to) else { continue };
                    match statement {
                        Some(s) => {
                            let words = format!("The payments in our books for the period and the bank's record of them: {} in the books, {} in the bank's record.", s.books.len(), s.bank.len());
                            (json!({ "statement": s }), words)
                        }
                        None => (json!({ "statement": null }), "We hold no books for the period.".to_string()),
                    }
                }
                _ => continue,
            };
            let what = match ask.as_str() {
                "count" => "the count of our decisions".to_string(),
                "nth" => format!("our decision number {}", d.get("nth").map(|n| n.as_i64().map_or_else(|| n.to_string(), |i| i.to_string())).unwrap_or_default()),
                _ => "our statement of payments".to_string(),
            };
            let mut payload = json!({ "request": r.id, "audit": d.get("audit").cloned().unwrap_or(Value::Null), "ask": ask });
            if ask == "nth" {
                payload["nth"] = d.get("nth").cloned().unwrap_or(Value::Null);
            }
            if let (Some(p), Some(extra)) = (payload.as_object_mut(), reply.as_object()) {
                for (k, v) in extra {
                    p.insert(k.clone(), v.clone());
                }
            }
            let auditor = r.speaks_for.unwrap_or_default();
            steps.push(because(
                format!("The auditor asks for {what} for an audit the law provides: answering."),
                vec![say(
                    kind::ANSWER,
                    &format!("Answer to audit request {}: {words}", r.id),
                    Say { to: Some(vec![auditor.to_string()]), visible: Some(Visible::Only(if auditor == self.me { vec![auditor.to_string()] } else { vec![auditor.to_string(), self.me.clone()] })), basis: Some(r.id.to_string()), data: Some(payload), ..Default::default() },
                )],
            ));
        }
        steps
    }
}

// ------------------------------------------------------------------ examining

/// What an examination found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    /// Whether it agrees with the law: true, false, or `None` where it cannot be told from the file (and why).
    pub agrees: Option<bool>,
    /// In the law's terms.
    pub says: String,
}

/// A decision, decided again from the file under the support law's rule for its payment.
pub fn examine_decision(file: &DecisionFile, rule: Option<&PaymentRule>, book: &Book, year: i64, cal: Option<&Calendar>, written: &dyn Fn(i64) -> String) -> Finding {
    let d = &file.decision;
    let not_told = |says: String| Finding { agrees: None, says };
    let Some(c) = &file.claim else { return not_told("the claim the decision names is not on the body's file: not re-decided".into()) };
    if d.lapsed == Some(true) {
        return not_told("the claim waited for papers that did not come in time, and was refused on that: the decision rests on the procedure's days for the wait, not on the conditions of the payment; not re-decided".into());
    }
    let Some(rule) = rule else { return not_told(format!("no support law for the payment {} is on file: not re-decided", c.payment)) };
    let since = if reads_record(rule) { record_since(rule, d.on, cal) } else { i64::MIN };
    let mut reports: Vec<&Reported> = file.reported.iter().filter(|r| r.at >= since && r.at <= d.on).collect();
    reports.sort_by(|a, b| b.at.cmp(&a.at));
    let who = Claimant { born_at: c.born_at, declared: c.declares.clone(), reports: reports.iter().map(|r| r.gross).collect(), paid_another_pension: file.pays_other };
    let tax = income_tax_law(book);
    let again = decide(rule, &who, d.on, year, tax.as_ref());
    let why = |r: &oikos_rules::support::Refusal| r.why(written).map(|w| format!(": {w}")).unwrap_or_default();
    if d.granted {
        match again {
            Err(r) => Finding { agrees: Some(false), says: format!("granted, though the claim does not meet the conditions the law states for the payment{}", why(&r)) },
            Ok(g) if Some(g.amount) != d.amount => Finding {
                agrees: Some(false),
                says: format!("granted at {} every {} days; the law's rule for the payment gives {}", written(d.amount.unwrap_or(0)), (d.every.unwrap_or(0) + DAY / 2).div_euclid(DAY), written(g.amount)),
            },
            Ok(_) => Finding { agrees: Some(true), says: "granted; the claim meets the conditions the law states for the payment, at the sum the law's rule gives".into() },
        }
    } else {
        match again {
            Ok(g) => Finding {
                agrees: Some(false),
                says: format!(
                    "refused{}, though the claim meets the conditions the law states for the payment (the law's rule gives {} every {} days)",
                    d.reason.as_ref().map(|r| format!(" ({r})")).unwrap_or_default(),
                    written(g.amount),
                    rule.every_days
                ),
            },
            Err(r) => Finding { agrees: Some(true), says: format!("refused; the claim does not meet the conditions the law states for the payment{}", why(&r)) },
        }
    }
}

/// An item of one side of a statement, not matched by the other's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Unmatched {
    pub id: String,
    pub amount: i64,
}

/// A payment whose sum differs between the books and the bank.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Differ {
    pub id: String,
    pub books: i64,
    pub bank: i64,
}

/// The books' payments against the bank's record of them, for the period.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Reconciled {
    pub matched: i64,
    pub in_books_not_bank: Vec<Unmatched>,
    pub in_bank_not_books: Vec<Unmatched>,
    pub differ: Vec<Differ>,
}

impl Reconciled {
    fn agrees(&self) -> bool {
        self.in_books_not_bank.is_empty() && self.in_bank_not_books.is_empty() && self.differ.is_empty()
    }
}

/// The books' payments against the bank's record, for the period: each side's items not matched by the other's.
/// `grace`: the last stretch of the period, which the bank's record may not yet show.
pub fn reconcile(s: &Statement, from: i64, to: i64, grace: i64) -> Reconciled {
    let bank: BTreeMap<&str, &InBank> = s.bank.iter().map(|x| (x.id.as_str(), x)).collect();
    let books: BTreeSet<&str> = s.books.iter().map(|x| x.id.as_str()).collect();
    let mut out = Reconciled::default();
    let mut mine: Vec<&InBooks> = s.books.iter().filter(|x| x.at >= from && x.at < to - grace).collect();
    mine.sort_by(|a, b| filed_before(&a.id, &b.id));
    for b in mine {
        match bank.get(b.id.as_str()) {
            None => out.in_books_not_bank.push(Unmatched { id: b.id.clone(), amount: b.amount }),
            Some(k) if k.amount != b.amount => out.differ.push(Differ { id: b.id.clone(), books: b.amount, bank: k.amount }),
            Some(_) => out.matched += 1,
        }
    }
    let mut theirs: Vec<&InBank> = s.bank.iter().filter(|x| x.t >= from && x.t < to).collect();
    theirs.sort_by(|a, b| filed_before(&a.id, &b.id));
    for k in theirs {
        if !books.contains(k.id.as_str()) {
            out.in_bank_not_books.push(Unmatched { id: k.id.clone(), amount: k.amount });
        }
    }
    out
}

// ------------------------------------------------------------------ the office

use oikos_sight::Record;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Asking {
    Asked,
    Answered,
    Late,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ItemState {
    Asked,
    Examined,
    Late,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Item {
    nth: i64,
    by: i64,
    state: ItemState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Particular {
    item: String,
    nth: i64,
    finding: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Run {
    key: String,
    body: AuditBody,
    check: String,
    n: i64,
    from: i64,
    to: i64,
    by: i64,
    state: Asking,
    population: Option<i64>,
    items: Vec<Item>,
    agreed: i64,
    not_agreed: i64,
    not_checked: i64,
    not_found: i64,
    particulars: Vec<Particular>,
    statement: Option<Reconciled>,
    reported: bool,
}

impl Run {
    fn new(key: String, body: &AuditBody, check: &str, kind: &Option<String>, n: i64, by: i64) -> Run {
        Run {
            key,
            body: AuditBody { kind: kind.clone().or_else(|| body.kind.clone()), ..body.clone() },
            check: check.to_string(),
            n,
            from: (n - 1) * body.every_days * DAY,
            to: n * body.every_days * DAY,
            by,
            state: Asking::Asked,
            population: None,
            items: vec![],
            agreed: 0,
            not_agreed: 0,
            not_checked: 0,
            not_found: 0,
            particulars: vec![],
            statement: None,
            reported: false,
        }
    }
}

pub(crate) fn answers() -> Answers {
    Answers {
        office: "the audit office".into(),
        acts: "What it acts on: the audit law, which says whom it audits and how often; it asks those bodies for named things, and examines what they answer. It acts on no letter.".into(),
        forms: vec![],
        report: false,
    }
}

impl Kind for Auditor {
    fn name(&self) -> &'static str {
        "office.auditor"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/auditor.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": { "year": { "schema": { "type": "integer" }, "default": 365 * DAY, "source": "placeholder" } },
            "perceives": [], "state": "none",
            "issues": super::forms_issued("AUDIT"),
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        spread(ctx, 9 * 3600, 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let plan = Office { me: ctx.entity.clone(), year: ctx.param("year", 365 * DAY)?, book: Book::new(), runs: BTreeMap::new() };
        Ok(Box::new(Answering::new(Noting::new(plan), answers())))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let inner = saved.get("inner").cloned().ok_or("office.auditor: nothing saved")?;
        Ok(Box::new(Answering::restore(Noting::<Office>::restore(inner)?, answers(), &saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct Office {
    me: String,
    year: i64,
    book: Book,
    runs: BTreeMap<String, Run>,
}

impl Booked for Office {
    fn book_mut(&mut self) -> &mut Book {
        &mut self.book
    }
}

/// A day, written for a report: a civil date where the world has a calendar.
fn day_words(t: i64, cx: &Cx) -> String {
    when_words(t, &cx.ctx.world)
}

impl Office {
    fn answer_to(&self, run: &Run, ask: &str, nth: Option<i64>) -> Option<Arc<Record>> {
        self.book
            .open(kind::ANSWER)
            .find(|a| {
                let d = data(a);
                addressed_to(a).iter().any(|x| x == &self.me)
                    && a.speaks_for.as_deref() == Some(run.body.entity.as_str())
                    && d.s("audit") == Some(run.key.as_str())
                    && d.s("ask") == Some(ask)
                    && nth.is_none_or(|n| d.i("nth") == Some(n))
            })
            .cloned()
    }

    /// A run as the office's own papers leave it, or none where none was begun.
    fn restore_run(&self, key: &str, body: &AuditBody, check: &str, kind_: &Option<String>, n: i64, law: &AuditLaw) -> Option<Run> {
        let mine = |k: &str| -> Vec<Arc<Record>> { self.book.all(k).filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str()) && data(r).s("audit") == Some(key)).cloned().collect() };
        let asked = mine(kind::REQUEST);
        let first = asked.first()?;
        let by = data(first).i("answer_by").filter(|v| *v != 0).unwrap_or(first.at + law.answer_within_days * DAY);
        let mut run = Run::new(key.to_string(), body, check, kind_, n, by);
        run.reported = !mine(kind::REPORT).is_empty();
        if run.reported || check == "accounts" {
            return Some(run);
        }
        let nths: Vec<&Arc<Record>> = asked.iter().filter(|r| data(r).s("ask") == Some("nth")).collect();
        if nths.is_empty() {
            return Some(run); // (the count, answered or not: the sample is drawn from it again, the same numbers)
        }
        run.population = Some(self.answer_to(&run, "count", None).and_then(|a| data(&a).i("count")).unwrap_or(0).max(0));
        let found = mine(kind::FINDING);
        for r in nths {
            let nth = data(r).i("nth").unwrap_or(0);
            let f = found.iter().find(|x| data(x).i("nth") == Some(nth));
            run.items.push(Item { nth, by: data(r).i("answer_by").filter(|v| *v != 0).unwrap_or(r.at + law.answer_within_days * DAY), state: if f.is_some() { ItemState::Examined } else { ItemState::Asked } });
            let Some(f) = f else { continue };
            let fd = data(f);
            match fd.get("agrees").and_then(Value::as_bool) {
                Some(true) => run.agreed += 1,
                Some(false) => {
                    run.not_agreed += 1;
                    run.particulars.push(Particular { item: fd.s("item").unwrap_or("").to_string(), nth, finding: fd.s("says").unwrap_or("").to_string() });
                }
                None if fd.s("says").is_some_and(|s| s.contains("no decision by that number")) => run.not_found += 1,
                None => run.not_checked += 1,
            }
        }
        Some(run)
    }

    fn request<T>(&self, run: &Run, law: &AuditLaw, t: i64, ask: &str, nth: Option<i64>, cx: &Cx) -> Step<T> {
        let by = t + law.answer_within_days * DAY;
        let what = match ask {
            "count" => format!("the count of its {}s in the period", run.body.kind.as_deref().unwrap_or("").replace('_', " ")),
            "nth" => format!("its decision number {} of the period", nth.unwrap_or(0)),
            _ => "its statement of payments for the period".to_string(),
        };
        let (from, to, until) = (day_words(run.from, cx), day_words(run.to, cx), day_words(by, cx));
        let mut d = json!({ "audit": run.key, "body": run.body.body, "ask": ask, "from": run.from, "to": run.to, "answer_by": by });
        if let Some(n) = nth {
            d["nth"] = json!(n);
        }
        if run.check == "decisions" {
            if let Some(k) = &run.body.kind {
                d["kind"] = json!(k);
            }
        }
        because(
            format!("Auditing {} for {from} to {to} as the law provides: asking for {what}, to be answered by {until}.", run.body.entity),
            vec![say(
                kind::REQUEST,
                &format!("Audit request: {what}, for the period from {from} to {to} (audit law {}). To be answered by {until}.", law.id),
                Say { visible: Some(Visible::Public), basis: Some(law.id.clone()), data: Some(d), ..Default::default() },
            )],
        )
    }

    fn report<T>(&self, run: &mut Run, law: &AuditLaw, t: i64, cx: &Cx) -> Step<T> {
        run.reported = true;
        let due = run.to + law.report_within_days * DAY;
        let window = format!("{} to {}", day_words(run.from, cx), day_words(run.to, cx));
        let role = role_words(&run.body.body);
        let written = |n: i64| money_words(n, &cx.ctx.world);
        let kind_words = run.body.kind.as_deref().unwrap_or("").replace('_', " ");
        let (words, data): (String, Value) = if run.check == "decisions" {
            let late = run.items.iter().filter(|i| i.state == ItemState::Late).count() as i64;
            let words = match run.population {
                None => format!("Audit of {role} ({}), decisions of {kind_words}, {window}: the body did not answer the request for the count of its decisions in the days the law gives, and no sample was drawn.", run.body.entity),
                Some(pop) => {
                    let mut w = format!(
                        "Audit of {role} ({}), decisions of {kind_words}, {window}: {pop} made; {} drawn for examination; {} agree with the law and the procedure published for the kind, {} do not agree, {} could not be told from the file{}{}.",
                        run.body.entity,
                        run.items.len(),
                        run.agreed,
                        run.not_agreed,
                        run.not_checked,
                        if run.not_found > 0 { format!(", {} not found by the number asked", run.not_found) } else { String::new() },
                        if late > 0 { format!(", {late} not answered in the days the law gives") } else { String::new() },
                    );
                    if !run.particulars.is_empty() {
                        let list: Vec<String> = run.particulars.iter().map(|x| format!("decision {} (number {}): {}", x.item, x.nth, x.finding)).collect();
                        w += &format!(" Where they do not agree: {}.", list.join("; "));
                    }
                    w
                }
            };
            let not_answered = if late > 0 { late } else if run.population.is_none() { 1 } else { 0 };
            let data = json!({
                "audit": run.key, "body": run.body.entity, "check": "decisions", "kind": run.body.kind, "period": run.n, "from": run.from, "to": run.to, "due": due,
                "population": run.population, "sample": run.items.len(), "agreed": run.agreed, "not_agreed": run.not_agreed, "not_checked": run.not_checked,
                "not_found": run.not_found, "not_answered": not_answered, "disagreements": run.particulars,
            });
            (words, data)
        } else {
            let words = match &run.statement {
                None => format!(
                    "Audit of {role} ({}), accounts, {window}: {}.",
                    run.body.entity,
                    if run.state == Asking::Late { "the body did not answer the request for its statement in the days the law gives" } else { "the body holds no books for the period" }
                ),
                Some(s) => {
                    let mut w = format!(
                        "Audit of {role} ({}), accounts, {window}: {} payment{} in the books agree with the bank's record; {} in the books are not in the bank's record; {} in the bank's record are not in the books; {} differ in the sum.",
                        run.body.entity,
                        s.matched,
                        if s.matched == 1 { "" } else { "s" },
                        s.in_books_not_bank.len(),
                        s.in_bank_not_books.len(),
                        s.differ.len()
                    );
                    if !s.agrees() {
                        let mut parts: Vec<String> = vec![];
                        parts.extend(s.in_books_not_bank.iter().map(|x| format!("{}: in the books ({}), not in the bank's record", x.id, written(x.amount))));
                        parts.extend(s.in_bank_not_books.iter().map(|x| format!("{}: in the bank's record ({}), not in the books", x.id, written(x.amount))));
                        parts.extend(s.differ.iter().map(|x| format!("{}: books {}, bank {}", x.id, written(x.books), written(x.bank))));
                        w += &format!(" {}.", parts.join("; "));
                    }
                    w
                }
            };
            let s = run.statement.clone().unwrap_or_default();
            let data = json!({
                "audit": run.key, "body": run.body.entity, "check": "accounts", "period": run.n, "from": run.from, "to": run.to, "due": due,
                "reconciles": run.statement.as_ref().is_some_and(Reconciled::agrees), "matched": s.matched, "in_books_not_bank": s.in_books_not_bank,
                "in_bank_not_books": s.in_bank_not_books, "differ": s.differ, "not_answered": i64::from(run.state == Asking::Late),
            });
            (words, data)
        };
        let late = t > due;
        because(
            format!("The audit of {} for {window} is examined: publishing the report{}.", run.body.entity, if late { format!(" (the law's day for it, {}, has passed)", day_words(due, cx)) } else { String::new() }),
            vec![say(
                kind::REPORT,
                &format!("{words}{}", if late { format!(" (Due by {}.)", day_words(due, cx)) } else { String::new() }),
                Say { visible: Some(Visible::Public), basis: Some(law.id.clone()), data: Some(data), ..Default::default() },
            )],
        )
    }

    fn finding<T>(&self, run: &Run, id: &str, nth: Option<i64>, f: &Finding) -> Step<T> {
        let what = if nth.is_some() { format!("decision {id}") } else { "the statement".to_string() };
        let verdict = match f.agrees {
            None => "cannot be told from the file",
            Some(true) => "agrees with the law",
            Some(false) => "does not agree",
        };
        let mut d = json!({ "audit": run.key, "item": id, "agrees": f.agrees, "says": f.says });
        if let Some(n) = nth {
            d["nth"] = json!(n);
        }
        because(
            format!("Examined {what} of {}: {verdict}.", run.body.entity),
            vec![say(
                kind::FINDING,
                &format!("Audit finding on {id}: {}.", f.says),
                Say { visible: Some(Visible::Only(vec![self.me.clone()])), basis: nth.map(|_| id.to_string()), data: Some(d), ..Default::default() },
            )],
        )
    }
}

impl Plan for Office {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let t = pic.t;
        let mut steps: Vec<Step<()>> = vec![];
        let Some(law) = audit_law(&self.book) else { return steps };
        if law.auditor != self.me {
            return steps;
        }
        let payments = support_payments(&self.book);
        for body in &law.bodies {
            for check in &body.checks {
                let kind_ = (check == "decisions").then(|| body.kind.clone().unwrap_or_else(|| "benefit_decision".to_string()));
                let mut n = 1;
                while n * body.every_days * DAY <= t {
                    let key = format!("{}|{check}|{n}", body.body);
                    if !self.runs.contains_key(&key) {
                        // (A new holder of the post starts with no memory but the office's papers: what was begun, answered,
                        // examined and reported is read from them.)
                        if let Some(before) = self.restore_run(&key, body, check, &kind_, n, &law) {
                            self.runs.insert(key, before);
                        } else {
                            let run = Run::new(key.clone(), body, check, &kind_, n, t + law.answer_within_days * DAY);
                            steps.push(self.request(&run, &law, t, if check == "decisions" { "count" } else { "statement" }, None, cx));
                            self.runs.insert(key, run);
                        }
                    }
                    n += 1;
                }
            }
        }
        let written = |n: i64| money_words(n, &cx.ctx.world);
        let cal = cx.ctx.world.calendar.clone();
        let keys: Vec<String> = self.runs.keys().cloned().collect();
        for key in keys {
            let Some(mut run) = self.runs.get(&key).cloned() else { continue };
            if run.reported {
                continue;
            }
            if run.check == "accounts" {
                if let Some(a) = self.answer_to(&run, "statement", None) {
                    run.state = Asking::Answered;
                    run.statement = data(&a).get("statement").filter(|s| !s.is_null()).and_then(|s| serde_json::from_value::<Statement>(s.clone()).ok()).map(|s| reconcile(&s, run.from, run.to, 2 * DAY));
                    let says = match &run.statement {
                        Some(s) => format!("{} payments agree with the bank's record, {} do not", s.matched, s.in_books_not_bank.len() + s.in_bank_not_books.len() + s.differ.len()),
                        None => "the body holds no books for the period".to_string(),
                    };
                    let agrees = run.statement.as_ref().map(Reconciled::agrees);
                    steps.push(self.finding(&run, &format!("statement-{}", run.key), None, &Finding { agrees, says }));
                    steps.push(self.report(&mut run, &law, t, cx));
                } else if t > run.by {
                    run.state = Asking::Late;
                    steps.push(self.report(&mut run, &law, t, cx));
                }
                self.runs.insert(key, run);
                continue;
            }
            // Decisions: the count first, then the numbers drawn.
            if run.population.is_none() {
                let Some(a) = self.answer_to(&run, "count", None) else {
                    if t > run.by {
                        run.state = Asking::Late;
                        steps.push(self.report(&mut run, &law, t, cx));
                    }
                    self.runs.insert(key, run);
                    continue;
                };
                run.state = Asking::Answered;
                let pop = data(&a).i("count").unwrap_or(0).max(0);
                run.population = Some(pop);
                let sample = law.bodies.iter().find(|b| b.body == run.body.body && b.entity == run.body.entity).and_then(|b| b.sample).unwrap_or(Sample { share_bps: 0, least: 0, most: 0 });
                let k = sample_size(pop, &sample);
                // (Named for the body, the check and the period, never the hour: a sample is the same whenever the office gets to it.)
                let mut rng = cx.rng(&format!("audit/{}/{}/{}", run.body.entity, run.check, run.n));
                for nth in draw_sample(|m| rng.below(m), pop, k) {
                    run.items.push(Item { nth, by: t + law.answer_within_days * DAY, state: ItemState::Asked });
                    steps.push(self.request(&run, &law, t, "nth", Some(nth), cx));
                }
                if run.items.is_empty() {
                    steps.push(self.report(&mut run, &law, t, cx));
                }
                self.runs.insert(key, run);
                continue;
            }
            for i in 0..run.items.len() {
                if run.items[i].state != ItemState::Asked {
                    continue;
                }
                let nth = run.items[i].nth;
                let Some(a) = self.answer_to(&run, "nth", Some(nth)) else {
                    if t > run.items[i].by {
                        run.items[i].state = ItemState::Late;
                    }
                    continue;
                };
                run.items[i].state = ItemState::Examined;
                let file: Option<DecisionFile> = data(&a).get("file").and_then(|f| serde_json::from_value(f.clone()).ok());
                let Some(file) = file.filter(|_| data(&a).get("found").is_some_and(crate::common::truthy)) else {
                    run.not_found += 1;
                    steps.push(self.finding(&run, &format!("{}#{nth}", run.key), Some(nth), &Finding { agrees: None, says: "no decision by that number".into() }));
                    continue;
                };
                let rule = file.claim.as_ref().and_then(|c| payments.iter().find(|r| r.id == c.payment));
                let f = examine_decision(&file, rule, &self.book, self.year, cal.as_ref(), &written);
                match f.agrees {
                    Some(true) => run.agreed += 1,
                    Some(false) => {
                        run.not_agreed += 1;
                        run.particulars.push(Particular { item: file.decision.id.clone(), nth, finding: f.says.clone() });
                    }
                    None => run.not_checked += 1,
                }
                steps.push(self.finding(&run, &file.decision.id, Some(nth), &f));
            }
            if run.items.iter().all(|i| i.state != ItemState::Asked) {
                steps.push(self.report(&mut run, &law, t, cx));
            }
            self.runs.insert(key, run);
        }
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::{st, Rig, DAY};
    use super::*;

    fn law() -> Value {
        st(
            "law-audit",
            0,
            "law",
            "city",
            &[],
            json!({ "audit": { "auditor": "audit", "office": "audit", "answer_within_days": 10, "report_within_days": 10, "bodies": [
                { "body": "support", "entity": "transfers", "every_days": 30, "checks": ["decisions"], "kind": "benefit_decision", "sample": { "share_bps": 10000, "least": 1, "most": 2 } }] } }),
        )
    }
    fn support_law() -> Value {
        st(
            "law-support",
            0,
            "law",
            "city",
            &[],
            json!({ "payments": [{ "id": "pension", "account": "acc-outside", "every_days": 14, "who": { "from_age": 65 }, "amount": { "flat": 50000 } }] }),
        )
    }
    fn answer(id: &str, at: i64, request: &str, data: Value) -> Value {
        let mut d = json!({ "request": request, "audit": "support|decisions|1" });
        for (k, v) in data.as_object().unwrap() {
            d[k] = v.clone();
        }
        st(id, at, "audit_answer", "transfers", &["audit"], d)
    }
    fn file(id: &str, born_at: i64, granted: bool, amount: Option<i64>) -> Value {
        json!({ "found": true, "ask": "nth", "file": {
            "decision": { "id": id, "at": 30 * DAY, "on": 30 * DAY, "granted": granted, "amount": amount, "every": 14 * DAY },
            "claim": { "id": "claim-1", "by": "c1", "payment": "pension", "born_at": born_at, "account": "acc-c1", "declares": {} },
            "reported": [], "pays_other": false } })
    }
    fn rig() -> Rig {
        Rig::new(&Auditor, "audit", Some("audit-officer"), json!({ "year": 365 * DAY }))
    }

    #[test]
    fn a_sample_is_the_laws_share_between_its_least_and_most_and_never_more_than_there_are() {
        let s = Sample { share_bps: 1_000, least: 2, most: 5 };
        assert_eq!([0, 1, 3, 15, 40, 100].map(|n| sample_size(n, &s)), [0, 1, 2, 2, 4, 5]);
        // Distinct numbers of 1 to n, in order, whatever the stream.
        let mut x = 12_345u64;
        let drawn = draw_sample(
            |m| {
                x = x.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
                (x >> 33) % m
            },
            30,
            7,
        );
        assert_eq!(drawn.len(), 7);
        assert!(drawn.windows(2).all(|w| w[0] < w[1]) && drawn.iter().all(|n| (1..=30).contains(n)));
        // Asked for all of them, it is all of them.
        assert_eq!(draw_sample(|m| m - 1, 4, 4), vec![1, 2, 3, 4]);
    }

    #[test]
    fn it_asks_for_the_count_then_for_each_decision_drawn_and_reports_what_the_law_finds() {
        let mut a = rig();
        // Period 1 ends at day 30: the count is asked for, once.
        let first = a.day(30 * DAY + 9 * 3600, &[law(), support_law()]).join("\n");
        assert!(first.contains("kind=audit_request") && first.contains("\"ask\":\"count\"") && first.contains("\"kind\":\"benefit_decision\""), "{first}");
        assert!(a.day(31 * DAY, &[]).is_empty(), "nothing more while the days run");
        // Three decisions in the period; the sample is two of them, each asked for by its number.
        let count = answer("rec.20", 32 * DAY, "rec.1", json!({ "ask": "count", "count": 3 }));
        let asked = a.day(32 * DAY, &[count]).join("\n");
        assert_eq!(asked.matches("\"ask\":\"nth\"").count(), 2, "{asked}");
        // Their files: a pension granted to a claimant of 30 (the law says 65 or over), and a right grant at the law's sum.
        let born_young = 30 * DAY - 30 * 365 * DAY;
        let born_old = 30 * DAY - 70 * 365 * DAY;
        let nths: Vec<i64> = asked.split("\"nth\":").skip(1).map(|r| r.split(|c: char| !c.is_ascii_digit()).next().unwrap().parse().unwrap()).collect();
        let mut records = vec![];
        for (i, n) in nths.iter().enumerate() {
            let (born, amount) = if i == 0 { (born_young, Some(50_000)) } else { (born_old, Some(50_000)) };
            let mut ans = answer(&format!("rec.3{i}"), 33 * DAY, &format!("rec.{}", 2 + i), file(&format!("dec-{n}"), born, true, amount));
            ans["data"]["nth"] = json!(n);
            records.push(ans);
        }
        let done = a.day(33 * DAY, &records).join("\n");
        assert_eq!(done.matches("kind=audit_finding").count(), 2, "{done}");
        assert!(done.contains("granted, though the claim does not meet the conditions"), "{done}");
        let report = done.lines().find(|l| l.contains("kind=audit_report")).expect("a report");
        assert!(report.contains("\"population\":3") && report.contains("\"agreed\":1") && report.contains("\"not_agreed\":1"), "{report}");
        assert!(a.day(34 * DAY, &[]).is_empty(), "reported once");
    }

    #[test]
    fn a_body_that_does_not_answer_in_the_days_the_law_gives_is_reported_as_not_having_answered() {
        let mut a = rig();
        a.day(30 * DAY + 9 * 3600, &[law()]);
        let late = a.day(41 * DAY, &[]).join("\n");
        assert!(late.contains("kind=audit_report") && late.contains("did not answer the request for the count"), "{late}");
        assert!(late.contains("\"population\":null") && late.contains("\"not_answered\":1"), "{late}");
    }

    #[test]
    fn a_new_holder_reads_the_run_from_the_offices_papers_and_does_not_ask_again() {
        let mut a = rig();
        let asked = a.day(30 * DAY + 9 * 3600, &[law()]);
        assert_eq!(asked.len(), 1);
        // The request is on the office's own file: a successor shown it asks for nothing again.
        let req = st("rec.1", 30 * DAY + 9 * 3600, "audit_request", "audit", &[], json!({ "audit": "support|decisions|1", "body": "support", "ask": "count", "kind": "benefit_decision", "from": 0, "to": 30 * DAY, "answer_by": 40 * DAY }));
        let mut b = rig();
        assert!(b.day(31 * DAY, &[law(), req]).is_empty());
    }

    #[test]
    fn an_audited_body_answers_what_is_asked_once_from_its_own_books_and_nothing_else() {
        struct Books;
        impl Answerer for Books {
            fn count(&self, _: &str, _: i64, _: i64) -> Option<i64> {
                Some(4)
            }
        }
        let book = {
            let mut b = Book::new();
            let law = st("law-audit", 0, "law", "city", &[], json!({ "audit": { "auditor": "audit", "office": "audit", "answer_within_days": 10, "report_within_days": 10, "bodies": [
                { "body": "support", "entity": "transfers", "every_days": 30, "checks": ["decisions"], "kind": "benefit_decision" }] } }));
            let ask = st("rec.5", DAY, "audit_request", "audit", &[], json!({ "audit": "k", "body": "support", "ask": "count", "kind": "benefit_decision", "from": 0, "to": 30 * DAY, "answer_by": 9 * DAY }));
            let stranger = st("rec.6", DAY, "audit_request", "someone", &[], json!({ "audit": "k", "body": "support", "ask": "count", "kind": "benefit_decision", "from": 0, "to": 30 * DAY, "answer_by": 9 * DAY }));
            let statement = st("rec.7", DAY, "audit_request", "audit", &[], json!({ "audit": "k", "body": "support", "ask": "statement", "from": 0, "to": 30 * DAY, "answer_by": 9 * DAY }));
            let recs: Vec<Arc<Record>> = [law, ask, stranger, statement].into_iter().map(|v| Arc::new(serde_json::from_value::<Record>(v).expect("a record"))).collect();
            b.take_all(&recs);
            b
        };
        let mut audited = Audited::new("transfers");
        let steps: Vec<Step<()>> = audited.steps(&book, &Books);
        assert_eq!(steps.len(), 1, "the auditor's count request only: not a stranger's, not a thing it does not answer");
        assert!(audited.steps::<()>(&book, &Books).is_empty(), "answered once");
    }

    #[test]
    fn the_books_against_the_banks_record() {
        let s = Statement {
            books: vec![InBooks { id: "a".into(), amount: 100, at: 10 }, InBooks { id: "b".into(), amount: 200, at: 20 }, InBooks { id: "c".into(), amount: 300, at: 30 }, InBooks { id: "late".into(), amount: 9, at: 99 }],
            bank: vec![InBank { id: "a".into(), amount: 100, t: 11 }, InBank { id: "b".into(), amount: 190, t: 21 }, InBank { id: "d".into(), amount: 5, t: 40 }],
        };
        let r = reconcile(&s, 0, 100, 5);
        assert_eq!(r.matched, 1);
        assert_eq!(r.differ, vec![Differ { id: "b".into(), books: 200, bank: 190 }]);
        assert_eq!(r.in_books_not_bank, vec![Unmatched { id: "c".into(), amount: 300 }]);
        assert_eq!(r.in_bank_not_books, vec![Unmatched { id: "d".into(), amount: 5 }]);
        // The last stretch of the period (the grace) is not held against the books.
        assert!(!r.in_books_not_bank.iter().any(|x| x.id == "late"));
    }

    #[test]
    fn the_manifest_is_the_one_the_ts_module_wrote() {
        let ts: Value = crate::offices::testing::ts_manifest("office.auditor");
        let rust = Auditor.manifest();
        for (k, v) in ts.as_object().unwrap() {
            assert_eq!(&rust[k], v, "{k}");
        }
    }

    // A decision decided again from the file under the law's rule (ported from orchestrator/test/auditor.test.ts, the TypeScript
    // `examineDecision` being gone): it agrees or it does not, and nothing is called good or bad.
    #[test]
    fn a_decision_is_decided_again_from_the_file_under_the_laws_rule_it_agrees_or_it_does_not_and_nothing_is_called_good_or_bad() {
        let rule: PaymentRule = serde_json::from_value(json!({ "id": "pension", "payer": "outside", "account": "acc-outside", "every_days": 14, "who": { "from_age": 67 }, "amount": { "flat": 50_000 } })).expect("a rule");
        let year = 365 * DAY;
        let on = 400 * DAY;
        let file = |born_years_ago: i64, granted: bool, amount: Option<i64>, lapsed: bool| -> DecisionFile {
            let mut decision = json!({ "id": "rec.1", "at": on + 60, "on": on, "granted": granted });
            if let Some(a) = amount {
                decision["amount"] = json!(a);
                decision["every"] = json!(14 * DAY);
            }
            if !granted {
                decision["reason"] = json!("the claim could not be verified");
            }
            if lapsed {
                decision["lapsed"] = json!(true);
            }
            serde_json::from_value(json!({ "decision": decision, "claim": { "id": "rec.0", "by": "c0001", "payment": "pension", "born_at": on - born_years_ago * year, "account": "acc-c0001", "declares": {} }, "reported": [], "pays_other": false })).expect("a file")
        };
        let book = Book::new();
        let w = |c: i64| format!("${}", c / 100);
        let look = |f: &DecisionFile, rule: Option<&PaymentRule>| examine_decision(f, rule, &book, year, None, &w);
        assert_eq!(look(&file(70, true, Some(50_000), false), Some(&rule)).agrees, Some(true));
        assert_eq!(look(&file(40, false, None, false), Some(&rule)).agrees, Some(true));
        // Refused though the claim meets the law's conditions (the wrong refusal a slip makes).
        let wrong_refusal = look(&file(70, false, None, false), Some(&rule));
        assert_eq!(wrong_refusal.agrees, Some(false));
        assert!(wrong_refusal.says.contains("meets the conditions the law states"), "{}", wrong_refusal.says);
        // Granted though it does not.
        assert_eq!(look(&file(40, true, Some(50_000), false), Some(&rule)).agrees, Some(false));
        // Granted at another sum than the rule gives.
        assert!(look(&file(70, true, Some(40_000), false), Some(&rule)).says.contains("the law's rule for the payment gives"));
        // A refusal for papers that did not come is the procedure's wait, not the payment's conditions: not re-decided; no law on file: not re-decided.
        assert_eq!(look(&file(70, false, None, true), Some(&rule)).agrees, None);
        assert_eq!(look(&file(70, true, Some(50_000), false), None).agrees, None);
        for word in ["good", "bad", "fault", "wrong"] {
            assert!(!wrong_refusal.says.split(|c: char| !c.is_alphabetic()).any(|x| x == word), "{}", wrong_refusal.says);
        }
    }
}
