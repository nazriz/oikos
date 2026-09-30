//! Nature's physics (docs/design/world-expansion.md 2), stepped a day at a time by the world.
//!
//! - **Covers:** a cell's land cover is its building's (the type's `cover`, else `built`) or, unbuilt, its terrain (else
//!   the world's default). Unbuilt covers succeed after their days (cleared land to scrub to woodland), so mature habitat
//!   is slow to come back.
//! - **Fields:** integer quantities on cells. Each day: sources (by cover, and per building of a type at its corner
//!   cell), decay toward the baseline, diffusion to the four neighbours, flow downstream along the flow layer; bounded.
//! - **Populations:** per species and cell, an integer count. Each day: background deaths and deaths where a field
//!   passes what the species tolerates; births toward the carrying capacity of the cell's cover (logistic, Verhulst),
//!   only where there are enough to breed (an Allee effect); none can live where the cover gives no capacity; a share
//!   disperses to neighbouring cells, and dies crossing a barrier. Every fractional expectation is rounded by a draw
//!   (stochastic rounding), so small populations can fail by chance, as real ones do.
//! - **Extinction:** a species with none left anywhere is extinct, once and for good.
//!
//! No meaning is attached: a species is a name and numbers, from the world's config. Integer arithmetic only; the
//! randomness is the kernel's keyed streams, so a run replays exactly.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use terrarium_contracts::config::{Catalogue, FlowCfg, SpeciesCfg, COVER_BUILT, COVER_OPEN};
use terrarium_core::rng::{Randomness, Rng};

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
        Ground { cells: sorted.into_iter().map(|c| c.0).collect(), index, neighbours, downstream }
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
        let v = step_field(f, ground, land, st.fields.get(&f.id));
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

fn step_field(f: &terrarium_contracts::config::FieldCfg, ground: &Ground, land: &Land, now: Option<&BTreeMap<Id, i64>>) -> Vec<i64> {
    let n = ground.cells.len();
    let mut v = dense(now, ground, f.baseline);
    // Sources.
    for i in 0..n {
        v[i] += f.from_covers.get(&land.cover[i]).copied().unwrap_or(0);
        for ty in &land.anchored[i] {
            v[i] += f.from_structures.get(ty).copied().unwrap_or(0);
        }
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
    for x in v.iter_mut() {
        *x = (*x).clamp(f.min, f.max);
    }
    v
}

fn step_species(sp: &SpeciesCfg, ground: &Ground, land: &Land, n: &[i64], fields: &BTreeMap<Id, Vec<i64>>, rng: &mut Rng) -> Vec<i64> {
    let cells = ground.cells.len();
    let barriers: BTreeSet<&str> = sp.barriers.iter().map(String::as_str).collect();
    let year = BPS * DAYS_A_YEAR;
    let mut next = vec![0i64; cells];
    let mut arriving = vec![0i64; cells];
    for i in 0..cells {
        let here = n[i];
        if here <= 0 {
            continue;
        }
        let k = sp.capacity.get(&land.cover[i]).copied().unwrap_or(0);
        // Deaths: background, and where a field passes what it tolerates.
        let mut deaths = sround(here * sp.mortality_bps_per_year, year, rng);
        for (field, tol) in &sp.tolerance {
            if fields.get(field).is_some_and(|v| v[i] > tol.above) {
                deaths += sround(here * tol.mortality_bps_per_day, BPS, rng);
            }
        }
        // Births: replacing the background deaths, plus logistic growth toward the capacity (so it settles at the
        // capacity), where there are enough to breed; crowding past it kills.
        let births = if k > here && here >= sp.min_viable.max(1) {
            sround(here * (sp.mortality_bps_per_year * k + sp.growth_bps_per_year * (k - here)), k * year, rng)
        } else {
            0
        };
        if k > 0 && here > k {
            deaths += sround(here * sp.growth_bps_per_year * (here - k), k * year, rng);
        }
        let mut alive = (here - deaths).max(0) + births;
        // Dispersal: a share leaves for a neighbouring cell at random; crossing a barrier (or off the world's edge),
        // it's lost.
        let leaving = sround(alive * sp.dispersal_bps_per_year, year, rng).min(alive);
        let nb = &ground.neighbours[i];
        for _ in 0..leaving {
            // (Four ways out; where there's no cell that way, it's gone.)
            let way = rng.below(4) as usize;
            if let Some(&j) = nb.get(way) {
                if !barriers.contains(land.cover[j].as_str()) {
                    arriving[j] += 1;
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
