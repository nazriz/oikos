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

use oikos_core::Id;

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
        let index: BTreeMap<Id, usize> = sorted.iter().enumerate().map(|(i, c)| (c.0, i)).collect();
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
    /// Nature's edge (law 8), for each field that holds a kind: what nature's own days have taken from the field, less
    /// what they added (rain and inflow, decay, flow off the ground, a bound reached), since the run began. So the kind's
    /// total over holdings, fields, edges and this changes only by what processes make and use (kernel/tests/conservation.rs).
    /// A spin-up before the run is the world's starting state, not counted.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty", with = "oikos_core::money::amount_map")]
    pub edge: BTreeMap<Id, oikos_core::money::Money>,
}

/// A field's total over the cells (dense), exactly.
fn total(v: &[i64]) -> i128 {
    v.iter().map(|x| *x as i128).sum()
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
    v.iter().enumerate().filter(|(_, x)| **x != default).map(|(i, x)| (ground.cells[i], *x)).collect()
}

/// Step a day: covers, then fields, then populations (which read the day's fields).
pub fn step_day(cat: &Catalogue, ground: &Ground, land: &Land, st: &mut NatureState, day: i64, randomness: &Randomness) -> DayResult {
    let mut out = DayResult::default();
    st.day = day;
    succession(cat, ground, land, st, day, &mut out);
    let mut values: BTreeMap<Id, Vec<i64>> = BTreeMap::new();
    for f in &cat.fields {
        // (A field that holds a kind: what its day changed is nature's, counted on its edge.)
        let before = f.kind.as_ref().map(|_| total(&dense(st.fields.get(&f.id), ground, f.baseline)));
        let v = step_field(f, ground, land, st.fields.get(&f.id), day);
        if let Some(b) = before {
            *st.edge.entry(f.id).or_insert(0) -= total(&v) - b;
        }
        st.fields.insert(f.id, sparse(&v, ground, f.baseline));
        if st.fields.get(&f.id).is_some_and(|m| m.is_empty()) {
            st.fields.remove(&f.id);
        }
        values.insert(f.id, v);
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
                st.extinct.insert(sp.id, day);
                out.extinct.push(sp.id);
            }
        } else {
            st.populations.insert(sp.id, left);
        }
    }
    out
}

fn succession(cat: &Catalogue, ground: &Ground, land: &Land, st: &mut NatureState, day: i64, out: &mut DayResult) {
    let next: BTreeMap<&str, (&str, i64)> =
        cat.land_covers.iter().filter_map(|c| c.succeeds_to.as_ref().map(|s| (c.id.as_str(), (s.cover.as_str(), s.after_days)))).collect();
    // A cell whose cover doesn't succeed (or that's built on) keeps no day: those are taken out by going through the
    // days kept (few), not by looking every cell up among them.
    st.since.retain(|cell, _| ground.index.get(cell).is_none_or(|&i| !land.built[i] && next.contains_key(land.cover[i].as_str())));
    for (i, cell) in ground.cells.iter().enumerate() {
        let cover = &land.cover[i];
        let Some(&(to, after)) = next.get(cover.as_str()).filter(|_| !land.built[i]) else { continue };
        match st.since.get(cell) {
            Some((c, from)) if c == cover => {
                if day - from >= after {
                    out.cover_changes.push((*cell, to.to_string().into()));
                    st.since.insert(*cell, (to.to_string().into(), day));
                }
            }
            _ => {
                st.since.insert(*cell, (*cover, day));
            }
        }
    }
}

fn step_field(f: &oikos_contracts::config::FieldCfg, ground: &Ground, land: &Land, now: Option<&BTreeMap<Id, i64>>, day: i64) -> Vec<i64> {
    step_field_dense(f, ground, land, dense(now, ground, f.baseline), day)
}

/// `bps` basis points of `x`, toward zero: exactly `x * bps / BPS`, worked in 128 bits. A field's values and its sources
/// are any integers the contracts allow (within ±(2^53 − 1)) and its rates at most 10,000 basis points (1,000,000 for a
/// day's scale), so the product can pass 64 bits, where a test build would stop and a release build once wrapped; in
/// 128 it can't (under 2^64 x 2^20), and the share is no larger than what it's a share of (or 100 times it, for a
/// scale), which fits. The same answer wherever the 64-bit product fitted.
fn share(x: i64, bps: i64) -> i64 {
    // (Where the product fits in 64 bits, as it nearly always does, it's worked there: the same division, toward zero.)
    match x.checked_mul(bps) {
        Some(product) => product / BPS,
        None => (x as i128 * bps as i128 / BPS as i128).clamp(i64::MIN as i128, i64::MAX as i128) as i64,
    }
}

/// What a field's sources add to each cell in a day, before the day's scale: its cover's, and each building's with its
/// corner there (the same from day to day while the land is).
fn field_sources(f: &oikos_contracts::config::FieldCfg, ground: &Ground, land: &Land) -> Vec<i64> {
    (0..ground.cells.len())
        .map(|i| {
            // (Sums here and below saturate: each term is within a few times 2^53, so only a world with hundreds of
            // cells of the largest values the contracts allow all moving into one could reach 64 bits, and it's held
            // to the field's bounds at the end of the day either way.)
            let mut add = f.from_covers.get(&land.cover[i]).copied().unwrap_or(0);
            for ty in &land.anchored[i] {
                add = add.saturating_add(f.from_structures.get(ty).copied().unwrap_or(0));
            }
            add
        })
        .collect()
}

fn step_field_dense(f: &oikos_contracts::config::FieldCfg, ground: &Ground, land: &Land, v: Vec<i64>, day: i64) -> Vec<i64> {
    step_field_from(f, ground, &field_sources(f, ground, land), v, day)
}

/// What a field's sources are scaled by on a day (rain, drought), in basis points: all a field's day takes from which
/// day it is.
fn source_scale(f: &oikos_contracts::config::FieldCfg, day: i64) -> i64 {
    f.source_by_day.iter().rev().find(|s| s.from_day <= day).map_or(BPS, |s| s.bps)
}

/// A field's day, from what its sources add to each cell (`field_sources`).
fn step_field_from(f: &oikos_contracts::config::FieldCfg, ground: &Ground, sources: &[i64], mut v: Vec<i64>, day: i64) -> Vec<i64> {
    let n = ground.cells.len();
    // Sources (a cover's may be negative: soaking it up), scaled for the day (rain, drought).
    let scale = source_scale(f, day);
    for i in 0..n {
        let add = sources[i];
        v[i] = v[i].saturating_add(if add > 0 { add.saturating_mul(scale) / BPS } else { add });
    }
    // Decay toward the baseline (at least one step while it's away from it).
    if f.decay_bps_per_day > 0 {
        for x in v.iter_mut() {
            let gap = f.baseline.saturating_sub(*x);
            let d = share(gap, f.decay_bps_per_day);
            *x = x.saturating_add(if d == 0 && gap != 0 { gap.signum() } else { d });
        }
    }
    // Diffusion: each cell sends a share of what it has above the baseline, evenly to its neighbours.
    if f.diffusion_bps_per_day > 0 {
        let mut next = v.clone();
        for i in 0..n {
            let nb = &ground.neighbours[i];
            let excess = v[i].saturating_sub(f.baseline);
            if nb.is_empty() || excess <= 0 {
                continue;
            }
            let each = share(excess, f.diffusion_bps_per_day) / nb.len() as i64;
            if each == 0 {
                continue;
            }
            // (`each` times the neighbours is at most the excess.)
            next[i] = next[i].saturating_sub(each * nb.len() as i64);
            for &j in nb {
                next[j] = next[j].saturating_add(each);
            }
        }
        v = next;
    }
    // Flow: a share of what's above the baseline carried downstream (off the edge of the world, it's gone).
    if f.flow_bps_per_day > 0 {
        let mut next = v.clone();
        for i in 0..n {
            let excess = v[i].saturating_sub(f.baseline);
            if excess <= 0 {
                continue;
            }
            let Some(j) = ground.downstream[i] else { continue };
            let moved = share(excess, f.flow_bps_per_day);
            next[i] = next[i].saturating_sub(moved);
            next[j] = next[j].saturating_add(moved);
        }
        v = next;
    }
    // Spilling: what's above the level on a cell spreads to its neighbours (a river over its banks).
    if let (Some(level), true) = (f.spills_above, f.spill_bps_per_day > 0) {
        let mut next = v.clone();
        for i in 0..n {
            let nb = &ground.neighbours[i];
            let excess = v[i].saturating_sub(level);
            if nb.is_empty() || excess <= 0 {
                continue;
            }
            let each = share(excess, f.spill_bps_per_day) / nb.len() as i64;
            if each == 0 {
                continue;
            }
            next[i] = next[i].saturating_sub(each * nb.len() as i64);
            for &j in nb {
                next[j] = next[j].saturating_add(each);
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

/// `home_range_sums` of a species' numbers, at the cells where it has any (the only ones its day reads; the rest are
/// left at zero). Where few cells have any, each one's square is summed cell by cell, which is less work than the
/// whole ground's prefix sums: the same sums either way.
fn crowding(ground: &Ground, n: &[i64], r: i64) -> Vec<i64> {
    if !few_enough(n.iter().filter(|x| **x > 0).count(), r, n.len()) {
        return home_range_sums(ground, n, r);
    }
    let mut sums = vec![0i64; n.len()];
    for (i, _) in n.iter().enumerate().filter(|(_, x)| **x > 0) {
        sums[i] = home_range_sum(ground, n, r, i);
    }
    sums
}

/// One cell's sum of `v` over the square of cells `r` each way around it, cell by cell: what `home_range_sums` gives
/// for it.
fn home_range_sum(ground: &Ground, v: &[i64], r: i64, i: usize) -> i64 {
    let (x0, y0) = ground.xy[i];
    let mut sum = 0i64;
    for y in y0 - r..=y0 + r {
        for x in x0 - r..=x0 + r {
            if let Some(j) = ground.at(x, y) {
                sum += v[j];
            }
        }
    }
    sum
}

/// Whether summing each occupied cell's square one by one is less work than the whole ground's prefix sums.
fn few_enough(occupied: usize, r: i64, cells: usize) -> bool {
    r != 0 && (occupied as i64).saturating_mul((2 * r + 1) * (2 * r + 1)) <= cells as i64
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

/// A species' capacity per 1,000 cells, cell by cell, and over each cell's home range, and the cells whose cover is a
/// barrier to it: what the land gives it (the same while the land is).
struct Capacity {
    cap: Vec<i64>,
    room: Vec<i64>,
    barrier: Vec<bool>,
}

fn capacity(sp: &SpeciesCfg, ground: &Ground, land: &Land) -> Capacity {
    let cap: Vec<i64> = land.cover.iter().map(|c| sp.capacity_per_1000_cells.get(c).copied().unwrap_or(0)).collect();
    let room = home_range_sums(ground, &cap, sp.home_range);
    let barriers: BTreeSet<&str> = sp.barriers.iter().map(Id::as_str).collect();
    let barrier = land.cover.iter().map(|c| barriers.contains(c.as_str())).collect();
    Capacity { cap, room, barrier }
}

fn step_species(sp: &SpeciesCfg, ground: &Ground, land: &Land, n: &[i64], fields: &BTreeMap<Id, Vec<i64>>, rng: &mut Rng) -> Vec<i64> {
    let fields: Vec<(&str, &[i64])> = fields.iter().map(|(id, v)| (id.as_str(), v.as_slice())).collect();
    step_species_with(sp, ground, &capacity(sp, ground, land), n, &fields, rng)
}

/// A species' day over the whole ground. `fields` is each field's values that day, by id.
fn step_species_with(sp: &SpeciesCfg, ground: &Ground, capacity: &Capacity, n: &[i64], fields: &[(&str, &[i64])], rng: &mut Rng) -> Vec<i64> {
    let crowd = crowding(ground, n, sp.home_range);
    let mut next = vec![0i64; n.len()];
    let mut arriving: Vec<usize> = vec![];
    let living = n.iter().enumerate().filter(|(_, x)| **x > 0).map(|(i, x)| (i, *x, crowd[i]));
    species_day(sp, ground, capacity, living, fields, rng, &mut |i, left| next[i] = left, &mut |j| arriving.push(j));
    for j in arriving {
        next[j] += 1;
    }
    next
}

/// A species' numbers through a spin-up, kept both ways: the cells it's in and how many in each (in the ground's
/// order), and the whole ground's (what the sums over home ranges read). A day then costs what the cells it's in do,
/// not the ground: the same day as `step_species_with`'s, draw for draw.
struct Spread {
    living: Vec<(usize, i64)>,
    dense: Vec<i64>,
    /// Cells given a number below zero at the start: counted in the first day's sums as they stand, and none after it.
    below: Vec<usize>,
}

impl Spread {
    fn of(dense: Vec<i64>) -> Spread {
        let living = dense.iter().enumerate().filter(|(_, x)| **x > 0).map(|(i, x)| (i, *x)).collect();
        let below = dense.iter().enumerate().filter(|(_, x)| **x < 0).map(|(i, _)| i).collect();
        Spread { living, dense, below }
    }

    fn day(&mut self, sp: &SpeciesCfg, ground: &Ground, capacity: &Capacity, fields: &[(&str, &[i64])], rng: &mut Rng) {
        let r = sp.home_range;
        let dense = &self.dense;
        // (Each cell's sum over its home range: its own square where the species is in few cells, else the whole ground's.)
        let sums = (!few_enough(self.living.len(), r, dense.len())).then(|| home_range_sums(ground, dense, r));
        let living = self.living.iter().map(|&(i, here)| (i, here, sums.as_ref().map_or_else(|| home_range_sum(ground, dense, r, i), |s| s[i])));
        let mut staying: Vec<(usize, i64)> = Vec::with_capacity(self.living.len());
        let mut arriving: Vec<usize> = vec![];
        species_day(sp, ground, capacity, living, fields, rng, &mut |i, left| staying.push((i, left)), &mut |j| arriving.push(j));
        for i in self.living.iter().map(|(i, _)| *i).chain(self.below.drain(..)) {
            self.dense[i] = 0;
        }
        // Those that stayed and those that arrived, cell by cell in order.
        arriving.sort_unstable();
        let (mut stayed, mut arrived) = (staying.into_iter().peekable(), arriving.into_iter().peekable());
        self.living.clear();
        loop {
            let i = match (stayed.peek(), arrived.peek()) {
                (Some(&(i, _)), Some(&j)) => i.min(j),
                (Some(&(i, _)), None) => i,
                (None, Some(&j)) => j,
                (None, None) => break,
            };
            let mut count = stayed.next_if(|(cell, _)| *cell == i).map_or(0, |(_, left)| left);
            while arrived.next_if_eq(&i).is_some() {
                count += 1;
            }
            self.dense[i] = count;
            if count > 0 {
                self.living.push((i, count));
            }
        }
    }
}

/// A species' day at the cells it's in: `living` gives each, in the ground's order, with how many are there and how
/// many over its home range. `stay` is told how many are left in each of those cells, and `arrive` of each one that
/// settles in a cell (any cell). `fields` is each field's values that day, by id.
#[allow(clippy::too_many_arguments)]
fn species_day(
    sp: &SpeciesCfg,
    ground: &Ground,
    capacity: &Capacity,
    living: impl Iterator<Item = (usize, i64, i64)>,
    fields: &[(&str, &[i64])],
    rng: &mut Rng,
    stay: &mut dyn FnMut(usize, i64),
    arrive: &mut dyn FnMut(usize),
) {
    let year = BPS * DAYS_A_YEAR;
    // The individuals over each cell's home range, against its capacity.
    let (cap, room) = (&capacity.cap, &capacity.room);
    let best = sp.capacity_per_1000_cells.values().copied().max().unwrap_or(1).max(1);
    // (The fields it tolerates only so much of, found once.)
    let tolerated: Vec<(&[i64], &oikos_contracts::config::ToleranceCfg)> =
        sp.tolerance.iter().filter_map(|(field, tol)| fields.iter().rev().find(|(id, _)| *id == field.as_str()).map(|(_, v)| (*v, tol))).collect();
    for (i, here, crowd) in living {
        // (Crowding is the others there: counting itself, a sparse animal whose home range holds about two would settle
        // at half its capacity.)
        let (local, k) = (i128::from((crowd - 1).max(0)) * 1000, i128::from(room[i]));
        // Deaths: background, and where a field passes what it tolerates.
        let mut deaths = sround(here * sp.mortality_bps_per_year, year, rng);
        for (v, tol) in &tolerated {
            if v[i] > tol.above {
                deaths += sround(here * tol.mortality_bps_per_day, BPS, rng);
            }
        }
        // Births: replacing the background deaths, plus logistic growth toward the capacity of the home range (so it
        // settles there), where there are enough to breed; crowding past it kills.
        let (m, r, h) = (i128::from(sp.mortality_bps_per_year), i128::from(sp.growth_bps_per_year), i128::from(here));
        let births = if k > local && crowd >= sp.min_viable.max(1) { sround_wide(h * (m * k + r * (k - local)), k * i128::from(year), rng) } else { 0 };
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
                if capacity.barrier[j] {
                    break;
                }
                at = j;
                let (x, y) = ground.xy[j];
                let away = (x - x0).abs().max((y - y0).abs()) > hr;
                let last = step == steps;
                if cap[j] > 0 && (last || (away && (rng.below(best as u64) as i64) < cap[j])) {
                    arrive(j);
                    break;
                }
            }
        }
        alive -= leaving;
        // Where the cover gives it no capacity, none that stay live the day.
        stay(i, if k > 0 { alive } else { 0 });
    }
}

/// A field's last few states in a spin-up, under one scale on its sources (the oldest first, the latest last), and
/// whether they have closed into a round: the state after the latest is the oldest again.
#[derive(Default)]
struct Round {
    scale: Option<i64>,
    states: Vec<Vec<i64>>,
    closed: bool,
}

/// How many of a field's last states a spin-up keeps to find a round among.
const ROUND_KEPT: usize = 8;

/// Nature's spin-up: `days` stepped before the run, over the land as it is, with no succession (as `step_day` with no
/// covers' succession would, day by day, exactly), but kept dense throughout. Returns the species that went extinct.
pub fn spin_up(cat: &Catalogue, ground: &Ground, land: &Land, st: &mut NatureState, first_day: i64, days: i64, randomness: &Randomness) -> Vec<Id> {
    let mut fields: Vec<Vec<i64>> = cat.fields.iter().map(|f| dense(st.fields.get(&f.id), ground, f.baseline)).collect();
    let mut pops: Vec<Spread> = cat.species.iter().map(|sp| Spread::of(dense(st.populations.get(&sp.id), ground, 0))).collect();
    let mut gone = vec![];
    // (The land doesn't change in a spin-up: each species' capacity, once.)
    let caps: Vec<Capacity> = cat.species.iter().map(|sp| capacity(sp, ground, land)).collect();
    // (And what each field's sources add to each cell.)
    let sources: Vec<Vec<i64>> = cat.fields.iter().map(|f| field_sources(f, ground, land)).collect();
    // (All a field's day takes from which day it is, is the scale on its sources. So a field that comes back, under
    // one scale, to what it was a few days before goes round the same few states for as long as the scale stays: they
    // are kept and those days aren't worked out again. A field that has settled is the round of one.)
    let mut rounds: Vec<Round> = cat.fields.iter().map(|_| Round::default()).collect();
    for day in first_day..first_day + days {
        for (k, f) in cat.fields.iter().enumerate() {
            let scale = source_scale(f, day);
            let round = &mut rounds[k];
            if round.scale != Some(scale) {
                *round = Round { scale: Some(scale), ..Round::default() };
            }
            if round.closed {
                // (The oldest kept is the next of the round.)
                round.states.rotate_left(1);
                fields[k].clone_from(round.states.last().expect("a round has a state"));
                continue;
            }
            let next = step_field_from(f, ground, &sources[k], std::mem::take(&mut fields[k]), day);
            match round.states.iter().position(|was| *was == next) {
                Some(at) => {
                    round.states.drain(..at);
                    round.states.rotate_left(1);
                    round.closed = true;
                }
                None => {
                    if round.states.len() == ROUND_KEPT {
                        round.states.remove(0);
                    }
                    round.states.push(next.clone());
                }
            }
            fields[k] = next;
        }
        let values: Vec<(&str, &[i64])> = cat.fields.iter().zip(&fields).map(|(f, v)| (f.id.as_str(), v.as_slice())).collect();
        for (k, sp) in cat.species.iter().enumerate() {
            if st.extinct.contains_key(&sp.id) {
                continue;
            }
            let mut rng = randomness.stream(&["nature", &sp.id, &day.to_string()]);
            let had_any = !pops[k].living.is_empty();
            pops[k].day(sp, ground, &caps[k], &values, &mut rng);
            if pops[k].living.is_empty() && had_any {
                st.extinct.insert(sp.id, day);
                gone.push(sp.id);
            }
        }
    }
    for (f, v) in cat.fields.iter().zip(&fields) {
        let m = sparse(v, ground, f.baseline);
        if m.is_empty() { st.fields.remove(&f.id); } else { st.fields.insert(f.id, m); }
    }
    for (sp, v) in cat.species.iter().zip(&pops) {
        let m = sparse(&v.dense, ground, 0);
        if m.is_empty() { st.populations.remove(&sp.id); } else { st.populations.insert(sp.id, m); }
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
        c.species.insert(sp.id, (m.map_or(0, |m| m.values().sum()), m.map_or(0, |m| m.len() as i64)));
    }
    for cover in &land.cover {
        *c.covers.entry(*cover).or_insert(0) += 1;
    }
    c
}

/// A cell's cover: its building's (the type's cover, else `built`), or unbuilt, its terrain, else the world's default.
pub fn cover_of(cat: &Catalogue, terrain: Option<&str>, building_cover: Option<Option<&str>>) -> Id {
    match building_cover {
        Some(c) => c.unwrap_or(COVER_BUILT).to_string().into(),
        None => (terrain.or(cat.default_cover.as_deref()).unwrap_or(COVER_OPEN).to_string()).into(),
    }
}

#[cfg(test)]
mod tests;
