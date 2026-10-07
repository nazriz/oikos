//! The engine's kernel (docs/design/rebuild.md section 4): the world (`oikos-world`, the only writer) and what its
//! participants perceive of it (`oikos-perception`, read-only), together behind one command interface. An
//! observation is built by perception from the world as it is, then delivered by the world (what was looked through
//! is marked seen; outcomes and messages are handed over), and its hash goes in the log.

use crate::blocks::{Id, Record};
use crate::canon;
use crate::config::LookRequest;
use crate::events::{EventBody, Timed};
use crate::observe::{self, ChannelData, Observation, RecordIndex, SiteCell};
use crate::state::State;
use crate::statics::Statics;
use oikos_resolver::knowledge::{CellFacts, RecordFacts, Shown};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;

pub use oikos_world::kernel::{Check, Command, ProtocolError};

#[derive(Debug, Clone, Default)]
pub struct Output {
    pub events: Vec<Timed>,
    pub observation: Option<Observation>,
    /// The observation as it was hashed, when it was: whoever delivers it needn't serialise it again.
    pub observed: Option<Observed>,
}

/// An observation in JSON, as it's hashed and delivered: its canonical bytes (exactly `canon::canonical` of it: what
/// its hash in the log is of), and what the resolver's knowledge takes in of it (`Knowledge::absorb_with`): its value
/// with each records channel's records and each sites channel's cells left out, and beside it what those add, by
/// channel path.
#[derive(Debug, Clone)]
pub struct Observed {
    pub canonical: Vec<u8>,
    pub value: Value,
    pub shown: BTreeMap<Id, Shown>,
    /// The observation as it's handed to a host that asked for records by reference (`Kernel::refer_to_records`):
    /// as `canonical`, with each record the host has been handed before written as its id alone. Absent otherwise.
    pub wire: Option<Vec<u8>>,
}

/// Records and cells of ground as they're delivered: each one's canonical bytes, and what it adds to a seat's
/// knowledge, kept from the first time it's shown. A record never changes once made, and one record is shown to many
/// (a public notice, to everyone who looks); a cell that changes is shown, as it then is, to everyone whose channels
/// cover it. So each is encoded once, not once per observer. Derived from what's delivered; never part of the state.
#[derive(Default)]
pub struct Delivered {
    /// Each record shown, by where it is in memory (it's kept here, so nothing else can come to be there): its
    /// canonical bytes and what it adds. A record is immutable once made, and an observation shows the state's own.
    records: BTreeMap<usize, Shared>,
    /// cell id -> the cell as it was last shown (the latest few ways: with its occupants named and without, say),
    /// each with its canonical bytes and what it adds. Used only for a cell that's equal to one of them, field for
    /// field: the bytes are what encoding it again would give.
    cells: BTreeMap<Id, Vec<(SiteCell, Arc<[u8]>, Arc<CellFacts>)>>,
    /// For a host that asked for records by reference: record id -> the record it was last handed whole under that
    /// id (where it is in memory). A record is handed over whole the first time, and by its id from then on: one
    /// record is shown to many seats (a register of lots, to everyone who reads it), and the host reads it once.
    handed: Option<BTreeMap<Id, usize>>,
}

/// A record as it's delivered.
struct Shared {
    record: Arc<Record>,
    bytes: Arc<[u8]>,
    facts: Arc<RecordFacts>,
    /// The host has been handed it whole, and holds it under its id still.
    handed: bool,
}

/// How many ways a cell was last shown are kept.
const CELL_WAYS: usize = 4;

impl Delivered {
    /// A record an observation shows: its canonical bytes, what it adds, and where it's kept here.
    fn record(&mut self, r: &Arc<Record>) -> Result<(Arc<[u8]>, Arc<RecordFacts>, usize), canon::CanonError> {
        let at = Arc::as_ptr(r) as usize;
        if let Some(shared) = self.records.get(&at) {
            return Ok((shared.bytes.clone(), shared.facts.clone(), at));
        }
        let v = serde_json::to_value(&**r).map_err(|e| canon::CanonError::Serialize(e.to_string()))?;
        let bytes: Arc<[u8]> = canon::canonical_value(&v)?.into();
        let facts = Arc::new(RecordFacts::of(&v));
        self.records.insert(at, Shared { record: r.clone(), bytes: bytes.clone(), facts: facts.clone(), handed: false });
        Ok((bytes, facts, at))
    }

    /// Writes a record for a host that keeps what it's handed: whole the first time, its id from then on.
    fn hand_over(&mut self, at: usize, bytes: &[u8], out: &mut Vec<u8>) {
        let (Some(handed), Some(shared)) = (self.handed.as_mut(), self.records.get_mut(&at)) else { return out.extend_from_slice(bytes) };
        if shared.handed {
            return canon::write_string(&shared.record.id, out);
        }
        shared.handed = true;
        out.extend_from_slice(bytes);
        // (Another record handed over under this id before, if that could be: the host no longer holds it.)
        if let Some(was) = handed.insert(shared.record.id.clone(), at).filter(|was| *was != at) {
            if let Some(other) = self.records.get_mut(&was) {
                other.handed = false;
            }
        }
    }

    /// A cell as a sites channel shows it.
    fn cell(&mut self, c: &SiteCell) -> Result<(Arc<[u8]>, Arc<CellFacts>), canon::CanonError> {
        if let Some((_, bytes, facts)) = self.cells.get(&c.cell).and_then(|ways| ways.iter().find(|(shown, _, _)| shown == c)) {
            return Ok((bytes.clone(), facts.clone()));
        }
        let v = serde_json::to_value(c).map_err(|e| canon::CanonError::Serialize(e.to_string()))?;
        let bytes: Arc<[u8]> = canon::canonical_value(&v)?.into();
        let facts = Arc::new(CellFacts::of(&v));
        let ways = self.cells.entry(c.cell.clone()).or_default();
        ways.insert(0, (c.clone(), bytes.clone(), facts.clone()));
        ways.truncate(CELL_WAYS);
        Ok((bytes, facts))
    }
}

/// What was taken out of a channel while the rest of its observation is encoded.
enum Taken {
    Records(Vec<Arc<Record>>),
    Cells(Vec<SiteCell>),
}

impl Observed {
    /// An observation of this state, in JSON. (Its records and cells are taken out while the rest is encoded, and put
    /// back: it's left as it was.)
    pub fn of(obs: &mut Observation, delivered: &mut Delivered) -> Result<Observed, canon::CanonError> {
        let mut taken: Vec<(Id, Taken)> = vec![];
        for (path, ch) in obs.channels.iter_mut() {
            match ch {
                ChannelData::Records { records, .. } if !records.is_empty() => taken.push((path.clone(), Taken::Records(std::mem::take(records)))),
                ChannelData::Sites { cells, .. } if !cells.is_empty() => taken.push((path.clone(), Taken::Cells(std::mem::take(cells)))),
                _ => {}
            }
        }
        let value = serde_json::to_value(&*obs).map_err(|e| canon::CanonError::Serialize(e.to_string()));
        // By channel path: the member taken out, and its elements' canonical bytes, in order (each record with where
        // it's kept in `delivered`: what a host can be handed by reference).
        let mut bytes: Elements = BTreeMap::new();
        let mut shown: BTreeMap<Id, Shown> = BTreeMap::new();
        let mut failed = None;
        for (path, what) in &taken {
            let (_, list) = bytes.entry(path.as_str()).or_insert((if matches!(what, Taken::Records(_)) { "records" } else { "cells" }, vec![]));
            let facts = shown.entry(path.clone()).or_default();
            match what {
                Taken::Records(records) => {
                    for r in records {
                        match delivered.record(r) {
                            Ok((b, f, at)) => {
                                list.push((Some(at), b));
                                facts.records.push(f);
                            }
                            Err(e) => failed = Some(e),
                        }
                    }
                }
                Taken::Cells(cells) => {
                    for c in cells {
                        match delivered.cell(c) {
                            Ok((b, f)) => {
                                list.push((None, b));
                                facts.cells.push(f);
                            }
                            Err(e) => failed = Some(e),
                        }
                    }
                }
            }
        }
        let mut wire = None;
        let written = match (value, failed) {
            (Err(e), _) | (_, Some(e)) => Err(e),
            (Ok(value), None) => canon::check_integers(&value)
                .and_then(|()| {
                    let Value::Object(top) = &value else { return Err(canon::CanonError::Serialize("an observation is not an object".into())) };
                    // The observation's own canonical form, with what was taken out of each channel written from its
                    // elements' bytes where its (empty) member stands.
                    let mut out = Vec::with_capacity(1024 + bytes.values().flat_map(|(_, list)| list).map(|(_, b)| b.len() + 1).sum::<usize>());
                    write_with(top, &mut out, &bytes, &mut |_, b, out| out.extend_from_slice(b));
                    // For a host that takes records by reference: the same, with each record it has been handed
                    // already written as its id.
                    if delivered.handed.is_some() {
                        let mut line = Vec::with_capacity(1024);
                        write_with(top, &mut line, &bytes, &mut |at, b, out| match at {
                            Some(at) => delivered.hand_over(at, b, out),
                            None => out.extend_from_slice(b),
                        });
                        wire = Some(line);
                    }
                    Ok(out)
                })
                .map(|canonical| (canonical, value)),
        };
        drop(bytes);
        for (path, what) in taken {
            match (obs.channels.get_mut(&path), what) {
                (Some(ChannelData::Records { records, .. }), Taken::Records(was)) => *records = was,
                (Some(ChannelData::Sites { cells, .. }), Taken::Cells(was)) => *cells = was,
                _ => {}
            }
        }
        let (canonical, value) = written?;
        Ok(Observed { canonical, value, shown, wire })
    }
}

/// By channel path: the member taken out of the channel (`records` or `cells`), and its elements in order: each one's
/// canonical bytes, and for a record, where it's kept in `Delivered`.
type Elements<'a> = BTreeMap<&'a str, (&'a str, Vec<(Option<usize>, Arc<[u8]>)>)>;

/// An observation's canonical form, with what was taken out of each channel written, element by element, where its
/// (empty) member stands: `element` writes one (a record's place in `Delivered`, its bytes).
fn write_with(top: &serde_json::Map<String, Value>, out: &mut Vec<u8>, elements: &Elements, element: &mut dyn FnMut(Option<usize>, &[u8], &mut Vec<u8>)) {
    canon::write_object(top, out, |key, x, out| match (key, x) {
        ("channels", Value::Object(channels)) => canon::write_object(channels, out, |path, ch, out| match (elements.get(path), ch) {
            (Some((member, list)), Value::Object(ch)) => canon::write_object(ch, out, |key, x, out| {
                if key == *member {
                    out.push(b'[');
                    for (i, (id, b)) in list.iter().enumerate() {
                        if i > 0 {
                            out.push(b',');
                        }
                        element(*id, b, out);
                    }
                    out.push(b']');
                } else {
                    canon::write_value(x, out);
                }
            }),
            _ => canon::write_value(ch, out),
        }),
        _ => canon::write_value(x, out),
    });
}

pub struct Kernel {
    world: oikos_world::World,
    /// Perception's derived lookups; not part of the state.
    index: RecordIndex,
    /// What has been delivered so far, encoded; not part of the state.
    delivered: Delivered,
}

impl Kernel {
    pub fn new(loaded: &crate::config::LoadedConfig) -> Result<Kernel, String> {
        Ok(Kernel { world: oikos_world::World::new(loaded)?, index: Default::default(), delivered: Default::default() })
    }

    /// From now on, an observation's JSON has a second form (`Observed::wire`) for a host that keeps the records it's
    /// handed: a record it has had before is written there as its id alone. What's observed, hashed and logged is the
    /// same either way.
    pub fn refer_to_records(&mut self) {
        self.delivered.handed.get_or_insert_with(BTreeMap::new);
    }

    /// An observation this kernel returned (of the state as it is), in JSON.
    pub fn observed(&mut self, obs: &mut Observation) -> Result<Observed, canon::CanonError> {
        Observed::of(obs, &mut self.delivered)
    }

    pub fn state(&self) -> &State {
        self.world.state()
    }

    pub fn statics(&self) -> &Statics {
        self.world.statics()
    }

    pub fn t(&self) -> i64 {
        self.world.t()
    }

    pub fn canonical_state(&self) -> Result<Vec<u8>, canon::CanonError> {
        self.world.canonical_state()
    }

    pub fn state_hash(&self) -> Result<String, canon::CanonError> {
        self.world.state_hash()
    }

    /// Validate a command without applying it.
    pub fn precheck(&self, cmd: &Command) -> Result<(), ProtocolError> {
        self.world.precheck(cmd)
    }

    /// `precheck`, for a caller that has the command's JSON already.
    pub fn precheck_as(&self, cmd: &Command, body: &Value) -> Result<(), ProtocolError> {
        self.world.precheck_as(cmd, body)
    }

    pub fn apply(&mut self, cmd: &Command) -> Result<Output, ProtocolError> {
        self.world.precheck(cmd)?;
        self.apply_prechecked(cmd)
    }

    /// `apply`, for a caller that has just prechecked this command against the world as it is (nothing done since):
    /// a run checks a command once, before logging it, and not again to apply it.
    pub fn apply_prechecked(&mut self, cmd: &Command) -> Result<Output, ProtocolError> {
        match cmd {
            Command::Observe { participant, only } => Ok(self.observe(participant, only.as_deref(), &[])),
            Command::Look { participant, only, looks } => Ok(self.observe(participant, only.as_deref(), looks)),
            _ => Ok(Output { events: self.world.apply_prechecked(cmd)?.events, observation: None, observed: None }),
        }
    }

    pub fn check(&self, participant: &str, position: Option<&str>, blocks: &[crate::blocks::Block]) -> Result<Check, ProtocolError> {
        self.world.check(participant, position, blocks)
    }

    /// The full picture a participant's channels cover right now; changes nothing.
    pub fn full_view(&mut self, participant: &str) -> Option<Observation> {
        self.world.state().participants.contains_key(participant).then(|| observe::full_view(self.world.statics(), self.world.state(), &mut self.index, participant))
    }

    fn observe(&mut self, participant: &str, only: Option<&str>, looks: &[LookRequest]) -> Output {
        let (obs, seen, drained) = observe::observe(self.world.statics(), self.world.state(), &mut self.index, participant, only, looks);
        let (outcomes, inbox) = self.world.deliver(participant, only, seen, drained);
        let mut obs = Observation { outcomes, inbox, ..obs };
        // A lean log keeps no observation hashes (the log's `detail`): hashing a whole observation is much of the cost.
        if self.world.statics().config.log.detail.as_deref() == Some("lean") {
            return Output { events: vec![], observation: Some(obs), observed: None };
        }
        // (Exactly `canon::hash_value` of the observation, its JSON kept for whoever delivers it.)
        let observed = self.observed(&mut obs).expect("observations are canonical");
        let hash = canon::hash_with_domain(canon::DOMAIN_OBSERVATION, &observed.canonical);
        Output { events: vec![Timed::new(self.world.t(), EventBody::Observation { participant: participant.into(), observation_hash: hash })], observation: Some(obs), observed: Some(observed) }
    }
}
