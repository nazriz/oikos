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
use crate::events::{EventBody, RefusalCode, Timed};
use crate::exec::{can_act, exec_action, refuse, schedule_birthday, scheduled, Refusal};
use crate::observe::{self, Observation};
use crate::rng::Randomness;
use crate::state::{Account, Body, Cell, Counters, Entity, Outcome, OutcomeStatus, Participant, ParticipantDef, ParticipantStatus, Position, RefusalInfo, State, Structure};
use crate::statics::Statics;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
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
        /// Logged, never interpreted.
        provenance: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
    },
    Advance {
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
    pub observation: Option<Observation>,
}

/// Result of a dry run: would physics allow this right now?
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Check {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refusal: Option<RefusalInfo>,
}

pub struct Kernel {
    s: Statics,
    state: State,
    /// Derived lookups for observations; not part of the state.
    index: observe::RecordIndex,
}

fn refusal_info(r: &Refusal) -> RefusalInfo {
    RefusalInfo { code: r.code, block: r.block, detail: r.detail.clone() }
}

impl Kernel {
    pub fn new(loaded: &LoadedConfig) -> Result<Kernel, String> {
        let c = loaded.config.clone();
        let w = &c.world;
        let currency = w.currencies[0].code.clone();
        let cur_of = |a: &crate::config::AccountCfg| a.currency.clone().unwrap_or_else(|| currency.clone());
        let mut boundary_accounts = BTreeMap::new();
        for a in w.accounts.iter().filter(|a| w.boundaries.contains(&a.holder) && a.custodian == a.holder) {
            boundary_accounts.entry((a.holder.clone(), cur_of(a))).or_insert_with(|| a.id.clone());
        }
        let s = Statics {
            types: c.catalogue.structure_types.iter().map(|t| (t.id.clone(), t.clone())).collect(),
            spaces: c
                .catalogue
                .structure_types
                .iter()
                .map(|t| (t.id.clone(), crate::config::spaces_of(t).into_iter().map(|(l, sp)| (l, sp.clone())).collect()))
                .collect(),
            templates: c.templates.iter().map(|t| (t.id.clone(), t.clone())).collect(),
            boundaries: w.boundaries.clone(),
            detailed: crate::config::detailed_rects(&w.places),
            boundary_accounts,
            currency: currency.clone(),
            tick: c.clock.tick_seconds,
            randomness: Randomness::new(c.seed),
            config: c.clone(),
        };
        let person_of: BTreeMap<&str, &str> = c.participants.iter().filter_map(|p| p.person.as_deref().map(|e| (e, p.id.as_str()))).collect();
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
                        children: w.entities.iter().filter(|c| c.parents.as_ref().is_some_and(|ps| ps.contains(&e.id))).map(|c| c.id.clone()).collect(),
                        present: e.present.unwrap_or(true),
                        alive: true,
                        parents: e.parents.clone().unwrap_or_default(),
                        conditions: vec![],
                        participant: person_of.get(e.id.as_str()).map(|p| p.to_string()),
                    });
                    (e.id.clone(), Entity { kind: e.kind.clone(), name: e.name.clone(), changed: 0, moved: 0, body })
                })
                .collect(),
            accounts: w.accounts.iter().map(|a| (a.id.clone(), Account { holder: a.holder.clone(), custodian: a.custodian.clone(), currency: cur_of(a), balance: a.balance, changed: 0 })).collect(),
            labour_used: crate::state::Map::new(),
            holdings: w
                .holdings
                .iter()
                .map(|x| (crate::state::holding_key(&x.holder, &x.at, &x.kind), crate::state::Holding { kind: x.kind.clone(), holder: x.holder.clone(), at: x.at.clone(), quantity: x.quantity, changed: 0 }))
                .collect(),
            closed_accounts: crate::state::Map::new(),
            cells,
            structures: crate::state::Map::new(),
            occupancy: crate::state::Map::new(),
            departures: crate::state::Map::new(),
            records: crate::state::Map::new(),
            record_order: imbl::Vector::new(),
            participants: c
                .participants
                .iter()
                .map(|p| {
                    (
                        p.id.clone(),
                        Participant {
                            kind: p.kind,
                            person: p.person.clone(),
                            owner: p.owner.clone(),
                            template: None,
                            def: Arc::new(ParticipantDef {
                                title: p.title.clone(),
                                channels: p.channels.clone(),
                                controller: p.controller.clone(),
                                framing: p.framing.clone(),
                                on_opt_out: p.on_opt_out.clone(),
                            }),
                            traits: p.traits.clone(),
                            status: ParticipantStatus::Active,
                            status_changed: 0,
                            pending: BTreeMap::new(),
                            new_transactions: BTreeMap::new(),
                            looks: BTreeMap::new(),
                        },
                    )
                })
                .collect(),
            positions: c
                .positions
                .iter()
                .map(|p| {
                    (
                        p.id.clone(),
                        Position {
                            entity: p.entity.clone(),
                            title: p.title.clone(),
                            role: p.role.clone(),
                            channels: Arc::new(p.channels.clone()),
                            role_module: p.role_module.clone(),
                            holder: p.holder.clone(),
                            changed: 0,
                        },
                    )
                })
                .collect(),
            schedule: vec![],
        };
        for x in &w.structures {
            let f = s.types[&x.structure_type].footprint;
            let cells = crate::config::footprint_cells(&crate::config::detailed_rects(&w.places), &x.at, f).expect("validated");
            for cell in &cells {
                st.cells.get_mut(cell).unwrap().structure = Some(x.id.clone());
            }
            st.structures.insert(x.id.clone(), Structure {
                    at: x.at.clone(),
                    cells,
                    structure_type: x.structure_type.clone(),
                    built_by: x.built_by.clone(),
                    complete: true,
                    completes_at: None,
                    labour_done: 0,
                    demolition: None,
                    variables: crate::exec::init_variables(&s, &x.structure_type, 0),
                });
        }
        for o in &w.occupancy {
            let (sid, _) = crate::config::split_space(&o.space).expect("validated");
            st.occupancy.entry(sid.to_string()).or_default().entry(o.space.clone()).or_default().insert(o.occupant.clone());
        }
        for r in &w.records {
            st.store(r.clone());
        }
        // Bodies age from the start.
        let people: Vec<(Id, i64)> = st.entities.iter().filter_map(|(id, e)| e.body.as_ref().map(|b| (id.clone(), b.born_at))).collect();
        for (id, born) in people {
            schedule_birthday(&s, &mut st, &id, born);
        }
        let k = Kernel { s, state: st, index: Default::default() };
        k.state_hash().map_err(|e| format!("initial state is not canonical: {e}"))?;
        Ok(k)
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
        canon::canonical(&self.state)
    }

    pub fn state_hash(&self) -> Result<String, canon::CanonError> {
        Ok(canon::hash_with_domain(canon::DOMAIN_STATE, &self.canonical_state()?))
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
        canon::check_integers(&body).map_err(|e| ProtocolError(e.to_string()))?;
        crate::contracts::check(&crate::contracts::contracts().command, &body).map_err(|e| ProtocolError(format!("command {e}")))?;
        let exists = |p: &str| if self.state.participants.contains_key(p) { Ok(()) } else { perr(format!("unknown participant {p}")) };
        match cmd {
            Command::Act { participant, position, .. } => {
                exists(participant)?;
                if position.is_none() && self.state.participants[participant].kind == ParticipantKind::System {
                    return perr(format!("{participant} is a system: it acts only in a position"));
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
                    if let Some(q) = &l.query {
                        if !matches!(ch.kind, crate::config::ChannelKind::Records { .. }) {
                            return perr(format!("channel {} isn't a records channel, so it can't be searched", l.channel));
                        }
                        if q.limit.is_some_and(|n| n == 0 || n > 200) {
                            return perr("a search's limit is 1..=200");
                        }
                        for f in q.conditions.iter().flatten().map(|c| &c.field).chain(q.order.iter().map(|o| &o.field)) {
                            if !observe::known_field(f) {
                                return perr(format!("{f} isn't a field a search can use"));
                            }
                        }
                    }
                }
            }
            Command::Advance { to } => {
                if *to < self.state.t {
                    return perr(format!("cannot advance to {to}: the clock is at {}", self.state.t));
                }
                if to % self.s.tick != 0 {
                    return perr(format!("{to} is not a multiple of tick_seconds ({})", self.s.tick));
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
        }
        Ok(())
    }

    pub fn apply(&mut self, cmd: &Command) -> Result<Output, ProtocolError> {
        self.precheck(cmd)?;
        Ok(match cmd {
            Command::Act { participant, position, blocks, .. } => self.act(participant, position.as_deref(), blocks),
            Command::Advance { to } => self.advance(*to),
            Command::Observe { participant, only } => self.observe(participant, only.as_deref(), &[]),
            Command::Look { participant, only, looks } => self.observe(participant, only.as_deref(), looks),
            Command::OptOut { participant, statement } => {
                let t = self.state.t;
                let c = self.state.stamp();
                let p = self.state.participants.get_mut(participant).unwrap();
                p.status = ParticipantStatus::OptedOut;
                p.status_changed = c;
                let vacant = p.def.vacant_after_opt_out();
                let mut events = vec![Timed::new(t, EventBody::ParticipantOptedOut { participant: participant.clone(), statement: statement.clone() })];
                // Without a stand-in, nobody is there to act in its positions any more.
                if vacant {
                    let held: Vec<Id> = self.state.positions.iter().filter(|(_, x)| x.holder.as_deref() == Some(participant.as_str())).map(|(id, _)| id.clone()).collect();
                    for id in held {
                        let c = self.state.stamp();
                        let x = self.state.positions.get_mut(&id).unwrap();
                        x.holder = None;
                        x.changed = c;
                        events.push(Timed::new(t, EventBody::Appointed { position: id, holder: None, by: None }));
                    }
                }
                Output { events, observation: None }
            }
        })
    }

    /// Dry run: would physics allow this action right now?
    pub fn check(&self, participant: &str, position: Option<&str>, blocks: &[Block]) -> Result<Check, ProtocolError> {
        if !self.state.participants.contains_key(participant) {
            return perr(format!("unknown participant {participant}"));
        }
        if blocks.is_empty() || blocks.len() > 32 {
            return perr("an action has 1..=32 blocks");
        }
        let mut scratch = self.state.clone();
        let action = scratch.mint("act");
        Ok(match exec_action(&self.s, &mut scratch, participant, position, &action, blocks) {
            Ok(_) => Check { ok: true, refusal: None },
            Err(r) => Check { ok: false, refusal: Some(refusal_info(&r)) },
        })
    }

    fn act(&mut self, participant: &str, position: Option<&str>, blocks: &[Block]) -> Output {
        let action = self.state.mint("act");
        let t = self.state.t;
        let result = if !can_act(&self.state.participants[participant]) {
            Err(refuse(RefusalCode::ParticipantInactive, format!("{participant} no longer acts")))
        } else {
            let mut scratch = self.state.clone();
            exec_action(&self.s, &mut scratch, participant, position, &action, blocks).map(|res| (scratch, res))
        };
        let pos = position.map(String::from);
        let (events, outcome) = match result {
            Ok((scratch, res)) => {
                self.state = scratch;
                let created = (!res.created.is_empty()).then_some(res.created);
                let mut events = vec![Timed::new(t, EventBody::ActionApplied { action: action.clone(), participant: participant.into(), position: pos.clone(), created: created.clone() })];
                events.extend(res.events);
                (events, Outcome { action, t, status: OutcomeStatus::Applied, created, refusal: None })
            }
            Err(r) => (
                vec![Timed::new(
                    t,
                    EventBody::ActionRefused { action: action.clone(), participant: participant.into(), position: pos.clone(), block: r.block, code: r.code, detail: r.detail.clone() },
                )],
                Outcome { action, t, status: OutcomeStatus::Refused, created: None, refusal: Some(refusal_info(&r)) },
            ),
        };
        let key = pos.unwrap_or_else(|| SELF.into());
        self.state.participants.get_mut(participant).unwrap().pending.entry(key).or_default().outcomes.push(outcome);
        Output { events, observation: None }
    }

    fn advance(&mut self, to: i64) -> Output {
        let mut events = vec![];
        while self.state.schedule.first().is_some_and(|x| x.at <= to) {
            let item = self.state.schedule.remove(0);
            self.state.t = item.at;
            events.extend(scheduled(&self.s, &mut self.state, item));
        }
        self.state.t = to;
        Output { events, observation: None }
    }

    /// The full picture a participant's channels cover right now; changes nothing.
    pub fn full_view(&mut self, participant: &str) -> Option<observe::Observation> {
        self.state.participants.contains_key(participant).then(|| observe::full_view(&self.s, &self.state, &mut self.index, participant))
    }

    fn observe(&mut self, participant: &str, only: Option<&str>, looks: &[crate::config::LookRequest]) -> Output {
        let obs = observe::observe(&self.s, &mut self.state, &mut self.index, participant, only, looks);
        let hash = canon::hash_value(canon::DOMAIN_OBSERVATION, &obs).expect("observations are canonical");
        Output { events: vec![Timed::new(self.state.t, EventBody::Observation { participant: participant.into(), observation_hash: hash })], observation: Some(obs) }
    }
}
