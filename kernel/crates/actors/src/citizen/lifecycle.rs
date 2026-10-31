//! Lifecycle (citizen.ts): births, deaths seen at home and at work, a silent home next door, leaving town, a
//! child's wake, school and care, the daily round (docs/behaviour/households.md, deaths.md, education.md, health.md).
//!
//! Ported: citizen.ts 1556-1728 (`remarkedAfter`, `wonderNextDoor`, `seeDeathAtWork`, `seeDeathAtHome`), 1821-1863
//! (births), 3352-3389 (leaving town), 4253-4350 (the daily round), 4548-4622 (school, the body, care), 4786-4834
//! (the child's wake).
//!
//! Decided fresh (docs/port-guide.md, section 2):
//! - **Whom a death is told to** (the bug hunt of 2026-10-17, #3; firm.landlord 0.20.0). TS named the landlord in the
//!   notification's `tell` only when the one reporting held a lease of their own, so where a non-leaseholder reported,
//!   or the dead held the lease, the landlord never had the registry's entry and chased the dead. The report still goes
//!   to the registry from whoever of the household sees the death (TS's reporter rule); the landlord is never written to
//!   by a citizen, it is told by the registry's entry, so the reporter names it in `tell` wherever the household knows
//!   it: our own lease's landlord, the landlord the household's record carries (`landlord`, read leniently), or the one
//!   we remember from when we held or lived under the household's lease (`Lifecycle::landlord`). The household's record
//!   written here carries `landlord` where we know it, so the next reporter can name it.
//! - Rounding: TS's `Math.round` of a non-negative value half up; days in words floored as TS did.
//! - A child's sex unknown at birth (the kernel always gives it) is written as the household's first, female.
//! - A sale before leaving town is housing's (`sell` is its own); here an owner does not leave until sold, and once
//!   sold (`Housing::sold_and_going`) leaves at the leaving step of the plan, not after the week's other parts.

use super::household::SAYING;
use super::mind::{Event, Heard};
use super::params::Params;
use super::person::{cells, inside, spaces, Mark, Person, Todo, Week};
use crate::common::calls::{move_in, move_out, withdraw};
use crate::common::{addressed_to, data, letters::message, next_look, stood_empty, structure_of, Fields, DAY, MONTH};
use crate::papers::citizen::{BirthNotification, CareRequest, DeathNotification, SchoolEnrolment, SickLeave, WelfareCheckRequest};
use crate::steps::{arg, because, call, say, text, Say, Step, Visible};
use crate::Cx;
use oikos_contracts::events::{RefusalCode, VacateReason};
use oikos_rules::household::{age_at, HouseholdData, Member, Sex, ADULT_YEARS};
use oikos_sight::{OutcomeStatus, Picture, Seen, SiteSpace};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// A home we wonder about: when the silence will have gone on long enough to ask.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Wonder {
    pub space: String,
    pub structure: String,
    pub at: String,
    pub since: i64,
    pub due: i64,
}

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Lifecycle {
    /// Homes we have wondered about (someone went in and never came out; a neighbour who died and whose home has stood
    /// empty), and those we have asked the police about; the next-door view's moment last read.
    pub wondered: BTreeMap<String, Wonder>,
    pub asked_about: BTreeSet<String>,
    pub next_door_as_of: i64,
    /// A guest's death: when we first saw it, and left it to their own to report.
    pub host_saw_death: BTreeMap<String, i64>,
    /// As a child: asked for help once no adult of the household is left; deaths we have told an adult of.
    pub asked_for_care: bool,
    pub told_of: BTreeSet<String>,
    /// Children we already knew of (from the start), a pregnancy's end, and when we next think about it.
    pub known_children: Option<BTreeSet<String>>,
    pub expecting_until: i64,
    pub next_fertility: i64,
    /// The daily round: a place the world refused us until then; our home under water until then.
    pub refused_go: Option<(String, i64)>,
    pub flooded_out: Option<(String, i64)>,
    /// The vehicle the round move we sent last went by, and a vehicle the world said was not ours to take then (law 9:
    /// another of the household took it, or it is not where we are): that go again on foot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drove: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub walk_next: bool,
    /// The body: the workplace we're off sick from; at the clinic (the condition, since); conditions we sought care for.
    pub off_sick: Option<String>,
    pub at_clinic: Option<(String, i64)>,
    pub sought_care: BTreeSet<String>,
    /// School: when we last asked for a place; places we have gone to.
    pub asked_school: i64,
    pub tried_place: BTreeSet<String>,
    /// A child's record: written once, then a month at a time.
    pub child_recorded: bool,
    /// The household's landlord as we last knew it (from our own lease, or the household's record).
    pub landlord: Option<String>,
}

impl Lifecycle {
    pub fn new(_p: &Params, cx: &mut Cx) -> Self {
        Lifecycle { next_door_as_of: -1, asked_school: -1, next_fertility: cx.rng("fertility-day").below(30) as i64 * DAY, ..Lifecycle::default() }
    }
}

fn died(r: VacateReason) -> bool {
    r == VacateReason::Died
}
fn sex_of(s: Option<oikos_contracts::vocab::Sex>) -> Sex {
    match s {
        Some(oikos_contracts::vocab::Sex::Male) => Sex::Male,
        _ => Sex::Female,
    }
}
fn has(sp: &SiteSpace, who: &str) -> bool {
    sp.occupants.as_ref().is_some_and(|o| o.iter().any(|x| x == who))
}
/// TS `Math.round(n / d)` for non-negative n, half up.
fn round_div(n: i64, d: i64) -> i64 {
    (2 * n + d) / (2 * d).max(1)
}
fn household_words(members: &[Member]) -> String {
    format!("Household: {}.", members.iter().map(|m| m.person.as_str()).collect::<Vec<_>>().join(", "))
}

impl Person {
    fn of_household(&self, person: &str) -> bool {
        self.s.household.as_ref().is_some_and(|h| h.members.iter().any(|m| m.person == person))
    }
    fn adult_body(&self, pic: &Picture, t: i64) -> bool {
        pic.body.as_ref().is_some_and(|b| t - b.born_at >= ADULT_YEARS * self.p.year)
    }
    fn our_home(&self) -> Option<String> {
        self.s.home.as_ref().map(|h| h.space.clone()).or_else(|| self.s.living_at.clone())
    }

    /// The household's landlord as far as we know it: our own lease's, else what the household's record carries, else
    /// the one we last knew (see the module's head).
    pub fn household_landlord(&mut self) -> Option<String> {
        if let Some(h) = self.s.home.as_ref() {
            if h.owned {
                return None;
            }
            self.lifecycle.landlord = Some(h.landlord.clone());
            return Some(h.landlord.clone());
        }
        let recorded = self.s.household_record.as_ref().and_then(|id| self.book.get(id)).and_then(|r| data(r).s("landlord").map(String::from));
        if recorded.is_some() {
            self.lifecycle.landlord.clone_from(&recorded);
            return recorded;
        }
        self.lifecycle.landlord.clone().filter(|_| self.s.living_at.is_some())
    }

    /// A household record as we write it: the members and couples, who holds the lease, and its landlord if we know it.
    fn household_data(&mut self, hh: &HouseholdData) -> Value {
        let mut v = serde_json::to_value(hh).unwrap_or(Value::Null);
        if let Some(l) = self.household_landlord() {
            v["landlord"] = json!(l);
        }
        v
    }

    // ------------------------------------------------------------------ a silent home next door (citizen.ts 1559-1621)

    /// How long a silence in a home goes before anybody remarks on it: a band by its share, then any moment in it. The
    /// draw is the home's, not ours (whoever lives beside it would wait as long): `chance`.
    fn remarked_after(&self, key: &str, cx: &mut Cx) -> i64 {
        let bands = self.p.welfare.as_ref().map_or(&[][..], |w| &w.found_after[..]);
        let total: i64 = bands.iter().map(|b| b.bps).sum();
        if total <= 0 {
            return 0;
        }
        let mut rng = cx.chance(&format!("unremarked-{key}"));
        let mut x = rng.below(total as u64) as i64;
        let mut from = 0;
        for b in bands {
            if x < b.bps {
                return from * DAY + rng.below(((b.within_days - from) * DAY).max(1) as u64) as i64;
            }
            x -= b.bps;
            from = b.within_days;
        }
        from * DAY
    }

    fn wonder(&mut self, key: String, space: &str, structure: &str, at: &str, since: i64, cx: &mut Cx) {
        // (Never before nobody has been in or out for a day: where people share a home one of them comes or goes within
        // a day, and it is theirs to say who has died.)
        if !self.lifecycle.wondered.contains_key(&key) && !self.lifecycle.asked_about.contains(&key) {
            let due = since + DAY.max(self.remarked_after(&key, cx));
            self.lifecycle.wondered.insert(key, Wonder { space: space.into(), structure: structure.into(), at: at.into(), since, due });
        }
    }

    /// The homes beside us (docs/behaviour/deaths.md, "Nobody else at home"): one someone went into after anyone last
    /// left, with nobody in it now; or, in our own building, a neighbour we know died and whose home has stood empty.
    /// When the silence has gone on as long as such a silence goes unremarked, an adult asks the police to call (once
    /// for each, one at a time).
    pub fn wonder_next_door(&mut self, w: &mut Week) -> Option<Step<()>> {
        let wf = self.p.welfare.clone()?;
        if !self.adult_body(w.pic, w.t) {
            return None;
        }
        let t = w.t;
        let our_home = self.our_home();
        if let Some(Seen::Sites { as_of, cells: next, .. }) = w.pic.channels.get(wf.channel.as_str()) {
            if *as_of != self.lifecycle.next_door_as_of {
                self.lifecycle.next_door_as_of = *as_of;
                let mut still = BTreeSet::new();
                for st in next.iter().filter_map(|c| c.structure.as_ref()) {
                    for sp in &st.spaces {
                        let Some(entered) = sp.seen_entering else { continue };
                        if sp.kind != "dwelling" || sp.occupants.is_some() || sp.count > 0 || entered <= sp.seen_leaving.unwrap_or(-1) {
                            continue;
                        }
                        let key = format!("{}@{entered}", sp.space);
                        still.insert(key.clone());
                        self.wonder(key, &sp.space, &st.structure, &st.at, entered, w.cx);
                    }
                }
                // (Someone has come out of it, or gone in, since: nothing to wonder at. One we know by name is kept.)
                self.lifecycle.wondered.retain(|k, _| k.starts_with("died:") || still.contains(k));
            }
        }
        let mut known = vec![];
        for st in cells(w.pic, "street").iter().filter_map(|c| c.structure.as_ref()) {
            for sp in &st.spaces {
                if sp.kind != "dwelling" || Some(sp.space.as_str()) == our_home.as_deref() || sp.occupants.is_none() || !stood_empty(sp, t) {
                    continue;
                }
                for l in sp.left.iter().flatten().filter(|l| died(l.reason) && !self.of_household(&l.occupant)) {
                    known.push((format!("died:{}", l.occupant), sp.space, st.structure, st.at, l.at));
                }
            }
        }
        for (key, space, structure, at, since) in known {
            self.wonder(key, &space, &structure, &at, since, w.cx);
        }
        let key = self.lifecycle.wondered.iter().find(|(_, x)| t >= x.due).map(|(k, _)| k.clone())?;
        let x = self.lifecycle.wondered.remove(&key)?;
        self.lifecycle.asked_about.insert(key);
        let days = round_div(t - x.since, DAY).max(1);
        Some(because(
            format!("Nobody has been seen at {} for {days} days, and whoever went in has not come out: asking the police to call there.", x.space),
            vec![say(
                "welfare_check_request",
                &format!("Nobody has been seen at {} for some days. Please call there.", x.space),
                Say {
                    to: Some(vec![wf.police.clone()]),
                    data: Some(crate::papers::data(&WelfareCheckRequest { space: x.space.clone(), structure: x.structure, at: x.at, since: x.since })),
                    ..Default::default()
                },
            )],
        ))
    }

    // ------------------------------------------------------------------ deaths (citizen.ts 1623-1728)

    /// A death where we work (docs/behaviour/deaths.md, "At work"): whoever is present may report it, and one of us
    /// does, the first of those present by their ids (none of us can say who the family is).
    pub fn see_death_at_work(&mut self, w: &mut Week) {
        let (Some(wp), Some(registry)) = (self.s.job.as_ref().and_then(|j| j.workplace.clone()), self.p.registry.clone()) else { return };
        if !matches!(w.pic.channels.get("street"), Some(Seen::Sites { .. })) || !self.adult_body(w.pic, w.t) {
            return;
        }
        let me = self.me.clone();
        let Some(room) = spaces(w.pic).find(|sp| sp.space == wp).cloned() else { return };
        if !has(&room, &me) {
            return;
        }
        for l in room.left.iter().flatten() {
            if !died(l.reason) || self.s.mourned.contains(l.occupant.as_str()) || self.of_household(&l.occupant) {
                continue;
            }
            let first = room.occupants.iter().flatten().filter(|o| **o != l.occupant).min();
            if first.map(|x| x.as_str()) != Some(me.as_str()) {
                continue;
            }
            self.s.mourned.insert(l.occupant.to_string());
            w.push(because(
                format!("{}, who worked where we work, has died here: reporting it to the registry.", l.occupant),
                vec![death_notification(&registry, &format!("{} has died at {wp}.", l.occupant), stranger(&l.occupant, &wp))],
            ));
        }
    }

    /// Those to be told of a household member's death, as far as we know whom they dealt with: their bank, the energy
    /// retailer, the school of a child, the household's landlord (the registry sends its entry to each).
    fn tell_of_death(&mut self, dead: &Member, at: i64) -> Vec<String> {
        let age = age_at(dead.born_at, at, self.p.year);
        let school = self.p.school.as_ref().filter(|s| age >= s.ages[0] && age <= s.ages[1]).map(|s| s.entity.clone());
        let landlord = self.household_landlord();
        let mut v: Vec<String> = [self.p.bank.clone(), self.p.utilities.as_ref().map(|u| u.energy.clone()), school, landlord].into_iter().flatten().filter(|x| *x != self.me).collect();
        v.sort();
        v.dedup();
        v
    }

    /// A death at home (docs/behaviour/deaths.md), looked for at every wake at home: someone not of our household who
    /// died where we live (reported to the registry, unless their own are there to); someone of it (mourned, reported
    /// by the first adult of the household at home, the household's record written without them, our share of the rent
    /// to them stopped).
    pub fn see_death_at_home(&mut self, w: &mut Week) {
        let t = w.t;
        let me = self.me.clone();
        let our_home = self.our_home();
        let sites = matches!(w.pic.channels.get("street"), Some(Seen::Sites { .. }));
        let here: Vec<SiteSpace> = match &our_home {
            Some(h) if sites => spaces(w.pic).filter(|sp| &sp.space == h).cloned().collect(),
            _ => vec![],
        };
        // (A death of one of our household where we are, away from home (a gathering in the hall), is seen as one at
        // home is: those of the household there know it. Until 2026-10-19 only the home was looked at, so a member who
        // died at a gathering with another of the household beside them was never reported, and the household's record
        // named the dead for good: the invariants' one_household, ke-nakuru seed 1.)
        let away: Vec<SiteSpace> = if sites {
            spaces(w.pic).filter(|sp| Some(sp.space.as_str()) != our_home.as_deref() && has(sp, &me) && sp.left.iter().flatten().any(|l| died(l.reason) && self.of_household(&l.occupant))).cloned().collect()
        } else {
            vec![]
        };
        // Someone who died in the home we live in and is not of our household (a home let again over our heads, a
        // lodger): an adult living there says so to the registry. We can't say who their family is: the report names none.
        if let (Some(home), Some(registry), true) = (&our_home, self.p.registry.clone(), self.adult_body(w.pic, t)) {
            if here.iter().any(|sp| has(sp, &me)) {
                for l in here.iter().flat_map(|sp| sp.left.iter().flatten()) {
                    if !died(l.reason) || self.s.mourned.contains(l.occupant.as_str()) || self.of_household(&l.occupant) {
                        continue;
                    }
                    // (A guest's or lodger's death, with others who came with them at home now: their family reports it,
                    // and we leave it to them for a day from when we saw it. Where none is home, we do.)
                    let theirs = here.iter().flat_map(|sp| sp.occupants.iter().flatten()).any(|o| *o != me && *o != l.occupant && !self.of_household(o));
                    let seen = *self.lifecycle.host_saw_death.entry(l.occupant.to_string()).or_insert(t);
                    if theirs && t - seen < DAY {
                        continue;
                    }
                    self.s.mourned.insert(l.occupant.to_string());
                    w.push(because(
                        format!("{}, who lived where we live and is not of our household, has died here: reporting it to the registry.", l.occupant),
                        vec![death_notification(&registry, &format!("{} has died at {home}.", l.occupant), stranger(&l.occupant, home))],
                    ));
                }
            }
        }
        let Some(mut hh) = self.s.household.clone() else {
            self.absorbed.told_dead.clear();
            return;
        };
        let at_home: BTreeSet<String> = here.iter().chain(away.iter()).flat_map(|sp| sp.occupants.iter().flatten().cloned()).map(|x| x.to_string()).collect();
        // (Seen ourselves; or told by a child of the household, who tells one adult when none is at home: ours to report.)
        let mut deaths: Vec<(String, Option<String>)> = here.iter().chain(away.iter()).flat_map(|sp| sp.left.iter().flatten()).filter(|l| died(l.reason)).map(|l| (l.occupant.to_string(), None)).collect();
        deaths.extend(std::mem::take(&mut self.absorbed.told_dead).into_iter().map(|(p, s)| (p, Some(s))));
        for (who, told) in deaths {
            if self.s.mourned.contains(&who) {
                continue;
            }
            let Some(dead) = hh.member(&who).cloned() else { continue };
            self.s.mourned.insert(who.clone());
            // A death in the household: ours, mourned with the other adults of it, and told to those we are closest to.
            let adults: Vec<String> = hh.members.iter().filter(|m| m.person != me && m.person != who && age_at(m.born_at, t, self.p.year) >= ADULT_YEARS).map(|m| m.person.clone()).collect();
            let heard = self.happened(w, Event::Bereaved { who: who.clone(), adults });
            if let Heard::Mourn(close) = heard {
                let close: Vec<String> = close.into_iter().filter(|c| !hh.members.iter().any(|m| m.person == *c)).collect();
                if !close.is_empty() {
                    w.push(because(format!("{who}, of our household, has died: telling those we are closest to."), vec![message(&close, &format!("I have sad news: {who} has died."), None)]));
                }
            }
            let held_lease = hh.leaseholder == who;
            let survivors: Vec<Member> = hh.members.iter().filter(|m| m.person != who && !self.s.mourned.contains(&m.person)).cloned().collect();
            let grown: Vec<&Member> = survivors.iter().filter(|m| age_at(m.born_at, t, self.p.year) >= ADULT_YEARS).collect();
            let partner = hh.partner_of(&who).map(String::from);
            let kids: Vec<&Member> = survivors.iter().filter(|m| m.parents.as_ref().is_some_and(|p| p.contains(&who))).collect();
            let leaseholder = if !held_lease {
                Some(hh.leaseholder.clone())
            } else {
                grown.iter().find(|m| Some(&m.person) == partner.as_ref()).or_else(|| grown.iter().min_by_key(|m| m.born_at)).map(|m| m.person.clone())
            };
            // Of the surviving adults at home now, the first in the household's list reports it, and writes the
            // household's new record (one who comes home later finds the record already without them).
            let reporter = told.is_some() || grown.iter().find(|m| at_home.contains(&m.person)).is_some_and(|m| m.person == me);
            if let (true, Some(registry)) = (reporter, self.p.registry.clone()) {
                let n = DeathNotification {
                    deceased: who.clone(),
                    found_at: None,
                    tell: self.tell_of_death(&dead, t),
                    partner: partner.clone().filter(|p| survivors.iter().any(|m| m.person == *p)),
                    children: Some(kids.iter().map(|k| k.person.clone()).collect()),
                    adult_children: Some(kids.iter().filter(|k| age_at(k.born_at, t, self.p.year) >= ADULT_YEARS).map(|k| k.person.clone()).collect()),
                    without_adult: vec![],
                };
                w.push(because(format!("{who}, of our household, has died: reporting it to the registry."), vec![death_notification(&registry, &format!("{who} has died."), n)]));
                if let Some(lh) = leaseholder {
                    let next = HouseholdData { leaseholder: lh.clone(), members: survivors.clone(), couples: hh.couples.iter().filter(|c| !c.contains(&who)).cloned().collect() };
                    let to: Vec<String> = survivors.iter().map(|m| m.person.clone()).collect();
                    let d = self.household_data(&next);
                    w.push(because(
                        format!("{who} has died: the household's record without them{}.", if held_lease { format!(", {lh} holding the lease from now") } else { String::new() }),
                        vec![say("household", &household_words(&survivors), Say { to: Some(to.clone()), visible: Some(Visible::Only(to)), for_: Some(lh), data: Some(d), ..Default::default() })],
                    ));
                    hh = next; // as we've just written it
                    self.s.household = Some(hh.clone());
                }
            }
            // (Told of it, and we never knew where the household had come to live: it is there, and so do we.)
            if let Some(space) = told.filter(|_| self.s.home.is_none() && self.s.living_at.is_none()) {
                w.push(because(format!("The household lives at {space}: going there."), vec![move_in(&space)]));
                self.s.living_at = Some(space);
            }
            // Our share of the rent went to the one who died: stop it.
            if let (Some((_, Some(order))), true) = (&self.s.share, held_lease) {
                w.push(because(format!("{who} held the lease and has died: stopping our share of the rent to them."), vec![withdraw(order, Some("The leaseholder has died."))]));
                self.s.share = None;
            }
        }
        self.s.household = Some(hh);
    }

    // ------------------------------------------------------------------ births (citizen.ts 1821-1863)

    /// A child born to us brought home, registered, and put on the household's record (by the one who bore them); and,
    /// for a woman of an age to, not already expecting, once a month, a child at the rate for her age.
    pub fn births(&mut self, w: &mut Week) {
        let Some(body) = w.pic.body.clone() else { return };
        let t = w.t;
        let me = self.me.clone();
        if self.lifecycle.known_children.is_none() {
            self.lifecycle.known_children = Some(body.children.iter().map(|k| k.person).map(|x| x.to_string()).collect());
        }
        let female = body.sex == Some(oikos_contracts::vocab::Sex::Female);
        for k in &body.children {
            let known = self.lifecycle.known_children.get_or_insert_with(BTreeSet::new);
            if known.contains(k.person.as_str()) || !k.alive {
                continue;
            }
            known.insert(k.person.to_string());
            // The parent who bore the child does it (the other parent sees the child too).
            if !female {
                continue;
            }
            // A child of the household now, wherever the household goes (before the record says so).
            if !self.s.children_now.iter().any(|c| c.person == k.person) {
                self.s.children_now.push(Member { person: k.person.to_string(), participant: None, born_at: k.born_at, sex: sex_of(k.sex), parents: None });
            }
            let at = self.s.home.as_ref().filter(|h| h.moved_in).map(|h| h.space.clone()).or_else(|| self.s.living_at.clone());
            if let Some(at) = at {
                w.push(because("Our baby is born: bringing them home.", vec![call("occupancy", vec![("in", Some(arg(&at))), ("who", Some(arg(&k.person)))])]));
            }
            // (And registered, as a birth must be: docs/behaviour/institutions.md.)
            if let Some(registry) = self.p.registry.clone() {
                w.push(because(
                    "Our baby is born: registering the birth.",
                    vec![say(
                        "birth_notification",
                        &format!("A child was born to {me}."),
                        Say { to: Some(vec![registry]), data: Some(crate::papers::data(&BirthNotification { child: k.person.to_string(), born_at: k.born_at, mother: me.clone() })), ..Default::default() },
                    )],
                ));
            }
            if let (Some(hh), Some(sex)) = (self.s.household.clone(), k.sex) {
                let father = hh.partner_of(&me).and_then(|p| hh.member(p)).filter(|m| m.sex == Sex::Male).map(|m| m.person.clone());
                let mut members = hh.members.clone();
                members.push(Member { person: k.person.to_string(), participant: None, born_at: k.born_at, sex: sex_of(Some(sex)), parents: Some(father.map_or(vec![me.clone()], |f| vec![me.clone(), f])) });
                let next = HouseholdData { members: members.clone(), ..hh.clone() };
                let to: Vec<String> = members.iter().map(|m| m.person.clone()).collect();
                let d = self.household_data(&next);
                w.push(because(
                    "Our baby is born: adding them to the household's record.",
                    vec![say("household", &household_words(&members), Say { to: Some(to.clone()), visible: Some(Visible::Only(to)), for_: Some(hh.leaseholder.clone()), data: Some(d), ..Default::default() })],
                ));
            }
        }
        // Having a child: a woman of an age to, not already expecting, once a month, at the rate for her age. With a
        // partner, only when they're here with us (we see who's in our own home): the month's chance waits for it.
        let age = (t - body.born_at).div_euclid(self.p.year.max(1));
        let man = self.s.household.as_ref().and_then(|h| h.partner_of(&me).and_then(|p| h.member(p)).filter(|m| m.sex == Sex::Male).map(|m| m.person.clone()));
        let together = man.as_ref().is_none_or(|m| spaces(w.pic).any(|sp| has(sp, &me) && has(sp, m)));
        if female && self.p.births && body.present && t >= self.lifecycle.next_fertility && t >= self.lifecycle.expecting_until && together {
            self.lifecycle.next_fertility = t + MONTH;
            let rate = self.p.fertility_per_10000.iter().rev().find(|r| age >= r.from).map_or(0, |r| r.rate);
            if rate > 0 && (w.cx.rng("conceive").below(120_000) as i64) < rate {
                self.lifecycle.expecting_until = t + self.p.gestation + MONTH;
                self.happened(w, Event::Conceived);
                let template = if !self.p.child_template_outside_lf.is_empty() && w.cx.rng("child-participation").below(10_000) as i64 >= self.p.participation_bps {
                    self.p.child_template_outside_lf.clone()
                } else {
                    self.p.child_template.clone()
                };
                w.push(because(
                    format!("Having a child: at {age}, the chance this month is {rate} in 120,000 ({rate} births per 10,000 women a year at this age)."),
                    vec![call("birth", vec![("name", Some(text(format!("baby of {me}")))), ("template", Some(arg(&template))), ("with", man.as_deref().map(arg))])],
                ));
            }
        }
    }

    // ------------------------------------------------------------------ leaving town (citizen.ts 3352-3389)

    /// Leaving town (exit), decided by the leaseholder for the household: long without a roof, or long with nobody
    /// earning and less money than a month's rent or essentials. Patience follows the person (the mind's multiplier).
    /// True: we are leaving, and the plan ends here.
    pub fn leaving_town(&mut self, w: &mut Week) -> bool {
        let t = w.t;
        // (Our home sold to leave: we go, as we meant to.)
        if let Some(s) = self.housing.sold_and_going.filter(|s| t > *s) {
            // (Not while earlier steps are still queued, or the mortgage's payoff is not yet seen made: what we send on is what is left after them,
            // and the balance we see is the one from before they are made. Planned again when they are done.)
            // (A payoff the bank never makes is not waited on for ever: a month, and we go.)
            if !self.todo.is_empty() || (self.housing.paying_off.is_some() && t < s + MONTH) {
                return true;
            }
            self.housing.sold_and_going = None;
            self.departure(w, "Our home sold: leaving town, as we meant to.");
            return true;
        }
        let Some(balance) = w.acc.as_ref().map(|a| a.balance) else { return false };
        let broke = balance < self.s.home.as_ref().map_or(0, |h| h.rent).max(self.p.essentials);
        let patience = self.mind.patience_days();
        let homeless_days = round_div(self.p.leave_after_homeless_days * patience, 1_000);
        let jobless_days = round_div(self.p.leave_after_jobless_days * patience, 1_000);
        // (Days without a home count toward leaving only while there is no roof at all: not while someone has us.)
        let roofless = self.s.homeless_since.filter(|_| self.staying_with().is_none());
        let household_pay: i64 = if self.is_leaseholder() { self.s.member_pay.values().sum() } else { 0 };
        let homeless_long = roofless.is_some_and(|r| t - r >= homeless_days * DAY);
        let jobless_long = self.s.jobless_since.is_some_and(|j| t - j >= jobless_days * DAY) && self.earned_income(t) + household_pay == 0 && broke;
        let would_leave = self.is_leaseholder() && (homeless_long || jobless_long);
        // (An owner who'd leave sells first, and goes once it's sold: housing's sale, docs/behaviour/ownership.md.)
        let owned = self.s.home.as_ref().is_some_and(|h| h.owned);
        if would_leave && owned {
            self.sell_to_leave(w.pic);
        }
        if !would_leave || owned || self.is_selling() {
            return false;
        }
        let why = match (homeless_long, self.s.homeless_since, self.s.jobless_since) {
            (true, Some(h), _) => format!("Leaving town: {} days without a home (we leave after {homeless_days}).", (t - h) / DAY),
            (_, _, j) => format!(
                "Leaving town: {} days with nobody in the household earning (we leave after {jobless_days}), and less money than a month's rent or essentials.",
                (t - j.unwrap_or(t)) / DAY
            ),
        };
        for a in self.adults(t) {
            w.push(because(why.clone(), vec![message(&[a.reach().to_string()], &SAYING::leaving(), None)]));
        }
        // (Whoever had taken us in is told we have gone.)
        if let Some(host) = self.staying_with().map(String::from) {
            w.push(because(
                why.clone(),
                vec![say(
                    "stay_ended",
                    "We are leaving town. Thank you for taking us in.",
                    Say { to: Some(vec![host.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), host])), data: Some(json!({ "by": "guest" })), ..Default::default() },
                )],
            ));
        }
        // (What's already planned this wake, a newborn brought home, comes first: it is in `w.steps` already.)
        self.departure(w, &why);
        true
    }

    // ------------------------------------------------------------------ the daily round (citizen.ts 4253-4350)

    /// The dwelling we were last in, as this picture shows it (where we go back to).
    fn last_dwelling_now(&self, pic: &Picture) -> Option<String> {
        let here = pic.body.as_ref().and_then(|b| b.in_space);
        let mut last = self.s.last_dwelling.clone();
        if let Some(h) = here {
            if spaces(pic).any(|sp| sp.space == h && sp.kind == "dwelling") && !self.s.gave_up.contains(h.as_str()) {
                last = Some(h.to_string());
            }
        }
        last.filter(|l| !self.s.gave_up.contains(l))
    }
    fn home_now(&self, last: Option<String>) -> Option<String> {
        self.s.home.as_ref().filter(|h| h.moved_in).map(|h| h.space.clone()).or_else(|| self.s.living_at.clone()).or(last)
    }

    /// Where we belong now: school or work in their hours (not while too ill, on strike, or gone from the job), the
    /// clinic while waiting there, a gathering while it lasts; otherwise home. None: anywhere will do (no round, no home).
    pub fn belong(&self, pic: &Picture) -> Option<String> {
        let r = self.p.round?;
        let body = pic.body.as_ref()?;
        let t = pic.t;
        let here = body.in_space;
        let mut home = self.home_now(self.last_dwelling_now(pic));
        // (Our home under water: the relief centre, until a day on, when we try home again.)
        if let (Some((h, until)), Some(relief)) = (&self.lifecycle.flooded_out, &self.p.relief) {
            if t < *until && home.as_ref() == Some(h) {
                home = Some(relief.clone());
            }
        }
        if let (Some(_), Some(c)) = (&self.lifecycle.at_clinic, &self.p.care) {
            return Some(c.waiting.clone());
        }
        // (At a gathering, the mind's: kept where we are while it lasts.)
        if self.mind.at_gathering(t).is_some() {
            return here.map(|x| x.to_string());
        }
        let tod = t.rem_euclid(DAY);
        let workday = t.div_euclid(DAY) % 7 < r.work_days;
        if age_at(body.born_at, t, self.p.year) < ADULT_YEARS {
            let age = age_at(body.born_at, t, self.p.year);
            if self.p.school.as_ref().is_some_and(|s| age >= s.ages[0] && age <= s.ages[1]) {
                if let Some(room) = self.school_place().and_then(|p| data(p).s("classroom").map(String::from)) {
                    if workday && tod >= r.school_start && tod < r.school_end {
                        return Some(room);
                    }
                }
            }
            return home;
        }
        let hours = workday && tod >= r.work_start && tod < r.work_end;
        // (On strike from the moment we know of the stoppage, not only once we have walked out.)
        if let Some(j) = &self.s.job {
            let ends = j.left_at.unwrap_or(i64::MAX).min(self.book.ends_at(&j.agreement).unwrap_or(i64::MAX));
            if let Some(wp) = j.workplace.as_ref().filter(|_| self.lifecycle.off_sick.is_none() && self.s.striking.is_none() && t < ends && hours) {
                return Some(wp.clone());
            }
        }
        // (Working for ourselves from somewhere other than home, a pitch: there in working hours.)
        if let Some(at) = self.s.own_work.as_ref().and_then(|w| w.at.clone()).filter(|_| self.lifecycle.off_sick.is_none() && hours) {
            return Some(at);
        }
        home
    }

    /// The next time where we belong may change: work and school starting or ending, on working days.
    pub fn next_change(&self, t: i64) -> i64 {
        let Some(r) = self.p.round else { return i64::MAX };
        [r.work_start, r.work_end, r.school_start, r.school_end].into_iter().map(|at| next_look(t, at, r.work_days)).min().unwrap_or(i64::MAX)
    }

    /// Going where we belong, if we're not there (not again before things change, if the world refused it).
    pub fn go_where_we_belong(&mut self, pic: &Picture, _cx: &mut Cx) -> Option<Todo> {
        self.s.last_dwelling = self.last_dwelling_now(pic);
        let to = self.belong(pic)?;
        if pic.body.as_ref().and_then(|b| b.in_space.as_deref()) == Some(to.as_str()) {
            return None;
        }
        if self.lifecycle.refused_go.as_ref().is_some_and(|(r, until)| *r == to && pic.t < *until) {
            return None;
        }
        let what = if self.s.job.as_ref().and_then(|j| j.workplace.as_ref()) == Some(&to) {
            "Off to work"
        } else if self.s.home.as_ref().map(|h| &h.space) == Some(&to) || self.s.living_at.as_ref() == Some(&to) || self.s.last_dwelling.as_ref() == Some(&to) {
            "Home"
        } else {
            "Going"
        };
        // (By a vehicle we may drive, if one stands where we are, the first of them; else on foot.)
        let here = pic.body.as_ref().and_then(|b| b.in_space).map(|sp| structure_of(&sp).to_string());
        let car = here.and_then(|h| pic.body.as_ref()?.vehicles.iter().find(|v| v.at == h.as_str()).map(|v| v.vehicle)).filter(|_| !std::mem::take(&mut self.lifecycle.walk_next));
        self.lifecycle.drove = car.map(|v| v.to_string());
        let go = match car {
            Some(v) => crate::common::calls::move_in_by(&to, &v),
            None => move_in(&to),
        };
        Some(Todo { step: because(format!("{what}: {to}."), vec![go]), mark: Mark::Go(to) })
    }

    /// How the round move we sent last went (the outcome comes with our next look).
    pub fn heard_go(&mut self, pic: &Picture) {
        let Some(to) = self.s.pending_go.take() else { return };
        let Some(out) = pic.outcomes.last() else { return };
        if out.status == OutcomeStatus::Applied {
            return;
        }
        let t = pic.t;
        let code = out.refusal.as_ref().map(|r| r.code);
        // (By a vehicle that was not there to take, or not ours: on foot, at once.)
        if self.lifecycle.drove.take().is_some() && matches!(code, Some(RefusalCode::NotPresent | RefusalCode::NotTheirs | RefusalCode::UnknownRef)) {
            self.lifecycle.walk_next = true;
            return;
        }
        self.lifecycle.refused_go = Some((to.clone(), self.next_change(t)));
        // (Our home under water: to the relief centre at once. Work or school under water: not before things change.)
        let home_now = self.home_now(self.s.last_dwelling.clone());
        if code == Some(RefusalCode::Flooded) && home_now.as_ref() == Some(&to) && self.p.relief.is_some() {
            self.lifecycle.flooded_out = Some((to.clone(), t + DAY));
            self.lifecycle.refused_go = None;
        }
        // (A place pulled down, or coming down: not again.)
        if matches!(code, Some(RefusalCode::UnknownStructure | RefusalCode::UnknownSpace | RefusalCode::ComingDown)) {
            self.lifecycle.refused_go = Some((to.clone(), i64::MAX));
            if self.s.last_dwelling.as_ref() == Some(&to) {
                self.s.last_dwelling = None;
            }
            if self.s.living_at.as_ref() == Some(&to) {
                self.s.living_at = None;
            }
        }
    }

    // ------------------------------------------------------------------ school, the body, care (citizen.ts 4548-4622)

    /// The latest place at school offered us, standing.
    fn school_place(&self) -> Option<&std::sync::Arc<oikos_sight::Record>> {
        let me = self.me.as_str();
        self.book.open("school_place").filter(|r| addressed_to(r).iter().any(|a| a == me)).max_by_key(|r| r.at)
    }
    /// The classroom we are in, if any.
    fn classroom_of(&self, pic: &Picture) -> Option<String> {
        let school = self.p.school.as_ref()?;
        cells(pic, "street")
            .iter()
            .filter_map(|c| c.structure.as_ref())
            .filter(|st| st.structure == school.building)
            .flat_map(|st| st.spaces.iter())
            .find(|sp| sp.kind == "classroom" && has(sp, &self.me))
            .map(|sp| sp.space.to_string())
    }

    /// A child of school age who isn't at school: to the place offered, or asking for one (once a month).
    fn schooling(&mut self, w: &mut Week) -> Option<Step<()>> {
        let school = self.p.school.clone()?;
        let body = w.pic.body.as_ref()?;
        let t = w.t;
        let age = (t - body.born_at).div_euclid(self.p.year.max(1));
        if age < school.ages[0] || age > school.ages[1] || self.classroom_of(w.pic).is_some() {
            return None;
        }
        let place = self.school_place().map(|r| (r.id, data(r).s("classroom").map(String::from)));
        // (With the round, a place is ours to go to in school hours; without it, we go now and stay.)
        if let Some((id, Some(room))) = &place {
            if self.p.round.is_some() {
                return None;
            }
            if self.lifecycle.tried_place.insert(id.to_string()) {
                return Some(because("A place at school: going.", vec![move_in(room)]));
            }
        }
        if self.lifecycle.asked_school >= 0 && t - self.lifecycle.asked_school < MONTH {
            return None;
        }
        self.lifecycle.asked_school = t;
        let me = self.me.clone();
        Some(because(
            format!("Of school age ({age}) and not at school: asking the school for a place."),
            vec![say(
                "school_enrolment",
                &format!("Enrolment at school: {me}."),
                Say {
                    to: Some(vec![school.entity.clone()]),
                    visible: Some(Visible::Only(vec![me, school.entity.clone()])),
                    // (Years at school elsewhere: a newcomer's.)
                    data: Some(crate::papers::data(&SchoolEnrolment { born_at: body.born_at, years_before: (age - school.ages[0]).max(0) })),
                    ..Default::default()
                },
            )],
        ))
    }

    /// The body (`bodily`): out of school at its end; off work while too ill to work (the employer told), back when
    /// better; care at the clinic.
    pub fn schooling_and_care(&mut self, w: &mut Week) {
        let Some(body) = w.pic.body.clone() else { return };
        let t = w.t;
        let me = self.me.clone();
        // School's over at its end: out of the classroom.
        if let (Some(room), Some(s), None) = (self.classroom_of(w.pic), &self.p.school, self.p.round) {
            if (t - body.born_at).div_euclid(self.p.year.max(1)) > s.ages[1] {
                w.push(because("School's over: leaving it.", vec![move_out(&room, &me)]));
            }
        }
        let Some(c) = self.p.care.clone() else { return };
        // Too ill or hurt to work (a hospital-level condition): out of the workplace until better.
        let too_ill = body.conditions.iter().any(|x| x.until > t && c.off_work.contains(&x.severity));
        let job = self.s.job.clone();
        if let (true, Some(j), None) = (too_ill, &job, &self.lifecycle.off_sick) {
            if let Some(wp) = j.workplace.clone().filter(|wp| self.p.round.is_some() || inside(w.pic, &me, wp)) {
                self.lifecycle.off_sick = Some(wp.clone());
                // (Telling our employer, as a worker on personal leave does; with the round, we just don't go in.)
                let mut calls = vec![say(
                    "sick_leave",
                    &format!("Off sick from {}: too ill to work.", crate::common::when_words(t, &w.cx.ctx.world)),
                    Say { to: Some(vec![j.employer.clone()]), visible: Some(Visible::Only(vec![me.clone(), j.employer.clone()])), data: Some(crate::papers::data(&SickLeave { from: t })), ..Default::default() },
                )];
                if self.p.round.is_none() {
                    calls.push(move_out(&wp, &me));
                }
                w.push(because("Too ill to work: staying away until we're better.", calls));
            }
        } else if !too_ill {
            if let Some(off) = self.lifecycle.off_sick.take() {
                if job.as_ref().and_then(|j| j.workplace.as_ref()) == Some(&off) && self.p.round.is_none() {
                    w.push(because("Better: back to work.", vec![move_in(&off)]));
                }
            }
        }
        self.seek_care(w);
    }

    /// At the clinic, home once seen, better, or after waiting long enough; else, with something wrong of a kind it
    /// sees, to the clinic (most do), asking for care. A child too (their parents would take them).
    fn seek_care(&mut self, w: &mut Week) {
        let (Some(c), Some(body)) = (self.p.care.clone(), w.pic.body.clone()) else { return };
        let t = w.t;
        let me = self.me.clone();
        let now: Vec<_> = body.conditions.iter().filter(|x| x.until > t).collect();
        if let Some((cond, since)) = self.lifecycle.at_clinic.clone() {
            let x = now.iter().find(|y| y.id == cond);
            if x.is_none_or(|x| x.treated) || t - since >= c.wait_days * DAY {
                if inside(w.pic, &me, &c.waiting) {
                    let why = if x.is_some_and(|x| x.treated) { "Seen at the clinic: going home." } else { "Done at the clinic: going home." };
                    w.push(because(why, vec![move_out(&c.waiting, &me)]));
                }
                self.lifecycle.at_clinic = None;
            }
            return;
        }
        let Some(ill) = now.iter().find(|x| !x.treated && c.severities.contains(&x.severity) && !self.lifecycle.sought_care.contains(x.id.as_str())) else { return };
        self.lifecycle.sought_care.insert(ill.id.to_string());
        let kind = serde_json::to_value(ill.kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
        if w.cx.rng(&format!("care-{kind}-{}", ill.since)).below(10_000) as i64 >= c.seek_bps {
            return;
        }
        self.lifecycle.at_clinic = Some((ill.id.to_string(), t));
        w.push(because(
            format!("A {} {kind}: going to the clinic.", ill.severity),
            vec![
                move_in(&c.waiting),
                say(
                    "care_request",
                    &format!("Asking to be seen: a {} {kind}.", ill.severity),
                    Say {
                        to: Some(vec![c.entity.clone()]),
                        visible: Some(Visible::Only(vec![me, c.entity.clone()])),
                        data: Some(crate::papers::data(&CareRequest { condition: Some(ill.id.to_string()), kind: Some(kind.clone()), severity: Some(ill.severity.clone()), children: vec![] })),
                        ..Default::default()
                    },
                ),
            ],
        ));
    }

    // ------------------------------------------------------------------ the child's wake (citizen.ts 4786-4834)

    /// A child does nothing on their own (their parents house them) until they're 18, except ask for help if no adult
    /// of the household is left, tell an adult of a death at home, go for care, to school, and where they belong.
    pub fn child_wake(&mut self, w: &mut Week) -> oikos_sight::Action {
        let t = w.t;
        let me = self.me.clone();
        // (Told by our household that the tenancy of our home has ended: it is no longer where we go back to.)
        for (_, said) in std::mem::take(&mut self.s.heard) {
            if let super::person::Said::MoveOut(from) = said {
                for d in [self.s.last_dwelling.clone(), self.s.living_at.clone()].into_iter().flatten() {
                    if structure_of(&d) == from {
                        self.s.gave_up.insert(d);
                    }
                }
            }
        }
        let sites = matches!(w.pic.channels.get("street"), Some(Seen::Sites { .. }));
        if let (Some(hh), true) = (self.s.household.clone(), sites) {
            let ours: Vec<SiteSpace> = spaces(w.pic).filter(|sp| has(sp, &me)).cloned().collect();
            let grown: Vec<&Member> = hh.members.iter().filter(|m| age_at(m.born_at, t, self.p.year) >= ADULT_YEARS).collect();
            if !self.lifecycle.asked_for_care {
                let dead_here: BTreeSet<&str> = ours.iter().flat_map(|sp| sp.left.iter().flatten()).filter(|l| died(l.reason)).map(|l| l.occupant.as_str()).collect();
                if let (false, false, true, Some(cp)) = (ours.is_empty(), grown.is_empty(), grown.iter().all(|m| dead_here.contains(m.person.as_str())), self.p.child_protection.clone()) {
                    self.lifecycle.asked_for_care = true;
                    let kids: Vec<String> = hh.members.iter().filter(|m| age_at(m.born_at, t, self.p.year) < ADULT_YEARS).map(|m| m.person.clone()).collect();
                    let s = because(
                        "No adult of our household is left: asking for help.",
                        vec![say("care_request", "We have no adult at home any more.", Say { to: Some(vec![cp]), data: Some(crate::papers::data(&CareRequest { children: kids, ..Default::default() })), ..Default::default() })],
                    );
                    return self.send(s, w.cx);
                }
            }
            // Someone of the household has died at home and no adult of it is there: a child old enough for school tells
            // the first of its adults still living (docs/behaviour/deaths.md), once.
            let old_enough = self.p.school.as_ref().is_none_or(|s| w.pic.body.as_ref().is_some_and(|b| t - b.born_at >= s.ages[0] * self.p.year));
            if old_enough {
                for sp in ours.iter().filter(|sp| sp.kind == "dwelling") {
                    let mut dead: Vec<&str> = vec![];
                    for l in sp.left.iter().flatten().filter(|l| died(l.reason)) {
                        if !dead.contains(&l.occupant.as_str()) {
                            dead.push(&l.occupant);
                        }
                    }
                    let alive: Vec<&&Member> = grown.iter().filter(|m| !dead.contains(&m.person.as_str())).collect();
                    for who in dead {
                        if self.lifecycle.told_of.contains(who) || !hh.members.iter().any(|m| m.person == who) {
                            continue;
                        }
                        self.lifecycle.told_of.insert(who.to_string());
                        let Some(first) = alive.first() else { continue };
                        if alive.iter().any(|m| has(sp, &m.person)) {
                            continue;
                        }
                        let s = because(
                            format!("{who}, of our household, has died at home and no adult is here: telling {}.", first.person),
                            vec![message(&[first.reach().to_string()], &SAYING::died(who, &sp.space), None)],
                        );
                        return self.send(s, w.cx);
                    }
                }
            }
        }
        let before = w.steps.len();
        self.seek_care(w);
        if w.steps.len() > before {
            let s = w.steps.remove(before).step;
            w.steps.truncate(before);
            return self.send(s, w.cx);
        }
        if let Some(s) = self.schooling(w) {
            return self.send(s, w.cx);
        }
        // (A child's record: who they are, whom they are tied to, where their hours go; written when it has moved, a
        // month at a time.)
        if !self.lifecycle.child_recorded || t - self.s.child_record_at >= MONTH {
            self.lifecycle.child_recorded = true;
            self.s.child_record_at = t;
            let life = self.life(w.pic, t, w.acc.as_ref().map(|a| a.balance));
            self.mind.record(w.cx, &life);
        }
        if let Some(go) = self.go_where_we_belong(w.pic, w.cx) {
            return self.send_go(go, w.cx);
        }
        let round = if self.p.round.is_some() { self.next_change(t) } else { i64::MAX };
        oikos_sight::Action::Wait { until: Some((t + MONTH).min(self.world_end + DAY).min(round)) }
    }
}

/// A death notification to the registry.
fn death_notification(registry: &str, words: &str, n: DeathNotification) -> oikos_sight::calls::Call {
    say("death_notification", words, Say { to: Some(vec![registry.to_string()]), data: Some(crate::papers::data(&n)), ..Default::default() })
}
/// A death reported by someone not of the family: where they were found, no family named.
fn stranger(deceased: &str, at: &str) -> DeathNotification {
    DeathNotification { deceased: deceased.into(), found_at: Some(at.into()), tell: vec![], partner: None, children: None, adult_children: None, without_adult: vec![] }
}

#[cfg(test)]
mod tests {
    use super::super::person::Said;
    use super::*;
    use crate::{Ctx, Draws, WorldInfo};
    use oikos_sight::{Action, Record, SiteCell};
    use std::sync::Arc;

    const YEAR: i64 = 365 * DAY;

    fn ctx(me: &str, params: Value) -> Ctx {
        let mut p = json!({ "mind": "plain", "registry": "registry", "bank": "bank" });
        for (k, v) in params.as_object().unwrap() {
            p[k] = v.clone();
        }
        let currency = oikos_sight::calls::Currency { code: "XTS".into(), symbol: Some("$".into()), minor_units: 2, ..Default::default() };
        Ctx {
            participant: format!("p.{me}"),
            performer: Default::default(),
            entity: me.into(),
            position: None,
            params: serde_json::from_value(p).unwrap(),
            world: Arc::new(WorldInfo { currency: Some(currency), ..Default::default() }),
        }
    }
    fn rec(v: Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).expect("a record"))
    }
    /// A building with its spaces (JSON as the street view shows them).
    fn building(id: &str, spaces: Value) -> SiteCell {
        serde_json::from_value(json!({ "cell": format!("{id}-c"), "x": 0, "y": 0, "structure": { "structure": id, "type": "house", "at": format!("{id}-c"), "w": 1, "h": 1, "complete": true, "spaces": spaces } })).unwrap()
    }
    fn space(id: &str, kind: &str, occupants: Option<Value>, left: Value) -> Value {
        let mut v = json!({ "space": id, "kind": kind, "capacity": 6, "count": occupants.as_ref().map_or(0, |o| o.as_array().unwrap().len()), "left": left });
        if let Some(o) = occupants {
            v["occupants"] = o;
        }
        v
    }
    fn pic(me: &str, t: i64, body: Value, street: Vec<SiteCell>, extra: Vec<(&str, Seen)>) -> Picture {
        let mut channels = BTreeMap::new();
        channels.insert("street".into(), Seen::Sites { as_of: t, cells: Arc::new(street), visit: None });
        let accounts = vec![serde_json::from_value(json!({ "account": format!("acc.{me}"), "holder": me, "custodian": "bank", "currency": "XTS", "balance": "500000" })).unwrap()];
        channels.insert("bank".into(), Seen::Accounts { accounts: Arc::new(accounts), transactions: vec![] });
        for (k, v) in extra {
            channels.insert(k.into(), v);
        }
        Picture {
            participant: format!("p.{me}").into(),
            t,
            status: serde_json::from_value(json!("active")).unwrap(),
            entity: me.into(),
            as_position: None,
            body: Some(serde_json::from_value(body).unwrap()),
            positions: vec![],
            outcomes: vec![],
            inbox: vec![],
            channels,
            asking: vec![],
            readings: Default::default(),
            woke_for: "cadence".into(),
            since: 0,
        }
    }
    fn adult(sex: &str, at: Option<&str>) -> Value {
        json!({ "born_at": -40 * YEAR, "sex": sex, "present": true, "alive": true, "in": at })
    }
    fn household(leaseholder: &str, members: Value) -> HouseholdData {
        serde_json::from_value(json!({ "leaseholder": leaseholder, "members": members, "couples": [["ann", "bob"]] })).unwrap()
    }
    fn member(who: &str, sex: &str, born_at: i64, parents: Option<Value>) -> Value {
        json!({ "person": who, "participant": format!("p.{who}"), "born_at": born_at, "sex": sex, "parents": parents })
    }
    fn ann_and_bob(leaseholder: &str) -> HouseholdData {
        household(leaseholder, json!([member("ann", "female", -40 * YEAR, None), member("bob", "male", -40 * YEAR, None), member("cy", "male", -8 * YEAR, Some(json!(["ann", "bob"])))]))
    }
    /// The program of each step, as text.
    fn texts(steps: &[Todo]) -> Vec<String> {
        steps.iter().map(|s| oikos_sight::calls::program_text(&s.step.program())).collect()
    }
    /// Runs `f` with a week for this picture; the steps it planned.
    fn week<R>(person: &mut Person, c: &Ctx, p: &Picture, f: impl FnOnce(&mut Person, &mut Week) -> R) -> (R, Vec<Todo>) {
        let mut d = Draws::default();
        let mut cx = Cx::new(p.t, c, &mut d, 1, vec![]);
        let acc = crate::common::money::own_banked(p, &person.me);
        let mut w = Week { pic: p, cx: &mut cx, t: p.t, acc, steps: vec![] };
        let r = f(person, &mut w);
        (r, w.steps)
    }

    #[test]
    fn a_sole_leaseholder_s_death_is_reported_by_the_partner_who_names_the_landlord_and_takes_the_lease_on_the_record() {
        // (The bug hunt of 2026-10-17, #3: bob held the lease and died; ann, who held none, reports it. The landlord is
        // told by the registry's entry, so ann names it in `tell`: she knows it from the household's record.)
        let c = ctx("ann", json!({}));
        let mut ann = Person::new(&c).unwrap();
        ann.s.household = Some(ann_and_bob("bob"));
        ann.s.household_record = Some("rec.hh".into());
        ann.s.living_at = Some("b1/dwelling.1".into());
        ann.s.share = Some((50_000, Some("rec.share".into())));
        ann.book.absorb(&{
            let mut p = pic("ann", 0, adult("female", None), vec![], vec![]);
            let hh = rec(json!({ "id": "rec.hh", "record": "statement", "author": "p.bob", "speaks_for": "bob", "at": 0, "visible_to": "public", "kind": "household", "text": "Household.",
                "data": { "leaseholder": "bob", "members": [], "landlord": "ll" } }));
            p.channels.insert("papers".into(), Seen::Records { records: vec![hh], search: false });
            p
        });
        let street = vec![building("b1", json!([space("b1/dwelling.1", "dwelling", Some(json!(["ann", "cy"])), json!([{ "occupant": "bob", "reason": "died", "at": 35 * DAY }]))]))];
        let p = pic("ann", 35 * DAY + 3_600, adult("female", Some("b1/dwelling.1")), street, vec![]);
        let (_, steps) = week(&mut ann, &c, &p, |a, w| a.see_death_at_home(w));
        let t = texts(&steps);
        let report = t.iter().find(|s| s.contains("death_notification")).expect("reported");
        assert!(report.contains("\"tell\":[\"bank\",\"ll\"]"), "the landlord named for the registry's entry: {report}");
        assert!(report.contains("\"partner\":\"ann\"") && report.contains("\"children\":[\"cy\"]"), "{report}");
        let rec_ = t.iter().find(|s| s.contains("kind=household")).expect("the household's record");
        assert!(rec_.contains("\"leaseholder\":\"ann\"") && !rec_.contains("\"person\":\"bob\"") && rec_.contains("\"landlord\":\"ll\""), "{rec_}");
        assert!(t.iter().any(|s| s.contains("withdraw=rec.share")), "our share to the dead stopped: {t:?}");
        assert!(!t.iter().any(|s| s.contains("to=") && s.contains("\"ll\"]") && !s.contains("death_notification")), "the landlord is not written to by us");
        assert_eq!(ann.s.household.as_ref().map(|h| h.leaseholder.as_str()), Some("ann"));
        assert!(ann.s.share.is_none() && ann.s.mourned.contains("bob"));
        // Seen again at the next wake: nothing more.
        let (_, again) = week(&mut ann, &c, &p, |a, w| a.see_death_at_home(w));
        assert!(again.is_empty());
    }

    #[test]
    fn a_leaseholder_names_its_own_landlord_and_only_the_first_adult_at_home_reports() {
        let c = ctx("bob", json!({}));
        let mut bob = Person::new(&c).unwrap();
        bob.s.household = Some(household("bob", json!([member("ann", "female", -40 * YEAR, None), member("dee", "female", -20 * YEAR, None), member("bob", "male", -40 * YEAR, None)])));
        bob.s.home = Some(super::super::person::Home { agreement: "rec.lease".into(), space: "b1/dwelling.1".into(), structure: "b1".into(), landlord: "ll".into(), rent: 100_000, moved_in: true, ..Default::default() });
        let left = json!([{ "occupant": "ann", "reason": "died", "at": DAY }]);
        // (dee is before bob in the household's list, and at home: dee reports.)
        let street = vec![building("b1", json!([space("b1/dwelling.1", "dwelling", Some(json!(["bob", "dee"])), left.clone())]))];
        let p = pic("bob", 2 * DAY, adult("male", Some("b1/dwelling.1")), street, vec![]);
        let (_, steps) = week(&mut bob, &c, &p, |a, w| a.see_death_at_home(w));
        assert!(!texts(&steps).iter().any(|s| s.contains("death_notification")), "dee reports, not bob");
        // Alone at home, bob reports, naming his landlord.
        let mut bob2 = Person::new(&c).unwrap();
        bob2.s.household = bob.s.household.clone();
        bob2.s.home = bob.s.home.clone();
        let street = vec![building("b1", json!([space("b1/dwelling.1", "dwelling", Some(json!(["bob"])), left)]))];
        let p = pic("bob", 2 * DAY, adult("male", Some("b1/dwelling.1")), street, vec![]);
        let (_, steps) = week(&mut bob2, &c, &p, |a, w| a.see_death_at_home(w));
        let t = texts(&steps);
        assert!(t.iter().any(|s| s.contains("death_notification") && s.contains("\"tell\":[\"bank\",\"ll\"]") && s.contains("\"partner\":\"bob\"")), "{t:?}");
    }

    #[test]
    fn a_death_told_by_a_child_is_ours_to_report_and_a_child_tells_the_first_adult_when_none_is_home() {
        // The child: bob died at home, nobody grown is there.
        let c = ctx("cy", json!({ "school": { "entity": "school", "building": "sch", "ages": [5, 17] } }));
        let mut cy = Person::new(&c).unwrap();
        cy.s.household = Some(ann_and_bob("bob"));
        let street = vec![building("b1", json!([space("b1/dwelling.1", "dwelling", Some(json!(["cy"])), json!([{ "occupant": "bob", "reason": "died", "at": DAY }]))]))];
        let body = json!({ "born_at": -8 * YEAR, "sex": "male", "present": true, "alive": true, "in": "b1/dwelling.1" });
        let p = pic("cy", 2 * DAY, body, street, vec![]);
        let (a, _) = week(&mut cy, &c, &p, |a, w| a.child_wake(w));
        let Action::Call { program, .. } = a else { panic!("a call: {a:?}") };
        let text = oikos_sight::calls::program_text(&program);
        assert!(text.contains("message") && text.contains("p.ann") && text.contains("bob has died at home, b1/dwelling.1."), "{text}");
        // The adult told: reports it, though not at home.
        let c = ctx("ann", json!({}));
        let mut ann = Person::new(&c).unwrap();
        ann.s.household = Some(ann_and_bob("bob"));
        ann.absorbed.told_dead.push(("bob".into(), "b1/dwelling.1".into()));
        let p = pic("ann", 2 * DAY, adult("female", Some("work/floor")), vec![], vec![]);
        let (_, steps) = week(&mut ann, &c, &p, |a, w| a.see_death_at_home(w));
        let t = texts(&steps);
        assert!(t.iter().any(|s| s.contains("death_notification")), "{t:?}");
        assert!(t.iter().any(|s| s.contains("occupancy") && s.contains("b1/dwelling.1")), "never knew where the household lived: goes there");
    }

    #[test]
    fn a_child_with_no_adult_left_asks_child_protection_for_help() {
        let c = ctx("cy", json!({ "child_protection": "cps" }));
        let mut cy = Person::new(&c).unwrap();
        cy.s.household = Some(ann_and_bob("bob"));
        let left = json!([{ "occupant": "bob", "reason": "died", "at": DAY }, { "occupant": "ann", "reason": "died", "at": DAY }]);
        let street = vec![building("b1", json!([space("b1/dwelling.1", "dwelling", Some(json!(["cy"])), left)]))];
        let body = json!({ "born_at": -8 * YEAR, "sex": "male", "present": true, "alive": true, "in": "b1/dwelling.1" });
        let p = pic("cy", 2 * DAY, body, street, vec![]);
        let (a, _) = week(&mut cy, &c, &p, |a, w| a.child_wake(w));
        let Action::Call { program, .. } = a else { panic!() };
        let text = oikos_sight::calls::program_text(&program);
        assert!(text.contains("care_request") && text.contains("cps") && text.contains("\"children\":[\"cy\"]"), "{text}");
        assert!(cy.lifecycle.asked_for_care);
    }

    #[test]
    fn a_death_at_work_is_reported_by_the_first_present_by_id() {
        let c = ctx("ann", json!({}));
        let mut ann = Person::new(&c).unwrap();
        ann.s.job = Some(super::super::person::Job { agreement: "rec.job".into(), employer: "shop".into(), workplace: Some("shop/floor".into()), ..Default::default() });
        let room = |occ: Value| vec![building("shop", json!([space("shop/floor", "work", Some(occ), json!([{ "occupant": "zed", "reason": "died", "at": DAY }]))]))];
        let p = pic("ann", 2 * DAY, adult("female", Some("shop/floor")), room(json!(["abe", "ann"])), vec![]);
        let (_, steps) = week(&mut ann, &c, &p, |a, w| a.see_death_at_work(w));
        assert!(steps.is_empty(), "abe is first");
        let p = pic("ann", 2 * DAY, adult("female", Some("shop/floor")), room(json!(["ann", "bea"])), vec![]);
        let (_, steps) = week(&mut ann, &c, &p, |a, w| a.see_death_at_work(w));
        let t = texts(&steps);
        assert!(t.len() == 1 && t[0].contains("\"found_at\":\"shop/floor\"") && t[0].contains("zed has died at shop/floor."), "{t:?}");
    }

    #[test]
    fn a_silent_home_next_door_is_asked_about_once_its_silence_has_gone_on() {
        let c = ctx("ann", json!({ "welfare": { "police": "police", "channel": "next", "found_after": [{ "within_days": 3, "bps": 10_000 }] } }));
        let mut ann = Person::new(&c).unwrap();
        let next = |as_of: i64| {
            let cell = building("b2", json!([{ "space": "b2/dwelling.1", "kind": "dwelling", "capacity": 2, "count": 0, "seen_entering": DAY, "seen_leaving": 0 }]));
            ("next", Seen::Sites { as_of, cells: Arc::new(vec![cell]), visit: None })
        };
        let p = pic("ann", DAY + 3_600, adult("female", None), vec![], vec![next(DAY)]);
        let (s, _) = week(&mut ann, &c, &p, |a, w| a.wonder_next_door(w));
        assert!(s.is_none(), "not yet");
        let p = pic("ann", 5 * DAY, adult("female", None), vec![], vec![next(5 * DAY)]);
        let (s, _) = week(&mut ann, &c, &p, |a, w| a.wonder_next_door(w));
        let text = oikos_sight::calls::program_text(&s.expect("asked").program());
        assert!(text.contains("welfare_check_request") && text.contains("police") && text.contains("\"since\":86400"), "{text}");
        let p = pic("ann", 9 * DAY, adult("female", None), vec![], vec![next(9 * DAY)]);
        let (s, _) = week(&mut ann, &c, &p, |a, w| a.wonder_next_door(w));
        assert!(s.is_none(), "once");
    }

    #[test]
    fn a_child_born_is_brought_home_registered_and_recorded_and_a_child_is_conceived_at_the_rate_for_her_age() {
        let c = ctx("ann", json!({ "births": true, "fertility_per_10000": [{ "from": 15, "rate": 0 }, { "from": 20, "rate": 120_000 }] }));
        let mut ann = Person::new(&c).unwrap();
        ann.s.household = Some(household("ann", json!([member("ann", "female", -30 * YEAR, None), member("bob", "male", -30 * YEAR, None)])));
        ann.s.living_at = Some("b1/dwelling.1".into());
        let both = vec![building("b1", json!([space("b1/dwelling.1", "dwelling", Some(json!(["ann", "bob"])), json!([]))]))];
        let body = |kids: Value| json!({ "born_at": -30 * YEAR, "sex": "female", "present": true, "alive": true, "children": kids });
        let p = pic("ann", 40 * DAY, body(json!([])), both.clone(), vec![]);
        let (_, steps) = week(&mut ann, &c, &p, |a, w| a.births(w));
        let t = texts(&steps);
        assert!(t.len() == 1 && t[0].contains("birth") && t[0].contains("with=bob") && t[0].contains("template=child"), "{t:?}");
        assert!(ann.lifecycle.expecting_until > 40 * DAY);
        // A month on, still expecting: nothing. Then the child is born.
        let kid = json!([{ "person": "kid", "born_at": 300 * DAY, "sex": "male", "alive": true }]);
        let p = pic("ann", 301 * DAY, body(kid), both, vec![]);
        let (_, steps) = week(&mut ann, &c, &p, |a, w| a.births(w));
        let t = texts(&steps);
        assert!(t[0].contains("occupancy") && t[0].contains("who=kid"), "{t:?}");
        assert!(t[1].contains("birth_notification") && t[1].contains("\"mother\":\"ann\""), "{t:?}");
        assert!(t[2].contains("kind=household") && t[2].contains("\"parents\":[\"ann\",\"bob\"]"), "{t:?}");
        assert_eq!(t.len(), 3, "not conceiving while expecting");
        assert!(ann.s.children_now.iter().any(|k| k.person == "kid"));
    }

    #[test]
    fn a_seller_who_means_to_leave_goes_when_what_was_queued_before_it_is_done() {
        let c = ctx("ann", json!({}));
        let mut ann = Person::new(&c).unwrap();
        ann.housing.sold_and_going = Some(10 * DAY);
        ann.todo.push(Todo::from(crate::steps::because("Paying our mortgage off.", vec![crate::steps::call("money", vec![])])));
        let p = pic("ann", 11 * DAY, adult("female", None), vec![], vec![]);
        let (waits, steps) = week(&mut ann, &c, &p, |a, w| a.leaving_town(w));
        assert!(waits && !ann.s.leaving && steps.is_empty() && ann.housing.sold_and_going == Some(10 * DAY), "the payoff comes first");
        ann.todo.clear();
        let (gone, steps) = week(&mut ann, &c, &p, |a, w| a.leaving_town(w));
        assert!(gone && ann.s.leaving && ann.housing.sold_and_going.is_none() && texts(&steps).iter().any(|s| s.contains("presence")));
    }

    #[test]
    fn a_household_long_without_a_roof_leaves_town_and_tells_the_others() {
        let c = ctx("ann", json!({ "leave_after_homeless_days": 90 }));
        let mut ann = Person::new(&c).unwrap();
        ann.s.household = Some(household("ann", json!([member("ann", "female", -30 * YEAR, None), member("bob", "male", -30 * YEAR, None)])));
        ann.s.homeless_since = Some(0);
        let p = pic("ann", 89 * DAY, adult("female", None), vec![], vec![]);
        let (gone, _) = week(&mut ann, &c, &p, |a, w| a.leaving_town(w));
        assert!(!gone);
        let p = pic("ann", 90 * DAY, adult("female", None), vec![], vec![]);
        let (gone, steps) = week(&mut ann, &c, &p, |a, w| a.leaving_town(w));
        let t = texts(&steps);
        assert!(gone && ann.s.leaving);
        assert!(t[0].contains("p.bob") && t[0].contains("We're leaving town."), "{t:?}");
        assert!(t.iter().any(|s| s.contains("departure") && s.contains("presence")), "{t:?}");
        // Not the leaseholder: the household's leaseholder decides.
        let c = ctx("bob", json!({}));
        let mut bob = Person::new(&c).unwrap();
        bob.s.household = ann.s.household.clone();
        bob.s.homeless_since = Some(0);
        let p = pic("bob", 200 * DAY, adult("male", None), vec![], vec![]);
        assert!(!week(&mut bob, &c, &p, |a, w| a.leaving_town(w)).0);
    }

    #[test]
    fn the_daily_round_takes_us_to_work_in_its_hours_and_not_again_where_the_world_refused() {
        let round = json!({ "work_start": 9 * 3_600, "work_end": 17 * 3_600, "work_days": 5, "school_start": 9 * 3_600, "school_end": 15 * 3_600 });
        let c = ctx("ann", json!({ "round": round }));
        let mut ann = Person::new(&c).unwrap();
        ann.s.home = Some(super::super::person::Home { agreement: "rec.lease".into(), space: "b1/dwelling.1".into(), landlord: "ll".into(), moved_in: true, ..Default::default() });
        ann.s.job = Some(super::super::person::Job { agreement: "rec.job".into(), employer: "shop".into(), workplace: Some("shop/floor".into()), ..Default::default() });
        let at = |t: i64, here: &str| pic("ann", t, adult("female", Some(here)), vec![], vec![]);
        let mut d = Draws::default();
        let mut cx = Cx::new(0, &c, &mut d, 1, vec![]);
        // Day 0 is a working day: 10 o'clock, at work; 18 o'clock, home; day 5 (a day off), home.
        assert_eq!(ann.belong(&at(10 * 3_600, "b1/dwelling.1")).as_deref(), Some("shop/floor"));
        assert_eq!(ann.belong(&at(18 * 3_600, "shop/floor")).as_deref(), Some("b1/dwelling.1"));
        assert_eq!(ann.belong(&at(5 * DAY + 10 * 3_600, "b1/dwelling.1")).as_deref(), Some("b1/dwelling.1"));
        assert_eq!(ann.next_change(10 * 3_600), 15 * 3_600, "school ends next");
        let go = ann.go_where_we_belong(&at(10 * 3_600, "b1/dwelling.1"), &mut cx).expect("off to work");
        assert_eq!(go.mark, Mark::Go("shop/floor".into()));
        assert_eq!(go.step.why.as_deref(), Some("Off to work: shop/floor."));
        assert!(ann.go_where_we_belong(&at(10 * 3_600, "shop/floor"), &mut cx).is_none(), "there already");
        // The world refused it (the workplace coming down): not again.
        ann.s.pending_go = Some("shop/floor".into());
        let mut p = at(11 * 3_600, "b1/dwelling.1");
        p.outcomes = vec![serde_json::from_value(json!({ "action": "a1", "t": 11 * 3_600, "status": "refused", "refusal": { "code": "coming_down" } })).unwrap()];
        ann.heard_go(&p);
        assert!(ann.go_where_we_belong(&p, &mut cx).is_none());
        assert!(ann.go_where_we_belong(&at(DAY + 10 * 3_600, "b1/dwelling.1"), &mut cx).is_none(), "never again");
        // Our home under water: the relief centre for a day.
        let c = ctx("bea", json!({ "round": round, "relief": "hall/main" }));
        let mut bea = Person::new(&c).unwrap();
        bea.s.living_at = Some("b1/dwelling.2".into());
        bea.s.pending_go = Some("b1/dwelling.2".into());
        let mut p = pic("bea", 20 * 3_600, adult("female", Some("x/y")), vec![], vec![]);
        p.outcomes = vec![serde_json::from_value(json!({ "action": "a1", "t": 0, "status": "refused", "refusal": { "code": "flooded" } })).unwrap()];
        bea.heard_go(&p);
        assert_eq!(bea.belong(&p).as_deref(), Some("hall/main"));
    }

    #[test]
    fn ill_enough_we_go_to_the_clinic_and_too_ill_we_stay_off_work() {
        let care = json!({ "entity": "clinic", "waiting": "clinic/waiting", "seek_bps": 10_000, "severities": ["mild", "serious"], "off_work": ["serious"], "wait_days": 2 });
        let c = ctx("ann", json!({ "care": care }));
        let mut ann = Person::new(&c).unwrap();
        ann.s.job = Some(super::super::person::Job { agreement: "rec.job".into(), employer: "shop".into(), workplace: Some("shop/floor".into()), ..Default::default() });
        let mut body = adult("female", Some("shop/floor"));
        body["conditions"] = json!([{ "id": "cond.1", "kind": "illness", "severity": "serious", "since": 0, "until": 10 * DAY }]);
        let street = vec![building("shop", json!([space("shop/floor", "work", Some(json!(["ann"])), json!([]))]))];
        let p = pic("ann", DAY, body.clone(), street, vec![]);
        let (_, steps) = week(&mut ann, &c, &p, |a, w| a.schooling_and_care(w));
        let t = texts(&steps);
        assert!(t[0].contains("sick_leave") && t[0].contains("shop") && t[0].contains("leave=yes"), "{t:?}");
        assert!(t[1].contains("care_request") && t[1].contains("clinic/waiting") && t[1].contains("\"kind\":\"illness\""), "{t:?}");
        assert_eq!(ann.lifecycle.off_sick.as_deref(), Some("shop/floor"));
        // Better: back to work, and home from the clinic once waited long enough.
        body["conditions"] = json!([]);
        let street = vec![building("clinic", json!([space("clinic/waiting", "waiting", Some(json!(["ann"])), json!([]))]))];
        let p = pic("ann", 4 * DAY, body, street, vec![]);
        let (_, steps) = week(&mut ann, &c, &p, |a, w| a.schooling_and_care(w));
        let t = texts(&steps);
        assert!(t.iter().any(|s| s.contains("shop/floor") && !s.contains("leave")), "{t:?}");
        assert!(t.iter().any(|s| s.contains("clinic/waiting") && s.contains("leave=yes")), "{t:?}");
        assert!(ann.lifecycle.off_sick.is_none() && ann.lifecycle.at_clinic.is_none());
    }

    #[test]
    fn a_child_of_school_age_asks_for_a_place_once_a_month_and_hears_a_tenancy_ended() {
        let c = ctx("cy", json!({ "school": { "entity": "school", "building": "sch", "ages": [5, 17] } }));
        let mut cy = Person::new(&c).unwrap();
        cy.s.last_dwelling = Some("b1/dwelling.1".into());
        cy.s.heard.push(("ann".into(), Said::MoveOut("b1".into())));
        let body = json!({ "born_at": -8 * YEAR, "sex": "male", "present": true, "alive": true });
        let p = pic("cy", DAY, body.clone(), vec![], vec![]);
        let (a, _) = week(&mut cy, &c, &p, |a, w| a.child_wake(w));
        let Action::Call { program, .. } = a else { panic!() };
        assert!(oikos_sight::calls::program_text(&program).contains("school_enrolment"));
        assert!(cy.s.gave_up.contains("b1/dwelling.1"), "no longer where we go back to");
        let p = pic("cy", 10 * DAY, body, vec![], vec![]);
        let (a, _) = week(&mut cy, &c, &p, |a, w| a.child_wake(w));
        assert!(matches!(a, Action::Wait { .. }), "asked this month already");
        assert!(cy.lifecycle.child_recorded);
    }

    #[test]
    fn lifecycle_memory_saves() {
        let c = ctx("ann", json!({}));
        let ann = Person::new(&c).unwrap();
        let v = serde_json::to_value(&ann.lifecycle).unwrap();
        let back: Lifecycle = serde_json::from_value(v).unwrap();
        assert_eq!(back.next_fertility, ann.lifecycle.next_fertility);
        assert!(back.next_fertility < 30 * DAY);
    }
}
