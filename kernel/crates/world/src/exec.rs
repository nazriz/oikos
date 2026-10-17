//! Applying blocks and scheduled effects to a State (v0.4).
//!
//! Blocks run against a scratch copy of the state; the caller commits it only
//! if every block in the action succeeds, which makes actions atomic.
//!
//! The only reasons a block can fail here are physics (custody, funds,
//! capacity, ground, presence, life, reach, who holds what) and mechanics
//! (references must point at things that exist). Nothing here knows what any
//! law, permit, lease, charter or procedure says (D18, D19): holding a position
//! is the physical capacity to act for an organisation, and only an organisation
//! (through a position it has) can create or fill its own positions, as only a
//! bank can move the money it keeps.

use crate::blocks::{AgreementTerms, Basis, BasisArg, Block, Id, Record, RecordBody, Visibility};
use crate::canon::MAX_SAFE;
use crate::money::{Money, MAX_MONEY};
use crate::config::{check_channels, footprint_cells, split_space, Channel, ParticipantKind, Severity, BOUNDARY, PERSON, SELF};
use crate::events::{EndReason, EventBody, RefusalCode, Timed, TransferReason, VacateReason};
use crate::state::{transactions_key, 
    Account, Body, Condition, ConditionKind, DeathCause, Entity, Message, Participant, ParticipantDef, ParticipantStatus, Position, Sched,
    Scheduled, Sex, State, Structure, Transaction,
};
use crate::statics::Statics;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    pub code: RefusalCode,
    pub block: Option<usize>,
    pub detail: Option<String>,
}

pub fn refuse(code: RefusalCode, detail: impl Into<String>) -> Refusal {
    Refusal { code, block: None, detail: Some(detail.into()) }
}

pub type R<T> = Result<T, Refusal>;

pub struct Exec<'a> {
    pub s: &'a Statics,
    pub st: &'a mut State,
    /// The acting participant, the position it acts in (None: as itself), and the entity that makes it.
    pub participant: &'a str,
    pub position: Option<&'a str>,
    pub entity: Id,
    /// Local refs bound so far in this action.
    pub refs: BTreeMap<String, Id>,
    pub events: Vec<Timed>,
    /// A survey's estimates, for the actor alone (nature).
    pub surveyed: Option<Value>,
    pub investigated: Option<Value>,
    /// Who was where a work was ordered, by what it is on (a person, or a space): a work takes the crew's hours, so it
    /// takes effect hours after it was ordered, and those it is worked on are those who were there then (F1).
    pub seen: Option<&'a BTreeMap<Id, Vec<Id>>>,
    /// The buildings worked on by people sent to them, in the order first worked on (what they see is made when the
    /// act is done).
    pub worked_on: Vec<Id>,
    /// Who the action named to do its work, and whether their being at work was looked at when it began (F3).
    pub by: &'a [Id],
    pub started: bool,
}

pub struct ExecResult {
    pub events: Vec<Timed>,
    pub created: BTreeMap<String, Id>,
    pub surveyed: Option<Value>,
    pub investigated: Option<Value>,
    /// The buildings worked on, each as those who worked on it left it (for the actor alone).
    pub seen: Vec<crate::sites::SiteStructure>,
}

/// Can this participant act now? (Active, or opted out with a stand-in carrying on.)
pub fn can_act(p: &Participant) -> bool {
    match p.status {
        ParticipantStatus::Active => true,
        ParticipantStatus::OptedOut => !p.def.vacant_after_opt_out(),
        ParticipantStatus::Ended => false,
    }
}

/// Apply `blocks` for `participant` (in `position`, or as itself) to `st`. On error, `st` is left
/// partly modified and must be discarded.
pub fn exec_action(s: &Statics, st: &mut State, participant: &str, position: Option<&str>, blocks: &[Block], by: &[Id]) -> R<ExecResult> {
    exec_action_seen(s, st, participant, position, blocks, by, None, false)
}

/// A person who is to do work: alive and in the world; and, if `at` is given, in that structure (in a space of the
/// given kind, if given); else in a space of the kind the world says work is done in (`orchestration.performers_in`),
/// if it says. The one rule for a `work`'s performers and for an action's `by` (foundations F3).
pub fn check_at_work(s: &Statics, st: &State, p: &str, at: Option<&str>, space: Option<&str>) -> R<()> {
    // (A system has no body to be anywhere: it does the work while it is in service. Whether its template lists the
    // work is looked at when the act is ordered, `check_system_does`.)
    if let Some(x) = st.participants.get(p).filter(|x| x.kind == ParticipantKind::System) {
        return if can_act(x) { Ok(()) } else { Err(refuse(RefusalCode::ParticipantInactive, format!("{p} no longer acts"))) };
    }
    let b = st.body(p).ok_or_else(|| {
        if st.entities.contains_key(p) {
            refuse(RefusalCode::NotAPerson, format!("{p} isn't a person"))
        } else {
            refuse(RefusalCode::UnknownEntity, format!("no entity {p}"))
        }
    })?;
    if !b.alive {
        return Err(refuse(RefusalCode::Dead, format!("{p} has died")));
    }
    if !b.present {
        return Err(refuse(RefusalCode::NotPresent, format!("{p} isn't in the world")));
    }
    let kind = space.or(if at.is_none() { s.performers_in.as_deref() } else { None });
    let in_kind = |space: &str| kind.is_none_or(|k| split_space(space).is_some_and(|(_, local)| local.split('.').next() == Some(k)));
    let there = match at {
        Some(at) => st.occupancy.get(at).is_some_and(|m| m.iter().any(|(sp, bodies)| bodies.contains(p) && in_kind(sp))),
        None => kind.is_none() || st.occupancy.values().any(|m| m.iter().any(|(sp, bodies)| bodies.contains(p) && in_kind(sp))),
    };
    if !there {
        return Err(refuse(
            RefusalCode::NotAtWork,
            match at {
                Some(at) => format!("{p} isn't at {at}{}", kind.map_or(String::new(), |k| format!(" (in a {k})"))),
                None => format!("{p} isn't at work (in a {})", kind.unwrap_or_default()),
            },
        ));
    }
    Ok(())
}

/// A system that is to act, or to do an organisation's work (foundations F4): it must be in service and, if it is to do
/// another's, belong to the organisation the act is for (`org`); and each block must be one its template lists
/// (`not_capable`).
pub fn check_system_does(s: &Statics, st: &State, sys: &str, org: Option<&str>, blocks: &[Block]) -> R<()> {
    let x = st.participants.get(sys).ok_or_else(|| refuse(RefusalCode::UnknownParticipant, format!("no participant {sys}")))?;
    if !can_act(x) {
        return Err(refuse(RefusalCode::ParticipantInactive, format!("{sys} no longer acts")));
    }
    if let Some(org) = org {
        if x.owner.as_deref() != Some(org) {
            return Err(refuse(RefusalCode::NotTheirs, format!("{sys} isn't a system belonging to {org}")));
        }
    }
    // (Every system names a template, and a template says what it does: the world does not load otherwise.)
    let rows: &[oikos_contracts::config::Does] = x.template.as_ref().and_then(|t| s.templates.get(t)).and_then(|t| t.does.as_deref()).unwrap_or(&[]);
    for b in blocks {
        let makes = b.makes();
        if !rows.iter().any(|r| r.covers(b.name(), makes.as_deref())) {
            return Err(refuse(
                RefusalCode::NotCapable,
                format!("{sys} can't {}: its kind of system ({}) doesn't do that", makes.as_deref().unwrap_or(b.name()), x.template.as_deref().unwrap_or("-")),
            ));
        }
    }
    Ok(())
}

/// Whether an organisation may direct a person's time: the person is it (its own, a sole trader's), holds one of its
/// posts, or is party, with it, to an agreement in force or ending (an employment). The kernel reads the agreement by its
/// terms only (`oikos_terms::read`); whether it is a good one is for the world.
pub fn may_direct(st: &State, entity: &str, person: &str) -> bool {
    if entity == person {
        return true;
    }
    let holds = st.positions_of.get(entity).into_iter().flatten().any(|pos| {
        st.positions.get(pos).and_then(|x| x.holder.as_ref()).and_then(|h| st.participants.get(h)).is_some_and(|p| p.person.as_deref() == Some(person))
    });
    holds
        || st.agreements_of.get(person).into_iter().flatten().any(|id| {
            let Some(RecordBody::Agreement { terms }) = st.records.get(id).map(|r| &r.record.body) else { return false };
            terms.parties.iter().any(|p| p == entity) && {
                let m = st.marks.get(id).cloned().unwrap_or_default();
                matches!(oikos_terms::read(terms, &m.signatures, &m.notices, st.t).status, "in_force" | "ending")
            }
        })
}

/// What `exec_action` takes besides the blocks, for an act whose work was ordered earlier: `seen` says who was where
/// when it was; `by` is who the action named; `started` that the performers' being there was looked at when the work
/// began (so it is not looked at again when it ends).
pub fn exec_action_seen(s: &Statics, st: &mut State, participant: &str, position: Option<&str>, blocks: &[Block], by: &[Id], seen: Option<&BTreeMap<Id, Vec<Id>>>, started: bool) -> R<ExecResult> {
    let p = st.participants.get(participant).ok_or_else(|| refuse(RefusalCode::UnknownParticipant, format!("no participant {participant}")))?;
    if !can_act(p) {
        return Err(refuse(RefusalCode::ParticipantInactive, format!("{participant} no longer acts")));
    }
    let entity = match position {
        Some(pos) => {
            let x = st.positions.get(pos).ok_or_else(|| refuse(RefusalCode::UnknownPosition, format!("no position {pos}")))?;
            if x.holder.as_deref() != Some(participant) {
                return Err(refuse(RefusalCode::NotInPosition, format!("{participant} doesn't hold {pos}")));
            }
            x.entity.clone()
        }
        None => p.person.clone().ok_or_else(|| refuse(RefusalCode::NotInPosition, format!("{participant} is a system: it acts only in a position")))?,
    };
    // A person's participant acts through a body that lives.
    if p.kind == ParticipantKind::Person {
        if let Some(who) = &p.person {
            if st.body(who).is_some_and(|b| !b.alive) {
                return Err(refuse(RefusalCode::Dead, format!("{who} has died")));
            }
        }
    }
    // A system acts only within its template, and for the organisation it belongs to.
    if p.kind == ParticipantKind::System {
        check_system_does(s, st, participant, Some(&entity), blocks)?;
    }
    for w in by {
        if w != participant && p.person.as_deref() != Some(w.as_str()) {
            if st.participants.get(w).is_some_and(|x| x.kind == ParticipantKind::System) {
                // (A system named to do the act's work: the organisation's own, and the act within its template.)
                check_system_does(s, st, w, Some(&entity), blocks)?;
            } else if !may_direct(st, &entity, w) {
                return Err(refuse(RefusalCode::NotTheirs, format!("{w} isn't someone {entity} may direct (not its own, nor in its posts, nor employed by it)")));
            } else if started {
                // (Looked at when the work began; here only that they are alive.)
                st.body(w).filter(|b| b.alive).ok_or_else(|| refuse(RefusalCode::Dead, format!("{w} has died")))?;
            } else {
                check_at_work(s, st, w, None, None)?;
            }
        }
    }
    let mut ex = Exec { s, st, participant, position, entity, refs: BTreeMap::new(), events: vec![], surveyed: None, investigated: None, seen, worked_on: vec![], by, started };
    for (i, b) in blocks.iter().enumerate() {
        ex.block(b, i).map_err(|mut r| {
            r.block.get_or_insert(i);
            r
        })?;
    }
    // Those who did the work were there: each building worked on, as it is when the act is done (one brought down
    // by it leaves nothing to see).
    let seen = ex.worked_on.iter().filter(|sid| ex.st.structures.contains_key(*sid)).map(|sid| crate::sites::site_structure(ex.s, ex.st, sid, &ex.entity, false)).collect();
    Ok(ExecResult { events: ex.events, created: ex.refs, surveyed: ex.surveyed, investigated: ex.investigated, seen })
}

// ---------------- life: shared by acts and scheduled effects ----------------

/// A condition's band, how long it lasts, and when (if) it kills: by the band's fatality at the body's age.
fn draw_severity(s: &Statics, bands: &[Severity], age: i64, key: &[&str]) -> (String, i64, Option<i64>) {
    let mut rng = s.randomness.stream(key);
    let mut x = rng.below(10_000) as u32;
    let band = bands.iter().find(|b| {
        if x < b.share_bps {
            true
        } else {
            x -= b.share_bps;
            false
        }
    });
    let band = band.unwrap_or(&bands[bands.len() - 1]);
    let days = band.days[0] as i64 + rng.below((band.days[1] - band.days[0] + 1) as u64) as i64;
    let duration = days * 86_400;
    let fatal = band.fatal_by_age.as_ref().map_or(band.fatal_bps, |steps| crate::config::ByAge { by_age: steps.clone() }.at(age));
    let death = (rng.below(10_000) < fatal as u64).then(|| rng.below(duration as u64) as i64);
    (band.label.clone(), duration, death)
}

fn death_cause(kind: ConditionKind) -> DeathCause {
    match kind {
        ConditionKind::Illness => DeathCause::Illness,
        ConditionKind::Injury => DeathCause::Injury,
    }
}

/// A condition begins now (and may end in death within it).
fn begin_condition(s: &Statics, st: &mut State, person: &str, kind: ConditionKind, severity: String, until: i64, death_at: Option<i64>) -> (Id, Vec<Timed>) {
    let t = st.t;
    let id = st.mint("cnd");
    if let Some(b) = st.entities.get_mut(person).and_then(|e| e.body.as_mut()) {
        b.conditions.push(Condition { id: id.clone(), kind, severity: severity.clone(), since: t, until, death_at: death_at.map(|d| d.max(t)), treated: false });
    }
    st.schedule(until.max(t + s.tick), Sched::ConditionEnds { person: person.into(), condition: id.clone() });
    if let Some(d) = death_at {
        st.schedule(d.max(t), Sched::Death { person: person.into(), cause: death_cause(kind), condition: Some(id.clone()) });
    }
    (id.clone(), vec![Timed::new(t, EventBody::ConditionBegan { person: person.into(), condition: id, kind, severity, until })])
}

/// The whole day a time falls in.
pub fn day_of(t: i64) -> i64 {
    t.div_euclid(86_400)
}

/// The state variables that apply to a structure type (phase B).
pub fn vars_for<'a>(s: &'a Statics, ty: &'a str) -> impl Iterator<Item = &'a crate::config::VariableCfg> + 'a {
    s.config.catalogue.variables.iter().filter(move |v| v.types.as_ref().is_none_or(|ts| ts.iter().any(|x| x == ty)))
}

/// A structure's variable at time `t`: its settled value, plus the whole days since at today's occupancy, within
/// bounds. Exact integers; the same whenever it's read.
pub fn variable_at(st: &State, sid: &str, var: &crate::config::VariableCfg, t: i64) -> Option<i64> {
    let x = st.structures.get(sid)?;
    let (v, since) = *x.variables.get(&var.id)?;
    let days = (day_of(t) - since).max(0);
    let occupants = st.occupancy.get(sid).map_or(0, |m| m.values().map(|b| b.len()).sum::<usize>()) as i64;
    let rate = var.per_day.saturating_add(var.per_occupant_per_day.saturating_mul(occupants));
    Some(v.saturating_add(rate.saturating_mul(days)).clamp(var.min, var.max))
}

/// Settle a structure's variables to now: before its occupancy changes, or work changes one.
fn settle(s: &Statics, st: &mut State, sid: &str) {
    let t = st.t;
    let Some(ty) = st.structures.get(sid).map(|x| x.structure_type.clone()) else { return };
    let now: Vec<(Id, i64)> = vars_for(s, &ty).filter_map(|v| variable_at(st, sid, v, t).map(|x| (v.id.clone(), x))).collect();
    if let Some(x) = st.structures.get_mut(sid) {
        for (id, v) in now {
            x.variables.insert(id, (v, day_of(t)));
        }
    }
}

/// A structure's variables at their initial values, from a time (when it's begun, or at genesis).
pub fn init_variables(s: &Statics, ty: &str, t: i64) -> std::collections::BTreeMap<Id, (i64, i64)> {
    vars_for(s, ty).map(|v| (v.id.clone(), (v.initial, day_of(t)))).collect()
}

/// Bodies leave a structure's spaces: the one way out, whatever the cause (leaving, being removed, dying, crossing out
/// of the world, a flood, a demolition), so that no cause can miss a step. `who` alone leaves, or (None) everyone there;
/// from the space `only`, or (None) from every space of the structure. If anyone does: the structure's variables are
/// settled first (its occupancy is about to change), the bodies are taken out, each departure is recorded for those
/// who can see who's there, and a `Vacated` event is added for each. Returns who left where (space, body), spaces in
/// order and the bodies of each in order.
///
/// The stamps are the caller's, as each has always made them (the structure touched, the bodies moved: their order
/// is part of the state, so it's kept).
#[allow(clippy::too_many_arguments)]
fn leave_spaces(s: &Statics, st: &mut State, sid: &str, who: Option<&str>, only: Option<&str>, reason: VacateReason, by: Option<&str>, events: &mut Vec<Timed>) -> Vec<(Id, Id)> {
    let t = st.t;
    let leaves = |space: &Id, bodies: &BTreeSet<Id>| only.is_none_or(|o| o == space) && who.map_or(!bodies.is_empty(), |w| bodies.contains(w));
    if !st.occupancy.get(sid).is_some_and(|m| m.iter().any(|(space, bodies)| leaves(space, bodies))) {
        return vec![];
    }
    settle(s, st, sid);
    let mut left: Vec<(Id, Id)> = vec![];
    if let Some(m) = st.occupancy.get_mut(sid) {
        let m = Arc::make_mut(m);
        for (space, bodies) in m.iter_mut() {
            if !leaves(space, bodies) {
                continue;
            }
            match who {
                Some(w) => {
                    bodies.remove(w);
                    left.push((space.clone(), w.to_string()));
                }
                None => left.extend(std::mem::take(bodies).into_iter().map(|b| (space.clone(), b))),
            }
        }
        m.retain(|_, b| !b.is_empty());
        if m.is_empty() {
            st.occupancy.remove(sid);
        }
    }
    for (space, body) in &left {
        st.left_space(sid, body);
        st.record_departure(space, body, reason);
        events.push(Timed::new(t, EventBody::Vacated { occupant: body.clone(), space: space.clone(), by: by.map(String::from), reason }));
    }
    left
}

/// Take a body out of every space it's in.
fn vacate_all(s: &Statics, st: &mut State, person: &str, reason: VacateReason, by: Option<&str>) -> Vec<Timed> {
    let mut events = vec![];
    for sid in st.structures_of(person) {
        leave_spaces(s, st, &sid, Some(person), None, reason, by, &mut events);
        st.touch_structure(&sid);
    }
    if !events.is_empty() {
        st.moved(person);
    }
    events
}

/// Every position a participant holds falls vacant (it has gone).
fn vacate_positions(st: &mut State, participant: &str) -> Vec<Timed> {
    let t = st.t;
    let held: Vec<Id> = st.held_by(participant).into_iter().cloned().collect();
    let mut events = vec![];
    for id in held {
        let c = st.stamp();
        st.set_holder(&id, None, c);
        events.push(Timed::new(t, EventBody::Appointed { position: id, holder: None, by: None }));
    }
    events
}

fn end_participant(st: &mut State, participant: &str, reason: EndReason) -> Vec<Timed> {
    let t = st.t;
    let c = st.stamp();
    let Some(p) = st.participants.get_mut(participant) else { return vec![] };
    let p = Arc::make_mut(p);
    if p.status == ParticipantStatus::Ended {
        return vec![];
    }
    p.status = ParticipantStatus::Ended;
    p.status_changed = c;
    let mut events = vacate_positions(st, participant);
    events.push(Timed::new(t, EventBody::ParticipantEnded { participant: participant.into(), reason }));
    events
}

/// Every seat sharing a person's body (a model in one of the person's posts), apart from the person's own participant.
fn seats_of(st: &State, person: &str, own: Option<&str>) -> Vec<Id> {
    st.participants.iter().filter(|(id, p)| p.person.as_deref() == Some(person) && own != Some(id.as_str()) && p.status != ParticipantStatus::Ended).map(|(id, _)| id.clone()).collect()
}

fn die(s: &Statics, st: &mut State, person: &str, cause: DeathCause) -> Vec<Timed> {
    let t = st.t;
    let Some(b) = st.body(person) else { return vec![] };
    if !b.alive {
        return vec![];
    }
    let participant = b.participant.clone();
    let seats = seats_of(st, person, participant.as_deref());
    let mut events = vacate_all(s, st, person, VacateReason::Died, None);
    if let Some(b) = st.entities.get_mut(person).and_then(|e| e.body.as_mut()) {
        b.alive = false;
        b.conditions.clear();
    }
    events.push(Timed::new(t, EventBody::PersonDied { person: person.into(), died_of: cause }));
    if let Some(p) = participant {
        events.extend(end_participant(st, &p, EndReason::Died));
    }
    for seat in seats {
        events.extend(end_participant(st, &seat, EndReason::Died));
    }
    events
}

/// Draw a template's traits: values as given; `{"uniform": [lo, hi]}` and `{"pick": {value: weight}}` drawn
/// (a pick's values in key order, each with its share of the total weight).
fn draw_traits(s: &Statics, traits: &Option<Value>, participant: &str) -> Option<Value> {
    let Value::Object(m) = traits.as_ref()? else { return traits.clone() };
    let mut out = serde_json::Map::new();
    for (k, v) in m {
        let obj = v.as_object();
        let drawn = if let Some(a) = obj.and_then(|o| o.get("uniform")).and_then(|u| u.as_array()) {
            let (lo, hi) = (a[0].as_i64().unwrap_or(0), a[1].as_i64().unwrap_or(0));
            let mut rng = s.randomness.stream(&["traits", participant, k]);
            Value::from(lo + rng.below((hi - lo + 1) as u64) as i64)
        } else if let Some(w) = obj.and_then(|o| o.get("pick")).and_then(|p| p.as_object()) {
            let mut weights: Vec<(&String, u64)> = w.iter().map(|(x, n)| (x, n.as_u64().unwrap_or(0))).collect();
            weights.sort_by(|a, b| a.0.cmp(b.0));
            let total: u64 = weights.iter().map(|x| x.1).sum();
            let mut r = s.randomness.stream(&["traits", participant, k]).below(total);
            let mut chosen = weights[0].0;
            for (x, n) in weights {
                if r < n {
                    chosen = x;
                    break;
                }
                r -= n;
            }
            Value::from(chosen.clone())
        } else {
            v.clone()
        };
        out.insert(k.clone(), drawn);
    }
    Some(Value::Object(out))
}

/// A new participant from a template.
fn create_participant(s: &Statics, st: &mut State, template: &str, person: Option<Id>, owner: Option<Id>, supplier: Option<Id>, title: Option<String>) -> (Id, Vec<Timed>) {
    let t = st.t;
    let tpl = &s.templates[template];
    let id = st.mint("par");
    let traits = draw_traits(s, &tpl.traits, &id);
    let c = st.stamp();
    st.participants.insert(
        id.clone(),
        Arc::new(Participant {
            kind: tpl.kind,
            person: person.clone(),
            owner: owner.clone(),
            template: Some(template.into()),
            supplier: supplier.clone(),
            def: Arc::new(ParticipantDef {
                title: title.or_else(|| tpl.title.clone()),
                channels: Arc::new(tpl.channels.clone()),
                controller: Arc::new(tpl.controller.clone()),
                framing: Arc::new(tpl.framing.clone()),
                on_opt_out: tpl.on_opt_out.clone(),
                lanes: None,
            }),
            traits: traits.clone(),
            status: ParticipantStatus::Active,
            status_changed: c,
            pending: BTreeMap::new(),
            new_transactions: BTreeMap::new(),
            looks: BTreeMap::new(),
        }),
    );
    let ev = Timed::new(t, EventBody::ParticipantCreated { participant: id.clone(), kind: tpl.kind, person, owner, template: template.into(), supplier, traits });
    (id, vec![ev])
}

/// A new body, with its participant from a template.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
fn create_person(s: &Statics, st: &mut State, name: &str, born_at: i64, sex: Option<Sex>, parents: Vec<Id>, present: bool, template: &str, variables: Option<&BTreeMap<Id, i64>>) -> (Id, Vec<Timed>) {
    let t = st.t;
    let id = st.mint("ent");
    let c = st.stamp();
    st.entities.insert(
        id.clone(),
        Entity {
            kind: PERSON.into(),
            name: name.into(),
            changed: c,
            moved: 0,
            body: Some(Body { born_at, sex, present, alive: true, parents: parents.clone(), conditions: vec![], participant: None, children: vec![], variables: crate::state::body_variables(&s.config.catalogue, variables, t) }),
        },
    );
    // The parents' bodies record the child.
    for p in &parents {
        if let Some(b) = st.entities.get_mut(p).and_then(|e| e.body.as_mut()) {
            b.children.push(id.clone());
        }
        if let Some(e) = st.entities.get_mut(p) {
            e.changed = c;
        }
    }
    let (pid, mut pev) = create_participant(s, st, template, Some(id.clone()), None, None, None);
    st.entities.get_mut(&id).unwrap().body.as_mut().unwrap().participant = Some(pid.clone());
    schedule_birthday(s, st, &id, born_at);
    let mut events = vec![Timed::new(t, EventBody::PersonCreated { person: id.clone(), name: name.into(), born_at, sex, parents, participant: Some(pid) })];
    events.append(&mut pev);
    (id, events)
}

/// Schedule a body's yearly draws (when the world has life physics): now, for what's left of its year of age, and then
/// at each birthday. (Until 2026-10-05 the first was at its next birthday: from the start of a run, an arrival or a
/// birth until then, about half a year on average, a body could not fall ill, be hurt or die.)
pub fn schedule_birthday(s: &Statics, st: &mut State, person: &str, born_at: i64) {
    let Some(life) = s.life() else { return };
    let _ = life;
    // (Made here, not scheduled: they belong to the moment the body enters the world, and are undone with it if the act
    // that brought it is refused.)
    if st.t >= born_at {
        let t = st.t;
        yearly_draws(s, st, person, t);
    } else {
        st.schedule(born_at, Sched::Birthday { person: person.into() });
    }
}

/// A body's draws for the time to its next birthday (a whole year, at a birthday; what's left of one, as it enters the
/// world): death from other causes, illness, exposure to injury; and its next birthday.
fn yearly_draws(s: &Statics, st: &mut State, person: &str, t: i64) {
    let person = person.to_string();
    let (Some(life), Some(b)) = (s.life(), st.body(&person)) else { return };
    if !b.alive {
        return;
    }
    let born = b.born_at;
    let age = (t - born) / life.year;
    let a = age.to_string();
    let year = life.year;
    // The time these draws cover: to the next birthday (a whole year, at a birthday; what's left of one, for a
    // body entering the world part-way through its year). A year's chance, over it, is that share of it.
    let window = (born + (age + 1) * year - t).clamp(1, year);
    let within = |p: i64, what: &str| uniform(s, &["life", &person, &a, what], 10_000 * year) < p.saturating_mul(window);
    if let Some(oc) = &life.other_causes {
        if within(oc.at(age) as i64, "other") {
            let at = t + uniform(s, &["life", &person, &a, "other-when"], window);
            st.schedule(at, Sched::Death { person: person.clone(), cause: DeathCause::Other, condition: None });
        }
    }
    if let Some(ill) = life.illness.as_ref().filter(|ill| !ill.fields.is_empty()) {
        // Illness that fields raise (pollution where the body is): a candidate drawn at the highest the fields
        // could make it, kept, when it comes, at the rate where the body is then (thinning, as injuries).
        let p = crate::config::ByAge { by_age: ill.by_age.clone() }.at(age) as i64;
        let most: i64 = ill.fields.iter().map(|f| f.bps_per_unit.max(0).saturating_mul(s.config.catalogue.fields.iter().find(|x| x.id == f.field).map_or(0, |x| x.max.max(0)))).fold(0i64, |a, b| a.saturating_add(b));
        let max_bps = p.saturating_add(most).clamp(0, 10_000) as u32;
        if max_bps > 0 && within(max_bps as i64, "ill") {
            let at = t + uniform(s, &["life", &person, &a, "ill-when"], window);
            st.schedule(at, Sched::IllnessExposure { person: person.clone(), max_bps, age });
        }
    } else if let Some(ill) = &life.illness {
        let p = crate::config::ByAge { by_age: ill.by_age.clone() }.at(age);
        if within(p as i64, "ill") {
            let onset = t + uniform(s, &["life", &person, &a, "ill-when"], window);
            let (severity, duration, death) = draw_severity(s, &ill.severity, age, &["life", &person, &a, "ill-how"]);
            st.schedule(onset, Sched::ConditionBegins {
                person: person.clone(), kind: ConditionKind::Illness, severity, until: onset + duration, death_at: death.map(|d| onset + d),
            });
        }
    }
    if let Some(inj) = &life.injury {
        let most = s.types.values().filter_map(|ty| ty.injury_bps).max().unwrap_or(0);
        let max_bps = (inj.bps + most * 2).min(10_000);
        if max_bps > 0 && within(max_bps as i64, "exposed") {
            let at = t + uniform(s, &["life", &person, &a, "exposed-when"], window);
            st.schedule(at, Sched::Exposure { person: person.clone(), max_bps });
        }
    }
    st.schedule(born + (age + 1) * year, Sched::Birthday { person: person.clone() });
}


fn uniform(s: &Statics, key: &[&str], n: i64) -> i64 {
    s.randomness.stream(key).below(n.max(1) as u64) as i64
}

/// The land as nature sees it today: each cell's cover, whether it's built on, and the building types with their corner
/// there.
pub fn nature_land(s: &Statics, st: &State, ground: &oikos_nature::Ground) -> oikos_nature::Land {
    let cat = &s.config.catalogue;
    let mut land = oikos_nature::Land::default();
    // (The ground's cells and the state's are both in id order: walked together, each cell is found without looking it up.)
    let mut cells = st.cells.iter().peekable();
    for id in &ground.cells {
        while cells.peek().is_some_and(|(k, _)| *k < id) {
            cells.next();
        }
        let c = match cells.peek() {
            Some((k, c)) if *k == id => *c,
            _ => &st.cells[id],
        };
        let building = c.structure.as_ref().and_then(|x| st.structures.get(x));
        land.cover.push(oikos_nature::cover_of(cat, c.terrain.as_deref(), building.map(|b| s.types.get(&b.structure_type).and_then(|t| t.cover.as_deref()))));
        land.built.push(building.is_some());
        land.anchored.push(building.filter(|b| &b.at == id && b.complete).map(|b| vec![b.structure_type.clone()]).unwrap_or_default());
    }
    land
}

/// Nature's day: covers succeed, fields and populations step, extinctions are recorded; monthly, the truth is
/// censused for measurement. Then the next day.
fn nature_day(s: &Statics, st: &mut State, day: i64) -> Vec<Timed> {
    let (Some(ground), Some(now)) = (s.nature.as_ref(), st.nature.clone()) else { return vec![] };
    let t = day * 86_400;
    let land = nature_land(s, st, ground);
    let mut n = (*now).clone();
    let out = oikos_nature::step_day(&s.config.catalogue, ground, &land, &mut n, day, &s.randomness);
    let mut events = vec![];
    // Cells whose look changed: a cover that succeeded, or a conspicuous species come or gone (views deliver changes).
    let mut touched: BTreeSet<Id> = out.cover_changes.iter().map(|(c, _)| c.clone()).collect();
    for sp in s.config.catalogue.species.iter().filter(|sp| sp.conspicuous) {
        let (before, after) = (now.populations.get(&sp.id), n.populations.get(&sp.id));
        let cells: BTreeSet<&Id> = before.into_iter().chain(after).flat_map(|m| m.keys()).collect();
        for cell in cells {
            let had = before.is_some_and(|m| m.contains_key(cell));
            let has = after.is_some_and(|m| m.contains_key(cell));
            if had != has {
                touched.insert(cell.clone());
            }
        }
    }
    if !touched.is_empty() {
        let c = st.stamp();
        for (cell, cover) in &out.cover_changes {
            if let Some(x) = st.cells.get_mut(cell) {
                x.terrain = Some(cover.clone());
            }
        }
        if !out.cover_changes.is_empty() {
            st.ground.changed();
        }
        for cell in &touched {
            if let Some(x) = st.cells.get_mut(cell) {
                x.changed = c;
            }
        }
    }
    for sp in out.extinct {
        events.push(Timed::new(t, EventBody::SpeciesExtinct { species: sp }));
    }
    if day % 30 == 0 {
        let land = nature_land(s, st, ground);
        let c = oikos_nature::census(&s.config.catalogue, &n, &land);
        events.push(Timed::new(t, EventBody::NatureCensus {
            species: c.species.into_iter().map(|(k, (count, cells))| (k, crate::events::CensusCount { count, cells })).collect(),
            covers: c.covers,
        }));
    }
    st.nature = Some(Arc::new(n));
    events.extend(floods(s, st, t));
    st.schedule(t + 86_400, Sched::NatureDay { day: day + 1 });
    events
}

/// Floods (world-expansion 7.3): a building whose type floods, with its field above the level on any of its cells, is
/// under water: its occupants are moved out, and its wear rises each day; below again, it's receded.
fn floods(s: &Statics, st: &mut State, t: i64) -> Vec<Timed> {
    let mut events = vec![];
    let ids: Vec<Id> = st.structures.keys().cloned().collect();
    for sid in ids {
        let x = &st.structures[&sid];
        let Some(fl) = s.types.get(&x.structure_type).and_then(|ty| ty.floods.clone()) else { continue };
        let base = s.config.catalogue.fields.iter().find(|f| f.id == fl.field).map_or(0, |f| f.baseline);
        let level = x.cells.iter().map(|c| st.nature.as_deref().and_then(|n| n.fields.get(&fl.field)).and_then(|m| m.get(c)).copied().unwrap_or(base)).max().unwrap_or(base);
        let was = st.flooded.contains(&sid);
        if level > fl.above {
            if !was {
                st.flooded.insert(sid.clone());
                events.push(Timed::new(t, EventBody::Flooded { structure: sid.clone(), level }));
                // (Settled as it floods, whether or not anyone is inside: its wear is about to rise.)
                settle(s, st, &sid);
                for (_, b) in leave_spaces(s, st, &sid, None, None, VacateReason::Flooded, None, &mut events) {
                    st.moved(&b);
                }
                st.touch_structure(&sid);
            }
            if fl.wear_per_day != 0 {
                settle(s, st, &sid);
                let vars: Vec<crate::config::VariableCfg> = vars_for(s, &st.structures[&sid].structure_type).cloned().collect();
                if let (Some(cfg), Some(x)) = (vars.iter().find(|v| v.id == "wear"), st.structures.get_mut(&sid)) {
                    if let Some(cur) = x.variables.get("wear").copied() {
                        x.variables.insert("wear".into(), (cur.0.saturating_add(fl.wear_per_day).clamp(cfg.min, cfg.max), cur.1));
                    }
                }
                st.touch_structure(&sid);
            }
        } else if was {
            st.flooded.remove(&sid);
            st.touch_structure(&sid);
            events.push(Timed::new(t, EventBody::FloodReceded { structure: sid }));
        }
    }
    events
}

/// Process one scheduled physical effect whose time has come.
pub fn scheduled(s: &Statics, st: &mut State, item: Scheduled) -> Vec<Timed> {
    let t = item.at;
    match item.what {
        Sched::NatureDay { day } => nature_day(s, st, day),
        Sched::CounterCensus => {
            st.schedule(t + 30 * 86_400, Sched::CounterCensus);
            vec![Timed::new(t, EventBody::CounterCensus { counters: st.totals.clone() })]
        }
        Sched::StructureComplete { structure } => match st.structures.get_mut(&structure) {
            Some(x) if !x.complete && x.completes_at == Some(item.at) => {
                // Its time is up; it's complete if its building work is done too (phase B), or else as soon as it is.
                x.completes_at = None;
                let needed = s.types.get(&x.structure_type).map_or(0, |ty| ty.build_labour);
                if x.labour_done < needed {
                    st.touch_structure(&structure);
                    return vec![];
                }
                x.complete = true;
                st.touch_structure(&structure);
                vec![Timed::new(t, EventBody::StructureCompleted { structure })]
            }
            // Demolished before completion: nothing to do.
            _ => vec![],
        },
        Sched::Birthday { person } => {
            yearly_draws(s, st, &person, t);
            vec![]
        }
        Sched::Exposure { person, max_bps } => {
            let (Some(life), Some(b)) = (s.life(), st.body(&person)) else { return vec![] };
            let Some(inj) = &life.injury else { return vec![] };
            if !b.alive || !b.present {
                return vec![];
            }
            // The danger where the body is now: the baseline, plus each place it's in (thinning:
            // this candidate was drawn at the highest rate, and is kept at the true one).
            let here: u32 = st.structures_of(&person).iter().filter_map(|sid| s.types.get(&st.structures[sid].structure_type)?.injury_bps).sum();
            let rate = (inj.bps + here).min(max_bps);
            let tk = t.to_string();
            if uniform(s, &["life", &person, &tk, "injured"], max_bps as i64) >= rate as i64 {
                return vec![];
            }
            let age = (t - b.born_at).div_euclid(life.year);
            let (severity, duration, death) = draw_severity(s, &inj.severity, age, &["life", &person, &tk, "injury-how"]);
            begin_condition(s, st, &person, ConditionKind::Injury, severity, t + duration, death.map(|d| t + d)).1
        }
        Sched::IllnessExposure { person, max_bps, age } => {
            let (Some(life), Some(b)) = (s.life(), st.body(&person)) else { return vec![] };
            let Some(ill) = &life.illness else { return vec![] };
            if !b.alive || !b.present {
                return vec![];
            }
            let base = crate::config::ByAge { by_age: ill.by_age.clone() }.at(age) as i64;
            // The fields in the cell where the body is (the corner cell of a structure it's in); none outside one.
            let cell = st.structures_of(&person).first().map(|sid| st.structures[sid].at.clone());
            let extra: i64 = cell.map_or(0, |c| {
                ill.fields
                    .iter()
                    .map(|f| {
                        let v = st.nature.as_deref().and_then(|n| n.fields.get(&f.field)).and_then(|m| m.get(&c)).copied();
                        let v = v.unwrap_or_else(|| s.config.catalogue.fields.iter().find(|x| x.id == f.field).map_or(0, |x| x.baseline));
                        f.bps_per_unit.saturating_mul(v)
                    })
                    .fold(0i64, |a, b| a.saturating_add(b))
            });
            let rate = base.saturating_add(extra).clamp(0, max_bps as i64);
            let tk = t.to_string();
            if uniform(s, &["life", &person, &tk, "ill-kept"], max_bps as i64) >= rate {
                return vec![];
            }
            let (severity, duration, death) = draw_severity(s, &ill.severity, age, &["life", &person, &tk, "ill-how"]);
            begin_condition(s, st, &person, ConditionKind::Illness, severity, t + duration, death.map(|d| t + d)).1
        }
        Sched::ConditionBegins { person, kind, severity, until, death_at } => {
            if !st.body(&person).is_some_and(|b| b.alive) {
                return vec![];
            }
            begin_condition(s, st, &person, kind, severity, until, death_at).1
        }
        Sched::ConditionEnds { person, condition } => {
            let Some(b) = st.entities.get_mut(&person).and_then(|e| e.body.as_mut()) else { return vec![] };
            let before = b.conditions.len();
            b.conditions.retain(|c| c.id != condition);
            if b.conditions.len() == before {
                return vec![];
            }
            vec![Timed::new(t, EventBody::ConditionEnded { person, condition })]
        }
        // A death from a condition happens only if the condition still says it's due (care may have called it off).
        Sched::Death { person, cause, condition } => {
            if let Some(c) = &condition {
                let due = st.body(&person).and_then(|b| b.conditions.iter().find(|x| &x.id == c)).and_then(|x| x.death_at);
                if !due.is_some_and(|d| d <= t) {
                    return vec![];
                }
            }
            die(s, st, &person, cause)
        }
        // (Acts in progress are the kernel's to apply: Kernel::advance.)
        Sched::Act { .. } | Sched::Start { .. } | Sched::HeldAsks => vec![],
        Sched::Answer { participant, position, look } => {
            if !st.participants.get(&participant).is_some_and(|p| p.status == crate::state::ParticipantStatus::Active) {
                return vec![];
            }
            let channel = look.channel.clone();
            let key = position.clone().unwrap_or_else(|| crate::config::SELF.to_string());
            let pending = std::sync::Arc::make_mut(st.participants.get_mut(&participant).unwrap()).pending.entry(key).or_default();
            if let Some(i) = pending.asked.iter().position(|c| *c == look.channel) {
                pending.asked.remove(i);
            }
            pending.asks.push(look);
            vec![Timed::new(t, EventBody::AskAnswered { participant, position, channel })]
        }
        Sched::Visit { participant, position, channel, places, cells, names } => crate::sites::end(s, st, &participant, position.as_deref(), &channel, places, &cells, names),
        Sched::BirthDue { parents, name, template } => {
            let Some(b) = st.body(&parents[0]) else { return vec![] };
            if !b.alive {
                return vec![];
            }
            let present = b.present;
            // Its sex, where the world models it: drawn by the kernel, keyed by its mother and which child of hers it is
            // (not by the id it is about to get: that is its place in the order everything was made in the town).
            let next_id = format!("{}/{}", parents[0], b.children.len());
            let sex = s.life().and_then(|l| l.birth.as_ref()).and_then(|bp| bp.female_bps).map(|f| {
                if uniform(s, &["birth", &next_id, "sex"], 10_000) < f as i64 { Sex::Female } else { Sex::Male }
            });
            create_person(s, st, &name, t, sex, parents, present, &template, None).1
        }
    }
}

impl<'a> Exec<'a> {
    fn now(&self) -> i64 {
        self.st.t
    }

    fn emit(&mut self, body: EventBody) {
        self.events.push(Timed::new(self.st.t, body));
    }

    fn emit_all(&mut self, events: Vec<Timed>) {
        self.events.extend(events);
    }

    /// Resolve an id or `$ref`.
    fn r(&self, x: &str) -> R<Id> {
        match x.strip_prefix('$') {
            Some(name) => self
                .refs
                .get(name)
                .cloned()
                .ok_or_else(|| refuse(RefusalCode::UnknownRef, format!("${name} is not bound earlier in this action"))),
            None => Ok(x.to_string()),
        }
    }

    fn ro(&self, x: &Option<String>) -> R<Option<Id>> {
        x.as_deref().map(|v| self.r(v)).transpose()
    }

    /// What a block cites as its basis, as the record will hold it: each one resolved, in the order written, and one
    /// that comes to the same record as an earlier one (a name bound in this action, and its id) kept once.
    fn cited(&self, basis: &Option<BasisArg>) -> R<Option<Basis>> {
        let Some(b) = basis else { return Ok(None) };
        Ok(Basis::of(b.ids().iter().map(|x| self.r(x)).collect::<R<Vec<_>>>()?))
    }

    fn bind(&mut self, name: &Option<String>, id: &str) -> R<()> {
        if let Some(n) = name {
            if self.refs.insert(n.clone(), id.to_string()).is_some() {
                return Err(refuse(RefusalCode::DuplicateRef, format!("${n} is bound twice")));
            }
        }
        Ok(())
    }

    fn entity_exists(&self, id: &str) -> R<()> {
        if self.st.entities.contains_key(id) {
            Ok(())
        } else {
            Err(refuse(RefusalCode::UnknownEntity, format!("no entity {id}")))
        }
    }

    /// A person's body that is alive and in the world.
    fn living_present(&self, person: &str) -> R<()> {
        let b = self.st.body(person).ok_or_else(|| {
            if self.st.entities.contains_key(person) {
                refuse(RefusalCode::NotAPerson, format!("{person} isn't a person"))
            } else {
                refuse(RefusalCode::UnknownEntity, format!("no entity {person}"))
            }
        })?;
        if !b.alive {
            return Err(refuse(RefusalCode::Dead, format!("{person} has died")));
        }
        if !b.present {
            return Err(refuse(RefusalCode::NotPresent, format!("{person} isn't in the world")));
        }
        Ok(())
    }

    /// The acting person (acting as itself), for acts only a body can do on its own behalf.
    fn acting_person(&self) -> R<Id> {
        match self.position {
            None => Ok(self.entity.clone()),
            Some(p) => Err(refuse(RefusalCode::NotAPerson, format!("acting as {p}, not as a person"))),
        }
    }

    /// The acting participant's own body (whatever capacity it acts in), for acts a body does.
    fn own_body(&self) -> R<Id> {
        self.st.participants[self.participant]
            .person
            .clone()
            .ok_or_else(|| refuse(RefusalCode::NotAPerson, format!("{} is a system and has no body", self.participant)))
    }

    /// The acting capacity must be an organisation's (acting in one of its positions).
    fn acting_org(&self) -> R<Id> {
        if self.position.is_none() || self.st.body(&self.entity).is_some() {
            return Err(refuse(RefusalCode::NotTheirs, "only an organisation, acting through one of its positions, can do this"));
        }
        Ok(self.entity.clone())
    }

    /// A structure comes down: off the ground, and gone (what was held there stays held there, to be moved out).
    fn bring_down(&mut self, sid: &str) {
        let Some(x) = self.st.structures.remove(sid) else { return };
        // (If it was under water, it isn't any more: there's nothing there. Until 2026-10-05 its id stayed among the
        // flooded for good, since only standing structures are looked at when the water goes down.)
        self.st.flooded.remove(sid);
        self.st.ground.changed();
        let c = self.st.stamp();
        let cleared = self.st.nature.is_some().then(|| self.s.config.catalogue.cleared_cover.clone()).flatten();
        for cell in &x.cells {
            let p = self.st.cells.get_mut(cell).unwrap();
            p.structure = None;
            p.changed = c;
            // (Nature: the ground it stood on is cleared land, which grows back as its cover succeeds.)
            if let Some(cl) = &cleared {
                p.terrain = Some(cl.clone());
            }
        }
        self.emit(EventBody::StructureDemolished { structure: sid.to_string(), by: self.participant.into() });
    }

    /// Work (phase B): performers at a structure spend their time on units of a task. The kernel checks only physics:
    /// that they're there, alive, and have time left today; that the inputs are held there; that what's worked on can
    /// be. Who works for whom is content (D20).
    #[allow(clippy::too_many_arguments)]
    fn work(&mut self, index: usize, task: &str, units: u64, at: &str, performers: &[String], on: &Option<String>, survey: Option<&crate::blocks::Survey>, investigate: Option<&crate::blocks::Investigate>) -> R<()> {
        use crate::config::{TASK_BUILD, TASK_DEMOLISH};
        let (at, on) = (self.r(at)?, self.ro(on)?);
        let builtin = task == TASK_BUILD || task == TASK_DEMOLISH;
        let spec = if builtin {
            None
        } else {
            Some(self.s.config.catalogue.tasks.iter().find(|x| x.id == task).cloned().ok_or_else(|| refuse(RefusalCode::UnknownTask, format!("no task {task}")))?)
        };
        if units == 0 || units > 1_000_000_000_000 {
            return Err(refuse(RefusalCode::Overflow, "units out of range"));
        }
        // A survey (nature): a unit is a cell, of a species or a field the world has.
        let surveys = spec.as_ref().is_some_and(|x| x.surveys);
        match (surveys, survey) {
            (true, None) => return Err(refuse(RefusalCode::BadSurvey, format!("{task} is a survey: say what of, and which cells"))),
            (false, Some(_)) => return Err(refuse(RefusalCode::BadSurvey, format!("{task} isn't a survey"))),
            (true, Some(sv)) => {
                let cat = &self.s.config.catalogue;
                if !cat.species.iter().any(|x| x.id == sv.of) && !cat.fields.iter().any(|x| x.id == sv.of) {
                    return Err(refuse(RefusalCode::BadSurvey, format!("nothing called {} to survey", sv.of)));
                }
                if sv.cells.len() as u64 != units || sv.cells.iter().any(|c| !self.st.cells.contains_key(c)) {
                    return Err(refuse(RefusalCode::BadSurvey, "a survey's units are its cells, each one that exists"));
                }
            }
            (false, None) => {}
        }
        // An investigation (crime): of goods taken from someone, at a structure.
        let investigates = spec.as_ref().is_some_and(|x| x.investigates);
        if investigates != investigate.is_some() {
            return Err(refuse(RefusalCode::BadInvestigation, if investigates { format!("{task} is an investigation: say of what taken from whom, and where") } else { format!("{task} isn't an investigation") }));
        }
        let per_unit = spec.as_ref().map_or(1, |x| x.labour);
        let mut total = per_unit.checked_mul(units as i64).ok_or_else(|| refuse(RefusalCode::Overflow, "too much work"))?;
        // Where: a standing structure (the workplace, depot or home).
        let place = self.st.structures.get(&at).ok_or_else(|| refuse(RefusalCode::UnknownStructure, format!("no structure {at}")))?;
        if !place.complete {
            return Err(refuse(RefusalCode::StructureIncomplete, format!("{at} is still being built")));
        }
        // Who: people there (in a space of the task's kind), alive and present, each with time left today.
        let mut who: Vec<Id> = vec![];
        for p in performers {
            let p = self.r(p)?;
            if who.contains(&p) {
                return Err(refuse(RefusalCode::DuplicateRef, format!("{p} is named twice")));
            }
            who.push(p);
        }
        if total > 0 && who.is_empty() {
            return Err(refuse(RefusalCode::NotAtWork, format!("{task} takes time: say who does it")));
        }
        let kind = spec.as_ref().and_then(|x| x.in_space.clone());
        let work_block = Block::Work { task: task.into(), units, at: at.clone(), performers: vec![], on: None, survey: None, investigate: None };
        for p in &who {
            if self.st.participants.get(p).is_some_and(|x| x.kind == ParticipantKind::System) {
                // (A system does the work if it is the organisation's and its template lists the task: foundations F4.)
                check_system_does(self.s, self.st, p, Some(&self.entity), std::slice::from_ref(&work_block))?;
            } else if self.started {
                // (Looked at when the work began, hours ago if it queued; here only that they are still alive.)
                self.living_present(p)?;
            } else {
                check_at_work(self.s, self.st, p, Some(&at), kind.as_deref())?;
            }
        }
        // Skill at work: the labour scales with the performers' mean of a body variable (all of it at the minimum, the
        // task's share at the maximum).
        let systems = |me: &Self| who.iter().filter(|p| me.st.participants.get(*p).is_some_and(|x| x.kind == ParticipantKind::System)).count();
        let n_systems = systems(self);
        // A crew of systems only: the seconds a unit that their templates give (the slowest's), in place of the task's.
        if n_systems > 0 && n_systems == who.len() {
            let rows: Vec<Option<i64>> = who
                .iter()
                .map(|p| {
                    let t = self.st.participants.get(p).and_then(|x| x.template.as_ref()).and_then(|t| self.s.templates.get(t))?;
                    t.does.as_ref()?.iter().find(|r| r.covers("work", work_block.makes().as_deref())).and_then(|r| r.seconds)
                })
                .collect();
            if !rows.is_empty() && rows.iter().all(|r| r.is_some()) {
                let per = rows.iter().flatten().copied().max().unwrap_or(0);
                total = per.checked_mul(units as i64).ok_or_else(|| refuse(RefusalCode::Overflow, "too much work"))?;
            }
        }
        // (A skill is a body's: a crew's mean is over the people in it.)
        if let Some(lb) = spec.as_ref().and_then(|x| x.labour_by.as_ref()).filter(|_| n_systems < who.len() && total > 0) {
            if let Some(cfg) = self.s.config.catalogue.body_variables.iter().find(|v| v.id == lb.variable).filter(|c| c.max > c.min) {
                let now = self.now();
                let people: Vec<&Id> = who.iter().filter(|p| self.st.body(p).is_some()).collect();
                let sum: i128 = people.iter().map(|p| self.st.body(p).and_then(|b| b.variables.get(&cfg.id)).map_or(cfg.initial, |x| crate::state::body_variable_at(cfg, *x, now).0) as i128).sum();
                let mean = sum / people.len() as i128;
                let off = (10_000 - lb.at_max_bps.min(10_000) as i128) * (mean - cfg.min as i128) / (cfg.max - cfg.min) as i128;
                let factor = 10_000 - off;
                total = ((total as i128 * factor + 9_999) / 10_000).max(1) as i64;
            }
        }
        // (How much of a performer's working day is left is read where the work is placed: on their timeline, when the act
        // begins. Here a work is refused only if it is longer than a day, or the world has no day.)
        let share = if who.is_empty() { 0 } else { (total + who.len() as i64 - 1) / who.len() as i64 };
        if total > 0 && n_systems < who.len() {
            let day = self.s.config.catalogue.working_day.ok_or_else(|| refuse(RefusalCode::NotModelled, "this world has no working day: work that takes time isn't modelled"))?;
            if share > day {
                return Err(refuse(RefusalCode::NoTimeLeft, format!("{} has {day} s of work left today; this needs {share}", who[0])));
            }
        }
        // What's used up must be here, held by the actor.
        let me = self.entity.clone();
        let need = |per: &crate::money::Money| per.checked_mul(units as i128).filter(|x| *x <= MAX_MONEY);
        if let Some(x) = &spec {
            for (k, per) in &x.consumes {
                let q = need(per).ok_or_else(|| refuse(RefusalCode::Overflow, "too much of an input"))?;
                let have = self.st.holding(&me, &at, k);
                if have < q {
                    return Err(refuse(RefusalCode::InsufficientQuantity, format!("{me} has {have} {k} at {at}; {units} {task} needs {q}")));
                }
            }
            for per in x.produces.values() {
                need(per).ok_or_else(|| refuse(RefusalCode::Overflow, "too much of an output"))?;
            }
        }
        // What's drawn from a field (water from the river): from the cell, of the structure's or the four around them, with
        // the most of it, if it has enough.
        let drawn: Option<(Id, Id, i64)> = match spec.as_ref().and_then(|x| x.draws.clone()) {
            None => None,
            Some(d) => {
                let need = d.per_unit.checked_mul(units as i64).ok_or_else(|| refuse(RefusalCode::Overflow, "too much to draw"))?;
                let nature = self.st.nature.as_deref().ok_or_else(|| refuse(RefusalCode::NotModelled, "this world has no fields to draw from"))?;
                let base = self.s.config.catalogue.fields.iter().find(|f| f.id == d.field).map_or(0, |f| f.baseline);
                let min = self.s.config.catalogue.fields.iter().find(|f| f.id == d.field).map_or(0, |f| f.min);
                let mut cells: BTreeSet<Id> = BTreeSet::new();
                for c in &self.st.structures[&at].cells {
                    cells.insert(c.clone());
                    if let Some((x, y)) = crate::config::cell_xy(c) {
                        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                            let n = crate::config::cell_id(x + dx, y + dy);
                            if self.st.cells.contains_key(&n) {
                                cells.insert(n);
                            }
                        }
                    }
                }
                let value = |c: &Id| nature.fields.get(&d.field).and_then(|m| m.get(c)).copied().unwrap_or(base);
                let best = cells.iter().max_by(|a, b| value(a).cmp(&value(b)).then(b.cmp(a))).cloned().unwrap_or_default();
                if value(&best) - need < min {
                    return Err(refuse(RefusalCode::FieldExhausted, format!("not enough {} near {at}: {} there, {need} needed", d.field, value(&best))));
                }
                Some((d.field.clone(), best.clone(), value(&best) - need))
            }
        };
        // What's worked on: bodies (a person there, or everyone in a space of the place), or a structure.
        let bodies: Option<Vec<Id>> = match &on {
            Some(o) if self.st.body(o).is_some() => {
                self.living_present(o)?;
                let was_there = self.seen.is_some_and(|m| m.get(o).is_some_and(|v| v.contains(o)));
                if !was_there && !self.st.occupancy.get(&at).is_some_and(|m| m.values().any(|b| b.contains(o))) {
                    return Err(refuse(RefusalCode::NotPresent, format!("{o} isn't at {at}")));
                }
                Some(vec![o.clone()])
            }
            Some(o) if split_space(o).is_some_and(|(sid, _)| sid == at) => {
                let (_, local) = split_space(o).unwrap();
                if self.s.space(&self.st.structures[&at].structure_type, local).is_none() {
                    return Err(refuse(RefusalCode::UnknownSpace, format!("{at} has no space {local}")));
                }
                Some(match self.seen.and_then(|m| m.get(o)) {
                    // (Those who were there when it was ordered, if they still are in the world.)
                    Some(v) => v.iter().filter(|x| !who.contains(x) && self.living_present(x).is_ok()).cloned().collect(),
                    None => self.st.occupancy.get(&at).and_then(|m| m.get(o)).map_or(vec![], |b| b.iter().filter(|x| !who.contains(x)).cloned().collect()),
                })
            }
            _ => None,
        };
        let on_body = spec.as_ref().and_then(|x| x.on_body.clone());
        match (&bodies, &on_body) {
            (Some(_), None) => return Err(refuse(RefusalCode::NoBodyEffect, format!("{task} does nothing to a body"))),
            (None, Some(_)) => return Err(refuse(RefusalCode::NoBodyEffect, format!("{task} is work on bodies: say on whom (a person there, or a space of {at})"))),
            _ => {}
        }
        let target = on.clone().unwrap_or_else(|| at.clone());
        if bodies.is_none() && (builtin || spec.as_ref().is_some_and(|x| !x.changes.is_empty())) {
            let t = self.st.structures.get(&target).ok_or_else(|| refuse(RefusalCode::UnknownStructure, format!("no structure {target}")))?;
            if task == TASK_BUILD && (t.complete || t.demolition.is_some()) {
                return Err(refuse(RefusalCode::NotBeingBuilt, format!("{target} isn't being built")));
            }
            if task == TASK_DEMOLISH && t.demolition.is_none() {
                return Err(refuse(RefusalCode::NotComingDown, format!("{target} isn't being demolished")));
            }
        }
        // Done: time spent, inputs used, outputs made, changes applied, progress made.
        let c = self.st.stamp();
        if let Some(x) = &spec {
            for (k, per) in &x.consumes {
                let q = need(per).ok_or_else(|| refuse(RefusalCode::Overflow, "too much of an input"))?;
                self.add_holding(&me, &at, k, -q, c)?;
            }
            for (k, per) in &x.produces {
                // (Refused if what's made would take the holding beyond the range of a quantity.)
                let q = need(per).ok_or_else(|| refuse(RefusalCode::Overflow, "too much of an output"))?;
                self.add_holding(&me, &at, k, q, c)?;
            }
            if !x.changes.is_empty() && bodies.is_none() {
                settle(self.s, self.st, &target);
                let ty = self.st.structures[&target].structure_type.clone();
                let vars: Vec<crate::config::VariableCfg> = vars_for(self.s, &ty).cloned().collect();
                let s = self.st.structures.get_mut(&target).unwrap();
                for (v, by) in &x.changes {
                    if let (Some(cfg), Some(cur)) = (vars.iter().find(|c| &c.id == v), s.variables.get(v).copied()) {
                        s.variables.insert(v.clone(), (cur.0.saturating_add(by.saturating_mul(units as i64)).clamp(cfg.min, cfg.max), cur.1));
                    }
                }
                self.st.touch_structure(&target);
            }
        }
        // Drawn from the field; emitted to fields (at the corner cell) and counters.
        if let Some((field, cell, left)) = drawn {
            let n = Arc::make_mut(self.st.nature.as_mut().unwrap());
            n.fields.entry(field).or_default().insert(cell, left);
        }
        if let Some(x) = spec.as_ref().filter(|x| !x.emits.is_empty()) {
            let corner = self.st.structures[&at].at.clone();
            for (k, per) in &x.emits {
                let by = per.saturating_mul(units.min(i64::MAX as u64) as i64);
                if let Some(v) = self.st.totals.get_mut(k) {
                    *v = v.saturating_add(by);
                } else if let Some(f) = self.s.config.catalogue.fields.iter().find(|f| &f.id == k) {
                    if let Some(n) = self.st.nature.as_mut().map(Arc::make_mut) {
                        let cur = n.fields.get(k).and_then(|m| m.get(&corner)).copied().unwrap_or(f.baseline);
                        n.fields.entry(k.clone()).or_default().insert(corner.clone(), cur.saturating_add(by).clamp(f.min, f.max));
                    }
                }
            }
        }
        let someone_there = !who.is_empty();
        self.emit(EventBody::Worked { task: task.into(), units, at: at.clone(), on: on.clone(), performers: who, labour: total, by: self.participant.into() });
        if let (Some(bodies), Some(ob)) = (&bodies, &on_body) {
            for b in bodies {
                self.on_body(b, ob, units);
            }
        }
        if let Some(sv) = survey {
            self.surveyed = Some(self.survey_estimates(sv, index));
        }
        // What it finds: the latest such taking, and who did it, with the task's chance (to the actor only).
        if let Some(iv) = investigate {
            let (from, at) = (self.r(&iv.from)?, self.r(&iv.at)?);
            let found = self.st.takings.iter().rev().find(|x| x.from == from && x.at == at && x.kind == iv.kind).cloned();
            let chance = spec.as_ref().map_or(0, |x| x.detection_bps);
            // (Keyed by the block as well as the day, as harm is: two investigations in one action draw
            // independently. Until 2026-10-05 they shared the action's one draw.)
            let idx = index.to_string();
            // (Keyed by who asks, what about and the day, never by the act's number in the world's file: that
            // moves with every act anyone has made, and two towns that differ by one act would draw alike nowhere.)
            let (who, day) = (self.participant.to_string(), self.now().div_euclid(86_400).to_string());
            let mut rng = self.s.randomness.stream(&["investigate", &who, &from, &at, &iv.kind, &day, &idx]);
            let taker = found.as_ref().filter(|_| rng.below(10_000) < chance as u64).map(|x| x.by.clone());
            self.investigated = Some(serde_json::json!({ "from": from, "at": at, "kind": iv.kind, "taken": found.is_some(), "taker": taker }));
        }
        // Those who did it were there: what the building is like as they leave it is theirs to know (a demolition's
        // last day leaves nothing to see). Work nobody is named as doing sends nobody: nothing is seen.
        let worked_on_building = someone_there && bodies.is_none() && on.is_some() && self.st.structures.contains_key(&target);
        if task == TASK_BUILD {
            let needed = self.s.types[&self.st.structures[&target].structure_type].build_labour;
            let s = self.st.structures.get_mut(&target).unwrap();
            s.labour_done = s.labour_done.saturating_add(total);
            // Complete once the work is done, if its build time has passed (else when it does).
            if s.labour_done >= needed && s.completes_at.is_none() {
                s.complete = true;
                self.st.touch_structure(&target);
                self.emit(EventBody::StructureCompleted { structure: target.clone() });
            } else {
                self.st.touch_structure(&target);
            }
        } else if task == TASK_DEMOLISH {
            let needed = self.s.types[&self.st.structures[&target].structure_type].demolition_labour;
            let s = self.st.structures.get_mut(&target).unwrap();
            let done = s.demolition.unwrap_or(0).saturating_add(total);
            s.demolition = Some(done);
            if done >= needed {
                self.bring_down(&target);
            } else {
                self.st.touch_structure(&target);
            }
        }
        if worked_on_building && self.st.structures.contains_key(&target) {
            if !self.worked_on.contains(&target) {
                self.worked_on.push(target.clone());
            }
        }
        Ok(())
    }

    /// Work done to a body (services): its variables changed, and care given for its conditions (each once).
    fn on_body(&mut self, person: &str, ob: &crate::config::OnBody, units: u64) {
        let now = self.now();
        let tick = self.s.tick;
        let cat = &self.s.config.catalogue;
        let mut events = vec![];
        let mut schedule = vec![];
        let Some(b) = self.st.entities.get_mut(person).and_then(|e| e.body.as_mut()) else { return };
        for (v, per) in &ob.changes {
            let Some(cfg) = cat.body_variables.iter().find(|c| &c.id == v) else { continue };
            let cur = b.variables.get(v).copied().unwrap_or((cfg.initial, now));
            let (val, at) = crate::state::body_variable_at(cfg, cur, now);
            let new = val.saturating_add(per.saturating_mul(units.min(i64::MAX as u64) as i64)).clamp(cfg.min, cfg.max);
            b.variables.insert(v.clone(), (new, at));
            events.push(EventBody::BodyChanged { person: person.into(), variable: v.clone(), value: new });
        }
        for c in b.conditions.iter_mut().filter(|c| !c.treated && c.until > now) {
            let Some(tr) = ob.treats.iter().find(|tr| tr.kind == c.kind && tr.severity.as_ref().is_none_or(|x| x == &c.severity) && units >= tr.units) else { continue };
            let keep = |d: i64| now + ((d - now).max(0) as i128 * tr.days_kept_bps as i128 / 10_000) as i64;
            c.until = keep(c.until).max(now + tick);
            schedule.push((c.until, Sched::ConditionEnds { person: person.into(), condition: c.id.clone() }));
            let mut called_off = false;
            if let Some(d) = c.death_at.filter(|d| *d >= now) {
                // (The condition by its kind and onset, not by the number it was given: that is its place in the order
                // conditions began, anywhere in the town.)
                let (kind, since) = (format!("{:?}", c.kind), c.since.to_string());
                let mut rng = self.s.randomness.stream(&["care", person, &kind, &since]);
                if rng.below(10_000) < tr.fatal_kept_bps as u64 {
                    let nd = keep(d).min(c.until - 1).max(now);
                    c.death_at = Some(nd);
                    schedule.push((nd, Sched::Death { person: person.into(), cause: death_cause(c.kind), condition: Some(c.id.clone()) }));
                } else {
                    c.death_at = None;
                    called_off = true;
                }
            }
            c.treated = true;
            events.push(EventBody::ConditionTreated { person: person.into(), condition: c.id.clone(), by: self.participant.into(), until: c.until, death_called_off: called_off });
        }
        for (t, what) in schedule {
            self.st.schedule(t, what);
        }
        for e in events {
            self.emit(e);
        }
    }

    /// What a survey finds: for a species, each one in the cell found with its detection chance; for a field, the value
    /// with an error of up to (10,000 - detection) basis points (the survey task's own figure isn't needed: the species'
    /// or, for a field, 9,000). Drawn from the action's keyed randomness, by the block (two surveys of the same thing in
    /// one action draw independently; until 2026-10-05 they shared the action's draws).
    fn survey_estimates(&self, sv: &crate::blocks::Survey, index: usize) -> Value {
        let cat = &self.s.config.catalogue;
        let nature = self.st.nature.as_deref();
        let idx = index.to_string();
        let (who, day) = (self.participant.to_string(), self.now().div_euclid(86_400).to_string());
        let mut rng = self.s.randomness.stream(&["survey", &who, &sv.of, &day, &idx]);
        let species = cat.species.iter().find(|x| x.id == sv.of);
        let mut found = serde_json::Map::new();
        for cell in &sv.cells {
            let est = match species {
                Some(sp) => {
                    let n = nature.and_then(|n| n.populations.get(&sp.id)).and_then(|m| m.get(cell)).copied().unwrap_or(0);
                    oikos_nature::survey_count(n, sp.detection_bps, &mut rng)
                }
                None => {
                    let base = cat.fields.iter().find(|x| x.id == sv.of).map_or(0, |f| f.baseline);
                    let v = nature.and_then(|n| n.fields.get(&sv.of)).and_then(|m| m.get(cell)).copied().unwrap_or(base);
                    oikos_nature::survey_value(v, 9_000, &mut rng)
                }
            };
            found.insert(cell.clone(), Value::from(est));
        }
        serde_json::json!({ "of": sv.of, "cells": found })
    }

    /// Add to (or take from) a holding, stamping the change. Refused, as any amount out of range is, if the holding
    /// would go beyond the range of a quantity either way (an edge's may be negative, D31; whether anyone else's may
    /// go below nothing is the caller's check): the sum is never left to overflow, which a test build would stop at
    /// and a release build once wrapped past.
    fn add_holding(&mut self, holder: &str, at: &str, kind: &str, by: Money, stamp: u64) -> R<()> {
        let key = crate::state::holding_key(holder, at, kind);
        let q = self
            .st
            .holdings
            .get(&key)
            .map_or(0, |s| s.quantity)
            .checked_add(by)
            .filter(|q| (-MAX_MONEY..=MAX_MONEY).contains(q))
            .ok_or_else(|| refuse(RefusalCode::Overflow, format!("{holder}'s holding of {kind} at {at} would go beyond the range of a quantity")))?;
        self.st.holdings.insert(key, crate::state::Holding { kind: kind.into(), holder: holder.into(), at: at.into(), quantity: q, changed: stamp });
        Ok(())
    }

    fn account(&self, id: &str) -> R<&Account> {
        self.st.accounts.get(id).map(|a| &**a).ok_or_else(|| refuse(RefusalCode::UnknownAccount, format!("no account {id}")))
    }

    fn record_of_kind(&self, id: &str, kind: &str) -> R<&Record> {
        let r = &*self.st.records.get(id).ok_or_else(|| refuse(RefusalCode::UnknownRecord, format!("no record {id}")))?.record;
        if kind != "any" && r.body.kind_name() != kind {
            return Err(refuse(RefusalCode::WrongRecordKind, format!("{id} is a {}, not a {kind}", r.body.kind_name())));
        }
        Ok(r)
    }

    fn later(&self, d: i64) -> R<i64> {
        let at = self.now() + self.s.span(d.max(1));
        if at > MAX_SAFE {
            return Err(refuse(RefusalCode::Overflow, "ends beyond the representable time range"));
        }
        Ok(at)
    }

    /// A new position's channels are held to what the world's own are (docs/design/knowing.md): no whole view can be
    /// made during a run that couldn't be written in the world's config.
    fn check_new_channels(&self, owner: &str, organisation: &str, channels: &[Channel]) -> R<()> {
        // (Premises change hands during a run: a shop's are bought by whoever founds the next one there, while the old
        // firm's seat names them still. So a new office's are held to a building or two, not to being nobody else's.)
        let seat = crate::config::Seat {
            organisation: Some(organisation),
            knowing: &self.s.config.knowing,
            premises_most: Some(crate::config::NEW_PREMISES_MAX),
            entity_exists: &|e| self.st.entities.contains_key(e),
            cell_exists: &|c| self.st.cells.contains_key(c),
            place_exists: &|p| self.s.config.world.places.iter().any(|x| x.id == p),
            premises_of: &|_| None,
        };
        check_channels(owner, channels, &seat).map_err(|e| refuse(RefusalCode::UnknownEntity, e))
    }

    fn new_position(&mut self, entity: &str, title: &Option<String>, role: &Option<String>, channels: &[Channel], role_module: &Option<Value>, holder: Option<Id>) -> R<Id> {
        self.check_new_channels("the position", entity, channels)?;
        let id = self.st.mint("pos");
        let c = self.st.stamp();
        self.st.add_position(
            id.clone(),
            Position { entity: entity.into(), title: title.clone(), role: role.clone(), channels: Arc::new(channels.to_vec()), role_module: role_module.clone(), holder: holder.clone(), changed: c },
        );
        self.emit(EventBody::PositionCreated { position: id.clone(), entity: entity.into(), by: self.participant.into(), title: title.clone(), role: role.clone(), role_module: role_module.clone() });
        if holder.is_some() {
            self.emit(EventBody::Appointed { position: id.clone(), holder, by: Some(self.participant.into()) });
        }
        Ok(id)
    }

    /// Move money between accounts. Every movement of money in the world goes
    /// through here and emits exactly one `transfer` event.
    #[allow(clippy::too_many_arguments)]
    fn move_money(
        &mut self,
        from: &str,
        to: &str,
        amount: Money,
        reason: TransferReason,
        settles: Option<Id>,
        per_instruction: Option<Id>,
        memo: Option<String>,
        line: Option<String>,
    ) -> R<()> {
        let src = self.account(from)?.clone();
        let dst = self.account(to)?.clone();
        if !(1..=MAX_MONEY).contains(&amount) {
            return Err(refuse(RefusalCode::Overflow, "amount out of range"));
        }
        // Money moves only between accounts in the same currency: the kernel never converts.
        if src.currency != dst.currency {
            return Err(refuse(RefusalCode::CurrencyMismatch, format!("{from} is in {}, {to} in {}", src.currency, dst.currency)));
        }
        if self.s.is_boundary(&src.holder) {
            // The outside world's account may go negative (money flowing in), within range.
            if src.balance.checked_sub(amount).is_none_or(|x| x < -MAX_MONEY) {
                return Err(refuse(RefusalCode::Overflow, "the outside world's account would go beyond the range of an amount"));
            }
        } else if src.balance < amount {
            return Err(refuse(RefusalCode::InsufficientFunds, format!("{from} holds {}, needs {amount}", src.balance)));
        }
        if from != to {
            if dst.balance.checked_add(amount).is_none_or(|x| x > MAX_MONEY) {
                return Err(refuse(RefusalCode::Overflow, format!("{to}'s balance would exceed the range of an amount")));
            }
            let c = self.st.stamp();
            let a = Arc::make_mut(self.st.accounts.get_mut(from).unwrap());
            a.balance -= amount;
            a.changed = c;
            let b = Arc::make_mut(self.st.accounts.get_mut(to).unwrap());
            b.balance += amount;
            b.changed = c;
        }
        let tx = Transaction {
            t: self.now(),
            from: from.into(),
            to: to.into(),
            amount,
            currency: src.currency.clone(),
            by: self.participant.into(),
            settles: settles.clone(),
            per_instruction: per_instruction.clone(),
            memo: memo.clone(),
            line: line.clone(),
        };
        // Everyone who acts for an entity concerned hears of it, through that entity's accounts.
        let concerned: BTreeSet<&str> = [src.holder.as_str(), src.custodian.as_str(), dst.holder.as_str(), dst.custodian.as_str()].into();
        let mut told: BTreeSet<(Id, Id)> = BTreeSet::new();
        for e in concerned {
            // Only those who'd see it: a capacity with an accounts channel (others never look through one, and their
            // queue would grow for ever: the whole state with it). Each capacity has a queue of its own: a person who
            // holds two posts of one organisation (a manager and a payroll officer) is told of a payment in each, and
            // the first to look does not take it from the other (foundations F6).
            for (p, cap) in self.st.acting_for(e) {
                if self.st.sees_accounts(&p, &cap) {
                    told.insert((p, transactions_key(&cap, e)));
                }
            }
            // An office keeps its payments on file whoever holds the post, or nobody does (a new holder is handed them).
            let posts: Vec<Id> = self.st.positions_of.get(e).into_iter().flatten().filter(|id| self.st.sees_accounts("", id)).cloned().collect();
            for post in posts {
                self.st.ledgers.entry(transactions_key(&post, e)).or_default().push_back(tx.clone());
            }
        }
        for (p, key) in told {
            if let Some(x) = self.st.participants.get_mut(&p) {
                Arc::make_mut(x).new_transactions.entry(key).or_default().push_back(tx.clone());
            }
        }
        self.emit(EventBody::Transfer {
            from: from.into(),
            to: to.into(),
            amount,
            currency: src.currency.clone(),
            by: self.participant.into(),
            reason,
            settles,
            per_instruction,
            memo,
            line,
        });
        Ok(())
    }

    /// Make and store a record authored by the acting participant, in its capacity. Checks only that
    /// everything it references exists.
    fn new_record(&mut self, body: RecordBody, speaks_for: Option<Id>, visible_to: Option<Visibility>, basis: Option<Basis>) -> R<Id> {
        let visible_to = match visible_to {
            Some(Visibility::Only(ids)) => Visibility::only(ids.iter().map(|i| self.r(i)).collect::<R<Vec<_>>>()?),
            Some(v) => v,
            None => self.default_visibility(&body, speaks_for.as_deref())?,
        };
        let id = self.st.mint("rec");
        let rec = Record {
            id: id.clone(),
            author: self.participant.into(),
            position: self.position.map(String::from),
            speaks_for,
            at: self.now(),
            visible_to,
            basis,
            by: (!self.by.is_empty() && self.by != [self.participant.to_string()]).then(|| self.by.to_vec()),
            body,
        };
        for e in rec.entities_named().into_iter().chain(rec.visibility_entities()) {
            self.entity_exists(e)?;
        }
        for b in rec.basis.iter().flat_map(Basis::ids) {
            self.record_of_kind(b, "any")?;
        }
        self.st.store(rec.clone());
        self.emit(EventBody::Recorded { record: Box::new(rec) });
        Ok(id)
    }

    /// Who sees a record when its author doesn't say (contracts/README.md,
    /// "Records"). The author's entity can always see its own records.
    fn default_visibility(&self, body: &RecordBody, speaks_for: Option<&str>) -> R<Visibility> {
        let mut base: Vec<Id> = vec![self.entity.clone()];
        base.extend(speaks_for.map(String::from));
        let inherit = |id: &str| -> R<Visibility> { Ok(self.record_of_kind(id, "any")?.visible_to.clone()) };
        let widen = |v: Visibility, more: Vec<Id>| match v {
            Visibility::Public(_) => Visibility::public(),
            Visibility::Only(ids) => Visibility::only(ids.into_iter().chain(more)),
        };
        Ok(match body {
            RecordBody::EntityDeclaration { .. } => Visibility::public(),
            RecordBody::Claim { holder, counterparty: Some(c), .. } => Visibility::only(base.into_iter().chain([holder.clone(), c.clone()])),
            RecordBody::Claim { .. } => Visibility::public(),
            RecordBody::ClaimTransfer { claim, to } => widen(inherit(claim)?, base.into_iter().chain([to.clone()]).collect()),
            RecordBody::ClaimRelease { claim } => widen(inherit(claim)?, base),
            RecordBody::Agreement { terms } => Visibility::only(base.into_iter().chain(terms.parties.iter().cloned())),
            RecordBody::Signature { agreement, .. } | RecordBody::Notice { agreement, .. } => widen(inherit(agreement)?, base),
            RecordBody::Statement { addressed_to: Some(a), .. } => Visibility::only(base.into_iter().chain(a.iter().cloned())),
            RecordBody::Statement { .. } => Visibility::public(),
            RecordBody::Withdrawal { withdraws, .. } => widen(inherit(withdraws)?, base),
            RecordBody::Vote { ballot, .. } => {
                // A vote is seen by the voter and whoever runs the ballot, not by everyone.
                let b = self.record_of_kind(ballot, "statement")?;
                let counter = self.st.author_entity(b).or_else(|| b.speaks_for.clone());
                Visibility::only(base.into_iter().chain(counter))
            }
        })
    }

    fn resolve_terms(&self, t: &AgreementTerms) -> R<AgreementTerms> {
        let mut t = t.clone();
        for p in &mut t.parties {
            *p = self.r(p)?;
        }
        for c in &mut t.commitments {
            c.who = self.r(&c.who)?;
        }
        for x in t.termination.iter_mut().flatten() {
            x.party = self.r(&x.party)?;
        }
        Ok(t)
    }

    /// Who a message reaches, and in which of their capacities.
    fn recipients(&self, to: &[Id]) -> R<BTreeSet<(Id, Id)>> {
        let mut out = BTreeSet::new();
        for id in to {
            if let Some(p) = self.st.participants.get(id) {
                if p.person.is_some() {
                    out.insert((id.clone(), SELF.to_string()));
                } else {
                    for pos in self.st.held_by(id) {
                        out.insert((id.clone(), pos.clone()));
                    }
                }
            } else if let Some(x) = self.st.positions.get(id) {
                out.extend(x.holder.iter().map(|h| (h.clone(), id.clone())));
            } else if self.st.entities.contains_key(id) {
                out.extend(self.st.acting_for(id));
            } else {
                return Err(refuse(RefusalCode::UnknownEntity, format!("no participant, position or entity {id}")));
            }
        }
        out.retain(|(p, _)| self.st.participants.get(p).is_some_and(|x| can_act(x)));
        Ok(out)
    }

    pub fn block(&mut self, b: &Block, index: usize) -> R<()> {
        match b {
            // ---------------- physical ----------------
            Block::Transfer { from, to, amount, settles, per_instruction, memo, line } => {
                let (from, to) = (self.r(from)?, self.r(to)?);
                let custodian = self.account(&from)?.custodian.clone();
                if custodian != self.entity {
                    return Err(refuse(
                        RefusalCode::NotCustodian,
                        format!("{from} is held in custody by {custodian}; only those acting for {custodian} can move it"),
                    ));
                }
                let (settles, per_instruction) = (self.ro(settles)?, self.ro(per_instruction)?);
                for rec in settles.iter().chain(per_instruction.iter()) {
                    self.record_of_kind(rec, "any")?;
                }
                self.move_money(&from, &to, *amount, TransferReason::Payment, settles, per_instruction, memo.clone(), line.clone())
            }

            // Taking (world-expansion 7.3): goods another holds where the taker is, moved to the taker there; no consent.
            Block::Take { kind, quantity, from, at } => {
                let (from, at) = (self.r(from)?, self.r(at)?);
                let me = self.acting_person()?;
                self.living_present(&me)?;
                if !(1..=MAX_MONEY).contains(quantity) {
                    return Err(refuse(RefusalCode::Overflow, "quantity out of range"));
                }
                if !self.st.occupancy.get(&at).is_some_and(|m| m.values().any(|b| b.contains(&me))) {
                    return Err(refuse(RefusalCode::NotPresent, format!("{me} isn't at {at}")));
                }
                let have = self.st.holding(&from, &at, kind);
                if have < *quantity {
                    return Err(refuse(RefusalCode::InsufficientQuantity, format!("{from} has {have} {kind} at {at}")));
                }
                let c = self.st.stamp();
                // (Refused if the taker's holding there would go beyond the range of a quantity.)
                self.add_holding(&from, &at, kind, -*quantity, c)?;
                self.add_holding(&me, &at, kind, *quantity, c)?;
                let t = self.now();
                self.st.takings.push(crate::state::Taking { t, by: me.clone(), from: from.clone(), kind: kind.clone(), at: at.clone() });
                self.emit(EventBody::Taken { by: me, from, kind: kind.clone(), quantity: *quantity, at });
                Ok(())
            }
            Block::MoveGoods { kind, quantity, from_at, to, to_at } => {
                let (from_at, to, to_at) = (self.r(from_at)?, self.r(to)?, self.r(to_at)?);
                if !self.s.config.catalogue.resources.iter().any(|r| &r.id == kind) {
                    return Err(refuse(RefusalCode::UnknownResource, format!("the world has no resource {kind}")));
                }
                if !(1..=MAX_MONEY).contains(quantity) {
                    return Err(refuse(RefusalCode::Overflow, "quantity out of range"));
                }
                self.entity_exists(&to)?;
                // Where goods can be: a structure (standing or begun), or an edge's own outside.
                let place_ok = |who: &str, at: &str| self.st.structures.contains_key(at) || (self.s.is_boundary(who) && at == who);
                if !place_ok(&to, &to_at) {
                    return Err(refuse(RefusalCode::UnknownPlace, format!("{to_at} isn't somewhere {to} can hold goods")));
                }
                // Only the holder moves its goods (custody, as for money one keeps oneself). An edge's goods come from
                // outside, so its holding may go negative (D31, as for money); anyone else's must be there.
                let me = self.entity.clone();
                let edge = self.s.is_boundary(&me);
                let have = self.st.holding(&me, &from_at, kind);
                if !edge && have < *quantity {
                    return Err(refuse(RefusalCode::InsufficientQuantity, format!("{me} has {have} {kind} at {from_at}, needs {quantity}")));
                }
                if edge && from_at != me && have < *quantity {
                    return Err(refuse(RefusalCode::InsufficientQuantity, format!("{me} has {have} {kind} at {from_at}, needs {quantity}")));
                }
                if have.checked_sub(*quantity).is_none_or(|x| x < -MAX_MONEY) {
                    return Err(refuse(RefusalCode::Overflow, "the edge's holding would go beyond the range of a quantity"));
                }
                let there = self.st.holding(&to, &to_at, kind);
                if !(me == to && from_at == to_at) && there.checked_add(*quantity).is_none_or(|x| x > MAX_MONEY) {
                    return Err(refuse(RefusalCode::Overflow, "the holding would exceed the range of a quantity"));
                }
                if !(me == to && from_at == to_at) {
                    let c = self.st.stamp();
                    self.add_holding(&me, &from_at, kind, -*quantity, c)?;
                    self.add_holding(&to, &to_at, kind, *quantity, c)?;
                }
                self.emit(EventBody::GoodsMoved { kind: kind.clone(), quantity: *quantity, from: me, from_at, to, to_at, by: self.participant.into() });
                Ok(())
            }

            Block::OpenAccount { holder, currency, bind } => {
                let holder = self.r(holder)?;
                self.entity_exists(&holder)?;
                let currency = currency.clone().unwrap_or_else(|| self.s.currency.clone());
                if !self.s.config.world.currencies.iter().any(|c| c.code == currency) {
                    return Err(refuse(RefusalCode::UnknownCurrency, format!("the world has no currency {currency}")));
                }
                let id = self.st.mint("acc");
                let c = self.st.stamp();
                self.st.accounts.insert(id.clone(), Arc::new(Account { holder: holder.clone(), custodian: self.entity.clone(), currency: currency.clone(), balance: 0, changed: c }));
                self.emit(EventBody::AccountOpened { account: id.clone(), holder, custodian: self.entity.clone(), currency, by: self.participant.into() });
                self.bind(bind, &id)
            }

            Block::CloseAccount { account } => {
                let account = self.r(account)?;
                let a = self.account(&account)?;
                if a.custodian != self.entity {
                    return Err(refuse(RefusalCode::NotCustodian, format!("{account} is held in custody by {}", a.custodian)));
                }
                if self.s.is_boundary_account(&account) {
                    return Err(refuse(RefusalCode::BoundaryProtected, "the outside world's account can't be closed"));
                }
                if a.balance != 0 {
                    return Err(refuse(RefusalCode::AccountNotEmpty, format!("{account} still holds {}", a.balance)));
                }
                let c = self.st.stamp();
                if let Some(gone) = self.st.accounts.remove(&account) {
                    self.st.closed_accounts.insert(account.clone(), crate::state::ClosedAccount { holder: gone.holder.clone(), custodian: gone.custodian.clone(), currency: gone.currency.clone(), changed: c });
                }
                self.emit(EventBody::AccountClosed { account, by: self.participant.into() });
                Ok(())
            }

            Block::Construct { at, structure_type, materials_at, bind } => {
                let ty = self
                    .s
                    .types
                    .get(structure_type)
                    .ok_or_else(|| refuse(RefusalCode::UnknownStructureType, format!("no structure type {structure_type}")))?
                    .clone();
                let cells = footprint_cells(&self.s.detailed, at, ty.footprint)
                    .ok_or_else(|| refuse(RefusalCode::UnknownCell, format!("a {structure_type} doesn't fit on the ground at {at}")))?;
                for cell in &cells {
                    let c = &self.st.cells[cell];
                    if let Some(x) = &c.structure {
                        return Err(refuse(RefusalCode::GroundOccupied, format!("{cell} already has {x}")));
                    }
                    let fits = match &ty.terrains {
                        Some(ok) => c.terrain.as_ref().is_some_and(|t| ok.contains(t)),
                        None => c.terrain.is_none(),
                    };
                    if !fits {
                        return Err(refuse(RefusalCode::UnsuitableTerrain, format!("a {structure_type} can't stand on {cell}")));
                    }
                }
                // Its materials come from the builder's own holding where it keeps them (phase B: no more money paid to
                // nowhere for them).
                let me = self.entity.clone();
                let yard = match materials_at {
                    Some(m) => Some(self.r(m)?),
                    None if ty.materials.is_empty() => None,
                    None => return Err(refuse(RefusalCode::InsufficientQuantity, format!("a {structure_type} needs materials: say where the builder keeps them"))),
                };
                if let Some(yard) = &yard {
                    for (kind, q) in &ty.materials {
                        let have = self.st.holding(&me, yard, kind);
                        if have < *q {
                            return Err(refuse(RefusalCode::InsufficientQuantity, format!("{me} has {have} {kind} at {yard}; a {structure_type} needs {q}")));
                        }
                    }
                }
                let completes = self.later(ty.build_time)?;
                let c = self.st.stamp();
                if let Some(yard) = &yard {
                    for (kind, q) in &ty.materials {
                        self.add_holding(&me, yard, kind, -*q, c)?;
                    }
                }
                let id = self.st.mint("str");
                self.st.structures.insert(
                    id.clone(),
                    Structure {
                        at: at.clone(),
                        cells: cells.clone(),
                        structure_type: structure_type.clone(),
                        built_by: Some(self.entity.clone()),
                        complete: false,
                        completes_at: Some(completes),
                        labour_done: 0,
                        demolition: None,
                        variables: init_variables(self.s, structure_type, self.now()),
                    },
                );
                let c = self.st.stamp();
                self.st.ground.changed();
                for cell in &cells {
                    let p = self.st.cells.get_mut(cell).unwrap();
                    p.structure = Some(id.clone());
                    p.changed = c;
                }
                self.st.schedule(completes, Sched::StructureComplete { structure: id.clone() });
                self.emit(EventBody::StructureStarted {
                    structure: id.clone(),
                    on: at.clone(),
                    structure_type: structure_type.clone(),
                    built_by: self.entity.clone(),
                    at: completes,
                });
                self.bind(bind, &id)
            }

            Block::Demolish { structure } => {
                let sid = self.r(structure)?;
                let x = self.st.structures.get(&sid).ok_or_else(|| refuse(RefusalCode::UnknownStructure, format!("no structure {sid}")))?.clone();
                if x.demolition.is_some() {
                    return Err(refuse(RefusalCode::ComingDown, format!("{sid} is already being demolished")));
                }
                // Its occupants leave at once (as anyone leaves a space: its variables settled first, each departure
                // recorded; until 2026-10-05 a demolition did neither). Then it comes down: now, or once its demolition
                // labour is done (phase B).
                for (_, occupant) in leave_spaces(self.s, self.st, &sid, None, None, VacateReason::Demolition, Some(self.participant), &mut self.events) {
                    self.st.moved(&occupant);
                }
                if self.s.types[&x.structure_type].demolition_labour > 0 {
                    self.st.structures.get_mut(&sid).unwrap().demolition = Some(0);
                    self.st.touch_structure(&sid);
                    self.emit(EventBody::DemolitionStarted { structure: sid, by: self.participant.into() });
                } else {
                    self.bring_down(&sid);
                }
                Ok(())
            }

            Block::Work { task, units, at, performers, on, survey, investigate } => self.work(index, task, *units, at, performers, on, survey.as_ref(), investigate.as_ref()),

            Block::Occupy { space, who } => {
                let space = self.r(space)?;
                let who = match who {
                    Some(w) => self.r(w)?,
                    None => self.acting_person()?,
                };
                self.living_present(&who)?;
                let (sid, local) = split_space(&space).ok_or_else(|| refuse(RefusalCode::UnknownSpace, format!("{space} isn't a space")))?;
                let x = self.st.structures.get(sid).ok_or_else(|| refuse(RefusalCode::UnknownStructure, format!("no structure {sid}")))?;
                let spec = self.s.space(&x.structure_type, local).ok_or_else(|| refuse(RefusalCode::UnknownSpace, format!("{sid} has no space {local}")))?;
                if !x.complete {
                    return Err(refuse(RefusalCode::StructureIncomplete, format!("{sid} is still being built")));
                }
                let bodies = self.st.occupancy.get(sid).and_then(|m| m.get(&space));
                if bodies.is_some_and(|b| b.contains(&who)) {
                    return Err(refuse(RefusalCode::AlreadyPresent, format!("{who} is already in {space}")));
                }
                let used = bodies.map_or(0, |b| b.len()) as u32;
                if used >= spec.capacity {
                    return Err(refuse(RefusalCode::CapacityExceeded, format!("{space} holds {} at most, and has {used}", spec.capacity)));
                }
                if x.demolition.is_some() {
                    return Err(refuse(RefusalCode::ComingDown, format!("{sid} is being demolished")));
                }
                if self.st.flooded.contains(sid) {
                    return Err(refuse(RefusalCode::Flooded, format!("{sid} is under water")));
                }
                let sid = sid.to_string();
                // A body is in one place at a time: coming here, it leaves wherever else it was.
                for other in self.st.structures_of(&who) {
                    leave_spaces(self.s, self.st, &other, Some(&who), None, VacateReason::Left, Some(self.participant), &mut self.events);
                    self.st.touch_structure(&other);
                }
                settle(self.s, self.st, &sid);
                self.st.enter(&sid, &space, &who);
                self.st.touch_structure(&sid);
                self.st.moved(&who);
                self.emit(EventBody::Occupied { occupant: who, space, by: self.participant.into() });
                Ok(())
            }

            Block::Vacate { occupant, from } => {
                let (occupant, from) = (self.r(occupant)?, self.r(from)?);
                self.entity_exists(&occupant)?;
                let sid = split_space(&from).map_or(from.as_str(), |(s, _)| s).to_string();
                // From the space named, or (a structure named) from every space of it.
                let only = (sid != from).then_some(from.as_str());
                let reason = if occupant == self.entity { VacateReason::Left } else { VacateReason::Removed };
                let left = leave_spaces(self.s, self.st, &sid, Some(&occupant), only, reason, Some(self.participant), &mut self.events);
                if left.is_empty() {
                    return Err(refuse(RefusalCode::NotPresent, format!("{occupant} is not in {from}")));
                }
                self.st.touch_structure(&sid);
                self.st.moved(&occupant);
                Ok(())
            }

            // ---------------- bodies ----------------
            Block::Arrive { person, name, born_at, template, carrying, sex, variables, bind } => {
                if !self.s.is_boundary(&self.entity) || self.position.is_none() {
                    return Err(refuse(RefusalCode::NotTheirs, "people cross into the world only through the outside world"));
                }
                let id = match person {
                    Some(p) => {
                        let p = self.r(p)?;
                        let b = self.st.body(&p).ok_or_else(|| refuse(RefusalCode::NotAPerson, format!("{p} isn't a person")))?;
                        if !b.alive {
                            return Err(refuse(RefusalCode::Dead, format!("{p} has died")));
                        }
                        if b.present {
                            return Err(refuse(RefusalCode::AlreadyPresent, format!("{p} is already in the world")));
                        }
                        self.st.entities.get_mut(&p).unwrap().body.as_mut().unwrap().present = true;
                        p
                    }
                    None => {
                        let (Some(name), Some(born_at), Some(template)) = (name, born_at, template) else {
                            return Err(refuse(RefusalCode::UnknownTemplate, "a newcomer needs a name, a birth time and a template"));
                        };
                        if self.s.templates.get(template).is_none_or(|t| t.kind != ParticipantKind::Person) {
                            return Err(refuse(RefusalCode::UnknownTemplate, format!("no template {template} for a person")));
                        }
                        if *born_at > self.now() {
                            return Err(refuse(RefusalCode::Overflow, "born in the future"));
                        }
                        let (id, events) = create_person(self.s, self.st, name, *born_at, *sex, vec![], true, template, variables.as_ref());
                        self.emit_all(events);
                        id
                    }
                };
                self.emit(EventBody::PersonArrived { person: id.clone(), via: self.entity.clone(), by: self.participant.into() });
                if let Some(amount) = carrying {
                    let acc = self.st.mint("acc");
                    let c = self.st.stamp();
                    let currency = self.s.currency.clone();
                    self.st.accounts.insert(acc.clone(), Arc::new(Account { holder: id.clone(), custodian: id.clone(), currency: currency.clone(), balance: 0, changed: c }));
                    self.emit(EventBody::AccountOpened { account: acc.clone(), holder: id.clone(), custodian: id.clone(), currency, by: self.participant.into() });
                    let boundary = self.s.boundary_account(&self.entity).to_string();
                    self.move_money(&boundary, &acc, *amount, TransferReason::Carried, None, None, None, None)?;
                }
                self.bind(bind, &id)
            }

            Block::Leave { person, to } => {
                let who = match person {
                    Some(p) => self.r(p)?,
                    None => self.acting_person()?,
                };
                // A person may take out of the world those in their care (a parent, their children: the town's household model
                // has them leave together, and newcomers' children have no parents on record here), so the kernel does not
                // refuse a person who takes another; what a seat may ask for is the resolver's to limit (it takes only itself).
                // Which edge they leave by: named, or the default.
                let to = match to {
                    Some(e) if self.s.is_boundary(e) => e.clone(),
                    Some(e) => return Err(refuse(RefusalCode::NotABoundary, format!("{e} isn't one of the world's edges"))),
                    None => self.s.boundary().to_string(),
                };
                self.living_present(&who)?;
                let own = self.st.body(&who).and_then(|b| b.participant.clone());
                let seats = seats_of(self.st, &who, own.as_deref());
                let events = vacate_all(self.s, self.st, &who, VacateReason::Departed, Some(self.participant));
                self.emit_all(events);
                self.st.entities.get_mut(&who).unwrap().body.as_mut().unwrap().present = false;
                self.st.moved(&who);
                self.emit(EventBody::PersonLeft { person: who, to, by: self.participant.into() });
                // Someone who has gone from the world holds no post in it: their posts fall vacant for whoever appoints to them
                // to fill, and every seat sharing their body ends (a model in one of their posts goes with the post). Their
                // own participant lives on for their own affairs abroad (their money, their words) and for a return.
                let mut ended = own.map(|p| vacate_positions(self.st, &p)).unwrap_or_default();
                for seat in seats {
                    ended.extend(end_participant(self.st, &seat, EndReason::Departed));
                }
                self.emit_all(ended);
                Ok(())
            }

            Block::Birth { name, template, other_parent } => {
                let me = self.acting_person()?;
                let bp = self.s.life().and_then(|l| l.birth.clone()).ok_or_else(|| refuse(RefusalCode::NotModelled, "this world has no births"))?;
                self.living_present(&me)?;
                let year = self.s.life().unwrap().year;
                let age = (self.now() - self.st.body(&me).unwrap().born_at) / year;
                if age < bp.ages[0] as i64 || age > bp.ages[1] as i64 {
                    return Err(refuse(RefusalCode::NotFertile, format!("{me} is {age}")));
                }
                if self.s.templates.get(template).is_none_or(|t| t.kind != ParticipantKind::Person) {
                    return Err(refuse(RefusalCode::UnknownTemplate, format!("no template {template} for a person")));
                }
                // Biology, where the world models sex: only a female body bears a child, and the other parent is male.
                let my_sex = self.st.body(&me).unwrap().sex;
                if my_sex == Some(Sex::Male) {
                    return Err(refuse(RefusalCode::NotFertile, format!("{me} can't bear a child")));
                }
                let mut parents = vec![me.clone()];
                if let Some(o) = other_parent {
                    let o = self.r(o)?;
                    if o == me {
                        return Err(refuse(RefusalCode::NotAPerson, "another parent can't be oneself"));
                    }
                    self.living_present(&o)?;
                    if my_sex.is_some() && self.st.body(&o).and_then(|b| b.sex) == Some(Sex::Female) {
                        return Err(refuse(RefusalCode::NotFertile, format!("{o} can't father a child")));
                    }
                    if !crate::geo::bodies_near(self.s, self.st, &me, &o, bp.reach) {
                        return Err(refuse(RefusalCode::TooFar, format!("{o} isn't near {me}")));
                    }
                    parents.push(o);
                }
                let due = self.later(bp.gestation)?;
                self.st.schedule(due, Sched::BirthDue { parents: parents.clone(), name: name.clone(), template: template.clone() });
                self.emit(EventBody::BirthStarted { parents, due });
                Ok(())
            }

            Block::Harm { person } => {
                let me = self.own_body()?;
                let harm = self.s.life().and_then(|l| l.harm.clone()).ok_or_else(|| refuse(RefusalCode::NotModelled, "this world doesn't model harm"))?;
                let victim = self.r(person)?;
                self.living_present(&me)?;
                self.living_present(&victim)?;
                if !crate::geo::bodies_near(self.s, self.st, &me, &victim, harm.reach) {
                    return Err(refuse(RefusalCode::TooFar, format!("{victim} isn't near {me}")));
                }
                let idx = index.to_string();
                let age = self.st.body(&victim).map_or(0, |b| (self.now() - b.born_at).div_euclid(self.s.life().map_or(365 * 86_400, |l| l.year)));
                let (severity, duration, death) = draw_severity(self.s, &harm.severity, age, &["harm", &me, &victim, &self.now().div_euclid(86_400).to_string(), &idx, &self.st.body(&victim).map_or(0, |b| b.conditions.len()).to_string()]);
                let t = self.now();
                let (cid, events) = begin_condition(self.s, self.st, &victim, ConditionKind::Injury, severity, t + duration, death.map(|d| t + d));
                self.emit(EventBody::Harmed { person: victim, by: self.participant.into(), condition: cid });
                self.emit_all(events);
                Ok(())
            }

            // ---------------- participants and positions ----------------
            Block::CreatePosition { title, role, channels, role_module, bind } => {
                let org = self.acting_org()?;
                let id = self.new_position(&org, title, role, channels, role_module, None)?;
                self.bind(bind, &id)
            }

            Block::Appoint { position, participant } => {
                let position = self.r(position)?;
                let x = self.st.positions.get(&position).ok_or_else(|| refuse(RefusalCode::UnknownPosition, format!("no position {position}")))?;
                // The post's own organisation fills it, or the authority its constitution names (an owner, a board, the council).
                let authority = self.s.config.positions.iter().find(|c| c.id == position).and_then(|c| c.appointed_by.clone());
                let org = if authority.as_deref() == Some(self.entity.as_str()) && self.entity != x.entity { self.entity.clone() } else { self.acting_org()? };
                if x.entity != org && authority.as_deref() != Some(org.as_str()) {
                    return Err(refuse(RefusalCode::NotTheirs, format!("{position} is {}'s, not {org}'s", x.entity)));
                }
                let holder = self.ro(participant)?;
                if let Some(h) = &holder {
                    let p = self.st.participants.get(h).ok_or_else(|| refuse(RefusalCode::UnknownParticipant, format!("no participant {h}")))?;
                    if p.status == ParticipantStatus::Ended {
                        return Err(refuse(RefusalCode::ParticipantInactive, format!("{h} no longer acts")));
                    }
                    // A system works only for the organisation it was delivered to: it is not appointed to another's post.
                    if p.kind == ParticipantKind::System && p.owner.as_deref() != Some(x.entity.as_str()) {
                        return Err(refuse(RefusalCode::NotTheirs, format!("{h} is a system belonging to {}: it doesn't work for {}", p.owner.as_deref().unwrap_or("nobody"), x.entity)));
                    }
                }
                let c = self.st.stamp();
                self.st.set_holder(&position, holder.clone(), c);
                self.emit(EventBody::Appointed { position, holder, by: Some(self.participant.into()) });
                Ok(())
            }

            Block::Deploy { template, to, title, bind } => {
                // The supplier's act (foundations F4): the acting organisation delivers a system from a template it supplies,
                // to a client organisation (itself, if none is named). The system belongs to the client.
                let org = self.acting_org()?;
                let tpl = self.s.templates.get(template).filter(|t| t.kind == ParticipantKind::System);
                let Some(tpl) = tpl else {
                    return Err(refuse(RefusalCode::UnknownTemplate, format!("no template {template} for a system")));
                };
                if tpl.supplier.as_deref() != Some(org.as_str()) {
                    return Err(refuse(RefusalCode::NotSupplier, format!("{org} doesn't supply {template}")));
                }
                let client = match to {
                    Some(t) => self.r(t)?,
                    None => org.clone(),
                };
                match self.st.entities.get(&client) {
                    None => return Err(refuse(RefusalCode::UnknownEntity, format!("no entity {client}"))),
                    Some(e) if e.kind == PERSON => return Err(refuse(RefusalCode::NotTheirs, format!("{client} is a person, not an organisation: a system is delivered to an organisation"))),
                    _ => {}
                }
                let (id, events) = create_participant(self.s, self.st, template, None, Some(client), Some(org), title.clone());
                self.emit_all(events);
                self.bind(bind, &id)
            }

            Block::Retire { participant } => {
                // Switched off by its owner (the client) or by its supplier: a licence ended, the vendor's switch.
                let org = self.acting_org()?;
                let p = self.r(participant)?;
                let x = self.st.participants.get(&p).ok_or_else(|| refuse(RefusalCode::UnknownParticipant, format!("no participant {p}")))?;
                if x.owner.as_deref() != Some(org.as_str()) && x.supplier.as_deref() != Some(org.as_str()) {
                    return Err(refuse(RefusalCode::NotTheirs, format!("{p} isn't a system belonging to, or supplied by, {org}")));
                }
                if x.status == ParticipantStatus::Ended {
                    return Err(refuse(RefusalCode::ParticipantInactive, format!("{p} has already ended")));
                }
                let events = end_participant(self.st, &p, EndReason::Retired);
                self.emit_all(events);
                Ok(())
            }

            // ---------------- records ----------------
            Block::CreateEntity { kind, name, first_position, speaks_for, visible_to, bind } => {
                if kind == PERSON || kind == BOUNDARY {
                    return Err(refuse(RefusalCode::ReservedKind, format!("a {kind} can't be created by an act")));
                }
                if self.st.counters.created_entities >= self.s.config.caps.max_created_entities {
                    return Err(refuse(RefusalCode::CapExceeded, format!("this world allows {} created entities", self.s.config.caps.max_created_entities)));
                }
                let speaks_for = self.ro(speaks_for)?;
                let id = self.st.mint("ent");
                self.st.counters.created_entities += 1;
                let c = self.st.stamp();
                self.st.entities.insert(id.clone(), Entity { kind: kind.clone(), name: name.clone(), changed: c, moved: 0, body: None });
                self.emit(EventBody::EntityCreated { entity: id.clone(), kind: kind.clone(), name: name.clone() });
                self.new_record(
                    RecordBody::EntityDeclaration { entity: id.clone(), kind: kind.clone(), name: name.clone() },
                    speaks_for,
                    visible_to.clone(),
                    None,
                )?;
                self.bind(bind, &id)?;
                if let Some(fp) = first_position {
                    let pos = self.new_position(&id, &fp.title, &fp.role, &fp.channels, &fp.role_module, Some(self.participant.into()))?;
                    self.bind(&fp.bind, &pos)?;
                }
                Ok(())
            }

            Block::RecordClaim { position, holder, counterparty, about, basis, speaks_for, visible_to, bind } => {
                let body = RecordBody::Claim { position: *position, holder: self.r(holder)?, counterparty: self.ro(counterparty)?, about: about.clone() };
                let id = self.new_record(body, self.ro(speaks_for)?, visible_to.clone(), self.cited(basis)?)?;
                self.bind(bind, &id)
            }

            Block::TransferClaim { claim, to, basis, speaks_for, visible_to, bind } => {
                let claim = self.r(claim)?;
                self.record_of_kind(&claim, "claim")?;
                let id = self.new_record(RecordBody::ClaimTransfer { claim, to: self.r(to)? }, self.ro(speaks_for)?, visible_to.clone(), self.cited(basis)?)?;
                self.bind(bind, &id)
            }

            Block::ReleaseClaim { claim, basis, speaks_for, visible_to, bind } => {
                let claim = self.r(claim)?;
                self.record_of_kind(&claim, "claim")?;
                let id = self.new_record(RecordBody::ClaimRelease { claim }, self.ro(speaks_for)?, visible_to.clone(), self.cited(basis)?)?;
                self.bind(bind, &id)
            }

            Block::ProposeAgreement { terms, basis, speaks_for, visible_to, bind } => {
                let terms = self.resolve_terms(terms)?;
                let id = self.new_record(RecordBody::Agreement { terms }, self.ro(speaks_for)?, visible_to.clone(), self.cited(basis)?)?;
                self.bind(bind, &id)
            }

            Block::SignAgreement { agreement, party, bind } => {
                let agreement = self.r(agreement)?;
                self.record_of_kind(&agreement, "agreement")?;
                let party = self.r(party)?;
                // An offer its owner has taken back can no longer be accepted (an agreement every party had signed is
                // concluded all the same: withdrawing the paper ends nothing). Whichever of the two commands the kernel
                // took first decides it: a withdrawal not yet stored does not stop a signature.
                if let Some(m) = self.st.marks.get(&agreement) {
                    if let (Some(at), Some(stored)) = (m.withdrawn_at, self.st.records.get(&agreement)) {
                        if let RecordBody::Agreement { terms } = &stored.record.body {
                            if !terms.parties.iter().all(|p| m.signatures.iter().any(|s| &s.party == p)) {
                                return Err(refuse(RefusalCode::OfferWithdrawn, format!("{agreement} was withdrawn by its maker at {at}; it can no longer be signed")));
                            }
                        }
                    }
                }
                let id = self.new_record(RecordBody::Signature { agreement, party: party.clone() }, Some(party), None, None)?;
                self.bind(bind, &id)
            }

            Block::GiveNotice { agreement, party, text, bind } => {
                let agreement = self.r(agreement)?;
                self.record_of_kind(&agreement, "agreement")?;
                let party = self.r(party)?;
                let id = self.new_record(RecordBody::Notice { agreement, party: party.clone(), text: text.clone() }, Some(party), None, None)?;
                self.bind(bind, &id)
            }

            Block::Publish { kind, text, data, adico, formal, offer, practice, assertion, registry, basis, addressed_to, place, speaks_for, visible_to, bind } => {
                let addressed_to = addressed_to.as_ref().map(|a| a.iter().map(|x| self.r(x)).collect::<R<Vec<_>>>()).transpose()?;
                if let Some(p) = place {
                    if !self.st.cells.contains_key(p) {
                        return Err(refuse(RefusalCode::UnknownCell, format!("no cell {p}")));
                    }
                }
                let body = RecordBody::Statement {
                    kind: kind.clone(),
                    text: text.clone(),
                    data: data.clone(),
                    adico: adico.clone(),
                    formal: formal.clone(),
                    offer: offer.clone(),
                    practice: practice.clone(),
                    assertion: assertion.clone(),
                    registry: registry.clone(),
                    addressed_to,
                    place: place.clone(),
                };
                let id = self.new_record(body, self.ro(speaks_for)?, visible_to.clone(), self.cited(basis)?)?;
                self.bind(bind, &id)
            }

            Block::Withdraw { record, text, basis, speaks_for, visible_to, bind } => {
                let record = self.r(record)?;
                self.record_of_kind(&record, "any")?;
                let id = self.new_record(RecordBody::Withdrawal { withdraws: record, text: text.clone() }, self.ro(speaks_for)?, visible_to.clone(), self.cited(basis)?)?;
                self.bind(bind, &id)
            }

            Block::Vote { ballot, choice, speaks_for, visible_to } => {
                let ballot = self.r(ballot)?;
                self.record_of_kind(&ballot, "statement")?;
                self.new_record(RecordBody::Vote { ballot, choice: choice.clone() }, self.ro(speaks_for)?, visible_to.clone(), None)?;
                Ok(())
            }

            Block::Message { to, text, re } => {
                let recipients = self.recipients(to)?;
                let mid = self.st.mint("msg");
                let msg = Message {
                    id: mid.clone(),
                    t: self.now(),
                    from: self.participant.into(),
                    from_position: self.position.map(String::from),
                    from_entity: Some(self.entity.clone()),
                    to: to.clone(),
                    text: text.clone(),
                    re: re.clone(),
                };
                let mut reached = BTreeSet::new();
                for (p, capacity) in &recipients {
                    Arc::make_mut(self.st.participants.get_mut(p).unwrap()).pending.entry(capacity.clone()).or_default().inbox.push(msg.clone());
                    reached.insert(p.clone());
                }
                self.emit(EventBody::MessageDelivered { message: mid, participant: self.participant.into(), to: reached.into_iter().collect() });
                Ok(())
            }
        }
    }
}
