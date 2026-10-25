//! Where things are drawn: each structure's box (footprint, height by its spaces' levels, colour by its category),
//! where a person stands inside a building, and the road network people are drawn along between places.
//!
//! **The routes are a visual only.** The log says where people are (`occupied` / `vacated`), never how they got there.
//! A trip is drawn along the roads by the shortest path between the two buildings' nearest road cells, so the town reads
//! as people moving through it; nothing is inferred from it, and no measure may read it (docs/explorer.md, "Bevy").
//! Pure: no Bevy, no I/O.

use crate::data::WorldData;
use std::collections::{HashMap, VecDeque};

/// Flat structures: drawn on the ground, not as boxes.
pub fn is_flat(type_: &str) -> bool {
    matches!(type_, "road" | "park")
}

/// The categories' palette (renderer/src/client/api.ts `CATEGORY`, kept as the base): wall and roof, sRGB.
pub fn category_colors(cat: &str) -> ([u8; 3], [u8; 3]) {
    match cat {
        "residential" => ([0xef, 0xe4, 0xcf], [0xc0, 0x64, 0x4a]),
        "commercial" => ([0xcf, 0xe0, 0xf2], [0x5b, 0x7f, 0xa8]),
        "industrial" => ([0xd6, 0xcb, 0xbb], [0x7b, 0x6a, 0x58]),
        "civic" => ([0xf4, 0xdc, 0xae], [0xc9, 0x95, 0x2f]),
        "health" => ([0xf7, 0xd7, 0xdc], [0xc2, 0x5b, 0x6d]),
        "education" => ([0xdb, 0xec, 0xcb], [0x6c, 0x9a, 0x43]),
        "utility" => ([0xc9, 0xce, 0xd8], [0x6c, 0x76, 0x88]),
        "transport" => ([0xc7, 0xbe, 0xb6], [0x7d, 0x70, 0x68]),
        _ => ([0xdd, 0xdd, 0xdd], [0x88, 0x88, 0x88]),
    }
}

/// Terrain colours (as the Three.js client paints the ground), sRGB.
pub fn terrain_color(label: &str) -> [u8; 3] {
    match label {
        "farmland" => [0xc4, 0xb0, 0x6a],
        "woodland" => [0x4c, 0x7a, 0x47],
        "scrub" => [0x97, 0xa4, 0x6a],
        "wetland" => [0x6c, 0x98, 0x86],
        "riverbank" => [0x79, 0xaa, 0xa0],
        "cleared" => [0xb4, 0xa3, 0x82],
        "built" => [0xbd, 0xb4, 0xa3],
        "water" => [0x3f, 0x7f, 0xb4],
        _ => [0x86, 0xad, 0x66],
    }
}

/// Height of one level, in cells.
pub const LEVEL: f32 = 0.55;

/// A structure as drawn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placed {
    /// Centre on the ground (x, z), in cells.
    pub cx: f32,
    pub cz: f32,
    /// The box's footprint (x, z) and wall height; a flat one has height 0.
    pub fw: f32,
    pub fd: f32,
    pub h: f32,
    /// Where a person inside stands (the roof).
    pub top: f32,
    pub flat: bool,
}

/// The fixed hash the Three.js client places people with (a slot inside the building, stable per person).
pub fn hash01(n: u32) -> f32 {
    let mut x = n.wrapping_add(0x9e37_79b9);
    x = (x ^ (x >> 16)).wrapping_mul(0x85eb_ca6b);
    x = (x ^ (x >> 13)).wrapping_mul(0xc2b2_ae35);
    ((x ^ (x >> 16)) as f64 / 4_294_967_296.0) as f32
}

pub struct Layout {
    pub w: i64,
    pub h: i64,
    /// Per structure (world's first, then the extra ones, which are not placed).
    pub placed: Vec<Option<Placed>>,
    /// Per space: its structure.
    pub space_struct: Vec<i32>,
    /// Per space: 0 dwelling, 1 workplace, 2 other.
    pub space_kind: Vec<u8>,
    /// Where the outside world's offices act from: a point at the edge of the town.
    pub gate: (f32, f32),
    pub roads: Roads,
    /// Per structure, the road cell it is reached from (if any).
    pub access: Vec<Option<u32>>,
}

impl Layout {
    pub fn new(d: &WorldData) -> Layout {
        let g = &d.world.ground;
        let n = d.structure_count();
        let mut placed = vec![None; n];
        for (i, s) in d.world.structures.iter().enumerate() {
            let flat = is_flat(&s.type_);
            let k = if s.category == "industrial" { 0.86 } else { 0.74 };
            let h = if flat { 0.0 } else { (s.levels.max(1.0) as f32) * LEVEL };
            placed[i] = Some(Placed {
                cx: s.x as f32 + s.w as f32 / 2.0,
                cz: s.y as f32 + s.h as f32 / 2.0,
                fw: s.w as f32 * if flat { 1.0 } else { k },
                fd: s.h as f32 * if flat { 1.0 } else { k },
                h,
                top: if flat { 0.04 } else { h + 0.08 },
                flat,
            });
        }
        let space_struct = d.meta.spaces.iter().map(|x| x.0 as i32).collect();
        let space_kind = d
            .meta
            .spaces
            .iter()
            .map(|x| match x.1.as_str() {
                "dwelling" => 0,
                "workplace" => 1,
                _ => 2,
            })
            .collect();
        let roads = Roads::new(d);
        let access = (0..n).map(|i| placed[i].and_then(|p: Placed| roads.nearest(&d.world.structures[i], p))).collect();
        Layout { w: g.w, h: g.h, placed, space_struct, space_kind, gate: (-5.0, g.h as f32 * 0.5), roads, access }
    }

    /// The point on the ground and the height of a structure (the gate for one not placed).
    pub fn pos_of(&self, st: i64) -> (f32, f32, f32) {
        match usize::try_from(st).ok().and_then(|i| self.placed.get(i).copied().flatten()) {
            Some(p) => (p.cx, p.top, p.cz),
            None => (self.gate.0, 4.0, self.gate.1),
        }
    }

    /// Where person `p` stands in space `s1 - 1`: a fixed slot inside the building's roof.
    pub fn slot(&self, p: u32, s1: u32) -> Option<(f32, f32, f32)> {
        let st = *self.space_struct.get(s1.checked_sub(1)? as usize)?;
        let pl = self.placed.get(usize::try_from(st).ok()?).copied().flatten()?;
        let a = hash01(p.wrapping_mul(7).wrapping_add(1)) * std::f32::consts::TAU;
        let r = hash01(p.wrapping_mul(13).wrapping_add(5)).sqrt() * 0.32 * pl.fw.min(pl.fd).min(1.6);
        Some((pl.cx + a.cos() * r, pl.top + 0.06, pl.cz + a.sin() * r))
    }

    pub fn struct_of_space(&self, s1: u32) -> Option<usize> {
        let st = *self.space_struct.get(s1.checked_sub(1)? as usize)?;
        usize::try_from(st).ok()
    }

    /// The bounds of what is built (not roads), for framing the view: (x0, z0, x1, z1).
    pub fn built_bounds(&self, d: &WorldData) -> Option<(f32, f32, f32, f32)> {
        let mut b: Option<(f32, f32, f32, f32)> = None;
        for s in d.world.structures.iter().filter(|s| s.type_ != "road") {
            let (x0, z0, x1, z1) = (s.x as f32, s.y as f32, s.x as f32 + s.w as f32, s.y as f32 + s.h as f32);
            b = Some(match b {
                None => (x0, z0, x1, z1),
                Some(c) => (c.0.min(x0), c.1.min(z0), c.2.max(x1), c.3.max(z1)),
            });
        }
        b
    }

    /// The structure on a ground cell (the topmost box first), for picking.
    pub fn structure_at(&self, d: &WorldData, x: f32, z: f32) -> Option<usize> {
        let mut best: Option<(usize, bool)> = None;
        for (i, s) in d.world.structures.iter().enumerate() {
            if x >= s.x as f32 && x < s.x as f32 + s.w as f32 && z >= s.y as f32 && z < s.y as f32 + s.h as f32 {
                let flat = is_flat(&s.type_);
                if best.map(|b| b.1 && !flat).unwrap_or(true) {
                    best = Some((i, flat));
                }
            }
        }
        best.map(|b| b.0)
    }
}

/// The road network: road structures' cells as a grid, walked four ways.
pub struct Roads {
    pub w: i64,
    pub h: i64,
    /// Per cell: is it road?
    pub road: Vec<bool>,
    /// Shortest-path trees towards a road cell (the parent's direction per cell, 255 none), cached by root.
    cache: std::sync::Mutex<TreeCache>,
}

struct TreeCache {
    trees: HashMap<u32, (u64, std::sync::Arc<Vec<u8>>)>,
    clock: u64,
    cap: usize,
}

const DIRS: [(i64, i64); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

impl Roads {
    pub fn new(d: &WorldData) -> Roads {
        let (w, h) = (d.world.ground.w.max(1), d.world.ground.h.max(1));
        let mut road = vec![false; (w * h) as usize];
        for s in d.world.structures.iter().filter(|s| s.type_ == "road") {
            for y in s.y..s.y + (s.h.ceil() as i64).max(1) {
                for x in s.x..s.x + (s.w.ceil() as i64).max(1) {
                    if x >= 0 && y >= 0 && x < w && y < h {
                        road[(y * w + x) as usize] = true;
                    }
                }
            }
        }
        // About 20 MB of trees at 10,000 road cells and 2,000 trees; fewer for a bigger grid.
        let cap = (20_000_000 / road.len().max(1)).clamp(64, 4096);
        Roads { w, h, road, cache: std::sync::Mutex::new(TreeCache { trees: HashMap::new(), clock: 0, cap }) }
    }

    pub fn cell(&self, c: u32) -> (i64, i64) {
        (c as i64 % self.w, c as i64 / self.w)
    }

    /// The road cell nearest a structure's footprint (searched outward from its edge).
    pub fn nearest(&self, s: &crate::data::Structure, _p: Placed) -> Option<u32> {
        if !self.road.iter().any(|&r| r) {
            return None;
        }
        let (x0, y0) = (s.x, s.y);
        let (x1, y1) = (s.x + (s.w.ceil() as i64).max(1) - 1, s.y + (s.h.ceil() as i64).max(1) - 1);
        for r in 0..(self.w.max(self.h)) {
            let mut best: Option<(i64, u32)> = None;
            for y in (y0 - r)..=(y1 + r) {
                for x in (x0 - r)..=(x1 + r) {
                    if x < 0 || y < 0 || x >= self.w || y >= self.h {
                        continue;
                    }
                    let on_ring = x == x0 - r || x == x1 + r || y == y0 - r || y == y1 + r;
                    if !on_ring || !self.road[(y * self.w + x) as usize] {
                        continue;
                    }
                    let (cx, cy) = ((x0 + x1) as f64 / 2.0, (y0 + y1) as f64 / 2.0);
                    let dist = ((x as f64 - cx).powi(2) + (y as f64 - cy).powi(2) * 1.0001) as i64;
                    if best.map(|b| dist < b.0).unwrap_or(true) {
                        best = Some((dist, (y * self.w + x) as u32));
                    }
                }
            }
            if let Some(b) = best {
                return Some(b.1);
            }
        }
        None
    }

    /// The breadth-first tree of the road network towards `root`: per cell, which way to step (an index into DIRS),
    /// 254 at the root, 255 unreachable.
    fn tree(&self, root: u32) -> std::sync::Arc<Vec<u8>> {
        {
            let mut c = self.cache.lock().unwrap();
            c.clock += 1;
            let now = c.clock;
            if let Some(t) = c.trees.get_mut(&root) {
                t.0 = now;
                return t.1.clone();
            }
        }
        let n = self.road.len();
        let mut dir = vec![255u8; n];
        let mut q = VecDeque::new();
        dir[root as usize] = 254;
        q.push_back(root);
        while let Some(c) = q.pop_front() {
            let (x, y) = self.cell(c);
            for (k, (dx, dy)) in DIRS.iter().enumerate() {
                let (nx, ny) = (x + dx, y + dy);
                if nx < 0 || ny < 0 || nx >= self.w || ny >= self.h {
                    continue;
                }
                let ni = (ny * self.w + nx) as usize;
                if self.road[ni] && dir[ni] == 255 {
                    // (from ni, step back the way we came: the opposite of k)
                    dir[ni] = (k ^ 1) as u8;
                    q.push_back(ni as u32);
                }
            }
        }
        let t = std::sync::Arc::new(dir);
        let mut c = self.cache.lock().unwrap();
        if c.trees.len() >= c.cap {
            if let Some(old) = c.trees.iter().min_by_key(|x| x.1 .0).map(|x| *x.0) {
                c.trees.remove(&old);
            }
        }
        let now = c.clock;
        c.trees.insert(root, (now, t.clone()));
        t
    }

    /// The cells from `a` to `b` along the roads (both road cells), turning points only; None if not connected.
    pub fn path(&self, a: u32, b: u32) -> Option<Vec<(i64, i64)>> {
        if a == b {
            return Some(vec![self.cell(a)]);
        }
        let tree = self.tree(b);
        if tree[a as usize] == 255 {
            return None;
        }
        let mut out = vec![self.cell(a)];
        let mut c = a;
        let mut last_dir = 255u8;
        let mut guard = 0;
        while tree[c as usize] != 254 {
            let k = tree[c as usize];
            let (x, y) = self.cell(c);
            let (dx, dy) = DIRS[k as usize];
            let next = ((y + dy) * self.w + (x + dx)) as u32;
            if k != last_dir && last_dir != 255 {
                out.push((x, y));
            }
            last_dir = k;
            c = next;
            guard += 1;
            if guard > self.road.len() {
                return None;
            }
        }
        out.push(self.cell(b));
        Some(out)
    }
}

/// A drawn route: a polyline on the ground (x, z), and its cumulative lengths.
#[derive(Debug, Clone, PartialEq)]
pub struct Route {
    pub pts: Vec<(f32, f32)>,
    pub cum: Vec<f32>,
}

impl Route {
    pub fn new(pts: Vec<(f32, f32)>) -> Route {
        let mut cum = Vec::with_capacity(pts.len());
        let mut s = 0.0;
        for i in 0..pts.len() {
            if i > 0 {
                s += ((pts[i].0 - pts[i - 1].0).powi(2) + (pts[i].1 - pts[i - 1].1).powi(2)).sqrt();
            }
            cum.push(s);
        }
        Route { pts, cum }
    }
    pub fn len(&self) -> f32 {
        *self.cum.last().unwrap_or(&0.0)
    }
    pub fn is_empty(&self) -> bool {
        self.pts.is_empty()
    }
    /// The point a fraction `k` (0..1) of the way along.
    pub fn at(&self, k: f32) -> (f32, f32) {
        if self.pts.len() < 2 {
            return self.pts.first().copied().unwrap_or((0.0, 0.0));
        }
        let d = k.clamp(0.0, 1.0) * self.len();
        let i = self.cum.partition_point(|&c| c < d).clamp(1, self.pts.len() - 1);
        let (a, b) = (self.pts[i - 1], self.pts[i]);
        let seg = (self.cum[i] - self.cum[i - 1]).max(1e-6);
        let f = ((d - self.cum[i - 1]) / seg).clamp(0.0, 1.0);
        (a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f)
    }
}

impl Layout {
    /// The drawn route between two structures: out of the first to its road, along the roads, into the second. A
    /// straight line where either has no road or the roads do not join. A visual only (see the module's note).
    pub fn route(&self, from: usize, to: usize) -> Route {
        let (Some(a), Some(b)) = (self.placed.get(from).copied().flatten(), self.placed.get(to).copied().flatten()) else {
            return Route::new(vec![]);
        };
        let mut pts = vec![(a.cx, a.cz)];
        if let (Some(ra), Some(rb)) = (self.access[from], self.access[to]) {
            if let Some(cells) = self.roads.path(ra, rb) {
                pts.extend(cells.iter().map(|&(x, y)| (x as f32 + 0.5, y as f32 + 0.5)));
            }
        }
        pts.push((b.cx, b.cz));
        Route::new(pts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::{Ground, Meta, Structure, World};

    fn st(id: &str, ty: &str, x: i64, y: i64, w: f64, h: f64, levels: f64) -> Structure {
        Structure {
            id: id.into(),
            type_: ty.into(),
            category: if ty == "house" { "residential".into() } else { "commercial".into() },
            x,
            y,
            w,
            h,
            spaces: 1,
            levels,
        }
    }

    /// A town of two houses on either side of an L of road:
    /// ```text
    ///  y0: H . . . .
    ///  y1: R R R R .
    ///  y2: . . . R .
    ///  y3: . . . R S
    /// ```
    fn town() -> WorldData {
        let mut structures = vec![st("h", "house", 0, 0, 1.0, 1.0, 2.0), st("s", "shop", 4, 3, 1.0, 1.0, 1.0)];
        for x in 0..4 {
            structures.push(st(&format!("r{x}"), "road", x, 1, 1.0, 1.0, 0.0));
        }
        structures.push(st("r5", "road", 3, 2, 1.0, 1.0, 0.0));
        structures.push(st("r6", "road", 3, 3, 1.0, 1.0, 0.0));
        WorldData {
            meta: Meta { spaces: vec![(0, "dwelling".into(), 1), (1, "workplace".into(), 1)], ..Default::default() },
            world: World { ground: Ground { w: 5, h: 4, cell: 1.0, terrain: vec![] }, structures, ..Default::default() },
            ..Default::default()
        }
    }

    #[test]
    fn buildings_stand_by_their_levels_and_flat_things_lie_flat() {
        let l = Layout::new(&town());
        let h = l.placed[0].unwrap();
        assert_eq!((h.cx, h.cz, h.h), (0.5, 0.5, 2.0 * LEVEL));
        assert!(!h.flat && h.top > h.h);
        let r = l.placed[2].unwrap();
        assert!(r.flat && r.h == 0.0);
        assert_eq!(l.pos_of(99), (l.gate.0, 4.0, l.gate.1), "a structure not placed acts from the gate");
    }

    #[test]
    fn a_person_stands_on_their_building_in_a_stable_slot() {
        let l = Layout::new(&town());
        let a = l.slot(7, 1).unwrap();
        assert_eq!(a, l.slot(7, 1).unwrap());
        assert!((a.0 - 0.5).abs() < 0.5 && (a.2 - 0.5).abs() < 0.5);
        assert!(l.slot(7, 0).is_none() && l.slot(7, 9).is_none());
    }

    #[test]
    fn routes_follow_the_roads_by_the_shortest_path() {
        let l = Layout::new(&town());
        assert_eq!(l.access[0], Some(5), "the house is reached from the road cell below it");
        assert_eq!(l.access[1], Some(3 * 5 + 3), "the shop from the road beside it");
        let r = l.route(0, 1);
        // house centre, its road cell, the corner, the shop's road cell, the shop's centre
        assert_eq!(r.pts, vec![(0.5, 0.5), (0.5, 1.5), (3.5, 1.5), (3.5, 3.5), (4.5, 3.5)]);
        assert!((r.len() - (1.0 + 3.0 + 2.0 + 1.0)).abs() < 1e-5);
        assert_eq!(r.at(0.0), (0.5, 0.5));
        assert_eq!(r.at(1.0), (4.5, 3.5));
        let mid = r.at(0.5); // 3.5 of 7 along: on the top road
        assert!((mid.1 - 1.5).abs() < 1e-5 && (mid.0 - 3.0).abs() < 1e-5, "{mid:?}");
        // the reverse is the same way back, from the cache or not
        assert_eq!(l.route(1, 0).pts.iter().rev().copied().collect::<Vec<_>>(), r.pts);
    }

    #[test]
    fn without_a_joining_road_a_route_is_straight() {
        let mut d = town();
        d.world.structures.retain(|s| s.id != "r5");
        let l = Layout::new(&d);
        assert_eq!(l.route(0, 1).pts, vec![(0.5, 0.5), (4.5, 3.5)]);
    }

    #[test]
    fn picking_finds_the_box_over_the_road() {
        let d = town();
        let l = Layout::new(&d);
        assert_eq!(l.structure_at(&d, 0.5, 0.5), Some(0));
        assert_eq!(l.structure_at(&d, 1.5, 1.2), Some(3));
        assert_eq!(l.structure_at(&d, 4.5, 0.5), None);
    }
}
