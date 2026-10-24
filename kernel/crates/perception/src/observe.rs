//! Observations (v0.4), mirroring the Observation definition in
//! contracts/participant-api.schema.json. A participant perceives only through
//! channels: its own (a person's view of its own life) and those of each
//! position it holds (what the role sees), plus its inbox, the outcomes of its
//! own acts, and (for a person's) its own body. A record only ever appears if
//! its visibility lets the capacity's entity see it. The kernel builds
//! everything except `drafts`, which the orchestrator adds from the
//! translator; the observation hash in the log covers the kernel-built
//! observation (with `drafts: []`).
//!
//! Channel paths: a personal channel is its id; a position's is `<position>/<channel>`.

use crate::blocks::{Id, Record};
use crate::config::{cell_id, Area, Channel, ChannelKind, CmpOp, LookRequest, Occupants, ParticipantKind, Query, RecordFilter, Way, Who, SELF};
use crate::geo::{within, Rect};
use crate::state::{Look, Message, Outcome, ParticipantStatus, State, Transaction};
use crate::statics::Statics;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Observation {
    pub participant: Id,
    pub t: i64,
    pub status: ParticipantStatus,
    /// A person's participant: its person.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity: Option<Id>,
    /// A person's participant: its own body, in full.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<BodyView>,
    /// The positions it holds now.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub positions: Vec<HeldPosition>,
    pub outcomes: Vec<Outcome>,
    pub inbox: Vec<Message>,
    pub drafts: Vec<Value>,
    pub channels: BTreeMap<Id, ChannelData>,
    /// The channels this participant (in the capacities this observation covers) has put a question to a keeper through,
    /// not yet answered (foundations F11): the answer comes with an observation of its own, when the keeper has done it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub asking: Vec<Id>,
    /// Readings of the agreements this observation brings (an agreement, or a signature or notice on one), by their own
    /// terms (contracts 0.7; docs/design/rebuild.md section 7): beside the records, never in their place.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub readings: BTreeMap<Id, oikos_terms::Reading>,
}

/// A condition as its body knows it: what, how bad, since and until when, and whether it's been treated. Never
/// whether, or when, it will kill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConditionView {
    pub id: Id,
    pub kind: crate::state::ConditionKind,
    pub severity: String,
    pub since: i64,
    pub until: i64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub treated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BodyView {
    pub born_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sex: Option<crate::state::Sex>,
    pub present: bool,
    pub alive: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parents: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditions: Vec<ConditionView>,
    /// Its variables (the world's `body_variables`), as they are now.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub variables: BTreeMap<Id, i64>,
    /// The space it's in (one at a time), if any (world-expansion 6.4).
    #[serde(default, rename = "in", skip_serializing_if = "Option::is_none")]
    pub in_space: Option<Id>,
    /// Its children, as a parent knows them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<ChildView>,
}

/// A child, as their parent knows them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChildView {
    pub person: Id,
    pub born_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sex: Option<crate::state::Sex>,
    pub alive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeldPosition {
    pub position: Id,
    pub entity: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

/// An entity's own record as it is shown to it: how many times it has been set, when last, and what it holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnRecord {
    pub n: u64,
    pub at: i64,
    pub sections: std::collections::BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChannelData {
    Accounts { accounts: Vec<AccountItem>, transactions: Vec<Transaction> },
    Holdings { holdings: Vec<HoldingItem> },
    /// The entity's own record, when it has changed since the last look (or in the full picture); absent otherwise.
    OwnRecord {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        record: Option<OwnRecord>,
    },
    Records {
        /// (The state's own records, shared: a record is immutable once made, and one is shown to many.)
        records: Vec<Arc<Record>>,
        /// Set when these are a search's results (what matches now), not what's new since the last look.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        search: Option<bool>,
        /// Set when the capacity's entity has moved: everything the channel now covers, in place of what it covered before.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        whole: Option<bool>,
    },
    Sites {
        as_of: i64,
        cells: Vec<SiteCell>,
        /// As for records: the whole of the new surroundings, in place of the old.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        whole: Option<bool>,
        /// Set when this is what a visit found: the places gone to, as they were at `as_of` (docs/design/knowing.md).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        visited: Option<bool>,
    },
    Directory { entities: Vec<EntityItem>, positions: Vec<PositionItem> },
}

/// A holding the capacity's entity has: how much of a kind, where (0: it's all gone from there).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HoldingItem {
    pub kind: Id,
    pub at: Id,
    #[serde(with = "crate::money::amount")]
    pub quantity: crate::money::Money,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountItem {
    pub account: Id,
    pub holder: Id,
    pub custodian: Id,
    pub currency: Id,
    #[serde(with = "crate::money::amount")]
    pub balance: crate::money::Money,
    /// Set when the account has been closed since the last look.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed: Option<bool>,
}

pub use crate::sites::{SiteCell, SiteSpace, SiteStructure, VariableView};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityItem {
    pub entity: Id,
    pub kind: String,
    pub name: String,
    /// A person's participant (who acts as them), as a registry of people knows them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participant: Option<Id>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PositionItem {
    pub position: Id,
    pub entity: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// Who holds it: the participant, and the person (for a person's) or its title (for a system).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holder: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub held_by: Option<String>,
}

/// Can those acting for `entity` perceive this record? The author's entity always can.
pub fn can_see(st: &State, rec: &Record, entity: &str) -> bool {
    rec.visible_to.allows(entity) || st.author_entity(rec).as_deref() == Some(entity)
}

/// Where a record physically is: the cell a statement was put up on, and the same place for
/// taking it down (a withdrawal of a placed statement).
pub fn place_of<'a>(st: &'a State, rec: &'a Record) -> Option<&'a Id> {
    match &rec.body {
        crate::blocks::RecordBody::Statement { place, .. } => place.as_ref(),
        crate::blocks::RecordBody::Withdrawal { withdraws, .. } => match &st.records.get(withdraws)?.record.body {
            crate::blocks::RecordBody::Statement { place, .. } => place.as_ref(),
            _ => None,
        },
        _ => None,
    }
}

/// Can this channel show the record, as far as place goes? A channel with an area sees what's
/// placed there; one without sees what isn't placed anywhere, and what its own entity put up.
fn placed_ok(st: &State, rec: &Record, me: &str, area: Option<&Scope>) -> bool {
    match (place_of(st, rec), area) {
        (None, None) => true,
        (None, Some(_)) => false,
        (Some(p), Some(scope)) => scope.covers(p),
        (Some(_), None) => st.author_entity(rec).as_deref() == Some(me) || rec.speaks_for.as_deref() == Some(me),
    }
}

/// The cells an area covers for a capacity, now.
#[derive(Debug)]
enum Scope {
    Everywhere,
    Cells(std::sync::Arc<BTreeSet<Id>>),
}

impl Scope {
    fn covers(&self, p: &str) -> bool {
        match self {
            Scope::Everywhere => true,
            Scope::Cells(ps) => ps.contains(p),
        }
    }
}

/// Entities a record involves: those it names, its author's entity, and (one
/// hop) those named by any record it refers to. A signature on my agreement,
/// or a withdrawal of my listing, involves me (D32).
fn involved(st: &State, rec: &Record) -> Vec<String> {
    let mut v: Vec<String> = rec.entities_named().into_iter().map(String::from).chain(st.author_entity(rec)).collect();
    for other in rec.body.records_referenced() {
        if let Some(o) = st.records.get(other) {
            v.extend(o.record.entities_named().into_iter().map(String::from));
            v.extend(st.author_entity(&o.record));
        }
    }
    v
}

/// The record a withdrawal takes down: the one it names, if whoever withdraws it is its own author's entity or
/// whoever it speaks for (anyone may record that they "withdraw" anything; only its owner ends its standing).
fn taken_down<'a>(st: &'a State, rec: &Record) -> Option<&'a crate::state::Stored> {
    let crate::blocks::RecordBody::Withdrawal { withdraws, .. } = &rec.body else { return None };
    let target = st.records.get(withdraws)?;
    let owner = |r: &Record| -> Vec<String> { r.speaks_for.iter().cloned().chain(st.author_entity(r)).collect() };
    let by = owner(rec);
    owner(&target.record).iter().any(|o| by.contains(o)).then_some(target)
}

/// Does a channel's filter show this record? `news`: what a look delivers, where a statement being taken down is
/// news to whoever is shown statements like it: its withdrawal passes the filter's `statement_kinds` and `has` if
/// the statement does (a book of laws shows a law's repeal). A search finds the records themselves, as they are.
fn matches(st: &State, rec: &Record, f: &RecordFilter, want: Option<&Want>, news: bool) -> bool {
    if f.records.as_ref().is_some_and(|k| !k.iter().any(|x| x == rec.body.kind_name())) {
        return false;
    }
    // (What the filter's `statement_kinds` and `has` are asked of: the record, or the statement it takes down.)
    let rec_itself = rec;
    let rec = if news && (f.statement_kinds.is_some() || f.has.is_some()) { taken_down(st, rec).map_or(rec, |t| &*t.record) } else { rec };
    if let Some(kinds) = &f.statement_kinds {
        match &rec.body {
            crate::blocks::RecordBody::Statement { kind, .. } if kinds.contains(kind) => {}
            _ => return false,
        }
    }
    if let Some(has) = &f.has {
        match &rec.body {
            crate::blocks::RecordBody::Statement { offer, practice, assertion, registry, adico, formal, .. }
                if has.iter().all(|h| match h.as_str() {
                    "offer" => offer.is_some(),
                    "practice" => practice.is_some(),
                    "assertion" => assertion.is_some(),
                    "registry" => registry.is_some(),
                    "adico" => adico.is_some(),
                    "formal" => formal.is_some(),
                    // (An offer that says what its offerer hears: a desk, a list, a group that takes up grievances.)
                    "hears" => offer.as_ref().is_some_and(|o| o.get("hears").is_some()),
                    _ => false,
                }) => {}
            _ => return false,
        }
    }
    match want {
        // Its own: a record that involves it.
        Some(Want::Involving(want)) => involved(st, rec_itself).iter().any(|e| want.contains(e.as_str())),
        // A named publisher's: what it put out itself (it speaks for them, or one of theirs wrote it).
        Some(Want::From(from)) => rec_itself.speaks_for.as_deref().is_some_and(|e| from.contains(e)) || st.author_entity(rec_itself).is_some_and(|e| from.contains(e.as_str())),
        None => true,
    }
}

/// Whose records a channel shows, where its way says: its own (`mine`: those involving its entity), or what named
/// publishers put out (`published`, `from`).
enum Want<'a> {
    Involving(BTreeSet<&'a str>),
    From(BTreeSet<&'a str>),
}

impl<'a> Want<'a> {
    fn of(way: Way, from: Option<&'a Vec<Id>>, me: &'a str) -> Option<Want<'a>> {
        match (way, from) {
            (Way::Mine, _) => Some(Want::Involving([me].into_iter().collect())),
            (Way::Published, Some(from)) => Some(Want::From(from.iter().map(|e| if e == SELF { me } else { e.as_str() }).collect())),
            _ => None,
        }
    }

    /// The entities whose records are candidates (a superset: the full filter still decides).
    fn entities(&self) -> &BTreeSet<&'a str> {
        match self {
            Want::Involving(w) | Want::From(w) => w,
        }
    }
}

/// A lookup of records by record kind, statement kind and involved entity,
/// so a channel reads only its candidates instead of every record. It is
/// derived from the state (never part of it, never hashed), built as
/// records appear. Records are append-only and a record's involvement is
/// fixed when it's made (what it refers to must already exist), so indexing
/// once gives the same answer as looking again later. Every lookup is a
/// superset of the channel's matches; the full filter still decides.
#[derive(Debug, Default)]
pub struct RecordIndex {
    indexed: usize,
    /// The records in the order they were made (record with seq q is `by_seq[q - 1]`): the state's own, shared.
    by_seq: Vec<Arc<Record>>,
    by_record: BTreeMap<&'static str, Vec<u64>>,
    by_kind: BTreeMap<String, Vec<u64>>,
    by_entity: BTreeMap<String, Vec<u64>>,
    /// Statements by the structured fields they carry (what a channel's `has` asks for): a practice, an offer...
    by_has: BTreeMap<&'static str, Vec<u64>>,
    /// Records still standing (not withdrawn by their own author or whoever they speak for), by
    /// statement kind and by record kind: what a search for standing records scans.
    standing_kind: BTreeMap<String, BTreeSet<u64>>,
    standing_record: BTreeMap<&'static str, BTreeSet<u64>>,
    /// cell -> records placed there (and withdrawals of them).
    by_place: BTreeMap<Id, Vec<u64>>,
    /// The latest record placed anywhere (0: none).
    placed_last: u64,
    accounts: Option<AccountsByEntity>,
    /// Which accounts, entities and positions have changed, and when (their change stamps): what a channel that
    /// delivers changes reads, where going through every one would cost more.
    account_changes: Changes<Arc<crate::state::Account>>,
    entity_changes: Changes<crate::state::Entity>,
    position_changes: Changes<crate::state::Position>,
    /// The cells areas cover, as worked out so far. (Behind a lock: observations of one moment may be built at once,
    /// `observe_prepared`, and each answer here is the same whoever works it out first. Read far more than written:
    /// readers don't wait for each other.)
    scopes: std::sync::RwLock<Scopes>,
}

/// The cells areas cover, kept from the first time each is worked out: each the same for the whole run.
#[derive(Debug, Default)]
struct Scopes {
    /// (the footprints of the buildings a body is in, how near) -> the cells within that of them. By where, not by
    /// whom: everyone in a building has the same surroundings, worked out once, and nothing is redone when a body moves
    /// to somewhere a body has been before.
    near: BTreeMap<(Vec<(i64, i64, i64, i64)>, i64), std::sync::Arc<BTreeSet<Id>>>,
    /// place -> its cells, and a channel's list of cells -> the same as a set.
    place_cells: BTreeMap<Id, std::sync::Arc<BTreeSet<Id>>>,
    listed_cells: BTreeMap<Vec<Id>, std::sync::Arc<BTreeSet<Id>>>,
}

/// Which of a map's values have changed, by change stamp: kept by comparing the map as it is with the map as it was
/// at the last look (the state's maps are persistent, and the two share everything untouched between them, so only
/// what was touched is compared). Derived from the state (never part of it, never hashed). It answers "which ids
/// might have a stamp above this one" without going through the map; whoever asks still reads each one's stamp.
#[derive(Debug)]
struct Changes<V> {
    /// The map at the last look, and the state's change stamp then.
    seen: Option<crate::state::Map<Id, V>>,
    synced: u64,
    /// The stamp at the first look: changes after it are all in `log`.
    from: u64,
    /// Ids, numbered as they first appear in `log`.
    ids: Vec<Id>,
    numbers: BTreeMap<Id, u32>,
    /// (stamp, id's number), in stamp order: an id's value had that stamp at some look.
    log: Vec<(u64, u32)>,
}

impl<V> Default for Changes<V> {
    fn default() -> Self {
        Changes { seen: None, synced: 0, from: 0, ids: vec![], numbers: BTreeMap::new(), log: vec![] }
    }
}

impl<V: Clone + PartialEq> Changes<V> {
    /// Take in the map as it is now, at the state's change stamp `stamp`; `changed`: a value's own stamp.
    fn sync(&mut self, now: &crate::state::Map<Id, V>, stamp: u64, changed: impl Fn(&V) -> u64) {
        // (Stamps only go up in one world: a map from before the last look is another world's, and starts afresh.)
        if stamp < self.synced {
            *self = Changes::default();
        }
        match &self.seen {
            None => self.from = stamp,
            Some(seen) if seen.ptr_eq(now) => return,
            Some(seen) => {
                let start = self.log.len();
                for d in seen.diff(now) {
                    let (id, v) = match d {
                        imbl::ordmap::DiffItem::Add(id, v) | imbl::ordmap::DiffItem::Update { new: (id, v), .. } => (id, v),
                        imbl::ordmap::DiffItem::Remove(..) => continue,
                    };
                    let c = changed(v);
                    if c > self.synced {
                        let n = match self.numbers.get(id) {
                            Some(n) => *n,
                            None => {
                                let n = self.ids.len() as u32;
                                self.ids.push(id.clone());
                                self.numbers.insert(id.clone(), n);
                                n
                            }
                        };
                        self.log.push((c, n));
                    }
                }
                self.log[start..].sort_unstable();
            }
        }
        self.seen = Some(now.clone());
        self.synced = stamp;
    }

    /// The log's entries with a stamp above `after`; None if it doesn't go back that far, or `now` isn't the map last
    /// taken in (`sync`).
    fn tail(&self, now: &crate::state::Map<Id, V>, after: u64) -> Option<&[(u64, u32)]> {
        (self.seen.as_ref().is_some_and(|seen| seen.ptr_eq(now)) && after >= self.from).then(|| &self.log[self.log.partition_point(|(c, _)| *c <= after)..])
    }

    /// Every id whose value's stamp in `now` is above `after` (and perhaps others), in id order, if that's known and
    /// there are at most `most` entries to go through.
    fn since(&self, now: &crate::state::Map<Id, V>, after: u64, most: usize) -> Option<Vec<&Id>> {
        let tail = self.tail(now, after).filter(|t| t.len() <= most)?;
        let mut numbers: Vec<u32> = tail.iter().map(|(_, n)| *n).collect();
        numbers.sort_unstable();
        numbers.dedup();
        let mut ids: Vec<&Id> = numbers.into_iter().map(|n| &self.ids[n as usize]).collect();
        ids.sort_unstable();
        Some(ids)
    }
}

/// entity -> accounts it holds or keeps, for the account set identified by
/// (accounts ever opened, accounts now open): accounts are only opened or
/// closed, never changed, so that pair pins the set down.
type AccountsByEntity = ((u64, usize), BTreeMap<Id, Vec<Id>>);

impl RecordIndex {
    fn catch_up(&mut self, st: &State) {
        // (Records are only ever added: an index that has seen more than the state holds was built from another world.)
        assert!(self.indexed <= st.record_order.len(), "the record index is ahead of the state it's asked about");
        for i in self.indexed..st.record_order.len() {
            let stored = &st.records[&st.record_order[i]];
            let (seq, rec) = (stored.seq, &*stored.record);
            self.by_seq.push(stored.record.clone());
            self.by_record.entry(rec.body.kind_name()).or_default().push(seq);
            if let crate::blocks::RecordBody::Statement { kind, offer, practice, assertion, registry, adico, formal, .. } = &rec.body {
                self.by_kind.entry(kind.clone()).or_default().push(seq);
                let carries = [("offer", offer.is_some()), ("practice", practice.is_some()), ("assertion", assertion.is_some()), ("registry", registry.is_some()), ("adico", adico.is_some()), ("formal", formal.is_some()), ("hears", offer.as_ref().is_some_and(|o| o.get("hears").is_some()))];
                for (field, _) in carries.into_iter().filter(|(_, x)| *x) {
                    self.by_has.entry(field).or_default().push(seq);
                }
            }
            let who: BTreeSet<String> = involved(st, rec).into_iter().collect();
            for e in who {
                self.by_entity.entry(e).or_default().push(seq);
            }
            if let Some(p) = place_of(st, rec) {
                self.by_place.entry(p.clone()).or_default().push(seq);
                self.placed_last = self.placed_last.max(seq);
            }
            // Everything stands when made, except a withdrawal: it takes something down.
            if !matches!(rec.body, crate::blocks::RecordBody::Withdrawal { .. }) {
                self.standing_record.entry(rec.body.kind_name()).or_default().insert(seq);
            }
            if let crate::blocks::RecordBody::Statement { kind, .. } = &rec.body {
                self.standing_kind.entry(kind.clone()).or_default().insert(seq);
            }
            // A withdrawal by the record's own author (or whoever it speaks for) ends its standing, and is news
            // wherever statements like the one it takes down are shown (`matches`): found by that statement's
            // kind and by the fields it carries.
            if let Some(target) = taken_down(st, rec) {
                let t = &*target.record;
                if let Some(set) = self.standing_record.get_mut(t.body.kind_name()) {
                    set.remove(&target.seq);
                }
                if let crate::blocks::RecordBody::Statement { kind, offer, practice, assertion, registry, adico, formal, .. } = &t.body {
                    if let Some(set) = self.standing_kind.get_mut(kind) {
                        set.remove(&target.seq);
                    }
                    self.by_kind.entry(kind.clone()).or_default().push(seq);
                    let carries = [("offer", offer.is_some()), ("practice", practice.is_some()), ("assertion", assertion.is_some()), ("registry", registry.is_some()), ("adico", adico.is_some()), ("formal", formal.is_some()), ("hears", offer.as_ref().is_some_and(|o| o.get("hears").is_some()))];
                    for (field, _) in carries.into_iter().filter(|(_, x)| *x) {
                        self.by_has.entry(field).or_default().push(seq);
                    }
                }
            }
        }
        self.indexed = st.record_order.len();
    }

    /// Sequence numbers above `after` that might match the filter, in order.
    fn candidates(&self, f: &RecordFilter, want: Option<&Want>, after: u64) -> Option<Vec<u64>> {
        fn tail(v: &[u64], after: u64) -> &[u64] {
            &v[v.partition_point(|&q| q <= after)..]
        }
        let mut options: Vec<Vec<&[u64]>> = vec![];
        if let Some(k) = &f.records {
            options.push(k.iter().filter_map(|x| self.by_record.get(x.as_str())).map(|v| tail(v, after)).collect());
        }
        if let Some(k) = &f.statement_kinds {
            options.push(k.iter().filter_map(|x| self.by_kind.get(x)).map(|v| tail(v, after)).collect());
        }
        if let Some(w) = want {
            options.push(w.entities().iter().filter_map(|e| self.by_entity.get(*e)).map(|v| tail(v, after)).collect());
        }
        // A statement must carry every field `has` names, so those carrying any one of them are enough to look through.
        for h in f.has.iter().flatten() {
            options.push(self.by_has.get(h.as_str()).map(|v| tail(v, after)).into_iter().collect());
        }
        let best = options.into_iter().min_by_key(|lists| lists.iter().map(|l| l.len()).sum::<usize>())?;
        let mut seqs: Vec<u64> = best.into_iter().flatten().copied().collect();
        seqs.sort_unstable();
        seqs.dedup();
        Some(seqs)
    }

    /// Standing records that might match the filter, newest first.
    fn standing(&self, f: &RecordFilter) -> Vec<u64> {
        let mut seqs: Vec<u64> = if let Some(kinds) = &f.statement_kinds {
            kinds.iter().filter_map(|k| self.standing_kind.get(k)).flatten().copied().collect()
        } else if let Some(kinds) = &f.records {
            kinds.iter().filter_map(|k| self.standing_record.get(k.as_str())).flatten().copied().collect()
        } else {
            self.standing_record.values().flatten().copied().collect()
        };
        seqs.sort_unstable_by(|a, b| b.cmp(a));
        seqs.dedup();
        seqs
    }

    /// Is this record still standing?
    fn is_standing(&self, rec: &Record, seq: u64) -> bool {
        self.standing_record.get(rec.body.kind_name()).is_some_and(|x| x.contains(&seq))
    }

    /// Records placed within the scope, above `after`, in order.
    fn placed(&self, scope: &Scope, after: u64) -> Vec<u64> {
        // (Nothing placed anywhere since: most looks, which ask for what is new. No cell is gone through for it.)
        if after >= self.placed_last {
            return vec![];
        }
        let mut seqs: Vec<u64> = vec![];
        let mut tail = |v: &Vec<u64>| {
            if v.last().is_some_and(|&q| q > after) {
                seqs.extend_from_slice(&v[v.partition_point(|&q| q <= after)..]);
            }
        };
        match scope {
            Scope::Everywhere => self.by_place.values().for_each(&mut tail),
            // (Whichever is fewer is gone through: the scope's cells, or the cells anything is placed on.)
            Scope::Cells(ps) if ps.len() <= self.by_place.len() => ps.iter().filter_map(|p| self.by_place.get(p)).for_each(&mut tail),
            Scope::Cells(ps) => self.by_place.iter().filter(|(p, _)| ps.contains(*p)).for_each(|(_, v)| tail(v)),
        }
        seqs.sort_unstable();
        #[cfg(debug_assertions)]
        {
            let plain = |v: &Vec<u64>| v[v.partition_point(|&q| q <= after)..].to_vec();
            let mut all: Vec<u64> = match scope {
                Scope::Everywhere => self.by_place.values().flat_map(plain).collect(),
                Scope::Cells(ps) => ps.iter().filter_map(|p| self.by_place.get(p)).flat_map(plain).collect(),
            };
            all.sort_unstable();
            assert_eq!(seqs, all, "what is placed in a scope, found the short way, isn't what going through every cell finds");
        }
        seqs
    }

    /// The cells an area covers for an entity, now. (Worked out without the lock held, then kept: two at once work
    /// out the same thing.)
    fn scope(&self, s: &Statics, st: &State, area: &Area, me: &str) -> Scope {
        let known = || self.scopes.read().unwrap_or_else(|e| e.into_inner());
        let keep = || self.scopes.write().unwrap_or_else(|e| e.into_inner());
        match area {
            Area::All(_) => Scope::Everywhere,
            Area::Cells(cs) | Area::Premises(crate::config::Premises { premises: cs }) => {
                if let Some(cells) = known().listed_cells.get(cs) {
                    return Scope::Cells(cells.clone());
                }
                let cells: std::sync::Arc<BTreeSet<Id>> = std::sync::Arc::new(cs.iter().cloned().collect());
                Scope::Cells(keep().listed_cells.entry(cs.clone()).or_insert(cells).clone())
            }
            Area::Near(n) => {
                let rects = crate::geo::body_rects(s, st, me);
                let key = (rects.iter().map(|r| (r.x, r.y, r.w, r.h)).collect::<Vec<_>>(), n.near);
                if let Some(cells) = known().near.get(&key) {
                    return Scope::Cells(cells.clone());
                }
                let g = &s.config.world.ground;
                let mut cells = BTreeSet::new();
                for r in &rects {
                    for y in (r.y - n.near - 1).max(0)..(r.y + r.h + n.near + 1).min(g.h) {
                        for x in (r.x - n.near - 1).max(0)..(r.x + r.w + n.near + 1).min(g.w) {
                            if within(*r, Rect::cell(x, y), n.near) && crate::config::cell_in(&s.detailed, x, y) {
                                cells.insert(cell_id(x, y));
                            }
                        }
                    }
                }
                Scope::Cells(keep().near.entry(key).or_insert(std::sync::Arc::new(cells)).clone())
            }
            // A place's cells: where its area meets a detailed place (never walking a summarised area cell by cell).
            Area::Place(p) => {
                if let Some(cells) = known().place_cells.get(&p.place) {
                    return Scope::Cells(cells.clone());
                }
                let mut cells = BTreeSet::new();
                if let Some(a) = s.config.world.places.iter().find(|x| x.id == p.place).map(|x| x.area) {
                    for d in &s.detailed {
                        let (x0, y0) = (a.x.max(d.x), a.y.max(d.y));
                        let (x1, y1) = ((a.x + a.w).min(d.x + d.w), (a.y + a.h).min(d.y + d.h));
                        for y in y0..y1 {
                            for x in x0..x1 {
                                cells.insert(cell_id(x, y));
                            }
                        }
                    }
                }
                let cells = std::sync::Arc::new(cells);
                Scope::Cells(keep().place_cells.entry(p.place.clone()).or_insert(cells).clone())
            }
        }
    }

    /// The accounts map for the state's set of accounts, made if it isn't the one kept.
    fn accounts_now(&mut self, st: &State) {
        let key = (st.counters.acc, st.accounts.len());
        if self.accounts.as_ref().is_none_or(|(k, _)| *k != key) {
            let mut m: BTreeMap<Id, Vec<Id>> = BTreeMap::new();
            for (id, a) in st.accounts.iter() {
                m.entry(a.holder.clone()).or_default().push(id.clone());
                if a.custodian != a.holder {
                    m.entry(a.custodian.clone()).or_default().push(id.clone());
                }
            }
            self.accounts = Some((key, m));
        }
    }

    /// The accounts an entity holds or keeps, in id order. (From the map `accounts_now` made for this state; were it
    /// another state's, by going through the accounts.)
    fn accounts_of(&self, st: &State, entity: &str) -> std::borrow::Cow<'_, [Id]> {
        let key = (st.counters.acc, st.accounts.len());
        match self.accounts.as_ref().filter(|(k, _)| *k == key) {
            Some((_, m)) => std::borrow::Cow::Borrowed(m.get(entity).map(Vec::as_slice).unwrap_or(&[])),
            None => std::borrow::Cow::Owned(st.accounts.iter().filter(|(_, a)| a.holder == entity || a.custodian == entity).map(|(id, _)| id.clone()).collect()),
        }
    }

    /// Bring the index up to the state, before observations of it are built (`build` only reads it): the records
    /// made since, the accounts by entity, and what has changed in the accounts and (for a directory) among the
    /// entities and positions.
    fn prepare(&mut self, st: &State, directory: bool) {
        self.catch_up(st);
        self.accounts_now(st);
        self.account_changes.sync(&st.accounts, st.counters.change, |a| a.changed);
        if directory {
            self.entity_changes.sync(&st.entities, st.counters.change, |e| e.changed);
            self.position_changes.sync(&st.positions, st.counters.change, |x| x.changed);
        }
    }
}

/// Does any of the capacities a participant would observe in have a directory it is shown? (One that is only looked
/// up in, which is every directory a valid world has, is answered from the state as asked: nothing is kept ready.)
fn has_directory(st: &State, participant: &str, only: Option<&str>) -> bool {
    capacities(st, participant).iter().filter(|cap| only.is_none_or(|o| o == cap.key)).any(|cap| cap.channels.iter().any(|ch| matches!(ch.kind, ChannelKind::Directory { way } if way != Way::Ask)))
}

/// A field a search can use. Purely mechanical: names a place in a record, and never says what it means.
pub use oikos_world::kernel::known_field;

fn field(r: &Record, f: &str) -> Option<Value> {
    let path = |v: &Value, p: &str| p.split('.').try_fold(v, |v, k| v.get(k)).cloned();
    match f {
        "id" => Some(Value::from(r.id.as_str())),
        "record" => Some(Value::from(r.body.kind_name())),
        // (The claim a transfer or a release names: how a register is asked what has become of one title.)
        "claim" => match &r.body {
            crate::blocks::RecordBody::ClaimTransfer { claim, .. } | crate::blocks::RecordBody::ClaimRelease { claim } => Some(Value::from(claim.as_str())),
            _ => None,
        },
        // (Who holds a claim: how a register is asked for one holder's titles, by those it answers that to.)
        "holder" => match &r.body {
            crate::blocks::RecordBody::Claim { holder, .. } => Some(Value::from(holder.as_str())),
            _ => None,
        },
        "kind" => match &r.body {
            crate::blocks::RecordBody::Statement { kind, .. } => Some(Value::from(kind.as_str())),
            _ => None,
        },
        "at" => Some(Value::from(r.at)),
        "author" => Some(Value::from(r.author.as_str())),
        "speaks_for" => r.speaks_for.as_deref().map(Value::from),
        // (Of several, the one cited first: what a search orders by. Whether one is cited at all is `holds`.)
        "basis" => r.basis.as_ref().map(|b| Value::from(b.first())),
        _ => {
            if let Some(p) = f.strip_prefix("data.") {
                match &r.body {
                    crate::blocks::RecordBody::Statement { data: Some(d), .. } => path(d, p),
                    _ => None,
                }
            } else if let Some(p) = f.strip_prefix("about.") {
                match &r.body {
                    crate::blocks::RecordBody::Claim { about, .. } => path(about, p),
                    _ => None,
                }
            } else {
                None
            }
        }
    }
}

/// Compare two JSON values of the same type (integers numerically, strings by bytes); anything else doesn't compare.
fn compare(a: &Value, b: &Value) -> Option<std::cmp::Ordering> {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => Some(x.as_i64()?.cmp(&y.as_i64()?)),
        (Value::String(x), Value::String(y)) => Some(x.as_bytes().cmp(y.as_bytes())),
        (Value::Bool(x), Value::Bool(y)) => Some(x.cmp(y)),
        _ => None,
    }
}

fn holds(r: &Record, c: &crate::config::Condition) -> bool {
    use std::cmp::Ordering::*;
    // A record resting on several: it equals a record if it cites it anywhere, and differs from one it cites nowhere.
    if let ("basis", Some(b), CmpOp::Eq | CmpOp::Ne, Some(want)) = (c.field.as_str(), &r.basis, c.op, c.value.as_str()) {
        return b.cites(want) == (c.op == CmpOp::Eq);
    }
    let Some(v) = field(r, &c.field) else { return false };
    // A list: it equals a value it holds, and differs from one it does not (a plan's cells: which lot is this cell on).
    if let (Value::Array(items), CmpOp::Eq | CmpOp::Ne) = (&v, c.op) {
        return items.iter().any(|x| compare(x, &c.value) == Some(Equal)) == (c.op == CmpOp::Eq);
    }
    let Some(o) = compare(&v, &c.value) else { return false };
    match c.op {
        CmpOp::Eq => o == Equal,
        CmpOp::Ne => o != Equal,
        CmpOp::Lt => o == Less,
        CmpOp::Le => o != Greater,
        CmpOp::Gt => o == Greater,
        CmpOp::Ge => o != Less,
    }
}

use crate::sites::{site_cell, Shown};
pub use crate::sites::site_structure;

/// How an observation is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// An ordinary look: only channels that are due (`every`), and in each, only what changed since
    /// the participant last looked through it. Consumes what it delivers.
    Look,
    /// Everything each channel covers, now, ignoring `every` and consuming nothing:
    /// what a participant's view, built up from its looks, must equal (the perception invariant).
    Full,
}

/// One of the capacities a participant perceives in: itself (a person's), or a position it holds.
struct Capacity<'a> {
    key: Id,
    prefix: String,
    entity: Id,
    channels: &'a [Channel],
}

fn capacities<'a>(st: &'a State, participant: &str) -> Vec<Capacity<'a>> {
    let p = &st.participants[participant];
    let mut v = vec![];
    if let (ParticipantKind::Person, Some(person)) = (p.kind, &p.person) {
        v.push(Capacity { key: SELF.into(), prefix: String::new(), entity: person.clone(), channels: &p.def.channels });
    }
    for id in st.held_by(participant) {
        let x = &st.positions[id];
        v.push(Capacity { key: id.clone(), prefix: format!("{id}/"), entity: x.entity.clone(), channels: &x.channels });
    }
    v
}

/// Build a participant's observation (read-only): what it perceives now, what it looked through (for the world to mark
/// seen), and the transactions it was shown (for the world to drain). `only`: one capacity ("self" or a position it
/// holds); None: all of them. The world then delivers it (World::deliver), with the outcomes and messages waiting.
pub fn observe(s: &Statics, st: &State, index: &mut RecordIndex, participant: &str, only: Option<&str>, requested: &[LookRequest]) -> (Observation, Vec<(Id, Look)>, Vec<Id>) {
    index.prepare(st, has_directory(st, participant, only));
    build(s, st, index, participant, Mode::Look, only, requested)
}

/// Bring the index up to the state for observing these participants (each in one capacity, or all): after it, and
/// until the state changes, `observe_prepared` builds each one's observation reading the index only, so several may
/// be built at once.
pub fn prepare<'a>(st: &State, index: &mut RecordIndex, who: impl Iterator<Item = (&'a str, Option<&'a str>)>) {
    let mut directory = false;
    for (participant, only) in who {
        directory = directory || (st.participants.contains_key(participant) && has_directory(st, participant, only));
    }
    index.prepare(st, directory);
}

/// `observe`, with nothing asked for, for an index `prepare` has brought up to this state: the same observation.
pub fn observe_prepared(s: &Statics, st: &State, index: &RecordIndex, participant: &str, only: Option<&str>) -> (Observation, Vec<(Id, Look)>, Vec<Id>) {
    build(s, st, index, participant, Mode::Look, only, &[])
}

/// The full picture a participant's channels cover right now (Mode::Full), changing nothing.
pub fn full_view(s: &Statics, st: &State, index: &mut RecordIndex, participant: &str) -> Observation {
    index.prepare(st, true);
    build(s, st, index, participant, Mode::Full, None, &[]).0
}

type Built = (Observation, Vec<(Id, Look)>, Vec<Id>);

fn build(s: &Statics, st: &State, index: &RecordIndex, participant: &str, mode: Mode, only: Option<&str>, requested: &[LookRequest]) -> Built {
    // (The index is the caller's to bring up to the state first: `RecordIndex::prepare`.)
    assert_eq!(index.indexed, st.record_order.len(), "the record index isn't up to the state it's asked about");
    let p = &st.participants[participant];

    let mut channels = BTreeMap::new();
    let mut looks = vec![];
    let mut drained = vec![];
    for cap in capacities(st, participant) {
        if only.is_some_and(|o| o != cap.key) {
            continue;
        }
        let me = cap.entity.clone();
        for ch in cap.channels {
            let path = format!("{}{}", cap.prefix, ch.id);
            let asked = requested.iter().find(|l| l.channel == path);
            let area = match &ch.kind {
                ChannelKind::Records { area, .. } | ChannelKind::Sites { area, .. } => area.as_ref(),
                _ => None,
            };
            // A search: what matches now, within what the capacity may see; its cursor for changes is untouched. (Several
            // searches through one channel in one look, as when a keeper's several answers arrive together: each is
            // answered, and the answers are shown together.)
            let searches: Vec<&crate::observe::Query> = requested.iter().filter(|l| l.channel == path).filter_map(|l| l.query.as_ref()).collect();
            if let (false, ChannelKind::Records { way, filter, from, of, by, .. }) = (searches.is_empty(), &ch.kind) {
                let scope = area.map(|a| index.scope(s, st, a, &me));
                let want = Want::of(*way, from.as_ref(), &me);
                let mut found: Vec<Arc<Record>> = vec![];
                for q in searches {
                    // How many one answer gives is the keeper's to say, and a board's how many one reading takes in.
                    let most = match way {
                        Way::Ask => {
                            let named = q.conditions.iter().flatten().find(|c| c.op == CmpOp::Eq && by.iter().flatten().any(|f| f == &c.field)).map(|c| c.field.as_str());
                            named.map(|f| s.config.knowing.answer_most(of.as_deref().unwrap_or(""), filter, f))
                        }
                        Way::Published if from.is_none() => s.config.knowing.board_most(filter),
                        _ => None,
                    };
                    for r in search(st, index, &me, filter, want.as_ref(), scope.as_ref(), q, most) {
                        if !found.iter().any(|x| x.id == r.id) {
                            found.push(r);
                        }
                    }
                }
                channels.insert(path, ChannelData::Records { records: found, search: Some(true), whole: None });
                continue;
            }
            // What is only ever answered, never shown (docs/design/knowing.md): a register asked of its keeper and a
            // board (a search, above); a directory looked up (one answer); a place gone to (the world's: it takes the
            // looker's time, and what it finds comes when it ends).
            match &ch.kind {
                ChannelKind::Directory { way: Way::Ask } => {
                    // (Several look-ups through it in one look: each answered, the answers together.)
                    let whom: Vec<&Who> = requested.iter().filter(|l| l.channel == path).filter_map(|l| l.who.as_ref()).collect();
                    if !whom.is_empty() {
                        channels.insert(path, looked_up(st, &whom));
                    }
                    continue;
                }
                ChannelKind::Sites { way: Way::Visit, .. } | ChannelKind::Records { way: Way::Ask, .. } => continue,
                ChannelKind::Records { way: Way::Published, filter, from: None, .. } if s.config.knowing.board_most(filter).is_some() => continue,
                _ => {}
            }
            if mode == Mode::Look && ch.on_request == Some(true) && asked.is_none() {
                continue; // perceived only when asked
            }
            let last = if mode == Mode::Full { None } else { p.looks.get(&path).copied() };
            // A post given back to someone who held it before: a first look, said to be whole (`Look::anew`).
            let anew = last.is_some_and(|l| l.anew);
            let last = last.filter(|l| !l.anew);
            if let (Some(every), Some(l), None) = (ch.every, last, asked) {
                if st.t < l.at + every {
                    continue; // not looking through this channel yet; changes accumulate
                }
            }
            // A channel that looks near the capacity's entity looks from where it is now: if it has moved
            // since the last look, the whole of its new surroundings replaces the old.
            let from = matches!(area, Some(Area::Near(_))).then(|| st.entities.get(&me).map_or(0, |e| e.moved));
            let moved = last.is_some_and(|l| l.from != from);
            let whole = (moved || anew).then_some(true);
            let scope = area.map(|a| index.scope(s, st, a, &me));
            // Changes after this cursor are new; None: everything (a first look, a move, or the full picture).
            let after = if moved { None } else { last.map(|l| l.cursor) };
            let changed = |c: u64| after.is_none_or(|a| c > a);
            let data = match &ch.kind {
                ChannelKind::Accounts => {
                    let item = |id: &Id, a: &crate::state::Account| AccountItem { account: id.clone(), holder: a.holder.clone(), custodian: a.custodian.clone(), currency: a.currency.clone(), balance: a.balance, closed: None };
                    // Whoever has many accounts (a bank keeps a town's) is shown the few that changed since its last
                    // look from the list of changes, not by going through them all: the same accounts.
                    let mine = index.accounts_of(st, &me);
                    let recent = after.and_then(|a| index.account_changes.since(&st.accounts, a, mine.len()));
                    let mut accounts: Vec<AccountItem> = match &recent {
                        Some(ids) => ids.iter().filter_map(|id| st.accounts.get(*id).filter(|a| (a.holder == me || a.custodian == me) && changed(a.changed)).map(|a| item(id, a))).collect(),
                        None => mine.iter().filter_map(|id| Some(&st.accounts[id]).filter(|a| changed(a.changed)).map(|a| item(id, a))).collect(),
                    };
                    #[cfg(debug_assertions)]
                    if recent.is_some() {
                        let mut plain: Vec<AccountItem> = mine.iter().filter_map(|id| Some(&st.accounts[id]).filter(|a| changed(a.changed)).map(|a| item(id, a))).collect();
                        plain.sort_by(|a, b| a.account.cmp(&b.account));
                        assert_eq!(accounts, plain, "the list of changed accounts and the accounts themselves disagree for {me}");
                    }
                    // (Accounts and holdings have no "whole" to say: a first look anew also says what has gone since, so
                    // that what the holder kept from before goes too.)
                    if after.is_some() || anew {
                        for (id, x) in st.closed_accounts.iter() {
                            if (x.holder == me || x.custodian == me) && changed(x.changed) {
                                accounts.push(AccountItem { account: id.clone(), holder: x.holder.clone(), custodian: x.custodian.clone(), currency: x.currency.clone(), balance: 0, closed: Some(true) });
                            }
                        }
                    }
                    accounts.sort_by(|a, b| a.account.cmp(&b.account));
                    let queue = crate::state::transactions_key(&cap.key, &me);
                    let transactions = if mode == Mode::Look { p.new_transactions.get(&queue).map(|q| q.iter().cloned().collect()).unwrap_or_default() } else { vec![] };
                    if mode == Mode::Look {
                        drained.push(queue);
                    }
                    ChannelData::Accounts { accounts, transactions }
                }
                ChannelKind::Holdings => {
                    // Keys start with the holder, so the entity's holdings are one range.
                    let lo = format!("{me}|");
                    let hi = format!("{me}}}"); // '}' sorts just after '|'
                    let holdings = st
                        .holdings
                        .range(lo..hi)
                        // What's new includes a holding gone to nothing (so a view drops it); the full picture is only what's held.
                        .filter(|(_, h)| changed(h.changed) && (after.is_some() || anew || h.quantity != 0))
                        .map(|(_, h)| HoldingItem { kind: h.kind.clone(), at: h.at.clone(), quantity: h.quantity })
                        .collect();
                    ChannelData::Holdings { holdings }
                }
                // Its own record, and nobody else's: the channel names no one, and `me` is the capacity's own entity.
                ChannelKind::OwnRecord => ChannelData::OwnRecord { record: st.entity_records.get(&me).filter(|r| changed(r.changed)).map(|r| OwnRecord { n: r.n, at: r.at, sections: r.sections.clone() }) },
                ChannelKind::Records { way, filter, from: publishers, .. } => {
                    let from = after.unwrap_or(0);
                    let want = Want::of(*way, publishers.as_ref(), &me);
                    let seqs = match &scope {
                        Some(sc) => index.placed(sc, from),
                        None => index.candidates(filter, want.as_ref(), from).unwrap_or_else(|| (from + 1..=st.record_order.len() as u64).collect()),
                    };
                    // Record with seq q is the q-th made.
                    let by_seq = &index.by_seq;
                    ChannelData::Records {
                        records: seqs
                            .into_iter()
                            .map(|q| &by_seq[(q - 1) as usize])
                            .filter(|r| can_see(st, r, &me) && placed_ok(st, r, &me, scope.as_ref()) && matches(st, r, filter, want.as_ref(), true))
                            .cloned()
                            .collect(),
                        search: None,
                        whole,
                    }
                }
                ChannelKind::Sites { occupants, .. } => {
                    let names = *occupants == Some(Occupants::Names);
                    let mut shown: Shown = vec![];
                    ChannelData::Sites {
                        as_of: st.t,
                        visited: None,
                        cells: match scope.as_ref().expect("a map that is not a visit has an area (the contract)") {
                            // (Every cell: read as they're walked, not looked up again one by one.)
                            Scope::Everywhere => st.cells.iter().filter(|(_, c)| changed(c.changed)).map(|(id, c)| site_cell(s, st, id, c, &me, names, &mut shown)).collect(),
                            // A scope that's much of the ground (a whole place) is walked beside the state's cells,
                            // both being in id order: the same cells in the same order as looking each one up.
                            Scope::Cells(ps) if ps.len() * 8 > st.cells.len() => {
                                let mut wanted = ps.iter().peekable();
                                let mut cells = vec![];
                                for (id, c) in st.cells.iter() {
                                    while wanted.peek().is_some_and(|w| *w < id) {
                                        wanted.next();
                                    }
                                    if wanted.peek().is_none() {
                                        break;
                                    }
                                    if wanted.peek().is_some_and(|w| *w == id) && changed(c.changed) {
                                        cells.push(site_cell(s, st, id, c, &me, names, &mut shown));
                                    }
                                }
                                cells
                            }
                            Scope::Cells(ps) => ps.iter().filter_map(|id| st.cells.get(id).filter(|c| changed(c.changed)).map(|c| site_cell(s, st, id, c, &me, names, &mut shown))).collect(),
                        },
                        whole,
                    }
                }
                ChannelKind::Directory { .. } => {
                    let entity = |(id, e): (&Id, &crate::state::Entity)| EntityItem { entity: id.clone(), kind: e.kind.clone(), name: e.name.clone(), participant: e.body.as_ref().and_then(|b| b.participant.clone()) };
                    let position = |(id, x): (&Id, &crate::state::Position)| PositionItem {
                        position: id.clone(),
                        entity: x.entity.clone(),
                        title: x.title.clone(),
                        role: x.role.clone(),
                        holder: x.holder.clone(),
                        held_by: x.holder.as_ref().and_then(|h| {
                            let hp = st.participants.get(h)?;
                            match &hp.person {
                                Some(person) => st.entities.get(person).map(|e| e.name.clone()),
                                None => hp.def.title.clone(),
                            }
                        }),
                    };
                    // What has changed since the last look is read from the lists of changes (in id order, as the
                    // maps are), where they go back that far; a first look goes through everyone.
                    let entities: Vec<EntityItem> = match after.and_then(|a| index.entity_changes.since(&st.entities, a, st.entities.len())) {
                        Some(ids) => ids.into_iter().filter_map(|id| st.entities.get(id).filter(|e| changed(e.changed)).map(|e| (id, e))).map(entity).collect(),
                        None => st.entities.iter().filter(|(_, e)| changed(e.changed)).map(entity).collect(),
                    };
                    let positions: Vec<PositionItem> = match after.and_then(|a| index.position_changes.since(&st.positions, a, st.positions.len())) {
                        Some(ids) => ids.into_iter().filter_map(|id| st.positions.get(id).filter(|x| changed(x.changed)).map(|x| (id, x))).map(position).collect(),
                        None => st.positions.iter().filter(|(_, x)| changed(x.changed)).map(position).collect(),
                    };
                    #[cfg(debug_assertions)]
                    {
                        assert_eq!(entities, st.entities.iter().filter(|(_, e)| changed(e.changed)).map(entity).collect::<Vec<_>>(), "the list of changed entities and the entities themselves disagree");
                        assert_eq!(positions, st.positions.iter().filter(|(_, x)| changed(x.changed)).map(position).collect::<Vec<_>>(), "the list of changed positions and the positions themselves disagree");
                    }
                    ChannelData::Directory { entities, positions }
                }
            };
            if mode == Mode::Look {
                let cursor = if matches!(ch.kind, ChannelKind::Records { .. }) { st.counters.record_seq } else { st.counters.change };
                looks.push((path.clone(), Look { at: st.t, cursor, from, anew: false }));
            }
            channels.insert(path, data);
        }
    }
    let body = p.person.as_ref().and_then(|person| st.body(person).map(|b| (person, b))).map(|(person, b)| BodyView {
        born_at: b.born_at,
        sex: b.sex,
        children: b
            .children
            .iter()
            .filter_map(|c| st.body(c).map(|cb| ChildView { person: c.clone(), born_at: cb.born_at, sex: cb.sex, alive: cb.alive }))
            .collect(),
        present: b.present,
        alive: b.alive,
        parents: b.parents.clone(),
        conditions: b.conditions.iter().map(|c| ConditionView { id: c.id.clone(), kind: c.kind, severity: c.severity.clone(), since: c.since, until: c.until, treated: c.treated }).collect(),
        variables: s
            .config
            .catalogue
            .body_variables
            .iter()
            .filter_map(|cfg| b.variables.get(&cfg.id).map(|x| (cfg.id.clone(), crate::state::body_variable_at(cfg, *x, st.t).0)))
            .collect(),
        in_space: st.structures_of(person).into_iter().find_map(|sid| st.occupancy.get(&sid)?.iter().find(|(_, bodies)| bodies.contains(person)).map(|(sp, _)| sp.clone())),
    });
    let positions = st
        .held_by(participant)
        .into_iter()
        .map(|id| (id, &st.positions[id]))
        .map(|(id, x)| HeldPosition { position: id.clone(), entity: x.entity.clone(), title: x.title.clone(), role: x.role.clone() })
        .collect();
    // Readings of the agreements the records here bring.
    let mut readings = BTreeMap::new();
    for ch in channels.values() {
        if let ChannelData::Records { records, .. } = ch {
            for r in records {
                let agreement = match &r.body {
                    crate::blocks::RecordBody::Agreement { .. } => Some(&r.id),
                    crate::blocks::RecordBody::Signature { agreement, .. } | crate::blocks::RecordBody::Notice { agreement, .. } => Some(agreement),
                    _ => None,
                };
                if let Some(a) = agreement {
                    if !readings.contains_key(a) {
                        if let Some(x) = st.reading(a) {
                            readings.insert(a.clone(), x);
                        }
                    }
                }
            }
        }
    }
    let obs = Observation {
        participant: participant.into(),
        t: st.t,
        status: p.status,
        entity: p.person.clone(),
        body,
        positions,
        outcomes: vec![],
        inbox: vec![],
        drafts: vec![],
        channels,
        asking: vec![],
        readings,
    };
    (obs, looks, drained)
}

/// How many entries one look-up returns at most (the holders of one office, those of one name).
pub const LOOKED_UP_MAX: usize = 20;

/// Look-ups in the directory (docs/design/knowing.md, section 7), each answered with the one entity, participant or
/// position named, whoever goes by exactly a name (an entity's name or id; a position's title, role or id; the person
/// a participant of that id acts as), or an organisation's positions of one role. Never more than `LOOKED_UP_MAX` to
/// one look-up, in id order.
fn looked_up(st: &State, whom: &[&Who]) -> ChannelData {
    let (mut entities, mut positions) = (BTreeMap::new(), BTreeMap::new());
    for who in whom {
        let ChannelData::Directory { entities: es, positions: ps } = looked_up_one(st, who) else { continue };
        entities.extend(es.into_iter().map(|e| (e.entity.clone(), e)));
        positions.extend(ps.into_iter().map(|p| (p.position.clone(), p)));
    }
    ChannelData::Directory { entities: entities.into_values().collect(), positions: positions.into_values().collect() }
}

fn looked_up_one(st: &State, who: &Who) -> ChannelData {
    let entity = |id: &Id, e: &crate::state::Entity| EntityItem { entity: id.clone(), kind: e.kind.clone(), name: e.name.clone(), participant: e.body.as_ref().and_then(|b| b.participant.clone()) };
    let position = |id: &Id, x: &crate::state::Position| PositionItem {
        position: id.clone(),
        entity: x.entity.clone(),
        title: x.title.clone(),
        role: x.role.clone(),
        holder: x.holder.clone(),
        held_by: x.holder.as_ref().and_then(|h| {
            let hp = st.participants.get(h)?;
            match &hp.person {
                Some(person) => st.entities.get(person).map(|e| e.name.clone()),
                None => hp.def.title.clone(),
            }
        }),
    };
    let (mut entities, mut positions) = (vec![], vec![]);
    match who {
        Who { entity: Some(e), role: Some(role), .. } => {
            positions.extend(st.positions.iter().filter(|(_, x)| &x.entity == e && x.role.as_ref() == Some(role)).take(LOOKED_UP_MAX).map(|(id, x)| position(id, x)));
        }
        Who { entity: Some(e), .. } => entities.extend(st.entities.get_key_value(e).map(|(id, x)| entity(id, x))),
        Who { participant: Some(p), .. } => {
            let person = st.participants.get(p).and_then(|x| x.person.as_ref());
            entities.extend(person.and_then(|e| st.entities.get_key_value(e)).map(|(id, x)| entity(id, x)));
        }
        Who { position: Some(p), .. } => positions.extend(st.positions.get_key_value(p).map(|(id, x)| position(id, x))),
        Who { name: Some(name), .. } => {
            // (A name is matched whole, whatever its capitals; an id, a role, exactly.)
            let same = |a: &str| a.eq_ignore_ascii_case(name);
            let person = st.participants.get(name).and_then(|x| x.person.as_ref());
            entities.extend(st.entities.iter().filter(|(id, e)| *id == name || same(&e.name) || person == Some(*id)).take(LOOKED_UP_MAX).map(|(id, e)| entity(id, e)));
            positions.extend(st.positions.iter().filter(|(id, x)| *id == name || x.title.as_deref().is_some_and(same) || x.role.as_ref() == Some(name)).take(LOOKED_UP_MAX).map(|(id, x)| position(id, x)));
        }
        _ => {}
    }
    ChannelData::Directory { entities, positions }
}

/// A search through a records channel: records the participant may see that match the channel's filter
/// and the query, now. Standing records only if asked; ordered as asked (newest first by default);
/// at most `limit` (default 20).
#[allow(clippy::too_many_arguments)]
fn search(st: &State, index: &RecordIndex, me: &str, filter: &RecordFilter, want: Option<&Want>, area: Option<&Scope>, q: &Query, most: Option<u32>) -> Vec<Arc<Record>> {
    let at_seq = |seq: u64| &index.by_seq[(seq - 1) as usize];
    // A search for one record by its id reads that record, not the register it is in (the same answer: every other
    // condition is still asked of it below).
    let named = q.conditions.iter().flatten().find_map(|c| match (&c.op, c.field.as_str(), &c.value) {
        (CmpOp::Eq, "id", Value::String(id)) => Some(id.as_str()),
        _ => None,
    });
    let seqs: Vec<u64> = if let Some(id) = named {
        let one: Vec<u64> = st.records.get(id).map(|x| x.seq).into_iter().collect();
        match area {
            Some(sc) => index.placed(sc, 0).into_iter().filter(|q| one.contains(q)).collect(),
            None => one,
        }
        .into_iter()
        .filter(|&seq| q.standing != Some(true) || index.is_standing(at_seq(seq), seq))
        .collect()
    } else if let Some(sc) = area {
        let mut v = index.placed(sc, 0);
        if q.standing == Some(true) {
            v.retain(|&seq| index.is_standing(at_seq(seq), seq));
        }
        v.reverse();
        v
    } else if q.standing == Some(true) {
        index.standing(filter)
    } else {
        let mut v = index.candidates(filter, want, 0).unwrap_or_else(|| (1..=st.record_order.len() as u64).collect());
        v.reverse();
        v
    };
    let conditions = q.conditions.as_deref().unwrap_or(&[]);
    let mut hits: Vec<(u64, &Arc<Record>)> = seqs
        .into_iter()
        .map(|seq| (seq, at_seq(seq)))
        .filter(|(_, r)| can_see(st, r, me) && placed_ok(st, r, me, area) && matches(st, r, filter, want, false) && conditions.iter().all(|c| holds(r, c)))
        .collect();
    if let Some(o) = &q.order {
        // Records without the field sort last; ties keep newest first.
        hits.sort_by(|(sa, a), (sb, b)| match (field(a, &o.field), field(b, &o.field)) {
            (Some(x), Some(y)) => {
                let c = compare(&x, &y).unwrap_or(std::cmp::Ordering::Equal);
                (if o.desc { c.reverse() } else { c }).then(sb.cmp(sa))
            }
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => sb.cmp(sa),
        });
    }
    let limit = q.limit.unwrap_or(20).min(most.unwrap_or(u32::MAX));
    hits.into_iter().take(limit as usize).map(|(_, r)| r.clone()).collect()
}
