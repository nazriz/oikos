//! Ways (law 9, foundations-2 S2; docs/design/foundations-2.md section 3.1): the links bodies and vehicles travel on.
//! A structure whose type is a way (a road, a path) is a node on each of its cells, joined to the next cell's node of the
//! same mode by a link a cell long, with the type's capacity an hour and its speed for vehicles. A trip is on foot over
//! the cells to the nearest node, along the links, and on foot from the nearest node to where it is going, or on foot
//! over the cells all the way, whichever is quicker. Physics only: who goes, and by what, is theirs.
//!
//! Derived from the standing structures, as the cells' costs are: worked out once for the ground as it is, again when a
//! way is finished or comes down. Integers only; nodes in the order of their cells, so the answer is the same however
//! the structures were made.

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
    /// Each node's cell, in order (by row, then column).
    pub nodes: Vec<(i64, i64)>,
    pub links: Vec<WayLink>,
    /// Each node's links: (the node at the other end, the link).
    pub adj: Vec<Vec<(u32, u32)>>,
}

impl Ways {
    /// The ways of the standing structures.
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
        let cell_m = s.config.world.ground.cell.unwrap_or(1).max(1);
        let index: BTreeMap<(i64, i64), u32> = cells.keys().enumerate().map(|(i, k)| (*k, i as u32)).collect();
        let mut w = Ways { nodes: cells.keys().map(|(y, x)| (*x, *y)).collect(), links: vec![], adj: vec![vec![]; cells.len()] };
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
                let l = w.links.len() as u32;
                w.links.push(WayLink { a, b, length_m: cell_m, capacity: *cap.min(cap2), speed_kmh: speed });
                w.adj[a as usize].push((b, l));
                w.adj[b as usize].push((a, l));
            }
        }
        w
    }

    /// The node nearest a cell (by cells across and down; the first in order of those as near).
    pub fn nearest(&self, (x, y): (i64, i64)) -> Option<u32> {
        self.nodes.iter().enumerate().min_by_key(|(_, (nx, ny))| (nx - x).abs() + (ny - y).abs()).map(|(i, _)| i as u32)
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
        kept.insert(key, (st.ground.epoch, t.clone()));
    }
    t
}
