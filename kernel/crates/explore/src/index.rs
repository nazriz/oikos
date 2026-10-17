//! `Index`: the run index in memory, built by feeding log lines one at a time, from a finished log or a live run.

use crate::inner::{parse_line, Inner, Item, DAY, MOVE_INTS};
use crate::js::Obj;
use crate::panels;
use crate::world::class_name;
use crate::{ActionRef, Decider, Link, Ord, Panel, RunIndex};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

/// The index's version (the shape of `meta()`).
pub const INDEX_VERSION: u32 = 5;
const CHUNK: usize = 8192;

/// A run's index, in memory. Feed it lines (`feed`, `feed_all`, `load_path`); query it at any time, also while it is
/// being fed (readers share, a feed takes the lock for one batch).
pub struct Index {
    inner: RwLock<Inner>,
    state: Mutex<&'static str>,
    clock: Mutex<(Option<Instant>, Option<Instant>)>,
}

impl Default for Index {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_many(lines: &[String]) -> Vec<Item> {
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1).min(8);
    if lines.len() < 1024 || workers < 2 {
        return lines.iter().map(|l| parse_line(l)).collect();
    }
    let per = lines.len().div_ceil(workers);
    std::thread::scope(|sc| {
        let hs: Vec<_> = lines.chunks(per).map(|c| sc.spawn(move || c.iter().map(|l| parse_line(l)).collect::<Vec<_>>())).collect();
        hs.into_iter().flat_map(|h| h.join().expect("parse worker")).collect()
    })
}

impl Index {
    pub fn new() -> Self {
        Index { inner: RwLock::new(Inner::default()), state: Mutex::new("empty"), clock: Mutex::new((None, None)) }
    }

    fn r(&self) -> std::sync::RwLockReadGuard<'_, Inner> {
        self.inner.read().unwrap_or_else(|e| e.into_inner())
    }

    /// Reads under the lock: the way a caller in this crate or a viewer gets at `Inner` (also for the service).
    pub fn with<T>(&self, f: impl FnOnce(&Inner) -> T) -> T {
        f(&self.r())
    }

    fn apply(&self, items: Vec<Item>) {
        let mut w = self.inner.write().unwrap_or_else(|e| e.into_inner());
        for it in items {
            w.apply(it);
        }
        let mut c = self.clock.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        c.0.get_or_insert(now);
        c.1 = Some(now);
    }

    /// Feeds one log line (the kernel's canonical JSON, without its newline).
    pub fn feed(&self, line: &str) {
        self.apply(vec![parse_line(line)]);
    }
    /// Feeds one log line as bytes (what `kernel::stream::Stream::take` hands out).
    pub fn feed_bytes(&self, line: &[u8]) {
        self.feed(&String::from_utf8_lossy(line));
    }
    /// Feeds many lines in order; parsed on several threads, applied in order under one lock per batch.
    pub fn feed_all<I, S>(&self, lines: I)
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut buf: Vec<String> = Vec::with_capacity(CHUNK);
        for l in lines {
            buf.push(l.as_ref().to_string());
            if buf.len() == CHUNK {
                self.apply(parse_many(&buf));
                buf.clear();
            }
        }
        if !buf.is_empty() {
            self.apply(parse_many(&buf));
        }
    }

    /// Reads a finished log (`.jsonl`, or `.jsonl.zst`) into the index. State is "indexing" until it is read.
    pub fn load_path(&self, path: &Path) -> std::io::Result<()> {
        self.set_state("indexing");
        let f = std::fs::File::open(path)?;
        let mut rd: Box<dyn BufRead + Send> = if path.extension().map(|e| e == "zst").unwrap_or(false) {
            Box::new(BufReader::with_capacity(1 << 20, zstd::stream::read::Decoder::new(f)?))
        } else {
            Box::new(BufReader::with_capacity(1 << 20, f))
        };
        // (reading and decompressing run on their own thread, a few chunks ahead of the parsing and applying)
        let (tx, rx) = std::sync::mpsc::sync_channel::<std::io::Result<Vec<String>>>(4);
        let reader = std::thread::spawn(move || {
            let mut buf: Vec<String> = Vec::with_capacity(CHUNK);
            let mut bytes = Vec::new();
            loop {
                bytes.clear();
                match rd.read_until(b'\n', &mut bytes) {
                    Err(e) => {
                        let _ = tx.send(Err(e));
                        return;
                    }
                    Ok(0) => break,
                    Ok(_) => {}
                }
                buf.push(String::from_utf8_lossy(&bytes).into_owned());
                if buf.len() == CHUNK && tx.send(Ok(std::mem::replace(&mut buf, Vec::with_capacity(CHUNK)))).is_err() {
                    return;
                }
            }
            if !buf.is_empty() {
                let _ = tx.send(Ok(buf));
            }
        });
        let mut err = None;
        for chunk in rx {
            match chunk {
                Ok(lines) => self.apply(parse_many(&lines)),
                Err(e) => {
                    err = Some(e);
                    break;
                }
            }
        }
        let _ = reader.join();
        if let Some(e) = err {
            return Err(e);
        }
        self.set_state("ready");
        Ok(())
    }

    /// Gives the index the pilot viewer's data of the run (`pilot.json`), for the seat panels.
    pub fn set_pilot(&self, pilot: Value) {
        self.inner.write().unwrap_or_else(|e| e.into_inner()).pilot = Some(Arc::new(pilot));
    }
    pub fn pilot(&self) -> Option<Arc<Value>> {
        self.r().pilot.clone()
    }

    /// "empty", "indexing", "ready" (a finished log), or "live" (fed by a running log).
    pub fn state(&self) -> &'static str {
        *self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn set_state(&self, s: &'static str) {
        *self.state.lock().unwrap_or_else(|e| e.into_inner()) = s;
    }
    /// Has the header been read (so the run can be shown)?
    pub fn has_header(&self) -> bool {
        self.r().have_header
    }
    pub fn kept(&self) -> usize {
        self.r().kept()
    }

    /// The `/world` route's body: the run's meta, the static world, who the persons are, the pilot's summary, the
    /// seats' acts, the town's pulse.
    pub fn world_json(&self) -> Option<Value> {
        let s = self.r();
        if !s.have_header {
            return None;
        }
        let tr = s.tracks();
        let spaces: Vec<Value> = s.spaces.iter().map(|x| Value::Array(vec![x.st.into(), x.kind.clone().into(), x.n.into()])).collect();
        let pilot = s.pilot.clone();
        let w = s.world();
        let (read, total) = self.seconds();
        let mut meta = Obj::new()
            .set("runId", w.run_id.clone())
            .set("days", tr.days)
            .set("lastT", s.last_t)
            .set("persons", s.persons.len())
            .set("holders", s.holders.len())
            .set("spaces", spaces)
            .set("extraStructures", s.extra_structures.clone())
            .set("seats", s.seats.clone())
            .set("kept", s.kept())
            .set("lines", s.lines)
            .set("movesDay", tr.moves_day.iter().map(|&x| Value::from(x)).collect::<Vec<_>>())
            .set("pulses", s.pulses.len() / 6)
            .set("indexSeconds", Obj::new().set("read", read).set("total", total).build())
            .set("state", self.state());
        if let Some((reason, detail, t)) = &s.end {
            meta = meta.set("end", Obj::new().opt("reason", reason.clone()).opt("detail", detail.clone()).set("t", *t).build());
        }
        let seat_acts: Vec<Value> = s
            .seat_acts
            .iter()
            .map(|a| {
                let (status, end) = s.seat_act_status(a);
                Obj::new()
                    .set("ord", a.ord)
                    .set("t", a.t)
                    .opt("endT", end)
                    .set("participant", a.participant.clone())
                    .set("as", a.as_.clone())
                    .set("kinds", a.kinds.clone())
                    .set("text", a.text.clone())
                    .set("status", status)
                    .set("from", a.from)
                    .set(
                        "targets",
                        a.targets
                            .iter()
                            .map(|t| Obj::new().set("id", t.id.clone()).set("kind", t.kind).set("struct", t.st).build())
                            .collect::<Vec<_>>(),
                    )
                    .opt("via", a.via.clone())
                    .build()
            })
            .collect();
        Some(
            Obj::new()
                .set("meta", meta.build())
                .set("world", w.client_json(&s.extra_structures))
                .set("persons", s.persons.clone())
                .set("pilot", panels::pilot_summary(pilot.as_deref()))
                .set("seatActs", seat_acts)
                .set("townPulse", panels::town_pulse(&s))
                .build(),
        )
    }

    fn seconds(&self) -> (f64, f64) {
        let c = self.clock.lock().unwrap_or_else(|e| e.into_inner());
        match (c.0, c.1) {
            (Some(a), Some(b)) => {
                let r = (b - a).as_secs_f64();
                ((r * 10.0).round() / 10.0, (a.elapsed().as_secs_f64() * 10.0).round() / 10.0)
            }
            _ => (0.0, 0.0),
        }
    }

    /// The raw tracks the client reads (little-endian): `where` (uint32, by day by person), `pulses` (int32 x6 per
    /// pulse), `money` (float64, by day by holder, persons first), `agency` (int16, by day by person), `moves`
    /// (int32 x3 per move, days `from..to`).
    pub fn track_bytes(&self, name: &str, from: Option<i64>, to: Option<i64>) -> Option<Vec<u8>> {
        let s = self.r();
        if !s.have_header {
            return None;
        }
        let tr = s.tracks();
        let mut out = vec![];
        match name {
            "where" => tr.where_.iter().for_each(|v| out.extend_from_slice(&v.to_le_bytes())),
            "pulses" => s.pulses.iter().for_each(|v| out.extend_from_slice(&v.to_le_bytes())),
            "money" => tr.money.iter().for_each(|&v| out.extend_from_slice(&(v as f64).to_le_bytes())),
            "agency" => tr.agency.iter().for_each(|v| out.extend_from_slice(&v.to_le_bytes())),
            "moves" => {
                let n = s.moves.len() / MOVE_INTS;
                let from = from.unwrap_or(0).max(0) as usize;
                let to = to.map(|t| t.min(tr.days as i64 + 1)).unwrap_or(tr.days as i64 + 1).max(0) as usize;
                let a = tr.moves_day.get(from).copied().unwrap_or(n) * MOVE_INTS;
                let b = tr.moves_day.get(to).copied().unwrap_or(n) * MOVE_INTS;
                if b > a {
                    s.moves[a..b].iter().for_each(|v| out.extend_from_slice(&v.to_le_bytes()));
                }
            }
            _ => return None,
        }
        Some(out)
    }

    pub fn panel_json(&self, what: Panel, t: Option<i64>) -> Option<Value> {
        let s = self.r();
        if !s.have_header {
            return None;
        }
        let t = t.unwrap_or(s.last_t);
        match what {
            Panel::Person(id) => panels::person_panel(&s, &id, t),
            Panel::Org(id) => panels::org_panel(&s, &id, t),
            Panel::Building(n) => panels::building_panel(&s, n as usize, t),
            Panel::SeatAct(o) => panels::seat_act_panel(&s, s.pilot.as_deref(), o),
            Panel::TownPulse => Some(panels::town_pulse(&s)),
        }
    }

    /// `{row, links}` of a kept line (the `/trace` route).
    pub fn trace_json(&self, ord: Ord, about: Option<&str>) -> Option<Value> {
        let s = self.r();
        if (ord as usize) >= s.kept() {
            return None;
        }
        let row = crate::trace::event_row(&s, ord, about).to_value();
        let links = crate::trace::trace(&s, ord, about, 8);
        Some(Obj::new().set("row", row).set("links", serde_json::to_value(links).ok()?).build())
    }

    pub fn seat_json(&self, id: &str) -> Value {
        panels::seat_json(self.r().pilot.as_deref(), id)
    }

    /// The bytes of memory the kept lines take (compressed frames and the open frame).
    pub fn memory_held(&self) -> usize {
        self.r().store.bytes_held()
    }
}

impl RunIndex for Index {
    fn meta(&self) -> Value {
        let s = self.r();
        let (read, total) = self.seconds();
        let mut m = Obj::new()
            .set("version", INDEX_VERSION)
            .set("state", self.state())
            .set("lines", s.lines)
            .set("kept", s.kept())
            .set("frames", s.store.frames())
            .set("memoryHeld", s.store.bytes_held());
        if !s.have_header {
            return m.build();
        }
        let tr = s.tracks();
        let w = s.world();
        m = m
            .set("runId", w.run_id.clone())
            .set("headHash", s.head_hash.clone())
            .set("days", tr.days)
            .set("lastT", s.last_t)
            .set("persons", s.persons.len())
            .set("holders", s.holders.len())
            .set(
                "spaces",
                s.spaces
                    .iter()
                    .map(|x| Obj::new().set("id", x.id.clone()).set("struct", x.st).set("kind", x.kind.clone()).set("n", x.n).build())
                    .collect::<Vec<_>>(),
            )
            .set("extraStructures", s.extra_structures.clone())
            .set("actions", s.actions.len())
            .set("pulses", s.pulses.len() / 6)
            .set("moves", s.moves.len() / MOVE_INTS)
            .set("movesDay", tr.moves_day.iter().map(|&x| Value::from(x)).collect::<Vec<_>>())
            .set(
                "participants",
                s.part_ids
                    .iter()
                    .zip(&s.part_cls)
                    .map(|(id, c)| Obj::new().set("id", id.clone()).set("cls", class_name(*c)).build())
                    .collect::<Vec<_>>(),
            )
            .set("seats", s.seats.clone())
            .set("pilot", s.pilot.is_some())
            .set("seconds", Obj::new().set("read", read).set("total", total).build());
        if let Some((reason, detail, t)) = &s.end {
            m = m.set("end", Obj::new().opt("reason", reason.clone()).opt("detail", detail.clone()).set("t", *t).build());
        }
        m.build()
    }

    fn line(&self, ord: Ord) -> Option<Value> {
        self.r().line(ord)
    }

    fn line_text(&self, ord: Ord) -> Option<String> {
        self.r().text(ord)
    }

    fn postings(&self, id: &str) -> Vec<Ord> {
        self.r().postings(id).to_vec()
    }

    fn day(&self, day: i64) -> std::ops::Range<Ord> {
        let s = self.r();
        let a = s.metas.partition_point(|m| (m.t as i64) < day * DAY);
        let b = s.metas.partition_point(|m| (m.t as i64) < (day + 1) * DAY);
        a as Ord..b as Ord
    }

    fn action_of(&self, ord: Ord) -> Option<ActionRef> {
        let s = self.r();
        if (ord as usize) >= s.kept() {
            return None;
        }
        let a = s.action_of(ord);
        if a < 0 || s.actions[a as usize][0] < 0 {
            return None;
        }
        Some(s.action(a as usize))
    }

    fn decider(&self, participant: &str, about: Option<&str>) -> Decider {
        self.r().cls_of(participant, about)
    }

    fn trace(&self, ord: Ord, about: Option<&str>, max_depth: u32) -> Vec<Link> {
        let s = self.r();
        if !s.have_header {
            return vec![];
        }
        crate::trace::trace(&s, ord, about, max_depth)
    }

    fn panel(&self, what: Panel, t: i64) -> Option<Value> {
        self.panel_json(what, Some(t))
    }
}
