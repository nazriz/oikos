//! The registries (participants/src/behaviour/institutions.ts, `landRegistry`, `registry`, `childProtection`;
//! docs/behaviour/ownership.md, institutions.md, deaths.md).
//!
//! - **land.registry** keeps the register of land (after a Torrens registry: title is by registration). The plans of
//!   the lots and every title and dealing are its register, and it alone is shown them whole; anyone else asks it about
//!   one lot or one title. What it does itself: a transmission on death, asked by the registrar of deaths (each title
//!   the dead person held passes to the heir named), and notices of acquisition to the bodies that keep a roll of
//!   their own from such notices.
//! - **city.registry** is the registry of births, deaths and marriages: a notification of a death or a birth is
//!   entered in its register, and the entry sent to whoever reported it and those entitled.
//! - **city.child_protection** takes children left with no adult at home into care elsewhere.
//!
//! Ported to Rust. Decided fresh:
//! - **The file is the memory** (bug hunt 2026-10-17, finding 2): which dealings have been noticed, which
//!   applications passed, which deaths and births registered is read from the papers on file (the registrar's own
//!   entries and the land registry's own notices and transfers); sets kept here only bridge the time an act takes to
//!   reach the file. A new registrar does not register a death twice or apply for a transmission again.
//! - **PB-19, a keeper's post must be staffed to its load.** These three are keepers whose answers take the time of
//!   whoever holds their posts (foundations F11). Each declares in its manifest its `capacity`: the asks it expects
//!   per resident a year and the seconds an answer takes, so the generator sizes the counter with
//!   `oikos_rules::staffing::clerks_needed` from the population instead of one clerk whatever the town's size
//!   (docs/risks.md PB-19; real registries are staffed to caseload: a national land registry's annual report
//!   (to confirm); Registrar General annual reports (to confirm)).

use super::{spread, Booked, Noting};
use crate::common::work::ReportOf;
use crate::common::{data, ClaimKey, Fields, Letters, Part, StandingWork, CounterWork, Book, DAY};
use crate::steps::{arg, because, call, say, Plan, Say, Step, Visible};
use crate::{Actor, Cx, Ctx, Kind, Picture};
use oikos_rules::forms::Answers;
use oikos_sight::{Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::sync::Arc;

pub struct LandRegistry;
pub struct CityRegistry;
pub struct ChildProtection;

fn answers_land() -> Answers {
    Answers { office: "the land registry".into(), acts: "What it acts on: a question about one lot or one title, asked of the register; a transfer of a title by its holder; and an application for a dead owner's land to pass.".into(), forms: vec![], report: true }
}
fn answers_registry() -> Answers {
    Answers { office: "the registry of births, deaths and marriages".into(), acts: "What it acts on: a notification of a death or of a birth, which it enters in its register; it sends the entry to whoever reported it and to those the notification names.".into(), forms: vec![], report: true }
}
fn answers_care() -> Answers {
    Answers { office: "the child protection office".into(), acts: "What it acts on: an entry of a death that leaves children with no adult at home.".into(), forms: vec![], report: true }
}

/// What a keeper declares of its load, for the generator to staff its counter (PB-19): asks per resident a year, the
/// seconds an answer takes, and what the figures are (placeholders until sourced).
fn capacity(asks_per_1000_residents_year: i64, why: &str) -> Value {
    json!({ "asks_per_1000_residents_year": asks_per_1000_residents_year, "seconds_per_answer": 600, "source": "placeholder", "why": why, "sized_by": "oikos_rules::staffing::clerks_needed" })
}

fn param(schema: Value, default: Value) -> Value {
    json!({ "schema": schema, "default": default, "source": "placeholder" })
}

// ------------------------------------------------------------------------------------------------ land.registry

impl Kind for LandRegistry {
    fn name(&self) -> &'static str {
        "land.registry"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/ownership.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": { "notify": param(json!({ "type": "array" }), json!([])) },
            "perceives": [], "state": "none",
            "keeps": [
                { "what": "lot", "why": "The land registry makes the register of land: the plan of each lot is part of it." },
                { "what": "records:claim", "why": "The register of land it keeps: every title is made by being entered in it." },
                { "what": "records:claim_transfer", "why": "The register of land it keeps: every dealing in a title." },
                { "what": "records:claim_release", "why": "The register of land it keeps: every title given up." },
                { "what": "records:withdrawal", "why": "The register of land it keeps: what has been struck from it." },
            ],
            "capacity": capacity(2_000, "questions about a lot or a title, asked of the register, answered one at a time by its clerks"),
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        spread(ctx, 0, 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Noting::new(LandPlan { notify: ctx.param("notify", vec![])?, book: Book::new(), letters: Letters::default(), passed_now: BTreeSet::new(), noticed_now: BTreeSet::new() })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Noting::<LandPlan>::restore(saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct LandPlan {
    notify: Vec<String>,
    book: Book,
    letters: Letters,
    /// Applications and dealings dealt with this wake or the last (the file says the same once the acts are on it).
    passed_now: BTreeSet<String>,
    noticed_now: BTreeSet<String>,
}

impl Booked for LandPlan {
    fn book_mut(&mut self) -> &mut Book {
        &mut self.book
    }
}

fn title<'a>(book: &'a Book, id: &str) -> Option<(&'a Arc<Record>, String)> {
    let c = book.get(id)?;
    match &c.body {
        RecordBody::Claim { about, .. } if about.s("kind") == Some("ownership") => about.s("object").map(|o| (c, o.to_string())),
        _ => None,
    }
}

impl Plan for LandPlan {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.letters.take(pic, &self.book);
    }
    fn plan(&mut self, _pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let me = cx.ctx.entity.clone();
        let mut steps: Vec<Step<()>> = vec![];
        // Land that has changed hands: a notice to those who keep a roll from such notices, once for each dealing (read
        // from the notices of acquisition already on the register's file).
        if !self.notify.is_empty() {
            let noticed: BTreeSet<String> = self.book.all("acquisition_notice").filter(|r| r.speaks_for.as_deref() == Some(me.as_str())).flat_map(|r| crate::common::bases_of(r).iter().map(|x| x.to_string()).collect::<Vec<_>>()).collect();
            let transfers: Vec<Arc<Record>> = self.book.of_type("claim_transfer").cloned().collect();
            for r in transfers {
                let RecordBody::ClaimTransfer { claim, to } = &r.body else { continue };
                if noticed.contains(r.id.as_str()) || self.noticed_now.contains(r.id.as_str()) {
                    continue;
                }
                let Some((c, lot)) = title(&self.book, claim) else { continue };
                if super::land::owner_of(&self.book, &lot).as_deref() != Some(to.as_str()) {
                    continue;
                }
                self.noticed_now.insert(r.id.to_string());
                let mut seen = vec![me.clone()];
                seen.extend(self.notify.clone());
                steps.push(because(
                    format!("{lot} has passed to {to}: telling {}.", self.notify.join(", ")),
                    vec![say("acquisition_notice", &format!("Notice of acquisition: {lot} is now {to}'s."), Say { visible: Some(Visible::Only(seen)), basis: Some(r.id.to_string()), data: Some(json!({ "lot": lot, "owner": to, "title": c.id })), ..Default::default() })],
                ));
            }
        }
        // A transmission on death: each title the dead person held passes to the heir named.
        let done: BTreeSet<String> = self.book.of_type("claim_transfer").filter(|r| r.speaks_for.as_deref() == Some(me.as_str())).flat_map(|r| crate::common::bases_of(r).iter().map(|x| x.to_string()).collect::<Vec<_>>()).collect();
        let apps: Vec<Arc<Record>> = self.book.open("transmission_application").filter(|a| { crate::common::addressed_to(a).iter().any(|x| x == &me) && !done.contains(a.id.as_str()) && !self.passed_now.contains(a.id.as_str()) }).cloned().collect();
        for a in apps {
            self.passed_now.insert(a.id.to_string());
            let d = data(&a);
            let (Some(who), Some(heir)) = (d.s("deceased"), d.s("heir")) else { continue };
            let mut lots: BTreeSet<String> = BTreeSet::new();
            for c in self.book.claims_by(ClaimKey::Holder, who) {
                if !self.book.released(&c.id) && !self.book.withdrawn(&c.id) {
                    if let RecordBody::Claim { about, .. } = &c.body {
                        if about.s("kind") == Some("ownership") {
                            lots.extend(about.s("object").map(String::from));
                        }
                    }
                }
            }
            for r in self.book.of_type("claim_transfer") {
                if let RecordBody::ClaimTransfer { claim, to } = &r.body {
                    if to == who {
                        lots.extend(title(&self.book, claim).map(|x| x.1));
                    }
                }
            }
            for lot in lots {
                if super::land::owner_of(&self.book, &lot).as_deref() != Some(who) {
                    continue;
                }
                let t = self.book.claims_by(ClaimKey::Object, &lot).find(|c| !self.book.released(&c.id) && !self.book.withdrawn(&c.id) && matches!(&c.body, RecordBody::Claim { about, .. } if about.s("kind") == Some("ownership")));
                let Some(t) = t else { continue };
                steps.push(because(
                    format!("{who} held {lot}, and has died: entering its transmission to their heir, {heir}."),
                    vec![call("claim", vec![("transfer", Some(arg(&t.id))), ("to", Some(arg(heir))), ("basis", Some(arg(&a.id)))])],
                ));
            }
        }
        let lots = self.book.open("lot").count();
        let passed = self.book.of_type("claim_transfer").filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && !crate::common::bases_of(r).is_empty()).count();
        let told = self.book.all("acquisition_notice").filter(|r| r.speaks_for.as_deref() == Some(me.as_str())).count();
        steps.extend(self.letters.answer(Some(&answers_land()), "Letters to the land registry: answering each with the registry's report.", |_| {
            format!("Report from the land registry: {lots} lots on the register; {passed} titles passed on a death, {told} notices of acquisition sent. To know who owns a lot, search the register for the lot or the title.")
        }));
        steps
    }
}

// ------------------------------------------------------------------------------------------------ city.registry

impl Kind for CityRegistry {
    fn name(&self) -> &'static str {
        "city.registry"
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
                "counter": param(json!({ "type": "boolean" }), json!(false)),
                "estate_tells": param(json!({ "type": "array" }), json!([])),
                "feeds": param(json!({ "type": "array" }), json!([])),
                "land_registry": param(json!({ "type": "string" }), json!("")),
                "office": param(json!({ "type": "string" }), json!("")),
                "part": param(json!({ "type": "string" }), json!("")),
            },
            "perceives": [], "state": "none",
            "issues": super::forms_issued("REGISTRY"),
            "routines": [{
                "task": "answer", "at": "office", "every": 1,
                "what": "The office's counter staff enter in the register each notification of a death or of a birth that comes to the office, and those entitled are told, each working day, so that the registrar is not brought back for it.",
                "papers": [
                    { "kind": "death_notification", "how": "entered in the register from the notification, and those entitled are told of the entry" },
                    { "kind": "birth_notification", "how": "entered in the register from the notification, and those entitled are told of the entry" },
                ],
            }],
            "capacity": capacity(100, "notifications of deaths and births, and requests for certified copies, entered by the counter staff"),
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        spread(ctx, 0, 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let part = Part::from_param(&ctx.param("part", String::new())?);
        let offices = ctx.position.as_ref().map(|p| p.trim_end_matches("-staff").to_string()).into_iter();
        Ok(Box::new(Noting::new(RegistryPlan {
            feeds: ctx.param("feeds", vec![])?,
            estate_tells: ctx.param("estate_tells", vec![])?,
            land_registry: ctx.param("land_registry", String::new())?,
            office: ctx.param("office", String::new())?,
            part,
            book: Book::new(),
            letters: Letters::default(),
            routines: StandingWork::new(&ctx.entity, part, offices),
            counter: CounterWork::new(ctx.param("counter", false)?),
            read: BTreeSet::new(),
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Noting::<RegistryPlan>::restore(saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct RegistryPlan {
    feeds: Vec<String>,
    estate_tells: Vec<String>,
    land_registry: String,
    office: String,
    part: Part,
    book: Book,
    letters: Letters,
    routines: StandingWork,
    counter: CounterWork,
    /// Notifications dealt with this wake or the last; the register on file says the same afterwards.
    read: BTreeSet<String>,
}

impl Booked for RegistryPlan {
    fn book_mut(&mut self) -> &mut Book {
        &mut self.book
    }
}

fn dedup(v: impl IntoIterator<Item = String>, not: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for x in v {
        if x != not && !out.contains(&x) {
            out.push(x);
        }
    }
    out
}

impl Plan for RegistryPlan {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        if self.part != Part::Staff {
            self.letters.take(pic, &self.book);
        }
    }
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let (t, me) = (pic.t, pic.entity);
        let mut steps: Vec<Step<()>> = vec![];
        let office = if !self.office.is_empty() { self.office.clone() } else { cx.ctx.position.clone().unwrap_or_else(|| "office".into()) };
        steps.extend(self.routines.set(&self.book, self.counter.order(&office).as_slice()));
        let counting = self.counter.works(&self.routines, &self.book, t);
        if counting {
            // The register: every entry is on its own file, so what is registered is read from it.
            let entries: Vec<Arc<Record>> = self.book.all("death_registration").cloned().collect();
            let mut registered: BTreeSet<String> = entries.iter().filter_map(|r| data(r).s("deceased").map(String::from)).collect();
            let certified: BTreeSet<(String, String)> = self
                .book
                .all("death_certificate")
                .filter(|r| r.speaks_for.as_deref() == Some(me.as_str()))
                .flat_map(|r| crate::common::addressed_to(r).iter().flat_map(|to| crate::common::bases_of(r).iter().map(|b| (b.to_string(), to.to_string())).collect::<Vec<_>>()).collect::<Vec<_>>())
                .collect();
            let notes: Vec<Arc<Record>> = self.book.open("death_notification").filter(|n| crate::common::addressed_to(n).iter().any(|x| x == &me.to_string())).cloned().collect();
            for n in notes {
                let d = data(&n).clone();
                let Some(who) = d.s("deceased").map(String::from) else { continue };
                if self.read.contains(n.id.as_str()) || entries.iter().any(|e| crate::common::cites(e, &n.id)) {
                    continue;
                }
                self.read.insert(n.id.to_string());
                self.counter.answered(&self.routines, "death_notification");
                let by = n.speaks_for.unwrap_or_default();
                if registered.contains(&who) {
                    // Already registered, and reported again by someone who was not sent the entry: a certified copy.
                    if let Some(entry) = entries.iter().find(|e| data(e).s("deceased") == Some(who.as_str())) {
                        if !by.is_empty() && by != me && !crate::common::addressed_to(entry).iter().any(|x| x == &by.to_string()) && !certified.contains(&(entry.id.to_string(), by.to_string())) {
                            steps.push(because(
                                format!("{who}'s death is reported to us again (by {by}): it is registered already; sending them a certified copy of the entry."),
                                vec![say("death_certificate", &format!("Death of {who}: registered (entry {}).", entry.id), Say { to: Some(vec![by.to_string()]), basis: Some(entry.id.to_string()), data: Some(json!({ "deceased": who, "registration": entry.id })), ..Default::default() })],
                            ));
                        }
                    }
                    continue;
                }
                registered.insert(who.clone());
                // The entry is the register's, and nobody is shown the register: it is sent to whoever reported the death,
                // to those they named as having had dealings with the dead person, to those sent every entry as of right,
                // and, where nobody of the family reported it, to those the town writes to as the estate's administrator.
                let family = d.get("children").is_some_and(Value::is_array);
                let mut told: Vec<String> = vec![by.to_string()];
                told.extend(d.ids("tell").into_iter().map(String::from));
                told.extend(self.feeds.clone());
                if !family {
                    told.extend(self.estate_tells.clone());
                }
                let told = dedup(told, &me).into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>();
                let mut seen = vec![me.to_string()];
                seen.extend(told.clone());
                let mut entry = json!({ "deceased": who, "reported_by": by, "children": d.get("children").cloned().unwrap_or(json!([])), "without_adult": d.get("without_adult").cloned().unwrap_or(json!([])) });
                if let Some(p) = d.get("partner").filter(|v| crate::common::truthy(v)) {
                    entry["partner"] = p.clone();
                }
                steps.push(because(
                    format!("A death is reported to us ({who}, by {by}): registering it, and telling {}.", if told.is_empty() { "nobody else".to_string() } else { told.join(", ") }),
                    vec![say("death_registration", &format!("Death registered: {who}."), Say { basis: Some(n.id.to_string()), to: Some(told), visible: Some(Visible::Only(seen.iter().map(|x| x.to_string()).collect())), data: Some(entry), ..Default::default() })],
                ));
                // The land the deceased held passes to their heir, as the succession law says (the partner; else the
                // eldest adult child; else the town). The register of land is the land registry's: we apply to it.
                let heir = d.s("partner").map(String::from).or_else(|| d.ids("adult_children").first().map(|s| s.to_string())).unwrap_or_else(|| me.to_string());
                if !self.land_registry.is_empty() {
                    steps.push(because(
                        format!("{who} has died: applying to the land registry for whatever land they held to pass to their heir, {heir}, as the law of succession says."),
                        vec![say("transmission_application", &format!("Transmission on death: whatever land {who} held passes to {heir}."), Say { to: Some(vec![self.land_registry.clone()]), basis: Some(n.id.to_string()), data: Some(json!({ "deceased": who, "heir": heir })), ..Default::default() })],
                    ));
                }
            }
            // A birth reported to us: registered, and the entry sent to whoever reported it and to those sent every entry.
            let born: BTreeSet<String> = self.book.all("birth_registration").filter_map(|r| data(r).s("child").map(String::from)).collect();
            let mut born = born;
            let notes: Vec<Arc<Record>> = self.book.open("birth_notification").filter(|n| crate::common::addressed_to(n).iter().any(|x| x == &me.to_string())).cloned().collect();
            for n in notes {
                let d = data(&n).clone();
                let Some(child) = d.s("child").map(String::from) else { continue };
                if born.contains(&child) || self.read.contains(n.id.as_str()) {
                    continue;
                }
                born.insert(child.clone());
                self.read.insert(n.id.to_string());
                self.counter.answered(&self.routines, "birth_notification");
                let mut told = vec![n.speaks_for.map(|x| x.to_string()).unwrap_or_default()];
                told.extend(self.feeds.clone());
                let told = dedup(told, &me).into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>();
                let mut seen = vec![me.to_string()];
                seen.extend(told.clone());
                steps.push(because(
                    format!("A birth is reported to us ({child}, by {}): registering it.", n.speaks_for.unwrap_or_default()),
                    vec![say("birth_registration", &format!("Birth registered: {child}."), Say { basis: Some(n.id.to_string()), to: Some(told), visible: Some(Visible::Only(seen.iter().map(|x| x.to_string()).collect())), data: Some(json!({ "child": child, "born_at": d.get("born_at"), "mother": d.get("mother") })), ..Default::default() })],
                ));
            }
            self.counter.flush(&mut self.routines, t);
        }
        if self.part == Part::Staff && self.counter.offered {
            let office = cx.ctx.position.clone().unwrap_or_default().trim_end_matches("-staff").to_string();
            let tasks: Vec<_> = self.counter.tasks().into_iter().collect();
            let report: Vec<Step<()>> = self.routines.report(&self.book, cx, &ReportOf { office: &office, from: "the registry's counter staff", tasks, ..Default::default() });
            self.counter.reported(&mut self.routines, &report);
            steps.extend(report);
        }
        if self.part != Part::Staff {
            let deaths: BTreeSet<String> = self.book.all("death_registration").filter_map(|r| data(r).s("deceased").map(String::from)).collect();
            let births = self.book.all("birth_registration").count();
            steps.extend(self.letters.answer(Some(&answers_registry()), "Letters to the registrar: answering each with the register's report.", |_| {
                format!(
                    "Report from the registrar: {}{} deaths registered{}.",
                    if births > 0 { format!("{births} births and ") } else { String::new() },
                    deaths.len(),
                    if deaths.is_empty() { String::new() } else { format!(" ({})", deaths.iter().cloned().collect::<Vec<_>>().join(", ")) }
                )
            }));
        }
        steps
    }
}

// ------------------------------------------------------------------------------------------------ city.child_protection

impl Kind for ChildProtection {
    fn name(&self) -> &'static str {
        "city.child_protection"
    }
    fn version(&self) -> &'static str {
        "0.3.1"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/institutions.md"
    }
    fn manifest(&self) -> Value {
        json!({ "name": self.name(), "version": self.version(), "doc": self.doc(), "params": {}, "perceives": [], "state": "none" })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, _: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Noting::new(CarePlan { book: Book::new(), letters: Letters::default(), taken: BTreeSet::new() })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Noting::<CarePlan>::restore(saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct CarePlan {
    book: Book,
    letters: Letters,
    /// Children taken into care. (A child taken leaves the town and no paper records it; a successor who sends the
    /// order again for a child already gone is refused harmlessly.)
    taken: BTreeSet<String>,
}

impl Booked for CarePlan {
    fn book_mut(&mut self) -> &mut Book {
        &mut self.book
    }
}

impl Plan for CarePlan {
    type Then = ();
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.letters.take(pic, &self.book);
    }
    fn plan(&mut self, _: &Picture, _: &mut Cx) -> Vec<Step<()>> {
        let mut steps: Vec<Step<()>> = vec![];
        let mut children: Vec<String> = vec![];
        for r in self.book.all("death_registration") {
            children.extend(data(r).ids("without_adult").into_iter().map(String::from));
        }
        for r in self.book.all("care_request") {
            children.extend(data(r).ids("children").into_iter().map(String::from));
        }
        for c in children {
            if !self.taken.insert(c.clone()) {
                continue;
            }
            steps.push(because("A child with no adult at home: taking them into care elsewhere.", vec![call("presence", vec![("who", Some(arg(&c))), ("leave", Some(arg("yes")))])]));
        }
        let n = self.taken.len();
        steps.extend(self.letters.answer(Some(&answers_care()), "Letters to the child protection office: answering each with its report.", |_| {
            format!("Report from the child protection office: {n} children taken into care elsewhere (the town has no foster homes).")
        }));
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::{st, Rig, DAY};
    use super::*;

    #[test]
    fn a_death_is_registered_once_told_to_those_entitled_and_land_asked_to_pass_even_after_a_change_of_registrar() {
        let t0 = 10 * DAY;
        let n = st("rec.1", t0 - 100, "death_notification", "c0002", &["registry"], json!({ "deceased": "c0001", "partner": "c0002", "children": [], "without_adult": [] }));
        let mut r = Rig::new(&CityRegistry, "registry", None, json!({ "feeds": ["support"], "land_registry": "land" }));
        let out = r.day(t0, &[n.clone()]).join("\n");
        assert!(out.contains("kind=death_registration") && out.contains("support") && out.contains("kind=transmission_application"), "{out}");
        assert!(r.day(t0 + DAY, &[]).is_empty(), "once");
        // A new registrar, shown the register's own entry, does not register it again.
        let mut entry = st("rec.2", t0, "death_registration", "registry", &["c0002", "support"], json!({ "deceased": "c0001" }));
        entry["basis"] = json!("rec.1");
        let mut s = Rig::new(&CityRegistry, "registry", None, json!({ "feeds": ["support"], "land_registry": "land" }));
        assert!(s.day(t0 + 2 * DAY, &[n, entry]).is_empty());
    }

    #[test]
    fn a_death_reported_again_by_one_not_sent_the_entry_gets_a_certified_copy_once() {
        let t0 = 10 * DAY;
        let mut e = st("rec.2", t0, "death_registration", "registry", &["c0002"], json!({ "deceased": "c0001" }));
        e["basis"] = json!("rec.1");
        let again = st("rec.3", t0 + DAY, "death_notification", "landlord", &["registry"], json!({ "deceased": "c0001" }));
        let mut r = Rig::new(&CityRegistry, "registry", None, json!({}));
        let out = r.day(t0 + 2 * DAY, &[e, again]).join("\n");
        assert!(out.contains("kind=death_certificate"), "{out}");
        assert!(r.day(t0 + 3 * DAY, &[]).is_empty());
    }

    #[test]
    fn a_transmission_passes_the_dead_owners_title_to_the_heir() {
        let title = json!({ "id": "rec.5", "record": "claim", "author": "p.x", "speaks_for": "land", "at": 0, "visible_to": "public", "position": "right", "holder": "c0001", "about": { "kind": "ownership", "object": "lot-9" } });
        let app = st("rec.6", DAY, "transmission_application", "registry", &["land"], json!({ "deceased": "c0001", "heir": "c0002" }));
        let mut r = Rig::new(&LandRegistry, "land", None, json!({}));
        let out = r.day(2 * DAY, &[title, app]).join("\n");
        assert!(out.contains("claim(") && out.contains("transfer=rec.5") && out.contains("to=c0002"), "{out}");
    }

    #[test]
    fn a_child_with_no_adult_is_taken_into_care_once() {
        let e = st("rec.2", DAY, "death_registration", "registry", &[], json!({ "deceased": "c0001", "without_adult": ["k1"] }));
        let mut r = Rig::new(&ChildProtection, "care", None, json!({}));
        let out = r.day(2 * DAY, &[e]).join("\n");
        assert!(out.contains("presence(") && out.contains("k1"), "{out}");
        assert!(r.day(3 * DAY, &[]).is_empty());
    }

    #[test]
    fn the_manifests_are_the_ones_the_ts_modules_wrote() {
        for (kind, name) in [(&LandRegistry as &dyn Kind, "land.registry"), (&CityRegistry as &dyn Kind, "city.registry"), (&ChildProtection as &dyn Kind, "city.child_protection")] {
            let ts: Value = crate::offices::testing::ts_manifest(name);
            let rust = kind.manifest();
            for (k, v) in ts.as_object().unwrap() {
                assert_eq!(&rust[k], v, "{name}: {k}");
            }
        }
    }
}
