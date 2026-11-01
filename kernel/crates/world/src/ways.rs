//! Ways (law 9, foundations-2 S2; docs/design/foundations-2.md section 3.1): the links bodies and vehicles travel on.
//! A structure whose type is a way (a road, a path) is a node on each of its cells, joined to the next cell's node of the
//! same mode by a link a cell long, with the type's capacity an hour and its speed for vehicles. The world's network may
//! add links for travel (a link with a speed: a road out of the town to an edge, S4; between towns, S6), from a node on a
//! cell (joined to that cell's way node) or at an edge, off the ground. A trip is on foot over the cells to the nearest
//! node, along the links, and on foot from the nearest node to where it is going, or on foot over the cells all the way,
//! whichever is quicker. Physics only: who goes, and by what, is theirs.
//!
//! Derived from the standing structures and the config, as the cells' costs are: worked out once for the ground as it is,
//! again when a way is finished or comes down. Integers only; nodes in the order of their cells (then the config's edge
//! nodes, in its order), so the answer is the same however the structures were made.

use crate::blocks::Id;
use crate::state::State;
use crate::statics::Statics;
use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap};
use std::sync::Arc;

/// A link between two nodes of a way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WayLink {
    pub a: u32,
    pub b: u32,
    pub length_m: i64,
    /// What it carries an hour each way, at most (vehicles).
    pub capacity: i64,
    /// Its speed for vehicles (none: on foot only).
    pub speed_kmh: Option<i64>,
}

/// The ways of the ground as it stands.
#[derive(Debug, Default)]
pub struct Ways {
    /// Each node's cell, in order (by row, then column); none for a node off the ground (at an edge).
    pub nodes: Vec<Option<(i64, i64)>>,
    pub links: Vec<WayLink>,
    /// Each node's links: (the node at the other end, the link).
    pub adj: Vec<Vec<(u32, u32)>>,
    /// The node each edge of the world is reached at (S4: where the outside's goods arrive from and leave for).
    pub edges: BTreeMap<Id, u32>,
}

impl Ways {
    /// The ways of the standing structures, and the network's links for travel.
    pub fn of(s: &Statics, st: &State) -> Ways {
        let mut cells: BTreeMap<(i64, i64), (&str, i64, Option<i64>)> = BTreeMap::new();
        for x in st.structures.values().filter(|x| x.complete) {
            let Some(w) = s.types.get(&x.structure_type).and_then(|t| t.way.as_ref()) else { continue };
            for c in &x.cells {
                if let Some((cx, cy)) = crate::config::cell_xy(c) {
                    cells.insert((cy, cx), (w.mode.as_str(), w.capacity, w.speed_kmh));
                }
            }
        }
        // (The network's travel links: their nodes on cells become the ways' nodes there, those at an edge come after.)
        let net = s.config.world.network.as_ref();
        let travel_links: Vec<&oikos_contracts::network::LinkCfg> = net.map(|n| n.links.iter().filter(|l| l.speed_kmh.is_some()).collect()).unwrap_or_default();
        let node_cfg = |id: &Id| net.and_then(|n| n.nodes.iter().find(|x| x.id == *id));
        let mut extra_cells: Vec<(i64, i64)> = vec![];
        let mut edge_nodes: Vec<Id> = vec![];
        for l in &travel_links {
            for end in [&l.from, &l.to] {
                let Some(n) = node_cfg(end) else { continue };
                match n.cell.as_deref().and_then(crate::config::cell_xy) {
                    Some((x, y)) if !cells.contains_key(&(y, x)) && !extra_cells.contains(&(y, x)) => extra_cells.push((y, x)),
                    Some(_) => {}
                    None if !edge_nodes.contains(&n.id) => edge_nodes.push(n.id),
                    None => {}
                }
            }
        }
        let cell_m = s.config.world.ground.cell.unwrap_or(1).max(1);
        let mut keys: Vec<(i64, i64)> = cells.keys().copied().chain(extra_cells.iter().copied()).collect();
        keys.sort();
        keys.dedup();
        let index: BTreeMap<(i64, i64), u32> = keys.iter().enumerate().map(|(i, k)| (*k, i as u32)).collect();
        let n_nodes = keys.len() + edge_nodes.len();
        let mut w = Ways { nodes: keys.iter().map(|(y, x)| Some((*x, *y))).chain(edge_nodes.iter().map(|_| None)).collect(), links: vec![], adj: vec![vec![]; n_nodes], edges: BTreeMap::new() };
        for ((y, x), (mode, cap, speed)) in &cells {
            let a = index[&(*y, *x)];
            for (ny, nx) in [(*y, x + 1), (y + 1, *x)] {
                let Some((m2, cap2, speed2)) = cells.get(&(ny, nx)) else { continue };
                if m2 != mode {
                    continue;
                }
                let b = index[&(ny, nx)];
                let speed = match (speed, speed2) {
                    (Some(p), Some(q)) => Some(*p.min(q)),
                    _ => None,
                };
                w.join(a, b, WayLink { a, b, length_m: cell_m, capacity: *cap.min(cap2), speed_kmh: speed });
            }
        }
        let node_ix = |w: &Ways, id: &Id| -> Option<u32> {
            let n = node_cfg(id)?;
            match n.cell.as_deref().and_then(crate::config::cell_xy) {
                Some((x, y)) => index.get(&(y, x)).copied(),
                None => edge_nodes.iter().position(|e| e == id).map(|i| (keys.len() + i) as u32).filter(|i| (*i as usize) < w.nodes.len()),
            }
        };
        for l in &travel_links {
            let (Some(a), Some(b)) = (node_ix(&w, &l.from), node_ix(&w, &l.to)) else { continue };
            if a != b {
                w.join(a, b, WayLink { a, b, length_m: l.length_m.unwrap_or(cell_m), capacity: l.capacity, speed_kmh: l.speed_kmh });
            }
        }
        for (i, id) in edge_nodes.iter().enumerate() {
            if let Some(e) = node_cfg(id).and_then(|n| n.edge) {
                w.edges.entry(e).or_insert((keys.len() + i) as u32);
            }
        }
        w
    }

    fn join(&mut self, a: u32, b: u32, link: WayLink) {
        let l = self.links.len() as u32;
        self.links.push(link);
        self.adj[a as usize].push((b, l));
        self.adj[b as usize].push((a, l));
    }

    /// The node on the ground nearest a cell (by cells across and down; the first in order of those as near).
    pub fn nearest(&self, (x, y): (i64, i64)) -> Option<u32> {
        self.nodes.iter().enumerate().filter_map(|(i, c)| c.map(|c| (i, c))).min_by_key(|(_, (nx, ny))| (nx - x).abs() + (ny - y).abs()).map(|(i, _)| i as u32)
    }
}

/// Seconds to cross a link: by a vehicle at `speed` (km/h), at the lower of its speed and the link's (a link with no speed
/// carries no vehicle); on foot (none), at walking pace (the world's seconds a cell, over its cell's metres).
pub fn link_seconds(s: &Statics, l: &WayLink, speed: Option<i64>) -> Option<i64> {
    match speed {
        Some(v) => {
            let v = l.speed_kmh?.min(v).max(1);
            Some((l.length_m * 3_600 + v * 1_000 - 1) / (v * 1_000))
        }
        None => {
            let per_cell = s.config.catalogue.travel.as_ref().map_or(0, |t| t.seconds_per_cell);
            let cell_m = s.config.world.ground.cell.unwrap_or(1).max(1);
            Some((l.length_m * per_cell + cell_m - 1) / cell_m)
        }
    }
}

/// The quickest time from one node to every other, by a vehicle at `speed` or on foot.
pub fn tree(s: &Statics, w: &Ways, from: u32, speed: Option<i64>) -> Vec<Option<i64>> {
    let mut best: Vec<Option<i64>> = vec![None; w.nodes.len()];
    let mut heap = BinaryHeap::new();
    best[from as usize] = Some(0);
    heap.push(Reverse((0i64, from)));
    while let Some(Reverse((d, n))) = heap.pop() {
        if best[n as usize].is_some_and(|b| b < d) {
            continue;
        }
        for (m, l) in &w.adj[n as usize] {
            let Some(c) = link_seconds(s, &w.links[*l as usize], speed) else { continue };
            let nd = d.saturating_add(c);
            if best[*m as usize].is_none_or(|b| nd < b) {
                best[*m as usize] = Some(nd);
                heap.push(Reverse((nd, *m)));
            }
        }
    }
    best
}

/// The ways of the ground as it is now (worked out once an epoch).
pub fn ways(s: &Statics, st: &State) -> Arc<Ways> {
    if let Ok(kept) = st.ground.ways.lock() {
        if let Some((_, w)) = kept.as_ref().filter(|(e, _)| *e == st.ground.epoch) {
            return w.clone();
        }
    }
    let w = Arc::new(Ways::of(s, st));
    if let Ok(mut kept) = st.ground.ways.lock() {
        *kept = Some((st.ground.epoch, w.clone()));
    }
    w
}

/// The quickest times from a node, by a vehicle at `speed` or on foot, worked out once an epoch.
pub fn tree_cached(s: &Statics, st: &State, w: &Ways, from: u32, speed: Option<i64>) -> Arc<Vec<Option<i64>>> {
    let key = (from, speed.unwrap_or(0));
    if let Ok(kept) = st.ground.trees.lock() {
        if let Some((_, t)) = kept.get(&key).filter(|(e, _)| *e == st.ground.epoch) {
            return t.clone();
        }
    }
    let t = Arc::new(tree(s, w, from, speed));
    if let Ok(mut kept) = st.ground.trees.lock() {
        // (Bounded: a tree is as long as the town has nodes, and a long run comes to start from most of them, so the
        // cache grew as the town's nodes squared (152 MB at 10,000 people by day 71: SC-6). Past the bound, the trees of
        // another epoch go first, then all: they are worked out again when wanted, the same.)
        if kept.len() * t.len().max(1) * std::mem::size_of::<Option<i64>>() >= TREES_KEPT_BYTES {
            let epoch = st.ground.epoch;
            let stale: Vec<(u32, i64)> = kept.iter().filter(|(_, (e, _))| *e != epoch).map(|(k, _)| *k).collect();
            for k in stale {
                kept.remove(&k);
            }
            if kept.len() * t.len().max(1) * std::mem::size_of::<Option<i64>>() >= TREES_KEPT_BYTES {
                *kept = Default::default();
            }
        }
        kept.insert(key, (st.ground.epoch, t.clone()));
    }
    t
}

/// How many bytes of quickest-time trees are kept at most (`tree_cached`).
const TREES_KEPT_BYTES: usize = 64 << 20;
