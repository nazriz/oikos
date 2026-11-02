//! Travel (world-expansion 6.3, 6.4): moving a body from one structure to another takes the time of the quickest path
//! over the cells between, each cell costing what its cover says (a road quicker, water slower) or the world's default.
//! Physics only: where anyone goes, and why, is theirs.

use crate::blocks::{Block, Id};
use crate::state::{CellCosts, State};
use std::collections::BTreeMap;
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
    let Some(net) = crate::ways::tree_cached(s, st, &w, e, speed).best[x as usize] else { return walk };
    let (Some(ea), Some(xb)) = (w.nodes[e as usize], w.nodes[x as usize]) else { return walk };
    let total = path_cells(s, st, travel, a, ea).saturating_add(net).saturating_add(path_cells(s, st, travel, xb, b));
    walk.min(total)
}

/// How long the outside's freight takes between an edge and a structure (law 9, S4): along the ways from the edge's node to
/// the node nearest the structure, at the links' own speeds, and on to its door. None: the world has no node for the edge
/// (its goods arrive at once: the backstop's `edgesWithoutNode` names it), or no way joins them.
pub fn freight_seconds(s: &Statics, st: &State, edge: &str, structure: &str) -> Option<i64> {
    let travel = s.config.catalogue.travel.as_ref()?;
    let w = crate::ways::ways(s, st);
    let e = *w.edges.get(edge)?;
    let to = st.structures.get(structure).and_then(|x| crate::config::cell_xy(&x.at))?;
    let x = w.nearest(to)?;
    let net = crate::ways::tree_cached(s, st, &w, e, Some(i64::from(u16::MAX))).best[x as usize]?;
    Some(net.saturating_add(path_cells(s, st, travel, w.nodes[x as usize]?, to)))
}

/// A body an act takes somewhere (law 9, S3 and S4): where it sets out from, the buildings it goes by in order (where goods
/// are picked up and put down, a building worked on), where it ends (a building it goes into, or back where it set out),
/// the vehicle it drives, and the trip's seconds, leg by leg.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Journey {
    pub body: Id,
    pub from: Id,
    pub via: Vec<Id>,
    pub to: Id,
    pub vehicle: Option<Id>,
    pub seconds: i64,
    /// Driven (S5): the way links it goes along (each carries one more vehicle this hour), the metres, and the fuel.
    pub links: Vec<Id>,
    pub metres: i64,
    pub fuel: Option<(Id, crate::money::Money)>,
}

/// A driven leg between two buildings (S5): its seconds this hour (each link's free time raised by the vehicles on it
/// against its capacity, and an hour's wait at a link already at capacity), the links it goes along and their metres; on
/// foot all the way where that is quicker (then no links).
pub fn driven_leg(s: &Statics, st: &State, from: &str, to: &str, speed: i64, extra: &BTreeMap<Id, u32>) -> (i64, Vec<Id>, i64) {
    let Some(travel) = s.config.catalogue.travel.as_ref() else { return (0, vec![], 0) };
    let (Some(a), Some(b)) = (st.structures.get(from).and_then(|x| crate::config::cell_xy(&x.at)), st.structures.get(to).and_then(|x| crate::config::cell_xy(&x.at))) else { return (0, vec![], 0) };
    if a == b {
        return (0, vec![], 0);
    }
    let walk = path_cells(s, st, travel, a, b);
    let w = crate::ways::ways(s, st);
    let (Some(e), Some(x)) = (w.nearest(a), w.nearest(b)) else { return (walk, vec![], 0) };
    let tree = crate::ways::tree_cached(s, st, &w, e, Some(speed));
    if tree[x as usize].is_none() {
        return (walk, vec![], 0);
    }
    let (Some(ea), Some(xb)) = (w.nodes[e as usize], w.nodes[x as usize]) else { return (walk, vec![], 0) };
    let route = tree.route(&w, x);
    let hour = st.t.div_euclid(3_600);
    let mut net: i64 = 0;
    let mut waited = false;
    // (Each link each way: its key and the way it is gone along, `>` from its first node, `<` back.)
    let mut keys: Vec<Id> = vec![];
    let mut node = e;
    for l in &route {
        let link = &w.links[*l as usize];
        let (dir, next) = if link.a == node { ('>', link.b) } else { ('<', link.a) };
        node = next;
        let key = Id::new(&format!("{}{dir}", link.key));
        keys.push(key);
        let free = crate::ways::link_seconds(s, link, Some(speed)).unwrap_or(0);
        let on = st.flows.get(&key).filter(|(h, _)| *h == hour).map_or(0, |(_, n)| *n) as i64 + *extra.get(&key).unwrap_or(&0) as i64;
        let cap = link.capacity.max(1);
        let mut secs = free;
        if let Some(c) = travel.congestion {
            // (Free time times 1 + alpha (on / capacity)^beta, in integers.)
            let ratio_pow = (on as i128).pow(c.beta) * 1_000_000 / (cap as i128).pow(c.beta).max(1);
            secs = free + ((free as i128) * (c.alpha_bps as i128) * ratio_pow / (10_000 * 1_000_000)) as i64;
            if on >= cap && !waited {
                // (Full this hour: the vehicle goes on it in the next.)
                secs += 3_600 - st.t.rem_euclid(3_600);
                waited = true;
            }
        }
        net = net.saturating_add(secs);
    }
    let total = path_cells(s, st, travel, a, ea).saturating_add(net).saturating_add(path_cells(s, st, travel, xb, b));
    if walk <= total {
        return (walk, vec![], 0);
    }
    let metres = route.iter().map(|l| w.links[*l as usize].length_m).sum();
    (total, keys, metres)
}

/// The journeys an act's blocks make (literal ids only: a body or a place made in the act itself is going nowhere yet). An
/// `occupy` takes its body into a building; a `move_goods` between two buildings takes its carrier by where the goods are
/// and where they go; a `work` on a building other than where it is done takes each performer there. A body goes by its
/// stops in the blocks' order and ends in the building it goes into, or back where it set out.
pub fn journeys(s: &Statics, st: &State, actor_body: Option<Id>, blocks: &[Block]) -> Vec<Journey> {
    // (The vehicles this act's own journeys put on each link, counted as they are planned.)
    let extra = &mut BTreeMap::<Id, u32>::new();
    let lit = |x: &str| !x.starts_with('$');
    let mut order: Vec<Id> = vec![];
    let mut legs: BTreeMap<Id, (Vec<Id>, Option<Id>, Option<Id>)> = BTreeMap::new();
    let touch = |order: &mut Vec<Id>, b: Id| {
        if !order.contains(&b) {
            order.push(b);
        }
    };
    for b in blocks {
        match b {
            Block::Occupy { space, who, vehicle } if lit(space) && !who.as_deref().is_some_and(|w| w.starts_with('$')) => {
                let Some(body) = who.as_deref().map(Id::new).or(actor_body) else { continue };
                let Some((to, _)) = crate::config::split_space(space) else { continue };
                touch(&mut order, body);
                let e = legs.entry(body).or_default();
                e.1 = Some(Id::new(to));
                if let Some(v) = vehicle.as_deref().filter(|v| lit(v)) {
                    e.2 = Some(Id::new(v));
                }
            }
            Block::MoveGoods { from_at, to_at, carried, carrier, vehicle, .. } if lit(from_at) && lit(to_at) && from_at != to_at => {
                let body = match carrier.as_deref() {
                    Some(c) if lit(c) => Some(Id::new(c)),
                    Some(_) => None,
                    None if *carried => actor_body,
                    None => None,
                };
                let Some(body) = body.filter(|b| st.body(b).is_some()) else { continue };
                // (Into a vehicle, S5: its driver takes it by where the goods are, unless it stands there.)
                if let Some(v) = st.vehicles.get(to_at.as_str()) {
                    if !st.structures.contains_key(from_at.as_str()) || v.at == from_at.as_str() {
                        continue;
                    }
                    touch(&mut order, body);
                    let e = legs.entry(body).or_default();
                    e.0.push(Id::new(from_at));
                    e.2 = Some(Id::new(to_at));
                    continue;
                }
                if !st.structures.contains_key(from_at.as_str()) || !st.structures.contains_key(to_at.as_str()) {
                    continue;
                }
                touch(&mut order, body);
                let e = legs.entry(body).or_default();
                e.0.extend([Id::new(from_at), Id::new(to_at)]);
                if let Some(v) = vehicle.as_deref().filter(|v| lit(v)) {
                    e.2 = Some(Id::new(v));
                }
            }
            Block::Work { at, on: Some(on), performers, .. } if lit(at) && lit(on) && on != at && st.structures.contains_key(on.as_str()) && !on.starts_with(&format!("{at}/")) => {
                for p in performers.iter().filter(|p| lit(p)) {
                    let p = Id::new(p);
                    if st.body(&p).is_none() {
                        continue;
                    }
                    touch(&mut order, p);
                    legs.entry(p).or_default().0.push(Id::new(on));
                }
            }
            _ => {}
        }
    }
    let mut out = vec![];
    for body in order {
        let (stops, into, vehicle) = legs.remove(&body).unwrap_or_default();
        let Some(from) = st.structures_of(&body).into_iter().next() else { continue };
        let to = into.unwrap_or(from);
        let mut route = vec![from];
        for x in stops.iter().chain(std::iter::once(&to)) {
            if route.last() != Some(x) {
                route.push(*x);
            }
        }
        if route.len() < 2 {
            continue;
        }
        // (A vehicle named that the body may not drive, or that is not where it sets out: it does not set out; the act is
        // refused when it is due, having found so.)
        let speed = match vehicle {
            Some(v) => match crate::exec::driven_speed(s, st, &v, &body, &from) {
                Ok(x) => Some(x),
                Err(_) => continue,
            },
            None => None,
        };
        // (Driven, S5: along the links' route, slowed by what is on them this hour; on foot, as the ground and ways give.)
        let (mut seconds, mut links, mut metres) = match speed {
            Some(v) => {
                let mut links: Vec<Id> = vec![];
                let (mut secs, mut metres) = (0i64, 0i64);
                for p in route.windows(2) {
                    let (t, ls, m) = driven_leg(s, st, &p[0], &p[1], v, extra);
                    links.extend(ls);
                    secs = secs.saturating_add(t);
                    metres += m;
                }
                (secs, links, metres)
            }
            None => (route.windows(2).map(|p| seconds(s, st, &p[0], &p[1], None)).fold(0i64, |a, b| a.saturating_add(b)), vec![], 0),
        };
        // (Its fuel, S5: what the metres driven take, from its owner's holding at the vehicle; too little for the trip, it
        // is left where it stands and the trip is walked.)
        let mut speed = speed;
        let mut fuel = None;
        if let Some((v, x)) = vehicle.filter(|_| speed.is_some()).and_then(|v| st.vehicles.get(&v).map(|x| (v, x.clone()))) {
            if let Some((kind, per)) = s.config.travel.as_ref().and_then(|t| t.vehicle_types.iter().find(|t| t.id == x.type_)).and_then(|t| Some((t.fuel?, t.fuel_per_100km?))) {
                // (Millionths of a unit a metre: per a hundred km is per x 10 millionths a metre.)
                let owed = x.fuel_owed as i128 + metres as i128 * per as i128 * 10;
                let need = (owed / 1_000_000) as crate::money::Money;
                if st.holding(&x.owner, &v, &kind) < need {
                    speed = None;
                    seconds = route.windows(2).map(|p| self::seconds(s, st, &p[0], &p[1], None)).fold(0i64, |a, b| a.saturating_add(b));
                    links.clear();
                    metres = 0;
                } else {
                    fuel = Some((kind, need));
                }
            }
        }
        if seconds <= 0 {
            continue;
        }
        for k in &links {
            *extra.entry(*k).or_insert(0) += 1;
        }
        let via: Vec<Id> = route[1..route.len() - 1].to_vec();
        out.push(Journey { body, from, via, to, vehicle: vehicle.filter(|_| speed.is_some()), seconds, links, metres, fuel });
    }
    out
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
