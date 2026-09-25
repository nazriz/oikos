//! Role-limited observations, mirroring the Observation definition in
//! contracts/seat-api.schema.json. The kernel builds everything except
//! `drafts`, which the orchestrator adds from the translator; the observation
//! hash in the log covers the kernel-built observation (with `drafts: []`).

use crate::blocks::{AgreementTerms, Block, Id, RightKind, Rule, StructureCategory};
use crate::config::{ChannelKind, Level, Mandate, Scope};
use crate::laws::{self, Statics};
use crate::state::{AgreementStatus, Message, Outcome, SeatStatus, State};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Observation {
    pub seat: Id,
    pub t: i64,
    pub status: SeatStatus,
    pub principal: Id,
    pub can_act_for: Vec<Id>,
    pub mandate: Mandate,
    pub outcomes: Vec<Outcome>,
    pub inbox: Vec<Message>,
    pub awaiting: Vec<AwaitingItem>,
    pub drafts: Vec<Value>,
    pub channels: BTreeMap<Id, ChannelData>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AwaitingItem {
    Approval {
        proposal: Id,
        from: Id,
        since: i64,
        blocks: Vec<Block>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
    },
    Request {
        proposal: Id,
        from: Id,
        since: i64,
        blocks: Vec<Block>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
    },
    AgreementOffer {
        agreement: Id,
        terms: AgreementTerms,
        proposed_by: Id,
        respond_as: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expires_at: Option<i64>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChannelData {
    Accounts { items: Vec<AccountItem> },
    Parcels { items: Vec<ParcelItem> },
    Rules { items: Vec<RuleItem> },
    Agreements { items: Vec<AgreementItem> },
    Directory { seats: Vec<SeatItem>, entities: Vec<EntityItem> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountItem {
    pub entity: Id,
    pub name: String,
    pub balance: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParcelItem {
    pub parcel: Id,
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
    pub allow: Vec<StructureCategory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<StructureItem>,
    pub rights: Vec<RightItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StructureItem {
    pub structure: Id,
    #[serde(rename = "type")]
    pub structure_type: Id,
    pub owner: Id,
    pub complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completes_at: Option<i64>,
    pub units_leased: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RightItem {
    pub right: Id,
    pub kind: RightKind,
    pub holder: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleItem {
    pub rule: Id,
    pub jurisdiction: Id,
    pub enacted_at: i64,
    pub body: Rule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgreementItem {
    pub agreement: Id,
    pub status: AgreementStatus,
    pub terms: AgreementTerms,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_payment_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeatItem {
    pub seat: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub principal: Id,
    pub status: SeatStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityItem {
    pub entity: Id,
    pub kind: String,
    pub name: String,
}

/// Build (and consume the "new since last time" parts of) a seat's observation.
pub fn observe(s: &Statics, st: &mut State, seat: &str) -> Observation {
    let cfg = &s.seats[seat];
    let principal = cfg.principal.clone();
    let mine = laws::actable_set(st, &principal);
    let juris: BTreeSet<Id> = s.jurisdictions.get(&principal).cloned().unwrap_or_default();

    let mut awaiting = vec![];
    for (id, p) in &st.proposals {
        if p.awaiting.contains(seat) && !p.approved.contains(seat) {
            let (proposal, from, since, blocks, reasoning) = (id.clone(), p.seat.clone(), p.since, p.blocks.clone(), p.reasoning.clone());
            awaiting.push(match p.level {
                Level::Request => AwaitingItem::Request { proposal, from, since, blocks, reasoning },
                _ => AwaitingItem::Approval { proposal, from, since, blocks, reasoning },
            });
        }
    }
    for (id, a) in &st.agreements {
        if a.status != AgreementStatus::Pending {
            continue;
        }
        for party in a.terms.parties() {
            if !a.accepted.contains(party) && mine.contains(party) {
                awaiting.push(AwaitingItem::AgreementOffer {
                    agreement: id.clone(),
                    terms: a.terms.clone(),
                    proposed_by: a.proposed_by.clone(),
                    respond_as: party.to_string(),
                    expires_at: a.expires_at,
                });
            }
        }
    }

    let mut channels = BTreeMap::new();
    for ch in &cfg.channels {
        let data = match ch.kind {
            ChannelKind::Accounts => ChannelData::Accounts { items: accounts(st, ch.scope, &mine, &juris) },
            ChannelKind::Parcels => ChannelData::Parcels { items: parcels(s, st, ch.scope, &mine, &juris) },
            ChannelKind::Rules => ChannelData::Rules { items: rules(s, st, ch.scope, &mine, &juris) },
            ChannelKind::Agreements => ChannelData::Agreements { items: agreements(st, ch.scope, &mine, &juris) },
            ChannelKind::Directory => directory(s, st, ch.scope, &mine),
        };
        channels.insert(ch.id.clone(), data);
    }

    let ss = st.seats.get_mut(seat).unwrap();
    Observation {
        seat: seat.to_string(),
        t: st.t,
        status: ss.status,
        principal,
        can_act_for: mine.into_iter().collect(),
        mandate: cfg.mandate.clone(),
        outcomes: std::mem::take(&mut ss.new_outcomes),
        inbox: std::mem::take(&mut ss.new_inbox),
        awaiting,
        drafts: vec![],
        channels,
    }
}

fn parcel_in_scope(st: &State, p: &str, scope: Scope, mine: &BTreeSet<Id>, juris: &BTreeSet<Id>) -> bool {
    match scope {
        Scope::All => true,
        Scope::Jurisdiction => juris.contains(p),
        Scope::Own => {
            st.rights.values().any(|r| r.parcel == p && mine.contains(&r.holder))
                || st.parcels[p].structure.as_ref().is_some_and(|s| mine.contains(&st.structures[s].owner))
        }
    }
}

fn accounts(st: &State, scope: Scope, mine: &BTreeSet<Id>, juris: &BTreeSet<Id>) -> Vec<AccountItem> {
    let mut ids: BTreeSet<&Id> = mine.iter().collect();
    match scope {
        Scope::Own => {}
        Scope::Jurisdiction => {
            ids.extend(st.rights.values().filter(|r| juris.contains(&r.parcel)).map(|r| &r.holder));
            ids.extend(st.structures.values().filter(|s| juris.contains(&s.parcel)).map(|s| &s.owner));
        }
        Scope::All => ids.extend(st.entities.keys()),
    }
    ids.into_iter()
        .filter_map(|id| {
            st.entities.get(id).filter(|e| e.active).map(|e| AccountItem { entity: id.clone(), name: e.name.clone(), balance: e.balance })
        })
        .collect()
}

fn parcels(s: &Statics, st: &State, scope: Scope, mine: &BTreeSet<Id>, juris: &BTreeSet<Id>) -> Vec<ParcelItem> {
    st.parcels
        .iter()
        .filter(|(id, _)| parcel_in_scope(st, id, scope, mine, juris))
        .map(|(id, p)| ParcelItem {
            parcel: id.clone(),
            x: p.x,
            y: p.y,
            w: p.w,
            h: p.h,
            allow: laws::zoning_allows(s, st, id),
            structure: p.structure.as_ref().map(|sid| {
                let x = &st.structures[sid];
                StructureItem {
                    structure: sid.clone(),
                    structure_type: x.structure_type.clone(),
                    owner: x.owner.clone(),
                    complete: x.complete,
                    completes_at: x.completes_at,
                    units_leased: laws::leased_units(st, id),
                }
            }),
            rights: st
                .rights
                .iter()
                .filter(|(_, r)| r.parcel == *id)
                .map(|(rid, r)| RightItem { right: rid.clone(), kind: r.kind, holder: r.holder.clone(), until: r.until, units: r.units })
                .collect(),
        })
        .collect()
}

fn rules(s: &Statics, st: &State, scope: Scope, mine: &BTreeSet<Id>, juris: &BTreeSet<Id>) -> Vec<RuleItem> {
    st.rules
        .iter()
        .filter(|(_, r)| match scope {
            Scope::All => true,
            Scope::Own => mine.contains(&r.jurisdiction),
            Scope::Jurisdiction => mine.contains(&r.jurisdiction) || juris.iter().any(|p| laws::rule_covers(s, r, p)),
        })
        .map(|(id, r)| RuleItem { rule: id.clone(), jurisdiction: r.jurisdiction.clone(), enacted_at: r.enacted_at, body: r.rule.clone() })
        .collect()
}

fn agreements(st: &State, scope: Scope, mine: &BTreeSet<Id>, juris: &BTreeSet<Id>) -> Vec<AgreementItem> {
    st.agreements
        .iter()
        .filter(|(_, a)| {
            let own = a.terms.parties().iter().any(|p| mine.contains(*p));
            match scope {
                Scope::All => true,
                Scope::Own => own,
                Scope::Jurisdiction => own || matches!(&a.terms, AgreementTerms::Lease { parcel, .. } if juris.contains(parcel)),
            }
        })
        .map(|(id, a)| AgreementItem {
            agreement: id.clone(),
            status: a.status,
            terms: a.terms.clone(),
            next_payment_at: a.next_payment_at,
            ends_at: a.ends_at,
        })
        .collect()
}

fn directory(s: &Statics, st: &State, scope: Scope, mine: &BTreeSet<Id>) -> ChannelData {
    let own = scope == Scope::Own;
    let seats = s
        .seats
        .values()
        .filter(|x| !own || mine.contains(&x.principal))
        .map(|x| SeatItem { seat: x.id.clone(), title: x.title.clone(), principal: x.principal.clone(), status: st.seats[&x.id].status })
        .collect();
    let entities = st
        .entities
        .iter()
        .filter(|(id, e)| e.active && (!own || mine.contains(*id)))
        .map(|(id, e)| EntityItem {
            entity: id.clone(),
            kind: serde_json::to_value(e.kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default(),
            name: e.name.clone(),
        })
        .collect();
    ChannelData::Directory { seats, entities }
}
