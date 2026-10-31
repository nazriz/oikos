//! Travel (world-expansion 6.3, 6.4): moving a body from one structure to another takes the time of the quickest path
//! over the cells between, each cell costing what its cover says (a road quicker, water slower) or the world's default.
//! Physics only: where anyone goes, and why, is theirs.

use crate::state::{CellCosts, State};
use crate::statics::Statics;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::sync::Arc;

/// How far around the two ends a path may wander (cells).
const MARGIN: i64 = 8;

/// Seconds to go from one structure to another (none if the world has no travel, or it's the same place): on foot, or by
/// a vehicle at `speed` km/h (law 9: along the world's ways, foundations-2 S2).
pub fn seconds(s: &Statics, st: &State, from: &str, to: &str, speed: Option<i64>) -> i64 {
    let Some(travel) = s.config.catalogue.travel.as_ref() else { return 0 };
    if from == to {
        return 0;
    }
    // (The same trip over unchanged ground takes the same time: worked out once. OIKOS_CHECK_TRAVEL checks it.)
    let key = speed.unwrap_or(0);
    if let Some(secs) = st.ground.get(from, to, key) {
        if std::env::var_os("OIKOS_CHECK_TRAVEL").is_some() {
            assert_eq!(secs, path(s, st, travel, from, to, speed), "travel cache stale for {from} -> {to}");
        }
        return secs;
    }
    let secs = path(s, st, travel, from, to, speed);
    st.ground.put(from, to, key, secs);
    secs
}

/// What entering each cell costs, by its cover (a road quicker, water slower) or the world's default: worked out for
/// the whole ground once, and again when the ground changes (a path asks it of every cell it might cross).
fn costs(s: &Statics, st: &State, travel: &oikos_contracts::config::TravelCfg) -> Arc<CellCosts> {
    if let Ok(kept) = st.ground.costs.lock() {
        if let Some((_, costs)) = kept.as_ref().filter(|(epoch, _)| *epoch == st.ground.epoch) {
            return costs.clone();
        }
    }
    // (A path finds a cell by the id its place has: a cell is where its id says, whatever else it says.)
    let placed = |id: &str| crate::config::cell_xy(id).filter(|(x, y)| crate::config::cell_id(*x, *y) == id);
    let (mut x0, mut y0, mut x1, mut y1) = (i64::MAX, i64::MAX, i64::MIN, i64::MIN);
    for (x, y) in st.cells.keys().filter_map(|id| placed(id)) {
        (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
    }
    let mut costs = CellCosts::default();
    if x0 <= x1 && y0 <= y1 {
        costs = CellCosts { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, seconds: vec![None; ((x1 - x0 + 1) * (y1 - y0 + 1)) as usize] };
        for (id, c) in st.cells.iter() {
            let Some((x, y)) = placed(id) else { continue };
            let building = c.structure.as_ref().and_then(|x| st.structures.get(x));
            let cover = oikos_nature::cover_of(&s.config.catalogue, c.terrain.as_deref(), building.map(|b| s.types.get(b.structure_type.as_str()).and_then(|t| t.cover.as_deref())));
            costs.seconds[((y - y0) * costs.w + (x - x0)) as usize] = Some(*travel.by_cover.get(&cover).unwrap_or(&travel.seconds_per_cell));
        }
    }
    let costs = Arc::new(costs);
    if let Ok(mut kept) = st.ground.costs.lock() {
        *kept = Some((st.ground.epoch, costs.clone()));
    }
    costs
}

/// Seconds to go from one cell to another on foot (none if the world has no travel, or it's the same cell): the way to a
/// place that may have no building on it (going to look at a lot). Worked out each time: such trips are few.
pub fn between(s: &Statics, st: &State, from: (i64, i64), to: (i64, i64)) -> i64 {
    let Some(travel) = s.config.catalogue.travel.as_ref() else { return 0 };
    if from == to {
        return 0;
    }
    trip_cells(s, st, travel, from, to, None)
}

/// The quickest trip's time, worked out.
fn path(s: &Statics, st: &State, travel: &oikos_contracts::config::TravelCfg, from: &str, to: &str, speed: Option<i64>) -> i64 {
    let (Some(a), Some(b)) = (st.structures.get(from), st.structures.get(to)) else { return 0 };
    let (Some(a), Some(b)) = (crate::config::cell_xy(&a.at), crate::config::cell_xy(&b.at)) else { return 0 };
    trip_cells(s, st, travel, a, b, speed)
}

/// The quickest trip between two cells: on foot over the cells all the way, or on foot to the nearest node of the world's
/// ways, along them (driven at `speed`, or on foot), and on foot from the node nearest where it is going (law 9).
fn trip_cells(s: &Statics, st: &State, travel: &oikos_contracts::config::TravelCfg, a: (i64, i64), b: (i64, i64), speed: Option<i64>) -> i64 {
    let walk = path_cells(s, st, travel, a, b);
    let w = crate::ways::ways(s, st);
    let (Some(e), Some(x)) = (w.nearest(a), w.nearest(b)) else { return walk };
    let Some(net) = crate::ways::tree_cached(s, st, &w, e, speed)[x as usize] else { return walk };
    let total = path_cells(s, st, travel, a, w.nodes[e as usize]).saturating_add(net).saturating_add(path_cells(s, st, travel, w.nodes[x as usize], b));
    walk.min(total)
}

/// The quickest path's time between two cells.
fn path_cells(s: &Statics, st: &State, travel: &oikos_contracts::config::TravelCfg, (ax, ay): (i64, i64), (bx, by): (i64, i64)) -> i64 {
    let costs = costs(s, st, travel);
    let (x0, x1, y0, y1) = (ax.min(bx) - MARGIN, ax.max(bx) + MARGIN, ay.min(by) - MARGIN, ay.max(by) + MARGIN);
    // Dijkstra: the cost of a path is what entering each cell on it takes. (The best found so far, for each cell of
    // the rectangle the path may wander in.)
    let w = x1 - x0 + 1;
    let slot = |x: i64, y: i64| ((y - y0) * w + (x - x0)) as usize;
    let mut best: Vec<Option<i64>> = vec![None; (w * (y1 - y0 + 1)) as usize];
    let mut heap = BinaryHeap::new();
    best[slot(ax, ay)] = Some(0);
    heap.push(Reverse((0i64, ax, ay)));
    while let Some(Reverse((d, x, y))) = heap.pop() {
        if (x, y) == (bx, by) {
            return d;
        }
        if best[slot(x, y)].is_some_and(|b| b < d) {
            continue;
        }
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x + dx, y + dy);
            if nx < x0 || nx > x1 || ny < y0 || ny > y1 {
                continue;
            }
            let Some(c) = costs.at(nx, ny) else { continue };
            let nd = d.saturating_add(c.max(0));
            if best[slot(nx, ny)].is_none_or(|b| nd < b) {
                best[slot(nx, ny)] = Some(nd);
                heap.push(Reverse((nd, nx, ny)));
            }
        }
    }
    // (No path within reach: as the crow flies, at the default.)
    ((ax - bx).abs() + (ay - by).abs()) * travel.seconds_per_cell
}
