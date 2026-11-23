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
                "takes_office_days": p(json!({ "type": "integer", "description": "days after declaration before the winner takes office" }), Some("days"), json!(0), "placeholder"),
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
            takes_office_days: ctx.param("takes_office_days", 0)?,
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
            seated_results: BTreeSet::new(),
            unapplied_laws: BTreeSet::new(),
            cycle_since: None,
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
    #[serde(default)]
    takes_office_days: i64,
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
    /// Declared results already seated by this office (when `seats: true` and `takes_office_days > 0`).
    #[serde(default)]
    seated_results: BTreeSet<String>,
    /// Amended election-schedule laws for which a public notice was already published stating the date could not be applied.
    #[serde(default)]
    unapplied_laws: BTreeSet<String>,
    /// Earliest notice timestamp of the current election cycle, preserved if the poll date is amended during nominations.
    #[serde(default)]
    cycle_since: Option<i64>,
}

/// What follows from an act of the election's: it moves the office on only when it was applied.
#[derive(Clone, Serialize, Deserialize)]
enum Then {
    Notice,
    Ballot,
    /// A result declared: the office waits for the next poll.
    Declared { closes: Option<i64> },
    /// A deferred self-seating applied for a declared result.
    Seated { result: String },
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
    /// Effective timetable figures: latest open `schedule-elections` law on file overrides actor params when present.
    fn effective(&self) -> (i64, i64, i64, i64, i64, i64, Option<String>) {
        let mut out = (self.first_poll_day, self.term_days, self.nominations_open_days, self.nominations_close_days, self.voting_days, self.takes_office_days, None);
        let law = self
            .book
            .open("law")
            .filter(|r| data(r).s("schedule") == Some("schedule-elections"))
            .max_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
        let Some(law) = law else { return out };
        out.6 = Some(law.id.to_string());
        let Some(figs) = data(law).get("figures").and_then(|x| x.as_object()) else { return out };
        let days = |k: &str| -> Option<i64> {
            let f = figs.get(k)?;
            let v = f.get("value").and_then(|x| x.as_i64())?;
            let unit = f.get("unit").and_then(|x| x.as_str()).unwrap_or("days");
            Some(if unit == "seconds" { v / DAY } else { v })
        };
        if let Some(v) = days("first_poll_day") { out.0 = v; }
        if let Some(v) = days("term_days") { out.1 = v.max(1); }
        if let Some(v) = days("nominations_open_days") { out.2 = v.max(1); }
        if let Some(v) = days("nominations_close_days") { out.3 = v.max(1); }
        if let Some(v) = days("voting_days") { out.4 = v.max(1); }
        if let Some(v) = days("takes_office_days") { out.5 = v.max(0); }
        out
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
            if crate::common::addressed_to(e).iter().any(|x| x == &self.town) {
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
        let (first_poll_day, term_days, nom_open_days, nom_close_days, voting_days, takes_office_days, law_id) = self.effective();
        let results = self.filed("ballot_result");
        let last_declared_at = results.iter().map(|r| r.at).max();
        let last_declared = results.iter().filter_map(|r| data(r).i("poll_at")).max();
        // Restore open notice / ballot for the current election cycle BEFORE evaluating schedule amendments so an open
        // ballot is never cancelled and pre-delay nominations are never dropped (including after a successor wake).
        if self.notice.is_none() {
            let n = self
                .filed("election_notice")
                .into_iter()
                .filter(|r| last_declared_at.is_none_or(|ld| r.at > ld))
                .min_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
            if let Some(n) = n {
                self.notice = Some(n.id.to_string());
                self.cycle_since = Some(self.cycle_since.map_or(n.at, |s| s.min(n.at)));
                if self.stage == Stage::Waiting {
                    self.stage = Stage::Nominating;
                }
            }
        }
        if self.ballot.is_none() {
            let b = self.filed("ballot").into_iter().filter(|r| data(r).i("closes_at") == Some(self.poll)).max_by_key(|r| r.at);
            if let Some(b) = b {
                self.ballot = Some(b.id.to_string());
                self.stage = Stage::Voting;
            }
        }
        let mut file_poll = (first_poll_day + (results.len() as i64) * term_days) * DAY;
        while results.iter().any(|r| data(r).i("poll_at") == Some(file_poll))
            || last_declared.is_some_and(|ld| file_poll <= ld)
        {
            file_poll += term_days * DAY;
        }
        if file_poll != self.poll {
            if self.stage == Stage::Voting {
                // Do not cancel an open ballot or discard votes already cast; state publicly that the change applies to later elections.
                if let Some(lid) = &law_id {
                    if self.unapplied_laws.insert(lid.clone()) {
                        let text = format!(
                            "Election timetable notice: voting is already open for {} (closes on {}); the amended polling date ({}) cannot change the open ballot and will apply after this election.",
                            self.title(),
                            when(self.poll),
                            when(file_poll)
                        );
                        steps.push(because(
                            "Election schedule amended while ballot is open: keeping the open ballot and notifying the public.",
                            vec![say("notice", &text, Say { visible: Some(Visible::Public), basis: Some(lid.clone()), data: Some(json!({ "office": self.office, "poll_at": self.poll, "amended_poll_at": file_poll, "law": lid, "reason": "ballot_open" })), ..Default::default() })],
                        ));
                    }
                }
            } else if file_poll <= t {
                // Amended polling date is already in the past and cannot be applied: say so publicly.
                if let Some(lid) = &law_id {
                    if self.unapplied_laws.insert(lid.clone()) {
                        let text = format!(
                            "Election timetable notice: the amended polling date ({}) for {} has already passed and cannot be applied; the election remains scheduled for {}.",
                            when(file_poll),
                            self.title(),
                            when(self.poll)
                        );
                        steps.push(because(
                            "Election schedule amended to a past date: cannot be applied; notifying the public.",
                            vec![say("notice", &text, Say { visible: Some(Visible::Public), basis: Some(lid.clone()), data: Some(json!({ "office": self.office, "poll_at": self.poll, "amended_poll_at": file_poll, "law": lid, "reason": "date_passed" })), ..Default::default() })],
                        ));
                    }
                }
            } else if (self.stage == Stage::Waiting || file_poll < self.poll) && file_poll < t + nom_open_days * DAY {
                // Bringing a poll forward (or setting an unannounced poll) with less than the full notice period would starve nominations.
                if let Some(lid) = &law_id {
                    if self.unapplied_laws.insert(lid.clone()) {
                        let text = format!(
                            "Election timetable notice: the amended polling date ({}) for {} leaves less than the required notice period and cannot be applied; the election remains scheduled for {}.",
                            when(file_poll),
                            self.title(),
                            when(self.poll)
                        );
                        steps.push(because(
                            "Election schedule amended with insufficient notice: keeping the scheduled poll and notifying the public.",
                            vec![say("notice", &text, Say { visible: Some(Visible::Public), basis: Some(lid.clone()), data: Some(json!({ "office": self.office, "poll_at": self.poll, "amended_poll_at": file_poll, "law": lid, "reason": "insufficient_notice" })), ..Default::default() })],
                        ));
                    }
                }
            } else if self.stage == Stage::Nominating && file_poll <= t + nom_close_days * DAY {
                // Even when already nominating, a new date that leaves no remaining nomination window cannot be applied.
                if let Some(lid) = &law_id {
                    if self.unapplied_laws.insert(lid.clone()) {
                        let text = format!(
                            "Election timetable notice: the amended polling date ({}) for {} leaves less than the nomination close period and cannot be applied; the election remains scheduled for {}.",
                            when(file_poll),
                            self.title(),
                            when(self.poll)
                        );
                        steps.push(because(
                            "Election schedule amended with insufficient nomination time: keeping the scheduled poll and notifying the public.",
                            vec![say("notice", &text, Say { visible: Some(Visible::Public), basis: Some(lid.clone()), data: Some(json!({ "office": self.office, "poll_at": self.poll, "amended_poll_at": file_poll, "law": lid, "reason": "insufficient_notice" })), ..Default::default() })],
                        ));
                    }
                }
            } else if self.stage == Stage::Nominating {
                // Moving a poll while nominations are already open: keep the existing notice and cycle_since so nominees
                // already filed stay on the ballot and citizens do not redraw standing; publish an update notice.
                let prev = self.poll;
                if let Some(n_at) = self.notice.as_ref().and_then(|n| self.book.get(n)).map(|r| r.at) {
                    self.cycle_since = Some(self.cycle_since.map_or(n_at, |s| s.min(n_at)));
                }
                self.poll = file_poll;
                self.ballot = None;
                let close = file_poll - nom_close_days * DAY;
                let text = format!(
                    "Election timetable notice: polling for {} has moved from {} to {}. Nominations already filed stand and nominations now close on {}.",
                    self.title(),
                    when(prev),
                    when(file_poll),
                    when(close)
                );
                steps.push(because(
                    "Election schedule amended during nominations: moving polling day while keeping existing nominations.",
                    vec![say(
                        "notice",
                        &text,
                        Say {
                            visible: Some(Visible::Public),
                            basis: law_id.clone(),
                            data: Some(json!({ "office": self.office, "poll_at": file_poll, "previous_poll_at": prev, "nominations_close_at": close })),
                            ..Default::default()
                        },
                    )],
                ));
            } else {
                // Waiting (not yet announced): follow the amended timetable in force (delayed or brought forward).
                self.poll = file_poll;
                self.stage = Stage::Waiting;
                self.notice = None;
                self.ballot = None;
            }
        }
        // When the electoral office itself seats winners and a handover interval is set, seat only the latest declared winner, once.
        if self.seats && takes_office_days > 0 {
            if let Some(latest) = results.iter().max_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id))) {
                let d = data(latest);
                if let (Some(w), Some(at)) = (d.s("winner"), d.i("takes_office_at")) {
                    if t >= at
                        && !self.seated_results.contains(latest.id.as_str())
                        && !self.book.position(&self.office).is_some_and(|p| p.holder.as_deref() == Some(w))
                    {
                        let mut s = because(
                            format!("Handover date reached for {w} as {}: seating them.", self.title()),
                            vec![call("position", vec![("appoint", Some(arg(&self.office))), ("to", Some(arg(w)))])],
                        )
                        .then(Then::Seated { result: latest.id.to_string() });
                        s.redo = false;
                        steps.push(s);
                    }
                }
            }
        }
        let poll = self.poll;
        // Re-check file for notice/ballot if `self.poll` just moved to an amended date.
        if self.notice.is_none() {
            let n = self.filed("election_notice").into_iter().filter(|r| data(r).i("poll_at") == Some(poll)).max_by_key(|r| r.at);
            if let Some(n) = n {
                self.notice = Some(n.id.to_string());
                if self.stage == Stage::Waiting {
                    self.stage = Stage::Nominating;
                }
            }
        }
        if self.ballot.is_none() {
            let b = self.filed("ballot").into_iter().filter(|r| data(r).i("closes_at") == Some(poll)).max_by_key(|r| r.at);
            if let Some(b) = b {
                self.ballot = Some(b.id.to_string());
                self.stage = Stage::Voting;
            }
        }
        let title = self.title().to_string();
        let method_words = if self.method == "preferential" { "preference (number every candidate)" } else { "a single choice" };
        if self.stage == Stage::Waiting && t >= poll - nom_open_days * DAY {
            let close = poll - nom_close_days * DAY;
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
        if self.stage == Stage::Nominating && t >= poll - nom_close_days * DAY {
            // The candidates: valid nominations for this office, made since the earliest notice of this election cycle (one each).
            let notice_at = self.notice.as_ref().and_then(|n| self.book.get(n)).map_or(0, |r| r.at);
            let since = self.cycle_since.map_or(notice_at, |s| s.min(notice_at));
            let noms: Vec<Arc<Record>> = self
                .book
                .open("nomination")
                .filter(|n| n.at >= since && data(n).s("office") == Some(self.office.as_str()) && crate::common::addressed_to(n).iter().any(|x| x == &self.town))
                .cloned()
                .collect();
            // (One each: the last nomination of an author counts.)
            let mut by_author: BTreeMap<String, Arc<Record>> = BTreeMap::new();
            for n in noms {
                by_author.insert(n.author.to_string(), n);
            }
            let candidates: Vec<Arc<Record>> = by_author.into_values().collect();
            // (Each candidate's number on the ballot paper, in order: a vote ranks the numbers, as on a real ballot.)
            let names: Vec<Value> = candidates
                .iter()
                .enumerate()
                .map(|(i, n)| {
                    let name = data(n).s("name").map(String::from).or_else(|| n.speaks_for.map(|x| x.to_string())).unwrap_or_default();
                    json!({ "candidate": n.author, "number": (i + 1).to_string(), "for": n.speaks_for, "name": name, "nomination": n.id })
                })
                .collect();
            if names.len() <= 1 {
                // One candidate: elected unopposed, with no ballot. None: no one is elected (the office stays as it is).
                let who = names.first();
                let name = who.and_then(|w| w.s("name")).unwrap_or("").to_string();
                let why = if who.is_some() { format!("Nominations closed: one candidate, {name}, elected unopposed.") } else { "Nominations closed: no candidates; no one is elected.".into() };
                let mut text = if who.is_some() { format!("Election result, {title}: {name} elected unopposed.") } else { format!("Election result, {title}: no one nominated; no one elected.") };
                let mut d = json!({ "office": self.office, "poll_at": poll, "unopposed": who.is_some(), "candidates": names.len() });
                if let Some(w) = who.and_then(|w| w.s("candidate")) {
                    d["winner"] = json!(w);
                    if takes_office_days > 0 {
                        let takes_at = t + takes_office_days * DAY;
                        d["takes_office_at"] = json!(takes_at);
                        text.push_str(&format!(" Takes office on {}.", when(takes_at)));
                    }
                }
                let mut calls = vec![say("ballot_result", &text, Say { visible: Some(Visible::Public), data: Some(d), ..Default::default() })];
                if let (Some(w), true) = (who.and_then(|w| w.s("candidate")), self.seats && takes_office_days == 0) {
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
                    data: Some(json!({ "office": self.office, "electorate": "roll", "candidates": names, "method": self.method, "opens_at": poll - voting_days * DAY, "closes_at": poll, "options": options })),
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
            let bd = b.as_ref().map(|b| data(b).clone()).unwrap_or((Value::Null).into());
            let candidates: Vec<String> = bd.ids("options").into_iter().map(String::from).collect();
            let cands = bd.get("candidates").and_then(|x| x.as_array()).map(|a| a.to_vec()).unwrap_or_default();
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
                let who = v.speaks_for.unwrap_or_default();
                if !electors.contains(who.as_str()) || v.at < opens || v.at >= closes {
                    continue;
                }
                let oikos_sight::RecordBody::Vote { choice, .. } = &v.body else { continue };
                let ranking: Vec<String> = choice.split('>').map(|x| x.trim().to_string()).filter(|x| candidates.contains(x)).collect();
                if !ranking.is_empty() {
                    last.insert(who.to_string(), if self.method == "plurality" { ranking[..1].to_vec() } else { ranking });
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
            let mut text = format!(
                "Election result, {title}: {}; {} formal votes of {} on the roll (turnout {}%).",
                if winner.is_some() { format!("{named} elected") } else { "no one elected".into() },
                last.len(),
                electors.len(),
                percent(turnout)
            );
            if let Some(w) = &winner {
                d["winner"] = json!(w);
                if takes_office_days > 0 {
                    let takes_at = t + takes_office_days * DAY;
                    d["takes_office_at"] = json!(takes_at);
                    text.push_str(&format!(" Takes office on {}.", when(takes_at)));
                }
            }
            let mut calls = vec![say(
                "ballot_result",
                &text,
                Say { visible: Some(Visible::Public), basis: Some(ballot.clone()), data: Some(d), ..Default::default() },
            )];
            if let (Some(w), true) = (&winner, self.seats && takes_office_days == 0) {
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
        // (Only the votes not read before are read: those before stay where they are held.)
        let votes_seen = self.book.of_type("vote").len();
        let votes: Vec<Arc<Record>> = self.book.of_type("vote").skip(self.votes_read).cloned().collect();
        for v in votes.iter() {
            let oikos_sight::RecordBody::Vote { ballot, .. } = &v.body else { continue };
            let Some(closed_at) = closed.get(ballot.as_str()) else { continue };
            if v.at < *closed_at || v.author == "genesis" || v.at < first - DAY {
                continue;
            }
            steps.push(because(
                format!("A vote on {ballot}, cast after the poll closed: not counted, and saying so."),
                vec![message(std::slice::from_ref(&v.author.to_string()), &format!("From the electoral office: your vote on {ballot} is not counted. The poll closed on {} and the result is declared.", when(*closed_at)), Some(&v.id))],
            ));
        }
        self.votes_read = votes_seen;
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
                self.notice = (o.created.as_ref().and_then(|c| c.get("notice").cloned())).map(|x| x.to_string());
            }
            Then::Ballot => {
                self.stage = Stage::Voting;
                self.ballot = (o.created.as_ref().and_then(|c| c.get("ballot").cloned())).map(|x| x.to_string());
            }
            Then::Declared { .. } => {
                self.stage = Stage::Waiting;
                self.ballot = None;
                self.notice = None;
                self.cycle_since = None;
                self.poll += self.effective().1 * DAY;
            }
            Then::Seated { result } => {
                self.seated_results.insert(result.clone());
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
    fn takes_office_days_writes_takes_office_at_and_omits_when_zero() {
        let mut o0 = office();
        o0.day(40 * DAY, &[enrol("c1")]);
        let mut n = st("rec.60", 45 * DAY, "nomination", "c1", &["city"], json!({ "office": "mayor", "name": "Ann" }));
        n["author"] = json!("c1-self");
        let mut notice = st("rec.59", 40 * DAY + 100, "election_notice", "city", &[], json!({ "office": "mayor", "poll_at": POLL }));
        notice["in_position"] = json!("electoral");
        let out0 = o0.day(70 * DAY, &[notice.clone(), n.clone()]).join("\n");
        assert!(!out0.contains("takes_office_at") && !out0.contains("Takes office on"), "{out0}");

        let mut o4 = Rig::new(&ElectoralOffice, "city", Some("electoral"), json!({ "office": "mayor", "office_title": "Mayor", "first_poll_day": 100, "term_days": 400, "takes_office_days": 4 }));
        o4.day(40 * DAY, &[enrol("c1")]);
        let out4 = o4.day(70 * DAY, &[notice, n]).join("\n");
        assert!(out4.contains(&format!("\"takes_office_at\":{}", 74 * DAY)) && out4.contains("Takes office on") && !out4.contains("position(appoint=mayor"), "{out4}");
    }

    #[test]
    fn election_schedule_law_overrides_params_and_delays_poll() {
        let mut o = office();
        let law = st("law-elections", 10 * DAY, "law", "city", &[], json!({
            "schedule": "schedule-elections",
            "figures": {
                "first_poll_day": { "value": 130, "unit": "days" },
                "takes_office_days": { "value": 5 * DAY, "unit": "seconds" }
            }
        }));
        // Day 40 would have opened notice for day 100; under the amended law (day 130), day 40 stays quiet and day 70 opens notice for day 130.
        assert!(o.day(40 * DAY, &[law]).is_empty());
        let out = o.day(70 * DAY, &[]).join("\n");
        assert!(out.contains("kind=election_notice") && out.contains(&format!("\"poll_at\":{}", 130 * DAY)), "{out}");
    }

    #[test]
    fn election_schedule_law_brings_poll_forward_and_notifies_when_date_passed() {
        // Bringing the poll forward from day 100 to day 80 moves notice from day 40 to day 20.
        let mut o = office();
        let earlier = st("law-earlier", 5 * DAY, "law", "city", &[], json!({
            "schedule": "schedule-elections",
            "figures": { "first_poll_day": { "value": 80, "unit": "days" } }
        }));
        let out = o.day(20 * DAY, &[earlier]).join("\n");
        assert!(out.contains("kind=election_notice") && out.contains(&format!("\"poll_at\":{}", 80 * DAY)), "{out}");
        // Put the filed notice on record so the office advances to Nominating.
        let mut filed_notice = st("rec.20", 20 * DAY + 60, "election_notice", "city", &[], json!({ "office": "mayor", "poll_at": 80 * DAY }));
        filed_notice["in_position"] = json!("electoral");

        // Amending to a date already in the past publishes a public notice once and keeps the scheduled poll.
        let past = st("law-past", 25 * DAY, "law", "city", &[], json!({
            "schedule": "schedule-elections",
            "figures": { "first_poll_day": { "value": 10, "unit": "days" } }
        }));
        let notice = o.day(26 * DAY, &[filed_notice, past]).join("\n");
        assert!(notice.contains("kind=notice") && notice.contains("\"reason\":\"date_passed\""), "{notice}");
        // Notice is published once per unapplied law.
        assert!(o.day(27 * DAY, &[]).is_empty());
    }

    #[test]
    fn amendment_while_ballot_is_open_preserves_open_ballot_and_votes_and_notifies_public() {
        let mut o = office();
        o.day(40 * DAY, &[enrol("c1"), enrol("c2"), enrol("v1"), enrol("v2")]);
        let mut notice = st("rec.59", 40 * DAY + 100, "election_notice", "city", &[], json!({ "office": "mayor", "poll_at": POLL }));
        notice["in_position"] = json!("electoral");
        let mut n1 = st("rec.60", 45 * DAY, "nomination", "c1", &["city"], json!({ "office": "mayor", "name": "Ann" }));
        n1["author"] = json!("c1-self");
        let mut n2 = st("rec.61", 46 * DAY, "nomination", "c2", &["city"], json!({ "office": "mayor", "name": "Ben" }));
        n2["author"] = json!("c2-self");
        // Day 70: nominations close, roll + ballot published (closes_at = 100 * DAY, opens_at = 86 * DAY).
        let open_out = o.day(70 * DAY, &[notice, n1, n2]).join("\n");
        assert!(open_out.contains("kind=ballot"), "{open_out}");

        // Put the published roll, ballot, and two votes on file, then amend first_poll_day to 130 while voting is open!
        let mut roll = st("rec.70", 70 * DAY + 10, "electoral_roll", "city", &[], json!({ "electors": ["c1", "c2", "v1", "v2"], "poll_at": POLL }));
        roll["in_position"] = json!("electoral");
        let mut ballot = st("rec.71", 70 * DAY + 10, "ballot", "city", &[], json!({
            "office": "mayor", "electorate": "roll", "method": "preferential",
            "opens_at": 86 * DAY, "closes_at": POLL, "options": ["1", "2"],
            "candidates": [
                { "candidate": "c1-self", "number": "1", "name": "Ann" },
                { "candidate": "c2-self", "number": "2", "name": "Ben" }
            ]
        }));
        ballot["in_position"] = json!("electoral");
        let v1 = json!({ "id": "rec.80", "record": "vote", "author": "v1-self", "speaks_for": "v1", "at": 88 * DAY, "visible_to": ["city"], "ballot": "rec.71", "choice": "1>2" });
        let v2 = json!({ "id": "rec.81", "record": "vote", "author": "v2-self", "speaks_for": "v2", "at": 89 * DAY, "visible_to": ["city"], "ballot": "rec.71", "choice": "1>2" });
        let delay = st("law-delay", 90 * DAY, "law", "city", &[], json!({
            "schedule": "schedule-elections",
            "figures": { "first_poll_day": { "value": 130, "unit": "days" } }
        }));
        // Day 91: office notifies publicly that voting is already open and keeps the ballot intact.
        let warn = o.day(91 * DAY, &[roll, ballot, v1, v2, delay]).join("\n");
        assert!(warn.contains("kind=notice") && warn.contains("\"reason\":\"ballot_open\""), "{warn}");
        // Day 100: original ballot still closes and counts the votes already cast (Ann wins with 2 formal votes).
        let res = o.day(100 * DAY, &[]).join("\n");
        assert!(res.contains("kind=ballot_result") && res.contains("\"winner\":\"c1-self\"") && res.contains("\"formal\":2"), "{res}");
    }

    #[test]
    fn deferred_self_seating_acts_only_on_latest_result_once() {
        // Use finance::kit::Rig so applied outcomes flow back to `Plan::then`, matching the live engine.
        let mut m = crate::finance::kit::Rig::new(
            &ElectoralOffice,
            "city",
            "electoral",
            json!({ "office": "mayor", "office_title": "Mayor", "first_poll_day": 100, "term_days": 400, "takes_office_days": 4 }),
        );
        let mut r1 = st("rec.10", 100 * DAY, "ballot_result", "city", &[], json!({ "office": "mayor", "poll_at": 100 * DAY, "winner": "c1-self", "takes_office_at": 104 * DAY }));
        r1["in_position"] = json!("city-office");
        let mut r2 = st("rec.20", 500 * DAY, "ballot_result", "city", &[], json!({ "office": "mayor", "poll_at": 500 * DAY, "winner": "c2-self", "takes_office_at": 504 * DAY }));
        r2["in_position"] = json!("city-office");
        // Only the latest winner (c2-self) is seated, never the earlier winner (c1-self).
        let said = m.at(505 * DAY, json!({ "records": crate::finance::kit::records(vec![r1, r2]) }), json!([]));
        let text = format!("{said:?}");
        assert!(text.contains("c2-self") && !text.contains("c1-self"), "{text}");
        // On a subsequent wake (even if c2-self were later removed), the same result is not seated a second time.
        let again = m.at(506 * DAY, json!({ "records": crate::finance::kit::records(vec![]) }), json!([]));
        assert!(again.is_empty(), "should not re-seat: {again:?}");
    }

    #[test]
    fn poll_brought_forward_with_insufficient_notice_is_not_applied() {
        // At day 30, bringing a day-100 poll forward to day 50 leaves only 20 days (< 60-day notice period):
        // the office refuses to starve nominations, publishes a public notice with reason=insufficient_notice, and keeps day 100.
        let mut o = office();
        let short = st("law-short", 25 * DAY, "law", "city", &[], json!({
            "schedule": "schedule-elections",
            "figures": { "first_poll_day": { "value": 50, "unit": "days" } }
        }));
        let out = o.day(30 * DAY, &[short]).join("\n");
        assert!(out.contains("kind=notice") && out.contains("\"reason\":\"insufficient_notice\"") && !out.contains("kind=election_notice"), "{out}");
        // Original day-100 schedule remains intact: day 40 opens notice for day 100.
        let notice = o.day(40 * DAY, &[]).join("\n");
        assert!(notice.contains("kind=election_notice") && notice.contains(&format!("\"poll_at\":{}", 100 * DAY)), "{notice}");
    }

    #[test]
    fn delay_during_nominations_preserves_candidates_who_already_stood() {
        let mut o = office();
        o.day(40 * DAY, &[enrol("c1"), enrol("c2")]);
        let mut notice = st("rec.59", 40 * DAY + 100, "election_notice", "city", &[], json!({ "office": "mayor", "poll_at": POLL }));
        notice["in_position"] = json!("electoral");
        // Two candidates nominate BEFORE the delay.
        let mut n1 = st("rec.60", 45 * DAY, "nomination", "c1", &["city"], json!({ "office": "mayor", "name": "Ann" }));
        n1["author"] = json!("c1-self");
        let mut n2 = st("rec.61", 46 * DAY, "nomination", "c2", &["city"], json!({ "office": "mayor", "name": "Ben" }));
        n2["author"] = json!("c2-self");
        // Day 50: council delays first_poll_day from 100 to 130 while nominations are open.
        let delay = st("law-delay", 50 * DAY, "law", "city", &[], json!({
            "schedule": "schedule-elections",
            "figures": { "first_poll_day": { "value": 130, "unit": "days" } }
        }));
        // Day 51: office publishes a timetable update notice (NOT a second election_notice, so citizens do not redraw standing).
        let upd = o.day(51 * DAY, &[notice, n1, n2, delay]).join("\n");
        assert!(upd.contains("kind=notice") && upd.contains(&format!("\"poll_at\":{}", 130 * DAY)) && !upd.contains("kind=election_notice"), "{upd}");
        // Old close (day 70) stays quiet.
        assert!(o.day(70 * DAY, &[]).is_empty());
        // New close (day 100 = 130 - 30): BOTH pre-delay nominees appear on the eventual ballot!
        let ballot = o.day(100 * DAY, &[]).join("\n");
        assert!(ballot.contains("kind=ballot") && ballot.contains("c1-self") && ballot.contains("c2-self") && ballot.contains(&format!("\"closes_at\":{}", 130 * DAY)), "{ballot}");
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
