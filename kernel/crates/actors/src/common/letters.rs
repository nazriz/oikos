//! Letters to an office (common.ts `Letters`, `officeNote`, `REPORT_TAIL`, `whatItActsOn`, `acknowledged`,
//! `answering`, `PAYMENT_FAILED`, `PAYEE_DIED`; docs/behaviour/letters.md). A code office cannot read a letter: it
//! answers each once, with its standard report (the office's own figures, composed by code) or an acknowledgement
//! that says what it does act on. Office notes are never answered, so offices never write to each other for ever.
//!
//! The fixed words a bank writes and its readers recognise are here, once, so the writer and readers cannot drift.

use super::book::Book;
use super::{addressed_to, is_kind};
use crate::steps::{because, call, json, text, Step};
use oikos_rules::forms::Answers;
use oikos_sight::{Message, Picture};
use serde::{Deserialize, Serialize};

/// A letter to us, as `Letters` keeps it until answered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Letter {
    pub id: String,
    /// The participant who wrote it.
    pub from: String,
    /// The position it was written in, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    /// Whom it was written for (the person, or the position's organisation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
    pub text: String,
}

/// A letter: to these participants, in these words, in answer to `re`.
pub fn message(to: &[String], words: &str, re: Option<&str>) -> oikos_sight::calls::Call {
    call("message", vec![("to", Some(json(serde_json::Value::from(to.to_vec())))), ("text", Some(text(words))), ("re", re.map(crate::steps::arg))])
}

/// What a bank's payment system writes to an account holder when a payment it was asked to make was not made for want
/// of money (docs/behaviour/bank-payment-system.md). `amount` as the bank words it.
pub mod payment_failed {
    pub fn note(amount: &str, to: &str, request: &str) -> String {
        format!("Payment of {amount} to {to} (request {request}) failed: insufficient funds.")
    }
    /// The request it names, if a letter is this note.
    pub fn is(text: &str) -> Option<&str> {
        let rest = text.strip_prefix("Payment of ")?;
        let body = rest.strip_suffix(") failed: insufficient funds.")?;
        let (head, request) = body.rsplit_once(" (request ")?;
        let (_amount, to) = head.rsplit_once(" to ")?;
        (!to.contains(' ') && !request.contains(' ') && !request.is_empty()).then_some(request)
    }
}
pub use payment_failed as PAYMENT_FAILED;

/// What a bank writes, once, to whoever has a standing order paying into the account of someone it has been told has
/// died (docs/behaviour/deaths.md): how an employer, on no register, comes to know.
pub mod payee_died {
    pub fn note(holder: &str, to: &str, request: &str) -> String {
        format!("Your payments to {to} (request {request}): the account's holder, {holder}, has died. They go to the estate until you stop them.")
    }
    /// Who has died, if a letter is this note.
    pub fn who(text: &str) -> Option<&str> {
        let rest = text.strip_prefix("Your payments to ")?;
        let (to, rest) = rest.split_once(" (request ")?;
        let (request, rest) = rest.split_once("): the account's holder, ")?;
        let (holder, _) = rest.split_once(", has died.")?;
        (!to.contains(' ') && !request.contains(' ') && !holder.contains(' ') && !holder.is_empty()).then_some(holder)
    }
}
pub use payee_died as PAYEE_DIED;

/// A letter that is another office's notice, report or acknowledgement, in the fixed words offices write: never
/// answered. A person's letter is anything else (common.ts `officeNote`).
pub fn office_note(t: &str) -> bool {
    let from_your = t.strip_prefix("From ").and_then(|r| r.split_once(": your ")).is_some_and(|(who, _)| (1..=80).contains(&who.chars().count()) && !who.contains(':'));
    t.starts_with("Report from ")
        || from_your
        || t.starts_with("Payroll notice from the hiring office, ")
        || payment_failed::is(t).is_some()
        || payee_died::who(t).is_some()
        || (t.starts_with("Request ") && t.split_once(' ').is_some_and(|(_, r)| r.split_once(' ').is_some_and(|(id, rest)| !id.is_empty() && rest.starts_with("not carried out: "))))
        || (t.starts_with("Payment of ") && t.contains(" couldn't be made: "))
        || hold_or_withdrawal_note(t)
}

fn hold_or_withdrawal_note(t: &str) -> bool {
    let after_id = |prefix: &str| t.strip_prefix(prefix).and_then(|r| r.split_once(' ')).map(|(_, rest)| rest);
    after_id("Hold ").is_some_and(|r| r.starts_with("is in place") || r.starts_with("does not apply") || r.starts_with("is not in place"))
        || after_id("Withdrawal ").is_some_and(|r| r.starts_with("is not acted on") || r.starts_with("does not apply"))
}

/// What an office with a standing report says after it.
pub const REPORT_TAIL: &str = "That is this office's standing report, sent in answer to any letter: it does not act on a letter's words.";

/// What an office acts on and how, in its own fixed words; and, where the letter plainly concerns something it has a
/// form or a set way for (one of the words in `about`, in any case), what it says of that.
pub fn what_it_acts_on(a: &Answers, letter: &str) -> String {
    let said = letter.to_lowercase();
    let mut out = vec![a.acts.clone()];
    for f in &a.forms {
        if f.about.iter().any(|w| said.contains(w.as_str())) {
            out.push(f.say.clone());
        }
    }
    out.join(" ")
}

/// The acknowledgement an office with no report of its own sends.
pub fn acknowledged(a: &Answers, letter: &str) -> String {
    format!("From {}: your letter is received. This office does not act on a letter's words. {}", a.office, what_it_acts_on(a, letter))
}

/// Letters in, each answered once with the office's report (common.ts `Letters`). Saved with the actor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Letters {
    pending: Vec<Letter>,
}

impl Letters {
    /// Letters in: all but our own, office notes, and news of a request of ours from those we asked to carry it out
    /// (a bank saying a payment we asked for was not made), which is not a question.
    pub fn take(&mut self, pic: &Picture, book: &Book) {
        for m in &pic.inbox {
            if m.from != pic.participant && !office_note(&m.text) && !news_of_our_request(m, pic, book) {
                self.pending.push(Letter {
                    id: m.id.clone(),
                    from: m.from.clone(),
                    position: m.from_position.clone(),
                    entity: m.from_entity.clone(),
                    text: m.text.clone(),
                });
            }
        }
    }
    /// Each letter answered with the report (which may depend on who wrote), with the office's tail where it has
    /// `answers`.
    pub fn answer<T>(&mut self, answers: Option<&Answers>, why: &str, report: impl Fn(&Letter) -> String) -> Vec<Step<T>> {
        std::mem::take(&mut self.pending)
            .into_iter()
            .map(|m| {
                let mut words = report(&m);
                if let Some(a) = answers {
                    words = format!("{words} {REPORT_TAIL} {}", what_it_acts_on(a, &m.text));
                }
                because(why, vec![message(std::slice::from_ref(&m.from), &words, Some(&m.id))])
            })
            .collect()
    }
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
    /// The letters in, taken whole (an office whose report needs its own state to write, and so cannot be a `Fn` handed to
    /// `answer`: the bank's statements record where each ledger stood). Added by lane D.
    pub fn drain(&mut self) -> Vec<Letter> {
        std::mem::take(&mut self.pending)
    }
}

fn news_of_our_request(m: &Message, pic: &Picture, book: &Book) -> bool {
    let Some(r) = m.re.as_ref().and_then(|re| book.get(re)) else { return false };
    if !is_kind(r, "request") || r.speaks_for.as_deref() != Some(pic.entity.as_str()) {
        return false;
    }
    let sender = m.from_entity.clone().or_else(|| match &m.from_position {
        Some(p) => book.position(p).map(|x| x.entity.clone()),
        None => book.person_of(&m.from).map(String::from),
    });
    sender.is_some_and(|s| addressed_to(r).contains(&s))
}

/// An office that acknowledges its letters (docs/behaviour/letters.md; common.ts `answering`): one that says how it
/// answers and has no standing report of its own. Each letter not another office's note is acknowledged once, when the
/// office has done its own work for the wake (its step answered `Wait`): the acknowledgements go first, at most 16 in
/// one act, and the wait the actor answered is given at its next step. The actor never sees that its letters were
/// answered. Wrap an actor in it from `Kind::create` where the module's `answers` has no `report`.
pub struct Answering<A> {
    pub inner: A,
    answers: Answers,
    letters: Vec<(String, String, String)>,
    then: Option<oikos_sight::Action>,
}

impl<A: crate::Actor> Answering<A> {
    pub fn new(inner: A, answers: Answers) -> Self {
        Answering { inner, answers, letters: vec![], then: None }
    }
    /// As `save` left it.
    pub fn restore(inner: A, answers: Answers, saved: &serde_json::Value) -> Result<Self, String> {
        let letters = serde_json::from_value(saved.get("letters").cloned().unwrap_or_default()).map_err(|e| e.to_string())?;
        let then = match saved.get("then") {
            Some(v) if !v.is_null() => Some(oikos_sight::Action::from_json(v)?),
            _ => None,
        };
        Ok(Answering { inner, answers, letters, then })
    }
}

impl<A: crate::Actor> crate::Actor for Answering<A> {
    fn step(&mut self, pic: &Picture, cx: &mut crate::Cx) -> oikos_sight::Action {
        if let Some(w) = self.then.take() {
            return w;
        }
        for l in &pic.inbox {
            if l.from != pic.participant && !office_note(&l.text) {
                self.letters.push((l.id.clone(), l.from.clone(), l.text.clone()));
            }
        }
        let act = self.inner.step(pic, cx);
        if self.letters.is_empty() || !matches!(act, oikos_sight::Action::Wait { .. }) {
            return act;
        }
        self.then = Some(act);
        let n = self.letters.len().min(16);
        let calls = self.letters.drain(..n).map(|(id, from, t)| message(&[from], &acknowledged(&self.answers, &t), Some(&id))).collect();
        let s: Step<()> = because(format!("Letters to {}: acknowledging each, and saying what the office acts on.", self.answers.office), calls);
        oikos_sight::Action::Call { program: s.program(), reasoning: s.why }
    }
    fn beliefs(&self) -> Vec<crate::Belief> {
        self.inner.beliefs()
    }
    fn sent(&mut self, action: &str) {
        self.inner.sent(action)
    }
    fn save(&self) -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({
            "inner": self.inner.save()?,
            "letters": self.letters,
            "then": self.then.as_ref().map(oikos_sight::Action::to_json),
        }))
    }
}
