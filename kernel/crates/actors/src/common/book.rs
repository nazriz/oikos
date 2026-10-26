//! The book: everything a participant has perceived so far, indexed (participants/src/behaviour/common.ts `Book`,
//! rewritten). Records arrive as what is new since the participant last looked, so each actor keeps its own book of
//! the records relevant to it, as a person would. What it answers depends only on what it has seen and in what order.
//!
//! Decided fresh in Rust (docs/port-guide.md, section 2):
//! - **No shelves.** TS shared one indexed copy of a long public list (a town's register of lots) between the books
//!   shown it, through a module-global cache. A global is not allowed here, and records are already shared (`Arc`), so
//!   a book holds a pointer per record and its own indexes. If memory at 10,000 people says otherwise, the engine can
//!   hand books a shared index (phase 3); nothing a book answers would change.
//! - **Indexes are kept as records arrive** (TS made some when first asked for, which needs hidden mutability): by
//!   id, by record type, by statement kind, the standing statements of each kind, claims by holder, counterparty and
//!   object, and lots by the cells they cover. Every list is in the order seen.
//! - **Snapshots** (`Book::save`, `Book::restore`): the records in the order seen, and what came beside them
//!   (readings, the directory, laws that could not be read); the rest is rebuilt by taking the records in again.

use oikos_sight::{Picture, Record, RecordBody, Seen};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// A record's id as a key: the number of a minted id (`rec.<n>`), else the id itself. Ordered as the records were
/// filed where both are minted (`filed_before`); no answer depends on the order of the map itself.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Key {
    N(u64),
    S(Box<str>),
}

fn key(id: &str) -> Key {
    match id.strip_prefix("rec.").and_then(|n| if n.bytes().all(|b| b.is_ascii_digit()) && !n.is_empty() { n.parse().ok() } else { None }) {
        Some(n) => Key::N(n),
        None => Key::S(id.into()),
    }
}

/// Where each record stands in the order seen, by id. Minted ids (`rec.<n>`) come mostly in the order they were filed,
/// so they are kept in a list sorted by number, pushed at its end or put in near it (16 bytes a record, where a map's
/// node held about 45: risk SC-1); one that would go further back than `NEAR` from the end, and every other id, goes
/// in a map. Either way a record has one place, found by its id; nothing reads the order they are kept in.
#[derive(Debug, Default)]
struct Place {
    minted: Vec<(u64, u32)>,
    other: BTreeMap<Key, u32>,
}

/// How far back from its end a minted id is put into the list (a shift of at most so many entries).
const NEAR: usize = 64;

impl Place {
    fn get(&self, k: &Key) -> Option<&u32> {
        if let Key::N(n) = k {
            if let Ok(i) = self.minted.binary_search_by_key(n, |e| e.0) {
                return Some(&self.minted[i].1);
            }
        }
        self.other.get(k)
    }
    fn contains_key(&self, k: &Key) -> bool {
        self.get(k).is_some()
    }
    /// (Of an id not held: `Book::take` asks first.)
    fn insert(&mut self, k: Key, i: u32) {
        if let Key::N(n) = k {
            let at = self.minted.partition_point(|e| e.0 < n);
            if self.minted.len() - at <= NEAR {
                self.minted.insert(at, (n, i));
                return;
            }
        }
        self.other.insert(k, i);
    }
    /// Gives up the places of these ids.
    fn remove_all(&mut self, ks: impl Iterator<Item = Key>) {
        let mut gone: Vec<u64> = vec![];
        for k in ks {
            match k {
                Key::N(n) if self.other.remove(&k).is_none() => gone.push(n),
                k => {
                    self.other.remove(&k);
                }
            }
        }
        gone.sort_unstable();
        self.minted.retain(|e| gone.binary_search(&e.0).is_err());
    }
    fn values_mut(&mut self) -> impl Iterator<Item = &mut u32> {
        self.minted.iter_mut().map(|e| &mut e.1).chain(self.other.values_mut())
    }
}

/// What a claim can be looked up by (`Book::claims_by`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimKey {
    Holder,
    Counterparty,
    /// What it is about: `about.object` (a lot, a building).
    Object,
}

/// An agreement's reading by its own terms, as the latest observation that carried one gave it (contracts 0.7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reading {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<i64>,
}

/// A position as the directory gave it: its organisation, role and holder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PositionSeen {
    pub entity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holder: Option<String>,
}

/// A notice given on an agreement: by which party, when.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NoticeSeen<'a> {
    pub party: &'a str,
    pub at: i64,
}

/// Everything a participant has perceived so far, indexed.
#[derive(Debug, Default)]
pub struct Book {
    seen: Vec<Arc<Record>>,
    place: Place,
    types: BTreeMap<&'static str, Vec<u32>>,
    /// Statements of each kind: all seen, and those not withdrawn, in the order seen (one map of both: SC-1).
    kinds: BTreeMap<String, (Vec<u32>, Vec<u32>)>,
    claims_holder: BTreeMap<String, Vec<u32>>,
    claims_counterparty: BTreeMap<String, Vec<u32>>,
    claims_object: BTreeMap<String, Vec<u32>>,
    /// cell -> the lots that cover it, in order seen.
    lots_over: BTreeMap<String, Vec<u32>>,
    withdrawn: BTreeSet<String>,
    withdrawn_at: BTreeMap<String, i64>,
    replaced_by: BTreeMap<String, String>,
    released: BTreeSet<String>,
    /// agreement -> (party, when), each signature in the order seen.
    signatures: BTreeMap<String, Vec<(String, i64)>>,
    /// agreement -> (party, when), each notice in the order seen.
    notices: BTreeMap<String, Vec<(String, i64)>>,
    /// Statements carrying a practice, an assertion, an offer that says what its offerer hears: not withdrawn.
    with_practice: Vec<u32>,
    with_assertion: Vec<u32>,
    with_hears: Vec<u32>,
    readings: BTreeMap<String, Reading>,
    /// participant -> the person it acts as (from a directory).
    participant_person: BTreeMap<String, String>,
    positions: BTreeMap<String, PositionSeen>,
    entity_kind: BTreeMap<String, String>,
    /// Laws whose formal condition could not be read against an act this reader weighed, and how many times.
    unread: BTreeMap<String, u64>,
    unread_to_say: Vec<String>,
    /// The time of the latest observation.
    pub now: i64,
    /// The directory lists last taken in. Held (not just their addresses) so that a new list can never be mistaken for the
    /// last one by being allocated where a freed one was: lane D found a bank deaf to a directory it had just been shown, in
    /// some allocation patterns and not others.
    last_directory: Option<(Arc<Vec<oikos_sight::EntityItem>>, Arc<Vec<oikos_sight::PositionItem>>)>,
}

/// What a book saves (`Book::save`).
#[derive(Serialize, Deserialize)]
struct Saved {
    records: Vec<Record>,
    readings: BTreeMap<String, Reading>,
    participant_person: BTreeMap<String, String>,
    positions: BTreeMap<String, PositionSeen>,
    entity_kind: BTreeMap<String, String>,
    unread: BTreeMap<String, u64>,
    unread_to_say: Vec<String>,
    now: i64,
}

/// Does taking a record in do something to a book beyond the record being there?
fn acts(r: &Record) -> bool {
    match &r.body {
        RecordBody::ClaimRelease { .. } | RecordBody::Withdrawal { .. } | RecordBody::Signature { .. } | RecordBody::Notice { .. } => {
            true
        }
        RecordBody::Statement { data, practice, assertion, offer, .. } => {
            data.as_ref().and_then(|d| d.get("replaces")).is_some_and(Value::is_string)
                || practice.is_some()
                || assertion.is_some()
                || hears(offer.as_ref())
        }
        _ => false,
    }
}

fn hears(offer: Option<&Value>) -> bool {
    offer.and_then(|o| o.get("hears")).is_some_and(|h| !h.is_null() && h != &Value::Bool(false))
}

impl Book {
    pub fn new() -> Self {
        Self::default()
    }

    /// Takes in what an observation shows: every records channel's records in channel order, the readings, and the
    /// directory. Returns the records new to the book, in the order taken in.
    pub fn absorb(&mut self, pic: &Picture) -> Vec<Arc<Record>> {
        self.now = pic.t;
        for (id, r) in &pic.readings {
            self.readings.insert(id.clone(), Reading { status: r.status.to_string(), ends_at: r.ends_at });
        }
        let mut fresh = vec![];
        for r in pic.all_records() {
            self.take(r, &mut fresh);
        }
        for ch in pic.channels.values() {
            if let Seen::Directory { entities, positions } = ch {
                // (The view hands back the same lists until they change.)
                if self.last_directory.as_ref().is_some_and(|(e, p)| Arc::ptr_eq(e, entities) && Arc::ptr_eq(p, positions)) {
                    continue;
                }
                self.last_directory = Some((entities.clone(), positions.clone()));
                for p in positions.iter() {
                    self.positions
                        .insert(p.position.clone(), PositionSeen { entity: p.entity.clone(), role: p.role.clone(), holder: p.holder.clone() });
                }
                for e in entities.iter() {
                    self.entity_kind.insert(e.entity.clone(), e.kind.clone());
                    if let Some(p) = &e.participant {
                        self.participant_person.insert(p.clone(), e.entity.clone());
                    }
                }
            }
        }
        fresh
    }

    /// Takes in records shown some other way (a test, a record handed over): as `absorb` takes them.
    pub fn take_all<'a>(&mut self, records: impl IntoIterator<Item = &'a Arc<Record>>) -> Vec<Arc<Record>> {
        let mut fresh = vec![];
        for r in records {
            self.take(r, &mut fresh);
        }
        fresh
    }

    fn take(&mut self, r: &Arc<Record>, fresh: &mut Vec<Arc<Record>>) {
        let k = key(&r.id);
        if self.place.contains_key(&k) {
            return;
        }
        let i = self.seen.len() as u32;
        self.place.insert(k, i);
        self.seen.push(r.clone());
        self.types.entry(r.body.kind_name()).or_default().push(i);
        match &r.body {
            RecordBody::Claim { holder, counterparty, about, .. } => {
                self.claims_holder.entry(holder.clone()).or_default().push(i);
                if let Some(c) = counterparty {
                    self.claims_counterparty.entry(c.clone()).or_default().push(i);
                }
                if let Some(o) = about.get("object").and_then(Value::as_str) {
                    self.claims_object.entry(o.to_string()).or_default().push(i);
                }
            }
            RecordBody::Statement { kind, data, .. } => {
                let withdrawn = self.withdrawn.contains(&r.id);
                let (all, standing) = self.kinds.entry(kind.clone()).or_default();
                all.push(i);
                if !withdrawn {
                    standing.push(i);
                }
                if kind == "lot" {
                    // (The cells of a lot are a list; one written as a single name, a plot of one cell, is over that cell, as `cells_of` reads it.)
                    let cells: Option<BTreeSet<&str>> = match data.as_ref().and_then(|d| d.get("cells")) {
                        Some(Value::Array(cells)) => Some(cells.iter().filter_map(Value::as_str).collect()),
                        Some(Value::String(cell)) => Some(BTreeSet::from([cell.as_str()])),
                        _ => None,
                    };
                    if let Some(cells) = cells {
                        for c in cells {
                            self.lots_over.entry(c.to_string()).or_default().push(i);
                        }
                    }
                }
            }
            _ => {}
        }
        fresh.push(r.clone());
        if acts(r) {
            self.mark(i);
        }
    }

    /// What a record does to the book on being taken in, beyond being there.
    fn mark(&mut self, i: u32) {
        let r = self.seen[i as usize].clone();
        match &r.body {
            RecordBody::ClaimRelease { claim } => {
                self.released.insert(claim.clone());
            }
            RecordBody::Withdrawal { withdraws, .. } => self.take_down(withdraws, r.at),
            RecordBody::Signature { agreement, party } => {
                self.signatures.entry(agreement.clone()).or_default().push((party.clone(), r.at));
            }
            RecordBody::Notice { agreement, party, .. } => {
                self.notices.entry(agreement.clone()).or_default().push((party.clone(), r.at));
            }
            RecordBody::Statement { kind, data, practice, assertion, offer, .. } => {
                // A statement that says it replaces an earlier one of the same kind from whoever it speaks for (an
                // amended law): the earlier one no longer stands for this reader, whether or not its withdrawal is
                // among what it is shown.
                if let Some(old_id) = data.as_ref().and_then(|d| d.get("replaces")).and_then(Value::as_str) {
                    let same = self.get(old_id).is_some_and(|old| {
                        matches!(&old.body, RecordBody::Statement { kind: k, .. } if k == kind)
                            && old.speaks_for.is_some()
                            && old.speaks_for == r.speaks_for
                    });
                    if same {
                        self.replaced_by.insert(old_id.to_string(), r.id.clone());
                        self.take_down(&old_id.to_string(), r.at);
                    }
                }
                if !self.withdrawn.contains(&r.id) {
                    if practice.is_some() {
                        self.with_practice.push(i);
                    }
                    if assertion.is_some() {
                        self.with_assertion.push(i);
                    }
                    if hears(offer.as_ref()) {
                        self.with_hears.push(i);
                    }
                }
            }
            _ => {}
        }
    }

    fn take_down(&mut self, id: &String, at: i64) {
        if self.withdrawn.insert(id.clone()) {
            if let Some(&i) = self.place.get(&key(id)) {
                if let RecordBody::Statement { kind, .. } = &self.seen[i as usize].body {
                    if let Some((_, l)) = self.kinds.get_mut(kind) {
                        l.retain(|x| *x != i);
                    }
                }
                self.with_practice.retain(|x| *x != i);
                self.with_assertion.retain(|x| *x != i);
                self.with_hears.retain(|x| *x != i);
            }
        }
        self.withdrawn_at.entry(id.clone()).or_insert(at);
    }

    fn list<'a>(&'a self, idx: Option<&'a Vec<u32>>) -> impl DoubleEndedIterator<Item = &'a Arc<Record>> + ExactSizeIterator + 'a {
        idx.map(Vec::as_slice).unwrap_or(&[]).iter().map(move |i| &self.seen[*i as usize])
    }

    // ---- letting go (a person's bounded memory of public goings-on: citizen/memory.rs)

    /// Lets go of every record `keep` says no to, as if it had never been seen: it is no longer among what the book
    /// answers, and its place is given up. What it did when taken in stays done (a withdrawal it made still stands),
    /// except that a withdrawal let go of is no longer known, nor the withdrawn record it named if that is let go too.
    /// Returns, for each old place in the order seen, its new place (none: let go), for whoever keeps a place in the
    /// book (`records().skip(n)`). Deterministic: the order of what is kept is the order seen.
    pub fn forget(&mut self, keep: impl Fn(&Record) -> bool) -> Vec<Option<u32>> {
        // Only a statement, or a withdrawal, is ever let go: what else a book holds (an agreement, a signature, a claim)
        // is a party's own. And never a paper that made a kept one stand down (its withdrawal, what replaced it): a book
        // saved and restored takes its records in again, and must stand where it stood.
        let mut keeps: Vec<bool> = self.seen.iter().map(|r| !matches!(r.body, RecordBody::Statement { .. } | RecordBody::Withdrawal { .. }) || keep(r)).collect();
        for (i, r) in self.seen.iter().enumerate() {
            if keeps[i] {
                continue;
            }
            let names = match &r.body {
                RecordBody::Withdrawal { withdraws, .. } => Some(withdraws.as_str()),
                RecordBody::Statement { data, .. } => data.as_ref().and_then(|d| d.get("replaces")).and_then(Value::as_str),
                _ => None,
            };
            if names.and_then(|id| self.place.get(&key(id))).is_some_and(|&j| keeps[j as usize]) {
                keeps[i] = true;
            }
        }
        let mut remap: Vec<Option<u32>> = Vec::with_capacity(self.seen.len());
        let mut kept: Vec<Arc<Record>> = Vec::with_capacity(self.seen.len());
        let mut gone: Vec<Arc<Record>> = vec![];
        for (i, r) in std::mem::take(&mut self.seen).into_iter().enumerate() {
            if keeps[i] {
                remap.push(Some(kept.len() as u32));
                kept.push(r);
            } else {
                remap.push(None);
                gone.push(r);
            }
        }
        if gone.is_empty() {
            self.seen = kept;
            return remap;
        }
        let map = |v: &mut Vec<u32>| v.retain_mut(|i| match remap[*i as usize] {
            Some(n) => {
                *i = n;
                true
            }
            None => false,
        });
        let maps = |m: &mut BTreeMap<String, Vec<u32>>| {
            for v in m.values_mut() {
                map(v);
            }
            m.retain(|_, v| !v.is_empty());
        };
        for (all, standing) in self.kinds.values_mut() {
            map(all);
            map(standing);
        }
        // (What stands of a kind is of what was seen of it: none seen, none standing.)
        self.kinds.retain(|_, v| !v.0.is_empty());
        maps(&mut self.claims_holder);
        maps(&mut self.claims_counterparty);
        maps(&mut self.claims_object);
        maps(&mut self.lots_over);
        for v in self.types.values_mut() {
            map(v);
        }
        self.types.retain(|_, v| !v.is_empty());
        map(&mut self.with_practice);
        map(&mut self.with_assertion);
        map(&mut self.with_hears);
        self.place.remove_all(gone.iter().map(|r| key(&r.id)));
        for i in self.place.values_mut() {
            *i = remap[*i as usize].unwrap_or_else(|| unreachable!("a place kept for a record let go"));
        }
        // (A withdrawal let go of, and what it withdrew if that is not kept either: no longer known.)
        for r in &gone {
            let named = match &r.body {
                RecordBody::Withdrawal { withdraws, .. } => Some(withdraws.clone()),
                RecordBody::Statement { data, .. } => data.as_ref().and_then(|d| d.get("replaces")).and_then(Value::as_str).map(str::to_string),
                _ => None,
            };
            if let Some(id) = named.filter(|id| !self.place.contains_key(&key(id))) {
                self.withdrawn.remove(&id);
                self.withdrawn_at.remove(&id);
                if self.replaced_by.get(&id) == Some(&r.id) {
                    self.replaced_by.remove(&id);
                }
            }
        }
        self.seen = kept;
        remap
    }

    // ---- what it has seen

    /// The record of an id, as first seen.
    pub fn get(&self, id: &str) -> Option<&Arc<Record>> {
        self.place.get(&key(id)).map(|i| &self.seen[*i as usize])
    }
    pub fn has(&self, id: &str) -> bool {
        self.place.contains_key(&key(id))
    }
    /// How many records it has seen.
    pub fn len(&self) -> usize {
        self.seen.len()
    }
    pub fn is_empty(&self) -> bool {
        self.seen.is_empty()
    }
    /// Every record, in the order seen.
    pub fn records(&self) -> impl DoubleEndedIterator<Item = &Arc<Record>> {
        self.seen.iter()
    }
    /// How many records of each statement kind (and of each other record type) it holds: for whoever measures memory.
    pub fn counts(&self) -> BTreeMap<String, u64> {
        let mut out: BTreeMap<String, u64> = self.kinds.iter().map(|(k, v)| (k.clone(), v.0.len() as u64)).collect();
        for (t, v) in &self.types {
            if *t != "statement" {
                out.insert(format!("[{t}]"), v.len() as u64);
            }
        }
        out
    }
    /// Where a record stands in the order seen (none: not seen).
    pub fn place_of(&self, id: &str) -> Option<usize> {
        self.place.get(&key(id)).map(|i| *i as usize)
    }

    /// Every statement of a kind seen, withdrawn or not, in the order seen.
    pub fn all(&self, kind: &str) -> impl DoubleEndedIterator<Item = &Arc<Record>> + ExactSizeIterator {
        self.list(self.kinds.get(kind).map(|v| &v.0))
    }
    /// Statements of a kind still standing (not withdrawn), in the order seen.
    pub fn open(&self, kind: &str) -> impl DoubleEndedIterator<Item = &Arc<Record>> + ExactSizeIterator {
        self.list(self.kinds.get(kind).map(|v| &v.1))
    }
    /// Records of a type (`agreement`, `claim`, `notice`, `vote`...), in the order seen.
    pub fn of_type(&self, record: &str) -> impl DoubleEndedIterator<Item = &Arc<Record>> + ExactSizeIterator {
        self.list(self.types.get(record))
    }
    /// The claims whose holder, counterparty or object is this, in the order seen.
    pub fn claims_by(&self, by: ClaimKey, value: &str) -> impl DoubleEndedIterator<Item = &Arc<Record>> + ExactSizeIterator {
        self.list(match by {
            ClaimKey::Holder => self.claims_holder.get(value),
            ClaimKey::Counterparty => self.claims_counterparty.get(value),
            ClaimKey::Object => self.claims_object.get(value),
        })
    }
    /// The standing lot (a statement of kind `lot`) that covers a cell: of several, the first seen.
    pub fn lot_over(&self, cell: &str) -> Option<&Arc<Record>> {
        self.list(self.lots_over.get(cell)).find(|l| !self.withdrawn.contains(&l.id))
    }
    /// Statements carrying a practice (a gathering), still standing, in the order seen.
    pub fn practices(&self) -> impl Iterator<Item = &Arc<Record>> {
        self.list(Some(&self.with_practice))
    }
    /// Statements whose offer says what its offerer hears (a desk, a group that takes up grievances), standing.
    pub fn hearings(&self) -> impl Iterator<Item = &Arc<Record>> {
        self.list(Some(&self.with_hears))
    }
    /// Statements put forward to be believed (an assertion), not withdrawn.
    pub fn assertions(&self) -> impl Iterator<Item = &Arc<Record>> {
        self.list(Some(&self.with_assertion))
    }

    // ---- what stands

    /// Seen to be withdrawn (or replaced).
    pub fn withdrawn(&self, id: &str) -> bool {
        self.withdrawn.contains(id)
    }
    /// When a record seen to be withdrawn (or replaced) stopped standing.
    pub fn withdrawn_at(&self, id: &str) -> Option<i64> {
        self.withdrawn_at.get(id).copied()
    }
    /// What replaced a record (an amended law), if a later one of the same kind from the same speaker said so.
    pub fn replaced_by(&self, id: &str) -> Option<&str> {
        self.replaced_by.get(id).map(String::as_str)
    }
    /// The record in force that an id names now: itself while it stands, or what has replaced it (and what replaced
    /// that), if that stands. None: never seen, or withdrawn with nothing in its place.
    pub fn current(&self, id: &str) -> Option<&Arc<Record>> {
        let mut at = id;
        for _ in 0..1000 {
            match self.replaced_by.get(at) {
                Some(n) => at = n,
                None => break,
            }
        }
        if self.withdrawn.contains(at) {
            None
        } else {
            self.get(at)
        }
    }
    /// Seen to be withdrawn, with nothing standing in its place (a law repealed, a procedure revoked).
    pub fn repealed(&self, id: &str) -> bool {
        self.withdrawn.contains(id) && self.current(id).is_none()
    }
    /// Is a standing paper on hold: does a standing `hold` name it, made in the name of whoever the paper speaks for
    /// (or, with `by`, of one of those)? Whoever acts on a standing paper asks this first.
    pub fn on_hold(&self, id: &str, by: Option<&[String]>) -> bool {
        let own;
        let whose: &[String] = match by {
            Some(b) => b,
            None => {
                own = self.get(id).and_then(|r| r.speaks_for.clone()).into_iter().collect::<Vec<_>>();
                &own
            }
        };
        self.open("hold").any(|h| {
            h.speaks_for.as_ref().is_some_and(|s| whose.contains(s))
                && super::data(h).get("holds").and_then(Value::as_array).is_some_and(|l| l.iter().any(|x| x.as_str() == Some(id)))
        })
    }
    /// A claim seen to be released.
    pub fn released(&self, claim: &str) -> bool {
        self.released.contains(claim)
    }

    // ---- agreements

    pub fn signed_by(&self, agreement: &str, party: &str) -> bool {
        self.signatures.get(agreement).is_some_and(|s| s.iter().any(|(p, _)| p == party))
    }
    /// Each party's first signature on an agreement.
    fn first_signed(&self, agreement: &str, party: &str) -> Option<i64> {
        self.signatures.get(agreement).and_then(|s| s.iter().filter(|(p, _)| p == party).map(|(_, t)| *t).min())
    }
    fn parties<'a>(&'a self, agreement: &str) -> Option<&'a [String]> {
        match &self.get(agreement)?.body {
            RecordBody::Agreement { terms } => Some(&terms.parties),
            _ => None,
        }
    }
    /// An offer taken back by whoever made it before every party had signed it: it can no longer be signed, and a
    /// signature after it was withdrawn concludes nothing (docs/behaviour/offers.md).
    pub fn taken_back(&self, agreement: &str) -> bool {
        let (Some(at), Some(parties)) = (self.withdrawn_at.get(agreement), self.parties(agreement)) else { return false };
        !parties.iter().all(|p| self.first_signed(agreement, p).is_some_and(|t| t <= *at))
    }
    /// Concluded: signed by every party (whether or not it has since ended), not taken back before the last signed.
    pub fn concluded(&self, agreement: &str) -> bool {
        self.parties(agreement).is_some_and(|ps| ps.iter().all(|p| self.signed_by(agreement, p))) && !self.taken_back(agreement)
    }
    /// In force now: by its reading, if one came with it; otherwise, concluded.
    pub fn in_force(&self, agreement: &str) -> bool {
        if self.taken_back(agreement) {
            return false;
        }
        match self.readings.get(agreement) {
            Some(r) => (r.status == "in_force" || r.status == "ending") && r.ends_at.is_none_or(|e| self.now < e),
            None => self.concluded(agreement),
        }
    }
    /// When it ends by its reading, if one came with it and it has an end.
    pub fn ends_at(&self, agreement: &str) -> Option<i64> {
        self.readings.get(agreement).and_then(|r| r.ends_at)
    }
    /// The agreement's reading as last delivered.
    pub fn reading(&self, agreement: &str) -> Option<&Reading> {
        self.readings.get(agreement)
    }
    /// The time the last party signed, if all have.
    pub fn signed_at(&self, agreement: &str) -> Option<i64> {
        if !self.concluded(agreement) {
            return None;
        }
        self.signatures.get(agreement).and_then(|s| s.iter().map(|(_, t)| *t).max())
    }
    /// The notices given on an agreement, in the order seen.
    pub fn notices(&self, agreement: &str) -> impl Iterator<Item = NoticeSeen<'_>> {
        self.notices.get(agreement).into_iter().flatten().map(|(p, at)| NoticeSeen { party: p, at: *at })
    }

    // ---- who is who (from directories)

    /// The entity a record was made for: the organisation of the position it was made in, or its author's person.
    pub fn author_entity<'a>(&'a self, r: &'a Record) -> Option<&'a str> {
        if r.author == oikos_contracts::blocks::GENESIS {
            return r.speaks_for.as_deref();
        }
        match &r.position {
            Some(p) => self.positions.get(p).map(|x| x.entity.as_str()),
            None => self.participant_person.get(&r.author).map(String::as_str),
        }
    }
    /// The entities of a kind it has looked up, in id order.
    pub fn entities_of_kind(&self, kind: &str) -> Vec<&str> {
        self.entity_kind.iter().filter(|(_, k)| *k == kind).map(|(e, _)| e.as_str()).collect()
    }
    pub fn position(&self, position: &str) -> Option<&PositionSeen> {
        self.positions.get(position)
    }
    pub fn positions(&self) -> &BTreeMap<String, PositionSeen> {
        &self.positions
    }
    pub fn person_of(&self, participant: &str) -> Option<&str> {
        self.participant_person.get(participant).map(String::as_str)
    }
    /// A participant that acts as this person, if one has been looked up (the first in id order).
    pub fn participant_of(&self, person: &str) -> Option<&str> {
        self.participant_person.iter().find(|(_, who)| who.as_str() == person).map(|(p, _)| p.as_str())
    }
    pub fn entity_kind(&self, entity: &str) -> Option<&str> {
        self.entity_kind.get(entity).map(String::as_str)
    }

    // ---- laws that could not be read

    /// A law's condition gave an error, not an answer, against an act: counted, and to be said (once per law).
    pub fn note_unread(&mut self, law: &str, what: &str, error: &str) {
        let times = self.unread.entry(law.to_string()).or_insert(0);
        *times += 1;
        if *times == 1 {
            let e: String = error.chars().take(200).collect();
            self.unread_to_say.push(format!("{law} couldn't be read against {what} ({e}), so it wasn't applied"));
        }
    }
    /// How many times a law could not be read against an act.
    pub fn unread(&self, law: &str) -> u64 {
        self.unread.get(law).copied().unwrap_or(0)
    }
    /// What has not been said yet of laws that could not be read, as a sentence for a reason (then it has been said).
    pub fn take_unread(&mut self) -> Option<String> {
        if self.unread_to_say.is_empty() {
            return None;
        }
        Some(format!("(A law that can't be read against an act doesn't bind it: {}.)", std::mem::take(&mut self.unread_to_say).join("; ")))
    }

    // ---- snapshots

    /// The book as a snapshot keeps it.
    pub fn save(&self) -> Value {
        let s = Saved {
            records: self.seen.iter().map(|r| (**r).clone()).collect(),
            readings: self.readings.clone(),
            participant_person: self.participant_person.clone(),
            positions: self.positions.clone(),
            entity_kind: self.entity_kind.clone(),
            unread: self.unread.clone(),
            unread_to_say: self.unread_to_say.clone(),
            now: self.now,
        };
        serde_json::to_value(s).unwrap_or(Value::Null)
    }
    /// A book as `save` left it: the records taken in again in the order seen, which rebuilds every index exactly.
    pub fn restore(v: Value) -> Result<Book, String> {
        let s: Saved = serde_json::from_value(v).map_err(|e| format!("a saved book: {e}"))?;
        let mut b = Book::new();
        let records: Vec<Arc<Record>> = s.records.into_iter().map(Arc::new).collect();
        b.take_all(records.iter());
        b.readings = s.readings;
        b.participant_person = s.participant_person;
        b.positions = s.positions;
        b.entity_kind = s.entity_kind;
        b.unread = s.unread;
        b.unread_to_say = s.unread_to_say;
        b.now = s.now;
        Ok(b)
    }
}

impl Serialize for Book {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.save().serialize(s)
    }
}
impl<'de> Deserialize<'de> for Book {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Book::restore(Value::deserialize(d)?).map_err(serde::de::Error::custom)
    }
}
