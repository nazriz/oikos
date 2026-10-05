//! The resolver (docs/design/translator-and-resolver.md section 8): a call to the seat's own acts. Deterministic,
//! platform-side, and bound by four rules:
//!   - it never chooses how: the route is what the seat supplied; a missing decision is a question back (P6);
//!   - it fills in only single physical answers (the one account the seat holds; who keeps an account);
//!   - it never acts for anyone else: whoever must physically act is asked (a request) or offered an agreement (P7);
//!   - it uses only what the seat knows (P8). Ids the seat states outright are passed through: if one doesn't
//!     exist, physics says so.
//! The same as translator/src/resolver.ts, which it replaces in the engine.

use crate::calls::{self, Call, Program, Value};
use crate::knowledge::Knowledge;
use serde_json::{json, Map, Value as Json};
use std::collections::BTreeSet;

pub const RESOLVER_VERSION: &str = "0.4.0";

/// Fixed texts for the translator's refusal labels (section 11.1).
pub fn label_text(label: &str) -> &'static str {
    match label {
        "not_yours" => "That's for someone else to decide. You could write to them, or propose something.",
        "needs_calculation" => "Please state the amount itself.",
        "too_much" => "Please take this one step at a time.",
        "unknown_form" => "You haven't seen a form by that name.",
        "not_an_act" => "That's something to look up or read, not something to do. Look at your reports and papers, or write to whoever keeps it.",
        _ => "It isn't clear what should happen. Could you say it more plainly?",
    }
}

/// A resolution: the seat's acts (blocks, as the kernel reads them), or questions for the seat (and, when the call
/// itself broke the contract, what was wrong, for the log).
#[derive(Debug, Clone, PartialEq)]
pub enum Resolution {
    Blocks(Vec<Json>),
    Questions { questions: Vec<String>, invalid: Vec<String> },
}

enum Stop {
    Ask(String),
    Unit(String),
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
    let q = |s: &str| Resolution::Questions { questions: vec![s.to_string()], invalid: vec![] };
    let lines = match program {
        Program::None(label) => return q(label_text(label)),
        Program::Lines(l) => l,
    };
    if calls::program_text(program).encode_utf16().count() > 65536 {
        return q(label_text("too_much"));
    }
    let invalid = calls::contract_errors(program);
    if !invalid.is_empty() {
        return Resolution::Questions { questions: vec![label_text("unclear").into()], invalid };
    }
    let mut r = Resolver { k, me: k.acting_for(as_), refs: lines.iter().filter_map(|l| l.bind.clone()).collect(), n: 0, type_of };
    let mut blocks = vec![];
    let mut questions = vec![];
    for line in lines {
        match r.line(&line.call, line.bind.as_deref()) {
            Ok(b) => blocks.extend(b),
            Err(Stop::Ask(s)) => questions.push(s),
            Err(Stop::Unit(s)) => questions.push(format!("{s}. Please say it another way.")),
        }
    }
    if !questions.is_empty() {
        return Resolution::Questions { questions, invalid: vec![] };
    }
    if blocks.len() > 32 {
        return q(label_text("too_much"));
    }
    Resolution::Blocks(blocks)
}

struct Resolver<'a> {
    k: &'a Knowledge,
    me: String,
    refs: BTreeSet<String>,
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
            (Value::Id(i), None) => Ok(Some(i.clone())),
            (Value::Var(x), _) => Ok(Some(format!("${x}"))),
            (_, Some(n)) => {
                let found = self.k.by_name(n);
                match found.len() {
                    1 => Ok(Some(found[0].clone())),
                    0 => ask(format!("You don't know of anyone or anything called \"{n}\" (for {what}).")),
                    _ => ask(format!("More than one {what} is called \"{n}\": {}. Which one?", found.join(", "))),
                }
            }
            (Value::Json(_), _) => ask(format!("{what} should name something, not data.")),
            _ => ask(format!("{what} should name something, not a call.")),
        }
    }
    fn id(&self, c: &Call, key: &str) -> R<Option<String>> {
        self.id_as(c, key, key)
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
    fn amount(c: &Call, key: &str) -> R<Option<String>> {
        match Self::str_(c, key)? {
            None => Ok(None),
            Some(s) => unit(calls::parse_amount(&s)).map(Some),
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
    fn quantity(c: &Call, key: &str) -> R<Option<String>> {
        match Self::str_(c, key)? {
            None => Ok(None),
            Some(s) => unit(calls::parse_count(&s)).map(|n| Some(n.to_string())),
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
            "work" => self.work(c),
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
        let quantity = Self::quantity(c, "quantity")?;
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
    fn work(&self, c: &Call) -> R<Vec<Json>> {
        let task = self.need(c, "task", "What work?")?;
        // A survey (nature): of a species or a field, in these cells, a unit each.
        let survey = self.id(c, "survey")?;
        let cells = if survey.is_some() { self.ids(c, "cells")?.filter(|l| !l.is_empty()) } else { None };
        if survey.is_some() && cells.is_none() {
            return ask("Survey which cells?");
        }
        let units = match (&cells, Self::quantity(c, "units")?) {
            (Some(l), None) => Some(l.len().to_string()),
            (_, u) => u,
        };
        let Some(units) = units.filter(|u| u != "0") else { return ask("How much of it?") };
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

    /// Taking goods another holds, where we are (crime: world-expansion 7.3).
    fn take(&self, c: &Call) -> R<Vec<Json>> {
        let kind = self.need(c, "kind", "Take what?")?;
        let Some(quantity) = Self::quantity(c, "quantity")?.filter(|q| q != "0") else { return ask("How much?") };
        let from = self.k.entity_of(&self.need(c, "from", "Whose?")?);
        let at = self.need(c, "at", "Where?")?;
        Ok(vec![json!({ "block": "take", "kind": kind, "quantity": quantity, "from": from, "at": at })])
    }

    /// The money outcome of a call, for requests and commitments.
    fn money_outcome(&self, c: &Call, from: Option<String>, commitment: bool) -> R<Json> {
        let Some(amount) = Self::amount(c, "amount")? else { return ask("How much?") };
        let to = self.payee(&self.need(c, "to", "Paid to whom?")?, commitment)?;
        let purpose = Self::str_(c, "for")?.filter(|p| !p.is_empty());
        let settles = self.id(c, "settles")?;
        Ok(obj(vec![("from", from.map(Json::from)), ("to", some(to)), ("amount", some(amount)), ("for", purpose.map(Json::from)), ("settles", settles.map(Json::from))]))
    }

    fn money(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        let from = self.payer(c, "the payment")?;
        let out = self.money_outcome(c, Some(from.clone()), false)?;
        let every = Self::seconds(c, "every")?.filter(|e| *e != 0);
        let first = Self::seconds(c, "first")?;
        let Some(keeper) = self.keeper(&from) else {
            return ask(format!("You don't know who keeps account {from}, so you can't ask them to pay from it."));
        };
        let (to, amount) = (out["to"].as_str().unwrap_or_default().to_string(), out["amount"].as_str().unwrap_or_default().to_string());
        let purpose = out["for"].as_str().map(String::from);
        if keeper == self.me {
            // The seat's own entity keeps the money: it moves it itself.
            if every.is_some() {
                return ask("You keep this money yourself, so a repeating payment means paying each time. Say when to pay this one.");
            }
            let per = self.id(c, "per_request")?;
            return Ok(vec![obj(vec![
                ("block", some("transfer")),
                ("from", some(from)),
                ("to", some(to)),
                ("amount", some(amount)),
                ("settles", out.get("settles").cloned()),
                ("per_instruction", per.map(Json::from)),
                ("memo", purpose.map(|p| json!(slice16(&p, 500)))),
            ])]);
        }
        // Someone else keeps it: the only physical option is to ask them. They decide.
        let text = format!(
            "Please pay {} from {from} to {to}{}{}.",
            calls::format_money(&amount),
            every.map(|e| format!(" every {} days", nearest_days(e))).unwrap_or_default(),
            purpose.as_ref().map(|p| format!(", for {p}")).unwrap_or_default()
        );
        let mut money = out.clone();
        money.as_object_mut().unwrap().insert("from".into(), json!(from));
        let data = obj(vec![("outcome", some(json!({ "money": money }))), ("every", every.map(Json::from)), ("first", first.map(Json::from))]);
        let basis = self.id(c, "basis")?;
        Ok(vec![obj(vec![
            ("block", some("publish")),
            ("kind", some("request")),
            ("speaks_for", some(self.me.clone())),
            ("addressed_to", some(json!([keeper]))),
            ("visible_to", some(json!([self.me, keeper]))),
            ("text", some(text)),
            ("data", some(data)),
            ("basis", basis.map(Json::from)),
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
        let basis = self.id(c, "basis")?;
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
        let Some(price) = Self::amount(c, "price")? else { return ask(format!("For what price should {} {place}?", self.k.name(&builder))) };
        let from = self.payer(c, "the payment")?;
        let r = bind.map(String::from).unwrap_or_else(|| self.fresh("offer"));
        let what = match &remove { Some(rm) => json!({ "remove": rm }), None => json!({ "type": type_, "on": on }) };
        let text = format!("{} will {place}; {} pays {} from {from}.", self.k.name(&builder), self.k.name(&self.me), calls::format_money(&price));
        Ok(vec![
            obj(vec![
                ("block", some("propose_agreement")),
                ("speaks_for", some(self.me.clone())),
                ("ref", some(r.clone())),
                ("basis", basis.map(Json::from)),
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
        let kind = Self::str_(c, "kind")?;
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
        let carrying = Self::amount(c, "carrying")?;
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
        let role = Self::str_(c, "role")?.filter(|r| !r.is_empty());
        Ok(vec![obj(vec![("block", some("create_position")), ("title", some(title)), ("role", role.map(Json::from)), ("channels", channels), ("role_module", module), ("ref", bind.map(Json::from))])])
    }

    fn system(&self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        if let Some(r) = self.id(c, "retire")? {
            return Ok(vec![json!({ "block": "retire", "participant": r })]);
        }
        let Some(template) = Self::str_(c, "template")?.filter(|t| !t.is_empty()) else { return ask("Which kind of system (its template)?") };
        let title = Self::str_(c, "title")?.filter(|t| !t.is_empty());
        Ok(vec![obj(vec![("block", some("deploy")), ("template", some(template)), ("title", title.map(Json::from)), ("ref", bind.map(Json::from))])])
    }

    fn common(&self, c: &Call, bind: Option<&str>) -> R<Vec<(&'static str, Option<Json>)>> {
        Ok(vec![("speaks_for", some(self.speaks_for(c)?)), ("basis", self.id(c, "basis")?.map(Json::from)), ("visible_to", self.visible(c)?), ("ref", bind.map(Json::from))])
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
        let every = if c.fn_ == "money" || c.fn_ == "goods" { Self::seconds(c, "every")? } else { None };
        let outcome = match c.fn_.as_str() {
            "money" => json!({ "money": self.money_outcome(c, self.id(c, "from")?, true)? }),
            "goods" => {
                let kind = self.need(c, "kind", "Of what?")?;
                let quantity = Self::quantity(c, "quantity")?.unwrap_or_else(|| "0".into());
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
            other => return ask(format!("A commitment can be money, goods, a building, occupancy or an account, not {other}.")),
        };
        Ok(Some(obj(vec![("does", some(json!({ "outcome": outcome }))), ("every", every.filter(|e| *e != 0).map(Json::from))])))
    }

    fn agreement(&mut self, c: &Call, bind: Option<&str>) -> R<Vec<Json>> {
        if let Some(sign) = self.id(c, "sign")? {
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
        let basis = self.id(c, "basis")?;
        let vis = self.visible(c)?;
        let template = Self::str_(c, "template")?.filter(|t| !t.is_empty());
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
            obj(vec![("block", some("propose_agreement")), ("ref", some(r.clone())), ("speaks_for", some(me.clone())), ("basis", basis.map(Json::from)), ("visible_to", vis), ("terms", some(terms))]),
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
        let kind = Self::str_(c, "kind")?.filter(|k| !k.is_empty());
        let text = Self::str_(c, "text")?.filter(|t| !t.is_empty());
        let Some(kind) = kind else { return ask("What kind of statement is it (a notice, a law, a report, …)?") };
        let Some(text) = text else { return ask("What should it say?") };
        let to = self.ids(c, "to")?.map(|v| v.iter().map(|x| if x.starts_with('$') { x.clone() } else { self.k.entity_of(x) }).collect::<Vec<_>>());
        let data = Self::json_(c, "data")?;
        let adico = Self::json_(c, "adico")?;
        let formal = Self::str_(c, "formal")?.filter(|f| !f.is_empty());
        let on = self.id(c, "on")?;
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
            let w = x["in_position"].as_str().or(x["speaks_for"].as_str()).or(x["author"].as_str()).unwrap_or_default().to_string();
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
                let w = x["in_position"].as_str().or(x["speaks_for"].as_str()).or(x["author"].as_str()).unwrap_or_default().to_string();
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
                "amount" => Self::amount(c, field)?.map(Json::from),
                "duration" => Self::seconds(c, field)?.map(Json::from),
                "count" => Some(json!(unit(calls::parse_count(&Self::str_(c, field)?.unwrap_or_default()))?)),
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
        let unknown: Vec<&str> = c.args.iter().map(|(k, _)| k.as_str()).filter(|a| !["to", "form", "for"].contains(a) && !fields.contains_key(*a)).collect();
        if !unknown.is_empty() {
            return ask(format!("The {form_name} form has no {} field. Its fields are: {}.", unknown.join(" or "), fields.keys().cloned().collect::<Vec<_>>().join(", ")));
        }
        if !missing.is_empty() {
            return ask(format!("The {form_name} needs: {}.", missing.join(", ")));
        }
        let summary = data.iter().map(|(k, x)| format!("{} {}", k.replace('_', " "), x.as_str().map(String::from).unwrap_or_else(|| x.to_string()))).collect::<Vec<_>>().join(", ");
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

/// Seconds as whole days, to the nearest (half a day and over rounds up; a negative span mirrors it). Exact integers:
/// no floating point anywhere results depend on it (until 2026-10-05 this was a float division, rounded; the same
/// answers).
fn nearest_days(seconds: i64) -> i64 {
    seconds.signum() * (seconds.unsigned_abs() / 86_400 + u64::from(seconds.unsigned_abs() % 86_400 >= 43_200)) as i64
}

#[cfg(test)]
mod tests {
    use super::nearest_days;

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
