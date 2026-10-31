//! Geometry on the ground: rectangles of cells, the gap between them, and
//! where a body is (the buildings it's in). Integer only.

use crate::config::cell_xy;
use crate::state::State;
use crate::statics::Statics;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

impl Rect {
    pub fn cell(x: i64, y: i64) -> Rect {
        Rect { x, y, w: 1, h: 1 }
    }
}

/// Are two rectangles within `n` of each other? The distance is the gap between them (0 when they
/// touch, at a side or a corner), straight-line, in cells.
pub fn within(a: Rect, b: Rect, n: i64) -> bool {
    let gap = |a0: i64, a1: i64, b0: i64, b1: i64| (a0.max(b0) as i128 - a1.min(b1) as i128).max(0);
    let dx = gap(a.x, a.x + a.w, b.x, b.x + b.w);
    let dy = gap(a.y, a.y + a.h, b.y, b.y + b.h);
    dx * dx + dy * dy <= n as i128 * n as i128
}

/// The footprint of a structure, as a rectangle.
pub fn structure_rect(s: &Statics, st: &State, structure: &str) -> Option<Rect> {
    let x = st.structures.get(structure)?;
    let (cx, cy) = cell_xy(&x.at)?;
    let f = s.types.get(x.structure_type.as_str())?.footprint;
    Some(Rect { x: cx, y: cy, w: f.w, h: f.h })
}

/// Where a body is: the footprints of the buildings it's in. Empty when it's in none (then it's
/// nowhere in particular, and nothing is near it).
pub fn body_rects(s: &Statics, st: &State, person: &str) -> Vec<Rect> {
    st.structures_of(person).iter().filter_map(|sid| structure_rect(s, st, sid)).collect()
}

/// Are two bodies within `reach` of each other?
pub fn bodies_near(s: &Statics, st: &State, a: &str, b: &str, reach: i64) -> bool {
    let (ra, rb) = (body_rects(s, st, a), body_rects(s, st, b));
    ra.iter().any(|x| rb.iter().any(|y| within(*x, *y, reach)))
}
