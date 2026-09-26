//! The kernel (v0.2): the only writer of world state, and physics only.
//!
//! It takes commands (the only inputs; see the Command definition in
//! contracts/log.schema.json) and returns the events they caused. An act
//! either takes effect, or is refused because it is physically impossible.
//! There are no mandates, approvals or laws in here (D18-D20): authority and
//! law are records, and they matter only through what seats choose to do.
//!
//! It never reads wall-clock time, never iterates a hash map, never touches a
//! float, and draws randomness only from `Statics::randomness`.

use crate::blocks::{Block, Id};
use crate::canon;
use crate::config::LoadedConfig;
use crate::events::{EventBody, RefusalCode, Timed};
use crate::exec::{exec_action, refuse, scheduled, Refusal};
use crate::observe::{self, Observation};
use crate::rng::Randomness;
use crate::state::{Account, Counters, Entity, Outcome, OutcomeStatus, Parcel, RefusalInfo, SeatState, SeatStatus, State, Structure};
use crate::statics::Statics;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Act {
        seat: Id,
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
        seat: Id,
    },
    OptOut {
        seat: Id,
        statement: String,
    },
}

/// A command the kernel will not accept at all. Unlike a refusal (a finding,
/// logged and returned to the seat), a protocol error means the orchestrator
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
        let boundary_account = w
            .accounts
            .iter()
            .find(|a| a.holder == w.boundary && a.custodian == w.boundary)
            .map(|a| a.id.clone())
            .ok_or("the boundary needs an account in its own custody")?;
        let s = Statics {
            types: c.catalogue.structure_types.iter().map(|t| (t.id.clone(), t.clone())).collect(),
            seats: c.seats.iter().map(|x| (x.id.clone(), x.clone())).collect(),
            boundary: w.boundary.clone(),
            boundary_account,
            tick: c.clock.tick_seconds,
            randomness: Randomness::new(c.seed),
            config: c.clone(),
        };
        let mut st = State {
            t: 0,
            counters: Counters::default(),
            entities: w.entities.iter().map(|e| (e.id.clone(), Entity { kind: e.kind.clone(), name: e.name.clone(), changed: 0 })).collect(),
            accounts: w
                .accounts
                .iter()
                .map(|a| (a.id.clone(), Account { holder: a.holder.clone(), custodian: a.custodian.clone(), balance: a.balance, changed: 0 }))
                .collect(),
            parcels: w
                .parcels
                .iter()
                .map(|p| (p.id.clone(), Parcel { x: p.x, y: p.y, w: p.w.unwrap_or(1), h: p.h.unwrap_or(1), structure: None, changed: 0 }))
                .collect(),
            structures: crate::state::Map::new(),
            occupancy: crate::state::Map::new(),
            records: crate::state::Map::new(),
            record_order: imbl::Vector::new(),
            closed_accounts: crate::state::Map::new(),
            seats: c
                .seats
                .iter()
                .map(|x| {
                    (
                        x.id.clone(),
                        SeatState {
                            status: SeatStatus::Active,
                            new_outcomes: vec![],
                            new_inbox: vec![],
                            new_transactions: vec![],
                            status_changed: 0,
                            looks: BTreeMap::new(),
                        },
                    )
                })
                .collect(),
            schedule: vec![],
        };
        for x in &w.structures {
            st.structures.insert(
                x.id.clone(),
                Structure {
                    parcel: x.parcel.clone(),
                    structure_type: x.structure_type.clone(),
                    built_by: x.built_by.clone(),
                    complete: true,
                    completes_at: None,
                },
            );
            st.parcels.get_mut(&x.parcel).unwrap().structure = Some(x.id.clone());
        }
        for o in &w.occupancy {
            *st.occupancy
                .entry(o.structure.clone())
                .or_default()
                .entry(o.occupant.clone())
                .or_default()
                .entry(o.slot.clone())
                .or_default() += o.count;
        }
        for r in &w.records {
            st.store(r.clone());
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

    /// Validate a command without applying it. A command that fails here is
    /// rejected before it reaches the log.
    pub fn precheck(&self, cmd: &Command) -> Result<(), ProtocolError> {
        let body = serde_json::to_value(cmd).map_err(|e| ProtocolError(e.to_string()))?;
        canon::check_integers(&body).map_err(|e| ProtocolError(e.to_string()))?;
        crate::contracts::check(&crate::contracts::contracts().command, &body).map_err(|e| ProtocolError(format!("command {e}")))?;
        let seat_exists = |seat: &str| if self.s.seats.contains_key(seat) { Ok(()) } else { perr(format!("unknown seat {seat}")) };
        match cmd {
            Command::Act { seat, .. } | Command::Observe { seat } => seat_exists(seat)?,
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
            Command::OptOut { seat, .. } => {
                seat_exists(seat)?;
                if self.state.seats[seat].status == SeatStatus::OptedOut {
                    return perr(format!("seat {seat} has already opted out"));
                }
            }
        }
        Ok(())
    }

    pub fn apply(&mut self, cmd: &Command) -> Result<Output, ProtocolError> {
        self.precheck(cmd)?;
        Ok(match cmd {
            Command::Act { seat, blocks, .. } => self.act(seat, blocks),
            Command::Advance { to } => self.advance(*to),
            Command::Observe { seat } => self.observe(seat),
            Command::OptOut { seat, statement } => {
                let c = self.state.stamp();
                let ss = self.state.seats.get_mut(seat).unwrap();
                ss.status = SeatStatus::OptedOut;
                ss.status_changed = c;
                Output {
                    events: vec![Timed::new(self.state.t, EventBody::SeatOptedOut { seat: seat.clone(), statement: statement.clone() })],
                    observation: None,
                }
            }
        })
    }

    /// Dry run: would physics allow this action right now?
    pub fn check(&self, seat: &str, blocks: &[Block]) -> Result<Check, ProtocolError> {
        if !self.s.seats.contains_key(seat) {
            return perr(format!("unknown seat {seat}"));
        }
        if blocks.is_empty() || blocks.len() > 32 {
            return perr("an action has 1..=32 blocks");
        }
        let mut scratch = self.state.clone();
        scratch.mint("act");
        Ok(match exec_action(&self.s, &mut scratch, seat, blocks) {
            Ok(_) => Check { ok: true, refusal: None },
            Err(r) => Check { ok: false, refusal: Some(refusal_info(&r)) },
        })
    }

    fn act(&mut self, seat: &str, blocks: &[Block]) -> Output {
        let action = self.state.mint("act");
        let t = self.state.t;
        let result = if self.state.seats[seat].status == SeatStatus::OptedOut && self.s.seats[seat].vacant_after_opt_out() {
            Err(refuse(RefusalCode::SeatOptedOut, format!("seat {seat} has opted out")))
        } else {
            let mut scratch = self.state.clone();
            exec_action(&self.s, &mut scratch, seat, blocks).map(|res| (scratch, res))
        };
        let (events, outcome) = match result {
            Ok((scratch, res)) => {
                self.state = scratch;
                let created = (!res.created.is_empty()).then_some(res.created);
                let mut events =
                    vec![Timed::new(t, EventBody::ActionApplied { action: action.clone(), seat: seat.into(), created: created.clone() })];
                events.extend(res.events);
                (events, Outcome { action, t, status: OutcomeStatus::Applied, created, refusal: None })
            }
            Err(r) => (
                vec![Timed::new(
                    t,
                    EventBody::ActionRefused {
                        action: action.clone(),
                        seat: seat.into(),
                        block: r.block,
                        code: r.code,
                        detail: r.detail.clone(),
                    },
                )],
                Outcome { action, t, status: OutcomeStatus::Refused, created: None, refusal: Some(refusal_info(&r)) },
            ),
        };
        self.state.seats.get_mut(seat).unwrap().new_outcomes.push(outcome);
        Output { events, observation: None }
    }

    fn advance(&mut self, to: i64) -> Output {
        let mut events = vec![];
        while self.state.schedule.first().is_some_and(|x| x.at <= to) {
            let item = self.state.schedule.remove(0);
            self.state.t = item.at;
            events.extend(scheduled(&mut self.state, item));
        }
        self.state.t = to;
        Output { events, observation: None }
    }

    /// The full picture a seat's channels cover right now; changes nothing.
    pub fn full_view(&mut self, seat: &str) -> Option<observe::Observation> {
        self.s.seats.contains_key(seat).then(|| observe::full_view(&self.s, &self.state, &mut self.index, seat))
    }

    fn observe(&mut self, seat: &str) -> Output {
        let obs = observe::observe(&self.s, &mut self.state, &mut self.index, seat);
        let hash = canon::hash_value(canon::DOMAIN_OBSERVATION, &obs).expect("observations are canonical");
        Output {
            events: vec![Timed::new(self.state.t, EventBody::Observation { seat: seat.into(), observation_hash: hash })],
            observation: Some(obs),
        }
    }
}
