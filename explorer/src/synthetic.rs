//! A synthetic town for measuring the scene at scale (`oikos-explorer --synthetic 50000`): a grid of blocks with roads
//! between them, homes and workplaces, and N people who go to work in the morning and home in the evening, each trip
//! logged as the kernel logs it (out of a space, then into another). It is not a run and is never shown as one: it
//! exists so the scene's own cost at 10,000 and 50,000 people can be measured where no such run can be made (a 50,000-
//! person run needs more memory than the machine it was built on). It answers the same requests as the data layer.

use crate::data::{Move, DAY, MOVE_INTS};
use crate::source::{Req, Resp, Source};
use crate::tracks::Need;
use serde_json::json;

pub struct Synthetic {
    pub persons: usize,
    pub days: i64,
    world: String,
    home: Vec<u32>,
    work: Vec<u32>,
}

fn h(n: u64) -> u64 {
    let mut x = n.wrapping_add(0x9e37_79b9_7f4a_7c15);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

impl Synthetic {
    pub fn new(persons: usize, days: i64) -> Synthetic {
        // blocks of 6 by 6 cells, a road round each; four buildings to a block; about 60 people a block
        let blocks = ((persons as f64 / 60.0).sqrt().ceil() as i64).max(2);
        let size = blocks * 7 + 1;
        let mut structures = vec![];
        let mut spaces = vec![];
        let (mut homes, mut works) = (vec![], vec![]);
        for by in 0..blocks {
            for bx in 0..blocks {
                let (x0, y0) = (bx * 7 + 1, by * 7 + 1);
                for (k, (dx, dy)) in [(0, 0), (3, 0), (0, 3), (3, 3)].iter().enumerate() {
                    let work = (bx + by + k as i64) % 4 == 0;
                    let i = structures.len();
                    let levels = 1 + (h((i as u64) << 3) % if work { 3 } else { 7 }) as i64;
                    structures.push(json!({"id": format!("b{i}"), "type": if work { "office" } else { "apartments" }, "category": if work { "commercial" } else { "residential" },
                        "x": x0 + dx, "y": y0 + dy, "w": 3, "h": 3, "spaces": 4, "levels": levels}));
                    for n in 0..4 {
                        let s = spaces.len() as u32 + 1;
                        spaces.push(json!([i, if work { "workplace" } else { "dwelling" }, n]));
                        if work { works.push(s) } else { homes.push(s) }
                    }
                }
            }
        }
        for r in 0..=blocks {
            for c in 0..size {
                for (x, y) in [(c, r * 7), (r * 7, c)] {
                    structures.push(json!({"id": format!("r{x}.{y}"), "type": "road", "category": "transport", "x": x, "y": y, "w": 1, "h": 1, "spaces": 0, "levels": 0}));
                }
            }
        }
        let home: Vec<u32> = (0..persons).map(|p| homes[(h(p as u64) % homes.len() as u64) as usize]).collect();
        let work: Vec<u32> = (0..persons).map(|p| works[(h(p as u64 + 77) % works.len() as u64) as usize]).collect();
        let world = json!({
            "meta": {"runId": format!("synthetic-{persons}"), "days": days, "lastT": days * DAY, "persons": persons, "holders": persons,
                "spaces": spaces, "extraStructures": [], "seats": [], "kept": 0, "lines": 0, "movesDay": [], "pulses": 0, "state": "ready"},
            "world": {"runId": format!("synthetic-{persons}"), "name": "A synthetic town (for measuring the scene)", "description": "",
                "ground": {"w": size, "h": size, "cell": 1, "terrain": []}, "water": [], "lotCells": [], "structures": structures, "orgs": [], "posts": []},
            "persons": (0..persons).map(|p| format!("p{p}")).collect::<Vec<_>>(),
            "seatActs": []
        })
        .to_string();
        Synthetic { persons, days, world, home, work }
    }

    /// Everyone's space at midnight: at home.
    pub fn where_bytes(&self, from: i64, to: i64) -> Vec<u8> {
        let mut out = Vec::with_capacity(((to - from).max(0) as usize) * self.persons * 4);
        for _ in from..to.min(self.days + 1) {
            for &s in &self.home {
                out.extend_from_slice(&s.to_le_bytes());
            }
        }
        out
    }

    /// The days' moves: out of home between 7:00 and 9:00, into work 15 to 45 minutes later; out of work between 16:00
    /// and 18:00, home again 15 to 45 minutes later. In time order, as the log has them.
    pub fn moves(&self, from: i64, to: i64) -> Vec<Move> {
        let mut out = vec![];
        for d in from..to.min(self.days + 1) {
            let mut day = Vec::with_capacity(self.persons * 4);
            for p in 0..self.persons {
                let r = h((p as u64) << 20 | d as u64);
                let leave = d * DAY + 7 * 3600 + (r % 7200) as i64;
                let arrive = leave + 900 + ((r >> 16) % 1800) as i64;
                let back = d * DAY + 16 * 3600 + ((r >> 32) % 7200) as i64;
                let home = back + 900 + ((r >> 48) % 1800) as i64;
                let pp = p as u32;
                day.extend([
                    Move { t: leave, person: pp, s1: 0 },
                    Move { t: arrive, person: pp, s1: self.work[p] },
                    Move { t: back, person: pp, s1: 0 },
                    Move { t: home, person: pp, s1: self.home[p] },
                ]);
            }
            day.sort_by_key(|m| m.t);
            out.extend(day);
        }
        out
    }

    pub fn moves_bytes(&self, from: i64, to: i64) -> Vec<u8> {
        let mut out = Vec::new();
        for m in self.moves(from, to) {
            for v in [m.t as i32, m.person as i32, m.s1 as i32] {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        debug_assert_eq!(out.len() % (MOVE_INTS * 4), 0);
        out
    }
}

impl Source for Synthetic {
    fn ask(&self, _run: &str, req: Req, reply: crossbeam_channel::Sender<Resp>) {
        let r = match req {
            Req::Status => Resp::Status { state: "ready".into(), message: String::new(), header: true },
            Req::World => Resp::World(self.world.clone()),
            Req::Track(n @ Need::Where { from, to }) => Resp::Track(n, self.where_bytes(from, to)),
            Req::Track(n @ Need::Moves { from, to }) => Resp::Track(n, self.moves_bytes(from, to)),
            Req::Bin(name) => Resp::Bin(name, vec![]),
            Req::DayRow(name, d) => Resp::DayRow(name, d, vec![]),
            Req::Decided { from, to } => Resp::Decided { from, to, counts: vec![] },
        };
        let _ = reply.send(r);
    }
    fn backend(&self) -> String {
        "native (synthetic)".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::WorldData;
    use crate::layout::Layout;
    use crate::tracks::{Crowd, Window};

    #[test]
    fn the_synthetic_town_is_a_world_the_scene_reads_and_its_people_commute_along_roads() {
        let s = Synthetic::new(600, 2);
        let d = WorldData::parse(&s.world).unwrap();
        assert_eq!(d.meta.persons, 600);
        let l = Layout::new(&d);
        let mut w = Window::new(600, 2);
        for n in w.wants(0) {
            let b = match n {
                Need::Where { from, to } => s.where_bytes(from, to),
                Need::Moves { from, to } => s.moves_bytes(from, to),
            };
            w.take(n, &b);
        }
        let mut c = Crowd::new(600);
        assert!(c.seek(&w, &l, 0));
        assert!(c.cur.iter().all(|&x| x > 0), "everyone at home at midnight");
        c.advance(&w, &l, 8 * 3600, 0);
        assert!(!c.trips.is_empty(), "someone is on the way to work at eight");
        assert!(c.trips.values().all(|t| t.route.pts.len() > 2), "along the roads, not straight");
        c.advance(&w, &l, 12 * 3600, 0);
        c.settle(0);
        assert!(c.trips.is_empty());
    }

    /// The scene's own work per frame at scale, on this CPU (no GPU): `cargo test --release --lib -- --ignored
    /// --nocapture scale`. A day of commuting at 50,000 people, played at 10 minutes a second at 60 frames a second:
    /// the moves applied, trips begun and ended, and every moving person's place and colour packed into the texture.
    #[test]
    #[ignore]
    fn scale() {
        for n in [10_000usize, 50_000] {
            let t0 = std::time::Instant::now();
            let s = Synthetic::new(n, 2);
            let d = WorldData::parse(&s.world).unwrap();
            let l = Layout::new(&d);
            let setup = t0.elapsed();
            let mut w = Window::new(n, 2);
            for need in w.wants(0) {
                let b = match need {
                    Need::Where { from, to } => s.where_bytes(from, to),
                    Need::Moves { from, to } => s.moves_bytes(from, to),
                };
                w.take(need, &b);
            }
            let mut c = Crowd::new(n);
            c.seek(&w, &l, 6 * 3600);
            let mut texels = vec![[0f32; 4]; 2 * n];
            let (speed, fps) = (600.0, 60.0);
            let vis = (speed * 0.6) as i64;
            let mut frames = vec![];
            let mut most_trips = 0;
            let mut t = 6.0 * 3600.0;
            while t < 20.0 * 3600.0 {
                t += speed / fps;
                let f0 = std::time::Instant::now();
                c.advance(&w, &l, t as i64, vis);
                c.settle(vis);
                let mut moving: Vec<u32> = c.trips.keys().copied().collect();
                moving.extend(c.dirty.drain(..));
                for p in moving {
                    if let Some((v, _)) = c.pos(&l, p, vis) {
                        texels[2 * p as usize] = [v[0], v[1], v[2], 1.0];
                    }
                }
                frames.push(f0.elapsed().as_secs_f64() * 1000.0);
                most_trips = most_trips.max(c.trips.len());
            }
            frames.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let mean = frames.iter().sum::<f64>() / frames.len() as f64;
            println!(
                "{n} people: setup (world, layout, roads) {:.0} ms; per frame mean {:.2} ms, p95 {:.2} ms, max {:.2} ms over {} frames; at most {most_trips} on the way; tracks held {:.1} MB",
                setup.as_secs_f64() * 1000.0,
                mean,
                frames[frames.len() * 95 / 100],
                frames[frames.len() - 1],
                frames.len(),
                w.bytes() as f64 / 1e6
            );
        }
    }
}
