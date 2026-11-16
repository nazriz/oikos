//! A person's post (docs/behaviour/citizen.md, "Getting to the post"; stakes D1a and D1b, docs/design/stakes.md): what
//! others send a person (a paper addressed to them, a letter) is in their post until they next sit down to it, by a habit
//! of their own, and only then does their code read it. What they do about it is their own act then, timed by the table
//! of work as ever. The delay is when the person does the work, never a dial: nothing is refused or held but by the
//! person not having sat down to it yet, and they are woken at their sitting.
//!
//! One wrapper, round every person's own code (and so round a principal's: a client deals with its assistant's papers
//! as with any other post). A town whose profile gives no habit (`paperwork`) is as before, to the hash.
//!
//! **Too ill for it (stakes D2):** a person with a condition of a severity that keeps them off work (the health model's,
//! `care.off_work`, at the profile's own rates) is too ill to deal with their post until it ends, as it keeps them from
//! work: a sitting that falls while it lasts is skipped, and what waits is read at their first sitting after it. They
//! are at home, ill; nobody is told (what they say of it to their assistant is their own: principal.rs, `away`).

use crate::common::addressed_to;
use crate::{Action, Actor, Ctx, Cx, Picture, DAY};
use oikos_sight::{Message, Record, RecordBody, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::sync::Arc;

/// How people get to their post (the profile's `paperwork`, placeholders until sourced: MT-37): how many days apart a
/// person sits down to it, with the share of persons of each (`[days, bps]`, the shares summing to 10,000), and the hours
/// of the day they do it in (`from_hour` to `to_hour`, their own free hours outside work). Each person's is drawn once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Paperwork {
    pub every_days: Vec<(i64, i64)>,
    pub from_hour: i64,
    pub to_hour: i64,
}

/// A person's habit as drawn: every so many days, from which day, at which second of the day.
pub type Sits = (i64, i64, i64);

/// The person's habit, drawn once from the world's seeded draws (`paperwork-<person>`: how many days apart, which day of
/// those, a minute in the window).
pub fn draw(pw: &Paperwork, me: &str, cx: &mut Cx) -> Sits {
    let mut r = cx.chance(&format!("paperwork-{me}"));
    let total: i64 = pw.every_days.iter().map(|(_, b)| (*b).max(0)).sum();
    let mut q = r.below(total.max(1) as u64) as i64;
    let every = pw.every_days.iter().find(|(_, b)| {
        q -= (*b).max(0);
        q < 0
    });
    let every = every.map_or(1, |(d, _)| (*d).max(1));
    let phase = r.below(every as u64) as i64;
    let span = ((pw.to_hour - pw.from_hour).max(1) * 3_600) as u64;
    let at = pw.from_hour * 3_600 + (r.below(span / 60) as i64) * 60;
    (every, phase, at)
}

/// When what comes to a person by post at `t` is dealt with: the next time at or after `t` that they sit down to it.
pub fn answer_lag(sits: Sits, t: i64) -> i64 {
    let (every, phase, at) = sits;
    let mut d = t.div_euclid(DAY);
    loop {
        if (d - phase).rem_euclid(every) == 0 && d * DAY + at >= t {
            return d * DAY + at;
        }
        d += 1;
    }
}

/// Whether a record came to `me` by post: a paper addressed to them by someone else.
pub fn by_post(me: &str, r: &Record) -> bool {
    matches!(r.body, RecordBody::Statement { .. }) && r.speaks_for.as_deref() != Some(me) && addressed_to(r).iter().any(|a| *a == me)
}

/// Whether a letter came to `me` from someone else.
fn letter_for(me: &str, m: &Message) -> bool {
    m.from_entity.as_deref().unwrap_or(m.from.as_str()) != me
}

/// The time of the sitting at which what came at `at` is read: the first at or after it that does not fall in one of
/// `ill` (each span `[since, until)` of a condition too serious to deal with post).
pub fn sitting_for(sits: Sits, ill: &[(String, i64, i64)], at: i64) -> i64 {
    let mut s = answer_lag(sits, at);
    while let Some((_, _, until)) = ill.iter().find(|(_, since, until)| *since <= s && s < *until) {
        s = answer_lag(sits, *until);
    }
    s
}

/// A post's in-tray (the broad seats' stage 1b; risk WM-20): the habit of the person who holds a post of getting to what
/// certain posts of its own organisation send it (its assistant's drafts, requests and reports), with the posts named.
/// Only those papers and letters wait; the post's other business reaches its code as before.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InTray {
    pub every_days: Vec<(i64, i64)>,
    pub from_hour: i64,
    pub to_hour: i64,
    /// The posts whose papers wait in it.
    pub from: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct State {
    me: String,
    p: Paperwork,
    /// A post's in-tray: the posts whose papers and letters wait for its holder's sitting (empty: a person's own post,
    /// where everything that comes by post waits).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    from: Vec<String>,
    /// The severities too serious to deal with post (the citizen's `care.off_work`), and the spans of such conditions
    /// it has had while something waited (condition, since, until).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    off_work: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    ill: Vec<(String, i64, i64)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sits: Option<Sits>,
    /// Papers that came by a channel that shows only what is new, before the person sat down to them: by channel.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    held: Vec<(String, Record)>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    letters: Vec<Message>,
}

pub struct Posted {
    inner: Box<dyn Actor>,
    s: State,
}

/// Whether `ctx` is a person's own code with a habit given, or a post with an in-tray given: the habit, who it is (the
/// person, or the post), and the posts whose papers wait (none for a person: all its post waits).
fn habit(ctx: &Ctx) -> Option<(Paperwork, String, Vec<String>)> {
    if let Some(pos) = ctx.position.as_ref() {
        let t: InTray = ctx.params.get("in_tray").and_then(|v| serde_json::from_value(v.to_value()).ok())?;
        if t.from.is_empty() {
            return None;
        }
        return Some((Paperwork { every_days: t.every_days, from_hour: t.from_hour, to_hour: t.to_hour }, pos.to_string(), t.from));
    }
    let p = ctx.params.get("paperwork").and_then(|v| serde_json::from_value(v.to_value()).ok())?;
    Some((p, ctx.entity.clone(), vec![]))
}

/// The actor made for `ctx`, wrapped where it is a person's own code and the world gives a habit, or a post whose
/// parameters give it an in-tray.
pub fn wrap(ctx: &Ctx, inner: Box<dyn Actor>) -> Box<dyn Actor> {
    match habit(ctx) {
        Some((p, me, from)) => {
            let off_work = if from.is_empty() { ctx.params.get("care").and_then(|c| c.to_value().get("off_work").and_then(|o| serde_json::from_value(o.clone()).ok())).unwrap_or_default() } else { vec![] };
            Box::new(Posted { inner, s: State { me, p, from, off_work, ill: vec![], sits: None, held: vec![], letters: vec![] } })
        }
        None => inner,
    }
}

/// The same, as `save` left it: `inner` is restored by the caller from `saved["inner"]`.
pub fn rewrap(ctx: &Ctx, saved: &Value, restore_inner: impl FnOnce(Value) -> Result<Box<dyn Actor>, String>) -> Result<Box<dyn Actor>, String> {
    match habit(ctx) {
        Some(_) => {
            let inner = restore_inner(saved.get("inner").cloned().unwrap_or(Value::Null))?;
            let s: State = serde_json::from_value(saved.get("post").cloned().unwrap_or(Value::Null)).map_err(|e| format!("post: {e}"))?;
            Ok(Box::new(Posted { inner, s }))
        }
        None => restore_inner(saved.clone()),
    }
}

impl Posted {
    /// The picture its code reads: what came by post since its last sitting kept back, and what it held, given now
    /// that it has sat down to it. And when it next sits down to what is still in its post, if anything is.
    fn shown(&mut self, pic: &Picture, cx: &mut Cx) -> (Option<Picture>, Option<i64>) {
        let me = self.s.me.clone();
        let t = pic.t;
        // (A person's post: whatever comes to them from someone else. A post's in-tray: what the posts named send it.)
        let from = self.s.from.clone();
        let by_post = |me: &str, r: &Record| if from.is_empty() { by_post(me, r) } else { matches!(r.body, RecordBody::Statement { .. }) && r.position.as_ref().is_some_and(|p| from.iter().any(|f| f.as_str() == p.as_str())) };
        let letter_for = |me: &str, m: &Message| if from.is_empty() { letter_for(me, m) } else { m.from_position.as_ref().is_some_and(|p| from.iter().any(|f| f.as_str() == p.as_str())) };
        let new_post = pic.channels.values().any(|c| matches!(c, Seen::Records { records, search: false } if records.iter().any(|r| by_post(&me, r))))
            || pic.inbox.iter().any(|m| letter_for(&me, m));
        if !new_post && self.s.held.is_empty() && self.s.letters.is_empty() {
            return (None, None);
        }
        let sits = *self.s.sits.get_or_insert_with(|| draw(&self.s.p, &me, cx));
        // (Too ill for it: the spans of the conditions it has now, as its body shows them, kept while anything waits.)
        if let Some(b) = pic.body.as_ref() {
            for c in b.conditions.iter().filter(|c| self.s.off_work.contains(&c.severity)) {
                self.s.ill.retain(|(id, _, _)| id.as_str() != c.id.as_str());
                self.s.ill.push((c.id.to_string(), c.since, c.until));
            }
        }
        let ill = self.s.ill.clone();
        let read = |at: i64| sitting_for(sits, &ill, at) <= t;
        let mut shown = pic.clone();
        let mut shown_ids: BTreeSet<String> = BTreeSet::new();
        for (ch, seen) in shown.channels.iter_mut() {
            let Seen::Records { records, search: false } = seen else { continue };
            let mut keep = Vec::with_capacity(records.len());
            for r in records.drain(..) {
                if by_post(&me, &r) && !read(r.at) {
                    // (A channel kept whole shows it again: held only where it shows what is new, once.)
                    if !self.s.held.iter().any(|(_, h)| h.id == r.id) {
                        self.s.held.push((ch.to_string(), (*r).clone()));
                    }
                } else {
                    shown_ids.insert(r.id.to_string());
                    keep.push(r);
                }
            }
            *records = keep;
        }
        // (What it held and has now sat down to, back in the channel it came by, in the order it came.)
        let (now, still): (Vec<_>, Vec<_>) = std::mem::take(&mut self.s.held).into_iter().partition(|(_, r)| read(r.at));
        self.s.held = still;
        let mut released = false;
        for (ch, r) in now {
            if shown_ids.contains(r.id.as_str()) {
                continue;
            }
            let entry = shown.channels.entry(ch.as_str().into()).or_insert_with(|| Seen::Records { records: vec![], search: false });
            if let Seen::Records { records, .. } = entry {
                records.push(Arc::new(r));
                released = true;
            }
        }
        let (mut back, kept): (Vec<Message>, Vec<Message>) = std::mem::take(&mut self.s.letters).into_iter().partition(|m| read(m.t));
        released |= !back.is_empty();
        let (mut now, still): (Vec<Message>, Vec<Message>) = std::mem::take(&mut shown.inbox).into_iter().filter(|m| letter_for(&me, m)).partition(|m| read(m.t));
        self.s.letters = kept.into_iter().chain(still).collect();
        let mut inbox: Vec<Message> = pic.inbox.iter().filter(|m| !letter_for(&me, m)).cloned().collect();
        inbox.append(&mut back);
        inbox.append(&mut now);
        shown.inbox = inbox;
        // (Its post sat down to is news to it, as a letter coming is: its code reads what came, whatever woke it.)
        if released {
            shown.woke_for = "news".into();
        }
        let due = self.s.held.iter().map(|(_, r)| r.at).chain(self.s.letters.iter().map(|m| m.t)).map(|at| sitting_for(sits, &ill, at)).min();
        // (Nothing waiting: the spans are let go.)
        if due.is_none() {
            self.s.ill.clear();
        }
        (Some(shown), due)
    }
}

impl Actor for Posted {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        let (shown, due) = self.shown(pic, cx);
        let a = self.inner.step(shown.as_ref().unwrap_or(pic), cx);
        match (a, due) {
            // (Papers waiting in its post: it wakes when it sits down to them, if nothing wakes it before.)
            (Action::Wait { until }, Some(d)) => Action::Wait { until: Some(until.map_or(d, |u| u.min(d))) },
            (a, _) => a,
        }
    }

    fn sent(&mut self, action: &str) {
        self.inner.sent(action);
    }

    fn beliefs(&self) -> Vec<crate::Belief> {
        self.inner.beliefs()
    }

    fn save(&self) -> Result<Value, String> {
        Ok(json!({ "inner": self.inner.save()?, "post": serde_json::to_value(&self.s).map_err(|e| e.to_string())? }))
    }

    fn kept(&self) -> Option<std::collections::BTreeMap<String, u64>> {
        self.inner.kept()
    }
}
