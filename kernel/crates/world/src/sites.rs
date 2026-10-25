//! What is at a place, as someone there sees it; and going to look (docs/design/knowing.md, section 8). A map of
//! anywhere but where a seat is exists only as a visit: a look that takes the looker's time (the way there and back,
//! and the time to look), and returns what is at the places gone to, as they are when the looker is there.

use crate::blocks::Id;
use crate::events::{EventBody, Timed};
use crate::state::{Sched, State};
use crate::statics::Statics;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;

/// A cell of ground, and the building standing on it (repeated on every cell of its footprint).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteCell {
    pub cell: Id,
    pub x: i64,
    pub y: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terrain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// (One building's is shared by the cells it stands on: built once for a look, not once for each cell.)
    pub structure: Option<Arc<SiteStructure>>,
    /// Nature: conspicuous species anyone there would notice (never how many).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub seen: Vec<Id>,
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
    /// Being brought down (phase B).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coming_down: Option<bool>,
    /// Its state variables (phase B): wear, and the like, each as a value as of a day, with its rate now and its
    /// bounds. Seen with its trend, the way wear shows how fast it's coming on: the value on any later day follows
    /// (until something about the building changes, which is then seen afresh). No daily re-sending of every building.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variables: Option<BTreeMap<Id, VariableView>>,
    /// The meters on its premises (foundations-2 C3): each connection's, read on a visit (whoever goes there reads what
    /// the dial shows, as a meter reader does); a meter its operator reads from afar is not on the dial here.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub meters: Vec<MeterView>,
    pub spaces: Vec<SiteSpace>,
}

/// A meter as read on the premises: whose connection, of what, and what it shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeterView {
    pub connection: Id,
    pub kind: Id,
    #[serde(with = "crate::money::amount")]
    pub reading: crate::money::Money,
}

/// The on-site meters at a structure, now.
pub fn meters_at(st: &State, sid: &str) -> Vec<MeterView> {
    let Some(ns) = st.network.as_deref() else { return vec![] };
    ns.index.by_at.get(sid).into_iter().flatten().map(|&i| &ns.connections[i]).filter(|c| c.reading == crate::config::MeterKind::OnSite).map(|c| MeterView { connection: c.id.clone(), kind: c.kind.clone(), reading: c.meter }).collect()
}

/// A state variable as perceived: its value on `as_of_day`, how much it changes each whole day since (at the
/// building's present occupancy), and its bounds. Today's value: value + per_day x (days since), within bounds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VariableView {
    pub value: i64,
    pub as_of_day: i64,
    pub per_day: i64,
    pub min: i64,
    pub max: i64,
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
    /// From outside (where who is there can't be told): when someone was last seen leaving it (moving out, being put
    /// out, going from the world), of its last few departures. Never who; and a death inside is not seen from outside,
    /// so a home that has emptied with nobody seen leaving is one a neighbour may wonder about.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen_leaving: Option<i64>,
    /// From outside: when someone was last seen going into it. Never who. Someone seen going in after anyone was last
    /// seen leaving, in a space with nobody in it now, is someone who has not come out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen_entering: Option<i64>,
}

/// What a visit found: the cells of the places gone to, as they were when the looker was there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Visited {
    /// The channel it was asked through (`channel`, or `position/channel`).
    pub channel: Id,
    pub as_of: i64,
    pub cells: Vec<SiteCell>,
}

/// A cell as someone there sees it. `names`: who is in each space of its building, and who last left (known in one's
/// own building, and to whoever goes in); otherwise how many.
pub fn site_cell(s: &Statics, st: &State, id: &Id, c: &crate::state::Cell, me: &str, names: bool, shown: &mut Shown) -> SiteCell {
    SiteCell {
        cell: id.clone(),
        x: c.x,
        y: c.y,
        terrain: c.terrain.clone(),
        seen: st.nature.as_deref().map_or(vec![], |n| {
            s.config.catalogue.species.iter().filter(|sp| sp.conspicuous && n.populations.get(&sp.id).is_some_and(|m| m.get(id).is_some_and(|x| *x > 0))).map(|sp| sp.id.clone()).collect()
        }),
        structure: c.structure.as_ref().map(|sid| {
            if let Some((_, structure)) = shown.iter().rev().find(|(shown, _)| shown == sid) {
                return structure.clone();
            }
            let structure = seen_structure(s, st, sid, me, names);
            shown.push((sid.clone(), structure.clone()));
            structure
        }),
    }
}

/// What a building as seen is made from (`site_structure`): the building, who is in it, each space's departures and
/// when someone last went in, and whether the looker can be told who (`known`). Compared cheaply: the building field
/// for field (a few ids and numbers), the rest by where they are in memory (the state's own, never changed in place:
/// a change makes a new one) or as the numbers they are.
struct MadeFrom {
    /// The world's config (its building types and their variables), held: two worlds in one process (tests side by
    /// side, a host's arms) may have a building of the same name, empty in both, and must not share its view.
    config: Arc<crate::config::Config>,
    structure: crate::state::Structure,
    occupancy: Option<Arc<BTreeMap<Id, std::collections::BTreeSet<Id>>>>,
    departures: Vec<Option<Arc<Vec<crate::state::Departure>>>>,
    entered: Vec<Option<i64>>,
}

impl MadeFrom {
    fn of(s: &Statics, st: &State, sid: &Id, x: &crate::state::Structure, spaces: &BTreeMap<String, crate::config::SpaceSpec>) -> MadeFrom {
        let space = |local: &String| format!("{sid}/{local}");
        MadeFrom {
            config: s.config.clone(),
            structure: x.clone(),
            occupancy: st.occupancy.get(sid).cloned(),
            departures: spaces.keys().map(|l| st.departures.get(&space(l)).cloned()).collect(),
            entered: spaces.keys().map(|l| st.entered.get(&space(l)).copied()).collect(),
        }
    }

    fn same(&self, s: &Statics, st: &State, sid: &Id, x: &crate::state::Structure, spaces: &BTreeMap<String, crate::config::SpaceSpec>) -> bool {
        fn ptr<T>(a: &Option<Arc<T>>, b: Option<&Arc<T>>) -> bool {
            match (a, b) {
                (None, None) => true,
                (Some(a), Some(b)) => Arc::ptr_eq(a, b),
                _ => false,
            }
        }
        Arc::ptr_eq(&self.config, &s.config)
            && self.structure == *x
            && ptr(&self.occupancy, st.occupancy.get(sid))
            && self.departures.len() == spaces.len()
            && spaces.keys().zip(&self.departures).zip(&self.entered).all(|((l, d), e)| {
                let space = format!("{sid}/{l}");
                ptr(d, st.departures.get(&space)) && *e == st.entered.get(&space).copied()
            })
    }
}

/// The buildings as last seen, by building and by whether the looker could be told who is in it: what each was made
/// from, and the building as seen, while anyone holds it. In shards (looks are made on many threads at once).
type Seen = BTreeMap<(Id, bool), Arc<(MadeFrom, std::sync::Weak<SiteStructure>)>>;
const SHARDS: usize = 64;
static SEEN: [std::sync::RwLock<Option<Seen>>; SHARDS] = [const { std::sync::RwLock::new(None) }; SHARDS];

/// A building as someone there sees it, held once for everyone who sees it the same: made again only when what it is
/// made from has changed (SC-1: every look made its own and each person kept theirs; at 50,000 people, where one
/// building's occupants are many and each is shown them all, 20 GB). It is never changed once made, so sharing it
/// changes nothing anyone sees.
pub fn seen_structure(s: &Statics, st: &State, sid: &Id, me: &str, names: bool) -> Arc<SiteStructure> {
    let x = &st.structures[sid];
    let spaces = &s.spaces[&x.structure_type];
    let occ = st.occupancy.get(sid);
    let known = names || occ.is_some_and(|m| m.values().any(|b| b.contains(me)));
    let shard = &SEEN[sid.bytes().fold(0usize, |h, b| h.wrapping_mul(31).wrapping_add(b as usize)) % SHARDS];
    let key = (sid.clone(), known);
    // (Looked up under a shared lock and compared outside it: the people of one building look at once, on many threads.)
    let entry = shard.read().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(&key).cloned());
    if let Some(entry) = entry {
        let (made, held) = &*entry;
        if let Some(h) = held.upgrade().filter(|_| made.same(s, st, sid, x, spaces)) {
            debug_assert!(*h == site_structure(s, st, sid, me, names), "a building as seen, kept, is not as it would be made now: {sid}");
            return h;
        }
    }
    let h = Arc::new(site_structure(s, st, sid, me, names));
    let made = MadeFrom::of(s, st, sid, x, spaces);
    shard.write().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(BTreeMap::new).insert(key, Arc::new((made, Arc::downgrade(&h))));
    h
}

/// The buildings one look has shown so far, each as it shows it (the same for every cell a building stands on).
pub type Shown = Vec<(Id, Arc<SiteStructure>)>;

/// A building as someone there sees it (`names` as for a cell). The building must stand.
pub fn site_structure(s: &Statics, st: &State, sid: &Id, me: &str, names: bool) -> SiteStructure {
    {
        {
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
                coming_down: x.demolition.is_some().then_some(true),
                meters: vec![],
                variables: {
                    let occupants = occ.map_or(0, |m| m.values().map(|b| b.len()).sum::<usize>()) as i64;
                    let v: BTreeMap<Id, VariableView> = s
                        .config
                        .catalogue
                        .variables
                        .iter()
                        .filter_map(|c| {
                            let (value, as_of_day) = *x.variables.get(&c.id)?;
                            let per_day = c.per_day.saturating_add(c.per_occupant_per_day.saturating_mul(occupants));
                            Some((c.id.clone(), VariableView { value, as_of_day, per_day, min: c.min, max: c.max }))
                        })
                        .collect();
                    (!v.is_empty()).then_some(v)
                },
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
                            left: known.then(|| st.departures.get(&space).map(|l| (**l).clone())).flatten(),
                            seen_leaving: if known { None } else { st.departures.get(&space).and_then(|l| l.iter().filter(|d| d.reason != crate::events::VacateReason::Died).map(|d| d.at).max()) },
                            seen_entering: if known { None } else { st.entered.get(&space).copied() },
                            space,
                        }
                    })
                    .collect(),
            }
        }
    }
}

/// The cells a place named in a visit covers now: a building's footprint, or the one cell. None: no such place.
pub fn place_cells(st: &State, place: &str) -> Option<Vec<Id>> {
    if let Some(x) = st.structures.get(place) {
        return Some(x.cells.clone());
    }
    st.cells.contains_key(place).then(|| vec![place.to_string()])
}

/// Where a visit sets out from and comes back to: a person from the building they are in; an office from its premises
/// (the first cell its channels name); either, having neither, from the nearest edge of the ground to where they go.
fn base(st: &State, person: Option<&str>, channels: &[crate::config::Channel]) -> Option<(i64, i64)> {
    if let Some(p) = person {
        return st.structures_of(p).first().and_then(|sid| st.structures.get(sid)).and_then(|x| crate::config::cell_xy(&x.at));
    }
    channels
        .iter()
        .find_map(|ch| match &ch.kind {
            crate::config::ChannelKind::Records { area: Some(crate::config::Area::Premises(p)), .. } | crate::config::ChannelKind::Sites { area: Some(crate::config::Area::Premises(p)), .. } => p.premises.first().cloned(),
            _ => None,
        })
        .and_then(|c| crate::config::cell_xy(&c))
}

/// How long a visit takes: the way from the base to each place in the order named and back, and the world's time to
/// look at each. With no base in the world, the way in from the nearest edge to the first place and out from the last.
pub fn visit_seconds(s: &Statics, st: &State, person: Option<&str>, channels: &[crate::config::Channel], cells: &[Vec<Id>], look_seconds: Option<i64>) -> i64 {
    let look = look_seconds.or(s.config.knowing.visit_seconds).unwrap_or(0).max(0);
    let stops: Vec<(i64, i64)> = cells.iter().filter_map(|cs| cs.first()).filter_map(|c| crate::config::cell_xy(c)).collect();
    let mut seconds = look.saturating_mul(cells.len() as i64);
    let g = &s.config.world.ground;
    let per_cell = s.config.catalogue.travel.as_ref().map_or(0, |t| t.seconds_per_cell);
    let edge = |(x, y): (i64, i64)| x.min(y).min(g.w - 1 - x).min(g.h - 1 - y).max(0).saturating_mul(per_cell);
    let from = base(st, person, channels);
    let mut at = from;
    for stop in &stops {
        seconds = seconds.saturating_add(match at {
            Some(a) => crate::travel::between(s, st, a, *stop),
            None => edge(*stop),
        });
        at = Some(*stop);
    }
    if let Some(last) = stops.last() {
        seconds = seconds.saturating_add(match from {
            Some(b) => crate::travel::between(s, st, *last, b),
            None => edge(*last),
        });
    }
    seconds.max(1)
}

/// A visit begun (the world's `Look` with `visit`): its looker is busy with it, on its own timeline, for the time
/// it takes, and sees what is there when it ends. `key`: the capacity looking (`self` or a position); `path`: the
/// channel as the looker names it.
#[allow(clippy::too_many_arguments)]
pub fn begin(s: &Statics, st: &mut State, participant: &str, key: &str, path: &str, channels: &[crate::config::Channel], places: &[Id], names: bool, look_seconds: Option<i64>) -> Vec<Timed> {
    let t = st.t;
    let p = &st.participants[participant];
    let person = if key == crate::config::SELF { p.person.clone() } else { None };
    let (timeline_key, lanes) = match p.kind {
        crate::config::ParticipantKind::Person => (p.person.clone().unwrap_or_else(|| participant.into()), 1),
        crate::config::ParticipantKind::System => (participant.to_string(), p.def.lanes.unwrap_or(1) as usize),
    };
    let cells: Vec<Vec<Id>> = places.iter().filter_map(|pl| place_cells(st, pl)).collect();
    let seconds = visit_seconds(s, st, person.as_deref(), channels, &cells, look_seconds);
    let mut timeline = st.timelines.get(&timeline_key).cloned().unwrap_or_default();
    let (starts, done) = oikos_time::place_within(&mut timeline.lanes, lanes, t, seconds, crate::kernel::lane_hours(s, st, &timeline_key));
    st.timelines.insert(timeline_key, timeline);
    let position = (key != crate::config::SELF).then(|| key.to_string());
    st.schedule(done, Sched::Visit { participant: participant.into(), position: position.clone(), channel: path.into(), places: places.to_vec(), cells: cells.into_iter().flatten().collect(), names });
    vec![Timed::new(t, EventBody::VisitStarted { participant: participant.into(), position, channel: path.into(), places: places.to_vec(), starts, done })]
}

/// A visit ended: what is at the cells gone to, now, kept for the looker's next observation.
#[allow(clippy::too_many_arguments)]
pub fn end(s: &Statics, st: &mut State, participant: &str, position: Option<&str>, channel: &str, places: Vec<Id>, cells: &[Id], names: bool) -> Vec<Timed> {
    let t = st.t;
    let Some(p) = st.participants.get(participant) else { return vec![] };
    // (As whom they see: a person as themselves; an office as its organisation.)
    let me = match position {
        None => p.person.clone().unwrap_or_default(),
        Some(pos) => st.positions.get(pos).map(|x| x.entity.clone()).unwrap_or_default(),
    };
    let mut seen: Vec<Id> = cells.iter().filter(|c| st.cells.contains_key(*c)).cloned().collect();
    seen.sort();
    seen.dedup();
    let mut shown: Shown = vec![];
    let mut found = Visited { channel: channel.into(), as_of: t, cells: seen.iter().map(|c| site_cell(s, st, c, &st.cells[c], &me, names, &mut shown)).collect() };
    // (Meters are read where one goes, as they stand when one is there: only on a visit, never by passing.)
    if st.network.is_some() {
        let mut read: BTreeMap<Id, Arc<SiteStructure>> = BTreeMap::new();
        for cell in found.cells.iter_mut() {
            if let Some(x) = cell.structure.as_ref() {
                let with = read.entry(x.structure.clone()).or_insert_with(|| {
                    let meters = meters_at(st, &x.structure);
                    if meters.is_empty() {
                        x.clone()
                    } else {
                        Arc::new(SiteStructure { meters, ..(**x).clone() })
                    }
                });
                cell.structure = Some(with.clone());
            }
        }
    }
    let key = position.map_or_else(|| crate::config::SELF.to_string(), String::from);
    std::sync::Arc::make_mut(st.participants.get_mut(participant).unwrap()).pending.entry(key).or_default().visits.push(found);
    vec![Timed::new(t, EventBody::Visited { participant: participant.into(), position: position.map(String::from), channel: channel.into(), places })]
}
