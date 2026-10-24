//! What the support office reads of the law, for world.transfers: the published support law (payments.ts), the income
//! tax law as far as the office needs it (tax.ts: what is withheld from a pay, for a payment reckoned on net pay), and
//! the law of a decision (decisions.ts: what a decision waits for, and how it is looked at again).
//!
//! **To be replaced** by `oikos_rules::support` when lane C1 lands (payments.ts, tax.ts's `withholding`) and by
//! `oikos_rules::decisions` when lane D lands (decisions.ts: `decision_law`, `Waits`, `Reconsiderations`). The public
//! surface is kept small so the swap is a change of imports: `support_law`, `PaymentRule` and its readers, `Declared`,
//! `withholding(income_tax_law(book), ..)`, `decision_law`, `Waits`, `Reconsiderations`. Nothing here is another lane's
//! to extend; if the real ones differ, theirs win and `transfers` follows.
//!
//! Money is integer cents. Where TS divided floats, whole-number division is used (and is exact where the float was
//! not): said in the place.

use crate::common::{addressed_to, data, filed_before, made_at, Book, Fields};
use crate::steps::{because, say, Say, Step};
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

const DAY: i64 = 86_400;
const YEAR: i64 = 365 * DAY;

// ------------------------------------------------------------------ payments.ts

/// One payment of a support law. Sums are in the smallest unit of the world's money, for one payment (every
/// `every_days`), unless said otherwise (payments.ts `PaymentRule`).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct PaymentRule {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    /// Who pays (an entity); the law's speaker where it does not say.
    #[serde(default)]
    pub payer: Option<String>,
    /// And from which account.
    #[serde(default)]
    pub account: String,
    pub every_days: i64,
    #[serde(default)]
    pub who: Option<Who>,
    pub amount: Amount,
    #[serde(default)]
    pub lasts: Option<Lasts>,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct Who {
    #[serde(default)]
    pub from_age: Option<i64>,
    #[serde(default)]
    pub to_age: Option<i64>,
    #[serde(default)]
    pub out_of_work: Option<bool>,
    #[serde(default)]
    pub record: Option<RecordRule>,
    #[serde(default)]
    pub income_under: Option<IncomeUnder>,
    #[serde(default)]
    pub no_other_pension: Option<bool>,
    #[serde(default)]
    pub children: Option<Children>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct RecordRule {
    #[serde(default)]
    pub months: Option<i64>,
    #[serde(default)]
    pub within_months: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct IncomeUnder {
    pub amount: i64,
    /// "household" or "head".
    pub per: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Children {
    pub least: i64,
    pub under_age: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Amount {
    Flat { flat: i64 },
    Share {
        share_bps: i64,
        #[serde(default)]
        with_child_bps: Option<i64>,
        /// "gross" or "net" (of what the tax law withholds).
        #[serde(default)]
        of: Option<String>,
        #[serde(default)]
        least: Option<i64>,
        #[serde(default)]
        most: Option<Most>,
    },
    Household {
        household: i64,
        #[serde(default)]
        per_member: Option<i64>,
        #[serde(default)]
        per_child: Option<PerChild>,
    },
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Most {
    One(i64),
    ByAge(Vec<AgeMost>),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct AgeMost {
    pub from_age: i64,
    pub amount: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct PerChild {
    pub under_age: i64,
    pub amount: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct Lasts {
    #[serde(default)]
    pub days: Option<i64>,
    #[serde(default)]
    pub until_age: Option<i64>,
    #[serde(default)]
    pub then: Option<String>,
}

impl PaymentRule {
    /// A payment for those out of work (a stopgap while looking).
    pub fn for_out_of_work(&self) -> bool {
        self.who.as_ref().and_then(|w| w.out_of_work) == Some(true)
    }
    /// A payment made to a household, claimed by its head.
    pub fn for_household(&self) -> bool {
        matches!(self.amount, Amount::Household { .. })
    }
    /// A payment for age: a pension.
    pub fn for_age(&self) -> bool {
        !self.for_out_of_work() && !self.for_household() && self.who.as_ref().and_then(|w| w.from_age).is_some()
    }
}

/// The support law in force that has been seen: the latest published and not withdrawn (none: no payments). A payment
/// of it that cannot be read is left out, as a law with a part not understood binds in the parts that are.
pub fn support_law(book: &Book) -> Option<(String, Vec<PaymentRule>)> {
    let l = book
        .open("law")
        .filter(|r| data(r).get("payments").is_some_and(Value::is_array))
        .fold(None::<&Arc<Record>>, |a, b| match a {
            // (Newest first; of two made together, the later filed.)
            Some(a) if b.at < a.at || (b.at == a.at && filed_before(&b.id, &a.id).is_le()) => Some(a),
            _ => Some(b),
        })?;
    let payments = data(l)
        .get("payments")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|x| serde_json::from_value::<PaymentRule>(x.clone()).ok())
        .map(|mut x| {
            if x.payer.is_none() {
                x.payer.clone_from(&l.speaks_for);
            }
            x
        })
        .collect();
    Some((l.id.clone(), payments))
}

// ------------------------------------------------------------------ tax.ts

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct Band {
    from: i64,
    rate_bps: i64,
    #[serde(default)]
    rising_to_bps: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct Tapers {
    above: i64,
    bps: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct Allowance {
    amount: i64,
    #[serde(default)]
    tapers: Option<Tapers>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
enum Deduction {
    Charges { charges: Vec<String> },
    Share { share_bps: i64, #[serde(default)] least: Option<i64>, #[serde(default)] most: Option<i64> },
    Allow(Allowance),
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
enum Relief {
    NoneDue { none_due_up_to: i64 },
    Allow(Allowance),
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
struct Base {
    #[serde(default)]
    on: Option<String>,
    #[serde(default)]
    from: Option<i64>,
    #[serde(default)]
    up_to: Option<i64>,
    #[serde(default)]
    less: Vec<Deduction>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct Charge {
    id: String,
    #[serde(default)]
    base: Option<Base>,
    schedule: Vec<Band>,
    #[serde(default)]
    reliefs: Vec<Relief>,
}

/// A law taxing pay: its charges, in the order the law lists them (tax.ts `IncomeTaxLaw`, without the returns rules,
/// which the office does not need).
#[derive(Debug, Clone, PartialEq)]
pub struct IncomeTaxLaw {
    charges: Vec<Charge>,
}

/// The income tax law in force that has been seen: the latest published and not withdrawn (none: no income tax). A law
/// in the short form (`brackets`, `levy_bps`, `levy_from`) is read as the two charges it is.
pub fn income_tax_law(book: &Book) -> Option<IncomeTaxLaw> {
    let l = book
        .open("law")
        .filter(|r| data(r).s("tax") == Some("income") && (data(r).get("brackets").is_some_and(Value::is_array) || data(r).get("charges").is_some_and(Value::is_array)))
        .fold(None::<&Arc<Record>>, |a, b| match a {
            Some(a) if b.at < a.at || (b.at == a.at && filed_before(&b.id, &a.id).is_le()) => Some(a),
            _ => Some(b),
        })?;
    let d = data(l);
    if let Some(cs) = d.get("charges").and_then(Value::as_array) {
        let charges = cs.iter().map(|c| serde_json::from_value::<Charge>(c.clone()).ok()).collect::<Option<Vec<_>>>()?;
        return Some(IncomeTaxLaw { charges });
    }
    let brackets: Vec<Band> = serde_json::from_value(d.get("brackets")?.clone()).ok()?;
    let mut charges = vec![Charge { id: "income-tax".into(), base: None, schedule: brackets, reliefs: vec![] }];
    let levy = d.i("levy_bps").unwrap_or(0);
    if levy > 0 {
        charges.push(Charge {
            id: "levy".into(),
            base: Some(Base { from: Some(d.i("levy_from").unwrap_or(0)), ..Default::default() }),
            schedule: vec![Band { from: 0, rate_bps: levy, rising_to_bps: None }],
            reliefs: vec![],
        });
    }
    Some(IncomeTaxLaw { charges })
}

fn allowance(a: &Allowance, pay: i64) -> i64 {
    let taper = match &a.tapers {
        Some(t) if pay > t.above => (i128::from(pay - t.above) * i128::from(t.bps) / 10_000) as i64,
        _ => 0,
    };
    (a.amount - taper).max(0)
}

/// A schedule's charge on a base (each band rounded down).
fn scheduled(schedule: &[Band], base: i64) -> i64 {
    let mut bands: Vec<&Band> = schedule.iter().collect();
    bands.sort_by_key(|b| b.from);
    let mut due = 0i64;
    for (i, b) in bands.iter().enumerate() {
        let top = bands.get(i + 1).map(|n| n.from);
        if base <= b.from {
            continue;
        }
        let part = base.min(top.unwrap_or(i64::MAX)) - b.from;
        match (b.rising_to_bps, top) {
            (Some(rise), Some(top)) => {
                // The marginal rate rises in a straight line across the band: the charge on a part of it is the part at
                // the mean of the rate at the band's start and the rate reached.
                let (width, x) = (i128::from(top - b.from), i128::from(part));
                due += (x * (2 * i128::from(b.rate_bps) * width + i128::from(rise - b.rate_bps) * x) / (2 * width * 10_000)) as i64;
            }
            _ => due += (i128::from(part) * i128::from(b.rate_bps) / 10_000) as i64,
        }
    }
    due
}

impl IncomeTaxLaw {
    fn amount_of(&self, id: &str, pay: i64, done: &mut BTreeMap<String, i64>, doing: &mut Vec<String>) -> i64 {
        if let Some(x) = done.get(id) {
            return *x;
        }
        let Some(c) = self.charges.iter().find(|x| x.id == id) else { return 0 };
        if doing.iter().any(|d| d == id) {
            return 0; // (a charge on itself, or on one the law doesn't have: nothing)
        }
        doing.push(id.to_string());
        let empty = Base::default();
        let b = c.base.as_ref().unwrap_or(&empty);
        let mut amount = 0;
        if b.on.is_some() || pay >= b.from.unwrap_or(0) {
            let mut base = match &b.on {
                Some(on) => self.amount_of(on, pay, done, doing),
                None => pay,
            };
            if let Some(up) = b.up_to {
                base = base.min(up);
            }
            for d in &b.less {
                match d {
                    Deduction::Charges { charges } => {
                        for other in charges {
                            base -= self.amount_of(other, pay, done, doing);
                        }
                    }
                    Deduction::Share { share_bps, least, most } => {
                        let share = (i128::from(pay) * i128::from(*share_bps) / 10_000) as i64;
                        base -= share.max(least.unwrap_or(0)).min(most.unwrap_or(i64::MAX));
                    }
                    Deduction::Allow(a) => base -= allowance(a, pay),
                }
            }
            base = base.max(0);
            amount = scheduled(&c.schedule, base);
            for r in &c.reliefs {
                amount = match r {
                    Relief::NoneDue { none_due_up_to } => {
                        if base <= *none_due_up_to {
                            0
                        } else {
                            amount
                        }
                    }
                    Relief::Allow(a) => (amount - allowance(a, pay)).max(0),
                };
            }
        }
        doing.pop();
        done.insert(id.to_string(), amount);
        amount
    }

    /// What each charge of a law takes of a year's pay (rounded down), summed.
    fn annual(&self, pay: i64) -> i64 {
        let (mut done, mut doing) = (BTreeMap::new(), vec![]);
        self.charges.iter().map(|c| self.amount_of(&c.id, pay, &mut done, &mut doing)).sum()
    }
}

/// What is withheld from a pay of `gross` every `period` seconds, in all: the pay reckoned as a year's (a year is 365
/// days), the law's charges on that, and a pay period's part, rounded down. No law: nothing (tax.ts `withholding`).
pub fn withholding(law: Option<&IncomeTaxLaw>, gross: i64, period: i64) -> i64 {
    let Some(law) = law else { return 0 };
    if gross <= 0 || period <= 0 {
        return 0;
    }
    let yearly = (i128::from(gross) * i128::from(YEAR) / i128::from(period)) as i64;
    (i128::from(law.annual(yearly)) * i128::from(period) / i128::from(YEAR)) as i64
}

// ------------------------------------------------------------------ decisions.ts

/// What a decision waits for (decisions.ts `Need`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Need {
    pub id: String,
    /// "claimant" (their papers) or "employer" (the claimant's last employer).
    pub from: String,
    pub what: String,
    pub within_days: i64,
    /// "refuse" or "decide" (on what is on hand), when it has not come in time.
    #[serde(rename = "else")]
    pub otherwise: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ReviewRoute {
    pub within_days: i64,
    #[serde(default)]
    pub grounds: String,
    #[serde(default)]
    pub required: Option<bool>,
}

/// The law of a decision of a kind (decisions.ts `DecisionLaw`; the appeal route is the venue's, not read here).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct DecisionLaw {
    pub kind: String,
    #[serde(default)]
    pub payments: Option<Vec<String>>,
    #[serde(default)]
    pub needs: Vec<Need>,
    #[serde(default)]
    pub review: Option<ReviewRoute>,
    /// Who may refuse where the office is a head and staff: "office-holder" (the head alone) or "staff".
    #[serde(default)]
    pub refused_by: Option<String>,
}

/// The law on file for a decision of a kind (and, where it differs by payment, for that payment): the latest published
/// and not withdrawn. A rule for named payments is the more particular, and wins over one for the kind.
pub fn decision_law(book: &Book, kind: &str, payment: Option<&str>) -> Option<DecisionLaw> {
    let mut best: Option<DecisionLaw> = None;
    let mut best_at = -1i64;
    for l in book.open("law") {
        let Some(list) = data(l).get("decisions").and_then(Value::as_array) else { continue };
        for d in list {
            // (Read in place: the same as reading a copy of it.)
            let Ok(d) = DecisionLaw::deserialize(d) else { continue };
            if d.kind != kind {
                continue;
            }
            let fits = match &d.payments {
                None => true,
                Some(ps) => payment.is_some_and(|p| ps.iter().any(|x| x == p)),
            };
            if !fits {
                continue;
            }
            let score = if d.payments.is_some() { 1_000_000_000_000 } else { 0 } + l.at;
            if score > best_at {
                best_at = score;
                best = Some(d);
            }
        }
    }
    best
}

/// The time a decision's review may still be asked, from its date: whole days left (negative: gone).
pub fn days_left(from: i64, within_days: i64, t: i64) -> i64 {
    within_days - (t - from).div_euclid(DAY)
}

/// How a claim stands against what the law has it wait for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Wait {
    /// Nothing is left to wait for.
    Ready,
    /// Something is out and not yet late.
    Waiting,
    /// Something did not come in time and the law says refuse: why, in words.
    Lapsed(String),
}

/// What a decision waits for, for an office that decides claims (decisions.ts `Waits`): the requests it has made, what
/// has come, what is late. It makes the requests (each an act of the office, which takes its performer's time) and reads
/// the answers on the file; it decides nothing.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Waits {
    me: String,
    /// need key (claim|need) -> when we asked and the day it is due by.
    asked: BTreeMap<String, (i64, i64)>,
    /// What has come, by claim and need, as the book stood when last read (`came`): made again when the book has
    /// taken in more. Never saved (it is the book's, read again).
    #[serde(skip)]
    came: Option<Came>,
    /// Whom the office's file names as each claimant's employer, read once and kept up as the file grows
    /// (`employer_for`). Never saved (it is the book's, read again).
    #[serde(skip)]
    employers: Employers,
}

/// The office's file read for `employer_for`, as far as it has been read: each claimant's papers to the office naming a
/// last employer, in the order seen; and the last employer that reported pay for each worker to the office (the first
/// of the latest, as the file was read in order). Each was looked for through the whole file for every claim.
#[derive(Debug, Clone, Default)]
struct Employers {
    evidence_read: usize,
    named: BTreeMap<String, Vec<Arc<Record>>>,
    reports_read: usize,
    reported: BTreeMap<String, (i64, String)>,
}

/// The office's file read once for `Waits::came`: of the standing evidence addressed to it, who each piece speaks for, by
/// (claim, need); and the (claim, need) of each standing confirmation answer addressed to it. Each claim's every need
/// was looked for through the whole file, at every round of the office: as many readings of it as claims open.
#[derive(Debug, Clone, Default)]
struct Came {
    stamp: (usize, usize, usize),
    evidence: BTreeMap<(String, String), BTreeSet<Option<String>>>,
    answers: BTreeSet<(String, String)>,
}

impl Waits {
    pub fn new(me: &str) -> Self {
        Waits { me: me.to_string(), asked: BTreeMap::new(), came: None, employers: Employers::default() }
    }

    /// `employer_of(book, me, who)`, from the file as read so far (and read on from where it was left).
    fn employer_for(&mut self, book: &Book, who: &str) -> Option<String> {
        let me = self.me.as_str();
        let e = &mut self.employers;
        // (A file shorter than what was read is another file: read it from the start.)
        if book.all("evidence").len() < e.evidence_read || book.all("withholding_report").len() < e.reports_read {
            *e = Employers::default();
        }
        let evidence = book.all("evidence");
        let n = evidence.len();
        for r in evidence.skip(e.evidence_read) {
            if let Some(w) = r.speaks_for.as_deref() {
                if addressed_to(r).iter().any(|x| x == me) && data(r).s("last_employer").is_some() {
                    e.named.entry(w.to_string()).or_default().push(r.clone());
                }
            }
        }
        e.evidence_read = n;
        let reports = book.all("withholding_report");
        let n = reports.len();
        for r in reports.skip(e.reports_read) {
            let Some(by) = r.speaks_for.as_deref() else { continue };
            if !addressed_to(r).iter().any(|x| x == me) {
                continue;
            }
            let Some(staff) = data(r).get("staff").and_then(Value::as_array) else { continue };
            for w in staff.iter().filter_map(|l| l.s("worker")) {
                match e.reported.get_mut(w) {
                    Some(b) if r.at <= b.0 => {}
                    Some(b) => *b = (r.at, by.to_string()),
                    None => {
                        e.reported.insert(w.to_string(), (r.at, by.to_string()));
                    }
                }
            }
        }
        e.reports_read = n;
        // (Standing papers only: those withdrawn since they were read are passed over, as `open` leaves them out.)
        let named = e.named.get(who).into_iter().flatten().filter(|r| !book.withdrawn(&r.id)).fold(None::<&Arc<Record>>, |a, b| match a {
            Some(a) if b.at <= a.at => Some(a),
            _ => Some(b),
        });
        let found = match named {
            Some(n) => data(n).s("last_employer").map(String::from),
            None => e.reported.get(who).map(|b| b.1.clone()),
        };
        debug_assert_eq!(found, Self::employer_of(book, me, who), "the file's employers, read on, are not what reading it through says");
        found
    }

    /// The employer to ask: whom the claimant's own papers name as their last employer, else the last that reported pay
    /// for the claimant to us (the office's own file of reports).
    pub fn employer_of(book: &Book, me: &str, who: &str) -> Option<String> {
        let named = book
            .open("evidence")
            .filter(|r| r.speaks_for.as_deref() == Some(who) && addressed_to(r).iter().any(|x| x == me) && data(r).s("last_employer").is_some())
            .fold(None::<&Arc<Record>>, |a, b| match a {
                Some(a) if b.at <= a.at => Some(a),
                _ => Some(b),
            });
        if let Some(n) = named {
            return data(n).s("last_employer").map(String::from);
        }
        let mut best: Option<(i64, &str)> = None;
        for r in book.all("withholding_report") {
            let Some(by) = r.speaks_for.as_deref() else { continue };
            if !addressed_to(r).iter().any(|x| x == me) {
                continue;
            }
            let Some(staff) = data(r).get("staff").and_then(Value::as_array) else { continue };
            if !staff.iter().any(|l| l.s("worker") == Some(who)) {
                continue;
            }
            if best.is_none_or(|b| r.at > b.0) {
                best = Some((r.at, by));
            }
        }
        best.map(|b| b.1.to_string())
    }

    fn came(&self, book: &Book, n: &Need, claim: &Record, who: &str) -> bool {
        let key = (claim.id.clone(), n.id.clone());
        let Some(c) = self.came.as_ref().filter(|c| c.stamp == Self::stamp(book)) else {
            // (Not read for this book as it stands: read it through, as `read_came` would.)
            let to_me = |r: &Record| addressed_to(r).iter().any(|x| x == &self.me);
            let about = |r: &Record| data(r).s("claim") == Some(claim.id.as_str()) && data(r).s("need") == Some(n.id.as_str());
            return if n.from == "claimant" {
                book.open("evidence").any(|r| r.speaks_for.as_deref() == Some(who) && to_me(r) && about(r))
            } else {
                book.open("confirmation_answer").any(|r| to_me(r) && about(r))
            };
        };
        if n.from == "claimant" {
            c.evidence.get(&key).is_some_and(|by| by.contains(&Some(who.to_string())))
        } else {
            c.answers.contains(&key)
        }
    }

    fn stamp(book: &Book) -> (usize, usize, usize) {
        (book.len(), book.open("evidence").len(), book.open("confirmation_answer").len())
    }

    /// The file read once for `came`, unless it was read as it stands.
    fn read_came(&mut self, book: &Book) {
        let stamp = Self::stamp(book);
        if self.came.as_ref().is_some_and(|c| c.stamp == stamp) {
            return;
        }
        let me = self.me.clone();
        let to_me = |r: &Record| addressed_to(r).iter().any(|x| *x == me);
        let about = |r: &Record| Some((data(r).s("claim")?.to_string(), data(r).s("need")?.to_string()));
        let mut c = Came { stamp, ..Default::default() };
        for r in book.open("evidence").filter(|r| to_me(r)) {
            if let Some(k) = about(r) {
                c.evidence.entry(k).or_default().insert(r.speaks_for.clone());
            }
        }
        for r in book.open("confirmation_answer").filter(|r| to_me(r)) {
            if let Some(k) = about(r) {
                c.answers.insert(k);
            }
        }
        self.came = Some(c);
    }

    /// Asked at each round of the office, for each claim not yet decided. `words` writes a day as the world does.
    pub fn state<T>(&mut self, book: &Book, law: Option<&DecisionLaw>, c: &Record, t: i64, words: &dyn Fn(i64) -> String) -> (Wait, Vec<Step<T>>) {
        let empty = vec![];
        let needs = law.map_or(&empty, |l| &l.needs);
        let mut steps = vec![];
        let Some(who) = c.speaks_for.clone() else { return (Wait::Ready, steps) };
        self.read_came(book);
        let (mut waiting, mut lapsed) = (false, None::<String>);
        for n in needs {
            let key = format!("{}|{}", c.id, n.id);
            if self.came(book, n, c, &who) {
                continue;
            }
            let Some(&(_, by)) = self.asked.get(&key) else {
                let employer = if n.from == "employer" { self.employer_for(book, &who) } else { None };
                if n.from == "employer" && employer.is_none() {
                    // (Nobody to ask yet: the claimant's papers may name their last employer, so while those are out we wait; once they are in, or none
                    // are asked for, and no one is named and no pay was ever reported for the claimant, what cannot be had is not waited for.)
                    let papers_out = needs.iter().any(|x| {
                        x.from == "claimant" && !self.came(book, x, c, &who) && t < self.asked.get(&format!("{}|{}", c.id, x.id)).map_or(i64::MIN, |a| a.1)
                    });
                    if papers_out {
                        waiting = true;
                    }
                    continue;
                }
                let by = t + n.within_days * DAY;
                self.asked.insert(key, (t, by));
                let mut d = serde_json::json!({ "claim": c.id, "need": n.id, "what": n.what, "by": by });
                if n.from == "employer" {
                    d["about"] = Value::from(who.clone());
                }
                let due = words(by);
                steps.push(if n.from == "claimant" {
                    because(
                        format!("Claim {} waits for what the law asks of the claimant ({}): asking {who}, to send it within {} days.", c.id, n.what, n.within_days),
                        vec![say(
                            "evidence_request",
                            &format!("For your claim {}: please send {}, within {} days (by {due}).", c.id, n.what, n.within_days),
                            Say { to: Some(vec![who.clone()]), visible: Some(crate::steps::Visible::Only(vec![who.clone(), self.me.clone()])), basis: Some(c.id.clone()), data: Some(d), ..Default::default() },
                        )],
                    )
                } else {
                    let employer = employer.unwrap_or_default();
                    because(
                        format!("Claim {} waits for {employer} to confirm {}: asking, to answer within {} days.", c.id, n.what, n.within_days),
                        vec![say(
                            "confirmation_request",
                            &format!("For the claim {} of {who}: please confirm {}, within {} days (by {due}).", c.id, n.what, n.within_days),
                            Say { to: Some(vec![employer.clone()]), visible: Some(crate::steps::Visible::Only(vec![employer, self.me.clone()])), basis: Some(c.id.clone()), data: Some(d), ..Default::default() },
                        )],
                    )
                });
                waiting = true;
                continue;
            };
            if t < by {
                waiting = true;
                continue;
            }
            if n.otherwise == "refuse" && lapsed.is_none() {
                lapsed = Some(format!(
                    "{} within {} days ({})",
                    if n.from == "claimant" { "the papers asked for did not come" } else { "the confirmation asked for did not come" },
                    n.within_days,
                    n.what
                ));
            }
        }
        if let Some(why) = lapsed {
            return (Wait::Lapsed(why), steps);
        }
        (if waiting { Wait::Waiting } else { Wait::Ready }, steps)
    }
}

/// How a decision looked at again came out.
pub struct Redone<T> {
    pub changed: bool,
    pub found: String,
    pub steps: Vec<Step<T>>,
}

/// An office looking at its own decision again when asked (decisions.ts `Reconsiderations`): a request on file
/// addressed to it, about one of its decisions of a kind whose law has a review. Inside the law's time it does the
/// deciding again, on the facts now on file, and records what it found; a decision found wrong is put right by the
/// office itself; one found right is said to stand. A request after the time the law gives is answered no, and why.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Reconsiderations {
    me: String,
    kinds: Vec<String>,
    handled: std::collections::BTreeSet<String>,
    /// Reviews done this round, by decision (the file shows them from the next look).
    done: BTreeMap<String, bool>,
}

impl Reconsiderations {
    pub fn new(me: &str, kinds: &[&str]) -> Self {
        Reconsiderations { me: me.to_string(), kinds: kinds.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }

    /// The outcome of the review we made of a decision, newest first: "changed" is true, "upheld" false.
    fn reviewed(&self, book: &Book, decision: &str) -> Option<bool> {
        let mut mine: Vec<&Arc<Record>> =
            book.all("decision_review").filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str()) && data(r).s("decision") == Some(decision)).collect();
        mine.sort_by(|a, b| b.at.cmp(&a.at));
        mine.iter().find_map(|x| match data(x).s("outcome") {
            Some("changed") => Some(true),
            Some("upheld") => Some(false),
            _ => None,
        })
    }

    pub fn steps<T>(&mut self, book: &Book, t: i64, redo: &mut dyn FnMut(&Record, &Record) -> Option<Redone<T>>) -> Vec<Step<T>> {
        let mut steps = vec![];
        let mut requests: Vec<&Arc<Record>> = book.open("review_request").filter(|x| addressed_to(x).iter().any(|a| a == &self.me) && !self.handled.contains(&x.id)).collect();
        requests.sort_by(|a, b| made_at(a).cmp(&made_at(b)).then_with(|| filed_before(&a.id, &b.id)));
        for r in requests {
            let Some(about) = data(r).s("about").and_then(|a| book.get(a)) else { continue };
            let kind = crate::common::kind(about);
            // (Not about one of our decisions of a kind with a review: some other request, not ours to look at again.)
            let Some(kind) = kind else { continue };
            if about.speaks_for.as_deref() != Some(self.me.as_str()) || !self.kinds.iter().any(|k| k == kind) {
                continue;
            }
            let law = decision_law(book, kind, data(about).s("payment"));
            let Some(review) = law.as_ref().and_then(|l| l.review.as_ref()) else { continue };
            self.handled.insert(r.id.clone());
            let from = r.speaks_for.clone().unwrap_or_default();
            let matter = data(r).s("matter").unwrap_or("").to_string();
            let left = days_left(about.at, review.within_days, t);
            let say2 = |steps: &mut Vec<Step<T>>, granted: bool, outcome: &str, found: &str, text: &str, more: Vec<Step<T>>| {
                let mut answer = serde_json::json!({ "request": r.id, "matter": matter, "granted": granted, "review": outcome, "decision": about.id });
                if !granted {
                    answer["reason"] = Value::from(found);
                }
                steps.push(because(
                    format!("{from} asks us to look at our decision {} again: {found}.", about.id),
                    vec![
                        say(
                            "decision_review",
                            &format!("Review of {}, asked by {from}: {text}", about.id),
                            Say {
                                to: Some(vec![from.clone()]),
                                visible: Some(crate::steps::Visible::Only(vec![from.clone(), self.me.clone()])),
                                basis: Some(about.id.clone()),
                                data: Some(serde_json::json!({ "decision": about.id, "kind": kind, "request": r.id, "outcome": outcome, "found": found, "asked_by": from, "decided_on": about.at })),
                                ..Default::default()
                            },
                        ),
                        say(
                            "remedy_answer",
                            &format!("Answer to your request {}: {}: {text}", r.id, if granted { "yes" } else { "no" }),
                            Say { to: Some(vec![from.clone()]), visible: Some(crate::steps::Visible::Only(vec![from.clone(), self.me.clone()])), basis: Some(r.id.clone()), data: Some(answer), ..Default::default() },
                        ),
                    ],
                ));
                steps.extend(more);
            };
            if left < 0 {
                say2(
                    &mut steps,
                    false,
                    "out_of_time",
                    &format!("the law allows {} days to ask, and the decision was made {} days ago", review.within_days, (t - about.at).div_euclid(DAY)),
                    &format!("it was asked for after the {} days the law allows.", review.within_days),
                    vec![],
                );
                continue;
            }
            // (Looked at already: from the file, which is the record of it; or from this round's, before it shows.)
            let first = self.done.get(&about.id).copied().or_else(|| self.reviewed(book, &about.id));
            if let Some(changed) = first {
                say2(
                    &mut steps,
                    changed,
                    if changed { "changed" } else { "upheld" },
                    "it has been looked at already",
                    if changed { "it was found wrong and has been put right." } else { "it was looked at and stands." },
                    vec![],
                );
                continue;
            }
            let Some(out) = redo(about, r) else {
                self.handled.remove(&r.id);
                continue;
            };
            self.done.insert(about.id.clone(), out.changed);
            let text = if out.changed { format!("found wrong: {}; put right.", out.found) } else { format!("looked at again: {}; it stands.", out.found) };
            say2(&mut steps, out.changed, if out.changed { "changed" } else { "upheld" }, &out.found, &text, out.steps);
        }
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::boundary::shared::rig::*;
    use serde_json::json;

    fn book_of(records: Vec<Arc<Record>>) -> Book {
        let mut b = Book::new();
        b.take_all(&records);
        b
    }

    #[test]
    fn the_latest_support_law_is_read_with_its_payers() {
        let old = st("rec.1", 0, "law", "state", json!({ "payments": [{ "id": "old", "every_days": 14, "amount": { "flat": 1 } }] }));
        let new = st(
            "rec.2",
            10,
            "law",
            "state",
            json!({ "payments": [
                { "id": "pension", "every_days": 14, "account": "acct", "who": { "from_age": 65 }, "amount": { "flat": 90000 }, "lasts": { "until_age": 120 } },
                { "id": "dole", "payer": "other", "every_days": 7, "who": { "out_of_work": true, "record": { "months": 2 } }, "amount": { "share_bps": 5000, "of": "net", "most": [{ "from_age": 30, "amount": 100 }, { "from_age": 50, "amount": 200 }] } },
                { "id": "broken", "every_days": "often" },
            ] }),
        );
        let (id, rules) = support_law(&book_of(vec![old, new])).unwrap();
        assert_eq!(id, "rec.2");
        assert_eq!(rules.iter().map(|r| (r.id.as_str(), r.payer.as_deref())).collect::<Vec<_>>(), [("pension", Some("state")), ("dole", Some("other"))]);
        assert!(rules[0].for_age() && !rules[0].for_out_of_work());
        assert!(rules[1].for_out_of_work() && !rules[1].for_age());
        assert!(matches!(&rules[1].amount, Amount::Share { most: Some(Most::ByAge(v)), .. } if v.len() == 2));
        assert!(support_law(&Book::new()).is_none());
    }

    #[test]
    fn withholding_reckons_a_year_of_the_pay_and_a_periods_part() {
        let law = st("rec.1", 0, "law", "state", json!({ "tax": "income", "brackets": [{ "from": 0, "rate_bps": 0 }, { "from": 1_000_000, "rate_bps": 1000 }, { "from": 5_000_000, "rate_bps": 2000 }], "levy_bps": 100, "levy_from": 100 }));
        let l = income_tax_law(&book_of(vec![law])).unwrap();
        // A 14-day pay of 100,000 is 2,607,142 a year (floor): tax 160,714 + levy 26,071 = 186,785; a period's part is 7,166.
        assert_eq!(withholding(Some(&l), 100_000, 14 * DAY), 186_785 * 14 * DAY / YEAR);
        assert_eq!(withholding(Some(&l), 0, 14 * DAY), 0);
        assert_eq!(withholding(None, 100_000, 14 * DAY), 0);
    }

    #[test]
    fn charges_on_charges_deductions_and_reliefs() {
        let law = st(
            "rec.1",
            0,
            "law",
            "state",
            json!({ "tax": "income", "charges": [
                { "id": "contrib", "schedule": [{ "from": 0, "rate_bps": 1000 }], "base": { "up_to": 2_000_000 } },
                { "id": "tax", "base": { "less": [{ "charges": ["contrib"] }, { "amount": 500_000, "tapers": { "above": 4_000_000, "bps": 5000 } }] },
                  "schedule": [{ "from": 0, "rate_bps": 2000, "rising_to_bps": 3000 }, { "from": 1_000_000, "rate_bps": 3000 }], "reliefs": [{ "amount": 10_000 }] },
                { "id": "surcharge", "base": { "on": "tax" }, "schedule": [{ "from": 0, "rate_bps": 1000 }], "reliefs": [{ "none_due_up_to": 50_000 }] },
            ] }),
        );
        let l = income_tax_law(&book_of(vec![law])).unwrap();
        // pay 3,000,000 a year: contrib = 10% of min(pay, 2,000,000) = 200,000; tax base = 3,000,000 - 200,000 - 500,000 = 2,300,000;
        // first band (1,000,000 wide) rises 20%->30%: 1,000,000 x 25% = 250,000; above: 1,300,000 x 30% = 390,000; less the 10,000 credit = 630,000;
        // surcharge 10% of 630,000 = 63,000 (above the 50,000 it is due on).
        assert_eq!(l.annual(3_000_000), 200_000 + 630_000 + 63_000);
        // a 365-day period makes the year the period.
        assert_eq!(withholding(Some(&l), 3_000_000, YEAR), 893_000);
    }

    #[test]
    fn the_decision_law_prefers_the_rule_for_the_payment() {
        let law = st(
            "rec.1",
            5,
            "law",
            "state",
            json!({ "decisions": [
                { "kind": "benefit_decision", "needs": [{ "id": "n1", "from": "claimant", "what": "a form", "within_days": 5, "else": "refuse" }] },
                { "kind": "benefit_decision", "payments": ["dole"], "refused_by": "office-holder", "review": { "within_days": 30, "grounds": "wrong" } },
                { "kind": "other" },
            ] }),
        );
        let b = book_of(vec![law]);
        assert_eq!(decision_law(&b, "benefit_decision", Some("dole")).unwrap().refused_by.as_deref(), Some("office-holder"));
        assert_eq!(decision_law(&b, "benefit_decision", Some("pension")).unwrap().needs.len(), 1);
        assert!(decision_law(&b, "nothing", None).is_none());
    }

    #[test]
    fn a_claim_waits_for_the_papers_the_law_asks_for_and_lapses_when_they_do_not_come() {
        let law = DecisionLaw {
            kind: "benefit_decision".into(),
            payments: None,
            needs: vec![Need { id: "n1".into(), from: "claimant".into(), what: "proof of age".into(), within_days: 5, otherwise: "refuse".into() }],
            review: None,
            refused_by: None,
        };
        let claim = st_to("rec.9", 0, "benefit_claim", "alice", &["office"], json!({}));
        let mut w = Waits::new("office");
        let words = |t: i64| format!("day {}", t / DAY);
        let (state, steps) = w.state::<()>(&Book::new(), Some(&law), &claim, 0, &words);
        assert_eq!((state, steps.len()), (Wait::Waiting, 1));
        // Asked once; still waiting before the day.
        let (state, steps) = w.state::<()>(&Book::new(), Some(&law), &claim, 3 * DAY, &words);
        assert_eq!((state, steps.len()), (Wait::Waiting, 0));
        let (state, _) = w.state::<()>(&Book::new(), Some(&law), &claim, 5 * DAY, &words);
        assert!(matches!(state, Wait::Lapsed(why) if why.contains("papers asked for did not come within 5 days")));
        // The papers came: ready.
        let evidence = st_to("rec.10", 2 * DAY, "evidence", "alice", &["office"], json!({ "claim": "rec.9", "need": "n1" }));
        let (state, _) = w.state::<()>(&book_of(vec![evidence]), Some(&law), &claim, 5 * DAY, &words);
        assert_eq!(state, Wait::Ready);
        assert_eq!(w.state::<()>(&Book::new(), None, &claim, 0, &words).0, Wait::Ready);
    }
}
