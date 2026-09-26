//! Observations (v0.2), mirroring the Observation definition in
//! contracts/seat-api.schema.json. A seat perceives only through its channels
//! (plus its inbox and the outcomes of its own acts), and a record only ever
//! appears if its visibility lets the seat's entity see it. The kernel builds
//! everything except `drafts`, which the orchestrator adds from the
//! translator; the observation hash in the log covers the kernel-built
//! observation (with `drafts: []`).

use crate::blocks::{Id, Record};
use crate::config::{Area, ChannelKind, CmpOp, LookRequest, Occupants, Query, RecordFilter};
use crate::state::{Look, Message, Outcome, Parcel, SeatStatus, State, Transaction};
use crate::statics::Statics;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Observation {
    pub seat: Id,
    pub t: i64,
    pub status: SeatStatus,
    pub entity: Id,
    pub outcomes: Vec<Outcome>,
    pub inbox: Vec<Message>,
    pub drafts: Vec<Value>,
    pub channels: BTreeMap<Id, ChannelData>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChannelData {
    Accounts { accounts: Vec<AccountItem>, transactions: Vec<Transaction> },
    Records {
        records: Vec<Record>,
        /// Set when these are a search's results (what matches now), not what's new since the last look.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        search: Option<bool>,
        /// Set when the seat's surroundings changed (it moved): everything the channel now covers,
        /// in place of what it covered before.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        whole: Option<bool>,
    },
    Sites {
        as_of: i64,
        parcels: Vec<SiteParcel>,
        /// As for records: the whole of the seat's new surroundings, in place of the old.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        whole: Option<bool>,
    },
    Directory { entities: Vec<EntityItem>, seats: Vec<SeatItem> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountItem {
    pub account: Id,
    pub holder: Id,
    pub custodian: Id,
    pub balance: i64,
    /// Set when the account has been closed since the seat last looked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteParcel {
    pub parcel: Id,
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<SiteStructure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteStructure {
    pub structure: Id,
    #[serde(rename = "type")]
    pub structure_type: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub built_by: Option<Id>,
    pub complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completes_at: Option<i64>,
    pub occupancy: Vec<OccupancyItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OccupancyItem {
    /// Who, where the seat can tell (its own buildings, or a channel that shows names); otherwise a count per slot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occupant: Option<Id>,
    pub slot: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityItem {
    pub entity: Id,
    pub kind: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeatItem {
    pub seat: Id,
    pub entity: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub status: SeatStatus,
}

/// Can seats of `entity` perceive this record? The author's entity always can.
pub fn can_see(s: &Statics, rec: &Record, entity: &str) -> bool {
    rec.visible_to.allows(entity) || s.entity_of(&rec.author) == Some(entity)
}

/// Where a record physically is: the parcel a statement was put up on, and the same place for
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
/// placed there; one without sees what isn't placed anywhere, and what the seat's entity put up itself.
fn placed_ok(s: &Statics, st: &State, rec: &Record, me: &str, area: Option<&Scope>) -> bool {
    match (place_of(st, rec), area) {
        (None, None) => true,
        (None, Some(_)) => false,
        (Some(p), Some(scope)) => scope.covers(p),
        (Some(_), None) => s.entity_of(&rec.author) == Some(me) || rec.speaks_for.as_deref() == Some(me),
    }
}

/// The parcels an area covers for a seat, now.
#[derive(Debug)]
enum Scope {
    Everywhere,
    Parcels(BTreeSet<Id>),
}

impl Scope {
    fn covers(&self, p: &str) -> bool {
        match self {
            Scope::Everywhere => true,
            Scope::Parcels(ps) => ps.contains(p),
        }
    }
}

/// Are two parcels within `n` of each other? The distance is the gap between their rectangles
/// (0 when they touch), in the world's own units.
pub fn within(a: &Parcel, b: &Parcel, n: i64) -> bool {
    let gap = |a0: i64, a1: i64, b0: i64, b1: i64| (a0.max(b0) as i128 - a1.min(b1) as i128).max(0);
    let dx = gap(a.x, a.x + a.w, b.x, b.x + b.w);
    let dy = gap(a.y, a.y + a.h, b.y, b.y + b.h);
    dx * dx + dy * dy <= n as i128 * n as i128
}

/// Entities a record involves: those it names, its author's entity, and (one
/// hop) those named by any record it refers to. A signature on my agreement,
/// or a withdrawal of my listing, involves me (D32).
fn involved<'a>(s: &'a Statics, st: &'a State, rec: &'a Record) -> Vec<&'a str> {
    let mut v: Vec<&str> = rec.entities_named().into_iter().chain(s.entity_of(&rec.author)).collect();
    for other in rec.body.records_referenced() {
        if let Some(o) = st.records.get(other) {
            v.extend(o.record.entities_named());
            v.extend(s.entity_of(&o.record.author));
        }
    }
    v
}

fn matches(s: &Statics, st: &State, rec: &Record, f: &RecordFilter, want: Option<&BTreeSet<&str>>) -> bool {
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
        if !involved(s, st, rec).into_iter().any(|e| want.contains(e)) {
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
    /// parcel -> records placed there (and withdrawals of them).
    by_place: BTreeMap<Id, Vec<u64>>,
    accounts: Option<AccountsByEntity>,
    /// entity -> (its `moved` stamp, the parcels where it occupies a building then).
    places: BTreeMap<Id, (u64, Vec<Id>)>,
    /// distance -> parcel -> parcels within that distance. Parcels never change, so this is built once per distance.
    near: BTreeMap<i64, BTreeMap<Id, Vec<Id>>>,
}

/// entity -> accounts it holds or keeps, for the account set identified by
/// (accounts ever opened, accounts now open): accounts are only opened or
/// closed, never changed, so that pair pins the set down.
type AccountsByEntity = ((u64, usize), BTreeMap<Id, Vec<Id>>);

impl RecordIndex {
    fn catch_up(&mut self, s: &Statics, st: &State) {
        for i in self.indexed..st.record_order.len() {
            let stored = &st.records[&st.record_order[i]];
            let (seq, rec) = (stored.seq, &*stored.record);
            self.by_record.entry(rec.body.kind_name()).or_default().push(seq);
            if let crate::blocks::RecordBody::Statement { kind, .. } = &rec.body {
                self.by_kind.entry(kind.clone()).or_default().push(seq);
            }
            let who: BTreeSet<&str> = involved(s, st, rec).into_iter().collect();
            for e in who {
                self.by_entity.entry(e.to_string()).or_default().push(seq);
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
                    let owner = |r: &Record| -> Vec<String> { r.speaks_for.iter().cloned().chain(s.entity_of(&r.author).map(String::from)).collect() };
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
            Scope::Parcels(ps) => ps.iter().filter_map(|p| self.by_place.get(p)).flat_map(tail).collect(),
        };
        seqs.sort_unstable();
        seqs
    }

    /// The parcels an area covers for an entity, now.
    fn scope(&mut self, st: &State, area: &Area, me: &str) -> Scope {
        match area {
            Area::All(_) => Scope::Everywhere,
            Area::Parcels(ps) => Scope::Parcels(ps.iter().cloned().collect()),
            Area::Near(n) => {
                let moved = st.entities.get(me).map_or(0, |e| e.moved);
                if self.places.get(me).is_none_or(|(m, _)| *m != moved) {
                    let mut ps: Vec<Id> = st
                        .occupancy
                        .iter()
                        .filter(|(_, occ)| occ.contains_key(me))
                        .filter_map(|(sid, _)| st.structures.get(sid).map(|x| x.parcel.clone()))
                        .collect();
                    ps.sort();
                    ps.dedup();
                    self.places.insert(me.to_string(), (moved, ps));
                }
                let table = self.near.entry(n.near).or_insert_with(|| near_table(st, n.near));
                Scope::Parcels(self.places[me].1.iter().flat_map(|p| table.get(p).into_iter().flatten().cloned()).collect())
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

/// Each parcel's neighbours within `n` (itself included), found by sweeping along x.
fn near_table(st: &State, n: i64) -> BTreeMap<Id, Vec<Id>> {
    let mut by_x: Vec<(&Id, &Parcel)> = st.parcels.iter().collect();
    by_x.sort_by_key(|(id, p)| (p.x, (*id).clone()));
    let widest = by_x.iter().map(|(_, p)| p.w).max().unwrap_or(0);
    let mut out = BTreeMap::new();
    for (id, p) in &by_x {
        // Anything within reach starts no further left than this, and no further right than p's far edge plus n.
        let lo = by_x.partition_point(|(_, q)| (q.x as i128) < p.x as i128 - n as i128 - widest as i128);
        let hi = by_x.partition_point(|(_, q)| (q.x as i128) <= p.x as i128 + p.w as i128 + n as i128);
        let mut v: Vec<Id> = by_x[lo..hi].iter().filter(|(_, q)| within(p, q, n)).map(|(qid, _)| (*qid).clone()).collect();
        v.sort();
        out.insert((*id).clone(), v);
    }
    out
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

fn site_parcel(st: &State, id: &Id, p: &Parcel, me: &str, names: bool) -> SiteParcel {
    SiteParcel {
        parcel: id.clone(),
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        structure: p.structure.as_ref().map(|sid| {
            let x = &st.structures[sid];
            SiteStructure {
                structure: sid.clone(),
                structure_type: x.structure_type.clone(),
                built_by: x.built_by.clone(),
                complete: x.complete,
                completes_at: x.completes_at,
                occupancy: {
                    let occ = st.occupancy.get(sid);
                    // Who is in a building: known in one's own, and where the channel shows names; otherwise how many.
                    if names || occ.is_some_and(|o| o.contains_key(me)) {
                        occ.into_iter()
                            .flatten()
                            .flat_map(|(o, slots)| slots.iter().map(|(slot, c)| OccupancyItem { occupant: Some(o.clone()), slot: slot.clone(), count: *c }))
                            .collect()
                    } else {
                        let mut by_slot: BTreeMap<&String, u32> = BTreeMap::new();
                        for slots in occ.into_iter().flat_map(|o| o.values()) {
                            for (slot, c) in slots {
                                *by_slot.entry(slot).or_default() += c;
                            }
                        }
                        by_slot.into_iter().map(|(slot, count)| OccupancyItem { occupant: None, slot: slot.clone(), count }).collect()
                    }
                },
            }
        }),
    }
}

/// How an observation is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// A seat's ordinary look: only channels that are due (`every`), and in each,
    /// only what changed since the seat last looked through it. Consumes what it delivers.
    Look,
    /// Everything each channel covers, now, ignoring `every` and consuming nothing:
    /// what a seat's view, built up from its looks, must equal (the perception invariant).
    Full,
}

/// Build a seat's observation, consuming its "new since last time" state.
pub fn observe(s: &Statics, st: &mut State, index: &mut RecordIndex, seat: &str, requested: &[LookRequest]) -> Observation {
    let (obs, looks, drained) = build(s, st, index, seat, Mode::Look, requested);
    let ss = st.seats.get_mut(seat).unwrap();
    for (id, look) in looks {
        ss.looks.insert(id, look);
    }
    if drained {
        ss.new_transactions.clear();
    }
    let ss = st.seats.get_mut(seat).unwrap();
    Observation { outcomes: std::mem::take(&mut ss.new_outcomes), inbox: std::mem::take(&mut ss.new_inbox), ..obs }
}

/// The full picture a seat's channels cover right now (Mode::Full), changing nothing.
pub fn full_view(s: &Statics, st: &State, index: &mut RecordIndex, seat: &str) -> Observation {
    build(s, st, index, seat, Mode::Full, &[]).0
}

fn build(s: &Statics, st: &State, index: &mut RecordIndex, seat: &str, mode: Mode, requested: &[LookRequest]) -> (Observation, Vec<(Id, Look)>, bool) {
    let cfg = &s.seats[seat];
    let me = cfg.entity.clone();
    index.catch_up(s, st);
    let ss = &st.seats[seat];
    // Record with seq q is the q-th made.
    let at_seq = |q: u64| &*st.records[&st.record_order[(q - 1) as usize]].record;

    let mut channels = BTreeMap::new();
    let mut looks = vec![];
    let mut drained = false;
    for ch in &cfg.channels {
        let asked = requested.iter().find(|l| l.channel == ch.id);
        // A search: what matches now, within what the seat may see; its cursor for changes is untouched.
        if let (Some(LookRequest { query: Some(q), .. }), ChannelKind::Records { filter, area }) = (asked, &ch.kind) {
            let scope = area.as_ref().map(|a| index.scope(st, a, &me));
            channels.insert(ch.id.clone(), ChannelData::Records { records: search(s, st, index, &me, filter, scope.as_ref(), q), search: Some(true), whole: None });
            continue;
        }
        if mode == Mode::Look && ch.on_request == Some(true) && asked.is_none() {
            continue; // perceived only when the seat asks
        }
        let last = if mode == Mode::Full { None } else { ss.looks.get(&ch.id).copied() };
        if let (Some(every), Some(l), None) = (ch.every, last, asked) {
            if st.t < l.at + every {
                continue; // not looking through this channel yet; changes accumulate
            }
        }
        // A channel that looks near the seat's entity looks from where it is now: if it has moved since
        // the last look, the whole of its new surroundings replaces the old.
        let area = match &ch.kind {
            ChannelKind::Records { area, .. } => area.as_ref(),
            ChannelKind::Sites { area, .. } => Some(area),
            _ => None,
        };
        let from = matches!(area, Some(Area::Near(_))).then(|| st.entities.get(&me).map_or(0, |e| e.moved));
        let moved = last.is_some_and(|l| l.from != from);
        let whole = moved.then_some(true);
        let scope = area.map(|a| index.scope(st, a, &me));
        // Changes after this cursor are new to the seat; None: everything (a first look, a move, or the full picture).
        let after = if moved { None } else { last.map(|l| l.cursor) };
        let changed = |c: u64| after.is_none_or(|a| c > a);
        let data = match &ch.kind {
            ChannelKind::Accounts => {
                let mut accounts: Vec<AccountItem> = index
                    .accounts_of(st, &me)
                    .iter()
                    .filter_map(|id| {
                        let a = &st.accounts[id];
                        changed(a.changed).then(|| AccountItem { account: id.clone(), holder: a.holder.clone(), custodian: a.custodian.clone(), balance: a.balance, closed: None })
                    })
                    .collect();
                if after.is_some() {
                    for (id, x) in st.closed_accounts.iter() {
                        if (x.holder == me || x.custodian == me) && changed(x.changed) {
                            accounts.push(AccountItem { account: id.clone(), holder: x.holder.clone(), custodian: x.custodian.clone(), balance: 0, closed: Some(true) });
                        }
                    }
                }
                accounts.sort_by(|a, b| a.account.cmp(&b.account));
                let transactions = if mode == Mode::Look { ss.new_transactions.clone() } else { vec![] };
                drained = mode == Mode::Look;
                ChannelData::Accounts { accounts, transactions }
            }
            ChannelKind::Records { filter, .. } => {
                let from = after.unwrap_or(0);
                let want: Option<BTreeSet<&str>> =
                    filter.involving.as_ref().map(|inv| inv.iter().map(|e| if e == "self" { me.as_str() } else { e.as_str() }).collect());
                let seqs = match &scope {
                    Some(sc) => index.placed(sc, from),
                    None => index.candidates(filter, want.as_ref(), from).unwrap_or_else(|| (from + 1..=st.record_order.len() as u64).collect()),
                };
                ChannelData::Records {
                    records: seqs
                        .into_iter()
                        .map(at_seq)
                        .filter(|r| can_see(s, r, &me) && placed_ok(s, st, r, &me, scope.as_ref()) && matches(s, st, r, filter, want.as_ref()))
                        .cloned()
                        .collect(),
                    search: None,
                    whole,
                }
            }
            ChannelKind::Sites { occupants, .. } => {
                let names = *occupants == Some(Occupants::Names);
                let site = |(id, p): (&Id, &Parcel)| changed(p.changed).then(|| site_parcel(st, id, p, &me, names));
                ChannelData::Sites {
                    as_of: st.t,
                    parcels: match scope.as_ref().unwrap() {
                        Scope::Everywhere => st.parcels.iter().filter_map(site).collect(),
                        Scope::Parcels(ps) => ps.iter().filter_map(|id| st.parcels.get_key_value(id)).filter_map(site).collect(),
                    },
                    whole,
                }
            }
            ChannelKind::Directory => ChannelData::Directory {
                entities: st
                    .entities
                    .iter()
                    .filter(|(_, e)| changed(e.changed))
                    .map(|(id, e)| EntityItem { entity: id.clone(), kind: e.kind.clone(), name: e.name.clone() })
                    .collect(),
                seats: s
                    .seats
                    .values()
                    .filter(|x| changed(st.seats[&x.id].status_changed))
                    .map(|x| SeatItem {
                        seat: x.id.clone(),
                        entity: x.entity.clone(),
                        title: x.title.clone(),
                        role: x.role.clone(),
                        status: st.seats[&x.id].status,
                    })
                    .collect(),
            },
        };
        if mode == Mode::Look {
            let cursor = if matches!(ch.kind, ChannelKind::Records { .. }) { st.counters.record_seq } else { st.counters.change };
            looks.push((ch.id.clone(), Look { at: st.t, cursor, from }));
        }
        channels.insert(ch.id.clone(), data);
    }
    let obs = Observation {
        seat: seat.into(),
        t: st.t,
        status: ss.status,
        entity: me,
        outcomes: if mode == Mode::Full { vec![] } else { ss.new_outcomes.clone() },
        inbox: if mode == Mode::Full { vec![] } else { ss.new_inbox.clone() },
        drafts: vec![],
        channels,
    };
    (obs, looks, drained)
}

/// A search through a records channel: records the seat may see that match the channel's filter
/// and the query, now. Standing records only if asked; ordered as asked (newest first by default);
/// at most `limit` (default 20).
fn search(s: &Statics, st: &State, index: &mut RecordIndex, me: &str, filter: &RecordFilter, area: Option<&Scope>, q: &Query) -> Vec<Record> {
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
        .filter(|(_, r)| can_see(s, r, me) && placed_ok(s, st, r, me, area) && matches(s, st, r, filter, want.as_ref()) && conditions.iter().all(|c| holds(r, c)))
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
