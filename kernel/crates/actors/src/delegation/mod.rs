//! Delegation (docs/design/delegation.md): a principal hands kinds of matter to an assistant it has engaged as a service,
//! each kind at a level of its own, and decides from what it has itself seen.
//!
//! * [`principal::Delegating`] wraps whatever code an organisation's post or a person already runs (any kind), so that its
//!   own work is unchanged: only an act of a kind it has delegated goes to its assistant instead (a `referral`), and what
//!   comes back (a draft to sign, a request to go ahead, a report) is dealt with in its own time. Its rule for engaging,
//!   for the level of each kind and for leaving is [`rule`], which reads only what its own channels showed it.
//! * [`assistant::Assistant`] (`assistant`) is the code that plays a provider's system: it carries out what it is referred,
//!   at the level the referral asks, with the slips its template has in the world's table, and reports. It decides nothing
//!   the principal did not: a model in the seat is what decides otherwise.
//!
//! A module is wrapped when the world gives its participant `delegation` parameters (the generator does, where a town has
//! providers and the post does matters some provider takes: docs/behaviour/assistants.md). A town without them is as
//! before, to the hash.

use crate::{Actor, Ctx, Kind};
use oikos_sight::calls::{Line, Program, Value as Arg};
use serde_json::Value;

pub mod assistant;
pub mod principal;
pub mod rule;

/// Every kind of this module, in name order.
pub static KINDS: &[&dyn Kind] = &[&assistant::Assistant];

/// The actor made for `ctx`, wrapped as a principal where its parameters give `delegation`.
pub fn wrap(ctx: &Ctx, inner: Box<dyn Actor>) -> Result<Box<dyn Actor>, String> {
    match ctx.params.get("delegation").filter(|v| v.is_object()) {
        Some(d) => Ok(Box::new(principal::Delegating::new(ctx, d.to_value(), inner)?)),
        None => Ok(inner),
    }
}

/// The same, as `save` left it: `inner` is restored by the caller from `saved["inner"]`.
pub fn rewrap(ctx: &Ctx, saved: &Value, restore_inner: impl FnOnce(Value) -> Result<Box<dyn Actor>, String>) -> Result<Box<dyn Actor>, String> {
    match ctx.params.get("delegation").filter(|v| v.is_object()) {
        Some(_) => {
            let inner = restore_inner(saved.get("inner").cloned().unwrap_or(Value::Null))?;
            Ok(Box::new(principal::Delegating::restore(saved.get("delegation").cloned().unwrap_or(Value::Null), inner)?))
        }
        None => restore_inner(saved.clone()),
    }
}

/// The kind of matter a line is: a paper's kind (`statement(kind=...)`), or the call itself (`money`, `agreement`). A
/// withdrawal is none (it goes with whatever it withdraws).
pub fn kind_of(line: &Line) -> Option<String> {
    let c = &line.call;
    if c.fn_ == "statement" {
        if c.get("withdraw").is_some() {
            return None;
        }
        return match c.get("kind") {
            Some(Arg::Id(k)) | Some(Arg::Text(k)) => Some(k.clone()),
            _ => None,
        };
    }
    Some(c.fn_.clone())
}

/// The kinds of matter a program is, in order, each once.
pub fn kinds_of(program: &Program) -> Vec<String> {
    let mut v: Vec<String> = vec![];
    if let Program::Lines(lines) = program {
        for k in lines.iter().filter_map(kind_of) {
            if !v.contains(&k) {
                v.push(k);
            }
        }
    }
    v
}

/// The names a call refers to that other lines of its program bind (the call language's variables), however deep.
pub fn vars_of(c: &oikos_sight::calls::Call) -> Vec<String> {
    let mut v = vec![];
    for (_, a) in &c.args {
        match a {
            Arg::Var(n) => v.push(n.clone()),
            Arg::Call(x) => v.extend(vars_of(x)),
            _ => {}
        }
    }
    v
}

/// The records a program's lines cite or address (its `basis`, `to`, `on`): what the matter is about, so that a paper
/// that comes back about one of them can be told to be about this matter.
pub fn subjects_of(program: &Program) -> Vec<String> {
    let mut v: Vec<String> = vec![];
    let mut add = |s: &str| {
        if !s.is_empty() && !v.iter().any(|x| x == s) {
            v.push(s.to_string());
        }
    };
    if let Program::Lines(lines) = program {
        for l in lines {
            for key in ["basis", "on", "to", "settles"] {
                match l.call.get(key) {
                    Some(Arg::Id(s)) => add(s),
                    Some(Arg::Json(Value::Array(a))) => a.iter().filter_map(Value::as_str).for_each(&mut add),
                    Some(Arg::Json(Value::String(s))) => add(s),
                    _ => {}
                }
            }
        }
    }
    v
}

#[cfg(test)]
mod tests;
