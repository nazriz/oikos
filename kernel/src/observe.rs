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

fn matches(s: &Statics, rec: &Record, f: &RecordFilter, me: &str) -> bool {
    if f.records.as_ref().is_some_and(|k| !k.iter().any(|x| x == rec.body.kind_name())) {
        return false;
    }
    if let Some(kinds) = &f.statement_kinds {
        match &rec.body {
            crate::blocks::RecordBody::Statement { kind, .. } if kinds.contains(kind) => {}
            _ => return false,
        }
    }
    if let Some(inv) = &f.involving {
        let want: BTreeSet<&str> = inv.iter().map(|e| if e == "self" { me } else { e.as_str() }).collect();
        let named = rec.entities_named().into_iter().chain(s.entity_of(&rec.author));
        if !named.into_iter().any(|e| want.contains(e)) {
            return false;
        }
    }
    true
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
pub fn observe(s: &Statics, st: &mut State, seat: &str) -> Observation {
    let cfg = &s.seats[seat];
    let me = cfg.entity.clone();
    let cursor = st.seats[seat].record_cursor;
    let mut by_seq: Vec<(u64, &Record)> = st.records.values().map(|x| (x.seq, &x.record)).collect();
    by_seq.sort_by_key(|(seq, _)| *seq);

    let mut channels = BTreeMap::new();
    let mut refreshed: Vec<(Id, SiteView)> = vec![];
    for ch in &cfg.channels {
        let data = match &ch.kind {
            ChannelKind::Accounts => ChannelData::Accounts {
                accounts: st
                    .accounts
                    .iter()
                    .filter(|(_, a)| a.holder == me || a.custodian == me)
                    .map(|(id, a)| AccountItem {
                        account: id.clone(),
                        holder: a.holder.clone(),
                        custodian: a.custodian.clone(),
                        balance: a.balance,
                    })
                    .collect(),
                transactions: st.seats[seat].new_transactions.clone(),
            },
            ChannelKind::Records { filter, new_only } => ChannelData::Records {
                records: by_seq
                    .iter()
                    .filter(|(seq, r)| (!new_only.unwrap_or(false) || *seq > cursor) && can_see(s, r, &me) && matches(s, r, filter, &me))
                    .map(|(_, r)| (*r).clone())
                    .collect(),
            },
            ChannelKind::Sites { area, every } => match (every, st.seats[seat].site_views.get(&ch.id)) {
                (Some(e), Some(v)) if st.t < v.as_of + e => ChannelData::Sites { as_of: v.as_of, parcels: v.parcels.clone() },
                (every, _) => {
                    let view = SiteView { as_of: st.t, parcels: site_parcels(st, area) };
                    if every.is_some() {
                        refreshed.push((ch.id.clone(), view.clone()));
                    }
                    ChannelData::Sites { as_of: view.as_of, parcels: view.parcels }
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
