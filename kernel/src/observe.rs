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
use crate::config::{cell_id, Area, Channel, ChannelKind, CmpOp, LookRequest, Occupants, ParticipantKind, Query, RecordFilter, SELF};
use crate::geo::{within, Rect};
use crate::state::{Condition, Look, Message, Outcome, ParticipantStatus, State, Transaction};
use crate::statics::Statics;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

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
    pub conditions: Vec<Condition>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChannelData {
    Accounts { accounts: Vec<AccountItem>, transactions: Vec<Transaction> },
    Holdings { holdings: Vec<HoldingItem> },
    Records {
        records: Vec<Record>,
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

/// A cell of ground, and the building standing on it (repeated on every cell of its footprint).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteCell {
    pub cell: Id,
    pub x: i64,
    pub y: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terrain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<SiteStructure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteStructure {
    pub structure: Id,
    #[serde(rename = "type")]
    pub structure_type: Id,
    /// Its corner cell, and footprint.
    pub at: Id,
    pub w: i64,
    pub h: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub built_by: Option<Id>,
    pub complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completes_at: Option<i64>,
    pub spaces: Vec<SiteSpace>,
}

/// A space in a building: what it is (the world's vocabulary), how many bodies it holds at most,
/// and who is in it where that can be told (the capacity's own buildings, or a channel that
/// shows names); otherwise how many.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteSpace {
    pub space: Id,
    pub kind: String,
    pub capacity: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attrs: Option<Value>,
    pub count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occupants: Option<Vec<Id>>,
    /// Its last few departures (who left, why, when), where the channel shows who's there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<Vec<crate::state::Departure>>,
}

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
    Cells(BTreeSet<Id>),
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

fn matches(st: &State, rec: &Record, f: &RecordFilter, want: Option<&BTreeSet<&str>>) -> bool {
    if f.records.as_ref().is_some_and(|k| !k.iter().any(|x| x == rec.body.kind_name())) {
        return false;
    }
    if let Some(kinds) = &f.statement_kinds {
        match &rec.body {
            crate::blocks::RecordBody::Statement { kind, .. } if kinds.contains(kind) => {}
            _ => return false,
        }
    }
    if let Some(want) = want {
        if !involved(st, rec).iter().any(|e| want.contains(e.as_str())) {
            return false;
        }
    }
    true
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
    by_record: BTreeMap<&'static str, Vec<u64>>,
    by_kind: BTreeMap<String, Vec<u64>>,
    by_entity: BTreeMap<String, Vec<u64>>,
    /// Records still standing (not withdrawn by their own author or whoever they speak for), by
    /// statement kind and by record kind: what a search for standing records scans.
    standing_kind: BTreeMap<String, BTreeSet<u64>>,
    standing_record: BTreeMap<&'static str, BTreeSet<u64>>,
    /// cell -> records placed there (and withdrawals of them).
    by_place: BTreeMap<Id, Vec<u64>>,
    accounts: Option<AccountsByEntity>,
    /// entity -> (its `moved` stamp, the footprints of the buildings it's in then).
    places: BTreeMap<Id, (u64, Vec<Rect>)>,
}

/// entity -> accounts it holds or keeps, for the account set identified by
/// (accounts ever opened, accounts now open): accounts are only opened or
/// closed, never changed, so that pair pins the set down.
type AccountsByEntity = ((u64, usize), BTreeMap<Id, Vec<Id>>);

impl RecordIndex {
    fn catch_up(&mut self, st: &State) {
        for i in self.indexed..st.record_order.len() {
            let stored = &st.records[&st.record_order[i]];
            let (seq, rec) = (stored.seq, &*stored.record);
            self.by_record.entry(rec.body.kind_name()).or_default().push(seq);
            if let crate::blocks::RecordBody::Statement { kind, .. } = &rec.body {
                self.by_kind.entry(kind.clone()).or_default().push(seq);
            }
            let who: BTreeSet<String> = involved(st, rec).into_iter().collect();
            for e in who {
                self.by_entity.entry(e).or_default().push(seq);
            }
            if let Some(p) = place_of(st, rec) {
                self.by_place.entry(p.clone()).or_default().push(seq);
            }
            // Everything stands when made, except a withdrawal: it takes something down.
            if !matches!(rec.body, crate::blocks::RecordBody::Withdrawal { .. }) {
                self.standing_record.entry(rec.body.kind_name()).or_default().insert(seq);
            }
            if let crate::blocks::RecordBody::Statement { kind, .. } = &rec.body {
                self.standing_kind.entry(kind.clone()).or_default().insert(seq);
            }
            // A withdrawal by the record's own author (or whoever it speaks for) ends its standing.
            if let crate::blocks::RecordBody::Withdrawal { withdraws, .. } = &rec.body {
                if let Some(target) = st.records.get(withdraws) {
                    let t = &*target.record;
                    let owner = |r: &Record| -> Vec<String> { r.speaks_for.iter().cloned().chain(st.author_entity(r)).collect() };
                    let by = owner(rec);
                    if owner(t).iter().any(|o| by.contains(o)) {
                        if let Some(set) = self.standing_record.get_mut(t.body.kind_name()) {
                            set.remove(&target.seq);
                        }
                        if let crate::blocks::RecordBody::Statement { kind, .. } = &t.body {
                            if let Some(set) = self.standing_kind.get_mut(kind) {
                                set.remove(&target.seq);
                            }
                        }
                    }
                }
            }
        }
        self.indexed = st.record_order.len();
    }

    /// Sequence numbers above `after` that might match the filter, in order.
    fn candidates(&self, f: &RecordFilter, want: Option<&BTreeSet<&str>>, after: u64) -> Option<Vec<u64>> {
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
            options.push(w.iter().filter_map(|e| self.by_entity.get(*e)).map(|v| tail(v, after)).collect());
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
        let tail = |v: &Vec<u64>| v[v.partition_point(|&q| q <= after)..].to_vec();
        let mut seqs: Vec<u64> = match scope {
            Scope::Everywhere => self.by_place.values().flat_map(tail).collect(),
            Scope::Cells(ps) => ps.iter().filter_map(|p| self.by_place.get(p)).flat_map(tail).collect(),
        };
        seqs.sort_unstable();
        seqs
    }

    /// The cells an area covers for an entity, now.
    fn scope(&mut self, s: &Statics, st: &State, area: &Area, me: &str) -> Scope {
        match area {
            Area::All(_) => Scope::Everywhere,
            Area::Cells(cs) => Scope::Cells(cs.iter().cloned().collect()),
            Area::Near(n) => {
                let moved = st.entities.get(me).map_or(0, |e| e.moved);
                if self.places.get(me).is_none_or(|(m, _)| *m != moved) {
                    self.places.insert(me.to_string(), (moved, crate::geo::body_rects(s, st, me)));
                }
                let g = &s.config.world.ground;
                let mut cells = BTreeSet::new();
                for r in &self.places[me].1 {
                    for y in (r.y - n.near - 1).max(0)..(r.y + r.h + n.near + 1).min(g.h) {
                        for x in (r.x - n.near - 1).max(0)..(r.x + r.w + n.near + 1).min(g.w) {
                            if within(*r, Rect::cell(x, y), n.near) && crate::config::cell_in(&s.detailed, x, y) {
                                cells.insert(cell_id(x, y));
                            }
                        }
                    }
                }
                Scope::Cells(cells)
            }
            // A place's cells: where its area meets a detailed place (never walking a summarised area cell by cell).
            Area::Place(p) => {
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
                Scope::Cells(cells)
            }
        }
    }

    fn accounts_of<'a>(&'a mut self, st: &State, entity: &str) -> &'a [Id] {
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
        self.accounts.as_ref().unwrap().1.get(entity).map(Vec::as_slice).unwrap_or(&[])
    }
}

/// A field a search can use. Purely mechanical: names a place in a record, and never says what it means.
pub fn known_field(f: &str) -> bool {
    matches!(f, "record" | "kind" | "at" | "author" | "speaks_for" | "basis")
        || f.strip_prefix("data.").or_else(|| f.strip_prefix("about.")).is_some_and(|p| !p.is_empty() && p.split('.').all(|x| !x.is_empty()))
}

fn field(r: &Record, f: &str) -> Option<Value> {
    let path = |v: &Value, p: &str| p.split('.').try_fold(v, |v, k| v.get(k)).cloned();
    match f {
        "record" => Some(Value::from(r.body.kind_name())),
        "kind" => match &r.body {
            crate::blocks::RecordBody::Statement { kind, .. } => Some(Value::from(kind.as_str())),
            _ => None,
        },
        "at" => Some(Value::from(r.at)),
        "author" => Some(Value::from(r.author.as_str())),
        "speaks_for" => r.speaks_for.as_deref().map(Value::from),
        "basis" => r.basis.as_deref().map(Value::from),
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
    let Some(v) = field(r, &c.field) else { return false };
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

fn site_cell(s: &Statics, st: &State, id: &Id, me: &str, names: bool) -> SiteCell {
    let c = &st.cells[id];
    SiteCell {
        cell: id.clone(),
        x: c.x,
        y: c.y,
        terrain: c.terrain.clone(),
        structure: c.structure.as_ref().map(|sid| {
            let x = &st.structures[sid];
            let f = s.types[&x.structure_type].footprint;
            let occ = st.occupancy.get(sid);
            // Who is in a building: known in one's own, and where the channel shows names; otherwise how many.
            let known = names || occ.is_some_and(|m| m.values().any(|b| b.contains(me)));
            SiteStructure {
                structure: sid.clone(),
                structure_type: x.structure_type.clone(),
                at: x.at.clone(),
                w: f.w,
                h: f.h,
                built_by: x.built_by.clone(),
                complete: x.complete,
                completes_at: x.completes_at,
                spaces: s.spaces[&x.structure_type]
                    .iter()
                    .map(|(local, spec)| {
                        let space = format!("{sid}/{local}");
                        let bodies = occ.and_then(|m| m.get(&space));
                        SiteSpace {
                            kind: spec.kind.clone(),
                            capacity: spec.capacity,
                            attrs: spec.attrs.clone(),
                            count: bodies.map_or(0, |b| b.len()) as u32,
                            occupants: known.then(|| bodies.map(|b| b.iter().cloned().collect()).unwrap_or_default()),
                            left: known.then(|| st.departures.get(&space).cloned()).flatten(),
                            space,
                        }
                    })
                    .collect(),
            }
        }),
    }
}

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
    for (id, x) in st.positions.iter() {
        if x.holder.as_deref() == Some(participant) {
            v.push(Capacity { key: id.clone(), prefix: format!("{id}/"), entity: x.entity.clone(), channels: &x.channels });
        }
    }
    v
}

/// Build a participant's observation, consuming its "new since last time" state. `only`: one
/// capacity ("self" or a position it holds); None: all of them.
pub fn observe(s: &Statics, st: &mut State, index: &mut RecordIndex, participant: &str, only: Option<&str>, requested: &[LookRequest]) -> Observation {
    let (obs, looks, drained) = build(s, st, index, participant, Mode::Look, only, requested);
    let p = st.participants.get_mut(participant).unwrap();
    for (id, look) in looks {
        p.looks.insert(id, look);
    }
    for e in drained {
        p.new_transactions.remove(&e);
    }
    let mut outcomes = vec![];
    let mut inbox = vec![];
    let keys: Vec<Id> = p.pending.keys().filter(|k| only.is_none_or(|o| o == k.as_str())).cloned().collect();
    for k in keys {
        if let Some(mut x) = p.pending.remove(&k) {
            outcomes.append(&mut x.outcomes);
            inbox.append(&mut x.inbox);
        }
    }
    outcomes.sort_by(|a, b| (a.t, &a.action).cmp(&(b.t, &b.action)));
    inbox.sort_by(|a, b| (a.t, &a.id).cmp(&(b.t, &b.id)));
    Observation { outcomes, inbox, ..obs }
}

/// The full picture a participant's channels cover right now (Mode::Full), changing nothing.
pub fn full_view(s: &Statics, st: &State, index: &mut RecordIndex, participant: &str) -> Observation {
    build(s, st, index, participant, Mode::Full, None, &[]).0
}

type Built = (Observation, Vec<(Id, Look)>, Vec<Id>);

fn build(s: &Statics, st: &State, index: &mut RecordIndex, participant: &str, mode: Mode, only: Option<&str>, requested: &[LookRequest]) -> Built {
    index.catch_up(st);
    let p = &st.participants[participant];
    // Record with seq q is the q-th made.
    let at_seq = |q: u64| &*st.records[&st.record_order[(q - 1) as usize]].record;

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
                ChannelKind::Records { area, .. } => area.as_ref(),
                ChannelKind::Sites { area, .. } => Some(area),
                _ => None,
            };
            // A search: what matches now, within what the capacity may see; its cursor for changes is untouched.
            if let (Some(LookRequest { query: Some(q), .. }), ChannelKind::Records { filter, .. }) = (asked, &ch.kind) {
                let scope = area.map(|a| index.scope(s, st, a, &me));
                channels.insert(path, ChannelData::Records { records: search(st, index, &me, filter, scope.as_ref(), q), search: Some(true), whole: None });
                continue;
            }
            if mode == Mode::Look && ch.on_request == Some(true) && asked.is_none() {
                continue; // perceived only when asked
            }
            let last = if mode == Mode::Full { None } else { p.looks.get(&path).copied() };
            if let (Some(every), Some(l), None) = (ch.every, last, asked) {
                if st.t < l.at + every {
                    continue; // not looking through this channel yet; changes accumulate
                }
            }
            // A channel that looks near the capacity's entity looks from where it is now: if it has moved
            // since the last look, the whole of its new surroundings replaces the old.
            let from = matches!(area, Some(Area::Near(_))).then(|| st.entities.get(&me).map_or(0, |e| e.moved));
            let moved = last.is_some_and(|l| l.from != from);
            let whole = moved.then_some(true);
            let scope = area.map(|a| index.scope(s, st, a, &me));
            // Changes after this cursor are new; None: everything (a first look, a move, or the full picture).
            let after = if moved { None } else { last.map(|l| l.cursor) };
            let changed = |c: u64| after.is_none_or(|a| c > a);
            let data = match &ch.kind {
                ChannelKind::Accounts => {
                    let mut accounts: Vec<AccountItem> = index
                        .accounts_of(st, &me)
                        .iter()
                        .filter_map(|id| {
                            let a = &st.accounts[id];
                            changed(a.changed).then(|| AccountItem { account: id.clone(), holder: a.holder.clone(), custodian: a.custodian.clone(), currency: a.currency.clone(), balance: a.balance, closed: None })
                        })
                        .collect();
                    if after.is_some() {
                        for (id, x) in st.closed_accounts.iter() {
                            if (x.holder == me || x.custodian == me) && changed(x.changed) {
                                accounts.push(AccountItem { account: id.clone(), holder: x.holder.clone(), custodian: x.custodian.clone(), currency: x.currency.clone(), balance: 0, closed: Some(true) });
                            }
                        }
                    }
                    accounts.sort_by(|a, b| a.account.cmp(&b.account));
                    let transactions = if mode == Mode::Look { p.new_transactions.get(&me).cloned().unwrap_or_default() } else { vec![] };
                    if mode == Mode::Look {
                        drained.push(me.clone());
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
                        .filter(|(_, h)| changed(h.changed))
                        .map(|(_, h)| HoldingItem { kind: h.kind.clone(), at: h.at.clone(), quantity: h.quantity })
                        .collect();
                    ChannelData::Holdings { holdings }
                }
                ChannelKind::Records { filter, .. } => {
                    let from = after.unwrap_or(0);
                    let want: Option<BTreeSet<&str>> = filter.involving.as_ref().map(|inv| inv.iter().map(|e| if e == SELF { me.as_str() } else { e.as_str() }).collect());
                    let seqs = match &scope {
                        Some(sc) => index.placed(sc, from),
                        None => index.candidates(filter, want.as_ref(), from).unwrap_or_else(|| (from + 1..=st.record_order.len() as u64).collect()),
                    };
                    ChannelData::Records {
                        records: seqs
                            .into_iter()
                            .map(at_seq)
                            .filter(|r| can_see(st, r, &me) && placed_ok(st, r, &me, scope.as_ref()) && matches(st, r, filter, want.as_ref()))
                            .cloned()
                            .collect(),
                        search: None,
                        whole,
                    }
                }
                ChannelKind::Sites { occupants, .. } => {
                    let names = *occupants == Some(Occupants::Names);
                    let site = |id: &Id| st.cells.get(id).filter(|c| changed(c.changed)).map(|_| site_cell(s, st, id, &me, names));
                    ChannelData::Sites {
                        as_of: st.t,
                        cells: match scope.as_ref().unwrap() {
                            Scope::Everywhere => st.cells.keys().filter_map(site).collect(),
                            Scope::Cells(ps) => ps.iter().filter_map(site).collect(),
                        },
                        whole,
                    }
                }
                ChannelKind::Directory => ChannelData::Directory {
                    entities: st
                        .entities
                        .iter()
                        .filter(|(_, e)| changed(e.changed))
                        .map(|(id, e)| EntityItem { entity: id.clone(), kind: e.kind.clone(), name: e.name.clone(), participant: e.body.as_ref().and_then(|b| b.participant.clone()) })
                        .collect(),
                    positions: st
                        .positions
                        .iter()
                        .filter(|(_, x)| changed(x.changed))
                        .map(|(id, x)| PositionItem {
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
                        })
                        .collect(),
                },
            };
            if mode == Mode::Look {
                let cursor = if matches!(ch.kind, ChannelKind::Records { .. }) { st.counters.record_seq } else { st.counters.change };
                looks.push((path.clone(), Look { at: st.t, cursor, from }));
            }
            channels.insert(path, data);
        }
    }
    let body = p.person.as_ref().and_then(|person| st.body(person)).map(|b| BodyView {
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
        conditions: b.conditions.clone(),
    });
    let positions = st
        .positions
        .iter()
        .filter(|(_, x)| x.holder.as_deref() == Some(participant))
        .map(|(id, x)| HeldPosition { position: id.clone(), entity: x.entity.clone(), title: x.title.clone(), role: x.role.clone() })
        .collect();
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
    };
    (obs, looks, drained)
}

/// A search through a records channel: records the participant may see that match the channel's filter
/// and the query, now. Standing records only if asked; ordered as asked (newest first by default);
/// at most `limit` (default 20).
fn search(st: &State, index: &mut RecordIndex, me: &str, filter: &RecordFilter, area: Option<&Scope>, q: &Query) -> Vec<Record> {
    let want: Option<BTreeSet<&str>> = filter.involving.as_ref().map(|inv| inv.iter().map(|e| if e == "self" { me } else { e.as_str() }).collect());
    let at_seq = |seq: u64| &*st.records[&st.record_order[(seq - 1) as usize]].record;
    let seqs: Vec<u64> = if let Some(sc) = area {
        let mut v = index.placed(sc, 0);
        if q.standing == Some(true) {
            v.retain(|&seq| index.is_standing(at_seq(seq), seq));
        }
        v.reverse();
        v
    } else if q.standing == Some(true) {
        index.standing(filter)
    } else {
        let mut v = index.candidates(filter, want.as_ref(), 0).unwrap_or_else(|| (1..=st.record_order.len() as u64).collect());
        v.reverse();
        v
    };
    let conditions = q.conditions.as_deref().unwrap_or(&[]);
    let mut hits: Vec<(u64, &Record)> = seqs
        .into_iter()
        .map(|seq| (seq, at_seq(seq)))
        .filter(|(_, r)| can_see(st, r, me) && placed_ok(st, r, me, area) && matches(st, r, filter, want.as_ref()) && conditions.iter().all(|c| holds(r, c)))
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
    hits.into_iter().take(q.limit.unwrap_or(20) as usize).map(|(_, r)| r.clone()).collect()
}
