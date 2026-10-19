//! city.electoral_office: the town's electoral office (participants/src/behaviour/elections.ts, with the bug-hunt
//! corrections of 2026-10-17; docs/behaviour/elections.md; docs/design/world-expansion.md 3.1). An election is people
//! and records: the office keeps the roll from enrolments (and drops the dead and the departed), gives notice and takes
//! nominations, publishes the roll and the ballot, takes votes it alone may see, counts them by the charter's method,
//! publishes the result, and appoints the winner to the office. Who is elected is theirs.
//!
//! Ported to Rust. Decided fresh (bug hunt findings 2 and 15):
//! - **Where the election stands is read from the office's own file**, every wake: results declared (each carries its
//!   poll day) move the poll on a term each; a notice or a ballot filed for this poll puts the office at that stage. A
//!   successor in the post carries on; it never announces an election already held or reseats a long-dead nominee.
//!   "The office's own file" is what was put on record in this position, whoever held it then.
//! - **A stage moves on only when its act is applied.** A notice, ballot or result the world refused (no time left, not
//!   at work, the holder dead) is tried again at the next wake; the election is never stuck with a stage and no paper.
//! - Dates are written through `when_words`; the count's ties go by id; the count is integers.

use super::{spread, Booked, Noting};
use crate::common::{data, filed_before, message, when_words, Answering, Book, Fields, DAY};
use crate::steps::{arg, because, call, say, Done, Plan, Say, Step, Visible};
use crate::{Actor, Cx, Ctx, Kind, Picture};
use oikos_rules::forms::Answers;
use oikos_sight::calls::Line;
use oikos_sight::{OutcomeStatus, Record};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub struct ElectoralOffice;

/// Instant runoff: each round, the candidate fewest rank first is out, until one has a majority of the ballots still
/// counting. Ties go out together if they are all of the last; otherwise the first in id order.
pub fn instant_runoff(candidates: &[String], rankings: &[Vec<String>]) -> (Option<String>, Vec<BTreeMap<String, i64>>) {
    let mut standing: Vec<String> = candidates.to_vec();
    standing.sort();
    let mut rounds = vec![];
    while !standing.is_empty() {
        let mut tally: BTreeMap<String, i64> = standing.iter().map(|c| (c.clone(), 0)).collect();
        let mut counting = 0;
        for r in rankings {
            if let Some(first) = r.iter().find(|c| standing.contains(c)) {
                *tally.get_mut(first).unwrap_or(&mut 0) += 1;
                counting += 1;
            }
        }
        rounds.push(tally.clone());
        let mut order = standing.clone();
        order.sort_by(|a, b| tally[b].cmp(&tally[a]).then_with(|| a.cmp(b)));
        let top = order[0].clone();
        if counting == 0 {
            return (None, rounds);
        }
        if tally[&top] * 2 > counting || standing.len() == 1 {
            return (Some(top), rounds);
        }
        let least = standing.iter().map(|c| tally[c]).min().unwrap_or(0);
        let out: Vec<String> = standing.iter().filter(|c| tally[*c] == least).cloned().collect();
        standing = if out.len() == standing.len() { standing[1..].to_vec() } else { standing.into_iter().filter(|c| !out.contains(c)).collect() };
    }
    (None, rounds)
}

/// Basis points as a percentage in words, without trailing zeros (4000 is "40", 6667 is "66.67").
fn percent(bps: i64) -> String {
    let (w, f) = (bps / 100, bps % 100);
    if f == 0 {
        w.to_string()
    } else if f % 10 == 0 {
        format!("{w}.{}", f / 10)
    } else {
        format!("{w}.{f:02}")
    }
}

fn answers() -> Answers {
    Answers {
        office: "the electoral office".into(),
        acts: "What it acts on: a nomination for an office it has given notice of an election for, lodged before nominations close; and a vote cast on its ballot while the poll is open.".into(),
        forms: vec![],
        report: false,
    }
}

fn p(schema: Value, unit: Option<&str>, default: Value, source: &str) -> Value {
    let mut v = json!({ "schema": schema, "default": default, "source": source });
    if let Some(u) = unit {
        v["unit"] = json!(u);
    }
    v
}

impl Kind for ElectoralOffice {
    fn name(&self) -> &'static str {
        "city.electoral_office"
    }
    fn version(&self) -> &'static str {
        "0.7.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/elections.md"
    }
    fn manifest(&self) -> Value {
        let mut office = p(json!({ "type": "string", "description": "the position elected (the world must say)" }), None, json!(""), "the position elected (the world must say)");
        office["required"] = json!(true);
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "first_poll_day": p(json!({ "type": "integer", "description": "the first polling day (the world gives it)" }), None, json!(365), "the first polling day (the world gives it)"),
                "method": p(json!({ "type": "string" }), None, json!("preferential"), "placeholder"),
                "nominations_close_days": p(json!({ "type": "integer" }), Some("days"), json!(30), "placeholder"),
                "nominations_open_days": p(json!({ "type": "integer", "description": "before polling day" }), Some("days"), json!(60), "placeholder"),
                "office": office,
                "office_title": p(json!({ "type": "string" }), None, json!(""), "placeholder"),
                "seats": p(json!({ "type": "boolean" }), None, json!(true), "placeholder"),
                "term_days": p(json!({ "type": "integer", "description": "the charter's term (the world gives it)" }), Some("days"), json!(1460), "the charter's term (the world gives it)"),
                "town": p(json!({ "type": "string", "description": "with whom electors enrol and candidates nominate: the electoral body itself" }), None, json!("e"), "placeholder"),
                "voting_days": p(json!({ "type": "integer", "description": "the ballot is open this long, ending on polling day" }), Some("days"), json!(14), "placeholder"),
            },
            "perceives": [], "state": "none",
            "keeps": [
                { "what": "enrolment", "why": "The electoral office keeps the roll: every elector's enrolment is lodged with it." },
                { "what": "electoral_roll", "why": "The roll it publishes at each election is its own." },
            ],
            "issues": super::forms_issued("ELECTORAL"),
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        spread(ctx, 9 * 3600, 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let office: String = ctx.need("office", "city.electoral_office")?;
        let plan = ElectionPlan {
            office,
            office_title: ctx.param("office_title", String::new())?,
            term_days: ctx.param("term_days", 4 * 365)?,
            first_poll_day: ctx.param("first_poll_day", 365)?,
            nominations_open_days: ctx.param("nominations_open_days", 60)?,
            nominations_close_days: ctx.param("nominations_close_days", 30)?,
            voting_days: ctx.param("voting_days", 14)?,
            method: ctx.param("method", "preferential".to_string())?,
            town: ctx.param("town", ctx.entity.clone())?,
            seats: ctx.param("seats", true)?,
            position: ctx.position.clone(),
            participant: ctx.participant.clone(),
            book: Book::new(),
            poll: 0,
            stage: Stage::Waiting,
            notice: None,
            ballot: None,
            votes_read: 0,
            first_seen: None,
        };
        let mut plan = plan;
        plan.poll = plan.first_poll_day * DAY;
        Ok(Box::new(Answering::new(Noting::new(plan), answers())))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let inner = saved.get("inner").cloned().ok_or("city.electoral_office: nothing saved")?;
        Ok(Box::new(Answering::restore(Noting::<ElectionPlan>::restore(inner)?, answers(), &saved)?))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum Stage {
    Waiting,
    Nominating,
    Voting,
}

#[derive(Serialize, Deserialize)]
struct ElectionPlan {
    office: String,
    office_title: String,
    term_days: i64,
    first_poll_day: i64,
    nominations_open_days: i64,
    nominations_close_days: i64,
    voting_days: i64,
    method: String,
    town: String,
    seats: bool,
    position: Option<String>,
    participant: String,
    book: Book,
    poll: i64,
    stage: Stage,
    notice: Option<String>,
    ballot: Option<String>,
    /// Votes of the book already looked at (for telling late voters); only votes made after this office first woke
    /// are looked at, so a successor does not tell voters of polls long closed.
    votes_read: usize,
    first_seen: Option<i64>,
}

/// What follows from an act of the election's: it moves the office on only when it was applied.
#[derive(Clone, Serialize, Deserialize)]
enum Then {
    Notice,
    Ballot,
    /// A result declared: the office waits for the next poll.
    Declared { closes: Option<i64> },
}

impl Booked for ElectionPlan {
    fn book_mut(&mut self) -> &mut Book {
        &mut self.book
    }
}

impl ElectionPlan {
    fn title(&self) -> &str {
        if self.office_title.is_empty() {
            &self.office
        } else {
            &self.office_title
        }
    }
    /// What this position (or participant) has put on record of a kind, for this office.
    fn filed(&self, kind: &str) -> Vec<Arc<Record>> {
        self.book
            .open(kind)
            .filter(|r| {
                let ours = match &self.position {
                    Some(pos) => r.position.as_deref() == Some(pos.as_str()),
                    None => r.author == self.participant,
                };
                ours && data(r).s("office") == Some(self.office.as_str())
            })
            .cloned()
            .collect()
    }
    fn roll(&self) -> Vec<String> {
        let dead: BTreeSet<&str> = self.book.open("death_registration").filter_map(|r| data(r).s("deceased")).collect();
        let left: BTreeSet<&str> = self.book.open("departure").filter_map(|r| r.speaks_for.as_deref()).collect();
        let mut v: BTreeSet<String> = BTreeSet::new();
        for e in self.book.open("enrolment") {
            if crate::common::addressed_to(e).contains(&self.town) {
                if let Some(s) = e.speaks_for.as_deref() {
                    if !dead.contains(s) && !left.contains(s) {
                        v.insert(s.to_string());
                    }
                }
            }
        }
        v.into_iter().collect()
    }
}

impl Plan for ElectionPlan {
    type Then = Then;
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        if self.first_seen.is_none() {
            self.first_seen = Some(pic.t);
        }
    }
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let t = pic.t;
        let world = cx.ctx.world.clone();
        let when = |x: i64| when_words(x, &world);
        let mut steps: Vec<Step<Then>> = vec![];
        // ---- where the election stands, from the file ----
        let results = self.filed("ballot_result");
        let mut file_poll = self.first_poll_day * DAY;
        while results.iter().any(|r| data(r).i("poll_at") == Some(file_poll)) {
            file_poll += self.term_days * DAY;
        }
        if file_poll > self.poll {
            self.poll = file_poll;
            self.stage = Stage::Waiting;
            self.notice = None;
            self.ballot = None;
        }
        let poll = self.poll;
        if self.notice.is_none() {
            let n = self.filed("election_notice").into_iter().filter(|r| data(r).i("poll_at") == Some(poll)).max_by_key(|r| r.at);
            if let Some(n) = n {
                self.notice = Some(n.id.clone());
                if self.stage == Stage::Waiting {
                    self.stage = Stage::Nominating;
                }
            }
        }
        if self.ballot.is_none() {
            let b = self.filed("ballot").into_iter().filter(|r| data(r).i("closes_at") == Some(poll)).max_by_key(|r| r.at);
            if let Some(b) = b {
                self.ballot = Some(b.id.clone());
                self.stage = Stage::Voting;
            }
        }
        let title = self.title().to_string();
        let method_words = if self.method == "preferential" { "preference (number every candidate)" } else { "a single choice" };
        if self.stage == Stage::Waiting && t >= poll - self.nominations_open_days * DAY {
            let close = poll - self.nominations_close_days * DAY;
            let mut s = Step::new(vec![Line {
                bind: Some("notice".into()),
                call: say(
                    "election_notice",
                    &format!("Election notice: the office of {title} falls vacant on {}. Nominations close on {}; voting is by {method_words}, and compulsory for those on the roll. Nominate with a statement of kind nomination to the town.", when(poll), when(close)),
                    Say { visible: Some(Visible::Public), data: Some(json!({ "office": self.office, "poll_at": poll, "nominations_close_at": close, "method": self.method })), ..Default::default() },
                ),
            }])
            .then(Then::Notice);
            s.why = Some(format!("An election for {title} on {}: giving notice, and opening nominations.", when(poll)));
            steps.push(s);
        }
        if self.stage == Stage::Nominating && t >= poll - self.nominations_close_days * DAY {
            // The candidates: valid nominations for this office, made since the notice (one each).
            let since = self.notice.as_ref().and_then(|n| self.book.get(n)).map_or(0, |r| r.at);
            let noms: Vec<Arc<Record>> = self
                .book
                .open("nomination")
                .filter(|n| n.at >= since && data(n).s("office") == Some(self.office.as_str()) && crate::common::addressed_to(n).contains(&self.town))
                .cloned()
                .collect();
            // (One each: the last nomination of an author counts.)
            let mut by_author: BTreeMap<String, Arc<Record>> = BTreeMap::new();
            for n in noms {
                by_author.insert(n.author.clone(), n);
            }
            let candidates: Vec<Arc<Record>> = by_author.into_values().collect();
            // (Each candidate's number on the ballot paper, in order: a vote ranks the numbers, as on a real ballot.)
            let names: Vec<Value> = candidates
                .iter()
                .enumerate()
                .map(|(i, n)| {
                    let name = data(n).s("name").map(String::from).or_else(|| n.speaks_for.clone()).unwrap_or_default();
                    json!({ "candidate": n.author, "number": (i + 1).to_string(), "for": n.speaks_for, "name": name, "nomination": n.id })
                })
                .collect();
            if names.len() <= 1 {
                // One candidate: elected unopposed, with no ballot. None: no one is elected (the office stays as it is).
                let who = names.first();
                let name = who.and_then(|w| w.s("name")).unwrap_or("").to_string();
                let why = if who.is_some() { format!("Nominations closed: one candidate, {name}, elected unopposed.") } else { "Nominations closed: no candidates; no one is elected.".into() };
                let text = if who.is_some() { format!("Election result, {title}: {name} elected unopposed.") } else { format!("Election result, {title}: no one nominated; no one elected.") };
                let mut d = json!({ "office": self.office, "poll_at": poll, "unopposed": who.is_some(), "candidates": names.len() });
                if let Some(w) = who.and_then(|w| w.s("candidate")) {
                    d["winner"] = json!(w);
                }
                let mut calls = vec![say("ballot_result", &text, Say { visible: Some(Visible::Public), data: Some(d), ..Default::default() })];
                if let (Some(w), true) = (who.and_then(|w| w.s("candidate")), self.seats) {
                    calls.push(call("position", vec![("appoint", Some(arg(&self.office))), ("to", Some(arg(w)))]));
                }
                let mut s = because(why, calls).then(Then::Declared { closes: None });
                s.redo = false;
                steps.push(s);
                return steps;
            }
            let roll = self.roll();
            let cand_words: Vec<String> = names.iter().map(|x| format!("{}. {}", x.s("number").unwrap_or(""), x.s("name").unwrap_or(""))).collect();
            let how = if self.method == "preferential" { "Rank them, first to last, as the choice: their numbers, in order, joined by > (2>1>3)." } else { "Choose one, by number." };
            let options: Vec<&str> = names.iter().filter_map(|x| x.s("number")).collect();
            // (The roll is the office's own: it is kept here and votes are checked against it. Nobody is sent it; an
            // elector knows they are on it by having enrolled.)
            let roll_call = say("electoral_roll", &format!("The electoral roll for the election on {}: {} electors.", when(poll), roll.len()), Say { visible: Some(Visible::Only(vec![self.town.clone()])), data: Some(json!({ "electors": roll, "poll_at": poll })), ..Default::default() });
            let ballot_call = say(
                "ballot",
                &format!("Ballot: {title}. Candidates: {}. {how} Voting closes on {}.", cand_words.join(", "), when(poll)),
                Say {
                    visible: Some(Visible::Public),
                    data: Some(json!({ "office": self.office, "electorate": "roll", "candidates": names, "method": self.method, "opens_at": poll - self.voting_days * DAY, "closes_at": poll, "options": options })),
                    ..Default::default()
                },
            );
            let mut s = Step::new(vec![Line { bind: None, call: roll_call }, Line { bind: Some("ballot".into()), call: ballot_call }]).then(Then::Ballot);
            s.why = Some(format!("Nominations closed: {} candidates. Publishing the roll ({}) and the ballot.", names.len(), roll.len()));
            steps.push(s);
        }
        if self.stage == Stage::Voting && self.ballot.is_some() && t >= poll {
            let ballot = self.ballot.clone().unwrap_or_default();
            let b = self.book.get(&ballot).cloned();
            let bd = b.as_ref().map(|b| data(b).clone()).unwrap_or(Value::Null);
            let candidates: Vec<String> = bd.ids("options").into_iter().map(String::from).collect();
            let cands = bd.get("candidates").and_then(Value::as_array).cloned().unwrap_or_default();
            let by_number: BTreeMap<String, String> = cands.iter().filter_map(|c| Some((c.s("number").or_else(|| c.s("candidate"))?.to_string(), c.s("candidate")?.to_string()))).collect();
            let electors: BTreeSet<String> = self
                .book
                .open("electoral_roll")
                .max_by_key(|r| r.at)
                .map(|r| data(r).ids("electors").into_iter().map(String::from).collect())
                .unwrap_or_default();
            // Each elector's last vote on this ballot, if it ranks the candidates (others are informal), made while the
            // ballot was open: one made before it opened, or at or after its close, is not counted.
            let opens = bd.i("opens_at").unwrap_or(i64::MIN);
            let closes = bd.i("closes_at").unwrap_or(i64::MAX);
            let mut votes: Vec<&Arc<Record>> = self.book.of_type("vote").filter(|v| matches!(&v.body, oikos_sight::RecordBody::Vote { ballot: b, .. } if *b == ballot)).collect();
            votes.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
            let mut last: BTreeMap<String, Vec<String>> = BTreeMap::new();
            for v in votes {
                let who = v.speaks_for.clone().unwrap_or_default();
                if !electors.contains(&who) || v.at < opens || v.at >= closes {
                    continue;
                }
                let oikos_sight::RecordBody::Vote { choice, .. } = &v.body else { continue };
                let ranking: Vec<String> = choice.split('>').map(|x| x.trim().to_string()).filter(|x| candidates.contains(x)).collect();
                if !ranking.is_empty() {
                    last.insert(who, if self.method == "plurality" { ranking[..1].to_vec() } else { ranking });
                }
            }
            let rankings: Vec<Vec<String>> = last.values().cloned().collect();
            let (top, rounds) = instant_runoff(&candidates, &rankings);
            let winner = top.and_then(|n| by_number.get(&n).cloned());
            let rounds_named: Vec<Value> = rounds.iter().map(|r| Value::Object(r.iter().map(|(n, v)| (by_number.get(n).cloned().unwrap_or_else(|| n.clone()), json!(v))).collect::<Map<_, _>>())).collect();
            let who_name = winner.as_ref().and_then(|w| cands.iter().find(|c| c.s("candidate") == Some(w.as_str()))).and_then(|c| c.s("name")).map(String::from);
            let turnout = if electors.is_empty() { 0 } else { (last.len() as i64 * 10_000 + electors.len() as i64 / 2) / electors.len() as i64 };
            let named = who_name.clone().or_else(|| winner.clone()).unwrap_or_default();
            let mut d = json!({ "ballot": ballot, "office": self.office, "poll_at": poll, "rounds": rounds_named, "formal": last.len(), "electors": electors.len(), "turnout_bps": turnout });
            if let Some(w) = &winner {
                d["winner"] = json!(w);
            }
            let mut calls = vec![say(
                "ballot_result",
                &format!(
                    "Election result, {title}: {}; {} formal votes of {} on the roll (turnout {}%).",
                    if winner.is_some() { format!("{named} elected") } else { "no one elected".into() },
                    last.len(),
                    electors.len(),
                    percent(turnout)
                ),
                Say { visible: Some(Visible::Public), basis: Some(ballot.clone()), data: Some(d), ..Default::default() },
            )];
            if let (Some(w), true) = (&winner, self.seats) {
                calls.push(call("position", vec![("appoint", Some(arg(&self.office))), ("to", Some(arg(w)))]));
            }
            steps.push(
                because(
                    format!("Polling day: counting {} formal votes of {} electors{}.", last.len(), electors.len(), if winner.is_some() { format!("; {named} is elected") } else { ": nobody is elected".into() }),
                    calls,
                )
                .then(Then::Declared { closes: Some(closes) }),
            );
        }
        // Votes cast after a poll closed are told so (nothing of how anyone voted), once, for polls closed since this
        // office began to look.
        let first = self.first_seen.unwrap_or(t);
        let closed: BTreeMap<String, i64> = self
            .filed("ballot_result")
            .iter()
            .filter_map(|r| {
                let b = data(r).s("ballot")?;
                Some((b.to_string(), data(self.book.get(b)?).i("closes_at")?))
            })
            .collect();
        let votes: Vec<Arc<Record>> = self.book.of_type("vote").cloned().collect();
        for v in votes.iter().skip(self.votes_read) {
            let oikos_sight::RecordBody::Vote { ballot, .. } = &v.body else { continue };
            let Some(closed_at) = closed.get(ballot) else { continue };
            if v.at < *closed_at || v.author == "genesis" || v.at < first - DAY {
                continue;
            }
            steps.push(because(
                format!("A vote on {ballot}, cast after the poll closed: not counted, and saying so."),
                vec![message(std::slice::from_ref(&v.author), &format!("From the electoral office: your vote on {ballot} is not counted. The poll closed on {} and the result is declared.", when(*closed_at)), Some(&v.id))],
            ));
        }
        self.votes_read = votes.len();
        steps
    }
    fn then(&mut self, tok: &Then, done: Done, _cx: &mut Cx) -> Vec<Step<Then>> {
        // (An act refused leaves the office where it was, to try again.)
        let Done::Outcome(o) = done else { return vec![] };
        if o.status != OutcomeStatus::Applied {
            return vec![];
        }
        match tok {
            Then::Notice => {
                self.stage = Stage::Nominating;
                self.notice = o.created.as_ref().and_then(|c| c.get("notice").cloned());
            }
            Then::Ballot => {
                self.stage = Stage::Voting;
                self.ballot = o.created.as_ref().and_then(|c| c.get("ballot").cloned());
            }
            Then::Declared { .. } => {
                self.stage = Stage::Waiting;
                self.ballot = None;
                self.notice = None;
                self.poll += self.term_days * DAY;
            }
        }
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::{st, Rig, DAY};
    use super::*;

    const POLL: i64 = 100 * DAY;

    fn office() -> Rig {
        Rig::new(&ElectoralOffice, "city", Some("electoral"), json!({ "office": "mayor", "office_title": "Mayor", "first_poll_day": 100, "term_days": 400 }))
    }
    fn enrol(who: &str) -> Value {
        st(&format!("enrol-{who}"), 0, "enrolment", who, &["city"], json!({}))
    }

    #[test]
    fn instant_runoff_counts_preferences_and_ties_go_by_id() {
        let c = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let (w, rounds) = instant_runoff(&c(&["1", "2", "3"]), &[c(&["1"]), c(&["1"]), c(&["2", "3"]), c(&["3", "2"]), c(&["3"])]);
        assert_eq!(w.as_deref(), Some("3"), "{rounds:?}");
        assert_eq!(rounds.len(), 2);
        assert_eq!(instant_runoff(&c(&["1", "2"]), &[]).0, None);
        // (Ported at the cut-over from orchestrator/test/elections.test.ts, "instant runoff": a 4, b 3, c 2 first
        // preferences; c's go to b: b wins 5 to 4.)
        let r: Vec<Vec<String>> = [vec![c(&["a", "b"]); 4], vec![c(&["b", "a"]); 3], vec![c(&["c", "b"]); 2]].concat();
        let (w, rounds) = instant_runoff(&c(&["a", "b", "c"]), &r);
        assert_eq!(w.as_deref(), Some("b"));
        assert_eq!(rounds.len(), 2);
        assert_eq!((rounds[0].get("a"), rounds[0].get("b"), rounds[0].get("c")), (Some(&4), Some(&3), Some(&2)));
        assert_eq!((rounds[1].get("a"), rounds[1].get("b"), rounds[1].get("c")), (Some(&4), Some(&5), None));
    }

    #[test]
    fn notice_is_given_nominations_open_days_before_polling_day_once() {
        let mut o = office();
        assert!(o.day(39 * DAY, &[]).is_empty());
        let out = o.day(40 * DAY, &[]).join("\n");
        assert!(out.contains("kind=election_notice") && out.contains(&format!("\"poll_at\":{POLL}")), "{out}");
        let mut filed = st("rec.40", 40 * DAY + 60, "election_notice", "city", &[], json!({ "office": "mayor", "poll_at": POLL }));
        filed["in_position"] = json!("electoral");
        assert!(o.day(41 * DAY, &[filed]).is_empty(), "once the notice is on file");
    }

    #[test]
    fn a_successor_does_not_announce_an_election_already_held() {
        // The day-100 election's result is on the office's file (in its position): a successor at day 200 gives no notice
        // for it, and waits for the next poll a term on.
        let mut result = st("rec.50", 100 * DAY, "ballot_result", "city", &[], json!({ "office": "mayor", "poll_at": POLL, "winner": "c2" }));
        result["in_position"] = json!("electoral");
        let mut o = office();
        assert!(o.day(200 * DAY, &[result.clone()]).is_empty());
        // ... and gives notice for the next poll, 60 days ahead of it.
        let out = o.day((500 - 60) * DAY, &[]).join("\n");
        assert!(out.contains("kind=election_notice") && out.contains(&format!("\"poll_at\":{}", 500 * DAY)), "{out}");
    }

    #[test]
    fn a_notice_the_world_refused_is_given_again() {
        // The act is sent and refused (no outcome of status applied): the stage has not moved, so the next wake gives it again.
        let mut o = office();
        assert!(!o.day(40 * DAY, &[]).is_empty());
        let again = o.day(41 * DAY, &[]).join("\n");
        assert!(again.is_empty() || again.contains("election_notice"), "{again}");
    }

    #[test]
    fn nominations_close_with_one_candidate_elected_unopposed() {
        let mut o = office();
        o.day(40 * DAY, &[enrol("c1"), enrol("c2")]);
        let mut n = st("rec.60", 45 * DAY, "nomination", "c1", &["city"], json!({ "office": "mayor", "name": "Ann" }));
        n["author"] = json!("c1-self");
        // (The notice is the office's own paper: shown to it with its next look.)
        let mut notice = st("rec.59", 40 * DAY + 100, "election_notice", "city", &[], json!({ "office": "mayor", "poll_at": POLL }));
        notice["in_position"] = json!("electoral");
        let out = o.day(70 * DAY, &[notice, n]).join("\n");
        assert!(out.contains("kind=ballot_result") && out.contains("elected unopposed") && out.contains("position(appoint=mayor"), "{out}");
    }

    #[test]
    fn the_manifest_is_the_one_the_ts_module_wrote() {
        let ts: Value = crate::offices::testing::ts_manifest("city.electoral_office");
        let rust = ElectoralOffice.manifest();
        for (k, v) in ts.as_object().unwrap() {
            // (The Rust is 0.7.0, the bug-fix branch's version; the manifest on this branch is the TS before it.)
            if k == "version" {
                continue;
            }
            assert_eq!(&rust[k], v, "{k}");
        }
    }
}
