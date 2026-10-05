//! Nature's physics (docs/design/world-expansion.md 2), stepped a day at a time by the world.
//!
//! - **Covers:** a cell's land cover is its building's (the type's `cover`, else `built`) or, unbuilt, its terrain (else
//!   the world's default). Unbuilt covers succeed after their days (cleared land to scrub to woodland), so mature habitat
//!   is slow to come back.
//! - **Fields:** integer quantities on cells. Each day: sources (by cover, and per building of a type at its corner
//!   cell), decay toward the baseline, diffusion to the four neighbours, flow downstream along the flow layer; bounded.
//! - **Populations:** per species and cell, an integer count. Each day: background deaths and deaths where a field
//!   passes what the species tolerates; births toward the carrying capacity (logistic, Verhulst), with crowding felt
//!   over the home range (the others there against the capacity of its covers, per 1,000 cells, so a sparse
//!   animal can have a fraction of one per cell), only where there are enough to breed (an Allee effect); none can live
//!   in a cell whose cover gives no capacity; a share disperses, a step at a time, choosing ground by how good it is (dying crossing a barrier or with nowhere to live at its range's end; the world's edge turns it back). Every fractional expectation is rounded by a draw
//!   (stochastic rounding), so small populations can fail by chance, as real ones do.
//! - **Extinction:** a species with none left anywhere is extinct, once and for good.
//!
//! No meaning is attached: a species is a name and numbers, from the world's config. Integer arithmetic only; the
//! randomness is the kernel's keyed streams, so a run replays exactly.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use oikos_contracts::config::{Catalogue, FlowCfg, SpeciesCfg, COVER_BUILT, COVER_OPEN};
use oikos_core::rng::{Randomness, Rng};

type Id = String;

const DAYS_A_YEAR: i64 = 365;
const BPS: i64 = 10_000;

/// Whether a world has nature at all (any covers, fields or species in its catalogue).
pub fn configured(cat: &Catalogue) -> bool {
    !cat.land_covers.is_empty() || !cat.fields.is_empty() || !cat.species.is_empty()
}

/// The ground as nature sees it, fixed for the run: the cells (sorted), each one's four neighbours, and the cell
/// downstream of it.
#[derive(Debug, Clone, Default)]
pub struct Ground {
    pub cells: Vec<Id>,
    pub index: BTreeMap<Id, usize>,
    pub neighbours: Vec<Vec<usize>>,
    pub downstream: Vec<Option<usize>>,
    /// Each cell's place on the plane, and the bounding box's corner and size (for sums over home ranges).
    pub xy: Vec<(i64, i64)>,
    pub corner: (i64, i64),
    pub size: (i64, i64),
    /// The cell at each place in the bounding box (row by row), if one exists there.
    pub grid: Vec<Option<usize>>,
}

impl Ground {
    /// The cell at (x, y), if there is one.
    pub fn at(&self, x: i64, y: i64) -> Option<usize> {
        let (dx, dy) = (x - self.corner.0, y - self.corner.1);
        if dx < 0 || dy < 0 || dx >= self.size.0 || dy >= self.size.1 {
            return None;
        }
        self.grid[(dy * self.size.0 + dx) as usize]
    }
}

impl Ground {
    /// From the cells that exist (id, x, y) and the flow layer.
    pub fn new(cells: &[(Id, i64, i64)], flows: &[FlowCfg]) -> Self {
        let mut sorted: Vec<(Id, i64, i64)> = cells.to_vec();
        sorted.sort();
        let index: BTreeMap<Id, usize> = sorted.iter().enumerate().map(|(i, c)| (c.0.clone(), i)).collect();
        let at: BTreeMap<(i64, i64), usize> = sorted.iter().enumerate().map(|(i, c)| ((c.1, c.2), i)).collect();
        let neighbours = sorted
            .iter()
            .map(|(_, x, y)| [(0, -1), (-1, 0), (1, 0), (0, 1)].iter().filter_map(|(dx, dy)| at.get(&(x + dx, y + dy)).copied()).collect())
            .collect();
        let mut downstream = vec![None; sorted.len()];
        for f in flows {
            if let (Some(&a), Some(&b)) = (index.get(&f.from), index.get(&f.to)) {
                downstream[a] = Some(b);
            }
        }
        let xy: Vec<(i64, i64)> = sorted.iter().map(|c| (c.1, c.2)).collect();
        let corner = (xy.iter().map(|c| c.0).min().unwrap_or(0), xy.iter().map(|c| c.1).min().unwrap_or(0));
        let size = (xy.iter().map(|c| c.0).max().map_or(0, |m| m - corner.0 + 1), xy.iter().map(|c| c.1).max().map_or(0, |m| m - corner.1 + 1));
        let mut grid = vec![None; (size.0 * size.1).max(0) as usize];
        for (i, (x, y)) in xy.iter().enumerate() {
            grid[((y - corner.1) * size.0 + (x - corner.0)) as usize] = Some(i);
        }
        Ground { cells: sorted.into_iter().map(|c| c.0).collect(), index, neighbours, downstream, xy, corner, size, grid }
    }
}

/// The land on a day: each cell's cover, whether it's built on, and the building types standing on it with their
/// corner there (field sources count once per building).
#[derive(Debug, Clone, Default)]
pub struct Land {
    pub cover: Vec<Id>,
    pub built: Vec<bool>,
    pub anchored: Vec<Vec<Id>>,
}

/// Nature's state: sparse (a field's cells at its baseline, and cells with none of a species, aren't kept).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NatureState {
    /// field -> cell -> value.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: BTreeMap<Id, BTreeMap<Id, i64>>,
    /// species -> cell -> count (> 0).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub populations: BTreeMap<Id, BTreeMap<Id, i64>>,
    /// species -> the day it went extinct. Permanent.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extinct: BTreeMap<Id, i64>,
    /// Unbuilt cells whose cover succeeds: the cover, and the day it became that.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub since: BTreeMap<Id, (Id, i64)>,
    /// The last day stepped.
    #[serde(default)]
    pub day: i64,
}

/// What a day changed that the world must know: covers that succeeded (the cell's terrain becomes the new cover), and
/// species that went extinct.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DayResult {
    pub cover_changes: Vec<(Id, Id)>,
    pub extinct: Vec<Id>,
}

/// `num / den`, with the remainder turned into one more with probability remainder/den: the expectation, exactly, in
/// integers.
fn sround(num: i64, den: i64, rng: &mut Rng) -> i64 {
    if num <= 0 || den <= 0 {
        return 0;
    }
    let (q, r) = (num / den, num % den);
    q + i64::from(r > 0 && (rng.below(den as u64) as i64) < r)
}

fn dense(sparse: Option<&BTreeMap<Id, i64>>, ground: &Ground, default: i64) -> Vec<i64> {
    let mut v = vec![default; ground.cells.len()];
    if let Some(m) = sparse {
        for (c, x) in m {
            if let Some(&i) = ground.index.get(c) {
                v[i] = *x;
            }
        }
    }
    v
}

fn sparse(v: &[i64], ground: &Ground, default: i64) -> BTreeMap<Id, i64> {
    v.iter().enumerate().filter(|(_, x)| **x != default).map(|(i, x)| (ground.cells[i].clone(), *x)).collect()
}

/// Step a day: covers, then fields, then populations (which read the day's fields).
pub fn step_day(cat: &Catalogue, ground: &Ground, land: &Land, st: &mut NatureState, day: i64, randomness: &Randomness) -> DayResult {
    let mut out = DayResult::default();
    st.day = day;
    succession(cat, ground, land, st, day, &mut out);
    let mut values: BTreeMap<Id, Vec<i64>> = BTreeMap::new();
    for f in &cat.fields {
        let v = step_field(f, ground, land, st.fields.get(&f.id), day);
        st.fields.insert(f.id.clone(), sparse(&v, ground, f.baseline));
        if st.fields.get(&f.id).is_some_and(|m| m.is_empty()) {
            st.fields.remove(&f.id);
        }
        values.insert(f.id.clone(), v);
    }
    for sp in &cat.species {
        if st.extinct.contains_key(&sp.id) {
            continue;
        }
        let n = dense(st.populations.get(&sp.id), ground, 0);
        let mut rng = randomness.stream(&["nature", &sp.id, &day.to_string()]);
        let next = step_species(sp, ground, land, &n, &values, &mut rng);
        let left = sparse(&next, ground, 0);
        if left.is_empty() {
            st.populations.remove(&sp.id);
            // (A species present at the start, or since, and now gone everywhere.)
            if n.iter().any(|x| *x > 0) {
                st.extinct.insert(sp.id.clone(), day);
                out.extinct.push(sp.id.clone());
            }
        } else {
            st.populations.insert(sp.id.clone(), left);
        }
    }
    out
}

fn succession(cat: &Catalogue, ground: &Ground, land: &Land, st: &mut NatureState, day: i64, out: &mut DayResult) {
    let next: BTreeMap<&str, (&str, i64)> =
        cat.land_covers.iter().filter_map(|c| c.succeeds_to.as_ref().map(|s| (c.id.as_str(), (s.cover.as_str(), s.after_days)))).collect();
    for (i, cell) in ground.cells.iter().enumerate() {
        let cover = &land.cover[i];
        let Some(&(to, after)) = next.get(cover.as_str()).filter(|_| !land.built[i]) else {
            st.since.remove(cell);
            continue;
        };
        match st.since.get(cell) {
            Some((c, from)) if c == cover => {
                if day - from >= after {
                    out.cover_changes.push((cell.clone(), to.to_string()));
                    st.since.insert(cell.clone(), (to.to_string(), day));
                }
            }
            _ => {
                st.since.insert(cell.clone(), (cover.clone(), day));
            }
        }
    }
}

fn step_field(f: &oikos_contracts::config::FieldCfg, ground: &Ground, land: &Land, now: Option<&BTreeMap<Id, i64>>, day: i64) -> Vec<i64> {
    step_field_dense(f, ground, land, dense(now, ground, f.baseline), day)
}

fn step_field_dense(f: &oikos_contracts::config::FieldCfg, ground: &Ground, land: &Land, mut v: Vec<i64>, day: i64) -> Vec<i64> {
    let n = ground.cells.len();
    // Sources (a cover's may be negative: soaking it up), scaled for the day (rain, drought).
    let scale = f.source_by_day.iter().rev().find(|s| s.from_day <= day).map_or(BPS, |s| s.bps);
    for i in 0..n {
        let mut add = f.from_covers.get(&land.cover[i]).copied().unwrap_or(0);
        for ty in &land.anchored[i] {
            add += f.from_structures.get(ty).copied().unwrap_or(0);
        }
        v[i] += if add > 0 { add.saturating_mul(scale) / BPS } else { add };
    }
    // Decay toward the baseline (at least one step while it's away from it).
    if f.decay_bps_per_day > 0 {
        for x in v.iter_mut() {
            let gap = f.baseline - *x;
            let d = gap * f.decay_bps_per_day / BPS;
            *x += if d == 0 && gap != 0 { gap.signum() } else { d };
        }
    }
    // Diffusion: each cell sends a share of what it has above the baseline, evenly to its neighbours.
    if f.diffusion_bps_per_day > 0 {
        let mut next = v.clone();
        for i in 0..n {
            let nb = &ground.neighbours[i];
            let excess = v[i] - f.baseline;
            if nb.is_empty() || excess <= 0 {
                continue;
            }
            let each = excess * f.diffusion_bps_per_day / BPS / nb.len() as i64;
            if each == 0 {
                continue;
            }
            next[i] -= each * nb.len() as i64;
            for &j in nb {
                next[j] += each;
            }
        }
        v = next;
    }
    // Flow: a share of what's above the baseline carried downstream (off the edge of the world, it's gone).
    if f.flow_bps_per_day > 0 {
        let mut next = v.clone();
        for i in 0..n {
            let excess = v[i] - f.baseline;
            if excess <= 0 {
                continue;
            }
            let Some(j) = ground.downstream[i] else { continue };
            let moved = excess * f.flow_bps_per_day / BPS;
            next[i] -= moved;
            next[j] += moved;
        }
        v = next;
    }
    // Spilling: what's above the level on a cell spreads to its neighbours (a river over its banks).
    if let (Some(level), true) = (f.spills_above, f.spill_bps_per_day > 0) {
        let mut next = v.clone();
        for i in 0..n {
            let nb = &ground.neighbours[i];
            let excess = v[i] - level;
            if nb.is_empty() || excess <= 0 {
                continue;
            }
            let each = excess * f.spill_bps_per_day / BPS / nb.len() as i64;
            if each == 0 {
                continue;
            }
            next[i] -= each * nb.len() as i64;
            for &j in nb {
                next[j] += each;
            }
        }
        v = next;
    }
    for x in v.iter_mut() {
        *x = (*x).clamp(f.min, f.max);
    }
    v
}

/// Each cell's sum of `v` over the square of cells `r` each way around it (a home range), by 2D prefix sums.
fn home_range_sums(ground: &Ground, v: &[i64], r: i64) -> Vec<i64> {
    if r == 0 {
        return v.to_vec();
    }
    let (w, h) = ground.size;
    let (cx, cy) = ground.corner;
    let at = |x: i64, y: i64| (y * (w + 1) + x) as usize;
    let mut pre = vec![0i64; ((w + 1) * (h + 1)) as usize];
    for (i, (x, y)) in ground.xy.iter().enumerate() {
        pre[at(x - cx + 1, y - cy + 1)] += v[i];
    }
    for y in 1..=h {
        for x in 1..=w {
            pre[at(x, y)] += pre[at(x - 1, y)] + pre[at(x, y - 1)] - pre[at(x - 1, y - 1)];
        }
    }
    ground
        .xy
        .iter()
        .map(|(x, y)| {
            let (x0, y0) = ((x - cx - r).max(0), (y - cy - r).max(0));
            let (x1, y1) = ((x - cx + r + 1).min(w), (y - cy + r + 1).min(h));
            pre[at(x1, y1)] - pre[at(x0, y1)] - pre[at(x1, y0)] + pre[at(x0, y0)]
        })
        .collect()
}

/// `sround` on wide numbers (a home range's capacity times a rate can pass 2^63), clamped to i64.
fn sround_wide(num: i128, den: i128, rng: &mut Rng) -> i64 {
    if num <= 0 || den <= 0 {
        return 0;
    }
    let (q, r) = (num / den, num % den);
    let extra = r > 0 && (rng.below(u64::try_from(den).unwrap_or(u64::MAX)) as i128) < r;
    i64::try_from(q + i128::from(extra)).unwrap_or(i64::MAX)
}

/// A species' capacity per 1,000 cells, cell by cell, and over each cell's home range: what the land gives it (the same
/// while the land is).
struct Capacity {
    cap: Vec<i64>,
    room: Vec<i64>,
}

fn capacity(sp: &SpeciesCfg, ground: &Ground, land: &Land) -> Capacity {
    let cap: Vec<i64> = land.cover.iter().map(|c| sp.capacity_per_1000_cells.get(c).copied().unwrap_or(0)).collect();
    let room = home_range_sums(ground, &cap, sp.home_range);
    Capacity { cap, room }
}

fn step_species(sp: &SpeciesCfg, ground: &Ground, land: &Land, n: &[i64], fields: &BTreeMap<Id, Vec<i64>>, rng: &mut Rng) -> Vec<i64> {
    step_species_with(sp, ground, land, &capacity(sp, ground, land), n, fields, rng)
}

fn step_species_with(sp: &SpeciesCfg, ground: &Ground, land: &Land, capacity: &Capacity, n: &[i64], fields: &BTreeMap<Id, Vec<i64>>, rng: &mut Rng) -> Vec<i64> {
    let cells = ground.cells.len();
    let barriers: BTreeSet<&str> = sp.barriers.iter().map(String::as_str).collect();
    let year = BPS * DAYS_A_YEAR;
    // The individuals over each cell's home range, against its capacity.
    let (cap, room) = (&capacity.cap, &capacity.room);
    let best = sp.capacity_per_1000_cells.values().copied().max().unwrap_or(1).max(1);
    let crowd = home_range_sums(ground, n, sp.home_range);
    let mut next = vec![0i64; cells];
    let mut arriving = vec![0i64; cells];
    for i in 0..cells {
        let here = n[i];
        if here <= 0 {
            continue;
        }
        // (Crowding is the others there: counting itself, a sparse animal whose home range holds about two would settle
        // at half its capacity.)
        let (local, k) = (i128::from((crowd[i] - 1).max(0)) * 1000, i128::from(room[i]));
        // Deaths: background, and where a field passes what it tolerates.
        let mut deaths = sround(here * sp.mortality_bps_per_year, year, rng);
        for (field, tol) in &sp.tolerance {
            if fields.get(field).is_some_and(|v| v[i] > tol.above) {
                deaths += sround(here * tol.mortality_bps_per_day, BPS, rng);
            }
        }
        // Births: replacing the background deaths, plus logistic growth toward the capacity of the home range (so it
        // settles there), where there are enough to breed; crowding past it kills.
        let (m, r, h) = (i128::from(sp.mortality_bps_per_year), i128::from(sp.growth_bps_per_year), i128::from(here));
        let births = if k > local && crowd[i] >= sp.min_viable.max(1) { sround_wide(h * (m * k + r * (k - local)), k * i128::from(year), rng) } else { 0 };
        if k > 0 && local > k {
            deaths += sround_wide(h * r * (local - k), k * i128::from(year), rng);
        }
        let k = cap[i];
        // The young of a species with a home range leave it: each newborn disperses from here (natal dispersal); one
        // without is born in place. A share of the rest disperse each year.
        // A disperser walks a step at a time in random directions and settles out of the home range it left, on ground
        // it can live on, with a chance as good as the ground is next to its best (so it passes poor ground by, as
        // dispersers choose habitat); at the end of its range, on whatever ground it can live on, or it dies there. It
        // dies crossing a barrier; so a gap wider than its range cuts a patch off. The world's edge turns it back
        // (beyond it is more of the same: as many come in as go out).
        let mut alive = (here - deaths).max(0);
        let leaving = sround(alive * sp.dispersal_bps_per_year, year, rng).min(alive);
        let (x0, y0) = ground.xy[i];
        let (hr, range) = (sp.home_range.max(0), sp.dispersal_range.max(0));
        let natal = if hr > 0 { births } else { 0 };
        alive += births - natal;
        const WAYS: [(i64, i64); 4] = [(0, -1), (-1, 0), (1, 0), (0, 1)];
        let steps = range.max(2 * (hr + 1));
        for _ in 0..(leaving + natal) {
            let mut at = i;
            // (A correlated walk: it keeps its heading, turning at random one step in four, as dispersers head off.)
            let mut way = rng.below(4) as usize;
            for step in 0..=steps {
                if rng.below(4) == 0 {
                    way = rng.below(4) as usize;
                }
                let (x, y) = ground.xy[at];
                // (Where there's no cell that way, the world's edge, it turns about and doesn't move this step.)
                let Some(j) = ground.at(x + WAYS[way].0, y + WAYS[way].1) else {
                    way = 3 - way;
                    continue;
                };
                if barriers.contains(land.cover[j].as_str()) {
                    break;
                }
                at = j;
                let (x, y) = ground.xy[j];
                let away = (x - x0).abs().max((y - y0).abs()) > hr;
                let last = step == steps;
                if cap[j] > 0 && (last || (away && (rng.below(best as u64) as i64) < cap[j])) {
                    arriving[j] += 1;
                    break;
                }
            }
        }
        alive -= leaving;
        // Where the cover gives it no capacity, none that stay live the day.
        next[i] = if k > 0 { alive } else { 0 };
    }
    for i in 0..cells {
        next[i] += arriving[i];
    }
    next
}

/// Nature's spin-up: `days` stepped before the run, over the land as it is, with no succession (as `step_day` with no
/// covers' succession would, day by day, exactly), but kept dense throughout. Returns the species that went extinct.
pub fn spin_up(cat: &Catalogue, ground: &Ground, land: &Land, st: &mut NatureState, first_day: i64, days: i64, randomness: &Randomness) -> Vec<Id> {
    let mut fields: Vec<Vec<i64>> = cat.fields.iter().map(|f| dense(st.fields.get(&f.id), ground, f.baseline)).collect();
    let mut pops: Vec<Vec<i64>> = cat.species.iter().map(|sp| dense(st.populations.get(&sp.id), ground, 0)).collect();
    let mut gone = vec![];
    // (The land doesn't change in a spin-up: each species' capacity, once.)
    let caps: Vec<Capacity> = cat.species.iter().map(|sp| capacity(sp, ground, land)).collect();
    for day in first_day..first_day + days {
        for (k, f) in cat.fields.iter().enumerate() {
            fields[k] = step_field_dense(f, ground, land, std::mem::take(&mut fields[k]), day);
        }
        let values: BTreeMap<Id, Vec<i64>> = cat.fields.iter().zip(&fields).map(|(f, v)| (f.id.clone(), v.clone())).collect();
        for (k, sp) in cat.species.iter().enumerate() {
            if st.extinct.contains_key(&sp.id) {
                continue;
            }
            let mut rng = randomness.stream(&["nature", &sp.id, &day.to_string()]);
            let next = step_species_with(sp, ground, land, &caps[k], &pops[k], &values, &mut rng);
            if next.iter().all(|x| *x == 0) && pops[k].iter().any(|x| *x > 0) {
                st.extinct.insert(sp.id.clone(), day);
                gone.push(sp.id.clone());
            }
            pops[k] = next;
        }
    }
    for (f, v) in cat.fields.iter().zip(&fields) {
        let m = sparse(v, ground, f.baseline);
        if m.is_empty() { st.fields.remove(&f.id); } else { st.fields.insert(f.id.clone(), m); }
    }
    for (sp, v) in cat.species.iter().zip(&pops) {
        let m = sparse(v, ground, 0);
        if m.is_empty() { st.populations.remove(&sp.id); } else { st.populations.insert(sp.id.clone(), m); }
    }
    gone
}

/// A survey's estimate of a species in a cell: each one there found with the species' detection chance.
pub fn survey_count(count: i64, detection_bps: i64, rng: &mut Rng) -> i64 {
    (0..count.max(0)).filter(|_| (rng.below(BPS as u64) as i64) < detection_bps).count() as i64
}

/// A survey's estimate of a field in a cell: the value, off by up to (10,000 - detection) basis points of it.
pub fn survey_value(value: i64, detection_bps: i64, rng: &mut Rng) -> i64 {
    let err = value.abs() * (BPS - detection_bps.clamp(0, BPS)) / BPS;
    if err == 0 {
        return value;
    }
    value + rng.below((2 * err + 1) as u64) as i64 - err
}

/// The truth, for measurement (a monthly census): each species' total and the cells it's in, and the cells of each
/// cover.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Census {
    pub species: BTreeMap<Id, (i64, i64)>,
    pub covers: BTreeMap<Id, i64>,
}

pub fn census(cat: &Catalogue, st: &NatureState, land: &Land) -> Census {
    let mut c = Census::default();
    for sp in &cat.species {
        let m = st.populations.get(&sp.id);
        c.species.insert(sp.id.clone(), (m.map_or(0, |m| m.values().sum()), m.map_or(0, |m| m.len() as i64)));
    }
    for cover in &land.cover {
        *c.covers.entry(cover.clone()).or_insert(0) += 1;
    }
    c
}

/// A cell's cover: its building's (the type's cover, else `built`), or unbuilt, its terrain, else the world's default.
pub fn cover_of(cat: &Catalogue, terrain: Option<&str>, building_cover: Option<Option<&str>>) -> Id {
    match building_cover {
        Some(c) => c.unwrap_or(COVER_BUILT).to_string(),
        None => terrain.or(cat.default_cover.as_deref()).unwrap_or(COVER_OPEN).to_string(),
    }
}

#[cfg(test)]
mod tests;
