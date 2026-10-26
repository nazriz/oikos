//! What every actor stands on (participants/src/behaviour/common.ts and contracts.ts helpers, rewritten; step 1b of
//! docs/port-guide.md): the book of what it has seen, reading records, asking whoever keeps something, letters,
//! standing work and directions, reading laws against an act, and the small shared rules of time and money.
//!
//! Each item names the TS it replaces. Where the Rust decides fresh it says so (docs/port-guide.md, section 2).

pub mod asking;
pub mod book;
pub mod calls;
pub mod laws;
pub mod letters;
pub mod money;
pub mod work;

pub use asking::{ask, go_see, look_up, owner_looks, visited, who_wrote, Asked, LOOKS_MAX, VISIT_MAX};
pub use calls::{move_in, move_out, record, vote, withdraw};
pub use book::{Book, ClaimKey, NoticeSeen, PositionSeen, Reading};
pub use laws::{breaches, holds_of, noted, prohibitions};
pub use letters::{acknowledged, message, office_note, what_it_acts_on, Answering, Letter, Letters, PAYEE_DIED, PAYMENT_FAILED, REPORT_TAIL};
pub use money::{bill_settled, brought_forward, cents, notices_of, own_account, own_banked, published_price, receipts, OwnAccount};
pub use work::{approval_of, CounterWork, Directions, Pace, Part, StandingWork, WorkOrder};

use oikos_sight::{Record, RecordBody};
use serde_json::Value;
use std::cmp::Ordering;

pub const DAY: i64 = crate::DAY;
/// A month in TS's reckoning (30 days). Where the law or a contract says a month, use the calendar's
/// (`oikos_rules::calendar::Calendar::months_after`); this is for figures that were always 30 days (a rent's period
/// in a lease's terms, `every: 2_592_000`).
pub const MONTH: i64 = 30 * DAY;
pub const YEAR: i64 = 365 * DAY;

/// How long a notice takes to be given once it is sent (foundations F7): publishing it takes the publisher's time, and
/// it waits behind what they have in hand; the paper is on the record when that is done.
pub const NOTICE_LAG: i64 = 3_600;

/// The day a change begins that a notice of `lead` seconds is given for, sent at `at`: the first day to begin once the
/// notice has run, counted from when it is on the record (common.ts `startsOn`).
pub fn starts_on(at: i64, lead: i64) -> i64 {
    ((at + NOTICE_LAG + lead).div_euclid(DAY) + 1) * DAY
}

/// A moment in the world's words, for reasons, letters and reports: the one place every lane writes a date, so the
/// names-and-dates lane changes it once (docs/design/names-and-dates.md). With a calendar: the civil date as the place
/// writes one ("12 March 2026", the profile's pattern; ISO where the config gives none); without one (the old towns):
/// "year 1, day 12", and a moment before the start as "N days before the year began" (common.ts `whenWords`, forms.ts
/// `dateWords`). `when_words_long` adds the weekday ("Thursday 12 March 2026"), for a letter's head.
pub fn when_words(t: i64, world: &crate::WorldInfo) -> String {
    dated(t, world, false)
}

/// As `when_words`, with the weekday where the world's calendar writes one.
pub fn when_words_long(t: i64, world: &crate::WorldInfo) -> String {
    dated(t, world, true)
}

fn dated(t: i64, world: &crate::WorldInfo, long: bool) -> String {
    if let Some(cal) = &world.calendar {
        return world.date_style.clone().unwrap_or_default().words(cal, t, long);
    }
    if t < 0 {
        let n = (-t + DAY - 1) / DAY;
        return format!("{n} day{} before the year began", if n == 1 { "" } else { "s" });
    }
    format!("year {}, day {}", t / YEAR + 1, (t % YEAR) / DAY + 1)
}

/// A date a seat or a paper wrote, read to the moment its day begins: the place's way ("12 March 2026") where the world
/// has a calendar, the old "year N, day D" always (an old paper still reads). None: not a date.
pub fn read_date(text: &str, now: i64, world: &crate::WorldInfo) -> Option<i64> {
    if let (Some(cal), Some(style)) = (&world.calendar, &world.date_style) {
        if let Some(t) = style.parse(cal, text, now) {
            return Some(t);
        }
    }
    let t = text.trim().to_lowercase();
    let rest = t.strip_prefix("year ")?;
    let (y, d) = rest.split_once(", day ").or_else(|| rest.split_once(" day "))?;
    let (y, d): (i64, i64) = (y.trim().parse().ok()?, d.trim().parse().ok()?);
    ((y >= 1) && (1..=365).contains(&d)).then(|| ((y - 1) * 365 + (d - 1)) * DAY)
}

/// A length of time in words, as people say one (forms.ts `durationWords`): whole days ("14 days", "1 day"); else
/// whole hours; else hours and minutes; seconds only where nothing rounder fits.
pub fn duration_words(seconds: i64) -> String {
    let n = |x: i64, w: &str| format!("{x} {w}{}", if x == 1 { "" } else { "s" });
    if seconds % DAY == 0 {
        return n(seconds / DAY, "day");
    }
    if seconds < 0 {
        return n(seconds, "second");
    }
    if seconds % 3_600 == 0 {
        return n(seconds / 3_600, "hour");
    }
    if seconds % 60 == 0 {
        return if seconds > 3_600 { format!("{} {}", n(seconds / 3_600, "hour"), n((seconds % 3_600) / 60, "minute")) } else { n(seconds / 60, "minute") };
    }
    n(seconds, "second")
}

/// For each speaker, its latest standing statement of a kind that passes a test (of several made at the same time,
/// the first seen): what common.ts's `Latest` worked out (a shopper comparing every shop's price list). Decided fresh:
/// worked out on each call, in one pass; TS cached it across books, which needs shared state.
pub fn latest_by_speaker<'a>(book: &'a Book, kind: &str, test: impl Fn(&Record) -> bool) -> std::collections::BTreeMap<Option<&'a str>, &'a std::sync::Arc<Record>> {
    let mut by: std::collections::BTreeMap<Option<&'a str>, &'a std::sync::Arc<Record>> = Default::default();
    for r in book.open(kind) {
        if !test(r) {
            continue;
        }
        let k = r.speaks_for.as_deref();
        match by.get(&k) {
            Some(best) if r.at <= best.at => {}
            _ => {
                by.insert(k, r);
            }
        }
    }
    by
}

/// An amount in words, as the world writes its money (common.ts `usd`, money.ts `moneyNow`): for reasons and letters.
pub fn money_words(n: i64, world: &crate::WorldInfo) -> String {
    match &world.currency {
        Some(c) => oikos_sight::calls::format_money(&n.to_string(), c),
        None => n.to_string(),
    }
}

static NULL: Value = Value::Null;

/// A record's data (`Null` where it has none, or is not a statement).
pub fn data(r: &Record) -> &Value {
    match &r.body {
        RecordBody::Statement { data: Some(d), .. } => d,
        _ => &NULL,
    }
}

/// A statement's kind (none: not a statement).
pub fn kind(r: &Record) -> Option<&str> {
    match &r.body {
        RecordBody::Statement { kind, .. } => Some(kind),
        _ => None,
    }
}

/// Whether a record is a statement of this kind.
pub fn is_kind(r: &Record, k: &str) -> bool {
    kind(r) == Some(k)
}

/// A statement's words (empty if not a statement).
pub fn text(r: &Record) -> &str {
    match &r.body {
        RecordBody::Statement { text, .. } => text,
        _ => "",
    }
}

/// Whom a statement is addressed to.
pub fn addressed_to(r: &Record) -> &[oikos_sight::Id] {
    match &r.body {
        RecordBody::Statement { addressed_to: Some(a), .. } => a,
        _ => &[],
    }
}

/// A statement's offer, practice, assertion, formal part or breakdown (`Null` where it has none).
pub fn part<'a>(r: &'a Record, which: Piece) -> &'a Value {
    match &r.body {
        RecordBody::Statement { offer, practice, assertion, formal, adico, registry, .. } => match which {
            Piece::Offer => offer.as_ref(),
            Piece::Practice => practice.as_ref(),
            Piece::Assertion => assertion.as_ref(),
            Piece::Formal => formal.as_ref(),
            Piece::Adico => adico.as_ref(),
            Piece::Registry => registry.as_ref(),
        }
        .unwrap_or(&NULL),
        _ => &NULL,
    }
}

/// The parts of a statement besides its data (`part`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Piece {
    Offer,
    Practice,
    Assertion,
    Formal,
    Adico,
    Registry,
}

/// The records a record cites, in order (contracts.ts `basesOf`).
pub fn bases_of(r: &Record) -> &[oikos_sight::Id] {
    r.basis.as_ref().map_or(&[], |b| b.ids())
}

/// Whether a record cites this one as a basis (contracts.ts `cites`).
pub fn cites(r: &Record, record: &str) -> bool {
    bases_of(r).iter().any(|b| b == record)
}

/// The records cited, as they are said: "rec.4", "rec.4 and rec.9", "rec.4, rec.9 and rec.12" (contracts.ts `citedWords`).
pub fn cited_words(r: &Record) -> String {
    let b = bases_of(r);
    match b.len() {
        0 => String::new(),
        1 => b[0].to_string(),
        n => format!("{} and {}", b[..n - 1].join(", "), b[n - 1]),
    }
}

/// When a standing paper first falls due (contracts.ts `firstDue`): `data.first_at` (a moment, not before the day the
/// paper was made), else the paper's time plus `data.first`, else plus `otherwise`.
pub fn first_due(r: &Record, otherwise: i64) -> i64 {
    let d = data(r);
    if let Some(f) = d.get("first_at").and_then(Value::as_i64) {
        return f.max(r.at - r.at.rem_euclid(DAY));
    }
    r.at + d.get("first").and_then(Value::as_i64).unwrap_or(otherwise)
}

/// When a paper was made: for one brought forward from before the year (`data.brought_forward`, `data.since` a
/// negative moment), that moment; otherwise when it was filed (common.ts `madeAt`).
pub fn made_at(r: &Record) -> i64 {
    let d = data(r);
    match (d.get("brought_forward"), d.get("since").and_then(Value::as_i64)) {
        (Some(b), Some(s)) if truthy(b) && s < 0 => s,
        _ => r.at,
    }
}

/// JavaScript's truthiness of a JSON value, for reading flags TS read with `!!`.
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// Reading a JSON object's fields as TS did, leniently: a string, a whole number (from a number or digits), a list of
/// ids. For modules not yet reading a typed paper (`papers::read`).
pub trait Fields {
    fn s(&self, key: &str) -> Option<&str>;
    fn i(&self, key: &str) -> Option<i64>;
    fn ids(&self, key: &str) -> Vec<&str>;
    fn flag(&self, key: &str) -> bool;
}
impl Fields for Value {
    fn s(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(Value::as_str)
    }
    fn i(&self, key: &str) -> Option<i64> {
        self.get(key).and_then(crate::papers::lenient::whole)
    }
    fn ids(&self, key: &str) -> Vec<&str> {
        match self.get(key) {
            Some(Value::String(s)) => vec![s.as_str()],
            Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect(),
            _ => vec![],
        }
    }
    fn flag(&self, key: &str) -> bool {
        self.get(key).is_some_and(truthy)
    }
}

/// Records in the order they were filed: `rec.9` before `rec.10` (a string comparison puts `rec.1000` before
/// `rec.999`, so the order of two papers turned on how many records the town had made: traced at F1). Ids that are not
/// `<name><digits>` with the same name fall back to byte order (common.ts `filedBefore`).
pub fn filed_before(a: &str, b: &str) -> Ordering {
    fn split(s: &str) -> Option<(&str, &str)> {
        let d = s.bytes().rev().take_while(u8::is_ascii_digit).count();
        (d > 0).then(|| s.split_at(s.len() - d))
    }
    if let (Some((pa, na)), Some((pb, nb))) = (split(a), split(b)) {
        if pa == pb {
            // (Digits compared as numbers, however long: by length once leading zeros are gone, then by bytes.)
            let (na, nb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
            return na.len().cmp(&nb.len()).then_with(|| na.cmp(nb));
        }
    }
    a.cmp(b)
}

/// A day's shared work (common.ts `team`): of those here, the team that gets most done when the work is shared evenly
/// (each does the same share, so a team's hours are its size times the least time any of them has left today). Ties
/// in hours left are broken by id. Returns the team in id order and each one's share.
pub fn team(here: &[String], hours_left: impl Fn(&str) -> i64) -> (Vec<String>, i64) {
    let mut by_hours: Vec<&String> = here.iter().collect();
    by_hours.sort_by(|a, b| hours_left(b).cmp(&hours_left(a)).then_with(|| a.cmp(b)));
    let (mut best_n, mut best_each) = (0usize, 0i64);
    for (i, w) in by_hours.iter().enumerate() {
        let each = hours_left(w).max(0);
        if each * (i as i64 + 1) > best_each * best_n as i64 {
            best_n = i + 1;
            best_each = each;
        }
    }
    let mut who: Vec<String> = by_hours[..best_n].iter().map(|s| (*s).clone()).collect();
    who.sort();
    (who, best_each)
}

/// Out of time (a `no_time_left` refusal): whose, and how many seconds of work they have left today, as the world
/// counts it (common.ts `outOfTime`).
pub fn out_of_time(o: &oikos_sight::Outcome) -> Option<(Option<String>, i64)> {
    let r = o.refusal.as_ref()?;
    if r.code != oikos_contracts::events::RefusalCode::NoTimeLeft {
        return None;
    }
    let d = r.detail.as_deref().unwrap_or("");
    // "<who> has <n> s of work left today"
    let mut words = d.split(' ');
    match (words.next(), words.next(), words.next(), words.next()) {
        (Some(who), Some("has"), Some(n), Some("s")) if n.bytes().all(|b| b.is_ascii_digit()) => {
            Some((Some(who.to_string()), n.parse().unwrap_or(0)))
        }
        _ => Some((None, 0)),
    }
}

/// The next time of day `at` (seconds) on a working day after `t`: the first `days` of each week (common.ts
/// `nextLook`). Decided fresh where a world has a calendar: lanes should prefer `next_working(cal, ...)`.
pub fn next_look(t: i64, at: i64, days: i64) -> i64 {
    let mut d = t.div_euclid(DAY);
    loop {
        if d.rem_euclid(7) < days && d * DAY + at > t {
            return d * DAY + at;
        }
        d += 1;
    }
}

/// The next time of day `at` after `t` on a working day of the world's calendar (its days of rest and holidays).
pub fn next_working(cal: &oikos_rules::calendar::Calendar, t: i64, at: i64) -> i64 {
    let mut d = t.div_euclid(DAY);
    for _ in 0..3700 {
        let m = d * DAY + at;
        if m > t && cal.working_day(d * DAY) {
            return m;
        }
        d += 1;
    }
    t + DAY
}

/// A space nobody lives in any more, as someone looking in from outside can tell: nobody there, and nobody in or out
/// of it for a day (common.ts `stoodEmpty`).
pub fn stood_empty(sp: &oikos_sight::SiteSpace, t: i64) -> bool {
    sp.occupants.as_ref().is_none_or(Vec::is_empty) && sp.left.as_ref().is_none_or(|l| l.iter().all(|x| x.at <= t - DAY))
}

/// A state variable's value today, as perceived: its value on the day seen, plus its daily change since, within its
/// bounds (common.ts `variableToday`).
pub fn variable_today(v: &oikos_sight::VariableView, t: i64) -> i64 {
    let days = (t.div_euclid(DAY) - v.as_of_day).max(0);
    (v.value + v.per_day * days).clamp(v.min, v.max)
}

/// The structure a space is in (`apts-3/dwelling.2` -> `apts-3`).
pub fn structure_of(space: &str) -> &str {
    space.split('/').next().unwrap_or(space)
}

/// The cells a lot covers, from its registry record (a standing statement of kind `lot`).
pub fn cells_of<'a>(book: &'a Book, lot: &str) -> Vec<&'a str> {
    match book.get(lot) {
        Some(r) if is_kind(r, "lot") && !book.withdrawn(lot) => data(r).ids("cells"),
        _ => vec![],
    }
}

/// The standing lot a cell is in, if the registry has one.
pub fn lot_of<'a>(book: &'a Book, cell: &str) -> Option<&'a str> {
    book.lot_over(cell).map(|r| r.id.as_str())
}

/// Signatures on a petition this participant can see: votes with choice "sign", one per signing entity.
pub fn petition_signatures(book: &Book, petition: &str) -> usize {
    let mut who = std::collections::BTreeSet::new();
    for r in book.of_type("vote") {
        if let (RecordBody::Vote { ballot, choice }, Some(s)) = (&r.body, &r.speaks_for) {
            if ballot == petition && choice == "sign" {
                who.insert(s.as_str());
            }
        }
    }
    who.len()
}

/// A petition's signature count as its organiser last published it (0 if never).
pub fn published_count(book: &Book, petition: &Record) -> i64 {
    book.open("petition_count")
        .filter(|c| data(c).s("petition") == Some(petition.id.as_str()) && c.speaks_for == petition.speaks_for)
        .last()
        .and_then(|c| data(c).i("signatures"))
        .unwrap_or(0)
}

/// A whole number drawn evenly from `lo..=hi` (common.ts `between`, on integers; `hi < lo`: `lo`).
pub fn between(lo: i64, hi: i64, rng: &mut oikos_core::rng::Rng) -> i64 {
    if hi <= lo {
        return lo;
    }
    lo + rng.below((hi - lo + 1) as u64) as i64
}

/// A key a draw about a paper is named for (docs/reliability.md, "Draws and the order papers were filed in"): who it
/// is from, what it concerns, and which time this is for that pair, never the paper's number in the world's file. The
/// same paper is always the same occurrence (common.ts `Occurrences`). Saved with the actor.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Occurrences {
    count: std::collections::BTreeMap<String, u64>,
    of: std::collections::BTreeMap<String, String>,
}

impl Occurrences {
    pub fn key(&mut self, paper: &str, about: &[Option<&str>]) -> String {
        if let Some(k) = self.of.get(paper) {
            return k.clone();
        }
        let is_rec = |x: &str| x.strip_prefix("rec.").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
        let base: Vec<&str> = about.iter().map(|x| x.filter(|s| !is_rec(s)).unwrap_or("")).collect();
        let base = base.join("/");
        let n = self.count.entry(base.clone()).or_insert(0);
        *n += 1;
        let k = format!("{base}#{n}");
        self.of.insert(paper.to_string(), k.clone());
        k
    }
}

#[cfg(test)]
mod tests;
