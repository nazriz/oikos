//! Travel (world-expansion 6.3, 6.4): moving a body from one structure to another takes the time of the quickest path
//! over the cells between, each cell costing what its cover says (a road quicker, water slower) or the world's default.
//! Physics only: where anyone goes, and why, is theirs.

use crate::state::State;
use crate::statics::Statics;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, BTreeMap};

/// How far around the two ends a path may wander (cells).
const MARGIN: i64 = 8;

/// Seconds to go from one structure to another (none if the world has no travel, or it's the same place).
pub fn seconds(s: &Statics, st: &State, from: &str, to: &str) -> i64 {
    let Some(travel) = s.config.catalogue.travel.as_ref() else { return 0 };
    if from == to {
        return 0;
    }
    // (The same trip over unchanged ground takes the same time: worked out once. OIKOS_CHECK_TRAVEL checks it.)
    if let Some(secs) = st.ground.get(from, to) {
        if std::env::var_os("OIKOS_CHECK_TRAVEL").is_some() {
            assert_eq!(secs, path(s, st, travel, from, to), "travel cache stale for {from} -> {to}");
        }
        return secs;
    }
    let secs = path(s, st, travel, from, to);
    st.ground.put(from, to, secs);
    secs
}

/// The quickest path's time, worked out.
fn path(s: &Statics, st: &State, travel: &oikos_contracts::config::TravelCfg, from: &str, to: &str) -> i64 {
    let (Some(a), Some(b)) = (st.structures.get(from), st.structures.get(to)) else { return 0 };
    let (Some((ax, ay)), Some((bx, by))) = (crate::config::cell_xy(&a.at), crate::config::cell_xy(&b.at)) else { return 0 };
    let cost = |x: i64, y: i64| -> Option<i64> {
        let id = crate::config::cell_id(x, y);
        let c = st.cells.get(&id)?;
        let building = c.structure.as_ref().and_then(|x| st.structures.get(x));
        let cover = oikos_nature::cover_of(&s.config.catalogue, c.terrain.as_deref(), building.map(|b| s.types.get(&b.structure_type).and_then(|t| t.cover.as_deref())));
        Some(*travel.by_cover.get(&cover).unwrap_or(&travel.seconds_per_cell))
    };
    let (x0, x1, y0, y1) = (ax.min(bx) - MARGIN, ax.max(bx) + MARGIN, ay.min(by) - MARGIN, ay.max(by) + MARGIN);
    // Dijkstra: the cost of a path is what entering each cell on it takes.
    let mut best: BTreeMap<(i64, i64), i64> = BTreeMap::new();
    let mut heap = BinaryHeap::new();
    best.insert((ax, ay), 0);
    heap.push(Reverse((0i64, ax, ay)));
    while let Some(Reverse((d, x, y))) = heap.pop() {
        if (x, y) == (bx, by) {
            return d;
        }
        if best.get(&(x, y)).is_some_and(|&b| b < d) {
            continue;
        }
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x + dx, y + dy);
            if nx < x0 || nx > x1 || ny < y0 || ny > y1 {
                continue;
            }
            let Some(c) = cost(nx, ny) else { continue };
            let nd = d.saturating_add(c.max(0));
            if best.get(&(nx, ny)).is_none_or(|&b| nd < b) {
                best.insert((nx, ny), nd);
                heap.push(Reverse((nd, nx, ny)));
            }
        }
    }
    // (No path within reach: as the crow flies, at the default.)
    ((ax - bx).abs() + (ay - by).abs()) * travel.seconds_per_cell
}
