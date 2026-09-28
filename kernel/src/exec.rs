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

use crate::blocks::{AgreementTerms, Block, Id, Record, RecordBody, Visibility};
use crate::canon::MAX_SAFE;
use crate::money::{Money, MAX_MONEY};
use crate::config::{check_channels, footprint_cells, split_space, Channel, ParticipantKind, Severity, BOUNDARY, PERSON, SELF};
use crate::events::{EndReason, EventBody, RefusalCode, Timed, TransferReason, VacateReason};
use crate::state::{
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
    /// The action's id, for keyed randomness.
    pub action: &'a str,
    /// Local refs bound so far in this action.
    pub refs: BTreeMap<String, Id>,
    pub events: Vec<Timed>,
}

pub struct ExecResult {
    pub events: Vec<Timed>,
    pub created: BTreeMap<String, Id>,
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
pub fn exec_action(s: &Statics, st: &mut State, participant: &str, position: Option<&str>, action: &str, blocks: &[Block]) -> R<ExecResult> {
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
    let mut ex = Exec { s, st, participant, position, entity, action, refs: BTreeMap::new(), events: vec![] };
    for (i, b) in blocks.iter().enumerate() {
        ex.block(b, i).map_err(|mut r| {
            r.block.get_or_insert(i);
            r
        })?;
    }
    Ok(ExecResult { events: ex.events, created: ex.refs })
}

// ---------------- life: shared by acts and scheduled effects ----------------

fn draw_severity(s: &Statics, bands: &[Severity], key: &[&str]) -> (String, i64, Option<i64>) {
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
    let death = (rng.below(10_000) < band.fatal_bps as u64).then(|| rng.below(duration as u64) as i64);
    (band.label.clone(), duration, death)
}

/// A condition begins now (and may end in death within it).
fn begin_condition(s: &Statics, st: &mut State, person: &str, kind: ConditionKind, severity: String, until: i64, death_at: Option<i64>) -> (Id, Vec<Timed>) {
    let t = st.t;
    let id = st.mint("cnd");
    if let Some(b) = st.entities.get_mut(person).and_then(|e| e.body.as_mut()) {
        b.conditions.push(Condition { id: id.clone(), kind, severity: severity.clone(), since: t, until });
    }
    st.schedule(until.max(t + s.tick), Sched::ConditionEnds { person: person.into(), condition: id.clone() });
    if let Some(d) = death_at {
        let cause = match kind {
            ConditionKind::Illness => DeathCause::Illness,
            ConditionKind::Injury => DeathCause::Injury,
        };
        st.schedule(d.max(t), Sched::Death { person: person.into(), cause });
    }
    (id.clone(), vec![Timed::new(t, EventBody::ConditionBegan { person: person.into(), condition: id, kind, severity, until })])
}

/// Take a body out of every space it's in.
fn vacate_all(st: &mut State, person: &str, reason: VacateReason, by: Option<&str>) -> Vec<Timed> {
    let t = st.t;
    let mut events = vec![];
    for sid in st.structures_of(person) {
        let mut spaces: Vec<Id> = vec![];
        if let Some(m) = st.occupancy.get_mut(&sid) {
            for (space, bodies) in m.iter_mut() {
                if bodies.remove(person) {
                    spaces.push(space.clone());
                }
            }
            m.retain(|_, b| !b.is_empty());
            if m.is_empty() {
                st.occupancy.remove(&sid);
            }
        }
        st.touch_structure(&sid);
        for space in spaces {
            st.record_departure(&space, person, reason);
            events.push(Timed::new(t, EventBody::Vacated { occupant: person.into(), space, by: by.map(String::from), reason }));
        }
    }
    if !events.is_empty() {
        st.moved(person);
    }
    events
}

/// Every position a participant holds falls vacant (it has gone).
fn vacate_positions(st: &mut State, participant: &str) -> Vec<Timed> {
    let t = st.t;
    let held: Vec<Id> = st.positions.iter().filter(|(_, x)| x.holder.as_deref() == Some(participant)).map(|(id, _)| id.clone()).collect();
    let mut events = vec![];
    for id in held {
        let c = st.stamp();
        let x = st.positions.get_mut(&id).unwrap();
        x.holder = None;
        x.changed = c;
        events.push(Timed::new(t, EventBody::Appointed { position: id, holder: None, by: None }));
    }
    events
}

fn end_participant(st: &mut State, participant: &str, reason: EndReason) -> Vec<Timed> {
    let t = st.t;
    let c = st.stamp();
    let Some(p) = st.participants.get_mut(participant) else { return vec![] };
    if p.status == ParticipantStatus::Ended {
        return vec![];
    }
    p.status = ParticipantStatus::Ended;
    p.status_changed = c;
    let mut events = vacate_positions(st, participant);
    events.push(Timed::new(t, EventBody::ParticipantEnded { participant: participant.into(), reason }));
    events
}

fn die(st: &mut State, person: &str, cause: DeathCause) -> Vec<Timed> {
    let t = st.t;
    let Some(b) = st.body(person) else { return vec![] };
    if !b.alive {
        return vec![];
    }
    let participant = b.participant.clone();
    let mut events = vacate_all(st, person, VacateReason::Died, None);
    if let Some(b) = st.entities.get_mut(person).and_then(|e| e.body.as_mut()) {
        b.alive = false;
        b.conditions.clear();
    }
    events.push(Timed::new(t, EventBody::PersonDied { person: person.into(), died_of: cause }));
    if let Some(p) = participant {
        events.extend(end_participant(st, &p, EndReason::Died));
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
fn create_participant(s: &Statics, st: &mut State, template: &str, person: Option<Id>, owner: Option<Id>, title: Option<String>) -> (Id, Vec<Timed>) {
    let t = st.t;
    let tpl = &s.templates[template];
    let id = st.mint("par");
    let traits = draw_traits(s, &tpl.traits, &id);
    let c = st.stamp();
    st.participants.insert(
        id.clone(),
        Participant {
            kind: tpl.kind,
            person: person.clone(),
            owner: owner.clone(),
            template: Some(template.into()),
            def: Arc::new(ParticipantDef {
                title: title.or_else(|| tpl.title.clone()),
                channels: tpl.channels.clone(),
                controller: tpl.controller.clone(),
                framing: tpl.framing.clone(),
                on_opt_out: tpl.on_opt_out.clone(),
            }),
            traits: traits.clone(),
            status: ParticipantStatus::Active,
            status_changed: c,
            pending: BTreeMap::new(),
            new_transactions: BTreeMap::new(),
            looks: BTreeMap::new(),
        },
    );
    let ev = Timed::new(t, EventBody::ParticipantCreated { participant: id.clone(), kind: tpl.kind, person, owner, template: template.into(), traits });
    (id, vec![ev])
}

/// A new body, with its participant from a template.
#[allow(clippy::too_many_arguments)]
fn create_person(s: &Statics, st: &mut State, name: &str, born_at: i64, sex: Option<Sex>, parents: Vec<Id>, present: bool, template: &str) -> (Id, Vec<Timed>) {
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
            body: Some(Body { born_at, sex, present, alive: true, parents: parents.clone(), conditions: vec![], participant: None, children: vec![] }),
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
    let (pid, mut pev) = create_participant(s, st, template, Some(id.clone()), None, None);
    st.entities.get_mut(&id).unwrap().body.as_mut().unwrap().participant = Some(pid.clone());
    schedule_birthday(s, st, &id, born_at);
    let mut events = vec![Timed::new(t, EventBody::PersonCreated { person: id.clone(), name: name.into(), born_at, sex, parents, participant: Some(pid) })];
    events.append(&mut pev);
    (id, events)
}

/// Schedule a body's next birthday (when the world has life physics).
pub fn schedule_birthday(s: &Statics, st: &mut State, person: &str, born_at: i64) {
    let Some(life) = s.life() else { return };
    let age = if st.t >= born_at { (st.t - born_at) / life.year } else { -1 };
    let next = born_at + (age + 1) * life.year;
    st.schedule(next.max(st.t), Sched::Birthday { person: person.into() });
}

fn uniform(s: &Statics, key: &[&str], n: i64) -> i64 {
    s.randomness.stream(key).below(n.max(1) as u64) as i64
}

/// Process one scheduled physical effect whose time has come.
pub fn scheduled(s: &Statics, st: &mut State, item: Scheduled) -> Vec<Timed> {
    let t = item.at;
    match item.what {
        Sched::StructureComplete { structure } => match st.structures.get_mut(&structure) {
            Some(x) if !x.complete && x.completes_at == Some(item.at) => {
                x.complete = true;
                x.completes_at = None;
                st.touch_structure(&structure);
                vec![Timed::new(t, EventBody::StructureCompleted { structure })]
            }
            // Demolished before completion: nothing to do.
            _ => vec![],
        },
        Sched::Birthday { person } => {
            let (Some(life), Some(b)) = (s.life(), st.body(&person)) else { return vec![] };
            if !b.alive {
                return vec![];
            }
            let born = b.born_at;
            let age = (t - born) / life.year;
            let a = age.to_string();
            let year = life.year;
            if let Some(oc) = &life.other_causes {
                if uniform(s, &["life", &person, &a, "other"], 10_000) < oc.at(age) as i64 {
                    let at = t + uniform(s, &["life", &person, &a, "other-when"], year);
                    st.schedule(at, Sched::Death { person: person.clone(), cause: DeathCause::Other });
                }
            }
            if let Some(ill) = &life.illness {
                let p = crate::config::ByAge { by_age: ill.by_age.clone() }.at(age);
                if uniform(s, &["life", &person, &a, "ill"], 10_000) < p as i64 {
                    let onset = t + uniform(s, &["life", &person, &a, "ill-when"], year);
                    let (severity, duration, death) = draw_severity(s, &ill.severity, &["life", &person, &a, "ill-how"]);
                    st.schedule(onset, Sched::ConditionBegins {
                        person: person.clone(), kind: ConditionKind::Illness, severity, until: onset + duration, death_at: death.map(|d| onset + d),
                    });
                }
            }
            if let Some(inj) = &life.injury {
                let most = s.types.values().filter_map(|ty| ty.injury_bps).max().unwrap_or(0);
                let max_bps = (inj.bps + most * 2).min(10_000);
                if max_bps > 0 && uniform(s, &["life", &person, &a, "exposed"], 10_000) < max_bps as i64 {
                    let at = t + uniform(s, &["life", &person, &a, "exposed-when"], year);
                    st.schedule(at, Sched::Exposure { person: person.clone(), max_bps });
                }
            }
            st.schedule(born + (age + 1) * year, Sched::Birthday { person });
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
            let (severity, duration, death) = draw_severity(s, &inj.severity, &["life", &person, &tk, "injury-how"]);
            begin_condition(s, st, &person, ConditionKind::Injury, severity, t + duration, death.map(|d| t + d)).1
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
        Sched::Death { person, cause } => die(st, &person, cause),
        Sched::BirthDue { parents, name, template } => {
            let Some(b) = st.body(&parents[0]) else { return vec![] };
            if !b.alive {
                return vec![];
            }
            let present = b.present;
            // Its sex, where the world models it: drawn by the kernel, keyed by the id the child is about to get.
            let next_id = format!("ent.{}", st.counters.ent + 1);
            let sex = s.life().and_then(|l| l.birth.as_ref()).and_then(|bp| bp.female_bps).map(|f| {
                if uniform(s, &["birth", &next_id, "sex"], 10_000) < f as i64 { Sex::Female } else { Sex::Male }
            });
            create_person(s, st, &name, t, sex, parents, present, &template).1
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

    fn account(&self, id: &str) -> R<&Account> {
        self.st.accounts.get(id).ok_or_else(|| refuse(RefusalCode::UnknownAccount, format!("no account {id}")))
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

    fn check_new_channels(&self, owner: &str, channels: &[Channel]) -> R<()> {
        let g = &self.s.config.world.ground;
        check_channels(owner, channels, &|e| self.st.entities.contains_key(e), &|c| {
            crate::config::cell_xy(c).is_some_and(|(x, y)| x < g.w && y < g.h)
        })
        .map_err(|e| refuse(RefusalCode::UnknownEntity, e))
    }

    fn new_position(&mut self, entity: &str, title: &Option<String>, role: &Option<String>, channels: &[Channel], role_module: &Option<Value>, holder: Option<Id>) -> R<Id> {
        self.check_new_channels("the position", channels)?;
        let id = self.st.mint("pos");
        let c = self.st.stamp();
        self.st.positions.insert(
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
        if src.holder == self.s.boundary {
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
            let a = self.st.accounts.get_mut(from).unwrap();
            a.balance -= amount;
            a.changed = c;
            let b = self.st.accounts.get_mut(to).unwrap();
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
        };
        // Everyone who acts for an entity concerned hears of it, through that entity's accounts.
        let concerned: BTreeSet<&str> = [src.holder.as_str(), src.custodian.as_str(), dst.holder.as_str(), dst.custodian.as_str()].into();
        let mut told: BTreeSet<(Id, Id)> = BTreeSet::new();
        for e in concerned {
            for (p, _) in self.st.acting_for(e) {
                told.insert((p, e.to_string()));
            }
        }
        for (p, e) in told {
            if let Some(x) = self.st.participants.get_mut(&p) {
                x.new_transactions.entry(e).or_default().push(tx.clone());
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
        });
        Ok(())
    }

    /// Make and store a record authored by the acting participant, in its capacity. Checks only that
    /// everything it references exists.
    fn new_record(&mut self, body: RecordBody, speaks_for: Option<Id>, visible_to: Option<Visibility>, basis: Option<Id>) -> R<Id> {
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
            body,
        };
        for e in rec.entities_named().into_iter().chain(rec.visibility_entities()) {
            self.entity_exists(e)?;
        }
        if let Some(b) = &rec.basis {
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
                    for (pos, x) in self.st.positions.iter() {
                        if x.holder.as_deref() == Some(id.as_str()) {
                            out.insert((id.clone(), pos.clone()));
                        }
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
        out.retain(|(p, _)| self.st.participants.get(p).is_some_and(can_act));
        Ok(out)
    }

    pub fn block(&mut self, b: &Block, index: usize) -> R<()> {
        match b {
            // ---------------- physical ----------------
            Block::Transfer { from, to, amount, settles, per_instruction, memo } => {
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
                self.move_money(&from, &to, *amount, TransferReason::Payment, settles, per_instruction, memo.clone())
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
                self.st.accounts.insert(id.clone(), Account { holder: holder.clone(), custodian: self.entity.clone(), currency: currency.clone(), balance: 0, changed: c });
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
                    self.st.closed_accounts.insert(account.clone(), crate::state::ClosedAccount { holder: gone.holder, custodian: gone.custodian, currency: gone.currency, changed: c });
                }
                self.emit(EventBody::AccountClosed { account, by: self.participant.into() });
                Ok(())
            }

            Block::Construct { at, structure_type, materials_from, bind } => {
                let ty = self
                    .s
                    .types
                    .get(structure_type)
                    .ok_or_else(|| refuse(RefusalCode::UnknownStructureType, format!("no structure type {structure_type}")))?
                    .clone();
                let cells = footprint_cells(&self.s.config.world.ground, at, ty.footprint)
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
                let from = self.r(materials_from)?;
                if self.account(&from)?.holder != self.entity {
                    return Err(refuse(RefusalCode::NotHolder, format!("{from} isn't held by the builder {}", self.entity)));
                }
                let completes = self.later(ty.build_time)?;
                // Documented liberty (D25, accepted temporarily): materials are paid
                // straight to the outside world, not through the builder's bank.
                let boundary = self.s.boundary_account().to_string();
                self.move_money(&from, &boundary, ty.materials_cost, TransferReason::Materials, None, None, None)?;
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
                    },
                );
                let c = self.st.stamp();
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

            Block::Demolish { structure, costs_from } => {
                let sid = self.r(structure)?;
                let x = self.st.structures.get(&sid).ok_or_else(|| refuse(RefusalCode::UnknownStructure, format!("no structure {sid}")))?.clone();
                let from = self.r(costs_from)?;
                if self.account(&from)?.holder != self.entity {
                    return Err(refuse(RefusalCode::NotHolder, format!("{from} isn't held by {}", self.entity)));
                }
                let cost = self.s.types[&x.structure_type].demolition_cost;
                let boundary = self.s.boundary_account().to_string();
                self.move_money(&from, &boundary, cost, TransferReason::Demolition, None, None, None)?;
                for (space, bodies) in self.st.occupancy.remove(&sid).unwrap_or_default() {
                    for occupant in bodies {
                        self.st.moved(&occupant);
                        self.emit(EventBody::Vacated { occupant, space: space.clone(), by: Some(self.participant.into()), reason: VacateReason::Demolition });
                    }
                }
                self.st.structures.remove(&sid);
                let c = self.st.stamp();
                for cell in &x.cells {
                    let p = self.st.cells.get_mut(cell).unwrap();
                    p.structure = None;
                    p.changed = c;
                }
                self.emit(EventBody::StructureDemolished { structure: sid, by: self.participant.into() });
                Ok(())
            }

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
                let sid = sid.to_string();
                self.st.occupancy.entry(sid.clone()).or_default().entry(space.clone()).or_default().insert(who.clone());
                self.st.touch_structure(&sid);
                self.st.moved(&who);
                self.emit(EventBody::Occupied { occupant: who, space, by: self.participant.into() });
                Ok(())
            }

            Block::Vacate { occupant, from } => {
                let (occupant, from) = (self.r(occupant)?, self.r(from)?);
                self.entity_exists(&occupant)?;
                let sid = split_space(&from).map_or(from.as_str(), |(s, _)| s).to_string();
                let mut left = vec![];
                if let Some(m) = self.st.occupancy.get_mut(&sid) {
                    for (space, bodies) in m.iter_mut() {
                        if (space == &from || sid == from) && bodies.remove(&occupant) {
                            left.push(space.clone());
                        }
                    }
                    m.retain(|_, b| !b.is_empty());
                    if m.is_empty() {
                        self.st.occupancy.remove(&sid);
                    }
                }
                if left.is_empty() {
                    return Err(refuse(RefusalCode::NotPresent, format!("{occupant} is not in {from}")));
                }
                self.st.touch_structure(&sid);
                self.st.moved(&occupant);
                let reason = if occupant == self.entity { VacateReason::Left } else { VacateReason::Removed };
                for space in left {
                    self.st.record_departure(&space, &occupant, reason);
                    self.emit(EventBody::Vacated { occupant: occupant.clone(), space, by: Some(self.participant.into()), reason });
                }
                Ok(())
            }

            // ---------------- bodies ----------------
            Block::Arrive { person, name, born_at, template, carrying, sex, bind } => {
                if self.entity != self.s.boundary || self.position.is_none() {
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
                        let (id, events) = create_person(self.s, self.st, name, *born_at, *sex, vec![], true, template);
                        self.emit_all(events);
                        id
                    }
                };
                self.emit(EventBody::PersonArrived { person: id.clone(), by: self.participant.into() });
                if let Some(amount) = carrying {
                    let acc = self.st.mint("acc");
                    let c = self.st.stamp();
                    let currency = self.s.currency.clone();
                    self.st.accounts.insert(acc.clone(), Account { holder: id.clone(), custodian: id.clone(), currency: currency.clone(), balance: 0, changed: c });
                    self.emit(EventBody::AccountOpened { account: acc.clone(), holder: id.clone(), custodian: id.clone(), currency, by: self.participant.into() });
                    let boundary = self.s.boundary_account().to_string();
                    self.move_money(&boundary, &acc, *amount, TransferReason::Carried, None, None, None)?;
                }
                self.bind(bind, &id)
            }

            Block::Leave { person } => {
                let who = match person {
                    Some(p) => self.r(p)?,
                    None => self.acting_person()?,
                };
                self.living_present(&who)?;
                let events = vacate_all(self.st, &who, VacateReason::Departed, Some(self.participant));
                self.emit_all(events);
                self.st.entities.get_mut(&who).unwrap().body.as_mut().unwrap().present = false;
                self.st.moved(&who);
                self.emit(EventBody::PersonLeft { person: who, by: self.participant.into() });
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
                let (severity, duration, death) = draw_severity(self.s, &harm.severity, &["harm", self.action, &idx, &victim]);
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
                let org = self.acting_org()?;
                let position = self.r(position)?;
                let x = self.st.positions.get(&position).ok_or_else(|| refuse(RefusalCode::UnknownPosition, format!("no position {position}")))?;
                if x.entity != org {
                    return Err(refuse(RefusalCode::NotTheirs, format!("{position} is {}'s, not {org}'s", x.entity)));
                }
                let holder = self.ro(participant)?;
                if let Some(h) = &holder {
                    let p = self.st.participants.get(h).ok_or_else(|| refuse(RefusalCode::UnknownParticipant, format!("no participant {h}")))?;
                    if p.status == ParticipantStatus::Ended {
                        return Err(refuse(RefusalCode::ParticipantInactive, format!("{h} no longer acts")));
                    }
                }
                let c = self.st.stamp();
                let x = self.st.positions.get_mut(&position).unwrap();
                x.holder = holder.clone();
                x.changed = c;
                self.emit(EventBody::Appointed { position, holder, by: Some(self.participant.into()) });
                Ok(())
            }

            Block::Deploy { template, title, bind } => {
                let org = self.acting_org()?;
                if self.s.templates.get(template).is_none_or(|t| t.kind != ParticipantKind::System) {
                    return Err(refuse(RefusalCode::UnknownTemplate, format!("no template {template} for a system")));
                }
                let (id, events) = create_participant(self.s, self.st, template, None, Some(org), title.clone());
                self.emit_all(events);
                self.bind(bind, &id)
            }

            Block::Retire { participant } => {
                let org = self.acting_org()?;
                let p = self.r(participant)?;
                let x = self.st.participants.get(&p).ok_or_else(|| refuse(RefusalCode::UnknownParticipant, format!("no participant {p}")))?;
                if x.owner.as_deref() != Some(org.as_str()) {
                    return Err(refuse(RefusalCode::NotTheirs, format!("{p} isn't a system belonging to {org}")));
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
                let id = self.new_record(body, self.ro(speaks_for)?, visible_to.clone(), self.ro(basis)?)?;
                self.bind(bind, &id)
            }

            Block::TransferClaim { claim, to, basis, speaks_for, visible_to, bind } => {
                let claim = self.r(claim)?;
                self.record_of_kind(&claim, "claim")?;
                let id = self.new_record(RecordBody::ClaimTransfer { claim, to: self.r(to)? }, self.ro(speaks_for)?, visible_to.clone(), self.ro(basis)?)?;
                self.bind(bind, &id)
            }

            Block::ReleaseClaim { claim, basis, speaks_for, visible_to, bind } => {
                let claim = self.r(claim)?;
                self.record_of_kind(&claim, "claim")?;
                let id = self.new_record(RecordBody::ClaimRelease { claim }, self.ro(speaks_for)?, visible_to.clone(), self.ro(basis)?)?;
                self.bind(bind, &id)
            }

            Block::ProposeAgreement { terms, basis, speaks_for, visible_to, bind } => {
                let terms = self.resolve_terms(terms)?;
                let id = self.new_record(RecordBody::Agreement { terms }, self.ro(speaks_for)?, visible_to.clone(), self.ro(basis)?)?;
                self.bind(bind, &id)
            }

            Block::SignAgreement { agreement, party, bind } => {
                let agreement = self.r(agreement)?;
                self.record_of_kind(&agreement, "agreement")?;
                let party = self.r(party)?;
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

            Block::Publish { kind, text, data, adico, formal, basis, addressed_to, place, speaks_for, visible_to, bind } => {
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
                    addressed_to,
                    place: place.clone(),
                };
                let id = self.new_record(body, self.ro(speaks_for)?, visible_to.clone(), self.ro(basis)?)?;
                self.bind(bind, &id)
            }

            Block::Withdraw { record, text, basis, speaks_for, visible_to, bind } => {
                let record = self.r(record)?;
                self.record_of_kind(&record, "any")?;
                let id = self.new_record(RecordBody::Withdrawal { withdraws: record, text: text.clone() }, self.ro(speaks_for)?, visible_to.clone(), self.ro(basis)?)?;
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
                    to: to.clone(),
                    text: text.clone(),
                    re: re.clone(),
                };
                let mut reached = BTreeSet::new();
                for (p, capacity) in &recipients {
                    self.st.participants.get_mut(p).unwrap().pending.entry(capacity.clone()).or_default().inbox.push(msg.clone());
                    reached.insert(p.clone());
                }
                self.emit(EventBody::MessageDelivered { message: mid, participant: self.participant.into(), to: reached.into_iter().collect() });
                Ok(())
            }
        }
    }
}
