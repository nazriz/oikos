//! An office's books, and the clerk who keeps them (participants/src/behaviour/books.ts, with the bug-hunt
//! correction of 2026-10-17; docs/behaviour/office-books.md).
//!
//! The code that runs an office works out, wake after wake, what stands open at it: who is behind with the rent and
//! since when, which requests wait for an answer, which invoices are unpaid. A person put in the same office was shown
//! each paper once, as it came: nothing kept the running list. A real office has someone who keeps its books. Where a
//! model holds an office, a clerk of the office's staff reads the office's own papers and accounts, the same ones and
//! the same way as the office's code (each module's `books`), and files a paper on the organisation's own file when
//! what stands open has changed: what is new, what is settled, how many stand in all, with the whole list in the paper
//! for whoever opens it. The paper is the organisation's own, seen by it alone. Nothing is done about any of it by the
//! clerk, and a code-run office has no such paper.
//!
//! Ported to Rust. Decided fresh:
//! - **A new clerk carries on from the last paper on the organisation's file** (bug hunt 2026-10-17): what stood open
//!   at that paper, and what has left the list since, is said; the clerk never starts from an empty memory.
//! - Dates are written through `when_words`; the key that says nothing has changed is the JSON of the open list.
//! - **The readers** (`OfficeBooks`, one for each module that keeps books, chosen by `books_of`) are ported from the
//!   seat-side `openbooks*.ts` as `openbooks`, `openbooks_town` and `openbooks_venues`: integers, ordered collections,
//!   the same papers out. (`daybook`, `roster`, `tally` and `diary` are not readers: they are what a seat is shown of
//!   an office's file, and stay TS.) A module with no reader still cannot have a clerk.

use super::spread;
use crate::common::{addressed_to, bases_of, data, truthy, when_words, Book, Fields, DAY};
use crate::steps::{because, say, Say, Visible};
use crate::{Action, Actor, Cx, Ctx, Kind, Picture};
use oikos_sight::RecordBody;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub struct Clerk;

/// The kind of the paper a clerk files (a statement on the organisation's own file).
pub const BOOKS: &str = "office_books";
/// The kind of the weekly chief-of-staff briefing filed for the mayor when enabled.
pub const BRIEFING: &str = "staff_briefing";
/// How often the mayor's clerk files a weekly briefing (days).
pub const BRIEFING_EVERY_DAYS: i64 = 7;
/// Pre-election briefing filed this many days before polling day (plain facts, no advice).
pub const PRE_POLL_BRIEFING_DAYS: i64 = 10;
/// How old the clerk's last paper may be before a running figure that has moved is filed for its own sake (days).
pub const RUNNING_EVERY_DAYS: i64 = 7;
/// The most entries of a heading a paper's words name (the rest are in its list).
const NAMED: usize = 4;
/// The most entries of a heading whose day has come that a paper's words set out in full each time.
const ALWAYS_NAMED: usize = 60;
/// The most entries of a heading a paper's list holds.
const LISTED: usize = 200;
/// How often the clerk keeps the books: its round, a day.
pub const CLERK_ROUND_DAYS: i64 = 1;

/// Whose staff a post is: the office itself, by the post's own id (`works-staff` is the staff of `works`).
pub fn office_of(position: Option<&str>) -> String {
    position.unwrap_or("").trim_end_matches("-staff").to_string()
}

/// One thing that stands open on an office's books: what it is by its paper's id, a line in the world's words, and,
/// where they apply, since when, how much, and when its day comes. `running`: a running figure whose line moves with
/// every payment, which alone is no reason to file a paper.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpenItem {
    pub id: String,
    pub line: String,
    pub since: Option<i64>,
    pub amount: Option<i64>,
    pub due: Option<i64>,
    pub running: bool,
}

/// A heading of the books: what kind of thing stands open, each one, the most pressing first. `always`: things whose
/// day has come and that wait on the office-holder, named in every paper first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpenHeading {
    pub what: String,
    pub items: Vec<OpenItem>,
    pub always: bool,
}

impl OpenItem {
    /// An item with an id and its line; the rest is added with the methods below.
    pub fn new(id: impl Into<String>, line: String) -> Self {
        OpenItem { id: id.into(), line, since: None, amount: None, due: None, running: false }
    }
    pub fn since(mut self, v: i64) -> Self {
        self.since = Some(v);
        self
    }
    pub fn amount(mut self, v: Option<i64>) -> Self {
        self.amount = v;
        self
    }
    pub fn due(mut self, v: Option<i64>) -> Self {
        self.due = v;
        self
    }
    pub fn running(mut self) -> Self {
        self.running = true;
        self
    }
}

/// An office's books as a clerk keeps them: fed what the office is shown, and asked what stands open now (`world`:
/// how the place writes a date and its money).
pub trait OfficeBooks: Send {
    fn absorb(&mut self, pic: &Picture);
    fn open(&self, t: i64, world: &crate::WorldInfo) -> Vec<OpenHeading>;
    fn save(&self) -> Result<Value, String>;
    fn restore(&mut self, saved: &Value) -> Result<(), String>;
}

/// The reader of the books of a module's office, by the module's name (`of`): `me` is the organisation the office is
/// of, `office` its id, `params` the module's own parameters (`with`). The readers are `openbooks` (the letting office
/// and the support office), `openbooks_town` (the town hall's offices) and `openbooks_venues` (the offices that hear
/// and decide, a union's organiser, a lender's office): each a restatement of what the module's code works out for
/// itself, read from the same papers (participants/src/behaviour/openbooks*.ts).
pub fn books_of(of: &str, me: &str, office: &str, params: &serde_json::Map<String, Value>) -> Option<Box<dyn OfficeBooks>> {
    super::openbooks::reader(of, me, office, params)
        .or_else(|| super::openbooks_town::reader(of, me, office, params))
        .or_else(|| super::openbooks_venues::reader(of, me, office, params))
}

/// What stood open at the last paper: heading -> (id -> line).
type Listed = BTreeMap<String, BTreeMap<String, String>>;

/// What a paper of the books says, given what stood open at the last one (`before`).
pub fn books_paper(office: &str, t: i64, open: &[OpenHeading], before: Option<&Listed>, world: &crate::WorldInfo) -> (String, Value, String) {
    let mut parts: Vec<String> = vec![];
    let key = serde_json::to_string(&open.iter().map(|h| (&h.what, h.items.iter().map(|x| (&x.id, if x.running { "" } else { x.line.as_str() })).collect::<Vec<_>>())).collect::<Vec<_>>()).unwrap_or_default();
    let always: BTreeSet<&str> = open.iter().filter(|h| h.always).map(|h| h.what.as_str()).collect();
    let mut whats: Vec<String> = vec![];
    for w in open.iter().filter(|h| h.always).map(|h| &h.what).chain(open.iter().map(|h| &h.what)).chain(before.iter().flat_map(|b| b.keys())) {
        if !whats.contains(w) {
            whats.push(w.clone());
        }
    }
    // (Something that has moved from one heading to another still stands open: it is new under its heading, and is not
    // said to be "no longer open" under the one it left.)
    let standing: BTreeSet<&str> = open.iter().flat_map(|h| h.items.iter().map(|x| x.id.as_str())).collect();
    let listed: usize = open.iter().filter(|h| h.always).map(|h| h.items.len()).sum();
    let on_list: usize = open.iter().filter(|h| h.always).map(|h| h.items.iter().filter(|x| !before.is_some_and(|b| b.get(&h.what).is_some_and(|m| m.contains_key(&x.id)))).count()).sum();
    let empty = BTreeMap::new();
    for what in &whats {
        let items: &[OpenItem] = open.iter().find(|h| &h.what == what).map_or(&[], |h| h.items.as_slice());
        let was = before.and_then(|b| b.get(what)).unwrap_or(&empty);
        if always.contains(what.as_str()) {
            let fresh = items.iter().filter(|x| !was.contains_key(&x.id)).count();
            let done: Vec<&String> = was.keys().filter(|id| !items.iter().any(|x| &x.id == *id) && !standing.contains(id.as_str())).collect();
            let lines: Vec<&str> = items.iter().take(ALWAYS_NAMED).map(|x| x.line.as_str()).collect();
            parts.push(format!(
                "{what}: {} in all{}: {}{}{}.",
                items.len(),
                if before.is_some() && fresh > 0 { format!(" ({fresh} since the last paper)") } else { String::new() },
                lines.join("; "),
                if items.len() > ALWAYS_NAMED { format!("; and {} more, in this paper's list", items.len() - ALWAYS_NAMED) } else { String::new() },
                if done.is_empty() {
                    String::new()
                } else {
                    format!("; no longer open: {}{}", done.iter().take(NAMED * 2).map(|s| s.as_str()).collect::<Vec<_>>().join(", "), if done.len() > NAMED * 2 { format!(" and {} more", done.len() - NAMED * 2) } else { String::new() })
                }
            ));
            continue;
        }
        let fresh: Vec<&OpenItem> = items.iter().filter(|x| !was.contains_key(&x.id)).collect();
        let changed: Vec<&OpenItem> = items.iter().filter(|x| was.get(&x.id).is_some_and(|l| *l != x.line)).collect();
        let moved = changed.iter().all(|x| x.running);
        let gone: Vec<&String> = was.keys().filter(|id| !items.iter().any(|x| &x.id == *id) && !standing.contains(id.as_str())).collect();
        if items.is_empty() && gone.is_empty() {
            continue;
        }
        let name = |xs: &[&OpenItem]| format!("{}{}", xs.iter().take(NAMED).map(|x| x.line.as_str()).collect::<Vec<_>>().join("; "), if xs.len() > NAMED { format!("; and {} more, in this paper's list", xs.len() - NAMED) } else { String::new() });
        let all: Vec<&OpenItem> = items.iter().collect();
        let said: Vec<String> = [
            if before.is_none() && !items.is_empty() { name(&all) } else { String::new() },
            if before.is_some() && !fresh.is_empty() { format!("new: {}", name(&fresh)) } else { String::new() },
            if before.is_some() && !changed.is_empty() { format!("{}: {}", if moved { "now" } else { "changed" }, name(&changed)) } else { String::new() },
            if gone.is_empty() { String::new() } else { format!("no longer open: {}{}", gone.iter().take(NAMED * 2).map(|s| s.as_str()).collect::<Vec<_>>().join(", "), if gone.len() > NAMED * 2 { format!(" and {} more", gone.len() - NAMED * 2) } else { String::new() }) },
            if before.is_some() && fresh.is_empty() && changed.is_empty() && !items.is_empty() { "the rest as before".into() } else { String::new() },
        ]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect();
        let said = said.join("; ");
        parts.push(format!(
            "{what}: {}{}.",
            if items.is_empty() { "none now".to_string() } else { format!("{} in all", items.len()) },
            if said.is_empty() { String::new() } else { format!("{} {said}", if before.is_none() { ":" } else { ";" }) }
        ));
    }
    let wide = open.iter().any(|h| h.always && h.items.len() > ALWAYS_NAMED);
    let day = if listed > 0 {
        format!(
            " The day's list: {listed} {} on the office-holder with {} come, {}{}. The clerk files the list once a working day. A matter that comes onto it for the first time brings the office-holder to the desk the next working day, so no day need be set for coming back to a matter's day.",
            if listed == 1 { "matter waits" } else { "matters wait" },
            if listed == 1 { "its day" } else { "their day" },
            if wide { format!("{ALWAYS_NAMED} to a heading set out above in full and the rest in this paper's list") } else { "each set out above in full".into() },
            if on_list > 0 { format!("; {on_list} {} on the list for the first time", if on_list == 1 { "is" } else { "are" }) } else { "; none is new on the list".into() }
        )
    } else {
        String::new()
    };
    let text = format!(
        "The books of the office, {}, as its clerk keeps them from the office's own papers and accounts. {}{day}{}",
        when_words(t, world),
        if parts.is_empty() { "Nothing stands open.".to_string() } else { parts.join(" ") },
        if before.is_some() { " (What is said here is what has changed since the clerk's last paper; the list in this paper is everything that stands open.)" } else { "" }
    );
    // (One list, each thing that stands open an entry: a long one is read a part at a time, as any long paper is. Those
    // whose day has come lead the list too. A heading longer than the list holds says how many it leaves out.)
    let ordered: Vec<&OpenHeading> = open.iter().filter(|h| h.always).chain(open.iter().filter(|h| !h.always)).collect();
    let over: Vec<Value> = ordered.iter().filter(|h| h.items.len() > LISTED).map(|h| json!({ "what": h.what, "not_listed": h.items.len() - LISTED })).collect();
    let entries: Vec<Value> = ordered
        .iter()
        .flat_map(|h| {
            h.items.iter().take(LISTED).map(|x| {
                let mut e = json!({ "what": h.what, "about": x.id, "says": x.line });
                if let Some(v) = x.since {
                    e["since"] = json!(v);
                }
                if let Some(v) = x.amount {
                    e["amount"] = json!(v);
                }
                if let Some(v) = x.due {
                    e["due"] = json!(v);
                }
                e
            })
        })
        .collect();
    let mut d = json!({ "office": office, "at": t, "open": entries });
    if listed > 0 {
        d["list"] = json!({ "ripe": listed, "new": on_list });
    }
    if !over.is_empty() {
        d["over"] = json!(over);
    }
    (text, d, key)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Last {
    key: String,
    day: i64,
    t: i64,
    open: Listed,
}

/// A clerk's keeping of one office's books: fed each observation, asked at a wake's end whether a paper is due.
#[derive(Serialize, Deserialize)]
pub struct Keeping {
    me: String,
    office: String,
    book: Book,
    last: Option<Last>,
}

fn listed_of(open: &[OpenHeading]) -> Listed {
    open.iter().map(|h| (h.what.clone(), h.items.iter().map(|x| (x.id.clone(), x.line.clone())).collect())).collect()
}

impl Keeping {
    pub fn new(me: &str, office: &str) -> Self {
        Keeping { me: me.to_string(), office: office.to_string(), book: Book::new(), last: None }
    }
    /// The latest paper of these books on the organisation's file, as a new clerk finds it.
    fn filed(&self) -> Option<(i64, Listed)> {
        let mut best: Option<(i64, Listed)> = None;
        for r in self.book.all(BOOKS) {
            let d = data(r);
            let Some(open) = d.get("open").and_then(|x| x.as_array()) else { continue };
            if d.get("office").and_then(|x| x.as_str()) != Some(self.office.as_str()) {
                continue;
            }
            let at = d.get("at").and_then(|x| x.as_i64()).unwrap_or(r.at);
            if best.as_ref().is_some_and(|(t, _)| *t >= at) {
                continue;
            }
            let mut m: Listed = BTreeMap::new();
            for x in open {
                let (Some(what), Some(about), Some(says)) = (x.get("what").and_then(|x| x.as_str()), x.get("about").and_then(|x| x.as_str()), x.get("says").and_then(|x| x.as_str())) else { continue };
                m.entry(what.to_string()).or_default().insert(about.to_string(), says.to_string());
            }
            best = Some((at, m));
        }
        best
    }
    /// The paper to file now, if what stands open has changed since the last (none while nothing has ever stood
    /// open). The clerk keeps the books on a daily round: its first look of a day with something changed files, and
    /// the day's later looks do not, however they came.
    pub fn due(&mut self, open: Vec<OpenHeading>, t: i64, world: &crate::WorldInfo) -> Option<crate::steps::Step<()>> {
        let open: Vec<OpenHeading> = open.into_iter().filter(|h| !h.items.is_empty()).collect();
        let day = t.div_euclid(DAY);
        // (A new holder of the post carries on from the paper on the organisation's file, never from an empty memory.)
        if self.last.is_none() {
            if let Some((ft, m)) = self.filed() {
                self.last = Some(Last { key: String::new(), day: ft.div_euclid(DAY), t: ft, open: m });
            }
        }
        if self.last.is_none() && open.is_empty() {
            return None;
        }
        let (text, d, key) = books_paper(&self.office, t, &open, self.last.as_ref().map(|l| &l.open), world);
        if let Some(l) = self.last.as_mut() {
            if l.key.is_empty() {
                let same = open.len() == l.open.len() && open.iter().all(|h| h.items.len() == l.open.get(&h.what).map_or(usize::MAX, |m| m.len()) && h.items.iter().all(|x| l.open.get(&h.what).and_then(|m| m.get(&x.id)) == Some(&x.line)));
                if same {
                    l.key = key.clone();
                }
            }
        }
        // (A figure that moves with every payment is no reason for a paper each time it moves; but it is not left to
        // stand for months either: where one has moved and the last paper is a week old, a paper is filed.)
        let moved = self.last.as_ref().is_some_and(|l| day - l.day >= RUNNING_EVERY_DAYS && open.iter().any(|h| h.items.iter().any(|x| x.running && l.open.get(&h.what).and_then(|m| m.get(&x.id)) != Some(&x.line))));
        if let Some(l) = &self.last {
            if (l.key == key && !moved) || l.t.div_euclid(CLERK_ROUND_DAYS * DAY) == t.div_euclid(CLERK_ROUND_DAYS * DAY) {
                return None;
            }
        }
        self.last = Some(Last { key, day, t, open: listed_of(&open) });
        Some(because(
            "What stands open on the office's books has changed: filing it for whoever holds the office.",
            vec![say(BOOKS, &text, Say { to: Some(vec![self.me.clone()]), visible: Some(Visible::Only(vec![self.me.clone()])), data: Some(d), ..Default::default() })],
        ))
    }
}

/// A unit of a kind that keeps books, run as its office's staff (`part: "staff"`): the staff's clerk keeps them too, and
/// files what has changed when the staff's own work for the wake is done (participants/src/index.ts `keepingBooks` and
/// books.ts `booked`). Every place that makes or takes up an actor goes through `create` and `restore`, so the engine's
/// unit, a detached brain and a snapshot's are the same.
pub struct StaffClerk {
    inner: Box<dyn Actor>,
    keeping: Keeping,
    books: Box<dyn OfficeBooks>,
}

fn staff_books(kind: &dyn Kind, ctx: &Ctx) -> Option<(String, Box<dyn OfficeBooks>)> {
    if ctx.params.get("part").and_then(|x| x.as_str()) != Some("staff") {
        return None;
    }
    let office = office_of(ctx.position.as_deref());
    books_of(kind.name(), &ctx.entity, &office, &ctx.params.to_map()).map(|b| (office, b))
}

/// The actor of `kind` for `ctx`: its own, with its staff's clerk where it keeps books and runs as staff, and as a
/// principal where the world gives it `delegation` (docs/design/delegation.md: none does unless the town has providers).
pub fn create(kind: &dyn Kind, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
    // (A person's own code, and its principal's, reads its post when it sits down to it: crate::post.)
    Ok(crate::post::wrap(ctx, crate::delegation::wrap(ctx, create_kept(kind, ctx)?)?))
}

/// The same, taken up again as `save` left it.
pub fn restore(kind: &dyn Kind, ctx: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
    crate::post::rewrap(ctx, &saved, |saved| crate::delegation::rewrap(ctx, &saved, |inner| restore_kept(kind, ctx, inner)))
}

fn create_kept(kind: &dyn Kind, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
    let inner = kind.create(ctx)?;
    Ok(match staff_books(kind, ctx) {
        Some((office, books)) => Box::new(StaffClerk { inner, keeping: Keeping::new(&ctx.entity, &office), books }),
        None => inner,
    })
}

fn restore_kept(kind: &dyn Kind, ctx: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
    match staff_books(kind, ctx) {
        Some((_, mut books)) => {
            let inner = kind.restore(ctx, saved.get("inner").cloned().unwrap_or(Value::Null))?;
            books.restore(saved.get("books").unwrap_or(&Value::Null))?;
            let keeping: Keeping = serde_json::from_value(saved.get("keeping").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            Ok(Box::new(StaffClerk { inner, keeping, books }))
        }
        None => kind.restore(ctx, saved),
    }
}

impl Actor for StaffClerk {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        self.keeping.book.absorb(pic);
        self.books.absorb(pic);
        let a = self.inner.step(pic, cx);
        if !matches!(a, Action::Wait { .. }) {
            return a;
        }
        let open = self.books.open(pic.t, &cx.ctx.world);
        match self.keeping.due(open, pic.t, &cx.ctx.world) {
            Some(s) => Action::Call { program: s.program(), reasoning: s.why },
            None => a,
        }
    }
    fn beliefs(&self) -> Vec<crate::Belief> {
        self.inner.beliefs()
    }
    fn sent(&mut self, action: &str) {
        self.inner.sent(action)
    }
    fn save(&self) -> Result<Value, String> {
        Ok(json!({ "inner": self.inner.save()?, "keeping": serde_json::to_value(&self.keeping).map_err(|e| e.to_string())?, "books": self.books.save()? }))
    }
    fn kept(&self) -> Option<std::collections::BTreeMap<String, u64>> {
        self.inner.kept()
    }
}

/// Configuration for the mayor's opt-in weekly chief-of-staff briefing (`with.briefing = true`).
#[derive(Debug, Clone, Copy)]
struct BriefingCfg {
    threshold_bps: i64,
    population: i64,
}

fn briefing_cfg_of(of: &str, with: &serde_json::Map<String, Value>) -> Option<BriefingCfg> {
    if of != "city.mayor_code" || with.get("briefing").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    let threshold_bps = with
        .get("petition_threshold_bps")
        .and_then(|v| v.as_i64())
        .unwrap_or(crate::figures::BRIEFING_DEFAULT_THRESHOLD_BPS);
    let population = with
        .get("population")
        .and_then(|v| v.as_i64())
        .unwrap_or(crate::figures::BRIEFING_DEFAULT_POPULATION);
    Some(BriefingCfg { threshold_bps, population })
}

fn format_dir_short(form: &str) -> &str {
    match form {
        "works_collection" => "collection",
        "works_staffing" => "works staffing",
        "environment_staffing" => "env staffing",
        "inspector_enforcement" => "fines",
        "rates_recovery" => "rates interest",
        other => other,
    }
}

fn format_dir_val(form: &str, d: &oikos_core::Frozen) -> Option<String> {
    match form {
        "works_collection" => d.i("every").map(|s| if s % DAY == 0 { format!("{}d", s / DAY) } else { format!("{s}s") }),
        "works_staffing" | "environment_staffing" => d.s("recruit").map(String::from),
        "inspector_enforcement" => d.s("fines").map(String::from),
        "rates_recovery" => d.s("interest").map(String::from),
        _ => None,
    }
}

fn format_rival_dir_val(form: &str, fields: &serde_json::Map<String, Value>) -> Option<String> {
    match form {
        "works_collection" => fields.get("every").and_then(|v| v.as_str()).map(|s| {
            let trimmed = s.trim();
            if let Some(n) = trimmed.strip_suffix(" days").and_then(|x| x.trim().parse::<i64>().ok()) {
                format!("{n}d")
            } else {
                trimmed.to_string()
            }
        }),
        "works_staffing" | "environment_staffing" => fields.get("recruit").and_then(|v| v.as_str()).map(String::from),
        "inspector_enforcement" => fields.get("fines").and_then(|v| v.as_str()).map(String::from),
        "rates_recovery" => fields.get("interest").and_then(|v| v.as_str()).map(String::from),
        _ => None,
    }
}

/// Composes a concise, plain-fact chief-of-staff weekly briefing from what the mayor's clerk observes on its own channels.
/// Covers: latest paper poll and the mayor's own standing, each rival's platform and which standing directions it would
/// reverse, open petitions, and resident hardship/service complaints. Pure facts; no advice to use any power.
pub fn mayor_briefing_text(book: &Book, me: &str, threshold_bps: i64, population: i64, t: i64, world: &crate::WorldInfo) -> String {
    let mut parts: Vec<String> = vec![format!("Weekly briefing ({}).", when_words(t, world))];

    // 1. Current standing directions issued from the mayor's post (latest per form).
    let mut standing_dirs: BTreeMap<String, String> = BTreeMap::new();
    let mut dirs: Vec<&oikos_sight::Record> = book.open("direction").map(|r| r.as_ref()).filter(|r| r.position.as_deref() == Some("mayor")).collect();
    dirs.sort_by_key(|r| r.at);
    for d in dirs {
        let form = bases_of(d).iter().filter_map(|b| book.get(b)).find_map(|f| data(f).s("form").map(String::from));
        if let Some(form) = form {
            if let Some(val) = format_dir_val(&form, data(d)) {
                standing_dirs.insert(form, val);
            }
        }
    }

    // 2. Latest election notice, result, nominations, and latest paper poll.
    let notice = book
        .open("election_notice")
        .filter(|r| data(r).s("office") == Some("mayor"))
        .max_by_key(|r| r.at);
    if let Some(n) = notice {
        let nd = data(n);
        let poll_at = nd.i("poll_at").unwrap_or(0);
        let closes_at = nd.i("nominations_close_at").unwrap_or(0);
        let result = book
            .open("ballot_result")
            .filter(|r| r.at >= n.at && data(r).s("office") == Some("mayor"))
            .max_by_key(|r| r.at);
        let mut inc_nominated = false;
        // Group rival platforms by summary to stay concise even with many rivals.
        let mut rival_groups: BTreeMap<String, (Vec<String>, Option<Value>)> = BTreeMap::new();
        let mut rival_count = 0usize;
        for nom in book.open("nomination").filter(|r| r.at >= n.at && data(r).s("office") == Some("mayor")) {
            let d = data(nom);
            if d.flag("incumbent") || nom.position.as_deref() == Some("mayor") {
                inc_nominated = true;
                continue;
            }
            rival_count += 1;
            let cand = nom.speaks_for.map(|s| s.to_string()).unwrap_or_else(|| d.s("name").unwrap_or(nom.author.as_str()).to_string());
            let plat_json = d.get("platform").map(|p| p.to_value());
            let summary = plat_json
                .as_ref()
                .and_then(|p| p.get("summary").and_then(|x| x.as_str()))
                .map(String::from)
                .unwrap_or_else(|| match &nom.body {
                    RecordBody::Statement { text, .. } => text.chars().take(crate::figures::BRIEFING_CLIP_CHARS).collect(),
                    _ => String::new(),
                });
            let entry = rival_groups.entry(summary).or_insert_with(|| (vec![], plat_json));
            if !entry.0.contains(&cand) {
                entry.0.push(cand);
            }
        }

        if let Some(res) = result {
            let winner_raw = data(res).s("winner").unwrap_or("unknown");
            let winner = if winner_raw == "mayor-system" {
                "the incumbent mayor"
            } else {
                winner_raw.strip_suffix("-self").unwrap_or(winner_raw)
            };
            let takes = data(res).i("takes_office_at").map(|x| when_words(x, world));
            parts.push(match takes {
                Some(when_takes) => format!("Election result declared ({}): winner {winner}, taking office {when_takes}.", when_words(res.at, world)),
                None => format!("Election result declared ({}): winner {winner}.", when_words(res.at, world)),
            });
        } else {
            let latest_poll = book
                .open("news")
                .filter(|r| {
                    let pd = data(r);
                    r.at >= n.at
                        && pd.s("kind") == Some("poll")
                        && pd.s("office").is_none_or(|o| o == "mayor")
                        && pd.i("poll_at").is_none_or(|pa| poll_at == 0 || pa == poll_at)
                })
                .max_by_key(|r| r.at);
            if let Some(poll) = latest_poll {
                let pd = data(poll);
                let resp = pd.i("respondents").unwrap_or(0);
                let app_bps = pd.i("approval_bps").unwrap_or(0);
                let net_pct = (app_bps + if app_bps >= 0 { crate::figures::HALF_PERCENT_BPS } else { -crate::figures::HALF_PERCENT_BPS }) / 100;
                let net_str = if net_pct > 0 { format!("+{net_pct}%") } else { format!("{net_pct}%") };
                let shares = pd.get("shares").map(|x| x.to_value()).and_then(|v| v.as_array().cloned()).unwrap_or_default();
                let mut inc_pct: Option<i64> = None;
                let mut rivals_poll: Vec<(String, i64)> = vec![];
                for s in &shares {
                    let fp_bps = s.get("first_pref_bps").and_then(|x| x.as_i64()).unwrap_or(0);
                    let pct = (fp_bps + crate::figures::HALF_PERCENT_BPS) / 100;
                    if s.get("incumbent").is_some_and(truthy) {
                        inc_pct = Some(pct);
                    } else {
                        let name = s.get("name").and_then(|x| x.as_str()).or_else(|| s.get("candidate").and_then(|x| x.as_str())).unwrap_or("rival").to_string();
                        rivals_poll.push((name, pct));
                    }
                }
                rivals_poll.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
                let top_str = rivals_poll
                    .iter()
                    .take(2)
                    .map(|(nm, p)| format!("{nm} {p}%"))
                    .collect::<Vec<_>>()
                    .join(", ");
                let standing_str = match (inc_pct, rivals_poll.first()) {
                    (Some(ip), Some((_, tp))) if ip < *tp => format!("your first-preference share is {ip}%, trailing {top_str}"),
                    (Some(ip), Some(_)) => format!("your first-preference share is {ip}% against {top_str}"),
                    (Some(ip), None) => format!("your first-preference share is {ip}%"),
                    (None, Some(_)) => format!(
                        "your office is not listed in first preferences ({}), while {top_str} lead",
                        if inc_nominated { "0% in poll" } else { "no incumbent nomination on file" }
                    ),
                    (None, None) => "no first-preference breakdown reported".into(),
                };
                let days_left = ((poll_at - t).max(0) + DAY - 1) / DAY;
                parts.push(format!(
                    "Poll ({}, {resp} readers; {days_left}d to poll): net approval {net_str}; {standing_str}.",
                    when_words(poll.at, world)
                ));
            } else {
                let nom_state = if inc_nominated { "your nomination is on file" } else { "no nomination from the mayor's office is on file yet" };
                let close_note = if closes_at > 0 && t < closes_at {
                    format!("; nominations close before {}", when_words(closes_at, world))
                } else {
                    String::new()
                };
                parts.push(format!("Election: poll on {}{close_note}; {nom_state}.", when_words(poll_at, world)));
            }

            if rival_count > 0 {
                let mut plat_bits: Vec<String> = vec![];
                let mut first_rev: Option<String> = None;
                for (summary, (mut cands, plat)) in rival_groups {
                    cands.sort();
                    let who = if cands.len() <= 2 {
                        cands.join(", ")
                    } else {
                        format!("{}, {} +{} more", cands[0], cands[1], cands.len() - 2)
                    };
                    let mut reversed: Vec<String> = vec![];
                    let mut cuts: Vec<String> = vec![];
                    if let Some(p) = &plat {
                        if let Some(pdirs) = p.get("directions").and_then(|x| x.as_object()) {
                            for (form, fields) in pdirs {
                                if let (Some(cur), Some(map)) = (standing_dirs.get(form), fields.as_object()) {
                                    if let Some(rval) = format_rival_dir_val(form, map) {
                                        if rval != *cur {
                                            reversed.push(format!("{} {cur}->{rval}", format_dir_short(form)));
                                        }
                                    }
                                }
                            }
                        }
                        if let Some(pbud) = p.get("budgets").and_then(|x| x.as_object()) {
                            for (line, v) in pbud {
                                if let Some(bps) = v.as_i64() {
                                    if bps < 10_000 {
                                        cuts.push(format!("{line} {}%", bps / 100));
                                    }
                                }
                            }
                        }
                    }
                    if !reversed.is_empty() || !cuts.is_empty() {
                        let rev_key = reversed.join(", ");
                        let rev_s = if reversed.is_empty() {
                            String::new()
                        } else if first_rev.as_deref() == Some(rev_key.as_str()) {
                            format!("reverses same {} directions", reversed.len())
                        } else {
                            if first_rev.is_none() {
                                first_rev = Some(rev_key.clone());
                            }
                            format!("reverses {} directions ({rev_key})", reversed.len())
                        };
                        let cut_s = if cuts.is_empty() { String::new() } else { format!("cuts budgets ({})", cuts.join(", ")) };
                        let both = [rev_s, cut_s].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("; ");
                        plat_bits.push(format!("{who}: {both}"));
                    } else {
                        let short: String = summary.chars().take(crate::figures::BRIEFING_CLIP_CHARS).collect();
                        plat_bits.push(format!("{who}: \"{short}\""));
                    }
                }
                parts.push(format!("Rivals ({rival_count}): {}.", plat_bits.join(" | ")));
            }
        }
    }

    // 3. Open petitions and resident hardship / service complaints.
    let acted: BTreeSet<String> = book
        .all("proposal")
        .chain(book.all("petition_response"))
        .filter(|r| r.position.as_deref() == Some("mayor"))
        .flat_map(|r| bases_of(r).iter().map(|b| b.to_string()))
        .collect();
    let needed = -((-(threshold_bps * population)).div_euclid(10_000));
    let mut counts: BTreeMap<&str, i64> = BTreeMap::new();
    for c in book.open("petition_count") {
        if let (Some(pid), Some(sig)) = (data(c).s("petition"), data(c).i("signatures")) {
            counts.insert(pid, sig);
        }
    }
    let mut open_pets = 0usize;
    let mut over_pets = 0usize;
    let mut top_pet: Option<(i64, String)> = None;
    for p in book.open("petition") {
        if acted.contains(p.id.as_str()) {
            continue;
        }
        open_pets += 1;
        let sig = counts.get(p.id.as_str()).copied().unwrap_or(0);
        if sig * 10_000 >= threshold_bps * population {
            over_pets += 1;
        }
        let demand: String = data(p)
            .get("demand")
            .and_then(|x| x.s("text"))
            .map(String::from)
            .unwrap_or_else(|| match &p.body {
                RecordBody::Statement { text, .. } => text.clone(),
                _ => String::new(),
            })
            .chars()
            .take(crate::figures::BRIEFING_CLIP_CHARS)
            .collect();
        if top_pet.as_ref().is_none_or(|(best, _)| sig > *best) {
            top_pet = Some((sig, format!("{} ({sig} sigs: {demand})", p.id)));
        }
    }
    let mut comp_counts: BTreeMap<String, usize> = BTreeMap::new();
    for c in book.open("complaint") {
        if !addressed_to(c).iter().any(|x| x == me) {
            continue;
        }
        let kind = data(c).s("about").unwrap_or("services").replace('_', " ");
        *comp_counts.entry(kind).or_default() += 1;
    }
    let neg_news = book
        .open("news")
        .filter(|r| data(r).flag("about_office") && data(r).i("tone").is_some_and(|v| v < 0))
        .count();

    let mut hardship: Vec<String> = vec![];
    if open_pets > 0 {
        let top_s = top_pet.map(|(_, s)| format!("; top: {s}")).unwrap_or_default();
        hardship.push(format!("{open_pets} open petitions ({over_pets} at/over {needed}-sig threshold{top_s})"));
    }
    if !comp_counts.is_empty() {
        let cs = comp_counts.iter().map(|(k, n)| format!("{n} {k}")).collect::<Vec<_>>().join(", ");
        hardship.push(format!("open complaints: {cs}"));
    }
    if neg_news > 0 {
        hardship.push(format!("{neg_news} adverse local-paper reports on town services and resident hardship"));
    }
    if !hardship.is_empty() {
        parts.push(format!("Petitions & hardship: {}.", hardship.join("; ")));
    }
    parts.join(" ")
}

/// The staff post that keeps an office's books (`office.clerk`): does nothing else of the office's business.
pub struct ClerkActor {
    keeping: Keeping,
    books: Box<dyn OfficeBooks>,
    briefing_cfg: Option<BriefingCfg>,
    briefed_at: Option<i64>,
}

impl ClerkActor {
    fn due_briefing(&mut self, t: i64, world: &crate::WorldInfo) -> Option<crate::steps::Step<()>> {
        let cfg = self.briefing_cfg?;
        if t < DAY {
            return None;
        }
        let last = self.briefed_at;
        let same_day = last.is_some_and(|at| at.div_euclid(DAY) == t.div_euclid(DAY));
        let notice = self.keeping.book.open("election_notice").filter(|r| data(r).s("office") == Some("mayor")).max_by_key(|r| r.at);
        let new_notice = notice.is_some_and(|n| last.is_none_or(|at| n.at > at));
        let new_poll = self
            .keeping
            .book
            .open("news")
            .filter(|r| data(r).s("kind") == Some("poll") && data(r).s("office").is_none_or(|o| o == "mayor"))
            .any(|p| last.is_none_or(|at| p.at > at));
        let pre_poll_due = notice.is_some_and(|n| {
            let poll_at = data(n).i("poll_at").unwrap_or(0);
            let pre_at = poll_at - PRE_POLL_BRIEFING_DAYS * DAY;
            poll_at > 0 && t >= pre_at && t < poll_at && last.is_none_or(|at| at < pre_at)
        });
        let weekly_due = last.is_none_or(|at| t >= at + BRIEFING_EVERY_DAYS * DAY);
        let due = (weekly_due || pre_poll_due) && !same_day || new_notice || new_poll;
        if !due {
            return None;
        }
        self.briefed_at = Some(t);
        let text = mayor_briefing_text(&self.keeping.book, &self.keeping.me, cfg.threshold_bps, cfg.population, t, world);
        Some(because(
            "Filing a plain-fact weekly briefing for the mayor on polls, rival platforms, open petitions and hardship.",
            vec![say(BRIEFING, &text, Say { to: Some(vec![self.keeping.office.clone()]), visible: Some(Visible::Only(vec![self.keeping.me.clone()])), ..Default::default() })],
        ))
    }
}

impl Actor for ClerkActor {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        self.keeping.book.absorb(pic);
        self.books.absorb(pic);
        let open = self.books.open(pic.t, &cx.ctx.world);
        if let Some(s) = self.keeping.due(open, pic.t, &cx.ctx.world) {
            return Action::Call { program: s.program(), reasoning: s.why };
        }
        if let Some(s) = self.due_briefing(pic.t, &cx.ctx.world) {
            return Action::Call { program: s.program(), reasoning: s.why };
        }
        Action::Wait { until: None }
    }
    fn save(&self) -> Result<Value, String> {
        let mut out = json!({ "keeping": serde_json::to_value(&self.keeping).map_err(|e| e.to_string())?, "books": self.books.save()? });
        if self.briefing_cfg.is_some() {
            out["briefed_at"] = json!(self.briefed_at);
        }
        Ok(out)
    }
}

impl Kind for Clerk {
    fn name(&self) -> &'static str {
        "office.clerk"
    }
    fn version(&self) -> &'static str {
        "0.3.1"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/office-books.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "of": { "schema": { "type": "string" }, "default": "", "source": "placeholder" },
                "with": { "schema": { "type": "object" }, "default": {}, "source": "placeholder" },
            },
            "perceives": [], "state": "none",
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        spread(ctx, 6 * 3600, 3 * 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let of: String = ctx.param("of", String::new())?;
        let with: serde_json::Map<String, Value> = ctx.param("with", Default::default())?;
        let office = office_of(ctx.position.as_deref());
        let books = books_of(&of, &ctx.entity, &office, &with).ok_or_else(|| format!("office.clerk: no module \"{of}\" that keeps books"))?;
        let briefing_cfg = briefing_cfg_of(&of, &with);
        Ok(Box::new(ClerkActor { keeping: Keeping::new(&ctx.entity, &office), books, briefing_cfg, briefed_at: None }))
    }
    fn restore(&self, ctx: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let of: String = ctx.param("of", String::new())?;
        let with: serde_json::Map<String, Value> = ctx.param("with", Default::default())?;
        let office = office_of(ctx.position.as_deref());
        let mut books = books_of(&of, &ctx.entity, &office, &with).ok_or_else(|| format!("office.clerk: no module \"{of}\" that keeps books"))?;
        books.restore(saved.get("books").unwrap_or(&Value::Null))?;
        let keeping: Keeping = serde_json::from_value(saved.get("keeping").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
        let briefing_cfg = briefing_cfg_of(&of, &with);
        let briefed_at = saved.get("briefed_at").and_then(|v| v.as_i64());
        Ok(Box::new(ClerkActor { keeping, books, briefing_cfg, briefed_at }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, line: &str) -> OpenItem {
        OpenItem { id: id.into(), line: line.into(), since: None, amount: None, due: None, running: false }
    }
    fn heading(what: &str, always: bool, items: Vec<OpenItem>) -> OpenHeading {
        OpenHeading { what: what.into(), items, always }
    }
    fn world() -> crate::WorldInfo {
        crate::WorldInfo::default()
    }

    #[test]
    fn the_first_paper_lists_what_stands_open_and_a_later_one_says_what_changed() {
        let w = world();
        let rent = heading("Rent in arrears", false, vec![item("l1", "ann owes 200"), item("l2", "bob owes 100")]);
        let (text, d, _) = books_paper("landlord", 5 * DAY, std::slice::from_ref(&rent), None, &w);
        assert!(text.contains("Rent in arrears: 2 in all: ann owes 200; bob owes 100."), "{text}");
        assert_eq!(d["open"].as_array().unwrap().len(), 2);
        let before = listed_of(std::slice::from_ref(&rent));
        let now = heading("Rent in arrears", false, vec![item("l2", "bob owes 100"), item("l3", "cy owes 50")]);
        let (text, _, _) = books_paper("landlord", 6 * DAY, std::slice::from_ref(&now), Some(&before), &w);
        assert!(text.contains("new: cy owes 50") && text.contains("no longer open: l1"), "{text}");
    }

    #[test]
    fn what_waits_on_the_office_holder_is_named_first_and_counted_new_only_once() {
        let w = world();
        let day = heading("Cases to decide", true, vec![item("c1", "case c1"), item("c2", "case c2")]);
        let before = listed_of(&[heading("Cases to decide", true, vec![item("c1", "case c1")])]);
        let (text, d, _) = books_paper("tribunal", DAY, std::slice::from_ref(&day), Some(&before), &w);
        assert!(text.contains("2 matters wait") && text.contains("1 is on the list for the first time"), "{text}");
        assert_eq!(d["list"], json!({ "ripe": 2, "new": 1 }));
    }

    #[test]
    fn a_new_clerk_carries_on_from_the_last_paper_on_the_file_and_files_once_a_day() {
        let w = world();
        let mut k = Keeping::new("office", "landlord");
        // The organisation's file holds the last paper: l1 stood open.
        let filed: oikos_sight::Record = serde_json::from_value(json!({ "id": "rec.9", "record": "statement", "author": "p.old", "at": 3 * DAY, "visible_to": ["office"], "kind": BOOKS, "text": "x",
            "data": { "office": "landlord", "at": 3 * DAY, "open": [{ "what": "Rent in arrears", "about": "l1", "says": "ann owes 200" }] } })).unwrap();
        k.book.take_all(&[std::sync::Arc::new(filed)]);
        // Now nothing stands open: the paper says l1 is no longer open.
        let s = k.due(vec![], 5 * DAY, &w).expect("a paper");
        let text = format!("{:?}", s.lines);
        assert!(text.contains("no longer open: l1"), "{text}");
        assert!(k.due(vec![], 5 * DAY + 3600, &w).is_none(), "once a day");
    }

    #[test]
    fn an_office_with_no_reader_of_its_books_cannot_have_a_clerk() {
        let ctx = Ctx { participant: "p".into(), performer: Default::default(), entity: "o".into(), position: Some("works-staff".into()), params: json!({ "of": "city.registry" }).as_object().unwrap().clone().into(), world: Default::default() };
        assert!(Clerk.create(&ctx).is_err());
    }

    #[test]
    fn mayor_briefing_reports_poll_rival_reversals_and_hardship_without_advice() {
        let w = world();
        let mut book = Book::new();
        let recs: Vec<std::sync::Arc<oikos_sight::Record>> = vec![
            json!({ "id": "form-works-collection", "record": "statement", "author": "genesis", "at": 0, "visible_to": "public", "speaks_for": "city", "kind": "form", "text": "f", "data": { "form": "works_collection", "office": "works", "submit_as": "direction" } }),
            json!({ "id": "form-inspector-enforcement", "record": "statement", "author": "genesis", "at": 0, "visible_to": "public", "speaks_for": "city", "kind": "form", "text": "f", "data": { "form": "inspector_enforcement", "office": "inspector", "submit_as": "direction" } }),
            json!({ "id": "dir-opening-works-collection", "record": "statement", "author": "mayor-system", "in_position": "mayor", "at": 0, "visible_to": "public", "speaks_for": "city", "kind": "direction", "basis": "form-works-collection", "addressed_to": ["city"], "text": "weekly", "data": { "every": 604800 } }),
            json!({ "id": "dir-opening-inspector-enforcement", "record": "statement", "author": "mayor-system", "in_position": "mayor", "at": 0, "visible_to": "public", "speaks_for": "city", "kind": "direction", "basis": "form-inspector-enforcement", "addressed_to": ["city"], "text": "fines yes", "data": { "fines": "yes" } }),
            json!({ "id": "rec.10", "record": "statement", "author": "electoral", "at": 120 * DAY, "visible_to": "public", "kind": "election_notice", "text": "notice", "data": { "office": "mayor", "poll_at": 180 * DAY, "nominations_close_at": 150 * DAY } }),
            json!({ "id": "rec.11", "record": "statement", "author": "c0094-self", "speaks_for": "c0094", "at": 121 * DAY, "visible_to": "public", "kind": "nomination", "text": "Standing for mayor: Cut spending", "data": { "office": "mayor", "name": "c0094", "platform": { "summary": "Cut spending", "budgets": { "parks": 5000 }, "directions": { "works_collection": { "every": "14 days" }, "inspector_enforcement": { "fines": "no" } } } } }),
            json!({ "id": "rec.12", "record": "statement", "author": "editor", "at": 161 * DAY, "visible_to": "public", "kind": "news", "text": "poll", "data": { "kind": "poll", "poll_at": 180 * DAY, "respondents": 110, "approval_bps": -300, "shares": [{ "candidate": "mayor-system", "name": "the incumbent mayor", "incumbent": true, "first_pref_bps": 2200 }, { "candidate": "c0094-self", "name": "c0094", "first_pref_bps": 4400 }] } }),
            json!({ "id": "rec.13", "record": "statement", "author": "c0010-self", "speaks_for": "c0010", "at": 5 * DAY, "visible_to": "public", "addressed_to": ["city"], "kind": "petition", "text": "Limit rent rises and extend notice", "data": { "demand": { "text": "Limit rent rises and extend notice" } } }),
            json!({ "id": "rec.14", "record": "statement", "author": "c0010-self", "speaks_for": "c0010", "at": 6 * DAY, "visible_to": "public", "kind": "petition_count", "text": "120", "data": { "petition": "rec.13", "signatures": 120 } }),
            json!({ "id": "rec.15", "record": "statement", "author": "c0011-self", "at": 10 * DAY, "visible_to": ["city"], "addressed_to": ["city"], "kind": "complaint", "text": "missed bin", "data": { "about": "waste" } }),
            json!({ "id": "rec.16", "record": "statement", "author": "editor", "at": 12 * DAY, "visible_to": "public", "kind": "news", "text": "Residents petition", "data": { "about_office": true, "tone": -1 } }),
        ]
        .into_iter()
        .map(|v| std::sync::Arc::new(serde_json::from_value(v).unwrap()))
        .collect();
        book.take_all(&recs);
        let text = mayor_briefing_text(&book, "city", 1500, 750, 170 * DAY, &w);
        assert!(text.contains("net approval -3%"), "{text}");
        assert!(text.contains("your first-preference share is 22%, trailing c0094 44%"), "{text}");
        assert!(text.contains("collection 7d->14d"), "{text}");
        assert!(text.contains("fines yes->no"), "{text}");
        assert!(text.contains("parks 50%"), "{text}");
        assert!(text.contains("1 open petitions (1 at/over 113-sig threshold"), "{text}");
        assert!(text.contains("open complaints: 1 waste"), "{text}");
        assert!(text.len() < 1000, "briefing should stay under render clip: {} chars: {text}", text.len());
        let lower = text.to_lowercase();
        for forbidden in ["should", "consider", "fire", "dismiss", "delay", "postpone", "vacate"] {
            assert!(!lower.contains(forbidden), "briefing must contain plain facts only, found '{forbidden}': {text}");
        }
    }

    #[test]
    fn the_manifest_is_the_one_the_ts_module_wrote() {
        let ts: Value = crate::offices::testing::ts_manifest("office.clerk");
        let rust = Clerk.manifest();
        for (k, v) in ts.as_object().unwrap() {
            if k == "version" {
                continue; // (the Rust is the bug-fix branch's 0.3.1 in behaviour; the manifest here is the TS before it)
            }
            assert_eq!(&rust[k], v, "{k}");
        }
    }
}
