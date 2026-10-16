//! When each unit wakes (docs/design/rebuild.md section 6): the engine's side of the loop. A unit is one participant's
//! capacity run by a code module (`<participant>|<capacity>`), or a language-model participant (`<participant>`). The
//! host (the participant host, orchestrator/src/run.ts) runs the units; this decides when: who wakes at a moment and in
//! what order, why and how long since their last wake, who news wakes, and when a unit busy with an act goes on.
//!
//! The rules (the same for every host):
//! - **The next wake:** the unit's cadence after each wake, unless it asks for a time (rounded up to a tick, and never
//!   sooner than a tick on), or it began an act (then when the act is done).
//! - **Order:** everyone due at a moment wakes together, in key order; a wake set in the past is due now.
//! - **News:** a message wakes everyone it's delivered to; a record naming an entity wakes the code units acting for
//!   it (a person's own unit; the units holding an organisation's positions), never its author, and never a
//!   language-model participant (it reads what's come in on its own cadence, and letters wake it). A unit busy with an
//!   act isn't woken: it sees the news when its act is done. A change in one's own body (a condition begun, ended or
//!   treated) wakes that person's own code unit; so does a death in the space they are in (they are there, and know it).
//! - **Guards:** at most three news wakes a unit a tick (then the next tick); more than `MAX_COHORTS_PER_MOMENT`
//!   cohorts at one moment stops the run.

use crate::events::{Event, EventBody, VacateReason};
use crate::state::State;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// More cohorts than this at one moment means units are waking each other without end.
pub const MAX_COHORTS_PER_MOMENT: u32 = 1000;

#[derive(Debug, Clone)]
struct Unit {
    participant: String,
    /// "self", a position, or None (a language-model participant: all its capacities).
    capacity: Option<String>,
    llm: bool,
    /// A unit that hears no news: it is woken by its cadence and what it asks for, never by a record or a message (foundations F6: a payroll's round is its own).
    deaf: bool,
    /// A language-model unit that is woken by papers and answers as a code unit of the same post is (foundations F9, twins: a seat that sits
    /// as its code twin does, with no office hours of its own; only a mock's, where the brain is the code).
    hears: bool,
    /// The participant whose body it sits in, where that is not its own (a seat's person): what is delivered to the person reaches the seat's unit
    /// as it reaches the person's own unit for the same post. Only a `hears` unit has one.
    body: Option<String>,
    /// Where it stands among those that wake together: its key by default; a seat stands where the person it acts through would (the
    /// order of a moment's wakes, and so of the acts of one moment, does not turn on whether a post is held by a seat or by code).
    sort: String,
    cadence: i64,
    next_wake: i64,
    wake_for: &'static str,
    woke_for: &'static str,
    last_wake: Option<i64>,
    since: i64,
    news_tick: i64,
    news_wakes: u32,
    done_at: Option<i64>,
}

/// A perturbation for invariance tests (docs/design/rebuild.md 6.6, 8.1), never for research runs: each wake, with
/// this chance, the unit's next wake comes early (somewhere before its cadence, on a tick), as if something woke it.
/// Nothing a module computes per period should move when it's woken more often.
#[derive(Debug, Clone, Copy, Default)]
pub struct Perturb {
    pub extra_wakes_bps: u32,
    pub seed: u64,
}

#[derive(Debug, Default)]
pub struct Scheduler {
    tick: i64,
    perturb: Option<Perturb>,
    units: BTreeMap<String, Unit>,
    /// participant -> the keys of its units, in key order (kept with `units`): who news reaches is found without
    /// going through every unit.
    by_participant: BTreeMap<String, BTreeSet<String>>,
    /// (next wake, sort key, key): the queue.
    queue: BTreeSet<(i64, String, String)>,
    moment_at: i64,
    cohorts_now: u32,
}

/// What an event means for wakes, as `Scheduler::note` reads it.
enum News<'a> {
    /// An act begun: who, in what capacity, and when it's done.
    Started { participant: &'a str, capacity: Option<&'a str>, done: i64 },
    /// A message, to these participants.
    Delivered(Vec<&'a str>),
    /// Something happened to this person's own body.
    Body(&'a str),
    /// A keeper has answered a question put in this capacity of this participant (foundations F11).
    Answered { participant: &'a str, capacity: &'a str },
    /// A record made (its JSON).
    Recorded(&'a Value),
}

/// What the host should do next.
pub enum Next {
    /// Nothing more is due by `until`.
    End,
    /// Time must move on to `to` first (the host's reply then carries the advance's events).
    Advance { to: i64 },
    /// These units wake now, in key order: (key, why, seconds since their last wake).
    Cohort(Vec<(String, &'static str, i64)>),
}

impl Scheduler {
    pub fn new(tick: i64) -> Self {
        Self { tick, moment_at: -1, ..Default::default() }
    }

    pub fn perturb(&mut self, p: Perturb) {
        self.perturb = (p.extra_wakes_bps > 0).then_some(p);
    }

    /// A deterministic draw in [0, n) for a unit at a time (splitmix64 over the seed, the key and the time).
    fn draw(seed: u64, key: &str, t: i64, n: u64) -> u64 {
        let mut x = seed ^ (t as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        for b in key.bytes() {
            x = (x ^ b as u64).wrapping_mul(0x0100_0000_01B3);
        }
        x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = x;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        (z ^ (z >> 31)) % n.max(1)
    }

    fn ceil(&self, t: i64) -> i64 {
        t.div_euclid(self.tick) * self.tick + if t.rem_euclid(self.tick) == 0 { 0 } else { self.tick }
    }

    fn set_wake(&mut self, key: &str, at: i64, why: &'static str) {
        if let Some(u) = self.units.get_mut(key) {
            self.queue.remove(&(u.next_wake, u.sort.clone(), key.to_string()));
            u.next_wake = at;
            u.wake_for = why;
            self.queue.insert((at, u.sort.clone(), key.to_string()));
        }
    }

    /// Units the host runs, each with its cadence and first wake (a unit already there is replaced).
    pub fn add(&mut self, units: &[Value]) -> Result<(), String> {
        for u in units {
            let key = u["key"].as_str().ok_or("a unit needs a key")?.to_string();
            let next_wake = u["next_wake"].as_i64().ok_or("a unit needs next_wake")?;
            let unit = Unit {
                participant: u["participant"].as_str().ok_or("a unit needs a participant")?.to_string(),
                capacity: u["capacity"].as_str().map(String::from),
                llm: u["llm"].as_bool().unwrap_or(false),
                deaf: u["deaf"].as_bool().unwrap_or(false),
                hears: u["hears"].as_bool().unwrap_or(false),
                body: u["body"].as_str().map(String::from),
                sort: u["sort"].as_str().unwrap_or(&key).to_string(),
                cadence: u["cadence"].as_i64().filter(|c| *c > 0).ok_or("a unit needs a cadence (seconds)")?,
                next_wake,
                wake_for: "start",
                woke_for: "start",
                last_wake: None,
                since: 0,
                news_tick: -1,
                news_wakes: 0,
                done_at: None,
            };
            let names: Vec<String> = [Some(unit.participant.clone()), unit.body.clone()].into_iter().flatten().collect();
            if let Some(old) = self.units.insert(key.clone(), unit) {
                self.queue.remove(&(old.next_wake, old.sort.clone(), key.clone()));
                self.forget_all(&old, &key);
            }
            for n in names {
                self.by_participant.entry(n).or_default().insert(key.clone());
            }
            let sort = self.units[&key].sort.clone();
            self.queue.insert((next_wake, sort, key));
        }
        Ok(())
    }

    pub fn remove(&mut self, keys: &[String]) {
        for k in keys {
            if let Some(u) = self.units.remove(k) {
                self.queue.remove(&(u.next_wake, u.sort.clone(), k.clone()));
                self.forget_all(&u, k);
            }
        }
    }

    /// A unit is no longer anyone's.
    fn forget_all(&mut self, u: &Unit, key: &str) {
        self.forget(&u.participant, key);
        if let Some(b) = &u.body {
            self.forget(b, key);
        }
    }

    /// A unit is no longer its participant's.
    fn forget(&mut self, participant: &str, key: &str) {
        if let Some(keys) = self.by_participant.get_mut(participant) {
            keys.remove(key);
            if keys.is_empty() {
                self.by_participant.remove(participant);
            }
        }
    }

    /// A participant's units, in key order.
    fn units_of<'a>(&'a self, participant: &str) -> impl Iterator<Item = (&'a String, &'a Unit)> + 'a {
        self.by_participant.get(participant).into_iter().flatten().filter_map(|k| self.units.get(k).map(|u| (k, u)))
    }

    /// Every unit of a participant back to its cadence from now (a stand-in taking over, a participant carried on).
    pub fn to_cadence(&mut self, participant: &str, t: i64) {
        let keys: Vec<(String, i64)> = self.units_of(participant).map(|(k, u)| (k.clone(), u.cadence)).collect();
        for (k, c) in keys {
            let at = t + self.ceil(c);
            self.set_wake(&k, at, "cadence");
        }
    }

    /// A unit's wake is over: when its act is done, if it began one; at the time it asked for, if it did; otherwise as
    /// set (its cadence from this wake, or sooner if news came meanwhile).
    pub fn finished(&mut self, key: &str, until: Option<i64>, t: i64) {
        let Some(u) = self.units.get_mut(key) else { return };
        if let Some(done) = u.done_at.take() {
            self.set_wake(key, done, "done");
        } else if let Some(until) = until {
            // (The next tick after now at the soonest: after a wake between ticks (news), that's the next boundary, not a
            // whole tick on, so someone woken just before a gathering ends still leaves when it does.)
            let at = self.ceil(t + 1).max(self.ceil(until));
            self.set_wake(key, at, "asked");
        }
    }

    /// Is a unit due at or before `t`?
    pub fn due_by(&self, t: i64) -> bool {
        self.queue.first().is_some_and(|x| x.0 <= t)
    }

    /// What's next, at or before `until`.
    pub fn next(&mut self, t: i64, until: i64) -> Result<Next, String> {
        let Some((first, _, _)) = self.queue.first().cloned() else { return Ok(Next::End) };
        if first > until {
            return Ok(Next::End);
        }
        if first > t {
            return Ok(Next::Advance { to: first });
        }
        if t == self.moment_at {
            self.cohorts_now += 1;
            if self.cohorts_now > MAX_COHORTS_PER_MOMENT {
                return Err(format!(
                    "participants kept waking each other at t={t} ({MAX_COHORTS_PER_MOMENT} rounds of wakes in one moment): {} was next",
                    self.queue.first().map(|x| x.2.as_str()).unwrap_or("?")
                ));
            }
        } else {
            self.moment_at = t;
            self.cohorts_now = 1;
        }
        let tick_now = t.div_euclid(self.tick);
        let due: Vec<(i64, String, String)> = self.queue.iter().take_while(|(w, _, _)| *w <= t).cloned().collect();
        let mut cohort = vec![];
        for (w, sort, key) in due {
            self.queue.remove(&(w, sort, key.clone()));
            let u = self.units.get_mut(&key).expect("queued units exist");
            // Units writing to each other: at most three news wakes a tick, then the next tick.
            if u.wake_for == "news" {
                if u.news_tick == tick_now && u.news_wakes >= 3 {
                    u.next_wake = (tick_now + 1) * self.tick;
                    u.wake_for = "cadence";
                    self.queue.insert((u.next_wake, u.sort.clone(), key));
                    continue;
                }
                u.news_wakes = if u.news_tick == tick_now { u.news_wakes + 1 } else { 1 };
                u.news_tick = tick_now;
            }
            u.woke_for = u.wake_for;
            u.since = u.last_wake.map_or(0, |l| t - l);
            u.last_wake = Some(t);
            // (Its cadence, if it waits without a time.)
            u.next_wake = t + (u.cadence.div_euclid(self.tick) * self.tick + if u.cadence.rem_euclid(self.tick) == 0 { 0 } else { self.tick });
            u.wake_for = "cadence";
            if let Some(p) = self.perturb {
                // (Test mode: sometimes sooner, on a tick before its cadence is up.)
                let ticks = (u.cadence / self.tick).max(1) as u64;
                if Self::draw(p.seed, &key, t, 10_000) < p.extra_wakes_bps as u64 && ticks > 1 {
                    u.next_wake = (t.div_euclid(self.tick) + 1 + Self::draw(p.seed ^ 1, &key, t, ticks - 1) as i64) * self.tick;
                }
            }
            self.queue.insert((u.next_wake, u.sort.clone(), key.clone()));
            cohort.push((key, u.woke_for, u.since));
        }
        Ok(Next::Cohort(cohort))
    }

    fn busy(u: &Unit, t: i64) -> bool {
        u.wake_for == "done" && u.next_wake > t
    }

    fn wake_now(&mut self, keys: Vec<String>, t: i64) {
        for k in keys {
            if self.units.get(&k).is_some_and(|u| u.deaf) {
                continue;
            }
            self.set_wake(&k, t, "news");
        }
    }

    /// What a command's events mean for wakes: news for those it reaches; an act begun keeps its unit busy until done.
    pub fn note(&mut self, st: Option<&State>, events: &[Value], t: i64) {
        for e in events {
            let news = match e["event"].as_str() {
                // (Gone to look at somewhere: busy until back, as with an act.)
                Some("action_started" | "visit_started") => News::Started { participant: e["participant"].as_str().unwrap_or_default(), capacity: e["as"].as_str(), done: e["free"].as_i64().or(e["done"].as_i64()).unwrap_or(t) },
                Some("message_delivered") => News::Delivered(e["to"].as_array().into_iter().flatten().filter_map(Value::as_str).collect()),
                Some("ask_answered") => match (e["participant"].as_str(), e["as"].as_str()) {
                    (Some(participant), Some(capacity)) => News::Answered { participant, capacity },
                    _ => continue,
                },
                Some("vacated") if e["reason"].as_str() == Some("flooded") => match e["occupant"].as_str() {
                    Some(person) => News::Body(person),
                    None => continue,
                },
                Some("condition_began" | "condition_ended" | "condition_treated") => match e["person"].as_str() {
                    Some(person) => News::Body(person),
                    None => continue,
                },
                Some("recorded") => News::Recorded(&e["record"]),
                _ => continue,
            };
            self.news(st, news, t);
        }
    }

    /// `note`, for events in their own shape (no JSON is made of them, but of a record: its fields are read by name).
    pub fn note_events(&mut self, st: Option<&State>, events: &[Event], t: i64) {
        for e in events {
            match &e.body {
                EventBody::ActionStarted { participant, position, done, free, .. } => self.news(st, News::Started { participant, capacity: position.as_deref(), done: free.unwrap_or(*done) }, t),
                EventBody::VisitStarted { participant, position, done, .. } => self.news(st, News::Started { participant, capacity: position.as_deref(), done: *done }, t),
                EventBody::MessageDelivered { to, .. } => self.news(st, News::Delivered(to.iter().map(String::as_str).collect()), t),
                // A keeper has answered an office's question: the office is woken to go on from the answer. (Not a person's own unit: someone
                // asking for themselves has it at their next wake. A wake at the moment it is done moved the hours a person wakes at.)
                EventBody::AskAnswered { participant, position: Some(position), .. } => self.news(st, News::Answered { participant, capacity: position }, t),
                EventBody::Vacated { occupant, reason: VacateReason::Flooded, .. } => self.news(st, News::Body(occupant), t),
                // Someone dies where others are: they are there, and know it at once (those who were in the same space).
                EventBody::Vacated { occupant, reason: VacateReason::Died, space, .. } => {
                    if let Some(st) = st {
                        let structure = space.split('/').next().unwrap_or_default();
                        let present: Vec<String> = st.occupancy.get(structure).and_then(|m| m.get(space)).into_iter().flatten().filter(|b| *b != occupant).cloned().collect();
                        for who in present {
                            self.news(Some(st), News::Body(&who), t);
                        }
                    }
                }
                EventBody::ConditionBegan { person, .. } | EventBody::ConditionEnded { person, .. } | EventBody::ConditionTreated { person, .. } => self.news(st, News::Body(person), t),
                EventBody::Recorded { record } => {
                    if st.is_some() {
                        let record = serde_json::to_value(&**record).expect("records serialize");
                        self.news(st, News::Recorded(&record), t);
                    }
                }
                _ => {}
            }
        }
    }

    fn news(&mut self, st: Option<&State>, news: News, t: i64) {
        match news {
            News::Started { participant: p, capacity: cap, done } => {
                // The unit that acted: a code unit's capacity, or the language-model participant.
                let key = [format!("{p}|{}", cap.unwrap_or("self")), p.to_string()].into_iter().find(|k| self.units.contains_key(k));
                if let Some(u) = key.and_then(|k| self.units.get_mut(&k)) {
                    u.done_at = Some(u.done_at.map_or(done, |d| d.max(done)));
                }
            }
            News::Answered { participant, capacity } => {
                let keys = self.units_of(participant).filter(|(_, u)| (u.capacity.as_deref() == Some(capacity) || (u.hears && u.participant == participant)) && u.next_wake > t && !Self::busy(u, t)).map(|(k, _)| k.clone()).collect();
                self.wake_now(keys, t);
            }
            News::Delivered(to) => {
                for to in to {
                    // (A letter to a seat is a letter to the person it sits beside, and one to the person reaches the seat: one body, whoever it was addressed to.)
                    let bodies: BTreeSet<&str> = std::iter::once(to).chain(self.units_of(to).filter_map(|(_, u)| u.body.as_deref())).collect();
                    let keys = bodies.into_iter().flat_map(|b| self.units_of(b)).filter(|(_, u)| u.next_wake > t && !Self::busy(u, t)).map(|(k, _)| k.clone()).collect::<BTreeSet<_>>().into_iter().collect();
                    self.wake_now(keys, t);
                }
            }
            // Something happening to one's own body (falling ill, getting better, being treated) is felt at once.
            // (Flooded out of where one was is felt at once too.)
            News::Body(person) => {
                let Some(st) = st else { return };
                let keys = self.acting_for(st, person, "", t);
                self.wake_now(keys, t);
            }
            News::Recorded(r) => {
                let Some(st) = st else { return };
                let mut named: BTreeSet<&str> = BTreeSet::new();
                for f in ["holder", "counterparty", "as", "to"] {
                    if let Some(x) = r[f].as_str() {
                        named.insert(x);
                    }
                }
                for x in r["addressed_to"].as_array().into_iter().chain(r["terms"]["parties"].as_array()).flatten().filter_map(Value::as_str) {
                    named.insert(x);
                }
                let author = r["author"].as_str().unwrap_or_default();
                for entity in named {
                    let keys = self.acting_for(st, entity, author, t);
                    self.wake_now(keys, t);
                }
            }
        }
    }

    /// Whose body a participant acts through: its person's, or itself (a seat and the person it sits beside are one body: what one writes is not news to the other).
    fn body_of<'a>(st: &'a State, participant: &'a str) -> &'a str {
        st.participants.get(participant).and_then(|p| p.person.as_deref()).unwrap_or(participant)
    }

    /// Code units acting for an entity now, not the author's: its person's own unit, or the units holding its positions.
    fn acting_for(&self, st: &State, entity: &str, author: &str, t: i64) -> Vec<String> {
        let wakeable = |u: &Unit| (!u.llm || u.hears) && u.next_wake > t && !Self::busy(u, t);
        if let Some(pid) = st.entities.get(entity).and_then(|e| e.body.as_ref()).and_then(|b| b.participant.as_deref()) {
            if pid == author || Self::body_of(st, author) == Self::body_of(st, pid) {
                return vec![];
            }
            return self.units_of(pid).filter(|(_, u)| u.capacity.as_deref() == Some("self") && wakeable(u)).map(|(k, _)| k.clone()).collect();
        }
        // (The organisation's positions in id order, and each holder's units in key order: as going through every
        // position and every unit gave them.)
        let mut keys = vec![];
        for id in st.positions_of.get(entity).into_iter().flatten() {
            let Some(holder) = st.positions.get(id).and_then(|x| x.holder.as_deref()) else { continue };
            if holder == author || Self::body_of(st, holder) == Self::body_of(st, author) {
                continue;
            }
            keys.extend(self.units_of(holder).filter(|(_, u)| (u.capacity.as_deref() == Some(id.as_str()) || u.hears) && wakeable(u)).map(|(k, _)| k.clone()));
        }
        keys
    }

    /// What each of a cohort's units looks as when it wakes: its participant, in its capacity (none: in all).
    pub fn looks(&self, cohort: &[(String, &'static str, i64)]) -> Vec<(String, Option<String>)> {
        cohort.iter().filter_map(|(key, _, _)| self.units.get(key)).map(|u| (u.participant.clone(), u.capacity.clone())).collect()
    }

    pub fn cohort_json(cohort: &[(String, &'static str, i64)], t: i64) -> Value {
        json!({ "t": t, "cohort": cohort.iter().map(|(k, w, s)| json!({ "key": k, "woke_for": w, "since": s })).collect::<Vec<_>>() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(key: &str, cadence: i64, next: i64) -> Value {
        let (p, cap) = key.split_once('|').unwrap_or((key, ""));
        json!({ "key": key, "participant": p, "capacity": if cap.is_empty() { Value::Null } else { json!(cap) }, "cadence": cadence, "next_wake": next })
    }

    #[test]
    fn units_wake_in_order_and_again_at_their_cadence() {
        let mut s = Scheduler::new(3600);
        s.add(&[unit("b|self", 86_400, 0), unit("a|self", 7_200, 0), unit("c|self", 86_400, 90_000)]).unwrap();
        let Next::Cohort(c) = s.next(0, 1_000_000).unwrap() else { panic!() };
        assert_eq!(c.iter().map(|x| (x.0.as_str(), x.1)).collect::<Vec<_>>(), vec![("a|self", "start"), ("b|self", "start")]);
        for (k, _, _) in &c {
            s.finished(k, None, 0);
        }
        // Nothing more now: time moves on to the earliest wake (a's cadence, 2 hours).
        assert!(matches!(s.next(0, 1_000_000).unwrap(), Next::Advance { to: 7_200 }));
        // Asked for a time: rounded up to a tick, and at least a tick on.
        let Next::Cohort(c) = s.next(7_200, 1_000_000).unwrap() else { panic!() };
        assert_eq!(c[0].0, "a|self");
        assert_eq!(c[0].2, 7_200); // since its last wake
        s.finished("a|self", Some(7_300), 7_200);
        assert!(matches!(s.next(7_200, 1_000_000).unwrap(), Next::Advance { to: 10_800 }));
        // Beyond `until`: the end.
        assert!(matches!(s.next(7_200, 9_000).unwrap(), Next::End));
    }

    #[test]
    fn an_office_that_asked_is_woken_when_answered_and_a_person_asking_for_themselves_is_not() {
        // Foundations F11: the capacity that asked is woken when its answer is done; a person's own unit is not (a wake at the moment it
        // was done moved the hours people wake at).
        let mut s = Scheduler::new(3600);
        s.add(&[unit("p|self", 86_400, 0), unit("p|desk", 86_400, 0)]).unwrap();
        let Next::Cohort(c) = s.next(0, 1_000_000).unwrap() else { panic!() };
        for (k, _, _) in &c {
            s.finished(k, None, 0);
        }
        let answered = |position: Option<&str>| json!([{ "event": "ask_answered", "participant": "p", "channel": "x", "as": position }]);
        s.note(None, answered(None).as_array().unwrap(), 100);
        assert!(matches!(s.next(100, 1_000_000).unwrap(), Next::Advance { to: 86_400 }), "nobody is woken for a person's own question");
        s.note(None, answered(Some("desk")).as_array().unwrap(), 100);
        let Next::Cohort(c) = s.next(100, 1_000_000).unwrap() else { panic!("the office is woken") };
        assert_eq!(c.iter().map(|x| (x.0.as_str(), x.1)).collect::<Vec<_>>(), vec![("p|desk", "news")]);
    }

    #[test]
    fn a_seat_that_hears_is_woken_as_the_code_unit_of_its_post_would_be_and_stands_where_that_unit_would() {
        // Foundations F9 (twins with a live seat): a seat of a mock that sits as its code twin does is woken by what is delivered to its person
        // (as the person's unit for the post is), by the answer to its own question and by no other's; and a moment's wakes are in the order
        // of the person's unit's key, not the seat's own.
        let mut s = Scheduler::new(3600);
        let mut seat = json!({ "key": "zz-seat", "participant": "zz-seat", "llm": true, "cadence": 86_400, "next_wake": 0, "hears": true, "body": "person-self", "sort": "person-self|post" });
        let mut quiet = seat.clone();
        quiet["key"] = json!("aa-quiet");
        quiet["participant"] = json!("aa-quiet");
        quiet["hears"] = json!(false);
        quiet.as_object_mut().unwrap().remove("body");
        quiet["sort"] = json!("aa-quiet");
        seat["next_wake"] = json!(0);
        s.add(&[quiet, seat, unit("person-self|self", 86_400, 0), unit("person-self|post", 86_400, 90_000)]).unwrap();
        s.add(&[unit("person-self|other", 86_400, 0)]).unwrap();
        let Next::Cohort(c) = s.next(0, 1_000_000).unwrap() else { panic!() };
        // (Sorted by where each stands: the seat is among the person's units, not at its own name's place.)
        assert_eq!(c.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), vec!["aa-quiet", "person-self|other", "zz-seat", "person-self|self"]);
        for (k, _, _) in &c {
            s.finished(k, None, 0);
        }
        // A letter to the person: its units wake, and so does the seat that sits in its body; a seat that does not hear does not.
        s.note(None, &[json!({ "event": "message_delivered", "to": ["person-self", "aa-quiet"] })], 100);
        let Next::Cohort(c) = s.next(100, 1_000_000).unwrap() else { panic!() };
        assert_eq!(c.iter().map(|x| (x.0.as_str(), x.1)).collect::<Vec<_>>(), vec![("aa-quiet", "news"), ("person-self|other", "news"), ("person-self|post", "news"), ("zz-seat", "news"), ("person-self|self", "news")]);
        for (k, _, _) in &c {
            s.finished(k, None, 100);
        }
        // An answer to a question the seat put is its own wake; one put by the person in another capacity is not.
        s.note(None, &[json!({ "event": "ask_answered", "participant": "person-self", "as": "other" })], 200);
        let Next::Cohort(c) = s.next(200, 1_000_000).unwrap() else { panic!() };
        assert_eq!(c.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), vec!["person-self|other"]);
        for (k, _, _) in &c {
            s.finished(k, None, 200);
        }
        s.note(None, &[json!({ "event": "ask_answered", "participant": "zz-seat", "as": "post" })], 300);
        let Next::Cohort(c) = s.next(300, 1_000_000).unwrap() else { panic!() };
        assert_eq!(c.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), vec!["zz-seat"]);
        for (k, _, _) in &c {
            s.finished(k, None, 300);
        }
        // A letter to the seat itself (a post's holder is the seat): the person's own units wake too, as a letter to the post's holder wakes them when a
        // person holds it.
        s.note(None, &[json!({ "event": "message_delivered", "to": ["zz-seat"] })], 400);
        let Next::Cohort(c) = s.next(400, 1_000_000).unwrap() else { panic!() };
        assert_eq!(c.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), vec!["person-self|other", "person-self|post", "zz-seat", "person-self|self"]);
    }

    #[test]
    fn a_deaf_unit_is_woken_by_no_news_only_by_its_cadence() {
        let mut s = Scheduler::new(3600);
        let mut deaf = unit("d|self", 86_400, 0);
        deaf["deaf"] = json!(true);
        s.add(&[deaf, unit("h|self", 86_400, 0)]).unwrap();
        let Next::Cohort(c) = s.next(0, 1_000_000).unwrap() else { panic!() };
        for (k, _, _) in &c {
            s.finished(k, None, 0);
        }
        // A message to both: the hearing unit wakes at once, the deaf one at its cadence.
        s.note(None, &[json!({ "event": "message_delivered", "to": ["d", "h"] })], 100);
        let Next::Cohort(c) = s.next(100, 1_000_000).unwrap() else { panic!() };
        assert_eq!(c.iter().map(|x| (x.0.as_str(), x.1)).collect::<Vec<_>>(), vec![("h|self", "news")]);
        s.finished("h|self", None, 100);
        assert!(matches!(s.next(100, 1_000_000).unwrap(), Next::Advance { to: 86_400 }));
    }

    #[test]
    fn a_unit_busy_with_an_act_goes_on_when_it_is_done() {
        let mut s = Scheduler::new(3600);
        s.add(&[unit("a|self", 86_400, 0)]).unwrap();
        let _ = s.next(0, 1_000_000).unwrap();
        s.note(None, &[json!({ "event": "action_started", "participant": "a", "done": 1 })], 0);
        s.finished("a|self", None, 0);
        assert!(matches!(s.next(0, 1_000_000).unwrap(), Next::Advance { to: 1 }));
        let Next::Cohort(c) = s.next(1, 1_000_000).unwrap() else { panic!() };
        assert_eq!(c[0].1, "done");
        // News while busy doesn't wake it; at done it goes on.
        s.note(None, &[json!({ "event": "action_started", "participant": "a", "done": 2 })], 1);
        s.finished("a|self", None, 1);
        s.note(None, &[json!({ "event": "message_delivered", "to": ["a"] })], 1);
        assert!(matches!(s.next(1, 1_000_000).unwrap(), Next::Advance { to: 2 }));
    }

    #[test]
    fn letters_back_and_forth_are_held_to_three_news_wakes_a_tick() {
        let mut s = Scheduler::new(3600);
        s.add(&[unit("a|self", 86_400, 0)]).unwrap();
        let mut woken = 0;
        for i in 0..4 {
            let Next::Cohort(c) = s.next(i, 1_000_000).unwrap() else { panic!() };
            woken += c.len();
            s.finished("a|self", None, i);
            s.note(None, &[json!({ "event": "message_delivered", "to": ["a"] })], i);
        }
        // The start wake, then three news wakes; the fourth waits for the next tick.
        assert_eq!(woken, 4);
        let Next::Cohort(c) = s.next(4, 1_000_000).unwrap() else { panic!() };
        assert!(c.is_empty());
        assert!(matches!(s.next(4, 1_000_000).unwrap(), Next::Advance { to: 3600 }));
    }
}
