//! Observations (v0.2), mirroring the Observation definition in
//! contracts/seat-api.schema.json. A seat perceives only through its channels
//! (plus its inbox and the outcomes of its own acts), and a record only ever
//! appears if its visibility lets the seat's entity see it. The kernel builds
//! everything except `drafts`, which the orchestrator adds from the
//! translator; the observation hash in the log covers the kernel-built
//! observation (with `drafts: []`).

use crate::blocks::{Id, Record};
use crate::config::{Area, ChannelKind, RecordFilter};
use crate::state::{Message, Outcome, SeatStatus, SiteView, State, Transaction};
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
    Records { records: Vec<Record> },
    Sites { as_of: i64, parcels: Vec<SiteParcel> },
    Directory { entities: Vec<EntityItem>, seats: Vec<SeatItem> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountItem {
    pub account: Id,
    pub holder: Id,
    pub custodian: Id,
    pub balance: i64,
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
    pub occupant: Id,
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
    accounts: Option<AccountsByEntity>,
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

fn site_parcels(st: &State, area: &Area) -> Vec<SiteParcel> {
    st.parcels
        .iter()
        .filter(|(id, _)| match area {
            Area::All(_) => true,
            Area::Parcels(ps) => ps.iter().any(|p| p == *id),
        })
        .map(|(id, p)| SiteParcel {
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
                    occupancy: st
                        .occupancy
                        .get(sid)
                        .into_iter()
                        .flatten()
                        .flat_map(|(occ, slots)| {
                            slots.iter().map(|(slot, c)| OccupancyItem { occupant: occ.clone(), slot: slot.clone(), count: *c })
                        })
                        .collect(),
                }
            }),
        })
        .collect()
}

/// Build a seat's observation, consuming its "new since last time" state.
pub fn observe(s: &Statics, st: &mut State, index: &mut RecordIndex, seat: &str) -> Observation {
    let cfg = &s.seats[seat];
    let me = cfg.entity.clone();
    let cursor = st.seats[seat].record_cursor;
    index.catch_up(s, st);
    // Record with seq q is the q-th made.
    let at_seq = |q: u64| &*st.records[&st.record_order[(q - 1) as usize]].record;

    let mut channels = BTreeMap::new();
    let mut refreshed: Vec<(Id, SiteView)> = vec![];
    for ch in &cfg.channels {
        let data = match &ch.kind {
            ChannelKind::Accounts => ChannelData::Accounts {
                accounts: index
                    .accounts_of(st, &me)
                    .iter()
                    .map(|id| {
                        let a = &st.accounts[id];
                        AccountItem { account: id.clone(), holder: a.holder.clone(), custodian: a.custodian.clone(), balance: a.balance }
                    })
                    .collect(),
                transactions: st.seats[seat].new_transactions.clone(),
            },
            ChannelKind::Records { filter, new_only } => {
                let after = if new_only.unwrap_or(false) { cursor } else { 0 };
                let want: Option<BTreeSet<&str>> =
                    filter.involving.as_ref().map(|inv| inv.iter().map(|e| if e == "self" { me.as_str() } else { e.as_str() }).collect());
                let seqs = index.candidates(filter, want.as_ref(), after).unwrap_or_else(|| (after + 1..=st.record_order.len() as u64).collect());
                ChannelData::Records {
                    records: seqs
                        .into_iter()
                        .map(at_seq)
                        .filter(|r| can_see(s, r, &me) && matches(s, st, r, filter, want.as_ref()))
                        .cloned()
                        .collect(),
                }
            }
            ChannelKind::Sites { area, every } => match (every, st.seats[seat].site_views.get(&ch.id)) {
                (Some(e), Some(v)) if st.t < v.as_of + e => ChannelData::Sites { as_of: v.as_of, parcels: (*v.parcels).clone() },
                (every, _) => {
                    let view = SiteView { as_of: st.t, parcels: std::sync::Arc::new(site_parcels(st, area)) };
                    if every.is_some() {
                        refreshed.push((ch.id.clone(), view.clone()));
                    }
                    ChannelData::Sites { as_of: view.as_of, parcels: (*view.parcels).clone() }
                }
            },
            ChannelKind::Directory => ChannelData::Directory {
                entities: st
                    .entities
                    .iter()
                    .map(|(id, e)| EntityItem { entity: id.clone(), kind: e.kind.clone(), name: e.name.clone() })
                    .collect(),
                seats: s
                    .seats
                    .values()
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
        channels.insert(ch.id.clone(), data);
    }

    let record_seq = st.counters.record_seq;
    let ss = st.seats.get_mut(seat).unwrap();
    for (id, view) in refreshed {
        ss.site_views.insert(id, view);
    }
    ss.record_cursor = record_seq;
    ss.new_transactions.clear();
    Observation {
        seat: seat.into(),
        t: st.t,
        status: ss.status,
        entity: me,
        outcomes: std::mem::take(&mut ss.new_outcomes),
        inbox: std::mem::take(&mut ss.new_inbox),
        drafts: vec![],
        channels,
    }
}
