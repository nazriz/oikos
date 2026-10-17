//! body.payroll: a body's payroll officer, and the deputy who keeps the officer's post filled (ported from
//! participants/src/behaviour/payroll.ts, as built on branch `bugfix` (ab26ed7a): version 0.5.0; foundations F6;
//! docs/behaviour/staffing.md, "A body's own paperwork"). Every body of the town that employs people (the tribunal, the
//! bank, the union, the land registry, the water and energy bodies...) has a post whose holder, one of its staff, does
//! what any employer's payroll does: starts and stops the wages its staff are paid, files and pays over the tax withheld
//! on the law's days, and, when a member of its staff dies, hears of it as any employer does (the registry's entry, or
//! its bank's word at the next pay day), ends the employment on record and stops the wage. It is the same `Staffing`
//! every firm and the town's finance office runs; nothing about a body's payroll is special.
//!
//! A post whose holder has died is vacant (the kernel vacates a dead person's posts, and only a living holder of one of
//! an organisation's posts can appoint into another). The officer, and the deputy for the officer's own post, look at
//! the organisation's posts every few days (one look: who holds each), and where one is empty appoint one of the
//! organisation's living staff to it, as a body's head of administration fills a vacancy from its own staff. A body with
//! one member of staff has no one left to do it; the appointer is the authority a body's constitution names.
//!
//! Versions: 0.5.0 an owner's appointer (a firm's): where none of the staff is left, its owner fills a vacant post
//! themselves, wherever they live (params `owner`, `owner_participant`); 0.4.1 an appointer looks at each post it has
//! not seen vacant once in six rounds, on a round of the post's own (from its name), not by a turn kept in the holder's
//! memory, so a vacancy is found on the same round whatever else is watched; 0.4.0 an appointer that finds none of the
//! staff to second hires for the body; 0.3.0 an appointer; 0.2.0 deaf to news, on a round of its own.
//!
//! Changes made in the port:
//! - **A dead person is never kept on the payroll.** "A shop whose only post-holder dies has nobody to stop the dead
//!   man's wages" (docs/testing.md): with the payroll post vacant, nobody ran `Staffing`, and a standing order went on
//!   paying a dead man's account for months. An owner's appointer now does that one part of the officer's work while a
//!   post it watches stands vacant (`Staffing::stop_the_dead`: the bank's word of a payee who has died and the
//!   registry's entry are read, their wages stopped and the employment ended on record), and a dead owner is never
//!   appointed to a post. Basis: a payer stops a wage on the death of the payee when it learns of it (docs/behaviour/
//!   deaths.md), and an estate, not the dead person, is paid what is owed.
//! - The first wake is the day the module begins (0): the TS drew its first wake from `ctx.rng("first-wake")`, which
//!   a Rust kind cannot draw before it exists. The round's day-of-three is drawn at the first wake from
//!   `cx.chance("payroll-round-<participant>")` (a fact about the participant, not about when it is asked) and the
//!   module does nothing until its day: the same moments of work, one idle wake earlier.
//! - Lane-wide faults met on the way, fixed in the lane's modules: the latest law and the applications in hand were
//!   ordered by comparing record ids as strings (`rec.10` before `rec.9`): they are ordered by filing now
//!   (`filed_before`, `tax::latest_law`); a support payment on a share of previous pay divided in floating point and
//!   multiplied back (`rules::support::decide` is exact); a returns day in a world with a calendar was a 30-day month
//!   (`rules::returns::next_return_civil` gives the calendar's). Kept as the TS has it, and worth a look at integration:
//!   a post still vacant at the next look is appointed into again (the memory of what was appointed is keyed by the look's
//!   time), which is harmless where the first appointment worked and a retry where it did not.
//! - Memory is plain data (the book, the staff, the posts appointed into): `Kind::restore` gives back an actor that
//!   steps exactly as the saved one would.

use super::staffing::{Own, Staffing, StaffingOpts, Want};
use crate::common::{look_up, own_account, Asked, Book, LOOKS_MAX};
use crate::steps::{arg, because, call, Done, Plan, Step, Stepper};
use crate::{Actor, Ctx, Cx, Kind, Picture, DAY};
use oikos_sight::{LookRequest, OutcomeStatus};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// How often the officers look at the organisation's posts (seconds): a post empty is filled within a few days.
const LOOK_EVERY: i64 = 3 * DAY;
/// The rounds in which an appointer has looked at every post it watches that it has not seen vacant.
const WATCH_ROUNDS: i64 = 6;
/// The three-day round the payroll keeps.
const ROUND: i64 = 3 * DAY;

/// The round, of `WATCH_ROUNDS`, on which a post is looked at: from its name alone (FNV-1a over its bytes).
fn slot_of(post: &str) -> i64 {
    let mut h: u32 = 2_166_136_261;
    for b in post.bytes() {
        h = (h ^ u32::from(b)).wrapping_mul(16_777_619);
    }
    i64::from(h) % WATCH_ROUNDS
}

pub struct Payroll;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Part {
    /// The officer runs the payroll.
    Officer,
    /// The deputy keeps the officer's post filled.
    Deputy,
    /// The authority a body's constitution names, which fills a post of that body when none of its own staff is left to.
    Appointer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    part: Part,
    after_days: i64,
    watch: Vec<String>,
    who: String,
    wage: i64,
    own: Vec<String>,
    owner: String,
    owner_participant: String,
    /// An appointer that recruits: the workplace it hires into, and the office that pays.
    workplace: String,
    payroll_office: String,
    staff_line: String,
    industry: String,
    role: String,
    period: i64,
    notice_days: i64,
}

impl Params {
    fn read(ctx: &Ctx) -> Result<Params, String> {
        let part = match ctx.param::<String>("part", "officer".into())?.as_str() {
            "officer" => Part::Officer,
            "deputy" => Part::Deputy,
            "appointer" => Part::Appointer,
            other => return Err(format!("body.payroll: part must be officer, deputy or appointer, not {other}")),
        };
        Ok(Params {
            part,
            after_days: ctx.param("after_days", 14)?,
            watch: ctx.param("watch", vec![])?,
            who: ctx.param("who", "who".to_string())?,
            wage: ctx.param("wage", 0)?,
            own: ctx.param("own", vec![])?,
            owner: ctx.param("owner", String::new())?,
            owner_participant: ctx.param("owner_participant", String::new())?,
            workplace: ctx.param("workplace", String::new())?,
            payroll_office: ctx.param("payroll_office", String::new())?,
            staff_line: ctx.param("staff_line", String::new())?,
            industry: ctx.param("industry", String::new())?,
            role: ctx.param("role", String::new())?,
            period: ctx.param("period", 14 * DAY)?,
            notice_days: ctx.param("notice_days", 14)?,
        })
    }
}

fn param_entry(schema: Value, default: Value, unit: Option<&str>, source: &str) -> Value {
    let mut m = json!({ "schema": schema, "default": default, "source": source });
    if let Some(u) = unit {
        m["unit"] = json!(u);
    }
    m
}

impl Kind for Payroll {
    fn name(&self) -> &'static str {
        "body.payroll"
    }
    fn version(&self) -> &'static str {
        "0.5.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/staffing.md"
    }
    fn manifest(&self) -> Value {
        let ph = "placeholder";
        let role = "when the organisation's own module employs others (the clinic's doctors), the role of the staff this payroll pays: absent, all of the organisation's";
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "perceives": [], "state": "none",
            "params": {
                "after_days": param_entry(json!({ "type": "integer", "description": "an appointer: how long a post has stood vacant before the authority fills it (the body's own deputy has its few days first)" }), json!(14), Some("days"), ph),
                "industry": param_entry(json!({ "type": "string" }), json!(""), None, ph),
                "notice_days": param_entry(json!({ "type": "integer" }), json!(14), Some("days"), ph),
                "own": param_entry(json!({ "type": "array", "description": "an appointer: the posts of its own body (no deputy keeps them filled, so it need not wait for one)" }), json!([]), None, ph),
                "owner": param_entry(json!({ "type": "string", "description": "an owner's appointer (a firm's): the owner, who fills a post themselves where none of the staff is left, wherever they live" }), json!(""), None, ph),
                "owner_participant": param_entry(json!({ "type": "string" }), json!(""), None, ph),
                "part": param_entry(json!({ "type": "string", "description": "the officer runs the payroll; the deputy keeps the officer's post filled; the appointer is the authority a body's constitution names, which fills a post of that body when none of its own staff is left to" }), json!("officer"), None, ph),
                "payroll_office": param_entry(json!({ "type": "string" }), json!(""), None, ph),
                "period": param_entry(json!({ "type": "integer" }), json!(1_209_600), None, ph),
                "role": param_entry(json!({ "type": "string", "description": role }), json!(""), None, role),
                "staff_line": param_entry(json!({ "type": "string" }), json!(""), None, ph),
                "wage": param_entry(json!({ "type": "integer" }), json!(0), None, ph),
                "watch": param_entry(json!({ "type": "array", "description": "the organisation's posts a person holds, which this post keeps filled" }), json!([]), None, ph),
                "who": param_entry(json!({ "type": "string", "description": "its channel onto who's who" }), json!("who"), None, ph),
                "workplace": param_entry(json!({ "type": "string" }), json!(""), None, ph),
            },
            "answers": {
                "office": "the payroll office",
                "acts": "What it acts on: the employment agreements of its organisation's staff and the standing payments that pay them; the tax withheld from wages, paid over on the law's days; and a member of staff who has died."
            },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        ROUND
    }
    fn deaf(&self) -> bool {
        true
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params::read(ctx)?;
        let appoints_and_hires = p.part == Part::Appointer && !p.workplace.is_empty();
        let mut opts = StaffingOpts::new(p.period, p.notice_days, if p.role.is_empty() { "staff" } else { &p.role });
        opts.hire = appoints_and_hires;
        opts.pay = p.part == Part::Officer;
        if !p.role.is_empty() {
            opts.own = Some(Own::Role);
        }
        if appoints_and_hires {
            opts.workplace = Some(p.workplace.clone());
            opts.industry = Some(p.industry.clone()).filter(|i| !i.is_empty());
            if !p.payroll_office.is_empty() {
                opts.payroll = Some(p.payroll_office.clone());
                opts.line = Some(p.staff_line.clone());
            }
        }
        opts.wakes = Some(ROUND);
        let staffing = Staffing::new(&ctx.entity, opts);
        Ok(Box::new(Stepper::new(Office {
            me: ctx.entity.clone(),
            participant: ctx.participant.clone(),
            p,
            book: Book::new(),
            asked: Asked::default(),
            staffing,
            filled: BTreeSet::new(),
            vacant_since: BTreeMap::new(),
            gone: BTreeSet::new(),
            phase: None,
            ran_round: -1,
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Office>::restore(saved)?))
    }
}

/// What follows from a step: a post we appointed someone to, refused (they have died too, and nobody told us).
#[derive(Debug, Clone, Serialize, Deserialize)]
enum Then {
    Appointed(String),
}

#[derive(Serialize, Deserialize)]
struct Office {
    me: String,
    participant: String,
    p: Params,
    book: Book,
    asked: Asked,
    staffing: Staffing,
    /// Posts we have appointed into, once (by the post and when we last looked).
    filled: BTreeSet<String>,
    /// An appointer: a post -> when we first saw it vacant.
    vacant_since: BTreeMap<String, i64>,
    /// Staff we found had died when we tried to appoint them (nobody is told us by the registry).
    gone: BTreeSet<String>,
    /// The day, of three, this payroll's round falls on (drawn at its first wake).
    phase: Option<i64>,
    ran_round: i64,
}

impl Office {
    fn phase(&self) -> i64 {
        self.phase.unwrap_or(0)
    }
    fn round_of(&self, t: i64) -> i64 {
        (t - self.phase()).div_euclid(ROUND)
    }
    /// The round is the payroll's own: every few days on a day of its own, whatever else wakes it. It acts at the first
    /// wake at or after each of its days, whatever woke it, so it acts at the same moments with or without papers.
    fn on_round(&self, t: i64) -> bool {
        self.round_of(t) > self.ran_round
    }
    /// The people of the organisation's staff we may appoint: those in force and not known to have died.
    fn living(&self, t: i64) -> Vec<String> {
        let dead: BTreeSet<String> = self.staffing.known_dead(&self.book, t).into_iter().collect();
        self.staffing
            .workers(&self.book, t)
            .into_iter()
            .filter(|w| !dead.contains(w) && !self.staffing.told_dead(&self.book, w) && !self.gone.contains(w))
            .collect()
    }
    fn waits(&self, post: &str) -> i64 {
        // (a body's own posts have no deputy to give a few days to)
        if self.p.own.iter().any(|o| o == post) {
            0
        } else {
            self.p.after_days * DAY
        }
    }
    fn vacant(&self, post: &str) -> bool {
        self.book.position(post).is_some_and(|p| p.holder.is_none())
    }
    fn participant_of(&self, person: &str) -> Option<String> {
        if !self.p.owner.is_empty() && person == self.p.owner && !self.p.owner_participant.is_empty() {
            return Some(self.p.owner_participant.clone());
        }
        self.book.participant_of(person).map(String::from)
    }
}

impl Plan for Office {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, cx: &mut Cx) {
        if self.phase.is_none() {
            self.phase = Some(cx.chance(&format!("payroll-round-{}", self.participant)).below(3) as i64 * DAY);
        }
        self.book.absorb(pic);
        self.staffing.absorb(pic);
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let t = pic.t;
        if !self.on_round(t) {
            return vec![];
        }
        self.ran_round = self.round_of(t);
        let mut steps: Vec<Step<Then>> = vec![];
        if self.p.part == Part::Officer {
            if let Some(acc) = own_account(pic) {
                steps.extend(self.staffing.routine(pic, &self.book, cx, &acc.account, &Want { target: 0, wage: 0, can_post: false, ..Default::default() }));
            }
        }
        // An appointer keeps the vacancies it has seen: a post seen full is forgotten, one seen vacant is dated.
        if self.p.part == Part::Appointer {
            for post in &self.p.watch {
                if self.book.position(post).is_some() {
                    if self.book.position(post).is_some_and(|p| p.holder.is_none()) {
                        self.vacant_since.entry(post.clone()).or_insert(t);
                    } else {
                        self.vacant_since.remove(post);
                    }
                }
            }
        }
        // A firm's owner's appointer does the one part of the officer's work that keeps a dead man off the payroll while
        // a post it watches stands vacant: nobody else is there to (docs/testing.md: the shop whose only post-holder dies).
        if self.p.part == Part::Appointer && !self.p.owner.is_empty() && self.p.watch.iter().any(|post| self.vacant(post)) {
            steps.extend(self.staffing.stop_the_dead(pic, &self.book));
        }
        // A vacant post of the organisation's: one of its living staff takes it. Where none of the staff is left, the
        // owner themselves: an owner keeps the business and its posts wherever they live, and hiring for it is the
        // owner's to do next. (A dead owner is not appointed to anything.)
        let staff_left = self.living(t);
        let owner_ok = !self.p.owner.is_empty() && !self.gone.contains(&self.p.owner) && !self.staffing.told_dead(&self.book, &self.p.owner);
        let candidates: Vec<String> = if !staff_left.is_empty() || !owner_ok { staff_left } else { vec![self.p.owner.clone()] };
        // An appointer where none of the staff is left to second: it hires for the body, through the ordinary hiring (a
        // posting, an applicant, an agreement, a wage as the body's staff are paid), and seconds whoever is hired at the
        // next round.
        if self.p.part == Part::Appointer && !self.p.workplace.is_empty() && candidates.is_empty() {
            let stale: Vec<&String> = self.p.watch.iter().filter(|post| self.vacant(post) && t - self.vacant_since.get(*post).copied().unwrap_or(t) >= self.waits(post)).collect();
            if !stale.is_empty() {
                let (them, it) = if stale.len() == 1 { ("it", "s") } else { ("them", "") };
                let names = stale.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ");
                let target = self.staffing.workers(&self.book, t).len() as i64 + 1;
                let why = format!("{names} stand{it} vacant and none of our staff is left to fill {them}: posting a job, to fill {them} from whoever is hired.");
                steps.extend(self.staffing.routine(pic, &self.book, cx, "", &Want { target, wage: self.p.wage, can_post: true, why: Some(why), ..Default::default() }));
            }
        }
        let posts_asked = self.asked.since("posts");
        for post in self.p.watch.clone() {
            if !self.vacant(&post) || self.filled.contains(&format!("{post}@{posts_asked}")) || candidates.is_empty() {
                continue;
            }
            // (The authority acts only on a post that has stood vacant: its body's own deputy fills one from its staff within days.)
            let since = self.vacant_since.get(&post).copied().unwrap_or(t);
            if self.p.part == Part::Appointer && t - since < self.waits(&post) {
                continue;
            }
            let choice = candidates[cx.rng(&format!("succeed-{post}-{}", t.div_euclid(DAY))).below(candidates.len() as u64) as usize].clone();
            let Some(participant) = self.participant_of(&choice) else { continue };
            self.filled.insert(format!("{post}@{posts_asked}"));
            let why = if self.p.part == Part::Appointer {
                format!("The {post} post has stood vacant for {} days and nobody of its body is left to fill it: as the authority that fills it, seconding {choice}, of our staff, to it.", (t - since).div_euclid(DAY))
            } else {
                format!("The {post} post of ours is empty (its holder has died or gone): appointing {choice}, of our staff, to it.")
            };
            // (Refused because they have died too, and nobody told us: they are not asked again, and the next look names another.)
            let mut step = because(why, vec![call("position", vec![("appoint", Some(arg(&post))), ("to", Some(arg(&participant)))])]);
            step.then = Some(Then::Appointed(choice));
            steps.push(step);
        }
        steps
    }

    fn until(&self, pic: &Picture) -> Option<i64> {
        let phase = self.phase();
        Some(phase + ((pic.t - phase).div_euclid(ROUND) + 1) * ROUND)
    }

    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        let t = pic.t;
        if self.p.who.is_empty() || !self.on_round(t) {
            return vec![];
        }
        let who = self.p.who.clone();
        let mut out: Vec<LookRequest> = vec![];
        // Every few days: who holds each of the posts we keep filled.
        if !self.p.watch.is_empty() && (self.asked.since("posts") < 0 || t - self.asked.since("posts") >= LOOK_EVERY) {
            self.asked.again("posts", t);
            if self.p.part == Part::Appointer {
                // (Those seen vacant are looked at every round; the rest take turns: each is looked at once in
                // WATCH_ROUNDS rounds, on a round of its own, never of where it stands in a list or how many looks this
                // holder has made. So a town with one more post watched, or a post that changed hands, finds a vacancy
                // on the same round as the town without.)
                let suspects: Vec<&String> = self.p.watch.iter().filter(|p| self.vacant_since.contains_key(*p)).take(LOOKS_MAX).collect();
                let room = LOOKS_MAX.saturating_sub(suspects.len());
                let round = self.round_of(t);
                let mut due: Vec<&String> = self.p.watch.iter().filter(|p| !self.vacant_since.contains_key(*p) && (round + slot_of(p)).rem_euclid(WATCH_ROUNDS) == 0).collect();
                due.sort();
                for post in suspects.into_iter().chain(due.into_iter().take(room)) {
                    out.push(look_up::position(&who, post));
                }
                return out;
            }
            for post in self.p.watch.iter().take(LOOKS_MAX) {
                out.push(look_up::position(&who, post));
            }
            return out;
        }
        // And, where one is empty, who of the staff could take it (their participants).
        if self.p.watch.iter().any(|p| self.vacant(p)) {
            for person in self.living(t) {
                if out.len() < LOOKS_MAX && self.participant_of(&person).is_none() && self.asked.first(&format!("person:{person}"), t) {
                    out.push(look_up::entity(&who, &person));
                }
            }
        }
        out
    }

    fn then(&mut self, token: &Then, done: Done, _cx: &mut Cx) -> Vec<Step<Then>> {
        let Then::Appointed(choice) = token;
        if let Done::Outcome(o) = done {
            if o.status == OutcomeStatus::Refused {
                self.gone.insert(choice.clone());
            }
        }
        vec![]
    }
}

pub static PAYROLL: Payroll = Payroll;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::firms::testkit::*;
    use oikos_sight::calls::Call;
    use std::collections::BTreeMap as Map;

    fn ctx_with(part: &str, extra: Value) -> Ctx {
        let mut c = ctx("firm-payroll-system", "firm");
        let mut params = serde_json::Map::new();
        params.insert("part".into(), json!(part));
        params.insert("watch".into(), json!(["firm-office"]));
        params.insert("after_days".into(), json!(14));
        if let Value::Object(m) = extra {
            params.extend(m);
        }
        c.params = params;
        c
    }

    /// Wake the payroll every day for `days`, the directory showing the office post vacant (or held), the registry as
    /// given; every program it sends, with the day.
    fn run(c: &Ctx, days: i64, records: &dyn Fn(i64) -> Vec<std::sync::Arc<oikos_sight::Record>>, holder: Option<&str>) -> Vec<(i64, Call)> {
        let mut actor = Payroll.create(c).unwrap();
        let mut out = vec![];
        let mut taken_down: Vec<std::sync::Arc<oikos_sight::Record>> = vec![];
        for day in 0..days {
            let t = day * DAY + 3600;
            // (What it withdrew comes back to it as the world would show it: a withdrawal on the record.)
            let mut shown = records(day);
            shown.append(&mut taken_down);
            let pic = with_directory(picture(t, "firm", shown, &[("acc-firm", "firm", 900_000_000)], vec![]), &[("firm-office", "firm", holder)], &[("owner-1", "person", Some("owner-1-self"))]);
            let (programs, _, _) = drive(actor.as_mut(), &pic, c);
            for call in calls_of(&programs) {
                if let (true, Some(id)) = (call.fn_ == "statement", argv(&call, "withdraw").as_str()) {
                    taken_down.push(rec(json!({ "id": format!("w-{id}"), "record": "withdrawal", "author": "p.1", "at": t, "visible_to": "public", "withdraws": id })));
                }
                out.push((day, call));
            }
        }
        out
    }
    fn appointments(out: &[(i64, Call)]) -> Vec<(i64, Value, Value)> {
        out.iter().filter(|(_, c)| c.fn_ == "position").map(|(d, c)| (*d, argv(c, "appoint"), argv(c, "to"))).collect()
    }

    #[test]
    fn the_kind_is_the_ts_module_at_the_bugfix_version() {
        let m = Payroll.manifest();
        assert_eq!((m["name"].as_str(), m["version"].as_str(), m["doc"].as_str()), (Some("body.payroll"), Some("0.5.0"), Some("docs/behaviour/staffing.md")));
        assert!(m["params"]["owner"].is_object() && m["params"]["owner_participant"].is_object());
        assert_eq!(Payroll.cadence(&ctx("x", "y")), 3 * DAY);
        assert!(Payroll.deaf());
        assert_eq!(slot_of("a"), 4, "FNV-1a of one byte, modulo six rounds");
    }

    #[test]
    fn an_owners_appointer_fills_a_vacant_post_with_the_owner_where_none_of_the_staff_is_left_after_the_wait() {
        let c = ctx_with("appointer", json!({ "owner": "owner-1", "owner_participant": "owner-1-self" }));
        let out = run(&c, 40, &|_| vec![], None);
        let a = appointments(&out);
        assert!(!a.is_empty(), "the owner is seconded to the vacant post");
        assert_eq!((a[0].1.clone(), a[0].2.clone()), (json!("firm-office"), json!("owner-1-self")));
        // Not before the post has stood vacant the wait out (14 days, from the round it was first seen).
        assert!(a[0].0 >= 14, "first on day {}", a[0].0);
        assert!(a[0].0 <= 14 + 6, "and soon after: day {}", a[0].0);
        // A post that is held is not appointed into.
        assert!(appointments(&run(&c, 40, &|_| vec![], Some("someone"))).is_empty());
    }

    #[test]
    fn a_dead_owner_is_never_appointed_and_a_departed_one_still_is() {
        let c = ctx_with("appointer", json!({ "owner": "owner-1", "owner_participant": "owner-1-self" }));
        let dead = |_: i64| vec![statement("death-1", 0, "death_registration", json!({ "deceased": "owner-1" }), "city")];
        assert!(appointments(&run(&c, 40, &dead, None)).is_empty(), "nobody dead is put in a post");
    }

    /// A shop with one worker on a standing order, the worker dead.
    fn shop_records(day: i64, dead: bool) -> Vec<std::sync::Arc<oikos_sight::Record>> {
        if day > 0 {
            return if dead { vec![statement("death-1", day * DAY, "death_registration", json!({ "deceased": "w" }), "city")] } else { vec![] };
        }
        let a = employment("J1", 0, "firm", "w", 100_000, 14 * DAY, "genesis", None);
        let order = statement("ord-1", 0, "request", json!({ "every": 14 * DAY, "outcome": { "money": { "to": "acc-w", "amount": "100000", "for": "wages" } } }), "firm");
        let mut order = order.as_ref().clone();
        order.basis = Some(serde_json::from_value(json!("J1")).unwrap());
        let mut r = vec![a.clone(), std::sync::Arc::new(order)];
        r.extend(signatures(&a, 0));
        r
    }

    #[test]
    fn a_shop_whose_only_post_holder_died_does_not_go_on_paying_the_dead_man_s_wages() {
        // The payroll post is vacant; the owner's appointer is the only one acting for the firm.
        let c = ctx_with("appointer", json!({ "owner": "owner-1", "owner_participant": "owner-1-self" }));
        let out = run(&c, 30, &|d| shop_records(d, true), None);
        let stopped: Vec<_> = out.iter().filter(|(_, c)| c.fn_ == "statement" && argv(c, "withdraw") == json!("ord-1")).collect();
        assert_eq!(stopped.len(), 1, "the standing order that pays the dead man is withdrawn, once");
        assert!(out.iter().any(|(_, c)| c.fn_ == "agreement" && argv(c, "notice") == json!("J1")), "and the employment ended on record");
        // While the post is held (an officer is there), the appointer leaves the payroll to the officer.
        let held = run(&c, 30, &|d| shop_records(d, true), Some("officer-1"));
        assert!(held.iter().all(|(_, c)| argv(c, "withdraw") != json!("ord-1")));
        // Nobody dead: the order stands.
        let alive = run(&c, 30, &|d| shop_records(d, false), None);
        assert!(alive.iter().all(|(_, c)| argv(c, "withdraw") != json!("ord-1")));
    }

    #[test]
    fn an_officer_runs_the_payroll_and_stops_a_dead_workers_wages_on_the_registrys_entry() {
        let c = ctx_with("officer", json!({}));
        let out = run(&c, 30, &|d| shop_records(d, true), Some("officer-1"));
        assert_eq!(out.iter().filter(|(_, c)| c.fn_ == "statement" && argv(c, "withdraw") == json!("ord-1")).count(), 1);
        // A deputy does not run the payroll: it only keeps the officer's post filled.
        let dep = ctx_with("deputy", json!({}));
        assert!(run(&dep, 30, &|d| shop_records(d, true), Some("officer-1")).iter().all(|(_, c)| c.fn_ != "agreement"));
    }

    #[test]
    fn a_deputy_appoints_one_of_the_living_staff_to_an_empty_post_and_not_a_dead_one() {
        // Two on the staff, one dead: the living one is appointed; their participant is looked up first.
        let c = ctx_with("deputy", json!({}));
        let mut staff_records = |d: i64| {
            if d > 0 {
                return vec![statement("death-1", d * DAY, "death_registration", json!({ "deceased": "dead-one" }), "city")];
            }
            let mut r = vec![];
            for w in ["dead-one", "alive-one"] {
                let a = employment(&format!("J-{w}"), 0, "firm", w, 100_000, 14 * DAY, "genesis", None);
                r.extend(signatures(&a, 0));
                r.insert(0, a);
            }
            r
        };
        let mut actor = Payroll.create(&c).unwrap();
        let mut found: Vec<(i64, Value, Value)> = vec![];
        let mut looked: Vec<String> = vec![];
        for day in 0..12 {
            let t = day * DAY + 3600;
            let pic = with_directory(
                picture(t, "firm", staff_records(day), &[("acc-firm", "firm", 900_000_000)], vec![]),
                &[("firm-office", "firm", None)],
                &[("alive-one", "person", Some("alive-one-self")), ("dead-one", "person", Some("dead-one-self"))],
            );
            let (programs, looks, _) = drive(actor.as_mut(), &pic, &c);
            looked.extend(looks.iter().map(|l| l.channel.clone()));
            found.extend(appointments(&calls_of(&programs).into_iter().map(|c| (day, c)).collect::<Vec<_>>()));
        }
        assert!(!found.is_empty());
        assert!(found.iter().all(|f| f.2 == json!("alive-one-self")), "{found:?}");
        assert!(looked.iter().all(|c| c == "who"), "it looks through the who's-who channel");
    }

    #[test]
    fn the_payroll_saves_and_restores_and_steps_the_same() {
        let c = ctx_with("appointer", json!({ "owner": "owner-1", "owner_participant": "owner-1-self" }));
        let mut a = Payroll.create(&c).unwrap();
        let mut programs = Map::new();
        for day in 0..20 {
            let t = day * DAY + 3600;
            let pic = with_directory(picture(t, "firm", vec![], &[("acc-firm", "firm", 900_000_000)], vec![]), &[("firm-office", "firm", None)], &[]);
            let (p, _, _) = drive(a.as_mut(), &pic, &c);
            programs.insert(day, p.len());
        }
        let saved = a.save().unwrap();
        let mut b = Payroll.restore(&c, saved.clone()).unwrap();
        assert_eq!(b.save().unwrap(), saved);
        for day in 20..40 {
            let t = day * DAY + 3600;
            let pic = with_directory(picture(t, "firm", vec![], &[("acc-firm", "firm", 900_000_000)], vec![]), &[("firm-office", "firm", None)], &[]);
            assert_eq!(drive(a.as_mut(), &pic, &c), drive(b.as_mut(), &pic, &c));
        }
    }
}
