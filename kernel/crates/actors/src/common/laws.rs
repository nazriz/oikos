//! Laws weighed against an act (common.ts `prohibitions`, `breaches`, `holdsOf`, `noted`). A law binds a code actor
//! only this way, whoever passed it (genesis, a council, a model mayor through the translator), never through a field
//! only code reads (VISION 15). Whether to comply is still the actor's: breaking a law is always possible.

use super::book::Book;
use super::{data, is_kind, part, Piece};
use oikos_rules::law::{evaluate, Claim};
use oikos_sight::{Action, Record};
use serde_json::Value;
use std::sync::Arc;

/// Laws seen that prohibit (institutional grammar: must not) with a formal condition, in id order (`filed_before`):
/// those standing now, or, given a time, those in force then (made by then, and not withdrawn or replaced by then).
pub fn prohibitions(book: &Book, at: Option<i64>) -> Vec<&Arc<Record>> {
    let laws: Vec<&Arc<Record>> = match at {
        None => book.open("law").collect(),
        Some(t) => book.all("law").filter(|l| l.at <= t && book.withdrawn_at(&l.id).is_none_or(|w| w > t)).collect(),
    };
    let mut out: Vec<&Arc<Record>> = laws
        .into_iter()
        .filter(|l| condition_of(l).is_some() && part(l, Piece::Adico).get("deontic").and_then(|x| x.as_str()) == Some("must_not"))
        .collect();
    out.sort_by(|a, b| super::filed_before(&a.id, &b.id));
    out
}

/// A law's formal condition (CEL), if it has one.
pub fn condition_of(law: &Record) -> Option<&str> {
    part(law, Piece::Formal).get("condition").and_then(|x| x.as_str()).filter(|c| !c.is_empty())
}

/// The laws in force at `now`, as far as this reader has seen, that an act it is thinking of would breach:
/// prohibitions whose formal condition is true of the act (a notice is judged by the law as it stood when given).
pub fn breaches<'a>(book: &'a mut Book, act: &Value, actor: &str, now: i64) -> Vec<Arc<Record>> {
    let laws: Vec<Arc<Record>> = prohibitions(book, Some(now)).into_iter().cloned().collect();
    laws.into_iter().filter(|l| holds_of(book, l, act, actor, now, &[])).collect()
}

/// Is a law's formal condition true of an act, as this reader reads it? A condition that gives an error (it names a
/// field the act lacks) is not true of it, so the law does not bind the act; never silently: the book counts it and
/// the reader says so with its next reasons (`noted`).
pub fn holds_of(book: &mut Book, law: &Record, act: &Value, actor: &str, now: i64, claims: &[Claim]) -> bool {
    let Some(cond) = condition_of(law) else { return false };
    match evaluate(cond, act, actor, now, claims) {
        Ok(v) => v,
        Err(e) => {
            let what = [act.get("block"), act.get("kind")].iter().filter_map(|x| x.and_then(|x| x.as_str())).collect::<Vec<_>>().join(" ");
            book.note_unread(&law.id, if what.is_empty() { "an act" } else { &what }, &e);
            false
        }
    }
}

/// An action with, in its reasons, whatever its maker's book could not read of the laws and has not yet said.
pub fn noted(book: &mut Book, action: Action) -> Action {
    let add = |r: Option<String>, note: String| Some(match r {
        Some(r) if !r.is_empty() => format!("{r} {note}"),
        _ => note,
    });
    match action {
        Action::Wait { .. } => action,
        Action::Call { program, reasoning } => match book.take_unread() {
            Some(n) => Action::Call { program, reasoning: add(reasoning, n) },
            None => Action::Call { program, reasoning },
        },
        Action::Act { blocks, reasoning, by, provenance } => match book.take_unread() {
            Some(n) => Action::Act { blocks, reasoning: add(reasoning, n), by, provenance },
            None => Action::Act { blocks, reasoning, by, provenance },
        },
        other => other,
    }
}

/// The figures a law carries (`data.figures`), as plain values in the unit each is held in.
pub fn figures(law: &Record) -> std::collections::BTreeMap<String, i64> {
    if !is_kind(law, "law") {
        return Default::default();
    }
    oikos_rules::law::figures_of(data(law))
}
