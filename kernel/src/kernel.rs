//! The engine's kernel (docs/design/rebuild.md section 4): the world (`oikos-world`, the only writer) and what its
//! participants perceive of it (`oikos-perception`, read-only), together behind one command interface. An
//! observation is built by perception from the world as it is, then delivered by the world (what was looked through
//! is marked seen; outcomes and messages are handed over), and its hash goes in the log.

use crate::blocks::{Id, Record};
use crate::canon;
use crate::config::LookRequest;
use crate::events::{EventBody, Timed};
use crate::observe::{self, ChannelData, Observation, RecordIndex, SiteCell, SiteStructure};
use crate::state::State;
use crate::statics::Statics;
use oikos_resolver::knowledge::{CellFacts, RecordFacts, StructureFact, Seen, SeenAccount, SeenChannel, SeenEntity, SeenHolding, SeenPosition, Shown};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, RwLock};

pub use oikos_world::kernel::{Check, Command, ProtocolError};

#[derive(Debug, Clone, Default)]
pub struct Output {
    pub events: Vec<Timed>,
    pub observation: Option<Observation>,
    /// The observation as it was hashed, when it was: whoever delivers it needn't serialise it again.
    pub observed: Option<Observed>,
}

/// An observation in JSON, as it's hashed and delivered: its canonical bytes (exactly `canon::canonical` of it: what
/// its hash in the log is of), and what its records and cells add to the resolver's knowledge, by channel path (the
/// rest of what a seat takes in of it is read from the observation itself: `seen`, `Knowledge::absorb_seen`).
#[derive(Debug, Clone)]
pub struct Observed {
    pub canonical: Vec<u8>,
    pub shown: BTreeMap<Id, Shown>,
    /// The observation as it's handed to a host that asked for records by reference (`Kernel::refer_to_records`):
    /// as `canonical`, with each record the host has been handed before written as its id alone. Absent otherwise.
    pub wire: Option<Vec<u8>>,
}

/// Records and buildings as they're delivered: each one's canonical bytes, and what it adds to a seat's knowledge,
/// kept from the first time it's shown. A record never changes once made, and one record is shown to many (a public
/// notice, to everyone who looks); a building is shown, the same, on every cell it stands on and to everyone whose
/// channels cover it. So each is encoded once, not once per observer or per cell. Derived from what's delivered;
/// never part of the state. (Behind locks: the observations of one moment may be encoded at once, `Kernel::plan`.
/// What is kept for a record or a building is the same whoever encodes it first.)
#[derive(Default)]
pub struct Delivered {
    /// Each record shown, by where it is in memory (it's kept here, so nothing else can come to be there): its
    /// canonical bytes and what it adds. A record is immutable once made, and an observation shows the state's own.
    records: RwLock<BTreeMap<usize, Shared>>,
    /// structure id -> the building as it was last shown (the latest few ways: with its occupants named and without,
    /// say), each with its canonical bytes and what's known of it. Used only for a building that's equal to one of
    /// them, field for field: the bytes are what encoding it again would give.
    structures: RwLock<BTreeMap<Id, Vec<Building>>>,
    /// structure id -> what's known of it (its type, where it is, its spaces): one for everyone told of it, while it is
    /// the same. It is made of what a building is, not of who is in it, so the many ways a building is shown (as its
    /// occupants come and go) share it; each person's knowledge held its own (SC-1: 0.4 GB at 50,000 people).
    facts: RwLock<BTreeMap<Id, Arc<StructureFact>>>,
}

/// For a host that asked for records by reference: record id -> the record it was last handed whole under that id
/// (where it is in memory), and every record it holds so. A record is handed over whole the first time, and by its
/// id from then on: one record is shown to many seats (a register of lots, to everyone who reads it), and the host
/// reads it once. (In the order observations are delivered, one at a time: never part of encoding one.)
#[derive(Default)]
struct Handed {
    by_id: BTreeMap<Id, usize>,
    whole: BTreeSet<usize>,
}

/// A record as it's delivered: what it adds (kept from the first time it is shown: a record is shown to many, and
/// read again at each look), and its canonical bytes, made the first time an observation that is written shows it (a
/// seat's, or one whose hash the log keeps) and kept from then on. A code actor's look makes no bytes: they were made
/// and kept for every record anyone was shown (SC-1). The record is kept with them, so no other comes to be where it
/// is in memory.
struct Shared {
    record: Arc<Record>,
    bytes: Option<Arc<[u8]>>,
    facts: Arc<RecordFacts>,
}

/// A building as it was shown: its canonical bytes, and what's known of it.
type Building = (Arc<SiteStructure>, Arc<[u8]>, Arc<StructureFact>);

/// How many ways a building was last shown are kept.
const WAYS: usize = 4;

/// A lock's guard, whatever became of another holder (what's kept behind these is only ever whole).
fn held<T>(lock: Result<T, std::sync::PoisonError<T>>) -> T {
    lock.unwrap_or_else(|e| e.into_inner())
}

impl Delivered {
    /// A record an observation shows: its canonical bytes, what it adds, and where it's kept here.
    fn record(&self, r: &Arc<Record>) -> Result<(Arc<[u8]>, Arc<RecordFacts>, usize), canon::CanonError> {
        let at = Arc::as_ptr(r) as usize;
        let facts = match held(self.records.read()).get(&at) {
            Some(shared) => {
                if let Some(b) = &shared.bytes {
                    return Ok((b.clone(), shared.facts.clone(), at));
                }
                Some(shared.facts.clone())
            }
            None => None,
        };
        let v = serde_json::to_value(&**r).map_err(|e| canon::CanonError::Serialize(e.to_string()))?;
        let bytes: Arc<[u8]> = canon::canonical_value(&v)?.into();
        let facts = facts.unwrap_or_else(|| Arc::new(RecordFacts::of(&v)));
        // (Encoded by another meanwhile: theirs is kept, and given.)
        let mut records = held(self.records.write());
        let shared = records.entry(at).or_insert_with(|| Shared { record: r.clone(), bytes: None, facts: facts.clone() });
        let bytes = shared.bytes.get_or_insert(bytes).clone();
        Ok((bytes, shared.facts.clone(), at))
    }

    /// What a record adds to a seat's knowledge, without its bytes (a code actor's look: nothing of it is written).
    fn record_facts(&self, r: &Arc<Record>) -> Result<Arc<RecordFacts>, canon::CanonError> {
        let at = Arc::as_ptr(r) as usize;
        if let Some(shared) = held(self.records.read()).get(&at) {
            return Ok(shared.facts.clone());
        }
        let v = serde_json::to_value(&**r).map_err(|e| canon::CanonError::Serialize(e.to_string()))?;
        let facts = Arc::new(RecordFacts::of(&v));
        let mut records = held(self.records.write());
        let shared = records.entry(at).or_insert_with(|| Shared { record: r.clone(), bytes: None, facts });
        Ok(shared.facts.clone())
    }

    /// Writes a record for a host that keeps what it's handed: whole the first time, its id from then on.
    fn hand_over(&self, handed: &mut Handed, at: usize, bytes: &[u8], out: &mut Vec<u8>) {
        let record = held(self.records.read()).get(&at).map(|shared| shared.record.clone());
        let Some(record) = record else { return out.extend_from_slice(bytes) };
        if handed.whole.contains(&at) {
            return canon::write_string(&record.id, out);
        }
        handed.whole.insert(at);
        out.extend_from_slice(bytes);
        // (Another record handed over under this id before, if that could be: the host no longer holds it.)
        if let Some(was) = handed.by_id.insert(record.id, at).filter(|was| *was != at) {
            handed.whole.remove(&was);
        }
    }

    /// A building as a sites channel shows it: its canonical bytes, and what's known of it.
    fn structure(&self, x: &Arc<SiteStructure>) -> Result<(Arc<[u8]>, Arc<StructureFact>), canon::CanonError> {
        if let Some((_, bytes, fact)) = held(self.structures.read()).get(&x.structure).and_then(|ways| ways.iter().find(|(shown, _, _)| Arc::ptr_eq(shown, x) || **shown == **x)) {
            return Ok((bytes.clone(), fact.clone()));
        }
        let bytes: Arc<[u8]> = canon::canonical(&**x)?.into();
        let fact = self.fact_of(x);
        let mut structures = held(self.structures.write());
        let ways = structures.entry(x.structure).or_default();
        ways.insert(0, (x.clone(), bytes.clone(), fact.clone()));
        ways.truncate(WAYS);
        Ok((bytes, fact))
    }

    /// What's known of a building a sites channel shows, without its bytes: the one kept for it where this very
    /// building was shown before, else made now (the same facts as `structure` gives: its type, where it is, its spaces).
    fn structure_fact(&self, x: &Arc<SiteStructure>) -> Arc<StructureFact> {
        if let Some(fact) = held(self.structures.read()).get(&x.structure).and_then(|ways| ways.iter().find(|(shown, _, _)| Arc::ptr_eq(shown, x)).map(|(_, _, f)| f.clone())) {
            return fact;
        }
        self.fact_of(x)
    }

    /// What's known of a building as shown: the one held for it, if it still says the same; else made, and held.
    fn fact_of(&self, x: &SiteStructure) -> Arc<StructureFact> {
        let same = |f: &StructureFact| f.type_ == x.structure_type && f.at == x.at && f.spaces.len() == x.spaces.len() && f.spaces.iter().zip(&x.spaces).all(|(a, b)| *a == b.space);
        if let Some(f) = held(self.facts.read()).get(&x.structure).filter(|f| same(f)) {
            return f.clone();
        }
        let f = Arc::new(StructureFact { type_: x.structure_type.to_string(), at: x.at.to_string(), spaces: x.spaces.iter().map(|sp| sp.space).map(|x| x.to_string()).collect() });
        held(self.facts.write()).insert(x.structure, f.clone());
        f
    }

    /// A cell as a sites channel shows it: its canonical bytes (exactly `canon::canonical` of it, written here member
    /// by member, in order, around its building's), and what it adds. `shown`: the buildings met so far in this
    /// observation, by where each is in memory (one building is on many cells).
    fn cell(&self, c: &SiteCell, shown: &mut Vec<(usize, Arc<[u8]>, Arc<StructureFact>)>) -> Result<(Arc<[u8]>, Arc<CellFacts>), canon::CanonError> {
        let structure = match &c.structure {
            None => None,
            Some(x) => {
                let at = Arc::as_ptr(x) as usize;
                Some(match shown.iter().rev().find(|(p, _, _)| *p == at) {
                    Some((_, bytes, fact)) => (bytes.clone(), fact.clone()),
                    None => {
                        let (bytes, fact) = self.structure(x)?;
                        shown.push((at, bytes.clone(), fact.clone()));
                        (bytes, fact)
                    }
                })
            }
        };
        let safe = |i: i64| (-canon::MAX_SAFE..=canon::MAX_SAFE).contains(&i);
        let bytes = if safe(c.x) && safe(c.y) {
            let mut out = Vec::with_capacity(96 + structure.as_ref().map_or(0, |(b, _)| b.len()));
            out.extend_from_slice(b"{\"cell\":");
            canon::write_string(&c.cell, &mut out);
            if !c.seen.is_empty() {
                out.extend_from_slice(b",\"seen\":[");
                for (i, species) in c.seen.iter().enumerate() {
                    if i > 0 {
                        out.push(b',');
                    }
                    canon::write_string(species, &mut out);
                }
                out.push(b']');
            }
            if let Some((b, _)) = &structure {
                out.extend_from_slice(b",\"structure\":");
                out.extend_from_slice(b);
            }
            if let Some(terrain) = &c.terrain {
                out.extend_from_slice(b",\"terrain\":");
                canon::write_string(terrain, &mut out);
            }
            out.extend_from_slice(format!(",\"x\":{},\"y\":{}}}", c.x, c.y).as_bytes());
            debug_assert_eq!(Ok(&out), canon::canonical(c).as_ref(), "a cell written member by member isn't its canonical JSON");
            out
        } else {
            canon::canonical(c)?
        };
        let facts = CellFacts::new(&c.cell, c.x, c.y, c.terrain.as_deref(), c.structure.as_ref().zip(structure).map(|(x, (_, fact))| (x.structure.as_str(), fact)));
        debug_assert_eq!(format!("{facts:?}"), format!("{:?}", CellFacts::of(&serde_json::to_value(c).expect("a cell serializes"))), "what a cell adds, said outright, isn't what its JSON says");
        Ok((bytes.into(), Arc::new(facts)))
    }
}

/// What was taken out of a channel while the rest of its observation is encoded.
enum Taken {
    Records(Vec<Arc<Record>>),
    Cells(Vec<SiteCell>),
}

/// An observation encoded: its canonical bytes, what its records and cells add, and the parts those bytes were put
/// together from (for writing it again for a host that keeps the records it's handed: `deliver`). Encoding one reads
/// nothing that the order observations are delivered in could change, so those of one moment may be encoded at once.
pub struct Encoded {
    canonical: Vec<u8>,
    shown: BTreeMap<Id, Shown>,
    top: Vec<(String, Vec<u8>)>,
    parts: Vec<Part>,
    elements: Elements,
}

impl Encoded {
    /// An observation of this state, in JSON. (Its records and cells are taken out while the rest is encoded, and put
    /// back: it's left as it was.)
    fn of(obs: &mut Observation, delivered: &Delivered) -> Result<Encoded, canon::CanonError> {
        let mut taken: Vec<(Id, Taken)> = vec![];
        for (path, ch) in obs.channels.iter_mut() {
            match ch {
                ChannelData::Records { records, .. } if !records.is_empty() => taken.push((*path, Taken::Records(std::mem::take(records)))),
                ChannelData::Sites { cells, .. } if !cells.is_empty() => taken.push((*path, Taken::Cells(std::mem::take(cells)))),
                _ => {}
            }
        }
        // By channel path: the member taken out, and its elements' canonical bytes, in order (each record with where
        // it's kept in `delivered`: what a host can be handed by reference).
        let mut elements: Elements = BTreeMap::new();
        let mut shown: BTreeMap<Id, Shown> = BTreeMap::new();
        let mut failed = None;
        let mut buildings = vec![];
        for (path, what) in &taken {
            let (_, list) = elements.entry(*path).or_insert((if matches!(what, Taken::Records(_)) { "records" } else { "cells" }, vec![]));
            let facts = shown.entry(*path).or_default();
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
                        match delivered.cell(c, &mut buildings) {
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
        // The observation's own canonical form, written straight from it (no JSON value is made of it): its members
        // in order, and under `channels` each channel's, with what was taken out of a channel written from its
        // elements' bytes where its (empty) member stands.
        let channels = std::mem::take(&mut obs.channels);
        let top = canon::canonical_members(&*obs);
        let parts: Result<Vec<Part>, canon::CanonError> = channels
            .iter()
            .map(|(path, ch)| Ok((*path, if elements.contains_key(path) { Err(canon::canonical_members(ch)?) } else { Ok(canon::canonical(ch)?) })))
            .collect();
        obs.channels = channels;
        for (path, what) in taken {
            match (obs.channels.get_mut(&path), what) {
                (Some(ChannelData::Records { records, .. }), Taken::Records(was)) => *records = was,
                (Some(ChannelData::Sites { cells, .. }), Taken::Cells(was)) => *cells = was,
                _ => {}
            }
        }
        let (top, mut parts) = match (top, parts, failed) {
            (Err(e), _, _) | (_, Err(e), _) | (_, _, Some(e)) => return Err(e),
            (Ok(top), Ok(parts), None) => (top, parts),
        };
        // (Canonical key order is by UTF-16 code units; for ASCII paths, every one so far, the map's own.)
        if !parts.iter().all(|(path, _)| path.is_ascii()) {
            parts.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
        }
        let mut canonical = Vec::with_capacity(1024 + elements.values().flat_map(|(_, list)| list).map(|(_, b)| b.len() + 1).sum::<usize>());
        write_with(&top, &parts, &mut canonical, &elements, &mut |_, b, out| out.extend_from_slice(b));
        Ok(Encoded { canonical, shown, top, parts, elements })
    }

    /// As it's delivered, now: for a host that takes records by reference, written again with each record it has
    /// been handed already as its id (and those it's handed here noted as handed).
    fn deliver(self, delivered: &Delivered, handed: Option<&mut Handed>) -> Observed {
        let wire = handed.map(|handed| {
            let mut line = Vec::with_capacity(1024);
            write_with(&self.top, &self.parts, &mut line, &self.elements, &mut |at, b, out| match at {
                Some(at) => delivered.hand_over(handed, at, b, out),
                None => out.extend_from_slice(b),
            });
            line
        });
        Observed { canonical: self.canonical, shown: self.shown, wire }
    }
}

/// What a seat's knowledge takes in of an observation, besides what its records and cells add (`Observed::shown`):
/// read from the observation itself, as `Seen::of` reads it from the observation's JSON with each records channel's
/// records and each sites channel's cells left out.
pub fn seen(obs: &Observation) -> Seen<'_> {
    fn word<S: AsRef<str>>(x: &Option<S>) -> &str {
        x.as_ref().map_or("", |s| s.as_ref())
    }
    Seen {
        entity: word(&obs.entity),
        t: Some(obs.t),
        positions: obs.positions.iter().map(|p| SeenPosition { position: &p.position, entity: &p.entity, title: word(&p.title), role: word(&p.role) }).collect(),
        channels: obs
            .channels
            .iter()
            .map(|(path, ch)| {
                let channel = match ch {
                    ChannelData::Accounts { accounts, .. } => SeenChannel::Accounts(accounts.iter().map(|a| SeenAccount { account: &a.account, holder: &a.holder, custodian: &a.custodian, closed: a.closed == Some(true) }).collect()),
                    ChannelData::Holdings { holdings, .. } => SeenChannel::Holdings(holdings.iter().map(|h| SeenHolding { kind: &h.kind, at: &h.at, gone: h.quantity == 0 }).collect()),
                    ChannelData::Sites { .. } => SeenChannel::Sites(vec![]),
                    ChannelData::Directory { entities, positions } => SeenChannel::Directory {
                        entities: entities.iter().map(|e| SeenEntity { entity: &e.entity, name: &e.name, participant: e.participant.as_deref() }).collect(),
                        positions: positions.iter().map(|p| SeenPosition { position: &p.position, entity: &p.entity, title: word(&p.title), role: word(&p.role) }).collect(),
                    },
                    ChannelData::Records { .. } | ChannelData::OwnRecord { .. } => SeenChannel::Records(vec![]),
                };
                (path.as_str(), channel)
            })
            .collect(),
    }
}

/// By channel path: the member taken out of the channel (`records` or `cells`), and its elements in order: each one's
/// canonical bytes, and for a record, where it's kept in `Delivered`.
type Elements = BTreeMap<Id, (&'static str, Vec<(Option<usize>, Arc<[u8]>)>)>;

/// A channel of an observation, by its path: its canonical bytes, or (one something was taken out of) its members'.
type Part = (Id, Result<Vec<u8>, Vec<(String, Vec<u8>)>>);

/// An observation's canonical form, from its members' canonical bytes (`top`, its channels left out) and its
/// channels' (`parts`, in canonical order), with what was taken out of each channel written, element by element,
/// where its (empty) member stands: `element` writes one (a record's place in `Delivered`, its bytes).
fn write_with(top: &[(String, Vec<u8>)], parts: &[Part], out: &mut Vec<u8>, elements: &Elements, element: &mut dyn FnMut(Option<usize>, &[u8], &mut Vec<u8>)) {
    let members = |members: &[(String, Vec<u8>)], out: &mut Vec<u8>, value: &mut dyn FnMut(&str, &[u8], &mut Vec<u8>)| {
        out.push(b'{');
        for (i, (key, bytes)) in members.iter().enumerate() {
            if i > 0 {
                out.push(b',');
            }
            canon::write_string(key, out);
            out.push(b':');
            value(key, bytes, out);
        }
        out.push(b'}');
    };
    let mut channel = |path: &str, part: &Result<Vec<u8>, Vec<(String, Vec<u8>)>>, out: &mut Vec<u8>| match (part, elements.get(path)) {
        (Err(inside), Some((member, list))) => {
            out.push(b'{');
            for (i, (key, bytes)) in inside.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                canon::write_string(key, out);
                out.push(b':');
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
                    out.extend_from_slice(bytes);
                }
            }
            out.push(b'}');
        }
        (Err(inside), None) => unreachable!("a channel's members are asked for only where something was taken out of it: {} members", inside.len()),
        (Ok(bytes), _) => out.extend_from_slice(bytes),
    };
    members(top, out, &mut |key, bytes, out| {
        if key != "channels" {
            return out.extend_from_slice(bytes);
        }
        out.push(b'{');
        for (i, (path, part)) in parts.iter().enumerate() {
            if i > 0 {
                out.push(b',');
            }
            canon::write_string(path, out);
            out.push(b':');
            channel(path, part, out);
        }
        out.push(b'}');
    });
}

/// An observation made ready before it was asked for (`Kernel::plan`): as building and encoding it when it's asked
/// for would give, while nothing it reads has changed.
struct Ready {
    obs: Observation,
    looks: Vec<(Id, crate::state::Look)>,
    drained: Vec<Id>,
    /// Encoded and hashed for the log, where the log keeps this participant's observations.
    encoded: Option<(Encoded, String)>,
}

/// How many observations are made ready at once: enough to keep every core busy, few enough that a town's first
/// looks (each the whole of what a seat can see) aren't all held at one time.
const WINDOW: usize = 256;

/// How far on among those planned a request is looked for.
const LOOK_AHEAD: usize = 64;

/// Fewer than this aren't worth the starting of threads.
const WORTH_SHARING: usize = 16;

/// `f` of each item, in the items' order, worked out on up to `threads` threads. Each thread takes the next item not
/// yet taken; every result is put where its item stands, so the list is the same however the work fell out.
fn each<T: Sync, R: Send>(items: &[T], threads: usize, f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    crate::pool::each(items, threads, f)
}

/// How many threads observations are made ready on: `OIKOS_KERNEL_THREADS` if set (1: one at a time, as they're asked
/// for), else one. No result depends on it. (It was the machine's cores, up to eight, until 2026-10-17: on a shared
/// machine the threads cost a third more CPU time for a 1,000-person year and gave no wall time back; a run holds one
/// slot, so one core. docs/decisions.md, "Where a year's time goes".)
fn threads() -> usize {
    std::env::var("OIKOS_KERNEL_THREADS").ok().and_then(|x| x.parse::<usize>().ok()).filter(|n| *n > 0).unwrap_or(1)
}

pub struct Kernel {
    world: oikos_world::World,
    /// Perception's derived lookups; not part of the state.
    index: RecordIndex,
    /// What has been delivered so far, encoded; not part of the state.
    delivered: Delivered,
    /// For a host that keeps the records it's handed (`refer_to_records`): those it holds.
    handed: Option<Handed>,
    /// Observations that will be asked for next, in the order they will be (`plan`), and how many of them have been
    /// made ready or passed; and those made ready and not yet asked for. Dropped when anything they read changes.
    planned: Vec<(Id, Option<Id>)>,
    planned_done: usize,
    ready: BTreeMap<(Id, Option<Id>), Ready>,
    threads: usize,
    /// Fewer observations than this aren't made ready together.
    worth_sharing: usize,
    /// How many observations were delivered as they had been made ready (for whoever measures; nothing reads it).
    from_ready: u64,
}

impl Kernel {
    pub fn new(loaded: &crate::config::LoadedConfig) -> Result<Kernel, String> {
        Ok(Kernel { world: oikos_world::World::new(loaded)?, index: Default::default(), delivered: Default::default(), handed: None, planned: vec![], planned_done: 0, ready: BTreeMap::new(), threads: threads(), worth_sharing: WORTH_SHARING, from_ready: 0 })
    }

    /// A kernel in a state it was in before (a snapshot's): see `World::resume`. Nothing it derives (perception's
    /// index, what has been encoded) is carried over: it is made again as it is needed, and no answer depends on it.
    pub fn resume(loaded: &crate::config::LoadedConfig, state: State) -> Result<Kernel, String> {
        Ok(Kernel { world: oikos_world::World::resume(loaded, state)?, index: Default::default(), delivered: Default::default(), handed: None, planned: vec![], planned_done: 0, ready: BTreeMap::new(), threads: threads(), worth_sharing: WORTH_SHARING, from_ready: 0 })
    }

    /// The same world, apart from now on (a fork: see `World::fork`), with the same number of threads.
    pub fn fork(&self) -> Kernel {
        Kernel { world: self.world.fork(), index: Default::default(), delivered: Default::default(), handed: None, planned: vec![], planned_done: 0, ready: BTreeMap::new(), threads: self.threads, worth_sharing: self.worth_sharing, from_ready: 0 }
    }

    /// From now on, an observation's JSON has a second form (`Observed::wire`) for a host that keeps the records it's
    /// handed: a record it has had before is written there as its id alone. What's observed, hashed and logged is the
    /// same either way.
    pub fn refer_to_records(&mut self) {
        self.handed.get_or_insert_with(Handed::default);
    }

    /// An observation this kernel returned (of the state as it is), in JSON.
    pub fn observed(&mut self, obs: &mut Observation) -> Result<Observed, canon::CanonError> {
        Ok(Encoded::of(obs, &self.delivered)?.deliver(&self.delivered, self.handed.as_mut()))
    }

    /// What an observation's records and cells add to a seat's knowledge, by channel path: `observed(obs).shown`, without
    /// writing the observation's JSON, for whoever wants only that (a code actor's knowledge, where the log keeps no
    /// hash of its observation). (A cell whose place is past what JSON carries exactly is left to `observed`, which
    /// says so as it always has.)
    pub fn shown(&mut self, obs: &mut Observation) -> Result<BTreeMap<Id, Shown>, canon::CanonError> {
        let safe = |i: i64| (-canon::MAX_SAFE..=canon::MAX_SAFE).contains(&i);
        let unsafe_cell = obs.channels.values().any(|ch| matches!(ch, ChannelData::Sites { cells, .. } if cells.iter().any(|c| !safe(c.x) || !safe(c.y))));
        if unsafe_cell {
            return Ok(self.observed(obs)?.shown);
        }
        let delivered = &self.delivered;
        let mut shown: BTreeMap<Id, Shown> = BTreeMap::new();
        // (The buildings met so far in this observation, by where each is in memory: one building is on many cells.)
        let mut buildings: Vec<(usize, Arc<StructureFact>)> = vec![];
        for (path, ch) in &obs.channels {
            match ch {
                ChannelData::Records { records, .. } if !records.is_empty() => {
                    let facts = shown.entry(*path).or_default();
                    for r in records {
                        facts.records.push(delivered.record_facts(r)?);
                    }
                }
                ChannelData::Sites { cells, .. } if !cells.is_empty() => {
                    let facts = shown.entry(*path).or_default();
                    for c in cells {
                        let structure = c.structure.as_ref().map(|x| {
                            let at = Arc::as_ptr(x) as usize;
                            let fact = match buildings.iter().rev().find(|(p, _)| *p == at) {
                                Some((_, f)) => f.clone(),
                                None => {
                                    let f = delivered.structure_fact(x);
                                    buildings.push((at, f.clone()));
                                    f
                                }
                            };
                            (x.structure.as_str(), fact)
                        });
                        facts.cells.push(Arc::new(CellFacts::new(&c.cell, c.x, c.y, c.terrain.as_deref(), structure)));
                    }
                }
                _ => {}
            }
        }
        #[cfg(debug_assertions)]
        {
            let full = Encoded::of(obs, delivered).expect("an observation shown is encodable").shown;
            assert_eq!(format!("{shown:?}"), format!("{full:?}"), "what an observation adds, read without its JSON, is not what its JSON adds");
        }
        Ok(shown)
    }

    /// How many threads observations are made ready on (see `plan`; 1: none are made ready ahead), and how many
    /// observations at least are made ready together (absent: as it was). For measuring, and for tests.
    pub fn share(&mut self, threads: usize, at_least: Option<usize>) {
        self.threads = threads.max(1);
        self.worth_sharing = at_least.unwrap_or(self.worth_sharing).max(1);
    }

    /// How many observations have been delivered as they had been made ready.
    pub fn from_ready(&self) -> u64 {
        self.from_ready
    }

    /// These observations (a participant, in one capacity or all) will be asked for next, in this order, with nothing
    /// between them that changes the world (a cohort's looks at one moment): they may be built and encoded ahead,
    /// several at once, each exactly as it would be when asked for. Nothing is delivered, logged or changed by this;
    /// if something else is asked first, what was planned is let go. Results never depend on it.
    pub fn plan(&mut self, observations: Vec<(Id, Option<Id>)>) {
        self.unplan();
        // (A lean log keeps no observation hashes, and an observation isn't encoded for it. Where the log keeps only
        // seats' observations, a code actor's is still built ahead, on the threads, and only not encoded or hashed.)
        if self.threads > 1 && observations.len() >= self.worth_sharing && self.world.statics().config.log.detail.as_deref() != Some("lean") {
            self.planned = observations;
        }
    }

    /// Whether the log keeps this participant's observations (their hashes): not in a lean log, and, where the log keeps
    /// only seats' (`log.observations: seats`), not a code actor's, which the deterministic world regenerates on replay.
    pub fn keeps_observation(&self, participant: &str) -> bool {
        let log = &self.world.statics().config.log;
        if log.detail.as_deref() == Some("lean") {
            return false;
        }
        log.observations.as_deref() != Some("seats")
            || !self.world.state().participants.get(participant).is_some_and(|p| p.def.controller.get("type").and_then(|x| x.as_str()) == Some("code"))
    }

    fn unplan(&mut self) {
        self.planned.clear();
        self.planned_done = 0;
        self.ready.clear();
    }

    /// The observation made ready for this request, if there is one: making the next of those planned ready first,
    /// if this is the next of them.
    fn take_ready(&mut self, participant: &str, only: Option<&str>) -> Option<Ready> {
        if self.planned.is_empty() {
            return None;
        }
        let key = (Id::new(participant), only.map(Id::new));
        // (The next of those planned, or one a little further on: the host may pass over a unit that has gone.)
        if !self.ready.contains_key(&key) {
            if let Some(ahead) = self.planned[self.planned_done.min(self.planned.len())..].iter().take(LOOK_AHEAD).position(|k| *k == key) {
                self.planned_done += ahead;
                self.make_ready();
            }
        }
        let ready = self.ready.remove(&key);
        // Whatever else was made ready for this participant was made before this was delivered to it (what it has
        // seen, and what's waiting for it, are about to change): it's built again when asked for.
        let others: Vec<(Id, Option<Id>)> = self.ready.range((Id::new(participant), None)..).take_while(|(k, _)| k.0 == participant).map(|(k, _)| *k).collect();
        for k in others {
            self.ready.remove(&k);
        }
        ready
    }

    /// Build and encode the next of the planned observations, on several threads: each from the state as it is (the
    /// same for all: read, never changed), the first only of any one participant's.
    fn make_ready(&mut self) {
        let from = self.planned_done;
        let to = (from + WINDOW).min(self.planned.len());
        self.planned_done = to;
        let (_s, st) = (self.world.statics(), self.world.state());
        let mut seen: BTreeSet<&str> = BTreeSet::new();
        let wanted: Vec<&(Id, Option<Id>)> = self.planned[from..to]
            .iter()
            .filter(|(p, only)| st.participants.get(p).is_some_and(|x| only.as_ref().is_none_or(|o| if o == crate::config::SELF { x.kind == crate::config::ParticipantKind::Person } else { st.positions.contains_key(o) })))
            // (What a visit found comes with its looker's next observation, put in as it is delivered: one waiting on
            // that is built when asked for, not made ready.)
            .filter(|(p, only)| !oikos_world::World::visited_waiting(st, p, only.as_deref()))
            .filter(|(p, _)| seen.insert(p.as_str()))
            .collect();
        if wanted.len() < self.worth_sharing {
            return;
        }
        let keeps: Vec<(&(Id, Option<Id>), bool)> = wanted.iter().map(|w| (*w, self.keeps_observation(&w.0))).collect();
        let (s, st) = (self.world.statics(), self.world.state());
        observe::prepare(st, &mut self.index, wanted.iter().map(|(p, only)| (p.as_str(), only.as_deref())));
        let (index, delivered) = (&self.index, &self.delivered);
        let made = each(&keeps, self.threads, |((p, only), keep)| {
            let (obs, looks, drained) = observe::observe_prepared(s, st, index, p, only.as_deref());
            let (outcomes, inbox) = oikos_world::World::waiting(st, p, only.as_deref());
            let mut obs = Observation { outcomes, inbox, ..obs };
            if !*keep {
                return Some(Ready { obs, looks, drained, encoded: None });
            }
            // (One that can't be encoded is left for when it's asked for, which says so.)
            let encoded = Encoded::of(&mut obs, delivered).ok()?;
            let hash = canon::hash_with_domain(canon::DOMAIN_OBSERVATION, &encoded.canonical);
            Some(Ready { obs, looks, drained, encoded: Some((encoded, hash)) })
        });
        for (key, ready) in wanted.into_iter().zip(made) {
            if let Some(ready) = ready {
                self.ready.insert(*key, ready);
            }
        }
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

    /// The same bytes made whole by `canon::canonical` (for checking the stream `canonical_state` writes).
    pub fn canonical_state_whole(&self) -> Result<Vec<u8>, canon::CanonError> {
        self.world.canonical_state_whole()
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

    /// The part of `precheck` that asks the world, for a command whose shape is known to keep to the contract.
    pub fn precheck_in_world(&self, cmd: &Command) -> Result<(), ProtocolError> {
        self.world.precheck_in_world(cmd)
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
            Command::Look { participant, only, looks } => {
                // Visits begin (the world's: they take the looker's time); the rest is perceived now. (A visit begun
                // is on its looker's timeline: nothing made ready is kept.)
                let mut events = self.world.begin_visits(participant, looks);
                // Questions to a register's keeper are answered in the keeper's time (foundations F11): those put off are not
                // looked through now, and come with the observation after the keeper has answered.
                let (asked, put_off) = self.world.begin_asks(participant, looks);
                events.extend(asked);
                if !events.is_empty() {
                    self.unplan();
                }
                let now: Vec<LookRequest>;
                let looks = if put_off.iter().any(|x| *x) {
                    now = looks.iter().zip(&put_off).filter(|(_, off)| !**off).map(|(l, _)| l.clone()).collect();
                    &now[..]
                } else {
                    &looks[..]
                };
                let mut out = self.observe(participant, only.as_deref(), looks);
                events.append(&mut out.events);
                Ok(Output { events, ..out })
            }
            // An act begun changes nothing an observation shows (it takes its actor's time, and takes effect when
            // time moves on): what was made ready stands.
            Command::Act { .. } => Ok(Output { events: self.world.apply_prechecked(cmd)?.events, observation: None, observed: None }),
            // Anything else may change what an observation shows: nothing made ready is kept.
            _ => {
                self.unplan();
                Ok(Output { events: self.world.apply_prechecked(cmd)?.events, observation: None, observed: None })
            }
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
        // The answers a keeper has given to its questions since (foundations F11) are looked through with this observation.
        let answered = self.world.take_asks(participant, only);
        let looks: Vec<LookRequest> = if answered.is_empty() { looks.to_vec() } else { looks.iter().cloned().chain(answered).collect() };
        let looks = &looks[..];
        // One made ready for exactly this (an observation with nothing asked for) is delivered as it is; a look with
        // something asked for is built now, and whatever was made ready for the participant is let go.
        let ready = self.take_ready(participant, only).filter(|_| looks.is_empty());
        if let Some(Ready { obs, looks, drained, encoded }) = ready {
            let (outcomes, inbox, visits) = self.world.deliver(participant, only, looks, drained);
            debug_assert!(outcomes == obs.outcomes && inbox == obs.inbox && visits.is_empty(), "what was waiting for {participant} isn't what was delivered to it");
            self.from_ready += 1;
            let Some((encoded, hash)) = encoded else { return Output { events: vec![], observation: Some(obs), observed: None } };
            let observed = encoded.deliver(&self.delivered, self.handed.as_mut());
            return Output { events: vec![Timed::new(self.world.t(), EventBody::Observation { participant: participant.into(), observation_hash: hash })], observation: Some(obs), observed: Some(observed) };
        }
        let (obs, seen, drained) = observe::observe(self.world.statics(), self.world.state(), &mut self.index, participant, only, looks);
        let (outcomes, inbox, visits) = self.world.deliver(participant, only, seen, drained);
        let mut obs = Observation { outcomes, inbox, asking: oikos_world::World::asking(self.world.state(), participant, only), ..obs };
        // What its visits found, through the channel each was asked through (a later one over an earlier).
        for v in visits {
            match obs.channels.get_mut(&v.channel) {
                Some(ChannelData::Sites { as_of, cells, .. }) => {
                    *as_of = v.as_of;
                    cells.retain(|c| !v.cells.iter().any(|n| n.cell == c.cell));
                    cells.extend(v.cells);
                    cells.sort_by(|a, b| a.cell.cmp(&b.cell));
                }
                _ => {
                    obs.channels.insert(v.channel, ChannelData::Sites { as_of: v.as_of, cells: v.cells, whole: None, visited: Some(true) });
                }
            }
        }
        // A lean log keeps no observation hashes (the log's `detail`): hashing a whole observation is much of the cost.
        // Nor does one that keeps only seats' observations, for a code actor (`log.observations`).
        if !self.keeps_observation(participant) {
            return Output { events: vec![], observation: Some(obs), observed: None };
        }
        // (Exactly `canon::hash_value` of the observation, its JSON kept for whoever delivers it.)
        let observed = self.observed(&mut obs).expect("observations are canonical");
        let hash = canon::hash_with_domain(canon::DOMAIN_OBSERVATION, &observed.canonical);
        Output { events: vec![Timed::new(self.world.t(), EventBody::Observation { participant: participant.into(), observation_hash: hash })], observation: Some(obs), observed: Some(observed) }
    }
}
