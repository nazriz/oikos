//! police.station: a police station's officer in charge (docs/behaviour/crime.md; docs/design/world-expansion.md 7.2).
//! Ported from participants/src/behaviour/police.ts (0.6.0); ported to Rust (lane E), version kept at the TS string.
//!
//! The police keep the officers their establishment says (hired and paid like any employer's staff), take reports of
//! goods taken and investigate each: work at the station that finds who took them, with the world's chance (only the
//! police learn it). Found: a charge to the tribunal, with what they found as evidence. Not found: the report stays
//! unsolved, and the one who made it is told. They carry out the tribunal's warrants of possession, and call at a home
//! they are asked to (a neighbour who has seen nobody come out), reporting whoever is found dead there to the registry.
//!
//! **What a successor reads from the file** (bug hunt 2026-10-17, finding 2). Nothing the office has put on record in
//! this post lives only in memory: a report is looked into unless a charge or a closure of ours cites it; a warrant is
//! carried out unless an executed or lapsed notice of ours cites it; a death found is reported unless a notification of
//! ours names the dead. What is kept in memory is a cache of the file (`settled`: papers sent and not yet seen back)
//! or what no paper records: an investigation under way (its finding comes only to whoever ordered it, so a successor
//! to a station that was mid-investigation looks into that report again), a household put out so far, and the homes a
//! call found nobody dead at (nothing is written about a call that found nothing).
//!
//! **Decided fresh in Rust.** (1) A warrant whose day has not come no longer holds up the warrants behind it (the TS
//! stopped at the first, a queue with a head that could not be served). (2) A warrant against a tenant the register of
//! deaths shows dead (an entry, or a certified copy of one, on the station's file) is not carried out: the landlord is
//! told it has lapsed and why (bug hunt finding 3: a dead tenant was put through the tribunal and a warrant executed
//! against the home the survivor lived in). The station does not ask the registry: the register is the registrar's
//! and the station learns of a death by being sent the entry or the copy. (3) The first wake is spread by a hash of the
//! participant's id, where the TS drew from a keyed stream (first_wake has no stream). (4) Compliance: this office draws
//! no coin to decide whether to act. Whether a warrant is carried out turns on a cause: officers at the station with
//! hours left in their working day (docs/risks.md, PB-16); the `compliance_bps` coins live in the planning officer,
//! the inspector, landlords and the union, which other lanes port.

use crate::common::{
    addressed_to, data, filed_before, go_see, money_words, next_look, out_of_time, visited, work::ReportOf, work::Routine, Book,
    Fields, Part, StandingWork, DAY, VISIT_MAX,
};
use crate::firms::staffing::{Own, Staffing, StaffingOpts, Want};
use crate::steps::{arg, because, call, json, say, Done, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms;
use oikos_sight::{LookRequest, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub struct Station;

const WARRANTS: &str = "carry_out_warrants";
const REPORTS: &str = "look_into_reports";
const CALLS: &str = "call_at_homes";

/// A parameter as a manifest writes it (module.ts `params`): type, words, default, unit, whether the world must say.
pub(crate) fn param(ty: &str, words: Option<&str>, default: Value, unit: Option<&str>, required: bool, source: Option<&str>) -> Value {
    let mut schema = json!({ "type": ty });
    if let Some(w) = words {
        schema["description"] = json!(w);
    }
    let mut v = json!({ "schema": schema, "default": default, "source": source.or(words).unwrap_or("placeholder") });
    if let Some(u) = unit {
        v["unit"] = json!(u);
    }
    if required {
        v["required"] = json!(true);
    }
    v
}

/// The text of a JSON value as TS's `String(x)` writes the ones a paper holds (a string, a number); nothing otherwise.
pub(crate) fn as_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// A small stable hash (FNV-1a) for spreading first wakes without a keyed stream.
pub(crate) fn spread(id: &str, modulo: i64) -> i64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in id.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    (h % modulo.max(1) as u64) as i64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    building: String,
    workplace: String,
    account: String,
    officers: i64,
    role: String,
    wage: i64,
    period: i64,
    notice_days: i64,
    industry: String,
    task: String,
    task_seconds: i64,
    working_day: i64,
    tribunal: String,
    look_at: i64,
    look_days: i64,
    channel: String,
    calls_channel: String,
    registry: String,
    part: String,
}

impl Params {
    fn read(ctx: &Ctx) -> Result<Params, String> {
        Ok(Params {
            building: ctx.need("building", "police.station")?,
            workplace: ctx.need("workplace", "police.station")?,
            account: ctx.need("account", "police.station")?,
            officers: ctx.param("officers", 0)?,
            role: ctx.param("role", "police officer".to_string())?,
            wage: ctx.param("wage", 0)?,
            period: ctx.param("period", 14 * DAY)?,
            notice_days: ctx.param("notice_days", 14)?,
            industry: ctx.param("industry", "public_safety".to_string())?,
            task: ctx.param("task", "investigate".to_string())?,
            task_seconds: ctx.param("task_seconds", 4 * 3600)?,
            working_day: ctx.param("working_day", 8 * 3600)?,
            tribunal: ctx.need("tribunal", "police.station")?,
            look_at: ctx.param("look_at", 0)?,
            look_days: ctx.param("look_days", 5)?,
            channel: ctx.param("channel", "premises".to_string())?,
            calls_channel: ctx.param("calls_channel", String::new())?,
            registry: ctx.param("registry", String::new())?,
            part: ctx.param("part", String::new())?,
        })
    }
}

impl Kind for Station {
    fn name(&self) -> &'static str {
        "police.station"
    }
    // Ported to Rust (version string kept as the TS manifest has it): reads what it has done from its own file (reports, warrants, deaths found), so a successor carries on;
    // a warrant against a tenant registered dead is not carried out; a warrant not yet due no longer holds up those behind it.
    // 0.6.0 (TS): run in parts where a model holds the office (part): the officers carry out warrants, look into reports
    // and call at homes under standing work orders in force at the start, and report what they did; 0.5.1: returns of tax
    // withheld are filed on the days the law states; 0.5.0: a warrant carried out says how many of the household were there
    // and were put out; one its registrar has withdrawn is not gone on; 0.4.0: carries out a tribunal's warrant of
    // possession, in an officer's hours; 0.3.1: a death that someone at home outlived by more than a day is not "found" at a
    // later call; 0.3.0: calls at a home when asked to (a welfare check), by going there; no longer shown the town's homes.
    fn version(&self) -> &'static str {
        "0.6.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/crime.md"
    }
    fn manifest(&self) -> Value {
        let mut issues = forms::group("JOB_ADVERTISEMENT");
        issues.extend(forms::group("POLICE"));
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "account": param("string", Some("what it pays its staff from (its funding comes in there)"), json!(""), None, true, Some("placeholder")),
                "building": param("string", Some("the station, and where its officers work (the world must say)"), json!(""), None, true, None),
                "calls_channel": param("string", None, json!(""), None, false, None),
                "channel": param("string", None, json!("premises"), None, false, None),
                "industry": param("string", None, json!("public_safety"), None, false, None),
                "look_at": param("integer", None, json!(0), None, false, None),
                "look_days": param("integer", None, json!(5), Some("days"), false, None),
                "notice_days": param("integer", None, json!(14), Some("days"), false, None),
                "officers": param("integer", Some("the establishment (its funder's)"), json!(0), None, false, Some("placeholder")),
                "part": param("string", None, json!(""), None, false, None),
                "period": param("integer", None, json!(14 * DAY), None, false, None),
                "registry": param("string", None, json!(""), None, false, None),
                "role": param("string", None, json!("police officer"), None, false, None),
                "task": param("string", None, json!("investigate"), None, false, None),
                "task_seconds": param("integer", None, json!(4 * 3600), Some("seconds"), false, None),
                "tribunal": param("string", Some("where charges go"), json!(""), None, true, Some("placeholder")),
                "wage": param("integer", None, json!(0), None, false, None),
                "working_day": param("integer", None, json!(8 * 3600), None, false, None),
                "workplace": param("string", None, json!(""), None, true, None),
            },
            "perceives": [], "state": "none",
            "issues": issues,
            "routines": [
                { "task": WARRANTS, "at": "workplace", "every": 1, "what": "On each working day an officer at the station carries out the tribunal's warrants of possession that have come to it, in the order they came and once the day each gives has come: the officer goes to the home and puts out whoever of the household is there, and the tenant and the landlord are told it is done and how many were there. A warrant its registrar has withdrawn is not gone on; one not carried out by its last day lapses and the landlord is told, and must ask again." },
                { "task": REPORTS, "at": "workplace", "every": 1, "what": "Each working day the officers at the station look into the reports of goods taken that have been made to it, in the order they came, as many as their hours allow (four hours each). Where they find who took them, they lay a charge before the tribunal with what they found as evidence; where they do not, the report is closed unsolved and the person who made it is told." },
                { "task": CALLS, "at": "workplace", "every": 1, "what": "Each working day an officer goes to each home the station has been asked to call at, where a neighbour has seen nobody come out; if someone is found dead there who is not yet registered as dead, the death is reported to the registry." },
            ],
            "answers": { "office": "the police station", "acts": "What it acts on: a report of a crime, which it investigates; and a request to call at a home where nobody has been seen." },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        10 * 3600 + spread(&ctx.participant, 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params::read(ctx)?;
        let me = ctx.entity.clone();
        let part = Part::from_param(&p.part);
        let staff = Staffing::new(
            &me,
            StaffingOpts {
                workplace: Some(p.workplace.clone()),
                industry: Some(p.industry.clone()),
                own: Some(Own::RoleOrUnnamed),
                ..StaffingOpts::new(p.period, p.notice_days, &p.role)
            },
        );
        Ok(Box::new(Stepper::new(Police {
            routines: StandingWork::new(&me, part, []),
            calling_now: part == Part::Whole,
            position: ctx.position.clone().unwrap_or_default(),
            me,
            p,
            part,
            book: Book::new(),
            staff,
            view: None,
            used: BTreeMap::new(),
            used_day: -1,
            asked: BTreeMap::new(),
            results: BTreeMap::new(),
            settled: BTreeSet::new(),
            puts: BTreeMap::new(),
            calls: vec![],
            called: BTreeSet::new(),
            taken_calls: BTreeSet::new(),
            answered: BTreeSet::new(),
            found: vec![],
            told: BTreeSet::new(),
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Police>::restore(saved)?))
    }
}

/// A report under investigation: what is needed to charge or close it when the finding comes.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Inquiry {
    report: String,
    from: String,
    at: String,
    kind: String,
    value: i64,
    account: Option<String>,
}

/// A warrant being carried out: what the notice that it is done will say.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Executed {
    warrant: String,
    lease: String,
    tenant: String,
    landlord: String,
    space: String,
    household: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum Then {
    /// An investigation ordered: when it is applied, its finding is awaited.
    Look(Inquiry),
    /// One of a household put out; the last says what was done.
    Out { exec: Executed, last: bool },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Call {
    space: String,
    structure: String,
}

#[derive(Serialize, Deserialize)]
struct Police {
    me: String,
    position: String,
    p: Params,
    part: Part,
    book: Book,
    staff: Staffing,
    routines: StandingWork,
    /// The station as its officers see it (who is at work in it).
    view: Option<oikos_sight::SiteStructure>,
    /// Seconds of each officer's day used, and the day (a cache: the world refuses work an officer has no time for).
    used: BTreeMap<String, i64>,
    used_day: i64,
    /// An investigation under way (its action) -> the report. No paper records it.
    asked: BTreeMap<String, Inquiry>,
    /// What investigations found, as each comes in (action -> who took it, if found).
    results: BTreeMap<String, Option<String>>,
    /// Papers of ours sent and not yet seen back on the file (reports charged or closed, warrants done or lapsed).
    settled: BTreeSet<String>,
    /// Of a warrant under way, how many of its household were put out.
    puts: BTreeMap<String, i64>,
    calls: Vec<Call>,
    called: BTreeSet<String>,
    taken_calls: BTreeSet<String>,
    /// A home and the silence asked about (`space@since`): called at once.
    answered: BTreeSet<String>,
    found: Vec<(String, String)>,
    told: BTreeSet<String>,
    calling_now: bool,
}

impl Police {
    fn st(why: String, c: oikos_sight::calls::Call) -> Step<Then> {
        because(why, vec![c])
    }
}

impl Plan for Police {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, _cx: &mut Cx) {
        let t = pic.t;
        self.book.absorb(pic);
        self.staff.absorb(pic);
        for o in &pic.outcomes {
            if let Some(inv) = &o.investigated {
                self.results.insert(o.action.clone(), inv.get("taker").and_then(Value::as_str).map(String::from));
            }
        }
        if let Some(Seen::Sites { cells, .. }) = pic.channels.get(&self.p.channel) {
            for c in cells.iter() {
                if let Some(s) = &c.structure {
                    if s.structure == self.p.building {
                        self.view = Some((**s).clone());
                    }
                }
            }
        }
        // Asked to call at a home, taken as it comes in so that an officer sets out at this wake (once for each home and
        // each silence: several neighbours may ask).
        if self.routines.does(&self.book, CALLS, t, DAY).is_some() {
            let asks: Vec<_> = self.book.open("welfare_check_request").filter(|x| addressed_to(x).contains(&self.me) && !self.taken_calls.contains(&x.id)).cloned().collect();
            for r in asks {
                self.taken_calls.insert(r.id.clone());
                // (To the ground the home stands on, where the request says it: a building may be gone, its ground is there.)
                let d = data(&r);
                let space = as_text(d.get("space"));
                let structure = d.get("at").or_else(|| d.get("structure")).map(|v| as_text(Some(v))).unwrap_or_default();
                let silence = format!("{space}@{}", as_text(d.get("since")));
                if space.is_empty() || structure.is_empty() || self.answered.contains(&silence) {
                    continue;
                }
                self.answered.insert(silence);
                self.calls.push(Call { space, structure });
            }
        }
        // What a call found: whoever died in the home we were asked about (having gone in, we see who left it and why).
        if !self.p.calls_channel.is_empty() {
            for c in visited(pic, &self.p.calls_channel) {
                for sp in c.structure.iter().flat_map(|s| s.spaces.iter()) {
                    if !self.called.remove(&sp.space) {
                        continue;
                    }
                    let left = sp.left.clone().unwrap_or_default();
                    for l in &left {
                        if l.reason != oikos_contracts::events::VacateReason::Died || self.told.contains(&l.occupant) {
                            continue;
                        }
                        self.told.insert(l.occupant.clone());
                        // Someone who went on living there after the death (they left the home more than a day after it)
                        // was at home with it: the death was theirs to report, long ago, and is no finding of ours. Only
                        // a death nobody at home outlived is found by a call.
                        if left.iter().any(|x| x.occupant != l.occupant && x.at > l.at + DAY) {
                            continue;
                        }
                        self.found.push((l.occupant.clone(), sp.space.clone()));
                    }
                }
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let t = pic.t;
        let me = self.me.clone();
        let mut steps: Vec<Step<Then>> = vec![];
        let office = self.position.strip_suffix("-staff").unwrap_or(&self.position).to_string();
        let routines = [
            Routine { task: WARRANTS, at: &self.p.workplace, every: DAY, why: "Setting the officers' work: the tribunal's warrants of possession carried out on their day, as a standing work order." },
            Routine { task: REPORTS, at: &self.p.workplace, every: DAY, why: "Setting the officers' work: reports of goods taken looked into, as a standing work order." },
            Routine { task: CALLS, at: &self.p.workplace, every: DAY, why: "Setting the officers' work: homes the station is asked to call at, as a standing work order." },
        ];
        steps.extend(self.routines.set::<Then>(&self.book, &routines));
        let carrying = self.routines.does(&self.book, WARRANTS, t, DAY).is_some();
        let looking = self.routines.does(&self.book, REPORTS, t, DAY).is_some();
        let calling = self.routines.does(&self.book, CALLS, t, DAY).is_some();
        self.calling_now = calling;
        let workers = self.staff.workers(&self.book, t);
        if self.part != Part::Staff {
            let want = Want {
                target: self.p.officers.max(0),
                wage: self.p.wage,
                can_post: (workers.len() as i64) < self.p.officers,
                why: Some(format!("The station's establishment is {} officers; we have {}: posting a job.", self.p.officers, workers.len())),
                ..Default::default()
            };
            steps.extend(self.staff.routine(pic, &self.book, cx, &self.p.account, &want));
        }

        // What is on our file: the reports we have charged or closed, the warrants we have done, the deaths we have reported.
        let ours = |r: &oikos_sight::Record| r.speaks_for.as_deref() == Some(me.as_str());
        let mut dealt: BTreeSet<String> = self.settled.clone();
        for r in self.book.all("tribunal_application").filter(|r| ours(r)) {
            if data(r).s("kind") == Some("charge") {
                dealt.extend(data(r).s("report").map(String::from));
            }
        }
        for k in ["investigation_closed", "warrant_executed", "warrant_lapsed"] {
            for r in self.book.all(k).filter(|r| ours(r)) {
                dealt.extend(data(r).s("report").or_else(|| data(r).s("warrant")).map(String::from));
            }
        }
        let reported_dead: BTreeSet<String> = self.book.all("death_notification").filter(|r| ours(r)).filter_map(|r| data(r).s("deceased").map(String::from)).collect();
        let registered: BTreeSet<String> =
            self.book.all("death_registration").chain(self.book.all("death_certificate")).filter_map(|r| data(r).s("deceased").map(String::from)).collect();

        // What our investigations found (only we see it): a charge where we found who; else, unsolved.
        for (action, taker) in std::mem::take(&mut self.results) {
            let Some(q) = self.asked.remove(&action) else { continue };
            self.settled.insert(q.report.clone());
            match taker {
                Some(taker) => {
                    let words = format!(
                        "Charge: {taker} took {} from {} at {} (report {}); we ask that they make good the {} it was worth.",
                        q.kind, q.from, q.at, q.report, money_words(q.value, &cx.ctx.world)
                    );
                    let mut d = json!({ "kind": "charge", "against": taker, "victim": q.from, "report": q.report, "amount": q.value,
                        "evidence": { "found": taker, "at": q.at, "goods": q.kind } });
                    if let Some(a) = &q.account {
                        d["account"] = json!(a);
                    }
                    steps.push(Self::st(
                        format!("Our investigation of report {} found who took the {}: {taker}. Charging them.", q.report, q.kind),
                        say("tribunal_application", &words, Say { to: Some(vec![self.p.tribunal.clone()]), visible: Some(Visible::Only(vec![me.clone(), self.p.tribunal.clone(), taker.clone()])), basis: Some(q.report.clone()), data: Some(d), ..Default::default() }),
                    ));
                }
                None => steps.push(Self::st(
                    format!("Our investigation of report {} found nothing to say who took it: unsolved.", q.report),
                    say("investigation_closed", &format!("Report {}: unsolved.", q.report), Say { to: Some(vec![q.from.clone()]), visible: Some(Visible::Only(vec![me.clone(), q.from.clone()])), basis: Some(q.report.clone()), data: Some(json!({ "report": q.report, "solved": false })), ..Default::default() }),
                )),
            }
        }

        // A working day's investigations, as the officers' hours allow.
        let day = t.div_euclid(DAY);
        if day != self.used_day {
            self.used_day = day;
            self.used.clear();
        }
        let mine: BTreeSet<&String> = workers.iter().collect();
        let here: Vec<String> = {
            let occ = self.view.as_ref().and_then(|v| v.spaces.iter().find(|sp| sp.space == self.p.workplace)).and_then(|sp| sp.occupants.clone()).unwrap_or_default();
            let set: BTreeSet<String> = occ.into_iter().filter(|w| mine.contains(w)).collect();
            set.into_iter().collect()
        };
        let free = |used: &BTreeMap<String, i64>, w: &String| self.p.working_day - used.get(w).copied().unwrap_or(0) >= self.p.task_seconds;

        // Found dead at a home we called at: reported to the registry, unless it is registered or we have said so already.
        if calling {
            for (who, space) in std::mem::take(&mut self.found) {
                if registered.contains(&who) || reported_dead.contains(&who) || self.p.registry.is_empty() {
                    continue;
                }
                steps.push(Self::st(
                    format!("Called at {space}, as we were asked to: {who} was found dead there. Reporting the death to the registry."),
                    say("death_notification", &format!("{who} was found dead at {space}."), Say { to: Some(vec![self.p.registry.clone()]), data: Some(json!({ "deceased": who, "found_at": space })), ..Default::default() }),
                ));
            }
        }

        // Warrants of possession: once the tenant has had the notice of the day the warrant gives, an officer with the
        // hours for it goes to the home on a working day and puts out whoever of the household is there; the tenant and
        // the landlord are told it is done. With no officer free it waits for one; one not carried out by its last day
        // lapses, and the landlord must ask again. A tenant the register of deaths shows dead is not put out.
        let mut waiting: Vec<std::sync::Arc<oikos_sight::Record>> = if carrying {
            self.book.open("warrant").filter(|x| addressed_to(x).contains(&me) && !dealt.contains(&x.id)).cloned().collect()
        } else {
            vec![]
        };
        waiting.sort_by(|a, b| filed_before(&a.id, &b.id));
        let mut due = 0;
        let mut carried = 0;
        if day.rem_euclid(7) < self.p.look_days {
            for w in &waiting {
                let d = data(w);
                let (Some(structure), Some(tenant)) = (d.s("structure"), d.s("tenant")) else { continue };
                let not_before = d.i("not_before").unwrap_or(0);
                let until = d.i("until").filter(|u| *u != 0);
                if t < not_before {
                    continue;
                }
                due += 1;
                let landlord = as_text(d.get("landlord"));
                let lease = as_text(d.get("lease"));
                let space = as_text(d.get("space"));
                let household: Vec<String> = match d.get("household") {
                    Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
                    _ => vec![tenant.to_string()],
                };
                let lapse = |steps: &mut Vec<Step<Then>>, why: String, words: String, reason: Option<&str>| {
                    let mut dd = json!({ "warrant": w.id, "lease": lease });
                    if let Some(r) = reason {
                        dd["reason"] = json!(r);
                    }
                    steps.push(Self::st(why, say("warrant_lapsed", &words, Say { to: Some(vec![landlord.clone()]), visible: Some(Visible::Only(vec![me.clone(), landlord.clone()])), basis: Some(w.id.clone()), data: Some(dd), ..Default::default() })));
                };
                if until.is_some_and(|u| t > u + DAY) {
                    self.settled.insert(w.id.clone());
                    lapse(&mut steps, format!("The warrant {} ran out before an officer could carry it out: telling {landlord}.", w.id), format!("Warrant {} was not carried out by its last day, and has lapsed.", w.id), None);
                    continue;
                }
                if registered.contains(tenant) {
                    self.settled.insert(w.id.clone());
                    lapse(
                        &mut steps,
                        format!("The register of deaths shows {tenant} dead: warrant {} is not carried out. Telling {landlord}.", w.id),
                        format!("Warrant {} was not carried out: {tenant} is registered as dead, and has lapsed.", w.id),
                        Some("tenant_dead"),
                    );
                    continue;
                }
                let Some(officer) = here.iter().find(|x| free(&self.used, x)).cloned() else { break };
                self.settled.insert(w.id.clone());
                carried += 1;
                self.routines.did(WARRANTS, t, 1, std::slice::from_ref(&officer));
                *self.used.entry(officer.clone()).or_insert(0) += self.p.task_seconds;
                // (Each on their own: someone not at home is not there to be put out, and comes back to a home that is no
                // longer theirs. The warrant gives the landlord possession whoever is there; what the officer says is what
                // they found: how many of the household were put out, or that nobody was there and nobody was removed.)
                let exec = Executed { warrant: w.id.clone(), lease, tenant: tenant.to_string(), landlord, space: space.clone(), household: household.clone() };
                self.puts.insert(w.id.clone(), 0);
                for (i, who) in household.iter().enumerate() {
                    let c = call("occupancy", vec![("in", Some(arg(structure))), ("who", Some(arg(who))), ("leave", Some(arg("yes")))]);
                    let mut s = Self::st(format!("Carrying out warrant {} at {space}: putting {who} out, if they are there.", w.id), c);
                    s.then = Some(Then::Out { exec: exec.clone(), last: i + 1 == household.len() });
                    steps.push(s);
                }
                if household.is_empty() {
                    // (A warrant naming nobody: the notice that it is done follows at once.)
                    steps.extend(self.executed(&exec, 0, cx));
                }
            }
        }
        // (What the officers say of the warrants: those whose day has come that no officer at the station had the hours for.)
        let left = due - carried;
        if carrying && left > 0 {
            let n = left;
            let why = if !here.is_empty() {
                format!("{n} warrant{} waiting, and none of the officers at the station had the hours for it", if n == 1 { "" } else { "s" })
            } else {
                format!("{n} warrant{} waiting, and none of the {} in post was at the station ({}) when the day's work was set out", if n == 1 { "" } else { "s" }, workers.len(), self.p.workplace)
            };
            self.routines.held_up(WARRANTS, &why);
        }
        let still = waiting.len() as i64 - carried;
        self.routines.note(WARRANTS, (still > 0).then(|| format!("{still} still waiting, the oldest {}", waiting.iter().find(|w| !self.settled.contains(&w.id)).map_or("", |w| w.id.as_str()))));

        // Reports of goods taken, in the order they came, as the officers' hours allow.
        let mut queue: Vec<std::sync::Arc<oikos_sight::Record>> = if looking {
            let under_way: BTreeSet<&str> = self.asked.values().map(|q| q.report.as_str()).collect();
            self.book
                .open("crime_report")
                .filter(|x| addressed_to(x).contains(&me) && x.speaks_for.is_some() && !dealt.contains(&x.id) && !under_way.contains(x.id.as_str()))
                .cloned()
                .collect()
        } else {
            vec![]
        };
        queue.sort_by(|a, b| filed_before(&a.id, &b.id));
        let mut looked = 0;
        for r in &queue {
            let Some(officer) = here.iter().find(|w| free(&self.used, w)).cloned() else { break };
            let d = data(r);
            let q = Inquiry { report: r.id.clone(), from: r.speaks_for.clone().unwrap_or_default(), at: as_text(d.get("at")), kind: as_text(d.get("kind")), value: d.i("value").unwrap_or(0), account: d.s("account").map(String::from) };
            looked += 1;
            self.routines.did(REPORTS, t, 1, std::slice::from_ref(&officer));
            *self.used.entry(officer.clone()).or_insert(0) += self.p.task_seconds;
            let c = call(
                "work",
                vec![
                    ("task", Some(arg(&self.p.task))),
                    ("units", Some(arg("1"))),
                    ("at", Some(arg(&self.p.building))),
                    ("by", Some(json(json!([officer])))),
                    ("investigate", Some(arg(&q.from))),
                    ("taken_at", Some(arg(&q.at))),
                    ("kind", Some(arg(&q.kind))),
                ],
            );
            let mut s = Self::st(format!("Investigating report {}: {} taken from {} at {}.", q.report, q.kind, q.from, q.at), c);
            s.then = Some(Then::Look(q));
            steps.push(s);
        }
        let waiting_reports = queue.len() - looked;
        if looking && waiting_reports > 0 {
            self.routines.note(REPORTS, Some(format!("{waiting_reports} report{} waiting for an officer's hours", if waiting_reports == 1 { "" } else { "s" })));
        } else {
            self.routines.note(REPORTS, None);
        }
        if calling && !self.calls.is_empty() {
            self.routines.note(CALLS, Some(format!("{} home{} still to call at", self.calls.len(), if self.calls.len() == 1 { "" } else { "s" })));
        }
        if self.part == Part::Staff && t >= DAY / 2 {
            let o = ReportOf {
                office: &office,
                from: "the station's officers",
                tasks: vec![(WARRANTS, "days' work", Some("warrants carried out")), (REPORTS, "days' work", Some("reports looked into")), (CALLS, "days' work", Some("homes called at"))],
                in_post: Some(workers.clone()),
                ..Default::default()
            };
            steps.extend(self.routines.report::<Then>(&self.book, cx, &o));
        }
        steps
    }

    fn until(&self, pic: &Picture) -> Option<i64> {
        (self.p.look_at > 0).then(|| next_look(pic.t, self.p.look_at, self.p.look_days))
    }

    /// Going to the homes we are asked to call at (an officer's going: it takes the station's time; what is found comes
    /// when they are back).
    fn looks(&mut self, _pic: &Picture) -> Vec<LookRequest> {
        if self.p.calls_channel.is_empty() || self.calls.is_empty() || !self.calling_now {
            return vec![];
        }
        let n = self.calls.len().min(VISIT_MAX);
        let go: Vec<Call> = self.calls.drain(..n).collect();
        let mut places: Vec<String> = vec![];
        for c in &go {
            self.called.insert(c.space.clone());
            if !places.contains(&c.structure) {
                places.push(c.structure.clone());
            }
        }
        vec![go_see(&self.p.calls_channel, &places)]
    }

    fn then(&mut self, token: &Then, done: Done, cx: &mut Cx) -> Vec<Step<Then>> {
        match token {
            Then::Look(q) => {
                match done {
                    Done::Outcome(o) if o.status == oikos_sight::OutcomeStatus::Applied => {
                        self.asked.insert(o.action.clone(), q.clone());
                    }
                    other => {
                        // (Not done: the report stays on the file unanswered and is taken up again.)
                        self.routines.undid(REPORTS, 1);
                        if let Done::Outcome(o) = other {
                            if let Some((Some(who), left)) = out_of_time(o) {
                                self.used.insert(who, self.p.working_day - left);
                            }
                        }
                    }
                }
                vec![]
            }
            Then::Out { exec, last } => {
                if done.applied() {
                    *self.puts.entry(exec.warrant.clone()).or_insert(0) += 1;
                }
                if !*last {
                    return vec![];
                }
                let put = self.puts.remove(&exec.warrant).unwrap_or(0);
                self.executed(exec, put, cx)
            }
        }
    }
}

impl Police {
    /// The notice that a warrant has been carried out, telling both what was found.
    fn executed(&self, e: &Executed, put: i64, cx: &Cx) -> Vec<Step<Then>> {
        let hours = (self.p.task_seconds + 1800).div_euclid(3600);
        let _ = cx;
        let why = if put > 0 {
            format!("Warrant {} carried out at {} ({hours} hours of an officer's day): {put} of the household put out; possession is {}'s. Telling both.", e.warrant, e.space, e.landlord)
        } else {
            format!("Warrant {} carried out at {} ({hours} hours of an officer's day): nobody of the household was there, and nobody was removed; possession is {}'s. Telling both.", e.warrant, e.space, e.landlord)
        };
        let words = format!("Warrant {} has been carried out at {}: of {} and their household, {put} were there and were put out. Possession is {}'s.", e.warrant, e.space, e.tenant, e.landlord);
        let mut visible: Vec<String> = vec![self.me.clone(), e.tenant.clone(), e.landlord.clone()];
        visible.extend(e.household.iter().cloned());
        let mut seen = BTreeSet::new();
        visible.retain(|x| seen.insert(x.clone()));
        let d = json!({ "warrant": e.warrant, "lease": e.lease, "tenant": e.tenant, "space": e.space, "household": e.household, "removed": put });
        vec![Self::st(why, say("warrant_executed", &words, Say { to: Some(vec![e.tenant.clone(), e.landlord.clone()]), visible: Some(Visible::Only(visible)), basis: Some(e.warrant.clone()), data: Some(d), ..Default::default() }))]
    }
}

#[cfg(test)]
pub(crate) mod tests;
