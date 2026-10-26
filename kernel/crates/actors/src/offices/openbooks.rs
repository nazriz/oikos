//! What stands open at an office, as its clerk reads it from the office's own papers and accounts (participants/src/
//! behaviour/openbooks.ts; docs/behaviour/office-books.md): the readers of the letting office (`firm.landlord`) and the
//! support office (`world.transfers`), and what every reader shares (`Base`, `Money`, `asked_of_us`, `owed_by_us`, the
//! small readings of loosely typed papers).
//!
//! Each reader is a plain restatement of what its module's code works out for itself wake after wake, from the same
//! papers, read the same way: nothing here decides or does anything, and nothing is read that the office's code is not
//! shown. Rewritten, not transliterated: whole numbers throughout, ordered collections, and the same papers out (the
//! clerk's `office_books` paper says what the TS clerk's says for the same books, down to the words).
//!
//! Decided fresh:
//! - A reader keeps a `Base` (the book of what it has seen, and what the account has paid and received) and nothing
//!   else unless its module needs it; `save`/`restore` keep that, so a snapshot of a run carries a clerk's reading on.
//! - A paper whose field is not what the TS read (a text where a number goes) is read as JavaScript read it where that
//!   shows (`num`, `finite`, `js`), and as nothing where TS threw (`amt`: an amount that is not one is 0 here; in TS it
//!   stopped the clerk's wake).

use super::books::{OfficeBooks, OpenHeading, OpenItem};
use crate::common::{
    addressed_to, bases_of, bill_settled, brought_forward, cites, data, made_at, money_words, notices_of, own_account, when_words, Book, Fields, DAY,
    MONTH,
};
use crate::papers::agreements::lease_terms;
use crate::{Picture, WorldInfo};
use oikos_sight::{Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub(crate) type R = Arc<Record>;

// ---------------------------------------------------------------- the small readings every reader shares

/// What a template literal writes of a value that may be absent, as JavaScript writes it ("undefined", "null").
pub fn js(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Array(a)) => a.iter().map(|x| js(Some(x))).collect::<Vec<_>>().join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// A template literal of an id or name that may be absent.
pub fn jss(s: Option<&str>) -> String {
    s.map_or_else(|| "undefined".to_string(), String::from)
}

/// `String(x ?? "").replace(/_/g, " ")`: a label written with underscores, in words.
pub fn words(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(x) => js(Some(x)).replace('_', " "),
    }
}

/// JavaScript's `Number(x)` where it is a whole number of seconds or cents: none is NaN (or not whole here).
pub fn num(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::Null => Some(0),
        Value::Bool(b) => Some(i64::from(*b)),
        Value::Number(n) => n.as_i64().or_else(|| crate::papers::lenient::whole(&Value::Number(n.clone()))),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                Some(0)
            } else {
                t.parse::<i64>().ok().or_else(|| crate::papers::lenient::whole(&Value::String(t.to_string())))
            }
        }
        _ => None,
    }
}

/// `Number.isFinite(Number(x))` of a value present and not null or empty (venues' `finite`): its number.
pub fn finite(v: Option<&Value>) -> Option<i64> {
    match v {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s.is_empty() => None,
        x => num(x),
    }
}

/// An amount in cents (money.ts `cents`): a whole number, or digits; anything else is 0 (TS threw).
pub fn amt(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => s.parse::<i64>().unwrap_or(0),
        _ => 0,
    }
}

/// A string field of a paper's data, or "" (venues' `text`).
pub fn text_of(v: Option<&Value>) -> &str {
    v.and_then(Value::as_str).unwrap_or("")
}

/// A field present at all (not `undefined`): JSON null counts, as in JavaScript.
pub fn has(d: &Value, key: &str) -> bool {
    d.get(key).is_some()
}

/// A field that a paper's reader would take as true (`!!x`).
pub fn on(d: &Value, key: &str) -> bool {
    d.get(key).is_some_and(crate::common::truthy)
}

/// Is the id on the list of those a statement is addressed to.
pub fn addressed(r: &Record, me: &str) -> bool {
    addressed_to(r).iter().any(|x| x == me)
}

/// A date in words (forms.ts `dateWords`): the place's way where it has a calendar, else "year N, day D".
pub fn date_words(t: i64, w: &WorldInfo) -> String {
    if w.calendar.is_some() {
        return when_words(t, w);
    }
    format!("year {}, day {}", t.div_euclid(crate::common::YEAR) + 1, (t % crate::common::YEAR).div_euclid(DAY) + 1)
}

/// A moment in words (common.ts `whenWords`): as `date_words`, and a moment before the year as days before it.
pub fn when(t: i64, w: &WorldInfo) -> String {
    if t < 0 {
        let n = (-t + DAY - 1) / DAY;
        return format!("{n} day{} before the year began", if n == 1 { "" } else { "s" });
    }
    date_words(t, w)
}

/// An amount in the world's money (common.ts `usd`).
pub fn usd(n: i64, w: &WorldInfo) -> String {
    money_words(n, w)
}

/// The newest of some records (the first of those made at the same moment): `.sort((x, y) => y.at - x.at)[0]`.
pub fn latest<'a>(it: impl IntoIterator<Item = &'a R>) -> Option<&'a R> {
    let mut best: Option<&R> = None;
    for r in it {
        if best.is_none_or(|b| r.at > b.at) {
            best = Some(r);
        }
    }
    best
}

/// A statement's kind-specific data, as an object (the `(r.data ?? {})` of TS).
pub fn d(r: &Record) -> &Value {
    data(r)
}

fn oldest_first(a: &OpenItem, b: &OpenItem) -> std::cmp::Ordering {
    a.since.unwrap_or(0).cmp(&b.since.unwrap_or(0)).then_with(|| a.id.cmp(&b.id))
}

/// A heading of things open, the oldest first (none when nothing is open).
pub fn heading(what: &str, mut items: Vec<OpenItem>) -> Vec<OpenHeading> {
    if items.is_empty() {
        return vec![];
    }
    items.sort_by(oldest_first);
    vec![OpenHeading { what: what.to_string(), items, always: false }]
}

/// A heading of things whose day has come and that wait on the office-holder: said in every paper (`always`).
pub fn pressing(what: &str, items: Vec<OpenItem>) -> Vec<OpenHeading> {
    heading(what, items).into_iter().map(|h| OpenHeading { always: true, ..h }).collect()
}

/// A heading of things that wait for a day: the soonest first.
pub fn by_day(what: &str, mut items: Vec<OpenItem>) -> Vec<OpenHeading> {
    if items.is_empty() {
        return vec![];
    }
    items.sort_by(|a, b| a.due.unwrap_or(i64::MAX).cmp(&b.due.unwrap_or(i64::MAX)).then_with(|| oldest_first(a, b)));
    vec![OpenHeading { what: what.to_string(), items, always: false }]
}

/// The agreement's terms, if the record is an agreement.
pub fn terms_of(a: &Record) -> Option<&oikos_contracts::blocks::AgreementTerms> {
    match &a.body {
        RecordBody::Agreement { terms } => Some(terms),
        _ => None,
    }
}

// ---------------------------------------------------------------- what any reader keeps

/// What a reader keeps: the book of what it has been shown, and what the office's own account has paid and had paid in.
#[derive(Default)]
pub struct Base {
    pub book: Book,
    pub money: Money,
}

impl Base {
    pub fn absorb(&mut self, pic: &Picture) -> Vec<R> {
        self.money.absorb(pic);
        self.book.absorb(pic)
    }
    pub fn save(&self) -> Result<Value, String> {
        Ok(json!({ "book": self.book.save(), "money": serde_json::to_value(&self.money).map_err(|e| e.to_string())? }))
    }
    pub fn restore(&mut self, saved: &Value) -> Result<(), String> {
        if saved.is_null() {
            return Ok(());
        }
        self.book = Book::restore(saved.get("book").cloned().unwrap_or(Value::Null))?;
        self.money = serde_json::from_value(saved.get("money").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// One receipt in the office's account: when, how much, and what the payer said it was for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    pub t: i64,
    pub amount: i64,
    pub memo: Option<String>,
}

/// What an organisation has seen leave and come into its own account: what settled which paper, and each receipt by payer.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Money {
    pub settled: BTreeSet<String>,
    /// Each receipt by paying account, in the order seen.
    pub received: BTreeMap<String, Vec<Receipt>>,
    pub account: Option<String>,
    pub balance: i64,
}

impl Money {
    pub fn absorb(&mut self, pic: &Picture) {
        let Some(acc) = own_account(pic) else { return };
        self.balance = acc.balance;
        for tx in pic.transactions() {
            if tx.from == acc.account {
                if let Some(s) = &tx.settles {
                    self.settled.insert(s.to_string());
                }
            }
            if tx.to == acc.account && tx.from != acc.account {
                self.received.entry(tx.from.to_string()).or_default().push(Receipt {
                    t: tx.t,
                    amount: crate::common::cents(tx.amount),
                    memo: tx.memo.clone().filter(|m| !m.is_empty()),
                });
            }
        }
        self.account = Some(acc.account);
    }
}

// ---------------------------------------------------------------- what any organisation that is asked something has open

/// The forms a body that hears a matter writes its papers on: a notice to the one complained of, their response, and
/// the decision.
pub struct Forms {
    pub notice: &'static str,
    pub response: &'static str,
    pub decision: &'static str,
}

use crate::finance::frictions::paper;

/// What any organisation that others may ask something of has open (docs/behaviour/frictions.md): a request to put
/// something right with no answer of ours; a venue's notice of a complaint against us with no answer of ours; a decision
/// against us to pay that we have not paid.
pub fn asked_of_us(book: &Book, me: &str, money: &Money, extra: &[Forms], w: &WorldInfo) -> Vec<OpenHeading> {
    let answers: Vec<&R> = book.all(paper::ANSWER).filter(|r| r.speaks_for.as_deref() == Some(me)).collect();
    let mut requests = vec![];
    for r in book.open(paper::REQUEST) {
        if !addressed(r, me) || answers.iter().any(|a| cites(a, &r.id) || d(a).s("request") == Some(&r.id)) {
            continue;
        }
        let x = d(r);
        let line = format!(
            "{}: {} asks us to put right {}{}{}{}, asked {}, not answered",
            r.id,
            jss(r.speaks_for.as_deref()),
            if x.get("matter").is_some_and(|m| !m.is_null()) { words(x.get("matter")) } else { "something".into() },
            if on(x, "structure") { format!(" at {}", js(x.get("structure"))) } else { String::new() },
            if on(x, "about") { format!(" (about {})", js(x.get("about"))) } else { String::new() },
            if has(x, "amount") { format!(", {}", usd(amt(x.get("amount")), w)) } else { String::new() },
            when(made_at(r), w),
        );
        requests.push(OpenItem::new(r.id, line).since(made_at(r)).amount(has(x, "amount").then(|| amt(x.get("amount")))));
    }
    let mut all = vec![Forms { notice: paper::NOTICE, response: paper::RESPONSE, decision: paper::DECISION }];
    all.extend(extra.iter().map(|f| Forms { notice: f.notice, response: f.response, decision: f.decision }));
    let (mut notices, mut decisions) = (vec![], vec![]);
    for f in &all {
        let ours: Vec<&R> = book.all(f.response).filter(|r| r.speaks_for.as_deref() == Some(me)).collect();
        for n in book.open(f.notice) {
            let x = d(n);
            let Some(app) = x.s("application") else { continue };
            if !addressed(n, me) || x.s("against") != Some(me) || ours.iter().any(|r| cites(r, app) || d(r).s("application") == Some(app)) {
                continue;
            }
            if book.all(f.decision).any(|y| d(y).s("application") == Some(app) || cites(y, app)) {
                continue;
            }
            let by = if x.get("answer_by").is_some_and(|v| !v.is_null()) { num(x.get("answer_by")) } else { num(x.get("hearing_at")) };
            let line = format!(
                "{}: {} tells us of {}'s complaint ({}, application {}){}, not answered",
                n.id,
                jss(n.speaks_for.as_deref()),
                if x.get("applicant").is_some_and(|v| !v.is_null()) { js(x.get("applicant")) } else { "someone".into() },
                words(x.get("matter")),
                app,
                by.map_or(String::new(), |b| format!(", to be answered by {}", date_words(b, w))),
            );
            notices.push(OpenItem::new(n.id, line).since(made_at(n)));
        }
        for y in book.open(f.decision) {
            let x = d(y);
            if x.s("against") != Some(me) || x.s("finding") != Some("pay") || money.settled.contains(y.id.as_str()) {
                continue;
            }
            let line = format!(
                "{}: {} {} that we pay {} {}{}, not paid",
                y.id,
                jss(y.speaks_for.as_deref()),
                if x.get("binding") == Some(&Value::Bool(false)) { "recommends" } else { "orders" },
                if x.get("applicant").is_some_and(|v| !v.is_null()) { js(x.get("applicant")) } else { "the applicant".into() },
                usd(amt(x.get("amount")), w),
                finite_present(x.get("due")).map_or(String::new(), |b| format!(" by {}", date_words(b, w))),
            );
            decisions.push(OpenItem::new(y.id, line).since(y.at).amount(has(x, "amount").then(|| amt(x.get("amount")))));
        }
    }
    [
        heading("Requests to put something right, not answered", requests),
        heading("Complaints against us before a body that hears them, not answered", notices),
        heading("Decisions against us to pay, not paid", decisions),
    ]
    .concat()
}

/// `Number.isFinite(Number(x))` as TS wrote it for a field that may be absent: absent is not finite.
fn finite_present(v: Option<&Value>) -> Option<i64> {
    match v {
        None => None,
        x => num(x),
    }
}

/// Invoices addressed to us and sums recorded against us (a fine, rates) that we have not been seen to pay.
pub fn owed_by_us(book: &Book, me: &str, money: &Money, w: &WorldInfo) -> Vec<OpenHeading> {
    let mut invoices = vec![];
    for r in book.open("invoice") {
        let m = d(r).get("outcome").and_then(|o| o.get("money"));
        if !addressed(r, me) || !m.is_some_and(crate::common::truthy) || money.settled.contains(r.id.as_str()) {
            continue;
        }
        let a = amt(m.and_then(|m| m.get("amount")));
        let line = format!("{}: invoice from {} for {}, dated {}, not paid", r.id, r.speaks_for.unwrap_or_else(|| r.author.clone().into()), usd(a, w), when(made_at(r), w));
        invoices.push(OpenItem::new(r.id, line).since(made_at(r)).amount(Some(a)));
    }
    let mut sums = vec![];
    for r in book.of_type("claim") {
        let RecordBody::Claim { position, holder, counterparty, about } = &r.body else { continue };
        let kind = about.s("kind").unwrap_or("");
        if *position != oikos_contracts::blocks::Position::Right
            || counterparty.as_deref() != Some(me)
            || !["fine", "tax_penalty", "rates", "rates_interest"].contains(&kind)
            || bill_settled(book, r, &money.settled)
            || book.released(&r.id)
        {
            continue;
        }
        let a = amt(about.get("amount"));
        let notices = notices_of(book, r);
        let line = format!(
            "{}: {} of {} recorded against us by {}{}, not paid{}",
            r.id,
            kind.replace('_', " "),
            usd(a, w),
            holder,
            finite_present(about.get("due")).map_or(String::new(), |b| format!(", due {}", date_words(b, w))),
            if notices.is_empty() {
                String::new()
            } else {
                format!(" (one bill: the city's notice for it is {}, and paying either settles it)", notices.iter().map(|n| n.id.as_str()).collect::<Vec<_>>().join(", "))
            }
        );
        sums.push(OpenItem::new(r.id, line).since(r.at).amount(Some(a)));
    }
    [heading("Invoices addressed to us, not paid", invoices), heading("Sums recorded against us (rates, fines), not paid", sums)].concat()
}

/// When rent under a lease first falls due, counted from when the lease begins (`begins`): the day the lease itself
/// names (`attrs.first_due`, so long after it begins: a tenancy's own rent day), or the day it begins.
pub fn first_due_of(a: &Record, begins: i64) -> i64 {
    let fd = terms_of(a).and_then(|t| t.attrs.as_ref()).and_then(|x| x.get("first_due")).and_then(Value::as_i64).filter(|n| *n > 0).unwrap_or(0);
    begins + fd
}

// ---------------------------------------------------------------- the readers

enum Which {
    Landlord { notice_days: i64 },
    Support,
}

struct Reader {
    me: String,
    which: Which,
    base: Base,
}

/// The reader of the books of `firm.landlord` and `world.transfers`, if `of` is one of them.
pub fn reader(of: &str, me: &str, _office: &str, params: &serde_json::Map<String, Value>) -> Option<Box<dyn OfficeBooks>> {
    let which = match of {
        "firm.landlord" => Which::Landlord { notice_days: params.get("landlord_notice_days").map_or(Some(60), |v| num(Some(v))).unwrap_or(60) },
        "world.transfers" => Which::Support,
        _ => return None,
    };
    Some(Box::new(Reader { me: me.to_string(), which, base: Base::default() }))
}

impl OfficeBooks for Reader {
    fn absorb(&mut self, pic: &Picture) {
        self.base.absorb(pic);
    }
    fn open(&self, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
        match &self.which {
            Which::Landlord { notice_days } => landlord(&self.base, &self.me, *notice_days, t, w),
            Which::Support => support(&self.base, &self.me, w),
        }
    }
    fn save(&self) -> Result<Value, String> {
        self.base.save()
    }
    fn restore(&mut self, saved: &Value) -> Result<(), String> {
        self.base.restore(saved)
    }
}

/// A landlord's letting office (firm.landlord): the rent book (what has fallen due under each lease in force against
/// what has come in from the tenant's account since its rent began), tenancies near their end with nothing offered,
/// homes listed and unlet, applications and tenants' requests not answered, repairs ordered and not done, and what the
/// landlord itself owes.
fn landlord(base: &Base, me: &str, notice_days: i64, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
    let (book, money) = (&base.book, &base.money);
    let leases: Vec<&R> = book
        .of_type("agreement")
        .filter(|r| terms_of(r).is_some_and(|x| x.template.as_deref() == Some("lease") && x.parties.first().map(String::as_str) == Some(me)))
        .collect();
    let active: Vec<&R> = leases.iter().copied().filter(|a| book.in_force(&a.id)).collect();
    let tenant_of = |a: &Record| -> String { terms_of(a).and_then(|x| x.parties.iter().find(|p| p.as_str() != me)).cloned().unwrap_or_default() };
    let increases: Vec<&R> = book.open("rent_increase").filter(|r| r.speaks_for.as_deref() == Some(me)).collect();
    let rent_at = |a: &Record, at: i64| -> i64 {
        let mut best: Option<(&R, i64)> = None;
        for r in &increases {
            let x = d(r);
            let Some(from) = num(x.get("from")) else { continue };
            if x.s("lease") == Some(a.id.as_str()) && from <= at && best.is_none_or(|(_, b)| from > b) {
                best = Some((r, from));
            }
        }
        match best.and_then(|(r, _)| d(r).get("rent")).filter(|v| !v.is_null()) {
            Some(v) => amt(Some(v)),
            None => lease_terms(a, &tenant_of(a)).rent,
        }
    };
    let mut paying: BTreeMap<String, Option<String>> = BTreeMap::new();
    for r in book.all("rental_application") {
        if let Some(s) = r.speaks_for.as_ref().filter(|s| !s.is_empty()) {
            paying.entry(s.to_string()).or_insert_with(|| d(r).s("account").map(String::from));
        }
    }
    for a in &leases {
        let tenant = tenant_of(a);
        let from = terms_of(a)
            .and_then(|x| x.commitments.iter().find(|c| c.who == tenant))
            .and_then(|c| c.does.get("outcome")?.get("money")?.get("from")?.as_str())
            .map(String::from);
        if let Some(from) = from {
            if !tenant.is_empty() && paying.get(&tenant).and_then(Option::as_ref).is_none_or(|s| s.is_empty()) {
                paying.insert(tenant, Some(from));
            }
        }
    }
    let noticed = |a: &Record| book.notices(&a.id).next().is_some();
    // ---- the rent book ----
    let mut arrears = vec![];
    let mut asked: BTreeMap<&str, i64> = BTreeMap::new(); // a lease -> when we last wrote to ask for the rent owed under it
    for r in book.all(paper::REQUEST) {
        if r.speaks_for.as_deref() == Some(me) && d(r).s("matter") == Some("arrears") {
            if let Some(about) = d(r).s("about") {
                asked.insert(about, r.at);
            }
        }
    }
    // ---- tenancies being ended for arrears under the law on possession (docs/behaviour/justice.md, "Possession"):
    // where each has got to, by the papers on file, and what the law's procedure has next. ----
    let law = latest(book.open("law").filter(|r| d(r).s("tenancy") == Some("possession")));
    let mut ending = vec![];
    let mut behind_under: BTreeMap<&str, i64> = BTreeMap::new();
    // (A tenant given notice to vacate who has gone gives notice on the lease as they go: the home is given up from
    // that day, whatever the lease's own notice period then says of when it ends on the record. The rent book stops
    // there: what was owed on the day they left is what is owed.)
    let mut vacated: BTreeMap<&str, i64> = BTreeMap::new();
    for a in &leases {
        let tenant = tenant_of(a);
        let went = book.notices(&a.id).filter(|n| n.party == tenant).map(|n| n.at).min();
        if let Some(went) = went {
            if book.all("notice_to_vacate").any(|r| r.speaks_for.as_deref() == Some(me) && d(r).s("lease") == Some(a.id.as_str()) && r.at <= went) {
                vacated.insert(a.id.as_str(), went);
            }
        }
    }
    let mut gone = vec![];
    for a in leases.iter().filter(|x| book.in_force(&x.id) || vacated.contains_key(x.id.as_str())) {
        let tenant = tenant_of(a);
        // (A lease that renews one of ours: its rent runs from the end of that one's term.)
        let begins = bases_of(a).iter().filter(|b| leases.iter().any(|x| &x.id == *b)).map(|b| book.ends_at(b).unwrap_or(0)).chain([book.signed_at(&a.id).unwrap_or(a.at), 0]).max().unwrap_or(0);
        let since = first_due_of(a, begins);
        // (Rent owed when the year began, by our statement of the rent account: owed with the rest, and the oldest.)
        let carried = brought_forward(book, me, &a.id);
        if t < since && carried.is_none() {
            continue;
        }
        let left_at = vacated.get(a.id.as_str()).copied();
        let due = if t < since { 0 } else { (t.min(left_at.unwrap_or(t)) - since).div_euclid(MONTH) + 1 };
        let mut owed = carried.as_ref().map_or(0, |c| c.0);
        for k in 0..due {
            owed += rent_at(a, since + k * MONTH);
        }
        let account = paying.get(&tenant).and_then(Option::as_ref).filter(|s| !s.is_empty());
        let receipts: Vec<&Receipt> = account.and_then(|ac| money.received.get(ac)).map_or(vec![], |v| v.iter().filter(|x| x.t >= begins).collect());
        let paid: i64 = receipts.iter().map(|x| x.amount).sum();
        let last = receipts.last();
        let rent = rent_at(a, t);
        let behind = owed - paid;
        let lt = lease_terms(a, &tenant);
        if let Some(left) = left_at {
            let applied = latest(book.open("tribunal_application").filter(|r| r.speaks_for.as_deref() == Some(me) && d(r).s("kind") == Some("possession") && d(r).s("about") == Some(a.id.as_str())));
            let decided = applied.is_some_and(|ap| book.all("tribunal_order").any(|o| d(o).s("application") == Some(ap.id.as_str())));
            let ends = book.ends_at(&a.id);
            // (It stands in the book while the lease is still on the record, or an application about it is undecided.)
            if !book.in_force(&a.id) && !applied.is_some_and(|_| !decided) {
                continue;
            }
            let undecided = applied.filter(|_| !decided);
            let line = format!(
                "{}: {} gave notice on the lease {}, after our notice to vacate, and has given up {}: the tenancy is over{}; {}{}",
                a.id,
                tenant,
                date_words(left, w),
                lt.space.as_deref().unwrap_or("the home"),
                match ends {
                    Some(e) if e > t => format!(" (on the record the lease runs out {})", date_words(e, w)),
                    _ => String::new(),
                },
                if behind > 0 { format!("{} of rent was owed under it when they left, and is still owed", usd(behind, w)) } else { "no rent is owed under it".to_string() },
                match undecided {
                    Some(ap) => format!(
                        "; our application for possession {} ({}) still stands at the tribunal, undecided{}",
                        ap.id,
                        date_words(ap.at, w),
                        law.map_or(String::new(), |l| format!(": {} gives possession only where the tenant has not left", l.id))
                    ),
                    None => String::new(),
                }
            );
            gone.push(OpenItem::new(a.id, line).since(left).amount((behind > 0).then_some(behind)));
            continue;
        }
        if rent <= 0 || behind < rent {
            continue;
        }
        // (The day the oldest rent not yet paid fell due; a rent less than a week late is not yet in the book as arrears.)
        let rents = behind.div_euclid(rent);
        // (What was owed as the year began is the oldest, while any of it stands.)
        let oldest = match &carried {
            Some(c) if paid < c.0 => c.1 + paid.div_euclid(rent) * MONTH,
            _ => since + (due - rents) * MONTH,
        };
        if t - oldest < 7 * DAY {
            continue;
        }
        behind_under.insert(a.id.as_str(), behind);
        let line = format!(
            "{}: {}{}, is {} behind with the rent ({} rent{} of {}), since {}{}; {}{}{}",
            a.id,
            tenant,
            lt.space.as_ref().map_or(String::new(), |s| format!(", {s}")),
            usd(behind, w),
            rents,
            if rents == 1 { "" } else { "s" },
            usd(rent, w),
            when(oldest, w),
            match &carried {
                Some(c) if paid < c.0 => format!(" ({} of it stood on the rent account as the year began: {})", usd(c.0, w), c.2),
                _ => String::new(),
            },
            match last {
                Some(l) => format!(
                    "the last payment from {} came {} ({}{})",
                    account.map_or("undefined", String::as_str),
                    date_words(l.t, w),
                    usd(l.amount, w),
                    l.memo.as_ref().map_or(String::new(), |m| format!(", \"{m}\""))
                ),
                None => "nothing has come from the tenant's account under this lease".to_string(),
            },
            asked.get(a.id.as_str()).map_or(String::new(), |at| format!("; we wrote to ask for it {}", date_words(*at, w))),
            if noticed(a) { "; notice has been given on the lease" } else { "" },
        );
        arrears.push(OpenItem::new(a.id, line).since(oldest).amount(Some(behind)));
    }
    if let Some(law) = law {
        for a in &leases {
            let tenant = tenant_of(a);
            if book.all("warrant_executed").any(|x| d(x).s("lease") == Some(a.id.as_str())) {
                continue; // (carried out: over)
            }
            let left = book.notices(&a.id).any(|n| n.party == tenant);
            let vacate = latest(book.open("notice_to_vacate").filter(|r| r.speaks_for.as_deref() == Some(me) && d(r).s("lease") == Some(a.id.as_str())));
            // (An application we have withdrawn is no longer before the tribunal: it is not shown as waiting.)
            let applied = latest(
                book.all("tribunal_application")
                    .filter(|r| r.speaks_for.as_deref() == Some(me) && d(r).s("kind") == Some("possession") && d(r).s("about") == Some(a.id.as_str()) && !book.withdrawn(&r.id)),
            );
            let order = latest(book.all("tribunal_order").filter(|o| d(o).s("kind") == Some("possession") && d(o).s("applicant") == Some(me) && d(o).s("about") == Some(a.id.as_str())));
            if (vacate.is_none() && applied.is_none() && order.is_none()) || left || (!book.in_force(&a.id) && order.is_none()) {
                continue;
            }
            let now = behind_under.get(a.id.as_str()).copied();
            let owes = match now {
                Some(n) => format!("{tenant} is {} behind now", usd(n, w)),
                None => format!("{tenant} is less than a rent behind now"),
            };
            let home = lease_terms(a, &tenant).space.unwrap_or_else(|| "the home".to_string());
            let decided = order.filter(|o| applied.is_none_or(|ap| o.at >= ap.at));
            let (since, stage);
            if let Some(dec) = decided.filter(|o| d(o).s("finding") == Some("possession")) {
                let due = finite_present(d(dec).get("due")).unwrap_or(0);
                let asked = latest(book.all("warrant_request").filter(|r| r.speaks_for.as_deref() == Some(me) && d(r).s("order") == Some(dec.id.as_str())));
                let warrant = latest(book.all("warrant").filter(|x| d(x).s("order") == Some(dec.id.as_str())));
                let lapsed = warrant.is_some_and(|wt| book.all("warrant_lapsed").any(|x| d(x).s("lease") == Some(a.id.as_str()) && x.at >= wt.at));
                since = dec.at;
                stage = format!("the tribunal ordered possession of {home} by {} ({})", date_words(due, w), dec.id)
                    + &if lapsed {
                        format!("; the warrant {} ran out without being carried out; by {} another may be asked of the tribunal's registrar", warrant.map_or("", |x| x.id.as_str()), law.id)
                    } else if let Some(wt) = warrant {
                        format!(
                            "; a warrant is out ({}), to be carried out by {} by those who enforce the tribunal's orders, and by nobody else",
                            wt.id,
                            date_words(finite_present(d(wt).get("until")).unwrap_or(0), w)
                        )
                    } else if let Some(k) = asked {
                        format!("; a warrant was asked of the tribunal's registrar {} ({}) and has not been issued", date_words(k.at, w), k.id)
                    } else if t >= due + DAY {
                        format!("; that date has passed and the tenant has not left; by {} a warrant may be asked of the tribunal's registrar, and nobody else may put them out", law.id)
                    } else {
                        "; if the tenant is still there a day after that date, a warrant may be asked of the tribunal's registrar".to_string()
                    };
            } else if let Some(dec) = decided.filter(|o| d(o).s("finding") == Some("plan")) {
                since = dec.at;
                stage = format!(
                    "the tribunal set a plan to pay {} ({}): the rent as it falls due and {} a month toward what is owed; if it is not kept, the landlord may apply again for possession",
                    date_words(dec.at, w),
                    dec.id,
                    usd(amt(d(dec).get("instalment")), w)
                );
            } else if decided.is_some() {
                continue; // (dismissed: it begins again only if they fall behind)
            } else if let Some(ap) = applied {
                // What has changed since the application, as this office's own papers and rent book show it: what is
                // owed now beside what the application said; what the tenant has answered the tribunal, and whether we
                // have replied; terms we have come to with the tenant since. And what is ordinarily done where the
                // arrears are cleared: said as the practice it is, never as what to do.
                since = ap.at;
                let ad = d(ap);
                let said = has(ad, "amount").then(|| amt(ad.get("amount")));
                let mut changed: Vec<String> = vec![];
                match (now, said) {
                    (None, s) => changed.push(format!("{}the rent book shows less than a rent owed now", s.map_or(String::new(), |s| format!("the application said {} was owed; ", usd(s, w))))),
                    (Some(n), Some(s)) if n != s => changed.push(format!("the application said {} was owed; the rent book shows {} now", usd(s, w), usd(n, w))),
                    _ => {}
                }
                let answer = latest(book.all("tribunal_response").filter(|r| r.speaks_for.as_deref() == Some(tenant.as_str()) && words_app(d(r)) == ap.id));
                if let Some(ans) = answer {
                    let replied = book.all("tribunal_reply").any(|r| r.speaks_for.as_deref() == Some(me) && words_app(d(r)) == ap.id && r.at >= ans.at);
                    let ax = d(ans);
                    changed.push(format!(
                        "{} answered the tribunal {} ({}){}; {}",
                        tenant,
                        date_words(ans.at, w),
                        ans.id,
                        if on(ax, "left") {
                            ", saying they have left".to_string()
                        } else if has(ax, "offer") {
                            if amt(ax.get("offer")) > 0 {
                                format!(", offering {} a month toward what is owed", usd(amt(ax.get("offer")), w))
                            } else {
                                ", saying they can pay nothing toward what is owed".to_string()
                            }
                        } else {
                            String::new()
                        },
                        if replied { "we have replied" } else { "we have not replied (reply to a tenant's answer form)" }
                    ));
                }
                let mut terms: Vec<String> = vec![];
                for r in book.all("plan_answer") {
                    if r.speaks_for.as_deref() == Some(tenant.as_str()) && d(r).s("lease") == Some(a.id.as_str()) && d(r).get("accepts") == Some(&Value::Bool(true)) && r.at >= ap.at {
                        terms.push(format!("{tenant} accepted our offer of a plan {} ({})", date_words(r.at, w), r.id));
                    }
                }
                for r in book.all("variation_answer") {
                    if r.speaks_for.as_deref() == Some(me) && addressed(r, &tenant) && d(r).get("granted") == Some(&Value::Bool(true)) && r.at >= ap.at {
                        terms.push(format!("we granted {tenant}'s request {} ({})", date_words(r.at, w), r.id));
                    }
                }
                if !terms.is_empty() {
                    changed.push(format!("since the application {}", terms.join(", and ")));
                }
                stage = format!(
                    "we applied to the tribunal for possession {} ({}); it has not decided{}{}",
                    if on(ad, "brought_forward") { "before the year began".to_string() } else { date_words(ap.at, w) },
                    ap.id,
                    if changed.is_empty() { String::new() } else { format!(". Since the application: {}", changed.join("; ")) },
                    if now.is_none() || !terms.is_empty() { ". An application stands until it is decided or withdrawn; where the rent owed has been paid or terms agreed, landlords ordinarily withdraw it" } else { "" }
                );
            } else {
                let vc = vacate.expect("a notice to vacate, or an application or an order");
                let by = num(d(vc).get("by")).unwrap_or(0);
                since = vc.at;
                let given = if d(vc).get("given").is_some_and(|v| !v.is_null()) { num(d(vc).get("given")).unwrap_or(0) } else { vc.at };
                stage = format!(
                    "notice to vacate given {} ({}), to leave by {}; {}",
                    when(given, w),
                    vc.id,
                    when(by, w),
                    if now.is_none() {
                        format!("the arrears are paid, so by {} the notice lapses", law.id)
                    } else if t >= by {
                        format!("that date has passed and the tenant has not left; by {} the landlord may now apply to the tribunal for possession, and may not put them out", law.id)
                    } else {
                        "paid before then it lapses; still there and behind after it, the landlord may apply to the tribunal for possession".to_string()
                    }
                );
            }
            ending.push(OpenItem::new(a.id, format!("{}: {home}; {owes}; {stage}", a.id)).since(since).amount(now));
        }
    }
    // ---- tenancies near their end ----
    let mut closing = vec![];
    for a in &active {
        let ends = book.ends_at(&a.id);
        let Some(ends) = ends else { continue };
        if terms_of(a).is_some_and(|x| x.then.as_deref() == Some("periodic")) || ends - t > notice_days * DAY || noticed(a) {
            continue;
        }
        if leases.iter().any(|x| x.id != a.id && cites(x, &a.id) && tenant_of(x) == tenant_of(a)) {
            continue;
        }
        let tenant = tenant_of(a);
        let line = format!(
            "{}: the tenancy of {}{} ends {}; no new lease has been offered and no notice given",
            a.id,
            tenant,
            lease_terms(a, &tenant).space.map_or(String::new(), |s| format!(" at {s}")),
            date_words(ends, w)
        );
        closing.push(OpenItem::new(a.id, line).since(ends));
    }
    // ---- homes to let ----
    let listings: Vec<&R> = book.open("rental_listing").filter(|l| l.speaks_for.as_deref() == Some(me)).collect();
    let offered_on = |id: &str| leases.iter().any(|x| cites(x, id));
    let unlet: Vec<OpenItem> = listings
        .iter()
        .filter(|l| t - l.at >= MONTH)
        .map(|l| {
            let x = d(l);
            OpenItem::new(
                l.id,
                format!("{}: {} has been listed at {} a month since {} and is not let", l.id, js(x.get("space")), usd(amt(x.get("rent")), w), date_words(l.at, w)),
            )
            .since(l.at)
        })
        .collect();
    let applications: Vec<OpenItem> = book
        .open("rental_application")
        .filter(|r| addressed(r, me) && !offered_on(&r.id) && listings.iter().any(|l| Some(l.id.as_str()) == d(r).s("listing")))
        .map(|r| {
            let x = d(r);
            let what = listings.iter().find(|l| Some(l.id.as_str()) == x.s("listing")).and_then(|l| d(l).get("space")).filter(|v| crate::common::truthy(v)).map_or_else(|| js(x.get("listing")), |v| js(Some(v)));
            let people = x.get("household").and_then(|h| h.get("people")).filter(|v| crate::common::truthy(v));
            OpenItem::new(
                r.id,
                format!(
                    "{}: {} applied {} for {}{}; no lease offered",
                    r.id,
                    jss(r.speaks_for.as_deref()),
                    date_words(r.at, w),
                    what,
                    people.map_or(String::new(), |p| format!(" (a household of {})", js(Some(p))))
                ),
            )
            .since(r.at)
        })
        .collect();
    // ---- asked of us by tenants ----
    let varied: Vec<&R> = book.all("variation_answer").filter(|r| r.speaks_for.as_deref() == Some(me)).collect();
    let variations: Vec<OpenItem> = book
        .open("variation_request")
        .filter(|r| addressed(r, me) && !varied.iter().any(|a| cites(a, &r.id)))
        .map(|r| {
            let said: String = crate::common::text(r).chars().take(120).collect();
            OpenItem::new(
                r.id,
                format!(
                    "{}: {} asks, {}: \"{}\"{}; not answered",
                    r.id,
                    jss(r.speaks_for.as_deref()),
                    date_words(r.at, w),
                    said,
                    if on(d(r), "about") { format!(" (about {})", js(d(r).get("about"))) } else { String::new() }
                ),
            )
            .since(r.at)
        })
        .collect();
    // ---- repairs ----
    let finished: Vec<&R> = book.all("repair_done").chain(book.all("repair_declined")).collect();
    let repairs: Vec<OpenItem> = book
        .open("repair_order")
        .filter(|r| r.speaks_for.as_deref() == Some(me) && !finished.iter().any(|x| d(x).get("structure") == d(r).get("structure") && x.at >= r.at))
        .map(|r| OpenItem::new(r.id, format!("{}: the repair of {} was ordered {} and is not reported done", r.id, js(d(r).get("structure")), date_words(r.at, w))).since(r.at))
        .collect();
    // ---- a tenant's death registered, the lease still standing ----
    let dead: BTreeSet<String> = book.all("death_registration").chain(book.all("death_certificate")).map(|r| js(d(r).get("deceased"))).collect();
    let estates: Vec<OpenItem> = active
        .iter()
        .filter(|a| dead.contains(&tenant_of(a)) && !noticed(a))
        .map(|a| OpenItem::new(a.id, format!("{}: the tenant {} is registered as having died; the lease still stands", a.id, tenant_of(a))).since(a.at))
        .collect();
    [
        heading("Rent in arrears", arrears),
        heading("Tenants who have left on our notice to vacate: tenancies over", gone),
        heading("Tenancies being ended for arrears under the law on possession, and where each has got to", ending),
        heading("Tenancies ending with nothing offered", closing),
        heading("Applications for a home, not answered", applications),
        heading("Tenants' requests to vary something, not answered", variations),
        asked_of_us(book, me, money, &[Forms { notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" }], w),
        heading("Homes listed a month or more and not let", unlet),
        heading("Repairs ordered and not reported done", repairs),
        heading("Tenants who have died, their leases still standing", estates),
        owed_by_us(book, me, money, w),
    ]
    .concat()
}

/// `String(r.data?.application ?? "")`.
fn words_app(x: &Value) -> String {
    match x.get("application") {
        None | Some(Value::Null) => String::new(),
        v => js(v),
    }
}

/// The support office (world.transfers), for whoever holds it: what its staff have put before them and is not yet
/// decided, and what is asked of the office (a review of a refusal, a complaint before a body that hears them). The
/// claims the law's conditions settle, and their payment, are the staff's, and are in the staff's own report.
fn support(base: &Base, me: &str, w: &WorldInfo) -> Vec<OpenHeading> {
    let (book, money) = (&base.book, &base.money);
    let decided: BTreeSet<String> = book.all("benefit_decision").filter(|r| r.speaks_for.as_deref() == Some(me)).map(|r| js(d(r).get("claim"))).collect();
    let mut cases = vec![];
    for r in book.open("case_for_decision") {
        let x = d(r);
        let Some(claim) = x.s("claim") else { continue };
        if r.speaks_for.as_deref() != Some(me) || decided.contains(claim) {
            continue;
        }
        let line = format!(
            "{claim}: {}'s claim for {} support, put before the office-holder {} ({}): {}; not decided",
            js(x.get("claimant")),
            js(x.get("payment")),
            date_words(r.at, w),
            r.id,
            js(x.get("fails"))
        );
        cases.push(OpenItem::new(claim, line).since(r.at).amount(has(x, "amount").then(|| amt(x.get("amount")))));
    }
    // What a claim waits for (foundations F8): the papers and confirmations the office has asked for, not yet come, with
    // the day each is due by.
    let came: BTreeSet<String> = ["evidence", "confirmation_answer"]
        .iter()
        .flat_map(|k| book.open(k))
        .filter(|r| addressed(r, me) && d(r).s("claim").is_some())
        .map(|r| format!("{}|{}", js(d(r).get("claim")), js(d(r).get("need"))))
        .collect();
    let mut asked: Vec<&R> = ["evidence_request", "confirmation_request"]
        .iter()
        .flat_map(|k| book.open(k))
        .filter(|r| {
            let x = d(r);
            r.speaks_for.as_deref() == Some(me) && x.s("claim").is_some_and(|c| !decided.contains(c)) && !came.contains(&format!("{}|{}", js(x.get("claim")), js(x.get("need"))))
        })
        .collect();
    asked.sort_by(|a, b| {
        let by = |r: &R| num(d(r).get("by")).unwrap_or(0);
        by(a).cmp(&by(b)).then_with(|| a.id.cmp(&b.id))
    });
    let waiting: Vec<OpenItem> = asked
        .into_iter()
        .map(|r| {
            let x = d(r);
            let by = finite_present(x.get("by"));
            let who = if matches!(&r.body, RecordBody::Statement { kind, .. } if kind == "evidence_request") { "the claimant".to_string() } else { addressed_to(r).first().map(|x| x.to_string()).unwrap_or_else(|| "the last employer".into()) };
            let line = format!(
                "{}: {} was asked {} for {} ({}), due by {}; not yet answered",
                js(x.get("claim")),
                who,
                date_words(r.at, w),
                js(x.get("what")),
                r.id,
                by.map_or("no day given".to_string(), |b| date_words(b, w))
            );
            OpenItem::new(r.id, line).since(r.at).due(by)
        })
        .collect();
    [
        heading("Claims waiting for papers or a confirmation asked for, not yet come", waiting),
        heading("Claims the staff have put before the office-holder, not decided", cases),
        asked_of_us(book, me, money, &[Forms { notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" }], w),
    ]
    .concat()
}

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_sight::{Observation, View};

    const DAY: i64 = 86_400;
    const MONTH: i64 = 30 * DAY;

    fn world() -> WorldInfo {
        let currency = oikos_sight::calls::Currency { code: "XTS".into(), symbol: Some("$".into()), minor_units: 2, ..Default::default() };
        WorldInfo { currency: Some(currency), ..Default::default() }
    }

    /// A reader's feed, as an actor is shown things: each observation is applied to a view.
    struct Feed {
        view: View,
        entity: String,
        r: Box<dyn OfficeBooks>,
    }
    impl Feed {
        fn new(of: &str, entity: &str) -> Feed {
            Feed { view: View::default(), entity: entity.into(), r: reader(of, entity, entity, &Default::default()).expect("a reader") }
        }
        fn absorb(&mut self, t: i64, records: Vec<Value>, bank: Option<(Vec<Value>, Vec<Value>)>) {
            let mut channels = json!({ "records": { "kind": "records", "records": records } });
            if let Some((accounts, transactions)) = bank {
                channels["bank"] = json!({ "kind": "accounts", "accounts": accounts, "transactions": transactions });
            }
            let obs: Observation = serde_json::from_value(json!({
                "participant": "p.x", "t": t, "status": "active", "outcomes": [], "inbox": [], "drafts": [], "channels": channels,
            }))
            .expect("an observation");
            let pic = self.view.apply(obs, None, &self.entity, "cadence", DAY);
            self.r.absorb(&pic);
        }
        fn open(&self, t: i64) -> Vec<OpenHeading> {
            self.r.open(t, &world())
        }
    }

    fn head<'a>(h: &'a [OpenHeading], what: &str) -> Option<&'a OpenHeading> {
        h.iter().find(|x| x.what == what)
    }
    fn ids(h: &OpenHeading) -> Vec<&str> {
        h.items.iter().map(|x| x.id.as_str()).collect()
    }
    fn st(id: &str, at: i64, kind: &str, speaks_for: &str, x: Value) -> Value {
        let mut r = json!({ "id": id, "at": at, "author": format!("{speaks_for}-x"), "record": "statement", "speaks_for": speaks_for, "visible_to": "public", "kind": kind, "text": id });
        for (k, v) in x.as_object().cloned().unwrap_or_default() {
            r[k] = v;
        }
        r
    }
    fn lease(id: &str, tenant: &str, rent: i64, attrs: Option<Value>) -> Value {
        let mut terms = json!({ "template": "lease", "parties": ["landlord-1", tenant], "term": 400 * DAY, "text": format!("{tenant} rents home apts-1/dwelling.1 from landlord-1."),
            "commitments": [{ "who": "landlord-1", "does": { "outcome": { "occupancy": { "who": tenant, "in": "apts-1/dwelling.1" } } } },
                { "who": tenant, "does": { "outcome": { "money": { "from": format!("acc-{tenant}"), "to": "acc-landlord-1", "amount": rent.to_string(), "for": "rent" } } }, "every": MONTH }] });
        if let Some(a) = attrs {
            terms["attrs"] = a;
        }
        json!({ "id": id, "at": 0, "author": "genesis", "record": "agreement", "visible_to": ["landlord-1", tenant], "terms": terms })
    }
    fn signed(id: &str, tenant: &str) -> Vec<Value> {
        ["landlord-1", tenant].iter().map(|p| json!({ "id": format!("{id}-sig-{p}"), "at": 0, "author": "genesis", "record": "signature", "visible_to": ["landlord-1", tenant], "speaks_for": p, "agreement": id, "as": p })).collect()
    }
    fn account() -> Vec<Value> {
        vec![json!({ "account": "acc-landlord-1", "holder": "landlord-1", "custodian": "bank", "currency": "XTS", "balance": "0" })]
    }
    fn paid(t: i64, tenant: &str, amount: i64, memo: Option<&str>) -> Value {
        let mut x = json!({ "t": t, "from": format!("acc-{tenant}"), "to": "acc-landlord-1", "amount": amount.to_string(), "currency": "XTS", "by": "x" });
        if let Some(m) = memo {
            x["memo"] = json!(m);
        }
        x
    }
    fn cat(a: Vec<Value>, b: Vec<Value>) -> Vec<Value> {
        a.into_iter().chain(b).collect()
    }

    #[test]
    fn the_rent_a_lease_names_its_own_day_for_is_counted_from_that_day() {
        let with = |a: Value| -> Record { serde_json::from_value(lease("l", "t", 1, Some(a))).unwrap() };
        assert_eq!(first_due_of(&with(json!({ "first_due": 12 * DAY })), 0), 12 * DAY);
        assert_eq!(first_due_of(&with(json!({})), 5 * DAY), 5 * DAY);
        let mut f = Feed::new("firm.landlord", "landlord-1");
        f.absorb(
            0,
            cat(cat(vec![lease("lease-a", "a", 100_000, Some(json!({ "first_due": 20 * DAY })))], signed("lease-a", "a")), cat(vec![lease("lease-b", "b", 100_000, Some(json!({ "first_due": 3 * DAY })))], signed("lease-b", "b"))),
            Some((account(), vec![])),
        );
        // Day 15: b's rent fell due on day 3 and has not come; a's is not due until day 20.
        let o = f.open(15 * DAY);
        let arrears = head(&o, "Rent in arrears").unwrap();
        assert_eq!(ids(arrears), ["lease-b"]);
        assert_eq!((arrears.items[0].since, arrears.items[0].amount), (Some(3 * DAY), Some(100_000)));
        assert!(arrears.items[0].line.contains("since year 1, day 4"), "{}", arrears.items[0].line);
        // The line is the same the next day (the clerk files nothing for a day passing).
        assert_eq!(head(&f.open(16 * DAY), "Rent in arrears").unwrap().items[0].line, arrears.items[0].line);
        // Day 26: a's fell due on day 20: not yet a week late. Day 28: it is.
        assert_eq!(ids(head(&f.open(26 * DAY), "Rent in arrears").unwrap()), ["lease-b"]);
        let at28 = f.open(28 * DAY);
        let mut both = ids(head(&at28, "Rent in arrears").unwrap());
        both.sort();
        assert_eq!(both, ["lease-a", "lease-b"]);
        // b pays what is owed: out of the book. (Its second rent falls due on day 33.)
        f.absorb(29 * DAY, vec![], Some((account(), vec![paid(29 * DAY, "b", 100_000, None)])));
        assert_eq!(ids(head(&f.open(30 * DAY), "Rent in arrears").unwrap()), ["lease-a"]);
    }

    #[test]
    fn a_tenants_request_with_no_answer_of_ours_is_in_the_book_until_answered() {
        let mut f = Feed::new("firm.landlord", "landlord-1");
        f.absorb(
            0,
            cat(
                cat(vec![lease("lease-a", "a", 100_000, None)], signed("lease-a", "a")),
                vec![
                    st("rec.9", 5 * DAY, "variation_request", "a", json!({ "addressed_to": ["landlord-1"], "text": "Request: please let us stay on.", "data": { "agreement": "lease-a", "about": "lease-a" } })),
                    st("rec.10", 6 * DAY, "review_request", "a", json!({ "addressed_to": ["landlord-1"], "data": { "matter": "disrepair", "against": "landlord-1", "structure": "apts-1" } })),
                ],
            ),
            Some((account(), vec![])),
        );
        let o = f.open(7 * DAY);
        let v = head(&o, "Tenants' requests to vary something, not answered").unwrap();
        assert_eq!((v.items[0].id.as_str(), v.items[0].since), ("rec.9", Some(5 * DAY)));
        assert!(head(&o, "Requests to put something right, not answered").unwrap().items[0].line.contains("a asks us to put right disrepair at apts-1"));
        f.absorb(
            8 * DAY,
            vec![
                st("rec.11", 8 * DAY, "variation_answer", "landlord-1", json!({ "basis": "rec.9", "data": { "granted": false } })),
                st("rec.12", 8 * DAY, "remedy_answer", "landlord-1", json!({ "basis": "rec.10", "data": { "request": "rec.10", "granted": true } })),
            ],
            None,
        );
        let after = f.open(9 * DAY);
        assert!(head(&after, "Tenants' requests to vary something, not answered").is_none());
        assert!(head(&after, "Requests to put something right, not answered").is_none());
    }

    #[test]
    fn the_support_offices_books_hold_a_claim_put_before_the_office_holder_until_it_is_decided() {
        let mut f = Feed::new("world.transfers", "outside");
        f.absorb(
            3 * DAY,
            vec![st("rec.5", 3 * DAY, "case_for_decision", "outside", json!({ "addressed_to": ["outside"], "data": { "claim": "rec.4", "claimant": "c0001", "payment": "pension", "fails": "the claim doesn't state that no other pension is paid", "doubt": false } }))],
            None,
        );
        let open = f.open(4 * DAY);
        assert_eq!(open.len(), 1);
        assert_eq!((open[0].items[0].id.as_str(), open[0].items[0].since), ("rec.4", Some(3 * DAY)));
        assert!(open[0].items[0].line.contains("c0001's claim for pension support"));
        f.absorb(5 * DAY, vec![st("rec.6", 5 * DAY, "benefit_decision", "outside", json!({ "addressed_to": ["c0001"], "basis": "rec.4", "data": { "claim": "rec.4", "granted": false } }))], None);
        assert!(f.open(6 * DAY).is_empty());
    }

    #[test]
    fn a_claim_waiting_for_papers_or_a_confirmation_is_open_with_the_day_each_is_due_until_it_comes() {
        let mut f = Feed::new("world.transfers", "outside");
        let ask = |id: &str, kind: &str, to: &str, x: Value| {
            let mut data = json!({ "claim": "rec.4", "need": "papers" });
            for (k, v) in x.as_object().unwrap() {
                data[k] = v.clone();
            }
            st(id, 3 * DAY, kind, "outside", json!({ "addressed_to": [to], "data": data }))
        };
        f.absorb(
            3 * DAY,
            vec![
                ask("rec.7", "evidence_request", "c0001", json!({ "what": "proof of who you are", "by": 17 * DAY })),
                ask("rec.8", "confirmation_request", "shop-3", json!({ "need": "employer", "what": "that c0001 worked there", "by": 17 * DAY })),
            ],
            None,
        );
        let open = f.open(4 * DAY);
        let waiting = head(&open, "Claims waiting for papers or a confirmation asked for, not yet come").unwrap();
        assert_eq!(ids(waiting), ["rec.7", "rec.8"]);
        assert_eq!((waiting.items[0].since, waiting.items[0].due), (Some(3 * DAY), Some(17 * DAY)));
        assert_eq!(waiting.items[0].line, "rec.4: the claimant was asked year 1, day 4 for proof of who you are (rec.7), due by year 1, day 18; not yet answered");
        assert!(waiting.items[1].line.contains("shop-3 was asked"));
        // The papers come: that one is gone, the other stands. The claim decided: nothing waits.
        f.absorb(5 * DAY, vec![st("rec.9", 5 * DAY, "evidence", "c0001", json!({ "addressed_to": ["outside"], "basis": "rec.7", "data": { "claim": "rec.4", "need": "papers", "request": "rec.7" } }))], None);
        let o = f.open(6 * DAY);
        assert_eq!(ids(o.iter().find(|x| x.what.starts_with("Claims waiting")).unwrap()), ["rec.8"]);
        f.absorb(7 * DAY, vec![st("rec.10", 7 * DAY, "benefit_decision", "outside", json!({ "addressed_to": ["c0001"], "basis": "rec.4", "data": { "claim": "rec.4", "granted": true } }))], None);
        assert!(f.open(8 * DAY).is_empty());
    }

    const POSSESSION: &str = "Tenancies being ended for arrears under the law on possession, and where each has got to";

    fn possession_law() -> Value {
        st("law-possession", 0, "law", "state", json!({ "data": { "tenancy": "possession", "arrears_days": 14, "notice_days": 14, "possession_days": 14 } }))
    }

    #[test]
    fn an_application_before_the_tribunal_is_set_beside_what_has_changed_since_and_never_says_what_to_do() {
        let mut f = Feed::new("firm.landlord", "landlord-1");
        f.absorb(0, cat(vec![possession_law(), lease("lease-a", "a", 100_000, None)], signed("lease-a", "a")), Some((account(), vec![paid(0, "a", 100_000, Some("rent"))])));
        let ending = |f: &Feed, t: i64| head(&f.open(t), POSSESSION).map(|h| h.items[0].line.clone());
        f.absorb(
            87 * DAY,
            vec![
                st("rec.20", 70 * DAY, "notice_to_vacate", "landlord-1", json!({ "addressed_to": ["a"], "basis": "lease-a", "data": { "lease": "lease-a", "reason": "arrears", "by": 85 * DAY } })),
                st("rec.21", 87 * DAY, "tribunal_application", "landlord-1", json!({ "addressed_to": ["tribunal"], "basis": "lease-a", "data": { "kind": "possession", "matter": "possession", "against": "a", "about": "lease-a", "amount": 200_000 } })),
            ],
            None,
        );
        assert!(ending(&f, 88 * DAY).unwrap().contains("it has not decided"));
        assert!(!ending(&f, 88 * DAY).unwrap().contains("ordinarily withdraw"));
        // The tenant answers the tribunal: shown, with whether this office has replied.
        f.absorb(90 * DAY, vec![st("rec.30", 90 * DAY, "tribunal_response", "a", json!({ "addressed_to": ["tribunal"], "basis": "rec.21", "data": { "application": "rec.21", "owes": 200_000, "offer": 30_000 } }))], None);
        assert!(ending(&f, 91 * DAY).unwrap().contains("a answered the tribunal year 1, day 91 (rec.30), offering $300.00 a month toward what is owed; we have not replied (reply to a tenant's answer form)"));
        f.absorb(92 * DAY, vec![st("rec.31", 92 * DAY, "tribunal_reply", "landlord-1", json!({ "addressed_to": ["tribunal", "a"], "basis": "rec.21", "data": { "application": "rec.21", "owed": 300_000 } }))], None);
        assert!(ending(&f, 93 * DAY).unwrap().contains("we have replied"));
        // The tenant pays everything owed: the books set that beside the application, and say what is ordinarily done.
        f.absorb(95 * DAY, vec![], Some((account(), vec![paid(95 * DAY, "a", 300_000, Some("rent owed"))])));
        let line = ending(&f, 96 * DAY).unwrap();
        assert!(line.contains("Since the application: the application said $2,000.00 was owed; the rent book shows less than a rent owed now"), "{line}");
        assert!(line.contains("An application stands until it is decided or withdrawn; where the rent owed has been paid or terms agreed, landlords ordinarily withdraw it"));
        // Withdrawn: no longer shown as waiting on the tribunal.
        f.absorb(97 * DAY, vec![json!({ "id": "rec.40", "at": 97 * DAY, "record": "withdrawal", "author": "landlord-1-office-system", "speaks_for": "landlord-1", "withdraws": "rec.21", "visible_to": ["landlord-1", "tribunal", "a"] })], None);
        assert!(!ending(&f, 98 * DAY).unwrap_or_default().contains("we applied to the tribunal"));
    }

    #[test]
    fn each_tenancy_being_ended_is_at_the_stage_its_papers_put_it_at_and_the_last_payments_words_are_in_the_rent_book() {
        let mut f = Feed::new("firm.landlord", "landlord-1");
        f.absorb(0, cat(vec![possession_law(), lease("lease-a", "a", 100_000, None)], signed("lease-a", "a")), Some((account(), vec![paid(0, "a", 100_000, Some("rent"))])));
        let ending = |f: &Feed, t: i64| head(&f.open(t), POSSESSION).map(|h| h.items[0].clone());
        let line = |f: &Feed, t: i64| ending(f, t).unwrap().line;
        assert!(ending(&f, 70 * DAY).is_none());
        let o = f.open(70 * DAY);
        assert!(head(&o, "Rent in arrears").unwrap().items[0].line.contains("the last payment from acc-a came year 1, day 1 ($1,000.00, \"rent\")"));
        // Notice to vacate: its date, and what follows it.
        f.absorb(70 * DAY, vec![st("rec.20", 70 * DAY, "notice_to_vacate", "landlord-1", json!({ "addressed_to": ["a"], "basis": "lease-a", "data": { "lease": "lease-a", "reason": "arrears", "by": 85 * DAY } }))], None);
        let e = ending(&f, 71 * DAY).unwrap();
        assert_eq!((e.id.as_str(), e.since), ("lease-a", Some(70 * DAY)));
        assert!(e.line.contains("notice to vacate given year 1, day 71 (rec.20), to leave by year 1, day 86; paid before then it lapses"));
        assert!(line(&f, 86 * DAY).contains("that date has passed and the tenant has not left; by law-possession the landlord may now apply to the tribunal for possession, and may not put them out"));
        // Applied; then the tribunal's plan; then, applied again, its order; a warrant asked, issued, lapsed.
        f.absorb(87 * DAY, vec![st("rec.21", 87 * DAY, "tribunal_application", "landlord-1", json!({ "addressed_to": ["tribunal"], "basis": "lease-a", "data": { "kind": "possession", "matter": "possession", "against": "a", "about": "lease-a" } }))], None);
        assert!(line(&f, 88 * DAY).contains("we applied to the tribunal for possession year 1, day 88 (rec.21); it has not decided"));
        f.absorb(100 * DAY, vec![st("rec.22", 100 * DAY, "tribunal_order", "tribunal", json!({ "basis": "rec.21", "data": { "kind": "possession", "applicant": "landlord-1", "against": "a", "about": "lease-a", "finding": "plan", "instalment": 20_000 } }))], None);
        assert!(line(&f, 101 * DAY).contains("the tribunal set a plan to pay year 1, day 101 (rec.22): the rent as it falls due and $200.00 a month toward what is owed"));
        f.absorb(
            140 * DAY,
            vec![
                st("rec.23", 139 * DAY, "tribunal_application", "landlord-1", json!({ "addressed_to": ["tribunal"], "basis": "lease-a", "data": { "kind": "possession", "against": "a", "about": "lease-a", "breach": true } })),
                st("rec.24", 140 * DAY, "tribunal_order", "tribunal", json!({ "basis": "rec.23", "data": { "kind": "possession", "applicant": "landlord-1", "against": "a", "about": "lease-a", "finding": "possession", "due": 154 * DAY, "space": "apts-1/dwelling.1" } })),
            ],
            None,
        );
        assert!(line(&f, 141 * DAY).contains("the tribunal ordered possession of apts-1/dwelling.1 by year 1, day 155 (rec.24); if the tenant is still there a day after that date, a warrant may be asked"));
        assert!(line(&f, 156 * DAY).contains("that date has passed and the tenant has not left; by law-possession a warrant may be asked of the tribunal's registrar, and nobody else may put them out"));
        f.absorb(156 * DAY, vec![st("rec.25", 156 * DAY, "warrant_request", "landlord-1", json!({ "addressed_to": ["tribunal"], "basis": "rec.24", "data": { "order": "rec.24" } }))], None);
        assert!(line(&f, 157 * DAY).contains("a warrant was asked of the tribunal's registrar year 1, day 157 (rec.25) and has not been issued"));
        f.absorb(158 * DAY, vec![st("rec.26", 158 * DAY, "warrant", "tribunal", json!({ "basis": "rec.24", "data": { "order": "rec.24", "lease": "lease-a", "until": 172 * DAY } }))], None);
        assert!(line(&f, 159 * DAY).contains("a warrant is out (rec.26), to be carried out by year 1, day 173 by those who enforce the tribunal's orders, and by nobody else"));
        // Carried out: the tenancy is out of this heading.
        f.absorb(165 * DAY, vec![st("rec.27", 165 * DAY, "warrant_executed", "police", json!({ "data": { "lease": "lease-a" } }))], None);
        assert!(ending(&f, 166 * DAY).is_none());
    }

    #[test]
    fn a_tenant_who_goes_on_the_notice_to_vacate_ends_the_tenancy_and_the_rent_stops_counting() {
        let mut f = Feed::new("firm.landlord", "landlord-1");
        f.absorb(0, cat(vec![possession_law(), lease("lease-a", "a", 100_000, None)], signed("lease-a", "a")), Some((account(), vec![paid(0, "a", 100_000, None)])));
        f.absorb(70 * DAY, vec![st("rec.20", 70 * DAY, "notice_to_vacate", "landlord-1", json!({ "addressed_to": ["a"], "basis": "lease-a", "data": { "lease": "lease-a", "reason": "arrears", "by": 85 * DAY } }))], None);
        // Day 85: the landlord applies; minutes later the tenant gives notice on the lease and goes.
        f.absorb(
            85 * DAY,
            vec![
                st("rec.21", 85 * DAY, "tribunal_application", "landlord-1", json!({ "addressed_to": ["tribunal"], "basis": "lease-a", "data": { "kind": "possession", "matter": "possession", "against": "a", "about": "lease-a" } })),
                json!({ "id": "rec.22", "at": 85 * DAY + 600, "record": "notice", "agreement": "lease-a", "as": "a", "author": "a-self", "visible_to": ["landlord-1", "a"], "text": "Leaving: told to vacate for arrears." }),
            ],
            None,
        );
        const GONE: &str = "Tenants who have left on our notice to vacate: tenancies over";
        let o = f.open(86 * DAY);
        let item = &head(&o, GONE).unwrap().items[0];
        assert_eq!((item.id.as_str(), item.since, item.amount), ("lease-a", Some(85 * DAY + 600), Some(200_000)));
        assert!(item.line.contains("a gave notice on the lease year 1, day 86, after our notice to vacate, and has given up"));
        assert!(item.line.contains("$2,000.00 of rent was owed under it when they left, and is still owed"));
        assert!(item.line.contains("our application for possession rec.21 (year 1, day 86) still stands at the tribunal, undecided: law-possession gives possession only where the tenant has not left"), "{}", item.line);
        // It is no longer rent in arrears, nor a tenancy being ended; and a month on, no further rent has been counted.
        assert!(head(&o, "Rent in arrears").is_none());
        assert!(head(&o, POSSESSION).is_none());
        assert_eq!(head(&f.open(125 * DAY), GONE).unwrap().items[0].amount, Some(200_000));
        // The application withdrawn: the line no longer says it stands.
        f.absorb(126 * DAY, vec![json!({ "id": "rec.30", "at": 126 * DAY, "record": "withdrawal", "withdraws": "rec.21", "author": "landlord-1-office-system", "visible_to": ["landlord-1", "tribunal"] })], None);
        assert!(!head(&f.open(127 * DAY), GONE).unwrap().items[0].line.contains("still stands at the tribunal"));
    }

    // ---- a rates bill is one thing on two papers (participants/test/rates-one-bill.test.ts)

    fn notice(id: &str, due: i64, amount: i64) -> Value {
        json!({ "id": id, "at": 30 * DAY, "record": "statement", "kind": "rates_notice", "author": "rates-system", "speaks_for": "city", "addressed_to": ["landlord-38"], "visible_to": ["city", "landlord-38"], "data": { "amount": amount, "due": due, "account": "acc-city", "lots": ["lot-1"] }, "text": "Rates notice" })
    }
    fn claim(id: &str, due: i64, amount: i64) -> Value {
        json!({ "id": id, "at": 30 * DAY, "record": "claim", "position": "right", "holder": "city", "counterparty": "landlord-38", "author": "rates-system", "speaks_for": "city", "visible_to": ["city", "landlord-38"], "about": { "kind": "rates", "amount": amount, "account": "acc-city", "due": due, "lots": ["lot-1"] } })
    }
    fn owed(records: Vec<Value>, settled: &[&str]) -> Vec<String> {
        let mut book = Book::new();
        let recs: Vec<Arc<Record>> = records.into_iter().map(|r| Arc::new(serde_json::from_value(r).unwrap())).collect();
        book.take_all(recs.iter());
        let money = Money { settled: settled.iter().map(|s| s.to_string()).collect(), ..Default::default() };
        owed_by_us(&book, "landlord-38", &money, &world()).into_iter().flat_map(|h| h.items).map(|i| format!("{}|{}", i.id, i.line)).collect()
    }
    const D1: i64 = 60 * DAY;
    const D2: i64 = 150 * DAY;
    const AMT: i64 = 297_786;

    #[test]
    fn a_rates_bill_stands_once_in_the_books_the_claim_with_the_notice_named() {
        let items = owed(vec![notice("rec.1", D1, AMT), claim("rec.2", D1, AMT)], &[]);
        assert_eq!(items.len(), 1);
        assert!(items[0].starts_with("rec.2|") && items[0].contains("rec.1"), "{items:?}");
    }

    #[test]
    fn paying_the_notice_settles_the_bill_and_so_does_paying_the_claim() {
        let p = || vec![notice("rec.1", D1, AMT), claim("rec.2", D1, AMT)];
        assert!(owed(p(), &["rec.1"]).is_empty());
        assert!(owed(p(), &["rec.2"]).is_empty());
    }

    #[test]
    fn a_payment_settles_only_its_own_bill() {
        let two = vec![notice("rec.1", D1, AMT), claim("rec.2", D1, AMT), notice("rec.3", D2, AMT), claim("rec.4", D2, AMT)];
        let got: Vec<String> = owed(two, &["rec.1"]).iter().map(|s| s.split('|').next().unwrap().to_string()).collect();
        assert_eq!(got, ["rec.4"]);
        let other = vec![notice("rec.1", D1, 100), claim("rec.2", D1, AMT)];
        let got: Vec<String> = owed(other, &["rec.1"]).iter().map(|s| s.split('|').next().unwrap().to_string()).collect();
        assert_eq!(got, ["rec.2"]);
    }

    #[test]
    fn a_fine_has_no_notice_only_a_payment_naming_it_settles_it() {
        let mut fine = claim("rec.7", D1, 5_000);
        fine["about"] = json!({ "kind": "fine", "amount": 5_000, "due": D1 });
        let got: Vec<String> = owed(vec![fine.clone(), notice("rec.1", D1, 5_000)], &["rec.1"]).iter().map(|s| s.split('|').next().unwrap().to_string()).collect();
        assert_eq!(got, ["rec.7"]);
        assert!(owed(vec![fine], &["rec.7"]).is_empty());
    }

    #[test]
    fn a_reader_is_kept_through_a_snapshot() {
        let mut f = Feed::new("firm.landlord", "landlord-1");
        f.absorb(0, cat(vec![lease("lease-a", "a", 100_000, None)], signed("lease-a", "a")), Some((account(), vec![paid(0, "a", 100_000, None)])));
        let saved = f.r.save().unwrap();
        let mut again = reader("firm.landlord", "landlord-1", "landlord-1", &Default::default()).unwrap();
        again.restore(&saved).unwrap();
        let (a, b) = (f.r.open(70 * DAY, &world()), again.open(70 * DAY, &world()));
        assert_eq!(serde_json::to_value(&a).unwrap(), serde_json::to_value(&b).unwrap());
        assert!(head(&a, "Rent in arrears").is_some());
    }
}
