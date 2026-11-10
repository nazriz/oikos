//! A body's intake of the papers it receives, where it publishes what it requires (docs/design/obstacles.md, O1 and O4;
//! the rule is `oikos_rules::acceptance`). Its clerk reads each paper against the body's own published requirements: a
//! paper sent for a person from someone else's post needs that person's authority on file with the body; a paper must
//! give what the body's form asks for; and the clerk may wrongly send back a paper that is in order, at the world's rate
//! for the check (its row in the table of slips, `accept/<kind>`), never twice on the same paper. What falls short goes
//! back to whoever sent it and to whom it is for, saying in the body's own words what is missing and how to put it
//! right (`paper_returned`), and the body logs the obstacle for measures (a `decision`, domain `obstacle`).
//!
//! A body with no requirements takes every paper as before: nothing is published, read, drawn or logged.

use super::{data, Book};
use super::Fields;
use crate::steps::{say, Say, Visible};
use crate::Cx;
use oikos_rules::acceptance::{authorised, missing, Authority, Requirements};
use oikos_rules::slip::{slip, SlipOptions};
use oikos_sight::calls::Call;
use oikos_sight::Record;
use serde_json::json;

/// What a body keeps of its intake: whether it has published its requirements, and the authorities its clerk has in
/// hand to record (each recorded once).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Intake {
    #[serde(default)]
    pub published: bool,
    #[serde(default, skip_serializing_if = "std::collections::BTreeSet::is_empty")]
    pub recording: std::collections::BTreeSet<String>,
    /// Papers its clerk has read and taken, not yet decided: read once (a paper that waits on the body's file is not
    /// read again at every round, nor drawn for again).
    #[serde(default, skip_serializing_if = "std::collections::BTreeSet::is_empty")]
    pub taken: std::collections::BTreeSet<String>,
}

impl Intake {
    pub fn is_default(&self) -> bool {
        *self == Intake::default()
    }

    /// Its routine at each wake, where it has requirements: its notice, once (unless one of its own is on file); and a
    /// record for each authority given it, once each. Each with why, in words.
    pub fn routine(&mut self, book: &Book, me: &str, req: &Requirements) -> Vec<(String, Call)> {
        let mut out = vec![];
        if req.is_empty() {
            return out;
        }
        if !self.published {
            self.published = true;
            if !book.open(NOTICE).any(|r| r.speaks_for.as_deref() == Some(me)) {
                out.push(("Saying what we need on the papers sent to us.".to_string(), notice(me, req)));
            }
        }
        let recorded: std::collections::BTreeSet<String> = book.open(RECORDED).filter_map(|r| data(r).s("authority").map(String::from)).collect();
        self.recording.retain(|a| !recorded.contains(a));
        for a in to_record(book, me, &self.recording) {
            self.recording.insert(a.id.to_string());
            out.push((format!("Recording the authority {}.", a.id), record(a, me)));
        }
        out
    }
}

impl Intake {
    /// A paper that may wait on the body's file before it is decided, read by its clerk once (`check`); `None` when it is
    /// taken, now or before. `done` when it is decided.
    pub fn take(&mut self, book: &Book, me: &str, req: &Requirements, r: &Record, cx: &mut Cx) -> Option<(String, Call)> {
        if req.is_empty() || self.taken.contains(r.id.as_str()) {
            return None;
        }
        let back = check(book, me, req, r, cx);
        if back.is_none() {
            self.taken.insert(r.id.to_string());
        }
        back
    }

    pub fn done(&mut self, id: &str) {
        self.taken.remove(id);
    }
}

/// The notice in which a body publishes what it requires.
pub const NOTICE: &str = "requirements";
/// A paper sent back.
pub const RETURNED: &str = "paper_returned";
/// A person's authority for someone to act for them with a body.
pub const AUTHORITY: &str = "authority";
/// The body's record that it has an authority on file.
pub const RECORDED: &str = "authority_recorded";

/// The notice a body publishes once, saying what it requires (in words, and as data, `requires`).
pub fn notice(me: &str, req: &Requirements) -> Call {
    let mut said: Vec<String> = req
        .items
        .iter()
        .map(|(k, items)| format!("A {} must give {}.", k.replace('_', " "), items.iter().map(|i| i.says.as_str()).collect::<Vec<_>>().join(", ")))
        .collect();
    if !req.authority.is_empty() {
        said.push(format!(
            "We act on a {} sent for someone else only once they have given us their authority for whoever sends it: they write to us naming the post that may act for them, and the papers it covers, and we record it.",
            req.authority.iter().map(|k| k.replace('_', " ")).collect::<Vec<_>>().join(" or ")
        ));
    }
    say(NOTICE, &format!("What {me} needs on the papers sent to it. {}", said.join(" ")), Say { visible: Some(Visible::Public), data: Some(json!({ "requires": req })), ..Default::default() })
}

/// The authorities a body has recorded: each `authority` paper addressed to it that a record of its own cites.
pub fn on_file(book: &Book, me: &str) -> Vec<Authority> {
    let recorded: std::collections::BTreeSet<String> = book.open(RECORDED).filter(|r| r.speaks_for.as_deref() == Some(me) || r.author.as_str() == me).filter_map(|r| data(r).s("authority").map(String::from)).collect();
    book.open(AUTHORITY)
        .filter(|r| recorded.contains(r.id.as_str()))
        .filter_map(|r| {
            let d = data(r).to_value();
            let list = |k: &str| d[k].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>();
            Some(Authority { by: r.speaks_for.as_deref()?.to_string(), posts: list("posts"), kinds: list("kinds") })
        })
        .collect()
}

/// The authorities addressed to a body that it has not yet recorded, oldest first: each is recorded by an act of its
/// clerk's (`publish/authority_recorded`), which takes the clerk's time like any work.
pub fn to_record<'a>(book: &'a Book, me: &str, asked: &std::collections::BTreeSet<String>) -> Vec<&'a std::sync::Arc<Record>> {
    let recorded: std::collections::BTreeSet<String> = book.open(RECORDED).filter_map(|r| data(r).s("authority").map(String::from)).collect();
    book.open(AUTHORITY).filter(|r| super::addressed_to(r).iter().any(|a| a.as_str() == me) && !recorded.contains(r.id.as_str()) && !asked.contains(r.id.as_str())).collect()
}

/// The clerk's record of an authority, to whoever gave it and to the posts it names (an agent is told it may act).
pub fn record(a: &Record, me: &str) -> Call {
    let by = a.speaks_for.as_deref().unwrap_or(a.author.as_str()).to_string();
    let mut to = vec![by];
    to.extend(data(a).get("posts").map(|p| p.to_value()).and_then(|p| p.as_array().cloned()).into_iter().flatten().filter_map(|x| x.as_str().map(String::from)));
    let mut vis = to.clone();
    vis.push(me.to_string());
    say(RECORDED, &format!("Your authority {} is recorded: we act on what it covers.", a.id), Say { to: Some(to), visible: Some(Visible::Only(vis)), basis: Some(a.id.to_string()), data: Some(json!({ "authority": a.id })), ..Default::default() })
}

/// What a body's clerk does with a paper it received: `None`, it is in order and the body acts on it; or the paper that
/// sends it back, with why in words. The obstacle is logged here.
pub fn check(book: &Book, me: &str, req: &Requirements, r: &Record, cx: &mut Cx) -> Option<(String, Call)> {
    // (A paper on file when the world began is the world's opening state, decided or in hand already: not a paper arriving.)
    if req.is_empty() || r.author.as_str() == oikos_contracts::blocks::GENESIS {
        return None;
    }
    let kind = super::kind(r).unwrap_or_default();
    let for_ = r.speaks_for.as_deref().unwrap_or(r.author.as_str()).to_string();
    let post = r.position.as_deref();
    let own = post.is_none() || book.author_entity(r) == Some(for_.as_str()) || book.entity_kind(&for_).is_some_and(|k| k != "person");
    let mut need = json!({});
    let mut said = String::new();
    let mut slipped = false;
    if !authorised(req, &kind, &for_, post, own, &on_file(book, me)) {
        need = json!({ "authority": { "for": for_, "with": me, "kinds": [kind] } });
        said = format!(
            "We cannot act on {} for {for_}: we have no authority from them for {}. They can give us one by writing to us, naming {} and the papers it covers; once we have recorded it, send it again.",
            r.id,
            post.unwrap_or("you"),
            post.unwrap_or("you")
        );
    } else {
        let lacks: Vec<_> = missing(req, &kind, &data(r).to_value()).into_iter().cloned().collect();
        // (Sent again: it cites a paper we sent back, or the paper we returned, which a copy sent again cites.)
        let again = super::bases_of(r).iter().any(|b| book.get(b.as_str()).is_some_and(|x| super::kind(x).as_deref() == Some(RETURNED)) || book.open(RETURNED).any(|x| data(x).s("returned") == Some(b.as_str())));
        if !lacks.is_empty() {
            need = json!({ "correction": lacks.iter().map(|i| i.field.clone()).collect::<Vec<_>>() });
            said = format!("{} is returned: it does not give {}. Send it again with that.", r.id, lacks.iter().map(|i| i.says.as_str()).collect::<Vec<_>>().join(", "));
        } else if !again && slip(cx, &format!("accept/{kind}"), &r.id, &SlipOptions::default()) {
            // (A clerk's wrong return: the paper is in order, and is taken when it is sent again.)
            slipped = true;
            need = json!({ "correction": [] });
            said = format!("{} is returned: we could not match it to our records. Send it again.", r.id);
        }
    }
    if said.is_empty() {
        return None;
    }
    cx.decided(json!({ "domain": "obstacle", "law": if need.get("authority").is_some() { "authority" } else { "acceptance" }, "paper": r.id, "principal": for_,
        "counterparty": me, "need": need, "clears_by": if need.get("authority").is_some() { "authority" } else { "sent_again" }, "slip": slipped, "inputs": [r.id] }));
    // (To whoever it is for, and to the post that sent it for them, where one did.)
    let mut to: Vec<String> = post.map(String::from).into_iter().collect();
    if !to.contains(&for_) {
        to.push(for_.clone());
    }
    let mut vis = to.clone();
    vis.push(me.to_string());
    // (The paper as it was, to be sent again as it stands, citing it: a form sends it so, `copies`.)
    let copy = json!({ "kind": kind, "to": super::addressed_to(r), "text": super::text(r), "data": data(r).to_value(), "basis": [r.id] });
    let call = say(RETURNED, &said, Say { to: Some(to), visible: Some(Visible::Only(vis)), basis: Some(r.id.to_string()), data: Some(json!({ "returned": r.id, "need": need, "paper": copy })), ..Default::default() });
    Some((said, call))
}
