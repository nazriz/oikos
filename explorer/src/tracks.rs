//! Time: what the scene needs of the tracks at a moment, streamed by window, and where everyone is drawn.
//!
//! The data layer gives, per day, where everyone is at midnight (`where`) and the day's moves (`moves`). The scene
//! holds only a window of days round the moment shown (`Window`), asks for what it lacks, and lets the rest go, so a
//! year of 50,000 people is never in memory at once. `Crowd` is everyone's state at the moment: the space they are in,
//! and the trips under way, each drawn along the roads (layout.rs: a visual only).
//! Pure: no Bevy, no I/O.

use crate::data::{Move, DAY};
use crate::layout::{Layout, Route};
use std::collections::{BTreeMap, HashMap};

/// Days of moves asked for at once.
pub const CHUNK: i64 = 4;

/// What the scene asks the data layer for (`track_bytes`): the `where` keyframes or the moves, days `[from, to)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Need {
    Where { from: i64, to: i64 },
    Moves { from: i64, to: i64 },
}

/// The days of tracks held: midnight keyframes by day and moves by chunk of days. Asked for ahead of the moment shown
/// and dropped once far behind it.
pub struct Window {
    pub persons: usize,
    pub days: i64,
    pub where_: HashMap<i64, Vec<u32>>,
    pub moves: HashMap<i64, Chunk>,
    pub asked: std::collections::HashSet<Need>,
    /// Days of keyframes and chunks of moves kept either side of the moment.
    pub keep_days: i64,
}

/// A chunk of days' moves, each with the end of the trip it begins (for a move out of a space: when and where the same
/// person next comes in, if within the chunk and the same day or the next).
pub struct Chunk {
    pub moves: Vec<Move>,
    pub next_in: Vec<Option<(i64, u32)>>,
}

impl Chunk {
    pub fn new(moves: Vec<Move>) -> Chunk {
        let mut next_in = vec![None; moves.len()];
        let mut seen: HashMap<u32, (i64, u32)> = HashMap::new();
        for i in (0..moves.len()).rev() {
            let m = moves[i];
            if m.s1 == 0 {
                if let Some(&(t, s)) = seen.get(&m.person) {
                    if t - m.t <= DAY {
                        next_in[i] = Some((t, s));
                    }
                }
            } else {
                seen.insert(m.person, (m.t, m.s1));
            }
        }
        Chunk { moves, next_in }
    }
}

impl Window {
    pub fn new(persons: usize, days: i64) -> Window {
        Window { persons, days, where_: HashMap::new(), moves: HashMap::new(), asked: Default::default(), keep_days: 6 }
    }
    pub fn chunk_of(day: i64) -> i64 {
        day.div_euclid(CHUNK)
    }
    pub fn day_of(&self, t: i64) -> i64 {
        t.div_euclid(DAY).clamp(0, self.days)
    }

    /// What is missing for the moment `t` and a little ahead (not yet asked for).
    pub fn wants(&mut self, t: i64) -> Vec<Need> {
        let d = self.day_of(t);
        let mut out = vec![];
        // the keyframe of today (and of the next few days, for scrubbing forward), asked for a chunk at a time
        let c = Self::chunk_of(d);
        for cc in [c, c + 1] {
            let (from, to) = (cc * CHUNK, ((cc + 1) * CHUNK).min(self.days + 1));
            if from > self.days {
                continue;
            }
            let wn = Need::Where { from, to };
            if (from..to).any(|x| !self.where_.contains_key(&x)) && !self.asked.contains(&wn) {
                out.push(wn);
            }
            let mn = Need::Moves { from, to };
            if !self.moves.contains_key(&cc) && !self.asked.contains(&mn) {
                out.push(mn);
            }
        }
        for n in &out {
            self.asked.insert(*n);
        }
        out
    }

    /// Takes the data layer's answer to a need. An answer short of the days asked (the log not yet read so far) stays
    /// asked, so it is not asked again every frame; `forget_from` asks again once more of the log is read.
    pub fn take(&mut self, n: Need, bytes: &[u8]) {
        let mut short = false;
        match n {
            Need::Where { from, to } => {
                let v = crate::data::u32s(bytes);
                let p = self.persons.max(1);
                // (the TS index answers the whole track whatever the window: then the window's days are read from it)
                let skip = if v.len() == (self.days as usize + 1) * p && to - from < self.days + 1 { from.max(0) as usize } else { 0 };
                for (i, d) in (from..to).enumerate() {
                    match v.get((skip + i) * p..(skip + i + 1) * p) {
                        Some(s) => {
                            self.where_.insert(d, s.to_vec());
                        }
                        None => short = true,
                    }
                }
            }
            Need::Moves { from, .. } => {
                self.moves.insert(Self::chunk_of(from), Chunk::new(crate::data::moves(bytes)));
            }
        }
        if !short {
            self.asked.remove(&n);
        }
    }

    /// More of the log has been read (an index still being made): what was taken from day `day` on may have been
    /// partial, so it is dropped and asked for again; the run may have grown to `days`.
    pub fn forget_from(&mut self, day: i64, days: i64) {
        self.days = days;
        self.where_.retain(|&d, _| d < day);
        self.moves.retain(|&c, _| (c + 1) * CHUNK <= day);
        self.asked.clear();
    }

    /// Lets go of what is far from `t`.
    pub fn evict(&mut self, t: i64) {
        let d = self.day_of(t);
        let k = self.keep_days;
        self.where_.retain(|&x, _| (x - d).abs() <= k);
        let c = Self::chunk_of(d);
        let kc = (k / CHUNK).max(1);
        self.moves.retain(|&x, _| (x - c).abs() <= kc);
    }

    /// Is everything there to show the moment `t` exactly?
    pub fn ready(&self, t: i64) -> bool {
        let d = self.day_of(t);
        self.where_.contains_key(&d) && self.moves.contains_key(&Self::chunk_of(d))
    }

    /// Bytes held (tracks only).
    pub fn bytes(&self) -> usize {
        self.where_.values().map(|v| v.len() * 4).sum::<usize>() + self.moves.values().map(|c| c.moves.len() * 24).sum::<usize>()
    }
}

/// A trip under way: drawn along its route from `t0` until `t1` (or for at least the visual minimum).
#[derive(Debug, Clone)]
pub struct Trip {
    pub person: u32,
    pub from_st: usize,
    pub to_st: usize,
    pub t0: i64,
    pub t1: i64,
    pub y0: f32,
    pub y1: f32,
    pub route: Route,
    /// Begun on arrival (the log gave no time out first): drawn after the fact.
    pub after: bool,
}

/// Everyone's state at the moment shown.
pub struct Crowd {
    pub persons: usize,
    /// The space each person is in (index + 1, 0 none).
    pub cur: Vec<u32>,
    /// The last space each was in (to draw a hop from when no time out was logged).
    pub last: Vec<u32>,
    /// Trips under way, by person.
    pub trips: BTreeMap<u32, Trip>,
    pub t: i64,
    /// The day and the index in that day's chunk of the next move to apply.
    pub cursor: Option<(i64, usize)>,
    /// People whose drawn place changed since it was last read (a move, a trip begun or ended).
    pub dirty: Vec<u32>,
    pub all_dirty: bool,
}

impl Crowd {
    pub fn new(persons: usize) -> Crowd {
        Crowd {
            persons,
            cur: vec![0; persons],
            last: vec![0; persons],
            trips: BTreeMap::new(),
            t: 0,
            cursor: None,
            dirty: vec![],
            all_dirty: true,
        }
    }

    /// Jumps to `t`: midnight's keyframe, then the day's moves up to t. False if the window lacks them.
    pub fn seek(&mut self, w: &Window, l: &Layout, t: i64) -> bool {
        let d = w.day_of(t);
        let Some(key) = w.where_.get(&d) else {
            return false;
        };
        if !w.moves.contains_key(&Window::chunk_of(d)) {
            return false;
        }
        self.cur.copy_from_slice(&key[..self.persons.min(key.len())]);
        self.last.copy_from_slice(&self.cur);
        self.trips.clear();
        self.all_dirty = true;
        self.t = d * DAY;
        self.cursor = Some((d, first_of_day(w, d)));
        self.advance(w, l, t, 0);
        // (a trip that ended before the moment is not shown after a jump)
        self.trips.retain(|_, x| x.t1 > t);
        true
    }

    /// Moves forward to `t`, applying the moves on the way. `vis`: the least a trip is drawn for, in world seconds
    /// (so that at speed a hop is still seen). Stops where the window has no moves yet; returns whether it got to t.
    pub fn advance(&mut self, w: &Window, l: &Layout, t: i64, vis: i64) -> bool {
        let Some((mut day, mut i)) = self.cursor else {
            return false;
        };
        let mut complete = true;
        'outer: loop {
            let Some(ch) = w.moves.get(&Window::chunk_of(day)) else {
                complete = false;
                break;
            };
            while i < ch.moves.len() {
                let m = ch.moves[i];
                if m.t > t {
                    break 'outer;
                }
                self.apply(l, m, ch.next_in[i], vis);
                i += 1;
            }
            // the chunk is used up: on to the next once the moment has reached it (the cursor waits at the end)
            let next = (Window::chunk_of(day) + 1) * CHUNK;
            if next > w.days || next * DAY > t {
                break;
            }
            day = next;
            i = 0;
        }
        self.cursor = Some((day, i));
        self.t = t;
        complete
    }

    fn apply(&mut self, l: &Layout, m: Move, next_in: Option<(i64, u32)>, vis: i64) {
        let p = m.person;
        let pi = p as usize;
        if pi >= self.persons {
            return;
        }
        self.dirty.push(p);
        if m.s1 == 0 {
            let from = self.cur[pi];
            self.cur[pi] = 0;
            if from != 0 {
                self.last[pi] = from;
            }
            if let (Some(a), Some((t1, to))) = (l.struct_of_space(from), next_in) {
                if let Some(b) = l.struct_of_space(to) {
                    if a != b {
                        self.begin(l, p, a, b, m.t, t1, false);
                    }
                }
            }
            return;
        }
        let to = l.struct_of_space(m.s1);
        let under_way = self.trips.get(&p).map(|x| Some(x.to_st) == to).unwrap_or(false);
        if !under_way {
            self.trips.remove(&p);
            let from = l.struct_of_space(if self.cur[pi] != 0 { self.cur[pi] } else { self.last[pi] });
            if let (Some(a), Some(b)) = (from, to) {
                if a != b && vis > 0 {
                    self.begin(l, p, a, b, m.t, m.t + vis, true);
                }
            }
        }
        self.cur[pi] = m.s1;
        self.last[pi] = m.s1;
    }

    #[allow(clippy::too_many_arguments)]
    fn begin(&mut self, l: &Layout, p: u32, a: usize, b: usize, t0: i64, t1: i64, after: bool) {
        let route = l.route(a, b);
        if route.pts.len() < 2 {
            return;
        }
        let y0 = l.placed[a].map(|x| x.top).unwrap_or(0.0);
        let y1 = l.placed[b].map(|x| x.top).unwrap_or(0.0);
        self.trips.insert(p, Trip { person: p, from_st: a, to_st: b, t0, t1: t1.max(t0 + 1), y0, y1, route, after });
    }

    /// Where person p is drawn at the crowd's moment (`vis`: the least a trip lasts on screen, in world seconds), or
    /// None (in no building and not under way).
    pub fn pos(&self, l: &Layout, p: u32, vis: i64) -> Option<([f32; 3], bool)> {
        if let Some(tr) = self.trips.get(&p) {
            let dur = (tr.t1 - tr.t0).max(vis).max(1) as f32;
            let k = (self.t - tr.t0) as f32 / dur;
            if (0.0..1.0).contains(&k) {
                let (x, z) = tr.route.at(ease(k));
                // down from the roof, along the road, up onto the next roof
                let road = 0.08;
                let y = if k < 0.12 {
                    mix(tr.y0, road, k / 0.12)
                } else if k > 0.88 {
                    mix(road, tr.y1, (k - 0.88) / 0.12)
                } else {
                    road
                };
                return Some(([x, y + 0.06, z], true));
            }
        }
        let s1 = self.cur[p as usize];
        if s1 == 0 {
            return None;
        }
        l.slot(p, s1).map(|(x, y, z)| ([x, y, z], false))
    }

    /// Ends the trips that are over at the moment (keeping those still drawn for the visual minimum), marking those
    /// people dirty. Returns how many are under way.
    pub fn settle(&mut self, vis: i64) -> usize {
        let t = self.t;
        let mut ended = vec![];
        for (p, tr) in &self.trips {
            if t >= tr.t0 + (tr.t1 - tr.t0).max(vis) {
                ended.push(*p);
            }
        }
        for p in ended {
            self.trips.remove(&p);
            self.dirty.push(p);
        }
        self.trips.len()
    }
}

fn first_of_day(w: &Window, d: i64) -> usize {
    match w.moves.get(&Window::chunk_of(d)) {
        Some(ch) => ch.moves.partition_point(|m| m.t < d * DAY),
        None => 0,
    }
}

fn ease(k: f32) -> f32 {
    k * k * (3.0 - 2.0 * k)
}
fn mix(a: f32, b: f32, k: f32) -> f32 {
    a + (b - a) * k.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::{Ground, Meta, Structure, World, WorldData};

    fn world() -> WorldData {
        let st = |id: &str, ty: &str, x: i64, y: i64| Structure {
            id: id.into(),
            type_: ty.into(),
            category: "residential".into(),
            x,
            y,
            w: 1.0,
            h: 1.0,
            spaces: 1,
            levels: 1.0,
        };
        let mut s = vec![st("home", "house", 0, 0), st("work", "shop", 4, 0)];
        for x in 0..5 {
            s.push(st("r", "road", x, 1));
        }
        WorldData {
            meta: Meta { persons: 2, days: 8, spaces: vec![(0, "dwelling".into(), 1), (1, "workplace".into(), 1)], ..Default::default() },
            world: World { ground: Ground { w: 5, h: 2, cell: 1.0, terrain: vec![] }, structures: s, ..Default::default() },
            ..Default::default()
        }
    }
    fn bytes_u32(v: &[u32]) -> Vec<u8> {
        v.iter().flat_map(|x| x.to_le_bytes()).collect()
    }
    fn bytes_moves(v: &[(i64, u32, u32)]) -> Vec<u8> {
        v.iter().flat_map(|&(t, p, s)| [t as i32, p as i32, s as i32]).flat_map(|x| x.to_le_bytes()).collect()
    }

    /// Person 0 leaves home at 8:00 on day 0, is at work at 8:30, and goes home at 17:00 with no time out logged.
    fn window() -> Window {
        let mut w = Window::new(2, 8);
        assert_eq!(
            w.wants(0),
            vec![
                Need::Where { from: 0, to: 4 },
                Need::Moves { from: 0, to: 4 },
                Need::Where { from: 4, to: 8 },
                Need::Moves { from: 4, to: 8 }
            ]
        );
        assert!(w.wants(0).is_empty(), "asked once");
        w.take(Need::Where { from: 0, to: 4 }, &bytes_u32(&[1, 1, 1, 1, 1, 1, 1, 1]));
        w.take(Need::Moves { from: 0, to: 4 }, &bytes_moves(&[(8 * 3600, 0, 0), (8 * 3600 + 1800, 0, 2), (17 * 3600, 0, 1)]));
        w
    }

    #[test]
    fn the_window_asks_for_what_it_lacks_and_lets_go_of_the_far_past() {
        let mut w = window();
        assert!(w.ready(3600));
        assert!(!w.ready(5 * DAY));
        w.take(Need::Where { from: 4, to: 8 }, &bytes_u32(&[1; 8]));
        w.take(Need::Moves { from: 4, to: 8 }, &[]);
        // a log still being read: what it lacks stays asked (not asked again every frame) until more is read
        let mut p = Window::new(2, 8);
        p.wants(0);
        p.take(Need::Where { from: 0, to: 4 }, &bytes_u32(&[1, 1, 1, 1]));
        assert!(p.where_.contains_key(&1) && !p.where_.contains_key(&2));
        assert!(!p.wants(0).contains(&Need::Where { from: 0, to: 4 }));
        p.forget_from(1, 9);
        assert!(p.where_.contains_key(&0) && !p.where_.contains_key(&1) && p.days == 9);
        assert!(p.wants(0).contains(&Need::Where { from: 0, to: 4 }));
        w.keep_days = 1;
        w.evict(7 * DAY);
        assert!(!w.where_.contains_key(&0) && w.where_.contains_key(&7));
        assert!(w.moves.contains_key(&1) && !w.moves.contains_key(&0) || w.moves.len() <= 2);
    }

    #[test]
    fn a_trip_out_and_in_is_drawn_along_the_roads_between_the_two_times() {
        let w = window();
        let l = Layout::new(&world());
        let mut c = Crowd::new(2);
        assert!(c.seek(&w, &l, 7 * 3600));
        assert_eq!(c.cur, vec![1, 1]);
        let home = c.pos(&l, 0, 0).unwrap();
        assert!(!home.1);
        // under way at 8:15: on the road (y near the road), between the two
        assert!(c.advance(&w, &l, 8 * 3600 + 900, 0));
        assert_eq!(c.cur[0], 0);
        let (p, moving) = c.pos(&l, 0, 0).unwrap();
        assert!(moving && p[1] < 0.3 && p[0] > 0.5 && p[0] < 4.5, "{p:?}");
        // arrived: at work, the trip over
        c.advance(&w, &l, 9 * 3600, 0);
        c.settle(0);
        assert_eq!(c.cur[0], 2);
        assert!(c.trips.is_empty());
        let (p, moving) = c.pos(&l, 0, 0).unwrap();
        assert!(!moving && p[0] > 4.0);
        // home with no time out logged: a hop drawn after the fact, for the visual minimum only
        c.advance(&w, &l, 17 * 3600 + 60, 600);
        assert!(c.trips.get(&0).map(|t| t.after).unwrap_or(false));
        assert!(c.pos(&l, 0, 600).unwrap().1);
        c.advance(&w, &l, 17 * 3600 + 700, 600);
        c.settle(600);
        assert!(!c.pos(&l, 0, 600).unwrap().1);
        assert_eq!(c.cur[0], 1);
    }

    #[test]
    fn a_jump_gives_the_same_state_as_playing_up_to_it() {
        let w = window();
        let l = Layout::new(&world());
        let mut a = Crowd::new(2);
        a.seek(&w, &l, 0);
        for t in (0..20 * 3600).step_by(600) {
            a.advance(&w, &l, t, 0);
            a.settle(0);
        }
        let mut b = Crowd::new(2);
        b.seek(&w, &l, 20 * 3600 - 600);
        assert_eq!(a.cur, b.cur);
        assert_eq!(a.trips.len(), b.trips.len());
    }

    #[test]
    fn without_the_moves_the_crowd_waits() {
        let mut w = Window::new(2, 8);
        w.take(Need::Where { from: 0, to: 4 }, &bytes_u32(&[1; 8]));
        let l = Layout::new(&world());
        assert!(!Crowd::new(2).seek(&w, &l, 3600));
    }
}
