//! city.planning_officer and city.inspector, ported from participants/src/behaviour/institutions.ts (lines 1-320:
//! `planningOfficer` 0.11.0, `inspector` 0.7.0; docs/behaviour/institutions.md). The manifests keep the TS version
//! strings (the guide requires manifest equality); the Rust rewrite is "ported to Rust" here only.
//!
//! Where the Rust decides fresh (docs/port-guide.md, section 2):
//! - **Memory is the file.** What an office has decided, noticed, inspected or valued is read from the records of its own
//!   position (`ours`), so a successor in the post carries on and repeats nothing (bug hunt 2026-10-17, finding 2). The
//!   few caches kept (`cache`, `judged`, `in_hand`, `sites_seen`, `asked`) are for what the file does not yet show (an
//!   act applied whose record has not come back), or for what no paper records (what a visit found); each is said.
//! - **A stage moves on only when its act is applied** (`then` hears the outcome), never on sending it.
//! - **PB-15, planning grants by default and hears nobody.** Where the world states a planning procedure (a `procedure`
//!   record whose data carries `planning: { notice_days, objection_days?, decide_within_days? }`), an application is
//!   noticed in public first; objections made in the objection period are heard (named in the decision, which goes to
//!   the objectors too); the decision comes after the period, and one made after `decide_within_days` says it is late.
//!   With no procedure stated, it decides at once, as before. The figures are the profile's (docs/behaviour/
//!   institutions.md gives real ones and their sources).
//! - **PB-16, compliance is a coin flip.** `compliance_bps` and `direction_compliance_bps` are no longer a draw per case.
//!   An office breaches a law only for a cause: it cannot read the law against the act (counted and said, `noted`), or
//!   it has not the means to look into everything that came (`compliance_bps` is now the share of the waiting cases its
//!   staff can look into in a round, oldest first, at least one; the rest wait for the next round and, if a time limit
//!   is stated, are late). A standing direction from a post the rule names is followed (its cause of not being followed
//!   is lack of authority or a hold, both on file); `direction_compliance_bps` is accepted and unused.
//!
//! Stand-in for lane D's decisions.ts `Reconsiderations`: `Recon` below (a refusal looked at again when asked inside
//! the days the law gives); integration replaces.

use crate::common::asking::Register;
use crate::common::{
    addressed_to, ask, breaches, data, filed_before, go_see, holds_of, is_kind, lot_of, made_at, money_words, noted, owner_looks, prohibitions, record, visited,
    Asked, Book, ClaimKey, Directions, Fields, Letters, DAY, VISIT_MAX,
};
use crate::offices::land::{own_land, owner_of};
use crate::papers::{self, offices as po};
use crate::steps::{because, say, Done, Plan, Say, Step, Stepper, Visible};
use crate::{Action, Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms::{self, AnswerForm, Answers};
use oikos_sight::{LookRequest, Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Planning: stale after this long, a step planned but never heard of again is planned afresh.
const STALE: i64 = 4 * DAY;

/// Whose a record is: made in this position (or, with none, by this participant).
fn ours(position: &Option<String>, participant: &str, r: &Record) -> bool {
    match position {
        Some(p) => r.position.as_ref() == Some(p),
        None => r.author == participant,
    }
}

/// An actor whose book is noted (common.ts `noting`): what its law readings could not read is said with its next act.
trait Booked: Plan {
    fn book_mut(&mut self) -> &mut Book;
}
struct Noting<P: Booked>(Stepper<P>);
impl<P: Booked> Actor for Noting<P> {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        let a = self.0.step(pic, cx);
        noted(self.0.plan.book_mut(), a)
    }
    fn sent(&mut self, action: &str) {
        self.0.sent(action)
    }
    fn save(&self) -> Result<Value, String> {
        self.0.save()
    }
}
fn restore<P: Booked + 'static>(saved: Value) -> Result<Box<dyn Actor>, String> {
    Ok(Box::new(Noting(Stepper::<P>::restore(saved)?)))
}

// ================================================================== the planning officer

pub struct PlanningOfficer;

fn planning_answers() -> Answers {
    Answers {
        office: "the planning office".into(),
        acts: "What it acts on: an application for a planning permit on the permit form (permit_application), which it decides under the planning law.".into(),
        forms: vec![AnswerForm {
            about: ["permit", "build", "applic", "develop"].map(String::from).to_vec(),
            say: "An application to build goes on the permit form (permit_application), naming the lot and the kind of building.".into(),
        }],
        report: true,
    }
}

impl Kind for PlanningOfficer {
    fn name(&self) -> &'static str {
        "city.planning_officer"
    }
    fn version(&self) -> &'static str {
        "0.11.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/institutions.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "compliance_bps": { "schema": { "type": "integer" }, "unit": "bps", "default": 10000, "source": "placeholder" },
                "habitat_law": { "schema": { "type": "string" }, "default": "", "source": "placeholder" },
                "part": { "schema": {}, "source": "the world gives it (no default)" },
                "town": { "schema": { "type": "string" }, "default": "e", "source": "placeholder" },
            },
            "perceives": [], "state": "none",
            "issues": forms::group("PLANNING"),
            "answers": planning_answers(),
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        7 * DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let plan = Office {
            me: ctx.entity.clone(),
            participant: ctx.participant.clone(),
            position: ctx.position.clone(),
            compliance_bps: ctx.param("compliance_bps", 10_000)?,
            town: ctx.param("town", ctx.entity.clone())?,
            habitat_law: ctx.param("habitat_law", String::new())?,
            book: Book::new(),
            letters: Letters::default(),
            cache: BTreeMap::new(),
            noticed: BTreeMap::new(),
            in_hand: BTreeMap::new(),
            reviewed: BTreeSet::new(),
        };
        Ok(Box::new(Noting(Stepper::new(plan))))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore::<Office>(saved)
    }
}

/// The planning procedure the world states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Rules {
    notice_days: i64,
    objection_days: i64,
    decide_within_days: Option<i64>,
}

/// The latest standing `procedure` whose data carries `planning`.
fn planning_rules(book: &Book) -> Option<Rules> {
    let mut best: Option<&Arc<Record>> = None;
    for p in book.open("procedure") {
        if data(p).get("planning").is_some_and(Value::is_object) && best.is_none_or(|b| p.at > b.at || (p.at == b.at && filed_before(&b.id, &p.id).is_lt())) {
            best = Some(p);
        }
    }
    let pl = data(best?).get("planning")?;
    let notice_days = pl.i("notice_days").unwrap_or(0).max(0);
    Some(Rules {
        notice_days,
        objection_days: pl.i("objection_days").unwrap_or(notice_days).max(0),
        decide_within_days: pl.i("decide_within_days").filter(|d| *d > 0),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum PThen {
    Decided { app: String, decision: String, law: Option<String> },
    Noticed { app: String },
    Reviewed { request: String },
}

#[derive(Serialize, Deserialize)]
struct Office {
    me: String,
    participant: String,
    position: Option<String>,
    compliance_bps: i64,
    town: String,
    habitat_law: String,
    book: Book,
    letters: Letters,
    /// Decisions made whose records the book does not show yet (a cache of the file): application -> (decision, law).
    cache: BTreeMap<String, (String, Option<String>)>,
    /// Notices given whose records the book does not show yet: application -> when.
    noticed: BTreeMap<String, i64>,
    /// Steps planned and not yet heard of (kept from being planned twice): key -> when.
    in_hand: BTreeMap<String, i64>,
    /// Requests to look at a decision again answered this round, not yet on the file.
    reviewed: BTreeSet<String>,
}

impl Booked for Office {
    fn book_mut(&mut self) -> &mut Book {
        &mut self.book
    }
}

impl Office {
    fn ours(&self, r: &Record) -> bool {
        ours(&self.position, &self.participant, r)
    }

    /// Its decisions as the file has them (the latest for each application), with the cache for what has not come back.
    fn decisions(&self) -> BTreeMap<String, (String, Option<String>)> {
        let mut mine: Vec<&Arc<Record>> = self.book.open("permit_decision").filter(|r| self.ours(r)).collect();
        mine.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
        let mut out = self.cache.clone();
        for r in mine {
            let d = data(r);
            if let (Some(app), Some(dec)) = (d.s("application"), d.s("decision")) {
                out.insert(app.to_string(), (dec.to_string(), d.s("law").map(String::from)));
            }
        }
        out
    }

    /// When its public notice of an application went on the record.
    fn notice_at(&self, app: &str) -> Option<i64> {
        self.book
            .open("permit_notice")
            .filter(|r| self.ours(r) && data(r).s("application") == Some(app))
            .map(|r| r.at)
            .min()
            .or_else(|| self.noticed.get(app).copied())
    }

    /// The law an application would breach, if any: a prohibition the act of granting is true of, or the habitat law
    /// where the latest habitat register lists the lot.
    fn breach(&mut self, applicant: &str, lot: &str, structure_type: &str, t: i64) -> Option<String> {
        let granting = json!({ "block": "grant_permit", "lot": lot, "structure_type": structure_type });
        let habitat = if self.habitat_law.is_empty() { None } else { self.book.current(&self.habitat_law).cloned() };
        let on_habitat = habitat.is_some()
            && self.book.open("habitat_register").max_by_key(|r| r.at).is_some_and(|r| data(r).ids("lots").contains(&lot));
        let hit = breaches(&mut self.book, &granting, applicant, t).first().map(|l| l.id.clone());
        hit.or_else(|| if on_habitat { habitat.map(|h| h.id.clone()) } else { None })
    }

    fn report(&self) -> String {
        let decided = self.decisions();
        let granted = decided.values().filter(|(d, _)| d == "granted").count();
        let refused: Vec<String> = decided.iter().filter(|(_, (d, _))| d == "refused").map(|(a, (_, l))| format!("{a} ({})", l.as_deref().unwrap_or("?"))).collect();
        let incomplete = decided.values().filter(|(d, _)| d == "incomplete").count();
        let town_lots = own_land(&self.book, &self.town);
        let vacant: Vec<&str> = town_lots.iter().filter(|x| x.structures.is_empty()).map(|x| x.lot.as_str()).collect();
        let land = if town_lots.is_empty() {
            String::new()
        } else {
            let list = if vacant.is_empty() {
                String::new()
            } else {
                format!(": {}{}", vacant.iter().take(40).copied().collect::<Vec<_>>().join(", "), if vacant.len() > 40 { format!(", and {} more", vacant.len() - 40) } else { String::new() })
            };
            format!(" By the town's asset register it owns {} lots; {} have nothing built on them{list}. (The register is paper: go and see a lot before relying on it.)", town_lots.len(), vacant.len())
        };
        let late = self.book.open("permit_decision").filter(|r| self.ours(r) && data(r).flag("late")).count();
        let procedure = match planning_rules(&self.book) {
            Some(r) if r.notice_days > 0 => format!(
                " Applications are noticed in public for {} days and objections made in that time are heard before they are decided{}.",
                r.notice_days,
                match r.decide_within_days {
                    Some(d) => format!("; the time to decide is {d} days, and {late} decisions were made after it"),
                    None => String::new(),
                }
            ),
            _ => String::new(),
        };
        format!(
            "Report from the planning office: {} applications decided: {granted} granted, {} refused{}{}.{land}{procedure} Apply on the permit application form (form-permit).",
            decided.len(),
            refused.len(),
            if refused.is_empty() { String::new() } else { format!(" ({})", refused.join(", ")) },
            if incomplete > 0 { format!(", {incomplete} sent back incomplete") } else { String::new() },
        )
    }

    /// The law's rule for a kind of decision (decisions.ts `decisionLaw`, for a decision with no payment): the review days.
    fn review_days(&self, kind: &str) -> Option<i64> {
        let mut best: Option<(i64, i64)> = None;
        for l in self.book.open("law") {
            let Some(list) = data(l).get("decisions").and_then(Value::as_array) else { continue };
            for d in list {
                if d.s("kind") != Some(kind) || d.get("payments").is_some() {
                    continue;
                }
                if best.is_none_or(|(at, _)| l.at > at) {
                    best = Some((l.at, d.get("review").and_then(|r| r.i("within_days")).unwrap_or(-1)));
                }
            }
        }
        best.map(|b| b.1).filter(|d| *d >= 0)
    }

    /// Asked to look at a refusal again (stand-in for decisions.ts `Reconsiderations`).
    fn recon(&mut self, t: i64) -> Vec<Step<PThen>> {
        let mut reqs: Vec<Arc<Record>> = self
            .book
            .open("review_request")
            .filter(|r| addressed_to(r).contains(&self.me))
            .cloned()
            .collect();
        reqs.sort_by(|a, b| made_at(a).cmp(&made_at(b)).then_with(|| filed_before(&a.id, &b.id)));
        let mut steps = vec![];
        let mut done_now: BTreeMap<String, bool> = BTreeMap::new();
        for r in reqs {
            let answered = self.book.open("remedy_answer").any(|a| self.ours(a) && data(a).s("request") == Some(&r.id));
            if answered || self.reviewed.contains(&r.id) {
                continue;
            }
            let Some(about) = data(&r).s("about").and_then(|a| self.book.get(a)).cloned() else { continue };
            if !(is_kind(&about, "permit_decision") && about.speaks_for.as_deref() == Some(self.me.as_str())) {
                continue;
            }
            let Some(within) = self.review_days("permit_decision") else { continue };
            self.reviewed.insert(r.id.clone());
            let Some(from) = r.speaks_for.clone() else { continue };
            let matter = data(&r).s("matter").unwrap_or("").to_string();
            let left = within - (t - about.at).div_euclid(DAY);
            let me = self.me.clone();
            let say2 = |granted: bool, outcome: &str, found: &str, text: &str, more: Vec<Step<PThen>>, steps: &mut Vec<Step<PThen>>, req: &Record| {
                let mut ans = json!({ "request": req.id, "matter": matter, "granted": granted, "review": outcome, "decision": about.id });
                if !granted {
                    ans["reason"] = json!(found);
                }
                let mut s = because(
                    format!("{from} asks us to look at our decision {} again: {found}.", about.id),
                    vec![
                        say(
                            "decision_review",
                            &format!("Review of {}, asked by {from}: {text}", about.id),
                            Say {
                                to: Some(vec![from.clone()]),
                                visible: Some(Visible::Only(vec![from.clone(), me.clone()])),
                                basis: Some(about.id.clone()),
                                data: Some(json!({ "decision": about.id, "kind": "permit_decision", "request": req.id, "outcome": outcome, "found": found, "asked_by": from, "decided_on": about.at })),
                                ..Default::default()
                            },
                        ),
                        say(
                            "remedy_answer",
                            &format!("Answer to your request {}: {}: {text}", req.id, if granted { "yes" } else { "no" }),
                            Say { to: Some(vec![from.clone()]), visible: Some(Visible::Only(vec![from.clone(), me.clone()])), basis: Some(req.id.clone()), data: Some(ans), ..Default::default() },
                        ),
                    ],
                );
                s.then = Some(PThen::Reviewed { request: req.id.clone() });
                steps.push(s);
                steps.extend(more);
            };
            if left < 0 {
                say2(
                    false,
                    "out_of_time",
                    &format!("the law allows {within} days to ask, and the decision was made {} days ago", (t - about.at).div_euclid(DAY)),
                    &format!("it was asked for after the {within} days the law allows."),
                    vec![],
                    &mut steps,
                    &r,
                );
                continue;
            }
            // (Looked at already: from the file, or from this round's.)
            let filed = self
                .book
                .all("decision_review")
                .filter(|x| self.ours(x) && data(x).s("decision") == Some(&about.id) && matches!(data(x).s("outcome"), Some("changed" | "upheld")))
                .max_by_key(|x| x.at)
                .map(|x| data(x).s("outcome") == Some("changed"));
            if let Some(first) = done_now.get(&about.id).copied().or(filed) {
                say2(first, if first { "changed" } else { "upheld" }, "it has been looked at already", if first { "it was found wrong and has been put right." } else { "it was looked at and stands." }, vec![], &mut steps, &r);
                continue;
            }
            let (changed, found, more) = self.second_look(&about, &r, t);
            done_now.insert(about.id.clone(), changed);
            let text = if changed { format!("found wrong: {found}; put right.") } else { format!("looked at again: {found}; it stands.") };
            say2(changed, if changed { "changed" } else { "upheld" }, &found, &text, more, &mut steps, &r);
        }
        steps
    }

    /// The law applied once more to a refused application as it stands, with the laws now in force (a review does not
    /// draw whether the office follows them).
    fn second_look(&mut self, dec: &Arc<Record>, req: &Record, t: i64) -> (bool, String, Vec<Step<PThen>>) {
        if data(dec).s("decision") != Some("refused") {
            return (false, "the permit was not refused".into(), vec![]);
        }
        let app = data(dec).s("application").and_then(|a| self.book.get(a)).cloned();
        let Some(app) = app.filter(|a| matches!(a.body, RecordBody::Statement { .. }) && a.speaks_for == req.speaks_for) else {
            return (false, "the application is not on our file, or is not the asker's".into(), vec![]);
        };
        let who = app.speaks_for.clone().unwrap_or_default();
        let (lot, st) = (data(&app).s("lot").unwrap_or("").to_string(), data(&app).s("structure_type").unwrap_or("").to_string());
        if let Some(l) = self.breach(&who, &lot, &st, t) {
            return (false, format!("it would still breach {l}"), vec![]);
        }
        let grant = say(
            "permit_decision",
            &format!("Permit granted to build {st} on {lot}, on a second look."),
            Say {
                to: Some(vec![who.clone()]),
                basis: Some(app.id.clone()),
                data: Some(json!({ "application": app.id, "decision": "granted", "on_review": req.id, "replaces": dec.id })),
                ..Default::default()
            },
        );
        let mut s = because(
            format!("Asked to look at our refusal {} again: nothing we know of forbids it now; granting.", dec.id),
            vec![record("liberty", &who, json!({ "action": "build", "object": lot, "structure_type": st }), None, Some(&app.id)), grant],
        );
        s.then = Some(PThen::Decided { app: app.id.clone(), decision: "granted".into(), law: None });
        (true, "no law in force forbids it now".into(), vec![s])
    }
}

impl Plan for Office {
    type Then = PThen;
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.letters.take(pic, &self.book);
    }

    fn plan(&mut self, pic: &Picture, _cx: &mut Cx) -> Vec<Step<PThen>> {
        let t = pic.t;
        self.in_hand.retain(|_, at| t - *at <= STALE);
        let mut steps: Vec<Step<PThen>> = vec![];
        let rules = planning_rules(&self.book);
        let decided = self.decisions();
        let mut apps: Vec<Arc<Record>> = self.book.open("permit_application").filter(|a| addressed_to(a).contains(&self.me)).cloned().collect();
        apps.sort_by(|a, b| filed_before(&a.id, &b.id));
        let mut ready: Vec<Arc<Record>> = vec![];
        for app in apps {
            if decided.contains_key(&app.id) || self.in_hand.contains_key(&format!("decide:{}", app.id)) {
                continue;
            }
            let applicant = app.speaks_for.clone().unwrap_or_else(|| app.author.clone());
            let d = data(&app);
            // An application it can't decide gets a reply saying why (§9.3).
            let missing: Vec<&str> = ["lot", "structure_type"].into_iter().filter(|f| d.s(f).is_none()).collect();
            if !missing.is_empty() {
                self.in_hand.insert(format!("decide:{}", app.id), t);
                let what: Vec<&str> = missing.iter().map(|f| if *f == "lot" { "which lot" } else { "what kind of building" }).collect();
                let mut s = because(
                    "An application missing what it needs: saying so.",
                    vec![say(
                        "permit_decision",
                        &format!("Application {} can't be decided: it doesn't say {}.", app.id, what.join(" or ")),
                        Say { to: Some(vec![applicant]), basis: Some(app.id.clone()), data: Some(json!({ "application": app.id, "decision": "incomplete", "missing": missing })), ..Default::default() },
                    )],
                );
                s.then = Some(PThen::Decided { app: app.id.clone(), decision: "incomplete".into(), law: None });
                steps.push(s);
                continue;
            }
            if let Some(r) = rules.filter(|r| r.notice_days > 0) {
                match self.notice_at(&app.id) {
                    None => {
                        if self.in_hand.insert(format!("notice:{}", app.id), t).is_none() {
                            let mut s = because(
                                format!("The planning procedure gives {} days' notice before a permit is decided: noticing application {}.", r.notice_days, app.id),
                                vec![say(
                                    "permit_notice",
                                    &format!(
                                        "Notice: an application to build {} on {}. Objections may be made to the planning office within {} days of this notice.",
                                        d.s("structure_type").unwrap_or(""),
                                        d.s("lot").unwrap_or(""),
                                        r.objection_days
                                    ),
                                    Say {
                                        visible: Some(Visible::Public),
                                        basis: Some(app.id.clone()),
                                        data: Some(json!({ "application": app.id, "lot": d.s("lot"), "structure_type": d.s("structure_type"), "objection_days": r.objection_days })),
                                        ..Default::default()
                                    },
                                )],
                            );
                            s.then = Some(PThen::Noticed { app: app.id.clone() });
                            steps.push(s);
                        }
                        continue;
                    }
                    Some(at) if t < at + r.objection_days * DAY => continue,
                    Some(_) => {}
                }
            }
            ready.push(app);
        }
        // The staff look into so many in a round, oldest first (PB-16: `compliance_bps` is this ceiling).
        let n = ready.len() as i64;
        let cap = ((n * self.compliance_bps.clamp(0, 10_000) + 9_999) / 10_000).max(1).min(n) as usize;
        for app in ready.into_iter().take(cap) {
            let applicant = app.speaks_for.clone().unwrap_or_else(|| app.author.clone());
            let (lot, st) = (data(&app).s("lot").unwrap_or("").to_string(), data(&app).s("structure_type").unwrap_or("").to_string());
            let breached = self.breach(&applicant, &lot, &st, t);
            // The objections heard: made in the objection period, about this application.
            let mut objections: Vec<Arc<Record>> = vec![];
            if let Some(r) = rules.filter(|r| r.notice_days > 0) {
                let close = self.notice_at(&app.id).unwrap_or(t) + r.objection_days * DAY;
                objections = self
                    .book
                    .open("permit_objection")
                    .filter(|o| data(o).s("application") == Some(&app.id) && o.at >= app.at && o.at <= close)
                    .cloned()
                    .collect();
                objections.sort_by(|a, b| filed_before(&a.id, &b.id));
            }
            let late = rules.and_then(|r| r.decide_within_days).is_some_and(|d| t > app.at + d * DAY);
            let refuse = breached.is_some();
            let mut dd = json!({ "application": app.id, "decision": if refuse { "refused" } else { "granted" } });
            if let Some(l) = &breached {
                dd["law"] = json!(l);
            }
            let mut to = vec![applicant.clone()];
            if rules.is_some_and(|r| r.notice_days > 0) {
                dd["objections"] = json!(objections.iter().map(|o| o.id.clone()).collect::<Vec<_>>());
                for o in &objections {
                    let who = o.speaks_for.clone().unwrap_or_else(|| o.author.clone());
                    if !to.contains(&who) {
                        to.push(who);
                    }
                }
            }
            if late {
                dd["late"] = json!(true);
            }
            let heard = if objections.is_empty() { String::new() } else { format!(" {} objection{} heard.", objections.len(), if objections.len() == 1 { "" } else { "s" }) };
            let words = if refuse {
                format!("Permit refused for {lot}: it would breach {}.{heard}", breached.as_deref().unwrap_or(""))
            } else {
                format!("Permit granted to build {st} on {lot}.{heard}")
            };
            let why = if refuse {
                format!("Refusing: granting it would breach {}, and we follow the law.", breached.as_deref().unwrap_or(""))
            } else {
                "Granting: no law we know of forbids it.".to_string()
            };
            let decision = say("permit_decision", &words, Say { to: Some(to), basis: Some(app.id.clone()), data: Some(dd), ..Default::default() });
            let mut lines = vec![];
            if !refuse {
                lines.push(record("liberty", &applicant, json!({ "action": "build", "object": lot, "structure_type": st }), None, Some(&app.id)));
            }
            lines.push(decision);
            let mut s = because(why, lines);
            s.then = Some(PThen::Decided { app: app.id.clone(), decision: if refuse { "refused" } else { "granted" }.into(), law: breached });
            self.in_hand.insert(format!("decide:{}", app.id), t);
            steps.push(s);
        }
        steps.extend(self.recon(t));
        let report = self.report();
        let answers = planning_answers();
        steps.extend(self.letters.answer(Some(&answers), "Letters to the planning office: answering each with its standing report.", |_| report.clone()));
        steps
    }

    fn until(&self, pic: &Picture) -> Option<i64> {
        // The next close of an objection period, for an application still waiting on it.
        let r = planning_rules(&self.book).filter(|r| r.notice_days > 0)?;
        let decided = self.decisions();
        self.book
            .open("permit_application")
            .filter(|a| addressed_to(a).contains(&self.me) && !decided.contains_key(&a.id))
            .filter_map(|a| self.notice_at(&a.id).map(|n| n + r.objection_days * DAY))
            .filter(|c| *c > pic.t)
            .min()
    }

    fn then(&mut self, token: &PThen, done: Done, cx: &mut Cx) -> Vec<Step<PThen>> {
        match token {
            PThen::Decided { app, decision, law } => {
                self.in_hand.remove(&format!("decide:{app}"));
                if done.applied() {
                    self.cache.insert(app.clone(), (decision.clone(), law.clone()));
                }
            }
            PThen::Noticed { app } => {
                self.in_hand.remove(&format!("notice:{app}"));
                if done.applied() {
                    self.noticed.insert(app.clone(), cx.t);
                }
            }
            PThen::Reviewed { request } => {
                if !done.applied() {
                    self.reviewed.remove(request);
                }
            }
        }
        vec![]
    }
}

// ================================================================== the inspector

pub struct Inspector;

fn inspector_answers() -> Answers {
    Answers {
        office: "the building inspector's office".into(),
        acts: "What it acts on: a notice of building work given to the town, whose site it goes to see; and a direction on its enforcement form (inspector_enforcement) from those the town's rule on directions names.".into(),
        forms: vec![],
        report: true,
    }
}

#[derive(Debug, Clone, Deserialize)]
struct Reg {
    #[serde(default = "d_lots")]
    lots: String,
    #[serde(default = "d_titles")]
    titles: String,
    #[serde(default = "d_dealings")]
    dealings: String,
}
fn d_lots() -> String {
    "lots".into()
}
fn d_titles() -> String {
    "titles".into()
}
fn d_dealings() -> String {
    "dealings".into()
}

impl Kind for Inspector {
    fn name(&self) -> &'static str {
        "city.inspector"
    }
    fn version(&self) -> &'static str {
        "0.7.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/institutions.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "compliance_bps": { "schema": { "type": "integer" }, "unit": "bps", "default": 10000, "source": "placeholder" },
                "directed_under": { "schema": { "type": "string" }, "default": "", "source": "placeholder" },
                "direction_compliance_bps": { "schema": { "type": "integer" }, "unit": "bps", "default": 10000, "source": "placeholder" },
                "fine": { "schema": { "type": "integer" }, "default": 5000000, "source": "placeholder" },
                "register": { "schema": { "type": "object", "description": "the land register, asked about one lot" }, "default": { "lots": "lots", "titles": "titles", "dealings": "dealings" }, "source": "placeholder" },
                "sites": { "schema": { "type": "string", "description": "the channel it goes to a site through (a visit)" }, "default": "sites", "source": "placeholder" },
                "valuer": { "schema": { "type": "string", "description": "whom it tells of what was built or brought down (none: nobody)" }, "default": "", "source": "placeholder" },
            },
            "perceives": [], "state": "none",
            "takes": [{
                "form": "inspector_enforcement",
                "title": "Enforcement direction to the building inspector",
                "fields": {
                    "fines": { "type": "choice", "options": ["yes", "no"], "required": true, "description": "Whether a breach the inspector finds is fined and ordered demolished: yes, as the office does of its own accord; no, it is recorded and nothing more." },
                    "fine": { "type": "amount", "description": "The fine for a breach, where it is to be other than the office's usual one." },
                },
                "follows": "While a direction with fines no stands, the inspector still goes to the sites it is told of and still tells the valuer what was built, but lays no fine and makes no demolition order on a breach: it records the breach in its report. With fines yes, it fines and orders as before, at the amount given if one is.",
            }],
            "issues": forms::group("INSPECTOR"),
            "answers": inspector_answers(),
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        7 * DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let reg: Reg = ctx.param("register", Reg { lots: d_lots(), titles: d_titles(), dealings: d_dealings() })?;
        let plan = Inspecting {
            me: ctx.entity.clone(),
            participant: ctx.participant.clone(),
            position: ctx.position.clone(),
            fine: ctx.param("fine", 5_000_000)?,
            compliance_bps: ctx.param("compliance_bps", 10_000)?,
            sites: ctx.param("sites", "sites".to_string())?,
            lots: reg.lots,
            titles: reg.titles,
            dealings: reg.dealings,
            valuer: ctx.param("valuer", String::new())?,
            // (PB-16: a direction from a post the rule names is followed; `direction_compliance_bps` is accepted, unused.)
            directions: Directions::new(ctx, &ctx.param("directed_under", String::new())?, Some(10_000), "the building inspector"),
            book: Book::new(),
            letters: Letters::default(),
            asked: Asked::default(),
            sites_seen: BTreeMap::new(),
            in_hand: BTreeMap::new(),
            judged: BTreeSet::new(),
            valued: BTreeSet::new(),
        };
        Ok(Box::new(Noting(Stepper::new(plan))))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        restore::<Inspecting>(saved)
    }
}


/// What a visit found of a structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Found {
    structure: String,
    kind: String,
    at: String,
    built_by: Option<String>,
    cells: Vec<String>,
}

/// A notice of building work, as the file has it.
#[derive(Debug, Clone)]
struct Notice {
    id: String,
    lot: Option<String>,
    at: Option<String>,
    structure: Option<String>,
    removes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum IThen {
    Inspected { notice: String },
    Valued { notice: String },
}

#[derive(Serialize, Deserialize)]
struct Inspecting {
    me: String,
    participant: String,
    position: Option<String>,
    fine: i64,
    compliance_bps: i64,
    sites: String,
    lots: String,
    titles: String,
    dealings: String,
    valuer: String,
    directions: Directions,
    book: Book,
    letters: Letters,
    /// What has been asked (a look is asked once): a cache, nothing records it.
    asked: Asked,
    /// What a visit found, by structure (none: nothing stood there): nothing else records it.
    sites_seen: BTreeMap<String, Option<Found>>,
    in_hand: BTreeMap<String, i64>,
    /// Notices judged and valued whose records the book does not show yet (a cache of the file).
    judged: BTreeSet<String>,
    valued: BTreeSet<String>,
}

impl Booked for Inspecting {
    fn book_mut(&mut self) -> &mut Book {
        &mut self.book
    }
}

impl Inspecting {
    fn ours(&self, r: &Record) -> bool {
        ours(&self.position, &self.participant, r)
    }

    fn notices(&self) -> Vec<Notice> {
        let mut v: Vec<&Arc<Record>> = self.book.open("building_notice").filter(|n| addressed_to(n).contains(&self.me)).collect();
        v.sort_by(|a, b| filed_before(&a.id, &b.id));
        v.into_iter()
            .map(|n| {
                let d = data(n);
                let s = |k: &str| d.s(k).map(String::from);
                Notice { id: n.id.clone(), lot: s("lot"), at: s("at"), structure: s("structure"), removes: s("removes") }
            })
            .collect()
    }

    /// Inspections on file (our own records), by notice.
    fn inspections(&self) -> BTreeMap<String, Arc<Record>> {
        self.book.open("building_inspection").filter(|r| self.ours(r)).filter_map(|r| data(r).s("notice").map(|n| (n.to_string(), r.clone()))).collect()
    }

    fn valuations(&self) -> BTreeSet<String> {
        let mut s = self.valued.clone();
        for r in self.book.open("valuation_request").filter(|r| self.ours(r)) {
            s.extend(crate::common::bases_of(r).iter().cloned());
        }
        s
    }

    /// Notices still to be seen to: not removals, with a structure, not inspected.
    fn to_see(&self) -> Vec<Notice> {
        let done = self.inspections();
        self.notices().into_iter().filter(|n| n.removes.is_none() && n.structure.is_some() && !done.contains_key(&n.id) && !self.judged.contains(&n.id)).collect()
    }

    fn report(&self) -> String {
        let taken = self.notices().len();
        let ins = self.inspections();
        let inspected = ins.len().max(self.judged.len());
        let mut found = vec![];
        let mut not_fined = vec![];
        for r in ins.values() {
            let d = data(r);
            if d.s("found") != Some("breach") {
                continue;
            }
            let line = format!("{} on {} ({}", d.s("structure").unwrap_or(""), d.s("lot").unwrap_or(d.s("at").unwrap_or("")), d.s("law").unwrap_or(""));
            if d.get("acted") == Some(&Value::Bool(true)) {
                found.push(format!("{line})"));
            } else {
                not_fined.push(format!("{line}; direction {})", d.s("direction").unwrap_or("")));
            }
        }
        format!(
            "Report from the building inspector: {taken} notices of building work received, {inspected} sites inspected. {}{} We inspect the work we are told of; work nobody tells the town of we don't see.",
            if !found.is_empty() {
                format!("Breaches found and acted on (a fine and a demolition order each): {}.", found.join(", "))
            } else if !not_fined.is_empty() {
                "No breaches acted on.".to_string()
            } else {
                "No breaches found.".to_string()
            },
            if not_fined.is_empty() { String::new() } else { format!(" Breaches found and, by direction, not fined or ordered demolished: {}.", not_fined.join(", ")) },
        )
    }

    /// Standing claims of an owner, as the law reads them: recorded, not released or withdrawn.
    fn claims_of(&self, owner: &str) -> Vec<oikos_rules::law::Claim> {
        self.book
            .claims_by(ClaimKey::Holder, owner)
            .filter(|c| !self.book.released(&c.id) && !self.book.withdrawn(&c.id))
            .filter_map(|c| serde_json::to_value(&**c).ok())
            .filter_map(|v| oikos_rules::law::Claim::from_record(&v))
            .collect()
    }
}

impl Plan for Inspecting {
    type Then = IThen;

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.letters.take(pic, &self.book);
        // What a visit found: each site gone to, as it was.
        let back = visited(pic, &self.sites);
        for n in self.to_see() {
            let Some(structure) = n.structure.clone() else { continue };
            if self.sites_seen.contains_key(&structure) {
                continue;
            }
            let here: Vec<_> = back.iter().filter(|c| c.structure.as_ref().is_some_and(|s| s.structure == structure) || Some(&c.cell) == n.at.as_ref()).collect();
            if !here.is_empty() {
                let found = here.iter().find_map(|c| c.structure.as_ref().filter(|s| s.structure == structure)).map(|s| Found {
                    structure: s.structure.clone(),
                    kind: s.structure_type.clone(),
                    at: s.at.clone(),
                    built_by: s.built_by.clone(),
                    cells: {
                        let mut c: Vec<String> = back.iter().filter(|c| c.structure.as_ref().is_some_and(|x| x.structure == s.structure)).map(|c| c.cell.clone()).collect();
                        c.sort();
                        c
                    },
                });
                self.sites_seen.insert(structure, found);
            } else if !back.is_empty() {
                // (Gone to, and nothing of it there to be found: it does not stand.)
                let since = self.asked.since(&format!("site:{}", n.id));
                if since >= 0 && since < pic.t {
                    self.sites_seen.insert(structure, None);
                }
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<IThen>> {
        let t = pic.t;
        let me = pic.entity.clone();
        self.in_hand.retain(|_, at| t - *at <= STALE);
        let mut steps: Vec<Step<IThen>> = vec![];
        let valued = self.valuations();
        let inspected = self.inspections();
        for n in self.notices() {
            let valuing = |this: &mut Self, steps: &mut Vec<Step<IThen>>, words: String, d: Value, why: String| {
                if this.valuer.is_empty() || valued.contains(&n.id) || this.in_hand.insert(format!("value:{}", n.id), t).is_some() {
                    return;
                }
                let mut s = because(why, vec![say("valuation_request", &words, Say { to: Some(vec![this.valuer.clone()]), basis: Some(n.id.clone()), data: Some(d), ..Default::default() })]);
                s.then = Some(IThen::Valued { notice: n.id.clone() });
                steps.push(s);
            };
            // Something brought down: the valuer is told; nothing to inspect.
            if let Some(removed) = &n.removes {
                let d = papers::data(&po::ValuationRequest { lot: n.lot.clone(), structure: None, structure_type: None, removed: Some(removed.clone()) });
                valuing(self, &mut steps, format!("Supplementary valuation: {removed} has been demolished."), d, format!("{removed} is being brought down: telling the valuer."));
                continue;
            }
            let Some(structure) = &n.structure else { continue };
            if inspected.contains_key(&n.id) || self.judged.contains(&n.id) || self.in_hand.contains_key(&format!("inspect:{}", n.id)) {
                continue;
            }
            let Some(seen) = self.sites_seen.get(structure).cloned() else { continue };
            let record_only = |found: &str, extra: Value| -> Step<IThen> {
                let mut d = json!({ "notice": n.id, "structure": structure, "found": found });
                if let (Some(o), Some(x)) = (d.as_object_mut(), extra.as_object()) {
                    o.extend(x.clone());
                }
                let mut s = because(
                    format!("Visited the site of {structure}: {found}; putting the inspection on file."),
                    vec![say("building_inspection", &format!("Inspection of {structure}: {found}."), Say { visible: Some(Visible::Only(vec![me.clone()])), basis: Some(n.id.clone()), data: Some(d), ..Default::default() })],
                );
                s.then = Some(IThen::Inspected { notice: n.id.clone() });
                s
            };
            let Some(st) = seen else {
                // (Nothing stands there: nothing to judge.)
                self.in_hand.insert(format!("inspect:{}", n.id), t);
                steps.push(record_only("nothing_standing", json!({})));
                continue;
            };
            // The lot it stands on (its corner cell's), and its owner, by the registry.
            let lot: Option<String> = n.lot.clone().or_else(|| lot_of(&self.book, &st.at).map(String::from));
            let owner = lot.as_deref().and_then(|l| owner_of(&self.book, l)).or(st.built_by.clone()).unwrap_or_else(|| "unknown".into());
            let place = lot.clone().unwrap_or_else(|| st.at.clone());
            let act = json!({ "block": "construct", "lot": lot, "at": st.at, "cells": if st.cells.is_empty() { vec![st.at.clone()] } else { st.cells.clone() }, "structure_type": st.kind });
            let act = if lot.is_none() { let mut a = act; a.as_object_mut().map(|o| o.remove("lot")); a } else { act };
            let claims = self.claims_of(&owner);
            let laws: Vec<Arc<Record>> = prohibitions(&self.book, None).into_iter().cloned().collect();
            let mut breached: Option<Arc<Record>> = None;
            for l in laws {
                if holds_of(&mut self.book, &l, &act, &owner, t, &claims) {
                    breached = Some(l);
                    break;
                }
            }
            let mut vd = papers::data(&po::ValuationRequest { lot: lot.clone(), structure: Some(st.structure.clone()), structure_type: Some(st.kind.clone()), removed: None });
            if lot.is_none() {
                vd.as_object_mut().map(|o| o.remove("lot"));
            }
            valuing(self, &mut steps, format!("Supplementary valuation: a {} ({}) on {place}.", st.kind, st.structure), vd, format!("A {} is being built on {place}: asking the valuer for a supplementary valuation.", st.kind));
            let Some(law) = breached else {
                self.in_hand.insert(format!("inspect:{}", n.id), t);
                steps.push(record_only("no_breach", json!({ "lot": lot })));
                continue;
            };
            // An enforcement direction that stands (from whoever the town says may direct us): whether a breach is
            // fined and ordered down, and at what amount.
            let direction = self.directions.standing(&self.book, "inspector_enforcement", cx).map(|d| (d.id.clone(), papers::read::<po::Direction>(d)));
            let (dir_id, dir) = match direction {
                Some((i, d)) => (Some(i), d),
                None => (None, None),
            };
            if dir.as_ref().and_then(|d| d.fines.as_deref()) == Some("no") {
                self.in_hand.insert(format!("inspect:{}", n.id), t);
                steps.push(record_only("breach", json!({ "lot": lot, "at": st.at, "law": law.id, "acted": false, "direction": dir_id })));
                continue;
            }
            let fine = dir.and_then(|d| d.fine).unwrap_or(self.fine);
            let mut s = because(
                format!("Inspected: {} is being built in breach of {}; fining the owner and ordering it demolished.", st.structure, law.id),
                vec![
                    record("right", &me, json!({ "kind": "fine", "amount": fine, "for": format!("Unpermitted {} on {place} ({}).", st.kind, st.structure) }), Some(&owner), Some(&law.id)),
                    say(
                        "demolition_order",
                        &format!("Order: demolish {} on {place}, built in breach of {}.", st.structure, law.id),
                        Say {
                            to: Some(vec![owner.clone()]),
                            basis: Some(law.id.clone()),
                            data: Some(papers::data(&po::DemolitionOrder { structure: st.structure.clone(), lot: lot.clone(), law: law.id.clone() })),
                            ..Default::default()
                        },
                    ),
                    say(
                        "building_inspection",
                        &format!("Inspection of {}: built in breach of {}; fined and ordered demolished.", st.structure, law.id),
                        Say {
                            visible: Some(Visible::Only(vec![me.clone()])),
                            basis: Some(n.id.clone()),
                            data: Some(json!({ "notice": n.id, "structure": st.structure, "lot": lot, "at": st.at, "found": "breach", "law": law.id, "acted": true })),
                            ..Default::default()
                        },
                    ),
                ],
            );
            s.then = Some(IThen::Inspected { notice: n.id.clone() });
            self.in_hand.insert(format!("inspect:{}", n.id), t);
            steps.push(s);
        }
        let world = cx.ctx.world.clone();
        steps.extend(self.directions.letters(&self.book, |d, _| {
            let dir = papers::read::<po::Direction>(d);
            if dir.as_ref().and_then(|x| x.fines.as_deref()) == Some("no") {
                "A breach the inspector finds is recorded in its report, and neither fined nor ordered demolished.".to_string()
            } else {
                let amount = dir.and_then(|x| x.fine).map(|f| format!(" {}", money_words(f, &world))).unwrap_or_default();
                format!("A breach the inspector finds is fined{amount} and ordered demolished.")
            }
        }));
        let report = self.report();
        let answers = inspector_answers();
        steps.extend(self.letters.answer(Some(&answers), "Letters to the building inspector: answering each with its standing report.", |_| report.clone()));
        steps
    }

    // Before it judges: who owns each lot notified (the registry, asked about the one lot), and the site itself, gone to.
    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        let mut looks = vec![];
        let mut used: BTreeSet<String> = BTreeSet::new();
        let mut go: Vec<String> = vec![];
        let reg = Register { titles: &self.titles, dealings: &self.dealings };
        // The staff get to so many sites in a round (PB-16: `compliance_bps` is this ceiling).
        let waiting = self.to_see().iter().filter(|n| n.structure.as_ref().is_some_and(|s| !self.sites_seen.contains_key(s))).count() as i64;
        let cap = ((waiting * self.compliance_bps.clamp(0, 10_000) + 9_999) / 10_000).max(1).min(VISIT_MAX as i64) as usize;
        for n in self.notices() {
            let Some(structure) = &n.structure else { continue };
            if n.removes.is_some() || self.inspections().contains_key(&n.id) {
                continue;
            }
            let lot = n.lot.clone().or_else(|| n.at.as_deref().and_then(|a| lot_of(&self.book, a)).map(String::from));
            if let Some(lot) = &lot {
                looks.extend(owner_looks(&self.book, &mut self.asked, &reg, lot, &mut used, 20));
            } else if let Some(at) = &n.at {
                if !used.contains(&self.lots) && self.asked.first(&format!("ground:{at}"), pic.t) {
                    used.insert(self.lots.clone());
                    looks.push(ask::about(&self.lots, "data.cells", at.as_str(), ask::About { most: 1, ..Default::default() }));
                }
            }
            // (To the ground notified, where the notice says it: a building may be gone, its ground is always there.)
            if !self.sites_seen.contains_key(structure) && go.len() < cap && self.asked.first(&format!("site:{}", n.id), pic.t) {
                go.push(n.at.clone().unwrap_or_else(|| structure.clone()));
            }
        }
        if !go.is_empty() {
            looks.push(go_see(&self.sites, &go));
        }
        looks
    }

    fn then(&mut self, token: &IThen, done: Done, _: &mut Cx) -> Vec<Step<IThen>> {
        match token {
            IThen::Inspected { notice } => {
                self.in_hand.remove(&format!("inspect:{notice}"));
                if done.applied() {
                    self.judged.insert(notice.clone());
                }
            }
            IThen::Valued { notice } => {
                self.in_hand.remove(&format!("value:{notice}"));
                if done.applied() {
                    self.valued.insert(notice.clone());
                }
            }
        }
        vec![]
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Draws, WorldInfo};
    use oikos_sight::calls::program_text;
    use oikos_sight::View;

    fn ctx(position: &str, params: Value) -> Ctx {
        Ctx {
            participant: "planning-system".into(),
            performer: Default::default(),
            entity: "city".into(),
            position: Some(position.into()),
            params: params.as_object().cloned().unwrap_or_default(),
            world: Arc::new(WorldInfo { run_end: 400 * DAY, ..Default::default() }),
        }
    }

    fn st(id: &str, at: i64, kind: &str, speaks: &str, to: &[&str], data: Value) -> Value {
        json!({ "id": id, "record": "statement", "author": "p.x", "speaks_for": speaks, "at": at, "visible_to": "public", "kind": kind, "text": kind, "data": data, "addressed_to": to })
    }

    struct Rig {
        kind: &'static dyn Kind,
        ctx: Ctx,
        actor: Box<dyn Actor>,
        view: View,
        draws: Draws,
    }
    impl Rig {
        fn new(kind: &'static dyn Kind, position: &str, params: Value) -> Rig {
            let ctx = ctx(position, params);
            Rig { kind, actor: kind.create(&ctx).unwrap(), ctx, view: View::default(), draws: Draws::new("planning-system", position) }
        }
        fn wake(&mut self, t: i64, records: Vec<Value>) -> Option<String> {
            let obs = serde_json::from_value(json!({ "participant": "planning-system", "t": t, "status": "active", "outcomes": [], "inbox": [], "drafts": [],
                "channels": { format!("{}/town", self.ctx.position.as_deref().unwrap()): { "kind": "records", "records": records } } })).unwrap();
            let pic = self.view.apply(obs, Some(self.ctx.position.as_deref().unwrap()), "city", "cadence", 7 * DAY);
            let mut cx = Cx::new(t, &self.ctx, &mut self.draws, 1, vec![]);
            match self.actor.step(&pic, &mut cx) {
                Action::Call { program, .. } => Some(program_text(&program)),
                _ => None,
            }
        }
    }

    fn law_river() -> Value {
        json!({ "id": "law-1", "record": "statement", "author": "genesis", "speaks_for": "city", "at": 0, "visible_to": "public", "kind": "law", "text": "No permit on lot-9.",
            "adico": { "deontic": "must_not" }, "formal": { "language": "cel", "condition": "block.block == 'grant_permit' && block.lot == 'lot-9'" } })
    }
    fn app(id: &str, lot: &str) -> Value {
        st(id, 10, "permit_application", "ann", &["city"], json!({ "lot": lot, "structure_type": "house" }))
    }

    #[test]
    fn manifests_are_the_ts_modules() {
        for k in [&PlanningOfficer as &dyn Kind, &Inspector] {
            let ts: Value = serde_json::from_slice(&std::fs::read(format!("{}/../../../participants/manifests/{}.json", env!("CARGO_MANIFEST_DIR"), k.name())).unwrap()).unwrap();
            let rust = k.manifest();
            for (key, v) in ts.as_object().unwrap() {
                assert_eq!(&rust[key], v, "{} {key}", k.name());
            }
        }
    }

    #[test]
    fn with_no_procedure_it_decides_at_once_granting_what_no_law_forbids_and_refusing_what_one_does() {
        let mut r = Rig::new(&PlanningOfficer, "planning", json!({}));
        let p = r.wake(7 * DAY, vec![law_river(), app("rec.5", "lot-1")]).unwrap();
        assert!(p.contains("claim(") && p.contains("permit_decision") && p.contains("granted"), "{p}");
        let mut r = Rig::new(&PlanningOfficer, "planning", json!({}));
        let p = r.wake(14 * DAY, vec![law_river(), app("rec.6", "lot-9")]).unwrap();
        assert!(p.contains("refused") && p.contains("law-1") && !p.contains("claim("), "{p}");
    }

    #[test]
    fn an_application_missing_a_lot_is_sent_back_incomplete() {
        let mut r = Rig::new(&PlanningOfficer, "planning", json!({}));
        let a = st("rec.5", 10, "permit_application", "ann", &["city"], json!({ "structure_type": "house" }));
        let p = r.wake(7 * DAY, vec![a]).unwrap();
        assert!(p.contains("incomplete") && p.contains("which lot"), "{p}");
    }

    #[test]
    fn with_a_procedure_it_gives_notice_first_hears_objections_and_decides_after_the_period() {
        let proc_ = st("proc-1", 0, "procedure", "city", &[], json!({ "planning": { "notice_days": 14, "decide_within_days": 60 } }));
        let mut r = Rig::new(&PlanningOfficer, "planning", json!({}));
        let p = r.wake(7 * DAY, vec![proc_, app("rec.5", "lot-1")]).unwrap();
        assert!(p.contains("permit_notice") && !p.contains("granted"), "{p}");
        // (The notice is on the record; the period has not run.)
        let notice = st("rec.6", 7 * DAY + 60, "permit_notice", "city", &[], json!({ "application": "rec.5" }));
        let mut notice = notice;
        notice["in_position"] = json!("planning");
        notice["author"] = json!("planning-system");
        let obj = st("rec.7", 9 * DAY, "permit_objection", "bob", &["city"], json!({ "application": "rec.5" }));
        assert!(r.wake(14 * DAY, vec![notice.clone(), obj]).is_none(), "nothing is decided inside the period");
        let p = r.wake(25 * DAY, vec![]).unwrap();
        assert!(p.contains("granted") && p.contains("rec.7") && p.contains("bob") && !p.contains("late"), "{p}");
    }

    #[test]
    fn a_decision_after_the_time_limit_says_it_was_late_and_a_ceiling_defers_the_rest() {
        let proc_ = st("proc-1", 0, "procedure", "city", &[], json!({ "planning": { "notice_days": 0, "decide_within_days": 5 } }));
        let mut r = Rig::new(&PlanningOfficer, "planning", json!({ "compliance_bps": 5000 }));
        let p = r.wake(30 * DAY, vec![proc_, app("rec.5", "lot-1"), app("rec.6", "lot-2")]).unwrap();
        assert!(p.contains("late") && p.contains("rec.5"), "{p}");
        // The ceiling: one of two this round; the other waits (a second wake at the same day finds it in the queue).
        assert!(!p.contains("rec.6"), "{p}");
    }

    #[test]
    fn a_successor_does_not_decide_again_what_the_file_shows_decided() {
        let mut dec = st("rec.8", 20, "permit_decision", "city", &["ann"], json!({ "application": "rec.5", "decision": "granted" }));
        dec["in_position"] = json!("planning");
        let mut r = Rig::new(&PlanningOfficer, "planning", json!({}));
        assert!(r.wake(7 * DAY, vec![app("rec.5", "lot-1"), dec]).is_none());
    }

    #[test]
    fn it_saves_and_restores() {
        let mut r = Rig::new(&PlanningOfficer, "planning", json!({}));
        r.wake(7 * DAY, vec![app("rec.5", "lot-1")]);
        let saved = r.actor.save().unwrap();
        let back = r.kind.restore(&r.ctx, saved.clone()).unwrap();
        assert_eq!(back.save().unwrap(), saved);
    }

    #[test]
    fn the_inspector_goes_to_a_notified_site() {
        let mut r = Rig::new(&Inspector, "inspector", json!({}));
        let n = st("rec.3", 5, "building_notice", "buildco", &["city"], json!({ "lot": "lot-1", "at": "c-1", "structure": "s-1", "structure_type": "house" }));
        let obs = serde_json::from_value(json!({ "participant": "planning-system", "t": 7 * DAY, "status": "active", "outcomes": [], "inbox": [], "drafts": [],
            "channels": { "inspector/town": { "kind": "records", "records": [n] } } })).unwrap();
        let pic = r.view.apply(obs, Some("inspector"), "city", "cadence", 7 * DAY);
        let mut cx = Cx::new(7 * DAY, &r.ctx, &mut r.draws, 1, vec![]);
        match r.actor.step(&pic, &mut cx) {
            Action::Look { looks } => assert!(looks.iter().any(|l| l.visit.as_ref().is_some_and(|v| v.places == ["c-1"])), "{looks:?}"),
            other => panic!("{other:?}"),
        }
    }
}
