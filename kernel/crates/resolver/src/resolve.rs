//! The resolver (docs/design/translator-and-resolver.md section 8): a call to the seat's own acts. Deterministic,
//! platform-side, and bound by four rules:
//!   - it never chooses how: the route is what the seat supplied; a missing decision is a question back (P6);
//!   - it fills in only single physical answers (the one account the seat holds; who keeps an account);
//!   - it never acts for anyone else: whoever must physically act is asked (a request) or offered an agreement (P7);
//!   - it uses only what the seat knows (P8). Ids the seat states outright are passed through: if one doesn't
//!     exist, physics says so.
//! The same as translator/src/resolver.ts, which it replaces in the engine.

use crate::calls::{self, Call, Program, Value};
use crate::forms;
use crate::knowledge::Knowledge;
use serde_json::{json, Map, Value as Json};
use std::collections::BTreeSet;

pub const RESOLVER_VERSION: &str = "0.7.0";

/// Fixed texts for the translator's refusal labels (section 11.1).
pub fn label_text(label: &str) -> &'static str {
    match label {
        "not_yours" => "That's for someone else to decide. You could write to them, or propose something.",
        "needs_calculation" => "Please state the amount itself.",
        "too_much" => "Please take this one step at a time.",
        "unknown_form" => "You haven't seen a form by that name.",
        "not_an_act" => "That's something to look up or read, not something to do. Look at your reports and papers, or write to whoever keeps it.",
        "no_such_act" => "Nothing here does that as such. If it is for someone else to see to, direct them in writing, on their form for it if they have one.",
        // (Said of the request alone: nothing is looked up to say it, so it tells the caller nothing it didn't know.)
        // (The resolver's own answer, never a translator's: the translator does not know who exists. Given alone, with no
        // candidates, it says only this.)
        "ambiguous" => "More than one of those you know of goes by that name. Name the one you mean by their id.",
        "look_first" => "That needs something found out first. Look it up (in your own papers, or by asking whoever keeps it), then say what is to be done, naming each paper by its id.",
        _ => "It isn't clear what should happen. Could you say it more plainly?",
    }
}

/// A resolution: the seat's acts (blocks, as the kernel reads them), or questions for the seat (and, when the call
/// itself broke the contract, what was wrong, for the log; and where a name it wrote could be more than one of those it
/// knows of, in a world whose people have names, each such answer `ambiguous` with its candidates).
#[derive(Debug, Clone, PartialEq)]
pub enum Resolution {
    Blocks(Vec<Json>),
    Questions { questions: Vec<String>, invalid: Vec<String>, ambiguous: Vec<Json> },
}

enum Stop {
    Ask(String),
    Unit(String),
    /// A name that could be more than one of those the seat knows of: the question, and the answer as data.
    Ambiguous(String, Json),
}

type R<T> = Result<T, Stop>;

fn ask<T>(s: impl Into<String>) -> R<T> {
    Err(Stop::Ask(s.into()))
}

fn unit<T>(r: Result<T, calls::UnitError>) -> R<T> {
    r.map_err(|e| Stop::Unit(e.0))
}

/// The first `n` UTF-16 code units of a string, as JavaScript's `slice` counts.
fn slice16(s: &str, n: usize) -> String {
    let mut used = 0;
    let mut out = String::new();
    for c in s.chars() {
        used += c.len_utf16();
        if used > n {
            break;
        }
        out.push(c);
    }
    out
}

/// Build an object from (key, value) pairs, leaving out the absent ones.
fn obj(pairs: Vec<(&str, Option<Json>)>) -> Json {
    let mut m = Map::new();
    for (k, v) in pairs {
        if let Some(v) = v {
            m.insert(k.into(), v);
        }
    }
    Json::Object(m)
}

fn some<T: Into<Json>>(x: T) -> Option<Json> {
    Some(x.into())
}

/// Resolve a program. `type_of` gives a structure type from the world's catalogue (footprint, terrains, spaces).
pub fn resolve(program: &Program, k: &Knowledge, type_of: &dyn Fn(&str) -> Option<Json>, as_: Option<&str>) -> Resolution {
    let q = |s: &str| Resolution::Questions { questions: vec![s.to_string()], invalid: vec![], ambiguous: vec![] };
    let lines = match program {
        // (`ambiguous` is the resolver's answer: a translator that writes it has said something it cannot know.)
        Program::None(label) if label == "ambiguous" => {
            return Resolution::Questions { questions: vec![label_text("unclear").into()], invalid: vec!["`ambiguous` answers a name known by more than one; it is never written for a request".into()], ambiguous: vec![] };
        }
        Program::None(label) => return q(label_text(label)),
        Program::Lines(l) => l,
    };
    if calls::program_text(program).encode_utf16().count() > 65536 {
        return q(label_text("too_much"));
    }
    let invalid = calls::contract_errors(program);
    if !invalid.is_empty() {
        return Resolution::Questions { questions: vec![label_text("unclear").into()], invalid, ambiguous: vec![] };
    }
    let bound: BTreeSet<String> = lines.iter().filter_map(|l| l.bind.clone()).collect();
    let mut r = Resolver { k, me: k.acting_for(as_), office: as_.is_some(), refs: bound.clone(), bound, n: 0, type_of };
    let mut blocks = vec![];
    let mut questions = vec![];
    let mut ambiguous = vec![];
    for line in lines {
        match r.line(&line.call, line.bind.as_deref()) {
            Ok(b) => blocks.extend(b),
            Err(Stop::Ask(s)) => questions.push(s),
            Err(Stop::Unit(s)) => questions.push(format!("{s}. Please say it another way.")),
            Err(Stop::Ambiguous(s, a)) => {
                questions.push(s);
                ambiguous.push(a);
            }
        }
    }
    if !questions.is_empty() {
        return Resolution::Questions { questions, invalid: vec![], ambiguous };
    }
    if blocks.len() > 32 {
        return q(label_text("too_much"));
    }
    Resolution::Blocks(blocks)
}

struct Resolver<'a> {
    k: &'a Knowledge,
    me: String,
    /// Acting in a post (an office), not as itself.
    office: bool,
    refs: BTreeSet<String>,
    /// The names the program's own lines bind (`refs` also holds the ones made up here).
    bound: BTreeSet<String>,
    n: u32,
    type_of: &'a dyn Fn(&str) -> Option<Json>,
}

impl Resolver<'_> {
    fn fresh(&mut self, stem: &str) -> String {
        loop {
            self.n += 1;
            let r = format!("{stem}{}", self.n);
            if self.refs.insert(r.clone()) {
                return r;
            }
        }
    }

    // --- reading argument values

    fn has(c: &Call, key: &str) -> bool {
        c.get(key).is_some()
    }

    /// An id (or a variable, as "$name", or a name the seat wrote that it knows).
    fn id_as(&self, c: &Call, key: &str, what: &str) -> R<Option<String>> {
        let Some(v) = c.get(key) else { return Ok(None) };
        // No id has a capital letter (ids are lowercase): a bare word with one is a name, as if it were quoted.
        let named = match v {
            Value::Text(t) => Some(t.as_str()),
            Value::Id(i) if i.chars().any(|c| c.is_ascii_uppercase()) => Some(i.as_str()),
            _ => None,
        };
        match (v, named) {
            (Value::Id(i), None) => {
                if !id_shape(i) {
                    return ask(not_an_id(i, what));
                }
                Ok(Some(i.clone()))
            }
            (Value::Var(x), _) => Ok(Some(format!("${x}"))),
            (_, Some(n)) => self.named(n, what).map(Some),
            (Value::Json(_), _) => ask(format!("{what} should name something, not data.")),
            _ => ask(format!("{what} should name something, not a call.")),
        }
    }
    /// A record named by its id, where nothing but a record can stand (the request a keeper's payment carries out):
    /// bare, as every id is written, or a name bound on an earlier line. Words in quotes are not an id, and data is
    /// not one. (The other resolver's `record`, word for word.)
    fn record(c: &Call, key: &str) -> R<Option<String>> {
        match c.get(key) {
            None => Ok(None),
            Some(Value::Var(x)) => Ok(Some(format!("${x}"))),
            Some(Value::Id(i)) if !i.chars().any(|ch| ch.is_ascii_uppercase()) => Ok(Some(i.clone())),
            Some(_) => ask(format!("{key} should name a record by its id.")),
        }
    }
    /// Who or what a name the seat wrote is, among those it knows of (`Knowledge::by_name`): the one it knows by that
    /// name. Else a question: in a world whose people have names (docs/design/names-and-dates.md section 4), a name it
    /// knows more than one by is answered `ambiguous`, with every candidate and what tells each apart on its own file,
    /// and no guess is made; one it knows nobody by is not on file (never looked up anywhere else). In the old towns,
    /// the questions they always had. (The other resolver's `named`, word for word.)
    fn named(&self, n: &str, what: &str) -> R<String> {
        let found = self.k.by_name(n);
        match found.len() {
            1 => Ok(found[0].clone()),
            0 if self.k.named => ask(if self.office { format!("No {n} is on file with this office.") } else { format!("No {n} is on your file.") }),
            0 => ask(format!("You don't know of anyone or anything called \"{n}\" (for {what}).")),
            _ if self.k.named => {
                let mut candidates = vec![];
                let mut said = vec![];
                for id in &found {
                    let by = self.k.known_by(id);
                    // (A post by its id: its name would be its organisation's.)
                    let who = if self.k.position_words.contains_key(id) { id.clone() } else { self.k.name(id) };
                    said.push(if by.is_empty() { format!("{who}, with nothing on your file to tell them apart but the id") } else { format!("{who}, {}", by.join(", ")) });
                    candidates.push(json!({ "id": id, "known_by": by }));
                }
                let last = said.pop().unwrap_or_default();
                let question = format!("Which \"{n}\" do you mean (for {what})? You know of {} by that name: {}; or {last}. Name the one you mean by their id.", found.len(), said.join("; "));
                Err(Stop::Ambiguous(question, json!({ "label": "ambiguous", "name": n, "for": what, "candidates": candidates })))
            }
            _ => ask(format!("More than one {what} is called \"{n}\": {}. Which one?", found.join(", "))),
        }
    }
    fn id(&self, c: &Call, key: &str) -> R<Option<String>> {
        self.id_as(c, key, key)
    }
    /// What the act cites: one record as any id is written, or a list of records, passed on in the order given. In a
    /// list, a name bound on a line of the program is that line's record, and anything not written as an id is a
    /// name the seat knows. One cited twice is kept where it first stands, and a list of one is that record alone.
    fn basis(&self, c: &Call) -> R<Option<Json>> {
        let Some(Value::Json(j)) = c.get("basis") else { return Ok(self.id(c, "basis")?.map(Json::from)) };
        let Some(items) = j.as_array().filter(|a| a.iter().all(Json::is_string)) else { return ask("basis should be a record, or a list of records.") };
        let mut out: Vec<String> = vec![];
        for x in items.iter().filter_map(Json::as_str) {
            let id = if self.bound.contains(x) {
                format!("${x}")
            } else if written_as_id(x) {
                if !id_shape(x) {
                    return ask(not_an_id(x, "basis"));
                }
                x.to_string()
            } else {
                self.named(x, "basis")?
            };
            if !out.contains(&id) {
                out.push(id);
            }
        }
        match out.len() {
            0 => ask("basis should name at least one record."),
            1 => Ok(Some(json!(out[0]))),
            2..=64 => Ok(Some(json!(out))),
            _ => ask("That cites more records than one act can: 64 at most."),
        }
    }
    fn need(&self, c: &Call, key: &str, question: &str) -> R<String> {
        match self.id(c, key)? {
            Some(x) => Ok(x),
            None => ask(question),
        }
    }
    fn str_(c: &Call, key: &str) -> R<Option<String>> {
        match c.get(key) {
            None => Ok(None),
            Some(Value::Text(t)) => Ok(Some(t.clone())),
            Some(Value::Id(i)) => Ok(Some(i.clone())),
            Some(_) => ask(format!("{key} should be written out.")),
        }
    }
    /// The world's money, as the seat's knowledge has it (how amounts are written and read).
    fn currency(&self) -> R<&calls::Currency> {
        match &self.k.currency {
            Some(c) => Ok(c),
            None => ask("Amounts of money can't be read here: how this world's money is written isn't known."),
        }
    }
    fn amount(&self, c: &Call, key: &str) -> R<Option<String>> {
        match Self::str_(c, key)? {
            None => Ok(None),
            Some(s) => unit(calls::parse_amount(&s, self.currency()?)).map(Some),
        }
    }
    fn seconds(c: &Call, key: &str) -> R<Option<i64>> {
        match Self::str_(c, key)? {
            None => Ok(None),
            Some(s) => unit(calls::parse_duration(&s)).map(Some),
        }
    }
    fn json_(c: &Call, key: &str) -> R<Option<Json>> {
        match c.get(key) {
            None => Ok(None),
            Some(Value::Json(j)) => Ok(Some(j.clone())),
            Some(Value::Text(t)) => Ok(Some(json!({ "text": t }))),
            Some(_) => ask(format!("{key} should be data or text.")),
        }
    }
    fn ids(&self, c: &Call, key: &str) -> R<Option<Vec<String>>> {
        match c.get(key) {
            None => Ok(None),
            Some(Value::Json(j)) => match j.as_array() {
                // (In a world whose people have names, one written as a name in the list is one of those the seat knows.)
                Some(a) if a.iter().all(Json::is_string) && self.k.named => a.iter().filter_map(Json::as_str).map(|x| if x.starts_with('$') || written_as_id(x) { Ok(x.to_string()) } else { self.named(x, key) }).collect::<R<Vec<String>>>().map(Some),
                Some(a) if a.iter().all(Json::is_string) => Ok(Some(a.iter().map(|x| x.as_str().unwrap().to_string()).collect())),
                _ => ask(format!("{key} should be a list of names or ids.")),
            },
            Some(_) => Ok(Some(vec![self.id(c, key)?.unwrap_or_default()])),
        }
    }
    fn visible(&self, c: &Call) -> R<Option<Json>> {
        match c.get("visible") {
            None => Ok(None),
            Some(Value::Id(i)) if i == "public" => Ok(Some(json!("public"))),
            // Its own file: seen only by the entity the act is made for.
            Some(Value::Id(i)) if i == "own" => Ok(Some(json!([self.speaks_for(c)?]))),
            Some(_) => Ok(self.ids(c, "visible")?.map(|v| json!(v))),
        }
    }
    fn yes(c: &Call, key: &str) -> R<bool> {
        Ok(Self::str_(c, key)?.is_some_and(|s| s.eq_ignore_ascii_case("yes") || s.eq_ignore_ascii_case("true")))
    }
    /// Whose name a record is in: the seat's own entity, unless the call says otherwise.
    fn speaks_for(&self, c: &Call) -> R<String> {
        Ok(self.id(c, "for")?.unwrap_or_else(|| self.me.clone()))
    }
    fn quantity(&self, c: &Call, key: &str) -> R<Option<String>> {
        match Self::str_(c, key)? {
            None => Ok(None),
            Some(s) => unit(calls::parse_count(&s, self.k.currency.as_ref(), false)).map(|n| Some(n.to_string())),
        }
    }
    /// When (a date, or a length of time from when the paper is lodged), as written. A date already past is a question.
    fn when(&self, c: &Call, key: &str) -> R<Option<calls::When>> {
        match Self::str_(c, key)? {
            None => Ok(None),
            Some(s) => match unit(calls::parse_when_in(&s, self.k.t, self.k.dated.as_ref()))? {
                calls::When::At(at) if at + 86_400 <= self.k.t => ask(format!(
                    "{} is already past: today is {}. Give today's date or a later one, or a length of time from now.",
                    forms::date_words_in(at, self.k.dated.as_ref()),
                    forms::date_words_in(self.k.t, self.k.dated.as_ref())
                )),
                w => Ok(Some(w)),
            },
        }
    }

    // --- single physical answers

    /// The account to pay from: the one given, or the only one the seat's entity holds.
    fn payer(&self, c: &Call, purpose: &str) -> R<String> {
        if let Some(given) = self.id(c, "from")? {
            return Ok(given);
        }
        let own = self.k.accounts_of(&self.me);
        match own.len() {
            1 => Ok(own[0].clone()),
            0 => ask(format!("Which account should {purpose} come from? You don't know of one you hold.")),
            _ => ask(format!("Which account should {purpose} come from: {}?", own.join(" or "))),
        }
    }
    /// Where money goes: an account, or the only account the seat knows an entity holds.
    fn payee(&self, to: &str, commitment: bool) -> R<String> {
        if to.starts_with('$') || self.k.is_account(to) {
            return Ok(to.into());
        }
        let e = self.k.entity_of(to);
        let known = self.k.has_name(&e) || e != to || self.k.stated.contains_key(&e);
        let accts = self.k.accounts_of(&e);
        if accts.len() == 1 {
            return Ok(accts[0].clone());
        }
        if accts.len() > 1 {
            return ask(format!("Which of {}'s accounts: {}?", self.k.name(&e), accts.join(" or ")));
        }
        if known && !commitment {
            return ask(format!("Which of {}'s accounts should it go to? You don't know one.", self.k.name(&e)));
        }
        Ok(if commitment && known { e } else { to.into() })
    }
    fn keeper(&self, account: &str) -> Option<String> {
        self.k.accounts.get(account).map(|a| a.custodian.clone())
    }

    fn line(&mut self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let bindj = || bind.map(|b| json!(b));
        match c.fn_.as_str() {
            "money" => self.money(c, bind),
            "goods" => self.goods(c),
            "take" => self.take(c),
            "connection" => self.connection(c, bind),
            "link" => self.link(c),
            "work" => self.work(c, bind),
            "account" => self.account(c, bind),
            "structure" => self.structure(c, bind),
            "occupancy" => self.occupancy(c),
            "entity" => self.entity(c, bind),
            "claim" => self.claim(c, bind),
            "agreement" => self.agreement(c, bind),
            "statement" => self.statement(c, bind),
            "vote" => {
                let ballot = self.need(c, "ballot", "Which ballot?")?;
                let choice = Self::str_(c, "choice")?;
                let sf = self.speaks_for(c)?;
                let vis = self.visible(c)?;
                Ok(vec![obj(vec![("block", some("vote")), ("ballot", some(ballot)), ("choice", choice.map(Json::from)), ("speaks_for", some(sf)), ("visible_to", vis)])])
            }
            "message" => {
                let to = self.ids(c, "to")?;
                let text = Self::str_(c, "text")?;
                let re = self.id(c, "re")?;
                Ok(vec![obj(vec![("block", some("message")), ("to", to.map(|v| json!(v))), ("text", text.map(Json::from)), ("re", re.map(Json::from))])])
            }
            "form" => self.form(c, bind),
            "presence" => self.presence(c, bind),
            "birth" => {
                let name = Self::str_(c, "name")?;
                let template = Self::str_(c, "template")?;
                let with = if Self::has(c, "with") { Some(self.k.entity_of(&self.id(c, "with")?.unwrap_or_default())) } else { None };
                let _ = bindj;
                Ok(vec![obj(vec![("block", some("birth")), ("name", name.map(Json::from)), ("template", template.map(Json::from)), ("with", with.map(Json::from))])])
            }
            "harm" => {
                let who = self.need(c, "who", "Whom?")?;
                Ok(vec![json!({ "block": "harm", "person": self.k.entity_of(&who) })])
            }
            "position" => self.position(c, bind),
            "system" => self.system(c, bind),
            other => ask(format!("unknown function {other}")),
        }
    }

    /// Moving your own goods: from where you hold them to someone (yourself by default) at a place.
    fn goods(&self, c: &Call) -> R<Vec<Json>> {
        let kind = self.need(c, "kind", "Of what?")?;
        let quantity = self.quantity(c, "quantity")?;
        let Some(quantity) = quantity.filter(|q| q != "0") else { return ask("How much?") };
        let to = self.k.entity_of(&self.id(c, "to")?.unwrap_or_else(|| self.me.clone()));
        let Some(to_at) = self.id(c, "at")? else {
            return ask(if to == self.me { "Where to? Somewhere you keep things.".to_string() } else { format!("Where should {} get them: at which place?", self.k.name(&to)) });
        };
        let from_at = match self.id(c, "from_at")? {
            Some(f) => f,
            None => {
                let places = self.k.places_holding(&kind);
                match places.len() {
                    0 => return ask(format!("You don't hold any {kind} that you know of.")),
                    1 => places[0].clone(),
                    _ => return ask(format!("From where: {}?", places.join(" or "))),
                }
            }
        };
        Ok(vec![json!({ "block": "move_goods", "kind": kind, "quantity": quantity, "from_at": from_at, "to": to, "to_at": to_at })])
    }

    /// Work: units of a task at a place, by the people named.
    fn work(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let task = self.need(c, "task", "What work?")?;
        if Self::has(c, "every") {
            return self.standing_work(c, task, bind);
        }
        if Self::has(c, "first") || Self::has(c, "until") {
            return ask("Work asked for once is done now. When it starts and how long it goes on are said of work done again and again: say how often.");
        }
        // A survey (nature): of a species or a field, in these cells, a unit each.
        let survey = self.id(c, "survey")?;
        let cells = if survey.is_some() { self.ids(c, "cells")?.filter(|l| !l.is_empty()) } else { None };
        if survey.is_some() && cells.is_none() {
            return ask("Survey which cells?");
        }
        let units = match (&cells, self.quantity(c, "units")?) {
            (Some(l), None) => Some(l.len().to_string()),
            (_, u) => u,
        };
        // (Neither how much nor how often: which of the two is asked, in the asker's terms. The words are the other
        // resolver's, `ONCE_OR_ROUTINE` in translator/src/resolver.ts.)
        // Neither how much nor how often, of a routine whose rhythm the office's own procedure states: a standing
        // order that follows it.
        let none = units.as_deref().map_or(true, |u| u == "0");
        if none && survey.is_none() && !Self::has(c, "investigate") && self.k.routine(&task).is_some_and(|r| r.every.is_some() || r.schedule.is_some()) {
            return self.standing_work(c, task, bind);
        }
        let Some(units) = units.filter(|u| u != "0") else {
            return ask("Is this work to be done once, or as a standing routine of your staff? Done once: say how much of it. As a routine: say how often (every day, every week), and it is a standing work order.");
        };
        let at = self.need(c, "at", "Where?")?;
        let by: Vec<String> = if Self::has(c, "by") {
            let list = match self.ids(c, "by")? {
                Some(l) => l,
                None => vec![self.id(c, "by")?.unwrap_or_default()],
            };
            list.iter().map(|p| self.k.entity_of(p)).collect()
        } else {
            vec![]
        };
        let on = self.id(c, "on")?;
        let survey = survey.zip(cells).map(|(of, cells)| json!({ "of": of, "cells": cells }));
        // An investigation (crime): of goods of a kind taken from someone, at a structure.
        let investigate = match self.id(c, "investigate")? {
            None => None,
            Some(from) => {
                let Some(taken_at) = self.id(c, "taken_at")? else { return ask("Taken from where?") };
                let kind = self.need(c, "kind", "Taken: what?")?;
                Some(json!({ "from": self.k.entity_of(&from), "at": taken_at, "kind": kind }))
            }
        };
        Ok(vec![obj(vec![("block", some("work")), ("task", some(task)), ("units", some(units.parse::<i64>().unwrap_or(0))), ("at", some(at)), ("performers", some(json!(by))), ("on", on.map(Json::from)), ("survey", survey), ("investigate", investigate)])])
    }

    /// A standing work order: work to be done again and again by the organisation's own staff, put on its own file.
    /// Nothing is done here; the staff whose work it is follow it each time it falls due, while it stands.
    /// (translator/src/resolver.ts is the same, step for step.)
    fn standing_work(&self, c: &Call, task: String, bind: Option<&str>) -> R<Vec<Json>> {
        if Self::has(c, "survey") || Self::has(c, "investigate") {
            return ask("A survey or an investigation is asked for each time, with what it is of: it can't be a standing order.");
        }
        let at = self.need(c, "at", "Where?")?;
        // How often: a length of time; or, of a routine whose time a published paper sets, that paper named; or
        // nothing, and the order follows the rhythm the office's own procedure states for the task.
        let routine = self.k.routine(&task).cloned();
        let said = Self::str_(c, "every")?;
        let mut every: Option<i64> = None;
        let mut schedule: Option<String> = None;
        match &said {
            None => match &routine {
                Some(r) if r.schedule.is_some() => schedule = r.schedule.clone(),
                Some(r) if r.every.is_some() => every = r.every,
                _ => return ask("How often?"),
            },
            Some(s) => match calls::parse_duration(s) {
                Ok(e) => every = Some(e),
                Err(_) => {
                    let lower = s.to_lowercase();
                    let named = routine.as_ref().and_then(|r| r.schedule.as_ref()).is_some_and(|p| {
                        lower.split(|ch: char| !(ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '.' || ch == '-')).any(|w| w.trim_end_matches('.') == p)
                    });
                    match &routine {
                        Some(r) if named => schedule = r.schedule.clone(),
                        Some(r) if r.schedule.is_some() => {
                            let p = r.schedule.as_ref().unwrap();
                            return ask(format!("\"{s}\" could not be read as how often. By your office's procedure ({}) the staff do {task} when {p} sets: say \"as {p} sets\", or leave how often out and the order follows it.", r.procedure));
                        }
                        Some(r) if r.every.is_some() => {
                            return ask(format!("\"{s}\" could not be read as how often. Say it as a length of time (\"every 7 days\", \"each working day\"), or leave it out: by your office's procedure ({}) the staff do {task} every {}, and an order that does not say how often follows that.", r.procedure, duration_words(r.every.unwrap())));
                        }
                        _ => return unit(Err(calls::UnitError(format!("not how often: {s}")))),
                    }
                }
            },
        }
        if every.is_some_and(|e| e <= 0) {
            return ask("How often?");
        }
        let rhythm = match &schedule {
            Some(p) => format!("as {p} sets"),
            None => format!("every {}", duration_words(every.unwrap_or(0))),
        };
        let first = self.when(c, "first")?;
        let until = self.when(c, "until")?;
        let by: Option<Vec<String>> = if Self::has(c, "by") {
            let mut v: Vec<String> = vec![];
            for p in self.ids(c, "by")?.unwrap_or_default() {
                let e = self.k.entity_of(&p);
                if !v.contains(&e) {
                    v.push(e);
                }
            }
            Some(v)
        } else {
            None
        };
        let on: Option<Vec<String>> = if Self::has(c, "on") {
            let mut v: Vec<String> = vec![];
            for p in self.ids(c, "on")?.unwrap_or_default() {
                if !v.contains(&p) {
                    v.push(p);
                }
            }
            Some(v)
        } else {
            None
        };
        let units = self.quantity(c, "units")?;
        let me = self.speaks_for(c)?;
        let mut text = format!("Standing work order: {task} at {at}");
        if let Some(o) = &on {
            text.push_str(&format!(", on {}", o.join(", ")));
        }
        if let Some(b) = &by {
            text.push_str(&format!(", by {}", b.join(", ")));
        }
        if let Some(u) = &units {
            text.push_str(&format!(", {u} each time"));
        }
        text.push_str(&format!(", {rhythm}"));
        match first {
            Some(calls::When::At(at)) => text.push_str(&format!(", the first on {}", forms::date_words_in(at, self.k.dated.as_ref()))),
            Some(calls::When::In(f)) => text.push_str(&format!(", the first in {}", duration_words(f))),
            None => {}
        }
        match until {
            Some(calls::When::At(at)) => text.push_str(&format!(", until the end of {}", forms::date_words_in(at, self.k.dated.as_ref()))),
            Some(calls::When::In(u)) => text.push_str(&format!(", for {}", duration_words(u))),
            None => {}
        }
        text.push('.');
        let mut seen = vec![me.clone()];
        for b in by.iter().flatten() {
            if !seen.contains(b) {
                seen.push(b.clone());
            }
        }
        let mut work = serde_json::Map::new();
        work.insert("task".into(), json!(task));
        work.insert("at".into(), json!(at));
        if let Some(o) = &on {
            work.insert("on".into(), json!(o));
        }
        if let Some(b) = &by {
            work.insert("by".into(), json!(b));
        }
        if let Some(u) = &units {
            work.insert("units".into(), json!(u.parse::<i64>().unwrap_or(0)));
        }
        let mut data = serde_json::Map::new();
        data.insert("work".into(), Json::Object(work));
        match &schedule {
            Some(p) => {
                data.insert("schedule".into(), json!(p));
            }
            None => {
                data.insert("every".into(), json!(every.unwrap_or(0)));
            }
        }
        if said.is_none() {
            if let Some(r) = &routine {
                data.insert("by_procedure".into(), json!(r.procedure));
            }
        }
        match first {
            Some(calls::When::At(at)) => {
                data.insert("first_at".into(), json!(at));
            }
            Some(calls::When::In(f)) => {
                data.insert("first".into(), json!(f));
            }
            None => {}
        }
        // (An end given as a date is the end of that day; as a length of time, so long from now.)
        match until {
            Some(calls::When::At(at)) => {
                data.insert("until".into(), json!(at + 86_400));
            }
            Some(calls::When::In(u)) => {
                data.insert("until".into(), json!(self.k.t + u));
            }
            None => {}
        }
        Ok(vec![obj(vec![("block", some("publish")), ("kind", some("work_order")), ("text", some(text)), ("speaks_for", some(me.clone())), ("addressed_to", some(json!([me]))), ("visible_to", some(json!(seen))), ("data", some(Json::Object(data))), ("ref", bind.map(|b| json!(b)))])])
    }

    /// Taking goods another holds, where we are (crime: world-expansion 7.3).
    fn take(&self, c: &Call) -> R<Vec<Json>> {
        let kind = self.need(c, "kind", "Take what?")?;
        let Some(quantity) = self.quantity(c, "quantity")?.filter(|q| q != "0") else { return ask("How much?") };
        let from = self.k.entity_of(&self.need(c, "from", "Whose?")?);
        let at = self.need(c, "at", "Where?")?;
        Ok(vec![json!({ "block": "take", "kind": kind, "quantity": quantity, "from": from, "at": at })])
    }

    /// An act on a connection (foundations-2 C3): `op` open (with kind, node, to, at, rate, uses, meter), set (rate),
    /// close, interrupt, restore; the connection named by `connection`, but for a new one.
    fn connection(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let op = Self::str_(c, "op")?.unwrap_or_else(|| "set".into());
        if !["open", "set", "close", "interrupt", "restore"].contains(&op.as_str()) {
            return ask("op should be open, set, close, interrupt or restore.");
        }
        let mut b = serde_json::Map::new();
        b.insert("block".into(), json!("connection"));
        b.insert("op".into(), json!(op));
        for key in ["connection", "node", "at", "uses"] {
            if let Some(x) = self.id(c, key)? {
                b.insert(key.into(), json!(x));
            }
        }
        if let Some(k) = Self::str_(c, "kind")? {
            b.insert("kind".into(), json!(k));
        }
        if let Some(to) = self.id(c, "to")? {
            b.insert("to".into(), json!(self.k.entity_of(&to)));
        }
        if let Some(m) = Self::str_(c, "meter")? {
            b.insert("meter".into(), json!(m));
        }
        // (A rate may be nought: a household turning its use off.)
        match Self::str_(c, "rate")? {
            Some(r) if !r.is_empty() && r.bytes().all(|x| x.is_ascii_digit()) => {
                b.insert("rate".into(), json!(r.parse::<i64>().unwrap_or(0)));
            }
            Some(_) => {
                if let Some(q) = self.quantity(c, "rate")? {
                    b.insert("rate".into(), json!(q.parse::<i64>().unwrap_or(0)));
                }
            }
            None => {}
        }
        if op == "set" && !b.contains_key("rate") {
            return ask("Set it to what rate (a day)?");
        }
        if op != "open" && !b.contains_key("connection") {
            return ask("Which connection?");
        }
        if let Some(r) = bind {
            b.insert("ref".into(), json!(r));
        }
        Ok(vec![Json::Object(b)])
    }

    /// An act on a link of one's network: `op` shut, open, reclose, or rotate (`every`, `off`: lengths of time; `from`:
    /// when the schedule's count begins, a length of time from now; `off` nothing ends it).
    fn link(&self, c: &Call) -> R<Vec<Json>> {
        let link = self.need(c, "link", "Which link?")?;
        let op = Self::str_(c, "op")?.unwrap_or_default();
        if !["shut", "open", "reclose", "rotate"].contains(&op.as_str()) {
            return ask("op should be shut, open, reclose or rotate.");
        }
        let mut b = serde_json::Map::new();
        b.insert("block".into(), json!("link"));
        b.insert("link".into(), json!(link));
        b.insert("op".into(), json!(op));
        if let Some(e) = Self::seconds(c, "every")? {
            b.insert("every".into(), json!(e));
        }
        if let Some(o) = Self::seconds(c, "off")? {
            b.insert("off".into(), json!(o));
        }
        if let Some(f) = Self::seconds(c, "from")? {
            b.insert("from".into(), json!(self.k.t + f));
        }
        Ok(vec![Json::Object(b)])
    }

    /// The money outcome of a call, for requests and commitments.
    fn money_outcome(&self, c: &Call, from: Option<String>, commitment: bool) -> R<Json> {
        let Some(amount) = self.amount(c, "amount")? else { return ask("How much?") };
        let to = self.payee(&self.need(c, "to", "Paid to whom?")?, commitment)?;
        let purpose = Self::str_(c, "for")?.filter(|p| !p.is_empty());
        let settles = self.id(c, "settles")?;
        let line = self.id(c, "line")?;
        Ok(obj(vec![("from", from.map(Json::from)), ("to", some(to)), ("amount", some(amount)), ("for", purpose.map(Json::from)), ("settles", settles.map(Json::from)), ("line", line.map(Json::from))]))
    }

    fn money(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let from = self.payer(c, "the payment")?;
        let out = self.money_outcome(c, Some(from.clone()), false)?;
        let every = Self::seconds(c, "every")?.filter(|e| *e != 0);
        let first = self.when(c, "first")?;
        // (When it starts is said of a payment made again and again: one asked for once is made when it is asked.
        // The words are the other resolver's, `ONCE_IS_NOW`.)
        if first.is_some() && every.is_none() {
            return ask("A payment asked for once is made when it is asked: it can't be given a day to start. For a payment made again and again, say how often; for one payment on a later day, ask for it on that day.");
        }
        let Some(keeper) = self.keeper(&from) else {
            return ask(format!("You don't know who keeps account {from}, so you can't ask them to pay from it."));
        };
        let (to, amount) = (out["to"].as_str().unwrap_or_default().to_string(), out["amount"].as_str().unwrap_or_default().to_string());
        let purpose = out["for"].as_str().map(String::from);
        // The request a payment carries out is a record, and only whoever keeps the account carries one out: said of a
        // payment that is itself a request to the keeper it means nothing, and is refused, never passed over. (The
        // words are the other resolver's, `PER_REQUEST_IS_THE_KEEPERS`.)
        let per = Self::record(c, "per_request")?;
        if per.is_some() && keeper != self.me {
            return ask("per_request is written only by whoever keeps the account the money is paid from, and names the request to pay that they are carrying out: leave it out.");
        }
        if keeper == self.me {
            // The seat's own entity keeps the money: it moves it itself.
            if every.is_some() {
                return ask("You keep this money yourself, so a repeating payment means paying each time. Say when to pay this one.");
            }
            return Ok(vec![obj(vec![
                ("block", some("transfer")),
                ("from", some(from)),
                ("to", some(to)),
                ("amount", some(amount)),
                ("settles", out.get("settles").cloned()),
                ("per_instruction", per.map(Json::from)),
                ("memo", purpose.map(|p| json!(slice16(&p, 500)))),
                ("line", out.get("line").cloned()),
            ])]);
        }
        // Someone else keeps it: the only physical option is to ask them. They decide.
        let (first_in, first_at) = match first {
            Some(calls::When::In(f)) => (Some(f), None),
            Some(calls::When::At(at)) => (None, Some(at)),
            None => (None, None),
        };
        let text = format!(
            "Please pay {} from {from} to {to}{}{}{}.",
            calls::format_money(&amount, self.currency()?),
            every.map(|e| format!(" every {} days", nearest_days(e))).unwrap_or_default(),
            first_at.map(|at| format!(", the first on {}", forms::date_words_in(at, self.k.dated.as_ref()))).unwrap_or_default(),
            purpose.as_ref().map(|p| format!(", for {p}")).unwrap_or_default()
        );
        let mut money = out.clone();
        money.as_object_mut().unwrap().insert("from".into(), json!(from));
        let data = obj(vec![("outcome", some(json!({ "money": money }))), ("every", every.map(Json::from)), ("first_at", first_at.map(Json::from)), ("first", first_in.map(Json::from))]);
        let basis = self.basis(c)?;
        Ok(vec![obj(vec![
            ("block", some("publish")),
            ("kind", some("request")),
            ("speaks_for", some(self.me.clone())),
            ("addressed_to", some(json!([keeper]))),
            ("visible_to", some(json!([self.me, keeper]))),
            ("text", some(text)),
            ("data", some(data)),
            ("basis", basis),
            ("ref", bind.map(Json::from)),
        ])])
    }

    fn account(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let at = self.id(c, "at")?;
        let close = self.id(c, "close")?;
        let keeper = match (&at, &close) {
            (Some(a), _) => Some(self.k.entity_of(a)),
            (None, Some(cl)) => self.keeper(cl),
            _ => None,
        };
        let Some(keeper) = keeper else {
            return ask(match &close { Some(cl) => format!("You don't know who keeps account {cl}."), None => "Who should keep the account: you, or someone else (who)?".into() });
        };
        if keeper == self.me {
            if let Some(cl) = close {
                return Ok(vec![json!({ "block": "close_account", "account": cl })]);
            }
            let holder = self.need(c, "holder", "An account for whom?")?;
            return Ok(vec![obj(vec![("block", some("open_account")), ("holder", some(holder)), ("ref", bind.map(Json::from))])]);
        }
        let holder = self.id(c, "holder")?.unwrap_or_else(|| self.me.clone());
        let text = match &close { Some(cl) => format!("Please close account {cl}."), None => format!("Please open an account for {holder}.") };
        let account = obj(vec![("holder", some(holder.clone())), ("close", close.clone().map(Json::from))]);
        Ok(vec![obj(vec![
            ("block", some("publish")),
            ("kind", some("request")),
            ("speaks_for", some(self.me.clone())),
            ("addressed_to", some(json!([keeper]))),
            ("visible_to", some(json!([self.me, keeper]))),
            ("text", some(text)),
            ("data", some(json!({ "outcome": { "account": account } }))),
            ("ref", bind.map(Json::from)),
        ])])
    }

    fn structure(&mut self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let remove = self.id(c, "remove")?;
        let by = self.id(c, "by")?;
        let place = match &remove {
            Some(r) => format!("demolish {r}"),
            None => format!("build a {} on {}", Self::str_(c, "type")?.unwrap_or_else(|| "?".into()), Self::str_(c, "on")?.unwrap_or_else(|| "?".into())),
        };
        let Some(by) = by else { return ask(format!("Who should {place}?")) };
        let type_ = if remove.is_some() { None } else { Some(self.need(c, "type", "What should be built?")?) };
        let on = if remove.is_some() { None } else { Some(self.need(c, "on", "On which lot or cell?")?) };
        let basis = self.basis(c)?;
        if self.k.entity_of(&by) == self.me {
            // Building it yourself: materials from your own holding where you keep them; the building work is work.
            let yard = self.id(c, "materials_at")?;
            return Ok(match remove {
                Some(r) => vec![json!({ "block": "demolish", "structure": r })],
                None => {
                    let at = self.corner(on.as_deref().unwrap(), type_.as_deref().unwrap())?;
                    vec![obj(vec![("block", some("construct")), ("at", some(at)), ("structure_type", type_.map(Json::from)), ("materials_at", yard.map(Json::from)), ("ref", bind.map(Json::from))])]
                }
            });
        }
        // Someone else builds: offer them an agreement, signed on its side. They decide.
        let builder = self.k.entity_of(&by);
        let Some(price) = self.amount(c, "price")? else { return ask(format!("For what price should {} {place}?", self.k.name(&builder))) };
        let from = self.payer(c, "the payment")?;
        let r = bind.map(String::from).unwrap_or_else(|| self.fresh("offer"));
        let what = match &remove { Some(rm) => json!({ "remove": rm }), None => json!({ "type": type_, "on": on }) };
        let text = format!("{} will {place}; {} pays {} from {from}.", self.k.name(&builder), self.k.name(&self.me), calls::format_money(&price, self.currency()?));
        Ok(vec![
            obj(vec![
                ("block", some("propose_agreement")),
                ("speaks_for", some(self.me.clone())),
                ("ref", some(r.clone())),
                ("basis", basis),
                (
                    "terms",
                    some(json!({
                        "template": "construction", "parties": [self.me, builder],
                        "commitments": [
                            { "who": builder, "does": { "outcome": { "structure": what } } },
                            { "who": self.me, "does": { "outcome": { "money": { "from": from, "to": builder, "amount": price } } } },
                        ],
                        "text": text,
                    })),
                ),
            ]),
            json!({ "block": "sign_agreement", "agreement": format!("${r}"), "as": self.me }),
        ])
    }

    /// Where a building goes: a cell stated outright is its corner; on a lot, the one corner from which the type's
    /// footprint fits the lot's unbuilt cells of a terrain it can stand on.
    fn corner(&self, on: &str, type_: &str) -> R<String> {
        let Some(lot) = self.k.lots.get(on).filter(|_| !on.starts_with('$')) else { return Ok(on.into()) };
        let Some(t) = (self.type_of)(type_) else { return ask(format!("You don't know what a {type_} is.")) };
        let (w, h) = (t["footprint"]["w"].as_i64().unwrap_or(1), t["footprint"]["h"].as_i64().unwrap_or(1));
        let terrains: Option<Vec<&str>> = t["terrains"].as_array().map(|a| a.iter().filter_map(Json::as_str).collect());
        let at = |x: i64, y: i64| lot.iter().find(|id| self.k.cells.get(*id).is_some_and(|c| c.x == x && c.y == y));
        let fits = |id: &String| {
            let Some(c0) = self.k.cells.get(id) else { return false };
            for dx in 0..w {
                for dy in 0..h {
                    let Some(info) = at(c0.x + dx, c0.y + dy).and_then(|cell| self.k.cells.get(cell)) else { return false };
                    if info.built {
                        return false;
                    }
                    let ok = match &terrains {
                        Some(ts) => info.terrain.as_deref().is_some_and(|x| ts.contains(&x)),
                        None => info.terrain.is_none(),
                    };
                    if !ok {
                        return false;
                    }
                }
            }
            true
        };
        let mut corners: Vec<&String> = lot.iter().filter(|id| fits(id)).collect();
        corners.sort();
        match corners.len() {
            1 => Ok(corners[0].clone()),
            0 => ask(format!("A {type_} ({w} by {h}) doesn't fit on the open ground of {on} as far as you've seen. Which cell should its corner be?")),
            n => ask(format!("Which cell of {on} should the {type_}'s corner be on: {}{}?", corners.iter().take(12).map(|s| s.as_str()).collect::<Vec<_>>().join(", "), if n > 12 { ", …" } else { "" })),
        }
    }

    /// The space meant by `in`: a space stated outright, or the only space in a building the seat has seen.
    fn space(&self, inside: &str) -> R<String> {
        if inside.starts_with('$') || inside.contains('/') {
            return Ok(inside.into());
        }
        let Some(s) = self.k.structures.get(inside) else { return ask(format!("Which space in {inside}? You haven't seen inside it.")) };
        if s.spaces.len() == 1 {
            return Ok(s.spaces[0].clone());
        }
        ask(format!("Which space in {inside}: {}{}?", s.spaces.iter().take(12).cloned().collect::<Vec<_>>().join(", "), if s.spaces.len() > 12 { ", …" } else { "" }))
    }

    /// Whose body: the seat's own person unless the call names someone.
    fn body(&self, c: &Call) -> R<String> {
        Ok(match self.id(c, "who")? {
            None => self.k.entity.clone(),
            Some(w) if w.starts_with('$') => w,
            Some(w) => self.k.entity_of(&w),
        })
    }

    fn occupancy(&self, c: &Call) -> R<Vec<Json>> {
        let inside = self.need(c, "in", "Where?")?;
        let who = self.body(c)?;
        if Self::yes(c, "leave")? {
            return Ok(vec![json!({ "block": "vacate", "occupant": who, "from": inside })]);
        }
        let space = self.space(&inside)?;
        let who = (who != self.k.entity).then_some(who);
        Ok(vec![obj(vec![("block", some("occupy")), ("space", some(space)), ("who", who.map(Json::from))])])
    }

    fn occupancy_outcome(&self, c: &Call) -> R<Json> {
        let inside = self.need(c, "in", "Where?")?;
        let who = self.body(c)?;
        let leave = Self::yes(c, "leave")?;
        Ok(json!({ "occupancy": obj(vec![("who", some(who)), ("in", some(inside)), ("leave", leave.then_some(json!(true)))]) }))
    }

    fn entity(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let position = Self::str_(c, "position")?.filter(|p| !p.is_empty());
        let channels = Self::json_(c, "channels")?;
        let module = Self::json_(c, "role_module")?;
        let first = position.map(|p| obj(vec![("title", some(p)), ("channels", channels), ("role_module", module)]));
        let kind = Self::str_(c, "kind")?.map(|k| as_label(&k)).filter(|k| !k.is_empty());
        let name = Self::str_(c, "name")?;
        let vis = self.visible(c)?;
        Ok(vec![obj(vec![("block", some("create_entity")), ("kind", kind.map(Json::from)), ("name", name.map(Json::from)), ("first_position", first), ("visible_to", vis), ("ref", bind.map(Json::from))])])
    }

    /// Coming into the world (a newcomer, or someone returning) or leaving it.
    fn presence(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let who = self.id(c, "who")?;
        let person = who.map(|w| if w.starts_with('$') { w } else { self.k.entity_of(&w) });
        if Self::yes(c, "leave")? {
            let p = person.filter(|p| *p != self.k.entity);
            return Ok(vec![obj(vec![("block", some("leave")), ("person", p.map(Json::from))])]);
        }
        if let Some(p) = person {
            return Ok(vec![json!({ "block": "arrive", "person": p })]);
        }
        let name = Self::str_(c, "name")?;
        let template = Self::str_(c, "template")?;
        let (Some(name), Some(template)) = (name.filter(|x| !x.is_empty()), template.filter(|x| !x.is_empty())) else {
            return ask("Who is coming: someone returning (who), or a newcomer (their name, age and template)?");
        };
        let Some(age) = Self::seconds(c, "age")? else { return ask(format!("How old is {name}?")) };
        let carrying = self.amount(c, "carrying")?;
        // (A newcomer's body variables: a JSON object, as given.)
        let variables = Self::json_(c, "variables")?;
        let sex = Self::str_(c, "sex")?.filter(|x| !x.is_empty());
        if sex.as_deref().is_some_and(|s| s != "female" && s != "male") {
            return ask("sex should be female or male.");
        }
        Ok(vec![obj(vec![
            ("block", some("arrive")),
            ("name", some(name)),
            ("template", some(template)),
            ("born_at", some(self.k.t - age)),
            ("sex", sex.map(Json::from)),
            ("carrying", carrying.filter(|c| !c.is_empty()).map(Json::from)),
            ("variables", variables),
            ("ref", bind.map(Json::from)),
        ])])
    }

    /// An organisation's positions: create one, appoint someone to one, or leave one empty.
    fn position(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        if let Some(v) = self.id(c, "vacate")? {
            return Ok(vec![json!({ "block": "appoint", "position": v })]);
        }
        if let Some(appoint) = self.id(c, "appoint")? {
            let to = self.need(c, "to", &format!("Whom should {appoint} go to?"))?;
            // A person named for the post means the participant that is that person.
            let participant = self.k.participant_person.iter().find(|(_, e)| *e == to).map(|(p, _)| p.clone()).unwrap_or(to);
            return Ok(vec![json!({ "block": "appoint", "position": appoint, "participant": participant })]);
        }
        let Some(title) = Self::str_(c, "title")?.filter(|t| !t.is_empty()) else { return ask("What is the new position called?") };
        let channels = Self::json_(c, "channels")?;
        let module = Self::json_(c, "role_module")?;
        let role = Self::str_(c, "role")?.map(|r| as_label(&r)).filter(|r| !r.is_empty());
        Ok(vec![obj(vec![("block", some("create_position")), ("title", some(title)), ("role", role.map(Json::from)), ("channels", channels), ("role_module", module), ("ref", bind.map(Json::from))])])
    }

    fn system(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        if let Some(r) = self.id(c, "retire")? {
            return Ok(vec![json!({ "block": "retire", "participant": r })]);
        }
        let Some(template) = Self::str_(c, "template")?.filter(|t| !t.is_empty()) else { return ask("Which kind of system (its template)?") };
        let title = Self::str_(c, "title")?.filter(|t| !t.is_empty());
        // (The client, if the supplier delivers it to another organisation: `to`. Absent: the supplier itself.)
        let to = self.id(c, "to")?.map(|t| self.k.entity_of(&t));
        Ok(vec![obj(vec![("block", some("deploy")), ("template", some(template)), ("to", to.map(Json::from)), ("title", title.map(Json::from)), ("ref", bind.map(Json::from))])])
    }

    fn common(&self, c: &Call, bind: Option<&str>) -> R<Vec<(&'static str, Option<Json>)>> {
        Ok(vec![("speaks_for", some(self.speaks_for(c)?)), ("basis", self.basis(c)?), ("visible_to", self.visible(c)?), ("ref", bind.map(Json::from))])
    }

    fn claim(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let common = self.common(c, bind)?;
        let with = |mut v: Vec<(&str, Option<Json>)>| {
            v.extend(common.iter().cloned());
            obj(v)
        };
        if let Some(r) = self.id(c, "release")? {
            return Ok(vec![with(vec![("block", some("release_claim")), ("claim", some(r))])]);
        }
        if let Some(t) = self.id(c, "transfer")? {
            let to = self.need(c, "to", "To whom?")?;
            return Ok(vec![with(vec![("block", some("transfer_claim")), ("claim", some(t)), ("to", some(to))])]);
        }
        let position = Self::str_(c, "position")?;
        let Some(position) = position.filter(|p| ["right", "liberty", "power", "immunity"].contains(&p.as_str())) else {
            return ask("What kind of claim: a right, a liberty (a permission), a power or an immunity?");
        };
        let against = self.id(c, "against")?;
        let holder = self.id(c, "holder")?.unwrap_or_else(|| self.me.clone());
        let about = Self::json_(c, "about")?.unwrap_or_else(|| json!({}));
        Ok(vec![with(vec![("block", some("record_claim")), ("position", some(position)), ("holder", some(holder)), ("counterparty", against.map(Json::from)), ("about", some(about))])])
    }

    /// A nested call as a commitment's outcome.
    fn outcome(&self, v: Option<&Value>, who: &str) -> R<Option<Json>> {
        let Some(v) = v else { return Ok(None) };
        let c = match v {
            Value::Call(c) => c,
            Value::Text(t) => return Ok(Some(json!({ "does": { "text": t } }))),
            Value::Json(j) => return Ok(Some(json!({ "does": { "text": j.to_string() } }))),
            Value::Id(i) => return Ok(Some(json!({ "does": { "text": json!({ "id": i }).to_string() } }))),
            Value::Var(x) => return Ok(Some(json!({ "does": { "text": json!({ "var": x }).to_string() } }))),
        };
        let every = if c.fn_ == "money" || c.fn_ == "goods" || c.fn_ == "work" { Self::seconds(c, "every")? } else { None };
        if c.fn_ == "work" && Self::has(c, "by") && self.ids(c, "by")?.unwrap_or_default().iter().any(|p| self.k.entity_of(p) != self.k.entity_of(who)) {
            return ask("In an agreement each side commits itself: the work a side commits to is its own to do, and nobody else is named for it.");
        }
        let outcome = match c.fn_.as_str() {
            "money" => json!({ "money": self.money_outcome(c, self.id(c, "from")?, true)? }),
            "goods" => {
                let kind = self.need(c, "kind", "Of what?")?;
                let quantity = self.quantity(c, "quantity")?.unwrap_or_else(|| "0".into());
                let to = self.k.entity_of(&self.need(c, "to", "Delivered to whom?")?);
                let at = self.need(c, "at", "Delivered where?")?;
                let from = self.id(c, "from_at")?;
                json!({ "goods": obj(vec![("kind", some(kind)), ("quantity", some(quantity)), ("to", some(to)), ("at", some(at)), ("from", from.map(Json::from))]) })
            }
            "occupancy" => self.occupancy_outcome(c)?,
            "structure" => match self.id(c, "remove")? {
                Some(r) => json!({ "structure": { "remove": r } }),
                None => json!({ "structure": obj(vec![("type", self.id(c, "type")?.map(Json::from)), ("on", self.id(c, "on")?.map(Json::from))]) }),
            },
            "account" => {
                let holder = self.id(c, "holder")?.unwrap_or_else(|| who.to_string());
                let close = self.id(c, "close")?;
                json!({ "account": obj(vec![("holder", some(holder)), ("close", close.map(Json::from))]) })
            }
            // Work a side commits to: the kind of work, as a label, where, and how much each time if said.
            "work" => {
                let task = Some(as_label(&Self::str_(c, "task")?.unwrap_or_default())).filter(|t| !t.is_empty()).unwrap_or_else(|| "work".into());
                let at = self.id(c, "at")?;
                let units = self.quantity(c, "units")?;
                json!({ "work": obj(vec![("task", some(task)), ("at", at.map(Json::from)), ("units", units.map(Json::from))]) })
            }
            other => return ask(format!("A commitment can be money, goods, a building, occupancy, an account or work, not {other}.")),
        };
        Ok(Some(obj(vec![("does", some(json!({ "outcome": outcome }))), ("every", every.filter(|e| *e != 0).map(Json::from))])))
    }

    fn agreement(&mut self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        if let Some(sign) = self.id(c, "sign")? {
            if self.k.withdrawn.contains(&sign) {
                return ask(format!("{sign} has been withdrawn: if it was an offer, whoever made it has taken it back, and there is nothing to sign."));
            }
            let as_ = self.id(c, "for")?.unwrap_or_else(|| self.me.clone());
            return Ok(vec![obj(vec![("block", some("sign_agreement")), ("agreement", some(sign)), ("as", some(as_)), ("ref", bind.map(Json::from))])]);
        }
        if let Some(notice) = self.id(c, "notice")? {
            let as_ = self.id(c, "for")?.unwrap_or_else(|| self.me.clone());
            let text = Self::str_(c, "text")?.filter(|t| !t.is_empty());
            return Ok(vec![obj(vec![("block", some("give_notice")), ("agreement", some(notice)), ("as", some(as_)), ("text", text.map(Json::from))])]);
        }
        let me = self.id(c, "for")?.unwrap_or_else(|| self.me.clone());
        let other = self.need(c, "with", "An agreement with whom?")?;
        let ours = self.outcome(c.get("we_do"), &me)?;
        let theirs = self.outcome(c.get("they_do"), &other)?;
        let mut commitments = vec![];
        for (who, o) in [(&me, ours), (&other, theirs)] {
            if let Some(Json::Object(mut m)) = o {
                m.insert("who".into(), json!(who));
                let mut ordered = Map::new();
                ordered.insert("who".into(), json!(who));
                ordered.extend(m);
                commitments.push(Json::Object(ordered));
            }
        }
        // The job's ordinary hours in a week (an employment's hours term, 2026-10-13): the other side's commitment to work them.
        if let Some(h) = Self::seconds(c, "hours")?.filter(|h| *h != 0) {
            commitments.push(json!({ "who": other, "does": { "outcome": { "work": { "task": "ordinary_hours", "hours": h } } }, "every": 7 * 86_400 }));
        }
        if commitments.is_empty() {
            return ask("An agreement says what each side is to do or pay, and this one says nothing either side commits to. Say what you will do or pay, and what they will: money, goods, a building, occupancy, an account or work.");
        }
        let term = Self::seconds(c, "term")?.filter(|t| *t != 0);
        // After the term: it may continue, periodically, until ended by notice.
        let then = match Self::str_(c, "then")?.filter(|t| !t.is_empty()) {
            None => None,
            Some(t) if t == "periodic" => Some(t),
            Some(t) => return ask(format!("After its term, an agreement can only continue periodically (then=periodic), not \"{t}\".")),
        };
        let mut termination = vec![];
        if Self::has(c, "our_notice") {
            termination.push(json!({ "party": me, "notice": Self::seconds(c, "our_notice")? }));
        }
        if Self::has(c, "their_notice") {
            termination.push(json!({ "party": other, "notice": Self::seconds(c, "their_notice")? }));
        }
        let text = match Self::str_(c, "terms")? {
            Some(t) => Some(t),
            None => Self::str_(c, "text")?,
        }
        .filter(|t| !t.is_empty());
        let r = bind.map(String::from).unwrap_or_else(|| self.fresh("offer"));
        let basis = self.basis(c)?;
        let vis = self.visible(c)?;
        let template = Self::str_(c, "template")?.map(|t| as_label(&t)).filter(|t| !t.is_empty());
        let terms = obj(vec![
            ("template", template.map(Json::from)),
            ("parties", some(json!([me, other]))),
            ("commitments", some(json!(commitments))),
            ("term", term.map(Json::from)),
            ("then", then.map(Json::from)),
            ("termination", (!termination.is_empty()).then(|| json!(termination))),
            ("text", text.map(Json::from)),
        ]);
        Ok(vec![
            obj(vec![("block", some("propose_agreement")), ("ref", some(r.clone())), ("speaks_for", some(me.clone())), ("basis", basis), ("visible_to", vis), ("terms", some(terms))]),
            json!({ "block": "sign_agreement", "agreement": format!("${r}"), "as": me }),
        ])
    }

    fn statement(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let common = self.common(c, bind)?;
        if let Some(w) = self.id(c, "withdraw")? {
            let text = Self::str_(c, "text")?.filter(|t| !t.is_empty());
            let mut v = vec![("block", some("withdraw")), ("record", some(w)), ("text", text.map(Json::from))];
            v.extend(common);
            return Ok(vec![obj(v)]);
        }
        if Self::has(c, "hold") {
            return self.hold(c, common);
        }
        let kind = Self::str_(c, "kind")?.map(|k| as_label(&k)).filter(|k| !k.is_empty());
        let text = Self::str_(c, "text")?.filter(|t| !t.is_empty());
        let Some(kind) = kind else { return ask("What kind of statement is it (a notice, a law, a report, …)?") };
        let Some(text) = text else { return ask("What should it say?") };
        let to = self.ids(c, "to")?.map(|v| v.iter().map(|x| if x.starts_with('$') { x.clone() } else { self.k.entity_of(x) }).collect::<Vec<_>>());
        let data = Self::json_(c, "data")?;
        let adico = Self::json_(c, "adico")?;
        let formal = Self::str_(c, "formal")?.filter(|f| !f.is_empty());
        // Where it is put up: a cell of ground. A lot of one cell is that cell; of several, which is asked; anything
        // else is no place. (The other resolver's, word for word.)
        let mut on = self.id(c, "on")?;
        if let Some(p) = on.clone().filter(|p| !p.starts_with('$') && !is_cell(p)) {
            match self.k.lots.get(p.as_str()) {
                Some(cells) if cells.len() == 1 => on = Some(cells[0].clone()),
                Some(cells) if cells.len() > 1 => {
                    return ask(format!("Which cell of {p} should it be put up on: {}{}?", cells.iter().take(12).map(|s| s.as_str()).collect::<Vec<_>>().join(", "), if cells.len() > 12 { ", …" } else { "" }));
                }
                _ => return ask(format!("A paper is put up at a place on the ground: a lot, or a cell of one. {p} is neither, as far as you know. To publish it and put it up nowhere, leave the place out; to put one paper in another's place, withdraw the other and publish this.")),
            }
        }
        let offer = Self::json_(c, "offer")?;
        let practice = Self::json_(c, "practice")?;
        let assertion = Self::json_(c, "assertion")?;
        let registry = Self::json_(c, "registry")?;
        let mut v = vec![
            ("block", some("publish")),
            ("kind", some(kind)),
            ("text", some(text)),
            ("addressed_to", to.map(|t| json!(t))),
            ("place", on.map(Json::from)),
            ("data", data),
            ("adico", adico),
            ("formal", formal.map(|f| json!({ "language": "cel", "condition": f }))),
            ("offer", offer),
            ("practice", practice),
            ("assertion", assertion),
            ("registry", registry),
        ];
        v.extend(common);
        Ok(vec![obj(v)])
    }

    /// A hold (contracts/calls.md): an instruction to whoever acts on a standing record not to act on it while the
    /// hold stands. Who that is, is the one physical answer: whoever the record is addressed to, as the seat knows it
    /// (or whoever the call says). Nothing is stopped here: the one addressed honours it, or doesn't.
    fn hold(&self, c: &Call, common: Vec<(&'static str, Option<Json>)>) -> R<Vec<Json>> {
        let kind = Self::str_(c, "kind")?.map(|k| as_label(&k)).filter(|k| !k.is_empty());
        let other = ["kind", "data", "adico", "formal", "on", "offer", "practice", "assertion", "registry"].iter().any(|k| Self::has(c, k) && !(*k == "kind" && kind.as_deref() == Some("hold")));
        if other {
            return ask("A hold says only what it holds, in what words, for whom and on what basis: nothing else should be written.");
        }
        let mut held: Vec<String> = vec![];
        for x in self.ids(c, "hold")?.unwrap_or_default() {
            if !held.contains(&x) {
                held.push(x);
            }
        }
        if held.is_empty() {
            return ask("Hold what? Name it by its id.");
        }
        let me = self.speaks_for(c)?;
        let given = self.ids(c, "to")?.map(|v| v.iter().map(|x| if x.starts_with('$') { x.clone() } else { self.k.entity_of(x) }).collect::<Vec<_>>());
        let mut to: Vec<String> = vec![];
        for x in &held {
            if x.starts_with('$') {
                return ask("A hold names something already on record, not something made in the same act.");
            }
            if self.k.withdrawn.contains(x) {
                return ask(format!("{x} has been withdrawn: there is nothing to hold."));
            }
            let acts: Vec<String> = match (&given, self.k.addressed.get(x.as_str())) {
                (Some(g), _) => g.clone(),
                (None, Some(a)) => a.to_vec(),
                (None, None) => return ask(format!("You don't know of a standing paper called {x} that someone acts on. Look it up and name it by its id, or say who is to hold it.")),
            };
            for a in acts {
                if a != me && !to.contains(&a) {
                    to.push(a);
                }
            }
        }
        let several = held.len() > 1;
        // (What is addressed to nobody but the organisation itself is acted on by its own people: the hold goes on
        // its own file, where they read it. A standing work order is such a paper.)
        let own = to.is_empty();
        let text = Self::str_(c, "text")?.filter(|t| !t.is_empty()).unwrap_or_else(|| format!("Please hold {}: nothing is to be done under {} until this is withdrawn.", held.join(", "), if several { "them" } else { "it" }));
        let mut seen = vec![me.clone()];
        if !own {
            seen.extend(to.iter().cloned());
        }
        let addressed = if own { vec![me] } else { to };
        let mut v = vec![("block", some("publish")), ("kind", some("hold")), ("text", some(text)), ("addressed_to", some(json!(addressed))), ("data", some(json!({ "holds": held }))), ("visible_to", some(json!(seen)))];
        // (What the call says of who sees it stands in place of that.)
        for (k, x) in common {
            if x.is_some() {
                v.retain(|(name, _)| *name != k);
                v.push((k, x));
            }
        }
        Ok(vec![obj(v)])
    }

    fn form(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        // The form, by its name as written: its own name or record id, or the same in ordinary words ("permit
        // application", "the event permit form"). One nobody has seen is said to be that before anything else is
        // asked. Known, and its office not said: it goes where it says it goes, if that's one place.
        // (translator/src/resolver.ts is the same, step for step.)
        let written = match c.get("form") {
            Some(Value::Id(x)) | Some(Value::Text(x)) => x.clone(),
            _ => return ask("Which form?"),
        };
        let lower = written.trim().to_lowercase();
        let no_the = match lower.strip_prefix("the") {
            Some(rest) if rest.starts_with(char::is_whitespace) => rest.trim_start().to_string(),
            _ => lower.clone(),
        };
        let mut plain = String::new();
        let mut gap = false;
        for ch in no_the.chars() {
            if ch.is_whitespace() || ch == '-' {
                gap = true;
            } else {
                if gap && !plain.is_empty() {
                    plain.push('_');
                }
                gap = false;
                plain.push(ch);
            }
        }
        if gap && !plain.is_empty() {
            plain.push('_');
        }
        let short = plain.strip_suffix("_form").unwrap_or(&plain).to_string();
        let spelled = |x: &Json| x["data"]["form"].as_str().is_some_and(|f| f == written || f == plain || f == short);
        let known: Vec<&Json> = self.k.standing_forms().into_iter().filter(|x| spelled(x) || x["id"].as_str() == Some(written.as_str())).collect();
        if known.is_empty() {
            return ask(label_text("unknown_form"));
        }
        let name = if known.iter().any(|x| x["id"].as_str() == Some(written.as_str())) { written.clone() } else { known[0]["data"]["form"].as_str().unwrap_or_default().to_string() };
        let mut goes: Vec<String> = vec![];
        for x in &known {
            let w = Knowledge::form_of(x);
            if !goes.contains(&w) {
                goes.push(w);
            }
        }
        goes.sort();
        let to = if Self::has(c, "to") {
            self.need(c, "to", "Which office's form?")?
        } else if goes.len() == 1 {
            goes[0].clone()
        } else {
            return ask("Which office's form?");
        };
        let Some(f) = self.k.form(&to, &name) else {
            // Known by name but not from that office: say where it goes, rather than that it's unknown.
            let elsewhere: Vec<&Json> = self.k.standing_forms().into_iter().filter(|x| x["data"]["form"].as_str() == Some(name.as_str()) || x["id"].as_str() == Some(name.as_str())).collect();
            if elsewhere.is_empty() {
                return ask(label_text("unknown_form"));
            }
            let mut where_: Vec<String> = vec![];
            for x in elsewhere {
                let w = Knowledge::form_of(x);
                if !where_.contains(&w) {
                    where_.push(w);
                }
            }
            return ask(format!("The {} form isn't one {to} takes: it goes to {}.", name.replace('_', " "), where_.join(" or ")));
        };
        let spec = &f["data"];
        let form_name = spec["form"].as_str().unwrap_or_default().replace('_', " ");
        let fields = spec["fields"].as_object().cloned().unwrap_or_default();
        let mut data = Map::new();
        let mut missing = vec![];
        for (field, t) in &fields {
            if !Self::has(c, field) {
                if t["required"].as_bool() == Some(true) {
                    missing.push(field.clone());
                }
                continue;
            }
            let x: Option<Json> = match t["type"].as_str().unwrap_or_default() {
                "amount" => self.amount(c, field)?.map(Json::from),
                "duration" => Self::seconds(c, field)?.map(Json::from),
                // (A count on a form may be nought: a vote with nobody against.)
                "count" => {
                    let s = Self::str_(c, field)?.unwrap_or_default();
                    Some(json!(unit(calls::parse_count(&s, self.k.currency.as_ref(), true))?))
                }
                "list" => self.ids(c, field)?.map(|v| json!(v)),
                "date" => match Self::str_(c, field)? {
                    None => None,
                    Some(s) => Some(json!(forms::parse_date_in(&s, self.k.t, self.k.dated.as_ref()).map_err(Stop::Ask)?)),
                },
                "text" | "structure_type" => Self::str_(c, field)?.map(Json::from),
                "choice" => {
                    let s = Self::str_(c, field)?.unwrap_or_default();
                    let options: Vec<&str> = t["options"].as_array().map(|a| a.iter().filter_map(Json::as_str).collect()).unwrap_or_default();
                    if !options.is_empty() && !options.contains(&s.as_str()) {
                        return ask(format!("{field} must be one of: {}.", options.join(", ")));
                    }
                    Some(json!(s))
                }
                "space" => Some(json!(self.space(&self.id(c, field)?.unwrap_or_default())?)),
                _ => self.id(c, field)?.map(Json::from),
            };
            if let Some(x) = x {
                data.insert(field.clone(), x);
            }
        }
        // (A paper of the office's own may be given its words as they are to stand, where the form has no field of that name.)
        let own_words = spec["writes"].is_object() && !fields.contains_key("text");
        let unknown: Vec<&str> = c.args.iter().map(|(k, _)| k.as_str()).filter(|a| !["to", "form", "for"].contains(a) && !fields.contains_key(*a) && !(*a == "text" && own_words)).collect();
        if !unknown.is_empty() {
            return ask(format!("The {form_name} form has no {} field. Its fields are: {}.", unknown.join(" or "), fields.keys().cloned().collect::<Vec<_>>().join(", ")));
        }
        if !missing.is_empty() {
            return ask(format!("The {form_name} needs: {}.", missing.join(", ")));
        }
        // A paper of the office's own (contracts: FormWrites): written from the fields as the form says, the statement
        // the rest of the world reads. It does not cite the form.
        if spec["writes"].is_object() {
            let me = self.id(c, "for")?.unwrap_or_else(|| self.me.clone());
            let own = if own_words && Self::has(c, "text") { Self::str_(c, "text")? } else { None };
            let money = |a: &str| {
                self.currency().map(|cur| calls::format_money(a, cur)).map_err(|s| match s {
                    Stop::Ask(m) | Stop::Unit(m) | Stop::Ambiguous(m, _) => m,
                })
            };
            let paper = forms::write_paper(spec, &data, &me, self.k.t, &money, self.k.dated.as_ref(), own.as_deref()).map_err(Stop::Ask)?;
            let mut block = Map::new();
            block.insert("block".into(), json!("publish"));
            for (k, v) in paper {
                let v = if k == "text" { json!(slice16(v.as_str().unwrap_or_default(), 16384)) } else { v };
                block.insert(k, v);
            }
            block.insert("speaks_for".into(), json!(me));
            if let Some(r) = bind {
                block.insert("ref".into(), json!(r));
            }
            // A claim the form records beside its paper (a permission granted with the decision): recorded first.
            let mut acts = vec![];
            if let Some(claim) = forms::write_claim(spec, &data, &me, self.k.t).map_err(Stop::Ask)? {
                let mut b = Map::new();
                b.insert("block".into(), json!("record_claim"));
                b.extend(claim);
                b.insert("speaks_for".into(), json!(me));
                acts.push(Json::Object(b));
            }
            acts.push(Json::Object(block));
            return Ok(acts);
        }
        // What was filled in, in words: an amount as the world writes its money, a length of time in days.
        let mut said: Vec<String> = vec![];
        for (k, x) in &data {
            let words = match (fields[k]["type"].as_str().unwrap_or_default(), x) {
                ("amount", Json::String(a)) => calls::format_money(a, self.currency()?),
                ("duration", Json::Number(n)) if n.as_i64().is_some() => duration_words(n.as_i64().unwrap_or_default()),
                _ => x.as_str().map(String::from).unwrap_or_else(|| x.to_string()),
            };
            said.push(format!("{} {words}", k.replace('_', " ")));
        }
        let summary = said.join(", ");
        let sf = self.id(c, "for")?.unwrap_or_else(|| self.me.clone());
        Ok(vec![obj(vec![
            ("block", some("publish")),
            ("kind", spec.get("submit_as").cloned()),
            ("speaks_for", some(sf)),
            ("addressed_to", spec.get("submit_to").cloned()),
            ("basis", f.get("id").cloned()),
            ("text", some(slice16(&format!("{form_name}: {summary}."), 16384))),
            ("data", some(Json::Object(data))),
            ("ref", bind.map(Json::from)),
        ])])
    }
}

/// Written as an id is written (lowercase letters, digits and `_.:/-`), not as a name.
fn written_as_id(x: &str) -> bool {
    !x.is_empty() && x.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || "_.:/-".contains(ch))
}

fn digits(s: &str, most: usize) -> bool {
    !s.is_empty() && s.len() <= most && s.bytes().all(|b| b.is_ascii_digit())
}
/// A chosen id (common.schema.json, ConfigId): a lowercase letter, then letters, digits, `_` and `-`, 64 at most.
fn config_id(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty() && b.len() <= 64 && b[0].is_ascii_lowercase() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_' || *c == b'-')
}
/// A cell of ground: `cell.<x>.<y>`.
fn is_cell(s: &str) -> bool {
    let mut p = s.split('.');
    p.next() == Some("cell") && p.next().is_some_and(|x| digits(x, 6)) && p.next().is_some_and(|y| digits(y, 6)) && p.next().is_none()
}
/// An id as the contract writes one (a chosen id, a minted one, a cell, a space), or a name bound in the same act.
/// (The other resolver's `ID_SHAPE`.)
fn id_shape(s: &str) -> bool {
    if let Some(v) = s.strip_prefix('$') {
        let b = v.as_bytes();
        return !b.is_empty() && b.len() <= 32 && b[0].is_ascii_lowercase() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_');
    }
    if config_id(s) || is_cell(s) {
        return true;
    }
    if let Some((prefix, n)) = s.split_once('.') {
        if ["ent", "acc", "str", "rec", "act", "msg", "par", "pos", "cnd", "conn"].contains(&prefix) && digits(n, 15) {
            return true;
        }
    }
    // A space: a structure (chosen, or minted `str.<n>`), a slash, a kind, a dot and a number.
    if let Some((structure, space)) = s.split_once('/') {
        let minted = structure.strip_prefix("str.").is_some_and(|n| digits(n, 15));
        if let Some((kind, n)) = space.rsplit_once('.') {
            return (config_id(structure) || minted) && config_id(kind) && digits(n, 6);
        }
    }
    false
}
/// What is said of something written where an id goes that is no id. (The other resolver's `notAnId`.)
fn not_an_id(x: &str, what: &str) -> String {
    if x.starts_with("draft.") {
        format!("{x} is the name a draft went by before it was confirmed, not a paper on record. Once confirmed it is on record under an id of its own (rec. and a number): look it up in your papers and name that.")
    } else {
        format!("\"{x}\" (for {what}) is not the id of anything on record: an id is written exactly as your papers show it, like rec.412. Look it up and name it so.")
    }
}

/// A length of time in words, as people say one: whole days where it is whole days ("14 days", "1 day"); else whole
/// hours ("8 hours"); else hours and minutes ("1 hour 30 minutes", "45 minutes"); seconds only where nothing rounder
/// fits. (The participants' forms write the same: `durationWords`.)
pub fn duration_words(seconds: i64) -> String {
    let n = |x: i64, word: &str| if x == 1 { format!("1 {word}") } else { format!("{x} {word}s") };
    if seconds % 86_400 == 0 {
        return n(seconds / 86_400, "day");
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

/// Seconds as whole days, to the nearest (half a day and over rounds up; a negative span mirrors it). Exact integers:
/// no floating point anywhere results depend on it (until 2026-10-05 this was a float division, rounded; the same
/// answers).
fn nearest_days(seconds: i64) -> i64 {
    seconds.signum() * (seconds.unsigned_abs() / 86_400 + u64::from(seconds.unsigned_abs() % 86_400 >= 43_200)) as i64
}

/// Words as a label (a statement's kind, an organisation's, a post's role, an agreement's template): lower case,
/// letters and digits kept, anything else one underscore between them, starting with a letter, at most 64 characters.
/// A label already written as one comes back unchanged (translator/src/resolver.ts `asLabel` is the same).
pub fn as_label(s: &str) -> String {
    let mut out = String::new();
    let mut gap = false;
    for ch in s.trim().chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_lowercase() || (!out.is_empty() && (ch.is_ascii_digit() || ch == '_')) {
            if gap && !out.ends_with('_') && ch != '_' {
                out.push('_');
            }
            gap = false;
            out.push(ch);
        } else if !out.is_empty() {
            gap = true;
        }
    }
    out.truncate(64);
    out
}

#[cfg(test)]
mod tests {
    use super::as_label;
    use super::{resolve, Resolution};
    use crate::calls::{parse_program, Currency};
    use crate::Knowledge;
    use serde_json::{json, Value as Json};

    /// A town's office, as its holder knows it: its account is kept by a bank.
    fn office() -> Knowledge {
        let mut k = Knowledge::new(Currency::from_config(&json!({ "code": "XYZ", "minor_units": 2 })));
        k.absorb(&json!({ "entity": "city", "t": 0, "positions": [], "channels": {
            "treasury": { "kind": "accounts", "transactions": [], "accounts": [{ "account": "acc-city", "holder": "city", "custodian": "bank", "balance": "10000000" }] },
            "who": { "kind": "directory", "entities": [{ "entity": "city", "name": "Millbrook" }, { "entity": "bank", "name": "Millbrook Bank" }, { "entity": "greenco", "name": "GreenCo" }], "positions": [] } } }));
        k
    }

    fn blocks(src: &str) -> Vec<Json> {
        match resolve(&parse_program(src).unwrap(), &office(), &|_| None, None) {
            Resolution::Blocks(b) => b,
            Resolution::Questions { questions, .. } => panic!("{src}: {questions:?}"),
        }
    }

    fn asks(src: &str) -> Vec<String> {
        match resolve(&parse_program(src).unwrap(), &office(), &|_| None, None) {
            Resolution::Blocks(b) => panic!("{src}: {b:?}"),
            Resolution::Questions { questions, .. } => questions,
        }
    }

    /// (The same cases as translator/test/resolver.test.ts has for this repository's resolver.)
    #[test]
    fn an_act_may_rest_on_several_records() {
        // Passed on in the order given, on every act that takes a basis.
        assert_eq!(blocks(r#"money(to=acc-greenco, amount="2,150", from=acc-city, settles=rec.640, basis=["rec.611","rec.627","rec.305"])"#)[0]["basis"], json!(["rec.611", "rec.627", "rec.305"]));
        assert_eq!(blocks(r#"structure(type=park, on=lot-00, by=greenco, price="60,000", from=acc-city, basis=["rec.512","rec.498"])"#)[0]["basis"], json!(["rec.512", "rec.498"]));
        assert_eq!(blocks(r#"agreement(with=greenco, terms="Mowing, weekly.", we_do=account(holder=greenco), basis=["rec.9","rec.3"])"#)[0]["basis"], json!(["rec.9", "rec.3"]));
        assert_eq!(
            blocks(r#"claim(position=liberty, holder=greenco, about={"action":"build","object":"lot-00"}, basis=["law-planning","rec.861"])"#),
            vec![json!({ "block": "record_claim", "position": "liberty", "holder": "greenco", "about": { "action": "build", "object": "lot-00" }, "speaks_for": "city", "basis": ["law-planning", "rec.861"] })]
        );
        assert_eq!(blocks(r#"claim(release=rec.70, basis=["rec.71","rec.72"])"#)[0]["basis"], json!(["rec.71", "rec.72"]));
        assert_eq!(blocks(r#"claim(transfer=rec.70, to=greenco, basis=["rec.71","rec.72"])"#)[0]["basis"], json!(["rec.71", "rec.72"]));
        assert_eq!(blocks(r#"statement(kind=notice, text="The pool closes.", basis=["rec.733","rec.741"])"#)[0]["basis"], json!(["rec.733", "rec.741"]));
        assert_eq!(blocks(r#"statement(withdraw=rec.50, basis=["rec.733","rec.741"])"#)[0]["basis"], json!(["rec.733", "rec.741"]));
        // One record is written one way: a list of one is that record, and one cited twice is cited once.
        let one = blocks(r#"statement(kind=notice, text="The pool closes.", basis=rec.733)"#);
        assert_eq!(one[0]["basis"], json!("rec.733"));
        assert_eq!(blocks(r#"statement(kind=notice, text="The pool closes.", basis=["rec.733"])"#), one);
        assert_eq!(blocks(r#"statement(kind=notice, text="The pool closes.", basis=["rec.733","rec.733"])"#), one);
        assert_eq!(blocks(r#"statement(kind=notice, text="The pool closes.", basis=["rec.733","rec.741","rec.733"])"#)[0]["basis"], json!(["rec.733", "rec.741"]));
        // What an earlier line makes can be among them, by the name it was bound to.
        let two = blocks("t = entity(kind=trust, name=\"River Land Trust\")\nstatement(kind=charter, text=\"Its charter.\", basis=[\"rec.5\",\"t\"])");
        assert_eq!(two[1]["basis"], json!(["rec.5", "$t"]));
        // A name in the list is something the seat knows, or a question; data that names nothing is a question.
        assert_eq!(asks(r#"statement(kind=notice, text="x", basis=["rec.733","the parks budget"])"#), vec![r#"You don't know of anyone or anything called "the parks budget" (for basis)."#]);
        assert_eq!(asks(r#"statement(kind=notice, text="x", basis=[])"#), vec!["basis should name at least one record."]);
        assert_eq!(asks(r#"statement(kind=notice, text="x", basis=[1,2])"#), vec!["basis should be a record, or a list of records."]);
        assert_eq!(asks(r#"statement(kind=notice, text="x", basis={"permit":"rec.1"})"#), vec!["basis should be a record, or a list of records."]);
        let many: Vec<String> = (1..=65).map(|i| format!("rec.{i}")).collect();
        assert_eq!(asks(&format!(r#"statement(kind=notice, text="x", basis={})"#, json!(many))), vec!["That cites more records than one act can: 64 at most."]);
        assert_eq!(blocks(&format!(r#"statement(kind=notice, text="x", basis={})"#, json!(many[..64])))[0]["basis"], json!(many[..64]));
    }

    /// (The same case as translator/test/resolver.test.ts has: an agreement's hours term, 2026-10-13.)
    #[test]
    fn an_agreements_hours_term_is_a_second_commitment_of_the_other_side() {
        let b = blocks(r#"agreement(with=greenco, template=employment, hours="136800 seconds", we_do=money(to=acc-greenco, amount="2,000", every="14 days", from=acc-city))"#);
        let c = b[0]["terms"]["commitments"].as_array().unwrap().iter().filter(|c| c["who"] == "greenco").cloned().collect::<Vec<_>>();
        assert_eq!(c, vec![json!({ "who": "greenco", "does": { "outcome": { "work": { "task": "ordinary_hours", "hours": 136_800 } } }, "every": 604_800 })]);
        let none = blocks(r#"agreement(with=greenco, template=employment, we_do=money(to=acc-greenco, amount="2,000", every="14 days", from=acc-city))"#);
        assert_eq!(none[0]["terms"]["commitments"].as_array().unwrap().len(), 1);
    }

    /// The payment a finance seat lost in a pilot (four dockets and a budget cited, written as a list): a request to
    /// the account's keeper that cites all five.
    #[test]
    fn a_payment_citing_five_records_is_a_request_that_cites_them() {
        let b = blocks(r#"money(amount="3,187.73", basis=["rec.11904","rec.16123","rec.21887","rec.25703","rec.25150"], for="disposal of waste", from=acc-city, settles=rec.28337, to=acc-outside)"#);
        assert_eq!(b.len(), 1);
        assert_eq!(b[0]["block"], json!("publish"));
        assert_eq!(b[0]["kind"], json!("request"));
        assert_eq!(b[0]["addressed_to"], json!(["bank"]));
        assert_eq!(b[0]["data"]["outcome"]["money"], json!({ "from": "acc-city", "to": "acc-outside", "amount": "318773", "for": "disposal of waste", "settles": "rec.28337" }));
        assert_eq!(b[0]["basis"], json!(["rec.11904", "rec.16123", "rec.21887", "rec.25703", "rec.25150"]));
    }

    #[test]
    fn words_as_a_label() {
        for (written, label) in [("notice", "notice"), ("permit_application", "permit_application"), ("supplementary evidence statement", "supplementary_evidence_statement"), ("  Rent-Increase  Notice ", "rent_increase_notice"), ("2nd reading", "nd_reading"), ("works_manager", "works_manager"), ("—", "")] {
            assert_eq!(as_label(written), label, "{written}");
        }
    }

    /// A hold, an entry on one's own file and the refusal sentences: the table this resolver and the repository's
    /// TypeScript one are both held to (contracts/test/holds.json; translator/test/holds.test.ts reads the same file).
    #[test]
    fn holds_entries_and_refusals_as_the_shared_table_says() {
        let table: Json = serde_json::from_str(include_str!("../../../../contracts/test/holds.json")).unwrap();
        let mut k = Knowledge::new(Currency::from_config(&table["currency"]));
        k.absorb(&table["observation"]);
        let cases = table["cases"].as_array().unwrap();
        assert!(cases.len() > 15);
        for c in cases {
            let name = c["name"].as_str().unwrap();
            let program = parse_program(c["program"].as_str().unwrap()).unwrap_or_else(|e| panic!("{name}: {e:?}"));
            match resolve(&program, &k, &|_| None, c["as"].as_str()) {
                Resolution::Blocks(b) => assert_eq!(json!(b), c["blocks"], "{name}"),
                Resolution::Questions { questions, .. } => assert_eq!(json!(questions), c["asks"], "{name}"),
            }
        }
    }

    /// Payments and the request a keeper's payment carries out: the table this resolver and the repository's
    /// TypeScript one are both held to (contracts/test/payments.json; translator/test/payments.test.ts reads the same
    /// file). Each case names the seat it is asked of.
    #[test]
    fn payments_as_the_shared_table_says() {
        let table: Json = serde_json::from_str(include_str!("../../../../contracts/test/payments.json")).unwrap();
        let cases = table["cases"].as_array().unwrap();
        assert!(cases.len() >= 9);
        for c in cases {
            let name = c["name"].as_str().unwrap();
            let mut k = Knowledge::new(Currency::from_config(&table["currency"]));
            k.absorb(&table["seats"][c["seat"].as_str().unwrap()]);
            let program = parse_program(c["program"].as_str().unwrap()).unwrap_or_else(|e| panic!("{name}: {e:?}"));
            match resolve(&program, &k, &|_| None, c["as"].as_str()) {
                Resolution::Blocks(b) => assert_eq!(json!(b), c["blocks"], "{name}"),
                Resolution::Questions { questions, .. } => assert_eq!(json!(questions), c["asks"], "{name}"),
            }
        }
    }

    /// Forms (a direction filed on an office's own form): the table this resolver and the repository's TypeScript one
    /// are both held to (contracts/test/forms.json; translator/test/forms.test.ts reads the same file).
    #[test]
    fn forms_as_the_shared_table_says() {
        let table: Json = serde_json::from_str(include_str!("../../../../contracts/test/forms.json")).unwrap();
        let mut k = Knowledge::new(Currency::from_config(&table["currency"]));
        k.absorb(&table["observation"]);
        let cases = table["cases"].as_array().unwrap();
        assert!(cases.len() >= 29);
        for c in cases {
            let name = c["name"].as_str().unwrap();
            let program = parse_program(c["program"].as_str().unwrap()).unwrap_or_else(|e| panic!("{name}: {e:?}"));
            match resolve(&program, &k, &|_| None, c["as"].as_str()) {
                Resolution::Blocks(b) => assert_eq!(json!(b), c["blocks"], "{name}"),
                Resolution::Questions { questions, .. } => assert_eq!(json!(questions), c["asks"], "{name}"),
            }
        }
    }

    /// Standing work orders: the table this resolver and the repository's TypeScript one are both held to
    /// (contracts/test/standing-work.json; translator/test/standing-work.test.ts reads the same file).
    #[test]
    fn standing_work_as_the_shared_table_says() {
        let table: Json = serde_json::from_str(include_str!("../../../../contracts/test/standing-work.json")).unwrap();
        let mut k = Knowledge::new(Currency::from_config(&table["currency"]));
        k.absorb(&table["observation"]);
        let cases = table["cases"].as_array().unwrap();
        assert!(cases.len() >= 26);
        for c in cases {
            let name = c["name"].as_str().unwrap();
            let program = parse_program(c["program"].as_str().unwrap()).unwrap_or_else(|e| panic!("{name}: {e:?}"));
            match resolve(&program, &k, &|_| None, c["as"].as_str()) {
                Resolution::Blocks(b) => assert_eq!(json!(b), c["blocks"], "{name}"),
                Resolution::Questions { questions, .. } => assert_eq!(json!(questions), c["asks"], "{name}"),
            }
        }
    }

    /// When and how many: the table this resolver and the repository's TypeScript one are both held to
    /// (contracts/test/when.json; translator/test/when.test.ts reads the same file).
    #[test]
    fn when_and_counts_as_the_shared_table_says() {
        use crate::calls::{parse_count, parse_when, When};
        let table: Json = serde_json::from_str(include_str!("../../../../contracts/test/when.json")).unwrap();
        let now = table["now"].as_i64().unwrap();
        let reads = table["reads"].as_array().unwrap();
        assert!(reads.len() >= 30);
        for r in reads {
            let text = r["text"].as_str().unwrap();
            let want = match (r["at"].as_i64(), r["in"].as_i64()) {
                (Some(at), None) => When::At(at),
                (None, Some(i)) => When::In(i),
                _ => panic!("{text}: a date or a length of time"),
            };
            assert_eq!(parse_when(text, now).unwrap_or_else(|e| panic!("{text}: {}", e.0)), want, "{text}");
        }
        for text in table["refused"].as_array().unwrap() {
            let text = text.as_str().unwrap();
            assert_eq!(parse_when(text, now).unwrap_err().0, format!("not a date or a duration: {text}"), "{text}");
        }
        let currency = |name: &str| Currency::from_config(&table["currencies"][name]).unwrap();
        for c in table["counts"].as_array().unwrap() {
            let text = c["text"].as_str().unwrap();
            let cur = currency(c["currency"].as_str().unwrap());
            assert_eq!(parse_count(text, Some(&cur), c["zero"].as_bool() == Some(true)).unwrap_or_else(|e| panic!("{text}: {}", e.0)), c["count"].as_i64().unwrap(), "{text}");
        }
        for c in table["not_counts"].as_array().unwrap() {
            let text = c["text"].as_str().unwrap();
            let cur = currency(c["currency"].as_str().unwrap());
            assert_eq!(parse_count(text, Some(&cur), false).unwrap_err().0, format!("not a count: {text}"), "{text}");
        }
        let mut k = Knowledge::new(Currency::from_config(&table["currency"]));
        k.absorb(&table["observation"]);
        let cases = table["cases"].as_array().unwrap();
        assert!(cases.len() >= 13);
        for c in cases {
            let name = c["name"].as_str().unwrap();
            let program = parse_program(c["program"].as_str().unwrap()).unwrap_or_else(|e| panic!("{name}: {e:?}"));
            match resolve(&program, &k, &|_| None, c["as"].as_str()) {
                Resolution::Blocks(b) => assert_eq!(json!(b), c["blocks"], "{name}"),
                Resolution::Questions { questions, .. } => assert_eq!(json!(questions), c["asks"], "{name}"),
            }
        }
    }

    /// A person or body named by name, in a world whose people have names and in one without: the table this resolver
    /// and the repository's TypeScript one are both held to (contracts/test/names.json; translator/test/names.test.ts
    /// reads the same file). Where names are on, a name the seat knows more than one by is `ambiguous`, never a guess.
    #[test]
    fn names_as_the_shared_table_says() {
        let table: Json = serde_json::from_str(include_str!("../../../../contracts/test/names.json")).unwrap();
        let cases = table["cases"].as_array().unwrap();
        assert!(cases.len() >= 13);
        let dump = std::env::var("OIKOS_DUMP_NAMES").is_ok();
        for c in cases {
            let name = c["name"].as_str().unwrap();
            let named = c["names"].as_bool() != Some(false);
            let mut k = Knowledge::new(Currency::from_config(&table["currency"])).with_names(named);
            k.absorb(&table["observation"]);
            let program = parse_program(c["program"].as_str().unwrap()).unwrap_or_else(|e| panic!("{name}: {e:?}"));
            let got = match resolve(&program, &k, &|_| None, c["as"].as_str()) {
                Resolution::Blocks(b) => json!({ "blocks": b }),
                Resolution::Questions { questions, ambiguous, .. } if ambiguous.is_empty() => json!({ "asks": questions }),
                Resolution::Questions { questions, ambiguous, .. } => json!({ "asks": questions, "ambiguous": ambiguous }),
            };
            if dump {
                println!("{name}\t{got}");
                continue;
            }
            let mut want = serde_json::Map::new();
            for key in ["blocks", "asks", "ambiguous"] {
                if let Some(v) = c.get(key) {
                    want.insert(key.into(), v.clone());
                }
            }
            assert_eq!(got, Json::Object(want), "{name}");
        }
    }

    /// A world without names takes in what it is shown as it always did: nothing kept of who is named where, and its
    /// knowledge saved as before (no new member), so a snapshot and a pinned hash do not move.
    #[test]
    fn a_world_without_names_knows_and_saves_what_it_always_did() {
        let table: Json = serde_json::from_str(include_str!("../../../../contracts/test/names.json")).unwrap();
        let mut off = Knowledge::new(Currency::from_config(&table["currency"]));
        off.absorb(&table["observation"]);
        assert!(off.named_in.is_empty() && !off.named);
        let saved = serde_json::to_value(&off).unwrap();
        assert!(saved.get("named").is_none() && saved.get("named_in").is_none(), "{saved}");
        let mut on = Knowledge::new(Currency::from_config(&table["currency"])).with_names(true);
        on.absorb(&table["observation"]);
        assert_eq!(on.named_in["c0002"].len(), 2);
        // (Everything else it knows is the same.)
        let (mut a, b) = (serde_json::to_value(&on).unwrap(), saved);
        a.as_object_mut().unwrap().remove("named");
        a.as_object_mut().unwrap().remove("named_in");
        assert_eq!(a, b);
        // And read back, it is what it was.
        let back: Knowledge = serde_json::from_value(serde_json::to_value(&on).unwrap()).unwrap();
        assert!(back.named && back.named_in == on.named_in);
    }

    use super::{duration_words, nearest_days};

    #[test]
    fn a_length_of_time_in_words() {
        for (seconds, words) in [(86_400, "1 day"), (14 * 86_400, "14 days"), (3600, "1 hour"), (28_800, "8 hours"), (5_400, "1 hour 30 minutes"), (2_700, "45 minutes"), (60, "1 minute"), (0, "0 days"), (86_401, "86401 seconds"), (1, "1 second")] {
            assert_eq!(duration_words(seconds), words);
        }
    }

    #[test]
    fn seconds_round_to_the_nearest_day_half_up() {
        const DAY: i64 = 86_400;
        for (seconds, days) in [(0, 0), (1, 0), (43_199, 0), (43_200, 1), (DAY - 1, 1), (DAY, 1), (DAY + 43_199, 1), (DAY + 43_200, 2), (3600, 0), (7 * DAY, 7), (14 * DAY, 14), (30 * DAY, 30), (90 * DAY, 90), (365 * DAY, 365)] {
            assert_eq!(nearest_days(seconds), days, "{seconds} s");
            assert_eq!(nearest_days(-seconds), -days, "-{seconds} s");
        }
        // (No overflow at the ends of the range.)
        assert_eq!(nearest_days(i64::MAX), i64::MAX / DAY + 1);
        assert_eq!(nearest_days(i64::MIN), i64::MIN / DAY - 1);
    }
}
