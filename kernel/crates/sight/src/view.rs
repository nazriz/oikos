//! An actor's picture of the world, kept up to date from its observations (participants/src/view.ts, ported).
//!
//! Perception is changes, not snapshots (contracts v0.3): each look through a channel delivers only what changed in its
//! scope since the last look through it. The view applies those changes, so an actor reads accounts, holdings, sites
//! and the directory as their whole current picture, and records as what is new (or, for a channel it keeps whole,
//! everything). The kernel's perception invariant (kernel/tests/perception.rs) holds that a view built this way equals
//! the full picture.
//!
//! The engine keeps one view per unit and slices the observation to the unit's capacity first (a position's channels
//! are `<position>/<channel>` in the observation and `<channel>` in the picture), as participants/src/contracts.ts's
//! `slice` did.

use oikos_perception::{
    AccountItem, BodyView, ChannelData, ConnectionItem, EntityItem, HeldPosition, HoldingItem, LinkItem, Observation, OwnRecord, PositionItem, SiteCell,
};
use oikos_world::blocks::{Id, Record};
use oikos_world::state::{Message, Outcome, ParticipantStatus, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// What a visit found (a map whose way is `visit`): when each cell was last seen, and the cells this observation's visit saw.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Visit {
    pub seen_at: BTreeMap<Id, i64>,
    pub fresh: Vec<Id>,
}

/// One channel as the actor reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Seen {
    /// Its accounts in full (by id), and the transactions new since the last look.
    Accounts { accounts: Arc<Vec<AccountItem>>, transactions: Vec<Transaction> },
    /// What it holds where, in full (a holding gone to nothing drops out); what flows to it, and for an operator its
    /// network (foundations-2 C3), whole as last seen.
    Holdings { holdings: Arc<Vec<HoldingItem>>, connections: Arc<Vec<ConnectionItem>>, links: Arc<Vec<LinkItem>> },
    /// Its own record, when it changed.
    OwnRecord { record: Option<OwnRecord> },
    /// What is new (or a search's results, or everything for a channel kept whole).
    Records { records: Vec<Arc<Record>>, search: bool },
    /// The surroundings in full, and what a visit found.
    Sites { as_of: i64, cells: Arc<Vec<SiteCell>>, visit: Option<Visit> },
    /// Whom it has looked up, in full.
    Directory { entities: Arc<Vec<EntityItem>>, positions: Arc<Vec<PositionItem>> },
}

/// What an actor reads at a wake: the observation, its channels as their current picture, and why it woke.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Picture {
    pub participant: Id,
    pub t: i64,
    pub status: ParticipantStatus,
    /// Whom it acts for in this capacity (the person, or the position's organisation).
    pub entity: Id,
    /// The position it acts in (absent: as itself).
    pub as_position: Option<Id>,
    pub body: Option<BodyView>,
    pub positions: Vec<HeldPosition>,
    pub outcomes: Vec<Outcome>,
    pub inbox: Vec<Message>,
    pub channels: BTreeMap<Id, Seen>,
    pub asking: Vec<Id>,
    pub readings: BTreeMap<Id, oikos_terms::Reading>,
    /// Why it woke (cadence, news, asked, done, start) and how long since its last wake (contracts 0.7).
    pub woke_for: String,
    pub since: i64,
}

impl Picture {
    /// The records of a channel (empty if it is not a records channel or has none).
    pub fn records(&self, channel: &str) -> &[Arc<Record>] {
        match self.channels.get(channel) {
            Some(Seen::Records { records, .. }) => records,
            _ => &[],
        }
    }
    /// Every record of every records channel, in channel order (participants/src/contracts.ts `channels.records`).
    pub fn all_records(&self) -> impl Iterator<Item = &Arc<Record>> {
        self.channels.values().flat_map(|c| match c {
            Seen::Records { records, .. } => records.as_slice(),
            _ => &[],
        })
    }
    /// Every account of every accounts channel.
    pub fn accounts(&self) -> impl Iterator<Item = &AccountItem> {
        self.channels.values().flat_map(|c| match c {
            Seen::Accounts { accounts, .. } => accounts.as_slice(),
            _ => &[],
        })
    }
    /// Every transaction new in this observation.
    pub fn transactions(&self) -> impl Iterator<Item = &Transaction> {
        self.channels.values().flat_map(|c| match c {
            Seen::Accounts { transactions, .. } => transactions.as_slice(),
            _ => &[],
        })
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct SitesKept {
    as_of: i64,
    cells: BTreeMap<Id, SiteCell>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct DirectoryKept {
    entities: BTreeMap<Id, EntityItem>,
    positions: BTreeMap<Id, PositionItem>,
}

/// One unit's view. `full`: channels whose every record the actor always sees (standing documents). Serialisable:
/// a snapshot of a run keeps every unit's view (docs/port-guide.md, "Snapshots").
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct View {
    full: BTreeSet<Id>,
    accounts: BTreeMap<Id, BTreeMap<Id, AccountItem>>,
    holdings: BTreeMap<Id, BTreeMap<String, HoldingItem>>,
    /// What flows, each holdings channel's as last delivered (whole at every look).
    #[serde(default)]
    flows: BTreeMap<Id, (Arc<Vec<ConnectionItem>>, Arc<Vec<LinkItem>>)>,
    sites: BTreeMap<Id, SitesKept>,
    visits: BTreeMap<Id, Visit>,
    directories: BTreeMap<Id, DirectoryKept>,
    /// Records of a channel kept whole, in the order first seen (a record seen again keeps its place, as a JS Map does).
    kept: BTreeMap<Id, (Vec<Arc<Record>>, BTreeMap<Id, usize>)>,
    /// Each channel's picture as last made, rebuilt only when the channel changed.
    cache_accounts: BTreeMap<Id, Arc<Vec<AccountItem>>>,
    cache_holdings: BTreeMap<Id, Arc<Vec<HoldingItem>>>,
    cache_sites: BTreeMap<Id, Arc<Vec<SiteCell>>>,
    cache_directories: BTreeMap<Id, (Arc<Vec<EntityItem>>, Arc<Vec<PositionItem>>)>,
}

/// The channels of a capacity: a person's own (`self`: those without a `/`), or a position's, its prefix taken off.
fn in_capacity<'a>(id: &'a str, capacity: Option<&str>) -> Option<&'a str> {
    match capacity {
        None | Some("self") => (!id.contains('/')).then_some(id),
        Some(p) => id.strip_prefix(p).and_then(|r| r.strip_prefix('/')),
    }
}

impl View {
    pub fn new(full: BTreeSet<Id>) -> Self {
        View { full, ..Default::default() }
    }

    /// Takes in an observation for one capacity (`None` or "self": the participant's own; a position's id) and
    /// returns the picture the actor reads. `entity`: whom it acts for in that capacity.
    pub fn apply(&mut self, obs: Observation, capacity: Option<&str>, entity: &str, woke_for: &str, since: i64) -> Picture {
        let mut channels: BTreeMap<Id, Seen> = BTreeMap::new();
        let mut new_txs: BTreeMap<Id, Vec<Transaction>> = BTreeMap::new();
        let mut fresh_sites: BTreeSet<Id> = BTreeSet::new();
        for (full_id, ch) in obs.channels {
            let Some(id) = in_capacity(&full_id, capacity) else { continue };
            let id = id.to_string();
            match ch {
                ChannelData::Accounts { accounts, transactions } => {
                    let m = self.accounts.entry(id.clone()).or_default();
                    if !accounts.is_empty() {
                        self.cache_accounts.remove(&id);
                    }
                    for a in accounts {
                        if a.closed == Some(true) {
                            m.remove(&a.account);
                        } else {
                            m.insert(a.account.clone(), a);
                        }
                    }
                    new_txs.insert(id, transactions);
                }
                ChannelData::Holdings { holdings, connections, links } => {
                    if !connections.is_empty() || !links.is_empty() || self.flows.contains_key(&id) {
                        self.flows.insert(id.clone(), (Arc::new(connections), Arc::new(links)));
                    }
                    let m = self.holdings.entry(id.clone()).or_default();
                    if !holdings.is_empty() {
                        self.cache_holdings.remove(&id);
                    }
                    for h in holdings {
                        let k = format!("{}|{}", h.at, h.kind);
                        if h.quantity == 0 {
                            m.remove(&k);
                        } else {
                            m.insert(k, h);
                        }
                    }
                }
                ChannelData::Sites { as_of, cells, whole, visited } => {
                    let changed = !cells.is_empty() || whole == Some(true);
                    let v = self.sites.entry(id.clone()).or_default();
                    if whole == Some(true) {
                        v.cells.clear();
                    }
                    v.as_of = as_of;
                    if visited == Some(true) {
                        let m = self.visits.entry(id.clone()).or_default();
                        for c in &cells {
                            m.seen_at.insert(c.cell.clone(), as_of);
                        }
                        m.fresh = cells.iter().map(|c| c.cell.clone()).collect();
                    }
                    for c in cells {
                        v.cells.insert(c.cell.clone(), c);
                    }
                    if changed {
                        self.cache_sites.remove(&id);
                    }
                    fresh_sites.insert(id);
                }
                ChannelData::Directory { entities, positions } => {
                    let v = self.directories.entry(id.clone()).or_default();
                    if !entities.is_empty() || !positions.is_empty() {
                        self.cache_directories.remove(&id);
                    }
                    for e in entities {
                        v.entities.insert(e.entity.clone(), e);
                    }
                    for p in positions {
                        v.positions.insert(p.position.clone(), p);
                    }
                }
                ChannelData::OwnRecord { record } => {
                    channels.insert(id, Seen::OwnRecord { record });
                }
                ChannelData::Records { records, search, whole } => {
                    if search == Some(true) {
                        channels.insert(id, Seen::Records { records, search: true });
                    } else if self.full.contains(&id) {
                        let (list, at) = self.kept.entry(id).or_default();
                        if whole == Some(true) {
                            list.clear();
                            at.clear();
                        }
                        for r in records {
                            match at.get(&r.id) {
                                Some(&i) => list[i] = r,
                                None => {
                                    at.insert(r.id.clone(), list.len());
                                    list.push(r);
                                }
                            }
                        }
                    } else {
                        channels.insert(id, Seen::Records { records, search: false });
                    }
                }
            }
        }
        for (id, m) in &self.accounts {
            let accounts = self.cache_accounts.entry(id.clone()).or_insert_with(|| Arc::new(m.values().cloned().collect())).clone();
            channels.insert(id.clone(), Seen::Accounts { accounts, transactions: new_txs.remove(id).unwrap_or_default() });
        }
        for (id, m) in &self.holdings {
            let holdings = self.cache_holdings.entry(id.clone()).or_insert_with(|| Arc::new(m.values().cloned().collect())).clone();
            let (connections, links) = self.flows.get(id).cloned().unwrap_or_default();
            channels.insert(id.clone(), Seen::Holdings { holdings, connections, links });
        }
        for (id, v) in &self.sites {
            let cells = self.cache_sites.entry(id.clone()).or_insert_with(|| Arc::new(v.cells.values().cloned().collect())).clone();
            // (The cells a visit saw are said once, with the observation that brings them.)
            let visit = self
                .visits
                .get(id)
                .map(|m| Visit { seen_at: m.seen_at.clone(), fresh: if fresh_sites.contains(id) { m.fresh.clone() } else { vec![] } });
            channels.insert(id.clone(), Seen::Sites { as_of: v.as_of, cells, visit });
        }
        for (id, v) in &self.directories {
            let (entities, positions) = self
                .cache_directories
                .entry(id.clone())
                .or_insert_with(|| (Arc::new(v.entities.values().cloned().collect()), Arc::new(v.positions.values().cloned().collect())))
                .clone();
            channels.insert(id.clone(), Seen::Directory { entities, positions });
        }
        for (id, (list, _)) in &self.kept {
            channels.insert(id.clone(), Seen::Records { records: list.clone(), search: false });
        }
        let as_position = match capacity {
            None | Some("self") => None,
            Some(p) => Some(p.to_string()),
        };
        Picture {
            participant: obs.participant,
            t: obs.t,
            status: obs.status,
            entity: entity.to_string(),
            as_position,
            body: obs.body,
            positions: obs.positions,
            outcomes: obs.outcomes,
            inbox: obs.inbox,
            channels,
            asking: obs.asking,
            readings: obs.readings,
            woke_for: woke_for.to_string(),
            since,
        }
    }
}
