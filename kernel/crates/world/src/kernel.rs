//! The kernel (v0.5): the only writer of world state, and physics only.
//!
//! It takes commands (the only inputs; see the Command definition in
//! contracts/log.schema.json) and returns the events they caused. An act
//! either takes effect, or is refused because it is physically impossible.
//! There are no mandates, approvals or laws in here (D18-D20): authority and
//! law are records, and they matter only through what participants choose to do.
//!
//! It never reads wall-clock time, never iterates a hash map, never touches a
//! float, and draws randomness only from `Statics::randomness`.

use crate::blocks::{Block, Id};
use crate::canon;
use crate::config::{cell_id, terrain_at, LoadedConfig, ParticipantKind, SELF};
use crate::events::{EventBody, RefusalCode, Timed, VacateReason};
use crate::exec::{can_act, exec_action, refuse, schedule_birthday, scheduled, Refusal};
use crate::rng::Randomness;
use crate::state::{Account, Body, Cell, Counters, Entity, Outcome, OutcomeStatus, Participant, ParticipantDef, ParticipantStatus, Position, RefusalInfo, State, Structure};
use crate::statics::Statics;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Act {
        participant: Id,
        /// The position it acts in; absent: as itself (a person's only).
        #[serde(default, rename = "as", skip_serializing_if = "Option::is_none")]
        position: Option<Id>,
        blocks: Vec<Block>,
        /// Who does the act's work, if not the actor alone (foundations F3): people, each alive, present and at work
        /// (`orchestration.performers_in`). The act's time is theirs, shared; it starts when all are free.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        by: Vec<Id>,
        /// Logged, never interpreted.
        provenance: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
        /// World seconds spent deciding, before the act starts (the world's `thinking_time`; docs/design/rebuild.md 6.4).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        thinking: Option<i64>,
    },
    Advance {
        to: i64,
    },
    /// `Advance`, but it stops at the moment something happens to a person's body (a condition begun, ended or
    /// treated, or one flooded out of where they were), after everything scheduled for that moment: the clock is
    /// then at that moment, not at `to`. So the news reaches the person when it happens, whoever else happens to
    /// wake next (foundations F7: a pilot and its code twin differ only where a seat decides differently).
    AdvanceToNews {
        to: i64,
    },
    Observe {
        participant: Id,
        /// Only this capacity ("self", or a position it holds); absent: all of them.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        only: Option<Id>,
    },
    /// An observation that also looks through the named channels now (attention): on-request
    /// channels are perceived only this way, and a look through a records channel can be a search.
    Look {
        participant: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        only: Option<Id>,
        looks: Vec<crate::config::LookRequest>,
    },
    OptOut {
        participant: Id,
        statement: String,
    },
    /// An entity's record, set (docs/design/ai-citizens.md 10d): the sections given replace those of the same
    /// name, the rest stand. It is the platform's bookkeeping for that entity, named in the world's config, never
    /// an act in the world: it takes no time. No entity named: the participant's own person's record; one named: an
    /// organisation whose keeping post the participant holds.
    EntityRecord {
        participant: Id,
        /// The organisation whose record is set, when it is not the participant's own person's: one for which the
        /// participant now holds the post whose bookkeeping keeps it (`keeps_record`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        entity: Option<Id>,
        set: BTreeMap<String, Value>,
        /// What moved it, in a few words of the mind's own (logged and chained; never read here).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        because: Option<Value>,
    },
}

/// A command the kernel will not accept at all. Unlike a refusal (a finding,
/// logged and returned to the participant), a protocol error means the orchestrator
/// sent something off-contract; it is never logged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolError(pub String);

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ProtocolError {}

fn perr<T>(msg: impl Into<String>) -> Result<T, ProtocolError> {
    Err(ProtocolError(msg.into()))
}

#[derive(Debug, Clone, Default)]
pub struct Output {
    pub events: Vec<Timed>,
}

/// Result of a dry run: would physics allow this right now?
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Check {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refusal: Option<RefusalInfo>,
}

pub struct World {
    s: Statics,
    state: State,
}

/// A map's canonical bytes, written entry by entry (each value's encoded alone and let go): exactly `canon::canonical`
/// of the whole map, for keys that serialise as themselves (ids: strings).
fn write_map<K: AsRef<str> + Ord + Clone, V: serde::Serialize + Clone>(m: &crate::state::Map<K, V>, sink: &mut dyn FnMut(&[u8])) -> Result<(), canon::CanonError> {
    // Canonical key order is by UTF-16 code units; for ASCII keys (every id so far) that's the map's own order.
    let mut keys: Vec<&K> = m.keys().collect();
    if !keys.iter().all(|k| k.as_ref().is_ascii()) {
        keys.sort_by(|a, b| a.as_ref().encode_utf16().cmp(b.as_ref().encode_utf16()));
    }
    let mut buf = Vec::new();
    sink(b"{");
    for (i, k) in keys.into_iter().enumerate() {
        buf.clear();
        if i > 0 {
            buf.push(b',');
        }
        canon::write_string(k.as_ref(), &mut buf);
        buf.push(b':');
        sink(&buf);
        sink(&canon::canonical(&m[k])?);
    }
    sink(b"}");
    Ok(())
}

fn refusal_info(r: &Refusal) -> RefusalInfo {
    RefusalInfo { code: r.code, block: r.block, detail: r.detail.clone() }
}

impl World {
    pub fn new(loaded: &LoadedConfig) -> Result<World, String> {
        let c = &*loaded.config;
        let w = &c.world;
        let currency = w.currencies[0].code;
        let cur_of = |a: &crate::config::AccountCfg| a.currency.unwrap_or(currency);
        let mut boundary_accounts = BTreeMap::new();
        for a in w.accounts.iter().filter(|a| w.boundaries.contains(&a.holder) && a.custodian == a.holder) {
            boundary_accounts.entry((a.holder, cur_of(a))).or_insert_with(|| a.id);
        }
        let s = Statics {
            types: c.catalogue.structure_types.iter().map(|t| (t.id, t.clone())).collect(),
            spaces: c
                .catalogue
                .structure_types
                .iter()
                .map(|t| (t.id, crate::config::spaces_of(t).into_iter().map(|(l, sp)| (Id::from(l), sp.clone())).collect()))
                .collect(),
            templates: c.templates.iter().map(|t| (t.id, t.clone())).collect(),
            boundaries: w.boundaries.iter().map(|x| Id::new(x)).collect(),
            detailed: crate::config::detailed_rects(&w.places),
            boundary_accounts,
            currency: currency.to_string().into(),
            tick: c.clock.tick_seconds,
            // (A system template's own rows and hours, made into one table at load: law 10, foundations-2 P1.)
            act_times: c.templates.iter().filter(|t| t.kind == ParticipantKind::System).fold(oikos_time::ActTimes::from_orchestration(&c.orchestration), |a, t| {
                let rows = t.does.iter().flatten().filter(|r| r.block != "work").filter_map(|r| r.seconds.map(|s| (r.key(), s))).collect();
                a.with_template(&t.id, oikos_time::TemplateTimes { rows, hours: t.hours.and_then(|h| oikos_time::Hours::new(h.from, h.seconds)) })
            }),
            performers_in: c.orchestration["performers_in"].as_str().map(String::from),
            randomness: Randomness::new(c.seed),
            nature: oikos_nature::configured(&c.catalogue).then(|| {
                let cells: BTreeSet<(Id, i64, i64)> = crate::config::detailed_rects(&w.places)
                    .iter()
                    .flat_map(|r| (r.y..r.y + r.h).flat_map(move |y| (r.x..r.x + r.w).map(move |x| (cell_id(x, y), x, y))))
                    .collect();
                oikos_nature::Ground::new(&cells.into_iter().collect::<Vec<_>>(), &w.flows)
            }),
            participant_at: {
                let mut at = BTreeMap::new();
                for (i, x) in c.participants.iter().enumerate() {
                    at.entry(x.id).or_insert(i);
                }
                at
            },
            record_keeping_at: {
                let mut at = BTreeMap::new();
                for (i, x) in c.positions.iter().enumerate().filter(|(_, x)| x.keeps_record) {
                    at.entry(x.entity).or_insert(i);
                }
                at
            },
            net: c.world.network.as_ref().map(|n| Arc::new(crate::network::NetStatics::of(n, &c.catalogue))),
            config: loaded.config.clone(),
        };
        let person_of: BTreeMap<&str, &str> = c.participants.iter().filter(|p| !p.shares_body).filter_map(|p| p.person.as_deref().map(|e| (e, p.id.as_str()))).collect();
        // Each parent's children, in the order the entities are given (found once, not by looking through every
        // entity for every person).
        let mut children_of: BTreeMap<&str, Vec<Id>> = BTreeMap::new();
        for child in &w.entities {
            let mut seen: Vec<&str> = vec![];
            for parent in child.parents.iter().flatten() {
                // (A parent named twice has the child once.)
                if !seen.contains(&parent.as_str()) {
                    seen.push(parent);
                    children_of.entry(parent).or_default().push(child.id);
                }
            }
        }
        let mut cells = crate::state::Map::new();
        // Cells exist only where a place is detailed (D58); nested detailed places share theirs.
        for r in crate::config::detailed_rects(&w.places) {
            for y in r.y..r.y + r.h {
                for x in r.x..r.x + r.w {
                    cells.insert(cell_id(x, y), Cell { x, y, terrain: terrain_at(&w.ground, x, y).map(String::from), structure: None, changed: 0 });
                }
            }
        }
        let mut st = State {
            t: 0,
            counters: Counters::default(),
            entities: w
                .entities
                .iter()
                .map(|e| {
                    let body = (e.kind == crate::config::PERSON).then(|| Body {
                        born_at: e.born_at.unwrap_or(0),
                        sex: e.sex,
                        children: children_of.get(e.id.as_str()).cloned().unwrap_or_default(),
                        present: e.present.unwrap_or(true),
                        alive: true,
                        parents: e.parents.clone().unwrap_or_default(),
                        conditions: vec![],
                        participant: (person_of.get(e.id.as_str()).map(|p| p.to_string())).map(Into::into),
                        variables: crate::state::body_variables(&c.catalogue, e.variables.as_ref(), 0),
                    });
                    (e.id, Entity { kind: e.kind.clone(), name: e.name.clone(), changed: 0, moved: 0, body })
                })
                .collect(),
            accounts: w.accounts.iter().map(|a| (a.id, Arc::new(Account { holder: a.holder, custodian: a.custodian, currency: cur_of(a), balance: a.balance, changed: 0 }))).collect(),
            holdings: w
                .holdings
                .iter()
                .map(|x| (crate::state::holding_key(&x.holder, &x.at, &x.kind), crate::state::Holding { kind: x.kind, holder: x.holder, at: x.at, quantity: x.quantity, changed: 0 }))
                .collect(),
            closed_accounts: crate::state::Map::new(),
            cells,
            structures: crate::state::Map::new(),
            occupancy: crate::state::Map::new(),
            whereabouts: Default::default(),
            departures: crate::state::Map::new(),
            entered: crate::state::Map::new(),
            records: crate::state::Map::new(),
            marks: Default::default(),
            agreements_of: Default::default(),
            ground: Default::default(),
            record_order: imbl::Vector::new(),
            participants: c
                .participants
                .iter()
                .map(|p| {
                    (
                        p.id,
                        Arc::new(Participant {
                            kind: p.kind,
                            person: p.person,
                            owner: p.owner,
                            template: p.template,
                            supplier: p.supplier,
                            def: Arc::new(ParticipantDef {
                                title: p.title.clone(),
                                channels: p.channels.clone(),
                                controller: p.controller.clone(),
                                framing: p.framing.clone(),
                                on_opt_out: p.on_opt_out.clone(),
                                lanes: p.lanes,
                            }),
                            traits: p.traits.clone(),
                            status: ParticipantStatus::Active,
                            status_changed: 0,
                            pending: BTreeMap::new(),
                            new_transactions: BTreeMap::new(),
                            looks: BTreeMap::new(),
                        }),
                    )
                })
                .collect(),
            positions: Default::default(),
            positions_of: Default::default(),
            held: Default::default(),
            ledgers: Default::default(),
            schedule: Default::default(),
            timelines: Default::default(),
            nature: None,
            totals: c.catalogue.counters.iter().map(|x| (x.id, 0)).collect(),
            flooded: Default::default(),
            takings: Default::default(),
            asks_held: Default::default(),
            entity_records: Default::default(),
            vehicles: c
                .travel
                .iter()
                .flat_map(|t| t.vehicles.iter())
                .map(|v| (v.id, crate::state::Vehicle { type_: v.type_, owner: v.owner, at: v.at }))
                .collect(),
            transit: Default::default(),
            network: None,
            scarce_sold: Default::default(),
        };
        for p in &c.positions {
            let position = Position { entity: p.entity, title: p.title.clone(), role: p.role.clone(), channels: Arc::new(p.channels.clone()), role_module: p.role_module.clone(), holder: p.holder, changed: 0 };
            st.add_position(p.id, position);
        }
        for x in &w.structures {
            let f = s.types[x.structure_type.as_str()].footprint;
            let cells = crate::config::footprint_cells(&crate::config::detailed_rects(&w.places), &x.at, f).expect("validated");
            for cell in &cells {
                st.cells.get_mut(cell).unwrap().structure = Some(x.id);
            }
            st.structures.insert(x.id, Structure {
                    at: x.at,
                    cells,
                    structure_type: x.structure_type,
                    built_by: x.built_by,
                    complete: true,
                    completes_at: None,
                    labour_done: 0,
                    demolition: None,
                    variables: {
                        // (As old and as worn as the world says: a variable given for it starts there, within its bounds.)
                        let mut v = crate::exec::init_variables(&s, &x.structure_type, 0);
                        if let Some(given) = &x.variables {
                            for cfg in crate::exec::vars_for(&s, &x.structure_type) {
                                if let Some(g) = given.get(&cfg.id) {
                                    v.insert(cfg.id, ((*g).clamp(cfg.min, cfg.max), 0));
                                }
                            }
                        }
                        v
                    },
                });
        }
        for o in &w.occupancy {
            let (sid, _) = crate::config::split_space(&o.space).expect("validated");
            st.enter(sid, &o.space, &o.occupant);
        }
        for r in &w.records {
            st.store_shared(r.clone());
        }
        // Nature at the start (docs/design/world-expansion.md 2), stepped each day from the next.
        if s.nature.is_some() {
            let mut n = oikos_nature::NatureState::default();
            for p in &w.populations {
                *n.populations.entry(p.species).or_default().entry(p.cell).or_insert(0) += p.count;
            }
            for f in &w.fields {
                n.fields.entry(f.field).or_default().insert(f.cell, f.value);
            }
            // (Spun up: days before the start, over the land as it starts; covers don't succeed meanwhile.)
            if w.nature_spin_up_days > 0 {
                let ground = s.nature.as_ref().unwrap();
                let land = crate::exec::nature_land(&s, &st, ground);
                oikos_nature::spin_up(&c.catalogue, ground, &land, &mut n, -w.nature_spin_up_days, w.nature_spin_up_days, &s.randomness);
                n.day = 0;
            }
            st.nature = Some(Arc::new(n));
            st.schedule(86_400, crate::state::Sched::NatureDay { day: 1 });
        }
        // The network (foundations-2 C3): its links and the world's connections, settled from the first hour.
        st.network = crate::network::initial(&s);
        if st.network.is_some() {
            st.schedule(0, crate::state::Sched::Settle);
        }
        // The world's totals, censused monthly.
        if !c.catalogue.counters.is_empty() {
            st.schedule(30 * 86_400, crate::state::Sched::CounterCensus);
        }
        // Bodies age from the start.
        let people: Vec<(Id, i64)> = st.entities.iter().filter_map(|(id, e)| e.body.as_ref().map(|b| (*id, b.born_at))).collect();
        for (id, born) in people {
            schedule_birthday(&s, &mut st, &id, born);
        }
        let k = World { s, state: st };
        k.state_hash().map_err(|e| format!("initial state is not canonical: {e}"))?;
        Ok(k)
    }

    /// A world in a state it was in before (a snapshot's): the statics made again from its config, the state as
    /// saved with its lookups made again (`State::rebuild_derived`). It goes on exactly as the world it was saved from.
    pub fn resume(loaded: &LoadedConfig, mut state: State) -> Result<World, String> {
        let s = World::new(loaded)?.s;
        state.rebuild_derived();
        let k = World { s, state };
        k.state_hash().map_err(|e| format!("the resumed state is not canonical: {e}"))?;
        Ok(k)
    }

    /// The same world, apart from this one from now on (a fork): the state is persistent, so this copies almost
    /// nothing until one of them changes.
    pub fn fork(&self) -> World {
        World { s: self.s.clone(), state: self.state.clone() }
    }

    pub fn state(&self) -> &State {
        &self.state
    }

    pub fn statics(&self) -> &Statics {
        &self.s
    }

    pub fn t(&self) -> i64 {
        self.state.t
    }

    /// Canonical JSON of the full world state. Byte-identical replay means this is byte-identical.
    pub fn canonical_state(&self) -> Result<Vec<u8>, canon::CanonError> {
        let mut out = Vec::new();
        self.write_state(&mut |b| out.extend_from_slice(b))?;
        Ok(out)
    }

    pub fn state_hash(&self) -> Result<String, canon::CanonError> {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(canon::DOMAIN_STATE.as_bytes());
        self.write_state(&mut |b| h.update(b))?;
        Ok(canon::to_hex(&h.finalize()))
    }

    /// The state's canonical bytes (exactly `canon::canonical(&self.state)`), streamed: each large map entry by entry,
    /// the records' order id by id, the rest (small by comparison) member by member. Nothing is held whole, and nothing
    /// is kept between one time and the next (SC-1: the cache of records' bytes it kept grew with the run).
    fn write_state(&self, sink: &mut dyn FnMut(&[u8])) -> Result<(), canon::CanonError> {
        let mut rest = self.state.clone(); // (a persistent copy: cheap)
        // Nothing is kept of what was written before: it is written afresh each time (the state is hashed at its
        // checkpoints, a month apart in a town; each record's bytes are made, hashed and let go), and the large maps (a town's people, their bodies and records, cells, buildings...) are written entry by entry,
        // as the records are: none of them is held whole as canonical bytes (at 50,000 people, the whole state's were
        // gigabytes at every checkpoint: SC-1). Emptied here, they are written from the state below.
        let s = &self.state;
        let mut streamed: Vec<(&str, Box<dyn Fn(&mut dyn FnMut(&[u8])) -> Result<(), canon::CanonError> + '_>)> = vec![];
        macro_rules! stream {
            ($($f:ident),*) => {$(
                rest.$f = Default::default();
                if !s.$f.is_empty() {
                    streamed.push((stringify!($f), Box::new(move |sink: &mut dyn FnMut(&[u8])| write_map(&s.$f, sink))));
                }
            )*};
        }
        stream!(entities, accounts, holdings, closed_accounts, cells, structures, occupancy, departures, entered, records, participants, positions, timelines);
        rest.record_order = imbl::Vector::new();
        if !s.record_order.is_empty() {
            streamed.push(("record_order", Box::new(move |sink: &mut dyn FnMut(&[u8])| {
                let mut buf = Vec::new();
                sink(b"[");
                for (i, id) in s.record_order.iter().enumerate() {
                    buf.clear();
                    if i > 0 {
                        buf.push(b',');
                    }
                    canon::write_string(id, &mut buf);
                    sink(&buf);
                }
                sink(b"]");
                Ok(())
            })));
        }
        // (Its other members' canonical bytes, in order, written straight from the state: no JSON value is made of it.)
        let mut members: Vec<(String, Option<Vec<u8>>)> = canon::canonical_members(&rest)?.into_iter().map(|(k, b)| (k, Some(b))).collect();
        for (k, _) in &streamed {
            // (A map left out when empty is not among the rest's members: it goes where its key does.)
            if !members.iter().any(|(m, _)| m == k) {
                members.push((k.to_string(), None));
            }
        }
        members.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
        sink(b"{");
        for (i, (k, bytes)) in members.iter().enumerate() {
            let mut buf = Vec::new();
            if i > 0 {
                buf.push(b',');
            }
            canon::write_string(k, &mut buf);
            buf.push(b':');
            sink(&buf);
            match streamed.iter().find(|(f, _)| f == k) {
                Some((_, write)) => write(sink)?,
                None => sink(bytes.as_deref().expect("a member of the rest")),
            }
        }
        sink(b"}");
        Ok(())
    }

    /// The canonical bytes of the state as `canon::canonical` makes them whole (for the test that `write_state`'s
    /// stream is the same bytes).
    pub fn canonical_state_whole(&self) -> Result<Vec<u8>, canon::CanonError> {
        canon::canonical(&self.state)
    }

    fn check_only(&self, participant: &str, only: &Option<Id>) -> Result<(), ProtocolError> {
        if let Some(o) = only {
            let p = &self.state.participants[participant];
            let ok = if o == SELF { p.kind == ParticipantKind::Person } else { self.state.positions.contains_key(o) };
            if !ok {
                return perr(format!("{participant} has no capacity {o}"));
            }
        }
        Ok(())
    }

    /// Validate a command without applying it. A command that fails here is
    /// rejected before it reaches the log.
    pub fn precheck(&self, cmd: &Command) -> Result<(), ProtocolError> {
        let body = serde_json::to_value(cmd).map_err(|e| ProtocolError(e.to_string()))?;
        self.precheck_as(cmd, &body)
    }

    /// `precheck`, for a caller that has the command's JSON (`serde_json::to_value` of it) already.
    pub fn precheck_as(&self, cmd: &Command, body: &Value) -> Result<(), ProtocolError> {
        canon::check_integers(body).map_err(|e| ProtocolError(e.to_string()))?;
        crate::contracts::check(&crate::contracts::contracts().command(), body).map_err(|e| ProtocolError(format!("command {e}")))?;
        self.precheck_in_world(cmd)
    }

    /// The part of `precheck` that asks the world (does the participant exist, is the time ahead...), for a command
    /// whose shape is known to keep to the contract.
    pub fn precheck_in_world(&self, cmd: &Command) -> Result<(), ProtocolError> {
        let exists = |p: &str| if self.state.participants.contains_key(p) { Ok(()) } else { perr(format!("unknown participant {p}")) };
        match cmd {
            Command::Act { participant, position, thinking, .. } => {
                exists(participant)?;
                if position.is_none() && self.state.participants[participant].kind == ParticipantKind::System {
                    return perr(format!("{participant} is a system: it acts only in a position"));
                }
                if thinking.is_some_and(|x| x < 0) {
                    return perr("thinking time can't be negative");
                }
            }
            Command::Observe { participant, only } => {
                exists(participant)?;
                self.check_only(participant, only)?;
            }
            Command::Look { participant, only, looks } => {
                exists(participant)?;
                self.check_only(participant, only)?;
                if looks.is_empty() || looks.len() > 16 {
                    return perr("a look names 1..=16 channels");
                }
                for l in looks {
                    // A channel of a position it no longer holds is simply not there to look through.
                    let ch = match l.channel.split_once('/') {
                        None => self.state.participants[participant].def.channels.iter().find(|c| c.id == l.channel),
                        Some((pos, id)) => self.state.positions.get(pos).and_then(|x| x.channels.iter().find(|c| c.id == id)),
                    };
                    let Some(ch) = ch else { return perr(format!("{participant} has no channel {}", l.channel)) };
                    // Each way of knowing is looked through its own way (docs/design/knowing.md): a register is asked
                    // about one named thing, a board read a few at a time, a directory looked up, a place gone to.
                    use crate::config::{ChannelKind as K, CmpOp, Way};
                    match (&ch.kind, &l.who) {
                        (K::Directory { way }, who) => {
                            if *way == Way::Ask && who.is_none() {
                                return perr(format!("channel {}: say whom you are looking up (`who`): nobody is shown the directory", l.channel));
                            }
                            if who.as_ref().is_some_and(|w| !w.well_formed()) {
                                return perr("a look-up names one entity (with or without a role), one participant, one position, or a name");
                            }
                        }
                        (_, Some(_)) => return perr(format!("channel {} isn't a directory, so nobody can be looked up in it", l.channel)),
                        _ => {}
                    }
                    match (&ch.kind, &l.visit) {
                        (K::Sites { way: Way::Visit, .. }, Some(v)) => {
                            if v.places.is_empty() || v.places.len() > 16 {
                                return perr("a visit goes to 1..=16 places");
                            }
                            // (Somewhere to go: a place named that is not there, a building since brought down, is passed
                            // by, and found missing by whoever went. Nowhere to go at all is no visit.)
                            if v.places.iter().all(|p| crate::sites::place_cells(&self.state, p).is_none()) {
                                return perr(format!("no building or cell to go to among {}", v.places.join(", ")));
                            }
                        }
                        (K::Sites { way: Way::Visit, .. }, None) => return perr(format!("channel {}: say where to go (`visit`): it shows nothing until someone goes", l.channel)),
                        (_, Some(_)) => return perr(format!("channel {} isn't one of places gone to", l.channel)),
                        _ => {}
                    }
                    if let K::Records { way, filter, of, by, .. } = &ch.kind {
                        let named = |fields: &[String]| l.query.as_ref().and_then(|q| q.conditions.as_ref()).and_then(|cs| cs.iter().find(|c| c.op == CmpOp::Eq && fields.contains(&c.field))).map(|c| c.field.clone());
                        match way {
                            Way::Ask => {
                                let by = by.as_deref().unwrap_or(&[]);
                                let Some(field) = named(by) else {
                                    return perr(format!("channel {}: a keeper answers a question about one thing: name it by {}", l.channel, by.join(" or ")));
                                };
                                let _ = (of, filter, field); // (how many it gives in one answer is the keeper's: perception cuts the answer to it)
                            }
                            Way::Published => {
                                if self.s.config.knowing.board_most(filter).is_some() && l.query.is_none() {
                                    return perr(format!("channel {}: a board is read by searching it, a few at a time", l.channel));
                                }
                            }
                            _ => {}
                        }
                    }
                    if let Some(q) = &l.query {
                        if !matches!(ch.kind, crate::config::ChannelKind::Records { .. }) {
                            return perr(format!("channel {} isn't a records channel, so it can't be searched", l.channel));
                        }
                        if q.limit.is_some_and(|n| n == 0 || n > 200) {
                            return perr("a search's limit is 1..=200");
                        }
                        for f in q.conditions.iter().flatten().map(|c| &c.field).chain(q.order.iter().map(|o| &o.field)) {
                            if !known_field(f) {
                                return perr(format!("{f} isn't a field a search can use"));
                            }
                        }
                    }
                }
            }
            Command::Advance { to } | Command::AdvanceToNews { to } => {
                if *to < self.state.t {
                    return perr(format!("cannot advance to {to}: the clock is at {}", self.state.t));
                }
                if *to > self.s.run_end() {
                    return perr(format!("{to} is beyond the end of the run ({})", self.s.run_end()));
                }
            }
            Command::OptOut { participant, .. } => {
                exists(participant)?;
                if self.state.participants[participant].status != ParticipantStatus::Active {
                    return perr(format!("{participant} has already left or ended"));
                }
            }
            Command::EntityRecord { participant, entity, set, .. } => {
                exists(participant)?;
                let (entity, _) = self.record_target(participant, entity.as_deref())?;
                if set.is_empty() {
                    return perr("a record is set with at least one section");
                }
                let merged = self.merged_record(&entity, set);
                if merged.len() > crate::state::ENTITY_RECORD_SECTIONS {
                    return perr(format!("a record has at most {} sections", crate::state::ENTITY_RECORD_SECTIONS));
                }
                let most = self.s.config.caps.entity_record_bytes.unwrap_or(crate::state::ENTITY_RECORD_BYTES);
                let size = canon::canonical(&merged).map_err(|e| ProtocolError(e.to_string()))?.len() as u64;
                if size > most {
                    return perr(format!("{entity}'s record would hold {size} bytes: a record holds at most {most} and never grows past it"));
                }
            }
        }
        Ok(())
    }

    pub fn apply(&mut self, cmd: &Command) -> Result<Output, ProtocolError> {
        self.precheck(cmd)?;
        self.apply_prechecked(cmd)
    }

    /// `apply`, for a caller that has just prechecked this command against the world as it is (nothing done since).
    pub fn apply_prechecked(&mut self, cmd: &Command) -> Result<Output, ProtocolError> {
        Ok(match cmd {
            Command::Act { participant, position, blocks, by, thinking, .. } => self.begin(participant, position.as_deref(), blocks, by, thinking.unwrap_or(0), None),
            Command::Advance { to } => self.advance(*to, false),
            Command::AdvanceToNews { to } => self.advance(*to, true),
            // (What a participant perceives is perception's to build, read-only; the engine then has the world deliver it.)
            Command::Observe { .. } | Command::Look { .. } => return perr("observing is the engine's: perception builds it, and the world delivers it"),
            Command::EntityRecord { participant, entity, set, because } => {
                let t = self.state.t;
                let (entity, keeper) = self.record_target(participant, entity.as_deref())?;
                let sections = self.merged_record(&entity, set);
                let before = self.state.entity_records.get(&entity);
                let (n, prev) = before.map_or((1, String::new()), |r| (r.n + 1, r.chain.clone()));
                // The chain: this change (when, what was set, why) over the chain before it.
                let change = serde_json::json!({ "t": t, "set": set, "because": because });
                let mut link = prev.into_bytes();
                link.extend_from_slice(&canon::canonical(&change).map_err(|e| ProtocolError(e.to_string()))?);
                let chain = canon::hash_with_domain(canon::DOMAIN_ENTITY_RECORD, &link);
                let digest = canon::hash_with_domain(canon::DOMAIN_ENTITY_RECORD, &canon::canonical(&sections).map_err(|e| ProtocolError(e.to_string()))?);
                let changed = self.state.stamp();
                self.state.entity_records.insert(entity, Arc::new(crate::state::EntityRecord { n, at: t, chain: chain.clone(), sections, changed }));
                Output { events: vec![Timed::new(t, EventBody::EntityRecorded { entity, n, chain, digest, keeper: Some(keeper) })] }
            }
            Command::OptOut { participant, statement } => {
                let t = self.state.t;
                let c = self.state.stamp();
                let p = Arc::make_mut(self.state.participants.get_mut(participant).unwrap());
                p.status = ParticipantStatus::OptedOut;
                p.status_changed = c;
                let vacant = p.def.vacant_after_opt_out();
                let mut events = vec![Timed::new(t, EventBody::ParticipantOptedOut { participant: *participant, statement: statement.clone() })];
                // Without a stand-in, nobody is there to act in its positions any more.
                if vacant {
                    let held: Vec<Id> = self.state.held_by(participant).into_iter().cloned().collect();
                    for id in held {
                        let c = self.state.stamp();
                        self.state.set_holder(&id, None, c);
                        events.push(Timed::new(t, EventBody::Appointed { position: id, holder: None, by: None }));
                    }
                }
                Output { events }
            }
        })
    }

    /// The entity whose record this command sets, and who keeps it under the config. Refused (a protocol error,
    /// never logged) unless the entity has a keeper named, and the participant is it (its own person) or now holds
    /// the post that keeps an organisation's.
    fn record_target(&self, participant: &str, named: Option<&str>) -> Result<(Id, String), ProtocolError> {
        let p = &self.state.participants[participant];
        match named {
            None => {
                let Some(entity) = p.person.as_ref() else { return perr(format!("{participant} is not a person: it has no record of its own")) };
                let named = self.s.participant_at.get(participant).and_then(|i| self.s.config.participants[*i].record_keeper.as_deref());
                debug_assert_eq!(named, self.s.config.participants.iter().find(|x| x.id == participant).and_then(|x| x.record_keeper.as_deref()));
                let coded = (p.def.controller.get("type").and_then(|x| x.as_str()) == Some("code")).then(|| p.def.controller.get("impl").and_then(|x| x.as_str())).flatten();
                match named.or(coded) {
                    Some(k) => Ok((*entity, k.to_string())),
                    None => perr(format!("{entity} has no bookkeeping named for its record: nothing can set it")),
                }
            }
            Some(org) => {
                if p.person.as_deref() == Some(org) {
                    return self.record_target(participant, None);
                }
                if !self.state.entities.contains_key(org) {
                    return perr(format!("unknown entity {org}"));
                }
                if self.state.entities[org].kind == crate::config::PERSON {
                    return perr(format!("{org} is a person: only its own participant's bookkeeping sets a person's record"));
                }
                let keeping = self.s.record_keeping_at.get(org).map(|i| &self.s.config.positions[*i]);
                debug_assert_eq!(keeping.map(|x| &x.id), self.s.config.positions.iter().find(|x| x.entity == org && x.keeps_record).map(|x| &x.id));
                let Some(keeping) = keeping else {
                    // An organisation founded in a run: the one post of it whose role module says it keeps the
                    // organisation's record (`role_module.keeps_record`, with its `code`), held now by this participant.
                    let mut made = self.state.positions.values().filter(|x| x.entity == org && x.role_module.as_ref().and_then(|m| m.get("keeps_record")).and_then(Value::as_bool) == Some(true));
                    let (Some(pos), None) = (made.next(), made.next()) else { return perr(format!("{org} has no bookkeeping named for its record: nothing can set it")) };
                    let Some(keeper) = pos.role_module.as_ref().and_then(|m| m.get("code")).and_then(Value::as_str) else { return perr(format!("{org} has no bookkeeping named for its record: nothing can set it")) };
                    if pos.holder.as_deref() != Some(participant) {
                        return perr(format!("{participant} does not hold the post that keeps the record of {org}"));
                    }
                    return Ok((org.to_string().into(), keeper.to_string()));
                };
                let Some(keeper) = keeping.record_keeper_name() else { return perr(format!("{org} has no bookkeeping named for its record: nothing can set it")) };
                let holds = self.state.positions.get(&keeping.id).is_some_and(|x| x.holder.as_deref() == Some(participant));
                if !holds {
                    return perr(format!("{participant} does not hold the post that keeps the record of {org}"));
                }
                Ok((org.to_string().into(), keeper.to_string()))
            }
        }
    }

    /// An entity's record with these sections set: those given in place of those of the same name, the rest as they stand.
    fn merged_record(&self, entity: &str, set: &BTreeMap<String, Value>) -> BTreeMap<Id, crate::blocks::Frozen> {
        let mut sections = self.state.entity_records.get(entity).map(|r| r.sections.clone()).unwrap_or_default();
        for (k, v) in set {
            sections.insert(Id::new(k), crate::blocks::Frozen::of(v));
        }
        sections
    }

    /// A performer whose working day (`catalogue.working_day`) has no room for this share of work on that day: the hours
    /// are counted on the person's own timeline, where the work is placed.
    /// (Said as the refusal has always said it, which is what a participant reads the hours left from.)
    fn over_the_day(&self, shares: &BTreeMap<Id, i64>, start: i64) -> Option<String> {
        let day = self.s.config.catalogue.working_day?;
        shares.iter().find_map(|(p, share)| {
            // (A working day is a body's: a system in service does not tire.)
            if self.state.participants.get(p).is_some_and(|x| x.kind == ParticipantKind::System) {
                return None;
            }
            // (Work that runs past midnight is counted on each day it is done on.)
            day_portions(start, *share).into_iter().find_map(|(d, take)| {
                let used = self.state.timelines.get(p).map_or(0, |tl| tl.worked_on(d));
                (used + take > day).then(|| format!("{p} has {} s of work left today; this needs {share}", (day - used).max(0)))
            })
        })
    }

    /// The hours a timeline's lanes work in: a system's, its template's (law 10, foundations-2 P1); a person's, none (their
    /// working day is counted where their work is placed, `over_the_day`).
    fn lane_hours(&self, who: &str) -> Option<oikos_time::Hours> {
        lane_hours(&self.s, &self.state, who)
    }

    /// Who is where, for each work in an act that is on a person or a space (literal ids only): kept with the act, which
    /// takes effect hours later.
    fn seen_at_order(&self, blocks: &[Block]) -> BTreeMap<Id, Vec<Id>> {
        let mut out = BTreeMap::new();
        for b in blocks {
            let Block::Work { at, on: Some(on), performers, .. } = b else { continue };
            if at.starts_with('$') || on.starts_with('$') {
                continue;
            }
            let Some(m) = self.state.occupancy.get(at.as_str()) else { continue };
            if self.state.body(on).is_some() {
                if m.values().any(|bodies| bodies.contains(on.as_str())) {
                    out.insert(Id::new(on), vec![Id::new(on)]);
                }
            } else if let Some(bodies) = m.get(on.as_str()) {
                out.insert(Id::new(on), bodies.iter().filter(|x| !performers.iter().any(|p| *x== p)).cloned().collect());
            }
        }
        out
    }

    /// Dry run: would physics allow this action right now?
    pub fn check(&self, participant: &str, position: Option<&str>, blocks: &[Block]) -> Result<Check, ProtocolError> {
        if !self.state.participants.contains_key(participant) {
            return perr(format!("unknown participant {participant}"));
        }
        if blocks.is_empty() || blocks.len() > 32 {
            return perr("an action has 1..=32 blocks");
        }
        // (An act nobody priced for its actor is refused, as it would be when done: law 10, foundations-2 P2.)
        let p = &self.state.participants[participant];
        let (actor, template) = match p.kind {
            ParticipantKind::Person => (oikos_time::Actor::Person, None),
            ParticipantKind::System => (oikos_time::Actor::System, p.template.as_deref()),
        };
        if let Err(k) = self.s.act_times.program(actor, template, blocks.iter().map(|b| (b.name(), b.makes()))) {
            return Ok(Check { ok: false, refusal: Some(refusal_info(&refuse(RefusalCode::Unpriced, format!("nobody priced {k} for {participant}")))) });
        }
        let mut scratch = self.state.clone();
        Ok(match exec_action(&self.s, &mut scratch, participant, position, blocks, &[]) {
            Ok(res) => match self.over_the_day(&work_shares(&res.events), self.state.t) {
                Some(d) => Check { ok: false, refusal: Some(refusal_info(&refuse(RefusalCode::NoTimeLeft, d))) },
                None => Check { ok: true, refusal: None },
            },
            Err(r) => Check { ok: false, refusal: Some(refusal_info(&r)) },
        })
    }

    /// An act begun: its actor is busy with it for the time it takes (the world's `act_time`), after any thinking, and
    /// it takes effect when done (docs/design/rebuild.md 6.2, 6.3).
    fn begin(&mut self, participant: &str, position: Option<&str>, blocks: &[Block], by: &[Id], thinking: i64, again: Option<crate::blocks::Passing>) -> Output {
        let action = again.clone().unwrap_or_else(|| self.state.mint_passing("act"));
        let t = self.state.t;
        let p = &self.state.participants[participant];
        let (actor, key, lanes) = match p.kind {
            ParticipantKind::Person => (oikos_time::Actor::Person, p.person.unwrap_or_else(|| participant.into()), 1),
            ParticipantKind::System => (oikos_time::Actor::System, Id::new(participant), p.def.lanes.unwrap_or(1) as usize),
        };
        // (Going somewhere takes the trip: the longest of the act's moves, from where each body is to the building it's
        // going to. Literal ids only: a body or space made in the act itself is going nowhere yet.)
        let trip = blocks
            .iter()
            .filter_map(|b| match b {
                Block::Occupy { space, who } if !space.starts_with('$') && !who.as_deref().is_some_and(|w| w.starts_with('$')) => {
                    let body = who.clone().or_else(|| p.person.map(|x| x.to_string()))?;
                    let (to, _) = crate::config::split_space(space)?;
                    let from = self.state.structures_of(&body).into_iter().next()?;
                    Some(crate::travel::seconds(&self.s, &self.state, &from, to))
                }
                _ => None,
            })
            .max()
            .unwrap_or(0);
        // (A system's own rows first, from its template; then the world's table for its kind; then a default the world
        // states. Nobody's: the act is refused, `unpriced`.)
        let template_of = |state: &State, w: &str| state.participants.get(w).filter(|x| x.kind == ParticipantKind::System).and_then(|x| x.template);
        let own_program = self.s.act_times.program(actor, template_of(&self.state, participant).as_deref(), blocks.iter().map(|b| (b.name(), b.makes())));
        let seconds = own_program.clone().unwrap_or(0) + trip;
        let ready = t + thinking;
        // Who else does the act's work (F3): the action's `by`, a person other than the actor. The act's own time is theirs,
        // shared (the actor, if it is among them, takes a share; if not, only the second of ordering it).
        // (Someone the actor may not direct is refused when the act is done, and is charged nothing for it.)
        let entity = position.and_then(|x| self.state.positions.get(x)).map(|x| x.entity).or_else(|| p.person);
        let others: Vec<Id> = by
            .iter()
            .filter(|w| **w != key && *w != participant)
            .filter(|w| self.state.participants.get(*w).is_some_and(|x| x.kind == ParticipantKind::System && x.owner.as_deref() == entity.as_deref()) || entity.as_deref().is_some_and(|e| crate::exec::may_direct(&self.state, e, w)))
            .cloned()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        // Each performer is charged their own time for the work: a person by the person's row, a system by its template's
        // (the world's table is by who does it), shared among those who do it.
        let kind_of = |state: &State, w: &str| if state.participants.get(w).is_some_and(|x| x.kind == ParticipantKind::System) { oikos_time::Actor::System } else { oikos_time::Actor::Person };
        let program_of = |state: &State, w: &str| self.s.act_times.program(kind_of(state, w), template_of(state, w).as_deref(), blocks.iter().map(|b| (b.name(), b.makes())));
        let actor_in = by.iter().any(|w| *w == key || w == participant);
        // (An act nobody priced for whoever is to do it: nobody's time is taken, and it is refused when due, now.)
        let unpriced = if others.is_empty() || actor_in { own_program.as_ref().err().map(|k| (Id::new(participant), k.clone())) } else { None }
            .or_else(|| others.iter().find_map(|w| program_of(&self.state, w).err().map(|k| (*w, k))))
            .map(|(who, k)| {
                let what = if kind_of(&self.state, &who) == oikos_time::Actor::System { "a system" } else { "a person" };
                format!("nobody priced {k} for {who}: the world's table of work has no row for it for {what}{}, and states no default", if what == "a system" { " and its template none" } else { "" })
            });
        if let Some(why) = unpriced {
            let pos = position.map(String::from);
            let placed = crate::state::Placed { unpriced: Some(why), day: crate::exec::day_of(ready), ..Default::default() };
            self.state.schedule(ready, crate::state::Sched::Act { action: action.clone(), participant: participant.into(), position: pos.clone().map(Into::into), blocks: blocks.to_vec(), by: by.to_vec(), placed });
            return Output { events: vec![Timed::new(t, EventBody::ActionStarted { action, participant: participant.into(), position: pos.map(Into::into), starts: ready, done: ready, free: None })] };
        }
        let seconds_of = |state: &State, w: &str| program_of(state, w).unwrap_or(0) + trip;
        let n = others.len() as i64 + i64::from(actor_in);
        let by_shares: Vec<(Id, i64)> = others.iter().map(|w| (*w, (seconds_of(&self.state, w) + n - 1) / n)).collect();
        let only_orders = !others.is_empty() && !actor_in;
        let actor_seconds = if others.is_empty() {
            seconds
        } else if actor_in {
            (seconds + n - 1) / n
        } else {
            oikos_time::ORDER_SECONDS
        };
        // One time account per person (docs/design/foundations.md law 1; F1): the hours of a `work` are the time of
        // those who do it, placed on their timelines like any act's time. The act starts when its actor and every one
        // of its performers are free, and is done when the last of them is. (What the work would be is read from a dry
        // run of the act as the world stands; if it would be refused, nobody's time is taken for it.)
        let mut shares: BTreeMap<Id, i64> = BTreeMap::new();
        let mut refused_to_place: Option<String> = None;
        let mut late = false; // work the world could not yet show would be done (someone not there until the act is): placed when it takes effect
        if !others.is_empty() || blocks.iter().any(|b| matches!(b, Block::Work { .. })) {
            let mut scratch = self.state.clone();
            if let Ok(res) = exec_action(&self.s, &mut scratch, participant, position, blocks, by) {
                shares = work_shares(&res.events);
            } else {
                late = again.is_none();
                // (An act begun again for its hours, and no longer to be done: it is refused when due, not done unpaid.)
                if again.is_some() {
                    refused_to_place = Some(format!("{participant}'s work could not be placed on its performers' time"));
                }
            }
        }
        for (w, share) in &by_shares {
            *shares.entry(*w).or_insert(0) += share;
        }
        // (A system's lanes work within its template's hours, law 10: it is free for this from the next moment of work.)
        let free_from = |tl: Option<&crate::state::Timeline>, (lanes, hours): (usize, Option<oikos_time::Hours>)| -> i64 {
            let mut lanes_now = tl.map(|x| x.lanes.clone()).unwrap_or_default();
            oikos_time::place_within(&mut lanes_now, lanes, ready, 0, hours).0
        };
        let own_lanes = (lanes, self.lane_hours(&key));
        let actor_free = free_from(self.state.timelines.get(&key), own_lanes);
        let mut start = actor_free;
        // (A system that does another's work takes it on as many lanes as it has.)
        let lanes_of = |me: &Self, p: &str| (me.state.participants.get(p).filter(|x| x.kind == ParticipantKind::System).map_or(1, |x| x.def.lanes.unwrap_or(1) as usize), me.lane_hours(p));
        for p in shares.keys().filter(|p| **p != key) {
            start = start.max(free_from(self.state.timelines.get(p), lanes_of(self, p)));
        }
        // A performer's working day: what is already placed on it, and this act's share, within the day's hours.
        let mut start = start;
        let mut day_idx = crate::exec::day_of(start);
        let mut over = self.over_the_day(&shares, start).or(refused_to_place);
        if over.is_some() {
            // (No room in their day: the act is refused, and its actor hears so now, not when the crew would have been free.)
            shares.clear();
            start = actor_free;
            day_idx = crate::exec::day_of(start);
            over = over.take();
        }
        // (Who is to be at work when the work begins, looked at then if that is later than now.)
        let checks: Vec<crate::state::WorkCheck> = if late || over.is_some() || start <= t {
            vec![]
        } else {
            let mut v: Vec<crate::state::WorkCheck> = vec![];
            for b in blocks {
                if let Block::Work { task, at, performers, .. } = b {
                    if at.starts_with('$') || performers.iter().any(|x| x.starts_with('$')) {
                        continue;
                    }
                    let space = self.s.config.catalogue.tasks.iter().find(|x| x.id == *task).and_then(|x| x.in_space.clone());
                    v.extend(performers.iter().map(|w| crate::state::WorkCheck { who: w.clone().into(), at: Some(at.clone().into()), space: space.clone() }));
                }
            }
            v.extend(others.iter().map(|w| crate::state::WorkCheck { who: *w, at: None, space: None }));
            v
        };
        let placed = crate::state::Placed { over, day: day_idx, from: start, hours: shares.clone(), seen: self.seen_at_order(blocks), late, unpriced: None };
        let mut done = start;
        let place = |state: &mut State, who: &Id, (lanes, hours): (usize, Option<oikos_time::Hours>), from: i64, secs: i64, work: i64| {
            let mut tl = state.timelines.get(who).cloned().unwrap_or_default();
            let (_, d) = oikos_time::place_within(&mut tl.lanes, lanes, from, secs, hours);
            for (d, take) in day_portions(from, work) {
                if take > 0 {
                    tl.add_worked(d, take);
                }
            }
            state.timelines.insert(*who, tl);
            d
        };
        let own = shares.get(&key).copied().unwrap_or(0);
        // (Someone who only orders it gives the order when they are free, and goes on: the act waits for those who do it,
        // not for the one who asked. Until foundations-2 P1 the order was held on the actor's lane until the work began, so a
        // case system that asked its officers to decide a claim could pay nobody until they had.)
        let order_from = if only_orders && own == 0 { actor_free } else { start };
        let own_done = place(&mut self.state, &key, own_lanes, order_from, actor_seconds + own, own);
        done = done.max(own_done);
        for (p, share) in shares.iter().filter(|(p, _)| **p != key) {
            let l = lanes_of(self, p);
            done = done.max(place(&mut self.state, p, l, start, *share, *share));
        }
        let starts = start;
        let free = (own_done < done).then_some(own_done);
        let pos = position.map(String::from);
        let seq = self.state.schedule(done, crate::state::Sched::Act { action: action.clone(), participant: participant.into(), position: pos.clone().map(Into::into), blocks: blocks.to_vec(), by: by.to_vec(), placed: placed.clone() });
        if !checks.is_empty() {
            self.state.schedule(start, crate::state::Sched::Start { action: action.clone(), participant: participant.into(), position: pos.clone().map(Into::into), done, seq, checks, placed });
        }
        Output { events: vec![Timed::new(t, EventBody::ActionStarted { action, participant: participant.into(), position: pos.map(Into::into), starts, done, free })] }
    }

    /// An act done: applied now, as a whole (or refused), and its outcome delivered at the actor's next observation.
    fn act(&mut self, action: crate::blocks::Passing, participant: &str, position: Option<&str>, blocks: &[Block], by: &[Id], placed: crate::state::Placed) -> Output {
        let t = self.state.t;
        // Work the dry run could not place when the act began (a performer or an input not there until it was): its hours are
        // the performers' time, and its effect never comes before them. Now that it can be done, it is begun again, from now: the
        // hours are placed and it takes effect when they are over. (law 2: "the act is done when they are")
        if placed.late && placed.over.is_none() && can_act(&self.state.participants[participant]) {
            let mut scratch = self.state.clone();
            if let Ok(res) = crate::exec::exec_action_seen(&self.s, &mut scratch, participant, position, blocks, by, Some(&placed.seen), false) {
                if !work_shares(&res.events).is_empty() || !by.is_empty() {
                    return self.begin(participant, position, blocks, by, 0, Some(action));
                }
            }
        }
        let mut late_shares: BTreeMap<Id, i64> = BTreeMap::new();
        let result = if !can_act(&self.state.participants[participant]) {
            Err(crate::exec::inactive_refusal(&self.state, participant, position))
        } else if let Some(d) = placed.unpriced.clone() {
            Err(refuse(RefusalCode::Unpriced, d))
        } else if let Some(d) = placed.over.clone() {
            let i = blocks.iter().position(|b| matches!(b, Block::Work { .. }));
            Err(Refusal { block: i, ..refuse(RefusalCode::NoTimeLeft, d) })
        } else {
            let mut scratch = self.state.clone();
            let done = crate::exec::exec_action_seen(&self.s, &mut scratch, participant, position, blocks, by, Some(&placed.seen), !placed.late).map(|res| (scratch, res));
            match done {
                // (Work the dry run could not place when the act began is placed now: the hours are counted on the day, and
                // are the performers' from now. Nobody does more than a day's work for having been asked in a way that
                // could not be checked.)
                Ok((scratch, res)) if placed.late => {
                    late_shares = work_shares(&res.events);
                    match self.over_the_day(&late_shares, t) {
                        Some(d) => {
                            late_shares.clear();
                            Err(Refusal { block: blocks.iter().position(|b| matches!(b, Block::Work { .. })), ..refuse(RefusalCode::NoTimeLeft, d) })
                        }
                        None => Ok((scratch, res)),
                    }
                }
                other => other,
            }
        };
        // (Work refused when it is done was begun, and its performers' lanes were held until now: the hours were spent, and count
        // against the day. Only work that never began gives its hours back: `start_check`.)
        let pos = position.map(String::from);
        let (events, outcome) = match result {
            Ok((scratch, res)) => {
                self.state = scratch;
                for (who, secs) in &late_shares {
                    let mut tl = self.state.timelines.get(who).cloned().unwrap_or_default();
                    oikos_time::place_within(&mut tl.lanes, 1, t, *secs, self.lane_hours(who));
                    for (d, take) in day_portions(t, *secs) {
                        tl.add_worked(d, take);
                    }
                    self.state.timelines.insert(*who, tl);
                }
                let created = (!res.created.is_empty()).then_some(res.created);
                // Who did it: whom the action named, else those a work named, else the actor itself.
                let applied_by: Vec<Id> = if !by.is_empty() {
                    by.to_vec()
                } else {
                    let mut v: Vec<Id> = vec![];
                    for e in &res.events {
                        if let EventBody::Worked { performers, .. } = &e.event.body {
                            for p in performers {
                                if !v.contains(p) {
                                    v.push(*p);
                                }
                            }
                        }
                    }
                    if v.is_empty() {
                        v.push(participant.into());
                    }
                    v
                };
                let mut events = vec![Timed::new(t, EventBody::ActionApplied { action: action.clone(), participant: participant.into(), position: pos.clone().map(Into::into), by: applied_by, created: created.clone() })];
                events.extend(res.events);
                (events, Outcome { action, t, status: OutcomeStatus::Applied, created, refusal: None, surveyed: res.surveyed, investigated: res.investigated, seen: res.seen })
            }
            Err(r) => (
                vec![Timed::new(
                    t,
                    EventBody::ActionRefused { action: action.clone(), participant: participant.into(), position: pos.clone().map(Into::into), block: r.block, code: r.code, detail: r.detail.clone() },
                )],
                Outcome { action, t, status: OutcomeStatus::Refused, created: None, refusal: Some(refusal_info(&r)), surveyed: None, investigated: None, seen: vec![] },
            ),
        };
        let key = pos.unwrap_or_else(|| SELF.into());
        Arc::make_mut(self.state.participants.get_mut(participant).unwrap()).pending.entry(key).or_default().outcomes.push(outcome);
        Output { events }
    }

    /// Hours placed for work that was not done: they were not worked, so they do not count against the day.
    fn give_back(&mut self, placed: &crate::state::Placed) {
        for (who, secs) in &placed.hours {
            if let Some(tl) = self.state.timelines.get_mut(who) {
                let from = if placed.from != 0 { placed.from } else { placed.day * 86_400 };
                for (d, take) in day_portions(from, *secs) {
                    tl.add_worked(d, -take);
                }
            }
        }
    }

    /// The work of an act begins (it queued behind its performers' other time): those who are to do it are looked at
    /// now. If one is not at work, the act is refused now: nobody's time is kept for it, and it is not applied later
    /// (foundations F3; F1 had found that the check at the end refuses work its performers had begun).
    #[allow(clippy::too_many_arguments)]
    fn start_check(&mut self, action: crate::blocks::Passing, participant: &str, position: Option<&str>, done: i64, seq: u64, checks: &[crate::state::WorkCheck], placed: &crate::state::Placed) -> Output {
        let t = self.state.t;
        let failed = checks.iter().find_map(|c| crate::exec::check_at_work(&self.s, &self.state, &c.who, c.at.as_deref(), c.space.as_deref()).err());
        let Some(r) = failed else { return Output::default() };
        self.state.schedule.remove(done, seq);
        self.give_back(placed);
        // (Their time, placed to the end of the work, is given back from now.)
        let actor_key = self.state.participants[participant].person.unwrap_or_else(|| participant.into());
        for k in placed.hours.keys().chain(std::iter::once(&actor_key)) {
            if let Some(tl) = self.state.timelines.get_mut(k) {
                for lane in tl.lanes.iter_mut().filter(|l| **l == done) {
                    *lane = t;
                }
            }
        }
        let pos = position.map(String::from);
        let ev = Timed::new(t, EventBody::ActionRefused { action: action.clone(), participant: participant.into(), position: pos.clone().map(Into::into), block: None, code: r.code, detail: r.detail.clone() });
        let out = Outcome { action, t, status: OutcomeStatus::Refused, created: None, refusal: Some(refusal_info(&r)), surveyed: None, investigated: None, seen: vec![] };
        Arc::make_mut(self.state.participants.get_mut(participant).unwrap()).pending.entry(pos.unwrap_or_else(|| SELF.into())).or_default().outcomes.push(out);
        Output { events: vec![ev] }
    }

    fn advance(&mut self, to: i64, stop_at_body_news: bool) -> Output {
        let mut events = vec![];
        // (The moment body news came at, in an advance that stops there: what is scheduled for that moment is still done.)
        let mut news_at: Option<i64> = None;
        while self.state.schedule.first().is_some_and(|x| x.at <= to) {
            if news_at.is_some_and(|n| self.state.schedule.first().is_some_and(|x| x.at > n)) {
                return Output { events };
            }
            let item = self.state.schedule.pop_first().unwrap();
            self.state.t = item.at;
            let from = events.len();
            match item.what {
                crate::state::Sched::Act { action, participant, position, blocks, by, placed } => events.extend(self.act(action, &participant, position.as_deref(), &blocks, &by, placed).events),
                crate::state::Sched::Start { action, participant, position, done, seq, checks, placed } => events.extend(self.start_check(action, &participant, position.as_deref(), done, seq, &checks, &placed).events),
                crate::state::Sched::HeldAsks => events.extend(self.take_up_held()),
                _ => events.extend(scheduled(&self.s, &mut self.state, item)),
            }
            if stop_at_body_news && news_at.is_none() && events[from..].iter().any(|e| is_body_news(&e.event.body)) {
                news_at = Some(self.state.t);
            }
        }
        if let Some(n) = news_at {
            self.state.t = n;
            return Output { events };
        }
        self.state.t = to;
        Output { events }
    }

    /// The full picture a participant's channels cover right now; changes nothing.
    /// A participant has been given its observation (perception built it, read-only): what it looked through is marked
    /// seen, the transactions it was shown are drained, and the outcomes and messages waiting for it in the capacities
    /// observed are handed over, in order.
    pub fn deliver(&mut self, participant: &str, only: Option<&str>, looks: Vec<(Id, crate::state::Look)>, drained: Vec<Id>) -> (Vec<Outcome>, Vec<crate::state::Message>, Vec<crate::sites::Visited>) {
        let p = Arc::make_mut(self.state.participants.get_mut(participant).expect("a participant perceived"));
        for (id, look) in looks {
            p.looks.insert(id, look);
        }
        for e in drained {
            p.new_transactions.remove(&e);
        }
        let mut outcomes = vec![];
        let mut inbox = vec![];
        let mut visits = vec![];
        let keys: Vec<Id> = p.pending.keys().filter(|k| only.is_none_or(|o| o == k.as_str())).cloned().map(Into::into).collect();
        for k in keys {
            if let Some(mut x) = p.pending.remove(k.as_str()) {
                outcomes.append(&mut x.outcomes);
                inbox.append(&mut x.inbox);
                visits.append(&mut x.visits);
                // (A question still out, or an answer not yet looked through, stays: it is not something delivered.)
                if !x.asked.is_empty() || !x.asks.is_empty() {
                    p.pending.insert(k.to_string(), crate::state::Pending { asked: x.asked, asks: x.asks, ..Default::default() });
                }
            }
        }
        outcomes.sort_by(|a, b| (a.t, &a.action).cmp(&(b.t, &b.action)));
        inbox.sort_by(|a, b| (a.t, &a.id).cmp(&(b.t, &b.id)));
        // (In the order they ended; of two ending together, by the channel asked through.)
        visits.sort_by(|a, b| (a.as_of, &a.channel).cmp(&(b.as_of, &b.channel)));
        (outcomes, inbox, visits)
    }

    /// The visits a look asks for begin (docs/design/knowing.md, section 8): each takes its looker's time, and what
    /// it finds comes with the observation after it ends. The rest of the look is perception's.
    pub fn begin_visits(&mut self, participant: &str, looks: &[crate::config::LookRequest]) -> Vec<Timed> {
        let mut events = vec![];
        for l in looks {
            let Some(v) = &l.visit else { continue };
            let (key, channels) = match l.channel.split_once('/') {
                None => (SELF.to_string(), self.state.participants[participant].def.channels.clone()),
                Some((pos, _)) => match self.state.positions.get(pos) {
                    Some(x) => (pos.to_string(), x.channels.clone()),
                    None => continue,
                },
            };
            let id = l.channel.rsplit('/').next().unwrap_or(&l.channel);
            let Some(crate::config::ChannelKind::Sites { occupants, look_seconds, .. }) = channels.iter().find(|c| c.id == id).map(|c| c.kind.clone()) else { continue };
            let names = occupants == Some(crate::config::Occupants::Names);
            events.extend(crate::sites::begin(&self.s, &mut self.state, participant, &key, &l.channel, &channels, &v.places, names, look_seconds));
        }
        events
    }

    /// Does the world's table of work say what answering a question on this channel takes (for a person or a system)?
    fn ask_has_row(&self, id: &str) -> bool {
        [oikos_time::Actor::Person, oikos_time::Actor::System].into_iter().any(|a| self.s.act_times.row(a, &format!("answer/{id}")).or_else(|| self.s.act_times.row(a, "answer")).is_some_and(|s| s > 0))
    }

    /// The keeper's performer for a question now: of those who hold its posts and can answer, the one who is done soonest. A
    /// person must be alive, there (at work, as the world says work is done) and have room in their working day; a system in
    /// service. None: nobody is there to answer.
    fn ask_performer(&self, keeper: &str, id: &str) -> Option<(Id, i64)> {
        let t = self.state.t;
        let mut best: Option<(i64, Id, i64)> = None; // (done, performer, seconds)
        for post in self.state.positions_of.get(keeper).into_iter().flatten() {
            let Some(holder) = self.state.positions.get(post).and_then(|x| x.holder) else { continue };
            let Some(p) = self.state.participants.get(&holder) else { continue };
            if p.status != ParticipantStatus::Active {
                continue;
            }
            let (tl_key, lanes, actor) = match p.kind {
                ParticipantKind::Person => {
                    let Some(person) = p.person else { continue };
                    if crate::exec::check_at_work(&self.s, &self.state, &person, None, None).is_err() {
                        continue;
                    }
                    (person, 1, oikos_time::Actor::Person)
                }
                ParticipantKind::System => (holder, p.def.lanes.unwrap_or(1) as usize, oikos_time::Actor::System),
            };
            let seconds = self.s.act_times.row(actor, &format!("answer/{id}")).or_else(|| self.s.act_times.row(actor, "answer"));
            let Some(seconds) = seconds.filter(|s| *s > 0) else { continue };
            let mut lanes_now = self.state.timelines.get(&tl_key).map(|x| x.lanes.clone()).unwrap_or_default();
            let (start, done) = oikos_time::place_within(&mut lanes_now, lanes, t, seconds, self.lane_hours(&tl_key));
            if actor == oikos_time::Actor::Person && self.over_the_day(&BTreeMap::from([(tl_key, seconds)]), start).is_some() {
                continue; // (their working day is full: not on duty)
            }
            if best.as_ref().is_none_or(|b| (done, &holder) < (b.0, &b.1)) {
                best = Some((done, holder, seconds));
            }
        }
        best.map(|(_, h, s)| (h, s))
    }

    /// A question taken up by the keeper's performer: put on their timeline (a person's seconds count against their working day),
    /// to be answered when done.
    fn place_ask(&mut self, participant: &str, position: Option<Id>, look: &crate::config::LookRequest, keeper: Id, performer: Id, seconds: i64) -> Timed {
        let t = self.state.t;
        let p = &self.state.participants[&performer];
        let (tl_key, lanes, person) = match p.kind {
            ParticipantKind::Person => (p.person.unwrap_or(performer), 1, true),
            ParticipantKind::System => (performer, p.def.lanes.unwrap_or(1) as usize, false),
        };
        let mut timeline = self.state.timelines.get(&tl_key).cloned().unwrap_or_default();
        let hours = self.lane_hours(&tl_key);
        let (starts, done) = oikos_time::place_within(&mut timeline.lanes, lanes, t, seconds, hours);
        if person {
            for (d, take) in day_portions(starts, seconds) {
                timeline.add_worked(d, take);
            }
        }
        self.state.timelines.insert(tl_key, timeline);
        self.state.schedule(done, crate::state::Sched::Answer { participant: participant.into(), position, look: look.clone() });
        let key = position.unwrap_or_else(|| SELF.to_string().into());
        let pending = Arc::make_mut(self.state.participants.get_mut(participant).unwrap()).pending.entry(key.to_string()).or_default();
        if !pending.asked.contains(&look.channel) {
            pending.asked.push(look.channel);
        }
        Timed::new(t, EventBody::AskStarted { participant: participant.into(), position, channel: look.channel, keeper, by: performer, starts, done })
    }

    /// The questions a look puts to a register's keeper (a channel of `way: ask` whose keeper is an organisation with posts, and a
    /// row in the world's table of work for answering; foundations F11): each is answered by the keeper's performer, in the
    /// keeper's time, and its asker is given the answer with the observation after it is done. A performer must be there and on
    /// duty (a person at work with room in their day, or a system in service); if nobody is, the question is held and taken up,
    /// in the order asked, when someone is (looked at each hour). A keeper with no posts at all, or a world with no row for
    /// answering, answers at once, as before. Returns the events, and which of `looks` are put off (not answered now).
    pub fn begin_asks(&mut self, participant: &str, looks: &[crate::config::LookRequest]) -> (Vec<Timed>, Vec<bool>) {
        use crate::config::{ChannelKind as K, Way};
        let mut events = vec![];
        let mut put_off = vec![false; looks.len()];
        for (i, l) in looks.iter().enumerate() {
            let (key, id, channels) = match l.channel.split_once('/') {
                None => (SELF.to_string(), l.channel.as_str(), self.state.participants[participant].def.channels.clone()),
                Some((pos, id)) => match self.state.positions.get(pos) {
                    Some(x) => (pos.to_string(), id, x.channels.clone()),
                    None => continue,
                },
            };
            let Some(K::Records { way: Way::Ask, of: Some(keeper), .. }) = channels.iter().find(|c| c.id == id).map(|c| c.kind.clone()) else { continue };
            if !self.ask_has_row(id) || self.state.positions_of.get(&keeper).is_none_or(|p| p.is_empty()) {
                continue;
            }
            let position = (key != SELF).then(|| key.clone());
            match self.ask_performer(&keeper, id) {
                Some((performer, seconds)) => { events.push(self.place_ask(participant, position.map(Into::into), l, keeper, performer, seconds))}
                None => {
                    let first = self.state.asks_held.is_empty();
                    Arc::make_mut(&mut self.state.asks_held).push(crate::state::HeldAsk { participant: participant.into(), position: position.map(Into::into), keeper, look: l.clone() });
                    let pending = Arc::make_mut(self.state.participants.get_mut(participant).unwrap()).pending.entry(key).or_default();
                    pending.asked.push(l.channel);
                    if first {
                        self.state.schedule(self.state.t + 3_600, crate::state::Sched::HeldAsks);
                    }
                }
            }
            put_off[i] = true;
        }
        (events, put_off)
    }

    /// Held questions looked at again: each whose keeper now has someone there to answer is taken up (in the order asked).
    fn take_up_held(&mut self) -> Vec<Timed> {
        let held = std::mem::take(&mut self.state.asks_held);
        let held = Arc::try_unwrap(held).unwrap_or_else(|shared| (*shared).clone());
        let mut events = vec![];
        for h in held {
            if self.state.participants.get(&h.participant).is_none_or(|p| p.status != ParticipantStatus::Active) {
                continue;
            }
            let id = h.look.channel.rsplit('/').next().unwrap_or_default().to_string();
            match self.ask_performer(&h.keeper, &id) {
                Some((performer, seconds)) => events.push(self.place_ask(&h.participant, h.position, &h.look, h.keeper, performer, seconds)),
                None => Arc::make_mut(&mut self.state.asks_held).push(h),
            }
        }
        if !self.state.asks_held.is_empty() {
            self.state.schedule(self.state.t + 3_600, crate::state::Sched::HeldAsks);
        }
        events
    }

    /// The questions to a register's keeper that have been answered for a participant (in the capacities it would observe in),
    /// taken: they are looked through with the observation they come with.
    pub fn take_asks(&mut self, participant: &str, only: Option<&str>) -> Vec<crate::config::LookRequest> {
        let Some(p) = self.state.participants.get(participant) else { return vec![] };
        if !p.pending.iter().any(|(k, x)| only.is_none_or(|o| o == k.as_str()) && !x.asks.is_empty()) {
            return vec![];
        }
        let p = Arc::make_mut(self.state.participants.get_mut(participant).unwrap());
        let keys: Vec<Id> = p.pending.keys().filter(|k| only.is_none_or(|o| o == k.as_str())).cloned().map(Into::into).collect();
        let mut out = vec![];
        for k in keys {
            if let Some(x) = p.pending.get_mut(k.as_str()) {
                out.append(&mut x.asks);
                if x.is_empty() {
                    p.pending.remove(k.as_str());
                }
            }
        }
        out
    }

    /// The channels a participant has put a question to a keeper through that is not yet answered (in the capacities it would observe in).
    pub fn asking(st: &State, participant: &str, only: Option<&str>) -> Vec<Id> {
        let mut out: Vec<Id> = st.participants.get(participant).into_iter().flat_map(|p| p.pending.iter()).filter(|(k, _)| only.is_none_or(|o| o == k.as_str())).flat_map(|(_, x)| x.asked.iter().cloned()).collect();
        out.sort();
        out
    }

    /// The outcomes and messages waiting for a participant in the capacities it would observe in, in the order
    /// `deliver` hands them over; nothing is handed over.
    /// Is what a visit found, or the answer to a question put to a keeper (or a question still out), waiting for a participant (in the capacities it would observe in)?
    pub fn visited_waiting(st: &State, participant: &str, only: Option<&str>) -> bool {
        st.participants.get(participant).is_some_and(|p| p.pending.iter().any(|(k, x)| only.is_none_or(|o| o == k.as_str()) && (!x.visits.is_empty() || !x.asks.is_empty() || !x.asked.is_empty())))
    }

    pub fn waiting(st: &State, participant: &str, only: Option<&str>) -> (Vec<Outcome>, Vec<crate::state::Message>) {
        let mut outcomes = vec![];
        let mut inbox = vec![];
        for (_, x) in st.participants[participant].pending.iter().filter(|(k, _)| only.is_none_or(|o| o == k.as_str())) {
            outcomes.extend(x.outcomes.iter().cloned());
            inbox.extend(x.inbox.iter().cloned());
        }
        outcomes.sort_by(|a, b| (a.t, &a.action).cmp(&(b.t, &b.action)));
        inbox.sort_by(|a, b| (a.t, &a.id).cmp(&(b.t, &b.id)));
        (outcomes, inbox)
    }
}

/// A field a search may use (a look's query): the record's own, the claim a transfer or release names, or a
/// structured field in its data or `about`.
pub fn known_field(f: &str) -> bool {
    matches!(f, "id" | "record" | "kind" | "at" | "author" | "speaks_for" | "basis" | "claim" | "holder")
        || f.strip_prefix("data.").or_else(|| f.strip_prefix("about.")).is_some_and(|p| !p.is_empty() && p.split('.').all(|x| !x.is_empty()))
}

/// News the engine may wake someone for, which happens at no wake of anyone's (so an advance would carry the clock past it to the next
/// wake, and whoever it reaches would meet it then, at a moment that turns on who else happens to wake): a letter delivered, a paper
/// recorded (`News::Delivered`, `News::Recorded`), something that happened to a person's own body (a condition begun, ended or treated,
/// flooded out of where they were, or a death in the space they were in: `News::Body`), or a keeper's answer to an office's question (`News::Answered`, foundations F11).
/// An advance that stops at it has the news met when it happens, whoever wakes next; the engine goes on at once where it woke nobody.
pub fn is_body_news(b: &EventBody) -> bool {
    matches!(b, EventBody::MessageDelivered { .. } | EventBody::Recorded { .. } | EventBody::ConditionBegan { .. } | EventBody::ConditionEnded { .. } | EventBody::ConditionTreated { .. } | EventBody::Vacated { reason: VacateReason::Flooded | VacateReason::Died, .. } | EventBody::AskAnswered { position: Some(_), .. })
}

/// How a stretch of `secs` seconds run on from `start` falls on days: (day, seconds of it on that day).
/// The hours a timeline's lanes work in (the timeline's key: a system participant's id, or a person's): a system's
/// template's, else none. One look-up by id and one by template: nothing scanned.
pub(crate) fn lane_hours(s: &Statics, st: &State, who: &str) -> Option<oikos_time::Hours> {
    let p = st.participants.get(who).filter(|x| x.kind == ParticipantKind::System)?;
    s.act_times.hours(p.template.as_deref())
}

fn day_portions(start: i64, secs: i64) -> Vec<(i64, i64)> {
    let mut out = vec![];
    let (mut at, mut left) = (start, secs);
    while left > 0 {
        let day = crate::exec::day_of(at);
        let take = left.min((day + 1) * 86_400 - at);
        out.push((day, take));
        at += take;
        left -= take;
    }
    out
}

/// Each performer's hours in the work an act did (one `Worked` event each, a share a performer: the labour split
/// between them, rounded up).
fn work_shares(events: &[Timed]) -> BTreeMap<Id, i64> {
    let mut out: BTreeMap<Id, i64> = BTreeMap::new();
    for e in events {
        if let EventBody::Worked { performers, labour, .. } = &e.event.body {
            if performers.is_empty() || *labour <= 0 {
                continue;
            }
            let share = (labour + performers.len() as i64 - 1) / performers.len() as i64;
            for p in performers {
                *out.entry(*p).or_insert(0) += share;
            }
        }
    }
    out
}
