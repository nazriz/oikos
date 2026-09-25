//! The kernel: the only writer of world state. It takes commands (the only
//! inputs, see the Command definition in contracts/log.schema.json) and
//! returns the events they caused. It never reads wall-clock time, never
//! iterates a hash map, never touches a float, and draws randomness only
//! from `Statics::randomness`.

use crate::blocks::{AgreementTerms, Block, Id};
use crate::canon;
use crate::config::{Level, LoadedConfig};
use crate::events::{Event, EventName, RefusalCode, Timed};
use crate::exec::{exec_action, refuse, Exec, Refusal, MAX_TEXT};
use crate::laws::Statics;
use crate::mandate::{self, Amount, Verdict};
use crate::observe::{self, Observation};
use crate::rng::Randomness;
use crate::state::{
    Agreement, AgreementStatus, Counters, EndReason, Entity, Outcome, OutcomeStatus, Parcel, Proposal, RefusalInfo, Right, RuleRec, Sched,
    SeatState, SeatStatus, State, Structure,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
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
    Resign {
        seat: Id,
        statement: String,
    },
}

/// A command the kernel will not accept at all. Unlike a refusal (a finding,
/// logged and returned to the seat), a protocol error means the orchestrator
/// sent something invalid; it is never logged.
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

/// Result of a dry run (used by the translator to check drafts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Check {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<Level>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refusal: Option<RefusalInfo>,
}

pub struct Kernel {
    s: Statics,
    state: State,
}

fn refusal_info(r: &Refusal) -> RefusalInfo {
    RefusalInfo { code: r.code, block: r.block, detail: r.detail.clone() }
}

impl Kernel {
    pub fn new(loaded: &LoadedConfig) -> Result<Kernel, String> {
        let c = loaded.config.clone();
        let all_parcels: BTreeSet<Id> = c.world.parcels.iter().map(|p| p.id.clone()).collect();
        let jurisdictions = c
            .world
            .jurisdictions
            .iter()
            .map(|j| {
                let ps = match &j.parcels {
                    crate::blocks::ParcelScope::All(_) => all_parcels.clone(),
                    crate::blocks::ParcelScope::List(l) => l.iter().cloned().collect(),
                };
                (j.entity.clone(), ps)
            })
            .collect();
        let s = Statics {
            types: c.catalogue.structure_types.iter().map(|t| (t.id.clone(), t.clone())).collect(),
            jurisdictions,
            seats: c.seats.iter().map(|x| (x.id.clone(), x.clone())).collect(),
            boundary: c.world.boundary.clone(),
            tick: c.clock.tick_seconds,
            randomness: Randomness::new(c.seed),
            config: c,
        };
        let w = &s.config.world;
        let mut st = State {
            t: 0,
            counters: Counters::default(),
            entities: BTreeMap::new(),
            parcels: BTreeMap::new(),
            rights: BTreeMap::new(),
            structures: BTreeMap::new(),
            rules: BTreeMap::new(),
            agreements: BTreeMap::new(),
            proposals: BTreeMap::new(),
            seats: BTreeMap::new(),
            schedule: vec![],
        };
        for e in &w.entities {
            st.entities.insert(
                e.id.clone(),
                Entity { kind: e.kind, name: e.name.clone(), controller: e.controller.clone(), balance: e.balance, active: true },
            );
        }
        for p in &w.parcels {
            st.parcels.insert(p.id.clone(), Parcel { x: p.x, y: p.y, w: p.w.unwrap_or(1), h: p.h.unwrap_or(1), structure: None });
        }
        for r in &w.rights {
            st.rights.insert(
                r.id.clone(),
                Right {
                    parcel: r.parcel.clone(),
                    kind: r.kind,
                    holder: r.holder.clone(),
                    grantor: None,
                    until: None,
                    units: None,
                    revocable: false,
                    under: None,
                },
            );
        }
        for x in &w.structures {
            st.structures.insert(
                x.id.clone(),
                Structure {
                    parcel: x.parcel.clone(),
                    structure_type: x.structure_type.clone(),
                    owner: x.owner.clone(),
                    complete: true,
                    completes_at: None,
                },
            );
            st.parcels.get_mut(&x.parcel).unwrap().structure = Some(x.id.clone());
        }
        for r in &w.rules {
            st.counters.rule_order += 1;
            st.rules.insert(
                r.id.clone(),
                RuleRec { jurisdiction: r.jurisdiction.clone(), rule: r.rule.clone(), enacted_at: 0, order: st.counters.rule_order },
            );
        }
        for a in &w.agreements {
            let [p1, p2] = a.terms.parties();
            let first = s.span(a.terms.period());
            let ends_at = a.terms.term().map(|t| s.span(t));
            let mut use_right = None;
            if let AgreementTerms::Lease { lessor, lessee, parcel, units, .. } = &a.terms {
                let rid = st.mint("rgt");
                st.rights.insert(
                    rid.clone(),
                    Right {
                        parcel: parcel.clone(),
                        kind: crate::blocks::RightKind::Use,
                        holder: lessee.clone(),
                        grantor: Some(lessor.clone()),
                        until: ends_at,
                        units: Some(*units),
                        revocable: false,
                        under: Some(a.id.clone()),
                    },
                );
                use_right = Some(rid);
            }
            st.agreements.insert(
                a.id.clone(),
                Agreement {
                    terms: a.terms.clone(),
                    status: AgreementStatus::Active,
                    proposed_by: p1.to_string(),
                    accepted: [p1.to_string(), p2.to_string()].into_iter().collect(),
                    expires_at: None,
                    activated_at: Some(0),
                    ends_at,
                    end_reason: ends_at.map(|_| EndReason::Expired),
                    next_payment_at: ends_at.filter(|e| first >= *e).map_or(Some(first), |_| None),
                    use_right,
                },
            );
            if ends_at.is_none_or(|e| first < e) {
                st.schedule(first, Sched::Payment { agreement: a.id.clone() });
            }
            if let Some(e) = ends_at {
                st.schedule(e, Sched::AgreementEnd { agreement: a.id.clone() });
            }
        }
        for seat in &s.config.seats {
            st.seats.insert(seat.id.clone(), SeatState { status: SeatStatus::Active, new_outcomes: vec![], new_inbox: vec![] });
        }
        let k = Kernel { s, state: st };
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
            Command::Act { seat, blocks, provenance, reasoning } => {
                seat_exists(seat)?;
                if blocks.is_empty() || blocks.len() > 32 {
                    return perr("an action has 1..=32 blocks");
                }
                if !provenance.is_object() {
                    return perr("provenance must be an object");
                }
                if reasoning.as_ref().is_some_and(|r| r.chars().count() > MAX_TEXT) {
                    return perr("reasoning is too long");
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
            Command::Observe { seat } => seat_exists(seat)?,
            Command::Resign { seat, statement } => {
                seat_exists(seat)?;
                if self.state.seats[seat].status == SeatStatus::Resigned {
                    return perr(format!("seat {seat} has already resigned"));
                }
                if statement.chars().count() > MAX_TEXT {
                    return perr("statement is too long");
                }
            }
        }
        Ok(())
    }

    pub fn apply(&mut self, cmd: &Command) -> Result<Output, ProtocolError> {
        self.precheck(cmd)?;
        Ok(match cmd {
            Command::Act { seat, blocks, reasoning, .. } => self.act(seat, blocks, reasoning.clone()),
            Command::Advance { to } => self.advance(*to),
            Command::Observe { seat } => self.observe(seat),
            Command::Resign { seat, statement } => {
                self.state.seats.get_mut(seat).unwrap().status = SeatStatus::Resigned;
                let mut e = Event::new(EventName::SeatResigned);
                e.seat = Some(seat.clone());
                e.statement = Some(statement.clone());
                Output { events: vec![Timed { t: self.state.t, event: e }], observation: None }
            }
        })
    }

    /// The mandate verdict for an action by `seat`, against the current state.
    fn mandate_verdict(&self, st: &State, seat: &str, blocks: &[Block]) -> Result<(Level, BTreeSet<Id>), Refusal> {
        if st.seats[seat].status == SeatStatus::Resigned {
            return Err(refuse(RefusalCode::SeatResigned, format!("seat {seat} has resigned")));
        }
        let amount_of = |b: &Block| match b {
            Block::Transfer { amount, .. } => Amount::Known(*amount),
            Block::Construct { structure_type, .. } => self.s.types.get(structure_type).map_or(Amount::Unknown, |t| Amount::Known(t.cost)),
            Block::Demolish { structure, .. } => st
                .structures
                .get(structure)
                .and_then(|x| self.s.types.get(&x.structure_type))
                .map_or(Amount::Unknown, |t| Amount::Known(t.demolish_cost)),
            Block::ProposeAgreement { terms, .. } => Amount::Known(terms.amount()),
            _ => Amount::NotApplicable,
        };
        match mandate::evaluate(&self.s.seats[seat].mandate, blocks, amount_of) {
            Verdict::Allowed { level, targets } => Ok((level, targets)),
            Verdict::Denied { block } => Err(Refusal {
                code: RefusalCode::MandateDenied,
                block: Some(block),
                detail: Some(format!("no power in this seat's mandate allows {} here", blocks[block].name())),
            }),
        }
    }

    /// Dry run: would this action be applied, held or refused right now?
    pub fn check(&self, seat: &str, blocks: &[Block]) -> Result<Check, ProtocolError> {
        if !self.s.seats.contains_key(seat) {
            return perr(format!("unknown seat {seat}"));
        }
        if blocks.is_empty() || blocks.len() > 32 {
            return perr("an action has 1..=32 blocks");
        }
        let mut scratch = self.state.clone();
        scratch.mint("act");
        let verdict = self.mandate_verdict(&scratch, seat, blocks);
        let result = verdict.and_then(|(level, _)| exec_action(&self.s, &mut scratch, seat, blocks).map(|_| level));
        Ok(match result {
            Ok(level) => Check { ok: true, level: Some(level), refusal: None },
            Err(r) => Check { ok: false, level: None, refusal: Some(refusal_info(&r)) },
        })
    }

    fn push_outcome(&mut self, seat: &str, o: Outcome) {
        self.state.seats.get_mut(seat).unwrap().new_outcomes.push(o);
    }

    fn refused(&mut self, seat: &str, action: &str, proposal: Option<&str>, r: &Refusal, out: &mut Vec<Timed>) {
        let mut e = Event::new(EventName::ActionRefused);
        e.action = Some(action.into());
        e.seat = Some(seat.into());
        e.block = r.block;
        e.code = Some(r.code);
        e.detail = r.detail.clone();
        e.proposal = proposal.map(Into::into);
        out.push(Timed { t: self.state.t, event: e });
        let t = self.state.t;
        self.push_outcome(
            seat,
            Outcome {
                action: action.into(),
                t,
                status: OutcomeStatus::Refused,
                created: None,
                refusal: Some(refusal_info(r)),
                proposal: proposal.map(Into::into),
                awaiting: None,
            },
        );
    }

    fn applied(&mut self, seat: &str, action: &str, proposal: Option<&str>, created: BTreeMap<String, Id>, out: &mut Vec<Timed>) {
        let created = (!created.is_empty()).then_some(created);
        let mut e = Event::new(EventName::ActionApplied);
        e.action = Some(action.into());
        e.seat = Some(seat.into());
        e.created = created.clone();
        e.proposal = proposal.map(Into::into);
        out.push(Timed { t: self.state.t, event: e });
        let t = self.state.t;
        self.push_outcome(
            seat,
            Outcome {
                action: action.into(),
                t,
                status: OutcomeStatus::Applied,
                created,
                refusal: None,
                proposal: proposal.map(Into::into),
                awaiting: None,
            },
        );
    }

    fn act(&mut self, seat: &str, blocks: &[Block], reasoning: Option<String>) -> Output {
        let action = self.state.mint("act");
        let mut out = vec![];
        let verdict = self.mandate_verdict(&self.state, seat, blocks);
        let (level, targets) = match verdict {
            Ok(v) => v,
            Err(r) => {
                self.refused(seat, &action, None, &r, &mut out);
                return Output { events: out, observation: None };
            }
        };
        // Lawfulness is checked now even when approval is needed, so approvers
        // are never asked about something the world would refuse anyway. A
        // request is not checked: it asks someone else to act with *their*
        // authority, which the requester by definition lacks.
        let mut scratch = self.state.clone();
        let dry_run = if level == Level::Request { Ok(None) } else { exec_action(&self.s, &mut scratch, seat, blocks).map(Some) };
        match dry_run {
            Err(r) => self.refused(seat, &action, None, &r, &mut out),
            Ok(Some(res)) if level == Level::Direct => {
                self.state = scratch;
                self.applied(seat, &action, None, res.created, &mut out);
                out.extend(res.events);
                self.run_triggered(res.triggered, &mut out);
            }
            Ok(_) => {
                let pid = self.state.mint("prp");
                let t = self.state.t;
                self.state.proposals.insert(
                    pid.clone(),
                    Proposal {
                        level,
                        seat: seat.into(),
                        action: action.clone(),
                        blocks: blocks.to_vec(),
                        reasoning,
                        awaiting: targets.clone(),
                        approved: BTreeSet::new(),
                        since: t,
                    },
                );
                let awaiting: Vec<Id> = targets.into_iter().collect();
                let mut e = Event::new(if level == Level::Approval { EventName::ActionHeld } else { EventName::ActionForwarded });
                e.action = Some(action.clone());
                e.seat = Some(seat.into());
                e.level = Some(level);
                e.proposal = Some(pid.clone());
                e.awaiting = Some(awaiting.clone());
                out.push(Timed { t, event: e });
                let status = if level == Level::Approval { OutcomeStatus::Held } else { OutcomeStatus::Forwarded };
                self.push_outcome(
                    seat,
                    Outcome { action, t, status, created: None, refusal: None, proposal: Some(pid), awaiting: Some(awaiting) },
                );
            }
        }
        Output { events: out, observation: None }
    }

    /// Apply proposals whose final approval just arrived, re-validating each
    /// against the world as it is now. An applied proposal can itself contain
    /// decisions that complete other proposals; those follow in order.
    fn run_triggered(&mut self, mut queue: Vec<(Id, Proposal)>, out: &mut Vec<Timed>) {
        queue.reverse();
        while let Some((pid, p)) = queue.pop() {
            let mut scratch = self.state.clone();
            match exec_action(&self.s, &mut scratch, &p.seat, &p.blocks) {
                Ok(res) => {
                    self.state = scratch;
                    self.applied(&p.seat, &p.action, Some(&pid), res.created, out);
                    out.extend(res.events);
                    let mut more = res.triggered;
                    more.reverse();
                    queue.extend(more);
                }
                Err(r) => self.refused(&p.seat, &p.action, Some(&pid), &r, out),
            }
        }
    }

    fn advance(&mut self, to: i64) -> Output {
        let mut events = vec![];
        while self.state.schedule.first().is_some_and(|x| x.at <= to) {
            let item = self.state.schedule.remove(0);
            self.state.t = item.at;
            let mut ex = Exec { s: &self.s, st: &mut self.state, seat: None, refs: BTreeMap::new(), events: vec![], triggered: vec![] };
            ex.scheduled(item);
            events.extend(ex.events);
        }
        self.state.t = to;
        Output { events, observation: None }
    }

    fn observe(&mut self, seat: &str) -> Output {
        let obs = observe::observe(&self.s, &mut self.state, seat);
        let hash = canon::hash_value(canon::DOMAIN_OBSERVATION, &obs).expect("observations are canonical");
        let mut e = Event::new(EventName::Observation);
        e.seat = Some(seat.into());
        e.observation_hash = Some(hash);
        Output { events: vec![Timed { t: self.state.t, event: e }], observation: Some(obs) }
    }
}
