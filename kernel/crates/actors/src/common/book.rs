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
    place: BTreeMap<Key, u32>,
    types: BTreeMap<&'static str, Vec<u32>>,
    kinds: BTreeMap<String, Vec<u32>>,
    /// Statements of each kind not withdrawn, in the order seen.
    standing: BTreeMap<String, Vec<u32>>,
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
    last_directory: Option<usize>,
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
                let at = Arc::as_ptr(positions) as usize ^ Arc::as_ptr(entities) as usize;
                if self.last_directory == Some(at) {
                    continue;
                }
                self.last_directory = Some(at);
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
                self.kinds.entry(kind.clone()).or_default().push(i);
                if !self.withdrawn.contains(&r.id) {
                    self.standing.entry(kind.clone()).or_default().push(i);
                }
                if kind == "lot" {
                    if let Some(cells) = data.as_ref().and_then(|d| d.get("cells")).and_then(Value::as_array) {
                        let cells: BTreeSet<&str> = cells.iter().filter_map(Value::as_str).collect();
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
                    if let Some(l) = self.standing.get_mut(kind) {
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
    /// Where a record stands in the order seen (none: not seen).
    pub fn place_of(&self, id: &str) -> Option<usize> {
        self.place.get(&key(id)).map(|i| *i as usize)
    }

    /// Every statement of a kind seen, withdrawn or not, in the order seen.
    pub fn all(&self, kind: &str) -> impl DoubleEndedIterator<Item = &Arc<Record>> + ExactSizeIterator {
        self.list(self.kinds.get(kind))
    }
    /// Statements of a kind still standing (not withdrawn), in the order seen.
    pub fn open(&self, kind: &str) -> impl DoubleEndedIterator<Item = &Arc<Record>> + ExactSizeIterator {
        self.list(self.standing.get(kind))
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
